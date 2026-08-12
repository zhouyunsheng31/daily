// ============================================================================
// 爱发电（ifdian.net）支付模块（2026-08-06）
// ----------------------------------------------------------------------------
// 双通道：
// 1. Webhook（主）：创作者后台配置 URL，有订单时爱发电 POST 推送；
//    RSA-SHA256 验签（公钥来自官方文档，2025-07-01 起 webhook 带 sign）。
// 2. API 轮询（兜底）：query-order 拉最近订单对账补漏（文档建议双通道）。
//
// 档位（2026-08-06 站长在爱发电后台创建）：
//   轻量月卡 ¥9.9 = 1000 积分/月 · 中量月卡 ¥29 = 3200/月 · 重量月卡 ¥99 = 10800/月
//   尝鲜用量包 ¥5 = 500 积分永久（一次性，每人限购一次）
// 发货语义：
//   月卡：credits.monthly 记录档位+到期时间；当月额度到期作废，续费重新给满
//   尝鲜包：credits.permanent 永久池 +500（重复购买不重复发放）
// 用户识别：订单留言（remark）填注册邮箱 → users.email 匹配 → scope=user:<id>
// ============================================================================

import crypto from 'node:crypto'
import { getPool } from '../db/connection.js'
import { loadState, saveState, type Principal } from '../routes/webos.js'
import { WORKSPACE_TIER_BYTES } from '../utils/webosWorkspace.js'
import { createError } from '../middleware/error.js'

// ---------------------------------------------------------------------------
// 档位定义（plan_id 由爱发电后台生成，2026-08-06 实测获取）
// ---------------------------------------------------------------------------

export interface AfdianTier {
  planId: string
  name: string
  priceYuan: number
  /** monthly=订阅月卡（每月给满额度、到期作废）；pack=一次性用量包（永久） */
  kind: 'monthly' | 'pack'
  /** 2026-08-12 商品类型：1=售卖型（兑换码商品，下单走 product_type=1&product_id=）；
   *  缺省 0=赞助方案（下单走 plan_id=）。当前 4 个档位全是兑换码商品（售卖型）。 */
  productType?: number
  /** 月卡：每月发放积分 */
  monthlyCredits?: number
  /** 用量包：一次性发放积分 */
  packCredits?: number
}

export const AFDIAN_TIERS: AfdianTier[] = [
  // 2026-08-12 兑换码商品（站长在爱发电后台创建，买家付款后获得兑换码 →
  // 在 Daily 个人中心输入兑换码领取权益）。plan_id 已在后台验证有效。
  { planId: '2aeac1b692e211f1972b5254001e7c00', name: '轻量月卡·兑换码', priceYuan: 9.9, kind: 'monthly', productType: 1, monthlyCredits: 1000 },
  { planId: '2c0d304292e211f19b9f5254001e7c00', name: '中量月卡·兑换码', priceYuan: 29, kind: 'monthly', productType: 1, monthlyCredits: 3200 },
  { planId: '2d295a7892e211f1a2f85254001e7c00', name: '重量月卡·兑换码', priceYuan: 99, kind: 'monthly', productType: 1, monthlyCredits: 10800 },
  { planId: '7f42517e918511f19bde5254001e7c00', name: '尝鲜用量包', priceYuan: 5, kind: 'pack', productType: 1, packCredits: 500 },
]

/**
 * 旧订阅档位（2026-08-06 创建，现已被兑换码商品替代；隐藏于后台但仍有老订阅用户，
 * 订单继续按留言邮箱发货，发货逻辑必须保留兼容）。
 */
const LEGACY_SUBSCRIBE_TIERS: AfdianTier[] = [
  { planId: 'db929ac0918411f1926052540025c377', name: '轻量月卡', priceYuan: 9.9, kind: 'monthly', monthlyCredits: 1000 },
  { planId: 'f77af912918411f1923c52540025c377', name: '中量月卡', priceYuan: 29, kind: 'monthly', monthlyCredits: 3200 },
  { planId: '0f7ca114918511f1a34e52540025c377', name: '重量月卡', priceYuan: 99, kind: 'monthly', monthlyCredits: 10800 },
  { planId: '1646bd9a8ea111f1ac995254001e7c00', name: '轻量支持', priceYuan: 9.9, kind: 'monthly', monthlyCredits: 1000 },
]

export function afdianTierByPlanId(planId: string): AfdianTier | null {
  return AFDIAN_TIERS.find((t) => t.planId === planId)
    ?? LEGACY_SUBSCRIBE_TIERS.find((t) => t.planId === planId)
    ?? null
}

