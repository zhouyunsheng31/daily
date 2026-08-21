import { getPool } from './connection.js'

/**
 * 2026-08-02 账号系统：旧库 users 表补充 registered_ip / last_login_ip 列（幂等）。
 * - PG：schema.ts 的 DO $$ 块已处理，这里双保险（information_schema 检查）
 * - SQLite：PRAGMA table_info 检查后 ALTER TABLE ADD COLUMN（旧库无 IF NOT EXISTS 语法依赖）
 * 在 index.ts 的 initializeSchema() 之后调用。
 */
export async function ensureUserIpColumns(): Promise<void> {
  const isSqlite = process.env.DB_DRIVER === 'sqlite' || process.env.USE_SQLITE === 'true'
  const pool = getPool()
  try {
    let existing: string[] = []
    if (isSqlite) {
      const result = await pool.query('PRAGMA table_info(users)')
      existing = result.rows.map((row) => String((row as { name?: unknown }).name ?? ''))
    } else {
      const result = await pool.query(
        "SELECT column_name FROM information_schema.columns WHERE table_name = 'users'",
      )
      existing = result.rows.map((row) => String((row as { column_name?: unknown }).column_name ?? ''))
    }
    if (!existing.includes('registered_ip')) {
      await pool.query('ALTER TABLE users ADD COLUMN registered_ip TEXT')
      console.log('[db] users.registered_ip added')
    }
    if (!existing.includes('last_login_ip')) {
      await pool.query('ALTER TABLE users ADD COLUMN last_login_ip TEXT')
      console.log('[db] users.last_login_ip added')
    }
  } catch (error) {
    // 迁移失败不阻断启动（查询/写入时按列缺失降级）
    console.warn('[db] ensureUserIpColumns failed:', error instanceof Error ? error.message : String(error))
  }
}

/**
 * 2026-08-02 用户称呼：users 表补充 display_name 列（幂等）。
 * display_name 是用户自定义的展示名（AI 对话页/个人主页显示），
 * 未设置时回退 username（注册时=邮箱前缀）。在 ensureUserIpColumns 之后调用。
 */
export async function ensureDisplayNameColumn(): Promise<void> {
  const isSqlite = process.env.DB_DRIVER === 'sqlite' || process.env.USE_SQLITE === 'true'
  const pool = getPool()
  try {
    let existing: string[] = []
    if (isSqlite) {
      const result = await pool.query('PRAGMA table_info(users)')
      existing = result.rows.map((row) => String((row as { name?: unknown }).name ?? ''))
    } else {
      const result = await pool.query(
        "SELECT column_name FROM information_schema.columns WHERE table_name = 'users'",
      )
      existing = result.rows.map((row) => String((row as { column_name?: unknown }).column_name ?? ''))
    }
    if (!existing.includes('display_name')) {
      await pool.query('ALTER TABLE users ADD COLUMN display_name TEXT')
      console.log('[db] users.display_name added')
    }
  } catch (error) {
    console.warn('[db] ensureDisplayNameColumn failed:', error instanceof Error ? error.message : String(error))
  }
}

/**
 * 2026-08-08 视频生成：webos_video_usage 表补充 error_message 列（幂等）。
 * 失败详情此前只返回给 AI、不落库，排查渠道报错只能靠猜；
 * 补列后 TASK_CREATE_FAILED 等错误的具体 message 可直接在后台/库里看到。
 * SQLite：PRAGMA table_info 检查后 ALTER TABLE ADD COLUMN（旧库无 IF NOT EXISTS 语法依赖）。
 * 在 initializeSchema() 之后调用。
 */
