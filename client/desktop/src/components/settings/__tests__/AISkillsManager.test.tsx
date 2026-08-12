/**
 * AISkillsManager 组件 vitest 单元测试（Phase 11 P0）
 *
 * 测试目标：
 * - 渲染 skills 列表（name/version/source 标签/description）
 * - 点击启用/禁用 checkbox 调用 api.put('/skills/:id', { enabled })
 * - 点击查看内容（Eye 按钮）调用 api.get('/skills/:id/content') 并显示模态框
 * - 关闭内容查看模态框
 * - skills 列表为空时显示占位文本
 * - GET 失败时显示错误信息 + 重试按钮
 *
 * mock 策略：
 * - vi.mock('../../../api/client') 替换 api 对象和 ApiError 类
 * - 用 vi.hoisted 暴露可变 mockApi，便于每个用例控制返回值/抛错
 * - window.alert 用 vi.fn() 替换
 *
 * 注意：
 * - vitest 4.x 的 vi.fn 不再支持双泛型
 * - 不修改源代码；只读源代码以对齐行为
 */
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'

// ============================================================================
// mock api/client：暴露可变 mockApi 对象 + MockApiError 类
// ============================================================================
const mockApi = vi.hoisted(() => {
  class MockApiError extends Error {
    status: number
    data: unknown
    constructor(message: string, status: number, data?: unknown) {
      super(message)
      this.name = 'ApiError'
      this.status = status
      this.data = data
    }
  }

  const apiObj = {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  }
  return { apiObj, MockApiError }
})

vi.mock('../../../api/client', () => ({
  api: mockApi.apiObj,
  ApiError: mockApi.MockApiError,
}))

// ============================================================================
// 导入被测组件（必须在 vi.mock 之后）
// ============================================================================
import AISkillsManager from '../AISkillsManager'

// ============================================================================
// 公共：默认 skills 数据
// ============================================================================
interface SkillInfo {
  id: string
  name: string
  description: string
  version: string
  source: 'builtin' | 'user'
  enabled: boolean
  canDelete: boolean
}

function defaultSkills(): SkillInfo[] {
  return [
    {
      id: 'skill-builtin-1',
      name: 'weather',
      description: '查询天气信息',
      version: '1.0.0',
      source: 'builtin',
      enabled: true,
      canDelete: false,
    },
    {
      id: 'skill-user-1',
      name: 'my-custom-skill',
      description: '用户自定义 skill',
      version: '0.1.0',
      source: 'user',
      enabled: false,
      canDelete: true,
    },
  ]
}

// 保存原始 alert/confirm
const originalAlert = (window as { alert?: unknown }).alert
const originalConfirm = (window as { confirm?: unknown }).confirm
const alertMock = vi.fn()
const confirmMock = vi.fn()

beforeEach(() => {
  // 默认 GET 成功返回
  mockApi.apiObj.get.mockResolvedValue({ skills: defaultSkills() })
  mockApi.apiObj.put.mockResolvedValue({ ok: true })
  mockApi.apiObj.post.mockResolvedValue({ ok: true })
  mockApi.apiObj.delete.mockResolvedValue({ ok: true })

  // mock alert/confirm
  ;(window as unknown as { alert: typeof alertMock }).alert = alertMock
  ;(window as unknown as { confirm: typeof confirmMock }).confirm = confirmMock
  alertMock.mockClear()
  confirmMock.mockReturnValue(true)
  // 抑制源码 console.error 污染
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.clearAllMocks()
  // 恢复 alert/confirm
  ;(window as unknown as { alert: unknown }).alert = originalAlert
  ;(window as unknown as { confirm: unknown }).confirm = originalConfirm
})

// ============================================================================
// 1. 渲染：skills 列表
// ============================================================================
describe('渲染：skills 列表', () => {
  test('GET /skills 加载完成后渲染 skills 列表（name/version/source 标签）', async () => {
    // 用例目的：验证 skills 列表渲染，包含 name/version/source 标签
    render(<AISkillsManager />)
    await waitFor(() => {
      expect(screen.getByText('weather')).toBeInTheDocument()
    })
    // 第二个 skill
    expect(screen.getByText('my-custom-skill')).toBeInTheDocument()
    // 来源标签
    expect(screen.getByText('内置')).toBeInTheDocument()
    expect(screen.getByText('用户')).toBeInTheDocument()
    // 版本（v1.0.0 / v0.1.0）
    expect(screen.getByText('v1.0.0')).toBeInTheDocument()
    expect(screen.getByText('v0.1.0')).toBeInTheDocument()
  })

  test('渲染描述文本（description）', async () => {
    // 用例目的：验证 skill 描述正确渲染
    render(<AISkillsManager />)
    await waitFor(() => {
      expect(screen.getByText('查询天气信息')).toBeInTheDocument()
    })
    expect(screen.getByText('用户自定义 skill')).toBeInTheDocument()
  })

  test('挂载时调用 api.get("/skills") 加载 skills', async () => {
    // 用例目的：验证挂载时发起 GET 请求
    render(<AISkillsManager />)
    await waitFor(() => {
      expect(mockApi.apiObj.get).toHaveBeenCalledWith('/skills')
    })
    expect(mockApi.apiObj.get).toHaveBeenCalledTimes(1)
  })

  test('渲染 "添加 Skill" 按钮 + 标题 "Skills 管理"', async () => {
    // 用例目的：验证标题和添加按钮渲染
    render(<AISkillsManager />)
    await waitFor(() => {
      expect(screen.getByText('Skills 管理')).toBeInTheDocument()
    })
    expect(screen.getByText('添加 Skill')).toBeInTheDocument()
  })
})

