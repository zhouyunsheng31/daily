// ============================================================================
// MiniMax H3 视频生成模块（2026-08-05，秘塔渠道）
// ----------------------------------------------------------------------------
// 秘塔官方只更换 API Host：https://metaso.cn/api/minimax（官方 https://api.minimaxi.com），
// 请求/响应格式完全参照 MiniMax 官方文档（video-generation-v2-*）。
//
// 能力：
// - 文生视频（t2v）/ 图生视频（i2v：首帧 / 首尾帧）：POST /v2/video_generation
// - 任务查询：GET /v2/query/video_generation/{task_id}（任务成功 content.url 为临时链接，立即下载转存）
// - H3-Context-IR 增强：POST /v2/h3_context_ir（只返回增强提示词，不创建任务）；
//   未充值/失败时**降级**为原始提示词直接生成（不阻断主流程）
//
// 计费：
// - 用户扣费：按 MiniMax 官方刊例价（2K ¥0.80/秒、768P ¥0.50/秒）→ pricing.ts videoCostMinor
// - 后台成本：按秘塔渠道价（2K ¥0.15/秒、768P ¥0.09/秒）→ pricing.ts videoMetasoCostMinor
// - 每次任务（含失败）落库 webos_video_usage；充值记录 webos_video_recharges（管理后台统计）
// ============================================================================

import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { getPool } from '../db/connection.js'
import {
  videoCostMinor,
  videoMetasoCostMinor,
  type VideoResolution,
} from '../billing/pricing.js'

// ---------------------------------------------------------------------------
// 配置
// ---------------------------------------------------------------------------

const METASO_BASE = 'https://metaso.cn/api/minimax'
const TASK_TIMEOUT_MS = 10 * 60_000   // 单任务轮询上限 10 分钟
const POLL_INTERVAL_MS = 5_000        // 轮询间隔 5s
const MAX_PROMPT_LENGTH = 4_000
const RATIOS = ['21:9', '16:9', '4:3', '1:1', '3:4', '9:16', 'adaptive'] as const
const DURATIONS = [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15] as const

/**
 * H3-Context-IR 计费（2026-08-06，MiniMax 官方按量价）：
 * 输入 ¥5.80 / 百万 tokens、输出 ¥23.00 / 百万 tokens。
 * 秘塔渠道对 Context-IR 未公开独立价目，后台成本按官方价折算并标注（用户不单独扣费，
 * 包含在视频售价内）。一次典型增强任务 ~9k tokens ≈ ¥0.11 ≈ 11 分。
 */
export const CONTEXT_IR_PRICE = { inputPerMillion: 5.8, outputPerMillion: 23 } as const

function envString(name: string): string | null {
  const value = process.env[name]
  return value && value.trim().length > 0 ? value.trim() : null
}

/** 秘塔渠道是否已配置（METASO_API_KEY 同时服务搜索/视频；未配置时视频功能明确不可用） */
export function videoGenConfigured(): boolean {
  return envString('METASO_API_KEY') !== null
}

function metasoKey(): string {
  const key = envString('METASO_API_KEY')
  if (!key) throw new Error('视频生成渠道未配置（METASO_API_KEY 缺失）')
  return key
}

// ---------------------------------------------------------------------------
// 类型
// ---------------------------------------------------------------------------

export interface VideoGenInput {
  prompt: string
  resolution?: VideoResolution        // '768P' | '2K'（默认 768P）
  duration?: number                   // 4-15 秒（默认 4）
  ratio?: string                      // 21:9 / 16:9 / 4:3 / 1:1 / 3:4 / 9:16 / adaptive（默认 16:9）
  /** 图生视频：首帧图片 URL（公开可访问；工作区图片需先经公开素材端点） */
  firstFrameUrl?: string
  /** 图生视频：尾帧图片 URL（与 firstFrameUrl 组合为首尾帧） */
  lastFrameUrl?: string
  /** 2026-08-06 多模态参考生视频（r2va）：参考图 URL 数组（1-9 张，与首尾帧互斥）；
   *  参考图比首尾帧效果更好（官方推荐），首尾帧仅用于精确控制起止画面 */
  referenceImages?: string[]
  /** 是否启用 H3-Context-IR 增强（默认 true；渠道余额不足时自动降级为原始提示词） */
  enhance?: boolean
  /** 2026-08-13 输出目录（工作区相对路径，默认 agent/videos；如 apps/<appId>/assets 直接落 App 素材区） */
  outputDir?: string
  /** 轮询进度回调（每 ~5s 一次；webos.ts 用它转发 tool_update + 刷新 pi 活动计时） */
  onProgress?: (text: string) => void
  timeoutMs?: number
}

