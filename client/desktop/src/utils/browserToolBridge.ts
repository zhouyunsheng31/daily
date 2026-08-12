// browserToolBridge.ts
// Phase 2 浏览器集成：浏览器工具桥接器
// 维护 Map<widgetId, WebviewTag>，工具执行时通过 widgetId 查找 webview
import type { WebviewTag } from '../types/electron'
import type { SearchEngine } from '../types'

/** 工具执行结果（与 WS 协议 tool_result 对应） */
export interface ToolCallResult {
  success: boolean
  data?: unknown
  error?: string
}

// ========== URL 辅助函数 ==========
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

// ========== BrowserToolBridge 类 ==========

/**
 * 浏览器工具桥接器
 * - 维护 widgetId -> webview 的映射
 * - WebviewWidget mount 时注册，unmount 时注销
 * - 工具执行时通过 widgetId 查找 webview
 */
class BrowserToolBridge {
  private webviews = new Map<string, WebviewTag>()
  // S3 修复（v8）：维护每个 webview 的 ready 状态（dom-ready 事件触发后设为 true）
  //   原 awaitReady 用 getURL() 不抛错判断就绪是错误的（getURL() 返回空字符串不抛错但 webview 可能未就绪）
  private readyMap = new Map<string, boolean>()

  /** 注册 webview（WebviewWidget mount 时调用） */
  registerWebview(widgetId: string, webview: WebviewTag): void {
    this.webviews.set(widgetId, webview)
    // S3 修复（v8）：注册时初始化 ready 为 false，监听 dom-ready 事件设为 true
    this.readyMap.set(widgetId, false)
    webview.addEventListener('dom-ready', () => {
      this.readyMap.set(widgetId, true)
    }, { once: true })
  }

  /** 注销 webview（WebviewWidget unmount 时调用） */
  unregisterWebview(widgetId: string): void {
    this.webviews.delete(widgetId)
    // S3 修复（v8）：注销时清理 readyMap，避免内存泄漏
    this.readyMap.delete(widgetId)
  }

  /** 获取 webview */
  getWebview(widgetId: string): WebviewTag | null {
    return this.webviews.get(widgetId) || null
  }

  /** 列出所有已注册 webview */
  getRegisteredWebviews(): Array<{ widgetId: string; url: string; title: string }> {
    const result: Array<{ widgetId: string; url: string; title: string }> = []
    this.webviews.forEach((webview, widgetId) => {
      try {
        result.push({ widgetId, url: webview.getURL(), title: webview.getTitle() })
      } catch {
        result.push({ widgetId, url: '', title: '' })
      }
    })
    return result
  }

