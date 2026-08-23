import type { FormEvent, ReactNode } from 'react'
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import katex from 'katex'
import 'katex/dist/katex.min.css'
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Bot,
  Check,
  ChevronDown,
  ChevronRight,
  CircleDollarSign,
  Coins,
  Code2,
  Copy,
  Database,
  Download,
  ExternalLink,
  Eye,
  EyeOff,
  FileText,
  Folder,
  Gauge,
  Globe,
  Grid2X2,
  HardDrive,
  Heart,
  Image as ImageIcon,
  KeyRound,
  Layers3,
  LoaderCircle,
  LogOut,
  Mail,
  MessageCircle,
  MessageSquareText,
  MoreHorizontal,
  Pencil,
  Plus,
  QrCode,
  RotateCcw,
  ImagePlus,
  Paperclip,
  Settings,
  Share2,
  ShieldCheck,
  Sparkles,
  Square,
  TerminalSquare,
  Trash2,
  Upload,
  UserRound,
  Video,
  WalletCards,
  Search,
  X,
  type LucideIcon,
} from 'lucide-react'
import type { WebOsApp, WebOsPayOrder, WebOsThinkingLevel } from '@shared/webos-contracts'
import { blobToBase64, agentWorkspaceFileRawUrl, changePassword, createApp, createPackage, createPayOrder, createSystemShare, deleteWorkspaceFile, fetchShareMeta, getAppDetail, getAppStorage, getCreditsHistory, getEmailPuzzle, getPayOrder, getUserApiToken, listAgentWorkspaceFiles, listWorkspaceFiles, loginWithEmail, proxyHttp, readAgentWorkspaceTextFile, redeemAfdianCode, registerWithEmail, resetPassword, sendAuthEmailCodeWithPuzzle, shareAppToFriend, simpleAiChat, storeExportUrl, storeGet, storeInstall, storeList, storeMy, storePublish, storeSkillInstall, storeSkillPublish, storeSkillsList, storeSkillsMine, storeSkillsMy, storeSkillUnpublish, storeUnpublish, storeVisit, updateDisplayName, uploadAvatar, uploadWorkspaceFile, uploadWorkspaceFileLarge, workspaceFileRawUrl, invokeAppApi, getAppApiSpec, listPackages, marketList, marketDetail, marketInstall, marketMine, marketApps, type CreditsHistoryItem, type RedeemResult, type StoreAppItem, type WebOsPackageListItem, type WebOsWorkspaceEntry } from './api'
import type { ChatConversation, UiChatMessage, UiSegment } from './store'
import { createRuntimeChannel, createDesktopRuntime, createStoreRuntime, setRuntimeOpenApp, type DesktopRuntimeHandle, type StoreRuntimeHandle, type StoreSdkAdapters, type WebOsRuntimeHandle } from './runtime'
import { copyTextToClipboard, useShellStore } from './store'
import { unzipSync, strFromU8 } from 'fflate'
import './styles.css'

type IconType = LucideIcon

const thinkingOptions: Array<{ id: WebOsThinkingLevel; label: string; hint: string }> = [
  { id: 'low', label: '浅', hint: '低延迟' },
  { id: 'medium', label: '中', hint: '日常平衡' },
  { id: 'high', label: '深', hint: '更完整' },
  { id: 'max', label: '极深', hint: '复杂任务' },
]

const appIcons: Record<string, IconType> = {
  'daily.ai': Bot,
  'system.desktop': Grid2X2,
  'system.files': Folder,
}

const APP_RUNTIME_BOOTSTRAP = String.raw`(() => {
  // 2026-08-07 锚点导航修复：<base> 注入后点击 href="#xxx" 会被解析为对 base URL 的
  // 真实导航（App 内锚点点击 → raw 端点 → {"error":"NOT_FOUND"} 白屏）。拦截纯锚点
  // 链接改为文档内平滑滚动，不触发导航。
  document.addEventListener('click', function (e) {
    try {
      var t = e.target
      var a = t && t.closest ? t.closest('a') : null
      if (!a) return
      var href = a.getAttribute('href')
      if (href && href.charAt(0) === '#') {
        e.preventDefault()
        var id = href.slice(1)
        if (id) {
          var el = document.getElementById(id)
          if (el && el.scrollIntoView) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
        } else if (window.scrollTo) {
          window.scrollTo({ top: 0, behavior: 'smooth' })
        }
      }
    } catch (err) { /* 忽略 */ }
  }, true)
  const CHANNEL = 'daily-webos-sdk'
  const PRIVATE_STORAGE = 'app.storage.private'
  const REQUEST_TIMEOUT = 8000
  let port = null
  let context = null
  const pending = new Map()

  // localStorage polyfill：sandbox opaque origin 下访问 window.localStorage 会抛
  // SecurityError，生成的 App（默认用 localStorage 持久化）会直接崩溃。
  // 这里提供内存态兼容实现，并在 SDK 连接后异步落到宿主私有存储。
  // 2026-08-12 数据保存架构修复：
  //  - 预载：宿主在打开 App 前拉取私有存储快照，经 __DAILY_WEBOS_INITIAL_STORAGE__
  //    同步注入 → App 初始化时 localStorage 已有历史数据（不再"退出重进就空"）
  //  - 排队：SDK 连接前（App 初始化阶段）的 setItem 进 pendingWrites 队列，
  //    connect 后统一 flush → 初始化期间的写入不再丢失
  //  - 通知：setItem/removeItem/clear 与 hydrate 完成后派发 storage 事件 +
  //    daily-webos-storage-ready 事件 → 已监听 storage 的 App 自动刷新 UI
  let memoryStorage = null
  let storageReady = false
  let pendingWrites = []

  const emitStorage = (key, newValue, oldValue) => {
    try {
      window.dispatchEvent(new StorageEvent('storage', { key, newValue, oldValue, storageArea: null }))
    } catch {
      try { window.dispatchEvent(new Event('storage')) } catch { /* 忽略 */ }
    }
  }

  const installLocalStorage = () => {
    if (memoryStorage) return
    let nativeWorks = false
    try {
      void window.localStorage
      nativeWorks = true
    } catch (e) {
      nativeWorks = false
    }
    if (nativeWorks) return
    const memory = new Map()
    // 预载宿主拉取的私有存储快照（打开 App 前同步注入，App 首帧即有历史数据）
    const initial = window.__DAILY_WEBOS_INITIAL_STORAGE__
    if (initial && typeof initial === 'object') {
      for (const key of Object.keys(initial)) {
        const value = initial[key]
        memory.set(key, typeof value === 'string' ? value : JSON.stringify(value))
      }
    }
    const sdkStorage = () => (window.DailyWebOs && window.DailyWebOs.storage) ? window.DailyWebOs.storage : null
    const push = (op, key, value) => {
      const s = sdkStorage()
      if (!s) {
        // SDK 未就绪：排队，connect 后 flush（保证初始化阶段的写入不丢）
        pendingWrites.push({ op, key, value })
        return
      }
      const p = op === 'remove' ? s.remove(key) : s.set(key, value)
      p.catch((err) => {
        try {
          console.warn('[daily-webos] storage sync failed:', key, err instanceof Error ? err.message : String(err))
        } catch { /* 忽略 */ }
      })
    }
    const storageLike = {
      get length() { return memory.size },
      key: (index) => {
        const keys = [...memory.keys()]
        return keys[index] !== undefined ? keys[index] : null
      },
      getItem: (key) => {
        const k = String(key)
        return memory.has(k) ? memory.get(k) : null
      },
      setItem: (key, value) => {
        const k = String(key)
        const v = String(value)
        const old = memory.has(k) ? memory.get(k) : null
        memory.set(k, v)
        emitStorage(k, v, old)
        push('set', k, v)
      },
      removeItem: (key) => {
        const k = String(key)
        const old = memory.has(k) ? memory.get(k) : null
        memory.delete(k)
        emitStorage(k, null, old)
        push('remove', k)
      },
      clear: () => {
        const keys = [...memory.keys()]
        memory.clear()
        const s = sdkStorage()
        if (s) s.list().then((items) => {
          if (!items || typeof items !== 'object') return
          return Promise.all(Object.keys(items).map((itemKey) => s.remove(itemKey).catch(() => {})))
        }).catch(() => {})
        for (const k of keys) emitStorage(k, null, null)
      },
      /** 内部 hydrate 专用：直接写内存（不推送不派发，避免与服务端拉取循环） */
      _seed: (key, value) => {
        memory.set(String(key), typeof value === 'string' ? value : JSON.stringify(value))
      },
    }
    try {
      Object.defineProperty(window, 'localStorage', { value: storageLike, configurable: true })
    } catch (e) {
      try { window.localStorage = storageLike } catch (e2) { /* ignore */ }
    }
    memoryStorage = storageLike
  }
  installLocalStorage()

  const rejectPending = (message) => {
    for (const entry of pending.values()) {
      clearTimeout(entry.timer)
      entry.reject(new Error(message))
    }
    pending.clear()
  }

  const request = (method, params) => new Promise((resolve, reject) => {
    if (!port) {
      reject(new Error('Daily webOS SDK 尚未连接'))
      return
    }
    const requestId = crypto.randomUUID()
    const timer = setTimeout(() => {
      pending.delete(requestId)
      reject(new Error('Runtime request timed out: ' + method))
    }, REQUEST_TIMEOUT)
    pending.set(requestId, { resolve, reject, timer })
    port.postMessage({ channel: CHANNEL, kind: 'request', requestId, method, params: params || {} })
  })

  const onPortMessage = (event) => {
    const message = event.data
    if (!message || message.channel !== CHANNEL) return
    // 宿主 → 本 App：其他 App 调用本 App 注册的 API（2026-08-03 互联互通）
    if (message.kind === 'api_call') {
      const handler = (window.__dailyWebOsApiHandlers || {})[message.name]
      Promise.resolve().then(() => (handler ? handler(message.params) : Promise.reject(new Error('API 未注册: ' + message.name))))
        .then((result) => port.postMessage({ channel: CHANNEL, kind: 'api_result', requestId: message.requestId, ok: true, data: result }))
        .catch((err) => port.postMessage({ channel: CHANNEL, kind: 'api_result', requestId: message.requestId, ok: false, error: err instanceof Error ? err.message : String(err) }))
      return
    }
    if (message.kind !== 'response') return
    const entry = pending.get(message.requestId)
    if (!entry) return
    pending.delete(message.requestId)
    clearTimeout(entry.timer)
    if (message.ok === true) entry.resolve(message.data)
    else entry.reject(new Error(typeof message.error === 'string' ? message.error : 'Runtime request failed'))
  }

  const makeSdk = (nextContext) => {
    const declared = Array.isArray(nextContext.capabilities)
      ? nextContext.capabilities.filter((value) => value === PRIVATE_STORAGE)
      : []
    const app = Object.freeze({
      id: nextContext.app.id,
      name: nextContext.app.name,
      versionId: nextContext.versionId || null,
    })
    const permissions = Object.freeze({
      declared: [...declared],
      has: (capability) => declared.includes(capability),
      request: (capability, reason) => {
        if (capability !== PRIVATE_STORAGE) return Promise.reject(new Error('Unsupported App capability: ' + capability))
        return request('permission.request', { capability, reason })
      },
    })
    const storage = declared.includes(PRIVATE_STORAGE)
      ? Object.freeze({
          get: (key) => request('storage.get', { appId: app.id, key }),
          set: (key, value) => request('storage.set', { appId: app.id, key, value }),
          remove: (key) => request('storage.remove', { appId: app.id, key }),
          list: () => request('storage.list', { appId: app.id }),
        })
      : undefined
    // 外部 API（2026-08-03）：DailyWebOs.http.get/post/request（服务端安全代理）
    const http = Object.freeze({
      request: (opts) => request('http.request', { method: (opts && opts.method) || 'GET', url: opts && opts.url, headers: (opts && opts.headers) || null, body: opts && opts.body !== undefined ? opts.body : null }),
      get: (url, headers) => request('http.request', { method: 'GET', url, headers: headers || null, body: null }),
      post: (url, body, headers) => request('http.request', { method: 'POST', url, headers: headers || null, body: body !== undefined ? body : null }),
    })
    // App 间 API（2026-08-03）：DailyWebOs.api.register / api.call（互联互通）
    const api = Object.freeze({
      register: (name, handler) => {
        if (!name || typeof handler !== 'function') throw new Error('api.register 需要 name 和 handler 函数')
        const handlers = (window.__dailyWebOsApiHandlers = window.__dailyWebOsApiHandlers || {})
        handlers[String(name)] = handler
        void request('api.register', { name: String(name) })
      },
      call: (targetAppId, name, params) => request('api.call', { targetAppId: String(targetAppId), name: String(name), params: params !== undefined ? params : null }),
    })
    // 平台原生 AI 媒体能力（生图/素材，自动扣除当前用户积分）
    const media = Object.freeze({
      generateImage: (opts) => request('media.generateImage', { prompt: opts && opts.prompt, size: (opts && opts.size) || '1024x1024', n: (opts && opts.n) || 1, reference_image: opts && opts.reference_image }),
    })
    // 平台原生 AI 对话能力（自动扣除当前用户算力/Token）
    const ai = Object.freeze({
      chat: (opts) => request('ai.chat', { prompt: opts && opts.prompt, messages: opts && opts.messages, thinkingBudget: opts && opts.thinkingBudget }),
    })
    // 用户身份与积分感知
    const user = Object.freeze({
      getProfile: () => request('user.getProfile', {}),
      getCredits: () => request('user.getCredits', {}),
    })
    return Object.freeze({ version: nextContext.sdkVersion || '0.2.0', channel: 'p0', app, permissions, storage, http, api, media, ai, user })
  }

  window.addEventListener('message', (event) => {
    const message = event.data
    if (!message || message.channel !== CHANNEL || message.kind !== 'connect' || !event.ports[0]) return
    if (port) {
      rejectPending('Runtime channel reconnected')
      port.close()
    }
    context = message.context
    port = event.ports[0]
    port.addEventListener('message', onPortMessage)
    port.start()
    window.DailyWebOs = makeSdk(context)
    // SDK 就绪后：
    //  1) flush 初始化阶段排队的写入（App 在 connect 前 setItem 的数据不丢）
    //  2) 拉取宿主私有存储存量，直写内存（不重复推送），并派发 storage 事件通知
    //     App 刷新 UI（数据到达前 App 可能已渲染过空状态）
    if (memoryStorage) {
      const s = window.DailyWebOs.storage
      if (s) {
        const pending = pendingWrites
        pendingWrites = []
        for (const write of pending) {
          const p = write.op === 'remove' ? s.remove(write.key) : s.set(write.key, write.value)
          p.catch(() => {})
        }
        s.list().then((items) => {
          if (!items || typeof items !== 'object') return
          for (const key of Object.keys(items)) {
            const value = items[key]
            const old = memoryStorage.getItem(key)
            const next = typeof value === 'string' ? value : JSON.stringify(value)
            memoryStorage._seed(key, next)
            if (old !== next) emitStorage(key, next, old)
          }
        }).catch(() => {}).finally(() => {
          if (!storageReady) {
            storageReady = true
            try { window.dispatchEvent(new Event('daily-webos-storage-ready')) } catch { /* 忽略 */ }
          }
        })
      }
    }
    port.postMessage({
      channel: CHANNEL,
      kind: 'event',
      payload: { type: 'ready', data: { appId: context.app.id, versionId: context.versionId || null } },
    })
  })

  // 2026-08-05 图片懒加载 + 异步解码（低带宽优化）：视口外的 <img> 延迟到接近时
  // 再加载（浏览器原生 loading=lazy），不改图片质量，只优化首屏带宽占用与并发数。
  ;(function lazyImages() {
    const apply = () => {
      document.querySelectorAll('img:not([loading])').forEach((img) => {
        img.setAttribute('loading', 'lazy')
        img.setAttribute('decoding', 'async')
      })
    }
    apply()
    try {
      const observer = new MutationObserver(apply)
      observer.observe(document.documentElement, { childList: true, subtree: true })
    } catch (e) { /* ignore */ }
  })()
})()`

function withRuntimeBootstrap(html: string, appId?: string, storeShareId?: string, initialStorage?: Record<string, unknown> | null): string {
  // <base> 注入：srcdoc iframe 的基准 URL 是 about:srcdoc，相对 URL 解析不到任何地方。
  // - App 运行页（传入 appId，2026-08-06「文件夹即 App」）：base 指向该 App 的文件 raw
  //   端点 → App 文件夹即资源根。相对路径（assets/xxx.png、css/style.css、js/app.js、
  //   fetch('data.json')）自动加载该 App 文件夹内的文件（同源带 cookie 过鉴权），
  //   图片/CSS/JS 素材放进文件夹即可用，无需任何 API；
  // - 商店分享体验页（传入 storeShareId，2026-08-06）：base 指向商店 raw 端点 →
  //   发布者工作区 apps/<app_id>/ 即资源根，快照里的相对路径图片/素材正常渲染；
  // - ap- 轻量分享（2026-08-08）：base 指向 /webos/api/share/<id>/raw/（分享包素材归档）；
  // - 其他场景（互动 HTML/桌面）：base 指向宿主根，/webos/api/... 绝对路径可用。
  let base = `<base href="${window.location.origin}/">`
  if (storeShareId) {
    base = storeShareId.startsWith('ap-')
      ? `<base href="/webos/api/share/${encodeURIComponent(storeShareId)}/raw/">`
      : `<base href="/webos/api/store/apps/${encodeURIComponent(storeShareId)}/raw/">`
  } else if (appId) {
    base = `<base href="/webos/api/apps/${encodeURIComponent(appId)}/files/raw/">`
  }
  // 2026-08-12 数据保存修复：宿主打开 App 前预取的私有存储快照，同步注入 bootstrap，
  // App 初始化时 localStorage 即有历史数据（不再"退出重进就空"）。
  // 必须转义 </script>，否则 JSON 里的字符串会截断脚本标签。
  const storageInject = initialStorage && typeof initialStorage === 'object' && Object.keys(initialStorage).length > 0
    ? `<script>window.__DAILY_WEBOS_INITIAL_STORAGE__=${JSON.stringify(initialStorage).replace(/</g, '\\u003c')}<\/script>`
    : ''
  const safeTop = typeof window !== 'undefined' ? (window.getComputedStyle(document.documentElement).getPropertyValue('--safe-top').trim() || '44px') : '44px'
  const safeBottom = typeof window !== 'undefined' ? (window.getComputedStyle(document.documentElement).getPropertyValue('--safe-bottom').trim() || '18px') : '18px'
  const safeStyleInject = `<style>:root{--safe-top:${safeTop};--safe-bottom:${safeBottom};}</style>`
  // 2026-08-23 市场主题包：当前主题 tokens 注入 iframe :root（桌面/App 统一换肤，可回退）
  const themeTokens = useShellStore.getState().themeTokens
  const themeStyleInject = themeTokens && typeof themeTokens === 'object' && Object.keys(themeTokens).length > 0
    ? `<style data-daily-webos-theme>:root{${Object.entries(themeTokens)
        .filter(([k]) => /^--[a-zA-Z0-9_-]+$/.test(k))
        .map(([k, v]) => `${k}:${String(v).replace(/[^#a-zA-Z0-9\s(),.%\-_/\[\]]/g, '')};`)
        .join('')}}</style>`
    : ''
  const script = `<script data-daily-webos-runtime>${APP_RUNTIME_BOOTSTRAP}</script>`
  const inject = `${base}${storageInject}${safeStyleInject}${themeStyleInject}${script}`
  // bootstrap 必须最先执行（localStorage polyfill 需在 App 任何脚本之前就位），
  // 因此插到 <head> 开头；无 <head> 时退到 <html> 后，再退到文档最前。
  const headMatch = html.match(/<head\b[^>]*>/i)
  if (headMatch?.index !== undefined) {
    return `${html.slice(0, headMatch.index + headMatch[0].length)}${inject}${html.slice(headMatch.index + headMatch[0].length)}`
  }
  const htmlMatch = html.match(/<html\b[^>]*>/i)
  if (htmlMatch?.index !== undefined) {
    return `${html.slice(0, htmlMatch.index + htmlMatch[0].length)}${inject}${html.slice(htmlMatch.index + htmlMatch[0].length)}`
  }
  return `${inject}${html}`
}

function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })
}

/**
 * 2026-08-05 低带宽缩略图：仅对本站图片素材端点（imagegen/App raw）加 ?w= 参数，
 * 其他 URL（外链/data URI）原样返回，避免破坏任何非本站图片。
 */
function thumbUrl(url: string, width: number): string {
  try {
    if (/^\/webos\/api\/(imagegen\/file|apps\/[^/]+\/files\/raw)/.test(url)) {
      return `${url}${url.includes('?') ? '&' : '?'}w=${width}`
    }
  } catch { /* ignore */ }
  return url
}

// ---------------------------------------------------------------------------
// 粘贴/拖拽图片 → 压缩 data URI（2026-08-16 识图链路前端入口）
// ---------------------------------------------------------------------------
const MAX_PASTED_IMAGES = 8
const MAX_PASTED_IMAGE_EDGE = 2048
// 2026-08-21 兜底：与服务端 MAX_MESSAGE_LENGTH 对齐（server/src/routes/webos.ts = 12000）。
// 异常情况下（如 base64 文本被误粘贴）content 超长时阻止发送并提示。
const MAX_MESSAGE_LENGTH = 12_000

interface PendingImage {
  id: string
  name: string
  dataUrl: string
}

function isSupportedImageFile(file: File): boolean {
  return /^image\/(png|jpe?g|webp|gif|bmp)$/i.test(file.type)
    || /\.(png|jpe?g|webp|gif|bmp)$/i.test(file.name)
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '')
    reader.onerror = () => reject(reader.error ?? new Error('图片读取失败'))
    reader.readAsDataURL(file)
  })
}

function loadImageElement(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('图片解码失败'))
    image.src = src
  })
}

async function compressPastedImage(file: File): Promise<string> {
  const dataUrl = await readFileAsDataUrl(file)
  const image = await loadImageElement(dataUrl)
  const maxEdge = MAX_PASTED_IMAGE_EDGE
  let width = image.naturalWidth || image.width
  let height = image.naturalHeight || image.height
  if (width <= 0 || height <= 0) return dataUrl
  if (width > maxEdge || height > maxEdge) {
    const scale = Math.min(maxEdge / width, maxEdge / height)
    width = Math.max(1, Math.round(width * scale))
    height = Math.max(1, Math.round(height * scale))
  }
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) return dataUrl
  const keepAlpha = /^image\/(png|webp)$/i.test(file.type) || /\.(png|webp)$/i.test(file.name)
  return compressImageDataUrl(dataUrl, keepAlpha)
}
/** 压缩 data URL 图片（最长边缩到 MAX_PASTED_IMAGE_EDGE，默认 JPEG 0.82） */
async function compressImageDataUrl(dataUrl: string, keepAlpha: boolean): Promise<string> {
  const image = await loadImageElement(dataUrl)
  const maxEdge = MAX_PASTED_IMAGE_EDGE
  let width = image.naturalWidth || image.width
  let height = image.naturalHeight || image.height
  if (width <= 0 || height <= 0) return dataUrl
  if (width > maxEdge || height > maxEdge) {
    const scale = Math.min(maxEdge / width, maxEdge / height)
    width = Math.max(1, Math.round(width * scale))
    height = Math.max(1, Math.round(height * scale))
  }
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) return dataUrl
  ctx.drawImage(image, 0, 0, width, height)
  return canvas.toDataURL(keepAlpha ? 'image/png' : 'image/jpeg', 0.82)
}
/** 从剪贴板文本中提取 data:image base64 图片（部分环境图片以 text/plain 形式进入剪贴板） */
function extractPastedImageDataUrls(text: string): string[] {
  const re = /data:image\/(png|jpe?g|webp|gif|bmp);base64,[A-Za-z0-9+/=]+/gi
  const urls: string[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) urls.push(m[0])
  return urls
}

/** 用户消息里的 data URI 图片 Markdown 渲染为缩略图，避免把 base64 明文展示在气泡里 */
function UserMessageContent({ text }: { text: string }) {
  const parts: ReactNode[] = []
  const imageRe = /!\[([^\]]*)\]\((data:image\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=]+)\)/gi
  let lastIndex = 0
  let match: RegExpExecArray | null
  let key = 0
  while ((match = imageRe.exec(text)) !== null) {
    if (match.index > lastIndex) parts.push(text.slice(lastIndex, match.index))
    parts.push(<img key={key++} className="chat-user-image" src={match[2]} alt={match[1] || '图片'} />)
    lastIndex = match.index + match[0].length
  }
  if (lastIndex < text.length) parts.push(text.slice(lastIndex))
  return <>{parts}</>
}

function Button({ children, onClick, variant = 'primary', disabled = false, type = 'button', className = '' }: {
  children: ReactNode
  onClick?: () => void
  variant?: 'primary' | 'quiet' | 'ghost' | 'danger'
  disabled?: boolean
  type?: 'button' | 'submit'
  className?: string
}) {
  return <button className={`os-button os-button-${variant} ${className}`} disabled={disabled} onClick={onClick} type={type}>{children}</button>
}

function IconButton({ label, children, onClick, disabled = false, className = '' }: {
  label: string
  children: ReactNode
  onClick?: () => void
  disabled?: boolean
  className?: string
}) {
  return <button aria-label={label} className={`os-icon-button ${className}`} disabled={disabled} onClick={onClick}>{children}</button>
}

function Surface({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <section className={`os-card ${className}`}>{children}</section>
}

function Eyebrow({ children }: { children: ReactNode }) {
  return <div className="os-eyebrow">{children}</div>
}

function ScreenHeader({ title, subtitle, onBack, right }: {
  title: string
  subtitle?: string
  onBack?: () => void
  right?: ReactNode
}) {
  return <header className="screen-header">
    {onBack ? <IconButton label="返回" onClick={onBack}><ArrowLeft size={19} /></IconButton> : <span className="screen-header-spacer" />}
    <div className="screen-header-title"><strong>{title}</strong>{subtitle ? <small>{subtitle}</small> : null}</div>
    <div className="screen-header-right">{right ?? <span className="screen-header-spacer" />}</div>
  </header>
}

function StatusHint() {
  return <span className="status-hint"><span className="status-dot" />在线</span>
}

/** 系统 Logo（AI 可替换）：工作区 system/logo.svg|png → bootstrap.logo（base64）；
 * 未设置时显示默认文字标识「D」。className 控制尺寸，fallback 为文字。 */
function LogoMark({ className = 'logo-mark' }: { className?: string }) {
  const logo = useShellStore((state) => state.logo)
  if (logo) {
    return <span className={`${className} logo-mark-image`}><img src={`data:${logo.mime};base64,${logo.base64}`} alt="Daily" draggable={false} /></span>
  }
  return <span className={className}>D</span>
}

/** 定制加载页（2026-08-02）：工作区 system/boot.html 存在时以 sandbox iframe 渲染
 * （自包含 HTML，AI 可写）；否则显示默认文字加载动画。 */
function BootScreen() {
  const bootConfig = useShellStore((state) => state.bootConfig)
  if (bootConfig?.html) {
    return <main className="boot-screen boot-screen-custom">
      <iframe className="boot-frame" sandbox="allow-scripts" srcDoc={bootConfig.html} title="加载页" />
    </main>
  }
  return <main className="boot-screen"><LogoMark className="boot-mark" /><Eyebrow>DAILY · QUIET INTELLIGENCE</Eyebrow><h1>正在准备你的空间</h1><div className="loading-line"><span /></div><p>游客身份 · 本地会话 · 文字 AI</p></main>
}

function ErrorScreen({ message }: { message: string }) {
  const boot = useShellStore((state) => state.boot)
  return <main className="boot-screen error-screen"><div className="boot-mark">!</div><Eyebrow>DAILY · CONNECTION</Eyebrow><h1>暂时无法进入</h1><p>{message}</p><Button onClick={() => void boot()}>重新连接</Button><small>API Key 只由服务端读取，不会进入浏览器。</small></main>
}

function Toasts() {
  const notice = useShellStore((state) => state.notice)
  const error = useShellStore((state) => state.error)
  const setNotice = useShellStore((state) => state.setNotice)
  const setError = useShellStore((state) => state.setError)
  // 渐出动画：关闭时先加 closing class（fade-out），动画结束再真正清除
  const [closingNotice, setClosingNotice] = useState(false)
  const [closingError, setClosingError] = useState(false)
  const dismissNotice = (): void => {
    if (closingNotice) return
    setClosingNotice(true)
    window.setTimeout(() => { setClosingNotice(false); setNotice(null) }, 320)
  }
  const dismissError = (): void => {
    if (closingError) return
    setClosingError(true)
    window.setTimeout(() => { setClosingError(false); setError(null) }, 320)
  }
  return <div className="toast-stack" aria-live="polite">
    {notice ? <div className={`toast toast-success ${closingNotice ? 'toast-leave' : ''}`}><Check size={16} /><span>{notice}</span><IconButton label="关闭提示" onClick={dismissNotice}><X size={15} /></IconButton></div> : null}
    {error ? <div className={`toast toast-error ${closingError ? 'toast-leave' : ''}`}><X size={16} /><span>{error}</span><IconButton label="关闭提示" onClick={dismissError}><X size={15} /></IconButton></div> : null}
  </div>
}

function ModelThinkingCard({ compact = false }: { compact?: boolean }) {
  const ai = useShellStore((state) => state.ai)
  const setThinking = useShellStore((state) => state.setThinking)
  const setModel = useShellStore((state) => state.setModel)
  if (!ai) return null
  // 思考档位循环切换：浅 → 中 → 深 → 极深 → 浅（点击 AI 首页的「思考」chip 即可切换）
  const cycleThinking = (): void => {
    const order: WebOsThinkingLevel[] = ['low', 'medium', 'high', 'max']
    const current = order.indexOf(ai.thinking)
    void setThinking(order[(current + 1) % order.length])
  }
  // 模型循环切换（2026-08-23 模型目录：多 provider 多模型）
  const cycleModel = (): void => {
    const list = ai.models?.length ? ai.models : []
    if (list.length === 0) return
    const currentIdx = list.findIndex((m) => m.id === ai.model)
    const next = list[(currentIdx + 1) % list.length]
    void setModel(next.id)
  }
  const currentModel = ai.models?.find((m) => m.id === ai.model)
  const modelLabel = currentModel?.label ?? ai.model
  if (compact) return <div className="assistant-controls">
    <button className="control-chip" onClick={cycleModel} aria-label="切换模型"><span>模型</span><strong>{modelLabel}</strong></button>
    <button className="control-chip thinking-cycle" onClick={cycleThinking} aria-label="切换思考强度"><span>思考</span><strong>{thinkingOptions.find((item) => item.id === ai.thinking)?.label}</strong></button>
  </div>
  return <Surface className="ai-control-card"><div className="card-heading"><div><Eyebrow>AI CONTROL</Eyebrow><h2>保持两个选择独立</h2></div><Gauge size={18} /></div><div className="setting-row"><span className="setting-icon blue"><Sparkles size={16} /></span><span className="setting-copy"><strong>模型</strong><small>能力与价格由 Provider 决定，点击切换</small></span><button className="model-switcher" onClick={cycleModel} title="点击切换模型（有多模型可选）">{modelLabel} <small>{currentModel?.provider ?? ''}</small><Check size={14} /></button></div><div className="setting-row thinking-setting"><span className="setting-icon ink"><Layers3 size={16} /></span><span className="setting-copy"><strong>思考强度</strong><small>只调整本次推理预算</small></span><div className="thinking-options">{thinkingOptions.map((option) => <button className={ai.thinking === option.id ? 'selected' : ''} key={option.id} onClick={() => void setThinking(option.id)}><span>{option.label}</span><small>{option.hint}</small></button>)}</div></div></Surface>
}

function escapeHtmlText(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&#34;')
    .replace(/'/g, '&#39;')
}

/** KaTeX 渲染（出错时降级为原始文本，不打断流式输出） */
function renderLatex(tex: string, displayMode: boolean): string {
  try {
    return katex.renderToString(tex, { displayMode, throwOnError: false, output: 'html' })
  } catch {
    return `<code>${escapeHtmlText(tex)}</code>`
  }
}

/** 行内 markdown（先转义再解析，防注入） */
function inlineMarkdown(value: string): string {
  let text = escapeHtmlText(value)
  // 行内代码最先处理（避免其中的 ** / $ 等被二次解析）
  text = text.replace(/`([^`]+)`/g, (_match, code: string) => `<code>${code}</code>`)
  // 行内 LaTeX：$...$（排除 $$ 块级与已转义 \$）。
  // 2026-08-20 老设备兼容：原正则用了 lookbehind (?!...$)，Safari 16.4 之前（iOS 15.8）
  // 不支持 → 整段 bundle SyntaxError 白屏。改为两步法：先临时收走连续 $$（块级定界），
  // 再匹配单对 $（此时已无连续 $$ 干扰），最后恢复占位 → 语义与原正则等价。
  const MATH_DOLLAR = '\uE000'
  text = text
    .replace(/\$\$/g, `${MATH_DOLLAR}${MATH_DOLLAR}`)
    .replace(/\$([^$\n]+)\$(?!\$)/g, (_match, tex: string) => {
      const trimmed = tex.trim()
      if (!trimmed) return _match
      return `<span class="md-latex">${renderLatex(trimmed, false)}</span>`
    })
    .replace(`${MATH_DOLLAR}${MATH_DOLLAR}`, () => '$$')
  // 粗体 / 斜体
  text = text.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  text = text.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
  // 链接
  text = text.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>')
  return text
}

// ---------------------------------------------------------------------------
// 表格：| a | b | 语法（表头行 + :---: 分隔行 + 数据行）
// ---------------------------------------------------------------------------
function isTableSeparator(cell: string): boolean {
  return /^:?-{1,}:?$/.test(cell.trim())
}

function splitTableRow(row: string): string[] {
  return row.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => cell.trim())
}

function renderTable(rows: string[]): string {
  const head = splitTableRow(rows[0] ?? '')
  const body = rows.slice(2).map((row) => {
    const cells = splitTableRow(row)
    const tds = cells.map((cell) => `<td>${inlineMarkdown(cell)}</td>`).join('')
    return `<tr>${tds}</tr>`
  }).join('')
  const ths = head.map((cell) => `<th>${inlineMarkdown(cell)}</th>`).join('')
  return `<div class="md-table-wrap"><table><thead><tr>${ths}</tr></thead><tbody>${body}</tbody></table></div>`
}

/** 轻量 markdown → HTML（标题/列表/代码块/引用/表格/LaTeX/粗斜体/行内码/链接；流式半成品容错） */
function renderMarkdown(source: string): string {
  const lines = source.split('\n')
  const out: string[] = []
  let inCode = false
  let codeBuf: string[] = []
  let inUl = false
  let inOl = false
  const flushList = (): void => {
    if (inUl) { out.push('</ul>'); inUl = false }
    if (inOl) { out.push('</ol>'); inOl = false }
  }
  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i]
    const trimmed = raw.trim()
    if (trimmed.startsWith('```')) {
      flushList()
      if (inCode) {
        out.push(`<pre><code>${escapeHtmlText(codeBuf.join('\n'))}</code></pre>`)
        codeBuf = []
        inCode = false
      } else {
        inCode = true
      }
      continue
    }
    if (inCode) { codeBuf.push(raw); continue }
    // 块级 LaTeX：$$...$$（同行或跨行；流式未闭合时容错渲染已收集内容）
    if (trimmed.startsWith('$$')) {
      flushList()
      let buf = trimmed.slice(2).trim()
      if (buf.endsWith('$$')) {
        out.push(`<div class="md-latex-block">${renderLatex(buf.slice(0, -2).trim(), true)}</div>`)
        continue
      }
      let closed = false
      let j = i + 1
      while (j < lines.length) {
        const t = lines[j].trim()
        if (t.endsWith('$$')) { buf += `\n${t.slice(0, -2).trim()}`; closed = true; break }
        buf += `\n${t}`
        j += 1
      }
      out.push(`<div class="md-latex-block">${renderLatex(buf.trim(), true)}</div>`)
      i = closed ? j : lines.length - 1
      continue
    }
    // 表格：当前行为表格行且下一行为分隔行（|---|）
    if (i + 1 < lines.length && trimmed.includes('|') && isTableSeparator(splitTableRow(lines[i + 1].trim())[0] ?? '')) {
      // 【bug 修复 2026-08-16】rows 必须包含分隔行：renderTable 用 rows.slice(2)
      // 取数据行（假设 [表头, 分隔行, 数据1, ...]），此前漏放分隔行导致第一条
      // 数据被吞掉（表格只有一行数据时 tbody 为空）。
      const rows: string[] = [trimmed, lines[i + 1].trim()]
      let j = i + 2
      while (j < lines.length && lines[j].trim().includes('|') && lines[j].trim() !== '') {
        rows.push(lines[j].trim())
        j += 1
      }
      flushList()
      out.push(renderTable(rows))
      i = j - 1
      continue
    }
    if (/^#{1,4}\s+/.test(trimmed)) {
      flushList()
      const level = Math.min(trimmed.match(/^#+/)?.[0].length ?? 2, 4)
      out.push(`<h${level}>${inlineMarkdown(trimmed.replace(/^#{1,4}\s+/, ''))}</h${level}>`)
      continue
    }
    if (/^[-*]\s+/.test(trimmed)) {
      if (inOl) flushList()
      if (!inUl) { out.push('<ul>'); inUl = true }
      out.push(`<li>${inlineMarkdown(trimmed.replace(/^[-*]\s+/, ''))}</li>`)
      continue
    }
    if (/^\d+[.)]\s+/.test(trimmed)) {
      if (inUl) flushList()
      if (!inOl) { out.push('<ol>'); inOl = true }
      out.push(`<li>${inlineMarkdown(trimmed.replace(/^\d+[.)]\s+/, ''))}</li>`)
      continue
    }
    if (trimmed.startsWith('> ')) {
      flushList()
      out.push(`<blockquote>${inlineMarkdown(trimmed.slice(2))}</blockquote>`)
      continue
    }
    if (trimmed === '---' || trimmed === '***' || trimmed === '___') {
      flushList()
      out.push('<hr />')
      continue
    }
    if (trimmed === '') { flushList(); continue }
    flushList()
    out.push(`<p>${inlineMarkdown(raw)}</p>`)
  }
  flushList()
  if (inCode && codeBuf.length > 0) {
    out.push(`<pre><code>${escapeHtmlText(codeBuf.join('\n'))}</code></pre>`)
  }
  return out.join('\n')
}

