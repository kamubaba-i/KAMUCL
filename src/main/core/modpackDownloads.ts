import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { downloadAll, type AllProgressFn, type DownloadTask, type MirrorPref } from './download'
import { downloadLimiter } from './downloadLimits'
import { defaultFolderPath } from './paths'
import { throwIfCancelled, waitIfTaskPaused } from './tasks'

/** Keep verified immutable downloads outside the instance transaction, so rollback/reimport can reuse them. */
export async function downloadModpackFiles(
  tasks: DownloadTask[], progress: AllProgressFn, mirror: MirrorPref, signal?: AbortSignal,
  cacheRoot = path.join(defaultFolderPath(), '.kamucl', 'modpack-cache')
): Promise<void> {
  const cached = tasks.map(task => {
    const hash = task.sha512 && /^[a-f\d]{128}$/i.test(task.sha512) ? 'sha512:' + task.sha512.toLowerCase()
      : task.sha1 && /^[a-f\d]{40}$/i.test(task.sha1) ? 'sha1:' + task.sha1.toLowerCase() : ''
    const suffix = ['.jar', '.zip', '.mrpack'].includes(path.extname(task.dest).toLowerCase()) ? path.extname(task.dest).toLowerCase() : '.bin'
    const dest = hash ? path.join(cacheRoot, crypto.createHash('sha256').update(hash).digest('hex') + suffix) : task.dest
    return { ...task, label: task.label || path.basename(task.dest), dest, installDest: task.dest }
  }).sort((a, b) => (b.size ?? 0) - (a.size ?? 0))
  await downloadAll(cached, progress, downloadLimiter.maxConcurrent, mirror, signal)
  for (const task of cached) {
    await waitIfTaskPaused(signal); throwIfCancelled(signal)
    if (task.dest === task.installDest) continue
    await fs.promises.mkdir(path.dirname(task.installDest), { recursive: true })
    // Copy, never hard-link: edits made by mods must not mutate the shared cache.
    await fs.promises.copyFile(task.dest, task.installDest)
  }
}
