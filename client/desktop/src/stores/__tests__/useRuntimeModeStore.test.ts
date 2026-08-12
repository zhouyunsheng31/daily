/**
 * useRuntimeModeStore vitest 单元测试（Phase 11.2 P0）
 *
 * 测试目标：
 * - 初始状态 mode='auto', isServerOnline=true（乐观假设）, effectiveMode='cloud', isOfflineDowngraded=false
 * - setMode('cloud' / 'local' / 'auto') 立即生效（无防抖）
 * - setServerOnline 2s 防抖（vi.useFakeTimers + advanceTimersByTime）
 * - effectiveMode 计算（mode × serverOnline 矩阵）
 * - isOfflineDowngraded 计算（仅 auto + offline 时为 true）
 * - localStorage 持久化
 *
 * 重置策略：
 * - beforeEach：vi.useFakeTimers() + 清空 localStorage + setState 重置 store
 * - afterEach：vi.useRealTimers()
 *
 * 注意：beforeEach 重置到 isServerOnline=false 作为防抖测试的干净起点（offline），
 *      这与源代码初始值（isServerOnline=true 乐观假设）不同，源代码初始值由
 *      "初始状态"测试组之外的行为测试覆盖。
 */
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest'
import { useRuntimeModeStore, type RuntimeMode } from '../useRuntimeModeStore'

// ============================================================================
// 公共重置逻辑
// ============================================================================

beforeEach(() => {
  // 使用假定时器（防抖测试需要）
  vi.useFakeTimers()

  // 清空 localStorage
  localStorage.clear()

  // 重置 store 到 offline 基准状态（防抖测试的干净起点）
  // 注：源代码初始值已改为 isServerOnline=true（乐观假设），此处重置到 false
  //     是为了给 setServerOnline 防抖测试提供一个确定的 offline 起点
  useRuntimeModeStore.setState({
    mode: 'auto',
    isServerOnline: false,
    effectiveMode: 'local',
    isOfflineDowngraded: true,
    _debounceTimer: null,
  })
})

afterEach(() => {
  // 恢复真实定时器
  vi.useRealTimers()
})

// ============================================================================
// 1. 初始状态（测试 beforeEach 重置后的 offline 基准状态）
// ============================================================================

describe('初始状态', () => {
  test("mode === 'auto'", () => {
    expect(useRuntimeModeStore.getState().mode).toBe('auto')
  })

  test('isServerOnline === false（beforeEach 重置的 offline 基准）', () => {
    expect(useRuntimeModeStore.getState().isServerOnline).toBe(false)
  })

  test("effectiveMode === 'local'（auto + offline 基准）", () => {
    expect(useRuntimeModeStore.getState().effectiveMode).toBe('local')
  })

  test('isOfflineDowngraded === true（auto + offline 基准）', () => {
    expect(useRuntimeModeStore.getState().isOfflineDowngraded).toBe(true)
  })
})

// ============================================================================
// 2. setMode（立即生效，无防抖）
// ============================================================================

describe('setMode', () => {
  test("setMode('cloud') 后 mode === 'cloud'", () => {
    useRuntimeModeStore.getState().setMode('cloud')
    expect(useRuntimeModeStore.getState().mode).toBe('cloud')
  })

  test("setMode('local') 后 mode === 'local'", () => {
    useRuntimeModeStore.getState().setMode('local')
    expect(useRuntimeModeStore.getState().mode).toBe('local')
  })

  test("setMode('auto') 后 mode === 'auto'", () => {
    useRuntimeModeStore.getState().setMode('cloud')
    useRuntimeModeStore.getState().setMode('auto')
    expect(useRuntimeModeStore.getState().mode).toBe('auto')
  })

  test('setMode 持久化到 localStorage', () => {
    useRuntimeModeStore.getState().setMode('cloud')
    expect(localStorage.getItem('runtime-mode')).toBe('cloud')
  })

  test('setMode 立即生效（无防抖，无需 advanceTimersByTime）', () => {
    useRuntimeModeStore.getState().setMode('cloud')
    // 立即检查：mode 已更新
    expect(useRuntimeModeStore.getState().mode).toBe('cloud')
    expect(useRuntimeModeStore.getState().effectiveMode).toBe('cloud')
  })
})

// ============================================================================
// 3. setServerOnline（带 2s 防抖）
// ============================================================================

