# Daily webOS Web 端（PWA）App API 体系需求与架构方案

> 状态：设计草稿  
> 适用范围：`client/shell-web/`（PWA Shell）与 `server/`（Node/Express 服务端）  
> 对齐文档：`docs/android/04-app-api.md`、`docs/android/05-external-apps.md`、`docs/android/07-permissions.md`、`docs/android/README.md`  
> 阅读前提：已了解现有 `client/shell-web/src/runtime.ts`、`client/shell-web/src/api.ts`、`server/src/routes/webos.ts` 的 App 运行时与 `/webos/api/http` 代理。

---

## 0. 要解决的用户诉求

1. **App 可接入外部 API**：如 AI 厂商 API、天气、汇率、自建 REST 服务。
2. **App 之间可互相调用 API**：如记账 App 暴露「余额 API」，其他 App 调用它。
3. **系统级 API**：任意 App 可嵌入 AI 对话能力，且不暴露 `DEEPSEEK_API_KEY`；App 内可构建全新工具（AI 可调用）。

本文档继承 Android 端已拍板的「`api.json` 声明式 API + 服务端 vm 沙箱 handler + visibility + 计费审计 + `sdk.useApi` 跨 App 调用」思想，但按 **PWA 无端侧 WebView/无 proot/无本地 Node 运行时**的约束落地。

---

## 1. Web 端现状盘点（基于代码事实）

### 1.1 App SDK 现有能力（`client/shell-web/src/runtime.ts` + `App.tsx` 注入的 bootstrap）

| 能力 | 现状 | 说明 |
|---|---|---|
| `sdk.storage` | ✅ 有 | App 私有 KV，宿主经 MessageChannel 调 `/webos/api/apps/:id/storage` |
| `sdk.fs` / `sdk.fs.shared` | ✅ 有 | App 私有文件 / 同用户跨 App 共享文件，服务端磁盘 |
| `sdk.apps.create/open` | ✅ 有 | App 内创建/打开 App |
| `sdk.http` | ✅ 有（雏形） | 通过宿主桥调 `POST /webos/api/http`，服务端已有 SSRF 基础防护 |
| `sdk.api.register/call` | ⚠️ 有（弱雏形） | 仅内存级 App 间调用；**目标 App 必须已打开**；无 api.json、无服务端持久化/权限/计费 |
| `sdk.permissions.request` | ⚠️ 弱 | 仅校验 App 声明里是否有该 capability，没有用户授权/平台策略求交 |
| `sdk.chat` / `sdk.ai` | ❌ 无 | 当前 AI 对话只存在于 Shell 的 React 视图，App 内无法直接调用 |

- 运行时消息通道：`sandbox="allow-scripts"` 的 opaque origin iframe + `MessageChannel`，宿主侧 `handleHostRequest` 统一处理 `storage.*` / `fs.*` / `http.request` / `api.register` / `api.call`。
- 当前 `http.request` **没有检查 App 是否声明 `network.outbound`**，任何 App 都能调用通用代理；`api.register/call` 也没有 capability 门控。这是安全缺口。

### 1.2 服务端现状（`server/src/routes/webos.ts` 等）

- **`server/src/webos/` 目录尚不存在**，也没有 `api.json` / `appapi` 雏形：全仓库未发现 `server/src/webos/appApi.ts`、`/webos/api/appapi/*`、`api.json` 解析器。
- **已有通用外部代理**：`POST /webos/api/http`
  - 有 SSRF 基础防护（禁止内网/回环/保留 IP、DNS 解析后校验）；
  - 15s 超时、响应 ≤2MB、每用户 30 次/分钟；
  - **没有按 App 的 `network.domains` 白名单**，也没有 secrets 托管。
- **没有 JS vm 沙箱**：`server/src/sandbox/` 目前只有命令执行器（白名单 shell 命令），不是 Android 文档说的 handler vm 沙箱。
- **App 数据在服务端**：`state.appStorage[appId]` 是权威存储；App 文件在 `apps/<appId>/` 与 `shared/`。这正好适合 API handler 直接读写。
- **AI 对话在服务端**：`POST /webos/api/chat/stream` 由服务端 pi agent 处理，`DEEPSEEK_API_KEY` 只存在于服务端环境变量，前端拿不到。
- **pi 工具目前是静态数组**：`server/src/piBridge.ts` 的 `customTools` 是编译期固定列表，没有按用户已装 App 动态注册 `appapi_*` 工具。
- **计费/审计已有基础但未覆盖 App API**：`api_usage_log` 记录 AI provider 用量；没有 `webos_app_api_log`、没有 `kind='api'` 的计费目录。

