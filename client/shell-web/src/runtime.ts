import type { WebOsApp } from '@shared/webos-contracts'
import {
  createApp,
  deleteAppFile,
  getAppStorage,
  getAppStorageValue,
  listAppFiles,
  mkdirAppFile,
  proxyHttp,
  readAppFile,
  setAppStorageValue,
  deleteAppStorageValue,
  storeExportUrl,
  storeInstall,
  storeList,
  storeMy,
  storePublish,
  storeUnpublish,
  storeVisit,
  writeAppFile,
} from './api'

export const WEBOS_SDK_VERSION = '0.1.0'
export const WEBOS_SDK_CHANNEL = 'p0'
export const WEBOS_PRIVATE_STORAGE_CAPABILITY = 'app.storage.private'
export const WEBOS_APPS_CREATE_CAPABILITY = 'system.apps.create'
/** App 私有文件系统（读写自己的工作区文件夹 apps/<appId>/） */
export const WEBOS_APP_FS_CAPABILITY = 'app.fs'
/** 跨 App 共享文件（读写 shared/ 共享区） */
export const WEBOS_APP_FS_SHARED_CAPABILITY = 'app.fs.shared'

export type WebOsRuntimeApp = Pick<WebOsApp, 'id' | 'name' | 'activeVersionId'>

export interface WebOsRuntimeContext {
  app: WebOsRuntimeApp
  versionId: string | null
  capabilities: string[]
}

export interface WebOsPermissionRequest {
  capability: string
  reason?: string
}

export interface WebOsPermissionResult {
  capability: string
  granted: boolean
  reason?: string
}

export interface WebOsRuntimeEventMap {
  ready: { appId: string; versionId: string | null }
  error: { code: string; message: string }
  permission_request: WebOsPermissionRequest
}

export interface WebOsRuntimeHandle {
  iframe: HTMLIFrameElement
  context: WebOsRuntimeContext
  channel: MessageChannel
  destroy: () => void
}

const ALLOWED_CAPABILITIES = new Set([
  WEBOS_PRIVATE_STORAGE_CAPABILITY,
  WEBOS_APPS_CREATE_CAPABILITY,
  WEBOS_APP_FS_CAPABILITY,
  WEBOS_APP_FS_SHARED_CAPABILITY,
])
const REQUEST_TIMEOUT_MS = 8_000

type RuntimeMessage = {
  channel?: unknown
  kind?: unknown
  requestId?: unknown
  method?: unknown
  params?: unknown
  payload?: unknown
}

function assertCapability(capability: string): void {
  if (!ALLOWED_CAPABILITIES.has(capability)) {
    throw new Error(`Unsupported App capability: ${capability}`)
  }
}

function request<T>(port: MessagePort, method: string, params: Record<string, unknown> = {}): Promise<T> {
  const requestId = crypto.randomUUID()
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      port.removeEventListener('message', onMessage)
      reject(new Error(`Runtime request timed out: ${method}`))
    }, REQUEST_TIMEOUT_MS)

    const onMessage = (event: MessageEvent<unknown>): void => {
      const payload = event.data
      if (!payload || typeof payload !== 'object') return
      const message = payload as { requestId?: unknown; ok?: unknown; data?: unknown; error?: unknown }
      if (message.requestId !== requestId) return
      window.clearTimeout(timer)
      port.removeEventListener('message', onMessage)
      if (message.ok === true) resolve(message.data as T)
      else reject(new Error(typeof message.error === 'string' ? message.error : `Runtime request failed: ${method}`))
    }

    port.addEventListener('message', onMessage)
    port.start()
    port.postMessage({ channel: 'daily-webos-sdk', kind: 'request', requestId, method, params })
  })
}

function createPrivateStorageApi(port: MessagePort, appId: string) {
  return {
    get<T = unknown>(key: string): Promise<T | null> {
      return request<T | null>(port, 'storage.get', { appId, key })
    },
    set(key: string, value: unknown): Promise<void> {
      return request<void>(port, 'storage.set', { appId, key, value })
    },
    remove(key: string): Promise<void> {
      return request<void>(port, 'storage.remove', { appId, key })
    },
    list(): Promise<Record<string, unknown>> {
      return request<Record<string, unknown>>(port, 'storage.list', { appId })
    },
  }
}

export interface WebOsFsEntry {
  name: string
  type: 'dir' | 'file'
  size: number
  modifiedAt: number
}

