<script setup lang="ts">
/**
 * 通用文件管理视图：模组 / 资源包 / 光影包共用。
 * 通过 IPC fs:list / fs:remove / app:openDir 管理游戏目录下的子目录。
 */
import { computed, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import { getModIcons, importResources, applyModUpdates, checkModUpdates, copyText, errText, listFs, openDir, removeFs, toggleDisableFs } from '../api'
import { activeInstalled, selectedInstance, refreshInstalled, store, toast } from '../store'
import ModMigrationModal from './ModMigrationModal.vue'
import ConfirmModal from './ConfirmModal.vue'
import DupCleanModal from './DupCleanModal.vue'
import SelectMenu from './SelectMenu.vue'
import type { FsEntry, ModUpdateReport } from '@shared/types'

const props = defineProps<{
  /** 页面标题，如「模组」 */
  title: string
  /** 相对游戏目录的子目录：mods / resourcepacks / shaderpacks */
  rel: string
  /** 打开目录按钮文字 */
  openLabel: string
  /** 空状态文案 */
  emptyText: string
  /** 标题旁与空状态的内联 SVG 图标 */
  icon: string
}>()

const page = ref(1)
const PAGE_SIZE = 100
const entries = ref<FsEntry[]>([])
const loading = ref(true)
const loadError = ref('')
const opening = ref(false)

// ---------------- 版本上下文（模组/资源包/光影包按游戏版本管理） ----------------
/** 当前选中版本（默认第一个已装版本；store.resourceVersionId 三页共享） */
const activeFolder = computed(() => store.settings?.activeFolder || store.settings?.gameDir || '')
const availableVersions = activeInstalled
const currentVersion = computed(() => {
  const list = availableVersions.value
  if (!list.length) return null
  return list.find((v) => v.id === store.resourceVersionId) ?? list[0]
})

/** 实际管理的相对目录：隔离版本 → versions/<id>/<rel>；共享版本 → <rel> */
const effectiveRel = computed(() => {
  const v = currentVersion.value
  return v ? `versions/${v.id}/${props.rel}` : ''
})

/** 目录不存在时视为空列表（隔离版本刚开启、尚未产生该子目录） */
let loadGeneration = 0
async function load() {
  const generation = ++loadGeneration
  const v = currentVersion.value
  entries.value = []; loadError.value = ''; page.value = 1
  if (!v) { loading.value = false; return }
  loading.value = true
  try {
    const result = await listFs(effectiveRel.value, v.folder || activeFolder.value)
    if (generation === loadGeneration) entries.value = result
  } catch (e) { if (generation === loadGeneration) loadError.value = errText(e) }
  finally { if (generation === loadGeneration) loading.value = false }
}

const importing = ref(false)
async function dropResources(event: DragEvent) {
  const v = currentVersion.value
  if (!v) { toast('请先选择当前文件夹中的游戏版本', 'error'); return }
  if (importing.value) return
  const folder = v.folder || activeFolder.value, kind = props.rel
  const files = Array.from(event.dataTransfer?.files ?? []).map(f => window.kamucl.getFilePath(f)).filter(Boolean)
  importing.value = true
  try {
    const count = await importResources(files, v.id, folder, kind)
    toast('已导入 ' + count + ' 项到 ' + v.id + ' / ' + kind, 'success')
    await load()
  } catch (e) { toast('导入失败：' + errText(e), 'error') }
  finally { importing.value = false }
}
onUnmounted(() => { if (store.resourceDropHandler === dropResources) store.resourceDropHandler = null })
onMounted(async () => {
  store.resourceDropHandler = dropResources
  if (!store.installed.length) await refreshInstalled()
  if (!store.resourceVersionId && store.installed.length) {
    store.resourceVersionId = store.installed[0].id
  }
  void load()
})

watch([effectiveRel, activeFolder], () => { dupOpen.value = false; delModal.open = false; updatePanel.open = false; migrationOpen.value=false; void load() })
onUnmounted(() => { loadGeneration++ })
watch(() => store.fsRefreshTick, () => void load())

// ---------------- 路径显示（超长中间省略 + 点击复制） ----------------
/** 清理重复 MOD 弹窗 */
const dupOpen = ref(false)
const migrationOpen=ref(false)
const updateIcons=ref<Record<string,string>>({})

/** 中间省略的路径：versions/neo…2.0.75/mods */
const displayPath = computed(() => {
  const p = currentVersion.value?.gameDirectory ? currentVersion.value.gameDirectory + '/' + props.rel : effectiveRel.value
  const MAX = 34
  if (p.length <= MAX) return p
  const head = p.slice(0, 16)
  const tail = p.slice(-14)
  return `${head}…${tail}`
})

async function copyPath() {
  const ok = await copyText(currentVersion.value?.gameDirectory ? currentVersion.value.gameDirectory + '/' + props.rel : effectiveRel.value)
  toast(ok ? '已复制完整路径' : '复制失败', ok ? 'success' : 'error')
}

// ---------------- 顶栏搜索联动（过滤文件名） ----------------
const keyword = computed(() => store.searchKeyword.trim().toLowerCase())
const filtered = computed(() =>
  keyword.value
    ? entries.value.filter((e) => e.name.toLowerCase().includes(keyword.value))
    : entries.value
)

const pageCount = computed(() => Math.max(1, Math.ceil(filtered.value.length / PAGE_SIZE)))
const visibleEntries = computed(() => filtered.value.slice((page.value - 1) * PAGE_SIZE, page.value * PAGE_SIZE))
const modIcons = ref<Record<string, string>>({})
let iconGeneration = 0
let iconTimer: ReturnType<typeof setTimeout> | undefined
watch([visibleEntries, effectiveRel, activeFolder], () => {
  const generation = ++iconGeneration
  clearTimeout(iconTimer); modIcons.value = {}
  const version = currentVersion.value
  if (!version) return
  const names = visibleEntries.value.filter(e => !e.isDir && /\.(?:jar(?:\.disabled)?|zip)$/i.test(e.name)).map(e => e.name)
  if (!names.length) return
  const folder = version.folder || activeFolder.value
  iconTimer = setTimeout(() => {
    void getModIcons(version.id, names, folder, props.rel).then(icons => {
      if (generation === iconGeneration) modIcons.value = icons
    }).catch(() => {})
  }, 120)
})
onUnmounted(() => { iconGeneration++; clearTimeout(iconTimer) })
watch([keyword, pageCount], () => { page.value = Math.min(page.value, pageCount.value) })

async function onOpenDir() {
  if (!currentVersion.value) return
  opening.value = true
  try {
    await openDir(effectiveRel.value, currentVersion.value?.folder || activeFolder.value)
  } catch (e) {
    toast('打开文件夹失败：' + errText(e), 'error')
  } finally {
    opening.value = false
  }
}

const delModal = reactive({ open: false, target: null as FsEntry | null, busy: false })

function onRemove(entry: FsEntry) {
  delModal.open = true
  delModal.target = entry
}

// ---------------- 模组禁用/启用（仅模组页；.jar ↔ .jar.disabled，运行中由主进程阻止） ----------------
const isModEntry = (e: FsEntry) =>
  props.rel === 'mods' && !e.isDir && /\.jar(\.disabled)?$/i.test(e.name)
const isDisabledMod = (e: FsEntry) => /\.jar\.disabled$/i.test(e.name)
const toggling = ref('')

async function onToggleDisable(entry: FsEntry, event?: Event) {
  if(event?.target)(event.target as HTMLInputElement).checked = !isDisabledMod(entry)
  if (!currentVersion.value) return
  if (toggling.value) return
  toggling.value = entry.name
  const generation=loadGeneration
  try {
    const result = await toggleDisableFs(effectiveRel.value, entry.name, currentVersion.value?.folder || activeFolder.value)
    if(generation!==loadGeneration)return
    entries.value=result
    toast(isDisabledMod(entry) ? `已启用 ${entry.name.replace(/\.disabled$/i, '')}` : `已禁用 ${entry.name}`, 'success')
  } catch (e) {
    toast(errText(e), 'error')
  } finally {
    toggling.value = ''
  }
}

async function onConfirmRemove() {
  if (!currentVersion.value) return
  const entry = delModal.target
  if (!entry || delModal.busy) return
  delModal.busy = true
  const generation=loadGeneration
  try {
    const result = await removeFs(effectiveRel.value, entry.name, currentVersion.value?.folder || activeFolder.value)
    if(generation!==loadGeneration)return
    entries.value=result
    delModal.open = false
    toast(`已删除 ${entry.name}`, 'success')
  } catch (e) {
    toast('删除失败：' + errText(e), 'error')
  } finally {
    delModal.busy = false
  }
}

function fmtSize(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`
}

const fmtDate = (ts: number) => {
  const d = new Date(ts)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('zh-CN')
}

// ---------------- MOD 更新检测（仅模组页；按 sha1 反查 Modrinth，内联面板不跳页） ----------------
const updatePanel = reactive({
  open: false,
  checking: false,
  error: '',
  report: null as ModUpdateReport | null,
  selected: new Set<string>(),
  applying: false,
  itemState: {} as Record<string, 'start' | 'ok' | 'error' | undefined>,
  itemError: {} as Record<string, string>
})

const updatableEntries = computed(() => updatePanel.report?.entries.filter((e) => e.update) ?? [])
const unmatchedCount = computed(() => updatePanel.report?.entries.filter((e) => !e.source).length ?? 0)
const latestCount = computed(() => updatePanel.report?.entries.filter((e) => e.alreadyLatest || (e.source && !e.update)).length ?? 0)

async function onCheckUpdates() {
  const v = currentVersion.value
  if (!v || updatePanel.checking) return
  updatePanel.checking = true
  updatePanel.error = ''
  updatePanel.report = null
  updatePanel.open = true
  updatePanel.itemState = {}
  updatePanel.itemError = {}
  const generation=loadGeneration
  try {
    const report = await checkModUpdates(v.id, v.folder)
    if(generation!==loadGeneration)return
    updatePanel.report = report
    updateIcons.value={}
    const names=report.entries.filter(e=>e.update).map(e=>e.fileName)
    for(let i=0;i<names.length;i+=100)void getModIcons(v.id,names.slice(i,i+100),v.folder||activeFolder.value).then(icons=>{if(generation===loadGeneration)updateIcons.value={...updateIcons.value,...icons}}).catch(()=>{})
    updatePanel.selected = new Set(report.entries.filter((e) => e.update).map((e) => e.fileName))
    if (!report.entries.length) toast('该实例 mods 目录为空', 'info')
  } catch (e) {
    if(generation===loadGeneration)updatePanel.error = errText(e)
  } finally {
    updatePanel.checking = false
  }
}

async function applyUpdates(fileNames: string[]) {
  const v = currentVersion.value
  const report = updatePanel.report
  if (!v || !report || updatePanel.applying) return
  const targets = report.entries
    .filter((e) => e.update && fileNames.includes(e.fileName))
    .map((e) => ({ fileName: e.fileName, url: e.update!.url, targetName: e.update!.fileName, sha1: e.update!.sha1, size: e.update!.size }))
  if (!targets.length) return
  updatePanel.applying = true
  try {
    const results = await applyModUpdates(v.id, targets, v.folder)
    let okCount = 0
    for (const r of results) {
      updatePanel.itemState[r.fileName] = r.ok ? 'ok' : 'error'
      if (r.ok) okCount++
      else updatePanel.itemError[r.fileName] = r.error ?? '未知错误'
    }
    if (okCount) {
      toast(`已更新 ${okCount} 个 MOD`, 'success')
      updatePanel.report = {
        ...report,
        entries: report.entries.filter((e) => updatePanel.itemState[e.fileName] !== 'ok')
      }
      updatePanel.selected = new Set([...updatePanel.selected].filter((f) => updatePanel.itemState[f] !== 'ok'))
      void load()
    }
    const failed = results.filter((r) => !r.ok)
    if (failed.length) toast(`${failed.length} 个更新失败：${failed[0].error ?? ''}`, 'error')
    if (updatePanel.report.entries.length === 0) updatePanel.open = false
  } catch (e) {
    toast('更新失败：' + errText(e), 'error')
  } finally {
    updatePanel.applying = false
  }
}

function toggleUpdateSelect(fileName: string, checked: boolean) {
  const next = new Set(updatePanel.selected)
  if (checked) next.add(fileName)
  else next.delete(fileName)
  updatePanel.selected = next
}
</script>

<template>
  <div class="page">
    <!-- 标题行 -->
    <div class="fm-head">
      <div class="page-head fm-head-left">
        <h1 class="page-title">{{ props.title }}</h1>
        <p
          class="page-sub fm-path"
          :title="`管理游戏目录 / ${effectiveRel} 下的文件（点击复制完整路径）`"
          @click="copyPath"
        >
          管理游戏目录 / {{ displayPath }} 下的文件
        </p>
      </div>
      <div class="fm-actions">
        <SelectMenu
          v-if="availableVersions.length"
          v-model="store.resourceVersionId"
          class="fm-ver-select"
          :options="availableVersions.map(v => ({ value: v.id, label: v.id + (v.isolated ? '（已隔离）' : '（共享）') }))"
          @change="() => {}"
        />
        <button class="btn btn-ghost" :disabled="loading || !currentVersion" @click="load">
          <span v-if="loading" class="spin"></span>
          <svg v-else viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 12a9 9 0 1 1-2.64-6.36" />
            <path d="M21 3v6h-6" />
          </svg>
          刷新
        </button>
        <button v-if="props.rel === 'mods'" class="btn btn-ghost" :disabled="updatePanel.checking || !currentVersion" title="按文件哈希在 Modrinth 反查可更新版本" @click="onCheckUpdates">
          <span v-if="updatePanel.checking" class="spin"></span>
          <svg v-else viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 3v12m0 0 4-4m-4 4-4-4" />
            <path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
          </svg>
          检测更新
        </button>
        <button v-if="props.rel === 'mods'" class="btn btn-ghost" :disabled="!currentVersion" @click="migrationOpen=true">版本迁移</button>
        <button v-if="props.rel === 'mods'" class="btn btn-ghost" :disabled="!currentVersion" @click="dupOpen = true">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M3 6h18M8 6V4h8v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6Z" />
          </svg>
          清理重复
        </button>
        <button class="btn btn-gold" :disabled="opening || !currentVersion" @click="onOpenDir">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />
          </svg>
          {{ props.openLabel }}
        </button>
      </div>
    </div>

    <!-- 未安装任何版本时提示 -->
    <div v-if="!currentVersion" class="card empty">
      <span>当前游戏文件夹没有可选版本，请先到「游戏版本」页安装或选择版本</span>
    </div>

    <!-- MOD 更新检测面板（内联，不跳页） -->
    <div v-if="props.rel === 'mods' && updatePanel.open" class="card upd-panel">
      <div class="upd-head">
        <strong>MOD 更新检测</strong>
        <span v-if="updatePanel.report" class="muted">
          共 {{ updatePanel.report.entries.length }} 个 · 可更新 {{ updatableEntries.length }} · 已最新 {{ latestCount }}<template v-if="unmatchedCount"> · {{ unmatchedCount }} 个未匹配来源</template>
        </span>
        <span class="upd-head-spacer"></span>
        <button class="btn btn-ghost btn-sm" :disabled="updatePanel.applying" @click="updatePanel.open = false">收起</button>
      </div>
      <div v-if="updatePanel.checking" class="empty upd-empty">
        <span class="spin"></span>
        <span>正在计算文件哈希并查询 Modrinth…</span>
      </div>
      <div v-else-if="updatePanel.error" class="empty upd-empty">
        <span>检测失败：{{ updatePanel.error }}</span>
        <button class="btn btn-ghost btn-sm" @click="onCheckUpdates">重试</button>
      </div>
      <template v-else-if="updatePanel.report">
        <div v-if="updatableEntries.length" class="upd-list">
          <div v-for="e in updatableEntries" :key="e.fileName" class="upd-row" :class="{ 'is-ok': updatePanel.itemState[e.fileName] === 'ok' }">
            <input
              type="checkbox"
              class="upd-check"
              :checked="updatePanel.selected.has(e.fileName)"
              :disabled="updatePanel.applying"
              @change="toggleUpdateSelect(e.fileName, ($event.target as HTMLInputElement).checked)"
            />
            <span class="fm-file-icon"><img v-if="updateIcons[e.fileName] || modIcons[e.fileName]" :src="updateIcons[e.fileName] || modIcons[e.fileName]" alt=""/><span v-else>◇</span></span><span class="upd-name" :title="e.fileName"><strong>{{ e.fileName }}</strong><small class="muted">{{ e.name }}</small></span>
            <span class="muted upd-ver">{{ e.currentVersion || '未知' }} → <b>{{ e.update!.versionNumber }}</b></span>
            <span v-if="updatePanel.itemState[e.fileName] === 'start'" class="spin upd-spin"></span>
            <span v-else-if="updatePanel.itemState[e.fileName] === 'error'" class="upd-err" :title="updatePanel.itemError[e.fileName]">失败</span>
            <button class="btn btn-ghost btn-sm" :disabled="updatePanel.applying" @click="applyUpdates([e.fileName])">更新</button>
          </div>
        </div>
        <div v-else class="empty upd-empty"><span>所有已匹配来源的 MOD 均为最新</span></div>
        <div v-if="updatableEntries.length" class="upd-foot">
          <button class="btn btn-gold btn-sm" :disabled="updatePanel.applying || !updatePanel.selected.size" @click="applyUpdates([...updatePanel.selected])">
            {{ updatePanel.applying ? '正在更新…' : `一键更新选中（${updatePanel.selected.size}）` }}
          </button>
          <span class="muted">更新会先校验新文件哈希，失败时保留旧文件</span>
        </div>
      </template>
    </div>

    <!-- 文件列表 -->
    <div v-if="currentVersion" class="card fm-card">
      <div v-if="loading" class="empty">
        <span class="spin"></span>
        <span>正在读取文件列表…</span>
      </div>
      <div v-else-if="loadError" class="empty">
        <span>读取失败：{{ loadError }}</span>
        <button class="btn btn-ghost btn-sm" @click="load">重试</button>
      </div>
      <div v-else-if="!entries.length" class="empty">
        <span class="empty-icon" v-html="props.icon"></span>
        <span>{{ props.emptyText }}</span>
        <button class="btn btn-ghost btn-sm" @click="onOpenDir">打开文件夹</button>
      </div>
      <div v-else-if="keyword && !filtered.length" class="empty">
        <span>没有匹配「{{ store.searchKeyword }}」的文件</span>
      </div>
      <div v-else class="fm-list">
        <div v-for="e in visibleEntries" :key="e.name" class="fm-row" :class="{ 'fm-row-disabled': isDisabledMod(e) }">
          <span class="fm-file-icon">
            <img v-if="modIcons[e.name]" :src="modIcons[e.name]" alt="" @error="delete modIcons[e.name]" />
            <svg v-else-if="e.isDir" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />
            </svg>
            <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" />
              <path d="M14 2v6h6" />
            </svg>
          </span>
          <span class="fm-name" :title="e.name">{{ e.name }}</span>
          <span v-if="isDisabledMod(e)" class="tag fm-disabled-tag">已禁用</span>
          <span class="muted fm-meta">{{ e.isDir ? '文件夹' : fmtSize(e.size) }}</span>
          <span class="muted fm-meta fm-date">{{ fmtDate(e.mtime) }}</span>
          <label v-if="isModEntry(e)" class="switch fm-toggle" :title="isDisabledMod(e)?'启用模组':'禁用模组'"><input type="checkbox" role="switch" :aria-label="(isDisabledMod(e)?'启用 ':'禁用 ')+e.name" :checked="!isDisabledMod(e)" :disabled="!!toggling" @change="onToggleDisable(e, $event)"/><span class="switch-ui"></span></label>
          <button class="btn btn-danger btn-sm fm-remove" @click="onRemove(e)">删除</button>
        </div>
      </div>
    </div>

    <nav v-if="currentVersion && filtered.length" class="fm-pagination" aria-label="资源列表分页">
      <span class="muted">共 {{ filtered.length }} 项 · 每页 {{ PAGE_SIZE }} 项</span>
      <button class="btn btn-ghost btn-sm" :disabled="page <= 1" @click="page--">上一页</button>
      <span>{{ page }} / {{ pageCount }}</span>
      <button class="btn btn-ghost btn-sm" :disabled="page >= pageCount" @click="page++">下一页</button>
    </nav>
    <ModMigrationModal v-if="migrationOpen && currentVersion" :source="currentVersion" @close="migrationOpen=false"/>
    <!-- 删除文件二次确认 -->
    <ConfirmModal
      :open="delModal.open"
      title="删除文件"
      :message="`确定要删除「${delModal.target?.name}」吗？此操作不可恢复。`"
      :busy="delModal.busy"
      @cancel="delModal.open = false"
      @confirm="onConfirmRemove"
    />

    <!-- 清理重复 MOD（仅模组页） -->
    <DupCleanModal
      v-if="props.rel === 'mods' && dupOpen && currentVersion"
      :open="dupOpen"
      :version-id="currentVersion?.id ?? ''"
      :rel="effectiveRel"
      :folder="currentVersion?.folder || activeFolder"
      @close="dupOpen = false"
      @deleted="load"
    />
  </div>
</template>

<style scoped>
.upd-name {display:flex;flex-direction:column;min-width:0;gap:3px}.upd-name strong{font-weight:600;overflow:hidden;text-overflow:ellipsis}.upd-name small{font-size:12px}.fm-toggle{flex-shrink:0}

.fm-pagination { display:flex; align-items:center; justify-content:flex-end; gap:12px; flex-wrap:wrap; padding:8px 0; font-size:13px }
.fm-pagination .muted { margin-right:auto }
.page {
  display: flex;
  flex-direction: column;
  gap: var(--sec-gap);
  max-width: 940px;
  margin: 0 auto;
}

.fm-head {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: var(--space-4);
  flex-wrap: nowrap; /* 头部永不换行，按钮组位置固定 */
}
.fm-head-left {
  flex: 1;
  min-width: 0; /* 允许文本收缩，把空间让给按钮组 */
}
.fm-path {
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  cursor: pointer;
  transition: color 0.15s ease;
}
.fm-path:hover {
  color: var(--accent-2);
}
.fm-actions {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  flex-shrink: 0; /* 按钮组固定尺寸，永不因文本长度移位 */
}
.fm-ver-select {
  max-width: 240px;
  min-width: 180px;
}

.fm-card {
  padding: var(--space-2);
}
.fm-list {
  display: flex;
  flex-direction: column;
}
.fm-row {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  min-height: var(--row-h);
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius-md);
  transition: background 0.15s ease;
}
.fm-row:hover {
  background: var(--card-2);
}
.fm-file-icon {
  display: flex;
  width: 32px;
  height: 32px;
  color: var(--accent);
  flex-shrink: 0;
}
.fm-file-icon svg {
  width: 100%;
  height: 100%;
}
.fm-file-icon img { width: 100%; height: 100%; object-fit: contain; border-radius: 6px; }
.fm-name {
  flex: 1;
  min-width: 0;
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  user-select: text;
}
.fm-meta {
  font-size: var(--text-xs);
  flex-shrink: 0;
  font-variant-numeric: tabular-nums;
}
.fm-date {
  width: 86px;
  text-align: right;
}
.fm-remove {
  flex-shrink: 0;
  background: transparent;
  border-color: transparent;
}
.fm-remove:hover { border-color: var(--danger-border); }
.fm-toggle {
  flex-shrink: 0;
}
.fm-row-disabled {
  opacity: 0.55;
}
.fm-row-disabled .fm-name {
  text-decoration: line-through;
  text-decoration-color: var(--text-3);
}
.fm-disabled-tag {
  flex-shrink: 0;
  font-size: var(--text-xs);
  padding: 1px 8px;
  border-radius: 999px;
  background: var(--card-2);
  color: var(--text-3);
  border: 1px solid var(--line);
}
.empty-icon {
  display: flex;
  width: 44px;
  height: 44px;
  color: var(--accent);
  opacity: 0.8;
}
.empty-icon :deep(svg) {
  width: 100%;
  height: 100%;
}

/* MOD 更新检测面板 */
.upd-panel {
  padding: var(--card-pad);
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}
.upd-head {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  font-size: var(--text-sm);
}
.upd-head-spacer {
  flex: 1;
}
.upd-empty {
  padding: var(--space-4) 0;
}
.upd-list {
  display: flex;
  flex-direction: column;
  max-height: 300px;
  overflow-y: auto;
}
.upd-row {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  min-height: var(--row-h);
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius-md);
}
.upd-row:hover {
  background: var(--card-2);
}
.upd-row.is-ok {
  opacity: 0.55;
}
.upd-check {
  accent-color: var(--accent);
  flex-shrink: 0;
}
.upd-name {
  flex: 1;
  min-width: 0;
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.upd-ver {
  font-size: var(--text-xs);
  flex-shrink: 0;
  white-space: nowrap;
}
.upd-ver b {
  color: var(--accent-2);
}
.upd-spin {
  width: 14px;
  height: 14px;
}
.upd-err {
  color: var(--danger);
  font-size: var(--text-xs);
  flex-shrink: 0;
}
.upd-foot {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  flex-wrap: wrap;
}
.upd-foot .muted {
  font-size: var(--text-xs);
}

@media (max-width: 1180px) {
  .fm-head { flex-wrap: wrap; align-items: flex-start; }
  .fm-head-left { flex-basis: 100%; }
  .fm-actions { width: 100%; flex-wrap: wrap; flex-shrink: 1; gap: 8px; }
  .fm-ver-select { flex: 1; max-width: none; min-width: 180px; }
}
</style>
