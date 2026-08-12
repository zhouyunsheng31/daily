import { Router, type Request } from 'express'
import { randomInt, randomBytes, timingSafeEqual } from 'node:crypto'
import { v4 as uuidv4 } from 'uuid'
import dns from 'node:dns'
import { signTokenForUser, verifyToken, parseCookies, getCookieName, getCookieOptions } from '../utils/jwt.js'
import { hashPassword, verifyPassword } from '../utils/crypto.js'
import { getPool } from '../db/connection.js'
import { createError } from '../middleware/error.js'
import { loadState, saveState, MEMBER_CREDITS, type Principal } from './webos.js'

// api.resend.com 同时解析 IPv4/IPv6；无 IPv6 路由的环境（如容器/proot）下
// undici 连接 IPv6 会 ETIMEDOUT。全局强制 IPv4 优先（对 DeepSeek 等外呼同样安全）。
dns.setDefaultResultOrder('ipv4first')

/**
 * 邮箱账号系统（正常注册/登录：注册用验证码验证邮箱，登录用密码）。
 *
 * - POST /api/auth/email/send-code    { email }            → 发送 6 位验证码（注册/重置密码时验证邮箱归属）
 * - POST /api/auth/email/register     { email, password, code } → 验证码验证邮箱 + 设置密码 + 创建账号 + 登录
 * - POST /api/auth/email/login        { email, password }  → 密码登录（无需验证码）
 * - POST /api/auth/email/reset-password { email, password, code } → 验证码验证后重置密码并登录（忘记密码）
 *
 * 挂载在 authMiddleware 之前（免鉴权），与 authLoginRouter 并列。
 * 注册/登录成功时若当前请求携带游客 JWT，自动把游客 webOS 资产（App/余额/设置）
 * 迁移到账号 scope（仅当该账号从未使用过 webOS 时，避免覆盖既有数据）。
 *
 * Resend 配置（仅服务端读取，禁止进入前端/日志/Git）：
 *   RESEND_API_KEY      – Resend API key
 *   RESEND_FROM_EMAIL   – 发件地址（如 no-reply@your-domain.com，需在 Resend 验证域名）
 *   RESEND_FROM_NAME    – 发件显示名（默认 Daily）
 */

export const emailAuthRouter = Router()

const CODE_TTL_MS = 10 * 60 * 1000          // 验证码有效期 10 分钟
const CODE_RESEND_COOLDOWN_MS = 60 * 1000   // 重发冷却 60 秒
const MAX_VERIFY_ATTEMPTS = 5               // 单个验证码最多尝试 5 次
const SEND_IP_LIMIT_PER_HOUR = 20           // 每个 IP 每小时最多发送 20 次
const VERIFY_IP_LIMIT_PER_HOUR = 40         // 每个 IP 每小时最多验证 40 次
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// ============================================================================
// 密码策略（2026-08-02，OWASP / NIST SP 800-63B 建议）
// - 长度 8-64；至少包含 3 类字符（小写/大写/数字/特殊符号）
// - 拒绝常见弱密码（123456、password、qwerty 等）
// - 密码不得包含邮箱本地部分（防 "邮箱=密码" 式弱口令）
// ============================================================================
const PASSWORD_MIN_LENGTH = 8
const PASSWORD_MAX_LENGTH = 64
const WEAK_PASSWORDS = new Set([
  '123456', '1234567', '12345678', '123456789', '1234567890',
  'password', 'password1', 'password123', 'passw0rd',
  'qwerty', 'qwerty123', 'abc123', 'abc123456', '111111', '11111111',
  '000000', '666666', '888888', '88888888', '123123', '123321',
  'iloveyou', 'admin', 'admin123', 'root', 'root123', 'letmein',
  'welcome', 'welcome1', 'monkey', 'dragon', 'sunshine', 'princess',
  'a123456', 'a12345678', 'qq123456', 'woaini', 'woaini1314',
  'zxcvbnm', 'asdfgh', 'asdfghjkl', '1q2w3e4r', '1qaz2wsx',
])

