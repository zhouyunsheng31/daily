import { create } from 'zustand'
import type {
  WebOsAiConfig,
  WebOsApp,
  WebOsBilling,
  WebOsBootstrap,
  WebOsChatMessage,
  WebOsEmailBindingState,
  WebOsGuest,
  WebOsPaymentState,
  WebOsSession,
  WebOsThinkingLevel,
} from '@shared/webos-contracts'
import {
  WebOsApiError,
  createGuestSession,
  deleteApp,
  generateConversationTitle,
  cancelChat,
  getBootstrap,
  getServerConversationMessages,
  getServerConversations,
  installApp,
  logoutSession,
  reorderApps,
  rollbackApp,
  streamChat,
  updateAiConfig,
  type WebOsServerChatMessage,
} from './api'

/**
 * 对话时间线消息：AI 的一个回复回合 = 一条 assistant 消息，
 * 内部按时间顺序分段（文字段 / 工具调用段交替），
 * 工具调用与文字在同一个气泡内连贯展示（不另起新消息/新头像）。
 * tool 分段只存在于前端展示，发送给服务端前会拼回纯文本 content。
 */
export type UiSegment =
  | { type: 'text'; content: string }
  | { type: 'thinking'; content: string }
  | { type: 'tool'; tool: string; done?: boolean; ok?: boolean; /** 2026-08-06 工具开始时间戳（执行中显示已用秒数） */ startedAt?: number; /** 2026-08-07 工具执行过程实时进度文本（tool_update 增量，长工具显示推进情况） */ progress?: string; /** 生图成功时附带的图片 URL 列表（展示在工具下方） */ images?: string[]; /** 2026-08-05 视频生成成功时附带的视频 URL 列表 */ videos?: string[] }
  | { type: 'error'; content: string }
  /** 2026-08-06 等待提示（会话忙排队）：仅前端展示，发送给服务端时被忽略 */
  | { type: 'notice'; content: string }
  | { type: 'html'; html: string; heightPx?: number }

export type UiAssistantMessage = {
  role: 'assistant'
  createdAt?: number
  segments: UiSegment[]
}

export type UiChatMessage = WebOsChatMessage | UiAssistantMessage

/**
 * 多会话（2026-08-05）：一个会话 = 一条独立时间线 + 独立 token 统计。
 * - 服务端按 conversationId 隔离 pi 上下文，不同会话可并行对话互不干扰；
 * - 每个会话记录累计消耗 tokens（done 事件真实用量累加）；
 * - 会话列表、消息、草稿都按身份（guest/user）持久化到 localStorage。
 */
export interface ChatConversation {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  messages: UiChatMessage[]
  /** 本会话累计消耗 token（真实 usage 累加） */
  usedTokens: number
  /** 每会话独立草稿（切换会话不丢失输入） */
  draft?: string
  /** 标题是否自动生成（截取/AI；用户手动重命名后为 false，AI 不再覆盖） */
  titleAuto?: boolean
  /** 是否已尝试过 AI 标题（每会话只尝试一次，失败保留截取标题不重试） */
  titleAiDone?: boolean
}

interface ShellStore {
  booting: boolean
  ready: boolean
  error: string | null
  notice: string | null
  session: WebOsSession | null
  guest: WebOsGuest | null
  ai: WebOsAiConfig | null
  apps: WebOsApp[]
  payment: WebOsPaymentState | null
  /** 计费信息（2026-08-02 积分制）：高峰状态 + 计费目录 */
  billing: WebOsBilling | null
  email: { state: WebOsEmailBindingState; boundEmail: string | null } | null
  /** 系统 Logo（AI 可替换）：工作区 system/logo.svg|png 的 base64；null = 文字标识 */
  logo: { mime: string; base64: string } | null
  /** 用户头像（可替换）：工作区 system/avatar.svg|png；null = 首字母 */
  avatar: { mime: string; base64: string } | null
  /** 定制加载页：工作区 system/boot.html + boot.json（AI 可替换） */
  bootConfig: { html: string | null; durationMs: number }
  activeView: 'assistant' | 'desktop' | 'files' | 'profile' | 'app' | 'store' | 'experience'

  activeAppId: string | null

  // ---- 多会话状态 ----
  conversations: ChatConversation[]
  activeConversationId: string | null
  /** 当前会话的消息视图（= active conversation.messages，保持旧组件兼容） */
  messages: UiChatMessage[]
  /** 每个会话独立的流式控制器：支持多个会话并行生成 */
  streamingConvs: Record<string, AbortController>
  /** 当前会话是否在流式（兼容旧 UI） */
  streaming: boolean
  streamAbort: AbortController | null
  draft: string

  boot: () => Promise<void>
  setView: (view: ShellStore['activeView'], appId?: string) => void
  setNotice: (notice: string | null) => void
  setError: (error: string | null) => void
  setDraft: (draft: string) => void
  setThinking: (thinking: WebOsThinkingLevel) => Promise<void>
  /** 2026-08-06 支持传入内容发送（互动 HTML 回传答案）；缺省用输入框草稿 */
  sendMessage: (content?: string) => Promise<void>
  stopStreaming: () => void
  /** 2026-08-11 SSE 重连（架构统一）：刷新/重开页面/断流后重连任务事件流——
   *  服务端重放任务缓冲 + 实时转发，前端按与在线流相同的路径渲染
   *  （思考/文字/工具/互动 HTML 全覆盖）。返回 'task'|'none'|'error' */
  resumeConversation: (convId?: string) => Promise<'task' | 'none' | 'error'>
  /** 2026-08-22 自动续写：刷新/访问后检测当前会话最后一条消息是否「不完整」
   *  （被中断的截断标记 / 无文字收尾），若有则自动重发续写请求（复用 sendMessage）。
   *  返回 true=已触发续写 ｜ false=无需续写或无法续写 */
  autoContinueIncomplete: () => boolean
  install: (appId: string) => Promise<void>
  rollback: (appId: string, versionId: string) => Promise<void>
  /** 持久化桌面图标顺序（用户 App 的 id 顺序） */
  reorder: (appIds: string[]) => Promise<void>
  /** 删除用户 App（不可恢复，含私有存储） */
  removeApp: (appId: string) => Promise<void>
  /** 退出登录：清 JWT cookie 后重新以游客身份进入 */
  logout: () => Promise<void>
  refreshBootstrap: () => Promise<void>
  /** 2026-08-11：options.skipResume 时不再自动 resume 任务流（refreshBootstrap 用——
   *  否则 app_created → refreshBootstrap → hydrate → resume → 重放 app_created
   *  → …死循环：App 每隔几秒被自动打开一次） */
  hydrate: (bootstrap: WebOsBootstrap, options?: { skipResume?: boolean }) => void
  /** 2026-08-17 会话持久化（换设备/登录）：从服务端拉取历史会话并合并进本地列表
   *  （本地已有会话保留权威缓存，只补服务端独有 id；静默失败不阻塞） */
  syncServerConversations: () => Promise<void>

  // ---- 多会话操作（2026-08-05）----
  createConversation: () => string
  switchConversation: (id: string) => void
  renameConversation: (id: string, title: string) => void
  deleteConversation: (id: string) => void
  /** 复制某条消息的纯文本；返回是否成功（组件内做按钮反馈，不弹全局通知） */
  copyMessageAt: (messageIndex: number) => Promise<boolean>
  /** 编辑用户消息：截断该消息之后的内容并以新内容重新生成（rebuild） */
  editMessageAt: (messageIndex: number, newContent: string) => Promise<void>
  /** 回退重来：删除该消息及之后的内容，重新生成（rebuild） */
  regenerateAt: (messageIndex: number) => Promise<void>
}

const DEVICE_KEY = 'daily-webos-device-id'
// 定制加载页缓存（2026-08-05）：bootstrap 返回的 boot.html 缓存在 localStorage；
// store 初始化时同步读取（首帧渲染 BootScreen 即为自定义页，杜绝"先默认后切换"）。
const BOOT_CACHE_KEY = 'daily-webos-boot-html'
const BOOT_DURATION_CACHE_KEY = 'daily-webos-boot-duration'
// 系统 Logo 缓存（2026-08-04）：bootstrap 返回前 BootScreen 的 LogoMark 需要 logo——
// 否则加载页全程显示默认「D」（bootstrap 返回后加载页通常已结束）。启动首帧先恢复缓存。
const LOGO_CACHE_KEY = 'daily-webos-logo'
// 最后停留的页面（2026-08-05）：按身份持久化，刷新/重开恢复上次所在页面
const VIEW_CACHE_PREFIX = 'daily-webos-view:'

function readCachedBoot(): { html: string; durationMs: number } | null {
  try {
    const html = localStorage.getItem(BOOT_CACHE_KEY)
    if (!html) return null
    return {
      html,
      durationMs: Number(localStorage.getItem(BOOT_DURATION_CACHE_KEY)) || 1200,
    }
  } catch {
    return null
  }
}

