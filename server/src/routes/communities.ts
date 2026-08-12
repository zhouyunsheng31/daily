import { Router } from 'express'
import { v4 as uuidv4 } from 'uuid'
import { getPool } from '../db/connection.js'
import { createError } from '../middleware/error.js'
import { OFFICIAL_COMMUNITIES, type OfficialCommunity } from '../officialCommunities.js'

export const communitiesRouter = Router()

// ============================================================================
// Phase 6：联邦式社区 API（spec §9 节）
//
// 联邦模型：每个 Daily 部署 = 一个独立社区实例，独立用户系统。
// communities 表只记录"本实例已聚合的外部社区地址"，不存储外部用户/内容。
// 用户在 A 社区注册后不能在 B 社区投稿，必须各自注册（spec §9.2）。
//
// 路由：
// - GET  /api/communities           — 本实例已添加的社区列表
// - GET  /api/communities/official  — 官方社区清单（硬编码 + 本实例 is_official 记录合并去重）
// - POST /api/communities           — 添加社区（手动输入地址 或 从官方清单一键添加）
// - DELETE /api/communities/:id     — 移除已添加的社区
// ============================================================================

interface CommunityRow {
  id: string
  name: string
  description: string | null
  api_url: string
  icon: string | null
  is_official: boolean | number
  added_by: string | null
  created_at: number
}

interface PublicCommunity {
  id: string
  name: string
  description: string | null
  apiUrl: string
  icon: string | null
  isOfficial: boolean
  addedBy: string | null
  createdAt: number
}

function parseCommunityRow(row: CommunityRow): PublicCommunity {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    apiUrl: row.api_url,
    icon: row.icon,
    isOfficial: typeof row.is_official === 'number' ? row.is_official !== 0 : !!row.is_official,
    addedBy: row.added_by,
    createdAt: row.created_at,
  }
}

/**
 * 校验 API 地址格式（必须是 http(s):// 开头的合法 URL）
 */
function isValidApiUrl(url: string): boolean {
  try {
    const u = new URL(url)
    return u.protocol === 'http:' || u.protocol === 'https:'
  } catch {
    return false
  }
}

// ----------------------------------------------------------------------------
// GET /api/communities/official — 官方社区清单
// 返回硬编码官方社区 + 本实例 DB 中 is_official=TRUE 的记录，按 apiUrl 去重
// 每条额外标注 added（是否已被本实例添加），供前端"一键添加/已添加"按钮判断
// ----------------------------------------------------------------------------
communitiesRouter.get('/official', async (_req, res, next) => {
  try {
    const pool = getPool()
    // 本实例已添加的所有社区（含官方 + 手动），用于标记 added 状态
    const addedResult = await pool.query('SELECT api_url FROM communities')
    const addedUrls = new Set(addedResult.rows.map((r: { api_url: string }) => r.api_url))

    // DB 中的官方记录（部署者可能用 SQL 直接插入了自定义官方社区）
    const dbOfficial = await pool.query('SELECT * FROM communities WHERE is_official = TRUE')
    const dbOfficialByApiUrl = new Map<string, PublicCommunity>()
    for (const row of dbOfficial.rows as CommunityRow[]) {
      dbOfficialByApiUrl.set(row.api_url, parseCommunityRow(row))
    }

    // 合并：硬编码官方清单优先，DB 官方记录补充未在硬编码清单中的
    // Phase 7 §14：内置社区（isBuiltin=true）始终 added=true，无需"添加"操作
    const merged: (OfficialCommunity & { added: boolean })[] = []
    for (const oc of OFFICIAL_COMMUNITIES) {
      const added = oc.isBuiltin ? true : addedUrls.has(oc.apiUrl)
      merged.push({ ...oc, added })
    }
    for (const [apiUrl, c] of dbOfficialByApiUrl) {
      if (!OFFICIAL_COMMUNITIES.some((oc) => oc.apiUrl === apiUrl)) {
        merged.push({
          id: c.id,
          name: c.name,
          description: c.description ?? '',
          apiUrl,
          icon: c.icon ?? undefined,
          added: true,
        })
      }
    }

    res.json({ communities: merged })
  } catch (e) { next(e) }
})

// ----------------------------------------------------------------------------
// GET /api/communities — 本实例已添加的社区列表
// ----------------------------------------------------------------------------
communitiesRouter.get('/', async (_req, res, next) => {
  try {
    const pool = getPool()
    const result = await pool.query('SELECT * FROM communities ORDER BY created_at ASC')
    res.json({ communities: (result.rows as CommunityRow[]).map(parseCommunityRow) })
  } catch (e) { next(e) }
})

