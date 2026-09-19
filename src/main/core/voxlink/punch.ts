// SPDX-License-Identifier: LGPL-3.0-only
// KAMUCL implementation of VoxLink's five-byte punch protocol (Java upstream 721c7fae).
import dgram from 'node:dgram'
import { randomBytes } from 'node:crypto'
import { signPunchFrame, verifyPunchFrame } from './punchAuth'
export const PUNCH_INTERVAL_MS = 200, PUNCH_PER_ROUND = 3, PUNCH_TOTAL_TIMEOUT_MS = 12000, PUNCH_RECV_POLL_MS = 500
export function punchBuildControl(type: number, nonce: number): Buffer { const b = Buffer.from([86,76,type,0,0]); b.writeUInt16BE(nonce & 65535,3); return b }
export function punchParseControl(b: Buffer): { type: number; nonce: number } | null { return b.length === 5 && b[0] === 86 && b[1] === 76 && (b[2] === 1 || b[2] === 2) ? { type: b[2], nonce: b.readUInt16BE(3) } : null }
export const punchAckFor = (b: Buffer) => punchBuildControl(2, punchParseControl(b)?.nonce ?? 0)
export const punchRandomNonce = () => randomBytes(2).readUInt16BE()
type Address = { address: string; port: number }
export const punchAcceptSource = (a: { address: string } | null, b: { address: string } | null) => !!a && !!b && a.address === b.address
export async function udpSendTo(socket: dgram.Socket | null, data: Buffer, remote: Address | null): Promise<void> { if (socket && remote) await new Promise<void>((resolve,reject) => socket.send(data, remote.port, remote.address, error => error ? reject(error) : resolve())) }
export function predictedPortsAround(base: number, delta: number): number[] { const step = Math.min(64, Math.abs(Math.trunc(delta))); if (!step) return []; const ports: number[] = []; for (let n = step; n <= 64; n += step) for (const p of [base + n, base - n]) if (p > 0 && p <= 65535) ports.push(p); return ports }
/** Graded drift prediction: cone -> known port, small drift -> narrow, hard symmetric -> bounded progressive sweep. */
export function gradedPorts(base: number, delta: number, cycle: number): number[] {
  if (!delta) return []
  const hard = Math.abs(delta) > 100
  const ranges = hard ? [20,50,100,200,500] : [5,10,20,30,50]
  const range = ranges[Math.min(Math.max(0, cycle), ranges.length-1)]
  const step = Math.max(1, Math.min(Math.abs(Math.trunc(delta)), range))
  const ports = new Set<number>()
  for(let n=step;n<=range;n+=step)for(const p of [base+n,base-n])if(p>0&&p<=65535)ports.add(p)
  if(hard)for(let n=1;n<=range;n++)for(const p of [base+n,base-n])if(p>0&&p<=65535)ports.add(p)
  return [...ports]
}
export function punchStrategy(localDelta: number, remoteSymmetric: boolean, remoteDelta: number, cycle: number): 'forward' | 'reverse' | 'parallel' {
  if (!localDelta && !remoteSymmetric) return 'forward'
  if (!localDelta && remoteSymmetric) return cycle === 0 ? 'reverse' : 'parallel'
  if (localDelta && remoteSymmetric) return 'parallel'
  return cycle === 0 && Math.abs(localDelta) <= 100 ? 'reverse' : 'parallel'
}
export interface PuncherOptions { conn: dgram.Socket; timeoutMs?: number; authKey?: Buffer | null }
export class Puncher {
  readonly conn: dgram.Socket
  readonly nonce = punchRandomNonce()
  timeoutMs: number
  private remote: Address | null = null
  private ports: number[] = []
  private interval?: NodeJS.Timeout
  private timeout?: NodeJS.Timeout
  private active = false
  private cursor = 0
  private settled = false
  private notify?: (address: Address) => void
  private resolve!: (address: Address) => void
  private reject!: (error: Error) => void
  private result: Promise<Address>
  constructor(private options: PuncherOptions) { this.conn = options.conn; this.timeoutMs = options.timeoutMs ?? PUNCH_TOTAL_TIMEOUT_MS; this.result = new Promise((resolve,reject) => { this.resolve = resolve; this.reject = reject }); void this.result.catch(() => {}) }
  setOnPeer(callback: (address: Address) => void): void { this.notify = callback }
  setTarget(address: Address | null): void { this.remote = address }
  setPredictedPorts(ports: number[]): void { this.ports = [...new Set(ports)].filter(p => Number.isInteger(p) && p > 0 && p < 65536) }
  private message = (packet: Buffer, from: dgram.RemoteInfo): void => {
    if (!punchAcceptSource(this.remote, from)) return
    const verified = verifyPunchFrame(packet, this.options.authKey); const frame = verified && punchParseControl(verified)
    // VoxLink ACK carries the peer session nonce (not an echo of ours).
    if (!frame) return
    if (frame.type === 1) void udpSendTo(this.conn, signPunchFrame(punchBuildControl(2, frame.nonce), this.options.authKey), from).catch(() => {})
    if (!this.settled) { this.settled = true; this.cleanup(); const actual = { address: from.address, port: from.port }; this.resolve(actual); this.notify?.(actual) }
  }
  private send = (): void => {
    if (!this.remote) return
    // Cap this socket at 1000 packets/s, rotating wide sweeps rather than bursting 1000 ports each tick.
    const ports=[this.remote.port,...this.ports], count=Math.min(200,ports.length)
    const packet=signPunchFrame(punchBuildControl(1,this.nonce),this.options.authKey)
    for(let n=0;n<count;n++) {const port=ports[this.cursor++%ports.length];void udpSendTo(this.conn,packet,{address:this.remote.address,port}).catch(()=>{})}
  }
  start(): void { if (this.active || this.settled) return; this.active = true; this.conn.on('message', this.message); this.send(); this.interval = setInterval(this.send, PUNCH_INTERVAL_MS); this.timeout = setTimeout(() => { this.settled = true; this.cleanup(); this.reject(new Error('打洞超时')) }, this.timeoutMs) }
  wait(): Promise<Address> { return this.result }
  private cleanup(): void { clearInterval(this.interval); clearTimeout(this.timeout); this.conn.off('message',this.message); this.active = false }
  stop(): void { this.cleanup(); if (!this.settled) { this.settled = true; this.reject(new Error('打洞已取消')) } }
}
export async function punchListen(preferredPort: number): Promise<dgram.Socket> {
  async function bind(port: number): Promise<dgram.Socket> { const socket = dgram.createSocket('udp4'); try { await new Promise<void>((resolve,reject) => { socket.once('error',reject); socket.bind(port, () => { socket.off('error',reject); resolve() }) }); return socket } catch (e) { socket.close(); throw e } }
  if (Number.isInteger(preferredPort) && preferredPort > 0 && preferredPort <= 65535) try { return await bind(preferredPort) } catch {}
  return bind(0)
}