export interface VideoGenResult {
  ok: boolean
  /** 工作区相对路径（默认 agent/videos/xxx.mp4，outputDir 指定时为其下；供 AI/App 引用） */
  path: string | null
  /** 公开访问 URL（免鉴权，App iframe 可用） */
  url: string | null
  /** 2026-08-06 首帧封面图 URL（webp/jpg，几十 KB——App 里 <video poster> 秒开预览） */
  posterUrl: string | null
  /** 增强提示词（enhance 成功时返回；降级为 null） */
  enhancedPrompt: string | null
  /** 2026-08-06 H3-Context-IR 真实 token 用量（成功时返回；后台按官方价折算成本） */
  contextIRUsage: { promptTokens: number; completionTokens: number } | null
  /** 用户扣费（官方价，分） */
  costUserMinor: number
  /** 后台成本（秘塔价，分） */
  costMetasoMinor: number
  durationMs: number
  status: 'ok' | 'failed' | 'timeout' | 'insufficient' | 'rejected'
  errorCode?: string
  errorMessage?: string
  taskId?: string
  imageCount: number
}

// ---------------------------------------------------------------------------
// 底层 HTTP（含错误码识别：402=余额不足 → insufficient；429=限流 → failed 重试由调用方决定）
// ---------------------------------------------------------------------------

interface MetasoErrorBody {
  error?: { code?: string | number; message?: string }
  message?: string
  base_resp?: { status_code?: number; status_msg?: string }
}

function extractErrorCode(status: number, body: string): { code: string; message: string } {
  let parsed: MetasoErrorBody | null = null
  try { parsed = JSON.parse(body) as MetasoErrorBody } catch { /* ignore */ }
  const code = String(parsed?.error?.code ?? parsed?.base_resp?.status_code ?? `HTTP_${status}`)
  const message = parsed?.error?.message ?? parsed?.base_resp?.status_msg ?? parsed?.message ?? body.slice(0, 200)
  return { code, message }
}

async function metasoFetch(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  return fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${metasoKey()}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...(init.headers ?? {}),
    },
    signal: AbortSignal.timeout(timeoutMs),
  })
}

// ---------------------------------------------------------------------------
// 1. H3-Context-IR 提示词增强（降级设计：任何失败返回 null，不阻断生成）
// ---------------------------------------------------------------------------

/**
 * 调用 H3-Context-IR 增强提示词。
 * - 渠道未充值（402/余额不足）→ 返回 null（调用方降级用原始提示词）
 * - 网络/超时/内容错误 → 返回 null（不阻断）
 * - 成功 → 返回增强后的结构化提示词 + 真实 token 用量（后台按官方价折算成本落库）
 */
export interface ContextIRResult {
  prompt: string | null
  usage?: { promptTokens: number; completionTokens: number }
  degraded?: boolean
}

