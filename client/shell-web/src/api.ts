import type {
  WebOsAiConfig,
  WebOsApp,
  WebOsBootstrap,
  WebOsChatEvent,
  WebOsChatMessage,
  WebOsEmailAuthResult,
  WebOsEmailBindingResponse,
  WebOsPayOrder,
  WebOsPaymentState,
  WebOsThinkingLevel,
  WebOsWorkspaceListing,
} from '@shared/webos-contracts'

const JSON_HEADERS = { 'Content-Type': 'application/json' }

export class WebOsApiError extends Error {
  readonly status: number
  readonly code: string

  constructor(status: number, code: string, message: string) {
    super(message)
    this.name = 'WebOsApiError'
    this.status = status
    this.code = code
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    credentials: 'include',
    ...init,
    headers: {
      ...(init?.body ? JSON_HEADERS : {}),
      ...init?.headers,
    },
  })
  if (!response.ok) {
    let payload: unknown = null
    try {
      payload = await response.json()
    } catch {
      // Keep the HTTP status when the server returned a non-JSON failure.
    }
    const error = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {}
    const nested = error.error && typeof error.error === 'object' ? error.error as Record<string, unknown> : error
    throw new WebOsApiError(
      response.status,
      typeof nested.code === 'string' ? nested.code : 'WEBOS_REQUEST_FAILED',
      typeof nested.message === 'string' ? nested.message : `请求失败（HTTP ${response.status}）`,
    )
  }
  return response.json() as Promise<T>
}

export async function createGuestSession(deviceId: string): Promise<void> {
  const response = await fetch('/api/auth/guest', {
    method: 'POST',
    credentials: 'include',
    headers: JSON_HEADERS,
    body: JSON.stringify({ deviceId }),
  })
  if (!response.ok) {
    throw new WebOsApiError(response.status, 'GUEST_SESSION_FAILED', '游客会话创建失败')
  }
}

export function getBootstrap(timeoutMs?: number): Promise<WebOsBootstrap> {
  // 2026-08-07 加载页卡死兜底：仅 boot() 首屏传 20s 超时（服务端慢/挂起时不再无限卡
  // 加载页，重试 3 次后显示错误页）；refreshBootstrap/logout 等事件驱动刷新**不传**——
  // 避免 AI 创建 App 后刷新被 abort（"The user aborted a request." 弹错、桌面不更新）。
  const init: RequestInit = timeoutMs ? { signal: AbortSignal.timeout(timeoutMs) } : {}
  return request<WebOsBootstrap>('/webos/api/bootstrap', init)
}

/** 2026-08-06 积分收支明细（个人中心）：对话/生图/视频消耗 + 爱发电充值到账（负数=收入） */
export interface CreditsHistoryItem {
  kind: 'chat' | 'image' | 'video' | 'video_ir' | 'video_edit' | 'recharge_pack' | 'recharge_monthly'
  label: string
  costMinor: number
  status: string
  errorCode: string | null
  detail: string
  createdAt: number
}

export function getCreditsHistory(limit = 30): Promise<{ items: CreditsHistoryItem[] }> {
  return request(`/webos/api/usage/credits-history?limit=${limit}`)
}

/** 2026-08-08 ap- 轻量分享：读取分享包元数据（单个 App 快照） */
export function fetchShareMeta(shareId: string): Promise<{ item: StoreAppItem }> {
  return request(`/webos/api/share/${encodeURIComponent(shareId)}/meta`)
}

export function updateAiConfig(config: {
  model: 'flash'
  thinking: WebOsThinkingLevel
}): Promise<Pick<WebOsAiConfig, 'model' | 'thinking' | 'models'>> {
  return request('/webos/api/ai/config', {
    method: 'PUT',
    body: JSON.stringify(config),
  })
}

export function getApps(): Promise<{ apps: WebOsApp[] }> {
  return request('/webos/api/apps')
}

/** 2026-08-07 bootstrap 瘦身：用户 App 的 HTML 按需拉取（打开 App 时用） */
export function getAppDetail(appId: string): Promise<WebOsApp> {
  return request(`/webos/api/apps/${encodeURIComponent(appId)}`)
}

