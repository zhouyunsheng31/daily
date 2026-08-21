import { getPool } from '../db/connection.js'

// ============================================================================
// Phase 4：AI 设置存储（独立模块，避免循环依赖）
// piBridge.ts 和 routes/aiSettings.ts 都从此模块导入
// ============================================================================

/** AI 设置键名（ai_settings 表的 key 字段） */
export const SETTINGS_KEYS = {
  MODEL: 'model',
  API_KEY: 'api_key',
  ENDPOINT: 'endpoint',
  SYSTEM_PROMPT: 'system_prompt',
  CANVAS_PROMPT: 'canvas_prompt',
  BROWSER_PROMPT: 'browser_prompt',
  SEARCH_KEY_EXA: 'search_key_exa',
  SEARCH_KEY_GITHUB: 'searchKey.github',
} as const

/** 默认提示词（与 piBridge.ts 中的 DEFAULT_*_PROMPT 保持一致） */
export const DEFAULT_PROMPTS = {
  systemPrompt: '',
  canvasPrompt: `你是一个画布助手，运行在 event 画布应用中。你可以通过工具创建 HTML widget 摆放在画布上。

重要约束：
1. 你创建的 HTML 运行在 sandbox="allow-scripts" 的 iframe 里（无 allow-same-origin）
2. 因此 iframe 内部 localStorage / sessionStorage / IndexedDB 全部不可用，访问会抛 SecurityError
3. 持久化数据的唯一方式是调用 window.canvasStorage（已自动注入）：
   - await window.canvasStorage.write(key, value)  // 写入持久化 KV 存储（跨设备同步）
   - await window.canvasStorage.read(key)           // 读取持久化 KV 存储
   - await window.canvasStorage.httpFetch(url, options)  // 代理 HTTP 请求（绕过 CORS）

创建日记、待办、笔记等需要持久化的工具时，必须用 canvasStorage，不要用 localStorage。
初始化时先 await canvasStorage.read(key) 加载历史数据，用户输入后 await canvasStorage.write(key, value) 保存。

创建的 HTML 应该是完整的、美观的、可交互的页面。可以内联 CSS 和 JS。

工具调用失败处理规则：
- 如果某个工具连续失败 2 次以上，不要再重试同一工具，直接告诉用户失败原因并建议下一步
- 工具超时（timeout）通常意味着客户端连接异常，不要继续调用工具，直接告知用户检查连接
- 在没有明确需求时，不要主动调用 list_widgets 探查画布`,
  browserPrompt: `你可以使用浏览器工具（browser_*）来操控用户的网页组件。
- browser_eval: 执行 JavaScript 脚本
- browser_get_dom: 获取页面 DOM
- browser_click: 点击元素
- browser_input: 输入文本
- browser_scroll: 滚动页面
- browser_wait_for: 等待条件
- browser_screenshot: 截图
- browser_navigate: 导航到 URL
- browser_get_url/browser_get_title: 获取当前 URL/标题
- browser_back/browser_forward/browser_reload: 导航控制
- browser_get_cookie/browser_set_cookie: Cookie 操作
- browser_open: 打开新网页
- browser_switch_tab/browser_list_tabs: 标签页管理
注意：所有工具操作的都是用户当前活跃的网页组件。`,
}

// 提示词缓存（避免每次创建 session 都查数据库）
let cachedPrompts: {
  canvas: string
  browser: string
  system: string
} | null = null

/**
 * 获取 AI 设置（含 API Key，供 piBridge 内部使用）
 * 注意：此函数返回的 API Key 不应通过 HTTP 暴露给客户端
 */
export async function getAiSettings(): Promise<{
  model?: string
  apiKey?: string
  endpoint?: string
}> {
  try {
    const pool = getPool()
    const result = await pool.query(
      `SELECT key, value FROM ai_settings WHERE key IN ($1, $2, $3)`,
      [SETTINGS_KEYS.MODEL, SETTINGS_KEYS.API_KEY, SETTINGS_KEYS.ENDPOINT],
    )
    const settings: { model?: string; apiKey?: string; endpoint?: string } = {}
    for (const row of result.rows) {
      if (row.key === SETTINGS_KEYS.MODEL) settings.model = row.value
      else if (row.key === SETTINGS_KEYS.API_KEY) settings.apiKey = row.value
      else if (row.key === SETTINGS_KEYS.ENDPOINT) settings.endpoint = row.value
    }
    return settings
  } catch (err) {
    console.warn('[AiSettings] getAiSettings failed:', err)
    return {}
  }
}

/**
 * 获取提示词覆盖（供 piBridge 内部使用）
 * 优先从缓存读取，缓存未命中时查数据库
 */
