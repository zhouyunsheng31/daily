/**
 * AIStatusBars vitest 单元测试（Phase 11 P1）
 *
 * 测试目标：
 * - ThinkingBar 渲染当前状态文案（thinking/tool_calling）
 * - 工具调用次数统计（仅本轮对话，从最后一条 user 消息开始）
 * - 点击 header 切换展开/收起状态
 * - 展开后显示工具调用详情列表
 * - 展开后无工具调用时显示"暂无工具调用"
 * - ConnectingBar 渲染"正在连接 AI..."
 *
 * mock 策略：
 * - 无需 mock（纯展示组件，无外部依赖）
 *
 * 不修改源代码；只读源代码以对齐行为。
 */
import { describe, test, expect, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { ThinkingBar, ConnectingBar } from '../AIStatusBars'
import type { ChatMessage } from '../../../types/ai'

// ============================================================================
// 辅助函数：构造 ChatMessage
// ============================================================================
function makeMessage(
  role: ChatMessage['role'],
  content: string,
  extra: Partial<ChatMessage> = {},
): ChatMessage {
  return { role, content, timestamp: Date.now(), ...extra }
}

function makeToolCall(id: string, name: string) {
  return { id, name, arguments: {} }
}

afterEach(() => {
  cleanup()
})

// ============================================================================
// 1. ThinkingBar 状态文案
// ============================================================================
describe('ThinkingBar 状态文案', () => {
  test("status='thinking' 时显示 '正在思考'", () => {
    // 验证 thinking 状态下的标题文案
    render(<ThinkingBar messages={[]} status="thinking" />)
    expect(screen.getByText('正在思考')).toBeInTheDocument()
  })

  test("status='tool_calling' 时显示 '正在调用工具'", () => {
    // 验证 tool_calling 状态下的标题文案切换
    render(<ThinkingBar messages={[]} status="tool_calling" />)
    expect(screen.getByText('正在调用工具')).toBeInTheDocument()
  })

  test("status='idle' 时也显示 '正在思考'（非 tool_calling 的默认文案）", () => {
    // 源码：isToolCalling = status === 'tool_calling'；非 tool_calling 一律显示"正在思考"
    render(<ThinkingBar messages={[]} status="idle" />)
    expect(screen.getByText('正在思考')).toBeInTheDocument()
  })

  test("status='error' 时显示 '正在思考'（error 状态由外层处理，ThinkingBar 仅显示思考文案）", () => {
    // ThinkingBar 不区分 error，只区分 tool_calling 和其他
    render(<ThinkingBar messages={[]} status="error" />)
    expect(screen.getByText('正在思考')).toBeInTheDocument()
  })
})

// ============================================================================
// 2. 工具调用次数统计
// ============================================================================
describe('工具调用次数统计', () => {
  test('无消息时不显示工具调用次数', () => {
    // messages 为空数组 → count=0 → 不渲染"工具调用 N 次"
    render(<ThinkingBar messages={[]} status="thinking" />)
    expect(screen.queryByText(/工具调用/)).not.toBeInTheDocument()
  })

  test('本轮（最后一条 user 之后）有 2 次工具调用时显示"工具调用 2 次"', () => {
    // 构造：user → assistant(toolCalls: 2)
    const messages: ChatMessage[] = [
      makeMessage('user', 'hello'),
      makeMessage('assistant', 'ok', {
        toolCalls: [makeToolCall('tc-1', 'read_widget'), makeToolCall('tc-2', 'write_note')],
      }),
    ]
    render(<ThinkingBar messages={messages} status="tool_calling" />)
    expect(screen.getByText(/工具调用 2 次/)).toBeInTheDocument()
  })

  test('仅统计本轮对话的工具调用（最后一条 user 之前的 toolCalls 不计）', () => {
    // 构造：assistant(toolCalls:1) → user → assistant(toolCalls:1)
    // 只统计最后一条 user 之后的 toolCalls
    const messages: ChatMessage[] = [
      makeMessage('assistant', 'prev round', {
        toolCalls: [makeToolCall('old-tc', 'old_tool')],
      }),
      makeMessage('user', 'new round'),
      makeMessage('assistant', 'current round', {
        toolCalls: [makeToolCall('new-tc', 'new_tool')],
      }),
    ]
    render(<ThinkingBar messages={messages} status="thinking" />)
    // 应该只显示 1 次（不是 2 次）
    expect(screen.getByText(/工具调用 1 次/)).toBeInTheDocument()
  })

  test('无 user 消息时统计全部 assistant.toolCalls', () => {
    // 源码：lastUserIdx < 0 时设为 0，统计从 index 0 开始
    const messages: ChatMessage[] = [
      makeMessage('assistant', 'a1', {
        toolCalls: [makeToolCall('tc-1', 'tool_a')],
      }),
      makeMessage('assistant', 'a2', {
        toolCalls: [makeToolCall('tc-2', 'tool_b'), makeToolCall('tc-3', 'tool_c')],
      }),
    ]
    render(<ThinkingBar messages={messages} status="thinking" />)
    expect(screen.getByText(/工具调用 3 次/)).toBeInTheDocument()
  })

  test('不统计 role="tool" 的消息（避免次数翻倍）', () => {
    // 源码注释：只统计 assistant.toolCalls，不统计 tool 消息
    const messages: ChatMessage[] = [
      makeMessage('user', 'hello'),
      makeMessage('assistant', 'calling', {
        toolCalls: [makeToolCall('tc-1', 'read_widget')],
      }),
      makeMessage('tool', 'result', { toolCallId: 'tc-1' }),
    ]
    render(<ThinkingBar messages={messages} status="tool_calling" />)
    expect(screen.getByText(/工具调用 1 次/)).toBeInTheDocument()
  })
})

// ============================================================================
// 3. 点击 header 切换展开/收起
// ============================================================================
describe('点击 header 切换展开/收起', () => {
  test('初始未展开时不显示详情区域', () => {
    // 有工具调用但未展开 → 不显示详情
    const messages: ChatMessage[] = [
      makeMessage('user', 'hi'),
      makeMessage('assistant', 'ok', {
        toolCalls: [makeToolCall('tc-1', 'read_widget')],
      }),
    ]
    render(<ThinkingBar messages={messages} status="thinking" />)
    // 详情项 "read_widget" 不应可见
    expect(screen.queryByText('read_widget')).not.toBeInTheDocument()
  })

  test('点击 header 后展开显示工具调用详情', () => {
    // 展开后应显示工具名列表
    const messages: ChatMessage[] = [
      makeMessage('user', 'hi'),
      makeMessage('assistant', 'ok', {
        toolCalls: [makeToolCall('tc-1', 'read_widget'), makeToolCall('tc-2', 'write_note')],
      }),
    ]
    render(<ThinkingBar messages={messages} status="thinking" />)
    // 点击 header
    const header = screen.getByText('正在思考').closest('.ai-thinking-bar-header')
    expect(header).not.toBeNull()
    fireEvent.click(header!)
    // 展开后应显示工具名
    expect(screen.getByText('read_widget')).toBeInTheDocument()
    expect(screen.getByText('write_note')).toBeInTheDocument()
  })

  test('再次点击 header 收起详情', () => {
    const messages: ChatMessage[] = [
      makeMessage('user', 'hi'),
      makeMessage('assistant', 'ok', {
        toolCalls: [makeToolCall('tc-1', 'read_widget')],
      }),
    ]
    render(<ThinkingBar messages={messages} status="thinking" />)
    const header = screen.getByText('正在思考').closest('.ai-thinking-bar-header')!
    // 展开
    fireEvent.click(header)
    expect(screen.getByText('read_widget')).toBeInTheDocument()
    // 收起
    fireEvent.click(header)
    expect(screen.queryByText('read_widget')).not.toBeInTheDocument()
  })

  test('展开后无工具调用时显示"暂无工具调用"', () => {
    // 展开后 details.length === 0 → 显示"暂无工具调用"
    render(<ThinkingBar messages={[]} status="thinking" />)
    const header = screen.getByText('正在思考').closest('.ai-thinking-bar-header')!
    fireEvent.click(header)
    expect(screen.getByText('暂无工具调用')).toBeInTheDocument()
  })

  test('header title 属性随展开状态切换', () => {
    // 源码：expanded ? '点击收起' : '点击展开查看工具调用详情'
    render(<ThinkingBar messages={[]} status="thinking" />)
    const header = screen.getByText('正在思考').closest('.ai-thinking-bar-header')!
    expect(header).toHaveAttribute('title', '点击展开查看工具调用详情')
    fireEvent.click(header)
    expect(header).toHaveAttribute('title', '点击收起')
  })
})

// ============================================================================
// 4. 状态变化时 UI 更新
// ============================================================================
describe('状态变化时 UI 更新', () => {
  test('从 thinking 切到 tool_calling 文案随之变化', () => {
    // 同一组件 rerender 后文案应切换
    const { rerender } = render(<ThinkingBar messages={[]} status="thinking" />)
    expect(screen.getByText('正在思考')).toBeInTheDocument()
    rerender(<ThinkingBar messages={[]} status="tool_calling" />)
    expect(screen.getByText('正在调用工具')).toBeInTheDocument()
    expect(screen.queryByText('正在思考')).not.toBeInTheDocument()
  })

  test('新增工具调用后次数更新', () => {
    // 先渲染 1 次工具调用，再 rerender 为 2 次
    const messages1: ChatMessage[] = [
      makeMessage('user', 'hi'),
      makeMessage('assistant', 'ok', {
        toolCalls: [makeToolCall('tc-1', 'tool_a')],
      }),
    ]
    const messages2: ChatMessage[] = [
      ...messages1,
      makeMessage('assistant', 'more', {
        toolCalls: [makeToolCall('tc-2', 'tool_b')],
      }),
    ]
    const { rerender } = render(<ThinkingBar messages={messages1} status="thinking" />)
    expect(screen.getByText(/工具调用 1 次/)).toBeInTheDocument()
    rerender(<ThinkingBar messages={messages2} status="thinking" />)
    expect(screen.getByText(/工具调用 2 次/)).toBeInTheDocument()
  })
})

// ============================================================================
// 5. ConnectingBar 渲染
// ============================================================================
describe('ConnectingBar', () => {
  test('渲染"正在连接 AI..."文案', () => {
    // 验证连接中状态条的基本渲染
    render(<ConnectingBar />)
    expect(screen.getByText('正在连接 AI...')).toBeInTheDocument()
  })

  test('渲染渐变条容器', () => {
    // 验证 DOM 结构包含 progress 条
    const { container } = render(<ConnectingBar />)
    expect(container.querySelector('.ai-connecting-bar')).not.toBeNull()
    expect(container.querySelector('.ai-connecting-bar-progress')).not.toBeNull()
  })
})
