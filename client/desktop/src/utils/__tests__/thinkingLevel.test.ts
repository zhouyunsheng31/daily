/**
 * thinkingLevel.ts 单元测试（Phase 9 批次 1 模块 5）
 *
 * 项目无 vitest，用简单断言 + node 执行：
 *   npx tsx client/desktop/src/utils/__tests__/thinkingLevel.test.ts
 *
 * 测试覆盖（任务要求 6 组）：
 * 1-4. mapThinkingLevelToPi 4 档 identity 映射
 * 5.   getThinkingLevelLabel 返回正确中文标签
 * 6.   getAvailableThinkingLevels 返回 4 个等级
 *
 * 额外覆盖：
 * - getThinkingLevelDescription 返回非空中文描述
 * - ThinkingLevel 常量对象值正确
 */
import {
  mapThinkingLevelToPi,
  getThinkingLevelLabel,
  getThinkingLevelDescription,
  getAvailableThinkingLevels,
  ThinkingLevel,
} from '../thinkingLevel'

let passed = 0
let failed = 0

function assertEqual<T>(actual: T, expected: T, message: string): void {
  const ok = actual === expected
  if (ok) {
    console.log(`  \u2713 ${message}`)
    passed++
  } else {
    console.error(`  \u2717 ${message} (expected: ${JSON.stringify(expected)}, actual: ${JSON.stringify(actual)})`)
    failed++
  }
}

function assert(condition: boolean, message: string): void {
  if (condition) {
    console.log(`  \u2713 ${message}`)
    passed++
  } else {
    console.error(`  \u2717 ${message}`)
    failed++
  }
}

// ============================================================================
// 测试组 1-4：mapThinkingLevelToPi identity 映射
// ============================================================================

console.log('\n[1-4] mapThinkingLevelToPi identity mapping:')

assertEqual(mapThinkingLevelToPi('minimal'), 'minimal', "mapThinkingLevelToPi('minimal') === 'minimal'")
assertEqual(mapThinkingLevelToPi('low'), 'low', "mapThinkingLevelToPi('low') === 'low'")
assertEqual(mapThinkingLevelToPi('medium'), 'medium', "mapThinkingLevelToPi('medium') === 'medium'")
assertEqual(mapThinkingLevelToPi('high'), 'high', "mapThinkingLevelToPi('high') === 'high'")

// 使用 ThinkingLevel 常量对象验证（具名引用）
assertEqual(mapThinkingLevelToPi(ThinkingLevel.MINIMAL), 'minimal', 'mapThinkingLevelToPi(ThinkingLevel.MINIMAL) === "minimal"')
assertEqual(mapThinkingLevelToPi(ThinkingLevel.LOW), 'low', 'mapThinkingLevelToPi(ThinkingLevel.LOW) === "low"')
assertEqual(mapThinkingLevelToPi(ThinkingLevel.MEDIUM), 'medium', 'mapThinkingLevelToPi(ThinkingLevel.MEDIUM) === "medium"')
assertEqual(mapThinkingLevelToPi(ThinkingLevel.HIGH), 'high', 'mapThinkingLevelToPi(ThinkingLevel.HIGH) === "high"')

// ============================================================================
// 测试组 5：getThinkingLevelLabel 返回正确中文标签
// ============================================================================

console.log('\n[5] getThinkingLevelLabel Chinese labels:')

assertEqual(getThinkingLevelLabel('minimal'), '极简', "getThinkingLevelLabel('minimal') === '极简'")
assertEqual(getThinkingLevelLabel('low'), '低', "getThinkingLevelLabel('low') === '低'")
assertEqual(getThinkingLevelLabel('medium'), '中', "getThinkingLevelLabel('medium') === '中'")
assertEqual(getThinkingLevelLabel('high'), '高', "getThinkingLevelLabel('high') === '高'")

// ============================================================================
// 测试组 6：getAvailableThinkingLevels 返回 4 个等级
// ============================================================================

console.log('\n[6] getAvailableThinkingLevels:')

const levels = getAvailableThinkingLevels()
assert(levels.length === 4, `getAvailableThinkingLevels().length === 4 (got ${levels.length})`)
assert(levels[0] === 'minimal', `levels[0] === 'minimal' (got ${levels[0]})`)
assert(levels[1] === 'low', `levels[1] === 'low' (got ${levels[1]})`)
assert(levels[2] === 'medium', `levels[2] === 'medium' (got ${levels[2]})`)
assert(levels[3] === 'high', `levels[3] === 'high' (got ${levels[3]})`)
assert(
  levels.includes('minimal') && levels.includes('low') && levels.includes('medium') && levels.includes('high'),
  'levels includes all 4 values',
)

// ============================================================================
// 额外测试：getThinkingLevelDescription 返回非空中文描述
// ============================================================================

console.log('\n[extra] getThinkingLevelDescription:')

const allLevels = ['minimal', 'low', 'medium', 'high'] as const
for (const lvl of allLevels) {
  const desc = getThinkingLevelDescription(lvl)
  assert(typeof desc === 'string' && desc.length > 0, `getThinkingLevelDescription('${lvl}') returns non-empty string`)
  // 验证是中文（含 CJK 字符）
  assert(/[\u4e00-\u9fff]/.test(desc), `getThinkingLevelDescription('${lvl}') contains CJK characters`)
}

// ============================================================================
// 额外测试：ThinkingLevel 常量对象值正确
// ============================================================================

console.log('\n[extra] ThinkingLevel constant object:')

assertEqual(ThinkingLevel.MINIMAL, 'minimal', 'ThinkingLevel.MINIMAL === "minimal"')
assertEqual(ThinkingLevel.LOW, 'low', 'ThinkingLevel.LOW === "low"')
assertEqual(ThinkingLevel.MEDIUM, 'medium', 'ThinkingLevel.MEDIUM === "medium"')
assertEqual(ThinkingLevel.HIGH, 'high', 'ThinkingLevel.HIGH === "high"')

// ============================================================================
// 结果汇总
// ============================================================================

console.log('\n========================================')
console.log(`  Result: ${passed} passed, ${failed} failed`)
console.log('========================================\n')

if (failed > 0) {
  process.exit(1)
}
