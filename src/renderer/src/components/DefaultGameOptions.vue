<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { GAME_OPTIONS, GAME_OPTION_PAGES, VIDEO_OPTION_ORDER, uniqueGameOptions, supportedGameOption, type DefaultGameOptions, type GameOptionDef, type GameOptionValue } from '@shared/gameOptions'
import { getDefaultGameOptions, setDefaultGameOptions, errText } from '../api'
import { store, toast } from '../store'
const emit = defineEmits<{ section: [value: 'keys' | 'packs'] }>()
const state = ref<DefaultGameOptions>({ enabled: false, values: {} })
const draft = ref<Record<string, GameOptionValue>>({})
const busy = ref(false), loading = ref(true), page = ref('root'), version = ref('26.2')
const versions = computed(() => [...new Set(['26.2', ...store.installed.map(v => v.mcVersion).filter(Boolean), '1.21.11', '1.20.1', '1.16.5', '1.12.2'])])
const title = computed(() => page.value === 'root' ? '选项' : page.value === 'mouse' ? '鼠标设置' : GAME_OPTION_PAGES.find(p => p[0] === page.value)?.[1])
const rows = computed(() => {
  const list = GAME_OPTIONS.filter(d => d.page === page.value).map(d => uniqueGameOptions.find(o => o.id === d.id)!)
  return page.value === 'video' ? list.sort((a,b) => VIDEO_OPTION_ORDER.indexOf(a.id) - VIDEO_OPTION_ORDER.indexOf(b.id)) : list
})
const unavailable = computed(() => uniqueGameOptions.filter(d => d.id in state.value.values && !supportedGameOption(d, version.value)))
const value = (d: GameOptionDef) => draft.value[d.id] ?? state.value.values[d.id] ?? d.initial
const label = (d: GameOptionDef) => d.choices?.find(c => c[0] === value(d))?.[1] ?? (typeof value(d) === 'boolean' ? (value(d) ? '开启' : '关闭') : String(value(d)) + (d.unit ?? ''))
async function save(change: Parameters<typeof setDefaultGameOptions>[0]) {
  if (busy.value) return
  busy.value = true
  try { state.value = await setDefaultGameOptions(change); draft.value = {} }
  catch (e) { draft.value = {}; toast('保存游戏选项失败：' + errText(e), 'error') }
  finally { busy.value = false }
}
function cycle(d: GameOptionDef) {
  const choices = d.choices?.map(c => c[0]) ?? [false, true]
  void save({ id: d.id, value: choices[(choices.indexOf(value(d)) + 1) % choices.length] })
}
function numericChange(d: GameOptionDef, event: Event) {
  const input = event.target as HTMLInputElement
  if (!input.checkValidity() || input.value === '') { input.value = String(value(d)); return }
  void save({ id: d.id, value: Number(input.value) })
}
function open(id: string) { if (id === 'packs') emit('section', 'packs'); else page.value = id }
onMounted(async () => {
  try { state.value = await getDefaultGameOptions() } catch (e) { toast(errText(e), 'error') }
  finally { loading.value = false }
})
</script>

