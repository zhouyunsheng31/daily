# Living Dashboard AI 搜索系统 Spec

> 生成日期：2026-06-26
> 状态：Spec 已确认，待三端派发实现
> 基于 brainstorming 会话确认
> 引用：[architecture_refactor.md](../architecture_refactor.md)、[roadmap_server_v1.md](../roadmap_server_v1.md)、[roadmap_desktop_v1.md](../roadmap_desktop_v1.md)、[roadmap_mobile_v1.md](../roadmap_mobile_v1.md)

---

## 一、概述与范围

### 1.1 目标

为 Living Dashboard（浏览器 + 无限画布 + AI 的桌面/移动/服务器三端产品）补齐 AI 搜索能力，让 Pi Agent 能通过工具调用检索"本地数据 + 联网网页 + 学术论文 + GitHub 资源"四类信息，从而支撑用户"全部一切可以查看的数据都要支持搜"的诉求。

搜索引擎只负责返回 sources（结构化来源），由 LLM 基于 sources 做总结性回答。搜索与 LLM 是两条独立链路，互不绑定。

### 1.2 四类搜索工具

| 工具 | 用途 | 执行位置 | 外部依赖 |
|------|------|---------|---------|
| `local_search` | 检索本端已同步数据（面板/笔记/任务/书签等） | 客户端（DEVICE_SPECIFIC_TOOLS 路由） | 无 |
| `web_search` | 联网网页搜索 | 服务器中转 | 博查 Bocha API |
| `academic_search` | 学术论文检索 + 开放获取 PDF | 服务器中转 | Semantic Scholar API |
| `github_search` | GitHub 仓库/代码/用户/Issue 搜索 + 文件/Release 下载 | 服务器中转 | GitHub API |

### 1.3 关键约束（必须遵守）

1. **搜索引擎与 LLM 完全分离**——用户可各自配置；搜索工具只返回 sources，LLM 基于 sources 做总结，二者无任何绑定关系。
2. **本地搜索绝不访问服务器或其他端数据库**——`local_search` 只查本地已同步数据，不发起任何网络请求。
3. **多端数据同步后，同步到本地的数据可被本地搜索覆盖**——同步落库的数据与本地原生数据一视同仁进入索引。
4. **API Key 集中在服务器 `ai_settings` 表**——客户端不持有任何外部搜索 API Key，仅持有本端 `local_search` 索引。搜索引擎 Key 存 `ai_settings` 表（不复用 `auth.json`，详见 8.1 节）。
5. **香港服务器无 GFW**——服务器可直连博查、Semantic Scholar、GitHub 等海外 API，无需代理。
6. **"全部一切可以查看的数据都要支持搜"**——本地数据按高/中/低权重全量纳入搜索范围，仅排除纯配置/日志/暂存类数据。

### 1.4 架构原则

- **复用现有 WS + JSON-RPC 协议**：搜索工具走现有 `tool_call` / `tool_result` 消息（见 [architecture_refactor.md](../architecture_refactor.md) 第三章 per-panel 路由），不新造协议。
- **服务器权威 + 客户端执行本地**：联网搜索在服务器执行（Key 不下发）；本地搜索路由到客户端执行（数据不下发）。
- **不引入重型依赖**：桌面端数据量 <10k 条，用纯 JS 内存缓存 + 查询时实时扫描 + `Intl.Segmenter` 分词，不引入 SQLite/FTS5；移动端用 Room LIKE，不用 @Fts4。
- **失败显式可见**：Key 缺失、配额超限、网络错误都返回明确错误，不静默吞掉。

---

## 二、架构总览

### 2.1 整体架构图

```
┌──────────────────────┐       ┌──────────────────────┐       ┌──────────────────────┐
│   桌面端 (Electron)   │       │     移动端 (Android)  │       │   服务器 (香港 VPS)   │
│  ┌──────────────────┐ │       │  ┌──────────────────┐ │       │  ┌──────────────────┐ │
│  │ React 渲染进程    │ │       │  │ Compose UI        │ │       │  │ Pi Agent          │ │
│  │ + AI 对话 UI      │ │       │  │ + AI 对话 UI      │ │       │  │ (@earendil-works/ │ │
│  │ + 搜索结果组件    │ │       │  │ + 搜索结果组件    │ │       │  │  pi-agent-core)   │ │
│  └────────┬─────────┘ │       │  └────────┬─────────┘ │       │  │  AgentLoop 多轮    │ │
│           │ IPC        │       │           │ Kotlin     │       │  └────────┬─────────┘ │
│  ┌────────▼─────────┐ │       │  ┌────────▼─────────┐ │       │           │           │
│  │ Electron 主进程   │ │       │  │ Room + WS Client  │ │       │  ┌────────▼─────────┐ │
│  │ + 内存缓存        │ │       │  │ + LIKE 查询       │ │       │  │ Tool Registry     │ │
│  │ + 实时扫描打分    │ │       │  │                   │ │       │  │ 24 + 4 = 28 工具  │ │
│  │ + Intl.Segmenter  │ │       │  │                   │ │       │  │                   │ │
│  └────────┬─────────┘ │       │  └────────┬─────────┘ │       │  └────────┬─────────┘ │
│           │           │       │           │           │       │           │           │
└───────────┼───────────┘       └───────────┼───────────┘       └───────────┼───────────┘
            │                               │                               │
            │      WS (JSON-RPC)            │      WS (JSON-RPC)            │
            └───────────────┬───────────────┴───────────────┬───────────────┘
                            │                               │
                            ▼                               ▼
                  ┌─────────────────────┐         ┌─────────────────────┐
                  │  WS 网关 (ws.ts)     │         │  外部 API (香港直连) │
                  │  tool_call 路由      │         │  ┌───────────────┐  │
                  │  per-panel 设备路由  │         │  │ 博查 Bocha     │  │
                  └──────────┬──────────┘         │  │ Semantic Scholar│ │
                             │                    │  │ GitHub API     │  │
                             │ tool_call/result   │  └───────────────┘  │
                             ▼                    └─────────────────────┘
                  ┌─────────────────────┐
                  │  Pi Agent 执行       │
                  │  - local_search →    │
                  │    路由回客户端执行   │
                  │  - web/academic/     │
                  │    github → 服务器   │
                  │    直连外部 API      │
                  └─────────────────────┘
```

### 2.2 工具路由表

| 工具 | 路由方式 | 执行端 | Key 持有方 | 数据流向 |
|------|---------|--------|-----------|---------|
| `local_search` | `DEVICE_SPECIFIC_TOOLS` → `panelActiveDevices[panelId]` | 客户端 | 无需 Key | 本地索引 → 客户端 → WS → Pi Agent |
| `web_search` | 服务器全局工具 | 服务器 | 服务器 `ai_settings` 表 `searchKey.bocha` | 服务器 → Bocha → 服务器 → Pi Agent |
| `academic_search` | 服务器全局工具 | 服务器 | 服务器 `ai_settings` 表 `searchKey.semanticScholar` | 服务器 → S2 → 服务器 → Pi Agent |
| `github_search` | 服务器全局工具 | 服务器 | 服务器 `ai_settings` 表 `searchKey.github` | 服务器 → GitHub → 服务器 → Pi Agent |

> 路由机制复用 [architecture_refactor.md](../architecture_refactor.md) 第 3.3-3.4 节的 `panelActiveDevices[panelId]` 规则。`local_search` 加入 `DEVICE_SPECIFIC_TOOLS` 集合（见 `server/src/piBridge.ts` L48）。

