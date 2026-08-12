import { Router } from 'express'
import { v4 as uuidv4 } from 'uuid'
import { readdirSync, readFileSync, existsSync, statSync } from 'fs'
import { join, resolve } from 'path'
import { getPool } from '../db/connection.js'
import { createError } from '../middleware/error.js'
import {
  sanitizeSkillContent,
  sanitizeShortText,
  LENGTH_LIMITS,
} from '../utils/sanitize.js'

// ============================================================================
// Phase 4：Skills API（spec 3.4 节）
// - GET    /api/skills              → 列出所有 skills（内置 + 用户）
// - POST   /api/skills              → 创建用户 skill
// - PUT    /api/skills/:id          → 更新 skill（内容/启用状态）
// - DELETE /api/skills/:id          → 删除用户 skill（内置返回 403）
// - GET    /api/skills/:id/content  → 获取 skill 内容（SKILL.md 全文）
// ============================================================================

export const skillsRouter = Router()

/** Skill 信息类型 */
interface SkillInfo {
  id: string
  name: string
  description: string
  version: string
  source: 'builtin' | 'user'
  enabled: boolean
  canDelete: boolean
}

/** 内置 skills 目录（.pi/skills/） */
function getBuiltinSkillsDir(): string {
  return resolve(process.cwd(), '.pi', 'skills')
}

/**
 * 解析 SKILL.md frontmatter（YAML 头部）
 * 简化实现：解析 --- 之间的内容
 */
function parseSkillFrontmatter(content: string): {
  name: string
  description: string
  version: string
  body: string
} {
  const lines = content.split('\n')
  if (lines.length === 0 || lines[0].trim() !== '---') {
    return { name: '', description: '', version: '1.0.0', body: content }
  }

  // 找到结束的 ---
  let endIdx = -1
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === '---') {
      endIdx = i
      break
    }
  }

  if (endIdx === -1) {
    return { name: '', description: '', version: '1.0.0', body: content }
  }

  const frontmatterLines = lines.slice(1, endIdx)
  const body = lines.slice(endIdx + 1).join('\n')

  const frontmatter: Record<string, string> = {}
  for (const line of frontmatterLines) {
    const colonIdx = line.indexOf(':')
    if (colonIdx > 0) {
      const key = line.substring(0, colonIdx).trim()
      const value = line.substring(colonIdx + 1).trim()
      frontmatter[key] = value
    }
  }

  return {
    name: frontmatter.name || '',
    description: frontmatter.description || '',
    version: frontmatter.version || '1.0.0',
    body,
  }
}

/**
 * 扫描内置 skills 目录（.pi/skills/，spec 3.4 节）
 * 读取每个子目录的 SKILL.md frontmatter
 */
function scanBuiltinSkills(): Array<{ id: string; name: string; description: string; version: string; content: string }> {
  const skillsDir = getBuiltinSkillsDir()
  if (!existsSync(skillsDir)) {
    return []
  }

  const result: Array<{ id: string; name: string; description: string; version: string; content: string }> = []

  let entries: string[] = []
  try {
    entries = readdirSync(skillsDir)
  } catch (err) {
    console.warn('[Skills] Failed to read builtin skills dir:', err)
    return []
  }

  for (const entry of entries) {
    const skillPath = join(skillsDir, entry)
    try {
      const stat = statSync(skillPath)
      if (!stat.isDirectory()) continue

      const skillMdPath = join(skillPath, 'SKILL.md')
      if (!existsSync(skillMdPath)) continue

      const content = readFileSync(skillMdPath, 'utf-8')
      const parsed = parseSkillFrontmatter(content)

      result.push({
        id: `builtin:${entry}`,
        name: parsed.name || entry,
        description: parsed.description || '',
        version: parsed.version,
        content,
      })
    } catch (err) {
      console.warn(`[Skills] Failed to read skill ${entry}:`, err)
    }
  }

  return result
}

/**
 * 获取 skill_settings 表中 skill 的启用状态
 * 内置 skill 默认启用
 */
async function getSkillEnabledStates(): Promise<Map<string, boolean>> {
  try {
    const pool = getPool()
    const result = await pool.query('SELECT skill_id, enabled FROM skill_settings')
    const map = new Map<string, boolean>()
    for (const row of result.rows) {
      map.set(row.skill_id, row.enabled)
    }
    return map
  } catch (err) {
    console.warn('[Skills] getSkillEnabledStates failed:', err)
    return new Map()
  }
}

/**
 * 设置 skill 启用状态
 */