export function createApp(input: {
  name?: string
  html: string
  source?: 'local_import' | 'ai_generated'
}): Promise<{ app: WebOsApp }> {
  return request('/webos/api/apps', {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export function installApp(appId: string): Promise<{ app: WebOsApp }> {
  return request(`/webos/api/apps/${encodeURIComponent(appId)}/install`, { method: 'POST' })
}

export function rollbackApp(appId: string, versionId: string): Promise<{ app: WebOsApp; rolledBackTo: string }> {
  return request(`/webos/api/apps/${encodeURIComponent(appId)}/rollback`, {
    method: 'POST',
    body: JSON.stringify({ versionId }),
  })
}

export function reorderApps(appIds: string[]): Promise<{ ok: boolean; apps: string[] }> {
  return request('/webos/api/apps/order', {
    method: 'PUT',
    body: JSON.stringify({ appIds }),
  })
}

export function deleteApp(appId: string): Promise<{ ok: boolean }> {
  return request(`/webos/api/apps/${encodeURIComponent(appId)}`, { method: 'DELETE' })
}

export function createAppVersion(appId: string, html: string): Promise<{ app: WebOsApp }> {
  return request(`/webos/api/apps/${encodeURIComponent(appId)}/versions`, {
    method: 'POST',
    // 不传 capabilities → 服务端授予默认全量能力（storage/fs/fs.shared/apps.create）
    body: JSON.stringify({ html }),
  })
}

function appStoragePath(appId: string, key?: string): string {
  const base = `/webos/api/apps/${encodeURIComponent(appId)}/storage`
  return key === undefined ? base : `${base}/${encodeURIComponent(key)}`
}

// ---------------------------------------------------------------------------
// App 文件系统（每个 App 一个文件夹 apps/<appId>/ + 跨 App 共享区 shared/）
// scope: 'app' 私有文件 / 'shared' 共享文件
// ---------------------------------------------------------------------------

function appFilesUrl(appId: string, scope: 'app' | 'shared', pathName: string): string {
  const base = `/webos/api/apps/${encodeURIComponent(appId)}/files`
  return `${base}?scope=${scope}&path=${encodeURIComponent(pathName)}`
}

export function listAppFiles(appId: string, scope: 'app' | 'shared', dir = '.'): Promise<{
  entries: Array<{ name: string; type: 'dir' | 'file'; size: number; modifiedAt: number }>
}> {
  return request(appFilesUrl(appId, scope, dir))
}

export function readAppFile(appId: string, scope: 'app' | 'shared', pathName: string): Promise<{ content: string; size: number }> {
  const base = `/webos/api/apps/${encodeURIComponent(appId)}/files/content`
  return request(`${base}?scope=${scope}&path=${encodeURIComponent(pathName)}`)
}

export function writeAppFile(appId: string, scope: 'app' | 'shared', pathName: string, content: string): Promise<{ ok: boolean; bytes: number }> {
  return request(appFilesUrl(appId, scope, pathName), {
    method: 'PUT',
    body: JSON.stringify({ content }),
  })
}

export function mkdirAppFile(appId: string, scope: 'app' | 'shared', pathName: string): Promise<{ ok: boolean }> {
  return request(appFilesUrl(appId, scope, pathName), { method: 'POST' })
}

export function deleteAppFile(appId: string, scope: 'app' | 'shared', pathName: string): Promise<{ ok: boolean }> {
  return request(appFilesUrl(appId, scope, pathName), { method: 'DELETE' })
}

export function getAppStorage(appId: string): Promise<{ items: Record<string, unknown> }> {
  return request(appStoragePath(appId))
}

export async function getAppStorageValue(appId: string, key: string): Promise<unknown | null> {
  try {
    const result = await request<{ key: string; value: unknown }>(appStoragePath(appId, key))
    return result.value ?? null
  } catch (error) {
    if (error instanceof WebOsApiError && error.code === 'APP_STORAGE_KEY_NOT_FOUND') return null
    throw error
  }
}

export async function setAppStorageValue(appId: string, key: string, value: unknown): Promise<void> {
  await request(appStoragePath(appId, key), {
    method: 'PUT',
    body: JSON.stringify({ value }),
  })
}

export async function deleteAppStorageValue(appId: string, key: string): Promise<void> {
  await request(appStoragePath(appId, key), { method: 'DELETE' })
}

export function sendEmailCode(email: string): Promise<WebOsEmailBindingResponse> {
  return request('/webos/api/email/send-code', {
    method: 'POST',
    body: JSON.stringify({ email }),
  })
}

export function verifyEmail(email: string, code: string): Promise<WebOsEmailBindingResponse> {
  return request('/webos/api/email/verify', {
    method: 'POST',
    body: JSON.stringify({ email, code }),
  })
}

// ---------------------------------------------------------------------------
// 邮箱账号系统（2026-08-02，免鉴权端点 /api/auth/email/*）
// 注册用验证码验证邮箱；登录用密码（无需验证码）；忘记密码可用验证码重置
// ---------------------------------------------------------------------------

/** 发送注册/重置密码验证码 */
export function sendAuthEmailCode(email: string): Promise<{ message: string; cooldownSeconds: number }> {
  return request('/api/auth/email/send-code', {
    method: 'POST',
    body: JSON.stringify({ email }),
  })
}

/** 签发反人机算术题（发送验证码前必须先通过） */
export function getEmailPuzzle(): Promise<{ puzzleId: string; question: string; expiresAt: number }> {
  return request('/api/auth/email/puzzle', { method: 'POST' })
}

/** 携带人机验证答案发送验证码 */
export function sendAuthEmailCodeWithPuzzle(email: string, puzzleId: string, answer: number): Promise<{ message: string; cooldownSeconds: number }> {
  return request('/api/auth/email/send-code', {
    method: 'POST',
    body: JSON.stringify({ email, puzzleId, answer }),
  })
}

/** 修改用户称呼（显示名，登录态） */
export function updateDisplayName(displayName: string): Promise<{ ok: boolean; displayName: string; message: string }> {
  return request('/api/auth/email/profile', {
    method: 'POST',
    body: JSON.stringify({ displayName }),
  })
}

/** 注册：验证码验证邮箱 + 设置密码 + 创建账号 + 自动登录（游客资产自动迁移） */
export function registerWithEmail(email: string, password: string, code: string): Promise<WebOsEmailAuthResult> {
  return request('/api/auth/email/register', {
    method: 'POST',
    body: JSON.stringify({ email, password, code }),
  })
}

/** 密码登录（无需验证码；游客身份时自动迁移资产） */
export function loginWithEmail(email: string, password: string): Promise<WebOsEmailAuthResult> {
  return request('/api/auth/email/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  })
}

/** 忘记密码：验证码验证邮箱后重置密码并登录 */
export function resetPassword(email: string, password: string, code: string): Promise<WebOsEmailAuthResult> {
  return request('/api/auth/email/reset-password', {
    method: 'POST',
    body: JSON.stringify({ email, password, code }),
  })
}

/** 退出登录（清 cookie） */
export function logoutSession(): Promise<{ authenticated: false }> {
  return request('/api/auth/logout', { method: 'POST' })
}

/** 已登录用户修改密码（验证旧密码；无需验证码） */
export function changePassword(oldPassword: string, newPassword: string): Promise<{ ok: boolean; message: string }> {
  return request('/api/auth/email/change-password', {
    method: 'POST',
    body: JSON.stringify({ oldPassword, newPassword }),
  })
}

// ---------------------------------------------------------------------------
// 用户文件工作区（2026-08-02）
// 用户可见区 = 工作区 home/（per-user 隔离；AI 通过 agent_fs_* 读写同一空间）
// ---------------------------------------------------------------------------

/** 列出用户可见区目录 */
export function listWorkspaceFiles(dir = ''): Promise<WebOsWorkspaceListing> {
  const query = dir ? `?path=${encodeURIComponent(dir)}` : ''
  return request(`/webos/api/workspace/files${query}`)
}

/** 上传文件到用户可见区（默认 home/uploads/；body 传 base64） */
export function uploadWorkspaceFile(fileName: string, contentBase64: string, dir?: string): Promise<{ ok: boolean; file: { name: string; size: number } }> {
  return request('/webos/api/workspace/files', {
    method: 'POST',
    body: JSON.stringify({ fileName, contentBase64, dir }),
  })
}

// ---------------------------------------------------------------------------
// 2026-08-13 大文件分片上传（顺序 append + 断点续传）
// 单请求 body 上限 600MB（base64 后 ≈450MB 原文件），更大文件切 ~8MB 片逐片上传：
// 每片独立请求（不超时、内存恒定），服务端边收边写；同文件未完成自动续传（重试即续）。
// ---------------------------------------------------------------------------

/** 大文件分片上传（>20MB 用；自动 init → 顺序 part → complete；失败重试当前片） */
export async function uploadWorkspaceFileLarge(
  fileName: string,
  file: Blob,
  dir = 'uploads',
  onProgress?: (ratio: number) => void,
): Promise<{ ok: boolean; file: { name: string; size: number } }> {
  const CHUNK_BYTES = 8 * 1024 * 1024 // 8MB/片（base64 ~10.7MB，远低于 600MB body 上限）
  const totalBytes = file.size
  const initPayload = await request<{ ok: boolean; uploadId: string; partsCount: number; totalBytes: number; resumed: boolean }>('/webos/api/workspace/files/upload', {
    method: 'POST',
    body: JSON.stringify({ action: 'init', fileName, dir, size: totalBytes }),
  })
  const { uploadId } = initPayload
  // 断点续传：服务端返回已收片数，从该片继续
  let partIndex = initPayload.partsCount
  let sentBytes = partIndex * CHUNK_BYTES
  try {
    while (sentBytes < totalBytes) {
      const end = Math.min(sentBytes + CHUNK_BYTES, totalBytes)
      const base64 = await blobToBase64(file.slice(sentBytes, end))
      // 当前片失败重试 3 次（退避 1s/2s/4s）；断网重连后重试即续传（服务端会话仍在）
      let lastError: unknown = null
      let okPart = false
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          await request('/webos/api/workspace/files/upload', {
            method: 'POST',
            body: JSON.stringify({ action: 'part', uploadId, index: partIndex, data: base64 }),
          })
          okPart = true
          break
        } catch (caught) {
          lastError = caught
          if (attempt < 2) await new Promise((resolve) => window.setTimeout(resolve, 1000 * (attempt + 1)))
        }
      }
      if (!okPart) throw lastError
      partIndex += 1
      sentBytes = end
      onProgress?.(end / totalBytes)
    }
    return await request('/webos/api/workspace/files/upload', {
      method: 'POST',
      body: JSON.stringify({ action: 'complete', uploadId }),
    })
  } catch (caught) {
    // 失败放弃会话（下次重传自动续传新会话；已传分片由服务端清理）
    try {
      await request('/webos/api/workspace/files/upload', {
        method: 'POST',
        body: JSON.stringify({ action: 'abort', uploadId }),
      })
    } catch { /* 忽略 */ }
    throw caught
  }
}

/** 删除用户可见区文件/空目录 */
export function deleteWorkspaceFile(pathName: string): Promise<{ ok: boolean }> {
  return request(`/webos/api/workspace/files?path=${encodeURIComponent(pathName)}`, { method: 'DELETE' })
}

/** 用户可见区文件 raw URL（图片预览/下载用；仅 home/ 内） */
export function workspaceFileRawUrl(pathName: string): string {
  return `/webos/api/workspace/files/raw?path=${encodeURIComponent(pathName)}`
}

/** 系统 Logo（bootstrap 已带；刷新用） */
export function getLogo(): Promise<{ present: boolean; logo: { mime: string; base64: string } | null }> {
  return request('/webos/api/logo')
}

/** 上传用户头像（仅登录；png/jpg/svg/webp，≤2MB） */
export function uploadAvatar(contentBase64: string, ext: string): Promise<{ ok: boolean; avatar: { mime: string; base64: string } }> {
  return request('/webos/api/avatar', {
    method: 'POST',
    body: JSON.stringify({ contentBase64, ext }),
  })
}

/** 读取用户可见区文本文件内容 */
export async function readWorkspaceTextFile(pathName: string): Promise<string> {
  const response = await fetch(workspaceFileRawUrl(pathName), { credentials: 'include' })
  if (!response.ok) throw new WebOsApiError(response.status, 'WORKSPACE_FILE_READ_FAILED', '文件读取失败')
  return response.text()
}

export async function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : ''
      const comma = result.indexOf(',')
      resolve(comma >= 0 ? result.slice(comma + 1) : result)
    }
    reader.onerror = () => reject(reader.error ?? new Error('文件读取失败'))
    reader.readAsDataURL(blob)
  })
}