/** 校验密码强度；通过返回 null，失败返回中文错误信息 */
function validatePassword(password: string, email: string): string | null {
  if (typeof password !== 'string' || password.length < PASSWORD_MIN_LENGTH || password.length > PASSWORD_MAX_LENGTH) {
    return `密码长度需在 ${PASSWORD_MIN_LENGTH}-${PASSWORD_MAX_LENGTH} 位之间`
  }
  const lower = /[a-z]/.test(password)
  const upper = /[A-Z]/.test(password)
  const digit = /[0-9]/.test(password)
  const symbol = /[^a-zA-Z0-9]/.test(password)
  const classCount = Number(lower) + Number(upper) + Number(digit) + Number(symbol)
  if (classCount < 3) {
    return '密码强度不足：需至少包含 大写字母 / 小写字母 / 数字 / 特殊符号 中的 3 类'
  }
  if (WEAK_PASSWORDS.has(password.toLowerCase())) {
    return '该密码过于常见，请更换更复杂的密码'
  }
  // 密码不得包含邮箱本地部分（连续 3 字符以上，如 abc@x.com 与密码中含 abc）
  const localPart = email.split('@')[0].toLowerCase()
  const lowered = password.toLowerCase()
  if (localPart.length >= 3) {
    for (let i = 0; i <= localPart.length - 3; i += 1) {
      const fragment = localPart.slice(i, i + 3)
      if (lowered.includes(fragment)) {
        return '密码不能包含邮箱名称部分，请更换'
      }
    }
  }
  return null
}

// ============================================================================
// 登录失败账户锁定（2026-08-02）：同一邮箱连续失败 5 次锁定 15 分钟
// （与 IP 限频互补：IP 限频防刷，账户锁定防撞库）
// ============================================================================
const LOGIN_FAIL_LOCK_THRESHOLD = 5
const LOGIN_FAIL_LOCK_MS = 15 * 60 * 1000
const loginFailures = new Map<string, { count: number; lockedUntil: number }>()

function checkLoginLocked(email: string): number | null {
  const entry = loginFailures.get(email)
  if (!entry || entry.count < LOGIN_FAIL_LOCK_THRESHOLD) return null
  if (Date.now() >= entry.lockedUntil) {
    loginFailures.delete(email)
    return null
  }
  return Math.ceil((entry.lockedUntil - Date.now()) / 1000)
}

function recordLoginFailure(email: string): void {
  const entry = loginFailures.get(email) ?? { count: 0, lockedUntil: 0 }
  entry.count += 1
  if (entry.count >= LOGIN_FAIL_LOCK_THRESHOLD) {
    entry.lockedUntil = Date.now() + LOGIN_FAIL_LOCK_MS
  }
  loginFailures.set(email, entry)
}

function clearLoginFailures(email: string): void {
  loginFailures.delete(email)
}

// ============================================================================
// 反人机验证（2026-08-02）：发送验证码前必须先通过一道算术题
// - GET/POST /api/auth/email/puzzle 签发题目（内存 Map，5 分钟有效，一次性）
// - send-code 必须携带 puzzleId + answer，校验通过才真正发码
// 目的：挡住纯脚本批量轰炸邮箱（与 IP 限频互补；IP 限频防刷，题目防脚本）
// ============================================================================
const PUZZLE_TTL_MS = 5 * 60 * 1000
const puzzleStore = new Map<string, { question: string; answer: number; expiresAt: number }>()

function randomPuzzle(): { question: string; answer: number } {
  const a = 2 + Math.floor(Math.random() * 9)
  const b = 2 + Math.floor(Math.random() * 9)
  const op = Math.random() < 0.5 ? '+' : '-'
  if (op === '+') return { question: `${a} + ${b} = ?`, answer: a + b }
  const max = Math.max(a, b)
  const min = Math.min(a, b)
  return { question: `${max} - ${min} = ?`, answer: max - min }
}

function consumePuzzle(puzzleId: string, answer: unknown): boolean {
  if (typeof puzzleId !== 'string' || !puzzleId) return false
  const entry = puzzleStore.get(puzzleId)
  if (!entry) return false
  puzzleStore.delete(puzzleId) // 一次性：无论对错都消耗，防重放
  if (Date.now() > entry.expiresAt) return false
  return Number(answer) === entry.answer
}

// 定期清理过期题目（防 Map 膨胀）
setInterval(() => {
  const now = Date.now()
  for (const [id, entry] of puzzleStore) {
    if (now > entry.expiresAt) puzzleStore.delete(id)
  }
}, 10 * 60 * 1000).unref?.()

/** POST /api/auth/email/puzzle — 签发反人机算术题（免鉴权） */
emailAuthRouter.post('/email/puzzle', (_req, res) => {
  const puzzleId = randomBytes(16).toString('hex')
  const { question, answer } = randomPuzzle()
  puzzleStore.set(puzzleId, { question, answer, expiresAt: Date.now() + PUZZLE_TTL_MS })
  res.json({ puzzleId, question, expiresAt: Date.now() + PUZZLE_TTL_MS })
})

