<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import type { RecordingCatalog, RecordingEntry, RecordingRequest, RecordingResult } from '@shared/recordings'
import { errText } from '../api'
import { toast } from '../store'
import SelectMenu from '../components/SelectMenu.vue'
import ConfirmModal from '../components/ConfirmModal.vue'
const data = ref<RecordingCatalog>({ entries: [], warnings: [], library: '', instances: [] })
const loading = ref(false), busy = ref(false), error = ref(''), query = ref(''), kind = ref('all'), source = ref('all'), page = ref(1), selected = ref<string[]>([]), target = ref(''), confirm = ref<'trash' | 'dispatch' | ''>('')
const results = ref<RecordingResult[]>([])
let generation = 0, disposed = false
const invoke = <T,>(channel: string, ...args: unknown[]) => window.kamucl.invoke(channel, ...args) as Promise<T>
const filtered = computed(() => data.value.entries.filter(e => (kind.value === 'all' || e.kind === kind.value) && (source.value === 'all' || (source.value === 'library' ? e.library : !e.library)) && `${e.name} ${e.source} ${e.directory}`.toLowerCase().includes(query.value.trim().toLowerCase())))
const pages = computed(() => Math.max(1, Math.ceil(filtered.value.length / 40)))
const rows = computed(() => filtered.value.slice((page.value - 1) * 40, page.value * 40))
const targets = computed(() => data.value.instances.map((i, n) => ({ value: String(n), label: i.name })))
const size = (n: number) => n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`
watch([query, kind, source], () => { page.value = 1; selected.value = [] })
async function refresh() {
  const id = ++generation; loading.value = true; error.value = ''
  try { const next = await invoke<RecordingCatalog>('recordings:list'); if (disposed || id !== generation) return; data.value = next; selected.value = selected.value.filter(id => next.entries.some(e => e.id === id)); page.value = Math.min(page.value, pages.value); target.value = '' }
  catch (e) { if (!disposed && id === generation) error.value = errText(e) }
  finally { if (!disposed && id === generation) loading.value = false }
}
function selectPage() { const ids = rows.value.map(e => e.id); selected.value = ids.every(id => selected.value.includes(id)) ? selected.value.filter(id => !ids.includes(id)) : [...new Set([...selected.value, ...ids])] }
async function open(entry?: RecordingEntry) { try { await invoke('recordings:open', entry?.id) } catch (e) { toast(errText(e), 'error') } }
async function execute(action: RecordingRequest['action'] | 'import') {
  if (busy.value) return
  const ids = [...selected.value], destination = target.value === '' ? undefined : data.value.instances[Number(target.value)]
  confirm.value = ''; busy.value = true
  try {
    const result = action === 'import' ? await invoke<RecordingResult[] | null>('recordings:import') : await invoke<RecordingResult[] | null>('recordings:operate', { action, ids, target: destination })
    if (result) { results.value = result; const failed = result.filter(r => !r.ok); selected.value = failed.map(r => r.id); toast(`已完成 ${result.length - failed.length} 项${failed.length ? `，${failed.length} 项未完成` : ''}`, failed.length ? 'error' : 'success'); await refresh() }
  } catch (e) { toast(errText(e), 'error') } finally { busy.value = false }
}
function escape(e: KeyboardEvent) { if (e.key === 'Escape') confirm.value = '' }
onMounted(() => { void refresh(); window.addEventListener('keydown', escape) })
onUnmounted(() => { disposed = true; generation++; window.removeEventListener('keydown', escape) })
</script>

<template>
  <section class="recordings-page" data-ui="recordings:page">
    <header class="page-head" data-ui="recordings:heading"><h1>录像</h1><p class="muted">集中整理 ReplayMod 与 Flashback 录像，保留原文件，随时提取或复制到实例。</p></header>
    <div class="card recording-library" data-ui="recordings:library">
      <div><h3>集中收藏文件夹</h3><p class="muted path">{{ data.library || '正在读取…' }}</p><p class="muted">自动读取已登记游戏目录及实例的录像目录。自定义位置的录像可手动导入。</p></div>
      <div class="actions"><button class="btn btn-ghost" @click="open()">打开收藏文件夹</button><button class="btn btn-gold" :disabled="busy" @click="execute('import')">导入录像…</button><button class="btn btn-ghost" :disabled="busy || loading" @click="refresh">刷新</button></div>
    </div>
    <div class="recording-filters" data-ui="recordings:filters">
      <input v-model="query" class="input" aria-label="搜索录像" placeholder="搜索录像名称、实例或路径…" :disabled="busy" />
      <SelectMenu v-model="kind" :disabled="busy" :options="[{ value: 'all', label: '全部格式' }, { value: 'replaymod', label: 'ReplayMod' }, { value: 'flashback', label: 'Flashback' }]" />
      <SelectMenu v-model="source" :disabled="busy" :options="[{ value: 'all', label: '全部位置' }, { value: 'library', label: '集中收藏' }, { value: 'instances', label: '游戏目录' }]" />
    </div>
    <div v-if="error" class="card" role="alert">{{ error }} <button class="btn btn-ghost" @click="refresh">重试</button></div>
    <details v-if="data.warnings.length" class="card"><summary>部分目录未读取（{{ data.warnings.length }}）</summary><p v-for="warning in data.warnings" :key="warning">{{ warning }}</p></details>
    <div class="card recording-controls" data-ui="recordings:controls">
      <div class="actions"><button class="btn btn-ghost" :disabled="busy || !rows.length" @click="selectPage">选择当前页</button><button class="btn btn-ghost" :disabled="busy || !filtered.length" @click="selected = filtered.map(e => e.id)">全选筛选结果（{{ filtered.length }}）</button><span>已选 {{ selected.length }} 项</span><button v-if="selected.length" class="btn btn-ghost" :disabled="busy" @click="selected = []">清空</button></div>
      <div v-if="selected.length" class="actions operation-row"><button class="btn btn-gold" :disabled="busy" @click="execute('collect')">收集到收藏</button><button class="btn btn-ghost" :disabled="busy" @click="execute('export')">提取到文件夹…</button><SelectMenu v-model="target" :disabled="busy" :options="targets" placeholder="选择目标实例" /><button class="btn btn-ghost" :disabled="busy || target === ''" @click="confirm = 'dispatch'">复制到实例</button><button class="btn btn-danger" :disabled="busy" @click="confirm = 'trash'">移入回收站</button></div>
      <p class="muted">复制时校验完整性，同名文件自动添加序号。播放与渲染请在对应模组内完成；跨版本复制前请确认游戏和模组兼容性。</p>
    </div>
    <div v-if="loading" class="card muted">正在读取录像目录…</div>
    <div v-else-if="!rows.length" class="card empty">暂无匹配的录像。可导入 .mcpr 或 Flashback .zip，或先在游戏中完成录制并保存。</div>
    <div v-else class="card recording-list" data-ui="recordings:list">
      <article v-for="entry in rows" :key="entry.id" class="recording-row">
        <input v-model="selected" type="checkbox" :value="entry.id" :aria-label="`选择 ${entry.name}`" :disabled="busy" />
        <div class="recording-info"><strong>{{ entry.name }}</strong><div class="muted">{{ entry.kind === 'replaymod' ? 'ReplayMod' : 'Flashback' }} · {{ entry.source }} · {{ size(entry.size) }} · {{ new Date(entry.modified).toLocaleString() }}</div><div class="muted path" :title="entry.directory">{{ entry.directory }}</div></div>
        <button class="btn btn-ghost btn-sm" @click="open(entry)">定位文件</button>
      </article>
    </div>
    <div class="actions pagination"><button class="btn btn-ghost" :disabled="page <= 1" @click="page--">上一页</button><span>{{ page }} / {{ pages }} · {{ filtered.length }} 个录像</span><button class="btn btn-ghost" :disabled="page >= pages" @click="page++">下一页</button></div>
    <details v-if="results.length" open class="card recording-results"><summary>上次操作结果</summary><p v-for="result in results" :key="result.id" :class="{ failed: !result.ok }">{{ result.name }}：{{ result.ok ? '已完成' : result.error }}<span v-if="result.path" class="muted path"> → {{ result.path }}</span></p></details>
    <ConfirmModal :open="!!confirm" :title="confirm === 'trash' ? '移入系统回收站' : '复制录像到实例'" :message="confirm === 'trash' ? `将所选 ${selected.length} 个原位置的录像移入系统回收站，可从系统回收站恢复。` : `将 ${selected.length} 个录像复制到所选实例的对应模组目录，保留源文件。请确认目标游戏版本、加载器与录像模组兼容；操作期间目标游戏需关闭。`" :confirm-text="confirm === 'trash' ? '移入回收站' : '确认复制'" @cancel="confirm = ''" @confirm="execute(confirm as 'trash' | 'dispatch')" />
  </section>
</template>

<style scoped>
.recordings-page{max-width:1440px;margin:0 auto;display:grid;gap:20px;min-width:0}.page-head h1{margin:0 0 8px}.card{padding:22px}.recording-library{display:flex;justify-content:space-between;gap:20px;flex-wrap:wrap}.recording-library h3{margin:0}.actions{display:flex;align-items:center;gap:10px;flex-wrap:wrap}.recording-filters{display:grid;grid-template-columns:minmax(180px,1fr) 180px 180px;gap:12px}.recording-controls{display:grid;gap:16px}.recording-controls p{margin:0}.operation-row :deep(.select-menu-btn){max-width:360px}.recording-list{max-height:65vh;overflow:auto;overscroll-behavior:contain}.recording-row{display:flex;align-items:center;gap:16px;padding:16px 0;border-bottom:1px solid var(--border)}.recording-row:last-child{border:0}.recording-info{flex:1;min-width:0;display:grid;gap:6px}.recording-info strong{overflow-wrap:anywhere}.path{overflow-wrap:anywhere;font-size:12px}.recording-info .path{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.pagination{justify-content:center}.empty{text-align:center;padding:40px}.failed{color:var(--danger,#e76b75)}.recording-results{max-height:300px;overflow:auto}.recording-results p{overflow-wrap:anywhere}@media(max-width:800px){.recording-filters{grid-template-columns:1fr 1fr}.recording-filters input{grid-column:1/-1}.recording-row{gap:10px}.card{padding:16px}}
</style>
