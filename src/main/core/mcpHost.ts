/**
 * MCP Host API：面向本机 AI 客户端（经 mcp/server.mjs sidecar）的启动器能力接口。
 * 安全模型与 kamucl-bridge 一致：仅监听 127.0.0.1 随机端口，一次性 token 写入
 * userData/mcp-server.json 发现文件（0600），本机可读即授权。日志类输出一律经
 * redactDiagnosticText 脱敏。任何失败返回结构化错误，绝不 throw 进主进程。
 *
 * createMcpHostServer 为依赖注入工厂（顶层只引 node 内置与脱敏模块，tsx 下可测）；
 * 真实接线在文件底部的 startMcpHost（惰性 import 业务模块）。
 */
import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import crypto from 'node:crypto'
import { redactDiagnosticText } from './diagnostics'
import type { ControlCallResult } from './controlBridgeCore'

export const MCP_PROTOCOL = 1
const BASE = '/kamucl-mcp/v1'
const MAX_BODY = 1024 * 1024
const MAX_LOG_READ = 256 * 1024
const MAX_CRASH_READ = 512 * 1024

export interface McpHostLogger {
  info(message: string): void
  warn(message: string, error?: unknown): void
  error(message: string, error?: unknown): void
}

export interface McpHostDeps {
  userDataDir(): string
  launcherVersion(): string
  listInstances(): Array<Record<string, unknown>>
  runningVersionIds(): Set<string>
  activeStates(): unknown[]
  lastLaunch(): Record<string, unknown> | null
  recentExits(limit: number): unknown[]
  /** 运行中会话（版本 id + pid，多开寻址） */
  runningGames(): Array<{ versionId: string; pid?: number }>
  /** 指定实例的启动会话日志目录（先查当前会话，再查历史退出记录；无则 null） */
  sessionFor(versionId?: string): { versionId: string; logDir: string } | null
  /** 实例有效游戏目录（版本隔离时指向实例目录） */
  instanceDir(versionId: string): string
  launchGame(versionId: string, folder: string | undefined, serverAddress: string | undefined): { ok: boolean; launchId?: string; error?: string }
  stopGame(versionId: string | undefined, forceToken: string | undefined): Promise<unknown>
  bridgeStatus(versionId: string): Promise<unknown>
  bridgeManifest(versionId: string): Promise<unknown>
  bridgeSet(versionId: string, id: string, value: unknown): Promise<unknown>
  bridgeReset(versionId: string, id?: string): Promise<unknown>
  diagnose(versionId: string): Promise<unknown>
  capture(versionId: string): Promise<ControlCallResult>
  input(versionId: string, actions: unknown): Promise<ControlCallResult>
  controlState(versionId: string): Promise<ControlCallResult>
  controlInstall(versionId: string): { ok: boolean; already?: boolean; error?: string }
  log: McpHostLogger
}

export interface McpHostServer {
  port(): number
  discoveryFile(): string
  close(): Promise<void>
}

interface Discovery {
  protocol: number
  port: number
  token: string
  pid: number
  launcherVersion: string
  startedAt: number
}

function json(res: http.ServerResponse, status: number, body: unknown): void {
  const data = Buffer.from(JSON.stringify(body), 'utf-8')
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
  res.end(data)
}

function readBody(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > MAX_BODY) {
        reject(new Error('请求体过大'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (!chunks.length) return resolve({})
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf-8')))
      } catch {
        reject(new Error('请求体不是有效 JSON'))
      }
    })
    req.on('error', reject)
  })
}