interface CodeEntry {
  code: string
  email: string
  expiresAt: number
  attempts: number
  lastSentAt: number
}

/** 验证码内存存储（单实例 pm2 部署，重启即失效，可接受） */
const codeStore = new Map<string, CodeEntry>()
/** IP 限频：Map<ip, { count, windowStart }> */
const sendRateMap = new Map<string, { count: number; windowStart: number }>()
const verifyRateMap = new Map<string, { count: number; windowStart: number }>()

function clientIp(req: Request): string {
  const xff = req.headers['x-forwarded-for']
  if (xff) {
    const ip = Array.isArray(xff) ? xff[0] : xff.split(',')[0]
    return ip?.trim() || 'unknown'
  }
  return req.socket.remoteAddress || 'unknown'
}

function checkRate(map: Map<string, { count: number; windowStart: number }>, ip: string, limit: number, windowMs: number): boolean {
  const now = Date.now()
  const entry = map.get(ip)
  if (!entry || now - entry.windowStart > windowMs) {
    map.set(ip, { count: 1, windowStart: now })
    return true
  }
  entry.count += 1
  return entry.count <= limit
}

/** 读取当前请求携带的 JWT 身份（emailAuth 免鉴权挂载，需自行解析 cookie） */
function identityFromCookie(req: Request): { userId?: string; guest?: boolean; guestDeviceId?: string } | null {
  const cookies = parseCookies(req.headers.cookie)
  const token = cookies[getCookieName()]
  if (!token) return null
  const payload = verifyToken(token)
  if (!payload?.authenticated) return null
  return { userId: payload.userId, guest: payload.guest, guestDeviceId: payload.deviceId }
}

function resendKey(): string {
  return process.env.RESEND_API_KEY?.trim() || ''
}

function resendFrom(): string {
  return process.env.RESEND_FROM_EMAIL?.trim() || ''
}

/** 发件人显示名（可选；默认 Daily，收件人邮箱列表显示这个名字而非 no-reply） */
function resendFromName(): string {
  return process.env.RESEND_FROM_NAME?.trim() || 'Daily'
}

/** 通过 Resend REST API 发送邮件（零依赖，直接用 fetch；网络抖动自动重试 3 次） */
async function sendEmail(to: string, subject: string, html: string): Promise<void> {
  const key = resendKey()
  const fromAddress = resendFrom()
  if (!key || !fromAddress) {
    throw createError(503, 'EMAIL_PROVIDER_UNAVAILABLE', '邮件服务未配置（RESEND_API_KEY / RESEND_FROM_EMAIL），请联系管理员')
  }
  // from 带显示名：`Daily <no-reply@your-domain.com>`（Resend 接受该格式，
  // 收件人邮箱列表显示显示名，而不是地址前缀 no-reply）
  const from = `${resendFromName()} <${fromAddress}>`
  const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

  let lastError: unknown = null
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    let response: Response
    try {
      response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ from, to, subject, html }),
        // 每次尝试 15s 超时（防止网络卡顿时请求无限挂起；配合 3 次重试最长约 46s）
        signal: AbortSignal.timeout(15_000),
      })
    } catch (error) {
      // 网络层失败（连接超时/DNS 等）：退避重试
      lastError = error
      console.warn(`[email-auth] Resend fetch attempt ${attempt}/3 failed: ${error instanceof Error ? error.message : String(error)}`)
      if (attempt < 3) {
        await sleep(attempt * 500)
        continue
      }
      break
    }
    if (response.ok) return
    let detail = ''
    try {
      const payload = await response.json() as { message?: string }
      detail = payload.message ?? ''
    } catch { /* keep fallback message */ }
    // HTTP 4xx（域名未验证/密钥错误等）不重试；5xx 重试
    if (response.status < 500 || attempt >= 3) {
      console.error(`[email-auth] Resend rejected (${response.status}):`, detail)
      // 2026-08-02：明确区分「今日发送量达上限」与「配置错误」（Resend 免费额度约 100 封/天）
      if (response.status === 429 || /rate.?limit|limit.?exceeded|daily.?limit/i.test(detail)) {
        throw createError(502, 'EMAIL_DAILY_LIMIT', '邮件服务今日发送量已达上限，请明天再试或联系管理员')
      }
      throw createError(502, 'EMAIL_SEND_FAILED', `邮件发送失败${detail ? `：${detail}` : ''}`)
    }
    lastError = new Error(`HTTP ${response.status} ${detail}`)
    console.warn(`[email-auth] Resend HTTP ${response.status} attempt ${attempt}/3`)
    if (attempt < 3) await sleep(attempt * 500)
  }

  const cause = lastError instanceof Error && lastError.cause
    ? ` | cause: ${JSON.stringify({ code: (lastError.cause as { code?: unknown }).code ?? null, message: (lastError.cause as { message?: unknown }).message ?? String(lastError.cause) })}`
    : ''
  console.error(`[email-auth] Resend request failed after 3 attempts: ${lastError instanceof Error ? lastError.message : String(lastError)}${cause}`)
  throw createError(502, 'EMAIL_SEND_FAILED', '邮件服务暂时不可用，请稍后再试')
}

