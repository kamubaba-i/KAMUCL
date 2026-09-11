<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import ConnectionPanel from './ConnectionPanel.vue'
import ConfirmModal from '../ConfirmModal.vue'
import ConnectionStatus from './ConnectionStatus.vue'
import { copyText } from '../../api'
import { toast } from '../../store'
import type { ManagedTunnel } from '../../../../main/core/frpManager'
import type { FrpNodesResult } from '../../../../main/core/frpNodes'

const kamucl = window.kamucl
const tunnels = ref<ManagedTunnel[]>([])
const form = reactive({ accessKey: '' })
const operations = reactive(new Set<string>())
const stopping = reactive(new Set<string>())
const errorMsg = ref('')
const deleteTarget = ref<ManagedTunnel | null>(null)
const deleting = ref(false)
const deleteError = ref('')
function askDelete(t: ManagedTunnel) { if (t.deleting) return; deleteError.value = ''; deleteTarget.value = t }
function cancelDelete() { if (!deleting.value) deleteTarget.value = null }
async function confirmDelete() {
  const target = deleteTarget.value
  if (!target || deleting.value) return
  deleting.value = true; deleteError.value = ''
  try {
    const result = await kamucl.invoke('frp:delete-tunnel', { id: target.id, confirmed: true }) as { remoteDisconnectPending: boolean }
    tunnels.value = tunnels.value.filter(t => t.id !== target.id)
    nodesResult.value = null; deleteTarget.value = null
    toast(result.remoteDisconnectPending ? '远端隧道已删除，本地连接已停止；其他设备连接可能尚未断开' : `已从樱花穿透删除「${target.name}」`, result.remoteDisconnectPending ? 'info' : 'success')
  } catch(e) { deleteError.value = errText(e); toast(deleteError.value, 'error') }
  finally { deleting.value = false; await refreshStatus() }
}
const nodesResult = ref<FrpNodesResult | null>(null)
const nodesLoading = ref(false)
const nodesError = ref('')
const onlyFree = ref(true)
const creation = reactive({ name: 'Minecraft', node: '', localPort: '', remotePort: '' })
const creating = ref(false)
const visibleNodes = computed(() => onlyFree.value ? (nodesResult.value?.nodes || []).filter(n => n.free) : nodesResult.value?.nodes || [])
const creatableNodes = computed(() => visibleNodes.value.filter(n => n.online && n.canCreate))
const connected = computed(() => tunnels.value.filter(t => t.status === 'running').length)
const restoring = computed(() => tunnels.value.filter(t => t.desired).length)
const busy = computed(() => creating.value || nodesLoading.value)
let disposed = false
const statusLabel: Record<string, string> = { idle: '未启动', starting: '正在连接', running: '已连接', auth_failed: '认证失败', tunnel_offline: '隧道不可用', error: '连接失败', stopped: '已停止' }
const active = (t: ManagedTunnel) => t.status === 'running' || t.status === 'starting'
const tone = (t: ManagedTunnel): 'neutral' | 'success' | 'danger' | 'pending' => t.busy ? 'pending' : t.status === 'running' ? 'success' : t.status === 'starting' ? 'pending' : ['auth_failed', 'tunnel_offline', 'error'].includes(t.status) ? 'danger' : 'neutral'
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e)).replace(/^Error invoking remote method '[^']*': (Error: )?/, '')
watch(() => form.accessKey, () => { nodesResult.value = null })
async function refreshStatus() {
  try {
    const result = await kamucl.invoke('frp:status') as { accessKey: string; tunnels: ManagedTunnel[] }
    if (disposed) return
    tunnels.value = result.tunnels || []
    if (!form.accessKey && result.accessKey) form.accessKey = result.accessKey
  } catch(e) { errorMsg.value = errText(e) }
}
async function control(t: ManagedTunnel, stop: boolean) {
  if (t.deleting || (stop ? stopping.has(t.id) : operations.has(t.id))) return
  if (stop) stopping.add(t.id)
  operations.add(t.id); errorMsg.value = ''
  try {
    await kamucl.invoke(stop ? 'frp:stop' : 'frp:start', { id: t.id })
    if (stop) toast(`已停止「${t.name}」，下次启动不会自动恢复`, 'success')
  } catch(e) { errorMsg.value = errText(e); toast(errorMsg.value, 'error') }
  finally { operations.delete(t.id); stopping.delete(t.id); await refreshStatus() }
}
async function loadNodes(refresh = false, notify = true): Promise<boolean> {
  if (nodesLoading.value) return false
  nodesLoading.value = true; nodesError.value = ''
  try {
    const result = await kamucl.invoke('frp:nodes', { accessKey: form.accessKey.trim(), refresh }) as FrpNodesResult
    if (!Array.isArray(result?.nodes)) throw new Error('节点列表查询失败，请重试')
    if (!Array.isArray(result.tunnels)) throw new Error('隧道列表查询失败，请检查密钥权限后重试')
    if (disposed) return false
    nodesResult.value = result; await refreshStatus()
    if (notify) toast(`已读取成功：${result.tunnels.length} 条隧道，${result.nodes.length} 个节点`, 'success')
    return true
  } catch(e) { if (!disposed) { nodesError.value = errText(e); toast(`读取失败：${nodesError.value}`, 'error') }; return false }
  finally { nodesLoading.value = false }
}
async function createTunnel() {
  if (creating.value) return
  creating.value = true; errorMsg.value = ''
  try {
    await kamucl.invoke('frp:create-tunnel', { accessKey: form.accessKey.trim(), tunnel: { name: creation.name, node: Number(creation.node), localPort: Number(creation.localPort), remotePort: Number(creation.remotePort) || undefined } })
    const loaded = await loadNodes(true, false)
    toast(loaded ? '隧道已创建，可在隧道卡片中启动' : '隧道已创建，请刷新列表后查看', loaded ? 'success' : 'info')
  } catch(e) { errorMsg.value = errText(e); toast(errorMsg.value, 'error') }
  finally { creating.value = false }
}
async function copyWebsite() { toast(await copyText('https://www.natfrp.com/') ? '已复制樱花穿透网址' : '复制失败', 'info') }
async function copyRemote(address: string) { toast(await copyText(address) ? '已复制远程地址' : '复制失败', 'info') }
function onReferenceToggle(event: Event) { if ((event.target as HTMLDetailsElement).open && !nodesResult.value && !nodesLoading.value && form.accessKey.trim()) void loadNodes() }
let unsubscribe: (() => void) | undefined
onMounted(async () => {
  unsubscribe = kamucl.on('frp:event', (raw: unknown) => {
    const t = (raw as { tunnel?: ManagedTunnel })?.tunnel
    if (!t || disposed) return
    const index = tunnels.value.findIndex(x => x.id === t.id)
    if (index >= 0) tunnels.value[index] = t
    else tunnels.value.push(t)
  })
  await refreshStatus()
})
onBeforeUnmount(() => { disposed = true; unsubscribe?.() })
</script>