// ============================================================================
// 2. 启用/禁用切换
// ============================================================================
describe('启用/禁用切换', () => {
  test('点击 enabled=true 的 skill 的 checkbox 调用 api.put("/skills/:id", { enabled: false })', async () => {
    // 用例目的：验证点击 checkbox 切换启用状态，调用 PUT
    render(<AISkillsManager />)
    await waitFor(() => {
      expect(screen.getByText('weather')).toBeInTheDocument()
    })

    // weather skill enabled=true，点击 checkbox 切换为 false
    const checkboxes = screen.getAllByRole('checkbox')
    // 第一个 checkbox 对应 weather（enabled=true）
    const weatherCheckbox = checkboxes[0]
    expect(weatherCheckbox).toBeChecked()
    fireEvent.click(weatherCheckbox)

    await waitFor(() => {
      expect(mockApi.apiObj.put).toHaveBeenCalledWith('/skills/skill-builtin-1', {
        enabled: false,
      })
    })
  })

  test('点击 enabled=false 的 skill 的 checkbox 调用 api.put("/skills/:id", { enabled: true })', async () => {
    // 用例目的：验证点击 disabled skill 的 checkbox 切换为 true
    render(<AISkillsManager />)
    await waitFor(() => {
      expect(screen.getByText('my-custom-skill')).toBeInTheDocument()
    })

    const checkboxes = screen.getAllByRole('checkbox')
    // 第二个 checkbox 对应 my-custom-skill（enabled=false）
    const userCheckbox = checkboxes[1]
    expect(userCheckbox).not.toBeChecked()
    fireEvent.click(userCheckbox)

    await waitFor(() => {
      expect(mockApi.apiObj.put).toHaveBeenCalledWith('/skills/skill-user-1', {
        enabled: true,
      })
    })
  })
})

// ============================================================================
// 3. 查看内容
// ============================================================================
describe('查看内容', () => {
  test('点击 Eye 按钮（title="查看内容"）调用 api.get("/skills/:id/content") 并显示模态框', async () => {
    // 用例目的：验证点击查看内容按钮发起 GET 并弹出模态框
    mockApi.apiObj.get.mockImplementation((path: string) => {
      if (path === '/skills') {
        return Promise.resolve({ skills: defaultSkills() })
      }
      if (path === '/skills/skill-builtin-1/content') {
        return Promise.resolve({
          id: 'skill-builtin-1',
          content: '# Weather Skill\n\n查询天气的 skill 内容。',
          source: 'builtin',
        })
      }
      return Promise.resolve({})
    })
    render(<AISkillsManager />)
    await waitFor(() => {
      expect(screen.getByText('weather')).toBeInTheDocument()
    })

    // 点击第一个 skill 的 "查看内容" 按钮
    const viewButtons = screen.getAllByTitle('查看内容')
    fireEvent.click(viewButtons[0])

    // 验证 GET /skills/:id/content 被调用
    await waitFor(() => {
      expect(mockApi.apiObj.get).toHaveBeenCalledWith('/skills/skill-builtin-1/content')
    })
    // 验证模态框显示（content 显示在 pre 中）
    await waitFor(() => {
      expect(screen.getByText(/查询天气的 skill 内容/)).toBeInTheDocument()
    })
  })

  test('模态框显示 skill name + source + version 信息', async () => {
    // 用例目的：验证模态框头部显示 skill 元信息
    mockApi.apiObj.get.mockImplementation((path: string) => {
      if (path === '/skills') {
        return Promise.resolve({ skills: defaultSkills() })
      }
      if (path === '/skills/skill-builtin-1/content') {
        return Promise.resolve({
          id: 'skill-builtin-1',
          content: 'skill content here',
          source: 'builtin',
        })
      }
      return Promise.resolve({})
    })
    render(<AISkillsManager />)
    await waitFor(() => {
      expect(screen.getByText('weather')).toBeInTheDocument()
    })

    fireEvent.click(screen.getAllByTitle('查看内容')[0])

    // 模态框中显示 "内置 · v1.0.0"（合并文本，区别于列表中的分开 span）
    await waitFor(() => {
      expect(screen.getByText('内置 · v1.0.0')).toBeInTheDocument()
    })
  })
})

