/**
 * iframeProxy.generateToken 边界用例测试 — Phase 11 P2（任务 1.3）
 *
 * 测试重点（与现有 iframeProxy.test.ts 互补，不重复）：
 * - token 格式（UUID v4）
 * - 长度固定（36 字符）
 * - 4 个连字符（位置正确：8/13/18/23）
 * - version 字段（位置 14 = '4'）+ variant 字段（位置 19 ∈ [89ab]）
 * - 大批量生成 token 唯一性（1000 个不重复）
 * - token 字符集（仅 0-9a-f 和 -）
 *
 * 不修改已有 iframeProxy.test.ts；本文件专注 token 边界用例。
 */
import { describe, test, expect } from 'vitest'
import { generateToken } from '../iframeProxy'

// ============================================================================
// 1. token 格式（UUID v4 标准）
// ============================================================================

describe('generateToken / token 格式（UUID v4）', () => {
  test('生成的 token 完全匹配 UUID v4 正则（xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx，y ∈ [89ab]）', () => {
    // 多次抽样验证（10 个样本都应匹配）
    for (let i = 0; i < 10; i++) {
      const token = generateToken()
      expect(token).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      )
    }
  })

  test('token 字符集仅包含 0-9a-f 和 -（无大写字母/其他符号）', () => {
    // 抽样 20 个 token，验证字符集
    for (let i = 0; i < 20; i++) {
      const token = generateToken()
      // 移除所有 - 后，剩余字符应全部是 0-9a-f
      const hexPart = token.replace(/-/g, '')
      expect(hexPart).toMatch(/^[0-9a-f]+$/)
      expect(hexPart.length).toBe(32) // 36 - 4 = 32
    }
  })

  test('token version 字段（第 15 位字符，索引 14）固定为 "4"（UUID v4 标识）', () => {
    // UUID 格式：xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
    // 第 15 个字符（索引 14）是版本号，必须为 '4'
    for (let i = 0; i < 20; i++) {
      const token = generateToken()
      expect(token[14]).toBe('4')
    }
  })

  test('token variant 字段（第 20 位字符，索引 19）属于 [8, 9, a, b]（RFC 4122 variant）', () => {
    // UUID 格式：xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
    // 第 20 个字符（索引 19）是 variant 高位，必须为 8/9/a/b
    for (let i = 0; i < 20; i++) {
      const token = generateToken()
      const variantChar = token[19]
      expect(['8', '9', 'a', 'b']).toContain(variantChar)
    }
  })
})

// ============================================================================
// 2. token 长度固定（36 字符）
// ============================================================================

describe('generateToken / token 长度固定（36 字符）', () => {
  test('单次生成 token 长度严格为 36 字符', () => {
    const token = generateToken()
    expect(token).toHaveLength(36)
  })

  test('批量生成 100 个 token 长度全部为 36 字符', () => {
    for (let i = 0; i < 100; i++) {
      const token = generateToken()
      expect(token).toHaveLength(36)
    }
  })
})

// ============================================================================
// 3. token 4 个连字符（位置 8/13/18/23）
// ============================================================================

describe('generateToken / token 4 个连字符位置正确', () => {
  test('token 含且仅含 4 个连字符（位置 8/13/18/23）', () => {
    const token = generateToken()
    // 统计 - 的数量
    const hyphenCount = (token.match(/-/g) || []).length
    expect(hyphenCount).toBe(4)
    // 4 个位置必须都是 -
    expect(token[8]).toBe('-')
    expect(token[13]).toBe('-')
    expect(token[18]).toBe('-')
    expect(token[23]).toBe('-')
  })

  test('批量生成 50 个 token 连字符位置全部正确', () => {
    for (let i = 0; i < 50; i++) {
      const token = generateToken()
      expect(token[8]).toBe('-')
      expect(token[13]).toBe('-')
      expect(token[18]).toBe('-')
      expect(token[23]).toBe('-')
      // 其他位置不能是 -
      for (let j = 0; j < token.length; j++) {
        if (j !== 8 && j !== 13 && j !== 18 && j !== 23) {
          expect(token[j]).not.toBe('-')
        }
      }
    }
  })

  test('token 各段长度正确（8-4-4-4-12）', () => {
    // UUID 格式分段：8-4-4-4-12
    const token = generateToken()
    const segments = token.split('-')
    expect(segments.length).toBe(5)
    expect(segments[0]).toHaveLength(8)
    expect(segments[1]).toHaveLength(4)
    expect(segments[2]).toHaveLength(4)
    expect(segments[3]).toHaveLength(4)
    expect(segments[4]).toHaveLength(12)
  })
})

// ============================================================================
// 4. 大批量生成 token 唯一性（边界压力测试）
// ============================================================================

describe('generateToken / 大批量 token 唯一性', () => {
  test('连续生成 1000 个 token 全部唯一（无碰撞）', () => {
    const tokens = new Set<string>()
    for (let i = 0; i < 1000; i++) {
      tokens.add(generateToken())
    }
    // 1000 个 token 应该全部唯一
    expect(tokens.size).toBe(1000)
  })

  test('连续生成 100 个 token 全部符合 UUID v4 格式（批量边界）', () => {
    const tokens: string[] = []
    for (let i = 0; i < 100; i++) {
      tokens.push(generateToken())
    }
    // 全部匹配格式
    for (const token of tokens) {
      expect(token).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      )
    }
  })
})
