import { getPool } from './connection.js'
import type { AgentSession } from '@earendil-works/pi-coding-agent'
import { callLlm, callLlmWithFallback, type LlmMessage } from '../utils/llmCaller.js'

// ============================================================================
// Phase 4：AI 上下文持久化（spec 2.4 节）
// ============================================================================

/** 对话记录类型 */
export interface Conversation {
  id: number
  panel_id: string
  role: string
  content: string
  tool_calls: unknown
  tool_result: unknown
  device_id: string | null
  summarized: boolean
  summary_of: number[] | null
  retention_level: string
  created_at: number
  updated_at: number
}

/** 记忆类型 */
export interface Memory {
  id: number
  panel_id: string
  memory_type: string | null
  content: string
  created_at: number
  updated_at: number
}

/**
 * 持久化对话记录（spec 2.4 节）
 * @param panelId 面板 ID
 * @param role 角色（user/assistant/tool）
 * @param content 内容
 * @param deviceId 设备 ID（可选）
 * @param toolCalls 工具调用（可选）
 * @param toolResult 工具结果（可选）
 */
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
    [
      panelId,
      role,
      content,
      toolCalls ? JSON.stringify(toolCalls) : null,
      toolResult ? JSON.stringify(toolResult) : null,
      deviceId || null,
      now,
    ],
  )
}

/**
 * 持久化 pi 事件到 ai_conversations 表（S1 缺口 A）
 *
 * 去重策略：
 * - message_end 只处理 role='assistant'（user 已在 handleUserMessage 持久化，toolResult 由 tool_execution_end 处理）
 * - 显式跳过 custom/bashExecution/branchSummary/compactionSummary（防止 context_restore 自我复制）
 * - tool_execution_end 持久化 tool 执行结果
 * - 跳过 session-only 面板（与 handleUserMessage L1310 的 user 持久化跳过逻辑保持一致，
 *   避免 session-only 面板的 assistant/tool 消息变成孤儿记录污染 ai_conversations 表）
 */
