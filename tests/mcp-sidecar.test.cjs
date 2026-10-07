// MCP sidecar（mcp/server.mjs）端到端测试：真实子进程 + 模拟 Host API。
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const http = require('node:http')
const { spawn } = require('node:child_process')

const SERVER = path.resolve(__dirname, '../mcp/server.mjs')
const TOKEN = 'sidecar-test-token-0123456789'
const PNG_1PX = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

function startMockHost() {
  const received = []
  const server = http.createServer((req, res) => {
    const send = (status, body) => {
      res.writeHead(status, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(body))
    }
    const url = new URL(req.url, 'http://127.0.0.1')
    if (url.pathname === '/kamucl-mcp/v1/ping') return send(200, { ok: true, protocol: 1, version: '9.9.9-test' })
    if (req.headers['x-kamucl-token'] !== TOKEN) return send(401, { ok: false, error: 'bad token' })
    const read = body => {
      if (url.pathname === '/kamucl-mcp/v1/state') return send(200, { ok: true, running: ['inst-a'], activeStates: [], lastLaunch: null, recentExits: [] })
      if (url.pathname === '/kamucl-mcp/v1/control/screenshot') return send(200, { ok: true, pngBase64: PNG_1PX, width: 1, height: 1 })
      if (url.pathname === '/kamucl-mcp/v1/control/input') { received.push(body); return send(200, { ok: true, performed: (body.actions || []).length }) }
      return send(404, { ok: false, error: 'unknown' })
    }
    if (req.method === 'POST') {
      let text = ''
      req.on('data', c => (text += c))
      req.on('end', () => read(JSON.parse(text || '{}')))
    } else read({})
  })
  return new Promise(resolve => {
    server.listen(0, '127.0.0.1', () => resolve({ server, received, port: server.address().port }))
  })
}

function writeDiscovery(dir, data) {
  const file = path.join(dir, 'mcp-server.json')
  fs.writeFileSync(file, JSON.stringify(data), { mode: 0o600 })
  return file
}

function spawnSidecar(discoveryFile) {
  const proc = spawn(process.execPath, [SERVER], {
    env: { ...process.env, KAMUCL_MCP_DISCOVERY: discoveryFile },
    stdio: ['pipe', 'pipe', 'pipe']
  })
  let buffer = ''
  const pending = new Map()
  proc.stdout.on('data', chunk => {
    buffer += chunk
    let index
    while ((index = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, index)
      buffer = buffer.slice(index + 1)
      if (!line.trim()) continue
      const message = JSON.parse(line)
      const waiter = pending.get(message.id)
      if (waiter) {
        pending.delete(message.id)
        waiter(message)
      }
    }
  })
  let nextId = 1
  const call = (method, params) =>
    new Promise((resolve, reject) => {
      const id = nextId++
      pending.set(id, resolve)
      setTimeout(() => reject(new Error(`sidecar 响应超时：${method}`)), 15000)
      proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n')
    })
  return { proc, call }
}

test('MCP sidecar：握手、工具列表与经发现文件的带令牌调用', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kamucl-mcp-sidecar-'))
  const mock = await startMockHost()
  const discoveryFile = writeDiscovery(dir, { protocol: 1, port: mock.port, token: TOKEN, pid: process.pid, launcherVersion: '9.9.9-test', startedAt: Date.now() })
  const { proc, call } = spawnSidecar(discoveryFile)
  try {
    const init = await call('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '0' } })
    assert.equal(init.result.protocolVersion, '2025-06-18')
    assert.equal(init.result.serverInfo.name, 'kamucl-launcher')

    const list = await call('tools/list')
    const names = list.result.tools.map(t => t.name)
    for (const expected of ['launcher_status', 'list_instances', 'logs_tail', 'launch_game', 'stop_game', 'game_screenshot', 'game_state', 'game_input', 'install_control_mod', 'diagnose_instance', 'bridge_set']) {
      assert.ok(names.includes(expected), `缺少工具 ${expected}`)
    }

    // 在线状态合并 ping + state（令牌必须被 mock 校验通过）
    const status = await call('tools/call', { name: 'launcher_status', arguments: {} })
    const payload = JSON.parse(status.result.content[0].text)
    assert.equal(payload.version, '9.9.9-test')
    assert.deepEqual(payload.running, ['inst-a'])

    // 截图：image content 透传
    const shot = await call('tools/call', { name: 'game_screenshot', arguments: {} })
    assert.equal(shot.result.content[0].type, 'image')
    assert.equal(shot.result.content[0].mimeType, 'image/png')
    assert.equal(shot.result.content[0].data, PNG_1PX)

    // 输入注入：actions 原样 POST 到 Host
    const actions = [{ type: 'key', key: 'W', mode: 'down' }, { type: 'exec', command: '/help' }]
    const input = await call('tools/call', { name: 'game_input', arguments: { actions } })
    assert.equal(JSON.parse(input.result.content[0].text).performed, 2)
    assert.deepEqual(mock.received[0].actions, actions)

    // 未知工具与启动器 404 均为 isError
    const unknown = await call('tools/call', { name: 'no_such_tool', arguments: {} })
    assert.equal(unknown.result.isError, true)
    const missing = await call('tools/call', { name: 'logs_tail', arguments: {} })
    assert.equal(missing.result.isError, true)
  } finally {
    proc.kill()
    mock.server.close()
  }
})

test('MCP sidecar：发现文件进程已死时给出友好离线提示', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kamucl-mcp-offline-'))
  // pid 几乎不可能存活：选一个未使用的大 pid 前先确认其不存在
  let deadPid = 4000000
  for (;;) {
    try {
      process.kill(deadPid, 0)
      deadPid++
    } catch {
      break
    }
  }
  const discoveryFile = writeDiscovery(dir, { protocol: 1, port: 1, token: TOKEN, pid: deadPid, launcherVersion: '9.9.9-test', startedAt: Date.now() })
  const { proc, call } = spawnSidecar(discoveryFile)
  try {
    const result = await call('tools/call', { name: 'launcher_status', arguments: {} })
    assert.equal(result.result.isError, true)
    assert.match(result.result.content[0].text, /启动器未运行/)
  } finally {
    proc.kill()
  }
})
