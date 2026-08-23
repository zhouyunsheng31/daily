import { randomUUID } from 'node:crypto'
import { getPool } from '../db/connection.js'

export const IMAGE_PRICING = {
  model: 'gpt-image-2-super',
  inputPerMillion: 24,
  outputPerMillion: 90,
  costInputPerMillion: 16,
  costOutputPerMillion: 60,
}

export function imageGenConfigured(): boolean {
  const key = process.env.CHATST_IMAGE_API_KEY?.trim() || process.env.CHATST_API_KEY?.trim()
  return Boolean(key)
}

export interface GenerateImageParams {
  prompt: string
  n?: number
  size?: string
  referenceImage?: Buffer
}

export interface GenerateImageResult {
  ok: boolean
  images: Buffer[]
  inputTokens: number
  outputTokens: number
  costMinor: number
  durationMs: number
  status: 'ok' | 'failed' | 'timeout'
  errorCode?: string
  errorMessage?: string
}

export async function generateImages(params: GenerateImageParams): Promise<GenerateImageResult> {
  const startTime = Date.now()
  const apiKey = process.env.CHATST_IMAGE_API_KEY?.trim() || process.env.CHATST_API_KEY?.trim()
  if (!apiKey) {
    return {
      ok: false,
      images: [],
      inputTokens: 0,
      outputTokens: 0,
      costMinor: 0,
      durationMs: Date.now() - startTime,
      status: 'failed',
      errorCode: 'IMAGE_GEN_NOT_CONFIGURED',
      errorMessage: '生图渠道未配置',
    }
  }

  const endpoint = process.env.CHATST_IMAGE_BASE_URL?.trim() || 'https://api.chatst.cn/v1/images/generations'
  const count = Math.max(1, Math.min(4, params.n || 1))
  const size = params.size || '1024x1024'

  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 120_000)

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: IMAGE_PRICING.model,
        prompt: params.prompt,
        n: count,
        size,
        response_format: 'b64_json',
      }),
      signal: controller.signal,
    })

    clearTimeout(timeout)
    const durationMs = Date.now() - startTime

    if (!response.ok) {
      const errText = await response.text().catch(() => '')
      return {
        ok: false,
        images: [],
        inputTokens: 0,
        outputTokens: 0,
        costMinor: 0,
        durationMs,
        status: 'failed',
        errorCode: `HTTP_${response.status}`,
        errorMessage: errText.slice(0, 300) || response.statusText,
      }
    }

    const data = (await response.json()) as { data?: Array<{ b64_json?: string; url?: string }>; usage?: { prompt_tokens?: number; completion_tokens?: number } }
    const images: Buffer[] = []

    if (Array.isArray(data.data)) {
      for (const item of data.data) {
        if (item.b64_json) {
          images.push(Buffer.from(item.b64_json, 'base64'))
        } else if (item.url) {
          const imgRes = await fetch(item.url)
          if (imgRes.ok) {
            const buf = Buffer.from(await imgRes.arrayBuffer())
            images.push(buf)
          }
        }
      }
    }

    const inputTokens = data.usage?.prompt_tokens ?? (params.prompt.length * 2)
    const outputTokens = data.usage?.completion_tokens ?? (images.length * 1000)
    // 售价：输入 24/M, 输出 90/M (单位：分)
    const costMinor = Math.ceil((inputTokens * IMAGE_PRICING.inputPerMillion + outputTokens * IMAGE_PRICING.outputPerMillion) / 10_000)

    return {
      ok: images.length > 0,
      images,
      inputTokens,
      outputTokens,
      costMinor,
      durationMs,
      status: images.length > 0 ? 'ok' : 'failed',
      errorCode: images.length > 0 ? undefined : 'NO_IMAGE_RETURNED',
    }
  } catch (error) {
    return {
      ok: false,
      images: [],
      inputTokens: 0,
      outputTokens: 0,
      costMinor: 0,
      durationMs: Date.now() - startTime,
      status: 'failed',
      errorCode: 'UPSTREAM_ERROR',
      errorMessage: error instanceof Error ? error.message : String(error),
    }
  }
}

export interface ImageGenUsageRecord {
  userKey: string
  userEmail?: string | null
  kind?: string
  prompt?: string
  n?: number
  images: number
  inputTokens: number
  outputTokens: number
  costMinor: number
  status: string
  errorCode?: string
  durationMs: number
  ip?: string
}

export async function recordImageGenUsage(record: ImageGenUsageRecord): Promise<void> {
  try {
    const pool = getPool()
    const id = randomUUID()
    const now = Date.now()
    const totalTokens = (record.inputTokens || 0) + (record.outputTokens || 0)
    await pool.query(
      `INSERT INTO webos_imagegen_usage (
        id, user_key, user_email, kind, model, prompt, n, images,
        input_tokens, output_tokens, total_tokens, cost_minor,
        status, error_code, duration_ms, ip, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)`,
      [
        id,
        record.userKey,
        record.userEmail ?? null,
        record.kind ?? 'guest',
        IMAGE_PRICING.model,
        (record.prompt || '').slice(0, 500),
        record.n ?? 1,
        record.images,
        record.inputTokens,
        record.outputTokens,
        totalTokens,
        record.costMinor,
        record.status,
        record.errorCode ?? null,
        record.durationMs,
        record.ip ?? null,
        now,
      ],
    )
  } catch {
    // 统计记录失败不中断主业务
  }
}
