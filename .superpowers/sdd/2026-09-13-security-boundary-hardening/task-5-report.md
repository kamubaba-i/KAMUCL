# Task 5 最终验证报告

## 范围

- 分支：`codex/security-boundary-hardening-work`
- 基线：`e397f1a400fcd83cc12384e29215d89dc435ca34`
- 本次代码改动：`src/main/core/security.ts`
- 未修改版本、依赖、发布配置或 Task 1-4 的安全行为。
- 未修改文档；本次只是内部 TypeScript 同步/异步 resolver 契约兼容。

## RED / GREEN

### RED

命令：`npx tsc --noEmit`

结果：退出码 `1`。

```text
src/main/ipc.ts(1013,7): error TS2345: Argument of type
'(base: string, parts: string[], isVersionPath: boolean) => string | Promise<string>'
is not assignable to parameter of type 'SafeDirPathResolver'.
Type 'string | Promise<string>' is not assignable to type 'string'.
Type 'Promise<string>' is not assignable to type 'string'.
```

根因是 `resolveSafeDirPath` 只声明同步 resolver，而 IPC 的资源目录 resolver 使用异步 `resolveResourceDirectory`。

### GREEN

最小修复：为 `resolveSafeDirPath` 增加同步和异步重载。同步调用仍返回 `string`；传入异步 resolver 时返回 `Promise<string>`。实现体只扩展返回类型，没有改变目录分段、`..`、长度或 contained-path 校验。

命令：`npx tsc --noEmit`

结果：退出码 `0`，无输出。

## 验证结果

- `git diff --check`：退出码 `0`。仅有 Git 关于 LF/CRLF 的提示，无空白错误。
- `npm test`：退出码 `0`；`436` 个测试通过，`0` 失败，`0` 取消，`0` 跳过。
- `npm run build`：退出码 `1`。Vite 已转换 `406` 个模块并生成 main/renderer 输出，随后在项目既有的 bundle close hook 处失败：

```text
Error: [kamucl] bridge/dist/kamucl-bridge-1.0.1.jar missing;
run node scripts/build-bridge.cjs
```

检查确认 `bridge/dist/kamucl-bridge-1.0.1.jar` 不存在。该错误发生在本次 TypeScript 改动之外，不能归因于本任务代码；未伪造构建通过，也未生成或宣称生成 EXE、ZIP、SHA256SUMS。

## 工作区状态

验证和提交前的 `git status --short`：

```text
 M docs/superpowers/plans/2026-09-13-security-boundary-hardening.md
 M src/main/core/security.ts
```

计划文件的修改在本任务开始前已存在，未覆盖、未纳入本任务提交。`out/` 等构建输出未进入 Git 状态。

## PR 材料

标题：`fix(ipc): support async safe directory resolver`

原因：IPC 文件目录处理已使用异步资源目录解析，但共享安全 helper 的类型仍只接受同步 resolver，导致全量 TypeScript 检查失败。

方案：使用最小同步/异步重载保持既有同步安全调用兼容，并让 IPC 的异步 resolver 类型安全地返回 Promise；路径安全校验逻辑保持不变。

安全影响：没有放宽目录边界，也没有改变 `..`、驱动器相对路径、路径长度或 contained-path 检查；只修复类型契约，使异步资源目录解析可以被 IPC 的 async `safeDir` 正确等待。

兼容性：无版本、依赖、配置、存档或 IPC 数据格式迁移；现有同步安全测试继续通过。

验证：类型检查 GREEN；全量测试 `436/436` 通过；构建受缺失 bridge JAR 环境材料阻断。

## 环境限制

- 本次所有命令均在指定 worktree 执行，未操作主工作区，未派生代理。
- 未关闭或影响其它游戏进程。
- 依赖无需额外下载；未改变系统代理配置。
- 因缺失 `bridge/dist/kamucl-bridge-1.0.1.jar`，无法完成 Windows 便携 EXE、ZIP 和 SHA256 校验；应先按项目要求生成该 bridge artifact 后重新执行构建与打包验证。

报告记录时间：本机本地时间 `2026-09-14 01:06`。
