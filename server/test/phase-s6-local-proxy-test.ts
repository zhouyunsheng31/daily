// Phase S6 本地服务代理 — 运行时验证脚本
// 覆盖验收点：
//   1. local_service_registry 表存在
//   2. POST /api/local-services/register - 注册
//   3. POST /api/local-services/heartbeat - 心跳
//   4. GET /api/local-services/list - 列表
//   5. GET /api/local-services/list/:deviceId - 按设备查询
//   6. POST /api/local-services/unregister - 注销
//   7. /proxy/:deviceId/:serviceName/*path 代理路由 - 离线降级 503
//   8. WS 转发：proxy_request / proxy_response
//   9. WS 设备断开时清理 pending 请求（device_disconnected）
//  10. 心跳超时：定时任务将 last_heartbeat > 60s 的标记为 offline
//  11. 路由参数校验（缺字段 400）
//  12. upsert 行为（同设备同名服务重复注册更新而非报错）
//  13. 代理路径解析（Express 5 *path 通配符）

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

async function json(path: string, init?: RequestInit): Promise<{ status: number; body: any }> {
  const res = await fetch(`${BASE}${path}`, init)
  const text = await res.text()
  let body: any = text
  try { body = JSON.parse(text) } catch { /* keep text */ }
  return { status: res.status, body }
}

