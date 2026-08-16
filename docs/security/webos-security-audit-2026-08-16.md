# Daily webOS 服务端安全审计报告（完整版 · 2026-08-16）

> 审计方式：DSH sub-agent（minimal，99 步/98 次 bash）+ Operit 人工 grep 逐条复核
> 审计范围：`server/src/`（Express 5 + better-sqlite3/PG + ws + pi-coding-agent）、`client/shell-web/`、`client/web/`（Legacy 维护模式）
> 验证状态：**Critical ×5 全部人工验证属实；High ×9 全部 DSH 日志核验（8 属实 + 1 部分属实，0 误报）**
> 关联文档：`docs/security/dsh-audit-2026-08-15-raw.txt`（23:35 轮被截断的原始输出）、`docs/dsh-subagent-usage-record.md`（DSH 使用记录）

---

## 审计结论速览

| 级别 | 数量 | 状态 |
|---|---|---|
| Critical | 5 | ✅ 全部属实（人工 grep 验证） |
| High | 9 | ✅ 8 属实 + 1 部分属实（DSH 日志核验） |
| Medium | 5 | ⚠️ 待逐条复核（静态分析可信度高） |
| Low / Info | 4 | ✅ 属实（含密钥轮换建议） |

**Top 5 修复优先级**：C1（全量越权）> C2（动态组件 RCE）> C3（AI Key 泄露）> C4（raw 端点 XSS）> C5+H1（首用户 admin + JWT 状态校验）

---

## Critical（应立即修复）

### C1. 全量数据越权读写：entities / scopes / export / import 无用户隔离或管理员保护 ✅已人工验证

- **位置**：`server/src/routes/entities.ts:12-45,48-121,133-176`、`server/src/routes/scopes.ts:9-64`、`server/src/routes/export.ts:7-48`、`server/src/routes/import.ts:25-30`
- **漏洞描述**：
  - `/api/entities` 仅挂全局 `authMiddleware`，任何登录用户（含游客）能查询/新增/修改/删除**所有** entities，其中包含 `type='webos_state'` 的用户私有状态（App、积分、存储、邮箱绑定）。
  - `/api/scopes` 可枚举全部 `user:*` / `guest:*` scope，并能把任意实体移动到任意 scope。
  - `/api/export` 可导出全库 panels/widgets/entities/settings/dynamicWidgets。
  - `/api/import` 可清空全库后导入任意数据（全站 DoS）。
- **攻击场景**：
  1. `GET /api/entities?type=webos_state` 直接读取所有用户的 webOS 私有状态。
  2. `PUT /api/entities/webos-state:user:<victim>` 篡改他人积分/App。
  3. `POST /api/import` 清空整个实例数据。
  4. `GET /api/scopes` 枚举用户 ID，配合其他越权接口扩大攻击。
- **修复建议**：为 entities/relations/scopes/export/import 增加 `requireUser` + 资源归属校验；`webos_state` 禁止走通用 entities API，只允许 webOS 专用路由按 principal 访问；export/import/scopes 仅管理员可用。

### C2. 任意用户可上传动态组件代码，前端 `new Function` 执行 → 存储型 RCE/XSS ✅已人工验证

- **位置**：`server/src/routes/dynamicWidgets.ts:38`（POST/PUT/DELETE 无 requireAdmin）+ `client/web/src/utils/evaluateWidget.ts:15`、`client/desktop/src/utils/evaluateWidget.ts:15`
- **漏洞描述**：任何登录用户可通过 `/api/dynamic-widgets` 创建全局动态组件，`code` 字段下发到所有客户端，前端 `new Function('React','__lucide',wrappedCode)` 直接执行。
- **攻击场景**：上传恶意动态组件 → 其他用户打开 Daily 时自动执行任意 JS，窃取 `access_token`、操作面板、读取本地数据。
- **修复建议**：动态组件发布/修改/删除仅允许 admin；前端不在主进程用 `new Function` 执行不可信代码，改放独立 sandbox iframe / Worker。

