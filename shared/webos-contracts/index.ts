export const WEBOS_MODEL_OPTIONS = ['flash'] as const
export type WebOsModel = (typeof WEBOS_MODEL_OPTIONS)[number]

// DeepSeek 官方思考深度四档（与 pi 内置 deepseek provider 的 reasoning_effort 对齐：
// low/medium/high/max；pi 原生档位中 max 对应 xhigh）。
export const WEBOS_THINKING_LEVELS = ['low', 'medium', 'high', 'max'] as const
export type WebOsThinkingLevel = (typeof WEBOS_THINKING_LEVELS)[number]

export const WEBOS_THINKING_LABELS: Record<WebOsThinkingLevel, string> = {
  low: '浅',
  medium: '中',
  high: '深',
  max: '极深',
}

export const WEBOS_DEFAULT_MODEL: WebOsModel = 'flash'
export const WEBOS_DEFAULT_THINKING: WebOsThinkingLevel = 'medium'
export const WEBOS_PRIVATE_STORAGE_CAPABILITY = 'app.storage.private' as const

export const WEBOS_BUILT_IN_APPS = [
  { id: 'daily.ai', name: 'Daily AI', kind: 'system', removable: false },
  { id: 'system.desktop', name: '系统桌面', kind: 'system', removable: false },
  { id: 'system.files', name: '文件管理器', kind: 'system', removable: false },
] as const

export type WebOsAppSource = 'builtin' | 'ai_generated' | 'local_import' | 'store'
export type WebOsAppVersionStatus = 'draft' | 'ready' | 'active' | 'rolled_back'

export interface WebOsGuest {
  id: string
  deviceId: string
  balanceMinor: number
  freeBalanceMinor: number
  usedMinor: number
  storageBytes: number
  storageLimitBytes: number
  createdAt: number
  synced: boolean
  /** 用户分层：guest 游客 / member 已登录 / plan 套餐用户 */
  kind: 'guest' | 'member' | 'plan'
  /** 积分体系（2026-08-02）：1 积分 = ¥0.01。游客 100 / 登录 1000 / 套餐 990 */
  credits: {
    quota: number
    used: number
    remaining: number
    /** 2026-08-06 爱发电月卡（存在且未到期时有效；remaining=当月剩余） */
    monthly?: { planId: string; planName: string; monthlyCredits: number; expiresAt: number; remaining: number } | null
    /** 2026-08-06 爱发电尝鲜用量包：永久积分池（永不过期） */
    permanent?: { quota: number; used: number; remaining: number } | null
    /** 总剩余 = 常规/月卡剩余 + 永久池剩余 */
    totalRemaining?: number
  }
}

/** 计费目录项（bootstrap.billing.catalog） */
export interface WebOsBillingItem {
  kind: 'chat' | 'image' | 'search' | 'tts'
  label: string
  model: string
  unitLabel: string
  inputPerMillion: number
  outputPerMillion: number
  cacheHitPerMillion: number
  fixedPrice?: number
  peakMultiplier: number
  costBased: boolean
}

/** bootstrap.billing：积分余额 + DeepSeek 高峰状态 + 计费目录 */
export interface WebOsBilling {
  /** DeepSeek 高峰时段（北京时间 9-12 / 14-18，价格 ×2） */
  peak: boolean
  peakMultiplier: number
  credits: { quota: number; used: number; remaining: number }
  catalog: WebOsBillingItem[]
}

export interface WebOsSession {
  authenticated: true
  guest: boolean
  user: { id: string; username: string; role: 'guest' | 'member' | 'admin'; email?: string | null; /** 是否已设置自定义称呼（display_name 非空）；未设置时 AI 会主动询问 */ displayNameSet?: boolean }
  guestState: WebOsGuest
}

/** 邮箱验证码登录/注册响应（免鉴权端点 /api/auth/email/verify） */
export interface WebOsEmailAuthResult {
  authenticated: true
  user: { id: string; username: string; email: string; role: 'guest' | 'member' | 'admin' }
  /** 是否把游客 webOS 资产迁移到了该账号 */
  migrated: boolean
  message: string
}

export interface WebOsModelConfig {
  id: WebOsModel
  label: string
  provider: string
  available: boolean
  priceHint: string
  supportsThinking: WebOsThinkingLevel[]
}

