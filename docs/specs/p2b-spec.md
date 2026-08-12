# Phase 2B Spec：AI 记忆系统 + AI 协作增强（v4）

> 修订日期：2026-06-03
> v3→v4 修订：2 严重 + 3 中等 + 3 轻微问题全部修复

## 一、目标

完善 AI 记忆能力，支持 AI 协作学习场景。具体：
1. 实现 aiMemories 表的完整 CRUD + 记忆生命周期管理
2. 记忆写入/读取时机自动化
3. 记忆治理 UI（查看、编辑、删除、置顶、设置过期）
4. 音乐播放器 getAISummary 增强（通过冗余字段实现）
5. AI 记忆工具注册（供 AI 调用，通过 storageApi 访问数据）
6. 上下文构建器集成记忆注入（参数传入，L2 层级）

## 二、现有基础设施

### 已有
- `AIMemory` 类型定义（`src/types/index.ts`）：id, category, key, value, confidence, source, pinned, expiresAt, createdAt, updatedAt, schemaVersion
- `aiMemories` IndexedDB 表已创建（Phase 1），含索引 by_category, by_key, by_pinned
- `src/utils/dbStores/aiData.ts`：已有 `saveAIMemory`, `getAIMemoriesByCategory`, `getAIMemoriesByKey`, `getAllAIMemories`, `deleteAIMemory`, `getPinnedMemories`, `clearAllAIMemories`
- `src/ai/contextBuilder.ts`：system prompt 中有 `## 记忆` 段落，但当前硬编码为"暂无置顶记忆"
- `src/ai/toolRegistry.ts`：完整的工具注册和执行框架，含 `storageApi` 受控存储访问
- `src/ai/storageApi.ts`：受控存储 API，工具 execute 通过此 API 访问 IndexedDB
- `src/ai/registerTools.ts`：已有 12 组工具，无 memory 工具
- `src/components/widgets/AIAssistant.tsx`：上下文面板中无记忆管理入口

### 缺失
- memoryTools.ts（AI 记忆读写工具）
- 记忆治理 UI 组件
- contextBuilder 中记忆注入逻辑
- 音乐播放器 state 冗余字段 + getAISummary 增强
- 过期记忆清理逻辑

## 三、实施计划

### 3.1 新增文件：`src/ai/tools/memoryTools.ts`

注册 AI 记忆工具，供 LLM 通过 function calling 调用。

**关键约束：所有数据访问必须通过 `storageApi`（与现有工具一致），禁止直接调用 `aiData.ts`。**

```typescript
// 工具列表：

// 1. save_memory — 保存一条记忆（write 权限，targetType: 'memory'）
//    参数：
//      category(string, required) — 记忆分类，强制枚举：preference|habit|goal|context|fact
//      key(string, required) — 记忆键名，同一 category+key 下唯一
//      value(string, required) — 记忆内容，最大 500 字符
//      confidence(number, required) — 置信度 0-1，超出 clamp
//      source(enum: user_explicit|ai_inferred|behavior_stat, required) — 来源
//      expiresAt?(number) — 过期时间戳（可选），不设则永不过期
//    自动生成字段：id(uuid v4), createdAt(Date.now()), updatedAt(Date.now()),
//                  schemaVersion(1), pinned(false)
//    去重逻辑（原子操作，在同一 storageApi.create() 的 readwrite 事务中）：
//      使用 storageApi.create(ctx, 'aiMemories', async (txCtx) => {
//        // 1. 在同一事务中按 category 查询索引
//        const existing = await txCtx.indexGetAll('aiMemories', 'by_category', category)
//        // 2. 过滤匹配 key 的记录
//        const match = existing.find(r => r.data.key === key)
//        // 3. 若存在：用 txCtx.putCas() 更新 value/confidence/updatedAt/expiresAt
//        // 4. 若不存在：检查总数 < 200，用 txCtx.addNew() 创建
//        // 5. 返回 { id, category, key, value, confidence, source, pinned, expiresAt, status }
//      })
//    数量上限检查：在 memoryTools.execute 中检查（返回规范 ToolError），
//                  同时在 aiData.ts 的 saveAIMemory 中也做兜底检查
//
// 2. list_memories — 列出所有记忆（read_public 权限，targetType: 'memory'）
//    参数：category?(string, 枚举：preference|habit|goal|context|fact), pinnedOnly?(boolean)
//    通过 storageApi.read 访问 aiMemories 表
//    返回：记忆数组摘要（每条包含 id, category, key, value, confidence, source, pinned, expiresAt）
//
// 3. update_memory — 更新记忆内容（write 权限，targetType: 'memory'）
//    参数：memoryId(string, required), value?(string), confidence?(number), expiresAt?(number|null)
//    注意：pinned 不在此工具参数中。置顶只能由用户在治理 UI 中操作。
//    通过 storageApi.update 访问 aiMemories 表
//    返回：更新后的记忆
//
// 4. delete_memory — 删除记忆（dangerous 权限，targetType: 'memory'）
//    参数：memoryId(string)
//    约束：pinned=true 的记忆不可通过此工具删除，返回错误，需用户在治理 UI 中先取消置顶
//    通过 storageApi 访问 aiMemories 表
//    返回：成功/失败
//
// 5. search_memories — 搜索记忆（read_public 权限，targetType: 'memory'）
//    参数：query(string, required, 不允许空字符串), limit?(integer, 默认10, 最大50)
//    空字符串 query 返回 INVALID_PARAMS 错误
//    通过 storageApi.read 读取后，对 category + key + value 做 includes 匹配
//    返回：匹配的记忆数组
```

