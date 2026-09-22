import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import { publicRoomInfo } from '../src/main/core/voxlink/engine'

test('VoxLink public room snapshots remove server tokens', () => {
  const publicRoom = publicRoomInfo({
    code: 'ABC123', name: 'test', hostIp: '127.0.0.1', hostPort: 25565,
    maxPlayers: 20, currentPlayers: 1, hasPassword: false, category: '',
    gameVersion: '', loader: '', clientType: 'app', expiresIn: 300, isHost: true,
    hostToken: 'host-secret', clientToken: 'client-secret'
  } as any)
  assert.equal(publicRoom?.code, 'ABC123')
  assert.equal('hostToken' in (publicRoom as object), false)
  assert.equal('clientToken' in (publicRoom as object), false)
  assert.equal(JSON.stringify(publicRoom).includes('secret'), false)
})

test('VoxLink IPC does not return or forward session tokens to renderer', () => {
  const source = fs.readFileSync('src/main/core/voxlink/index.ts', 'utf8')
  assert.match(source, /return \{ ok: true \}/)
  assert.doesNotMatch(source, /return \{ ok: true, \.\.\.r \}/)
  assert.match(source, /publicRoomInfo\(a\.room\)/)
  assert.match(source, /room: publicRoomInfo\(/)
})