export async function persistPiEvent(
  panelId: string,
  event: { type?: string; [k: string]: unknown },
): Promise<void> {
  if (!event || typeof event.type !== 'string') return
  // 跳过 session-only 面板（匿名会话不持久化，与 handleUserMessage 保持一致）
  if (panelId.startsWith('session-only:')) return

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

/**
 * 获取面板最近 N 条对话（spec 2.4 节）
 * @param panelId 面板 ID
 * @param limit 限制条数，默认 20
 * @returns 按时间正序返回的对话列表
 */
export async function getRecentConversations(panelId: string, limit: number = 20): Promise<Conversation[]> {
  const pool = getPool()
  const result = await pool.query(
    `SELECT * FROM ai_conversations WHERE panel_id = $1 AND retention_level = 'full' ORDER BY created_at DESC LIMIT $2`,
    [panelId, limit],
  )
  // 按时间正序返回（最旧在前，最新在后）
  return (result.rows as Conversation[]).reverse()
}

/**
 * 获取面板记忆（spec 2.4 节）
 * @param panelId 面板 ID
 * @returns 记忆列表
 */
export async function getPanelMemories(panelId: string): Promise<Memory[]> {
  const pool = getPool()
  const result = await pool.query(
    `SELECT * FROM ai_memories WHERE panel_id = $1 ORDER BY updated_at DESC`,
    [panelId],
  )
  return result.rows as Memory[]
}

/**
 * 获取面板最近 N 条记忆（S1 缺口 B，spec 2.2.2）
 * 按 updated_at DESC 顺序返回（最新在前），用于 restoreSessionContext 拼接长期记忆
 * @param panelId 面板 ID
 * @param limit 限制条数，默认 20
 * @returns 记忆列表（最新在前）
 */
export async function getRecentMemories(panelId: string, limit: number = 20): Promise<Memory[]> {
  const pool = getPool()
  const result = await pool.query(
    `SELECT * FROM ai_memories WHERE panel_id = $1 ORDER BY updated_at DESC LIMIT $2`,
    [panelId, limit],
  )
  return result.rows as Memory[]
}

/**
 * 恢复 session 上下文（S1 缺口 B 重写，spec 2.2.1 + 2.2.2）
 *
 * 改进点：
 * - 不截断内容（移除 500 字符截断），仅对超长单条消息做合理上限保护
 * - 用结构化 markdown 标记角色（### 用户 / ### 助手 / ### 工具结果）
 * - 完整保留 tool_calls JSON 和 tool_result JSON
 * - 总字符数上限 60000（从头部最旧消息裁剪）
 * - memories 上限 20 条 + 8000 字符（从尾部最旧裁剪）
 *
 * 实现方案：pi-coding-agent 的 AgentSession 提供 sendCustomMessage 方法，
 * 当 triggerTurn=false 时，消息会添加到 agent state 和 session，
 * 但不会触发 LLM 回复。注入的历史作为 custom message 参与 LLM 上下文。
 *
 * @param session AgentSession 实例
 * @param panelId 面板 ID
 */
export async function restoreSessionContext(session: AgentSession, panelId: string): Promise<void> {
  // 1. 查询 conversations（按 created_at ASC，取最近 100 条）
  const conversations = await getRecentConversations(panelId, 100)

  if (conversations.length === 0) {
    console.log(`[AiContext] Panel ${panelId}: no history to restore`)
    return
  }

  console.log(`[AiContext] Panel ${panelId}: restoring ${conversations.length} conversations`)

  // 2. 查询 memories（按 updated_at DESC LIMIT 20）
  const memories = await getRecentMemories(panelId, 20)

  // 3. 渲染 conversations 为 markdown
  const conversationBlocks: string[] = []
  for (const conv of conversations) {
    const block = renderConversationBlock(conv)
    if (block) conversationBlocks.push(block)
  }

  let conversationMarkdown = `## 历史对话\n\n` + conversationBlocks.join('\n\n')

  // 4. 总长度上限保护：从头部（最旧）裁剪至 ≤ 60000
  while (conversationMarkdown.length > 60000 && conversationBlocks.length > 1) {
    conversationBlocks.shift()  // 删除最旧
    conversationMarkdown = `## 历史对话\n\n` + conversationBlocks.join('\n\n')
  }

  // 5. 渲染 memories（独立 8000 字符上限，从尾部最旧裁剪）
  let memoryMarkdown = ''
  if (memories.length > 0) {
    const memoryLines = memories.map(m => `- [${m.memory_type ?? 'summary'}] ${m.content}`)
    while (memoryLines.join('\n').length > 8000 && memoryLines.length > 1) {
      memoryLines.pop()  // 删除最旧
    }
    memoryMarkdown = `\n\n## 长期记忆\n\n` + memoryLines.join('\n')
  }

  // 6. 拼接最终内容
  const content = `以下是本面板的历史对话上下文，请在此基础上继续对话。\n\n` + conversationMarkdown + memoryMarkdown

  console.log(`[AiContext] Panel ${panelId}: context restored (${content.length} chars)`)

  // 7. 注入到 session（triggerTurn=false，不触发 LLM 回复）
  try {
    await session.sendCustomMessage(
      {
        customType: 'context_restore',
        content,
        display: false,  // 不在 UI 中显示（历史恢复，非用户可见消息）
      },
      { triggerTurn: false },
    )
  } catch (err) {
    console.warn(`[AiContext] Panel ${panelId}: sendCustomMessage failed:`, err)
  }
}

/**
 * 渲染单条对话为 markdown 块（S1 缺口 B，spec 2.2.1）
 *
 * 渲染规则：
 * - user 行 → ### 用户 块
 * - assistant 行 → ### 助手 块（文本在前；若 tool_calls 非空，紧跟 ```json``` 代码块，不拆成两个标题）
 * - tool 行 → ### 工具结果 [<toolCallId>] 块（从 tool_result JSONB 提取字段）
 *
 * 长度上限保护（spec 2.2.2）：
 * - 单条消息内容 > 8000 字符 → 截断到 8000 + ...(已截断，原长度 X 字符)
 * - tool_calls JSON 不截断
 * - tool_result.result 文本 > 4000 字符 → 截断到 4000 + ...(已截断)
 *
 * @param conv 单条对话记录
 * @returns markdown 块字符串；非 user/assistant/tool 角色返回空串
 */
function renderConversationBlock(conv: Conversation): string {
  // 单条消息内容 8000 字符截断
  let content = conv.content ?? ''
  if (content.length > 8000) {
    content = content.slice(0, 8000) + `...(已截断，原长度 ${content.length} 字符)`
  }

  if (conv.role === 'user') {
    return `### 用户\n${content}`
  } else if (conv.role === 'assistant') {
    let block = `### 助手\n${content}`
    // 若 tool_calls JSONB 非空，紧跟 json 代码块（不拆成两个 ### 助手 标题）
    if (conv.tool_calls) {
      const toolCallsJson = JSON.stringify(conv.tool_calls, null, 2)
      block += `\n\`\`\`json\n${toolCallsJson}\n\`\`\``
    }
    return block
  } else if (conv.role === 'tool') {
    const tr = conv.tool_result as
      | { toolCallId?: string; toolName?: string; result?: string; isError?: boolean }
      | null
    if (!tr) return `### 工具结果 [unknown]\n（无 tool_result 数据）`
    // tool_result 文本 4000 字符截断
    let resultText = tr.result ?? ''
    if (resultText.length > 4000) {
      resultText = resultText.slice(0, 4000) + '...(已截断)'
    }
    return `### 工具结果 [${tr.toolCallId ?? 'unknown'}]\n工具：${tr.toolName ?? 'unknown'}\n结果：${resultText}\n错误：${tr.isError ?? false}`
  }
  // 其他 role 跳过（防止 custom/bashExecution 等被渲染）
  return ''
}

/**
 * 分层保留清理（决策 12.1，spec 2.4 节）
 * - 近期（30 天内）：完整保留
 * - 中期（30-90 天）：AI 自动总结成摘要，丢弃原始对话
 * - 长期（90 天+）：只保留 ai_memories 表中的结构化记忆
 */
export async function runRetentionCleanup(): Promise<void> {
  const pool = getPool()
  const now = Date.now()
  const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000
  const ninetyDaysAgo = now - 90 * 24 * 60 * 60 * 1000

  console.log('[AiContext] Running retention cleanup...')

  // 1. 30 天前的 full 对话 → AI 总结成 summary，原对话 summarized=TRUE
  // C1 SQLite 改造：用应用层聚合替代 PG 的 array_agg（SQLite 不支持数组聚合）
  const oldConversationsResult = await pool.query(
    `SELECT id, panel_id, content FROM ai_conversations
     WHERE retention_level = 'full' AND created_at < $1
     ORDER BY panel_id, created_at`,
    [thirtyDaysAgo],
  )

  // 按 panel_id 分组（替代 array_agg + GROUP BY panel_id）
  const groupedByPanel = new Map<string, { convIds: number[]; contents: string[] }>()
  for (const row of oldConversationsResult.rows) {
    let group = groupedByPanel.get(row.panel_id)
    if (!group) {
      group = { convIds: [], contents: [] }
      groupedByPanel.set(row.panel_id, group)
    }
    group.convIds.push(row.id)
    group.contents.push(row.content)
  }

  let summarizedCount = 0
  for (const [panelId, group] of groupedByPanel) {
    const convIds: number[] = group.convIds
    const contents: string[] = group.contents

    // 调用 AI 总结（占位实现，返回空字符串）
    const summary = await summarizeConversations(contents)
    if (summary) {
      // 插入 summary 条目
      await pool.query(
        `INSERT INTO ai_conversations (panel_id, role, content, retention_level, summary_of, created_at, updated_at)
         VALUES ($1, 'assistant', $2, 'summary', $3, $4, $4)`,
        [panelId, summary, convIds, now],
      )
      // S2 顺手修复 S1 bug：原对话直接 DELETE（content 已被压缩成 summary 条目，不再需要原始对话）
      // 避免原对话残留导致 90 天清理时被 extractMemories 重复处理
      await pool.query(
        `DELETE FROM ai_conversations WHERE id = ANY($1)`,
        [convIds],
      )
    } else {
      // 防御性约束（S2 对抗审查发现）：summary 为空时保留原对话 + 告警，防数据丢失
      console.warn(`[AiContext] summarize returned empty for panel ${panelId}, keeping original conversations`)
    }
    summarizedCount += convIds.length
  }

  // 2. 90 天前的 summary → 提取到 ai_memories，删除 summary 条目
  const oldSummaries = await pool.query(
    `SELECT * FROM ai_conversations WHERE retention_level = 'summary' AND created_at < $1`,
    [ninetyDaysAgo],
  )

  let extractedMemoriesCount = 0
  let deletedSummariesCount = 0
  for (const row of oldSummaries.rows as Conversation[]) {
    // 提取关键信息到 ai_memories（占位实现，返回空数组）
    const memories = await extractMemories(row.content)
    for (const mem of memories) {
      await pool.query(
        `INSERT INTO ai_memories (panel_id, memory_type, content, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $4)`,
        [row.panel_id, mem.type, mem.content, now],
      )
      extractedMemoriesCount++
    }
    // 删除 summary 条目
    await pool.query(`DELETE FROM ai_conversations WHERE id = $1`, [row.id])
    deletedSummariesCount++
  }

  // 3. ai_memories 永久保留（结构化记忆，体积小）

  console.log(
    `[AiContext] Retention cleanup done: summarized ${summarizedCount} conversations, ` +
    `extracted ${extractedMemoriesCount} memories, deleted ${deletedSummariesCount} old summaries`,
  )
}

// ============================================================================
// 辅助函数：调用 AI 进行对话总结和记忆提取
// ============================================================================

/**
 * 调用 AI 总结对话内容
 * 使用 ai_settings 中配置的模型生成摘要
 * LLM 不可用时降级为简单拼接（每条消息前 100 字符）
 *
 * @param contents 对话内容数组
 * @returns 摘要文本
 */
async function summarizeConversations(contents: string[]): Promise<string> {
  if (contents.length === 0) {
    return ''
  }

  // 降级方案：简单拼接每条消息前 100 字符
  const fallbackSummary = contents
    .map((c, i) => `${i + 1}. ${c.slice(0, 100)}${c.length > 100 ? '...' : ''}`)
    .join('\n')

  const messages: LlmMessage[] = [
    {
      role: 'system',
      content: '你是一个对话总结助手。请将以下对话内容总结为一段简洁的摘要，保留关键信息、用户意图和重要结论。摘要应该用中文，不超过 300 字。',
    },
    {
      role: 'user',
      content: `请总结以下对话内容：\n\n${contents.map((c, i) => `--- 对话 ${i + 1} ---\n${c}`).join('\n\n')}`,
    },
  ]

  return callLlmWithFallback(messages, fallbackSummary, {
    temperature: 0.3,
    maxTokens: 500,
    timeoutMs: 30_000,
  })
}

/**
 * 调用 AI 从摘要中提取结构化记忆
 * 提取事实（fact）、偏好（preference）和摘要（summary）类型的记忆
 * LLM 不可用时降级为空数组
 *
 * @param summary 摘要文本
 * @returns 记忆列表，每项包含 type（memory_type）和 content
 */
async function extractMemories(summary: string): Promise<Array<{ type: string; content: string }>> {
  if (!summary || summary.trim().length === 0) {
    return []
  }

  const messages: LlmMessage[] = [
    {
      role: 'system',
      content: `你是一个记忆提取助手。从给定的对话摘要中提取值得长期记忆的信息，分为以下类别：
- fact：客观事实（如"用户是一名程序员"、"项目使用 React"）
- preference：用户偏好（如"用户喜欢简洁的代码"、"用户偏好深色主题"）
- summary：重要结论或事件摘要

请以 JSON 数组格式输出，每个元素包含 "type" 和 "content" 字段。
如果没有值得提取的记忆，返回空数组 []。
只输出 JSON，不要其他文字。`,
    },
    {
      role: 'user',
      content: `请从以下摘要中提取记忆：\n\n${summary}`,
    },
  ]

  try {
    const response = await callLlm(messages, {
      temperature: 0.2,
      maxTokens: 800,
      timeoutMs: 30_000,
    })

    // 解析 JSON 响应
    return parseMemoriesResponse(response)
  } catch (err) {
    console.warn('[AiContext] extractMemories LLM 调用失败，降级为空数组:', err instanceof Error ? err.message : String(err))
    return []
  }
}

/**
 * 解析 LLM 返回的记忆 JSON 响应
 * 容错处理：提取 JSON 数组，验证字段
 */
function parseMemoriesResponse(response: string): Array<{ type: string; content: string }> {
  try {
    // 尝试直接解析
    let jsonStr = response.trim()

    // 如果响应包含 markdown 代码块，提取其中的 JSON
    const codeBlockMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/)
    if (codeBlockMatch) {
      jsonStr = codeBlockMatch[1].trim()
    }

    // 尝试找到 JSON 数组的起始和结束位置
    const arrayStart = jsonStr.indexOf('[')
    const arrayEnd = jsonStr.lastIndexOf(']')
    if (arrayStart !== -1 && arrayEnd !== -1 && arrayEnd > arrayStart) {
      jsonStr = jsonStr.slice(arrayStart, arrayEnd + 1)
    }

    const parsed = JSON.parse(jsonStr)
    if (!Array.isArray(parsed)) {
      console.warn('[AiContext] parseMemoriesResponse: 响应不是数组')
      return []
    }

    // 验证并过滤有效项
    const validTypes = new Set(['fact', 'preference', 'summary'])
    const memories: Array<{ type: string; content: string }> = []
    for (const item of parsed) {
      if (item && typeof item === 'object' && typeof item.content === 'string' && item.content.trim()) {
        const type = typeof item.type === 'string' && validTypes.has(item.type) ? item.type : 'summary'
        memories.push({ type, content: item.content.trim() })
      }
    }
    return memories
  } catch (err) {
    console.warn('[AiContext] parseMemoriesResponse: JSON 解析失败:', err instanceof Error ? err.message : String(err))
    return []
  }
}
