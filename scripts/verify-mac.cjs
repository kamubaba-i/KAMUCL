// Run the actual packaged app on a disposable native macOS CI runner.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{spawn,execFileSync}=require('node:child_process')
const appPath=path.resolve(process.argv[2]),arch=process.argv[3],version=require('../package.json').version
assert.equal(process.platform,'darwin');assert.equal(process.arch,arch)
const exe=path.join(appPath,'Contents/MacOS/KAMUCL'),proof=path.resolve(`release/mac-proof-${arch}`)
fs.mkdirSync(proof,{recursive:true})
const binary=execFileSync('file',[exe],{encoding:'utf8'});assert(binary.includes(arch==='x64'?'x86_64':'arm64'))
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE
const log=fs.openSync(path.join(proof,'process.log'),'w')
const child=spawn(exe,['--remote-debugging-port=9229'],{env,stdio:['ignore',log,log]})
const wait=ms=>new Promise(r=>setTimeout(r,ms))
async function main(){
 let page
 for(let i=0;i<60;i++){
  assert(child.exitCode===null,'packaged app exited early: '+child.exitCode)
  try{page=(await(await fetch('http://127.0.0.1:9229/json')).json()).find(p=>p.url.includes('/renderer/index.html'));if(page)break}catch{}
  await wait(1000)
 }
 assert(page,'main renderer did not load')
 const ws=new WebSocket(page.webSocketDebuggerUrl);await new Promise((r,j)=>{ws.addEventListener('open',r,{once:true});ws.addEventListener('error',j,{once:true})})
 let id=0;const pending=new Map();ws.addEventListener('message',e=>{const m=JSON.parse(e.data);if(pending.has(m.id)){pending.get(m.id)(m);pending.delete(m.id)}})
 const call=(method,params={})=>new Promise((resolve,reject)=>{const n=++id;const timer=setTimeout(()=>reject(Error(method+' timeout')),15000);pending.set(n,m=>{clearTimeout(timer);m.error?reject(Error(JSON.stringify(m.error))):resolve(m.result)});ws.send(JSON.stringify({id:n,method,params}))})
 let content=''
 for(let i=0;i<30;i++){const r=await call('Runtime.evaluate',{expression:'document.body.innerText',returnByValue:true});content=r.result.value||'';if(content.includes('首页')&&content.includes(version))break;await wait(1000)}
 assert(content.includes('首页')&&content.includes(version),'main UI missing')
 await wait(3000)
 const screenshot=await call('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(proof,'main.png'),Buffer.from(screenshot.data,'base64'))
 fs.writeFileSync(path.join(proof,'verification.json'),JSON.stringify({version,arch,binary,mainUI:true,url:page.url},null,2));ws.close()
 console.log('PASS native macOS '+arch+' packaged app '+version)
}
main().catch(e=>{console.error(e);process.exitCode=1}).finally(()=>{child.kill('SIGTERM');fs.closeSync(log)})
