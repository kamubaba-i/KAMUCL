import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import * as security from '../src/main/core/security'

const { isPathContained, resolveContainedPath, safeArchivePath } = security

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
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kamucl-security-safe-dir-'))
  const base = path.join(root, 'base')
  const sibling = path.join(root, 'base-other')
  try {
    for (const relative of ['C:foo', 'E:foo', sibling, path.join('..', 'outside')]) {
      assert.throws(() => security.resolveSafeDirPath(base, relative, 2), /非法目录|outside|contained/i, relative)
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
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