### 1.3 契约现状

- `shared/webos-contracts/index.ts` 只有 `WebOsAppVersion.capabilities: string[]`，**没有完整的 `AppManifest` 类型**，也没有 `network.domains` / `api.json` / secrets 字段。
- `docs/webos-architecture-plan.md` 中「定稿 AppManifestV1 JSON Schema」仍是计划，未在代码中落地【需验证：当前仓库无该 schema 文件】。
- 因此本方案需要先扩展共享契约。

---

## 2. 与 Android 端设计的关键差异

| 维度 | Android 端设计 | Web PWA 落地 |
|---|---|---|
| App 运行容器 | 端侧 WebView + 独立存储分区 | 浏览器 sandbox iframe（opaque origin），无独立存储分区，靠宿主桥访问服务端 |
| 外部 API 直连 | url-app 可端侧 WebView 直连；api 包走服务端代理 | **没有端侧 WebView 可直连**，所有外部 API 必须走服务端代理 |
| handler 执行位置 | 服务端 vm 沙箱（Android 文档同样如此） | 同样只能服务端 vm 沙箱；Web 端没有 proot/Node 可跑本地 handler |
| App 间 API | `sdk.useApi` 经 app-runtime 桥代理到服务端端点 | 同样经 MessageChannel 桥到宿主，再由宿主请求服务端端点；**不依赖目标 App 是否打开** |
| 密钥托管 | 服务端 secrets 加密托管（Android 端 BYOK 另说） | 服务端加密托管；前端永不接触 secret 值 |
| 权限模型 | 四交集：平台策略 ∩ 用户授权 ∩ Agent 工具权限 ∩ 包能力声明 | 沿用同一思想，但用户授权目前只有「声明即通过」的雏形，需要补真实授权 UI/策略 |
| 共享/房间 | `shared` 指房间成员共享 | 当前 Web 没有 rooms 实现；先做「同用户跨 App 共享」，跨用户 shared 需 rooms 模块【需验证】 |
| AI 对话嵌入 | 端侧 pi 可本地对话 | 复用现有服务端 `/webos/api/chat/stream`，通过宿主桥暴露给 App，key 不出服务端 |

---

## 3. 分阶段设计

> 落地约束：按 Android 02 §6 的拆分纪律，`server/src/routes/webos.ts` 冻结；以下新端点全部放入 `server/src/webos/` 新模块（如 `externalApi.ts`、`appApi.ts`），再在 `server/src/index.ts` 挂载。

### 3.1 Phase 1：外部 API 接入（服务端代理 + 白名单 + secrets 托管）

#### 3.1.1 为什么必须走服务端代理

- PWA App 运行在 `sandbox="allow-scripts"` iframe 中，是 opaque origin；即使页面里写 `fetch('https://api.example.com')` 也会受 CORS 限制，且无法安全携带服务端托管的密钥。
- 没有端侧 WebView 可像 Android url-app 那样直连并独立管理 Cookie/WS。
- 服务端代理可以统一做：域名白名单、SSRF 防护、secrets 注入、限流、审计、计费。
- 用户举例的「AI 厂商 API」也先按普通外部 REST API 接入：App 在 `api.json` 里声明域名和 secrets，handler 用 `ctx.http` 调用；如果目的是「平台统一计费/不暴露 key 的官方 AI 对话」，则走 Phase 3 的 `sdk.ai` 系统能力。

#### 3.1.2 Manifest / 契约扩展

在 `shared/webos-contracts` 增加：

```ts
export interface WebOsAppManifest {
  network?: {
    domains: string[]            // 精确域名或 *.example.com
  }
  secrets?: string[]             // 只存名字，不存值
  api?: {
    spec: string                 // 默认 "api.json"
  }
}
```

`WebOsAppVersion` 增加可选 `manifest?: WebOsAppManifest`。服务端 `StoredVersion` 同步增加该字段；旧版本无 manifest 时视为「无出站网络、无 API」。

#### 3.1.3 服务端端点

