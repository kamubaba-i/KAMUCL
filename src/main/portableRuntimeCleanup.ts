import fs from 'node:fs'
import path from 'node:path'

export function cleanupPortableRuntimeCaches(runtimeRoot: string, currentRuntime: string): string[] {
  const root = path.resolve(runtimeRoot)
  const current = path.resolve(currentRuntime)
  if (path.dirname(current) !== root) return []

  const removed: string[] = []
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(root, { withFileTypes: true })
  } catch {
    return []
  }
  for (const entry of entries) {
    const target = path.join(root, entry.name)
    if (
      target === current ||
      !entry.isDirectory() ||
      entry.isSymbolicLink() ||
      !/^\d+\.\d+\.\d+-[a-f0-9]{16}$/.test(entry.name) ||
      !fs.existsSync(path.join(target, 'cache.ready'))
    ) continue
    try {
      fs.rmSync(target, { recursive: true, force: true })
      removed.push(target)
    } catch {
      // A running older launcher may still hold files open on Windows.
    }
  }
  return removed
}

export function cleanupCurrentPortableRuntime(): string[] {
  if (process.platform !== 'win32' || !process.env.PORTABLE_EXECUTABLE_FILE) return []
  const current = path.dirname(process.resourcesPath)
  return cleanupPortableRuntimeCaches(path.dirname(current), current)
}