/** 读取缓存的系统 Logo（bootstrap 返回前 BootScreen 首帧使用） */
function readCachedLogo(): { mime: string; base64: string } | null {
  try {
    const raw = localStorage.getItem(LOGO_CACHE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as { mime?: unknown; base64?: unknown }
    if (parsed && typeof parsed.mime === 'string' && typeof parsed.base64 === 'string') {
      return { mime: parsed.mime, base64: parsed.base64 }
    }
    return null
  } catch {
    return null
  }
}

function saveLastView(scopeKey: string | null, view: ShellStore['activeView'], appId: string | null): void {
  if (!scopeKey) return
  try {
    localStorage.setItem(`${VIEW_CACHE_PREFIX}${scopeKey}`, JSON.stringify({ view, appId }))
  } catch { /* 忽略 */ }
}

function loadLastView(scopeKey: string | null): { view: ShellStore['activeView']; appId: string | null } | null {
  if (!scopeKey) return null
  try {
    const raw = localStorage.getItem(`${VIEW_CACHE_PREFIX}${scopeKey}`)
    if (!raw) return null
    const parsed = JSON.parse(raw) as { view?: unknown; appId?: unknown }
    if (typeof parsed.view === 'string' && ['assistant', 'desktop', 'files', 'profile', 'app', 'store'].includes(parsed.view)) {
      return {
        view: parsed.view as ShellStore['activeView'],
        appId: typeof parsed.appId === 'string' ? parsed.appId : null,
      }
    }
  } catch { /* 忽略 */ }
  return null
}

// ============================================================================
// 多会话持久化（2026-08-05）
// conversations 按会话身份（guest:<deviceId> / user:<userId>）存 localStorage，
// 刷新后自动恢复；不同用户之间互不串档。旧版单时间线缓存自动迁移为首个会话。
// ============================================================================
const CONV_CACHE_PREFIX = 'daily-webos-conv:'
const CONV_CACHE_MAX_MESSAGES = 200
const CONV_CACHE_MAX_BYTES = 6_000_000
const CHAT_CACHE_PREFIX = 'daily-webos-chat:' // 旧版单时间线缓存（迁移用）

function chatScopeKey(session: WebOsSession | null): string | null {
  if (!session) return null
  if (session.guest) return `guest:${deviceId()}`
  return `user:${session.user.id}`
}

function newConversation(): ChatConversation {
  const now = Date.now()
  return {
    id: `conv-${now}-${Math.random().toString(36).slice(2, 8)}`,
    title: '新会话',
    createdAt: now,
    updatedAt: now,
    messages: [],
    usedTokens: 0,
    draft: '',
    titleAuto: false,
    titleAiDone: false,
  }
}

function saveConversations(scopeKey: string, conversations: ChatConversation[], activeId: string | null): void {
  try {
    const trimmed = conversations.map((conv) => ({
      ...conv,
      messages: conv.messages.slice(-CONV_CACHE_MAX_MESSAGES),
    }))
    let json = JSON.stringify({ conversations: trimmed, activeId })
    // 超长时按会话从旧消息截断，防 localStorage 溢出
    if (json.length > CONV_CACHE_MAX_BYTES) {
      const harder = trimmed.map((conv) => ({ ...conv, messages: conv.messages.slice(-100) }))
      json = JSON.stringify({ conversations: harder, activeId })
    }
    localStorage.setItem(`${CONV_CACHE_PREFIX}${scopeKey}`, json)
  } catch {
    // localStorage 满/不可用等异常：忽略（聊天记录丢失不影响使用）
  }
}

function loadConversations(scopeKey: string): { conversations: ChatConversation[]; activeId: string | null } {
  try {
    const raw = localStorage.getItem(`${CONV_CACHE_PREFIX}${scopeKey}`)
    if (raw) {
      const parsed = JSON.parse(raw) as { conversations?: unknown; activeId?: unknown }
      if (parsed && Array.isArray(parsed.conversations)) {
        let conversations = (parsed.conversations as ChatConversation[]).filter((conv) => conv && typeof conv.id === 'string')
        // 2026-08-17 防脏缓存：历史版本并发 sync 可能写入重复 id，恢复时按 id 去重
        conversations = Array.from(new Map(conversations.map((conv) => [conv.id, conv])).values())
        if (conversations.length > 0) {
              // 2026-08-11 SSE 重连（架构统一）：不再注入「任务仍在后台运行」提示——
    // 刷新恢复由 resumeConversation 无缝渲染任务真实进度到同一气泡；注入
    // notice 会把一个任务拆成「提示气泡 + 恢复气泡」两份（用户反馈）。
    const activeId = typeof parsed.activeId === 'string' && conversations.some((conv) => conv.id === parsed.activeId)
            ? parsed.activeId
            : conversations[0].id
          return { conversations, activeId }
        }
      }
    }
  } catch {
    // 解析失败走迁移
  }
  // 旧版单时间线缓存迁移为「历史对话」会话
  const legacy = loadLegacyChat(scopeKey)
  if (legacy && legacy.length > 0) {
    const conv = newConversation()
    conv.title = '历史对话'
    conv.messages = legacy
    return { conversations: [conv], activeId: conv.id }
  }
  return { conversations: [], activeId: null }
}

function clearConversations(scopeKey: string): void {
  try { localStorage.removeItem(`${CONV_CACHE_PREFIX}${scopeKey}`) } catch { /* 忽略 */ }
  try { localStorage.removeItem(`${CHAT_CACHE_PREFIX}${scopeKey}`) } catch { /* 忽略 */ }
  try { localStorage.removeItem(`${VIEW_CACHE_PREFIX}${scopeKey}`) } catch { /* 忽略 */ }
}

/** 2026-08-17 会话同步防重入锁：hydrate 身份变化 + boot 会都触发 sync——
 *  不加锁时两次并发都基于空初始态拉取，会话 id 会重复进列表 */
let syncServerConversationsInFlight = false

/** 2026-08-17 服务端历史纯文本消息 → 前端时间线消息（assistant 组装成单 text 段气泡） */
function serverMessageToUi(msg: WebOsServerChatMessage): UiChatMessage {
  const createdAt = typeof msg.createdAt === 'number' ? msg.createdAt : Date.now()
  if (msg.role === 'user') return { role: 'user', content: msg.content, createdAt }
  return {
    role: 'assistant',
    createdAt,
    segments: msg.content.trim() ? [{ type: 'text', content: msg.content }] : [],
  }
}

function loadLegacyChat(scopeKey: string): UiChatMessage[] | null {
  try {
    const raw = localStorage.getItem(`${CHAT_CACHE_PREFIX}${scopeKey}`)
    if (!raw) return null
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return null
    return parsed as UiChatMessage[]
  } catch {
    return null
  }
}

function deviceId(): string {
  const existing = localStorage.getItem(DEVICE_KEY)
  if (existing) return existing
  const created = crypto.randomUUID()
  localStorage.setItem(DEVICE_KEY, created)
  return created
}

function mergeApps(next: WebOsApp[]): WebOsApp[] {
  const byId = new Map(next.map((app) => [app.id, app]))
  return [...byId.values()]
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '操作失败，请稍后重试'
}

/** 前端时间线消息 → 服务端会话消息（tool 分段不参与上下文，assistant 拼回纯文本） */
function buildSendMessages(messages: UiChatMessage[]): WebOsChatMessage[] {
  return messages
    .map((message): WebOsChatMessage | null => {
      if (message.role === 'user') return message.content.trim() ? message : null
      const content = 'segments' in message
        ? message.segments.filter((segment) => segment.type === 'text').map((segment) => segment.content).join('')
        : message.content
      return content.trim() ? { role: 'assistant', content } : null
    })
    .filter((message): message is WebOsChatMessage => message !== null)
}

/** 取某条消息的纯文本（复制用） */
function messagePlainText(message: UiChatMessage): string {
  if (message.role === 'user') return message.content
  if ('segments' in message) {
    return message.segments.filter((segment) => segment.type === 'text').map((segment) => segment.content).join('')
  }
  return message.content ?? ''
}

/** 可靠复制：优先 Async Clipboard API，失败/不可用时回退到临时 textarea + execCommand */
export async function copyTextToClipboard(text: string): Promise<boolean> {
  if (!text) return false
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // 继续走 fallback（权限拒绝 / sandbox iframe / 非安全上下文等）
  }
  let textarea: HTMLTextAreaElement | null = null
  try {
    textarea = document.createElement('textarea')
    textarea.value = text
    textarea.setAttribute('readonly', '')
    textarea.style.position = 'fixed'
    textarea.style.top = '0'
    textarea.style.left = '-9999px'
    textarea.style.opacity = '0'
    document.body.appendChild(textarea)
    textarea.focus()
    textarea.select()
    textarea.setSelectionRange(0, text.length)
    return document.execCommand('copy')
  } catch {
    return false
  } finally {
    textarea?.remove()
  }
}

function emptyAssistantMessage(): UiChatMessage {
  // segments 为空数组：MessageBubble 会显示 typing 动画（三个跳动点），
  // 避免发送后 AI 区域一片空白、用户不知道正在生成。
  return { role: 'assistant', segments: [], createdAt: Date.now() }
}

/** 把错误/提示作为一条对话内 assistant 消息追加（替换空的流式占位；不弹全局错误弹窗） */
function appendErrorToConversation(convId: string, message: string): void {
  useShellStore.setState((state) => {
    const conversations = state.conversations.map((conv) => {
      if (conv.id !== convId) return conv
      const messages = [...conv.messages]
      const last = messages[messages.length - 1]
      // 替换还在"正在思考…"的空占位（流已中断）
      if (last && last.role === 'assistant' && 'segments' in last && last.segments.length === 0) {
        const errorSegments: UiSegment[] = [{ type: 'error', content: message }]
        messages[messages.length - 1] = {
          role: 'assistant',
          segments: errorSegments,
          createdAt: last.createdAt ?? Date.now(),
        }
      } else {
        const errorSegments: UiSegment[] = [{ type: 'error', content: message }]
        messages.push({ role: 'assistant', segments: errorSegments, createdAt: Date.now() })
      }
      return { ...conv, messages, updatedAt: Date.now() }
    })
    return {
      conversations,
      messages: state.activeConversationId === convId
        ? conversations.find((conv) => conv.id === convId)?.messages ?? state.messages
        : state.messages,
    }
  })
}

/**
 * 一轮对话的核心执行（多会话并行安全）：
 * - 以指定会话 + 消息列表发起流式请求（conversationId 隔离服务端上下文）；
 * - 事件写回所属会话（即使用户已切到别的会话，后台流式照常累积）；
 * - rebuild 模式（编辑/回退重来）由服务端丢弃旧上下文并重放历史。
 */

// ---- 2026-08-11 SSE 重连（架构统一）：刷新/断流后重连任务事件流，无轮询 ----

/** 2026-08-11 工具进度文本应用：工具参数生成进度为**纯数字**（字符数），
 *  是同一工具段的实时刷新——数字直接替换（渲染为跳动的「↓ N」）；其余
 *  文本进度（生图逐张/批量处理等）正常拼接。 */
function applyToolProgress(prev: string | undefined, content: string): string {
  if (/^\d+$/.test(content) && prev) {
    const lines = prev.split('\n')
    const last = lines[lines.length - 1] ?? ''
    if (/^\d+$/.test(last)) {
      lines[lines.length - 1] = content
      return lines.join('\n').slice(-600)
    }
  }
  const next = (prev ? `${prev}\n` : '') + content
  return next.slice(-600)
}

/** 2026-08-11 抽取：把单个后台任务事件应用到 segments 数组（追加/重建共用）。
 *  与 appendBackgroundEvents 的旧内联逻辑一致：thinking/delta 合并到同类型
 *  尾段，tool_start 追加工具段，tool_update 更新未完成同名工具段的进度，
 *  tool_end 标记工具完成，html 追加互动 HTML 组件段。 */
