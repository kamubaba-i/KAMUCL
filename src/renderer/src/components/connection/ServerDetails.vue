<script setup lang="ts">
import type { ServerEntry, ServerPingResult, InstalledVersion } from '@shared/types'
import ConnectionPanel from './ConnectionPanel.vue'
import ConnectionStatus from './ConnectionStatus.vue'
defineProps<{
  server: ServerEntry; ping: ServerPingResult | null; pending: boolean; busy: boolean; running?: boolean; binding: boolean;
  targets: InstalledVersion[]; bound: string; missing: boolean; lastUsed: string;
  targetToken: (target: InstalledVersion) => string; targetLabel: (target: InstalledVersion) => string
}>()
defineEmits<{ bind: [value: string]; connect: []; refresh: []; edit: []; remove: []; relink: []; versions: []; copy: [] }>()
</script>
<template>
  <ConnectionPanel title="服务器详情" subtitle="确认实例，准备出发" class="server-detail">
    <template #action><ConnectionStatus :tone="pending ? 'pending' : ping?.online ? 'success' : 'neutral'" :label="pending ? '检测中' : ping?.online ? '在线' : ping ? '未连通' : '未检测'" /></template>
    <div class="server-detail-title"><span class="server-monogram large" aria-hidden="true">{{ server.name.slice(0,1).toUpperCase() }}</span><div><h3>{{ server.name }}</h3><p class="mono">{{ server.address }}</p></div></div>
    <div class="server-description" aria-live="polite">{{ pending ? '正在获取服务器状态…' : ping?.motd || '刷新状态，查看服务器介绍与在线人数。' }}</div>
    <div class="server-facts"><div><span>在线玩家</span><strong>{{ ping?.online && !pending ? ping.players : '—' }}</strong></div><div><span>网络延迟</span><strong>{{ ping?.online && !pending ? ping.latencyMs + ' ms' : '—' }}</strong></div></div>
    <p v-if="ping?.online && !pending" class="connection-muted">服务器版本：{{ ping.version }}</p>
    <label class="connection-field">使用此实例连接<select class="select" :value="bound" :disabled="busy || binding" @change="$emit('bind', ($event.target as HTMLSelectElement).value)"><option value="">未关联实例 · 连接时选择</option><option v-for="v in targets" :key="targetToken(v)" :value="targetToken(v)">{{ targetLabel(v) }}{{ v.isolated ? '（隔离）' : '' }}</option></select></label>
    <div v-if="missing" class="connection-result"><ConnectionStatus tone="danger" label="关联实例缺失" /><p>原实例可能已移动或所在磁盘不可用。</p><div class="connection-actions"><button class="btn btn-ghost" @click="$emit('relink')">重新关联</button><button class="btn btn-ghost" @click="$emit('versions')">前往版本页</button></div></div>
    <p v-else-if="server.candidateVersionIds?.length" class="connection-muted">共享目录记录，请选择并确认具体实例。</p>
    <div class="connection-muted"><p v-if="server.minecraftVersion">Minecraft {{ server.minecraftVersion }}<span v-if="server.loader"> · {{ server.loader }} {{ server.loaderVersion }}</span></p><p>{{ lastUsed }}</p></div>
    <button class="btn btn-gold server-connect" :disabled="busy || binding" @click="$emit('connect')">{{ running ? '游戏已运行' : busy ? '正在启动…' : server.versionId && !missing ? '启动并连接' : '选择实例并连接' }}<span aria-hidden="true">↗</span></button>
    <div class="connection-actions server-secondary"><button class="btn btn-ghost" :disabled="pending" @click="$emit('refresh')">刷新状态</button><button class="btn btn-ghost" @click="$emit('copy')">复制地址</button><button class="btn btn-ghost" :disabled="busy || binding" @click="$emit('edit')">编辑</button><button class="btn btn-ghost server-delete" :disabled="busy || binding" @click="$emit('remove')">删除</button></div>
    <p class="connection-muted server-footnote">状态检测失败不一定代表无法进入游戏，仍可尝试连接。</p>
  </ConnectionPanel>
</template>
