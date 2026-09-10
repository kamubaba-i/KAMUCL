<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import ConnectionPanel from './ConnectionPanel.vue'
import ConnectionStatus from './ConnectionStatus.vue'
import { copyText } from '../../api'
import { toast } from '../../store'

type FrpStatus = 'idle' | 'starting' | 'running' | 'auth_failed' | 'tunnel_offline' | 'error' | 'stopped'
interface FrpState {
  status: FrpStatus
  config: { accessKey: string; tunnelId: string; localPort: number } | null
  remoteAddress: string | null
  pid: number | null
  startedAt: string | null
  message: string
  logs: Array<{ ts: string; stream: 'stdout' | 'stderr' | 'system'; text: string }>
}
interface FrpEvent {
  type: 'status' | 'log' | 'ready' | 'error' | 'stopped'
  status?: FrpStatus
  remoteAddress?: string | null
  data?: { ts: string; stream: 'stdout' | 'stderr' | 'system'; text: string } | string
  message?: string
}
/** 与 src/main/core/frpNodes.ts 的 FrpNodeInfo / FrpTunnelInfo 字段一致 */
interface FrpNodeInfo {
  id: number; name: string; host: string; description: string
  vip: number; free: boolean; online: boolean; load: number | null
  udp: boolean; mainland: boolean; canCreate: boolean; noProtect: boolean; beta: boolean
}
interface FrpTunnelInfo {
  id: number; name: string; type: string; node: number; nodeName: string | null
  online: boolean; status: number; localIp: string; localPort: number; remote: string
}
interface FrpNodesResult { fetchedAt: string; nodes: FrpNodeInfo[]; tunnels: FrpTunnelInfo[] | null }

const kamucl = (window as unknown as {
  kamucl: {
    invoke: (channel: string, ...args: unknown[]) => Promise<unknown>
    on: (channel: string, cb: (...args: unknown[]) => void) => () => void
  }
}).kamucl

const state = ref<FrpState>({
  status: 'idle',
  config: null,
  remoteAddress: null,
  pid: null,
  startedAt: null,
  message: '尚未启动',
  logs: []
})
const busy = ref(false)
const errorMsg = ref('')

const form = reactive({
  accessKey: '',
  tunnelId: '',
  localPort: '' // 留空 → 自动读取 MC 局域网端口
})

const statusLabel: Record<FrpStatus, string> = {
  idle: '尚未启动',
  starting: '正在连接',
  running: '隧道已连接',
  auth_failed: '认证失败',
  tunnel_offline: '隧道离线',
  error: '异常',
  stopped: '已停止'
}
const statusTone = (s: FrpStatus): 'neutral' | 'success' | 'danger' | 'pending' => {
  if (s === 'running' || s === 'starting') return s === 'running' ? 'success' : 'pending'
  if (s === 'auth_failed' || s === 'tunnel_offline' || s === 'error') return 'danger'
  return 'neutral'
}
/** 上次保存的配置（userData/frp-config.json 经 frp:status 回填），驱动「一键开始」 */
const hasSavedConfig = computed(() => !!form.accessKey.trim() && !!form.tunnelId.trim())
const running = computed(() => state.value.status === 'running' || state.value.status === 'starting')

async function refreshStatus(): Promise<void> {
  try {
    const res = (await kamucl.invoke('frp:status')) as FrpState
    state.value = res
    if (res.config && !form.accessKey) {
      form.accessKey = res.config.accessKey
      form.tunnelId = res.config.tunnelId
      form.localPort = res.config.localPort ? String(res.config.localPort) : ''
    }
  } catch (e) {
    // 首次启动可能尚未实现 IPC，吞掉即可
    void e
  }
}

