<script setup lang="ts">
import { nextTick, onBeforeUnmount, onDeactivated, onMounted, ref } from 'vue'

const names = ['BAI_ZHU', 'AeZz', '物晖', '牛肉', '好好', 'hun_Bk', 'J39', '略略略', '鸦猫', 'sheri', '书九叶', 'yansan', '(x_x;)', '小坎坷', 'MuxYang', '八千代', 'Henry', '月を見ていた', 'Hiro', '摇滚高手']
const card = ref<HTMLElement>()
const layer = ref<HTMLElement>()
const visible = ref(false)
const revealed = ref(false)
const drifting = ref(false)
let hovering = false, focused = false, epoch = 0, frame = 0
let hideTimer: ReturnType<typeof setTimeout> | undefined
let motion: MediaQueryList | undefined
const revealStep = 90
let revealAt = 0, lastTime = 0
interface Bubble { el: HTMLElement; x: number; y: number; width: number; height: number; vx: number; vy: number; tx: number; ty: number; speed: number; delay: number; phase: number }
let bubbles: Bubble[] = []
const margin = 16
const topEdge = () => Math.min(96, innerHeight * .16)
const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(Math.max(min, max), v))
function destination(b: Bubble) {
  b.tx = margin + Math.random() * Math.max(0, innerWidth - b.width - margin * 2)
  b.ty = topEdge() + Math.random() * Math.max(0, innerHeight - b.height - topEdge() - margin)
}
function paint(b: Bubble) { b.el.style.transform = 'translate3d(' + b.x.toFixed(2) + 'px,' + b.y.toFixed(2) + 'px,0)' }
function layout() {
  if (!card.value || !layer.value) return
  const anchor = card.value.getBoundingClientRect()
  const width = Math.min(440, innerWidth - margin * 2)
  const rows: { items: Bubble[]; width: number; height: number }[] = []
  bubbles = Array.from(layer.value.querySelectorAll<HTMLElement>('.creator-bubble')).map((el, i) => ({ el, x: 0, y: 0, width: el.offsetWidth, height: el.offsetHeight, vx: 0, vy: 0, tx: 0, ty: 0, speed: 48 + Math.random() * 22, delay: i * revealStep, phase: Math.random() * Math.PI * 2 }))
  if (!motion?.matches) {
    // Loose, spaced origins above the card: no stationary grid before departure.
    const placed: Bubble[] = []
    for (const b of bubbles) {
      let best = -Infinity
      for (let attempt = 0; attempt < 24; attempt++) {
        const x = clamp(anchor.left - 180 + Math.random() * (anchor.width + 200), margin, innerWidth - b.width - margin)
        const y = clamp(anchor.top - 36 - Math.random() * 250, topEdge(), innerHeight - b.height - margin)
        const distance = placed.reduce((min, other) => Math.min(min, Math.hypot((x - other.x) / ((b.width + other.width) / 2 + 12), (y - other.y) / ((b.height + other.height) / 2 + 12))), Infinity)
        if (distance > best) { best = distance; b.x = x; b.y = y }
      }
      destination(b)
      const dx = b.tx - b.x, dy = b.ty - b.y, length = Math.hypot(dx, dy) || 1
      b.vx = dx / length * b.speed; b.vy = dy / length * b.speed
      placed.push(b); paint(b)
    }
    return
  }
  for (const b of bubbles) {
    let row = rows[rows.length - 1]
    if (!row || row.width + 8 + b.width > width) { row = { items: [], width: 0, height: 0 }; rows.push(row) }
    row.width += (row.items.length ? 8 : 0) + b.width; row.height = Math.max(row.height, b.height); row.items.push(b)
  }
  const total = rows.reduce((sum, row) => sum + row.height + 8, -8)
  let y = clamp(anchor.top - total - 14, topEdge(), innerHeight - total - margin)
  const center = clamp(anchor.left + anchor.width / 2, margin + width / 2, innerWidth - margin - width / 2)
  for (const row of rows) {
    let x = center - row.width / 2
    for (const b of row.items) { b.x = x; b.y = y; destination(b); paint(b); x += b.width + 8 }
    y += row.height + 8
  }
}
function animate(now: number) {
  frame = 0
  if (!visible.value || !revealed.value || document.hidden || motion?.matches) return
  const dt = Math.min(.04, Math.max(0, (now - lastTime) / 1000)); lastTime = now
  const age = now - revealAt
  if (age >= 0) {
    drifting.value = true
    for (const b of bubbles) {
      if (age < b.delay) continue
      let dx = b.tx - b.x, dy = b.ty - b.y, distance = Math.hypot(dx, dy)
      if (distance < 28) { destination(b); dx = b.tx - b.x; dy = b.ty - b.y; distance = Math.hypot(dx, dy) }
      const breeze = Math.sin(now / 1900 + b.phase) * 9
      let desiredX = dx / Math.max(1, distance) * b.speed - dy / Math.max(1, distance) * breeze
      let desiredY = dy / Math.max(1, distance) * b.speed + dx / Math.max(1, distance) * breeze
      // Soft separation keeps nearby names readable while retaining individual paths.
      for (const other of bubbles) {
        if (other === b || age < other.delay) continue
        const cx = b.x + b.width / 2 - other.x - other.width / 2
        const cy = b.y + b.height / 2 - other.y - other.height / 2
        const rx = (b.width + other.width) / 2 + 12, ry = (b.height + other.height) / 2 + 12
        const proximity = Math.hypot(cx / rx, cy / ry)
        if (proximity < 1.3) {
          const length = Math.hypot(cx, cy) || 1, force = (1.3 - proximity) * 120
          desiredX += cx / length * force; desiredY += cy / length * force
        }
      }
      const speedLimit = Math.max(1, Math.hypot(desiredX, desiredY) / 85)
      const ease = 1 - Math.exp(-dt * 2.5)
      b.vx += (desiredX / speedLimit - b.vx) * ease
      b.vy += (desiredY / speedLimit - b.vy) * ease
      b.x = clamp(b.x + b.vx * dt, margin, innerWidth - b.width - margin)
      b.y = clamp(b.y + b.vy * dt, topEdge(), innerHeight - b.height - margin)
      paint(b)
    }
  }
  frame = requestAnimationFrame(animate)
}
async function show() {
  if (visible.value && revealed.value || document.hidden) return
  const current = ++epoch
  clearTimeout(hideTimer); cancelAnimationFrame(frame)
  visible.value = true; revealed.value = false; drifting.value = false
  await nextTick()
  if (current !== epoch || !visible.value) return
  layout()
  // Commit the starting transform/opacity before the staggered entrance.
  void layer.value?.offsetHeight
  frame = requestAnimationFrame(now => {
    if (current !== epoch) return
    revealed.value = true; lastTime = now; revealAt = now
    if (!motion?.matches) frame = requestAnimationFrame(animate)
  })
}
function hide(immediate = false) {
  epoch++; cancelAnimationFrame(frame); frame = 0; clearTimeout(hideTimer)
  revealed.value = false; drifting.value = false
  if (immediate) { visible.value = false; bubbles = [] }
  else hideTimer = setTimeout(() => { visible.value = false; bubbles = [] }, 260)
}
function enter() { hovering = true; void show() }
function leave() { hovering = false; if (!focused) hide() }
function focus() { focused = true; void show() }
function blur() { focused = false; if (!hovering) hide() }
function resize() {
  if (!visible.value) return
  if (!drifting.value || motion?.matches) { layout(); return }
  for (const b of bubbles) {
    b.x = clamp(b.x, margin, innerWidth - b.width - margin); b.y = clamp(b.y, topEdge(), innerHeight - b.height - margin)
    destination(b); paint(b)
  }
}
function visibility() {
  if (document.hidden) hide(true)
  else if (card.value?.matches(':hover') || document.activeElement === card.value) void show()
}
function motionChanged() { hide(true); if (hovering || focused) void show() }
function escape(event: KeyboardEvent) { if (event.key === 'Escape') hide() }
onMounted(() => {
  motion = matchMedia('(prefers-reduced-motion: reduce)'); motion.addEventListener('change', motionChanged)
  window.addEventListener('resize', resize); document.addEventListener('visibilitychange', visibility); document.addEventListener('keydown', escape)
})
onDeactivated(() => { hovering = focused = false; hide(true) })
onBeforeUnmount(() => {
  hide(true); motion?.removeEventListener('change', motionChanged)
  window.removeEventListener('resize', resize); document.removeEventListener('visibilitychange', visibility); document.removeEventListener('keydown', escape)
})
</script>

