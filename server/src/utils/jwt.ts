import jwt from 'jsonwebtoken'

const COOKIE_NAME = 'access_token'
const TOKEN_EXPIRES_IN = '1d'

/** 用户角色：admin（管理员）/ member（普通用户）/ guest（游客，仅限游客 JWT） */
export type UserRole = 'admin' | 'member' | 'guest'

export interface JwtPayload {
  authenticated: true
  /** 多用户模式下的用户 ID（单密码模式 / 游客为 undefined） */
  userId?: string
  /** 多用户模式下的角色（单密码模式 / 游客为 undefined；游客用 'guest'） */
  role?: UserRole
  /** 单密码模式标记（true 表示通过 WEB_ACCESS_PASSWORD 登录） */
  singlePassword?: boolean
  /** 游客标记（true 表示游客 JWT，无真实用户身份） */
  guest?: boolean
  /** 游客设备 ID（仅游客 JWT 携带，用于限频） */
  deviceId?: string
  iat?: number
  exp?: number
}

/**
 * S11 单用户模式：固定 payload { authenticated: true }，无参数。
 * 保留用于 WEB_ACCESS_PASSWORD 单密码 fallback 模式。
 */
export function signToken(): string {
  const secret = process.env.JWT_SECRET
  if (!secret) {
    throw new Error('JWT_SECRET env required')
  }
  return jwt.sign({ authenticated: true, singlePassword: true }, secret, {
    algorithm: 'HS256',
    expiresIn: TOKEN_EXPIRES_IN,
  })
}

/**
 * Phase 4：多用户模式签发 JWT，payload 携带 userId 和 role。
 */
export function signTokenForUser(userId: string, role: UserRole): string {
  const secret = process.env.JWT_SECRET
  if (!secret) {
    throw new Error('JWT_SECRET env required')
  }
  return jwt.sign({ authenticated: true, userId, role }, secret, {
    algorithm: 'HS256',
    expiresIn: TOKEN_EXPIRES_IN,
  })
}

/**
 * 游客 JWT：payload 携带 guest: true + deviceId，无真实用户身份。
 * - 不创建 users 表记录
 * - 鉴权中间件放行（authenticated: true），但 req.user.userId 为 undefined
 * - panels / widgets 等接口对游客只返回社区数据
 * - WS verifyClient 放行游客连接
 * - piBridge 按 deviceId 限频游客 AI 调用
 */
export function signGuestToken(deviceId: string): string {
  const secret = process.env.JWT_SECRET
  if (!secret) {
    throw new Error('JWT_SECRET env required')
  }
  return jwt.sign({ authenticated: true, guest: true, deviceId, role: 'guest' }, secret, {
    algorithm: 'HS256',
    expiresIn: TOKEN_EXPIRES_IN,
  })
}

export function verifyToken(token: string): JwtPayload | null {
  const secret = process.env.JWT_SECRET
  if (!secret) return null
  try {
    return jwt.verify(token, secret, { algorithms: ['HS256'] }) as JwtPayload
  } catch {
    return null
  }
}

export function getCookieName(): string {
  return COOKIE_NAME
}

export function getCookieOptions() {
  const isProd = process.env.NODE_ENV === 'production'
  return {
    httpOnly: true,
    secure: isProd,
    // 2026-08-04：生产改 SameSite=None——App 在 sandbox srcdoc iframe（opaque origin）
    // 里用 <img src="/webos/api/..."> 加载宿主图片时，SameSite=Lax/Strict 的 cookie
    // 不会随 subresource 请求发送（opaque origin 视为 cross-site）→ 图片 401 全挂。
    // None + Secure 让 iframe 内资源请求也能带 cookie（图片 URL 含随机文件名，可接受）。
    sameSite: isProd ? ('none' as const) : ('lax' as const),
    maxAge: 86400000, // 1 day in ms
    path: '/',
  }
}

export function parseCookies(cookieHeader: string | undefined): Record<string, string> {
  const cookies: Record<string, string> = {}
  if (!cookieHeader) return cookies
  for (const pair of cookieHeader.split(';')) {
    const [key, ...valueParts] = pair.trim().split('=')
    if (key && valueParts.length > 0) {
      cookies[key.trim()] = valueParts.join('=').trim()
    }
  }
  return cookies
}
