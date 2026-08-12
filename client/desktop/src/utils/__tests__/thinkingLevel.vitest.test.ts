/**
 * thinkingLevel.ts vitest 单元测试（Phase 11.2 P0）
 *
 * 测试目标：
 * - ThinkingLevel 常量对象 4 档值正确
 * - PiThinkingLevel 类型覆盖 6 档字面量（编译期类型断言 + 运行期数组对照）
 * - mapThinkingLevelToPi identity 映射
 * - getThinkingLevelLabel / Description / getAvailableThinkingLevels
 * - 边界条件：undefined / null / 非法字符串不抛错（返回 undefined）
 *
 * 不修改源代码；只读源代码以对齐行为。
 */
import { describe, test, expect } from 'vitest'
import {
  ThinkingLevel,
  mapThinkingLevelToPi,
  getThinkingLevelLabel,
  getThinkingLevelDescription,
  getAvailableThinkingLevels,
  type PiThinkingLevel,
  type ThinkingLevel as ThinkingLevelType,
} from '../thinkingLevel'

// ============================================================================
// 1. ThinkingLevel 常量对象 + 类型字面量
// ============================================================================

describe('ThinkingLevel 常量对象（4 档）', () => {
  test('ThinkingLevel.MINIMAL === "minimal"', () => {
    expect(ThinkingLevel.MINIMAL).toBe('minimal')
  })

  test('ThinkingLevel.LOW === "low"', () => {
    expect(ThinkingLevel.LOW).toBe('low')
  })

  test('ThinkingLevel.MEDIUM === "medium"', () => {
    expect(ThinkingLevel.MEDIUM).toBe('medium')
  })

  test('ThinkingLevel.HIGH === "high"', () => {
    expect(ThinkingLevel.HIGH).toBe('high')
  })

  test('ThinkingLevel 常量对象 keys 数量为 4', () => {
    expect(Object.keys(ThinkingLevel)).toHaveLength(4)
  })
})

// ============================================================================
// 2. PiThinkingLevel 6 档类型断言（编译期 + 运行期）
// ============================================================================

describe('PiThinkingLevel 6 档枚举值', () => {
  test('PiThinkingLevel 包含 6 档字面量（off/minimal/low/medium/high/xhigh）', () => {
    // 编译期：所有 6 个字面量都是合法的 PiThinkingLevel
    const allPiLevels: PiThinkingLevel[] = [
      'off',
      'minimal',
      'low',
      'medium',
      'high',
      'xhigh',
    ]
    // 运行期：验证数组内容
    expect(allPiLevels).toHaveLength(6)
    expect(allPiLevels).toEqual(['off', 'minimal', 'low', 'medium', 'high', 'xhigh'])
  })

  test('PiThinkingLevel 是 ThinkingLevel 的超集（含 off/xhigh）', () => {
    // 编译期：所有 ThinkingLevel 字面量都是合法的 PiThinkingLevel
    const thinkingLevelValues: ThinkingLevelType[] = ['minimal', 'low', 'medium', 'high']
    const piLevelValues: PiThinkingLevel[] = [...thinkingLevelValues, 'off', 'xhigh']
    expect(piLevelValues).toContain('off')
    expect(piLevelValues).toContain('xhigh')
  })
})

// ============================================================================
// 3. mapThinkingLevelToPi identity 映射
// ============================================================================

describe('mapThinkingLevelToPi', () => {
  test("mapThinkingLevelToPi('minimal') === 'minimal'", () => {
    expect(mapThinkingLevelToPi('minimal')).toBe('minimal')
  })

  test("mapThinkingLevelToPi('low') === 'low'", () => {
    expect(mapThinkingLevelToPi('low')).toBe('low')
  })

  test("mapThinkingLevelToPi('medium') === 'medium'", () => {
    expect(mapThinkingLevelToPi('medium')).toBe('medium')
  })

  test("mapThinkingLevelToPi('high') === 'high'", () => {
    expect(mapThinkingLevelToPi('high')).toBe('high')
  })

  test('mapThinkingLevelToPi 接受 ThinkingLevel 常量对象值', () => {
    expect(mapThinkingLevelToPi(ThinkingLevel.MINIMAL)).toBe('minimal')
    expect(mapThinkingLevelToPi(ThinkingLevel.LOW)).toBe('low')
    expect(mapThinkingLevelToPi(ThinkingLevel.MEDIUM)).toBe('medium')
    expect(mapThinkingLevelToPi(ThinkingLevel.HIGH)).toBe('high')
  })

  test('mapThinkingLevelToPi 返回值属于 PiThinkingLevel 6 档集合', () => {
    const validPiLevels: PiThinkingLevel[] = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh']
    for (const lvl of getAvailableThinkingLevels()) {
      const mapped = mapThinkingLevelToPi(lvl)
      expect(validPiLevels).toContain(mapped)
    }
  })

  test('mapThinkingLevelToPi 对无效输入返回 undefined（不抛错）', () => {
    // 实现是 PI_LEVEL_MAP[level]，无效 key 返回 undefined（不抛异常）
    // 用 as any 模拟运行期非法输入
    expect(mapThinkingLevelToPi('invalid' as unknown as ThinkingLevelType)).toBeUndefined()
  })

  test('mapThinkingLevelToPi(undefined) 不抛错并返回 undefined', () => {
    expect(() =>
      mapThinkingLevelToPi(undefined as unknown as ThinkingLevelType),
    ).not.toThrow()
    expect(mapThinkingLevelToPi(undefined as unknown as ThinkingLevelType)).toBeUndefined()
  })

  test('mapThinkingLevelToPi(null) 不抛错并返回 undefined', () => {
    expect(() =>
      mapThinkingLevelToPi(null as unknown as ThinkingLevelType),
    ).not.toThrow()
    expect(mapThinkingLevelToPi(null as unknown as ThinkingLevelType)).toBeUndefined()
  })
})

