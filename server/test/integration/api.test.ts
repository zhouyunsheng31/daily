// ============================================================================
// S8.6 路由集成测试（supertest + SQLite）
// ============================================================================
// 测试范围（spec 8.2-8.4 节）：
// - 健康检查
// - 鉴权（SERVER_TOKEN 4 种路径）
// - panels / widgets / entities / tools / aiSettings / searchKeys
// - syncLogs / entityConflicts / dynamicWidgets / localServices
// - 乐观锁冲突（widgets PUT 409）+ 实体冲突日志写入
// ============================================================================

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import request from 'supertest'
import type { Express } from 'express'
import { randomUUID } from 'crypto'
import { createTestDb } from '../helpers/db.js'
import { createTestApp } from '../helpers/server.js'
import { expectOk, expectJson, expectError } from '../helpers/assert.js'

// Mock callLlm 避免 /api/ai/test-connection 真实调 LLM（spec 8.2 节：mock callLlm）
vi.mock('../../src/utils/llmCaller.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/utils/llmCaller.js')>()
  return {
    ...actual,
    callLlm: vi.fn().mockResolvedValue('OK'),
  }
})

let app: Express
let cleanupDb: () => Promise<void>
let cleanupApp: () => Promise<void>
let token: string

// 保存原始 SQLITE_PATH，beforeEach 中重置避免路径累积（createTestDb 每次追加 .pid.n.db）
const ORIGINAL_SQLITE_PATH = process.env.SQLITE_PATH as string

function extractToken(res: request.Response): string {
  if (res.body?.token) return res.body.token as string
  const setCookie = res.headers['set-cookie'] as unknown as string[] | undefined
  if (setCookie && setCookie.length > 0) {
    const match = setCookie[0].match(/access_token=([^;]+)/)
    if (match) return match[1]
  }
  throw new Error('No token found in response')
}

async function registerAndLogin(username: string): Promise<string> {
  const res = await request(app)
    .post('/api/auth/register')
    .send({ username, email: `${username}@example.com`, password: 'pass1234' })
  return extractToken(res)
}

function auth(req: request.Test, tok?: string): request.Test {
  return req.set('Cookie', [`access_token=${tok ?? token}`])
}

beforeEach(async () => {
  // 重置 SQLITE_PATH 避免路径累积超过 Windows MAX_PATH（260）
  process.env.SQLITE_PATH = ORIGINAL_SQLITE_PATH
  const db = await createTestDb()
  cleanupDb = db.cleanup
  const testApp = await createTestApp()
  app = testApp.app
  cleanupApp = testApp.cleanup
  // 注册第一个用户（自动 admin），获取 JWT token
  token = await registerAndLogin('admin')
})

afterEach(async () => {
  await cleanupApp()
  await cleanupDb()
})

// ============================================================================
// 健康检查
// ============================================================================
describe('健康检查', () => {
  it('GET /api/health 返回 200 + { status: "ok" }', async () => {
    const res = await request(app).get('/api/health')
    expectOk(res, 200)
    expect(res.body.status).toBe('ok')
    expect(res.body.timestamp).toBeDefined()
  })
})

// ============================================================================
// 鉴权（4 种路径）
// ============================================================================
describe('鉴权', () => {
  it('SERVER_TOKEN 设置时，无 Authorization → 401', async () => {
    const res = await request(app).get('/api/panels')
    expect(res.status).toBe(401)
  })

  it('SERVER_TOKEN 设置时，错误 token → 401', async () => {
    const res = await request(app)
      .get('/api/panels')
      .set('Authorization', 'Bearer wrong-token')
    expect(res.status).toBe(401)
  })

  it('SERVER_TOKEN 设置时，正确 token → 200', async () => {
    const res = await request(app)
      .get('/api/panels')
      .set('Authorization', 'Bearer test-token')
    expect(res.status).toBe(200)
  })

  it('SERVER_TOKEN 未设置时，dev 模式放行（无 Origin 头）', async () => {
    const savedToken = process.env.SERVER_TOKEN
    delete process.env.SERVER_TOKEN
    try {
      // 无 Origin 头 → 同源请求 → dev 模式放行
      const res = await request(app).get('/api/panels')
      expect(res.status).toBe(200)
    } finally {
      process.env.SERVER_TOKEN = savedToken
    }
  })
})