async function onStart(): Promise<void> {
  if (busy.value) return
  errorMsg.value = ''
  busy.value = true
  try {
    const localPort = Number(form.localPort) || 0
    await kamucl.invoke('frp:start', {
      accessKey: form.accessKey.trim(),
      tunnelId: form.tunnelId.trim(),
      localPort
    })
  } catch (e) {
    errorMsg.value = e instanceof Error ? e.message : String(e)
  } finally {
    busy.value = false
    void refreshStatus()
  }
}

async function onStop(): Promise<void> {
  if (busy.value) return
  errorMsg.value = ''
  busy.value = true
  try {
    await kamucl.invoke('frp:stop')
  } catch (e) {
    errorMsg.value = e instanceof Error ? e.message : String(e)
  } finally {
    busy.value = false
    void refreshStatus()
  }
}

const creation = reactive({name: 'Minecraft', node: '', localPort: '', remotePort: ''})
const creating = ref(false)
const selectedTunnel = computed(() => nodesResult.value?.tunnels?.find(t => String(t.id) === form.tunnelId))
const creatableNodes = computed(() => visibleNodes.value.filter(n => n.online && n.canCreate))
watch(() => form.accessKey, () => { nodesResult.value = null; form.tunnelId = '' })
async function copyWebsite() { toast(await copyText('https://www.natfrp.com/') ? '已复制樱花穿透网址' : '复制失败', 'info') }
async function createTunnel() {
  if (creating.value) return
  creating.value = true; errorMsg.value = ''
  try {
    const result = await kamucl.invoke('frp:create-tunnel', {accessKey: form.accessKey.trim(), tunnel: {name: creation.name, node: Number(creation.node), localPort:Number(creation.localPort), remotePort:Number(creation.remotePort) || undefined}}) as {id:number}
    await loadNodes(true); form.tunnelId = String(result.id)
    toast('隧道已创建并选中，可以直接启动', 'success')
  } catch(e) { errorMsg.value = (e as Error).message.replace(/^Error invoking remote method '[^']*': (Error: )?/, '') }
  finally { creating.value = false }
}
async function copyRemote(): Promise<void> {
  if (!state.value.remoteAddress) return
  try {
    await navigator.clipboard.writeText(state.value.remoteAddress)
    toast('已复制远程地址', 'info')
  } catch {
    toast('复制失败', 'info')
  }
}

// ---- 节点参考（api.natfrp.com/v4，主进程缓存 10 分钟；默认折叠，点开才拉取/展开） ----
const nodesResult = ref<FrpNodesResult | null>(null)
const nodesLoading = ref(false)
const nodesError = ref('')
const onlyFree = ref(true)
const visibleNodes = computed<FrpNodeInfo[]>(() => {
  const all = nodesResult.value?.nodes ?? []
  return onlyFree.value ? all.filter((n) => n.free) : all
})

async function loadNodes(refresh = false): Promise<void> {
  if (nodesLoading.value) return
  nodesLoading.value = true
  nodesError.value = ''
  try {
    nodesResult.value = (await kamucl.invoke('frp:nodes', { accessKey: form.accessKey.trim(), refresh })) as FrpNodesResult
    if (!nodesResult.value?.tunnels) throw new Error('隧道列表查询失败，请检查密钥权限后重试')
    if (!nodesResult.value.tunnels.some(t => String(t.id) === form.tunnelId)) form.tunnelId = ''
  } catch (e) {
    nodesError.value = e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']*': (Error: )?/, '') : String(e)
  } finally {
    nodesLoading.value = false
  }
}
function onReferenceToggle(event: Event): void {
  // 首次展开且已保存过访问密钥时自动拉一次节点（失败只展示真实错误，不打扰）
  if ((event.target as HTMLDetailsElement).open && !nodesResult.value && !nodesLoading.value && form.accessKey.trim()) void loadNodes()
}