function createFsApi(port: MessagePort, scope: 'app' | 'shared') {
  const fsRequest = <T>(method: string, params: Record<string, unknown>): Promise<T> =>
    request<T>(port, method, { scope, ...params })
  return {
    list(dir = '.'): Promise<{ entries: WebOsFsEntry[] }> {
      return fsRequest('fs.list', { path: dir })
    },
    read(path: string): Promise<{ content: string; size: number }> {
      return fsRequest('fs.read', { path })
    },
    write(path: string, content: string): Promise<{ ok: boolean }> {
      return fsRequest('fs.write', { path, content })
    },
    mkdir(path: string): Promise<{ ok: boolean }> {
      return fsRequest('fs.mkdir', { path })
    },
    delete(path: string): Promise<{ ok: boolean }> {
      return fsRequest('fs.delete', { path })
    },
  }
}

async function handleHostRequest(
  port: MessagePort,
  message: RuntimeMessage,
  context: WebOsRuntimeContext,
  onEvent?: <K extends keyof WebOsRuntimeEventMap>(kind: K, payload: WebOsRuntimeEventMap[K]) => void,
): Promise<void> {
  const requestId = typeof message.requestId === 'string' ? message.requestId : null
  const method = typeof message.method === 'string' ? message.method : null
  if (!requestId || !method) return
  const params = message.params && typeof message.params === 'object'
    ? message.params as Record<string, unknown>
    : {}

  const respond = (ok: boolean, data?: unknown, error?: string): void => {
    port.postMessage({ channel: 'daily-webos-sdk', kind: 'response', requestId, ok, data, error })
  }

  try {
    if (method === 'permission.request') {
      const capability = typeof params.capability === 'string' ? params.capability : ''
      assertCapability(capability)
      const declared = context.capabilities.includes(capability)
      const result: WebOsPermissionResult = {
        capability,
        granted: declared,
        reason: declared ? undefined : 'App manifest 未声明该能力',
      }
      respond(true, result)
      onEvent?.('permission_request', { capability, reason: typeof params.reason === 'string' ? params.reason : undefined })
      return
    }

    if (method === 'apps.create') {
      if (!context.capabilities.includes(WEBOS_APPS_CREATE_CAPABILITY)) {
        throw new Error('App 未声明 system.apps.create')
      }
      const html = typeof params.html === 'string' ? params.html : ''
      if (!html.trim()) throw new Error('apps.create 需要 html')
      const name = typeof params.name === 'string' && params.name.trim() ? params.name.trim() : undefined
      const { app } = await runtimeAppsAdapter.create(name, html)
      respond(true, { id: app.id, name: app.name })
      return
    }

    if (method === 'storage.list' || method === 'storage.get' || method === 'storage.set' || method === 'storage.remove') {
      if (!context.capabilities.includes(WEBOS_PRIVATE_STORAGE_CAPABILITY)) {
        throw new Error('App 未声明 app.storage.private')
      }
      const appId = params.appId === context.app.id ? context.app.id : null
      if (!appId) throw new Error('Runtime App 身份不匹配')
      const key = typeof params.key === 'string' ? params.key : null
      if (method !== 'storage.list' && !key) throw new Error('Storage key 必填')
      if (method === 'storage.list') {
        respond(true, await runtimeStorageAdapter.list(appId))
      } else if (method === 'storage.get') {
        respond(true, await runtimeStorageAdapter.get(appId, key as string))
      } else if (method === 'storage.set') {
        await runtimeStorageAdapter.set(appId, key as string, params.value)
        respond(true)
      } else {
        await runtimeStorageAdapter.remove(appId, key as string)
        respond(true)
      }
      return
    }

    // App 文件系统：fs.list / fs.read / fs.write / fs.mkdir / fs.delete
    // scope: 'app' 私有文件（app.fs） / 'shared' 共享文件（app.fs.shared）
    if (method === 'fs.list' || method === 'fs.read' || method === 'fs.write' || method === 'fs.mkdir' || method === 'fs.delete') {
      const scope = params.scope === 'shared' ? 'shared' : 'app'
      const required = scope === 'shared' ? WEBOS_APP_FS_SHARED_CAPABILITY : WEBOS_APP_FS_CAPABILITY
      if (!context.capabilities.includes(required)) {
        throw new Error(`App 未声明 ${required}`)
      }
      const appId = context.app.id
      const pathName = typeof params.path === 'string' && params.path ? params.path : null
      if (method !== 'fs.list' && !pathName) throw new Error('fs path 必填')
      if (method === 'fs.list') {
        respond(true, await runtimeAppFsAdapter.list(appId, scope, pathName ?? '.'))
      } else if (method === 'fs.read') {
        respond(true, await runtimeAppFsAdapter.read(appId, scope, pathName as string))
      } else if (method === 'fs.write') {
        const content = typeof params.content === 'string' ? params.content : null
        if (content === null) throw new Error('fs.write 需要 content 字符串')
        await runtimeAppFsAdapter.write(appId, scope, pathName as string, content)
        respond(true, { ok: true })
      } else if (method === 'fs.mkdir') {
        await runtimeAppFsAdapter.mkdir(appId, scope, pathName as string)
        respond(true, { ok: true })
      } else {
        await runtimeAppFsAdapter.delete(appId, scope, pathName as string)
        respond(true, { ok: true })
      }
      return
    }

    if (method === 'apps.open') {
      const appId = typeof params.appId === 'string' && params.appId ? params.appId : null
      if (!appId) throw new Error('apps.open 需要 appId')
      const opener = getRuntimeOpenApp()
      if (!opener) throw new Error('apps.open 宿主未就绪')
      opener(appId)
      respond(true, { ok: true })
      return
    }

    // 外部 API 代理（2026-08-03）：App 通过 DailyWebOs.http 调第三方/自建 API
    if (method === 'http.request') {
      const url = typeof params.url === 'string' && params.url ? params.url : ''
      if (!url) throw new Error('http.request 需要 url')
      const m = typeof params.method === 'string' ? params.method : 'GET'
      const headers = params.headers && typeof params.headers === 'object' ? params.headers as Record<string, string> : undefined
      const result = await proxyHttp({ method: m, url, headers, body: params.body !== null ? params.body : undefined })
      respond(true, result)
      return
    }

    // App 间 API：register（当前 App 声明开放能力）
    if (method === 'api.register') {
      const name = typeof params.name === 'string' && params.name ? params.name : ''
      if (!name) throw new Error('api.register 需要 name')
      respond(true, { ok: true })
      return
    }

    // App 间 API：call（调用目标 App 已注册的能力；目标 App 需已打开过）
    if (method === 'api.call') {
      const targetAppId = typeof params.targetAppId === 'string' ? params.targetAppId : ''
      const name = typeof params.name === 'string' ? params.name : ''
      if (!targetAppId || !name) throw new Error('api.call 需要 targetAppId 和 name')
      const target = appRuntimePorts.get(targetAppId)
      if (!target) {
        throw new Error(`目标应用「${targetAppId}」尚未打开，无法调用其 API——请先在桌面打开它（App 间互联需要目标应用运行过一次）`)
      }
      const apiRequestId = `api-${crypto.randomUUID()}`
      const result = await new Promise<unknown>((resolve, reject) => {
        const timer = window.setTimeout(() => {
          apiPending.delete(apiRequestId)
          reject(new Error(`目标应用「${targetAppId}」API 响应超时（12s）`))
        }, 12_000)
        apiPending.set(apiRequestId, { resolve, reject, timer, respond })
        target.port.postMessage({ channel: 'daily-webos-sdk', kind: 'api_call', requestId: apiRequestId, name, params: params.params ?? null })
      })
      respond(true, result)
      return
    }

    throw new Error(`Unsupported Runtime method: ${method}`)
  } catch (error) {
    respond(false, undefined, error instanceof Error ? error.message : String(error))
    onEvent?.('error', { code: 'RUNTIME_REQUEST_FAILED', message: error instanceof Error ? error.message : String(error) })
  }
}