// ---------------------------------------------------------------------------
// Webhook RSA 验签（公钥：爱发电开发者文档，2025-07-01 起 webhook 携带 sign）
// sign_str = out_trade_no + user_id + plan_id + total_amount 依次拼接
// 签名算法：RSA-SHA256（base64）
// ---------------------------------------------------------------------------

const AFDIAN_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAwwdaCg1Bt+UKZKs0R54y
lYnuANma49IpgoOwNmk3a0rhg/PQuhUJ0EOZSowIC44l0K3+fqGns3Ygi4AfmEfS
4EKbdk1ahSxu7Zkp2rHMt+R9GarQFQkwSS/5x1dYiHNVMiR8oIXDgjmvxuNes2Cr
8fw9dEF0xNBKdkKgG2qAawcN1nZrdyaKWtPVT9m2Hl0ddOO9thZmVLFOb9NVzgYf
jEgI+KWX6aY19Ka/ghv/L4t1IXmz9pctablN5S0CRWpJW3Cn0k6zSXgjVdKm4uN7
jRlgSRaf/Ind46vMCm3N2sgwxu/g3bnooW+db0iLo13zzuvyn727Q3UDQ0MmZcEW
MQIDAQAB
-----END PUBLIC KEY-----`

/** 验签：返回是否通过（sign_str = out_trade_no+user_id+plan_id+total_amount） */
export function verifyAfdianWebhookSign(order: {
  out_trade_no: string
  user_id: string
  plan_id: string
  total_amount: string
}, signB64: string): boolean {
  try {
    const signStr = `${order.out_trade_no}${order.user_id}${order.plan_id}${order.total_amount}`
    const verifier = crypto.createVerify('RSA-SHA256')
    verifier.update(signStr)
    verifier.end()
    return verifier.verify(AFDIAN_PUBLIC_KEY, signB64, 'base64')
  } catch {
    return false
  }
}

// ---------------------------------------------------------------------------
// 订单落库（幂等：out_trade_no 主键）+ 发货
// ---------------------------------------------------------------------------

export interface AfdianOrderPayload {
  out_trade_no: string
  user_id: string
  plan_id: string
  month?: number
  total_amount: string
  show_amount?: string
  status?: number
  remark?: string
  product_type?: number
  custom_order_id?: string
  /** 2026-08-12 兑换码商品订单：非空 = 该订单通过兑换码发货（买家订单里的 redeem_id） */
  redeem_id?: string | null
}

interface StoredStateLike {
  workspaceBytes?: number
  credits: {
    quota: number
    used: number
    monthly?: {
      planId: string
      planName: string
      monthlyCredits: number
      expiresAt: number
      lastGrantAt: number
    } | null
    permanent?: { quota: number; used: number }
    afdianRedeem?: Array<Record<string, unknown>>
  }
}

async function upsertOrder(order: AfdianOrderPayload, channel: 'webhook' | 'api', raw: string): Promise<boolean> {
  try {
    const pool = getPool()
    const now = Date.now()
    await pool.query(
      `INSERT INTO webos_afdian_orders
        (out_trade_no, user_id, plan_id, product_type, amount, month, remark, status, channel, raw, redeem_id, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$12)
       ON CONFLICT (out_trade_no) DO UPDATE SET
         status = EXCLUDED.status, remark = COALESCE(NULLIF(EXCLUDED.remark, ''), webos_afdian_orders.remark),
         redeem_id = COALESCE(NULLIF(EXCLUDED.redeem_id, ''), webos_afdian_orders.redeem_id),
         updated_at = EXCLUDED.updated_at`,
      [
        order.out_trade_no, order.user_id ?? null, order.plan_id, order.product_type ?? 0,
        order.total_amount, order.month ?? 1, order.remark ?? '', order.status ?? 2,
        channel, String(raw).slice(0, 2000),
        // 2026-08-12 兑换码商品订单：redeem_id 非空（买家订单里的兑换码，用户凭它主动兑换）
        String((order as unknown as Record<string, unknown>).redeem_id ?? '') || null,
        now,
      ],
    )
    return true
  } catch (error) {
    console.warn('[afdian] upsertOrder failed:', error instanceof Error ? error.message : String(error))
    return false
  }
}

/** 按留言邮箱匹配 Daily 账号（users.email 精确匹配，忽略大小写与空白） */
async function findUserByEmail(email: string): Promise<{ key: string; id: string } | null> {
  try {
    const normalized = String(email ?? '').trim().toLowerCase()
    if (!normalized || !normalized.includes('@')) return null
    const pool = getPool()
    const rows = await pool.query('SELECT id FROM users WHERE LOWER(email) = $1 LIMIT 1', [normalized])
    const id = rows.rows?.[0]?.id ?? null
    if (!id) return null
    return { key: `user:${id}`, id: String(id) }
  } catch {
    return null
  }
}

/** 更新订单发货状态 */
async function markDelivered(outTradeNo: string, matchedUser: string | null, matchMode: string, credits: number, error?: string): Promise<void> {
  try {
    const pool = getPool()
    const now = Date.now()
    await pool.query(
      `UPDATE webos_afdian_orders SET delivered = 1, delivered_at = $2, matched_user = $3, match_mode = $4, credits = $5, error = $6, updated_at = $2 WHERE out_trade_no = $1`,
      [outTradeNo, now, matchedUser, matchMode, credits, error ?? null],
    )
  } catch (e) {
    console.warn('[afdian] markDelivered failed:', e instanceof Error ? e.message : String(e))
  }
}

/**
 * 核心发货：验签（webhook 时）+ 幂等落库 + 解析档位 + 邮箱匹配 + 发放积分。
 * 返回 { ec:200 } 表示已接收（发货失败也返回 200，待轮询/人工补发；重复推送幂等）。
 */
export async function handleAfdianOrder(
  payload: { ec?: number; em?: string; data?: { type?: string; order?: Record<string, unknown>; sign?: string } },
  channel: 'webhook' | 'api',
): Promise<{ ec: number; em?: string }> {
  const data = payload?.data
  const orderRaw = data?.order ?? {}
  const order = orderRaw as unknown as Record<string, unknown>
  const outTradeNo = String(order.out_trade_no ?? '')
  const sign = String(data?.sign ?? '')

  if (!outTradeNo || !String(order.plan_id ?? '')) {
    return { ec: 400, em: 'invalid order' }
  }

  // webhook 验签（sign_str = out_trade_no+user_id+plan_id+total_amount）
  if (channel === 'webhook') {
    const ok = verifyAfdianWebhookSign({
      out_trade_no: outTradeNo,
      user_id: String(order.user_id ?? ''),
      plan_id: String(order.plan_id ?? ''),
      total_amount: String(order.total_amount ?? '0'),
    }, sign)
    if (!ok) {
      console.warn(`[afdian] webhook sign verify FAILED for ${outTradeNo}`)
      return { ec: 400, em: 'sign invalid' }
    }
  }

  // 仅处理交易成功订单
  const status = Number(order.status ?? 2)
  if (status !== 2) {
    return { ec: 200, em: 'ignored (not paid)' }
  }

  const record: AfdianOrderPayload = {
    out_trade_no: outTradeNo,
    user_id: String(order.user_id ?? ''),
    plan_id: String(order.plan_id ?? ''),
    month: Number(order.month ?? 1),
    total_amount: String(order.total_amount ?? '0'),
    show_amount: String(order.show_amount ?? ''),
    status,
    remark: String(order.remark ?? ''),
    product_type: Number(order.product_type ?? 0),
    custom_order_id: String(order.custom_order_id ?? ''),
    redeem_id: String(order.redeem_id ?? '') || null,
  }
  const rawJson = JSON.stringify(payload).slice(0, 2000)
  await upsertOrder(record, channel, rawJson)

  // 2026-08-12 兑换码订单：redeem_id 非空 = 该订单通过兑换码发货（买家在订单里拿到
  // 兑换码，回 Daily 个人中心主动兑换到自己账号）。**禁止**按留言邮箱自动匹配发货
  // （否则买家留言填了邮箱会被双通道发货，且无法控制兑换人）。
  if (record.redeem_id) {
    // 自动同步进本地兑换码表（幂等；站长无需手动导入，账本自动完整）
    await syncRedeemCodeToLocal(record.redeem_id, record.plan_id, 0, null)
    console.log(`[afdian] redeem-code order ${outTradeNo} (redeem_id=${record.redeem_id.slice(0, 12)}…) 等待用户主动兑换`)
    return { ec: 200, em: 'redeem pending' }
  }

  // 已发货（幂等）→ 跳过
  try {
    const pool = getPool()
    const existing = await pool.query('SELECT delivered, matched_user FROM webos_afdian_orders WHERE out_trade_no = $1', [outTradeNo])
    if (Number(existing.rows?.[0]?.delivered ?? 0) === 1) {
      return { ec: 200, em: 'duplicate' }
    }
  } catch { /* 忽略 */ }

  // 解析档位
  const tier = afdianTierByPlanId(record.plan_id)
  if (!tier) {
    await markDelivered(outTradeNo, null, 'none', 0, `unknown plan_id: ${record.plan_id}`)
    console.warn(`[afdian] unknown plan_id ${record.plan_id} for ${outTradeNo}`)
    return { ec: 200, em: 'unknown plan' }
  }

  // 匹配用户：留言邮箱 → users.email
  const matched = await findUserByEmail(record.remark ?? '')
  if (!matched) {
    await markDelivered(outTradeNo, null, 'none', 0, `邮箱未匹配: "${record.remark}"（管理后台可人工补发）`)
    console.warn(`[afdian] user not matched for ${outTradeNo}, remark="${record.remark}"`)
    return { ec: 200, em: 'user pending' }
  }

  // 发货（loadState/saveState 带缓存）
  try {
    const principal: Principal = { key: matched.key, id: matched.id, deviceId: `account-${matched.id}`, guest: false, role: 'member' }
    const state = (await loadState(principal)) as StoredStateLike
    const now = Date.now()

    if (tier.kind === 'monthly') {
      // 月卡：设置/续费月卡（当月额度到期作废，续费重新给满）
      state.credits.monthly = {
        planId: tier.planId,
        planName: tier.name,
        monthlyCredits: tier.monthlyCredits ?? 1000,
        expiresAt: now + 30 * 24 * 3600_000,
        lastGrantAt: now,
      }
      // 当月额度重置（旧余额作废：quota=档位额度，used=0）
      state.credits.quota = tier.monthlyCredits ?? 1000
      state.credits.used = 0
      // 2026-08-12 月卡档位同步工作区空间：轻量 10GB / 中量 30GB / 重量 100GB
      const tierBytes = WORKSPACE_TIER_BYTES[tier.planId]
      if (typeof tierBytes === 'number') {
        state.workspaceBytes = tierBytes
        console.log(`[afdian] 月卡工作区配额升级 ✓ ${matched.key} ← ${tier.name} → ${(tierBytes / 1024 / 1024 / 1024).toFixed(0)}GB`)
      }
      await markDelivered(outTradeNo, matched.key, 'email', tier.monthlyCredits ?? 1000)
      console.log(`[afdian] 月卡发货 ✓ ${matched.key} ← ${tier.name} (+${tier.monthlyCredits} 积分/月，到期 ${new Date(now + 30 * 24 * 3600_000).toISOString()})`)
    } else {
      // 尝鲜包：永久池 +500（重复购买不重复发放）
      state.credits.permanent = state.credits.permanent ?? { quota: 0, used: 0 }
      const history = state.credits.afdianRedeem ?? []
      const already = history.some((h) => String(h.planId ?? '') === tier.planId)
      if (already) {
        await markDelivered(outTradeNo, matched.key, 'duplicate', 0, '尝鲜包每人限购一次，已购买过')
        console.log(`[afdian] 尝鲜包重复购买（跳过）${matched.key} ${outTradeNo}`)
      } else {
        state.credits.permanent.quota += tier.packCredits ?? 500
        history.push({ planId: tier.planId, planName: tier.name, credits: tier.packCredits ?? 500, at: now })
        state.credits.afdianRedeem = history
        await markDelivered(outTradeNo, matched.key, 'email', tier.packCredits ?? 500)
        console.log(`[afdian] 尝鲜包发货 ✓ ${matched.key} ← ${tier.name} (永久池 +${tier.packCredits})`)
      }
    }
    await saveState(principal, state as Parameters<typeof saveState>[1])
    return { ec: 200, em: 'ok' }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    await markDelivered(outTradeNo, matched.key, 'email', 0, `发货失败: ${msg.slice(0, 200)}`)
    console.error(`[afdian] deliver failed ${outTradeNo}:`, msg)
    return { ec: 200, em: 'deliver error' }
  }
}

// ---------------------------------------------------------------------------
// API 主动查询（兜底对账）：query-order 拉最近订单补发
// ---------------------------------------------------------------------------

function envString(name: string): string | null {
  const value = process.env[name]
  return value && value.trim().length > 0 ? value.trim() : null
}

export function afdianConfigured(): boolean {
  return envString('AFDIAN_USER_ID') !== null && envString('AFDIAN_API_TOKEN') !== null
}

export async function afdianApiCall(path: string, paramsObj: Record<string, unknown>): Promise<Record<string, unknown> | null> {
  const userId = envString('AFDIAN_USER_ID')
  const token = envString('AFDIAN_API_TOKEN')
  if (!userId || !token) return null
  const ts = Math.floor(Date.now() / 1000)
  const params = JSON.stringify(paramsObj)
  const sign = crypto.createHash('md5').update(token + 'params' + params + 'ts' + ts + 'user_id' + userId).digest('hex')
  try {
    const res = await fetch(`https://ifdian.net/api/open/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: userId, params, ts, sign }),
      signal: AbortSignal.timeout(20_000),
    })
    return await res.json() as Record<string, unknown>
  } catch (error) {
    console.warn('[afdian] api call failed:', error instanceof Error ? error.message : String(error))
    return null
  }
}

