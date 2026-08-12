# Phase S1：AI 上下文改造 — 详细 Spec

> 生成日期：2026-06-26
> 架构依据：[architecture_refactor.md](../architecture_refactor.md) 第二章（2.1-2.5）+ 第十二章 12.1
> Roadmap：[roadmap_server_v1.md](../roadmap_server_v1.md) Phase S1
> 关联：[phase3-server-spec.md](phase3-server-spec.md)
>
> **项目目的**：服务器是 AI 推理 + 数据同步 + 多端协作的中心。S1 让 AI 按 panel 隔离上下文、多端共享同面板上下文、对话历史持久化、分层保留防膨胀。

---

## 一、现状分析

> **关键结论**：S1 主体框架已在 Phase 4 / Phase S0 完成。本 Spec 不是从零设计，而是**修复 5 个实质缺口**。

### 1.1 已完成（无需重做）

| 任务 | 现状 | 文件位置 |
|------|------|---------|
| `ai_conversations` 表 | 已建，含 `summarized/summary_of/retention_level` 字段 | [schema.ts:137-150](../../server/src/db/schema.ts) |
| `ai_memories` 表 | 已建 | [schema.ts:154-161](../../server/src/db/schema.ts) |
| per-panel session | `panelSessions = Map<panelId, AgentSession>` | [piBridge.ts:89](../../server/src/piBridge.ts) |
| 消息路由 | `onClientMessage(deviceId, msg)` + msg.panelId | [piBridge.ts:836-867](../../server/src/piBridge.ts) |
| 7 天超时清理 | `SESSION_TIMEOUT_MS` + 每小时扫描 | [piBridge.ts:92,131-144](../../server/src/piBridge.ts) |
| 上下文持久化（user 消息） | `persistConversation(panelId, 'user', ...)` | [piBridge.ts:928](../../server/src/piBridge.ts) |
| session 恢复（占位） | `restoreSessionContext` 用 `sendCustomMessage` | [aiContext.ts:112-169](../../server/src/db/aiContext.ts) |
| 分层保留 cron | `runRetentionCleanup` 每天 03:00 执行 | [aiContext.ts:177-250](../../server/src/db/aiContext.ts), [index.ts:167-189](../../server/src/index.ts) |
| 多端共享广播 | `forwardEventToClient` + `broadcast({ panelId })` | [piBridge.ts:699-704](../../server/src/piBridge.ts) |
| 客户端协议 | `user_message.panelId` 必填 | [useAIStore.ts:847-877](../../client/desktop/src/stores/useAIStore.ts), [WsMessage.kt:17-21](../../client/android/app/src/main/java/com/livingdashboard/sync/WsMessage.kt) |

### 1.2 五个实质缺口（本 Spec 修复目标）

#### 缺口 A：assistant / tool 消息未持久化（**P0 致命**）

**问题**：[piBridge.ts:920-958](../../server/src/piBridge.ts) 的 `handleUserMessage` 只持久化 user 消息。AI 回复、tool_calls、tool_result 仅通过 `s.subscribe` 转发到客户端，**不写库**。

**后果**：服务器重启后 `restoreSessionContext` 只能拿到 user 消息，**LLM 看不到自己的回复和工具调用历史**，对话上下文断裂，多轮对话能力丧失。

**修复**：在 `createSession` 的 `s.subscribe` 回调中增加持久化逻辑：
- 监听 `message_end` 事件 → 持久化 assistant 消息（含 tool_calls）
- 监听 `tool_execution_end` 事件 → 持久化 tool 消息（tool_call_id + result）

#### 缺口 B：session 恢复机制质量缺陷（**P0**）

**问题**：[aiContext.ts:126-149](../../server/src/db/aiContext.ts) 把所有历史对话拼成一条 `custom message` 文本，**每条截断 500 字符**，丢失多轮结构和 tool_calls 信息。LLM 看到的是被压缩的文本摘要，不是真实多轮对话。

**后果**：恢复后对话连贯性差，LLM 无法识别原始的 user/assistant/tool 交替结构，无法引用之前的 tool 调用结果。

**修复**：重写 `restoreSessionContext`：
- 不截断内容（仅对超长单条消息做合理上限保护，如 8000 字符）
- 用结构化 markdown 标记角色（`### 用户` / `### 助手` / `### 工具调用` / `### 工具结果`）
- 完整保留 tool_calls JSON 和 tool_result JSON（作为代码块）
- 包含 memories 部分

#### 缺口 C：panel 删除不联动 session 清理（**P1 内存泄漏 + 数据残留**）

**问题**：[piBridge.ts](../../server/src/piBridge.ts) 没有暴露"销毁单个 panel session"的对外 API。`routes/panels.ts` 的 DELETE handler 删 panel 后，对应 AgentSession 仍驻留内存（要等 7 天超时），`ai_conversations` / `ai_memories` 表中该 panel_id 的行也永久残留。