function verificationCodeHtml(code: string): string {
  return `<!DOCTYPE html>
<html lang="zh-CN"><body style="margin:0;padding:0;background:#f4f2ec;font-family:-apple-system,'PingFang SC','Microsoft YaHei',sans-serif;">
  <div style="max-width:480px;margin:0 auto;padding:32px 20px;">
    <div style="background:#ffffff;border-radius:18px;padding:28px 26px;box-shadow:0 10px 32px rgba(50,44,34,.10);">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:18px;">
        <span style="width:26px;height:26px;display:inline-grid;place-items:center;border-radius:9px;background:#171918;color:#fff;font-size:13px;font-weight:800;">D</span>
        <strong style="font-size:15px;letter-spacing:-.02em;">Daily</strong>
      </div>
      <h1 style="margin:0 0 8px;font-size:17px;color:#171918;">邮箱验证码</h1>
      <p style="margin:0 0 22px;font-size:13px;color:#6b6f68;line-height:1.7;">你正在使用该邮箱注册或重置 Daily 账号密码。请使用下面的验证码完成验证：</p>
      <div style="padding:16px 0;text-align:center;background:#f7f5ef;border-radius:14px;letter-spacing:10px;font-size:30px;font-weight:750;color:#171918;">${code}</div>
      <p style="margin:20px 0 0;font-size:12px;color:#8a8d85;line-height:1.7;">验证码 10 分钟内有效。如果不是你本人操作，请忽略此邮件。</p>
    </div>
    <p style="margin:16px 0 0;text-align:center;font-size:11px;color:#a9aba3;">Daily · 安静智能的个人空间</p>
  </div>
</body></html>`
}

// ============================================================================
// POST /api/auth/email/send-code — 发送验证码（注册/登录共用）
// ============================================================================

emailAuthRouter.post('/email/send-code', async (req, res, next) => {
  try {
    const body = req.body as { email?: unknown; puzzleId?: unknown; answer?: unknown }
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
    if (!EMAIL_PATTERN.test(email)) {
      next(createError(400, 'INVALID_EMAIL', '邮箱格式不正确'))
      return
    }
    // 反人机：必须先通过算术题（一次性，防脚本批量轰炸邮箱）
    if (!consumePuzzle(String(body.puzzleId ?? ''), body.answer)) {
      next(createError(400, 'PUZZLE_REQUIRED', '请先完成人机验证（算术题）'))
      return
    }

    const ip = clientIp(req)
    if (!checkRate(sendRateMap, ip, SEND_IP_LIMIT_PER_HOUR, 60 * 60 * 1000)) {
      next(createError(429, 'EMAIL_RATE_LIMITED', '发送过于频繁，请稍后再试'))
      return
    }

    // 冷却：同一邮箱 60 秒内只能发一次
    const existing = codeStore.get(email)
    if (existing && Date.now() - existing.lastSentAt < CODE_RESEND_COOLDOWN_MS) {
      const remain = Math.ceil((CODE_RESEND_COOLDOWN_MS - (Date.now() - existing.lastSentAt)) / 1000)
      next(createError(429, 'EMAIL_CODE_COOLDOWN', `请 ${remain} 秒后再试`))
      return
    }

    const code = String(randomInt(0, 1_000_000)).padStart(6, '0')
    codeStore.set(email, { code, email, expiresAt: Date.now() + CODE_TTL_MS, attempts: 0, lastSentAt: Date.now() })

    await sendEmail(email, 'Daily 邮箱验证码', verificationCodeHtml(code))
    res.json({ message: `验证码已发送至 ${email}，10 分钟内有效`, cooldownSeconds: 60 })
  } catch (error) {
    next(error)
  }
})