export function createWebOsSdk(port: MessagePort, context: WebOsRuntimeContext) {
  const requested = context.capabilities.filter((capability) => ALLOWED_CAPABILITIES.has(capability))
  return Object.freeze({
    version: WEBOS_SDK_VERSION,
    channel: WEBOS_SDK_CHANNEL,
    app: Object.freeze({
      id: context.app.id,
      name: context.app.name,
      versionId: context.versionId,
    }),
    permissions: Object.freeze({
      declared: [...requested],
      has(capability: string): boolean {
        return requested.includes(capability)
      },
      request(capability: string, reason?: string): Promise<WebOsPermissionResult> {
        assertCapability(capability)
        return request<WebOsPermissionResult>(port, 'permission.request', { capability, reason })
      },
    }),
    storage: requested.includes(WEBOS_PRIVATE_STORAGE_CAPABILITY)
      ? createPrivateStorageApi(port, context.app.id)
      : undefined,
    fs: requested.includes(WEBOS_APP_FS_CAPABILITY)
      ? Object.freeze({
          ...createFsApi(port, 'app'),
          shared: requested.includes(WEBOS_APP_FS_SHARED_CAPABILITY)
            ? createFsApi(port, 'shared')
            : undefined,
        })
      : undefined,
    apps: Object.freeze({
      create: requested.includes(WEBOS_APPS_CREATE_CAPABILITY)
        ? (name: string | undefined, html: string): Promise<{ id: string; name: string }> =>
          request<{ id: string; name: string }>(port, 'apps.create', { name, html })
        : undefined,
      open(appId: string): Promise<{ ok: boolean }> {
        return request<{ ok: boolean }>(port, 'apps.open', { appId })
      },
    }),
    // 外部 API（2026-08-03）：服务端安全代理（防 SSRF），App 可接入第三方/自建 API
    http: Object.freeze({
      request(input: { method?: string; url: string; headers?: Record<string, string>; body?: unknown }): Promise<{ status: number; body: string; contentType: string | null }> {
        return request(port, 'http.request', {
          method: input.method ?? 'GET',
          url: input.url,
          headers: input.headers ?? null,
          body: input.body !== undefined ? input.body : null,
        })
      },
      get(url: string, headers?: Record<string, string>): Promise<{ status: number; body: string; contentType: string | null }> {
        return request(port, 'http.request', { method: 'GET', url, headers: headers ?? null, body: null })
      },
      post(url: string, body?: unknown, headers?: Record<string, string>): Promise<{ status: number; body: string; contentType: string | null }> {
        return request(port, 'http.request', { method: 'POST', url, headers: headers ?? null, body: body !== undefined ? body : null })
      },
    }),
    // App 间 API（2026-08-03）：register 开放能力，call 调用其他 App 的能力
    api: Object.freeze({
      register(name: string, handler: (params: unknown) => unknown | Promise<unknown>): void {
        const apiHandlers = (window as Window & { __dailyWebOsApiHandlers?: Record<string, (params: unknown) => unknown | Promise<unknown>> }).__dailyWebOsApiHandlers ??= {}
        apiHandlers[String(name)] = handler
        void request(port, 'api.register', { name: String(name) })
      },
      call(targetAppId: string, name: string, params?: unknown): Promise<unknown> {
        return request(port, 'api.call', { targetAppId: String(targetAppId), name: String(name), params: params !== undefined ? params : null })
      },
    }),
  })
}

