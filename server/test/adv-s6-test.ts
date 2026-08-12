// Phase S6 对抗性测试：覆盖 SQL 注入、CRLF 注入、超大 body、并发心跳、
// 路径遍历、路由参数边界、WS 鉴权、心跳定时任务副作用、重复注销、多设备同名服务
import { WebSocket } from 'ws'

const BASE = 'http://localhost:3458'
const WS_URL = 'ws://localhost:3458/ws'

let pass = 0
let fail = 0
const failures: string[] = []

function ok(name: string, cond: boolean, detail = ''): void {
  if (cond) {
    pass++
    console.log(`  ✅ ${name}${detail ? ' — ' + detail : ''}`)
  } else {
    fail++
    failures.push(name + (detail ? ' — ' + detail : ''))
    console.log(`  ❌ ${name}${detail ? ' — ' + detail : ''}`)
  }
}

async function json(path: string, init?: RequestInit): Promise<{ status: number; body: any; headers: Record<string, string> }> {
  const res = await fetch(`${BASE}${path}`, init)
  const text = await res.text()
  let body: any = text
  try { body = JSON.parse(text) } catch { /* keep text */ }
  const headers: Record<string, string> = {}
  res.headers.forEach((v, k) => { headers[k] = v })
  return { status: res.status, body, headers }
}

async function wsConnect(deviceId?: string, timeoutMs = 3000): Promise<{ ws: WebSocket; ok: boolean; closeCode?: number; closeReason?: string }> {
  const url = deviceId ? `${WS_URL}?deviceId=${encodeURIComponent(deviceId)}` : WS_URL
  const ws = new WebSocket(url)
  let opened = false
  let closeCode: number | undefined
  let closeReason: string | undefined
  await new Promise<void>((resolve) => {
    ws.on('open', () => { opened = true; resolve() })
    ws.on('close', (code, reason) => { closeCode = code; closeReason = reason.toString(); resolve() })
    ws.on('error', () => resolve())
    setTimeout(resolve, timeoutMs)
  })
  return { ws, ok: opened, closeCode, closeReason }
}