// ============================================================================
// 辅助：验证码校验（一次性）+ 游客资产迁移
// ============================================================================

/** 校验并消耗验证码（错误/过期/超次都抛对应错误；成功删除一次性使用） */
function consumeCode(email: string, code: string): void {
  const entry = codeStore.get(email)
  if (!entry || Date.now() > entry.expiresAt) {
    codeStore.delete(email)
    throw createError(400, 'EMAIL_CODE_EXPIRED', '验证码已过期，请重新发送')
  }
  if (entry.attempts >= MAX_VERIFY_ATTEMPTS) {
    codeStore.delete(email)
    throw createError(429, 'EMAIL_CODE_TOO_MANY_ATTEMPTS', '尝试次数过多，请重新发送验证码')
  }
  const expected = Buffer.from(entry.code)
  const actual = Buffer.from(code)
  const match = expected.length === actual.length && timingSafeEqual(expected, actual)
  if (!match) {
    entry.attempts += 1
    throw createError(401, 'EMAIL_CODE_INVALID', `验证码错误，剩余 ${MAX_VERIFY_ATTEMPTS - entry.attempts} 次机会`)
  }
  codeStore.delete(email)
}

/**
 * 游客资产迁移：仅当请求携带游客身份且该账号从未使用过 webOS 时，
 * 把游客 webos_state（App/余额/设置）整体迁移到用户 scope。失败不阻断登录。
 */
async function migrateGuestAssets(req: Request, userId: string, role: 'member' | 'admin', email: string): Promise<boolean> {
  const identity = identityFromCookie(req)
  if (!identity?.guest || !identity.guestDeviceId) return false
  const guestPrincipal: Principal = {
    key: `guest:${identity.guestDeviceId}`,
    id: `guest-${identity.guestDeviceId}`,
    deviceId: identity.guestDeviceId,
    guest: true,
    role: 'guest',
  }
  const userPrincipal: Principal = {
    key: `user:${userId}`,
    id: userId,
    deviceId: identity.guestDeviceId,
    guest: false,
    role,
    email,
  }
  try {
    const pool = getPool()
    const hasState = await pool.query(
      'SELECT 1 FROM entities WHERE id = $1 AND type = $2 AND scope = $3',
      [`webos-state:user:${userId}`, 'webos_state', `user:${userId}`],
    )
    if (hasState.rows.length === 0) {
      const guestState = await loadState(guestPrincipal)
      // 登录即绑定：标记邮箱已绑定（bootstrap 的 synced 字段随之变为 true）
      guestState.email = { state: 'verified', boundEmail: email }
      // 2026-08-02：游客资产迁移到账号时，积分额度升级为「已登录 1000 积分」全新额度
      // （游客的 100 积分不累计到账号；账号自带 1000 积分）
      guestState.credits = { quota: MEMBER_CREDITS, used: 0 }
      await saveState(userPrincipal, guestState)
      console.log(`[email-auth] guest assets migrated: guest:${identity.guestDeviceId.slice(0, 8)} → user:${userId}`)
      return true
    }
  } catch (error) {
    // 迁移失败不阻断登录（用户可稍后手动绑定）
    console.warn('[email-auth] guest asset migration failed:', error instanceof Error ? error.message : String(error))
  }
  // 2026-08-03 分享奖励：无论是否发生资产迁移，只要该游客此前通过分享链接
  // 访问过商店条目，就给对应的分享者 +100 积分（登录/注册/重置密码都会走到这里）
  try {
    const { settleShareRewards } = await import('./webos.js')
    await settleShareRewards(guestPrincipal.key)
  } catch (error) {
    console.warn('[email-auth] share reward settlement skipped:', error instanceof Error ? error.message : String(error))
  }
  return false
}

/** 生成唯一用户名：邮箱前缀，冲突追加数字后缀 */
async function uniqueUsername(email: string): Promise<string> {
  const pool = getPool()
  const baseName = email.split('@')[0].slice(0, 24) || 'user'
  let candidate = baseName
  for (let i = 1; i < 100; i += 1) {
    const dup = await pool.query('SELECT 1 FROM users WHERE username = $1', [candidate])
    if (dup.rows.length === 0) break
    candidate = `${baseName}${i}`
  }
  return candidate
}