/** 轮询最近订单（默认最近 3 页 × 50 条）补发漏单（幂等） */
export async function syncAfdianOrders(maxPages = 3): Promise<number> {
  if (!afdianConfigured()) return 0
  let processed = 0
  for (let page = 1; page <= maxPages; page += 1) {
    const res = await afdianApiCall('query-order', { page, per_page: 50 })
    const list = (res?.data as { list?: unknown[] } | undefined)?.list ?? []
    if (!Array.isArray(list) || list.length === 0) break
    for (const item of list) {
      const order = item as Record<string, unknown>
      if (Number(order.status ?? 0) !== 2) continue
      await handleAfdianOrder({
        data: { type: 'order', order },
      }, 'api')
      processed += 1
    }
    if (list.length < 50) break
  }
  return processed
}

/** 启动定时对账（每 5 分钟一次；失败静默） */
let syncTimerStarted = false
export function startAfdianSync(intervalMs = 5 * 60_000): void {
  if (syncTimerStarted) return
  syncTimerStarted = true
  void syncAfdianOrders().then((n) => {
    if (n > 0) console.log(`[afdian] 首次对账完成，处理 ${n} 条订单`)
  })
  setInterval(() => {
    void syncAfdianOrders().catch(() => {})
  }, intervalMs)
}

