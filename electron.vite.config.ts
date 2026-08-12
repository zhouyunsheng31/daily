import { resolve } from 'path'
import { fileURLToPath } from 'url'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const __dirname = fileURLToPath(new URL('.', import.meta.url))

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'client/desktop/electron/main/index.ts'),
        },
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'client/desktop/electron/preload/index.ts'),
        },
      },
    },
  },
  renderer: {
    root: resolve(__dirname, 'client/desktop'),
    publicDir: resolve(__dirname, 'client/desktop/public'),
    envDir: resolve(__dirname, '.'),
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'client/desktop/index.html'),
        },
        output: {
          // Phase 15 批次5：manualChunks 拆分 vendor 包（spec 7.2.2 节）
          // - react-vendor: react, react-dom
          // - katex: katex（LaTeX 渲染库，LatexQuiz 用，首屏不需要）
          // - pdfjs: pdfjs-dist（PDF 渲染库，PdfViewer 用，首屏不需要）
          // - lucide: lucide-react（图标库，单独 chunk 避免打入 react-vendor）
          // - ui-vendor: zustand 等状态管理库
          // - vendor: 其他 node_modules
          manualChunks(id) {
            if (!id.includes('node_modules')) return
            // katex 优先判断（spec 7.2.2 单独 chunk）
            if (id.includes('katex')) return 'katex'
            // pdfjs 单独 chunk（spec 7.2.2，首屏不加载）
            if (id.includes('pdfjs-dist')) return 'pdfjs'
            // lucide 单独 chunk（spec 7.2.2）
            if (id.includes('lucide-react')) return 'lucide'
            // ui-vendor：zustand 等状态库
            if (id.includes('zustand')) return 'ui-vendor'
            // react-vendor：react-dom 单独判断，react 用路径边界匹配避免误判
            if (id.includes('react-dom')) return 'react-vendor'
            if (id.includes('react-router')) return 'react-vendor'
            if (/[\\/]node_modules[\\/]react[\\/]/.test(id)) return 'react-vendor'
            // 其他 node_modules 统一归到 vendor
            return 'vendor'
          },
        },
      },
    },
    resolve: {
      alias: {
        '@': resolve(__dirname, 'client/desktop/src'),
        'shared': resolve(__dirname, 'shared'),
      },
    },
    plugins: [react(), tailwindcss()],
    server: {
      port: 5173,
      proxy: {
        '/api': {
          target: 'http://localhost:3456',
          changeOrigin: true,
          configure: (proxy) => {
            proxy.on('proxyReq', (proxyReq) => {
              // dev 模式下剥离 Origin 头，避免后端 auth 中间件拒绝（401）
              proxyReq.removeHeader('origin')
            })
          },
        },
        '/ws': {
          target: 'ws://localhost:3456',
          ws: true,
          changeOrigin: true,
          configure: (proxy) => {
            // WebSocket 升级请求触发 proxyReqWs 事件（非 proxyReq）
            proxy.on('proxyReqWs', (proxyReq) => {
              // dev 模式下剥离 Origin 头，避免后端 WS verifyClient 拒绝（401）
              proxyReq.removeHeader('origin')
            })
          },
        },
        '/llm-proxy/api.st0722.top': {
          target: 'https://api.st0722.top',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/llm-proxy\/api\.st0722\.top/, ''),
          secure: true,
        },
        '/llm-proxy/chat.st0722.top': {
          target: 'https://chat.st0722.top',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/llm-proxy\/chat\.st0722\.top/, ''),
          secure: true,
        },
        '/llm-proxy/api.stepfun.com': {
          target: 'https://api.stepfun.com',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/llm-proxy\/api\.stepfun\.com/, ''),
          secure: true,
        },
      },
    },
  },
})
