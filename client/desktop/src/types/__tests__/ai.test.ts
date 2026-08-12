/**
 * types/ai.ts 类型完整性测试 — Phase 11 P2
 *
 * 测试策略（项目未引入 zod）：
 * - 接口完整性测试：构造符合接口的对象，TypeScript 编译时校验字段
 * - 运行时字段存在性检查：确保关键字段不被意外删除/重命名
 * - 常量值校验（HIGH_SENSITIVITY_STORES）
 *
 * 注：AgentEvent 类型定义在 types/electron.d.ts，按任务要求在此测试字段完整性。
 *     SessionState 实际字段为 sessionId（非 id），按实际源码测试。
 */
import { describe, test, expect } from 'vitest'
import type {
  SessionState,
  ChatMessage,
  ToolResult,
  ToolError,
  ToolCallRequest,
  PermissionRequest,
  PermissionResponse,
  DataSendPreview,
  PrivacySettings,
  ApiKeyStorage,
  LLMConfig,
  LLMResponse,
  LLMStreamEvent,
  ConfirmationTokenType,
  PermissionLevel,
  ApiKeyStorageMode,
  AskUserOption,
} from '../ai'
import { HIGH_SENSITIVITY_STORES } from '../ai'
import type { AgentEvent } from '../electron'

// ============================================================================
// 1. AgentEvent 类型字段完整性（定义在 types/electron.d.ts）
//    任务要求字段：type/text/toolName/params/requestId/success/message/totalTokens/recoverable
// ============================================================================

describe('AgentEvent 类型字段完整性', () => {
  test('text_delta 事件含 type + text 字段', () => {
    const event: AgentEvent = { type: 'text_delta', text: 'hello' }
    expect(event.type).toBe('text_delta')
    // 字段存在性：text 字段在 text_delta 事件中必须可访问
    expect((event as { text: string }).text).toBe('hello')
  })

  test('tool_call 事件含 type + toolName + params + requestId 字段', () => {
    const event: AgentEvent = {
      type: 'tool_call',
      toolName: 'search_web',
      params: { query: 'test' },
      requestId: 'req-1',
    }
    expect(event.type).toBe('tool_call')
    const e = event as {
      toolName: string
      params: unknown
      requestId: string
    }
    expect(e.toolName).toBe('search_web')
    expect(e.params).toEqual({ query: 'test' })
    expect(e.requestId).toBe('req-1')
  })

  test('tool_result 事件含 type + requestId + success 字段（可选 data/error）', () => {
    const successEvent: AgentEvent = {
      type: 'tool_result',
      requestId: 'req-2',
      success: true,
      data: { result: 'ok' },
    }
    const s = successEvent as {
      requestId: string
      success: boolean
      data?: unknown
    }
    expect(successEvent.type).toBe('tool_result')
    expect(s.requestId).toBe('req-2')
    expect(s.success).toBe(true)
    expect(s.data).toEqual({ result: 'ok' })

    const errorEvent: AgentEvent = {
      type: 'tool_result',
      requestId: 'req-3',
      success: false,
      error: 'failed',
    }
    const e = errorEvent as {
      success: boolean
      error?: string
    }
    expect(e.success).toBe(false)
    expect(e.error).toBe('failed')
  })

  test('turn_end 事件含 type + 可选 totalTokens 字段', () => {
    const event: AgentEvent = { type: 'turn_end', totalTokens: 100 }
    expect(event.type).toBe('turn_end')
    expect((event as { totalTokens: number }).totalTokens).toBe(100)
  })

  test('error 事件含 type + message + recoverable 字段', () => {
    const event: AgentEvent = {
      type: 'error',
      message: 'agent crashed',
      recoverable: false,
    }
    expect(event.type).toBe('error')
    const e = event as {
      message: string
      recoverable: boolean
    }
    expect(e.message).toBe('agent crashed')
    expect(e.recoverable).toBe(false)
  })
})

// ============================================================================
// 2. SessionState 字段完整性
//    任务要求字段：id/title/messages/status/boundPanelId/apiConfigId/modelId
//    实际源码字段：sessionId（非 id），按实际行为测试
// ============================================================================