### 2.3 与现有 WS + JSON-RPC 协议的关系

现有协议（`server/src/ws.ts`）已定义：

```typescript
// 前端 → 后端
| { kind: 'tool_result'; requestId: string; success: boolean; data?: unknown; error?: string }

// 后端 → 前端
| { kind: 'tool_call'; requestId: string; tool: string; params: unknown; targetDeviceId?: string; panelId?: string }
```

四个搜索工具完全复用上述消息对：

- **`local_search`**：Pi Agent 发 `tool_call` → WS 网关按 `panelId` 路由到 `targetDeviceId` → 客户端执行本端索引查询 → 回 `tool_result`。
- **`web_search` / `academic_search` / `github_search`**：Pi Agent 直接在服务器进程内执行（调外部 API），不走 WS。结果作为 `tool_result` 进入 AgentLoop 下一轮。

**可选扩展（Phase S9 不强制）**：新增 `tool_call_stream` 消息，用于 GitHub 大文件下载进度、学术 PDF 下载进度等长任务的流式反馈。

```typescript
// 可选新增（后端 → 前端）
| { kind: 'tool_call_stream'; requestId: string; chunk: string; done: boolean }
```

不引入该消息时，长任务以单次 `tool_result` 返回；引入后仅影响 UI 体验，不影响工具语义。

### 2.4 工具执行架构（customTools vs 服务器侧工具）

**验证现状**（`server/src/piBridge.ts`）：
- 现有 24 个 `customTools`（`createHtmlWidgetTool` / `browser*Tool` / `storage*Tool` 等）的 `execute` 函数**全部**调用 `executeViaWs(tool, params, panelId)` 把请求路由到客户端执行。
- `DEVICE_SPECIFIC_TOOLS` 是一个 `Set<string>`，仅用于在 `executeViaWs` 内部判断"是否要求目标设备在线"（browser_* 工具要求面板有活跃设备；其他工具只要有任意 client 连接即可）。
- 所有 `customTools` 通过 `createAgentSession({ customTools })` 注入 Pi Agent，统一进入工具注册表。

**新增 4 个搜索工具的执行形态分两类**：

| 工具 | 执行形态 | `execute` 函数实现 | 是否走 `executeViaWs` | 是否加入 `DEVICE_SPECIFIC_TOOLS` |
|------|---------|-------------------|---------------------|--------------------------------|
| `local_search` | **客户端执行**（WS 路由） | 调 `executeViaWs('local_search', params, panelId)`，由客户端处理 `tool_call` 后回 `tool_result` | ✅ 是 | ✅ 是（要求面板有活跃设备） |
| `web_search` | **服务器进程内执行** | 直接在 `execute` 内 `fetch('https://api.bochaai.com/v1/web-search', ...)`，返回 `tool_result` | ❌ 否 | ❌ 否 |
| `academic_search` | **服务器进程内执行** | 直接在 `execute` 内 `fetch('https://api.semanticscholar.org/...', ...)` | ❌ 否 | ❌ 否 |
| `github_search` | **服务器进程内执行** | 直接在 `execute` 内 `fetch('https://api.github.com/...', ...)` | ❌ 否 | ❌ 否 |

**实现要点**：

1. **统一注册到 `customTools` 数组**：4 个搜索工具都作为 `ToolDefinition` 加入 `customTools`，与现有 24 个工具共用同一个注册入口（`createAgentSession({ customTools })`）。**不新造"服务器侧工具"注册机制**——`ToolDefinition.execute` 本就支持任意异步实现，服务器进程内 fetch 与 WS 路由只是两种不同的 `execute` 实现。

2. **`local_search` 的路由逻辑**：
   - 加入 `DEVICE_SPECIFIC_TOOLS` 集合（`server/src/piBridge.ts` L48）。
   - `execute` 内调 `executeViaWs('local_search', params, panelId)`，复用现有 per-panel 路由（`panelActiveDevices[panelId]`）。
   - 客户端收到 `tool_call` 后执行本端搜索（见 3.3 节），回 `tool_result`。
   - 超时、目标设备缺失等错误由现有 `executeViaWs` 机制统一处理（30s 超时）。

3. **`web_search` / `academic_search` / `github_search` 的服务器侧执行**：
   - `execute` 函数内直接 `fetch` 外部 API，**不调用 `executeViaWs`**，**不发送 `tool_call` 到客户端**。
   - Key 从 `ai_settings` 表读取（见 8.1 节，**不复用 `AuthStorage`**——已验证 `AuthStorage.setRuntimeApiKey` 仅支持 LLM provider key，不支持自定义字段）。
   - 错误处理（Key 缺失 / 429 / 网络错误）在 `execute` 内捕获，以 `tool_result.success=false` 形式返回。
   - 进程内执行的好处：无需 WS 往返，延迟低；Key 不下发客户端；外部 API 调用日志集中记录。

4. **与现有 `customTools` 架构的关系**：
   - 不修改现有 24 个工具的 `execute` 实现。
   - 不修改 `executeViaWs` 函数本身。
   - 仅在 `customTools` 数组追加 4 个新工具定义，在 `DEVICE_SPECIFIC_TOOLS` 集合追加 `'local_search'` 一项。

**伪代码示意**（仅说明形态，非实现）：

```typescript
// server/src/piBridge.ts

// 1. DEVICE_SPECIFIC_TOOLS 追加 local_search
const DEVICE_SPECIFIC_TOOLS = new Set([
  'browser_eval', /* ...existing 18 tools... */,
  'local_search',  // 新增
])

// 2. 新增 4 个 ToolDefinition
const localSearchTool: ToolDefinition = {
  name: 'local_search',
  parameters: Type.Object({ /* 见 3.1 节 */ }),
  execute: async (_id, params, _sig, _upd, _ctx) => {
    const pid = getCurrentPanelId()
    if (!pid) throw new Error('no panel context for local_search')
    const result = await executeViaWs('local_search', params, pid)  // 走 WS 路由到客户端
    return { content: [{ type: 'text', text: JSON.stringify(result) }], details: {} }
  },
}

const webSearchTool: ToolDefinition = {
  name: 'web_search',
  parameters: Type.Object({ /* 见 4.1 节 */ }),
  execute: async (_id, params, _sig, _upd, _ctx) => {
    // 服务器进程内直接 fetch Bocha，不走 executeViaWs
    const key = await getSearchKey('bocha')
    if (!key) throw new Error('未配置 Bocha API Key，请在设置中填写')
    const resp = await fetch('https://api.bochaai.com/v1/web-search', { /* ... */ })
    // ... 字段映射、错误处理
    return { content: [{ type: 'text', text: JSON.stringify(result) }], details: {} }
  },
}

// academicSearchTool / githubSearchTool 同理

// 3. 追加到 customTools 数组
const customTools: ToolDefinition[] = [
  /* ...existing 24 tools... */,
  localSearchTool,
  webSearchTool,
  academicSearchTool,
  githubSearchTool,
]
```

---

## 三、工具一：local_search

### 3.1 工具定义

