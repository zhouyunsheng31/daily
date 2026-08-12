/**
 * 测试环境前置 setup
 * 必须在 import 任何 src 模块之前执行（vitest setupFiles 会自动前置）
 * 重点：强制 DB_DRIVER=sqlite，防止误连生产 PG
 */
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const testRoot = mkdtempSync(join(tmpdir(), 'ld-test-'))

process.env.NODE_ENV = 'test'
process.env.DB_DRIVER = 'sqlite'
process.env.SQLITE_PATH = join(testRoot, 'test.db')
process.env.SERVER_TOKEN = 'test-token'
process.env.JWT_SECRET = 'test-jwt-secret-for-vitest-only'

// 防止 piBridge 真实初始化（连接 LLM API）
process.env.PI_DISABLE_AUTO_INIT = '1'

export const TEST_TMP_DIR = testRoot

export function cleanupTestEnv(): void {
  // 由 vitest teardown 处理，此处仅占位
}