**后果**：
- 内存泄漏：长期运行的服务器累积无用 session
- 数据残留：删了面板但 AI 对话历史仍在数据库
- 安全/隐私：用户以为删除面板就删了对话，实际没删

**修复**：
- `piBridge.ts` 新增 `disposePanelSession(panelId: string)` 导出函数
- `routes/panels.ts` 的 DELETE handler 调用 `disposePanelSession(panelId)` + 删除 `ai_conversations` / `ai_memories` 表中该 panel_id 的行
- 用事务保证原子性

#### 缺口 D：prompt 默认值双份定义（**P2 维护风险**）

**问题**：`DEFAULT_CANVAS_PROMPT` / `DEFAULT_BROWSER_PROMPT` / `DEFAULT_SYSTEM_PROMPT` 在 [piBridge.ts:655-686](../../server/src/piBridge.ts) 和 [aiSettingsStore.ts:19-50](../../server/src/db/aiSettingsStore.ts) 各有一份，需手动保持同步。

**后果**：未来修改提示词时容易遗漏一处，导致 `getPromptOverrides` 用的默认值与 `createSession` 用的默认值不一致。

**修复**：`piBridge.ts` 从 `aiSettingsStore.ts` 导入 `DEFAULT_PROMPTS`，删除本地重复定义。

#### 缺口 E：docker-compose 无资源限制（**P1 部署合规**）

**问题**：[docker-compose.yml](../../docker-compose.yml) 没有任何 `mem_limit` / `cpus` / `logging` 配置，违反 [roadmap_server_v1.md 5.4 节](../roadmap_server_v1.md) 的明确要求。生产服务器有 aihub/gitea/uptime-kuma 等共存服务，Living Dashboard 异常时可能拖垮整台服务器。

**后果**：内存泄漏 / 死循环 / 日志失控时会吃光服务器资源导致共存服务被 OOM Kill。

**修复**：docker-compose.yml 加 `mem_limit: 1g` / `cpus: 1.0` / `mem_reservation: 512m` + `logging: json-file max-size:10m max-file:3`，postgres 加 `mem_limit: 512m`。

---

## 二、详细设计

### 2.1 修复缺口 A：assistant / tool 消息持久化

> **关键事实**（来自 pi-coding-agent v0.79.10 `docs/session-format.md` + `docs/extensions.md`）：
> - `AgentMessage` 是 7 种 role 的联合类型：`user` / `assistant` / `toolResult` / `custom` / `bashExecution` / `branchSummary` / `compactionSummary`
> - **pi 的 `AssistantMessage` 没有 `tool_calls` 字段**——ToolCall 作为 `content` 数组中 `type:"toolCall"` 的元素存在
> - `message_end` 事件对 `user` / `assistant` / `toolResult` 三种 role 都触发
> - `tool_execution_end` 事件与 `message_end` (role=toolResult) 信息重叠

#### 2.1.1 监听事件设计（明确去重策略）

`AgentSession.subscribe` 监听以下事件：

| 事件类型 | 处理范围 | 关键字段 |
|---------|---------|---------|
| `message_end` | **仅处理 `role === 'assistant'`**，跳过 `user`/`toolResult`/`custom`/`bashExecution`/`branchSummary`/`compactionSummary` | `event.message.role`, `event.message.content` (含 `type:"text"` 和 `type:"toolCall"` 元素) |
| `tool_execution_end` | 处理所有 tool 执行结果 | `event.toolCallId`, `event.toolName`, `event.result`, `event.isError` |

**去重策略（采用方案 B）**：
- `message_end` 中**只持久化 `role === 'assistant'`**（user 已在 handleUserMessage 持久化，toolResult 由 tool_execution_end 持久化）
- `tool_execution_end` 持久化 tool 执行结果
- 显式白名单避免 `custom`/`bashExecution` 等 role 被持久化（防止 `context_restore` 自我复制）

**不监听**：
- `message_update`（流式增量）
- `agent_end`（与 message_end 重复）
- `tool_result`（pi 无此事件名，实际是 `message_end` with `role:"toolResult"`）

#### 2.1.2 持久化数据结构映射

| pi 事件 | ai_conversations 行 | 说明 |
|---------|---------------------|------|
| `message_end` (role=user) | **跳过**（已在 `handleUserMessage` 中持久化） | 避免重复 |
| `message_end` (role=assistant) | `role='assistant', content=<从 content 数组提取 text>, tool_calls=<从 content 数组提取 toolCall 元素, 无则 NULL>, tool_result=NULL` | 含工具调用意图时 tool_calls 非空 |
| `message_end` (role=toolResult) | **跳过**（由 `tool_execution_end` 处理） | 避免重复 |
| `message_end` (role=custom/bashExecution/...) | **跳过**（白名单只允许 assistant） | 防止 context_restore 自我复制 |
| `tool_execution_end` | `role='tool', content=toolName+isError, tool_calls=NULL, tool_result=JSON.stringify({ toolCallId, toolName, result, isError })` | 工具执行结果 |