const logsContainer = ref<HTMLElement | null>(null)
function handleEvent(event: FrpEvent): void {
  if (!event) return
  if (event.type === 'log' && event.data && typeof event.data === 'object') {
    state.value.logs = [...state.value.logs, event.data].slice(-200)
    void nextTickScroll()
    return
  }
  if (event.type === 'status') {
    state.value.status = event.status ?? state.value.status
    if (event.message) state.value.message = event.message
  }
  if (event.type === 'ready') {
    state.value.remoteAddress = event.remoteAddress ?? null
    state.value.status = 'running'
    state.value.message = `已连接，远程地址 ${state.value.remoteAddress}`
  }
  if (event.type === 'error') {
    state.value.status = 'error'
    if (event.message) state.value.message = event.message
  }
  if (event.type === 'stopped') {
    state.value.status = event.status ?? 'stopped'
    state.value.message = event.message ?? state.value.message
  }
}

function nextTickScroll(): void {
  requestAnimationFrame(() => {
    const el = logsContainer.value
    if (el) el.scrollTop = el.scrollHeight
  })
}

let unsubscribe: (() => void) | null = null
onMounted(async () => {
  unsubscribe = kamucl.on('frp:event', (raw) => handleEvent(raw as FrpEvent))
  await refreshStatus()
})
onBeforeUnmount(() => {
  unsubscribe?.()
})
</script>

