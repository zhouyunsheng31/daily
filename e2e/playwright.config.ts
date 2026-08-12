/**
 * D1：Playwright Electron 测试配置
 *
 * 运行：npm run test:e2e
 * 等价：playwright test --config=e2e/playwright.config.ts
 *
 * 要点：
 *   - testDir 用 __dirname（e2e/ 本身）：config 文件已在 e2e/ 下，
 *     若写 './e2e' 会被解析为 e2e/e2e/（不存在）
 *   - testIgnore 排除 phase11-* 旧测试：它们用 vitest（import { describe } from 'vitest'），
 *     若被 Playwright 扫描会因 test/expect 签名不匹配而报错
 *   - workers: 1：Electron 应用实例不可并行启动多个（共享 userData/单实例锁）
 *   - fullyParallel: false：同上
 */
import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: import.meta.dirname,
  testMatch: ['**/*.spec.ts'],
  testIgnore: ['**/phase11-*', '**/node_modules/**'],
  timeout: 60_000,
  expect: {
    timeout: 10_000,
  },
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: 'list',
  use: {
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
})
