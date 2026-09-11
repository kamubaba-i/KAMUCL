// SPDX-License-Identifier: LGPL-3.0-only
// KAMUCL session implementation using the VoxLink Java signaling protocol, revision 6b11d93.
import { EventEmitter } from 'node:events'
import { ApiClient, APIError } from './api'
export interface SessionOptions { code: string; token: string; isHost: boolean }
export interface SignalMsg { id?: unknown; from: string; type: string; data: Record<string,unknown>; timestamp: number; to?: string }
export interface SessionState extends SessionOptions { state: 'idle' | 'hosting' | 'in_room' | 'closed'; room: Record<string,unknown> | null }
export type LogFn = (level: 'info'|'warn'|'error', message: string) => void
export type EmitFn = (event: string, data: unknown) => void
export interface WsFrame { id: number; success: boolean; data?: unknown; error?: string; message?: string }
export class VoxlinkSession extends EventEmitter {
  readonly code: string; readonly token: string; readonly isHost: boolean
  private finished = false
  private running = false
  private finish!: () => void
  private done = new Promise<void>(resolve => { this.finish = resolve })
  private since = Date.now()
  private socket?: WebSocket
  private reconnectAt = 0
  private nextId = 1
  private pending = new Map<number,{resolve:(value:unknown)=>void;reject:(error:Error)=>void;timer:NodeJS.Timeout}>()
  constructor(readonly app: { api: ApiClient; baseURL: () => string; emit: EmitFn; netLog: LogFn }, options: SessionOptions) { super(); this.code=options.code;this.token=options.token;this.isHost=options.isHost }
  isDone(): boolean { return this.finished }
  getDone(): Promise<void> { return this.done }
  snapshotRoom(): Record<string,unknown> | null { return null }
  stop(): void { if(this.finished)return; this.finished=true; this.socket?.close(); for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(new Error('会话已取消'))}this.pending.clear();this.finish() }
  fatal(message: string): void { if(this.finished)return;this.stop();this.app.emit('session:state',{state:'closed',message});this.emit('closed',message) }
  private payload(extra: Record<string,unknown>) { return {code:this.code,token:this.token,isHost:this.isHost,...extra} }
  private signals(value: unknown): void {
    if(this.finished || !value || typeof value!=='object')return
    const data=value as {s?:SignalMsg[];ts?:number}
    for(const signal of data.s??[]) if(typeof signal.type==='string' && signal.data && typeof signal.data==='object') this.emit('engineSignal',signal)
    if(Number.isFinite(data.ts))this.since=Math.max(this.since,data.ts!)
  }
  private connect(): void {
    if(this.finished || this.socket || Date.now()<this.reconnectAt)return
    this.reconnectAt=Date.now()+30000
    const url=new URL(this.app.baseURL());url.protocol=url.protocol==='https:'?'wss:':'ws:';url.pathname='/ws';url.search=''
    const socket=this.socket=new WebSocket(url)
    const timer=setTimeout(()=>socket.close(),5000)
    socket.addEventListener('open',()=>clearTimeout(timer))
    socket.addEventListener('error',()=>socket.close())
    socket.addEventListener('close',()=>{clearTimeout(timer);if(this.socket===socket)this.socket=undefined;for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(new Error('信令连接已断开'))}this.pending.clear()})
    socket.addEventListener('message',event=>{if(this.finished)return;try{const frame=JSON.parse(String(event.data)) as WsFrame;if(frame.id===0){this.signals(frame.data);return}const item=this.pending.get(frame.id);if(!item)return;this.pending.delete(frame.id);clearTimeout(item.timer);if(frame.success)item.resolve(frame.data);else item.reject(new APIError(frame.error??'SIGNAL',frame.message??'请求失败'))}catch{}})
  }
  private async request(route: string, extra: Record<string,unknown>): Promise<unknown> {
    this.connect();const body=this.payload(extra)
    if(this.socket?.readyState===WebSocket.OPEN) {
      try{return await new Promise<unknown>((resolve,reject)=>{const id=this.nextId++;const timer=setTimeout(()=>{this.pending.delete(id);reject(new Error('信令响应超时'))},6000);this.pending.set(id,{resolve,reject,timer});this.socket!.send(JSON.stringify({id,route,method:'POST',body}))})}
      catch(error){if(this.finished)throw error;if(error instanceof APIError)throw error}
    }
    return this.app.api.post(this.app.baseURL(),route,body)
  }
  private async wait(ms: number): Promise<void> { let timer:NodeJS.Timeout|undefined;await Promise.race([this.done,new Promise<void>(resolve=>{timer=setTimeout(resolve,ms)})]);clearTimeout(timer) }
  private async loop(heartbeat:boolean):Promise<void> {
    let failures=0,sequence=0,delay=heartbeat?5000:1000
    while(!this.finished){try{const result=await this.request(heartbeat?'/room/heartbeat':'/signal/poll',heartbeat?{seq:++sequence,currentInterval:delay/1000,natType:'unknown',load:0,peerLatency:{}}:{since:this.since});if(this.finished)return;failures=0;if(heartbeat){const info=result as {heartbeatInterval?:number};if(info?.heartbeatInterval)delay=Math.min(30000,Math.max(1000,info.heartbeatInterval*1000));this.emit('roomInfo',result)}else this.signals(result)}catch(error){if(this.finished)return;const e=error as APIError;this.app.netLog('warn',e.message);if(['ROOM_EXPIRED','ROOM_CLOSED','ROOM_EVICTED','INVALID_TOKEN'].includes(e.code)||e.status===410||++failures>=10){this.fatal(e.message);return}}await this.wait(delay)}
  }
  async run():Promise<void>{if(this.running)return this.done;this.running=true;await Promise.all([this.loop(true),this.loop(false)])}
}
