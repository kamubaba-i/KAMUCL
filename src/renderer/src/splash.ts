import faceUrl from './assets/splash-face.png'
import { makeBootPixels, pixelPosition, RISE_END, CONVERGE_DURATION, ASSEMBLED_HOLD_MS, BOOT_FRAME_MS, type BootState } from '@shared/startup'
import './splash.css'

const bridge = window.kamuclSplash
const canvas = document.querySelector<HTMLCanvasElement>('#pixels')!
const ctx = canvas.getContext('2d', { alpha: true })!
const caption = document.querySelector<HTMLSpanElement>('#stage')!
const face = new Image()
let state: BootState = { completed: [], ready: false }
let geometry = makeBootPixels(innerWidth, innerHeight)
let start = 0, convergence: number | null = null, raf = 0, assembled = false
let nextFrame = 0
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches
const labels = ['读取配置', '加载账户', '扫描游戏实例', '加载首页图片、Java 与皮肤', '准备首帧']
function resize() {
  const dpr = Math.min(devicePixelRatio || 1, 2)
  canvas.width = Math.round(innerWidth * dpr); canvas.height = Math.round(innerHeight * dpr)
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.imageSmoothingEnabled = false
  geometry = makeBootPixels(innerWidth, innerHeight)
}
const offState = bridge.onState(next => { state = next; caption.textContent = state.ready ? '准备就绪' : `${labels[Math.min(4, state.completed.length)]}…` })
const offReveal = bridge.onReveal(() => {
  // Main window is now visible and already painted behind this click-through overlay.
  document.body.classList.add('leaving')
  document.body.addEventListener('transitionend', () => bridge.finished(), { once: true })
})
function frame(now: number) {
  if (now + 0.5 < nextFrame) { raf = requestAnimationFrame(frame); return }
  if (!nextFrame) nextFrame = now
  nextFrame += BOOT_FRAME_MS
  if (nextFrame <= now) nextFrame = now + BOOT_FRAME_MS
  if (!start) start = now
  const elapsed = now - start
  if (state.ready && convergence === null && (reduced || elapsed >= RISE_END)) convergence = elapsed
  ctx.clearRect(0, 0, innerWidth, innerHeight)
  const { size, pixels } = geometry
  for (const pixel of pixels) {
    const p = reduced ? { x: pixel.targetX, y: pixel.targetY, rotation: 0 } : pixelPosition(pixel, elapsed, convergence)
    ctx.save(); ctx.translate(p.x + size / 2, p.y + size / 2); ctx.rotate(p.rotation)
    ctx.drawImage(face, pixel.col * face.width / 8, pixel.row * face.height / 8, face.width / 8, face.height / 8, -size / 2, -size / 2, size, size)
    ctx.restore()
  }
  if (!assembled && convergence !== null && (reduced || elapsed - convergence >= CONVERGE_DURATION)) {
    assembled = true
    // 完整头像先抵达合成器，再停留展示 ASSEMBLED_HOLD_MS 后揭示主界面；
    // reduced-motion 用户不强制停留。
    raf = requestAnimationFrame(() => setTimeout(() => bridge.assembled(), reduced ? 0 : ASSEMBLED_HOLD_MS))
  } else if (!assembled) raf = requestAnimationFrame(frame)
}
face.onload = () => { resize(); raf = requestAnimationFrame(frame); bridge.ready() }
face.onerror = () => bridge.failed('启动头像资源无法加载')
face.src = faceUrl
window.addEventListener('resize', resize)
window.addEventListener('error', () => bridge.failed('启动动画渲染失败'))
window.addEventListener('unload', () => { cancelAnimationFrame(raf); offState(); offReveal(); window.removeEventListener('resize', resize) })
