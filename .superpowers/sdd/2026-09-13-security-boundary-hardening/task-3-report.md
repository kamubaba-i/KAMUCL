# Task 3：收紧下载重定向与凭据边界

时间：2026-09-13 23:32（Asia/Shanghai）

## 实现内容

- `downloadFetch` 继续使用手动重定向，并保留 HTTPS 到 HTTP 降级、非 HTTP(S) 地址和超过 10 跳的拒绝逻辑。
- 使用重定向前后的 URL `origin` 判断跨源跳转。
- 同源 HTTPS 重定向保留原有请求头，包括 `Accept`、`Range` 以及必要凭据头。
- 跨源重定向后，从后续请求中大小写不敏感地移除 `authorization`、`cookie`、`x-api-key` 和 `proxy-authorization`。
- CurseForge 请求仍在每一跳重新计算 `x-api-key`；重算只替换该头，不误删同源请求的其他头。
- 未改动现有系统代理参数透传、网络客户端或其他下载架构。

## 修改文件

- `src/main/core/downloadFetch.ts`
- `tests/download-security.test.ts`

## TDD 验证

### RED

命令：

```powershell
npx tsx --test tests/download-security.test.ts
```

关键输出：

```text
tests 5
pass 4
fail 1
cross-origin redirects remove source credentials but retain public download headers
```

失败原因是原实现把全部 `init.headers` 复制到跨源重定向请求，实际仍带有 `Authorization`、`cookie`、`X-API-Key` 和 `Proxy-Authorization`。

实现最小修正后，为防止 CurseForge key 重算误删同源凭据，又增加了一个回归测试并再次确认 RED：

```text
tests 6
pass 5
fail 1
same-origin CurseForge redirects retain credentials while refreshing the application key
```

### GREEN

命令：

```powershell
npx tsx --test tests/download-security.test.ts tests/download-reliability-1075.test.ts
```

关键输出：

```text
tests 11
pass 11
fail 0
cancelled 0
skipped 0
todo 0
```

覆盖内容包括同源请求头保留、同源 CurseForge key 重算、跨源凭据删除与公开头保留、HTTPS 降级拒绝、非 HTTP(S) 拒绝和跳转次数上限；原有下载可靠性测试也全部通过。

## 自检

- `git diff --check`：通过。
- 修改范围：实现文件、Task 3 安全测试和本报告；未修改版本号、`package-lock.json`、发布配置或其他 Task 文件。
- `npx tsc --noEmit`：未通过，失败位于既存 `src/main/ipc.ts:1002`，错误为 `string | Promise<string>` 不能赋给 `string`；与本次两个文件无关，未越界修复。
- 未运行打包/发布流程，因本任务明确要求只修改 Task 3 文件且禁止修改版本/发布配置。

## 风险

- 本次凭据识别覆盖 brief 指定的四类请求头，并采用大小写不敏感匹配；其他未列出的自定义凭据头不会被自动识别，若未来引入新的敏感头需要同步扩展集合。
- 完整 TypeScript 检查仍受既存 `src/main/ipc.ts:1002` 错误影响；本任务范围内的指定测试已通过。