export function getPaymentState(): Promise<WebOsPaymentState> {
  return request('/webos/api/payment/products')
}

/** 2026-08-12 兑换码兑换（爱发电兑换码商品 → 个人中心输入 → 发放档位权益） */
export interface RedeemResult {
  outTradeNo: string
  planId: string
  planName: string
  kind: 'monthly' | 'pack'
  credits: number
  workspaceBytes: number | null
}

export function redeemAfdianCode(code: string): Promise<{ ok: true; result: RedeemResult }> {
  return request('/webos/api/payment/redeem', {
    method: 'POST',
    body: JSON.stringify({ code }),
  })
}

/** 创建支付订单（zpay 渠道；仅已登录账号） */
export function createPayOrder(productId: string, type: 'alipay' | 'wxpay'): Promise<WebOsPayOrder> {
  return request('/webos/api/payment/orders', {
    method: 'POST',
    body: JSON.stringify({ productId, type }),
  })
}

/** 查询支付订单状态（支付后轮询用） */
export function getPayOrder(orderId: string): Promise<WebOsPayOrder> {
  return request(`/webos/api/payment/orders/${encodeURIComponent(orderId)}`)
}

export async function streamChat(
  messages: WebOsChatMessage[],
  config: {
    model: 'flash'
    thinking: WebOsThinkingLevel
    conversationId?: string
    rebuild?: boolean
    /** 2026-08-11 SSE 重连（架构统一）：刷新/重开页面后重连任务事件流——
     *  服务端重放任务缓冲 + 实时转发，前端只保留一条 SSE 处理路径 */
    resume?: boolean
    /** 2026-08-11 resume 归属校验：最后一条 user 消息内容（服务端据此判断
     *  任务缓冲是否属于当前对话末尾，防止历史任务事件重放到新消息） */
    lastUser?: string
  },
  handlers: {
    onEvent: (event: WebOsChatEvent) => void
    signal?: AbortSignal
  },
): Promise<void> {
  // 2026-08-08 断流检测：用独立 controller 桥接外部 signal——
  // AbortSignal 本身没有 abort()，主动中止（45s 无数据）与外部停止共用同一信号。
  const activityController = new AbortController()
  const onOuterAbort = (): void => { try { activityController.abort() } catch { /* ignore */ } }
  if (handlers.signal) {
    if (handlers.signal.aborted) onOuterAbort()
    else handlers.signal.addEventListener('abort', onOuterAbort)
  }
  // 2026-08-10 前端可观测性：请求发出/首事件/超时/结束全部带时间戳日志
  console.warn(`[chat] ${new Date().toISOString()} stream request conv=${config.conversationId ?? 'default'} n=${messages.length} thinking=${config.thinking} rebuild=${config.rebuild ?? false}`)
  let sawStart = false
  let sawDone = false
  const response = await fetch('/webos/api/chat/stream', {
    method: 'POST',
    credentials: 'include',
    headers: JSON_HEADERS,
    body: JSON.stringify({
      messages,
      model: config.model,
      thinking: config.thinking,
      conversationId: config.conversationId,
      rebuild: config.rebuild,
      resume: config.resume,
      lastUser: config.lastUser,
    }),
    signal: activityController.signal,
  })
  if (!response.ok) {
    let message = `请求失败（HTTP ${response.status}）`
    let code = 'WEBOS_CHAT_FAILED'
    try {
      const payload = await response.json() as { error?: { message?: string; code?: string } }
      message = payload.error?.message || message
      // 2026-08-11 透传服务端错误码（CHAT_DUPLICATE_INFLIGHT / CHAT_DUPLICATE_RECENT /
      // TOKEN_INSUFFICIENT 等），前端才能按码优雅处理（409 撤销乐观消息、402 显示提示）
      if (typeof payload.error?.code === 'string' && payload.error.code) code = payload.error.code
    } catch {
      // Keep fallback message.
    }
    console.warn(`[chat] ${new Date().toISOString()} stream http-error conv=${config.conversationId ?? 'default'} status=${response.status} code=${code} msg=${message}`)
    throw new WebOsApiError(response.status, code, message)
  }
  if (!response.body) throw new WebOsApiError(502, 'WEBOS_CHAT_EMPTY_STREAM', '服务器没有返回流式内容')

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let ended = false
  // 2026-08-08 断流检测：SSE 无任何数据超过 45s（服务端每 15s 有 keep_alive 心跳，
  // 正常连接不可能 45s 静默）→ 判定连接已死，主动 abort（activityController，见函数开头）
  // 触发断流恢复逻辑——否则移动网络抖动时 fetch 会永久挂起（对话卡在"正在思考…"）。
  let lastActivityAt = Date.now()
  const activityTimer = window.setInterval(() => {
    if (Date.now() - lastActivityAt > 45_000) {
      console.warn(`[chat] ${new Date().toISOString()} stream idle-timeout(45s) aborting conv=${config.conversationId ?? 'default'} sawStart=${sawStart} sawDone=${sawDone}`)
      try { activityController.abort() } catch { /* ignore */ }
    }
  }, 10_000)
  const consume = (line: string): void => {
    const trimmed = line.trim()
    if (!trimmed.startsWith('data:')) return
    lastActivityAt = Date.now()
    const raw = trimmed.slice(5).trim()
    if (!raw) return
    try {
      const event = JSON.parse(raw) as WebOsChatEvent
      if (event.type === 'start' && !sawStart) {
        sawStart = true
        console.warn(`[chat] ${new Date().toISOString()} sse first-event=start conv=${config.conversationId ?? 'default'}`)
      }
      if (event.type === 'done' && !sawDone) {
        sawDone = true
        console.warn(`[chat] ${new Date().toISOString()} sse done conv=${config.conversationId ?? 'default'} usage=${JSON.stringify((event as { usage?: unknown }).usage ?? null)}`)
      }
      handlers.onEvent(event)
    } catch {
      // Ignore malformed heartbeat/diagnostic lines.
    }
  }

  try {
    while (!ended) {
      const result = await reader.read()
      if (result.done) break
      buffer += decoder.decode(result.value, { stream: true })
      const lines = buffer.split(/\r?\n/)
      buffer = lines.pop() || ''
      for (const line of lines) consume(line)
    }
    if (buffer) consume(buffer)
    console.warn(`[chat] ${new Date().toISOString()} stream ended conv=${config.conversationId ?? 'default'} sawStart=${sawStart} sawDone=${sawDone} aborted=${activityController.signal.aborted}`)
  } finally {
    window.clearInterval(activityTimer)
    if (handlers.signal) handlers.signal.removeEventListener('abort', onOuterAbort)
  }
}

