// ============================================================================
// 统一计费模块（2026-08-02 积分制）
// ----------------------------------------------------------------------------
// 背景：不同 AI 能力的 token 价值差异巨大（DeepSeek 对话 ~¥1/百万 vs
// gpt-image-2-super 生图 ¥16/¥60 每百万），单一 token 池会被贵模型白嫖。
// 方案：**积分制** —— 1 积分 = ¥0.01（1 分钱）。所有能力按真实人民币成本
// × 售价倍率 折算成积分扣减；token 仅作消耗明细展示，不再直接当钱。
//
// 定价表（售价，元/百万 token 或 元/单位）：
// - 对话 deepseek-v4-flash：成本 输入¥1 / 输出¥2（缓存命中 ¥0.02），
//   售价 = 成本 × CHAT_SALES_RATIO（2026-08-13 调价：1.5 → 2.0，毛利 50%）；
//   DeepSeek 官方峰谷定价：北京时间 9:00-12:00 与 14:00-18:00 价格 ×2（适用所有计费项）
// - 生图 gpt-image-2-super：成本 输入¥16 / 输出¥60，售价 ×1.5（见 chatstImage.ts
//   IMAGE_PRICING = 24/90，本表仅作 catalog 展示用，保持成本价供运营参考）
// - 搜索：成本 ¥0.03/次，售价 ¥0.05/次（毛利 40%）
// - 预留：tts（字符）——未来能力接入时在此扩展
// ============================================================================

/** 统一计费项（新增能力在此注册，管理后台/前端自动展示） */
export type BillingKind = 'chat' | 'image' | 'search' | 'video' | 'tts' | 'api'

export interface BillingItem {
  kind: BillingKind
  label: string
  model: string
  /** 计价单位描述（展示用） */
  unitLabel: string
  /** 输入单价（元/百万 token；search/tts 场景可不用） */
  inputPerMillion: number
  /** 输出单价（元/百万 token） */
  outputPerMillion: number
  /** 缓存命中单价（元/百万 token；无缓存概念为 0） */
  cacheHitPerMillion: number
  /** 固定单价（元/次 或 元/千字符；按 unitLabel 展示） */
  fixedPrice?: number
  /** 高峰时段倍率（DeepSeek 官方 2 倍；无峰谷的渠道为 1） */
  peakMultiplier: number
  /** 是否按「成本 × 售价倍率」计价（true=成本制；false=fixedPrice/直接售价） */
  costBased: boolean
}

/** 售价倍率：对话按 DeepSeek 成本 × 2.0 出售（毛利 50%；高峰再 ×2） */
export const CHAT_SALES_RATIO = 2.0

export const BILLING_TABLE: BillingItem[] = [
  {
    kind: 'chat',
    label: 'AI 对话',
    model: 'deepseek-v4-flash',
    unitLabel: '元 / 百万 token',
    // 官方成本：输入(缓存未命中)¥1、输出¥2、缓存命中 ¥0.02（2026-08-02 查证）
    inputPerMillion: 1,
    outputPerMillion: 2,
    cacheHitPerMillion: 0.02,
    peakMultiplier: 2, // DeepSeek 官方峰谷：北京时间 9:00-12:00 / 14:00-18:00 ×2
    costBased: true,
  },
  {
    kind: 'image',
    label: 'AI 生图',
    model: 'gpt-image-2-super',
    unitLabel: '元 / 百万 token',
    // 2026-08-13 调价：售价 = 渠道成本（¥16/¥60）× 1.5（毛利 50%）
    inputPerMillion: 24,
    outputPerMillion: 90,
    cacheHitPerMillion: 0,
    peakMultiplier: 1, // ChatST 渠道无峰谷
    costBased: false, // 直接按售价（用户定价）
  },
  {
    kind: 'search',
    label: 'AI 搜索',
    model: 'web_search',
    unitLabel: '元 / 次',
    inputPerMillion: 0,
    outputPerMillion: 0,
    cacheHitPerMillion: 0,
    // 2026-08-17 供应商替换：Exa（$7/1k 搜索 ≈ ¥0.05/次；含 summary/contents 成本更高，估值 ¥0.07）
    // 2026-08-13 调价：售价 0.08/次（覆盖 Exa 成本，毛利约 30-60%）
    fixedPrice: 0.08,
    peakMultiplier: 1,
    costBased: false,
  },
  {
    kind: 'video',
    label: 'AI 视频',
    model: 'MiniMax-H3',
    unitLabel: '元 / 秒',
    inputPerMillion: 0,
    outputPerMillion: 0,
    cacheHitPerMillion: 0,
    // 用户按 MiniMax 官方刊例价计费：2K ¥0.80/秒、768P ¥0.50/秒（具体由 videoCostMinor 按分辨率计算）
    fixedPrice: 0.5,
    peakMultiplier: 1,
    costBased: false,
  },
  {
    kind: 'tts',
    label: '语音合成',
    model: 'tts',
    unitLabel: '元 / 千字符',
    inputPerMillion: 0,
    outputPerMillion: 0,
    cacheHitPerMillion: 0,
    fixedPrice: 0.5,
    peakMultiplier: 1,
    costBased: false,
  },
  {
    kind: 'api',
    label: 'App API 调用',
    model: 'appapi',
    unitLabel: '元 / 次',
    inputPerMillion: 0,
    outputPerMillion: 0,
    cacheHitPerMillion: 0,
    // 2026-08-21（W2）固定微价/次：1 积分 = ¥0.01（覆盖服务端受限 vm 执行 + storage/审计成本）
    fixedPrice: 0.01,
    peakMultiplier: 1,
    costBased: false,
  },
]

