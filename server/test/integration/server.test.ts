// ============================================================================
// S8.6 服务器启动测试 + 优雅关闭 + AI 真实调用测试
// ============================================================================
// 测试范围（spec 8.3-8.4 节）：
// - main() 启动后 GET /api/health 200
// - NODE_ENV=production + 无 SERVER_TOKEN → process.exit(1)
// - 优雅关闭（SIGINT）：验证 closeDb 被调用（"Database closed" 日志）
//   注：Windows 上 SIGTERM = TerminateProcess（不可捕获），改用 SIGINT
// - AI 真实调用测试（describe.skipIf(!process.env.TEST_LLM_API_KEY)）
//   - POST /api/ai/test-connection 真实调 LLM
//   - handleUserMessage 真实调 LLM
// ============================================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { spawn, type ChildProcess } from 'child_process'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import http from 'http'
import request from 'supertest'
import type { Express } from 'express'
import { createTestDb } from '../helpers/db.js'
import { createTestApp } from '../helpers/server.js'
import { expectOk } from '../helpers/assert.js'
import { getPool } from '../../src/db/connection.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SERVER_CWD = resolve(__dirname, '../..')

// 保存原始 SQLITE_PATH（AI 测试 beforeEach 中重置避免路径累积）
const ORIGINAL_SQLITE_PATH = process.env.SQLITE_PATH as string

// ============================================================================
// Helpers
// ============================================================================

/**
 * 等待子进程 stdout/stderr 输出匹配指定正则
 */
function waitForOutput(proc: ChildProcess, pattern: RegExp, timeoutMs = 30_000): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timeout waiting for pattern ${pattern} in output`))
    }, timeoutMs)
    let buffer = ''
    const onData = (data: Buffer): void => {
      buffer += data.toString()
      const lines = buffer.split('\n')
      for (const line of lines) {
        if (pattern.test(line)) {
          clearTimeout(timer)
          proc.stdout?.off('data', onData)
          proc.stderr?.off('data', onData)
          resolvePromise(line)
          return
        }
      }
    }
    proc.stdout?.on('data', onData)
    proc.stderr?.on('data', onData)
    proc.on('exit', (code) => {
      clearTimeout(timer)
      reject(new Error(`Process exited with code ${code} before matching ${pattern}`))
    })
    proc.on('error', (err) => {
      clearTimeout(timer)
      reject(err)
    })
  })
}

// 通过 stdin 'shutdown' 命令触发 process.emit('SIGINT')。
// 原因：Windows 上 subprocess.kill('SIGINT') 调用 TerminateProcess 强制终止进程，
// 不会触发 process.on('SIGINT') handler。改用 --import 注入 stdin 监听器，
// 测试写入 'shutdown\n' 后由子进程自身 process.emit('SIGINT') 触发优雅关闭。
const SHUTDOWN_VIA_STDIN_IMPORT =
  'data:text/javascript;base64,' +
  Buffer.from(
    `process.stdin.on('data', d => { if (d.toString().trim() === 'shutdown') process.emit('SIGINT', 'SIGINT') })`,
  ).toString('base64')

/**
 * 启动服务器子进程
 *
 * 使用 process.execPath (node) + --import tsx 替代 npx tsx：
 * - 不需要 shell: true，直接 spawn Node.js 进程
 * - 额外 --import SHUTDOWN_VIA_STDIN_IMPORT 注入 stdin 监听器，
 *   用于优雅关闭测试（subprocess.kill 信号在 Windows 不可靠）
 */
function spawnServer(envOverrides: Record<string, string> = {}): { proc: ChildProcess; testDir: string } {
  const testDir = mkdtempSync(join(tmpdir(), 'ld-server-test-'))
  const env: Record<string, string> = {
    ...process.env,
    DB_DRIVER: 'sqlite',
    SQLITE_PATH: join(testDir, 'test.db'),
    PORT: '0',
    PI_DISABLE_AUTO_INIT: '1',
    SERVER_TOKEN: 'test-token',
    JWT_SECRET: 'test-jwt-secret-for-vitest-only',
    CORS_ORIGIN: 'http://localhost',
    WEB_ACCESS_PASSWORD: 'test-password-12345',
    ...envOverrides,
  }

  // SERVER_TOKEN='' 表示需要清除（生产环境测试用）
  if (env.SERVER_TOKEN === '') {
    delete env.SERVER_TOKEN
  }

  const proc = spawn(
    process.execPath,
    ['--import', 'tsx', '--import', SHUTDOWN_VIA_STDIN_IMPORT, 'src/index.ts'],
    {
      cwd: SERVER_CWD,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    },
  )

  return { proc, testDir }
}

/**
 * 等待服务器启动并返回端口号
 */
async function waitForServerReady(proc: ChildProcess): Promise<number> {
  const line = await waitForOutput(proc, /Daily API running on http:\/\/localhost:(\d+)/, 45_000)
  const match = line.match(/:(\d+)/)
  if (!match) throw new Error('Could not parse port from: ' + line)
  return parseInt(match[1], 10)
}

/**
 * 发送 HTTP GET 请求
 */
function httpGet(port: number, path: string): Promise<{ statusCode: number; body: unknown }> {
  return new Promise((resolvePromise, reject) => {
    const req = http.get(`http://localhost:${port}${path}`, (res) => {
      let data = ''
      res.on('data', (chunk) => { data += chunk })
      res.on('end', () => {
        try {
          resolvePromise({ statusCode: res.statusCode ?? 0, body: JSON.parse(data) })
        } catch {
          resolvePromise({ statusCode: res.statusCode ?? 0, body: data })
        }
      })
    })
    req.on('error', reject)
    req.setTimeout(10_000, () => {
      req.destroy(new Error('HTTP request timeout'))
    })
  })
}

