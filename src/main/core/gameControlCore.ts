/**
 * 游戏输入动作模型与校验（纯函数，无业务依赖，可单测）。
 * 动作由 KAMUCL 控制 MOD 在游戏内确定性执行（经 controlBridge 转发）：
 * 键盘走 Keyboard 回调，界面点击走 Screen 交互，世界内鼠标走按键绑定，
 * 聊天/命令走网络处理器，均不接触系统真实键鼠。
 */

export interface GameInputAction {
  type: 'key' | 'mouseButton' | 'move' | 'click' | 'scroll' | 'type' | 'chat' | 'exec' | 'look' | 'lookDelta' | 'wait'
  /** key 动作：单字符（A-Z/0-9）、按键名（SPACE/RETURN/ESCAPE/LSHIFT/F3…）或 GLFW 键码数字 */
  key?: string
  /** key/mouseButton 动作模式：press（默认）/ down / up（移动、持续挖掘用 down/up 夹持） */
  mode?: 'press' | 'down' | 'up'
  /** mouseButton/click 动作按键：left（默认=攻击/破坏）/ right（使用/放置）/ middle（选取方块） */
  button?: 'left' | 'right' | 'middle'
  /** move/click 动作：画面（截图像素）坐标，仅对打开的界面有效；世界内视角用 look/lookDelta */
  x?: number
  y?: number
  /** scroll 动作：滚轮增量（正向上负向下，120 为一格；世界内切换快捷栏） */
  delta?: number
  /** type/chat 动作：文本（type ≤200 字符输入界面；chat ≤256 字符发送聊天，不经 UI） */
  text?: string
  /** exec 动作：执行命令（≤256 字符，可带或不带前导 /；需要相应权限） */
  command?: string
  /** look 动作：绝对视角（yaw 任意，pitch 限 ±90） */
  yaw?: number
  pitch?: number
  /** lookDelta 动作：相对视角增量（按游戏灵敏度，等同鼠标移动 dx/dy） */
  dx?: number
  dy?: number
  /** wait 动作：动作间隔毫秒（≤2000，给游戏响应时间） */
  ms?: number
}

export const CONTROL_MAX_ACTIONS = 32
export const CONTROL_MAX_TYPE_CHARS = 200
export const CONTROL_MAX_CHAT_CHARS = 256
export const CONTROL_MAX_WAIT_MS = 2000

const KEY_NAME = /^[A-Za-z0-9]$|^\d{1,3}$/
const KEY_WORDS = new Set(['SPACE', 'RETURN', 'ENTER', 'ESCAPE', 'ESC', 'TAB', 'BACK', 'LSHIFT', 'RSHIFT', 'LCONTROL', 'RCONTROL', 'CTRL', 'LALT', 'RALT', 'UP', 'DOWN', 'LEFT', 'RIGHT', 'DELETE', 'HOME', 'END', 'F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10', 'F11', 'F12', 'SLASH', 'MINUS', 'PLUS', 'COMMA', 'PERIOD', 'SEMICOLON', 'QUOTE', 'LBRACKET', 'RBRACKET', 'BACKSLASH', 'BACKTICK'])

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

