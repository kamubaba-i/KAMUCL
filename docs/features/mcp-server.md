# MCP / AI 接入（mcp-server）

KAMUCL 内置 **MCP（Model Context Protocol）Host API**，让本机的 AI 客户端（Kimi Code、Claude Desktop 等）可以：

- 查看实例列表、启动状态、实时/历史日志、崩溃报告与结构化诊断
- 启动、停止游戏实例（走完整启动管线：Java 检测、参数拼装、账号刷新）
- 通过 KAMUCL Bridge 读取与热修改 MOD 参数
- **游戏内控制**：读取玩家状态（坐标/血量/视角）、帧缓冲画面截图、确定性键鼠输入、聊天与命令执行——AI 可以"看着状态与画面"玩 MC

游戏内控制由 **KAMUCL 控制模组**（kamucl-control，Fabric）提供：输入走游戏自己的键盘回调/界面交互/按键绑定/网络处理器，**不接触系统真实键鼠、不需要任何系统权限、不受窗口遮挡影响**，且同一 jar 在 Windows / macOS / Linux 通用。

## 快速接入

sidecar 脚本是零依赖 Node 程序（Node ≥ 18，无 npm install），在你的 AI 客户端里注册：

### Kimi Code

```bash
kimi mcp add kamucl -- node /绝对路径/KAMUCL/mcp/server.mjs
```

或在 `config.toml` 的 MCP 配置中加入等价条目（command = `node`，args = `["/绝对路径/KAMUCL/mcp/server.mjs"]`）。

### Claude Desktop

在 `claude_desktop_config.json` 中加入：

```json
{
  "mcpServers": {
    "kamucl": {
      "command": "node",
      "args": ["C:\\path\\to\\KAMUCL\\mcp\\server.mjs"]
    }
  }
}
```

注册后**保持 KAMUCL 启动器运行**，AI 即可发现全部工具。启动器重启无需重新注册（sidecar 每次调用自动重新发现端口与令牌）。

## 工具一览

| 工具 | 作用 |
| --- | --- |
| `launcher_status` | 启动器在线状态、版本、运行中游戏概览 |
| `list_instances` | 实例列表（MC 版本/加载器/目录/运行标记） |
| `get_launch_state` | 启动状态机、最近启动上下文（pid/日志目录/退出码）、运行中会话、近期退出记录 |
| `logs_tail` | 日志尾部读取（session/stdout/stderr/game 四种来源，支持 offset 增量拉取） |
| `list_crash_reports` / `read_crash_report` | 崩溃报告列表与内容 |
| `diagnose_instance` | 结构化体检：Java 兼容性、文件完整性、日志规则诊断 |
| `launch_game` / `stop_game` | 启动（可选直达服务器）/ 停止（先正常关闭，可确认强杀；多开可指定实例） |
| `bridge_status` / `bridge_params` / `bridge_set` / `bridge_reset` | KAMUCL Bridge MOD 参数面板（需实例装有桥接 MOD） |
| `install_control_mod` | 为实例安装控制模组（可重复安装，已安装则跳过；需 Fabric + 受支持版本） |
| `game_state` | 玩家状态：名称/坐标/视角/血量/饥饿/模式/世界/当前界面 |
| `game_screenshot` | 帧缓冲画面（PNG 图片，含界面与 HUD） |
| `game_input` | 确定性输入：key/mouseButton/click/move/scroll/type/chat/exec/look/lookDelta/wait |

## 游戏内控制（kamucl-control MOD）

- **运行条件**：实例为 Fabric 加载器且游戏版本受支持（当前首批：**1.21.1**），并已安装控制模组（`install_control_mod` 一键安装，或启动器 MOD 面板安装，会与参数桥接 MOD 一并装入）。
- **跨平台**：单一 jar 通用于 Windows / macOS / Linux，无任何系统权限要求。
- **能力边界**：
  - 截图读主帧缓冲：标题界面、世界内、物品栏界面都能截，窗口被遮挡/最小化也不受影响（最小化时部分驱动会暂停渲染，画面可能静止）。
  - `key`（W/SPACE/RETURN/ESCAPE/T/E/LSHIFT/F3…）走游戏键盘回调，对界面与世界同样有效。
  - `mouseButton` / `click`：世界内映射为攻击（left）/使用（right）/选取方块（middle）按键绑定；打开界面时按截图像素坐标点击。
  - `chat` / `exec`：直接经网络处理器发送，不经聊天框 UI，100% 确定。
  - `look` / `lookDelta`：绝对/相对视角，替代鼠标移动。
  - `type`：向当前打开的界面（聊天框、铁砧、书与笔…）逐字符输入。