function MarkdownContent({ text }: { text: string }) {
  const html = useMemo(() => renderMarkdown(text), [text])
  return <div className="md-content" dangerouslySetInnerHTML={{ __html: html }} />
}

/** 2026-08-06 流式节流渲染：AI 输出期间每 200ms 合并一次 markdown 渲染
 *  （此前每帧全量解析，长输出/长思考会把浏览器拖垮）。非流式直接渲染。 */
function ThrottledMarkdown({ text, streaming }: { text: string; streaming?: boolean }) {
  const [rendered, setRendered] = useState(text)
  const latestRef = useRef(text)
  latestRef.current = text
  useEffect(() => {
    if (!streaming) {
      setRendered(text)
      return
    }
    const timer = window.setInterval(() => {
      setRendered(latestRef.current)
    }, 200)
    return () => window.clearInterval(timer)
  }, [streaming]) // eslint-disable-line react-hooks/exhaustive-deps
  return <MarkdownContent text={rendered} />
}

/** 「粘贴 HTML → 创建 App」弹层（用户直连路径，不依赖 AI） */
function HtmlImportPanel({ onClose, onCreated }: { onClose: () => void; onCreated: (appId: string) => void }) {
  const [name, setName] = useState('')
  const [html, setHtml] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const submit = async (): Promise<void> => {
    if (!html.trim() || busy) return
    setBusy(true)
    setError(null)
    try {
      const { app } = await createApp({ name: name.trim() || undefined, html: html.trim(), source: 'local_import' })
      onCreated(app.id)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setBusy(false)
    }
  }
  return <div className="modal-overlay" onClick={onClose}>
    <div className="html-import-panel" onClick={(event) => event.stopPropagation()}>
      <div className="panel-heading"><strong>粘贴 HTML 创建 App</strong><button type="button" aria-label="关闭" onClick={onClose}><X size={15} /></button></div>
      <input className="html-import-name" placeholder="App 名称（可选）" value={name} onChange={(event) => setName(event.target.value)} maxLength={40} />
      <textarea className="html-import-code" placeholder={'粘贴完整的 HTML 代码…\n创建后 App 会出现在系统桌面，可直接打开运行。'} value={html} onChange={(event) => setHtml(event.target.value)} rows={9} spellCheck={false} />
      {error ? <p className="html-import-error">{error}</p> : null}
      <div className="panel-actions"><button type="button" className="panel-cancel" onClick={onClose}>取消</button><button type="button" className="panel-submit" disabled={!html.trim() || busy} onClick={() => void submit()}>{busy ? '创建中…' : '创建 App'}</button></div>
    </div>
  </div>
}

// ---------------------------------------------------------------------------
// 邮箱账号登录面板（居中弹窗；登录 / 注册 / 忘记密码三态，design skill 规范）
// 注册用验证码验证邮箱并设置密码；之后用邮箱 + 密码登录；忘记密码可用验证码重置。
// 登录窗口只在用户点击时出现，不主动弹出。
// ---------------------------------------------------------------------------
type LoginMode = 'login' | 'register' | 'forgot'

/** 密码强度评估（与服务端策略一致：8-64 位 + 至少 3 类字符；弱密码黑名单） */
const WEAK_PASSWORD_SET = new Set([
  '123456', '12345678', '123456789', '1234567890', 'password', 'password1', 'password123',
  'qwerty', 'qwerty123', 'abc123', 'abc123456', '111111', '11111111', '000000', '666666',
  '888888', '88888888', '123123', '123321', 'iloveyou', 'admin', 'admin123', 'root', 'root123',
  'letmein', 'welcome', 'welcome1', 'monkey', 'dragon', 'sunshine', 'princess', 'a123456',
  'a12345678', 'qq123456', 'woaini', 'woaini1314', 'zxcvbnm', 'asdfgh', 'asdfghjkl',
  '1q2w3e4r', '1qaz2wsx',
])

function passwordStrength(password: string): { score: 0 | 1 | 2 | 3; label: string; hint: string } {
  if (!password) return { score: 0, label: '未设置', hint: '至少 8 位，包含 3 类字符（大小写字母/数字/符号）' }
  let score = 0 as 0 | 1 | 2 | 3
  if (password.length >= 8) score = Math.min(3, score + 1) as 0 | 1 | 2 | 3
  const classes = Number(/[a-z]/.test(password)) + Number(/[A-Z]/.test(password)) + Number(/[0-9]/.test(password)) + Number(/[^a-zA-Z0-9]/.test(password))
  if (classes >= 3) score = Math.min(3, score + 1) as 0 | 1 | 2 | 3
  if (password.length >= 12 && classes >= 3 && !WEAK_PASSWORD_SET.has(password.toLowerCase())) score = Math.min(3, score + 1) as 0 | 1 | 2 | 3
  if (WEAK_PASSWORD_SET.has(password.toLowerCase())) score = Math.min(score, 1) as 0 | 1 | 2 | 3
  if (score === 0) return { score, label: '太弱', hint: '长度至少 8 位' }
  if (score === 1) return { score, label: '较弱', hint: '建议包含 3 类字符（大小写字母/数字/符号）' }
  if (score === 2) return { score, label: '中等', hint: '不错，再加长一点或更多符号会更安全' }
  return { score, label: '强', hint: '强度足够' }
}

/** 密码强度指示条（注册 / 忘记密码 / 修改密码表单共用） */
function PasswordMeter({ password }: { password: string }) {
  const { score, label, hint } = passwordStrength(password)
  const width = ['0%', '33%', '66%', '100%'][score]
  const tone = ['meter-weak', 'meter-weak', 'meter-mid', 'meter-strong'][score]
  return <div className="password-meter">
    <div className="password-meter-track"><span className={`password-meter-fill ${tone}`} style={{ width }} /></div>
    <div className="password-meter-copy"><span>{label}</span><small>{hint}</small></div>
  </div>
}

function LoginPanel({ onClose }: { onClose: () => void }) {
  const session = useShellStore((state) => state.session)
  const [mode, setMode] = useState<LoginMode>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [code, setCode] = useState('')
  const [agree, setAgree] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [cooldown, setCooldown] = useState(0)
  const timerRef = useRef<number | null>(null)
  // 已登录面板：修改密码表单
  const [changeMode, setChangeMode] = useState(false)
  const [oldPassword, setOldPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmNewPassword, setConfirmNewPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  // 反人机：发送验证码前的算术题（puzzle）
  const [puzzle, setPuzzle] = useState<{ puzzleId: string; question: string } | null>(null)
  const [puzzleAnswer, setPuzzleAnswer] = useState('')
  const [puzzleBusy, setPuzzleBusy] = useState(false)

  const clearTimer = (): void => {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current)
      timerRef.current = null
    }
  }
  useEffect(() => clearTimer, [])

  const startCooldown = (seconds: number): void => {
    setCooldown(seconds)
    clearTimer()
    timerRef.current = window.setInterval(() => {
      setCooldown((value) => {
        if (value <= 1) {
          clearTimer()
          return 0
        }
        return value - 1
      })
    }, 1000)
  }

  const validEmail = (): string | null => {
    const trimmed = email.trim().toLowerCase()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      setError('请输入正确的邮箱地址')
      return null
    }
    return trimmed
  }

  const sendCode = async (): Promise<void> => {
    const trimmed = validEmail()
    if (!trimmed || busy || cooldown > 0 || puzzleBusy) return
    // 反人机第一步：先拿一道算术题（未答对时每次点击都会换新题）
    setPuzzleBusy(true)
    setError(null)
    setMessage(null)
    try {
      const result = await getEmailPuzzle()
      setPuzzle({ puzzleId: result.puzzleId, question: result.question })
      setPuzzleAnswer('')
    } catch (err) {
      setError(err instanceof Error ? err.message : '人机验证加载失败，请重试')
    } finally {
      setPuzzleBusy(false)
    }
  }

  /** 反人机第二步：提交答案，通过后真正发送验证码 */
  const submitPuzzleAnswer = async (): Promise<void> => {
    const trimmed = validEmail()
    if (!trimmed || !puzzle || busy || puzzleBusy) return
    const answer = Number(puzzleAnswer.trim())
    if (!Number.isFinite(answer)) {
      setError('请输入正确的答案（数字）')
      return
    }
    setPuzzleBusy(true)
    setError(null)
    setMessage(null)
    try {
      const result = await sendAuthEmailCodeWithPuzzle(trimmed, puzzle.puzzleId, answer)
      setPuzzle(null)
      setPuzzleAnswer('')
      setMessage(result.message)
      startCooldown(result.cooldownSeconds ?? 60)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      // 答错/过期：换一道新题让用户重试
      setPuzzle(null)
      setPuzzleAnswer('')
    } finally {
      setPuzzleBusy(false)
    }
  }

  const finishAuth = async (_result: { migrated: boolean; message: string }): Promise<void> => {
    // 登录/注册成功：刷新 bootstrap（会话变为正式用户；游客资产迁移后自动可见）；
    // 面板关闭 + 身份切换即为反馈，不弹底部 toast（面板内已有 message 展示）
    await useShellStore.getState().refreshBootstrap()
    clearTimer()
    onClose()
  }

  const submitLogin = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    const trimmed = validEmail()
    if (!trimmed || busy) return
    if (!password) {
      setError('请输入密码')
      return
    }
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      await finishAuth(await loginWithEmail(trimmed, password))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  /** 确认密码一致性 + 强度校验（注册/忘记密码/修改密码共用） */
  const validateNewPassword = (value: string, confirm: string, subject = '密码'): string | null => {
    if (value.length < 8 || value.length > 64) return `${subject}长度需在 8-64 位之间`
    const classes = Number(/[a-z]/.test(value)) + Number(/[A-Z]/.test(value)) + Number(/[0-9]/.test(value)) + Number(/[^a-zA-Z0-9]/.test(value))
    if (classes < 3) return `${subject}强度不足：需至少包含 大写/小写/数字/符号 中的 3 类`
    if (WEAK_PASSWORD_SET.has(value.toLowerCase())) return '该密码过于常见，请更换更复杂的密码'
    if (confirm && value !== confirm) return '两次输入的密码不一致'
    return null
  }

  const submitRegister = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    const trimmed = validEmail()
    if (!trimmed || busy) return
    const passwordError = validateNewPassword(password, confirmPassword)
    if (passwordError) {
      setError(passwordError)
      return
    }
    if (code.length !== 6) {
      setError('请输入 6 位验证码')
      return
    }
    if (!agree) {
      setError('请先阅读并同意《服务条款与隐私政策》')
      return
    }
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      await finishAuth(await registerWithEmail(trimmed, password, code.trim()))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const submitForgot = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    const trimmed = validEmail()
    if (!trimmed || busy) return
    const passwordError = validateNewPassword(password, confirmPassword, '新密码')
    if (passwordError) {
      setError(passwordError)
      return
    }
    if (code.length !== 6) {
      setError('请输入 6 位验证码')
      return
    }
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      await finishAuth(await resetPassword(trimmed, password, code.trim()))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const submitChangePassword = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    if (busy) return
    if (!oldPassword) {
      setError('请输入当前密码')
      return
    }
    const passwordError = validateNewPassword(newPassword, confirmNewPassword, '新密码')
    if (passwordError) {
      setError(passwordError)
      return
    }
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      const result = await changePassword(oldPassword, newPassword)
      setMessage(result.message)
      setOldPassword('')
      setNewPassword('')
      setConfirmNewPassword('')
      setChangeMode(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const logout = async (): Promise<void> => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      await useShellStore.getState().logout()
      clearTimer()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  // 已登录：账户信息 + 修改密码 + 退出
  if (session && !session.guest) {
    const emailAddress = session.user.email ?? ''
    if (changeMode) {
      return <div className="login-overlay" onClick={onClose}>
        <div className="login-panel" onClick={(event) => event.stopPropagation()}>
          <div className="login-heading"><LogoMark className="login-mark" /><div><strong>修改密码</strong><small>验证当前密码后设置新密码</small></div><button type="button" className="login-close" aria-label="关闭" onClick={onClose}><X size={16} /></button></div>
          <form className="login-step" onSubmit={(event) => void submitChangePassword(event)}>
            <label className="login-label" htmlFor="old-password">当前密码</label>
            <div className="login-password-row">
              <input id="old-password" className="login-input" type={showPassword ? 'text' : 'password'} autoComplete="current-password" placeholder="输入当前密码" value={oldPassword} onChange={(event) => setOldPassword(event.target.value)} disabled={busy} />
              <button type="button" className="login-password-toggle" aria-label={showPassword ? '隐藏密码' : '显示密码'} onClick={() => setShowPassword((value) => !value)}>{showPassword ? <EyeOff size={16} /> : <Eye size={16} />}</button>
            </div>
            <label className="login-label" htmlFor="new-password-1">新密码（8-64 位，含 3 类字符）</label>
            <div className="login-password-row">
              <input id="new-password-1" className="login-input" type={showPassword ? 'text' : 'password'} autoComplete="new-password" placeholder="设置新密码" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} disabled={busy} />
              <button type="button" className="login-password-toggle" aria-label={showPassword ? '隐藏密码' : '显示密码'} onClick={() => setShowPassword((value) => !value)}>{showPassword ? <EyeOff size={16} /> : <Eye size={16} />}</button>
            </div>
            <PasswordMeter password={newPassword} />
            <label className="login-label" htmlFor="new-password-2">再次输入新密码</label>
            <input id="new-password-2" className="login-input" type={showPassword ? 'text' : 'password'} autoComplete="new-password" placeholder="再次输入新密码" value={confirmNewPassword} onChange={(event) => setConfirmNewPassword(event.target.value)} disabled={busy} />
            {confirmNewPassword && confirmNewPassword !== newPassword ? <p className="login-error">两次输入的密码不一致</p> : null}
            <button type="submit" className="os-button os-button-primary login-submit" disabled={busy || !oldPassword || newPassword.length < 8 || confirmNewPassword !== newPassword}>{busy ? <LoaderCircle className="spin" size={15} /> : <Check size={15} />}确认修改</button>
            <div className="login-actions"><button type="button" className="login-link" onClick={() => { setChangeMode(false); setError(null); setMessage(null) }}>返回账户信息</button></div>
            {message ? <p className="login-message">{message}</p> : null}
            {error ? <p className="login-error">{error}</p> : null}
          </form>
        </div>
      </div>
    }
    return <div className="login-overlay" onClick={onClose}>
      <div className="login-panel" onClick={(event) => event.stopPropagation()}>
        <div className="login-heading"><LogoMark className="login-mark" /><div><strong>账户</strong><small>Daily · 已登录</small></div><button type="button" className="login-close" aria-label="关闭" onClick={onClose}><X size={16} /></button></div>
        <div className="account-line login-account"><span className="avatar-large">{emailAddress.slice(0, 2).toUpperCase() || session.user.username.slice(0, 2).toUpperCase()}</span><span><strong>{session.user.username}</strong><small>{emailAddress || session.user.id}</small></span><span className="sync-badge"><span className="status-dot" />已登录</span></div>
        <div className="login-note"><ShieldCheck size={14} /> 你的 App、余额与设置已保存在账号下，换设备用同一邮箱和密码登录即可恢复。</div>
        <button type="button" className="os-button os-button-quiet login-logout" onClick={() => { setChangeMode(true); setError(null); setMessage(null) }} disabled={busy}><KeyRound size={15} /> 修改密码</button>
        <button type="button" className="os-button os-button-quiet login-logout" onClick={() => void logout()} disabled={busy}><LogOut size={15} /> 退出登录（回到游客身份）</button>
        {error ? <p className="login-error">{error}</p> : null}
      </div>
    </div>
  }

  // 游客：登录 / 注册 / 忘记密码
  const switchMode = (next: LoginMode): void => {
    setMode(next)
    setError(null)
    setMessage(null)
  }
  const title = mode === 'login' ? '登录 Daily' : mode === 'register' ? '注册账号' : '重置密码'
  const subtitle = mode === 'login'
    ? '使用邮箱和密码登录'
    : mode === 'register'
      ? '验证码验证邮箱，设置密码后即可使用'
      : '验证码验证邮箱后设置新密码'

  return <div className="login-overlay" onClick={onClose}>
    <div className="login-panel" onClick={(event) => event.stopPropagation()}>
      <div className="login-heading"><LogoMark className="login-mark" /><div><strong>{title}</strong><small>{subtitle}</small></div><button type="button" className="login-close" aria-label="关闭" onClick={onClose}><X size={16} /></button></div>

      <div className="login-tabs" role="tablist">
        <button type="button" role="tab" aria-selected={mode === 'login'} className={mode === 'login' ? 'active' : ''} onClick={() => switchMode('login')}>登录</button>
        <button type="button" role="tab" aria-selected={mode === 'register'} className={mode === 'register' ? 'active' : ''} onClick={() => switchMode('register')}>注册</button>
      </div>

      <form className={`login-step ${mode === 'login' ? 'active' : 'hidden'}`} style={{ display: mode === 'login' ? 'flex' : 'none' }} onSubmit={(event) => void submitLogin(event)}>
        <label className="login-label" htmlFor="login-email">邮箱地址</label>
        <input id="login-email" className="login-input" type="email" inputMode="email" autoComplete="email" placeholder="you@example.com" value={email} onChange={(event) => setEmail(event.target.value)} disabled={busy} />
        <label className="login-label" htmlFor="login-password">密码</label>
        <div className="login-password-row">
          <input id="login-password" className="login-input" type={showPassword ? 'text' : 'password'} autoComplete="current-password" placeholder="输入密码" value={password} onChange={(event) => setPassword(event.target.value)} disabled={busy} />
          <button type="button" className="login-password-toggle" aria-label={showPassword ? '隐藏密码' : '显示密码'} onClick={() => setShowPassword((value) => !value)}>{showPassword ? <EyeOff size={16} /> : <Eye size={16} />}</button>
        </div>
        <button type="submit" className="os-button os-button-primary login-submit" disabled={busy || !email.trim() || !password}>{busy ? <LoaderCircle className="spin" size={15} /> : <KeyRound size={15} />}登录</button>
        <div className="login-actions"><button type="button" className="login-link" onClick={() => switchMode('forgot')}>忘记密码？</button><button type="button" className="login-link" onClick={() => switchMode('register')}>没有账号？去注册</button></div>
      </form>

      <form className={`login-step ${mode === 'register' ? 'active' : 'hidden'}`} style={{ display: mode === 'register' ? 'flex' : 'none' }} onSubmit={(event) => void submitRegister(event)}>
        <label className="login-label" htmlFor="reg-email">邮箱地址</label>
        <input id="reg-email" className="login-input" type="email" inputMode="email" autoComplete="email" placeholder="you@example.com" value={email} onChange={(event) => setEmail(event.target.value)} disabled={busy} />
        <label className="login-label" htmlFor="reg-code">验证码（用于验证邮箱归属）</label>
        <div className="login-code-row">
          <input id="reg-code" className="login-input login-code-input" type="text" inputMode="numeric" autoComplete="one-time-code" maxLength={6} placeholder="000000" value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, ''))} disabled={busy} />
          {puzzle ? <button type="button" className="os-button os-button-quiet login-sendcode" disabled={puzzleBusy} onClick={() => void submitPuzzleAnswer()}>{puzzleBusy ? '验证中…' : '提交答案'}</button>
            : <button type="button" className="os-button os-button-quiet login-sendcode" disabled={busy || cooldown > 0 || !email.trim()} onClick={() => void sendCode()}>{cooldown > 0 ? `${cooldown}s` : '获取验证码'}</button>}
        </div>
        {puzzle ? <div className="puzzle-box"><ShieldCheck size={14} /><span>人机验证：<b>{puzzle.question}</b></span><input className="puzzle-answer" inputMode="numeric" placeholder="输入答案" value={puzzleAnswer} onChange={(event) => setPuzzleAnswer(event.target.value.replace(/[^\d-]/g, ''))} autoFocus /></div> : null}
        <label className="login-label" htmlFor="reg-password">设置密码（至少 8 位，含 3 类字符）</label>
        <div className="login-password-row">
          <input id="reg-password" className="login-input" type={showPassword ? 'text' : 'password'} autoComplete="new-password" placeholder="设置登录密码" value={password} onChange={(event) => setPassword(event.target.value)} disabled={busy} />
          <button type="button" className="login-password-toggle" aria-label={showPassword ? '隐藏密码' : '显示密码'} onClick={() => setShowPassword((value) => !value)}>{showPassword ? <EyeOff size={16} /> : <Eye size={16} />}</button>
        </div>
        {mode === 'register' ? <PasswordMeter password={password} /> : null}
        <label className="login-label" htmlFor="reg-password-confirm">再次输入密码</label>
        <input id="reg-password-confirm" className="login-input" type={showPassword ? 'text' : 'password'} autoComplete="new-password" placeholder="再次输入密码" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} disabled={busy} />
        {confirmPassword && confirmPassword !== password ? <p className="login-error">两次输入的密码不一致</p> : null}
        <label className="terms-row"><input type="checkbox" checked={agree} onChange={(event) => setAgree(event.target.checked)} disabled={busy} /><span>我已阅读并同意<a href="/daily/terms.html" target="_blank" rel="noreferrer">《服务条款与隐私政策》</a></span></label>
        <button type="submit" className="os-button os-button-primary login-submit" disabled={busy || !email.trim() || code.length !== 6 || password.length < 8 || confirmPassword !== password || !agree}>{busy ? <LoaderCircle className="spin" size={15} /> : <Check size={15} />}注册并登录</button>
        <div className="login-actions"><span className="login-hint">已有账号？</span><button type="button" className="login-link" onClick={() => switchMode('login')}>去登录</button></div>
      </form>

      <form className={`login-step ${mode === 'forgot' ? 'active' : 'hidden'}`} style={{ display: mode === 'forgot' ? 'flex' : 'none' }} onSubmit={(event) => void submitForgot(event)}>
        <label className="login-label" htmlFor="forgot-email">邮箱地址</label>
        <input id="forgot-email" className="login-input" type="email" inputMode="email" autoComplete="email" placeholder="you@example.com" value={email} onChange={(event) => setEmail(event.target.value)} disabled={busy} />
        <label className="login-label" htmlFor="forgot-code">验证码</label>
        <div className="login-code-row">
          <input id="forgot-code" className="login-input login-code-input" type="text" inputMode="numeric" autoComplete="one-time-code" maxLength={6} placeholder="000000" value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, ''))} disabled={busy} />
          {puzzle ? <button type="button" className="os-button os-button-quiet login-sendcode" disabled={puzzleBusy} onClick={() => void submitPuzzleAnswer()}>{puzzleBusy ? '验证中…' : '提交答案'}</button>
            : <button type="button" className="os-button os-button-quiet login-sendcode" disabled={busy || cooldown > 0 || !email.trim()} onClick={() => void sendCode()}>{cooldown > 0 ? `${cooldown}s` : '获取验证码'}</button>}
        </div>
        {puzzle ? <div className="puzzle-box"><ShieldCheck size={14} /><span>人机验证：<b>{puzzle.question}</b></span><input className="puzzle-answer" inputMode="numeric" placeholder="输入答案" value={puzzleAnswer} onChange={(event) => setPuzzleAnswer(event.target.value.replace(/[^\d-]/g, ''))} autoFocus /></div> : null}
        <label className="login-label" htmlFor="forgot-password">新密码（至少 8 位，含 3 类字符）</label>
        <div className="login-password-row">
          <input id="forgot-password" className="login-input" type={showPassword ? 'text' : 'password'} autoComplete="new-password" placeholder="设置新密码" value={password} onChange={(event) => setPassword(event.target.value)} disabled={busy} />
          <button type="button" className="login-password-toggle" aria-label={showPassword ? '隐藏密码' : '显示密码'} onClick={() => setShowPassword((value) => !value)}>{showPassword ? <EyeOff size={16} /> : <Eye size={16} />}</button>
        </div>
        {mode === 'forgot' ? <PasswordMeter password={password} /> : null}
        <label className="login-label" htmlFor="forgot-password-confirm">再次输入新密码</label>
        <input id="forgot-password-confirm" className="login-input" type={showPassword ? 'text' : 'password'} autoComplete="new-password" placeholder="再次输入新密码" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} disabled={busy} />
        {confirmPassword && confirmPassword !== password ? <p className="login-error">两次输入的密码不一致</p> : null}
        <button type="submit" className="os-button os-button-primary login-submit" disabled={busy || !email.trim() || code.length !== 6 || password.length < 8 || confirmPassword !== password}>{busy ? <LoaderCircle className="spin" size={15} /> : <Check size={15} />}重置密码并登录</button>
        <div className="login-actions"><button type="button" className="login-link" onClick={() => switchMode('login')}>返回登录</button></div>
      </form>

      {message ? <p className="login-message">{message}</p> : null}
      {error ? <p className="login-error">{error}</p> : null}
      <div className="login-note"><ShieldCheck size={14} /> <span>注册或登录后，当前游客的 App 和余额会自动迁移到你的账号；之后用邮箱 + 密码登录即可。密码要求至少 8 位，包含大小写字母 / 数字 / 符号中的 3 类。</span></div>
    </div>
  </div>
}