/** 管理后台：订单列表（分页 + delivered 过滤） */
export async function listAfdianOrders(opts: { delivered?: number; limit?: number; offset?: number }): Promise<{
  total: number
  list: Array<Record<string, unknown>>
}> {
  const limit = Math.min(100, Math.max(1, opts.limit ?? 20))
  const offset = Math.max(0, opts.offset ?? 0)
  const where = opts.delivered === undefined ? '' : 'WHERE delivered = $1'
  const args = opts.delivered === undefined ? [] : [opts.delivered]
  const pool = getPool()
  const [count, list] = await Promise.all([
    pool.query(`SELECT COUNT(*) AS n FROM webos_afdian_orders ${where}`, args),
    pool.query(`SELECT * FROM webos_afdian_orders ${where} ORDER BY created_at DESC LIMIT $${args.length + 1} OFFSET $${args.length + 2}`, [...args, limit, offset]),
  ])
  return {
    total: Number(count.rows?.[0]?.n ?? 0),
    list: (list.rows ?? []).map((r) => ({ ...r }) as Record<string, unknown>),
  }
}

// ============================================================================
// 兑换码兑换（2026-08-12，用户决策：废弃「备注邮箱自动发货」，改用爱发电兑换码）
// ----------------------------------------------------------------------------
// 机制：站长在爱发电后台把商品设为「兑换码发货」→ 买家付款后在其订单/个人中心
// 拿到兑换码（爱发电订单字段 redeem_id）→ 回到 Daily 个人中心输入兑换码 →
// 系统按兑换码匹配订单 → 发放对应档位权益（积分/空间）→ 一次性、可统计、可控。
//
// 爱发电开放平台没有「兑换码验证」接口，验证方式 = query-order 拉订单按
// redeem_id 匹配（webhook/轮询已入库的订单直接本地查，减少 API 调用）。
// ============================================================================

