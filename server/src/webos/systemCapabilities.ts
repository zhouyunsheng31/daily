// server/src/webos/systemCapabilities.ts —— W4 系统能力包 + 调用者计费（R15）
// ----------------------------------------------------------------------------
// 依据：docs/routes/web/06-billing.md §3.5（R15「系统能力包 · 调用者计费租户」）：
//   - W4 把生图/视频/对话/搜索平台能力封装为「系统能力包」（com.daily.* 声明制，
//     统一计费目录）；封装系统 API 的 App 自动链接到调用者自己的账号；
//   - 计费租户 = 调用者账号（实际触发者 callerKey）：任何触发（App 运行时 /
//     public 端点 / Agent 会话）的积分一律从实际触发者扣，绝不从包属主账号扣；
//   - 积分余额不足抛 INSUFFICIENT_CREDITS（调用方明确失败）；
//   - secrets（API key）绝不下发客户端：只在本模块服务端沙箱内使用（调用方只
//     拿到执行结果，拿不到密钥）。
// 组成：
//   - SYSTEM_CAPABILITY_PACKAGES：生图 / 搜索 / LLM 对话 的能力包声明
//     （id/type=provider 或 api + 端点 + 计费目录 kind），包体即本文件内
//     服务端函数句柄（execute），不落客户端；
//   - BILLING_CATALOG：统一计费目录（chat/image/search/video/api；与
//     billing/pricing.ts BILLING_TABLE 同源、值为积分/次或定价说明）；
//   - chargeCaller：核心计费原语（R15 硬约束落地）。
// ============================================================================

import { getPool } from '../db/connection.js'
import { generateImages, IMAGE_PRICING, type GenerateImageResult } from '../imagegen/chatstImage.js'
import { callLlm, type LlmMessage, type LlmCallOptions } from '../utils/llmCaller.js'
import { searchTools, withSearchUser } from '../utils/searchTools.js'
import { fixedCostMinor, chatCostMinor } from '../billing/pricing.js'

// ---------------------------------------------------------------------------
// R15 计费错误
// ---------------------------------------------------------------------------

/** 积分不足（chargeCaller 明确抛错，调用方捕获后按 402 语义返回） */
export class InsufficientCreditsError extends Error {
  code = 'INSUFFICIENT_CREDITS' as const
  constructor(message = '积分不足，无法执行该能力（请先获取额度）') {
    super(message)
    this.name = 'InsufficientCreditsError'
  }
}

/** secrets 服务端专用错误（任何路径都不应把密钥值带到响应/日志明文） */
export class SecretsLeakError extends Error {
  code = 'SECRETS_LEAK' as const
  constructor(message = '系统能力密钥不得下发到客户端') {
    super(message)
    this.name = 'SecretsLeakError'
  }
}

// ---------------------------------------------------------------------------
// 计费目录（BillingKind 同型；BILLING_TABLE 的包化视图，供 bootstrap/管理端展示）
// ---------------------------------------------------------------------------

export type SystemCapabilityKind = 'image' | 'search' | 'chat' | 'video' | 'api'

export interface BillingCatalogItem {
  kind: SystemCapabilityKind
  label: string
  model: string
  unit: string
  /** 单价说明（积分/次 或 元/百万 token 折算积分） */
  priceNote: string
  /** 最小积分单价（积分/次固定价；token 类能力为 0 = 按用量） */
  fixedMinor?: number
}

/** 统一计费目录（R15：系统能力包消费方看到的统一价格） */
export const BILLING_CATALOG: BillingCatalogItem[] = [
  { kind: 'image', label: 'AI 生图', model: IMAGE_PRICING.model, unit: '次', priceNote: '按 token 用量计费（售价 ¥24/¥90 每百万）' },
  { kind: 'search', label: 'AI 搜索', model: 'web_search', unit: '次', priceNote: '固定 ¥0.08/次（8 积分）', fixedMinor: 8 },
  { kind: 'chat', label: 'AI 对话', model: 'deepseek-v4-flash', unit: '次', priceNote: '按 token 用量计费（高峰 ×2）' },
  { kind: 'video', label: 'AI 视频', model: 'MiniMax-H3', unit: '秒', priceNote: '官方刊例半价 ¥0.40-0.25/秒' },
  { kind: 'api', label: 'App API 调用', model: 'appapi', unit: '次', priceNote: '固定 ¥0.01/次（1 积分）', fixedMinor: fixedCostMinor('api', 1) },
]

/** kind → 固定单价（积分；无固定价返回 0） */
export function fixedMinorOf(kind: SystemCapabilityKind): number {
  const item = BILLING_CATALOG.find((c) => c.kind === kind)
  return item?.fixedMinor ?? 0
}

// ---------------------------------------------------------------------------
// 系统能力包声明（id/type + 端点 + 计费 kind + 服务端执行句柄）
// ---------------------------------------------------------------------------