### C3. AI 配置接口泄露明文 API Key，且可被任意用户篡改 ✅已人工验证

- **位置**：`server/src/routes/aiSettings.ts:236-242`（GET `/api/ai/settings/api-key`）、`aiSettings.ts:249-282`（PUT `/api/ai/settings`）
- **漏洞描述**：任意已登录（含游客）用户可 `GET /api/ai/settings/api-key` 获取 `settings.apiKey || process.env.PI_API_KEY` 明文；`PUT /api/ai/settings` 可改全局模型/API Key/Endpoint。注释称"仅本地桌面端使用"但无落地限制。
- **攻击场景**：游客拿 JWT → 读明文 DeepSeek Key（云资源盗刷）；改 endpoint 为攻击者服务器（劫持所有用户 AI 对话）。
- **修复建议**：两个接口必须 `requireAdmin`；移除明文返回或仅限本机回环；前端只拿 `hasApiKey` 布尔。

### C4. 公开 raw 素材端点：同源 XSS + 未授权读取任意用户 App 文件 ✅已人工验证

- **位置**：`server/src/routes/webos.ts:2797-2858`（servePublicAppRawFile）、`webos.ts:2702-2720`（全局扫描所有用户工作区）、`webos.ts:6482-6505`（serveStoreRaw）、`webos.ts:6839-6856`（serveShareRawFile）、`server/src/index.ts:183-191`（免鉴权挂载）
- **漏洞描述**：raw 端点遍历所有用户工作区按 appId 找文件（知道 appId 即可免鉴权读取任意用户 App 文件）；对 `.html/.svg/.js` 直接返回可执行 MIME，无 Content-Disposition、无 CSP。
- **攻击场景**：通过 C1 泄露 appId → 读取他人私有 App 源码；分享含恶意 HTML/SVG 的 App → 受害者访问 raw URL 同源执行脚本窃取 Cookie。
- **修复建议**：可执行类型强制 attachment 或禁止返回；加 `Content-Security-Policy: sandbox` / `default-src 'none'`；只服务已发布/已分享资源，不全局扫描。

### C5. 公开注册时"第一个用户自动成为 admin"可被抢先利用 ✅已人工验证

- **位置**：`server/src/routes/auth.ts:123-136`
- **漏洞描述**：`/api/auth/register` 免鉴权开放，`users` 表为空时第一个注册者直接获得 `admin` 角色；且先判断 `ADMIN_USERNAMES` 名单再判断 `userCount === 0`，名单无法兜底。
- **攻击场景**：新部署/清空用户表后，攻击者抢先注册任意账号即获得管理员权限。
- **修复建议**：删除"首个注册用户自动 admin"；管理员必须通过初始化脚本或 `ADMIN_USERNAMES` 精确创建。

---

## High（应尽快修复）

### H1. JWT 不校验用户当前状态/角色，封禁、降权不生效 ✅属实
- **位置**：`server/src/middleware/auth.ts:96-118`、`199-214`；`server/src/routes/auth.ts:373-390`（refresh 用旧 role 续签）
- **说明**：authMiddleware 只信任 JWT payload，不查 `users.is_banned`/`users.role`；封禁/降权后旧 token 1 天内仍有效且可续签。
- **修复**：鉴权中间件按 userId 查库校验存在/未封禁/当前角色；refresh 以数据库角色重新签发。

### H2. deviceId 未与用户绑定：WS 连接劫持、本地服务代理越权 ✅属实
- **位置**：`server/src/ws.ts:276-331`、`routes/localServices.ts:56-96`、`routes/proxy.ts:47-107`
- **说明**：WS 的 deviceId 完全来自 URL query，JWT 不校验归属；local-services 信任 X-Device-Id，proxy 用 URL path deviceId（细节：非 header，风险本质相同）。
- **修复**：deviceId 由服务端签发并与用户绑定；WS verifyClient 和 HTTP 代理都校验归属。

