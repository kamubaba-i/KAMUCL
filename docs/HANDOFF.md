# KAMUCL 项目交接文档（给 Codex）

> 更新时间：2026-09-10 22:42 ｜ 当前版本：**1.0.44**（已完成验证、打包和发布）
> 工作区：E:\KAMUCL（git 仓库）

---

## 0. 必读：项目一句话

KAMUCL 是卡慕SaMa 的 Minecraft 启动器：Electron 33+ + Vue 3（script setup）+ TypeScript。便携版单 exe 分发，GitHub Releases 自更新。当前由卡慕（产品/前端指令）+ 我（主线开发）+ 物晖（另一条开发线，今后**不再合并其分支**）协作。

---

## 1. 当前进度快照

**1.0.44 已发布**：https://github.com/kamubaba-i/KAMUCL/releases/tag/v1.0.44 ，Release ID386367083。功能提交 master `4dad402` / main `3f3bac1`，标签 v1.0.44 指向 master 功能提交。EXE 67,616,046 字节、ZIP 103,187,304 字节；三个远端附件大小和 SHA256、源码标签核对后公开，latest 为 v1.0.44，误发 v1.0.41 仍未公开。EXE SHA256 `bfc6004bb723aafd567195390702939ff5eaf45e711c35695430293ae2cef31f`；ZIP SHA256 `4c78c5f551d8a4af27e0d6a79143d4db2073dbac029d9c58dfcd07e5fd41fff9`。

**1.0.44 游戏选项与默认配置 UI**：默认配置分为游戏选项、按键配置、默认材质包。新增 defaultGameOptions 核心/IPC 和共享 gameOptions 定义；以 26.2 Esc → 选项两列入口排列，覆盖疾跑/潜行切换、自动跳跃、FOV、亮度、声音、鼠标、聊天、视频及辅助功能。数字支持滑块和直接输入；总同步默认关闭，只覆盖用户明确修改的项，每项可恢复跟随游戏。启动时从实例元数据及 client JAR version.json 确认实际版本，对 FOV/百分比/聊天尺寸等编码后写入实际 effectiveGameDir/options.txt，回读校验；未知版本停止同步，旧版不支持项跳过并记录。高对比度同时选择内置 high_contrast 包，保留其他资源包。详细验证范围见 docs/VOXLINK-UPSTREAM.md；未宣称逐个启动全部历史客户端。

**1.0.44 皮肤与 VoxLink**：SkinsView 重命名用当前编辑 ID 防止 Enter 卸载输入框引发 blur 二次提交空名，Esc 也不会再保存。VoxLink 参考 AUGUHDAR/VoxLink 1.1.4 提交 40d03c6，同步适用的 STUN 可达节点优先、映射端口变化、重复 punch_info 短时去重和 update_room 429 冷却；修复 TS 打洞 ACK 热循环及计时器/取消收尾。公开上游是 MOD 仓库，没有原 app-desktop；MOD 专属 TURN 密钥重派和自动日志上传未移植，不能描述为完整独立桌面端升级。如用户提供独立桌面端更新链接需继续核对。

**1.0.44 验证**：341/341 测试、TypeScript、生产构建通过。新增皮肤实际 SFC setup 重命名事件回归、本地 UDP/STUN/HTTP 联机验证、多版本选项编码与文件保留/幂等/不支持处理验证。实际 Electron UI 证据 out/default-config-ui-3WCJWK、out/design-ui-6g9mKQ（含真实生产渲染、隔离 IPC 核心配置持久化、小窗口与离开返回）。EXE 中文空格路径启动通过；冷启动粒子首帧419ms、缓存240ms，缓存复用通过；ZIP app.asar 与构建相同，包内主程序与构建逐字节一致。测试均使用隔离目录和本地网络，没有修改真实账号、实例选项或停止用户游戏。


**1.0.43 已发布**：https://github.com/kamubaba-i/KAMUCL/releases/tag/v1.0.43 ，Release ID386336943。EXE中文空格路径启动通过，ZIP内app.asar与构建一致；便携粒子首帧冷启动412ms、缓存启动250ms，缓存复用通过。三个远端附件大小、SHA256和源码标签核对后公开，latest为v1.0.43。EXE SHA256 `7e22cf1afff7fb3865c0b40e378d32573d9b6780e956e6a1bc709134e51bfa95`；ZIP SHA256 `4bce1e6ae559277351011eaf4b0213ac94fd82addfbdb278c3679a02a0d18f7c`。

**1.0.43 披风加载后人物倾斜**：SkinViewer3D的俯仰已改为相机绕人物中心环绕，但buildModel重建仍把pitch写入模型rotation.x；加载/切换/移除披风触发重建后双重施加俯仰，下一帧只改yaw也不会清除倾斜。重建及applyPose统一rotation.set(0,yaw,0)，俯仰只作用于相机，保留当前观察角度、缩放和披风自身10度外倾。共用组件同时覆盖首页及皮肤页。

**1.0.43 验证**：335/335测试、TypeScript和生产构建通过。新增真实Three.js模型回归：俯视/仰视、行走/待机、加载/切换/移除披风，断言重建第一帧及后续姿态世界向上方向不变、相机及缩放不变、披风确实增删，回正恢复默认。独立Electron WebGL加载实际SFC并截图，证据out/cape-ui-XdVWzL（before.png、cape.png、result.json），相机位置一致、人物直立；测试使用生成纹理及隔离目录，不改真实账号披风。功能提交master `d2c1d44` / main `6328be6`。

**1.0.42 已发布**：https://github.com/kamubaba-i/KAMUCL/releases/tag/v1.0.42 ，Release ID386311212。EXE中文空格路径启动通过，ZIP内app.asar与构建一致；便携粒子首帧冷启动433ms、缓存启动276ms，缓存复用通过。三个远端附件大小、SHA256和源码标签核对后公开，latest为v1.0.42，v1.0.41仍为撤回状态。EXE SHA256 `8403da51f26809dd8282ab087f8b34a3dbbdc2c55c42e52e6ac39ac9c4947ef5`；ZIP SHA256 `13685c85f57d3619d9891e290b58dce26e95cb508cea0fe270f3d96a3029f8aa`。

