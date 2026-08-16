import { Router } from 'express'
import { v4 as uuidv4 } from 'uuid'
import { signToken, signTokenForUser, signGuestToken, getCookieName, getCookieOptions, type UserRole } from '../utils/jwt.js'
import { safeCompare, hashPassword, verifyPassword } from '../utils/crypto.js'
import { getPool } from '../db/connection.js'
import { createError } from '../middleware/error.js'

// 拆分为两个 Router：login/register 免鉴权，其他走全局 authMiddleware
export const authLoginRouter = Router()      // POST /login, POST /register
export const authProtectedRouter = Router()  // GET /me, POST /refresh, POST /logout

// ============================================================================
// Phase 4.2：管理员名单机制
// 通过环境变量 ADMIN_USERNAMES（逗号分隔）预声明管理员用户名
// - 注册时：用户名匹配此列表 → 自动赋予 admin 角色
// - migration 时：为列表中的用户名预创建 admin 账号
// ============================================================================

function getAdminUsernames(): string[] {
  const raw = process.env.ADMIN_USERNAMES
  if (!raw) return []
  return raw
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length > 0)
}

function isAdminUsername(username: string): boolean {
  const list = getAdminUsernames()
  if (list.length === 0) return false
  return list.includes(username.trim().toLowerCase())
}

// ============================================================================
// 用户行解析（PG 返回 snake_case，统一转 camelCase；兼容 SQLite boolean 0/1）
// ============================================================================

interface UserRow {
  id: string
  username: string
  email: string
  password_hash: string
  role: string
  is_banned: boolean | number
  created_at: number
  last_login_at: number | null
}

interface PublicUser {
  id: string
  username: string
  email: string
  role: UserRole
  isBanned: boolean
  createdAt: number
  lastLoginAt: number | null
}

function parseUserRow(row: UserRow): PublicUser {
  return {
    id: row.id,
    username: row.username,
    email: row.email,
    role: row.role as UserRole,
    isBanned: typeof row.is_banned === 'number' ? row.is_banned !== 0 : !!row.is_banned,
    createdAt: row.created_at,
    lastLoginAt: row.last_login_at,
  }
}

function toPublicUser(u: PublicUser) {
  return {
    id: u.id,
    username: u.username,
    email: u.email,
    role: u.role,
    isBanned: u.isBanned,
    createdAt: u.createdAt,
    lastLoginAt: u.lastLoginAt,
  }
}

// ============================================================================
// POST /api/auth/register - 注册新用户（免鉴权）
// ============================================================================

authLoginRouter.post('/register', async (req, res, next) => {
  try {
    const { username, email, password } = req.body as {
      username?: string
      email?: string
      password?: string
    }

    // 参数校验
    if (!username || typeof username !== 'string' || username.trim().length < 2) {
      next(createError(400, 'INVALID_INPUT', '用户名至少 2 个字符'))
      return
    }
    if (!email || typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      next(createError(400, 'INVALID_INPUT', '邮箱格式不正确'))
      return
    }
    if (!password || typeof password !== 'string' || password.length < 6) {
      next(createError(400, 'INVALID_INPUT', '密码至少 6 个字符'))
      return
    }

    const pool = getPool()
    const normalizedUsername = username.trim()
    const normalizedEmail = email.trim().toLowerCase()

    // 唯一性检查
    const existing = await pool.query(
      'SELECT id FROM users WHERE username = $1 OR email = $2',
      [normalizedUsername, normalizedEmail]
    )
    if (existing.rows.length > 0) {
      next(createError(409, 'USER_EXISTS', '用户名或邮箱已被注册'))
      return
    }

    // 角色判定（优先级）：
    // 1. Phase 4.2：用户名在 ADMIN_USERNAMES 名单中 → admin
    // 2. 其他 → member
    // 【安全修复 2026-08-16：删除"首个注册用户自动 admin"——新部署/清空用户表后
    // 攻击者抢先注册即可获得管理员权限。管理员必须通过 ADMIN_USERNAMES 名单
    // 或初始化脚本精确创建。】
    let role: UserRole = isAdminUsername(normalizedUsername) ? 'admin' : 'member'

    const userId = uuidv4()
    const passwordHash = hashPassword(password)
    const now = Date.now()

    await pool.query(
      `INSERT INTO users (id, username, email, password_hash, role, is_banned, created_at, last_login_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $7)`,
      [userId, normalizedUsername, normalizedEmail, passwordHash, role, false, now]
    )

    const token = signTokenForUser(userId, role)
    res.cookie(getCookieName(), token, getCookieOptions())

    res.status(201).json({
      authenticated: true,
      token,
      user: { id: userId, username: normalizedUsername, email: normalizedEmail, role },
    })
  } catch (e) { next(e) }
})