export function billingItem(kind: BillingKind, model?: string): BillingItem {
  return BILLING_TABLE.find((item) => item.kind === kind && (!model || item.model === model))
    ?? BILLING_TABLE.find((item) => item.kind === kind)
    ?? BILLING_TABLE[0]
}

// ---------------------------------------------------------------------------
// DeepSeek 峰谷定价：北京时间 9:00-12:00 与 14:00-18:00（官方定义）
// ---------------------------------------------------------------------------

/** 是否处于 DeepSeek 高峰时段（服务器任意时区：换算到北京时间 UTC+8）
 * 官方规则（2026-06 公告、7 月中旬实施）：**工作日**（周一~周五）9:00-12:00 与 14:00-18:00 价格 ×2；
 * 凌晨 00:30-08:30、周末及法定节假日为平峰原价。
 * 2026-08-06 修复：原实现只判断时段未判断工作日，周末/节假日被误收高峰价。 */
export function isDeepSeekPeak(now: Date = new Date()): boolean {
  // 北京时间 = UTC + 8
  const beijing = new Date(now.getTime() + 8 * 3600_000)
  const hour = beijing.getUTCHours()
  const day = beijing.getUTCDay() // 0=周日 6=周六
  if (day === 0 || day === 6) return false // 周末平峰
  return (hour >= 9 && hour < 12) || (hour >= 14 && hour < 18)
}

/** 当前 DeepSeek 高峰倍率（2 或 1） */
export function deepSeekPeakMultiplier(now: Date = new Date()): number {
  return isDeepSeekPeak(now) ? 2 : 1
}

// ---------------------------------------------------------------------------
// 计费计算
// ---------------------------------------------------------------------------

export interface ChatBillingInput {
  promptTokens: number
  completionTokens: number
  /** 缓存命中的输入 token（可从 usage.cached_tokens 或 input_tokens_details 提取） */
  cacheReadTokens?: number
  /** 高峰期强制计算（默认按当前时间判断） */
  peak?: boolean
}

/**
 * 对话计费（deepseek-v4-flash）：
 * 成本 = 输入×1 + 输出×2 + 缓存命中×0.02（元/百万）→ 售价 = 成本 × 1.5 × 高峰倍率
 * 返回金额（分，即积分）。成本为 0 时返回 0（不计费场景由调用方处理）。
 */
export function chatCostMinor(input: ChatBillingInput): number {
  const item = billingItem('chat')
  const ratio = item.costBased ? CHAT_SALES_RATIO : 1
  const peak = input.peak ?? isDeepSeekPeak()
  const peakMul = peak ? item.peakMultiplier : 1
  const cacheRead = Math.max(0, Math.min(input.cacheReadTokens ?? 0, input.promptTokens))
  const missInput = Math.max(0, input.promptTokens - cacheRead)
  const costYuan = (missInput / 1_000_000) * item.inputPerMillion
    + (input.completionTokens / 1_000_000) * item.outputPerMillion
    + (cacheRead / 1_000_000) * item.cacheHitPerMillion
  return Math.round(costYuan * ratio * peakMul * 100)
}