export async function getPromptOverrides(): Promise<{
  systemPrompt?: string
  canvasPrompt?: string
  browserPrompt?: string
}> {
  if (cachedPrompts) {
    return {
      systemPrompt: cachedPrompts.system,
      canvasPrompt: cachedPrompts.canvas,
      browserPrompt: cachedPrompts.browser,
    }
  }

  try {
    const pool = getPool()
    const result = await pool.query(
      `SELECT key, value FROM ai_settings WHERE key IN ($1, $2, $3)`,
      [SETTINGS_KEYS.SYSTEM_PROMPT, SETTINGS_KEYS.CANVAS_PROMPT, SETTINGS_KEYS.BROWSER_PROMPT],
    )
    const overrides: { systemPrompt?: string; canvasPrompt?: string; browserPrompt?: string } = {}
    for (const row of result.rows) {
      if (row.key === SETTINGS_KEYS.SYSTEM_PROMPT) overrides.systemPrompt = row.value
      else if (row.key === SETTINGS_KEYS.CANVAS_PROMPT) overrides.canvasPrompt = row.value
      else if (row.key === SETTINGS_KEYS.BROWSER_PROMPT) overrides.browserPrompt = row.value
    }
    // 更新缓存
    cachedPrompts = {
      system: overrides.systemPrompt ?? DEFAULT_PROMPTS.systemPrompt,
      canvas: overrides.canvasPrompt ?? DEFAULT_PROMPTS.canvasPrompt,
      browser: overrides.browserPrompt ?? DEFAULT_PROMPTS.browserPrompt,
    }
    return overrides
  } catch (err) {
    console.warn('[AiSettings] getPromptOverrides failed:', err)
    return {}
  }
}

/**
 * 设置 AI 设置键值（内部辅助）
 */
export async function setSetting(key: string, value: string): Promise<void> {
  const pool = getPool()
  const now = Date.now()
  await pool.query(
    `INSERT INTO ai_settings (key, value, updated_at) VALUES ($1, $2, $3)
     ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = $3`,
    [key, value, now],
  )
}

/**
 * 清除提示词缓存（提示词更新后调用）
 */
export function clearPromptCache(): void {
  cachedPrompts = null
}

// ============================================================================
// Phase S9：搜索引擎 API Key 管理（spec 8.4 节）
// ============================================================================

export type SearchProvider = 'exa' | 'github'

const SEARCH_KEY_MAP: Record<SearchProvider, string> = {
  exa: SETTINGS_KEYS.SEARCH_KEY_EXA,
  github: SETTINGS_KEYS.SEARCH_KEY_GITHUB,
}

/** 读取搜索引擎 API Key（明文），供 piBridge 工具 execute 内调用 */
export async function getSearchKey(provider: SearchProvider): Promise<string | null> {
  // 2026-08-17 Exa key 优先读环境变量（EXA_API_KEY），未配置时回退 DB（设置页存储）
  if (provider === 'exa') {
    const envKey = process.env.EXA_API_KEY
    if (envKey && envKey.trim().length > 0) return envKey.trim()
  }
  const pool = getPool()
  const result = await pool.query('SELECT value FROM ai_settings WHERE key = $1', [SEARCH_KEY_MAP[provider]])
  return result.rows.length > 0 ? result.rows[0].value : null
}

/** 读取搜索引擎 Key 状态（不明文返回 Key） */
export async function getSearchKeyStatus(provider: SearchProvider): Promise<{ hasKey: boolean; updatedAt: number | null }> {
  const pool = getPool()
  const result = await pool.query('SELECT value, updated_at FROM ai_settings WHERE key = $1', [SEARCH_KEY_MAP[provider]])
  if (result.rows.length === 0) return { hasKey: false, updatedAt: null }
  // pg 默认将 BIGINT 返回为 string，强制转为 number（spec 8.4 节要求 updatedAt: number | null）
  const rawUpdatedAt = result.rows[0].updated_at
  const updatedAt = rawUpdatedAt == null ? null : Number(rawUpdatedAt)
  return { hasKey: !!result.rows[0].value, updatedAt }
}

/** 设置搜索引擎 Key */
export async function setSearchKey(provider: SearchProvider, key: string): Promise<number> {
  const now = Date.now()
  await setSetting(SEARCH_KEY_MAP[provider], key)
  return now
}

/** 删除搜索引擎 Key */
export async function deleteSearchKey(provider: SearchProvider): Promise<void> {
  const pool = getPool()
  await pool.query('DELETE FROM ai_settings WHERE key = $1', [SEARCH_KEY_MAP[provider]])
}
