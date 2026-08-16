import { Router } from 'express'
import { getPool } from '../db/connection.js'
import { broadcastChange } from '../ws.js'
import { sanitizeShortText } from '../utils/sanitize.js'
import { createError } from '../middleware/error.js'
import { requireAdmin } from '../middleware/auth.js'

export const dynamicWidgetsRouter = Router()

// 【安全修复 2026-08-16（C2）】：动态组件 code 会被所有客户端以 new Function 执行，
// 任意用户可上传=存储型 RCE/XSS。写操作（POST/PUT/DELETE）全部 requireAdmin。
// GET 保留（展示已发布组件）。

// GET /api/dynamic-widgets
// 支持 ?desktop=false 过滤（T11 移动端过滤）
dynamicWidgetsRouter.get('/', async (req, res, next) => {
  try {
    const pool = getPool()
    const desktopFilter = req.query.desktop
    let query = 'SELECT * FROM dynamic_widgets ORDER BY created_at'
    if (desktopFilter === 'false') {
      query = 'SELECT * FROM dynamic_widgets WHERE desktop_only = FALSE ORDER BY created_at'
    }
    const result = await pool.query(query)
    res.json(result.rows.map((r: any) => ({
      widgetType: r.widget_type,
      displayName: r.display_name,
      icon: r.icon,
      defaultLayout: r.default_layout || {},
      defaultState: r.default_state || {},
      code: r.code,
      componentEnv: r.component_env,
      localServices: r.local_services,
      crossPlatform: r.cross_platform,
      desktopOnly: r.desktop_only,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    })))
  } catch (e) { next(e) }
})

