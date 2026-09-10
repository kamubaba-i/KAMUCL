import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import * as THREE from 'three'

/**
 * 3D 人物渲染对齐 skinview3d v3.4.2（参考/skinview3d-master，MIT）的专项回归：
 * 锁定本次审计修复的三处真实渲染瑕疵，防止后续回退。
 */
const read = (file: string) => fs.readFileSync(file, 'utf8')

test('换披风重建真实模型后保持直立、相机角度及缩放不变', async () => {
  const source = read('src/renderer/src/components/SkinViewer3D.vue').match(/<script setup lang="ts">([\s\S]*?)<\/script>/)![1].replace(/^import .*$/gm, '')
  const props = { src: '', variant: 'classic', animation: 'walk', paused: false, cape: '' }
  const context = vm.createContext({ THREE, performance, propsFixture: props, defineProps: () => props, withDefaults: (p: unknown) => p,
    ref: (value: unknown) => ({ value }), watch: () => {}, onMounted: () => {}, onUnmounted: () => {}, defineExpose: () => {},
    requestAnimationFrame: () => 1, loadImage: async () => ({ width: 64, height: 32 }) })
  const probe = `
    scene = new THREE.Scene(); camera = new THREE.PerspectiveCamera(FOV, 1, .5, 500);
    renderer = {} as THREE.WebGLRenderer; skinTex = new THREE.Texture(); buildModel();
    globalThis.probe = {
      orbit(y: number, p: number) { yaw = y; pitch = p; zoom = 1.4; walkBlend = props.animation === 'walk' ? 1 : 0; stepWalk(); applyCamera(); applyPose(); },
      snapshot() { root!.updateMatrixWorld(true); return { up: new THREE.Vector3(0,1,0).transformDirection(root!.matrixWorld).toArray(), camera: camera.position.toArray(), yaw: root!.rotation.y, zoom, parts: root!.children.length }; },
      cape() { rebuildCape(); }, pose() { stepWalk(); applyPose(); }, reset() { pitch=0; yaw=INITIAL_YAW; zoom=1; applyPose(); applyCamera(); }
    };
  `
  vm.runInContext(ts.transpileModule(source + probe, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText, context)
  const probeApi = context.probe
  for (const animation of ['walk', 'idle']) {
    props.animation = animation
    for (const angle of [-0.6, 0.45]) {
      probeApi.orbit(2.5, angle)
      const before = probeApi.snapshot()
      for (const cape of ['first-cape', 'second-cape', '']) {
        props.cape = cape; probeApi.cape(); await new Promise(r => setImmediate(r))
        for (let i = 0; i < 2; i++) {
          const after = probeApi.snapshot()
          assert(after.up.every((v: number, n: number) => Math.abs(v - [0, 1, 0][n]) < 1e-12), '模型重建及下一动画帧均保持直立')
          assert.deepEqual(after.camera, before.camera)
          assert.equal(after.yaw, before.yaw); assert.equal(after.zoom, before.zoom)
          assert.equal(after.parts, cape ? 7 : 6)
          probeApi.pose()
        }
      }
    }
  }
  probeApi.reset()
  assert.equal(probeApi.snapshot().zoom, 1)
  assert.equal(probeApi.snapshot().camera[1], 16)
})

test('skin3d parity: -y bottom face UV follows skinview3d uvBottom vertex order (no bowtie twist)', () => {
  const viewer = read('src/renderer/src/components/SkinViewer3D.vue')
  // three.js BoxGeometry 的 ny 面顶点序 = 前左/前右/后左/后右（vdir=-1，与其他面相反）；
  // skinview3d setUVs：uvBottom = [bottom[0], bottom[1], bottom[3], bottom[2]]
  // → 前缘贴区域下边、后缘贴区域上边、u 不镜像。后缘 u 反接会让底面前后边 u 相互反转（蝶形扭曲）。
  const m = viewer.match(/if \(f === 3\) \{[\s\S]*?\} else \{/)
  assert.ok(m, 'mapBoxUVs 底面分支存在')
  assert.match(m[0], /setXY\(o \+ 0, u0, vBot\)/)
  assert.match(m[0], /setXY\(o \+ 1, u1, vBot\)/)
  // 对照 skinview3d setUVs 原文：uvBottom=[bl,br,tl,tr] → o+2=tl=(u0,vTop)、o+3=tr=(u1,vTop)
  assert.match(m[0], /setXY\(o \+ 2, u0, vTop\)/)
  assert.match(m[0], /setXY\(o \+ 3, u1, vTop\)/)
  // 披风（64×32 纹理）的底面（下摆）同一约定
  const cape = viewer.match(/\/\/ 与 mapBoxUVs 相同的 -y 底面约定[\s\S]*?\} else \{/)
  assert.ok(cape, '披风底面分支存在')
  assert.match(cape[0], /setXY\(o \+ 2, u0, vTop\)/)
  assert.match(cape[0], /setXY\(o \+ 3, u1, vTop\)/)
})

test('skin3d parity: walking arms swing on X only + constant 0.02π outward Z tilt (skinview3d WalkAnimation)', () => {
  const viewer = read('src/renderer/src/components/SkinViewer3D.vue')
  // FCL 的臂 Y 轴副摆（±20°@20°/s）会把内前/内后角切进与躯干齐平的手臂（穿透 0.56~0.63px）
  assert.ok(!/subRate: 20/.test(viewer), '手臂 Y 副摆已移除')
  assert.match(viewer, /const ARM_BASE_TILT = Math\.PI \* 0\.02/)
  assert.match(viewer, /joints\.armL\.rotation\.z = ARM_BASE_TILT/)
  assert.match(viewer, /joints\.armR\.rotation\.z = -ARM_BASE_TILT/)
  // MC 原版公式（HumanoidModel.setupAnim）：cos × 1.4 × amount，行走 ±45°、四肢同幅、对角反相（用户要求与 MC 游戏完全一致）
  assert.match(viewer, /Math\.cos\(animT \* WALK_RATE\) \* j\.mainAmp/)
  assert.match(viewer, /mainAmp: 45/)
  assert.ok(!/mainAmp: 10|mainAmp: 30/.test(viewer), '旧 FCL 幅度（±10°/±30°）已替换为 MC ±45°')
})

test('skin3d parity: cape keeps skinview3d standard 10x16x1 with flip mount (no 8-wide regression)', () => {
  const viewer = read('src/renderer/src/components/SkinViewer3D.vue')
  assert.match(viewer, /new THREE\.BoxGeometry\(10, 16, 1\)/)
  assert.match(viewer, /faceRegions\(1, 1, 10, 16, 1\)/)
  assert.match(viewer, /rotation\.y = Math\.PI/)
})