function applyBgEventToSegments(segments: UiSegment[], ev: { kind: 'thinking' | 'delta' | 'tool_start' | 'tool_update' | 'tool_end' | 'html'; content?: string; tool?: string; ok?: boolean; heightPx?: number }): UiSegment[] {
  if (ev.kind === 'html' && ev.content) {
    return [...segments, { type: 'html', html: ev.content, heightPx: ev.heightPx ?? 280 }]
  }
  if (ev.kind === 'thinking') {
    // 2026-08-11 时间线顺序修复：只合并**连续**的 thinking 段（最后一段是
    // thinking 才合并）；中间插了工具段则新开一段追加——信息流严格按
    // 真实发生顺序排列（思考→工具→思考 各自成段）。工具参数开始生成前
    // 服务端已冲刷挂起思考（pushToolcall → flushDeltaNow），thinking 不会被
    // tool_start 切碎，无需再"跳过工具段合并"（该补丁破坏时间线顺序）。
    const tail = segments[segments.length - 1]
    if (tail && tail.type === 'thinking') {
      return [...segments.slice(0, -1), { type: 'thinking', content: tail.content + (ev.content ?? '') }]
    }
    return [...segments, { type: 'thinking', content: ev.content ?? '' }]
  }
  if (ev.kind === 'delta') {
    // 同上：只合并连续的 text 段，时间线按真实顺序排列
    const tail = segments[segments.length - 1]
    if (tail && tail.type === 'text') {
      return [...segments.slice(0, -1), { type: 'text', content: tail.content + (ev.content ?? '') }]
    }
    return [...segments, { type: 'text', content: ev.content ?? '' }]
  }
  if (ev.kind === 'tool_start') {
    const tail = segments[segments.length - 1]
    // 2026-08-11：参数生成阶段与真实工具执行的两次 tool_start 去重（重建时
    // 缓冲里可能同时有这两条）；真实执行到达时清除「↓ 数字」参数进度
    // （工具段显示工具名 + 执行状态）。
    if (tail && tail.type === 'tool' && tail.tool === ev.tool && !tail.done) {
      if (tail.progress && /^\d+$/.test(tail.progress)) {
        return [...segments.slice(0, -1), { ...tail, progress: undefined }]
      }
      return segments
    }
    return [...segments, { type: 'tool', tool: ev.tool ?? '', done: false, startedAt: Date.now() }]
  }
  if (ev.kind === 'tool_update') {
    if (ev.tool && ev.content) {
      for (let i = segments.length - 1; i >= 0; i -= 1) {
        const segment = segments[i]
        if (segment.type === 'tool' && !segment.done && segment.tool === ev.tool) {
          const updated: UiSegment = { ...segment, progress: applyToolProgress(segment.progress, ev.content) }
          return [...segments.slice(0, i), updated, ...segments.slice(i + 1)]
        }
      }
    }
    return segments
  }
  if (ev.kind === 'tool_end') {
    let index = -1
    for (let i = segments.length - 1; i >= 0; i -= 1) {
      const segment = segments[i]
      if (segment.type === 'tool' && !segment.done) {
        if (segment.tool === ev.tool) { index = i; break }
        if (index === -1) index = i
      }
    }
    if (index >= 0) {
      const target = segments[index]
      if (target && target.type === 'tool') {
        const updated: UiSegment = { ...target, done: true, ok: ev.ok }
        return [...segments.slice(0, index), updated, ...segments.slice(index + 1)]
      }
    }
  }
  return segments
}

/** 把后台任务事件增量追加到会话最后一条 assistant 消息（正常气泡展示） */
function appendBackgroundEvents(convId: string, newEvents: Array<{ kind: 'thinking' | 'delta' | 'tool_start' | 'tool_update' | 'tool_end' | 'html'; content?: string; tool?: string; ok?: boolean; heightPx?: number }>): void {
  if (!newEvents.length) return
  useShellStore.setState((state) => {
    const conv = state.conversations.find((candidate) => candidate.id === convId)
    if (!conv) return {}
    const current = conv.messages
    const last = current[current.length - 1]
    if (!last || last.role !== 'assistant' || !('segments' in last)) return {}
    // 2026-08-06：恢复渲染时同时清除 notice/error 占位（断流错误卡片被真实过程替换）
    let segments: UiSegment[] = [...last.segments].filter((segment) => segment.type !== 'notice' && segment.type !== 'error')
    for (const ev of newEvents) {
      segments = applyBgEventToSegments(segments, ev)
    }
    const nextMessages = [...current.slice(0, -1), { ...last, segments }]
    return {
      conversations: state.conversations.map((candidate) => candidate.id === convId
        ? { ...candidate, messages: nextMessages, updatedAt: Date.now() }
        : candidate),
      messages: state.activeConversationId === convId ? nextMessages : state.messages,
    }
  })
}

/** 2026-08-11 新增：把后台任务缓冲的**完整事件**重建会话最后一条 assistant 的
 *  segments（从空开始应用所有事件，幂等）——SSE 重连（resume）重放时，
 *  先清空旧 segments 再逐条应用，结果与服务端缓冲一致（无论之前渲染了多少）。 */
function rebuildAssistantFromEvents(convId: string, events: Array<{ kind: 'thinking' | 'delta' | 'tool_start' | 'tool_update' | 'tool_end' | 'html'; content?: string; tool?: string; ok?: boolean; heightPx?: number }>): void {
  useShellStore.setState((state) => {
    const conv = state.conversations.find((candidate) => candidate.id === convId)
    if (!conv) return {}
    const current = conv.messages
    const last = current[current.length - 1]
    if (!last || last.role !== 'assistant' || !('segments' in last)) return {}
    let segments: UiSegment[] = []
    for (const ev of events) {
      segments = applyBgEventToSegments(segments, ev)
    }
    const nextMessages = [...current.slice(0, -1), { ...last, segments }]
    return {
      conversations: state.conversations.map((candidate) => candidate.id === convId
        ? { ...candidate, messages: nextMessages, updatedAt: Date.now() }
        : candidate),
      messages: state.activeConversationId === convId ? nextMessages : state.messages,
    }
  })
}

/** 2026-08-11 SSE 事件 → 缓冲事件（resume 重放时统一走 applyBgEventToSegments） */
function chatEventToBgEvent(event: { type: string; content?: string; tool?: string; ok?: boolean; html?: string; heightPx?: number }): { kind: 'thinking' | 'delta' | 'tool_start' | 'tool_update' | 'tool_end' | 'html'; content?: string; tool?: string; ok?: boolean; heightPx?: number } | null {
  switch (event.type) {
    case 'thinking': return { kind: 'thinking', content: event.content }
    case 'delta': return { kind: 'delta', content: event.content }
    case 'tool_start': return { kind: 'tool_start', tool: event.tool }
    case 'tool_update': return { kind: 'tool_update', tool: event.tool, content: event.content }
    case 'tool_end': return { kind: 'tool_end', tool: event.tool, ok: event.ok }
    case 'interactive_html': return { kind: 'html', content: event.html, heightPx: event.heightPx }
    default: return null
  }
}