<template>
  <section class="card game-options">
    <header class="options-header">
      <div><h2>游戏选项</h2><p class="muted">按游戏内「Esc → 选项」的入口顺序设置，下次启动时应用。</p></div>
      <label class="options-sync"><span>启动时同步</span><span class="switch"><input type="checkbox" :checked="state.enabled" :disabled="busy || loading" @change="save({enabled: ($event.target as HTMLInputElement).checked})"><span class="switch-ui"></span></span></label>
    </header>
    <div class="options-context">
      <span class="tag">{{ Object.keys(state.values).length }} 项自定义</span>
      <label>兼容性预览 <select v-model="version" class="input"><option v-for="v in versions" :key="v" :value="v">Minecraft {{ v }}</option></select></label>
    </div>
    <p class="options-note muted">只同步你修改的项目，其余保留游戏设置。预览版本用于检查兼容性，启动时会按实际版本转换数值。</p>
    <p v-if="unavailable.length" class="options-warning">{{ version }} 不支持：{{ unavailable.map(d => d.label).join('、') }}。这些项目仅对支持它们的版本生效。</p>
    <div class="options-path"><button v-if="page !== 'root'" class="btn btn-ghost btn-sm" @click="page = page === 'mouse' ? 'controls' : 'root'">← 返回</button><span>选项{{ page === 'mouse' ? ' / 控制' : '' }}{{ page !== 'root' ? ' / ' + title : '' }}</span></div>
    <div v-if="page === 'controls'" class="mc-options-grid options-entrances"><button class="btn btn-ghost" @click="page = 'mouse'">鼠标设置…</button><button class="btn btn-ghost" @click="emit('section', 'keys')">按键控制…</button></div>
    <div v-if="loading" class="empty">正在读取配置…</div>
    <div v-else class="mc-options-grid">
      <div v-for="d in rows" :key="d.id" class="option-cell" :class="{'option-custom': d.id in state.values, 'option-unsupported': !supportedGameOption(d, version)}">
        <div class="option-caption"><span>{{ d.label }}</span><label v-if="typeof d.initial === 'number' && !d.choices" class="option-number"><input type="number" :aria-label="d.label + '数值'" :min="d.min" :max="d.max" :step="d.step" :value="value(d)" :disabled="busy || !supportedGameOption(d, version)" @change="numericChange(d, $event)"><span>{{ d.unit }}</span></label><strong v-else>{{ label(d) }}</strong></div>
        <input v-if="typeof d.initial === 'number' && !d.choices" type="range" :aria-label="d.label" :min="d.min" :max="d.max" :step="d.step" :value="value(d)" :disabled="busy || !supportedGameOption(d, version)" @input="draft[d.id] = Number(($event.target as HTMLInputElement).value)" @change="save({id:d.id, value:Number(($event.target as HTMLInputElement).value)})">
        <select v-else-if="d.choices && d.choices.length > 3" class="input option-select" :aria-label="d.label" :value="value(d)" :disabled="busy || !supportedGameOption(d, version)" @change="save({id:d.id,value:d.choices.find(c => String(c[0]) === ($event.target as HTMLSelectElement).value)![0]})"><option v-for="[v, name] in d.choices" :key="String(v)" :value="String(v)">{{ name }}</option></select>
        <button v-else class="option-toggle" :aria-label="d.label" :disabled="busy || !supportedGameOption(d, version)" @click="cycle(d)">{{ label(d) }} <span>↻</span></button>
        <div class="option-foot"><small>{{ !supportedGameOption(d, version) ? (d.until ? '此版本已移除此选项' : '需要 Minecraft ' + d.since + ' 或更新版本') : d.id in state.values ? (state.enabled ? '将应用到游戏' : '已保存 · 同步未开启') : '跟随游戏 · 尚未覆盖' }}</small><button v-if="d.id in state.values" :disabled="busy" @click="save({id:d.id,value:null})">跟随游戏</button><button v-else :disabled="busy || !supportedGameOption(d, version)" @click="save({id:d.id,value:value(d)})">应用此值</button></div>
      </div>
      <div v-if="page === 'root'" class="option-cell world-option"><div class="option-caption">世界选项 / 难度</div><p class="muted">由单人世界或服务器管理，请在游戏中修改。</p></div>
    </div>
    <div v-if="page === 'root'" class="mc-options-grid options-entrances"><button v-for="[id, name] in GAME_OPTION_PAGES" :key="id" class="option-entry" @click="open(id)">{{ name }}<span>›</span></button></div>
    <p v-if="page === 'credits'" class="empty">Minecraft 的鸣谢与著作权信息请在游戏内查看；此入口不修改配置。</p>
    <p class="options-note muted">画面受模组、资源包、服务器和显示设备影响；这里同步原版选项值。若模组接管同名选项，请同时检查该模组设置。</p>
  </section>
</template>

<style scoped>
.option-number{display:flex;align-items:center;gap:4px;color:var(--accent-2)}.option-number input{width:76px;text-align:right;border:1px solid var(--border);border-radius:6px;background:var(--card);color:var(--text);padding:3px 5px;font:inherit;font-variant-numeric:tabular-nums}.option-select{width:100%}
.game-options{padding:28px}.options-header{display:flex;align-items:flex-start;justify-content:space-between;gap:20px}.options-header h2{font-size:20px;margin:0 0 7px}.options-header p{margin:0;font-size:13px}.options-sync{display:flex;align-items:center;gap:10px;white-space:nowrap;font-size:13px}.options-context{display:flex;justify-content:space-between;align-items:center;gap:16px;margin-top:24px;padding-top:20px;border-top:1px solid var(--border)}.options-context label{display:flex;align-items:center;gap:10px;color:var(--text-dim);font-size:12px}.options-context select{width:180px}.options-note{font-size:12px;line-height:1.7;margin:14px 0}.options-warning{padding:12px;border-radius:10px;background:var(--accent-soft);color:var(--text);font-size:13px}.options-path{display:flex;align-items:center;gap:12px;font-weight:650;margin:25px 0 15px}.mc-options-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.option-cell{padding:16px;background:var(--card-2);border:1px solid var(--border);border-radius:12px;min-width:0}.option-custom{border-color:color-mix(in srgb,var(--accent) 45%,var(--border))}.option-unsupported{opacity:.65}.option-caption{display:flex;justify-content:space-between;gap:12px;font-size:13px;margin-bottom:14px}.option-caption strong{color:var(--accent-2);font-variant-numeric:tabular-nums}.option-cell input[type=range]{width:100%;accent-color:var(--accent);margin:0;height:22px}.option-toggle{width:100%;border:1px solid var(--border);border-radius:8px;padding:9px 12px;background:var(--card);color:var(--text);display:flex;justify-content:space-between;cursor:pointer}.option-foot{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:12px;color:var(--text-dim)}.option-foot small{font-size:11px}.option-foot button{border:0;background:none;color:var(--accent-2);font-size:11px;cursor:pointer;white-space:nowrap}.options-entrances{margin:18px 0}.option-entry{display:flex;align-items:center;justify-content:space-between;padding:15px 18px;border:1px solid var(--border);border-radius:10px;background:var(--card-2);color:var(--text);cursor:pointer;transition:background 180ms,border-color 180ms}.option-entry:hover{background:var(--accent-soft);border-color:var(--accent)}.world-option p{font-size:12px;line-height:1.7}@media(max-width:850px){.options-header,.options-context{flex-wrap:wrap}.game-options{padding:20px}}@media(max-width:650px){.mc-options-grid{grid-template-columns:1fr}.options-context label{flex-wrap:wrap}}
</style>
