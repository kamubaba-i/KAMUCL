import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createMcpHostServer, type McpHostDeps, type McpHostServer } from '../src/main/core/mcpHost'

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kamucl-mcp-host-'))
  const userData = path.join(root, 'userData')
  const instance = path.join(root, 'instance')
  fs.mkdirSync(path.join(instance, 'logs'), { recursive: true })
  fs.mkdirSync(path.join(instance, 'crash-reports'), { recursive: true })
  fs.mkdirSync(userData, { recursive: true })
  const secret = 'session-secret-token-1234'
  fs.writeFileSync(
    path.join(instance, 'logs', 'latest.log'),
    ['[12:00:00] 游戏启动中', `--accessToken ${secret} --username Player`, `保存在 ${os.homedir()}\\saves`, '[12:00:01] 世界已加载'].join('\n')
  )
  fs.writeFileSync(path.join(instance, 'crash-reports', 'crash-2026-01-01.txt'), `---- Minecraft Crash Report ----\njava.lang.OutOfMemoryError\n--accessToken ${secret}`)
  const calls: Array<{ fn: string; args: unknown[] }> = []
  const deps: McpHostDeps = {
    userDataDir: () => userData,
    launcherVersion: () => '9.9.9-test',
    listInstances: () => [{ id: 'inst-a', mcVersion: '1.21.1', loader: 'fabric' }, { id: 'inst-b', mcVersion: '1.20.1' }],
    runningVersionIds: () => new Set(['inst-a']),
    activeStates: () => [{ status: 'running', versionId: 'inst-a' }],
    lastLaunch: () => ({ versionId: 'inst-a', pid: 1234, logDir: path.join(root, 'no-session') }),
    recentExits: () => [{ kind: 'game', exitCode: 0 }],
    runningGames: () => [{ versionId: 'inst-a', pid: 1234 }],
    sessionFor: versionId => (versionId === undefined || versionId === 'inst-a' ? { versionId: 'inst-a', logDir: path.join(root, 'no-session') } : null),
    instanceDir: () => instance,
    launchGame: (versionId, folder, serverAddress) => {
      calls.push({ fn: 'launch', args: [versionId, folder, serverAddress] })
      return { ok: true, launchId: 'launch-x' }
    },
    stopGame: async (versionId, forceToken) => {
      calls.push({ fn: 'stop', args: [versionId, forceToken] })
      return { requiresForce: false }
    },
    bridgeStatus: async versionId => ({ connected: true, versionId }),
    bridgeManifest: async () => ({ protocol: 1, params: [] }),
    bridgeSet: async (_v, id, value) => ({ ok: true, id, value }),
    bridgeReset: async () => ({ ok: true }),
    diagnose: async versionId => ({ id: versionId, findings: [] }),
    capture: async () => ({ ok: true, pngBase64: Buffer.from('png').toString('base64'), width: 2, height: 1 }),
    input: async (_v, actions) => (Array.isArray(actions) && actions.length ? { ok: true, performed: actions.length } : { ok: false, error: '无效动作' }),
    controlState: async versionId => ({ ok: true, inWorld: true, versionId }),
    controlInstall: versionId => {
      calls.push({ fn: 'controlInstall', args: [versionId] })
      return { ok: true }
    },
    log: { info: () => undefined, warn: () => undefined, error: () => undefined }
  }
  return { root, userData, instance, secret, calls, deps }
}

async function startServer(): Promise<{ server: McpHostServer; token: string; fx: ReturnType<typeof fixture> }> {
  const fx = fixture()
  const server = await createMcpHostServer(fx.deps)
  const discovery = JSON.parse(fs.readFileSync(server.discoveryFile(), 'utf-8'))
  return { server, token: discovery.token, fx }
}

async function api(server: McpHostServer, route: string, options: { token?: string; method?: string; body?: unknown } = {}) {
  const res = await fetch(`http://127.0.0.1:${server.port()}/kamucl-mcp/v1${route}`, {
    method: options.method ?? 'GET',
    headers: {
      ...(options.token ? { 'X-Kamucl-Token': options.token } : {}),
      ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' })
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body)
  })
  return { status: res.status, data: await res.json() }
}

test('MCP Host：发现文件格式与 ping 免令牌', async () => {
  const { server, token } = await startServer()
  try {
    const discovery = JSON.parse(fs.readFileSync(server.discoveryFile(), 'utf-8'))
    assert.equal(discovery.protocol, 1)
    assert.equal(discovery.port, server.port())
    assert.equal(discovery.token, token)
    assert.equal(discovery.pid, process.pid)
    assert.equal(discovery.launcherVersion, '9.9.9-test')
    const ping = await api(server, '/ping')
    assert.equal(ping.status, 200)
    assert.equal(ping.data.ok, true)
    assert.equal(ping.data.version, '9.9.9-test')
  } finally {
    await server.close()
  }
})