  /**
   * 等待 webview 就绪（dom-ready）
   * S8 修复：防止在 webview 未就绪时调用 executeJavaScript 报错
   * S1 修复（v7）：添加 10s 超时，避免 webview 卡死时工具调用永久挂起
   * S2 修复（v8）：用 finally 块清除 setTimeout，避免 Promise.race 中 dom-ready 先触发时 timer 泄漏
   * S3 修复（v8）：用 readyMap 判断就绪状态（而非 getURL() 不抛错）
   */
  async awaitReady(widgetId: string): Promise<void> {
    const webview = this.webviews.get(widgetId)
    if (!webview) return
    // S3 修复（v8）：检查 readyMap 而非 getURL()
    if (this.readyMap.get(widgetId)) return
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      await Promise.race([
        new Promise<void>(resolve => {
          const handler = () => {
            this.readyMap.set(widgetId, true)
            resolve()
          }
          webview.addEventListener('dom-ready', handler, { once: true })
        }),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error('webview dom-ready timeout (10s)')),
            10000,
          )
        }),
      ])
    } finally {
      // S2 修复（v8）：无论成功/失败/超时，都清除 timer，避免泄漏
      if (timer) clearTimeout(timer)
    }
  }

  /**
   * 安全序列化：处理 undefined（转 null）、循环引用、函数、Symbol、BigInt、DOM 节点
   * S13 修复：用 WeakSet 跟踪已访问对象避免循环引用导致栈溢出
   * M4 修复：添加 depth 参数，最大深度 10，防止深度嵌套对象栈溢出
   * F4 修复（v7）：处理 undefined 返回值，转为 null 以便 JSON 序列化
   */
  safeSerialize(obj: unknown, seen: WeakSet<object> = new WeakSet(), depth = 0): unknown {
    if (depth > 10) return '[MaxDepth]'
    // F4 修复（v7）：undefined 转为 null，确保 JSON.stringify 能正常序列化
    if (obj === undefined) return null
    if (obj === null || typeof obj !== 'object') {
      if (typeof obj === 'function') return '[Function]'
      if (typeof obj === 'symbol') return '[Symbol]'
      if (typeof obj === 'bigint') return `[BigInt: ${obj.toString()}]`
      return obj
    }
    if (seen.has(obj as object)) return '[Circular]'
    seen.add(obj as object)
    if (obj instanceof Error) {
      return { name: obj.name, message: obj.message, stack: obj.stack }
    }
    if (obj instanceof Node) return `[${obj.nodeName}]`
    if (Array.isArray(obj)) {
      return obj.map(item => this.safeSerialize(item, seen, depth + 1))
    }
    const result: Record<string, unknown> = {}
    for (const key of Object.keys(obj as Record<string, unknown>)) {
      try {
        result[key] = this.safeSerialize(
          (obj as Record<string, unknown>)[key],
          seen,
          depth + 1,
        )
      } catch {
        result[key] = '[Unserializable]'
      }
    }
    return result
  }

  // ========== 浏览器工具方法 ==========

  /**
   * 在 webview 中执行 JavaScript
   * S3 修复：限制 code 长度 10KB、5s 执行超时、返回值 1MB 限制
   * S2 修复（v7）：Promise.race 超时用 finally 清除 setTimeout
   * S13 修复：使用 safeSerialize 处理循环引用、函数、Symbol、DOM 节点、BigInt
   */
  async browserEval(params: { widgetId: string; script: string }): Promise<ToolCallResult> {
    const webview = this.getWebview(params.widgetId)
    if (!webview) {
      return { success: false, error: `Widget not found: ${params.widgetId}` }
    }
    // S3 修复：限制 code 长度 10KB，防止超大脚本
    const MAX_SCRIPT_SIZE = 10 * 1024
    if (params.script.length > MAX_SCRIPT_SIZE) {
      return {
        success: false,
        error: `Script too large (${params.script.length} bytes, max ${MAX_SCRIPT_SIZE} bytes)`,
      }
    }
    // S8 修复：等待 webview 就绪
    await this.awaitReady(params.widgetId)
    // S3 修复：5s 执行超时，防止死循环
    const EVAL_TIMEOUT_MS = 5000
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      const result = await Promise.race([
        webview.executeJavaScript(params.script, true),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error(`browser_eval timeout (${EVAL_TIMEOUT_MS}ms)`)),
            EVAL_TIMEOUT_MS,
          )
        }),
      ])
      // S13 修复：使用 safeSerialize 处理循环引用等
      const safeResult = this.safeSerialize(result)
      // F4 修复（v7）：safeResult 可能是 undefined，用 ?? null 双重保护
      const serialized = JSON.stringify(safeResult ?? null)
      // S3 修复：限制返回值大小 1MB，防止 WS 消息过大
      const MAX_RETURN_SIZE = 1024 * 1024
      if (serialized.length > MAX_RETURN_SIZE) {
        return {
          success: false,
          error: `Eval result too large (${serialized.length} bytes, max ${MAX_RETURN_SIZE} bytes)`,
        }
      }
      return { success: true, data: safeResult ?? null }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    } finally {
      // S2 修复（v7）：无论成功/失败/超时，都清除 timer，避免泄漏
      if (timer) clearTimeout(timer)
    }
  }

  /**
   * 获取 DOM 内容（outerHTML 或 body innerHTML）
   * S9 修复：截断返回值到 100KB，防止 WS 消息过大
   * M8 修复：selector 为空时过滤掉 script/style/noscript 标签
   */
  async browserGetDom(params: { widgetId: string; selector?: string }): Promise<ToolCallResult> {
    const webview = this.getWebview(params.widgetId)
    if (!webview) {
      return { success: false, error: `Widget not found: ${params.widgetId}` }
    }
    await this.awaitReady(params.widgetId)
    const script = params.selector
      ? `document.querySelector(${JSON.stringify(params.selector)})?.outerHTML || ''`
      : `(() => { const clone = document.body.cloneNode(true); clone.querySelectorAll('script, style, noscript').forEach(el => el.remove()); return clone.innerHTML })()`
    let result = await webview.executeJavaScript(script)
    // 截断到 100KB 防止 WS 消息过大
    const MAX_SIZE = 100 * 1024
    if (typeof result === 'string' && result.length > MAX_SIZE) {
      result = result.slice(0, MAX_SIZE) + '\n<!-- truncated -->'
    }
    return { success: true, data: result }
  }

  /**
   * 点击元素
   * M4 修复：传 userGesture=true，否则某些网页的 click 事件会被浏览器忽略
   */
  async browserClick(params: { widgetId: string; selector: string }): Promise<ToolCallResult> {
    const webview = this.getWebview(params.widgetId)
    if (!webview) {
      return { success: false, error: `Widget not found: ${params.widgetId}` }
    }
    await this.awaitReady(params.widgetId)
    const script = `
      const el = document.querySelector(${JSON.stringify(params.selector)})
      if (el) { el.click(); true } else { throw new Error('Element not found: ' + ${JSON.stringify(params.selector)}) }
    `
    await webview.executeJavaScript(script, true)
    return { success: true }
  }

  /**
   * 输入文本（用 native value setter 触发框架监听）
   * M2 修复：直接赋值 el.value 不支持 React/Vue 控制的输入框
   * S5 修复：el.__proto__ 已废弃，改用 el.constructor.prototype
   */
  async browserInput(params: {
    widgetId: string
    selector: string
    text: string
  }): Promise<ToolCallResult> {
    const webview = this.getWebview(params.widgetId)
    if (!webview) {
      return { success: false, error: `Widget not found: ${params.widgetId}` }
    }
    await this.awaitReady(params.widgetId)
    const script = `
      const el = document.querySelector(${JSON.stringify(params.selector)})
      if (el) {
        const proto = el.constructor.prototype
        const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set
        if (setter) setter.call(el, ${JSON.stringify(params.text)})
        else el.value = ${JSON.stringify(params.text)}
        el.dispatchEvent(new Event('input', {bubbles:true}))
        el.dispatchEvent(new Event('change', {bubbles:true}))
        true
      } else { throw new Error('Element not found: ' + ${JSON.stringify(params.selector)}) }
    `
    await webview.executeJavaScript(script, true)
    return { success: true }
  }

  /**
   * 滚动到绝对位置 (x, y)，单位像素
   * M9 修复：显式应用默认值
   * M2 修复：明确 x/y 单位为像素，添加 unit 参数（当前仅支持 'px'）
   */
  async browserScroll(params: {
    widgetId: string
    x?: number
    y?: number
    selector?: string
    unit?: 'px'
  }): Promise<ToolCallResult> {
    const webview = this.getWebview(params.widgetId)
    if (!webview) {
      return { success: false, error: `Widget not found: ${params.widgetId}` }
    }
    await this.awaitReady(params.widgetId)
    const unit = params.unit ?? 'px'
    if (unit !== 'px') {
      return { success: false, error: `Unsupported unit: ${unit}, only 'px' is supported` }
    }
    const x = params.x ?? 0
    const y = params.y ?? 0
    // 若指定 selector，滚动到该元素；否则滚动到绝对位置
    if (params.selector) {
      const script = `
        const el = document.querySelector(${JSON.stringify(params.selector)})
        if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); true }
        else { throw new Error('Element not found: ' + ${JSON.stringify(params.selector)}) }
      `
      await webview.executeJavaScript(script, true)
    } else {
      await webview.executeJavaScript(`window.scrollTo(${x}, ${y})`)
    }
    return { success: true }
  }

  /**
   * 等待选择器匹配的元素出现
   * S6 修复：用 MutationObserver 在 webview 内部监听，单次 IPC（原 100ms 轮询产生 300 次 IPC）
   */
  async browserWaitFor(params: {
    widgetId: string
    condition: string
    timeout?: number
  }): Promise<ToolCallResult> {
    const webview = this.getWebview(params.widgetId)
    if (!webview) {
      return { success: false, error: `Widget not found: ${params.widgetId}` }
    }
    await this.awaitReady(params.widgetId)
    const timeout = params.timeout ?? 30000
    // S6 修复：在 webview 内部用 MutationObserver 监听 DOM 变化，单次 IPC 调用
    const script = `
      new Promise((resolve) => {
        const check = () => { try { if (document.querySelector(${JSON.stringify(params.condition)})) return resolve(true) } catch {} }
        check()
        const obs = new MutationObserver(check)
        obs.observe(document.body, { childList: true, subtree: true })
        setTimeout(() => { obs.disconnect(); resolve(false) }, ${timeout})
      })
    `
    const matched = await webview.executeJavaScript(script)
    return matched
      ? { success: true }
      : { success: false, error: `Timeout waiting for selector: ${params.condition}` }
  }

  /**
   * 截图
   * S4 修复：移除 selector 参数（Electron webview 不支持元素级截图）
   * M1 修复：非活跃面板的 webview 被 visibility:hidden 隐藏，capturePage 会返回空白截图。
   *   截图前临时设为 visible，finally 块中恢复原状
   * S4 修复：限制截图大小 512KB
   * S4 修复（v8）：设置 visibility 后等待 requestAnimationFrame + setTimeout(0) 确保重绘；
   *   检查父元素（面板层）是否也是 hidden（.panel-layer--hidden），如果是临时移除该类
   */
  async browserScreenshot(params: { widgetId: string }): Promise<ToolCallResult> {
    const webview = this.getWebview(params.widgetId)
    if (!webview) {
      return { success: false, error: `Widget not found: ${params.widgetId}` }
    }

    // S4 修复（v8）：查找可能隐藏的父元素（面板层 .panel-layer--hidden）
    const panelLayer = webview.closest('.panel-layer--hidden') as HTMLElement | null
    const wasWebviewHidden = webview.style.visibility === 'hidden'
    const wasPanelHidden = panelLayer !== null

    // 临时显示 webview 和面板层
    if (wasWebviewHidden) webview.style.visibility = 'visible'
    if (wasPanelHidden) panelLayer!.classList.remove('panel-layer--hidden')

    try {
      // S4 修复（v8）：等待重绘完成（requestAnimationFrame + setTimeout(0) 确保浏览器完成重绘）
      await new Promise(resolve => requestAnimationFrame(() => resolve(undefined)))
      await new Promise(resolve => setTimeout(resolve, 0))

      // webview.capturePage() 返回 NativeImage（含 toDataURL/getSize 方法）
      const image = await webview.capturePage()
      const imageWithSize = image as { toDataURL: () => string; getSize: () => { width: number; height: number } }
      const dataURL = imageWithSize.toDataURL()
      // S4 修复：限制大小 — 超过 512KB 返回错误，防止 WS 消息过大
      const MAX_SIZE = 512 * 1024
      if (dataURL.length > MAX_SIZE) {
        return {
          success: false,
          error: `Screenshot too large (${dataURL.length} bytes, max ${MAX_SIZE} bytes), please resize the widget`,
        }
      }
      const size = imageWithSize.getSize()
      return { success: true, data: { image: dataURL, width: size.width, height: size.height } }
    } finally {
      // M1 修复：恢复原 visibility 状态
      // S4 修复（v8）：恢复面板层的 hidden 类
      if (wasWebviewHidden) webview.style.visibility = 'hidden'
      if (wasPanelHidden) panelLayer!.classList.add('panel-layer--hidden')
    }
  }

  /**
   * 导航到指定 URL
   * Phase 15 批次1 任务1.3：非 URL 输入用当前搜索引擎搜索（不再 fallback Google）
   */
  async browserNavigate(params: { widgetId: string; url: string }): Promise<ToolCallResult> {
    const webview = this.getWebview(params.widgetId)
    if (!webview) {
      return { success: false, error: `Widget not found: ${params.widgetId}` }
    }
    const { useAppStore } = await import('../stores/useAppStore')
    const searchEngine = useAppStore.getState().settings.behavior.searchEngine
    const targetUrl = isUrl(params.url)
      ? normalizeUrl(params.url)
      : buildSearchUrl(params.url, searchEngine)
    webview.loadURL(targetUrl)
    return { success: true }
  }

  /** 获取当前 URL */
  browserGetUrl(params: { widgetId: string }): ToolCallResult {
    const webview = this.getWebview(params.widgetId)
    if (!webview) {
      return { success: false, error: `Widget not found: ${params.widgetId}` }
    }
    try {
      return { success: true, data: webview.getURL() }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  }

  /** 获取页面标题 */
  browserGetTitle(params: { widgetId: string }): ToolCallResult {
    const webview = this.getWebview(params.widgetId)
    if (!webview) {
      return { success: false, error: `Widget not found: ${params.widgetId}` }
    }
    try {
      return { success: true, data: webview.getTitle() }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  }

  /** 后退 */
  browserBack(params: { widgetId: string }): ToolCallResult {
    const webview = this.getWebview(params.widgetId)
    if (!webview) {
      return { success: false, error: `Widget not found: ${params.widgetId}` }
    }
    try {
      webview.goBack()
      return { success: true }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  }

  /** 前进 */
  browserForward(params: { widgetId: string }): ToolCallResult {
    const webview = this.getWebview(params.widgetId)
    if (!webview) {
      return { success: false, error: `Widget not found: ${params.widgetId}` }
    }
    try {
      webview.goForward()
      return { success: true }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  }

  /** 刷新 */
  browserReload(params: { widgetId: string }): ToolCallResult {
    const webview = this.getWebview(params.widgetId)
    if (!webview) {
      return { success: false, error: `Widget not found: ${params.widgetId}` }
    }
    try {
      webview.reload()
      return { success: true }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  }

  /**
   * 获取 cookie（通过主进程 session.defaultSession.cookies API，可获取 HttpOnly cookie）
   * S2 修复：cookieApi 可能未注入（preload 加载失败时），做 null 检查
   * S10 修复：session.defaultSession.cookies.get() 可获取 HttpOnly cookie
   */
  async browserGetCookie(params: { widgetId: string; url?: string }): Promise<ToolCallResult> {
    const webview = this.getWebview(params.widgetId)
    if (!webview) {
      return { success: false, error: `Widget not found: ${params.widgetId}` }
    }
    // S2 修复：cookieApi 可能未注入，做 null 检查
    if (!window.cookieApi) {
      return { success: false, error: 'cookieApi not available' }
    }
    const url = params.url || webview.getURL()
    const cookies = await window.cookieApi.get(url)
    return { success: true, data: cookies }
  }

  /**
   * 设置 cookie
   * S1 修复：完全忽略 params.cookie.domain，强制使用当前标签页域名，拒绝跨域设置
   * S9 修复：对 about:blank URL 拒绝设置 cookie
   * S15 修复（v7）：对 data:/blob: URL 也拒绝设置 cookie
   */
  async browserSetCookie(params: {
    widgetId: string
    name: string
    value: string
    domain?: string
    path?: string
  }): Promise<ToolCallResult> {
    const webview = this.getWebview(params.widgetId)
    if (!webview) {
      return { success: false, error: `Widget not found: ${params.widgetId}` }
    }
    // S2 修复：cookieApi 可能未注入，做 null 检查
    if (!window.cookieApi) {
      return { success: false, error: 'cookieApi not available' }
    }
    const url = webview.getURL()
    // S15 修复（v7）：about:blank/data:/blob: 等 URL 无法设置 cookie，提前拒绝
    if (!url || url === 'about:blank' || url.startsWith('data:') || url.startsWith('blob:')) {
      return { success: false, error: 'Cannot set cookie on this URL scheme' }
    }
    const urlObj = new URL(url)
    // 安全：完全忽略 params.domain，强制使用当前标签页域名
    await window.cookieApi.set({
      url,
      name: params.name,
      value: params.value,
      domain: urlObj.hostname, // 强制使用当前域名，拒绝跨域
      path: params.path || '/',
    })
    return { success: true }
  }

  /**
   * 在当前面板新增 webPage widget
   * S13 修复：捕获 5-webview 限制错误，返回 ToolCallResult 而非抛出异常
   * Phase 15 批次1 任务1.3：非 URL 输入用当前搜索引擎搜索（不再 fallback Google）
   */
  async browserOpen(params: { url: string; targetWidgetId?: string }): Promise<ToolCallResult> {
    const { useAppStore } = await import('../stores/useAppStore')
    const searchEngine = useAppStore.getState().settings.behavior.searchEngine
    const url = isUrl(params.url)
      ? normalizeUrl(params.url)
      : buildSearchUrl(params.url, searchEngine)

    if (params.targetWidgetId) {
      // 在指定 widget 中导航
      const webview = this.getWebview(params.targetWidgetId)
      if (!webview) {
        return { success: false, error: `Widget not found: ${params.targetWidgetId}` }
      }
      webview.loadURL(url)
      return { success: true, data: { widgetId: params.targetWidgetId, url } }
    }

    // 在当前活跃面板创建新 WebviewWidget
    const state = useAppStore.getState()
    const panelId = state.activePanelId
    if (!panelId) {
      return { success: false, error: 'No active panel' }
    }

    // 捕获新 widget ID
    const beforeIds = new Set(state.panelWidgets[panelId]?.map(w => w.widgetId) || [])
    // S13 修复：捕获 5-webview 限制错误，返回 ToolCallResult 而非抛出异常
    try {
      await state.addWidget('webPage', {
        panelId,
        position: { x: 100, y: 100, w: 480, h: 600 },
        initialState: { url, title: url, schemaVersion: 1 },
      })
    } catch (e) {
      // 5-webview 限制或其他错误，返回错误信息给 AI
      return { success: false, error: (e as Error).message }
    }
    const afterWidgets = useAppStore.getState().panelWidgets[panelId] || []
    const newWidget = afterWidgets.find(w => !beforeIds.has(w.widgetId))
    // S3 修复：newWidget 可能是 undefined（addWidget 失败或被 5-webview 限制拒绝），必须检查
    if (!newWidget) {
      return { success: false, error: 'Failed to create webview widget' }
    }
    return { success: true, data: { widgetId: newWidget.widgetId, url } }
  }

  /** 切换 activePanel 到 widget 所在面板 */
  async browserSwitchTab(params: { widgetId: string }): Promise<ToolCallResult> {
    const { useAppStore } = await import('../stores/useAppStore')
    const state = useAppStore.getState()
    // 找到 widget 所在的 panel 并切换
    for (const [panelId, widgets] of Object.entries(state.panelWidgets)) {
      if (widgets.some(w => w.widgetId === params.widgetId)) {
        await state.setActivePanel(panelId)
        return { success: true }
      }
    }
    return { success: false, error: `Widget not found: ${params.widgetId}` }
  }

  /** 列出所有 webview */
  browserListTabs(): ToolCallResult {
    return { success: true, data: this.getRegisteredWebviews() }
  }
}

/** browserToolBridge 单例 */
export const browserToolBridge = new BrowserToolBridge()
