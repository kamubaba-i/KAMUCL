import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import zlib from 'node:zlib'
import test from 'node:test'
import * as security from '../src/main/core/security'
import { parseTarArchiveMembers, validateTarArchiveMembers } from '../src/main/core/java'

const {
  isArchiveSymlink,
  isPathContained,
  resolveArchiveEntryPath,
  resolveContainedPath,
  safeArchivePath
} = security

interface RawZipEntry {
  name: string
  data: Buffer
  mode?: number
}

function rawZip(entries: RawZipEntry[]): Buffer {
  const localParts: Buffer[] = []
  const centralParts: Buffer[] = []
  let offset = 0
  for (const entry of entries) {
    const name = Buffer.from(entry.name)
    const data = entry.data
    const crc = zlib.crc32(data) >>> 0
    const localHeader = Buffer.alloc(30)
    localHeader.writeUInt32LE(0x04034b50, 0)
    localHeader.writeUInt16LE(20, 4)
    localHeader.writeUInt32LE(crc, 14)
    localHeader.writeUInt32LE(data.length, 18)
    localHeader.writeUInt32LE(data.length, 22)
    localHeader.writeUInt16LE(name.length, 26)
    const local = Buffer.concat([localHeader, name, data])
    localParts.push(local)

    const centralHeader = Buffer.alloc(46)
    centralHeader.writeUInt32LE(0x02014b50, 0)
    centralHeader.writeUInt16LE(0x0314, 4)
    centralHeader.writeUInt16LE(20, 6)
    centralHeader.writeUInt32LE(crc, 16)
    centralHeader.writeUInt32LE(data.length, 20)
    centralHeader.writeUInt32LE(data.length, 24)
    centralHeader.writeUInt16LE(name.length, 28)
    centralHeader.writeUInt32LE(((entry.mode ?? 0o100644) << 16) >>> 0, 38)
    centralHeader.writeUInt32LE(offset, 42)
    centralParts.push(Buffer.concat([centralHeader, name]))
    offset += local.length
  }

  const centralOffset = localParts.reduce((sum, part) => sum + part.length, 0)
  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(centralSize, 12)
  end.writeUInt32LE(centralOffset, 16)
  return Buffer.concat([...localParts, ...centralParts, end])
}