/**
 * 终止生成（2026-08-04）：abort 指定会话正在运行的 pi prompt（会话上下文保留，
 * AI 立即停下）。用户按「终止」按钮时调用；取消失败不阻断（后台跑完兜底）。
 */
export function cancelChat(conversationId: string): Promise<{ ok: boolean; aborted: number }> {
  return request('/webos/api/chat/cancel', {
    method: 'POST',
    body: JSON.stringify({ conversationId }),
  })
}

/**
 * AI 生成会话标题（2026-08-06）：服务端轻量补全（thinking=off）生成 4-15 字中文标题。
 * 失败/服务不可用时返回 null（调用方回退到「取第一条用户消息前 20 字」）。
 */
export async function generateConversationTitle(texts: string[]): Promise<string | null> {
  try {
    const result = await request<{ title: string | null }>('/webos/api/chat/title', {
      method: 'POST',
      body: JSON.stringify({ texts }),
    })
    const title = typeof result.title === 'string' ? result.title.trim() : ''
    return title || null
  } catch {
    return null
  }
}

/**
 * 后台任务状态查询（2026-08-06）：刷新/重开页面后主动查询该会话是否有
 * 仍在后台运行的任务，并取回过程事件（思考/工具/输出），前端正常渲染。
 */
export interface BackgroundTaskInfo {
  running: boolean
  elapsed?: number
  events?: Array<{ kind: 'thinking' | 'delta' | 'tool_start' | 'tool_update' | 'tool_end' | 'html'; content?: string; tool?: string; ok?: boolean; heightPx?: number }>
  /** 2026-08-11：缓冲所属任务对应的最后一条 user 消息（恢复时校验缓冲归属） */
  lastUserContent?: string
}
export async function getBackgroundTask(conversationId: string): Promise<BackgroundTaskInfo> {
  // 2026-08-11 修复：查询失败必须**抛错**（不能返回 {running:false}）——
  // 轮询用 running=false 判定"任务已结束"并停止；网络抖动/服务端瞬时异常时
  // 返回 false 会让恢复渲染中途停止（线上实测：任务还在跑、轮询误停）。
  // 调用方（pollBackgroundTask/recoverBackgroundTask）自行区分处理。
  return await request<BackgroundTaskInfo>(`/webos/api/chat/background?conversationId=${encodeURIComponent(conversationId)}`)
}