```typescript
interface LocalSearchParams {
  /** 搜索关键词（中英文混合，支持子串匹配） */
  query: string;
  /** 限定数据类型（可选，不传则全量搜）；可选值见 LocalSearchableType */
  type?: LocalSearchableType;
  /** 返回条数上限，默认 20，硬上限 50 */
  limit?: number;
}

type LocalSearchableType =
  | 'panel' | 'task' | 'calendarEvent' | 'habit' | 'note' | 'journal'
  | 'quickNote' | 'mistake' | 'vocabDeck' | 'vocabProgress' | 'panelTemplate'
  | 'bookmark' | 'webTab' | 'widget' | 'dynamicWidget' | 'htmlWidget'
  | 'favorite' | 'aiConversation' | 'aiMemory' | 'moodEntry'
  | 'savingsTransaction' | 'drawingStroke' | 'widgetConnection' | 'focusSession';

interface LocalSearchResult {
  results: LocalSearchHit[];
  total: number;
}

interface LocalSearchHit {
  /** 数据类型，对应 LocalSearchableType */
  type: LocalSearchableType;
  /** 记录主键 */
  id: string;
  /** 主标题（高权重字段值） */
  title: string;
  /** 命中片段（截断 200 字符，高亮关键词） */
  snippet: string;
  /** 数据所在位置描述（如 "面板 > 组件 > 字段"），供 UI 展示 */
  location: string;
  /** 若数据归属于某面板，给出 panelId，便于点击跳转 */
  panelId?: string;
  /** 相关度得分 0-1，按权重加权计算 */
  score: number;
}
```

### 3.2 数据源清单

#### 3.2.1 桌面端（35 个 IndexedDB store，按权重分组）

桌面端 IndexedDB 共 35 个 store（见 `client/desktop/src/utils/dbV2.ts` 的 `V2_STORE_NAMES`，已逐项核对）。`LocalSearchableType` 共 24 个值，与 24 个可索引 store 一一对应；其余 11 个 store 不索引。

**LocalSearchableType ↔ V2_STORE_NAMES 完整映射表**

| `type` 字段值（LocalSearchableType） | V2_STORE_NAMES | 是否索引 | 主标题字段（高权重 ×1.0） | 内容字段（中权重 ×0.6） | 元数据字段（低权重 ×0.3） |
|-------------------------------------|----------------|---------|--------------------------|------------------------|--------------------------|
| `panel` | `panels` | ✅ | `name` | — | — |
| `widget` | `widgetRecords` | ✅ | `title` | — | `type` |
| `task` | `tasks` | ✅ | `title` | — | — |
| `calendarEvent` | `calendarEvents` | ✅ | `title` | `note` | — |
| `habit` | `habits` | ✅ | `title` | — | — |
| `note` | `notes` | ✅ | `title` | `content` | `tags[]` |
| `journal` | `journals` | ✅ | — | `content` | — |
| `quickNote` | `quickNotes` | ✅ | — | `content` | `tags[]` |
| `mistake` | `mistakes` | ✅ | — | `questionContent` / `correctAnswer` / `userAnswer` / `explanation` | — |
| `vocabDeck` | `vocabDecks` | ✅ | `name` | — | — |
| `vocabProgress` | `vocabProgress` | ✅ | — | `word` / `meaning` | — |
| `panelTemplate` | `panelTemplates` | ✅ | `name` | — | — |
| `bookmark` | `bookmarks` | ✅ | `title` | — | `url` |
| `webTab` | `webTabs` | ✅ | `title` | — | `url` |
| `dynamicWidget` | `dynamic-widgets` | ✅ | `displayName` | `code` | — |
| `htmlWidget` | `htmlWidgets` | ✅ | `title` | `html` | — |
| `favorite` | `favorites` | ✅ | `displayName` | — | — |
| `aiConversation` | `aiConversations` | ✅ | — | `content` | — |
| `aiMemory` | `aiMemories` | ✅ | — | `value` | `category` / `key` |
| `moodEntry` | `moodEntries` | ✅ | — | `note` | — |
| `savingsTransaction` | `savingsTransactions` | ✅ | — | `note` | — |
| `drawingStroke` | `drawingStrokes` | ✅ | — | `text` | — |
| `widgetConnection` | `widgetConnections` | ✅ | — | `label` | — |
| `focusSession` | `focusSessions` | ✅ | — | `label` / `taskTitleSnapshot` | — |
| —（无对应 type） | `widgetStates` | ❌ | 组件运行态二进制，无可搜文本 | — | — |
| —（无对应 type） | `habitCheckins` | ❌ | 打卡记录，元数据性质 | — | — |
| —（无对应 type） | `savingsGoals` | ❌ | 目标元数据，主标题已在 `savingsTransactions.note` 覆盖 | — | — |
| —（无对应 type） | `aiAuditLog` | ❌ | 审计日志 | — | — |
| —（无对应 type） | `quizSessions` | ❌ | 会话存档 | — | — |
| —（无对应 type） | `sudokuGames` | ❌ | 游戏存档 | — | — |
| —（无对应 type） | `playlists` | ❌ | 歌单，未来按需补充 | — | — |
| —（无对应 type） | `importStaging` | ❌ | 暂存区 | — | — |
| —（无对应 type） | `settings` | ❌ | 配置 | — | — |
| —（无对应 type） | `meta` | ❌ | 元数据配置 | — | — |
| —（无对应 type） | `kvStorage` | ❌ | 任意键值，无统一 schema | — | — |

> **统计**：24 个可索引 store（24 个 `LocalSearchableType` 值） + 11 个不索引 store = 35，与 `V2_STORE_NAMES` 长度一致。

**权重分组汇总**（用于打分逻辑实现）：

- **高权重（×1.0）**：`panels.name` / `tasks.title` / `calendarEvents.title` / `habits.title` / `notes.title` / `vocabDecks.name` / `panelTemplates.name` / `bookmarks.title` / `webTabs.title` / `widgetRecords.title` / `favorites.displayName` / `dynamic-widgets.displayName` / `htmlWidgets.title`
- **中权重（×0.6）**：`notes.content` / `journals.content` / `quickNotes.content` / `mistakes.{questionContent,correctAnswer,userAnswer,explanation}` / `vocabProgress.{word,meaning}` / `aiConversations.content` / `aiMemories.value` / `htmlWidgets.html` / `dynamic-widgets.code` / `calendarEvents.note` / `moodEntries.note` / `savingsTransactions.note` / `drawingStrokes.text` / `widgetConnections.label` / `focusSessions.{label,taskTitleSnapshot}`
- **低权重（×0.3）**：`notes.tags[]` / `quickNotes.tags[]` / `aiMemories.{category,key}` / `widgetRecords.type` / `bookmarks.url` / `webTabs.url`

**不索引清单**（与上表"❌"行一致，单独列出便于实现时跳过）：`widgetStates` / `habitCheckins` / `savingsGoals` / `aiAuditLog` / `quizSessions` / `sudokuGames` / `playlists` / `importStaging` / `settings` / `meta` / `kvStorage`。

#### 3.2.2 移动端（7 张 Room 表）

| Room 表 | 可搜字段 | 权重 |
|---------|---------|------|
| `panels` | `name` | 高 |
| `widgets` | `title` / `type` | 高 / 低 |
| `bookmarks` | `title` / `url` | 高 / 低 |
| `history` | `title` / `url` | 高 / 低 |
| `tabs` | `title` / `url` | 高 / 低 |
| `favorites` | `displayName`（JOIN `widgets` 取 `title` 兜底） | 高 |
| `widget_positions` | 无可搜字段（仅位置元数据：x/y/zIndex，不索引） | — |

