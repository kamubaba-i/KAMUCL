import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { cleanupPortableRuntimeCaches } from '../src/main/portableRuntimeCleanup'

test('portable runtime cleanup keeps the current cache and removes old directories', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kamucl-runtime-cleanup-'))
  const current = path.join(root, '1.0.89-aaaaaaaaaaaaaaaa')
  const old = path.join(root, '1.0.88-bbbbbbbbbbbbbbbb')
  fs.mkdirSync(path.join(current, 'resources'), { recursive: true })
  fs.mkdirSync(old)
  fs.writeFileSync(path.join(old, 'cache.ready'), 'old')
  try {
    assert.deepEqual(cleanupPortableRuntimeCaches(root, current), [old])
    assert.equal(fs.existsSync(current), true)
    assert.equal(fs.existsSync(old), false)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('portable runtime cleanup skips links, files, and an invalid current path', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kamucl-runtime-cleanup-'))
  const current = path.join(root, '1.0.89-aaaaaaaaaaaaaaaa')
  const link = path.join(root, 'linked')
  const file = path.join(root, 'not-a-cache')
  fs.mkdirSync(current)
  fs.mkdirSync(path.join(root, '1.0.88-bbbbbbbbbbbbbbbb'))
  fs.mkdirSync(path.join(root, 'unrelated'))
  fs.writeFileSync(path.join(root, '1.0.88-bbbbbbbbbbbbbbbb', 'cache.ready'), 'old')
  fs.symlinkSync(current, link, 'junction')
  fs.writeFileSync(file, 'keep')
  try {
    assert.deepEqual(cleanupPortableRuntimeCaches(root, path.join(root, '..', path.basename(root), 'current')), [path.join(root, '1.0.88-bbbbbbbbbbbbbbbb')])
    assert.equal(fs.existsSync(link), true)
    assert.equal(fs.existsSync(file), true)
    assert.deepEqual(cleanupPortableRuntimeCaches(root, path.join(os.tmpdir(), 'other')), [])
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})
