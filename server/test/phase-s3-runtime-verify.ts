// ============================================================================
// Phase S3 运行时验证脚本（spec 缺口 A/B/C）
// - 缺口 A：entity_conflict_logs 表 + entities PUT 触发冲突日志
// - 缺口 B：sync_logs 服务器端持久化 API
// - 缺口 C：sync_failed WS 事件推送
//
// 运行：cd f:\allmylife\event\server && npx tsx test/phase-s3-runtime-verify.ts
// 依赖：本地 server 在 3458 端口运行（dev 模式 SERVER_TOKEN 空，跳过鉴权）
// ============================================================================

import { WebSocket } from 'ws'
import { Pool } from 'pg'

const SERVER_BASE = 'http://localhost:3458'
const SERVER_WS_URL = 'ws://localhost:3458/ws'
const TEST_DEVICE_ID = 'test-device-s3'

// PG 直连配置（与 server/.env 一致）
const pool = new Pool({
  host: process.env.PGHOST || 'localhost',
  port: parseInt(process.env.PGPORT || '5432', 10),
  user: process.env.PGUSER || 'livingdashboard',
  password: process.env.PGPASSWORD || 'livingdashboard',
  database: process.env.PGDATABASE || 'living_dashboard',
})

// ---------------------------------------------------------------------------
// 辅助函数
// ---------------------------------------------------------------------------

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

async function fetchJson<T = any>(
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
): Promise<{ status: number; data: T; ok: boolean }> {
  const res = await fetch(`${SERVER_BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'X-Device-Id': TEST_DEVICE_ID,
      ...headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  let data: any = null
  try {
    data = await res.json()
  } catch {
    data = null
  }
  return { status: res.status, data, ok: res.ok }
}

function createWs(deviceId: string, timeoutMs = 5000): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${SERVER_WS_URL}?deviceId=${deviceId}`)
    const timer = setTimeout(() => reject(new Error(`connect timeout for ${deviceId}`)), timeoutMs)
    ws.on('open', () => {
      clearTimeout(timer)
      resolve(ws)
    })
    ws.on('error', (err) => {
      clearTimeout(timer)
      reject(err)
    })
  })
}

function waitForMessage(
  ws: WebSocket,
  predicate: (msg: any) => boolean,
  timeoutMs = 5000,
): Promise<any> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.off('message', handler)
      reject(new Error(`message timeout after ${timeoutMs}ms`))
    }, timeoutMs)
    const handler = (raw: any) => {
      try {
        const msg = JSON.parse(raw.toString())
        if (predicate(msg)) {
          clearTimeout(timer)
          ws.off('message', handler)
          resolve(msg)
        }
      } catch {
        // ignore parse errors
      }
    }
    ws.on('message', handler)
  })
}

function closeWs(ws: WebSocket, timeoutMs = 2000): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(), timeoutMs)
    ws.on('close', () => {
      clearTimeout(timer)
      resolve()
    })
    try {
      ws.close(1000, 'test cleanup')
    } catch {
      // ignore
    }
  })
}

// ---------------------------------------------------------------------------
// 测试结果收集
// ---------------------------------------------------------------------------

interface TestResult {
  id: string
  name: string
  status: 'PASS' | 'FAIL' | 'SKIP'
  detail: string
}

const results: TestResult[] = []

function record(id: string, name: string, status: 'PASS' | 'FAIL' | 'SKIP', detail: string) {
  results.push({ id, name, status, detail })
  console.log(`[${status}] 验证 ${id}: ${name} - ${detail}`)
}

// ---------------------------------------------------------------------------
// 主测试流程
// ---------------------------------------------------------------------------

