/**
 * SettingsPanel AI 配置 vitest 单元测试（Phase 11.2 P0）
 *
 * 测试目标：
 * - AI tab 切换（点击 AI 配置 tab 后显示 AI 配置内容）
 * - 默认思考等级配置（4 档下拉 + 调用 setDefaultLevel）
 * - 默认运行模式配置（3 选项 + 调用 setMode）
 * - 子组件渲染（AIApiConfig / AIPromptConfig / AISkillsManager）
 * - 描述文本随 mode 动态变化
 *
 * mock 策略：
 * - vi.mock('../../stores/useAppStore') 替换 settings + actions
 * - vi.mock('../../stores/useRuntimeModeStore') 替换 store + 工具函数
 * - vi.mock('../../stores/useThinkingLevelStore') 替换 store
 * - vi.mock('../settings/*') 替换子组件为占位 div（避免子组件的复杂依赖）
 * - vi.mock('../../api/export') / '../../api/adapter' / '../../utils/deviceAuth' 替换外部依赖
 * - thinkingLevel utils 用真实实现（纯函数，无副作用）
 *
 * 注意：
 * - vitest 4.x 的 vi.fn 不再支持双泛型
 * - SettingsPanel 默认 activeTab='appearance'，需点击 "AI 配置" tab 切换
 *
 * 不修改源代码；只读源代码以对齐行为。
 */
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'

// ============================================================================
// mock useAppStore（提供 settings + actions）
// ============================================================================
const mockAppStore = vi.hoisted(() => {
  const state = {
    settings: {
      appearance: {
        backgroundColor: '#ffffff',
        accentColor: '#3b82f6',
        surfaceColor: '#ffffff',
        surfaceBorderColor: '#e5e7eb',
        textColor: '#1f2937',
        textMutedColor: '#6b7280',
        backgroundType: 'color',
        backgroundGradient: '',
        backgroundImage: '',
        surfaceOpacity: 1,
        surfaceBlur: 0,
        fontSize: 14,
      },
      behavior: {
        searchEngine: 'bing' as const,
        defaultLayoutMode: 'free' as const,
        defaultGridSize: 10,
        startupPanel: 'last',
        confirmBeforeDelete: true,
        widgetSnapToEdge: true,
        memoryHibernateEnabled: false,
        memoryHibernateAfterMin: 5,
        memoryHibernateThresholdGB: 1.5,
      },
    },
    showSettings: true,
    updateAppearance: vi.fn(),
    updateBehavior: vi.fn(),
    updateHomeCustomization: vi.fn(),
  }
  return { state }
})

vi.mock('../../stores/useAppStore', () => ({
  useAppStore: Object.assign(
    (selector?: (s: typeof mockAppStore.state) => unknown) =>
      selector ? selector(mockAppStore.state) : mockAppStore.state,
    {
      setState: (next: Partial<typeof mockAppStore.state>) =>
        Object.assign(mockAppStore.state, next),
    }
  ),
}))

// ============================================================================
// mock useRuntimeModeStore
// ============================================================================
const mockRuntimeStore = vi.hoisted(() => {
  const state = {
    mode: 'auto' as 'auto' | 'cloud' | 'local',
    effectiveMode: 'local' as 'local' | 'cloud',
    isServerOnline: false,
    isOfflineDowngraded: true,
    setMode: vi.fn(),
  }
  return { state }
})

vi.mock('../../stores/useRuntimeModeStore', () => ({
  useRuntimeModeStore: (selector: (s: typeof mockRuntimeStore.state) => unknown) =>
    selector(mockRuntimeStore.state),
  getModeLabel: (mode: string) =>
    mode === 'cloud' ? '云端' : mode === 'local' ? '本地' : '自动',
  getEffectiveModeLabel: (mode: string) => (mode === 'cloud' ? '云端' : '本地'),
}))

// ============================================================================
// mock useThinkingLevelStore
// ============================================================================
const mockThinkingStore = vi.hoisted(() => {
  const state = {
    currentLevel: 'medium' as 'minimal' | 'low' | 'medium' | 'high',
    defaultLevel: 'medium' as 'minimal' | 'low' | 'medium' | 'high',
    setLevel: vi.fn(),
    setDefaultLevel: vi.fn(),
  }
  return { state }
})

vi.mock('../../stores/useThinkingLevelStore', () => ({
  useThinkingLevelStore: (selector: (s: typeof mockThinkingStore.state) => unknown) =>
    selector(mockThinkingStore.state),
}))

