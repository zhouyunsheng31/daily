// ============================================================================
// Phase 4 迁移脚本：add-users.ts
// ============================================================================
// 功能：
// 1. 确保 users 表存在（schema.ts 已通过 CREATE IF NOT EXISTS 处理，此处为独立保险）
// 2. 确保 panels.owner_id / panels.is_community / widgets.is_global 列存在
// 3. 如果 users 表为空且环境变量 WEB_ACCESS_PASSWORD 配置，
//    创建一个默认 admin 用户（username=admin, email=admin@local），
//    并将所有 owner_id IS NULL 的现有面板关联到该 admin 用户
// 4. Phase 4.2：读取 ADMIN_USERNAMES 环境变量，为名单中的用户名预创建 admin 账号
// 5. 幂等：重复执行不会破坏数据
// ============================================================================

import { getPool, initDb, closeDb } from '../connection.js'
import { initializeSchema } from '../schema.js'
import { hashPassword } from '../../utils/crypto.js'

/**
 * Phase 4.2：解析 ADMIN_USERNAMES 环境变量
 * 返回小写去重的用户名列表
 */
function parseAdminUsernames(): string[] {
  const raw = process.env.ADMIN_USERNAMES
  if (!raw) return []
  return raw
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length > 0)
}

async function migrate(): Promise<void> {
  console.log('[Migration: add-users] starting...')

  await initDb()
  await initializeSchema()

  const pool = getPool()

  // 1. 检查 users 表是否为空
  const countResult = await pool.query('SELECT COUNT(*)::int as cnt FROM users')
  const userCount = countResult.rows[0]?.cnt ?? 0
  console.log(`[Migration: add-users] current user count: ${userCount}`)

  if (userCount === 0) {
    const webPwd = process.env.WEB_ACCESS_PASSWORD
    if (webPwd) {
      // 创建默认 admin 用户
      const userId = crypto.randomUUID()
      const passwordHash = hashPassword(webPwd)
      const now = Date.now()
      await pool.query(
        `INSERT INTO users (id, username, email, password_hash, role, is_banned, created_at, last_login_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $7)`,
        [userId, 'admin', 'admin@local', passwordHash, 'admin', false, now]
      )
      console.log(`[Migration: add-users] created default admin user: ${userId}`)

      // 将所有 owner_id IS NULL 的现有面板关联到该 admin
      const panelResult = await pool.query(
        'UPDATE panels SET owner_id = $1 WHERE owner_id IS NULL',
        [userId]
      )
      console.log(`[Migration: add-users] associated ${panelResult.rowCount} panels to admin`)
    } else {
      console.log('[Migration: add-users] WEB_ACCESS_PASSWORD not set, skipping default admin creation')
      console.log('[Migration: add-users] 第一个注册的用户将自动成为 admin')
    }
  } else {
    console.log('[Migration: add-users] users table not empty, skipping default admin creation')
  }

  // 2. Phase 4.2：为 ADMIN_USERNAMES 名单中的用户名预创建 admin 账号
  // 幂等：仅创建不存在的；已存在的跳过（不修改其密码/角色）
  const adminNames = parseAdminUsernames()
  if (adminNames.length > 0) {
    const webPwd = process.env.WEB_ACCESS_PASSWORD
    if (!webPwd) {
      console.log('[Migration: add-users] ADMIN_USERNAMES set but WEB_ACCESS_PASSWORD missing, skipping pre-create')
    } else {
      const passwordHash = hashPassword(webPwd)
      const now = Date.now()
      for (const name of adminNames) {
        // 'admin' 已在上方创建，跳过避免重复
        if (userCount === 0 && name === 'admin') continue
        const existing = await pool.query('SELECT id FROM users WHERE LOWER(username) = $1', [name])
        if (existing.rows.length > 0) {
          console.log(`[Migration: add-users] admin username '${name}' already exists, skipping`)
          continue
        }
        const userId = crypto.randomUUID()
        const email = `${name}@local`
        await pool.query(
          `INSERT INTO users (id, username, email, password_hash, role, is_banned, created_at, last_login_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $7)`,
          [userId, name, email, passwordHash, 'admin', false, now]
        )
        console.log(`[Migration: add-users] pre-created admin account for '${name}': ${userId}`)
      }
    }
  }

  // 3. 统计无 owner 的面板（社区面板不需要 owner）
  // 注意：is_community = 0 使用 SQLite 兼容写法（SQLite 驱动会自动剥离 ::int）
  const orphanResult = await pool.query(
    'SELECT COUNT(*)::int as cnt FROM panels WHERE owner_id IS NULL AND is_community = 0'
  )
  const orphanCount = orphanResult.rows[0]?.cnt ?? 0
  if (orphanCount > 0) {
    console.log(`[Migration: add-users] WARNING: ${orphanCount} personal panels have no owner (will be visible to all users in single-password mode)`)
  }

  console.log('[Migration: add-users] done')
}

// 直接执行时运行迁移
const __isMainEntry = (() => {
  try {
    return process.argv[1] === new URL(import.meta.url).pathname ||
      process.argv[1] === import.meta.url.replace('file://', '')
  } catch {
    return false
  }
})()

if (__isMainEntry) {
  migrate()
    .then(async () => {
      await closeDb().catch(() => {})
      process.exit(0)
    })
    .catch(async (err) => {
      console.error('[Migration: add-users] FAILED:', err)
      await closeDb().catch(() => {})
      process.exit(1)
    })
}

export { migrate }