export async function enhanceVideoPrompt(input: {
  prompt: string
  duration: number
  ratio: string
  firstFrameUrl?: string
  lastFrameUrl?: string
  referenceImages?: string[]
  /** 进度回调（2026-08-08 新增：增强轮询期间定期上报，前端工具卡片有进度、刷新 pi 活动计时防误杀） */
  onProgress?: (text: string) => void
}): Promise<ContextIRResult> {
  const startedAt = Date.now()
  const onProgress = input.onProgress ?? (() => {})
  const content: Array<Record<string, unknown>> = [{ type: 'text', text: input.prompt }]
  if (input.firstFrameUrl) content.push({ type: 'image_url', image_url: { url: input.firstFrameUrl }, role: 'first_frame' })
  if (input.lastFrameUrl) content.push({ type: 'image_url', image_url: { url: input.lastFrameUrl }, role: 'last_frame' })
  for (const ref of input.referenceImages ?? []) content.push({ type: 'image_url', image_url: { url: ref }, role: 'reference_image' })
  const body = JSON.stringify({ model: 'MiniMax-H3', content, duration: input.duration, ratio: input.ratio })
  try {
    const resp = await metasoFetch(`${METASO_BASE}/v2/h3_context_ir`, { method: 'POST', body }, 60_000)
    if (!resp.ok) {
      const text = await resp.text().catch(() => '')
      const { code, message } = extractErrorCode(resp.status, text)
      console.log(`[videogen] H3-Context-IR degraded (${code}: ${message.slice(0, 120)}) — using raw prompt`)
      return { prompt: null, degraded: true }
    }
    const data = (await resp.json()) as { task?: { id?: string }; task_id?: string }
    // 2026-08-06 实测修复：秘塔实际返回顶层 task_id（非嵌套 task.id），
    // 原解析拿不到任务 ID → Context-IR 一直降级从未生效；兼容两种格式
    const taskId = String(data?.task?.id ?? data?.task_id ?? '')
    if (!taskId) return { prompt: null, degraded: true }
    // 轮询增强任务（通常 10-60s）。2026-08-08：上限 180s → 60s，超时即降级——
    // 增强只是优化提示词，不值得让用户干等 3 分钟（此前卡 2 分钟+ 的元凶之一）。
    // 每 10s 通过 onProgress 报一次进度（webos.ts 的 onProgress 会刷新 pi 活动计时，
    // 防止长轮询期间触发 180s 空闲超时误杀工具）。
    const deadline = Date.now() + 60_000
    let lastTick = 0
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 3_000))
      if (Date.now() - lastTick >= 10_000) {
        lastTick = Date.now()
        onProgress(`正在用 H3-Context-IR 优化提示词…（已等待 ${Math.round((Date.now() - startedAt) / 1000)} 秒）`)
      }
      const query = await metasoFetch(`${METASO_BASE}/v2/query/video_generation/${encodeURIComponent(taskId)}`, { method: 'GET' }, 30_000)
      if (!query.ok) continue
      const qData = (await query.json()) as {
        task?: { status?: string; content?: { prompt?: string }; usage?: { prompt_tokens?: number; completion_tokens?: number } }
      }
      const status = qData?.task?.status ?? ''
      if (status === 'succeeded') {
        const enhanced = qData?.task?.content?.prompt
        return {
          prompt: enhanced ? String(enhanced).slice(0, 12_000) : null,
          usage: {
            promptTokens: Number(qData?.task?.usage?.prompt_tokens ?? 0),
            completionTokens: Number(qData?.task?.usage?.completion_tokens ?? 0),
          },
        }
      }
      if (status === 'failed') {
        console.log('[videogen] H3-Context-IR task failed — using raw prompt')
        return { prompt: null, degraded: true }
      }
    }
    console.log(`[videogen] H3-Context-IR timed out after ${Math.round((Date.now() - startedAt) / 1000)}s — using raw prompt`)
    return { prompt: null, degraded: true }
  } catch (error) {
    console.log('[videogen] H3-Context-IR degraded:', error instanceof Error ? error.message.slice(0, 120) : String(error))
    return { prompt: null, degraded: true }
  }
}

// ---------------------------------------------------------------------------
// 2. 创建视频任务 + 轮询 + 下载
// ---------------------------------------------------------------------------

export interface VideoTaskInfo {
  taskId: string
  status: string        // pending / processing / succeeded / failed / canceled
  url?: string
  errorCode?: string
  errorMessage?: string
  usage?: { total_seconds?: number; input_seconds?: number; output_seconds?: number; input_image_count?: number }
}

