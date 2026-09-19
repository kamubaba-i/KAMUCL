import assert from 'node:assert/strict'
import test from 'node:test'
import { parseRemoteVersion } from '../src/main/core/versions'

test('version manifest entries require the Mojang SHA1 before JSON download', () => {
  const valid = parseRemoteVersion({
    id: '1.20.1', type: 'release',
    url: 'https://piston-meta.mojang.com/version.json',
    releaseTime: '2023-06-07T00:00:00Z',
    sha1: 'a'.repeat(40)
  })
  assert.equal(valid?.sha1, 'a'.repeat(40))
  assert.equal(parseRemoteVersion({ ...valid, sha1: undefined }), null)
  assert.equal(parseRemoteVersion({ ...valid, sha1: 'not-a-sha1' }), null)
})