// ============================================================================
// 管理员名单机制（与 auth.ts 的 register 保持一致）：
// 用户名（邮箱前缀）在 ADMIN_USERNAMES 名单中 → 自动赋予 admin 角色
// ============================================================================
function getAdminUsernames(): string[] {
  const raw = process.env.ADMIN_USERNAMES
  if (!raw) return []
  return raw.split(',').map((s) => s.trim().toLowerCase()).filter((s) => s.length > 0)
}

function isAdminUsername(username: string): boolean {
  return getAdminUsernames().includes(username.toLowerCase())
}

// ============================================================================
// POST /api/auth/email/register — 注册（验证码验证邮箱 + 密码 + 创建账号 + 登录）
// ============================================================================

emailAuthRouter.post('/email/register', async (req, res, next) => {
  try {
    const body = req.body as { email?: unknown; password?: unknown; code?: unknown }
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
    const password = typeof body.password === 'string' ? body.password : ''
    const code = typeof body.code === 'string' ? body.code.trim() : ''
    if (!EMAIL_PATTERN.test(email)) {
      next(createError(400, 'INVALID_EMAIL', '邮箱格式不正确'))
      return
    }
    const passwordError = validatePassword(password, email)
    if (passwordError) {
      next(createError(400, 'INVALID_PASSWORD', passwordError))
      return
    }
    if (!/^\d{6}$/.test(code)) {
      next(createError(400, 'INVALID_CODE', '验证码为 6 位数字'))
      return
    }

    const ip = clientIp(req)
    if (!checkRate(verifyRateMap, ip, VERIFY_IP_LIMIT_PER_HOUR, 60 * 60 * 1000)) {
      next(createError(429, 'EMAIL_RATE_LIMITED', '操作过于频繁，请稍后再试'))
      return
    }

    consumeCode(email, code)

    const pool = getPool()
    const existing = await pool.query('SELECT 1 FROM users WHERE email = $1', [email])
    if (existing.rows.length > 0) {
      next(createError(409, 'EMAIL_ALREADY_REGISTERED', '该邮箱已注册，请直接登录'))
      return
    }

    const userId = uuidv4()
    const username = await uniqueUsername(email)
    // 角色判定：ADMIN_USERNAMES 名单中的用户名 → admin，否则 member（与 auth.ts 一致）
    const role: 'member' | 'admin' = isAdminUsername(username) ? 'admin' : 'member'
    const now = Date.now()
    const registerIp = clientIp(req)
    await pool.query(
      `INSERT INTO users (id, username, email, password_hash, role, is_banned, created_at, last_login_at, registered_ip, last_login_ip)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $7, $8, $8)`,
      [userId, username, email, hashPassword(password), role, false, now, registerIp],
    )
    console.log(`[email-auth] new account registered: ${email} → ${username} (role=${role})`)

    await pool.query('UPDATE users SET last_login_at = $1 WHERE id = $2', [now, userId])
    const migrated = await migrateGuestAssets(req, userId, role, email)

    const token = signTokenForUser(userId, role)
    res.cookie(getCookieName(), token, getCookieOptions())
    res.json({
      authenticated: true,
      user: { id: userId, username, email, role, displayName: username },
      migrated,
      message: migrated ? '注册成功，游客资产已迁移到你的账号' : '注册成功，欢迎使用 Daily',
    })
  } catch (error) {
    next(error)
  }
})

// ============================================================================
// POST /api/auth/email/login — 密码登录（无需验证码）
// ============================================================================

const LOGIN_IP_LIMIT_PER_HOUR = 60
const loginRateMap = new Map<string, { count: number; windowStart: number }>()