async function runConversationTurn(
  convId: string,
  sendMessages: WebOsChatMessage[],
  localMessages: UiChatMessage[],
  opts?: { rebuild?: boolean },
): Promise<void> {
  const ai = useShellStore.getState().ai
  if (!ai) return
  if (useShellStore.getState().streamingConvs[convId]) return // 该会话正在生成，忽略重复触发

  const abort = new AbortController()

  // 2026-08-08 结构性优化：高频文本增量（thinking/delta）120ms 窗口合并后批量应用。
  // DeepSeek 长思考产生海量碎片（实测单条消息 2 万+ message_update），若逐事件
  // setState（全量 conversations 复制 + 持久化 + React 渲染），移动端 WebView 会
  // 卡退。合并后事件应用次数降一个数量级；顺序与内容不变（同类型拼接）。
  // 与服务端 SSE 合并（webos.ts pushDelta）互为双保险。
  let pendingText: { kind: 'thinking' | 'delta'; content: string } | null = null
  let textFlushTimer: number | null = null
  const applyTextEvent = (kind: 'thinking' | 'delta', content: string): void => {
    // 服务端/前端合并层用 delta 表示文本增量；UI 段类型为 text
    const segmentType = kind === 'delta' ? 'text' : 'thinking'
    useShellStore.setState((state) => {
      const conv = state.conversations.find((candidate) => candidate.id === convId)
      if (!conv) return {}
      const current = conv.messages
      const last = current[current.length - 1]
      if (!last || last.role !== 'assistant' || !('segments' in last)) return {}
      const segments = [...last.segments].filter((segment) => segment.type !== 'notice')
      // 2026-08-11 时间线顺序修复：只合并**连续**的同类型段（最后一段同类型
      // 才合并）——信息流严格按真实发生顺序排列（思考→工具→文字各自成段）。
      // 工具参数开始生成前服务端已冲刷挂起增量（pushToolcall → flushDeltaNow），
      // 思考/文字不会被 tool_start 从中间切碎，无需"跳过工具段合并"。
      const tail = segments[segments.length - 1]
      if (tail && tail.type === segmentType) {
        segments[segments.length - 1] = { type: segmentType, content: tail.content + content }
      } else {
        segments.push({ type: segmentType, content })
      }
      const nextMessages = [...current.slice(0, -1), { ...last, segments }]
      return {
        conversations: state.conversations.map((candidate) => candidate.id === convId
          ? { ...candidate, messages: nextMessages, updatedAt: Date.now() }
          : candidate),
        messages: state.activeConversationId === convId ? nextMessages : state.messages,
      }
    })
  }
  const flushText = (): void => {
    textFlushTimer = null
    if (!pendingText) return
    const out = pendingText
    pendingText = null
    applyTextEvent(out.kind, out.content)
  }
  const pushTextEvent = (kind: 'thinking' | 'delta', content: string): void => {
    if (pendingText && pendingText.kind === kind) {
      const next = pendingText.content + content
      // 单段上限防御：超 4KB 强制冲刷（避免合并块过大导致渲染卡顿）
      pendingText.content = next.length > 4096 ? content : next
      if (next.length > 4096) flushText()
    } else {
      if (pendingText) flushText()
      pendingText = { kind, content }
    }
    if (!textFlushTimer) {
      textFlushTimer = window.setTimeout(flushText, 120)
    }
  }
  const flushTextNow = (): void => {
    if (textFlushTimer !== null) {
      window.clearTimeout(textFlushTimer)
      textFlushTimer = null
    }
    flushText()
  }
  // 2026-08-11 服务端 409 重复请求拦截回滚用：保存本次发送前的消息快照
  // （乐观添加之前）——收到 CHAT_DUPLICATE_INFLIGHT/RECENT 时恢复它，避免
  // 对话里残留一条「幽灵 user 消息 + 空 assistant 占位」（第一次的回复已在）。
  const prevMessages = useShellStore.getState().conversations.find((candidate) => candidate.id === convId)?.messages ?? localMessages
  // 先更新本地会话消息（乐观更新：立即显示用户消息 + 空 assistant 占位）
  // 同步清空该会话已持久化的 draft，避免刷新/重开后输入框恢复成上一条已发送内容；
  // 只在此消费草稿时清一次，不在流式结束 finally 清，以免误删发送期间新输入的草稿。
  useShellStore.setState((state) => ({
    conversations: state.conversations.map((conv) => conv.id === convId
      ? { ...conv, messages: localMessages, draft: '', updatedAt: Date.now() }
      : conv),
  }))
  // 立即落盘一次，确保清空后的 draft 不会因刷新发生在防抖保存前而仍读到旧值。
  persistNow()
  if (useShellStore.getState().activeConversationId === convId) {
    useShellStore.setState({ messages: localMessages, draft: '', streaming: true, streamAbort: abort, error: null })
  }
  useShellStore.setState({ streamingConvs: { ...useShellStore.getState().streamingConvs, [convId]: abort } })

  // 会话标题：首次发送时自动取第一条用户消息前 20 字（即时反馈；随后立即由
  // AI 智能标题覆盖——不等 AI 回复完成，见下方 generateConversationTitle）
  const firstUser = localMessages.find((message) => message.role === 'user')
  const activeTitle = useShellStore.getState().conversations.find((conv) => conv.id === convId)?.title
  if (firstUser?.role === 'user' && (!activeTitle || activeTitle === '新会话' || activeTitle === '历史对话')) {
    const title = firstUser.content.replace(/\s+/g, ' ').slice(0, 20)
    if (title) {
      useShellStore.setState((state) => ({
        conversations: state.conversations.map((conv) => conv.id === convId ? { ...conv, title, titleAuto: true } : conv),
      }))
      // 2026-08-06 用户要求：第一条消息发出后「立马」生成 AI 标题（不等 AI 回复）。
      // 用首条用户消息即时请求；成功覆盖截取标题并标记已尝试，失败不标记
      // （AI 回复完成后 finally 用完整上下文兜底重试一次）。
      void generateConversationTitle([`用户：${firstUser.content.slice(0, 200)}`]).then((aiTitle) => {
        if (!aiTitle) return
        const convNow = useShellStore.getState().conversations.find((candidate) => candidate.id === convId)
        // 仅在标题仍为自动生成（未被用户手动重命名）时覆盖
        if (convNow && convNow.titleAuto === true) {
          useShellStore.setState((state) => ({
            conversations: state.conversations.map((candidate) => candidate.id === convId
              ? { ...candidate, title: aiTitle, titleAiDone: true }
              : candidate),
          }))
        }
      })
    }
  }

  try {
    // 2026-08-06 network error 兜底：SSE 连接建立前失败（未收到任何事件）
    // 自动重试一次——覆盖服务器重启窗口/瞬时网络抖动；收到事件后失败不重试
    // （可能已开始计费，避免重复扣费/重复生成）。
    let receivedAny = false
    let streamError: unknown = null
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        await streamChat(sendMessages, {
          model: ai.model,
          thinking: ai.thinking,
          conversationId: convId,
          rebuild: opts?.rebuild,
        }, {
          signal: abort.signal,
          onEvent: (event) => {
            receivedAny = true
            // 2026-08-11 结构性优化：thinking/delta 高频增量合并后批量应用
            // （120ms 窗口；与服务端 SSE 合并互为双保险，事件数降一个数量级，
            //  避免移动端 WebView 因 2 万+ 次全量渲染+持久化卡退）
            if (event.type === 'thinking' || event.type === 'delta') {
              pushTextEvent(event.type, event.content)
              return
            }
            // 工具事件：先冲刷挂起的文本增量（保证 thinking→text→tool 顺序），再处理
            if (event.type === 'tool_start' || event.type === 'tool_update' || event.type === 'tool_end') {
              flushTextNow()
              useShellStore.setState((state) => {
                const conv = state.conversations.find((candidate) => candidate.id === convId)
                if (!conv) return {}
                const current = conv.messages
                const last = current[current.length - 1]
                if (!last || last.role !== 'assistant' || !('segments' in last)) return {}
                // 2026-08-06：真实输出到来时清除「等待中」提示段（busy_waiting 置入）
                const segments = [...last.segments].filter((segment) => segment.type !== 'notice')
                if (event.type === 'tool_start') {
                  const tail = segments[segments.length - 1]
                  if (!(tail && tail.type === 'tool' && tail.tool === event.tool && !tail.done)) {
                    segments.push({ type: 'tool', tool: event.tool, done: false, startedAt: Date.now() })
                  } else if (tail && tail.type === 'tool' && tail.progress && /^\d+$/.test(tail.progress)) {
                    // 2026-08-11：参数生成完成、进入真实工具执行——清除「↓ 数字」
                    // 进度，工具段显示工具名 + 执行状态（更自然）
                    segments[segments.length - 1] = { ...tail, progress: undefined }
                  }
                } else if (event.type === 'tool_update') {
                  // 2026-08-07 工具执行过程增量：把进度文本追加到正在执行（未完成）的
                  // 同名工具段上，长工具（生图/批量处理/grep）执行期间实时显示推进情况。
                  const tu = event as { tool?: string; content?: string }
                  if (tu.tool && tu.content) {
                    let index = -1
                    for (let i = segments.length - 1; i >= 0; i -= 1) {
                      const segment = segments[i]
                      if (segment.type === 'tool' && !segment.done && segment.tool === tu.tool) { index = i; break }
                    }
                    const target = index >= 0 ? segments[index] : undefined
                    if (target && target.type === 'tool') {
                      // 2026-08-11：工具参数生成进度（"正在生成参数…N字符"）同格式替换，其余拼接
                      segments[index] = { ...target, progress: applyToolProgress(target.progress, tu.content) }
                    }
                  }
                } else { // tool_end
                  let index = -1
                  for (let i = segments.length - 1; i >= 0; i -= 1) {
                    const segment = segments[i]
                    if (segment.type === 'tool' && !segment.done) {
                      if (segment.tool === event.tool) { index = i; break }
                      if (index === -1) index = i
                    }
                  }
                  const target = index >= 0 ? segments[index] : undefined
                  if (target && target.type === 'tool') {
                    // 生图成功：把图片 URL 存进 tool segment（前端在工具下方展示）
                    const toolEnd = event as { tool?: string; ok?: boolean; images?: string[]; videos?: string[] }
                    segments[index] = {
                      ...target,
                      done: true,
                      ok: event.ok,
                      ...(toolEnd.images && toolEnd.images.length > 0 ? { images: toolEnd.images } : {}),
                      // 2026-08-05 视频生成成功：把视频 URL 存进 tool segment（前端渲染 <video>）
                      ...(toolEnd.videos && toolEnd.videos.length > 0 ? { videos: toolEnd.videos } : {}),
                    }
                  }
                  // 称呼被 AI 保存成功后刷新 bootstrap → 对话页用户名称实时更新
                  if (event.tool === 'set_display_name' && event.ok) {
                    void useShellStore.getState().refreshBootstrap()
                  }
                }
                const nextMessages = [...current.slice(0, -1), { ...last, segments }]
                return {
                  conversations: state.conversations.map((candidate) => candidate.id === convId
                    ? { ...candidate, messages: nextMessages, updatedAt: Date.now() }
                    : candidate),
                  messages: state.activeConversationId === convId ? nextMessages : state.messages,
                }
              })
              return
            }
            // 其他低频事件（busy_waiting / background_progress / error / interactive_html /
            // app_created / app_updated / done）：先冲刷挂起的文本增量保证顺序
            flushTextNow()
        if (event.type === 'busy_waiting') {
          // 2026-08-06：会话忙排队（刷新/断连中断的上一条任务在后台跑）——
          // 在**对话内**置入等待提示（不弹任何卡片，2026-08-11 卡片机制已删）；
          // 后台任务过程经 background_progress 事件实时渲染到同一气泡。
          const waitEvent = event as { message?: string; elapsed?: number }
          const waitMessage = waitEvent.message ?? 'AI 仍在处理上一条消息，正在等待完成…'
          // 消息占位替换为简短等待提示（随后 background_progress 的真实内容会覆盖它）
          useShellStore.setState((state) => {
            const conv = state.conversations.find((candidate) => candidate.id === convId)
            if (!conv) return {}
            const current = conv.messages
            const last = current[current.length - 1]
            if (!last || last.role !== 'assistant' || !('segments' in last)) return {}
            let segments: UiSegment[]
            const noticeIdx = last.segments.findIndex((segment) => segment.type === 'notice')
            if (noticeIdx >= 0) {
              segments = last.segments.map((segment, i) => i === noticeIdx ? { type: 'notice', content: waitMessage } : segment)
            } else {
              segments = [...last.segments, { type: 'notice', content: waitMessage }]
            }
            const nextMessages = [...current.slice(0, -1), { ...last, segments }]
            return {
              conversations: state.conversations.map((candidate) => candidate.id === convId
                ? { ...candidate, messages: nextMessages, updatedAt: Date.now() }
                : candidate),
              messages: state.activeConversationId === convId ? nextMessages : state.messages,
            }
          })
          return
        }
        if (event.type === 'background_progress') {
          // 2026-08-11 修复：后台任务实时过程（思考/工具/输出增量）**渲染到对话
          // 气泡**（与刷新恢复一致的信息流展示），不再显示"上一条消息仍在后台
          // 处理"卡片——用户要求任务进度一律接着信息流继续渲染，无卡片。
          const bp = event as { event?: { kind?: 'thinking' | 'delta' | 'tool_start' | 'tool_update' | 'tool_end'; content?: string; tool?: string; ok?: boolean } }
          const ev = bp.event
          if (!ev || !ev.kind) return
          appendBackgroundEvents(convId, [{ kind: ev.kind, content: ev.content, tool: ev.tool, ok: ev.ok }])
          return
        }
        if (event.type === 'error') {
          // 错误显示在对话内（不弹全局错误弹窗），方便用户复制错误信息反馈
          appendErrorToConversation(convId, event.message)
        } else if (event.type === 'interactive_html') {
          // 对话内互动 HTML：追加为当前 AI 消息的一个 html 分段（sandbox iframe 渲染）
          const htmlEvent = event as { html?: string; heightPx?: number }
          const htmlContent = htmlEvent.html
          if (typeof htmlContent === 'string' && htmlContent) {
            useShellStore.setState((state) => {
              const conv = state.conversations.find((candidate) => candidate.id === convId)
              if (!conv) return {}
              const current = conv.messages
              const last = current[current.length - 1]
              if (!last || last.role !== 'assistant' || !('segments' in last)) return {}
              const segments: UiSegment[] = [...last.segments, { type: 'html', html: htmlContent, heightPx: htmlEvent.heightPx ?? 280 }]
              const nextMessages = [...current.slice(0, -1), { ...last, segments }]
              return {
                conversations: state.conversations.map((candidate) => candidate.id === convId
                  ? { ...candidate, messages: nextMessages, updatedAt: Date.now() }
                  : candidate),
                messages: state.activeConversationId === convId ? nextMessages : state.messages,
              }
            })
          }
          return
        } else if (event.type === 'app_created') {
          // 对话中由 pi 直接创建的 App：刷新列表并自动打开运行页（不弹通知）
          const appId = event.appId
          void useShellStore.getState().refreshBootstrap().then(() => {
            const app = useShellStore.getState().apps.find((candidate) => candidate.id === appId)
            if (app) useShellStore.setState({ activeAppId: app.id, activeView: 'app' })
          })
        } else if (event.type === 'app_updated') {
          void useShellStore.getState().refreshBootstrap()
        } else if (event.type === 'done') {
          // 2026-08-22 部分输出截断提示：服务端 agent_end 异常但保留了可见输出时
          // done.truncated=true，在消息末尾追加提示段（不弹错误、不打断）
          const doneEvent = event as { truncated?: boolean; usage?: unknown }
          if (doneEvent.truncated === true) {
            useShellStore.setState((state) => {
              const conv = state.conversations.find((candidate) => candidate.id === convId)
              if (!conv) return {}
              const current = conv.messages
              const last = current[current.length - 1]
              if (!last || last.role !== 'assistant' || !('segments' in last)) return {}
              const segments: UiSegment[] = [...last.segments, { type: 'error', content: '内容可能被中断，未完整输出。可点击「重新回答」重试。' }]
              const nextMessages = [...current.slice(0, -1), { ...last, segments }]
              return {
                conversations: state.conversations.map((candidate) => candidate.id === convId
                  ? { ...candidate, messages: nextMessages, updatedAt: Date.now() }
                  : candidate),
                messages: state.activeConversationId === convId ? nextMessages : state.messages,
              }
            })
          }
          // 本会话累计 token += 本次真实消耗；同时更新顶部余额 chip（积分制）
          const usage = event.usage
          if (usage) {
            useShellStore.setState((state) => ({
              conversations: state.conversations.map((candidate) => candidate.id === convId
                ? { ...candidate, usedTokens: candidate.usedTokens + usage.totalTokens }
                : candidate),
            }))
            const current = useShellStore.getState()
            const guest = current.guest
            if (guest && typeof usage.usedCredits === 'number') {
              useShellStore.setState({
                guest: {
                  ...guest,
                  credits: {
                    ...guest.credits,
                    quota: guest.credits.quota,
                    used: usage.usedCredits,
                    remaining: Math.max(0, usage.remainingCredits ?? 0),
                    // 2026-08-06 修复：保留 permanent/monthly/totalRemaining（此前覆盖会丢永久池，
                    // 导致对话后余额显示回退到旧值）；totalRemaining 由服务端 done 事件带回来时更新
                    ...(typeof usage.remainingCredits === 'number'
                      ? { totalRemaining: usage.remainingCredits }
                      : {}),
                  },
                },
              })
            }
          }
        }
      },
      })
      // 2026-08-11 消息重复发送根因修复（docs/bug-duplicate-chat-request.md §8）：
      // streamChat 正常返回后必须立即退出重试循环——否则 attempt 递增为 1，
      // 用闭包捕获的同一份 sendMessages 把同一个请求原样重发一次（n=1、无历史、
      // done 后 ~百 ms 到达、双倍扣费）。此前所有"断流自动重试"检查都在 catch
      // 分支，成功路径没有任何跳出语句，导致每一次成功对话都被确定性处理两次。
      break
      } catch (error) {
        // 2026-08-11 服务端重复请求拦截（409）：同一条消息正在处理
        // （CHAT_DUPLICATE_INFLIGHT）或刚完成（CHAT_DUPLICATE_RECENT，5s 窗口）——
        // 第一次的回复已在对话中。撤销本次乐观添加的 user 消息 + 空 assistant
        // 占位（恢复发送前快照），不显示错误卡片；INFLIGHT 再恢复第一次的进度。
        if (error instanceof WebOsApiError && error.status === 409) {
          console.warn(`[chat] ${new Date().toISOString()} duplicate-409 conv=${convId} code=${error.code} msg=${errorMessage(error)} → rollback optimistic (${prevMessages.length} msgs)`)
          useShellStore.setState((state) => ({
            conversations: state.conversations.map((candidate) => candidate.id === convId
              ? { ...candidate, messages: prevMessages, updatedAt: Date.now() }
              : candidate),
            messages: state.activeConversationId === convId ? prevMessages : state.messages,
          }))
          if (error.code === 'CHAT_DUPLICATE_INFLIGHT') {
            void useShellStore.getState().resumeConversation(convId)
          }
          break
        }
        const errMsg = errorMessage(error)
        const nowIso = new Date().toISOString()
        if (attempt === 0 && !abort.signal.aborted && !receivedAny) {
          // 2026-08-10 前端可观测性：断流重试决策全过程日志
          console.warn(`[chat] ${nowIso} stream attempt#0 failed BEFORE any event: msg=${errMsg} conv=${convId} → resume before retry`)
          // 2026-08-11 架构统一：重试前先 SSE 重连（resume）试探服务端是否已收到
          // 第一次请求——服务端有该会话任务（缓冲/in-flight）则重放并接管渲染
          // （不重发消息，避免同一条消息被 pi 处理两次/双倍扣费）；返回 none
          // 说明服务端确实没收到 → 自动重试同一条消息。
          const outcome = await useShellStore.getState().resumeConversation(convId)
          if (outcome === 'task') {
            console.warn(`[chat] ${nowIso} DECISION=resume-took-over (server already processing) conv=${convId}`)
            break
          }
          // 连接建立前失败（network error）且服务端未收到请求：自动重试一次——
          // 覆盖服务器重启窗口 / 瞬时网络抖动
          console.warn(`[chat] ${nowIso} DECISION=retry (server not processing, resume=${outcome}) conv=${convId}`)
          continue
        }
        console.warn(`[chat] ${nowIso} stream failed conv=${convId} attempt=${attempt} receivedAny=${receivedAny} aborted=${abort.signal.aborted} msg=${errMsg}`)
        streamError = error
        break
      }
    }
    if (streamError) throw streamError
  } catch (error) {
    // 2026-08-08：区分「主动停止」（streamingConvs 已删除）与「断流检测 abort」
    // （45s 无数据自动 abort，流式状态仍在）——后者走断流恢复逻辑，前者直接结束。
    const activeStreamStill = Boolean(useShellStore.getState().streamingConvs[convId])
    const nowIsoOuter = new Date().toISOString()
    console.warn(`[chat] ${nowIsoOuter} outer-catch conv=${convId} aborted=${abort.signal.aborted} activeStreamStill=${activeStreamStill} msg=${errorMessage(error)}`)
    if (!abort.signal.aborted || activeStreamStill) {
      const msg = errorMessage(error)
      // 2026-08-06 断流友好化：连接层断开（network error）≠ 任务失败——
      // 服务端后台任务机制会让 prompt 继续跑完；先查后台任务状态，
      // 有运行中任务→提示恢复进度（不显示生硬的 network error）；
      // 确认无任务后才按普通错误显示。
      const isNetworkBreak = error instanceof TypeError
        || /fetch|network|terminated|socket|ECONN|aborted/i.test(msg)
      if (isNetworkBreak) {
        // 2026-08-11 架构统一：断流 ≠ 任务失败——直接 SSE 重连（resume）接管
        // 渲染（服务端有任务则重放缓冲 + 实时转发，无缝接上信息流；无任务
        // 返回 none，按普通错误处理）。不再查询后台任务缓冲（已删除该机制）。
        const outcome = await useShellStore.getState().resumeConversation(convId)
        console.warn(`[chat] ${nowIsoOuter} outer resume outcome=${outcome} conv=${convId}`)
        if (outcome === 'task') return
      }
      // 网络/HTTP 错误显示在对话内（含 402 积分不足等 WebOsApiError 消息）
      if (!abort.signal.aborted) {
        appendErrorToConversation(convId, msg)
      }
    }
  } finally {
    // 2026-08-08：冲刷未应用的合并文本增量（流式结束前保证思考/回复完整落屏）
    flushTextNow()
    // 2026-08-08 结构性优化：流式结束立即落盘（防抖保存的最后保障，刷新不丢消息）
    persistNow()
    const streamingConvs = { ...useShellStore.getState().streamingConvs }
    delete streamingConvs[convId]
    useShellStore.setState({ streamingConvs })
    if (useShellStore.getState().activeConversationId === convId) {
      useShellStore.setState({ streaming: false, streamAbort: null })
    }
    // 空回复兜底：若流结束仍无任何内容且没有 error 事件（网络中断/异常断开），
    // 给用户明确提示而不是停留在“一直加载”的假象（显示在对话内）。
    // 2026-08-08：用户主动按「停止」（abort.signal.aborted=true）不报错——
    // 把空占位替换为「已停止生成」提示，避免误报「连接中断请重发」。
    const conv = useShellStore.getState().conversations.find((candidate) => candidate.id === convId)
    const convMessages = conv?.messages ?? []
    const last = convMessages[convMessages.length - 1]
    // 2026-08-11 修复：空回复判定只看「纯文本」会把只含互动 HTML/工具调用/
    // 思考的回复误判为空（如 show_interactive_html 只输出 HTML 无文字时，
    // 流结束把整条消息替换成"连接中断"错误 → 互动内容显示几秒后消失）。
    // 改为检查是否有**任何内容段**（text/html），无内容才兜底。
    const lastText = last && last.role === 'assistant' ? messagePlainText(last) : ''
    const lastHasAnyContent = Boolean(last && last.role === 'assistant' && (
      'segments' in last
        ? last.segments.some((segment) => segment.type === 'text' || segment.type === 'html')
        : Boolean((last as { content?: string }).content?.trim())
    ))
    if (last?.role === 'assistant' && !lastHasAnyContent) {
      // error 事件已把占位替换为错误消息时不再重复追加
      const hasErrorSegment = 'segments' in last && last.segments.some((segment) => segment.type === 'error')
      if (!hasErrorSegment) {
        if (abort.signal.aborted) {
          // 用户主动按「停止」：把「正在思考…」空占位替换为明确的「已停止」提示
          // （不报错、不提示任务在后台——服务端已 dispose 会话真正终止任务）
          useShellStore.setState((state) => {
            const conversations = state.conversations.map((candidate) => {
              if (candidate.id !== convId) return candidate
              const messages = [...candidate.messages]
              const msgLast = messages[messages.length - 1]
              if (msgLast && msgLast.role === 'assistant' && 'segments' in msgLast && msgLast.segments.length === 0) {
                messages[messages.length - 1] = {
                  role: 'assistant',
                  segments: [{ type: 'notice', content: '已停止生成' }],
                  createdAt: msgLast.createdAt ?? Date.now(),
                }
              }
              return { ...candidate, messages, updatedAt: Date.now() }
            })
            return {
              conversations,
              messages: state.activeConversationId === convId
                ? conversations.find((candidate) => candidate.id === convId)?.messages ?? state.messages
                : state.messages,
            }
          })
        } else {
          appendErrorToConversation(convId, '连接中断，未收到 AI 回复。请重发一次。')
        }
      }
    }

    // AI 智能标题（2026-08-06）：会话首次 AI 回复完成后，用服务端轻量补全
    // （thinking=off）生成 4-15 字中文标题，覆盖截取标题；失败保留截取标题，
    // 每会话只尝试一次（titleAiDone）。用户已手动重命名（titleAuto=false）不覆盖。
    if (conv?.titleAuto === true && !conv.titleAiDone && last?.role === 'assistant' && lastText.trim()) {
      // 立即标记已尝试，避免同会话并发重复请求
      useShellStore.setState((state) => ({
        conversations: state.conversations.map((candidate) => candidate.id === convId
          ? { ...candidate, titleAiDone: true }
          : candidate),
      }))
      // 收集最近消息纯文本（从后往前，最多 8 条、每条 150 字、总长 ≤1600 字）
      const collected: string[] = []
      let total = 0
      for (let i = convMessages.length - 1; i >= 0 && collected.length < 8; i -= 1) {
        const text = messagePlainText(convMessages[i]).trim().slice(0, 150)
        if (!text) continue
        total += text.length + 4
        if (total > 1600) break
        collected.unshift(`${convMessages[i].role === 'user' ? '用户' : 'AI'}：${text}`)
      }
      if (collected.length > 0) {
        void generateConversationTitle(collected).then((title) => {
          if (!title) return
          const convNow = useShellStore.getState().conversations.find((candidate) => candidate.id === convId)
          // 仅在标题仍为自动生成（未被用户重命名）时覆盖
          if (convNow && convNow.titleAuto === true) {
            useShellStore.setState((state) => ({
              conversations: state.conversations.map((candidate) => candidate.id === convId
                ? { ...candidate, title }
                : candidate),
            }))
          }
        })
      }
    }
    void useShellStore.getState().refreshBootstrap()
  }
}