### H3. `/webos/api/http` 代理存在 SSRF（重定向绕过）✅部分属实（IPv6 描述修正）
- **位置**：`server/src/routes/webos.ts:993-1055`
- **说明**：`redirect:'follow'` 后不复查是真实 SSRF 洞；DSH 修正：`isPrivateIp` 对 IPv6 实际是**全部拦截**（split('.') 长度≠4 → return true），并非"放行 IPv6"——真洞是重定向绕过 + DNS rebinding TOCTOU。
- **修复**：禁自动重定向或每跳重新校验；完整 IP 黑名单（IPv4/IPv6/保留段/整数 IP）；或限制白名单域名。

### H4. 公开背景 SVG 上传形成存储型 XSS ✅属实
- **位置**：`server/src/routes/background.ts:31-66,76-88`、`server/src/index.ts:206-210`（公开静态服务）
- **说明**：`ALLOWED_EXTENSIONS` 含 `.svg`，只验扩展名无内容消毒，`/backgrounds/<uuid>.svg` 公开以 `image/svg+xml` 返回。
- **修复**：禁止 SVG 或强制转 PNG；或内容消毒 + 静态响应加 CSP/nosniff。

### H5. 分享落地页未转义用户可控标题/菜单文本 ✅属实（DSH 补充确认）
- **位置**：`server/src/index.ts:292-346`（sharePageTemplate：`<b>${m.title}</b>`、`<title>${title}`、`title="${title}"` 直接拼接，仅 srcDocAttr 转义）
- **说明**：`title`/`ownerName`/App 名可注入 `</title><script>...`，受害者打开分享链接在主域执行脚本。
- **修复**：所有动态字段 HTML 转义；用户名/App 名服务端白名单或转义存储。

### H6. 工具开关与搜索 Key 管理缺少 admin 权限 ✅属实（DSH 补充发现 reset）
- **位置**：`server/src/routes/tools.ts:185-219`（`PUT /api/tools/:name`）、`tools.ts:226-244`（`POST /api/tools/reset` 也无）、`routes/searchKeys.ts:76-113`（PUT/DELETE）
- **说明**：任意登录用户可启用 `bash` 等文件系统工具（叠加 H8 = RCE 链）；可篡改/删除全局搜索 API Key。
- **修复**：全部 requireAdmin。

### H7. 前端主 DOM 直接渲染不可信 HTML ✅属实（DSH 补充确认）
- **位置**：`client/web/src/components/FreeHtmlComponent.tsx:114`、`PopupLayer.tsx:355`、`Workspace.tsx:337,379`
- **说明**：freeHtml/miniHtml/iconHtml/popup.content 用 dangerouslySetInnerHTML 渲染到主文档，可来自 AI 生成/恶意动态组件。
- **修复**：放入 `sandbox="allow-scripts"` iframe；或 DOMPurify 消毒 + 禁事件属性。

### H8. 旧 WS apiConfig 允许用户指定任意 LLM endpoint ✅属实（加重：污染全局 env）
- **位置**：`server/src/piBridge.ts:1694-1737`、`2040-2047`；`ws.ts:23`（user_message 携带 apiConfig）
- **说明**：客户端可传 `apiConfig.endpoint/apiKey/model`，无白名单校验，**且会改写全局 `process.env.PI_API_ENDPOINT`** 影响后续所有会话。可能是 BYOK 设计但安全边界缺失。
- **修复**：移除客户端 apiConfig 或仅管理员可配；校验 endpoint 协议/DNS/禁内网；禁止全局改 process.env。

### H9. Panel / Widget / Conversation 越权访问 ✅属实（DSH 补充确认）
- **位置**：`server/src/routes/panels.ts:116-124,238-252,254-292`、`widgets.ts:13-98,377-475`、`conversations.ts:11-24`
- **说明**：GET/PUT/DELETE panel、widgets CRUD、batch、conversations 均未校验 owner_id（widgets.ts:187-194 mini/icon 上传有 owner 校验是例外）。
- **修复**：统一 ownership 中间件；删除/修改前校验 `panel.owner_id === req.user.userId` 或 admin。

