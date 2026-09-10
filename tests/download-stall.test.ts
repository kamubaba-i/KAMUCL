import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { downloadFile, transferTimeouts, slowSpeedThresholds, resetHostHealthForTest } from '../src/main/core/download'
import { downloadLimiter, DEFAULT_DOWNLOAD_LIMITS } from '../src/main/core/downloadLimits'

for (const stall of ['headers', 'empty-body', 'partial-body', 'trickle-before-warmup'] as const) {
  test(`下载 ${stall} 停滞会退出并续传换源，释放唯一并发名额`, { timeout: 6000 }, async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kamucl-stall-'))
    const payload = Buffer.alloc(8192, 42)
    const requests: string[] = []
    const ranges: string[] = []
    const previous = transferTimeouts.inactivityMs
    const previousSlow = { ...slowSpeedThresholds }
    transferTimeouts.inactivityMs = 100
    Object.assign(slowSpeedThresholds, { windowMs: 100, warmupMs: 100 })
    downloadLimiter.configure({ downloadThreads: 1, downloadSpeedKBps: 0 })
    resetHostHealthForTest()
    const server = http.createServer((req, res) => {
      requests.push(req.url!)
      if (req.url === '/stalled') {
        if (stall === 'headers') return
        res.writeHead(200, { 'content-length': payload.length })
        res.flushHeaders()
        if (stall === 'trickle-before-warmup') {
          const timer = setInterval(() => res.write(payload.subarray(0, 1)), 20)
          res.on('close', () => clearInterval(timer))
        }
        if (stall === 'partial-body') res.write(payload.subarray(0, 1024))
        return
      }
      const range = req.headers.range ?? ''
      ranges.push(range)
      const offset = Number(range.match(/bytes=(\d+)-/)?.[1] ?? 0)
      res.writeHead(offset ? 206 : 200, { 'content-length': payload.length - offset, ...(offset ? { 'content-range': `bytes ${offset}-${payload.length - 1}/${payload.length}` } : {}) })
      res.end(payload.subarray(offset))
    })
    await new Promise<void>(r => server.listen(0, '127.0.0.1', r))
    const address = server.address() as { port: number }
    const base = `http://127.0.0.1:${address.port}`
    const controller = new AbortController()
    const deadline = setTimeout(() => controller.abort(), 4000)
    try {
      const dest = path.join(root, 'client.jar')
      await downloadFile(`${base}/stalled`, dest, undefined, crypto.createHash('sha1').update(payload).digest('hex'), 'official', controller.signal, [`${base}/healthy`], { size: payload.length })
      assert.deepEqual(fs.readFileSync(dest), payload)
      assert.deepEqual(requests, ['/stalled', '/healthy'], '一次停滞后直接换源，无重复超时等待')
      if (stall === 'trickle-before-warmup') assert.match(ranges[0], /^bytes=[1-9]\d*-/)
      else assert.deepEqual(ranges, [stall === 'partial-body' ? 'bytes=1024-' : ''])
      assert.equal(fs.existsSync(dest + '.part'), false)
      await downloadFile(`${base}/next`, path.join(root, 'next.jar'), undefined, undefined, 'official', controller.signal)
      assert.equal(requests.at(-1), '/next', '停滞连接必须归还并发名额')
    } finally {
      clearTimeout(deadline)
      controller.abort()
      transferTimeouts.inactivityMs = previous
      Object.assign(slowSpeedThresholds, previousSlow)
      downloadLimiter.configure(DEFAULT_DOWNLOAD_LIMITS)
      resetHostHealthForTest()
      server.closeAllConnections()
      await new Promise<void>(r => server.close(() => r()))
      fs.rmSync(root, { recursive: true, force: true })
    }
  })
}
