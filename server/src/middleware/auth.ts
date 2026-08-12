import { Request, Response, NextFunction } from 'express'
import { verifyToken, parseCookies, getCookieName, getCookieOptions, type UserRole } from '../utils/jwt.js'
import { safeCompare } from '../utils/crypto.js'
import { createError } from './error.js'
import { getPool } from '../db/connection.js'

// 扩展 Express Request 类型，增加 deviceId + user 字段
declare module 'express-serve-static-core' {
  interface Request {
    deviceId?: string
    user?: {
      authenticated: true
      /** 多用户模式下的用户 ID（单密码模式 / 游客为 undefined） */
      userId?: string
      /** 多用户模式下的角色（单密码模式为 undefined；游客为 'guest'） */
      role?: UserRole
      /** 单密码模式标记 */
      singlePassword?: boolean
      /** 游客标记（true 表示游客 JWT，无真实用户身份） */
      guest?: boolean
      /** 游客设备 ID（仅游客 JWT 携带，用于限频） */
      guestDeviceId?: string
      /** 多用户模式：用户邮箱（从 users 表读取，带缓存；用于 webOS 会话展示） */
      email?: string | null
      /** 多用户模式：用户名 */
      username?: string | null
      /** 多用户模式：是否已设置自定义称呼（display_name 非空） */
      displayNameSet?: boolean
    }
  }
}

// 用户元数据缓存（email/username），TTL 60s，避免每次请求都查 users 表
interface UserMetaCacheEntry {
  email: string | null
  username: string | null
  displayNameSet: boolean
  fetchedAt: number
}
const USER_META_TTL_MS = 60_000
const userMetaCache = new Map<string, UserMetaCacheEntry>()

/** 读取用户 email/username（带 TTL 缓存；失败降级返回 null，不阻断请求）。
 * username 优先返回用户自定义的 display_name（称呼），未设置时回退注册用户名（邮箱前缀）。 */
async function getUserMeta(userId: string): Promise<{ email: string | null; username: string | null; displayNameSet: boolean }> {
  const cached = userMetaCache.get(userId)
  if (cached && Date.now() - cached.fetchedAt < USER_META_TTL_MS) {
    return { email: cached.email, username: cached.username, displayNameSet: cached.displayNameSet }
  }
  try {
    const pool = getPool()
    const result = await pool.query('SELECT email, username, display_name FROM users WHERE id = $1', [userId])
    const row = result.rows[0] as { email?: string; username?: string; display_name?: string | null } | undefined
    const displayName = row?.display_name && String(row.display_name).trim()
    const meta = {
      email: row?.email ?? null,
      username: displayName || row?.username || null,
      displayNameSet: Boolean(displayName),
    }
    userMetaCache.set(userId, { ...meta, fetchedAt: Date.now() })
    return meta
  } catch {
    return { email: null, username: null, displayNameSet: false }
  }
}

let devModeWarned = false

/**
 * 判断是否为 Electron fork server 模式（桌面端内嵌 server）。
 * Electron fork 时 ELECTRON_RUN_AS_NODE=1，且不需要 Web 端认证。
 */
function isElectronFork(): boolean {
  return process.env.ELECTRON_RUN_AS_NODE === '1'
}

/**
 * HTTP 认证中间件（Phase S11 双路径升级版 + Phase 4 多用户扩展）
 *
 * - 路径 1：JWT cookie 优先（Web 端）—— parseCookies + verifyToken
 *   - 多用户模式 JWT 携带 userId/role，注入 req.user
 *   - 单密码模式 JWT 仅携带 authenticated，req.user 无 userId/role
 * - 路径 2：SERVER_TOKEN Bearer fallback（桌面/移动端）
 * - dev 模式（SERVER_TOKEN 空）下：
 *   - Electron fork server（ELECTRON_RUN_AS_NODE=1）：放行
 *   - 同源请求（无 Origin 头，curl/桌面端 renderer）：放行
 *   - 跨域请求（带 Origin 头，Web 端浏览器）：拒绝，强制走 JWT cookie 登录
 * - /api/health 和 /api/auth/login、/api/auth/register、/api/auth/email/* 在
 *   index.ts 中先于本中间件注册，自然豁免
 */