// ============================================================================
// POST /api/auth/login - 登录（支持多用户 + 单密码 fallback）
// ============================================================================
// 多用户模式：接收 { username, password } 或 { email, password }
// 单密码 fallback：接收 { password }，仅当 WEB_ACCESS_PASSWORD 配置时生效
// 优先级：若 body 含 username 或 email，走多用户模式；否则走单密码 fallback
// ============================================================================

authLoginRouter.post('/login', async (req, res, next) => {
  try {
    const { username, email, password } = req.body as {
      username?: string
      email?: string
      password?: string
    }

    if (!password || typeof password !== 'string') {
      next(createError(400, 'INVALID_INPUT', '密码必填'))
      return
    }

    // 多用户模式：提供了 username 或 email
    if (username || email) {
      const pool = getPool()
      const identifier = (username ?? email ?? '').trim().toLowerCase()
      const result = await pool.query(
        'SELECT * FROM users WHERE LOWER(username) = $1 OR LOWER(email) = $1',
        [identifier]
      )
      if (result.rows.length === 0) {
        next(createError(401, 'INVALID_CREDENTIALS', '用户名或密码错误'))
        return
      }
      const userRow = result.rows[0] as UserRow
      const user = parseUserRow(userRow)
      if (user.isBanned) {
        next(createError(403, 'USER_BANNED', '账号已被封禁'))
        return
      }
      if (!verifyPassword(password, userRow.password_hash)) {
        next(createError(401, 'INVALID_CREDENTIALS', '用户名或密码错误'))
        return
      }

      // 更新最后登录时间
      const now = Date.now()
      await pool.query('UPDATE users SET last_login_at = $1 WHERE id = $2', [now, user.id])

      const token = signTokenForUser(user.id, user.role)
      res.cookie(getCookieName(), token, getCookieOptions())
      res.json({
        authenticated: true,
        token,
        user: toPublicUser(user),
      })
      return
    }

    // 单密码 fallback
    // 设计文档：部署者 = 该实例管理员。单密码登录用户应被赋予 admin 角色。
    const expected = process.env.WEB_ACCESS_PASSWORD
    if (!expected) {
      next(createError(503, 'WEB_ACCESS_PASSWORD_NOT_CONFIGURED', 'Server admin has not set WEB_ACCESS_PASSWORD'))
      return
    }
    if (!safeCompare(password, expected)) {
      next(createError(401, 'INVALID_CREDENTIALS', 'Password incorrect'))
      return
    }

    // 查找或创建 admin 用户（部署者 = 管理员）
    const pool = getPool()
    let adminResult = await pool.query('SELECT * FROM users WHERE username = $1', ['admin'])
    let adminUser: PublicUser
    if (adminResult.rows.length === 0) {
      // 迁移未创建 admin 用户，现场创建
      const userId = uuidv4()
      const passwordHash = hashPassword(password)
      const now = Date.now()
      await pool.query(
        `INSERT INTO users (id, username, email, password_hash, role, is_banned, created_at, last_login_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $7)`,
        [userId, 'admin', 'admin@local', passwordHash, 'admin', false, now]
      )
      adminUser = {
        id: userId, username: 'admin', email: 'admin@local',
        role: 'admin', isBanned: false, createdAt: now, lastLoginAt: now,
      }
    } else {
      adminUser = parseUserRow(adminResult.rows[0] as UserRow)
      // 更新最后登录时间
      await pool.query('UPDATE users SET last_login_at = $1 WHERE id = $2', [Date.now(), adminUser.id])
    }

    const token = signTokenForUser(adminUser.id, adminUser.role)
    res.cookie(getCookieName(), token, getCookieOptions())
    res.json({ authenticated: true, token, user: toPublicUser(adminUser) })
  } catch (e) { next(e) }
})

// ============================================================================
// POST /api/auth/guest - 游客 JWT 发放（免鉴权）
// ============================================================================
// 游客不是真实用户，不创建 users 表记录。
// 生成游客 JWT（payload: { authenticated: true, guest: true, deviceId, role: 'guest' }）
// JWT 写入 cookie（和正常登录一样），后端能区分游客 vs 真实用户。
// 限频：按 IP 限制每小时最多 N 次请求（防止滥用），内存 Map 实现，重启重置。
// ============================================================================

const GUEST_RATE_LIMIT_PER_HOUR = 20  // 每个 IP 每小时最多请求 20 次游客 JWT
const GUEST_RATE_WINDOW_MS = 60 * 60 * 1000

// Map<ip, { count, windowStart }>
const guestRateLimitMap = new Map<string, { count: number; windowStart: number }>()