describe('SessionState 字段完整性', () => {
  test('SessionState 含所有必需字段（sessionId/title/messages/status/boundPanelId/apiConfigId/modelId 等）', () => {
    const session: SessionState = {
      sessionId: 's-1',
      messages: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
      model: 'step-3.7-flash',
      status: 'idle',
      title: 'Test Session',
      boundPanelId: 'panel-1',
      apiConfigId: 'preset-1',
      modelId: 'step-3.7-flash',
      authorizedPrivateStores: [],
      hasConfirmedFirstSend: false,
      confirmedDataCategories: new Set(),
      confirmedModel: null,
      role: '生活助手',
    }

    // 任务要求的 6 个关键字段存在性校验
    expect(session.sessionId).toBe('s-1')
    expect(session.title).toBe('Test Session')
    expect(session.messages).toEqual([])
    expect(session.status).toBe('idle')
    expect(session.boundPanelId).toBe('panel-1')
    expect(session.apiConfigId).toBe('preset-1')
    expect(session.modelId).toBe('step-3.7-flash')
  })

  test('SessionState status 枚举覆盖 6 种状态值', () => {
    const statuses: SessionState['status'][] = [
      'idle',
      'thinking',
      'tool_calling',
      'waiting_confirmation',
      'waiting_user_input',
      'error',
    ]
    for (const status of statuses) {
      const session: SessionState = {
        sessionId: 's',
        messages: [],
        createdAt: 0,
        updatedAt: 0,
        model: '',
        status,
        title: '',
        boundPanelId: null,
        apiConfigId: '',
        modelId: '',
        authorizedPrivateStores: [],
        hasConfirmedFirstSend: false,
        confirmedDataCategories: new Set(),
        confirmedModel: null,
        role: '',
      }
      expect(session.status).toBe(status)
    }
    expect(statuses.length).toBe(6)
  })

  test('SessionState boundPanelId 可为 null（未绑定面板）', () => {
    const session: SessionState = {
      sessionId: 's',
      messages: [],
      createdAt: 0,
      updatedAt: 0,
      model: '',
      status: 'idle',
      title: '',
      boundPanelId: null,
      apiConfigId: '',
      modelId: '',
      authorizedPrivateStores: [],
      hasConfirmedFirstSend: false,
      confirmedDataCategories: new Set(),
      confirmedModel: null,
      role: '',
    }
    expect(session.boundPanelId).toBeNull()
  })

  test('SessionState 含 error 可选字段（status=error 时）', () => {
    const session: SessionState = {
      sessionId: 's',
      messages: [],
      createdAt: 0,
      updatedAt: 0,
      model: '',
      status: 'error',
      error: 'agent crashed',
      title: '',
      boundPanelId: null,
      apiConfigId: '',
      modelId: '',
      authorizedPrivateStores: [],
      hasConfirmedFirstSend: false,
      confirmedDataCategories: new Set(),
      confirmedModel: null,
      role: '',
    }
    expect(session.error).toBe('agent crashed')
  })
})

// ============================================================================
// 3. 其他类型完整性（HIGH_SENSITIVITY_STORES 常量 + 关键接口）
// ============================================================================

describe('其他类型完整性', () => {
  test('HIGH_SENSITIVITY_STORES 包含 4 个高敏感 store', () => {
    expect(HIGH_SENSITIVITY_STORES).toContain('journals')
    expect(HIGH_SENSITIVITY_STORES).toContain('moodEntries')
    expect(HIGH_SENSITIVITY_STORES).toContain('savingsGoals')
    expect(HIGH_SENSITIVITY_STORES).toContain('savingsTransactions')
    expect(HIGH_SENSITIVITY_STORES.length).toBe(4)
  })

  test('ChatMessage 含 role/content/timestamp 字段 + 可选 toolCalls/toolCallId/askUser', () => {
    const msg: ChatMessage = {
      role: 'assistant',
      content: 'hello',
      timestamp: Date.now(),
    }
    expect(msg.role).toBe('assistant')
    expect(msg.content).toBe('hello')
    expect(msg.toolCalls).toBeUndefined()
    expect(msg.askUser).toBeUndefined()

    const toolMsg: ChatMessage = {
      role: 'tool',
      content: 'result',
      toolCallId: 'tc-1',
      timestamp: Date.now(),
    }
    expect(toolMsg.toolCallId).toBe('tc-1')
  })

  test('ToolResult + ToolError 字段完整性', () => {
    const error: ToolError = {
      code: 'EXECUTION_FAILED',
      message: 'failed',
      recoverable: true,
    }
    expect(error.code).toBe('EXECUTION_FAILED')
    expect(error.recoverable).toBe(true)

    const result: ToolResult = {
      success: true,
      data: { value: 42 },
    }
    expect(result.success).toBe(true)
    expect(result.data).toEqual({ value: 42 })

    const failedResult: ToolResult = {
      success: false,
      error: {
        code: 'PERMISSION_DENIED',
        message: 'no access',
        recoverable: false,
      },
    }
    expect(failedResult.success).toBe(false)
    expect(failedResult.error?.code).toBe('PERMISSION_DENIED')
  })
})