async function setSkillEnabled(skillId: string, enabled: boolean): Promise<void> {
  const pool = getPool()
  const now = Date.now()
  await pool.query(
    `INSERT INTO skill_settings (skill_id, enabled, updated_at) VALUES ($1, $2, $3)
     ON CONFLICT (skill_id) DO UPDATE SET enabled = $2, updated_at = $3`,
    [skillId, enabled, now],
  )
}

// ============================================================================
// 路由
// ============================================================================

/**
 * GET /api/skills
 * 列出所有 skills（内置 + 用户，spec 3.4 节）
 */
skillsRouter.get('/', async (_req, res, next) => {
  try {
    const enabledStates = await getSkillEnabledStates()
    const skills: SkillInfo[] = []

    // 1. 扫描内置 skills
    const builtinSkills = scanBuiltinSkills()
    for (const skill of builtinSkills) {
      skills.push({
        id: skill.id,
        name: skill.name,
        description: skill.description,
        version: skill.version,
        source: 'builtin',
        enabled: enabledStates.get(skill.id) ?? true, // 内置默认启用
        canDelete: false, // 内置不可删除
      })
    }

    // 2. 查询用户 skills
    const pool = getPool()
    const userSkillsResult = await pool.query(
      'SELECT id, name, description, enabled, created_at, updated_at FROM user_skills ORDER BY created_at ASC',
    )
    for (const row of userSkillsResult.rows) {
      skills.push({
        id: row.id,
        name: row.name,
        description: row.description || '',
        version: '1.0.0', // 用户 skills 暂无版本字段
        source: 'user',
        enabled: row.enabled,
        canDelete: true,
      })
    }

    res.json({ skills })
  } catch (e) { next(e) }
})

/**
 * POST /api/skills
 * 创建用户 skill（spec 3.4 节）
 */
skillsRouter.post('/', async (req, res, next) => {
  try {
    const pool = getPool()
    const { name, description, content, enabled } = req.body as {
      name: string
      description?: string
      content: string
      enabled?: boolean
    }

    if (!name || !content) {
      throw createError(400, 'INVALID_REQUEST', 'name and content are required')
    }

    if (enabled !== undefined && typeof enabled !== 'boolean') {
      throw createError(400, 'INVALID_REQUEST', 'enabled must be a boolean')
    }

    // Phase S4：输入净化（spec 9.5 节）
    let sanitizedName: string
    try { sanitizedName = sanitizeShortText(name, LENGTH_LIMITS.SKILL_NAME) }
    catch (e) { next(createError(400, 'INVALID_INPUT', `name: ${e instanceof Error ? e.message : String(e)}`)); return }

    let sanitizedDescription: string | null = null
    if (description !== undefined) {
      try { sanitizedDescription = sanitizeShortText(description, LENGTH_LIMITS.SKILL_DESCRIPTION) }
      catch (e) { next(createError(400, 'INVALID_INPUT', `description: ${e instanceof Error ? e.message : String(e)}`)); return }
    }

    let sanitizedContent: string
    try { sanitizedContent = sanitizeSkillContent(content) }
    catch (e) { next(createError(400, 'INVALID_INPUT', `content: ${e instanceof Error ? e.message : String(e)}`)); return }

    // 空名称校验（sanitizeShortText 会 trim，trim 后为空必须拒绝）
    if (!sanitizedName) {
      next(createError(400, 'INVALID_REQUEST', 'name cannot be empty after trim'))
      return
    }

    const id = `user:${uuidv4()}`
    const now = Date.now()
    await pool.query(
      `INSERT INTO user_skills (id, name, description, content, enabled, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $6)`,
      [id, sanitizedName, sanitizedDescription, sanitizedContent, enabled ?? true, now],
    )

    res.status(201).json({
      id,
      name: sanitizedName,
      description: sanitizedDescription || '',
      version: '1.0.0',
      source: 'user' as const,
      enabled: enabled ?? true,
      canDelete: true,
    })
  } catch (e) { next(e) }
})

/**
 * PUT /api/skills/:id
 * 更新 skill（内容/启用状态，spec 3.4 节）
 */
