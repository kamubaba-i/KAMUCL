#!/usr/bin/env node
/**
 * KAMUCL MCP sidecar：把启动器的 MCP Host API 暴露为标准 MCP（Model Context Protocol）工具。
 * 零依赖（Node ≥ 18），AI 客户端以 stdio 方式拉起本脚本：
 *   node /path/to/KAMUCL/mcp/server.mjs
 *
 * 发现机制：读取启动器 userData 下的 mcp-server.json（端口 + 一次性 token，
 * 仅 127.0.0.1，本机可读即授权，与 KAMUCL Bridge 同一安全模型）。
 * 每次工具调用都重新读发现文件，启动器重启后自动跟随。
 * 诊断信息只写 stderr；stdout 只承载协议消息。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import readline from 'node:readline'

const PROTOCOL_VERSION_FALLBACK = '2024-11-05'
const SERVER_NAME = 'kamucl-launcher'
const SERVER_VERSION = '1.0.0'
const DEFAULT_TIMEOUT_MS = 5000

// ---------------- 发现文件 ----------------

function discoveryCandidates() {
  const home = os.homedir()
  const roots = []
  if (process.platform === 'win32') roots.push(process.env.APPDATA || path.join(home, 'AppData', 'Roaming'))
  else if (process.platform === 'darwin') roots.push(path.join(home, 'Library', 'Application Support'))
  else roots.push(process.env.XDG_CONFIG_HOME || path.join(home, '.config'))
  const files = []
  for (const root of roots) for (const name of ['KAMUCL', 'kamucl']) files.push(path.join(root, name, 'mcp-server.json'))
  return files
}

function readDiscovery() {
  if (process.env.KAMUCL_MCP_DISCOVERY) {
    try { return JSON.parse(fs.readFileSync(process.env.KAMUCL_MCP_DISCOVERY, 'utf-8')) } catch { return null }
  }
  for (const file of discoveryCandidates()) {
    try {
      const raw = JSON.parse(fs.readFileSync(file, 'utf-8'))
      if (raw?.protocol === 1 && Number.isInteger(raw.port) && typeof raw.token === 'string') return raw
    } catch { /* 尝试下一个候选 */ }
  }
  return null
}

function launcherOfflineError() {
  return 'KAMUCL 启动器未运行或未开启 MCP（settings.json 中 mcpEnabled=false 会关闭）。请先启动 KAMUCL 启动器后重试。'
}

async function callLauncher(pathname, { method = 'GET', body, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const discovery = readDiscovery()
  if (!discovery) return { ok: false, offline: true, error: launcherOfflineError() }
  try {
    process.kill(discovery.pid, 0)
  } catch {
    return { ok: false, offline: true, error: launcherOfflineError() + '（检测到过期的发现文件）' }
  }
  let response
  try {
    response = await fetch(`http://127.0.0.1:${discovery.port}/kamucl-mcp/v1${pathname}`, {
      method,
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        'X-Kamucl-Token': discovery.token,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' })
      },
      body: body === undefined ? undefined : JSON.stringify(body)
    })
  } catch (error) {
    return { ok: false, offline: true, error: `无法连接启动器（${error instanceof Error ? error.message : String(error)}）` }
  }
  let data
  try {
    data = await response.json()
  } catch {
    return { ok: false, error: `启动器响应异常（HTTP ${response.status}）` }
  }
  if (!response.ok || data?.ok === false) return { ok: false, error: data?.error || `HTTP ${response.status}` }
  return { ok: true, data }
}

// ---------------- 工具定义 ----------------