**1.0.42 游戏本体慢速换源**：用户反馈本体只有约0.1MB/s。本机设置downloadSpeedKBps=0；旧慢速门槛仅15秒16KiB（约1KiB/s），无法处理持续有数据但很慢的连接。对至少8MiB且首轮仍有备用来源的文件增加8秒滑窗、256KiB/s门槛，触发后复用.part续传；最后一个来源及第二轮不套新门槛，避免所有来源较慢时不断断开。暂停重置窗口，主动限速跳过检测，仍保留原有停滞检测、大小及哈希校验。下载中心38%原为包含依赖库阶段的总进度，文案明确为“总进度”。用户明确同意跳过已误发撤回的1.0.41，保留旧标签，以1.0.42交付。

**1.0.42 验证**：334/334测试、TypeScript、构建和生产UI通过（out/design-ui-fACfLV）。新增本地HTTP慢速→快速来源续传测试，验证最终字节一致及唯一慢来源不被新门槛反复中断。使用真实下载模块、隔离用户目录下载1.21.9，本体30,591,861字节耗时48,916ms，平均约0.6MiB/s，SHA1 ce92fd8d1b2460c41ceda07ae7b3fe863a80d045 与元数据一致。日志确认官方来源慢速后切镜像完成；此为当时实测，不保证固定网速。证据out/live-client-1.0.42.log、out/live-client-AZZqQi/logs/launcher-current.log。没有修改真实实例或启动/停止用户游戏。功能提交master `e1c11b4` / main `cbadc96`。

**1.0.40 启动可靠性**：依赖库按 Maven group/artifact/classifier/extension 去重，子版本优先覆盖父版本，规则过滤先于去重，native 与普通库保持区分，下载列表和最终 classpath 共用解析。启动前校验 client JAR 和依赖库的大小、SHA1；缺少哈希的 JAR 检查 ZIP 结构及 CRC。损坏文件重新下载并复验，没有下载地址的缺失或损坏生成库明确报错，避免静默漏入 classpath。

**1.0.40 异常退出记忆**：用户明确要求同时覆盖游戏和启动器。新增 userData/exit-history.json，独立 UUID 跟踪每次启动，保存最近30条记录、已读状态与诊断目录。正常退出和主动停止不报崩溃，未收到游戏退出状态时标为未知，仍存活的游戏不误报。重开启动器后通知面板可查看、标记已读和清空。不保存启动命令或令牌，不结束用户游戏。

**1.0.40 验证和交付**：333/333测试、TypeScript、生产构建通过；生产界面验证历史记录跨刷新、已读与清空持久化（out/design-ui-vjBFw7）；独立 Node 子进程异常退出后重新打开记录文件验证通过（out/exit-reopen-24U4r4）。EXE 中文空格路径启动通过，ZIP 内 app.asar 与已验证构建一致；便携冷启动粒子首帧381ms、缓存启动229ms，缓存标记保持不变（out/startup-1.0.40.log）。功能提交 master `12395cb` / main `47a48f7`，标签 v1.0.40 指向12395cb。Release ID386266227，三个附件远端大小、SHA256及标签核对后公开，latest确认为v1.0.40，误发v1.0.41仍未公开：https://github.com/kamubaba-i/KAMUCL/releases/tag/v1.0.40 。EXE SHA256 `658a1bf77e8b94927493cf5b066c489b9a955ee42c61fc42ee704bf6b85dac8e`；ZIP SHA256 `a326df21aba8326eb4d37958a195a57179ea46455701d1a3a38c21d7d89b44a3`。

**1.0.39 启动动画60帧**：用户要求开场加载动画改为60帧。原生 StartupFeedback 从 WinForms Timer 改为高精度60Hz截止时间调度，临时申请1ms计时精度并在退出释放；每次最多一个UI绘制请求，过期帧跳过，避免积压。渲染改为复用 top-down DIB 和内存DC，Graphics直接绘入预乘透明像素缓冲，去掉每帧整屏Bitmap分配及GetHbitmap复制，退出释放所有GDI资源。粒子位置仍按真实时间计算，聚合620ms、停留2000ms、淡出320ms不变。Electron备用动画以BOOT_FRAME_MS控制requestAnimationFrame绘制，在高刷新屏也以60帧为目标。

**1.0.39 验证**：328/328测试、TypeScript、生产构建通过。原生实测59.659帧/秒，中位帧间隔15.798ms、p95为30.829ms（当前机器实际呈现调用统计，不承诺所有硬件无掉帧），证据out/startup-fps-guQ3Oa/result.json，工具scripts/verify-startup-framerate.cjs。仅改定时调度、未复用绘图缓冲的中间版本约30.96帧，说明主要绘制开销确实来自整屏分配/复制。实际生产备用splash在模拟60Hz/144Hz时钟下绘制约60/59.97帧，证据out/fallback-fps-1.0.39.log。实际原生场景到Electron窗口衔接通过：首帧160ms、聚合及停留2677ms、同一个原生PID、仅一个主窗口且最终opacity=1（out/unified-startup-BcOtJL）；验证脚本在屏外消耗PowerShell SW_HIDE提示，并等待首帧探针写完，避免测试启动方式干扰判断。

**1.0.39 交付**：功能提交master `b29d71c` / main `f5e5d5a`，标签v1.0.39指向b29d71c。EXE、ZIP已完成，中文空格路径启动通过；ZIP内app.asar与已验证构建一致，内含原生helper与本批最终编译产物一致。便携冷启动粒子首帧419ms、缓存启动277ms，缓存标记未变化（out/startup-1.0.39.log）。Release ID386231318，EXE、ZIP、SHA256SUMS.txt远端大小和SHA256核对后已公开，latest确认为v1.0.39：https://github.com/kamubaba-i/KAMUCL/releases/tag/v1.0.39 。EXE SHA256 `1f7cab0704934bfd3d0de174dbadfad2469baf1a4d670dfdd98e47fe1f4facff`；ZIP SHA256 `eb2e7e5fa6c2e4ed3aaf8571fe7dd7968cf53cc00b9724d08070ce1be2038988`。

