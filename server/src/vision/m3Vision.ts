// ============================================================================
// MiniMax-M3 视觉桥接（2026-08-14，AI 的眼睛）
// ----------------------------------------------------------------------------
// 背景：平台 AI 主模型是 DeepSeek V4 Flash（纯文本，非视觉）。当用户给 AI 发
// 图片/视频、或 AI 需要查看工作区图片时，本模块调用 MiniMax-M3（原生多模态，
// 图片/视频理解）生成文字描述，作为 AI 的「眼睛」。
//
// 媒体来源解析规则：
// - data:image URI        → 直接传给 M3
// - http(s):// 公网 URL   → 直接传给 M3（M3 服务器自行拉取）
// - /webos/api/apps/:id/files/raw/* → 优先服务端读文件转 base64；失败回退公网 URL
// - /webos/api/imagegen/file/* 、/webos/api/videogen/file/* → 公网 URL（免鉴权）
// - /webos/api/workspace/files/raw?path= → 服务端读工作区文件（该端点带鉴权）
// - 工作区相对路径（home/、agent/、apps/…）→ 图片读文件转 base64；
//   视频仅 apps/<appId>/ 下有公开 raw 端点可转 URL，其余本地视频无法分析
//   （返回 unsupported，不伪造成功）。
//
// 计费：按 MiniMax 官方「永久五折」价（输入 ¥2.10 / 输出 ¥8.40 / 缓存 ¥0.42
// 每百万 token）折算平台成本，逐次落 webos_vision_usage 表；管理后台
// （/api/admin/webos/vision/*）实时查看消耗金额与 token。不扣用户积分
// （属于平台侧 AI 能力增强成本）。
// ============================================================================

import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { getPool } from '../db/connection.js'

const VISION_MODEL = process.env.MINIMAX_VISION_MODEL?.trim() || 'MiniMax-M3'
const MINIMAX_API_KEY = process.env.MINIMAX_API_KEY?.trim() || ''
const MINIMAX_API_URL = 'https://api.minimaxi.com/v1/chat/completions'
/** 公网基础地址（与 webos.ts PUBLIC_BASE 保持一致；本地 API URL 转公网 URL 用） */
const PUBLIC_BASE = process.env.WEBOS_PUBLIC_BASE_URL?.trim() || 'https://shadowshub.xyz'

/** MiniMax-M3 官方价格（2026-08-12 确认「永久五折」）：元/百万 token */
export const VISION_PRICING = {
  inputPerMillion: 2.10,
  outputPerMillion: 8.40,
  cacheReadPerMillion: 0.42,
}

/** 图片文件上限（base64 后约 13MB，低于 M3 单图限制） */
export const MAX_IMAGE_FILE_BYTES = 10 * 1024 * 1024
const MAX_MEDIA_PER_CALL = 8
const REQUEST_TIMEOUT_MS = 90_000
const MAX_DESCRIPTION_TOKENS = 2048

export function visionConfigured(): boolean {
  return MINIMAX_API_KEY.length > 0
}

export function visionModelName(): string {
  return VISION_MODEL
}

export interface VisionContext {
  /** 用户工作区根目录 */
  workspaceRoot: string
  /** 公网基础地址（默认 https://shadowshub.xyz） */
  publicBase: string
}

export type VisionTrigger = 'chat_bridge' | 'read_tool' | 'describe_media'

export interface DescribeMediaInput {
  ctx: VisionContext
  /** 媒体来源：公网 URL / 本地 API URL / 工作区相对路径 / data URI */
  sources: string[]
  userKey: string
  userEmail?: string | null
  requestId?: string | null
  conversationId?: string | null
  trigger: VisionTrigger
  ip?: string | null
  /** 附带指令（如用户/工具想问的具体问题），可选 */
  ask?: string
}

