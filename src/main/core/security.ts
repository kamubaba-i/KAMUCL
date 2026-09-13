import fs from 'node:fs'
import path from 'node:path'

function canonicalPath(input: string): string {
  const raw = path.isAbsolute(input) ? input : `${process.cwd()}${path.sep}${input}`
  const root = path.parse(path.resolve(input)).root
  const rawRoot = path.parse(raw).root || root
  let current = rawRoot
  for (const segment of raw.slice(rawRoot.length).split(/[\\/]+/)) {
    if (!segment || segment === '.') continue
    if (segment === '..') {
      current = path.dirname(current)
      continue
    }
    const next = path.join(current, segment)
    try {
      current = fs.realpathSync.native(next)
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code !== 'ENOENT' && code !== 'ENOTDIR') throw error
      let isLink = false
      try {
        isLink = fs.lstatSync(next).isSymbolicLink()
      } catch (lstatError) {
        if ((lstatError as NodeJS.ErrnoException).code !== 'ENOENT') throw lstatError
      }
      if (isLink) throw error
      current = next
    }
  }
  return current
}

export function isPathContained(base: string, candidate: string, allowEqual = false): boolean {
  try {
    const relative = path.relative(canonicalPath(base), canonicalPath(candidate))
    if (relative === '') return allowEqual
    return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)
  } catch {
    return false
  }
}

export function resolveContainedPath(base: string, relative: string): string {
  const resolved = path.resolve(base, relative)
  const candidate = path.isAbsolute(relative) ? relative : `${base}${path.sep}${relative}`
  if (!isPathContained(base, candidate, true)) throw new Error('非法目录')
  return resolved
}

export function safeArchivePath(entryName: string): string {
  if (entryName.includes('\0')) throw new Error('非法归档路径')
  if (entryName.startsWith('/') || entryName.startsWith('\\') || /^[A-Za-z]:/.test(entryName)) {
    throw new Error('非法归档路径')
  }
  const segments = entryName.replaceAll('\\', '/').split('/')
  if (segments.some(segment => segment === '..')) throw new Error('非法归档路径')
  const normalized = segments.filter(segment => segment && segment !== '.').join('/')
  if (!normalized) throw new Error('非法归档路径')
  return normalized
}
