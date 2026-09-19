<script setup lang="ts">
import type { ServerEntry, ServerPingResult } from '@shared/types'
import ConnectionStatus from './ConnectionStatus.vue'
defineProps<{ server: ServerEntry; ping: ServerPingResult | null; pending: boolean; active: boolean; selectMode: boolean; checked: boolean }>()
defineEmits<{ select: []; toggle: []; connect: []; favorite: [] }>()
</script>
<template>
  <div class="server-list-item" :class="{ active, checked }">
    <label v-if="selectMode" class="server-check"><input type="checkbox" :aria-label="'选择 ' + server.name" :checked="checked" @change="$emit('toggle')" /></label>
    <button class="btn btn-ghost server-favorite" :class="{ starred: server.favorite }" :aria-label="(server.favorite ? '取消收藏 ' : '收藏 ') + server.name" :aria-pressed="!!server.favorite" :title="server.favorite ? '取消收藏' : '收藏，优先显示'" @click="$emit('favorite')">{{ server.favorite ? '★' : '☆' }}</button>
    <button class="server-row-button" :aria-pressed="active" @click="selectMode ? $emit('toggle') : $emit('select')" @dblclick="!selectMode && $emit('connect')">
      <span class="server-monogram" aria-hidden="true">{{ server.name.slice(0, 1).toUpperCase() }}</span>
      <span class="server-row-copy"><strong :title="server.name">{{ server.name }}</strong><span class="mono" :title="server.address">{{ server.address }}</span><small>{{ server.versionId || '尚未关联实例' }}</small></span>
      <span class="server-row-state"><ConnectionStatus :tone="pending ? 'pending' : ping?.online ? 'success' : 'neutral'" :label="pending ? '检测中' : ping?.online ? '在线' : ping ? '未连通' : '未检测'" /><small v-if="ping?.online && !pending">{{ ping.latencyMs }} ms</small></span>
    </button>
  </div>
</template>

<style scoped>
.server-favorite { align-self:center; flex-shrink:0; padding:8px; font-size:21px; }
.server-favorite.starred { color:var(--accent); }
</style>