export const useShellStore = create<ShellStore>((set, get) => ({
  booting: false,
  ready: false,
  error: null,
  notice: null,
  session: null,
  guest: null,
  ai: null,
  apps: [],
  payment: null,
  billing: null,
  email: null,
  // 启动首帧先恢复缓存 logo（bootstrap 返回前 BootScreen 显示真实 Logo 而非默认「D」）
  logo: readCachedLogo(),
  avatar: null,
  bootConfig: readCachedBoot() ?? { html: null, durationMs: 1200 },
  activeView: 'assistant',
  activeAppId: null,
  conversations: [],
  activeConversationId: null,
  messages: [],
  streamingConvs: {},
  streaming: false,
  streamAbort: null,
  draft: '',

  hydrate: (bootstrap, options) => {
    const prevSession = get().session
    const nextKey = chatScopeKey(bootstrap.session)
    // 定制加载页：缓存到 localStorage（刷新时先渲染自定义页，不闪默认动画）
    const nextBoot = bootstrap.boot ?? { html: null, durationMs: 1200 }
    try {
      if (nextBoot.html) {
        localStorage.setItem(BOOT_CACHE_KEY, nextBoot.html)
        localStorage.setItem(BOOT_DURATION_CACHE_KEY, String(nextBoot.durationMs))
      } else {
        localStorage.removeItem(BOOT_CACHE_KEY)
        localStorage.removeItem(BOOT_DURATION_CACHE_KEY)
      }
      // 系统 Logo：bootstrap 返回后用服务端最新值刷新缓存（用户换了 Logo 下次刷新即首帧生效；
      // 服务端无 logo（如游客/用户删除了 Logo）则清缓存回到默认「D」）
      if (bootstrap.logo) {
        localStorage.setItem(LOGO_CACHE_KEY, JSON.stringify(bootstrap.logo))
      } else {
        localStorage.removeItem(LOGO_CACHE_KEY)
      }
    } catch { /* localStorage 不可用时忽略 */ }
    set({
      session: bootstrap.session,
      guest: bootstrap.session.guestState,
      ai: bootstrap.ai,
      apps: mergeApps(bootstrap.apps),
      payment: bootstrap.payment,
      billing: bootstrap.billing ?? null,
      email: bootstrap.email,
      logo: bootstrap.logo ?? null,
      avatar: bootstrap.avatar ?? null,
      bootConfig: nextBoot,
      ready: true,
      booting: false,
      error: null,
    })
    // 恢复上次停留的页面（2026-08-05）：刷新/重开/身份恢复时回到之前所在页面。
    // 注意：App 运行页不恢复（2026-08-04 修复：此前恢复导致"一进网页就是上次的
    // App"）——打开网页应回到 AI 主页；应用自己点开，不靠记忆。
    const cachedView = loadLastView(nextKey)
    if (cachedView) {
      if (cachedView.view === 'app') {
        set({ activeView: 'assistant', activeAppId: null })
      } else {
        set({ activeView: cachedView.view, activeAppId: cachedView.appId ?? null })
      }
    }
    // 2026-08-11 SSE 重连（架构统一）：刷新/重开页面/身份切换后，对当前会话
    // 主动重连任务事件流——服务端有运行中（或刚结束）的任务则重放缓冲并实时
    // 转发渲染（思考/文字/工具/互动 HTML 全覆盖），无任务零副作用。
    const resumeTargetId = get().activeConversationId
    // 会话身份变化（登录/注册/登出/首次启动）：恢复该身份的多会话列表；
    // 身份未变（如刷新 bootstrap）时保留当前 conversations 不动
    // 2026-08-11：refreshBootstrap 触发的 hydrate 传 skipResume=true——
    // 打断「app_created → refreshBootstrap → hydrate → resume → 重放 app_created」死循环
    const shouldResume = !options?.skipResume
    if (nextKey !== chatScopeKey(prevSession) && nextKey !== null) {
      // 中断旧身份的流式请求
      for (const abort of Object.values(get().streamingConvs)) {
        try { abort.abort() } catch { /* 忽略 */ }
      }
      const restored = loadConversations(nextKey)
      const active = restored.conversations.find((conv) => conv.id === restored.activeId)
        ?? restored.conversations[0]
        ?? null
      set({
        conversations: restored.conversations,
        activeConversationId: active?.id ?? null,
        messages: active?.messages ?? [],
        draft: active?.draft ?? '',
        streaming: false,
        streamAbort: null,
        streamingConvs: {},
      })
      if (active?.id && shouldResume) {
        void get().resumeConversation(active.id).then(() => {
          // 2026-08-22 自动续写：resume 无任务后检查截断标记，有则自动续写
          get().autoContinueIncomplete()
        })
      }
      // 2026-08-17 会话持久化：身份变化（换设备/登录/注册/登出）时异步拉取服务端历史，
      // 合并进本地列表（localStorage 仍是缓存，服务端是兜底来源；静默失败不阻塞）
      void get().syncServerConversations()
    } else if (resumeTargetId && nextKey !== null && shouldResume) {
      void get().resumeConversation(resumeTargetId).then(() => {
        // 2026-08-22 自动续写：resume 无任务后检查截断标记，有则自动续写
        get().autoContinueIncomplete()
      })
    }
  },

  /** 2026-08-17 会话持久化（换设备/登录）：服务端历史 → 本地会话列表合并。
   *  - 只补服务端独有会话 id（本地已有 id 保留权威缓存：完整 segments + AI 标题，不被纯文本覆盖）
   *  - 拉回的消息组装成 ChatConversation（assistant 单个 text 段气泡），按 updatedAt 倒序合并
   *  - 若当前没有激活会话（新设备首次进入），激活最新拉回的历史会话
   *  - 任何失败静默（本地缓存仍可用，不打断使用） */
  syncServerConversations: async () => {
    const scopeKey = chatScopeKey(get().session)
    if (!scopeKey || syncServerConversationsInFlight) return
    syncServerConversationsInFlight = true
    try {
      const { conversations: metas } = await getServerConversations()
      if (!metas || !Array.isArray(metas) || metas.length === 0) return
      const existingIds = new Set(get().conversations.map((conv) => conv.id))
      const missing = metas.filter((meta) => meta && typeof meta.conversationId === 'string' && !existingIds.has(meta.conversationId))
      if (missing.length === 0) return

      const results = await Promise.all(missing.map(async (meta): Promise<ChatConversation | null> => {
        try {
          const detail = await getServerConversationMessages(meta.conversationId)
          const messages = Array.isArray(detail?.messages) ? detail.messages.map(serverMessageToUi) : []
          if (messages.length === 0) return null
          const updatedAt = typeof meta.updatedAt === 'number' ? meta.updatedAt : Date.now()
          return {
            id: meta.conversationId,
            title: (meta.title && meta.title !== '新会话' ? meta.title : '新会话').slice(0, 40),
            createdAt: updatedAt,
            updatedAt,
            messages,
            usedTokens: 0,
            titleAuto: false,
            titleAiDone: false,
          }
        } catch {
          return null
        }
      }))
      const added = results.filter((conv): conv is ChatConversation => conv !== null)
      if (added.length === 0) return

      // 2026-08-17 防并发重复：合并前按 id 去重（含与既有列表的交叉），再按更新时间倒序
      const seen = new Set(existingIds)
      const merged = [...get().conversations]
      for (const conv of added) {
        if (seen.has(conv.id)) continue
        seen.add(conv.id)
        merged.push(conv)
      }
      merged.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))

      const nextActive = get().activeConversationId ?? added[0].id
      const activeConv = merged.find((conv) => conv.id === nextActive) ?? null
      set({
        conversations: merged,
        activeConversationId: nextActive,
        messages: activeConv?.messages ?? get().messages,
        draft: activeConv?.draft ?? get().draft,
      })
      saveConversations(scopeKey, merged, nextActive)
    } catch {
      // 网络/鉴权异常静默：本地缓存仍可用（历史同步是增强，不是必需）
    } finally {
      syncServerConversationsInFlight = false
    }
  },

  boot: async () => {
    if (get().ready && !get().error) return
    if (get().booting && !get().ready) return
    // 定制加载页（2026-08-05）：先恢复本地缓存（上次 bootstrap 保存的 boot.html），
    // 刷新时立即渲染自定义加载页，不再"先闪默认动画、最后才切到自定义"。
    let cachedBoot: { html: string; durationMs: number } | null = null
    try {
      const cachedHtml = localStorage.getItem(BOOT_CACHE_KEY)
      if (cachedHtml) {
        cachedBoot = {
          html: cachedHtml,
          durationMs: Number(localStorage.getItem(BOOT_DURATION_CACHE_KEY)) || 1200,
        }
      }
    } catch { /* localStorage 不可用时忽略 */ }
    set({ booting: true, error: null, ...(cachedBoot ? { bootConfig: cachedBoot } : {}) })
    try {
      // 2026-08-06 启动重试 3 次（服务端瞬时不可达/重启窗口时避免一进页面就 network error）
      let bootstrap: WebOsBootstrap | null = null
      let lastError: unknown = null
      for (let attempt = 0; attempt < 3 && !bootstrap; attempt += 1) {
        try {
          try {
            bootstrap = await getBootstrap(20_000)
          } catch {
            await createGuestSession(deviceId())
            bootstrap = await getBootstrap(20_000)
          }
        } catch (error) {
          lastError = error
          if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 1500))
        }
      }
      if (!bootstrap) throw lastError ?? new Error('无法连接服务器')
      get().hydrate(bootstrap)
      // 2026-08-17 会话持久化：页面加载完成后再做一次幂等历史同步
      // （覆盖「身份未变刷新」场景——其他设备新会话也能拉回来；只补缺失 id，不覆盖本地）
      void get().syncServerConversations()
      // 2026-08-06 整套系统分享安装：?share=<shareId>&install=<appId|all>
      // 从分享包安装所选应用到桌面，完成后进入桌面视图
      try {
        const params = new URLSearchParams(window.location.search)
        const shareId = params.get('share')
        const installTarget = params.get('install')
        if (shareId && installTarget) {
          const body = installTarget === 'all' ? { all: true } : { appIds: [installTarget] }
          const resp = await fetch(`/webos/api/share/${encodeURIComponent(shareId)}/install`, {
            method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
          })
          const result = await resp.json()
          if (result.ok) {
            await get().refreshBootstrap()
            set({ activeView: 'desktop', activeAppId: null })
            window.history.replaceState(null, '', window.location.pathname + window.location.search.replace(/[?&](share|install)=[^&]*/g, ''))
          }
        }
      } catch { /* 安装失败不阻断启动 */ }
    } catch (error) {
      set({ booting: false, error: errorMessage(error) })
    }
  },

  refreshBootstrap: async () => {
    try {
      const bootstrap = await getBootstrap()
      // 2026-08-11：skipResume——refreshBootstrap 是事件驱动（app_created 等）的
      // 数据刷新，不再触发 resume（否则 app_created → refreshBootstrap → hydrate
      // → resume → 重放 app_created 死循环，App 每隔几秒被自动打开）
      get().hydrate(bootstrap, { skipResume: true })
    } catch (error) {
      set({ error: errorMessage(error) })
    }
  },

  logout: async () => {
    try {
      await logoutSession()
    } catch {
      // 登出失败也继续：清 cookie 不可靠时直接重建游客会话
    }
    // 2026-08-11 SSE 重连（架构统一）：无轮询可清理（resume 连接由 fetch 自行
    // 管理，身份切换时 hydrate 会中断全部流式并重建）
    // 中断所有正在流式的会话
    for (const abort of Object.values(get().streamingConvs)) {
      try { abort.abort() } catch { /* 忽略 */ }
    }
    // 清理当前身份的会话缓存（退出即清除本机会话记录）
    const scopeKey = chatScopeKey(get().session)
    if (scopeKey) clearConversations(scopeKey)
    try {
      await createGuestSession(deviceId())
      const bootstrap = await getBootstrap()
      get().hydrate(bootstrap)
      // 身份变化本身可见（回到游客），不弹底部 toast 挡输入
      set({ conversations: [], activeConversationId: null, messages: [], streamingConvs: {}, streaming: false, streamAbort: null, activeView: 'assistant', activeAppId: null })
    } catch (error) {
      set({ error: errorMessage(error) })
    }
  },

  setView: (activeView, activeAppId) => {
    set({ activeView, activeAppId: activeAppId ?? null, notice: null })
    // 记录最后停留页面（刷新/重开恢复）
    saveLastView(chatScopeKey(get().session), activeView, activeAppId ?? null)
  },
  setNotice: (notice) => set({ notice }),
  setError: (error) => set({ error }),
  setDraft: (draft) => {
    const convId = get().activeConversationId
    set({
      draft,
      conversations: get().conversations.map((conv) => conv.id === convId ? { ...conv, draft } : conv),
    })
  },

  setThinking: async (thinking) => {
    const ai = get().ai
    if (!ai) return
    set({ ai: { ...ai, thinking }, notice: null })
    try {
      const updated = await updateAiConfig({ model: ai.model, thinking })
      set({ ai: { ...ai, ...updated } })
    } catch (error) {
      set({ ai, error: errorMessage(error) })
    }
  },

  // ---- 多会话操作 ----

  createConversation: () => {
    const conv = newConversation()
    set({
      conversations: [conv, ...get().conversations],
      activeConversationId: conv.id,
      messages: [],
      draft: '',
      streaming: false,
      streamAbort: null,
      error: null,
    })
    return conv.id
  },

  switchConversation: (id) => {
    const conv = get().conversations.find((candidate) => candidate.id === id)
    if (!conv) return
    const streaming = Boolean(get().streamingConvs[id])
    set({
      activeConversationId: id,
      messages: conv.messages,
      draft: conv.draft ?? '',
      streaming,
      streamAbort: streaming ? (get().streamingConvs[id] ?? null) : null,
      error: null,
    })
    // 2026-08-11 SSE 重连：切到中断的会话时尝试恢复任务过程（无任务零副作用）
    void get().resumeConversation(id)
  },

  renameConversation: (id, title) => {
    const trimmed = title.trim().slice(0, 30)
    set({
      conversations: get().conversations.map((conv) => conv.id === id ? { ...conv, title: trimmed || '新会话', titleAuto: false } : conv),
    })
  },

  deleteConversation: (id) => {
    const { conversations, activeConversationId } = get()
    // 中断该会话的流式
    get().streamingConvs[id]?.abort()
    const streamingConvs = { ...get().streamingConvs }
    delete streamingConvs[id]
    const remaining = conversations.filter((conv) => conv.id !== id)
    let nextActive = activeConversationId === id ? null : activeConversationId
    if (!nextActive || !remaining.some((conv) => conv.id === nextActive)) {
      nextActive = [...remaining].sort((a, b) => b.updatedAt - a.updatedAt)[0]?.id ?? null
    }
    const active = remaining.find((conv) => conv.id === nextActive) ?? null
    set({
      conversations: remaining,
      activeConversationId: nextActive,
      messages: active?.messages ?? [],
      draft: active?.draft ?? '',
      streamingConvs,
      streaming: Boolean(active && streamingConvs[active.id]),
      streamAbort: active && streamingConvs[active.id] ? streamingConvs[active.id] : null,
    })
  },

  copyMessageAt: async (messageIndex): Promise<boolean> => {
    const conv = get().conversations.find((candidate) => candidate.id === get().activeConversationId)
    const target = conv?.messages[messageIndex]
    if (!target) return false
    const text = messagePlainText(target).trim()
    if (!text) return false
    return copyTextToClipboard(text)
  },

  sendMessage: async (content?: string) => {
    const { draft, ai, activeConversationId, conversations } = get()
    // 2026-08-06 传入内容（互动 HTML 回传答案）优先，否则用输入框草稿
    const text = (typeof content === 'string' && content.trim()) ? content.trim() : draft.trim()
    if (!text || !ai) return
    let conv = conversations.find((candidate) => candidate.id === activeConversationId)
    let convId = activeConversationId
    if (!conv) {
      // 没有会话时自动创建（首次进入/清空后）
      conv = newConversation()
      convId = conv.id
      set({
        conversations: [conv, ...conversations],
        activeConversationId: convId,
        messages: [],
        draft,
      })
    }
    const userMessage: WebOsChatMessage = { role: 'user', content: text, createdAt: Date.now() }
    const nextMessages = buildSendMessages(conv.messages)
    // 系统询问称呼（2026-08-03）：不注入对话 UI（保持主页标语不被自动消息顶掉），
    // 改为在「登录且未设置称呼且本地从未问过且是第一条消息」时，把一条系统引导
    // 消息前置进发送列表 → 真实进入 AI 上下文；AI 看到后会主动询问用户称呼。
    const currentSession = get().session
    // 防御：session.user 在极端情况下可能为 null（如刷新瞬时状态），用双重可选链避免抛错
    const askedKey = `daily-webos-name-asked:${currentSession?.user?.id ?? ''}`
    const shouldAskName = conv.messages.length === 0
      && Boolean(currentSession && !currentSession.guest)
      && !currentSession?.user?.displayNameSet
    if (shouldAskName) {
      let alreadyAsked = false
      try { alreadyAsked = Boolean(localStorage.getItem(askedKey)) } catch { /* 忽略 */ }
      if (!alreadyAsked) {
        nextMessages.unshift({ role: 'assistant', content: '（系统消息）在开始之前，我该怎么称呼你呢？请告诉我你的名字或昵称。' })
        try { localStorage.setItem(askedKey, '1') } catch { /* 忽略 */ }
      }
    }
    nextMessages.push(userMessage)
    const localMessages = [...conv.messages, userMessage, emptyAssistantMessage()]
    if (!convId) return
    // 2026-08-11 入口诊断日志：任何"消息重复发送"问题可直接从 console 定位
    // 触发源（submit / interactive_answer / 残留事件重放）、会话状态与内容指纹
    console.warn(`[chat] ${new Date().toISOString()} sendMessage source=${typeof content === 'string' ? 'content' : 'draft'} conv=${convId} msgs=${conv.messages.length} streaming=[${Object.keys(get().streamingConvs).join(',') || '-'}] text="${text.slice(0, 30).replace(/\s+/g, ' ')}"`)
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    void runConversationTurn(convId, nextMessages, localMessages)
  },

  editMessageAt: async (messageIndex, newContent) => {
    const conv = get().conversations.find((candidate) => candidate.id === get().activeConversationId)
    if (!conv) return
    const target = conv.messages[messageIndex]
    if (!target || target.role !== 'user') return
    const content = newContent.trim()
    if (!content) return
    const truncated = conv.messages.slice(0, messageIndex)
    const sendMessages = buildSendMessages(truncated)
    sendMessages.push({ role: 'user', content, createdAt: Date.now() })
    const localMessages = [
      ...truncated,
      { role: 'user' as const, content, createdAt: Date.now() },
      emptyAssistantMessage(),
    ]
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    void runConversationTurn(conv.id, sendMessages, localMessages, { rebuild: true })
  },

  regenerateAt: async (messageIndex) => {
    const conv = get().conversations.find((candidate) => candidate.id === get().activeConversationId)
    if (!conv) return
    const target = conv.messages[messageIndex]
    if (!target) return
    let resendContent: string | null = null
    let truncated: UiChatMessage[]
    if (target.role === 'user') {
      // 回退到该用户消息重来：删除它及之后，重发它的内容
      resendContent = target.content
      truncated = conv.messages.slice(0, messageIndex)
    } else {
      // AI 消息回退：删除它及之后，重发它之前的最后一条用户消息
      let i = messageIndex - 1
      while (i >= 0) {
        const candidate = conv.messages[i]
        if (candidate && candidate.role === 'user') {
          resendContent = candidate.content
          break
        }
        i -= 1
      }
      if (resendContent === null) return
      truncated = conv.messages.slice(0, i)
    }
    if (!resendContent || !resendContent.trim()) return
    const content = resendContent.trim()
    const sendMessages = buildSendMessages(truncated)
    sendMessages.push({ role: 'user', content, createdAt: Date.now() })
    const localMessages = [
      ...truncated,
      { role: 'user' as const, content, createdAt: Date.now() },
      emptyAssistantMessage(),
    ]
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    void runConversationTurn(conv.id, sendMessages, localMessages, { rebuild: true })
  },

  stopStreaming: () => {
    const convId = get().activeConversationId
    if (!convId) return
    get().streamingConvs[convId]?.abort()
    const streamingConvs = { ...get().streamingConvs }
    delete streamingConvs[convId]
    // 2026-08-11：停止只清流式状态（后台任务卡片机制已整体删除——任务过程
    // 一律渲染到对话信息流；服务端 abort 保留 pi 会话上下文，记忆不丢）
    set({ streamingConvs, streaming: false, streamAbort: null })
    // 2026-08-04：通知服务端 abort 该会话正在跑的 pi prompt（会话上下文保留，
    // AI 立即停下）——否则 prompt 会继续在后台跑，用户下一条消息会撞「会话忙」。
    void cancelChat(convId).catch(() => { /* 取消失败不阻断（后台继续跑完兜底） */ })
  },

  /** 2026-08-11 SSE 重连（架构统一）：刷新/重开页面/断流后重连任务事件流。
   *  服务端有该会话运行中（或刚结束）的任务 → 重放任务缓冲全部事件并实时
   *  转发到本连接；前端按与在线流**完全相同的渲染路径**处理（思考/文字/工具/
   *  互动 HTML 全覆盖），任务结束（done）自动恢复发送状态。前端不再轮询。
   *  @returns 'task' 服务端有任务（已接管渲染）｜'none' 无任务｜'error' 恢复失败
   */
  resumeConversation: async (convId): Promise<'task' | 'none' | 'error'> => {
    const id = convId ?? get().activeConversationId
    if (!id) return 'none'
    const ai = get().ai
    if (!ai) return 'none'
    // 已有流式请求（正在生成）：无需恢复
    if (get().streamingConvs[id]) return 'task'
    const conv = get().conversations.find((candidate) => candidate.id === id)
    if (!conv) return 'none'
    // 最后一条 user 消息内容：服务端据此校验缓冲归属（防止把历史任务重放到当前消息）
    let lastUserText = ''
    for (let i = conv.messages.length - 1; i >= 0; i -= 1) {
      const message = conv.messages[i]
      if (message && message.role === 'user') { lastUserText = message.content; break }
    }
    const abort = new AbortController()
    set((state) => ({ streamingConvs: { ...state.streamingConvs, [id]: abort } }))
    // 注意：不在这里设 streaming=true（输入框「停止」）——服务端无任务时 resume
    // 也先发 start，提前置 streaming 会让每次刷新输入框闪一下「停止」（体验卡顿）。
    // 改为收到第一个**内容事件**（ensureCleared）时才进入流式状态（真在渲染任务）。
    let outcome: 'task' | 'none' | 'error' = 'error'
    let cleared = false
    // 首个内容事件到达时清空旧 segments：服务端从缓冲第一条开始重放，
    // 清空后逐条应用 = 完整重建（无论刷新前渲染了多少，结果与缓冲一致）
    const ensureCleared = (): void => {
      if (cleared) return
      cleared = true
      outcome = 'task' // 真正收到内容事件（任务在跑）才算接管成功
      // 真在渲染任务 → 进入流式状态（输入框显示「停止」）
      if (useShellStore.getState().activeConversationId === id) {
        useShellStore.setState({ streaming: true, streamAbort: abort })
      }
      useShellStore.setState((state) => {
        const convNow = state.conversations.find((candidate) => candidate.id === id)
        if (!convNow) return {}
        const current = convNow.messages
        const last = current[current.length - 1]
        if (!last || last.role !== 'assistant' || !('segments' in last)) return {}
        const nextMessages = [...current.slice(0, -1), { ...last, segments: [] }]
        return {
          conversations: state.conversations.map((candidate) => candidate.id === id
            ? { ...candidate, messages: nextMessages, updatedAt: Date.now() }
            : candidate),
          messages: state.activeConversationId === id ? nextMessages : state.messages,
        }
      })
    }
    try {
      await streamChat([], {
        model: ai.model,
        thinking: ai.thinking,
        conversationId: id,
        resume: true,
        lastUser: lastUserText,
      }, {
        signal: abort.signal,
        onEvent: (event) => {
          if (event.type === 'no_task') { outcome = 'none'; return }
          // 2026-08-11 修复：start 不设 outcome——服务端无任务时也会先发 start，
          // 提前置 task 会让调用方（断流重试决策）误判"服务端有任务"而不重试。
          if (event.type === 'start') return
          if (event.type === 'keep_alive') return
          if (event.type === 'error') { outcome = 'error'; appendErrorToConversation(id, event.message); return }
          if (event.type === 'done') {
            // resume 补发 done（resume:true，任务在 resume 前已结束）不重复累加；
            // 后台跑完的 done 带真实 usage（原在线 done 未收到）→ 累加会话 token
            // + 更新全局余额。
            const usage = event.usage
            if (usage && !event.resume) {
              useShellStore.setState((state) => ({
                conversations: state.conversations.map((candidate) => candidate.id === id
                  ? { ...candidate, usedTokens: candidate.usedTokens + usage.totalTokens }
                  : candidate),
              }))
              const currentState = useShellStore.getState()
              const guest = currentState.guest
              if (guest && typeof usage.usedCredits === 'number') {
                useShellStore.setState({
                  guest: {
                    ...guest,
                    credits: {
                      ...guest.credits,
                      quota: guest.credits.quota,
                      used: usage.usedCredits,
                      remaining: Math.max(0, usage.remainingCredits ?? 0),
                      ...(typeof usage.remainingCredits === 'number'
                        ? { totalRemaining: usage.remainingCredits }
                        : {}),
                    },
                  },
                })
              }
            }
            outcome = outcome === 'none' ? 'none' : 'task'
            return
          }
          // 内容事件（思考/文字/工具/互动 HTML）：与在线流一致的渲染路径
          if (event.type === 'app_created' || event.type === 'app_updated') {
            // 恢复场景（刷新/重连）：只刷新桌面列表让新 App 出现，
            // **不自动打开**——恢复渲染不应打断用户（在线流的 app_created
            // 才自动打开：AI 正在生成时做完即打开看效果）
            void useShellStore.getState().refreshBootstrap()
            return
          }
          ensureCleared()
          const bgEvent = chatEventToBgEvent(event as { type: string; content?: string; tool?: string; ok?: boolean; html?: string; heightPx?: number })
          if (bgEvent) appendBackgroundEvents(id, [bgEvent])
        },
      })
    } catch (error) {
      // 恢复请求本身失败（网络抖动）：静默，下次刷新再试（不显示错误打断用户）
      console.warn(`[chat] ${new Date().toISOString()} resume stream failed conv=${id} msg=${errorMessage(error)}`)
    } finally {
      persistNow()
      const streamingConvs = { ...useShellStore.getState().streamingConvs }
      if (streamingConvs[id] === abort) {
        delete streamingConvs[id]
        useShellStore.setState({ streamingConvs })
      }
      if (useShellStore.getState().activeConversationId === id) {
        useShellStore.setState({ streaming: false, streamAbort: null })
      }
    }
    return outcome
  },

  /** 2026-08-22 自动续写：刷新/访问后检测当前会话最后一条消息是否「不完整」。
   *  触发条件：最后一条 assistant 消息带「内容可能被中断」截断标记（服务端
   *  agent_end 异常但有可见输出时标记，见 webos.ts truncated）。命中后自动
   *  移除提示、发送续写指令让 AI 从断点继续（复用 sendMessage 正常链路）。
   *  防重复：触发后记录续写时间戳（localStorage），5 分钟内不重复续写。 */
  autoContinueIncomplete: () => {
    const id = get().activeConversationId
    if (!id) return false
    // 正在流式/有任务在跑：不打断
    if (get().streamingConvs[id]) return false
    const conv = get().conversations.find((candidate) => candidate.id === id)
    if (!conv || conv.messages.length === 0) return false
    const last = conv.messages[conv.messages.length - 1]
    if (!last || last.role !== 'assistant' || !('segments' in last)) return false
    const segments = last.segments
    if (segments.length === 0) return false
    // 精确匹配截断标记
    const truncatedIdx = segments.findIndex((segment) => segment.type === 'error' && segment.content.includes('内容可能被中断'))
    if (truncatedIdx < 0) return false
    // 防重复：同会话 5 分钟内只续写一次
    const scopeKey = chatScopeKey(get().session)
    const markerKey = `daily-webos-autoregen:${scopeKey ?? 'x'}:${id}`
    let lastAuto = 0
    try { lastAuto = Number(localStorage.getItem(markerKey)) || 0 } catch { /* ignore */ }
    const now = Date.now()
    if (now - lastAuto < 5 * 60_000) return false
    try { localStorage.setItem(markerKey, String(now)) } catch { /* ignore */ }
    // 找到最后一条 user 消息作为续写锚点（提示 AI 别偏题）
    let lastUserText = ''
    for (let i = conv.messages.length - 1; i >= 0; i -= 1) {
      const message = conv.messages[i]
      if (message.role === 'user') { lastUserText = message.content; break }
    }
    // 移除截断提示段（避免残留错误提示），再触发续写
    const cleanSegments = segments.filter((segment) => !(segment.type === 'error' && segment.content.includes('内容可能被中断')))
    useShellStore.setState((state) => {
      const convNow = state.conversations.find((candidate) => candidate.id === id)
      if (!convNow) return {}
      const current = convNow.messages
      const newLast = { ...last, segments: cleanSegments.length > 0 ? cleanSegments : [] }
      const nextMessages = [...current.slice(0, -1), newLast]
      return {
        conversations: state.conversations.map((candidate) => candidate.id === id
          ? { ...candidate, messages: nextMessages, updatedAt: Date.now() }
          : candidate),
        messages: state.activeConversationId === id ? nextMessages : state.messages,
      }
    })
    console.warn(`[chat] ${new Date().toISOString()} auto-continue triggered conv=${id} anchor="${lastUserText.slice(0, 40).replace(/\s+/g, ' ')}"`)
    // 发送续写指令（AI 基于上下文从断点继续，不重复已输出内容）
    const instruction = lastUserText
      ? `（自动续写）你上一次的回答因中断未完整输出。请直接继续完成它（不要重复已输出的内容，从断点接着写）。原始请求：${lastUserText.slice(0, 300)}`
      : '（自动续写）请继续完成你上一次未完整输出的回答，从断点接着写，不要重复已输出的内容。'
    void get().sendMessage(instruction)
    return true
  },

  install: async (appId) => {
    try {
      const result = await installApp(appId)
      set((state) => ({ apps: mergeApps([result.app, ...state.apps]), notice: 'App 已安装到系统桌面' }))
    } catch (error) {
      set({ error: errorMessage(error) })
    }
  },

  rollback: async (appId, versionId) => {
    try {
      const result = await rollbackApp(appId, versionId)
      set((state) => ({ apps: mergeApps([result.app, ...state.apps]), notice: '已切换到选定版本' }))
    } catch (error) {
      set({ error: errorMessage(error) })
    }
  },

  reorder: async (appIds) => {
    const before = get().apps
    try {
      // 先本地重排（builtin 固定在前），失败再回滚
      const builtin = before.filter((app) => app.source === 'builtin')
      const rest = before.filter((app) => app.source !== 'builtin')
      const byId = new Map(rest.map((app) => [app.id, app]))
      const ordered = appIds.map((id) => byId.get(id)).filter((app): app is WebOsApp => Boolean(app))
      if (ordered.length !== rest.length) return
      set({ apps: [...builtin, ...ordered] })
      await reorderApps(appIds)
    } catch (error) {
      set({ apps: before, error: errorMessage(error) })
    }
  },

  removeApp: async (appId) => {
    const before = get().apps
    try {
      await deleteApp(appId)
      set((state) => ({
        apps: state.apps.filter((app) => app.id !== appId),
        notice: '已删除 App',
        ...(state.activeAppId === appId ? { activeView: 'desktop' as const, activeAppId: null } : {}),
      }))
    } catch (error) {
      set({ apps: before, error: errorMessage(error) })
    }
  },
}))

