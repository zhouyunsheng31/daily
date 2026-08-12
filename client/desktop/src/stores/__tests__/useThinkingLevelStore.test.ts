/**
 * useThinkingLevelStore vitest 单元测试（Phase 11.2 P0）
 *
 * 测试目标：
 * - 初始状态 currentLevel / defaultLevel === 'medium'（默认值）
 * - setLevel / setDefaultLevel 正常工作
 * - setDefaultLevel 不影响 currentLevel
 * - getPiThinkingLevel() === mapThinkingLevelToPi(currentLevel)
 * - localStorage 持久化（写入 + 读取）
 * - 无效 level 校验：loadLevelFromStorage 回退到默认值
 *
 * 重置策略：
 * - beforeEach 清空 localStorage 并 setState 重置 store
 * - 使用 vi.resetModules() + 动态 import 测试"从 localStorage 恢复"
 *
 * 不修改源代码；只读源代码以对齐行为。
 */
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest'
import { useThinkingLevelStore } from '../useThinkingLevelStore'
import { mapThinkingLevelToPi, type ThinkingLevel } from '../../utils/thinkingLevel'

// ============================================================================
// 重置 store + localStorage
// ============================================================================

beforeEach(() => {
  // 清空 localStorage（happy-dom 提供 localStorage）
  localStorage.clear()

  // 重置 store 到初始默认状态
  useThinkingLevelStore.setState({
    currentLevel: 'medium',
    defaultLevel: 'medium',
  })
})

afterEach(() => {
  // 确保每个测试后清空 localStorage，避免污染后续测试
  localStorage.clear()
})

// ============================================================================
// 1. 初始状态
// ============================================================================

describe('初始状态', () => {
  test("currentLevel 默认值为 'medium'", () => {
    expect(useThinkingLevelStore.getState().currentLevel).toBe('medium')
  })

  test("defaultLevel 默认值为 'medium'", () => {
    expect(useThinkingLevelStore.getState().defaultLevel).toBe('medium')
  })

  test('初始 getPiThinkingLevel() 返回 mapThinkingLevelToPi(currentLevel)', () => {
    const { currentLevel } = useThinkingLevelStore.getState()
    expect(useThinkingLevelStore.getState().getPiThinkingLevel()).toBe(
      mapThinkingLevelToPi(currentLevel),
    )
  })

  test("初始 getPiThinkingLevel() === 'medium'", () => {
    expect(useThinkingLevelStore.getState().getPiThinkingLevel()).toBe('medium')
  })
})

// ============================================================================
// 2. setLevel
// ============================================================================

describe('setLevel', () => {
  test("setLevel('high') 后 currentLevel === 'high'", () => {
    useThinkingLevelStore.getState().setLevel('high')
    expect(useThinkingLevelStore.getState().currentLevel).toBe('high')
  })

  test("setLevel('minimal') 后 currentLevel === 'minimal'", () => {
    useThinkingLevelStore.getState().setLevel('minimal')
    expect(useThinkingLevelStore.getState().currentLevel).toBe('minimal')
  })

  test('setLevel 后 getPiThinkingLevel() 返回映射后的 pi level', () => {
    useThinkingLevelStore.getState().setLevel('high')
    expect(useThinkingLevelStore.getState().getPiThinkingLevel()).toBe('high')

    useThinkingLevelStore.getState().setLevel('minimal')
    expect(useThinkingLevelStore.getState().getPiThinkingLevel()).toBe('minimal')
  })

  test('setLevel 不影响 defaultLevel', () => {
    const originalDefault = useThinkingLevelStore.getState().defaultLevel
    useThinkingLevelStore.getState().setLevel('high')
    expect(useThinkingLevelStore.getState().defaultLevel).toBe(originalDefault)
  })
})

// ============================================================================
// 3. setDefaultLevel
// ============================================================================

describe('setDefaultLevel', () => {
  test("setDefaultLevel('low') 后 defaultLevel === 'low'", () => {
    useThinkingLevelStore.getState().setDefaultLevel('low')
    expect(useThinkingLevelStore.getState().defaultLevel).toBe('low')
  })

  test("setDefaultLevel('high') 后 defaultLevel === 'high'", () => {
    useThinkingLevelStore.getState().setDefaultLevel('high')
    expect(useThinkingLevelStore.getState().defaultLevel).toBe('high')
  })

  test('setDefaultLevel 不影响 currentLevel', () => {
    useThinkingLevelStore.getState().setLevel('minimal')
    useThinkingLevelStore.getState().setDefaultLevel('high')
    expect(useThinkingLevelStore.getState().currentLevel).toBe('minimal')
  })
})

