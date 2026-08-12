# 04 · App API 体系（高优先级，M2 核心）

> 解决的问题：**AI 造了 App，却不知道用户在 App 里存了什么**；以及**两个 App/两个用户之间如何用语义化的方式共享数据**（含"双方页面完全不同但数据互通"）。
> 一句话：**App = UI + 数据 + API**。API 用声明式文件描述，系统自动把它变成：服务端可调用的代理端点 + AI 的 pi 工具 + 用户可读的文档页 + 可上架的 api 包。

## 1. 声明格式（`api.json`，放在 App 包根目录；或独立 api 包的 entry）

```jsonc
{
  "schema_version": 1,
  "namespace": "notes",                      // 全局唯一，建议=包 id 末段
  "display_name": { "zh": "记事本 API" },
  "endpoints": [
    {
      "name": "list_notes",                  // → 工具名 appapi_notes_list_notes
      "method": "GET",                       // GET=只读；POST=有副作用
      "path": "/notes",                      // 代理路径段
      "description": { "zh": "列出笔记，支持按时间与关键词过滤" },
      "params": {                            // JSON Schema（工具参数 = 它）
        "type": "object",
        "properties": {
          "keyword": { "type": "string" },
          "limit":   { "type": "integer", "default": 20, "maximum": 100 }
        }
      },
      "storage": { "read": ["notes/*"] },    // 允许的 storage 前缀（读）
      "handler": "handlers/list_notes.js",   // 服务端沙箱执行的处理器（见 §2）
      "returns": { "type": "array", "items": { "type": "object", "properties": {
          "id": {"type":"string"}, "title": {"type":"string"}, "updatedAt": {"type":"number"} } } },
      "visibility": "owner"                  // owner=仅本人+其AI；shared=房间成员；public=任何安装者
    },
    {
      "name": "add_note", "method": "POST", "path": "/notes",
      "description": { "zh": "新增一条笔记" },
      "params": { "type":"object", "required":["title"],
        "properties": { "title": {"type":"string"}, "body": {"type":"string"} } },
      "storage": { "read": ["notes/*"], "write": ["notes/*"] },
      "handler": "handlers/add_note.js",
      "visibility": "owner"
    }
  ]
}
```

**handler 编程模型**（服务端受限 VM 执行，非任意代码）：
```js
// handlers/list_notes.js —— 只暴露一个 async main(ctx)
// ctx = { storage: { get(prefix), set(key,value), del(key), list(prefix) }, params, userKey, roomId? }
// 没有网络、没有 fs、没有 process；超时 5s；返回值须符合 returns schema（不符=500 校验错误）
async function main(ctx) {
  const notes = await ctx.storage.list('notes/')
  return notes.filter(n => !ctx.params.keyword || n.title.includes(ctx.params.keyword))
              .slice(0, ctx.params.limit ?? 20)
}
```
> 技术选型：Node `vm` 模块 + 白名单 ctx（不引第三方沙箱依赖）；CPU/内存用超时与输出大小双限（输出 ≤64KB）。这避免在服务端跑任意 JS 的风险面，同时让 AI 写 handler 零门槛。

## 2. 系统自动做的三件事

### ① 服务端代理端点（人与其他系统可用）

```
POST /webos/api/appapi/:namespace/:endpoint        # 统一入口（GET 语义也走 POST，参数在 body）
  → 鉴权（JWT）→ 命名空间解析到包与版本 → visibility 检查（owner/shared/public）
  → Broker 求交（调用方身份 × 端点 storage 声明）
  → vm 执行 handler（操作该 App 的 app.storage.private——数据本来就在服务端）
  → 计费（计入调用方积分：固定微价/次，目录项 kind='api'）→ 审计落 execution.log
```

### ② AI 工具化（AI 可用）

- 用户安装的每个含 api 的包，在 pi 会话创建时**动态注册工具**：`appapi_<namespace>_<endpoint>`，description/参数 schema 直接来自 api.json（AI 零幻觉地知道怎么调）。
- 结果受 64KB 截断（防爆上下文，沿用 RikkaHub 128KB 思路的我们侧标准）。
- 注册上限：单会话 ≤60 个动态工具；超出按最近使用裁剪并在系统提示中说明。

### ③ API 文档页（用户可看）

- App 信息页新增「API」Tab：列出端点、参数、示例、在线调试（填参数直接调，结果 JSON 展示）。
- 这同时是"AI 能看到什么"的透明化：用户一眼知道 AI 能读哪些数据。

## 3. api 包与市场

- 独立 `type=api` 包 = 只有 api.json + handlers 的包（没有 UI）。**跨 App 组合的关键**：
  - App manifest 声明 `dependencies: [{id:"com.daily.forum-api"}]` → 安装时自动装依赖 → App 前端经 app-sdk `sdk.useApi('forum').listPosts()` 调用（运行时由 app-runtime 桥代理到 §2① 端点）。
  - **"两人对话页面完全不同"场景** = 双方各自装不同 UI 包 + 同一 api 包 +（联机时）同一房间（06）。
- 市场上架 api 包：详情页展示端点清单与数据范围声明；安装即授权确认页（明确"该 App 将可读写 xxx 数据"）。

## 4. visibility 与数据边界

| visibility | 谁能调 | 数据视图 |
|---|---|---|
| `owner`（默认） | 包所有者本人 + 其 AI + 其设备 | 该用户自己的 storage |
| `shared` | 同一房间成员（06；调用带 roomId） | 房间共享 storage 命名空间 |
| `public` | 任何安装该包的用户 | 发布者 publish 的公共命名空间（写操作仍需成员身份） |

- 跨用户私有数据**默认不可见**；publish 命名空间由包作者显式声明（manifest `publishes: ["posts/*"]`）。
- 全部调用链入管理端 trace（谁/何时/哪个端点/读写前缀/耗时/计费），沿用"查 bug 先查对话记录"的同级排查标准。

## 5. 端到端示例（验收用例）

**用例 A（AI 知道自己的 App 数据）**：AI 建"记事本" App 时同时写 `api.json`（list/add/delete 三端点 + handlers）→ 用户在 App 里记了三条 → 用户在对话问"我昨天记了什么" → AI 调 `appapi_notes_list_notes` → 答出真实内容。
**用例 B（双端异构 UI 论坛）**：作者发"论坛 API 包"（posts 读写，visibility=shared）→ 甲做"极简论坛 App"、乙装"二次元论坛 App"，同依赖该 API → 甲发帖乙可见（经房间共享命名空间）。
**用例 C（市场 API 复用）**：用户对话里说"给我的记账 App 加个汇率换算" → AI 用 `search_packages` 找到官方"汇率 API 包" → 用户确认安装 → AI 修改记账 App（新版本）依赖该 API 完成换算。

## 6. 服务端实现落点（`server/src/webos/appApi.ts`）

- `loadApiSpecs(userKey)`：会话创建时聚合已安装包的 api.json（缓存按 package version 失效）。
- `registerDynamicTools(session, specs)`：pi 工具动态注册适配器（piBridge 只做适配层，遵守 02 §6.2-3）。
- `invokeEndpoint(...)`：§2① 的完整管线（鉴权/求交/vm/计费/审计）。
- 单测：handler 沙箱逃逸用例（process/require/fetch 均不可用）、storage 前缀越权用例、超时与输出截断用例、计费落库用例。