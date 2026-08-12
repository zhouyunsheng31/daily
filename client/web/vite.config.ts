import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  // S15: 生产部署在 /daily/ 子路径，构建时通过 VITE_BASE_PATH=/daily/ 注入
  // 开发模式不设置该变量，base 默认为 '/'，访问 localhost:5173/ 即可
  base: process.env.VITE_BASE_PATH || '/',
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': {
        target: 'http://localhost:3456',
        changeOrigin: true,
      },
      '/ws': {
        target: 'ws://localhost:3456',
        ws: true,
        changeOrigin: true,
      },
      '/backgrounds': {
        target: 'http://localhost:3456',
        changeOrigin: true,
      },
    },
  },
})
