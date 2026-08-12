// ============================================================================
// Phase 4 运行时验证：多用户系统 + 面板多建
// ============================================================================
// 验证项：
// 1. 注册第一个用户 → 自动 admin
// 2. 登录 → 返回 JWT + user
// 3. GET /me → 返回用户信息
// 4. 创建个人面板
// 5. 创建社区面板（admin 可创建）
// 6. GET /panels → 返回个人 + 社区面板
// 7. 注册第二个用户 → 自动 member
// 8. member 不能创建社区面板（403）
// 9. admin 列出用户 / 封禁 / 改角色
// 10. 被封禁用户不能登录
// ============================================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import request from 'supertest'
import type { Express } from 'express'
import { createTestDb } from '../helpers/db.js'
import { createTestApp } from '../helpers/server.js'

let app: Express
let cleanupDb: () => Promise<void>
let cleanupApp: () => Promise<void>

beforeEach(async () => {
  const db = await createTestDb()
  cleanupDb = db.cleanup
  const testApp = await createTestApp()
  app = testApp.app
  cleanupApp = testApp.cleanup
})

afterEach(async () => {
  await cleanupApp()
  await cleanupDb()
})

function extractToken(res: request.Response): string {
  // 优先从 body.token，其次从 Set-Cookie
  if (res.body?.token) return res.body.token as string
  const setCookie = res.headers['set-cookie'] as unknown as string[] | undefined
  if (setCookie && setCookie.length > 0) {
    const match = setCookie[0].match(/access_token=([^;]+)/)
    if (match) return match[1]
  }
  throw new Error('No token found in response')
}

describe('Phase 4: 多用户系统', () => {
  it('1. 注册第一个用户自动成为 admin', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ username: 'alice', email: 'alice@example.com', password: 'pass1234' })

    expect(res.status).toBe(201)
    expect(res.body.authenticated).toBe(true)
    expect(res.body.token).toBeTruthy()
    expect(res.body.user.username).toBe('alice')
    expect(res.body.user.role).toBe('admin')
  })

  it('2. 用户名重复注册返回 409', async () => {
    await request(app)
      .post('/api/auth/register')
      .send({ username: 'alice', email: 'alice@example.com', password: 'pass1234' })

    const res = await request(app)
      .post('/api/auth/register')
      .send({ username: 'alice', email: 'alice2@example.com', password: 'pass1234' })

    expect(res.status).toBe(409)
  })

  it('3. 登录返回 JWT + user', async () => {
    await request(app)
      .post('/api/auth/register')
      .send({ username: 'bob', email: 'bob@example.com', password: 'pass1234' })

    const res = await request(app)
      .post('/api/auth/login')
      .send({ username: 'bob', password: 'pass1234' })

    expect(res.status).toBe(200)
    expect(res.body.authenticated).toBe(true)
    expect(res.body.token).toBeTruthy()
    expect(res.body.user.username).toBe('bob')
  })

  it('4. 用邮箱登录同样有效', async () => {
    await request(app)
      .post('/api/auth/register')
      .send({ username: 'carol', email: 'carol@example.com', password: 'pass1234' })

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'carol@example.com', password: 'pass1234' })

    expect(res.status).toBe(200)
    expect(res.body.user.username).toBe('carol')
  })

  it('5. 错误密码登录返回 401', async () => {
    await request(app)
      .post('/api/auth/register')
      .send({ username: 'dave', email: 'dave@example.com', password: 'pass1234' })

    const res = await request(app)
      .post('/api/auth/login')
      .send({ username: 'dave', password: 'wrongpass' })

    expect(res.status).toBe(401)
  })

  it('6. GET /me 返回当前用户信息', async () => {
    const reg = await request(app)
      .post('/api/auth/register')
      .send({ username: 'eve', email: 'eve@example.com', password: 'pass1234' })
    const token = extractToken(reg)

    const res = await request(app)
      .get('/api/auth/me')
      .set('Cookie', [`access_token=${token}`])

    expect(res.status).toBe(200)
    expect(res.body.authenticated).toBe(true)
    expect(res.body.user.username).toBe('eve')
    expect(res.body.user.role).toBe('admin')
  })

  it('7. 未登录访问 /me 返回 401', async () => {
    const res = await request(app).get('/api/auth/me')
    expect(res.status).toBe(401)
  })
})

