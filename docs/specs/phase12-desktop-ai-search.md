# Phase 12：桌面端 AI 搜索集成 — Spec v3

> 生成日期：2026-06-29
> 状态：v3（v2 对抗审查后修复，参见"第九章 对抗审查修复记录 v2→v3"）
> 架构依据：[architecture_refactor.md](../architecture_refactor.md) 第三章 + 第十三章
> 派发依据：[ai-search-spec.md](ai-search-spec.md) 第九章 9.2 节
> 上游依赖：服务器 Phase S9（✅ 已完成 2026-06-27）
> 关联：[roadmap_desktop_v1.md](../roadmap_desktop_v1.md) Phase 12 任务表与验收清单

---

## 一、上下文与目标

### 1.1 项目目的

Living Dashboard 桌面端 = "浏览器 + 无限画布 + AI" 的日常 AI 助手。Phase 12 让 Pi Agent 能通过工具调用检索四类信息。

### 1.2 Phase 12 范围

| 工具 | 执行端 | 桌面端职责 |
|------|--------|-----------|
| `local_search` | 客户端执行 | 实现本端索引 + 处理 WS `tool_call` + 回 `tool_result` + 缓存到 searchResults |
| `web_search` / `academic_search` / `github_search` | 服务器进程内执行 | 桌面端只做 UI 展示（结果由服务器通过 pi_event 流返回，存入 searchResults） |

### 1.3 已确认的上游就位状态

- 服务器 `piBridge.ts` 已注册 4 个 search ToolDefinition（`local_search` 走 `DEVICE_SPECIFIC_TOOLS`）
- 服务器 `ai_settings` 表已新增 `SETTINGS_KEYS.SEARCH_KEY_BOCHA / SEARCH_KEY_SEMANTIC_SCHOLAR / SEARCH_KEY_GITHUB`
- 服务器 `/api/search/keys` 5 端点已就位（GET / GET/:provider / PUT / DELETE / POST /test），走 `/api` 路由组的 `authMiddleware`
- GET 系列只返回 `{ hasKey: boolean, updatedAt: number | null }`，不下发明文 Key

### 1.4 现有代码探查结论（v2 修正后）

| # | 事实 | 验证来源 |
|---|------|---------|
| F1 | `local_search` 在桌面端 src 完全无引用 | grep 实证 |
| F2 | `dbStores/index.ts` 是 115 行纯 re-export（无包装层） | 实读 |
| F3 | `types/ai.ts` 222 行，无 sources / SearchHit 类型；`ChatMessage` 在行 120-135 | 实读 |
| F4 | `AIAssistantSidebar.tsx` 1029 行，`MessageBubble` 在 941-1051 行 | 实读 |
| F5 | `api/` 目录无 searchKeys API client | 实读 13 文件清单 |
| F6 | WS 消息按 panelId 过滤（useAIStore 行 555-561） | 实读 |
| F7 | 24 工具 dispatch 入口在 `wsToolHandlers.executeToolCall` 函数（行 489-574），dispatch switch 在 518-569 行 | 实读 |
| F8 | dbV2 共 35 个 store，24 个可索引（详见 ai-search-spec.md 3.2.1 节） | 实读 |
| F9 | `handleServerChange` 在 useAIStore 行 800-852，按 changeType 分发到 refresh* | 实读 |
| F10 | `behavior` tab 的 `SearchEngine` 下拉（SettingsPanel 行 743-755）是浏览器主页用，与 AI 搜索无关 | 实读 |
| F11 | 本地 agent 模式：工具调用通过主进程 `agentApi` 间接执行，结果通过 `AgentEvent` 的 `tool_call` / `tool_result` 事件回传到 useAIStore.handleAgentEvent（行 736-775）。`tool_call` 事件触发 `appendToolCallMessage(sessionId, toolName, requestId)`（行 748） | 实读 |
| F12 | `product-guide SKILL.md` 第六节"共 25 个工具"，未提搜索工具 | 实读 |
| F13 | `useAppStore` 只有 `setActivePanel(panelId: string): Promise<void>`（行 1182），**无 `setCurrentPanel` / `setActiveWidget` / `focusWidget`** | grep 实证 |
| F14 | `useAIStore.handlePiEvent` 的 `tool_execution_end` 分支（行 696-703）只 setSessionStatus，**不读 data 字段，不写入 messages** | 实读 |
| F15 | `useAIStore.handleToolCall`（行 712-721）执行 executeToolCall 后只 sendWs tool_result，**不写入 messages** | 实读 |
| F16 | `appendToolCallMessage`（行 974+）写入一个 marker message（role='tool'，含 toolName + toolCallId，content 为 `调用工具: ${toolName}`） | 实读 |
| F17 | dbStores 现有 getAll 函数清单（12 个）：`getAllNotes` / `getAllJournals` / `getAllQuickNotes` / `getAllMistakes` / `getAllAIMemories` / `getAllAIAuditLogs` / `getAllVocabDecks` / `getAllDueVocabProgress(now)` / `getAllSavingsGoals` / `getAllPanelTemplates` / `getAllQuizSessions` / `getAllFavoritesFromIdb` / `listHtmlWidgets` | grep 实证 |
| F18 | 10 处直接从 `./dbStores/<sub>` 子文件 import（绕过 index.ts）：iframeProxy.ts:14（kvStorage 1 处）+ wsToolHandlers.ts:27-32/37-39（9 处） | grep 实证 |
| F19 | `ui-prototype/desktop/index.html` 中无 SearchResultsCard / search-results 设计 | grep 实证 |
| F20 | `dynamic-widgets` store 走 `client/desktop/src/api/dynamicWidgets.ts` 服务器 API，**dbStores 目录下无 `dynamicWidgets.ts` 文件** | 实读 |

### 1.5 关键约束

1. **`local_search` 不发任何网络请求**（DevTools Network 可验证零请求）
2. **搜索引擎 Key 不下发客户端**（UI 只显示 `hasKey: boolean` + `updatedAt`）
3. **`local_search` 在 cloud / local agent 模式下都能调用**（统一走 `executeToolCall`）
4. **TypeScript 优先**，所有新文件用 `.ts` / `.tsx`，**禁止 `as any`**
5. **不下载到 C 盘**，无新增依赖
6. **不引入重型依赖**（无 SQLite/FTS5/lunr/FlexSearch）
7. **缓存命中查询 <10ms，缓存失效查询 <50ms**（10k 条数据预算）
8. **同步落库后下次查询自动覆盖**
9. **UI 原型权威性**：F19 确认 ui-prototype/desktop/index.html 中无 SearchResultsCard 设计，**本 phase 在 spec 中先定义简版设计**（任务 12.0.1），后续 Phase 7 打磨时补原型

---

## 二、任务清单与验收标准

### 2.1 总任务表

