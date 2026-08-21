// ============================================================================
// DeepSeek 视觉 provider（2026-08-21，AI 的眼睛 · 图片优先）
// ----------------------------------------------------------------------------
// 背景：主模型 DeepSeek V4 Flash 是纯文本，图片需经视觉模型转文字描述注入。
// 此前唯一视觉 provider 是 MiniMax-M3（图片/视频通用）。DeepSeek 官方现已提供
// deepseek-v4-flash-vision-exp（OpenAI 兼容 /chat/completions），单价显著低于
// M3 且图片 token 有硬上限（≤384 token/张，自动缩放 800×800）：
//   - 输入 空闲 ¥1.5 / 高峰 ¥3.0（M3 固定 ¥2.1）
//   - 输出 空闲 ¥4.5 / 高峰 ¥9.0（M3 固定 ¥8.4）
//   - 缓存命中 空闲 ¥0.05 / 高峰 ¥0.10
// 形态：图片优先走 DeepSeek；视频（DeepSeek 不支持）与 DeepSeek 失败时回退 M3。
//
// 注意：
// - 仅支持图片（JPEG/PNG/GIF/WebP），不支持视频；含视频的请求请走 M3。
// - 图片仅允许出现在 user 消息（OpenAI 兼容 content 数组 image_url）。
// - 密钥只从环境变量读取（DEEPSEEK_VISION_API_KEY），不入 Git/日志。
// - 落库复用 m3Vision 的 recordVisionUsage（model 字段区分 provider）。
// ============================================================================

import { isDeepSeekPeak } from '../billing/pricing.js'

/** 模型名（官方实验模型，OpenAI 兼容端点） */
export const DS_VISION_MODEL_NAME = 'deepseek-v4-flash-vision-exp'
export const DS_VISION_API_URL = 'https://api.deepseek.com/chat/completions'
const REQUEST_TIMEOUT_MS = 90_000
const MAX_DESCRIPTION_TOKENS = 2048

function dsApiKey(): string {
  return process.env.DEEPSEEK_VISION_API_KEY?.trim() || ''
}

/** DeepSeek 视觉是否已配置 */
export function dsVisionConfigured(): boolean {
  return dsApiKey().length > 0
}

/**
 * DeepSeek 视觉当前时段定价（元/百万 token；与 billing/pricing 的高峰定义一致
 * ——北京时间 9:00-12:00 / 14:00-18:00 为高峰，高峰 = 空闲 ×2）。
 */
export function dsVisionPricing(): { inputPerMillion: number; outputPerMillion: number; cacheReadPerMillion: number } {
  const peak = isDeepSeekPeak()
  return {
    inputPerMillion: peak ? 3.0 : 1.5,
    outputPerMillion: peak ? 9.0 : 4.5,
    cacheReadPerMillion: peak ? 0.10 : 0.05,
  }
}

const DS_INSTRUCTION = [
  '你是平台的 AI 视觉助手（DeepSeek V4 Flash Vision），负责把图片内容转成文字描述，供纯文本模型理解。',
  '请仔细描述用户提供的图片，要求：',
  '1. 主体：画面中有哪些人物/物体/动物，它们在做什么；',
  '2. 文字：如果图片包含文字（截图、文档、海报、报错信息、UI 等），完整转录出来；',
  '3. 细节：布局、颜色、风格、数量、明显特征；',
  '4. 问题：如果是报错截图或界面，明确指出问题点；',
  '5. 用中文分点回答，客观描述，不要猜测不存在的内容。',
].join('\n')

/** 剥离输出里的 thinking 块（保险；flash 默认无思考） */
function stripThink(content: string): string {
  return content.replace(/^ thinking[\s\S]*?<\/think>\s*/i, '').trim()
}

/**
 * 调用 DeepSeek 视觉（仅图片）。parts 为 OpenAI 兼容 content 块数组
 * （[{type:'text',...}, {type:'image_url', image_url:{url}}] 或纯图片数组，
 * 调用方已生成）。失败抛错（由调用方决定降级），成功返回描述与用量。
 */
export async function callDeepSeekVision(
  parts: Array<Record<string, unknown>>,
  ask?: string,
): Promise<{ content: string; inputTokens: number; outputTokens: number; cachedTokens: number }> {
  const apiKey = dsApiKey()
  if (!apiKey) {
    throw new Error('DEEPSEEK_VISION_API_KEY 未配置')
  }
  const userText = ask?.trim() ? `${DS_INSTRUCTION}\n\n用户关注的问题：${ask.trim()}` : DS_INSTRUCTION
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const resp = await fetch(DS_VISION_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: DS_VISION_MODEL_NAME,
        messages: [
          {
            role: 'user',
            content: [{ type: 'text', text: userText }, ...parts],
          },
        ],
        max_tokens: MAX_DESCRIPTION_TOKENS,
        temperature: 0.3,
      }),
      signal: controller.signal,
    })
    const raw = await resp.text().catch(() => '')
    if (!resp.ok) {
      throw new Error(`HTTP ${resp.status}: ${raw.slice(0, 300)}`)
    }
    const data = JSON.parse(raw) as {
      choices?: Array<{ message?: { content?: unknown } }>
      usage?: {
        prompt_tokens?: unknown
        completion_tokens?: unknown
        prompt_cache_hit_tokens?: unknown
        prompt_cache_miss_tokens?: unknown
      }
    }
    const content = data?.choices?.[0]?.message?.content
    const usage = data?.usage ?? {}
    const usageText = typeof content === 'string' ? content
      : Array.isArray(content)
        ? content.map((part) => (typeof part === 'string' ? part : (part && typeof part === 'object' && 'text' in part ? String((part as { text?: unknown }).text ?? '') : ''))).join('')
        : ''
    return {
      content: stripThink(usageText),
      inputTokens: Number(usage.prompt_tokens ?? 0),
      outputTokens: Number(usage.completion_tokens ?? 0),
      cachedTokens: Number(usage.prompt_cache_hit_tokens ?? 0),
    }
  } finally {
    clearTimeout(timer)
  }
}