// ============================================================================
// 应用商店 + 分享 + 外部 API 代理（2026-08-03）
// ============================================================================

export interface StoreAppItem {
  id: string
  name: string
  icon?: string | null
  description: string
  ownerName: string
  downloads: number
  installs: number
  /** 2026-08-12 应用占内存（安装后占用工作区空间：HTML 快照 + 素材） */
  sizeBytes?: number
  createdAt: number
  installed?: boolean
  html?: string
}

export function storeList(params?: { q?: string; sort?: 'latest' | 'hot' }): Promise<{ items: StoreAppItem[]; userFreeBytes?: number }> {
  const query = new URLSearchParams()
  if (params?.q?.trim()) query.set('q', params.q.trim().slice(0, 60))
  if (params?.sort === 'hot') query.set('sort', 'hot')
  const qs = query.toString()
  return request(`/webos/api/store/apps${qs ? `?${qs}` : ''}`)
}

export function storeGet(shareId: string): Promise<{ item: StoreAppItem }> {
  return request(`/webos/api/store/apps/${encodeURIComponent(shareId)}`)
}

export function storePublish(appId: string, description?: string): Promise<{ ok: boolean; shareId: string; url: string; message: string }> {
  return request('/webos/api/store/apps', {
    method: 'POST',
    body: JSON.stringify({ appId, description: description ?? '' }),
  })
}

