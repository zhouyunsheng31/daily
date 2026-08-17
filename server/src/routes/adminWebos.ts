import { Router, type Request, type Response } from 'express'
import fs from 'node:fs'
import { getPool } from '../db/connection.js'
import { requireAdmin } from '../middleware/auth.js'
import { createError } from '../middleware/error.js'
import { loadState, saveState, type Principal } from './webos.js'
import { getServerStats, serverHealthAlerts, getOnlineUserCount } from '../utils/serverMonitor.js'
// 2026-08-06 爱发电订单：列表查询 / 人工补发
import { listAfdianOrders, handleAfdianOrder, importRedeemCodes, listRedeemCodes, findRedeemCode } from '../payment/afdian.js'
// 生图定价（与 imagegen 模块共享，避免硬编码漂移；2026-08-13 改为引用）
import { IMAGE_PRICING } from '../imagegen/chatstImage.js'

/**
 * webOS 管理 API（2026-08-02，管理后台 admin.shadowshub.xyz 的后端）。
 * 挂载 /api/admin/webos（requireAdmin 保护）：
 * - GET  /users          用户+游客统一列表（含积分额度/用量/IP/资产）
 * - GET  /usage/summary  用量汇总（今日/近N天、按分层、按状态）
 * - GET  /usage          单用户用量明细（new-api 风格）
 * - PUT  /credits        调整用户积分额度（套餐开通/客服补偿；/tokens 兼容旧名）
 * - GET  /server-status  服务器负载（2026-08-06：CPU/内存/磁盘/带宽）
 * - GET  /stats/activity  日活/月活统计（DAU 序列 + 当月 MAU + 7/30 天趋势，2026-08-17）
 */

export const adminWebosRouter = Router()
adminWebosRouter.use(requireAdmin)

interface ParsedState {
  credits?: { quota?: unknown; used?: unknown }
  apps?: unknown[]
  createdAt?: unknown
}

function parseState(data: unknown): ParsedState | null {
  // SQLite adapter 可能已把 JSON 列解析为对象；PG 返回字符串——两种都兼容
  if (typeof data === 'string') {
    try {
      const parsed = JSON.parse(data) as Record<string, unknown>
      if (!parsed || typeof parsed !== 'object') return null
      return parsed as ParsedState
    } catch {
      return null
    }
  }
  if (data && typeof data === 'object') return data as ParsedState
  return null
}

function num(value: unknown, fallback = 0): number {
  const n = Number(value)
  return Number.isFinite(n) && n >= 0 ? n : fallback
}

function clientIp(req: Request): string {
  const xff = req.headers['x-forwarded-for']
  if (xff) {
    const ip = Array.isArray(xff) ? xff[0] : xff.split(',')[0]
    return ip?.trim() || 'unknown'
  }
  return req.socket.remoteAddress || 'unknown'
}

function isUserKey(value: unknown): value is string {
  return typeof value === 'string' && (/^guest:[a-zA-Z0-9-]+$/.test(value) || /^user:[a-zA-Z0-9-]+$/.test(value))
}

/** 从 userKey 构造 webOS Principal（user:<id> 查 users 表拿 email/role） */
async function principalFromUserKey(userKey: string): Promise<Principal> {
  if (userKey.startsWith('guest:')) {
    const deviceId = userKey.slice(6)
    return {
      key: userKey,
      id: `guest-${deviceId}`,
      deviceId,
      guest: true,
      role: 'guest',
    }
  }
  const userId = userKey.slice(5)
  const pool = getPool()
  const result = await pool.query('SELECT id, email, role FROM users WHERE id = $1', [userId])
  if (result.rows.length === 0) {
    throw createError(404, 'USER_NOT_FOUND', '找不到该用户')
  }
  const row = result.rows[0] as { id: string; email: string | null; role: string }
  return {
    key: userKey,
    id: row.id,
    deviceId: `account-${row.id}`,
    guest: false,
    role: row.role === 'admin' ? 'admin' : 'member',
    email: row.email ?? null,
  }
}

// ============================================================================
// GET /api/admin/webos/users — 用户 + 游客统一列表
// ============================================================================

adminWebosRouter.get('/users', async (req, res, next) => {
  try {
    const pool = getPool()
    const q = typeof req.query.q === 'string' ? req.query.q.trim().toLowerCase() : ''

    // 用量聚合（按 user_key）
    const usageRows = await pool.query(
      'SELECT user_key, COUNT(*)::int AS reqs, COALESCE(SUM(total_tokens),0) AS tokens, MAX(created_at) AS last_active FROM webos_ai_usage GROUP BY user_key',
    )
    const usageByKey = new Map<string, { reqs: number; tokens: number; lastActive: number | null }>()
    for (const row of usageRows.rows) {
      usageByKey.set(String(row.user_key), {
        reqs: Number(row.reqs ?? 0),
        tokens: Number(row.tokens ?? 0),
        lastActive: row.last_active ? Number(row.last_active) : null,
      })
    }

    // 注册用户（users 表 + 各自 webos_state）
    const usersResult = await pool.query(
      `SELECT id, username, email, role, is_banned, created_at, last_login_at, registered_ip, last_login_ip
       FROM users ORDER BY created_at DESC LIMIT 200`,
    )
    const userStates = await pool.query(
      "SELECT scope, data FROM entities WHERE type = 'webos_state' AND scope LIKE 'user:%'",
    )
    const stateByUserId = new Map<string, ParsedState | null>()
    for (const row of userStates.rows) {
      stateByUserId.set(String(row.scope).slice(5), parseState(row.data))
    }

    const users = usersResult.rows
      .filter((row) => {
        if (!q) return true
        const email = String(row.email ?? '').toLowerCase()
        const username = String(row.username ?? '').toLowerCase()
        const ip = String(row.registered_ip ?? '')
        return email.includes(q) || username.includes(q) || ip.includes(q)
      })
      .map((row) => {
        const state = stateByUserId.get(String(row.id)) ?? null
        const quota = num(state?.credits?.quota)
        const used = num(state?.credits?.used)
        const usage = usageByKey.get(`user:${row.id}`)
        return {
          id: row.id,
          username: row.username,
          email: row.email,
          role: row.role,
          isBanned: typeof row.is_banned === 'number' ? row.is_banned !== 0 : !!row.is_banned,
          createdAt: Number(row.created_at),
          lastLoginAt: row.last_login_at ? Number(row.last_login_at) : null,
          registeredIp: row.registered_ip ?? null,
          lastLoginIp: row.last_login_ip ?? null,
          kind: quota >= 990 ? 'plan' : 'member',
          credits: { quota, used, remaining: Math.max(0, quota - used) },
          appCount: Array.isArray(state?.apps) ? state.apps.length : 0,
          usage: usage ?? { reqs: 0, tokens: 0, lastActive: null },
        }
      })

    // 游客（entities scope guest:*）
    const guestRows = await pool.query(
      "SELECT scope, data FROM entities WHERE type = 'webos_state' AND scope LIKE 'guest:%'",
    )
    const guests = guestRows.rows
      .filter((row) => {
        if (!q) return true
        return String(row.scope).toLowerCase().includes(q.toLowerCase())
      })
      .map((row) => {
        const scope = String(row.scope)
        const state = parseState(row.data)
        const quota = num(state?.credits?.quota)
        const used = num(state?.credits?.used)
        const usage = usageByKey.get(scope)
        return {
          id: scope,
          deviceId: scope.slice(6),
          createdAt: num(state?.createdAt, 0) || null,
          kind: 'guest' as const,
          credits: { quota, used, remaining: Math.max(0, quota - used) },
          appCount: Array.isArray(state?.apps) ? state.apps.length : 0,
          usage: usage ?? { reqs: 0, tokens: 0, lastActive: null },
        }
      })
      .sort((a, b) => (b.usage?.lastActive ?? b.createdAt ?? 0) - (a.usage?.lastActive ?? a.createdAt ?? 0))

    res.json({ users, guests, totals: { users: users.length, guests: guests.length } })
  } catch (error) {
    next(error)
  }
})

// ============================================================================
// GET /api/admin/webos/server-status — 服务器负载（CPU/内存/磁盘/带宽）
// 2026-08-06：管理后台仪表盘展示 + AI 工具 get_server_status 的数据源
// ============================================================================