/** 提取客户端真实 IP（优先 X-Forwarded-For，兼容反代） */
function getClientIp(req: { headers: Record<string, string | string[] | undefined>; socket: { remoteAddress?: string } }): string {
  const xff = req.headers['x-forwarded-for']
  if (xff) {
    const ip = Array.isArray(xff) ? xff[0] : xff.split(',')[0]
    return ip?.trim() || 'unknown'
  }
  return req.socket.remoteAddress || 'unknown'
}

/** 游客端点 IP 限频检查：超过阈值返回 false */
function checkGuestRateLimit(ip: string): boolean {
  const now = Date.now()
  let entry = guestRateLimitMap.get(ip)
  if (!entry || now - entry.windowStart > GUEST_RATE_WINDOW_MS) {
    // 新窗口或窗口过期
    entry = { count: 0, windowStart: now }
    guestRateLimitMap.set(ip, entry)
  }
  entry.count++
  return entry.count <= GUEST_RATE_LIMIT_PER_HOUR
}

authLoginRouter.post('/guest', async (req, res, next) => {
  try {
    // 1. IP 限频检查
    const ip = getClientIp(req)
    if (!checkGuestRateLimit(ip)) {
      next(createError(429, 'RATE_LIMITED', '游客 JWT 请求过于频繁，请稍后再试或登录'))
      return
    }

    // 2. 获取或生成 deviceId（客户端可传 body.deviceId，否则服务端生成）
    const body = req.body as { deviceId?: string }
    let deviceId = body?.deviceId
    if (!deviceId || typeof deviceId !== 'string' || deviceId.length > 128) {
      deviceId = uuidv4()
    }

    // 3. 签发游客 JWT（不创建 users 表记录）
    const token = signGuestToken(deviceId)
    res.cookie(getCookieName(), token, getCookieOptions())

    res.status(200).json({
      authenticated: true,
      token,
      user: {
        id: `guest-${deviceId}`,
        username: '游客',
        role: 'guest' as UserRole,
      },
    })
  } catch (e) { next(e) }
})

// ============================================================================
// GET /api/auth/me - 获取当前用户信息（走鉴权）
// ============================================================================

authProtectedRouter.get('/me', async (req, res, next) => {
  try {
    if (!req.user?.authenticated) {
      res.status(401).json({ error: { code: 'NOT_AUTHENTICATED', message: 'Not authenticated' } })
      return
    }
    // 游客模式：返回游客标识（不查 users 表，游客无真实用户记录）
    if (req.user.guest) {
      res.json({
        authenticated: true,
        guest: true,
        user: {
          id: `guest-${req.user.guestDeviceId ?? 'unknown'}`,
          username: '游客',
          role: 'guest',
        },
      })
      return
    }
    // 单密码模式：仅返回 authenticated
    if (!req.user.userId) {
      res.json({ authenticated: true, singlePassword: true })
      return
    }
    // 多用户模式：从 DB 查询最新用户信息
    const pool = getPool()
    const result = await pool.query('SELECT * FROM users WHERE id = $1', [req.user.userId])
    if (result.rows.length === 0) {
      res.status(401).json({ error: { code: 'USER_NOT_FOUND', message: 'User not found' } })
      return
    }
    const user = parseUserRow(result.rows[0] as UserRow)
    res.json({ authenticated: true, user: toPublicUser(user) })
  } catch (e) { next(e) }
})

// ============================================================================
// POST /api/auth/refresh - 刷新 token（走鉴权）
// ============================================================================

authProtectedRouter.post('/refresh', (req, res) => {
  if (!req.user?.authenticated) {
    res.status(401).json({ error: { code: 'NOT_AUTHENTICATED', message: 'Not authenticated' } })
    return
  }
  // 游客模式：用 deviceId 重新签发游客 JWT（保持 guest 标记）
  if (req.user.guest && req.user.guestDeviceId) {
    const token = signGuestToken(req.user.guestDeviceId)
    res.cookie(getCookieName(), token, getCookieOptions())
    res.json({ authenticated: true, token })
    return
  }
  // 多用户模式：用 userId/role 重新签发；单密码模式：用 signToken()
  const token = req.user.userId && req.user.role
    ? signTokenForUser(req.user.userId, req.user.role)
    : signToken()
  res.cookie(getCookieName(), token, getCookieOptions())
  res.json({ authenticated: true, token })
})

// ============================================================================
// POST /api/auth/logout - 登出（走鉴权）
// ============================================================================

authProtectedRouter.post('/logout', (_req, res) => {
  const opts = getCookieOptions()
  res.clearCookie(getCookieName(), { path: opts.path, sameSite: opts.sameSite, secure: opts.secure })
  res.json({ authenticated: false })
})
