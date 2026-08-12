/** Daily 管理后台 API（同源 admin.shadowshub.xyz，cookie 鉴权） */

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    credentials: 'include',
    ...init,
    headers: {
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...init?.headers,
    },
  })
  if (!response.ok) {
    let message = `请求失败（HTTP ${response.status}）`
    try {
      const payload = await response.json() as { error?: { message?: string } }
      message = payload.error?.message ?? message
    } catch { /* keep fallback */ }
    const error = new Error(message) as Error & { status: number }
    error.status = response.status
    throw error
  }
  return response.json() as Promise<T>
}

export interface MeUser {
  authenticated: boolean
  guest?: boolean
  user?: { id: string; username: string; email?: string; role: string }
}

export interface CreditsState { quota: number; used: number; remaining: number }
export interface UsageAgg { reqs: number; tokens: number; lastActive: number | null }
export interface AdminUser {
  id: string
  username: string
  email: string
  role: string
  isBanned: boolean
  createdAt: number
  lastLoginAt: number | null
  registeredIp: string | null
  lastLoginIp: string | null
  kind: 'member' | 'plan'
  credits: CreditsState
  appCount: number
  usage: UsageAgg
}
export interface GuestUser {
  id: string
  deviceId: string
  createdAt: number | null
  kind: 'guest'
  credits: CreditsState
  appCount: number
  usage: UsageAgg
}
export interface UsageSummary {
  since: number
  days: number
  total: { requests: number; tokens: number }
  byKind: Record<string, { requests: number; tokens: number }>
  byStatus: Record<string, number>
  byDay: Array<{ day: string; requests: number; tokens: number }>
}
export interface UsageItem {
  id: string
  kind: string
  model: string
  thinking: string
  promptTokens: number
  completionTokens: number
  totalTokens: number
  costMinor: number
  status: string
  errorCode: string | null
  ip: string | null
  createdAt: number
}

// ============================================================================
// 生图监测（2026-08-02）
// ============================================================================

export interface ImageGenPricing {
  model: string
  inputPerMillion: number
  outputPerMillion: number
  currency: string
}

export interface ImageGenStats {
  since: number
  days: number
  total: number
  ok: number
  failed: number
  timeout: number
  insufficient: number
  successRate: number
  avgDurationMs: number
  avgOkDurationMs: number
  totalTokens: number
  totalCostMinor: number
  imagesProduced: number
  byStatus: Array<{ status: string; count: number }>
  byError: Array<{ code: string; count: number }>
  byDay: Array<{ day: string; requests: number; ok: number; failed: number; tokens: number; costMinor: number }>
  byUser: Array<{ userKey: string; requests: number; ok: number; failed: number }>
}

export interface ImageGenUsageItem {
  id: string
  userKey: string
  userEmail: string | null
  kind: string
  model: string
  prompt: string
  n: number
  images: number
  inputTokens: number
  outputTokens: number
  totalTokens: number
  costMinor: number
  status: string
  errorCode: string | null
  durationMs: number
  ip: string | null
  createdAt: number
}

// ============================================================================
// MiniMax-M3 视觉桥接监测（2026-08-14）：AI 的眼睛（DeepSeek 非视觉 → M3 描述）
// ============================================================================

export interface VisionStats {
  days: number
  since: number
  total: {
    calls: number
    ok: number
    failed: number
    media: number
    inputTokens: number
    outputTokens: number
    cachedTokens: number
    totalTokens: number
    costMinor: number
  }
  byDay: Array<{ day: string; calls: number; ok: number; failed: number; tokens: number; costMinor: number }>
  byUser: Array<{ userKey: string; userEmail: string | null; calls: number; ok: number; tokens: number; costMinor: number }>
  byTrigger: Record<string, { calls: number; tokens: number; costMinor: number }>
  byKind: Record<string, number>
  byStatus: Record<string, number>
  pricing: { model: string; inputPerMillion: number; outputPerMillion: number; cacheReadPerMillion: number; note: string }
}

