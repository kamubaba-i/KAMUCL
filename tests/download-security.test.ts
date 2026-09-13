import test from 'node:test'
import assert from 'node:assert/strict'
import { downloadFetch } from '../src/main/core/downloadFetch'

type RequestCall = { url: string; headers: Record<string, string> }

function redirect(location: string): Response {
  return new Response(null, { status: 302, headers: { location } })
}

function captureFetcher(responses: Response[]) {
  const calls: RequestCall[] = []
  const fetcher = async (url: string, init?: { headers?: Record<string, string> }) => {
    calls.push({ url, headers: { ...(init?.headers ?? {}) } })
    return responses.shift() ?? new Response('ok')
  }
  return { calls, fetcher }
}

test('same-origin HTTPS redirects retain request headers', async () => {
  const { calls, fetcher } = captureFetcher([
    redirect('https://download.example/mirror/file.zip'),
    new Response('ok')
  ])

  await downloadFetch('https://download.example/file.zip', {
    headers: {
      authorization: 'Bearer source-token',
      cookie: 'session=source',
      'x-api-key': 'source-key',
      'proxy-authorization': 'Basic source-credentials',
      Accept: 'application/zip',
      Range: 'bytes=0-99'
    }
  }, undefined, fetcher)

  assert.deepEqual(calls[1].headers, calls[0].headers)
})

test('same-origin CurseForge redirects retain credentials while refreshing the application key', async () => {
  const { calls, fetcher } = captureFetcher([
    redirect('https://edge.forgecdn.net/files/1/2/mirror.zip'),
    new Response('ok')
  ])

  await downloadFetch('https://edge.forgecdn.net/files/1/2/file.zip', {
    headers: {
      authorization: 'Bearer source-token',
      cookie: 'session=source',
      Accept: 'application/zip'
    }
  }, async () => 'fresh-key', fetcher)

  assert.equal(calls[0].headers.authorization, 'Bearer source-token')
  assert.equal(calls[0].headers.cookie, 'session=source')
  assert.equal(calls[0].headers['x-api-key'], 'fresh-key')
  assert.equal(calls[1].headers.authorization, 'Bearer source-token')
  assert.equal(calls[1].headers.cookie, 'session=source')
  assert.equal(calls[1].headers['x-api-key'], 'fresh-key')
})

test('cross-origin redirects remove source credentials but retain public download headers', async () => {
  const { calls, fetcher } = captureFetcher([
    redirect('https://mirror.example/file.zip'),
    new Response('ok')
  ])

  await downloadFetch('https://download.example/file.zip', {
    headers: {
      Authorization: 'Bearer source-token',
      cookie: 'session=source',
      'X-API-Key': 'source-key',
      'Proxy-Authorization': 'Basic source-credentials',
      Accept: 'application/zip',
      Range: 'bytes=0-99'
    }
  }, undefined, fetcher)

  assert.deepEqual(calls[1].headers, {
    Accept: 'application/zip',
    Range: 'bytes=0-99'
  })
})

test('HTTPS redirects to HTTP are rejected', async () => {
  const { calls, fetcher } = captureFetcher([
    redirect('http://download.example/file.zip')
  ])

  await assert.rejects(
    downloadFetch('https://download.example/file.zip', {}, undefined, fetcher),
    /下载跳转地址不安全/
  )
  assert.equal(calls.length, 1)
})

test('non-HTTP(S) redirects are rejected', async () => {
  const { calls, fetcher } = captureFetcher([
    redirect('file:///tmp/file.zip')
  ])

  await assert.rejects(
    downloadFetch('https://download.example/file.zip', {}, undefined, fetcher),
    /下载跳转地址不安全/
  )
  assert.equal(calls.length, 1)
})

test('redirects exceeding the maximum hop count are rejected', async () => {
  const { calls, fetcher } = captureFetcher(
    Array.from({ length: 10 }, (_, hop) => redirect(`https://download.example/file-${hop + 1}.zip`))
  )

  await assert.rejects(
    downloadFetch('https://download.example/file-0.zip', {}, undefined, fetcher),
    /下载跳转次数过多/
  )
  assert.equal(calls.length, 10)
})
