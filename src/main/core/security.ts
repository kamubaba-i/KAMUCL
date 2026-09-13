import fs from 'node:fs'
import path from 'node:path'

const SENSITIVE_ASSIGNMENT =
  /((?:["']?\b(?:password|access[_-]?token|refresh[_-]?token|client[_-]?token|auth[_-]?token|session(?:[_-]?(?:id|token|key))?|token|api[_-]?key)\b["']?\s*[:=]\s*))("[^"\r\n]*"|'[^'\r\n]*'|[^\s,;&}#]+)/gi
const JSON_COOKIE_ASSIGNMENT =
  /((?:["'])(?:cookies?|session(?:[_-]?(?:id|token|key))?)(?:["'])\s*:\s*)("[^"\r\n]*"|'[^'\r\n]*'|[^\s,;&}#]+)/gi
const COOKIE_ASSIGNMENT = /(\bCookie\s*=\s*)("[^"\r\n]*"|'[^'\r\n]*'|[^\s,;&}#]+)/gi

function redactValue(value: string): string {
  const quote = value[0]
  return (quote === '"' || quote === "'") && value.at(-1) === quote
    ? `${quote}<redacted>${quote}`
    : '<redacted>'
}

function redactCookieHeaderValue(value: string, setCookie: boolean): string {
  if (!value.trim()) return value
  if (setCookie) {
    const firstPair = /^(\s*[^=;\s]+\s*=\s*)("[^"]*"|'[^']*'|[^;\s]*)/.exec(value)
    return firstPair
      ? value.replace(firstPair[0], `${firstPair[1]}${redactValue(firstPair[2])}`)
      : '<redacted>'
  }
  if (!value.includes('=')) return '<redacted>'
  return value.replace(
    /(^|;\s*)([^=;\s]+)(\s*=\s*)("[^"]*"|'[^']*'|[^;\s]*)/g,
    (_match: string, boundary: string, name: string, separator: string, cookieValue: string) =>
      `${boundary}${name}${separator}${redactValue(cookieValue)}`
  )
}

function findStructuredValueEnd(input: string, start: number): number {
  const open = input[start]
  const close = open === '{' ? '}' : open === '[' ? ']' : ''
  if (!close) return -1
  let depth = 0
  let quote = ''
  let escaped = false
  for (let index = start; index < input.length; index++) {
    const character = input[index]
    if (quote) {
      if (escaped) escaped = false
      else if (character === '\\') escaped = true
      else if (character === quote) quote = ''
      continue
    }
    if (character === '"' || character === "'") {
      quote = character
      continue
    }
    if (character === open) depth++
    else if (character === close && --depth === 0) return index + 1
  }
  return -1
}

function redactStructuredJsonValues(input: string): string {
  const keyPattern = /(["'](?:cookies?|session(?:[_-]?(?:id|token|key))?)["']\s*:\s*)([\[{])/gi
  let cursor = 0
  let result = ''
  let match: RegExpExecArray | null
  while ((match = keyPattern.exec(input))) {
    const valueStart = match.index + match[0].length - 1
    const valueEnd = findStructuredValueEnd(input, valueStart)
    if (valueEnd < 0) continue
    result += input.slice(cursor, match.index) + match[1] + JSON.stringify('<redacted>')
    cursor = valueEnd
    keyPattern.lastIndex = valueEnd
  }
  return result + input.slice(cursor)
}

/** 仅脱敏日志中明确可识别的凭据值，保留其他诊断上下文。 */
export function redactSensitiveText(input: string): string {
  let out = redactStructuredJsonValues(String(input ?? ''))
  out = out.replace(/(^|[^\w-])((?:Set-)?Cookie\s*:\s*)([^\r\n]*)/gim, (_match: string, boundary: string, header: string, value: string) =>
    `${boundary}${header}${redactCookieHeaderValue(value, /^Set-Cookie\s*:/i.test(header))}`
  )
  out = out.replace(JSON_COOKIE_ASSIGNMENT, (_match: string, prefix: string, value: string) => `${prefix}${redactValue(value)}`)
  out = out.replace(COOKIE_ASSIGNMENT, (_match: string, prefix: string, value: string) => `${prefix}${redactValue(value)}`)
  out = out.replace(/\b(Bearer\s+)[^\s,;]+/gi, '$1<redacted>')
  return out.replace(SENSITIVE_ASSIGNMENT, (_match: string, prefix: string, value: string) => `${prefix}${redactValue(value)}`)
}

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
  if (/^[A-Za-z]:(?![\\/])/.test(relative)) throw new Error('非法目录')
  const resolved = path.resolve(base, relative)
  if (!isPathContained(base, resolved, true)) throw new Error('非法目录')
  const rawCandidate = path.isAbsolute(relative) ? relative : `${base}${path.sep}${relative}`
  if (!isPathContained(base, rawCandidate, true)) throw new Error('非法目录')
  return resolved
}

type SafeDirPathResolver = (base: string, parts: string[], isVersionPath: boolean) => string
type AsyncSafeDirPathResolver = (base: string, parts: string[], isVersionPath: boolean) => Promise<string>

export function resolveSafeDirPath(
  relative: string,
  resolveBase: (parts: string[], isVersionPath: boolean) => string,
  resolvePath?: SafeDirPathResolver
): string
export function resolveSafeDirPath(
  relative: string,
  resolveBase: (parts: string[], isVersionPath: boolean) => string,
  resolvePath: AsyncSafeDirPathResolver
): Promise<string>
export function resolveSafeDirPath(
  relative: string,
  resolveBase: (parts: string[], isVersionPath: boolean) => string,
  resolvePath: SafeDirPathResolver | AsyncSafeDirPathResolver = (base, parts) => resolveContainedPath(base, parts.length ? path.join(...parts) : '.')
): string | Promise<string> {
  const parts = String(relative ?? '')
    .split(/[\\/]+/)
    .filter((s) => s && s !== '.')
  const isVersionPath = parts[0] === 'versions'
  if (parts.some((s) => s === '..')) throw new Error('非法目录')
  if (parts.length > (isVersionPath ? 3 : 2)) throw new Error('非法目录')
  return resolvePath(resolveBase(parts, isVersionPath), parts, isVersionPath)
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

export function resolveArchiveEntryPath(base: string, entryName: string): string {
  return resolveContainedPath(base, safeArchivePath(entryName))
}

export function isArchiveSymlink(externalFileAttributes: number): boolean {
  return ((externalFileAttributes >>> 16) & 0o170000) === 0o120000
}