| 端点 | 方法 | 说明 |
|---|---|---|
| `POST /webos/api/apps/:appId/http` | POST | App 前端经 `sdk.http` 调用的代理入口；服务端按该 App 当前 active version 的 `network.domains` 校验 |
| `GET /webos/api/apps/:appId/secrets` | GET | 返回已配置的 secret 名称（**不返回值**） |
| `PUT /webos/api/apps/:appId/secrets/:name` | PUT | 设置/更新 secret 值（服务端加密存储） |
| `DELETE /webos/api/apps/:appId/secrets/:name` | DELETE | 删除 secret |

> 兼容：现有 `POST /webos/api/http` 可保留给系统/调试，但 App 内新代码应走带 `appId` 的版本；后续可把通用端点收敛为内部服务。

#### 3.1.4 `ctx.http` 白名单方案（服务端 vm handler 用）

```js
// handlers/rate.js
async function main(ctx) {
  const key = ctx.secrets.EXCHANGERATE_KEY
  const res = await ctx.http.get(`https://api.exchangerate.host/latest?access_key=${key}&base=USD`)
  return { rates: res.json().rates }
}
```

安全规则：

- `ctx.http` 只允许 `network.domains` 中声明的域名；支持 `*.example.com` 子域通配。
- 禁止内网段：RFC1918 / 169.254 / ::1 / 0.0.0.0 / 保留段；DNS 解析后再次校验，并防止 DNS rebinding（解析结果与最终连接 IP 一致性【需验证：Node 原生 fetch 的 DNS 复用策略】）。
- 超时 30s（handler 内）；响应体 ≤256KB（Android 文档标准）；直接 `sdk.http` 代理可维持现有 2MB 上限。
- secrets 只注入 `ctx.secrets`，**永不进入 params、returns、日志、AI 工具结果**。
- 每次出站调用写审计（目标域名、耗时、字节数、调用 App）。

#### 3.1.5 前端 SDK

现有 `sdk.http` 保留，但宿主桥发送时带上 `appId` 与当前版本，服务端做白名单校验。新增 `sdk.http` 不再是无条件可用；App 需在 manifest 声明 `network.domains`。

---

### 3.2 Phase 2：App 间 API（api.json + 服务端代理端点 + sdk.useApi）

#### 3.2.1 声明格式：记账 App 的 `api.json` 示例

```jsonc
{
  "schema_version": 1,
  "namespace": "ledger",
  "display_name": { "zh": "记账 API" },
  "endpoints": [
    {
      "name": "get_balance",
      "method": "GET",
      "path": "/balance",
      "description": { "zh": "获取当前余额" },
      "params": {
        "type": "object",
        "properties": {
          "currency": { "type": "string", "enum": ["CNY", "USD"], "default": "CNY" }
        }
      },
      "storage": { "read": ["ledger/*"] },
      "handler": "handlers/get_balance.js",
      "returns": {
        "type": "object",
        "properties": {
          "balance": { "type": "number" },
          "currency": { "type": "string" }
        }
      },
      "visibility": "owner"
    },
    {
      "name": "add_transaction",
      "method": "POST",
      "path": "/transactions",
      "description": { "zh": "新增一笔交易" },
      "params": {
        "type": "object",
        "required": ["amount", "category"],
        "properties": {
          "amount": { "type": "number" },
          "category": { "type": "string" },
          "note": { "type": "string" }
        }
      },
      "storage": { "read": ["ledger/*"], "write": ["ledger/*"] },
      "handler": "handlers/add_transaction.js",
      "visibility": "owner"
    }
  ]
}
```

#### 3.2.2 handler 编程模型（服务端 vm 沙箱）

```js
// handlers/get_balance.js
async function main(ctx) {
  const items = await ctx.storage.list('ledger/')
  const balance = items.reduce((sum, item) => sum + (item.amount || 0), 0)
  return { balance, currency: ctx.params.currency || 'CNY' }
}
```

`ctx` 约定：

```ts
interface ApiHandlerContext {
  params: Record<string, unknown>
  userKey: string
  appId: string
  versionId: string
  roomId?: string            // 后续 rooms 支持后才有
  storage: {
    get(key: string): Promise<unknown>
    set(key: string, value: unknown): Promise<void>
    del(key: string): Promise<void>
    list(prefix: string): Promise<Array<{ key: string; value: unknown }>>
  }
  secrets: Record<string, string>   // 仅 Phase 1 外部 API 需要
  http: { get/post/put/delete/request(...): Promise<HttpResult> }  // 受 network.domains 限制
}
```

- 使用 Node 原生 `vm` 模块，不引第三方沙箱依赖（与 Android 文档一致）。
- 禁止 `require` / `process` / `fs` / `fetch`（只能用 `ctx.http`）；超时 5s；返回 JSON 必须符合 `returns` schema；输出 ≤64KB。
- 后续可考虑 `isolated-vm`，但当前先保持零依赖【需验证：Node vm 对 async/await 与 Promise 的隔离足够】。

#### 3.2.3 服务端代理端点

```
POST /webos/api/appapi/:namespace/:endpoint
Content-Type: application/json
Body: { "params": { ... } }
```

调用管线：

```
鉴权（JWT/游客 Cookie）
  → 按 namespace 解析到 App 与 active version
  → 校验 endpoint 存在
  → visibility 检查（owner/shared/public）
  → 权限求交（调用方是否声明 app.api.invoke；storage 前缀是否匹配）
  → vm 执行 handler
  → 返回值 schema 校验
  → 计费（kind='api'，按调用方积分扣费）
  → 审计（webos_app_api_log）
