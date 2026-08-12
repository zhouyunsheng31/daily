// ============================================================================
// Phase S5 运行时验证脚本
// 验证：dynamic_widgets 表扩展（component_env/local_services/cross_platform/desktop_only）
//      + 跨端组件支持 + component_capabilities 联动 + WS 广播 + sanitization
//
// 运行：cd f:\allmylife\event\server && npx tsx test/phase-s5-runtime-verify.ts
// 依赖：本地 server 在 3458 端口运行（dev 模式 SERVER_TOKEN 空，跳过鉴权）
// ============================================================================

import { WebSocket } from 'ws'
import { Pool } from 'pg'

const SERVER_BASE = 'http://localhost:3458'
const SERVER_WS_URL = 'ws://localhost:3458/ws'
const TEST_DEVICE_ID = 's5-test-device'
// WS_BROADCAST 用例需要用不同 deviceId 触发 POST，因为 broadcastChange 会排除 sourceDeviceId
const SENDER_DEVICE_ID = 's5-test-sender'

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
  console.log('=== Phase S5 运行时验证 ===')
  console.log(`Server base: ${SERVER_BASE}`)
  console.log(`Server WS:   ${SERVER_WS_URL}`)
  console.log('')

  // ======================================================================
  // A. 基础设施（2 项）
  // ======================================================================

  // ----------------------------------------------------------------------
  // 验证 1: HEALTH
  // ----------------------------------------------------------------------
  console.log('--- 验证 1: HEALTH ---')
  try {
    const r = await fetchJson<{ status: string }>('GET', '/api/health')
    if (r.status === 200 && r.data?.status === 'ok') {
      record('1', 'HEALTH - GET /api/health 200 {status:ok}', 'PASS',
        `status=${r.status}, body.status=${r.data?.status}`)
    } else {
      record('1', 'HEALTH - GET /api/health 200 {status:ok}', 'FAIL',
        `status=${r.status}, body=${JSON.stringify(r.data)}`)
    }
  } catch (e) {
    record('1', 'HEALTH - GET /api/health 200 {status:ok}', 'FAIL',
      `exception: ${e instanceof Error ? e.message : String(e)}`)
  }

  // ----------------------------------------------------------------------
  // 验证 2: SCHEMA - dynamic_widgets 表 + 4 个新字段
  // ----------------------------------------------------------------------
  console.log('--- 验证 2: SCHEMA - dynamic_widgets 表 + 4 个新字段 ---')
  try {
    const tableR = await pool.query(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = 'dynamic_widgets'`,
    )
    if (tableR.rows.length === 0) {
      record('2', 'SCHEMA - dynamic_widgets 表 + 4 个新字段', 'FAIL',
        `table dynamic_widgets not found in information_schema`)
    } else {
      const colR = await pool.query(
        `SELECT column_name FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'dynamic_widgets'
           AND column_name IN ('component_env','local_services','cross_platform','desktop_only')`,
      )
      const found = colR.rows.map((r: any) => r.column_name)
      const expected = ['component_env', 'local_services', 'cross_platform', 'desktop_only']
      const missing = expected.filter((c) => !found.includes(c))
      if (missing.length === 0) {
        record('2', 'SCHEMA - dynamic_widgets 表 + 4 个新字段', 'PASS',
          `table exists, all 4 new columns present: ${found.join(',')}`)
      } else {
        record('2', 'SCHEMA - dynamic_widgets 表 + 4 个新字段', 'FAIL',
          `table exists but missing columns: ${missing.join(',')} (found: ${found.join(',')})`)
      }
    }
  } catch (e) {
    record('2', 'SCHEMA - dynamic_widgets 表 + 4 个新字段', 'FAIL',
      `exception: ${e instanceof Error ? e.message : String(e)}`)
  }

  // ======================================================================
  // B. POST 创建组件（5 项）
  // ======================================================================

  // ----------------------------------------------------------------------
  // 验证 3: POST_PURE_FRONTEND - 创建纯前端组件
  // ----------------------------------------------------------------------
  console.log('--- 验证 3: POST_PURE_FRONTEND ---')
  try {
    const r = await fetchJson<any>('POST', '/api/dynamic-widgets', {
      widgetType: 's5-test-pure',
      displayName: 'S5 Pure Frontend',
      icon: 'box',
      componentEnv: 'pure-frontend',
      desktopOnly: false,
      crossPlatform: true,
      code: '<html>Hi</html>',
    })
    if (
      r.status === 201 &&
      r.data?.widgetType === 's5-test-pure' &&
      r.data?.componentEnv === 'pure-frontend' &&
      r.data?.desktopOnly === false &&
      r.data?.crossPlatform === true &&
      r.data?.code === '<html>Hi</html>'
    ) {
      record('3', 'POST_PURE_FRONTEND - 201 + 4 字段正确', 'PASS',
        `widgetType=${r.data?.widgetType}, componentEnv=${r.data?.componentEnv}, desktopOnly=${r.data?.desktopOnly}, crossPlatform=${r.data?.crossPlatform}, localServices=${JSON.stringify(r.data?.localServices)}`)
    } else {
      record('3', 'POST_PURE_FRONTEND - 201 + 4 字段正确', 'FAIL',
        `status=${r.status}, body=${JSON.stringify(r.data)}`)
    }
  } catch (e) {
    record('3', 'POST_PURE_FRONTEND - 201 + 4 字段正确', 'FAIL',
      `exception: ${e instanceof Error ? e.message : String(e)}`)
  }

  // ----------------------------------------------------------------------
  // 验证 4: POST_DESKTOP_ONLY - 创建桌面专属组件
  // ----------------------------------------------------------------------
  console.log('--- 验证 4: POST_DESKTOP_ONLY ---')
  try {
    const r = await fetchJson<any>('POST', '/api/dynamic-widgets', {
      widgetType: 's5-test-desktop-only',
      displayName: 'S5 Desktop Only',
      icon: 'monitor',
      componentEnv: 'local-dependent',
      desktopOnly: true,
      crossPlatform: false,
      localServices: ['local-notes', 'local-files'],
      code: '<html>Desktop</html>',
    })
    if (
      r.status === 201 &&
      r.data?.widgetType === 's5-test-desktop-only' &&
      r.data?.componentEnv === 'local-dependent' &&
      r.data?.desktopOnly === true &&
      r.data?.crossPlatform === false &&
      Array.isArray(r.data?.localServices) &&
      r.data?.localServices.length === 2 &&
      r.data?.localServices.includes('local-notes') &&
      r.data?.localServices.includes('local-files')
    ) {
      record('4', 'POST_DESKTOP_ONLY - 201 + localServices 正确', 'PASS',
        `widgetType=${r.data?.widgetType}, componentEnv=${r.data?.componentEnv}, desktopOnly=${r.data?.desktopOnly}, localServices=${JSON.stringify(r.data?.localServices)}`)
    } else {
      record('4', 'POST_DESKTOP_ONLY - 201 + localServices 正确', 'FAIL',
        `status=${r.status}, body=${JSON.stringify(r.data)}`)
    }
  } catch (e) {
    record('4', 'POST_DESKTOP_ONLY - 201 + localServices 正确', 'FAIL',
      `exception: ${e instanceof Error ? e.message : String(e)}`)
  }

  // ----------------------------------------------------------------------
  // 验证 5: POST_INVALID_ENV - componentEnv='evil' → 400
  // ----------------------------------------------------------------------
  console.log('--- 验证 5: POST_INVALID_ENV ---')
  try {
    const r = await fetchJson<any>('POST', '/api/dynamic-widgets', {
      widgetType: 's5-test-invalid-env',
      componentEnv: 'evil',
      code: '<html></html>',
    })
    // 错误响应格式: { error: { status, code, message } }
    const errCode = r.data?.error?.code
    if (r.status === 400 && errCode === 'INVALID_COMPONENT_ENV') {
      record('5', 'POST_INVALID_ENV - 400 INVALID_COMPONENT_ENV', 'PASS',
        `status=${r.status}, error.code=${errCode}`)
    } else {
      record('5', 'POST_INVALID_ENV - 400 INVALID_COMPONENT_ENV', 'FAIL',
        `status=${r.status}, error.code=${errCode}, body=${JSON.stringify(r.data)}`)
    }
  } catch (e) {
    record('5', 'POST_INVALID_ENV - 400 INVALID_COMPONENT_ENV', 'FAIL',
      `exception: ${e instanceof Error ? e.message : String(e)}`)
  }

  // ----------------------------------------------------------------------
  // 验证 6: POST_INVALID_TYPE - widgetType='bad type!' → 400
  // ----------------------------------------------------------------------
  console.log('--- 验证 6: POST_INVALID_TYPE ---')
  try {
    const r = await fetchJson<any>('POST', '/api/dynamic-widgets', {
      widgetType: 'bad type!',
      displayName: 'invalid',
      code: '<html></html>',
    })
    const errCode = r.data?.error?.code
    if (r.status === 400 && errCode === 'INVALID_WIDGET_TYPE') {
      record('6', 'POST_INVALID_TYPE - 400 INVALID_WIDGET_TYPE', 'PASS',
        `status=${r.status}, error.code=${errCode}`)
    } else {
      record('6', 'POST_INVALID_TYPE - 400 INVALID_WIDGET_TYPE', 'FAIL',
        `status=${r.status}, error.code=${errCode}, body=${JSON.stringify(r.data)}`)
    }
  } catch (e) {
    record('6', 'POST_INVALID_TYPE - 400 INVALID_WIDGET_TYPE', 'FAIL',
      `exception: ${e instanceof Error ? e.message : String(e)}`)
  }

  // ----------------------------------------------------------------------
  // 验证 7: POST_INVALID_SERVICES - localServices=[{bad:1}] → 400
  // ----------------------------------------------------------------------
  console.log('--- 验证 7: POST_INVALID_SERVICES ---')
  try {
    const r = await fetchJson<any>('POST', '/api/dynamic-widgets', {
      widgetType: 's5-test-invalid-services',
      localServices: [{ bad: 1 }],
      code: '<html></html>',
    })
    const errCode = r.data?.error?.code
    if (r.status === 400 && errCode === 'INVALID_LOCAL_SERVICES') {
      record('7', 'POST_INVALID_SERVICES - 400 INVALID_LOCAL_SERVICES', 'PASS',
        `status=${r.status}, error.code=${errCode}`)
    } else {
      record('7', 'POST_INVALID_SERVICES - 400 INVALID_LOCAL_SERVICES', 'FAIL',
        `status=${r.status}, error.code=${errCode}, body=${JSON.stringify(r.data)}`)
    }
  } catch (e) {
    record('7', 'POST_INVALID_SERVICES - 400 INVALID_LOCAL_SERVICES', 'FAIL',
      `exception: ${e instanceof Error ? e.message : String(e)}`)
  }

  // ======================================================================
  // C. GET 查询过滤（2 项）
  // ======================================================================

  // ----------------------------------------------------------------------
  // 验证 8: GET_ALL - 返回数组包含两个测试组件
  // ----------------------------------------------------------------------
  console.log('--- 验证 8: GET_ALL ---')
  try {
    const r = await fetchJson<any[]>('GET', '/api/dynamic-widgets')
    const items: any[] = Array.isArray(r.data) ? r.data : []
    const hasPure = items.some((it) => it.widgetType === 's5-test-pure')
    const hasDesktop = items.some((it) => it.widgetType === 's5-test-desktop-only')
    if (r.status === 200 && hasPure && hasDesktop) {
      record('8', 'GET_ALL - 返回数组包含 s5-test-pure 和 s5-test-desktop-only', 'PASS',
        `status=${r.status}, items.length=${items.length}, hasPure=${hasPure}, hasDesktop=${hasDesktop}`)
    } else {
      record('8', 'GET_ALL - 返回数组包含 s5-test-pure 和 s5-test-desktop-only', 'FAIL',
        `status=${r.status}, items.length=${items.length}, hasPure=${hasPure}, hasDesktop=${hasDesktop}`)
    }
  } catch (e) {
    record('8', 'GET_ALL - 返回数组包含 s5-test-pure 和 s5-test-desktop-only', 'FAIL',
      `exception: ${e instanceof Error ? e.message : String(e)}`)
  }

  // ----------------------------------------------------------------------
  // 验证 9: GET_DESKTOP_FILTER - ?desktop=false 不含 desktopOnly=true
  // ----------------------------------------------------------------------
  console.log('--- 验证 9: GET_DESKTOP_FILTER ---')
  try {
    const r = await fetchJson<any[]>('GET', '/api/dynamic-widgets?desktop=false')
    const items: any[] = Array.isArray(r.data) ? r.data : []
    const hasDesktopOnly = items.some((it) => it.desktopOnly === true)
    const hasPure = items.some((it) => it.widgetType === 's5-test-pure')
    const hasDesktopOnlyWidget = items.some((it) => it.widgetType === 's5-test-desktop-only')
    if (r.status === 200 && !hasDesktopOnly && !hasDesktopOnlyWidget && hasPure) {
      record('9', 'GET_DESKTOP_FILTER - ?desktop=false 排除 desktopOnly=true', 'PASS',
        `status=${r.status}, items.length=${items.length}, hasPure=${hasPure}, hasDesktopOnlyWidget=${hasDesktopOnlyWidget}`)
    } else {
      record('9', 'GET_DESKTOP_FILTER - ?desktop=false 排除 desktopOnly=true', 'FAIL',
        `status=${r.status}, items.length=${items.length}, hasDesktopOnly=${hasDesktopOnly}, hasDesktopOnlyWidget=${hasDesktopOnlyWidget}, hasPure=${hasPure}`)
    }
  } catch (e) {
    record('9', 'GET_DESKTOP_FILTER - ?desktop=false 排除 desktopOnly=true', 'FAIL',
      `exception: ${e instanceof Error ? e.message : String(e)}`)
  }

  // ======================================================================
  // D. PUT 更新（3 项）
  // ======================================================================

  // ----------------------------------------------------------------------
  // 验证 10: PUT_UPDATE_ENV - 更新 componentEnv='local-dependent'
  // ----------------------------------------------------------------------
  console.log('--- 验证 10: PUT_UPDATE_ENV ---')
  try {
    const r = await fetchJson<any>('PUT', '/api/dynamic-widgets/s5-test-pure', {
      componentEnv: 'local-dependent',
    })
    if (r.status === 200 && r.data?.componentEnv === 'local-dependent') {
      record('10', 'PUT_UPDATE_ENV - componentEnv=local-dependent', 'PASS',
        `status=${r.status}, componentEnv=${r.data?.componentEnv}`)
    } else {
      record('10', 'PUT_UPDATE_ENV - componentEnv=local-dependent', 'FAIL',
        `status=${r.status}, componentEnv=${r.data?.componentEnv}, body=${JSON.stringify(r.data)}`)
    }
  } catch (e) {
    record('10', 'PUT_UPDATE_ENV - componentEnv=local-dependent', 'FAIL',
      `exception: ${e instanceof Error ? e.message : String(e)}`)
  }

  // ----------------------------------------------------------------------
  // 验证 11: PUT_UPDATE_SERVICES - 更新 localServices=['svc-a','svc-b']
  // ----------------------------------------------------------------------
  console.log('--- 验证 11: PUT_UPDATE_SERVICES ---')
  try {
    const r = await fetchJson<any>('PUT', '/api/dynamic-widgets/s5-test-pure', {
      localServices: ['svc-a', 'svc-b'],
    })
    if (
      r.status === 200 &&
      Array.isArray(r.data?.localServices) &&
      r.data?.localServices.length === 2 &&
      r.data?.localServices.includes('svc-a') &&
      r.data?.localServices.includes('svc-b')
    ) {
      record('11', 'PUT_UPDATE_SERVICES - localServices=[svc-a,svc-b]', 'PASS',
        `status=${r.status}, localServices=${JSON.stringify(r.data?.localServices)}`)
    } else {
      record('11', 'PUT_UPDATE_SERVICES - localServices=[svc-a,svc-b]', 'FAIL',
        `status=${r.status}, localServices=${JSON.stringify(r.data?.localServices)}, body=${JSON.stringify(r.data)}`)
    }
  } catch (e) {
    record('11', 'PUT_UPDATE_SERVICES - localServices=[svc-a,svc-b]', 'FAIL',
      `exception: ${e instanceof Error ? e.message : String(e)}`)
  }

  // ----------------------------------------------------------------------
  // 验证 12: PUT_INVALID_ENV - componentEnv='invalid' → 400
  // ----------------------------------------------------------------------
  console.log('--- 验证 12: PUT_INVALID_ENV ---')
  try {
    const r = await fetchJson<any>('PUT', '/api/dynamic-widgets/s5-test-pure', {
      componentEnv: 'invalid',
    })
    const errCode = r.data?.error?.code
    if (r.status === 400 && errCode === 'INVALID_COMPONENT_ENV') {
      record('12', 'PUT_INVALID_ENV - 400 INVALID_COMPONENT_ENV', 'PASS',
        `status=${r.status}, error.code=${errCode}`)
    } else {
      record('12', 'PUT_INVALID_ENV - 400 INVALID_COMPONENT_ENV', 'FAIL',
        `status=${r.status}, error.code=${errCode}, body=${JSON.stringify(r.data)}`)
    }
  } catch (e) {
    record('12', 'PUT_INVALID_ENV - 400 INVALID_COMPONENT_ENV', 'FAIL',
      `exception: ${e instanceof Error ? e.message : String(e)}`)
  }

  // ======================================================================
  // E. component_capabilities 联动（3 项）
  // ======================================================================

  // ----------------------------------------------------------------------
  // 验证 13: CAP_SYNC_ON_POST - GET capabilities/s5-test-desktop-only
  // ----------------------------------------------------------------------
  console.log('--- 验证 13: CAP_SYNC_ON_POST ---')
  try {
    const r = await fetchJson<any>('GET', '/api/component-capabilities/s5-test-desktop-only')
    if (
      r.status === 200 &&
      r.data?.widgetType === 's5-test-desktop-only' &&
      r.data?.componentEnv === 'local-dependent' &&
      r.data?.desktopOnly === true
    ) {
      record('13', 'CAP_SYNC_ON_POST - component_env=local-dependent, desktop_only=true', 'PASS',
        `widgetType=${r.data?.widgetType}, componentEnv=${r.data?.componentEnv}, desktopOnly=${r.data?.desktopOnly}, crossPlatform=${r.data?.crossPlatform}`)
    } else {
      record('13', 'CAP_SYNC_ON_POST - component_env=local-dependent, desktop_only=true', 'FAIL',
        `status=${r.status}, body=${JSON.stringify(r.data)}`)
    }
  } catch (e) {
    record('13', 'CAP_SYNC_ON_POST - component_env=local-dependent, desktop_only=true', 'FAIL',
      `exception: ${e instanceof Error ? e.message : String(e)}`)
  }

  // ----------------------------------------------------------------------
  // 验证 14: CAP_SYNC_ON_PUT - GET capabilities/s5-test-pure（同步 PUT 更新）
  // ----------------------------------------------------------------------
  console.log('--- 验证 14: CAP_SYNC_ON_PUT ---')
  try {
    const r = await fetchJson<any>('GET', '/api/component-capabilities/s5-test-pure')
    if (
      r.status === 200 &&
      r.data?.widgetType === 's5-test-pure' &&
      r.data?.componentEnv === 'local-dependent'
    ) {
      record('14', 'CAP_SYNC_ON_PUT - component_env=local-dependent（同步 PUT）', 'PASS',
        `widgetType=${r.data?.widgetType}, componentEnv=${r.data?.componentEnv}, dependencies=${JSON.stringify(r.data?.dependencies)}`)
    } else {
      record('14', 'CAP_SYNC_ON_PUT - component_env=local-dependent（同步 PUT）', 'FAIL',
        `status=${r.status}, body=${JSON.stringify(r.data)}`)
    }
  } catch (e) {
    record('14', 'CAP_SYNC_ON_PUT - component_env=local-dependent（同步 PUT）', 'FAIL',
      `exception: ${e instanceof Error ? e.message : String(e)}`)
  }

  // ======================================================================
  // F. WS 广播 + SANITIZATION（用例 18, 19）
  // ======================================================================

  // ----------------------------------------------------------------------
  // 验证 18: WS_BROADCAST - POST 创建组件后 WS 收到 dynamic_widget_created
  // 注意：broadcastChange 会排除 sourceDeviceId，所以 WS 用 TEST_DEVICE_ID，
  //      POST 用 SENDER_DEVICE_ID（不同设备），WS 才能收到广播
  // ----------------------------------------------------------------------
  console.log('--- 验证 18: WS_BROADCAST ---')
  let ws: WebSocket | null = null
  try {
    ws = await createWs(TEST_DEVICE_ID)
    await sleep(300) // 等待连接稳定

    // 准备 WS 消息等待器（先注册，再触发 POST）
    const wsBroadcastPromise = waitForMessage(
      ws,
      (msg) => msg.kind === 'change' && msg.changeType === 'dynamic_widget_created',
      5000,
    )

    await sleep(50) // 确保监听器已注册

    // 用 SENDER_DEVICE_ID 触发 POST（与 WS 设备不同，确保能收到广播）
    const postR = await fetchJson<any>('POST', '/api/dynamic-widgets', {
      widgetType: 's5-test-ws-broadcast',
      displayName: 'S5 WS Broadcast',
      componentEnv: 'pure-frontend',
      code: '<html>WS</html>',
    }, { 'X-Device-Id': SENDER_DEVICE_ID })

    if (postR.status !== 201) {
      record('18', 'WS_BROADCAST - 收到 dynamic_widget_created', 'FAIL',
        `setup POST failed: status=${postR.status}, body=${JSON.stringify(postR.data)}`)
    } else {
      // 等待 WS 收到广播
      const msg = await wsBroadcastPromise
      const data = msg?.data || {}
      if (data.widgetType === 's5-test-ws-broadcast') {
        record('18', 'WS_BROADCAST - 收到 dynamic_widget_created', 'PASS',
          `msg.kind=${msg.kind}, changeType=${msg.changeType}, data.widgetType=${data.widgetType}`)
      } else {
        record('18', 'WS_BROADCAST - 收到 dynamic_widget_created', 'FAIL',
          `received msg but payload mismatch: ${JSON.stringify(msg)}`)
      }
    }
  } catch (e) {
    const errMsg = e instanceof Error ? e.message : String(e)
    if (errMsg.includes('timeout')) {
      record('18', 'WS_BROADCAST - 收到 dynamic_widget_created', 'FAIL',
        `WS message timeout - ${errMsg}`)
    } else {
      record('18', 'WS_BROADCAST - 收到 dynamic_widget_created', 'FAIL',
        `exception: ${errMsg}`)
    }
  } finally {
    if (ws) {
      await closeWs(ws)
    }
  }

  // ----------------------------------------------------------------------
  // 验证 19: SANITIZATION - displayName 含控制字符 → 201 但响应不含控制字符
  // 注：sanitizeShortText 实际行为是 stripControlChars（去除 \x00-\x08\x0B\x0C\x0E-\x1F\x7F）
  //     + trim + 长度限制，**不去除 HTML 标签**（spec 9.5 节明确）。
  //     故本用例验证 sanitization 的实际能力：控制字符被去除，HTML 标签保留。
  // ----------------------------------------------------------------------
  console.log('--- 验证 19: SANITIZATION ---')
  try {
    // 输入：HTML 标签 + 控制字符（\x00 NUL, \x1F US, \x7F DEL, \t 制表符）
    // 期望：\x00 \x1F \x7F 被 stripControlChars 去除；\t 被 sanitizeShortText 替换为空格；
    //      HTML 标签 <script> 保留（server 不去 HTML）；整体 trim
    const inputDisplayName = '<script>\u0000alert(1)\u001F\u007F</script>\t'
    const r = await fetchJson<any>('POST', '/api/dynamic-widgets', {
      widgetType: 's5-test-sanitization',
      displayName: inputDisplayName,
      componentEnv: 'pure-frontend',
      code: '<html></html>',
    })
    const displayName: string = r.data?.displayName || ''
    const hasControlChar = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/.test(displayName)
    const hasTab = displayName.includes('\t')
    const hasScript = displayName.includes('<script>')
    // 期望：'<script>alert(1)</script>' （控制字符去除，tab 转空格后 trim 掉尾部，HTML 保留）
    const expectedDisplayName = '<script>alert(1)</script>'
    if (
      r.status === 201 &&
      r.data?.widgetType === 's5-test-sanitization' &&
      !hasControlChar &&
      !hasTab &&
      hasScript &&
      displayName === expectedDisplayName
    ) {
      record('19', 'SANITIZATION - 控制字符被去除（HTML 标签保留）', 'PASS',
        `status=${r.status}, displayName="${displayName}"（输入含 \\x00\\x1F\\x7F\\t，被 sanitize 为 "${expectedDisplayName}"）`)
    } else {
      record('19', 'SANITIZATION - 控制字符被去除（HTML 标签保留）', 'FAIL',
        `status=${r.status}, displayName="${displayName}", hasControlChar=${hasControlChar}, hasTab=${hasTab}, hasScript=${hasScript}, expected="${expectedDisplayName}"`)
    }
  } catch (e) {
    record('19', 'SANITIZATION - 控制字符被去除（HTML 标签保留）', 'FAIL',
      `exception: ${e instanceof Error ? e.message : String(e)}`)
  }

  // ======================================================================
  // H. PUT WS 广播 + boolean 校验（用例 20, 21）
  // ======================================================================

  // ----------------------------------------------------------------------
  // 验证 20: PUT_WS_BROADCAST - PUT 更新组件后 WS 收到 dynamic_widget_updated
  // 步骤：先 POST 创建组件（用 SENDER_DEVICE_ID），建立 WS（用 TEST_DEVICE_ID），
  //      再用 SENDER_DEVICE_ID 触发 PUT 更新，WS 应收到
  //      {kind:'change', changeType:'dynamic_widget_updated', data:{widgetType:'s5-test-put-ws'}}
  // ----------------------------------------------------------------------
  console.log('--- 验证 20: PUT_WS_BROADCAST ---')
  let ws20: WebSocket | null = null
  try {
    // 1. 先 POST 创建组件（用 SENDER_DEVICE_ID）
    const postR = await fetchJson<any>('POST', '/api/dynamic-widgets', {
      widgetType: 's5-test-put-ws',
      displayName: 'S5 PUT WS Broadcast',
      componentEnv: 'pure-frontend',
      code: '<html>PUT WS</html>',
    }, { 'X-Device-Id': SENDER_DEVICE_ID })

    if (postR.status !== 201) {
      record('20', 'PUT_WS_BROADCAST - 收到 dynamic_widget_updated', 'FAIL',
        `setup POST failed: status=${postR.status}, body=${JSON.stringify(postR.data)}`)
    } else {
      // 2. 建立 WS（用 TEST_DEVICE_ID，与 sender 不同，确保能收到广播）
      ws20 = await createWs(TEST_DEVICE_ID)
      await sleep(300) // 等待连接稳定

      // 3. 准备 WS 消息等待器（先注册，再触发 PUT）
      const wsBroadcastPromise = waitForMessage(
        ws20,
        (msg) => msg.kind === 'change' && msg.changeType === 'dynamic_widget_updated',
        5000,
      )

      await sleep(50) // 确保监听器已注册

      // 4. 用 SENDER_DEVICE_ID 触发 PUT 更新
      const putR = await fetchJson<any>('PUT', '/api/dynamic-widgets/s5-test-put-ws', {
        displayName: 'S5 PUT WS Updated',
        componentEnv: 'local-dependent',
      }, { 'X-Device-Id': SENDER_DEVICE_ID })

      if (putR.status !== 200) {
        record('20', 'PUT_WS_BROADCAST - 收到 dynamic_widget_updated', 'FAIL',
          `PUT failed: status=${putR.status}, body=${JSON.stringify(putR.data)}`)
      } else {
        // 5. 等待 WS 收到广播
        const msg = await wsBroadcastPromise
        const data = msg?.data || {}
        if (data.widgetType === 's5-test-put-ws') {
          record('20', 'PUT_WS_BROADCAST - 收到 dynamic_widget_updated', 'PASS',
            `msg.kind=${msg.kind}, changeType=${msg.changeType}, data.widgetType=${data.widgetType}`)
        } else {
          record('20', 'PUT_WS_BROADCAST - 收到 dynamic_widget_updated', 'FAIL',
            `received msg but payload mismatch: ${JSON.stringify(msg)}`)
        }
      }
    }
  } catch (e) {
    const errMsg = e instanceof Error ? e.message : String(e)
    if (errMsg.includes('timeout')) {
      record('20', 'PUT_WS_BROADCAST - 收到 dynamic_widget_updated', 'FAIL',
        `WS message timeout - ${errMsg}`)
    } else {
      record('20', 'PUT_WS_BROADCAST - 收到 dynamic_widget_updated', 'FAIL',
        `exception: ${errMsg}`)
    }
  } finally {
    if (ws20) {
      await closeWs(ws20)
    }
  }

  // ----------------------------------------------------------------------
  // 验证 21: INVALID_BOOLEAN - POST crossPlatform='not-boolean' → 400 INVALID_INPUT
  // ----------------------------------------------------------------------
  console.log('--- 验证 21: INVALID_BOOLEAN ---')
  try {
    const r = await fetchJson<any>('POST', '/api/dynamic-widgets', {
      widgetType: 's5-test-invalid-bool',
      componentEnv: 'pure-frontend',
      crossPlatform: 'not-boolean',
      code: '<html></html>',
    })
    const errCode = r.data?.error?.code
    if (r.status === 400 && errCode === 'INVALID_INPUT') {
      record('21', 'INVALID_BOOLEAN - 400 INVALID_INPUT (crossPlatform 非布尔)', 'PASS',
        `status=${r.status}, error.code=${errCode}`)
    } else {
      record('21', 'INVALID_BOOLEAN - 400 INVALID_INPUT (crossPlatform 非布尔)', 'FAIL',
        `status=${r.status}, error.code=${errCode}, body=${JSON.stringify(r.data)}`)
    }
  } catch (e) {
    record('21', 'INVALID_BOOLEAN - 400 INVALID_INPUT (crossPlatform 非布尔)', 'FAIL',
      `exception: ${e instanceof Error ? e.message : String(e)}`)
  }

  // ======================================================================
  // G. DELETE + CAP_DELETE_ON_DELETE（用例 15, 16, 17）
  // ======================================================================


  // ----------------------------------------------------------------------
  // 验证 15: CAP_DELETE_ON_DELETE - DELETE s5-test-pure 后 GET capabilities → 404
  // ----------------------------------------------------------------------
  console.log('--- 验证 15: CAP_DELETE_ON_DELETE ---')
  try {
    const delR = await fetchJson<any>('DELETE', '/api/dynamic-widgets/s5-test-pure')
    if (delR.status !== 200 || delR.data?.ok !== true) {
      record('15', 'CAP_DELETE_ON_DELETE - DELETE 后 GET capabilities → 404', 'FAIL',
        `DELETE failed: status=${delR.status}, body=${JSON.stringify(delR.data)}`)
    } else {
      // 验证 capabilities 也被同步删除
      const capR = await fetchJson<any>('GET', '/api/component-capabilities/s5-test-pure')
      if (capR.status === 404) {
        record('15', 'CAP_DELETE_ON_DELETE - DELETE 后 GET capabilities → 404', 'PASS',
          `DELETE 200 {ok:true}, GET capabilities 404 (同步删除)`)
      } else {
        record('15', 'CAP_DELETE_ON_DELETE - DELETE 后 GET capabilities → 404', 'FAIL',
          `DELETE ok but GET capabilities status=${capR.status}, body=${JSON.stringify(capR.data)}（应返回 404）`)
      }
    }
  } catch (e) {
    record('15', 'CAP_DELETE_ON_DELETE - DELETE 后 GET capabilities → 404', 'FAIL',
      `exception: ${e instanceof Error ? e.message : String(e)}`)
  }

  // ----------------------------------------------------------------------
  // 验证 16: DELETE - DELETE s5-test-desktop-only → 200 {ok:true}
  // ----------------------------------------------------------------------
  console.log('--- 验证 16: DELETE ---')
  try {
    const r = await fetchJson<any>('DELETE', '/api/dynamic-widgets/s5-test-desktop-only')
    if (r.status === 200 && r.data?.ok === true) {
      record('16', 'DELETE - 200 {ok:true}', 'PASS',
        `status=${r.status}, body=${JSON.stringify(r.data)}`)
    } else {
      record('16', 'DELETE - 200 {ok:true}', 'FAIL',
        `status=${r.status}, body=${JSON.stringify(r.data)}`)
    }
  } catch (e) {
    record('16', 'DELETE - 200 {ok:true}', 'FAIL',
      `exception: ${e instanceof Error ? e.message : String(e)}`)
  }

  // ----------------------------------------------------------------------
  // 验证 17: DELETE_404 - DELETE s5-test-pure（已删）→ 404
  // ----------------------------------------------------------------------
  console.log('--- 验证 17: DELETE_404 ---')
  try {
    const r = await fetchJson<any>('DELETE', '/api/dynamic-widgets/s5-test-pure')
    if (r.status === 404) {
      record('17', 'DELETE_404 - 已删组件返回 404', 'PASS',
        `status=${r.status}, body=${JSON.stringify(r.data)}`)
    } else {
      record('17', 'DELETE_404 - 已删组件返回 404', 'FAIL',
        `expected 404, got status=${r.status}, body=${JSON.stringify(r.data)}`)
    }
  } catch (e) {
    record('17', 'DELETE_404 - 已删组件返回 404', 'FAIL',
      `exception: ${e instanceof Error ? e.message : String(e)}`)
  }

  // ======================================================================
  // 清理：删除剩余测试组件（s5-test-ws-broadcast, s5-test-sanitization 等）
  // ======================================================================
  console.log('')
  console.log('--- 清理测试数据 ---')
  const cleanupWidgetTypes = [
    's5-test-pure',              // 可能已删，保险
    's5-test-desktop-only',      // 可能已删，保险
    's5-test-ws-broadcast',
    's5-test-sanitization',
    's5-test-put-ws',            // 用例 20 创建
    's5-test-invalid-env',       // 校验失败的不会创建，保险
    's5-test-invalid-services',  // 校验失败的不会创建，保险
    's5-test-invalid-bool',      // 校验失败的不会创建，保险
  ]
  for (const wt of cleanupWidgetTypes) {
    try {
      await fetchJson('DELETE', `/api/dynamic-widgets/${wt}`)
    } catch {
      // ignore
    }
  }
  // 也清理 component_capabilities 残留（dynamic_widgets 删了但 cap 没同步的极端情况）
  try {
    await pool.query(
      `DELETE FROM component_capabilities WHERE widget_type LIKE 's5-test-%'`,
    )
  } catch {
    // ignore
  }

  // 关闭 PG 连接池
  try {
    await pool.end()
  } catch {
    // ignore
  }

  // ======================================================================
  // 汇总报告
  // ======================================================================
  console.log('')
  console.log('=== 验证汇总 ===')
  const passed = results.filter((r) => r.status === 'PASS').length
  const failed = results.filter((r) => r.status === 'FAIL').length
  const skipped = results.filter((r) => r.status === 'SKIP').length
  console.log('========================================')
  console.log(`Phase S5 运行时验证结果：${passed}/${results.length} 项通过（${skipped} 项跳过，${failed} 项失败）`)
  console.log('========================================')
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