async function main(): Promise<void> {
  console.log('\n=== Phase S6 对抗性测试 ===\n')

  const DEVICE_A = 'adv-dev-a'
  const DEVICE_B = 'adv-dev-b'

  // 清理残留
  for (const d of [DEVICE_A, DEVICE_B]) {
    await json('/api/local-services/unregister', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Device-Id': d },
      body: JSON.stringify({ serviceNames: ['local-notes', 'inject-test', 'multi-svc', 'big-svc', 'dup-svc'] }),
    })
  }

  // ==========================================================================
  // 1. SERVER_TOKEN 留空（开发模式）：所有 API 都能访问
  // ==========================================================================
  console.log('[1] SERVER_TOKEN 留空 — 开发模式无鉴权')
  const healthRes = await json('/api/health')
  ok('health 可访问', healthRes.status === 200, `status=${healthRes.status}`)
  const listRes = await json('/api/local-services/list')
  ok('list 可访问（无 token）', listRes.status === 200, `status=${listRes.status}`)
  const regRes = await json('/api/local-services/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Device-Id': DEVICE_A },
    body: JSON.stringify({ serviceName: 'local-notes', endpoint: 'http://localhost:3001' }),
  })
  ok('register 可访问（无 token）', regRes.status === 201, `status=${regRes.status}`)

  // 代理路由也无鉴权
  const proxyNoToken = await json(`/proxy/${DEVICE_A}/local-notes/api/x`, {
    method: 'GET',
    headers: { 'X-Device-Id': DEVICE_B },
  })
  // 在线但 WS 断 → 503，不是 401
  ok('proxy 无 token 也能透到业务层（不是 401）',
    proxyNoToken.status === 503 || proxyNoToken.status === 504,
    `status=${proxyNoToken.status}`)

  // ==========================================================================
  // 2. SQL 注入尝试：serviceName 含恶意 payload
  // ==========================================================================
  console.log('\n[2] SQL 注入尝试 — 参数化查询应挡住')
  const sqlPayloads = [
    `' OR 1=1--`,
    `'; DROP TABLE local_service_registry;--`,
    `local-notes'; DELETE FROM local_service_registry WHERE '1'='1`,
    `local-notes UNION SELECT * FROM users--`,
  ]
  let sqlInjectBlocked = true
  let tableStillExists = true
  for (const p of sqlPayloads) {
    const r = await json('/api/local-services/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Device-Id': DEVICE_A },
      body: JSON.stringify({ serviceName: p, endpoint: 'http://localhost:9999' }),
    })
    // 参数化查询下， serviceName 会被原样插入；不会执行 SQL
    if (r.status !== 201) {
      sqlInjectBlocked = false
      console.log(`    payload "${p}" → status=${r.status}, body=${JSON.stringify(r.body)}`)
    }
  }
  // 验证表还在（注入没生效）
  const stillThere = await json('/api/local-services/list')
  if (stillThere.status !== 200 || !Array.isArray(stillThere.body)) {
    tableStillExists = false
  }
  ok('SQL 注入 payload 被参数化查询挡住（注册成功但表完好）',
    sqlInjectBlocked && tableStillExists,
    `sqlInjectBlocked=${sqlInjectBlocked} tableStillExists=${tableStillExists}`)

  // 注入后这些恶意 serviceName 也应该能被 unregister 清理
  for (const p of sqlPayloads) {
    await json('/api/local-services/unregister', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Device-Id': DEVICE_A },
      body: JSON.stringify({ serviceName: p }),
    })
  }

  // ==========================================================================
  // 3. Header 注入尝试：CRLF 字符
  // ==========================================================================
  console.log('\n[3] CRLF Header 注入尝试')
  // X-Device-Id 含 \r\n 应被 Node.js HTTP 解析层挡住（fetch 不允许）
  let crlfRejected = false
  try {
    await json('/api/local-services/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Device-Id': 'dev\r\nX-Inject: evil' },
      body: JSON.stringify({ serviceName: 'x', endpoint: 'http://localhost:1' }),
    })
  } catch (e) {
    crlfRejected = true
  }
  ok('CRLF 在 X-Device-Id 中被 fetch/HTTP 拦截', crlfRejected, `rejected=${crlfRejected}`)

  // ==========================================================================
  // 4. 超大 body：1MB register body
  // ==========================================================================
  console.log('\n[4] 超大 body — express.json limit')
  // index.ts 设置 express.json({ limit: '100mb' })，1MB 应该被接受
  // 但我们要测试更激进的：构造 200MB body 验证 limit 生效
  const hugeStr = 'x'.repeat(200 * 1024 * 1024)  // 200MB
  const hugeStart = Date.now()
  let hugeResult: { status: number; body: any } | null = null
  try {
    hugeResult = await json('/api/local-services/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Device-Id': DEVICE_A },
      body: JSON.stringify({ serviceName: 'big-svc', endpoint: 'http://localhost:1', description: hugeStr }),
    })
  } catch (e) {
    console.log(`    200MB body 抛异常: ${(e as Error).message}`)
  }
  const hugeElapsed = Date.now() - hugeStart
  // 100mb limit 应该挡掉 200MB
  ok('200MB body 被拒绝或抛错（limit 生效）',
    hugeResult === null || hugeResult.status === 413 || hugeResult.status === 400,
    `status=${hugeResult?.status} elapsed=${hugeElapsed}ms`)

  // 1MB body 应该被接受
  const mediumStr = 'x'.repeat(1024 * 1024)  // 1MB
  const mediumRes = await json('/api/local-services/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Device-Id': DEVICE_A },
    body: JSON.stringify({ serviceName: 'big-svc', endpoint: 'http://localhost:1', description: mediumStr }),
  })
  ok('1MB body 被接受（100mb limit）', mediumRes.status === 201, `status=${mediumRes.status}`)

  // 清理
  await json('/api/local-services/unregister', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Device-Id': DEVICE_A },
    body: JSON.stringify({ serviceName: 'big-svc' }),
  })

  // ==========================================================================
  // 5. 并发心跳：同时 10 个心跳请求
  // ==========================================================================
  console.log('\n[5] 并发心跳 — 10 个并行请求')
  // 先注册 10 个服务
  for (let i = 0; i < 10; i++) {
    await json('/api/local-services/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Device-Id': DEVICE_A },
      body: JSON.stringify({ serviceName: `multi-svc-${i}`, endpoint: `http://localhost:${3000 + i}` }),
    })
  }
  const hbStart = Date.now()
  const hbPromises: Promise<{ status: number; body: any }>[] = []
  for (let i = 0; i < 10; i++) {
    hbPromises.push(json('/api/local-services/heartbeat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Device-Id': DEVICE_A },
      body: JSON.stringify({ serviceName: `multi-svc-${i}` }),
    }))
  }
  const hbResults = await Promise.all(hbPromises)
  const hbElapsed = Date.now() - hbStart
  const allOk = hbResults.every(r => r.status === 200 && r.body?.ok === true)
  ok('10 个并发心跳全部 200', allOk, `elapsed=${hbElapsed}ms`)
  ok('并发心跳无 500/超时', !hbResults.some(r => r.status >= 500), `statuses=${[...new Set(hbResults.map(r => r.status))].join(',')}`)

  // 清理
  const serviceNames = Array.from({ length: 10 }, (_, i) => `multi-svc-${i}`)
  await json('/api/local-services/unregister', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Device-Id': DEVICE_A },
    body: JSON.stringify({ serviceNames }),
  })

  // ==========================================================================
  // 6. 路径遍历：/proxy/:deviceId/:serviceName/../../etc/passwd
  // ==========================================================================
  console.log('\n[6] 路径遍历尝试')
  // Express 5 的 *path 通配符会把 ../../etc/passwd 作为 path 透传给桌面端
  // 但 server 不应直接访问文件系统
  const traversalRes = await json(`/proxy/${DEVICE_A}/local-notes/../../etc/passwd`, {
    method: 'GET',
    headers: { 'X-Device-Id': DEVICE_B },
  })
  // 应返回 503（服务在线但 WS 断）或 504，不应该是 200 + 文件内容
  ok('路径遍历被路由层挡住（不返回 /etc/passwd 内容）',
    traversalRes.status === 503 || traversalRes.status === 504,
    `status=${traversalRes.status}`)
  ok('响应 body 不含 root:', !String(traversalRes.body).includes('root:'), `body=${JSON.stringify(traversalRes.body).slice(0, 100)}`)

  // ==========================================================================
  // 7. 不存在的 endpoint 路径：缺 serviceName
  // ==========================================================================
  console.log('\n[7] 路由参数缺失 — /proxy/only-device-id')
  // /proxy/only-device-id 只匹配 :deviceId，没有 :serviceName，无 *path
  // 应该 404（不匹配 /:deviceId/:serviceName 和 /:deviceId/:serviceName/*path）
  const missPath = await json('/proxy/only-device-id', {
    method: 'GET',
    headers: { 'X-Device-Id': DEVICE_B },
  })
  ok('/proxy/:deviceId（缺 serviceName）404 而非 500', missPath.status === 404, `status=${missPath.status}`)

  // /proxy/ 也应 404
  const emptyPath = await json('/proxy/', {
    method: 'GET',
    headers: { 'X-Device-Id': DEVICE_B },
  })
  ok('/proxy/ 空 404', emptyPath.status === 404, `status=${emptyPath.status}`)

  // ==========================================================================
  // 8. WS 鉴权：无 deviceId 连 WS 应被拒
  // ==========================================================================
  console.log('\n[8] WS 鉴权 — 无 deviceId 应被拒')
  const noDevWs = await wsConnect(undefined)
  ok('WS 无 deviceId 被拒（连接未 open）', !noDevWs.ok, `opened=${noDevWs.ok} closeCode=${noDevWs.closeCode}`)
  if (noDevWs.ok) noDevWs.ws.close()

  // ==========================================================================
  // 9. 心跳定时任务副作用 — 不应误标记刚注册的服务为离线
  // ==========================================================================
  console.log('\n[9] 心跳定时任务边界 — 刚注册的服务不应被标记离线')
  // 注册一个新服务，立即检查定时任务 SQL 是否会误伤
  const freshReg = await json('/api/local-services/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Device-Id': DEVICE_A },
    body: JSON.stringify({ serviceName: 'fresh-svc', endpoint: 'http://localhost:3001' }),
  })
  ok('fresh-svc 注册成功', freshRes_status_ok(freshReg), `status=${freshReg.status}`)

  // 直接调用定时任务的 SQL，确认不会标记 fresh-svc
  // 模拟定时任务的 SQL（与 index.ts 一致）
  const pg = await import('pg')
  const pool = new pg.Pool({
    host: 'localhost', port: 5432,
    user: 'livingdashboard', password: 'livingdashboard',
    database: 'living_dashboard',
  })
  const now = Date.now()
  // 故意把阈值改成 now-1ms（极端边界，但 fresh-svc.last_heartbeat 应该 ≥ now-100ms）
  const boundaryResult = await pool.query(
    'UPDATE local_service_registry SET online = false, updated_at = $1 WHERE online = true AND last_heartbeat < $2 RETURNING service_name',
    [now, now - 1],  // 1ms 阈值
  )
  // fresh-svc 的 last_heartbeat 应该刚刚更新（now），不应被 1ms 阈值误伤
  // 但实际中 PG 时钟精度可能有毫秒级抖动，所以我们再查一次 list 确认
  const listAfterBoundary = await json('/api/local-services/list')
  const freshStillOnline = Array.isArray(listAfterBoundary.body)
    && listAfterBoundary.body.some((s: any) => s.serviceName === 'fresh-svc' && s.deviceId === DEVICE_A)
  ok('fresh-svc 不被 1ms 边界定时任务误标记为离线',
    freshStillOnline,
    `boundaryAffected=${boundaryResult.rowCount} freshStillOnline=${freshStillOnline}`)

  // 清理 fresh-svc
  await json('/api/local-services/unregister', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Device-Id': DEVICE_A },
    body: JSON.stringify({ serviceName: 'fresh-svc' }),
  })

  // ==========================================================================
  // 10. 重复 unregister 同一服务
  // ==========================================================================
  console.log('\n[10] 重复 unregister — 第二次 deleted=0 不报错')
  // 先注册再注销
  await json('/api/local-services/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Device-Id': DEVICE_A },
    body: JSON.stringify({ serviceName: 'dup-svc', endpoint: 'http://localhost:3001' }),
  })
  const unreg1 = await json('/api/local-services/unregister', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Device-Id': DEVICE_A },
    body: JSON.stringify({ serviceName: 'dup-svc' }),
  })
  ok('第一次 unregister 200 deleted=1', unreg1.status === 200 && unreg1.body?.deleted === 1, `status=${unreg1.status} deleted=${unreg1.body?.deleted}`)

  const unreg2 = await json('/api/local-services/unregister', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Device-Id': DEVICE_A },
    body: JSON.stringify({ serviceName: 'dup-svc' }),
  })
  ok('第二次 unregister 200 deleted=0（不报错）',
    unreg2.status === 200 && unreg2.body?.deleted === 0,
    `status=${unreg2.status} deleted=${unreg2.body?.deleted}`)

  // ==========================================================================
  // 11. 多设备同名服务互不影响
  // ==========================================================================
  console.log('\n[11] 多设备同名服务互不影响')
  const regA = await json('/api/local-services/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Device-Id': DEVICE_A },
    body: JSON.stringify({ serviceName: 'shared-notes', endpoint: 'http://localhost:4001' }),
  })
  const regB = await json('/api/local-services/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Device-Id': DEVICE_B },
    body: JSON.stringify({ serviceName: 'shared-notes', endpoint: 'http://localhost:4002' }),
  })
  ok('DEVICE_A 注册 shared-notes', regA.status === 201, `status=${regA.status}`)
  ok('DEVICE_B 注册 shared-notes（同名不冲突）', regB.status === 201, `status=${regB.status}`)
  ok('两个设备 endpoint 不同',
    regA.body?.endpoint === 'http://localhost:4001' && regB.body?.endpoint === 'http://localhost:4002',
    `A=${regA.body?.endpoint} B=${regB.body?.endpoint}`)

  // 注销 A 的不影响 B
  await json('/api/local-services/unregister', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Device-Id': DEVICE_A },
    body: JSON.stringify({ serviceName: 'shared-notes' }),
  })
  const listB = await json(`/api/local-services/list/${DEVICE_B}`)
  ok('注销 DEVICE_A 不影响 DEVICE_B 的 shared-notes',
    Array.isArray(listB.body) && listB.body.some((s: any) => s.serviceName === 'shared-notes' && s.deviceId === DEVICE_B),
    `len=${listB.body?.length}`)

  // 清理
  await json('/api/local-services/unregister', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Device-Id': DEVICE_B },
    body: JSON.stringify({ serviceName: 'shared-notes' }),
  })

  // ==========================================================================
  // 12. 不匹配 requestId 的 proxy_response（错误 requestId）应静默丢弃不崩溃
  // ==========================================================================
  console.log('\n[12] 不匹配 requestId 的 proxy_response 静默丢弃')
  // 连一个 WS，发个错误的 proxy_response
  const wsAdv = await wsConnect(DEVICE_A)
  ok('WS 连接成功', wsAdv.ok, `opened=${wsAdv.ok}`)

  let serverStillAlive = true
  try {
    wsAdv.ws.send(JSON.stringify({
      kind: 'proxy_response',
      requestId: 'nonexistent-request-id-xxxxx',
      status: 200,
      headers: {},
      body: 'fake',
    }))
    // 等 500ms 看服务器是否崩溃
    await new Promise(r => setTimeout(r, 500))
    // 检查 health
    const healthAfter = await json('/api/health')
    serverStillAlive = healthAfter.status === 200
  } catch (e) {
    serverStillAlive = false
  }
  ok('不匹配 requestId 不导致服务器崩溃', serverStillAlive, `alive=${serverStillAlive}`)
  wsAdv.ws.close()

  // ==========================================================================
  // 13. 错误 requestId 不影响后续正常请求
  // ==========================================================================
  console.log('\n[13] 错误 requestId 后正常代理请求仍能成功')
  // 启动一个 mock 桌面端 WS 客户端，正常回 proxy_response
  const wsMock = await wsConnect(DEVICE_A)
  ok('WS mock 连接成功', wsMock.ok, `opened=${wsMock.ok}`)

  // 先发个错误的 proxy_response（应该被丢弃）
  wsMock.ws.send(JSON.stringify({
    kind: 'proxy_response',
    requestId: 'still-wrong-id',
    status: 200,
    headers: {},
    body: 'fake',
  }))

  // 然后正常处理 proxy_request
  let mockGotRequest = false
  wsMock.ws.on('message', (raw: Buffer) => {
    try {
      const msg = JSON.parse(raw.toString())
      if (msg.kind === 'proxy_request') {
        mockGotRequest = true
        wsMock.ws.send(JSON.stringify({
          kind: 'proxy_response',
          requestId: msg.requestId,
          status: 200,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ ok: true }),
        }))
      }
    } catch { /* ignore */ }
  })
  await new Promise(r => setTimeout(r, 500))

  // 触发代理请求
  const proxyAfterBad = await json(`/proxy/${DEVICE_A}/local-notes/api/x`, {
    method: 'GET',
    headers: { 'X-Device-Id': DEVICE_B },
  })
  ok('错误 requestId 后正常代理请求仍 200',
    proxyAfterBad.status === 200 && proxyAfterBad.body?.ok === true,
    `status=${proxyAfterBad.status} mockGot=${mockGotRequest}`)
  wsMock.ws.close()

  // ==========================================================================
  // 14. 心跳定时任务 SQL 检查 — 只更新 online=true 的
  // ==========================================================================
  console.log('\n[14] 心跳定时任务 SQL — 只更新 online=true 的记录')
  // 故意把一个服务标记 online=false，再调定时任务 SQL，验证不会被错误地更新
  await json('/api/local-services/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Device-Id': DEVICE_A },
    body: JSON.stringify({ serviceName: 'offline-svc', endpoint: 'http://localhost:3001' }),
  })
  // 手动设为 offline + 老 heartbeat
  await pool.query(
    `UPDATE local_service_registry SET online = false, last_heartbeat = $1 WHERE device_id = $2 AND service_name = 'offline-svc'`,
    [Date.now() - 600_000, DEVICE_A],  // 10 分钟前
  )
  // 调定时任务 SQL（应该跳过这个 online=false 的记录，因为 WHERE online = true）
  const cleanupResult = await pool.query(
    'UPDATE local_service_registry SET online = false, updated_at = $1 WHERE online = true AND last_heartbeat < $2 RETURNING service_name',
    [Date.now(), Date.now() - 60_000],
  )
  // offline-svc 不在结果中（因为它的 online=false，被 WHERE 跳过）
  ok('心跳定时任务只更新 online=true 的记录',
    !cleanupResult.rows.some((r: any) => r.service_name === 'offline-svc'),
    `affected=${cleanupResult.rowCount}`)

  // 清理
  await json('/api/local-services/unregister', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Device-Id': DEVICE_A },
    body: JSON.stringify({ serviceName: 'offline-svc' }),
  })

  // ==========================================================================
  // 15. heartbeat 缺 X-Device-Id 应 400
  // ==========================================================================
  console.log('\n[15] heartbeat / unregister 缺 X-Device-Id')
  const hbNoDev = await json('/api/local-services/heartbeat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ serviceName: 'x' }),
  })
  ok('heartbeat 缺 X-Device-Id 400', hbNoDev.status === 400, `status=${hbNoDev.status}`)

  const unregNoDev = await json('/api/local-services/unregister', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ serviceName: 'x' }),
  })
  ok('unregister 缺 X-Device-Id 400', unregNoDev.status === 400, `status=${unregNoDev.status}`)

  // 最终清理
  await pool.query(`DELETE FROM local_service_registry WHERE device_id IN ($1, $2)`, [DEVICE_A, DEVICE_B])
  await pool.end()

  // ==========================================================================
  // 总结
  // ==========================================================================
  console.log('\n=== Phase S6 对抗性测试总结 ===')
  console.log(`  通过: ${pass}`)
  console.log(`  失败: ${fail}`)
  if (fail > 0) {
    console.log('  失败项:')
    failures.forEach((f) => console.log(`    - ${f}`))
    process.exit(1)
  } else {
    console.log('  ✅ 全部通过')
    process.exit(0)
  }
}

function freshRes_status_ok(r: { status: number; body: any }): boolean {
  return r.status === 201
}

main().catch((err) => {
  console.error('Adv test script crashed:', err)
  process.exit(2)
})
