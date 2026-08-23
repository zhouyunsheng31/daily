# Daily webOS API 权威参考手册

> **Base URL 规范**：
> - webOS 业务 API: `http(s)://<host>[:<port>]/webos/api`
> - 系统级与认证 API: `http(s)://<host>[:<port>]/api`
> - 诊断与管理 API: `http(s)://<host>[:<port>]/api/admin/webos`（需 Admin 权限）
> 
> **配套文档**：
> - [架构与路线设计](routes/web/README.md) · [包体系与市场指南](routes/web/10-package-market-guide.md) · [App API 管道设计](routes/web/04-app-api.md)

---

## 目录

1. [通用规范与鉴权机制](#1-通用规范与鉴权机制)
2. [系统初始化与配置 (Bootstrap & AI Config)](#2-系统初始化与配置)
3. [AI 会话与流式对话 (Chat & Stream)](#3-ai-会话与流式对话)
4. [HTML 应用管理与私有存储 (Apps & Private Storage)](#4-html-应用管理与私有存储)
5. [组合式包体系 (Packages API)](#5-组合式包体系)
6. [服务即包：App API 体系 (App API Subsystem)](#6-服务即包app-api-体系)
7. [统一包市场 (Package Market API)](#7-统一包市场)
8. [互通原语与网络空间 (Net Spaces & Events)](#8-互通原语与网络空间)
9. [文件服务与虚拟工作区 (Files & Workspace)](#9-文件服务与虚拟工作区)
10. [AI 媒体生成与出站代理 (Media & HTTP Proxy)](#10-ai-媒体生成与出站代理)
11. [支付与计费系统 (Billing & Afdian)](#11-支付与计费系统)
12. [桌面布局与系统时间 (Desktop & System Time)](#12-桌面布局与系统时间)
13. [用户认证中心 (Authentication)](#13-用户认证中心)
14. [管理端与系统诊断 (Admin & Trace API)](#14-管理端与系统诊断)
15. [App 前端 SDK 与 Handler 编程规范](#15-app-前端-sdk-与-handler-编程规范)

---

## 1. 通用规范与鉴权机制

### 1.1 鉴权方式

系统支持以下三种认证方式（除标注公开免鉴权的端点外均需携带）：

| 客户端场景 | 传递方式 | 说明 |
|---|---|---|
| **Web 浏览器端** | `httpOnly JWT Cookie` | 登录或以游客身份访问后由浏览器自动随请求发送（`credentials: 'include'`） |
| **Android / 脚本 / 外部 AI** | `Authorization: Bearer <TOKEN>` | Header 中携带 JWT Token，可通过 `GET /webos/api/user/token` 获取持久 Token |
| **游客身份** | `GET /api/auth/guest` | 首次打开系统自动生成游客 JWT，拥有独立沙箱工作区与体验积分；登录后自动迁移资产 |

### 1.2 响应格式与统一错误码

#### 成功响应
* `GET` 请求：直接返回 JSON 对象或数组；
* `POST` 创建类请求：返回创建的资源对象，HTTP 状态码 `201 Created`；
* `PUT / PATCH` 更新类请求：返回更新后的资源对象或 `{ "success": true }`；
* `DELETE` 请求：返回 `{ "success": true, "id": "..." }`。

#### 错误响应（统一 JSON 结构）
```json
{
  "error": {
    "status": 400,
    "code": "INVALID_INPUT",
    "message": "参数校验失败：id 格式不符合规范",
    "details": {}
  }
}
```

#### 常见错误代码表

| HTTP Status | 错误 Code | 含义说明 |
|---|---|---|
| 400 | `INVALID_INPUT` | 参数类型错误、缺失必填字段或 Schema 校验未通过 |
| 401 | `UNAUTHORIZED` / `INVALID_JWT` | 未登录、Token 无效或已过期 |
| 402 | `INSUFFICIENT_CREDITS` | 账号积分/算力余额不足，需充值或续期月卡 |
| 403 | `FORBIDDEN` / `GUEST_FORBIDDEN` | 无权限访问该资源（如游客尝试敏感写操作、越权访问他人物品） |
| 404 | `NOT_FOUND` | 请求的 App、包、文件或用户不存在 |
| 409 | `ALREADY_EXISTS` / `CONFLICT` | 资源冲突（如包 ID 重复、版本号已存在） |
| 413 | `PAYLOAD_TOO_LARGE` | 上传内容超过用户工作区配额限制 |
| 429 | `RATE_LIMITED` | 请求频率超限 |
| 500 | `INTERNAL_SERVER_ERROR` | 服务端受限沙箱异常或内部错误 |

---

## 2. 系统初始化与配置

### GET `/webos/api/bootstrap`
获取当前用户/游客启动 webOS 所需的全部初始状态（Shell 启动必调）。

* **鉴权**：JWT
* **Response 200**：
```json
{
  "user": {
    "id": "uuid-or-guest",
    "username": "游客_8a12",
    "email": null,
    "role": "guest",
    "avatar": "data:image/svg+xml;base64,...",
    "guest": true
  },
  "credits": 50,
  "aiConfig": {
    "model": "deepseek-chat",
    "thinkingBudget": "medium"
  },
  "apps": [
    {
      "id": "system.chat",
      "name": "AI 助手",
      "icon": "sparkles",
      "version": "1.0.0",
      "activeVersion": "1.0.0"
    }
  ],
  "desktopLayout": {
    "columns": 4,
    "items": []
  },
  "features": {
    "hasAfdian": true,
    "emailConfigured": true
  }
}
```

### GET `/webos/api/user/token`
获取当前账号的持久 JWT Token（供开发调试、curl、外部 AI 读写工作区包使用）。

* **鉴权**：JWT（仅限已注册登录用户；游客返回 403）
* **Response 200**：
```json
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "userKey": "user-uuid"
}
```

### PUT `/webos/api/ai/config`
更新当前用户的 AI 思考档位与模型偏好。

* **Body**：
```json
{
  "model": "deepseek-chat",
  "thinkingBudget": "medium" // "low" | "medium" | "high" | "max"
}
```
* **Response 200**：`{ "success": true, "aiConfig": { ... } }`

### GET/POST `/webos/api/avatar`
* `GET`：获取用户头像（返回 base64 或重定向到静态文件）
* `POST`：上传新头像（Form-Data 或 Base64，≤2MB，格式 png/jpg/webp/svg）

---

## 3. AI 会话与流式对话

### POST `/webos/api/chat/stream`
与服务端 AI 助手进行 SSE（Server-Sent Events）流式交互。服务端通过 `pi-coding-agent` 执行，具备沙箱文件读写、包生成与 App API 动态工具调用能力。

* **Headers**：`Content-Type: application/json`、`Accept: text/event-stream`
* **Body**：
```json
{
  "message": "帮我写一个倒计时的小应用",
  "sessionId": "session-uuid",
  "thinkingBudget": "medium",
  "clientContext": {
    "currentAppId": "system.chat",
    "viewport": { "width": 390, "height": 844 }
  }
}
```
* **SSE 事件流格式**：
```text
event: thinking_delta
data: {"text":"正在规划应用结构..."}

event: tool_call_start
data: {"tool":"agent_fs_write","params":{"path":"apps/timer/index.html"}}

event: tool_call_end
data: {"tool":"agent_fs_write","success":true}

event: text_delta
data: {"text":"我为你创建了一个倒计时应用，已部署到你的桌面。"}

event: end
data: {"sessionId":"session-uuid","usage":{"prompt_tokens":120,"completion_tokens":450}}
```

### POST `/webos/api/chat/cancel`
中断正在生成中的对话流。

* **Body**：`{ "sessionId": "session-uuid" }`
* **Response 200**：`{ "success": true }`

### GET `/webos/api/conversations`
获取历史会话列表。

* **Response 200**：
```json
[
  {
    "id": "session-uuid-1",
    "title": "制作番茄钟 App",
    "createdAt": 1787123456789,
    "updatedAt": 1787123500000,
    "messageCount": 6
  }
]
```

### GET `/webos/api/conversations/:id/messages`
获取指定会话的全量消息历史（包含 reasoning 内容与 tool_calls 记录）。

---

## 4. HTML 应用管理与私有存储

### GET `/webos/api/apps`
获取用户已安装的所有 HTML App 列表及其版本信息。

* **Response 200**：
```json
[
  {
    "id": "com.developer.calc",
    "name": "科学计算器",
    "icon": "calculator",
    "version": "1.0.2",
    "activeVersion": "1.0.2",
    "capabilities": ["app.storage.private"],
    "installedAt": 1787123456789
  }
]
```

### GET `/webos/api/apps/:appId`
获取单个 App 的完整详情，包括不可变版本快照历史与权限声明。

### POST `/webos/api/apps`
创建静态 HTML App（初次创建生成 `1.0.0` 版本）。

* **Body**：
```json
{
  "id": "com.user.notes",
  "name": "极简记事本",
  "icon": "pencil",
  "html": "<!DOCTYPE html><html>...</html>",
  "capabilities": ["app.storage.private"]
}
```
* **Response 201**：返回 App 实体与初始版本。

### POST `/webos/api/apps/:appId/versions`
为已有 App 提交新的不可变版本（遵循 SemVer 版本不可变原则）。

* **Body**：
```json
{
  "version": "1.1.0",
  "html": "<!DOCTYPE html><html>...</html>",
  "changelog": "优化夜间模式表现"
}
```
* **Response 201**：`{ "success": true, "version": "1.1.0" }`

### PUT `/webos/api/apps/:appId/active-version`
原子切换激活运行的版本指针。

* **Body**：`{ "version": "1.0.0" }`
* **Response 200**：`{ "success": true, "activeVersion": "1.0.0" }`

### POST `/webos/api/apps/:appId/rollback`
一键回滚到上一个稳定版本。

* **Response 200**：`{ "success": true, "rolledBackTo": "1.0.0" }`

### App 私有 KV 存储 API (`app.storage.private`)
提供给运行在沙箱容器中的 HTML App 存取业务数据：

* `GET /webos/api/apps/:appId/storage` — 列出该 App 所有 key 列表
* `GET /webos/api/apps/:appId/storage/:key` — 读取指定 key 对应的值（JSON）
* `PUT /webos/api/apps/:appId/storage/:key` — 写入数据（Body 为任意合法的 JSON 值）
* `DELETE /webos/api/apps/:appId/storage/:key` — 删除指定 key

---

## 5. 组合式包体系

> **协议规范**：Daily 采用 `daily.pkg.json v2` 组合式包规范（13 种包类型：`app`、`pet-layer`、`api`、`skill`、`theme`、`toolpkg`、`mcp`、`workflow`、`model-pack`、`url-app`、`provider`、`subagent`、`bundle`）。

### GET `/webos/api/packages`
列出当前用户工作区已安装/创建的所有包。

* **Query 参数**：
  * `type` (可选)：按包类型过滤，如 `type=app` 或 `type=api`
* **Response 200**：
```json
[
  {
    "id": "com.daily.currency-api",
    "type": "api",
    "version": "1.0.0",
    "activeVersion": "1.0.0",
    "displayName": { "zh": "汇率换算服务", "en": "Currency API" },
    "capabilities": ["network.outbound"],
    "enabled": true
  }
]
```

### GET `/webos/api/packages/:id`
获取指定包的详细信息，包含完整 Manifest、版本历史与审计信息。

### POST `/webos/api/packages`
从 Manifest 与文件树创建或安装一个新包。

* **Body**：
```json
{
  "manifest": {
    "schema_version": 2,
    "id": "com.developer.reader",
    "type": "app",
    "version": "1.0.0",
    "entry": "index.html",
    "display_name": { "zh": "阅读器", "en": "Reader" },
    "capabilities": ["app.storage.private"]
  },
  "files": {
    "index.html": "<!DOCTYPE html>...",
    "assets/icon.png": "base64..."
  }
}
```
* **Response 201**：返回 Package 对象。

### POST `/webos/api/packages/:id/versions`
为包发布不可变的新版本快照。

### PUT `/webos/api/packages/:id/active-version`
切换包的激活版本指针。

### DELETE `/webos/api/packages/:id`
卸载/删除包（进入回收站）。

### GET `/webos/api/packages/:id/files/raw/*`
公开/按需读取包内的静态资源与素材文件（如 `assets/logo.png`）。

---

## 6. 服务即包：App API 体系

> **运行机制**：App API 将应用能力与数据通过 `api.json` 声明，并在服务端受限 Node vm 中执行 handler（5s 超时、64KB 输出截断、域名白名单、Secrets 永不脱出服务端）。

### POST/GET `/webos/api/appapi/:namespace/:endpoint`
调用指定命名空间下的 API 端点。

* **调用权限**：
  * `visibility: "owner"`：仅本用户及用户的 AI 助手有权调用；
  * `visibility: "public"`：经发布后任何已安装该 API 包的用户均可调用。
* **Headers**：`Authorization: Bearer <TOKEN>` 或 Cookie
* **Body**（POST 时）：
```json
{
  "keyword": "工作总结",
  "limit": 10
}
```
* **Response 200**：
```json
{
  "success": true,
  "data": [
    { "id": "note-1", "title": "周五工作总结", "date": "2026-08-22" }
  ]
}
```

### GET `/webos/api/appapi/:namespace`
获取该命名空间下的 API 元数据与已注册的所有端点清单。

### PUT `/webos/api/appapi/:namespace/secrets`
配置该 API 命名空间所需的私密凭证（如第三方服务 API Key）。

* **Body**：`{ "EXCHANGERATE_KEY": "sk_live_xxxx" }`
* **安全性**：Secrets 明文仅保存在服务端安全加密库，在 GET 接口和 Trace 日志中均脱敏，Handler vm 执行时注入 `ctx.secrets`。

### GET `/webos/api/appapi/:namespace/secrets`
查询已配置的 Secret 键名列表（仅返回 key 名，永不返回明文值）。

### POST `/webos/api/appapi/:namespace/publish`
将命名空间标记发布为 `public`，允许全平台其他用户安装和跨应用调用。

---

## 7. 统一包市场

### GET `/webos/api/market`
浏览与搜索市场中的包。

* **Query 参数**：
  * `type` (可选)：包类型过滤（`app`、`api`、`skill`、`theme` 等）
  * `q` (可选)：关键词搜索
  * `page` (可选，默认 1)、`limit` (可选，默认 20)
* **Response 200**：
```json
{
  "total": 42,
  "items": [
    {
      "id": "com.daily.markdown-editor",
      "type": "app",
      "version": "2.1.0",
      "displayName": { "zh": "Markdown 笔记" },
      "description": { "zh": "支持公式与图表的沉浸式编辑器" },
      "author": "Daily Team",
      "downloads": 1204,
      "capabilities": ["app.storage.private", "files.workspace.read"]
    }
  ]
}
```

### GET `/webos/api/market/:id`
获取市场包详情，包括依赖关系树（`dependencies`）与权限申请声明。

### POST `/webos/api/market/publish`
将本地工作区中的包上架到市场。

* **Body**：`{ "packageId": "com.developer.my-tool", "version": "1.0.0" }`
* **处理流程**：触发静态安全扫描（检查危险 AST、SSRF 域名白名单、权限越界），通过后入库上架。

### POST `/webos/api/market/:id/install`
安装市场包，并**自动解析并安装依赖闭包**。2026-08-23 起为「安装即用」：整包复制到调用者工作区 `installed/<id>/`，并按包内容自动生效——app→桌面图标、skill→AI 技能即时可用、api/toolpkg/mcp→`appapi_*` 工具自动注册、theme→桌面/App 立即换肤（bootstrap 下发 `theme.tokens`）。

* **Response 200**：`{ "ok": true, "installed": ["com.developer.my-tool", "com.daily.auth-api"], "note": "✅ Skill 已安装…；✅ 主题已应用…" }`

### POST `/webos/api/market/:id/unpublish`
下架已发布的市场包。

### GET `/webos/api/market/:id/install-state`
查询某包对当前用户的安装态：`{ "ok": true, "packageId": "...", "type": "api", "enabled": true }`（`enabled` 为市场设置页启停开关状态）。

### POST `/webos/api/market/:id/toggle`
市场设置页「启停开关」：`{ "ok": true, "packageId": "...", "enabled": false, "note": "技能已停用；主题已恢复默认（重新启用可再应用）" }`
* **Body**：`{ "enabled": false }`（false=停用：按包内容撤销运行时产物——app 从桌面移除、skill 目录删除+pi loader 失效、theme 还原为默认；true=恢复。`installed/` 与安装记录保留，可随时恢复）
* **权限**：仅本机安装者操作自己的安装记录；api 包的 public 调用权不受本人开关影响（公开调用归属主发布语义，见 App API 管道）。

### GET `/webos/api/market/mine`
获取当前用户在市场中发布和安装的包状态（含 enabled 启停态）。

---

## 8. 互通原语与网络空间

### POST `/webos/api/net/spaces`
创建多人/跨设备共享数据空间（注册用户可用）。

* **Body**：
```json
{
  "name": "家庭账本共享",
  "mode": "collaborative" // "collaborative" | "readonly"
}
```
* **Response 201**：`{ "id": "space-uuid", "name": "家庭账本共享", ... }`

### GET `/webos/api/net/spaces/:id`
获取指定空间详情与成员列表。

### GET/PUT `/webos/api/net/spaces/:id/keys/:key`
读写共享空间内的 KV 数据。

### POST `/webos/api/net/spaces/:id/events`
向共享空间广播事件。

* **Body**：`{ "event": "bill_added", "payload": { "amount": 99.5, "title": "超市采购" } }`

### GET `/webos/api/net/spaces/:id/events`
拉取空间事件（支持增量拉取与长轮询挂起）。

* **Query 参数**：
  * `since` (可选)：起始事件 Sequence ID
  * `wait` (可选，单位秒)：无新事件时挂起长轮询（最大 30s）

---

## 9. 文件服务与虚拟工作区

### 9.1 用户可见区文件 API (`/webos/api/workspace/files`)

* `GET /webos/api/workspace/files?path=` — 列出指定目录下的文件与文件夹元数据
* `POST /webos/api/workspace/files` — 上传单文件（Body: `{ fileName, contentBase64, dir? }`）
* `POST /webos/api/workspace/files/upload` — 大文件分块上传（支持 `chunk`、`complete`、`abort`）
* `GET /webos/api/workspace/files/raw?path=` — 获取文件二进制内容（用于下载与图片预览）
* `DELETE /webos/api/workspace/files?path=` — 删除指定文件或空目录

### 9.2 AI 虚拟工作区只读 API (`/webos/api/workspace/agent-files`)

* `GET /webos/api/workspace/agent-files?path=` — 浏览 AI 工作区文件树（只读）
* `GET /webos/api/workspace/agent-files/raw?path=` — 读取 AI 工作区源文件（只读）

### 9.3 移动端全量同步原语 (`/webos/api/files/*`)

* `GET /webos/api/files/manifest` — 获取当前文件树的 SHA-256 Manifest
* `GET/PUT /webos/api/files/blob?hash=` — 按哈希下载或上传文件 Blob
* `POST /webos/api/files/snapshot` — 创建全量文件系统快照
* `POST /webos/api/files/reconcile` — 差异比对与对齐

---

## 10. AI 媒体生成与出站代理

### POST `/webos/api/imagegen`
服务端 AI 图片生成接口（与 AI Agent `generate_image` 工具同链路，支持文生图与图生图）。

* **Body**：
```json
{
  "prompt": "赛博朋克风格的未来城市，霓虹灯光，高清 8k",
  "n": 1,
  "size": "1024x1024",
  "reference_image": "base64-optional"
}
```
* **Response 200**：
```json
{
  "url": "/webos/api/imagegen/file/img_8f3a9e.png",
  "width": 1024,
  "height": 1024,
  "costCredits": 2
}
```

### GET `/webos/api/imagegen/config`
获取当前生图引擎可用状态与计价模型（不暴露服务端 API Key）。

### POST `/webos/api/http`
受限安全出站 HTTP 代理（供 App 前端拉取外部 API，内置严格 SSRF 防护：禁止 IP 字面量、localhost、内网网段及云元数据地址）。**仅注册用户可调用**：游客会话返回 `403 GUEST_NOT_ALLOWED`（2026-08-23，与互通体系 R13 对齐，检查在服务端）。

* **Body**：
```json
{
  "url": "https://api.exchangerate.host/latest?base=USD",
  "method": "GET",
  "headers": { "Accept": "application/json" }
}
```

---

## 11. 支付与计费系统

### GET `/webos/api/payment/products`
获取系统充值点数包与月卡商品列表。

### POST `/webos/api/payment/orders`
创建爱发电（Afdian）支付订单。

* **Body**：`{ "productId": "credits_100" }`
* **Response 201**：返回付款链接与订单号 `outTradeNo`。

### GET `/webos/api/payment/orders/:orderId`
轮询订单支付与履约状态。

### POST `/webos/api/payment/redeem`
使用兑换码（卡密）直接兑换积分或月卡。

* **Body**：`{ "code": "DAILY-VIP-ABCD-1234" }`
* **Response 200**：`{ "success": true, "addedCredits": 100, "vipDays": 30 }`

### GET `/webos/api/usage`
获取当前用户的总点数、剩余体验点数、月卡到期日及本月已消耗 token 统计。

---

## 12. 桌面布局与系统时间

### GET/PUT `/webos/api/desktop-layout`
* `GET`：获取跨端同构的桌面图标排布、分类与文件夹数据
* `PUT`：保存更新后的桌面布局配置

### GET `/webos/api/time`
获取服务器标准北京时间（UTC+8）与时间戳信息。

---

## 13. 用户认证中心

### POST `/api/auth/guest`
签发游客身份 JWT（无感即用，游客自动获得沙箱隔离工作区）。

### POST `/api/auth/email/puzzle`
获取发送验证码前的安全人机验证（滑动拼图参数）。

### POST `/api/auth/email/send-code`
向指定邮箱发送 6 位数字验证码（免鉴权）。

* **Body**：`{ "email": "user@example.com", "puzzleVerification": "..." }`

### POST `/api/auth/email/register`
通过邮箱验证码与密码完成注册（若当前有游客身份，自动将其名下的 App、包与工作区文件完整迁移到新注册账号）。

* **Body**：
```json
{
  "email": "user@example.com",
  "code": "123456",
  "password": "mySecurePassword123"
}
```

### POST `/api/auth/email/login`
邮箱/用户名与密码登录（自动签发 JWT）。

### POST `/api/auth/email/reset-password`
通过邮箱验证码重置账号密码。

### GET `/api/auth/me`
获取当前已登录用户的详细资料。

### POST `/api/auth/logout`
退出登录，清除 Cookie。

---

## 14. 管理端与系统诊断

> 命名空间 `/api/admin/webos/*`，全部接口由 `requireAdmin` 拦截保护。

### GET `/api/admin/webos/trace`
全链路诊断端点：根据 `sessionKey` 或 `appId` 一键整合**对话事件流 + 后端 execution.log 错误日志 + App 不可变版本快照**。

### GET `/api/admin/webos/chat-logs` & `/sessions`
全量查询所有用户的对话记录与推理过程（包含完整的 `reasoning` 推理全文，用于排查 AI 幻觉与工具调用错误）。

### GET `/api/admin/webos/server-status` & `/server-metrics`
查询服务器实时 CPU、内存、SQLite 写入延迟与 WebSocket 在线连接数。

### PUT `/api/admin/webos/credits` & `/tokens`
管理员向指定用户手动增减算力点数与 Token 额度。

---

## 15. App 前端 SDK 与 Handler 编程规范

### 15.1 前端容器 SDK（`window.DailyWebOs` / `window.daily`）

运行在沙箱容器内的 HTML App 自动注入 `window.DailyWebOs` 宿主通信对象：

```typescript
// 1. App 私有 KV 存储 (需声明 app.storage.private)
await DailyWebOs.storage.set('theme', 'dark')
const theme = await DailyWebOs.storage.get('theme')

// 2. 平台原生 AI 生图能力 (需声明 media.imagegen，自动扣除当前用户积分)
const imgResult = await DailyWebOs.media.generateImage({
  prompt: '赛博朋克风格的猫咪头像，高清',
  size: '1024x1024'
})
if (imgResult.ok) {
  console.log('图片已生成:', imgResult.url) // 直接渲染在 <img> 中
}

// 3. 平台原生 AI 对话/推理 (需声明 ai.chat，自动扣除当前用户算力)
const chatResult = await DailyWebOs.ai.chat({
  prompt: '帮我为这个记事本起一个有创意的名字',
  thinkingBudget: 'medium'
})
console.log('AI 回复:', chatResult.text)

// 4. 用户身份与积分感知 (需声明 user.info)
const profile = await DailyWebOs.user.getProfile()
const { credits } = await DailyWebOs.user.getCredits()
console.log(`当前用户: ${profile.username}，剩余积分: ${credits}`)

// 5. 调用 App API (需声明 app.api.invoke)
const notes = await DailyWebOs.useApi('notes').listNotes({ limit: 5 })

// 6. 安全外部网络请求 (需声明 network.outbound + 出站白名单)
const res = await DailyWebOs.http.get('https://api.exchangerate.host/latest')
const data = JSON.parse(res.body)
```

### 15.2 App API `api.json` 声明规范

置于包根目录的 `api.json` 结构：

```json
{
  "schema_version": 1,
  "namespace": "mycalc",
  "display_name": { "zh": "计算服务 API", "en": "Calculator API" },
  "network": {
    "domains": ["api.exchangerate.host"]
  },
  "secrets": ["RATE_API_KEY"],
  "endpoints": [
    {
      "name": "convert_rate",
      "method": "POST",
      "path": "/convert",
      "description": { "zh": "实时外汇汇率换算" },
      "params": {
        "type": "object",
        "properties": {
          "from": { "type": "string" },
          "to": { "type": "string" },
          "amount": { "type": "number" }
        },
        "required": ["from", "to", "amount"]
      },
      "storage": {
        "read": ["rates/*"],
        "write": ["rates/*"]
      },
      "handler": "handlers/convert.js",
      "returns": { "type": "object" },
      "visibility": "owner"
    }
  ]
}
```

### 15.3 Handler 服务端受限 vm 编程规范

放在 `handlers/xxx.js` 中的执行函数，必须暴露唯一的 `async function main(ctx)`：

```javascript
/**
 * ctx 上下文对象包含：
 * - ctx.params:   校验后的请求参数
 * - ctx.storage:  受 storage 权界限制的 KV 存储 { get(key), set(key, val), del(key), list(prefix) }
 * - ctx.http:     白名单 fetch（仅限 network.domains 声明的域名）
 * - ctx.secrets:  仅限 secrets 声明的私密凭证（自动脱敏）
 * - ctx.userKey:  当前调用者唯一用户 ID
 */
async function main(ctx) {
  const { from, to, amount } = ctx.params
  
  // 1. 先查缓存
  const cacheKey = `rates/${from}_${to}`
  let rate = await ctx.storage.get(cacheKey)
  
  if (!rate) {
    // 2. 走白名单出站请求
    const res = await ctx.http.get(`https://api.exchangerate.host/convert?from=${from}&to=${to}`, {
      headers: { 'Authorization': `Bearer ${ctx.secrets.RATE_API_KEY}` }
    })
    rate = res.data.result
    await ctx.storage.set(cacheKey, rate)
  }
  
  return {
    from,
    to,
    amount,
    result: amount * rate,
    rate
  }
}
```

* **沙箱约束**：
  * 无 `process`、`require`、`fs` 或任意 socket；
  * 执行超时：5 秒（强制中断）；
  * 返回数据量：≤ 64 KB（超限截断并报错）。