adminWebosRouter.get('/server-status', (_req, res) => {
  try {
    const stats = getServerStats()
    const alerts = serverHealthAlerts(stats)
    // 2026-08-06 在线人数（最近 5 分钟活跃用户数）
    const onlineUsers = getOnlineUserCount()
    res.json({ stats, alerts, onlineUsers })
  } catch (error) {
    res.status(500).json({ error: { message: error instanceof Error ? error.message : '采集服务器状态失败' } })
  }
})

// ============================================================================
// GET /api/admin/webos/payment/orders?delivered=&page= — 爱发电订单与发货记录
// 2026-08-06：webhook/API 双通道入库；delivered 0=待发货（邮箱未匹配/失败） 1=已发货
// ============================================================================

adminWebosRouter.get('/payment/orders', async (req, res, next) => {
  try {
    const delivered = req.query.delivered === undefined ? undefined : Number(req.query.delivered) === 1 ? 1 : 0
    const page = Math.max(1, Number(req.query.page) || 1)
    const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 20))
    const result = await listAfdianOrders({ delivered, limit, offset: (page - 1) * limit })
    res.json({ ...result, page, limit })
  } catch (error) {
    next(error)
  }
})

/** POST /api/admin/webos/payment/orders/:outTradeNo/redeliver — 人工补发（管理员修正邮箱匹配后重试发货） */
adminWebosRouter.post('/payment/orders/:outTradeNo/redeliver', async (req, res, next) => {
  try {
    const outTradeNo = String(req.params.outTradeNo ?? '').slice(0, 64)
    const body = req.body as { remark?: unknown }
    // 管理员可修正留言（比如用户填错邮箱）后重新发货
    if (typeof body.remark === 'string' && body.remark.trim()) {
      const pool = getPool()
      await pool.query('UPDATE webos_afdian_orders SET remark = $2, delivered = 0, error = NULL, updated_at = $3 WHERE out_trade_no = $1', [outTradeNo, body.remark.trim(), Date.now()])
    }
    const pool = getPool()
    const row = await pool.query('SELECT * FROM webos_afdian_orders WHERE out_trade_no = $1', [outTradeNo])
    if (!row.rows?.[0]) {
      next(createError(404, 'ORDER_NOT_FOUND', '订单不存在'))
      return
    }
    const order = row.rows[0] as Record<string, unknown>
    const result = await handleAfdianOrder({
      data: {
        type: 'order',
        order: {
          out_trade_no: order.out_trade_no,
          user_id: order.user_id ?? '',
          plan_id: order.plan_id,
          month: order.month ?? 1,
          total_amount: order.amount ?? '0',
          status: order.status ?? 2,
          remark: order.remark ?? '',
          product_type: order.product_type ?? 0,
        },
      },
    }, 'api')
    res.json({ ok: true, result })
  } catch (error) {
    next(error)
  }
})

// ============================================================================
// GET /api/admin/webos/server-metrics?from=&to= — 服务器负载历史（追溯查询）
// 2026-08-06：每分钟一条落库；跨度 >3 天自动按小时聚合，否则按分钟。
// 管理后台趋势图 + AI 工具 get_server_metrics 的数据源（几天后仍可查某时间段）
// ============================================================================

adminWebosRouter.get('/server-metrics', async (req, res, next) => {
  try {
    const pool = getPool()
    const now = Date.now()
    const from = Number(req.query.from) || (now - 24 * 3600 * 1000)
    const to = Number(req.query.to) || now
    const spanMs = Math.max(60_000, to - from)
    // 跨度 >3 天按小时聚合（避免大数据量），否则分钟原样
    const bucketMs = spanMs > 3 * 24 * 3600 * 1000 ? 3600_000 : 60_000
    const rows = await pool.query(
      `SELECT CAST(ts / $3 AS INTEGER) * $3 AS bucket,
        AVG(cpu_usage) AS cpu,
        MAX(rx_mbps) AS rx_max, AVG(rx_mbps) AS rx_avg,
        MAX(tx_mbps) AS tx_max, AVG(tx_mbps) AS tx_avg,
        AVG(mem_used_pct) AS mem, AVG(disk_used_pct) AS disk, AVG(loadavg_1m) AS load1
       FROM webos_server_metrics
       WHERE ts >= $1 AND ts <= $2
       GROUP BY bucket ORDER BY bucket ASC`,
      [from, to, bucketMs],
    )
    res.json({
      from,
      to,
      bucketMs,
      points: rows.rows.map((row) => ({
        ts: Number(row.bucket),
        cpu: Math.round(Number(row.cpu) * 10) / 10,
        rxMax: Math.round(Number(row.rx_max) * 100) / 100,
        rxAvg: Math.round(Number(row.rx_avg) * 100) / 100,
        txMax: Math.round(Number(row.tx_max) * 100) / 100,
        txAvg: Math.round(Number(row.tx_avg) * 100) / 100,
        mem: Math.round(Number(row.mem) * 10) / 10,
        disk: Math.round(Number(row.disk) * 10) / 10,
        load1: Math.round(Number(row.load1) * 100) / 100,
      })),
    })
  } catch (error) {
    next(error)
  }
})

// ============================================================================
// GET /api/admin/webos/usage/summary?days=7 — 用量汇总
// ============================================================================

adminWebosRouter.get('/usage/summary', async (req, res, next) => {
  try {
    const pool = getPool()
    const days = Math.min(90, Math.max(1, Number(req.query.days) || 7))
    const since = Date.now() - days * 24 * 60 * 60 * 1000

    const rows = await pool.query(
      `SELECT kind, status, total_tokens, created_at FROM webos_ai_usage WHERE created_at >= $1`,
      [since],
    )
    const byKind: Record<string, { requests: number; tokens: number }> = {}
    const byStatus: Record<string, number> = {}
    const byDay: Record<string, { requests: number; tokens: number }> = {}
    for (const row of rows.rows) {
      const kind = String(row.kind ?? 'guest')
      const status = String(row.status ?? 'ok')
      const tokens = Number(row.total_tokens ?? 0)
      byKind[kind] ??= { requests: 0, tokens: 0 }
      byKind[kind].requests += 1
      byKind[kind].tokens += tokens
      byStatus[status] = (byStatus[status] ?? 0) + 1
      const day = new Date(Number(row.created_at)).toISOString().slice(0, 10)
      byDay[day] ??= { requests: 0, tokens: 0 }
      byDay[day].requests += 1
      byDay[day].tokens += tokens
    }
    const total = rows.rows.reduce((acc, row) => ({
      requests: acc.requests + 1,
      tokens: acc.tokens + Number(row.total_tokens ?? 0),
    }), { requests: 0, tokens: 0 })

    res.json({
      since,
      days,
      total,
      byKind,
      byStatus,
      byDay: Object.entries(byDay).sort(([a], [b]) => a.localeCompare(b)).map(([day, value]) => ({ day, ...value })),
    })
  } catch (error) {
    next(error)
  }
})

// ============================================================================
// GET /api/admin/webos/usage?userKey=guest:xxx&page=1 — 单用户用量明细
// ============================================================================

