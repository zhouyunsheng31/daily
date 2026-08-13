'use strict'

/**
 * Daily Agent Harness · CLI 冒烟（M0-2 spike 验证入口）
 * 用法：BYOK_BASE_URL=... BYOK_API_KEY=... node src/smoke.js ["你好"]
 * 直接跑一轮对话，事件打印到 stdout，结束 exit 0。
 */

const { initHarness, createConversationManager } = require('./core')

async function main() {
  const baseUrl = process.env.BYOK_BASE_URL
  const apiKey = process.env.BYOK_API_KEY
  if (!baseUrl || !apiKey) {
    console.error('BYOK_BASE_URL / BYOK_API_KEY env required')
    process.exit(2)
  }

  const prompt = process.argv[2] || '你好，用一句话介绍你自己'

  const t0 = Date.now()
  const services = await initHarness({ baseUrl, apiKey, modelId: process.env.BYOK_MODEL_ID || 'deepseek-v4-flash' })
  console.error(`[smoke] harness init in ${Date.now() - t0}ms`)

  const manager = createConversationManager(services, {})
  manager.subscribe('smoke', (event) => {
    const e = event || {}
    console.log('[event]', e.type, JSON.stringify(e).slice(0, 300))
  })

  const t1 = Date.now()
  await manager.turn('smoke', prompt, { thinking: process.env.BYOK_THINKING || 'medium' })
  console.error(`[smoke] turn done in ${Date.now() - t1}ms (total ${Date.now() - t0}ms)`)
  await manager.disposeAll()
  console.log('[smoke] OK')
  process.exit(0)
}

main().catch((err) => {
  console.error('[smoke] FAILED:', err)
  process.exit(1)
})