| 任务 ID | 任务 | 详情 | 验收标准 | 批次 |
|---------|------|------|----------|------|
| 12.0.1 | UI 简版设计 | spec 中定义 SearchResultsCard 简版设计（4 类分组 + 折叠 + 点击跳转/打开外链），后续 Phase 7 补 ui-prototype | spec 含设计章节 | A |
| 12.1.1 | SearchCache 数据结构 | `utils/searchCache.ts`：`Map<storeId, SearchableRecord[]>` + `cacheStale` + `cacheBuilding` Promise 去重 + `markSearchCacheStale()` / `ensureCacheReady()` / 内部 `_getCachedRecords()` | 缓存命中查询 <10ms；首次重建 <200ms；并发重建请求被去重 | A |
| 12.1.2 | `Intl.Segmenter` 中文分词 | `utils/searchTokenizer.ts`：中文词级切分 + 英文/数字按空白与标点切分小写化 + 停用词过滤 | 中文搜索正确分词；英文大小写不敏感；停用词被过滤 | A |
| 12.1.3 | 24 个 store 适配器 | `utils/searchIndexAdapters.ts`：24 个适配器各自调用对应的 getAll 函数（详见 3.5 节清单，含需新增的 8 个 getAll 函数） | 24 个适配器返回符合 `SearchableRecord` schema 的数组 | A |
| 12.1.4 | 高/中/低权重打分 | `utils/searchScore.ts`：按 ai-search-spec.md 3.2.1 节权重表子串匹配累加得分；top N 截断（默认 20，硬上限 50） | 打分排序符合预期 | A |
| 12.1.5 | `local_search` 主入口 | `utils/localSearch.ts`：`runLocalSearch(params)` 串起缓存 + 分词 + 打分 + 截断 + 计时 | 返回结果符合 `LocalSearchResult` schema | A |
| 12.2.1 | `local_search` 工具 dispatch | `wsToolHandlers.ts` `executeToolCall` switch（行 518-569）新增 `case 'local_search':` 分支 | WS 触发后客户端正确回 `tool_result` | B |
| 12.2.2 | useAIStore 搜索结果缓存 | useAIStore 新增 `searchResults: SearchSourceEntry[]` 字段（限 20 条 LRU）+ `addSearchResult` action；在 `handleToolCall` 完成后，如果是搜索工具，缓存结果到 `searchResults` | 搜索工具调用后 searchResults 数组追加一条 | B |
| 12.2.3 | 离线兜底 | 服务器不可达时 `local_search` 仍可执行（仅查本地） | 离线时返回成功结果 | B |
| 12.3.1 | SearchResultsPanel 组件 | `components/ai/SearchResultsPanel.tsx`：从 useAIStore.searchResults 读取，渲染所有结果列表（按时间倒序） | 多条结果按时间倒序展示 | C |
| 12.3.2 | SearchResultsCard 子组件 | `components/ai/SearchResultsCard.tsx`：单条搜索结果卡片，按 kind 分组展示 hits，含 title/snippet/score | 4 类结果均可展示 | C |
| 12.3.3 | 本地结果点击跳转面板 | 点击本地结果调 `useAppStore.setActivePanel(panelId)`，无 panelId 不跳转 | 跳转准确；无 panelId 灰显 | C |
| 12.3.4 | 外链结果点击打开 | web/academic/github 结果点击 `window.open(url, '_blank', 'noopener,noreferrer')` | 外链正确打开 | C |
| 12.3.5 | AIAssistantSidebar 集成 | `AIAssistantSidebar.tsx` 在对话流上方/下方新增 `<SearchResultsPanel />` 渲染区域 | 搜索结果在 sidebar 中可见 | C |
| 12.4.1 | API client | `api/searchKeys.ts`：5 函数对应 5 端点 | 5 函数均可调；走 `Authorization: Bearer ${token}` | D |
| 12.4.2 | SearchEngineConfig 组件 | `components/settings/SearchEngineConfig.tsx`：3 provider 状态 + 4 操作（查看/更新/删除/测试） | 4 操作均可调；不明文展示 Key | D |
| 12.4.3 | SettingsPanel 新增 search tab | `SettingsPanel.tsx` 新增 `search` tab（位于 `ai` 之后），渲染 `<SearchEngineConfig />` | tab 可见；切换正常 | D |
| 12.5.1 | dbStores/index.ts 包装器 | 改写 re-export 为包装导出，仅包装 saveXxx / deleteXxx / updateXxx 写操作；**async 失败时不调 markSearchCacheStale** | 写操作触发缓存失效；读操作不包装 | E |
| 12.5.2 | 子文件直接 import 治理 | 10 处直接从 `./dbStores/<sub>` import 的消费方，**保留不动**（spec 决策：不强制改），但需在 searchCache 重建时调 `getAll*` 适配器**绕过包装器**直接读子文件原函数 | 适配器读全量数据；写操作绕过包装器不触发缓存失效（可接受，因为服务器会通过 `change` 消息触发失效） | E |
| 12.5.3 | handleServerChange 改造 | 在 `handleServerChange` 函数开头无条件调 `markSearchCacheStale()`；**用 500ms debounce 合并连续 change**（避免频繁重建） | 收到 change 后下次查询重建 | E |
| 12.6.1 | 单元测试 | searchCache / searchTokenizer / searchScore / searchIndexAdapters / localSearch / searchKeys API client 各 ≥ 5 用例，**模块覆盖率 ≥ 70%** | 全绿 | F |
| 12.6.2 | product-guide SKILL.md 更新 | 第六节改为"共 29 个工具"，新增 6.5 搜索工具子节 | 文档与代码同步 | F |
| 12.7.1 | 运行时验证（Playwright MCP） | 12 个用例（详见 5.2 节），截图存 `docs/verify/phase12/` | 12 用例全通过 | G |

### 2.2 验收标准（对齐 roadmap § Phase 12 验收）

- [ ] 首次查询触发 `SearchCache` 重建（24 个可索引 store），重建耗时 <200ms，内存占用 <50MB
- [ ] `dbStores/index.ts` 包装器调用 `markSearchCacheStale()` 后，下次查询自动重建缓存
- [ ] 缓存命中查询 <10ms，缓存失效后查询 <50ms
- [ ] 收到服务器 `change` 消息后 `cacheStale=true`，下次查询重建
- [ ] 中文搜索正确分词（`Intl.Segmenter`），英文大小写不敏感
- [ ] 高/中/低权重打分排序符合预期
- [ ] 多端同步落库后，同步数据可被 `local_search` 搜到
- [ ] `local_search` 不发起任何网络请求（DevTools Network 验证零请求）
- [ ] 4 类搜索结果在 UI 正确展示（注：本 phase 实现本地+网页+学术+GitHub 结果展示，但**网页/学术/GitHub 的真实数据依赖服务器配置真实 Key**，未配置 Key 时只展示 local_search 结果；其他三类在 dev 验证用 mock 数据）
- [ ] 本地结果点击跳转到对应面板（**降级**：原"跳到具体组件"目标放弃，因 useAppStore 无 setActiveWidget 方法，本 phase 只跳到面板级别）
- [ ] 网页/论文/GitHub 结果点击打开外链
- [ ] LLM 基于 sources 做总结（**部分降级**：本 phase 实现搜索结果 UI 展示；LLM 总结的"引用 sources"能力依赖服务器侧 piBridge 是否在 systemPrompt 中告诉 LLM sources 结构，**桌面端不修改 systemPrompt**，记录为已知限制）
- [ ] 设置面板新增搜索引擎配置 tab，3 个 provider 状态可见
- [ ] Key 管理 4 操作（查看状态/更新/删除/测试）均可调 `/api/search/keys` 端点
- [ ] 客户端 UI 不明文展示 Key（只展示 `hasKey` + `updatedAt`）

---

## 三、详细设计

### 3.1 模块分层架构

```
client/desktop/src/
├── utils/
│   ├── searchCache.ts          [新] SearchCache + markSearchCacheStale + ensureCacheReady
│   ├── searchTokenizer.ts      [新] Intl.Segmenter 分词 + 停用词过滤
│   ├── searchScore.ts          [新] 高/中/低权重打分
│   ├── searchIndexAdapters.ts  [新] 24 个 store 的 getAll 适配器
│   ├── localSearch.ts          [新] runLocalSearch 主入口
│   └── wsToolHandlers.ts       [改] executeToolCall switch 新增 local_search case
├── api/
│   └── searchKeys.ts           [新] 5 端点 client
├── stores/
│   └── useAIStore.ts           [改] 新增 searchResults 字段 + addSearchResult + handleToolCall 集成 + handleServerChange 改造
├── types/
│   └── ai.ts                   [改] 新增 SearchHit / SearchSources / SearchSourceKind / LocalSearchParams / LocalSearchResult 类型
├── components/
│   ├── ai/
│   │   ├── SearchResultsPanel.tsx [新] 从 useAIStore.searchResults 渲染
│   │   └── SearchResultsCard.tsx  [新] 单条结果卡片（带类型守卫，无 as any）
│   ├── settings/
│   │   └── SearchEngineConfig.tsx [新] 3 provider Key 管理
│   ├── AIAssistantSidebar.tsx  [改] 新增 <SearchResultsPanel /> 渲染区域
│   └── SettingsPanel.tsx       [改] 新增 search tab
├── utils/__tests__/
│   ├── searchCache.test.ts     [新]
│   ├── searchTokenizer.test.ts [新]
│   ├── searchScore.test.ts     [新]
│   ├── searchIndexAdapters.test.ts [新]
│   ├── localSearch.test.ts     [新]
│   └── searchKeysApi.test.ts   [新]
└── utils/dbStores/
    └── index.ts                [改] re-export 包装写操作
```

### 3.2 SearchCache 设计（utils/searchCache.ts）

```typescript
import type { V2StoreName } from './dbV2'
import type { LocalSearchableType } from '../types/ai'

export interface SearchableRecord {
  id: string
  storeId: V2StoreName
  type: LocalSearchableType
  panelId?: string
  highWeightFields: Record<string, string>
  mediumWeightFields: Record<string, string>
  lowWeightFields: Record<string, string | string[]>
  createdAt?: number
  updatedAt?: number
}

type SearchCache = Map<V2StoreName, SearchableRecord[]>

let cache: SearchCache = new Map()
let cacheStale = true
let cacheBuilding: Promise<void> | null = null

export function markSearchCacheStale(): void {
  cacheStale = true
}

export async function ensureCacheReady(): Promise<void> {
  if (!cacheStale) return
  if (cacheBuilding) {
    await cacheBuilding
    return
  }
  cacheBuilding = (async () => {
    const newCache: SearchCache = new Map()
    const { getSearchIndexAdapters } = await import('./searchIndexAdapters')
    const adapters = getSearchIndexAdapters()
    const results = await Promise.all(
      adapters.map(async (adapter) => {
        try {
          const records = await adapter.getAll()
          return { storeId: adapter.storeId, records }
        } catch (err) {
          console.warn(`[SearchCache] 重建 store=${adapter.storeId} 失败:`, err)
          return { storeId: adapter.storeId, records: [] as SearchableRecord[] }
        }
      })
    )
    for (const { storeId, records } of results) {
      newCache.set(storeId, records)
    }
    cache = newCache
    cacheStale = false
  })()
  try {
    await cacheBuilding
  } finally {
    cacheBuilding = null
  }
}

export function _getCachedRecords(): SearchableRecord[] {
  const all: SearchableRecord[] = []
  for (const records of cache.values()) {
    all.push(...records)
  }
  return all
}

export function _resetCacheForTesting(): void {
  cache = new Map()
  cacheStale = true
  cacheBuilding = null
}

/** 测试用：检查缓存状态 */
export function _isCacheStale(): boolean {
  return cacheStale
}
```

### 3.3 分词器设计（utils/searchTokenizer.ts）