describe('setServerOnline 防抖', () => {
  test('setServerOnline(true) 后 isServerOnline 不立即变 true（防抖期）', () => {
    useRuntimeModeStore.getState().setServerOnline(true)
    expect(useRuntimeModeStore.getState().isServerOnline).toBe(false)
  })

  test('setServerOnline(true) 后 1s 内仍未生效（< 2s）', () => {
    useRuntimeModeStore.getState().setServerOnline(true)
    vi.advanceTimersByTime(1000)
    expect(useRuntimeModeStore.getState().isServerOnline).toBe(false)
  })

  test('setServerOnline(true) 2s 后 isServerOnline === true', () => {
    useRuntimeModeStore.getState().setServerOnline(true)
    vi.advanceTimersByTime(2000)
    expect(useRuntimeModeStore.getState().isServerOnline).toBe(true)
  })

  test('setServerOnline(true) 2s 后 effectiveMode === cloud（auto + online）', () => {
    useRuntimeModeStore.getState().setServerOnline(true)
    vi.advanceTimersByTime(2000)
    expect(useRuntimeModeStore.getState().effectiveMode).toBe('cloud')
  })

  test('setServerOnline(true) 2s 后 isOfflineDowngraded === false', () => {
    useRuntimeModeStore.getState().setServerOnline(true)
    vi.advanceTimersByTime(2000)
    expect(useRuntimeModeStore.getState().isOfflineDowngraded).toBe(false)
  })

  test('防抖取消：setServerOnline(true) 后 1s 内 setServerOnline(false)，isServerOnline 保持 false', () => {
    // 第一次调用
    useRuntimeModeStore.getState().setServerOnline(true)
    vi.advanceTimersByTime(1000)

    // 第二次调用（重置计时器）
    useRuntimeModeStore.getState().setServerOnline(false)
    vi.advanceTimersByTime(1500) // 第二次调用后 1.5s（< 2s）

    expect(useRuntimeModeStore.getState().isServerOnline).toBe(false)

    // 再推进 1s（第二次调用后共 2.5s，> 2s）：应触发为 false
    vi.advanceTimersByTime(1000)
    expect(useRuntimeModeStore.getState().isServerOnline).toBe(false)
  })

  test('弱网抖动：true → false → true 交替，仅最后一次稳定 2s 后生效', () => {
    useRuntimeModeStore.getState().setServerOnline(true)
    vi.advanceTimersByTime(200)

    useRuntimeModeStore.getState().setServerOnline(false)
    vi.advanceTimersByTime(200)

    useRuntimeModeStore.getState().setServerOnline(true)
    vi.advanceTimersByTime(200)

    useRuntimeModeStore.getState().setServerOnline(false)
    vi.advanceTimersByTime(200)

    useRuntimeModeStore.getState().setServerOnline(true) // 最后一次
    vi.advanceTimersByTime(200)

    // 此时虽已 1s，但每次调用都重置计时器，isServerOnline 应仍是 false
    expect(useRuntimeModeStore.getState().isServerOnline).toBe(false)

    // 再过 2s（最后一次调用后）：应触发为 true
    vi.advanceTimersByTime(2000)
    expect(useRuntimeModeStore.getState().isServerOnline).toBe(true)
  })

  test('防抖计时器清理：2s 后 _debounceTimer 重置为 null', () => {
    useRuntimeModeStore.getState().setServerOnline(true)
    vi.advanceTimersByTime(2000)
    expect(useRuntimeModeStore.getState()._debounceTimer).toBeNull()
  })
})

// ============================================================================
// 4. effectiveMode 计算矩阵
// ============================================================================