// ============================================================================
// panels 路由
// ============================================================================
describe('panels 路由', () => {
  it('POST /api/panels 创建个人面板 → 201', async () => {
    const res = await auth(request(app).post('/api/panels')).send({ name: '我的面板' })
    expectOk(res, 201)
    expect(res.body.name).toBe('我的面板')
    expect(res.body.isCommunity).toBe(false)
    expect(res.body.ownerId).toBeTruthy()
  })

  it('POST /api/panels 创建社区面板（admin）→ 201', async () => {
    const res = await auth(request(app).post('/api/panels'))
      .send({ name: '社区面板', isCommunity: true })
    expectOk(res, 201)
    expect(res.body.name).toBe('社区面板')
    expect(res.body.isCommunity).toBe(true)
  })

  it('GET /api/panels 列出面板 → 200', async () => {
    await auth(request(app).post('/api/panels')).send({ name: '面板A' })
    await auth(request(app).post('/api/panels')).send({ name: '社区面板', isCommunity: true })

    const res = await auth(request(app).get('/api/panels'))
    expectOk(res, 200)
    expect(Array.isArray(res.body)).toBe(true)
    expect(res.body.length).toBeGreaterThanOrEqual(2)
    const names = res.body.map((p: { name: string }) => p.name)
    expect(names).toContain('面板A')
    expect(names).toContain('社区面板')
  })

  it('GET /api/panels/:id → 200', async () => {
    const createRes = await auth(request(app).post('/api/panels')).send({ name: '查询面板' })
    const id = createRes.body.id

    const res = await auth(request(app).get(`/api/panels/${id}`))
    expectOk(res, 200)
    expect(res.body.name).toBe('查询面板')
  })

  it('GET /api/panels/:id 不存在 → 404', async () => {
    const res = await auth(request(app).get('/api/panels/nonexistent-id'))
    expectError(res, 404)
  })

  it('PUT /api/panels/:id 更新 → 200', async () => {
    const createRes = await auth(request(app).post('/api/panels')).send({ name: '原名称' })
    const id = createRes.body.id

    const res = await auth(request(app).put(`/api/panels/${id}`)).send({ name: '新名称' })
    expectOk(res, 200)
    expect(res.body.name).toBe('新名称')
  })

  it('PUT /api/panels/:id 不存在 → 404', async () => {
    const res = await auth(request(app).put('/api/panels/nonexistent-id')).send({ name: 'test' })
    expectError(res, 404)
  })

  it('DELETE /api/panels/:id → 200', async () => {
    const createRes = await auth(request(app).post('/api/panels')).send({ name: '待删除' })
    const id = createRes.body.id

    const res = await auth(request(app).delete(`/api/panels/${id}`))
    expectOk(res, 200)
    expect(res.body.success).toBe(true)
  })
})

// ============================================================================
// widgets 路由
// ============================================================================
describe('widgets 路由', () => {
  let panelId: string

  beforeEach(async () => {
    const createRes = await auth(request(app).post('/api/panels')).send({ name: 'Widget面板' })
    panelId = createRes.body.id
  })

  it('POST /api/panels/:panelId/widgets 创建 → 201', async () => {
    const res = await auth(request(app).post(`/api/panels/${panelId}/widgets`))
      .send({ type: 'html', x: 0, y: 0, width: 300, height: 200 })
    expectOk(res, 201)
    expect(res.body.type).toBe('html')
    expect(res.body.panelId).toBe(panelId)
    expect(res.body.version).toBe(1)
  })

  it('GET /api/panels/:panelId/widgets 列出 → 200', async () => {
    await auth(request(app).post(`/api/panels/${panelId}/widgets`))
      .send({ type: 'html', x: 10, y: 10 })

    const res = await auth(request(app).get(`/api/panels/${panelId}/widgets`))
    expectOk(res, 200)
    expect(Array.isArray(res.body)).toBe(true)
    expect(res.body.length).toBeGreaterThanOrEqual(1)
  })

  it('PUT /api/widgets/:id 更新 → 200', async () => {
    const createRes = await auth(request(app).post(`/api/panels/${panelId}/widgets`))
      .send({ type: 'html', x: 0, y: 0 })
    const widgetId = createRes.body.id

    const res = await auth(request(app).put(`/api/widgets/${widgetId}`))
      .send({ x: 100, y: 200 })
    expectOk(res, 200)
    expect(res.body.x).toBe(100)
    expect(res.body.y).toBe(200)
    expect(res.body.version).toBe(2)
  })

  it('PUT /api/widgets/:id state + version 不匹配 → 409', async () => {
    const createRes = await auth(request(app).post(`/api/panels/${panelId}/widgets`))
      .send({ type: 'html', x: 0, y: 0 })
    const widgetId = createRes.body.id
    // widget.version = 1, 使用错误的 expectedVersion=999
    const res = await auth(request(app).put(`/api/widgets/${widgetId}`))
      .send({ state: { foo: 'bar' }, expectedVersion: 999 })
    expect(res.status).toBe(409)
    expect(res.body.conflict).toBe(true)
    expect(res.body.currentVersion).toBe(1)
  })

  it('DELETE /api/widgets/:id → 200', async () => {
    const createRes = await auth(request(app).post(`/api/panels/${panelId}/widgets`))
      .send({ type: 'html', x: 0, y: 0 })
    const widgetId = createRes.body.id

    const res = await auth(request(app).delete(`/api/widgets/${widgetId}`))
    expectOk(res, 200)
    expect(res.body.ok).toBe(true)
  })
})

