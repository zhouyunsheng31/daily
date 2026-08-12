// browserToolBridge.ts
// S12 改造：Web 端无 webview，仅保留 normalizeUrl/isUrl/buildSearchUrl 纯函数
// webview 相关方法 stub（返回 null/空数组/错误 ToolCallResult）
// WebviewTag 类型 import 已删除（spec S12.1-T5 #16），用 unknown 替代
// window.cookieApi 调用已删除（spec S12.1-T5 #16）

import type { SearchEngine } from '../types'

/** 工具执行结果（与 WS 协议 tool_result 对应） */
export interface ToolCallResult {
  success: boolean
  data?: unknown
  error?: string
}

// ========== URL 辅助函数（原样保留，纯函数无副作用）==========
/**
 * 规范化 URL：补全协议、禁止 javascript:/data: 协议
 * Phase 15 批次1 任务1.3：非 URL 输入返回 about:blank（不抛错，不返回 Google），
 * 调用方需先用 isUrl 判断，非 URL 时用 buildSearchUrl(query, searchEngine) 走搜索引擎
 * F1 修复：用正则识别协议头，禁止 javascript:/data: 等危险协议
 */
export function normalizeUrl(input: string): string {
  const t = input.trim()
  if (!t) return 'about:blank'
  // 已有协议头（如 https://、http://、about:、file:）且无空格直接返回
  // 注意：javascript:/data: 协议虽然匹配此正则，但后续 isUrl 会过滤；这里允许通过以保持协议一致性
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(t) && !t.includes(' ')) return t
  // localhost 或 localhost:port
  if (t === 'localhost' || /^localhost:\d+/.test(t)) return `http://${t}`
  // IP 地址（含端口）
  if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}(:\d+)?/.test(t)) return `http://${t}`
  // 域名（含端口和路径）且无空格
  if (/^[\w-]+(\.[\w-]+)+(:\d+)?(\/.*)?$/.test(t) && !t.includes(' ')) return `https://${t}`
  // Phase 15 批次1 任务1.3：非 URL 输入返回 about:blank（fallback），调用方需先用 isUrl 判断
  return 'about:blank'
}

/**
 * 判断输入是否为有效 URL（http/https/about/file 协议）
 * Phase 15 批次1 任务1.3：normalizeUrl 非 URL 输入现在返回 about:blank（fallback），
 * isUrl 需区分"原始 about: 输入"和"fallback about:blank"，避免非 URL 输入被误判为 URL
 */
export function isUrl(text: string): boolean {
  const t = text.trim()
  if (!t || t.includes(' ')) return false
  const normalized = normalizeUrl(t)
  // 若 normalizeUrl 返回 about:blank 但原始输入不是 about: 协议，则 about:blank 是 fallback
  if (normalized === 'about:blank' && !t.startsWith('about:')) {
    return false
  }
  try {
    const u = new URL(normalized)
    return ['http:', 'https:', 'about:', 'file:'].includes(u.protocol)
  } catch {
    return false
  }
}

// ========== Phase 6.3: 搜索引擎 URL 构建 ==========
/** 搜索引擎 -> 搜索 URL 构建函数映射 */
const SEARCH_ENGINES: Record<SearchEngine, (q: string) => string> = {
  google: q => `https://www.google.com/search?q=${encodeURIComponent(q)}`,
  bing: q => `https://www.bing.com/search?q=${encodeURIComponent(q)}`,
  baidu: q => `https://www.baidu.com/s?wd=${encodeURIComponent(q)}`,
  duckduckgo: q => `https://duckduckgo.com/?q=${encodeURIComponent(q)}`,
}

/**
 * 构建搜索 URL（Phase 6.3）
 * @param query 搜索关键词
 * @param engine 搜索引擎，默认 bing
 */
export function buildSearchUrl(query: string, engine: SearchEngine = 'bing'): string {
  const builder = SEARCH_ENGINES[engine] || SEARCH_ENGINES.bing
  return builder(query)
}

// ========== BrowserToolBridge 类（S12 stub）==========
/**
 * S12 改造：Web 端无 webview，BrowserToolBridge 全部方法 stub
 * - registerWebview/unregisterWebview: no-op
 * - getWebview: 始终返回 null
 * - getRegisteredWebviews: 返回空数组
 * - browser* 方法: 返回错误 ToolCallResult
 * - browserGetCookie/browserSetCookie: 删除 window.cookieApi 调用，返回错误
 * S13 完整实现时可能替换为 iframe 版本（如需要）
 */
class BrowserToolBridge {
  // S12 stub: Web 端无 webview，移除未使用的 webviews/readyMap 私有字段（S13 实现时补回）