> 移动端数据量小（<1k 条），7 张表（含 `widget_positions` 不索引）足够覆盖"全部可查看数据"。

### 3.3 桌面端实现方案

**方案选型**：查询时实时扫描 + 内存缓存（带失效标记）。

**选型理由**（基于代码现状评估）：
- 已验证 `client/desktop/src/utils/dbStores/` 下 15 个 store 文件的 `saveXxx` / `deleteXxx` 均为裸 async 函数，直接走 `withFallback` + `runIdbTransaction`，**无任何钩子/回调/事件机制**。
- 已验证 `client/desktop/src/utils/dbV2.ts` 仅有 `openV2Database` / `migrateFromV1ToV2` 等基础能力，**无 subscribe/emit/hook 机制**。
- 选项 A（改造全部写入路径注入钩子）：需改造 15 个 store 文件 + 35 个写入入口，工作量 >2 周，回归风险高，**否决**。
- 选项 B（定时全量重建）：数据有 5 分钟延迟，违反"同步落库即可被搜到"约束，**否决**。
- 选项 C（查询时实时扫描）：数据量 <10k 条，单次扫描 + 分词 + 打分 <50ms；不依赖任何不存在的钩子；天然覆盖同步落库（同步数据走同一条 IDB 读路径）；缓存命中后 <5ms。**采纳**。

**索引数据结构**：

```typescript
// 内存缓存（按 storeId 分组的全量记录快照）
// key = storeId，value = 该 store 的全部记录数组
type SearchCache = Map<V2StoreName, Array<{ id: string; data: Record<string, unknown> }>>

// 缓存失效标记：任意数据变更广播后置为 true，下次查询前重建
let cacheStale = true
let cacheBuilding: Promise<void> | null = null
```

**查询流程**：

1. **缓存检查**：若 `cacheStale === true`，触发异步重建（去重并发重建请求）；若 `cacheStale === false`，直接使用缓存。
2. **缓存重建**（仅当失效时）：遍历 24 个可索引 store（见 3.2.1 映射表）调用现有 `getAllXxx()` 或 `getAllFavoritesFromIdb()` 等读取函数，填充 `SearchCache`；重建完成后 `cacheStale = false`。重建期间查询走"实时直扫"兜底（不阻塞）。
3. **实时扫描打分**：对 `query` 用 `Intl.Segmenter('zh-CN', { granularity: 'word' })` 分词，遍历 `SearchCache` 中 24 个 store 的全部记录，按 3.2.1 节权重表对每个可搜字段做子串匹配，命中则累加 `weight × tf` 得分。
4. **截断**：按得分降序取 top N（默认 20，硬上限 50）。

**缓存失效机制**（不依赖 dbStores 钩子）：

- 监听服务器 `broadcastChange` 消息（WS 已有此消息类型，用于多端同步通知）：收到任意 `change` 消息即置 `cacheStale = true`。
- 本端写入路径终点（如 `saveNote` 完成）也通过一个统一的 `markSearchCacheStale()` 调用置失效——该调用集中加在 `dbStores/index.ts` 的 re-export 层包装器中，**只改 1 个文件**（`dbStores/index.ts`），不改 15 个 store 文件。
- 启动时 `cacheStale = true`，首次查询触发重建。

**分词规则**：
- 中文：`Intl.Segmenter` 词级切分。
- 英文/数字：按空白与标点切分，小写化。
- 停用词（"的/了/是/the/a/an"）过滤。

**性能预算**：
- 缓存重建：35 store × 平均 300 条 ≈ 10k 条，遍历 + 入缓存 <200ms（一次性）。
- 缓存命中查询：10k 条 × 4 字段子串匹配 <10ms。
- 缓存失效查询（实时直扫兜底）：同上 <50ms。

**不写实现代码**（本 Spec 只定设计，实现见 Phase 11 spec）。

### 3.4 移动端实现方案

**方案选型**：Room `LIKE '%query%'` 多表 `UNION ALL` 查询。

**选型理由**：
- 复用现有 `HistoryDao` 的 LIKE 查询模式，零新增依赖。
- SQLite `LIKE` 对中文子串天然支持（按字节匹配），无需自定义 tokenizer。
- 不用 `@Fts4`：FTS 中文支持差，需自定义 tokenizer，数据量小收益不抵成本。

**查询形态**：按 `type` 参数决定查单表或不传时 7 表 `UNION ALL`。结果按权重排序后截断 `limit`。

### 3.5 索引一致性

| 场景 | 桌面端 | 移动端 |
|------|--------|--------|
| 本端写入 | `dbStores/index.ts` re-export 包装器调用 `markSearchCacheStale()` 置缓存失效，下次查询时重建 | 无索引，下次查询直接 LIKE |
| 多端同步落库 | 服务器 `broadcastChange` → 客户端写入 IDB → 收到 `broadcastChange` 置 `cacheStale=true` → 下次查询重建 | 同步写入 Room → 下次查询 LIKE 自动覆盖 |
| 缓存丢失 | IndexedDB 仍在，下次查询自动重建缓存 | 无索引概念，不存在丢失 |

**关键保证**：
1. 同步落库与本地写入都走 IDB 同一条路径，缓存失效通过 `broadcastChange` + 本端写入包装器双重触发，满足"同步到本地的数据可被本地搜索覆盖"约束。
2. 缓存重建是幂等的：任何场景下 `cacheStale=true` 后下次查询都会从 IDB 重新读取，无需担心缓存与 IDB 不一致。
3. 不依赖 dbStores 的 save/delete 钩子（已验证不存在），仅依赖 IDB 读取路径，零侵入。

---

## 四、工具二：web_search（博查 Bocha）

### 4.1 工具定义

```typescript
interface WebSearchParams {
  /** 搜索关键词 */
  query: string;
  /** 返回条数，默认 10，硬上限 50 */
  count?: number;
  /** 时效性过滤：day/week/month/year（可选） */
  freshness?: 'day' | 'week' | 'month' | 'year';
  /** 是否返回博查 AI 总结的长摘要，默认 false */
  summary?: boolean;
}

interface WebSearchResult {
  results: WebSearchHit[];
  total: number;
}

interface WebSearchHit {
  title: string;
  url: string;
  snippet: string;
  /** 博查 AI 生成的长摘要（summary=true 时返回） */
  summary?: string;
  siteName?: string;
  siteIcon?: string;
  datePublished?: string;
}
```

### 4.2 服务器侧实现

**端点**：`POST https://api.bochaai.com/v1/web-search`

**请求头**：
```
Authorization: Bearer <bocha.apiKey>
Content-Type: application/json
```

**请求体**：
```json
{ "query": "...", "count": 10, "freshness": "week", "summary": false }
```

**响应字段映射**（注意博查返回为 camelCase）：

| 博查字段 | 工具返回字段 | 说明 |
|---------|------------|------|
| `name` | `title` | 页面标题 |
| `url` | `url` | 页面 URL |
| `snippet` | `snippet` | 摘要片段 |
| `summary` | `summary` | AI 长摘要（请求 summary=true 时） |
| `siteName` | `siteName` | 站点名 |
| `siteIcon` | `siteIcon` | 站点图标 URL |
| `datePublished` | `datePublished` | 发布日期 |

### 4.3 Key 管理