**关键决策**：tool 消息单独成行而非合并到 assistant 行。原因：
1. 与 pi 的 ToolResultMessage 结构一致（role="toolResult"，但落库时统一为 'tool' 便于跨 provider 兼容）
2. 单独成行便于按 role 过滤、统计、恢复时还原顺序
3. `summary_of` 数组在分层保留时可独立处理 tool 消息

#### 2.1.3 实现位置

修改 [piBridge.ts:824-826](../../server/src/piBridge.ts) 的 `s.subscribe` 回调：

```typescript
s.subscribe((event) => {
  const e = event as { type?: string; [key: string]: unknown }
  
  // 1. 转发到客户端（原有逻辑）
  forwardEventToClient(event, panelId)
  
  // 2. 持久化 assistant / tool 消息（S1 缺口 A）
  void persistPiEvent(panelId, e).catch((err) => {
    console.warn(`[PiBridge] persistPiEvent failed for panel ${panelId}:`, err)
  })
})
```

**新增 `persistPiEvent` 函数（放在 aiContext.ts，与 `persistConversation` 同模块）**：

```typescript
/**
 * 持久化 pi 事件到 ai_conversations 表（S1 缺口 A）
 * 
 * 去重策略：
 * - message_end 只处理 role='assistant'（user 已在 handleUserMessage 持久化，toolResult 由 tool_execution_end 处理）
 * - 显式跳过 custom/bashExecution/branchSummary/compactionSummary（防止 context_restore 自我复制）
 * - tool_execution_end 持久化 tool 执行结果
 */
export async function persistPiEvent(
  panelId: string,
  event: { type?: string; [k: string]: unknown },
): Promise<void> {
  if (!event || typeof event.type !== 'string') return

  if (event.type === 'message_end') {
    const msg = event.message as
      | { role?: string; content?: unknown }
      | undefined
    if (!msg || typeof msg.role !== 'string') return
    
    // 白名单：只处理 assistant（user 已在 handleUserMessage 持久化，toolResult 由 tool_execution_end 处理）
    // 显式跳过 custom/bashExecution/branchSummary/compactionSummary，防止 context_restore 自我复制
    if (msg.role !== 'assistant') return

    // 提取 content：pi 的 AssistantMessage.content 是数组，含 {type:"text"} 和 {type:"toolCall"} 元素
    // pi 的 ToolCall 元素实际字段是 id/name/arguments（见 pi-coding-agent docs/session-format.md:64-69）
    const contentArr = Array.isArray(msg.content)
      ? (msg.content as Array<{ type?: string; text?: string; id?: string; name?: string; arguments?: unknown }>)
      : []

    // 文本部分
    const textContent = contentArr
      .filter(c => c.type === 'text' && typeof c.text === 'string')
      .map(c => c.text as string)
      .join('')

    // 工具调用部分（pi 把 ToolCall 放在 content 数组中，字段为 id/name/arguments）
    // 持久化时统一映射为 toolCallId/toolName/input，便于恢复时直接使用（spec 2.2.1）
    const toolCallElements = contentArr.filter(c => c.type === 'toolCall')
    const toolCalls = toolCallElements.length > 0
      ? toolCallElements.map(c => ({
          toolCallId: c.id ?? '',
          toolName: c.name ?? '',
          input: c.arguments ?? null,
        }))
      : undefined

    await persistConversation(
      panelId,
      'assistant',
      textContent,
      undefined,          // device_id 仅 user 消息记录
      toolCalls,
      undefined,
    )
  } else if (event.type === 'tool_execution_end') {
    const toolCallId = event.toolCallId as string | undefined
    const toolName = event.toolName as string | undefined
    const result = event.result as { content?: unknown } | undefined
    const isError = event.isError as boolean | undefined

    if (!toolName) return

    // 提取 result.content 文本
    let resultText = ''
    if (result && Array.isArray(result.content)) {
      resultText = (result.content as Array<{ type?: string; text?: string }>)
        .filter(c => c.type === 'text' && typeof c.text === 'string')
        .map(c => c.text as string)
        .join('')
    } else if (result !== undefined) {
      // 兜底：result.content 不是数组时，序列化整个 result
      resultText = JSON.stringify(result)
    }

    await persistConversation(
      panelId,
      'tool',
      `${toolName}${isError ? ' (error)' : ''}: ${resultText}`,
      undefined,
      undefined,
      { toolCallId: toolCallId ?? '', toolName, result: resultText, isError: isError ?? false },
    )
  }
}
```

#### 2.1.4 验收标准

**SQL 验证脚本**（必须执行通过）：
```sql
SELECT id, role,
       CASE WHEN tool_calls IS NOT NULL THEN 'yes' ELSE 'no' END AS has_tool_calls,
       CASE WHEN tool_result IS NOT NULL THEN 'yes' ELSE 'no' END AS has_tool_result,
       length(content) AS content_len,
       created_at
FROM ai_conversations
WHERE panel_id = '<panel-id>'
ORDER BY created_at;
```