<template>
  <div class="frp-page">
    <ConfirmModal :open="!!deleteTarget" title="删除樱花隧道" :message="deleteTarget ? `确认删除「${deleteTarget.name}」（#${deleteTarget.config?.tunnelId}）？这会从樱花穿透账号中永久删除该隧道，停止本地连接并取消自动恢复，无法撤销。其他隧道不受影响。${deleteError ? '\n' + deleteError : ''}` : ''" confirm-text="从樱花穿透删除" :busy="deleting" @confirm="confirmDelete" @cancel="cancelDelete" />
    <section class="frp-overview" data-ui="frp:overview">
      <div><h2>我的隧道</h2><p>每条隧道独立连接，随时启停。</p></div>
      <div class="frp-metrics"><span><b>{{ connected }}</b> 已连接</span><span><b>{{ restoring }}</b> 下次恢复</span><button class="btn btn-ghost" @click="refreshStatus">刷新状态</button></div>
    </section>
    <p class="frp-restore-note">关闭启动器时，会记住未手动停止的隧道，下次打开自动恢复。点击某条隧道的“停止”只影响该隧道。好友可在游戏的“直接连接”中填入远程地址。</p>
    <p v-if="errorMsg" class="connection-error" role="alert">{{ errorMsg }}</p>
    <ConnectionPanel title="樱花穿透账号" subtitle="填写访问密钥，读取账号中的隧道与节点。已连接的隧道不会被其他隧道的操作打断。">
      <div class="frp-account-row"><label class="connection-field"><span>访问密钥</span><input v-model="form.accessKey" class="input" type="password" autocomplete="off" placeholder="粘贴用户信息页的访问密钥" :disabled="busy" /></label><button class="btn btn-gold" :disabled="busy || !form.accessKey.trim()" @click="loadNodes(true)">{{ nodesLoading ? '正在读取…' : '读取我的隧道与节点' }}</button></div>
      <div class="frp-guide-links"><a href="https://www.natfrp.com/" target="_blank" rel="noreferrer">打开樱花穿透 ↗</a><button class="btn btn-ghost btn-sm" @click="copyWebsite">复制网址</button><a href="https://doc.natfrp.com/" target="_blank" rel="noreferrer">使用帮助 ↗</a><small>密钥仅保存在本机。</small></div>
      <p v-if="nodesError" class="connection-error" role="alert">{{ nodesError }}</p>
    </ConnectionPanel>
    <section class="frp-tunnel-grid" aria-label="隧道控制区域" data-ui="frp:tunnels">
      <article v-for="t in tunnels" :key="t.id" class="frp-tunnel-card" :class="{ connected: t.status === 'running' }" :data-ui="'frp:tunnel:' + t.id">
        <header><div><h3>{{ t.name }}</h3><p>{{ t.nodeName || '节点信息待读取' }} · #{{ t.config?.tunnelId }}</p></div><ConnectionStatus :tone="tone(t)" :label="t.deleting ? '正在删除' : t.busy ? '正在准备' : statusLabel[t.status]" /></header>
        <div class="frp-endpoints"><div><span>本地服务</span><strong>{{ t.localIp }}:{{ t.config?.localPort || '未配置' }}</strong></div><div><span>远程地址</span><strong>{{ t.remoteAddress || (t.status === 'running' ? '等待服务返回地址' : '连接后显示') }}</strong><button v-if="t.remoteAddress" class="btn btn-ghost btn-sm" @click="copyRemote(t.remoteAddress)">复制地址</button></div></div>
        <p class="frp-tunnel-message" :class="{ danger: tone(t) === 'danger' }">{{ t.busy ? '正在检查隧道并准备连接…' : t.message }}</p>
        <footer><small>{{ t.desired ? '下次打开启动器将自动恢复' : '已停止自动恢复' }}</small><div class="frp-card-actions"><button v-if="!active(t) && !t.busy" class="btn btn-gold" :disabled="t.deleting || operations.has(t.id)" @click="control(t, false)">{{ tone(t) === 'danger' ? '重试连接' : '启动隧道' }}</button><button v-if="active(t) || t.desired || t.busy" class="btn btn-ghost" :disabled="t.deleting || stopping.has(t.id)" @click="control(t, true)">{{ t.busy ? '取消启动' : '停止隧道' }}</button><button class="btn btn-danger btn-sm" :disabled="t.deleting" @click="askDelete(t)">删除隧道</button></div></footer>
        <details class="frp-card-logs"><summary>运行日志 · {{ t.logs.length }} 条</summary><div class="connection-log-viewport"><p v-if="!t.logs.length" class="connection-muted">尚无日志</p><p v-for="(entry, i) in t.logs" :key="i" class="mono connection-log-line">[{{ entry.stream }}] {{ entry.text }}</p></div></details>
      </article>
      <div v-if="!tunnels.length" class="frp-empty"><h3>还没有读取隧道</h3><p>读取账号后，每条隧道会在这里拥有独立的控制卡片。没有隧道时，可在下方创建。</p></div>
    </section>
    <details class="frp-create-details"><summary>＋ 创建新隧道</summary>

    <ConnectionPanel title="创建新隧道" subtitle="选择服务节点，再填入游戏局域网端口。创建成功后显示独立卡片，不会自动运行。">
      <div class="frp-create-grid"><label class="connection-field"><span>隧道名称</span><input v-model="creation.name" class="input" maxlength="64" placeholder="例如：好友生存世界" /></label><label class="connection-field"><span>服务节点</span><select v-model="creation.node" class="input"><option value="">{{ nodesResult ? '选择可用节点' : '请先读取节点' }}</option><option v-for="n in creatableNodes" :key="n.id" :value="String(n.id)">{{ n.name }} · {{ n.free ? '免费' : '专业版' }}{{ n.load !== null ? ' · ' + n.load + '%' : '' }}</option></select></label><label class="connection-field"><span>本地端口</span><input v-model="creation.localPort" class="input" type="number" min="1" max="65535" placeholder="游戏对局域网开放后显示的端口" /></label><label class="connection-field"><span>远程端口（可选）</span><input v-model="creation.remotePort" class="input" type="number" min="1" max="65535" placeholder="留空由樱花穿透分配" /></label></div>
      <label class="frp-free"><input v-model="onlyFree" type="checkbox" />仅显示免费节点</label>
      <button class="btn btn-gold" :disabled="creating || !form.accessKey.trim() || !creation.node || !creation.localPort" @click="createTunnel">{{ creating ? '正在创建…' : '创建 TCP 隧道' }}</button>
    </ConnectionPanel>

    </details>
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

  </div>