// ============================================================================
// 4. 关闭内容查看模态框
// ============================================================================
describe('关闭内容查看模态框', () => {
  test('点击模态框关闭按钮（X）后模态框消失', async () => {
    // 用例目的：验证点击关闭按钮后模态框关闭
    mockApi.apiObj.get.mockImplementation((path: string) => {
      if (path === '/skills') {
        return Promise.resolve({ skills: defaultSkills() })
      }
      if (path === '/skills/skill-builtin-1/content') {
        return Promise.resolve({
          id: 'skill-builtin-1',
          content: 'skill content here',
          source: 'builtin',
        })
      }
      return Promise.resolve({})
    })
    render(<AISkillsManager />)
    await waitFor(() => {
      expect(screen.getByText('weather')).toBeInTheDocument()
    })

    // 打开模态框
    fireEvent.click(screen.getAllByTitle('查看内容')[0])
    await waitFor(() => {
      expect(screen.getByText('内置 · v1.0.0')).toBeInTheDocument()
    })

    // 记录打开前的 button 数量，找到模态框新增的关闭按钮
    const buttonsBefore = screen.getAllByRole('button')
    // 模态框已打开，buttonsBefore 包含关闭按钮
    // 找到模态框内的关闭按钮：它包含在模态框头部，是模态框特有的 button
    // 通过查找所有 button，找到其祖先为模态框遮罩的 button
    const closeButton = buttonsBefore.find(btn => {
      // 关闭按钮的父元素链中包含模态框（有 position:fixed 的祖先）
      let el: HTMLElement | null = btn as HTMLElement
      while (el) {
        if (el.style && el.style.position === 'fixed') return true
        el = el.parentElement
      }
      return false
    }) as HTMLElement

    expect(closeButton).toBeDefined()
    fireEvent.click(closeButton)

    // 验证模态框关闭（独特文本 "内置 · v1.0.0" 消失）
    await waitFor(() => {
      expect(screen.queryByText('内置 · v1.0.0')).not.toBeInTheDocument()
    })
  })
})

// ============================================================================
// 5. skills 列表为空
// ============================================================================
describe('skills 列表为空', () => {
  test('GET 返回空 skills 数组时显示占位文本', async () => {
    // 用例目的：验证空列表时显示占位提示
    mockApi.apiObj.get.mockResolvedValue({ skills: [] })
    render(<AISkillsManager />)
    await waitFor(() => {
      // 占位文本：暂无 Skills，点击"添加 Skill"创建
      expect(screen.getByText(/暂无 Skills/)).toBeInTheDocument()
    })
  })
})

// ============================================================================
// 6. 加载失败
// ============================================================================
describe('加载失败', () => {
  test('GET /skills 抛错时显示 "加载失败" + 重试按钮', async () => {
    // 用例目的：验证 GET 失败时显示错误信息和重试按钮
    mockApi.apiObj.get.mockRejectedValue(new mockApi.MockApiError('网络错误', 500))
    render(<AISkillsManager />)
    await waitFor(() => {
      expect(screen.getByText(/加载失败/)).toBeInTheDocument()
    })
    // 重试按钮
    expect(screen.getByText('重试')).toBeInTheDocument()
  })

  test('点击重试按钮重新调用 api.get("/skills")', async () => {
    // 用例目的：验证点击重试按钮重新加载
    mockApi.apiObj.get.mockRejectedValueOnce(new mockApi.MockApiError('网络错误', 500))
    render(<AISkillsManager />)
    await waitFor(() => {
      expect(screen.getByText('重试')).toBeInTheDocument()
    })

    // 第一次 GET 失败
    expect(mockApi.apiObj.get).toHaveBeenCalledTimes(1)

    // 点击重试
    mockApi.apiObj.get.mockResolvedValueOnce({ skills: defaultSkills() })
    fireEvent.click(screen.getByText('重试'))

    await waitFor(() => {
      expect(mockApi.apiObj.get).toHaveBeenCalledTimes(2)
    })
    // 重试后 skills 列表渲染
    await waitFor(() => {
      expect(screen.getByText('weather')).toBeInTheDocument()
    })
  })
})
