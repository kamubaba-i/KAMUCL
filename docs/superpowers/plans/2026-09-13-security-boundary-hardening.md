# 安全边界加固实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 KAMUCL 在文件目录边界、归档解压、下载重定向和敏感日志方面的可复用安全缺陷，并补充回归测试。

**Architecture:** 在 `src/main/core/security.ts` 集中实现目录包含、归档条目和日志脱敏的纯函数；在 `ipc.ts`、下载重定向和归档写入路径调用这些函数。保留现有业务 API，不新增依赖，不改变公开协议。

**Tech Stack:** TypeScript、Node.js `path`/`fs`、Electron、现有 `tsx --test` 测试体系。

**Spec:** `docs/superpowers/specs/2026-09-13-security-boundary-hardening-design.zh-CN.md`

## Global Constraints

- 不新增 npm 依赖。
- 不修改版本号、发布元数据或发布 Release。
- 不改变现有合法游戏目录、下载和更新流程。
- 所有生产代码修改先有失败回归测试。
- 不提交 `node_modules/`、`out/`、`release/` 或个人配置。

---

### Task 1: 建立安全辅助函数与目录边界测试

**Files:**
- Create: `src/main/core/security.ts`
- Create: `tests/security-boundary.test.ts`
- Modify: `src/main/ipc.ts`

- [ ] **Step 1: 写失败测试**

覆盖 `isPathContained(base, candidate)` 的兄弟目录前缀、`..`、合法子路径和已存在符号链接祖先；覆盖归档条目规范化的绝对路径、盘符、穿越和合法嵌套路径。

- [ ] **Step 2: 运行测试确认失败**

Run: `npx tsx --test tests/security-boundary.test.ts`

Expected: FAIL，因为 `src/main/core/security.ts` 尚不存在。

- [ ] **Step 3: 实现最小安全辅助函数**

导出：

```ts
export function isPathContained(base: string, candidate: string, allowEqual?: boolean): boolean
export function safeArchivePath(entryName: string): string
export function resolveContainedPath(base: string, relative: string): string
```

使用 `path.relative` 判断边界；对现有路径和祖先使用 `realpath`，拒绝符号链接逃逸；归档路径拒绝 NUL、绝对路径、盘符和 `..`。

- [ ] **Step 4: 让 `safeDir` 使用共享函数**

删除 `startsWith` 判断，保留现有支持的相对路径层级限制，并用 `resolveContainedPath` 验证最终目录。

- [ ] **Step 5: 运行测试确认通过**

Run: `npx tsx --test tests/security-boundary.test.ts`

Expected: PASS。

- [ ] **Step 6: 提交**

```powershell
git add src/main/core/security.ts src/main/ipc.ts tests/security-boundary.test.ts
git commit -m "fix(ipc): 加固文件目录边界校验"
```

### Task 2: 统一安全归档解压路径

**Files:**
- Modify: `src/main/core/worlds.ts`
- Modify: `src/main/core/modpacks.ts`
- Modify: `src/main/core/java.ts`
- Modify: `src/main/core/launch.ts`
- Modify: `src/main/core/security.ts`
- Modify: `tests/security-boundary.test.ts`

- [ ] **Step 1: 写失败测试**

新增真实 ZIP fixture，验证含 `../escape.txt`、`C:/escape.txt` 和 `/escape.txt` 的归档被拒绝或跳过；验证普通嵌套文件仍写入目标目录，目标目录外没有文件。

- [ ] **Step 2: 运行测试确认失败**

Run: `npx tsx --test tests/security-boundary.test.ts`

Expected: FAIL，至少一个现有解压路径接受不安全条目。

- [ ] **Step 3: 实现统一条目目标解析**

所有实际写文件的归档路径先通过 `safeArchivePath` 和 `resolveContainedPath`；`modpacks.ts` 的手写 `safeJoin` 与 `worlds.ts` 的重复规范化统一复用共享函数；拒绝目录项之外的符号链接条目；保留现有大小和压缩比限制。只读归档元数据的 `commandWorld.ts` 和 `defaultResourcePacks.ts` 不做无关改动。

