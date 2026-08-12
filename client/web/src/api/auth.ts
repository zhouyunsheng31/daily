// ============================================================================
// Phase 4：前端 Auth API 客户端
// ============================================================================

export type UserRole = 'admin' | 'member'

export interface UserInfo {
  id: string
  username: string
  email: string
  role: UserRole
  isBanned: boolean
  createdAt: number
  lastLoginAt: number | null
}

export interface AuthMeResponse {
  authenticated: boolean
  singlePassword?: boolean
  user?: UserInfo
}

export interface LoginResponse {
  authenticated: boolean
  token: string
  singlePassword?: boolean
  user?: UserInfo
}

export interface RegisterResponse {
  authenticated: boolean
  token: string
  user: { id: string; username: string; email: string; role: UserRole }
}

/**
 * 注册新用户
 */
export async function register(username: string, email: string, password: string): Promise<RegisterResponse> {
  const res = await fetch('/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ username, email, password }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error(data?.error?.message || `注册失败 (${res.status})`)
  }
  if (data.token) {
    sessionStorage.setItem('daily-jwt', data.token)
  }
  return data as RegisterResponse
}

/**
 * 登录（用户名/邮箱 + 密码，或单密码模式）
 */
export async function login(params: { username?: string; email?: string; password: string }): Promise<LoginResponse> {
  const res = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(params),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error(data?.error?.message || `登录失败 (${res.status})`)
  }
  if (data.token) {
    sessionStorage.setItem('daily-jwt', data.token)
  }
  return data as LoginResponse
}

/**
 * 获取当前用户信息
 */
export async function getMe(): Promise<AuthMeResponse> {
  const res = await fetch('/api/auth/me', { credentials: 'include' })
  if (!res.ok) {
    return { authenticated: false }
  }
  return res.json()
}

/**
 * 登出
 */
export async function logout(): Promise<void> {
  sessionStorage.removeItem('daily-jwt')
  await fetch('/api/auth/logout', {
    method: 'POST',
    credentials: 'include',
  })
}

/**
 * 游客登录：获取游客 JWT（免鉴权端点）
 * 游客 JWT 写入 cookie 后，WS 和 HTTP API 可正常连接/访问社区面板。
 * 游客 AI 调用受服务器限频（5次/分，50次/天）。
 * @param deviceId 可选，客户端可传已有 deviceId 复用游客身份
 */
export async function guestLogin(deviceId?: string): Promise<{
  authenticated: boolean
  token: string
  user: { id: string; username: string; role: 'guest' }
}> {
  const res = await fetch('/api/auth/guest', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ deviceId }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error(data?.error?.message || `游客登录失败 (${res.status})`)
  }
  if (data.token) {
    sessionStorage.setItem('daily-jwt', data.token)
  }
  return data
}

// ============================================================================
// Admin 用户管理 API
// ============================================================================

export async function adminListUsers(): Promise<UserInfo[]> {
  const res = await fetch('/api/admin/users', { credentials: 'include' })
  if (!res.ok) throw new Error(`获取用户列表失败 (${res.status})`)
  return res.json()
}

export async function adminBanUser(id: string, isBanned: boolean): Promise<UserInfo> {
  const res = await fetch(`/api/admin/users/${id}/ban`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ isBanned }),
  })
  if (!res.ok) throw new Error('操作失败')
  return res.json()
}

export async function adminUpdateUserRole(id: string, role: UserRole): Promise<UserInfo> {
  const res = await fetch(`/api/admin/users/${id}/role`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ role }),
  })
  if (!res.ok) throw new Error('操作失败')
  return res.json()
}