adminWebosRouter.get('/usage', async (req, res, next) => {
  try {
    const userKey = String(req.query.userKey ?? '')
    if (!isUserKey(userKey)) {
      next(createError(400, 'INVALID_USER_KEY', 'userKey 格式不正确'))
      return
    }
    const page = Math.max(1, Number(req.query.page) || 1)
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20))
    const pool = getPool()
    const result = await pool.query(
      `SELECT id, kind, model, thinking, prompt_tokens, completion_tokens, total_tokens, cost_minor, status, error_code, ip, created_at
       FROM webos_ai_usage WHERE user_key = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
      [userKey, limit, (page - 1) * limit],
    )
    const countResult = await pool.query('SELECT COUNT(*)::int AS cnt FROM webos_ai_usage WHERE user_key = $1', [userKey])
    res.json({
      userKey,
      page,
      total: Number(countResult.rows[0]?.cnt ?? 0),
      items: result.rows.map((row) => ({
        id: row.id,
        kind: row.kind,
        model: row.model,
        thinking: row.thinking,
        promptTokens: Number(row.prompt_tokens ?? 0),
        completionTokens: Number(row.completion_tokens ?? 0),
        totalTokens: Number(row.total_tokens ?? 0),
        costMinor: Number(row.cost_minor ?? 0),
        status: row.status,
        errorCode: row.error_code ?? null,
        ip: row.ip ?? null,
        createdAt: Number(row.created_at),
      })),
    })
  } catch (error) {
    next(error)
  }
})

// ============================================================================
// GET /api/admin/webos/chat-logs?userKey=user:xxx&conversationId=&page=&limit=
// 2026-08-11 对话记录查询（查 bug 必须看对话记录——此前服务端不存对话内容，
// 排查"消息重复/扣费异常"只能靠 pm2 日志猜）。支持按用户 + 会话筛选，
// 返回完整对话消息（user/assistant 交替，含 token/扣费/状态）。
// ============================================================================

adminWebosRouter.get('/chat-logs', async (req, res, next) => {
  try {
    const userKey = String(req.query.userKey ?? '')
    if (!isUserKey(userKey)) {
      next(createError(400, 'INVALID_USER_KEY', 'userKey 格式不正确'))
      return
    }
    const conversationId = req.query.conversationId ? String(req.query.conversationId).slice(0, 64) : null
    const page = Math.max(1, Number(req.query.page) || 1)
    const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50))
    const pool = getPool()
    const params: unknown[] = [userKey]
    let where = 'user_key = $1'
    if (conversationId) {
      params.push(conversationId)
      where += ` AND conversation_id = $${params.length}`
    }
    params.push(limit, (page - 1) * limit)
    const result = await pool.query(
      `SELECT id, conversation_id, request_id, role, content, thinking, rebuild, status, error_code,
              prompt_tokens, completion_tokens, total_tokens, cost_minor, ip, created_at
       FROM webos_chat_logs WHERE ${where} ORDER BY created_at ASC LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    )
    const countParams = [userKey]
    let countWhere = 'user_key = $1'
    if (conversationId) {
      countParams.push(conversationId)
      countWhere += ` AND conversation_id = $2`
    }
    const countResult = await pool.query(`SELECT COUNT(*) AS cnt FROM webos_chat_logs WHERE ${countWhere}`, countParams)
    res.json({
      userKey,
      conversationId,
      page,
      total: Number(countResult.rows[0]?.cnt ?? 0),
      items: result.rows.map((row) => ({
        id: row.id,
        conversationId: row.conversation_id,
        requestId: row.request_id ?? null,
        role: row.role,
        content: row.content,
        thinking: row.thinking ?? null,
        rebuild: row.rebuild === 1 || row.rebuild === true,
        status: row.status,
        errorCode: row.error_code ?? null,
        promptTokens: Number(row.prompt_tokens ?? 0),
        completionTokens: Number(row.completion_tokens ?? 0),
        totalTokens: Number(row.total_tokens ?? 0),
        costMinor: Number(row.cost_minor ?? 0),
        ip: row.ip ?? null,
        createdAt: Number(row.created_at),
      })),
    })
  } catch (error) {
    next(error)
  }
})

// ============================================================================
// GET /api/admin/webos/sessions?userKey=user:xxx&conversationId=&limit=
// 2026-08-13 统一对话 log 查询：一次 chat/stream 请求 = 一行完整记录，
// events JSON 含完整事件序列（user 消息 / AI 思考 reasoning / 文字输出 /
// 工具调用 / App 创建更新 / 最终状态）——查"AI 当时怎么想的、干了什么"
// 必须看这里（reasoning 内容只在此表；chat-logs 只存纯文本快速浏览）。
// ============================================================================

adminWebosRouter.get('/sessions', async (req, res, next) => {
  try {
    const userKey = String(req.query.userKey ?? '')
    if (!isUserKey(userKey)) {
      next(createError(400, 'INVALID_USER_KEY', 'userKey 格式不正确'))
      return
    }
    const conversationId = req.query.conversationId ? String(req.query.conversationId).slice(0, 64) : null
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20))
    const pool = getPool()
    const params: unknown[] = [userKey]
    let where = 'user_key = $1'
    if (conversationId) {
      params.push(conversationId)
      where += ` AND conversation_id = $${params.length}`
    }
    params.push(limit)
    const result = await pool.query(
      `SELECT id, conversation_id, request_id, thinking, rebuild, model, status, error_code,
              prompt_tokens, completion_tokens, total_tokens, cost_minor, events, ip, created_at, ended_at
       FROM webos_chat_sessions WHERE ${where} ORDER BY created_at DESC LIMIT $${params.length}`,
      params,
    )
    res.json({
      userKey,
      conversationId,
      items: result.rows.map((row) => {
        let events: unknown = []
        try {
          events = JSON.parse(String(row.events ?? '[]'))
        } catch { /* 解析失败返回空 */ }
        return {
          id: row.id,
          conversationId: row.conversation_id,
          requestId: row.request_id ?? null,
          thinking: row.thinking ?? null,
          rebuild: row.rebuild === 1 || row.rebuild === true,
          model: row.model,
          status: row.status,
          errorCode: row.error_code ?? null,
          promptTokens: Number(row.prompt_tokens ?? 0),
          completionTokens: Number(row.completion_tokens ?? 0),
          totalTokens: Number(row.total_tokens ?? 0),
          costMinor: Number(row.cost_minor ?? 0),
          events,
          ip: row.ip ?? null,
          createdAt: Number(row.created_at),
          endedAt: Number(row.ended_at),
        }
      }),
    })
  } catch (error) {
    next(error)
  }
})

// ============================================================================
// GET /api/admin/webos/trace?userKey=user:xxx&conversationId=&appId=&hours=
// 2026-08-13 自动整合诊断：把一次对话期间发生的**全部事情**合并为一条时间线——
// ① 统一对话 log（webos_chat_sessions：消息+reasoning+工具+结果）
// ② AI 执行日志（工作区 logs/execution.log：agent_fs_* / App 工具调用轨迹）
// ③ App 版本历史（webos_state apps[].versions：版本何时由谁创建/切换）
// 排查"AI 干了什么/为什么没生效/来回折腾了几次"一条命令看全，不再手动拼多表。
// ============================================================================

adminWebosRouter.get('/trace', async (req, res, next) => {
  try {
    const userKey = String(req.query.userKey ?? '')
    if (!isUserKey(userKey)) {
      next(createError(400, 'INVALID_USER_KEY', 'userKey 格式不正确'))
      return
    }
    const conversationId = req.query.conversationId ? String(req.query.conversationId).slice(0, 64) : null
    const appId = req.query.appId ? String(req.query.appId).slice(0, 128) : null
    const hours = Math.min(24 * 7, Math.max(1, Number(req.query.hours) || 24))
    const since = Date.now() - hours * 3600_000
    const pool = getPool()
    type TimelineEvent = {
      ts: number
      source: 'chat' | 'exec' | 'version'
      kind: string
      detail: Record<string, unknown>
    }
    const timeline: TimelineEvent[] = []

    // ① 统一对话 log（含 reasoning——完整事件序列直接平铺进时间线）
    const sessionParams: unknown[] = [userKey, since]
    let sessionWhere = 'user_key = $1 AND created_at >= $2'
    if (conversationId) {
      sessionParams.push(conversationId)
      sessionWhere += ` AND conversation_id = $${sessionParams.length}`
    }
    const sessions = await pool.query(
      `SELECT id, conversation_id, request_id, thinking, status, error_code, events, created_at
       FROM webos_chat_sessions WHERE ${sessionWhere} ORDER BY created_at ASC LIMIT 200`,
      sessionParams,
    )
    for (const row of sessions.rows) {
      let events: Array<{ kind?: string; content?: string; tool?: string; appId?: string; ok?: boolean }> = []
      try { events = JSON.parse(String(row.events ?? '[]')) } catch { /* ignore */ }
      for (const ev of events) {
        timeline.push({
          ts: Number(row.created_at),
          source: 'chat',
          kind: String(ev.kind ?? 'event'),
          detail: {
            conversationId: String(row.conversation_id),
            requestId: String(row.request_id ?? ''),
            thinking: String(row.thinking ?? ''),
            status: String(row.status ?? ''),
            errorCode: row.error_code ?? undefined,
            content: typeof ev.content === 'string' ? ev.content.slice(0, 400) : undefined,
            tool: ev.tool,
            appId: ev.appId,
            ok: ev.ok,
          },
        })
      }
    }

    // ② 工作区执行日志（execution.log JSON Lines：工具调用轨迹）
    try {
      const { getWorkspaceRoot } = await import('../utils/webosWorkspace.js')
      const wsRoot = getWorkspaceRoot(userKey)
      const logFile = `${wsRoot}/logs/execution.log`
      const content = fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf-8') : ''
      for (const line of content.split('\n')) {
        if (!line.trim()) continue
        try {
          const rec = JSON.parse(line) as { ts?: string; tool?: string; params?: Record<string, unknown>; ok?: boolean; note?: string }
          const ts = rec.ts ? new Date(rec.ts).getTime() : 0
          if (!ts || ts < since) continue
          timeline.push({
            ts,
            source: 'exec',
            kind: String(rec.tool ?? 'tool'),
            detail: {
              ok: rec.ok,
              params: rec.params ?? {},
              note: rec.note,
            },
          })
        } catch { /* 单行解析失败跳过 */ }
      }
    } catch { /* 工作区不可读时跳过执行日志 */ }

    // ③ App 版本历史（版本创建/切换时间线）
    if (appId) {
      try {
        const { getPool: _gp } = await import('../db/connection.js')
        const stateRows = await pool.query(
          `SELECT data FROM entities WHERE id = $1`,
          [`webos-state:${userKey}`],
        )
        const state = JSON.parse(String(stateRows.rows[0]?.data ?? '{}')) as { apps?: Array<{ id?: string; name?: string; versions?: Array<{ version?: string; createdAt?: number; createdBy?: string; source?: string }> }> }
        for (const app of state.apps ?? []) {
          if (app.id !== appId) continue
          for (const version of app.versions ?? []) {
            const ts = Number(version.createdAt ?? 0)
            if (!ts || ts < since) continue
            timeline.push({
              ts,
              source: 'version',
              kind: `version_${String(version.version ?? '')}`,
              detail: {
                appId: app.id,
                name: app.name,
                createdBy: version.createdBy,
                source: version.source,
              },
            })
          }
        }
      } catch { /* 版本历史读取失败跳过 */ }
    }

    timeline.sort((a, b) => a.ts - b.ts)
    res.json({ userKey, conversationId, appId, hours, count: timeline.length, timeline })
  } catch (error) {
    next(error)
  }
})