export interface WebOsAiConfig {
  model: WebOsModel
  thinking: WebOsThinkingLevel
  models: WebOsModelConfig[]
}

export interface WebOsUsageEstimate {
  balanceMinor: number
  estimatedMinor: number
  currency: 'CNY'
  model: WebOsModel
  thinking: WebOsThinkingLevel
  /** DeepSeek 高峰时段（价格 ×2） */
  peak?: boolean
  /** 积分视角：剩余积分 + 本次预估消耗（1 积分 = ¥0.01） */
  credits?: { remaining: number; estimated: number }
}

export interface WebOsChatMessage {
  role: 'user' | 'assistant'
  content: string
  /** assistant 消息的思考过程（增量累积；前端可折叠显示） */
  thinking?: string
  /** assistant 消息最近一次工具调用状态（用于对话气泡内展示） */
  toolCall?: { tool: string; done?: boolean; ok?: boolean }
  /** assistant 消息的工具调用序列（按调用顺序；每条独立展示，不互相覆盖） */
  toolCalls?: Array<{ tool: string; done?: boolean; ok?: boolean }>
  createdAt?: number
}

export interface WebOsChatRequest {
  messages: WebOsChatMessage[]
  model?: WebOsModel
  thinking?: WebOsThinkingLevel
  appId?: string
  sourceVersionId?: string
  /** 多会话：会话 ID（服务端按「用户 + 会话 + 思考档」隔离 pi 上下文；缺省 'default'） */
  conversationId?: string
  /** 重建会话上下文：编辑/回退重来时置 true——服务端丢弃旧 pi 会话，用 messages 重放历史后回复 */
  rebuild?: boolean
}

export type WebOsChatEvent =
  | { type: 'start'; requestId: string; config: { model: WebOsModel; thinking: WebOsThinkingLevel }; estimate?: WebOsUsageEstimate; /** 2026-08-11 SSE 重连：resume 请求的 start 标记 */ resume?: boolean }
  | { type: 'delta'; content: string }
  | { type: 'thinking'; content: string }
  | { type: 'tool_start'; tool: string }
  /** 2026-08-07 工具执行过程增量：pi 工具 onUpdate 输出的实时进度文本
   * （生图/批量处理/grep 等长工具执行期间逐段转发，前端在工具 chip 下展示） */
  | { type: 'tool_update'; tool: string; content: string }
  | { type: 'tool_end'; tool: string; ok: boolean; /** 生图成功时附带生成的图片 URL 列表（前端在工具下方展示） */ images?: string[]; /** 2026-08-05 视频生成成功时附带的视频 URL 列表 */ videos?: string[] }
  | { type: 'app_created'; appId: string }
  | { type: 'app_updated'; appId: string }
  | { type: 'interactive_html'; html: string; heightPx?: number }
  /** 2026-08-06 会话忙等待：上一条任务（可能被刷新/断连中断）仍在后台运行，
   *  本次请求排队等待（服务端每 2s 重试，最多 180s；不报错、不丢上下文）。
   *  等待期间后台任务事件经 background_progress 实时转发，处理过程对用户可见。 */
  | { type: 'busy_waiting'; elapsed: number; message?: string }
  /** 2026-08-06 后台任务实时进度（busy 等待期间收到；不属于本次请求）：
   *  上一条任务在后台运行的实际过程——思考增量 / 输出增量 / 工具调用，前端单独展示 */
  | { type: 'background_progress'; event: { kind: 'thinking' | 'delta' | 'tool_start' | 'tool_update' | 'tool_end'; content?: string; tool?: string; ok?: boolean } }
  | { type: 'done'; usage: { estimatedMinor: number; actualMinor: number; model: WebOsModel; thinking: WebOsThinkingLevel; totalTokens: number; /** 积分制（1 积分 = ¥0.01） */ usedCredits?: number; remainingCredits?: number; peak?: boolean } | null; /** 2026-08-11 SSE 重连：resume 补发的 done（任务在 resume 前已结束）——前端不重复累加用量 */ resume?: boolean }
  | { type: 'error'; code: string; message: string }
  /** 2026-08-11 SSE 重连：该会话无运行中任务，恢复结束 */
  | { type: 'no_task' }
  /** SSE 心跳保活（长任务期间每 15s 一次，防止代理超时断连） */
  | { type: 'keep_alive' }

