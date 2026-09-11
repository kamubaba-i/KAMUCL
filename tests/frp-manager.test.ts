import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { FrpManager, readFrpRegistry, writeFrpRegistry, tunnelIdentity, type TunnelWorker } from '../src/main/core/frpManager'
import type { FrpConfig, FrpState, FrpEvent } from '../src/main/core/frp'

class Worker implements TunnelWorker {
  starts: string[] = []; stops = 0
  sink: (event: FrpEvent) => void = () => {}
  state: FrpState = { status:'idle',config:null,remoteAddress:null,pid:null,startedAt:null,message:'未启动',logs:[] }
  setSink(sink: (event: FrpEvent) => void) { this.sink = sink }
  status() { return this.state }
  async start(config: FrpConfig) { this.starts.push(config.tunnelId); this.state = { ...this.state, config, status:'running',pid:Number(config.tunnelId),message:'已连接' };this.sink({type:'status',status:'running'});return {pid:Number(config.tunnelId),remoteAddress:null} }
  async stop() { if(this.state.status==='running') this.stops++;this.state={...this.state,status:'stopped',pid:null};this.sink({type:'stopped',status:'stopped'}) }
}
function fixture(t: test.TestContext, validate?: (key:string,id:string)=>Promise<any>) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'kamucl-frp-multi-')),file=path.join(root,'frp-tunnels.json')
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}))
  const workers: Worker[]=[]
  const deps={read:()=>readFrpRegistry(file),save:(data:any)=>writeFrpRegistry(file,data),worker:()=>{const w=new Worker();workers.push(w);return w},validate:validate || (async(_key:string,id:string)=>({id:Number(id),name:'世界 '+id,nodeName:'节点',localIp:'127.0.0.1',localPort:25565}))}
  const manager=new FrpManager(deps)
  manager.register('fixture-key',[{id:11,name:'生存',nodeName:'节点 A',localIp:'127.0.0.1',localPort:25565},{id:22,name:'创造',nodeName:'节点 B',localIp:'127.0.0.1',localPort:25566}])
  return { manager,workers,file,deps,ids:[tunnelIdentity('fixture-key','11'),tunnelIdentity('fixture-key','22')] }
}
test('FRP 同时运行两条隧道，单条停止不影响另一条，重启只恢复未手动停止的隧道',async t=>{
  const f=fixture(t)
  await Promise.all(f.ids.map(id=>f.manager.start(id)))
  assert.equal(f.manager.list().tunnels.filter(t=>t.status==='running').length,2)
  await f.manager.stop(f.ids[0]);assert.equal(f.workers[1].stops,0);assert.equal(f.manager.list().tunnels[1].status,'running')
  await f.manager.shutdown()
  assert.deepEqual(readFrpRegistry(f.file).tunnels.map(t=>t.desired),[false,true])
  const restored=new FrpManager(f.deps);await restored.restore()
  assert.equal(f.workers.length,3);assert.deepEqual(f.workers[2].starts,['22'])
})
test('FRP 退出时保留全部运行意图，恢复是幂等的，不重复创建进程',async t=>{
  const f=fixture(t);await Promise.all(f.ids.map(id=>f.manager.start(id)));await f.manager.shutdown()
  const next=new FrpManager(f.deps);await next.restore();await next.restore()
  assert.equal(f.workers.length,4);assert(f.workers.every(w=>w.starts.length===1))
})
test('FRP 查询期间取消启动，迟到的成功响应不会重新启动进程',async t=>{
  let release!:()=>void
  const gate=new Promise<void>(r=>release=r)
  const f=fixture(t,async()=>{await gate;return {localPort:25565}})
  const start=f.manager.start(f.ids[0]);await Promise.resolve();await f.manager.stop(f.ids[0]);release();await start
  assert.deepEqual(f.workers[0].starts,[]);assert.equal(readFrpRegistry(f.file).tunnels[0].desired,false)
})
test('FRP 某条恢复失败不会阻止其他隧道，错误可见且停止可取消下次重试',async t=>{
  const f=fixture(t,async(_key,id)=>{if(id==='11')throw Error('fixture-key 已失效');return {localPort:25566}})
  await assert.rejects(f.manager.start(f.ids[0]),/\*\*\* 已失效/);await f.manager.start(f.ids[1]);await f.manager.shutdown()
  const next=new FrpManager(f.deps);await next.restore()
  assert.equal(next.list().tunnels[0].status,'error');assert.equal(next.list().tunnels[1].status,'running')
  await next.stop(f.ids[0]);assert.equal(readFrpRegistry(f.file).tunnels[0].desired,false)
})
test('FRP 保存失败时不启动或停止进程，不丢失已保存的恢复意图',async t=>{
  const f=fixture(t);let fail=false
  const next=new FrpManager({...f.deps,save(data){if(fail)throw Error('磁盘只读');f.deps.save(data)}})
  fail=true;await assert.rejects(next.start(f.ids[0]),/磁盘只读/);assert.equal(f.workers.length,0)
  fail=false;await next.start(f.ids[0]);fail=true;await assert.rejects(next.stop(f.ids[0]),/磁盘只读/)
  assert.equal(f.workers[0].status().status,'running');assert.equal(readFrpRegistry(f.file).tunnels[0].desired,true)
})
test('FRP 旧配置迁移不擅自自动连接；损坏文件保留并报错',t=>{
  const f=fixture(t),legacy=path.join(path.dirname(f.file),'new.json')
  const migrated=readFrpRegistry(legacy,{accessKey:'old-key',tunnelId:'33',localPort:25565})
  assert.equal(migrated.tunnels[0].desired,false);assert.equal(migrated.accessKey,'old-key')
  fs.writeFileSync(legacy,'broken');assert.throws(()=>readFrpRegistry(legacy));assert.equal(fs.readFileSync(legacy,'utf8'),'broken')
})
test('FRP 相同隧道 ID 在不同密钥下分别管理，重复请求合并',async t=>{
  const f=fixture(t);f.manager.register('other-key',[{id:11,name:'另一账号',nodeName:'节点 C',localIp:'localhost',localPort:25570}])
  const other=tunnelIdentity('other-key','11');assert.notEqual(other,f.ids[0])
  await Promise.all([f.manager.start(f.ids[0]),f.manager.start(f.ids[0]),f.manager.start(other)])
  assert.equal(f.workers.length,2);await f.manager.stop(other);assert.equal(f.workers[0].status().status,'running')
})
