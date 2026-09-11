/** KAMUCL HTTP transfer service, implemented from the application contracts.
 * SPDX-License-Identifier: MIT
 * HTTP semantics: RFC 9110 (status codes, Range and Content-Range).
 * No PCL source is used by this replacement. Historical provenance remains in Git.
 */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { downloadLimiter } from './downloadLimits'
import { withFileJob } from './fileJobs'
import { httpFetch } from './httpClient'
import { abortableDelay, inheritTaskControl, isTaskPaused, waitIfTaskPaused } from './tasks'
import { DownloadProgressTracker, SmoothedSpeedEstimator, type DownloadProgressSnapshot } from './downloadProgress'

export type MirrorPref = 'official' | 'bmclapi'
export type ProgressFn = (done: number, total: number) => void
export interface DownloadBatchProgress extends DownloadProgressSnapshot { activeFiles?: string[]; speedBps: number; etaSeconds: number | null; paused: boolean }
export type AllProgressFn = (done: number, total: number, speedBps: number, detail: DownloadBatchProgress) => void
export interface DownloadTask { label?: string; url: string; urls?: string[]; dest: string; sha1?: string; sha512?: string; size?: number }
interface Integrity { sha1?: string; sha512?: string; size?: number }
export const BMCL_MAVEN_ROOT = 'https://bmclapi2.bangbang93.com/maven/'
export function mirrorUrl(input: string, mirror: MirrorPref): string {
  if (mirror === 'official') return input
  try {
    const u = new URL(input)
    if (!['https:', 'http:'].includes(u.protocol)) return input
    const h = u.hostname, p = u.pathname, q = u.search, base = 'https://bmclapi2.bangbang93.com'
    if (['piston-meta.mojang.com','piston-data.mojang.com','launchermeta.mojang.com','launcher.mojang.com'].includes(h)) return base + p + q
    if (h === 'resources.download.minecraft.net') return base + '/assets' + p + q
    if (['libraries.minecraft.net','maven.fabricmc.net','maven.minecraftforge.net'].includes(h)) return BMCL_MAVEN_ROOT + p.slice(1) + q
    if (h === 'maven.neoforged.net' && p.startsWith('/releases/')) return BMCL_MAVEN_ROOT + p.slice(10) + q
    if (h === 'files.minecraftforge.net' && p.startsWith('/maven/')) return base + p + q
    if ((h === 'cdn.modrinth.com' && /^\/data\/[^/]+\/versions\//.test(p)) || (['edge.forgecdn.net','mediafilez.forgecdn.net'].includes(h) && /^\/files\/\d+\/\d+\//.test(p))) return 'https://mod.mcimirror.top' + p + q
  } catch { /* Non-URL inputs retain their original validation error. */ }
  return input
}
export function downloadCandidates(urls: string[], mirror: MirrorPref): string[] {
  return [...new Set(urls.flatMap(url => [mirrorUrl(url, mirror), url]))]
}
export type HttpFailureKind = 'unavailable' | 'transient' | 'fatal'
export function classifyHttpStatus(status: number): HttpFailureKind {
  if ([404,410].includes(status)) return 'unavailable'
  return [408,425,429].includes(status) || (status >= 500 && status < 600 && ![501,505].includes(status)) ? 'transient' : 'fatal'
}
export class DownloadHttpError extends Error {
  constructor(readonly status: number, readonly url: string) { super(`HTTP ${status}: ${url}`); this.name = 'DownloadHttpError' }
}
class InvalidContent extends Error {}
class NetworkIdle extends Error {}
export const transferTimeouts = { inactivityMs: 15_000 }
export const slowSpeedThresholds = { largeFileBytes: 8*1024*1024, largeWindowMs: 8000, largeMinBps: 256*1024, windowMs: 15000, minWindowBytes: 16*1024, warmupBytes: 1024*1024, warmupMs: 15000 }
const failures = new Map<string, { count: number; until: number }>()
const origin = (url: string) => { try { return new URL(url).origin } catch { return url } }
export function noteHostFailure(url: string): void {
  const key = origin(url), count = (failures.get(key)?.count ?? 0) + 1
  failures.set(key, { count, until: count < 2 ? 0 : Date.now() + Math.min(count * 60_000, 600_000) })
}
export function noteHostSuccess(url: string): void { failures.delete(origin(url)) }
export function noteHostsRecovered(): void { failures.clear() }
export function resetHostHealthForTest(): void { failures.clear() }
let diskProbe: ((dir: string) => { bavail: number; bsize: number }) | null = null
export function setStatfsProbeForTest(probe: typeof diskProbe): void { diskProbe = probe }
export function fetchSignal(signal?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(120_000)
  return signal ? AbortSignal.any([signal, timeout]) : timeout
}
export async function verifyFile(file: string, expected: Integrity, signal?: AbortSignal): Promise<string | null> {
  signal?.throwIfAborted()
  let stat: fs.Stats
  try { stat = await fs.promises.stat(file) } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return '文件缺失'; throw e }
  if (!stat.isFile()) return '路径不是文件'
  if (expected.size !== undefined && stat.size !== expected.size) return '文件大小不符'
  if (!stat.size && expected.size !== 0) return '空文件'
  const checks = (['sha1','sha512'] as const).filter(key => !!expected[key]).map(key => ({ key, hash: crypto.createHash(key) }))
  if (checks.length) {
    const stream = fs.createReadStream(file, { signal })
    for await (const bytes of stream) { signal?.throwIfAborted(); for (const check of checks) check.hash.update(bytes) }
    for (const check of checks) if (check.hash.digest('hex').toLowerCase() !== expected[check.key]!.toLowerCase()) return `${check.key} 校验失败`
  }
  signal?.throwIfAborted()
  return null
}
async function reuse(dest: string, expected: Integrity, roots: string[], signal?: AbortSignal): Promise<boolean> {
  if (!expected.sha1 && !expected.sha512) return false
  const own = path.resolve(path.dirname(dest)), extension = path.extname(dest).toLowerCase()
  const queue = roots.map(dir => ({ dir: path.resolve(dir), depth: 0 }))
  let visited = 0
  while (queue.length && visited++ < 10000) {
    signal?.throwIfAborted()
    const item = queue.shift()!
    if (item.dir === own) continue
    let entries: fs.Dirent[]
    try { entries = await fs.promises.readdir(item.dir, { withFileTypes: true }) } catch { continue }
    for (const entry of entries) {
      const file = path.join(item.dir, entry.name)
      if (entry.isDirectory() && item.depth < 8) queue.push({ dir: file, depth: item.depth + 1 })
      if (!entry.isFile() || path.extname(entry.name).toLowerCase() !== extension) continue
      if (await verifyFile(file, expected, signal)) continue
      await fs.promises.copyFile(file, dest + '.part')
      // A source may change during copying. Only the private copy is committed.
      if (await verifyFile(dest + '.part', expected, signal)) continue
      signal?.throwIfAborted()
      await fs.promises.rename(dest + '.part', dest)
      return true
    }
  }
  return false
}
/** One request owns one limiter slot, private file handle and cancellation controller. */
async function receive(url: string, temporary: string, expected: Integrity, signal: AbortSignal | undefined, progress: ProgressFn | undefined, hasAlternative: boolean, range?: { start: number; end: number }): Promise<number> {
  await waitIfTaskPaused(signal)
  const release = await downloadLimiter.acquire(signal)
  const controller = new AbortController()
  const abort = () => controller.abort(signal?.reason)
  signal?.addEventListener('abort', abort, { once: true })
  let response: Response | undefined, reader: ReadableStreamDefaultReader<Uint8Array> | undefined, file: fs.promises.FileHandle | undefined
  let timer: ReturnType<typeof setInterval> | undefined, waiting = false, sinceData = 0, elapsed = 0, windowTime = 0, windowBytes = 0, transferred = 0
  let last = performance.now()
  const slow = slowSpeedThresholds
  try {
    signal?.throwIfAborted()
    let offset = 0
    try { offset = (await fs.promises.stat(temporary)).size } catch { /* First request. */ }
    // Cross-source continuation without a hash cannot establish representation identity.
    if (!expected.sha1 && !expected.sha512) offset = 0
    const headers: Record<string,string> = { 'accept-encoding': 'identity' }
    if (range) headers.Range = `bytes=${range.start + offset}-${range.end}`
    else if (offset) headers.Range = `bytes=${offset}-`
    timer = setInterval(() => {
      const now = performance.now(), dt = now - last; last = now
      if (!waiting || isTaskPaused(signal) || downloadLimiter.isThrottling) return
      sinceData += dt; elapsed += dt; windowTime += dt
      if (sinceData >= transferTimeouts.inactivityMs) controller.abort(new NetworkIdle('下载网络停滞'))
      const duration = hasAlternative && (expected.size ?? 0) >= slow.largeFileBytes ? slow.largeWindowMs : slow.windowMs
      if (windowTime >= duration) {
        const aggressive = hasAlternative && (expected.size ?? 0) >= slow.largeFileBytes
        const ready = transferred >= slow.warmupBytes || elapsed >= slow.warmupMs
        if ((aggressive && windowBytes / (windowTime / 1000) < slow.largeMinBps) || (ready && windowBytes < slow.minWindowBytes)) controller.abort(new NetworkIdle('下载速度过慢'))
        windowTime = 0; windowBytes = 0
      }
    }, Math.max(10, Math.min(100, transferTimeouts.inactivityMs / 4)))
    waiting = true
    response = await httpFetch(url, { signal: controller.signal, headers, bodyTimeoutMs: 120_000 })
    waiting = false; sinceData = 0
    if (!response.ok) throw new DownloadHttpError(response.status, url)
    if (!response.body) throw new InvalidContent('下载响应没有内容')
    let total = range ? range.end - range.start + 1 : expected.size ?? 0
    if (response.status === 206) {
      const parsed = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(response.headers.get('content-range') ?? '')
      if (!parsed || Number(parsed[1]) !== (range?.start ?? 0) + offset || Number(parsed[2]) < Number(parsed[1]) || Number(parsed[2]) >= Number(parsed[3]) || (range && Number(parsed[2]) !== range.end)) throw new InvalidContent('Content-Range 不正确')
      if (expected.size !== undefined && Number(parsed[3]) !== expected.size) throw new InvalidContent('响应总大小不符')
      if (!range) total = Number(parsed[3])
    } else {
      if (range) throw new InvalidContent('服务器不支持范围请求')
      offset = 0
      const length = Number(response.headers.get('content-length'))
      if (!total && length > 0) total = length
    }
    file = await fs.promises.open(temporary, offset ? 'a' : 'w')
    reader = response.body.getReader()
    let done = offset
    progress?.(done, total)
    while (true) {
      await waitIfTaskPaused(signal)
      signal?.throwIfAborted()
      waiting = true
      const chunk = await reader.read()
      waiting = false; sinceData = 0
      if (chunk.done) break
      await downloadLimiter.consume(chunk.value.length, signal)
      await waitIfTaskPaused(signal)
      let written = 0
      while (written < chunk.value.length) {
        const result = await file.write(chunk.value, written, chunk.value.length - written)
        if (!result.bytesWritten) throw new Error('写入文件失败')
        written += result.bytesWritten
      }
      done += written; transferred += written; windowBytes += written
      if (total && done > total) throw new InvalidContent('响应数据超出声明大小')
      progress?.(done, total)
    }
    if (total && done !== total) throw new InvalidContent('下载大小不符')
    await file.sync()
    return done
  } catch (error) {
    signal?.throwIfAborted()
    throw controller.signal.aborted ? controller.signal.reason : error
  } finally {
    clearInterval(timer)
    controller.abort()
    if (reader) { await reader.cancel().catch(() => {}); reader.releaseLock() }
    else await response?.body?.cancel().catch(() => {})
    await file?.close()
    signal?.removeEventListener('abort', abort)
    release()
  }
}

/** Four independent bounded ranges; cancellation keeps private resumable fragments. */
async function segmented(url: string, dest: string, expected: Integrity, signal: AbortSignal | undefined, progress: ProgressFn | undefined, fallback: boolean): Promise<number> {
  const cache = path.resolve(dest + '.segments-cache'), size = expected.size!, step = Math.ceil(size / 4)
  const clear = async () => { if (path.dirname(cache) !== path.dirname(path.resolve(dest))) throw new Error('缓存路径越界'); await fs.promises.rm(cache, { recursive: true, force: true }) }
  const identity = JSON.stringify({ version: 1, size, sha1: expected.sha1, sha512: expected.sha512, step })
  try { const stat = await fs.promises.lstat(cache); if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error('下载缓存不是普通目录') } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
  let previous = ''; try { previous = await fs.promises.readFile(path.join(cache, 'identity.json'), 'utf8') } catch {}
  if (previous !== identity) { await clear(); await fs.promises.mkdir(cache, { recursive: true }); await fs.promises.writeFile(path.join(cache, 'identity.json'), identity) }
  const controller = new AbortController(), cancel = () => controller.abort(signal?.reason)
  inheritTaskControl(signal, controller.signal)
  signal?.addEventListener('abort', cancel, { once: true }); if (signal?.aborted) cancel()
  const received = [0,0,0,0]; let failure: unknown
  try {
    await Promise.all(Array.from({length:4}, async (_, index) => {
      const start = index * step, end = Math.min(size, start + step) - 1, file = path.join(cache, index + '.part')
      try {
        let saved = 0; try { const st = await fs.promises.lstat(file); if (!st.isFile() || st.isSymbolicLink()) throw new Error('下载分片不是普通文件'); saved = st.size } catch(error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
        if (saved > end-start+1) { await fs.promises.rm(file); saved=0 }
        received[index]=saved
        if (saved < end-start+1) await receive(url,file,expected,controller.signal,done=>{received[index]=done;progress?.(received.reduce((a,b)=>a+b,0),size)},fallback,{start,end})
      } catch(error) { if (!failure) failure=error; controller.abort(error) }
    }))
    signal?.throwIfAborted()
    if (failure) throw failure
    const output=await fs.promises.open(dest+'.part','w')
    try { for(let index=0;index<4;index++) for await(const chunk of fs.createReadStream(path.join(cache,index+'.part'),{signal})) { const data=Buffer.from(chunk); let offset=0;while(offset<data.length){const result=await output.write(data,offset,data.length-offset);if(!result.bytesWritten)throw new Error('分片合并写入失败');offset+=result.bytesWritten} } await output.sync() } finally { await output.close() }
    const invalid=await verifyFile(dest+'.part',expected,signal)
    if(invalid) { await clear(); throw new InvalidContent(invalid) }
    await clear();return size
  } catch(error) {
    signal?.throwIfAborted()
    await clear()
    if(error instanceof InvalidContent) { await fs.promises.rm(dest+'.part',{force:true}); return receive(url,dest+'.part',expected,signal,progress,fallback) }
    throw error
  } finally { signal?.removeEventListener('abort',cancel);controller.abort() }
}

export async function downloadFile(url: string, dest: string, progress?: ProgressFn, sha1?: string, mirror: MirrorPref = 'official', signal?: AbortSignal, alternatives: string[] = [], integrity: { sha512?: string; size?: number; reuseDirs?: string[] } = {}): Promise<void> {
  return withFileJob(dest, signal, async () => {
    const expected = { sha1, sha512: integrity.sha512, size: integrity.size }, temporary = dest + '.part'
    await fs.promises.mkdir(path.dirname(dest), { recursive: true })
    try {
      if (!await verifyFile(dest, expected, signal)) { const size = (await fs.promises.stat(dest)).size; progress?.(size, size); return }
      if (!await verifyFile(temporary, expected, signal) && (sha1 || integrity.sha512)) { signal?.throwIfAborted(); await fs.promises.rename(temporary, dest); return }
      if (await reuse(dest, expected, integrity.reuseDirs ?? [], signal)) { const size = (await fs.promises.stat(dest)).size; progress?.(size, size); return }
      if ((expected.size ?? 0) >= 50 * 1024 * 1024) {
        const space = diskProbe ? diskProbe(path.dirname(dest)) : await fs.promises.statfs(path.dirname(dest))
        if (Number(space.bavail) * Number(space.bsize) < expected.size!) throw new Error('磁盘空间不足')
      }
      const candidates = downloadCandidates([url, ...alternatives], mirror).sort((a,b) => Number((failures.get(origin(a))?.until ?? 0) > Date.now()) - Number((failures.get(origin(b))?.until ?? 0) > Date.now()))
      let lastError: unknown = new Error('没有下载地址')
      for (let index = 0; index < candidates.length; index++) {
        const source = candidates[index], fallback = index + 1 < candidates.length
        for (let attempt = 0; attempt < 4; attempt++) {
          try {
            const bytes = (expected.size ?? 0) >= 8 * 1024 * 1024 && downloadLimiter.maxConcurrent >= 4 && (sha1 || integrity.sha512)
              ? await segmented(source, dest, expected, signal, progress, fallback)
              : await receive(source, temporary, expected, signal, progress, fallback)
            const invalid = await verifyFile(temporary, expected, signal)
            if (invalid) throw new InvalidContent(invalid)
            signal?.throwIfAborted()
            await fs.promises.rename(temporary, dest)
            noteHostSuccess(source); progress?.(bytes, bytes)
            return
          } catch (error) {
            signal?.throwIfAborted(); lastError = error
            if (error instanceof InvalidContent) { await fs.promises.rm(temporary, { force: true }); break }
            if (error instanceof DownloadHttpError && classifyHttpStatus(error.status) !== 'transient') break
            noteHostFailure(source)
            if (error instanceof NetworkIdle && fallback) break
            if (attempt < 3) await abortableDelay(100 * 2 ** attempt, signal)
          }
        }
      }
      throw new Error(`下载失败：${lastError instanceof Error ? lastError.message : String(lastError)}`)
    } finally {
      // No detached stream may keep writing after this promise settles.
      await fs.promises.rm(temporary, { force: true })
    }
  })
}
export async function downloadAll(tasks: DownloadTask[], progress?: AllProgressFn, concurrency = 8, mirror: MirrorPref = 'official', signal?: AbortSignal): Promise<void> {
  const tracker = new DownloadProgressTracker(), speed = new SmoothedSpeedEstimator(), active = new Map<number,string>()
  tasks.forEach(task => tracker.add(task.size)); tracker.seal()
  const controller = new AbortController(), abort = () => controller.abort(signal?.reason)
  signal?.addEventListener('abort', abort, { once: true }); inheritTaskControl(signal, controller.signal)
  let cursor = 0, firstError: unknown
  const report = () => {
    const snapshot = tracker.snapshot(), paused = isTaskPaused(signal)
    const sampled = speed.sample(snapshot.bytesDone, snapshot.bytesTotal == null ? null : Math.max(0, snapshot.bytesTotal - snapshot.bytesDone), Date.now(), paused)
    progress?.(snapshot.completedFiles, tasks.length, sampled.speedBps, { ...snapshot, ...sampled, paused, activeFiles: [...active.values()] })
  }
  const timer = setInterval(report, 200)
  try {
    signal?.throwIfAborted()
    if (!tasks.length) { progress?.(0,0,0,{completedFiles:0,totalFiles:0,bytesDone:0,bytesTotal:0,fraction:1,indeterminate:false,speedBps:0,etaSeconds:null,paused:false}); return }
    await Promise.all(Array.from({ length: Math.min(tasks.length, Math.max(1, Math.floor(concurrency) || 1)) }, async () => {
      while (!controller.signal.aborted && cursor < tasks.length) {
        const index = cursor++, task = tasks[index]; active.set(index, task.label ?? path.basename(task.dest))
        try {
          await downloadFile(task.url, task.dest, (done,total) => { tracker.update(index,done,total); report() }, task.sha1, mirror, controller.signal, task.urls, { sha512: task.sha512, size: task.size })
          tracker.complete(index, (await fs.promises.stat(task.dest)).size); active.delete(index); report()
        } catch (error) { firstError ??= error; controller.abort(error); return }
      }
    }))
    signal?.throwIfAborted()
    if (firstError) throw firstError
  } finally { clearInterval(timer); signal?.removeEventListener('abort', abort) }
}