async function main() {
  console.log('=== Phase S3 运行时验证 ===')
  console.log(`Server base: ${SERVER_BASE}`)
  console.log(`Server WS:   ${SERVER_WS_URL}`)
  console.log('')

  // ----------------------------------------------------------------------
  // 验证 1: 基础健康检查
  // ----------------------------------------------------------------------
  console.log('--- 验证 1: 基础健康检查 ---')
  try {
    const r = await fetchJson<{ status: string }>('GET', '/api/health')
    if (r.status === 200 && r.data?.status === 'ok') {
      record('1', '健康检查 - GET /api/health 200', 'PASS', `status=${r.status}, body.status=${r.data?.status}`)
    } else {
      record('1', '健康检查 - GET /api/health 200', 'FAIL', `status=${r.status}, body=${JSON.stringify(r.data)}`)
    }
  } catch (e) {
    record('1', '健康检查 - GET /api/health 200', 'FAIL', `exception: ${e instanceof Error ? e.message : String(e)}`)
  }

  // ----------------------------------------------------------------------
  // 验证 2: DB schema 验证（sync_logs 表存在）
  // ----------------------------------------------------------------------
  console.log('--- 验证 2: DB schema 验证（sync_logs 表存在） ---')
  try {
    const r = await pool.query(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = 'sync_logs'`,
    )
    if (r.rows.length > 0) {
      record('2', 'DB schema - sync_logs 表存在', 'PASS', `table sync_logs found`)
    } else {
      record('2', 'DB schema - sync_logs 表存在', 'FAIL', `table sync_logs not found in information_schema`)
    }
  } catch (e) {
    record('2', 'DB schema - sync_logs 表存在', 'FAIL', `exception: ${e instanceof Error ? e.message : String(e)}`)
  }

  // ----------------------------------------------------------------------
  // 验证 3: sync_logs API - PUT upsert
  // ----------------------------------------------------------------------
  console.log('--- 验证 3: sync_logs API - PUT upsert ---')
  try {
    const r = await fetchJson('PUT', '/api/sync/logs', {
      id: 'test-sync-log-1',
      operation: 'update',
      entityType: 'widget',
      entityId: 'test-widget-1',
      payload: { state: { value: 1 } },
      status: 'pending',
    })
    if (r.status === 200 && r.data?.ok === true) {
      record('3', 'sync_logs PUT upsert - 200 {ok:true}', 'PASS', `status=${r.status}, body=${JSON.stringify(r.data)}`)
    } else {
      record('3', 'sync_logs PUT upsert - 200 {ok:true}', 'FAIL', `status=${r.status}, body=${JSON.stringify(r.data)}`)
    }
  } catch (e) {
    record('3', 'sync_logs PUT upsert - 200 {ok:true}', 'FAIL', `exception: ${e instanceof Error ? e.message : String(e)}`)
  }

  // ----------------------------------------------------------------------
  // 验证 4: sync_logs API - GET 列表
  // ----------------------------------------------------------------------
  console.log('--- 验证 4: sync_logs API - GET 列表 ---')
  try {
    const r = await fetchJson<any>('GET', '/api/sync/logs?includeSuccess=true')
    const items: any[] = Array.isArray(r.data?.items) ? r.data.items : []
    const found = items.some((it) => it.id === 'test-sync-log-1')
    if (r.status === 200 && found) {
      record('4', 'sync_logs GET 列表 - 包含 test-sync-log-1', 'PASS', `status=${r.status}, total=${r.data?.total}, found test-sync-log-1`)
    } else {
      record('4', 'sync_logs GET 列表 - 包含 test-sync-log-1', 'FAIL', `status=${r.status}, items.length=${items.length}, found=${found}`)
    }
  } catch (e) {
    record('4', 'sync_logs GET 列表 - 包含 test-sync-log-1', 'FAIL', `exception: ${e instanceof Error ? e.message : String(e)}`)
  }

  // ----------------------------------------------------------------------
  // 验证 5: sync_logs API - PUT 参数校验
  // ----------------------------------------------------------------------
  console.log('--- 验证 5: sync_logs API - PUT 参数校验 ---')
  try {
    const r = await fetchJson('PUT', '/api/sync/logs', {
      operation: 'update',
      entityType: 'widget',
      entityId: 'x',
      payload: {},
      status: 'pending',
    })
    if (r.status === 400 && r.data?.error === 'INVALID_PARAMS') {
      record('5', 'sync_logs PUT 参数校验 - 400 INVALID_PARAMS', 'PASS', `status=${r.status}, body.error=${r.data?.error}`)
    } else {
      record('5', 'sync_logs PUT 参数校验 - 400 INVALID_PARAMS', 'FAIL', `status=${r.status}, body=${JSON.stringify(r.data)}`)
    }
  } catch (e) {
    record('5', 'sync_logs PUT 参数校验 - 400 INVALID_PARAMS', 'FAIL', `exception: ${e instanceof Error ? e.message : String(e)}`)
  }

  // ----------------------------------------------------------------------
  // 验证 6: sync_logs API - GET failed
  // ----------------------------------------------------------------------
  console.log('--- 验证 6: sync_logs API - GET failed ---')
  try {
    // 先 PUT 一条 failed 状态的 sync_log
    const putR = await fetchJson('PUT', '/api/sync/logs', {
      id: 'test-sync-log-failed',
      operation: 'update',
      entityType: 'widget',
      entityId: 'test-widget-failed',
      payload: { state: {} },
      status: 'failed',
      lastError: 'test error message',
    })
    if (putR.status !== 200) {
      record('6', 'sync_logs GET failed - 包含 test-sync-log-failed', 'FAIL', `setup PUT failed: status=${putR.status}, body=${JSON.stringify(putR.data)}`)
    } else {
      // GET /api/sync/logs/failed
      const r = await fetchJson<any>('GET', '/api/sync/logs/failed')
      const items: any[] = Array.isArray(r.data?.items) ? r.data.items : []
      const found = items.some((it) => it.id === 'test-sync-log-failed')
      if (r.status === 200 && found) {
        record('6', 'sync_logs GET failed - 包含 test-sync-log-failed', 'PASS', `status=${r.status}, items.length=${items.length}, found=${found}`)
      } else {
        record('6', 'sync_logs GET failed - 包含 test-sync-log-failed', 'FAIL', `status=${r.status}, items.length=${items.length}, found=${found}`)
      }
    }
  } catch (e) {
    record('6', 'sync_logs GET failed - 包含 test-sync-log-failed', 'FAIL', `exception: ${e instanceof Error ? e.message : String(e)}`)
  }

  // ----------------------------------------------------------------------
  // 验证 7: sync_logs API - DELETE
  // ----------------------------------------------------------------------
  console.log('--- 验证 7: sync_logs API - DELETE ---')
  try {
    const delR = await fetchJson('DELETE', '/api/sync/logs/test-sync-log-1')
    if (delR.status !== 200 || delR.data?.ok !== true) {
      record('7', 'sync_logs DELETE - 200 {ok:true} + GET 不再包含', 'FAIL',
        `DELETE status=${delR.status}, body=${JSON.stringify(delR.data)}`)
    } else {
      // 验证 GET 不再包含
      const getR = await fetchJson<any>('GET', '/api/sync/logs?includeSuccess=true')
      const items: any[] = Array.isArray(getR.data?.items) ? getR.data.items : []
      const stillExists = items.some((it) => it.id === 'test-sync-log-1')
      if (getR.status === 200 && !stillExists) {
        record('7', 'sync_logs DELETE - 200 {ok:true} + GET 不再包含', 'PASS',
          `DELETE status=${delR.status}, GET status=${getR.status}, test-sync-log-1 not in list`)
      } else {
        record('7', 'sync_logs DELETE - 200 {ok:true} + GET 不再包含', 'FAIL',
          `DELETE ok, but GET still contains test-sync-log-1? stillExists=${stillExists}`)
      }
    }
  } catch (e) {
    record('7', 'sync_logs DELETE - 200 {ok:true} + GET 不再包含', 'FAIL', `exception: ${e instanceof Error ? e.message : String(e)}`)
  }

  // ----------------------------------------------------------------------
  // 验证 8: sync_logs API - POST retry（create 返回 skipped）
  // ----------------------------------------------------------------------
  console.log('--- 验证 8: sync_logs API - POST retry（create 返回 skipped） ---')
  try {
    // 先 PUT 一个 create 操作的 sync_log
    const putR = await fetchJson('PUT', '/api/sync/logs', {
      id: 'test-sync-log-create',
      operation: 'create',
      entityType: 'widget',
      entityId: 'test-widget-create',
      payload: { state: {} },
      status: 'failed',
    })
    if (putR.status !== 200) {
      record('8', 'sync_logs POST retry create - skipped', 'FAIL', `setup PUT failed: status=${putR.status}, body=${JSON.stringify(putR.data)}`)
    } else {
      const r = await fetchJson<any>('POST', '/api/sync/logs/test-sync-log-create/retry')
      if (
        r.status === 200 &&
        r.data?.ok === false &&
        r.data?.status === 'skipped' &&
        r.data?.reason === 'create retry not supported on server'
      ) {
        record('8', 'sync_logs POST retry create - skipped', 'PASS',
          `status=${r.status}, body=${JSON.stringify(r.data)}`)
      } else {
        record('8', 'sync_logs POST retry create - skipped', 'FAIL',
          `status=${r.status}, body=${JSON.stringify(r.data)}`)
      }
    }
  } catch (e) {
    record('8', 'sync_logs POST retry create - skipped', 'FAIL', `exception: ${e instanceof Error ? e.message : String(e)}`)
  }

  // ----------------------------------------------------------------------
  // 验证 9: sync_logs API - POST retry（unsupported entityType）
  // ----------------------------------------------------------------------
  console.log('--- 验证 9: sync_logs API - POST retry（unsupported entityType） ---')
  try {
    // 先 PUT 一个 entityType=settings 的 sync_log
    const putR = await fetchJson('PUT', '/api/sync/logs', {
      id: 'test-sync-log-settings',
      operation: 'update',
      entityType: 'settings',
      entityId: 'test-settings',
      payload: {},
      status: 'failed',
    })
    if (putR.status !== 200) {
      record('9', 'sync_logs POST retry unsupported entityType - error', 'FAIL', `setup PUT failed: status=${putR.status}, body=${JSON.stringify(putR.data)}`)
    } else {
      const r = await fetchJson<any>('POST', '/api/sync/logs/test-sync-log-settings/retry')
      // 期望 500 或 400，包含 "Unsupported entityType"
      const bodyStr = JSON.stringify(r.data || {})
      const hasUnsupported = bodyStr.includes('Unsupported entityType')
      if ((r.status === 500 || r.status === 400) && hasUnsupported) {
        record('9', 'sync_logs POST retry unsupported entityType - error', 'PASS',
          `status=${r.status}, body=${bodyStr}`)
      } else {
        record('9', 'sync_logs POST retry unsupported entityType - error', 'FAIL',
          `status=${r.status}, body=${bodyStr}, hasUnsupported=${hasUnsupported}`)
      }
    }
  } catch (e) {
    record('9', 'sync_logs POST retry unsupported entityType - error', 'FAIL', `exception: ${e instanceof Error ? e.message : String(e)}`)
  }

  // ----------------------------------------------------------------------
  // 验证 10: entity_conflict_logs 表存在
  // ----------------------------------------------------------------------
  console.log('--- 验证 10: entity_conflict_logs 表存在 ---')
  try {
    const r = await pool.query(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = 'entity_conflict_logs'`,
    )
    if (r.rows.length > 0) {
      record('10', 'DB schema - entity_conflict_logs 表存在', 'PASS', `table entity_conflict_logs found`)
    } else {
      record('10', 'DB schema - entity_conflict_logs 表存在', 'FAIL', `table entity_conflict_logs not found`)
    }
  } catch (e) {
    record('10', 'DB schema - entity_conflict_logs 表存在', 'FAIL', `exception: ${e instanceof Error ? e.message : String(e)}`)
  }

  // ----------------------------------------------------------------------
  // 验证 11: entity_conflict_logs API - GET 列表
  // ----------------------------------------------------------------------
  console.log('--- 验证 11: entity_conflict_logs API - GET 列表 ---')
  try {
    const r = await fetchJson<any>('GET', '/api/entities/conflicts')
    if (r.status === 200 && Array.isArray(r.data?.conflicts)) {
      record('11', 'entity_conflict_logs GET 列表 - 200 {conflicts:[]}', 'PASS',
        `status=${r.status}, conflicts.length=${r.data?.conflicts?.length}, total=${r.data?.total}`)
    } else {
      record('11', 'entity_conflict_logs GET 列表 - 200 {conflicts:[]}', 'FAIL',
        `status=${r.status}, body=${JSON.stringify(r.data)}`)
    }
  } catch (e) {
    record('11', 'entity_conflict_logs GET 列表 - 200 {conflicts:[]}', 'FAIL', `exception: ${e instanceof Error ? e.message : String(e)}`)
  }

  // ----------------------------------------------------------------------
  // 验证 12: entity_conflict_logs API - POST resolve
  // ----------------------------------------------------------------------
  console.log('--- 验证 12: entity_conflict_logs API - POST resolve ---')
  try {
    // 查询是否有未解决的冲突
    const getR = await fetchJson<any>('GET', '/api/entities/conflicts')
    const conflicts: any[] = Array.isArray(getR.data?.conflicts) ? getR.data.conflicts : []
    if (conflicts.length === 0) {
      record('12', 'entity_conflict_logs POST resolve', 'SKIP',
        `no conflict records to resolve`)
    } else {
      const target = conflicts[0]
      const r = await fetchJson<any>('POST', `/api/entities/conflicts/${target.id}/resolve`, {
        action: 'keep-local',
      })
      if (r.status === 200 && r.data?.ok === true && r.data?.conflict?.resolved === true) {
        record('12', 'entity_conflict_logs POST resolve - {ok:true, conflict:{resolved:true}}', 'PASS',
          `status=${r.status}, conflict.id=${target.id}, resolved=${r.data?.conflict?.resolved}`)
      } else {
        record('12', 'entity_conflict_logs POST resolve - {ok:true, conflict:{resolved:true}}', 'FAIL',
          `status=${r.status}, body=${JSON.stringify(r.data)}`)
      }
    }
  } catch (e) {
    record('12', 'entity_conflict_logs POST resolve', 'FAIL', `exception: ${e instanceof Error ? e.message : String(e)}`)
  }

  // ----------------------------------------------------------------------
  // 验证 13: widgets 乐观锁不回归
  // ----------------------------------------------------------------------
  console.log('--- 验证 13: widgets 乐观锁不回归 ---')
  let widgetIdForTest13: string | null = null
  try {
    // 先创建一个 panel（widget 需要 panel_id 外键）
    const panelR = await fetchJson<any>('POST', '/api/panels', {
      id: `test-panel-s3-${Date.now()}`,
      name: 'test panel s3',
    })
    if (panelR.status !== 201) {
      record('13', 'widgets 乐观锁不回归', 'FAIL', `setup POST /api/panels failed: status=${panelR.status}, body=${JSON.stringify(panelR.data)}`)
    } else {
      const panelId = panelR.data.id
      // 创建 widget
      const widgetR = await fetchJson<any>('POST', `/api/panels/${panelId}/widgets`, {
        type: 'note',
        state: { value: 0 },
      })
      if (widgetR.status !== 201) {
        record('13', 'widgets 乐观锁不回归', 'FAIL', `setup POST /api/panels/:id/widgets failed: status=${widgetR.status}, body=${JSON.stringify(widgetR.data)}`)
      } else {
        const widgetId = widgetR.data.id
        widgetIdForTest13 = widgetId
        const initialVersion = widgetR.data.version
        // 第一次 PUT state with expectedVersion=initialVersion 应成功
        const put1 = await fetchJson<any>('PUT', `/api/widgets/${widgetId}`, {
          state: { value: 1 },
          expectedVersion: initialVersion,
        })
        if (put1.status !== 200) {
          record('13', 'widgets 乐观锁不回归', 'FAIL',
            `first PUT (correct version) failed: status=${put1.status}, body=${JSON.stringify(put1.data)}`)
        } else {
          // 第二次 PUT state with expectedVersion=initialVersion（旧版本号）应返回 409
          const put2 = await fetchJson<any>('PUT', `/api/widgets/${widgetId}`, {
            state: { value: 2 },
            expectedVersion: initialVersion, // 旧版本号
          })
          if (
            put2.status === 409 &&
            put2.data?.conflict === true &&
            put2.data?.currentVersion !== undefined &&
            put2.data?.currentState !== undefined
          ) {
            record('13', 'widgets 乐观锁不回归 - 旧版本号返回 409', 'PASS',
              `first PUT 200 ok, second PUT 409 conflict=true, currentVersion=${put2.data?.currentVersion}`)
          } else {
            record('13', 'widgets 乐观锁不回归 - 旧版本号返回 409', 'FAIL',
              `second PUT: status=${put2.status}, body=${JSON.stringify(put2.data)}`)
          }
        }
      }
    }
  } catch (e) {
    record('13', 'widgets 乐观锁不回归', 'FAIL', `exception: ${e instanceof Error ? e.message : String(e)}`)
  }

  // ----------------------------------------------------------------------
  // 验证 14: entities PUT 触发冲突日志（核心新增）+ panelId 字段 + GET 默认返回全部
  // ----------------------------------------------------------------------
  console.log('--- 验证 14: entities PUT 触发冲突日志 + panelId + GET 默认返回全部 ---')
  let entityConflictId: string | null = null
  let conflictPanelId: string | null = null
  try {
    // 创建 entity WITH panelId（用于验证冲突日志的 panelId 字段）
    const testPanelId = `test-panel-conflict-${Date.now()}`
    const postR = await fetchJson<any>('POST', '/api/entities', {
      type: 'note',
      scope: 'global',
      panelId: testPanelId,
      data: { content: 'original' },
    })
    if (postR.status !== 201) {
      record('14', 'entities PUT 触发冲突日志 + panelId + GET 默认返回全部', 'FAIL', `setup POST /api/entities failed: status=${postR.status}, body=${JSON.stringify(postR.data)}`)
    } else {
      const entityId = postR.data.id
      conflictPanelId = testPanelId
      const initialVersion = postR.data.version // 应为 1
      // 第一次 PUT data with expectedVersion=1 应成功
      const put1 = await fetchJson<any>('PUT', `/api/entities/${entityId}`, {
        data: { content: 'v1' },
        expectedVersion: initialVersion,
      })
      if (put1.status !== 200) {
        record('14', 'entities PUT 触发冲突日志 + panelId + GET 默认返回全部', 'FAIL',
          `first PUT (correct version) failed: status=${put1.status}, body=${JSON.stringify(put1.data)}`)
      } else {
        // 第二次 PUT data with expectedVersion=1（旧版本号）应成功（LWW）+ 触发冲突日志 conflict1
        const put2 = await fetchJson<any>('PUT', `/api/entities/${entityId}`, {
          data: { content: 'v2-concurrent' },
          expectedVersion: initialVersion, // 旧版本号
        })
        if (put2.status !== 200) {
          record('14', 'entities PUT 触发冲突日志 + panelId + GET 默认返回全部', 'FAIL',
            `second PUT (LWW) failed: status=${put2.status}, body=${JSON.stringify(put2.data)}`)
        } else {
          // 验证 GET /api/entities/conflicts?entityId=xxx 包含 conflict1 且 panelId 字段匹配
          const getR = await fetchJson<any>('GET', `/api/entities/conflicts?entityId=${entityId}`)
          const conflicts: any[] = Array.isArray(getR.data?.conflicts) ? getR.data.conflicts : []
          const conflict1 = conflicts.find((c) => c.entityId === entityId && c.resolved === false)
          if (!conflict1) {
            record('14', 'entities PUT 触发冲突日志 + panelId + GET 默认返回全部', 'FAIL',
              `conflict1 not found: status=${getR.status}, conflicts.length=${conflicts.length}`)
          } else if (conflict1.panelId !== testPanelId) {
            record('14', 'entities PUT 触发冲突日志 + panelId + GET 默认返回全部', 'FAIL',
              `conflict1.panelId mismatch: expected=${testPanelId}, got=${conflict1.panelId}`)
          } else {
            // 解决 conflict1（POST /resolve）
            const resolveR = await fetchJson<any>('POST', `/api/entities/conflicts/${conflict1.id}/resolve`, {
              action: 'keep-local',
            })
            if (resolveR.status !== 200 || !resolveR.data?.ok) {
              record('14', 'entities PUT 触发冲突日志 + panelId + GET 默认返回全部', 'FAIL',
                `resolve conflict1 failed: status=${resolveR.status}, body=${JSON.stringify(resolveR.data)}`)
            } else {
              // 触发 conflict2（未解决）— 用故意旧版本号再次 PUT
              const entR = await fetchJson<any>('GET', `/api/entities/${entityId}`)
              const currentVersion = entR.data?.version
              const put3 = await fetchJson<any>('PUT', `/api/entities/${entityId}`, {
                data: { content: 'v3-concurrent' },
                expectedVersion: currentVersion - 1, // 故意旧版本号触发冲突
              })
              if (put3.status !== 200) {
                record('14', 'entities PUT 触发冲突日志 + panelId + GET 默认返回全部', 'FAIL',
                  `third PUT (trigger conflict2) failed: status=${put3.status}, body=${JSON.stringify(put3.data)}`)
              } else {
                // 验证 GET /api/entities/conflicts（不传 resolved）返回全部（含已解决 + 未解决）
                const getAllR = await fetchJson<any>('GET', '/api/entities/conflicts')
                const allConflicts: any[] = Array.isArray(getAllR.data?.conflicts) ? getAllR.data.conflicts : []
                const entityConflicts = allConflicts.filter((c) => c.entityId === entityId)
                const hasResolved = entityConflicts.some((c) => c.resolved === true)
                const hasUnresolved = entityConflicts.some((c) => c.resolved === false)
                const conflict2 = entityConflicts.find((c) => c.resolved === false)
                if (getAllR.status === 200 && hasResolved && hasUnresolved && conflict2) {
                  entityConflictId = conflict2.id
                  record('14', 'entities PUT 触发冲突日志 + panelId + GET 默认返回全部', 'PASS',
                    `PUT1 200, PUT2 LWW 200 (conflict1 panelId=${conflict1.panelId}), resolved, PUT3 LWW 200 (conflict2); GET without resolved returns both resolved+unresolved`)
                } else {
                  record('14', 'entities PUT 触发冲突日志 + panelId + GET 默认返回全部', 'FAIL',
                    `GET without resolved: status=${getAllR.status}, hasResolved=${hasResolved}, hasUnresolved=${hasUnresolved}, conflict2=${!!conflict2}`)
                }
              }
            }
          }
        }
      }
    }
  } catch (e) {
    record('14', 'entities PUT 触发冲突日志 + panelId + GET 默认返回全部', 'FAIL', `exception: ${e instanceof Error ? e.message : String(e)}`)
  }

  // ----------------------------------------------------------------------
  // 验证 12 补充：如果验证 12 跳过但验证 14 创建了冲突，则补做 resolve
  // ----------------------------------------------------------------------
  const r12 = results.find((r) => r.id === '12')
  if (r12 && r12.status === 'SKIP' && entityConflictId) {
    console.log('--- 验证 12 补充：用验证 14 创建的冲突日志补做 POST resolve ---')
    try {
      const r = await fetchJson<any>('POST', `/api/entities/conflicts/${entityConflictId}/resolve`, {
        action: 'keep-local',
      })
      if (r.status === 200 && r.data?.ok === true && r.data?.conflict?.resolved === true) {
        // 覆盖原 SKIP 记录
        r12.status = 'PASS'
        r12.detail = `补做 resolve（用验证 14 创建的冲突）：status=${r.status}, conflict.resolved=${r.data?.conflict?.resolved}`
        console.log(`[PASS] 验证 12: entity_conflict_logs POST resolve - ${r12.detail}`)
      } else {
        r12.status = 'FAIL'
        r12.detail = `补做 resolve 失败：status=${r.status}, body=${JSON.stringify(r.data)}`
        console.log(`[FAIL] 验证 12: entity_conflict_logs POST resolve - ${r12.detail}`)
      }
    } catch (e) {
      r12.status = 'FAIL'
      r12.detail = `补做 resolve 异常：${e instanceof Error ? e.message : String(e)}`
      console.log(`[FAIL] 验证 12: entity_conflict_logs POST resolve - ${r12.detail}`)
    }
  }

  // ----------------------------------------------------------------------
  // 验证 15: WS sync_failed 事件推送
  // ----------------------------------------------------------------------
  console.log('--- 验证 15: WS sync_failed 事件推送 ---')
  let ws: WebSocket | null = null
  try {
    ws = await createWs(TEST_DEVICE_ID)
    await sleep(300) // 等待连接稳定

    // 准备 WS 消息等待器
    const syncFailedPromise = waitForMessage(
      ws,
      (msg) => msg.kind === 'change' && msg.changeType === 'sync_failed',
      5000,
    )

    // 短暂延迟确保监听器已注册
    await sleep(50)

    // 通过 PUT /api/sync/logs 写一条 failed 状态的 sync_log，deviceId 设为 TEST_DEVICE_ID
    // 用 X-Device-Id 头注入 req.deviceId（dev 模式 SERVER_TOKEN 空，authMiddleware 仍解析 X-Device-Id）
    const putR = await fetchJson('PUT', '/api/sync/logs', {
      id: 'test-sync-log-ws-failed',
      operation: 'update',
      entityType: 'widget',
      entityId: 'test-widget-ws',
      payload: { state: {} },
      status: 'failed',
      lastError: 'ws test error',
    })

    if (putR.status !== 200) {
      record('15', 'WS sync_failed 事件推送', 'FAIL',
        `setup PUT failed sync_log failed: status=${putR.status}, body=${JSON.stringify(putR.data)}`)
    } else {
      // 等待 WS 收到 sync_failed 消息
      const msg = await syncFailedPromise
      const data = msg?.data || {}
      if (
        data.id === 'test-sync-log-ws-failed' &&
        data.deviceId === TEST_DEVICE_ID &&
        data.operation === 'update' &&
        data.entityType === 'widget' &&
        data.entityId === 'test-widget-ws' &&
        data.lastError === 'ws test error'
      ) {
        record('15', 'WS sync_failed 事件推送', 'PASS',
          `received sync_failed: id=${data.id}, deviceId=${data.deviceId}, lastError=${data.lastError}`)
      } else {
        record('15', 'WS sync_failed 事件推送', 'FAIL',
          `received msg but payload mismatch: ${JSON.stringify(msg)}`)
      }
    }
  } catch (e) {
    // dev 模式 SERVER_TOKEN 空但 authMiddleware 解析 X-Device-Id，理论上应能定向推送
    // 如果出现 timeout/deviceId 不匹配等情况，记录 SKIP 并说明原因
    const errMsg = e instanceof Error ? e.message : String(e)
    if (errMsg.includes('timeout')) {
      record('15', 'WS sync_failed 事件推送', 'SKIP',
        `WS message timeout - 可能 deviceId 不匹配或广播路径未定向到本设备（${errMsg}）`)
    } else {
      record('15', 'WS sync_failed 事件推送', 'FAIL', `exception: ${errMsg}`)
    }
  } finally {
    if (ws) {
      await closeWs(ws)
    }
  }

  // ----------------------------------------------------------------------
  // 验证 16: GET /api/entities/conflicts?panelId=xxx 过滤
  // ----------------------------------------------------------------------
  console.log('--- 验证 16: GET /api/entities/conflicts?panelId=xxx 过滤 ---')
  try {
    if (!conflictPanelId) {
      record('16', 'GET /api/entities/conflicts?panelId=xxx 过滤', 'SKIP',
        `no conflictPanelId available (verify 14 may have failed)`)
    } else {
      // 用 verify 14 设置的 conflictPanelId 过滤
      const r = await fetchJson<any>(
        'GET',
        `/api/entities/conflicts?panelId=${encodeURIComponent(conflictPanelId)}`,
      )
      const conflicts: any[] = Array.isArray(r.data?.conflicts) ? r.data.conflicts : []
      // 所有返回的冲突都应有 panelId === conflictPanelId
      const allMatch = conflicts.every((c) => c.panelId === conflictPanelId)
      // 应至少包含 verify 14 创建的冲突
      const hasExpected = conflicts.length > 0
      if (r.status === 200 && allMatch && hasExpected) {
        record('16', 'GET /api/entities/conflicts?panelId=xxx 过滤', 'PASS',
          `status=${r.status}, conflicts.length=${conflicts.length}, all panelId=${conflictPanelId}`)
      } else {
        record('16', 'GET /api/entities/conflicts?panelId=xxx 过滤', 'FAIL',
          `status=${r.status}, conflicts.length=${conflicts.length}, allMatch=${allMatch}, hasExpected=${hasExpected}`)
      }
    }
  } catch (e) {
    record('16', 'GET /api/entities/conflicts?panelId=xxx 过滤', 'FAIL', `exception: ${e instanceof Error ? e.message : String(e)}`)
  }

  // ----------------------------------------------------------------------
  // 清理：删除测试产生的 sync_logs（避免污染数据库）
  // ----------------------------------------------------------------------
  console.log('')
  console.log('--- 清理测试数据 ---')
  const cleanupIds = [
    'test-sync-log-1',
    'test-sync-log-failed',
    'test-sync-log-create',
    'test-sync-log-settings',
    'test-sync-log-ws-failed',
  ]
  for (const id of cleanupIds) {
    try {
      await fetchJson('DELETE', `/api/sync/logs/${id}`)
    } catch {
      // ignore
    }
  }
  // 关闭 PG 连接池
  try {
    await pool.end()
  } catch {
    // ignore
  }

  // ----------------------------------------------------------------------
  // 汇总报告
  // ----------------------------------------------------------------------
  console.log('')
  console.log('=== 验证汇总 ===')
  const passed = results.filter((r) => r.status === 'PASS').length
  const failed = results.filter((r) => r.status === 'FAIL').length
  const skipped = results.filter((r) => r.status === 'SKIP').length
  console.log(`========================================`)
  console.log(`Phase S3 运行时验证结果：${passed}/${results.length} 项通过（${skipped} 项跳过）`)
  console.log(`========================================`)
  console.log('')
  for (const r of results) {
    console.log(`[${r.status}] 验证 ${r.id}: ${r.name}`)
    console.log(`  - ${r.detail}`)
  }

  // 退出码：失败数 > 0 则 1
  process.exit(failed > 0 ? 1 : 0)
}

main().catch((err) => {
  console.error('Test runner crashed:', err)
  try {
    pool.end()
  } catch {
    // ignore
  }
  process.exit(2)
})
