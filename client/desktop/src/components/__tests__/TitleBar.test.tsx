/**
 * TitleBar 组件单元测试 — Phase 13.1.1 自绘标题栏
 *
 * 测试目标：
 * - 渲染三个窗口控制按钮（最小化 / 最大化 / 关闭）
 * - 点击按钮调用对应 windowApi 方法
 * - 双击标题栏调用 maximizeToggle（按钮内双击不触发，靠 stopPropagation）
 * - isMaximized 状态切换：通过 onMaximizeChange 回调触发后，最大化按钮图标切换
 *
 * mock 策略：
 * - setupMockElectronAPI() 注入 window.windowApi（含 vi.fn 断言）
 * - 不需要 mock 任何 store 或子组件（TitleBar 仅依赖 windowApi）
 *
 * 设计依据（与实际源码对齐）：
 * - components/TitleBar.tsx 通过 window.windowApi 调用主进程 IPC
 * - 三个按钮的 aria-label：最小化 / （还原|最大化）/ 关闭
 * - 整条标题栏 onDoubleClick 触发 maximizeToggle
 */
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react'
import {
  setupMockElectronAPI,
  teardownMockElectronAPI,
  triggerWindowMaximizeChange,
} from '../../test/mocks/mockElectronAPI'

import TitleBar from '../TitleBar'

beforeEach(() => {
  setupMockElectronAPI()
})

afterEach(() => {
  cleanup()
  teardownMockElectronAPI()
  vi.clearAllMocks()
})

// ============================================================================
// 1. 渲染三个窗口控制按钮
// ============================================================================
describe('渲染三个窗口控制按钮', () => {
  test('渲染 "最小化" 按钮', () => {
    render(<TitleBar />)
    expect(screen.getByRole('button', { name: '最小化' })).toBeInTheDocument()
  })

  test('渲染 "最大化" 按钮（初始未最大化）', () => {
    render(<TitleBar />)
    expect(screen.getByRole('button', { name: '最大化' })).toBeInTheDocument()
  })

  test('渲染 "关闭" 按钮', () => {
    render(<TitleBar />)
    expect(screen.getByRole('button', { name: '关闭' })).toBeInTheDocument()
  })

  test('渲染应用名 "Daily"', () => {
    render(<TitleBar />)
    expect(screen.getByText('Daily')).toBeInTheDocument()
  })
})

// ============================================================================
// 2. 点击按钮调用对应 windowApi 方法
// ============================================================================
describe('点击按钮调用对应 windowApi 方法', () => {
  test('点击 "最小化" 调用 windowApi.minimize()', () => {
    render(<TitleBar />)
    const btn = screen.getByRole('button', { name: '最小化' })
    fireEvent.click(btn)
    expect(window.windowApi?.minimize).toHaveBeenCalledTimes(1)
    expect(window.windowApi?.maximizeToggle).not.toHaveBeenCalled()
    expect(window.windowApi?.close).not.toHaveBeenCalled()
  })

  test('点击 "最大化" 调用 windowApi.maximizeToggle()', () => {
    render(<TitleBar />)
    const btn = screen.getByRole('button', { name: '最大化' })
    fireEvent.click(btn)
    expect(window.windowApi?.maximizeToggle).toHaveBeenCalledTimes(1)
    expect(window.windowApi?.minimize).not.toHaveBeenCalled()
    expect(window.windowApi?.close).not.toHaveBeenCalled()
  })

  test('点击 "关闭" 调用 windowApi.close()', () => {
    render(<TitleBar />)
    const btn = screen.getByRole('button', { name: '关闭' })
    fireEvent.click(btn)
    expect(window.windowApi?.close).toHaveBeenCalledTimes(1)
    expect(window.windowApi?.minimize).not.toHaveBeenCalled()
    expect(window.windowApi?.maximizeToggle).not.toHaveBeenCalled()
  })
})

// ============================================================================
// 3. 双击标题栏调用 maximizeToggle
// ============================================================================
describe('双击标题栏调用 maximizeToggle', () => {
  test('双击标题栏主体触发 windowApi.maximizeToggle()', () => {
    render(<TitleBar />)
    const titlebar = screen.getByRole('banner')
    fireEvent.doubleClick(titlebar)
    expect(window.windowApi?.maximizeToggle).toHaveBeenCalledTimes(1)
  })

  test('点击按钮不会因事件冒泡触发标题栏双击（按钮 onClick stopPropagation）', () => {
    render(<TitleBar />)
    // 单击最小化按钮：仅触发 minimize，不应触发 maximizeToggle
    const minimizeBtn = screen.getByRole('button', { name: '最小化' })
    fireEvent.click(minimizeBtn)
    expect(window.windowApi?.minimize).toHaveBeenCalledTimes(1)
    expect(window.windowApi?.maximizeToggle).not.toHaveBeenCalled()
  })
})

// ============================================================================
// 4. isMaximized 状态切换
// ============================================================================
describe('isMaximized 状态切换', () => {
  test('初始渲染时调用 isMaximized() 查询当前状态', () => {
    render(<TitleBar />)
    expect(window.windowApi?.isMaximized).toHaveBeenCalledTimes(1)
  })

  test('主进程推送 maximize 事件后，"最大化" 按钮变为 "还原"', async () => {
    // await act：flush useEffect 中 isMaximized().then(setIsMaximized) 的微任务，避免 act 警告
    await act(async () => {
      render(<TitleBar />)
    })
    // 初始为 "最大化"
    expect(screen.getByRole('button', { name: '最大化' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '还原' })).not.toBeInTheDocument()

    // 模拟主进程推送 maximize 事件
    // 注：triggerWindowMaximizeChange 直接调用 setIsMaximized，需 act() 包裹以触发 React 重新渲染
    act(() => {
      triggerWindowMaximizeChange(true)
    })

    // 切换为 "还原"
    expect(screen.getByRole('button', { name: '还原' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '最大化' })).not.toBeInTheDocument()
  })

  test('主进程推送 unmaximize 事件后，"还原" 按钮变回 "最大化"', async () => {
    // await act：flush useEffect 中 isMaximized().then(setIsMaximized) 的微任务，避免 act 警告
    await act(async () => {
      render(<TitleBar />)
    })
    // 先最大化
    act(() => {
      triggerWindowMaximizeChange(true)
    })
    expect(screen.getByRole('button', { name: '还原' })).toBeInTheDocument()

    // 再还原
    act(() => {
      triggerWindowMaximizeChange(false)
    })
    expect(screen.getByRole('button', { name: '最大化' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '还原' })).not.toBeInTheDocument()
  })

  test('组件卸载时取消订阅 onMaximizeChange（避免内存泄漏）', () => {
    const { unmount } = render(<TitleBar />)
    expect(window.windowApi?.onMaximizeChange).toHaveBeenCalledTimes(1)
    unmount()
    // 卸载后触发事件不应抛错（cleanup 已执行）
    expect(() => triggerWindowMaximizeChange(true)).not.toThrow()
  })
})