export async function ensureVideoUsageErrorMessageColumn(): Promise<void> {
  const isSqlite = process.env.DB_DRIVER === 'sqlite' || process.env.USE_SQLITE === 'true'
  const pool = getPool()
  try {
    let existing: string[] = []
    if (isSqlite) {
      const result = await pool.query('PRAGMA table_info(webos_video_usage)')
      existing = result.rows.map((row) => String((row as { name?: unknown }).name ?? ''))
    } else {
      const result = await pool.query(
        "SELECT column_name FROM information_schema.columns WHERE table_name = 'webos_video_usage'",
      )
      existing = result.rows.map((row) => String((row as { column_name?: unknown }).column_name ?? ''))
    }
    if (!existing.includes('error_message')) {
      await pool.query('ALTER TABLE webos_video_usage ADD COLUMN error_message TEXT')
      console.log('[db] webos_video_usage.error_message added')
    }
  } catch (error) {
    console.warn('[db] ensureVideoUsageErrorMessageColumn failed:', error instanceof Error ? error.message : String(error))
  }
}

/**
 * 2026-08-12 应用商店：webos_store_apps 表补充 size_bytes 列（应用占内存标注，幂等）。
 * SQLite：PRAGMA table_info 检查后 ALTER TABLE ADD COLUMN（旧库无 IF NOT EXISTS 语法依赖）。
 * 在 initializeSchema() 之后调用。
 */
export async function ensureStoreSizeBytesColumn(): Promise<void> {
  const isSqlite = process.env.DB_DRIVER === 'sqlite' || process.env.USE_SQLITE === 'true'
  const pool = getPool()
  try {
    let existing: string[] = []
    if (isSqlite) {
      const result = await pool.query('PRAGMA table_info(webos_store_apps)')
      existing = result.rows.map((row) => String((row as { name?: unknown }).name ?? ''))
    } else {
      const result = await pool.query(
        "SELECT column_name FROM information_schema.columns WHERE table_name = 'webos_store_apps'",
      )
      existing = result.rows.map((row) => String((row as { column_name?: unknown }).column_name ?? ''))
    }
    if (!existing.includes('size_bytes')) {
      await pool.query('ALTER TABLE webos_store_apps ADD COLUMN size_bytes INTEGER NOT NULL DEFAULT 0')
      console.log('[db] webos_store_apps.size_bytes added')
    }
  } catch (error) {
    console.warn('[db] ensureStoreSizeBytesColumn failed:', error instanceof Error ? error.message : String(error))
  }
}

/**
 * 2026-08-12 爱发电兑换码：webos_afdian_orders 表补充 redeem_id 列（幂等）。
 * 兑换码商品订单的 redeem_id 非空；用户凭兑换码在个人中心主动兑换发货。
 */
export async function ensureAfdianRedeemColumn(): Promise<void> {
  const isSqlite = process.env.DB_DRIVER === 'sqlite' || process.env.USE_SQLITE === 'true'
  const pool = getPool()
  try {
    let existing: string[] = []
    if (isSqlite) {
      const result = await pool.query('PRAGMA table_info(webos_afdian_orders)')
      existing = result.rows.map((row) => String((row as { name?: unknown }).name ?? ''))
    } else {
      const result = await pool.query(
        "SELECT column_name FROM information_schema.columns WHERE table_name = 'webos_afdian_orders'",
      )
      existing = result.rows.map((row) => String((row as { column_name?: unknown }).column_name ?? ''))
    }
    if (!existing.includes('redeem_id')) {
      await pool.query('ALTER TABLE webos_afdian_orders ADD COLUMN redeem_id TEXT')
      console.log('[db] webos_afdian_orders.redeem_id added')
    }
    if (!existing.includes('match_mode')) {
      await pool.query('ALTER TABLE webos_afdian_orders ADD COLUMN match_mode TEXT')
      console.log('[db] webos_afdian_orders.match_mode added')
    }
    // 索引必须在列存在后创建（SCHEMA_SQL 里建会因旧库无该列导致启动崩溃）
    await pool.query('CREATE INDEX IF NOT EXISTS idx_afdian_orders_redeem ON webos_afdian_orders(redeem_id)')
  } catch (error) {
    console.warn('[db] ensureAfdianRedeemColumn failed:', error instanceof Error ? error.message : String(error))
  }
}