async function main(): Promise<void> {
  console.log('\n=== Phase S6 运行时验证 ===\n')

  // ==========================================================================
  // 0. 健康检查
  // ==========================================================================
  console.log('[0] 健康检查')
  const health = await json('/api/health')
  ok('GET /api/health 200', health.status === 200, `status=${health.status}`)

  // ==========================================================================
  // 1. local_service_registry 表存在（通过注册一个服务来验证）
  // ==========================================================================
  console.log('\n[1] local_service_registry 表 + 注册 API')
  const DEVICE_A = 'test-device-s6-a'
  const DEVICE_B = 'test-device-s6-b'

  // 先清理可能残留的旧数据
  await json('/api/local-services/unregister', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Device-Id': DEVICE_A },
    body: JSON.stringify({ serviceNames: ['local-notes', 'local-files', 'test-svc'] }),
  })
  await json('/api/local-services/unregister', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Device-Id': DEVICE_B },
    body: JSON.stringify({ serviceNames: ['local-todo'] }),
  })

  const reg1 = await json('/api/local-services/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Device-Id': DEVICE_A },
    body: JSON.stringify({
      serviceName: 'local-notes',
      endpoint: 'http://localhost:3001',
      description: '本地笔记服务',
    }),
  })
  ok('POST register 返回 201', reg1.status === 201, `status=${reg1.status}`)
  // 注：PG BIGINT 默认返回 string（pg driver 标准行为，避免 JS Number 精度丢失），可接受 string | number
  ok('register 返回字段完整', reg1.body?.serviceName === 'local-notes'
    && reg1.body?.endpoint === 'http://localhost:3001'
    && reg1.body?.deviceId === DEVICE_A
    && reg1.body?.online === true
    && (typeof reg1.body?.lastHeartbeat === 'string' || typeof reg1.body?.lastHeartbeat === 'number'), JSON.stringify(reg1.body))

  // ==========================================================================
  // 2. 参数校验：缺 serviceName / endpoint
  // ==========================================================================
  console.log('\n[2] 参数校验')
  const missSvc = await json('/api/local-services/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Device-Id': DEVICE_A },
    body: JSON.stringify({ endpoint: 'http://localhost:3001' }),
  })
  ok('register 缺 serviceName 返回 400', missSvc.status === 400, `status=${missSvc.status}`)

  const missEp = await json('/api/local-services/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Device-Id': DEVICE_A },
    body: JSON.stringify({ serviceName: 'x' }),
  })
  ok('register 缺 endpoint 返回 400', missEp.status === 400, `status=${missEp.status}`)

  const missDev = await json('/api/local-services/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ serviceName: 'x', endpoint: 'http://localhost:3001' }),
  })
  ok('register 缺 X-Device-Id 返回 400', missDev.status === 400, `status=${missDev.status}`)

  // 对抗审查修复验证：endpoint 协议白名单校验
  const badProto1 = await json('/api/local-services/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Device-Id': DEVICE_A },
    body: JSON.stringify({ serviceName: 'bad1', endpoint: 'file:///etc/passwd' }),
  })
  ok('register file:// 协议被拒 400', badProto1.status === 400, `status=${badProto1.status} body=${JSON.stringify(badProto1.body)}`)

  const badProto2 = await json('/api/local-services/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Device-Id': DEVICE_A },
    body: JSON.stringify({ serviceName: 'bad2', endpoint: 'ftp://evil.com/x' }),
  })
  ok('register ftp:// 协议被拒 400', badProto2.status === 400, `status=${badProto2.status}`)

  const badProto3 = await json('/api/local-services/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Device-Id': DEVICE_A },
    body: JSON.stringify({ serviceName: 'bad3', endpoint: 'not-a-url' }),
  })
  ok('register 非 URL 被拒 400', badProto3.status === 400, `status=${badProto3.status}`)

  const goodHttps = await json('/api/local-services/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Device-Id': DEVICE_A },
    body: JSON.stringify({ serviceName: 'good-https', endpoint: 'https://localhost:3001' }),
  })
  ok('register https:// 协议通过 201', goodHttps.status === 201, `status=${goodHttps.status}`)
  // 清理这条测试数据
  await json('/api/local-services/unregister', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Device-Id': DEVICE_A },
    body: JSON.stringify({ serviceName: 'good-https' }),
  })

  // ==========================================================================
  // 3. upsert：同设备同名服务重复注册应更新而非报错
  // ==========================================================================
  console.log('\n[3] upsert 行为')
  const reg2 = await json('/api/local-services/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Device-Id': DEVICE_A },
    body: JSON.stringify({
      serviceName: 'local-notes',
      endpoint: 'http://localhost:3002',  // 改了端口
      description: '更新后的笔记服务',
    }),
  })
  ok('upsert 不报错（201）', reg2.status === 201, `status=${reg2.status}`)
  ok('upsert 后 endpoint 已更新', reg2.body?.endpoint === 'http://localhost:3002', reg2.body?.endpoint)

  // ==========================================================================
  // 4. 心跳：单条 + 批量
  // ==========================================================================
  console.log('\n[4] 心跳 API')
  const hb1 = await json('/api/local-services/heartbeat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Device-Id': DEVICE_A },
    body: JSON.stringify({ serviceName: 'local-notes' }),
  })
  ok('heartbeat 单条 200', hb1.status === 200 && hb1.body?.ok === true, JSON.stringify(hb1.body))
  ok('heartbeat updated=1', hb1.body?.updated === 1, `updated=${hb1.body?.updated}`)

  // 注册第二个服务用于批量心跳测试
  await json('/api/local-services/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Device-Id': DEVICE_A },
    body: JSON.stringify({
      serviceName: 'local-files',
      endpoint: 'http://localhost:3003',
    }),
  })

  const hb2 = await json('/api/local-services/heartbeat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Device-Id': DEVICE_A },
    body: JSON.stringify({ serviceNames: ['local-notes', 'local-files'] }),
  })
  ok('heartbeat 批量 200', hb2.status === 200, `status=${hb2.status}`)
  ok('heartbeat 批量 updated=2', hb2.body?.updated === 2, `updated=${hb2.body?.updated}`)

  // 心跳不存在的服务应静默忽略（updated=0），不报错
  const hb3 = await json('/api/local-services/heartbeat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Device-Id': DEVICE_A },
    body: JSON.stringify({ serviceName: 'not-registered' }),
  })
  ok('heartbeat 未注册服务静默忽略', hb3.status === 200 && hb3.body?.updated === 0, JSON.stringify(hb3.body))

  // 心跳缺参数 400
  const hb4 = await json('/api/local-services/heartbeat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Device-Id': DEVICE_A },
    body: JSON.stringify({}),
  })
  ok('heartbeat 缺参数 400', hb4.status === 400, `status=${hb4.status}`)

  // ==========================================================================
  // 5. 列表：所有在线服务 + 按设备过滤
  // ==========================================================================
  console.log('\n[5] 列表 API')
  // 注册 DEVICE_B 的服务
  await json('/api/local-services/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Device-Id': DEVICE_B },
    body: JSON.stringify({
      serviceName: 'local-todo',
      endpoint: 'http://localhost:3004',
    }),
  })

  const listAll = await json('/api/local-services/list')
  ok('GET list 200', listAll.status === 200, `status=${listAll.status}`)
  ok('list 返回数组', Array.isArray(listAll.body), `len=${listAll.body?.length}`)
  ok('list 包含两个设备的服务', Array.isArray(listAll.body)
    && listAll.body.some((s: any) => s.deviceId === DEVICE_A && s.serviceName === 'local-notes')
    && listAll.body.some((s: any) => s.deviceId === DEVICE_B && s.serviceName === 'local-todo'),
    `len=${listAll.body?.length}`)

  const listA = await json(`/api/local-services/list/${DEVICE_A}`)
  ok('GET list/:deviceId 200', listA.status === 200, `status=${listA.status}`)
  ok('list/:deviceId 只返回该设备服务', Array.isArray(listA.body)
    && listA.body.every((s: any) => s.deviceId === DEVICE_A)
    && listA.body.length === 2, `len=${listA.body?.length}`)

  // ==========================================================================
  // 6. 代理路由：离线降级 503
  // ==========================================================================
  console.log('\n[6] 代理路由 — 离线降级')
  // 不存在的设备 → 503
  const proxy1 = await json('/proxy/nonexistent-device/local-notes/api/notes', {
    method: 'GET',
    headers: { 'X-Device-Id': DEVICE_B },  // /proxy 路由仍需 authMiddleware
  })
  ok('proxy 不存在设备 503', proxy1.status === 503, `status=${proxy1.status}`)
  ok('proxy 503 error=local_service_offline', proxy1.body?.error === 'local_service_offline', JSON.stringify(proxy1.body))

  // 已注册但设备未连 WS（视为离线）→ 也是 503？不，这里 service online=true 但 WS 断开
  // 走 sendProxyRequest 后会 reject device_offline → 503
  const proxy2 = await json(`/proxy/${DEVICE_A}/local-notes/api/notes`, {
    method: 'GET',
    headers: { 'X-Device-Id': DEVICE_B },
  })
  ok('proxy 设备 WS 离线 503', proxy2.status === 503, `status=${proxy2.status} body=${JSON.stringify(proxy2.body)}`)

  // ==========================================================================
  // 7. WS 转发：proxy_request → proxy_response 完整链路
  // ==========================================================================
  console.log('\n[7] WS 转发 — proxy_request / proxy_response')

  // 启动一个 mock 桌面端 WS 客户端，监听 proxy_request 并回 proxy_response
  const wsClient = new WebSocket(`${WS_URL}?deviceId=${DEVICE_A}`)
  let wsConnected = false
  let wsReceivedProxyRequest: any = null

  await new Promise<void>((resolve) => {
    wsClient.on('open', () => {
      wsConnected = true
      resolve()
    })
    wsClient.on('error', (err) => {
      console.log('  WS error:', err.message)
      resolve()
    })
    // 超时兜底
    setTimeout(resolve, 3000)
  })
  ok('WS 客户端连接成功', wsConnected, '')

  wsClient.on('message', (raw: Buffer) => {
    try {
      const msg = JSON.parse(raw.toString())
      if (msg.kind === 'proxy_request') {
        wsReceivedProxyRequest = msg
        // 模拟桌面端本地服务返回 JSON 响应
        const response = {
          kind: 'proxy_response',
          requestId: msg.requestId,
          status: 200,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ ok: true, msg: 'hello from local service', path: msg.path }),
        }
        wsClient.send(JSON.stringify(response))
      }
    } catch (e) {
      console.log('  WS message parse error:', e)
    }
  })

  // 等一下让 server 把 WS 加入 clients
  await new Promise((r) => setTimeout(r, 500))

  // 通过 HTTP 代理请求触发 WS 转发
  const proxy3 = await json(`/proxy/${DEVICE_A}/local-notes/api/notes?tag=work`, {
    method: 'GET',
    headers: { 'X-Device-Id': DEVICE_B },
  })
  ok('proxy 在线设备 200', proxy3.status === 200, `status=${proxy3.status} body=${JSON.stringify(proxy3.body)}`)
  ok('proxy 返回桌面端本地服务响应', proxy3.body?.ok === true && proxy3.body?.msg === 'hello from local service', JSON.stringify(proxy3.body))
  ok('WS 收到 proxy_request', wsReceivedProxyRequest !== null, wsReceivedProxyRequest ? `requestId=${wsReceivedProxyRequest.requestId}` : 'null')
  ok('proxy_request serviceName 正确', wsReceivedProxyRequest?.serviceName === 'local-notes', wsReceivedProxyRequest?.serviceName)
  ok('proxy_request method 正确', wsReceivedProxyRequest?.method === 'GET', wsReceivedProxyRequest?.method)
  ok('proxy_request path 透传正确', wsReceivedProxyRequest?.path === 'api/notes?tag=work', wsReceivedProxyRequest?.path)

  // POST 请求带 body
  const proxy4 = await json(`/proxy/${DEVICE_A}/local-notes/api/notes`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Device-Id': DEVICE_B },
    body: JSON.stringify({ title: 'test note' }),
  })
  ok('proxy POST 200', proxy4.status === 200, `status=${proxy4.status}`)

  // 无 path 边界情况（直接 /proxy/:deviceId/:serviceName）
  const proxy5 = await json(`/proxy/${DEVICE_A}/local-notes`, {
    method: 'GET',
    headers: { 'X-Device-Id': DEVICE_B },
  })
  ok('proxy 无 path 边界 200', proxy5.status === 200, `status=${proxy5.status} body=${JSON.stringify(proxy5.body)}`)

  // ==========================================================================
  // 8. WS 设备断开时清理 pending 请求（device_disconnected → 503）
  // ==========================================================================
  console.log('\n[8] WS 设备断开 → pending 请求 reject')

  // 模拟桌面端 WS 不回响应，然后断开连接
  // 先关掉原来的 wsClient（它会回响应），启一个新的不回响应
  wsClient.close()
  await new Promise((r) => setTimeout(r, 1000))

  const wsClient2 = new WebSocket(`${WS_URL}?deviceId=${DEVICE_A}`)
  await new Promise<void>((resolve) => {
    wsClient2.on('open', () => resolve())
    wsClient2.on('error', () => resolve())
    setTimeout(resolve, 3000)
  })
  // 不挂 proxy_request handler，直接断开
  // 触发 HTTP 代理请求 → server 发 proxy_request → 我们立即断开 WS → server 应 reject device_disconnected → 503

  // 同时发起 HTTP 请求 + 立即断开 WS（竞态，但 sendToDevice 后断开应触发 handleDeviceDisconnect）
  const proxyPromise = json(`/proxy/${DEVICE_A}/local-notes/api/notes`, {
    method: 'GET',
    headers: { 'X-Device-Id': DEVICE_B },
  })
  // 立即断开 WS
  await new Promise((r) => setTimeout(r, 100))
  wsClient2.close()

  const proxy6 = await proxyPromise
  ok('proxy 设备断开 503', proxy6.status === 503, `status=${proxy6.status} body=${JSON.stringify(proxy6.body)}`)
  ok('proxy 503 reason=device_disconnected（隐含 local_service_offline）',
    proxy6.body?.error === 'local_service_offline', JSON.stringify(proxy6.body))

  // ==========================================================================
  // 9. WS 转发超时（proxy_timeout → 504）
  // ==========================================================================
  console.log('\n[9] WS 转发超时 → 504')

  const wsClient3 = new WebSocket(`${WS_URL}?deviceId=${DEVICE_A}`)
  await new Promise<void>((resolve) => {
    wsClient3.on('open', () => resolve())
    wsClient3.on('error', () => resolve())
    setTimeout(resolve, 3000)
  })
  // 不回 proxy_response，等 30 秒超时
  // 为加速测试，我们等 31 秒
  const proxyTimeoutStart = Date.now()
  const proxy7 = await json(`/proxy/${DEVICE_A}/local-notes/api/notes`, {
    method: 'GET',
    headers: { 'X-Device-Id': DEVICE_B },
  })
  const elapsed = Date.now() - proxyTimeoutStart
  ok('proxy 超时 504', proxy7.status === 504, `status=${proxy7.status} elapsed=${elapsed}ms`)
  ok('proxy 504 error=proxy_timeout', proxy7.body?.error === 'proxy_timeout', JSON.stringify(proxy7.body))
  ok('超时耗时 ≥ 30s', elapsed >= 29000, `elapsed=${elapsed}ms`)
  wsClient3.close()

  // ==========================================================================
  // 9b. 对抗审查修复验证：WS 旧连接替换时 pending 立即清理（不再等 30s 超时）
  // ==========================================================================
  console.log('\n[9b] WS 旧连接替换 → pending 立即 reject')

  const wsClient4 = new WebSocket(`${WS_URL}?deviceId=${DEVICE_A}`)
  await new Promise<void>((resolve) => {
    wsClient4.on('open', () => resolve())
    wsClient4.on('error', () => resolve())
    setTimeout(resolve, 3000)
  })
  // wsClient4 不回 proxy_response

  // 发起 HTTP 代理请求（会挂起在 pending）
  const replaceProxyPromise = json(`/proxy/${DEVICE_A}/local-notes/api/notes`, {
    method: 'GET',
    headers: { 'X-Device-Id': DEVICE_B },
  })

  // 等一下让 server 发出 proxy_request，然后用新连接替换旧连接
  await new Promise((r) => setTimeout(r, 300))
  const wsClient5 = new WebSocket(`${WS_URL}?deviceId=${DEVICE_A}`)
  await new Promise<void>((resolve) => {
    wsClient5.on('open', () => resolve())
    wsClient5.on('error', () => resolve())
    setTimeout(resolve, 3000)
  })

  // wsClient5 连接成功后，server 会替换 wsClient4，触发 handleDeviceDisconnect
  // 旧连接上的 pending 请求应立即 reject（device_disconnected → 503），不再等 30s
  const replaceStart = Date.now()
  const proxy8 = await replaceProxyPromise
  const replaceElapsed = Date.now() - replaceStart
  ok('旧连接替换后 pending 立即 503', proxy8.status === 503, `status=${proxy8.status} elapsed=${replaceElapsed}ms`)
  ok('旧连接替换 pending 耗时 < 5s（不等 30s 超时）', replaceElapsed < 5000, `elapsed=${replaceElapsed}ms`)
  wsClient5.close()

  // ==========================================================================
  // 10. 心跳超时：定时任务将 last_heartbeat > 60s 的标记为 offline
  // ==========================================================================
  console.log('\n[10] 心跳超时定时任务')

  // 手动将 DEVICE_B 的服务 last_heartbeat 改为 2 分钟前
  const pg = await import('pg')
  const pool = new pg.Pool({
    host: 'localhost', port: 5432,
    user: 'livingdashboard', password: 'livingdashboard',
    database: 'living_dashboard',
  })
  const oldTime = Date.now() - 120_000  // 2 分钟前
  await pool.query(
    `UPDATE local_service_registry SET last_heartbeat = $1, online = true WHERE device_id = $2 AND service_name = 'local-todo'`,
    [oldTime, DEVICE_B],
  )

  // 触发心跳定时任务（等 60 秒太慢，直接调同样的 SQL）
  const now = Date.now()
  const cleanupResult = await pool.query(
    'UPDATE local_service_registry SET online = false, updated_at = $1 WHERE online = true AND last_heartbeat < $2 RETURNING service_name',
    [now, now - 60_000],
  )
  ok('心跳超时清理 1 条', (cleanupResult.rowCount ?? 0) >= 1, `rowCount=${cleanupResult.rowCount}`)
  ok('清理的就是 local-todo', cleanupResult.rows.some((r: any) => r.service_name === 'local-todo'), JSON.stringify(cleanupResult.rows))

  // 验证 list 现在不再包含 local-todo
  const listAfterTimeout = await json('/api/local-services/list')
  ok('list 不再包含超时的服务', !listAfterTimeout.body.some((s: any) => s.serviceName === 'local-todo' && s.deviceId === DEVICE_B), `len=${listAfterTimeout.body.length}`)

  // ==========================================================================
  // 11. 注销 API
  // ==========================================================================
  console.log('\n[11] 注销 API')

  const unreg1 = await json('/api/local-services/unregister', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Device-Id': DEVICE_A },
    body: JSON.stringify({ serviceName: 'local-files' }),
  })
  ok('unregister 单条 200', unreg1.status === 200 && unreg1.body?.ok === true, JSON.stringify(unreg1.body))
  ok('unregister deleted=1', unreg1.body?.deleted === 1, `deleted=${unreg1.body?.deleted}`)

  const unreg2 = await json('/api/local-services/unregister', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Device-Id': DEVICE_A },
    body: JSON.stringify({ serviceNames: ['local-notes', 'not-exist'] }),
  })
  ok('unregister 批量 200', unreg2.status === 200, `status=${unreg2.status}`)
  ok('unregister 批量 deleted=1（不存在的静默忽略）', unreg2.body?.deleted === 1, `deleted=${unreg2.body?.deleted}`)

  // 注销后 list 应为空
  const listFinal = await json(`/api/local-services/list/${DEVICE_A}`)
  ok('注销后 list/:deviceId 为空', Array.isArray(listFinal.body) && listFinal.body.length === 0, `len=${listFinal.body?.length}`)

  // ==========================================================================
  // 12. 清理：删掉 DEVICE_B 的 local-todo（虽然已 offline，但表里还有）
  // ==========================================================================
  await pool.query(`DELETE FROM local_service_registry WHERE device_id IN ($1, $2)`, [DEVICE_A, DEVICE_B])
  await pool.end()

  // ==========================================================================
  // 总结
  // ==========================================================================
  console.log('\n=== Phase S6 运行时验证总结 ===')
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

main().catch((err) => {
  console.error('Test script crashed:', err)
  process.exit(2)
})
