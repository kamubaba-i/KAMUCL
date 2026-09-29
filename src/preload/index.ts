import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { isAllowedInvokeChannel, isAllowedListenerChannel, isAllowedSendChannel } from './channelPolicy'

function requireChannel(allowed: boolean): void {
  if (!allowed) throw new Error('IPC 通道未授权')
}

const api = {
  invoke: (channel: string, ...args: unknown[]) => {
    requireChannel(isAllowedInvokeChannel(channel))
    return ipcRenderer.invoke(channel, ...args)
  },
  on: (channel: string, cb: (...args: unknown[]) => void) => {
    requireChannel(isAllowedListenerChannel(channel))
    const listener = (_e: Electron.IpcRendererEvent, ...args: unknown[]) => cb(...args)
    ipcRenderer.on(channel, listener)
    return () => ipcRenderer.removeListener(channel, listener)
  },
  send: (channel: string, ...args: unknown[]) => {
    requireChannel(isAllowedSendChannel(channel))
    return ipcRenderer.send(channel, ...args)
  },
  /** 拖入文件时取真实文件系统路径（Electron 32+ 必须经 webUtils） */
  getFilePath: (file: File) => webUtils.getPathForFile(file),
  platform: process.platform
}

contextBridge.exposeInMainWorld('kamucl', api)