export interface VisionUsageItem {
  id: string
  userKey: string
  userEmail: string | null
  requestId: string | null
  conversationId: string | null
  trigger: string
  kind: string
  mediaCount: number
  prompt: string | null
  description: string | null
  inputTokens: number
  outputTokens: number
  cachedTokens: number
  totalTokens: number
  costMinor: number
  status: string
  errorCode: string | null
  errorMessage: string | null
  durationMs: number
  ip: string | null
  createdAt: number
}

// ============================================================================
// 服务器负载监控（2026-08-06）
// ============================================================================

export interface ServerStats {
  collectedAt: number
  hostname: string
  uptimeSec: number
  loadavg: { '1m': number; '5m': number; '15m': number }
  cpu: { cores: number; usagePercent: number; loadPerCore: number }
  memory: { totalBytes: number; freeBytes: number; usedBytes: number; usedPercent: number }
  disk: { totalBytes: number; freeBytes: number; usedBytes: number; usedPercent: number }
  network: { rxBytesPerSec: number; txBytesPerSec: number; rxMbps: number; txMbps: number }
  process: { pid: number; rssBytes: number; cpuSeconds: number }
}
export interface ServerHealthAlert { key: string; level: 'warn' | 'critical'; message: string }
export interface ServerMetricsPoint {
  ts: number
  cpu: number
  rxMax: number
  rxAvg: number
  txMax: number
  txAvg: number
  mem: number
  disk: number
  load1: number
}
export interface ServerMetricsResponse {
  from: number
  to: number
  bucketMs: number
  points: ServerMetricsPoint[]
}

