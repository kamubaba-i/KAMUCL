import { signPunchFrame, verifyPunchFrame } from './punchAuth'
/**
 * voxlink/rudp.ts — 可靠 UDP 隧道（移植自 voxlink/app-desktop/rudp.go，对齐
 * ReliableUdpTransport.java 的字节格式）
 *
 * 帧头 11B：56 4C + type(u8) + seq(u32 BE) + ack(u32 BE)
 * DATA/FEC_XOR 附加：payloadLen(u16 BE)；DATA 头 13B；FEC 头 13B + [13]=count
 * type: 1 PUNCH 2 PUNCH_ACK 3 DATA 4 ACK(纯11B)
 *       7 DISCONNECT 8 KEEPALIVE(11B，收到必回) 9 FEC_XOR 10 RESTART(忽略) 11 VOICE(忽略)
 *
 * 语义：累计 ACK（ack=nextExpectedSeq）、RTO RFC6298 夹 [100,800]ms、
 * 重传退避 rto+min(retries,3)*250、乱序窗口 128、<512B 小包首发 50ms 后复制重发一次、
 * KEEPALIVE 1s、静默>8s 降级、pending 且静默>24s 判死、>60s 硬超时。
 * FEC：发送按组 4 包 + XOR。
 */
import dgram from 'node:dgram'
import { EventEmitter } from 'node:events'

const MAGIC0 = 0x56
const MAGIC1 = 0x4c
export const RUDP_TYPE_PUNCH = 1
export const RUDP_TYPE_PUNCH_ACK = 2
export const RUDP_TYPE_DATA = 3
export const RUDP_TYPE_ACK = 4
export const RUDP_TYPE_DISCONNECT = 7
export const RUDP_TYPE_KEEPALIVE = 8
export const RUDP_TYPE_FEC_XOR = 9
export const RUDP_TYPE_RESTART = 10
export const RUDP_TYPE_VOICE = 11

const RUDP_HEADER_SIZE = 11
const RUDP_MAX_PAYLOAD = 1400
const RUDP_RECV_BUF_SIZE = 1500
const RUDP_FEC_GROUP_SIZE = 4
const RUDP_RECV_WINDOW = 128
const RUDP_BUF_CHUNKS_MAX = 512
const RUDP_SMALL_THRESH = 512
const RUDP_SMALL_DUP_DELAY_MS = 50

const RUDP_TICK_MS = 50
const RUDP_KEEPALIVE_EVERY_MS = 1000
const RUDP_RTO_MIN_MS = 100
const RUDP_RTO_MAX_MS = 800
const RUDP_INIT_RTO_MS = 200
const RUDP_BACKOFF_MS = 250
const RUDP_SILENCE_DEGRADE_MS = 8_000
const RUDP_SILENCE_DEAD_MS = 24_000
const RUDP_SILENCE_HARD_MS = 60_000
const RUDP_STUCK_WRITE_LIMIT_MS = 30_000

export interface RudpFrame {
  type: number
  seq: number
  ack: number
  payload: Buffer
  fecCount: number
  fecLengths: number[]
}