<template>
  <div class="frp-page">
    <!-- 状态区：隧道状态 + 远程地址（好友直接连接用） -->
    <ConnectionPanel
      title="连接状态"
      subtitle="隧道与远程地址的实时状态，全部来自 frpc 真实事件"
    >
      <template #action>
        <ConnectionStatus :tone="statusTone(state.status)" :label="statusLabel[state.status]" />
      </template>

      <div v-if="running || state.remoteAddress" class="remote-card" :class="{ ok: state.status === 'running' }">
        <p class="remote-label">远程地址（好友直接连接用）</p>
        <p class="remote-line">
          <code class="mono">{{ state.remoteAddress ?? '尚未分配' }}</code>
          <button v-if="state.remoteAddress" class="btn btn-ghost copy-mini" @click="copyRemote">复制地址</button>
        </p>
        <p class="connection-muted">{{ state.message }}</p>
        <ol v-if="state.remoteAddress" class="join-guide">
          <li>保持游戏与「对局域网开放」的世界运行</li>
          <li>好友打开「多人游戏」→「直接连接」</li>
          <li>粘贴上方地址并加入</li>
        </ol>
        <p v-if="!state.remoteAddress && !running" class="connection-muted">
          启动隧道并通过认证后，这里会显示 frpc 分配的远程地址。
        </p>
      </div>
      <p v-else class="connection-muted">{{ errorMsg || '按下方步骤获取访问密钥、选择隧道。连接后这里显示可分享的地址。' }}</p>
      <p v-if="errorMsg" class="connection-error" role="alert">{{ errorMsg }}</p>
    </ConnectionPanel>

    <ConnectionPanel title="1 · 获取访问密钥" subtitle="登录樱花穿透，在用户信息页复制访问密钥，粘贴后读取账号内的隧道。">
      <div class="frp-guide-links"><a class="btn btn-ghost" href="https://www.natfrp.com/" target="_blank" rel="noreferrer">打开樱花穿透 ↗</a><button class="btn btn-ghost" @click="copyWebsite">复制网址</button><a href="https://doc.natfrp.com/" target="_blank" rel="noreferrer">使用帮助 ↗</a></div>
      <p class="connection-muted selectable">https://www.natfrp.com/</p>
      <label class="connection-field"><span>访问密钥</span><input v-model="form.accessKey" class="input" type="password" autocomplete="off" placeholder="粘贴用户信息页的访问密钥" :disabled="running || busy || creating || nodesLoading" /><small>密钥仅保存在本机，并用于连接樱花穿透服务。</small></label>
      <button class="btn btn-gold" :disabled="nodesLoading || !form.accessKey.trim()" @click="loadNodes(true)">{{ nodesLoading ? '正在读取…' : '读取我的隧道与节点' }}</button>
      <p v-if="nodesError" class="connection-error" role="alert">{{ nodesError }}</p>
    </ConnectionPanel>

    <ConnectionPanel title="2 · 选择隧道并启动" subtitle="选择账号中已创建的 TCP 隧道，连接到它配置的本地游戏端口。">
      <label class="connection-field"><span>我的隧道</span><select v-model="form.tunnelId" class="input" :disabled="running || busy || !nodesResult?.tunnels"><option value="">{{ nodesResult?.tunnels?.length ? '请选择隧道' : '请先读取隧道，或在下方创建' }}</option><option v-for="t in nodesResult?.tunnels || []" :key="t.id" :value="String(t.id)" :disabled="t.type !== 'tcp' || t.status !== 0">{{ t.name || '#' + t.id }} · {{ t.nodeName || '节点 ' + t.node }} · {{ t.type.toUpperCase() }} · {{ t.localIp }}:{{ t.localPort }}{{ t.status !== 0 ? '（不可用）' : '' }}</option></select></label>
      <div v-if="selectedTunnel" class="connection-result"><strong>本地游戏：{{ selectedTunnel.localIp }}:{{ selectedTunnel.localPort }}</strong><p class="connection-muted">在 Minecraft 中「对局域网开放」，端口需与此一致。若游戏端口变化，可创建新隧道，或在樱花穿透网站修改后刷新列表。</p></div>
      <div class="connection-actions main-actions"><button v-if="!running" class="btn btn-gold main-btn" :disabled="busy || !selectedTunnel" @click="onStart">{{ busy ? '正在连接…' : '启动选中隧道' }}</button><button v-else class="btn btn-ghost main-btn" :disabled="busy" @click="onStop">停止隧道</button><button class="btn btn-ghost" :disabled="busy" @click="refreshStatus">刷新状态</button></div>
    </ConnectionPanel>

    <ConnectionPanel title="创建新隧道" subtitle="选择服务节点，再填入游戏局域网端口。创建成功后自动选中，不会自动运行。">
      <div class="frp-create-grid"><label class="connection-field"><span>隧道名称</span><input v-model="creation.name" class="input" maxlength="64" placeholder="例如：好友生存世界" /></label><label class="connection-field"><span>服务节点</span><select v-model="creation.node" class="input"><option value="">{{ nodesResult ? '选择可用节点' : '请先读取节点' }}</option><option v-for="n in creatableNodes" :key="n.id" :value="String(n.id)">{{ n.name }} · {{ n.free ? '免费' : '专业版' }}{{ n.load !== null ? ' · ' + n.load + '%' : '' }}</option></select></label><label class="connection-field"><span>本地端口</span><input v-model="creation.localPort" class="input" type="number" min="1" max="65535" placeholder="游戏对局域网开放后显示的端口" /></label><label class="connection-field"><span>远程端口（可选）</span><input v-model="creation.remotePort" class="input" type="number" min="1" max="65535" placeholder="留空由樱花穿透分配" /></label></div>
      <label class="frp-free"><input v-model="onlyFree" type="checkbox" />仅显示免费节点</label>
      <button class="btn btn-gold" :disabled="creating || !form.accessKey.trim() || !creation.node || !creation.localPort" @click="createTunnel">{{ creating ? '正在创建…' : '创建 TCP 隧道' }}</button>
    </ConnectionPanel>

    <!-- 参考信息区：节点参考（默认折叠，点开才展开/查询） -->
    <section class="connection-panel">
      <header class="connection-panel-head">
        <div>
          <h2>节点参考</h2>
          <p>查看各节点的状态与说明，在上方选择可用节点创建隧道。专业版节点需要对应账号权限。</p>
        </div>
      </header>
      <div class="connection-panel-body">
        <details class="reference-details" @toggle="onReferenceToggle">
          <summary>展开节点列表{{ nodesResult ? `（共 ${nodesResult.nodes.length} 个节点）` : '（默认收起）' }}</summary>
          <div class="reference-body">
            <div class="node-toolbar">
              <label class="connection-toggle node-toggle"><span>只看免费节点<small>专业版（VIP）节点需要 natfrp 专业版账号</small></span><input v-model="onlyFree" type="checkbox" /><span class="connection-toggle-track" aria-hidden="true"></span></label>
              <button class="btn btn-ghost" :disabled="nodesLoading || !form.accessKey.trim()" @click="loadNodes(true)">{{ nodesLoading ? '查询中…' : nodesResult ? '刷新节点' : '查询节点' }}</button>
            </div>

            <p v-if="nodesError" class="connection-error" role="alert">{{ nodesError }}</p>

            <!-- 我的隧道：节点列表上方的单独小卡 -->
            <div v-if="nodesResult?.tunnels?.length" class="connection-result tunnels-card">
              <h3>我的隧道（natfrp 账号内）</h3>
              <p v-for="t in nodesResult.tunnels" :key="t.id" class="tunnel-line">
                <ConnectionStatus :tone="t.online ? 'success' : 'neutral'" :label="t.online ? '在线' : '离线'" />
                <span><strong>#{{ t.id }} {{ t.name }}</strong><span class="connection-muted"> · {{ t.type.toUpperCase() }} · 节点 {{ t.nodeName ?? t.node }}</span></span>
              </p>
            </div>

            <p v-if="!nodesResult && !nodesLoading && !nodesError" class="connection-muted">填写访问密钥后点击「查询节点」查看节点列表。</p>
            <p v-else-if="nodesResult && !visibleNodes.length" class="connection-muted">没有符合筛选条件的节点。</p>

            <ul v-else-if="nodesResult" class="node-list" aria-label="节点列表">
              <li v-for="n in visibleNodes" :key="n.id" class="node-item">
                <span class="node-online" :class="{ on: n.online }" role="img" :aria-label="n.online ? '在线' : '离线'"></span>
                <span class="node-main">
                  <span class="node-title">
                    <strong>{{ n.name }}</strong>
                    <em class="node-badge" :class="n.free ? 'free' : 'vip'">{{ n.free ? '免费' : '专业版' }}</em>
                    <em v-if="n.mainland" class="node-badge">内地</em>
                    <em v-if="n.udp" class="node-badge">UDP</em>
                    <em v-if="!n.canCreate" class="node-badge warn">满载</em>
                    <em v-if="n.beta" class="node-badge">BETA</em>
                  </span>
                  <small v-if="n.description" class="connection-muted node-desc">{{ n.description }}</small>
                  <small class="mono node-host">{{ n.host }}</small>
                </span>
                <span class="node-load"><small class="connection-muted">负载</small><strong>{{ n.load === null ? '—' : n.load + '%' }}</strong></span>
              </li>
            </ul>
          </div>
        </details>
      </div>
    </section>

    <!-- 日志区：窄、默认收起 -->
    <details class="connection-details log-details">
      <summary>frpc 运行日志（{{ state.logs.length }} 条）</summary>
      <div ref="logsContainer" class="connection-log-viewport">
        <p v-if="!state.logs.length" class="connection-muted">尚无日志。</p>
        <p v-for="(entry, i) in state.logs" :key="i" class="mono connection-log-line">
          <span class="connection-muted">[{{ entry.stream }}]</span> {{ entry.text }}
        </p>
      </div>
    </details>
  </div>
