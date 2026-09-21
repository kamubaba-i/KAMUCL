import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { motionReduced, searchSettings, settingsCatalog, settingsCategories } from '../src/shared/settingsCatalog'

test('settings search resolves actual destinations and understands mixed keywords', () => {
  assert.deepEqual(searchSettings('  '), [])
  assert.equal(searchSettings('java 自动')[0].id, 'java')
  assert.equal(searchSettings('动画')[0].id, 'motion')
  assert.equal(searchSettings('限速')[0].category, 'downloads')
  assert.equal(searchSettings('G1GC')[0].id, 'jvm')
  assert.equal(searchSettings('does-not-exist').length, 0)
  const source = fs.readFileSync('src/renderer/src/views/SettingsView.vue', 'utf8')
  for (const item of settingsCatalog) {
    assert(settingsCategories.some(c => c.id === item.category))
    assert(source.includes(`data-section="${item.id}"`), `Missing actual setting: ${item.id}`)
    assert(searchSettings(item.name).some(result => result.id === item.id))
  }
})

test('reduced motion preserves legacy config semantics and always respects the OS', () => {
  assert.equal(motionReduced(undefined, false), false)
  assert.equal(motionReduced(undefined, true), true)
  assert.equal(motionReduced(false, true), true)
  assert.equal(motionReduced(true, false), true)
  assert.equal(motionReduced('false', false), false)
})
