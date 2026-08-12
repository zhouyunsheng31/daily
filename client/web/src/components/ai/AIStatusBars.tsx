/**
 * AIStatusBars — AI 思考/连接状态渐变条组件
 *
 * 功能：
 * - ThinkingBar: AI 思考中显示，渐变条 + 可展开查看工具调用详情 + 工具调用次数
 * - ConnectingBar: AI 未连上时显示，"正在连接" + 渐变条
 *
 * 共享给 AIAssistant / AIAssistantSidebar 使用
 */

import { useState, useMemo } from 'react'
import { ChevronRight, Brain, Wifi, Wrench } from 'lucide-react'
import type { ChatMessage } from '../../types/ai'

interface ThinkingBarProps {
  /** 当前会话的全部消息（用于统计工具调用次数和展开详情） */
  messages: ChatMessage[]
  /** 当前会话状态 */
  status: 'idle' | 'thinking' | 'tool_calling' | 'waiting_confirmation' | 'error'
}

/**
 * 统计本轮对话中的工具调用次数和详情
 * 本轮定义：从最后一条 user 消息开始到最新消息
 */
function useCurrentRoundToolCalls(messages: ChatMessage[]) {
  return useMemo(() => {
    if (!messages || messages.length === 0) return { count: 0, details: [] as { name: string; id: string }[] }
    // 找到最后一条 user 消息的索引
    let lastUserIdx = -1
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'user') {
        lastUserIdx = i
        break
      }
    }
    if (lastUserIdx < 0) lastUserIdx = 0
    // 只统计 assistant.toolCalls（AI 发起的工具调用次数）
    // 注意：不要同时统计 tool 消息，因为每次工具调用会产生 assistant(含toolCalls) + tool(结果) 两条消息，
    // 同时统计会导致次数翻倍
    let count = 0
    const details: { name: string; id: string }[] = []
    for (let i = lastUserIdx; i < messages.length; i++) {
      const msg = messages[i]
      if (msg.role === 'assistant' && msg.toolCalls && msg.toolCalls.length > 0) {
        for (const tc of msg.toolCalls) {
          count++
          details.push({ name: tc.name, id: tc.id })
        }
      }
    }
    return { count, details }
  }, [messages])
}

export function ThinkingBar({ messages, status }: ThinkingBarProps) {
  const [expanded, setExpanded] = useState(false)
  const { count, details } = useCurrentRoundToolCalls(messages)

  // 状态文案
  const isToolCalling = status === 'tool_calling'
  const title = isToolCalling ? '正在调用工具' : '正在思考'

  return (
    <div className="ai-thinking-bar">
      <div
        className="ai-thinking-bar-header"
        onClick={() => setExpanded(v => !v)}
        title={expanded ? '点击收起' : '点击展开查看工具调用详情'}
      >
        <span className="ai-thinking-bar-title">
          <Brain size={12} />
          {title}
        </span>
        {count > 0 && (
          <span className="ai-thinking-bar-tool-count">
            · 工具调用 {count} 次
          </span>
        )}
        <span className={`ai-thinking-bar-toggle ${expanded ? 'ai-thinking-bar-toggle-expanded' : ''}`}>
          <ChevronRight size={12} />
        </span>
      </div>

      {/* 渐变条（思考中或工具调用中） */}
      <div className="ai-thinking-bar-progress" />

      {/* 工具调用次数条（有工具调用时显示） */}
      {count > 0 && <div className="ai-tool-progress-bar" />}

      {/* 展开后的详情 */}
      {expanded && details.length > 0 && (
        <div className="ai-thinking-bar-details">
          {details.map((d, i) => (
            <div key={`${d.id}-${i}`} className="ai-thinking-bar-details-item">
              <Wrench size={9} style={{ verticalAlign: 'middle', marginRight: 4 }} />
              {d.name}
            </div>
          ))}
        </div>
      )}

      {/* 展开后但无工具调用 */}
      {expanded && details.length === 0 && (
        <div className="ai-thinking-bar-details">
          <div className="ai-thinking-bar-details-item">
            暂无工具调用
          </div>
        </div>
      )}
    </div>
  )
}

export function ConnectingBar() {
  return (
    <div className="ai-connecting-bar">
      <div className="ai-connecting-bar-header">
        <Wifi size={12} />
        <span>正在连接 AI...</span>
      </div>
      <div className="ai-connecting-bar-progress" />
    </div>
  )
}