export interface SystemCapabilityPackage {
  id: string
  type: 'api' | 'provider'
  displayName: string
  description: string
  /** 统一计费目录 kind（R15 计费租户 = 调用者） */
  billingKind: SystemCapabilityKind
  /** 端点声明（REST 形态；type=provider 时为能力名） */
  endpoints: Array<{ name: string; method: 'POST' | 'GET'; path: string; billingKind: SystemCapabilityKind }>
  /** secrets 声明（只读字段名；绝不把值下发客户端） */
  secrets: string[]
}

export const SYSTEM_CAPABILITY_PACKAGES: SystemCapabilityPackage[] = [
  {
    id: 'com.daily.cap.image',
    type: 'provider',
    displayName: '系统生图',
    description: 'ChatST gpt-image-2-super 图像生成（服务端密钥，调用者计费）',
    billingKind: 'image',
    endpoints: [{ name: 'generate_images', method: 'POST', path: '/image/generate', billingKind: 'image' }],
    secrets: ['CHATST_IMAGE_API_KEY'],
  },
  {
    id: 'com.daily.cap.search',
    type: 'provider',
    displayName: '系统搜索',
    description: 'Exa 网页搜索 / 摘要 / 相似检索（服务端密钥，调用者计费）',
    billingKind: 'search',
    endpoints: [{ name: 'web_search', method: 'POST', path: '/search/web', billingKind: 'search' }],
    secrets: ['EXA_API_KEY'],
  },
  {
    id: 'com.daily.cap.chat',
    type: 'provider',
    displayName: '系统对话',
    description: '服务端 LLM 对话（deepseek-v4-flash，按 token 用量调用者计费）',
    billingKind: 'chat',
    endpoints: [{ name: 'chat_completions', method: 'POST', path: '/chat/completions', billingKind: 'chat' }],
    secrets: ['PI_API_KEY'],
  },
]

// ---------------------------------------------------------------------------
// 调用者积分账本（entities type=webos_state，与 webos.ts loadState 同实体；
// systemCapabilities 不依赖 webos.ts 内部类型，最小化 credits 结构读写）
// ---------------------------------------------------------------------------

export interface CallerCreditsState {
  credits?: {
    quota?: number
    used?: number
    monthly?: { quota?: number; used?: number; expiresAt?: number } | null
    permanent?: { quota?: number; used?: number }
  }
}

const STATE_ENTITY_PREFIX = 'webos-state'

function stateEntityId(callerKey: string): string {
  const safe = String(callerKey ?? '').replace(/[^\w.:-]/g, '_')
  return `${STATE_ENTITY_PREFIX}:${safe}`
}

/** 读取调用者积分状态（无则返回空账本；失败返回 null → 调用方按不足处理） */
export async function loadCallerState(callerKey: string): Promise<CallerCreditsState | null> {
  try {
    const pool = getPool()
    const r = await pool.query(`SELECT data FROM entities WHERE id=$1 AND type='webos_state'`, [stateEntityId(callerKey)])
    const raw = r.rows?.[0]?.data
    if (!raw) return {}
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw
    return (parsed && typeof parsed === 'object') ? parsed as CallerCreditsState : {}
  } catch (error) {
    console.warn('[systemCapabilities] loadCallerState failed:', error instanceof Error ? error.message : String(error))
    return null
  }
}

/** 保存调用者积分状态（失败不阻断主流程，但扣费已发生 → 尽力落库） */
export async function saveCallerState(callerKey: string, state: CallerCreditsState): Promise<void> {
  try {
    const pool = getPool()
    const now = Date.now()
    await pool.query(
      `INSERT INTO entities (id, type, scope, data, record_status, version, created_at, updated_at)
       VALUES ($1,'webos_state',$2,$3,'active',1,$4,$4)
       ON CONFLICT (id) DO UPDATE SET data=EXCLUDED.data, updated_at=EXCLUDED.updated_at`,
      [stateEntityId(callerKey), callerKey, JSON.stringify(state), now],
    )
  } catch (error) {
    console.warn('[systemCapabilities] saveCallerState failed:', error instanceof Error ? error.message : String(error))
  }
}

/** 剩余积分 = 常规额度剩余 + 永久池剩余（与 webos.ts remainingCredits 语义一致） */
export function callerRemaining(state: CallerCreditsState): number {
  const credits = state.credits ?? {}
  const base = Math.max(0, Math.round(credits.quota ?? 0) - Math.round(credits.used ?? 0))
  const perm = credits.permanent
    ? Math.max(0, Math.round(credits.permanent.quota ?? 0) - Math.round(credits.permanent.used ?? 0))
    : 0
  return base + perm
}

