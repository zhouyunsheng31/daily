import { Router, type Request, type Response, type NextFunction } from 'express'
import { v4 as uuidv4 } from 'uuid'
import { getPool, withTransaction } from '../db/connection.js'
import { createError } from '../middleware/error.js'
import { broadcastChange } from '../ws.js'
import type { CreatePanelRequest, UpdatePanelRequest } from '../types/index.js'

export const panelsRouter = Router()

// 免鉴权展示面板路由：GET /api/panels/demo
// 在 index.ts 中通过 app.get('/api/panels/demo', getDemoPanel) 直接注册（authMiddleware 之前）
// 供游客（未登录）访问首页时获取展示面板 + widgets
export async function getDemoPanel(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const pool = getPool()
    // 查询展示面板（id 固定 builtin-showcase；is_community=TRUE 兜底）
    const panelResult = await pool.query(
      `SELECT * FROM panels WHERE id = $1 AND is_community = TRUE`,
      ['builtin-showcase']
    )
    if (panelResult.rows.length === 0) {
      res.status(404).json({ error: '展示面板尚未 seed' })
      return
    }
    const panel = parsePanelRow(panelResult.rows[0])

    // 查询该面板的 widgets，按 z_index 升序
    const widgetsResult = await pool.query(
      `SELECT * FROM widgets WHERE panel_id = $1 ORDER BY z_index ASC`,
      ['builtin-showcase']
    )
    const widgets = widgetsResult.rows.map(parseWidgetRow)

    res.json({ panel, widgets })
  } catch (e) {
    next(e instanceof Error ? e : new Error(String(e)))
  }
}

// GET /api/panels — 获取当前用户的面板列表（个人 + 社区）
// 多用户模式：owner_id = 当前用户 的个人面板 + 所有 is_community = TRUE 的社区面板
// 未登录 / 游客 / 单密码模式（无 userId）：只返回 is_community = TRUE 的社区面板（修复软鉴权泄露）
panelsRouter.get('/', async (req, res, next) => {
  try {
    const pool = getPool()
    const userId = req.user?.userId
    let result
    if (userId) {
      result = await pool.query(
        `SELECT * FROM panels WHERE owner_id = $1 OR is_community = TRUE ORDER BY sort_order ASC`,
        [userId]
      )
    } else {
      // 游客 / 单密码 / dev 模式无 userId：只返回社区面板，绝不返回其他用户私有面板
      result = await pool.query(
        'SELECT * FROM panels WHERE is_community = TRUE ORDER BY sort_order ASC'
      )
    }
    res.json(result.rows.map(parsePanelRow))
  } catch (e) { next(e) }
})

// GET /api/panels/community — 获取所有社区面板
panelsRouter.get('/community', async (_req, res, next) => {
  try {
    const pool = getPool()
    const result = await pool.query('SELECT * FROM panels WHERE is_community = TRUE ORDER BY sort_order ASC')
    res.json(result.rows.map(parsePanelRow))
  } catch (e) { next(e) }
})

// GET /api/panels/active
panelsRouter.get('/active', async (_req, res, next) => {
  try {
    const pool = getPool()
    const result = await pool.query("SELECT value FROM settings WHERE key = 'activePanelId'")
    const row = result.rows[0]
    res.json({ activePanelId: row ? row.value : null })
  } catch (e) { next(e) }
})

// PUT /api/panels/active
panelsRouter.put('/active', async (req, res, next) => {
  try {
    const pool = getPool()
    const { activePanelId } = req.body as { activePanelId: string | null }
    await pool.query(
      `INSERT INTO settings (key, value, updated_at) VALUES ('activePanelId', $1, $2)
       ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = $2`,
      [activePanelId, Date.now()]
    )
    res.json({ activePanelId })
    broadcastChange({ kind: 'panel_active_changed', data: { activePanelId } }, req.deviceId)
  } catch (e) { next(e) }
})

// PUT /api/panels/reorder
panelsRouter.put('/reorder', async (req, res, next) => {
  try {
    const pool = getPool()
    const { panelIds } = req.body as { panelIds: string[] }
    const now = Date.now()
    await withTransaction(async (client) => {
      for (let i = 0; i < panelIds.length; i++) {
        await client.query(
          'UPDATE panels SET sort_order = $1, updated_at = $2 WHERE id = $3',
          [i, now, panelIds[i]]
        )
      }
    })
    res.json({ ok: true })
    broadcastChange({ kind: 'panels_reordered', data: { panelIds } }, req.deviceId)
  } catch (e) { next(e) }
})

