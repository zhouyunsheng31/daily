import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'

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