**预期结果**：
- 发送一条 user_message 触发 AI 回复（无工具调用）：表新增 **2 行**（role=user + role=assistant，has_tool_calls=no, has_tool_result=no）
- 发送一条 user_message 触发 AI 调用工具：表新增 **4 行**（role=user + role=assistant[has_tool_calls=yes] + role=tool[has_tool_result=yes] + role=assistant[最终回复, has_tool_calls=no]）
- 重启 server，再次发送消息，日志输出 `restoring N conversations` 且 N 包含历史 assistant / tool 消息
- `SELECT role, COUNT(*) FROM ai_conversations WHERE panel_id='<id>' GROUP BY role` 不应出现 `custom`/`bashExecution`/`toolResult` 等 role

---

### 2.2 修复缺口 B：session 恢复机制重写

#### 2.2.1 新的恢复消息结构

替换 [aiContext.ts:126-149](../../server/src/db/aiContext.ts) 的拼接逻辑，生成结构化 markdown。

**关键事实**：pi 的 AssistantMessage 没有 `tool_calls` 字段，工具调用作为 `content` 数组中 `type:"toolCall"` 元素存在。落库时已将 toolCall 元素存到 `ai_conversations.tool_calls` JSONB 字段。恢复时直接读 `tool_calls` 字段。

```markdown
以下是本面板的历史对话上下文，请在此基础上继续对话。

## 历史对话

### 用户
<完整 user 消息内容>

### 助手
<完整 assistant 文本内容>
```json
<tool_calls 字段的 JSON 字符串，结构 [{ toolCallId, toolName, input }]；若 tool_calls 为空则无此代码块>
```

### 工具结果 [<tool_result.toolCallId>]
工具：<tool_result.toolName>
结果：<tool_result.result 文本>
错误：<tool_result.isError>

### 助手
<完整 assistant 回复>

...(循环)

## 长期记忆

- [fact] <memory content>
- [preference] <memory content>
- [summary] <memory content>
```

**实现要点**：
- 拼接时遍历 `conversations` 数组（按 `created_at ASC` 顺序），按 `role` 分支渲染
- assistant 行：渲染为**单个** `### 助手` 块，文本在前；若 `tool_calls` JSONB 非空，则紧跟 ` ```json ... ``` ` 代码块（不拆成两个 `### 助手` 标题，避免 LLM 误解为两条 assistant 消息）。tool_calls 字段结构（持久化时已映射，spec 2.1.3）：`[{ toolCallId, toolName, input }]`
- tool 行：从 `tool_result` JSONB 字段提取 `toolCallId` / `toolName` / `result` / `isError`，渲染为 `### 工具结果 [<toolCallId>]` 块

#### 2.2.2 长度上限保护（量化）

**单条消息**：
- 移除 500 字符截断（致命缺陷）
- 单条消息内容超过 8000 字符时截断到 8000 + `...(已截断，原长度 X 字符)`
- tool_calls JSON 不截断（结构化数据，截断会破坏 JSON）
- tool_result 文本超过 4000 字符时截断

**恢复消息总长度上限**（防止 LLM 上下文超限）：
- **总字符数上限 60000**（约 15-30K tokens，留出空间给 system prompt + 新对话）
- **裁剪策略**：先按 `created_at ASC` 顺序渲染所有 conversations 为 markdown 字符串，若总长度 > 60000，则从头部（最旧消息）逐条删除，直到总长度 ≤ 60000。这样保证保留最新的 N 条历史。
- **memories 部分上限 20 条**（按 `updated_at DESC` 取最近 20 条），且总长度不超过 8000 字符
- memories 不参与总长度上限计算（独立 8000 上限），但总输出（对话 + memories）仍应 < 68000 字符

#### 2.2.3 不变的部分

- 仍用 `session.sendCustomMessage({ customType: 'context_restore', ... }, { triggerTurn: false })` 注入
- `display: false` 不在 UI 显示
- 不触发 LLM 回复

#### 2.2.4 验收标准

- 服务器重启后恢复上下文，日志 `restoring N conversations` 中 N ≥ 2（含 assistant）
- 恢复后 LLM 能引用之前的 tool 调用结果继续对话（人工验证对话连贯性）
- **tool_calls 恢复验证**：恢复后向 LLM 提问"我刚才用了什么工具"，LLM 应能回答具体工具名（如 create_html_widget），证明 tool_calls JSON 已正确恢复
- 单条 5000 字符的 user 消息恢复后完整保留，不被截断
- 恢复消息总字符数 ≤ 60000（日志打印 `context restored (X chars)`）
- memories 部分最多 20 条（按 `updated_at DESC` 取最近 20 条）
- 恢复后下一条对话中 LLM 不出现"我不知道你在说什么"（人工验证）

---