/**
 * 2026-08-12 爱发电本地兑换码表（旧库幂等建表；新库由 schema 自动建）。
 * 在 ensureAfdianRedeemColumn 之后调用。
 */
export async function ensureRedeemCodesTable(): Promise<void> {
  const pool = getPool()
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS webos_redeem_codes (
        code TEXT PRIMARY KEY,
        plan_id TEXT NOT NULL,
        plan_name TEXT,
        status TEXT NOT NULL DEFAULT 'unused',
        redeemed_by TEXT,
        redeemed_at BIGINT,
        note TEXT,
        created_at BIGINT NOT NULL,
        updated_at BIGINT NOT NULL
      )
    `)
    await pool.query('CREATE INDEX IF NOT EXISTS idx_redeem_codes_status ON webos_redeem_codes(status)')
    await pool.query('CREATE INDEX IF NOT EXISTS idx_redeem_codes_plan ON webos_redeem_codes(plan_id)')
    console.log('[db] webos_redeem_codes ensured')
  } catch (error) {
    console.warn('[db] ensureRedeemCodesTable failed:', error instanceof Error ? error.message : String(error))
  }
}

/**
 * 2026-08-06 服务器负载历史表（幂等建表；旧库手动补建，新库由 schema 自动建）。
 * 在 ensureDisplayNameColumn 之后调用。
 */
export async function ensureServerMetricsTable(): Promise<void> {
  const pool = getPool()
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS webos_server_metrics (
        id TEXT PRIMARY KEY,
        ts BIGINT NOT NULL,
        cpu_usage REAL NOT NULL DEFAULT 0,
        loadavg_1m REAL NOT NULL DEFAULT 0,
        loadavg_5m REAL NOT NULL DEFAULT 0,
        loadavg_15m REAL NOT NULL DEFAULT 0,
        mem_used_pct REAL NOT NULL DEFAULT 0,
        disk_used_pct REAL NOT NULL DEFAULT 0,
        rx_mbps REAL NOT NULL DEFAULT 0,
        tx_mbps REAL NOT NULL DEFAULT 0
      )
    `)
    await pool.query('CREATE INDEX IF NOT EXISTS idx_server_metrics_ts ON webos_server_metrics(ts)')
    console.log('[db] webos_server_metrics ensured')
  } catch (error) {
    console.warn('[db] ensureServerMetricsTable failed:', error instanceof Error ? error.message : String(error))
  }
}

/**
 * 2026-08-13 统一对话 log 表（幂等建表；旧库手动补建，新库由 schema 自动建）。
 * webos_chat_sessions：一次 chat/stream 请求 = 一行完整记录（含 reasoning 思考
 * 内容、工具调用、App 事件等完整事件序列 events JSON）。在 initializeSchema 后调用。
 */