</template>
<style scoped>
.frp-guide-links{display:flex;gap:12px;align-items:center;flex-wrap:wrap}.selectable{user-select:text}.frp-create-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}.frp-free{display:flex;gap:8px;align-items:center;font-size:13px;margin:16px 0}@media(max-width:750px){.frp-create-grid{grid-template-columns:1fr}}
.frp-page { display: flex; flex-direction: column; gap: var(--sec-gap); min-width: 0; }
.remote-card {
  display: flex; flex-direction: column; gap: var(--space-3);
  padding: var(--card-pad); min-height: var(--row-h);
  border: 1px solid var(--border); border-radius: var(--radius-md); background: var(--card-2);
}
.remote-card.ok { border-color: color-mix(in srgb, var(--ok) 40%, var(--border)); }
.remote-label { font-size: var(--text-xs); font-weight: 600; color: var(--text-dim); }
.remote-line { display: flex; align-items: center; flex-wrap: wrap; gap: var(--space-2); min-height: var(--row-h); }
.remote-line code { font-weight: 700; font-size: var(--text-lg); overflow-wrap: anywhere; }
.copy-mini { padding: var(--space-1) var(--space-3); font-size: var(--text-xs); min-height: 28px; }
.join-guide { margin: 0; padding-left: var(--space-5); display: flex; flex-direction: column; gap: var(--space-1); font-size: var(--text-xs); color: var(--text-dim); line-height: 1.8; }
.main-actions { padding-top: var(--space-1); }
.main-btn { min-height: calc(var(--ctl-h) + var(--space-2)); font-size: var(--text-md); font-weight: 700; padding: var(--space-2) var(--space-6); flex: 1 1 auto; }

