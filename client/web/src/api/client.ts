import { getServerToken, getDeviceId } from '../utils/deviceAuth'

// S11 Web 端：永远是 http/https 协议，相对路径 '/api' 通过 Vite proxy 或 server 静态托管转发
// 不再需要桌面端的 file:// 分支和 window.serverPortApi 调用
const API_BASE = import.meta.env.VITE_API_BASE_URL ?? '/api'

/**
 * Phase 4: 增强 API 错误类型，携带 status 和 data（用于 409 冲突检测）
 */
export class ApiError extends Error {
  status: number
  data: unknown
  constructor(message: string, status: number, data?: unknown) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.data = data
  }
}

class ApiClient {
  private baseUrl: string

  constructor(baseUrl: string = API_BASE) {
    this.baseUrl = baseUrl
  }

  async get<T>(path: string, params?: Record<string, string>): Promise<T> {
    const url = new URL(this.baseUrl + path, window.location.origin)
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        if (v !== undefined && v !== null) url.searchParams.set(k, v)
      }
    }
    // S11: credentials:'include' 携带 httpOnly JWT cookie（跨域必需）
    const res = await fetch(url.toString(), {
      headers: this.getAuthHeaders(),
      credentials: 'include',
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: { message: res.statusText } }))
      throw new ApiError(err.error?.message || `API error: ${res.status}`, res.status, err)
    }
    return res.json()
  }

  async post<T>(path: string, body?: unknown): Promise<T> {
    const res = await fetch(this.baseUrl + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...this.getAuthHeaders() },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      credentials: 'include',
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: { message: res.statusText } }))
      throw new ApiError(err.error?.message || `API error: ${res.status}`, res.status, err)
    }
    return res.json()
  }

  async put<T>(path: string, body?: unknown): Promise<T> {
    const res = await fetch(this.baseUrl + path, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...this.getAuthHeaders() },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      credentials: 'include',
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: { message: res.statusText } }))
      throw new ApiError(err.error?.message || `API error: ${res.status}`, res.status, err)
    }
    return res.json()
  }

  async delete<T = { ok: boolean }>(path: string, body?: unknown): Promise<T> {
    const opts: RequestInit = {
      method: 'DELETE',
      headers: this.getAuthHeaders(),
      credentials: 'include',
    }
    if (body !== undefined) {
      opts.headers = { 'Content-Type': 'application/json', ...this.getAuthHeaders() }
      opts.body = JSON.stringify(body)
    }
    const res = await fetch(this.baseUrl + path, opts)
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: { message: res.statusText } }))
      throw new ApiError(err.error?.message || `API error: ${res.status}`, res.status, err)
    }
    return res.json()
  }

  private getAuthHeaders(): Record<string, string> {
    const headers: Record<string, string> = {}
    const token = getServerToken()
    if (token) headers['Authorization'] = `Bearer ${token}`
    const deviceId = getDeviceId()
    if (deviceId) headers['X-Device-Id'] = deviceId
    return headers
  }
}

export const api = new ApiClient()