/** 兑换码档位映射：内置档位 + 旧订阅兼容 + 环境变量扩展（站长新建兑换码商品后配置 plan_id） */
export function redeemTierByPlanId(planId: string): AfdianTier | null {
  const builtin = AFDIAN_TIERS.find((t) => t.planId === planId)
  if (builtin) return builtin
  const legacy = LEGACY_SUBSCRIBE_TIERS.find((t) => t.planId === planId)
  if (legacy) return legacy
  // 环境变量扩展：AFDIAN_REDEEM_TIERS=[{"planId":"...","name":"...","priceYuan":9.9,"kind":"monthly","monthlyCredits":1000}]
  try {
    const raw = process.env.AFDIAN_REDEEM_TIERS?.trim()
    if (raw) {
      const list = JSON.parse(raw) as AfdianTier[]
      if (Array.isArray(list)) {
        const match = list.find((t) => t.planId === planId)
        if (match) return match
      }
    }
  } catch { /* 配置解析失败按未配置处理 */ }
  return null
}

// ============================================================================
// 本地兑换码表（webos_redeem_codes，2026-08-12）
// 站长在爱发电后台生成兑换码 → 通过管理后台导入本表 → 用户输入兑换码时
// 本地验证（code 存在 / 未使用 / 档位可解析）→ 直接发货，不依赖订单匹配。
// ============================================================================

