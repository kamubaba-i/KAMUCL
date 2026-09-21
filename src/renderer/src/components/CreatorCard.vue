<script setup lang="ts">
import { ref } from 'vue'
import { useMotion } from '../motion'
const names = ['BAI_ZHU', 'AeZz', '物晖', '牛肉', '好好', 'hun_Bk', 'J39', '略略略', '鸦猫', 'sheri', '书九叶', 'yansan', '(x_x;)', '小坎坷', 'MuxYang', '八千代', 'Henry', '月を見ていた', 'Hiro', '摇滚高手']
const expanded = ref(false)
const { decorativeActive } = useMotion()
</script>
<template>
 <section class="creator-card" data-ui="home:creators" @pointerenter="expanded=true">
  <div data-ui="CreatorCard:3b0bd35ff2cd" class="creator-heading"><button data-ui="CreatorCard:b838c4453411" class="creator-toggle" :aria-expanded="expanded" aria-controls="creator-names" @click="expanded=!expanded">参与测试及创作者<small data-ui="CreatorCard:d9b60520217e" lang="en">TESTERS &amp; CREATORS</small></button><a data-ui="CreatorCard:86b4c178a448" href="https://space.bilibili.com/9596327" target="_blank" rel="noopener noreferrer" class="icon-btn" aria-label="访问卡慕的哔哩哔哩空间">↗</a></div>
  <details class="creator-message"><summary>创作者的话</summary><p data-ui="CreatorCard:5031cfb3dd7e" class="creator-intro">好想做卡慕的狗啊，别的狗至少还图口饭，我不一样，我只希望他发视频的时候能允许我在评论区汪两声。卡慕但凡回我一个“？”我都能截图裱起来当传家宝。</p></details>
  <div v-show="expanded" id="creator-names" class="creator-name-layer" :class="{moving:decorativeActive}" data-ui="home:creator-names"><span data-ui="CreatorCard:7cd0fbc9196c" v-for="(name,i) in names" :key="name" class="creator-bubble" :style="{'--delay':i*40+'ms','--drift':(i%3-1)*3+'px'}"><span data-ui="CreatorCard:587246bec0b9">{{name}}</span></span></div>
 </section>
</template>
<style scoped>
.creator-card { min-width:0; overflow:hidden; padding:var(--card-pad); border:1px solid var(--border); border-radius:var(--radius-lg); background:var(--surface-content); }
.creator-heading { display:flex; align-items:center; justify-content:space-between; gap:12px; }
.creator-toggle { color:var(--text); background:none; border:0; padding:0; text-align:left; font-size:14px; font-weight:600; cursor:pointer; }
.creator-toggle small { display:block; font-size:11px; letter-spacing:1px; color:var(--text-dim); margin-top:4px; }
.creator-intro { font-size:12px; line-height:1.7; color:var(--text-dim); margin:12px 0 0; }
.creator-name-layer { display:flex; flex-wrap:wrap; gap:8px; padding:12px 2px 4px; max-height:210px; overflow:auto; contain:layout paint; }
.creator-bubble { font-size:12px; border-radius:999px; background:var(--card-2); padding:5px 9px; }
.moving .creator-bubble { animation:reveal 220ms both; animation-delay:var(--delay); }
.moving .creator-bubble span { display:block; animation:drift 4s ease-in-out infinite alternate; animation-delay:var(--delay); }
@keyframes reveal { from { opacity:0; transform:translateY(4px); } to { opacity:1; transform:none; } }
@keyframes drift { from { transform:translateY(-1px); } to { transform:translate(var(--drift),2px); } }
</style>