// ============================================================================
// entities 路由
// ============================================================================
describe('entities 路由', () => {
  it('POST /api/entities 创建 → 201', async () => {
    const res = await auth(request(app).post('/api/entities'))
      .send({ type: 'task', data: { title: '测试任务' } })
    expectOk(res, 201)
    expect(res.body.type).toBe('task')
    expect(res.body.version).toBe(1)
  })

  it('GET /api/entities?type=xxx → 200', async () => {
    await auth(request(app).post('/api/entities'))
      .send({ type: 'task', data: { title: '任务1' } })
    await auth(request(app).post('/api/entities'))
      .send({ type: 'note', data: { content: '笔记' } })

    const res = await auth(request(app).get('/api/entities?type=task'))
    expectOk(res, 200)
    expect(res.body.items).toBeDefined()
    expect(res.body.items.length).toBeGreaterThanOrEqual(1)
    expect(res.body.items.every((e: { type: string }) => e.type === 'task')).toBe(true)
  })

  it('PUT /api/entities/:id 更新（expectedVersion 匹配）→ 200', async () => {
    const createRes = await auth(request(app).post('/api/entities'))
      .send({ type: 'task', data: { title: '原始' } })
    const entityId = createRes.body.id

    const res = await auth(request(app).put(`/api/entities/${entityId}`))
      .send({ data: { title: '更新' }, expectedVersion: 1 })
    expectOk(res, 200)
    expect(res.body.version).toBe(2)
  })

  it('PUT /api/entities/:id 冲突时 INSERT entity_conflict_logs', async () => {
    const createRes = await auth(request(app).post('/api/entities'))
      .send({ type: 'task', data: { title: '冲突测试' } })
    const entityId = createRes.body.id

    // 使用错误的 expectedVersion → 冲突日志写入（LWW 策略仍应用更新）
    const res = await auth(request(app).put(`/api/entities/${entityId}`))
      .send({ data: { title: '冲突更新' }, expectedVersion: 999 })
    expectOk(res, 200) // LWW：仍返回 200

    // 验证冲突日志已写入
    const conflictRes = await auth(request(app).get('/api/entities/conflicts'))
    expectOk(conflictRes, 200)
    expect(conflictRes.body.conflicts.length).toBeGreaterThan(0)
    const conflict = conflictRes.body.conflicts.find(
      (c: { entityId: string }) => c.entityId === entityId,
    )
    expect(conflict).toBeDefined()
    expect(conflict.localVersion).toBe(1)
    expect(conflict.remoteVersion).toBe(999)
  })

  it('DELETE /api/entities/:id → 200', async () => {
    const createRes = await auth(request(app).post('/api/entities'))
      .send({ type: 'task', data: {} })
    const entityId = createRes.body.id

    const res = await auth(request(app).delete(`/api/entities/${entityId}`))
    expectOk(res, 200)
    expect(res.body.ok).toBe(true)
  })
})