// ============================================================================
// 2026-08-02 生图监测（webos_imagegen_usage）：模型调用是否正常、失败/超时统计
// ============================================================================

/** 生图定价信息（与 imagegen 模块一致；管理后台展示） */
adminWebosRouter.get('/imagegen/pricing', (_req, res) => {
  res.json(IMAGE_PRICING)
})

/** GET /api/admin/webos/imagegen/stats?days=7 — 生图调用汇总（成功率/失败/超时/耗时/费用） */
adminWebosRouter.get('/imagegen/stats', async (req, res, next) => {
  try {
    const pool = getPool()
    const days = Math.min(90, Math.max(1, Number(req.query.days) || 7))
    const since = Date.now() - days * 24 * 60 * 60 * 1000
    const rows = await pool.query(
      `SELECT status, error_code, duration_ms, total_tokens, cost_minor, created_at, images, n
       FROM webos_imagegen_usage WHERE created_at >= $1`,
      [since],
    )
    const total = rows.rows.length
    const byStatus: Record<string, number> = {}
    const byError: Record<string, number> = {}
    let okCount = 0
    let timeoutCount = 0
    let failedCount = 0
    let insufficientCount = 0
    let sumDuration = 0
    let okDuration = 0
    let okDurationN = 0
    let sumTokens = 0
    let sumCostMinor = 0
    let imagesProduced = 0
    const byDay: Record<string, { requests: number; ok: number; failed: number; tokens: number; costMinor: number }> = {}
    const byUser: Record<string, { requests: number; ok: number; failed: number }> = {}
    for (const row of rows.rows) {
      const status = String(row.status ?? 'ok')
      const day = new Date(Number(row.created_at)).toISOString().slice(0, 10)
      byStatus[status] = (byStatus[status] ?? 0) + 1
      byDay[day] ??= { requests: 0, ok: 0, failed: 0, tokens: 0, costMinor: 0 }
      byDay[day].requests += 1
      byDay[day].tokens += Number(row.total_tokens ?? 0)
      byDay[day].costMinor += Number(row.cost_minor ?? 0)
      sumTokens += Number(row.total_tokens ?? 0)
      sumCostMinor += Number(row.cost_minor ?? 0)
      imagesProduced += Number(row.images ?? 0)
      if (status === 'ok') {
        okCount += 1
        byDay[day].ok += 1
        okDuration += Number(row.duration_ms ?? 0)
        okDurationN += 1
      } else if (status === 'timeout') {
        timeoutCount += 1
        byDay[day].failed += 1
      } else if (status === 'insufficient') {
        insufficientCount += 1
      } else {
        failedCount += 1
        byDay[day].failed += 1
        const err = String(row.error_code ?? 'UNKNOWN')
        byError[err] = (byError[err] ?? 0) + 1
      }
      sumDuration += Number(row.duration_ms ?? 0)
      const userKey = String(row.user_key ?? '')
      byUser[userKey] ??= { requests: 0, ok: 0, failed: 0 }
      byUser[userKey].requests += 1
      if (status === 'ok') byUser[userKey].ok += 1
      else if (status !== 'insufficient') byUser[userKey].failed += 1
    }
    const failedTotal = failedCount + timeoutCount
    res.json({
      since,
      days,
      total,
      ok: okCount,
      failed: failedCount,
      timeout: timeoutCount,
      insufficient: insufficientCount,
      successRate: total > 0 ? Number((okCount / total * 100).toFixed(1)) : 100,
      avgDurationMs: total > 0 ? Math.round(sumDuration / total) : 0,
      avgOkDurationMs: okDurationN > 0 ? Math.round(okDuration / okDurationN) : 0,
      totalTokens: sumTokens,
      totalCostMinor: sumCostMinor,
      imagesProduced,
      byStatus: Object.entries(byStatus).sort(([a], [b]) => a.localeCompare(b)).map(([status, count]) => ({ status, count })),
      byError: Object.entries(byError).sort(([, a], [, b]) => b - a).map(([code, count]) => ({ code, count })),
      byDay: Object.entries(byDay).sort(([a], [b]) => a.localeCompare(b)).map(([day, value]) => ({ day, ...value })),
      byUser: Object.entries(byUser).sort(([, a], [, b]) => b.requests - a.requests).slice(0, 20)
        .map(([userKey, value]) => ({ userKey: `${userKey.slice(0, 24)}`, ...value })),
    })
  } catch (error) {
    next(error)
  }
})

/** GET /api/admin/webos/imagegen/usage?userKey=&page= — 生图调用明细（含错误与耗时） */
adminWebosRouter.get('/imagegen/usage', async (req, res, next) => {
  try {
    const userKey = typeof req.query.userKey === 'string' && req.query.userKey.length > 0 ? req.query.userKey : null
    const page = Math.max(1, Number(req.query.page) || 1)
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20))
    const pool = getPool()
    const params: unknown[] = []
    let where = ''
    if (userKey) {
      where = 'WHERE user_key = $1'
      params.push(userKey)
    }
    params.push(limit, (page - 1) * limit)
    const result = await pool.query(
      `SELECT id, user_key, user_email, kind, model, prompt, n, images,
              input_tokens, output_tokens, total_tokens, cost_minor,
              status, error_code, duration_ms, ip, created_at
       FROM webos_imagegen_usage ${where} ORDER BY created_at DESC LIMIT $${userKey ? 2 : 1} OFFSET $${userKey ? 3 : 2}`,
      params,
    )
    const countResult = await pool.query(
      `SELECT COUNT(*)::int AS cnt FROM webos_imagegen_usage ${where}`,
      userKey ? [userKey] : [],
    )
    res.json({
      page,
      total: Number(countResult.rows[0]?.cnt ?? 0),
      items: result.rows.map((row) => ({
        id: row.id,
        userKey: row.user_key,
        userEmail: row.user_email,
        kind: row.kind,
        model: row.model,
        prompt: String(row.prompt ?? '').slice(0, 120),
        n: Number(row.n ?? 1),
        images: Number(row.images ?? 0),
        inputTokens: Number(row.input_tokens ?? 0),
        outputTokens: Number(row.output_tokens ?? 0),
        totalTokens: Number(row.total_tokens ?? 0),
        costMinor: Number(row.cost_minor ?? 0),
        status: row.status,
        errorCode: row.error_code ?? null,
        durationMs: Number(row.duration_ms ?? 0),
        ip: row.ip ?? null,
        createdAt: Number(row.created_at),
      })),
    })
  } catch (error) {
    next(error)
  }
})