async function createVideoTask(input: {
  prompt: string
  resolution: string
  duration: number
  ratio: string
  firstFrameUrl?: string
  lastFrameUrl?: string
  referenceImages?: string[]
  /** 进度回调（2026-08-08：重试等待/请求期间定期上报，刷新 pi 活动计时防误杀） */
  onProgress?: (text: string) => void
}): Promise<VideoTaskInfo> {
  const onProgress = input.onProgress ?? (() => {})
  const content: Array<Record<string, unknown>> = [{ type: 'text', text: input.prompt }]
  if (input.firstFrameUrl) content.push({ type: 'image_url', image_url: { url: input.firstFrameUrl }, role: 'first_frame' })
  if (input.lastFrameUrl) content.push({ type: 'image_url', image_url: { url: input.lastFrameUrl }, role: 'last_frame' })
  for (const ref of input.referenceImages ?? []) content.push({ type: 'image_url', image_url: { url: ref }, role: 'reference_image' })
  const body = JSON.stringify({
    model: 'MiniMax-H3',
    content,
    resolution: input.resolution,
    duration: input.duration,
    ratio: input.ratio,
  })
  // 2026-08-08：瞬时错误自动重试（最多 3 次，退避 1s/3s）——任务创建失败后若让 AI
  // 自行重试，会重新跑一遍 H3-Context-IR（1-2 分钟），用户感知"超时"。这里内部重试：
  // 429 限流 / 5xx / 网络异常都值得重试；402（渠道余额不足）与 4xx 参数错误重试无意义。
  let lastCode: string | null = null
  let lastMessage = ''
  for (let attempt = 1; attempt <= 3; attempt++) {
    if (attempt > 1) {
      const backoff = attempt === 2 ? 1_000 : 3_000
      await new Promise((resolve) => setTimeout(resolve, backoff))
    }
    onProgress(`正在创建视频任务（第 ${attempt}/3 次尝试）…`)
    try {
      const resp = await metasoFetch(`${METASO_BASE}/v2/video_generation`, { method: 'POST', body }, 60_000)
      const text = await resp.text().catch(() => '')
      if (resp.ok) {
        const data = JSON.parse(text) as { task_id?: string }
        if (attempt > 1) console.log(`[videogen] create task ok on attempt ${attempt}`)
        return { taskId: String(data?.task_id ?? ''), status: 'pending' }
      }
      const { code, message } = extractErrorCode(resp.status, text)
      lastCode = code
      lastMessage = message
      const retriable = resp.status === 429 || resp.status >= 500
      console.log(`[videogen] create task failed attempt=${attempt}/3 http=${resp.status} code=${code} msg=${message.slice(0, 160)}${retriable ? ' (retry)' : ''}`)
      if (!retriable) {
        const err: VideoTaskInfo = { taskId: '', status: resp.status === 402 ? 'insufficient' : 'failed', errorCode: code, errorMessage: message }
        throw Object.assign(new Error(`视频任务创建失败（${code}: ${message.slice(0, 200)}）`), { taskInfo: err })
      }
    } catch (error) {
      const taskInfo = (error as { taskInfo?: VideoTaskInfo }).taskInfo
      if (taskInfo) throw error // 参数/余额类错误（非瞬时）直接抛出
      const msg = error instanceof Error ? error.message : String(error)
      lastCode = 'NETWORK_ERROR'
      lastMessage = msg
      console.log(`[videogen] create task network error attempt=${attempt}/3 (retry): ${msg.slice(0, 160)}`)
    }
  }
  const err: VideoTaskInfo = { taskId: '', status: 'failed', errorCode: lastCode ?? 'TASK_CREATE_FAILED', errorMessage: lastMessage || '创建视频任务失败（3 次尝试均失败）' }
  throw Object.assign(new Error(`视频任务创建失败（${err.errorCode}: ${(err.errorMessage ?? '').slice(0, 200)}）`), { taskInfo: err })
}

async function queryVideoTask(taskId: string): Promise<VideoTaskInfo> {
  const resp = await metasoFetch(`${METASO_BASE}/v2/query/video_generation/${encodeURIComponent(taskId)}`, { method: 'GET' }, 30_000)
  const text = await resp.text().catch(() => '')
  if (!resp.ok) {
    const { code, message } = extractErrorCode(resp.status, text)
    return { taskId, status: 'failed', errorCode: code, errorMessage: message }
  }
  const data = JSON.parse(text) as {
    task?: {
      id?: string
      status?: string
      content?: { url?: string }
      error?: { code?: string; message?: string }
      usage?: VideoTaskInfo['usage']
    }
  }
  const task = data?.task ?? {}
  return {
    taskId: String(task?.id ?? taskId),
    status: String(task?.status ?? 'pending'),
    url: task?.content?.url,
    errorCode: task?.error?.code ? String(task.error.code) : undefined,
    errorMessage: task?.error?.message ? String(task.error.message) : undefined,
    usage: task?.usage,
  }
}

