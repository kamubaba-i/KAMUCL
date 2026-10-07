import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { validateActions } from '../src/main/core/gameControlCore'
import { callControl, controlJarFor, parseControlDiscovery, CONTROL_BUILDS } from '../src/main/core/controlBridgeCore'

test('动作校验：合法动作集归一化通过', () => {
  const result = validateActions([
    { type: 'key', key: 'W', mode: 'down' },
    { type: 'mouseButton', button: 'left', mode: 'down' },
    { type: 'click', x: 100, y: 60, button: 'right' },
    { type: 'move', x: 1, y: 2 },
    { type: 'scroll', delta: -240 },
    { type: 'type', text: '/gamemode creative' },
    { type: 'chat', text: '大家好' },
    { type: 'exec', command: '/tp @p 0 80 0' },
    { type: 'look', yaw: 90, pitch: -120 },
    { type: 'lookDelta', dx: 30, dy: -10 },
    { type: 'wait', ms: 5000 }
  ])
  assert.equal(result.ok, true)
  if (!result.ok) return
  const actions = result.actions
  assert.deepEqual(actions[8], { type: 'look', yaw: 90, pitch: -90 }, 'pitch 夹持到 ±90')
  assert.deepEqual(actions[10], { type: 'wait', ms: 2000 }, 'wait 夹持到 2000ms')
})

test('动作校验：非法输入逐条拦截', () => {
  const cases: Array<[unknown, RegExp]> = [
    [undefined, /非空数组/],
    [[], /非空数组/],
    [[{ type: 'focus' }], /未知/],
    [[{ type: 'key' }], /key 无效/],
    [[{ type: 'key', key: 'W', mode: 'hold' }], /press\/down\/up/],
    [[{ type: 'mouseButton', button: 'x1' }], /button/],
    [[{ type: 'click', x: -1, y: 0 }], /坐标无效/],
    [[{ type: 'type', text: '' }], /text 为空/],
    [[{ type: 'chat', text: '' }], /text 为空/],
    [[{ type: 'exec', command: ' ' }], /command 为空/],
    [[{ type: 'look' }], /yaw 或 pitch/],
    [[{ type: 'lookDelta', dx: 99999, dy: 0 }], /增量过大/],
    [[{ type: 'wait', ms: -5 }], /ms 无效/]
  ]
  for (const [input, pattern] of cases) {
    const result = validateActions(input)
    assert.equal(result.ok, false, `应拒绝：${JSON.stringify(input)}`)
    if (!result.ok) assert.match(result.error, pattern)
  }
  assert.equal(validateActions(Array.from({ length: 33 }, () => ({ type: 'wait', ms: 1 }))).ok, false, '超过 32 个动作应拒绝')
})

test('控制构建清单与发现文件解析', () => {
  assert.ok(CONTROL_BUILDS.length >= 1)
  assert.equal(controlJarFor('1.21.1'), 'kamucl-control-1.21.1.jar')
  assert.equal(controlJarFor('1.20.1'), null)
  const valid = parseControlDiscovery({ protocol: 1, port: 23456, token: 'a'.repeat(48), modVersion: '1.0.0', mcVersion: '1.21.1', pid: 4321, startedAt: 1 })
  assert.deepEqual(valid, { protocol: 1, port: 23456, token: 'a'.repeat(48), modVersion: '1.0.0', mcVersion: '1.21.1', pid: 4321, startedAt: 1 })
  assert.equal(parseControlDiscovery({ protocol: 2, port: 1, token: 'a'.repeat(48) }), null)
  assert.equal(parseControlDiscovery({ protocol: 1, port: 0, token: 'a'.repeat(48) }), null)
  assert.equal(parseControlDiscovery({ protocol: 1, port: 70000, token: 'a'.repeat(48) }), null)
  assert.equal(parseControlDiscovery({ protocol: 1, port: 23456, token: 'short' }), null)
  assert.equal(parseControlDiscovery(null), null)
})

test('callControl：pid 校验、令牌透传与错误结构化', async () => {
  let deadPid = 4000000
  for (;;) {
    try {
      process.kill(deadPid, 0)
      deadPid++
    } catch {
      break
    }
  }
  const dead = parseControlDiscovery({ protocol: 1, port: 1, token: 'a'.repeat(48), pid: deadPid })!
  const offline = await callControl(dead, 'state')
  assert.equal(offline.ok, false)
  assert.match(offline.error!, /已退出/)

  let seenToken: string | undefined
  const server = http.createServer((req, res) => {
    seenToken = String(req.headers['x-kamucl-token'] ?? '')
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: true, inWorld: true }))
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  try {
    const port = (server.address() as { port: number }).port
    const live = parseControlDiscovery({ protocol: 1, port, token: 'b'.repeat(48), pid: process.pid })!
    const result = await callControl(live, 'state')
    assert.equal(result.ok, true)
    assert.equal(result.inWorld, true)
    assert.equal(seenToken, 'b'.repeat(48), '令牌必须随请求透传')
  } finally {
    server.close()
  }
})