```

#### 3.2.4 visibility 落地

| visibility | Web PWA 第一阶段含义 | 后续 |
|---|---|---|
| `owner`（默认） | 仅 App 所有者本人 + 其 AI + 其设备可调 | 不变 |
| `shared` | 先实现「同用户下已安装/已声明的其他 App 可调」，读写同一用户的 `appStorage[ownerAppId]` | 跨用户 shared 依赖 rooms 模块，先标【需验证】 |
| `public` | 任何登录用户可调，但只能读发布者显式 publish 的公共命名空间（Web 端商店/分享体系已有基础，可扩展） | 需要包市场/安装关系支持 |

#### 3.2.5 前端 SDK：`sdk.useApi` 的 PWA 版

在 `runtime.ts` 与 App bootstrap 中新增：

```ts
// App 内调用其他 App 的 API
const ledger = await sdk.useApi('ledger')
const balance = await ledger.get_balance({ currency: 'CNY' })

// 或保留低阶形式
await sdk.api.call('ledger', 'get_balance', { currency: 'CNY' })
```

实现路径：

```
App iframe
  → sdk.useApi('ledger') 触发 MessageChannel 请求 'api.use'
  → 宿主（Shell）拿到 namespace，向服务端 GET /webos/api/appapi/ledger 获取端点元数据
  → 生成带方法名的代理对象，后续每个方法调用发 'api.call'
  → 宿主 POST /webos/api/appapi/ledger/get_balance
  → 结果经 MessageChannel 返回 iframe
