import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { isPathContained, resolveContainedPath, safeArchivePath } from '../src/main/core/security'

test('isPathContained rejects sibling prefixes and parent traversal', () => {
  const base = path.join(os.tmpdir(), 'kamucl-security-base')

  assert.equal(isPathContained(base, path.join(os.tmpdir(), 'kamucl-security-base-other')), false)
  assert.equal(isPathContained(base, path.join(base, '..', 'outside')), false)
  assert.equal(isPathContained(base, path.join(base, 'nested', 'file')), true)
  assert.equal(isPathContained(base, base), false)
  assert.equal(isPathContained(base, base, true), true)
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
  const base = path.join(os.tmpdir(), 'kamucl-security-resolve')

  assert.equal(resolveContainedPath(base, 'nested/file'), path.resolve(base, 'nested/file'))
  assert.throws(() => resolveContainedPath(base, '../outside'), /非法目录|outside|contained/i)
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