export function rudpEncode(f: RudpFrame): Buffer {
  switch (f.type) {
    case RUDP_TYPE_PUNCH:
    case RUDP_TYPE_PUNCH_ACK:
      return Buffer.from([MAGIC0, MAGIC1, f.type, (f.seq >> 8) & 0xff, f.seq & 0xff])
    case RUDP_TYPE_DATA: {
      const out = Buffer.alloc(13 + f.payload.length)
      out[0] = MAGIC0
      out[1] = MAGIC1
      out[2] = f.type
      out.writeUInt32BE(f.seq >>> 0, 3)
      out.writeUInt32BE(f.ack >>> 0, 7)
      out.writeUInt16BE(f.payload.length, 11)
      f.payload.copy(out, 13)
      return out
    }
    case RUDP_TYPE_FEC_XOR: {
      const count = f.fecLengths.length
      const bodyOff = 14 + count * 2
      const out = Buffer.alloc(bodyOff + f.payload.length)
      out[0] = MAGIC0
      out[1] = MAGIC1
      out[2] = f.type
      out.writeUInt32BE(f.seq >>> 0, 3) // seq 字段 = groupId
      out.writeUInt32BE(0, 7)
      out.writeUInt16BE(f.payload.length, 11)
      out[13] = count
      for (let i = 0; i < count; i++) out.writeUInt16BE(f.fecLengths[i]!, 14 + i * 2)
      f.payload.copy(out, bodyOff)
      return out
    }
    default: {
      const extra = f.type === RUDP_TYPE_VOICE ? f.payload.length : 0
      const out = Buffer.alloc(RUDP_HEADER_SIZE + extra)
      out[0] = MAGIC0
      out[1] = MAGIC1
      out[2] = f.type
      out.writeUInt32BE(f.seq >>> 0, 3)
      out.writeUInt32BE(f.ack >>> 0, 7)
      if (extra) f.payload.copy(out, RUDP_HEADER_SIZE)
      return out
    }
  }
}

export function rudpDecode(buf: Buffer): RudpFrame | null {
  if (buf.length < 3) return null
  if (buf[0] !== MAGIC0 || buf[1] !== MAGIC1) return null
  const type = buf[2]!
  switch (type) {
    case RUDP_TYPE_PUNCH:
    case RUDP_TYPE_PUNCH_ACK:
      if (buf.length < 5) return null
      return {
        type,
        seq: ((buf[3]! << 8) | buf[4]!) >>> 0,
        ack: 0,
        payload: Buffer.alloc(0),
        fecCount: 0,
        fecLengths: []
      }
    case RUDP_TYPE_DATA: {
      if (buf.length < 13) return null
      const pl = buf.readUInt16BE(11)
      if (13 + pl > buf.length) return null
      return {
        type,
        seq: buf.readUInt32BE(3),
        ack: buf.readUInt32BE(7),
        payload: Buffer.from(buf.subarray(13, 13 + pl)),
        fecCount: 0,
        fecLengths: []
      }
    }
    case RUDP_TYPE_FEC_XOR: {
      if (buf.length < 14) return null
      const xorLen = buf.readUInt16BE(11)
      const count = buf[13]!
      const xorOff = 14 + count * 2
      if (count < 0 || xorOff + xorLen > buf.length) return null
      const lengths: number[] = []
      for (let i = 0; i < count; i++) lengths.push(buf.readUInt16BE(14 + i * 2))
      return {
        type,
        seq: buf.readUInt32BE(3),
        ack: 0,
        payload: Buffer.from(buf.subarray(xorOff, xorOff + xorLen)),
        fecCount: count,
        fecLengths: lengths
      }
    }
    default:
      if (buf.length < RUDP_HEADER_SIZE) return null
      return {
        type,
        seq: buf.readUInt32BE(3),
        ack: buf.readUInt32BE(7),
        payload: Buffer.from(buf.subarray(RUDP_HEADER_SIZE)),
        fecCount: 0,
        fecLengths: []
      }
  }
}

interface PendingPacket {
  data: Buffer
  sendTime: number
  retries: number
}

export interface RudpTarget {
  address: string
  port: number
}

export type RudpCloseReason = string

/**
 * 一条可靠 UDP 会话，行为对齐 Go 端 rudpConn：实现字节流读/写、可被 TCP 桥搬运。
 */
export interface RudpCodec { encode(frame: Buffer): Buffer; decode(packet: Buffer): Buffer | null }
export interface RudpOptions { codec?: RudpCodec; authKey?: Buffer | null; ownsSocket?: boolean }
export class RudpConn extends EventEmitter {
  readonly conn: dgram.Socket
  private remote: RudpTarget | null

  // 发送侧
  private nextSeq = 0
  private oldestUnacked = 0
  private pending = new Map<number, PendingPacket>()
  private srtt = 0
  private rttvar = 0
  private rtoMs = RUDP_INIT_RTO_MS
  private window = 64
  private failures = 0
  private degraded = false
  private lastAckSeq = 0
  private dupAckCount = 0
  private fecSendGroup: Buffer[] = []
  private fecSendGroupID = -1
  private ackNotify: NodeJS.Timeout | null = null