export function installSdkGlobals(port: MessagePort, context: WebOsRuntimeContext): void {
  const sdk = createWebOsSdk(port, context)
  const windowWithSdk = window as Window & { DailyWebOs?: unknown }
  windowWithSdk.DailyWebOs = sdk
}

// ---- App 间 API 路由表（2026-08-03）----
// 每个打开过的 App 都保留一个可用 MessagePort（后台保活），供其他 App 调用其 API。
const appRuntimePorts = new Map<string, { port: MessagePort }>()
interface ApiPendingEntry {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
  respond: (ok: boolean, data?: unknown, error?: string) => void
}
const apiPending = new Map<string, ApiPendingEntry>()

export function createRuntimeChannel(
  iframe: HTMLIFrameElement,
  context: WebOsRuntimeContext,
  onEvent?: <K extends keyof WebOsRuntimeEventMap>(kind: K, payload: WebOsRuntimeEventMap[K]) => void,
): WebOsRuntimeHandle {
  const channel = new MessageChannel()
  const { port1, port2 } = channel
  // 注册本 App 的 port（App 间 API 路由；destroy 时移除）
  appRuntimePorts.set(context.app.id, { port: port1 })
  const onPortMessage = (event: MessageEvent<unknown>): void => {
    const payload = event.data
    if (!payload || typeof payload !== 'object') return
    const message = payload as {
      channel?: unknown
      kind?: unknown
      requestId?: unknown
      method?: unknown
      params?: unknown
      payload?: unknown
    }
    if (message.channel !== 'daily-webos-sdk' || typeof message.kind !== 'string') return
    // 其他 App 通过宿主转发来的 api_call 结果（宿主 → 本 App 的 handler → 回传）
    if (message.kind === 'api_result') {
      const apiMessage = message as RuntimeMessage & { requestId?: string; ok?: boolean; data?: unknown; error?: string }
      const entry = apiPending.get(String(apiMessage.requestId ?? ''))
      if (!entry) return
      apiPending.delete(String(apiMessage.requestId ?? ''))
      window.clearTimeout(entry.timer)
      if (apiMessage.ok === true) {
        entry.resolve(apiMessage.data)
        entry.respond(true, apiMessage.data)
      } else {
        const err = new Error(typeof apiMessage.error === 'string' ? apiMessage.error : 'App API 调用失败')
        entry.reject(err)
        entry.respond(false, undefined, err.message)
      }
      return
    }
    if (message.kind === 'event' && onEvent) {
      const eventPayload = message.payload
      if (eventPayload && typeof eventPayload === 'object') {
        const value = eventPayload as { type?: unknown; data?: unknown }
        if (value.type === 'ready' || value.type === 'error' || value.type === 'permission_request') {
          onEvent(value.type, value.data as never)
        }
      }
      return
    }
    if (message.kind === 'request') {
      void handleHostRequest(port1, message, context, onEvent)
    }
  }

  port1.addEventListener('message', onPortMessage)
  port1.start()

  const onLoad = (): void => {
    iframe.contentWindow?.postMessage(
      { channel: 'daily-webos-sdk', kind: 'connect', context: { ...context, sdkVersion: WEBOS_SDK_VERSION } },
      '*',
      [port2],
    )
  }
  iframe.addEventListener('load', onLoad, { once: true })
  if (iframe.contentDocument?.readyState === 'complete') onLoad()

  return {
    iframe,
    context,
    channel,
    destroy: () => {
      iframe.removeEventListener('load', onLoad)
      port1.removeEventListener('message', onPortMessage)
      port1.close()
      port2.close()
    },
  }
}

