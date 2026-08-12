const CACHE_NAME = 'daily-webos-shell-v0.1.4'
// 相对路径：按 sw.js 所在目录（/daily/）解析，兼容子路径部署
const APP_SHELL = ['./manifest.webmanifest']

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key)),
      ))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const request = event.request
  const url = new URL(request.url)

  // API and SSE calls must always reach the server. Never cache credentials,
  // balances, generated App data, or a streaming response.
  if (request.method !== 'GET' || url.pathname.startsWith('/api/') || url.pathname.startsWith('/webos/api/')) return
  // 页面导航（HTML）始终走网络：避免发版后缓存旧 HTML 导致白屏。
  if (request.mode === 'navigate') return

  // 2026-08-03 改为 network-first：先请求网络（发版后第一次刷新即拿到新
  // bundle），失败才回退缓存（离线可用）。此前 stale-while-revalidate 会让
  // 旧 hash 的 JS 在被缓存期间持续返回旧版，导致发版后用户看不到新功能。
  event.respondWith(
    fetch(request).then((response) => {
      if (response.ok && response.type === 'basic') {
        const copy = response.clone()
        void caches.open(CACHE_NAME).then((cache) => cache.put(request, copy))
      }
      return response
    }).catch(() => caches.match(request).then((cached) => cached || caches.match('./index.html'))),
  )
})