/** 横向滑动切换助手（assistant ↔ desktop；忽略纵向滚动，避免与对话列表滚动冲突） */
function useSwipeNavigation(onSwipeLeft: () => void, onSwipeRight: () => void) {
  const startRef = useRef<{ x: number; y: number } | null>(null)
  // 【bug 修复 2026-08-16】代码区/表格/LaTeX 等可横向滚动容器内的滑动是内容
  // 滚动意图，不能触发页面级切页手势（用户反馈：黑色代码区右滑直接切到第二桌面）。
  // 触摸起点落在这些容器内 → 忽略本次手势。
  const isHorizScrollContainer = (target: EventTarget | null): boolean => {
    if (!(target instanceof Element)) return false
    // 【2026-08-22 会话侧栏】侧栏内滑动是列表滚动/遮罩点击关闭意图，不触发切页手势
    if (target.closest?.('.conv-sidebar, .conv-sidebar-backdrop')) return true
    return Boolean(target.closest?.('.md-content pre, .md-table-wrap, .md-latex-block'))
  }
  const onTouchStart = (event: React.TouchEvent): void => {
    if (isHorizScrollContainer(event.target)) {
      startRef.current = null
      return
    }
    startRef.current = { x: event.touches[0].clientX, y: event.touches[0].clientY }
  }
  const onTouchEnd = (event: React.TouchEvent): void => {
    const start = startRef.current
    startRef.current = null
    if (!start) return
    const dx = event.changedTouches[0].clientX - start.x
    const dy = event.changedTouches[0].clientY - start.y
    if (Math.abs(dx) < 64 || Math.abs(dx) < Math.abs(dy) * 1.25) return
    if (dx < 0) onSwipeLeft()
    else onSwipeRight()
  }
  return { onTouchStart, onTouchEnd }
}

const WEBOS_TOOL_LABELS: Record<string, string> = {
  update_webos_app: '修改 App',
  delete_webos_app: '删除 App',
  list_webos_apps: '读取 App 列表',
  agent_fs_list: '查看工作区',
  agent_fs_read: '读取工作区文件',
  agent_fs_write: '写入工作区文件',
  agent_fs_mkdir: '创建工作区目录',
  agent_fs_delete: '删除工作区文件',
  agent_fs_stat: '查看文件信息',
  agent_fs_search: '搜索工作区文件',
  agent_fs_grep: '搜索工作区内容',
  agent_fs_edit: '修改工作区文件',
  agent_src_list: '查看源码目录',
  agent_src_read: '读取系统源码',
  read: '读取文件/Skill',
  manage_skill: '管理 Skill',
  generate_image: '生成图片',
  edit_image: '编辑图片',
  show_interactive_html: '插入互动内容',
  set_display_name: '设置称呼',
}
function toolLabel(tool: string): string {
  return WEBOS_TOOL_LABELS[tool] ?? tool
}

/** 按钮内反馈（2026-08-03）：点击后按钮短暂显示「✓ 文案」，替代底部 toast 弹窗 */
function useButtonFeedback(resetMs = 1600): [string | null, (label?: string) => void] {
  const [feedback, setFeedback] = useState<string | null>(null)
  const timerRef = useRef<number | null>(null)
  const trigger = (label?: string): void => {
    setFeedback(label ?? '已复制')
    if (timerRef.current) window.clearTimeout(timerRef.current)
    timerRef.current = window.setTimeout(() => setFeedback(null), resetMs)
  }
  return [feedback, trigger]
}

/** 2026-08-06 工具执行状态：稳定展示执行状态，不进行高频数字闪烁 */
function ToolRunningStatus({ done, ok }: { done?: boolean; ok?: boolean; progress?: string }) {
  if (done) return <span className="tool-status">{ok ? '完成' : '失败'}</span>
  return <span className="tool-status">执行中…</span>
}

// 2026-08-11：后台任务进度卡片机制已整体删除——任务思考/工具/输出过程一律
// 渲染到对话消息气泡（信息流无缝衔接），不再有独立的"上一条消息仍在后台处理"
// 卡片（用户反馈：一个任务被拆成多个气泡/卡片展示，破坏无缝体验）。

// 2026-08-08 结构性优化：memo 化消息气泡——流式期间只有最后一条 assistant 消息
// 的引用变化（前面的 slice 保持引用稳定），配合 memo 避免每次 SSE 事件全量重渲染
// 所有历史消息（2 万+ 事件 × 全量渲染 = 移动端 WebView 卡退）。
const MessageBubble = memo(function MessageBubble({ message, messageIndex, isLast, onAvatarClick }: { message: UiChatMessage; messageIndex: number; isLast?: boolean; onAvatarClick?: () => void }) {
  const streaming = useShellStore((state) => state.streaming)
  const session = useShellStore((state) => state.session)
  const avatar = useShellStore((state) => state.avatar)
  const copyMessageAt = useShellStore((state) => state.copyMessageAt)
  const editMessageAt = useShellStore((state) => state.editMessageAt)
  const regenerateAt = useShellStore((state) => state.regenerateAt)
  // 复制按钮内反馈：消息复制 / 错误卡片复制共用（按 segment index 区分）
  const [copyStatus, setCopyStatus] = useState<'idle' | 'done' | 'failed'>('idle')
  const [errorCopyStatus, setErrorCopyStatus] = useState<{ index: number; status: 'done' | 'failed' } | null>(null)
  const copyTimerRef = useRef<number | null>(null)
  const flashCopy = (status: 'done' | 'failed'): void => {
    setCopyStatus(status)
    setErrorCopyStatus(null)
    if (copyTimerRef.current) window.clearTimeout(copyTimerRef.current)
    copyTimerRef.current = window.setTimeout(() => setCopyStatus('idle'), 1600)
  }
  const flashErrorCopy = (index: number, status: 'done' | 'failed'): void => {
    setErrorCopyStatus({ index, status })
    setCopyStatus('idle')
    if (copyTimerRef.current) window.clearTimeout(copyTimerRef.current)
    copyTimerRef.current = window.setTimeout(() => setErrorCopyStatus(null), 1600)
  }
  // 思考过程折叠状态：按 segment index 独立（2026-08-03 修复"点一个全部联动"）
  const [thinkingOpen, setThinkingOpen] = useState<Record<number, boolean>>({})
  // 工具调用折叠（2026-08-04）：连续工具段归组，组内全部完成且后面还有文字时折叠
  const [toolGroupOpen, setToolGroupOpen] = useState<Record<number, boolean>>({})
  // 生图大图查看（点击生成的图片 → 全屏查看 + 下载）
  const [lightbox, setLightbox] = useState<string | null>(null)
  // 编辑模式（2026-08-05 多会话：修改消息后回退重来）
  const [editing, setEditing] = useState(false)
  const [editValue, setEditValue] = useState('')
  const userLabel = session && !session.guest ? (session.user.username?.trim() || '我') : '我'

  const startEdit = (): void => {
    if (message.role !== 'user') return
    setEditValue(message.content)
    setEditing(true)
  }
  const saveEdit = (): void => {
    if (!editValue.trim()) return
    setEditing(false)
    void editMessageAt(messageIndex, editValue)
  }
  const cancelEdit = (): void => setEditing(false)
  const doCopy = (): void => {
    void copyMessageAt(messageIndex).then((ok) => { flashCopy(ok ? 'done' : 'failed') })
  }
  const doRegenerate = (): void => {
    if (window.confirm('回退重来：此消息及其之后的内容将被删除，AI 会基于前面的对话重新生成。')) {
      void regenerateAt(messageIndex)
    }
  }

  // 消息操作条：复制 / 编辑（仅用户消息）/ 回退重来
  // 流式生成中的消息（最后一条且正在输出）不显示操作条——生成中不可操作，
  // 避免"复制/回退重来"出现在还在生成的 AI 回复下方，等生成完成再出现。
  const streamingNow = Boolean(isLast && streaming)
  const actions = streamingNow ? null : <div className="chat-actions">
    <button type="button" className={`chat-action ${copyStatus === 'done' ? 'chat-action-done' : copyStatus === 'failed' ? 'chat-action-fail' : ''}`} onClick={doCopy} aria-label="复制消息">{copyStatus === 'done' ? <Check size={12} /> : <Copy size={12} />}<span>{copyStatus === 'done' ? '已复制' : copyStatus === 'failed' ? '复制失败' : '复制'}</span></button>
    {message.role === 'user' && !editing
      ? <button type="button" className="chat-action" onClick={startEdit} aria-label="编辑消息"><Pencil size={12} /><span>编辑</span></button>
      : null}
    <button type="button" className="chat-action" onClick={doRegenerate} aria-label="回退重来"><RotateCcw size={12} /><span>回退重来</span></button>
  </div>

  // 用户消息：平铺右对齐，名称=称呼，头像可点击更换；支持编辑（textarea）后回退重来
  // 2026-08-22：长按菜单仅对 AI 消息开放（用户消息不弹菜单）
  if (message.role === 'user') {
    return <div className="chat-row user-row"><div className="chat-body user-body"><div className="chat-name">{userLabel}</div>{editing
      ? <div className="chat-edit"><textarea autoFocus value={editValue} onChange={(event) => setEditValue(event.target.value)} rows={3} aria-label="编辑消息内容" /><div className="chat-edit-actions"><button type="button" className="chat-edit-cancel" onClick={cancelEdit}>取消</button><button type="button" className="chat-edit-save" onClick={saveEdit} disabled={!editValue.trim()}>发送修改</button></div></div>
      : <div className="chat-text"><UserMessageContent text={message.content} /></div>}{actions}</div><button type="button" className="chat-avatar user-avatar user-avatar-btn" onClick={onAvatarClick} aria-label="更换头像">{avatar ? <img src={`data:${avatar.mime};base64,${avatar.base64}`} alt="头像" /> : <span>{userLabel.slice(0, 1).toUpperCase()}</span>}</button></div>
  }
  // AI 消息：一个回合 = 一条消息，内部按时间顺序分段（文字/工具调用连贯展示，不另起头像）
  const segments = 'segments' in message
    ? message.segments
    : (message.content ? [{ type: 'text' as const, content: message.content }] : [])
  const legacyTools = 'toolCalls' in message
    ? (message.toolCalls ?? (message.toolCall ? [message.toolCall] : []))
    : []
  return <div className="chat-row ai-row">
    <div className="chat-avatar ai-avatar"><LogoMark className="ai-avatar-mark" /></div>
    <div className="chat-body">
      <div className="chat-name">Daily AI</div>
      {(() => {
        // 工具折叠（2026-08-04）：连续的 tool 段归为一组；组内全部完成且组后还有
        // 文字时折叠为一行「使用了 N 个工具」，点击展开明细。
        type RenderItem = { kind: 'segment'; segment: UiSegment; index: number } | { kind: 'toolGroup'; group: UiSegment[]; indices: number[]; hasFollowingText: boolean }
        const renderItems: RenderItem[] = []
        for (let i = 0; i < segments.length; i += 1) {
          const segment = segments[i]!
          if (segment.type !== 'tool') {
            renderItems.push({ kind: 'segment', segment, index: i })
            continue
          }
          const group: UiSegment[] = [segment]
          const indices = [i]
          while (i + 1 < segments.length && segments[i + 1]!.type === 'tool') {
            i += 1
            group.push(segments[i]!)
            indices.push(i)
          }
          let hasFollowingText = false
          for (let j = i + 1; j < segments.length; j += 1) {
            const s = segments[j]!
            if (s.type === 'text' || s.type === 'html') { hasFollowingText = true; break }
          }
          renderItems.push({ kind: 'toolGroup', group, indices, hasFollowingText })
        }
        let groupSeq = 0
        // 2026-08-06 字数跟随：统计「最后一个 text 段」而非「最后一段」——
        // 工具调用期间正文段会被 tool 段挤到非末尾，此前 stream-count 因此消失
        // （用户反馈"跳动的数字没多久就停下来"）。现在工具执行中字数保持跟随
        // AI 实际输出（新 delta 到来时继续累计），完成（streaming=false）后消失。
        let lastTextIndex = -1
        for (let i = 0; i < segments.length; i += 1) {
          if (segments[i]!.type === 'text') lastTextIndex = i
        }
        return renderItems.map((item) => {
          if (item.kind === 'segment') {
            const { segment, index } = item
            if (segment.type === 'thinking') {
              const thoughtChars = segment.content.length
              const thinkingNow = isLast && streaming && index === segments.length - 1
              // 2026-08-11：恢复渲染（非流式）时，最后一条消息的 thinking 段默认
              // 展开（无论是否最后一段）——刷新后任务继续跑，思考内容持续可见
              // （此前折叠成"已思考 N 字"一行，用户看不到内容在增长，误以为
              // "没继续渲染"）。用户手动折叠过（thinkingOpen 有值）则尊重用户。
              const lastThinkingAutoOpen = isLast && thinkingOpen[index] === undefined
              const open = thinkingNow ? true : (lastThinkingAutoOpen ? true : Boolean(thinkingOpen[index]))
              return <div className="thinking-block" key={index}><button type="button" className="thinking-toggle" onClick={() => setThinkingOpen((prev) => ({ ...prev, [index]: !open }))}>{open ? (thinkingNow ? `思考中 · ${thoughtChars} 字` : `思考 · ${thoughtChars} 字`) : `已思考 ${thoughtChars} 字`}</button>{open ? <pre className="thinking-text">{segment.content}</pre> : null}</div>
            }
            if (segment.type === 'text') {
              const generating = isLast && streaming && index === lastTextIndex
              return <div className="chat-text" key={index}>{generating ? <ThrottledMarkdown text={segment.content} streaming /> : <MarkdownContent text={segment.content} />}</div>
            }
            if (segment.type === 'html') {
              return <div className="chat-html-widget" key={index} style={{ height: segment.heightPx ?? 280 }}>
                <iframe className="chat-html-frame" sandbox="allow-scripts" srcDoc={withRuntimeBootstrap(segment.html)} title="互动内容" />
              </div>
            }
            if (segment.type === 'notice') {
              // 2026-08-06 等待提示（会话忙排队）：灰色等待条，非错误
              return <div className="chat-notice" key={index}><LoaderCircle className="spin" size={12} /><span>{segment.content}</span></div>
            }
            if (segment.type === 'error') {
              const errorCopy = errorCopyStatus?.index === index ? errorCopyStatus.status : null
              return <div className="chat-error" key={index}>
                <span className="chat-error-icon"><AlertCircle size={14} /></span>
                <div className="chat-error-body"><strong>出错了</strong><pre>{segment.content}</pre></div>
                <button type="button" className={`chat-error-copy ${errorCopy === 'done' ? 'chat-action-done' : errorCopy === 'failed' ? 'chat-error-copy-fail' : ''}`} aria-label="复制错误信息" onClick={() => { void copyTextToClipboard(segment.content).then((ok) => flashErrorCopy(index, ok ? 'done' : 'failed')) }}>{errorCopy === 'done' ? <Check size={11} /> : <Copy size={11} />}{errorCopy === 'done' ? '已复制' : errorCopy === 'failed' ? '复制失败' : '复制'}</button>
              </div>
            }
            return null
          }
          const { group, indices, hasFollowingText } = item
          const gi = groupSeq
          groupSeq += 1
          const allDone = group.every((s) => s.type === 'tool' && s.done === true)
          const collapsible = allDone && hasFollowingText
          const open = collapsible ? Boolean(toolGroupOpen[gi]) : true
          const names = group.map((s) => (s.type === 'tool' ? toolLabel(s.tool) : '')).filter(Boolean)
          if (!open) {
            return <div key={`tg-${indices[0]}`} className="tool-group tool-group-collapsed">
              <button type="button" className="tool-group-toggle" onClick={() => setToolGroupOpen((prev) => ({ ...prev, [gi]: true }))}><ChevronRight size={12} /><span>使用了 {group.length} 个工具{names.length > 0 ? `（${names.slice(0, 3).join('、')}${names.length > 3 ? '等' : ''}）` : ''}</span></button>
            </div>
          }
          return <div key={`tg-${indices[0]}`} className="tool-group">
            {collapsible ? <button type="button" className="tool-group-toggle tool-group-collapse-btn" onClick={() => setToolGroupOpen((prev) => ({ ...prev, [gi]: false }))}><ChevronDown size={12} /><span>收起工具</span></button> : null}
            {group.map((rawSegment, gi2) => {
              const index = indices[gi2]!
              const toolSegment = rawSegment as Extract<UiSegment, { type: 'tool' }>
              return <div key={`tool-${index}`} className="tool-group-item">
                <div className={`tool-chip ${toolSegment.done ? (toolSegment.ok ? 'tool-ok' : 'tool-fail') : 'tool-running'}`}><span className="tool-icon">{toolSegment.done ? (toolSegment.ok ? <Check size={12} /> : <X size={12} />) : <LoaderCircle className="spin" size={12} />}</span><span className="tool-name">{toolLabel(toolSegment.tool)}</span><ToolRunningStatus done={toolSegment.done} ok={toolSegment.ok} progress={toolSegment.progress} /></div>
                {/* 2026-08-07 工具执行过程实时进度（tool_update 增量）：长工具执行期间逐段展示推进情况。
                2026-08-11 参数生成进度（纯数字）已融合进 chip 内显示「↓ N」，这里不再重复渲染；
                仅保留非纯数字的文本进度（生图逐张/批量处理等） */}
                {toolSegment.progress && !toolSegment.done && !/^\d+$/.test(toolSegment.progress) ? (
                  <pre className="tool-progress">{toolSegment.progress}</pre>
                ) : null}
                {toolSegment.images && toolSegment.images.length > 0 ? <div className="tool-images">
                  {toolSegment.images.map((url, imgIdx) => (
                    <div key={imgIdx} className="tool-image">
                      {/* 2026-08-05 低带宽：列表用 ?w=640 webp 缩略图，点开 Lightbox 看原图 */}
                      <button type="button" className="tool-image-main" onClick={() => setLightbox(url)} aria-label={`查看图片 ${imgIdx + 1}`}><img src={thumbUrl(url, 640)} alt={`生成的图片 ${imgIdx + 1}`} loading="lazy" /></button>
                      <a className="tool-image-download" href={url} download target="_blank" rel="noreferrer"><Download size={11} />下载</a>
                    </div>
                  ))}
                </div> : null}
                {/* 2026-08-05 视频生成成功：工具下方渲染 <video>（可播放/下载） */}
                {toolSegment.videos && toolSegment.videos.length > 0 ? <div className="tool-videos">
                  {toolSegment.videos.map((url, vidIdx) => (
                    <div key={vidIdx} className="tool-video">
                      {/* 2026-08-06 低带宽：poster 首帧封面（video-xxx.mp4 → video-xxx.jpg）秒开预览 */}
                      <video src={url} poster={url.replace(/\.mp4$/, '.jpg')} controls preload="metadata" playsInline />
                      <a className="tool-video-download" href={url} download target="_blank" rel="noreferrer"><Download size={11} />下载视频</a>
                    </div>
                  ))}
                </div> : null}
              </div>
            })}
          </div>
        })
      })()}
      {legacyTools.map((tool, index) => <div key={`legacy-${index}`} className={`tool-chip ${tool.done ? (tool.ok ? 'tool-ok' : 'tool-fail') : 'tool-running'}`}><span className="tool-icon">{tool.done ? (tool.ok ? <Check size={12} /> : <X size={12} />) : <LoaderCircle className="spin" size={12} />}</span><span className="tool-name">{toolLabel(tool.tool)}</span><span className="tool-status">{tool.done ? (tool.ok ? '完成' : '失败') : '进行中…'}</span></div>)}
      {segments.length === 0 && legacyTools.length === 0 ? <span className="ai-typing"><span className="typing-dots"><i /><i /><i /></span><em>正在思考…</em></span> : null}
      {lightbox ? <div className="image-lightbox" onClick={() => setLightbox(null)} role="dialog" aria-modal="true"><img src={lightbox} alt="生成图片大图" onClick={(event) => event.stopPropagation()} /><div className="image-lightbox-actions"><a className="os-button os-button-primary" href={lightbox} download target="_blank" rel="noreferrer"><Download size={14} />下载原图</a><button type="button" className="os-button os-button-quiet" onClick={() => setLightbox(null)}>关闭</button></div></div> : null}
      {actions}
    </div>
  </div>
}, (prev, next) => prev.message === next.message && prev.isLast === next.isLast && prev.messageIndex === next.messageIndex)

/** 会话侧边栏（2026-08-05 多会话）：新建/切换/重命名/删除会话，显示每会话 token 统计 */
function ChatSidebar({ open, onClose }: { open: boolean; onClose: () => void }) {
  const conversations = useShellStore((state) => state.conversations)
  const activeConversationId = useShellStore((state) => state.activeConversationId)
  const streamingConvs = useShellStore((state) => state.streamingConvs)
  const guest = useShellStore((state) => state.guest)
  const billing = useShellStore((state) => state.billing)
  const createConversation = useShellStore((state) => state.createConversation)
  const switchConversation = useShellStore((state) => state.switchConversation)
  const renameConversation = useShellStore((state) => state.renameConversation)
  const deleteConversation = useShellStore((state) => state.deleteConversation)

  const onCreate = (): void => {
    createConversation()
    onClose()
  }
  const onRename = (conv: ChatConversation): void => {
    const name = window.prompt('重命名会话', conv.title)
    if (name !== null) renameConversation(conv.id, name)
  }
  const onDelete = (conv: ChatConversation): void => {
    // 删除后列表即时更新即为反馈，不弹全局通知
    if (window.confirm(`删除会话「${conv.title}」？其中的对话记录将无法恢复。`)) {
      deleteConversation(conv.id)
    }
  }
  // 按时间分组：今天 / 昨天 / 更早
  const grouped: Array<{ label: string; items: ChatConversation[] }> = []
  const todayStart = new Date()
  todayStart.setHours(0, 0, 0, 0)
  const yesterdayStart = todayStart.getTime() - 86_400_000
  for (const conv of [...conversations].sort((a, b) => b.updatedAt - a.updatedAt)) {
    const label = conv.updatedAt >= todayStart.getTime() ? '今天' : conv.updatedAt >= yesterdayStart ? '昨天' : '更早'
    const bucket = grouped.find((group) => group.label === label)
    if (bucket) bucket.items.push(conv)
    else grouped.push({ label, items: [conv] })
  }

  return <div className={`conv-sidebar-layer ${open ? 'conv-sidebar-open' : ''}`} role="dialog" aria-label="会话列表">
    <div className="conv-sidebar-backdrop" onClick={onClose} aria-hidden="true" />
    <aside className="conv-sidebar">
      <div className="conv-sidebar-head">
        <strong>会话</strong>
        <button type="button" className="conv-new-button" onClick={onCreate}><Plus size={13} /> 新建</button>
      </div>
      <div className="conv-sidebar-list">
        {grouped.length === 0
          ? <div className="conv-sidebar-empty"><MessageSquareText size={17} /><p>还没有会话<br />点右上角「新建」开始</p></div>
          : grouped.map((group) => <div className="conv-group" key={group.label}>
            <div className="conv-group-label">{group.label}</div>
            {group.items.map((conv) => {
              const isActive = conv.id === activeConversationId
              const isStreaming = Boolean(streamingConvs[conv.id])
              return <div key={conv.id} className={`conv-item ${isActive ? 'conv-item-active' : ''}`} onClick={() => { switchConversation(conv.id); onClose() }}>
                <div className="conv-item-main">
                  <div className="conv-item-title">{conv.title || '新会话'}{isStreaming ? <span className="conv-item-streaming"><LoaderCircle className="spin" size={9} />生成中</span> : null}</div>
                  <div className="conv-item-meta">
                    <span>{conversationTime(conv.updatedAt)}</span>
                    {conv.usedTokens > 0 ? <span className="conv-item-tokens">{formatTokens(conv.usedTokens)}</span> : null}
                  </div>
                </div>
                <div className="conv-item-ops" onClick={(event) => event.stopPropagation()}>
                  <button type="button" className="conv-item-op" aria-label="重命名会话" onClick={() => onRename(conv)}><Pencil size={11} /></button>
                  <button type="button" className="conv-item-op conv-item-op-danger" aria-label="删除会话" onClick={() => onDelete(conv)}><Trash2 size={11} /></button>
                </div>
              </div>
            })}
          </div>)}
        </div>
      <div className="conv-sidebar-foot">
        <div className="conv-sidebar-balance"><CircleDollarSign size={12} /><span>剩余 <strong>{formatCredits(totalRemainingCredits(guest))}</strong> 积分</span></div>
        <div className="conv-sidebar-hint">会话独立上下文 · 可并行对话</div>
      </div>
    </aside>
  </div>
}

function conversationTime(timestamp: number): string {
  const date = new Date(timestamp)
  const now = new Date()
  if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
  }
  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  if (date.toDateString() === yesterday.toDateString()) return '昨天'
  return date.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })
}