所有工具遵循 ToolDefinition 接口，包含 execute 和 dryRun（write/dangerous 级别）。
所有 execute 函数通过 `storageApi.read/create/update` 访问 aiMemories 表，与现有工具保持一致的受控访问模式。

### 3.2 修改文件：`src/ai/registerTools.ts`

新增 `import memoryTools from './tools/memoryTools'`，在 `allTools` 数组中加入 `...memoryTools`。

### 3.3 修改文件：`src/ai/contextBuilder.ts`

#### 3.3.1 记忆注入——参数传入模式

**核心设计**：ContextBuilder 不直接访问 IndexedDB，记忆数据由调用方（useAIStore）加载后作为参数传入。保持 ContextBuilder 的纯逻辑定位和可测试性。

修改 `buildContext` 方法签名：
```typescript
async buildContext(
  session: SessionState,
  appState?: unknown,
  memories?: AIMemory[]  // 新增参数
): Promise<BuiltContext>
```

修改 `buildL2Context` 方法签名：
```typescript
private buildL2Context(
  appState: unknown | undefined,
  memories?: AIMemory[]  // 新增参数
): L2Context
```

`buildL2Context` 中的记忆处理逻辑：
- 接收 memories 参数
- 过滤掉已过期记忆（expiresAt < Date.now()）
- pinned 记忆全部保留
- 非 pinned 记忆按 confidence 降序排列，取前 20 条
- 注入到 `L2Context` 的新字段 `memorySummaries`

修改 `buildSystemPrompt` 方法：**不新增 memories 参数**，直接从 `l2.memorySummaries` 格式化 `## 记忆` 段落：
```typescript
const memoryLines = l2.memorySummaries.length > 0
  ? l2.memorySummaries.map(m =>
      m.pinned ? `- [置顶] ${m.category}/${m.key}: ${m.value}` : `- ${m.category}/${m.key}: ${m.value}`
    ).join('\n')
  : '（暂无记忆）'
```

新增 import：`import type { AIMemory } from '../types'`

#### 3.3.2 Token 预算截断策略（简化版）

**简化策略**：仅截断记忆，不截断 widgetSummaries。widget 摘要是核心上下文，不应被记忆挤占。

截断算法：
1. 计算 L2 总 token（widgetSummaries + dataSourceSummaries + memorySummaries）
2. 如果超过 L2 预算，从 memorySummaries 末尾开始逐条移除（按 confidence 升序，pinned 不移除）
3. 直到 L2 总 token 在预算内或只剩 pinned 记忆

#### 3.3.3 过期记忆过滤

不在 ContextBuilder 中做数据库清理。ContextBuilder 只负责过滤（不注入过期记忆到上下文）。数据库清理在 `useAIStore.initialize` 中执行。

### 3.4 修改文件：`src/registry/widgetDefinitions.ts`

增强音乐播放器 `getAISummary`：

**方案**：在 `MusicPlayerState` 中增加冗余字段 `songCount` 和 `lastPlayedAt`，由音乐播放器组件在状态变化时同步更新。

修改 `MusicPlayerState`：
```typescript
type MusicPlayerState = {
  playlistName: string
  fileName: string | null
  mimeType: string | null
  size: number | null
  needsReselect: boolean
  songCount: number       // 新增：歌单歌曲数量，默认 0
  lastPlayedAt: number | null  // 新增：最近播放时间戳，默认 null
  schemaVersion: 1
}
```

修改 `createDefaultState`：新增 `songCount: 0, lastPlayedAt: null`