/**
 * 生成视频并转存到工作区（agent/videos/）+ 全局公开目录。
 * 流程：可选 ContextIR 增强 → 创建任务 → 轮询（5s）→ 成功后下载 content.url → 落盘。
 */
export async function generateVideoAndSave(input: VideoGenInput & {
  /** 工作区根目录（getWorkspaceRoot(principal.key) 由调用方传入，避免循环依赖） */
  workspaceRoot: string
  /** 全局公开视频目录（默认 server/data/webos-public-videos） */
  publicDir?: string
}): Promise<VideoGenResult> {
  const startedAt = Date.now()
  const resolution: VideoResolution = input.resolution === '2K' ? '2K' : '768P'
  const duration = DURATIONS.some((d) => d === Number(input.duration)) ? Number(input.duration) : 4
  const ratio = (RATIOS as readonly string[]).includes(String(input.ratio ?? '')) ? String(input.ratio) : '16:9'
  const prompt = String(input.prompt ?? '').trim().slice(0, MAX_PROMPT_LENGTH)
  const imageCount = (input.firstFrameUrl ? 1 : 0) + (input.lastFrameUrl ? 1 : 0) + (input.referenceImages ?? []).length
  const timeoutMs = Math.min(15 * 60_000, Math.max(60_000, Number(input.timeoutMs) || TASK_TIMEOUT_MS))
  const onProgress = input.onProgress ?? (() => {})

  const fail = (status: VideoGenResult['status'], code: string, message: string): VideoGenResult => {
    // 2026-08-08：任何失败都落日志（此前只把 message 返回给 AI，pm2 里查不到）
    console.log(`[videogen] FAIL status=${status} code=${code} durationMs=${Date.now() - startedAt} msg=${message.slice(0, 200)}`)
    return {
      ok: false, path: null, url: null, posterUrl: null, enhancedPrompt: null, contextIRUsage: null,
      costUserMinor: 0, costMetasoMinor: 0, durationMs: Date.now() - startedAt,
      status, errorCode: code, errorMessage: message, imageCount,
    }
  }

  if (!prompt) return fail('failed', 'EMPTY_PROMPT', 'prompt 不能为空')

  try {
    // 1. H3-Context-IR 增强（默认开启；任何失败降级为原始提示词；真实 usage 返回供后台计费）
    let effectivePrompt = prompt
    let enhancedPrompt: string | null = null
    let contextIRUsage: VideoGenResult['contextIRUsage'] = null
    if (input.enhance !== false) {
      onProgress('正在用 H3-Context-IR 优化提示词…')
      const enhanced = await enhanceVideoPrompt({
        prompt, duration, ratio, firstFrameUrl: input.firstFrameUrl, lastFrameUrl: input.lastFrameUrl,
        referenceImages: input.referenceImages,
        // 2026-08-08：增强轮询期间也走进度回调（刷新 pi 活动计时，防止长轮询被 180s 空闲超时误杀）
        onProgress,
      })
      if (enhanced.prompt) {
        effectivePrompt = enhanced.prompt
        enhancedPrompt = enhanced.prompt
        contextIRUsage = enhanced.usage ?? null
        onProgress('提示词增强完成，正在创建视频任务…')
      } else {
        onProgress('提示词增强不可用（渠道未充值或超时），已降级为直接生成')
      }
    }

    // 2. 创建任务（402 → insufficient）
    let task: VideoTaskInfo
    try {
      task = await createVideoTask({
        prompt: effectivePrompt, resolution, duration, ratio,
        firstFrameUrl: input.firstFrameUrl, lastFrameUrl: input.lastFrameUrl,
        referenceImages: input.referenceImages,
        onProgress,
      })
    } catch (error) {
      const taskInfo = (error as { taskInfo?: VideoTaskInfo }).taskInfo
      if (taskInfo?.status === 'insufficient') {
        return fail('insufficient', 'VIDEO_BALANCE_INSUFFICIENT', '秘塔视频渠道余额不足，请联系站长充值')
      }
      return fail('failed', taskInfo?.errorCode ?? 'TASK_CREATE_FAILED', taskInfo?.errorMessage ?? (error instanceof Error ? error.message : String(error)))
    }
    if (!task.taskId) return fail('failed', 'NO_TASK_ID', '视频任务创建失败（未返回 task_id）')

    // 3. 轮询
    const deadline = Date.now() + timeoutMs
    let lastStatus = 'pending'
    onProgress(`视频任务已创建（${resolution} ${duration} 秒），等待生成…`)
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS))
      const info = await queryVideoTask(task.taskId)
      lastStatus = info.status
      if (info.status === 'succeeded') {
        task = info
        break
      }
      if (info.status === 'failed') {
        return fail('failed', info.errorCode ?? 'TASK_FAILED', info.errorMessage ?? '视频生成失败（内容可能违规）')
      }
      if (info.status === 'canceled' || info.status === 'deleted') {
        return fail('failed', 'TASK_CANCELED', '视频任务已取消')
      }
      onProgress(`视频生成中（${info.status}）…已等待 ${Math.round((Date.now() - startedAt) / 1000)} 秒`)
    }
    if (lastStatus !== 'succeeded' || !task.url) {
      return fail('timeout', 'TASK_TIMEOUT', '视频生成超时（10 分钟），请稍后重试')
    }

    // 4. 下载视频（content.url 有时效，立即转存）
    onProgress('视频生成完成，正在下载…')
    const videoResp = await fetch(task.url, { signal: AbortSignal.timeout(180_000) })
    if (!videoResp.ok) return fail('failed', 'DOWNLOAD_FAILED', `视频下载失败（HTTP ${videoResp.status}）`)
    const videoBuf = Buffer.from(await videoResp.arrayBuffer())
    if (videoBuf.length < 1024) return fail('failed', 'EMPTY_VIDEO', '视频文件为空')

    // 5. 落盘：工作区（默认 agent/videos/，outputDir 可指定）+ 全局公开目录（App iframe 免鉴权加载）
    const name = `video-${randomUUID().slice(0, 8)}-${Date.now().toString(36)}.mp4`
    const relDir = (input.outputDir && input.outputDir.trim()) ? input.outputDir.trim().replace(/^\/+/, '') : 'agent/videos'
    const wsDir = path.join(input.workspaceRoot, relDir)
    fs.mkdirSync(wsDir, { recursive: true })
    const wsFull = path.join(wsDir, name)
    fs.writeFileSync(wsFull, videoBuf)
    const pubDir = input.publicDir ?? path.join(process.cwd(), 'data', 'webos-public-videos')
    fs.mkdirSync(pubDir, { recursive: true })
    fs.writeFileSync(path.join(pubDir, name), videoBuf)

    // 6. 首帧封面（poster，2026-08-06 低带宽优化）：ffmpeg 抽首帧 jpg（几十 KB），
    //    App 里 <video poster> 秒开预览画面，点击/滚动到再加载视频本体
    let posterUrl: string | null = null
    try {
      const posterName = name.replace(/\.mp4$/, '.jpg')
      const publicImagesDir = path.join(process.cwd(), 'data', 'webos-public-images')
      fs.mkdirSync(publicImagesDir, { recursive: true })
      const posterFull = path.join(publicImagesDir, posterName)
      const { execFile } = await import('node:child_process')
      await new Promise<void>((resolve, reject) => {
        execFile('ffmpeg', ['-y', '-v', 'error', '-i', wsFull, '-frames:v', '1', '-q:v', '4', posterFull], { maxBuffer: 32 * 1024 * 1024 }, (error) => (error ? reject(error) : resolve()))
      })
      if (fs.existsSync(posterFull) && fs.statSync(posterFull).size > 0) {
        posterUrl = `/webos/api/imagegen/file/${posterName}`
      }
    } catch { /* poster 生成失败不阻断（视频本身可用） */ }

    return {
      ok: true,
      path: `${relDir}/${name}`,
      url: `/webos/api/videogen/file/${name}`,
      posterUrl,
      enhancedPrompt,
      contextIRUsage,
      costUserMinor: videoCostMinor({ resolution, seconds: duration, imageCount }),
      costMetasoMinor: videoMetasoCostMinor({ resolution, seconds: duration, imageCount }),
      durationMs: Date.now() - startedAt,
      status: 'ok',
      taskId: task.taskId,
      imageCount,
    }
  } catch (error) {
    return fail('failed', 'UPSTREAM_ERROR', error instanceof Error ? error.message.slice(0, 300) : String(error))
  }
}