/** 头像更换面板（2026-08-03）：点击对话中自己的头像打开；上传图片或让 AI 帮忙换 */
function AvatarEditPanel({ onClose }: { onClose: () => void }) {
  const session = useShellStore((state) => state.session)
  const avatar = useShellStore((state) => state.avatar)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement | null>(null)
  const loggedIn = session && !session.guest
  const userLabel = loggedIn ? (session.user.username?.trim() || '我') : '我'

  const onPick = async (files: FileList | null): Promise<void> => {
    if (!files || files.length === 0) return
    const file = files[0]
    const ext = (file.name.split('.').pop() ?? '').toLowerCase()
    if (!['png', 'jpg', 'jpeg', 'svg', 'webp'].includes(ext)) {
      setError('头像仅支持 png / jpg / svg / webp 图片')
      return
    }
    if (file.size > 2 * 1024 * 1024) {
      setError('头像图片最大 2MB')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const base64 = await blobToBase64(file)
      await uploadAvatar(base64, ext)
      await useShellStore.getState().refreshBootstrap()
      // 按钮内反馈「✓ 已更新」后自动关闭（不弹底部 toast）
      setDone(true)
      window.setTimeout(onClose, 900)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '头像上传失败，请重试')
    } finally {
      setBusy(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  return <div className="login-overlay" onClick={onClose}>
    <div className="login-panel avatar-panel" onClick={(event) => event.stopPropagation()}>
      <div className="login-heading"><span className="login-mark"><UserRound size={15} /></span><div><strong>我的头像</strong><small>对话中显示在消息旁边</small></div><button type="button" className="login-close" aria-label="关闭" onClick={onClose}><X size={16} /></button></div>
      <div className="avatar-preview">{avatar ? <img src={`data:${avatar.mime};base64,${avatar.base64}`} alt="当前头像" /> : <span>{userLabel.slice(0, 1).toUpperCase()}</span>}</div>
      <p className="muted-copy avatar-copy">当前显示{avatar ? '自定义头像' : `首字母「${userLabel.slice(0, 1).toUpperCase()}」`}。上传一张图片作为你的头像，AI 也会记住它。</p>
      <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/svg+xml,image/webp" hidden onChange={(event) => void onPick(event.target.files)} />
      {loggedIn
        ? <button type="button" className={`os-button os-button-primary login-submit ${done ? 'os-button-done' : ''}`} disabled={busy || done} onClick={() => fileRef.current?.click()}>{done ? <Check size={15} /> : busy ? <LoaderCircle className="spin" size={15} /> : <Upload size={15} />} {done ? '已更新' : busy ? '上传中…' : '上传新头像'}</button>
        : <button type="button" className="os-button os-button-primary login-submit" onClick={onClose}><KeyRound size={15} /> 登录后设置头像</button>}
      <p className="login-note"><Sparkles size={14} /> 也可以直接对 AI 说「给我换个头像」，它会为你设计一个。</p>
      {error ? <p className="login-error">{error}</p> : null}
    </div>
  </div>
}

function AssistantHome({ onOpenLogin }: { onOpenLogin: () => void }) {
  const messages = useShellStore((state) => state.messages)
  const draft = useShellStore((state) => state.draft)
  const streaming = useShellStore((state) => state.streaming)
  const session = useShellStore((state) => state.session)
  const guest = useShellStore((state) => state.guest)
  const setDraft = useShellStore((state) => state.setDraft)
  const sendMessage = useShellStore((state) => state.sendMessage)
  const stopStreaming = useShellStore((state) => state.stopStreaming)
  // 【bug 修复 2026-08-16】新建对话入口太深（齿轮→会话列表→新建）；把
  // createConversation 提到 AssistantHome，供 composer 加号旁的新建按钮直接调用。
  const createConversation = useShellStore((state) => state.createConversation)

  // 2026-08-06 互动 HTML 提问回传：AI 通过 show_interactive_html 展示的提问框内
  // 点击答案 → iframe postMessage({channel:'daily-webos-sdk',kind:'event',
  // payload:{type:'interactive_answer',value:'...'}}) → 宿主把答案作为用户消息
  // 发给 AI（问答闭环）。只接受对话内互动 HTML iframe 的消息。
  useEffect(() => {
    const onMessage = (event: MessageEvent<unknown>): void => {
      const data = event.data as { channel?: string; kind?: string; payload?: { type?: string; value?: unknown } } | null
      if (!data || data.channel !== 'daily-webos-sdk' || data.kind !== 'event' || data.payload?.type !== 'interactive_answer') return
      const frames = [...document.querySelectorAll<HTMLIFrameElement>('.chat-html-frame')]
      if (!frames.some((frame) => frame.contentWindow === event.source)) return
      const value = String(data.payload.value ?? '').slice(0, 2000)
      if (!value.trim()) return
      // 2026-08-08 系统级协议校验（根治"消息被发送两次"）：
      // 互动 HTML 的 interactive_answer 回传值 = 选项标识（如"方向一"），
      // 协议上严禁回传用户消息原文。AI 生成的面板若把原始需求当 value 回传
      // （实测发生），宿主在此强制校验并拒绝——就像工具参数 schema 校验一样，
      // 不依赖 AI 自觉。拒绝时回传 error 给 iframe（面板可感知）+ 引导用户
      // 直接输入简短选项，对话不卡死、不重复发送、不重复扣费。
      const shellState = useShellStore.getState()
      const convNow = shellState.conversations.find((candidate) => candidate.id === shellState.activeConversationId)
      const lastUserMsg = [...(convNow?.messages ?? [])].reverse().find((m) => m.role === 'user')
      if (lastUserMsg && lastUserMsg.role === 'user' && lastUserMsg.content.trim()
        && (value === lastUserMsg.content || value.startsWith(lastUserMsg.content.slice(0, 20)))) {
        console.warn('[chat] interactive answer violates protocol (value == user message), rejected')
        try {
          const sourceFrame = frames.find((frame) => frame.contentWindow === event.source)
          sourceFrame?.contentWindow?.postMessage({
            channel: 'daily-webos-sdk',
            kind: 'event',
            payload: { type: 'interactive_answer_error', message: '选项回传内容异常（不能是整段消息原文）。请直接输入选项名称，例如「方向一」。' },
          }, '*')
        } catch { /* 面板不可达忽略 */ }
        useShellStore.getState().setNotice('互动面板回传异常：请直接输入你的选择（如「方向一」）')
        return
      }
      void sendMessage(value)
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [sendMessage])
  const setView = useShellStore((state) => state.setView)
  const setNotice = useShellStore((state) => state.setNotice)
  const setError = useShellStore((state) => state.setError)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const nearBottomRef = useRef(true)
  // 输入框自适应高度（2026-08-03）：输入多行时自动长高；【bug 修复 2026-08-16】
  // 上限从 160px 放宽到 min(45vh, 320px)——用户反馈输入大量文字时看不到已输入
  // 内容、难以操作（160px 硬上限 + WebView 滚动条不明显）。
  const COMPOSER_MAX_HEIGHT = 320
  const composerRef = useRef<HTMLTextAreaElement | null>(null)
  const resizeComposer = (): void => {
    const el = composerRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(Math.max(el.scrollHeight, 44), Math.min(window.innerHeight * 0.45, COMPOSER_MAX_HEIGHT))}px`
  }
  // 【bug 修复 2026-08-16】draft 变化（切换会话/恢复草稿/点击建议词等程序化设置）
  // 时重新计算输入框高度——此前只在 onChange 调用 resizeComposer，程序化设置
  // draft 后输入框保持旧高度。
  useEffect(() => {
    resizeComposer()
  }, [draft])
  const [showHtmlImport, setShowHtmlImport] = useState(false)
  // 发送框 ➕ 弹出面板（上传文件 / 粘贴 HTML / 思考档 / 分享整套系统）
  const [composerMenu, setComposerMenu] = useState(false)
  // 2026-08-16 识图链路：粘贴/拖拽图片的待发送附件（发送时转成 Markdown data URI）
  const [pastedImages, setPastedImages] = useState<PendingImage[]>([])
  // 2026-08-07 整套系统分享：打包 加载页+桌面+全部 App 生成链接（与发布到商店不同）
  const [shareBusy, setShareBusy] = useState(false)
  const [shareDone, setShareDone] = useState(false)
  const shareDoneTimerRef = useRef<number | null>(null)
  const onShareSystem = async (): Promise<void> => {
    if (shareBusy) return
    setShareBusy(true)
    setShareDone(false)
    try {
      const result = await createSystemShare()
      const fullUrl = `${window.location.origin}${result.url}`
      const copied = await copyTextToClipboard(fullUrl)
      setShareDone(true)
      setComposerMenu(false)
      setNotice(copied ? '分享链接已复制：别人打开即可体验你的整套系统' : `分享链接：${fullUrl}`)
      if (shareDoneTimerRef.current) window.clearTimeout(shareDoneTimerRef.current)
      shareDoneTimerRef.current = window.setTimeout(() => setShareDone(false), 2000)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '分享失败，请稍后重试')
    } finally {
      setShareBusy(false)
    }
  }
  const [uploading, setUploading] = useState(false)
  const [uploadDone, setUploadDone] = useState<number | null>(null)
  const [uploadFailed, setUploadFailed] = useState(false)
  const uploadDoneTimerRef = useRef<number | null>(null)
  const uploadInputRef = useRef<HTMLInputElement | null>(null)
  // 2026-08-21 图片到对话（移动端友好）：输入框旁「图片」按钮 → 相册/拍照 →
  // 复用压缩 data URI 附件（游客可用，一次性看图不落盘）
  const imageInputRef = useRef<HTMLInputElement | null>(null)
  // 头像更换面板（点击用户消息头像打开）
  const [avatarPanel, setAvatarPanel] = useState(false)
  // 多会话：会话侧边栏（2026-08-05）
  const [convSidebar, setConvSidebar] = useState(false)
  const conversations = useShellStore((state) => state.conversations)
  const activeConversationId = useShellStore((state) => state.activeConversationId)
  const currentConv = conversations.find((conv) => conv.id === activeConversationId)

  // ➕ 面板：上传文件到工作区 home/uploads/（AI 可直接读取；游客不支持上传）
  // 反馈显示在按钮内（上传中→✓已上传 N 个→自动收起），不弹底部 toast
  const onUploadFiles = async (files: FileList | null): Promise<void> => {
    if (!files || files.length === 0) return
    if (!session || session.guest) {
      setComposerMenu(false)
      onOpenLogin()
      return
    }
    if (uploading) return
    setUploading(true)
    setUploadDone(null)
    setUploadFailed(false)
    try {
      let uploaded = 0
      let lastEntry: WebOsWorkspaceEntry | null = null
      for (const file of Array.from(files)) {
        // 2026-08-13 大文件（>20MB）走分片上传（8MB/片，断点续传）；小文件走单请求
        // 2026-08-21 保留返回的 file（含 publicUrl，图片的免鉴权公开链接）
        const result = file.size > 20 * 1024 * 1024
          ? await uploadWorkspaceFileLarge(file.name, file, 'uploads')
          : await uploadWorkspaceFile(file.name, await blobToBase64(file), 'uploads')
        lastEntry = result.file
        uploaded += 1
      }
      setUploadDone(uploaded)
      // 2026-08-21 反馈：提示落盘位置 + 图片公开链接（此前只给相对路径，图片功能无法直接访问）
      const fileName = lastEntry?.name ?? (Array.from(files)[0]?.name ?? '')
      const publicUrl = lastEntry?.publicUrl ?? ''
      setNotice(publicUrl
        ? `已上传 ${uploaded} 个文件到 home/uploads/${fileName}（图片已生成公开链接，App / 生成图参考可直接使用）`
        : `已上传 ${uploaded} 个文件到 home/uploads/${fileName}（AI 可直接读取；${files.length > 1 ? '共 ' + uploaded + ' 个' : ''}）`)
      if (uploadDoneTimerRef.current) window.clearTimeout(uploadDoneTimerRef.current)
      uploadDoneTimerRef.current = window.setTimeout(() => { setUploadDone(null); setComposerMenu(false) }, 1600)
    } catch (caught) {
      setUploadFailed(true)
      if (uploadDoneTimerRef.current) window.clearTimeout(uploadDoneTimerRef.current)
      uploadDoneTimerRef.current = window.setTimeout(() => setUploadFailed(false), 1600)
    } finally {
      setUploading(false)
      if (uploadInputRef.current) uploadInputRef.current.value = ''
    }
  }

  // 2026-08-16 识图链路：粘贴/拖拽图片 → 压缩 data URI 附件
  const addImageFiles = async (files: Iterable<File>): Promise<void> => {
    const candidates = Array.from(files).filter(isSupportedImageFile)
    if (candidates.length === 0) return
    const room = MAX_PASTED_IMAGES - pastedImages.length
    if (room <= 0) {
      setNotice(`最多同时发送 ${MAX_PASTED_IMAGES} 张图片`)
      return
    }
    const items: PendingImage[] = []
    for (const file of candidates.slice(0, room)) {
      try {
        const dataUrl = await compressPastedImage(file)
        items.push({ id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, name: file.name, dataUrl })
      } catch {
        // 单张图片解码/压缩失败时跳过，不阻断其他图片
      }
    }
    if (items.length > 0) setPastedImages((prev) => [...prev, ...items].slice(0, MAX_PASTED_IMAGES))
  }
  const removePastedImage = (id: string): void => {
    setPastedImages((prev) => prev.filter((image) => image.id !== id))
  }
  const handleComposerPaste = (event: React.ClipboardEvent<HTMLTextAreaElement>): void => {
    // 2026-08-21 修复：部分环境（Android WebView、部分桌面浏览器）clipboardData.files
    // 为空，但图片以 clipboardData.items + getAsFile() 可读。若只读 files 会漏判，
    // 导致浏览器默认把 base64 纯文本插入 textarea → 输入框爆掉 → AI 请求失败。
    const files = Array.from(event.clipboardData?.files ?? [])
    const itemFiles = Array.from(event.clipboardData?.items ?? [])
      .map((item) => item.getAsFile())
      .filter((f): f is File => f !== null)
    const allFiles = [...files, ...itemFiles]
    let text = ''
    try { text = event.clipboardData?.getData('text/plain') ?? '' } catch { /* 部分环境禁止读取剪贴板文本 */ }
    const textImageUrls = extractPastedImageDataUrls(text)
    if (allFiles.some(isSupportedImageFile) || textImageUrls.length > 0) {
      // 阻止默认行为：不让图片 base64 文本落进 textarea
      event.preventDefault()
      if (allFiles.some(isSupportedImageFile)) {
        void addImageFiles(allFiles)
      } else if (textImageUrls.length > 0) {
        // 图片以 data:image base64 文本进入剪贴板：转成附件（压缩后入队）
        void (async () => {
          const room = MAX_PASTED_IMAGES - pastedImages.length
          if (room <= 0) { setNotice(`最多同时发送 ${MAX_PASTED_IMAGES} 张图片`); return }
          const items: PendingImage[] = []
          for (const url of textImageUrls.slice(0, room)) {
            try {
              const keepAlpha = /^data:image\/(png|webp);base64,/i.test(url)
              const compressed = await compressImageDataUrl(url, keepAlpha)
              items.push({ id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, name: 'pasted.png', dataUrl: compressed })
            } catch { /* 单张失败跳过 */ }
          }
          if (items.length > 0) setPastedImages((prev) => [...prev, ...items].slice(0, MAX_PASTED_IMAGES))
        })()
      }
    }
  }
  const handleComposerDrop = (event: React.DragEvent<HTMLFormElement>): void => {
    // 2026-08-21 修复：与 handleComposerPaste 同理，部分环境 dataTransfer.files 为空
    // 但 items 可读，需从 items + getAsFile() 补捞图片，避免 base64 文本落进输入框。
    const files = Array.from(event.dataTransfer?.files ?? [])
    const itemFiles = Array.from(event.dataTransfer?.items ?? [])
      .map((item) => item.getAsFile())
      .filter((f): f is File => f !== null)
    const allFiles = [...files, ...itemFiles]
    let text = ''
    try { text = event.dataTransfer?.getData('text/plain') ?? '' } catch { /* 部分环境禁止读取拖拽文本 */ }
    const textImageUrls = extractPastedImageDataUrls(text)
    if (allFiles.some(isSupportedImageFile) || textImageUrls.length > 0) {
      event.preventDefault()
      if (allFiles.some(isSupportedImageFile)) {
        void addImageFiles(allFiles)
      } else if (textImageUrls.length > 0) {
        // 拖拽文本中带 data:image base64 图片：转成附件
        void (async () => {
          const room = MAX_PASTED_IMAGES - pastedImages.length
          if (room <= 0) { setNotice(`最多同时发送 ${MAX_PASTED_IMAGES} 张图片`); return }
          const items: PendingImage[] = []
          for (const url of textImageUrls.slice(0, room)) {
            try {
              const keepAlpha = /^data:image\/(png|webp);base64,/i.test(url)
              const compressed = await compressImageDataUrl(url, keepAlpha)
              items.push({ id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, name: 'pasted.png', dataUrl: compressed })
            } catch { /* 单张失败跳过 */ }
          }
          if (items.length > 0) setPastedImages((prev) => [...prev, ...items].slice(0, MAX_PASTED_IMAGES))
        })()
      }
    }
  }
  const handleComposerDragOver = (event: React.DragEvent<HTMLFormElement>): void => {
    if (Array.from(event.dataTransfer?.types ?? []).includes('Files')) {
      event.preventDefault()
    }
  }

  // AI 对话页左滑 → 桌面；右滑 → 打开会话列表（2026-08-22）
  const swipe = useSwipeNavigation(
    () => setView('desktop'),
    () => setConvSidebar(true),
  )
  // 只在用户处于底部附近时自动跟随（向上翻阅历史时绝不抢滚动，避免抖动）
  useEffect(() => {
    const el = scrollRef.current
    if (el && nearBottomRef.current) el.scrollTop = el.scrollHeight
  }, [messages, streaming])
  // 【bug 修复 2026-08-16】从桌面切回对话页时强制滚到最新消息（用户反馈：
  // 每次切回来都要手动下滑）。messages 未变化时上面的 effect 不触发，所以
  // 监听 activeView；仍尊重 nearBottomRef（用户上滑阅读历史时切走再切回不抢滚）。
  const activeView = useShellStore((state) => state.activeView)
  useEffect(() => {
    if (activeView !== 'assistant') return
    const el = scrollRef.current
    if (!el || !nearBottomRef.current) return
    const frame = requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight
    })
    return () => cancelAnimationFrame(frame)
  }, [activeView])
  const onScroll = (): void => {
    const el = scrollRef.current
    if (!el) return
    nearBottomRef.current = el.scrollTop + el.clientHeight >= el.scrollHeight - 64
  }
  const onCreateAppFromHtml = (appId: string): void => {
    setShowHtmlImport(false)
    void useShellStore.getState().refreshBootstrap().then(() => {
      useShellStore.getState().setView('app', appId)
    })
  }
  // 单一 AI 对话入口：所有能力（包括创建 App）都在对话中完成，
  // 不再提供独立的“做成 App”入口。建议词直接作为对话消息发送。
  const suggestions = ['做一个旅行清单 App', '帮我整理今天的重点', '把一个想法变成小工具']
  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    const text = draft.trim()
    if (!text && pastedImages.length === 0) return
    const content = pastedImages.length > 0
      ? `${text}${text ? '\n' : ''}${pastedImages.map((image, index) => `\n![图片${index + 1}](${image.dataUrl})`).join('')}`
      : text
    // 2026-08-21 兜底：若异常情况下（如 base64 文本被误粘贴）content 超长，
    // 阻止发送并提示，避免 AI 请求因超长/非法内容失败（服务端 MAX_MESSAGE_LENGTH=12000）。
    // 带 data URI 图片的消息不在此限：服务端识别后走 MAX_MEDIA_MESSAGE_LENGTH(128MB)，
    // 图片附件是正常发送链路，不能被本地 12k 兜底误拦。
    const hasMediaDataUri = /data:image\/[a-z0-9.+-]+;base64,/i.test(content)
    if (!hasMediaDataUri && content.length > MAX_MESSAGE_LENGTH) {
      useShellStore.getState().setNotice('发送内容过长，请先清空输入框中的异常文本后再发送')
      return
    }
    void sendMessage(content)
    setPastedImages([])
    window.setTimeout(resizeComposer, 0)
  }
  const loggedIn = session && !session.guest
  const accountLabel = loggedIn
    ? (session.user.email?.split('@')[0] ?? session.user.username)
    : '登录'
  // 登录后账户按钮 = 个人主页入口（游客 = 打开登录面板）
  const openAccount = (): void => {
    if (loggedIn) setView('profile')
    else onOpenLogin()
  }
  // 时段问候语 + 称呼（display_name 由服务端注入 session.user.username）
  const hour = new Date().getHours()
  const greetingWord = hour < 6 ? '夜深了' : hour < 12 ? '早上好' : hour < 14 ? '中午好' : hour < 18 ? '下午好' : '晚上好'
  const displayName = loggedIn ? (session.user.username?.trim() || accountLabel) : ''
  return <section className="os-screen assistant-screen" {...swipe}>
    <header className="assistant-header"><div className="daily-wordmark" role="button" tabIndex={0} aria-label="打开会话列表" onClick={() => setConvSidebar(true)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setConvSidebar(true) } }}><LogoMark className="wordmark-mark" /><strong>Daily</strong></div><div className="assistant-header-actions"><button className="balance-chip" onClick={() => setView('profile')} aria-label="AI 用量"><CircleDollarSign size={13} /><span>{formatCredits(totalRemainingCredits(guest))}</span></button><button className="desktop-nav-button" onClick={() => setView('desktop')} aria-label="进入系统桌面"><Grid2X2 size={13} /><span>桌面</span></button>{loggedIn ? <button className={`avatar-button ${session.user.role === 'admin' ? 'avatar-button-admin' : ''}`} onClick={openAccount} aria-label="个人主页"><span className="avatar-mini">{(session.user.username?.trim() || accountLabel).slice(0, 1).toUpperCase()}</span><span className="account-name">{session.user.username?.trim() || accountLabel}</span></button> : <button className="account-button account-button-out" onClick={openAccount}><KeyRound size={13} /><span>登录</span></button>}</div></header>
    {<div className={`conv-title-bar ${messages.length > 0 && currentConv ? '' : 'conv-title-bar-hidden'}`}><span className="conv-title-name"><MessageSquareText size={12} /><span>{currentConv?.title || '新会话'}</span></span>{currentConv && currentConv.usedTokens > 0 ? <span className="conv-title-tokens">{formatTokens(currentConv.usedTokens)}</span> : null}</div>}
    <div className="assistant-scroll" ref={scrollRef} onScroll={onScroll}>
      {messages.length === 0 ? <>
        <div className="greeting"><span className="date-label">{new Date().toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' })}</span><h1>{loggedIn && displayName ? `${greetingWord}，${displayName}。` : `${greetingWord}。`}<br /><em>今天想做点什么？我可以帮你做 App、改桌面、管文件。</em></h1><p>直接告诉我：做个待办清单 App、把桌面改成深色、上传的图片做成壁纸…我都能做。</p></div>
        <Surface className="context-card"><div className="card-heading"><strong>此刻与你有关</strong><span className="soft-tag">{loggedIn ? `${formatCredits(totalRemainingCredits(guest))} 积分剩余` : '免费额度已到账'}</span></div><button className="context-row" onClick={openAccount}><span className="context-icon blue"><Mail size={16} /></span><span><strong>{loggedIn ? '查看个人主页' : '邮箱登录，获得 1000 积分'}</strong><small>{loggedIn ? 'AI 用量、余额、套餐与联系站长都在这里' : '游客 100 积分 token，登录后 10 万；游客资产自动迁移'}</small></span><ChevronRight size={16} /></button></Surface>
        <div className="suggestion-row">{suggestions.map((suggestion) => <button key={suggestion} onClick={() => { setDraft(suggestion); setNotice(null) }}>{suggestion}</button>)}</div>
      </> : <>
      <div className="conversation-list">{messages.map((message, index) => <MessageBubble key={`${message.role}-${index}-${message.createdAt ?? index}`} message={message} messageIndex={index} isLast={index === messages.length - 1} onAvatarClick={() => setAvatarPanel(true)} />)}</div>
      </>}
    </div>
    <div className="composer-zone">
      {/* 常驻隐藏文件输入：funbar「图片/文件」与 ➕ 菜单共用（2026-08-22 修复：此前挂在 composerMenu 条件块内，菜单未打开时 ref 为 null，导致输入框下方「图片」「文件」按钮点击无响应，只有「新建」可用） */}
      <input ref={imageInputRef} type="file" accept="image/*" multiple hidden onChange={(event) => { if (event.target.files && event.target.files.length > 0) void addImageFiles(event.target.files); if (imageInputRef.current) imageInputRef.current.value = ''; setComposerMenu(false) }} />
      <input ref={uploadInputRef} type="file" multiple hidden onChange={(event) => void onUploadFiles(event.target.files)} />
      {composerMenu ? <>
      <div className="composer-menu-backdrop" onClick={() => setComposerMenu(false)} aria-hidden="true" />
      <div className="composer-menu" role="menu" aria-label="更多功能">
        <button type="button" className="composer-menu-item" role="menuitem" onClick={() => imageInputRef.current?.click()}><ImagePlus size={16} /><span><strong>图片到对话</strong><small>选图发给 AI 看（不落盘，游客可用）</small></span></button>
        <button type="button" className="composer-menu-item" role="menuitem" onClick={() => { setConvSidebar(true); setComposerMenu(false) }}><MessageSquareText size={16} /><span><strong>会话列表</strong><small>切换 · 新建 · 管理历史对话</small></span></button>
        <button type="button" className={`composer-menu-item ${uploadFailed ? 'composer-menu-item-fail' : uploadDone !== null ? 'composer-menu-item-done' : ''}`} role="menuitem" onClick={() => uploadInputRef.current?.click()} disabled={uploading}>{uploading ? <LoaderCircle className="spin" size={16} /> : uploadDone !== null ? <Check size={16} /> : uploadFailed ? <X size={16} /> : <Upload size={16} />}<span><strong>{uploading ? '上传中…' : uploadDone !== null ? `已上传 ${uploadDone} 个` : uploadFailed ? '上传失败' : '上传文件'}</strong><small>{uploadFailed ? '请稍后重试' : '图片 / 文档 / 音频 / 视频，AI 可直接使用'}</small></span></button>
        <button type="button" className="composer-menu-item" role="menuitem" onClick={() => { setShowHtmlImport(true); setComposerMenu(false) }}><Code2 size={16} /><span><strong>粘贴 HTML 创建 App</strong><small>把现成的 HTML 变成系统里的 App</small></span></button>
        <button type="button" className={`composer-menu-item ${shareDone ? 'composer-menu-item-done' : ''}`} role="menuitem" onClick={() => void onShareSystem()} disabled={shareBusy}>{shareBusy ? <LoaderCircle className="spin" size={16} /> : shareDone ? <Check size={16} /> : <Share2 size={16} />}<span><strong>{shareBusy ? '打包中…' : shareDone ? '分享链接已复制' : '分享整套系统'}</strong><small>加载页 + 桌面 + 你的全部 App，一键打包成链接</small></span></button>
        <div className="composer-menu-item composer-menu-static" role="menuitem"><Layers3 size={16} /><span><strong>思考强度</strong><small>浅 · 中 · 深 · 极深，按任务复杂度切换</small></span></div>
        <div className="composer-menu-chips"><ModelThinkingCard compact /></div>
      </div>
    </> : null}
      {pastedImages.length > 0 ? (
        <div className="composer-attachments">
          {pastedImages.map((image) => (
            <div className="composer-attachment" key={image.id}>
              <img src={image.dataUrl} alt={image.name} />
              <button type="button" className="composer-attachment-remove" aria-label={`移除图片 ${image.name}`} onClick={() => removePastedImage(image.id)}><X size={11} /></button>
            </div>
          ))}
        </div>
      ) : null}
      <form className="assistant-composer" onSubmit={submit} onDrop={handleComposerDrop} onDragOver={handleComposerDragOver}>
        <textarea ref={composerRef} aria-label="输入消息" value={draft} onChange={(event) => { setDraft(event.target.value); resizeComposer() }} onPaste={handleComposerPaste} placeholder="告诉 Daily 你想做什么…" rows={1} />
        {/* 2026-08-21 方案 A（用户选定）：功能内嵌输入框，图标+文字胶囊一眼看懂——
            图片 = 发到对话（AI 当场看图，游客可用）；文件 = 存入 home/uploads；新建 = 新会话 */}
        <div className="composer-funbar">
          <button type="button" className="funbar-pill" onClick={() => imageInputRef.current?.click()}><ImagePlus size={13} />图片</button>
          <button type="button" className="funbar-pill" onClick={() => uploadInputRef.current?.click()}><Paperclip size={13} />文件</button>
          <button type="button" className="funbar-pill" onClick={() => { setComposerMenu(false); createConversation() }}><Plus size={13} />新建</button>
          <span className="funbar-spacer" />
          <button type="button" className={`composer-plus ${composerMenu ? 'composer-plus-active' : ''}`} aria-label="更多功能" onClick={() => setComposerMenu((value) => !value)}><Settings size={16} /></button>
          {streaming ? <Button variant="danger" onClick={stopStreaming}><Square size={13} fill="currentColor" /> 停止</Button> : <button className="send-button" aria-label="发送消息" disabled={!draft.trim() && pastedImages.length === 0} type="submit"><ArrowRight size={17} /></button>}
        </div>
      </form>
    </div>
      {showHtmlImport ? <HtmlImportPanel onClose={() => setShowHtmlImport(false)} onCreated={onCreateAppFromHtml} /> : null}
      {avatarPanel ? <AvatarEditPanel onClose={() => setAvatarPanel(false)} /> : null}
      <ChatSidebar open={convSidebar} onClose={() => setConvSidebar(false)} />
  </section>
}

/** 2026-08-08 分享给朋友面板（长按 App 菜单 → 宿主弹出）：
 * 「系统分享」按钮调起 Web Share API（navigator.share）——手机端出现系统分享
 * 弹窗（微信/QQ/邮件等可选「分享给」）；不支持时降级为复制链接。 */
function ShareAppPanel({ share, onClose }: { share: { name: string; url: string }; onClose: () => void }) {
  const [copied, setCopied] = useState(false)
  const [busy, setBusy] = useState(false)
  const doCopy = async (): Promise<void> => {
    const ok = await copyTextToClipboard(share.url)
    if (ok) {
      setCopied(true)
      window.setTimeout(() => onClose(), 1200)
    }
  }
  const doSystemShare = async (): Promise<void> => {
    if (busy) return
    setBusy(true)
    try {
      if (navigator.share) {
        await navigator.share({ title: `Daily 应用：${share.name}`, text: `来体验这个应用：${share.name}`, url: share.url })
        onClose()
      } else {
        await doCopy()
      }
    } catch {
      // 用户取消分享面板：保持打开
    } finally {
      setBusy(false)
    }
  }
  return <div className="modal-overlay" onClick={onClose}>
    <div className="share-panel" onClick={(event) => event.stopPropagation()}>
      <div className="share-panel-head"><span className="share-panel-icon"><Share2 size={16} /></span><div><strong>分享「{share.name}」</strong><small>朋友打开链接可直接体验，无需登录</small></div><button type="button" className="share-panel-close" aria-label="关闭" onClick={onClose}><X size={15} /></button></div>
      <div className="share-panel-url">{share.url}</div>
      <div className="share-panel-actions">
        <button type="button" className="os-button os-button-primary share-panel-system" onClick={() => void doSystemShare()} disabled={busy}>{busy ? <LoaderCircle className="spin" size={15} /> : <Share2 size={15} />}{busy ? '打开分享面板…' : '系统分享（微信 / QQ…）'}</button>
        <button type="button" className={`os-button os-button-quiet share-panel-copy ${copied ? 'os-button-done' : ''}`} onClick={() => void doCopy()}>{copied ? <Check size={15} /> : <Copy size={15} />}{copied ? '已复制' : '复制链接'}</button>
      </div>
    </div>
  </div>
}

function DesktopView({ onOpenLogin }: { onOpenLogin: () => void }) {
  const apps = useShellStore((state) => state.apps)
  const setView = useShellStore((state) => state.setView)
  const reorder = useShellStore((state) => state.reorder)
  const removeApp = useShellStore((state) => state.removeApp)
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const desktopRuntimeRef = useRef<DesktopRuntimeHandle | null>(null)
  const [desktopError, setDesktopError] = useState<string | null>(null)
  // 2026-08-08 分享给朋友面板（长按菜单 → 宿主弹系统分享）
  const [sharePanel, setSharePanel] = useState<{ name: string; url: string } | null>(null)
  // 桌面 iframe 会吞掉触摸事件，只在触屏设备上叠加左右边缘热区（约 18px 宽）支持滑动返回
  const [touchDevice] = useState(() => {
    try {
      return typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches
    } catch {
      return false
    }
  })
  // 桌面左边缘右滑 → AI 对话页（从桌面回到 AI）
  const edgeSwipe = useSwipeNavigation(
    () => setView('assistant'),
    () => setView('assistant'),
  )

  // 「AI 即系统」：桌面 = system.desktop App（版本化 HTML，AI 可自由修改）。
  // 取当前 active 版本渲染；AI 修改后刷新 bootstrap 自动换新版本。
  const desktopApp = apps.find((app) => app.id === 'system.desktop')
  const activeVersion = desktopApp?.versions.find((version) => version.id === desktopApp.activeVersionId)
    ?? desktopApp?.versions[0]
  const desktopHtml = activeVersion?.html ?? null
  const srcDoc = useMemo(
    () => (desktopHtml ? withRuntimeBootstrap(desktopHtml) : ''),
    [desktopHtml],
  )

  useEffect(() => {
    const iframe = iframeRef.current
    if (!iframe || !desktopHtml) return
    setDesktopError(null)
    const runtime = createDesktopRuntime(iframe, {
      apps: () => useShellStore.getState().apps
        .filter((app) => app.id !== 'system.desktop') // 桌面不显示自己
        .map((app) => ({
        id: app.id,
        name: app.name,
        icon: app.icon ?? null,
        source: app.source,
        installed: app.installed,
      })),
      openApp: (appId) => {
        const app = useShellStore.getState().apps.find((candidate) => candidate.id === appId)
        if (!app) return
        if (app.id === 'daily.ai') setView('assistant')
        else if (app.id === 'system.desktop') setView('desktop')
        else if (app.id === 'system.store') setView('store')
        else if (app.id === 'system.files') setView('files')
        else setView('app', app.id)
      },
      navigate: (view) => setView(view),
      reorder: async (ids) => {
        await reorder(ids)
      },
      removeApp: async (appId) => {
        if (window.confirm('删除该 App？其历史版本与私有数据将一并删除，不可恢复。')) {
          await removeApp(appId)
        }
      },
      // 2026-08-06 长按菜单：分享/发布到商店、导出源码 zip、复制链接（宿主实现）
      share: async (appId) => {
        const result = await storePublish(appId)
        return { ok: true, shareId: result.shareId, url: result.url, message: result.message }
      },
      // 2026-08-08 分享给朋友：不发布商店，生成纯链接后宿主弹系统分享面板（Web Share API）
      shareToFriend: async (appId) => {
        const app = useShellStore.getState().apps.find((candidate) => candidate.id === appId)
        const result = await shareAppToFriend(appId)
        const fullUrl = `${window.location.origin}${result.url}`
        setSharePanel({ name: result.name || app?.name || '分享应用', url: fullUrl })
        return { ok: true, url: fullUrl, name: result.name || app?.name || '' }
      },
      exportUrl: async (appId) => {
        const result = await storePublish(appId) // 未发布先发布（重复发布=更新快照）
        const url = storeExportUrl(result.shareId)
        return { url }
      },
      download: (url, name) => {
        const anchor = document.createElement('a')
        anchor.href = url
        anchor.download = name || 'app-source.zip'
        document.body.appendChild(anchor)
        anchor.click()
        anchor.remove()
      },
      copyText: async (text) => {
        try {
          await navigator.clipboard.writeText(text)
          return true
        } catch {
          // 非安全上下文（http 等）clipboard 不可用时降级：临时输入框 + execCommand
          try {
            const textarea = document.createElement('textarea')
            textarea.value = text
            textarea.style.position = 'fixed'
            textarea.style.opacity = '0'
            document.body.appendChild(textarea)
            textarea.select()
            const done = document.execCommand('copy')
            textarea.remove()
            return done
          } catch {
            return false
          }
        }
      },
      // 2026-08-23 桌面接入 API（宿主代理）：http → /webos/api/http（仅登录用户）；
      // invokeApi → /webos/api/appapi/:ns/:ep（游客拒 R13）。服务端鉴权/SSRF/限频兜底。
      http: (input) => proxyHttp(input),
      invokeApi: (namespace, endpoint, params) => invokeAppApi(namespace, endpoint, params),
      // 2026-08-23 桌面直接 AI 对话：走 chat/stream（桌面用固定会话 app-chat-system.desktop），调用者本人计费
      aiChat: (options) => simpleAiChat({ ...options, appId: 'system.desktop' }),
    })
    desktopRuntimeRef.current = runtime
    return () => {
      runtime.destroy()
      desktopRuntimeRef.current = null
    }
  }, [desktopHtml, setView, reorder, removeApp])

  // 2026-08-07 修复：AI 创建/删除 App（refreshBootstrap 后 apps 变化）时通知桌面 iframe
  // 重新拉取列表渲染——此前桌面只在初始化时拉一次，新 App 不刷新页面永远不出现。
  const appsSignature = apps.map((app) => `${app.id}:${app.installed ? 1 : 0}`).join(',')
  useEffect(() => {
    desktopRuntimeRef.current?.notifyAppsChanged()
  }, [appsSignature])

  if (!desktopHtml) {
    return <section className="os-screen desktop-screen"><div className="launcher-wallpaper" /><div className="desktop-content"><div className="empty-file"><span className="empty-file-icon"><Sparkles size={24} /></span><strong>桌面初始化中</strong><p>system.desktop 还没有运行版本。</p><Button variant="quiet" disabled>请稍后重试</Button></div></div></section>
  }

  return <section className="os-screen desktop-screen desktop-iframe-screen">
    <iframe
      ref={iframeRef}
      className="desktop-frame"
      sandbox="allow-scripts"
      srcDoc={srcDoc}
      title="系统桌面"
    />
    {touchDevice ? <div className="desktop-edge desktop-edge-left" aria-hidden="true" {...edgeSwipe} /> : null}
    {desktopError ? <div className="runtime-error" role="alert"><X size={15} /> {desktopError}</div> : null}
    {sharePanel ? <ShareAppPanel share={sharePanel} onClose={() => setSharePanel(null)} /> : null}
  </section>
}

/** 2026-08-06 商店 SDK 适配器（StoreView 与 ExperienceView 共用：
 * bundle 选择页在任何环境（商店/体验页/App 运行页）都能「勾选安装所选」） */
function buildStoreAdapters(): StoreSdkAdapters {
  return {
    list: async (params) => {
      const result = await storeList(params)
      return {
        items: result.items as unknown as Array<Record<string, unknown>>,
        userFreeBytes: result.userFreeBytes,
      }
    },
    get: async (shareId) => ({ item: (await storeGet(shareId)).item as unknown as Record<string, unknown> }),
    install: async (shareId) => {
      const result = await storeInstall(shareId)
      void useShellStore.getState().refreshBootstrap()
      return { ok: result.ok, appId: result.appId, message: result.message }
    },
    // 2026-08-09 商店壳层顶栏已删除：返回桌面由商店 App 自己调 StoreSDK.system.back
    back: () => {
      useShellStore.getState().setView('desktop')
    },
    // 2026-08-09 安装后「打开」：直接切到该 App 运行页
    openApp: (appId) => {
      useShellStore.getState().setView('app', appId)
    },
    share: async (shareId) => ({ url: `${window.location.origin}${window.location.pathname}?exp=${shareId}` }),
    exportUrl: async (shareId) => ({ url: storeExportUrl(shareId) }),
    my: async () => ({ items: (await storeMy()).items as unknown as Array<Record<string, unknown>> }),
    myApps: async () => {
      const state = useShellStore.getState()
      return {
        items: state.apps
          .filter((app) => app.source !== 'builtin')
          .map((app) => ({ id: app.id, name: app.name, icon: app.icon ?? null })),
      }
    },
    publish: async (appId, description) => storePublish(appId, description),
    unpublish: async (shareId) => storeUnpublish(shareId),
    // 2026-08-06 合集批量安装（bundle 勾选若干应用 → 安装到桌面）
    bundleInstall: async (shareId, appIds) => {
      const response = await fetch(`/webos/api/share/${encodeURIComponent(shareId)}/install`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ appIds }),
      })
      const result = await response.json() as { ok?: boolean; installed?: number; error?: { message?: string } }
      void useShellStore.getState().refreshBootstrap()
      return { ok: Boolean(result.ok), installed: result.installed ?? 0, message: result.ok ? `已安装 ${result.installed} 个应用` : (result.error?.message ?? '安装失败') }
    },
    onDownload: (url) => {
      void fetch(url, { credentials: 'include' })
        .then((response) => response.blob())
          .then((blob) => {
            const link = document.createElement('a')
            link.href = URL.createObjectURL(blob)
            link.download = 'app.zip'
            document.body.appendChild(link)
            link.click()
            link.remove()
            window.setTimeout(() => URL.revokeObjectURL(link.href), 5000)
          })
          .catch(() => { /* 下载失败静默 */ })
    },
    // 2026-08-09 技能市场：skills.list / skills.install（安装到用户工作区 skills/，
    // 用户可让 AI 用 manage_skill 自定义演进；不占 App 列表）
    skillsList: async () => {
      const result = await storeSkillsList()
      return { items: result.items as unknown as Array<Record<string, unknown>> }
    },
    skillsInstall: async (skillId) => {
      const result = await storeSkillInstall(skillId)
      void useShellStore.getState().refreshBootstrap()
      return result
    },
    // 2026-08-18 技能发布（对齐 App 商店链路：我的可用 / 我的发布 / 发布 / 下架）
    skillsMine: async () => {
      const result = await storeSkillsMine()
      return { items: result.items as unknown as Array<Record<string, unknown>> }
    },
    skillsMy: async () => {
      const result = await storeSkillsMy()
      return { items: result.items as unknown as Array<Record<string, unknown>> }
    },
    skillsPublish: async (skillId, description) => storeSkillPublish(skillId, description),
    skillsUnpublish: async (id) => storeSkillUnpublish(id),
    // 2026-08-21（W3 统一包市场 R14）：type 维度浏览/详情/安装/我的/App 适配
    // 返回的强类型与 StoreSdkAdapters 的 Record<string, unknown> 契约对齐
    // （与上方 skills* 适配一致的 as unknown as 桥接模式）
    marketList: async (params) => marketList(params) as unknown as Promise<{ entries: Array<Record<string, unknown>> }>,
    marketDetail: async (packageId) => marketDetail(packageId) as unknown as Promise<Record<string, unknown>>,
    marketInstall: async (packageId) => marketInstall(packageId),
    marketMine: async () => marketMine() as unknown as Promise<{ items: Array<Record<string, unknown>> }>,
    marketApps: async () => marketApps() as unknown as Promise<{ apps: Array<Record<string, unknown>> }>,
  }
}

/** 应用商店（2026-08-09 沉浸式）：渲染 system.store（版本化 HTML App，AI 可改形态）
 * + StoreSDK 桥。宿主壳层不再叠加顶栏——返回/打开等导航由商店 App 自己调
 * StoreSDK.system.back / system.openApp（AI 可自由改商店 UI，不再有改不到的栏）。 */
function StoreView({ onOpenLogin }: { onOpenLogin: () => void }) {
  const apps = useShellStore((state) => state.apps)
  const iframeRef = useRef<HTMLIFrameElement | null>(null)
  const runtimeRef = useRef<StoreRuntimeHandle | null>(null)
  const [storeError, setStoreError] = useState<string | null>(null)
  const storeApp = apps.find((app) => app.id === 'system.store') ?? apps.find((app) => app.id === 'system.desktop')
  const active = storeApp
    ? (storeApp.versions.find((version) => version.id === storeApp.activeVersionId) ?? storeApp.versions[storeApp.versions.length - 1])
    : undefined
  const srcDoc = active?.html ? withRuntimeBootstrap(active.html) : ''

useEffect(() => {
    const iframe = iframeRef.current
    if (!iframe) return
    const adapters = buildStoreAdapters()
    runtimeRef.current?.destroy()
    runtimeRef.current = createStoreRuntime(iframe, adapters)
    return () => {
      runtimeRef.current?.destroy()
      runtimeRef.current = null
    }
  }, [srcDoc])

  return <section className="os-screen store-screen">
      {storeError ? <div className="runtime-error" role="alert"><X size={15} /> {storeError}</div> : null}
      {srcDoc
        ? <iframe ref={iframeRef} className="store-frame" sandbox="allow-scripts" srcDoc={srcDoc} title="应用商店" />
        : <div className="empty-state">商店加载中…</div>}
  </section>
}

/** 分享体验页（2026-08-03）：?exp=<shareId> 直接运行商店快照，可登录安装 */
function ExperienceView({ onOpenLogin }: { onOpenLogin: () => void }) {
  const session = useShellStore((state) => state.session)
  const setView = useShellStore((state) => state.setView)
  const [item, setItem] = useState<StoreAppItem | null>(null)
  const [busy, setBusy] = useState(false)
  const [installed, setInstalled] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const expFrameRef = useRef<HTMLIFrameElement | null>(null)
  const expRuntimeRef = useRef<StoreRuntimeHandle | null>(null)

  // 2026-08-06 体验页也挂 StoreSDK 桥：bundle 选择页在体验页打开时
  // 「勾选安装所选」可经宿主桥批量安装到桌面
  useEffect(() => {
    const iframe = expFrameRef.current
    if (!iframe) return
    const adapters = buildStoreAdapters()
    expRuntimeRef.current?.destroy()
    expRuntimeRef.current = createStoreRuntime(iframe, adapters)
    return () => {
      expRuntimeRef.current?.destroy()
      expRuntimeRef.current = null
    }
  }, [item?.html])
  const shareId = useMemo(() => {
    try {
      return new URLSearchParams(window.location.search).get('exp') ?? ''
    } catch {
      return ''
    }
  }, [])
  const loggedIn = Boolean(session && !session.guest)

  useEffect(() => {
    if (!shareId) {
      setError('分享链接缺少应用 ID（?exp=）')
      return
    }
    // 2026-08-08 ap- 轻量分享（分享给朋友的链接）读分享包元数据；s- 商店分享走商店 API
    const load = shareId.startsWith('ap-') ? fetchShareMeta(shareId) : storeGet(shareId)
    void load
      .then((result) => {
        setItem(result.item)
        // 上报分享访问（每浏览器 session 一次；登录后由服务端给分享者结算 100 积分）
        try {
          const key = `daily-webos-exp-visited:${shareId}`
          if (!localStorage.getItem(key)) {
            localStorage.setItem(key, '1')
            void storeVisit(shareId).catch(() => { /* 忽略 */ })
          }
        } catch {
          void storeVisit(shareId).catch(() => { /* 忽略 */ })
        }
      })
      .catch((caught) => setError(caught instanceof Error ? caught.message : '分享的应用加载失败'))
  }, [shareId])

  const doInstall = async (): Promise<void> => {
    if (!loggedIn) {
      onOpenLogin()
      return
    }
    if (!shareId || busy) return
    setBusy(true)
    setError(null)
    try {
      const result = await storeInstall(shareId)
      await useShellStore.getState().refreshBootstrap()
      setInstalled(true)
      if (!result.ok) setError(result.message)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '安装失败，请重试')
    } finally {
      setBusy(false)
    }
  }

  return <section className="os-screen system-screen experience-screen">
    <header className="screen-header">
      <IconButton label="返回" onClick={() => setView('desktop')}><ArrowLeft size={19} /></IconButton>
      <div className="screen-header-title"><strong>{item?.name ?? '应用体验'}</strong><small>{item ? `${item.ownerName} · ${item.installs} 次安装` : '分享应用'}</small></div>
      <div className="screen-header-right">
        {loggedIn
          ? <Button variant="quiet" disabled={busy || installed} onClick={() => void doInstall()} className="experience-install">{installed ? <Check size={15} /> : busy ? <LoaderCircle className="spin" size={15} /> : <Download size={15} />}{installed ? '已安装' : busy ? '安装中…' : '安装'}</Button>
          : <Button variant="quiet" onClick={onOpenLogin}><KeyRound size={15} />登录后安装</Button>}
      </div>
    </header>
    <div className="system-scroll experience-scroll">
      {error ? <div className="runtime-error" role="alert"><X size={15} /> {error}</div> : null}
      {item?.html
        ? <iframe ref={expFrameRef} className="experience-frame" sandbox="allow-scripts" srcDoc={withRuntimeBootstrap(item.html, undefined, shareId || undefined)} title={item.name} />
        : <div className="empty-state">{error ? '无法加载' : '正在打开分享的应用…'}</div>}
      {!loggedIn && item ? <p className="experience-hint"><KeyRound size={12} />登录后安装到桌面；分享者将获得 100 积分奖励</p> : null}
    </div>
  </section>
}

function FilesView() {
  const session = useShellStore((state) => state.session)
  const apps = useShellStore((state) => state.apps)
  const setView = useShellStore((state) => state.setView)
  const setNotice = useShellStore((state) => state.setNotice)
  // 2026-08-18 双区浏览：user = 用户可见区（home/，可上传/删除）
  //               agent = AI 工作区（工作区根，含 home/ agent/ apps/ shared/
  //                       skills/ system/ logs 等，只读浏览+打开文件）
  const [zone, setZone] = useState<'user' | 'agent'>('user')
  const [dir, setDir] = useState('')
  const [entries, setEntries] = useState<Array<{ name: string; type: 'dir' | 'file'; size: number; modifiedAt: number; publicUrl?: string }>>([])
  const [workspaceBytes, setWorkspaceBytes] = useState(0)
  const [workspaceLimitBytes, setWorkspaceLimitBytes] = useState(200 * 1024 * 1024)
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [uploadDone, setUploadDone] = useState<number | null>(null)
  const uploadDoneTimerRef = useRef<number | null>(null)
  const [error, setErrorMsg] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  // 2026-08-18 文件内容预览（AI 工作区只读打开文本/图片）
  const [preview, setPreview] = useState<{ name: string; kind: 'text' | 'image'; text?: string; url?: string } | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [previewError, setPreviewError] = useState<string | null>(null)

  const refresh = useCallback(async (nextDir = dir, nextZone = zone): Promise<void> => {
    setLoading(true)
    setErrorMsg(null)
    try {
      const result = nextZone === 'agent'
        ? await listAgentWorkspaceFiles(nextDir)
        : await listWorkspaceFiles(nextDir)
      setEntries(result.entries)
      setDir(result.path)
      setWorkspaceBytes(result.workspaceBytes)
      setWorkspaceLimitBytes(result.workspaceLimitBytes)
    } catch (caught) {
      setErrorMsg(caught instanceof Error ? caught.message : '文件列表加载失败')
    } finally {
      setLoading(false)
    }
  }, [dir, zone])

  useEffect(() => {
    void refresh('', zone)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zone])

  const switchZone = (nextZone: 'user' | 'agent'): void => {
    if (nextZone === zone) return
    setZone(nextZone)
    setDir('')
    void refresh('', nextZone)
    setPreview(null)
    setPreviewError(null)
  }

  const onUpload = async (files: FileList | null): Promise<void> => {
    if (!files || files.length === 0) return
    if (!session || session.guest) {
      // 游客：跳到登录页即为反馈（不弹 toast）
      setView('profile')
      return
    }
    setUploading(true)
    setErrorMsg(null)
    try {
      let uploaded = 0
      let lastEntry: WebOsWorkspaceEntry | null = null
      for (const file of Array.from(files)) {
        // 2026-08-13 大文件（>20MB）走分片上传（8MB/片，断点续传）；小文件走单请求
        // 2026-08-21 保留返回的 file（含 publicUrl，图片的免鉴权公开链接）
        const result = file.size > 20 * 1024 * 1024
          ? await uploadWorkspaceFileLarge(file.name, file, 'uploads')
          : await uploadWorkspaceFile(file.name, await blobToBase64(file), 'uploads')
        lastEntry = result.file
        uploaded += 1
      }
      setUploadDone(uploaded)
      // 2026-08-21 反馈：提示落盘位置 + 图片公开链接（此前只给相对路径，图片功能无法直接访问）
      const fileName = lastEntry?.name ?? (Array.from(files)[0]?.name ?? '')
      const publicUrl = lastEntry?.publicUrl ?? ''
      setNotice(publicUrl
        ? `已上传 ${uploaded} 个文件到 home/uploads/${fileName}（图片已生成公开链接，App / 生成图参考可直接使用）`
        : `已上传 ${uploaded} 个文件到 home/uploads/${fileName}（AI 可直接读取）`)
      if (uploadDoneTimerRef.current) window.clearTimeout(uploadDoneTimerRef.current)
      uploadDoneTimerRef.current = window.setTimeout(() => setUploadDone(null), 1600)
      await refresh()
    } catch (caught) {
      setErrorMsg(caught instanceof Error ? caught.message : '上传失败，请重试')
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const onDelete = async (name: string, type: 'dir' | 'file'): Promise<void> => {
    if (!window.confirm(`删除${type === 'dir' ? '目录' : '文件'}「${name}」？不可恢复。`)) return
    setErrorMsg(null)
    try {
      await deleteWorkspaceFile(dir ? `${dir}/${name}` : name)
      // 文件从列表消失即为反馈（不弹 toast）
      await refresh()
    } catch (caught) {
      setErrorMsg(caught instanceof Error ? caught.message : '删除失败')
    }
  }

  const isImage = (name: string): boolean => /\.(png|jpe?g|gif|webp|svg|bmp|avif)$/i.test(name)
  const isText = (name: string): boolean => /\.(txt|md|markdown|json|js|mjs|cjs|ts|tsx|jsx|html|htm|css|scss|less|xml|yml|yaml|toml|ini|conf|log|csv|svg|env|sh|bat|py|java|c|h|cpp|sql|properties|gitignore|npmrc|editorconfig|lock)$/i.test(name)
  const previewPath = (name: string): string => (dir ? `${dir}/${name}` : name)
  // 游客不支持上传（2026-08-03）：登录后获得 10GB 空间
  const loggedIn = session && !session.guest
  const agentZone = zone === 'agent'

  /** 2026-08-18 打开文件：图片/文本内联预览，其它浏览器打开（下载/查看） */
  const openFile = async (entry: { name: string; type: 'dir' | 'file'; publicUrl?: string }): Promise<void> => {
    if (entry.type !== 'file') return
    const pathName = previewPath(entry.name)
    // 2026-08-21：图片优先用免鉴权公开 URL（App iframe / 生成图参考可直接复用），无则回退带鉴权 raw
    const url = agentZone
      ? agentWorkspaceFileRawUrl(pathName)
      : (entry.publicUrl ?? workspaceFileRawUrl(pathName))
    if (isImage(entry.name)) {
      setPreview({ name: entry.name, kind: 'image', url })
      return
    }
    if (isText(entry.name)) {
      setPreviewLoading(true)
      setPreviewError(null)
      setPreview({ name: entry.name, kind: 'text' })
      try {
        const text = agentZone
          ? await readAgentWorkspaceTextFile(pathName)
          : await (await fetch(url, { credentials: 'include' })).text()
        setPreview({ name: entry.name, kind: 'text', text })
      } catch (caught) {
        setPreviewError(caught instanceof Error ? caught.message : '文件读取失败')
      } finally {
        setPreviewLoading(false)
      }
      return
    }
    window.open(url, '_blank', 'noopener,noreferrer')
  }

  const used = workspaceBytes
  const limit = workspaceLimitBytes
  const usedPercent = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0

  return <section className="os-screen system-screen"><ScreenHeader title="文件" subtitle={agentZone ? 'AI 工作区' : '我的工作区'} onBack={() => setView('desktop')} right={<MoreHorizontal size={18} />} /><div className="system-scroll"><div className="system-intro"><Eyebrow>FILE MANAGER</Eyebrow><h1>{agentZone ? 'AI 工作区' : '文件工作区'}</h1><p>{agentZone ? '浏览 AI 在你工作区里维护的全部文件（含 home/ agent/ apps/ shared/ skills/ system 等），文件可打开查看，只读。' : '上传图片、文档和素材，AI 助手可以直接读取使用。每个账号的工作区相互隔离。'}</p></div>
    <div className="file-zone-switch" role="tablist" aria-label="文件区切换">
      <button type="button" role="tab" aria-selected={!agentZone} className={!agentZone ? 'active' : ''} onClick={() => switchZone('user')}><UserRound size={14} />我的文件<small>home/</small></button>
      <button type="button" role="tab" aria-selected={agentZone} className={agentZone ? 'active' : ''} onClick={() => switchZone('agent')}><Code2 size={14} />AI 工作区<small>根目录</small></button>
    </div>
    <div className="metric-grid"><Surface className="metric-card"><HardDrive size={18} /><span>存储用量</span><strong>{formatBytes(used)}</strong><small>上限 {formatBytes(limit)}（{loggedIn ? '已登录' : '游客'}）</small></Surface><Surface className="metric-card"><Database size={18} /><span>App 数据</span><strong>{apps.filter((app) => app.source !== 'builtin').length} 个</strong><small>私有空间隔离</small></Surface><Surface className="metric-card"><Layers3 size={18} /><span>版本归档</span><strong>{apps.reduce((total, app) => total + app.versions.length, 0)} 个</strong><small>可回滚</small></Surface></div>
    <Surface className="file-list-card"><div className="card-heading"><div><Eyebrow>{agentZone ? 'AGENT WORKSPACE' : 'PRIVATE WORKSPACE'}</Eyebrow><h2>{agentZone ? 'AI 工作区文件（只读）' : '我的文件'}</h2></div><Folder size={18} /></div>
      {!agentZone ? <div className="file-upload-bar">
        <input ref={fileInputRef} type="file" multiple hidden onChange={(event) => void onUpload(event.target.files)} />
        {loggedIn
          ? <button type="button" className={`os-button os-button-primary file-upload-button ${uploadDone !== null ? 'os-button-done' : ''}`} disabled={uploading || uploadDone !== null} onClick={() => fileInputRef.current?.click()}>{uploadDone !== null ? <Check size={15} /> : uploading ? <LoaderCircle className="spin" size={15} /> : <Upload size={15} />} {uploadDone !== null ? `已上传 ${uploadDone} 个` : uploading ? '上传中…' : '上传文件'}</button>
          : <button type="button" className="os-button file-upload-button" onClick={() => setView('profile')}><KeyRound size={15} /> 登录后上传</button>}
        <small>{loggedIn ? `图片 / 文档 / 音频 / 视频 / 压缩包（无单文件大小限制，工作区共 ${formatBytes(limit)}；大量存储需求可联系站长单独扩容）` : `游客暂不支持上传；登录后获得 ${formatBytes(limit)} 工作区空间，AI 可直接读取你上传的文件。`}</small>
      </div> : <p className="muted-copy plan-hint" style={{ margin: '0 0 8px' }}><Eye size={12} style={{ verticalAlign: -2 }} /> AI 工作区为只读浏览：文件可打开查看，修改/上传请通过对话让 AI 完成。</p>}
      <div className="token-bar workspace-bar"><span style={{ width: `${usedPercent}%` }} /></div>
      <p className="muted-copy plan-hint"><HardDrive size={12} style={{ verticalAlign: -2 }} /> 已用 {formatBytes(used)} / 共 {formatBytes(limit)}。空间不够？订阅月卡可获得 10GB 以上工作区，或联系站长单独扩容（微信 fangyan876）。</p>
      {error ? <p className="html-import-error">{error}</p> : null}
      {loading ? <div className="empty-file"><LoaderCircle className="spin" size={20} /></div>
        : entries.length === 0 ? <div className="empty-file"><span className="empty-file-icon"><Folder size={24} /></span><strong>{agentZone ? '这个目录还是空的' : '这里还很安静'}</strong><p>{agentZone ? 'AI 还没有在这个目录留下文件。' : '上传第一张图片或第一个文档，AI 就能读到它。上传后的文件在 home/uploads/，AI 可直接使用。'}</p></div>
          : <div className="file-list">{dir ? <button type="button" className="file-row file-row-up" onClick={() => void refresh(dir.split('/').slice(0, -1).join('/'))}><Folder size={16} /><span>..（返回上级）</span></button> : null}
            {entries.map((entry) => (
              <div className="file-row" key={entry.name}>
                {entry.type === 'dir'
                  ? <button type="button" className="file-row-main" onClick={() => void refresh(dir ? `${dir}/${entry.name}` : entry.name)}><Folder size={16} /><span>{entry.name}</span><small>目录</small></button>
                  : <button type="button" className="file-row-main" onClick={() => void openFile(entry)}>
                    {isImage(entry.name)
                      ? <img className="file-thumb" src={agentZone ? agentWorkspaceFileRawUrl(previewPath(entry.name)) : workspaceFileRawUrl(previewPath(entry.name))} alt={entry.name} loading="lazy" onError={(event) => { (event.currentTarget).style.display = 'none' }} />
                      : <FileText size={16} />}
                    <span title={entry.name}>{entry.name}</span>
                    <small>{formatBytes(entry.size)}</small>
                  </button>}
                {entry.type === 'file' ? <a className="file-action" href={agentZone ? agentWorkspaceFileRawUrl(previewPath(entry.name)) : workspaceFileRawUrl(previewPath(entry.name))} target="_blank" rel="noreferrer" aria-label="打开/下载"><Download size={15} /></a> : null}
                {!agentZone ? <button type="button" className="file-action file-action-danger" aria-label="删除" onClick={() => void onDelete(entry.name, entry.type)}><Trash2 size={15} /></button> : null}
              </div>
            ))}
          </div>}
      <div className="file-hint"><Sparkles size={14} /> {agentZone ? '目录：home/（用户可见区） agent/（AI 草稿） apps/（App 源码） shared/（跨 App 共享） skills/（记忆技能） system/（系统素材） logs/（执行日志）' : '上传后直接对 AI 说「用我上传的图片做壁纸 / 做个相册 App」，它会自动读取 home/uploads/ 里的文件。'}</div>
    </Surface>
    {preview ? <div className="file-preview-overlay" role="dialog" aria-modal="true" onClick={() => { setPreview(null); setPreviewError(null) }}>
      <div className="file-preview" onClick={(event) => event.stopPropagation()}>
        <div className="file-preview-head">
          <span title={preview.name}>{preview.name}</span>
          <button type="button" className="file-preview-close" aria-label="关闭预览" onClick={() => { setPreview(null); setPreviewError(null) }}><X size={16} /></button>
        </div>
        <div className="file-preview-body">
          {previewLoading ? <div className="empty-file"><LoaderCircle className="spin" size={20} /></div>
            : previewError ? <p className="html-import-error">{previewError}</p>
              : preview.kind === 'image' && preview.url ? <img src={preview.url} alt={preview.name} />
                : <pre className="file-preview-text">{preview.text ?? ''}</pre>}
        </div>
      </div>
    </div> : null}
    </div></section>
}

function formatBytes(value: number): string {
  if (value >= 1024 * 1024 * 1024) return `${(value / 1024 / 1024 / 1024).toFixed(1)} GB`
  if (value >= 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MB`
  if (value >= 1024) return `${(value / 1024).toFixed(1)} KB`
  return `${Math.round(value)} B`
}

function formatTokens(value: number): string {
  // 显示精度：1 亿级别用「亿」，其余显示完整数字（带千分位），
  // 避免 10 万配额下扣几百 token 仍显示「10万」造成「计费没生效」的错觉。
  if (value >= 100_000_000) return `${(value / 100_000_000).toFixed(1)} 亿`
  return Math.round(value).toLocaleString('zh-CN')
}

/** 积分显示（2026-08-02 积分制）：1 积分 = ¥0.01；余额通常几百~几千，直接显示数字 */
function formatCredits(value: number): string {
  if (value >= 10_000) return `${(value / 10_000).toFixed(1)} 万`
  return Math.round(value).toLocaleString('zh-CN')
}

/** 2026-08-06 总剩余积分 = 月卡/常规额度剩余 + 永久池剩余（所有余额展示统一走这里） */
function totalRemainingCredits(guest: { credits?: { remaining?: number; totalRemaining?: number; permanent?: { remaining?: number } | null } } | null | undefined): number {
  if (!guest?.credits) return 0
  if (typeof guest.credits.totalRemaining === 'number') return guest.credits.totalRemaining
  return Math.max(0, guest.credits.remaining ?? 0) + Math.max(0, guest.credits.permanent?.remaining ?? 0)
}

const KIND_LABELS: Record<string, string> = {
  guest: '游客',
  member: '会员',
  plan: '套餐用户',
}

/**
 * 套餐购买弹窗（zpay 支付渠道，design skill 居中弹窗）：
 * 选择支付方式 → 创建订单 → 展示二维码 / 跳转收银台 → 轮询订单状态 → 到账后刷新。
 */
function PayPanel({ onClose, onOpenLogin, refresh }: { onClose: () => void; onOpenLogin: () => void; refresh: () => Promise<void> }) {
  const session = useShellStore((state) => state.session)
  const loggedIn = session && !session.guest
  const [payType, setPayType] = useState<'alipay' | 'wxpay'>('alipay')
  const [order, setOrder] = useState<WebOsPayOrder | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [paid, setPaid] = useState(false)

  const startPay = async (type: 'alipay' | 'wxpay'): Promise<void> => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const created = await createPayOrder('token-plan-100m', type)
      setOrder(created)
      setPayType(type)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '下单失败，请稍后重试')
    } finally {
      setBusy(false)
    }
  }

  // 支付后轮询订单状态（3s 间隔）；到账后刷新 bootstrap 并自动关闭
  const orderId = order?.id ?? null
  useEffect(() => {
    if (!orderId || order?.status === 'paid') return
    let cancelled = false
    const timer = setInterval(async () => {
      try {
        const latest = await getPayOrder(orderId)
        if (cancelled) return
        setOrder(latest)
        if (latest.status === 'paid') {
          clearInterval(timer)
          setPaid(true)
          try { await refresh() } catch { /* 刷新失败不阻塞关闭 */ }
          setTimeout(() => { if (!cancelled) onClose() }, 1600)
        }
      } catch {
        // 网络抖动：下一轮重试
      }
    }, 3000)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId, onClose, refresh])

  return (
    <div className="login-overlay" onClick={onClose}>
      <div className="login-card pay-card" onClick={(event) => event.stopPropagation()} role="dialog" aria-modal="true" aria-label="购买套餐">
        <button className="login-close" onClick={onClose} aria-label="关闭"><X size={16} /></button>
        {!loggedIn ? (
          <>
            <h2 className="pay-title">登录后购买</h2>
            <p className="pay-desc">套餐额度跟随账号，游客身份无法购买。登录后资产会自动迁移到账号。</p>
            <button className="os-button os-button-primary login-submit" onClick={() => { onClose(); onOpenLogin() }}><KeyRound size={15} /> 邮箱登录 / 注册</button>
          </>
        ) : paid ? (
          <>
            <span className="pay-success-icon"><Check size={22} /></span>
            <h2 className="pay-title">支付成功</h2>
            <p className="pay-desc">1 亿 Token 已到账，个人主页额度已刷新。</p>
          </>
        ) : order ? (
          <>
            <h2 className="pay-title">990 积分套餐 · ¥9.90</h2>
            {order.img ? <img className="pay-qr" src={order.img} alt="支付二维码" /> : <div className="pay-qr pay-qr-placeholder"><QrCode size={40} /></div>}
            <p className="pay-desc">请用{payType === 'alipay' ? '支付宝' : '微信'}扫码支付；支付完成后本页会自动确认。</p>
            {order.payUrl ? <a className="os-button os-button-primary login-submit pay-jump" href={order.payUrl} target="_blank" rel="noreferrer"><ExternalLink size={14} /> 跳转收银台支付</a> : null}
            <p className="pay-waiting"><LoaderCircle className="spin" size={13} /> 等待支付确认…（{order.id.slice(-6)}）</p>
          </>
        ) : (
          <>
            <h2 className="pay-title">990 积分套餐</h2>
            <p className="pay-desc">一次性购买，到账后额度升级为 1 亿 tokens（按真实用量扣减，用完即止）。</p>
            <div className="pay-methods">
              <button type="button" className={`pay-method ${payType === 'alipay' ? 'pay-method-active' : ''}`} onClick={() => setPayType('alipay')}><span className="pay-method-dot" style={{ background: '#1677ff' }} />支付宝</button>
              <button type="button" className={`pay-method ${payType === 'wxpay' ? 'pay-method-active' : ''}`} onClick={() => setPayType('wxpay')}><span className="pay-method-dot" style={{ background: '#07c160' }} />微信支付</button>
            </div>
            {error ? <p className="pay-error">{error}</p> : null}
            <button className="os-button os-button-primary login-submit" disabled={busy} onClick={() => void startPay(payType)}>{busy ? <LoaderCircle className="spin" size={15} /> : <WalletCards size={15} />}去支付 ¥9.90</button>
          </>
        )}
      </div>
    </div>
  )
}

/** 爱发电订阅页（2026-08-06 重做）：3 月卡 + 尝鲜包，跳转爱发电主页支付。
 *  月卡：每月发放定额积分，当月用不完自动作废（续费重新给满）；
 *  尝鲜包：一次性购买，永久有效，每人限购一次。
 *  所有档位均可使用生图、生视频；未充值用户生图限 10 次、视频限 2 次。 */
/** 兑换成功庆祝动画（2026-08-12）：彩带/烟花从顶部飘落 + 按档位的感谢文案。
 * 纯 CSS 动画实现（不引第三方库），情绪价值拉满 🎆🧨 */
const REDEEM_PARTICLES = ['🎆', '🧨', '✨', '🎉', '💖', '🎊', '⭐', '💫']
const REDEEM_GREETINGS: Record<string, string> = {
  '轻量月卡': '感谢你的轻量支持！1000 积分已到账，AI 会陪你把每一天过成想要的样子 ✨',
  '中量月卡': '中量月卡已激活！3200 积分 + 30GB 空间，尽情创作吧 🚀',
  '重量月卡': '重量月卡已激活！10800 积分 + 100GB 空间，你就是我们的超级用户 👑',
  '尝鲜用量包': '尝鲜包已到账！500 积分永久有效，感谢你的信任 🎁',
}

function RedeemCelebration({ result, onClose }: { result: RedeemResult; onClose: () => void }) {
  const particles = useMemo(() => Array.from({ length: 42 }, (_v, index) => ({
    id: index,
    emoji: REDEEM_PARTICLES[index % REDEEM_PARTICLES.length],
    left: Math.random() * 100,
    delay: Math.random() * 2.5,
    duration: 3.2 + Math.random() * 3.2,
    size: 13 + Math.random() * 22,
    sway: Math.random() > 0.5 ? 1 : -1,
  })), [])
  const greeting = REDEEM_GREETINGS[result.planName] ?? `感谢你的支持！${result.credits} 积分已到账 🎉`
  return <div className="redeem-celebration" role="dialog" aria-label="兑换成功">
    <div className="redeem-particles">{particles.map((p) => (
      <span key={p.id} className="redeem-particle" style={{
        left: `${p.left}%`,
        fontSize: `${p.size}px`,
        animationDelay: `${p.delay}s`,
        animationDuration: `${p.duration}s`,
        ['--sway' as string]: p.sway,
      }}>{p.emoji}</span>
    ))}</div>
    <div className="redeem-card">
      <div className="redeem-emoji">🎉</div>
      <h2>兑换成功！</h2>
      <div className="redeem-plan-name"><Sparkles size={15} /> {result.planName}</div>
      <p className="redeem-greeting">{greeting}</p>
      <div className="redeem-rewards">
        <span><Coins size={14} /> {result.credits} 积分{result.kind === 'monthly' ? ' / 月' : ' · 永久'}</span>
        {result.workspaceBytes ? <span><HardDrive size={14} /> 工作区 {Math.round(result.workspaceBytes / 1024 / 1024 / 1024)}GB</span> : null}
      </div>
      <button type="button" className="os-button os-button-primary" onClick={onClose}>太棒了，开始使用 <ArrowRight size={15} /></button>
      <small className="redeem-close-hint">点击任意处关闭</small>
    </div>
  </div>
}

function AfdianView({ onBack }: { onBack: () => void }) {
  const payment = useShellStore((state) => state.payment)
  const afdianHome = payment?.afdianUrl ?? null
  // 2026-08-12 档位数据优先取服务端 payment.tiers（含工作区存储档位），未配置时回退硬编码
  const fallbackTiers = [
    {
      id: 'lite',
      price: '¥9.9',
      name: '轻量月卡',
      credit: '1000 积分 / 月',
      creditValue: '适合日常对话与轻量创作',
      desc: '每月 1000 积分额度，当月用不完自动作废，续费重新给满。',
      featured: false,
      workspaceGB: 10,
      payUrl: 'https://afdian.com/item/2aeac1b692e211f1972b5254001e7c00',
    },
    {
      id: 'mid',
      price: '¥29',
      name: '中量月卡',
      credit: '3200 积分 / 月',
      creditValue: '适合高频使用',
      desc: '每月 3200 积分额度，当月用不完自动作废，续费重新给满。',
      featured: true,
      badge: '更划算',
      workspaceGB: 30,
      payUrl: 'https://afdian.com/item/2c0d304292e211f19b9f5254001e7c00',
    },
    {
      id: 'heavy',
      price: '¥99',
      name: '重量月卡',
      credit: '10800 积分 / 月',
      creditValue: '适合重度创作',
      desc: '每月 10800 积分额度，当月用不完自动作废，续费重新给满。',
      featured: false,
      workspaceGB: 100,
      payUrl: 'https://afdian.com/item/2d295a7892e211f1a2f85254001e7c00',
    },
    {
      id: 'pack',
      price: '¥5',
      name: '尝鲜用量包',
      credit: '500 积分 · 永久',
      creditValue: '一次性购买，永不过期',
      desc: '500 积分永久有效，不限时间；每人限购一次，买完即止。',
      featured: false,
      workspaceGB: null,
      payUrl: 'https://afdian.com/item/7f42517e918511f19bde5254001e7c00',
    },
  ] as const
  const serverTiers = payment?.tiers
  const tiers = serverTiers && serverTiers.length > 0
    ? serverTiers.map((t) => {
        const isMonthly = t.kind === 'monthly'
        const credits = isMonthly ? (t.monthlyCredits ?? 0) : (t.packCredits ?? 0)
        const featured = t.planId === 'f77af912918411f1923c52540025c377'
        return {
          id: t.planId,
          price: `¥${t.priceYuan}`,
          name: t.name,
          credit: isMonthly ? `${credits} 积分 / 月` : `${credits} 积分 · 永久`,
          creditValue: isMonthly ? '适合高频使用' : '一次性购买，永不过期',
          desc: isMonthly
            ? `每月 ${credits} 积分额度，当月用不完自动作废，续费重新给满。`
            : `${credits} 积分永久有效，不限时间；每人限购一次，买完即止。`,
          featured,
          badge: featured ? '更划算' : undefined,
          workspaceGB: t.workspaceBytes ? t.workspaceBytes / 1024 / 1024 / 1024 : null,
          // 2026-08-12 下单直达链接（爱发电 order/create 支付页）；服务端未下发时回退主页
          payUrl: (t as { payUrl?: string | null }).payUrl ?? null,
        }
      })
    : (fallbackTiers as unknown as Array<{ id: string; price: string; name: string; credit: string; creditValue: string; desc: string; featured: boolean; badge?: string; workspaceGB: number | null; payUrl?: string | null }>)
  return <section className="os-screen system-screen afdian-screen">
    <ScreenHeader title="订阅支持" subtitle="支持 Daily 持续迭代" onBack={onBack} right={<Heart size={18} />} />
    <div className="system-scroll afdian-scroll">
      <div className="afdian-hero">
        <div className="afdian-badge"><Heart size={15} /><span>入驻爱发电</span></div>
        <h2>订阅月卡，积分每月到账</h2>
        <p>Daily 的 AI 能力（对话 · 生图 · 视频）都由积分驱动。订阅月卡每月自动发放积分额度，到期作废、续费重新给满；尝鲜包一次性购买、永久有效。付款后请在<b>爱发电订单里查看兑换码</b>，回到<b>个人主页 → 订阅支持 · 兑换码</b>粘贴兑换，权益立即到账。</p>
        {afdianHome
          ? <a className="afdian-home-link" href={afdianHome} target="_blank" rel="noreferrer"><Heart size={13} /> 前往爱发电主页 <ExternalLink size={13} /></a>
          : <div className="afdian-creator-tip"><span>站长还没开通爱发电主页？<a href="https://afdian.com/" target="_blank" rel="noreferrer">前往 afdian.com 成为创作者</a>，开通后把主页链接发给站长配置，这里就会显示真实主页。</span></div>}
      </div>
      <div className="afdian-tiers">
        {tiers.map((tier) => {
          return <a key={tier.id} type="button" className={`afdian-tier ${tier.featured ? 'afdian-tier-featured' : ''}`} href={tier.payUrl ?? afdianHome ?? '#'} target="_blank" rel="noreferrer">
            {tier.featured ? <span className="afdian-tier-badge">{tier.badge}</span> : null}
            <div className="afdian-tier-head">
              <span className="afdian-tier-name">{tier.name}</span>
              <span className="afdian-tier-price">{tier.price}</span>
            </div>
            <div className="afdian-tier-credit"><strong>{tier.credit}</strong><span>{tier.creditValue}</span></div>
            {tier.workspaceGB ? <div className="afdian-tier-storage"><HardDrive size={12} /> 工作区空间 <b>{tier.workspaceGB}GB</b></div> : null}
            <p className="afdian-tier-desc">{tier.desc}</p>
            <span className="afdian-tier-cta"><Heart size={13} /> 去爱发电选择此档位 <ChevronRight size={14} /></span>
          </a>
        })}
      </div>
      <div className="afdian-note"><ShieldCheck size={14} /><span>说明：所有档位均可使用<b>生图、生视频</b>。生图约 2-5 积分/张、生视频 768P 约 25 积分/秒（2K 40 积分/秒，4 秒约 100 积分）。未充值用户（游客/登录未购买）生图限 10 次、视频限 2 次体验；订阅月卡或购买尝鲜包后不限次数（按积分消耗）。</span></div>
      <div className="afdian-note"><HardDrive size={14} /><span>存储：月卡档位含工作区空间（轻量 10GB / 中量 30GB / 重量 100GB），文件、App 素材、AI 生成物均计入。登录用户基础空间 512MB，游客 200MB。若你有大量存储需求，可联系站长<b>单独扩容</b>（微信 fangyan876）。</span></div>
    </div>
  </section>
}

function ProfileView({ onOpenLogin }: { onOpenLogin: () => void }) {
  const session = useShellStore((state) => state.session)
  const guest = useShellStore((state) => state.guest)
  const billing = useShellStore((state) => state.billing)
  const apps = useShellStore((state) => state.apps)
  const payment = useShellStore((state) => state.payment)
  const setView = useShellStore((state) => state.setView)
  const [busy, setBusy] = useState(false)
  // 爱发电订阅全屏页（2026-08-05：套餐卡片「订阅支持」按钮 → 全屏档位页）
  const [afdianOpen, setAfdianOpen] = useState(false)
  // 2026-08-06 积分消耗明细（个人中心：说明积分制 + 列出最近消耗）
  const [history, setHistory] = useState<CreditsHistoryItem[] | null>(null)
  const [historyError, setHistoryError] = useState(false)
  // 2026-08-12 爱发电兑换码：输入 → 兑换 → 成功庆祝动画
  const [redeemCode, setRedeemCode] = useState('')
  const [redeeming, setRedeeming] = useState(false)
  const [redeemError, setRedeemError] = useState<string | null>(null)
  const [redeemResult, setRedeemResult] = useState<RedeemResult | null>(null)
  const redeemInputRef = useRef<HTMLInputElement | null>(null)
  // 2026-08-21 W2：我的 API 包 → 文档/在线调试（owner 级全屏页）
  const [apiCenterOpen, setApiCenterOpen] = useState<boolean>(false)
  // 包体系与统一市场开发者指南全屏页
  const [guideOpen, setGuideOpen] = useState<boolean>(false)
  // 私有包直装（Sideload）弹窗
  const [sideloadOpen, setSideloadOpen] = useState<boolean>(false)
  // 开发者 API Token 弹窗
  const [tokenModalOpen, setTokenModalOpen] = useState<boolean>(false)
  useEffect(() => {
    let cancelled = false
    getCreditsHistory(30)
      .then((res) => { if (!cancelled) setHistory(res.items ?? []) })
      .catch(() => { if (!cancelled) setHistoryError(true) })
    return () => { cancelled = true }
  }, [])
  // 称呼（显示名）编辑
  const [nameDraft, setNameDraft] = useState('')
  const [savingName, setSavingName] = useState(false)
  const [nameSaved, setNameSaved] = useState(false)
  const [nameError, setNameError] = useState<string | null>(null)
  const nameSavedTimerRef = useRef<number | null>(null)
  const loggedIn = session && !session.guest
  const accountEmail = loggedIn ? (session.user.email ?? '') : ''
  const kind = guest?.kind ?? (loggedIn ? 'member' : 'guest')
  const quota = guest?.credits?.quota ?? 0
  const used = guest?.credits?.used ?? 0
  const remaining = guest?.credits?.remaining ?? 0
  const totalRemaining = guest?.credits?.totalRemaining ?? remaining
  const totalPool = Math.max(quota, totalRemaining + used)
  const remainingPercent = totalPool > 0 ? Math.max(0, Math.min(100, Math.round((totalRemaining / totalPool) * 100))) : 0

  const logout = async (): Promise<void> => {
    if (busy) return
    setBusy(true)
    try {
      await useShellStore.getState().logout()
      setView('assistant')
    } finally {
      setBusy(false)
    }
  }

  const saveDisplayName = async (): Promise<void> => {
    if (!loggedIn || savingName) return
    const trimmed = nameDraft.trim().replace(/[\u0000-\u001f\u007f]/g, '')
    if (trimmed.length < 1 || trimmed.length > 20) {
      setNameError('称呼长度需在 1-20 个字符之间')
      return
    }
    setSavingName(true)
    setNameError(null)
    try {
      await updateDisplayName(trimmed)
      // 按钮内反馈「✓ 已保存」（不弹底部 toast）
      setNameSaved(true)
      if (nameSavedTimerRef.current) window.clearTimeout(nameSavedTimerRef.current)
      nameSavedTimerRef.current = window.setTimeout(() => setNameSaved(false), 1600)
      // 刷新 bootstrap（session.user.username 更新为 display_name）
      await useShellStore.getState().refreshBootstrap()
      setNameDraft('')
    } catch (caught) {
      setNameError(caught instanceof Error ? caught.message : '保存失败，请重试')
    } finally {
      setSavingName(false)
    }
  }

  // 2026-08-12 兑换码兑换：成功 → 庆祝动画 + 刷新积分/空间
  const doRedeem = async (): Promise<void> => {
    if (redeeming) return
    const code = redeemCode.trim()
    if (!code) {
      setRedeemError('请输入兑换码')
      redeemInputRef.current?.focus()
      return
    }
    setRedeeming(true)
    setRedeemError(null)
    try {
      const { result } = await redeemAfdianCode(code)
      setRedeemCode('')
      setRedeemResult(result)
      // 刷新积分与工作区空间（bootstrap 重新拉取）
      await useShellStore.getState().refreshBootstrap()
      // 刷新收支明细（兑换记录会出现在列表里）
      getCreditsHistory(30)
        .then((res) => { setHistory(res.items ?? []) })
        .catch(() => { /* 明细失败不打扰庆祝 */ })
    } catch (caught) {
      setRedeemError(caught instanceof Error ? caught.message : '兑换失败，请稍后重试')
    } finally {
      setRedeeming(false)
    }
  }

  return <section className="os-screen system-screen"><ScreenHeader title="个人主页" subtitle="账户与用量" onBack={() => setView('desktop')} right={<UserRound size={18} />} /><div className="system-scroll settings-scroll"><div className="system-intro"><Eyebrow>YOUR DAILY</Eyebrow><h1>你的空间，一目了然。</h1><p>账户、AI 用量、余额与套餐，都在这里。</p></div>

    <Surface className="settings-card account-card"><div className="card-heading"><div><Eyebrow>ACCOUNT</Eyebrow><h2>{loggedIn ? '账号已登录' : '游客身份'}</h2></div><UserRound size={18} /></div><div className="account-line"><span className="avatar-large">{loggedIn ? (session.user.username ?? accountEmail).slice(0, 2).toUpperCase() : (guest?.id.slice(-2).toUpperCase() ?? 'G')}</span><span><strong>{loggedIn ? (session.user.username ?? accountEmail.split('@')[0]) : '本机游客'}</strong><small>{loggedIn ? accountEmail : `ID · ${guest?.id ?? 'guest'}`}</small></span><span className="sync-badge"><span className="status-dot" />{KIND_LABELS[kind] ?? kind}</span></div>{loggedIn ? <>
    <div className="name-edit"><span className="setting-copy"><strong>AI 对话中的称呼</strong><small>AI 会这样叫你（1-20 字）</small></span><div className="name-edit-row"><input className="login-input name-edit-input" maxLength={20} placeholder={session.user.username ?? '输入称呼'} value={nameDraft} onChange={(event) => setNameDraft(event.target.value)} disabled={savingName} /><button type="button" className={`os-button os-button-quiet name-edit-save ${nameSaved ? 'os-button-done' : ''}`} disabled={savingName || nameSaved || !nameDraft.trim()} onClick={() => void saveDisplayName()}>{nameSaved ? <Check size={14} /> : savingName ? <LoaderCircle className="spin" size={14} /> : <Check size={14} />}{nameSaved ? '已保存' : savingName ? '保存中…' : '保存'}</button></div>{nameError ? <p className="html-import-error">{nameError}</p> : null}</div>
    <p className="muted-copy">你的 App、积分与设置保存在账号下；换设备用同一邮箱和密码登录即可恢复。</p><Button variant="quiet" onClick={() => void logout()} disabled={busy}><LogOut size={15} /> 退出登录（回到游客身份）</Button></> : <><p className="muted-copy">登录后获得 1000 积分 额度（游客 100 积分），游客资产会自动迁移到账号。</p><Button variant="quiet" onClick={onOpenLogin}><KeyRound size={15} /> 邮箱登录 / 注册</Button></>}</Surface>

    <Surface className="settings-card"><div className="card-heading"><div><Eyebrow>AI USAGE</Eyebrow><h2>AI 使用情况</h2></div><Sparkles size={18} /></div><div className="token-hero"><span>剩余积分</span><strong>{formatCredits(totalRemaining)}</strong><small>常规额度 {formatCredits(quota)} · 已用 {formatCredits(used)}{guest?.credits?.permanent && guest.credits.permanent.remaining > 0 ? ` · 永久池 ${formatCredits(guest.credits.permanent.remaining)}` : ''}{guest?.credits?.monthly ? ` · ${guest.credits.monthly.planName} ${new Date(guest.credits.monthly.expiresAt).toLocaleDateString('zh-CN')} 到期` : ''}{billing?.peak ? ' · 高峰时段价格 ×2' : ''}</small></div><div className="token-bar"><span style={{ width: `${remainingPercent}%` }} /></div><p className="muted-copy">{guest?.credits?.permanent && guest.credits.permanent.remaining > 0 ? '永久积分（尝鲜用量包）永不过期，优先消耗月卡/常规额度。' : remaining <= 0 ? '积分已用完。可订阅月卡或购买尝鲜用量包，或加站长微信 fangyan876 免费获取。' : `思考档越高消耗越快，用完即止，不会超额扣费。`}</p></Surface>

    {/* 2026-08-12 订阅与兑换卡：从个人中心底部上移到这里（显眼位置）；
        发货机制改为爱发电兑换码（用户主动输入兑换，不再依赖留言邮箱匹配） */}
    <Surface className="settings-card plan-card-featured"><div className="card-heading"><div><Eyebrow>SUPPORT</Eyebrow><h2>订阅支持 · 兑换码</h2></div><Heart size={18} /></div>
      <div className="plan-card"><div><strong>爱发电订阅</strong><small>轻量月卡 ¥9.9（1000 积分/月 + 10GB）· 中量月卡 ¥29（3200 积分/月 + 30GB）· 重量月卡 ¥99（10800 积分/月 + 100GB）· 尝鲜用量包 ¥5（500 积分永久）。在爱发电付款后，<b>在订单里查看兑换码</b>，回到这里粘贴兑换即可到账。</small></div><b>¥9.9 起</b></div>
      <button className="os-button os-button-primary plan-buy" onClick={() => setAfdianOpen(true)}><Heart size={15} /> 查看档位并前往爱发电订阅</button>
      {payment?.afdianUrl ? <a className="os-button os-button-quiet plan-buy" style={{ marginTop: 8 }} href={payment.afdianUrl} target="_blank" rel="noreferrer"><ExternalLink size={14} /> 直接前往爱发电主页 <ExternalLink size={13} /></a> : null}
      {loggedIn ? (
        <div className="redeem-box">
          <div className="redeem-box-head"><span className="redeem-box-title"><QrCode size={14} /> 兑换码兑换</span><small>购买后把兑换码粘贴到这里</small></div>
          <div className="redeem-box-row">
            <input ref={redeemInputRef} className="login-input redeem-input" placeholder="粘贴爱发电兑换码" value={redeemCode} onChange={(event) => setRedeemCode(event.target.value)} disabled={redeeming} onKeyDown={(event) => { if (event.key === 'Enter') void doRedeem() }} maxLength={128} autoCapitalize="off" autoCorrect="off" spellCheck={false} />
            <button type="button" className="os-button os-button-primary redeem-submit" onClick={() => void doRedeem()} disabled={redeeming || !redeemCode.trim()}>{redeeming ? <LoaderCircle className="spin" size={15} /> : <Sparkles size={15} />}{redeeming ? '兑换中…' : '兑换'}</button>
          </div>
          {redeemError ? <p className="html-import-error redeem-error">{redeemError}</p> : null}
          <p className="muted-copy redeem-hint">月卡积分当月用不完自动作废、续费重新给满；尝鲜包永久有效。兑换后立即到账；如遇到问题可加站长微信 <b>fangyan876</b>。</p>
        </div>
      ) : (
        <p className="muted-copy plan-hint">请先登录，再输入兑换码领取权益（游客身份无法保存兑换记录）。<Button variant="quiet" onClick={onOpenLogin}><KeyRound size={14} /> 邮箱登录 / 注册</Button></p>
      )}
    </Surface>

    <Surface className="settings-card"><div className="card-heading"><div><Eyebrow>CREDITS</Eyebrow><h2>积分是怎么算的</h2></div><Coins size={18} /></div><p className="muted-copy"><strong>1 积分 = 0.01 元（1 分钱）</strong>，所有 AI 能力按真实成本折算成积分扣减，用完即止、不会超额扣费：</p><div className="credits-rule"><span className="setting-icon blue"><Sparkles size={15} /></span><span className="setting-copy"><strong>AI 对话</strong><small>按 token 计费，思考档越高消耗越快；高峰时段（9-12 / 14-18 点）×2</small></span></div><div className="credits-rule"><span className="setting-icon blue"><ImageIcon size={15} /></span><span className="setting-copy"><strong>AI 生图</strong><small>按生成 token 计费（约 2-4 积分/张）</small></span></div><div className="credits-rule"><span className="setting-icon blue"><Video size={15} /></span><span className="setting-copy"><strong>AI 视频</strong><small>官方价 5 折：768P 25 积分/秒、2K 40 积分/秒（4 秒 ≈ 100 积分）；视频处理免费</small></span></div><div className="credits-rule"><span className="setting-icon blue"><Search size={15} /></span><span className="setting-copy"><strong>AI 搜索</strong><small>5 积分/次（联网搜索 / 读网页 / 搜索问答）</small></span></div><p className="muted-copy">游客 100 积分，邮箱登录 1000 积分；额度用完可联系站长免费获取（测试阶段）。</p>
{history ? (() => {
        const validHistory = history.filter((item) => item.costMinor !== 0)
        return (
          <div className="credits-history">
            <div className="credits-history-title">
              <span>最近收支</span>
              <span>{validHistory.length > 0 ? `${validHistory.length} 条` : '暂无收支'}</span>
            </div>
            {validHistory.length === 0 ? (
              <p className="muted-copy credits-history-empty">暂无扣费/充值记录</p>
            ) : (
              <div className="credits-history-list">
                {validHistory.map((item, idx) => (
                  <div className="credits-history-item" key={`${item.kind}-${item.createdAt}-${idx}`}>
                    <span className={`credits-kind credits-kind-${item.kind}`}>
                      {item.kind === 'chat' ? '对话' : item.kind === 'image' ? '生图' : item.kind === 'video_ir' ? '增强' : item.kind === 'video_edit' ? '处理' : item.kind === 'recharge_pack' ? '充值' : item.kind === 'recharge_monthly' ? '月卡' : item.kind === 'api' ? 'API' : '视频'}
                    </span>
                    <span className="credits-history-main">
                      <strong>{item.label}</strong>
                      <small>
                        {new Date(item.createdAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                        {item.detail ? ` · ${item.detail}` : ''}
                        {item.status !== 'ok' ? ` · ${item.errorCode ?? item.status}` : ''}
                      </small>
                    </span>
                    {item.costMinor < 0 ? (
                      <span className="credits-cost credits-cost-income">+{formatCredits(-item.costMinor)}</span>
                    ) : (
                      <span className="credits-cost">-{formatCredits(item.costMinor)}</span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )
      })() : historyError ? <p className="muted-copy credits-history-empty">收支明细加载失败，请稍后刷新重试</p> : <p className="muted-copy credits-history-empty">正在加载收支明细…</p>}
    </Surface>

    {afdianOpen ? <AfdianView onBack={() => setAfdianOpen(false)} /> : null}
    {apiCenterOpen ? <AppApiCenter onBack={() => setApiCenterOpen(false)} /> : null}
    {guideOpen ? <PackageMarketGuideCenter onBack={() => setGuideOpen(false)} onOpenSideload={() => setSideloadOpen(true)} onOpenApiToken={() => setTokenModalOpen(true)} /> : null}
    {sideloadOpen ? (
      <PackageSideloadModal
        onClose={() => setSideloadOpen(false)}
        onInstalled={() => {
          void useShellStore.getState().refreshBootstrap()
        }}
      />
    ) : null}
    {tokenModalOpen ? (
      <ApiTokenModal onClose={() => setTokenModalOpen(false)} />
    ) : null}

    <Surface className="settings-card">
      <div className="card-heading">
        <div>
          <Eyebrow>DEVELOPER & PACKAGES</Eyebrow>
          <h2>包体系与私有部署</h2>
        </div>
        <BookOpen size={18} />
      </div>
      <p className="muted-copy" style={{ marginTop: 8, marginBottom: 2 }}>
        支持 13 种包类型与 App API。既可查看开发文档，也可免进市场直接将私有包（运维、NAS、自定义 API）部署至个人工作区。
      </p>
        <button className="link-row" onClick={() => setGuideOpen(true)}>
        <span className="setting-icon blue">
          <BookOpen size={16} />
        </span>
        <span className="setting-copy">
          <strong>包体系与市场开发指南</strong>
          <small>daily.pkg.json v2 规范 · 13 种包类型 · App API · 统一市场 REST 接口</small>
        </span>
        <ChevronRight size={16} />
      </button>
      <button className="link-row" onClick={() => setSideloadOpen(true)} style={{ marginTop: 6 }}>
        <span className="setting-icon blue">
          <Upload size={16} />
        </span>
        <span className="setting-copy">
          <strong>导入私有包（Sideload 直装）</strong>
          <small>0 审核 · 绕过市场 · ZIP/目录直接导入部署至私有工作区</small>
        </span>
        <ChevronRight size={16} />
      </button>
      {loggedIn ? (
        <button className="link-row" onClick={() => setTokenModalOpen(true)} style={{ marginTop: 6 }}>
          <span className="setting-icon blue">
            <KeyRound size={16} />
          </span>
          <span className="setting-copy">
            <strong>开发者 API Token 凭证</strong>
            <small>查看与复制持久 JWT Token · 用于 HTTP API 与外部 AI 直传</small>
          </span>
          <ChevronRight size={16} />
        </button>
      ) : null}
    </Surface>

    <Surface className="settings-card"><div className="card-heading"><div><Eyebrow>CONTACT</Eyebrow><h2>联系站长 · 分享讨论</h2></div><MessageCircle size={18} /></div><p className="muted-copy">遇到问题、想要更多额度，或想一起交流玩法与想法，欢迎加站长：</p><div className="contact-row"><span className="setting-icon ink"><MessageCircle size={16} /></span><span className="setting-copy"><strong>QQ</strong><small>2893334965 · 加好友时备注「Daily」</small></span></div><div className="contact-row"><span className="setting-icon blue"><MessageCircle size={16} /></span><span className="setting-copy"><strong>微信</strong><small>fangyan876 · 额度 / 购买相关</small></span></div></Surface>

    <Surface className="settings-card"><div className="card-heading"><div><Eyebrow>SYSTEM SERVICES</Eyebrow><h2>系统入口</h2></div><Grid2X2 size={18} /></div><button className="link-row" onClick={() => setView('files')}><span className="setting-icon blue"><Folder size={16} /></span><span className="setting-copy"><strong>文件工作区</strong><small>上传文件与素材，AI 可直接使用（{apps.filter((app) => app.source !== 'builtin').length} 个 App）</small></span><ChevronRight size={16} /></button>{session?.user.role === 'admin' ? <a className="link-row" href="https://admin.shadowshub.xyz" target="_blank" rel="noreferrer"><span className="setting-icon ink"><TerminalSquare size={16} /></span><span className="setting-copy"><strong>管理后台</strong><small>用户、用量与额度管理（admin.shadowshub.xyz）</small></span><ExternalLink size={15} /></a> : null}</Surface>

    {loggedIn ? <Surface className="settings-card"><div className="card-heading"><div><Eyebrow>MY API</Eyebrow><h2>我的 API 包</h2></div><Code2 size={18} /></div><p className="muted-copy" style={{ marginTop: 8, marginBottom: 2 }}>自己或别人装给你的 api 包：端点文档 + 在线调试，每次调用扣 1 积分。</p><button className="link-row" onClick={() => setApiCenterOpen(true)}><span className="setting-icon blue"><Code2 size={16} /></span><span className="setting-copy"><strong>API 文档 / 在线调试</strong><small>列出本账号 type=api 的包，逐端点看参数与 storage 范围并试调（游客不参与 API 互通体系，R13）</small></span><ChevronRight size={16} /></button></Surface> : null}
    <Surface className="settings-card privacy-card"><div className="card-heading"><div><Eyebrow>PRIVACY</Eyebrow><h2>权限边界</h2></div><ShieldCheck size={18} /></div><div className="privacy-row"><ShieldCheck size={15} /><span>第三方 App 仅可申请 <code>app.storage.private</code></span><Check size={14} /></div><div className="privacy-row"><TerminalSquare size={15} /><span>无 JWT、宿主 DOM 或真实文件路径暴露</span><Check size={14} /></div><div className="privacy-row"><Square size={15} /><span>首版只提供文字交互</span><Check size={14} /></div></Surface>
    {redeemResult ? <RedeemCelebration result={redeemResult} onClose={() => setRedeemResult(null)} /> : null}
  </div></section>
}

/* ============================================================================ */
/* W2 API 文档 / 在线调试（2026-08-21）：『我的 API 包』owner 级入口             */
/*   列表：GET /webos/api/packages?type=api（PackageListItem 摘要）             */
/*   文档：GET /webos/api/appapi/:namespace（端点清单，不含 handler 代码体）     */
/*   调试：POST /webos/api/appapi/:ns/:ep（受限 vm 执行，成功扣 1 积分）         */
/* ============================================================================ */
interface ApiEndpointDoc {
  name: string
  method?: string
  path: string
  description?: string
  params?: unknown
  storage?: { read?: string[]; write?: string[] }
  visibility?: string
}
interface ApiNamespaceSpec {
  ok?: boolean
  namespace?: string
  displayName?: string
  network?: { domains?: string[] }
  secrets?: string[]
  endpoints?: ApiEndpointDoc[]
}

/** 端点 params JSON Schema → 调试参数默认值（只取带 default 的字段） */
function apiDefaultParams(params: unknown): Record<string, unknown> {
  const p = params as { properties?: Record<string, { type?: string; default?: unknown }> } | undefined
  if (!p || typeof p !== 'object' || !p.properties) return {}
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(p.properties)) {
    if (v && typeof v === 'object' && 'default' in v) out[k] = (v as { default?: unknown }).default
  }
  return out
}

/** 单端点在线调试：参数 JSON 编辑 + 调用端点（扣 1 积分） */
function ApiEndpointDebug({ namespace, endpoint }: { namespace: string; endpoint: ApiEndpointDoc }) {
  const [paramsText, setParamsText] = useState(() => JSON.stringify(apiDefaultParams(endpoint.params), null, 2))
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ result: unknown; costMinor: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const run = async (): Promise<void> => {
    if (busy) return
    setBusy(true)
    setResult(null)
    setError(null)
    try {
      const parsed: Record<string, unknown> = paramsText.trim() ? JSON.parse(paramsText) as Record<string, unknown> : {}
      const res = await invokeAppApi(namespace, endpoint.name, parsed)
      setResult(res)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '调用失败')
    } finally {
      setBusy(false)
    }
  }
  return <div className="api-debug">
    <div className="api-debug-label">在线调试<small>每次成功调用扣 1 积分（kind='api'）</small></div>
    <textarea value={paramsText} onChange={(e) => setParamsText(e.target.value)} spellCheck={false} placeholder='{ "参数": "值" }' aria-label={`调试 ${endpoint.name} 参数`} />
    <div className="api-debug-actions">
      <button type="button" className="os-button os-button-primary" disabled={busy} onClick={() => { void run() }}>{busy ? <LoaderCircle className="spin" size={13} /> : null}{busy ? '调用中…' : '调用端点'}</button>
      <button type="button" className="os-button" onClick={() => setParamsText('{}')}>清空</button>
    </div>
    {error ? <pre className="api-code api-debug-error">{error}</pre> : null}
    {result ? <pre className="api-code api-debug-result">{JSON.stringify(result, null, 2)}</pre> : null}
  </div>
}

/** 端点卡片：方法徽标 + 名称 + visibility + params/storage 文档，展开后可调试 */
function ApiEndpointCard({ namespace, endpoint, open, onToggle }: {
  namespace: string
  endpoint: ApiEndpointDoc
  open: boolean
  onToggle: () => void
}) {
  const method = endpoint.method ?? 'GET'
  const vis = endpoint.visibility ?? 'owner'
  const read = endpoint.storage?.read ?? []
  const write = endpoint.storage?.write ?? []
  return <div className="api-endpoint api-card">
    <button type="button" className="api-ep-head" onClick={onToggle} aria-expanded={open}>
      <span className={`api-method api-method-${method.toLowerCase()}`}>{method}</span>
      <span className="api-ep-name">{endpoint.name}</span>
      <span className={`api-vis api-vis-${vis}`}>{vis === 'public' ? 'PUBLIC' : 'OWNER'}</span>
      <span className={`api-ep-chev ${open ? 'api-ep-chev-open' : ''}`}><ChevronRight size={15} /></span>
    </button>
    <div className="api-ep-path">{endpoint.path}</div>
    {endpoint.description ? <p className="api-ep-desc">{endpoint.description}</p> : null}
    {(read.length > 0 || write.length > 0) ? <div className="api-scope"><Database size={12} /><span>数据范围 · 读：{read.length ? read.join('、') : '—'} / 写：{write.length ? write.join('、') : '—'}</span></div> : null}
    {open ? <div className="api-ep-more">
      <div className="api-meta-label">params（params JSON Schema）</div>
      <pre className="api-code">{JSON.stringify(endpoint.params ?? {}, null, 2)}</pre>
      <ApiEndpointDebug namespace={namespace} endpoint={endpoint} />
    </div> : null}
  </div>
}

/** 命名空间文档页：namespace 切换 + 端点清单 + 每端点在线调试 */
function ApiNamespaceDoc({ item }: { item: WebOsPackageListItem }) {
  const [nsInput, setNsInput] = useState(item.id)
  const [ns, setNs] = useState(item.id)
  const [spec, setSpec] = useState<ApiNamespaceSpec | null | 'loading'>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [openEp, setOpenEp] = useState<string | null>(null)
  const load = (n: string): void => {
    const target = n.trim() || item.id
    setNs(target)
    setSpec('loading')
    setLoadError(null)
    getAppApiSpec(target)
      .then((r) => setSpec(r as unknown as ApiNamespaceSpec))
      .catch((e) => { setSpec(null); setLoadError(e instanceof Error ? e.message : '加载失败') })
  }
  useEffect(() => {
    load(item.id)
    // 首次进入自动加载一次；切换 namespace 走「重新加载」按钮
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id])
  const ready = spec && spec !== 'loading' ? spec : null
  return <div className="system-intro">
    <div className="api-ns-bar">
      <div className="api-ns-field">
        <label>namespace</label>
        <input value={nsInput} onChange={(e) => setNsInput(e.target.value)} spellCheck={false} aria-label="命名空间" />
      </div>
      <button type="button" className="os-button" onClick={() => load(nsInput)}>重新加载</button>
    </div>
    {loadError ? <div className="api-warn">{loadError}<span>（确认 api.json 里的 namespace 与包 id 一致；或手动输入后重新加载）</span></div> : null}
    {spec === 'loading' ? <div className="api-loading"><LoaderCircle className="spin" size={15} /> 读取 {ns} 的端点清单…</div> : null}
    {ready ? <div className="api-ns-meta">
      <div className="api-meta-line">
        <span><strong>{ready.displayName ?? ready.namespace ?? ns}</strong></span>
        {ready.network?.domains?.length ? <span>network：{ready.network.domains.join('、')}</span> : null}
        <span>secrets：{ready.secrets?.length ? ready.secrets.join('、') : '无'}</span>
      </div>
      <div className="api-meta-count">{ready.endpoints?.length ?? 0} 个端点 · PUBLIC 端点可在 W3 市场发布后供他人安装调用</div>
    </div> : null}
    {ready && ready.endpoints && ready.endpoints.length > 0 ? ready.endpoints.map((ep) => (
      <ApiEndpointCard key={ep.name} namespace={ns} endpoint={ep} open={openEp === ep.name} onToggle={() => setOpenEp(openEp === ep.name ? null : ep.name)} />
    )) : null}
    {ready && !(ready.endpoints?.length) ? <div className="empty-file"><div className="empty-file-icon"><Code2 size={22} /></div><strong>该命名空间没有端点</strong><p>确认 api.json 里有 endpoints 声明，并已通过契约校验。</p></div> : null}
  </div>
}

/** 「我的 API 包」入口页：列出本人 type=api 包 → 进入命名空间文档/调试 */
function AppApiCenter({ onBack }: { onBack: () => void }) {
  const [items, setItems] = useState<WebOsPackageListItem[] | null | 'error'>(null)
  const [selected, setSelected] = useState<WebOsPackageListItem | null>(null)
  useEffect(() => {
    let cancelled = false
    listPackages('api')
      .then((res) => { if (!cancelled) setItems(res.items ?? []) })
      .catch(() => { if (!cancelled) setItems('error') })
    return () => { cancelled = true }
  }, [])
  return <section className="os-screen system-screen">
    <ScreenHeader
      title={selected ? 'API 端点文档' : '我的 API 包'}
      subtitle={selected ? selected.displayName : 'owner 级 · 文档与在线调试'}
      onBack={() => { if (selected) setSelected(null); else onBack() }}
      right={selected ? null : <Code2 size={18} />}
    />
    <div className="system-scroll">
      {selected
        ? <ApiNamespaceDoc item={selected} />
        : <div className="system-intro">
            <Eyebrow>MY API PACKAGES</Eyebrow>
            <h1>你的 API 包</h1>
            <p>「AI 造了 App 却不知道里面有什么」的解法：每个 api 包声明端点（参数 / storage 读写范围），系统自动生成可调用端点与文档。这里逐端点查看并在线调试（每次成功调用扣 1 积分）。</p>
            {items === null ? <div className="api-loading"><LoaderCircle className="spin" size={15} /> 正在加载…</div> : null}
            {items === 'error' ? <div className="api-warn">获取 API 包列表失败，请稍后重试。</div> : null}
            {items && items.length === 0 ? <div className="empty-file"><div className="empty-file-icon"><Code2 size={22} /></div><strong>还没有 API 包</strong><p>在对话里让 AI 按「文件夹即包」创建 <code>packages/&lt;id&gt;/daily.pkg.json</code>（type=api）+ <code>api.json</code> 与 handler，系统会自动注册并建立版本。</p></div> : null}
            {items && typeof items !== 'string' && items.length > 0 ? <div className="api-list">
              {items.map((p) => (
                <button key={p.id} type="button" className="link-row api-list-row" onClick={() => setSelected(p)}>
                  <span className="setting-icon blue"><Code2 size={16} /></span>
                  <span className="setting-copy"><strong>{p.displayName}</strong><small>{p.id}{p.version ? ` · v${p.version}` : ''}</small></span>
                  <ChevronRight size={16} />
                </button>
              ))}
            </div> : null}
          </div>}
    </div>
  </section>
}

/* ============================================================================ */
/* 包体系与统一市场开发者指南（通用全景文档）                                    */
/* ============================================================================ */
function PackageMarketGuideCenter({ onBack, onOpenSideload, onOpenApiToken }: { onBack: () => void; onOpenSideload?: () => void; onOpenApiToken?: () => void }) {
  const [tab, setTab] = useState<'manifest' | 'types' | 'api' | 'http' | 'checklist'>('manifest')
  const [copiedKey, setCopiedKey] = useState<string | null>(null)

  const copyCode = (key: string, text: string) => {
    void copyTextToClipboard(text).then((ok) => {
      if (ok) {
        setCopiedKey(key)
        window.setTimeout(() => setCopiedKey(null), 1500)
      }
    })
  }

  const manifestExample = `{
  "schema_version": 2,
  "id": "com.example.myapp",
  "type": "app",
  "version": "1.0.0",
  "entry": "index.html",
  "display_name": { "zh": "我的应用", "en": "My App" },
  "description": { "zh": "应用描述说明", "en": "App description" },
  "icon": "icon.svg",
  "capabilities": ["app.storage.private"],
  "network": { "domains": ["api.example.com"] },
  "dependencies": [{ "id": "com.daily.audio-tools", "range": "^1.0.0" }],
  "contents": {
    "skills": ["skills/guide/SKILL.md"],
    "mcp": [],
    "tools": ["tools/helper.js"],
    "tokens": {},
    "assets": ["assets/icon.png"]
  },
  "children": [],
  "minShell": "0.1.0"
}`

  const apiJsonExample = `{
  "schema_version": 1,
  "namespace": "todo",
  "display_name": { "zh": "待办清单服务" },
  "network": { "domains": ["api.todo-cloud.com"] },
  "secrets": ["TODO_AUTH_TOKEN"],
  "endpoints": [
    {
      "name": "list_todos",
      "method": "GET",
      "path": "/items",
      "description": { "zh": "获取待办列表" },
      "params": {
        "type": "object",
        "properties": { "completed": { "type": "boolean" } }
      },
      "storage": { "read": ["todos/*"], "write": [] },
      "handler": "handlers/list_items.js",
      "returns": { "type": "object" },
      "visibility": "public"
    }
  ]
}`

  const handlerExample = `// handlers/list_items.js (受限 Node vm 沙箱，无 process/require/fs)
async function main(ctx) {
  const { completed } = ctx.params || {};
  const allTodos = await ctx.storage.get('todos/list') || [];
  const result = typeof completed === 'boolean'
    ? allTodos.filter(item => item.completed === completed)
    : allTodos;
  return { ok: true, data: result };
}`

  return (
    <section className="os-screen system-screen">
      <ScreenHeader
        title="包体系与市场开发指南"
        subtitle="Universal AI & Developer Spec"
        onBack={onBack}
        right={
          onOpenSideload ? (
            <button
              type="button"
              className="os-button os-button-quiet"
              style={{ padding: '0 8px', fontSize: '11px', minHeight: '30px' }}
              onClick={onOpenSideload}
            >
              <Upload size={13} style={{ marginRight: 2 }} /> 导入
            </button>
          ) : (
            <BookOpen size={18} />
          )
        }
      />
      <div className="system-scroll">
        <div className="system-intro">
          <Eyebrow>DEVELOPER DOCUMENTATION</Eyebrow>
          <h1>包体系与市场开发指南</h1>
          <p>
            Daily webOS「一切皆包 · 组合式包」统一规范：适用于平台内部 AI、任何外部 AI（Claude Code / Cursor / Windsurf / GPT）以及人类开发者。
          </p>
          {onOpenSideload ? (
            <div style={{ marginTop: 10 }}>
              <button type="button" className="os-button os-button-primary" onClick={onOpenSideload}>
                <Upload size={14} style={{ marginRight: 4 }} /> 导入私有包（Sideload 0 审核直装）
              </button>
            </div>
          ) : null}
        </div>

        <div className="thinking-options" style={{ marginBottom: 16 }}>
          <button className={tab === 'manifest' ? 'selected' : ''} onClick={() => setTab('manifest')}>
            <span>Manifest 清单</span>
            <small>daily.pkg.json</small>
          </button>
          <button className={tab === 'types' ? 'selected' : ''} onClick={() => setTab('types')}>
            <span>13 种包类型</span>
            <small>app / api / skill...</small>
          </button>
          <button className={tab === 'api' ? 'selected' : ''} onClick={() => setTab('api')}>
            <span>App API</span>
            <small>api.json + handler</small>
          </button>
          <button className={tab === 'http' ? 'selected' : ''} onClick={() => setTab('http')}>
            <span>市场 HTTP 接口</span>
            <small>上传 / 发布 / 安装</small>
          </button>
          <button className={tab === 'checklist' ? 'selected' : ''} onClick={() => setTab('checklist')}>
            <span>安全自检清单</span>
            <small>沙箱与合规</small>
          </button>
        </div>

        {tab === 'manifest' && (
          <Surface className="settings-card">
            <div className="card-heading">
              <div>
                <Eyebrow>MANIFEST SPEC V2</Eyebrow>
                <h2>daily.pkg.json 规范</h2>
              </div>
              <IconButton label="复制示例" onClick={() => copyCode('manifest', manifestExample)}>
                {copiedKey === 'manifest' ? <Check size={16} /> : <Copy size={16} />}
              </IconButton>
            </div>
            <p className="muted-copy">每个包根目录下必须包含 daily.pkg.json（组合式包 v2 契约）：</p>
            <pre className="file-preview-text" style={{ maxHeight: '420px', overflow: 'auto' }}>
              {manifestExample}
            </pre>
          </Surface>
        )}

        {tab === 'types' && (
          <Surface className="settings-card">
            <div className="card-heading">
              <div>
                <Eyebrow>PACKAGE TYPES</Eyebrow>
                <h2>13 种包类型速查</h2>
              </div>
              <Grid2X2 size={18} />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 12 }}>
              {[
                { type: 'app', entry: 'index.html', desc: '完整 HTML/CSS/JS 静态交互应用，在沙箱 WebView/iframe 运行' },
                { type: 'api', entry: 'api.json', desc: '服务端受限 vm 执行的数据/计算服务，自动注册为 AI Tool' },
                { type: 'skill', entry: 'SKILL.md', desc: '智能体提示词技能与操作规范，直接注入 Agent 上下文' },
                { type: 'theme', entry: 'tokens 声明', desc: '全局 UI 设计变量、壁纸与色彩覆盖' },
                { type: 'toolpkg', entry: 'main.js', desc: '自定义 JS 工具代码包，注册到 Agent 工具调用链' },
                { type: 'bundle', entry: '无（纯组合容器）', desc: '多能力/多子包聚合分发容器，递归安装依赖闭包' },
                { type: 'mcp', entry: 'contents.mcp', desc: '外部 MCP Server 服务桥接' },
                { type: 'workflow', entry: 'workflow.json', desc: '多步骤自动化任务调度流程' },
                { type: 'subagent', entry: 'agent.md', desc: '专职子智能体定义与独立进程池' },
                { type: 'url-app', entry: 'url.startUrl', desc: '外部受信任网页封装（直连/快照）' },
                { type: 'pet-layer', entry: 'index.html', desc: '桌面共享动态 Canvas / 互动组件图层' },
                { type: 'provider', entry: 'provider.json', desc: 'AI 模型与外部服务接入配置' },
                { type: 'model-pack', entry: '预设清单', desc: '模型预设与系统参数包' },
              ].map((item) => (
                <div key={item.type} className="link-row" style={{ alignItems: 'flex-start' }}>
                  <span className="setting-icon blue" style={{ marginTop: 2 }}>
                    <Code2 size={14} />
                  </span>
                  <span className="setting-copy">
                    <strong>{item.type}</strong>
                    <small>入口：{item.entry} · {item.desc}</small>
                  </span>
                </div>
              ))}
            </div>
          </Surface>
        )}

        {tab === 'api' && (
          <>
            <Surface className="settings-card">
              <div className="card-heading">
                <div>
                  <Eyebrow>API SPECIFICATION</Eyebrow>
                  <h2>api.json 声明</h2>
                </div>
                <IconButton label="复制示例" onClick={() => copyCode('apiJson', apiJsonExample)}>
                  {copiedKey === 'apiJson' ? <Check size={16} /> : <Copy size={16} />}
                </IconButton>
              </div>
              <pre className="file-preview-text" style={{ maxHeight: '300px', overflow: 'auto' }}>
                {apiJsonExample}
              </pre>
            </Surface>
            <Surface className="settings-card">
              <div className="card-heading">
                <div>
                  <Eyebrow>SANDBOX HANDLER</Eyebrow>
                  <h2>受限 Handler 编写</h2>
                </div>
                <IconButton label="复制示例" onClick={() => copyCode('handler', handlerExample)}>
                  {copiedKey === 'handler' ? <Check size={16} /> : <Copy size={16} />}
                </IconButton>
              </div>
              <pre className="file-preview-text" style={{ maxHeight: '200px', overflow: 'auto' }}>
                {handlerExample}
              </pre>
            </Surface>
          </>
        )}

        {tab === 'http' && (
          <>
            <Surface className="settings-card">
              <div className="card-heading">
                <div>
                  <Eyebrow>API CREDENTIALS</Eyebrow>
                  <h2>开发者 API Token 凭证</h2>
                </div>
                <KeyRound size={18} />
              </div>
              <p className="muted-copy" style={{ marginTop: 8, marginBottom: 12 }}>
                外部脚本、CI/CD 自动化或本地 Agent 调用 HTTP API 时，需在 Header 中携带此 JWT Token。
              </p>
              {onOpenApiToken ? (
                <button type="button" className="os-button os-button-primary" onClick={onOpenApiToken}>
                  <KeyRound size={14} style={{ marginRight: 4 }} /> 查看与复制我的 API Token
                </button>
              ) : null}
            </Surface>
            <Surface className="settings-card">
              <div className="card-heading">
                <div>
                  <Eyebrow>REST API & PUBLISH</Eyebrow>
                  <h2>标准 HTTP 接口速查</h2>
                </div>
                <Globe size={18} />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 12 }}>
                <div className="privacy-row">
                  <span style={{ fontFamily: 'monospace', fontWeight: 'bold' }}>POST /webos/api/packages</span>
                  <span>创建/批量上传私有包（0 审核直装）</span>
                </div>
                <div className="privacy-row">
                  <span style={{ fontFamily: 'monospace', fontWeight: 'bold' }}>POST /webos/api/market/publish</span>
                  <span>将包发布上架到统一市场</span>
                </div>
                <div className="privacy-row">
                  <span style={{ fontFamily: 'monospace', fontWeight: 'bold' }}>GET /webos/api/market?type=&q=</span>
                  <span>按类型与关键词浏览搜索市场</span>
                </div>
                <div className="privacy-row">
                  <span style={{ fontFamily: 'monospace', fontWeight: 'bold' }}>POST /webos/api/market/:id/install</span>
                  <span>安装包并自动安装依赖闭包</span>
                </div>
              </div>
            </Surface>
          </>
        )}

        {tab === 'checklist' && (
          <Surface className="settings-card">
            <div className="card-heading">
              <div>
                <Eyebrow>COMPLIANCE</Eyebrow>
                <h2>AI 开发安全自检清单</h2>
              </div>
              <ShieldCheck size={18} />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 12 }}>
              <div className="privacy-row">
                <ShieldCheck size={15} />
                <span>Manifest 的 id、version (SemVer)、type (13种之一) 必须合法</span>
                <Check size={14} />
              </div>
              <div className="privacy-row">
                <ShieldCheck size={15} />
                <span>禁用 eval()、禁访内网 IP / localhost（防 SSRF）</span>
                <Check size={14} />
              </div>
              <div className="privacy-row">
                <ShieldCheck size={15} />
                <span>API Handler 禁用 Node 模块，一律使用 ctx.* 沙箱接口</span>
                <Check size={14} />
              </div>
              <div className="privacy-row">
                <ShieldCheck size={15} />
                <span>密钥严禁硬编码，走 api.json secrets 并在 handler 中脱敏读取</span>
                <Check size={14} />
              </div>
              <div className="privacy-row">
                <ShieldCheck size={15} />
                <span>单包体积上限 10MB，HTML 素材一律使用相对路径</span>
                <Check size={14} />
              </div>
            </div>
          </Surface>
        )}
      </div>
    </section>
  )
}

/** 开发者 API Token 凭证弹窗（支持一键查看/复制持久 JWT Token 及 curl 上传代码范例） */
function ApiTokenModal({ onClose }: { onClose: () => void }) {
  const [token, setToken] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [copiedCurl, setCopiedCurl] = useState(false)

  useEffect(() => {
    let cancelled = false
    getUserApiToken()
      .then((res) => {
        if (!cancelled) {
          setToken(res.token)
          setLoading(false)
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : '获取 Token 失败')
          setLoading(false)
        }
      })
    return () => { cancelled = true }
  }, [])

  const copyToken = () => {
    if (!token) return
    void copyTextToClipboard(token).then((ok) => {
      if (ok) {
        setCopied(true)
        window.setTimeout(() => setCopied(false), 1600)
      }
    })
  }

  const curlExample = token ? `curl -X POST https://shadowshub.xyz/webos/api/packages \\
  -H "Authorization: Bearer ${token}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "manifest": {
      "schema_version": 2,
      "id": "com.my.tool",
      "type": "app",
      "version": "1.0.0",
      "display_name": { "zh": "我的应用" }
    },
    "files": {
      "index.html": "<!DOCTYPE html><html><body><h1>Hello webOS</h1></body></html>"
    }
  }'` : ''

  const copyCurl = () => {
    if (!curlExample) return
    void copyTextToClipboard(curlExample).then((ok) => {
      if (ok) {
        setCopiedCurl(true)
        window.setTimeout(() => setCopiedCurl(false), 1600)
      }
    })
  }

  return (
    <div className="login-overlay" onClick={onClose}>
      <div className="login-panel" style={{ maxWidth: '500px' }} onClick={(event) => event.stopPropagation()}>
        <div className="login-heading">
          <span className="setting-icon blue" style={{ width: 34, height: 34, borderRadius: 10 }}>
            <KeyRound size={18} />
          </span>
          <div>
            <strong>开发者 API Token 凭证</strong>
            <small>用于 HTTP API 调用、CI/CD 自动化与外部 AI 开发</small>
          </div>
          <button type="button" className="login-close" aria-label="关闭" onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        <div className="login-step">
          {loading ? (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px 0', gap: 8, color: 'var(--muted)' }}>
              <LoaderCircle className="spin" size={16} /> 正在获取 API Token…
            </div>
          ) : error ? (
            <div className="login-error" style={{ margin: 0 }}>
              {error}
            </div>
          ) : (
            <>
              <div>
                <label className="login-label">你的 Bearer JWT Token：</label>
                <div style={{ position: 'relative', marginTop: 4 }}>
                  <textarea
                    className="login-input"
                    style={{
                      height: '84px',
                      fontFamily: 'monospace',
                      fontSize: '11px',
                      padding: '8px 10px',
                      wordBreak: 'break-all',
                      resize: 'none',
                    }}
                    readOnly
                    value={token ?? ''}
                  />
                </div>
                <button
                  type="button"
                  className={`os-button os-button-primary ${copied ? 'os-button-done' : ''}`}
                  style={{ width: '100%', marginTop: 8 }}
                  onClick={copyToken}
                >
                  {copied ? <Check size={14} style={{ marginRight: 4 }} /> : <Copy size={14} style={{ marginRight: 4 }} />}
                  {copied ? '已复制 Token 到剪贴板' : '复制 API Token'}
                </button>
              </div>

              <div style={{ marginTop: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                  <label className="login-label">直接在终端运行的上传示例（curl）：</label>
                  <button type="button" className="login-link" onClick={copyCurl}>
                    {copiedCurl ? '✓ 已复制' : '复制 curl 命令'}
                  </button>
                </div>
                <pre
                  className="file-preview-text"
                  style={{
                    maxHeight: '160px',
                    overflow: 'auto',
                    fontSize: '11px',
                    margin: 0,
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-all',
                  }}
                >
                  {curlExample}
                </pre>
              </div>

              <p className="muted-copy" style={{ fontSize: '11px', margin: 0, marginTop: 4 }}>
                此 Token 具备你当前账号的完全读写权限，请妥善保管。在 HTTP 请求中通过请求头 <code>Authorization: Bearer &lt;Token&gt;</code> 携带。
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

/** 私有包直装导入弹窗（Sideload：绕过市场，0 审核直达私有工作区） */
function PackageSideloadModal({
  onClose,
  onInstalled,
}: {
  onClose: () => void
  onInstalled?: (pkgId: string) => void
}) {
  const [manifest, setManifest] = useState<Record<string, unknown> | null>(null)
  const [files, setFiles] = useState<Record<string, string>>({})
  const [packageName, setPackageName] = useState<string>('')
  const [packageId, setPackageId] = useState<string>('')
  const [fileCount, setFileCount] = useState<number>(0)
  const [mode, setMode] = useState<'upload' | 'manual'>('upload')

  const [manifestText, setManifestText] = useState(`{
  "schema_version": 2,
  "id": "com.my.server-monitor",
  "type": "api",
  "version": "1.0.0",
  "display_name": { "zh": "私有服务器监控 API" },
  "network": { "domains": ["api.your-server.com"] },
  "secrets": ["SERVER_TOKEN"],
  "api": { "spec": "api.json" }
}`)
  const [filesText, setFilesText] = useState(`{
  "api.json": "{\\n  \\"schema_version\\": 1,\\n  \\"namespace\\": \\"monitor\\",\\n  \\"display_name\\": { \\"zh\\": \\"服务器监控\\" },\\n  \\"endpoints\\": [\\n    {\\n      \\"name\\": \\"status\\",\\n      \\"method\\": \\"GET\\",\\n      \\"path\\": \\"/status\\",\\n      \\"handler\\": \\"handlers/status.js\\",\\n      \\"visibility\\": \\"owner\\"\\n    }\\n  ]\\n}",
  "handlers/status.js": "async function main(ctx) {\\n  // 调私有服务器 HTTP 接口\\n  // const res = await ctx.http.get('https://api.your-server.com/metrics');\\n  return { ok: true, cpu: 15, memory: 48, status: 'healthy' };\\n}"
}`)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [successMsg, setSuccessMsg] = useState<string | null>(null)
  const zipInputRef = useRef<HTMLInputElement | null>(null)
  const folderInputRef = useRef<HTMLInputElement | null>(null)

  // 处理 ZIP 文件解压
  const handleZipFile = async (file: File) => {
    setBusy(true)
    setError(null)
    setSuccessMsg(null)
    try {
      const buffer = await file.arrayBuffer()
      const unzipped = unzipSync(new Uint8Array(buffer))
      const fileMap: Record<string, string> = {}
      let foundManifest: Record<string, unknown> | null = null

      for (const [rawPath, u8] of Object.entries(unzipped)) {
        if (rawPath.endsWith('/') || rawPath.startsWith('__MACOSX/')) continue
        const cleanPath = rawPath.replace(/^[^/]+\//, '') // 去除顶层目录包裹
        const targetPath = unzipped['daily.pkg.json'] ? rawPath : cleanPath
        const content = strFromU8(u8)

        if (rawPath === 'daily.pkg.json' || rawPath.endsWith('/daily.pkg.json')) {
          try {
            foundManifest = JSON.parse(content) as Record<string, unknown>
          } catch {
            /* 格式异常 */
          }
        }
        fileMap[targetPath] = content
      }

      if (!foundManifest && unzipped['daily.pkg.json']) {
        foundManifest = JSON.parse(strFromU8(unzipped['daily.pkg.json'])) as Record<string, unknown>
      }

      if (!foundManifest) {
        throw new Error('未在 ZIP 压缩包根目录找到 daily.pkg.json 清单文件')
      }

      setManifest(foundManifest)
      setFiles(fileMap)
      setManifestText(JSON.stringify(foundManifest, null, 2))
      setFilesText(JSON.stringify(fileMap, null, 2))
      const disp = typeof foundManifest.display_name === 'object' ? String((foundManifest.display_name as { zh?: string })?.zh || foundManifest.id) : String(foundManifest.id)
      setPackageName(disp)
      setPackageId(String(foundManifest.id || ''))
      setFileCount(Object.keys(fileMap).length)
      setSuccessMsg(`已成功解析 ZIP 包「${disp}」(${foundManifest.id})，包含 ${Object.keys(fileMap).length} 个文件，可直接点击安装。`)
    } catch (err) {
      setError(err instanceof Error ? err.message : '解压 ZIP 包失败')
    } finally {
      setBusy(false)
      if (zipInputRef.current) zipInputRef.current.value = ''
    }
  }

  // 处理文件夹/多文件选择
  const handleFileList = async (fileList: FileList) => {
    setBusy(true)
    setError(null)
    setSuccessMsg(null)
    try {
      const fileMap: Record<string, string> = {}
      let foundManifest: Record<string, unknown> | null = null

      for (let i = 0; i < fileList.length; i++) {
        const file = fileList[i]!
        const relPath = file.webkitRelativePath ? file.webkitRelativePath.replace(/^[^/]+\//, '') : file.name
        const text = await file.text()
        fileMap[relPath] = text
        if (relPath === 'daily.pkg.json' || file.name === 'daily.pkg.json') {
          try {
            foundManifest = JSON.parse(text) as Record<string, unknown>
          } catch {
            /* 格式异常 */
          }
        }
      }

      if (!foundManifest) {
        throw new Error('未在选择的文件中找到 daily.pkg.json 清单文件')
      }

      setManifest(foundManifest)
      setFiles(fileMap)
      setManifestText(JSON.stringify(foundManifest, null, 2))
      setFilesText(JSON.stringify(fileMap, null, 2))
      const disp = typeof foundManifest.display_name === 'object' ? String((foundManifest.display_name as { zh?: string })?.zh || foundManifest.id) : String(foundManifest.id)
      setPackageName(disp)
      setPackageId(String(foundManifest.id || ''))
      setFileCount(Object.keys(fileMap).length)
      setSuccessMsg(`已成功解析目录「${disp}」(${foundManifest.id})，包含 ${Object.keys(fileMap).length} 个文件。`)
    } catch (err) {
      setError(err instanceof Error ? err.message : '读取文件列表失败')
    } finally {
      setBusy(false)
      if (folderInputRef.current) folderInputRef.current.value = ''
    }
  }

  const submit = async () => {
    if (busy) return
    setBusy(true)
    setError(null)
    setSuccessMsg(null)
    try {
      let finalManifest: unknown = manifest
      let finalFiles: Record<string, string> | undefined = files

      if (mode === 'manual' || !finalManifest) {
        finalManifest = JSON.parse(manifestText.trim()) as unknown
        if (filesText.trim()) {
          finalFiles = JSON.parse(filesText.trim()) as Record<string, string>
        }
      }

      const res = await createPackage({ manifest: finalManifest, files: finalFiles })
      if (res.ok) {
        setSuccessMsg(`私有包 ${res.id} 导入安装成功！已部署至 packages/${res.id}/ 并激活使用。`)
        if (onInstalled) onInstalled(res.id)
        window.setTimeout(() => {
          onClose()
        }, 1200)
      } else {
        setError(res.feedback || '导入校验失败')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'JSON 格式解析失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="html-import-panel" style={{ maxWidth: '540px' }} onClick={(e) => e.stopPropagation()}>
        <div className="panel-heading">
          <strong>导入私有包（Sideload 直装）</strong>
          <button type="button" aria-label="关闭" onClick={onClose}>
            <X size={15} />
          </button>
        </div>
        <p className="muted-copy" style={{ margin: '0 0 12px', fontSize: '11px' }}>
          0 审核 · 绕过市场 · 直接将私有包（运维脚本、私有 NAS 接口、个性化 App）部署至个人工作区。
        </p>

        {/* 隐藏的 File Input */}
        <input
          ref={zipInputRef}
          type="file"
          accept=".zip"
          style={{ display: 'none' }}
          onChange={(e) => {
            if (e.target.files && e.target.files[0]) void handleZipFile(e.target.files[0])
          }}
        />
        <input
          ref={folderInputRef}
          type="file"
          multiple
          style={{ display: 'none' }}
          onChange={(e) => {
            if (e.target.files && e.target.files.length > 0) void handleFileList(e.target.files)
          }}
        />

        {/* 顶部模式切换 */}
        <div className="thinking-options" style={{ marginBottom: 12 }}>
          <button className={mode === 'upload' ? 'selected' : ''} onClick={() => setMode('upload')}>
            <span>文件 / ZIP 上传</span>
            <small>推荐 · 一键解包</small>
          </button>
          <button className={mode === 'manual' ? 'selected' : ''} onClick={() => setMode('manual')}>
            <span>手动编辑代码</span>
            <small>JSON / 源码粘贴</small>
          </button>
        </div>

        {mode === 'upload' ? (
          <div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, margin: '10px 0' }}>
              <button
                type="button"
                className="os-button os-button-quiet"
                style={{ height: '70px', flexDirection: 'column', gap: 4 }}
                onClick={() => zipInputRef.current?.click()}
                disabled={busy}
              >
                <Upload size={20} style={{ color: 'var(--blue)' }} />
                <strong>选择 ZIP 压缩包</strong>
                <small style={{ color: 'var(--muted)', fontSize: '9px' }}>支持包含 daily.pkg.json 的 zip</small>
              </button>

              <button
                type="button"
                className="os-button os-button-quiet"
                style={{ height: '70px', flexDirection: 'column', gap: 4 }}
                onClick={() => folderInputRef.current?.click()}
                disabled={busy}
              >
                <Folder size={20} style={{ color: 'var(--blue)' }} />
                <strong>选择包目录 / 多个文件</strong>
                <small style={{ color: 'var(--muted)', fontSize: '9px' }}>多选文件或选择文件夹</small>
              </button>
            </div>

            {packageId ? (
              <div style={{ background: 'rgba(79,110,247,0.06)', border: '1px solid rgba(79,110,247,0.2)', borderRadius: 12, padding: 12, marginTop: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  <span className="setting-icon blue"><Code2 size={16} /></span>
                  <div>
                    <strong>{packageName}</strong> <span style={{ fontSize: '11px', color: 'var(--muted)' }}>({packageId})</span>
                  </div>
                </div>
                <div style={{ fontSize: '11px', color: 'var(--muted)', marginTop: 4 }}>
                  已就绪 · 共包含 {fileCount} 个文件（含 daily.pkg.json）
                </div>
              </div>
            ) : (
              <div style={{ textAlign: 'center', padding: '16px 0', color: 'var(--muted)', fontSize: '11px' }}>
                请选择本地包工程的 ZIP 压缩包或代码目录
              </div>
            )}
          </div>
        ) : (
          <div>
            <label className="login-label" style={{ marginBottom: 4 }}>
              Manifest (daily.pkg.json)
            </label>
            <textarea
              className="html-import-code"
              style={{ height: '110px', marginBottom: 8 }}
              value={manifestText}
              onChange={(e) => setManifestText(e.target.value)}
              disabled={busy}
            />
            <label className="login-label" style={{ marginBottom: 4 }}>
              源码文件表 JSON（键为相对路径，值为代码文本）
            </label>
            <textarea
              className="html-import-code"
              style={{ height: '110px' }}
              value={filesText}
              onChange={(e) => setFilesText(e.target.value)}
              disabled={busy}
            />
          </div>
        )}

        {error && <p className="html-import-error">{error}</p>}
        {successMsg && <p style={{ color: 'var(--green)', fontSize: '11px', margin: '8px 0 0' }}>{successMsg}</p>}
        <div className="panel-actions" style={{ marginTop: 14 }}>
          <button type="button" className="panel-cancel" onClick={onClose} disabled={busy}>
            取消
          </button>
          <button type="button" className="panel-submit" onClick={() => void submit()} disabled={busy || (mode === 'upload' && !manifest && !manifestText)}>
            {busy ? '正在导入部署…' : '立即私有安装'}
          </button>
        </div>
      </div>
    </div>
  )
}

function AppRuntime({ app }: { app: WebOsApp }) {
  const activeVersion = app.versions.find((version) => version.id === app.activeVersionId) ?? app.versions[0]
  // 2026-08-07 bootstrap 瘦身：用户 App 的 HTML 不再随 bootstrap 下发（空串），
  // 打开时按需 GET /apps/:appId 拉取（服务端 payload 1.6MB → 几十 KB）。
  // 2026-08-07 打开提速：本地缓存上次打开的 HTML（localStorage），再次打开秒开
  // （先渲染缓存，后台拉最新覆盖，App 更新后自动刷新内容）。
  const appHtmlCacheKey = (appId: string): string => `daily-webos-app-html:${appId}`
  // 2026-08-13 缓存版本校验：缓存的 versionId ≠ 当前 activeVersionId 时**不渲染缓存**
  // （AI 已发布新版本但本地缓存是旧版——此前先渲染缓存再后台覆盖，用户会短暂看到
  //  旧版甚至误以为"修复没生效"；现在版本不一致直接等新版本加载）。
  const readCachedHtml = (): { html: string; versionId: string } | null => {
    try {
      const cached = localStorage.getItem(appHtmlCacheKey(app.id))
      if (cached) {
        const parsed = JSON.parse(cached) as { html?: string; versionId?: string }
        if (parsed && typeof parsed.html === 'string' && parsed.html) {
          const expectedVersion = activeVersion?.id
          if (expectedVersion && parsed.versionId && parsed.versionId !== expectedVersion) {
            return null // 缓存版本过期：不用缓存，等待拉取最新
          }
          return { html: parsed.html, versionId: parsed.versionId ?? '' }
        }
      }
    } catch { /* 忽略 */ }
    return null
  }
  const cached = readCachedHtml()
  const cachedHtml = cached?.html ?? null
  const [detailHtml, setDetailHtml] = useState<string | null>(activeVersion?.html ? activeVersion.html : cachedHtml)
  const [detailLoading, setDetailLoading] = useState<boolean>(!activeVersion?.html && !cachedHtml)
  const [detailError, setDetailError] = useState<string | null>(null)
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const runtimeRef = useRef<WebOsRuntimeHandle | null>(null)
  const [runtimeError, setRuntimeError] = useState<string | null>(null)
  // 2026-08-12 数据保存修复：打开 App 前预取私有存储快照，随 bootstrap 同步注入
  // （App 初始化时 localStorage 即有历史数据，不再"退出重进就空"）。
  // 拉取失败/超时（1.5s）不阻塞打开——connect 后的 hydrate 兜底。
  const [storageSnapshot, setStorageSnapshot] = useState<Record<string, unknown> | null>(null)
  const [snapshotReady, setSnapshotReady] = useState(false)

  useEffect(() => {
    let cancelled = false
    setSnapshotReady(false)
    setStorageSnapshot(null)
    const timer = window.setTimeout(() => {
      if (!cancelled) setSnapshotReady(true)
    }, 1500)
    getAppStorage(app.id)
      .then((result) => {
        if (cancelled) return
        setStorageSnapshot(result.items ?? null)
        setSnapshotReady(true)
      })
      .catch(() => {
        if (cancelled) return
        setSnapshotReady(true)
      })
      .finally(() => window.clearTimeout(timer))
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [app.id])

  // 2026-08-07 按需拉取 App HTML（bootstrap 瘦身后用户 App 的 html 为空）
  useEffect(() => {
    if (activeVersion?.html) {
      setDetailHtml(activeVersion.html)
      setDetailLoading(false)
      setDetailError(null)
      return
    }
    let cancelled = false
    setDetailLoading(true)
    setDetailError(null)
    getAppDetail(app.id)
      .then((detail) => {
        if (cancelled) return
        // 服务端返回 { app } 包装（2026-08-07 按需拉取）
        const appDetail = (detail as { app?: typeof detail }).app ?? detail
        const version = appDetail.versions?.find((candidate) => candidate.id === appDetail.activeVersionId) ?? appDetail.versions?.[0]
        const html = version?.html ?? null
        setDetailHtml(html)
        setDetailLoading(false)
        if (html) {
          try {
            localStorage.setItem(appHtmlCacheKey(app.id), JSON.stringify({ versionId: version?.id ?? '', html, ts: Date.now() }))
          } catch { /* 配额满忽略 */ }
        }
      })
      .catch((caught) => {
        if (cancelled) return
        setDetailError(caught instanceof Error ? caught.message : 'App 加载失败')
        setDetailLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [app.id, activeVersion?.html])

  // 2026-08-06「文件夹即 App」：传入 app.id → App 文件夹即资源根，相对路径素材自动可用
  const srcDoc = useMemo(
    () => withRuntimeBootstrap(detailHtml ?? '', app.id, undefined, snapshotReady ? storageSnapshot : null),
    [detailHtml, app.id, snapshotReady, storageSnapshot],
  )

  useEffect(() => {
    const iframe = iframeRef.current
    if (!iframe || !detailHtml) return
    const runtime = createRuntimeChannel(iframe, {
      app: { id: app.id, name: app.name, activeVersionId: app.activeVersionId },
      versionId: activeVersion?.id ?? app.activeVersionId ?? '',
      capabilities: activeVersion?.capabilities ?? [],
    }, (kind, payload) => {
      if (kind === 'error' && 'message' in payload) setRuntimeError(payload.message)
    })
    runtimeRef.current = runtime
    return () => {
      runtime.destroy()
      runtimeRef.current = null
    }
  }, [app.id, app.name, app.activeVersionId, activeVersion?.id, activeVersion?.capabilities, detailHtml, srcDoc])

  // 沉浸式全屏：无顶部栏、无返回键（退出靠系统返回键）
  if (detailLoading) {
    return <section className="os-screen runtime-screen"><div className="app-loading"><LoaderCircle className="spin" size={20} /><span>正在打开 {app.name}…</span></div></section>
  }
  if (detailError) {
    return <section className="os-screen runtime-screen"><div className="runtime-error" role="alert"><X size={15} /> {detailError}</div></section>
  }
  if (!detailHtml) {
    return <section className="os-screen runtime-screen"><div className="runtime-error" role="alert"><X size={15} /> 这个系统 App 没有 HTML 运行版本。</div></section>
  }
  return <section className="os-screen runtime-screen">
    {runtimeError ? <div className="runtime-error" role="alert"><X size={15} /> {runtimeError}</div> : null}
    <iframe ref={iframeRef} className="app-frame" sandbox="allow-scripts" srcDoc={srcDoc} title={`${app.name} 运行`} />
  </section>
}
type ScreenView = 'assistant' | 'desktop' | 'files' | 'profile' | 'app' | 'store' | 'experience'
function CurrentView({ onOpenLogin }: { onOpenLogin: () => void }) {
  const activeView = useShellStore((state) => state.activeView)
  const activeAppId = useShellStore((state) => state.activeAppId)
  const apps = useShellStore((state) => state.apps)
  if (activeView === 'assistant') return <AssistantHome onOpenLogin={onOpenLogin} />
  if (activeView === 'desktop') return <DesktopView onOpenLogin={onOpenLogin} />
  if (activeView === 'store') return <StoreView onOpenLogin={onOpenLogin} />
  if (activeView === 'experience') return <ExperienceView onOpenLogin={onOpenLogin} />
  if (activeView === 'files') return <FilesView />
  if (activeView === 'profile') return <ProfileView onOpenLogin={onOpenLogin} />
  const app = apps.find((candidate) => candidate.id === activeAppId)
  return app ? <AppRuntime app={app} /> : <DesktopView onOpenLogin={onOpenLogin} />
}

export default function App() {
  const boot = useShellStore((state) => state.boot)
  const booting = useShellStore((state) => state.booting)
  const ready = useShellStore((state) => state.ready)
  const error = useShellStore((state) => state.error)
  const activeView = useShellStore((state) => state.activeView)
  const [showLogin, setShowLogin] = useState(false)
  useEffect(() => { void boot() }, [boot])

  // 2026-08-14 切回前台恢复 AI 实时渲染：移动端切后台（锁屏/切 app）时浏览器
  // 可能冻结或掐断 SSE fetch 流（不抛错、不推数据、也不触发 45s 空闲超时），
  // 回到前台后若无主动恢复，页面会一直停在"停止渲染"状态（任务其实还在后台跑）。
  // 这里在 visibilitychange 恢复可见时，先 abort 旧连接（触发 catch 清理
  // streamingConvs），再对正在 streaming 的会话调 resumeConversation——
  // SSE 重连 + 服务端重放任务缓冲，实时接管渲染；无任务时返回 none 零副作用。
  useEffect(() => {
    const onVisibility = (): void => {
      if (document.visibilityState !== 'visible') return
      const { streamingConvs, activeConversationId, resumeConversation } = useShellStore.getState()
      const streamingIds = Object.keys(streamingConvs)
      const ids = streamingIds.length > 0 ? streamingIds : (activeConversationId ? [activeConversationId] : [])
      if (ids.length === 0) return
      // 先 abort 旧的（可能僵死的）SSE 连接——resumeConversation 检查
      // streamingConvs[id] 存在会短路跳过，必须让 catch 清理后再重连
      for (const id of ids) {
        try { streamingConvs[id]?.abort() } catch { /* ignore */ }
      }
      // abort 是异步触发 catch，微任务后 streamingConvs 才被清理；用 setTimeout 0
      // 等待本帧结束再 resume（服务端任务缓冲仍在，重连即可接管渲染）
      window.setTimeout(() => {
        for (const id of ids) {
          void useShellStore.getState().resumeConversation(id)
        }
      }, 0)
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [])

  // 分享体验链接（2026-08-03）：?exp=<shareId> → 打开后直接进入体验页
  useEffect(() => {
    try {
      const shareId = new URLSearchParams(window.location.search).get('exp')
      if (shareId && useShellStore.getState().ready) {
        useShellStore.getState().setView('experience')
      }
    } catch { /* ignore */ }
  }, [ready])

  // 定制加载页展示时长：仅当工作区存在定制 boot.html 时才执行展示等待；
  // 默认情况下只要 bootstrap ready 立即进入主界面，秒开直达，拒绝假等待三连跳。
  const bootConfig = useShellStore((state) => state.bootConfig)
  const [bootHeld, setBootHeld] = useState(false)
  const bootStartRef = useRef(Date.now())
  const bootScheduledRef = useRef(false)
  const bootTimerRef = useRef<number | null>(null)
  useEffect(() => {
    if (!ready || bootScheduledRef.current) return
    bootScheduledRef.current = true
    if (!bootConfig?.html) return
    const wait = Math.max(0, (bootConfig.durationMs || 0) - (Date.now() - bootStartRef.current))
    if (wait <= 60) return
    setBootHeld(true)
    bootTimerRef.current = window.setTimeout(() => {
      setBootHeld(false)
      bootTimerRef.current = null
    }, wait)
  }, [ready, bootConfig])

  const showBootScreen = (booting && !ready) || bootHeld

  // 系统返回键：进入任意子页面（App / 文件 / 设置 / 余额）时压入 history 占位；
  // 返回键（浏览器后退 / Android 硬件返回）触发 popstate → 退出到桌面。
  // assistant / desktop 为顶层视图，不压栈（返回键直接退出应用）。
  // App 间跳转（apps.open）也会压栈：A → B → 返回 → A → 返回 → 桌面。
  const isSubView = activeView !== 'assistant' && activeView !== 'desktop'
  useEffect(() => {
    if (isSubView) {
      const appId = activeView === 'app' ? useShellStore.getState().activeAppId : undefined
      window.history.pushState({ appView: true, appId }, '')
    }
  }, [isSubView ? 'sub' : 'root'])
  useEffect(() => {
    const onPopState = (event: PopStateEvent): void => {
      const state = useShellStore.getState()
      if (state.activeView !== 'assistant' && state.activeView !== 'desktop') {
        const historyState = event.state as { appId?: string } | null
        // 从 App B 返回：history 栈顶是 App A 的占位 → 回到 App A；否则回桌面
        if (historyState?.appId && state.apps.some((app) => app.id === historyState.appId)) {
          state.setView('app', historyState.appId)
        } else {
          state.setView('desktop')
        }
      }
    }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  // App 间跳转：SDK DailyWebOs.apps.open(appId) → 宿主打开目标 App（再压一栈，返回键可回）
  useEffect(() => {
    setRuntimeOpenApp((appId) => {
      const state = useShellStore.getState()
      if (state.activeView === 'app') {
        window.history.pushState({ appView: true, appId }, '')
      }
      state.setView('app', appId)
    })
    return () => setRuntimeOpenApp(null)
  }, [])

  // 拒绝用户随意缩放屏幕（双指捏合 / Ctrl+滚轮 / iOS 双击缩放），保证桌面与 App 布局稳定
  useEffect(() => {
    const preventDefault = (event: Event): void => event.preventDefault()
    const onWheel = (event: WheelEvent): void => { if (event.ctrlKey || event.metaKey) event.preventDefault() }
    const onTouchMove = (event: TouchEvent): void => { if (event.touches.length > 1) event.preventDefault() }
    const onKeyDown = (event: KeyboardEvent): void => {
      if ((event.ctrlKey || event.metaKey) && ['+', '-', '=', '0'].includes(event.key)) event.preventDefault()
    }
    document.addEventListener('gesturestart', preventDefault)
    document.addEventListener('gesturechange', preventDefault)
    document.addEventListener('gestureend', preventDefault)
    document.addEventListener('wheel', onWheel, { passive: false })
    document.addEventListener('touchmove', onTouchMove, { passive: false })
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('gesturestart', preventDefault)
      document.removeEventListener('gesturechange', preventDefault)
      document.removeEventListener('gestureend', preventDefault)
      document.removeEventListener('wheel', onWheel)
      document.removeEventListener('touchmove', onTouchMove)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [])

  if (showBootScreen) return <BootScreen />
  if (error && !ready) return <ErrorScreen message={error} />
  return <div className="shell-root"><div className="shell-stage"><CurrentView onOpenLogin={() => setShowLogin(true)} /></div><Toasts />{showLogin ? <LoginPanel onClose={() => setShowLogin(false)} /> : null}</div>
}
