/** UI navigation only; settings storage and defaults remain owned by core/settings. */
export const settingsCategories = [
  { id: 'appearance', label: '外观' }, { id: 'game', label: '游戏与启动' },
  { id: 'downloads', label: '下载' }, { id: 'features', label: '功能' },
  { id: 'about', label: '关于与更新' }
] as const
export type SettingsCategory = typeof settingsCategories[number]['id']
export const settingsCatalog = [
  { id: 'theme', category: 'appearance', name: '主题与个性化', keywords: '颜色 深色 浅色 透明 自定义 字体 外观工作台' },
  { id: 'background', category: 'appearance', name: '背景与启动卡图片', keywords: '壁纸 轮播 插画 缩略图 布局 透明度' },
  { id: 'motion', category: 'appearance', name: '减少动态效果', keywords: '动画 动效 系统偏好 晕动 静止' },
  { id: 'isolation', category: 'game', name: '新版本默认隔离', keywords: '存档 模组 配置 独立 共享目录' },
  { id: 'memory', category: 'game', name: '内存分配', keywords: 'RAM 自动分配 GB 性能' },
  { id: 'java', category: 'game', name: 'Java 运行时', keywords: 'JDK JVM 路径 自动下载 检测 扫描 手动添加' },
  { id: 'resolution', category: 'game', name: '游戏窗口分辨率', keywords: '宽 高 最大化 全屏 窗口化' },
  { id: 'jvm', category: 'game', name: 'JVM 参数', keywords: '高级 垃圾回收 GC G1GC 启动参数' },
  { id: 'launch', category: 'game', name: '启动与正版登录', keywords: '启动后关闭启动器 微软 系统代理 Microsoft 登录' },
  { id: 'downloads', category: 'downloads', name: '下载并发与速度', keywords: '最大线程数 限速 KiB CurseForge API Key 密钥 下载目标文件夹 安装位置' },
  { id: 'mirror', category: 'downloads', name: '下载镜像', keywords: '官方源 BMCLAPI 网络' },
  { id: 'features', category: 'features', name: '功能管理', keywords: '侧边栏 模组 资源包 光影 录像 MOD 面板 服务器 联机 皮肤 社区' },
  { id: 'plugins', category: 'features', name: '插件', keywords: '安装 删除 启用 停用 JS' },
  { id: 'update', category: 'about', name: '关于与更新', keywords: '版本 自动更新 检查更新 下载源 镜像 回退 还原 本地更新 许可 开源' }
] as const
export function searchSettings(query: string) {
  const words = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean)
  return words.length ? settingsCatalog.filter(item => words.every(word => `${item.name} ${item.keywords}`.toLocaleLowerCase().includes(word))) : []
}
export function motionReduced(value: unknown, system: boolean): boolean {
  return value === true || system
}
