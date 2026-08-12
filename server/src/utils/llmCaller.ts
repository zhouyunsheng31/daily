// ============================================================================
// 通用 LLM 调用工具（OpenAI 兼容 API）
// 从 ai_settings 读取模型配置，调用 /v1/chat/completions 端点
// 支持错误处理和降级
// ============================================================================

import { getAiSettings } from '../db/aiSettingsStore.js'

/** LLM 消息格式（OpenAI 兼容） */
export interface LlmMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

/** LLM 调用选项 */
export interface LlmCallOptions {
  /** 覆盖默认模型（格式：provider/model 或 model） */
  model?: string
  /** 覆盖默认 API key */
  apiKey?: string
  /** 覆盖默认 endpoint（base URL，不含 /chat/completions） */
  endpoint?: string
  /** 温度参数，默认 0.3 */
  temperature?: number
  /** 最大 token 数 */
  maxTokens?: number
  /** 超时毫秒，默认 30 秒 */
  timeoutMs?: number
}

/** 已知 provider 的默认 base URL */
const PROVIDER_BASE_URLS: Record<string, string> = {
  stepfun: 'https://api.stepfun.com/step_plan/v1',
  openai: 'https://api.openai.com/v1',
  deepseek: 'https://api.deepseek.com/v1',
  anthropic: 'https://api.anthropic.com/v1',
}

/**
 * 解析模型字符串，返回 provider 和 modelName
 * @param model 模型字符串，格式：provider/model 或 model
 * @returns [provider, modelName]
 */
function parseModel(model: string): [string, string] {
  if (model.includes('/')) {
    const [provider, ...rest] = model.split('/')
    return [provider, rest.join('/')]
  }
  // 无 provider 前缀，默认 stepfun
  return ['stepfun', model]
}

/**
 * 构建完整的 API URL
 * @param endpoint base URL 或完整 endpoint
 * @returns 完整的 chat/completions URL
 */
function buildApiUrl(endpoint: string): string {
  // 已经是完整 URL，直接返回
  if (endpoint.endsWith('/chat/completions')) {
    return endpoint
  }
  // 去掉末尾斜杠
  const base = endpoint.replace(/\/+$/, '')
  // 如果已经包含 /v1 或类似路径，直接追加 /chat/completions
  if (/\/v\d+$/.test(base) || base.includes('/v1/')) {
    return `${base}/chat/completions`
  }
  // 否则追加 /v1/chat/completions
  return `${base}/v1/chat/completions`
}

/**
 * 调用 OpenAI 兼容的 LLM API
 * 从 ai_settings 读取配置，支持错误处理和降级
 *
 * @param messages 消息数组
 * @param options 调用选项
 * @returns LLM 生成的文本
 * @throws Error 如果 API key 未配置或 API 调用失败
 */
export async function callLlm(messages: LlmMessage[], options?: LlmCallOptions): Promise<string> {
  // 1. 读取配置
  const settings = await getAiSettings()
  const modelStr = options?.model || settings.model || process.env.PI_MODEL || 'stepfun/step-3.7-flash'
  const [provider, modelName] = parseModel(modelStr)

  const apiKey = options?.apiKey || settings.apiKey || process.env.PI_API_KEY
  if (!apiKey) {
    throw new Error('LLM 调用失败：未配置 API key（请在 AI 设置中配置）')
  }

  // 2. 构建 endpoint
  const endpointSource = options?.endpoint || settings.endpoint || process.env.PI_API_ENDPOINT
  const baseUrl = endpointSource || PROVIDER_BASE_URLS[provider]
  if (!baseUrl) {
    throw new Error(`LLM 调用失败：未知 provider "${provider}"，且未配置 endpoint`)
  }
  const url = buildApiUrl(baseUrl)

  // 3. 调用 API（带超时）
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), options?.timeoutMs ?? 30_000)

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: modelName,
        messages,
        temperature: options?.temperature ?? 0.3,
        ...(options?.maxTokens ? { max_tokens: options.maxTokens } : {}),
      }),
      signal: controller.signal,
    })

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'unknown error')
      throw new Error(`LLM API 返回错误 ${response.status}: ${errorText}`)
    }

    const data = await response.json() as {
      choices?: Array<{ message?: { content?: string | null; reasoning_content?: string | null } }>
    }

    // reasoning 模型可能把所有 token 都用在 reasoning_content 上，content 为空
    // 优先取 content，兜底取 reasoning_content（让调用方至少拿到非空响应）
    const msg = data.choices?.[0]?.message
    const content = msg?.content || msg?.reasoning_content
    if (!content) {
      throw new Error('LLM API 返回空内容（content 和 reasoning_content 均为空）')
    }
    return content
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error(`LLM 调用超时（${options?.timeoutMs ?? 30_000}ms）`)
    }
    throw err
  } finally {
    clearTimeout(timeout)
  }
}

/**
 * 安全调用 LLM，失败时返回降级值
 * @param messages 消息数组
 * @param fallback 降级值
 * @param options 调用选项
 * @returns LLM 生成的文本或降级值
 */
export async function callLlmWithFallback(
  messages: LlmMessage[],
  fallback: string,
  options?: LlmCallOptions,
): Promise<string> {
  try {
    return await callLlm(messages, options)
  } catch (err) {
    console.warn('[LlmCaller] LLM 调用失败，使用降级值:', err instanceof Error ? err.message : String(err))
    return fallback
  }
}