  // 接收侧
  private nextExpected = 0
  private recvBuf = new Map<number, Buffer>()
  private buffered = 0
  private fecGroups = new Map<number, Map<number, Buffer>>()
  private fecXor = new Map<number, Buffer>()
  private fecLens = new Map<number, number[]>()
  private fecMinGroup = 0
  private fecHasMin = false
  private chunks: Buffer[] = []
  private dataWaiters = new Set<()=>void>()

  private lastRecv = Date.now()
  private closed = false
  private doneCh = false
  private closeMsg: RudpCloseReason | null = null
  private onClosed: ((reason: RudpCloseReason) => void) | null = null

  // 漂移重绑
  private recvHits = 0
  private driftPort = -1

  private recvHandler?: (msg: Buffer, rinfo: dgram.RemoteInfo) => void
  private errHandler?: (err: Error) => void

  constructor(conn: dgram.Socket, remote: RudpTarget | null, private options: RudpOptions = {}) {
    super()
    this.conn = conn
    this.remote = remote
  }

  isConnected(): boolean {
    return !this.closed
  }

  getRemote(): RudpTarget | null {
    return this.remote
  }

  setOnClosed(fn: (reason: RudpCloseReason) => void): void {
    this.onClosed = fn
  }

  /** 启动收发循环；连接建立第一件事：发一个 KEEPALIVE。 */
  start(): void {
    this.sendFrame({ type: RUDP_TYPE_KEEPALIVE, seq: 0, ack: 0, payload: Buffer.alloc(0), fecCount: 0, fecLengths: [] })
    this.startRecv()
    setTimeout(() => this.tickLoop(), RUDP_TICK_MS)
    setTimeout(() => this.keepaliveLoop(), RUDP_KEEPALIVE_EVERY_MS)
  }

  private startRecv(): void {
    this.recvHandler = (msg, rinfo): void => {
      if (this.options.codec && (rinfo.address !== this.remote?.address || rinfo.port !== this.remote?.port)) return
      const decoded = this.options.codec ? this.options.codec.decode(msg) : msg
      const verified = decoded && verifyPunchFrame(decoded, this.options.authKey)
      if (!verified) return
      const frame = rudpDecode(verified)
      if (frame && !this.options.codec) this.maybeRebindRemote({ address: rinfo.address, port: rinfo.port })
      if (frame) this.processFrame(frame)
    }
    this.errHandler = (): void => { /* ignore */ }
    this.conn.on('message', this.recvHandler)
    this.conn.on('error', this.errHandler)
  }

  private maybeRebindRemote(from: RudpTarget): void {
    const cur = this.remote
    if (!cur) {
      this.remote = from
      return
    }
    if (cur.port === from.port && cur.address === from.address) {
      this.recvHits = 0
      return
    }
    if (cur.address !== from.address) return
    if (this.driftPort === from.port) {
      this.recvHits += 1
      if (this.recvHits >= 2) {
        this.remote = from
        this.recvHits = 0
      }
    } else {
      this.driftPort = from.port
      this.recvHits = 1
    }
  }

  private processFrame(f: RudpFrame): void {
    switch (f.type) {
      case RUDP_TYPE_PUNCH:
        this.markRecv()
        this.sendFrame({ type: RUDP_TYPE_PUNCH_ACK, seq: 0, ack: 0, payload: Buffer.alloc(0), fecCount: 0, fecLengths: [] })
        break
      case RUDP_TYPE_PUNCH_ACK:
        this.markRecv()
        break
      case RUDP_TYPE_DATA:
        this.handleData(f)
        break
      case RUDP_TYPE_ACK:
        this.markRecv()
        this.processAck(f.ack)
        break
      case RUDP_TYPE_DISCONNECT:
        this.closeWith('对端断开')
        break
      case RUDP_TYPE_KEEPALIVE:
        this.markRecv()
        this.resetFailures()
        this.sendFrame({ type: RUDP_TYPE_ACK, seq: 0, ack: this.nextExpected, payload: Buffer.alloc(0), fecCount: 0, fecLengths: [] })
        break
      case RUDP_TYPE_FEC_XOR:
        this.markRecv()
        this.handleFecXor(f)
        break
      case RUDP_TYPE_RESTART:
        this.markRecv() // 忽略
        break
      case RUDP_TYPE_VOICE:
        this.markRecv() // 忽略
        break
    }
  }

