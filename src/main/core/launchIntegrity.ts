import fs from 'node:fs'
import AdmZip from 'adm-zip'
import { verifyFile, downloadFile, type MirrorPref } from './download'

export interface LaunchArtifact { dest: string; url?: string; sha1?: string; size?: number }
export async function invalidLaunchArtifact(file: LaunchArtifact): Promise<string | null> {
  const reason = await verifyFile(file.dest, file)
  if (reason) return reason
  if (!file.sha1 && /\.jar$/i.test(file.dest)) {
    try { if (!new AdmZip(file.dest).test()) return 'JAR 内容校验失败' } catch { return 'JAR 格式损坏' }
  }
  return null
}

/** Validate first; a readable path is not evidence of a complete download. */
export async function ensureLaunchArtifact(file: LaunchArtifact, mirror: MirrorPref, progress?: (done: number, total: number) => void): Promise<boolean> {
  const reason = await invalidLaunchArtifact(file)
  if (!reason) return false
  if (!file.url) throw new Error(`${file.dest}：${reason}，缺少下载地址，请修复或重新安装加载器`)
  // Unknown-hash JARs must not be accepted again by downloadFile's existence fast path.
  if (fs.existsSync(file.dest) && fs.statSync(file.dest).isFile()) fs.rmSync(file.dest)
  await downloadFile(file.url, file.dest, progress, file.sha1, mirror, undefined, [], { size: file.size })
  const after = await invalidLaunchArtifact(file)
  if (after) throw new Error(`${file.dest}：修复后仍未通过完整性校验（${after}）`)
  return true
}
