// SPDX-License-Identifier: LGPL-3.0-only
// New Node transport for the documented wire layout of VoxLink 1.1.5,
// ReliableUdpTransport.java at 6b11d93 (AUGUHDAR/VoxLink contributors).
// No app-desktop Go implementation retained. See THIRD_PARTY_NOTICES.md.
import dgram from 'node:dgram'
import { EventEmitter } from 'node:events'
import { signPunchFrame, verifyPunchFrame } from './punchAuth'
export const RUDP_TYPE_PUNCH=1, RUDP_TYPE_PUNCH_ACK=2, RUDP_TYPE_DATA=3, RUDP_TYPE_ACK=4, RUDP_TYPE_DISCONNECT=7, RUDP_TYPE_KEEPALIVE=8, RUDP_TYPE_FEC_XOR=9, RUDP_TYPE_RESTART=10, RUDP_TYPE_VOICE=11
export interface RudpFrame { type:number; seq:number; ack:number; payload:Buffer; fecCount:number; fecLengths:number[] }
export interface RudpTarget { address:string; port:number }
export interface RudpCodec { encode(frame:Buffer):Buffer; decode(packet:Buffer):Buffer|null }
export interface RudpOptions { codec?:RudpCodec; authKey?:Buffer|null; ownsSocket?:boolean }
export type RudpCloseReason=string
export const seqDiff=(a:number,b:number)=>(a-b)>>>0
export const seqAfter=(a:number,b:number)=>seqDiff(a,b)>0&&seqDiff(a,b)<0x80000000
export function rudpEncode(f:RudpFrame):Buffer {
  const count=f.type===9?f.fecLengths.length:0
  const offset=f.type===9?14+count*2:f.type===3?13:11
  const packet=Buffer.alloc(offset+f.payload.length)
  packet[0]=86;packet[1]=76;packet[2]=f.type;packet.writeUInt32BE(f.seq>>>0,3);packet.writeUInt32BE(f.ack>>>0,7)
  if(f.type===3||f.type===9)packet.writeUInt16BE(f.payload.length,11)
  if(f.type===9){packet[13]=count;f.fecLengths.forEach((size,i)=>packet.writeUInt16BE(size,14+2*i))}
  f.payload.copy(packet,offset);return packet
}
export function rudpDecode(packet:Buffer):RudpFrame|null {
  if(packet.length<11||packet[0]!==86||packet[1]!==76)return null
  const type=packet[2];let offset=11,length=packet.length-11,count=0;const lengths:number[]=[]
  if(type===3||type===9){if(packet.length<13)return null;length=packet.readUInt16BE(11);offset=13}
  if(type===9){if(packet.length<14)return null;count=packet[13];if(count<1||count>20)return null;offset=14+count*2;if(packet.length<offset)return null;for(let i=0;i<count;i++)lengths.push(packet.readUInt16BE(14+2*i))}
  if(length>1400||packet.length!==offset+length)return null
  return {type,seq:packet.readUInt32BE(3),ack:packet.readUInt32BE(7),payload:packet.subarray(offset),fecCount:count,fecLengths:lengths}
}
export class RudpConn extends EventEmitter {
  private running=false;private ended=false;private lastRx=Date.now();private lastPing=0
  private nextSend=0;private nextRead=0;private pending=new Map<number,{data:Buffer;sent:number;created:number}>()
  private reordered=new Map<number,Buffer>();private incoming:Buffer[]=[];private queuedBytes=0
  private timer:ReturnType<typeof setInterval>|undefined
  private writers:Promise<unknown>=Promise.resolve();private readers:Promise<unknown>=Promise.resolve()
  private onClosed:((reason:string)=>void)|undefined
  private changed=new Set<()=>void>()
  constructor(private socket:dgram.Socket,private remote:RudpTarget|null,private options:RudpOptions={}){super()}
  isConnected():boolean{return this.running&&!this.ended}
  getRemote():RudpTarget|null{return this.remote}
  setOnClosed(fn:(reason:string)=>void):void{this.onClosed=fn}
  private wake():void{for(const fn of this.changed)fn();this.changed.clear()}
  private wait():Promise<void>{return new Promise(resolve=>this.changed.add(resolve))}
  private send(type:number,payload:Buffer=Buffer.alloc(0),seq=0):void {
    if(this.ended||!this.remote)return
    let packet=signPunchFrame(rudpEncode({type,seq,ack:this.nextRead,payload,fecCount:0,fecLengths:[]}),this.options.authKey)
    if(this.options.codec)packet=this.options.codec.encode(packet)
    this.socket.send(packet,this.remote.port,this.remote.address,error=>{if(error)this.closeWith(error.message)})
  }
  private receive=(packet:Buffer,from:dgram.RemoteInfo):void=>{
    if(this.ended||!this.remote||from.address!==this.remote.address||from.port!==this.remote.port)return
    const decoded=this.options.codec?this.options.codec.decode(packet):packet
    if(!decoded)return
    const raw=verifyPunchFrame(decoded,this.options.authKey);if(!raw)return
    const f=rudpDecode(raw);if(!f)return
    this.lastRx=Date.now()
    // Reject ACKs beyond the sequence actually transmitted.
    if(!seqAfter(f.ack,this.nextSend))for(const seq of this.pending.keys())if(seqAfter(f.ack,seq))this.pending.delete(seq)
    if(f.type===RUDP_TYPE_DISCONNECT){this.closeWith('对端断开');return}
    if(f.type===RUDP_TYPE_RESTART){this.emit('restart');return}
    if(f.type===RUDP_TYPE_VOICE){this.emit('voice',f.payload);return}
    if(f.type===RUDP_TYPE_DATA){
      const ahead=seqDiff(f.seq,this.nextRead)
      if(ahead<512&&!this.reordered.has(f.seq)&&this.queuedBytes+f.payload.length<8*1024*1024)this.reordered.set(f.seq,Buffer.from(f.payload))
      while(this.reordered.has(this.nextRead)&&this.incoming.length<512){const data=this.reordered.get(this.nextRead)!;this.reordered.delete(this.nextRead);this.nextRead=(this.nextRead+1)>>>0;this.incoming.push(data);this.queuedBytes+=data.length}
      this.send(RUDP_TYPE_ACK)
    }
    // ACK/keepalive are not echoed, preventing two peers from amplifying traffic.
    this.wake()
  }
  private socketError=(error:Error):void=>this.closeWith(error.message)
  start():void {
    if(this.running||this.ended)return
    this.running=true;this.lastRx=Date.now();this.socket.on('message',this.receive);this.socket.on('error',this.socketError)
    this.timer=setInterval(()=>{
      const now=Date.now()
      if(now-this.lastRx>60000){this.closeWith('对端连接超时');return}
      for(const [seq,entry]of this.pending){if(now-entry.created>24000){this.closeWith('可靠传输重试超时');return}if(now-entry.sent>=400){entry.sent=now;this.send(RUDP_TYPE_DATA,entry.data,seq)}}
      if(now-this.lastPing>=1000){this.lastPing=now;this.send(RUDP_TYPE_KEEPALIVE)}
    },50)
    this.send(RUDP_TYPE_KEEPALIVE)
  }
  async writeChunk(data:Buffer):Promise<void>{await this.write(data)}
  write(data:Buffer|Uint8Array):Promise<number>{
    const copy=Buffer.from(data)
    const job=this.writers.then(async()=>{
      for(let offset=0;offset<copy.length;offset+=1400){
        while(this.pending.size>=64&&!this.ended)await this.wait()
        if(this.ended)throw new Error('连接已关闭')
        const seq=this.nextSend;this.nextSend=(seq+1)>>>0;const part=copy.subarray(offset,offset+1400),now=Date.now()
        this.pending.set(seq,{data:part,sent:now,created:now});this.send(RUDP_TYPE_DATA,part,seq)
      }
      return copy.length
    });this.writers=job.catch(()=>{});return job
  }
  read(target:Buffer|Uint8Array):Promise<number>{
    const job=this.readers.then(async()=>{
      while(!this.incoming.length&&!this.ended)await this.wait()
      if(!this.incoming.length)return 0
      const head=this.incoming[0],size=Math.min(target.length,head.length);target.set(head.subarray(0,size));this.queuedBytes-=size
      if(size===head.length)this.incoming.shift();else this.incoming[0]=head.subarray(size)
      while(this.reordered.has(this.nextRead)&&this.incoming.length<512){const data=this.reordered.get(this.nextRead)!;this.reordered.delete(this.nextRead);this.nextRead=(this.nextRead+1)>>>0;this.incoming.push(data);this.queuedBytes+=data.length}
      this.send(RUDP_TYPE_ACK);return size
    });this.readers=job.catch(()=>{});return job
  }
  closeWith(reason:string):void{
    if(this.ended)return
    this.send(RUDP_TYPE_DISCONNECT);this.ended=true;this.running=false;clearInterval(this.timer)
    this.socket.off('message',this.receive);this.socket.off('error',this.socketError)
    if(this.options.ownsSocket!==false)try{this.socket.close()}catch{}
    this.pending.clear();this.reordered.clear();this.wake();this.emit('closed',reason);this.onClosed?.(reason)
  }
  close():void{this.closeWith('连接已关闭')}
}