**1.0.38 侧栏气泡与下载停滞**：按用户反馈恢复共享移动气泡，使用 useNavigationBubble.ts 测量导航容器内的真实位置，鼠标连续滑过、键盘焦点、资源子菜单展开和滚动均保持对齐；当前页面 aria-current 与左侧标记独立保留。气泡采用300ms平滑位移及柔和渐变，鼠标离开回到当前页，减少动态效果时关闭过渡。保留1.0.36的其他布局、可访问性及主题改进。

**下载诊断与修复**：用户日志 launcher-20260910-181314.log 中26.1.2和26.1停在客户端JAR阶段，26.1约90秒后被取消，日志本身不能区分具体网络停滞形态。检查并复现旧下载器首个MB之前一直绕过慢速检测的盲区：零星数据可无限延长等待；新增15秒预热上限。无数据超时从30秒缩至15秒，存在备用源时超时/慢速直接换源；提前订阅文件流 finished，读取消后检查内部信号，写盘背压等待可中断，可靠收尾并释放并发名额。暂停和本地限速不计入网络停滞；保持断点续传与最终哈希校验。修正源码中已过时的分块下载注释，实际仍为单连接续传、多文件并发。

**1.0.38 验证**：328/328测试通过，最终收尾调整后另跑6项停滞/取消测试通过；TypeScript及生产构建通过。新增4项本地HTTP实测：响应头无响应、空响应体、部分下载停滞、首MB前缓慢滴流，都能换源完成、正确续传并归还唯一并发名额。旧代码滴流复现 out/stall-before-1.0.38.log；新行为 out/stall-1.0.38.log。实际26.1.2客户端下载到独立 out/live-client-UZaqc8，38,113,927字节，184557ms，SHA1 `4e618f09a0c649dde3fdf829df443ce0b8831e65` 与官方元数据一致；这是实际客户端下载验证，没有启动Minecraft或改用户实例。生产UI证据 out/design-ui-oBDZQz（连续插值、快速换目标、鼠标离开、子菜单、键盘焦点/滚动、减少动态效果及多主题）；离屏测试通过CDP模拟焦点，不抢用户窗口焦点。

**1.0.38 已发布**：master `976b5d1` / main `126c663`，标签v1.0.38指向976b5d1。Release：https://github.com/kamubaba-i/KAMUCL/releases/tag/v1.0.38 （ID386201215）；EXE、ZIP、SHA256SUMS.txt远端大小、状态、SHA256与本地一致后公开，latest确认为v1.0.38。便携中文空格路径启动通过，ZIP内app.asar与已验证构建一致；冷启动粒子首帧370ms、缓存启动255ms，缓存复用通过（out/startup-1.0.38.log）。EXE SHA256 `7b545b0f5e13507a546431484ae6b113297885e342d76c3bb4d0d00ae209a840`；ZIP SHA256 `84f1be0720ae42c4dabb69e3fef1a814076465fe1fc940cd6c8a12ac9a029214`。

**1.0.37 语言资源与重复提示**：启动已有外部目录的版本时，旧 launch.ts 固定使用默认文件夹 assets，索引缺失静默忽略，也不补全对象；assets_index_name 错误优先使用 merged.assets 而非 assetIndex.id。新增纯文件模块 launchAssets.ts：优先所属目录，再默认共享目录及其他已登记目录；验证索引，校验语言对象 SHA1，跨缓存按哈希复用，缺失资源经现有下载器补齐，失败阻止无资源启动。现代 assets_root、准确 indexId 和旧版 game_assets 分开；virtual/indexId 与 map_to_resources 正确落地。没有修改实例目录判定或覆盖已有 options.txt。普通版本只显示隔离开关，整合包没有开关时继续显示已隔离标签。

**1.0.37 验证**：324/324 测试、TypeScript 和生产构建通过。新增6项文件级测试覆盖外部资源离线复用、索引别名、原 options 保留、同体积损坏语言修复、缺失索引/对象下载、失败阻断、旧版资源映射及路径边界。生产 renderer 检查普通版本/整合包隔离状态各出现一次，证据 `out/design-ui-A6nVxu/versions-wide.png`。截图中的 D:\.minecraft\ttsever 本机不存在，未直接启动该实例；对本机 D:\Snapshot 2.2.10\.minecraft\versions\背刺 做只读实证：所属目录索引19有143个语言文件及简体中文，默认目录缺少19，新解析器无需下载即可正确选中；options.txt 哈希前后一致，证据 `out/existing-assets-1.0.37.log`。没有启动或结束用户游戏。

**1.0.37 已发布**：master `67cc2e7` / main `dd2eb29`，标签 `v1.0.37` 指向67cc2e7；Release：https://github.com/kamubaba-i/KAMUCL/releases/tag/v1.0.37 （ID 386166964）。EXE 中文空格路径启动通过，ZIP内 app.asar 与已验证构建一致。冷启动粒子首帧368ms / Electron入口4300ms，缓存启动241ms / 201ms，缓存标记不变，证据 `out/startup-1.0.37.log`。远端3附件大小、SHA256、状态及标签核对后公开；latest确认为v1.0.37。EXE SHA256：`40b1f2948cfd79d461917f12bd58d8abde7b0d592c8e5cdf259817490d690a34`；ZIP SHA256：`ed3ae49f9d157eba4645492a1a47b083b29a6f1be3c9296108d5e9c8deb22657`。

**1.0.36 产品设计优化**：用户授权自行检查和优化 UI/动效。本批聚焦导航状态、视觉层级、动效节奏和小窗口排布。App 导航移除随悬停漂移/拉伸的高亮块，当前页面独立高亮并提供 aria-current；资源父级与当前子页区分，折叠菜单 inert，不会接收键盘焦点。页面退出80ms/进入180ms，保留显式时长兜底；系统减少动态效果时为0，并正确解绑监听。按钮悬停保持位置，开关与筛选标签使用180ms减速曲线；卡片入场去掉错落等待，减轻阴影。社区去掉包裹列表的额外卡片，弹窗底色提升到96%，浅色强调文字加深。小窗口下首页操作、版本行和资源管理工具栏分行。全局控件焦点提示和减少动态效果覆盖同步补齐，静态不确定进度仍可见。原用户主题、自定义配色、启动动画及业务功能保留。