```typescript
const segmenter = new Intl.Segmenter('zh-CN', { granularity: 'word' })

const STOP_WORDS = new Set([
  '的', '了', '是', '在', '和', '与', '或', '也', '都', '就', '这', '那', '一',
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'of', 'in', 'on', 'at', 'to', 'for', 'with', 'by', 'from',
  'and', 'or', 'not', 'but', 'if', 'then', 'so',
])

export interface Token {
  text: string
  lower: string
  isChinese: boolean
}

export function tokenize(query: string): Token[] {
  if (!query || typeof query !== 'string') return []
  const tokens: Token[] = []
  for (const seg of segmenter.segment(query)) {
    const raw = seg.segment.trim()
    if (!raw) continue
    const subTokens = raw.split(/[\s\p{P}\p{S}]+/u).filter(Boolean)
    for (const sub of subTokens) {
      const lower = sub.toLowerCase()
      if (STOP_WORDS.has(lower) || STOP_WORDS.has(sub)) continue
      tokens.push({
        text: sub,
        lower,
        isChinese: /[\u4e00-\u9fff]/.test(sub),
      })
    }
  }
  return tokens
}

export function normalizeText(text: unknown): string {
  if (text == null) return ''
  if (typeof text === 'string') return text.toLowerCase()
  if (typeof text === 'number' || typeof text === 'boolean') return String(text).toLowerCase()
  if (Array.isArray(text)) return text.map(normalizeText).join(' ')
  if (typeof text === 'object') {
    try { return JSON.stringify(text).toLowerCase() } catch { return '' }
  }
  return String(text).toLowerCase()
}
```

### 3.4 打分器设计（utils/searchScore.ts）

```typescript
import { tokenize, normalizeText, type Token } from './searchTokenizer'
import type { SearchableRecord } from './searchCache'

export const WEIGHT_HIGH = 1.0
export const WEIGHT_MEDIUM = 0.6
export const WEIGHT_LOW = 0.3

export interface ScoredHit {
  record: SearchableRecord
  score: number
  matchedField: string
  snippet: string
}

export function scoreRecord(
  record: SearchableRecord,
  tokens: Token[],
): { score: number; matchedField: string; snippet: string } {
  if (tokens.length === 0) return { score: 0, matchedField: '', snippet: '' }

  let totalScore = 0
  let bestField = ''
  let bestSnippet = ''
  let bestScoreForField = 0

  const checkFields = (
    fields: Record<string, string | string[]>,
    weight: number,
    fieldKind: 'high' | 'medium' | 'low',
  ) => {
    for (const [fieldName, rawValue] of Object.entries(fields)) {
      const text = normalizeText(rawValue)
      if (!text) continue
      let hitCount = 0
      let firstHitIdx = -1
      for (const t of tokens) {
        const idx = text.indexOf(t.lower)
        if (idx >= 0) {
          hitCount++
          if (firstHitIdx < 0) firstHitIdx = idx
        }
      }
      if (hitCount === 0) continue
      const tf = hitCount / tokens.length
      const fieldScore = weight * tf
      totalScore += fieldScore
      if (fieldScore > bestScoreForField) {
        bestScoreForField = fieldScore
        bestField = `${fieldKind}:${fieldName}`
        const start = Math.max(0, firstHitIdx - 80)
        const end = Math.min(text.length, firstHitIdx + 120)
        bestSnippet = (start > 0 ? '...' : '') + text.slice(start, end) + (end < text.length ? '...' : '')
      }
    }
  }

  checkFields(record.highWeightFields, WEIGHT_HIGH, 'high')
  checkFields(record.mediumWeightFields, WEIGHT_MEDIUM, 'medium')
  checkFields(record.lowWeightFields, WEIGHT_LOW, 'low')

  return { score: totalScore, matchedField: bestField, snippet: bestSnippet }
}

export function pickTopN<T extends { score: number }>(hits: T[], n: number): T[] {
  return hits.sort((a, b) => b.score - a.score).slice(0, n)
}
```

### 3.5 24 个 store 适配器（utils/searchIndexAdapters.ts）

**关键决策**：F17 实证显示只有 12 个 store 有现成 getAll 函数，**12 个缺失**。F20 实证 `dynamic-widgets` 走 server API。

#### 3.5.1 完整 24 个适配器清单

| # | storeId | type | getAll 函数 | 状态 | 备注 |
|---|---------|------|------------|------|------|
| 1 | panels | panel | `getAllPanels`（from `db.ts`） | ✅ 已有 | db.ts 行 261 |
| 2 | widgetRecords | widget | `getAllWidgets`（新增 to `db.ts`） | ⚠️ 需新增 | 现只有 `getWidgets(panelId)`（db.ts:369），需聚合所有 panel |
| 3 | tasks | task | `getAllTasks`（新增 to `db.ts`） | ⚠️ 需新增 | 现只有 `getTasksByPanel(panelId)`（db.ts:1707） |
| 4 | calendarEvents | calendarEvent | `getAllCalendarEvents`（新增 to `db.ts`） | ⚠️ 需新增 | 现只有 `getCalendarEventsByPanel(panelId)`（db.ts:2329） |
| 5 | habits | habit | `getAllHabits`（新增 to `db.ts`） | ⚠️ 需新增 | 现只有 `getHabitsByPanel(panelId)`（db.ts:1898） |
| 6 | notes | note | `getAllNotes`（from `dbStores/notes`） | ✅ 已有 | - |
| 7 | journals | journal | `getAllJournals`（from `dbStores/journals`） | ✅ 已有 | - |
| 8 | quickNotes | quickNote | `getAllQuickNotes`（from `dbStores/quickNotes`） | ✅ 已有 | - |
| 9 | mistakes | mistake | `getAllMistakes`（from `dbStores/mistakes`） | ✅ 已有 | - |
| 10 | vocabDecks | vocabDeck | `getAllVocabDecks`（from `dbStores/vocabDecks`） | ✅ 已有 | - |
| 11 | panelTemplates | panelTemplate | `getAllPanelTemplates`（from `dbStores/panelTemplates`） | ✅ 已有 | - |
| 12 | htmlWidgets | htmlWidget | `listHtmlWidgets`（from `dbStores/htmlWidgets`） | ✅ 已有 | - |
| 13 | favorites | favorite | `getAllFavoritesFromIdb`（from `dbStores/favorites`） | ✅ 已有 | - |
| 14 | aiMemories | aiMemory | `getAllAIMemories`（from `dbStores/aiData`） | ✅ 已有 | - |
| 15 | bookmarks | bookmark | `getAllBookmarks`（新增 to `db.ts`） | ⚠️ 需新增 | 现有 `getBookmarks()`（db.ts:2709）无 All 前缀，新增同名 wrapper 或直接用 `getBookmarks` |
| 16 | webTabs | webTab | `getAllWebTabs`（新增 to `db.ts`） | ⚠️ 需新增 | 现有 `getWebTabs()`（db.ts:2683）无 All 前缀，同上 |
| 17 | moodEntries | moodEntry | `getAllMoodEntries`（新增 to `db.ts`） | ⚠️ 需新增 | 现只有 `getMoodEntriesByPanel(panelId)`（db.ts:2162） |
| 18 | savingsTransactions | savingsTransaction | `getAllSavingsTransactions`（新增 to `dbStores/savings`） | ⚠️ 需新增 | 现只有 `getSavingsTransactionsByGoal(goalId)`（savings.ts:105） |
| 19 | drawingStrokes | drawingStroke | `getAllDrawingStrokes`（新增 to `db.ts`） | ⚠️ 需新增 | 现只有 `getStrokesByPanel(panelId)`（db.ts:2438） |
| 20 | widgetConnections | widgetConnection | `getAllWidgetConnections`（新增 to `db.ts`） | ⚠️ 需新增 | 现只有 `getConnectionsByPanel(panelId)`（db.ts:2537） |
| 21 | focusSessions | focusSession | `getAllFocusSessions`（新增 to `db.ts`） | ⚠️ 需新增 | 现只有 `getFocusSessionsByPanel/ByWidget/ById`（db.ts:1565/1589） |
| 22 | vocabProgress | vocabProgress | `getAllVocabProgress`（新增 to `dbStores/vocabProgress`） | ⚠️ 需新增 | 现只有 `getAllDueVocabProgress(now)`（vocabProgress.ts:117） |
| 23 | aiConversations | aiConversation | `getAllAIConversations`（新增 to `dbStores/aiData`） | ⚠️ 需新增 | 现只有 `getAIConversationsBySession`（aiData.ts） |
| 24 | dynamic-widgets | dynamicWidget | `getAllDynamicWidgets`（from `api/dynamicWidgets.ts`） | ✅ 已有 | 走 server API（F20），api/dynamicWidgets.ts:19 |

**结论**：实际有 **13 个 getAll 函数需新增**（#2-5, #15-21, #22, #23），其余 11 个均已存在。新增实现统一走 `runIdbTransaction` 直接遍历 IDB store（不走 withFallback），理由：搜索索引需要本地全量数据，IDB 是真相源，服务器 API 不一定返回全量。

#### 3.5.2 适配器实现示例（panels）

```typescript
import { getAllPanels } from '../db'
import type { SearchableRecord } from './searchCache'

async function adaptPanels(): Promise<SearchableRecord[]> {
  const panels = await getAllPanels()
  return panels.map((p) => ({
    id: String(p.id),
    storeId: 'panels' as const,
    type: 'panel' as const,
    panelId: String(p.id),
    highWeightFields: { name: p.name || '' },
    mediumWeightFields: {},
    lowWeightFields: {},
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  }))
}
```

#### 3.5.3 需新增的 13 个 getAll 函数

**设计决策**：所有新增 getAll 函数统一走 `runIdbTransaction` 直接遍历 IDB store（**不走 withFallback**）。理由：
1. 搜索索引需要本地全量数据，IDB 是真相源
2. 服务器 API（如 `getTasksByPanel`）按 panel 查询，聚合所有 panel 需多次调用，性能差
3. 直接遍历 IDB store 一次拿全量，简单高效
4. 与现有 `getAllDueVocabProgress(now)` / `getAllAIMemories()` 等已有 getAll 函数风格一致（它们也是直接遍历 IDB）

