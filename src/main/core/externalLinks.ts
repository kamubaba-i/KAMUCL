import { shell } from 'electron'

export function validateExternalLink(value: string): URL | null {
  try {
    const url = new URL(value)
    if (!['http:', 'https:'].includes(url.protocol)) return null
    if (!url.hostname || url.username || url.password) return null
    return url
  } catch {
    return null
  }
}

export function canOpenExternalLink(value: string): boolean {
  return !!validateExternalLink(value)
}

export async function openExternalLink(value: string): Promise<void> {
  const url = validateExternalLink(value)
  if (!url) throw new Error('链接无效')
  await shell.openExternal(url.toString())
}
