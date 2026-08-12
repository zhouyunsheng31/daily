// 快速验证秘塔搜索 API
import { callMetaso } from '../src/utils/searchApi.js'

console.log('=== Metaso API Test ===\n')

// Test 1: empty key should throw
console.log('[Test 1] Empty key should throw')
try {
  await callMetaso({ query: 'test' }, '')
  console.log('  FAIL: should have thrown')
} catch (e) {
  const msg = e instanceof Error ? e.message : String(e)
  console.log('  OK:', msg)
}

// Test 2: invalid key should throw
console.log('\n[Test 2] Invalid key should throw')
try {
  await callMetaso({ query: 'test' }, 'mk-test-invalid-key')
  console.log('  FAIL: should have thrown')
} catch (e) {
  const msg = e instanceof Error ? e.message : String(e)
  console.log('  OK:', msg)
}

console.log('\nDone. Metaso API code is ready.')
console.log('To test with real API key: set METASO_KEY env var and run this test.')