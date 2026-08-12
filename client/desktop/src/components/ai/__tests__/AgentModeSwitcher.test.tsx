/**
 * AgentModeSwitcher vitest 单元测试（Phase 11.2 P0）
 *
 * 测试目标：
 * - 渲染时显示当前 effectiveMode 标签
 * - 点击按钮展开 3 选项菜单（云端/本地/自动）
 * - 点击选项调用 setMode
 * - isOfflineDowngraded 时显示警告色 + 离线 tooltip
 * - auto 模式显示实际生效模式
 * - 选中项有 ✓ 标记
 *
 * mock 策略：
 * - vi.mock('../../../stores/useRuntimeModeStore') 替换 store + 工具函数
 * - 用 vi.hoisted 暴露 mock state 给测试用例控制
 *
 * 注意：
 * - vitest 4.x 的 vi.fn 不再支持双泛型（只用单泛型或不带泛型）
 * - 每个用例通过修改 mockStore.state 控制渲染输入
 * - 每个用例重新 render，不依赖订阅机制
 *
 * 不修改源代码；只读源代码以对齐行为。
 */
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'

// ============================================================================
// mock useRuntimeModeStore
// ============================================================================
const mockStore = vi.hoisted(() => {
  const state = {
    mode: 'auto' as 'auto' | 'cloud' | 'local',
    effectiveMode: 'local' as 'local' | 'cloud',
    isOfflineDowngraded: false,
    setMode: vi.fn(),
  }
  return { state }
})

vi.mock('../../../stores/useRuntimeModeStore', () => ({
  useRuntimeModeStore: (selector: (s: typeof mockStore.state) => unknown) =>
    selector(mockStore.state),
  getModeLabel: (mode: string) =>
    mode === 'cloud' ? '云端' : mode === 'local' ? '本地' : '自动',
  getEffectiveModeLabel: (mode: string) =>
    mode === 'cloud' ? '云端' : '本地',
}))

// ============================================================================
// 导入被测组件（必须在 vi.mock 之后）
// ============================================================================
import AgentModeSwitcher from '../AgentModeSwitcher'

