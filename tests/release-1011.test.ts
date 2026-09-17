import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc'

const read = (file: string) => fs.readFileSync(file, 'utf8')

test('installed version row: folder path has a full info row; action group stays together (1.0.88)', () => {
  const gv = read('src/renderer/src/views/GameView.vue')
  // 1.0.88：路径信息与操作区分行，操作组仍保持完整。
  const row = gv.match(/\.installed-row \{[\s\S]*?\}/)![0]
  assert.match(row, /flex-wrap: wrap/)
  // 操作区容器：钉右 + 不收缩 + 不换行
  const actions = gv.match(/\.row-actions \{[\s\S]*?\}/)![0]
  assert.match(actions, /margin-left: auto/)
  assert.match(actions, /flex-shrink: 0/)
  // 正常分支：iso-switch 与四个按钮都在 .row-actions 内（启动在删除前）
  const elseStart = gv.indexOf('<template v-else>', gv.indexOf('v-else-if="v.failed"'))
  const normalBranch = gv.slice(elseStart, gv.indexOf('</template>', elseStart))
  assert.match(normalBranch, /<div class="row-actions">/)
  assert.ok(normalBranch.indexOf('iso-switch') > normalBranch.indexOf('row-actions'))
  assert.ok(normalBranch.indexOf('installed-launch') > normalBranch.indexOf('iso-switch'))
  assert.ok(normalBranch.indexOf('installed-remove') > normalBranch.indexOf('installed-launch'))
  // 信息区/元信息区可收缩省略
  const names = gv.match(/\.inst-names \{[\s\S]*?\}/)![0]
  assert.match(names, /flex: 1 1 calc\(100% - 110px\)/)
  const played = gv.match(/\.played-text \{[\s\S]*?\}/)![0]
  assert.doesNotMatch(played, /margin-left: auto/)
  assert.match(played, /text-overflow: ellipsis/)
  // 旧的 auto 外边距推右规则已移除（避免双 auto 瓜分空间）；failed-row 的专属规则保留
  assert.doesNotMatch(gv, /^\.installed-folder \{\s*margin-left: auto;\s*\}/m)
})

test('GameView compiles after row redesign', () => {
  const source = read('src/renderer/src/views/GameView.vue')
  const { descriptor, errors } = parse(source)
  assert.deepEqual(errors, [])
  const script = compileScript(descriptor, { id: 'GameView.vue' })
  const result = compileTemplate({ source: descriptor.template!.content, filename: 'GameView.vue', id: 'GameView.vue', compilerOptions: { bindingMetadata: script.bindings } })
  assert.deepEqual(result.errors, [])
})