// ---------------------------------------------------------------------------
// 3. 用量落库（webos_video_usage）+ 充值记录（webos_video_recharges）
// ---------------------------------------------------------------------------

export interface RecordVideoUsageInput {
  userKey: string
  userEmail: string | null
  kind: 'guest' | 'member' | 'plan'
  resolution: VideoResolution
  duration: number
  imageCount: number
  enhance: boolean
  prompt: string
  taskType?: 'generation' | 'h3_context_ir' | 'video_edit'
  taskId?: string
  videoPath?: string | null
  costUserMinor: number
  costMetasoMinor: number
  status: 'ok' | 'failed' | 'timeout' | 'insufficient' | 'rejected'
  errorCode?: string
  /** 2026-08-08：失败/降级详情（渠道原始 message；此前不落库，排查只能靠猜） */
  errorMessage?: string
  durationMs: number
  ip?: string
}

export async function recordVideoUsage(input: RecordVideoUsageInput): Promise<void> {
  try {
    const pool = getPool()
    await pool.query(
      `INSERT INTO webos_video_usage
        (id, user_key, user_email, kind, model, task_type, resolution, duration, image_count, enhance,
         prompt, task_id, video_path, cost_user_minor, cost_metaso_minor, status, error_code, error_message, duration_ms, ip, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)`,
      [
        `vid-${randomUUID()}`,
        input.userKey,
        input.userEmail,
        input.kind,
        'MiniMax-H3',
        input.taskType ?? 'generation',
        input.resolution,
        input.duration,
        input.imageCount,
        input.enhance ? 1 : 0,
        String(input.prompt ?? '').slice(0, 500),
        input.taskId ?? null,
        input.videoPath ?? null,
        input.costUserMinor,
        input.costMetasoMinor,
        input.status,
        input.errorCode ?? null,
        input.errorMessage ? String(input.errorMessage).slice(0, 500) : null,
        input.durationMs,
        input.ip ?? null,
        Date.now(),
      ],
    )
  } catch (error) {
    console.warn('[videogen] recordVideoUsage failed:', error instanceof Error ? error.message : String(error))
  }
}

