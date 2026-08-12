import { getServerToken, getDeviceId } from '../utils/deviceAuth'

// Phase 14 B1：prod 模式 loadFile 下 window.location.origin='file://'，
// 相对路径 '/api' 会被解析成 'file:///api' → TypeError。
// 用 ?? 而非 ||（|| 优先级高于 ?:，会导致逻辑错误）
// Phase 14 C4：从主进程获取动态端口（PORT=0 时由 OS 分配），fallback 到 3456
const API_BASE = import.meta.env.VITE_API_BASE_URL
  ?? (typeof window !== 'undefined' && window.location.protocol === 'file:'
    ? `http://localhost:${window.serverPortApi?.getServerPort() ?? 3456}/api`
    : '/api')

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
    const res = await fetch(url.toString(), {
      headers: this.getAuthHeaders(),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: { message: res.statusText } }))
      const message = typeof err.error === 'string'
        ? err.error
        : (err.error?.message || err.message || `API error: ${res.status}`)
      throw new ApiError(message, res.status, err)
    }
    return res.json()
  }

  async post<T>(path: string, body?: unknown): Promise<T> {
    const res = await fetch(this.baseUrl + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...this.getAuthHeaders() },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: { message: res.statusText } }))
      const message = typeof err.error === 'string'
        ? err.error
        : (err.error?.message || err.message || `API error: ${res.status}`)
      throw new ApiError(message, res.status, err)
    }
    return res.json()
  }

  async put<T>(path: string, body?: unknown): Promise<T> {
    const res = await fetch(this.baseUrl + path, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...this.getAuthHeaders() },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: { message: res.statusText } }))
      const message = typeof err.error === 'string'
        ? err.error
        : (err.error?.message || err.message || `API error: ${res.status}`)
      throw new ApiError(message, res.status, err)
    }
    return res.json()
  }

  async delete<T = { ok: boolean }>(path: string, body?: unknown): Promise<T> {
    const opts: RequestInit = {
      method: 'DELETE',
      headers: this.getAuthHeaders(),
    }
    if (body !== undefined) {
      opts.headers = { 'Content-Type': 'application/json', ...this.getAuthHeaders() }
      opts.body = JSON.stringify(body)
    }
    const res = await fetch(this.baseUrl + path, opts)
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: { message: res.statusText } }))
      const message = typeof err.error === 'string'
        ? err.error
        : (err.error?.message || err.message || `API error: ${res.status}`)
      throw new ApiError(message, res.status, err)
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