  private handleData(f: RudpFrame): void {
    this.markRecv()
    this.processAck(f.ack)
    const payload = f.payload
    const seq = f.seq >>> 0
    const groupID = (seq / RUDP_FEC_GROUP_SIZE) >>> 0

    this.fecStoreLocked(groupID, seq, payload)

    const expected = this.nextExpected
    if (seq === expected) {
      if (this.buffered >= RUDP_BUF_CHUNKS_MAX) {
        this.sendAck()
        return
      }
      this.deliverLocked(payload)
      while (true) {
        const nxt = this.nextExpected
        const cached = this.recvBuf.get(nxt)
        if (!cached || this.buffered >= RUDP_BUF_CHUNKS_MAX) break
        this.recvBuf.delete(nxt)
        this.deliverLocked(cached)
      }
    } else if (seqAfter(seq, expected) && seqDiff(seq, expected) < RUDP_RECV_WINDOW) {
      if (!this.recvBuf.has(seq)) this.recvBuf.set(seq, payload)
    } else {
      this.sendAck()
      return
    }
    this.notifyData()
    this.sendAck()
    this.fecTryRecover(groupID)
  }

  private fecStoreLocked(groupID: number, seq: number, payload: Buffer): void {
    let g = this.fecGroups.get(groupID)
    if (!g) {
      g = new Map()
      this.fecGroups.set(groupID, g)
    }
    g.set(seq, payload)
    if (!this.fecHasMin || groupID < this.fecMinGroup) {
      this.fecMinGroup = groupID
      this.fecHasMin = true
    }
    if (this.fecGroups.size > 20) {
      const cutoff = this.fecMinGroup + 10
      for (const gid of Array.from(this.fecGroups.keys())) {
        if (gid < cutoff) {
          this.fecGroups.delete(gid)
          this.fecXor.delete(gid)
          this.fecLens.delete(gid)
        }
      }
      if (this.fecGroups.size > 0) {
        let minG = 0xffffffff
        for (const gid of this.fecGroups.keys()) if (gid < minG) minG = gid
        this.fecMinGroup = minG
      }
    }
  }

  private deliverLocked(payload: Buffer): void {
    this.chunks.push(payload)
    this.buffered += 1
    this.nextExpected = (this.nextExpected + 1) >>> 0
  }

  private fecTryRecover(groupID: number): void {
    const groupData = this.fecGroups.get(groupID)
    const xorPayload = this.fecXor.get(groupID)
    const origLens = this.fecLens.get(groupID)
    if (!groupData || !xorPayload || !origLens) return
    const startSeq = (groupID * RUDP_FEC_GROUP_SIZE) >>> 0
    let missingSeq = 0
    let missingIdx = -1
    let received = 0
    for (let i = 0; i < RUDP_FEC_GROUP_SIZE; i++) {
      const s = (startSeq + i) >>> 0
      if (groupData.has(s)) {
        received += 1
      } else if (seqAfter(this.nextExpected, s)) {
        received += 1
      } else {
        missingSeq = s
        missingIdx = i
      }
    }
    if (received === RUDP_FEC_GROUP_SIZE - 1 && missingIdx >= 0) {
      const recovered = Buffer.from(xorPayload)
      for (const p of groupData.values()) {
        const n = Math.min(p.length, recovered.length)
        for (let i = 0; i < n; i++) recovered[i]! ^= p[i]!
      }
      let origLen = recovered.length
      if (missingIdx < origLens.length) origLen = origLens[missingIdx]!
      const sliced = recovered.subarray(0, Math.min(origLen, recovered.length))
      if (this.buffered < RUDP_BUF_CHUNKS_MAX) {
        this.recvBuf.set(missingSeq, Buffer.from(sliced))
        while (true) {
          const nxt = this.nextExpected
          const cached = this.recvBuf.get(nxt)
          if (!cached || this.buffered >= RUDP_BUF_CHUNKS_MAX) break
          this.recvBuf.delete(nxt)
          this.deliverLocked(cached)
        }
      }
      this.fecGroups.delete(groupID)
      this.fecXor.delete(groupID)
      this.fecLens.delete(groupID)
    } else if (received === RUDP_FEC_GROUP_SIZE) {
      this.fecGroups.delete(groupID)
      this.fecXor.delete(groupID)
      this.fecLens.delete(groupID)
    }
  }

