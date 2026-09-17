import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { app, dialog, ipcMain, shell, type BrowserWindow } from 'electron'
import { IPC_EVENT } from '../../shared/types'
import { RECORDING_DIRS, type RecordingCatalog, type RecordingEntry, type RecordingKind, type RecordingRequest, type RecordingResult } from '../../shared/recordings'
import { getSettings } from './settings'
import { listAllInstalled } from './versions'
import { centerTarget, assertInstanceIdle } from './instanceCenter'
import { safePath } from './backupStore'
import { copyRecording, validateRecording } from './recordingFiles'
import { recycleFile } from './recycleFile'
import { withFileJob } from './fileJobs'
import { registerTask, finishTask, waitIfTaskPaused } from './tasks'

type Source = { root: string; label: string; library: boolean }
type Stored = { entry: RecordingEntry; source: Source; rel: string }
const catalog = new Map<string, Stored>()
const library = () => path.join(app.getPath('userData'), 'recordings')
const key = (s: string) => process.platform === 'win32' ? path.resolve(s).toLowerCase() : path.resolve(s)
async function recordingDirectory(root: string, kind: RecordingKind, create = false) {
  const dir = await safePath(root, RECORDING_DIRS[kind], true)
  if (create) await fs.promises.mkdir(dir, { recursive: true })
  return dir
}
async function scan(): Promise<RecordingCatalog> {
  await fs.promises.mkdir(library(), { recursive: true })
  const sources: Source[] = [{ root: library(), label: '集中收藏', library: true }]
  const warnings: string[] = [], instances: RecordingCatalog['instances'] = []
  for (const f of getSettings().folders) sources.push({ root: f.path, label: f.name + ' · 共享目录', library: false })
  for (const v of listAllInstalled()) {
    try { const c = centerTarget({ folder: v.folder, id: v.id }); sources.push({ root: c.dir, label: v.id, library: false }); instances.push({ folder: v.folder, id: v.id, name: v.id + ' · ' + v.folder }) }
    catch { warnings.push('无法读取实例：' + v.id) }
  }
  const found = new Map<string, Stored>(), seen = new Set<string>(); let visited = 0
  for (const source of sources) {
    if (seen.has(key(source.root))) continue
    seen.add(key(source.root))
    for (const kind of ['replaymod', 'flashback'] as const) {
      async function visit(rel: string, depth: number): Promise<void> {
        if (++visited > 20000) throw new Error('扫描已达到 20000 个目录/文件上限，请分目录整理')
        const dir = await safePath(source.root, rel, true)
        let entries: fs.Dirent[]
        try { entries = await fs.promises.readdir(dir, { withFileTypes: true }) } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return; throw e }
        for (const file of entries) {
          if (file.isSymbolicLink() || file.name.startsWith('.')) continue
          const next = rel + '/' + file.name
          if (file.isDirectory()) { if (depth < 4 && !/\.(cache|tmp|del)$/i.test(file.name)) await visit(next, depth + 1); continue }
          if (!file.isFile() || !(kind === 'replaymod' ? /\.mcpr$/i : /\.zip$/i).test(file.name)) continue
          if (found.size >= 10000) throw new Error('仅显示前 10000 个录像文件')
          const full = await safePath(source.root, next), stat = await fs.promises.lstat(full)
          const id = crypto.createHash('sha256').update(key(full)).digest('hex')
          found.set(id, { source, rel: next, entry: { id, name: file.name, kind, size: stat.size, modified: stat.mtimeMs, source: source.label, directory: path.dirname(full), library: source.library } })
        }
      }
      try { await visit(RECORDING_DIRS[kind], 0) } catch (e) { warnings.push(source.label + '：' + String(e)) }
    }
  }
  catalog.clear(); for (const [id, entry] of found) catalog.set(id, entry)
  return { entries: [...found.values()].map(s => s.entry).sort((a, b) => b.modified - a.modified), warnings, library: library(), instances }
}
async function current(s: Stored): Promise<string> {
  const file = await safePath(s.source.root, s.rel), stat = await fs.promises.lstat(file)
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== s.entry.size || stat.mtimeMs !== s.entry.modified) throw new Error('录像已变化，请刷新列表后重试')
  return file
}
export function registerRecordingsIpc(getWin: () => BrowserWindow | null) {
  ipcMain.handle('recordings:list', scan)
  ipcMain.handle('recordings:open', async (_e, id?: string) => {
    if (id) { const s = catalog.get(id); if (!s) throw new Error('请刷新录像列表'); shell.showItemInFolder(await current(s)) }
    else { await fs.promises.mkdir(library(), { recursive: true }); const error = await shell.openPath(library()); if (error) throw new Error(error) }
  })
  async function run(items: Stored[], action: RecordingRequest['action'], destination?: string) {
    const task = registerTask('录像文件 · ' + ({ collect: '收集', export: '提取', dispatch: '复制到实例', trash: '移入回收站' }[action]), 'world')
    const signal = task.controller.signal, results: RecordingResult[] = []
    const total = items.reduce((sum, s) => sum + s.entry.size, 0); let done = 0
    const progress = (bytes: number, name: string) => getWin()?.webContents.send(IPC_EVENT.progress, { taskId: task.id, taskTitle: task.title, stage: 'world', progress: total ? Math.min(1, (done + bytes) / total) : 0, text: `${results.length}/${items.length} · ${name}` })
    try {
      for (const item of items) {
        try {
          await waitIfTaskPaused(signal); signal.throwIfAborted(); progress(0, item.entry.name)
          const file = await current(item)
          let output: string | undefined
          if (action === 'trash') {
            await withFileJob(item.source.root, signal, async () => { if (!item.source.library) await assertInstanceIdle(item.source.root); await current(item); await recycleFile(path.dirname(file), path.basename(file)) })
          } else {
            await validateRecording(file, item.entry.kind)
            const root = destination || library()
            await withFileJob(root, signal, async () => {
              if (action === 'dispatch') await assertInstanceIdle(root)
              const dir = action === 'export' ? root : await recordingDirectory(root, item.entry.kind, true)
              output = await copyRecording(file, dir, signal, bytes => progress(bytes, item.entry.name))
            })
          }
          results.push({ id: item.entry.id, name: item.entry.name, ok: true, path: output })
        } catch (e) { results.push({ id: item.entry.id, name: item.entry.name, ok: false, error: signal.aborted ? '任务已取消，原录像保留' : String(e) }) }
        done += item.entry.size
      }
      const failed = results.filter(r => !r.ok).length
      getWin()?.webContents.send(IPC_EVENT.taskDone, { taskId: task.id, ok: !failed, cancelled: signal.aborted, error: failed ? `${failed} 个录像处理失败，请查看录像页结果` : undefined })
      return results
    } finally { finishTask(task.id) }
  }
  ipcMain.handle('recordings:operate', async (_e, request: RecordingRequest) => {
    if (!request || !['collect', 'export', 'dispatch', 'trash'].includes(request.action) || !Array.isArray(request.ids) || request.ids.length < 1 || request.ids.length > 10000) throw new Error('录像操作参数无效')
    const items = [...new Set(request.ids)].map(id => { const s = catalog.get(id); if (!s) throw new Error('录像列表已变化，请刷新'); return s })
    let dest: string | undefined
    if (request.action === 'dispatch') { if (!request.target) throw new Error('请选择目标实例'); dest = centerTarget(request.target).dir }
    if (request.action === 'export') { const picked = await dialog.showOpenDialog({ title: '选择录像提取文件夹', properties: ['openDirectory', 'createDirectory'] }); if (picked.canceled) return null; dest = picked.filePaths[0] }
    return run(items, request.action, dest)
  })
  ipcMain.handle('recordings:import', async () => {
    const picked = await dialog.showOpenDialog({ title: '导入录像到集中收藏', properties: ['openFile', 'multiSelections'], filters: [{ name: 'ReplayMod / Flashback', extensions: ['mcpr', 'zip'] }] })
    if (picked.canceled) return null
    await fs.promises.mkdir(library(), { recursive: true })
    const items: Stored[] = []
    for (const file of picked.filePaths) { const stat = await fs.promises.lstat(file); items.push({ source: { root: path.dirname(file), label: '导入', library: false }, rel: path.basename(file), entry: { id: file, name: path.basename(file), kind: /\.mcpr$/i.test(file) ? 'replaymod' : 'flashback', size: stat.size, modified: stat.mtimeMs, source: '导入', directory: path.dirname(file), library: false } }) }
    return run(items, 'collect')
  })
}