// ============================================================================
// tools 路由
// ============================================================================
describe('tools 路由', () => {
  it('GET /api/tools → 200，返回工具列表', async () => {
    const res = await auth(request(app).get('/api/tools'))
    expectOk(res, 200)
    expect(res.body.tools).toBeDefined()
    expect(Array.isArray(res.body.tools)).toBe(true)
    expect(res.body.total).toBe(res.body.tools.length)
    expect(res.body.enabledCount).toBeDefined()
  })

  it('PUT /api/tools/:name 禁用可禁用工具 → 200', async () => {
    // create_html_widget 是 canDisable=true 的工具
    const res = await auth(request(app).put('/api/tools/create_html_widget'))
      .send({ enabled: false })
    expectOk(res, 200)
    expect(res.body.enabled).toBe(false)
  })

  it('PUT /api/tools/:name canDisable=false → 400', async () => {
    // ask_user 是 canDisable=false 的系统工具
    const res = await auth(request(app).put('/api/tools/ask_user'))
      .send({ enabled: false })
    expectError(res, 400)
  })

  it('POST /api/tools/reset → 200', async () => {
    // 先禁用一个工具
    await auth(request(app).put('/api/tools/create_html_widget'))
      .send({ enabled: false })

    const res = await auth(request(app).post('/api/tools/reset'))
    expectOk(res, 200)
    expect(res.body.ok).toBe(true)
  })
})

// ============================================================================
// aiSettings 路由
// ============================================================================
describe('aiSettings 路由', () => {
  it('GET /api/ai/settings → 200，hasApiKey 字段', async () => {
    const res = await auth(request(app).get('/api/ai/settings'))
    expectOk(res, 200)
    expect(res.body.model).toBeDefined()
    expect(typeof res.body.hasApiKey).toBe('boolean')
  })

  it('PUT /api/ai/settings 更新 → 200', async () => {
    const res = await auth(request(app).put('/api/ai/settings'))
      .send({ model: 'test-model', apiKey: 'test-api-key-12345' })
    expectOk(res, 200)
    expect(res.body.ok).toBe(true)
  })

  it('POST /api/ai/test-connection（mock callLlm）→ 200', async () => {
    const res = await auth(request(app).post('/api/ai/test-connection'))
      .send({ apiKey: 'test-key', model: 'test-model' })
    expectOk(res, 200)
    expect(res.body.ok).toBe(true)
    expect(res.body.reply).toBeDefined()
  })
})

// ============================================================================
// searchKeys 路由
// ============================================================================
describe('searchKeys 路由', () => {
  it('GET /api/search/keys → 200，不含明文 key', async () => {
    const res = await auth(request(app).get('/api/search/keys'))
    expectOk(res, 200)
    expect(res.body.providers).toBeDefined()
    expect(Array.isArray(res.body.providers)).toBe(true)
    // 确保不返回明文 key（只有 hasKey 布尔值）
    const json = JSON.stringify(res.body)
    expect(json).not.toContain('ghp_')
    expect(json).not.toContain('sk-')
  })

  it('PUT /api/search/keys/:provider → 200', async () => {
    const res = await auth(request(app).put('/api/search/keys/github'))
      .send({ key: 'ghp_testkey1234567890' })
    expectOk(res, 200)
    expect(res.body.ok).toBe(true)
    expect(res.body.provider).toBe('github')
  })

  it('PUT /api/search/keys/:provider invalid provider → 400', async () => {
    const res = await auth(request(app).put('/api/search/keys/invalid-provider'))
      .send({ key: 'some-key' })
    expectError(res, 400)
  })
})