</template>
<style scoped>
.frp-overview { display:flex; align-items:center; justify-content:space-between; gap:16px; flex-wrap:wrap }
.frp-overview h2 { margin:0 0 8px; font-size:24px }
.frp-overview p,.frp-restore-note { color:var(--text-dim); line-height:1.7; margin:0 }
.frp-metrics { display:flex; align-items:center; gap:20px; flex-wrap:wrap; color:var(--text-dim) }
.frp-metrics b { color:var(--text); font-size:24px; margin-right:6px }
.frp-restore-note { padding:14px 18px; background:var(--accent-soft); border:1px solid var(--border); border-radius:var(--radius-md) }
.frp-account-row { display:flex; align-items:flex-end; gap:14px; flex-wrap:wrap; margin-bottom:14px }
.frp-account-row .connection-field { flex:1; min-width:200px }
.frp-tunnel-grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:18px }
.frp-tunnel-card { min-width:0; padding:22px; border:1px solid var(--border); background:var(--card); border-radius:var(--radius-lg); box-shadow:var(--shadow); display:flex; flex-direction:column; gap:18px }
.frp-tunnel-card.connected { border-color:color-mix(in srgb,var(--ok) 55%,var(--border)) }
.frp-tunnel-card header,.frp-tunnel-card footer { display:flex; align-items:center; justify-content:space-between; gap:12px; flex-wrap:wrap }
.frp-tunnel-card h3 { margin:0 0 6px; font-size:18px; overflow-wrap:anywhere }
.frp-tunnel-card header p,.frp-tunnel-card small { color:var(--text-dim); margin:0 }
.frp-endpoints { padding:14px; background:var(--card-2); border-radius:var(--radius-md); display:grid; gap:14px }
.frp-endpoints>div { display:flex; align-items:center; gap:8px; flex-wrap:wrap; min-width:0 }
.frp-endpoints span { width:100%; font-size:12px; color:var(--text-dim) }
.frp-endpoints strong { font-size:14px; overflow-wrap:anywhere; user-select:text }
.frp-tunnel-message { margin:0; line-height:1.6; font-size:13px; color:var(--text-dim); overflow-wrap:anywhere }
.frp-tunnel-message.danger { color:var(--danger) }
.frp-card-actions { display:flex; gap:8px; flex-wrap:wrap }
.frp-tunnel-card footer { margin-top:auto }
.frp-card-logs { padding-top:12px; border-top:1px solid var(--border) }
.frp-card-logs summary,.frp-create-details>summary { cursor:pointer; color:var(--text-dim); padding:8px 0 }
.frp-empty { grid-column:1/-1; border:1px dashed var(--border); padding:32px; text-align:center; border-radius:var(--radius-md); color:var(--text-dim) }
@media(max-width:1100px) { .frp-tunnel-grid { grid-template-columns:1fr } }
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