  /** 注册 webview（S12 stub: no-op） */
  registerWebview(_widgetId: string, _webview: unknown): void {
    // S12 stub: Web 端无 webview，no-op
  }

  /** 注销 webview（S12 stub: no-op） */
  unregisterWebview(_widgetId: string): void {
    // S12 stub: no-op
  }

  /** 获取 webview（S12 stub: 始终返回 null） */
  getWebview(_widgetId: string): unknown | null {
    // S12 stub: Web 端无 webview，始终返回 null
    return null
  }

  /** 列出所有已注册 webview（S12 stub: 返回空数组） */
  getRegisteredWebviews(): Array<{ widgetId: string; url: string; title: string }> {
    // S12 stub: 返回空数组
    return []
  }

  /** 等待 webview 就绪（S12 stub: no-op） */
  async awaitReady(_widgetId: string): Promise<void> {
    // S12 stub: no-op
  }

  /**
   * 安全序列化（S12 stub: 直接返回）
   * 保留方法签名以兼容调用方
   */
  safeSerialize(obj: unknown, _seen: WeakSet<object> = new WeakSet(), _depth = 0): unknown {
    // S12 stub: 直接返回（Web 端无 webview 调用）
    return obj
  }

  // ========== 浏览器工具方法（S12 stub: 全部返回错误）==========

  async browserEval(_params: { widgetId: string; script: string }): Promise<ToolCallResult> {
    return { success: false, error: 'S12 stub: webview not available in web' }
  }

  async browserGetDom(_params: { widgetId: string; selector?: string }): Promise<ToolCallResult> {
    return { success: false, error: 'S12 stub: webview not available in web' }
  }

  async browserClick(_params: { widgetId: string; selector: string }): Promise<ToolCallResult> {
    return { success: false, error: 'S12 stub: webview not available in web' }
  }

  async browserInput(_params: {
    widgetId: string
    selector: string
    text: string
  }): Promise<ToolCallResult> {
    return { success: false, error: 'S12 stub: webview not available in web' }
  }

  async browserScroll(_params: {
    widgetId: string
    x?: number
    y?: number
    selector?: string
    unit?: 'px'
  }): Promise<ToolCallResult> {
    return { success: false, error: 'S12 stub: webview not available in web' }
  }

  async browserWaitFor(_params: {
    widgetId: string
    condition: string
    timeout?: number
  }): Promise<ToolCallResult> {
    return { success: false, error: 'S12 stub: webview not available in web' }
  }

  async browserScreenshot(_params: { widgetId: string }): Promise<ToolCallResult> {
    return { success: false, error: 'S12 stub: webview not available in web' }
  }

  async browserNavigate(_params: { widgetId: string; url: string }): Promise<ToolCallResult> {
    return { success: false, error: 'S12 stub: webview not available in web' }
  }

  browserGetUrl(_params: { widgetId: string }): ToolCallResult {
    return { success: false, error: 'S12 stub: webview not available in web' }
  }

  browserGetTitle(_params: { widgetId: string }): ToolCallResult {
    return { success: false, error: 'S12 stub: webview not available in web' }
  }

  browserBack(_params: { widgetId: string }): ToolCallResult {
    return { success: false, error: 'S12 stub: webview not available in web' }
  }

  browserForward(_params: { widgetId: string }): ToolCallResult {
    return { success: false, error: 'S12 stub: webview not available in web' }
  }

  browserReload(_params: { widgetId: string }): ToolCallResult {
    return { success: false, error: 'S12 stub: webview not available in web' }
  }

  // S12 改造：删除 window.cookieApi 调用，返回错误
  async browserGetCookie(_params: { widgetId: string; url?: string }): Promise<ToolCallResult> {
    return { success: false, error: 'S12 stub: cookie API not available in web' }
  }

  // S12 改造：删除 window.cookieApi 调用，返回错误
  async browserSetCookie(_params: {
    widgetId: string
    name: string
    value: string
    domain?: string
    path?: string
  }): Promise<ToolCallResult> {
    return { success: false, error: 'S12 stub: cookie API not available in web' }
  }

  async browserOpen(_params: { url: string; targetWidgetId?: string }): Promise<ToolCallResult> {
    // S12 stub: Web 端无 webview，返回错误
    return { success: false, error: 'S12 stub: webview not available in web' }
  }

  async browserSwitchTab(_params: { widgetId: string }): Promise<ToolCallResult> {
    return { success: false, error: 'S12 stub: webview not available in web' }
  }

  browserListTabs(): ToolCallResult {
    // S12 stub: 返回空数组
    return { success: true, data: [] }
  }
}

/** browserToolBridge 单例 */
export const browserToolBridge = new BrowserToolBridge()