/** 本地表按兑换码查（大小写不敏感） */
export async function findRedeemCode(code: string): Promise<Record<string, unknown> | null> {
  try {
    const pool = getPool()
    const rows = await pool.query(
      `SELECT * FROM webos_redeem_codes WHERE LOWER(code) = LOWER($1) LIMIT 1`,
      [code],
    )
    return (rows.rows?.[0] as Record<string, unknown> | undefined) ?? null
  } catch {
    return null
  }
}

/** 标记本地兑换码已使用 */
async function markRedeemCodeUsed(code: string, userKey: string): Promise<void> {
  try {
    const pool = getPool()
    await pool.query(
      `UPDATE webos_redeem_codes SET status = 'used', redeemed_by = $2, redeemed_at = $3, updated_at = $3 WHERE LOWER(code) = LOWER($1)`,
      [code, userKey, Date.now()],
    )
  } catch (error) {
    console.warn('[afdian] markRedeemCodeUsed failed:', error instanceof Error ? error.message : String(error))
  }
}

/** 批量导入兑换码（管理后台 POST /api/admin/webos/redeem-codes/import；幂等：重复 code 更新档位） */
export async function importRedeemCodes(items: Array<{ code: string; planId: string; note?: string }>): Promise<{ imported: number; skipped: number }> {
  const pool = getPool()
  let imported = 0
  let skipped = 0
  for (const item of items) {
    const code = String(item.code ?? '').trim()
    const planId = String(item.planId ?? '').trim()
    if (!code || !planId) { skipped += 1; continue }
    if (code.length > 128) { skipped += 1; continue }
    try {
      const now = Date.now()
      await pool.query(
        `INSERT INTO webos_redeem_codes (code, plan_id, plan_name, status, note, created_at, updated_at)
         VALUES ($1, $2, $3, 'unused', $4, $5, $5)
         ON CONFLICT (code) DO UPDATE SET plan_id = EXCLUDED.plan_id, plan_name = EXCLUDED.plan_name, updated_at = EXCLUDED.updated_at`,
        [code, planId, (afdianTierByPlanId(planId)?.name ?? ''), item.note ?? 'admin-import', now],
      )
      imported += 1
    } catch {
      skipped += 1
    }
  }
  return { imported, skipped }
}

/**
 * 自动同步兑换码进本地表（2026-08-12 自动发货补全）：
 * 买家订单（webhook / 5 分钟轮询 / 兑换时实时拉取）里的 redeem_id 自动入库，
 * 站长在爱发电后台补货后**无需手动导入**，账本自动完整。
 * 幂等：已存在的码不覆盖（保持 used/revoked 等本地状态优先）。
 */
async function syncRedeemCodeToLocal(code: string, planId: string, delivered: number, redeemedBy: string | null): Promise<void> {
  try {
    if (!code || !planId) return
    const pool = getPool()
    const now = Date.now()
    await pool.query(
      `INSERT INTO webos_redeem_codes (code, plan_id, plan_name, status, note, redeemed_by, redeemed_at, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 'auto-sync', $5, $6, $7, $7)
       ON CONFLICT (code) DO NOTHING`,
      [code, planId, (afdianTierByPlanId(planId)?.name ?? ''), delivered === 1 ? 'used' : 'unused', redeemedBy, delivered === 1 ? now : null, now],
    )
  } catch (error) {
    console.warn('[afdian] syncRedeemCodeToLocal failed:', error instanceof Error ? error.message : String(error))
  }
}

