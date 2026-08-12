// ============================================================================
// 通过服务器 API 测试搜索工具
// 运行：cd f:\allmylife\event\server && node test/search-via-server-api.mjs
// ============================================================================

const baseUrl = 'http://localhost:3456'

console.log('='.repeat(80))
console.log('通过服务器 API 测试搜索工具')
console.log('='.repeat(80))

async function test() {
  // 1. Health check
  console.log('\n[1/4] 健康检查...')
  try {
    const res = await fetch(`${baseUrl}/api/health`)
    const data = await res.json()
    console.log('  ✓ 服务器运行正常:', data.status)
  } catch (e) {
    console.log('  ✗ 健康检查失败:', e.message)
  }

  // 2. Search keys status
  console.log('\n[2/4] 搜索 Key 状态...')
  try {
    const res = await fetch(`${baseUrl}/api/search/keys`)
    const data = await res.json()
    for (const p of data.providers) {
      const status = p.hasKey ? '✓ 已配置' : '✗ 未配置'
      const date = new Date(p.updatedAt).toLocaleString('zh-CN')
      console.log(`  ${p.provider}: ${status} (updated: ${date})`)
    }
  } catch (e) {
    console.log('  ✗ 获取 Key 状态失败:', e.message)
  }

  // 3. Test each provider key
  console.log('\n[3/4] 测试各搜索引擎 Key 有效性...')

  // Bocha
  console.log('\n  Bocha (网页搜索)...')
  try {
    const res = await fetch(`${baseUrl}/api/search/keys/bocha/test`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
    const data = await res.json()
    console.log('    结果:', JSON.stringify(data, null, 6).replace(/\n/g, '\n    '))
  } catch (e) {
    console.log('    错误:', e.message)
  }

  // Semantic Scholar
  console.log('\n  Semantic Scholar (学术搜索)...')
  try {
    const res = await fetch(`${baseUrl}/api/search/keys/semanticScholar/test`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
    const data = await res.json()
    console.log('    结果:', JSON.stringify(data, null, 6).replace(/\n/g, '\n    '))
  } catch (e) {
    console.log('    错误:', e.message)
  }

  // GitHub
  console.log('\n  GitHub...')
  try {
    const res = await fetch(`${baseUrl}/api/search/keys/github/test`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
    const data = await res.json()
    console.log('    结果:', JSON.stringify(data, null, 6).replace(/\n/g, '\n    '))
  } catch (e) {
    console.log('    错误:', e.message)
  }

  console.log('\n' + '='.repeat(80))
  console.log('测试完成')
  console.log('='.repeat(80))
}

test().catch(console.error)