// Keep the broker's server-backed methods in one module so the runtime contract
// can be tested independently from React. These helpers are intentionally not
// exposed to the iframe; only the controlled MessageChannel SDK is exposed.
export const runtimeStorageAdapter = {
  async list(appId: string): Promise<Record<string, unknown>> {
    const result = await getAppStorage(appId)
    return result.items
  },
  get: getAppStorageValue,
  set: setAppStorageValue,
  remove: deleteAppStorageValue,
}

/** App 文件系统宿主侧实现（受控能力 app.fs / app.fs.shared） */
export const runtimeAppFsAdapter = {
  async list(appId: string, scope: 'app' | 'shared', dir: string): Promise<{ entries: WebOsFsEntry[] }> {
    return listAppFiles(appId, scope, dir)
  },
  read: readAppFile,
  write: writeAppFile,
  mkdir: mkdirAppFile,
  delete: deleteAppFile,
}

/** App 间跳转：宿主注册打开 App 的实现（App.tsx 注入，避免 runtime 依赖 store） */
let runtimeOpenAppHandler: ((appId: string) => void) | null = null
export function setRuntimeOpenApp(handler: ((appId: string) => void) | null): void {
  runtimeOpenAppHandler = handler
}
function getRuntimeOpenApp(): ((appId: string) => void) | null {
  return runtimeOpenAppHandler
}

/** App 内创建 App 的服务端调用（受控能力 system.apps.create） */
export const runtimeAppsAdapter = {
  async create(name: string | undefined, html: string): Promise<{ app: WebOsApp }> {
    return createApp({ name, html, source: 'local_import' })
  },
}

// ============================================================================
// 系统桌面（system.desktop）SDK 桥
// ----------------------------------------------------------------------------
// 桌面是版本化的 HTML App（「AI 即系统」：AI 可以自由修改桌面 HTML）。
// 桌面 iframe 通过 MessageChannel 向宿主请求数据与服务：
//   apps.list / apps.open / apps.reorder / apps.remove / system.navigate
// 宿主实现通过依赖注入（adapters）接入，避免 runtime 模块直接依赖 store。
// ============================================================================

export interface DesktopSdkAdapters {
  apps: () => Array<{ id: string; name: string; icon?: string | null; source: string; installed: boolean }>
  openApp: (appId: string) => void
  navigate: (view: 'assistant' | 'files' | 'desktop') => void
  reorder: (appIds: string[]) => Promise<void>
  removeApp: (appId: string) => Promise<void>
  // 2026-08-06 长按菜单：发布/分享到商店、导出源码 zip、复制文本（宿主实现）
  share: (appId: string) => Promise<{ ok: boolean; shareId?: string; url?: string; message?: string }>
  /** 2026-08-08 分享给朋友（不发布商店）：生成纯链接，宿主弹系统分享面板（Web Share API） */
  shareToFriend: (appId: string) => Promise<{ ok: boolean; url: string; name?: string }>
  exportUrl: (appId: string) => Promise<{ url: string }>
  download: (url: string, name?: string) => void
  copyText: (text: string) => Promise<boolean>
}

