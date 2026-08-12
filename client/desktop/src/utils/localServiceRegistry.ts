/**
 * Phase 6.2：本地服务注册客户端（spec 3.3.6 节）
 *
 * 桌面端通过此模块向服务器注册本地服务（如 localhost:3001 的笔记服务），
 * 服务器通过 WS 转发 proxy_request，桌面端执行本地 fetch 后返回 proxy_response。
 *
 * 配置文件路径：app.getPath('userData')/local-services.json（通过 IPC 读取）
 * 配置文件不存在时跳过注册（不创建文件）
 */

import { api } from '../api/client'
import type { LocalServiceConfig } from '../types/electron'

const HEARTBEAT_INTERVAL_MS = 30_000

// 判断 Content-Type 是否为文本类（json/text），非文本类用 Base64 编码
function isTextContentType(contentType: string | null | undefined): boolean {
  if (!contentType) return true // 无 Content-Type 默认按文本处理
  const ct = contentType.toLowerCase()
  return ct.includes('application/json') || ct.includes('text/') || ct.includes('xml') || ct.includes('javascript')
}

// ArrayBuffer 转 Base64
function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  return btoa(binary)
}

class LocalServiceRegistryClient {
  private services: LocalServiceConfig[] = []
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null

  /**
   * 从 app.getPath('userData')/local-services.json 加载配置（通过 IPC）
   * 文件不存在时跳过（services 保持为空数组）
   */
  async loadConfig(): Promise<void> {
    try {
      const config = await window.localServicesApi?.readConfig()
      if (config?.services && Array.isArray(config.services)) {
        this.services = config.services
        console.log(`[LocalServiceRegistry] Loaded ${this.services.length} services from config`)
      } else {
        this.services = []
      }
    } catch (err) {
      console.error('[LocalServiceRegistry] Failed to load config:', err)
      this.services = []
    }
  }

  /**
   * 注册所有服务到服务器
   */
  async registerAll(): Promise<void> {
    if (this.services.length === 0) return

    for (const svc of this.services) {
      try {
        await api.post('/local-services/register', {
          serviceName: svc.serviceName,
          endpoint: svc.endpoint,
          description: svc.description,
        })
        console.log(`[LocalServiceRegistry] Registered: ${svc.serviceName} -> ${svc.endpoint}`)
      } catch (err) {
        console.error(`[LocalServiceRegistry] Failed to register ${svc.serviceName}:`, err)
      }
    }
  }

  /**
   * 启动心跳（30 秒一次）
   */
  startHeartbeat(): void {
    if (this.heartbeatInterval) return
    if (this.services.length === 0) return

    // 立即发一次心跳
    void this.sendHeartbeat()

    this.heartbeatInterval = setInterval(() => {
      void this.sendHeartbeat()
    }, HEARTBEAT_INTERVAL_MS)
    console.log(`[LocalServiceRegistry] Heartbeat started for ${this.services.length} services`)
  }

  /**
   * 停止心跳
   */
  stopHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval)
      this.heartbeatInterval = null
      console.log('[LocalServiceRegistry] Heartbeat stopped')
    }
  }

  /**
   * 注销所有服务（应用退出时调用）
   */
  async unregisterAll(): Promise<void> {
    if (this.services.length === 0) return

    this.stopHeartbeat()

    const serviceNames = this.services.map(s => s.serviceName)
    try {
      await api.post('/local-services/unregister', { serviceNames })
      console.log(`[LocalServiceRegistry] Unregistered ${serviceNames.length} services`)
    } catch (err) {
      console.error('[LocalServiceRegistry] Failed to unregister services:', err)
      // 服务器心跳超时会自动标记 offline，不强制重试
    }
  }

  /**
   * 处理服务器发来的 proxy_request，执行本地 fetch
   */
  async handleProxyRequest(msg: {
    requestId: string
    serviceName: string
    method: string
    path: string
    headers: Record<string, string>
    body: string | null
  }): Promise<{
    requestId: string
    status: number
    headers: Record<string, string>
    body: string
  }> {
    const svc = this.services.find(s => s.serviceName === msg.serviceName)
    if (!svc) {
      return {
        requestId: msg.requestId,
        status: 404,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ error: 'service_not_found', message: `本地服务 ${msg.serviceName} 未注册` }),
      }
    }

    // 构造完整 URL：${endpoint}/${path}
    const url = msg.path ? `${svc.endpoint}/${msg.path}` : svc.endpoint

    try {
      const fetchOptions: RequestInit = {
        method: msg.method,
        headers: msg.headers,
      }
      if (msg.body !== null && msg.method !== 'GET' && msg.method !== 'HEAD') {
        fetchOptions.body = msg.body
      }

      const res = await fetch(url, fetchOptions)

      // 转换响应 headers 为 Record<string, string>
      const responseHeaders: Record<string, string> = {}
      res.headers.forEach((value, key) => {
        responseHeaders[key] = value
      })

      // 根据 Content-Type 决定 body 编码方式
      const contentType = res.headers.get('content-type')
      if (isTextContentType(contentType)) {
        const body = await res.text()
        return {
          requestId: msg.requestId,
          status: res.status,
          headers: responseHeaders,
          body,
        }
      } else {
        // 二进制响应：Base64 编码，headers 加 X-Proxy-Base64: true
        const buffer = await res.arrayBuffer()
        const body = arrayBufferToBase64(buffer)
        responseHeaders['x-proxy-base64'] = 'true'
        return {
          requestId: msg.requestId,
          status: res.status,
          headers: responseHeaders,
          body,
        }
      }
    } catch (err) {
      console.error(`[LocalServiceRegistry] Proxy fetch failed for ${msg.serviceName}:`, err)
      return {
        requestId: msg.requestId,
        status: 502,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          error: 'proxy_fetch_failed',
          message: err instanceof Error ? err.message : '本地服务请求失败',
        }),
      }
    }
  }

  private async sendHeartbeat(): Promise<void> {
    if (this.services.length === 0) return
    const serviceNames = this.services.map(s => s.serviceName)
    try {
      await api.post('/local-services/heartbeat', { serviceNames })
    } catch (err) {
      console.error('[LocalServiceRegistry] Heartbeat failed:', err)
    }
  }
}

export const localServiceRegistry = new LocalServiceRegistryClient()
