/**
 * MockAIProvider（Phase 11.1）
 *
 * 模拟 5 个 AI provider 的响应，供 useApiConfigStore / useAIStore / LocalAgent 测试用：
 *   - openai / deepseek / qwen / anthropic / stepfun
 *
 * 用法：
 *   const fetch = createMockFetch()
 *   global.fetch = fetch
 *   // ... 触发 provider 调用
 *   expect(fetch).toHaveBeenCalledWith('https://api.openai.com/v1/chat/completions', ...)
 *   fetch.flushResponse('openai') // 返回预设响应
 *
 * 设计要点：
 * 1. 支持 SSE 流式响应（stream: true）
 * 2. 支持普通 JSON 响应（stream: false）
 * 3. 默认响应可被覆盖（per-provider override）
 * 4. 记录所有请求，供断言（requests 数组）
 */
import { vi } from 'vitest'

export type ProviderName = 'openai' | 'deepseek' | 'qwen' | 'anthropic' | 'stepfun'

export interface MockChatRequest {
  url: string
  method: string
  headers: Record<string, string>
  body: unknown
}

export interface MockChatChunk {
  choices: Array<{
    delta: { content?: string; role?: string }
    finish_reason: string | null
    index: number
  }>
}

// ========== 预设响应（OpenAI 兼容格式） ==========
// 注意：qwen / deepseek / stepfun 均兼容 OpenAI 格式；anthropic 用单独格式

export const mockAIResponses: Record<ProviderName, unknown> = {
  openai: {
    id: 'chatcmpl-mock-openai',
    object: 'chat.completion',
    created: 1700000000,
    model: 'gpt-4o-mock',
    choices: [
      {
        index: 0,
        message: { role: 'assistant', content: '你好，我是 mock OpenAI 响应' },
        finish_reason: 'stop',
      },
    ],
    usage: { prompt_tokens: 10, completion_tokens: 8, total_tokens: 18 },
  },
  deepseek: {
    id: 'chatcmpl-mock-deepseek',
    object: 'chat.completion',
    created: 1700000001,
    model: 'deepseek-chat-mock',
    choices: [
      {
        index: 0,
        message: { role: 'assistant', content: '你好，我是 mock DeepSeek 响应' },
        finish_reason: 'stop',
      },
    ],
    usage: { prompt_tokens: 10, completion_tokens: 8, total_tokens: 18 },
  },
  qwen: {
    id: 'chatcmpl-mock-qwen',
    object: 'chat.completion',
    created: 1700000002,
    model: 'qwen-max-mock',
    choices: [
      {
        index: 0,
        message: { role: 'assistant', content: '你好，我是 mock Qwen 响应' },
        finish_reason: 'stop',
      },
    ],
    usage: { prompt_tokens: 10, completion_tokens: 8, total_tokens: 18 },
  },
  anthropic: {
    // Anthropic Messages API 格式（与 OpenAI 不兼容）
    id: 'msg_mock-anthropic',
    type: 'message',
    role: 'assistant',
    model: 'claude-3-5-sonnet-mock',
    content: [{ type: 'text', text: '你好，我是 mock Anthropic 响应' }],
    stop_reason: 'end_turn',
    usage: { input_tokens: 10, output_tokens: 8 },
  },
  stepfun: {
    id: 'chatcmpl-mock-stepfun',
    object: 'chat.completion',
    created: 1700000003,
    model: 'step-1-mock',
    choices: [
      {
        index: 0,
        message: { role: 'assistant', content: '你好，我是 mock StepFun 响应' },
        finish_reason: 'stop',
      },
    ],
    usage: { prompt_tokens: 10, completion_tokens: 8, total_tokens: 18 },
  },
}

// ========== 流式响应 chunk 序列 ==========