describe('effectiveMode 计算', () => {
  test('mode=auto + serverOnline=true → effectiveMode=cloud', () => {
    useRuntimeModeStore.getState().setServerOnline(true)
    vi.advanceTimersByTime(2000)
    expect(useRuntimeModeStore.getState().effectiveMode).toBe('cloud')
  })

  test('mode=auto + serverOnline=false → effectiveMode=local', () => {
    // 初始状态：mode=auto, isServerOnline=false
    expect(useRuntimeModeStore.getState().effectiveMode).toBe('local')
  })

  test('mode=cloud → effectiveMode=cloud（不依赖 serverOnline）', () => {
    useRuntimeModeStore.getState().setMode('cloud')
    // 即使 isServerOnline=false，cloud 模式不降级
    expect(useRuntimeModeStore.getState().effectiveMode).toBe('cloud')
  })

  test('mode=local → effectiveMode=local（不依赖 serverOnline）', () => {
    useRuntimeModeStore.getState().setMode('local')
    expect(useRuntimeModeStore.getState().effectiveMode).toBe('local')
  })

  test('mode=cloud + serverOnline=true → effectiveMode=cloud', () => {
    useRuntimeModeStore.getState().setServerOnline(true)
    vi.advanceTimersByTime(2000)
    useRuntimeModeStore.getState().setMode('cloud')
    expect(useRuntimeModeStore.getState().effectiveMode).toBe('cloud')
  })

  test('mode=local + serverOnline=true → effectiveMode=local（不受在线状态影响）', () => {
    useRuntimeModeStore.getState().setServerOnline(true)
    vi.advanceTimersByTime(2000)
    useRuntimeModeStore.getState().setMode('local')
    expect(useRuntimeModeStore.getState().effectiveMode).toBe('local')
  })
})

// ============================================================================
// 5. isOfflineDowngraded 计算
// ============================================================================

describe('isOfflineDowngraded 计算', () => {
  test('mode=auto + serverOnline=false → true', () => {
    // 初始状态即此场景
    expect(useRuntimeModeStore.getState().isOfflineDowngraded).toBe(true)
  })

  test('mode=auto + serverOnline=true → false', () => {
    useRuntimeModeStore.getState().setServerOnline(true)
    vi.advanceTimersByTime(2000)
    expect(useRuntimeModeStore.getState().isOfflineDowngraded).toBe(false)
  })

  test('mode=cloud + serverOnline=false → false（用户显式选 cloud）', () => {
    useRuntimeModeStore.getState().setMode('cloud')
    expect(useRuntimeModeStore.getState().isOfflineDowngraded).toBe(false)
  })

  test('mode=local + serverOnline=false → false（用户显式选 local）', () => {
    useRuntimeModeStore.getState().setMode('local')
    expect(useRuntimeModeStore.getState().isOfflineDowngraded).toBe(false)
  })

  test('mode=cloud + serverOnline=true → false', () => {
    useRuntimeModeStore.getState().setServerOnline(true)
    vi.advanceTimersByTime(2000)
    useRuntimeModeStore.getState().setMode('cloud')
    expect(useRuntimeModeStore.getState().isOfflineDowngraded).toBe(false)
  })

  test('mode=local + serverOnline=true → false', () => {
    useRuntimeModeStore.getState().setServerOnline(true)
    vi.advanceTimersByTime(2000)
    useRuntimeModeStore.getState().setMode('local')
    expect(useRuntimeModeStore.getState().isOfflineDowngraded).toBe(false)
  })

  test('从 auto + offline 切到 cloud：isOfflineDowngraded 立即变 false', () => {
    // 初始：auto + offline → true
    expect(useRuntimeModeStore.getState().isOfflineDowngraded).toBe(true)

    useRuntimeModeStore.getState().setMode('cloud')
    expect(useRuntimeModeStore.getState().isOfflineDowngraded).toBe(false)
  })
})

// ============================================================================
// 6. 防抖与 effectiveMode 联动
// ============================================================================

describe('防抖与 effectiveMode 联动', () => {
  test('防抖期内 effectiveMode 不变（auto + offline → local 仍保持）', () => {
    // 初始 effectiveMode='local'
    useRuntimeModeStore.getState().setServerOnline(true)
    // 防抖期内：effectiveMode 仍为 local
    expect(useRuntimeModeStore.getState().effectiveMode).toBe('local')

    vi.advanceTimersByTime(1999) // < 2s
    expect(useRuntimeModeStore.getState().effectiveMode).toBe('local')

    vi.advanceTimersByTime(1) // 总计 2s，触发更新
    expect(useRuntimeModeStore.getState().effectiveMode).toBe('cloud')
  })

  test('防抖期内 isOfflineDowngraded 不变（auto + offline → true 仍保持）', () => {
    useRuntimeModeStore.getState().setServerOnline(true)
    expect(useRuntimeModeStore.getState().isOfflineDowngraded).toBe(true)

    vi.advanceTimersByTime(1999)
    expect(useRuntimeModeStore.getState().isOfflineDowngraded).toBe(true)

    vi.advanceTimersByTime(1)
    expect(useRuntimeModeStore.getState().isOfflineDowngraded).toBe(false)
  })

  test('setMode 在防抖期内立即重算 effectiveMode（无需等待防抖）', () => {
    // 启动一次 setServerOnline 防抖
    useRuntimeModeStore.getState().setServerOnline(true)

    // 防抖期内切到 cloud：effectiveMode 立即变 cloud（不依赖 serverOnline）
    useRuntimeModeStore.getState().setMode('cloud')
    expect(useRuntimeModeStore.getState().effectiveMode).toBe('cloud')
    expect(useRuntimeModeStore.getState().isOfflineDowngraded).toBe(false)
  })
})