export interface DescribeMediaResult {
  ok: boolean
  /** 描述文本（成功时非空；一次调用可能包含多张媒体的整体描述） */
  descriptions: string[]
  mediaCount: number
  inputTokens: number
  outputTokens: number
  cachedTokens: number
  totalTokens: number
  /** 平台成本（分，1 分 = ¥0.01） */
  costMinor: number
  durationMs: number
  status: 'ok' | 'failed' | 'timeout' | 'not_configured' | 'unsupported' | 'empty'
  errorCode?: string
  errorMessage?: string
}

// ---------------------------------------------------------------------------
// 媒体来源解析
// ---------------------------------------------------------------------------

const IMAGE_EXT_RE = /\.(png|jpe?g|webp|gif|bmp)$/i
const VIDEO_EXT_RE = /\.(mp4|webm|mov)$/i
const MIME_BY_EXT: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  bmp: 'image/bmp',
}

function fileKindOf(name: string): 'image' | 'video' | null {
  if (IMAGE_EXT_RE.test(name)) return 'image'
  if (VIDEO_EXT_RE.test(name)) return 'video'
  return null
}

interface ResolvedMedia {
  kind: 'image' | 'video'
  /** 传给 M3 的 url：data URI 或公网 URL */
  url: string
  label: string
}

/** 工作区相对路径 → 图片 base64 data URI（带防穿越；不存在/过大返回 null） */
function localImageToDataUri(root: string, rel: string): string | null {
  try {
    const trimmed = rel.trim().replace(/^\/+/, '')
    if (!trimmed || trimmed.includes('\0')) return null
    const resolved = path.resolve(root, trimmed)
    const relCheck = path.relative(root, resolved)
    if (relCheck.startsWith('..') || path.isAbsolute(relCheck)) return null
    if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) return null
    if (fs.statSync(resolved).size > MAX_IMAGE_FILE_BYTES) return null
    const ext = path.extname(resolved).slice(1).toLowerCase()
    const mime = MIME_BY_EXT[ext] ?? 'image/png'
    const b64 = fs.readFileSync(resolved).toString('base64')
    return `data:${mime};base64,${b64}`
  } catch {
    return null
  }
}

/** 工作区相对路径 → 公开 raw URL（仅 apps/<appId>/ 下，免鉴权端点） */
function localVideoToPublicUrl(root: string, rel: string, publicBase: string): string | null {
  try {
    const trimmed = rel.trim().replace(/^\/+/, '')
    const match = trimmed.match(/^apps\/([^/]+)\/(.+)$/)
    if (!match) return null
    const appId = decodeURIComponent(match[1] ?? '')
    const rest = decodeURIComponent(match[2] ?? '')
    if (!appId || !rest || appId.includes('..')) return null
    const urlPath = rest.split('/').map((seg) => encodeURIComponent(seg)).join('/')
    return `${publicBase}/webos/api/apps/${encodeURIComponent(appId)}/files/raw/${urlPath}`
  } catch {
    return null
  }
}