export interface WebOsAppVersion {
  id: string
  appId: string
  version: string
  status: WebOsAppVersionStatus
  source: WebOsAppSource
  capabilities: string[]
  html: string | null
  createdAt: number
  createdBy: 'system' | 'guest' | 'user'
  parentVersionId: string | null
}

export interface WebOsApp {
  id: string
  name: string
  source: WebOsAppSource
  activeVersionId: string | null
  installed: boolean
  createdAt: number
  /** AI 生成的 SVG 图标（原始 SVG 字符串；桌面图标用 data URI 渲染） */
  icon?: string | null
  versions: WebOsAppVersion[]
}

export interface WebOsPaymentProduct {
  id: string
  name: string
  priceMinor: number
  currency: 'CNY'
  description: string
  available: boolean
}

export interface WebOsPaymentState {
  providerStatus: 'unavailable' | 'ready'
  /** 计划接入的支付渠道标识（2026-08-02：爱发电） */
  provider?: 'afdian'
  /** 爱发电主页（爱发电要求公开宣传；未配置时为 null） */
  afdianUrl?: string | null
  products: WebOsPaymentProduct[]
  /** 爱发电档位（2026-08-06；2026-08-12 月卡带工作区存储档位） */
  tiers?: WebOsPayTier[]
}

/** 爱发电档位（前端 AfdianView 直接渲染；workspaceBytes=月卡对应工作区空间，用量包为 null） */
export interface WebOsPayTier {
  planId: string
  name: string
  priceYuan: number
  kind: 'monthly' | 'pack'
  monthlyCredits?: number | null
  packCredits?: number | null
  workspaceBytes?: number | null
  /** 该档位下单直达链接（爱发电 order/create 支付页；未配置时为 null，前端回退主页） */
  payUrl?: string | null
}

/** 支付订单（zpay 渠道，2026-08-02） */
export interface WebOsPayOrder {
  id: string
  productId: string
  productName: string
  amountMinor: number
  type: 'alipay' | 'wxpay'
  status: 'pending' | 'paid' | 'failed'
  /** 支付跳转地址（收银台/H5） */
  payUrl: string | null
  /** 二维码内容（可自行渲染） */
  qrcode: string | null
  /** 二维码图片地址（zpay 生成） */
  img: string | null
  createdAt: number
  paidAt: number | null
}

export type WebOsEmailBindingState =
  | 'idle'
  | 'email_sent'
  | 'verification_unavailable'
  | 'verified'
  | 'migration_pending'
  | 'migration_complete'
  | 'error'

export interface WebOsEmailBindingResponse {
  state: WebOsEmailBindingState
  message: string
}

/** 系统时间信息（GET /webos/api/time） */
export interface WebOsTimeInfo {
  /** UTC ISO 字符串 */
  iso: string
  /** Unix 毫秒时间戳 */
  timestamp: number
  /** 北京时间（UTC+8）格式：YYYY-MM-DD HH:mm:ss */
  beijing: string
  /** 中文星期几，如「星期四」 */
  weekday: string
  timezone: 'Asia/Shanghai'
}

export interface WebOsBootstrap {
  session: WebOsSession
  ai: WebOsAiConfig
  apps: WebOsApp[]
  payment: WebOsPaymentState
  email: { state: WebOsEmailBindingState; boundEmail: string | null }
  /** 计费信息（2026-08-02 积分制）：DeepSeek 高峰状态 + 计费目录 + 积分余额 */
  billing?: WebOsBilling
  /** 系统 Logo（AI 可替换）：工作区 system/logo.svg|png 的 base64；null = 未设置（显示文字标识） */
  logo: { mime: string; base64: string } | null
  /** 用户头像（可替换）：工作区 system/avatar.svg|png 的 base64；null = 未设置（显示首字母） */
  avatar: { mime: string; base64: string } | null
  /** 定制加载页（AI 可替换）：工作区 system/boot.html（内容）+ system/boot.json（durationMs 时长） */
  boot: { html: string | null; durationMs: number }
}