// POST /api/dynamic-widgets
dynamicWidgetsRouter.post('/', requireAdmin, async (req, res, next) => {
  try {
    const pool = getPool()
    const now = Date.now()

    // 修复 4：widgetType 格式校验（[a-zA-Z0-9_-]+，长度 ≤ 64）
    const widgetTypeRaw = req.body.widgetType
    if (typeof widgetTypeRaw !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(widgetTypeRaw) || widgetTypeRaw.length > 64) {
      return next(createError(400, 'INVALID_WIDGET_TYPE', 'widgetType must match /^[a-zA-Z0-9_-]+$/ and be ≤ 64 chars'))
    }
    const widgetType = widgetTypeRaw

    // 修复 3：componentEnv 枚举校验
    const componentEnvRaw = req.body.componentEnv || 'pure-frontend'
    if (componentEnvRaw !== 'pure-frontend' && componentEnvRaw !== 'local-dependent') {
      return next(createError(400, 'INVALID_COMPONENT_ENV', "componentEnv must be 'pure-frontend' or 'local-dependent'"))
    }
    const componentEnv = componentEnvRaw

    // 修复 5：local_services 结构校验（string[] 或 null，元素 ≤ 128 字符，数组 ≤ 32）
    const localServicesRaw = req.body.localServices ?? null
    if (localServicesRaw !== null) {
      if (!Array.isArray(localServicesRaw) || localServicesRaw.length > 32) {
        return next(createError(400, 'INVALID_LOCAL_SERVICES', 'localServices must be string[] or null with ≤ 32 items'))
      }
      for (const item of localServicesRaw) {
        if (typeof item !== 'string' || item.length > 128) {
          return next(createError(400, 'INVALID_LOCAL_SERVICES', 'each localServices item must be a string ≤ 128 chars'))
        }
      }
    }
    const localServices = localServicesRaw

    // 修复 Bug 1：crossPlatform/desktopOnly 类型校验
    const crossPlatformRaw = req.body.crossPlatform ?? true
    if (typeof crossPlatformRaw !== 'boolean') {
      return next(createError(400, 'INVALID_INPUT', 'crossPlatform must be boolean'))
    }
    const crossPlatform = crossPlatformRaw
    const desktopOnlyRaw = req.body.desktopOnly ?? false
    if (typeof desktopOnlyRaw !== 'boolean') {
      return next(createError(400, 'INVALID_INPUT', 'desktopOnly must be boolean'))
    }
    const desktopOnly = desktopOnlyRaw

    // 修复 Bug 3：defaultLayout/defaultState 长度限制（≤ 64KB JSON）
    const defaultLayoutStr = JSON.stringify(req.body.defaultLayout || {})
    if (defaultLayoutStr.length > 64 * 1024) {
      return next(createError(400, 'INVALID_INPUT', 'defaultLayout must be ≤ 64KB JSON'))
    }
    const defaultStateStr = JSON.stringify(req.body.defaultState || {})
    if (defaultStateStr.length > 64 * 1024) {
      return next(createError(400, 'INVALID_INPUT', 'defaultState must be ≤ 64KB JSON'))
    }

    // 修复 2：sanitization（displayName/icon 用 sanitizeShortText；code 仅长度限制，不能 sanitize 以免破坏代码）
    let displayName: string
    try { displayName = sanitizeShortText(req.body.displayName || '新组件', 128) }
    catch (e) { return next(createError(400, 'INVALID_INPUT', `displayName: ${e instanceof Error ? e.message : String(e)}`)) }

    let icon: string
    try { icon = sanitizeShortText(req.body.icon || 'box', 64) }
    catch (e) { return next(createError(400, 'INVALID_INPUT', `icon: ${e instanceof Error ? e.message : String(e)}`)) }

    const codeRaw = req.body.code || ''
    if (typeof codeRaw !== 'string' || codeRaw.length > 1024 * 1024) {
      return next(createError(400, 'INVALID_INPUT', 'code must be a string ≤ 1MB'))
    }
    const code = codeRaw

    await pool.query(
      `INSERT INTO dynamic_widgets (widget_type, display_name, icon, default_layout, default_state, code,
        component_env, local_services, cross_platform, desktop_only, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [
        widgetType,
        displayName,
        icon,
        defaultLayoutStr,
        defaultStateStr,
        code,
        componentEnv,
        localServices ? JSON.stringify(localServices) : null,
        crossPlatform,
        desktopOnly,
        now, now
      ]
    )

    // Phase 14.4.5：同步 upsert 到 component_capabilities
    // 创建 dynamic_widget 时同步创建基础能力声明，使该组件可被 query_capabilities 查到。
    // api/description 留空（待组件运行时主动声明覆盖）；
    // dependencies 从 local_services 复制；其余基础字段从 dynamic_widgets 镜像。
    // 失败不阻塞：仅记日志，不回滚 dynamic_widgets 的 INSERT。
    try {
      const depArr = Array.isArray(localServices) ? localServices : []
      await pool.query(
        `INSERT INTO component_capabilities
          (widget_type, display_name, description, api, dependencies, version,
           component_env, cross_platform, desktop_only, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         ON CONFLICT (widget_type) DO UPDATE SET
           display_name = EXCLUDED.display_name,
           dependencies = EXCLUDED.dependencies,
           component_env = EXCLUDED.component_env,
           cross_platform = EXCLUDED.cross_platform,
           desktop_only = EXCLUDED.desktop_only,
           updated_at = EXCLUDED.updated_at`,
        [
          widgetType,   // widget_type
          widgetType,   // display_name（暂用 type，待组件主动声明覆盖）
          '',                    // description（待组件主动声明）
          '[]',                  // api（空数组，待组件主动声明）
          depArr,                // dependencies（从 local_services 复制）
          '1.0.0',               // version
          componentEnv,          // component_env
          crossPlatform,         // cross_platform
          desktopOnly,           // desktop_only
          now,                   // created_at
          now,                   // updated_at
        ],
      )
    } catch (syncErr) {
      console.warn(
        `[dynamic-widgets] Phase 14.4.5: sync upsert to component_capabilities failed for ${req.body.widgetType}:`,
        syncErr,
      )
    }

    const result = await pool.query('SELECT * FROM dynamic_widgets WHERE widget_type = $1', [widgetType])
    const row = result.rows[0] as any
    const widget = {
      widgetType: row.widget_type,
      displayName: row.display_name,
      icon: row.icon,
      defaultLayout: row.default_layout || {},
      defaultState: row.default_state || {},
      code: row.code,
      componentEnv: row.component_env,
      localServices: row.local_services,
      crossPlatform: row.cross_platform,
      desktopOnly: row.desktop_only,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }
    broadcastChange({ kind: 'dynamic_widget_created', data: widget }, req.deviceId)
    res.status(201).json(widget)
  } catch (e) { next(e) }
})

// PUT /api/dynamic-widgets/:widgetType - 更新元数据
dynamicWidgetsRouter.put('/:widgetType', requireAdmin, async (req, res, next) => {
  try {
    // 修复 Bug 2：widgetType URL 参数格式校验
    if (typeof req.params.widgetType !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(req.params.widgetType) || req.params.widgetType.length > 64) {
      return next(createError(400, 'INVALID_WIDGET_TYPE', 'widgetType must match /^[a-zA-Z0-9_-]+$/ and be ≤ 64 chars'))
    }

    const pool = getPool()
    const existing = await pool.query('SELECT * FROM dynamic_widgets WHERE widget_type = $1', [req.params.widgetType])
    // 修复 Bug 4：错误响应格式统一为 createError
    if (existing.rows.length === 0) return next(createError(404, 'NOT_FOUND', 'dynamic widget not found'))

    const now = Date.now()
    const updates: string[] = []
    const values: unknown[] = []
    let paramIdx = 1
    const body = req.body as {
      componentEnv?: string
      localServices?: string[] | null
      crossPlatform?: boolean
      desktopOnly?: boolean
      displayName?: string
      code?: string
      defaultLayout?: unknown
      defaultState?: unknown
    }

    // 修复 3：componentEnv 枚举校验
    if (body.componentEnv !== undefined && body.componentEnv !== 'pure-frontend' && body.componentEnv !== 'local-dependent') {
      return next(createError(400, 'INVALID_COMPONENT_ENV', "componentEnv must be 'pure-frontend' or 'local-dependent'"))
    }

    // 修复 5：local_services 结构校验（string[] 或 null，元素 ≤ 128 字符，数组 ≤ 32）
    if (body.localServices !== undefined && body.localServices !== null) {
      if (!Array.isArray(body.localServices) || body.localServices.length > 32) {
        return next(createError(400, 'INVALID_LOCAL_SERVICES', 'localServices must be string[] or null with ≤ 32 items'))
      }
      for (const item of body.localServices) {
        if (typeof item !== 'string' || item.length > 128) {
          return next(createError(400, 'INVALID_LOCAL_SERVICES', 'each localServices item must be a string ≤ 128 chars'))
        }
      }
    }

    // 修复 Bug 1：crossPlatform/desktopOnly 类型校验
    if (body.crossPlatform !== undefined && typeof body.crossPlatform !== 'boolean') {
      return next(createError(400, 'INVALID_INPUT', 'crossPlatform must be boolean'))
    }
    if (body.desktopOnly !== undefined && typeof body.desktopOnly !== 'boolean') {
      return next(createError(400, 'INVALID_INPUT', 'desktopOnly must be boolean'))
    }

    // 修复 Bug 3：defaultLayout/defaultState 长度限制（≤ 64KB JSON）
    let defaultLayoutStr: string | undefined
    if (body.defaultLayout !== undefined) {
      defaultLayoutStr = JSON.stringify(body.defaultLayout || {})
      if (defaultLayoutStr.length > 64 * 1024) {
        return next(createError(400, 'INVALID_INPUT', 'defaultLayout must be ≤ 64KB JSON'))
      }
    }
    let defaultStateStr: string | undefined
    if (body.defaultState !== undefined) {
      defaultStateStr = JSON.stringify(body.defaultState || {})
      if (defaultStateStr.length > 64 * 1024) {
        return next(createError(400, 'INVALID_INPUT', 'defaultState must be ≤ 64KB JSON'))
      }
    }

    // 修复 2：sanitization（displayName 用 sanitizeShortText；code 仅长度限制，不能 sanitize 以免破坏代码）
    let sanitizedDisplayName: string | undefined
    if (body.displayName !== undefined) {
      try { sanitizedDisplayName = sanitizeShortText(body.displayName, 128) }
      catch (e) { return next(createError(400, 'INVALID_INPUT', `displayName: ${e instanceof Error ? e.message : String(e)}`)) }
    }
    let sanitizedCode: string | undefined
    if (body.code !== undefined) {
      if (typeof body.code !== 'string' || body.code.length > 1024 * 1024) {
        return next(createError(400, 'INVALID_INPUT', 'code must be a string ≤ 1MB'))
      }
      sanitizedCode = body.code
    }

    if (body.componentEnv !== undefined) { updates.push(`component_env = $${paramIdx++}`); values.push(body.componentEnv) }
    if (body.localServices !== undefined) {
      updates.push(`local_services = $${paramIdx++}`)
      values.push(body.localServices ? JSON.stringify(body.localServices) : null)
    }
    if (body.crossPlatform !== undefined) { updates.push(`cross_platform = $${paramIdx++}`); values.push(body.crossPlatform) }
    if (body.desktopOnly !== undefined) { updates.push(`desktop_only = $${paramIdx++}`); values.push(body.desktopOnly) }
    if (sanitizedDisplayName !== undefined) { updates.push(`display_name = $${paramIdx++}`); values.push(sanitizedDisplayName) }
    if (sanitizedCode !== undefined) { updates.push(`code = $${paramIdx++}`); values.push(sanitizedCode) }
    if (defaultLayoutStr !== undefined) { updates.push(`default_layout = $${paramIdx++}`); values.push(defaultLayoutStr) }
    if (defaultStateStr !== undefined) { updates.push(`default_state = $${paramIdx++}`); values.push(defaultStateStr) }

    if (updates.length > 0) {
      updates.push(`updated_at = $${paramIdx++}`)
      values.push(now)
      values.push(req.params.widgetType)
      await pool.query(`UPDATE dynamic_widgets SET ${updates.join(', ')} WHERE widget_type = $${paramIdx}`, values)
    }

    // Phase 14.4.5：同步 update 到 component_capabilities
    // 更新 dynamic_widget 时，若 component_capabilities 中已存在该 widget_type 记录，
    // 同步更新被修改的相关字段；若不存在则跳过（等组件运行时主动声明，不在此创建）。
    // 失败不阻塞：仅记日志，不影响 dynamic_widgets 的 UPDATE 结果。
    try {
      const capExisting = await pool.query(
        'SELECT 1 FROM component_capabilities WHERE widget_type = $1',
        [req.params.widgetType],
      )
      if (capExisting.rows.length > 0) {
        const capUpdates: string[] = []
        const capValues: unknown[] = []
        let capIdx = 1
        if (body.componentEnv !== undefined) {
          capUpdates.push(`component_env = $${capIdx++}`)
          capValues.push(body.componentEnv)
        }
        if (body.localServices !== undefined) {
          capUpdates.push(`dependencies = $${capIdx++}`)
          // dependencies 为 NOT NULL text[]，null 时填空数组
          capValues.push(Array.isArray(body.localServices) ? body.localServices : [])
        }
        if (body.crossPlatform !== undefined) {
          capUpdates.push(`cross_platform = $${capIdx++}`)
          capValues.push(body.crossPlatform)
        }
        if (body.desktopOnly !== undefined) {
          capUpdates.push(`desktop_only = $${capIdx++}`)
          capValues.push(body.desktopOnly)
        }
        if (sanitizedDisplayName !== undefined) {
          capUpdates.push(`display_name = $${capIdx++}`)
          capValues.push(sanitizedDisplayName)
        }
        if (capUpdates.length > 0) {
          capUpdates.push(`updated_at = $${capIdx++}`)
          capValues.push(now)
          capValues.push(req.params.widgetType)
          await pool.query(
            `UPDATE component_capabilities SET ${capUpdates.join(', ')} WHERE widget_type = $${capIdx}`,
            capValues,
          )
        }
      }
    } catch (syncErr) {
      console.warn(
        `[dynamic-widgets] Phase 14.4.5: sync update to component_capabilities failed for ${req.params.widgetType}:`,
        syncErr,
      )
    }

    const result = await pool.query('SELECT * FROM dynamic_widgets WHERE widget_type = $1', [req.params.widgetType])
    const row = result.rows[0] as any
    const widget = {
      widgetType: row.widget_type,
      displayName: row.display_name,
      icon: row.icon,
      defaultLayout: row.default_layout || {},
      defaultState: row.default_state || {},
      code: row.code,
      componentEnv: row.component_env,
      localServices: row.local_services,
      crossPlatform: row.cross_platform,
      desktopOnly: row.desktop_only,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }
    res.json(widget)
    broadcastChange({ kind: 'dynamic_widget_updated', data: widget }, req.deviceId)
  } catch (e) { next(e) }
})

// DELETE /api/dynamic-widgets/:widgetType
dynamicWidgetsRouter.delete('/:widgetType', requireAdmin, async (req, res, next) => {
  try {
    // 修复 Bug 2：widgetType URL 参数格式校验
    if (typeof req.params.widgetType !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(req.params.widgetType) || req.params.widgetType.length > 64) {
      return next(createError(400, 'INVALID_WIDGET_TYPE', 'widgetType must match /^[a-zA-Z0-9_-]+$/ and be ≤ 64 chars'))
    }

    const pool = getPool()
    const result = await pool.query('DELETE FROM dynamic_widgets WHERE widget_type = $1', [req.params.widgetType])
    // 修复 Bug 4：错误响应格式统一为 createError
    if (result.rowCount === 0) return next(createError(404, 'NOT_FOUND', 'dynamic widget not found'))

    // 修复 1：同步删除 component_capabilities 中对应记录（与 POST/PUT 同步机制对称）
    // 失败不阻塞，仅 console.warn
    try {
      await pool.query('DELETE FROM component_capabilities WHERE widget_type = $1', [req.params.widgetType])
    } catch (syncErr) {
      console.warn(
        `[dynamic-widgets] sync delete from component_capabilities failed for ${req.params.widgetType}:`,
        syncErr,
      )
    }

    broadcastChange({ kind: 'dynamic_widget_deleted', data: { widgetType: req.params.widgetType } }, req.deviceId)
    res.json({ ok: true })
  } catch (e) { next(e) }
})
