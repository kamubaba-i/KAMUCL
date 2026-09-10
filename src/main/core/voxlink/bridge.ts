/**
 * voxlink/bridge.ts — 本地端口映射桥：把本地 TCP 连接字节流与 rudp DATA 双向搬运
 * （移植自 voxlink/app-desktop/bridge.go）
 *
 *   - guest：rudp 就绪后 net.Listen("tcp","127.0.0.1:0")，MC 一连上本地桥就立刻把
 *     握手字节送进隧道（host 桥 lazy 依赖这个）；单客户端语义：新 MC 连入关闭旧的。
 *   - host：lazy 桥——等隧道第一个 DATA（MC 握手字节）到达才 Dial 127.0.0.1:<hostPort>
 *     （失败每 1s 重试，10s 窗口）；30s 零流量 watchdog 拆桥，之后下一段 DATA 再重拨。
 */
import net from 'node:net'
import type { RudpConn } from './rudp'

export const BRIDGE_BUF_SIZE = 32 * 1024
export const BRIDGE_IDLE_TIMEOUT_MS = 30_000
export const BRIDGE_DIAL_WINDOW_MS = 10_000
export const BRIDGE_DIAL_RETRY_MS = 1000
export const BRIDGE_DIAL_TIMEOUT_MS = 2000

export type BridgeDownCb = () => void
export type LogFn = (level: 'info' | 'warn' | 'error', msg: string) => void

/** 一条 MC TCP 连接 ↔ rudp 会话的搬运桥。 */
export class TcpBridge {
  readonly rc: RudpConn
  ln: net.Server | null = null
  tcp: net.Socket | null = null
  private lastAct = Date.now()
  private stopped = false
  private stopCh = false
  private downCb: BridgeDownCb | null

  constructor(rc: RudpConn, downCb: BridgeDownCb | null) {
    this.rc = rc
    this.downCb = downCb
  }

  touch(): void {
    this.lastAct = Date.now()
  }

  idleMs(): number {
    return Date.now() - this.lastAct
  }

  /** 关闭监听与当前 TCP 连接（不动 rudp 会话本身）。幂等。 */
  stop(): void {
    if (this.stopped) return
    this.stopped = true
    this.stopCh = true
    if (this.ln) {
      try { this.ln.close() } catch { /* ignore */ }
    }
    if (this.tcp) {
      try { this.tcp.destroy() } catch { /* ignore */ }
    }
  }

  isStopped(): boolean {
    return this.stopCh
  }

  /** guest 模式：监听 127.0.0.1 随机端口，返回本地代理地址。 */
  static async startGuest(rc: RudpConn, downCb: BridgeDownCb): Promise<{ addr: string; bridge: TcpBridge }> {
    const bridge = new TcpBridge(rc, downCb)
    const ln = net.createServer((conn) => {
      if (bridge.isStopped() || bridge.tcp) { conn.destroy(); return }
      conn.setNoDelay(true)
      bridge.setConn(conn, null)
      void bridge.pump(conn)
    })
    await new Promise<void>((resolve, reject) => {
      ln.once('error', reject)
      ln.listen(0, '127.0.0.1', () => {
        ln.removeListener('error', reject)
        resolve()
      })
    })
    bridge.ln = ln
    bridge.touch()
    rc.setOnClosed(() => bridge.stop())
    const addr = ln.address() as net.AddressInfo
    return { addr: `127.0.0.1:${addr.port}`, bridge }
  }

  setConn(conn: net.Socket, old: net.Socket | null): void {
    if (old) {
      try { old.destroy() } catch { /* ignore */ }
    }
    this.tcp = conn
    this.touch()
  }

  /** 双向搬运：TCP → rudp、rudp → TCP。任一方向出错即双向退出。 */
  async pump(conn: net.Socket): Promise<void> {
    let stopped = false
    const stopBoth = (): void => {
      if (stopped) return
      stopped = true
      try { conn.destroy() } catch { /* ignore */ }
      this.stop()
    }

    const tcpToRudp = (async (): Promise<void> => {
      const b = Buffer.alloc(BRIDGE_BUF_SIZE)
      try {
        while (true) {
          const n = await readSocket(conn, b)
          if (n === 0) return
          this.touch()
          await this.rc.write(b.subarray(0, n))
          if (this.stopCh) return
        }
      } catch {
        stopBoth()
      }
    })()

    const rudpToTcp = (async (): Promise<void> => {
      const b = Buffer.alloc(BRIDGE_BUF_SIZE)
      try {
        while (true) {
          const n = await this.rc.read(b)
          if (n === 0) return
          this.touch()
          await writeSocket(conn, b.subarray(0, n))
          if (this.stopCh) return
        }
      } catch {
        stopBoth()
      }
    })()

    await Promise.race([tcpToRudp, rudpToTcp])
    stopBoth()
    if (this.downCb) {
      try { this.downCb() } catch { /* ignore */ }
    }
  }

  /** 30s 零流量返回 true（调用方拆桥）。 */
  async watchdogOnce(): Promise<boolean> {
    while (true) {
      await sleep(5000)
      if (this.stopCh) return false
      if (this.idleMs() > BRIDGE_IDLE_TIMEOUT_MS) return true
    }
  }
}