/** 读取文件尾部（从头 offset 或按行数取末尾），限制读取上限 */
async function tailFile(file: string, offset: number | undefined, lines: number): Promise<{ content: string; offset: number; size: number; reset: boolean }> {
  const stat = await fs.promises.stat(file)
  const size = stat.size
  let from: number
  let reset = false
  if (offset !== undefined) {
    if (offset > size) reset = true // 日志已轮换/重写：从头读尾部
    from = reset ? Math.max(0, size - MAX_LOG_READ) : offset
  } else {
    from = Math.max(0, size - MAX_LOG_READ)
  }
  const length = Math.min(MAX_LOG_READ, size - from)
  const handle = await fs.promises.open(file, 'r')
  let text: string
  try {
    const buffer = Buffer.alloc(length)
    await handle.read(buffer, 0, length, from)
    text = buffer.toString('utf-8')
  } finally {
    await handle.close()
  }
  if (offset === undefined) {
    const all = text.split('\n')
    if (from > 0) all.shift() // 丢弃半行
    text = all.slice(-Math.max(1, Math.min(1000, lines))).join('\n')
  } else if (from > 0 && !reset) {
    text = text.replace(/^[^\n]*\n/, '') // 从整行边界开始
  }
  return { content: text, offset: size, size, reset }
}

