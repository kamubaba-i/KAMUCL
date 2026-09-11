// SPDX-License-Identifier: MIT
// RFC 5389 binding client implemented for KAMUCL; no desktop-port source used.
import dgram from 'node:dgram'
import { randomBytes } from 'node:crypto'
import { lookup } from 'node:dns/promises'
export const STUN_MAGIC_COOKIE = 0x2112a442, STUN_REQ_TYPE = 1, STUN_RESP_TYPE = 0x101, STUN_HEADER_LEN = 20
export const STUN_SERVERS = ['stun.qq.com:3478','stun.miwifi.com:3478','stun.cloudflare.com:3478','stun.l.google.com:19302']
export interface StunMappedAddr { ip: string; port: number }
export const validMappedAddr = (value: StunMappedAddr | null | undefined): boolean => !!value && !!value.ip && Number.isInteger(value.port) && value.port > 0 && value.port <= 65535
export function stunBuildRequest(): Buffer { const request = Buffer.alloc(20); request.writeUInt16BE(1); request.writeUInt32BE(STUN_MAGIC_COOKIE,4); randomBytes(12).copy(request,8); return request }
const preferred = new Set<string>()
export async function stunQuery(socket: dgram.Socket, server: string, attempts: number, timeoutMs: number): Promise<StunMappedAddr | null> {
  let remote: { address: string; port: number }
  try { const uri = new URL(`udp://${server}`); remote = { address: (await lookup(uri.hostname,{family:4})).address, port: Number(uri.port || 3478) } } catch { return null }
  for (let attempt = 0; attempt < attempts; attempt++) {
    const request = stunBuildRequest()
    const answer = await new Promise<StunMappedAddr | null>(resolve => {
      const finish = (value: StunMappedAddr | null) => { clearTimeout(timer); socket.off('message',message); socket.off('error',failed); socket.off('close',failed); resolve(value) }
      const failed = () => finish(null)
      const message = (packet: Buffer, from: dgram.RemoteInfo) => {
        if (from.address !== remote.address || from.port !== remote.port || packet.length < 20 || packet.readUInt16BE() !== STUN_RESP_TYPE || !packet.subarray(4,20).equals(request.subarray(4))) return
        const end = 20 + packet.readUInt16BE(2); if (end > packet.length) return
        for (let cursor = 20; cursor + 4 <= end;) {
          const type = packet.readUInt16BE(cursor), size = packet.readUInt16BE(cursor+2), start = cursor+4
          if (start + size > end) return
          if ((type === 1 || type === 0x20 || type === 0x8020) && size >= 8 && packet[start+1] === 1) {
            const mask = type === 1 ? 0 : STUN_MAGIC_COOKIE; const ip = (packet.readUInt32BE(start+4) ^ mask) >>> 0
            const value = { ip: [ip>>>24,(ip>>>16)&255,(ip>>>8)&255,ip&255].join('.'), port: packet.readUInt16BE(start+2) ^ (mask>>>16) }
            if (validMappedAddr(value)) finish(value); return
          }
          cursor = start + ((size + 3) & ~3)
        }
      }
      const timer = setTimeout(failed,timeoutMs)
      socket.on('message',message); socket.once('error',failed); socket.once('close',failed)
      try { socket.send(request,remote.port,remote.address,error => { if (error) failed() }) } catch { failed() }
    })
    if (answer) return answer
  }
  return null
}
export async function stunSampleSeries(socket: dgram.Socket, servers: string[], count: number, tries: number, timeoutMs: number): Promise<StunMappedAddr[]> {
  const samples: StunMappedAddr[] = []
  for (const server of [...servers].sort((a,b) => Number(preferred.has(b))-Number(preferred.has(a)))) { if (samples.length >= count) break; const result = await stunQuery(socket,server,tries,timeoutMs); if (result) { preferred.add(server); samples.push(result) } else preferred.delete(server) }
  return samples
}
export const stunDeltaFromSamples = (samples: StunMappedAddr[]) => samples.length > 1 ? samples[samples.length-1].port - samples[0].port : 0
export async function quickNatType(): Promise<string> { const socket = dgram.createSocket('udp4'); try { const samples = await stunSampleSeries(socket,STUN_SERVERS,2,1,1200); return samples.length < 2 ? 'unknown' : stunDeltaFromSamples(samples) ? 'symmetric' : 'cone' } finally { try { socket.close() } catch {} } }