// ============================================================================
// 4. localStorage 持久化
// ============================================================================

describe('localStorage 持久化', () => {
  test("setLevel('high') 后 localStorage['ai-thinking-level'] === 'high'", () => {
    useThinkingLevelStore.getState().setLevel('high')
    expect(localStorage.getItem('ai-thinking-level')).toBe('high')
  })

  test("setDefaultLevel('low') 后 localStorage['ai-thinking-level-default'] === 'low'", () => {
    useThinkingLevelStore.getState().setDefaultLevel('low')
    expect(localStorage.getItem('ai-thinking-level-default')).toBe('low')
  })

  test('setLevel 多次切换，localStorage 反映最后一次值', () => {
    useThinkingLevelStore.getState().setLevel('minimal')
    expect(localStorage.getItem('ai-thinking-level')).toBe('minimal')

    useThinkingLevelStore.getState().setLevel('high')
    expect(localStorage.getItem('ai-thinking-level')).toBe('high')

    useThinkingLevelStore.getState().setLevel('low')
    expect(localStorage.getItem('ai-thinking-level')).toBe('low')
  })

  test('setLevel + setDefaultLevel 写入不同 localStorage key（互不干扰）', () => {
    useThinkingLevelStore.getState().setLevel('high')
    useThinkingLevelStore.getState().setDefaultLevel('minimal')
    expect(localStorage.getItem('ai-thinking-level')).toBe('high')
    expect(localStorage.getItem('ai-thinking-level-default')).toBe('minimal')
  })
})

// ============================================================================
// 5. localStorage 恢复（重新初始化 store）
// ============================================================================

describe('localStorage 恢复', () => {
  test('初始化时从 localStorage 读取 currentLevel', async () => {
    // 先写入 localStorage
    localStorage.setItem('ai-thinking-level', 'high')

    // 重置模块缓存，强制重新初始化 store
    vi.resetModules()

    // 动态 import 触发 store 重新初始化（读取 localStorage）
    const freshModule = await import('../useThinkingLevelStore')
    expect(freshModule.useThinkingLevelStore.getState().currentLevel).toBe('high')
  })

  test('初始化时从 localStorage 读取 defaultLevel', async () => {
    localStorage.setItem('ai-thinking-level-default', 'low')

    vi.resetModules()
    const freshModule = await import('../useThinkingLevelStore')
    expect(freshModule.useThinkingLevelStore.getState().defaultLevel).toBe('low')
  })

  test('localStorage 中非法值回退到默认值（medium）', async () => {
    localStorage.setItem('ai-thinking-level', 'invalid-level')

    vi.resetModules()
    const freshModule = await import('../useThinkingLevelStore')
    // 非法值应触发 console.warn 并回退到 'medium'
    expect(freshModule.useThinkingLevelStore.getState().currentLevel).toBe('medium')
  })

  test('localStorage 为空时使用默认值（medium）', async () => {
    localStorage.removeItem('ai-thinking-level')
    localStorage.removeItem('ai-thinking-level-default')

    vi.resetModules()
    const freshModule = await import('../useThinkingLevelStore')
    expect(freshModule.useThinkingLevelStore.getState().currentLevel).toBe('medium')
    expect(freshModule.useThinkingLevelStore.getState().defaultLevel).toBe('medium')
  })
})

// ============================================================================
// 6. 无效输入校验
// ============================================================================

describe('无效输入校验', () => {
  test('setLevel 只接受合法 ThinkingLevel（运行期类型由 TS 保证）', () => {
    // 正常路径：所有合法值都能被接受
    const validLevels: ThinkingLevel[] = ['minimal', 'low', 'medium', 'high']
    for (const lvl of validLevels) {
      useThinkingLevelStore.getState().setLevel(lvl)
      expect(useThinkingLevelStore.getState().currentLevel).toBe(lvl)
    }
  })

  test('setLevel + getPiThinkingLevel 对所有合法值都成立', () => {
    const validLevels: ThinkingLevel[] = ['minimal', 'low', 'medium', 'high']
    for (const lvl of validLevels) {
      useThinkingLevelStore.getState().setLevel(lvl)
      const piLevel = useThinkingLevelStore.getState().getPiThinkingLevel()
      expect(piLevel).toBe(mapThinkingLevelToPi(lvl))
      expect(piLevel).toBe(lvl) // identity 映射
    }
  })
})