修改 `validateState`：新增 `songCount: num(raw.songCount, 0), lastPlayedAt: nullableNum(raw.lastPlayedAt)`

修改 `normalizeStateForSave`：新增 `songCount: state.songCount, lastPlayedAt: state.lastPlayedAt`

修改 `normalizeState`：新增 `songCount: (raw.songCount as number) ?? 0, lastPlayedAt: (raw.lastPlayedAt as number | null) ?? null`

修改 `getAISummary`：
```typescript
getAISummary(state: MusicPlayerState): string {
  const playlistInfo = state.playlistName ? `歌单=${state.playlistName}` : '无歌单'
  const songInfo = state.songCount > 0 ? `, ${state.songCount}首歌` : ''
  const lastPlayed = state.lastPlayedAt
    ? `, 最近播放=${new Date(state.lastPlayedAt).toLocaleDateString('zh-CN')}`
    : ''
  return `音乐播放器: ${playlistInfo}${songInfo}${lastPlayed}`
}
```

### 3.5 新增文件：`src/components/AIMemoryPanel.tsx`

记忆治理 UI 组件，嵌入 AIAssistant 组件的上下文面板中。

功能：
- 列出所有记忆（按 category 分组，category 为枚举值：preference|habit|goal|context|fact）
- 每条记忆显示：category, key, value, confidence, source, pinned 状态, expiresAt
- 操作按钮：
  - 置顶/取消置顶（toggle pinned）
  - 编辑（修改 value, confidence, expiresAt）
    - expiresAt 编辑：预设选项（1周后/1月后/3月后/永不过期）+ 自定义日期
  - 删除（UI 层面二次确认弹窗，不涉及 AI PermissionManager）
- 搜索过滤
- 清空所有记忆（UI 层面二次确认弹窗，不涉及 AI PermissionManager）

**权限区分**：
- AI 工具调用（save_memory/update_memory/delete_memory）：走 PermissionManager 的 write/dangerous 权限流程 + 审计日志
- 治理 UI 操作（置顶/编辑/删除/清空）：走 UI 层面的确认对话框，不涉及 confirmationToken，但**必须调用 `auditLogger.append()` 记录操作**

**UI 操作审计参数映射规则**：
```typescript
await auditLogger.append({
  sessionId: 'ui',  // 标识为 UI 操作
  auditCorrelationId: `ui_memory_${operationType}_${memoryId}_${Date.now()}`,
  toolName: `ui_memory_${operationType}`,  // 如 ui_memory_toggle_pin, ui_memory_delete, ui_memory_edit, ui_memory_clear_all
  permission: 'write',  // UI 操作等效于 write
  targetType: 'memory',
  targetId: memoryId,  // clear_all 时为 'all'
  args: { operationType, targetId: memoryId },
  resultStatus: 'success',
})
```

样式：与现有上下文面板风格一致（深色背景、小字体、紧凑布局）。

### 3.6 修改文件：`src/components/widgets/AIAssistant.tsx`

在上下文面板中新增"AI 记忆"分区：
- 在"会话信息"分区下方新增"AI 记忆"分区
- 显示记忆数量概览（X 条记忆，Y 条置顶）
- 点击"管理记忆"按钮展开 AIMemoryPanel
- AIMemoryPanel 以可折叠面板形式嵌入上下文面板

新增组件状态：
- `memoryPanelOpen: boolean`（控制记忆面板展开/折叠）

### 3.7 修改文件：`src/stores/useAIStore.ts`

**架构**：useAIStore 是业务层，调用 aiData.ts（数据层）+ 处理 UI 状态更新 + 调用 auditLogger。

新增 AI Store 方法：
- `loadMemories(): Promise<AIMemory[]>` — 调用 `getAllAIMemories()`，返回结果
- `updateMemory(id: string, updates: Partial<AIMemory>): Promise<void>` — 调用 `updateAIMemory(id, updates)` + `auditLogger.append()`
- `toggleMemoryPin(id: string): Promise<void>` — 调用 `toggleAIMemoryPin(id)`（aiData.ts 原子操作）+ `auditLogger.append()`
- `deleteMemory(id: string): Promise<void>` — 调用 `deleteAIMemory(id)` + `auditLogger.append()`
- `clearAllMemories(): Promise<void>` — 调用 `clearAllAIMemories()` + `auditLogger.append()`

修改 `sendMessage` 方法：
- **所有** `contextBuilder.buildContext()` 调用都需要传入 memories
- 第一次调用（初始构建上下文）：
  ```typescript
  const memories = await getAllAIMemories()
  const context = await contextBuilder.buildContext(currentSession, undefined, memories)
  ```