/** 实际扣减调用者积分（先常规额度再永久池；与 webos.ts chargeCredits 同语义） */
export function chargeCallerCredits(state: CallerCreditsState, costMinor: number): number {
  let remainingCost = Math.max(0, Math.round(costMinor))
  if (remainingCost === 0) return 0
  const credits = state.credits ?? {}
  const baseRemaining = Math.max(0, Math.round(credits.quota ?? 0) - Math.round(credits.used ?? 0))
  const fromBase = Math.min(baseRemaining, remainingCost)
  credits.used = Math.round(credits.used ?? 0) + fromBase
  remainingCost -= fromBase
  if (remainingCost > 0 && credits.permanent) {
    const permRemaining = Math.max(0, Math.round(credits.permanent.quota ?? 0) - Math.round(credits.permanent.used ?? 0))
    const fromPerm = Math.min(permRemaining, remainingCost)
    credits.permanent.used = Math.round(credits.permanent.used ?? 0) + fromPerm
    remainingCost -= fromPerm
  }
  state.credits = credits
  return Math.max(0, Math.round(costMinor)) - remainingCost
}

// ---------------------------------------------------------------------------
// chargeCaller：R15 计费租户核心原语
// ---------------------------------------------------------------------------

export interface ChargeDeps {
  /** 积分读写（默认走 entities 表；测试可注入内存 mock） */
  loadState?: (callerKey: string) => Promise<CallerCreditsState | null>
  saveState?: (callerKey: string, state: CallerCreditsState) => Promise<void>
}

let chargeDeps: ChargeDeps | null = null

/** 注入计费依赖（测试或宿主在启动时调用；默认实现读写 entities 表） */
export function setChargeDeps(injected: ChargeDeps): void {
  chargeDeps = injected
}

/**
 * 调用者计费（R15 硬约束）：
 *   - 计费租户 = 实际调用者 callerKey（调用方传入），绝不从包属主账号扣；
 *   - costMinor > 0 且余额不足 → 抛 InsufficientCreditsError（不扣、不改账本）；
 *   - 扣费成功后返回实际扣减积分。
 * 属主账号保护：本函数只接受 callerKey 作为租户；若调用方误传 ownerKey，
 * 属主账本也不会被触碰（本函数从不读取属主 state）。
 */
export async function chargeCaller(callerKey: string, kind: SystemCapabilityKind, costMinor: number, deps?: ChargeDeps): Promise<number> {
  const d = deps ?? chargeDeps ?? {}
  const load = d.loadState ?? loadCallerState
  const save = d.saveState ?? saveCallerState
  const minor = Math.max(0, Math.round(costMinor))

  if (minor === 0) return 0

  const state = await load(callerKey)
  if (!state) throw new InsufficientCreditsError(`积分账本不可读（${callerKey.slice(0, 12)}）`)
  const before = callerRemaining(state)
  if (before < minor) {
    throw new InsufficientCreditsError(`积分不足：本次「${kind}」需 ${minor} 积分，剩余 ${before} 积分`)
  }
  const charged = chargeCallerCredits(state, minor)
  await save(callerKey, state)
  console.log(`[systemCapabilities] chargeCaller kind=${kind} caller=${callerKey.slice(0, 16)} cost=${minor} charged=${charged}`)
  return charged
}

// ---------------------------------------------------------------------------
// 系统能力包服务端执行句柄（secrets 只在服务端使用，绝不下发）
// ---------------------------------------------------------------------------

/** 生图能力（secrets 服务端读取，调用者计费）；返回结果不含任何密钥 */
export async function runImageGeneration(callerKey: string, input: { prompt: string; n?: number; size?: string }, deps?: ChargeDeps): Promise<GenerateImageResult> {
  const result = await generateImages({ prompt: input.prompt, n: input.n ?? 1, size: input.size })
  if (!result.ok || result.costMinor <= 0) return result
  try {
    await chargeCaller(callerKey, 'image', result.costMinor, deps)
  } catch (error) {
    if (error instanceof InsufficientCreditsError) {
      return {
        ...result,
        ok: false,
        status: 'failed',
        errorCode: 'INSUFFICIENT_CREDITS',
        errorMessage: error.message,
        images: [],
      }
    }
    throw error
  }
  return result
}