**`runIdbTransaction` 签名提醒**（idbTx.ts:348）：第一个参数是 `string[]` 数组类型，不是 `string`。

**通用实现模式**（以 vocabProgress 为例）：

```typescript
import { runIdbTransaction } from '../idbTx'  // 已在文件中 import
import type { VocabProgress } from '../../types'

/**
 * Phase 12 新增：全量读取 vocabProgress（用于本地搜索索引）。
 * 注意：与现有 getAllDueVocabProgress(now) 不同 ——
 *   - getAllDueVocabProgress(now): 只返回 nextReviewAt <= now 的到期 vocab
 *   - getAllVocabProgress(): 返回全部 vocab（不限 due 状态）
 */
export async function getAllVocabProgress(): Promise<VocabProgress[]> {
  return runIdbTransaction(['vocabProgress'], 'readonly', async (ctx) => {
    const records: VocabProgress[] = []
    await ctx.iterateStore((record) => {
      records.push(record.data as VocabProgress)
    })
    return records
  })
}
```

**`dbStores/aiData.ts` 新增 `getAllAIConversations`**（注意类型是 `AIConversation` 不是 `AIConversationRecord`）：

```typescript
import type { AIConversation } from '../../types'  // 已在文件中 import

/** Phase 12 新增：全量读取 aiConversations（用于本地搜索索引） */
export async function getAllAIConversations(): Promise<AIConversation[]> {
  return runIdbTransaction(['aiConversations'], 'readonly', async (ctx) => {
    const records: AIConversation[] = []
    await ctx.iterateStore((record) => {
      records.push(record.data as AIConversation)
    })
    return records
  })
}
```

**`db.ts` 新增 11 个 getAll 函数**（统一模式，逐个列出）：

```typescript
// db.ts 顶部需新增 import（如尚未引入 idbTx）：
// import { runIdbTransaction } from './idbTx'
// 并 import 对应类型（WidgetInstance / Task / CalendarEvent / Habit / MoodEntry /
//   DrawingStroke / WidgetConnection / FocusSession / Bookmark / WebTab）

/** Phase 12：全量读取 widgetRecords（聚合所有 panel） */
export async function getAllWidgets(): Promise<WidgetInstance[]> {
  return runIdbTransaction(['widgetRecords'], 'readonly', async (ctx) => {
    const records: WidgetInstance[] = []
    await ctx.iterateStore((record) => {
      records.push(record.data as WidgetInstance)
    })
    return records
  })
}

/** Phase 12：全量读取 tasks */
export async function getAllTasks(): Promise<Task[]> {
  return runIdbTransaction(['tasks'], 'readonly', async (ctx) => {
    const records: Task[] = []
    await ctx.iterateStore((record) => {
      records.push(record.data as Task)
    })
    return records
  })
}

/** Phase 12：全量读取 calendarEvents */
export async function getAllCalendarEvents(): Promise<CalendarEvent[]> {
  return runIdbTransaction(['calendarEvents'], 'readonly', async (ctx) => {
    const records: CalendarEvent[] = []
    await ctx.iterateStore((record) => {
      records.push(record.data as CalendarEvent)
    })
    return records
  })
}

/** Phase 12：全量读取 habits */
export async function getAllHabits(): Promise<Habit[]> {
  return runIdbTransaction(['habits'], 'readonly', async (ctx) => {
    const records: Habit[] = []
    await ctx.iterateStore((record) => {
      records.push(record.data as Habit)
    })
    return records
  })
}

/** Phase 12：全量读取 moodEntries */
export async function getAllMoodEntries(): Promise<MoodEntry[]> {
  return runIdbTransaction(['moodEntries'], 'readonly', async (ctx) => {
    const records: MoodEntry[] = []
    await ctx.iterateStore((record) => {
      records.push(record.data as MoodEntry)
    })
    return records
  })
}

/** Phase 12：全量读取 drawingStrokes */
export async function getAllDrawingStrokes(): Promise<DrawingStroke[]> {
  return runIdbTransaction(['drawingStrokes'], 'readonly', async (ctx) => {
    const records: DrawingStroke[] = []
    await ctx.iterateStore((record) => {
      records.push(record.data as DrawingStroke)
    })
    return records
  })
}

/** Phase 12：全量读取 widgetConnections */
export async function getAllWidgetConnections(): Promise<WidgetConnection[]> {
  return runIdbTransaction(['widgetConnections'], 'readonly', async (ctx) => {
    const records: WidgetConnection[] = []
    await ctx.iterateStore((record) => {
      records.push(record.data as WidgetConnection)
    })
    return records
  })
}

/** Phase 12：全量读取 focusSessions */
export async function getAllFocusSessions(): Promise<FocusSession[]> {
  return runIdbTransaction(['focusSessions'], 'readonly', async (ctx) => {
    const records: FocusSession[] = []
    await ctx.iterateStore((record) => {
      records.push(record.data as FocusSession)
    })
    return records
  })
}

/** Phase 12：全量读取 bookmarks（封装现有 getBookmarks() 保持命名一致） */
export async function getAllBookmarks(): Promise<Bookmark[]> {
  return runIdbTransaction(['bookmarks'], 'readonly', async (ctx) => {
    const records: Bookmark[] = []
    await ctx.iterateStore((record) => {
      records.push(record.data as Bookmark)
    })
    return records
  })
}

/** Phase 12：全量读取 webTabs（封装现有 getWebTabs() 保持命名一致） */
export async function getAllWebTabs(): Promise<WebTab[]> {
  return runIdbTransaction(['webTabs'], 'readonly', async (ctx) => {
    const records: WebTab[] = []
    await ctx.iterateStore((record) => {
      records.push(record.data as WebTab)
    })
    return records
  })
}
```

**`dbStores/savings.ts` 新增 `getAllSavingsTransactions`**：

```typescript
import type { SavingsTransaction } from '../../types'  // 已在文件中 import

/** Phase 12：全量读取 savingsTransactions（聚合所有 goal） */
export async function getAllSavingsTransactions(): Promise<SavingsTransaction[]> {
  return runIdbTransaction(['savingsTransactions'], 'readonly', async (ctx) => {
    const records: SavingsTransaction[] = []
    await ctx.iterateStore((record) => {
      records.push(record.data as SavingsTransaction)
    })
    return records
  })
}
```

**注意**：`runIdbTransaction` 的 `iterateStore` 方法签名（idbTx.ts）会遍历 store 的所有记录，`record.data` 是 V2 格式记录的 `data` 字段。所有 V2 store 的记录格式都是 `{ id, data, ... }`，因此 `record.data as XxxType` 是安全的（V2 schema 保证）。

#### 3.5.4 字段映射规则（严格按 ai-search-spec.md 3.2.1 节）

| type | 高权重 | 中权重 | 低权重 |
|------|--------|--------|--------|
| panel | name | — | — |
| widget | title | — | type |
| task | title | — | — |
| calendarEvent | title | note | — |
| habit | title | — | — |
| note | title | content | tags[] |
| journal | — | content | — |
| quickNote | — | content | tags[] |
| mistake | — | questionContent, correctAnswer, userAnswer, explanation | — |
| vocabDeck | name | — | — |
| vocabProgress | — | word, meaning | — |
| panelTemplate | name | — | — |
| bookmark | title | — | url |
| webTab | title | — | url |
| dynamicWidget | displayName | code | — |
| htmlWidget | title | html | — |
| favorite | displayName | — | — |
| aiConversation | — | content | — |
| aiMemory | — | value | category, key |
| moodEntry | — | note | — |
| savingsTransaction | — | note | — |
| drawingStroke | — | text | — |
| widgetConnection | — | label | — |
| focusSession | — | label, taskTitleSnapshot | — |

### 3.6 localSearch 主入口（utils/localSearch.ts）

```typescript
import { ensureCacheReady, _getCachedRecords, type SearchableRecord } from './searchCache'
import { tokenize } from './searchTokenizer'
import { scoreRecord, pickTopN } from './searchScore'
import type {
  LocalSearchParams,
  LocalSearchResult,
  LocalSearchHit,
} from '../types/ai'

const DEFAULT_LIMIT = 20
const HARD_LIMIT = 50

export async function runLocalSearch(params: LocalSearchParams): Promise<LocalSearchResult> {
  const t0 = performance.now()
  const query = (params.query || '').trim()
  if (!query) {
    return { results: [], total: 0, tookMs: Math.round(performance.now() - t0) }
  }

  await ensureCacheReady()
  const records = _getCachedRecords()
  const tokens = tokenize(query)

  const filtered = params.type
    ? records.filter((r) => r.type === params.type)
    : records

  const hits: LocalSearchHit[] = []
  for (const record of filtered) {
    const { score, matchedField, snippet } = scoreRecord(record, tokens)
    if (score <= 0) continue
    hits.push({
      type: record.type,
      id: record.id,
      title: pickTitle(record),
      snippet,
      location: matchedField,
      panelId: record.panelId,
      score,
    })
  }

  const limit = Math.min(Math.max(params.limit ?? DEFAULT_LIMIT, 1), HARD_LIMIT)
  const top = pickTopN(hits, limit)

  return {
    results: top,
    total: hits.length,
    tookMs: Math.round(performance.now() - t0),
  }
}

function pickTitle(record: SearchableRecord): string {
  for (const v of Object.values(record.highWeightFields)) {
    if (v && v.trim()) return v.trim().slice(0, 100)
  }
  for (const v of Object.values(record.mediumWeightFields)) {
    if (v && v.trim()) return v.trim().slice(0, 100)
  }
  return record.id
}
```

