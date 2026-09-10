<template>
  <a class="creator-card" href="https://space.bilibili.com/9596327" target="_blank" rel="noopener noreferrer" aria-label="访问卡慕SaMa的哔哩哔哩空间（在浏览器中打开）">
    <span class="creator-heading">
      <span class="creator-eyebrow">创作者 <span aria-hidden="true">/ CREATOR</span></span>
      <svg class="creator-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 18 18 6M7 6h11v11" /></svg>
    </span>
    <span class="creator-intro">好想做卡慕的狗啊，别的狗至少还图口饭，我不一样，我只希望他发视频的时候能允许我在评论区汪两声。卡慕但凡回我一个“？”我都能截图裱起来当传家宝。</span>
    <span class="creator-names" aria-hidden="true"><span>BAI_ZHU</span><span>AeZz</span><span>物晖</span></span>
  </a>
</template>

<style scoped>
.creator-card {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 0;
  padding: var(--space-4) var(--card-pad);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  background: linear-gradient(135deg, var(--accent-soft), transparent 75%), var(--card);
  color: var(--text);
  box-shadow: var(--shadow);
  text-decoration: none;
  cursor: pointer;
  transition: border-color 220ms ease, box-shadow 220ms ease;
}
.creator-heading { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.creator-eyebrow { color: var(--text-dim); font-size: var(--text-xs); font-weight: 600; letter-spacing: 1px; }
.creator-eyebrow span { margin-left: 4px; letter-spacing: 1.4px; }
.creator-arrow { width: 16px; height: 16px; color: var(--text-dim); transition: transform 220ms ease; }
.creator-intro { font-size: var(--text-xs); line-height: 1.85; text-wrap: pretty; }
.creator-card:hover, .creator-card:focus-visible { border-color: var(--accent); box-shadow: var(--shadow), 0 0 0 3px var(--accent-soft); }
.creator-card:focus-visible { outline: 2px solid var(--accent); outline-offset: 4px; }
.creator-card:hover .creator-arrow { transform: translate(2px, -2px); }
.creator-names { position: absolute; bottom: calc(100% + 12px); left: 12px; right: 12px; display: flex; justify-content: center; gap: 8px; pointer-events: none; }
.creator-names > span {
  padding: 7px 12px;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: var(--card);
  color: var(--text);
  box-shadow: var(--shadow);
  font-size: var(--text-xs);
  white-space: nowrap;
  opacity: 0;
  transform: translateY(12px) scale(.94);
  transition: opacity 220ms ease, transform 420ms cubic-bezier(.2,.8,.2,1);
}
.creator-names > span:nth-child(2) { transition-delay: 45ms; }
.creator-names > span:nth-child(3) { transition-delay: 90ms; }
.creator-card:hover .creator-names > span, .creator-card:focus-visible .creator-names > span { opacity: 1; transform: translateY(0) scale(1); animation: creator-float 3s ease-in-out 450ms infinite; }
.creator-card:hover .creator-names > span:nth-child(2), .creator-card:focus-visible .creator-names > span:nth-child(2) { animation-delay: 700ms; }
.creator-card:hover .creator-names > span:nth-child(3), .creator-card:focus-visible .creator-names > span:nth-child(3) { animation-delay: 950ms; }
@keyframes creator-float { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-5px); } }
@media (prefers-reduced-motion: reduce) {
  .creator-card, .creator-arrow, .creator-names > span { transition: none; }
  .creator-card .creator-names > span { animation: none !important; }
}
</style>
