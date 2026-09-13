import { httpFetch } from './httpClient'
import { CF_BUILTIN_KEY } from './curseforgeKey'

const REDIRECT_CREDENTIAL_HEADERS = new Set(['authorization', 'cookie', 'proxy-authorization', 'x-api-key'])

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
    const requestHeaders = { ...headers }
    if (needsCurseForgeKey(url)) {
      for (const name of Object.keys(requestHeaders)) {
        if (name.toLowerCase() === 'x-api-key') delete requestHeaders[name]
      }
      requestHeaders['x-api-key'] = await getKey()
    }
    const response = await fetcher(url, { ...init, headers: requestHeaders, redirect: 'manual' })
    if (![301,302,303,307,308].includes(response.status)) return response
    const location = response.headers.get('location'); await response.body?.cancel()
    if (!location) throw new Error('下载跳转缺少地址')
    const next = new URL(location, url)
    if (!['https:', 'http:'].includes(next.protocol) || (new URL(url).protocol === 'https:' && next.protocol !== 'https:')) throw new Error('下载跳转地址不安全')
    if (new URL(url).origin !== next.origin) stripRedirectCredentials(headers)
    url = next.href
  }
  throw new Error('下载跳转次数过多')
}