// ============================================================================
// syncLogs 路由
// ============================================================================
describe('syncLogs 路由', () => {
  it('PUT /api/sync/logs upsert → 200', async () => {
    const res = await auth(request(app).put('/api/sync/logs'))
      .send({
        id: randomUUID(),
        operation: 'update',
        entityType: 'entity',
        entityId: 'test-entity-1',
        payload: { data: { updated: true } },
        status: 'pending',
      })
    expectOk(res, 200)
    expect(res.body.ok).toBe(true)
  })

  it('PUT /api/sync/logs 参数校验 → 400', async () => {
    // 缺少必填字段
    const res = await auth(request(app).put('/api/sync/logs'))
      .send({ id: randomUUID() }) // 缺少 operation / entityType / entityId
    expectError(res, 400)
  })

  it('GET /api/sync/logs → 200', async () => {
    // 先创建一条 sync_log
    await auth(request(app).put('/api/sync/logs'))
      .send({
        id: randomUUID(),
        operation: 'update',
        entityType: 'entity',
        entityId: 'test-entity-2',
        payload: {},
        status: 'pending',
      })

    const res = await auth(request(app).get('/api/sync/logs'))
    expectOk(res, 200)
    expect(res.body.items).toBeDefined()
    expect(res.body.total).toBeDefined()
  })

  it('GET /api/sync/logs/failed → 200', async () => {
    // 先创建一条 failed 的 sync_log
    await auth(request(app).put('/api/sync/logs'))
      .send({
        id: randomUUID(),
        operation: 'update',
        entityType: 'entity',
        entityId: 'test-entity-3',
        payload: {},
        status: 'failed',
        lastError: 'test error',
      })

    const res = await auth(request(app).get('/api/sync/logs/failed'))
    expectOk(res, 200)
    expect(res.body.items).toBeDefined()
  })

  it('POST /api/sync/logs/:id/retry → 200', async () => {
    const logId = randomUUID()
    await auth(request(app).put('/api/sync/logs'))
      .send({
        id: logId,
        operation: 'update',
        entityType: 'entity',
        entityId: 'retry-test-entity',
        payload: { data: { updated: true } },
        status: 'failed',
        lastError: 'previous error',
      })

    const res = await auth(request(app).post(`/api/sync/logs/${logId}/retry`))
    expectOk(res, 200)
    expect(res.body.ok).toBe(true)
    expect(res.body.status).toBe('success')
  })

  it('POST /api/sync/logs/:id/retry unsupported entityType → 500', async () => {
    const logId = randomUUID()
    await auth(request(app).put('/api/sync/logs'))
      .send({
        id: logId,
        operation: 'update',
        entityType: 'unsupported_type',
        entityId: 'test-entity',
        payload: {},
        status: 'failed',
        lastError: 'error',
      })

    const res = await auth(request(app).post(`/api/sync/logs/${logId}/retry`))
    expect(res.status).toBe(500)
    expect(res.body.ok).toBe(false)
    expect(res.body.error).toContain('Unsupported entityType')
  })
})

// ============================================================================
// entityConflicts 路由
// ============================================================================
describe('entityConflicts 路由', () => {
  it('GET /api/entities/conflicts → 200', async () => {
    const res = await auth(request(app).get('/api/entities/conflicts'))
    expectOk(res, 200)
    expect(res.body.conflicts).toBeDefined()
    expect(res.body.total).toBeDefined()
  })

  it('POST /api/entities/conflicts/:id/resolve → 200', async () => {
    // 先制造一个冲突
    const createRes = await auth(request(app).post('/api/entities'))
      .send({ type: 'task', data: { title: '冲突测试' } })
    const entityId = createRes.body.id

    await auth(request(app).put(`/api/entities/${entityId}`))
      .send({ data: { title: '冲突' }, expectedVersion: 999 })

    // 获取冲突 ID
    const conflictsRes = await auth(request(app).get('/api/entities/conflicts'))
    const conflictId = conflictsRes.body.conflicts[0].id

    // 解决冲突
    const res = await auth(request(app).post(`/api/entities/conflicts/${conflictId}/resolve`))
      .send({ action: 'keep-local' })
    expectOk(res, 200)
    expect(res.body.ok).toBeTruthy()
    // SQLite 存储布尔值为 0/1，用 toBeTruthy 兼容
    expect(res.body.conflict.resolved).toBeTruthy()
  })

  it('POST /api/entities/conflicts/:id/resolve invalid action → 400', async () => {
    const res = await auth(request(app).post('/api/entities/conflicts/any-id/resolve'))
      .send({ action: 'invalid-action' })
    expectError(res, 400)
  })
})