存服务器 `ai_settings` 表的 `searchKey.bocha` 字段（见 8.1 节）。客户端不持有。客户端通过服务器鉴权 API 修改（见 8.4 节）。

### 4.4 价格配额

- 单价：¥0.036/次
- QPS：1000-2000
- 免费试用额度（具体以博查官方为准）

### 4.5 Bing 兼容性

博查响应格式兼容 Bing Search API v7。未来若博查不可用，可平滑切换到 Bing Search API，仅需改 endpoint 与 Key，字段映射不变。

---

## 五、工具三：academic_search（Semantic Scholar）

### 5.1 工具定义

```typescript
interface AcademicSearchParams {
  query: string;
  /** 返回条数，默认 10，硬上限 100 */
  limit?: number;
  /** 偏移量，用于分页 */
  offset?: number;
  /** 年份过滤，如 "2020-2024" 或 "2024" */
  year?: string;
  /** 学科过滤：Computer Science/Biology/... */
  fieldsOfStudy?: string;
  /** 仅返回开放获取论文，默认 false */
  openAccessOnly?: boolean;
}

interface AcademicSearchResult {
  papers: AcademicPaper[];
  total: number;
}

interface AcademicPaper {
  paperId: string;
  title: string;
  abstract: string;
  authors: string[];
  year: number;
  venue: string;
  citationCount: number;
  /** 开放获取 PDF 信息（闭源论文为 null） */
  openAccessPdf?: {
    url: string;
    /** GREEN/GOLD/HYBRID/BRONZE/CLOSED */
    status: 'GREEN' | 'GOLD' | 'HYBRID' | 'BRONZE' | 'CLOSED';
    /** 许可证标识（如 CCBY / CC0 / NO-COMMERCIAL），可能为 null */
    license?: string;
  };
  externalIds?: {
    ArXiv?: string;
    DOI?: string;
  };
  /** Semantic Scholar 自动生成的论文一句话总结 */
  tldr?: { text: string };
}
```

### 5.2 服务器侧实现

**端点**：`GET https://api.semanticscholar.org/graph/v1/paper/search`

**请求头**：`x-api-key: <semanticScholar.apiKey>`

**Query 参数**：
```
query=<query>
fields=title,abstract,authors,year,externalIds,openAccessPdf,citationCount,venue,tldr
limit=<limit>
offset=<offset>
year=<year>
fieldsOfStudy=<fieldsOfStudy>
```

**响应映射**：直接透传 S2 返回的 `data` 数组到 `papers`，`total` 取 S2 的 `total` 字段。

**`openAccessOnly` 语义（重要）**：
- S2 API 本身不支持 `openAccessOnly` 参数，由服务器侧在 `papers` 数组上做客户端过滤（`p.openAccessPdf?.url` 非空才保留）。
- 但 `total` 字段**始终取 S2 原始查询的总数**（含非 OA 论文），不要用过滤后的 `papers.length` 覆盖；客户端可通过 `papers.length` 知道实际返回的 OA 论文数，通过 `total` 知道整个查询匹配的论文总数。
- ArXiv 兜底 URL（见 5.3 节）生成的 `openAccessPdf.url` 也算 OA，会被保留。

### 5.3 PDF 下载策略（重要）

| 论文状态 | 下载来源 | 说明 |
|---------|---------|------|
| `openAccessPdf.url` 存在 | 直下该 URL | 开放获取论文，无版权风险 |
| 仅有 `externalIds.ArXiv` | `https://arxiv.org/pdf/{id}.pdf` 兜底 | ArXiv 全开放 |
| 闭源（无上述两者） | 不提供 PDF | 仅返回元数据，`openAccessPdf` 为 null |

**status 字段语义**：
- `GREEN`/`GOLD`/`HYBRID`/`BRONZE`：不同程度的开放获取，均可下载。
- `CLOSED`：闭源，仅元数据。

**下载执行**：PDF 下载由客户端按返回的 URL 自行执行（浏览器直接打开或下载），服务器不中转大文件。

### 5.4 配额

- 带 Key：1 RPS（每秒 1 请求）
- 无 Key：1000 RPS 共享池（不稳定，不推荐生产用）

本项目服务器侧必带 Key。

### 5.5 批量查询

**端点**：`POST https://api.semanticscholar.org/graph/v1/paper/batch`

- 单次最多 500 个 `paperId`。
- 适用场景：用户已知一批 paperId（如从 `local_search` 或 `web_search` 结果收集），需批量补全元数据。
- 本工具不直接暴露批量接口给 LLM；批量查询作为服务器内部优化能力，供后续"多轮搜索补全"场景调用。

---

## 六、工具四：github_search（GitHub）

### 6.1 工具定义

```typescript
type GithubSearchMode =
  | 'search_repos'
  | 'search_code'
  | 'search_users'
  | 'search_issues'
  | 'download_release'
  | 'download_file';

interface GithubSearchParams {
  mode: GithubSearchMode;
  /** search_* 模式：搜索关键词；download_* 模式：owner/repo 等定位信息 */
  query?: string;
  /** download_* 模式必填：仓库归属 */
  owner?: string;
  repo?: string;
  /** download_release 模式：资产 id（已知时直接下）；不传则取 latest release */
  assetId?: number;
  /** download_file 模式：文件路径（相对仓库根） */
  path?: string;
  /** download_file 模式：git blob sha（优先于 path） */
  sha?: string;
  /** 通用：分页与过滤 */
  page?: number;
  perPage?: number;
  language?: string;
  sort?: string;
}

interface GithubSearchResult {
  mode: GithubSearchMode;
  // search_* 模式：命中列表
  items?: GithubRepoHit[] | GithubCodeHit[] | GithubUserHit[] | GithubIssueHit[];
  total?: number;
  // download_* 模式：下载信息（文件不存服务器，仅返回下载地址或 base64 内容）
  download?: {
    fileName: string;
    size: number;
    /** 小文件直接返回 base64 内容；大文件返回可下载 URL */
    content?: string;
    downloadUrl?: string;
  };
}

/** search_repos 模式命中项（精选 LLM 常用字段） */
interface GithubRepoHit {
  id: number;
  fullName: string;          // owner/repo
  description: string;
  htmlUrl: string;
  stargazersCount: number;
  forksCount: number;
  language: string;
  updatedAt: string;
  topics?: string[];
}

/** search_code 模式命中项 */
interface GithubCodeHit {
  name: string;              // 文件名
  path: string;              // 仓库内路径
  repo: { fullName: string; htmlUrl: string };
  htmlUrl: string;           // 文件在 GitHub 的网页地址
  score?: number;
}

/** search_users 模式命中项 */
interface GithubUserHit {
  login: string;
  htmlUrl: string;
  avatarUrl: string;
  type: string;              // User / Organization
  bio?: string;
  followers?: number;
  publicRepos?: number;
}

/** search_issues 模式命中项（含 PR） */
interface GithubIssueHit {
  id: number;
  number: number;
  title: string;
  state: 'open' | 'closed';
  htmlUrl: string;
  repo: { fullName: string };
  labels: string[];
  createdAt: string;
  updatedAt: string;
  isPr: boolean;             // true 表示这是 PR 而非 issue
}
```

### 6.2 服务器侧实现

#### 6.2.1 搜索端点

| Mode | 端点 | 必填认证 |
|------|------|---------|
| `search_repos` | `GET /search/repositories` | 推荐 |
| `search_code` | `GET /search/code` | **必填 token**（无 token 不可用） |
| `search_users` | `GET /search/users` | 推荐 |
| `search_issues` | `GET /search/issues` | 推荐 |

