import { getPool } from './connection.js'

// ============================================================================
// Phase S9：外部 API 调用日志（spec 8.4 节）
// 记录搜索引擎等外部 API 的调用情况，用于监控和限流
// ============================================================================

export interface ApiUsageLogEntry {
  provider: string
  endpoint: string
  count?: number
  latencyMs?: number
  status: 'ok' | 'error'
  errorMsg?: string
  creditsConsumed?: number  // 秘塔 credits 字段（spec 2.7.5 节，其他 provider 不传）
}

/** 记录一次外部 API 调用 */
export async function logApiUsage(entry: ApiUsageLogEntry): Promise<void> {
  try {
    const pool = getPool()
    const now = Date.now()
    await pool.query(
      `INSERT INTO api_usage_log (provider, endpoint, count, latency_ms, status, error_msg, credits_consumed, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [entry.provider, entry.endpoint, entry.count ?? 1, entry.latencyMs ?? null, entry.status, entry.errorMsg ?? null, entry.creditsConsumed ?? null, now]
    )
  } catch (err) {
    // 日志记录失败不影响主流程
    console.warn('[ApiUsageLog] Failed to log API usage:', err instanceof Error ? err.message : String(err))
  }
}

/** 查询指定 provider 在最近时间窗口内的调用统计 */
export async function getApiUsageStats(provider: string, windowMs: number = 3600_000): Promise<{ count: number; errorCount: number; lastCallAt: number | null }> {
  const pool = getPool()
  const since = Date.now() - windowMs
  const result = await pool.query(
    `SELECT COUNT(*) as total, COUNT(CASE WHEN status = 'error' THEN 1 END) as errors, MAX(created_at) as last_call
     FROM api_usage_log WHERE provider = $1 AND created_at >= $2`,
    [provider, since]
  )
  const row = result.rows[0]
  return {
    count: parseInt(row.total, 10) || 0,
    errorCount: parseInt(row.errors, 10) || 0,
    lastCallAt: row.last_call ? parseInt(row.last_call, 10) : null,
  }
}
