// Run the actual packaged app on a disposable native macOS CI runner.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{spawn,execFileSync}=require('node:child_process')
const appPath=path.resolve(process.argv[2]),arch=process.argv[3],version=require('../package.json').version
assert.equal(process.platform,'darwin');assert.equal(process.arch,arch)
const exe=path.join(appPath,'Contents/MacOS/KAMUCL'),proof=path.resolve(`release/mac-proof-${arch}`)
fs.mkdirSync(proof,{recursive:true})
const binary=execFileSync('file',[exe],{encoding:'utf8'});assert(binary.includes(arch==='x64'?'x86_64':'arm64'))
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE
const log=fs.openSync(path.join(proof,'process.log'),'w')
const fixtureExe=path.join(proof,'material-fixture'),control=path.join(proof,'material-color.txt')
execFileSync('swiftc',['scripts/mac-material-fixture.swift','-o',fixtureExe])
fs.writeFileSync(control,'black')
const fixture=spawn(fixtureExe,[control],{stdio:'ignore'})
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
 for(let i=0;i<30;i++){try { const r=await call('Runtime.evaluate',{expression:'document.body.innerText',returnByValue:true});content=r.result.value||''; } catch(e) { if(!String(e).includes('Cannot find default execution context'))throw e; }if(content.includes('首页')&&content.includes(version))break;await wait(1000)}
 assert(content.includes('首页')&&content.includes(version),'main UI missing')
 const checks=await call('Runtime.evaluate',{expression:`(async()=>{const folders=await window.kamucl.invoke('folders:list');const scan=await window.kamucl.invoke('folders:scan',folders.active);return {platform:document.documentElement.dataset.platform,customButtons:document.querySelectorAll('.win-btn').length,logoTop:document.querySelector('.logo-area').getBoundingClientRect().top,folderStatus:scan.status,folderPath:folders.active}})()`,awaitPromise:true,returnByValue:true});
 const macUI=checks.result.value;assert.equal(macUI.platform,'darwin');assert.equal(macUI.customButtons,0);assert(macUI.logoTop>=38,'native traffic light area overlaps branding');assert.equal(macUI.folderStatus,'ready','default folder missing on first launch');
 await wait(3000)
 const screenshot=await call('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(proof,'main.png'),Buffer.from(screenshot.data,'base64'))
 // Inspect rendered default-skin pixels; a live WebGL context alone would miss the old faceless fallback.
 const skinBounds=await call('Runtime.evaluate',{expression:`(()=>{const c=document.querySelector('.viewer3d canvas');const r=c?.getBoundingClientRect();return r?{x:r.x,y:r.y,width:r.width,height:r.height}:null})()`,returnByValue:true})
 assert(skinBounds.result.value,'skin WebGL canvas missing')
 const sharp=require('sharp'),bounds=skinBounds.result.value
 const skinShot=await call('Page.captureScreenshot',{format:'png',clip:{...bounds,scale:1}})
 fs.writeFileSync(path.join(proof,'default-skin.png'),Buffer.from(skinShot.data,'base64'))
 const skinPixels=await sharp(Buffer.from(skinShot.data,'base64')).removeAlpha().raw().toBuffer()
 let facePixels=0,shirtPixels=0
 for(let i=0;i<skinPixels.length;i+=3){const [r,g,b]=skinPixels.subarray(i,i+3);if(r>140&&r>g*1.12&&g>b*1.05)facePixels++;if(g>85&&g>r*1.25&&b>r*1.2)shirtPixels++}
 assert(facePixels>20&&shirtPixels>20,'default skin texture not rendered')
 // Page.captureScreenshot excludes the OS blur. Capture the actual NSWindow over two backgrounds.
 let nativeMaterial
 try {
   const nativeWindow=JSON.parse(execFileSync(fixtureExe,['--window-id',String(child.pid)],{encoding:'utf8'}))
   console.log('Native material environment',nativeWindow)
   for(const color of ['black','white']){
     fs.writeFileSync(control,color+'|'+nativeWindow.id);await wait(2000)
     // A window-only capture omits behind-window composition. Capture the real display first.
     const screen=path.join(proof,`desktop-${color}.png`)
     execFileSync('/usr/sbin/screencapture',['-x','-D','1',screen])
     const meta=await sharp(screen).metadata(),scale=meta.width/nativeWindow.screenWidth,b=nativeWindow.bounds
     await sharp(screen).extract({left:Math.round(b.X*scale),top:Math.round(b.Y*scale),width:Math.round(b.Width*scale),height:Math.round(b.Height*scale)}).toFile(path.join(proof,`native-${color}.png`))
   }
   nativeMaterial={captured:true,reducedTransparency:nativeWindow.reducedTransparency}
 } catch(e) { nativeMaterial={captured:false,reason:String(e.message)};console.warn('Native screen capture unavailable:',e.message) }
 if(nativeMaterial.captured){
   assert.equal(nativeMaterial.reducedTransparency,false,'CI must enable transparency to verify native material')
   const samples=[]
   for(const color of ['black','white']){
     const image=sharp(path.join(proof,`native-${color}.png`)),meta=await image.metadata()
     // Empty centre of the title bar, away from branding, controls and character animation.
     const region=await image.extract({left:Math.floor(meta.width*.5),top:Math.floor(meta.height*.025),width:30,height:12}).removeAlpha().toBuffer()
     const stats=await sharp(region).stats()
     samples.push(stats.channels.slice(0,3).map(c=>c.mean))
   }
   nativeMaterial.samples=samples;nativeMaterial.difference=Math.max(...samples[0].map((v,i)=>Math.abs(v-samples[1][i])))
   assert(nativeMaterial.difference>2,'native macOS window still opaque over changing desktop background')
 }
 fs.writeFileSync(path.join(proof,'verification.json'),JSON.stringify({version,arch,binary,mainUI:true,macUI,skin:{facePixels,shirtPixels},nativeMaterial,url:page.url},null,2));ws.close()
 console.log('PASS native macOS '+arch+' packaged app '+version)
}
main().catch(e=>{console.error(e);process.exitCode=1}).finally(()=>{child.kill('SIGTERM');fixture.kill('SIGTERM');fs.closeSync(log)})