**1.0.36 验证**：318/318 测试、TypeScript 和生产构建通过；旧测试中强制要求原悬浮/弹簧/错落时间的断言已更新，保留功能与无障碍约束。新增 `scripts/verify-design-ui.cjs` 使用完整生产 renderer、隔离 IPC/用户目录及禁止联网的样例数据，检查宽窄窗口、导航/折叠焦点、减少动态效果、弹窗与5种内置主题，截图在 `out/design-ui-akUNyg/`。现有社区真实 Vue 筛选/分页验证通过（`out/community-ui-WyYKzc/`），实际页面拖入分流/版本目录验证通过（`out/resource-drop-ui-Mb0Puz/`）。最终日志 `out/tests-1.0.36-final.log`、`out/build-1.0.36.log`、`out/types-1.0.36.log`。

**1.0.36 已发布**：功能源码 master `a16109b` / main `5222ebf`，标签 `v1.0.36` 指向 `a16109b`；Release：https://github.com/kamubaba-i/KAMUCL/releases/tag/v1.0.36 （ID 386156260）。EXE 中文/空格路径启动通过，ZIP 内 app.asar 与已核验构建一致且包含最终样式。冷启动粒子首帧372ms / Electron入口4350ms，缓存启动288ms / 257ms，缓存标记不变（入口时间不等于完整页面就绪时间）；证据 `out/startup-1.0.36.log`。远端3附件逐一核对大小、SHA256和上传状态后才发布，latest确认为v1.0.36，误发v1.0.41仍未公开。EXE SHA256：`46ffaa014ee89b048d77126efbc319dd848247aa25f4699c382c9ff092d6b955`；ZIP SHA256：`e4db6ea841b9318c747fef9c55375915d643fd74e07b3d7a8b7aab3d674f0059`。

**1.0.31 本批修改**：两处 SkinViewer3D 共用取景半高从 18 调整到 20，默认人物缩小约 10%；键位捕获显示独立 X 清空为 key.keyboard.unknown（未指定），绕过全局鼠标捕获防止误录左键。默认配置新增材质包多文件拖入/选择、去重、优先级排序、移除和同步开关；导入即开启同步。材质包存储在 userData/default-resourcepacks；启动前复制到实际实例 resourcepacks，合并 options.txt 的启用/兼容确认列表，保留其他配置及原文件。移除配置后下次同步取消默认启用，已复制文件保留。

**v99.0.0 原因及处置**：实查 `C:/Users/ROG/AppData/Roaming/kamucl/pending-update.json`，版本 99.0.0，地址 `http://127.0.0.1:8310/download/KAMUCL-99.0.0.exe`。这是 scripts/mock-update-server.cjs 的模拟更新残留，并非 GitHub 最新版本；已将该记录原地备份为 `.rejected-test-20260910-064701`，保留包文件。正式版禁用测试环境变量覆盖，更新来源须与官方仓库/版本/资产名一致；检查缓存同样验证来源，无效待装记录隔离。开发测试须同时指定独立用户数据目录与模拟 API。

**1.0.31 多开修复**：后端原本已允许多会话，版本页被全局 launchState 禁用。现在按 folder+versionId 跟踪状态，只禁用本实例；IPC 状态事件带实例身份，最近游玩及退出同步使用事件自身目标，旧实例退出不覆盖其他实例状态/最近进程记录。未启动或终止用户游戏；并发状态和目录隔离以模拟会话验证。

**1.0.31 验证**：313/313 测试、TypeScript 检查和生产构建通过；新增真实 ZIP 导入、排序、去重、两个隔离目录及旧格式 options.txt 同步、移除/错误保护、未指定按键持久化、正式包测试缓存隔离及多实例状态测试。隔离 Electron 中实际鼠标点击 X、Esc、拖入多个文件及排序均通过；两种宽度的 WebGL 预览已截图核对。脚本 `scripts/verify-default-config-ui.cjs`，证据 `out/default-config-ui-XzZopM/`。

**1.0.31 版本更正**：本批功能与已验证的原 1.0.41 一致，仅将 package.json、package-lock.json 和内置日志更正为用户指定的 1.0.31。原 1.0.41 Release 已撤回为草稿，保留历史记录；1.0.31 已重新构建、打包并发布：https://github.com/kamubaba-i/KAMUCL/releases/tag/v1.0.31 。源码 master b9799c3 / main 601ab19，标签 v1.0.31 指向 b9799c3；313/313 测试、便携启动及 ZIP 内容核验通过，三份远端附件大小与 SHA256 均已核对，GitHub latest 确认为 v1.0.31。EXE SHA256：aaa47088761c0cda9873c9c7c2d74fb66038c3e687db0718634660e81a0c2d36；ZIP SHA256：eaa32cd6b31e57ec214b3284c8c95bc8e37f66dd7b411afdfcbd56003926df7f。已安装误发 1.0.41 的用户需要手动安装 1.0.31，因为正常更新比较不会自动降级。

**1.0.30 本批修复**：社区分类选中块的 watch 在 query 初始化前运行，导致没有订阅分类变化；现调整监听顺序并同时测量 left/top/width/height，支持连续切换和换行。资源包/光影包/数据包不再传 Fabric 等模组加载器条件；Modrinth 文件进一步按 minecraft、shader engine、datapack 类型区分，避免同一数据包项目的模组 JAR 混入。中文 Mod 别名搜索保留版本/加载器筛选，移除未筛选项目插入。卡片显式标注“来源：CurseForge”。三类资源改为每页 20 项和页码/总数，双源按各自总数交错分页，避免原 offset 计算跳项。

