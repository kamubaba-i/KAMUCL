/**
 * KAMUCL 控制模组 客户端：安装、发现（读游戏目录 .kamucl-control.json）与能力调用。
 * 控制模组 提供游戏内状态、帧缓冲截图与确定性输入（MCP 游戏控制后端）。
 * 与参数桥接（modBridge）相互独立；任何失败以结构化错误返回，绝不影响游戏进程。
 */
import fs from 'node:fs'
import path from 'node:path'
import { join } from 'node:path'
import { instanceDirectoryState } from './instances'
import { readVersionJson, resolveVersionChain } from './versions'
import { parseModFile } from './modinfo'
import { validateActions } from './gameControlCore'
import {
  callControl,
  controlJarFor,
  controlSupportedVersions,
  parseControlDiscovery,
  type ControlCallResult,
  type ControlDiscovery
} from './controlBridgeCore'

/** 内置控制模组 jar（构建时复制进 out/main，打包时 asarUnpack） */
function bundledControlJar(mcVersion: string): string | null {
  const jar = controlJarFor(mcVersion)
  return jar ? join(__dirname, jar).replace('app.asar', 'app.asar.unpacked') : null
}

function gameDirOf(versionId: string): string {
  return instanceDirectoryState(versionId, readVersionJson(versionId)).path
}

/** 实例 MC 版本（沿版本链取最底层原版 id） */
export function instanceMcVersion(versionId: string): string {
  return resolveVersionChain(versionId).baseId
}

/** 控制模组 是否已安装到该实例 mods 目录（按 fabric mod id 识别） */
export function controlInstalled(versionId: string): boolean {
  const modsDir = path.join(gameDirOf(versionId), 'mods')
  try {
    for (const name of fs.readdirSync(modsDir)) {
      if (!name.toLowerCase().endsWith('.jar')) continue
      const info = parseModFile(path.join(modsDir, name))
      if (info.id === 'kamucl-control') return true
    }
  } catch { /* mods 目录不存在视为未安装 */ }
  return false
}

/** 把内置控制模组安装到实例 mods 目录（可重复调用，已安装则跳过；实例版本不在支持清单时明确报错） */
export function installControl(versionId: string): { ok: boolean; already?: boolean; error?: string } {
  try {
    if (controlInstalled(versionId)) return { ok: true, already: true }
    const mcVersion = instanceMcVersion(versionId)
    const jarName = controlJarFor(mcVersion)
    if (!jarName) {
      return { ok: false, error: `实例游戏版本 ${mcVersion} 暂不支持控制模组（当前支持：${controlSupportedVersions().join('、')}）` }
    }
    const src = bundledControlJar(mcVersion)
    if (!src || !fs.existsSync(src)) return { ok: false, error: '内置控制模组 文件缺失，请重新安装启动器' }
    const modsDir = path.join(gameDirOf(versionId), 'mods')
    fs.mkdirSync(modsDir, { recursive: true })
    fs.copyFileSync(src, path.join(modsDir, jarName))
    return { ok: true }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

function discoveryFile(versionId: string): string {
  return path.join(gameDirOf(versionId), '.kamucl-control.json')
}

/** 读取发现文件；不存在或损坏返回 null */
export function readControlDiscovery(versionId: string): ControlDiscovery | null {
  try {
    return parseControlDiscovery(JSON.parse(fs.readFileSync(discoveryFile(versionId), 'utf-8')))
  } catch {
    return null
  }
}

export interface ControlStatus {
  connected: boolean
  installed: boolean
  reason?: string
  modVersion?: string
  mcVersion?: string
}

/** 连接状态：已安装 + 发现文件存在且 ping 通 */
export async function controlStatus(versionId: string): Promise<ControlStatus> {
  const installed = controlInstalled(versionId)
  const discovery = readControlDiscovery(versionId)
  if (!discovery) {
    return {
      connected: false,
      installed,
      reason: installed
        ? '未发现控制服务：请启动游戏（实例已安装控制模组）'
        : `未安装控制模组：该实例需要 Fabric 加载器与支持的游戏版本（${controlSupportedVersions().join('、')}）`
    }
  }
  try {
    process.kill(discovery.pid, 0)
  } catch {
    return { connected: false, installed, reason: '检测到上次的控制服务记录，但游戏已退出' }
  }
  const pong = await callControl(discovery, 'ping', undefined, 2000)
  if (pong.ok) return { connected: true, installed, modVersion: discovery.modVersion, mcVersion: discovery.mcVersion }
  return { connected: false, installed, reason: pong.error }
}

/** 能力调用前置：返回发现文件或结构化错误（含可执行的引导） */
function requireDiscovery(versionId: string): { ok: true; discovery: ControlDiscovery } | { ok: false; error: string } {
  const discovery = readControlDiscovery(versionId)
  if (!discovery) {
    const hint = controlInstalled(versionId)
      ? '实例已安装控制模组，请启动游戏后重试'
      : `实例未安装控制模组（需 Fabric 与支持版本 ${controlSupportedVersions().join('、')}）：请调用 install_control_mod 安装`
    return { ok: false, error: hint }
  }
  return { ok: true, discovery }
}

export async function controlState(versionId: string): Promise<ControlCallResult> {
  const target = requireDiscovery(versionId)
  if (!target.ok) return target
  return callControl(target.discovery, 'state')
}

export async function controlScreenshot(versionId: string): Promise<ControlCallResult> {
  const target = requireDiscovery(versionId)
  if (!target.ok) return target
  return callControl(target.discovery, 'screenshot', undefined, 15000)
}

/** 输入注入：先在启动器侧完成参数校验，再交控制模组 按序执行 */
export async function controlInput(versionId: string, rawActions: unknown): Promise<ControlCallResult> {
  const validated = validateActions(rawActions)
  if (!validated.ok) return { ok: false, error: validated.error }
  const target = requireDiscovery(versionId)
  if (!target.ok) return target
  return callControl(target.discovery, 'input', { actions: validated.actions }, 60000)
}