emailAuthRouter.post('/email/login', async (req, res, next) => {
  try {
    const body = req.body as { email?: unknown; password?: unknown }
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
    const password = typeof body.password === 'string' ? body.password : ''
    if (!EMAIL_PATTERN.test(email) || !password) {
      next(createError(400, 'INVALID_INPUT', '邮箱或密码格式不正确'))
      return
    }

    // 账户级锁定检查（连续失败 5 次锁 15 分钟）
    const lockedFor = checkLoginLocked(email)
    if (lockedFor !== null) {
      next(createError(423, 'ACCOUNT_LOCKED', `失败次数过多，账号已锁定，请 ${Math.ceil(lockedFor / 60)} 分钟后再试`))
      return
    }

    const ip = clientIp(req)
    if (!checkRate(loginRateMap, ip, LOGIN_IP_LIMIT_PER_HOUR, 60 * 60 * 1000)) {
      next(createError(429, 'EMAIL_RATE_LIMITED', '尝试过于频繁，请稍后再试'))
      return
    }

    const pool = getPool()
    const result = await pool.query(
      'SELECT id, username, email, role, is_banned, password_hash FROM users WHERE email = $1',
      [email],
    )
    if (result.rows.length === 0) {
      recordLoginFailure(email)
      next(createError(401, 'INVALID_CREDENTIALS', '邮箱或密码错误（该邮箱未注册，可先注册）'))
      return
    }
    const row = result.rows[0] as {
      id: string; username: string; email: string; role: string; is_banned: boolean | number; password_hash: string
    }
    if (typeof row.is_banned === 'number' ? row.is_banned !== 0 : row.is_banned) {
      next(createError(403, 'USER_BANNED', '该账号已被封禁'))
      return
    }
    if (!verifyPassword(password, row.password_hash)) {
      recordLoginFailure(email)
      const remain = LOGIN_FAIL_LOCK_THRESHOLD - (loginFailures.get(email)?.count ?? 0)
      next(createError(401, 'INVALID_CREDENTIALS', `邮箱或密码错误${remain > 0 ? `，还可尝试 ${remain} 次` : ''}`))
      return
    }
    clearLoginFailures(email)

    const role = row.role === 'admin' ? 'admin' : 'member'
    await pool.query('UPDATE users SET last_login_at = $1, last_login_ip = $2 WHERE id = $3', [Date.now(), clientIp(req), row.id])
    const migrated = await migrateGuestAssets(req, row.id, role, email)

    const token = signTokenForUser(row.id, role)
    res.cookie(getCookieName(), token, getCookieOptions())
    res.json({
      authenticated: true,
      user: { id: row.id, username: row.username, email: row.email, role },
      migrated,
      message: migrated ? '登录成功，游客资产已迁移到你的账号' : '登录成功',
    })
  } catch (error) {
    next(error)
  }
})

// ============================================================================
// POST /api/auth/email/reset-password — 忘记密码（验证码验证邮箱后重置密码并登录）
// ============================================================================

emailAuthRouter.post('/email/reset-password', async (req, res, next) => {
  try {
    const body = req.body as { email?: unknown; password?: unknown; code?: unknown }
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
    const password = typeof body.password === 'string' ? body.password : ''
    const code = typeof body.code === 'string' ? body.code.trim() : ''
    if (!EMAIL_PATTERN.test(email)) {
      next(createError(400, 'INVALID_EMAIL', '邮箱格式不正确'))
      return
    }
    const passwordError = validatePassword(password, email)
    if (passwordError) {
      next(createError(400, 'INVALID_PASSWORD', passwordError))
      return
    }
    if (!/^\d{6}$/.test(code)) {
      next(createError(400, 'INVALID_CODE', '验证码为 6 位数字'))
      return
    }

    const ip = clientIp(req)
    if (!checkRate(verifyRateMap, ip, VERIFY_IP_LIMIT_PER_HOUR, 60 * 60 * 1000)) {
      next(createError(429, 'EMAIL_RATE_LIMITED', '操作过于频繁，请稍后再试'))
      return
    }

    consumeCode(email, code)

    const pool = getPool()
    const result = await pool.query(
      'SELECT id, username, role, is_banned FROM users WHERE email = $1',
      [email],
    )
    if (result.rows.length === 0) {
      next(createError(404, 'EMAIL_NOT_REGISTERED', '该邮箱尚未注册，请先注册'))
      return
    }
    const row = result.rows[0] as { id: string; username: string; role: string; is_banned: boolean | number }
    if (typeof row.is_banned === 'number' ? row.is_banned !== 0 : row.is_banned) {
      next(createError(403, 'USER_BANNED', '该账号已被封禁'))
      return
    }

    await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [hashPassword(password), row.id])
    const role = row.role === 'admin' ? 'admin' : 'member'
    await pool.query('UPDATE users SET last_login_at = $1, last_login_ip = $2 WHERE id = $3', [Date.now(), clientIp(req), row.id])
    const migrated = await migrateGuestAssets(req, row.id, role, email)

    const token = signTokenForUser(row.id, role)
    res.cookie(getCookieName(), token, getCookieOptions())
    res.json({
      authenticated: true,
      user: { id: row.id, username: row.username, email, role },
      migrated,
      message: migrated ? '密码已重置，游客资产已迁移到你的账号' : '密码已重置，请记住新密码',
    })
  } catch (error) {
    next(error)
  }
})