### 2.3 修复缺口 C：panel 删除联动 session 清理

#### 2.3.1 piBridge.ts 新增导出

```typescript
/**
 * 销毁指定面板的 session（S1 缺口 C）
 * - 调用 session.dispose() 清理内存
 * - 清理 panelSessions / sessionLastUsed / panelActiveDevices / panelSessionReady
 * - 拒绝 pendingRequests 中该 panelId 的等待请求（避免 30s 超时等待）
 * - 不删除 ai_conversations / ai_memories 数据（由调用方在事务中删除）
 */
export async function disposePanelSession(panelId: string): Promise<void> {
  // 1. 销毁 AgentSession（注：pi-coding-agent SDK 中 dispose() 是同步方法返回 void，await 仅作兼容）
  const s = panelSessions.get(panelId)
  if (s) {
    try { await s.dispose?.() } catch (err) { console.warn(`[PiBridge] dispose panel session ${panelId} failed:`, err) }
  }
  panelSessions.delete(panelId)
  sessionLastUsed.delete(panelId)
  panelActiveDevices.delete(panelId)
  panelSessionReady.delete(panelId)

  // 2. 拒绝该 panelId 的 pendingRequests（避免等 30s 超时）
  for (const [requestId, req] of pendingRequests) {
    if (req.panelId === panelId) {
      clearTimeout(req.timer)
      req.reject(new Error(`panel ${panelId} disposed`))
      pendingRequests.delete(requestId)
    }
  }

  console.log(`[PiBridge] Panel session ${panelId} disposed`)
}
```

#### 2.3.2 routes/panels.ts DELETE handler 修改（同事务原子性）

**关键决策**：panel 删除 + AI 上下文清理放同一事务，失败则整体回滚。修复 spec 初版"warn 不阻塞"导致隐私问题持续的缺陷。

```typescript
// 删除面板时联动清理 AI 上下文（S1 缺口 C，同事务原子性）
import { disposePanelSession } from '../piBridge.js'
import { withTransaction, getPool } from '../db/connection.js'

router.delete('/:id', async (req, res) => {
  const panelId = req.params.id
  const sourceDeviceId = req.headers['x-device-id'] as string | undefined

  try {
    // 1. 先在事务外销毁内存中的 session（不阻塞事务，失败仅 warn）
    try {
      await disposePanelSession(panelId)
    } catch (err) {
      console.warn(`[Panels] disposePanelSession failed for ${panelId}:`, err)
    }

    // 2. 同事务删除 panel + ai_conversations + ai_memories
    await withTransaction(async (client) => {
      // 删除 panel（级联删 widgets / panel_memory_states）
      const result = await client.query('DELETE FROM panels WHERE id = $1 RETURNING *', [panelId])
      if (result.rows.length === 0) {
        throw new Error('panel not found')  // 触发回滚
      }
      // 删除 AI 对话历史
      await client.query('DELETE FROM ai_conversations WHERE panel_id = $1', [panelId])
      // 删除 AI 长期记忆
      await client.query('DELETE FROM ai_memories WHERE panel_id = $1', [panelId])
      return result.rows[0]
    })

    // 3. 广播变更（事务提交后）
    broadcastChange({ kind: 'panel_deleted', data: { id: panelId } }, sourceDeviceId)
    res.json({ success: true, id: panelId })
  } catch (err) {
    console.error(`[Panels] Failed to delete panel ${panelId}:`, err)
    // 事务已回滚，panel / ai_conversations / ai_memories 数据仍完整。
    // 内存 session 可能已销毁（disposePanelSession 在事务外执行），但下次收到该 panel 的 user_message 时，
    // getOrCreatePanelSession 会重建 session 并调用 restoreSessionContext 从 DB 恢复历史（DB 数据因回滚仍完整），用户无感知。
    res.status(500).json({ error: `Failed to delete panel: ${err instanceof Error ? err.message : String(err)}` })
  }
})
```

#### 2.3.3 验收标准

- 创建 panel → 发送消息 → 删除 panel → 检查 `panelSessions` Map 中无该 panelId
- 检查 `ai_conversations` 表中无该 panel_id 的行：`SELECT COUNT(*) FROM ai_conversations WHERE panel_id = '<deleted-id>'` 返回 0
- 检查 `ai_memories` 表中无该 panel_id 的行
- 检查 `pendingRequests` Map 中无该 panelId 的请求
- 删除操作不影响其他 panel 的 session：`SELECT COUNT(*) FROM ai_conversations WHERE panel_id != '<deleted-id>'` 不变
- 删除事务失败时（如 mock 数据库错误），panel 仍存在（HTTP 500），ai_conversations 仍存在（事务回滚）

---

### 2.4 修复缺口 D：prompt 默认值去重

#### 2.4.1 修改 piBridge.ts

