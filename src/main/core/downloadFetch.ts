import { httpFetch } from './httpClient'
import { CF_BUILTIN_KEY } from './curseforgeKey'
import { isIP } from 'node:net'

const REDIRECT_CREDENTIAL_HEADERS = new Set(['authorization', 'cookie', 'proxy-authorization', 'x-api-key'])
const METADATA_HOSTS = new Set(['metadata', 'metadata.google.internal', 'metadata.google'])
const PRIVATE_DNS_ALIASES = ['nip.io', 'sslip.io', 'localtest.me', 'lvh.me']

function parseIpv4(host: string): number[] | undefined {
  if (isIP(host) !== 4) return undefined
  const parts = host.split('.').map(Number)
  return parts.length === 4 && parts.every((part) => part >= 0 && part <= 255) ? parts : undefined
}

function parseIpv6(host: string): number[] | undefined {
  const value = host.toLowerCase().split('%')[0]
  if (isIP(value) !== 6) return undefined
  const sections = value.split('::')
  if (sections.length > 2) return undefined
  const parseSection = (section: string): number[] | undefined => {
    if (!section) return []
    const tokens = section.split(':')
    const words: number[] = []
    for (const [index, token] of tokens.entries()) {
      if (token.includes('.')) {
        if (index !== tokens.length - 1) return undefined
        const ipv4 = parseIpv4(token)
        if (!ipv4) return undefined
        words.push((ipv4[0] << 8) | ipv4[1], (ipv4[2] << 8) | ipv4[3])
      } else if (/^[0-9a-f]{1,4}$/.test(token)) {
        words.push(Number.parseInt(token, 16))
      } else return undefined
    }
    return words
  }
  const left = parseSection(sections[0])
  const right = parseSection(sections[1] ?? '')
  if (!left || !right) return undefined
  const missing = 8 - left.length - right.length
  if (sections.length === 1 ? missing !== 0 : missing <= 0) return undefined
  return sections.length === 1 ? left : [...left, ...Array(missing).fill(0), ...right]
}

function isUnsafeIpv4([a, b]: number[]): boolean {
  return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)
}

function isUnsafeHttpsUrl(raw: string): boolean {
  const url = new URL(raw)
  if (url.protocol !== 'https:') return false
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '')
  if (host === 'localhost' || host.endsWith('.localhost') || METADATA_HOSTS.has(host)) return true
  if (PRIVATE_DNS_ALIASES.some((suffix) => host === suffix || host.endsWith(`.${suffix}`))) return true
  const ipv4 = parseIpv4(host)
  if (ipv4) return isUnsafeIpv4(ipv4)
  const ipv6 = parseIpv6(host)
  if (!ipv6) return false
  const first = ipv6[0]
  const isUnspecified = ipv6.every((word) => word === 0)
  const isLoopback = ipv6.slice(0, 7).every((word) => word === 0) && ipv6[7] === 1
  const isMappedIpv4 = ipv6.slice(0, 5).every((word) => word === 0) && ipv6[5] === 0xffff
  if (isMappedIpv4) return isUnsafeIpv4([
    (ipv6[6] >> 8) & 255,
    ipv6[6] & 255,
    (ipv6[7] >> 8) & 255,
    ipv6[7] & 255
  ])
  return isUnspecified || isLoopback || (first & 0xfe00) === 0xfc00 ||
    (first & 0xffc0) === 0xfe80
}

function assertSafeDownloadUrl(url: string): void {
  if (isUnsafeHttpsUrl(url)) throw new Error('下载跳转地址不安全')
}

function stripRedirectCredentials(headers: Record<string, string>): void {
  for (const name of Object.keys(headers)) {
    if (REDIRECT_CREDENTIAL_HEADERS.has(name.toLowerCase())) delete headers[name]
  }
}

export function needsCurseForgeKey(url: string): boolean {
  const u = new URL(url)
  return u.protocol === 'https:' && u.hostname === 'edge.forgecdn.net' && /^\/files\/\d+\/\d+\//.test(u.pathname)
}

/** Recompute credentials at every redirect; an application key never reaches a mirror. */
export async function downloadFetch(url: string, init: Parameters<typeof httpFetch>[1],
  getKey = async () => process.versions.electron ? (await import('./community')).cfChannel().key : (process.env.KAMUCL_CF_API_KEY || CF_BUILTIN_KEY),
  fetcher = httpFetch): Promise<Response> {
  const headers = { ...init?.headers }
  for (let hop = 0; hop < 10; hop++) {
    assertSafeDownloadUrl(url)
    const requestHeaders = { ...headers }
    if (needsCurseForgeKey(url)) {
      for (const name of Object.keys(requestHeaders)) {
        if (name.toLowerCase() === 'x-api-key') delete requestHeaders[name]
      }
      requestHeaders['x-api-key'] = await getKey()
    }
    let response: Response
    try { response = await fetcher(url, { ...init, headers: requestHeaders, redirect: 'manual' }) }
    catch (error) {
      init?.signal?.throwIfAborted()
      // Node does not use the desktop's PAC/proxy/certificate store. Retry a failed
      // connection through Electron's system transport, retaining Range + validation.
      if (fetcher !== httpFetch || !process.versions.electron || init?.systemProxy || !(error instanceof TypeError)) throw error
      response = await httpFetch(url, { ...init, headers: requestHeaders, redirect: 'manual', systemProxy: true })
    }
    if (![301,302,303,307,308].includes(response.status)) return response
    const location = response.headers.get('location'); await response.body?.cancel()
    if (!location) throw new Error('下载跳转缺少地址')
    const next = new URL(location, url)
    if (!['https:', 'http:'].includes(next.protocol) || (new URL(url).protocol === 'https:' && next.protocol !== 'https:')) throw new Error('下载跳转地址不安全')
    assertSafeDownloadUrl(next.href)
    if (new URL(url).origin !== next.origin) stripRedirectCredentials(headers)
    url = next.href
  }
  throw new Error('下载跳转次数过多')
}