// ============================================================================
// POST /api/auth/email/change-password — 已登录用户修改密码
// （需携带有效登录 JWT；验证旧密码后设置新密码，无需验证码）
// emailAuthRouter 挂载在 authMiddleware 之前，这里自行解析 cookie 校验登录态
// ============================================================================

const CHANGE_PASSWORD_IP_LIMIT_PER_HOUR = 20
const changePasswordRateMap = new Map<string, { count: number; windowStart: number }>()

emailAuthRouter.post('/email/change-password', async (req, res, next) => {
  try {
    const identity = identityFromCookie(req)
    if (!identity?.userId || identity.guest) {
      next(createError(401, 'NOT_AUTHENTICATED', '请先登录后再修改密码'))
      return
    }
    const body = req.body as { oldPassword?: unknown; newPassword?: unknown }
    const oldPassword = typeof body.oldPassword === 'string' ? body.oldPassword : ''
    const newPassword = typeof body.newPassword === 'string' ? body.newPassword : ''
    if (!oldPassword || !newPassword) {
      next(createError(400, 'INVALID_INPUT', '请填写当前密码与新密码'))
      return
    }

    const ip = clientIp(req)
    if (!checkRate(changePasswordRateMap, ip, CHANGE_PASSWORD_IP_LIMIT_PER_HOUR, 60 * 60 * 1000)) {
      next(createError(429, 'EMAIL_RATE_LIMITED', '操作过于频繁，请稍后再试'))
      return
    }

    const pool = getPool()
    const result = await pool.query(
      'SELECT id, email, password_hash FROM users WHERE id = $1',
      [identity.userId],
    )
    if (result.rows.length === 0) {
      next(createError(404, 'USER_NOT_FOUND', '账号不存在'))
      return
    }
    const row = result.rows[0] as { id: string; email: string; password_hash: string }
    if (!verifyPassword(oldPassword, row.password_hash)) {
      next(createError(401, 'OLD_PASSWORD_WRONG', '当前密码不正确'))
      return
    }
    if (oldPassword === newPassword) {
      next(createError(400, 'SAME_PASSWORD', '新密码不能与当前密码相同'))
      return
    }
    const passwordError = validatePassword(newPassword, row.email)
    if (passwordError) {
      next(createError(400, 'INVALID_PASSWORD', passwordError))
      return
    }

    await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [hashPassword(newPassword), row.id])
    // 修改密码后清除该邮箱的失败计数（防止旧锁定状态延续）
    clearLoginFailures(row.email.toLowerCase())
    console.log(`[email-auth] password changed: ${row.email} (by ${clientIp(req)})`)
    res.json({ ok: true, message: '密码已更新，下次登录请使用新密码' })
  } catch (error) {
    next(error)
  }
})

// ============================================================================
// POST /api/auth/email/profile — 修改用户称呼（显示名）
// （需携带有效登录 JWT；1-20 字符，去首尾空白，禁止控制字符）
// ============================================================================

const PROFILE_IP_LIMIT_PER_HOUR = 30
const profileRateMap = new Map<string, { count: number; windowStart: number }>()

emailAuthRouter.post('/email/profile', async (req, res, next) => {
  try {
    const identity = identityFromCookie(req)
    if (!identity?.userId || identity.guest) {
      next(createError(401, 'NOT_AUTHENTICATED', '请先登录后再修改称呼'))
      return
    }
    const body = req.body as { displayName?: unknown }
    const displayName = typeof body.displayName === 'string' ? body.displayName.trim().replace(/[\u0000-\u001f\u007f]/g, '') : ''
    if (displayName.length < 1 || displayName.length > 20) {
      next(createError(400, 'INVALID_DISPLAY_NAME', '称呼长度需在 1-20 个字符之间'))
      return
    }

    const ip = clientIp(req)
    if (!checkRate(profileRateMap, ip, PROFILE_IP_LIMIT_PER_HOUR, 60 * 60 * 1000)) {
      next(createError(429, 'EMAIL_RATE_LIMITED', '操作过于频繁，请稍后再试'))
      return
    }

    const pool = getPool()
    await pool.query('UPDATE users SET display_name = $1 WHERE id = $2', [displayName, identity.userId])
    console.log(`[email-auth] display_name updated: user=${identity.userId} → ${displayName} (by ${ip})`)
    res.json({ ok: true, displayName, message: '称呼已更新' })
  } catch (error) {
    next(error)
  }
})
