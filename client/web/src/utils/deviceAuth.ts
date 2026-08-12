/**
 * DeviceAuth — Phase 3 客户端设备认证工具
 *
 * Per spec section 6.4:
 * - getDeviceId(): 从 localStorage 读取或生成 UUID（用 uuid 包的 v4）
 * - getServerToken(): 从 sessionStorage['daily-jwt'] 读取（S12 JWT），fallback 到 localStorage / 环境变量
 * - setServerToken(token): 设置 token 到 localStorage
 * - getServerBaseUrl(): 从 VITE_API_BASE_URL 环境变量读取，默认 '/api'
 *
 * S13 改造2（spec 改造2）：getServerToken() 优先从 sessionStorage['daily-jwt'] 读取 S12 JWT
 * - S12 在登录成功后把 JWT 存入 sessionStorage['daily-jwt']
 * - 桌面端从 localStorage['daily-server-token'] 读取（设置面板存入）
 * - Web 端优先用 S12 JWT，fallback 到桌面端 localStorage 兼容老用户
 */

import { v4 as uuidv4 } from 'uuid'

const DEVICE_ID_KEY = 'daily-device-id'
const SERVER_TOKEN_KEY = 'daily-server-token'
const SESSION_JWT_KEY = 'daily-jwt'  // S12.3-T10 存入的 JWT key

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
 *
 * S13 改造2（spec 改造2）：优先从 sessionStorage['daily-jwt'] 读取 S12 JWT
 * 优先级：sessionStorage['daily-jwt']（S12 JWT）> localStorage（设置面板）> 环境变量 VITE_SERVER_TOKEN > null
 */
export function getServerToken(): string | null {
  // 优先从 sessionStorage 读取 S12 JWT（web 端登录后存入）
  const sessionJwt = sessionStorage.getItem(SESSION_JWT_KEY)
  if (sessionJwt) return sessionJwt
  // fallback 到 localStorage（设置面板存入）
  const stored = localStorage.getItem(SERVER_TOKEN_KEY)
  if (stored) return stored
  // fallback 到环境变量
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