// GET /api/panels/:id
panelsRouter.get('/:id', async (req, res, next) => {
  try {
    const pool = getPool()
    const result = await pool.query('SELECT * FROM panels WHERE id = $1', [req.params.id])
    if (result.rows.length === 0) throw createError(404, 'NOT_FOUND', `Panel ${req.params.id} not found`)
    res.json(parsePanelRow(result.rows[0]))
  } catch (e) { next(e) }
})

// POST /api/panels — 创建面板（个人或社区）
// 多用户模式：ownerId = 当前用户；社区面板需 admin 权限
// 单密码模式：ownerId = null（向后兼容）
// spec §9.4：社区面板可携带 communityApiUrl 连接外部社群
panelsRouter.post('/', async (req, res, next) => {
  try {
    const pool = getPool()
    const body = req.body as CreatePanelRequest
    const id = body.id || uuidv4()
    const now = Date.now()
    const ownerId = req.user?.userId ?? null
    const isCommunity = body.isCommunity === true
    const communityApiUrl = body.communityApiUrl ?? null

    // 社区面板需要 admin 权限
    if (isCommunity && req.user?.role !== 'admin') {
      next(createError(403, 'FORBIDDEN', '创建社区面板需要管理员权限'))
      return
    }

    await pool.query(
      `INSERT INTO panels (id, name, sort_order, settings, canvas_transform, created_at, updated_at, owner_id, is_community, community_api_url)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        id, body.name || '未命名', body.sortOrder ?? 0,
        JSON.stringify(body.settings ?? {}),
        body.canvasTransform ? JSON.stringify(body.canvasTransform) : null,
        now, now, ownerId, isCommunity, communityApiUrl
      ]
    )
    const result = await pool.query('SELECT * FROM panels WHERE id = $1', [id])
    const panel = parsePanelRow(result.rows[0])
    res.status(201).json(panel)
    broadcastChange({ kind: 'panel_created', data: panel }, req.deviceId)
  } catch (e) { next(e) }
})

// PUT /api/panels/:id — 更新面板（含权限检查）
panelsRouter.put('/:id', async (req, res, next) => {
  try {
    const pool = getPool()
    const body = req.body as UpdatePanelRequest
    const existing = await pool.query('SELECT * FROM panels WHERE id = $1', [req.params.id])
    if (existing.rows.length === 0) throw createError(404, 'NOT_FOUND', `Panel ${req.params.id} not found`)

    // Phase 4：权限检查 — 非社区面板只有 owner 或 admin 可修改
    const panel = parsePanelRow(existing.rows[0])
    const userId = req.user?.userId
    if (userId && !panel.isCommunity && panel.ownerId && panel.ownerId !== userId && req.user?.role !== 'admin') {
      next(createError(403, 'FORBIDDEN', '无权修改他人面板'))
      return
    }

    const now = Date.now()
    const updates: string[] = []
    const values: unknown[] = []
    let paramIdx = 1

    if (body.name !== undefined) { updates.push(`name = $${paramIdx++}`); values.push(body.name) }
    if (body.sortOrder !== undefined) { updates.push(`sort_order = $${paramIdx++}`); values.push(body.sortOrder) }
    if (body.settings !== undefined) { updates.push(`settings = $${paramIdx++}`); values.push(JSON.stringify(body.settings)) }
    if (body.canvasTransform !== undefined) {
      updates.push(`canvas_transform = $${paramIdx++}`)
      values.push(body.canvasTransform ? JSON.stringify(body.canvasTransform) : null)
    }
    if (body.isCommunity !== undefined) {
      // 只有 admin 可以切换社区面板状态
      if (req.user?.role !== 'admin') {
        next(createError(403, 'FORBIDDEN', '切换社区面板状态需要管理员权限'))
        return
      }
      updates.push(`is_community = $${paramIdx++}`)
      values.push(body.isCommunity)
    }
    if (body.communityApiUrl !== undefined) {
      updates.push(`community_api_url = $${paramIdx++}`)
      values.push(body.communityApiUrl ?? null)
    }

    if (updates.length > 0) {
      updates.push(`updated_at = $${paramIdx++}`)
      values.push(now)
      values.push(req.params.id)
      await pool.query(`UPDATE panels SET ${updates.join(', ')} WHERE id = $${paramIdx}`, values)
    }

    const result = await pool.query('SELECT * FROM panels WHERE id = $1', [req.params.id])
    const updatedPanel = parsePanelRow(result.rows[0])
    res.json(updatedPanel)
    broadcastChange({ kind: 'panel_updated', data: updatedPanel }, req.deviceId)
  } catch (e) { next(e) }
})

// GET /api/panels/:id/memory-state
panelsRouter.get('/:id/memory-state', async (req, res, next) => {
  try {
    const pool = getPool()
    const result = await pool.query(
      'SELECT saved_state, saved_at FROM panel_memory_states WHERE panel_id = $1',
      [req.params.id]
    )
    if (result.rows.length === 0) {
      res.json({ savedState: null, savedAt: null })
    } else {
      res.json({
        savedState: result.rows[0].saved_state,
        savedAt: result.rows[0].saved_at,
      })
    }
  } catch (e) { next(e) }
})

// PUT /api/panels/:id/memory-state
panelsRouter.put('/:id/memory-state', async (req, res, next) => {
  try {
    const pool = getPool()
    const { savedState } = req.body as { savedState: Record<string, unknown> }
    const now = Date.now()
    await pool.query(
      `INSERT INTO panel_memory_states (panel_id, saved_state, saved_at)
       VALUES ($1, $2, $3)
       ON CONFLICT (panel_id) DO UPDATE SET saved_state = $2, saved_at = $3`,
      [req.params.id, JSON.stringify(savedState ?? {}), now]
    )
    res.json({ ok: true, savedAt: now })
  } catch (e) { next(e) }
})

// DELETE /api/panels/:id
panelsRouter.delete('/:id', async (req, res) => {
  const panelId = req.params.id
  const sourceDeviceId = req.deviceId

  try {
    // 1. 先在事务外销毁内存中的 session（不阻塞事务，失败仅 warn）
    // Phase 14 C4：动态 import piBridge，避免静态 import 触发 pi-coding-agent 加载挂起
    try {
      const { disposePanelSession } = await import('../piBridge.js')
      await disposePanelSession(panelId)
    } catch (err) {
      console.warn(`[Panels] disposePanelSession failed for ${panelId}:`, err)
    }

    // 2. 同事务删除 panel + ai_conversations + ai_memories
    await withTransaction(async (client) => {
      // 删除 panel（级联删 widgets / panel_memory_states）
      const result = await client.query('DELETE FROM panels WHERE id = $1 RETURNING *', [panelId])
      if (result.rows.length === 0) {
        throw new Error('panel not found')  // 触发回滚
      }
      // 删除 AI 对话历史
      await client.query('DELETE FROM ai_conversations WHERE panel_id = $1', [panelId])
      // 删除 AI 长期记忆
      await client.query('DELETE FROM ai_memories WHERE panel_id = $1', [panelId])
      return result.rows[0]
    })

    // 3. 广播变更（事务提交后）
    broadcastChange({ kind: 'panel_deleted', data: { id: panelId } }, sourceDeviceId)
    res.json({ success: true, id: panelId })
  } catch (err) {
    console.error(`[Panels] Failed to delete panel ${panelId}:`, err)
    // 事务已回滚，panel / ai_conversations / ai_memories 数据仍完整。
    // 内存 session 可能已销毁（disposePanelSession 在事务外执行），但下次收到该 panel 的 user_message 时，
    // getOrCreatePanelSession 会重建 session 并调用 restoreSessionContext 从 DB 恢复历史（DB 数据因回滚仍完整），用户无感知。
    res.status(500).json({ error: `Failed to delete panel: ${err instanceof Error ? err.message : String(err)}` })
  }
})

function parsePanelRow(row: any) {
  return {
    id: row.id,
    name: row.name,
    sortOrder: row.sort_order,
    settings: row.settings || {},
    canvasTransform: row.canvas_transform || null,
    ownerId: row.owner_id ?? null,
    isCommunity: typeof row.is_community === 'number' ? row.is_community !== 0 : !!row.is_community,
    communityApiUrl: row.community_api_url ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

// 展示面板 demo 路由专用：确保 state 字段为对象（兼容 PG JSONB / SQLite TEXT 两种返回）
function parseWidgetRow(row: any) {
  let state = row.state
  if (typeof state === 'string') {
    try {
      state = JSON.parse(state)
    } catch {
      state = {}
    }
  }
  if (!state || typeof state !== 'object') state = {}
  return {
    id: row.id,
    panelId: row.panel_id,
    type: row.type,
    x: row.x,
    y: row.y,
    width: row.width,
    height: row.height,
    zIndex: row.z_index,
    state,
  }
}