## 典型用法

### MOD 开发调试闭环

1. `list_instances` 选择开发实例 → `launch_game` 启动
2. `get_launch_state` 轮询到 `running`，或 `error` 时 `logs_tail` / `read_crash_report` 取因
3. `diagnose_instance` 拿结构化结论（Java 版本/内存/模组依赖/显卡）
4. 改完 MOD 重新构建放入 mods 后再次 `launch_game`

### AI 玩 MC

1. `install_control_mod` 为 Fabric 1.21.1 实例安装控制模组 → `launch_game` 启动并等待 `running`
2. 循环：`game_state` 读坐标/血量/视角 → `game_screenshot` 看画面 → `game_input` 执行动作
   - 移动：`{type:'key', key:'W', mode:'down'}` … `{type:'key', key:'W', mode:'up'}`
   - 转向：`{type:'look', yaw:90, pitch:0}` 或 `{type:'lookDelta', dx:30, dy:0}`
   - 挖掘/攻击：`{type:'mouseButton', button:'left', mode:'down'}` … `mode:'up'`
   - 命令：`{type:'exec', command:'/gamemode creative'}`；聊天：`{type:'chat', text:'你好'}`
3. 结束时 `stop_game`

提示：把 `game_input` 的多个动作合进一次调用（上限 32 个）比逐条发送更连贯；动作之间可用 `{type:'wait', ms}` 留白。

## 多开（同时运行多个实例）

- 每个实例的游戏目录有独立的控制服务发现文件（`.kamucl-control.json`），`game_state` / `game_screenshot` / `game_input` / `stop_game` 均接受 `versionId` 按实例寻址；省略时作用于最近启动的游戏。
- `get_launch_state` 的 `runningGames` 列出全部运行中会话（版本 id + pid）。
- 会话日志（source=session/stdout/stderr）按 `versionId` 回溯该实例最近一次启动的日志目录。
- 同一实例同时多开时，控制寻址作用于该实例最近写入发现文件的会话。

## 安全模型与边界

- **仅本机**：Host API 只监听 127.0.0.1 随机端口；一次性 token 写在 `用户数据目录/mcp-server.json`（0600 权限）。本机可读该文件即视为授权——与 KAMUCL Bridge 同一模型，请勿把发现文件发给他人。控制模组 与启动器之间同样使用 127.0.0.1 + 独立 token（游戏目录 `.kamucl-control.json`）。
- **脱敏**：日志与崩溃报告输出前一律经过账号 token、认证头、用户目录脱敏。
- **输入边界**：`game_input` 只在游戏进程内产生确定性事件，不移动系统真实鼠标、不需要辅助功能/屏幕录制权限；聊天与命令以玩家身份发送，后果与手输一致（服务器反作弊视角下同属正常聊天/命令）。
- **停止保护**：`stop_game` 默认走正常关闭（等待存档保存），超时返回 `requiresForce`，须把 `forceToken` 原样传回才会强杀。
- **进程边界**：截图/输入只允许作用于本启动器启动的游戏实例（发现文件与进程存活双重校验）。
- **关闭 MCP**：在启动器 `settings.json` 中加入 `"mcpEnabled": false`（下次启动生效）；删除该键或设为 true 恢复。卸载实例 mods 目录下的 `kamucl-control-*.jar` 即可移除游戏内能力。

## 故障排查

- AI 提示"启动器未运行"：确认 KAMUCL 正在运行，且 userData 下存在 `mcp-server.json`（Windows 通常为 `%APPDATA%\KAMUCL\mcp-server.json`）。
- AI 提示"实例未安装控制模组"：确认实例是 Fabric 加载器且版本受支持（`install_control_mod` 会给出当前支持清单），安装后需重启游戏。
- sidecar 本身的问题会以 `[kamucl-mcp]` 前缀输出到其 stderr（多数客户端可在 MCP 日志中查看）。
- 启动器侧的运行记录见启动器日志（`logs/launcher-current.log`，`mcp` 作用域）；控制模组 在游戏日志中以 `[KAMUCL Control]` 前缀输出。

## 开发者：构建控制模组

```bash
node scripts/build-control.cjs   # 经 control/gradlew 构建并暂存到 control/dist/
```

控制模组 使用 Fabric Loom 标准工具链（`control/build.gradle`，MC 1.21.1 + yarn + loader 0.16.9）；Gradle wrapper 发行版以 SHA-256 钉死。新增 MC 版本时：调整 `control/build.gradle` 的依赖与 `archivesName`，并在 `src/main/core/controlBridgeCore.ts` 的 `CONTROL_BUILDS` 登记。
