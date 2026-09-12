/** 重建 DWM 材质需等原生 WM_SIZE/样式更新结束，不能在同步事件中完成。 */
export function trackMaterialLifecycle(
  window: { on(event: string, listener: () => void): unknown; isDestroyed(): boolean; setBackgroundMaterial(material: 'none' | 'acrylic'): void },
  report: (message: string) => void,
  restoreFrame: () => void = () => {}
): void {
  let pending: ReturnType<typeof setTimeout> | undefined
  const refresh = () => {
    clearTimeout(pending)
    pending = setTimeout(() => {
      if (window.isDestroyed()) return
      try {
        // Reapply the material/frame without exposing an opaque intermediate frame.
        window.setBackgroundMaterial('acrylic')
        restoreFrame()
      } catch (error) { report(`Desktop acrylic refresh failed: ${String(error)}`) }
    }, 80)
  }
  for (const event of ['maximize', 'unmaximize', 'restore', 'show', 'leave-full-screen']) window.on(event, refresh)

  // 最大化/全屏窗口切屏（Alt+Tab、Win+D、锁屏）后再切回只产生 focus，不经过 restore：
  // DWM 在该路径下可能丢失 Acrylic 材质导致背景变不透明。focus 时重建，节流 1s 防止
  // 普通点击激活窗口造成的反复闪动。
  let lastFocusRefresh = 0
  let focusPending: ReturnType<typeof setTimeout> | undefined
  window.on('focus', () => {
    const now = Date.now()
    if (now - lastFocusRefresh < 1000) return
    lastFocusRefresh = now
    clearTimeout(focusPending)
    focusPending = setTimeout(() => {
      if (window.isDestroyed()) return
      try {
        // Reapply the material/frame without exposing an opaque intermediate frame.
        window.setBackgroundMaterial('acrylic')
        restoreFrame()
      } catch (error) { report(`Desktop acrylic focus refresh failed: ${String(error)}`) }
    }, 120)
  })
  window.on('closed', () => { clearTimeout(pending); clearTimeout(focusPending) })
}
