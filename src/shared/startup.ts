export const BOOT_STAGES = ['settings', 'accounts', 'instances', 'assets', 'paint'] as const
export type BootStage = typeof BOOT_STAGES[number]
export interface BootState { completed: BootStage[]; ready: boolean }

/** The compositor and renderer must BOTH be ready; animation completion alone never reveals an empty app. */
export class StartupGate {
  readonly completed = new Set<BootStage>()
  painted = false
  rendererReady = false
  assembled = false
  get state(): BootState { return { completed: [...this.completed], ready: this.painted && this.rendererReady } }
  get canReveal(): boolean { return this.state.ready && this.assembled }
}

export interface BootPixel { col: number; row: number; x: number; y: number; rise: number; delay: number; phase: number; targetX: number; targetY: number }
export const RISE_END = 900
export const CONVERGE_DURATION = 620
/** 汇聚成完整头像后的停留展示时长，之后主界面才渐显（splash 淡出）。 */
export const ASSEMBLED_HOLD_MS = 2000
const clamp = (v: number) => Math.max(0, Math.min(1, v))
const smooth = (v: number) => v * v * v * (v * (v * 6 - 15) + 10)

export function makeBootPixels(width: number, height: number, random: () => number = Math.random): { pixels: BootPixel[]; size: number } {
  const size = Math.max(10, Math.floor(Math.min(224, width * .26, height * .32) / 8))
  const board = size * 8
  return { size, pixels: Array.from({ length: 64 }, (_, i) => ({
    col: i % 8, row: Math.floor(i / 8),
    x: size + random() * Math.max(0, width - size * 3),
    y: height * .28 + random() * Math.max(0, height * .68 - size),
    rise: height * (.09 + random() * .06), delay: random() * 180, phase: random() * Math.PI * 2,
    targetX: Math.round((width - board) / 2) + i % 8 * size,
    targetY: Math.round((height - board) / 2) + Math.floor(i / 8) * size
  })) }
}

/** Smooth vertical acceleration/deceleration; a damped float at the top, then a short, decisive convergence. */
export function pixelPosition(p: BootPixel, elapsed: number, convergeAt: number | null): { x: number; y: number; rotation: number } {
  const floating = (time: number) => {
    const t = clamp((time - p.delay) / 650)
    return { x: p.x + Math.sin(time / 500 + p.phase) * 3 * t,
      y: p.y - p.rise * smooth(t) + Math.sin(time / 600 + p.phase) * 2 * t,
      rotation: Math.sin(time / 600 + p.phase) * .035 * t }
  }
  if (convergeAt === null || elapsed < convergeAt) return floating(elapsed)
  const t = clamp((elapsed - convergeAt) / CONVERGE_DURATION)
  if (t === 1) return { x: p.targetX, y: p.targetY, rotation: 0 }
  const from = floating(convergeAt), ease = smooth(t)
  return { x: from.x + (p.targetX - from.x) * ease, y: from.y + (p.targetY - from.y) * ease, rotation: from.rotation * (1 - ease) }
}
/** Match the portable native scene, including on high-refresh-rate displays. */
export const BOOT_FRAME_MS = 1000 / 60