```

- **不要求目标 App 已打开**，因为 handler 在服务端执行。
- 现有 `sdk.api.register`（客户端内存注册）建议标记 deprecated；它只能用于「同一个已打开 App 页面内的临时回调」，不作为跨 App 正式通道。
- `sdk.useApi` 的可用性受 `app.api.invoke` capability 控制；当前 `ALLOWED_CAPABILITIES` 需增加该能力。

#### 3.2.6 AI 工具化（pi 动态工具）

- 服务端 `server/src/webos/appApi.ts` 提供 `loadApiSpecs(userKey)`：聚合该用户已安装/已创建 App 的 `api.json`。
- `piBridge` 在创建会话时调用 `registerDynamicTools(session, specs)`，为每个 endpoint 注册：
  - 工具名：`appapi_<namespace>_<endpoint>`
  - 描述/参数：直接来自 `api.json`
- 这样 AI 在对话里能直接调用记账 App 的余额 API，实现「AI 知道 App 内数据」。
- 工具结果同样受 64KB 截断；单会话动态工具数 ≤60（沿用 Android 文档）。

#### 3.2.7 计费与审计

- `WebOsBillingItem.kind` 增加 `'api'`。
- 新增表 `webos_app_api_log`：
  - `id`, `caller_key`, `namespace`, `endpoint`, `owner_app_id`, `visibility`, `params_digest`, `storage_prefixes`, `status`, `duration_ms`, `credits_consumed`, `created_at`
- 每次调用先估算、后结算；余额不足直接 402。

---

### 3.3 Phase 3：系统级 API（AI 对话能力 + App 内构建工具）

#### 3.3.1 不暴露 key 的「对话组件 API」

现状已经满足「key 不出服务端」：`DEEPSEEK_API_KEY` 只在服务端 env，前端走 `/webos/api/chat/stream`。因此 Phase 3 的核心是把这条能力安全地桥接给 App。

推荐设计（数据 API + 参考组件，而不是把 Shell React 页面塞进 iframe）：

```ts
// App 内可用
const chat = sdk.ai.chat({
  messages: [{ role: 'user', content: '总结我的账单' }],
  conversationId: 'app-ledger-1',
  onEvent: (event) => { /* 渲染 delta / tool / done */ }
})
await chat.ready
// 或返回 AsyncIterable，由 App 自己渲染
for await (const event of sdk.ai.stream({ messages, conversationId })) {
  // ...
}
```

宿主实现：

- App iframe 发 `ai.chat` / `ai.stream` 到宿主；
- 宿主复用 `client/shell-web/src/api.ts` 的 `streamChat()`（带 JWT Cookie、SSE 解析、断线重连）；
- 将 `WebOsChatEvent` 逐条经 MessageChannel 转发给 App；
- 服务端不新增对话端点，继续用现有 `/webos/api/chat/stream`。

「把现有 AI 对话页面复制到任意 App」的产品化：

- 提供官方 HTML 组件/模板（如 `daily.ai` 的对话 UI 片段），App 开发者可直接粘贴到自己的 HTML 中，配合 `sdk.ai.stream` 渲染；
- 不推荐让 App iframe 直接嵌入 Shell 的 React 页面（跨 iframe DOM 不可控、样式隔离困难）。
- 系统级 API 命名空间可预留 `system.ai`，但 SSE 不适合普通 appapi 请求/响应，因此先以 `sdk.ai.*` 桥方法提供；如需给服务端 handler 调用 AI，可另设计 `ctx.ai.chat`（非本轮必须）。

#### 3.3.2 App 内构建全新工具

推荐机制：**api.json 端点自动变成 pi 动态工具**（4.6），这是成本最低、与 Android 对齐的方案。一个 App 只要写好 `api.json` + handler，AI 就能把它当工具调用。

对于更复杂的「工具包」：

- 短期不做独立 `toolpkg` 运行时；
- 中期可在 `server/src/webos/toolpkg.ts` 实现服务端 vm 沙箱执行 `main.js`，复用与 api handler 相同的 `ctx` 白名单、权限、计费、审计；
- 也可对接 MCP：服务端作为 MCP client 连接外部工具，App 内通过声明 `mcp` 暴露给 AI【需验证：当前服务端是否已有 MCP client 基础】。

建议路线：

1. Phase 3a：`api.json` 动态工具（已覆盖 80% 的「App 内构建工具」诉求）。
2. Phase 3b：系统 `sdk.ai` 对话 API + 官方对话组件模板。
3. Phase 3c：若出现「非数据型、需要复杂逻辑/依赖」的工具，再引入服务端 `toolpkg` 或 MCP。

---

## 4. 架构图（文字版）

```
┌─────────────────────────────────────────────────────────────────────┐
│ PWA Shell（client/shell-web）                                       │
│                                                                     │
│  ┌──────────────┐   MessageChannel   ┌──────────────────────────┐  │
│  │ App iframe   │ ◄─────────────────► │ runtime.ts 宿主桥        │  │
│  │ sandbox      │  sdk.storage/fs/    │ handleHostRequest        │  │
│  │ allow-scripts│  http/api/ai        │ api.use/call/ai.stream   │  │
│  └──────────────┘                     └────────────┬─────────────┘  │
│                                                   │ fetch/JWT       │
└───────────────────────────────────────────────────┼─────────────────┘
                                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│ Server（server/）                                                    │
│                                                                     │
│  /webos/api/apps/:id/http  ──► external proxy（network.domains）    │
│  /webos/api/appapi/:ns/:ep ──► appApi.ts invokeEndpoint            │
│                                   ├─ visibility / permission        │
│                                   ├─ vm sandbox handler             │
│                                   ├─ storage wrapper → appStorage   │
│                                   ├─ ctx.http → external proxy      │
│                                   ├─ billing / audit                │
│                                   └─ dynamic pi tool registration   │
│  /webos/api/chat/stream    ──► pi agent（DEEPSEEK_API_KEY 在服务端）│
│                                                                     │
│  DB: entities(webos_state) / webos_app_api_log / secrets 加密表     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 5. 端点清单汇总

