import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import ts from 'typescript'
import { computed, ref } from 'vue'
import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc'

const read = (file: string) => fs.readFileSync(file, 'utf8')
const home = read('src/renderer/src/views/HomeView.vue')
const notice = read('src/renderer/src/components/LaunchNotice.vue')
const transpile = (code: string) => ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText

test('Java summary shows effective automatic policy, never first scanned runtime', () => {
  const expression = home.slice(home.indexOf('const javaText ='), home.indexOf('const javaPicker ='))
  const current = ref<any>({}), store: any = { settings: { javaAuto: true, javaPath: 'global-java' } }
  const javas = ref([{ path: 'wrong-java', version: '8', is64Bit: true }, { path: 'manual-java', version: '25', is64Bit: true }])
  const value = new Function('computed', 'currentVersion', 'store', 'javas', transpile(expression) + ';return javaText')(computed, current, store, javas)
  assert.equal(value.value, '自动选择')
  current.value = { javaPath: 'manual-java' }
  assert.equal(value.value, 'Java 25 (64-bit)')
  current.value = { javaAuto: true, javaPath: 'manual-java' }
  store.settings.javaAuto = false
  assert.equal(value.value, '自动选择')
  current.value = {}
  assert.equal(value.value, 'global-java')
})

test('instance Java setter persists automatic/manual/inherited without changing global settings', () => {
  const source = read('src/main/core/versions.ts')
  const setter = source.slice(source.indexOf('export function setVersionJava('), source.indexOf('/** 实例级窗口设置'))
  let profile: any = { _javaPath: 'old', custom: 'preserve' }, saved: any
  const fn = new Function('versionJsonPath', 'readVersionJson', 'fs', transpile(setter.replace('export ', '')) + '; return setVersionJava')(
    (id: string) => '/fixture/' + id, () => ({ ...profile }), { writeFileSync: (_path: string, json: string) => { saved = JSON.parse(json); profile = saved } })
  fn('a', '', true)
  assert.deepEqual(saved, { _javaAuto: true, custom: 'preserve' })
  fn('a', 'new-java')
  assert.deepEqual(saved, { _javaPath: 'new-java', custom: 'preserve' })
  fn('a', '')
  assert.deepEqual(saved, { custom: 'preserve' })
  assert.match(read('src/main/core/launch.ts'), /if \(instanceConfig\._javaAuto === true\) \{\s+javaPath = await ensureJava/)
  assert.match(read('src/main/ipc.ts'), /withGameFolder\(\s*folder && String\(folder\)\.trim\(\)[\s\S]*?registeredGameFolder[\s\S]*?folderOfVersion/)
})

test('launch notice follows actual running event, dismisses on timeout/error and cancels timers', () => {
  const script = parse(notice).descriptor.scriptSetup!.content.replace(/^import .*$/gm, '')
  let callback: any, cleanup: any, expire: any, cleared = 0
  const visible = new Function('ref', 'watch', 'onUnmounted', 'store', 'setTimeout', 'clearTimeout', transpile(script) + ';return visible')(
    ref, (_: any, cb: any) => { callback = cb }, (cb: any) => { cleanup = cb }, {},
    (cb: any, ms: number) => { assert.equal(ms, 3200); expire = cb; return 1 }, () => { cleared++ })
  callback({ status: 'launching' }); assert.equal(visible.value, false)
  callback({ status: 'running' }); assert.equal(visible.value, true)
  expire(); assert.equal(visible.value, false)
  callback({ status: 'running' }); callback({ status: 'error' }); assert.equal(visible.value, false)
  callback({ status: 'running' }); cleanup(); assert.equal(visible.value, false)
  assert.ok(cleared >= 6)
  assert.match(notice, /pointer-events: none/)
})

test('caption hook preserves native dragging and closes all three dropdowns', () => {
  const main = read('src/main/index.ts'), app = read('src/renderer/src/App.vue')
  assert.match(main, /hookWindowMessage\(0x00A1/)
  assert.match(main, /wParam.readUInt32LE\(0\) === 2/)
  assert.match(app, /window.kamucl.on\('window:caption-pointerdown', closeTopDropdowns\)/)
  assert.match(app, /function closeTopDropdowns\(\) \{\s+noticeOpen.value = false\s+dlOpen.value = false\s+notesOpen.value = false/)
})

test('foreground helper is packaged, PID scoped, bounded, verifies foreground and detaches input', () => {
  const native = read('native/GameWindowFocus.cs'), focus = read('src/main/core/gracefulClose.ts')
  assert.match(native, /owner == pid/)
  assert.match(native, /GetForegroundWindow\(\) == window/)
  assert.match(native, /finally \{ if \(attached\) AttachThreadInput\(thisThread, foregroundThread, false\)/)
  assert.match(native, /game.HasExited/)
  assert.match(focus, /timeout: timeoutMs \+ 2000/)
  assert.match(focus, /child.once\('exit', cancel\)/)
  assert.ok(!focus.includes('Add-Type'))
  assert.ok(!native.includes('ClipCursor('))
  assert.ok(JSON.parse(read('package.json')).build.asarUnpack.includes('out/main/GameWindowFocus.exe'))
})

test('launch feedback and Java picker Vue templates compile', () => {
  for (const [file, source] of [['HomeView.vue', home], ['LaunchNotice.vue', notice]]) {
    const { descriptor, errors } = parse(source)
    assert.deepEqual(errors, [])
    const script = compileScript(descriptor, { id: file })
    assert.deepEqual(compileTemplate({ source: descriptor.template!.content, filename: file, id: file, compilerOptions: { bindingMetadata: script.bindings } }).errors, [])
  }
})