  private handleFecXor(f: RudpFrame): void {
    this.fecXor.set(f.seq >>> 0, f.payload)
    this.fecLens.set(f.seq >>> 0, f.fecLengths)
    this.fecTryRecover(f.seq >>> 0)
  }

  private sendAck(): void {
    this.sendFrame({ type: RUDP_TYPE_ACK, seq: 0, ack: this.nextExpected, payload: Buffer.alloc(0), fecCount: 0, fecLengths: [] })
  }

  private processAck(ackRaw: number): void {
    const ack = ackRaw >>> 0
    if (ack === this.lastAckSeq) {
      this.dupAckCount += 1
      if (this.dupAckCount >= 3 && this.pending.size > 0) {
        const pp = this.pending.get(this.oldestUnacked)
        if (pp && Date.now()-pp.sendTime >= RUDP_RTO_MIN_MS) {
          pp.sendTime = Date.now()
          pp.retries += 1
          this.sendDataPacket(this.oldestUnacked, pp.data, false)
        }
        this.dupAckCount = 0
      }
    } else {
      this.lastAckSeq = ack
      this.dupAckCount = 0
    }

    while (this.pending.size > 0 && seqAfter(ack, this.oldestUnacked)) {
      const pp = this.pending.get(this.oldestUnacked)
      if (pp) {
        if (pp.retries === 0) this.updateRto(Date.now() - pp.sendTime)
        this.pending.delete(this.oldestUnacked)
      }
      this.oldestUnacked = (this.oldestUnacked + 1) >>> 0
      this.failures = 0
      this.degraded = false
    }
    this.notifyAck()
  }

  private updateRto(sampleMs: number): void {
    if (sampleMs <= 0) return
    const s = sampleMs
    if (this.srtt <= 0) {
      this.srtt = s
      this.rttvar = s / 2
    } else {
      this.rttvar = (3 * this.rttvar + Math.abs(this.srtt - s)) / 4
      this.srtt = (7 * this.srtt + s) / 8
    }
    let rto = Math.round(this.srtt + Math.max(10, 4 * this.rttvar))
    if (rto < RUDP_RTO_MIN_MS) rto = RUDP_RTO_MIN_MS
    if (rto > RUDP_RTO_MAX_MS) rto = RUDP_RTO_MAX_MS
    this.rtoMs = rto
  }

  private resetFailures(): void {
    this.failures = 0
    this.degraded = false
  }

  private sendDataPacket(seq: number, payload: Buffer, first: boolean): void {
    this.sendFrame({
      type: RUDP_TYPE_DATA,
      seq: seq >>> 0,
      ack: this.nextExpected,
      payload,
      fecCount: 0,
      fecLengths: []
    })
    if (first && payload.length < RUDP_SMALL_THRESH && !this.degraded) {
      const dup = Buffer.from(payload)
      setTimeout(() => {
        if (this.closed) return
        this.sendFrame({
          type: RUDP_TYPE_DATA,
          seq: seq >>> 0,
          ack: this.nextExpected,
          payload: dup,
          fecCount: 0,
          fecLengths: []
        })
      }, RUDP_SMALL_DUP_DELAY_MS)
    }
  }