删除 [piBridge.ts:655-686](../../server/src/piBridge.ts) 的 `DEFAULT_CANVAS_PROMPT` / `DEFAULT_BROWSER_PROMPT` / `DEFAULT_SYSTEM_PROMPT` 三个常量。

从 `aiSettingsStore.ts` 导入（注意字段名是 `canvasPrompt`/`browserPrompt`/`systemPrompt`，不是 `canvas`/`browser`/`system`）：

```typescript
import { getAiSettings, getPromptOverrides, clearPromptCache, DEFAULT_PROMPTS } from './db/aiSettingsStore.js'
```

修改 [piBridge.ts:742-746](../../server/src/piBridge.ts)：

```typescript
const prompts = {
  canvas: overrides.canvasPrompt ?? DEFAULT_PROMPTS.canvasPrompt,
  browser: overrides.browserPrompt ?? DEFAULT_PROMPTS.browserPrompt,
  system: overrides.systemPrompt ?? DEFAULT_PROMPTS.systemPrompt,
}
```

**`aiSettingsStore.ts` 中的 `DEFAULT_PROMPTS` 字段名确认**（来自 [aiSettingsStore.ts:19-50](../../server/src/db/aiSettingsStore.ts)）：

```typescript
export const DEFAULT_PROMPTS = {
  canvasPrompt: '...',      // 字段名：canvasPrompt（不是 canvas）
  browserPrompt: '...',     // 字段名：browserPrompt（不是 browser）
  systemPrompt: '',         // 字段名：systemPrompt（不是 system）
}
```

#### 2.4.2 验收标准

- `grep -n "DEFAULT_CANVAS_PROMPT\|DEFAULT_BROWSER_PROMPT\|DEFAULT_SYSTEM_PROMPT" server/src/piBridge.ts` 无输出
- `grep -n "DEFAULT_PROMPTS\." server/src/piBridge.ts` 输出含 `canvasPrompt`/`browserPrompt`/`systemPrompt`（不是 `canvas`/`browser`/`system`）
- 启动服务器，AI 仍能用默认提示词工作（不依赖 ai_settings 表配置时）
- 验证：新建 panel 发送 "请创建一个简单的 HTML widget"，AI 应能调用 `create_html_widget` 工具，证明 canvasPrompt 中关于 canvasStorage 的指引生效

---

### 2.5 修复缺口 E：docker-compose 资源限制

#### 2.5.1 修改 docker-compose.yml

**docker compose v2 单机模式兼容性说明**：本项目用 `docker compose v2` 单机模式，顶层 `mem_limit` / `cpus` / `mem_reservation` 均支持。`deploy.resources.limits` 在 v2 单机模式也支持，但 `deploy` 字段传统上是 swarm 模式字段。本项目选顶层字段保持简洁。

```yaml
services:
  postgres:
    # ...现有配置...
    mem_limit: 512m
    mem_reservation: 256m
    logging:
      driver: json-file
      options:
        max-size: "10m"
        max-file: "3"
    restart: unless-stopped

  server:
    # ...现有配置...
    mem_limit: 1g
    mem_reservation: 512m
    cpus: 1.0
    logging:
      driver: json-file
      options:
        max-size: "10m"
        max-file: "3"
    restart: unless-stopped
```

#### 2.5.2 验收标准

- `docker compose config` 不报错
- 容器启动后 `docker stats` 显示 living-dashboard-server 内存上限 1G，CPU 上限 1.0 核
- 日志文件不超过 30MB（10m × 3 files）
- postgres 内存上限 512M
- 验证 `restart: unless-stopped` 已配置（容器异常退出会自动重启）

---

## 三、实施步骤

### 步骤 1：备份当前数据库 + 验证 schema

```bash
cd f:\allmylife\event
# 备份
docker-compose exec postgres pg_dump -U livingdashboard living_dashboard > data\backup-pre-s1.sql

# 验证 ai_conversations 表已含分层保留字段（无需新建表/迁移）
docker-compose exec postgres psql -U livingdashboard living_dashboard -c "\d ai_conversations"
# 预期输出含字段：summarized, summary_of, retention_level
docker-compose exec postgres psql -U livingdashboard living_dashboard -c "\d ai_memories"
# 预期输出含字段：panel_id, memory_type, content, created_at, updated_at
```

如果 schema 验证失败（字段不存在），需先手动执行 schema.ts 中的 DO $$ ... ALTER 块补齐字段。

### 步骤 2：编码（按依赖顺序，避免临时修改）

1. **缺口 D**（去重 prompt）→ 改 piBridge.ts 删除重复常量 + 改导入。**这是后续步骤的依赖**，先做避免 A/B 步骤中要再改导入路径。
2. **缺口 B**（重写 restoreSessionContext）→ 改 aiContext.ts 的拼接逻辑。**不依赖缺口 A**，可独立做。
3. **缺口 A**（持久化 assistant/tool）→ 改 piBridge.ts 的 subscribe 回调 + 在 aiContext.ts 新增 `persistPiEvent` 函数。**依赖缺口 D 已完成的导入路径**。
4. **缺口 C**（panel 删除联动）→ 改 piBridge.ts 新增 `disposePanelSession` 导出 + 改 routes/panels.ts 的 DELETE handler。独立。
5. **缺口 E**（docker-compose 资源限制）→ 改 docker-compose.yml。独立。