- [ ] **Step 4: 运行相关测试**

Run: `npx tsx --test tests/security-boundary.test.ts tests/world-import.test.ts tests/resource-network-1046.test.ts`

Expected: PASS。

- [ ] **Step 5: 提交**

```powershell
git add src/main/core tests/security-boundary.test.ts
git commit -m "fix(network): 防止归档解压路径穿越"
```

### Task 3: 收紧下载重定向与凭据边界

**Files:**
- Modify: `src/main/core/downloadFetch.ts`
- Create: `tests/download-security.test.ts`

- [ ] **Step 1: 写失败测试**

验证同源 HTTPS 重定向可保留必要请求头；跨源重定向删除 `authorization`、`cookie`、`x-api-key` 等来源凭据；HTTPS 到 HTTP、非 HTTP(S) 和超过最大跳转次数被拒绝。

- [ ] **Step 2: 运行测试确认失败**

Run: `npx tsx --test tests/download-security.test.ts`

Expected: FAIL，因为现有实现会在重定向时复制所有 `init.headers`。

- [ ] **Step 3: 实现最小重定向策略**

按 URL origin 比较重定向前后地址；跨源时删除认证、Cookie、API key 和代理认证头；保留公开的 `Accept`、`Range` 等请求头。

- [ ] **Step 4: 运行测试确认通过**

Run: `npx tsx --test tests/download-security.test.ts tests/download-reliability-1075.test.ts`

Expected: PASS。

- [ ] **Step 5: 提交**

```powershell
git add src/main/core/downloadFetch.ts tests/download-security.test.ts
git commit -m "fix(network): 防止下载重定向泄露凭据"
```

### Task 4: 增加敏感日志脱敏并接入 IPC 错误边界

**Files:**
- Modify: `src/main/core/security.ts`
- Modify: `src/main/ipc.ts`
- Modify: `src/main/core/launcherLog.ts`
- Create: `tests/security-redaction.test.ts`

- [ ] **Step 1: 写失败测试**

验证 Bearer token、`password`、`token`、`api_key`、Cookie 和 URL 查询参数中的敏感值被替换，同时保留错误类型和非敏感上下文。

- [ ] **Step 2: 运行测试确认失败**

Run: `npx tsx --test tests/security-redaction.test.ts`

Expected: FAIL，因为脱敏函数尚不存在。

- [ ] **Step 3: 实现 `redactSensitiveText`**

使用有限、明确的正则规则处理常见凭据格式；对未知错误不做过度修改，避免破坏正常诊断信息。

- [ ] **Step 4: 接入主进程错误日志和启动日志**

在 IPC 包装器和日志写入前调用脱敏函数；不改变发送给用户的普通错误文本，只防止凭据进入持久化日志。

- [ ] **Step 5: 运行测试确认通过**

Run: `npx tsx --test tests/security-redaction.test.ts tests/diagnostics.test.ts tests/launcher-log.test.ts`

Expected: PASS。

- [ ] **Step 6: 提交**

```powershell
git add src/main/core/security.ts src/main/ipc.ts src/main/core/launcherLog.ts tests/security-redaction.test.ts
git commit -m "fix(ipc): 脱敏主进程敏感错误日志"
```

### Task 5: 全量验证与 PR 材料

**Files:**
- Modify: `docs/CONTRIBUTING.md` only if the final behavior changes require documentation
- Modify: `docs/DEVELOPMENT.md` only if a new security helper contract needs documenting

- [ ] **Step 1: 检查差异**

Run: `git diff --check`

- [ ] **Step 2: 类型检查**

Run: `npx tsc --noEmit`

- [ ] **Step 3: 运行完整测试**

Run: `npm test`

- [ ] **Step 4: 构建**

Run: `npm run build`

- [ ] **Step 5: 检查工作区**

Run: `git status --short`

确认没有生成物或个人配置进入差异。

- [ ] **Step 6: 整理 PR 描述**

按 `docs/CONTRIBUTING.md` 的格式说明安全影响、实现范围、测试结果和兼容性；不推送上游 `main`，只提供功能分支和 PR 所需提交。