const idParam = { type: 'string', description: '实例 id（游戏版本名）' }
const TOOLS = [
  {
    name: 'launcher_status',
    description: '启动器在线状态、版本与运行中的游戏概览。调用其他工具前可先探测。',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    run: async () => {
      const ping = await callLauncher('/ping')
      if (!ping.ok) return ping
      const state = await callLauncher('/state')
      return state.ok ? { ok: true, data: { version: ping.data.version, protocol: ping.data.protocol, ...state.data } } : state
    }
  },
  {
    name: 'list_instances',
    description: '列出全部游戏实例：id、MC 版本、加载器、游戏目录、是否版本隔离、是否正在运行。',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    run: () => callLauncher('/instances')
  },
  {
    name: 'get_launch_state',
    description: '当前启动状态机：进行中的启动阶段、最近一次启动上下文（pid、日志目录、退出码）、近期退出记录。',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    run: () => callLauncher('/state')
  },
  {
    name: 'logs_tail',
    description: '读取游戏/启动日志尾部。source：session=最近会话综合日志（默认）、stdout、stderr、game=实例 logs/latest.log（需 versionId）。offset 用于增量拉取：把上次返回的 offset 传回即可只取新内容。',
    inputSchema: {
      type: 'object',
      properties: {
        versionId: { ...idParam, description: '实例 id（source=game 必填；session 类源可省略=最近会话）' },
        source: { type: 'string', enum: ['session', 'stdout', 'stderr', 'game'], description: '日志来源，默认 session' },
        lines: { type: 'number', description: '尾部行数（1-1000，默认 200）' },
        offset: { type: 'number', description: '字节偏移（增量拉取；省略则按 lines 取尾部）' }
      },
      additionalProperties: false
    },
    run: args => {
      const params = new URLSearchParams()
      if (args.versionId) params.set('versionId', String(args.versionId))
      if (args.source) params.set('source', String(args.source))
      if (args.lines !== undefined) params.set('lines', String(args.lines))
      if (args.offset !== undefined) params.set('offset', String(args.offset))
      return callLauncher(`/logs/tail?${params}`)
    }
  },
  {
    name: 'list_crash_reports',
    description: '列出实例的崩溃报告（crash-reports 目录，按时间倒序，最多 20 份）。',
    inputSchema: { type: 'object', properties: { versionId: idParam }, required: ['versionId'], additionalProperties: false },
    run: args => callLauncher(`/crashes?versionId=${encodeURIComponent(String(args.versionId))}`)
  },
  {
    name: 'read_crash_report',
    description: '读取崩溃报告内容（默认最新一份；超大报告取尾部关键部分，含堆栈与模组清单）。',
    inputSchema: {
      type: 'object',
      properties: { versionId: idParam, file: { type: 'string', description: '报告文件名（省略=最新）' } },
      required: ['versionId'],
      additionalProperties: false
    },
    run: args => callLauncher(`/crash?versionId=${encodeURIComponent(String(args.versionId))}${args.file ? `&file=${encodeURIComponent(String(args.file))}` : ''}`)
  },
  {
    name: 'diagnose_instance',
    description: '对实例做结构化体检：Java 兼容性、运行文件完整性、最近会话日志规则诊断（Java 版本/内存/模组依赖/显卡等）。耗时可达数十秒。',
    inputSchema: { type: 'object', properties: { versionId: idParam }, required: ['versionId'], additionalProperties: false },
    run: args => callLauncher(`/diagnose?versionId=${encodeURIComponent(String(args.versionId))}`, { timeoutMs: 130000 })
  },
  {
    name: 'launch_game',
    description: '启动游戏实例（异步）：立即返回 launchId，随后用 get_launch_state 轮询阶段（launching→running/exited/error），用 logs_tail 观察日志。可选 serverAddress 直达服务器。',
    inputSchema: {
      type: 'object',
      properties: {
        versionId: idParam,
        folder: { type: 'string', description: '游戏文件夹路径（省略=当前活动文件夹）' },
        serverAddress: { type: 'string', description: '服务器地址（如 play.example.com:25565，进游戏直达）' }
      },
      required: ['versionId'],
      additionalProperties: false
    },
    run: args => callLauncher('/launch', { method: 'POST', body: { versionId: args.versionId, folder: args.folder, serverAddress: args.serverAddress } })
  },
  {
    name: 'stop_game',
    description: '请求关闭游戏（先正常关闭等待保存；返回 requiresForce 时需把 forceToken 原样传回确认强制结束）。多开时用 versionId 指定要关闭的实例，省略则关闭最近启动的游戏。',
    inputSchema: {
      type: 'object',
      properties: {
        versionId: { ...idParam, description: '实例 id（多开时指定；省略=最近启动的游戏）' },
        forceToken: { type: 'string', description: '强制结束确认令牌（仅在上次返回 requiresForce 后使用）' }
      },
      additionalProperties: false
    },
    run: args => callLauncher('/stop', { method: 'POST', body: { ...(args.versionId ? { versionId: args.versionId } : {}), ...(args.forceToken ? { forceToken: args.forceToken } : {}) } })
  },
  {
    name: 'bridge_status',
    description: 'KAMUCL Bridge（游戏内 MOD 面板通道）连接状态。需要实例装有桥接 MOD 且游戏运行中。',
    inputSchema: { type: 'object', properties: { versionId: idParam }, required: ['versionId'], additionalProperties: false },
    run: args => callLauncher(`/bridge/status?versionId=${encodeURIComponent(String(args.versionId))}`)
  },
  {
    name: 'bridge_params',
    description: '读取桥接 MOD 参数清单（MOD 声明的可热修改参数及当前值）。',
    inputSchema: { type: 'object', properties: { versionId: idParam }, required: ['versionId'], additionalProperties: false },
    run: args => callLauncher(`/bridge/manifest?versionId=${encodeURIComponent(String(args.versionId))}`)
  },
  {
    name: 'bridge_set',
    description: '热修改桥接 MOD 参数（即时生效；以 MOD 端校验后回读的值为准）。服务器作用域参数会被拒绝。',
    inputSchema: {
      type: 'object',
      properties: { versionId: idParam, id: { type: 'string', description: '参数 id' }, value: { description: '新值（类型须与参数 kind 匹配）' } },
      required: ['versionId', 'id', 'value'],
      additionalProperties: false
    },
    run: args => callLauncher('/bridge/set', { method: 'POST', body: { versionId: args.versionId, id: args.id, value: args.value } })
  },
  {
    name: 'bridge_reset',
    description: '恢复桥接 MOD 参数默认值（指定 id 恢复单个，省略恢复全部）。',
    inputSchema: {
      type: 'object',
      properties: { versionId: idParam, id: { type: 'string', description: '参数 id（省略=全部）' } },
      required: ['versionId'],
      additionalProperties: false
    },
    run: args => callLauncher('/bridge/reset', { method: 'POST', body: { versionId: args.versionId, id: args.id } })
  },
  {
    name: 'game_screenshot',
    description: '读取游戏画面（帧缓冲 PNG 图片，不受窗口遮挡影响）。返回图片供你直接观察游戏状态；坐标与截图像素一一对应，可用于 game_input 的 click/move。多开时用 versionId 指定实例。需要实例安装 KAMUCL 控制模组（install_control_mod）。',
    inputSchema: {
      type: 'object',
      properties: { versionId: { ...idParam, description: '实例 id（多开寻址；省略=最近启动的游戏）' } },
      additionalProperties: false
    },
    run: async args => {
      const result = await callLauncher('/control/screenshot', { method: 'POST', body: args.versionId ? { versionId: args.versionId } : {}, timeoutMs: 15000 })
      if (!result.ok) return result
      const { pngBase64, width, height } = result.data
      return { ok: true, image: { data: pngBase64, mimeType: 'image/png' }, note: `游戏窗口客户区 ${width}×${height} 像素；坐标系与 click/move 一致` }
    }
  },
  {
    name: 'game_state',
    description: '读取游戏内状态：玩家名/坐标/视角/血量/饥饿/游戏模式/世界、当前打开的界面、窗口与帧缓冲尺寸。AI 玩 MC 时用它而非截图判断位置与朝向。',
    inputSchema: {
      type: 'object',
      properties: { versionId: { ...idParam, description: '实例 id（多开寻址；省略=最近启动的游戏）' } },
      additionalProperties: false
    },
    run: args => callLauncher(`/control/state?${args.versionId ? `versionId=${encodeURIComponent(String(args.versionId))}` : ''}`)
  },
  {
    name: 'install_control_mod',
    description: '为实例安装 KAMUCL 控制模组（可重复安装，已安装则自动跳过）。需要实例是 Fabric 加载器且游戏版本受支持（当前 1.21.1）；安装后需（重新）启动游戏生效。game_screenshot/game_input/game_state 依赖它。',
    inputSchema: { type: 'object', properties: { versionId: idParam }, required: ['versionId'], additionalProperties: false },
    run: args => callLauncher('/control/install', { method: 'POST', body: { versionId: args.versionId } })
  },
  {
    name: 'game_input',
    description: '向游戏注入确定性输入（游戏内执行，不接触系统键鼠）。动作按序执行：key 键盘（key=W/SPACE/RETURN/ESCAPE/T/E/LSHIFT/F3…，mode=press/down/up，移动与持续挖掘用 down/up 夹持）；mouseButton 鼠标键（left=攻击/破坏，right=使用/放置，middle=选取方块）；click 界面坐标点击（截图像素系，仅界面）；move 界面光标移动；scroll 滚轮（世界内切换快捷栏）；type 向当前界面输入文本；chat 发送聊天；exec 执行命令；look 绝对视角 yaw/pitch；lookDelta 相对转视角 dx/dy；wait 等待毫秒。单次最多 32 个动作。多开时用 versionId 指定实例。',
    inputSchema: {
      type: 'object',
      properties: {
        versionId: { ...idParam, description: '实例 id（省略=最近启动的游戏）' },
        actions: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              type: { type: 'string', enum: ['key', 'mouseButton', 'move', 'click', 'scroll', 'type', 'chat', 'exec', 'look', 'lookDelta', 'wait'] },
              key: { type: 'string' }, mode: { type: 'string', enum: ['press', 'down', 'up'] },
              button: { type: 'string', enum: ['left', 'right', 'middle'] },
              x: { type: 'number' }, y: { type: 'number' }, delta: { type: 'number' },
              text: { type: 'string' }, command: { type: 'string' },
              yaw: { type: 'number' }, pitch: { type: 'number' }, dx: { type: 'number' }, dy: { type: 'number' },
              ms: { type: 'number' }
            },
            required: ['type']
          }
        }
      },
      required: ['actions'],
      additionalProperties: false
    },
    run: args => callLauncher('/control/input', { method: 'POST', body: { versionId: args.versionId, actions: args.actions }, timeoutMs: 60000 })
  }
]

