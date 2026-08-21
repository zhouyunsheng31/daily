# 04 · App API 体系（web 路线核心：owner + public 技术管道）

> 解决的问题：**AI 造了 App，却不知道用户在 App 里存了什么**；以及**App 之间如何语义化共享数据/能力**。
> 一句话：**App = UI + 数据 + API**。API 用声明式 `api.json` 描述，系统自动把它变成：服务端代理端点 + AI 的 pi 工具 + 用户可读的文档页 + 可上架的 api 包。
> visibility：**owner（默认）+ public（web 先行）**；`shared`（联机房间）整体后置（R4）。

## 1. 声明格式（`api.json`，放在包根目录；独立 api 包的 entry）

```jsonc
{
  "schema_version": 1,
  "namespace": "notes",                      // 全局唯一，建议 = 包 id 末段
  "display_name": { "zh": "记事本 API" },
  "network": { "domains": ["api.exchangerate.host"] },  // 出站白名单（可选）
  "secrets": ["EXCHANGERATE_KEY"],           // 用户在包设置页填写的密钥名（值仅存服务端，加密）
  "endpoints": [
    {
      "name": "list_notes",                  // → 工具名 appapi_notes_list_notes
      "method": "GET",                       // GET=只读；POST=有副作用
      "path": "/notes",
      "description": { "zh": "列出笔记，支持按时间与关键词过滤" },
      "params": { "type": "object", "properties": {
          "keyword": { "type": "string" },
          "limit":   { "type": "integer", "default": 20, "maximum": 100 } } },
      "storage": { "read": ["notes/*"] },    // 允许的 storage 前缀（读）
      "handler": "handlers/list_notes.js",
      "returns": { "type": "array", "items": { "type": "object" } },
      "visibility": "owner"                  // owner=仅本人+其AI；public=任何安装者（web 先行）
    }
  ]
}
```

**handler 编程模型（服务端受限 vm 执行，非任意代码）**：

```js
// handlers/list_notes.js —— 只暴露一个 async main(ctx)
// ctx = { storage:{get,set,del,list}, params, userKey,
//         http?（白名单 fetch，仅 network.domains）, secrets?（按名取值，脱敏） }
// 没有 process / require / fs / 任意网络；超时 5s；输出 ≤64KB；返回值须符合 returns schema
async function main(ctx) {
  const notes = await ctx.storage.list('notes/')
  return notes.filter(n => !ctx.params.keyword || n.title.includes(ctx.params.keyword))
              .slice(0, ctx.params.limit ?? 20)
}
```

技术选型：Node `vm` 模块 + 白名单 ctx（不引第三方沙箱依赖）；CPU/内存用超时与输出大小双限。`ctx.http` 规则：域名精确匹配（可选 `*.example.com` 子域）；禁内网段（RFC1918/169.254/::1，SSRF 防护）；30s 超时；响应 ≤256KB；出站调用计审计与流量配额。secrets 值永不进日志/AI 上下文（工具结果自动脱敏）。

> **小抄：AI 把外部 API 接进 App（2026-08-21 用户问答沉淀）**——两条通路按用途选：
> - **通路 A · App 界面直连（快）**：App 的 JS 里 `sdk.http.request({ url, method, headers, body })` → 宿主 MessageChannel → 服务端 `POST /webos/api/http` 代理（公开外网 + SSRF：禁 IP 字面量 / localhost / 内网 / 云元数据，DNS 解析后逐 IP 校验，重定向 ≤3 跳逐跳复查，15s 超时，响应大小上限，按用户限频）。适用「AI 扒到一个公开 API，直接在 App 界面里拉数据渲染」。
> - **通路 B · 封装成自己的 API 端点（稳、可复用）**：api 包 api.json 声明 `network.domains`（白名单）+ `secrets` → handler 里 `await ctx.http.get(url, { headers: { Authorization: 'Bearer ' + ctx.secrets.X_KEY } })` → 该端点就是你的能力点；key 只存服务端（AI 看不到值、脱敏、永不回传），可用「我的 API 包 → 在线调试」直接试调。适用「二次封装 / 加业务逻辑 / 让 AI 在对话里调 / W3 后发布给别人复用」。
> **边界（诚实）**：内网/本机/云元数据一律拒（SSRF，安全设计不是疏忽）；只适合 API-key / Bearer / 简单 JSON 请求，**完整 OAuth 授权码流（浏览器跳转、cookie 会话、多步刷新）不适合**受限 handler 与代理（无浏览器/无 cookie 存储，需 token 托管专项，后置）；爬别人 API 的技术接入可行，合规与密钥由用户负责（系统不伪造、不代购）。

## 2. 系统自动做的三件事

### ① 服务端代理端点（人与其他系统可用）

```
POST /webos/api/appapi/:namespace/:endpoint     # 统一入口（GET 语义也走 POST，参数在 body）
  → 鉴权（JWT）→ 命名空间解析到包与版本 → visibility 检查（owner/public）
  → Broker 求交（调用方身份 × 端点 storage/network 声明 × 包能力声明）
  → vm 执行 handler（操作 App 的 app.storage.private——数据本来就在服务端）
  → 计费（计入调用方积分：固定微价/次，目录项 kind='api'，见 06）→ 审计落 execution.log + 管理端 trace
```

