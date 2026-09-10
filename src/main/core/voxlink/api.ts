/**
 * voxlink/api.ts — VoxLink HTTP API 客户端（移植自 voxlink/app-desktop/api.go）
 *
 *  服务器默认基址：https://p2p.wuhui.icu
 *  请求格式：{base}/?route=<route>&<query>
 *  响应统一信封：{ success, data, error, message }
 */
import { URL } from 'node:url'

/** Protocol review: AUGUHDAR/VoxLink 6b11d93 (1.1.5, 2026-09-10). */
export const APP_VERSION = '1.1.5'
export const DEFAULT_SERVER_URL = 'https://p2p.wuhui.icu'
export const HTTP_TIMEOUT_MS = 10_000
export const MAX_RESPONSE_LEN = 4 << 20

/** 来源标记字段（任务约束：创建房间请求必须带上 client_tag: 'kamucl'）。 */
export const CLIENT_TAG = 'kamucl'

export class APIError extends Error {
  readonly code: string
  readonly status: number
  constructor(code: string, message: string, status = 0) {
    super(message ? `${code}: ${message}` : code)
    this.code = code
    this.status = status
    this.name = 'APIError'
  }
}

export interface Envelope {
  success: boolean
  data?: unknown
  error?: string
  message?: string
}

export type QueryValue = string | number | boolean | undefined | null

function buildRequestUrl(baseURL: string, route: string, query: Record<string, QueryValue | QueryValue[]>): string {
  const u = new URL(baseURL)
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw new APIError('NETWORK', '服务器地址必须以 http:// 或 https:// 开头')
  }
  if (!u.host) {
    throw new APIError('NETWORK', '服务器地址缺少主机名')
  }
  u.searchParams.set('route', route)
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null) continue
    if (Array.isArray(v)) {
      for (const item of v) {
        if (item === undefined || item === null) continue
        u.searchParams.append(k, String(item))
      }
    } else {
      u.searchParams.set(k, String(v))
    }
  }
  return u.toString()
}

export interface ApiClientOptions {
  userAgent?: string
  timeoutMs?: number
}

export class ApiClient {
  readonly userAgent: string
  readonly timeoutMs: number
  private updateCooldown = new Map<string, number>()

  constructor(opts: ApiClientOptions = {}) {
    this.userAgent = opts.userAgent ?? `KAMUCL-App/${APP_VERSION}`
    this.timeoutMs = opts.timeoutMs ?? HTTP_TIMEOUT_MS
  }

  async do(
    baseURL: string,
    method: 'GET' | 'POST',
    route: string,
    query: Record<string, QueryValue | QueryValue[]>,
    body: unknown
  ): Promise<unknown> {
    const cooldownKey = route === '/room/update' ? baseURL + ':' + String((body as { code?: string } | null)?.code ?? '') : ''
    const remaining = (this.updateCooldown.get(cooldownKey) ?? 0) - Date.now()
    if (cooldownKey && remaining > 0) throw new APIError('RATE_LIMITED', `请求过于频繁，请 ${Math.ceil(remaining / 1000)} 秒后重试`, 429)
    let url: string
    try {
      url = buildRequestUrl(baseURL, route, query)
    } catch (e) {
      throw e instanceof APIError ? e : new APIError('NETWORK', (e as Error).message)
    }

    const init: RequestInit = {
      method,
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': this.userAgent,
        'X-VoxLink-Version': APP_VERSION
      },
      signal: AbortSignal.timeout(this.timeoutMs)
    }
    if (body !== undefined && body !== null) {
      init.body = JSON.stringify(body)
    }

    let resp: Response
    try {
      resp = await fetch(url, init)
    } catch (e) {
      throw new APIError('NETWORK', `网络请求失败: ${(e as Error).message}`)
    }

    let text: string
    try {
      text = await resp.text()
    } catch (e) {
      throw new APIError('NETWORK', `读取响应失败: ${(e as Error).message}`)
    }
    if (text.length > MAX_RESPONSE_LEN) text = text.slice(0, MAX_RESPONSE_LEN)

    let env: Envelope
    try {
      env = JSON.parse(text) as Envelope
    } catch {
      throw new APIError(
        `HTTP_${resp.status}`,
        `响应解析失败（HTTP ${resp.status}）`,
        resp.status
      )
    }

    if (resp.status === 429) {
      const code = env.error || 'RATE_LIMITED'
      let msg = env.message || '请求过于频繁，请稍后重试'
      const ra = resp.headers.get('Retry-After')
      if (cooldownKey) {
        const seconds = Number(ra)
        const delay = ra && Number.isFinite(seconds) ? Math.max(1, seconds) * 1000 : Math.max(1000, Date.parse(ra ?? '') - Date.now() || 30_000)
        this.updateCooldown.set(cooldownKey, Date.now() + delay)
      }
      if (ra) msg += `（请 ${ra} 秒后重试）`
      throw new APIError(code, msg, resp.status)
    }

    if (!env.success) {
      const code = env.error || `HTTP_${resp.status}`
      const msg = env.message || `服务器返回错误（HTTP ${resp.status}）`
      throw new APIError(code, msg, resp.status)
    }
    return env.data ?? null
  }

  async post(baseURL: string, route: string, body: unknown, parseTo?: unknown): Promise<unknown> {
    const raw = await this.do(baseURL, 'POST', route, {}, body)
    if (parseTo !== undefined && raw !== null) {
      Object.assign(parseTo as object, raw as object)
    }
    return raw
  }

  async get(baseURL: string, route: string, query: Record<string, QueryValue | QueryValue[]>, parseTo?: unknown): Promise<unknown> {
    const raw = await this.do(baseURL, 'GET', route, query, null)
    if (parseTo !== undefined && raw !== null) {
      Object.assign(parseTo as object, raw as object)
    }
    return raw
  }
}

export const newAPIClient = (): ApiClient => new ApiClient()

/** URL 校验（仅允许 http/https）。 */
export function validateServerURL(u: string): boolean {
  const t = u.trim()
  if (!t) return false
  const low = t.toLowerCase()
  return low.startsWith('http://') || low.startsWith('https://')
}

/** 6 位房间码字符集校验：A-Z 去掉 I/O、2-9 去掉 0/1。 */
export function validateRoomCode(code: string): boolean {
  if (code.length !== 6) return false
  const charset = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  for (const c of code) if (!charset.includes(c)) return false
  return true
}
