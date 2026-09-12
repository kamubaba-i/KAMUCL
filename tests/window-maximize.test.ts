import test from 'node:test'
import assert from 'node:assert/strict'
import { applyMaximized, isEffectivelyMaximized, toggleMaximize } from '../src/main/windowState'
import type { BrowserWindow } from 'electron'

function fixture() {
  let maximized = false, destroyed = false
  const calls: string[] = []
  const window = {
    isDestroyed: () => destroyed,
    isMaximized: () => maximized,
    maximize: () => { calls.push('maximize'); maximized = true },
    unmaximize: () => { calls.push('unmaximize'); maximized = false }
  } as unknown as BrowserWindow
  return { window, calls, systemMaximize: (value: boolean) => { maximized = value }, destroy: () => { destroyed = true } }
}

test('caption/snap changes and button changes share the OS maximize state', () => {
  const f = fixture()
  f.systemMaximize(true) // titlebar double-click / Win+Up
  assert.equal(isEffectivelyMaximized(f.window), true)
  toggleMaximize(f.window)
  assert.deepEqual(f.calls, ['unmaximize'])
  f.systemMaximize(false) // dragging out of maximized state
  toggleMaximize(f.window)
  assert.deepEqual(f.calls, ['unmaximize', 'maximize'])
})

test('reopening a window restores native maximization without leaking state across windows', () => {
  const first = fixture(), second = fixture()
  applyMaximized(first.window); applyMaximized(first.window)
  assert.deepEqual(first.calls, ['maximize'])
  assert.equal(isEffectivelyMaximized(second.window), false)
  toggleMaximize(second.window)
  assert.deepEqual(second.calls, ['maximize'])
  first.destroy(); toggleMaximize(first.window); applyMaximized(first.window)
  assert.equal(isEffectivelyMaximized(first.window), false)
  assert.deepEqual(first.calls, ['maximize'])
})