// ============================================================================
// PUT /api/admin/webos/credits { userKey, quota } — 调整用户积分额度
// （套餐开通 / 客服补偿 / 测试额度发放；quota<=0 表示封停；/tokens 为旧名兼容）
// ============================================================================

async function adjustCredits(req: Request, res: Response, quotaValue: unknown): Promise<void> {
  const body = req.body as { userKey?: unknown }
  const userKey = body.userKey
  if (!isUserKey(userKey)) {
    throw createError(400, 'INVALID_USER_KEY', 'userKey 格式不正确')
  }
  const quota = Math.floor(Number(quotaValue))
  if (!Number.isFinite(quota) || quota < 0) {
    throw createError(400, 'INVALID_QUOTA', 'quota 必须是非负整数')
  }
  const principal = await principalFromUserKey(userKey)
  const state = await loadState(principal)
  state.credits.quota = quota
  state.credits.used = Math.min(state.credits.used, quota)
  await saveState(principal, state)
  console.log(`[admin] credits adjusted: ${userKey.slice(0, 12)} → ${quota} (by ${clientIp(req)})`)
  res.json({
    ok: true,
    userKey,
    quota,
    remaining: Math.max(0, quota - state.credits.used),
  })
}

adminWebosRouter.put('/credits', async (req, res, next) => {
  try {
    await adjustCredits(req, res, (req.body as { quota?: unknown }).quota)
  } catch (error) {
    next(error)
  }
})

// 旧端点兼容：PUT /tokens 等价于 PUT /credits
adminWebosRouter.put('/tokens', async (req, res, next) => {
  try {
    await adjustCredits(req, res, (req.body as { quota?: unknown }).quota)
  } catch (error) {
    next(error)
  }
})

// ============================================================================
// 2026-08-05 视频生成统计 + 渠道充值记录（MiniMax-H3 / 秘塔渠道）
// - GET  /video/stats        渠道概览：充值总额 / 已消耗（秘塔价）/ 结余 / 任务数
// - GET  /video/usage        视频用量明细（分页，按用户/状态过滤）
// - POST /video/recharge     登记一次渠道充值（amountMinor 分，note 备注）
// ============================================================================

adminWebosRouter.get('/video/stats', async (_req, res, next) => {
  try {
    const pool = getPool()
    const [recharged, spent, count, byResolution, ir] = await Promise.all([
      pool.query('SELECT COALESCE(SUM(amount_minor), 0) AS total FROM webos_video_recharges'),
      pool.query('SELECT COALESCE(SUM(cost_metaso_minor), 0) AS total FROM webos_video_usage WHERE status = \'ok\' AND task_type = \'generation\''),
      pool.query('SELECT COUNT(*) AS n, COALESCE(SUM(CASE WHEN status = \'ok\' THEN 1 ELSE 0 END), 0) AS ok, COALESCE(SUM(CASE WHEN status != \'ok\' THEN 1 ELSE 0 END), 0) AS fail FROM webos_video_usage WHERE task_type = \'generation\''),
      pool.query('SELECT resolution, COUNT(*) AS n, COALESCE(SUM(cost_user_minor), 0) AS user_minor, COALESCE(SUM(cost_metaso_minor), 0) AS metaso_minor FROM webos_video_usage WHERE status = \'ok\' AND task_type = \'generation\' GROUP BY resolution'),
      // 2026-08-06 H3-Context-IR 独立统计（官方价折算成本；用户不单独扣费）
      pool.query('SELECT COUNT(*) AS n, COALESCE(SUM(cost_metaso_minor), 0) AS cost_minor FROM webos_video_usage WHERE task_type = \'h3_context_ir\''),
    ])
    const [editStats] = await Promise.all([
      // 2026-08-06 视频处理统计（edit_video，免费）
      pool.query('SELECT COUNT(*) AS n, COALESCE(SUM(CASE WHEN status = \'ok\' THEN 1 ELSE 0 END), 0) AS ok FROM webos_video_usage WHERE task_type = \'video_edit\''),
    ])
    const rechargedMinor = Number(recharged.rows[0]?.total ?? 0)
    const spentMinor = Number(spent.rows[0]?.total ?? 0)
    res.json({
      rechargedMinor,
      spentMinor,
      balanceMinor: rechargedMinor - spentMinor,
      taskCount: Number(count.rows[0]?.n ?? 0),
      okCount: Number(count.rows[0]?.ok ?? 0),
      failCount: Number(count.rows[0]?.fail ?? 0),
      byResolution: byResolution.rows.map((row) => ({
        resolution: String(row.resolution),
        count: Number(row.n ?? 0),
        userMinor: Number(row.user_minor ?? 0),
        metasoMinor: Number(row.metaso_minor ?? 0),
      })),
      // H3-Context-IR：次数 + 官方价折算成本（分）
      contextIR: {
        count: Number(ir.rows[0]?.n ?? 0),
        costMinor: Number(ir.rows[0]?.cost_minor ?? 0),
      },
      // 视频处理（edit_video）：次数（免费）
      videoEdit: {
        count: Number(editStats.rows[0]?.n ?? 0),
        okCount: Number(editStats.rows[0]?.ok ?? 0),
      },
      recharges: (await pool.query('SELECT id, amount_minor, note, created_at FROM webos_video_recharges ORDER BY created_at DESC LIMIT 50')).rows.map((row) => ({
        id: String(row.id),
        amountMinor: Number(row.amount_minor ?? 0),
        note: row.note ?? null,
        createdAt: Number(row.created_at),
      })),
    })
  } catch (error) {
    next(error)
  }
})