### 步骤 3：构建 + 运行时验证

```bash
cd f:\allmylife\event\server
npm run build        # TypeScript 编译无错
npm run dev          # 启动 server
```

**运行时验证清单**（必须全部通过，不能只读代码）：

1. ✅ Server 启动无报错，日志 `[PiBridge] Initialized (per-panel session mode)` 输出
2. ✅ 启动桌面端，发送一条 user_message
3. ✅ 等 AI 回复完成后，检查 PostgreSQL：
   ```sql
   SELECT id, role,
          CASE WHEN tool_calls IS NOT NULL THEN 'yes' ELSE 'no' END AS has_tc,
          CASE WHEN tool_result IS NOT NULL THEN 'yes' ELSE 'no' END AS has_tr,
          length(content) AS content_len, created_at
   FROM ai_conversations WHERE panel_id = '<panel-id>' ORDER BY created_at;
   ```
   预期至少有 2 行（user + assistant）
4. ✅ 触发一次工具调用（让 AI 创建 HTML widget），检查 `ai_conversations` 表有 4 行（user + assistant[has_tc=yes] + tool[has_tr=yes] + assistant[最终回复, has_tc=no]）
5. ✅ 检查 role 字段只出现 user/assistant/tool 三种：`SELECT role, COUNT(*) FROM ai_conversations WHERE panel_id='<id>' GROUP BY role` 不应有 custom/bashExecution/toolResult
6. ✅ 重启 server，日志输出 `[AiContext] Panel <id>: restoring N conversations`（N ≥ 2）+ `context restored (X chars)`（X ≤ 60000）
7. ✅ 重启后再发消息，AI 引用历史上下文（人工验证对话连贯性）
8. ✅ 删除一个有 AI 对话的 panel：
   - 检查 `ai_conversations` 表中无该 panel_id 的行
   - 检查 `ai_memories` 表中无该 panel_id 的行
   - 检查 `pendingRequests` 中无该 panelId 的请求
9. ✅ 删除事务失败时（手动断开 PG 连接模拟），HTTP 返回 500，panel 仍存在：
   - 模拟 PG 不可用：`docker pause living-dashboard-postgres`（替换为实际 PG 容器名）
   - 调用 DELETE /api/panels/:id，预期 HTTP 500，错误信息含 "Failed to delete panel"
   - 恢复 PG：`docker unpause living-dashboard-postgres`
   - 验证 panel 仍存在：`SELECT id FROM panels WHERE id='<test-id>'` 返回 1 行
   - 验证 ai_conversations 仍完整：`SELECT COUNT(*) FROM ai_conversations WHERE panel_id='<test-id>'` 与删除前相同
10. ✅ `docker compose config` 无报错
11. ✅ `docker stats` 显示 living-dashboard-server 内存上限 1G，CPU 上限 1.0 核：
    - 前置：先 `docker compose up -d` 启动容器
    - 验证：`docker stats --no-stream` 输出中 living-dashboard-server 的 MEM LIMIT / CPU LIMIT 不为空
12. ✅ grep 验证 prompt 去重：`grep -n "DEFAULT_CANVAS_PROMPT\|DEFAULT_BROWSER_PROMPT\|DEFAULT_SYSTEM_PROMPT" server/src/piBridge.ts` 无输出

### 步骤 4：对抗审查

使用 `adversarial-review` skill 对编码成果做对抗审查（含运行时验证），不合格则修复后重审。

### 步骤 5：git commit + 发布

- git commit（conventional commit 格式，如 `feat(server): S1 AI context persistence and panel cleanup`）
- 更新部署文档（如 phase3-server-spec.md 中 AI 上下文章节）
- 打 Docker 镜像 tag `v0.6.0-s1`（版本号递增）

---

## 四、风险与回滚

### 4.1 风险

| 风险 | 影响 | 缓解 |
|------|------|------|
| `message_end` 事件结构与 spec 假设不符 | 持久化失败 | spec 已基于 pi-coding-agent v0.79.10 docs 验证；持久化失败仅 warn 不阻塞主流程；运行时验证步骤 3-5 会立即发现 |
| `tool_execution_end.result` 结构复杂 | result 文本提取不全 | 用 `JSON.stringify(result)` 兜底（spec 2.1.3 已实现） |
| `restoreSessionContext` 改写后内容过长 | LLM 上下文超限 | 单条 8000 字符上限 + **总字符数 60000 上限** + memories 20 条上限（spec 2.2.2 已量化） |
| panel 删除事务失败 | 数据残留 | spec 2.3.2 改为同事务原子操作，失败回滚 HTTP 500；用户重试即可 |
| docker compose `cpus` 字段兼容性 | 容器启动失败 | spec 2.5.1 明确用 docker compose v2 单机模式，顶层字段支持；验证步骤 10 会确认 |
| 持久化异步与 user 消息同步的乱序 | created_at 顺序错乱 | 暂不引入 seq 字段，依赖 `Date.now()` 毫秒精度 + 同 panel 内消息串行处理（同 panel session.prompt 是 await 的）；若运行时验证发现乱序再引入 seq 字段 |
| 持久化失败无降级机制 | 静默丢失数据 | 持久化失败仅 warn；累计失败 5 次后通过 WS 推送 `error_report` 给客户端提示"对话历史持久化异常"（实现时如复杂可降级为仅日志告警） |

