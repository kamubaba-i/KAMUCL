import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import AdmZip from 'adm-zip'
import { BundledModpackFiles, assertOverrideFileSize, OVERRIDE_STREAMING_FILE_LIMIT } from '../src/main/core/modpackBundledFiles'
import { extractOverrides } from '../src/main/core/modpacks'
import type { PackEntry, PackZip } from '../src/main/core/streamPackZip'

const OVER = 600 * 1024 * 1024
const FAR_OVER = 5 * 1024 * 1024 * 1024

/** 手搓 PackEntry：header.size 声明大文件无需真实数据；writeTo/digest 决定流式或内存路径。 */
function fakeEntry(name: string, size: number, streaming: boolean): PackEntry {
  return {
    entryName: name,
    isDirectory: false,
    attr: 0,
    header: { size, compressedSize: Math.ceil(size / 100) },
    getData: async () => Buffer.alloc(Math.min(size, 1024)),
    ...(streaming ? { writeTo: async (dest: string) => { fs.writeFileSync(dest, 'x') }, digest: async () => '0'.repeat(40) } : {})
  }
}

const zipOf = (entries: PackEntry[]): PackZip => ({ getEntries: () => entries, getEntry: () => null })

test('流式 overrides 条目放宽到 4 GB，内存解码条目保持 512 MB（#21）', () => {
  assertOverrideFileSize(fakeEntry('overrides/world/region/r.0.mca', OVER, true), 'world/region/r.0.mca')
  assertOverrideFileSize(fakeEntry('overrides/mods/big.jar', OVERRIDE_STREAMING_FILE_LIMIT, true), 'mods/big.jar')
  assert.throws(
    () => assertOverrideFileSize(fakeEntry('overrides/world/region/r.0.mca', FAR_OVER, true), 'world/region/r.0.mca'),
    /overrides 内单个文件超过 4 GB.*压缩包本身大小不受限制/s
  )
  assert.throws(
    () => assertOverrideFileSize(fakeEntry('overrides/world/level.dat', OVER, false), 'world/level.dat'),
    /overrides 内单个文件超过 512 MB/s
  )
})

test('打包扫描：资源目录内 600MB 流式文件不再阻断导入，内存路径仍拒绝', () => {
  const streaming = zipOf([fakeEntry('overrides/mods/big-world.jar', OVER, true)])
  assert.ok(new BundledModpackFiles(streaming, 'overrides'))

  const buffered = zipOf([fakeEntry('overrides/mods/big-world.jar', OVER, false)])
  assert.throws(() => new BundledModpackFiles(buffered, 'overrides'), /512 MB/)
})

test('解压 overrides：流式大文件允许提取，超 4 GB 仍拒绝', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kamucl-override-limit-'))
  try {
    const writable = fakeEntry('overrides/world/region/r.0.mca', OVER, true)
    const extracted = await extractOverrides(zipOf([writable]), 'overrides', dir)
    assert.deepEqual(extracted, ['world/region/r.0.mca'])
    assert.equal(fs.readFileSync(path.join(dir, 'world', 'region', 'r.0.mca'), 'utf8'), 'x')

    await assert.rejects(
      () => extractOverrides(zipOf([fakeEntry('overrides/world/region/r.9.mca', FAR_OVER, true)]), 'overrides', dir),
      /4 GB/
    )
    await assert.rejects(
      () => extractOverrides(zipOf([fakeEntry('overrides/world/region/r.9.mca', OVER, false)]), 'overrides', dir),
      /512 MB/
    )
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('真实 AdmZip 小包（内存路径）不受行为回归影响', () => {
  const zip = new AdmZip()
  zip.addFile('overrides/mods/a.jar', Buffer.from('a'))
  const bundled = new BundledModpackFiles(zip, 'overrides')
  assert.ok(bundled)
})
