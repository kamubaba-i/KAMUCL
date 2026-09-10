import { parentPort, workerData } from 'node:worker_threads'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import AdmZip from 'adm-zip'
import { parseModArchive } from './modMetadata'

// CPU-heavy ZIP parsing stays off Electron's main thread. Only regular files in this directory.
async function scan() {
  const { dir, hash } = workerData as { dir: string; hash: boolean }
  let entries: fs.Dirent[]
  try { entries = await fs.promises.readdir(dir, { withFileTypes: true }) }
  catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return []; throw e }
  const result: unknown[] = []
  for (const entry of entries) {
    if (!entry.isFile() || !/\.jar$/i.test(entry.name)) continue
    const file = path.join(dir, entry.name)
    try {
      const data = await fs.promises.readFile(file)
      const info = parseModArchive(new AdmZip(data), file, entry.name)
      result.push({ ...info, sha1: hash ? crypto.createHash('sha1').update(data).digest('hex') : '' })
    } catch { result.push({ fileName: entry.name, filePath: file, error: '文件损坏或不可读取' }) }
  }
  return result
}
scan().then(result => parentPort!.postMessage({ result }), error => parentPort!.postMessage({ error: String(error?.message || error) }))