export async function ensureChatSessionsTable(): Promise<void> {
  const pool = getPool()
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS webos_chat_sessions (
        id TEXT PRIMARY KEY,
        user_key TEXT NOT NULL,
        user_email TEXT,
        conversation_id TEXT NOT NULL DEFAULT 'default',
        request_id TEXT,
        thinking TEXT,
        rebuild INTEGER NOT NULL DEFAULT 0,
        model TEXT NOT NULL DEFAULT 'deepseek-v4-flash',
        status TEXT NOT NULL DEFAULT 'ok',
        error_code TEXT,
        prompt_tokens INTEGER NOT NULL DEFAULT 0,
        completion_tokens INTEGER NOT NULL DEFAULT 0,
        total_tokens INTEGER NOT NULL DEFAULT 0,
        cost_minor INTEGER NOT NULL DEFAULT 0,
        events TEXT NOT NULL DEFAULT '[]',
        ip TEXT,
        created_at BIGINT NOT NULL,
        ended_at BIGINT NOT NULL
      )
    `)
    await pool.query('CREATE INDEX IF NOT EXISTS idx_webos_chat_sessions_user ON webos_chat_sessions(user_key, created_at)')
    await pool.query('CREATE INDEX IF NOT EXISTS idx_webos_chat_sessions_conv ON webos_chat_sessions(user_key, conversation_id, created_at)')
    await pool.query('CREATE INDEX IF NOT EXISTS idx_webos_chat_sessions_created ON webos_chat_sessions(created_at)')
    console.log('[db] webos_chat_sessions ensured')
  } catch (error) {
    console.warn('[db] ensureChatSessionsTable failed:', error instanceof Error ? error.message : String(error))
  }
}

/**
 * 2026-08-14 MiniMax-M3 视觉桥接用量表（幂等建表；旧库手动补建，新库由 schema 自动建）。
 * webos_vision_usage：每次 M3 视觉调用一行（图片/视频 → 文字描述），记录真实
 * token 用量与按官方五折价折算的平台成本，管理后台实时查看。在 initializeSchema 后调用。
 */
export async function ensureVisionUsageTable(): Promise<void> {
  const pool = getPool()
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS webos_vision_usage (
        id TEXT PRIMARY KEY,
        user_key TEXT NOT NULL,
        user_email TEXT,
        request_id TEXT,
        conversation_id TEXT,
        trigger TEXT NOT NULL DEFAULT 'chat_bridge',
        kind TEXT NOT NULL DEFAULT 'image',
        media_count INTEGER NOT NULL DEFAULT 0,
        prompt TEXT,
        description TEXT,
        input_tokens INTEGER NOT NULL DEFAULT 0,
        output_tokens INTEGER NOT NULL DEFAULT 0,
        cached_tokens INTEGER NOT NULL DEFAULT 0,
        total_tokens INTEGER NOT NULL DEFAULT 0,
        cost_minor INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'ok',
        error_code TEXT,
        error_message TEXT,
        duration_ms INTEGER NOT NULL DEFAULT 0,
        ip TEXT,
        created_at BIGINT NOT NULL
      )
    `)
    await pool.query('CREATE INDEX IF NOT EXISTS idx_webos_vision_usage_user ON webos_vision_usage(user_key, created_at)')
    await pool.query('CREATE INDEX IF NOT EXISTS idx_webos_vision_usage_created ON webos_vision_usage(created_at)')
    await pool.query('CREATE INDEX IF NOT EXISTS idx_webos_vision_usage_status ON webos_vision_usage(status)')
    console.log('[db] webos_vision_usage ensured')
  } catch (error) {
    console.warn('[db] ensureVisionUsageTable failed:', error instanceof Error ? error.message : String(error))
  }
}

/**
 * 2026-08-21 视觉双 provider：webos_vision_usage 表补充 model 列（幂等）。
 * 记录实际执行模型（deepseek-v4-flash-vision-exp / MiniMax-M3），管理后台按模型
 * 拆分成本/用量。SQLite：PRAGMA table_info 检查后 ALTER TABLE ADD COLUMN。
 * 在 ensureVisionUsageTable 之后调用。
 */
export async function ensureVisionModelColumn(): Promise<void> {
  const isSqlite = process.env.DB_DRIVER === 'sqlite' || process.env.USE_SQLITE === 'true'
  const pool = getPool()
  try {
    let existing: string[] = []
    if (isSqlite) {
      const result = await pool.query('PRAGMA table_info(webos_vision_usage)')
      existing = result.rows.map((row) => String((row as { name?: unknown }).name ?? ''))
    } else {
      const result = await pool.query(
        "SELECT column_name FROM information_schema.columns WHERE table_name = 'webos_vision_usage'",
      )
      existing = result.rows.map((row) => String((row as { column_name?: unknown }).column_name ?? ''))
    }
    if (!existing.includes('model')) {
      await pool.query('ALTER TABLE webos_vision_usage ADD COLUMN model TEXT')
      console.log('[db] webos_vision_usage.model added')
    }
  } catch (error) {
    console.warn('[db] ensureVisionModelColumn failed:', error instanceof Error ? error.message : String(error))
  }
}