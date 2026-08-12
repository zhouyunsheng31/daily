// 独立并发心跳测试 — 排除其他测试干扰
const BASE = 'http://localhost:3458'

async function json(path: string, init?: RequestInit): Promise<{ status: number; body: any }> {
  const res = await fetch(`${BASE}${path}`, init)
  const text = await res.text()
  let body: any = text
  try { body = JSON.parse(text) } catch { /* keep text */ }
  return { status: res.status, body }
}

async function main(): Promise<void> {
  console.log('=== independent concurrency test ===')

  const DEVICE = 'adv-conc-dev'

  // 清理
  await json('/api/local-services/unregister', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Device-Id': DEVICE },
    body: JSON.stringify({ serviceNames: Array.from({ length: 20 }, (_, i) => `svc-${i}`) }),
  })

  // 顺序注册 10 个服务
  console.log('registering 10 services...')
  for (let i = 0; i < 10; i++) {
    const r = await json('/api/local-services/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Device-Id': DEVICE },
      body: JSON.stringify({ serviceName: `svc-${i}`, endpoint: `http://localhost:${3000 + i}` }),
    })
    if (r.status !== 201) {
      console.log(`  register svc-${i} FAIL: status=${r.status} body=${JSON.stringify(r.body)}`)
    }
  }

  // 并发心跳 10 个
  console.log('concurrent 10 heartbeats...')
  const start = Date.now()
  const promises: Promise<{ status: number; body: any }>[] = []
  for (let i = 0; i < 10; i++) {
    promises.push(json('/api/local-services/heartbeat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Device-Id': DEVICE },
      body: JSON.stringify({ serviceName: `svc-${i}` }),
    }))
  }
  const results = await Promise.all(promises)
  const elapsed = Date.now() - start

  console.log(`elapsed=${elapsed}ms`)
  let fail10 = 0
  for (let i = 0; i < results.length; i++) {
    const r = results[i]
    if (r.status !== 200) {
      fail10++
      console.log(`  svc-${i}: status=${r.status} body=${JSON.stringify(r.body)}`)
    }
  }
  console.log(`10 concurrent: ${10 - fail10}/10 ok, ${fail10} failed`)

  // 注册额外 10 个服务（共 20）
  console.log('\nregistering 10 more services (total 20)...')
  for (let i = 10; i < 20; i++) {
    await json('/api/local-services/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Device-Id': DEVICE },
      body: JSON.stringify({ serviceName: `svc-${i}`, endpoint: `http://localhost:${3000 + i}` }),
    })
  }

  console.log('concurrent 20 heartbeats...')
  const start2 = Date.now()
  const promises2: Promise<{ status: number; body: any }>[] = []
  for (let i = 0; i < 20; i++) {
    promises2.push(json('/api/local-services/heartbeat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Device-Id': DEVICE },
      body: JSON.stringify({ serviceName: `svc-${i}` }),
    }))
  }
  const results2 = await Promise.all(promises2)
  const elapsed2 = Date.now() - start2

  console.log(`elapsed=${elapsed2}ms`)
  let fail20 = 0
  for (let i = 0; i < results2.length; i++) {
    const r = results2[i]
    if (r.status !== 200) {
      fail20++
      console.log(`  svc-${i}: status=${r.status} body=${JSON.stringify(r.body)}`)
    }
  }
  console.log(`20 concurrent: ${20 - fail20}/20 ok, ${fail20} failed`)

  // 清理
  await json('/api/local-services/unregister', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Device-Id': DEVICE },
    body: JSON.stringify({ serviceNames: Array.from({ length: 20 }, (_, i) => `svc-${i}`) }),
  })

  console.log('=== DONE ===')
}

main().catch(err => { console.error('crash:', err); process.exit(1) })