describe('Phase 4: 面板多建', () => {
  let adminToken: string
  let memberToken: string

  beforeEach(async () => {
    // 注册 admin（第一个用户）
    const adminRes = await request(app)
      .post('/api/auth/register')
      .send({ username: 'admin1', email: 'admin1@example.com', password: 'pass1234' })
    adminToken = extractToken(adminRes)

    // 注册 member（第二个用户）
    const memberRes = await request(app)
      .post('/api/auth/register')
      .send({ username: 'member1', email: 'member1@example.com', password: 'pass1234' })
    memberToken = extractToken(memberRes)
  })

  it('8. admin 可创建个人面板', async () => {
    const res = await request(app)
      .post('/api/panels')
      .set('Cookie', [`access_token=${adminToken}`])
      .send({ name: '我的面板' })

    expect(res.status).toBe(201)
    expect(res.body.name).toBe('我的面板')
    expect(res.body.isCommunity).toBe(false)
    expect(res.body.ownerId).toBeTruthy()
  })

  it('9. admin 可创建社区面板', async () => {
    const res = await request(app)
      .post('/api/panels')
      .set('Cookie', [`access_token=${adminToken}`])
      .send({ name: '社区面板', isCommunity: true })

    expect(res.status).toBe(201)
    expect(res.body.name).toBe('社区面板')
    expect(res.body.isCommunity).toBe(true)
  })

  it('10. member 不能创建社区面板（403）', async () => {
    const res = await request(app)
      .post('/api/panels')
      .set('Cookie', [`access_token=${memberToken}`])
      .send({ name: '社区面板2', isCommunity: true })

    expect(res.status).toBe(403)
  })

  it('11. GET /panels 返回个人面板 + 社区面板', async () => {
    // admin 创建个人面板 + 社区面板
    await request(app)
      .post('/api/panels')
      .set('Cookie', [`access_token=${adminToken}`])
      .send({ name: 'admin个人' })
    await request(app)
      .post('/api/panels')
      .set('Cookie', [`access_token=${adminToken}`])
      .send({ name: '社区面板', isCommunity: true })

    // member 创建个人面板
    await request(app)
      .post('/api/panels')
      .set('Cookie', [`access_token=${memberToken}`])
      .send({ name: 'member个人' })

    // admin 获取面板列表
    const adminRes = await request(app)
      .get('/api/panels')
      .set('Cookie', [`access_token=${adminToken}`])
    expect(adminRes.status).toBe(200)
    const adminPanelNames = adminRes.body.map((p: { name: string }) => p.name)
    // admin 能看到：自己的 2 个 + 社区 1 个
    expect(adminPanelNames).toContain('admin个人')
    expect(adminPanelNames).toContain('社区面板')
    expect(adminPanelNames).not.toContain('member个人')

    // member 获取面板列表
    const memberRes = await request(app)
      .get('/api/panels')
      .set('Cookie', [`access_token=${memberToken}`])
    expect(memberRes.status).toBe(200)
    const memberPanelNames = memberRes.body.map((p: { name: string }) => p.name)
    // member 能看到：自己的 1 个 + 社区 1 个
    expect(memberPanelNames).toContain('member个人')
    expect(memberPanelNames).toContain('社区面板')
    expect(memberPanelNames).not.toContain('admin个人')
  })

  it('12. 全局组件 API GET /widgets/global 返回空数组', async () => {
    const res = await request(app)
      .get('/api/widgets/global')
      .set('Cookie', [`access_token=${adminToken}`])
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body)).toBe(true)
  })
})

describe('Phase 4: 管理员后台', () => {
  let adminToken: string
  let memberToken: string
  let memberUserId: string

  beforeEach(async () => {
    const adminRes = await request(app)
      .post('/api/auth/register')
      .send({ username: 'admin2', email: 'admin2@example.com', password: 'pass1234' })
    adminToken = extractToken(adminRes)

    const memberRes = await request(app)
      .post('/api/auth/register')
      .send({ username: 'member2', email: 'member2@example.com', password: 'pass1234' })
    memberToken = extractToken(memberRes)
    memberUserId = memberRes.body.user.id
  })

  it('13. admin 可列出所有用户', async () => {
    const res = await request(app)
      .get('/api/admin/users')
      .set('Cookie', [`access_token=${adminToken}`])

    expect(res.status).toBe(200)
    expect(Array.isArray(res.body)).toBe(true)
    expect(res.body.length).toBe(2)
    const usernames = res.body.map((u: { username: string }) => u.username)
    expect(usernames).toContain('admin2')
    expect(usernames).toContain('member2')
  })

  it('14. member 不能访问 admin 路由（403）', async () => {
    const res = await request(app)
      .get('/api/admin/users')
      .set('Cookie', [`access_token=${memberToken}`])

    expect(res.status).toBe(403)
  })

  it('15. admin 可封禁用户', async () => {
    const res = await request(app)
      .put(`/api/admin/users/${memberUserId}/ban`)
      .set('Cookie', [`access_token=${adminToken}`])
      .send({ isBanned: true })

    expect(res.status).toBe(200)
    expect(res.body.isBanned).toBe(true)
  })

  it('16. 被封禁用户不能登录（403）', async () => {
    await request(app)
      .put(`/api/admin/users/${memberUserId}/ban`)
      .set('Cookie', [`access_token=${adminToken}`])
      .send({ isBanned: true })

    const res = await request(app)
      .post('/api/auth/login')
      .send({ username: 'member2', password: 'pass1234' })

    expect(res.status).toBe(403)
  })

  it('17. admin 可修改用户角色', async () => {
    const res = await request(app)
      .put(`/api/admin/users/${memberUserId}/role`)
      .set('Cookie', [`access_token=${adminToken}`])
      .send({ role: 'admin' })

    expect(res.status).toBe(200)
    expect(res.body.role).toBe('admin')
  })

  it('18. admin 可解封用户', async () => {
    // 先封禁
    await request(app)
      .put(`/api/admin/users/${memberUserId}/ban`)
      .set('Cookie', [`access_token=${adminToken}`])
      .send({ isBanned: true })
    // 再解封
    const res = await request(app)
      .put(`/api/admin/users/${memberUserId}/ban`)
      .set('Cookie', [`access_token=${adminToken}`])
      .send({ isBanned: false })

    expect(res.status).toBe(200)
    expect(res.body.isBanned).toBe(false)
  })
})