export async function createMcpHostServer(deps: McpHostDeps): Promise<McpHostServer> {
  const token = crypto.randomBytes(24).toString('hex')
  const startedAt = Date.now()
  const discoveryFile = path.join(deps.userDataDir(), 'mcp-server.json')

  async function handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    if (!url.pathname.startsWith(BASE + '/')) return json(res, 404, { ok: false, error: '未知路径' })
    const route = url.pathname.slice(BASE.length + 1)
    const remote = req.socket.remoteAddress ?? ''
    if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(remote)) return json(res, 403, { ok: false, error: '仅限本机访问' })
    if (route === 'ping') {
      return json(res, 200, { ok: true, protocol: MCP_PROTOCOL, version: deps.launcherVersion(), startedAt })
    }
    if (req.headers['x-kamucl-token'] !== token) return json(res, 401, { ok: false, error: '身份校验失败：缺少或错误的 token' })
    const q = url.searchParams
    const versionId = (q.get('versionId') ?? '').trim()
    try {
      if (req.method === 'GET') {
        switch (route) {
          case 'instances': {
            const running = deps.runningVersionIds()
            const instances = deps.listInstances().map(v => ({ ...v, running: running.has(String(v.id ?? '')) }))
            return json(res, 200, { ok: true, instances })
          }
          case 'state':
            return json(res, 200, {
              ok: true,
              running: [...deps.runningVersionIds()],
              runningGames: deps.runningGames(),
              activeStates: deps.activeStates(),
              lastLaunch: deps.lastLaunch(),
              recentExits: deps.recentExits(10)
            })
          case 'logs/tail': {
            const file = resolveLogFile(deps, q)
            if ('error' in file) return json(res, 400, { ok: false, error: file.error })
            const offsetParam = q.get('offset')
            const offset = offsetParam === null ? undefined : Math.max(0, Number(offsetParam) || 0)
            const lines = Math.max(1, Math.min(1000, Number(q.get('lines')) || 200))
            const tail = await tailFile(file.path, offset, lines)
            return json(res, 200, {
              ok: true,
              file: file.path,
              source: file.source,
              content: redactDiagnosticText(tail.content),
              offset: tail.offset,
              size: tail.size,
              reset: tail.reset
            })
          }
          case 'crashes': {
            if (!versionId) return json(res, 400, { ok: false, error: '缺少 versionId' })
            return json(res, 200, { ok: true, reports: await listCrashReports(deps.instanceDir(versionId)) })
          }
          case 'crash': {
            if (!versionId) return json(res, 400, { ok: false, error: '缺少 versionId' })
            const name = (q.get('file') ?? '').trim()
            const report = await readCrashReport(deps.instanceDir(versionId), name)
            if ('error' in report) return json(res, 404, { ok: false, error: report.error })
            return json(res, 200, { ok: true, file: report.file, content: redactDiagnosticText(report.content) })
          }
          case 'diagnose': {
            if (!versionId) return json(res, 400, { ok: false, error: '缺少 versionId' })
            return json(res, 200, { ok: true, result: await deps.diagnose(versionId) })
          }
          case 'bridge/status': {
            if (!versionId) return json(res, 400, { ok: false, error: '缺少 versionId' })
            return json(res, 200, { ok: true, status: await deps.bridgeStatus(versionId) })
          }
          case 'bridge/manifest': {
            if (!versionId) return json(res, 400, { ok: false, error: '缺少 versionId' })
            return json(res, 200, { ok: true, manifest: await deps.bridgeManifest(versionId) })
          }
          case 'control/state': {
            const id = controlTarget(deps, versionId || undefined)
            if (!id) return json(res, 400, { ok: false, error: '请指定 versionId（或先启动一次游戏）' })
            const result = await deps.controlState(id)
            return json(res, result.ok ? 200 : 400, result)
          }
        }
      } else if (req.method === 'POST') {
        const body = (await readBody(req)) as Record<string, unknown>
        switch (route) {
          case 'launch': {
            const id = String(body.versionId ?? '').trim()
            if (!id) return json(res, 400, { ok: false, error: '缺少 versionId' })
            const result = deps.launchGame(id, typeof body.folder === 'string' ? body.folder : undefined, typeof body.serverAddress === 'string' ? body.serverAddress : undefined)
            return json(res, result.ok ? 200 : 400, result)
          }
          case 'stop': {
            const id = typeof body.versionId === 'string' && body.versionId.trim() ? body.versionId.trim() : undefined
            const result = await deps.stopGame(id, typeof body.forceToken === 'string' ? body.forceToken : undefined)
            return json(res, 200, { ok: true, result })
          }
          case 'bridge/set': {
            const id = String(body.versionId ?? '').trim()
            if (!id) return json(res, 400, { ok: false, error: '缺少 versionId' })
            return json(res, 200, { ok: true, result: await deps.bridgeSet(id, String(body.id ?? ''), body.value) })
          }
          case 'bridge/reset': {
            const id = String(body.versionId ?? '').trim()
            if (!id) return json(res, 400, { ok: false, error: '缺少 versionId' })
            return json(res, 200, { ok: true, result: await deps.bridgeReset(id, body.id === undefined ? undefined : String(body.id)) })
          }
          case 'control/screenshot': {
            const id = controlTarget(deps, body.versionId)
            if (!id) return json(res, 400, { ok: false, error: '请指定 versionId（或先启动一次游戏）' })
            const result = await deps.capture(id)
            return json(res, result.ok ? 200 : 400, result)
          }
          case 'control/input': {
            const id = controlTarget(deps, body.versionId)
            if (!id) return json(res, 400, { ok: false, error: '请指定 versionId（或先启动一次游戏）' })
            const result = await deps.input(id, body.actions)
            return json(res, result.ok ? 200 : 400, result)
          }
          case 'control/install': {
            const id = controlTarget(deps, body.versionId)
            if (!id) return json(res, 400, { ok: false, error: '缺少 versionId' })
            const result = deps.controlInstall(id)
            return json(res, result.ok ? 200 : 400, result)
          }
        }
      }
      return json(res, 404, { ok: false, error: '未知接口' })
    } catch (error) {
      deps.log.warn(`MCP 请求处理失败：${req.method} ${url.pathname}`, error)
      return json(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) })
    }
  }

  const server = http.createServer((req, res) => {
    void handle(req, res).catch(error => {
      deps.log.error('MCP 请求处理未捕获异常', error)
      if (!res.headersSent) json(res, 500, { ok: false, error: '内部错误' })
      res.end()
    })
  })
  server.on('error', error => deps.log.error('MCP 服务监听异常', error))

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })
  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : 0
  const discovery: Discovery = { protocol: MCP_PROTOCOL, port, token, pid: process.pid, launcherVersion: deps.launcherVersion(), startedAt }
  const tmp = discoveryFile + '.tmp'
  await fs.promises.mkdir(path.dirname(discoveryFile), { recursive: true })
  await fs.promises.writeFile(tmp, JSON.stringify(discovery, null, 2), { encoding: 'utf-8', mode: 0o600 })
  await fs.promises.rename(tmp, discoveryFile)
  deps.log.info(`MCP Host API 已就绪：127.0.0.1:${port}（发现文件 ${discoveryFile}）`)

  return {
    port: () => port,
    discoveryFile: () => discoveryFile,
    close: () => new Promise<void>(resolve => {
      server.close(() => resolve())
      try { fs.rmSync(discoveryFile, { force: true }) } catch { /* 忽略 */ }
    })
  }
}