export interface DesktopRuntimeHandle {
  iframe: HTMLIFrameElement
  destroy: () => void
  /** 2026-08-07 通知桌面 iframe「App 列表已变化」（AI 创建/删除 App 后桌面自动刷新，
   *  无需用户手动刷新页面；桌面 JS 监听 apps_changed 后重新 SDK.apps.list() 渲染） */
  notifyAppsChanged: () => void
}

const DESKTOP_CHANNEL = 'daily-webos-sdk'

async function handleDesktopRequest(
  source: Window,
  message: RuntimeMessage,
  adapters: DesktopSdkAdapters,
): Promise<void> {
  const requestId = typeof message.requestId === 'string' ? message.requestId : null
  const method = typeof message.method === 'string' ? message.method : null
  if (!requestId || !method) return
  const params = message.params && typeof message.params === 'object'
    ? message.params as Record<string, unknown>
    : {}

  const respond = (ok: boolean, data?: unknown, error?: string): void => {
    source.postMessage({ channel: DESKTOP_CHANNEL, kind: 'response', requestId, ok, data, error }, '*')
  }

  try {
    if (method === 'apps.list') {
      respond(true, adapters.apps())
      return
    }
    if (method === 'apps.open') {
      const appId = typeof params.id === 'string' ? params.id : ''
      if (!appId) throw new Error('apps.open 需要 id')
      adapters.openApp(appId)
      respond(true, { ok: true })
      return
    }
    if (method === 'apps.reorder') {
      const ids = Array.isArray(params.ids) ? params.ids.filter((id): id is string => typeof id === 'string') : []
      await adapters.reorder(ids)
      respond(true, { ok: true })
      return
    }
    if (method === 'apps.remove') {
      const appId = typeof params.id === 'string' ? params.id : ''
      if (!appId) throw new Error('apps.remove 需要 id')
      await adapters.removeApp(appId)
      respond(true, { ok: true })
      return
    }
    if (method === 'apps.share') {
      const appId = typeof params.id === 'string' ? params.id : ''
      if (!appId) throw new Error('apps.share 需要 id')
      const result = await adapters.share(appId)
      respond(true, result)
      return
    }
    if (method === 'apps.shareToFriend') {
      const appId = typeof params.id === 'string' ? params.id : ''
      if (!appId) throw new Error('apps.shareToFriend 需要 id')
      const result = await adapters.shareToFriend(appId)
      respond(true, result)
      return
    }
    if (method === 'apps.export') {
      const appId = typeof params.id === 'string' ? params.id : ''
      if (!appId) throw new Error('apps.export 需要 id')
      const result = await adapters.exportUrl(appId)
      respond(true, result)
      return
    }
    if (method === 'apps.download') {
      const url = typeof params.url === 'string' ? params.url : ''
      if (!url) throw new Error('apps.download 需要 url')
      adapters.download(url, typeof params.name === 'string' ? params.name : undefined)
      respond(true, { ok: true })
      return
    }
    if (method === 'system.copy') {
      const text = typeof params.text === 'string' ? params.text : ''
      const ok = await adapters.copyText(text)
      respond(true, { ok })
      return
    }
    if (method === 'system.navigate') {
      const view = typeof params.view === 'string' ? params.view : ''
      if (view === 'assistant' || view === 'files' || view === 'desktop') {
        adapters.navigate(view)
        respond(true, { ok: true })
        return
      }
      throw new Error(`system.navigate 视图无效: ${view}`)
    }
    throw new Error(`Unsupported Desktop method: ${method}`)
  } catch (error) {
    respond(false, undefined, error instanceof Error ? error.message : String(error))
  }
}