/**
 * 等待进程退出，返回 exit code
 */
function waitForExit(proc: ChildProcess, timeoutMs = 30_000): Promise<number | null> {
  return new Promise((resolvePromise, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Process did not exit within ${timeoutMs}ms`))
    }, timeoutMs)
    proc.on('exit', (code) => {
      clearTimeout(timer)
      resolvePromise(code)
    })
  })
}

/**
 * 清理子进程（SIGTERM → SIGKILL fallback）
 * Windows 上 SIGTERM/SIGKILL 均调用 TerminateProcess（强制终止）
 */
async function killProcess(proc: ChildProcess): Promise<void> {
  if (proc.exitCode !== null || proc.signalCode) return
  try { proc.kill('SIGTERM') } catch { /* ignore */ }
  await new Promise<void>((r) => {
    const t = setTimeout(() => {
      try { proc.kill('SIGKILL') } catch { /* ignore */ }
      r()
    }, 5000)
    proc.on('exit', () => { clearTimeout(t); r() })
  })
}

// ============================================================================
// 服务器启动测试
// ============================================================================
describe('服务器启动', () => {
  let proc: ChildProcess | null = null
  let testDir: string | null = null

  afterEach(async () => {
    if (proc) {
      await killProcess(proc)
      proc = null
    }
    if (testDir) {
      try { rmSync(testDir, { recursive: true, force: true }) } catch { /* ignore */ }
      testDir = null
    }
  })

  it('main() 启动后 GET /api/health → 200 + { status: "ok" }', async () => {
    const spawned = spawnServer()
    proc = spawned.proc
    testDir = spawned.testDir

    const port = await waitForServerReady(proc)
    const res = await httpGet(port, '/api/health')
    expect(res.statusCode).toBe(200)
    expect((res.body as { status: string }).status).toBe('ok')
    expect((res.body as { timestamp: number }).timestamp).toBeDefined()
  }, 90_000)

  it('NODE_ENV=production + 无 SERVER_TOKEN → process.exit(1)', async () => {
    const spawned = spawnServer({
      NODE_ENV: 'production',
      SERVER_TOKEN: '', // 触发 spawnServer 中 delete env.SERVER_TOKEN
    })
    proc = spawned.proc
    testDir = spawned.testDir

    // 服务器应在环境检查阶段退出（exit code 1）
    const exitCode = await waitForExit(proc, 30_000)
    expect(exitCode).toBe(1)
  }, 60_000)
})

// ============================================================================
// 优雅关闭
// ============================================================================
describe('优雅关闭', () => {
  let proc: ChildProcess | null = null
  let testDir: string | null = null

  afterEach(async () => {
    if (proc) {
      await killProcess(proc)
      proc = null
    }
    if (testDir) {
      try { rmSync(testDir, { recursive: true, force: true }) } catch { /* ignore */ }
      testDir = null
    }
  })

  it('SIGINT 触发优雅关闭，closeDb 被调用（"Database closed" 日志）', async () => {
    const spawned = spawnServer()
    proc = spawned.proc
    testDir = spawned.testDir

    await waitForServerReady(proc)

    // 通过 stdin 'shutdown' 命令触发 process.emit('SIGINT')：
    // Windows 上 subprocess.kill('SIGINT') 调用 TerminateProcess 不会触发 handler，
    // 改用 --import 注入的 stdin 监听器，子进程自身 emit('SIGINT') 触发优雅关闭。
    proc.stdin!.write('shutdown\n')

    // 等待 "Database closed" 日志（证明 closeDb 被调用）
    // 优雅关闭流程：SIGINT → disposePiBridge (15s timeout) → closeDb → process.exit(0)
    await waitForOutput(proc, /Database closed/, 45_000)

    // 验证进程以 exit code 0 退出
    const exitCode = await waitForExit(proc, 10_000)
    expect(exitCode).toBe(0)
  }, 120_000)
})

// ============================================================================
// AI 真实调用测试（无 TEST_LLM_API_KEY 时跳过）
// ============================================================================
describe.skipIf(!process.env.TEST_LLM_API_KEY)('AI 真实调用测试', () => {
  let app: Express
  let cleanupDb: () => Promise<void>
  let cleanupApp: () => Promise<void>
  let token: string

  beforeEach(async () => {
    // 重置 SQLITE_PATH 避免路径累积超过 Windows MAX_PATH（260）
    process.env.SQLITE_PATH = ORIGINAL_SQLITE_PATH
    const db = await createTestDb()
    cleanupDb = db.cleanup
    const testApp = await createTestApp()
    app = testApp.app
    cleanupApp = testApp.cleanup

    // 注册 admin 用户获取 JWT token
    const res = await request(app)
      .post('/api/auth/register')
      .send({ username: 'admin', email: 'admin@example.com', password: 'pass1234' })
    const setCookie = res.headers['set-cookie'] as unknown as string[] | undefined
    if (setCookie && setCookie.length > 0) {
      const match = setCookie[0].match(/access_token=([^;]+)/)
      if (match) token = match[1]
    }
    if (!token && res.body?.token) {
      token = res.body.token as string
    }
  })

  afterEach(async () => {
    await cleanupApp()
    await cleanupDb()
  })

  it('POST /api/ai/test-connection 真实调用 LLM → 200 + reply 非空', async () => {
    const res = await request(app)
      .post('/api/ai/test-connection')
      .set('Cookie', [`access_token=${token}`])
      .send({
        apiKey: process.env.TEST_LLM_API_KEY,
        model: process.env.TEST_LLM_MODEL || 'stepfun/step-3.7-flash',
        ...(process.env.TEST_LLM_ENDPOINT ? { endpoint: process.env.TEST_LLM_ENDPOINT } : {}),
      })
    expectOk(res, 200)
    expect(res.body.ok).toBe(true)
    expect(res.body.reply).toBeDefined()
    expect(typeof res.body.reply).toBe('string')
    expect(res.body.reply.length).toBeGreaterThan(0)
  }, 60_000)

  it('handleUserMessage 真实调用 LLM，conversation 持久化到 DB', async () => {
    // 动态 import piBridge（避免模块加载阶段副作用）
    const piBridge = await import('../../src/piBridge.js')

    const panelId = `test-panel-${Date.now()}`
    const content = 'Reply with the single word: OK'

    // handleUserMessage 是异步的（prompt 用 void 触发，不阻塞返回）
    // 但 getOrCreatePanelSession + persistConversation 是同步 await 的
    await piBridge.handleUserMessage(content, 'test-device', panelId)

    // 等待异步 prompt 完成（LLM 调用 + 事件流处理）
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 15_000))

    // 验证用户消息已持久化到 ai_conversations 表
    const pool = getPool()
    const result = await pool.query(
      'SELECT * FROM ai_conversations WHERE panel_id = $1 ORDER BY created_at ASC',
      [panelId],
    )
    expect(result.rows.length).toBeGreaterThanOrEqual(1)
    const firstMsg = result.rows[0] as { role: string; content: string }
    expect(firstMsg.role).toBe('user')
    expect(firstMsg.content).toBe(content)
  }, 60_000)
})