/** 搜索能力（secrets 服务端读取；调用者计费固定 8 积分/次） */
export async function runWebSearch(callerKey: string, query: string, deps?: ChargeDeps): Promise<{ ok: boolean; results: unknown[]; errorCode?: string; errorMessage?: string }> {
  const cost = Math.max(1, fixedMinorOf('search'))
  await chargeCaller(callerKey, 'search', cost, deps)
  try {
    return await withSearchUser(callerKey, async () => {
      // 复用平台搜索工具定义（服务端直连 Exa；工具自身落 logApiUsage）
      const tool = searchTools.find((t) => t.name === 'web_search')
      if (!tool) return { ok: false, results: [], errorCode: 'SEARCH_TOOL_MISSING', errorMessage: 'web_search 工具未注册' }
      const r = await tool.execute('system-capability-search', { query }, undefined, undefined, {
        ui: {} as never,
        mode: 'tui' as never,
        hasUI: false,
        cwd: process.cwd(),
        sessionManager: {} as never,
        modelRegistry: {} as never,
        model: undefined,
        isIdle: () => true,
        isProjectTrusted: () => false,
        signal: undefined,
        abort: () => {},
        hasPendingMessages: () => false,
        shutdown: () => {},
        getContextUsage: () => undefined,
        compact: () => {},
        getSystemPrompt: () => '',
      })
      const text = r.content?.[0]?.type === 'text' ? r.content[0].text : ''
      let parsed: { success?: boolean; results?: unknown[]; error?: string; message?: string } = {}
      try { parsed = JSON.parse(text) } catch { /* 非 JSON 响应按原始文本 */ }
      if (parsed.success === false) {
        return { ok: false, results: [], errorCode: parsed.error ?? 'SEARCH_FAILED', errorMessage: parsed.message ?? '搜索失败' }
      }
      return { ok: true, results: (parsed.results ?? []) as unknown[] }
    })
  } catch (error) {
    if (error instanceof InsufficientCreditsError) throw error
    return { ok: false, results: [], errorCode: 'SEARCH_FAILED', errorMessage: error instanceof Error ? error.message : String(error) }
  }
}

/** LLM 对话能力（secrets 服务端读取；按 token 用量调用者计费） */
export async function runLlmChat(callerKey: string, input: { messages: LlmMessage[]; options?: LlmCallOptions }, deps?: ChargeDeps): Promise<{ ok: boolean; text?: string; costMinor?: number; errorCode?: string; errorMessage?: string }> {
  const start = Date.now()
  const text = await callLlm(input.messages, input.options)
  // 按估算 token 计费（真实 usage 由 pi 会话落库；系统能力包场景用常数估算回退）
  const promptChars = (input.messages ?? []).reduce((n, m) => n + String(m.content ?? '').length, 0)
  const outputBudget = 800
  const costMinor = Math.max(1, chatCostMinor({ promptTokens: Math.ceil(promptChars / 4), completionTokens: outputBudget }))
  await chargeCaller(callerKey, 'chat', costMinor, deps)
  return { ok: true, text, costMinor, errorCode: undefined, errorMessage: undefined, ...(process.env.NODE_ENV === 'test' ? { durationMs: Date.now() - start } : {}) }
}

/** 系统能力包执行路由（声明制端点 → 服务端句柄；secrets 不下发） */
export async function invokeSystemCapability(
  packageId: string,
  endpointName: string,
  callerKey: string,
  params: Record<string, unknown>,
  deps?: ChargeDeps,
): Promise<{ ok: boolean; value?: unknown; costMinor?: number; errorCode?: string; errorMessage?: string }> {
  const cap = SYSTEM_CAPABILITY_PACKAGES.find((c) => c.id === packageId)
  if (!cap) return { ok: false, errorCode: 'CAPABILITY_NOT_FOUND', errorMessage: `系统能力包「${packageId}」不存在` }
  const ep = cap.endpoints.find((e) => e.name === endpointName)
  if (!ep) return { ok: false, errorCode: 'ENDPOINT_NOT_FOUND', errorMessage: `端点「${endpointName}」不存在` }

  if (packageId === 'com.daily.cap.image') {
    const r = await runImageGeneration(callerKey, { prompt: String(params.prompt ?? ''), n: typeof params.n === 'number' ? params.n : undefined, size: typeof params.size === 'string' ? params.size : undefined }, deps)
    return { ok: r.ok, value: { images: r.images.map((b) => b.toString('base64')), costMinor: r.costMinor }, costMinor: r.costMinor, errorCode: r.errorCode, errorMessage: r.errorMessage }
  }
  if (packageId === 'com.daily.cap.search') {
    const r = await runWebSearch(callerKey, String(params.query ?? ''), deps)
    return { ok: r.ok, value: { results: r.results }, costMinor: r.ok ? fixedMinorOf('search') : 0, errorCode: r.errorCode, errorMessage: r.errorMessage }
  }
  if (packageId === 'com.daily.cap.chat') {
    const r = await runLlmChat(callerKey, { messages: (params.messages ?? []) as LlmMessage[], options: params.options as LlmCallOptions | undefined }, deps)
    return { ok: r.ok, value: { text: r.text }, costMinor: r.costMinor, errorCode: r.errorCode, errorMessage: r.errorMessage }
  }
  return { ok: false, errorCode: 'UNSUPPORTED', errorMessage: `系统能力包「${packageId}」未实现` }
}