### 4.2 回滚方案

1. **代码回滚**：`git revert <commit>` 回到 S1 前的提交
2. **数据库回滚**：恢复 `data\backup-pre-s1.sql`
3. **镜像回滚**：用上一版本镜像 tag

---

## 五、与后续 Phase 的契约

### 5.1 与 S2（per-panel activeDeviceId）的契约

S1 不实现 S2 的 `panelActiveDevices[panelId]` 选举策略，但 **S1 已经预留了**：
- `panelActiveDevices: Map<string, string>` 已存在（[piBridge.ts:61](../../server/src/piBridge.ts)）
- `setPanelActiveDevice(panelId, deviceId)` 在收到 user_message 时调用（[piBridge.ts:844](../../server/src/piBridge.ts)）
- 工具路由已用 `panelActiveDevices.get(panelId)` 而非全局 activeDeviceId（[piBridge.ts:155](../../server/src/piBridge.ts)）

S2 只需补充：同面板多端在线时的选举规则、无在线设备的错误处理。

### 5.2 与 S3（冲突解决）的契约

S1 不涉及数据冲突解决（widget/entity 的乐观锁），不冲突。

### 5.3 与 S4（AI 配置后端）的契约

S1 修复缺口 D 后，`DEFAULT_PROMPTS` 单一来源在 `aiSettingsStore.ts`。S4 实施 `ai_settings` 表的 UI 管理 API 时，可直接复用此常量。

---

## 六、附录：关键文件变更清单

| 文件 | 变更类型 | 说明 |
|------|---------|------|
| `server/src/piBridge.ts` | 修改 | 删除重复 prompt 常量（DEFAULT_CANVAS_PROMPT/DEFAULT_BROWSER_PROMPT/DEFAULT_SYSTEM_PROMPT）；改导入用 DEFAULT_PROMPTS；subscribe 回调新增 persistPiEvent 调用；新增 disposePanelSession 导出（含清理 pendingRequests） |
| `server/src/db/aiContext.ts` | 修改 | 新增 persistPiEvent 函数（处理 message_end role=assistant + tool_execution_end，白名单跳过 custom/bashExecution 等）；重写 restoreSessionContext 的内容拼接逻辑（结构化 markdown + 60000 字符总上限 + memories 20 条上限） |
| `server/src/routes/panels.ts` | 修改 | DELETE handler 改为同事务原子操作：disposePanelSession + DELETE panels + DELETE ai_conversations + DELETE ai_memories，失败回滚 HTTP 500 |
| `docker-compose.yml` | 修改 | postgres 加 mem_limit:512m + logging；server 加 mem_limit:1g + cpus:1.0 + logging + restart:unless-stopped |
| `server/src/db/aiSettingsStore.ts` | 不变 | 仅作为 DEFAULT_PROMPTS 的单一来源（字段名 canvasPrompt/browserPrompt/systemPrompt） |
| `server/src/db/schema.ts` | 不变 | ai_conversations / ai_memories 表已建好，无需迁移；步骤 1 验证 schema 字段完整性 |
| `server/src/index.ts` | 不变 | 启动流程不变；runRetentionCleanup cron 已在 index.ts:167-189 中调度 |
| `server/src/ws.ts` | 不变 | 协议不变 |

---

## 七、验收清单（与 roadmap 验收标准对齐）

- [ ] ai_conversations 表已存在（无需新建）
- [ ] ai_memories 表已存在（无需新建）
- [ ] per-panel session 已实现（无需重构）
- [ ] 不同面板对话不污染（已实现）
- [ ] **服务器重启后对话可恢复**（缺口 A+B 修复后验证）
- [ ] 7 天未用 session 自动清理（已实现）
- [ ] 分层保留 cron 正常（已实现）
- [ ] 同面板 AI 事件广播到所有在线设备（已实现）
- [ ] **assistant / tool 消息持久化**（缺口 A 修复后验证）
- [ ] **panel 删除联动清理 session + 数据**（缺口 C 修复后验证）
- [ ] **docker-compose 资源限制**（缺口 E 修复后验证）
- [ ] Docker 镜像构建 + 迁移脚本执行成功（无 schema 变更，幂等）