/** 控制类接口的实例寻址：显式 versionId 优先，缺省回退到最近一次启动的实例 */
function controlTarget(deps: McpHostDeps, raw: unknown): string | null {
  const id = typeof raw === 'string' && raw.trim() ? raw.trim() : null
  if (id) return id
  const last = deps.lastLaunch()?.versionId
  return typeof last === 'string' && last ? last : null
}

function resolveLogFile(deps: McpHostDeps, q: URLSearchParams): { path: string; source: string } | { error: string } {
  const source = q.get('source') ?? 'session'
  const versionId = (q.get('versionId') ?? '').trim()
  if (source === 'game') {
    if (!versionId) return { error: 'source=game 需要 versionId' }
    return { path: path.join(deps.instanceDir(versionId), 'logs', 'latest.log'), source }
  }
  const last = deps.sessionFor(versionId || undefined)
  if (!last?.logDir) return { error: versionId ? `实例 ${versionId} 没有启动会话日志` : '暂无本次启动的会话日志（游戏未通过本启动器启动过）' }
  const name = source === 'stdout' ? 'stdout.log' : source === 'stderr' ? 'stderr.log' : 'latest.log'
  return { path: path.join(String(last.logDir), name), source }
}

async function listCrashReports(instanceDir: string): Promise<Array<{ file: string; mtime: number; size: number }>> {
  try {
    const root = path.join(instanceDir, 'crash-reports')
    const entries = await fs.promises.readdir(root, { withFileTypes: true })
    const files = await Promise.all(
      entries
        .filter(entry => entry.isFile() && /\.(?:txt|log)$/i.test(entry.name))
        .map(async entry => {
          const stat = await fs.promises.stat(path.join(root, entry.name))
          return { file: entry.name, mtime: stat.mtimeMs, size: stat.size }
        })
    )
    return files.sort((a, b) => b.mtime - a.mtime).slice(0, 20)
  } catch {
    return []
  }
}

async function readCrashReport(instanceDir: string, name: string): Promise<{ file: string; content: string } | { error: string }> {
  const reports = await listCrashReports(instanceDir)
  const target = name ? reports.find(r => r.file === name) : reports[0]
  if (!target) return { error: name ? `崩溃报告不存在：${name}` : '该实例没有崩溃报告' }
  if (name && (name.includes('/') || name.includes('\\') || name.includes('..'))) return { error: '非法文件名' }
  const file = path.join(instanceDir, 'crash-reports', target.file)
  const stat = await fs.promises.stat(file)
  const length = Math.min(MAX_CRASH_READ, stat.size)
  const handle = await fs.promises.open(file, 'r')
  try {
    const buffer = Buffer.alloc(length)
    await handle.read(buffer, 0, length, stat.size - length) // 尾部：分析与模组清单在后半部分
    return { file: target.file, content: buffer.toString('utf-8') + (stat.size > length ? `\n…（已截断，全文 ${stat.size} 字节，仅取尾部 ${length} 字节）` : '') }
  } finally {
    await handle.close()
  }
}

// ---------------- 真实接线（仅运行启动器主进程时调用；惰性 import 保持本文件可测） ----------------

let running: McpHostServer | null = null

