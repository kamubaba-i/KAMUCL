/**
 * voxlink/stun.ts — RFC5389 STUN Binding 的最小实现（移植自 voxlink/app-desktop/stun.go）
 *
 * 帧格式：请求 20B：00 01 00 00 + magic cookie (21 12 A4 42) + 随机 12B txid（SOFTWARE 留空）
 * 响应解析 XOR-MAPPED-ADDRESS(0x0020/0x8020) / MAPPED-ADDRESS(0x0001)，
 * 端口 XOR 0x2112、IPv4 XOR 0x2112A44D（与 StunProbe.java 完全一致）。
 */
import dgram from 'node:dgram'
import crypto from 'node:crypto'

export const STUN_MAGIC_COOKIE = 0x2112a44d
export const STUN_REQ_TYPE = 0x0001
export const STUN_RESP_TYPE = 0x0101
export const STUN_HEADER_LEN = 20

/** 内嵌公共 STUN 服务器（与模组默认列表风格一致，4-6 个）。 */
export const STUN_SERVERS: string[] = [
  'stun.qq.com:3478',
  'stun.miwifi.com:3478',
  'stun1.l.google.com:19302',
  'stun2.l.google.com:19302',
  'stun.cloudflare.com:3478',
  'stun.syncthing.net:3478'
]

/** 一次 STUN 探测得到的映射地址。 */
const reachableServers = new Set<string>()
export interface StunMappedAddr {
  ip: string
  port: number
}

export function validMappedAddr(a: StunMappedAddr | null | undefined): boolean {
  return !!a && a.ip !== '' && a.port > 0
}

/** 构造 Binding Request（txid 嵌入 [8..20)）。 */
export function stunBuildRequest(): Buffer {
  const req = Buffer.alloc(STUN_HEADER_LEN)
  req.writeUInt16BE(STUN_REQ_TYPE, 0)
  req.writeUInt16BE(0, 2) // msg length = 0
  req.writeUInt32BE(STUN_MAGIC_COOKIE, 4)
  const rnd = crypto.randomBytes(12)
  rnd.copy(req, 8)
  return req
}

/** 校验响应：返回响应类型 + txid（[4..20)）；格式异常返回 null。 */
function stunParseResponseHeader(data: Buffer): { respType: number; txid: Buffer } | null {
  if (data.length < STUN_HEADER_LEN) return null
  const respType = data.readUInt16BE(0)
  const txid = data.subarray(4, 20)
  return { respType, txid }
}

/** 解析 XOR-MAPPED-ADDRESS。family=1 IPv4，family=2 IPv6。 */
function stunParseXorMapped(
  data: Buffer,
  off: number,
  attrLen: number,
  req: Buffer
): StunMappedAddr | null {
  if (attrLen < 8 || off + 8 > data.length) return null
  const family = data[off + 5]
  const xorPort = data.readUInt16BE(off + 6)
  const port = xorPort ^ (STUN_MAGIC_COOKIE >> 16)
  if (family === 1) {
    if (off + 12 > data.length) return null
    const xorIp = data.readUInt32BE(off + 8)
    const ip = xorIp ^ STUN_MAGIC_COOKIE
    return {
      ip: `${(ip >>> 24) & 0xff}.${(ip >>> 16) & 0xff}.${(ip >>> 8) & 0xff}.${ip & 0xff}`,
      port
    }
  }
  if (family === 2) {
    if (attrLen < 20 || off + 24 > data.length) return null
    const bytes = Buffer.alloc(16)
    for (let i = 0; i < 16; i++) bytes[i] = data[off + 8 + i] ^ req[4 + i]
    const parts: string[] = []
    for (let i = 0; i < 16; i += 2) {
      parts.push((bytes[i]! << 8 | bytes[i + 1]!).toString(16))
    }
    return { ip: parts.join(':'), port }
  }
  return null
}

/** 解析 MAPPED-ADDRESS（IPv4 only）。 */
function stunParseMapped(data: Buffer, off: number, attrLen: number): StunMappedAddr | null {
  if (attrLen < 8 || off + 12 > data.length) return null
  if (data[off + 5] !== 1) return null
  return {
    ip: `${data[off + 8]}.${data[off + 9]}.${data[off + 10]}.${data[off + 11]}`,
    port: data.readUInt16BE(off + 6)
  }
}

