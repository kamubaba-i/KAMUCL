// SPDX-License-Identifier: LGPL-3.0-only
// New KAMUCL orchestration using VoxLink Java signaling fields (ConnectionManager / SignalingClient,
// AUGUHDAR/VoxLink revision 6b11d93). The former app-desktop implementation is not retained.
import dgram from 'node:dgram'
import net from 'node:net'
import { randomUUID } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { ApiClient, APIError, APP_VERSION, CLIENT_TAG, DEFAULT_SERVER_URL, validateRoomCode, validateServerURL } from './api'
import { normalizeVoxlinkRoomName } from '../../../shared/voxlinkRoom'
import { STUN_SERVERS, stunSampleSeries, stunDeltaFromSamples, type StunMappedAddr } from './stun'
import { Puncher, punchListen, predictedPortsAround } from './punch'
import { RudpConn } from './rudp'
import { TcpBridge, startHostLazyBridge, pumpRelay } from './bridge'
import { TurnRelay } from './turnRelay'
import { derivePunchKey } from './punchAuth'
import { VoxlinkSession } from './session'
import { detectMcPorts, probeHostPort } from './mc_ports'
import { defaultSettingsPath, loadSettings, saveSettings, type VoxlinkSettings } from './settings'
export const PHASE_P2P='p2p',PHASE_DIRECT='direct',PHASE_PRELAY='prelay',STATUS_TRYING='trying',STATUS_FAILED='failed',STATUS_SUCCESS='success'
export interface ConnState { phase:string;status:string;address:string;detail:string }
export interface RoomInfo { code:string;name:string;hostIp:string;hostPort:number;maxPlayers:number;currentPlayers:number;hasPassword:boolean;category:string;gameVersion:string;loader:string;clientType:string;clientTag?:string;expiresIn:number;isHost:boolean;hostCapabilities?:string[] }
export interface LobbyRoom {code:string;name:string;hostIp?:string;hostPort?:number;currentPlayers?:number;maxPlayers?:number;hasPassword?:boolean;category?:string;gameVersion?:string;loader?:string;clientType?:string;clientTag?:string;natType?:string}
export interface AppState {state:'idle'|'hosting'|'in_room'|'closed';code:string;token:string;isHost:boolean;room:RoomInfo|null}
export interface CreateRoomParams {name:string;password?:string;category?:string;visible:boolean;hostPort:number;loader?:string;gameVersion?:string}
export interface JoinRoomParams {code:string;password?:string}
export interface CreateRoomResult {code:string;hostToken:string;name:string;hostIp:string;hostPort:number;expiresIn:number}
export interface JoinRoomResult {clientToken:string;clientId:string;room:RoomInfo}
export type LogLevel='info'|'warn'|'error'
export type NetLogFn=(level:LogLevel,message:string)=>void
export type EmitFn=(event:string,data:unknown)=>void
export interface EngineDeps {api:ApiClient;baseURL:()=>string;emit:EmitFn;netLog:NetLogFn;allowRelay?:()=>boolean}
export interface RelayCandidate {clientId:string;roomCode:string;natType:string;mappedIp:string;mappedPort:number}
interface Link { socket:dgram.Socket;punch:Puncher;mapped:StunMappedAddr;delta:number;auth:Buffer|null;rudp?:RudpConn;bridge?:TcpBridge;remote?:StunMappedAddr;started?:boolean;timer?:NodeJS.Timeout }
type Data=Record<string,unknown>
const endpoint=(data:Data,prefix:string):StunMappedAddr|null=>{const ip=String(data[`${prefix}Ip`]??''),port=Number(data[`${prefix}Port`]);return net.isIP(ip)&&Number.isInteger(port)&&port>0&&port<=65535?{ip,port}:null}
export class ConnEngine extends EventEmitter {
  code='';token='';isHost=false;hostPort=0;hostIp='';clientID='';session:VoxlinkSession|null=null;room:RoomInfo|null=null
  joinedAt=0;lastConnection:ConnState|null=null;stages:Record<string,{key:string;status:string;detail:string;ts:number}>={}
  readonly turn:TurnRelay
  private generation=0
  private links=new Map<string,Link>()
  private creating=new Set<string>()
  private timers=new Set<NodeJS.Timeout>()
  private relays=new Set<()=>void>()
  private relayPending=false
  constructor(readonly deps:EngineDeps){super();this.turn=new TurnRelay({api:deps.api,baseURL:deps.baseURL,room:()=>this.session?{code:this.code,token:this.token,isHost:this.isHost,clientId:this.clientID,hostPort:this.hostPort,hostAuth:this.isHost||!!this.room?.hostCapabilities?.includes('punchAuthV1')}:null,directConnected:peer=>peer?!!this.links.get(peer)?.rudp?.isConnected():this.lastConnection?.status==='success',connected:(peer,address)=>{this.drop(peer||'host');this.state('turn','success',address,'TURN 中继已连接')},stage:(status,detail)=>this.stage('turn',status,detail),state:(status,address,detail)=>this.state('turn',status,address,detail),signal:(type,data,to)=>this.sendSignal(type,data,to),log:deps.netLog})}
  baseURL():string{return this.deps.baseURL()}
  snapshotRoom():RoomInfo|null{return this.room}
  currentHostPort():number{return this.hostPort}
  setState(_state:AppState['state'],code:string,token:string,isHost:boolean,room:RoomInfo|null,session:VoxlinkSession|null):void{this.code=code;this.token=token;this.isHost=isHost;this.room=room;this.session=session;this.hostPort=room?.hostPort??0;this.hostIp=room?.hostIp??''}
  private later(callback:()=>void,ms:number):void{const epoch=this.generation;const timer=setTimeout(()=>{this.timers.delete(timer);if(epoch===this.generation&&this.session)callback()},ms);this.timers.add(timer)}
  private state(phase:string,status:string,address:string,detail:string):void{if(!this.session)return;this.lastConnection={phase,status,address,detail};this.deps.emit('conn:state',this.lastConnection)}
  private stage(key:string,status:string,detail:string):void{if(!this.session)return;const item={key,status,detail,ts:Date.now()};this.stages[key]=item;this.deps.emit('stage',item)}
  beginFallbackTimer():void{this.joinedAt=Date.now();if(this.isHost)return;this.state('p2p','trying','','正在与房主交换连接信息');this.later(()=>{if(this.lastConnection?.status!=='success')this.stage('turn','degraded','可点击使用 TURN 中继')},20000);this.later(()=>{if(this.lastConnection?.status!=='success'&&this.deps.allowRelay?.()!==false)void this.useTurnRelay().catch(error=>this.deps.netLog('warn',error.message))},60000)}
  async sendSignal(type:string,data:Data,to:string):Promise<void>{if(!this.session||this.session.isDone())throw new Error('房间已退出');await this.deps.api.post(this.baseURL(),'/signal/send',{code:this.code,token:this.token,isHost:this.isHost,type,data,...(to?{to}:{})})}
  private drop(id:string):void{const link=this.links.get(id);if(!link)return;this.links.delete(id);clearTimeout(link.timer);link.punch.stop();link.bridge?.stop();link.rudp?.close();try{link.socket.close()}catch{}}
  private async prepare(id:string,auth:Buffer|null):Promise<Link>{
    const epoch=this.generation;const socket=await punchListen(0)
    try{const samples=await stunSampleSeries(socket,STUN_SERVERS,2,1,1000);if(epoch!==this.generation||!this.session)throw new Error('房间已退出');if(!samples.length)throw new Error('STUN 未取得公网映射，可尝试 TURN 中继');const punch=new Puncher({conn:socket,timeoutMs:20000,authKey:auth});const link:Link={socket,punch,mapped:samples[0],delta:stunDeltaFromSamples(samples),auth};this.drop(id);this.links.set(id,link);link.timer=setTimeout(()=>{if(this.links.get(id)===link&&!link.started)this.drop(id)},30000);return link}catch(error){try{socket.close()}catch{}throw error}
  }
  private async connect(id:string,link:Link,remote:StunMappedAddr,delta=0,relay=false):Promise<void>{
    if(this.links.get(id)!==link)return
    link.remote=remote;link.punch.setTarget({address:remote.ip,port:remote.port});link.punch.setPredictedPorts(predictedPortsAround(remote.port,delta));if(link.started)return;link.started=true;clearTimeout(link.timer);const epoch=this.generation
    this.stage(this.isHost?'host_punch':relay?'relay':'punch','active','正在建立 UDP 通路');link.punch.start()
    try{const target=await link.punch.wait();if(epoch!==this.generation||this.links.get(id)!==link)return;const rc=link.rudp=new RudpConn(link.socket,target,{authKey:link.auth});rc.start()
      if(this.isHost){void startHostLazyBridge(rc,this.hostPort,this.deps.netLog).catch(error=>this.deps.netLog('warn',error.message));this.stage('host_punch','ok','玩家通路已建立')}
      else{const result=await TcpBridge.startGuest(rc,()=>{if(this.links.get(id)===link){this.drop(id);this.state(relay?'prelay':'p2p','failed','','游戏通路已关闭')}});if(epoch!==this.generation){result.bridge.stop();return}link.bridge=result.bridge;this.relayPending=false;this.state(relay?'prelay':'p2p','success',result.addr,relay?'玩家中继已连接':'UDP 通路已连接');this.stage(relay?'relay':'punch','ok','游戏端口已就绪')}
    }catch(error){if(epoch===this.generation){this.drop(id);this.stage(this.isHost?'host_punch':relay?'relay':'punch','fail',(error as Error).message);if(!this.isHost&&!relay&&this.lastConnection?.status!=='success')this.later(()=>{void this.sendSignal('join_request',{},'host').catch(()=>{})},1500)}}
  }
  private async hostOffer(from:string):Promise<void>{if(this.creating.has(from)||this.links.get(from)?.rudp?.isConnected()||this.turn.hasPeer(from))return;this.creating.add(from);try{this.stage('host_stun','active','正在探测房主网络');const link=await this.prepare(from,derivePunchKey(this.code,from));await this.sendSignal('holepunch_offer',{hostIp:this.hostIp,hostPort:this.hostPort,hostMappedIp:link.mapped.ip,hostMappedPort:link.mapped.port,hostMappedPortDelta:link.delta,hostSymmetric:link.delta!==0,punchAuthV1:true},from);this.stage('host_stun','ok','房主网络探测完成')}finally{this.creating.delete(from)}}
  private async guestOffer(data:Data):Promise<void>{if(this.creating.has('host')||this.links.get('host')?.started||this.lastConnection?.status==='success')return;this.creating.add('host');this.stage('stun','active','正在探测本机网络');try{const auth=this.room?.hostCapabilities?.includes('punchAuthV1')?derivePunchKey(this.code,this.clientID):null;const link=await this.prepare('host',auth);this.stage('stun','ok','本机网络探测完成');await this.sendSignal('punch_info',{joinerMappedIp:link.mapped.ip,joinerMappedPort:link.mapped.port,joinerMappedPortDelta:link.delta,joinerSymmetric:link.delta!==0},'host');const target=endpoint(data,'hostMapped');if(target)void this.connect('host',link,target,Number(data.hostMappedPortDelta)||0)}finally{this.creating.delete('host')}}
  onSignal(type:string,from:string,data:Data):void{
    if(!this.session||this.session.isDone())return
    const run=async()=>{
      if(type.startsWith('turn_')){await this.turn.onSignal(type,from,data);return}
      if(type==='disconnect'){this.drop(from);this.turn.peerLeft(from);return}
      if(this.isHost){
        if(type==='join_request')await this.hostOffer(from)
        if(type==='punch_info'){const link=this.links.get(from),remote=endpoint(data,'joinerMapped');if(link&&remote){await this.sendSignal('holepunch_mapped',{hostMappedIp:link.mapped.ip,hostMappedPort:link.mapped.port,hostMappedPortDelta:link.delta},from);void this.connect(from,link,remote,Number(data.joinerMappedPortDelta)||0)}}
        if(type==='relay_request')await this.dispatchRelay(from)
        if(type==='relay_accept'&&typeof data.forClientId==='string')await this.sendSignal('relay_notify',{connected:true},data.forClientId)
      }else if(from==='host'){
        if(type==='holepunch_offer')await this.guestOffer(data)
        if(type==='holepunch_mapped'){const link=this.links.get('host'),remote=endpoint(data,'hostMapped');if(link&&remote)void this.connect('host',link,remote,Number(data.hostMappedPortDelta)||0)}
        if(type==='relay_declined'){this.relayPending=false;this.state('prelay','failed','','当前没有可用的玩家中继')}
        if(type==='relay_notify'&&!data.connected){const remote=endpoint(data,'relay');if(remote){const link=await this.prepare('relay',null);void this.connect('relay',link,remote,1,true)}}
        if(type==='relay_setup')await this.serveRelay(data)
      }
    };void run().catch(error=>{if(this.session)this.deps.netLog('warn',(error as Error).message)})
  }
  private async dispatchRelay(requester:string):Promise<void>{
    const target=this.links.get(requester)?.remote
    const candidates=[...this.links.entries()].filter(([id,link])=>id!==requester&&link.remote&&link.rudp?.isConnected())
    if(!target||!candidates.length){await this.sendSignal('relay_declined',{},requester);return}
    const [id,relay]=candidates[0];await this.sendSignal('relay_setup',{targetClientId:requester,targetIp:target.ip,targetPort:target.port},id);await this.sendSignal('relay_notify',{relayIp:relay.remote!.ip,relayPort:relay.remote!.port},requester)
  }
  private async serveRelay(data:Data):Promise<void>{
    const remote=endpoint(data,'target'),host=this.links.get('host');if(this.deps.allowRelay?.()===false||!remote||!host?.rudp?.isConnected()){await this.sendSignal('relay_declined',{},'host');return}
    const id=`relay:${String(data.targetClientId)}`,link=await this.prepare(id,null),epoch=this.generation;link.punch.setTarget({address:remote.ip,port:remote.port});link.punch.setPredictedPorts(predictedPortsAround(remote.port,1));link.started=true;clearTimeout(link.timer);link.punch.start();const target=await link.punch.wait();if(epoch!==this.generation)return;const rc=link.rudp=new RudpConn(link.socket,target);rc.start();const stop=pumpRelay(host.rudp,rc);this.relays.add(stop);await this.sendSignal('relay_accept',{forClientId:data.targetClientId},'host')
  }
  usePlayerRelay():{ok:boolean;err?:string}{if(!this.session||this.isHost)return{ok:false,err:'请先加入房间'};if(this.relayPending)return{ok:false,err:'正在请求玩家中继'};this.relayPending=true;this.state('prelay','trying','','正在寻找玩家中继');void this.sendSignal('relay_request',{},'host').catch(error=>{this.relayPending=false;this.state('prelay','failed','',error.message)});this.later(()=>{if(this.relayPending){this.relayPending=false;this.state('prelay','failed','','玩家中继请求超时，可尝试 TURN')}},20000);return{ok:true}}
  async useTurnRelay():Promise<void>{await this.turn.startGuest()}
  tryDirect():{ok:boolean;err?:string}{if(!this.session||this.isHost||!net.isIP(this.hostIp)||!this.hostPort)return{ok:false,err:'当前房间没有有效直连地址'};const epoch=this.generation;const socket=net.createConnection({host:this.hostIp,port:this.hostPort});this.state('direct','trying','','正在测试直连');let finished=false;const finish=(ok:boolean)=>{if(finished)return;finished=true;clearTimeout(timer);socket.destroy();if(epoch===this.generation)this.state('direct',ok?'success':'failed',ok?`${net.isIP(this.hostIp)===6?'['+this.hostIp+']':this.hostIp}:${this.hostPort}`:'',ok?'直连可用':'直连不可用')};const timer=setTimeout(()=>finish(false),3000);socket.once('connect',()=>finish(true));socket.once('error',()=>finish(false));return{ok:true}}
  relayRelease():void{this.turn.stop()}
  teardown():void{this.generation++;for(const timer of this.timers)clearTimeout(timer);this.timers.clear();this.turn.stop();for(const id of [...this.links.keys()])this.drop(id);for(const stop of this.relays)stop();this.relays.clear();this.creating.clear();this.relayPending=false;this.joinedAt=0;this.lastConnection=null;this.stages={}}
}
export interface AppOptions {settings?:VoxlinkSettings;settingsPath?:string;api?:ApiClient;serverURL?:string}
export class VoxlinkApp {
  readonly api:ApiClient;readonly engine:ConnEngine;settings:VoxlinkSettings;settingsPath:string;state:AppState['state']='idle';room:RoomInfo|null=null
  private operation=0;private pending=false
  constructor(private options:AppOptions={}){this.settingsPath=options.settingsPath??defaultSettingsPath();this.settings=options.settings??loadSettings(this.settingsPath);this.api=options.api??new ApiClient();this.engine=new ConnEngine({api:this.api,baseURL:()=>this.baseURL(),allowRelay:()=>this.settings.allowRelay,emit:(event,data)=>this.emit(event,data),netLog:(level,message)=>this.netLog(level,message)})}
  emit(_event:string,_data:unknown):void{}
  netLog(_level:LogLevel,_message:string):void{}
  baseURL():string{return this.options.serverURL??DEFAULT_SERVER_URL}
  getSettingsJSON(){return{serverUrl:this.baseURL(),theme:this.settings.theme,version:APP_VERSION}}
  saveSettingsJSON(value:{theme?:string}){if(value.theme)this.settings.theme=value.theme;saveSettings(this.settings,this.settingsPath);return this.getSettingsJSON()}
  setAllowRelay(value:boolean):VoxlinkSettings{this.settings.allowRelay=value;saveSettings(this.settings,this.settingsPath);return this.settings}
  async getCategories():Promise<Record<string,string>>{return await this.api.get(this.baseURL(),'/categories',{}) as Record<string,string>}
  async listRooms(query:{page?:number;size?:number;category?:string;loader?:string;search?:string}):Promise<{rooms:LobbyRoom[];total:number;page:number;size:number}>{const page=Math.max(1,query.page??1),size=Math.min(100,Math.max(1,query.size??20));return await this.api.get(this.baseURL(),'/room/list',{...query,page,size}) as {rooms:LobbyRoom[];total:number;page:number;size:number}}
  async roomInfo(code:string):Promise<Data>{return await this.api.get(this.baseURL(),'/room/info',{code}) as Data}
  private begin():number{if(this.pending||this.engine.session)throw new APIError('SESSION_ACTIVE','请先退出当前房间');this.pending=true;return ++this.operation}
  private async accept(epoch:number,code:string,token:string,isHost:boolean,room:RoomInfo,clientId=''):Promise<void>{
    if(epoch!==this.operation){void this.api.post(this.baseURL(),'/room/leave',{code,token,isHost}).catch(()=>{});throw new Error('操作已取消')}
    this.room=room;this.state=isHost?'hosting':'in_room';const session=new VoxlinkSession({api:this.api,baseURL:()=>this.baseURL(),emit:(e,d)=>this.emit(e,d),netLog:(l,m)=>this.netLog(l,m)},{code,token,isHost});this.engine.clientID=clientId;this.engine.setState(this.state,code,token,isHost,room,session)
    session.on('engineSignal',signal=>this.engine.onSignal(signal.type,signal.from,signal.data));session.on('roomInfo',info=>{if(this.engine.session===session&&this.room){if(Number.isFinite(info?.currentPlayers))this.room.currentPlayers=info.currentPlayers;if(info?.name)this.room.name=info.name;this.emit('session:state',{state:this.state,room:this.room})}})
    this.engine.beginFallbackTimer();this.emit('session:state',{state:this.state,room});void session.run().finally(()=>{if(this.engine.session===session){this.engine.teardown();this.engine.session=null;this.state='closed';this.room=null;this.emit('session:state',{state:'closed'})}})
    if(!isHost)void this.engine.sendSignal('join_request',{},'host').catch(error=>this.netLog('warn',error.message))
  }
  async createRoom(req:CreateRoomParams):Promise<CreateRoomResult>{const epoch=this.begin();try{const name=normalizeVoxlinkRoomName(req.name);await probeHostPort(req.hostPort);if(epoch!==this.operation)throw new Error('操作已取消');const result=await this.api.post(this.baseURL(),'/room/create',{...req,name,maxPlayers:20,natType:'unknown',clientType:'app',clientTag:CLIENT_TAG,client_tag:CLIENT_TAG,clientProtocolVersion:7,clientCapabilities:['relay','punchAuthV1'],idempotencyKey:randomUUID()}) as CreateRoomResult;const room:RoomInfo={...result,maxPlayers:20,currentPlayers:1,hasPassword:!!req.password,category:req.category??'',gameVersion:req.gameVersion??'',loader:req.loader??'',clientType:'app',clientTag:CLIENT_TAG,isHost:true};await this.accept(epoch,result.code,result.hostToken,true,room);return result}finally{if(epoch===this.operation)this.pending=false}}
  async joinRoom(req:JoinRoomParams):Promise<JoinRoomResult>{const epoch=this.begin();try{const code=req.code.trim().toUpperCase();if(!validateRoomCode(code))throw new APIError('INVALID_PARAMS','请输入有效的六位房间码');const result=await this.api.post(this.baseURL(),'/room/join',{code,password:req.password,clientType:'app',clientProtocolVersion:7,clientCapabilities:['relay','punchAuthV1'],idempotencyKey:randomUUID()}) as JoinRoomResult;result.room={...result.room,code,isHost:false};await this.accept(epoch,code,result.clientToken,false,result.room,result.clientId);return result}finally{if(epoch===this.operation)this.pending=false}}
  async leaveRoom():Promise<{left:boolean}>{this.operation++;this.pending=false;const session=this.engine.session,credentials={code:this.engine.code,token:this.engine.token,isHost:this.engine.isHost};this.engine.session=null;session?.stop();this.engine.teardown();this.engine.setState('idle','','',false,null,null);this.state='idle';this.room=null;this.emit('session:state',{state:'idle'});if(session)void this.api.post(this.baseURL(),'/room/leave',credentials).catch(()=>{});return{left:!!session}}
  getSessionStateJSON():AppState{return{state:this.state,room:this.room,code:this.engine.code,token:this.engine.token,isHost:this.engine.isHost}}
  async sendRoomUpdate(value:{name?:string;category?:string;visible?:boolean;password?:string}):Promise<void>{if(!this.engine.session||!this.engine.isHost)throw new Error('只有房主可以修改房间');await this.api.post(this.baseURL(),'/room/update',{...value,code:this.engine.code,token:this.engine.token,isHost:true})}
  async getRoomMods(code:string):Promise<Data>{return await this.api.post(this.baseURL(),'/room/mods',{code}) as Data}
  async relayStatus():Promise<Data>{return await this.api.get(this.baseURL(),'/relay/status',{}) as Data}
  async relayList():Promise<Data>{return await this.api.get(this.baseURL(),'/relay/list',{}) as Data}
  async getStun():Promise<Data>{return await this.api.get(this.baseURL(),'/stun',{}) as Data}
  async openInBrowser(url:string):Promise<void>{if(!validateServerURL(url))throw new Error('链接无效');const {shell}=await import('electron');await shell.openExternal(url)}
  async detectMcPortsJSON(){return{ports:await detectMcPorts()}}
  tryDirect(){return this.engine.tryDirect()}
  usePlayerRelay(){return this.engine.usePlayerRelay()}
}
