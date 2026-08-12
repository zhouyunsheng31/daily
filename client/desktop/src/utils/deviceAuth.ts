/**
 * DeviceAuth — Phase 3 客户端设备认证工具
 *
 * Per spec section 6.4:
 * - getDeviceId(): 从 localStorage 读取或生成 UUID（用 uuid 包的 v4）
 * - getServerToken(): 从 localStorage 读取或从 VITE_SERVER_TOKEN 环境变量读取
 * - setServerToken(token): 设置 token 到 localStorage
 * - getServerBaseUrl(): 从 VITE_API_BASE_URL 环境变量读取，默认 '/api'
 */

import { v4 as uuidv4 } from 'uuid'

const DEVICE_ID_KEY = 'living-dashboard-device-id'
const SERVER_TOKEN_KEY = 'living-dashboard-server-token'

/**
 * 获取或生成 deviceId（localStorage 持久化）
 * 首次调用时生成 UUID v4 并存入 localStorage，后续直接读取
 */
export function getDeviceId(): string {
  let id = localStorage.getItem(DEVICE_ID_KEY)
  if (!id) {
    id = uuidv4()
    localStorage.setItem(DEVICE_ID_KEY, id)
    console.log(`[DeviceAuth] Generated new deviceId: ${id}`)
  }
  return id
}

/**
 * 获取服务器 token
 * 优先级：localStorage（设置面板）> 环境变量 VITE_SERVER_TOKEN > null
 */
export function getServerToken(): string | null {
  const stored = localStorage.getItem(SERVER_TOKEN_KEY)
  if (stored) return stored
  const envToken = import.meta.env.VITE_SERVER_TOKEN
  if (envToken) return envToken as string
  return null
}

/**
 * 设置服务器 token（设置面板调用）
 * 传入 null 或空字符串则清除 token
 */
export function setServerToken(token: string | null): void {
  if (token) {
    localStorage.setItem(SERVER_TOKEN_KEY, token)
  } else {
    localStorage.removeItem(SERVER_TOKEN_KEY)
  }
  console.log(`[DeviceAuth] Server token ${token ? 'updated' : 'cleared'}`)
}

/**
 * 获取服务器 API Base URL
 * 从 VITE_API_BASE_URL 环境变量读取，默认 '/api'（通过 Vite proxy 转发）
 */
export function getServerBaseUrl(): string {
  const envBaseUrl = import.meta.env.VITE_API_BASE_URL
  if (envBaseUrl) return envBaseUrl as string
  return '/api'
}