test('isPathContained rejects sibling prefixes and parent traversal', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kamucl-security-base-'))
  const base = path.join(root, 'base')
  try {
    assert.equal(isPathContained(base, path.join(root, 'base-other')), false)
    assert.equal(isPathContained(base, path.join(base, '..', 'outside')), false)
    assert.equal(isPathContained(base, path.join(base, 'nested', 'file')), true)
    assert.equal(isPathContained(base, base), false)
    assert.equal(isPathContained(base, base, true), true)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('isPathContained rejects a symlink ancestor escaping the base', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kamucl-security-link-'))
  const base = path.join(root, 'base')
  const outside = path.join(root, 'outside')
  const link = path.join(base, 'linked')
  try {
    fs.mkdirSync(base)
    fs.mkdirSync(outside)
    fs.symlinkSync(outside, link, 'junction')

    assert.equal(isPathContained(base, path.join(link, 'file')), false)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('isPathContained resolves symlinks before parent traversal', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kamucl-security-link-parent-'))
  const base = path.join(root, 'base')
  const outside = path.join(root, 'outside')
  const link = path.join(base, 'linked')
  try {
    fs.mkdirSync(base)
    fs.mkdirSync(outside)
    fs.symlinkSync(outside, link, 'junction')

    const candidate = `${link}${path.sep}..${path.sep}secret`
    assert.equal(isPathContained(base, candidate), false)
    assert.throws(() => resolveContainedPath(base, `linked${path.sep}..${path.sep}secret`), /非法目录|outside|contained/i)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('isPathContained rejects a broken symlink ancestor', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kamucl-security-broken-link-'))
  const base = path.join(root, 'base')
  const link = path.join(base, 'linked')
  try {
    fs.mkdirSync(base)
    fs.symlinkSync(path.join(root, 'missing'), link, 'junction')

    assert.equal(isPathContained(base, path.join(link, 'file')), false)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('resolveContainedPath returns a contained path and rejects escapes', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kamucl-security-resolve-'))
  const base = path.join(root, 'base')
  try {
    assert.equal(resolveContainedPath(base, 'nested/file'), path.resolve(base, 'nested/file'))
    assert.throws(() => resolveContainedPath(base, '../outside'), /非法目录|outside|contained/i)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('resolveContainedPath rejects Windows drive-relative paths', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kamucl-security-drive-'))
  const base = path.join(root, 'base')
  try {
    for (const relative of ['C:foo', 'E:foo']) {
      assert.throws(() => resolveContainedPath(base, relative), /非法目录|outside|contained/i, relative)
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('safeDir boundary rejects drive-relative, sibling-prefix, and parent paths', () => {
  const root = path.parse(os.tmpdir()).root
  const base = path.join(root, `kamucl-security-base-${process.pid}-${Date.now()}`)
  const sibling = path.join(root, `${path.basename(base)}-other`)

  for (const relative of ['C:foo', 'E:foo', sibling, path.join('..', 'outside')]) {
    assert.throws(() => security.resolveSafeDirPath(relative, () => base), /非法目录|outside|contained/i, relative)
  }
})

test('safeArchivePath normalizes legal nested entries', () => {
  assert.equal(safeArchivePath('nested\\file.txt'), 'nested/file.txt')
  assert.equal(safeArchivePath('./nested/file.txt'), 'nested/file.txt')
})

test('safeArchivePath rejects absolute, drive-qualified, traversal, and NUL entries', () => {
  for (const entry of ['/absolute/file.txt', '\\\\server\\share\\file.txt', 'C:\\file.txt', '../outside.txt', 'nested/../../outside.txt', 'bad\0name']) {
    assert.throws(() => safeArchivePath(entry), /非法|archive|path|NUL/i, entry)
  }
})

test('real ZIP entries stay inside the extraction root', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kamucl-security-zip-'))
  const archive = path.join(root, 'fixture.zip')
  const destination = path.join(root, 'target')
  const outside = path.join(root, 'outside')
  try {
    fs.mkdirSync(destination)
    fs.mkdirSync(outside)
    fs.writeFileSync(archive, rawZip([
      { name: '../escape.txt', data: Buffer.from('escape') },
      { name: 'C:/drive.txt', data: Buffer.from('drive') },
      { name: '/absolute.txt', data: Buffer.from('absolute') },
      { name: 'nested/ok.txt', data: Buffer.from('ok') },
      { name: 'link.txt', data: Buffer.from('../outside/escape.txt'), mode: 0o120777 }
    ]))

    const rejected: string[] = []
    const zip = new (require('adm-zip'))(archive) as {
      getEntries: () => Array<{ entryName: string; attr: number; isDirectory: boolean; getData: () => Buffer }>
    }
    for (const entry of zip.getEntries()) {
      if (entry.isDirectory) continue
      if (isArchiveSymlink(entry.attr)) {
        rejected.push(entry.entryName)
        continue
      }
      try {
        const output = resolveArchiveEntryPath(destination, entry.entryName)
        fs.mkdirSync(path.dirname(output), { recursive: true })
        fs.writeFileSync(output, entry.getData())
      } catch {
        rejected.push(entry.entryName)
      }
    }

    assert.deepEqual(rejected.sort(), ['../escape.txt', 'C:/drive.txt', '/absolute.txt', 'link.txt'].sort())
    assert.equal(fs.readFileSync(path.join(destination, 'nested', 'ok.txt'), 'utf-8'), 'ok')
    assert.deepEqual(fs.readdirSync(outside), [])
    assert.equal(fs.existsSync(path.join(root, 'escape.txt')), false)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('tar archive preflight accepts nested members and rejects traversal and links', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kamucl-security-tar-'))
  const extracted = path.join(root, 'extracted')
  try {
    fs.mkdirSync(extracted)
    assert.doesNotThrow(() => validateTarArchiveMembers(extracted, [
      { name: 'jdk/bin/java', type: 'file' },
      { name: 'jdk/lib', type: 'directory' }
    ]))

    for (const member of [
      { name: '../escape', type: 'file' },
      { name: '/absolute', type: 'file' },
      { name: 'C:/drive', type: 'file' },
      { name: 'jdk/link', type: 'symlink' },
      { name: 'jdk/hard', type: 'hardlink' }
    ] as const) {
      assert.throws(
        () => validateTarArchiveMembers(extracted, [member]),
        /非法归档路径|符号链接|硬链接|symlink|hardlink/i,
        member.name
      )
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('tar verbose listing preserves link member types for preflight', () => {
  assert.deepEqual(
    parseTarArchiveMembers(
      './\n./jdk/bin/java\n./jdk/link\n./jdk/hard\n',
      'drwxr-xr-x 0 0 0 2026-09-13 ./\n-rw-r--r-- 0 0 1 2026-09-13 ./jdk/bin/java\nlrwxrwxrwx 0 0 0 2026-09-13 ./jdk/link -> target\nhrw-r--r-- 0 0 0 2026-09-13 ./jdk/hard link to ./jdk/bin/java\n'
    ),
    [
      { name: './', type: 'directory' },
      { name: './jdk/bin/java', type: 'file' },
      { name: './jdk/link', type: 'symlink' },
      { name: './jdk/hard', type: 'hardlink' }
    ]
  )
})