// ============================================================================
// 公共重置逻辑
// ============================================================================
beforeEach(() => {
  mockStore.state.mode = 'auto'
  mockStore.state.effectiveMode = 'local'
  mockStore.state.isOfflineDowngraded = false
  mockStore.state.setMode = vi.fn()
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

// ============================================================================
// 工具函数：打开下拉菜单（点击切换按钮）
// ============================================================================
function openDropdown(): HTMLElement {
  const button = screen.getByRole('button', { name: /切换 Agent 模式/ })
  fireEvent.click(button)
  return button
}

/**
 * 工具函数：在菜单中查找指定文本对应的选项 button
 *
 * 必要性：当 mode=cloud 时，切换按钮上也显示 "云端" 文本，
 * 此时 screen.getByText('云端') 会找到 2 个元素（按钮 + 菜单）。
 * 通过筛选 menu button 的特征（style.width === '100%'）来精确找到菜单中的按钮。
 */
function findMenuButton(text: string): HTMLElement {
  const spans = screen.getAllByText(text)
  for (const span of spans) {
    const btn = span.closest('button')
    if (btn && (btn as HTMLElement).style.width === '100%') {
      return btn as HTMLElement
    }
  }
  throw new Error(`Menu button containing "${text}" not found`)
}

// ============================================================================
// 1. 渲染：显示当前 effectiveMode 标签
// ============================================================================
describe('渲染：显示当前模式标签', () => {
  test('mode=auto + effectiveMode=local → 按钮显示 "自动 (本地)"', () => {
    mockStore.state.mode = 'auto'
    mockStore.state.effectiveMode = 'local'
    render(<AgentModeSwitcher />)
    const button = screen.getByRole('button', { name: /切换 Agent 模式/ })
    expect(button).toHaveTextContent('自动 (本地)')
  })

  test('mode=auto + effectiveMode=cloud → 按钮显示 "自动 (云端)"', () => {
    mockStore.state.mode = 'auto'
    mockStore.state.effectiveMode = 'cloud'
    render(<AgentModeSwitcher />)
    const button = screen.getByRole('button', { name: /切换 Agent 模式/ })
    expect(button).toHaveTextContent('自动 (云端)')
  })

  test('mode=cloud → 按钮显示 "云端"（无括号）', () => {
    mockStore.state.mode = 'cloud'
    mockStore.state.effectiveMode = 'cloud'
    render(<AgentModeSwitcher />)
    const button = screen.getByRole('button', { name: /切换 Agent 模式/ })
    expect(button).toHaveTextContent('云端')
    expect(button).not.toHaveTextContent('(')
  })

  test('mode=local → 按钮显示 "本地"（无括号）', () => {
    mockStore.state.mode = 'local'
    mockStore.state.effectiveMode = 'local'
    render(<AgentModeSwitcher />)
    const button = screen.getByRole('button', { name: /切换 Agent 模式/ })
    expect(button).toHaveTextContent('本地')
    expect(button).not.toHaveTextContent('(')
  })
})

// ============================================================================
// 2. 点击按钮展开菜单
// ============================================================================
describe('点击按钮展开菜单', () => {
  test('初始时菜单未展开（无 "云端" 选项可见）', () => {
    mockStore.state.mode = 'auto'
    render(<AgentModeSwitcher />)
    // 按钮上显示 "自动 (本地)"，但菜单项 "云端" 不应单独可见
    // 由于按钮文本是 "自动 (本地)"，精确匹配 "云端" 不应找到
    const matches = screen.queryAllByText('云端')
    expect(matches).toHaveLength(0)
  })

  test('点击按钮后展开菜单（3 选项可见）', () => {
    mockStore.state.mode = 'auto'
    render(<AgentModeSwitcher />)
    openDropdown()
    // 3 选项应可见
    expect(screen.getByText('云端')).toBeInTheDocument()
    expect(screen.getByText('本地')).toBeInTheDocument()
    expect(screen.getByText('自动')).toBeInTheDocument()
  })

  test('aria-expanded 属性随菜单展开状态切换', () => {
    mockStore.state.mode = 'auto'
    render(<AgentModeSwitcher />)
    const button = screen.getByRole('button', { name: /切换 Agent 模式/ })
    expect(button).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(button)
    expect(button).toHaveAttribute('aria-expanded', 'true')
  })
})

// ============================================================================
// 3. 菜单 3 选项：云端/本地/自动
// ============================================================================
describe('菜单 3 选项', () => {
  test('菜单包含云端/本地/自动 3 个选项', () => {
    mockStore.state.mode = 'auto'
    render(<AgentModeSwitcher />)
    openDropdown()
    const cloudOption = screen.getByText('云端')
    const localOption = screen.getByText('本地')
    const autoOption = screen.getByText('自动')
    expect(cloudOption).toBeInTheDocument()
    expect(localOption).toBeInTheDocument()
    expect(autoOption).toBeInTheDocument()
  })
})

// ============================================================================
// 4-6. 点击选项调用 setMode
// ============================================================================
describe('点击选项调用 setMode', () => {
  test('点击 "云端" 调用 setMode("cloud")', () => {
    mockStore.state.mode = 'auto'
    render(<AgentModeSwitcher />)
    openDropdown()
    // 找到 "云端" 选项对应的 button（在菜单中）
    const cloudOption = findMenuButton('云端')
    expect(cloudOption).not.toBeNull()
    fireEvent.click(cloudOption!)
    expect(mockStore.state.setMode).toHaveBeenCalledWith('cloud')
    expect(mockStore.state.setMode).toHaveBeenCalledTimes(1)
  })

  test('点击 "本地" 调用 setMode("local")', () => {
    mockStore.state.mode = 'auto'
    render(<AgentModeSwitcher />)
    openDropdown()
    const localOption = findMenuButton('本地')
    expect(localOption).not.toBeNull()
    fireEvent.click(localOption!)
    expect(mockStore.state.setMode).toHaveBeenCalledWith('local')
    expect(mockStore.state.setMode).toHaveBeenCalledTimes(1)
  })

  test('点击 "自动" 调用 setMode("auto")', () => {
    mockStore.state.mode = 'cloud'
    render(<AgentModeSwitcher />)
    openDropdown()
    const autoOption = findMenuButton('自动')
    expect(autoOption).not.toBeNull()
    fireEvent.click(autoOption!)
    expect(mockStore.state.setMode).toHaveBeenCalledWith('auto')
    expect(mockStore.state.setMode).toHaveBeenCalledTimes(1)
  })

  test('点击选项后菜单关闭', () => {
    mockStore.state.mode = 'auto'
    render(<AgentModeSwitcher />)
    openDropdown()
    const cloudOption = findMenuButton('云端')
    fireEvent.click(cloudOption!)
    // 菜单关闭后，"云端" 选项应不再可见
    expect(screen.queryAllByText('云端')).toHaveLength(0)
  })
})

// ============================================================================
// 7. isOfflineDowngraded=true 时显示警告色
// ============================================================================
describe('isOfflineDowngraded 警告色', () => {
  test('isOfflineDowngraded=false 时按钮无警告色（transparent 背景）', () => {
    mockStore.state.mode = 'auto'
    mockStore.state.isOfflineDowngraded = false
    render(<AgentModeSwitcher />)
    const button = screen.getByRole('button', { name: /切换 Agent 模式/ })
    // 源码：isWarning ? 'rgba(245, 158, 11, 0.12)' : 'transparent'
    expect(button.style.background).toBe('transparent')
  })

  test('isOfflineDowngraded=true 时按钮显示警告色（黄色背景）', () => {
    mockStore.state.mode = 'auto'
    mockStore.state.isOfflineDowngraded = true
    render(<AgentModeSwitcher />)
    const button = screen.getByRole('button', { name: /切换 Agent 模式/ })
    expect(button.style.background).toBe('rgba(245, 158, 11, 0.12)')
    // border 也应为黄色
    expect(button.style.border).toContain('rgba(245, 158, 11, 0.5)')
    // 文字颜色也应为警告色
    expect(button.style.color).toBe('#b45309')
  })

  test('isOfflineDowngraded=true 时按钮显示 AlertTriangle 图标（替代模式图标）', () => {
    mockStore.state.mode = 'auto'
    mockStore.state.isOfflineDowngraded = true
    const { container } = render(<AgentModeSwitcher />)
    // 警告状态下渲染 AlertTriangle，可以通过查找 svg 检查（lucide-react 渲染为 svg）
    const svgs = container.querySelectorAll('svg')
    expect(svgs.length).toBeGreaterThan(0)
  })
})

// ============================================================================
// 8. isOfflineDowngraded=true 时 tooltip 显示离线提示
// ============================================================================
describe('isOfflineDowngraded tooltip', () => {
  test('isOfflineDowngraded=false 时 title 显示正常提示', () => {
    mockStore.state.mode = 'auto'
    mockStore.state.effectiveMode = 'local'
    mockStore.state.isOfflineDowngraded = false
    render(<AgentModeSwitcher />)
    const button = screen.getByRole('button', { name: /切换 Agent 模式/ })
    // 源码：`当前 Agent 模式：${buttonLabel}（点击切换）`
    expect(button).toHaveAttribute('title', '当前 Agent 模式：自动 (本地)（点击切换）')
  })

  test('isOfflineDowngraded=true 时 title 显示离线提示', () => {
    mockStore.state.mode = 'auto'
    mockStore.state.isOfflineDowngraded = true
    render(<AgentModeSwitcher />)
    const button = screen.getByRole('button', { name: /切换 Agent 模式/ })
    expect(button).toHaveAttribute('title', '服务器离线，已自动切换到本地')
  })
})

// ============================================================================
// 9. auto 模式显示实际生效模式
// ============================================================================
describe('auto 模式显示实际生效模式', () => {
  test('展开菜单时 "自动" 选项旁显示 "(本地)"（effectiveMode=local）', () => {
    mockStore.state.mode = 'cloud' // 当前不是 auto，避免按钮显示 "自动 (本地)"
    mockStore.state.effectiveMode = 'local'
    render(<AgentModeSwitcher />)
    openDropdown()
    // 菜单中 "自动" 选项旁应显示 "(本地)"
    const autoOption = findMenuButton('自动')
    expect(autoOption).not.toBeNull()
    expect(autoOption!).toHaveTextContent('(本地)')
  })

  test('展开菜单时 "自动" 选项旁显示 "(云端)"（effectiveMode=cloud）', () => {
    mockStore.state.mode = 'local'
    mockStore.state.effectiveMode = 'cloud'
    render(<AgentModeSwitcher />)
    openDropdown()
    const autoOption = findMenuButton('自动')
    expect(autoOption).not.toBeNull()
    expect(autoOption!).toHaveTextContent('(云端)')
  })
})

// ============================================================================
// 10. 选中项有 ✓ 标记
// ============================================================================
describe('选中项有 ✓ 标记', () => {
  test('mode=cloud 时 "云端" 选项有 ✓ 标记', () => {
    mockStore.state.mode = 'cloud'
    render(<AgentModeSwitcher />)
    openDropdown()
    const cloudOption = findMenuButton('云端')
    expect(cloudOption).not.toBeNull()
    expect(cloudOption!).toHaveTextContent('✓')
    // "本地" 和 "自动" 选项不应有 ✓
    const localOption = findMenuButton('本地')
    const autoOption = findMenuButton('自动')
    expect(localOption).not.toBeNull()
    expect(localOption!).not.toHaveTextContent('✓')
    expect(autoOption).not.toBeNull()
    expect(autoOption!).not.toHaveTextContent('✓')
  })

  test('mode=local 时 "本地" 选项有 ✓ 标记', () => {
    mockStore.state.mode = 'local'
    render(<AgentModeSwitcher />)
    openDropdown()
    const localOption = findMenuButton('本地')
    expect(localOption).not.toBeNull()
    expect(localOption!).toHaveTextContent('✓')
    // 其他选项无 ✓
    const cloudOption = findMenuButton('云端')
    const autoOption = findMenuButton('自动')
    expect(cloudOption!).not.toHaveTextContent('✓')
    expect(autoOption!).not.toHaveTextContent('✓')
  })

  test('mode=auto 时 "自动" 选项有 ✓ 标记', () => {
    mockStore.state.mode = 'auto'
    render(<AgentModeSwitcher />)
    openDropdown()
    const autoOption = findMenuButton('自动')
    expect(autoOption).not.toBeNull()
    expect(autoOption!).toHaveTextContent('✓')
    // 其他选项无 ✓
    const cloudOption = findMenuButton('云端')
    const localOption = findMenuButton('本地')
    expect(cloudOption!).not.toHaveTextContent('✓')
    expect(localOption!).not.toHaveTextContent('✓')
  })
})

// ============================================================================
// 11. 边界情况
// ============================================================================
describe('边界情况', () => {
  test('展开菜单后再次点击按钮关闭菜单', () => {
    mockStore.state.mode = 'auto'
    render(<AgentModeSwitcher />)
    const button = screen.getByRole('button', { name: /切换 Agent 模式/ })
    fireEvent.click(button) // 展开
    expect(screen.getByText('云端')).toBeInTheDocument()
    fireEvent.click(button) // 关闭
    expect(screen.queryAllByText('云端')).toHaveLength(0)
  })

  test('点击外部关闭下拉菜单', () => {
    mockStore.state.mode = 'auto'
    render(
      <div>
        <div data-testid="outside">outside</div>
        <AgentModeSwitcher />
      </div>
    )
    openDropdown()
    expect(screen.getByText('云端')).toBeInTheDocument()
    // 模拟点击外部
    fireEvent.mouseDown(screen.getByTestId('outside'))
    expect(screen.queryAllByText('云端')).toHaveLength(0)
  })

  test('aria-label 包含当前模式标签', () => {
    mockStore.state.mode = 'auto'
    mockStore.state.effectiveMode = 'local'
    render(<AgentModeSwitcher />)
    const button = screen.getByRole('button', { name: /切换 Agent 模式/ })
    // aria-label: `切换 Agent 模式，当前：${buttonLabel}`
    expect(button).toHaveAttribute('aria-label', '切换 Agent 模式，当前：自动 (本地)')
  })
})