#### 6.2.2 下载端点

| Mode | 端点 | 说明 |
|------|------|------|
| `download_release` | `GET /repos/{owner}/{repo}/releases/latest` | 取最新 release 元数据 |
| `download_release`（资产） | `GET /repos/{owner}/{repo}/releases/assets/{asset_id}` | **注意：URL 中无 release_id**；请求头 `Accept: application/octet-stream` 触发 302 重定向到 CDN |
| `download_file`（路径） | `GET /repos/{owner}/{repo}/contents/{path}` | 默认返回 base64；加 `Accept: application/vnd.github.raw+json` 拿原始内容 |
| `download_file`（sha） | `GET /repos/{owner}/{repo}/git/blobs/{sha}` | 按 blob sha 直取 |

**认证**：所有请求头 `Authorization: Bearer <github.token>`。

### 6.3 配额

| 场景 | 配额 |
|------|------|
| 未认证 | 60 req/hour |
| PAT / GitHub App token | 5000 req/hour |
| Search API（通用） | 30 req/min |
| Code Search | 9 req/min |

本项目服务器侧必带 token，按 5000 req/hour 配额规划。

### 6.4 下载策略

| 文件大小 | 策略 |
|---------|------|
| <1MB | `contents` API，返回 base64 内容直接给客户端 |
| ≥1MB | `raw.githubusercontent.com` 直链 或 release asset 302 跳转，返回 `downloadUrl` 由客户端直下 |

**`download_file` + `sha` 路径的特殊行为（重要）**：
- 当 `mode=download_file` 且传了 `sha` 参数时，走 `GET /repos/{owner}/{repo}/git/blobs/{sha}` 端点（按 blob sha 直取）。
- git/blobs API 的响应**只有 `content`（base64）字段，没有 `download_url` 字段**，无法返回 `downloadUrl` 给客户端直下。
- 因此 `sha` 路径下**始终返回 `content`（base64）**，无论文件大小（即使 ≥1MB 也只能 base64，因为没有直链可用）；客户端解码后即可获得原文件。
- `path` 路径（无 `sha`）走 `contents` API，正常按大小分流（<1MB base64 / ≥1MB `downloadUrl`）。

**存储位置**：下载的文件存客户端本地（不存服务器），避免服务器磁盘与流量消耗。

### 6.5 认证方式

- **客户端**：不持有任何 GitHub token。客户端需要下载时，由服务器返回带短期签名的 `downloadUrl` 或 base64 内容。
- **服务器**：推荐用 GitHub App installation token（动态换取，可过期，比静态 PAT 安全）；Phase S9 起步阶段可用 PAT 写进 `ai_settings` 表的 `searchKey.github` 字段（见 8.1 节），后续升级为 GitHub App。

---

## 七、数据流与错误处理

### 7.1 数据流图

```
客户端发起对话
      │
      ▼
┌─────────────┐  user_message   ┌─────────────┐
│  客户端 UI   │ ──────────────▶ │  WS 网关     │
└─────────────┘                 └──────┬──────┘
                                       │ panelId 路由
                                       ▼
                              ┌─────────────┐
                              │  Pi Agent    │
                              │  AgentLoop   │
                              └──────┬──────┘
                                     │ 决定调用工具
                ┌────────────────────┼────────────────────┐
                │                    │                    │
        local_search          web/academic/         github_search
                │              github_search               │
                │ tool_call           │                     │
                ▼ (路由到客户端)      ▼ (服务器直连)         ▼
        ┌─────────────┐       ┌─────────────┐       ┌─────────────┐
        │ 客户端索引/   │       │ Bocha/S2/    │       │ GitHub API  │
        │ Room LIKE    │       │ (香港直连)    │       │             │
        └──────┬──────┘       └──────┬──────┘       └──────┬──────┘
               │ tool_result         │ sources             │ sources
               └────────────────────┼────────────────────┘
                                    ▼
                              ┌─────────────┐
                              │  Pi Agent    │
                              │ 基于 sources │
                              │  做总结      │
                              └──────┬──────┘
                                     │ 流式 pi_event
                                     ▼
                              ┌─────────────┐
                              │  客户端 UI   │
                              │ 显示总结 +   │
                              │ sources 引用 │
                              └─────────────┘
```

### 7.2 错误处理

| 错误类型 | 检测 | 返回 |
|---------|------|------|
| API Key 缺失 | 服务器调用前检查 `ai_settings` 表对应字段（`searchKey.bocha` / `searchKey.semanticScholar` / `searchKey.github`） | `tool_result.success=false`，error="未配置 XX API Key，请在设置中填写" |
| 配额超限（429） | 外部 API 返回 429 | 透传 `retry-after` 头信息，error="XX API 配额超限，N 秒后重试" |
| 网络错误 | fetch 抛异常或超时 | 最多重试 3 次（指数退避 1s/2s/4s），仍失败则 error="网络错误：{detail}" |
| API 返回业务错误 | HTTP 4xx/5xx 非 429 | 透传错误信息，error="XX API 返回错误：{status} {message}" |
| `local_search` 无在线设备 | 路由时 `panelActiveDevices[panelId]` 为空 | error="面板无在线设备，无法执行本地搜索" |
| `local_search` 查询超时 | 客户端 30s 未回 `tool_result` | 服务器按现有 `TOOL_TIMEOUT_MS` 超时机制返回 error |

所有错误均以 `tool_result.success=false` 形式进入 AgentLoop，由 LLM 决定是否告知用户或换工具重试。

---

## 八、安全与配额管理

### 8.1 API Key 集中管理

**验证结论**（基于 `server/src/piBridge.ts` + `server/src/routes/aiSettings.ts` 代码现状）：

- `AuthStorage` 来自 `@earendil-works/pi-coding-agent`，仅暴露 `setRuntimeApiKey(providerName, key)` 方法用于注入 LLM provider 的 API Key，**不支持自定义字段**（如 `bocha.apiKey` / `semanticScholar.apiKey` / `github.token`）。强行写入 `auth.json` 会被库忽略或破坏其内部 schema。
- `auth.json` 由库管理，路径为 `getAgentDir() + '/auth.json'`，本项目的代码不直接读写它。
- 现有 AI 设置 Key 已采用"存 `ai_settings` 表"的模式：`aiSettings.ts` 的 `PUT /api/ai/settings` 通过 `setSetting(SETTINGS_KEYS.API_KEY, apiKey)` 把 LLM Key 存入 `ai_settings` 表，`piBridge.ts` 启动时读取并调 `authStorage.setRuntimeApiKey` 注入到运行时。

**采纳方案**：搜索引擎 Key 复用现有 `ai_settings` 表存储模式，**不扩展 `auth.json`**。

**`ai_settings` 表新增 Key**（在 `server/src/db/aiSettingsStore.ts` 的 `SETTINGS_KEYS` 常量追加）：

```typescript
export const SETTINGS_KEYS = {
  // 现有
  MODEL: 'model',
  API_KEY: 'apiKey',           // LLM provider key
  ENDPOINT: 'endpoint',
  SYSTEM_PROMPT: 'systemPrompt',
  CANVAS_PROMPT: 'canvasPrompt',
  BROWSER_PROMPT: 'browserPrompt',
  // 新增：搜索引擎 Key
  SEARCH_KEY_BOCHA: 'searchKey.bocha',
  SEARCH_KEY_SEMANTIC_SCHOLAR: 'searchKey.semanticScholar',
  SEARCH_KEY_GITHUB: 'searchKey.github',
} as const
```

