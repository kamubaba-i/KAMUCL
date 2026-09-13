import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import { redactSensitiveText } from '../src/main/core/security'
import { formatErrorText, formatLauncherLogLine } from '../src/main/core/launcherLog'

test('脱敏 Bearer、凭据键、Cookie 和 URL 查询参数，同时保留上下文', () => {
  const input = [
    'Authorization: bEaReR bearer-secret',
    'PaSsWoRd=plain-password',
    'ToKeN: token-secret',
    'api_key=api-key-secret',
    'Cookie: session=cookie-secret; theme=dark',
    'request=https://example.test/callback?token=query-token&keep=1&api_key=query-api-key'
  ].join('\n')

  const output = redactSensitiveText(input)

  for (const secret of [
    'bearer-secret',
    'plain-password',
    'token-secret',
    'api-key-secret',
    'cookie-secret',
    'query-token',
    'query-api-key'
  ]) {
    assert.equal(output.includes(secret), false, `仍包含敏感信息：${secret}`)
  }
  assert.match(output, /Authorization: bEaReR <redacted>/)
  assert.match(output, /keep=1/)
  assert.match(output, /theme=<redacted>/)
  assert.match(output, /request=https:\/\/example\.test\/callback\?token=<redacted>/)
})

test('普通错误、Minecraft 命令和路径不被过度修改，错误类型保留', () => {
  const command = 'Error: connection refused; command=java -jar server.jar --username Steve --tokenized'
  const path = 'path=C:\\Games\\KAMUCL\\versions\\1.20.1'
  const safe = redactSensitiveText(`${command} ${path}; password=hidden-password`)
  const error = new TypeError('connection refused: api_key=hidden-api-key')

  const text = formatErrorText(error)
  const line = formatLauncherLogLine(new Date(0), 'error', 'launch', `${command} ${path}; api_key=hidden-api-key`)

  assert.match(safe, /--username Steve --tokenized/)
  assert.match(safe, /C:\\Games\\KAMUCL\\versions\\1\.20\.1/)
  assert.equal(safe.includes('hidden-password'), false)
  assert.match(text, /^TypeError: connection refused/)
  assert.equal(text.includes('hidden-api-key'), false)
  assert.match(line, /C:\\Games\\KAMUCL\\versions\\1\.20\.1/)
  assert.equal(line.includes('hidden-api-key'), false)
  assert.match(line, /connection refused/)
})

test('JSON Cookie、Set-Cookie 和同类 token 字段只脱敏值', () => {
  const input = [
    '{"cookie":"json-cookie-secret","sessionId":"session-secret","clientToken":"client-secret","client_token":"client-underscore-secret","keep":"context"}',
    'Set-Cookie: session=set-cookie-secret; Path=/; HttpOnly',
    'Cookie: user=request-cookie-secret; theme=dark'
  ].join('\n')

  const output = redactSensitiveText(input)

  for (const secret of [
    'json-cookie-secret',
    'session-secret',
    'client-secret',
    'client-underscore-secret',
    'set-cookie-secret',
    'request-cookie-secret'
  ]) {
    assert.equal(output.includes(secret), false, `仍包含敏感信息：${secret}`)
  }
  assert.match(output, /"cookie":"<redacted>"/)
  assert.match(output, /"sessionId":"<redacted>"/)
  assert.match(output, /"clientToken":"<redacted>"/)
  assert.match(output, /"client_token":"<redacted>"/)
  assert.match(output, /"keep":"context"/)
  assert.match(output, /Set-Cookie: session=<redacted>; Path=\/; HttpOnly/)
  assert.match(output, /Cookie: user=<redacted>; theme=<redacted>/)
})

test('IPC 日志包装器先于所有 handler 注册且使用 rawHandle', () => {
  const source = fs.readFileSync(new URL('../src/main/ipc.ts', import.meta.url), 'utf8')
  const wrapperIndex = source.indexOf('const rawHandle = ipcMain.handle.bind(ipcMain)')

  assert.notEqual(wrapperIndex, -1)
  assert(wrapperIndex < source.indexOf('registerInstanceCenterIpc(getWin)'))
  assert(wrapperIndex < source.indexOf('ipcMain.handle(IPC.exitHistoryList'))
})

test('launcherLog 控制台镜像使用已脱敏文本', () => {
  const source = fs.readFileSync(new URL('../src/main/core/launcherLog.ts', import.meta.url), 'utf8')

  assert.match(source, /console\.error\([^\r\n]*safeText/)
  assert.match(source, /console\.warn\([^\r\n]*safeText/)
})