export async function startMcpHost(): Promise<void> {
  if (running) return
  const { app } = await import('electron')
  const { getSettings } = await import('./settings')
  if (getSettings().mcpEnabled === false) return
  const [
    { logScope },
    versions,
    launch,
    { activeLaunchStates, rememberLaunchState },
    { exitHistory },
    { instanceDirectoryState },
    { withGameFolder, folderOfVersion },
    modBridge,
    instanceDiagnostics,
    controlBridge
  ] = await Promise.all([
    import('./launcherLog'),
    import('./versions'),
    import('./launch'),
    import('./launchUiState'),
    import('./exitHistory'),
    import('./instances'),
    import('./paths'),
    import('./modBridge'),
    import('./instanceDiagnostics'),
    import('./controlBridge')
  ])
  const log = logScope('mcp')
  const logger: McpHostLogger = {
    info: message => log.info(message),
    warn: (message, error) => (error === undefined ? log.warn(message) : log.warn(message, error)),
    error: (message, error) => (error === undefined ? log.error(message) : log.error(message, error))
  }
  running = await createMcpHostServer({
    userDataDir: () => app.getPath('userData'),
    launcherVersion: () => app.getVersion(),
    listInstances: () => versions.listAllInstalled().map(v => ({
      id: v.id,
      mcVersion: v.mcVersion,
      loader: v.loader,
      loaderVersion: v.loaderVersion,
      modpackName: v.modpackName,
      modpackVersion: v.modpackVersion,
      gameDirectory: v.gameDirectory,
      isolated: v.isolated,
      incomplete: v.incomplete,
      failed: v.failed
    })),
    runningVersionIds: () => launch.getRunningVersionIds(),
    activeStates: () => activeLaunchStates(),
    lastLaunch: () => launch.getLastLaunch() as Record<string, unknown> | null,
    recentExits: limit => exitHistory().list().slice(-limit),
    runningGames: () => launch.getRunningGames(),
    sessionFor: versionId => {
      const last = launch.getLastLaunch()
      if (!versionId || last?.versionId === versionId) {
        if (last?.logDir) return { versionId: last.versionId, logDir: String(last.logDir) }
        if (!versionId) return null
      }
      // 多开/旧会话：从退出记录里倒查该实例最近一次启动的日志目录
      for (const entry of [...exitHistory().list()].reverse()) {
        const context = entry.kind === 'game' ? (entry.context as Record<string, unknown> | undefined) : undefined
        if (context?.versionId === versionId && typeof context.logDir === 'string') {
          return { versionId, logDir: context.logDir }
        }
      }
      return null
    },
    instanceDir: versionId => instanceDirectoryState(versionId, versions.readVersionJson(versionId)).path,
    launchGame: (versionId, folder, serverAddress) => {
      try {
        const settings = getSettings()
        const targetFolder = folder || settings.activeFolder || settings.gameDir
        if (!settings.folders.some(f => f.path === targetFolder)) return { ok: false, error: '目标游戏文件夹未登记' }
        if (!versions.scanInstalledFolder(targetFolder).versions.some(v => v.id === versionId && !v.failed && !v.incomplete)) {
          return { ok: false, error: '目标实例不存在或不完整' }
        }
        const launchId = crypto.randomUUID()
        const onState = (s: import('../../shared/types').LaunchState) => {
          rememberLaunchState({ ...s, versionId, folder: targetFolder, launchId })
          if (s.status === 'error') logger.error(`启动状态异常：${s.text}`)
          else logger.info(`启动状态 ${s.status}：${s.text}`)
        }
        onState({ status: 'launching', text: 'MCP 请求启动，正在准备…' })
        void withGameFolder(targetFolder, () =>
          launch.launch(
            versionId,
            () => undefined,
            () => undefined,
            onState,
            serverAddress,
            {}
          )
        ).catch(error => {
          launch.recordLaunchPreparationError(versionId, error instanceof Error ? error.message : String(error))
          onState({ status: 'error', text: error instanceof Error ? error.message : String(error) })
        })
        return { ok: true, launchId }
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) }
      }
    },
    stopGame: (versionId, forceToken) => (versionId ? launch.killGameVersion(versionId, forceToken) : launch.killGame(forceToken)),
    bridgeStatus: versionId => modBridge.bridgeStatus(versionId),
    bridgeManifest: versionId => modBridge.bridgeManifest(versionId),
    bridgeSet: (versionId, id, value) => modBridge.bridgeSet(versionId, id, value),
    bridgeReset: (versionId, id) => modBridge.bridgeReset(versionId, id),
    diagnose: async versionId => {
      const folder = folderOfVersion(versionId)
      return instanceDiagnostics.diagnoseInstance({ folder, id: versionId }, AbortSignal.timeout(120000))
    },
    capture: versionId => controlBridge.controlScreenshot(versionId),
    input: (versionId, actions) => controlBridge.controlInput(versionId, actions),
    controlState: versionId => controlBridge.controlState(versionId),
    controlInstall: versionId => controlBridge.installControl(versionId),
    log: logger
  })
}

export async function stopMcpHost(): Promise<void> {
  const current = running
  running = null
  if (current) await current.close()
}