  private sendFecFrame(groupID: number, xorPayload: Buffer, lengths: number[]): void {
    this.sendFrame({
      type: RUDP_TYPE_FEC_XOR,
      seq: groupID >>> 0,
      ack: 0,
      payload: xorPayload,
      fecCount: lengths.length,
      fecLengths: lengths
    })
  }

  private sendFrame(f: RudpFrame): void {
    if (this.closed) return
    const addr = this.remote
    if (!addr) return
    const raw = signPunchFrame(rudpEncode(f), this.options.authKey)
    const buf = this.options.codec ? this.options.codec.encode(raw) : raw
    this.conn.send(buf, 0, buf.length, addr.port, addr.address, () => { /* ignore */ })
  }

  private notifyData(): void {
    for(const wake of this.dataWaiters)wake()
    this.dataWaiters.clear()
  }

  private notifyAck(): void {
    this.emit('ack-ready')
  }

  /** 写一个分片：窗口控制 → 登记 pending → 发 DATA → FEC 组管理。 */
  async writeChunk(chunk: Buffer): Promise<void> {
    let stuckStart = 0
    let stuckBase = 0
    while (seqDiff(this.nextSeq, this.oldestUnacked) >= this.window) {
      if (this.closed) throw new Error('rudp: 连接已关闭')
      await new Promise<void>((resolve) => {
        const timer = setTimeout(finish, 1000)
        function finish(): void {
          clearTimeout(timer)
          cleanup()
          resolve()
        }
        const cleanup=()=>this.off('ack-ready',finish)
        this.once('ack-ready',finish)
      })
      if (this.closed) throw new Error('rudp: 连接已关闭')
      const now = Date.now()
      if (stuckStart === 0 || this.oldestUnacked !== stuckBase) {
        stuckStart = now
        stuckBase = this.oldestUnacked
      } else if (now - stuckStart >= RUDP_STUCK_WRITE_LIMIT_MS) {
        this.closeWith('传输停滞')
        throw new Error('rudp: 传输停滞（对端无响应）')
      }
    }
    if(this.closed)throw new Error('rudp: 连接已关闭')
    const seq = this.nextSeq
    this.nextSeq = (this.nextSeq + 1) >>> 0
    const data = Buffer.from(chunk)
    this.pending.set(seq, { data, sendTime: Date.now(), retries: 0 })
    this.sendDataPacket(seq, data, true)

    const groupID = Math.floor(seq / RUDP_FEC_GROUP_SIZE)
    if (groupID !== this.fecSendGroupID) {
      this.fecSendGroup = []
      this.fecSendGroupID = groupID
    }
    this.fecSendGroup.push(data)
    if (this.fecSendGroup.length === RUDP_FEC_GROUP_SIZE) {
      const group = this.fecSendGroup.slice()
      const lengths = group.map((b) => b.length)
      this.fecSendGroup = []
      this.sendFecFrame(groupID, computeXorPayload(group), lengths)
    }
  }

  /** 实现 io.Writer：按 1400 分片写入隧道。 */
  async write(p: Buffer | Uint8Array): Promise<number> {
    const buf = Buffer.isBuffer(p) ? p : Buffer.from(p)
    let written = 0
    while (written < buf.length) {
      const end = Math.min(written + RUDP_MAX_PAYLOAD, buf.length)
      await this.writeChunk(buf.subarray(written, end))
      written = end
    }
    return written
  }