<template>
  <a ref="card" class="creator-card" data-ui="home:creators" href="https://space.bilibili.com/9596327" target="_blank" rel="noopener noreferrer" aria-label="访问卡慕SaMa的哔哩哔哩空间（在浏览器中打开）；参与测试及创作者" @pointerenter="enter" @pointerleave="leave" @focus="focus" @blur="blur">
    <span class="creator-heading">
      <span class="creator-eyebrow">参与测试及创作者 <span lang="en">TESTERS &amp; CREATORS</span></span>
      <svg class="creator-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 18 18 6M7 6h11v11" /></svg>
    </span>
    <span class="creator-intro">好想做卡慕的狗啊，别的狗至少还图口饭，我不一样，我只希望他发视频的时候能允许我在评论区汪两声。卡慕但凡回我一个“？”我都能截图裱起来当传家宝。</span>
    <span class="creator-accessible-names">{{ names.join('、') }}</span>
  <Teleport to="body">
    <div v-if="visible" ref="layer" class="creator-name-layer" :class="{ revealed }" :data-phase="drifting ? 'drifting' : 'revealing'" data-ui="home:creator-names" aria-hidden="true">
      <span v-for="(name, i) in names" :key="name" class="creator-bubble"><span :style="{ '--reveal-delay': i * revealStep + 'ms' }">{{ name }}</span></span>
    </div>
  </Teleport>
  </a>