export async function authMiddleware(req: Request, res: Response, next: NextFunction): Promise<void> {
  // 路径 1：JWT cookie（Web 端）—— 必须先检查，因为 Web 端必须走 JWT
  const cookies = parseCookies(req.headers.cookie)
  const jwtToken = cookies[getCookieName()]
  if (jwtToken) {
    const payload = verifyToken(jwtToken)
    if (payload?.authenticated) {
      req.user = {
        authenticated: true,
        userId: payload.userId,
        role: payload.role,
        singlePassword: payload.singlePassword,
        guest: payload.guest,
        guestDeviceId: payload.deviceId,
      }
      // 多用户模式：附带 email/username（webOS 会话头部展示用）
      if (payload.userId && !payload.guest) {
        const meta = await getUserMeta(payload.userId)
        req.user.email = meta.email
        req.user.username = meta.username
        req.user.displayNameSet = meta.displayNameSet
      }
      const devId = req.headers['x-device-id']
      if (typeof devId === 'string') {
        req.deviceId = devId
      }
      next()
      return
    }
    // JWT 无效：清除 cookie 并返回 401（不 fallback 到 SERVER_TOKEN，防止 Web 端绕过登录）
    const opts = getCookieOptions()
    res.clearCookie(getCookieName(), { path: opts.path, sameSite: opts.sameSite, secure: opts.secure })
    res.status(401).json({ error: 'INVALID_JWT' })
    return
  }

  // 路径 2：SERVER_TOKEN Bearer（桌面/移动端 fallback）
  const serverToken = process.env.SERVER_TOKEN

  if (!serverToken) {
    // dev 模式（SERVER_TOKEN 空）放行规则：
    // - Electron fork server（桌面端内嵌）：放行（桌面端不需要 Web 认证）
    // - 同源请求（无 Origin 头，curl/桌面端 renderer）：放行
    // - 跨域请求（带 Origin 头，Web 端浏览器）：**拒绝**，强制走 JWT cookie 登录
    //   防止 Web 端 dev 模式未登录绕过鉴权
    const origin = req.headers.origin
    if (origin && !isElectronFork()) {
      // Web 端跨域请求且无 JWT → 拒绝（让前端跳 /login）
      res.status(401).json({ error: 'UNAUTHORIZED', message: 'Login required' })
      return
    }
    if (!devModeWarned && !isElectronFork()) {
      devModeWarned = true
      console.warn('[Auth] WARNING: SERVER_TOKEN not set — running in dev mode. DO NOT use in production.')
    }
    const devId = req.headers['x-device-id']
    if (typeof devId === 'string') {
      req.deviceId = devId
    }
    next()
    return
  }

  const authHeader = req.headers.authorization
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    next(createError(401, 'UNAUTHORIZED', 'Missing or invalid Authorization header'))
    return
  }
  const token = authHeader.slice(7)
  if (!safeCompare(token, serverToken)) {
    next(createError(401, 'UNAUTHORIZED', 'Invalid token'))
    return
  }

  const devId = req.headers['x-device-id']
  if (typeof devId === 'string') {
    req.deviceId = devId
  }
  next()
}

/**
 * Phase 4：要求已登录的多用户（非单密码模式）。
 * 用于需要用户身份的接口（创建面板、获取用户面板列表等）。
 * 单密码模式用户（无 userId）将被拒绝，提示需要注册登录。
 */
export function requireUser(req: Request, res: Response, next: NextFunction): void {
  if (!req.user?.authenticated) {
    next(createError(401, 'UNAUTHORIZED', 'Login required'))
    return
  }
  if (!req.user.userId) {
    res.status(401).json({
      error: {
        status: 401,
        code: 'USER_LOGIN_REQUIRED',
        message: '此操作需要用户登录（不支持单密码模式）',
      },
    })
    return
  }
  next()
}

/**
 * Phase 4：要求 admin 角色。
 * 必须在 requireUser 之后使用（或单独使用时同时检查 authenticated + role）。
 */
export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  if (!req.user?.authenticated || !req.user.userId) {
    next(createError(401, 'UNAUTHORIZED', 'Admin login required'))
    return
  }
  if (req.user.role !== 'admin') {
    res.status(403).json({
      error: {
        status: 403,
        code: 'FORBIDDEN',
        message: '需要管理员权限',
      },
    })
    return
  }
  next()
}