/** 用户文件工作区条目（home/ 用户可见区） */
export interface WebOsWorkspaceEntry {
  name: string
  type: 'dir' | 'file'
  size: number
  modifiedAt: number
  /** 仅 home/ 下图片会附带：免鉴权公开 URL（桌面 sandbox iframe 可加载），不可枚举 UUID */
  publicUrl?: string
}

/** 用户文件工作区列表响应 */
export interface WebOsWorkspaceListing {
  path: string
  entries: WebOsWorkspaceEntry[]
  workspaceBytes: number
  workspaceLimitBytes: number
}

// ============================================================================
// UI Design Tokens（2026-08-16 UI 探索定稿 ·「清亮通透 + 平面化」）
// ----------------------------------------------------------------------------
// 单一事实源：Shell / Android Compose 主题 / theme 包（D20 UI 子包）共用。
// theme 包 = 覆盖本结构的 JSON（校验失败回退 WEBOS_DEFAULT_DESIGN_TOKENS）。
// 色值来源：client/shell-web/src/styles.css :root（webOS 既有）+ E1 图标主色。
// ============================================================================

export interface WebOsDesignTokenColor {
  /** 主色（亮蓝，E1 光点 #4F8CFF）——按钮/气泡/高亮 */
  primary: string
  /** 深靛蓝（既有 --blue #315BD6）——次级强调/链接/选中 */
  accent: string
  /** 卡片/毛玻璃面 */
  surface: string
  /** 弱面（按压态/分组底） */
  surfaceVariant: string
  /** 页面底（暖白） */
  background: string
  /** 页面底渐变端（浅灰蓝） */
  backgroundGradientEnd: string
  /** 主文字（墨） */
  onBackground: string
  /** 卡片上文字 */
  onSurface: string
  /** 辅助文字 */
  onSurfaceVariant: string
  /** 弱文字/占位 */
  muted: string
  /** 用户气泡 */
  chatBubbleUser: string
  /** AI 气泡（白/玻璃） */
  chatBubbleAI: string
  /** 辅助色（墨绿，桌面图标族） */
  green: string
  /** 琥珀（商店图标族） */
  amber: string
  /** 危险/删除 */
  red: string
  /** 分割线 */
  border: string
}

export interface WebOsDesignTokenShape {
  radiusSm: number
  radiusMd: number
  radiusLg: number
}

export interface WebOsDesignTokenBlur {
  /** 面板/卡片毛玻璃 */
  panel: number
  /** 弹层/托盘 */
  overlay: number
}

export interface WebOsDesignTokenMotion {
  durationShort: number
  durationMed: number
  /** 缓动曲线标识（emphasized / standard 等，消费方映射） */
  easing: string
}

export interface WebOsDesignTokens {
  color: WebOsDesignTokenColor
  shape: WebOsDesignTokenShape
  blur: WebOsDesignTokenBlur
  motion: WebOsDesignTokenMotion
  wallpaper: { type: 'gradient' | 'image' | 'live'; value: string }
}

/** 默认设计令牌（v1 · 清亮通透）：theme 包校验失败 / 卸载覆盖包时的安全回退（红线 2） */
export const WEBOS_DEFAULT_DESIGN_TOKENS: WebOsDesignTokens = {
  color: {
    primary: '#4F8CFF',
    accent: '#315BD6',
    surface: '#FFFFFF',
    surfaceVariant: '#F1F3F8',
    background: '#F8F7F3',
    backgroundGradientEnd: '#E6EAF2',
    onBackground: '#171918',
    onSurface: '#171918',
    onSurfaceVariant: '#424740',
    muted: '#71756F',
    chatBubbleUser: '#4F8CFF',
    chatBubbleAI: '#FFFFFF',
    green: '#376B53',
    amber: '#A06D25',
    red: '#A54B49',
    border: 'rgba(23,25,24,0.10)',
  },
  shape: { radiusSm: 12, radiusMd: 20, radiusLg: 28 },
  blur: { panel: 24, overlay: 40 },
  motion: { durationShort: 150, durationMed: 300, easing: 'emphasized' },
  wallpaper: { type: 'gradient', value: 'linear-gradient(160deg,#F8F7F3 0%,#E6EAF2 100%)' },
}