test('MCP Host：除 ping 外一律要求令牌，实例列表带运行标记', async () => {
  const { server, token } = await startServer()
  try {
    assert.equal((await api(server, '/instances')).status, 401)
    assert.equal((await api(server, '/instances', { token: 'wrong-token' })).status, 401)
    assert.equal((await api(server, '/state', { token })).status, 200)
    const list = await api(server, '/instances', { token })
    assert.equal(list.status, 200)
    assert.deepEqual(
      list.data.instances.map((v: { id: string; running: boolean }) => [v.id, v.running]),
      [['inst-a', true], ['inst-b', false]]
    )
  } finally {
    await server.close()
  }
})

test('MCP Host：日志尾部读取经过脱敏（令牌与用户目录不外泄）', async () => {
  const { server, token, fx } = await startServer()
  try {
    const res = await api(server, '/logs/tail?versionId=inst-a&source=game&lines=50', { token })
    assert.equal(res.status, 200)
    assert.ok(!res.data.content.includes(fx.secret), '日志中的会话令牌必须被脱敏')
    assert.ok(!res.data.content.includes(os.homedir()), '日志中的用户目录必须被脱敏')
    assert.ok(res.data.content.includes('世界已加载'))
    // offset 增量拉取：传回 offset 后只取新内容
    const again = await api(server, `/logs/tail?versionId=inst-a&source=game&offset=${res.data.offset}`, { token })
    assert.equal(again.status, 200)
    assert.equal(again.data.content.trim(), '')
    // source 校验
    assert.equal((await api(server, '/logs/tail?source=game', { token })).status, 400)
  } finally {
    await server.close()
  }
})

test('MCP Host：崩溃报告列表与读取（脱敏）', async () => {
  const { server, token, fx } = await startServer()
  try {
    const list = await api(server, '/crashes?versionId=inst-a', { token })
    assert.equal(list.status, 200)
    assert.deepEqual(list.data.reports.map((r: { file: string }) => r.file), ['crash-2026-01-01.txt'])
    const read = await api(server, '/crash?versionId=inst-a', { token })
    assert.equal(read.status, 200)
    assert.ok(read.data.content.includes('OutOfMemoryError'))
    assert.ok(!read.data.content.includes(fx.secret))
    const missing = await api(server, '/crash?versionId=inst-a&file=nope.txt', { token })
    assert.equal(missing.status, 404)
    const evil = await api(server, '/crash?versionId=inst-a&file=..%2F..%2Fevil.txt', { token })
    assert.equal(evil.status, 404)
  } finally {
    await server.close()
  }
})

test('MCP Host：启动/停止/桥接/控制映射到依赖并校验参数', async () => {
  const { server, token, fx } = await startServer()
  try {
    assert.equal((await api(server, '/launch', { token, method: 'POST', body: {} })).status, 400)
    const launch = await api(server, '/launch', { token, method: 'POST', body: { versionId: 'inst-a', serverAddress: 'play.example.com' } })
    assert.equal(launch.status, 200)
    assert.equal(launch.data.launchId, 'launch-x')
    assert.deepEqual(fx.calls[0], { fn: 'launch', args: ['inst-a', undefined, 'play.example.com'] })

    const stop = await api(server, '/stop', { token, method: 'POST', body: {} })
    assert.equal(stop.status, 200)
    assert.deepEqual(fx.calls[1], { fn: 'stop', args: [undefined, undefined] })
    const stopOne = await api(server, '/stop', { token, method: 'POST', body: { versionId: 'inst-a' } })
    assert.equal(stopOne.status, 200)
    assert.deepEqual(fx.calls[2], { fn: 'stop', args: ['inst-a', undefined] })

    const shot = await api(server, '/control/screenshot', { token, method: 'POST', body: {} })
    assert.equal(shot.status, 200)
    assert.equal(shot.data.width, 2)

    const input = await api(server, '/control/input', { token, method: 'POST', body: { actions: [{ type: 'key', key: 'W', mode: 'down' }, { type: 'exec', command: '/help' }] } })
    assert.equal(input.status, 200)
    assert.equal(input.data.performed, 2)
    const badInput = await api(server, '/control/input', { token, method: 'POST', body: {} })
    assert.equal(badInput.status, 400)

    // 控制状态与控制 MOD 安装（versionId 缺省回退到最近启动实例）
    const state = await api(server, '/control/state', { token })
    assert.equal(state.status, 200)
    assert.equal(state.data.inWorld, true)
    const install = await api(server, '/control/install', { token, method: 'POST', body: { versionId: 'inst-a' } })
    assert.equal(install.status, 200)
    assert.deepEqual(fx.calls[fx.calls.length - 1], { fn: 'controlInstall', args: ['inst-a'] })

    const bridge = await api(server, '/bridge/status?versionId=inst-a', { token })
    assert.equal(bridge.data.status.connected, true)
    const set = await api(server, '/bridge/set', { token, method: 'POST', body: { versionId: 'inst-a', id: 'p1', value: 5 } })
    assert.equal(set.data.result.value, 5)

    assert.equal((await api(server, '/nonexistent', { token })).status, 404)
  } finally {
    await server.close()
  }
})

test('MCP Host：关闭后删除发现文件', async () => {
  const { server } = await startServer()
  const file = server.discoveryFile()
  assert.ok(fs.existsSync(file))
  await server.close()
  assert.ok(!fs.existsSync(file))
})
