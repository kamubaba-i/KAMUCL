import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { EventEmitter } from 'node:events'
import { createRequire } from 'node:module'
import { build } from 'esbuild'
import crypto from 'node:crypto'

const FRPC_SHA256 = 'b705262edad9f0de04b38f342e811e9d97d0beada75edab3f790e105dcfb5234'

async function harness(downloaded: Buffer) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'frpc-integrity-'))
  const calls: Array<{ url: string; dest: string; integrity: { sha256?: string; size?: number } }> = []
  const result = await build({
    entryPoints: ['src/main/core/frp.ts'],
    bundle: true,
    write: false,
    platform: 'node',
    format: 'cjs',
    packages: 'external',
    plugins: [{
      name: 'download',
      setup(builder) {
        builder.onResolve({ filter: /^\.\/download$/ }, () => ({ path: 'download', namespace: 'mock' }))
        builder.onLoad({ filter: /.*/, namespace: 'mock' }, () => ({
          contents: 'export const downloadFile=async(url,dest,_progress,_sha1,_mirror,_signal,_alternatives,integrity={})=>{globalThis.__frpcCalls.push({url,dest,integrity});fs.writeFileSync(dest,globalThis.__frpcBytes)}'
        }))
      }
    }]
  })
  const require = createRequire(path.resolve('package.json'))
  const module = { exports: {} as any }
  ;(globalThis as any).__frpcCalls = calls
  ;(globalThis as any).__frpcBytes = downloaded
  new Function('require', 'module', 'exports', 'fs', result.outputFiles[0].text)(
    (name: string) => name === 'electron'
      ? { app: { getPath: () => root } }
      : name === 'node:child_process'
        ? { spawn: () => new EventEmitter() }
        : require(name),
    module,
    module.exports,
    fs
  )
  return {
    ...module.exports,
    root,
    calls,
    cleanup: () => fs.rmSync(root, { recursive: true, force: true })
  }
}

test('frpc download is pinned to the official URL, exact size and SHA256', async () => {
  const bytes = crypto.randomBytes(16)
  const h = await harness(bytes)
  try {
    await h.ensureFrpcInstalled()
    assert.equal(h.calls.length, 1)
    assert.equal(h.calls[0].url, 'https://nya.globalslb.net/natfrp/client/frpc/0.51.0-sakura-14/frpc_windows_amd64.exe')
    assert.equal(h.calls[0].integrity.sha256, FRPC_SHA256)
    assert.equal(h.calls[0].integrity.size, 14133248)
    assert(fs.readFileSync(h.frpcPath()).equals(bytes))
  } finally {
    h.cleanup()
  }
})