skillsRouter.put('/:id', async (req, res, next) => {
  try {
    const pool = getPool()
    const skillId = req.params.id
    const { name, description, content, enabled } = req.body as {
      name?: string
      description?: string
      content?: string
      enabled?: boolean
    }

    if (skillId.startsWith('builtin:')) {
      // 内置 skill：只能更新启用状态（不能改内容）
      if (enabled !== undefined) {
        if (typeof enabled !== 'boolean') {
          next(createError(400, 'INVALID_REQUEST', 'enabled must be a boolean')); return
        }
        await setSkillEnabled(skillId, enabled)
      }
      // 忽略 name/description/content（内置只读）
      res.json({ ok: true, message: 'builtin skill updated (enabled only)' })
      return
    }

    // 用户 skill：可更新所有字段
    const existing = await pool.query('SELECT * FROM user_skills WHERE id = $1', [skillId])
    if (existing.rows.length === 0) {
      throw createError(404, 'NOT_FOUND', `Skill ${skillId} not found`)
    }

    const updates: string[] = []
    const values: unknown[] = []
    let paramIdx = 1

    if (name !== undefined) {
      let sanitized: string
      try { sanitized = sanitizeShortText(name, LENGTH_LIMITS.SKILL_NAME) }
      catch (e) { next(createError(400, 'INVALID_INPUT', `name: ${e instanceof Error ? e.message : String(e)}`)); return }
      if (!sanitized) {
        next(createError(400, 'INVALID_REQUEST', 'name cannot be empty after trim'))
        return
      }
      updates.push(`name = $${paramIdx++}`); values.push(sanitized)
    }
    if (description !== undefined) {
      let sanitized: string
      try { sanitized = sanitizeShortText(description, LENGTH_LIMITS.SKILL_DESCRIPTION) }
      catch (e) { next(createError(400, 'INVALID_INPUT', `description: ${e instanceof Error ? e.message : String(e)}`)); return }
      updates.push(`description = $${paramIdx++}`); values.push(sanitized)
    }
    if (content !== undefined) {
      let sanitized: string
      try { sanitized = sanitizeSkillContent(content) }
      catch (e) { next(createError(400, 'INVALID_INPUT', `content: ${e instanceof Error ? e.message : String(e)}`)); return }
      updates.push(`content = $${paramIdx++}`); values.push(sanitized)
    }
    if (enabled !== undefined) {
      if (typeof enabled !== 'boolean') {
        next(createError(400, 'INVALID_REQUEST', 'enabled must be a boolean')); return
      }
      updates.push(`enabled = $${paramIdx++}`); values.push(enabled)
    }

    if (updates.length > 0) {
      updates.push(`updated_at = $${paramIdx++}`)
      values.push(Date.now())
      values.push(skillId)
      await pool.query(`UPDATE user_skills SET ${updates.join(', ')} WHERE id = $${paramIdx}`, values)
    }

    res.json({ ok: true })
  } catch (e) { next(e) }
})

/**
 * DELETE /api/skills/:id
 * 删除用户 skill（内置返回 403，spec 3.4 节）
 */
skillsRouter.delete('/:id', async (req, res, next) => {
  try {
    const pool = getPool()
    const skillId = req.params.id

    if (skillId.startsWith('builtin:')) {
      // 内置 skill 不可删除
      throw createError(403, 'FORBIDDEN', 'builtin skills cannot be deleted')
    }

    const result = await pool.query('DELETE FROM user_skills WHERE id = $1', [skillId])
    if (result.rowCount === 0) {
      throw createError(404, 'NOT_FOUND', `Skill ${skillId} not found`)
    }

    res.json({ ok: true })
  } catch (e) { next(e) }
})

/**
 * GET /api/skills/:id/content
 * 获取 skill 内容（SKILL.md 全文，spec 3.4 节）
 */
skillsRouter.get('/:id/content', async (req, res, next) => {
  try {
    const skillId = req.params.id

    if (skillId.startsWith('builtin:')) {
      // 内置 skill：从文件系统读取
      const skillName = skillId.substring('builtin:'.length)
      const skillMdPath = join(getBuiltinSkillsDir(), skillName, 'SKILL.md')
      if (!existsSync(skillMdPath)) {
        throw createError(404, 'NOT_FOUND', `Skill ${skillId} not found`)
      }
      const content = readFileSync(skillMdPath, 'utf-8')
      res.json({ id: skillId, content, source: 'builtin' })
      return
    }

    // 用户 skill：从数据库读取
    const pool = getPool()
    const result = await pool.query('SELECT content FROM user_skills WHERE id = $1', [skillId])
    if (result.rows.length === 0) {
      throw createError(404, 'NOT_FOUND', `Skill ${skillId} not found`)
    }
    res.json({ id: skillId, content: result.rows[0].content, source: 'user' })
  } catch (e) { next(e) }
})