/** 解析一条响应，返回首个 MAPPED 类属性。 */
function stunParseResponse(data: Buffer, req: Buffer): StunMappedAddr | null {
  const hdr = stunParseResponseHeader(data)
  if (!hdr || hdr.respType !== STUN_RESP_TYPE) return null
  // txid 必须匹配
  for (let i = 0; i < 16; i++) {
    if (hdr.txid[i] !== req[4 + i]) return null
  }
  const msgLen = data.readUInt16BE(2)
  let offset = 20
  const max = data.length - 20
  let remain = Math.min(msgLen, max)
  while (offset + 4 <= data.length && offset - 20 < remain) {
    const attrType = data.readUInt16BE(offset)
    const attrLen = data.readUInt16BE(offset + 2)
    if (offset + 4 + attrLen > data.length) break
    if (attrType === 0x0020 || attrType === 0x8020) {
      const r = stunParseXorMapped(data, offset, attrLen, req)
      if (r) return r
    } else if (attrType === 0x0001) {
      const r = stunParseMapped(data, offset, attrLen)
      if (r) return r
    }
    offset += 4 + attrLen
    if (attrLen % 4 !== 0) offset += 4 - (attrLen % 4)
  }
  return null
}

/** 对单个 STUN 服务器发送请求，带重试，返回映射地址。 */
export async function stunQuery(
  uc: dgram.Socket,
  server: string,
  attempts: number,
  timeoutMs: number
): Promise<StunMappedAddr | null> {
  const [host, portStr] = server.split(':')
  const port = parseInt(portStr ?? '3478', 10)
  let lastErr: Error | null = null
  for (let i = 0; i < attempts; i++) {
    const req = stunBuildRequest()
    try {
      await udpWriteTo(uc, req, host!, port)
    } catch (e) {
      lastErr = e as Error
      continue
    }
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      const remain = Math.max(50, deadline - Date.now())
      try {
        const msg = await udpReadFrom(uc, remain)
        const addr = stunParseResponse(msg.data, req)
        if (addr) return addr
        // txid 不匹配（迟到的旧响应）继续读
      } catch (e) {
        lastErr = e as Error
        break
      }
    }
  }
  return null
}

/** 在同一 socket 上对最多 n 个可达服务器采样映射地址。 */
export async function stunSampleSeries(
  uc: dgram.Socket,
  servers: string[],
  n: number,
  tries: number,
  timeoutMs: number
): Promise<StunMappedAddr[]> {
  const limit = Math.max(0, Math.min(n, servers.length))
  const out: StunMappedAddr[] = []
  const ordered = [...servers].sort((a, b) => Number(reachableServers.has(b)) - Number(reachableServers.has(a)))
  for (const server of ordered) {
    if (out.length >= limit) break
    const a = await stunQuery(uc, server, tries, timeoutMs)
    if (a && validMappedAddr(a)) { reachableServers.add(server); out.push(a) }
    else reachableServers.delete(server)
  }
  return out
}

/** 同一 socket 多次采样的端口增量（末次 - 首次）。 */
export function stunDeltaFromSamples(samples: StunMappedAddr[]): number {
  if (samples.length < 2) return 0
  const first = samples[0]!.port
  const last = samples[samples.length - 1]!.port
  return last - first
}

/** 建房时的轻量探测：cone / symmetric / unknown。 */
export async function quickNatType(): Promise<string> {
  const uc = dgram.createSocket('udp4')
  try {
    const samples = await stunSampleSeries(uc, STUN_SERVERS, 2, 1, 1200)
    if (samples.length === 0) return 'unknown'
    if (stunDeltaFromSamples(samples) === 0) return 'cone'
    return 'symmetric'
  } catch {
    return 'unknown'
  } finally {
    uc.close()
  }
}

// ---- node:dgram 异步封装 ----

function udpWriteTo(uc: dgram.Socket, buf: Buffer, host: string, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    uc.send(buf, 0, buf.length, port, host, (err) => (err ? reject(err) : resolve()))
  })
}

function udpReadFrom(uc: dgram.Socket, timeoutMs: number): Promise<{ data: Buffer; rinfo: dgram.RemoteInfo }> {
  return new Promise((resolve, reject) => {
    let timer: NodeJS.Timeout | null = null
    const onMsg = (msg: Buffer, rinfo: dgram.RemoteInfo): void => {
      if (timer) clearTimeout(timer)
      uc.removeListener('error', onErr)
      resolve({ data: msg, rinfo })
    }
    const onErr = (err: Error): void => {
      if (timer) clearTimeout(timer)
      uc.removeListener('message', onMsg)
      reject(err)
    }
    uc.once('message', onMsg)
    uc.once('error', onErr)
    timer = setTimeout(() => {
      uc.removeListener('message', onMsg)
      uc.removeListener('error', onErr)
      reject(new Error('stun: timeout'))
    }, timeoutMs)
  })
}