export const api = {
  me: () => request<MeUser>('/api/auth/me'),
  login: (email: string, password: string) =>
    request<{ authenticated: true; user: { role: string } }>('/api/auth/email/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),
  logout: () => request<{ authenticated: false }>('/api/auth/logout', { method: 'POST' }),
  users: () => request<{ users: AdminUser[]; guests: GuestUser[]; totals: { users: number; guests: number } }>('/api/admin/webos/users'),
  usageSummary: (days = 7) => request<UsageSummary>(`/api/admin/webos/usage/summary?days=${days}`),
  usage: (userKey: string, page = 1) =>
    request<{ userKey: string; page: number; total: number; items: UsageItem[] }>(
      `/api/admin/webos/usage?userKey=${encodeURIComponent(userKey)}&page=${page}&limit=30`,
    ),
  adjustCredits: (userKey: string, quota: number) =>
    request<{ ok: true; userKey: string; quota: number }>('/api/admin/webos/credits', {
      method: 'PUT',
      body: JSON.stringify({ userKey, quota }),
    }),
  imageGenPricing: () => request<ImageGenPricing>('/api/admin/webos/imagegen/pricing'),
  imageGenStats: (days = 7) => request<ImageGenStats>(`/api/admin/webos/imagegen/stats?days=${days}`),
  imageGenUsage: (userKey: string, page = 1) =>
    request<{ page: number; total: number; items: ImageGenUsageItem[] }>(
      `/api/admin/webos/imagegen/usage?${userKey ? `userKey=${encodeURIComponent(userKey)}&` : ''}page=${page}&limit=30`,
    ),
  // 2026-08-14 MiniMax-M3 视觉桥接（AI 的眼睛）监测
  visionStats: (days = 7) => request<VisionStats>(`/api/admin/webos/vision/stats?days=${days}`),
  visionUsage: (userKey: string, page = 1) =>
    request<{ userKey: string | null; page: number; total: number; items: VisionUsageItem[] }>(
      `/api/admin/webos/vision/usage?${userKey ? `userKey=${encodeURIComponent(userKey)}&` : ''}page=${page}&limit=30`,
    ),
  ban: (id: string, isBanned: boolean) =>
    request<unknown>(`/api/admin/users/${encodeURIComponent(id)}/ban`, {
      method: 'PUT',
      body: JSON.stringify({ isBanned }),
    }),
  setRole: (id: string, role: 'admin' | 'member') =>
    request<unknown>(`/api/admin/users/${encodeURIComponent(id)}/role`, {
      method: 'PUT',
      body: JSON.stringify({ role }),
    }),
  serverStatus: () => request<{ stats: ServerStats; alerts: ServerHealthAlert[]; onlineUsers?: number }>('/api/admin/webos/server-status'),
  serverMetrics: (from: number, to: number) => request<ServerMetricsResponse>(`/api/admin/webos/server-metrics?from=${from}&to=${to}`),
  paymentOrders: (opts: { delivered?: number; page?: number; limit?: number } = {}) => {
    const params = new URLSearchParams()
    if (opts.delivered !== undefined) params.set('delivered', String(opts.delivered))
    if (opts.page) params.set('page', String(opts.page))
    if (opts.limit) params.set('limit', String(opts.limit))
    return request<{ total: number; page: number; limit: number; list: AfdianOrderItem[] }>(`/api/admin/webos/payment/orders?${params.toString()}`)
  },
  redeliverOrder: (outTradeNo: string, remark?: string) =>
    request<{ ok: true; result: { ec: number; em?: string } }>(`/api/admin/webos/payment/orders/${encodeURIComponent(outTradeNo)}/redeliver`, {
      method: 'POST',
      body: JSON.stringify({ remark }),
    }),
  // 2026-08-12 兑换码管理（爱发电兑换码 → 本地表 → 用户个人中心兑换）
  redeemCodes: (status?: string, page = 1, limit = 50) => {
    const params = new URLSearchParams()
    if (status) params.set('status', status)
    params.set('page', String(page))
    params.set('limit', String(limit))
    return request<{ total: number; page: number; limit: number; list: RedeemCodeItem[] }>(`/api/admin/webos/redeem-codes?${params.toString()}`)
  },
  importRedeemCodes: (items: Array<{ code: string; planId: string; note?: string }>) =>
    request<{ ok: true; imported: number; skipped: number }>('/api/admin/webos/redeem-codes/import', {
      method: 'POST',
      body: JSON.stringify({ items }),
    }),
  revokeRedeemCodes: (codes: string[]) =>
    request<{ ok: true; revoked: number }>('/api/admin/webos/redeem-codes/revoke', {
      method: 'POST',
      body: JSON.stringify({ codes }),
    }),
}

/** 2026-08-06 爱发电订单条目（管理后台订单列表） */
export interface AfdianOrderItem {
  out_trade_no: string
  user_id: string | null
  plan_id: string
  plan_name: string | null
  product_type: number
  amount: string
  month: number
  remark: string | null
  status: number
  channel: string
  delivered: number
  delivered_at: number | null
  matched_user: string | null
  match_mode: string | null
  credits: number
  error: string | null
  created_at: number
  updated_at: number
}
/** 2026-08-12 兑换码条目（管理后台兑换码列表） */
export interface RedeemCodeItem {
  code: string
  plan_id: string
  plan_name: string | null
  status: 'unused' | 'used' | 'revoked'
  redeemed_by: string | null
  redeemed_at: number | null
  note: string | null
  created_at: number
  updated_at: number
}

export function formatTokens(value: number): string {
  if (value >= 100_000_000) return `${(value / 100_000_000).toFixed(1)} 亿`
  if (value >= 10_000) return `${Math.round(value / 10_000)} 万`
  return String(Math.round(value))
}

/** 积分显示（1 积分 = ¥0.01） */
export function formatCredits(value: number): string {
  if (value >= 10_000) return `${(value / 10_000).toFixed(1)} 万`
  return String(Math.round(value))
}

export function formatDate(timestamp: number | null | undefined): string {
  if (!timestamp) return '—'
  return new Date(timestamp).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}