adminWebosRouter.get('/video/usage', async (req, res, next) => {
  try {
    const pool = getPool()
    const userKey = typeof req.query.userKey === 'string' ? req.query.userKey : ''
    const status = typeof req.query.status === 'string' ? req.query.status : ''
    const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50))
    const offset = Math.max(0, Number(req.query.offset) || 0)
    const where: string[] = []
    const params: unknown[] = []
    if (userKey) { params.push(userKey); where.push(`user_key = $${params.length}`) }
    if (status) { params.push(status); where.push(`status = $${params.length}`) }
    const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''
    const rows = await pool.query(
      `SELECT * FROM webos_video_usage ${whereSql} ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, offset],
    )
    res.json({
      items: rows.rows.map((row) => ({
        id: String(row.id),
        userKey: row.user_key,
        userEmail: row.user_email,
        kind: row.kind,
        model: row.model,
        taskType: row.task_type,
        resolution: row.resolution,
        duration: Number(row.duration ?? 0),
        imageCount: Number(row.image_count ?? 0),
        enhance: Number(row.enhance ?? 0) === 1,
        prompt: String(row.prompt ?? '').slice(0, 120),
        taskId: row.task_id ?? null,
        videoPath: row.video_path ?? null,
        costUserMinor: Number(row.cost_user_minor ?? 0),
        costMetasoMinor: Number(row.cost_metaso_minor ?? 0),
        status: row.status,
        errorCode: row.error_code ?? null,
        durationMs: Number(row.duration_ms ?? 0),
        ip: row.ip ?? null,
        createdAt: Number(row.created_at),
      })),
    })
  } catch (error) {
    next(error)
  }
})

adminWebosRouter.post('/video/recharge', async (req, res, next) => {
  try {
    const body = req.body as { amountMinor?: unknown; note?: unknown }
    const amountMinor = Math.floor(Number(body.amountMinor))
    if (!Number.isFinite(amountMinor) || amountMinor <= 0) {
      throw createError(400, 'INVALID_AMOUNT', 'amountMinor 必须为正整数（分）')
    }
    const pool = getPool()
    const { randomUUID } = await import('node:crypto')
    await pool.query(
      'INSERT INTO webos_video_recharges (id, amount_minor, note, created_at) VALUES ($1, $2, $3, $4)',
      [`rec-${randomUUID()}`, amountMinor, typeof body.note === 'string' ? body.note.slice(0, 200) : null, Date.now()],
    )
    console.log(`[admin] video recharge recorded: ¥${(amountMinor / 100).toFixed(2)} (by ${clientIp(req)})`)
    res.json({ ok: true, amountMinor, message: '充值记录已登记' })
  } catch (error) {
    next(error)
  }
})

// ============================================================================
// 2026-08-12 爱发电兑换码管理（站长在爱发电后台生成兑换码 → 导入本表 → 用户兑换）
// - POST /redeem-codes/import  批量导入（code + planId）
// - GET  /redeem-codes         列表（status 过滤）
// - POST /redeem-codes/revoke  撤销兑换码（已导入未使用的作废）
// ============================================================================

/** 批量导入兑换码（body: { items: [{code, planId, note?}], planId? }；planId 缺省时统一用顶层） */
adminWebosRouter.post('/redeem-codes/import', async (req, res, next) => {
  try {
    const body = req.body as { items?: unknown; planId?: unknown; codes?: unknown; note?: unknown }
    const defaultPlanId = String(body.planId ?? '').trim()
    const items: Array<{ code: string; planId: string; note?: string }> = []
    const rawItems = Array.isArray(body.items) ? body.items
      : Array.isArray(body.codes) ? (body.codes as unknown[]).map((c) => ({ code: c }))
        : []
    for (const raw of rawItems) {
      const item = raw as Record<string, unknown>
      const code = String(item.code ?? item.redeem_id ?? '').trim()
      const planId = String(item.planId ?? item.plan_id ?? defaultPlanId).trim()
      if (code) items.push({ code, planId, note: String(item.note ?? body.note ?? '') || undefined })
    }
    if (items.length === 0) throw createError(400, 'EMPTY_REDEEM_LIST', '没有可导入的兑换码')
    const result = await importRedeemCodes(items)
    console.log(`[admin] redeem codes imported: ${result.imported} (skipped ${result.skipped}) by ${clientIp(req)}`)
    res.json({ ok: true, ...result })
  } catch (error) {
    next(error)
  }
})

/** 兑换码列表（?status=unused|used|revoked&page=&limit=） */
adminWebosRouter.get('/redeem-codes', async (req, res, next) => {
  try {
    const status = typeof req.query.status === 'string' && req.query.status ? String(req.query.status) : undefined
    const page = Math.max(1, Number(req.query.page) || 1)
    const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50))
    const result = await listRedeemCodes({ status, limit, offset: (page - 1) * limit })
    res.json({ ...result, page, limit })
  } catch (error) {
    next(error)
  }
})

/** 撤销兑换码（body: { codes: string[] }，仅未使用可撤销） */
adminWebosRouter.post('/redeem-codes/revoke', async (req, res, next) => {
  try {
    const body = req.body as { codes?: unknown }
    const codes = (Array.isArray(body.codes) ? body.codes : []).map((c) => String(c).trim()).filter(Boolean)
    if (codes.length === 0) throw createError(400, 'EMPTY_REDEEM_LIST', '没有要撤销的兑换码')
    const pool = getPool()
    let revoked = 0
    for (const code of codes) {
      const before = await findRedeemCode(code)
      if (!before || String(before.status ?? '') !== 'unused') continue
      await pool.query(
        `UPDATE webos_redeem_codes SET status = 'revoked', updated_at = $2 WHERE LOWER(code) = LOWER($1) AND status = 'unused'`,
        [code, Date.now()],
      )
      revoked += 1
    }
    console.log(`[admin] redeem codes revoked: ${revoked} by ${clientIp(req)}`)
    res.json({ ok: true, revoked })
  } catch (error) {
    next(error)
  }
})

// ============================================================================
// GET /api/admin/webos/vision/stats?days=7 — MiniMax-M3 视觉桥接用量汇总
// 2026-08-14：AI 的眼睛（DeepSeek 非视觉 → M3 描述图片/视频）。统计平台
// 在 M3 上的实时消耗（金额 + token），按天/按用户/按触发方式分布。
// ============================================================================

adminWebosRouter.get('/vision/stats', async (req, res, next) => {
  try {
    const pool = getPool()
    const days = Math.min(90, Math.max(1, Number(req.query.days) || 7))
    const since = Date.now() - days * 24 * 60 * 60 * 1000

    const rows = await pool.query(
      `SELECT user_key, user_email, trigger, kind, status, media_count,
              input_tokens, output_tokens, cached_tokens, total_tokens, cost_minor, created_at
       FROM webos_vision_usage WHERE created_at >= $1`,
      [since],
    )

    const total = { calls: 0, ok: 0, failed: 0, media: 0, inputTokens: 0, outputTokens: 0, cachedTokens: 0, totalTokens: 0, costMinor: 0 }
    const byDay: Record<string, { calls: number; ok: number; failed: number; tokens: number; costMinor: number }> = {}
    const byUser: Record<string, { userKey: string; userEmail: string | null; calls: number; ok: number; tokens: number; costMinor: number }> = {}
    const byTrigger: Record<string, { calls: number; tokens: number; costMinor: number }> = {}
    const byKind: Record<string, number> = {}
    const byStatus: Record<string, number> = {}

    for (const row of rows.rows) {
      const status = String(row.status ?? 'ok')
      const tokens = Number(row.total_tokens ?? 0)
      const costMinor = Number(row.cost_minor ?? 0)
      total.calls += 1
      if (status === 'ok') total.ok += 1
      else total.failed += 1
      total.media += Number(row.media_count ?? 0)
      total.inputTokens += Number(row.input_tokens ?? 0)
      total.outputTokens += Number(row.output_tokens ?? 0)
      total.cachedTokens += Number(row.cached_tokens ?? 0)
      total.totalTokens += tokens
      total.costMinor += costMinor

      const day = new Date(Number(row.created_at)).toISOString().slice(0, 10)
      byDay[day] ??= { calls: 0, ok: 0, failed: 0, tokens: 0, costMinor: 0 }
      byDay[day].calls += 1
      if (status === 'ok') byDay[day].ok += 1
      else byDay[day].failed += 1
      byDay[day].tokens += tokens
      byDay[day].costMinor += costMinor

      const userKey = String(row.user_key ?? 'unknown')
      byUser[userKey] ??= { userKey, userEmail: row.user_email ? String(row.user_email) : null, calls: 0, ok: 0, tokens: 0, costMinor: 0 }
      byUser[userKey].calls += 1
      if (status === 'ok') byUser[userKey].ok += 1
      byUser[userKey].tokens += tokens
      byUser[userKey].costMinor += costMinor

      const trigger = String(row.trigger ?? 'chat_bridge')
      byTrigger[trigger] ??= { calls: 0, tokens: 0, costMinor: 0 }
      byTrigger[trigger].calls += 1
      byTrigger[trigger].tokens += tokens
      byTrigger[trigger].costMinor += costMinor

      byKind[String(row.kind ?? 'image')] = (byKind[String(row.kind ?? 'image')] ?? 0) + 1
      byStatus[status] = (byStatus[status] ?? 0) + 1
    }

    res.json({
      days,
      since,
      total,
      byDay: Object.entries(byDay).sort(([a], [b]) => a.localeCompare(b)).map(([day, value]) => ({ day, ...value })),
      byUser: Object.values(byUser).sort((a, b) => b.costMinor - a.costMinor).slice(0, 20),
      byTrigger,
      byKind,
      byStatus,
      pricing: { model: 'MiniMax-M3', inputPerMillion: 2.1, outputPerMillion: 8.4, cacheReadPerMillion: 0.42, note: '官方永久五折价（2026-08-12）' },
    })
  } catch (error) {
    next(error)
  }
})

// ============================================================================
// GET /api/admin/webos/vision/usage?userKey=&page=&limit= — 视觉桥接用量明细
// ============================================================================

adminWebosRouter.get('/vision/usage', async (req, res, next) => {
  try {
    const userKey = req.query.userKey ? String(req.query.userKey).slice(0, 96) : null
    if (userKey && !isUserKey(userKey)) {
      next(createError(400, 'INVALID_USER_KEY', 'userKey 格式不正确'))
      return
    }
    const page = Math.max(1, Number(req.query.page) || 1)
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 30))
    const pool = getPool()
    const params: unknown[] = []
    let where = '1=1'
    if (userKey) {
      params.push(userKey)
      where = `user_key = $${params.length}`
    }
    params.push(limit, (page - 1) * limit)
    const result = await pool.query(
      `SELECT id, user_key, user_email, request_id, conversation_id, trigger, kind, media_count,
              prompt, description, input_tokens, output_tokens, cached_tokens, total_tokens,
              cost_minor, status, error_code, error_message, duration_ms, ip, created_at
       FROM webos_vision_usage WHERE ${where} ORDER BY created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    )
    const countParams: unknown[] = []
    if (userKey) countParams.push(userKey)
    const countResult = await pool.query(
      userKey
        ? 'SELECT COUNT(*) AS cnt FROM webos_vision_usage WHERE user_key = $1'
        : 'SELECT COUNT(*) AS cnt FROM webos_vision_usage',
      countParams,
    )
    res.json({
      userKey: userKey ?? null,
      page,
      total: Number(countResult.rows[0]?.cnt ?? 0),
      items: result.rows.map((row) => ({
        id: row.id,
        userKey: row.user_key,
        userEmail: row.user_email ?? null,
        requestId: row.request_id ?? null,
        conversationId: row.conversation_id ?? null,
        trigger: row.trigger,
        kind: row.kind,
        mediaCount: Number(row.media_count ?? 0),
        prompt: row.prompt ?? null,
        description: row.description ?? null,
        inputTokens: Number(row.input_tokens ?? 0),
        outputTokens: Number(row.output_tokens ?? 0),
        cachedTokens: Number(row.cached_tokens ?? 0),
        totalTokens: Number(row.total_tokens ?? 0),
        costMinor: Number(row.cost_minor ?? 0),
        status: row.status,
        errorCode: row.error_code ?? null,
        errorMessage: row.error_message ?? null,
        durationMs: Number(row.duration_ms ?? 0),
        ip: row.ip ?? null,
        createdAt: Number(row.created_at),
      })),
    })
  } catch (error) {
    next(error)
  }
})
// ============================================================================
// GET /api/admin/webos/stats/activity?days=30 — 日活/月活（DAU/MAU）统计
// 活跃口径（2026-08-17）：当天/当月有任意 chat/stream 或工具调用即活跃，按
// user_key 去重（guest:<deviceId> / user:<userId>），guest/member 分开统计。
// 数据来源（并集去重）：webos_chat_sessions（一次 chat/stream 一行，含工具事件）
// + webos_chat_logs + webos_ai_usage + webos_imagegen_usage + webos_video_usage
// + webos_vision_usage。时区按 Asia/Shanghai（UTC+8）切日/切月（产品面向国内用户）。
// ============================================================================