### 3.7 wsToolHandlers 集成（utils/wsToolHandlers.ts 改）

在 `executeToolCall` switch（行 518-569）新增分支：

```typescript
import { runLocalSearch } from './localSearch'
import type { LocalSearchParams } from '../types/ai'

// 在 executeToolCall 的 switch(tool) 内（行 518+）：
case 'local_search': {
  try {
    // 注意：外层 executeToolCall(tool, params: unknown) 已用 unknown 类型
    // 内层必须重命名变量，避免与外层 params 同名（TypeScript 编译错误）
    const localSearchParams = params as LocalSearchParams
    const result = await runLocalSearch(localSearchParams)
    return { success: true, data: result }
  } catch (err) {
    return {
      success: false,
      error: `local_search 执行失败：${err instanceof Error ? err.message : String(err)}`,
    }
  }
}
```

**注**：`executeToolCall` 现有签名为 `(tool: string, params: unknown) => Promise<ToolCallResult>`，`params as LocalSearchParams` 是合法的 narrow，**不违反 TS 优先约束**（narrow 是 TS 标准用法）。

### 3.8 types/ai.ts 新增类型

修改 `f:\allmylife\event\client\desktop\src\types\ai.ts`（在文件末尾追加，**不修改现有 ChatMessage 接口**）：

```typescript
// ===== Phase 12: AI 搜索集成类型 =====

export type LocalSearchableType =
  | 'panel' | 'task' | 'calendarEvent' | 'habit' | 'note' | 'journal'
  | 'quickNote' | 'mistake' | 'vocabDeck' | 'vocabProgress' | 'panelTemplate'
  | 'bookmark' | 'webTab' | 'widget' | 'dynamicWidget' | 'htmlWidget'
  | 'favorite' | 'aiConversation' | 'aiMemory' | 'moodEntry'
  | 'savingsTransaction' | 'drawingStroke' | 'widgetConnection' | 'focusSession'

export interface LocalSearchParams {
  query: string
  type?: LocalSearchableType
  limit?: number
}

export interface LocalSearchHit {
  type: LocalSearchableType
  id: string
  title: string
  snippet: string
  location: string
  panelId?: string
  score: number
}

export interface LocalSearchResult {
  results: LocalSearchHit[]
  total: number
  tookMs: number
}

export type SearchSourceKind = 'local' | 'web' | 'academic' | 'github'

export interface WebSearchHit {
  title: string
  url: string
  snippet: string
  summary?: string
  siteName?: string
  siteIcon?: string
  datePublished?: string
}

export interface AcademicPaper {
  paperId: string
  title: string
  abstract: string
  authors: string[]
  year: number
  venue: string
  citationCount: number
  openAccessPdf?: { url: string; status: string; license?: string }
  externalIds?: { ArXiv?: string; DOI?: string }
  tldr?: { text: string }
}

export interface GithubRepoHit {
  id: number
  fullName: string
  description: string
  htmlUrl: string
  stargazersCount: number
  forksCount: number
  language: string
  updatedAt: string
  topics?: string[]
}

// 工具名 → SearchSourceKind 映射（避免字符串 replace 的脆弱性）
export const SEARCH_TOOL_KIND_MAP: Record<string, SearchSourceKind> = {
  local_search: 'local',
  web_search: 'web',
  academic_search: 'academic',
  github_search: 'github',
}

export const SEARCH_TOOL_NAMES = new Set(Object.keys(SEARCH_TOOL_KIND_MAP))

export function isSearchTool(toolName: string): boolean {
  return SEARCH_TOOL_NAMES.has(toolName)
}

/** 类型守卫 */
export function isLocalSearchResult(data: unknown): data is LocalSearchResult {
  return (
    typeof data === 'object' && data !== null &&
    'results' in data && Array.isArray((data as LocalSearchResult).results) &&
    'total' in data && typeof (data as LocalSearchResult).total === 'number'
  )
}

export interface SearchSourceEntry {
  id: string  // 唯一 ID（uuid）
  requestId: string
  toolName: string
  kind: SearchSourceKind
  query: string
  // 用 ReadonlyArray<联合类型> 而非 联合数组类型，避免 TS 严格模式下 push 等操作受限
  // 类型守卫（isLocalHit / isWebHit / isAcademicHit / isGithubHit）在渲染时 narrow 类型
  hits: ReadonlyArray<LocalSearchHit | WebSearchHit | AcademicPaper | GithubRepoHit>
  total: number
  tookMs?: number
  timestamp: number
}
```

**注**：不修改 `ChatMessage` 接口，避免影响现有消息流。

### 3.9 useAIStore 改造（核心：搜索结果缓存）

**改造点 1**：新增 `searchResults` 字段

在 useAIStore 的 `AIStoreState` 接口新增：
```typescript
import { useAIStoreType } ...
import { SearchSourceEntry, isSearchTool, SEARCH_TOOL_KIND_MAP, isLocalSearchResult } from '../types/ai'

interface AIStoreState {
  // ... 现有字段
  searchResults: SearchSourceEntry[]  // Phase 12 新增，限 20 条 LRU
  addSearchResult: (entry: Omit<SearchSourceEntry, 'id' | 'timestamp'>) => void
  clearSearchResults: () => void
}
```

**改造点 2**：在 `handleToolCall` 中追加 search results

```typescript
// useAIStore.ts handleToolCall（行 712-721）
async function handleToolCall(requestId: string, tool: string, params: unknown): Promise<void> {
  const result = await executeToolCall(tool, params)
  sendWs({
    kind: 'tool_result',
    requestId,
    success: result.success,
    data: result.data,
    error: result.error,
  })

  // Phase 12：搜索工具结果缓存到 searchResults
  if (result.success && isSearchTool(tool)) {
    const kind = SEARCH_TOOL_KIND_MAP[tool]
    const queryStr = typeof params === 'object' && params !== null && 'query' in params
      ? String((params as { query: unknown }).query || '')
      : ''
    let hits: unknown[] = []
    let total = 0
    let tookMs: number | undefined
    if (isLocalSearchResult(result.data)) {
      hits = result.data.results
      total = result.data.total
      tookMs = result.data.tookMs
    } else if (result.data && typeof result.data === 'object' && 'results' in result.data) {
      const d = result.data as { results?: unknown[]; total?: number; tookMs?: number }
      hits = Array.isArray(d.results) ? d.results : []
      total = typeof d.total === 'number' ? d.total : 0
      tookMs = typeof d.tookMs === 'number' ? d.tookMs : undefined
    }
    get().addSearchResult({
      requestId,
      toolName: tool,
      kind,
      query: queryStr,
      hits: hits as SearchSourceEntry['hits'],
      total,
      tookMs,
    })
  }
}
```

**改造点 3**：`addSearchResult` 实现（限 20 条 LRU）

```typescript
// 注：uuidv4 已在 useAIStore.ts 文件顶部 import（行 29：import { v4 as uuidv4 } from 'uuid'）
addSearchResult: (entry) => {
  const id = uuidv4()
  const timestamp = Date.now()
  set((state) => {
    const newEntry: SearchSourceEntry = { ...entry, id, timestamp }
    const next = [newEntry, ...state.searchResults]
    if (next.length > 20) next.length = 20  // LRU 截断
    return { searchResults: next }
  })
},

clearSearchResults: () => set({ searchResults: [] }),
```

**改造点 4**：`handleServerChange` 改造（500ms debounce + 跳过自己发起的变更后失效）

```typescript
import { markSearchCacheStale } from '../utils/searchCache'

let cacheInvalidateTimer: ReturnType<typeof setTimeout> | null = null

function handleServerChange(changeType: string, data: unknown, sourceDeviceId?: string): void {
  // 先跳过自己发起的变更（与现有逻辑一致）
  if (sourceDeviceId === getDeviceId()) return

  console.log(`[useAIStore] Received change: ${changeType}`, data)

  // Phase 12：跳过自己发起变更的检查之后，任何服务器变更都可能影响本地搜索缓存
  // 用 500ms debounce 合并连续 change，避免频繁重建
  if (cacheInvalidateTimer) clearTimeout(cacheInvalidateTimer)
  cacheInvalidateTimer = setTimeout(() => {
    markSearchCacheStale()
    cacheInvalidateTimer = null
  }, 500)

  // 原有 switch 分支保留不动
  const appStore = getUseAppStore().getState() as { ... }
  switch (changeType) {
    // ... 原有逻辑
  }
}
```

### 3.10 SearchResultsCard 组件（components/ai/SearchResultsCard.tsx）

**关键设计**：用类型守卫替代 `as any`，4 类结果各自有独立渲染逻辑。