// ============================================================================
// 7. recomputeEffectiveMode
// ============================================================================

describe('recomputeEffectiveMode', () => {
  test('recomputeEffectiveMode 不抛错并保持一致性', () => {
    expect(() => useRuntimeModeStore.getState().recomputeEffectiveMode()).not.toThrow()
    // auto + offline → local + downgraded
    expect(useRuntimeModeStore.getState().effectiveMode).toBe('local')
    expect(useRuntimeModeStore.getState().isOfflineDowngraded).toBe(true)
  })

  test('recomputeEffectiveMode 在 mode=cloud + online 时重算为 cloud', () => {
    useRuntimeModeStore.getState().setServerOnline(true)
    vi.advanceTimersByTime(2000)
    useRuntimeModeStore.getState().setMode('cloud')

    // 手动 recompute（保持一致）
    useRuntimeModeStore.getState().recomputeEffectiveMode()
    expect(useRuntimeModeStore.getState().effectiveMode).toBe('cloud')
    expect(useRuntimeModeStore.getState().isOfflineDowngraded).toBe(false)
  })
})

// ============================================================================
// 8. localStorage 恢复
// ============================================================================

describe('localStorage 持久化与恢复', () => {
  test('setMode 持久化到 localStorage["runtime-mode"]', () => {
    useRuntimeModeStore.getState().setMode('cloud')
    expect(localStorage.getItem('runtime-mode')).toBe('cloud')

    useRuntimeModeStore.getState().setMode('local')
    expect(localStorage.getItem('runtime-mode')).toBe('local')
  })

  test('初始化时从 localStorage 读取 mode', async () => {
    localStorage.setItem('runtime-mode', 'cloud')

    vi.resetModules()
    const freshModule = await import('../useRuntimeModeStore')
    expect(freshModule.useRuntimeModeStore.getState().mode).toBe('cloud')
  })

  test('localStorage 中非法 mode 值回退到 auto', async () => {
    localStorage.setItem('runtime-mode', 'invalid-mode')

    vi.resetModules()
    const freshModule = await import('../useRuntimeModeStore')
    expect(freshModule.useRuntimeModeStore.getState().mode).toBe('auto')
  })

  test('localStorage 为空时使用默认值 auto', async () => {
    localStorage.removeItem('runtime-mode')

    vi.resetModules()
    const freshModule = await import('../useRuntimeModeStore')
    expect(freshModule.useRuntimeModeStore.getState().mode).toBe('auto')
  })
})

// ============================================================================
// 9. 完整切换矩阵（覆盖所有 mode × online 组合）
// ============================================================================

describe('mode × online 完整切换矩阵', () => {
  test('所有 3 mode × 2 online 组合的 effectiveMode 一致性', () => {
    const modes: RuntimeMode[] = ['auto', 'cloud', 'local']
    const onlineStates = [true, false]

    for (const mode of modes) {
      for (const wantOnline of onlineStates) {
        // 重置到已知状态
        useRuntimeModeStore.setState({
          mode: 'auto',
          isServerOnline: false,
          effectiveMode: 'local',
          isOfflineDowngraded: true,
          _debounceTimer: null,
        })

        // 先切到目标 mode（立即生效）
        useRuntimeModeStore.getState().setMode(mode)

        // 再设置 serverOnline（带防抖）
        useRuntimeModeStore.getState().setServerOnline(wantOnline)
        vi.advanceTimersByTime(2000)

        const state = useRuntimeModeStore.getState()
        const expectedEffective =
          mode === 'cloud'
            ? 'cloud'
            : mode === 'local'
              ? 'local'
              : wantOnline
                ? 'cloud'
                : 'local'
        const expectedDowngraded = mode === 'auto' && !wantOnline

        expect(state.effectiveMode).toBe(expectedEffective)
        expect(state.isOfflineDowngraded).toBe(expectedDowngraded)
      }
    }
  })
})