// 桌面 SDK 桥：纯 postMessage 双向直连（不依赖 MessageChannel 握手）。
// 桌面 iframe（opaque origin sandbox）通过 window.parent.postMessage 发请求，
// 宿主在 window 'message' 上监听并回响应。postMessage 在 sandbox 下 100% 可靠，
// 不存在 load 事件错过 / contentDocument 跨源访问失败导致的连接问题。
export function createDesktopRuntime(
  iframe: HTMLIFrameElement,
  adapters: DesktopSdkAdapters,
): DesktopRuntimeHandle {
  const target = iframe.contentWindow

  const onMessage = (event: MessageEvent<unknown>): void => {
    if (event.source !== target) return
    const payload = event.data
    if (!payload || typeof payload !== 'object') return
    const message = payload as RuntimeMessage
    if (message.channel !== DESKTOP_CHANNEL || message.kind !== 'request') return
    void handleDesktopRequest(event.source as Window, message, adapters)
  }
  window.addEventListener('message', onMessage)

  return {
    iframe,
    destroy: () => {
      window.removeEventListener('message', onMessage)
    },
    notifyAppsChanged: () => {
      if (!target) return
      try {
        target.postMessage({ channel: DESKTOP_CHANNEL, kind: 'apps_changed' }, '*')
      } catch { /* iframe 已卸载：忽略 */ }
    },
  }
}

// ============================================================================
// 应用商店（system.store）SDK 桥
// ----------------------------------------------------------------------------
// 商店是版本化 HTML App（AI 可改形态）。商店 iframe 通过纯 postMessage 向宿主
// 请求数据与服务（同桌面模式）：
//   list / get / install / share / exportUrl / my / myApps / publish / unpublish
// 宿主实现通过 adapters 注入（App.tsx StoreView 调 /webos/api/store/*）。
// ============================================================================

export interface StoreSdkAdapters {
  /** 2026-08-09 列表支持服务端搜索/排序参数（q=关键词，sort=latest|hot） */
  list: (params?: { q?: string; sort?: 'latest' | 'hot' }) => Promise<{ items: Array<Record<string, unknown>>; userFreeBytes?: number }>
  /** 2026-08-05 商店详情（含 html 快照；商店内「效果预览」用） */
  get: (shareId: string) => Promise<{ item: Record<string, unknown> }>
  install: (shareId: string) => Promise<{ ok: boolean; appId: string; message: string }>
  share: (shareId: string) => Promise<{ url: string }>
  exportUrl: (shareId: string) => Promise<{ url: string }>
  my: () => Promise<{ items: Array<Record<string, unknown>> }>
  myApps: () => Promise<{ items: Array<{ id: string; name: string; icon?: string | null }> }>
  publish: (appId: string, description?: string) => Promise<{ ok: boolean; shareId: string; url: string; message: string }>
  unpublish: (shareId: string) => Promise<{ ok: boolean; message: string }>
  /** 2026-08-06 合集批量安装（整套系统 bundle 勾选若干应用） */
  bundleInstall: (shareId: string, appIds: string[]) => Promise<{ ok: boolean; installed: number; message: string }>
  /** 2026-08-09 商店内返回桌面（宿主壳层顶栏已删除，返回由商店自己渲染） */
  back: () => void
  /** 2026-08-09 打开已安装的 App（安装后「打开」按钮） */
  openApp: (appId: string) => void
  onDownload: (url: string, name?: string) => void
  /** 2026-08-09 技能市场：列出可安装技能 / 安装到用户工作区 skills/ */
  skillsList: () => Promise<{ items: Array<Record<string, unknown>> }>
  skillsInstall: (skillId: string) => Promise<{ ok: boolean; skillId: string; message: string }>
}

export interface StoreRuntimeHandle {
  iframe: HTMLIFrameElement
  destroy: () => void
}

const STORE_CHANNEL = 'daily-webos-store'