</template>

<style scoped>
.creator-card { position:relative; display:flex; flex-direction:column; gap:12px; min-width:0; padding:var(--space-4) var(--card-pad); border:1px solid var(--border); border-radius:var(--radius-lg); background:linear-gradient(135deg,var(--accent-soft),transparent 75%),var(--card); color:var(--text); box-shadow:var(--shadow); text-decoration:none; cursor:pointer; transition:border-color 220ms ease,box-shadow 220ms ease; }
.creator-heading { display:flex; align-items:flex-start; justify-content:space-between; gap:12px; }
.creator-eyebrow { color:var(--text-dim); font-size:var(--text-xs); font-weight:600; letter-spacing:1px; line-height:1.5; }
.creator-eyebrow span { display:block; margin-top:3px; font-size:10px; letter-spacing:1.5px; opacity:.8; }
.creator-arrow { flex-shrink:0; width:16px; height:16px; margin-top:3px; color:var(--text-dim); transition:transform 220ms ease; }
.creator-intro { font-size:var(--text-xs); line-height:1.85; text-wrap:pretty; }
.creator-card:hover,.creator-card:focus-visible { border-color:var(--accent); box-shadow:var(--shadow),0 0 0 3px var(--accent-soft); }
.creator-card:focus-visible { outline:2px solid var(--accent); outline-offset:4px; }
.creator-card:hover .creator-arrow { transform:translate(2px,-2px); }
.creator-accessible-names { position:absolute; width:1px; height:1px; padding:0; overflow:hidden; clip-path:inset(50%); white-space:nowrap; }
.creator-name-layer { position:fixed; inset:0; z-index:80; overflow:hidden; pointer-events:none; contain:layout style; }
.creator-bubble { position:absolute; top:0; left:0; pointer-events:none; will-change:transform; }
.creator-bubble > span { display:block; padding:7px 14px; border:1px solid color-mix(in srgb,var(--border) 65%,transparent); border-radius:999px; background:linear-gradient(125deg,var(--accent-soft),transparent 70%),color-mix(in srgb,var(--card-solid,var(--card)) 94%,transparent); color:var(--text); box-shadow:var(--shadow); font-size:var(--text-xs); font-weight:500; white-space:nowrap; opacity:0; transform:translateY(8px) scale(.96); transition:opacity 240ms ease,transform 340ms cubic-bezier(.2,.8,.2,1); }
.revealed .creator-bubble > span { opacity:1; transform:translateY(0) scale(1); transition-delay:var(--reveal-delay); }
@media(prefers-reduced-motion:reduce) { .creator-card,.creator-arrow,.creator-bubble > span { transition:none; } .creator-bubble { will-change:auto; } }
</style>