  private tickLoop(): void {
    if (this.closed) return
    const now = Date.now()
    const silence = now - this.lastRecv

    if (this.pending.size > 0) {
      if (this.failures >= 5 && silence > RUDP_SILENCE_DEGRADE_MS) this.degraded = true
      if (silence > RUDP_SILENCE_DEAD_MS) {
        this.closeWith('静默超24s且有待确认包，判对端已死')
        return
      }
    }
    if (silence > RUDP_SILENCE_HARD_MS) {
      this.closeWith('静默超60s')
      return
    }

    const rtoBase = Math.max(this.rtoMs, RUDP_RTO_MIN_MS)
    let maxRetrans = Math.floor(24000 / rtoBase)
    if (maxRetrans > 120) maxRetrans = 120
    if (maxRetrans < 10) maxRetrans = 10

    for (const [seq, pp] of this.pending) {
      const backoff = (this.rtoMs + Math.min(pp.retries, 3) * RUDP_BACKOFF_MS)
      if (now - pp.sendTime <= backoff) continue
      if (pp.retries >= maxRetrans) {
        this.closeWith(`seq ${seq} 重传超限`)
        return
      }
      pp.sendTime = now
      pp.retries += 1
      this.failures += 1
      this.sendDataPacket(seq, pp.data, false)
    }
    setTimeout(() => this.tickLoop(), RUDP_TICK_MS)
  }

  private keepaliveLoop(): void {
    if (this.closed) return
    this.sendFrame({
      type: RUDP_TYPE_KEEPALIVE,
      seq: 0,
      ack: this.nextExpected,
      payload: Buffer.alloc(0),
      fecCount: 0,
      fecLengths: []
    })
    setTimeout(() => this.keepaliveLoop(), RUDP_KEEPALIVE_EVERY_MS)
  }

  /** 实现 io.Reader：阻塞读取按序到达的载荷块。连接关闭后队列排空返回 io.EOF。 */
  async read(p: Buffer | Uint8Array): Promise<number> {
    const buf = Buffer.isBuffer(p) ? p : Buffer.from(p)
    if (buf.length === 0) return 0
    while (true) {
      if (this.chunks.length > 0) {
        const chunk = this.chunks[0]!
        const n = Math.min(buf.length, chunk.length)
        chunk.copy(buf, 0, 0, n)
        if (n === chunk.length) {
          this.chunks.shift()
          this.buffered -= 1
        } else {
          this.chunks[0] = chunk.subarray(n)
        }
        return n
      }
      if (this.closed) return 0
      await new Promise<void>((resolve) => {
        this.dataWaiters.add(resolve)
      })
    }
  }

  private markRecv(): void {
    this.lastRecv = Date.now()
  }

  closeWith(reason: RudpCloseReason): void {
    if (this.closeMsg === null) this.closeMsg = reason
    this.close()
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    if (this.remote) {
      const raw = signPunchFrame(rudpEncode({ type: RUDP_TYPE_DISCONNECT, seq: 0, ack: 0, payload: Buffer.alloc(0), fecCount: 0, fecLengths: [] }), this.options.authKey)
      const buf = this.options.codec ? this.options.codec.encode(raw) : raw
      try {
        this.conn.send(buf, 0, buf.length, this.remote.port, this.remote.address, () => { /* ignore */ })
      } catch { /* ignore */ }
    }
    if (this.recvHandler) this.conn.removeListener('message', this.recvHandler)
    if (this.errHandler) this.conn.removeListener('error', this.errHandler)
    try { if (this.options.ownsSocket !== false) this.conn.close() } catch { /* ignore */ }
    this.notifyData()
    this.notifyAck()
    this.emit('closed')
    if (this.onClosed && !this.doneCh) {
      this.doneCh = true
      const msg = this.closeMsg ?? 'closed'
      setTimeout(() => this.onClosed?.(msg), 0)
    }
  }
}

/** 多包异或（按最长长度逐字节异或）。 */
function computeXorPayload(payloads: Buffer[]): Buffer {
  let maxLen = 0
  for (const p of payloads) if (p.length > maxLen) maxLen = p.length
  const xor = Buffer.alloc(maxLen)
  for (const p of payloads) for (let i = 0; i < p.length; i++) xor[i]! ^= p[i]!
  return xor
}

/** seq 运算：seqAfter / seqDiff（模 2^32）。 */
export function seqAfter(a: number, b: number): boolean {
  const diff = (a - b) >>> 0
  return diff > 0 && diff < 0x80000000
}

export function seqDiff(newer: number, older: number): number {
  return (newer - older) >>> 0
}