const ACTIVITY_TZ_OFFSET_MS = 8 * 3600 * 1000

/** UTC+8 时区下的「日序号」（1970-01-01 起第几天） */
function activityDayIndex(ts: number): number {
  return Math.floor((ts + ACTIVITY_TZ_OFFSET_MS) / 86400000)
}

/** 日序号 → YYYY-MM-DD（UTC+8；dayIdx 是 ts+8h 的 UTC 日序号，日界 = dayIdx*86400000） */
function activityDayDate(dayIdx: number): string {
  return new Date(dayIdx * 86400000).toISOString().slice(0, 10)
}

/** 时间戳 → YYYY-MM（UTC+8 当月） */
function activityMonthOf(ts: number): string {
  return new Date(ts + ACTIVITY_TZ_OFFSET_MS).toISOString().slice(0, 7)
}

interface ActivityBucket {
  total: Set<string>
  guest: Set<string>
  member: Set<string>
  tool: Set<string>
}

function activityBucket(): ActivityBucket {
  return { total: new Set(), guest: new Set(), member: new Set(), tool: new Set() }
}

adminWebosRouter.get('/stats/activity', async (req, res, next) => {
  try {
    const pool = getPool()
    const days = Math.min(90, Math.max(1, Number(req.query.days) || 30))

    // DAU 窗口起点（含今天）+ 当月/上月起点：一次查询覆盖全部所需数据
    const now = Date.now()
    const todayIdx = activityDayIndex(now)
    const nowShifted = new Date(now + ACTIVITY_TZ_OFFSET_MS)
    const monthStart = Date.UTC(nowShifted.getUTCFullYear(), nowShifted.getUTCMonth(), 1) - ACTIVITY_TZ_OFFSET_MS
    const prevMonthStart = Date.UTC(nowShifted.getUTCFullYear(), nowShifted.getUTCMonth() - 1, 1) - ACTIVITY_TZ_OFFSET_MS
    const daysStart = (todayIdx - (days - 1)) * 86400000 - ACTIVITY_TZ_OFFSET_MS
    const since = Math.min(daysStart, monthStart, prevMonthStart)

    // 活跃来源表：只取 user_key + created_at 两列（会话表额外取工具事件标记），
    // 与 vision/stats 的「取行 + JS 聚合」风格一致，PG/SQLite 双驱动通用；
    // LIKE 判断在库里完成，避免把 events（含 reasoning 大字段）拉回内存。
    const sources: Array<{ table: string; toolColumn?: string }> = [
      { table: 'webos_ai_usage' },
      { table: 'webos_chat_logs' },
      { table: 'webos_chat_sessions', toolColumn: 'events' },
      { table: 'webos_imagegen_usage' },
      { table: 'webos_video_usage' },
      { table: 'webos_vision_usage' },
    ]

    const byDay = new Map<number, ActivityBucket>()
    const byMonth = new Map<string, ActivityBucket>()
    const bySource = new Map<string, { usersWindow: Set<string>; usersMonth: Set<string> }>()
    const curMonth = activityMonthOf(now)
    const prevMonth = activityMonthOf(monthStart - 1)

    for (const source of sources) {
      const selectTool = source.toolColumn
        ? `, (${source.toolColumn} LIKE '%tool_start%') AS used_tool`
        : ''
      const rows = await pool.query(
        `SELECT user_key, created_at${selectTool} FROM ${source.table} WHERE created_at >= $1`,
        [since],
      )
      const sourceAgg = bySource.get(source.table) ?? { usersWindow: new Set<string>(), usersMonth: new Set<string>() }
      bySource.set(source.table, sourceAgg)

      for (const row of rows.rows) {
        const userKey = row.user_key ? String(row.user_key) : ''
        if (!userKey) continue
        const createdAt = Number(row.created_at)
        if (!Number.isFinite(createdAt)) continue
        const dayIdx = activityDayIndex(createdAt)

        if (dayIdx >= todayIdx - (days - 1) && dayIdx <= todayIdx) {
          const day = byDay.get(dayIdx) ?? activityBucket()
          byDay.set(dayIdx, day)
          day.total.add(userKey)
          if (userKey.startsWith('guest:')) day.guest.add(userKey)
          else if (userKey.startsWith('user:')) day.member.add(userKey)
          if (source.toolColumn && Boolean(row.used_tool)) day.tool.add(userKey)
          sourceAgg.usersWindow.add(userKey)
        }

        const month = activityMonthOf(createdAt)
        if (month === curMonth || month === prevMonth) {
          const m = byMonth.get(month) ?? activityBucket()
          byMonth.set(month, m)
          m.total.add(userKey)
          if (userKey.startsWith('guest:')) m.guest.add(userKey)
          else if (userKey.startsWith('user:')) m.member.add(userKey)
        }
        if (month === curMonth) sourceAgg.usersMonth.add(userKey)
      }
    }

    // DAU 序列（无数据的天补 0，保证图表连续）
    const dau: Array<{ day: string; total: number; guest: number; member: number; tool: number }> = []
    for (let i = todayIdx - (days - 1); i <= todayIdx; i++) {
      const d = byDay.get(i)
      dau.push({
        day: activityDayDate(i),
        total: d?.total.size ?? 0,
        guest: d?.guest.size ?? 0,
        member: d?.member.size ?? 0,
        tool: d?.tool.size ?? 0,
      })
    }

    // 窗口内活跃用户（按天 union）
    const windowUsers = activityBucket()
    for (const d of byDay.values()) {
      for (const k of d.total) windowUsers.total.add(k)
      for (const k of d.guest) windowUsers.guest.add(k)
      for (const k of d.member) windowUsers.member.add(k)
    }

    const mauBucket = byMonth.get(curMonth) ?? activityBucket()
    const prevMauBucket = byMonth.get(prevMonth) ?? activityBucket()

    // 趋势（7/30 天对比）
    const values = dau.map((d) => d.total)
    const avg = (arr: number[]): number => (arr.length === 0 ? 0 : arr.reduce((a, b) => a + b, 0) / arr.length)
    const pct = (cur: number, base: number): number =>
      base > 0 ? Math.round(((cur - base) / base) * 1000) / 10 : cur > 0 ? 100 : 0
    const avg7 = avg(values.slice(-7))
    const avg30 = avg(values)
    const avgPrev7 = avg(values.slice(-14, -7))
    let peak = { day: dau[0]?.day ?? '', total: 0 }
    for (const d of dau) if (d.total > peak.total) peak = { day: d.day, total: d.total }

    res.json({
      days,
      timezone: 'Asia/Shanghai (UTC+8)',
      generatedAt: now,
      sources: sources.map((s) => s.table),
      dau,
      activeUsersWindow: { total: windowUsers.total.size, guest: windowUsers.guest.size, member: windowUsers.member.size },
      mau: { month: curMonth, total: mauBucket.total.size, guest: mauBucket.guest.size, member: mauBucket.member.size },
      mauPrevMonth: { month: prevMonth, total: prevMauBucket.total.size, guest: prevMauBucket.guest.size, member: prevMauBucket.member.size },
      trend: {
        today: dau[dau.length - 1] ?? null,
        yesterday: dau.length >= 2 ? dau[dau.length - 2] : null,
        avg7: Math.round(avg7 * 10) / 10,
        avgPrev7: Math.round(avgPrev7 * 10) / 10,
        avg30: Math.round(avg30 * 10) / 10,
        todayVsAvg7Pct: pct(dau[dau.length - 1]?.total ?? 0, avg7),
        todayVsAvg30Pct: pct(dau[dau.length - 1]?.total ?? 0, avg30),
        weekOverWeekPct: pct(avg7, avgPrev7),
        peak,
        mauChangePct: pct(mauBucket.total.size, prevMauBucket.total.size),
      },
      bySource: Object.fromEntries(
        [...bySource.entries()].map(([table, agg]) => [
          table,
          { activeUsersWindow: agg.usersWindow.size, activeUsersMonth: agg.usersMonth.size },
        ]),
      ),
    })
  } catch (error) {
    next(error)
  }
})

