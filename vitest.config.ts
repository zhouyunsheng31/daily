/**
 * Vitest 独立配置（Phase 11.1）
 *
 * 设计要点：
 * 1. 独立于 electron.vite.config.ts，避免干扰 electron-vite 的 build/dev
 * 2. environment: happy-dom（轻量 DOM 模拟，比 jsdom 快）
 * 3. exclude thinkingLevel.test.ts（Phase 9 的自定义断言脚本，非 vitest 格式，
 *    遵守"不修改 Phase 9/10 代码"规则，通过 exclude 而非适配处理）
 * 4. alias '@' 与 electron.vite.config.ts renderer 保持一致
 */
import { resolve } from 'path'
import { fileURLToPath } from 'url'
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

const __dirname = fileURLToPath(new URL('.', import.meta.url))

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'happy-dom',
    setupFiles: ['./client/desktop/src/test/setup.ts'],
    include: [
      'client/desktop/src/**/*.{test,spec}.{ts,tsx}',
      'client/desktop/electron/**/*.{test,spec}.{ts,tsx}',
      'e2e/**/*.spec.ts',
      // Phase 13.2.2：服务端单测（仅匹配 *.test.ts / *.spec.ts，不影响 server/test/*-test.ts 脚本）
      'server/test/**/*.{test,spec}.ts',
    ],
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/out/**',
      // Phase 9 自定义断言脚本，非 vitest 格式，避免误扫描报错
      'client/desktop/src/utils/__tests__/thinkingLevel.test.ts',
      // Phase 14 D1：Playwright Electron 测试（用 playwright run，非 vitest）
      'e2e/**/*.spec.ts',
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['client/desktop/src/**/*.{ts,tsx}'],
      exclude: [
        'client/desktop/src/**/*.{test,spec}.{ts,tsx}',
        'client/desktop/src/test/**',
        'client/desktop/src/types/**',
        'client/desktop/src/vite-env.d.ts',
      ],
    },
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'client/desktop/src'),
    },
  },
})