/** 兑换码列表（管理后台） */
export async function listRedeemCodes(opts: { status?: string; limit?: number; offset?: number }): Promise<{
  total: number
  list: Array<Record<string, unknown>>
}> {
  const limit = Math.min(200, Math.max(1, opts.limit ?? 50))
  const offset = Math.max(0, opts.offset ?? 0)
  const where = opts.status ? 'WHERE status = $1' : ''
  const args = opts.status ? [opts.status] : []
  const pool = getPool()
  const [count, list] = await Promise.all([
    pool.query(`SELECT COUNT(*) AS n FROM webos_redeem_codes ${where}`, args),
    pool.query(`SELECT * FROM webos_redeem_codes ${where} ORDER BY created_at DESC LIMIT $${args.length + 1} OFFSET $${args.length + 2}`, [...args, limit, offset]),
  ])
  return {
    total: Number(count.rows?.[0]?.n ?? 0),
    list: (list.rows ?? []).map((r) => ({ ...r }) as Record<string, unknown>),
  }
}

/** 本地订单表按兑换码查（大小写不敏感） */
async function findOrderByRedeemId(code: string): Promise<Record<string, unknown> | null> {
  try {
    const pool = getPool()
    const rows = await pool.query(
      `SELECT * FROM webos_afdian_orders WHERE LOWER(COALESCE(redeem_id, '')) = LOWER($1) ORDER BY created_at DESC LIMIT 1`,
      [code],
    )
    return (rows.rows?.[0] as Record<string, unknown> | undefined) ?? null
  } catch {
    return null
  }
}

/**
 * 兑换码对应的真实订单号（2026-08-12 账本一致修复）：
 * 本地表路径兑换时优先用真实 out_trade_no 标记 delivered（管理后台订单状态准确，
 * 避免误显示「未发货」导致重复补发）；查不到（订单尚未同步进来）回退伪订单号。
 */
async function realOrderNoFor(code: string): Promise<string> {
  const order = await findOrderByRedeemId(code)
  if (order && String(order.out_trade_no ?? '')) return String(order.out_trade_no)
  return `redeem:${code.slice(0, 24)}`
}

/**
 * 从爱发电拉取订单匹配兑换码（最近 maxPages×50 条；匹配后落库）。
 * 返回订单行（含 out_trade_no / plan_id / status / delivered / redeem_id）。
 */
async function fetchOrderByRedeemIdFromAfdian(code: string, maxPages = 30): Promise<Record<string, unknown> | null> {
  for (let page = 1; page <= maxPages; page += 1) {
    const res = await afdianApiCall('query-order', { page, per_page: 50 })
    const list = (res?.data as { list?: unknown[] } | undefined)?.list ?? []
    if (!Array.isArray(list) || list.length === 0) break
    for (const item of list) {
      const order = item as Record<string, unknown>
      const redeem = String(order.redeem_id ?? '').trim()
      if (!redeem) continue
      // 落库（幂等；redeem_id 一并保存）
      await handleAfdianOrder({ data: { type: 'order', order } }, 'api').catch(() => {})
      if (redeem.toLowerCase() === code.toLowerCase()) {
        const local = await findOrderByRedeemId(code)
        if (local) return local
      }
    }
    if (list.length < 50) break
  }
  return null
}

export interface RedeemResult {
  outTradeNo: string
  planId: string
  planName: string
  kind: 'monthly' | 'pack'
  credits: number
  workspaceBytes: number | null
}

/** 兑换发货（月卡 → monthly 额度 + 空间；用量包 → permanent 永久池）；返回发放结果 */
async function deliverRedeemTier(principal: Principal, tier: AfdianTier, code: string, outTradeNo: string): Promise<RedeemResult> {
  try {
    const state = (await loadState(principal)) as StoredStateLike
    const now = Date.now()
    if (tier.kind === 'monthly') {
      state.credits.monthly = {
        planId: tier.planId,
        planName: tier.name,
        monthlyCredits: tier.monthlyCredits ?? 1000,
        expiresAt: now + 30 * 24 * 3600_000,
        lastGrantAt: now,
      }
      state.credits.quota = tier.monthlyCredits ?? 1000
      state.credits.used = 0
      const tierBytes = WORKSPACE_TIER_BYTES[tier.planId]
      if (typeof tierBytes === 'number') state.workspaceBytes = tierBytes
      await markDelivered(outTradeNo, principal.key, 'redeem', tier.monthlyCredits ?? 1000)
      console.log(`[afdian] 兑换码月卡发货 ✓ ${principal.key} ← ${tier.name} (code=${code.slice(0, 12)}…)`)
    } else {
      state.credits.permanent = state.credits.permanent ?? { quota: 0, used: 0 }
      const history = state.credits.afdianRedeem ?? []
      history.push({ planId: tier.planId, planName: tier.name, credits: tier.packCredits ?? 500, at: now })
      state.credits.afdianRedeem = history
      state.credits.permanent.quota += tier.packCredits ?? 500
      await markDelivered(outTradeNo, principal.key, 'redeem', tier.packCredits ?? 500)
      console.log(`[afdian] 兑换码用量包发货 ✓ ${principal.key} ← ${tier.name} (永久池 +${tier.packCredits})`)
    }
    await saveState(principal, state as Parameters<typeof saveState>[1])
    return {
      outTradeNo,
      planId: tier.planId,
      planName: tier.name,
      kind: tier.kind,
      credits: tier.kind === 'monthly' ? (tier.monthlyCredits ?? 1000) : (tier.packCredits ?? 500),
      workspaceBytes: WORKSPACE_TIER_BYTES[tier.planId] ?? null,
    }
  } catch (error) {
    if (error instanceof Error && 'status' in error && (error as { status?: number }).status === 409) throw error
    const msg = error instanceof Error ? error.message : String(error)
    await markDelivered(outTradeNo, principal.key, 'redeem', 0, `兑换发货失败: ${msg.slice(0, 200)}`)
    console.error(`[afdian] redeem deliver failed ${outTradeNo}:`, msg)
    throw createError(500, 'REDEEM_DELIVER_FAILED', '兑换失败，请联系站长处理（微信 fangyan876）')
  }
}