// ============================================================================
// dynamicWidgets 路由
// ============================================================================
describe('dynamicWidgets 路由', () => {
  it('POST /api/dynamic-widgets → 201', async () => {
    const res = await auth(request(app).post('/api/dynamic-widgets'))
      .send({
        widgetType: 'test_widget_1',
        displayName: '测试组件',
        icon: 'box',
        code: '<div>hello</div>',
        componentEnv: 'pure-frontend',
      })
    expectOk(res, 201)
    expect(res.body.widgetType).toBe('test_widget_1')
    expect(res.body.componentEnv).toBe('pure-frontend')
  })

  it('POST /api/dynamic-widgets invalid componentEnv → 400', async () => {
    const res = await auth(request(app).post('/api/dynamic-widgets'))
      .send({
        widgetType: 'test_widget_bad',
        componentEnv: 'invalid-env',
      })
    expectError(res, 400)
  })

  it('GET /api/dynamic-widgets?desktop=false → 200', async () => {
    // 创建一个 desktop_only=false 的组件
    await auth(request(app).post('/api/dynamic-widgets'))
      .send({
        widgetType: 'mobile_widget',
        displayName: '移动端组件',
        componentEnv: 'pure-frontend',
        desktopOnly: false,
      })

    const res = await auth(request(app).get('/api/dynamic-widgets?desktop=false'))
    expectOk(res, 200)
    expect(Array.isArray(res.body)).toBe(true)
    // 所有返回的组件都应 desktopOnly 为假值（SQLite 存储为 0，非 false）
    expect(res.body.every((w: { desktopOnly: number | boolean }) => !w.desktopOnly)).toBe(true)
  })

  it('PUT /api/dynamic-widgets/:widgetType → 200', async () => {
    await auth(request(app).post('/api/dynamic-widgets'))
      .send({
        widgetType: 'update_test_widget',
        displayName: '原名称',
        componentEnv: 'pure-frontend',
      })

    const res = await auth(request(app).put('/api/dynamic-widgets/update_test_widget'))
      .send({ displayName: '新名称' })
    expectOk(res, 200)
    expect(res.body.displayName).toBe('新名称')
  })

  it('PUT /api/dynamic-widgets/:widgetType 不存在 → 404', async () => {
    const res = await auth(request(app).put('/api/dynamic-widgets/nonexistent_widget'))
      .send({ displayName: 'test' })
    expectError(res, 404)
  })

  it('DELETE /api/dynamic-widgets/:widgetType → 200', async () => {
    await auth(request(app).post('/api/dynamic-widgets'))
      .send({
        widgetType: 'delete_test_widget',
        componentEnv: 'pure-frontend',
      })

    const res = await auth(request(app).delete('/api/dynamic-widgets/delete_test_widget'))
    expectOk(res, 200)
    expect(res.body.ok).toBe(true)
  })

  it('DELETE /api/dynamic-widgets/:widgetType 不存在 → 404', async () => {
    const res = await auth(request(app).delete('/api/dynamic-widgets/nonexistent_widget'))
    expectError(res, 404)
  })
})

// ============================================================================
// localServices 路由
// ============================================================================
describe('localServices 路由', () => {
  it('POST /api/local-services/register → 201', async () => {
    const res = await auth(request(app).post('/api/local-services/register'))
      .set('X-Device-Id', 'test-device-1')
      .send({
        serviceName: 'test-service',
        endpoint: 'http://localhost:8080',
        description: '测试服务',
      })
    expectOk(res, 201)
    expect(res.body.serviceName).toBe('test-service')
    expect(res.body.endpoint).toBe('http://localhost:8080')
    // SQLite 存储布尔值为 0/1，用 toBeTruthy 兼容
    expect(res.body.online).toBeTruthy()
  })

  it('POST /api/local-services/register invalid endpoint（file://）→ 400', async () => {
    const res = await auth(request(app).post('/api/local-services/register'))
      .set('X-Device-Id', 'test-device-2')
      .send({
        serviceName: 'bad-service',
        endpoint: 'file:///etc/passwd',
      })
    expectError(res, 400)
  })

  it('POST /api/local-services/heartbeat → 200', async () => {
    // 先注册服务
    await auth(request(app).post('/api/local-services/register'))
      .set('X-Device-Id', 'test-device-3')
      .send({
        serviceName: 'heartbeat-service',
        endpoint: 'http://localhost:9090',
      })

    const res = await auth(request(app).post('/api/local-services/heartbeat'))
      .set('X-Device-Id', 'test-device-3')
      .send({ serviceName: 'heartbeat-service' })
    expectOk(res, 200)
    expect(res.body.ok).toBe(true)
    expect(res.body.updated).toBeGreaterThanOrEqual(1)
  })

  it('GET /api/local-services/list → 200', async () => {
    // 先注册一个在线服务
    await auth(request(app).post('/api/local-services/register'))
      .set('X-Device-Id', 'test-device-4')
      .send({
        serviceName: 'list-service',
        endpoint: 'http://localhost:7070',
      })

    const res = await auth(request(app).get('/api/local-services/list'))
    expectOk(res, 200)
    expect(Array.isArray(res.body)).toBe(true)
    expect(res.body.length).toBeGreaterThanOrEqual(1)
  })
})
