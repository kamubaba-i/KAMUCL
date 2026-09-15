import assert from 'node:assert/strict'
import test from 'node:test'
import fs from 'node:fs'
import { canOpenExternalLink, validateExternalLink } from '../src/main/core/externalLinks'

test('external links only allow http and https URLs without credentials', () => {
  assert.equal(canOpenExternalLink('https://example.com/path?q=1'), true)
  assert.equal(canOpenExternalLink('http://example.com'), true)
  assert.equal(canOpenExternalLink('file:///C:/Windows/System32/calc.exe'), false)
  assert.equal(canOpenExternalLink('ms-msdt:'), false)
  assert.equal(canOpenExternalLink('https://user:pass@example.com'), false)
  assert.equal(canOpenExternalLink('https://'), false)
  assert.equal(canOpenExternalLink('not a url'), false)
  assert.equal(validateExternalLink('https://example.com')?.href, 'https://example.com/')
})

test('main window opens external links through a validated policy and blocks navigation', () => {
  const source = fs.readFileSync('src/main/index.ts', 'utf8')
  assert.match(source, /setWindowOpenHandler\(\(\{ url \}\) => \{\s*void openExternalLink\(url\)/)
  assert.match(source, /webContents\.on\('will-navigate'.*event\.preventDefault\(\)/s)
  assert.doesNotMatch(source, /shell\.openExternal\(url\)/)
})

test('renderer has a typed app open-external IPC channel', () => {
  const types = fs.readFileSync('src/shared/types.ts', 'utf8')
  const api = fs.readFileSync('src/renderer/src/api.ts', 'utf8')
  const ipc = fs.readFileSync('src/main/ipc.ts', 'utf8')
  assert.match(types, /appOpenExternal:\s*'app:openExternal'/)
  assert.match(api, /export const openExternal = \(url: string\) => invoke<void>\(IPC\.appOpenExternal, url\)/)
  assert.match(ipc, /IPC\.appOpenExternal[\s\S]*openExternalLink/)
})