/** 输入动作校验与归一化（在进入控制 MOD 前拦截非法参数） */
export function validateActions(actions: unknown): { ok: true; actions: GameInputAction[] } | { ok: false; error: string } {
  if (!Array.isArray(actions) || actions.length === 0) return { ok: false, error: 'actions 必须是非空数组' }
  if (actions.length > CONTROL_MAX_ACTIONS) return { ok: false, error: `单次最多 ${CONTROL_MAX_ACTIONS} 个动作` }
  const clean: GameInputAction[] = []
  for (const [index, raw] of actions.entries()) {
    const a = raw as GameInputAction
    const at = `动作 ${index + 1}`
    if (!a || typeof a !== 'object') return { ok: false, error: `${at} 不是对象` }
    switch (a.type) {
      case 'key': {
        const key = String(a.key ?? '')
        if (!key || (!KEY_NAME.test(key) && !KEY_WORDS.has(key.toUpperCase()))) return { ok: false, error: `${at} 的 key 无效：${key || '（空）'}` }
        const mode = a.mode ?? 'press'
        if (!['press', 'down', 'up'].includes(mode)) return { ok: false, error: `${at} 的 mode 必须是 press/down/up` }
        clean.push({ type: 'key', key, mode }); break
      }
      case 'mouseButton': {
        const button = a.button ?? 'left'
        if (!['left', 'right', 'middle'].includes(button)) return { ok: false, error: `${at} 的 button 必须是 left/right/middle` }
        const mode = a.mode ?? 'press'
        if (!['press', 'down', 'up'].includes(mode)) return { ok: false, error: `${at} 的 mode 必须是 press/down/up` }
        clean.push({ type: 'mouseButton', button, mode }); break
      }
      case 'move':
      case 'click': {
        const x = Number(a.x), y = Number(a.y)
        if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0) return { ok: false, error: `${at} 的坐标无效` }
        const button = a.button ?? 'left'
        if (a.type === 'click' && !['left', 'right', 'middle'].includes(button)) return { ok: false, error: `${at} 的 button 必须是 left/right/middle` }
        clean.push(a.type === 'click' ? { type: 'click', x, y, button } : { type: 'move', x, y }); break
      }
      case 'scroll': {
        const delta = Number(a.delta)
        if (!Number.isInteger(delta) || delta === 0) return { ok: false, error: `${at} 的 delta 无效` }
        clean.push({ type: 'scroll', delta: Math.max(-1200, Math.min(1200, delta)) }); break
      }
      case 'type': {
        const text = String(a.text ?? '')
        if (!text) return { ok: false, error: `${at} 的 text 为空` }
        if (text.length > CONTROL_MAX_TYPE_CHARS) return { ok: false, error: `${at} 的 text 超过 ${CONTROL_MAX_TYPE_CHARS} 字符` }
        clean.push({ type: 'type', text }); break
      }
      case 'chat': {
        const text = String((a as { text?: unknown }).text ?? '')
        if (!text) return { ok: false, error: `${at} 的 text 为空` }
        if (text.length > CONTROL_MAX_CHAT_CHARS) return { ok: false, error: `${at} 的 text 超过 ${CONTROL_MAX_CHAT_CHARS} 字符` }
        clean.push({ type: 'chat', text }); break
      }
      case 'exec': {
        const command = String(a.command ?? '')
        if (!command.trim()) return { ok: false, error: `${at} 的 command 为空` }
        if (command.length > CONTROL_MAX_CHAT_CHARS) return { ok: false, error: `${at} 的 command 超过 ${CONTROL_MAX_CHAT_CHARS} 字符` }
        clean.push({ type: 'exec', command }); break
      }
      case 'look': {
        const yaw = a.yaw, pitch = a.pitch
        if (!isFiniteNumber(yaw) && !isFiniteNumber(pitch)) return { ok: false, error: `${at} 需要 yaw 或 pitch` }
        if (isFiniteNumber(yaw) && Math.abs(yaw) > 3600) return { ok: false, error: `${at} 的 yaw 超出合理范围` }
        clean.push({ type: 'look', ...(isFiniteNumber(yaw) ? { yaw } : {}), ...(isFiniteNumber(pitch) ? { pitch: Math.max(-90, Math.min(90, pitch)) } : {}) }); break
      }
      case 'lookDelta': {
        const dx = Number(a.dx), dy = Number(a.dy)
        if (!Number.isFinite(dx) || !Number.isFinite(dy)) return { ok: false, error: `${at} 的 dx/dy 无效` }
        if (Math.abs(dx) > 5000 || Math.abs(dy) > 5000) return { ok: false, error: `${at} 的增量过大` }
        clean.push({ type: 'lookDelta', dx, dy }); break
      }
      case 'wait': {
        const ms = Number(a.ms)
        if (!Number.isFinite(ms) || ms <= 0) return { ok: false, error: `${at} 的 ms 无效` }
        clean.push({ type: 'wait', ms: Math.min(CONTROL_MAX_WAIT_MS, Math.round(ms)) }); break
      }
      default:
        return { ok: false, error: `${at} 的 type 未知：${String(a.type)}` }
    }
  }
  return { ok: true, actions: clean }
}