/** host 侧：等隧道第一个 DATA（MC 握手字节）到达才拨号本地 MC 端口。 */
export async function startHostLazyBridge(rc: RudpConn, hostPort: number, logf: LogFn | null): Promise<void> {
  const buf = Buffer.alloc(BRIDGE_BUF_SIZE)
  while (true) {
    let n = 0
    try {
      n = await rc.read(buf)
    } catch {
      return
    }
    if (n === 0) return
    const conn = await dialLocalMC(hostPort, rc, logf)
    if (!conn) {
      logf?.('error', 'host 桥：无法连接本地 MC 端口，关闭该条隧道')
      rc.close()
      return
    }
    const bridge = new TcpBridge(rc, null)
    bridge.setConn(conn, null)
    rc.setOnClosed(() => bridge.stop())
    // 首包（MC 握手字节）先写入，再进入双向搬运
    try { await writeSocket(conn, buf.subarray(0, n)) } catch {
      try { conn.destroy() } catch { /* ignore */ }
      rc.close()
      return
    }
    const pumpPromise = bridge.pump(conn)
    const idle = await bridge.watchdogOnce()
    bridge.stop()
    await pumpPromise.catch(() => { /* ignore */ })
    if (!idle) return
    logf?.('info', 'host 桥：长时间无流量，拆桥待重拨')
  }
}

/** 中继者流搬运桥：host rudp ↔ target rudp 两条会话互拷字节。 */
export function pumpRelay(hostRc: RudpConn, targetRc: RudpConn): () => void {
  let stopped = false
  const stopFn = (): void => {
    if (stopped) return
    stopped = true
    try { hostRc.close() } catch { /* ignore */ }
    try { targetRc.close() } catch { /* ignore */ }
  }

  const hostToTarget = (async (): Promise<void> => {
    const b = Buffer.alloc(BRIDGE_BUF_SIZE)
    try {
      while (true) {
        const n = await hostRc.read(b)
        if (n === 0) return
        await targetRc.write(b.subarray(0, n))
      }
    } catch {
      stopFn()
    }
  })()

  const targetToHost = (async (): Promise<void> => {
    const b = Buffer.alloc(BRIDGE_BUF_SIZE)
    try {
      while (true) {
        const n = await targetRc.read(b)
        if (n === 0) return
        await hostRc.write(b.subarray(0, n))
      }
    } catch {
      stopFn()
    }
  })()

  Promise.race([hostToTarget, targetToHost]).then(stopFn)
  return stopFn
}

async function dialLocalMC(hostPort: number, rc: RudpConn, logf: LogFn | null): Promise<net.Socket | null> {
  const deadline = Date.now() + BRIDGE_DIAL_WINDOW_MS
  while (true) {
    let d = BRIDGE_DIAL_TIMEOUT_MS
    const remain = deadline - Date.now()
    if (remain < d) d = remain
    if (d <= 0) return null
    const conn = await new Promise<net.Socket | null>((resolve) => {
      const sock = net.createConnection({ host: '127.0.0.1', port: hostPort })
      let done = false
      const onError = (): void => {
        if (done) return
        done = true
        try { sock.destroy() } catch { /* ignore */ }
        resolve(null)
      }
      const onConnect = (): void => {
        if (done) return
        done = true
        sock.removeListener('error', onError)
        try { sock.setNoDelay(true) } catch { /* ignore */ }
        resolve(sock)
      }
      sock.setTimeout(d)
      sock.once('error', onError)
      sock.once('timeout', onError)
      sock.once('connect', onConnect)
    })
    if (conn) return conn
    logf?.('warn', 'host 桥：连接本地 MC 端口失败，稍后重试')
    if (Date.now() + BRIDGE_DIAL_RETRY_MS > deadline) return null
    await sleep(BRIDGE_DIAL_RETRY_MS)
  }
}

function readSocket(s: net.Socket, buf: Buffer): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const onReadable = (): void => {
      try {
        const chunk = s.read(Math.min(buf.length, s.readableLength) || undefined)
        if (chunk !== null) {
          const n = chunk.copy(buf, 0, 0, buf.length)
          if (chunk.length > n) s.unshift(chunk.subarray(n))
          cleanup()
          resolve(n)
        }
      } catch (e) {
        cleanup()
        reject(e as Error)
      }
    }
    const onError = (err: Error): void => {
      cleanup()
      reject(err)
    }
    const onEnd = (): void => {
      cleanup()
      resolve(0)
    }
    const cleanup = (): void => {
      s.removeListener('readable', onReadable)
      s.removeListener('error', onError)
      s.removeListener('end', onEnd)
      s.removeListener('close', onEnd)
    }
    s.on('readable', onReadable)
    s.once('error', onError)
    s.once('end', onEnd)
    s.once('close', onEnd)
    if (s.destroyed || s.readableEnded) onEnd()
    else onReadable()
  })
}

function writeSocket(s: net.Socket, buf: Buffer): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (s.destroyed) return resolve()
    const ok = s.write(buf, (err) => {
      if (err) reject(err)
    })
    if (ok) resolve()
    else s.once('drain', () => resolve())
  })
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
