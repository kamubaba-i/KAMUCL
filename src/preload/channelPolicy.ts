import { IPC, IPC_EVENT } from '../shared/types'

const INVOKE_EXTRA = new Set([
  'appearance:draftRead',
  'appearance:draftSave',
  'appearance:draftDiscard',
  'appearance:draftApply',
  'center:dependencyPlan',
  'center:dependencyApply',
  'frp:create-tunnel',
  'frp:delete-tunnel',
  'mods:catalog',
  'mods:setEnabled',
  'mods:setLocked',
  'mods:versionChoices',
  'mods:versionPlan',
  'mods:versionApply',
  'tc:install',
  'tc:cancel-install',
  'voxlink:useTurnRelay',
  'recordings:list',
  'recordings:open',
  'recordings:operate',
  'recordings:import',
  'recordings:modVersions'
])

const SEND_CHANNELS = new Set([
  'window:minimize',
  'window:maximize',
  'window:close',
  'boot:stage',
  'boot:renderer-ready',
  'recordings:drag',
  'fs:drag'
])

const LISTENER_EXTRA = new Set([
  'kamucl:mem-trim',
  'tc:event',
  'frp:event',
  'voxlink:event',
  'window:caption-pointerdown'
])

const INVOKE_CHANNELS: ReadonlySet<string> = new Set<string>([...Object.values(IPC), ...INVOKE_EXTRA])
const LISTENER_CHANNELS: ReadonlySet<string> = new Set<string>([...Object.values(IPC_EVENT), ...LISTENER_EXTRA])

export function isAllowedInvokeChannel(channel: unknown): channel is string {
  return typeof channel === 'string' && INVOKE_CHANNELS.has(channel)
}

export function isAllowedListenerChannel(channel: unknown): channel is string {
  return typeof channel === 'string' && LISTENER_CHANNELS.has(channel)
}

export function isAllowedSendChannel(channel: unknown): channel is string {
  return typeof channel === 'string' && SEND_CHANNELS.has(channel)
}