- 第二次调用（工具结果后重新构建上下文）：
  ```typescript
  const updatedMemories = await getAllAIMemories()
  const updatedContext = await contextBuilder.buildContext(updatedSession, undefined, updatedMemories)
  ```

修改 `initialize` 方法：
- 在初始化末尾调用 `cleanupExpiredMemories()`，应用启动时清理过期记忆

### 3.8 修改文件：`src/utils/dbStores/aiData.ts`

新增：
- `updateAIMemory(id: string, updates: Partial<AIMemory>): Promise<void>` — 更新记忆字段（在 readwrite 事务中读取+更新）
- `toggleAIMemoryPin(id: string): Promise<void>` — 原子操作：在同一个 readwrite 事务中读取当前 pinned 状态，翻转后写回
- `cleanupExpiredMemories(): Promise<number>` — 清理过期记忆，返回清理数量
- `getAIMemoriesByCategoryAndKey(category: string, key: string): Promise<AIMemory[]>` — 按 category+key 查询
- `saveAIMemory` 增加数量上限检查：写入前检查总数是否 < 200（数据层兜底）

### 3.9 修改文件：`src/ai/types.ts`

修改 `L2Context` 接口，新增 `memorySummaries` 字段：
```typescript
export interface L2Context {
  widgetSummaries: Array<{...}>
  dataSourceSummaries: Array<{...}>
  memorySummaries: Array<{
    id: string
    category: string
    key: string
    value: string
    confidence: number
    pinned: boolean
  }>
}
```

### 3.10 修改文件：音乐播放器组件

在音乐播放器组件（`src/components/widgets/MusicPlayer.tsx`）中：

1. 修改组件签名，确保解构 `onUpdateState`：
   ```typescript
   export default function MusicPlayer({ widgetId, onUpdateState }: Props)
   ```

2. 在 `updatePlaylist` 回调中添加：
   ```typescript
   onUpdateState({ songCount: next.tracks.length })
   ```

3. 在 `handlePlayPause` 中播放成功后添加：
   ```typescript
   onUpdateState({ lastPlayedAt: Date.now() })
   ```

4. 在 `handleSelectTrack` 中添加：
   ```typescript
   onUpdateState({ lastPlayedAt: Date.now() })
   ```

5. 在组件初始化加载 playlist 后（`getPlaylist` 回调中）添加：
   ```typescript
   onUpdateState({ songCount: saved.tracks.length })
   ```

### 3.11 修改文件：`src/ai/contextBuilder.ts` — system prompt 记忆使用指引

在 `buildSystemPrompt` 的 `## 记忆` 段落后添加使用指引：
```
## 记忆使用指引
- 当用户要求你记住某事时，使用 save_memory 工具
- 当你推断出用户的偏好或习惯时，主动询问是否需要记住
- 记忆会跨会话保留，你可以在后续对话中回忆
```

## 四、数据流

### 记忆写入流程
1. 用户主动告知："记住我喜欢..." → AI 识别意图 → 调用 `save_memory` 工具 → 用户确认（write 权限）→ 在 storageApi.create() 的 readwrite 事务中按 category+key 原子去重，写入或更新 aiMemories 表
2. AI 推断并确认："我注意到你经常..., 要我记住吗？" → AI 调用 `save_memory`（source=ai_inferred）→ 用户确认 → 写入

### 记忆读取流程
1. 每次发送消息时（`sendMessage`），useAIStore 加载记忆数据，传入 `contextBuilder.buildContext()`，记忆注入 L2 context 和 system prompt
2. AI 也可通过 `list_memories` / `search_memories` 工具主动查询

### 记忆过期流程
1. 应用启动时（`initialize`）从数据库清理过期记忆
2. 每次发送消息时（`sendMessage`），buildContext 中过滤过期记忆（不注入上下文）
3. 用户可在治理 UI 中手动设置或修改过期时间

## 五、验收标准