**读取入口**：在 `aiSettingsStore.ts` 新增 `getSearchKey(provider: 'bocha' | 'semanticScholar' | 'github'): Promise<string | null>`，piBridge 在创建 `web_search` / `academic_search` / `github_search` 工具的 `execute` 函数中调用此函数读取 Key。

**存储与读取规则**：
- 存储介质：PostgreSQL `ai_settings` 表（复用现有表结构，`key` 字段为 TEXT，`value` 字段为 TEXT）。
- 加密：`ai_settings` 表的 `value` 字段在数据库层加密（沿用现有 LLM Key 的加密策略；若现有未加密，搜索引擎 Key 同等处理，不额外加密）。
- 客户端不持有任何外部搜索 API Key。
- 客户端通过服务器鉴权 API 修改 Key（见 8.4 节，需 `authMiddleware` 校验 `SERVER_TOKEN`）。
- Key 不写日志、不下发客户端、不进 git。
- `auth.json` 保持原样不动，仅继续承载 LLM provider Key（由 `AuthStorage` 库内部管理）。

### 8.2 配额监控

- 服务器记录每次外部 API 调用：`{ provider, count, timestamp, latencyMs, status }`。
- 接近配额上限时（如 GitHub 4500/5000 req/hour），UI 提示预警。
- 配额数据存 PostgreSQL（复用现有 `ai_audit_log` 风格的表，或新增 `api_usage_log` 表）。

### 8.3 用户配置（搜索引擎与 LLM 分离）

| 配置维度 | 配置项 | 存储位置 | 与另一维度关系 |
|---------|--------|---------|--------------|
| **搜索引擎** | 博查 / 百度 / 秘塔（未来扩展） | 服务器 `ai_settings` | 与 LLM 无绑定 |
| **LLM** | provider/model/endpoint/key | 服务器 `ai_settings` + `auth.json`（仅 LLM provider key 走 AuthStorage） | 与搜索引擎无绑定 |

用户可自由组合，例如"博查搜索 + DeepSeek 总结"或"百度搜索 + GPT-4 总结"。两者切换互不影响。

### 8.4 搜索引擎 API Key 管理 API

**验证现状**（`server/src/routes/aiSettings.ts`）：
- 现有路由前缀 `/api/ai`，已实现 `GET /settings` / `PUT /settings` / `POST /test-connection` / `GET /prompts` / `PUT /prompts` / `POST /prompts/reset`。
- 现有路由**未挂载 `authMiddleware`**（鉴权由部署层/nginx 处理，或假定内网环境）。
- 新增搜索引擎 Key 管理 API 走独立路由前缀 `/api/search/keys`，便于后续单独加鉴权中间件。

**新增路由文件**：`server/src/routes/searchKeys.ts`，导出 `searchKeysRouter`，在 `server/src/index.ts`（或等价入口）以 `app.use('/api/search/keys', authMiddleware, searchKeysRouter)` 挂载。

**端点设计**：

| 方法 | 路径 | 用途 | 请求体 | 响应 |
|------|------|------|--------|------|
| `GET` | `/api/search/keys` | 查询所有搜索引擎 Key 的状态 | — | `{ providers: [{ provider: 'bocha', hasKey: boolean, updatedAt: number \| null }, ...] }` |
| `GET` | `/api/search/keys/:provider` | 查询单个 provider 的 Key 状态 | — | `{ provider: 'bocha', hasKey: boolean, updatedAt: number \| null }` |
| `PUT` | `/api/search/keys/:provider` | 更新指定 provider 的 Key | `{ key: string }` | `{ ok: true, provider, updatedAt: number }` |
| `DELETE` | `/api/search/keys/:provider` | 删除指定 provider 的 Key | — | `{ ok: true, provider }` |
| `POST` | `/api/search/keys/:provider/test` | 测试 Key 是否有效 | `{ key?: string }`（不传则用已存 Key） | `{ ok: boolean, latencyMs?: number, error?: string }` |

**`provider` 取值**：`bocha` / `semanticScholar` / `github`（与 8.1 节 `SETTINGS_KEYS.SEARCH_KEY_*` 一一对应）。

**鉴权**：
- 所有端点走 `authMiddleware`（校验 `SERVER_TOKEN`，复用现有鉴权中间件；若 `aiSettingsRouter` 当前未挂载，需同步补齐）。
- 防越权：未通过鉴权返回 401。

**响应字段规则**：
- `GET` 系列端点**只返回 `hasKey: boolean`**，**不返回明文 Key**（与 `aiSettingsRouter` 的 `GET /settings` 返回 `hasApiKey` 模式一致）。
- `updatedAt`：从 `ai_settings` 表的 `updated_at` 列读取（毫秒时间戳），便于客户端展示"上次更新时间"。

**`POST /test` 端点的测试逻辑**（按 provider 分支）：

| provider | 测试方式 | 成功条件 |
|---------|---------|---------|
| `bocha` | `POST https://api.bochaai.com/v1/web-search` 带 `query: 'test'` `count: 1` | HTTP 200 且响应可解析 |
| `semanticScholar` | `GET https://api.semanticscholar.org/graph/v1/paper/search?query=test&limit=1` | HTTP 200 且 `total` 字段存在 |
| `github` | `GET https://api.github.com/rate_limit` | HTTP 200 且响应包含 `resources.core.limit` |

测试请求不消耗显著配额（bocha 1 次、S2 1 次、GitHub rate_limit 不计入配额）。测试失败时返回 `{ ok: false, error: '...' }`，不抛 HTTP 5xx。

**实现要点**：
- `searchKeys.ts` 复用 `aiSettingsStore.ts` 的 `setSetting` / `getSetting` 函数，不新造存储层。
- `provider` 参数白名单校验：不在 `['bocha', 'semanticScholar', 'github']` 内返回 400。
- `PUT` 请求体 `key` 必须为非空字符串，否则 400。
- 删除 Key 后，piBridge 已在运行的工具实例下次 `execute` 时会读到 `null`，自动返回"未配置 Key"错误（无需重启 session）。

---

## 九、三端 roadmap 派发任务

### 9.1 服务器端（Phase S9：AI 搜索工具）

| 任务 | 详情 | 验收标准 |
|------|------|----------|
| 4 工具服务器侧注册 | `local_search` 加入 `DEVICE_SPECIFIC_TOOLS`；其余 3 个注册为服务器全局工具 | Pi Agent 可识别并调用 4 工具 |
| `web_search` 实现 | Bocha API 调用 + 字段映射 | 搜索返回正确 results |
| `academic_search` 实现 | S2 API 调用 + PDF 策略 | 返回 papers，openAccessPdf 字段正确 |
| `github_search` 实现 | 6 个 mode 全覆盖 | 各 mode 返回正确结构 |
| `ai_settings` 表扩展 | 新增 `searchKey.bocha` / `searchKey.semanticScholar` / `searchKey.github` 三个 key | Key 可读写、不下发客户端 |
| 搜索引擎 Key 管理 API | 新增 `/api/search/keys` 路由（见 8.4 节） | 4 个端点（GET/PUT/DELETE/POST test）均可用、走鉴权 |
| 配额监控 | `api_usage_log` 表 + 预警 | 调用记录可查，预警触发 |
| 错误处理 | Key 缺失/429/网络错误/超时 | 各错误返回明确提示 |