// ============================================================================
// mock 子组件（避免子组件的复杂依赖）
// 用 JSX 同步工厂（vitest 配置了 @vitejs/plugin-react，支持 JSX transform）
// ============================================================================
vi.mock('../settings/AIApiConfig', () => ({
  default: function MockAIApiConfig() {
    return <div data-testid="mock-ai-api-config">AIApiConfig</div>
  },
}))

vi.mock('../settings/AIPromptConfig', () => ({
  default: function MockAIPromptConfig() {
    return <div data-testid="mock-ai-prompt-config">AIPromptConfig</div>
  },
}))

vi.mock('../settings/AISkillsManager', () => ({
  default: function MockAISkillsManager() {
    return <div data-testid="mock-ai-skills-manager">AISkillsManager</div>
  },
}))

vi.mock('../settings/FavoritesManager', () => ({
  default: function MockFavoritesManager() {
    return <div data-testid="mock-favorites-manager" />
  },
}))

vi.mock('../settings/ShortcutsConfig', () => ({
  default: function MockShortcutsConfig() {
    return <div data-testid="mock-shortcuts-config" />
  },
}))

vi.mock('../settings/AccessibilityConfig', () => ({
  default: function MockAccessibilityConfig() {
    return <div data-testid="mock-accessibility-config" />
  },
}))

vi.mock('../settings/HomeTemplateSelector', () => ({
  default: function MockHomeTemplateSelector() {
    return <div data-testid="mock-home-template-selector" />
  },
}))

// ============================================================================
// mock 其他外部依赖（避免副作用）
// ============================================================================
vi.mock('../../api/export', () => ({
  exportAllData: vi.fn(),
  importData: vi.fn(),
}))

vi.mock('../../api/adapter', () => ({
  withFallback: vi.fn(),
  detectBackend: vi.fn(),
}))

vi.mock('../../utils/deviceAuth', () => ({
  getDeviceId: () => 'test-device-id',
  getServerToken: () => null,
  setServerToken: () => undefined,
}))

vi.mock('../../utils/color', () => ({
  gradientIsLight: () => false,
}))

// ============================================================================
// 导入被测组件（必须在所有 vi.mock 之后）
// ============================================================================
import SettingsPanel from '../SettingsPanel'

