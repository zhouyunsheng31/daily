/**
 * 测试 Express app helper（不监听端口，用 supertest 直接调）
 *
 * Phase S8.1：src/index.ts 已重构拆出 createApp() 工厂函数并导出。
 * 此 helper 调用 createApp() 获取 Express app（不 listen、不初始化 DB、不启动 cron）。
 *
 * 注意：src/index.ts 末尾的 main() 调用已被 import.meta.url 守卫，
 * 被 import 时不会触发 main() 副作用（DB 初始化、listen、piBridge 等）。
 *
 * Phase S11：createApp 参数化，测试 helper 传 corsOrigin/skipEnvCheck/webPublicDir
 * 跳过环境变量校验和静态托管。
 */
import type { Express } from 'express'

export async function createTestApp(): Promise<{ app: Express; cleanup: () => Promise<void> }> {
  // 动态 import 避免 piBridge 自动初始化
  const mod = await import('../../src/index.js')
  const createApp = (mod as {
    createApp?: (options?: {
      corsOrigin?: string
      webPublicDir?: string
      skipEnvCheck?: boolean
    }) => { app: Express }
  }).createApp

  if (!createApp) {
    throw new Error(
      'createTestApp: src/index.ts 未导出 createApp。请检查 src/index.ts 末尾是否有 export { createApp }。',
    )
  }

  const { app } = createApp({
    corsOrigin: 'http://localhost',
    skipEnvCheck: true,
    webPublicDir: '/nonexistent',
  })

  return {
    app,
    cleanup: async () => {
      // 清理由各测试自行处理
    },
  }
}