// ============================================================================
// GET /api/admin/webos/search-stats?days=7 — 搜索 API 状态可视化（2026-08-17）
//
// 数据源：api_usage_log（搜索工具每次调用写一条：时间/用户/引擎/query/成败/耗时/来源）。
// 返回：整体统计 + 按引擎 + 按来源工具 + 按天趋势 + 按用户 TOP + 失败样例。
// 引擎 provider：metaso（秘塔搜索 web_search/read_webpage）、arxiv（academic_search）、
// github（github_search）；github_proxy 为 GitHub 下载代理（不属搜索工具，谨慎区分）。
// ============================================================================

const SEARCH_ENGINE_LABEL: Record<string, string> = {
  metaso: '秘塔搜索',
  arxiv: '学术搜索(ArXiv)',
  github: 'GitHub搜索',
  github_proxy: 'GitHub代理下载',
  local: '本地搜索',
}

function searchEngineDisplay(provider: string): string {
  return SEARCH_ENGINE_LABEL[provider] ?? provider
}

/** 失败样例展示用的 query（截断，避免表格撑爆） */
function truncateSearchQuery(value: unknown, max = 80): string | null {
  if (value === null || value === undefined) return null
  const text = String(value)
  return text.length > max ? `${text.slice(0, max)}…` : text
}

adminWebosRouter.get('/search-stats', async (req, res, next) => {
  try {
    const pool = getPool()
    const days = Math.min(90, Math.max(1, Number(req.query.days) || 7))
    const since = Date.now() - days * 24 * 60 * 60 * 1000

    // 时间窗内全部记录（api_usage_log 行数可控：搜索调用低频，全量拉取后内存聚合）
    const rows = await pool.query(
      `SELECT provider, endpoint, status, latency_ms, error_msg, credits_consumed, user_key, query, tool, created_at
       FROM api_usage_log WHERE created_at >= $1`,
      [since],
    )

    const total = { calls: 0, ok: 0, failed: 0, latencyMsSum: 0, okLatencyMsSum: 0, creditsConsumed: 0 }
    const byEngine: Record<string, { calls: number; ok: number; failed: number; latencyMsSum: number; okLatencyMsSum: number; creditsConsumed: number; lastCallAt: number | null }> = {}
    const byTool: Record<string, { calls: number; ok: number; failed: number }> = {}
    const byDay: Record<string, { calls: number; ok: number; failed: number }> = {}
    const byUser: Record<string, { userKey: string; calls: number; ok: number; failed: number }> = {}
    const failures: Array<{
      id: unknown
      createdAt: number
      provider: string
      tool: string | null
      userKey: string | null
      query: string | null
      endpoint: string
      latencyMs: number | null
      errorMsg: string | null
    }> = []

    for (const row of rows.rows) {
      const provider = String(row.provider ?? 'unknown')
      const status = String(row.status ?? 'ok')
      const latency = row.latency_ms !== null && row.latency_ms !== undefined ? Number(row.latency_ms) : null
      const credits = Number(row.credits_consumed ?? 0)
      const ok = status === 'ok'

      total.calls += 1
      if (ok) total.ok += 1
      else total.failed += 1
      if (latency !== null) total.latencyMsSum += latency
      if (ok && latency !== null) total.okLatencyMsSum += latency
      total.creditsConsumed += credits

      byEngine[provider] ??= { calls: 0, ok: 0, failed: 0, latencyMsSum: 0, okLatencyMsSum: 0, creditsConsumed: 0, lastCallAt: null }
      const eng = byEngine[provider]
      eng.calls += 1
      if (ok) eng.ok += 1
      else eng.failed += 1
      if (latency !== null) eng.latencyMsSum += latency
      if (ok && latency !== null) eng.okLatencyMsSum += latency
      eng.creditsConsumed += credits
      const created = Number(row.created_at ?? 0)
      if (created > (eng.lastCallAt ?? 0)) eng.lastCallAt = created

      const tool = row.tool ? String(row.tool) : null
      byTool[tool ?? provider] ??= { calls: 0, ok: 0, failed: 0 }
      byTool[tool ?? provider].calls += 1
      if (ok) byTool[tool ?? provider].ok += 1
      else byTool[tool ?? provider].failed += 1

      const day = new Date(created).toISOString().slice(0, 10)
      byDay[day] ??= { calls: 0, ok: 0, failed: 0 }
      byDay[day].calls += 1
      if (ok) byDay[day].ok += 1
      else byDay[day].failed += 1

      const userKey = row.user_key ? String(row.user_key) : null
      if (userKey) {
        byUser[userKey] ??= { userKey, calls: 0, ok: 0, failed: 0 }
        byUser[userKey].calls += 1
        if (ok) byUser[userKey].ok += 1
        else byUser[userKey].failed += 1
      }

      if (!ok && failures.length < 20) {
        failures.push({
          id: row.id,
          createdAt: created,
          provider,
          tool,
          userKey,
          query: truncateSearchQuery(row.query),
          endpoint: String(row.endpoint ?? ''),
          latencyMs: latency,
          errorMsg: row.error_msg ? String(row.error_msg) : null,
        })
      }
    }

    const pct = (okCount: number, calls: number): number => (calls > 0 ? Math.round((okCount / calls) * 1000) / 10 : 100)
    const avg = (sum: number, count: number): number => (count > 0 ? Math.round(sum / count) : 0)

    res.json({
      days,
      since,
      total: {
        calls: total.calls,
        ok: total.ok,
        failed: total.failed,
        successRate: pct(total.ok, total.calls),
        avgLatencyMs: avg(total.latencyMsSum, total.calls),
        avgOkLatencyMs: avg(total.okLatencyMsSum, total.ok),
        creditsConsumed: total.creditsConsumed,
      },
      byEngine: Object.entries(byEngine)
        .sort(([, a], [, b]) => b.calls - a.calls)
        .map(([provider, e]) => ({
          provider,
          displayName: searchEngineDisplay(provider),
          calls: e.calls,
          ok: e.ok,
          failed: e.failed,
          successRate: pct(e.ok, e.calls),
          avgLatencyMs: avg(e.latencyMsSum, e.calls),
          avgOkLatencyMs: avg(e.okLatencyMsSum, e.ok),
          creditsConsumed: e.creditsConsumed,
          lastCallAt: e.lastCallAt,
        })),
      byTool: Object.entries(byTool)
        .sort(([, a], [, b]) => b.calls - a.calls)
        .map(([tool, t]) => ({ tool, calls: t.calls, ok: t.ok, failed: t.failed, successRate: pct(t.ok, t.calls) })),
      byDay: Object.entries(byDay)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([day, d]) => ({ day, calls: d.calls, ok: d.ok, failed: d.failed })),
      byUser: Object.values(byUser).sort((a, b) => b.calls - a.calls).slice(0, 20),
      failures,
    })
  } catch (error) {
    next(error)
  }
})
