import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath, URL } from 'node:url'

// base 防回归（2026-08-01 白屏事故）：
// 生产构建默认 /daily/（与线上部署路径一致），漏配 VITE_BASE_PATH 也不会
// 产出错误的绝对路径 /assets/...（nginx 根 location 会拦截返回欢迎页 HTML 导致白屏）。
// dev 模式用 /（本地 5174 直接访问）；显式传 VITE_BASE_PATH 可覆盖。
export default defineConfig(({ command }) => ({
  base: process.env.VITE_BASE_PATH || (command === 'build' ? '/daily/' : '/'),
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@shared': fileURLToPath(new URL('../../shared', import.meta.url)),
    },
  },
  server: {
    port: 5174,
    strictPort: true,
    proxy: {
      '/api': { target: 'http://localhost:3456', changeOrigin: true },
      '/webos': { target: 'http://localhost:3456', changeOrigin: true },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    // 老设备兼容（2026-08-20）：Android 10 自带 WebView（Chrome ~78）与 iPhone 6S
    // /老 iPad（iOS <14 的 Safari）对 es2020 语法（?. ?? ??= ||=）会整段解析失败 → 白屏。
    // 显式降到 es2018，让 esbuild 把新语法转译为老内核可解析的低版本代码；
    // （CSS 产物经检查无 oklch/@layer 等现代特性，是干净的，无需处理。）
    target: 'es2018',
  },
}))