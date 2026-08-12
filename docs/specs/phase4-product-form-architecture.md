# Phase 4 Spec：产品形态改造 + 架构改造

> 生成日期：2026-06-24
> 状态：待对抗审查
> 依据：
> - [roadmap_desktop_v1.md](file:///f:/allmylife/event/docs/roadmap_desktop_v1.md) Phase 4
> - [architecture_refactor.md](file:///f:/allmylife/event/docs/architecture_refactor.md) 架构改造文档
> - [desktop_product_design.md](file:///f:/allmylife/event/docs/desktop_product_design.md) 产品形态设计
>
> **项目目的**：Living Dashboard 桌面端是"浏览器 + 无限画布 + AI"形态的日常 AI 助手。Phase 4 实现新产品形态（浏览器与画布五五开、两种主页、标签管理分离）+ 架构改造（按面板 session、多端并行、乐观锁、AI 配置、Skills 管理）。
>
> **约束**：TypeScript 优先、不下载 C 盘、git 版本管理、与移动端数据互通、不改 Phase 0-3 spec。

---

## 一、现状分析（已确认）

### 1.1 已完成（不需改动）

| 项 | 状态 | 位置 |
|----|------|------|
| lucide-react 已安装 | ✅ v1.17.0 | [package.json](file:///f:/allmylife/event/package.json) |
| product-guide skill | ✅ 已存在 | [.pi/skills/product-guide/SKILL.md](file:///f:/allmylife/event/.pi/skills/product-guide/SKILL.md) |
| 架构文档 + 4 决策 | ✅ 已确认 | [architecture_refactor.md](file:///f:/allmylife/event/docs/architecture_refactor.md) 第十二章 |
| Phase 3 已提交 | ✅ commit d5c4b88 | git log |

### 1.2 待实现（本 Spec 覆盖）

**4.1 架构改造（P0）**：按面板 session、按面板路由工具调用、AI 上下文持久化、乐观锁、syncQueue 持久化加强
**4.2 AI 配置与 Skills（P0）**：AI 配置 tab、API 配置 UI、提示词配置 UI、Skills 管理 UI、MCP 残留清理
**4.3 UI 图标方案（P0）**：图标统一审计、Logo 资源
**4.4 产品形态改造**：去掉 desktop appMode、标签管理分离、两种主页、嵌入按钮、Omnibox 位置、UnifiedToolbar 仅画布、主页定制、New Tab 行为

---

## 二、任务 4.1：架构改造（服务器 + 客户端）

### 2.1 数据库 schema 扩展

**文件**：[server/src/db/schema.ts](file:///f:/allmylife/event/server/src/db/schema.ts)

新增 5 张表（追加到 SCHEMA_SQL，全部 `CREATE TABLE IF NOT EXISTS` 幂等）：

```sql
-- AI 对话历史（按面板，架构文档 2.4）
CREATE TABLE IF NOT EXISTS ai_conversations (
  id BIGSERIAL PRIMARY KEY,
  panel_id TEXT NOT NULL,
  role VARCHAR(16) NOT NULL,             -- user/assistant/tool
  content TEXT NOT NULL,
  tool_calls JSONB,
  tool_result JSONB,
  device_id VARCHAR(64),
  summarized BOOLEAN NOT NULL DEFAULT FALSE,
  summary_of BIGINT[],
  retention_level VARCHAR(16) NOT NULL DEFAULT 'full',
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL DEFAULT (EXTRACT(EPOCH FROM now()) * 1000)::BIGINT
);
CREATE INDEX IF NOT EXISTS idx_ai_conv_panel_created ON ai_conversations(panel_id, created_at);

-- AI 记忆（按面板，长期记忆，架构文档 2.4）
CREATE TABLE IF NOT EXISTS ai_memories (
  id BIGSERIAL PRIMARY KEY,
  panel_id TEXT NOT NULL,
  memory_type VARCHAR(32),               -- fact/preference/summary
  content TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ai_mem_panel ON ai_memories(panel_id);

-- AI 设置（键值存储，架构文档 9.4）
CREATE TABLE IF NOT EXISTS ai_settings (
  key VARCHAR(128) PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at BIGINT NOT NULL
);

-- 用户自定义 skills（架构文档 9.4）
CREATE TABLE IF NOT EXISTS user_skills (
  id VARCHAR(64) PRIMARY KEY,
  name VARCHAR(128) NOT NULL,
  description TEXT,
  content TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);

-- 工具启用状态（架构文档 9.4）
CREATE TABLE IF NOT EXISTS tool_settings (
  tool_name VARCHAR(64) PRIMARY KEY,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at BIGINT NOT NULL
);
```

**dynamic_widgets 表扩展**（架构文档 6.4 + 12.3，方案 C）：

```sql
-- 幂等 ALTER：用 DO 块检查列是否存在
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'dynamic_widgets' AND column_name = 'component_env') THEN
    ALTER TABLE dynamic_widgets ADD COLUMN component_env VARCHAR(16) NOT NULL DEFAULT 'pure-frontend';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'dynamic_widgets' AND column_name = 'local_services') THEN
    ALTER TABLE dynamic_widgets ADD COLUMN local_services JSONB;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'dynamic_widgets' AND column_name = 'cross_platform') THEN
    ALTER TABLE dynamic_widgets ADD COLUMN cross_platform BOOLEAN NOT NULL DEFAULT TRUE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'dynamic_widgets' AND column_name = 'desktop_only') THEN
    ALTER TABLE dynamic_widgets ADD COLUMN desktop_only BOOLEAN NOT NULL DEFAULT FALSE;
  END IF;
END $$;
```

**验收**：服务器启动时 schema 初始化无报错；新表存在；dynamic_widgets 新字段存在。

### 2.2 按面板 session（架构文档 二）

**文件**：[server/src/piBridge.ts](file:///f:/allmylife/event/server/src/piBridge.ts)、[server/src/ws.ts](file:///f:/allmylife/event/server/src/ws.ts)

**现状**：全局单 session（`let session: AgentSession | null`），所有设备共享。`SessionManager.inMemory(cwd)` 是单例。

**改造方案**：

**SessionManager 策略**：每个面板创建独立的 AgentSession，但共享同一个 SessionManager（inMemory 单例）。AgentSession 本身是独立实例，SessionManager 只负责底层会话存储。

```typescript
// piBridge.ts: 替换全局 session 为 Map<panelId, AgentSession>
const panelSessions = new Map<string, AgentSession>()

// session 超时清理（7 天未用，决策 12.1）
const SESSION_TIMEOUT_MS = 7 * 24 * 60 * 60 * 1000
const sessionLastUsed = new Map<string, number>()

// 共享的 SessionManager（单例，AgentSession 内部使用）
let sharedSessionManager: ReturnType<typeof SessionManager.inMemory> | null = null

async function getOrCreatePanelSession(panelId: string): Promise<AgentSession> {
  // 检查超时清理
  const lastUsed = sessionLastUsed.get(panelId)
  if (lastUsed && Date.now() - lastUsed > SESSION_TIMEOUT_MS) {
    const old = panelSessions.get(panelId)
    if (old) {
      await old.dispose?.()
      panelSessions.delete(panelId)
    }
  }

  let s = panelSessions.get(panelId)
  if (!s) {
    s = await createSession(panelId)
    // 从数据库恢复上下文（架构文档 2.5）
    await restoreSessionContext(s, panelId)
    panelSessions.set(panelId, s)
  }
  sessionLastUsed.set(panelId, Date.now())
  return s
}

// 定时清理（每小时扫描一次）
setInterval(() => {
  const now = Date.now()
  for (const [panelId, lastUsed] of sessionLastUsed) {
    if (now - lastUsed > SESSION_TIMEOUT_MS) {
      const s = panelSessions.get(panelId)
      if (s) s.dispose?.()
      panelSessions.delete(panelId)
      sessionLastUsed.delete(panelId)
    }
  }
}, 60 * 60 * 1000)
```

**createSession 函数改造**：

```typescript
// 改造前：createSession() 无参数
// 改造后：createSession(panelId: string) 接收面板 ID
async function createSession(panelId: string): Promise<AgentSession> {
  const cwd = process.cwd()
  const agentDir = getAgentDir()

  // SessionManager 单例（只创建一次）
  if (!sharedSessionManager) {
    sharedSessionManager = SessionManager.inMemory(cwd)
  }

  // ... resourceLoader / authStorage / modelRegistry 逻辑不变 ...

  const { session: s } = await createAgentSession({
    cwd,
    agentDir,
    resourceLoader,
    sessionManager: sharedSessionManager,  // 共享单例
    authStorage,
    modelRegistry,
    model,
    noTools: 'builtin',
    customTools,
  })

  // 订阅 pi 事件，广播到该面板的所有在线设备
  s.subscribe((event) => {
    forwardEventToClient(event, panelId)  // 携带 panelId
  })

  return s
}
```

**WS 协议改造（ClientMessage 类型扩展）**：

```typescript
// ws.ts: ClientMessage 增加 panelId 字段
export type ClientMessage =
  | { kind: 'user_message'; panelId: string; content: string }  // 新增 panelId（必填）
  | { kind: 'tool_result'; requestId: string; success: boolean; data?: unknown; error?: string }
  | { kind: 'error_report'; widgetId: string; message: string; stack?: string; source: string }
  | { kind: 'ping' }

// ServerMessage: pi_event 增加 panelId
export type ServerMessage =
  | { kind: 'tool_call'; requestId: string; tool: string; params: unknown; targetDeviceId?: string; panelId?: string }
  | { kind: 'pi_event'; event: string; data: unknown; panelId?: string }  // 新增 panelId
  | { kind: 'session_ready'; sessionId: string; panelId?: string }  // 新增 panelId
  | { kind: 'error'; message: string }
  | { kind: 'pong' }
  | { kind: 'change'; changeType: string; data: unknown; sourceDeviceId?: string }
```

**消息路由改造**：

```typescript
// piBridge.ts: handleUserMessage 接收 panelId
async function handleUserMessage(content: string, deviceId: string, panelId: string): Promise<void> {
  const session = await getOrCreatePanelSession(panelId)
  // 持久化到 ai_conversations
  await persistConversation(panelId, 'user', content, deviceId)
  // 设置该面板的活跃设备
  setPanelActiveDevice(panelId, deviceId)
  // 发送到 agent
  await session.send({ type: 'user_message', content })
}

// onClientMessage handler 改造
onClientMessage((msg, deviceId) => {
  if (msg.kind === 'user_message') {
    if (!msg.panelId) {
      sendToDevice(deviceId, { kind: 'error', message: 'panelId is required for user_message' })
      return
    }
    handleUserMessage(msg.content, deviceId, msg.panelId).catch(...)
  }
  // ... 其他消息类型不变
})
```

**forwardEventToClient 改造**：

```typescript
// 改造前：广播到所有客户端
// 改造后：广播到该面板的所有在线设备（携带 panelId，客户端按 panelId 过滤）
function forwardEventToClient(event: unknown, panelId: string): void {
  const e = event as { type?: string; [key: string]: unknown }
  if (!e || typeof e.type !== 'string') return
  broadcast({ kind: 'pi_event', event: e.type, data: e, panelId })
}
```

**客户端改造**：

- [client/desktop/src/stores/useAIStore.ts](file:///f:/allmylife/event/client/desktop/src/stores/useAIStore.ts)：发送 user_message 时携带当前 `activePanelId`
- [client/desktop/src/api/client.ts](file:///f:/allmylife/event/client/desktop/src/api/client.ts)：WS send 方法增加 panelId 参数
- 客户端接收 pi_event 时，按 panelId 过滤，只处理当前活跃面板的事件

**向后兼容**：本次改造不保留旧协议（无 panelId 的 user_message），因为客户端和服务器同步升级。如果客户端未升级，服务器返回错误提示。

**验收**：
- 不同面板的 AI 对话不互相污染
- 7 天未用的面板 session 自动清理
- 服务器重启后，面板 session 从数据库恢复最近 20 条对话 + memories
- pi_event 携带 panelId，客户端按面板过滤
- 无 panelId 的 user_message 返回错误

### 2.3 按面板路由工具调用（架构文档 三）

**文件**：[server/src/piBridge.ts](file:///f:/allmylife/event/server/src/piBridge.ts)

**现状**：全局单一 `activeDeviceId`。

**改造**：

```typescript
// 替换全局 activeDeviceId 为 Map<panelId, deviceId>
const panelActiveDevices = new Map<string, string>()

export function setPanelActiveDevice(panelId: string, deviceId: string): void {
  panelActiveDevices.set(panelId, deviceId)
  console.log(`[PiBridge] Panel ${panelId} active device: ${deviceId}`)
}

function executeViaWs(tool: string, params: unknown, panelId: string): Promise<unknown> {
  // 路由到该面板的活跃设备
  const targetDeviceId = panelActiveDevices.get(panelId)
  if (DEVICE_SPECIFIC_TOOLS.has(tool)) {
    if (!targetDeviceId || !hasDevice(targetDeviceId)) {
      throw new Error(`no active device for panel ${panelId}, tool: ${tool}`)
    }
  }
  // ... 其余逻辑不变，但用 targetDeviceId
}
```

**工具调用携带 panelId**：customTools 中的工具定义需改造，让 executeViaWs 知道当前 panelId。通过 session 上下文传递（session 创建时绑定 panelId）。

**验收**：
- 面板1 的 AI 操作路由到面板1 的活跃设备
- 面板2 的 AI 操作路由到面板2 的活跃设备
- 不同面板可并行 AI 操作

### 2.4 AI 上下文持久化（架构文档 2.4-2.5 + 12.1）

**新增文件**：`server/src/db/aiContext.ts`

```typescript
// 持久化对话
export async function persistConversation(
  panelId: string,
  role: string,
  content: string,
  deviceId?: string,
  toolCalls?: unknown,
  toolResult?: unknown,
): Promise<void> {
  const pool = getPool()
  const now = Date.now()
  await pool.query(
    `INSERT INTO ai_conversations (panel_id, role, content, tool_calls, tool_result, device_id, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $7)`,
    [panelId, role, content, toolCalls ? JSON.stringify(toolCalls) : null, toolResult ? JSON.stringify(toolResult) : null, deviceId || null, now]
  )
}

// 获取最近 N 条对话
export async function getRecentConversations(panelId: string, limit: number = 20): Promise<Conversation[]> {
  const pool = getPool()
  const result = await pool.query(
    `SELECT * FROM ai_conversations WHERE panel_id = $1 AND retention_level = 'full' ORDER BY created_at DESC LIMIT $2`,
    [panelId, limit]
  )
  return result.rows.reverse()  // 按时间正序返回
}

// 获取面板记忆
export async function getPanelMemories(panelId: string): Promise<Memory[]> {
  const pool = getPool()
  const result = await pool.query(
    `SELECT * FROM ai_memories WHERE panel_id = $1 ORDER BY updated_at DESC`,
    [panelId]
  )
  return result.rows
}

// 恢复 session 上下文（架构文档 2.5）
export async function restoreSessionContext(session: AgentSession, panelId: string): Promise<void> {
  // 1. 加载最近 20 条对话
  const conversations = await getRecentConversations(panelId, 20)
  // 2. 加载该面板的 memories
  const memories = await getPanelMemories(panelId)
  // 3. 重建 session 上下文（通过 send 注入历史，不触发 AI 回复）
  for (const conv of conversations) {
    // 注入历史消息（role + content，标记为历史，不触发新回复）
    // 具体注入方式取决于 pi-coding-agent 的 API
  }
  // 4. memories 作为系统上下文补充
  if (memories.length > 0) {
    const memoryContext = memories.map(m => `- ${m.content}`).join('\n')
    // 注入为系统上下文
  }
}

// 分层保留（决策 12.1）
// 近期（30 天内）：完整保留
// 中期（30-90 天）：AI 自动总结成摘要，丢弃原始对话
// 长期（90 天+）：只保留 ai_memories 表中的结构化记忆
export async function runRetentionCleanup(): Promise<void> {
  const pool = getPool()
  const now = Date.now()
  const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000
  const ninetyDaysAgo = now - 90 * 24 * 60 * 60 * 1000

  // 1. 30 天前的 full 对话 → AI 总结成 summary，原对话 summarized=TRUE
  const oldConversations = await pool.query(
    `SELECT panel_id, array_agg(id ORDER BY created_at) as conv_ids, array_agg(content ORDER BY created_at) as contents
     FROM ai_conversations
     WHERE retention_level = 'full' AND created_at < $1
     GROUP BY panel_id`,
    [thirtyDaysAgo]
  )
  for (const row of oldConversations.rows) {
    // 调用 AI 总结（复用 piBridge 的 session）
    const summary = await summarizeConversations(row.contents)
    // 插入 summary 条目
    await pool.query(
      `INSERT INTO ai_conversations (panel_id, role, content, retention_level, summary_of, created_at, updated_at)
       VALUES ($1, 'assistant', $2, 'summary', $3, $4, $4)`,
      [row.panel_id, summary, row.conv_ids, now]
    )
    // 原对话标记 summarized=TRUE，retention_level='summary'
    await pool.query(
      `UPDATE ai_conversations SET summarized = TRUE, retention_level = 'summary', updated_at = $1
       WHERE id = ANY($2)`,
      [now, row.conv_ids]
    )
  }

  // 2. 90 天前的 summary → 提取到 ai_memories，删除 summary 条目
  const oldSummaries = await pool.query(
    `SELECT * FROM ai_conversations WHERE retention_level = 'summary' AND created_at < $1`,
    [ninetyDaysAgo]
  )
  for (const row of oldSummaries.rows) {
    // 提取关键信息到 ai_memories
    const memories = await extractMemories(row.content)
    for (const mem of memories) {
      await pool.query(
        `INSERT INTO ai_memories (panel_id, memory_type, content, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $4)`,
        [row.panel_id, mem.type, mem.content, now]
      )
    }
    // 删除 summary 条目
    await pool.query(`DELETE FROM ai_conversations WHERE id = $1`, [row.id])
  }

  // 3. ai_memories 永久保留（结构化记忆，体积小）
}

// 辅助函数（需调用 AI，可复用 panelSessions 中的 session）
async function summarizeConversations(contents: string[]): Promise<string> {
  // 调用 AI 总结对话内容
  // 返回摘要文本
}

async function extractMemories(summary: string): Promise<Array<{ type: string; content: string }>> {
  // 调用 AI 从摘要中提取结构化记忆
  // 返回记忆列表
}
```

**定时任务**：[server/src/index.ts](file:///f:/allmylife/event/server/src/index.ts) 启动时注册定时器（每天 03:00 执行 runRetentionCleanup）。

```typescript
// server/src/index.ts
import { runRetentionCleanup } from './db/aiContext.js'

// 每天 03:00 执行分层保留清理
const RETENTION_CRON_HOUR = 3
function scheduleRetentionCleanup() {
  const now = new Date()
  const next = new Date(now)
  next.setHours(RETENTION_CRON_HOUR, 0, 0, 0)
  if (next <= now) next.setDate(next.getDate() + 1)
  const delay = next.getTime() - now.getTime()
  setTimeout(() => {
    runRetentionCleanup().catch(console.error)
    setInterval(() => {
      runRetentionCleanup().catch(console.error)
    }, 24 * 60 * 60 * 1000)
  }, delay)
}
```

**验收**：
- 对话发送后，ai_conversations 表有记录
- 服务器重启后，session 能恢复最近 20 条对话
- 30 天前的对话被总结成 summary（retention_level='summary'）
- 90 天前的 summary 被提取到 ai_memories 并删除
- ai_memories 永久保留

### 2.5 冲突解决：真正的乐观锁（架构文档 四 + 12.2）

**文件**：[server/src/routes/widgets.ts](file:///f:/allmylife/event/server/src/routes/widgets.ts)、[server/src/routes/panels.ts](file:///f:/allmylife/event/server/src/routes/panels.ts)、[server/src/routes/entities.ts](file:///f:/allmylife/event/server/src/routes/entities.ts)

**现状**：`UPDATE widgets SET state = $1, version = version + 1 WHERE id = $2`（无 version 校验）。

**冲突解决算法伪代码**（智能分场景，决策 12.2）：

```
function resolveConflict(updateType, localState, remoteState, expectedVersion, currentVersion):
  if expectedVersion == currentVersion:
    # 无冲突，正常更新
    return applyUpdate(localState)

  # 版本不匹配，冲突
  switch updateType:
    case 'position' | 'size':
      # 位置/尺寸冲突：LWW（不重要，直接覆盖）
      return applyUpdate(localState)

    case 'state':
      # state 冲突：LWW + 角标提示
      applyUpdate(localState)  # 默认 LWW
      return {
        conflict: true,
        conflictType: 'state',
        localVersion: expectedVersion,
        remoteVersion: currentVersion,
        remoteState: remoteState,
        message: '组件状态有冲突，点击查看'
      }

    case 'panel_delete':
      # 面板删除冲突：删除优先
      return applyDelete()  # 已删就删了

    case 'entity_data':
      # 实体数据冲突：LWW + 冲突日志
      applyUpdate(localState)
      logConflict(entityId, localState, remoteState)
      return { conflict: false }

    default:
      return applyUpdate(localState)  # 默认 LWW
```

**改造**（智能分场景，决策 12.2）：

```typescript
// 位置/尺寸更新：LWW（不校验 version，位置冲突不重要）
panelWidgetsRouter.put('/batch-positions', async (req, res) => {
  // 保持现状，version = version + 1
})

// state 更新：乐观锁 + 冲突标记
widgetsRouter.put('/:id/state', async (req, res) => {
  const { state, expectedVersion } = req.body
  const result = await pool.query(
    `UPDATE widgets SET state = $1, version = version + 1, updated_at = $2
     WHERE id = $3 AND version = $4 RETURNING *`,
    [JSON.stringify(state), Date.now(), req.params.id, expectedVersion]
  )
  if (result.rows.length === 0) {
    // 版本不匹配，冲突
    const current = await pool.query('SELECT * FROM widgets WHERE id = $1', [req.params.id])
    if (current.rows.length === 0) {
      res.status(404).json({ error: 'widget not found' })
      return
    }
    res.status(409).json({
      conflict: true,
      conflictType: 'state',
      currentVersion: current.rows[0].version,
      currentState: current.rows[0].state,
      message: '组件状态有冲突，点击查看',
    })
    return
  }
  res.json(parseWidgetRow(result.rows[0]))
})

// 面板删除：删除优先（已删就删了）
panelsRouter.delete('/:id', async (req, res) => {
  // 保持现状，DELETE WHERE id = $1（删除优先，不校验 version）
})
```

**客户端冲突处理 UI**（架构文档 12.2）：

**新增文件**：`client/desktop/src/components/ConflictBadge.tsx`

```typescript
// 组件右上角显示角标，点击展开冲突处理面板
// 选项：保留本地 / 保留远端 / 合并 / 查看差异
interface ConflictBadgeProps {
  widgetId: string
  localVersion: number
  remoteVersion: number
  remoteState: WidgetState
  onResolve: (action: 'keep-local' | 'keep-remote' | 'merge', mergedState?: WidgetState) => void
}

// UI 交互流程：
// 1. 检测到 409 响应 → 存储冲突信息到 useAppStore.conflicts
// 2. WidgetContainer 渲染时检查 conflicts[widgetId]，有冲突则显示角标
// 3. 点击角标 → 展开冲突处理面板（保留本地/保留远端/合并/查看差异）
// 4. 用户选择 → 调用 onResolve → 用最新 version 重新提交
```

**useAppStore 改造**：

```typescript
// useAppStore 新增
interface ConflictInfo {
  widgetId: string
  localVersion: number
  remoteVersion: number
  remoteState: Record<string, unknown>
  timestamp: number
}
conflicts: Record<string, ConflictInfo>  // widgetId → ConflictInfo
addConflict: (widgetId: string, info: Omit<ConflictInfo, 'widgetId' | 'timestamp'>) => void
resolveConflict: (widgetId: string, action: 'keep-local' | 'keep-remote' | 'merge', mergedState?: Record<string, unknown>) => Promise<void>
clearConflict: (widgetId: string) => void

// updateWidgetState 改造：失败时（409），存储冲突信息
async updateWidgetState(widgetId: string, partial: Record<string, unknown>) {
  // ... 现有逻辑 ...
  try {
    await api.updateWidgetState(widgetId, partial, expectedVersion)
  } catch (err) {
    if (err.status === 409) {
      // 冲突，存储冲突信息
      get().addConflict(widgetId, {
        localVersion: expectedVersion,
        remoteVersion: err.data.currentVersion,
        remoteState: err.data.currentState,
      })
    }
    throw err
  }
}
```

**验收**：
- 并发修改同一 widget state 不静默丢失
- state 冲突时返回 409 + 当前服务器版本
- 客户端显示冲突角标，可选择保留本地/远端/合并
- 位置/尺寸冲突用 LWW（不提示）
- 面板删除冲突删除优先
- 实体数据冲突 LWW + 日志

### 2.6 syncQueue 持久化加强（架构文档 五）

**文件**：[client/desktop/src/utils/syncQueue.ts](file:///f:/allmylife/event/client/desktop/src/utils/syncQueue.ts)、[client/desktop/electron/main/index.ts](file:///f:/allmylife/event/client/desktop/electron/main/index.ts)

**现状**：仅 IndexedDB，5 次重试放弃。

**文件持久化格式**：
- **格式**：JSONL（每行一条记录，便于追加）
- **存储路径**：`app.getPath('userData')/sync-log.jsonl`（Electron 用户数据目录，非 C 盘）
- **轮转策略**：超过 1000 条时清理已 success 的记录；保留最近 7 天的 failed 记录
- **记录结构**：`{ timestamp, op, status, error? }`

**改造**：

```typescript
// 1. 增加 Electron 日志文件持久化（通过 IPC）
// electron/main/index.ts: 暴露 sync-log 写入 IPC
import { app } from 'electron'
import * as fs from 'fs'
import * as path from 'path'

const SYNC_LOG_MAX_ENTRIES = 1000
const SYNC_LOG_RETENTION_DAYS = 7

function getSyncLogPath(): string {
  return path.join(app.getPath('userData'), 'sync-log.jsonl')
}

function readSyncLog(): SyncLogEntry[] {
  const logPath = getSyncLogPath()
  if (!fs.existsSync(logPath)) return []
  const content = fs.readFileSync(logPath, 'utf-8')
  return content.split('\n').filter(Boolean).map(line => JSON.parse(line))
}

function rotateSyncLog(entries: SyncLogEntry[]): void {
  // 超过 1000 条时清理 success 记录
  if (entries.length > SYNC_LOG_MAX_ENTRIES) {
    const filtered = entries.filter(e =>
      e.status === 'failed' ||
      Date.now() - e.timestamp < SYNC_LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000
    )
    fs.writeFileSync(getSyncLogPath(), filtered.map(e => JSON.stringify(e)).join('\n') + '\n')
  }
}

ipcMain.handle('sync-log:append', (event, entry: SyncLogEntry) => {
  const logPath = getSyncLogPath()
  fs.appendFileSync(logPath, JSON.stringify({ timestamp: Date.now(), ...entry }) + '\n')
})

ipcMain.handle('sync-log:read', () => {
  return readSyncLog()
})

ipcMain.handle('sync-log:rotate', () => {
  const entries = readSyncLog()
  rotateSyncLog(entries)
})

// electron/preload/index.ts: 暴露 API
syncLog: {
  append: (entry: SyncLogEntry) => ipcRenderer.invoke('sync-log:append', entry)
  read: () => ipcRenderer.invoke('sync-log:read')
  rotate: () => ipcRenderer.invoke('sync-log:rotate')
}

// 2. 无上限重试 + 指数退避
const RETRY_DELAYS = [1000, 2000, 4000, 8000, 16000, 60000] // 指数退避
function getRetryDelay(retryCount: number): number {
  return RETRY_DELAYS[Math.min(retryCount, RETRY_DELAYS.length - 1)]
}

// 3. 失败标记 + UI 提示
// syncQueue.ts: 超过 N 次仍失败，标记为 failed，触发 UI 事件
const FAILED_THRESHOLD = 10  // 超过 10 次标记为 failed
export const syncQueueFailedEntries = new Set<string>()

// useAppStore: 监听 failedEntries，显示 UI 提示
// App.tsx: 显示 "有 N 个同步失败的操作" 提示

// 4. 冲突检测：回写时校验 version
async function executeSyncOp(entry: SyncQueueEntry): Promise<void> {
  const response = await api.execute(entry)
  if (response.status === 409) {
    // 冲突，触发冲突处理流程
    throw new SyncConflictError(entry.entityId, response.data)
  }
}

// 5. 启动时从日志恢复（清缓存后不丢）
export async function initSyncQueue(): Promise<void> {
  // 从日志文件恢复 failed 记录到 IndexedDB
  const logEntries = await window.electron.syncLog.read()
  const failedEntries = logEntries.filter(e => e.status === 'failed')
  for (const entry of failedEntries) {
    await addToIdbQueue(entry.op)
  }
  // 启动定时刷新
  if (!flushTimer) {
    flushTimer = setInterval(() => {
      flushSyncQueue().catch(console.error)
    }, SYNC_FLUSH_INTERVAL_MS)
  }
}
```

**验收**：
- 清缓存后，syncQueue 从日志文件恢复 failed 记录
- 无上限重试（指数退避：1s/2s/4s/8s/16s/60s）
- 超过 10 次失败标记为 failed，UI 提示用户手动处理
- 回写冲突时触发冲突处理
- 日志文件超过 1000 条时自动轮转
- 日志文件存储在 Electron userData 目录（非 C 盘）

---

## 三、任务 4.2：AI 配置与 Skills

### 3.1 AI 配置 tab（架构文档 九）

**文件**：[client/desktop/src/components/SettingsPanel.tsx](file:///f:/allmylife/event/client/desktop/src/components/SettingsPanel.tsx)

**现状**：4 个 tab（外观/行为/数据/服务器）。

**改造**：新增 "AI 配置" tab，包含 3 个子区域：

```typescript
// SettingsPanel.tsx: tabs 数组新增
const TABS = [
  { id: 'appearance', label: '外观', icon: Palette },
  { id: 'behavior', label: '行为', icon: Settings },
  { id: 'data', label: '数据管理', icon: Database },
  { id: 'server', label: '服务器', icon: Server },
  { id: 'ai', label: 'AI 配置', icon: Bot },  // 新增
]
```

### 3.2 API 配置 UI（架构文档 9.3.1）

**新增文件**：`client/desktop/src/components/settings/AIApiConfig.tsx`

```typescript
// 内容：
// - 模型选择：<provider>/<model> 文本输入（如 stepfun/step-3.7-flash）
// - API Key：密码输入框（经服务器 API 保存到 auth.json，客户端不持有）
// - Endpoint：自定义 API endpoint（可选）
// - 连接测试：按钮，调用服务器 /api/ai/test-connection
```

**新增服务器 API**：`server/src/routes/aiSettings.ts`

```typescript
// GET /api/ai/settings         → 获取 AI 设置（不含 API Key）
// PUT /api/ai/settings         → 更新 AI 设置（API Key 经此保存到 auth.json）
// POST /api/ai/test-connection → 测试 API 连接
// GET /api/ai/prompts          → 获取提示词（系统/画布/浏览器）
// PUT /api/ai/prompts          → 更新提示词
// POST /api/ai/prompts/reset   → 恢复默认提示词
```

**piBridge.ts 改造**：从 ai_settings 表读取模型配置，从 ai_settings 读取提示词（替代硬编码 canvasPrompt/browserPrompt）。

**验收**：
- API/模型/Endpoint 可通过 UI 配置
- API Key 存服务器 auth.json，客户端不持有
- 连接测试按钮可验证 API 可用性
- 提示词可通过 UI 编辑，有默认值，可恢复默认

### 3.3 提示词配置 UI（架构文档 9.3.2）

**新增文件**：`client/desktop/src/components/settings/AIPromptConfig.tsx`

```typescript
// 3 个文本域：
// - 系统提示词（覆盖/追加默认系统提示词）
// - 画布提示词（默认值 = canvasPrompt 硬编码内容）
// - 浏览器提示词（默认值 = browserPrompt 硬编码内容）
// - "恢复默认"按钮
```

**验收**：提示词可通过 UI 配置，有默认值，可恢复默认。

### 3.4 Skills 管理 UI（架构文档 9.3.3）

**新增文件**：`client/desktop/src/components/settings/AISkillsManager.tsx`

```typescript
// 功能：
// - Skills 列表（名称/描述/版本/来源：内置/用户）
// - 启用/禁用开关
// - 查看内容（显示 SKILL.md 内容）
// - 添加 skill（输入名称+内容，存服务器 user_skills 表）
// - 删除 skill（仅用户添加的，内置不可删）
// - Skills 目录配置（额外的 skills 目录路径）
```

**内置 skills 扫描**：服务器启动时扫描 `.pi/skills/` 目录，读取 SKILL.md frontmatter（name/description/version）。现有的 [product-guide skill](file:///f:/allmylife/event/.pi/skills/product-guide/SKILL.md) 会被自动识别为内置 skill。

**Skills 管理对 product-guide 的处理**：
- product-guide 显示在 Skills 列表中，来源标记为"内置"
- 内置 skill 不可删除（UI 隐藏删除按钮）
- 内置 skill 可启用/禁用（禁用后 AI 不加载该 skill）
- 内置 skill 可查看内容（只读）

**新增服务器 API**：`server/src/routes/skills.ts`

```typescript
// GET    /api/skills              → 列出所有 skills（内置 + 用户）
//   返回：[{ id, name, description, version, source: 'builtin'|'user', enabled, canDelete: boolean }]
// POST   /api/skills              → 创建用户 skill
// PUT    /api/skills/:id          → 更新 skill（内容/启用状态）
// DELETE /api/skills/:id          → 删除用户 skill（内置返回 403）
// GET    /api/skills/:id/content  → 获取 skill 内容（SKILL.md 全文）
```

**piBridge.ts 改造**：createSession 时根据 tool_settings 表过滤启用的 skills，注入到 agent 上下文。

**验收**：
- Skills 列表显示内置（product-guide）+ 用户 skills
- product-guide 标记为"内置"，不可删除，可启用/禁用
- 可启用/禁用单个 skill
- 可查看 skill 内容（product-guide 显示 SKILL.md 全文）
- 可添加/删除用户 skill
- 内置 skill 不可删除（API 返回 403）

### 3.5 MCP 残留清理（架构文档 8.2）

**删除文件**：
- [.mcp.json](file:///f:/allmylife/event/.mcp.json)
- [client/desktop/src/registry/mcpManifest.ts](file:///f:/allmylife/event/client/desktop/src/registry/mcpManifest.ts)

**修改文件**：
- [client/desktop/src/types/v2.ts](file:///f:/allmylife/event/client/desktop/src/types/v2.ts)：删除 `DisabledMcpComponentManifest` interface（第 158-163 行）
- [client/desktop/src/components/WidgetContainer.tsx](file:///f:/allmylife/event/client/desktop/src/components/WidgetContainer.tsx)：删除 `isMcpComponent`/`getMcpManifest`/`renderMcpDisabledPlaceholder` 引用（第 8 行 import，第 20 行 isMcpComponent 判断，第 25 行 mcpPlaceholder）
- [client/desktop/src/utils/widgetRender.ts](file:///f:/allmylife/event/client/desktop/src/utils/widgetRender.ts)：删除 `isMcpComponent` 字段（第 13 行）和相关逻辑（第 15-17 行）

**回退方案（清理后如何处理依赖 MCP 的组件）**：
- `isMcpComponent(widgetType)` 删除后，WidgetContainer 不再有 MCP 判断分支
- 如果有 `widgetType.startsWith('mcp:')` 的组件（实际上当前没有），按普通 widget 处理（渲染失败由 WidgetErrorBoundary 兜底）
- `renderMcpDisabledPlaceholder` 删除后，不再有 MCP 占位提示
- `DisabledMcpComponentManifest` 类型删除后，确保无任何文件引用（grep 验证）

**验收**：
- `.mcp.json` 文件不存在
- `mcpManifest.ts` 文件不存在
- `DisabledMcpComponentManifest` 类型不存在（grep 全项目无结果）
- `isMcpComponent`/`getMcpManifest`/`renderMcpDisabledPlaceholder` 无引用（grep 全项目无结果）
- WidgetContainer.tsx 无 MCP 判断分支
- widgetRender.ts 无 isMcpComponent 字段
- TypeScript 编译通过
- 现有 widget 渲染正常（无 MCP 相关报错）

---

## 四、任务 4.3：UI 图标方案

### 4.1 图标统一审计

**文件**：所有 `client/desktop/src/components/*.tsx`

**现状**：lucide-react 已安装，部分组件已用，但可能有遗漏的 emoji 或其他图标。

**改造**：审计所有组件，确保所有图标用 lucide-react。常用图标映射（架构文档 7.2）：

| 用途 | lucide-react |
|------|--------------|
| 后退/前进/刷新 | ArrowLeft / ArrowRight / RotateCw |
| 新建/关闭/嵌入 | Plus / X / Pin |
| 主页/搜索 | Home / Search |
| 标签页/菜单/设置 | Square / MoreVertical / Settings |
| 缩放 | ZoomIn / ZoomOut |
| 画布模式/画笔/橡皮/连线 | MousePointer2 / Pen / Eraser / Spline |
| AI | Bot / Sparkles |

**验收**：所有图标用 lucide-react，无 emoji 作为图标，风格一致。

### 4.2 Logo 资源

**文件**：`client/desktop/src/assets/`

**现状**：已有 `hero.png`、`react.svg`、`vite.svg`，根目录有 `daily.png`。

**改造**：
- 复制 `daily.png` 到 `client/desktop/src/assets/logo.png`（或用现有 hero.png）
- 在两种主页中使用
- 可选：创建 SVG 版本（矢量优先）

**验收**：Logo 在两种主页显示正常。

---

## 五、任务 4.4：产品形态改造

### 5.1 去掉 desktop appMode（产品形态设计 5.1-5.2）

**影响文件全清单（共 9 个，必须全部修改）**：

| 文件 | 修改内容 |
|------|---------|
| [client/desktop/src/types/index.ts](file:///f:/allmylife/event/client/desktop/src/types/index.ts) | 移除 `appMode: 'canvas' \| 'desktop'` 类型 |
| [client/desktop/src/stores/useAppStore.ts](file:///f:/allmylife/event/client/desktop/src/stores/useAppStore.ts) | 移除 `appMode`、`setAppMode`、`needsPrimaryAIMigration`、`migratePrimaryAI`（保留 `primaryAISessionId`、`ensurePrimarySession`、`getPrimaryAIWidgetIdOfPanel`） |
| [client/desktop/src/App.tsx](file:///f:/allmylife/event/client/desktop/src/App.tsx) | 移除 `appMode === 'desktop' && <DesktopChatBar />`，移除 appMode 引用 |
| [client/desktop/src/components/Workspace.tsx](file:///f:/allmylife/event/client/desktop/src/components/Workspace.tsx) | 移除 `const appMode = useAppStore(s => s.appMode)`，AIAssistant 始终显示（移除 appMode 条件隐藏逻辑） |
| [client/desktop/src/components/UnifiedToolbar.tsx](file:///f:/allmylife/event/client/desktop/src/components/UnifiedToolbar.tsx) | 移除模式切换按钮（canvas/desktop toggle）、移除迁移按钮、移除 `appMode`/`setAppMode`/`needsPrimaryAIMigration`/`migratePrimaryAI` 引用 |
| [client/desktop/src/components/GlobalQuickInput.tsx](file:///f:/allmylife/event/client/desktop/src/components/GlobalQuickInput.tsx) | 移除 `appMode` 引用，改为始终可用（不再依赖 desktop 模式） |
| [client/desktop/src/components/AIStatusBars.tsx](file:///f:/allmylife/event/client/desktop/src/components/AIStatusBars.tsx) | 移除 `appMode` 引用 |
| [client/desktop/src/types/ai.ts](file:///f:/allmylife/event/client/desktop/src/types/ai.ts) | 移除 appMode 相关类型定义 |
| [client/desktop/src/index.css](file:///f:/allmylife/event/client/desktop/src/index.css) | 移除 appMode 相关样式（如 `.app-mode-desktop` 等） |

**删除文件**：[client/desktop/src/components/DesktopChatBar.tsx](file:///f:/allmylife/event/client/desktop/src/components/DesktopChatBar.tsx)

**迁移策略**：
- `primaryAISessionId` 保留（仍用于标识主 AI 会话）
- `ensurePrimarySession` 保留（仍用于初始化 AI 会话）
- `getPrimaryAIWidgetIdOfPanel` 保留（仍用于获取面板的主 AI widget）
- AIAssistant widget 始终显示在画布上（不再有 desktop 模式隐藏）
- GlobalQuickInput 始终可用（左 Alt 唤起）

**验收**：
- 全项目 grep `appMode` 无结果（除注释/文档）
- 全项目 grep `setAppMode\|migratePrimaryAI\|needsPrimaryAIMigration` 无结果
- 无 `DesktopChatBar` 组件
- TypeScript 编译通过
- AIAssistant widget 始终显示
- GlobalQuickInput 始终可用

### 5.2 标签管理分离（产品形态设计 2.1-2.2）

**现状**：
- TabBar 显示所有面板（画布面板），Omnibox 嵌在 TabBar 内
- [TabBar.tsx](file:///f:/allmylife/event/client/desktop/src/components/TabBar.tsx) 第 9 行 `const panels = useAppStore(s => s.panels)` —— 管理画布面板
- [Sidebar.tsx](file:///f:/allmylife/event/client/desktop/src/components/Sidebar.tsx) 也管理画布面板

**改造方案**：

**数据模型分离**：网页标签独立于画布面板

```typescript
// types/index.ts 新增
export interface WebTab {
  id: string
  url: string
  title: string
  favicon?: string
  panelId?: string  // 嵌入到的画布面板（可选，嵌入后建立引用）
  createdAt: number
  updatedAt: number
}

// useAppStore 新增（保留现有 panels 不动）
webTabs: WebTab[]
activeWebTabId: string | null
addWebTab: (url?: string) => Promise<string>  // 不传 url 时创建空白标签（显示浏览器主页）
closeWebTab: (tabId: string) => Promise<void>
setActiveWebTab: (tabId: string) => void
updateWebTab: (tabId: string, partial: Partial<WebTab>) => void
```

**主区域单一显示**：

```typescript
// useAppStore 新增：主区域显示类型
type MainViewType = 'web-tab' | 'canvas-panel' | 'browser-home' | 'canvas-home'
interface MainView {
  type: MainViewType
  tabId?: string    // type='web-tab' 时使用
  panelId?: string  // type='canvas-panel'/'canvas-home' 时使用
}
mainView: MainView
setMainView: (view: Partial<MainView>) => void
```

**TabBar 改造**：从"画布面板管理"改为"网页标签管理"

```typescript
// TabBar.tsx 改造
// 改造前：const panels = useAppStore(s => s.panels)  // 管理画布面板
// 改造后：
const webTabs = useAppStore(s => s.webTabs)
const activeWebTabId = useAppStore(s => s.activeWebTabId)
const setActiveWebTab = useAppStore(s => s.setActiveWebTab)
const addWebTab = useAppStore(s => s.addWebTab)
const closeWebTab = useAppStore(s => s.closeWebTab)
const setMainView = useAppStore(s => s.setMainView)

// + 按钮新建网页标签 → 浏览器主页
const handleNewWebTab = async () => {
  const tabId = await addWebTab()  // 不传 url，显示浏览器主页
  setMainView({ type: 'browser-home', tabId })
}

// 点击标签切换
const handleTabClick = (tabId: string) => {
  setActiveWebTab(tabId)
  const tab = webTabs.find(t => t.id === tabId)
  if (tab?.url) {
    setMainView({ type: 'web-tab', tabId })
  } else {
    setMainView({ type: 'browser-home', tabId })
  }
}
```

**Sidebar 改造**：保持画布面板管理（确认不混用）

```typescript
// Sidebar.tsx 保持现状，但点击面板时设置 mainView
const handlePanelClick = (panelId: string) => {
  setActivePanel(panelId)
  setMainView({ type: 'canvas-panel', panelId })
}
```

**Omnibox 迁移**：从 TabBar 内移出到 App.tsx 左上角（见 5.6 节）

**数据迁移策略**：
- 现有 `panels` 数据完全保留，不动
- 新增 `webTabs` 状态，初始为空数组
- 现有的 `convertWidgetToTab` / `convertTabToWidget` 机制保留，但 `convertWidgetToTab` 现在创建 WebTab（而非 Panel）
- 现有的 WebviewWidget 状态中的 url/title 仍保留，嵌入按钮复用这些数据

**验收**：
- 上方 TabBar 只管网页标签（webTabs）
- 左侧 Sidebar 只管画布面板（panels）
- 主区域同一时间只显示一个（网页/画布/主页）
- 新建网页标签 → 浏览器主页
- 新建画布面板 → 画布主页
- 现有画布面板数据不丢失

### 5.3 浏览器主页（产品形态设计 3.1）

**新增文件**：`client/desktop/src/components/BrowserHome.tsx`

```typescript
// 内容：
// - 搜索框（输入网址或搜索，回车导航）
// - Logo/书签一体区域
// - 常用网站网格（书签标记"显示在主页"，可预览）
//   - Phase 4 先做图标形式，预览功能 Phase 5 做
//   - + 添加常用网站按钮
// - 书签入口
```

**数据模型**：

```typescript
// types/index.ts 新增
export interface Bookmark {
  id: string
  url: string
  title: string
  favicon?: string
  showOnHome: boolean  // 是否显示在主页
  createdAt: number
}

// useAppStore 新增
bookmarks: Bookmark[]
addBookmark: (url: string, title: string) => Promise<void>
removeBookmark: (id: string) => Promise<void>
toggleBookmarkHome: (id: string) => Promise<void>
```

**验收**：新建网页标签时显示浏览器主页，有搜索框 + 常用网站 + 书签入口。

### 5.4 画布主页（产品形态设计 3.2）

**新增文件**：`client/desktop/src/components/CanvasHome.tsx`

```typescript
// 内容：
// - 圆形图标（可替换，默认 logo.png）
// - AI 对话框（类 Tabbit，不创建组件，可导航/创建面板）
// - 收藏组件网格（Phase 5 做预览，Phase 4 先做图标形式）
//   - + 添加收藏组件按钮
// - 收藏组件入口
```

**AI 对话框行为**：
- 输入消息 → 发送到当前面板的 AI session
- AI 回复不创建组件，直接在对话框显示
- 可通过命令创建新面板（如 "创建学习面板"）

**验收**：新建画布面板时显示画布主页，有圆形图标 + AI 对话框 + 收藏组件入口。

### 5.5 网页标签嵌入按钮（产品形态设计 4.4）

**文件**：[client/desktop/src/components/TabBar.tsx](file:///f:/allmylife/event/client/desktop/src/components/TabBar.tsx)

**改造**：每个网页标签加 📌 按钮（lucide-react Pin 图标）

```typescript
// TabBar.tsx: 每个标签元素
<div className="web-tab">
  <span className="web-tab__title">{tab.title}</span>
  <button className="web-tab__pin" onClick={() => pinTabToCanvas(tab.id)}>
    <Pin size={14} />
  </button>
  <button className="web-tab__close" onClick={() => closeWebTab(tab.id)}>
    <X size={14} />
  </button>
</div>

// pinTabToCanvas: 在当前画布面板创建 WebviewWidget，标签不关闭
async function pinTabToCanvas(tabId: string) {
  const tab = webTabs.find(t => t.id === tabId)
  if (!tab) return
  const panelId = activePanelId  // 当前画布面板
  if (!panelId) return
  await addWidget('webPage', {
    panelId,
    position: { x: 100, y: 100, w: 480, h: 600 },
    initialState: { url: tab.url, title: tab.title, schemaVersion: 1 },
  })
  // 更新 tab.panelId 建立引用
  updateWebTab(tabId, { panelId })
  // 标签不关闭
}
```

**验收**：
- 网页标签有 📌 按钮
- 点击嵌入 → 在当前画布创建 WebviewWidget
- 标签不关闭
- 嵌入后网页在标签和画布同时存在

### 5.6 Omnibox 位置调整（产品形态设计 2.3）

**现状**：Omnibox 嵌在 TabBar 内。

**改造**：Omnibox 移到左上角独立区域

```typescript
// App.tsx: 布局调整
<div className="app-root">
  <div className="app-topbar">
    <Omnibox />  {/* 左上角 */}
    <TabBar />   {/* 网页标签 */}
  </div>
  <div className="app-body">
    <Sidebar />
    <main className="app-main">
      <Workspace />
      <UnifiedToolbar />
      ...
    </main>
  </div>
</div>
```

**TabBar 改造**：不再包含 Omnibox，只管网页标签。

**验收**：Omnibox 在左上角，Ctrl+L 聚焦。

### 5.7 UnifiedToolbar 仅画布模式（产品形态设计 2.5）

**文件**：[client/desktop/src/App.tsx](file:///f:/allmylife/event/client/desktop/src/App.tsx)

**改造**：

```typescript
// App.tsx: 根据 mainView.type 决定是否显示 UnifiedToolbar
const showUnifiedToolbar = mainView.type === 'canvas-panel' || mainView.type === 'canvas-home'
{showUnifiedToolbar && <UnifiedToolbar />}
```

**验收**：浏览网页时（mainView.type === 'web-tab' 或 'browser-home'）无底部工具栏。

### 5.8 主页定制（产品形态设计 3.1-3.2）

**数据模型**：

```typescript
// types/index.ts: AppSettings 新增
interface AppSettings {
  // ... 现有字段
  browserHome: {
    backgroundImage: string
    logo: string
    accentColor: string
  }
  canvasHome: {
    backgroundImage: string
    circleIcon: string
    accentColor: string
  }
}
```

**设置 UI**：SettingsPanel 外观 tab 新增"主页定制"区域。

**验收**：可自定义浏览器主页和画布主页的背景图/Logo/主题色。

### 5.9 New Tab 行为改造

**文件**：[client/desktop/src/components/TabBar.tsx](file:///f:/allmylife/event/client/desktop/src/components/TabBar.tsx)、[client/desktop/src/components/Sidebar.tsx](file:///f:/allmylife/event/client/desktop/src/components/Sidebar.tsx)

**改造**：
- TabBar + 按钮 → 新建网页标签 → 显示浏览器主页
- Sidebar + 按钮 → 新建画布面板 → 显示画布主页

```typescript
// TabBar.tsx
const handleNewWebTab = () => {
  const tabId = await addWebTab()  // 不传 url，显示浏览器主页
  setMainView({ type: 'browser-home', tabId })
}

// Sidebar.tsx
const handleNewPanel = async () => {
  const panelId = await addPanel('新面板')
  setMainView({ type: 'canvas-home', panelId })
}
```

**验收**：
- 新建网页标签 → 浏览器主页
- 新建画布面板 → 画布主页

---

## 六、实现顺序与依赖

### 6.1 依赖图

```
4.1.1 DB schema ─┬─→ 4.1.2 per-panel session ─→ 4.1.3 per-panel routing
                 ├─→ 4.1.4 AI context persistence
                 ├─→ 4.1.5 optimistic locking ─→ 4.1.5.client ConflictBadge
                 └─→ 4.2.2 AI config API ─→ 4.2.1 AI config tab
                                          ─→ 4.2.3 prompt config
                                          ─→ 4.2.4 skills manager

4.1.6 syncQueue ─→ 4.1.5 optimistic locking（冲突检测）

4.2.5 MCP cleanup（独立）

4.3.1 icon audit（独立）
4.3.2 logo（独立）

4.4.1 remove desktop appMode ─→ 4.4.2 tab separation ─→ 4.4.3 browser home
                                                    ─→ 4.4.4 canvas home
                                                    ─→ 4.4.5 pin button
                                                    ─→ 4.4.6 omnibox position
                                                    ─→ 4.4.7 toolbar only canvas
                                                    ─→ 4.4.8 home customization
                                                    ─→ 4.4.9 new tab behavior
```

### 6.2 并行实现分组（4 个 sub-agent）

**Group A（服务器架构）**：4.1.1 + 4.1.2 + 4.1.3 + 4.1.4 + 4.1.5.server + 4.2.2 + 4.2.4.server
**Group B（客户端架构）**：4.1.5.client + 4.1.6 + 4.2.5
**Group C（AI 配置 UI）**：4.2.1 + 4.2.3 + 4.2.4.client
**Group D（产品形态 + 图标）**：4.3.1 + 4.3.2 + 4.4.1-4.4.9

Group A、B、C、D 可并行，但 C 依赖 A 的 API（4.2.2），D 依赖 B 的 mainView（4.4.2）。
实际执行：A+B 并行 → C+D 并行（或 A+B+C+D 全并行，接口先约定）。

---

## 七、验收标准（对应 roadmap 六）

### Phase 4 验收清单

**架构改造**：
- [ ] 不同面板 AI 对话不污染
- [ ] 7 天后自动清理内存 session
- [ ] 服务器重启后对话继续
- [ ] 多端不同面板可并行 AI 操作
- [ ] 并发修改不静默丢失，state 冲突有角标
- [ ] 清缓存不丢 syncQueue 数据
- [ ] 分层保留生效（30天/90天）

**AI 配置**：
- [ ] SettingsPanel 有 AI 配置 tab
- [ ] API/模型/Endpoint 可配置
- [ ] API Key 存服务器，客户端不持有
- [ ] 提示词可编辑，有默认值，可恢复默认
- [ ] Skills 列表/启用禁用/查看内容
- [ ] 可添加/删除用户 skill
- [ ] MCP 残留清理干净

**UI 图标**：
- [ ] 所有图标用 lucide-react
- [ ] Logo 显示正常

**产品形态**：
- [ ] desktop appMode 已移除
- [ ] 网页标签和画布面板分开管理
- [ ] 新建网页标签→浏览器主页
- [ ] 新建画布面板→画布主页
- [ ] 网页标签 📌 嵌入按钮正常（标签不关闭）
- [ ] Omnibox 在左上角
- [ ] UnifiedToolbar 仅画布模式显示
- [ ] 主页可定制（背景/Logo/主题色）

---

## 八、运行时验证计划（对抗审查必须执行）

### 8.1 编译验证

```bash
# 服务器
cd f:\allmylife\event\server && npm run build

# 桌面端
cd f:\allmylife\event && npm run typecheck
```

### 8.2 服务器启动验证

```bash
# Docker 启动
cd f:\allmylife\event && docker-up.bat

# 检查 schema 初始化
docker logs living-dashboard-server 2>&1 | findstr "Schema"

# 验证新表存在
docker exec living-dashboard-postgres psql -U postgres -d livingdashboard -c "\dt ai_conversations"
docker exec living-dashboard-postgres psql -U postgres -d livingdashboard -c "\dt ai_memories"
docker exec living-dashboard-postgres psql -U postgres -d livingdashboard -c "\dt ai_settings"
docker exec living-dashboard-postgres psql -U postgres -d livingdashboard -c "\dt user_skills"
docker exec living-dashboard-postgres psql -U postgres -d livingdashboard -c "\dt tool_settings"
```

### 8.3 桌面端启动验证

```bash
cd f:\allmylife\event && npm run dev
```

验证项：
- 应用启动无白屏
- TabBar 显示网页标签（不是画布面板）
- Sidebar 显示画布面板
- Omnibox 在左上角
- 新建网页标签 → 浏览器主页
- 新建画布面板 → 画布主页
- UnifiedToolbar 仅画布模式显示
- SettingsPanel 有 AI 配置 tab
- 无 MCP 残留报错

### 8.4 功能验证

**per-panel session 并行验证**：
- 在面板1 发送 AI 消息 "你好"，等待回复
- 切换到面板2，发送 AI 消息 "这是什么"
- 切换回面板1，验证对话历史只有 "你好" + 回复，无面板2 的内容
- 验证 ai_conversations 表中 panel_id 字段正确隔离

**session 清理验证**：
- 手动修改 sessionLastUsed 为 8 天前（或临时调小 SESSION_TIMEOUT_MS）
- 等待定时清理（或手动触发）
- 验证 panelSessions 中对应 session 被销毁
- 重新发送消息，验证 session 从数据库恢复

**多端并行验证**：
- 模拟两个设备连接（两个 WS 客户端）
- 设备A 在面板1 发送消息，设备B 在面板2 发送消息
- 验证两端的 AI 操作并行执行，不互相阻塞

**嵌入按钮验证**：
- 新建网页标签，导航到 https://example.com
- 点击 📌 嵌入按钮
- 验证当前画布面板出现 WebviewWidget，显示 example.com
- 验证网页标签不关闭
- 验证 tab.panelId 已更新

**冲突角标验证**：
- 模拟两个客户端并发修改同一 widget state
- 验证后写的客户端收到 409 响应
- 验证 widget 右上角显示冲突角标
- 点击角标，选择"保留本地"/"保留远端"/"合并"
- 验证冲突解决后角标消失

**Skills 管理验证**：
- 打开 Settings → AI 配置 → Skills
- 验证 product-guide 显示为"内置"
- 禁用 product-guide，验证 AI 不加载该 skill
- 启用 product-guide，验证 AI 加载该 skill
- 添加用户 skill，验证列表更新
- 删除用户 skill，验证列表更新
- 尝试删除 product-guide，验证返回 403

**MCP 清理验证**：
- grep 全项目 `mcpManifest|isMcpComponent|DisabledMcpComponentManifest` 无结果
- 验证 `.mcp.json` 不存在
- 验证现有 widget 渲染正常

**主页验证**：
- 新建网页标签 → 验证显示浏览器主页（搜索框 + 常用网站）
- 新建画布面板 → 验证显示画布主页（圆形图标 + AI 对话框）
- 浏览网页时 → 验证 UnifiedToolbar 隐藏
- 切换到画布 → 验证 UnifiedToolbar 显示

**AI 对话**：在面板1 对话，切换到面板2，对话内容不污染
**嵌入按钮**：网页标签 📌 点击后，画布出现 WebviewWidget，标签不关闭
**冲突角标**：模拟并发修改，显示冲突角标
**Skills 管理**：添加/删除/启用禁用 skill
**MCP 清理**：grep 全项目无 MCP 残留

### 8.5 自动化验证脚本

**新增文件**：`verify-phase4.mjs`

```javascript
// 验证项：
// 1. 服务器启动 + schema 初始化
// 2. 新表存在
// 3. AI 配置 API 可用
// 4. Skills API 可用
// 5. 客户端编译通过
// 6. MCP 残留检查
// 7. 图标统一检查
```

---

## 九、风险与缓解

| 风险 | 缓解 |
|------|------|
| per-panel session 改造影响现有 AI 功能 | 保留 fallback：单面板时行为与现状一致 |
| 乐观锁导致大量冲突提示 | 位置/尺寸用 LWW，仅 state 冲突提示 |
| 标签管理分离破坏现有面板数据 | WebTab 独立存储，画布面板数据不动 |
| 主页定制增加复杂度 | Phase 4 只做基础定制（背景/Logo/色），高级定制 Phase 7 |
| syncQueue 日志文件膨胀 | 日志按天滚动，保留最近 7 天 |

---

## 十、Git 提交计划

按任务组提交（便于回滚）：

1. `feat(phase4-server): DB schema + per-panel session + optimistic locking`
2. `feat(phase4-server): AI config API + skills API + context persistence`
3. `feat(phase4-client): syncQueue persistence + conflict badge + MCP cleanup`
4. `feat(phase4-client): AI config tab + skills manager + prompt config`
5. `feat(phase4-client): remove desktop appMode + tab separation + homepages`
6. `feat(phase4-client): icon unification + logo + omnibox reposition`
7. `feat(phase4): homepage customization + new tab behavior`

或合并为 1-2 个大 commit（视实现情况）。
