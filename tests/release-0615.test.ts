import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import { EventEmitter } from 'node:events'
import { mcmodSearchUrl } from '../src/shared/communityLinks'
import { THEME_PRESETS } from '../src/shared/types'
import { trackMaterialLifecycle } from '../src/main/materialLifecycle'

test('百科仅发送原始英文名称，不包含中文译名（卡片与弹窗共用）', () => {
  for (const item of [
    { title: '农夫乐事 | Farmer’s Delight', originalTitle: 'Farmer’s Delight', slug: 'farmers-delight' },
    { title: '农夫乐事 | Farmer’s Delight', slug: 'farmers-delight' }
  ]) assert.equal(new URL(mcmodSearchUrl(item)!).searchParams.get('key'), 'Farmer’s Delight')
  assert.equal(new URL(mcmodSearchUrl({ title: '中文名', slug: 'english-mod' })!).searchParams.get('key'), 'english mod')
  assert.equal(mcmodSearchUrl({ title: '中文名', slug: '中文' }), null)
})

test('透明主题与设置预览共用 Tiffany Blue，其他主题不变', () => {
  assert.equal(THEME_PRESETS.transparent.colors.accent, '#81d8d0')
  assert.equal(THEME_PRESETS['black-orange'].colors.accent, '#f97316')
  const settings = fs.readFileSync('src/renderer/src/views/SettingsView.vue', 'utf8')
  assert.match(settings, /named\('transparent'\)/)
  assert.match(settings, /theme\.colors\.accent/)
})

test('最大化、还原、恢复、启动时重新应用材质，关闭取消排队刷新', async () => {
  const events = new EventEmitter()
  const calls: string[] = []
  const errors: string[] = []
  let restored = 0
  trackMaterialLifecycle(Object.assign(events, {
    isDestroyed: () => false,
    setBackgroundMaterial: (s: string) => { calls.push(s) }
  }), m => errors.push(m), () => { restored++ })
  for (const e of ['show', 'maximize', 'unmaximize', 'restore', 'leave-full-screen']) {
    events.emit(e)
    await new Promise(r => setTimeout(r, 110))
    assert.deepEqual(calls.splice(0), ['acrylic'])
  }
  events.emit('maximize'); events.emit('closed')
  await new Promise(r => setTimeout(r, 110))
  assert.deepEqual(calls, [])
  assert.deepEqual(errors, [])
  assert.equal(restored, 5)
})

test('切屏切回的 focus 事件重建材质且 1s 节流，普通点击不反复闪动', async () => {
  const events = new EventEmitter()
  const calls: string[] = []
  trackMaterialLifecycle(Object.assign(events, {
    isDestroyed: () => false,
    setBackgroundMaterial: (s: string) => { calls.push(s) }
  }), () => {}, () => {})
  events.emit('focus')
  events.emit('focus') // 立即重复 focus 被节流吞掉
  await new Promise(r => setTimeout(r, 200))
  assert.deepEqual(calls, ['acrylic'])
  events.emit('focus')
  await new Promise(r => setTimeout(r, 200))
  assert.deepEqual(calls.splice(0), ['acrylic'], '1s 内的 focus 被节流')
  await new Promise(r => setTimeout(r, 1100))
  events.emit('focus')
  await new Promise(r => setTimeout(r, 200))
  assert.deepEqual(calls, ['acrylic'], '超过节流窗口后再次重建')
})

test('便携包模板引用含空格/中文的TEMP路径，失败明确提示而非静默退出', () => {
  const require = createRequire(import.meta.url)
  const { repairPortableScript } = require('../scripts/portable-build-hook.cjs')
  const script = fs.readFileSync('node_modules/app-builder-lib/templates/nsis/portable.nsi', 'utf8')
  const fixed = repairPortableScript(script)
  assert.ok(fixed.includes(`ExecWait '"$INSTDIR\\\${APP_EXECUTABLE_FILENAME}" $R0' $0`))
  assert.ok(fixed.includes('IfErrors'))
  // 解压目标：exe 所在文件夹的固定子目录，不再落系统 TEMP 随机目录
  assert.ok(fixed.includes('StrCpy $INSTDIR "$EXEDIR\\KAMUCL-runtime"'))
  assert.ok(!fixed.includes('StrCpy $INSTDIR "$PLUGINSDIR\\app"'))
  assert.equal(repairPortableScript(fixed), fixed)
  assert.throws(() => repairPortableScript('unexpected template'), /template changed/)
  const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'))
  assert.equal(pkg.build.beforePack, 'scripts/portable-build-hook.cjs')
  assert.equal(pkg.build.portable.unpackDirName, false)
  assert.ok(pkg.build.win.target.includes('zip'))
})