// ----------------------------------------------------------------------------
// POST /api/communities — 添加社区
// body: { name, apiUrl, description?, icon?, isOfficial? }
// - apiUrl 必须是合法 http(s) URL
// - 同一 apiUrl 只能添加一次（UNIQUE 约束）
// - addedBy 记录操作者（多用户模式下取 req.user.userId，单密码模式为 null）
// ----------------------------------------------------------------------------
communitiesRouter.post('/', async (req, res, next) => {
  try {
    const body = req.body as {
      name?: string
      apiUrl?: string
      description?: string
      icon?: string
      isOfficial?: boolean
    }

    if (!body.name || typeof body.name !== 'string' || body.name.trim().length === 0) {
      next(createError(400, 'INVALID_INPUT', '社区名称必填'))
      return
    }
    if (!body.apiUrl || !isValidApiUrl(body.apiUrl)) {
      next(createError(400, 'INVALID_INPUT', '社区 API 地址必须是合法的 http(s) URL'))
      return
    }

    const pool = getPool()
    const apiUrl = body.apiUrl.trim()
    const name = body.name.trim()
    const description = body.description?.trim() || null
    const icon = body.icon?.trim() || null
    const isOfficial = body.isOfficial === true
    const addedBy = req.user?.userId ?? null
    const id = uuidv4()
    const now = Date.now()

    try {
      await pool.query(
        `INSERT INTO communities (id, name, description, api_url, icon, is_official, added_by, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [id, name, description, apiUrl, icon, isOfficial, addedBy, now]
      )
    } catch (insertErr: unknown) {
      // UNIQUE 约束冲突（api_url 已存在）→ 返回 409
      const msg = insertErr instanceof Error ? insertErr.message : String(insertErr)
      if (msg.includes('communities_api_url') || msg.toLowerCase().includes('unique')) {
        next(createError(409, 'COMMUNITY_EXISTS', '该社区地址已添加'))
        return
      }
      throw insertErr
    }

    const result = await pool.query('SELECT * FROM communities WHERE id = $1', [id])
    const community = parseCommunityRow(result.rows[0] as CommunityRow)
    res.status(201).json(community)
  } catch (e) { next(e) }
})

// ----------------------------------------------------------------------------
// Phase 6.4：社区成员管理/筛选
//
// 联邦式社区模型下，外部社区的用户系统独立，本实例不直接存储外部用户。
// 此处提供"成员视图"用于演示用户管理与筛选能力：
// - GET  /api/communities/:id/members       — 返回该社区的成员列表（模拟数据 + 本地 users 关联）
// - POST /api/communities/:id/sync-members  — 模拟从外部社区同步成员（返回同步结果）
// ----------------------------------------------------------------------------

type MemberRole = 'admin' | 'moderator' | 'member' | 'guest'
type MemberStatus = 'active' | 'inactive' | 'banned'

interface CommunityMember {
  id: string
  username: string
  role: MemberRole
  status: MemberStatus
  joinedAt: number
  /** 是否为本实例已注册用户（true=本地 users 表匹配，false=外部社区成员） */
  isLocal: boolean
}

/**
 * 基于社区 id 的简易确定性伪随机数生成器（同一社区每次返回相同成员）
 * 用于生成稳定的外部社区模拟成员数据
 */
function seededRand(seed: string): () => number {
  let h = 1779033703 ^ seed.length
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353)
    h = (h << 13) | (h >>> 19)
  }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507)
    h = Math.imul(h ^ (h >>> 13), 3266489909)
    h ^= h >>> 16
    return (h >>> 0) / 4294967296
  }
}

const MOCK_USERNAMES = [
  'alice', 'bob', 'charlie', 'diana', 'eve', 'frank', 'grace', 'henry',
  'iris', 'jack', 'karen', 'leo', 'mia', 'noah', 'olivia', 'peter',
  'quinn', 'ruby', 'sam', 'tina', 'uma', 'victor', 'wendy', 'xavier',
]

const ROLES: MemberRole[] = ['admin', 'moderator', 'member', 'member', 'member', 'guest']
const STATUSES: MemberStatus[] = ['active', 'active', 'active', 'inactive', 'banned']

/**
 * MOCK 端点显式标注：当前为模拟数据，联邦式社区功能将在后续版本实现。
 * 设计文档 §14.2 允许 MVP 降级，但必须在响应中显式标注让前端/用户知道。
 */
const MOCK_NOTE = '当前为模拟数据，联邦式社区功能将在后续版本实现'

/**
 * TODO: 联邦成员同步 - 当前为 mock 数据
 *
 * 设计文档 §14.2 明确"先不做整合，只留框架"。
 * MVP 阶段使用 mock 成员数据，后续接入真实联邦社区 API。
 * 真实实现需要：
 * 1. 调用外部社区的 /api/members 接口
 * 2. 用户筛选与同步
 * 3. 跨社区用户管理
 */

/**
 * 为指定社区生成确定性模拟成员列表
 */
function generateMockMembers(communityId: string): CommunityMember[] {
  const rand = seededRand(communityId)
  const count = 8 + Math.floor(rand() * 8) // 8-15 人
  const members: CommunityMember[] = []
  const usedNames = new Set<string>()
  const now = Date.now()
  for (let i = 0; i < count; i++) {
    let name = MOCK_USERNAMES[Math.floor(rand() * MOCK_USERNAMES.length)]
    // 避免重名
    let suffix = 0
    while (usedNames.has(name)) {
      suffix++
      name = MOCK_USERNAMES[Math.floor(rand() * MOCK_USERNAMES.length)] + String(suffix)
    }
    usedNames.add(name)
    members.push({
      id: `mock-${communityId}-${i}`,
      username: name,
      role: ROLES[Math.floor(rand() * ROLES.length)],
      status: STATUSES[Math.floor(rand() * STATUSES.length)],
      joinedAt: now - Math.floor(rand() * 90 * 24 * 3600 * 1000), // 近 90 天内
      isLocal: false,
    })
  }
  return members
}

// ----------------------------------------------------------------------------
// GET /api/communities/:id/members — 返回社区成员列表
// 返回：模拟外部成员 + 本地 users 表关联（isLocal=true 标记）
// ----------------------------------------------------------------------------
communitiesRouter.get('/:id/members', async (req, res, next) => {
  try {
    const pool = getPool()
    // 确认社区存在
    const cResult = await pool.query('SELECT * FROM communities WHERE id = $1', [req.params.id])
    if (cResult.rows.length === 0) {
      next(createError(404, 'NOT_FOUND', `Community ${req.params.id} not found`))
      return
    }
    const community = parseCommunityRow(cResult.rows[0] as CommunityRow)

    // 1. 模拟外部社区成员
    const externalMembers = generateMockMembers(community.id)

    // 2. 本地 users 表（标记为 isLocal=true，用于演示用户筛选/管理）
    const localResult = await pool.query(
      'SELECT id, username, role, is_banned, created_at FROM users ORDER BY created_at ASC LIMIT 50'
    )
    const localMembers: CommunityMember[] = (localResult.rows as Array<{
      id: string; username: string; role: string; is_banned: boolean | number; created_at: number
    }>).map((u) => ({
      id: u.id,
      username: u.username,
      role: (u.role === 'admin' ? 'admin' : 'member') as MemberRole,
      status: (typeof u.is_banned === 'number' ? u.is_banned !== 0 : !!u.is_banned) ? 'banned' : 'active',
      joinedAt: u.created_at,
      isLocal: true,
    }))

    res.json({
      community: { id: community.id, name: community.name, apiUrl: community.apiUrl },
      members: [...localMembers, ...externalMembers],
      total: localMembers.length + externalMembers.length,
      // MOCK 标注：外部成员为模拟数据（本地 users 为真实数据），整体响应标记为 mock
      isMock: true,
      mockNote: MOCK_NOTE,
    })
  } catch (e) { next(e) }
})

// ----------------------------------------------------------------------------
// POST /api/communities/:id/sync-members — 模拟从外部社区同步成员
// 返回同步结果（新增/更新/移除计数 + 最新成员快照）
// ----------------------------------------------------------------------------
communitiesRouter.post('/:id/sync-members', async (req, res, next) => {
  try {
    const pool = getPool()
    const cResult = await pool.query('SELECT * FROM communities WHERE id = $1', [req.params.id])
    if (cResult.rows.length === 0) {
      next(createError(404, 'NOT_FOUND', `Community ${req.params.id} not found`))
      return
    }
    const community = parseCommunityRow(cResult.rows[0] as CommunityRow)

    // 内置社区无法同步（无外部 API）
    if (!community.apiUrl) {
      next(createError(400, 'BUILTIN_COMMUNITY', '内置社区无需同步成员'))
      return
    }

    // 模拟同步：生成一份新的成员快照，随机增减
    const rand = seededRand(community.id + ':sync:' + Date.now())
    const freshMembers = generateMockMembers(community.id + ':sync:' + Math.floor(Date.now() / 1000))
    const added = Math.floor(rand() * 3) + 1   // 1-3 新增
    const updated = Math.floor(rand() * 4)      // 0-3 更新
    const removed = Math.floor(rand() * 2)      // 0-1 移除

    res.json({
      community: { id: community.id, name: community.name, apiUrl: community.apiUrl },
      syncResult: {
        added,
        updated,
        removed,
        syncedAt: Date.now(),
        message: `同步完成：新增 ${added} 人，更新 ${updated} 人，移除 ${removed} 人`,
      },
      members: freshMembers,
      total: freshMembers.length,
      // MOCK 标注：同步结果为模拟数据，未真正调用外部社区 API
      isMock: true,
      mockNote: MOCK_NOTE,
    })
  } catch (e) { next(e) }
})

// ----------------------------------------------------------------------------
// DELETE /api/communities/:id — 移除已添加的社区
// ----------------------------------------------------------------------------
communitiesRouter.delete('/:id', async (req, res, next) => {
  try {
    const pool = getPool()
    const result = await pool.query('DELETE FROM communities WHERE id = $1 RETURNING id', [req.params.id])
    if (result.rows.length === 0) {
      next(createError(404, 'NOT_FOUND', `Community ${req.params.id} not found`))
      return
    }
    res.json({ success: true, id: req.params.id })
  } catch (e) { next(e) }
})