// ============================================================================
// 4. getThinkingLevelLabel
// ============================================================================

describe('getThinkingLevelLabel', () => {
  test("getThinkingLevelLabel('minimal') === '极简'", () => {
    expect(getThinkingLevelLabel('minimal')).toBe('极简')
  })

  test("getThinkingLevelLabel('low') === '低'", () => {
    expect(getThinkingLevelLabel('low')).toBe('低')
  })

  test("getThinkingLevelLabel('medium') === '中'", () => {
    expect(getThinkingLevelLabel('medium')).toBe('中')
  })

  test("getThinkingLevelLabel('high') === '高'", () => {
    expect(getThinkingLevelLabel('high')).toBe('高')
  })

  test("getThinkingLevelLabel('invalid') 返回 undefined（无合理默认，Record 索引返回 undefined）", () => {
    // 实现是 LEVEL_LABELS[level]，非法 key 返回 undefined
    expect(getThinkingLevelLabel('invalid' as unknown as ThinkingLevelType)).toBeUndefined()
  })

  test('getThinkingLevelLabel 对 4 档都返回非空字符串', () => {
    for (const lvl of getAvailableThinkingLevels()) {
      const label = getThinkingLevelLabel(lvl)
      expect(typeof label).toBe('string')
      expect(label.length).toBeGreaterThan(0)
    }
  })
})

// ============================================================================
// 5. getThinkingLevelDescription
// ============================================================================

describe('getThinkingLevelDescription', () => {
  test('getThinkingLevelDescription 对各档返回非空字符串', () => {
    for (const lvl of getAvailableThinkingLevels()) {
      const desc = getThinkingLevelDescription(lvl)
      expect(typeof desc).toBe('string')
      expect(desc.length).toBeGreaterThan(0)
    }
  })

  test('getThinkingLevelDescription 返回的字符串包含中文（CJK 字符）', () => {
    for (const lvl of getAvailableThinkingLevels()) {
      const desc = getThinkingLevelDescription(lvl)
      // 包含 CJK 字符
      expect(/[\u4e00-\u9fff]/.test(desc)).toBe(true)
    }
  })

  test("getThinkingLevelDescription('minimal') 包含 '极简'", () => {
    expect(getThinkingLevelDescription('minimal')).toContain('极简')
  })

  test("getThinkingLevelDescription('high') 包含 '高度思考'", () => {
    expect(getThinkingLevelDescription('high')).toContain('高度思考')
  })
})

// ============================================================================
// 6. getAvailableThinkingLevels
// ============================================================================

describe('getAvailableThinkingLevels', () => {
  test('返回 4 项数组', () => {
    expect(getAvailableThinkingLevels()).toHaveLength(4)
  })

  test('数组顺序：minimal → low → medium → high', () => {
    expect(getAvailableThinkingLevels()).toEqual(['minimal', 'low', 'medium', 'high'])
  })

  test('每项都是合法的 ThinkingLevel 字面量', () => {
    const validLevels: ThinkingLevelType[] = ['minimal', 'low', 'medium', 'high']
    for (const lvl of getAvailableThinkingLevels()) {
      expect(validLevels).toContain(lvl)
    }
  })

  test('每项可映射到 label / description / pi level（不抛错）', () => {
    for (const lvl of getAvailableThinkingLevels()) {
      expect(() => {
        const label = getThinkingLevelLabel(lvl)
        const desc = getThinkingLevelDescription(lvl)
        const pi = mapThinkingLevelToPi(lvl)
        return { label, desc, pi }
      }).not.toThrow()
    }
  })
})