const byName = new Map(TOOLS.map(tool => [tool.name, tool]))

// ---------------- MCP 工具调用 ----------------

async function callTool(name, args) {
  const tool = byName.get(name)
  if (!tool) return { content: [{ type: 'text', text: `未知工具：${name}` }], isError: true }
  try {
    const result = await tool.run(args ?? {})
    if (!result.ok) return { content: [{ type: 'text', text: result.error || '调用失败' }], isError: true }
    if (result.image) {
      return { content: [{ type: 'image', data: result.image.data, mimeType: result.image.mimeType }, { type: 'text', text: result.note || '' }] }
    }
    return { content: [{ type: 'text', text: JSON.stringify(result.data, null, 2) }] }
  } catch (error) {
    return { content: [{ type: 'text', text: `工具执行异常：${error instanceof Error ? error.message : String(error)}` }], isError: true }
  }
}

// ---------------- stdio JSON-RPC ----------------

let clientProtocolVersion = null

function respond(id, result) {
  if (id === undefined || id === null) return
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n')
}

function respondError(id, code, message) {
  if (id === undefined || id === null) return
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } }) + '\n')
}

async function handle(message) {
  if (!message || message.jsonrpc !== '2.0' || typeof message.method !== 'string') return
  const { id, method, params } = message
  const isNotification = id === undefined || id === null
  switch (method) {
    case 'initialize': {
      clientProtocolVersion = typeof params?.protocolVersion === 'string' ? params.protocolVersion : null
      respond(id, {
        protocolVersion: clientProtocolVersion ?? PROTOCOL_VERSION_FALLBACK,
        capabilities: { tools: {} },
        serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
        instructions: 'KAMUCL Minecraft 启动器。先调 launcher_status 确认启动器在线；list_instances 选实例；launch_game 启动；logs_tail/get_launch_state 观察；install_control_mod 安装控制模组 后用 game_screenshot/game_state/game_input 进行游戏内操作；diagnose_instance 与 read_crash_report 用于排障。'
      })
      return
    }
    case 'notifications/initialized':
    case 'initialized':
      return
    case 'ping':
      respond(id, {})
      return
    case 'tools/list':
      respond(id, { tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) })
      return
    case 'tools/call': {
      if (isNotification) return
      const result = await callTool(String(params?.name ?? ''), params?.arguments)
      respond(id, result)
      return
    }
    case 'shutdown':
      respond(id, null)
      return
    case 'exit':
      process.exit(0)
      return
    default:
      if (method.startsWith('notifications/')) return
      if (!isNotification) respondError(id, -32601, `Method not found: ${method}`)
  }
}

const rl = readline.createInterface({ input: process.stdin, terminal: false })
rl.on('line', line => {
  const text = line.trim()
  if (!text) return
  let message
  try {
    message = JSON.parse(text)
  } catch {
    process.stderr.write('[kamucl-mcp] 忽略无法解析的输入行\n')
    return
  }
  void handle(message).catch(error => {
    process.stderr.write(`[kamucl-mcp] 处理消息异常：${error instanceof Error ? error.message : String(error)}\n`)
  })
})
rl.on('close', () => process.exit(0))
process.stderr.write('[kamucl-mcp] sidecar 已启动，等待 MCP 客户端握手\n')
