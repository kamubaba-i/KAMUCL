import crypto from 'node:crypto'
import type { PackZip, PackEntry } from './streamPackZip'

const normalize = (value: string): string => value.replace(/\\/g, '/').replace(/^\.\//, '')

/**
 * overrides 单文件上限。内存解码条目（无 writeTo/digest 的 AdmZip 兼容路径）保持
 * 512 MB；流式条目的内存占用与文件大小无关（1 MiB 管道），放宽到 4 GB 心智护栏，
 * 合法的大文件（如 PCL 导出整合包内的大体积世界存档）不再被整体拦截。归档级
 * 条目数量、总解压 32 GB、压缩比与 CRC 校验继续兜底（见 modpacks.openPackZip）。
 */
export const OVERRIDE_BUFFERED_FILE_LIMIT = 512 * 1024 * 1024
export const OVERRIDE_STREAMING_FILE_LIMIT = 4 * 1024 * 1024 * 1024

export function assertOverrideFileSize(entry: PackEntry, rel: string): void {
  const streaming = Boolean(entry.writeTo || entry.digest)
  const limit = streaming ? OVERRIDE_STREAMING_FILE_LIMIT : OVERRIDE_BUFFERED_FILE_LIMIT
  if (entry.header.size <= limit) return
  throw new Error(`overrides 内单个文件超过 ${streaming ? '4 GB' : '512 MB'}：${rel}（.mrpack 压缩包本身大小不受限制，是该文件解压后超限）`)
}

/** Locations loaded by Minecraft or common pack loaders; never count loader caches/backups. */
export const PACK_RESOURCE_DIRS = [
  'mods', 'resourcepacks', 'shaderpacks', 'datapacks',
  'config/paxi/datapacks', 'config/paxi/resourcepacks',
  'config/openloader/data', 'config/openloader/resources',
  'openloader/data', 'openloader/resources',
  'global_packs/both', 'global_packs/datapacks', 'global_packs/resourcepacks',
  'global_packs/required_data', 'global_packs/optional_data',
  'global_packs/required_resources', 'global_packs/optional_resources'
] as const

export function isPackResource(rel: string): boolean {
  const slash = rel.lastIndexOf('/')
  return PACK_RESOURCE_DIRS.some(dir => dir === rel.slice(0, slash).toLowerCase()) &&
    /^[^/]+\.(?:jar|zip)(?:\.disabled)?$/i.test(rel.slice(slash + 1))
}

/** Preserve the author's real destination/name, including ZIP packs and disabled mods. */
export class BundledModpackFiles {
  private readonly entries = new Map<number, Array<{ entry: PackEntry; rel: string }>>()
  private readonly hashes = new Map<PackEntry, string>()

  constructor(zip: PackZip, overridesPrefix: string | null) {
    if (!overridesPrefix) return
    const prefix = normalize(overridesPrefix).replace(/\/+$/, '') + '/'
    const paths = new Set<string>()
    for (const entry of zip.getEntries()) {
      const name = normalize(entry.entryName)
      if (entry.isDirectory || !name.startsWith(prefix)) continue
      const rel = name.slice(prefix.length)
      if (!isPackResource(rel)) continue
      if (((entry.attr >>> 16) & 0o170000) === 0o120000) throw new Error(`整合包包含不允许的符号链接：${name}`)
      // Case collisions are unsafe on Windows even when the ZIP was created on another OS.
      const key = rel.toLowerCase()
      if (paths.has(key)) throw new Error(`整合包包含重名覆盖文件：${rel}`)
      paths.add(key)
      assertOverrideFileSize(entry, rel)
      const group = this.entries.get(entry.header.size) ?? []
      group.push({ entry, rel })
      this.entries.set(entry.header.size, group)
    }
  }

  async find(file: { size: number; sha1: string }, signal?: AbortSignal): Promise<string | null> {
    signal?.throwIfAborted()
    if (!Number.isSafeInteger(file.size) || file.size <= 0 || !/^[a-f\d]{40}$/i.test(file.sha1)) return null
    for (const { entry, rel } of this.entries.get(file.size) ?? []) {
      signal?.throwIfAborted()
      let hash = this.hashes.get(entry)
      if (!hash) {
        hash = entry.digest ? await entry.digest('sha1', signal) : crypto.createHash('sha1').update(await entry.getData()).digest('hex')
        this.hashes.set(entry, hash)
        await new Promise<void>(resolve => setImmediate(resolve))
        signal?.throwIfAborted()
      }
      if (hash === file.sha1.toLowerCase()) return rel
    }
    return null
  }
}