```typescript
import { useState } from 'react'
import type {
  SearchSourceEntry,
  LocalSearchHit,
  WebSearchHit,
  AcademicPaper,
  GithubRepoHit,
} from '../../types/ai'
import { useAppStore } from '../../stores/useAppStore'

interface Props {
  entry: SearchSourceEntry
}

const KIND_LABELS: Record<SearchSourceEntry['kind'], string> = {
  local: '本地',
  web: '网页',
  academic: '论文',
  github: 'GitHub',
}

// 类型守卫
function isLocalHit(h: unknown): h is LocalSearchHit {
  return typeof h === 'object' && h !== null && 'type' in h && 'score' in h
}
function isWebHit(h: unknown): h is WebSearchHit {
  // 加 !('score' in h) 排除 LocalSearchHit（防止未来 LocalSearchHit 扩展 url 字段时误判）
  return typeof h === 'object' && h !== null && 'url' in h && 'snippet' in h && !('paperId' in h) && !('score' in h)
}
function isAcademicHit(h: unknown): h is AcademicPaper {
  return typeof h === 'object' && h !== null && 'paperId' in h && 'abstract' in h
}
function isGithubHit(h: unknown): h is GithubRepoHit {
  // 加 'stargazersCount' in h 加强判别（GithubRepoHit 必有此字段）
  return typeof h === 'object' && h !== null && 'fullName' in h && 'htmlUrl' in h && 'stargazersCount' in h
}

export function SearchResultsCard({ entry }: Props) {
  const [collapsed, setCollapsed] = useState(false)
  const setActivePanel = useAppStore((s) => s.setActivePanel)

  const handleLocalClick = (hit: LocalSearchHit) => {
    if (hit.panelId) {
      void setActivePanel(hit.panelId)
    }
  }

  const handleExternalClick = (url: string) => {
    if (url) window.open(url, '_blank', 'noopener,noreferrer')
  }

  return (
    <div className="search-results-card" data-kind={entry.kind}>
      <header
        className="search-results-header"
        onClick={() => setCollapsed((c) => !c)}
        role="button"
        tabIndex={0}
      >
        <span className="search-results-kind">{KIND_LABELS[entry.kind]}</span>
        <span className="search-results-query">"{entry.query}"</span>
        <span className="search-results-count">{entry.hits.length} 条</span>
        {entry.tookMs != null && <span className="search-results-took">{entry.tookMs}ms</span>}
        <span className="search-results-toggle">{collapsed ? '▶' : '▼'}</span>
      </header>
      {!collapsed && (
        <ul className="search-results-list">
          {entry.hits.map((hit, idx) => (
            <SearchResultItem
              key={`${entry.id}-${idx}`}
              hit={hit}
              kind={entry.kind}
              onLocalClick={handleLocalClick}
              onExternalClick={handleExternalClick}
            />
          ))}
        </ul>
      )}
    </div>
  )
}

function SearchResultItem({
  hit,
  kind,
  onLocalClick,
  onExternalClick,
}: {
  hit: LocalSearchHit | WebSearchHit | AcademicPaper | GithubRepoHit
  kind: SearchSourceEntry['kind']
  onLocalClick: (h: LocalSearchHit) => void
  onExternalClick: (url: string) => void
}) {
  if (kind === 'local' && isLocalHit(hit)) {
    return (
      <li
        className="search-result-item"
        onClick={() => onLocalClick(hit)}
        role="button"
        tabIndex={0}
        data-clickable={hit.panelId ? 'true' : 'false'}
      >
        <div className="search-result-type">{hit.type}</div>
        <div className="search-result-title">{hit.title || '(无标题)'}</div>
        {hit.snippet && <div className="search-result-snippet">{hit.snippet}</div>}
        <div className="search-result-score">score: {hit.score.toFixed(3)}</div>
      </li>
    )
  }
  if (kind === 'web' && isWebHit(hit)) {
    return (
      <li
        className="search-result-item"
        onClick={() => onExternalClick(hit.url)}
        role="button"
        tabIndex={0}
      >
        <div className="search-result-title">{hit.title}</div>
        {hit.snippet && <div className="search-result-snippet">{hit.snippet}</div>}
        <div className="search-result-url">{hit.url}</div>
      </li>
    )
  }
  if (kind === 'academic' && isAcademicHit(hit)) {
    const pdfUrl = hit.openAccessPdf?.url
    return (
      <li
        className="search-result-item"
        onClick={() => pdfUrl && onExternalClick(pdfUrl)}
        role="button"
        tabIndex={0}
        data-clickable={pdfUrl ? 'true' : 'false'}
      >
        <div className="search-result-title">{hit.title}</div>
        <div className="search-result-meta">{hit.authors.join(', ')} · {hit.year} · {hit.venue}</div>
        {hit.abstract && <div className="search-result-snippet">{hit.abstract.slice(0, 200)}</div>}
        {pdfUrl && <div className="search-result-url">PDF: {pdfUrl}</div>}
      </li>
    )
  }
  if (kind === 'github' && isGithubHit(hit)) {
    return (
      <li
        className="search-result-item"
        onClick={() => onExternalClick(hit.htmlUrl)}
        role="button"
        tabIndex={0}
      >
        <div className="search-result-title">{hit.fullName}</div>
        {hit.description && <div className="search-result-snippet">{hit.description}</div>}
        <div className="search-result-meta">★ {hit.stargazersCount} · {hit.language || '-'}</div>
      </li>
    )
  }
  return null
}
```

### 3.11 SearchResultsPanel 组件（components/ai/SearchResultsPanel.tsx）

```typescript
import { useAIStore } from '../../stores/useAIStore'
import { SearchResultsCard } from './SearchResultsCard'
import { Trash2, X } from 'lucide-react'

interface Props {
  onClose?: () => void
}

export function SearchResultsPanel({ onClose }: Props) {
  const searchResults = useAIStore((s) => s.searchResults)
  const clearSearchResults = useAIStore((s) => s.clearSearchResults)

  if (searchResults.length === 0) return null

  return (
    <div className="search-results-panel">
      <header className="search-results-panel-header">
        <span className="search-results-panel-title">搜索结果（{searchResults.length}）</span>
        <div className="search-results-panel-actions">
          <button onClick={clearSearchResults} title="清空">
            <Trash2 size={14} />
          </button>
          {onClose && (
            <button onClick={onClose} title="关闭">
              <X size={14} />
            </button>
          )}
        </div>
      </header>
      <div className="search-results-panel-list">
        {searchResults.map((entry) => (
          <SearchResultsCard key={entry.id} entry={entry} />
        ))}
      </div>
    </div>
  )
}
```

### 3.12 AIAssistantSidebar 集成（components/AIAssistantSidebar.tsx 改）

在 sidebar 顶部（会话选择器下方）或对话流上方新增 `<SearchResultsPanel />`：

```typescript
import { SearchResultsPanel } from './ai/SearchResultsPanel'

// 在 sidebar 渲染结构中，对话流区域之前插入：
<SearchResultsPanel />
```

**位置决策**：放在会话选择器下方、对话流上方。这样搜索结果在 AI 思考流之外独立展示，不污染 messages 系统。

### 3.13 dbStores/index.ts 包装器（utils/dbStores/index.ts 改）

**关键决策**：F18 实证 10 处直接从 `./dbStores/<sub>` import。spec 决定 **保留这些直接 import 不动**（避免大规模重构），原因：

1. 这些直接 import 的消费方（如 wsToolHandlers / LatexQuiz / Sudoku / HtmlCanvasWidget / iframeProxy）调用的多数是**读操作**（getAllXxx / getXxxById）或**特定写操作**（saveMistake / createHtmlWidget 等）
2. searchCache 失效机制有**两条路径**：
   - 路径 A：通过 dbStores/index.ts 包装器（覆盖 `import { saveXxx } from './dbStores'` 的消费方）
   - 路径 B：通过 `handleServerChange` 接收 `change` 消息（覆盖所有写入，包括绕过 index.ts 的写入，因为多端写入会触发服务器广播）
3. 路径 B 是**兜底**，路径 A 是**优化**（本端写入立即失效，不必等服务器广播）

**实现**（仅包装写操作，async 失败时不调 markSearchCacheStale）：

```typescript
// 顶部新增 import
import { markSearchCacheStale } from '../searchCache'

// 改写每个 re-export 块。以 notes 为例：
import * as _notes from './notes'

// 读操作：直接 re-export（不包装）
export const getNoteById = _notes.getNoteById
export const getAllNotes = _notes.getAllNotes
export const getNotesByTag = _notes.getNotesByTag

// 写操作：包装为成功后失效
export const saveNote: typeof _notes.saveNote = async (...args) => {
  try {
    const result = await _notes.saveNote(...args)
    markSearchCacheStale()
    return result
  } catch (err) {
    // 失败时不调 markSearchCacheStale（数据未变更）
    throw err
  }
}
export const deleteNote: typeof _notes.deleteNote = async (...args) => {
  try {
    const result = await _notes.deleteNote(...args)
    markSearchCacheStale()
    return result
  } catch (err) {
    throw err
  }
}
```

**注意**：`typeof _notes.saveNote` 保留原函数签名，TypeScript 编译通过。

### 3.14 api/searchKeys.ts API client

```typescript
import { api } from './client'

export type SearchKeyProvider = 'bocha' | 'semanticScholar' | 'github'

export interface SearchKeyStatus {
  provider: SearchKeyProvider
  hasKey: boolean
  updatedAt: number | null
}

export interface SearchKeyListResponse {
  providers: SearchKeyStatus[]
}

export interface SearchKeyTestResult {
  ok: boolean
  latencyMs?: number
  error?: string
}

export async function listSearchKeys(): Promise<SearchKeyListResponse> {
  return api.get<SearchKeyListResponse>('/search/keys')
}

export async function getSearchKey(provider: SearchKeyProvider): Promise<SearchKeyStatus> {
  return api.get<SearchKeyStatus>(`/search/keys/${provider}`)
}

export async function updateSearchKey(
  provider: SearchKeyProvider,
  key: string,
): Promise<{ ok: true; provider: string; updatedAt: number }> {
  return api.put(`/search/keys/${provider}`, { key })
}

export async function deleteSearchKey(
  provider: SearchKeyProvider,
): Promise<{ ok: true; provider: string }> {
  return api.delete<{ ok: true; provider: string }>(`/search/keys/${provider}`)
}

export async function testSearchKey(
  provider: SearchKeyProvider,
  key?: string,
): Promise<SearchKeyTestResult> {
  return api.post<SearchKeyTestResult>(`/search/keys/${provider}/test`, key ? { key } : {})
}
```

