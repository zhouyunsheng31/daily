# 搜索 API 状态可视化（2026-08-17）

管理后台查看搜索 API 的健康状况：各引擎调用次数 / 成功率 / 平均耗时 / 失败样例。

## 1. 搜索链路侦察结论

| 引擎 | provider | 工具 | 上游 API | Key |
|---|---|---|---|---|
| 秘塔搜索 | `metaso` | `web_search` / `read_webpage` | `https://metaso.cn/api/v1/search` / `/api/v1/reader` | `searchKey.metaso`（ai_settings） |
| 学术搜索 | `arxiv` | `academic_search` | `https://export.arxiv.org/api/query` | 无需 Key |
| GitHub 搜索 | `github` | `github_search` | `https://api.github.com` | 可选 PAT（`searchKey.github`），无 token 60 req/hour |

- **Bocha / Semantic Scholar 已下线**：schema 仅剩清理残留 Key 的迁移（`DELETE FROM ai_settings WHERE key IN ('searchKey.bocha', ...)`），searches API 不支持 Bocha。
- 调用链：`webos.ts`(SSE chat) / `piBridge.ts`(画布 WS) → pi 会话 customTools（`searchTools`）→ `searchApi.ts`（callMetaso / callArxiv / callGitHub）→ `logApiUsage` 写 `api_usage_log`。
- 已有记录表：`api_usage_log`（生产 SQLite，165+ 条），原本只有 provider/endpoint/count/latency_ms/status/error_msg/created_at/credits_consumed，**缺 用户/query/来源 三列**，本次补齐。

## 2. 落库设计

`api_usage_log` 新增三列（可空，兼容旧记录；PG 与 SQLite 双 schema 同步）：

| 列 | 类型 | 含义 |
|---|---|---|
| `user_key` | VARCHAR(128) | 调用方：`user:<id>` / `guest:<deviceId>`（webOS 会话 = principal.key）；`panel:<panelId>`（画布会话） |
| `query` | TEXT | 搜索关键词（read_webpage 为 URL；github_search 为 query 或 owner/repo） |
| `tool` | VARCHAR(64) | 来源工具：`web_search` / `read_webpage` / `academic_search` / `github_search` |

写入点：搜索工具 execute 成功/失败两条路径都写（保持原有 logApiUsage 语义）。
用户上下文通过 `AsyncLocalStorage` 传递：`piBridge.ts` 在 `session.prompt` 外层设置（webOS 会话 scope；画布会话 panelId），搜索工具内 `getSearchUserKey()` 读取。

## 3. 后端 API

`GET /api/admin/webos/search-stats?days=7`（requireAdmin 保护，days 1-90，默认 7）：

```jsonc
{
  "days": 7, "since": 1786358856294,
  "total": { "calls", "ok", "failed", "successRate", "avgLatencyMs", "avgOkLatencyMs", "creditsConsumed" },
  "byEngine": [ { "provider", "displayName", "calls", "ok", "failed", "successRate", "avgLatencyMs", "creditsConsumed", "lastCallAt" } ],
  "byTool":   [ { "tool", "calls", "ok", "failed", "successRate" } ],
  "byDay":    [ { "day", "calls", "ok", "failed" } ],
  "byUser":   [ { "userKey", "calls", "ok", "failed" } ],   // TOP，仅新记录有 user_key
  "failures": [ { "createdAt", "provider", "tool", "userKey", "query", "endpoint", "latencyMs", "errorMsg" } ] // 最近 20 条失败样例
}
```

## 4. 修改文件清单

后端（涉及 6 个文件，未动 `webos.ts` 冻结文件）：
- `server/src/db/schema.ts` — PG：CREATE TABLE 新列 + 幂等 ALTER + `idx_api_usage_log_tool_time`
- `server/src/db/schema-sqlite.ts` — SQLite（生产）：`addColumnIfNotExists` 新列 + 索引
- `server/src/db/apiUsageLog.ts` — `ApiUsageLogEntry` 新字段 + INSERT 扩展
- `server/src/utils/searchTools.ts` — `withSearchUser`/`getSearchUserKey`（AsyncLocalStorage）+ 4 个工具落库 user/query/tool
- `server/src/piBridge.ts` — `handleUserMessage` 外层套 `withSearchUser(panel:<panelId>)`；`createWebosSession` 包装 session.prompt 使每次 prompt 处于 `withSearchUser(scope)`（scope=principal.key，无需改 webos.ts）
- `server/src/routes/adminWebos.ts` — 新增 `GET /search-stats`

前端（client/admin-web）：
- `src/api.ts` — SearchStats 类型 + `api.searchStats(days)`
- `src/App.tsx` — 新「搜索 API」tab + `SearchView` 组件（汇总卡片 / 各引擎表 / 每日趋势 / 用户 TOP / 失败样例）

## 5. 验证方法

本地：
- 服务端类型检查：`cd server && npx tsc --noEmit`
- SQLite 集成测试：`DB_DRIVER=sqlite SQLITE_PATH=/tmp/x.db npx tsx tmp-test-search-stats.ts`（新列迁移/幂等/写入/聚合/老数据兼容全绿）
- 前端构建：`cd client/admin-web && npm run build`

线上（154.64.249.172，pm2 daily-server，SQLite 模式）：
1. 部署 6 个后端文件 + `pm2 restart daily-server`，启动日志出现 `[Schema] Added column api_usage_log.user_key/query/tool`
2. 管理员 JWT 验证：`curl -H "Cookie: access_token=<admin-jwt>" http://localhost:3456/api/admin/webos/search-stats?days=7` 返回各引擎统计
3. 触发真实搜索：`POST /webos/api/chat/stream` 让 AI 调用 web_search → 查库确认新记录带 `user_key=user:xxx`、`query`、`tool=web_search`
4. 前端：打开 admin.shadowshub.xyz → 「搜索 API」tab 看到统计与失败样例
5. 回归：`/api/admin/webos/usage/summary`、`/api/health` 正常（不影响既有端点）