| 场景 | 验收标准 |
|------|----------|
| AI 保存记忆 | 用户说"记住我喜欢古典音乐"，AI 调用 save_memory，用户确认后记忆写入 aiMemories |
| AI 保存记忆去重 | 用户多次说"记住我喜欢古典音乐"，只保留一条记忆（category+key 相同则更新，原子操作） |
| AI 读取记忆 | 新会话中用户问"我喜欢什么音乐"，AI 从上下文中看到记忆并回答 |
| 记忆置顶 | 用户在治理 UI 中置顶一条记忆，下次会话该记忆始终出现在 system prompt |
| 记忆编辑 | 用户在治理 UI 中编辑记忆内容（value/confidence/expiresAt），保存后更新 |
| 记忆删除 | 用户在治理 UI 中删除记忆，二次确认后删除，审计日志记录 |
| 过期清理 | 设置了 expiresAt 的记忆过期后不再出现在上下文中，应用启动时自动清理 |
| 音乐摘要增强 | musicPlayer 的 getAISummary 返回歌单名称+歌曲数量+最近播放 |
| AI 搜索记忆 | AI 调用 search_memories 工具，返回匹配的记忆列表 |
| AI 不可置顶 | update_memory 不包含 pinned 参数，置顶只能由用户在 UI 中操作 |
| AI 不可删除置顶记忆 | delete_memory 对 pinned=true 的记忆返回错误 |
| 审计完整性 | 治理 UI 操作和 AI 工具操作都记录审计日志 |
| storageApi 一致性 | memoryTools 通过 storageApi 访问数据，与现有工具一致 |
| 记忆上下文一致 | sendMessage 中所有 buildContext 调用都传入 memories |

## 六、文件变更清单

| 操作 | 文件路径 | 变更说明 |
|------|----------|----------|
| 新增 | `src/ai/tools/memoryTools.ts` | AI 记忆工具（save/list/update/delete/search），通过 storageApi 访问 |
| 新增 | `src/components/AIMemoryPanel.tsx` | 记忆治理 UI 组件 |
| 修改 | `src/ai/registerTools.ts` | 注册 memoryTools |
| 修改 | `src/ai/contextBuilder.ts` | 记忆参数传入 + L2 context 注入 + system prompt 记忆段落 + 记忆使用指引 |
| 修改 | `src/ai/types.ts` | L2Context 新增 memorySummaries 字段 |
| 修改 | `src/registry/widgetDefinitions.ts` | MusicPlayerState 新增 songCount/lastPlayedAt + getAISummary 增强 |
| 修改 | `src/components/widgets/MusicPlayer.tsx` | 组件签名 + 同步 songCount 和 lastPlayedAt |
| 修改 | `src/components/widgets/AIAssistant.tsx` | 上下文面板中嵌入记忆管理入口 |
| 修改 | `src/stores/useAIStore.ts` | 新增记忆管理方法 + sendMessage 所有 buildContext 调用传入 memories + initialize 清理过期 |
| 修改 | `src/utils/dbStores/aiData.ts` | 新增 updateAIMemory, toggleAIMemoryPin, cleanupExpiredMemories, getAIMemoriesByCategoryAndKey, saveAIMemory 增加数量检查 |

## 七、边界条件与异常处理

1. **记忆数量上限**：双重点击——memoryTools.execute 中检查并返回 ToolError，aiData.ts 的 saveAIMemory 中也做兜底检查
2. **记忆 value 长度**：最大 500 字符，超出截断
3. **confidence 范围**：0-1，超出 clamp 到 [0, 1]
4. **过期记忆清理**：不抛异常，静默清理，console.warn 记录
5. **AI 不可删除用户置顶记忆**：delete_memory 对 pinned=true 的记忆返回错误
6. **AI 不可修改 pinned 状态**：update_memory 不包含 pinned 参数
7. **记忆搜索**：简单字符串匹配（对 category + key + value 做 includes）
8. **search_memories 空 query**：返回 INVALID_PARAMS 错误
9. **save_memory 去重原子性**：去重查询和写入在同一个 storageApi.create() 的 readwrite 事务中完成
10. **记忆注入 token 预算**：仅截断记忆（按 confidence 升序移除非 pinned），不截断 widgetSummaries
11. **category 强制枚举**：preference|habit|goal|context|fact，在 ToolParameterSchema 中使用 enum
12. **source 完整性**：保留 behavior_stat 值（当前 Phase 不使用但接口预留）
13. **自动生成字段**：id(uuid v4), createdAt(Date.now()), updatedAt(Date.now()), schemaVersion(1), pinned(false) 均由 execute 自动生成
14. **审计完整性**：治理 UI 操作也调用 auditLogger.append() 记录，参数映射规则见 3.5 节
15. **ContextBuilder 纯逻辑**：不直接访问 IndexedDB，记忆数据由调用方传入
16. **过期清理时机**：应用启动时（initialize）从数据库清理；sendMessage 时过滤（不注入上下文）
17. **sendMessage 记忆一致性**：所有 buildContext 调用都传入 memories，包括工具结果后的重新构建
18. **buildSystemPrompt 单一数据源**：记忆段落从 l2.memorySummaries 格式化，不额外传入 memories 参数