export const mockAIStreamChunks: Record<ProviderName, MockChatChunk[]> = {
  openai: [
    { choices: [{ delta: { role: 'assistant' }, finish_reason: null, index: 0 }] },
    { choices: [{ delta: { content: '你好' }, finish_reason: null, index: 0 }] },
    { choices: [{ delta: { content: '，mock' }, finish_reason: null, index: 0 }] },
    { choices: [{ delta: { content: ' OpenAI' }, finish_reason: null, index: 0 }] },
    { choices: [{ delta: {}, finish_reason: 'stop', index: 0 }] },
  ],
  deepseek: [
    { choices: [{ delta: { role: 'assistant' }, finish_reason: null, index: 0 }] },
    { choices: [{ delta: { content: 'DeepSeek mock' }, finish_reason: null, index: 0 }] },
    { choices: [{ delta: {}, finish_reason: 'stop', index: 0 }] },
  ],
  qwen: [
    { choices: [{ delta: { role: 'assistant' }, finish_reason: null, index: 0 }] },
    { choices: [{ delta: { content: 'Qwen mock' }, finish_reason: null, index: 0 }] },
    { choices: [{ delta: {}, finish_reason: 'stop', index: 0 }] },
  ],
  anthropic: [
    { choices: [{ delta: { role: 'assistant' }, finish_reason: null, index: 0 }] },
    { choices: [{ delta: { content: 'Anthropic mock' }, finish_reason: null, index: 0 }] },
    { choices: [{ delta: {}, finish_reason: 'stop', index: 0 }] },
  ],
  stepfun: [
    { choices: [{ delta: { role: 'assistant' }, finish_reason: null, index: 0 }] },
    { choices: [{ delta: { content: 'StepFun mock' }, finish_reason: null, index: 0 }] },
    { choices: [{ delta: {}, finish_reason: 'stop', index: 0 }] },
  ],
}

// ========== Mock fetch 工厂 ==========

/**
 * 创建 mock fetch，自动根据 URL 匹配 provider 返回预设响应
 * @param overrides 按 provider 名覆盖默认响应
 * @returns mock fetch 函数（带 .requests 数组记录所有调用）
 */
export function createMockFetch(overrides?: Partial<Record<ProviderName, unknown>>): ((input: string | URL, init?: RequestInit) => Promise<Response>) & { requests: MockChatRequest[] } {
  const responses = { ...mockAIResponses, ...overrides }
  const requests: MockChatRequest[] = []

  const mockFetch = async (input: string | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input.toString()
    const method = init?.method ?? 'GET'
    const headers: Record<string, string> = {}
    if (init?.headers) {
      const h = init.headers as Record<string, string>
      for (const k of Object.keys(h)) headers[k] = h[k]
    }
    let body: unknown = undefined
    if (init?.body) {
      try {
        body = JSON.parse(init.body as string)
      } catch {
        body = init.body
      }
    }
    requests.push({ url, method, headers, body })

    // 根据 URL 匹配 provider
    let provider: ProviderName = 'openai'
    if (url.includes('deepseek')) provider = 'deepseek'
    else if (url.includes('qwen') || url.includes('dashscope')) provider = 'qwen'
    else if (url.includes('anthropic') || url.includes('claude')) provider = 'anthropic'
    else if (url.includes('stepfun')) provider = 'stepfun'

    const isStream = body && typeof body === 'object' && (body as { stream?: boolean }).stream === true
    const response = responses[provider]

    if (isStream) {
      // 返回 SSE 流（mock ReadableStream）
      const chunks = mockAIStreamChunks[provider]
      const encoder = new TextEncoder()
      const stream = new ReadableStream({
        start(controller) {
          for (const chunk of chunks) {
            const data = `data: ${JSON.stringify(chunk)}\n\n`
            controller.enqueue(encoder.encode(data))
          }
          controller.enqueue(encoder.encode('data: [DONE]\n\n'))
          controller.close()
        },
      })
      return new Response(stream, {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      })
    }

    return new Response(JSON.stringify(response), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  ;(mockFetch as unknown as { requests: MockChatRequest[] }).requests = requests
  return mockFetch as unknown as ((input: string | URL, init?: RequestInit) => Promise<Response>) & { requests: MockChatRequest[] }
}

/**
 * 安装 mock fetch 为全局 fetch
 * @returns 清理函数（恢复原 fetch）
 */
export function installMockFetch(overrides?: Partial<Record<ProviderName, unknown>>): () => void {
  const original = globalThis.fetch
  const mock = createMockFetch(overrides)
  ;(globalThis as unknown as { fetch: typeof mock }).fetch = mock
  return () => {
    ;(globalThis as unknown as { fetch: typeof original }).fetch = original
  }
}

/** 便捷的 vi.fn() 包装，便于断言 */
export const mockFetchFn = vi.fn(createMockFetch())
