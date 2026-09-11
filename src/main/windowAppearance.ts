import type { BrowserWindowConstructorOptions } from 'electron'

/**
 * 主窗口的固定外观基线。
 *
 * renderer 只负责绘制带 alpha 的界面层；Windows 11 22H2+ 的桌面模糊由
 * DWM acrylic material 完成，旧版 Windows 则稳定降级为透明窗口 + 半透明色板。
 */
export function windowAppearance(
  platform: NodeJS.Platform = process.platform
): Pick<
  BrowserWindowConstructorOptions,
  | 'width'
  | 'height'
  | 'minWidth'
  | 'minHeight'
  | 'frame'
  | 'transparent'
  | 'backgroundColor'
  | 'backgroundMaterial'
  | 'roundedCorners'
  | 'hasShadow'
  | 'thickFrame'
  | 'titleBarStyle'
  | 'trafficLightPosition'
  | 'vibrancy'
  | 'visualEffectState'
> {
  return {
    width: 1360,
    height: 860,
    minWidth: 960,
    minHeight: 620,
    frame: platform === 'darwin',
    titleBarStyle: platform === 'darwin' ? 'hiddenInset' : undefined,
    trafficLightPosition: platform === 'darwin' ? { x: 16, y: 16 } : undefined,
    vibrancy: platform === 'darwin' ? 'under-window' : undefined,
    visualEffectState: platform === 'darwin' ? 'active' : undefined,
    // DWM 为普通 HWND 合成桌面 Acrylic；transparent:true 会创建 layered
    // window，绕过该合成路径并影响 Windows 原生缩放/最大化。
    // WebContents 仍通过 backgroundColor 的 alpha 保持透明。
    transparent: platform !== 'win32' && platform !== 'darwin',
    backgroundColor: '#00000000',
    backgroundMaterial: platform === 'win32' ? 'acrylic' : undefined,
    roundedCorners: true,
    hasShadow: true,
    thickFrame: true
  }
}
