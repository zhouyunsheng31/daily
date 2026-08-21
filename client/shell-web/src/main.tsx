import React from 'react'
import ReactDOM from 'react-dom/client'

// ---------------------------------------------------------------------------
// 老设备兼容（2026-08-20）：crypto.randomUUID 需要 Chrome 92+ / Safari 15.4+。
// Android 10 WebView 与 iPhone 6S（iOS <15.4）没有该方法，而启动路径
// store.ts 的 deviceId() 会直接调用 → 必须在任何业务代码执行前补上兼容实现。
// ---------------------------------------------------------------------------
{
  const legacyCrypto = (typeof crypto !== 'undefined' ? crypto : undefined) as
    | { randomUUID?: () => string; getRandomValues?: (buffer: Uint8Array) => void }
    | undefined
  if (legacyCrypto && typeof legacyCrypto.randomUUID !== 'function') {
    legacyCrypto.randomUUID = (): string => {
      const bytes = new Uint8Array(16)
      if (typeof legacyCrypto.getRandomValues === 'function') {
        legacyCrypto.getRandomValues(bytes)
      } else {
        // 极老环境兜底（非加密用途，设备 ID 足够）
        for (let i = 0; i < 16; i += 1) bytes[i] = Math.floor(Math.random() * 256)
      }
      bytes[6] = (bytes[6] & 0x0f) | 0x40
      bytes[8] = (bytes[8] & 0x3f) | 0x80
      const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0'))
      return `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-${hex.slice(6, 8).join('')}-${hex.slice(8, 10).join('')}-${hex.slice(10).join('')}`
    }
  }
}
// ---------------------------------------------------------------------------

import App from './App'

// ---------------------------------------------------------------------------
// 老设备兜底（2026-08-20）：启动崩溃可视化。不依赖 React / 任何新 API（纯 DOM），
// 只在 #root 仍为空时把捕获到的 error/unhandledrejection 或"疑似内核过旧"提示
// 显示成可见提示条——避免老设备再次遇到隐形崩溃时只看到橙色背景无从排查。
// 正常设备 #root 已渲染内容，本兜底完全不干预。
// ---------------------------------------------------------------------------
{
  const showFatal = (text: string): void => {
    try {
      const rootEl = document.getElementById('root')
      const empty = !rootEl || rootEl.childElementCount === 0
      if (!empty) return
      const box = document.createElement('div')
      box.textContent = text.slice(0, 400)
      box.style.cssText = 'position:fixed;left:12px;right:12px;bottom:12px;z-index:99999;color:#7c2d12;background:#ffedd5;border:1px solid #fdba74;border-radius:10px;padding:10px 12px;font:12px/1.5 -apple-system,sans-serif;white-space:pre-wrap;box-shadow:0 4px 16px rgba(0,0,0,.15)'
      document.body.appendChild(box)
    } catch { /* noop */ }
  }
  const shownFlags: string[] = []
  const recordFatal = (text: string): void => {
    if (shownFlags.includes(text)) return
    shownFlags.push(text)
    showFatal(text)
  }
  window.addEventListener('error', (event) => {
    if (event && event.message) recordFatal(`JS 错误: ${event.message}`)
  })
  window.addEventListener('unhandledrejection', (event) => {
    const reason = event && event.reason instanceof Error
      ? `${event.reason.name}: ${event.reason.message}`
      : String(event && event.reason)
    recordFatal(`未处理 Promise 错误: ${reason}`)
  })
  window.setTimeout(() => {
    const rootEl = document.getElementById('root')
    if (!rootEl || rootEl.childElementCount === 0) {
      recordFatal('页面未能启动。若持续如此，可能是浏览器/系统版本过旧（需 iOS 15+ / Android WebView Chrome 80+）。请复制本提示并刷新重试。')
    }
  }, 8000)
}
// ---------------------------------------------------------------------------

function registerServiceWorker(): void {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return

  window.addEventListener('load', () => {
    // 相对路径注册：兼容 /daily/ 等子路径部署（scope 解析为当前目录）
    void navigator.serviceWorker.register('./sw.js', { scope: './' }).catch((error: unknown) => {
      // PWA enhancement must never prevent the shell from starting.
      console.warn('[webOS] service worker registration failed', error)
    })
  }, { once: true })
}

const root = document.getElementById('root')
if (!root) throw new Error('Daily webOS root element is missing')

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)

registerServiceWorker()