/** 解析单个媒体来源 → M3 可用 part；无法解析返回 null */
function resolveMediaSource(src: string, ctx: VisionContext): ResolvedMedia | null {
  const trimmed = src.trim()
  if (!trimmed) return null

  // 1) data:image URI → 原样
  if (/^data:image\/[a-z0-9.+-]+;base64,/i.test(trimmed)) {
    return { kind: 'image', url: trimmed, label: 'data URI' }
  }

  // 2) 公网 URL → 按扩展名判定；无扩展名按图片处理
  if (/^https?:\/\//i.test(trimmed)) {
    const kind = fileKindOf(trimmed) ?? (VIDEO_EXT_RE.test(trimmed.split('?')[0] ?? '') ? 'video' : 'image')
    return { kind, url: trimmed, label: trimmed }
  }

  // 3) 本地 API URL（/webos/api/...）
  if (trimmed.startsWith('/webos/api/')) {
    // 3a) App 素材 raw（path 式或 query 式）：优先服务端读文件转 base64
    const appsMatch = trimmed.match(/^\/webos\/api\/apps\/([^/]+)\/files\/raw(?:\/([^?]+))?(?:\?[^#]*path=([^&]+))?/)
    if (appsMatch) {
      const appId = decodeURIComponent(appsMatch[1] ?? '')
      const rest = decodeURIComponent(appsMatch[2] ?? appsMatch[3] ?? '')
      const kind = fileKindOf(rest)
      if (kind === 'image') {
        const root = path.join(ctx.workspaceRoot, 'apps', appId)
        const dataUri = localImageToDataUri(root, rest)
        if (dataUri) return { kind: 'image', url: dataUri, label: `apps/${appId}/${rest}` }
      }
      // 兜底：公开 raw 端点（生产环境免鉴权，M3 可直接拉取）
      return { kind: kind ?? 'image', url: `${ctx.publicBase}${trimmed}`, label: trimmed }
    }
    // 3b) 生图公开产物（免鉴权）
    if (/^\/webos\/api\/imagegen\/file\//i.test(trimmed)) {
      return { kind: 'image', url: `${ctx.publicBase}${trimmed}`, label: trimmed }
    }
    // 3c) 视频生成公开产物（免鉴权）
    if (/^\/webos\/api\/videogen\/file\//i.test(trimmed)) {
      return { kind: 'video', url: `${ctx.publicBase}${trimmed}`, label: trimmed }
    }
    // 3d) 用户工作区文件 raw（带鉴权，必须服务端读）
    const wsMatch = trimmed.match(/^\/webos\/api\/workspace\/files\/raw\?(?:.*[?&])?path=([^&]+)/)
    if (wsMatch) {
      const rel = decodeURIComponent(wsMatch[1] ?? '')
      const kind = fileKindOf(rel)
      if (kind === 'image') {
        const dataUri = localImageToDataUri(ctx.workspaceRoot, rel)
        if (dataUri) return { kind: 'image', url: dataUri, label: rel }
        return null
      }
      if (kind === 'video') {
        const publicUrl = localVideoToPublicUrl(ctx.workspaceRoot, rel, ctx.publicBase)
        if (publicUrl) return { kind: 'video', url: publicUrl, label: rel }
        return null
      }
      return null
    }
    return null
  }

  // 4) 工作区相对路径（home/、agent/、apps/、skills/…）
  const kind = fileKindOf(trimmed)
  if (kind === 'image') {
    const dataUri = localImageToDataUri(ctx.workspaceRoot, trimmed)
    if (dataUri) return { kind: 'image', url: dataUri, label: trimmed }
    return null
  }
  if (kind === 'video') {
    const publicUrl = localVideoToPublicUrl(ctx.workspaceRoot, trimmed, ctx.publicBase)
    if (publicUrl) return { kind: 'video', url: publicUrl, label: trimmed }
    return null
  }
  return null
}

// ---------------------------------------------------------------------------
// MiniMax-M3 调用
// ---------------------------------------------------------------------------

const INSTRUCTION = [
  '你是平台的 AI 视觉助手（MiniMax M3），负责把图片/视频内容转成文字描述，供纯文本模型理解。',
  '请仔细描述用户提供的媒体内容，要求：',
  '1. 主体：画面中有哪些人物/物体/动物，它们在做什么；',
  '2. 文字：如果包含文字（截图、文档、海报、报错信息、UI 等），完整转录出来；',
  '3. 细节：布局、颜色、风格、数量、明显特征；',
  '4. 问题：如果是报错截图或界面，明确指出问题点；',
  '5. 用中文分点回答，客观描述，不要猜测不存在的内容。',
].join('\n')

/** 剥离 M3 输出里的 <think> 思考块（M3 可能默认带思考） */
function stripThink(content: string): string {
  return content.replace(/^<think>[\s\S]*?<\/think>\s*/i, '').trim()
}

async function callM3(
  parts: Array<Record<string, unknown>>,
  ask?: string,
): Promise<{ content: string; inputTokens: number; outputTokens: number; cachedTokens: number }> {
  const userText = ask?.trim() ? `${INSTRUCTION}\n\n用户关注的问题：${ask.trim()}` : INSTRUCTION
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const resp = await fetch(MINIMAX_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${MINIMAX_API_KEY}`,
      },
      body: JSON.stringify({
        model: VISION_MODEL,
        messages: [
          {
            role: 'user',
            content: [{ type: 'text', text: userText }, ...parts],
          },
        ],
        max_completion_tokens: MAX_DESCRIPTION_TOKENS,
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
        prompt_tokens_details?: { cached_tokens?: unknown }
      }
    }
    const content = typeof data?.choices?.[0]?.message?.content === 'string' ? data.choices[0].message.content : ''
    const usage = data?.usage ?? {}
    return {
      content: stripThink(content),
      inputTokens: Number(usage.prompt_tokens ?? 0),
      outputTokens: Number(usage.completion_tokens ?? 0),
      cachedTokens: Number(usage.prompt_tokens_details?.cached_tokens ?? 0),
    }
  } finally {
    clearTimeout(timer)
  }
}

// ---------------------------------------------------------------------------
// 用量落库（webos_vision_usage；管理后台 /api/admin/webos/vision/* 查询）
// ---------------------------------------------------------------------------

export interface VisionUsageRecord {
  userKey: string
  userEmail?: string | null
  requestId?: string | null
  conversationId?: string | null
  trigger: VisionTrigger
  kind: 'image' | 'video' | 'mixed' | 'unsupported'
  mediaCount: number
  prompt?: string
  description?: string
  inputTokens: number
  outputTokens: number
  cachedTokens: number
  totalTokens: number
  costMinor: number
  status: string
  errorCode?: string
  errorMessage?: string
  durationMs: number
  ip?: string | null
}

export async function recordVisionUsage(input: VisionUsageRecord): Promise<void> {
  try {
    const pool = getPool()
    await pool.query(
      `INSERT INTO webos_vision_usage
        (id, user_key, user_email, request_id, conversation_id, trigger, kind, media_count, prompt, description,
         input_tokens, output_tokens, cached_tokens, total_tokens, cost_minor, status, error_code, error_message, duration_ms, ip, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)`,
      [
        `vision-${randomUUID()}`,
        input.userKey,
        input.userEmail ?? null,
        input.requestId ?? null,
        input.conversationId ?? null,
        input.trigger,
        input.kind,
        input.mediaCount,
        input.prompt ? String(input.prompt).slice(0, 300) : null,
        input.description ? String(input.description).slice(0, 500) : null,
        input.inputTokens,
        input.outputTokens,
        input.cachedTokens,
        input.totalTokens,
        input.costMinor,
        input.status,
        input.errorCode ?? null,
        input.errorMessage ? String(input.errorMessage).slice(0, 500) : null,
        input.durationMs,
        input.ip ?? null,
        Date.now(),
      ],
    )
  } catch (error) {
    console.warn('[vision] recordVisionUsage failed:', error instanceof Error ? error.message : String(error))
  }
}

// ---------------------------------------------------------------------------
// 图片文件描述（公共入口）：read / agent_fs_read 读图片文件时复用
// 输入文件绝对路径（调用方已完成路径校验/防穿越），内部做大小检查、
// base64 编码、M3 调用、用量落库。失败返回明确错误，不抛异常。
// ---------------------------------------------------------------------------

export interface DescribeImageFileInput {
  /** 文件绝对路径（已校验存在且在工作区内） */
  filePath: string
  userKey: string
  userEmail?: string | null
  requestId?: string | null
  conversationId?: string | null
  ip?: string | null
  /** 工作区根目录（用于构造 ctx；不传则按 userKey 解析） */
  workspaceRoot?: string
}

export interface DescribeImageFileResult {
  ok: boolean
  description?: string
  errorMessage?: string
}

export async function describeImageFile(input: DescribeImageFileInput): Promise<DescribeImageFileResult> {
  try {
    const stat = fs.statSync(input.filePath)
    if (!stat.isFile()) return { ok: false, errorMessage: '不是文件' }
    if (stat.size > MAX_IMAGE_FILE_BYTES) {
      return { ok: false, errorMessage: `图片过大（${Math.round(stat.size / 1024)}KB，上限 10MB）` }
    }
    const ext = path.extname(input.filePath).slice(1).toLowerCase()
    const mime = MIME_BY_EXT[ext] ?? 'image/png'
    const b64 = fs.readFileSync(input.filePath).toString('base64')
    const workspaceRoot = input.workspaceRoot ?? getWorkspaceRootByKey(input.userKey)
    const vr = await describeMedia({
      ctx: { workspaceRoot, publicBase: PUBLIC_BASE },
      sources: [`data:${mime};base64,${b64}`],
      userKey: input.userKey,
      userEmail: input.userEmail ?? null,
      requestId: input.requestId ?? null,
      conversationId: input.conversationId ?? null,
      trigger: 'read_tool',
      ip: input.ip ?? null,
    })
    if (vr.ok && vr.descriptions.length > 0) {
      return { ok: true, description: vr.descriptions[0] }
    }
    return { ok: false, errorMessage: vr.errorMessage ?? '视觉模型调用失败' }
  } catch (error) {
    return { ok: false, errorMessage: error instanceof Error ? error.message : String(error) }
  }
}

/** 按 userKey 解析工作区根目录（m3Vision 不直接依赖 webosWorkspace，避免耦合；懒解析） */
function getWorkspaceRootByKey(userKey: string): string {
  // 与 utils/webosWorkspace.getWorkspaceRoot 相同的目录规则
  const sandboxRoot = process.env.SANDBOX_DIR
    || require('node:path').resolve(process.cwd(), 'data', 'workspace')
  const safe = userKey.replace(/[^a-zA-Z0-9_.:-]/g, '_').slice(0, 96) || 'default'
  return require('node:path').join(sandboxRoot, 'webos', safe)
}

// ---------------------------------------------------------------------------
// 对外主入口：describeMedia
// ---------------------------------------------------------------------------

export async function describeMedia(input: DescribeMediaInput): Promise<DescribeMediaResult> {
  const startedAt = Date.now()

  if (!MINIMAX_API_KEY) {
    return {
      ok: false,
      descriptions: [],
      mediaCount: 0,
      inputTokens: 0,
      outputTokens: 0,
      cachedTokens: 0,
      totalTokens: 0,
      costMinor: 0,
      durationMs: Date.now() - startedAt,
      status: 'not_configured',
      errorCode: 'VISION_NOT_CONFIGURED',
      errorMessage: '视觉模型未配置（MINIMAX_API_KEY 缺失）',
    }
  }

  // 解析媒体来源（最多 8 条）
  const resolved: ResolvedMedia[] = []
  for (const src of input.sources.slice(0, MAX_MEDIA_PER_CALL)) {
    const r = resolveMediaSource(src, input.ctx)
    if (r) resolved.push(r)
  }

  const mediaCount = resolved.length
  const kind: VisionUsageRecord['kind'] = resolved.some((r) => r.kind === 'video')
    ? resolved.some((r) => r.kind === 'image') ? 'mixed' : 'video'
    : 'image'

  if (mediaCount === 0) {
    await recordVisionUsage({
      userKey: input.userKey,
      userEmail: input.userEmail ?? null,
      requestId: input.requestId ?? null,
      conversationId: input.conversationId ?? null,
      trigger: input.trigger,
      kind,
      mediaCount: 0,
      prompt: input.ask ?? undefined,
      inputTokens: 0,
      outputTokens: 0,
      cachedTokens: 0,
      totalTokens: 0,
      costMinor: 0,
      status: 'unsupported',
      errorCode: 'UNSUPPORTED_MEDIA',
      errorMessage: '媒体来源无法解析（仅支持图片/公开视频 URL/工作区图片文件）',
      durationMs: Date.now() - startedAt,
      ip: input.ip ?? null,
    })
    return {
      ok: false,
      descriptions: [],
      mediaCount: 0,
      inputTokens: 0,
      outputTokens: 0,
      cachedTokens: 0,
      totalTokens: 0,
      costMinor: 0,
      durationMs: Date.now() - startedAt,
      status: 'unsupported',
      errorCode: 'UNSUPPORTED_MEDIA',
      errorMessage: '媒体来源无法解析（仅支持图片/公开视频 URL/工作区图片文件）',
    }
  }

  // 组装 M3 多模态 content
  const parts = resolved.map((r) => (r.kind === 'image'
    ? { type: 'image_url', image_url: { url: r.url } }
    : { type: 'video_url', video_url: { url: r.url } }))

  try {
    const { content, inputTokens, outputTokens, cachedTokens } = await callM3(parts, input.ask)
    const totalTokens = inputTokens + outputTokens
    const costMinor = Math.round(
      (inputTokens / 1_000_000) * VISION_PRICING.inputPerMillion * 100
      + (outputTokens / 1_000_000) * VISION_PRICING.outputPerMillion * 100,
    )
    const ok = content.length > 0

    await recordVisionUsage({
      userKey: input.userKey,
      userEmail: input.userEmail ?? null,
      requestId: input.requestId ?? null,
      conversationId: input.conversationId ?? null,
      trigger: input.trigger,
      kind,
      mediaCount,
      prompt: input.ask ?? undefined,
      description: ok ? content : undefined,
      inputTokens,
      outputTokens,
      cachedTokens,
      totalTokens,
      costMinor,
      status: ok ? 'ok' : 'empty',
      errorCode: ok ? undefined : 'EMPTY_DESCRIPTION',
      durationMs: Date.now() - startedAt,
      ip: input.ip ?? null,
    })

    return {
      ok,
      descriptions: ok ? [content] : [],
      mediaCount,
      inputTokens,
      outputTokens,
      cachedTokens,
      totalTokens,
      costMinor,
      durationMs: Date.now() - startedAt,
      status: ok ? 'ok' : 'empty',
      errorCode: ok ? undefined : 'EMPTY_DESCRIPTION',
      errorMessage: ok ? undefined : '模型未返回有效描述',
    }
  } catch (error) {
    const isTimeout = error instanceof Error && (error.name === 'AbortError' || /abort|timeout/i.test(error.message))
    const status = isTimeout ? 'timeout' : 'failed'
    const errorCode = isTimeout ? 'TIMEOUT' : 'UPSTREAM_ERROR'
    const message = error instanceof Error ? error.message : String(error)

    console.warn(`[vision] M3 ${status} trigger=${input.trigger} media=${mediaCount} msg=${message.slice(0, 200)}`)

    await recordVisionUsage({
      userKey: input.userKey,
      userEmail: input.userEmail ?? null,
      requestId: input.requestId ?? null,
      conversationId: input.conversationId ?? null,
      trigger: input.trigger,
      kind,
      mediaCount,
      prompt: input.ask ?? undefined,
      inputTokens: 0,
      outputTokens: 0,
      cachedTokens: 0,
      totalTokens: 0,
      costMinor: 0,
      status,
      errorCode,
      errorMessage: message.slice(0, 500),
      durationMs: Date.now() - startedAt,
      ip: input.ip ?? null,
    })

    return {
      ok: false,
      descriptions: [],
      mediaCount,
      inputTokens: 0,
      outputTokens: 0,
      cachedTokens: 0,
      totalTokens: 0,
      costMinor: 0,
      durationMs: Date.now() - startedAt,
      status,
      errorCode,
      errorMessage: message,
    }
  }
}