### Phase 1

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/webos/api/apps/:appId/http` | App 外部 API 代理（带白名单） |
| GET | `/webos/api/apps/:appId/secrets` | 列出 secret 名 |
| PUT | `/webos/api/apps/:appId/secrets/:name` | 设置 secret |
| DELETE | `/webos/api/apps/:appId/secrets/:name` | 删除 secret |
| GET | `/webos/api/apps/:appId/manifest` | 获取 App 当前 manifest（含 network/api 声明） |

### Phase 2

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/webos/api/appapi/:namespace/:endpoint` | App API 统一入口 |
| GET | `/webos/api/appapi/:namespace` | 获取某 namespace 的端点列表（供 `sdk.useApi` 生成代理） |
| GET | `/webos/api/apps/:appId/api` | App 信息页/文档页展示 API |
| GET | `/webos/api/admin/webos/app-api-logs` | 管理端审计查询（可放入 adminWebos） |

### Phase 3

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/webos/api/chat/stream` | 已有，`sdk.ai` 复用 |
| POST | `/webos/api/chat/cancel` | 已有，`sdk.ai` 可调用 |
| GET | `/webos/api/chat/background` | 已有，`sdk.ai` 断线恢复用 |
| （未来） | `/webos/api/toolpkg/:id/invoke` | 若实现服务端 toolpkg |

---

## 6. 安全要点清单

1. **外部网络白名单**：App 必须声明 `network.domains`；未声明则 `sdk.http` / `ctx.http` 默认禁用。
2. **SSRF 防护**：DNS 解析后校验 IP 非内网/保留段；重定向也要重新校验；禁止 `file:`、`gopher:` 等协议。
3. **密钥托管**：secret 值加密存储，只注入服务端 vm 的 `ctx.secrets`；前端、日志、AI 工具结果、错误信息一律不得出现明文。
4. **vm 沙箱**：无 `require/process/fs/net`；只有白名单 `ctx`；超时、内存/输出上限；handler 代码随 App 版本不可变。
5. **权限四交集**：平台策略 ∩ 用户授权 ∩ Agent 工具权限 ∩ App 能力声明。至少先补 `app.api.invoke`、`network.outbound` 两个能力词。
6. **visibility + storage 前缀**：跨 App 调用必须通过 visibility 检查，且 handler 的 storage 读写前缀受 `storage.read/write` 限制。
7. **计费与审计**：每次 appapi 调用扣费并落 `webos_app_api_log`；管理端可 trace。
8. **不暴露 key**：AI 对话能力只经宿主桥调服务端 `/chat/stream`，App iframe 永远看不到 `DEEPSEEK_API_KEY`。
9. **前端桥身份校验**：宿主收到 iframe 请求时必须校验 `context.app.id`，不能信任 iframe 自报的 appId（现有 `storage` 已做，`http`/`api` 需要补）。
10. **限流**：外部代理与 appapi 都按用户/App 限流，防滥用。

---

## 7. 分阶段排期建议

| 阶段 | 内容 | 依赖 | 建议工期 |
|---|---|---|---|
| Phase 1 | 扩展 manifest/contract；服务端带白名单代理；secrets 托管；`sdk.http` 接入 appId 校验 | 无 | 1–2 周 |
| Phase 2 | `api.json` 解析、vm handler、`/appapi` 端点、`sdk.useApi`、动态 pi 工具、计费审计 | Phase 1 的 vm/审计基础 | 2–3 周 |
| Phase 3 | `sdk.ai` 对话 API、官方对话组件模板、api 动态工具增强；toolpkg/MCP 评估 | Phase 2 动态工具 | 2 周（不含 toolpkg） |
| 后续 | rooms 支持 `shared` 跨用户；API 包市场；toolpkg/MCP 服务端执行 | Phase 2/3 | 另行排期 |

---

## 8. 待确认/需验证项

- [ ] `shared/webos-contracts` 当前确实没有 `AppManifest` 类型；需补充 schema 并同步 Android 契约。
- [ ] 服务端 Node `vm` 对 async handler 的隔离强度；是否需要在 `context` 层面再加 `Promise` 超时与资源限制。
- [ ] 跨用户 `visibility=shared` 依赖 rooms 模块，Web 端当前没有 rooms；先做同用户 shared，还是直接同步开发 rooms？
- [ ] 外部代理 DNS rebinding 防护：Node 原生 `fetch` 是否可保证连接 IP 与 DNS 校验一致；若不保证需改用自研 `http/https` 请求或 `net.connect` 校验。
- [ ] `sdk.useApi` 的 TypeScript 类型生成：是否由服务端返回 JSON Schema 后前端动态生成，还是先提供手写类型 + 运行时校验。
- [ ] API 包市场与依赖安装（`dependencies`）是否纳入 Phase 2，还是先只支持同用户 App 直接调用。
