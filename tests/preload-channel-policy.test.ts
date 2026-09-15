import assert from 'node:assert/strict'
import test from 'node:test'
import {
  isAllowedInvokeChannel,
  isAllowedListenerChannel,
  isAllowedSendChannel
} from '../src/preload/channelPolicy'

test('preload allows declared IPC channels and rejects arbitrary invoke channels', () => {
  assert.equal(isAllowedInvokeChannel('accounts:list'), true)
  assert.equal(isAllowedInvokeChannel('mods:catalog'), true)
  assert.equal(isAllowedInvokeChannel('tc:install'), true)
  assert.equal(isAllowedInvokeChannel('voxlink:useTurnRelay'), true)
  assert.equal(isAllowedInvokeChannel('readFile'), false)
  assert.equal(isAllowedInvokeChannel('webContents:executeJavaScript'), false)
})

test('preload separates event subscriptions from renderer sends', () => {
  assert.equal(isAllowedListenerChannel('event:progress'), true)
  assert.equal(isAllowedListenerChannel('tc:event'), true)
  assert.equal(isAllowedListenerChannel('window:caption-pointerdown'), true)
  assert.equal(isAllowedListenerChannel('accounts:list'), false)
  assert.equal(isAllowedSendChannel('window:close'), true)
  assert.equal(isAllowedSendChannel('boot:renderer-ready'), true)
  assert.equal(isAllowedSendChannel('event:progress'), false)
})