async function handleStoreRequest(
  source: Window,
  message: RuntimeMessage,
  adapters: StoreSdkAdapters,
): Promise<void> {
  const requestId = typeof message.requestId === 'string' ? message.requestId : null
  const method = typeof message.method === 'string' ? message.method : null
  if (!requestId || !method) return
  const params = message.params && typeof message.params === 'object'
    ? message.params as Record<string, unknown>
    : {}

  const respond = (ok: boolean, data?: unknown, error?: string): void => {
    source.postMessage({ channel: STORE_CHANNEL, kind: 'response', requestId, ok, data, error }, '*')
  }

  try {
    if (method === 'list') {
      const q = typeof params.q === 'string' && params.q.trim() ? params.q.trim().slice(0, 60) : undefined
      const sort = params.sort === 'hot' ? 'hot' : 'latest'
      respond(true, await adapters.list({ q, sort }))
      return
    }
    if (method === 'get') {
      const shareId = typeof params.shareId === 'string' ? params.shareId : ''
      if (!shareId) throw new Error('get 需要 shareId')
      respond(true, await adapters.get(shareId))
      return
    }
    if (method === 'install') {
      const shareId = typeof params.shareId === 'string' ? params.shareId : ''
      if (!shareId) throw new Error('install 需要 shareId')
      respond(true, await adapters.install(shareId))
      return
    }
    // 2026-08-09 商店内导航（宿主壳层顶栏已删除，返回/打开由商店 App 自己调）
    if (method === 'system.back') {
      adapters.back()
      respond(true, { ok: true })
      return
    }
    if (method === 'system.openApp') {
      const appId = typeof params.appId === 'string' ? params.appId : ''
      if (!appId) throw new Error('system.openApp 需要 appId')
      adapters.openApp(appId)
      respond(true, { ok: true })
      return
    }
    if (method === 'share') {
      const shareId = typeof params.shareId === 'string' ? params.shareId : ''
      if (!shareId) throw new Error('share 需要 shareId')
      respond(true, await adapters.share(shareId))
      return
    }
    if (method === 'exportUrl') {
      const shareId = typeof params.shareId === 'string' ? params.shareId : ''
      if (!shareId) throw new Error('exportUrl 需要 shareId')
      respond(true, await adapters.exportUrl(shareId))
      return
    }
    if (method === 'my') {
      respond(true, await adapters.my())
      return
    }
    if (method === 'myApps') {
      respond(true, await adapters.myApps())
      return
    }
    if (method === 'publish') {
      const appId = typeof params.appId === 'string' ? params.appId : ''
      if (!appId) throw new Error('publish 需要 appId')
      respond(true, await adapters.publish(appId, typeof params.description === 'string' ? params.description : undefined))
      return
    }
    if (method === 'unpublish') {
      const shareId = typeof params.shareId === 'string' ? params.shareId : ''
      if (!shareId) throw new Error('unpublish 需要 shareId')
      respond(true, await adapters.unpublish(shareId))
      return
    }
    // 2026-08-06 合集批量安装：从整套系统 bundle 中勾选若干应用安装到桌面
    if (method === 'bundle.install') {
      const shareId = typeof params.shareId === 'string' ? params.shareId : ''
      const appIds = Array.isArray(params.appIds) ? params.appIds.map(String) : []
      if (!shareId) throw new Error('bundle.install 需要 shareId')
      if (!appIds.length) throw new Error('未选择要安装的应用')
      respond(true, await adapters.bundleInstall(shareId, appIds))
      return
    }
    // 2026-08-09 技能市场：skills.list / skills.install（市场内分发技能到用户工作区）
    if (method === 'skills.list') {
      respond(true, await adapters.skillsList())
      return
    }
    if (method === 'skills.install') {
      const skillId = typeof params.skillId === 'string' ? params.skillId : ''
      if (!skillId) throw new Error('skills.install 需要 skillId')
      respond(true, await adapters.skillsInstall(skillId))
      return
    }
    throw new Error(`Unsupported Store method: ${method}`)
  } catch (error) {
    respond(false, undefined, error instanceof Error ? error.message : String(error))
  }
}

export function createStoreRuntime(
  iframe: HTMLIFrameElement,
  adapters: StoreSdkAdapters,
): StoreRuntimeHandle {
  const target = iframe.contentWindow

  const onMessage = (event: MessageEvent<unknown>): void => {
    if (event.source !== target) return
    const payload = event.data
    if (!payload || typeof payload !== 'object') return
    const message = payload as RuntimeMessage
    // 下载指令：iframe 内点「源码」→ 宿主触发 zip 下载
    if (message.channel === STORE_CHANNEL && message.kind === 'download') {
      const downloadMessage = message as RuntimeMessage & { url?: string; name?: string }
      const url = typeof downloadMessage.url === 'string' ? downloadMessage.url : ''
      if (url) adapters.onDownload(url, typeof downloadMessage.name === 'string' ? downloadMessage.name : undefined)
      return
    }
    if (message.channel !== STORE_CHANNEL || message.kind !== 'request') return
    void handleStoreRequest(event.source as Window, message, adapters)
  }
  window.addEventListener('message', onMessage)

  return {
    iframe,
    destroy: () => {
      window.removeEventListener('message', onMessage)
    },
  }
}