export function storeUnpublish(shareId: string): Promise<{ ok: boolean; message: string }> {
  return request(`/webos/api/store/apps/${encodeURIComponent(shareId)}`, { method: 'DELETE' })
}

export function storeInstall(shareId: string): Promise<{ ok: boolean; appId: string; message: string }> {
  return request(`/webos/api/store/apps/${encodeURIComponent(shareId)}/install`, { method: 'POST' })
}

export function storeVisit(shareId: string): Promise<{ ok: boolean }> {
  return request(`/webos/api/store/apps/${encodeURIComponent(shareId)}/visit`, { method: 'POST' })
}

export function storeMy(): Promise<{ items: StoreAppItem[] }> {
  return request('/webos/api/store/my')
}

export function storeExportUrl(shareId: string): string {
  return `/webos/api/store/apps/${encodeURIComponent(shareId)}/export`
}

// ============================================================================
// 技能市场（2026-08-09）：市场内分发系统级 skill（xhs-content 等）到用户工作区
// ============================================================================

export interface StoreSkillItem {
  id: string
  name: string
  description: string
  sizeBytes: number
  installable: boolean
  installed: boolean
}

export function storeSkillsList(): Promise<{ items: StoreSkillItem[] }> {
  return request('/webos/api/store/skills')
}