/**
 * 生图计费（gpt-image-2-super）：输入 ¥16 / 输出 ¥60 每百万（直接售价）
 * 返回金额（分）。token 为 0（上游无 usage）时由调用方按张数估算兜底。
 */
export function imageCostMinor(input: { inputTokens: number; outputTokens: number }): number {
  const item = billingItem('image')
  const costYuan = (input.inputTokens / 1_000_000) * item.inputPerMillion
    + (input.outputTokens / 1_000_000) * item.outputPerMillion
  return Math.round(costYuan * 100)
}

/** 固定单价计费（搜索/次、TTS/千字符等），返回金额（分） */
export function fixedCostMinor(kind: BillingKind, units: number): number {
  const item = billingItem(kind)
  return Math.round((item.fixedPrice ?? 0) * units * 100)
}

// ---------------------------------------------------------------------------
// 视频计费（2026-08-05，MiniMax-H3）
// - 用户扣费按 **MiniMax 官方刊例价 × 0.5（半价，2026-08-06 用户决策）**：
//   2K ¥0.40/秒、768P ¥0.25/秒（4 秒 768P = 100 积分；此前全价 200 积分太贵）
// - 后台成本统计按 **秘塔渠道价**：2K ¥0.15/秒、768P ¥0.09/秒（见 videogen/minimaxVideo.ts）
// 图片输入素材：官方 5 张内免费、超出 ¥0.20/张（用户按半价 ¥0.10/张）；秘塔超出 ¥0.05/张
// ---------------------------------------------------------------------------

export const VIDEO_OFFICIAL_PRICE = { '2K': 0.8, '768P': 0.5 } as const
export const VIDEO_METASO_PRICE = { '2K': 0.15, '768P': 0.09 } as const
/** 用户售价倍率（2026-08-06 用户决策：官方价打 5 折——成本 ~0.36 元/4s，售价 1 元/4s 合理） */
export const VIDEO_USER_RATIO = 0.5
export const VIDEO_OFFICIAL_IMAGE_PRICE = 0.2 // 元/张（超出 5 张）
export const VIDEO_METASO_IMAGE_PRICE = 0.05 // 元/张（超出 5 张）
export const VIDEO_FREE_IMAGE_COUNT = 5

export type VideoResolution = keyof typeof VIDEO_OFFICIAL_PRICE

/** 用户计费（官方刊例价 × 0.5 半价），返回金额（分） */
export function videoCostMinor(input: { resolution: VideoResolution; seconds: number; imageCount?: number }): number {
  const yuan = (VIDEO_OFFICIAL_PRICE[input.resolution] ?? 0.5) * Math.max(1, input.seconds) * VIDEO_USER_RATIO
    + Math.max(0, (input.imageCount ?? 0) - VIDEO_FREE_IMAGE_COUNT) * VIDEO_OFFICIAL_IMAGE_PRICE * VIDEO_USER_RATIO
  return Math.round(yuan * 100)
}

/** 后台成本统计（秘塔渠道价），返回金额（分） */
export function videoMetasoCostMinor(input: { resolution: VideoResolution; seconds: number; imageCount?: number }): number {
  const yuan = (VIDEO_METASO_PRICE[input.resolution] ?? 0.09) * Math.max(1, input.seconds)
    + Math.max(0, (input.imageCount ?? 0) - VIDEO_FREE_IMAGE_COUNT) * VIDEO_METASO_IMAGE_PRICE
  return Math.round(yuan * 100)
}

/** 计费表（不含内部字段，供 bootstrap/管理后台展示） */
export function billingCatalog(): Array<{
  kind: BillingKind
  label: string
  model: string
  unitLabel: string
  inputPerMillion: number
  outputPerMillion: number
  cacheHitPerMillion: number
  fixedPrice?: number
  peakMultiplier: number
  costBased: boolean
}> {
  return BILLING_TABLE.map((item) => ({ ...item }))
}