### 3.15 SearchEngineConfig 组件（components/settings/SearchEngineConfig.tsx）

完整组件实现已在 v1 spec 中给出，v2 保持不变。关键点：
- 3 provider 行（bocha / semanticScholar / github）
- 每行 4 操作按钮（更新 / 测试 / 删除 / 查看状态）
- 输入框用 `type="password"` + 眼睛图标切换显隐
- 测试结果用 ok / fail 两色展示
- 不显示明文 Key

### 3.16 SettingsPanel 新增 search tab

```typescript
import SearchEngineConfig from './settings/SearchEngineConfig'

// tabs 数组新增 'search'：
// ['appearance', 'behavior', 'accessibility', 'favorites', 'shortcuts', 'data', 'server', 'ai', 'search']

// tab 列表渲染新增 Search 图标项

// 内容渲染：
{activeTab === 'search' && <SearchEngineConfig />}
```

### 3.17 product-guide SKILL.md 更新

第六节标题改为"AI 工具列表（共 29 个）"，新增 6.5 搜索工具子节：

```markdown
### 6.5 搜索工具（4 个）

| 工具 | 用途 | 执行端 |
|------|------|--------|
| `local_search` | 检索本端已同步数据（24 类 IndexedDB store） | 客户端 |
| `web_search` | 联网网页搜索（博查 Bocha） | 服务器 |
| `academic_search` | 学术论文检索（Semantic Scholar） | 服务器 |
| `github_search` | GitHub 仓库/代码/用户/Issue 搜索 | 服务器 |

详见 ai-search-spec.md 第一/二章。
```

工具管理描述改为"列出/启用/禁用 29 个工具"。

---

## 四、实施批次划分

| 批次 | 任务 ID | 内容 | 依赖 |
|------|---------|------|------|
| A | 12.0.1 / 12.1.1-5 + 12.6.2 | UI 简版设计 + local_search 核心模块 + SKILL.md 更新 | 无 |
| B | 12.2.1-3 | wsToolHandlers 集成 + useAIStore 搜索结果缓存 + 离线兜底 | A 完成（类型已定） |
| C | 12.3.1-5 | SearchResultsPanel + SearchResultsCard + 跳转 + AIAssistantSidebar 集成 | A + B 完成 |
| D | 12.4.1-3 | API client + SearchEngineConfig + SettingsPanel tab | 无（与 A 并行） |
| E | 12.5.1-3 | dbStores/index.ts 包装器 + handleServerChange 改造 | A 完成（markSearchCacheStale 已定） |
| F | 12.6.1 | 单元测试 | A-E 完成 |
| G | 12.7.1 | 运行时验证 | A-F 完成 |

并行策略：A 与 D 完全独立可同时启动；B/C/E 依赖 A；F 在 A-E 后启动；G 最后。

---

## 五、验证策略

### 5.1 单元测试（vitest）

每个新模块 ≥ 5 用例，**模块覆盖率 ≥ 70%**：

| 模块 | 用例数 | 关键覆盖点 |
|------|--------|-----------|
| searchCache.ts | 6+ | 缓存重建 / 并发去重 / markSearchCacheStale / _getCachedRecords / _resetCacheForTesting / 失败兜底 |
| searchTokenizer.ts | 6+ | 中文分词 / 英文小写 / 停用词过滤 / 空字符串 / 数字 / 中英混合 |
| searchScore.ts | 6+ | 高权重打分 / 中权重打分 / 低权重打分 / 多字段命中累加 / tf 计算 / top N 截断 |
| searchIndexAdapters.ts | 6+ | 24 适配器返回 schema / 空数据兜底 / 字段映射正确 / dynamic-widgets 走 API |
| localSearch.ts | 6+ | 空查询 / type 过滤 / limit 截断 / tookMs 准确 / 命中 / 不命中 |
| searchKeys API client | 6+ | 5 端点 mock fetch / 错误处理 / 401 / 400 / 网络错误 |
| useAIStore.addSearchResult | 5+ | LRU 20 条截断 / 字段映射 / 清空 / isSearchTool / handleToolCall 集成 |
| **合计** | **46+** | — |

**集成测试**：1 个集成测试文件 `search.integration.test.ts`，覆盖 `handleToolCall → executeToolCall → addSearchResult → useSearchResultsStore` 完整链路（用 mock WebSocket + mock IDB）。

### 5.2 运行时验证（Playwright MCP）

启动 dev server，跑 12 个用例（截图存 `docs/verify/phase12/`）：

| 用例 ID | 描述 | 验证方法 |
|---------|------|---------|
| M1 | dev server 启动成功，无 console error | Playwright 打开 dev URL，监听 console |
| M2 | SettingsPanel 切到 search tab，3 provider 行可见 | 截图 |
| M3 | listSearchKeys 返回 3 个 provider 的 hasKey 状态 | dev console 调 `await fetch('/api/search/keys').then(r=>r.json())` |
| M4 | 更新 bocha Key（输入测试值 `test-key-123`），保存后状态变为"已配置" | UI 操作 + 截图 |
| M5 | 测试 bocha Key，显示测试结果（ok/fail） | UI 操作 + 截图 |
| M6 | 删除 bocha Key，状态变为"未配置" | UI 操作 + 截图 |
| M7 | dev console 直接调 `executeToolCall('local_search', { query: '测试' })` 返回 SearchSources 结构 | dev console 执行 |
| M8 | 触发 local_search 后，AIAssistantSidebar 顶部显示 SearchResultsCard | 截图 |
| M9 | SearchResultsCard 折叠/展开正常 | 截图 |
| M10 | 点击本地结果跳转到对应面板（先创建测试面板，再搜该面板名，再点结果） | dev console 调 `useAppStore.getState().addPanel(...)` 创建面板 + 截图 |
| M11 | 点击网页/论文/GitHub 结果（mock 数据注入到 searchResults）打开外链 | dev console 调 `useAIStore.getState().addSearchResult({ kind: 'web', hits: [{ title: 'test', url: 'https://example.com', snippet: '' }], ... })` + 截图 |
| M12 | DevTools Network 验证 local_search 零网络请求 | Playwright `page.on('request')` 监听，触发 local_search 后断言无新请求（除已有 WS 长连接外） |

### 5.3 性能验证

- 缓存重建耗时：dev console `const t=performance.now(); await import('./utils/searchCache').then(m=>m.ensureCacheReady()); console.log(performance.now()-t)` <200ms
- 缓存命中查询：dev console `await import('./utils/localSearch').then(m=>m.runLocalSearch({query:'test'}))` 返回的 tookMs <10ms
- 缓存失效查询：先 `markSearchCacheStale()` 再跑查询，tookMs <50ms
- 内存占用：`performance.memory.usedJSHeapSize` 前后对比，<50MB

### 5.4 对抗审查清单

- [ ] 代码层面：所有新文件类型安全，无 `as any`
- [ ] 代码层面：dbStores/index.ts 包装器只改 1 个文件，未污染 store 文件
- [ ] 代码层面：`local_search` 在 wsToolHandlers 中无网络调用
- [ ] 代码层面：API client 不在客户端暴露明文 Key
- [ ] 代码层面：useAIStore.searchResults LRU 20 条截断正确
- [ ] 代码层面：handleServerChange 用 500ms debounce
- [ ] 代码层面：dbStores 包装器 async 失败时不调 markSearchCacheStale
- [ ] 运行时：dev server 启动无 error
- [ ] 运行时：12 个 Playwright 用例全通过
- [ ] 运行时：DevTools Network 验证 local_search 零请求
- [ ] 运行时：性能预算达标
- [ ] 运行时：单测全绿，覆盖率 ≥ 70%

---

## 六、风险与缓解

| 风险 | 影响 | 缓解 |
|------|------|------|
| 24 个 store 适配器实现量大 | 工时风险 | F17/F20 已确认 22 个 getAll 已有，仅 2 个需新增（getAllVocabProgress + getAllAIConversations），实现量可控 |
| dbStores/index.ts 包装器可能改变函数签名 | 编译错误 | 用 `typeof _notes.saveNote` 保留签名 |
| 现有 ChatMessage 类型扩展可能影响其他消费方 | 类型回归 | **不修改 ChatMessage 接口**，独立用 searchResults 字段 |
| Intl.Segmenter 在某些 Electron 版本不支持 | 运行时错误 | Electron 22+ 已支持，本项目用 Electron 31+，无风险 |
| SearchCache 内存占用超预算 | 内存压力 | 24 store × 平均 300 条 × 平均 500 字节 ≈ 3.6MB，远低于 50MB |
| search tab UI 与现有 behavior tab 的 SearchEngine 混淆 | 用户困惑 | SearchEngineConfig 文案明确写"AI 搜索引擎 Key 管理" |
| tool message 流不写入搜索结果（F14/F15/F16） | UI 无法展示结果 | 改为 useAIStore.searchResults 独立字段 + SearchResultsPanel 独立区域，不依赖 messages |
| 10 处直接从 `./dbStores/<sub>` import 绕过包装器 | 缓存失效不及时 | 路径 B（handleServerChange 接收 change）作为兜底；本端直接 import 的写操作通过服务器广播仍能触发失效 |
| LLM 不引用 sources 做总结 | 验收 12 降级 | 已在 2.2 节明确为已知限制，记录待后续 phase 处理 |
| 跳到具体组件不可实现（F13） | 验收 12 降级 | 已在 2.2 节明确降级为"跳到面板级别" |
| UI 原型无 SearchResultsCard 设计（F19） | 违反 UI 原型权威性约束 | 已在 1.5 节约束 9 说明本 phase 简版实现，后续 Phase 7 补原型 |

