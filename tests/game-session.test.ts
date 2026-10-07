import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once, EventEmitter } from 'node:events'
import type { ChildProcess } from 'node:child_process'
import { GameSession } from '../src/main/core/gameSession'

test('launch reservation allows multi-instance and tracks each session by token', () => {
  const session = new GameSession()
  const first = session.reserve('A')
  // 多开：第二次 reserve 不再互斥
  const second = session.reserve('B')
  assert(session.isRunning('A') && session.isRunning('B'))
  assert.equal(session.count, 2)
  assert(session.release(first))
  assert(!session.release(first))
  assert(session.isRunning('B'))
  assert.equal(session.versionId, 'B')
  session.release(second)
  assert(!session.busy)
})
test('rejected termination leaves the game owned and clears temporary listeners', async () => {
  const session = new GameSession()
  const token = session.reserve('alive')
  const child = Object.assign(new EventEmitter(), { exitCode: null, signalCode: null, kill: () => false })
  session.attach(token, child as unknown as ChildProcess)
  await assert.rejects(session.stop(), /未接受/)
  assert(session.busy)
  assert.equal(child.listenerCount('close'), 0)
  assert.equal(child.listenerCount('error'), 0)
})
test('an exited forwarding process with inherited open streams cannot falsely confirm game termination', async () => {
  const session = new GameSession()
  const token = session.reserve('forwarder')
  const child = Object.assign(new EventEmitter(), { exitCode: 0, signalCode: null, kill: () => { throw Error('must not kill reused PID') } })
  session.attach(token, child as unknown as ChildProcess)
  await assert.rejects(session.stop(20), /尚未确认退出/)
  assert(session.busy)
})
test('stop waits for the owned real process to exit and never announces success for missing process', async () => {
  const session = new GameSession()
  await assert.rejects(session.stop(), /没有/)
  const token = session.reserve('fixture')
  await assert.rejects(session.stop(), /准备/)
  const child = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { windowsHide: true, stdio: 'ignore' })
  session.attach(token, child)
  const closed = once(child, 'close')
  child.once('close', () => session.release(token))
  await once(child, 'spawn')
  try { await session.stop(); await closed; assert(!session.busy) }
  finally { if (child.exitCode === null && child.signalCode === null) child.kill() }
})
test('list reports every running session with its pid for per-instance addressing', () => {
  const session = new GameSession()
  const preparing = session.reserve('preparing')
  const running = session.reserve('running')
  const child = Object.assign(new EventEmitter(), { pid: 43210, exitCode: null, signalCode: null, kill: () => true })
  session.attach(running, child as unknown as ChildProcess)
  assert.deepEqual(session.list(), [{ versionId: 'preparing', pid: undefined }, { versionId: 'running', pid: 43210 }])
  session.release(preparing)
  assert.deepEqual(session.list(), [{ versionId: 'running', pid: 43210 }])
  session.release(running)
  assert.deepEqual(session.list(), [])
})
