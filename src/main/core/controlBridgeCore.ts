/**
 * KAMUCL 控制 MOD 客户端核心：发现文件解析、受支持构建清单与 HTTP 调用。
 * 纯函数/无业务依赖（tsx 下可测）；应用侧接线见 controlBridge.ts。
 * 安全模型与 kamucl-bridge 一致：127.0.0.1 + 发现文件 token，本机可读即授权。
 */

export const CONTROL_PROTOCOL = 1

export interface ControlDiscovery {
  protocol: number
  port: number
  token: string
  modVersion: string
  mcVersion: string
  pid: number
  startedAt: number
}

/** 内置控制 MOD 构建清单：按 MC 版本提供对应 jar（随启动器分发） */
export const CONTROL_BUILDS: ReadonlyArray<{ mcVersion: string; jar: string }> = [
  { mcVersion: '1.21.1', jar: 'kamucl-control-1.21.1.jar' }
]

export function controlJarFor(mcVersion: string): string | null {
  return CONTROL_BUILDS.find(build => build.mcVersion === mcVersion)?.jar ?? null
}

export function controlSupportedVersions(): string[] {
  return CONTROL_BUILDS.map(build => build.mcVersion)
}

/** 解析发现文件内容；不合法返回 null */
export function parseControlDiscovery(raw: unknown): ControlDiscovery | null {
  const value = raw as Partial<ControlDiscovery> | null
  if (value?.protocol !== CONTROL_PROTOCOL) return null
  const port = Number(value.port)
  if (!Number.isInteger(port) || port <= 0 || port > 65535) return null
  if (typeof value.token !== 'string' || value.token.length < 16) return null
  return {
    protocol: CONTROL_PROTOCOL,
    port,
    token: value.token,
    modVersion: String(value.modVersion ?? ''),
    mcVersion: String(value.mcVersion ?? ''),
    pid: Number(value.pid ?? 0),
    startedAt: Number(value.startedAt ?? 0)
  }
}

export interface ControlCallResult {
  ok: boolean
  error?: string
  [key: string]: unknown
}

/** 调用控制 MOD 端点（发现文件可能来自残留进程：先校验 pid 存活） */
export async function callControl(
  discovery: ControlDiscovery,
  pathname: string,
  body?: unknown,
  timeoutMs = 10000
): Promise<ControlCallResult> {
  try {
    process.kill(discovery.pid, 0)
  } catch {
    return { ok: false, error: '检测到上次的控制服务记录，但游戏已退出' }
  }
  let res: Response
  try {
    res = await fetch(`http://127.0.0.1:${discovery.port}/kamucl-control/v1/${pathname}`, {
      method: body === undefined ? 'GET' : 'POST',
      signal: AbortSignal.timeout(timeoutMs),
      headers: body === undefined ? { 'X-Kamucl-Token': discovery.token } : { 'Content-Type': 'application/json', 'X-Kamucl-Token': discovery.token },
      body: body === undefined ? undefined : JSON.stringify(body)
    })
  } catch {
    return { ok: false, error: '控制服务无响应（游戏可能正在加载或已退出）' }
  }
  let data: ControlCallResult
  try {
    data = (await res.json()) as ControlCallResult
  } catch {
    return { ok: false, error: `控制服务响应异常（HTTP ${res.status}）` }
  }
  if (!res.ok) return { ok: false, error: data?.error || `HTTP ${res.status}` }
  return data
}