**1.0.30 验证**：新增 4 项后端回归测试，覆盖五类资源双源请求、文件兼容性、中文别名、两源数量不均/耗尽/空结果/单源失败及连续分页。`scripts/verify-community-ui.cjs` 在隔离 Electron 中挂载真实 Vue 页面，验证连续分类切换、换行、页码/末页/禁止滚动加载、筛选重置、旧请求丢弃与文件弹窗。`scripts/verify-community-browse.ts` 只读连接真实 Modrinth/CurseForge；26.2 两源四类搜索与首项文件均通过，Fresh Animations 返回 v1.10.5，VeinMiner 数据包返回 ZIP。308/308 测试、TypeScript 检查和生产构建通过；日志见 out/*1.0.30.log。

**1.0.30 已交付**：功能提交 master `a7a6911` / main `e82f2a9`，验证修订 master `55bc01b` / main `afb5e1d`，标签 `v1.0.30` 指向 `55bc01b`。Release：https://github.com/kamubaba-i/KAMUCL/releases/tag/v1.0.30 。EXE、ZIP、SHA256SUMS.txt 三份附件均已上传，GitHub 远端大小及 SHA256 与本地一致，标签与源码一致。便携 EXE 在中文和空格路径内启动通过；ZIP 内 app.asar 与已检查的程序一致，测试工具及临时工作区未打入成品。EXE SHA256：`ae07eb1af501ebe65c7ca5452254380079bb159e4b908861410e8d0a7106f76d`；ZIP SHA256：`984fb43a523837ee04652de0ba2af4746ef9644fc7b57cd78779e6650fa63c7f`。上传时 Node TLS 连接重置，已用系统 curl/Schannel 补传并独立复核全部附件。

**1.0.29 修复记录**：社区整合包压缩文件下载结束时曾将任务总进度置为 100%，后续安装又被 IPC 和前端的单调进度保护锁在 100%。现在压缩包占总进度 0–10%，后续安装映射到 10–100%；游戏本体安装完成只算子阶段完成，整合包文件和覆盖内容落盘后才发出最终完成事件。下载中心仅在任务成功终态显示 100%，运行/暂停状态不会四舍五入到 100%。以实际 mrpack 压缩包、4 个模组文件及 overrides 走本地 HTTP 下载和真实安装流程验证，同时验证本地导入；304/304 测试通过、构建通过。

**1.0.29 已交付**：源码 master `0967b37` / main `8307ef7`，标签 `v1.0.29` 指向 master 修复提交。Release：https://github.com/kamubaba-i/KAMUCL/releases/tag/v1.0.29 。EXE、ZIP、SHA256SUMS.txt 均已上传，远端大小和 SHA256 与本地一致；中文及空格路径下的便携启动验证通过。EXE SHA256：`30011ada7b5b376d1e95f0936c07860587f9296d36aad6f676a94cba1e64d878`；ZIP SHA256：`09df87a9a6291c81c74a0f3ed47b83b8ada6c1183d7a9f64a8301fde812213fd`。

**长期交付约定（用户最新授权）**：每批修改后默认完成版本递增、验证、打包，并将源码及对应 GitHub Release 更新到 `kamubaba-i/KAMUCL`；不再等待额外的打包/发布指令。项目根目录 `AGENTS.md` 保存此规则。

**上批交付 1.0.28**：包含下述 1.0.27 和 1.0.28 修复；源码 master `7dece4a` / main `f73a533`，标签 `v1.0.28` 指向 master 源码提交。Release：https://github.com/kamubaba-i/KAMUCL/releases/tag/v1.0.28 。EXE、ZIP、SHA256SUMS.txt 三份附件上传完成，GitHub 附件大小及 SHA256 均与本地一致；便携 EXE 在中文和空格路径内启动验证通过。打包范围限定 out/main、out/preload、out/renderer，排除测试夹具及验证脚本。302/302 测试通过。

**此前已交付版本 1.0.26**（master `5dcc9ef` / main `5c24feb` / Release 已发布）。测试 297/297。

**1.0.27 本地修复完成**：Fabric API 下载时实例隔离尚未开启，文件被写入共享 mods，随后 IPC 才开启隔离。现将隔离设置提前到下载前，移除目录解析失败时的共享目录兜底，并固定安装任务的目标文件夹。前端等待 API 列表就绪后才允许确认，支持失败重试，丢弃过期弹窗请求；完成通知等待 API 安装结束。300/300 测试通过，构建通过；真实下载 Fabric API 0.160.0+26.2（2,542,898 字节）至隔离测试实例 mods，SHA1 校验通过。游戏本体为测试夹具，未启动 Minecraft。新增验证脚本 `scripts/verify-fabric-api-install.ts`。

用户确认版本规则：每批修复递增版本尾号；1.0.27 修复随后随 1.0.28 一并交付，未单独发布 1.0.27。package.json、package-lock.json 根包版本与内置更新日志已同步到 1.0.28。

**1.0.28 本地修改**：三种联机方式共用的标题栏给介绍文字分配可收缩宽度，房间标识及“更换方式”按钮固定靠右；在 1120/960/760/450 像素宽度用 Electron 实际渲染验证三页右边缘一致、无横向溢出。VoxLink 两端共用默认名称“我的世界联机”，去掉首尾空格并校验空名称/32 字符上限。CONTENT_BLOCKED 显示可操作的字段提示并聚焦名称，保留用户输入，不自动更名重试；来源 client_tag 保持不变。服务端审核规则未知，尚未向线上服务器建房验证新默认名是否获准。302/302 测试及 1.0.28 构建通过。

**1.0.26 批次 4 项全部完成**：
1. ✅ 皮肤页空白回归：根因=1.0.25 加滑动块监听时用 `onUnmounted` 但 import 漏了它 → setup ReferenceError → 整页空白。已补导入+加「用到的组合式 API 必须全部导入」回归测试。
2. ✅ 双屏最大化溢出：根因=frame:false+thickFrame 真实最大化时 Windows 把不可见缩放边框（~7px/边）扩出工作区到相邻屏。已改「工作区假最大化」（windowState.ts: toggleMaximize/applyMaximized/normalizeRealMaximize，setBounds(workArea)，系统吸附自动收编）。**注意：未在真实双屏环境实测**，如用户反馈仍溢出需现场验证。
3. ✅ 模组禁用/启用：FileManager 模组页每行 .jar 增「禁用/启用」按钮 ↔ 主进程 fs:toggleDisable（改名 .jar.disabled，MC 原生不加载）；实例运行中主进程阻止（隔离查自身/共享目录查所有共享实例）。dev 实例实证禁用+还原往返成功。
4. ✅ Fabric API：安装弹窗联动 UI/列表/安装链路早已存在（基线 0.4.1 就有），实证可选 36 版本；真实缺陷=installFabricApi 固定写共享 mods，已改为跟随实例隔离状态（versions.ts 解析 instanceDirectoryState 传 modsDir）。

**当前停点**：1.0.35 已完成交付。VoxLink 新默认房间名是否通过线上审核仍未经线上建房验证。

---

## 2. 工程命令（全部验证过，PowerShell 环境注意）

```powershell
# 测试（npx 被本机 PS 策略阻止，用 node 直跑 tsx）
node node_modules/tsx/dist/cli.mjs --test tests/all.test.ts

# 构建（如辅助文件被占用，仅退出本任务启动的测试启动器；不要结束用户游戏/Java 进程）
node node_modules/electron-vite/bin/electron-vite.js build

# 打包（便携 exe + zip）
node node_modules/electron-builder/cli.js --win portable zip --config.electronDist=node_modules/electron/dist

# 便携路径验证
node scripts/verify-portable-path.cjs

# 发版（自动算 SHA256SUMS + 建 Release + 传 3 资产；认证走 git 凭据管理器）
node scripts/release-github.cjs
```

**版本号节奏**：每个批次 package.json +1，updateNotes.ts 加条目（`date: 'YYYY-MM-DD HH:mm'` 24 小时制）。

**Git 流程（卡慕新规）**：直接提交 master；main 用 sync-main 分支 cherry-pick 后 `push origin sync-main:main`。**永不合并/推送 wuhui 分支**。GitHub TLS 间歇被重置：直连失败时加 `-c http.proxy=http://127.0.0.1:7897`（Clash）或 `-c http.sslBackend=schannel` 重试。

**PowerShell 陷阱（本会话血泪）**：
- `Set-Content`/`Get-Content` 默认 GBK——读写含中文文件必用 `[System.IO.File]::ReadAllText/WriteAllText` 或 Read/Edit 工具
- PS 里 `$1`/`${}`/反引号会被吞——复杂替换一律写成临时 .cjs 脚本文件再 `node` 跑
- npm/npx 被策略阻止→用 `node node_modules/xxx/bin/...` 直跑

---

## 3. 验证工具链（全部入库可用）

| 工具 | 用途 |
|---|---|
| `scripts/cdp-eval.mjs "<js>"` | 运行中实例 CDP 求值（先用 `node_modules\electron\dist\electron.exe --remote-debugging-port=9222 .` 起实例） |
| `scripts/cdp-eval2.mjs <port> <exprfile>` | 带端口的 CDP 求值（表达式写文件避免引号地狱） |
| `scripts/cdp-shot.mjs out.png` | CDP 整页截图（不受遮挡窗口影响；WebGL 画布 canvas.toDataURL 不可用时用它） |
| `scripts/desktop-regression.cjs` | QA 隔离环境（需已装 vanilla 26.2） |
| `scripts/mock-update-server.cjs` | 自更新 mock（v99.0.0；`MOCK_ASSET_FILE=<真实exe>` 可做全链路实证） |

**E2E 实证过的全链路**（方法可复用）：沙盒目录放便携 exe + env `KAMUCL_UPDATE_API_BASE=mock` → 启动 → CDP 检查/下载 → `window:close` 优雅关闭 → 看 `%APPDATA%\kamucl\updater-last.log` 与沙盒目录文件变迁。

---

## 4. 架构地图（最近大改后的现状）

### 自更新（1.0.14 起，1.0.23 修复「只下载不安装」）
- `main/core/selfUpdate.ts`：GitHub Releases 检查（ETag+6h 缓存+限流静默+失败重试 1 次）
- `main/core/applyUpdate.ts`：下载（下载中心任务）→ SHA256 强制校验 → `pending-update.json` → before-quit 自动安装 → `spawnDetachedProcess`（**零句柄脱离 CreateProcessW**，gracefulClose.ts）旁路 PowerShell 脚本完成 备份→替换→重启→20s 存活观察→失败回滚；日志在 userData/updater-last.log
- 小白自动化：默认自动下载+关闭时自动安装；设置页有「自动安装更新」开关+回退+本地文件安装
- `shared/branding.ts`：QQ_GROUP_NUMBER 内测群号（弹窗常驻备用下载提示）

### 下载引擎（1.0.23 起单连接）
- `main/core/download.ts`：单连接 + .part 断点续传 + 慢速掐断换源 + 磁盘预检 + HTTP/2 共享连接（httpClient.ts）。**分块引擎已整体移除**（BUG-3 根因：Range 分块全卡死，实测 8 分块 20 秒零进度）

### 3D 皮肤预览（物晖重写 + 多轮修正）
- `components/SkinViewer3D.vue`：HMCL 部件/UV 骨骼；行走摆动=MC 原版公式（cos(limbSwing×0.6662)×1.4×amount，±45° 四肢同幅对角反相）；行走弹跳全移除（「走就走」）；披风 10×16×1 标准+180° 翻转挂背；-y 底面 UV 按 skinview3d 约定；俯仰=相机环绕（非模型翻倒）；按需渲染；slim 像素级检测（x=54 列全透明）
- 首页与皮肤页共用；披风由档案 active 披风决定（无开关）

### 联机（物晖多页化，1.0.25 移除玩家直连入口）
- `views/FriendConnectView.vue` + `components/connection/`：FRP（樱花）/VoxLink（房间码打洞）/陶瓦（Terracotta）三卡独立页+右滑渐入过渡
- 主进程直连能力保留（VoxLink 内部依赖），directConnect.ts/directProtocol.ts 别动

### 其他关键件
- `main/core/launch.ts`：启动链（CreateProcessW 脱离式游戏进程+运行状态持久化恢复+options.txt 键位同步 1.13+ 跳过旧版+CWD=实例游戏目录 1.0.24 实证）
- `main/core/java.ts`：全盘扫描+持久缓存+隐藏列表（**重扫自动解除磁盘上仍存在的隐藏项**，1.0.20）
- `shared/types.ts`：IPC 频道注册表+全部共享类型（Settings 含 memoryAuto/autoUpdate/updateSource/curseforgeApiKey/qqGroupNumber/configVersion/skipUpdateVersion）
- `shared/updateNotes.ts`：内置更新日志（版本倒序）
- 设计令牌（styles.css）：--space-1..7、--radius-sm/md/lg、--text-xs..2xl、--card-pad/--card-gap/--sec-gap、--ctl-h/--row-h
- 动效模式：导航水滴（nav-blob）/Tab 滑动块（game-tabs-blob/seg-blob/capsule-blob/runtime-blob）/错峰渐入（card-in/pick-card-in/server-row-in/community-card-in）/开关 0.4s ease-in-out
- 视图切换 Transition：`<Transition name="fade" mode="out-in" :duration="250">`（显式时长兜底——遮挡时 transitionend 不触发会卡死，1.0.18 实证修复）

---

## 5. 反馈闭环（内测群 → 腾讯文档 → AI）

- 桌面 `KamuclHelper.exe`（已解压到 Desktop\KamuclHelper\）：菜单 3 拉取 Bug+需求 → `data\ai_feed\feed.json`
- **注意**：主工具在 GBK 控制台打印 ⚠ 会崩（合并步前），两个分表 bug_feed.json/req_feed_limited.json 已生成，手工合并成 feed.json 即可
- 修完后 `KamuclMarkDone.exe --id BUG-3,BUG-5` 回写「修复完成，等待复测」
- 当前 feed 里的未修条目：BUG-4（1.12.2 按键同步=未支持数字键码）、BUG-7（启动器双击报错偶现）、BUG-8（服务器写入 servers.dat=**1.0.25 新增-1 已实现**）、BUG-10（CF 下载报错=**1.0.23/24 CF 官方通道已修**）；BUG-3/5/6/9 已修或已确认

---

## 6. 协作规约（卡慕定的）

1. **先取证再修**：复现/定位根因写清楚再动手，禁止盲改；根因不明就说「未查明」
2. 用户指令里的测试证据（「已确认复现」等）优先信；改完用 CDP/沙盒实证
3. 每批次独立版本号+独立 commit（或按要求合并一个 commit）；测试必须全绿才提交
4. 不再合并物晖的新分支；我的修改直接作为主分支更新（master 提交+main cherry-pick）
5. 弹窗文案与布局沿用现有设计语言（btn-gold 主/btn-ghost 次/btn-danger 危险/icon-btn 图标/menu-overlay+card 模态）
6. 新功能给小白用：能自动就自动，能少点就少点

---

## 7. 交接时的环境注意

- 本机有多台 KAMUCL 测试实例可能残留进程（electron/KAMUCL.exe），改代码前 `Get-Process electron,java,KAMUCL | Stop-Process -Force`
- GitHub 推送被本机网络间歇重置：多试几次或走代理/改 sslBackend
- 用户在用的游戏目录：`D:\Snapshot 2.2.10\.minecraft`（14 个版本实例）；默认目录 `%APPDATA%\.kamucl`
- 用户正登录微软正版 KaMuaMua（皮肤页/首页 3D 预览有真实皮肤+披风数据）

---

**下一位（Codex）从这开始**：当前无待办。接到新批次后：跑 `node node_modules/tsx/dist/cli.mjs --test tests/all.test.ts` 确认 297 全绿 → 干活 → 版本 +1 → 按第 2 节流程构建/打包/提交/推送/发版。

**Git 操作血泪教训（本次实操翻车记录）**：复合命令里 `git checkout master --quiet; git branch -D sync-main` 若 checkout 静默失败，后续 commit 会落到 sync-main 上；每步后务必 `git branch --show-current` 确认。**含中文文件绝不可用 PowerShell `Get-Content`/`Set-Content` 读写**（GBK 毁灭性乱码），一律用 Read/Edit 工具。


**1.0.32**：同版本允许重复运行，仅准备启动期间禁用按钮。每次启动分配 launchId，旧会话退出不会覆盖同版本新会话。默认配置/模组/资源包/光影包页面优先接管全局 capture 拖入，只执行一次页面导入，不触发整合包识别。资源管理按活动文件夹筛选版本，列表/打开/删除/禁用均显式传入文件夹；导入由主进程重新扫描并匹配 folder+id，再使用扫描得到的 gameDirectory 写入 mods/resourcepacks/shaderpacks。同名目标不覆盖，原文件保留。

**1.0.32 验证**：315/315 测试、TypeScript 和生产构建通过。新增目录隔离、共享目录、同名冲突和同版本并发状态测试；scripts/verify-resource-drop-ui.cjs 在隔离 Electron 中挂载真实 KeysView/FileManager 以及 App capture 处理器，验证默认配置只导入一次、三类资源分流、同名版本选中 B 文件夹、共享/隔离列表对应、整合包处理零触发。证据 out/resource-drop-ui-PDREEZ/result.json。未运行或停止用户游戏。

**1.0.32 已交付**：源码 master cc1666d / main b131bd9，标签 v1.0.32 指向 cc1666d。Release：https://github.com/kamubaba-i/KAMUCL/releases/tag/v1.0.32 。便携 EXE 中文空格路径启动通过；ZIP 与最终 app.asar 一致，主进程构建文件与包内一致。发布前已核对远端三附件大小、SHA256 和标签，发布后经认证 API 确认 latest 为 v1.0.32，误发 v1.0.41 仍为草稿。匿名 API 二次核验返回 403，认证核验正常。EXE SHA256：4d67d20c5eb5f721807a5621bea9a990127e14df7ddff706cdc5a9e81b419bc0；ZIP SHA256：af14410d29f190b891ae36be9ee1ab12fe532b6227ef1a988303aebd3a1ad85b。


**1.0.33 启动优化**：旧便携 NSIS 每次启动前解压、退出删除运行环境，导致无反馈数秒。现在 .onInit 先提取并启动小型 WinForms 粒子窗口（同一头像切片、透明且点击穿透、不抢焦点），Electron 粒子窗口显示后通过临时信号文件接替；父 wrapper 退出或超时也会关闭反馈窗口。运行环境存到 EXE 旁 KAMUCL-runtime/<version-buildhash>，哈希包含 main/preload/renderer 全部构建内容与锁文件；解压完成标记及核心文件存在时复用，命名互斥锁串行首次解压，不在退出时删除缓存，避免并发使用冲突。不同构建互不混用。

**1.0.33 日志时间**：当前日志精确到分钟；1.0.32 根据 GitHub published_at 2026-09-10T06:00:21Z 补为本地 2026-09-10 14:00。AGENTS.md 明确后续日志必须 YYYY-MM-DD HH:mm。

**1.0.33 验证**：317/317 测试、TypeScript、生产构建和便携中文空格路径启动通过；ZIP 与已核验的 app.asar 一致。实际便携包隔离测试：1.0.32 Electron 入口冷启动 3965ms / 再次启动 3508ms；1.0.33 粒子首帧冷启动 332ms / 缓存启动 216ms，Electron 入口分别 4419ms / 207ms。首次解压耗时仍在，但粒子覆盖等待；缓存启动复用证据为同一 cache.ready 修改时间不变。测量是本机到首帧绘制/Node 模式 Electron 入口，非完整主界面就绪时间，不代表所有硬件。脚本 scripts/verify-portable-startup.cjs，证据 out/startup-1.0.33.log 与 out/startup-baseline-1.0.32.json。

**1.0.33 已发布**：master eea1e5f / main 7ea70a7，标签 v1.0.33 指向 eea1e5f。Release：https://github.com/kamubaba-i/KAMUCL/releases/tag/v1.0.33 。发布前核对三附件大小及 SHA256、标签与源码一致；发布后认证 API 确认 latest 为 v1.0.33。EXE SHA256：f0937373f9787ec92843264d2a6146f7a1e54c251ad69a5371ca94ac1cc71acd；ZIP SHA256：56413645f49dca0d0edc3e78993e023458a83120d51b5f42e0657e8c197961ef。


**1.0.34 默认材质包启用修复**：旧 mergeResourcePackOptions 把全部默认包同时加入 resourcePacks 与 incompatibleResourcePacks。Minecraft 26.2 的 Options.loadSelectedResourcePacks 对实际兼容、但带兼容性覆盖的包，移除覆盖标记后直接 continue，导致本次未调用选中；游戏日志中 Fullbright 出现同样信息。现在读取实际客户端 JAR/version.json 的 resource pack major/minor，与 pack.mcmeta 的 min/max_format（65+）、supported_formats（18+）或旧 pack_format 比较，仅真正不兼容的默认包加入覆盖列表，清除旧版默认包错误标记，所有默认包保留启用/优先级列表。玩家其他包和覆盖保留，未知客户端格式不猜测覆盖。

**1.0.34 验证**：318/318 测试、TypeScript 和生产构建通过；新增 Fullbright 元数据回归、旧标记清除、重复启动幂等、格式区间/次版本边界、旧格式兼容测试。另在隔离 Java 进程直接调用本地原版26.2 Options.loadSelectedResourcePacks，mock PackRepository：旧标记不选中，清除标记后选中，PASS；未启动/停止用户游戏，也未改用户 options.txt。证据 out/pack-proof-1.0.34.log、out/PackSelectionProof.java。新格式官方说明：https://www.minecraft.net/en-us/article/minecraft-java-edition-1-21-9 。

**1.0.34 已发布**：master 022eebc / main afcff9d，标签 v1.0.34 指向 022eebc。Release：https://github.com/kamubaba-i/KAMUCL/releases/tag/v1.0.34 。便携 EXE 中文空格路径启动、ZIP 内容核验通过；远端三附件大小、SHA256、源码标签核对通过，认证 API 确认 latest 为 v1.0.34。EXE SHA256：42e835ee282ab062fd4d484cd04198866b77e47b7de662c919e49082e942dafb；ZIP SHA256：b5673cc3434b0001781918bad45e855225b015a5447acfbf164d6bf4e0e1a156。


**1.0.35 启动体验统一**：旧便携前段色键透明 WinForms 粒子与 Electron 后段随机粒子独立绘制，切换时重播、位置和运动跳变。现在保留同一个 native StartupFeedback 窗口，完整覆盖解压、真实初始化进度、620ms 汇聚、2000ms 头像停留和 320ms 淡出。采用 UpdateLayeredWindow + 逐像素 premultiplied alpha、高清 DPI、与原动画一致的缓动/旋转/浮动、轻阴影与统一半透明提示卡；主窗口 260ms 平滑淡入。nativeStartup.ts 等实际主界面 ready-to-show 和 renderer-ready 后才通知原粒子汇聚，仅原窗口发出 assembled 后显示主界面。原生不可用时回退 Electron 动画；辅助窗口意外退出也不阻塞主界面显示。减少动态效果用户跳过汇聚/停留。

**1.0.35 验证**：318/318 测试、TypeScript 和生产构建通过。scripts/verify-unified-startup.cjs 用真实原生窗口 + Electron 控制器和隔离主页面验证：主界面仅绘制时不会提前揭示；renderer-ready 后约2666ms 完成汇聚/停留，单一 native PID 贯穿全过程，Electron 只有一个主窗口，最终透明度1，粒子正常退出。本机辅助窗口首帧187ms。证据 out/unified-startup-lud2UL/result.json；已查看早期和完成帧 out/startup-quality-1035-final/*.png。无需开启用户游戏或改动用户设置。

**1.0.35 已发布**：master 55b5b56 / main 213a244，标签 v1.0.35 指向55b5b56。Release：https://github.com/kamubaba-i/KAMUCL/releases/tag/v1.0.35 。最终便携 EXE 中文空格路径启动通过，ZIP 内容与核验 app.asar 一致；冷启动粒子首帧375ms / Electron入口4665ms，缓存启动265ms / 212ms（Node入口，不代表完整主界面就绪）；缓存标记不变，证据 out/startup-1.0.35.log。远端三附件大小、SHA256、源码标签一致，认证API确认latest为v1.0.35。EXE SHA256：19d3561010c1c2a005c19b5f79d427b0956c8079f949416e3820f045c41926ca；ZIP SHA256：e56b96dab3266ddf452b9622020ba2ad26ddc5fb59c7d33f64f50e7b689d9dac。
