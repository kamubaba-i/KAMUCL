// Native integration test: use the packaged launcher's real install/launch IPC.
// Restricted to disposable GitHub runners; never touches a player's instances.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict')
const { spawn, execFileSync } = require('node:child_process')
assert.equal(process.platform, 'darwin'); assert.equal(process.env.GITHUB_ACTIONS, 'true')
const app = path.resolve(process.argv[2]), arch = process.argv[3]
assert.equal(process.arch, arch)
const proof = path.resolve(`release/mac-game-proof-${arch}`)
fs.mkdirSync(proof, { recursive: true })
const log = fs.openSync(path.join(proof, 'launcher.log'), 'w'), env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE
const child = spawn(path.join(app, 'Contents/MacOS/KAMUCL'), ['--remote-debugging-port=9230', '--inspect=9231'], { env, stdio: ['ignore', log, log] })
const wait = ms => new Promise(r => setTimeout(r, ms))
let ws, mainWs, evaluate, gamePid, gameFolder, events = []
async function main() {
  let page
  for (let i = 0; i < 60; i++) {
    try { page = (await (await fetch('http://127.0.0.1:9230/json')).json()).find(p => p.url.includes('/renderer/index.html')) } catch {}
    if (page) break
    assert.equal(child.exitCode, null); await wait(1000)
  }
  assert(page, 'renderer missing')
  ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((r, j) => { ws.addEventListener('open', r, { once: true }); ws.addEventListener('error', j, { once: true }) })
  let id = 0; const pending = new Map()
  ws.addEventListener('message', e => { const m = JSON.parse(e.data); pending.get(m.id)?.(m); pending.delete(m.id) })
  evaluate = (expression) => new Promise((resolve, reject) => {
    const n = ++id, timer = setTimeout(() => reject(Error('IPC evaluation timed out')), 30000)
    pending.set(n, m => { clearTimeout(timer); const r = m.result; m.error || r?.exceptionDetails ? reject(Error(JSON.stringify(m.error || r.exceptionDetails))) : resolve(r.result.value) })
    ws.send(JSON.stringify({ id: n, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } }))
  })
  await wait(3000)
  const folder = await evaluate(`(async()=>{
    window.__gameTestEvents=[];
    for(const name of ['launchLog','launchState','installDone','progress']) window.kamucl.on('event:'+name,value=>{window.__gameTestEvents.push({name,value});});
    await window.kamucl.invoke('settings:set',{mirror:'official',javaAuto:true,memoryAuto:false,memoryMB:2048,closeAfterLaunch:false,autoUpdate:false});
    await window.kamucl.invoke('accounts:addOffline','NativeMacTest');
    return (await window.kamucl.invoke('folders:list')).active;
  })()`)
  gameFolder = folder
  // Force the reported fresh-install scenario, even if the runner image has Java 25.
  console.log('Hidden runner runtimes', await evaluate(`(async()=>{const list=await window.kamucl.invoke('java:list');const hidden=list.filter(j=>j.major>=25).map(j=>j.path);await window.kamucl.invoke('settings:set',{javaHidden:hidden});return hidden;})()`))
  const version = process.env.MAC_GAME_VERSION || '26.2'
  await evaluate(`window.kamucl.invoke('versions:install',${JSON.stringify(version)},{loader:'fabric',loaderVersion:'0.19.5'})`)
  let installed
  for (let i = 0; i < 600; i++) {
    const batch = await evaluate('window.__gameTestEvents.splice(0)'); events.push(...batch)
    installed = batch.find(e => e.name === 'installDone')?.value
    if (installed) break
    if (i % 15 === 0) console.log('Install', batch.filter(e => e.name === 'progress').at(-1)?.value?.text || 'waiting')
    await wait(1000)
  }
  assert(installed?.ok, 'installation failed: ' + JSON.stringify(installed))
  // Block only Temurin's binary host, reproducing a working metadata lookup but
  // failed GitHub download. Instrument the disposable app via Node's inspector;
  // no production test switches or network-validation bypass are introduced.
  const mainTarget = (await (await fetch('http://127.0.0.1:9231/json')).json())[0]
  mainWs = new WebSocket(mainTarget.webSocketDebuggerUrl)
  await new Promise((r,j)=>{mainWs.addEventListener('open',r,{once:true});mainWs.addEventListener('error',j,{once:true})})
  await new Promise((resolve,reject)=>{
    mainWs.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.id===1)m.result?.exceptionDetails?reject(Error(JSON.stringify(m.result.exceptionDetails))):resolve()})
    mainWs.send(JSON.stringify({id:1,method:'Runtime.evaluate',params:{expression:`process.mainModule.require('electron').session.defaultSession.webRequest.onBeforeRequest({urls:['https://github.com/adoptium/*']},(details,callback)=>callback({cancel:true}));const cp=process.mainModule.require('child_process'),originalSpawn=cp.spawn;cp.spawn=function(...args){const child=originalSpawn.apply(this,args);if(String(args[0]).endsWith('/bin/java'))child.on('exit',(code,signal)=>console.log('[native-java-exit]',child.pid,code,signal));return child;}`}}))
  })
  // Run the official demo, without requiring or exporting player credentials.
  const idPath = path.join(folder, 'versions', installed.installedId, `${installed.installedId}.json`)
  const metadata = JSON.parse(fs.readFileSync(idPath, 'utf8'))
  metadata.arguments ??= {}; metadata.arguments.game ??= []
  metadata.arguments.game.push('--demo'); fs.writeFileSync(idPath, JSON.stringify(metadata))
  await evaluate(`window.kamucl.invoke('game:launch',${JSON.stringify(installed.installedId)},null,${JSON.stringify(folder)})`)
  let nativeWindow, lastState
  const fixture = path.resolve(`release/mac-proof-${arch}/material-fixture`)
  for (let i = 0; i < 240; i++) {
    const batch = await evaluate('window.__gameTestEvents.splice(0)'); events.push(...batch)
    for (const e of batch) {
      if (e.name === 'launchState') { lastState = e.value; console.log('Launch state', lastState) }
      if (e.name === 'launchLog') { console.log(e.value); const match = /游戏进程已启动.*pid=(\d+)/.exec(e.value); if (match) gamePid = Number(match[1]) }
    }
    // launch PID is persisted by the real launcher; never discover/kill unrelated Java processes.
    if (!gamePid) {
      const homes = [path.join(process.env.HOME, 'Library/Application Support/kamucl'), path.join(process.env.HOME, 'Library/Application Support/KAMUCL')]
      for (const home of homes) {
        try { const info = JSON.parse(fs.readFileSync(path.join(home, 'running-game.json'), 'utf8')); if (info.versionId === installed.installedId) gamePid = info.pid } catch {}
      }
    }
    assert(!['error', 'exited'].includes(lastState?.status), 'game failed: ' + JSON.stringify(lastState))
    if (gamePid) try { nativeWindow = JSON.parse(execFileSync(fixture, ['--window-id', String(gamePid)], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })) } catch {}
    if (gamePid && i === 90) {
      try { execFileSync('/usr/bin/sample', [String(gamePid), '3', '-file', path.join(proof, 'game-sample.txt')], { timeout: 15000, stdio: 'ignore' }) } catch {}
      try { execFileSync(path.join(process.env.JAVA_HOME,'bin/jcmd'), [String(gamePid),'Thread.print'], { timeout: 15000, stdio: ['ignore', fs.openSync(path.join(proof,'game-threads.txt'),'w'), 'ignore'] }) } catch {}
    }
    if (nativeWindow && events.some(e => e.name === 'launchLog' && /OpenAL initialized|Created: .*textures|Reloading ResourceManager/.test(e.value))) break
    await wait(1000)
  }
  assert(nativeWindow, 'Minecraft did not create a native window')
  assert(events.some(e => e.name === 'progress' && /Java 25 就绪 · Azul Zulu/.test(e.value.text)), 'Java fallback was not exercised')
  await wait(10000)
  events.push(...await evaluate('window.__gameTestEvents.splice(0)'))
  assert(!events.some(e => e.name === 'launchState' && ['error', 'exited'].includes(e.value.status)), 'game exited during initialization')
  execFileSync('/usr/sbin/screencapture', ['-x', '-D', '1', path.join(proof, 'minecraft.png')])
  fs.writeFileSync(path.join(proof, 'verification.json'), JSON.stringify({ arch, version, nativeWindow, gamePid, gameWindow: true }, null, 2))
  console.log('PASS actual Minecraft window', arch, version)
}
main().catch(e => { console.error(e); process.exitCode = 1 }).finally(async () => {
  try { if (evaluate) events.push(...await evaluate('window.__gameTestEvents.splice(0)')) } catch {}
  fs.writeFileSync(path.join(proof, 'events.json'), JSON.stringify(events, null, 2))
  if (process.exitCode) {
    await wait(10000) // macOS writes its native crash report asynchronously.
    for (const [name, command, args] of [
      ['graphics.txt', '/usr/sbin/system_profiler', ['SPDisplaysDataType']],
      ['native-system.log', '/usr/bin/log', ['show', '--last', '5m', '--style', 'compact', '--predicate', 'process == "java" OR eventMessage CONTAINS "java"']]
    ]) try { fs.writeFileSync(path.join(proof, name), execFileSync(command, args, { timeout: 20000, maxBuffer: 8 * 1024 * 1024 })); } catch {}
  }
  // Preserve native crash evidence as well as Java stdout in the disposable runner.
  for (const root of [gameFolder, path.join(process.env.HOME, 'Library/Logs/DiagnosticReports'), '/Library/Logs/DiagnosticReports']) {
    if (!root || !fs.existsSync(root)) continue
    const walk = (dir, depth) => {
      if (depth > 4) return
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const file = path.join(dir, entry.name)
        if (entry.isDirectory()) walk(file, depth + 1)
        else if (entry.isFile() && /^(hs_err_pid.*\.log|java.*\.(ips|crash)|crash-.*\.txt)$/.test(entry.name)) {
          fs.copyFileSync(file, path.join(proof, entry.name))
          console.log('Native crash evidence', entry.name, fs.readFileSync(file, 'utf8').slice(0, 20000))
        }
      }
    }
    try { walk(root, 0) } catch (e) { console.log('Crash evidence read', e.message) }
  }
  if (gamePid) try { process.kill(gamePid, 'SIGTERM') } catch {}
  mainWs?.close(); ws?.close(); child.kill('SIGTERM'); fs.closeSync(log)
})
