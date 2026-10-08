import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { isSystemMetadataFile, listResourceEntries } from '../src/main/core/resourceDirectory'

test('系统元数据文件名单按大小写与边车前缀识别', () => {
  assert.equal(isSystemMetadataFile('.DS_Store'), true)
  assert.equal(isSystemMetadataFile('.ds_store'), true)
  assert.equal(isSystemMetadataFile('Thumbs.db'), true)
  assert.equal(isSystemMetadataFile('thumbs.DB'), true)
  assert.equal(isSystemMetadataFile('desktop.ini'), true)
  assert.equal(isSystemMetadataFile('Desktop.INI'), true)
  assert.equal(isSystemMetadataFile('._fabric-api.jar'), true)
  assert.equal(isSystemMetadataFile('sodium.jar'), false)
  assert.equal(isSystemMetadataFile('实况音响.zip'), false)
  assert.equal(isSystemMetadataFile('modernfix.jar.disabled'), false)
})

test('资源列表跳过 .DS_Store 等系统文件但保留真实资源', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kamucl-junk-'))
  try {
    fs.writeFileSync(path.join(dir, '.DS_Store'), 'junk')
    fs.writeFileSync(path.join(dir, 'Thumbs.db'), 'junk')
    fs.writeFileSync(path.join(dir, '._sodium.jar'), 'junk')
    fs.writeFileSync(path.join(dir, 'sodium.jar'), 'jar')
    fs.writeFileSync(path.join(dir, '光影包.zip'), 'zip')
    const entries = await listResourceEntries(dir)
    assert.deepEqual(entries.map((entry) => entry.name).sort(), ['sodium.jar', '光影包.zip'])
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('资源目录不存在时仍返回空列表', async () => {
  const entries = await listResourceEntries(path.join(os.tmpdir(), 'kamucl-missing-', String(Date.now())))
  assert.deepEqual(entries, [])
})