/** 记录一次渠道充值（站长在秘塔账户充值后登记；失败不阻断） */
export async function recordVideoRecharge(amountMinor: number, note?: string): Promise<boolean> {
  try {
    const pool = getPool()
    await pool.query(
      'INSERT INTO webos_video_recharges (id, amount_minor, note, created_at) VALUES ($1,$2,$3,$4)',
      [`rec-${randomUUID()}`, Math.round(amountMinor), note ? String(note).slice(0, 200) : null, Date.now()],
    )
    return true
  } catch (error) {
    console.warn('[videogen] recordVideoRecharge failed:', error instanceof Error ? error.message : String(error))
    return false
  }
}

/** 渠道统计：充值总额 / 已消耗（按秘塔价）/ 结余（分）。消耗含全部状态（失败任务不产生成本但留痕） */
export async function videoChannelStats(): Promise<{
  rechargedMinor: number
  spentMinor: number
  balanceMinor: number
  taskCount: number
  okCount: number
}> {
  try {
    const pool = getPool()
    const recharged = await pool.query('SELECT COALESCE(SUM(amount_minor), 0) AS total FROM webos_video_recharges')
    const spent = await pool.query('SELECT COALESCE(SUM(cost_metaso_minor), 0) AS total FROM webos_video_usage WHERE status = \'ok\'')
    const count = await pool.query('SELECT COUNT(*) AS n, COALESCE(SUM(CASE WHEN status = \'ok\' THEN 1 ELSE 0 END), 0) AS ok FROM webos_video_usage')
    const rechargedMinor = Number(recharged.rows[0]?.total ?? 0)
    const spentMinor = Number(spent.rows[0]?.total ?? 0)
    return {
      rechargedMinor,
      spentMinor,
      balanceMinor: rechargedMinor - spentMinor,
      taskCount: Number(count.rows[0]?.n ?? 0),
      okCount: Number(count.rows[0]?.ok ?? 0),
    }
  } catch (error) {
    console.warn('[videogen] videoChannelStats failed:', error instanceof Error ? error.message : String(error))
    return { rechargedMinor: 0, spentMinor: 0, balanceMinor: 0, taskCount: 0, okCount: 0 }
  }
}