// 多会话自动保存：conversations / activeConversationId 每次变化（含流式增量）都写回
// localStorage（按身份隔离）。流式期间写频较高但单次开销很小，可接受。
// 2026-08-08：顺带持久化「后台事件已消费游标」——刷新后恢复增量渲染的依据。
// 2026-08-08 结构性优化：改为防抖保存（800ms）——流式期间一次对话可能产生
// 2 万+ 次状态变化，若每次 JSON.stringify 整个 conversations 写 localStorage，
// 移动端 WebView 会卡退。防抖后写入次数降到个位数，且流式结束 finally 会立即落盘。
let persistTimer: number | null = null
function schedulePersist(): void {
  if (persistTimer !== null) window.clearTimeout(persistTimer)
  persistTimer = window.setTimeout(() => {
    persistTimer = null
    const state = useShellStore.getState()
    const scopeKey = chatScopeKey(state.session)
    if (scopeKey) {
      saveConversations(scopeKey, state.conversations, state.activeConversationId)
    }
  }, 800)
}
function persistNow(): void {
  if (persistTimer !== null) {
    window.clearTimeout(persistTimer)
    persistTimer = null
  }
  const state = useShellStore.getState()
  const scopeKey = chatScopeKey(state.session)
  if (scopeKey) {
    saveConversations(scopeKey, state.conversations, state.activeConversationId)
  }
}
useShellStore.subscribe((state, prev) => {
  if (state.conversations === prev.conversations && state.activeConversationId === prev.activeConversationId) return
  schedulePersist()
})