**估时**：1-2 周。

### 9.2 桌面端（Phase 11：AI 搜索集成）

| 任务 | 详情 | 验收标准 |
|------|------|----------|
| `local_search` 客户端实现 | 查询时实时扫描 + 内存缓存（`SearchCache`）+ `Intl.Segmenter` 分词 + `markSearchCacheStale()` 失效机制 | 搜索结果正确，缓存命中 <10ms，失效后 <50ms 重建 |
| `dbStores/index.ts` 包装器 | 在 re-export 层包装 `saveXxx`/`deleteXxx` 调用 `markSearchCacheStale()` | 只改 1 个文件，所有写入触发缓存失效 |
| WS `tool_call` 处理 | 接收 `local_search` 调用并执行、回 `tool_result` | 与服务器路由对接通 |
| 4 工具 UI 集成 | 搜索结果展示组件（sources 列表 + LLM 总结） | 4 类结果均可展示 |
| 点击跳转 | 本地数据点击跳转到对应面板/组件；网页/论文/GitHub 点击打开外链 | 跳转准确 |
| 同步后索引覆盖 | 同步落库后 `broadcastChange` 触发 `cacheStale=true`，下次查询重建 | 同步数据可被搜到 |

**估时**：1.5-2 周（较原 2-3 周下调，因无需改造 35 个 store 写入路径，仅在 `dbStores/index.ts` 加包装器）。

### 9.3 移动端（Phase M11：AI 搜索集成）

| 任务 | 详情 | 验收标准 |
|------|------|----------|
| `local_search` 客户端实现 | Room LIKE 多表 UNION | 7 表搜索结果正确 |
| WS `tool_call` 处理 | 与桌面端对称 | 路由对接通 |
| 4 工具 UI 集成 | 搜索结果展示组件 | 4 类结果均可展示 |
| 点击跳转 | 本地数据跳面板/组件；外链打开系统浏览器 | 跳转准确 |

**估时**：1-2 周。

---

## 十、验收标准

### 10.1 服务器端验收清单

- [ ] 4 个工具均注册到 Pi Agent，LLM 能在对话中正确调用
- [ ] `local_search` 通过 `DEVICE_SPECIFIC_TOOLS` 路由到 `panelActiveDevices[panelId]`
- [ ] `web_search` 调 Bocha 返回正确 results，字段映射无误
- [ ] `academic_search` 调 S2 返回 papers，`openAccessPdf` 与 `externalIds.ArXiv` 兜底逻辑正确
- [ ] `github_search` 6 个 mode 全部可用，`download_release` 资产下载 URL 无 release_id
- [ ] `ai_settings` 表三类搜索引擎 Key 可读写，客户端无法直接获取明文 Key（`GET /api/search/keys` 只返回 `hasKey`）
- [ ] `/api/search/keys` 4 个端点均走 `authMiddleware` 鉴权，未鉴权返回 401
- [ ] `POST /api/search/keys/:provider/test` 能正确判断 Key 是否有效（bocha/S2/github 三种测试逻辑均生效）
- [ ] API Key 缺失时返回"未配置 XX API Key"明确提示
- [ ] 429 错误透传 retry-after
- [ ] 网络错误重试 3 次后返回错误
- [ ] 配额监控表有调用记录，预警可触发

### 10.2 桌面端验收清单

- [ ] 首次查询触发 `SearchCache` 重建（24 个可索引 store），重建耗时 <200ms，内存占用合理（<50MB）
- [ ] `dbStores/index.ts` 包装器调用 `markSearchCacheStale()` 后，下次查询自动重建缓存，结果实时反映变更
- [ ] 缓存命中查询 <10ms，缓存失效后查询 <50ms
- [ ] 收到服务器 `broadcastChange` 消息后 `cacheStale=true`，下次查询重建
- [ ] 中文搜索正确分词（`Intl.Segmenter`），英文大小写不敏感
- [ ] 高/中/低权重打分排序符合预期
- [ ] 多端同步落库后，同步数据可被 `local_search` 搜到
- [ ] `local_search` 不发起任何网络请求（可用 DevTools Network 验证）
- [ ] 4 类搜索结果在 UI 正确展示
- [ ] 本地结果点击跳转到对应面板/组件
- [ ] 网页/论文/GitHub 结果点击打开外链
- [ ] LLM 基于 sources 做总结，总结中引用 sources

### 10.3 移动端验收清单

- [ ] 7 张 Room 表 LIKE 查询结果正确
- [ ] 不传 `type` 时多表 UNION 结果完整
- [ ] 中文子串匹配生效
- [ ] 同步落库后数据可被搜到
- [ ] `local_search` 不发起网络请求
- [ ] 4 类搜索结果在 UI 正确展示
- [ ] 本地结果点击跳转，外链打开系统浏览器

---

## 十一、未来扩展

| 方向 | 说明 | 触发条件 |
|------|------|---------|
| **自建搜索引擎** | 服务器部署 pgvector + FTS5，统一索引三端数据 | 数据量 >50k 条，或需要跨端统一搜索 |
| **垂直搜索** | 题库/论文/播客等垂直领域专用搜索 | 用户明确需求 |
| **多轮搜索** | AgentLoop 已原生支持多轮工具调用，无需额外开发 | 天然支持，如"先 web_search 再 academic_search 深挖" |
| **更多搜索引擎** | 百度 AI 搜索 / 秘塔 Search API | 博查不可用或用户偏好 |
| **GitHub App 升级** | PAT → GitHub App installation token | 安全要求提升 |
| **PDF 全文索引** | 下载的论文 PDF 提取文本进本地索引 | 学术搜索高频使用后 |
| **`tool_call_stream`** | 长任务流式反馈 | GitHub 大文件下载体验优化 |

---

## 已知问题与限制

> 详细评估见 [搜索工具现状评估报告](search-tools-audit-report.md)

### 搜索工具状态总览

| 工具 | 提供商 / mode | 状态 | 备注 |
|------|--------------|------|------|
| `local_search` | 本地设备搜索 | ✅ 可用 | 走客户端本地索引，不依赖外部 API |
| `web_search` | Bocha 网页搜索 | ❌ 质量极差 | 中文/技术内容覆盖差，考虑更换 |
| `github_search` | GitHub API | ❌ 完全不可用 | Token 已过期/被撤销，需更新 |
| `academic_search` | Semantic Scholar（S2） | ❌ 新论文覆盖差 | 索引慢，适合搜老论文 |
| `academic_search` | ArXiv（mode='latest'） | ✅ 可用 | 需在服务器网络环境调用 |

### 注意事项

- **ArXiv 搜索**必须在服务器网络环境中调用才稳定，本地直接调用可能出现 fetch failed
- **GitHub Token** 可能过期，使用前请先通过 `POST /api/search/keys/github/test` 测试有效性
- **Bocha 网页搜索**对中文/技术内容覆盖不足，未来可能需要更换为 Bing/Tavily/Google 等提供商

---

> 本 Spec 至此结束。实现时先读 [architecture_refactor.md](../architecture_refactor.md) 第三/十三章确认 per-panel 路由与轻 Agent 关系，再按第九章派发到三端。