// ============================================================================
// 公共重置逻辑
// ============================================================================
beforeEach(() => {
  // 重置 runtime store
  mockRuntimeStore.state.mode = 'auto'
  mockRuntimeStore.state.effectiveMode = 'local'
  mockRuntimeStore.state.isServerOnline = false
  mockRuntimeStore.state.isOfflineDowngraded = true
  mockRuntimeStore.state.setMode = vi.fn()

  // 重置 thinking store
  mockThinkingStore.state.currentLevel = 'medium'
  mockThinkingStore.state.defaultLevel = 'medium'
  mockThinkingStore.state.setLevel = vi.fn()
  mockThinkingStore.state.setDefaultLevel = vi.fn()

  // 重置 app store
  mockAppStore.state.showSettings = true
  mockAppStore.state.updateAppearance = vi.fn()
  mockAppStore.state.updateBehavior = vi.fn()
  mockAppStore.state.updateHomeCustomization = vi.fn()
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

// ============================================================================
// 工具函数
// ============================================================================

/** 切换到 AI 配置 tab */
function switchToAITab(): void {
  const aiTab = screen.getByRole('button', { name: /AI 配置/ })
  fireEvent.click(aiTab)
}

/**
 * 在菜单中查找指定 option 文本对应的 select 元素
 *
 * 必要性：SettingsPanel AI tab 中有 2 个 select（思考等级 + 运行模式），
 * 需要精确区分。通过 option 文本内容筛选。
 */
function getSelectWithOption(optionText: string): HTMLSelectElement {
  const selects = screen.getAllByRole('combobox')
  for (const select of selects) {
    const options = select.querySelectorAll('option')
    if (Array.from(options).some(o => o.textContent?.includes(optionText))) {
      return select as HTMLSelectElement
    }
  }
  throw new Error(`Select with option containing "${optionText}" not found`)
}

// ============================================================================
// 1. AI tab 切换
// ============================================================================
describe('AI tab 切换', () => {
  test('初始时（appearance tab）不显示 AI 配置内容', () => {
    render(<SettingsPanel />)
    expect(screen.queryByText('默认思考等级')).not.toBeInTheDocument()
    expect(screen.queryByText('默认运行模式')).not.toBeInTheDocument()
  })

  test('点击 AI 配置 tab 后显示 "默认思考等级" 标题', () => {
    render(<SettingsPanel />)
    switchToAITab()
    // "默认思考等级" 出现在 h3 标题 + span label 两处，用 getAllByText
    const matches = screen.getAllByText('默认思考等级')
    expect(matches.length).toBeGreaterThanOrEqual(1)
    // 至少有一个是 h3 标题
    expect(matches.some(el => el.tagName === 'H3')).toBe(true)
  })

  test('点击 AI 配置 tab 后显示 "默认运行模式" 标题', () => {
    render(<SettingsPanel />)
    switchToAITab()
    // "默认运行模式" 出现在 h3 标题
    const matches = screen.getAllByText('默认运行模式')
    expect(matches.length).toBeGreaterThanOrEqual(1)
    expect(matches.some(el => el.tagName === 'H3')).toBe(true)
  })

  test('AI tab 切换后 active 状态正确（pill active 样式）', () => {
    render(<SettingsPanel />)
    const aiTab = screen.getByRole('button', { name: /AI 配置/ })
    fireEvent.click(aiTab)
    // active 状态会添加 'active' class
    expect(aiTab.className).toContain('active')
  })
})

// ============================================================================
// 2. 默认思考等级配置
// ============================================================================
describe('默认思考等级配置', () => {
  test('AI tab 渲染时显示思考等级描述文本（medium → "中度思考"）', () => {
    mockThinkingStore.state.defaultLevel = 'medium'
    render(<SettingsPanel />)
    switchToAITab()
    // medium 描述："中度思考（默认，平衡速度与质量）"
    expect(screen.getByText(/中度思考/)).toBeInTheDocument()
  })

  test('思考等级下拉菜单有 4 档选项（极简/低/中/高）', () => {
    render(<SettingsPanel />)
    switchToAITab()
    // 思考等级 select 有 "极简" 选项
    const thinkingSelect = getSelectWithOption('极简')
    const options = thinkingSelect.querySelectorAll('option')
    expect(options).toHaveLength(4)
    expect(Array.from(options).map(o => o.textContent)).toEqual([
      '极简',
      '低',
      '中',
      '高',
    ])
  })

  test('选择思考等级 "高" 后调用 setDefaultLevel("high")', () => {
    render(<SettingsPanel />)
    switchToAITab()
    const thinkingSelect = getSelectWithOption('极简')
    fireEvent.change(thinkingSelect, { target: { value: 'high' } })
    expect(mockThinkingStore.state.setDefaultLevel).toHaveBeenCalledWith('high')
    expect(mockThinkingStore.state.setDefaultLevel).toHaveBeenCalledTimes(1)
  })

  test('选择思考等级 "极简" 后调用 setDefaultLevel("minimal")', () => {
    render(<SettingsPanel />)
    switchToAITab()
    const thinkingSelect = getSelectWithOption('极简')
    fireEvent.change(thinkingSelect, { target: { value: 'minimal' } })
    expect(mockThinkingStore.state.setDefaultLevel).toHaveBeenCalledWith('minimal')
  })

  test('defaultLevel=minimal 时描述显示 "极简思考"', () => {
    mockThinkingStore.state.defaultLevel = 'minimal'
    render(<SettingsPanel />)
    switchToAITab()
    expect(screen.getByText(/极简思考/)).toBeInTheDocument()
  })

  test('defaultLevel=high 时描述显示 "高度思考"', () => {
    mockThinkingStore.state.defaultLevel = 'high'
    render(<SettingsPanel />)
    switchToAITab()
    expect(screen.getByText(/高度思考/)).toBeInTheDocument()
  })
})

// ============================================================================
// 3. 默认运行模式配置
// ============================================================================
describe('默认运行模式配置', () => {
  test('运行模式下拉菜单有 3 选项（云端/本地/自动）', () => {
    render(<SettingsPanel />)
    switchToAITab()
    // 运行模式 select 有 "云端" 选项（不同于思考等级的 "极简"）
    const runtimeSelect = getSelectWithOption('云端')
    const options = runtimeSelect.querySelectorAll('option')
    expect(options).toHaveLength(3)
    expect(Array.from(options).map(o => o.textContent)).toEqual([
      '☁️ 云端（服务器 Pi Agent）',
      '💻 本地（轻 Agent，调 API Key）',
      '⚡ 自动（在线用云端，离线切本地）',
    ])
  })

  test('选择 "云端" 后调用 setMode("cloud")', () => {
    render(<SettingsPanel />)
    switchToAITab()
    const runtimeSelect = getSelectWithOption('云端')
    fireEvent.change(runtimeSelect, { target: { value: 'cloud' } })
    expect(mockRuntimeStore.state.setMode).toHaveBeenCalledWith('cloud')
    expect(mockRuntimeStore.state.setMode).toHaveBeenCalledTimes(1)
  })

  test('选择 "本地" 后调用 setMode("local")', () => {
    render(<SettingsPanel />)
    switchToAITab()
    const runtimeSelect = getSelectWithOption('云端')
    fireEvent.change(runtimeSelect, { target: { value: 'local' } })
    expect(mockRuntimeStore.state.setMode).toHaveBeenCalledWith('local')
  })

  test('选择 "自动" 后调用 setMode("auto")', () => {
    render(<SettingsPanel />)
    switchToAITab()
    const runtimeSelect = getSelectWithOption('云端')
    fireEvent.change(runtimeSelect, { target: { value: 'auto' } })
    expect(mockRuntimeStore.state.setMode).toHaveBeenCalledWith('auto')
  })

  test('mode=cloud 时描述显示 "所有 AI 请求走服务器 Pi Agent（云端）"', () => {
    mockRuntimeStore.state.mode = 'cloud'
    render(<SettingsPanel />)
    switchToAITab()
    expect(screen.getByText(/所有 AI 请求走服务器 Pi Agent（云端）/)).toBeInTheDocument()
  })

  test('mode=local 时描述显示 "所有 AI 请求走本地轻 Agent"', () => {
    mockRuntimeStore.state.mode = 'local'
    render(<SettingsPanel />)
    switchToAITab()
    expect(screen.getByText(/所有 AI 请求走本地轻 Agent/)).toBeInTheDocument()
  })

  test('mode=auto + online 时描述显示 "自动模式：当前在线"', () => {
    mockRuntimeStore.state.mode = 'auto'
    mockRuntimeStore.state.isServerOnline = true
    mockRuntimeStore.state.isOfflineDowngraded = false
    render(<SettingsPanel />)
    switchToAITab()
    expect(screen.getByText(/自动模式：当前在线/)).toBeInTheDocument()
  })

  test('mode=auto + offline 时描述显示 "自动模式：当前离线"', () => {
    mockRuntimeStore.state.mode = 'auto'
    mockRuntimeStore.state.isServerOnline = false
    mockRuntimeStore.state.isOfflineDowngraded = true
    render(<SettingsPanel />)
    switchToAITab()
    expect(screen.getByText(/自动模式：当前离线/)).toBeInTheDocument()
  })

  test('isOfflineDowngraded=true 时显示 "已离线降级" 提示', () => {
    mockRuntimeStore.state.mode = 'auto'
    mockRuntimeStore.state.isOfflineDowngraded = true
    render(<SettingsPanel />)
    switchToAITab()
    expect(screen.getByText(/已离线降级/)).toBeInTheDocument()
  })

  test('显示实际生效模式标签（effectiveMode=local → "本地"）', () => {
    mockRuntimeStore.state.mode = 'auto'
    mockRuntimeStore.state.effectiveMode = 'local'
    render(<SettingsPanel />)
    switchToAITab()
    // "当前生效" 描述行包含 "实际生效模式：本地"
    expect(screen.getByText(/实际生效模式：本地/)).toBeInTheDocument()
  })
})

// ============================================================================
// 4. 子组件渲染
// ============================================================================
describe('子组件渲染', () => {
  test('AI tab 渲染 AIApiConfig 子组件', () => {
    render(<SettingsPanel />)
    switchToAITab()
    expect(screen.getByTestId('mock-ai-api-config')).toBeInTheDocument()
  })

  test('AI tab 渲染 AIPromptConfig 子组件', () => {
    render(<SettingsPanel />)
    switchToAITab()
    expect(screen.getByTestId('mock-ai-prompt-config')).toBeInTheDocument()
  })

  test('AI tab 渲染 AISkillsManager 子组件', () => {
    render(<SettingsPanel />)
    switchToAITab()
    expect(screen.getByTestId('mock-ai-skills-manager')).toBeInTheDocument()
  })

  test('初始时（appearance tab）不渲染 AI 子组件', () => {
    render(<SettingsPanel />)
    expect(screen.queryByTestId('mock-ai-api-config')).not.toBeInTheDocument()
  })
})

// ============================================================================
// 5. 关闭面板
// ============================================================================
describe('关闭面板', () => {
  test('点击 "完成" 按钮调用 useAppStore.setState({ showSettings: false })', () => {
    render(<SettingsPanel />)
    const doneButton = screen.getByRole('button', { name: '完成' })
    fireEvent.click(doneButton)
    expect(mockAppStore.state.showSettings).toBe(false)
  })

  test('点击关闭按钮（X 图标）调用 useAppStore.setState({ showSettings: false })', () => {
    render(<SettingsPanel />)
    // 找到关闭按钮（settings-close-btn class）
    const closeButton = document.querySelector('.settings-close-btn') as HTMLElement
    expect(closeButton).not.toBeNull()
    fireEvent.click(closeButton)
    expect(mockAppStore.state.showSettings).toBe(false)
  })
})
