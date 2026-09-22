import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const read = () => fs.readFileSync('src/main/core/plugins.ts', 'utf8')

test('plugin installation validates source entries without following symlinks', () => {
  const source = read()
  assert.match(source, /lstatSync|lstat\(/)
  assert.match(source, /插件源.*符号链接|符号链接.*插件/)
  assert.match(source, /mkdtempSync/)
})

test('plugin installation stages before replacing an existing plugin', () => {
  const source = read()
  assert.match(source, /renameSync\(dest/)
  assert.match(source, /renameSync\(stage/)
  assert.match(source, /fs\.renameSync\(old, dest\)/)
  assert.match(source, /fs\.rmSync\(old/)
  assert.doesNotMatch(source, /if \(fs\.existsSync\(dest\)\) fs\.rmSync\(dest, \{ recursive: true, force: true \}\)/)
})

test('plugin reads and protocol reject symlinked main modules', () => {
  const source = read()
  assert.match(source, /requireRegularFile\(file, '插件 main\.js'\)/g)
  assert.match(source, /function requireRegularFile\(file/)
})