export function storeSkillInstall(skillId: string): Promise<{ ok: boolean; skillId: string; message: string }> {
  return request(`/webos/api/store/skills/${encodeURIComponent(skillId)}/install`, { method: 'POST' })
}

/** 外部 API 代理（App 接入第三方/自建 API；服务端防 SSRF + 限频） */
export function proxyHttp(input: { method?: string; url: string; headers?: Record<string, string>; body?: unknown }): Promise<{ status: number; body: string; contentType: string | null }> {
  return request('/webos/api/http', {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

/**
 * 整套系统分享（2026-08-07 入口补全）：打包 加载页 + 系统桌面 + 全部用户 App，
 * 生成分享链接（/daily/exp/sh-*）——别人打开可完整体验（加载页→桌面→应用），
 * 并可一键安装。与「发布到商店」不同：不进入商店列表，纯链接分享。
 */
export function createSystemShare(): Promise<{ ok: boolean; shareId: string; url: string; apps: number; message: string }> {
  return request('/webos/api/share', { method: 'POST' })
}

/** 单个 App 轻量分享（2026-08-08）：不发布商店，纯链接分享给朋友（/daily/exp/ap-*） */
export function shareAppToFriend(appId: string): Promise<{ ok: boolean; shareId: string; url: string; name: string; message: string }> {
  return request('/webos/api/share/app', {
    method: 'POST',
    body: JSON.stringify({ appId }),
  })
}