---

## Medium

| # | 发现 | 位置 | 说明 |
|---|---|---|---|
| M1 | 兑换码并发重复兑换（check-then-act 非原子） | `server/src/payment/afdian.ts:670-712,617-644` | 事务 + 原子 UPDATE 修复 |
| M2 | 生产环境 `SameSite=None` 且无 CSRF 防护 | `server/src/utils/jwt.ts:87-99`、`index.ts:145-156` | 写操作加 CSRF Token 或校验 Origin |
| M3 | Bash 沙箱可读取任意文件和环境变量 | `server/src/sandbox/commandRunner.ts:94-172`、`utils/fileSystemTools.ts:245+` | 白名单含 cat/env；路径限制 + 移除敏感命令 |
| M4 | 本地服务注册/列表无归属校验 | `routes/localServices.ts:56-96` | deviceId 绑定用户；列表只返回自己的服务 |
| M5 | Settings/Favorites/Communities/PanelTemplates/SyncLogs 全局资源无权限控制 | `routes/settings.ts`、`favorites.ts`、`communities.ts`、`panelTemplates.ts`、`syncLogs.ts` | 加 owner 或 requireAdmin |

## Low / Info

| # | 发现 | 位置 | 说明 |
|---|---|---|---|
| L1 | **工作区存在真实密钥，需立即轮换** | `server/.env:14-37`、`tmp/image-test/run-slow.js:5`（硬编码 sk- key） | 轮换 JWT_SECRET/SERVER_TOKEN/PI_API_KEY/RESEND_API_KEY/AFDIAN_API_TOKEN；删除 tmp 硬编码 |
| L2 | 依赖版本建议人工核对 | `server/package.json`（express ^5.0.1 等） | 跑 `npm audit` |
| L3 | 直接信任 `X-Forwarded-For` 可绕过 IP 限频 | `routes/auth.ts`（getClientIp）、`emailAuth.ts`、`webos.ts` | 仅可信代理后使用 + 设置 trust proxy |
| L4 | 修改密码/登出后旧 JWT 仍有效 | `routes/auth.ts:397+`、`emailAuth.ts:667+` | token_version 或服务端黑名单 |

---

## 修复优先级（建议执行顺序）

1. **C1** 封死全量数据越权（entities/scopes/export/import）——影响面最大
2. **C5 + H1** 账号初始化与 JWT 状态校验（删首用户 admin、鉴权查库）
3. **C3 + H6** AI 配置/工具开关加 requireAdmin（堵住任意用户篡改）
4. **C2** 动态组件 admin 管控 + 移除 new Function 执行
5. **C4** raw 端点可执行 MIME 限制 + CSP
6. **H2/H8** WS 身份绑定与 apiConfig 白名单
7. **H3/H4/H5** SSRF 重定向复查、SVG 消毒、分享页转义
8. **H9 + M 级** 统一 owner 校验与 CSRF

---

## 附录：与 23:35 轮审计（dsh-audit-2026-08-15-raw.txt）的差异说明

- 23:35 轮被取消截断至 M7（4C/10H/7M 未写完），本轮为完整版（5C/9H/5M/4L）。
- 23:35 轮的 C3（AI 文件系统沙箱失效：白名单绕过/全局沙箱根/参数不校验）在本轮未单列为 Critical，其子项分散在 H6（工具开关无 admin）、M3（沙箱可读 env）；**该轮对 commandRunner 白名单绕过的分析（find -exec / awk system / sed 1e）值得作为 C2 同等优先级补查**——建议修复 H6 时一并加固 commandRunner（execFile + 参数校验 + 按用户隔离沙箱根）。
- 23:35 轮的 H7（积分扣费竞态）与 M 级部分条目，本轮 M1 覆盖兑换码场景；对话计费竞态建议单独复核。