/**
 * 兑换码兑换主流程（个人中心 POST /webos/api/payment/redeem）：
 * 0. 本地兑换码表（webos_redeem_codes）优先：站长导入的兑换码直接验证发货
 * 1. 本地订单表按 redeem_id 查 → 未命中则拉取爱发电订单匹配（30 页 ×50 条）
 * 2. 校验：订单存在 / 已支付 / 未使用 / 档位已配置
 * 3. 发货：月卡 → monthly 额度 + 空间档位；用量包 → permanent 永久池
 * 4. 标记已使用（本地表 status=used 或订单 delivered），兑换码一次性
 */
export async function redeemAfdianCode(principal: Principal, rawCode: string): Promise<RedeemResult> {
  const code = String(rawCode ?? '').trim()
  if (!code) throw createError(400, 'REDEEM_CODE_REQUIRED', '请输入兑换码')
  if (code.length > 128) throw createError(400, 'REDEEM_CODE_INVALID', '兑换码格式不正确')

  // 0. 本地兑换码表优先（站长在爱发电后台生成后导入本表）
  const localCode = await findRedeemCode(code)
  if (localCode) {
    const status = String(localCode.status ?? 'unused')
    if (status === 'used') throw createError(409, 'REDEEM_ALREADY_USED', '该兑换码已被使用（每个兑换码只能兑换一次）')
    if (status === 'revoked') throw createError(400, 'REDEEM_REVOKED', '该兑换码已失效，请联系站长')
    const tier = redeemTierByPlanId(String(localCode.plan_id ?? ''))
    if (!tier) {
      console.warn(`[afdian] redeem local code ${code.slice(0, 12)}… unknown plan ${String(localCode.plan_id)}`)
      throw createError(400, 'UNKNOWN_PLAN', '该兑换码对应的档位未配置，请联系站长（微信 fangyan876）')
    }
    const result = await deliverRedeemTier(principal, tier, code, await realOrderNoFor(code))
    await markRedeemCodeUsed(code, principal.key)
    return result
  }

  // 1. 找订单（本地优先，避免每次全量拉 API）
  let order = await findOrderByRedeemId(code)
  if (!order) order = await fetchOrderByRedeemIdFromAfdian(code)
  if (!order) throw createError(404, 'REDEEM_CODE_NOT_FOUND', '兑换码不存在，请检查是否输入正确（注意大小写与分隔符）')

  const outTradeNo = String(order.out_trade_no ?? '')
  const planId = String(order.plan_id ?? '')

  // 2. 校验状态
  if (Number(order.status ?? 0) !== 2) {
    throw createError(400, 'REDEEM_NOT_PAID', '该兑换码对应的订单尚未支付成功')
  }
  if (Number(order.delivered ?? 0) === 1) {
    throw createError(409, 'REDEEM_ALREADY_USED', '该兑换码已被使用（每个兑换码只能兑换一次）')
  }
  const tier = redeemTierByPlanId(planId)
  if (!tier) {
    console.warn(`[afdian] redeem unknown plan_id ${planId} for code ${code.slice(0, 12)}…`)
    throw createError(400, 'UNKNOWN_PLAN', '该兑换码对应的档位未配置，请联系站长（微信 fangyan876）')
  }

  return deliverRedeemTier(principal, tier, code, outTradeNo)
}