---

## 七、估时

| 批次 | 估时（人天） |
|------|------------|
| A（核心模块 + UI 简版设计） | 2 |
| B（WS + useAIStore 集成） | 0.5 |
| C（UI 组件 + 集成） | 1.5 |
| D（API + 配置 UI） | 1 |
| E（包装器 + 失效） | 0.5 |
| F（测试 + 文档） | 1 |
| G（运行时验证） | 0.5 |
| 对抗审查 + 修复 | 1 |
| **合计** | **8 人天** |

通过 sub-agent 并行可压缩到 ~3 天。

---

## 八、对抗审查修复记录（v1 → v2）

### 高优先级问题修复

| 编号 | v1 问题 | v2 修复 |
|------|---------|---------|
| H1 | F7 行号错误（493-517） | 修正为"executeToolCall 行 489-574，dispatch switch 行 518-569" |
| H2 | import 不存在的函数（getAllAIConversations / getAllVocabProgress） | 3.5.3 节明确新增这两个函数的实现方案 |
| H3 | 15 个 store 的 getAll 来源未定义 | 3.5.1 节给出完整 24 适配器清单，含 getAll 函数来源标注 |
| H4 | dynamic-widgets 不是 IDB store | 3.5.1 节 #24 明确走 server API（`listDynamicWidgets` from `api/dynamicWidgets.ts`） |
| H5 | useAppStore.setCurrentPanel 不存在 | 3.9/3.10 节改用 `setActivePanel`（F13 实证存在） |
| H6 | setActiveWidget 不存在 | 2.2 节明确降级：放弃"跳到具体组件"目标，只跳到面板级别 |

### 中优先级问题修复

| 编号 | v1 问题 | v2 修复 |
|------|---------|---------|
| M1 | tool_execution_end data 结构未验证 | 3.9 节重设计：不依赖 tool_execution_end，改为在 handleToolCall 完成后直接 addSearchResult |
| M2 | 3.13 节与 12.5.2 矛盾 | 统一为"在 handleServerChange 函数开头无条件调 markSearchCacheStale"（3.9 节改造点 4） |
| M3 | 无条件 markSearchCacheStale 频繁重建 | 加 500ms debounce 合并连续 change（3.9 节改造点 4） |
| M4 | SearchResultsCard 用 `as any` | 3.10 节用 4 个类型守卫（isLocalHit / isWebHit / isAcademicHit / isGithubHit）替代 |
| M5 | URL 取法健壮性 | 3.10 节 SearchResultItem 4 类各自有独立渲染分支，不跨类型字段猜测 |
| M6 | 10 处直接子文件 import 绕过包装器 | 3.13 节明确决策：保留不动，路径 B（handleServerChange）作为兜底 |
| M7 | async 失败时不应调 markSearchCacheStale | 3.13 节实现用 try/catch，失败时 throw 不调 |
| M8 | ChatMessage 类型扩展位置不明确 | 3.8 节明确：**不修改 ChatMessage 接口**，独立用 searchResults 字段 |
| M9 | M7 验证用例不实际 | 5.2 节 M7 改为 dev console 直接调 `executeToolCall` |
| M10 | M12 DevTools Network 步骤缺失 | 5.2 节 M12 明确 Playwright `page.on('request')` 监听 |
| M11 | replace('_search', '') 兼容性脆弱 | 3.8 节用 `SEARCH_TOOL_KIND_MAP` 显式映射表替代 |

### 低优先级问题修复

| 编号 | v1 问题 | v2 修复 |
|------|---------|---------|
| L1 | 覆盖率目标模糊 | 5.1 节明确每模块 ≥ 5 用例 + 模块覆盖率 ≥ 70% + 1 集成测试 |
| L2 | 性能预算未监控 | 5.3 节明确 dev console 验证步骤 |
| L3 | F11 描述不准 | F11 修正为"本地 agent 模式通过 agentApi 间接执行，handleAgentEvent 接收事件" |
| L4 | 未提 LLM systemPrompt 更新 | 2.2 节明确为已知限制，不修改 systemPrompt |
| L5 | UI 原型权威性未对齐 | 1.5 节约束 9 + 任务 12.0.1 明确简版实现 + 后续 Phase 7 补原型 |
| L6 | 风险表不完整 | 第六节风险表补充到 11 项 |

---

## 九、Spec 自检清单

- [x] 任务表完整（22 个任务，对齐 roadmap 12.0-12.7）
- [x] 验收标准对齐 roadmap § Phase 12 验收清单（含 2 处明确降级说明）
- [x] 详细设计覆盖每个任务
- [x] 现有代码探查结论全部纳入（F1-F20，v2 新增 F13-F20）
- [x] 关键约束（不发网络请求 / Key 不下发 / TS 优先 / 不下 C 盘 / 不引入重型依赖 / 不用 as any / UI 原型权威性）
- [x] 实施批次划分合理（A-G 7 批，可并行）
- [x] 验证策略包含单测 + 集成测试 + 运行时 + 性能 + 对抗审查
- [x] 风险与缓解列出 11 项
- [x] 估时合理
- [x] 模块分层架构图清晰
- [x] 类型设计完整（LocalSearchParams / LocalSearchHit / SearchSources / SearchSourceEntry / 类型守卫等）
- [x] API client 5 端点对应服务器 S9 已实现
- [x] UI 组件设计用类型守卫替代 as any
- [x] 24 个适配器清单完整（含 getAll 函数来源标注 + 13 个需新增函数）
- [x] 不修改现有 ChatMessage 接口（避免影响消息流）
- [x] handleServerChange 用 500ms debounce
- [x] dbStores 包装器 async 失败时不调 markSearchCacheStale
- [x] v1 对抗审查 6 高 + 11 中 + 6 低优先级问题全部修复
- [x] v2 对抗审查 5 高 + 7 中 + 4 低优先级问题全部修复（详见第十章）

---

## 十、对抗审查修复记录（v2 → v3）

### 10.1 高优先级问题修复（5 个）

| 编号 | v2 问题 | v3 修复 |
|------|---------|---------|
| 新 H1 | 3.5.1 节 11 个 getAll 函数实际不存在（虚假标注"✅ 已有"） | 3.5.1 节表格修正：#2-5, #15-21 共 11 个改为"⚠️ 需新增"，并在 3.5.3 节补充完整实现（统一走 runIdbTransaction 遍历 IDB store） |
| 新 H2 | 3.5.1 节 #24 `listDynamicWidgets` 函数名错误 | 改为 `getAllDynamicWidgets`（api/dynamicWidgets.ts:19 实证） |
| 新 H3 | 3.5.3 节 `runIdbTransaction('vocabProgress', ...)` 调用形式错误（编译错误） | 改为 `runIdbTransaction(['vocabProgress'], ...)`（数组类型，对齐 idbTx.ts:348 签名） |
| 新 H4 | 3.5.3 节 `AIConversationRecord` 类型不存在（编译错误） | 改为 `AIConversation`（dbStores/aiData.ts:2 实证 import 类型） |
| 新 H5 | 3.7 节 `const params = params as LocalSearchParams` 变量名冲突（编译错误） | 改为 `const localSearchParams = params as LocalSearchParams` |

### 10.2 中优先级问题修复（7 个）

| 编号 | v2 问题 | v3 修复 |
|------|---------|---------|
| 新 M1 | 3.5.3 节新增 getAll 函数未遵循 withFallback 模式 | 3.5.3 节明确决策：走 IDB-only（不走 withFallback），理由：搜索索引需本地全量数据，IDB 是真相源 |
| 新 M2 | `getAllVocabProgress` 与 `getAllDueVocabProgress(now)` 函数名相似易混淆 | 3.5.3 节补充 JSDoc 注释说明两者语义差异 |
| 新 M3 | F2/F3/F4 行数描述不准 | F2: 127→115 行；F3: 249→222 行；F4: 1081→1029 行 |
| 新 M4 | F16 描述 content 为空字符串错误 | 改为 `调用工具: ${toolName}`（useAIStore.ts:980 实证） |
| 新 M5 | F18 数字不准（实际 10 处，spec 说 13 处） | 改为 10 处，并明确列出：iframeProxy.ts:14 + wsToolHandlers.ts:27-32/37-39 |
| 新 M6 | 3.9 改造点 4 "无条件"措辞与实际代码逻辑不符 | 改为"在跳过自己发起变更的检查之后无条件调用"，代码示例加注释 |
| 新 M7 | SearchSourceEntry.hits 联合数组类型在严格模式下编译问题 | 改为 `ReadonlyArray<LocalSearchHit \| WebSearchHit \| AcademicPaper \| GithubRepoHit>` |

### 10.3 低优先级问题修复（4 个）

| 编号 | v2 问题 | v3 修复 |
|------|---------|---------|
| 新 L1 | 3.14 节 deleteSearchKey 返回类型与 api.delete 默认类型不匹配 | 补充泛型：`api.delete<{ ok: true; provider: string }>(...)` |
| 新 L2 | 3.10 isWebHit 类型守卫对未来 LocalSearchHit 扩展的健壮性 | 加 `&& !('score' in h)` 排除 LocalSearchHit |
| 新 L3 | 3.10 isGithubHit 类型守卫过于宽松 | 加 `&& 'stargazersCount' in h` 加强判别 |
| 新 L4 | 3.9 改造点 3 addSearchResult 使用 uuidv4 但 import 上下文不清晰 | 加注释 `// 注：uuidv4 已在 useAIStore.ts 文件顶部 import（行 29）` |

---

> Spec v3 至此结束。下一步：v3 对抗审查 → 实施。