/* 参考信息区：默认折叠，展开后宽松排布 */
.reference-details { border: 0; background: transparent; padding: 0; }
.reference-details > summary { min-height: var(--ctl-h); font-size: var(--text-xs); }
.reference-body { display: flex; flex-direction: column; gap: var(--space-4); margin-top: var(--space-4); }
.node-toolbar { display: flex; align-items: center; justify-content: space-between; gap: var(--space-3); flex-wrap: wrap; }
.node-toggle { flex: 1; min-width: 220px; }
.tunnels-card { gap: var(--space-2); }
.tunnel-line { display: flex; align-items: center; gap: var(--space-3); min-height: var(--row-h); flex-wrap: wrap; }
.node-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--space-3); }
/* 节点行：自适应高度 + 内边距，行与行之间留出空隙，绝不互相重叠贴死 */
.node-item {
  display: flex; align-items: flex-start; gap: var(--space-3);
  min-height: var(--row-h); padding: var(--space-3) var(--space-4);
  border: 1px solid var(--border-strong); border-radius: var(--radius-md); background: var(--card-2);
}
.node-online { width: 9px; height: 9px; border-radius: 50%; flex: none; margin-top: var(--space-2); background: var(--text-dim); }
.node-online.on { background: var(--ok); box-shadow: 0 0 0 3px color-mix(in srgb, var(--ok) 22%, transparent); }
.node-main { display: flex; flex-direction: column; gap: var(--space-1); min-width: 0; flex: 1; }
.node-title { display: flex; align-items: center; flex-wrap: wrap; gap: var(--space-2); min-width: 0; }
.node-title strong { font-size: var(--text-sm); overflow-wrap: anywhere; }
.node-badge { display: inline-flex; align-items: center; font-style: normal; font-size: var(--text-xs); line-height: 1; padding: 3px var(--space-2); border-radius: 999px; border: 1px solid var(--border-strong); color: var(--text-dim); white-space: nowrap; }
.node-badge.free { color: var(--ok); border-color: color-mix(in srgb, var(--ok) 45%, transparent); }
.node-badge.vip { color: var(--accent-2); border-color: color-mix(in srgb, var(--accent-2) 45%, transparent); }
.node-badge.warn { color: var(--danger); border-color: color-mix(in srgb, var(--danger) 45%, transparent); }
.node-desc { line-height: 1.7; }
.node-host { color: var(--text-dim); overflow-wrap: anywhere; }
.node-load { display: flex; flex-direction: column; align-items: center; gap: var(--space-1); flex: none; min-width: 52px; }

</style>
