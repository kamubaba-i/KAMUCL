import { ApiClient } from './api'
import { TurnSession, probeTurnNodes, validTurnEndpoint, type TurnAllocation, type TurnNode } from './turn'
import { derivePunchKey } from './punchAuth'
import { RudpConn } from './rudp'
import { TcpBridge, startHostLazyBridge } from './bridge'

interface RoomRef { code:string; token:string; clientId:string; isHost:boolean; hostPort:number; hostAuth:boolean }
interface RelayLink { controller:AbortController; session?:TurnSession; rudp?:RudpConn; bridge?:TcpBridge; ready?:()=>void; allocation?:TurnAllocation; room:RoomRef }
export interface TurnRelayDeps {
  api:ApiClient; baseURL:()=>string; room:()=>RoomRef|null
  directConnected:(peer?:string)=>boolean
  connected:(peer:string, address:string)=>void
  stage:(status:'active'|'ok'|'fail', detail:string)=>void
  state:(status:'trying'|'success'|'failed', address:string, detail:string)=>void
  signal:(type:string,data:Record<string,unknown>,to:string)=>Promise<void>
  log:(level:'info'|'warn'|'error',text:string)=>void
}
/** Captures room credentials per operation; late HTTP/UDP replies cannot revive a departed room. */
export class TurnRelay {
  private guest:RelayLink|null=null
  private hosts=new Map<string,RelayLink>()
  constructor(private deps:TurnRelayDeps) {}
  busy():boolean{return !!this.guest}
  hasPeer(peer:string):boolean{return this.hosts.has(peer)}
  private current(link:RelayLink):boolean { const room=this.deps.room(); return !link.controller.signal.aborted && !!room && room.code===link.room.code && room.token===link.room.token }
  private valid(link:RelayLink) { if(!this.current(link))throw new Error('房间已退出') }
  private release(link:RelayLink) {
    if(!link.allocation)return
    const sessionId=link.allocation.sessionId;link.allocation=undefined
    void this.deps.api.post(this.deps.baseURL(),'/relay/release',{roomCode:link.room.code,clientId:link.room.clientId,token:link.room.token,sessionId},null).catch(()=>{})
  }
  private close(link:RelayLink) {
    // Remove ownership before callbacks, preventing recursive teardown.
    if(this.guest===link)this.guest=null
    for(const [peer,owned] of this.hosts)if(owned===link)this.hosts.delete(peer)
    const bridge=link.bridge, rudp=link.rudp, session=link.session
    link.bridge=undefined;link.rudp=undefined;link.session=undefined
    session?.close();link.controller.abort();bridge?.stop();rudp?.close();this.release(link)
  }
  stop() { if(this.guest)this.close(this.guest);for(const link of [...this.hosts.values()])this.close(link) }
  peerLeft(peer:string) { const link=peer==='host'?this.guest:this.hosts.get(peer);if(link)this.close(link) }
  async startGuest():Promise<void> {
    const room=this.deps.room()
    if(!room || room.isHost)throw new Error('请先加入房间后使用 TURN 中继')
    if(this.guest || this.deps.directConnected())return
    const link:RelayLink={controller:new AbortController(),room};this.guest=link
    const signal=link.controller.signal
    this.deps.stage('active','TURN：正在获取节点并测试延迟…');this.deps.state('trying','','正在建立 TURN 中继')
    try {
      const status=await this.deps.api.get(this.deps.baseURL(),'/relay/status',{}, {}) as {enabled?:boolean}
      this.valid(link);if(status.enabled===false)throw new Error('服务器暂未启用 TURN 中继')
      const raw=await this.deps.api.get(this.deps.baseURL(),'/relay/list',{}, {}) as {nodes?:TurnNode[]}
      this.valid(link)
      const nodes=(raw.nodes||[]).filter(n=>n.id!=null&&validTurnEndpoint(n.host,n.port)).map(n=>({...n,id:String(n.id)}))
      if(!nodes.length)throw new Error('当前没有可用的 TURN 节点')
      const sorted=await probeTurnNodes(nodes,signal);this.valid(link)
      if(this.deps.directConnected()){this.close(link);return}
      const allocation=await this.deps.api.post(this.deps.baseURL(),'/relay/allocate',{roomCode:room.code,clientId:room.clientId,token:room.token,nodeId:sorted[0].id},{}) as TurnAllocation
      link.allocation=allocation
      this.valid(link)
      if(this.deps.directConnected()){this.close(link);return}
      this.deps.stage('active','TURN：节点已分配，正在绑定中继通路…')
      link.session=await TurnSession.bind({...allocation,ticket:allocation.guestTicket},2,signal);this.valid(link)
      const rc=new RudpConn(link.session.socket,link.session.target,{codec:link.session.codec,authKey:room.hostAuth?derivePunchKey(room.code,room.clientId):null,ownsSocket:false});link.rudp=rc
      const ready=new Promise<void>((resolve,reject)=>{
        const timer=setTimeout(()=>{cleanup();reject(new Error('房主 20 秒内未确认 TURN，请确认对方使用支持中继的版本'))},20_000)
        const abort=()=>{cleanup();reject(new Error('房间已退出'))}
        const cleanup=()=>{clearTimeout(timer);signal.removeEventListener('abort',abort);link.ready=undefined}
        link.ready=()=>{cleanup();resolve()};signal.addEventListener('abort',abort,{once:true})
      })
      // Install the ready listener before sending; HTTP and pushed signals may arrive in either order.
      await Promise.all([ready,this.deps.signal('turn_alloc',{sessionId:allocation.sessionId,host:allocation.host,port:allocation.port,ticket:allocation.hostTicket,expire:allocation.expire,clientId:room.clientId,punchAuth:true},'host')])
      this.valid(link)
      if(this.deps.directConnected()){this.close(link);return}
      rc.start()
      const {addr,bridge}=await TcpBridge.startGuest(rc,()=>this.lost(link));link.bridge=bridge
      this.valid(link)
      if(this.deps.directConnected()){this.close(link);return}
      rc.once('closed',()=>this.lost(link))
      this.deps.connected('host',addr)
      this.deps.stage('ok','TURN 中继已建立');this.deps.state('success',addr,'通过 TURN 中继连接，本地地址 '+addr)
    } catch(e) {
      const active=this.current(link);this.close(link)
      if(active) {const message=(e as Error).message;this.deps.stage('fail',message);this.deps.state('failed','',message);throw e}
    }
  }
  private lost(link:RelayLink) {
    if(!this.current(link))return
    this.close(link);this.deps.stage('fail','TURN 中继已断开，可重新连接');this.deps.state('failed','','TURN 中继已断开')
  }
  async onSignal(type:string,from:string,data:Record<string,unknown>) {
    if(type==='turn_ready') { if(from==='host'&&this.guest&&this.current(this.guest))this.guest.ready?.();return }
    if(type!=='turn_alloc')return
    const room=this.deps.room()
    if(!room?.isHost || !from || from==='host' || this.deps.directConnected(from))return
    if(this.hosts.has(from)) {
      const existing=this.hosts.get(from)!
      if(existing.session && existing.session.sessionId===data.sessionId && existing.rudp) await this.deps.signal('turn_ready',{sessionId:data.sessionId},from).catch(()=>{})
      return
    }
    const link:RelayLink={controller:new AbortController(),room};this.hosts.set(from,link)
    try {
      // Validate against the server's published nodes before a peer-provided endpoint receives a ticket.
      const raw=await this.deps.api.get(this.deps.baseURL(),'/relay/list',{}, {}) as {nodes?:TurnNode[]};this.valid(link)
      if(!raw.nodes?.some(n=>n.host===data.host && n.port===data.port))throw new Error('TURN 分配的节点不在官方列表中')
      link.session=await TurnSession.bind(data as unknown as {sessionId:string;host:string;port:number;ticket:string},1,link.controller.signal);this.valid(link)
      if(this.deps.directConnected(from)){this.close(link);return}
      // Upstream sends the current authoritative clientId explicitly after reconnects.
      const auth=data.punchAuth===true?derivePunchKey(room.code,typeof data.clientId==='string'?data.clientId:from):null
      const rc=new RudpConn(link.session.socket,link.session.target,{codec:link.session.codec,authKey:auth,ownsSocket:false});link.rudp=rc;rc.start()
      rc.once('closed',()=>this.close(link))
      this.deps.connected(from,'')
      void startHostLazyBridge(rc,room.hostPort,this.deps.log)
      await this.deps.signal('turn_ready',{sessionId:data.sessionId},from);this.valid(link)
      this.deps.stage('ok','房客 TURN 通路已建立，等待游戏连接')
    } catch(e) {const active=this.current(link);this.close(link);if(active)this.deps.log('warn','房客 TURN 建立失败：'+(e as Error).message)}
  }
}