### ② AI 工具化（AI 可用）

- 用户安装的每个含 api 的包，在 pi 会话创建时**动态注册工具**：`appapi_<namespace>_<endpoint>`，description/参数 schema 直接来自 api.json（AI 零幻觉地知道怎么调）。
- 结果 ≤64KB 截断（防爆上下文）。单会话动态工具 ≤60 个；超出按最近使用裁剪并在系统提示中说明。

### ③ API 文档页（用户可看）

- App 信息页「API」Tab：列出端点、参数、示例、在线调试（填参数直接调，结果 JSON 展示）。
- 同时是"AI 能看到什么"的透明化：用户一眼知道 AI 能读哪些数据。

## 3. visibility 与数据边界

| visibility | 谁能调 | 数据视图 | 状态 |
|---|---|---|---|
| `owner`（默认） | 包所有者本人 + 其 AI + 其设备 | 该用户自己的 storage | W2 首发 |
| `public` | 任何安装该包的用户 | 发布者 `publishes` 的公共命名空间（写操作仍需作者身份） | W3（web 先行） |
| `shared` | 同一房间成员（联机） | 房间共享 storage 命名空间 | **后置**（依赖 06 联机） |

- 跨用户私有数据**默认不可见**；`publishes` 由包作者在 manifest 显式声明（`"publishes": ["posts/*"]`）。
- 全部调用链入管理端 trace（谁/何时/哪个端点/读写前缀/耗时/计费），沿用"查 bug 先查对话记录"同级标准。

## 4. public 技术管道（W3，web 先行；社区运营后置）

```
AI 在 App 里创建 API（文件夹即包：api.json + handlers/，校验反馈回路即时纠错）
  → 用户确认后发布到市场（storePublish 扩展 type=api；携带端点清单 + 数据范围声明 + network/secrets 声明）
  → 审核门槛（首期站长人工审核；自动静态扫描：危险模式/域名白名单/配额）
  → 上架：市场详情页展示端点清单 + 数据范围 + 调用价目
  → 他人安装（安装 api 包 = 授权确认页：明确"该 API 将可读写 xxx 数据"；依赖闭包自动装）
  → 他人调用：App 前端 sdk.useApi('notes').listNotes()（运行时桥代理到 §2① 端点）
              / AI 侧 appapi_notes_list_notes（pi 动态工具）
  → 计费（调用方付，kind='api'）+ 审计（全链 trace）
```

- **跨 App 组合的关键**：App manifest `dependencies: [{id:"com.daily.forum-api"}]` → 安装时自动装依赖 → App 前端 `sdk.useApi('forum').listPosts()`（桥代理）。
- **"AI 在 App 里创建 API"**（W5 核心场景）：AI 建 App 时同时写 api.json（用例 A）；或对话里说"给我的记账 App 加个汇率换算" → AI 用 `search_packages` 找到汇率 API 包 → 用户确认安装 → AI 修改记账 App（新版本）依赖该 API 完成换算（用例 C）。
- 移动端镜像：移动端 owner 级 handler 端侧运行（本地数据 + 同步）；调用 public API 一律经 §2① 服务器枢纽（routes/mobile.md D-M2）。

## 5. 服务端实现落点（`server/src/webos/`）

- `appApi.ts`：`loadApiSpecs(userKey)`（会话创建时聚合已安装包的 api.json，缓存按 package version 失效）；`registerDynamicTools(session, specs)`（pi 工具动态注册适配器，piBridge 只做适配层）；`invokeEndpoint(...)`（§2① 完整管线：鉴权/求交/vm/计费/审计）。
- `apiRuntime.ts`：handler 执行器（vm 池 + 5s 超时 + 64KB 截断 + ctx 白名单 + 计费/审计钩子）。
- 单测（必测族）：handler 沙箱逃逸（process/require/fetch 均不可用）；storage 前缀越权；超时与输出截断；域名白名单与 SSRF；secrets 脱敏；计费落库。

## 6. 端到端验收用例

- **用例 A（AI 知道自己的 App 数据）**：AI 建"记事本" App 时同时写 api.json（list/add/delete 三端点 + handlers）→ 用户在 App 里记了三条 → 用户在对话问"我昨天记了什么" → AI 调 `appapi_notes_list_notes` → 答出真实内容。
- **用例 B（public 管道）**：甲的 App 发布"帖子 API"（posts 读写，visibility=public，publishes=["posts/*"]）→ 乙安装 → 乙的 App `sdk.useApi` 发帖 → 甲可见；计费/审计落库；secrets 不出现在任何日志（grep 验证）。
- **用例 C（市场 API 复用）**：对话里说"给我的记账 App 加个汇率换算" → AI 用 `search_packages` 找到官方"汇率 API 包" → 用户确认安装 → AI 修改记账 App（新版本）依赖该 API 完成换算。
- **用例 D（外部 API 接入）**：装"汇率 API 包"（配 secrets）→ AI 在对话里回答"今天美元汇率"（ctx.http 白名单生效，越域请求被阻断有日志）。