/**
 * BottomTaskbar — Phase 3 底部任务栏形态 AI 对话组件
 *
 * 设计依据：
 * - UI 原型 canvas-core-v8.html 第 1660-1668 行（底部任务栏模式）
 * - 设计文档 §5.2 + 决策日志第 40 条：靠右侧（不居中），上方微信风格聊天气泡
 *
 * 布局：
 * - fixed 定位，right: 20px; bottom: 20px（靠右侧，非居中）
 * - 上方：对话历史气泡区（用户靠右紫色，AI 靠左灰色），最大高度 40vh，可滚动
 * - 下方：椭圆形输入栏（border-radius: 28px, min 320px / max 560px）+ glass-bg
 *   含：输入框 + 发送按钮 + 切换到浮球按钮
 *
 * 能力迁移：同 FloatingOrb（WS 流式 / ask_user / permission_request / watchdog 保留）
 */
import { useState, useRef, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { ArrowLeftRight, Send, Loader2, MessageSquare, X } from 'lucide-react'
import { useAIStore } from '../stores/useAIStore'
import { useAppStore } from '../stores/useAppStore'
import AskUserCard from './AskUserCard'
import PermissionCard from './PermissionCard'
import { ThinkingBar, ConnectingBar } from './ai/AIStatusBars'
import type { ChatMessage } from '../types/ai'

export interface BottomTaskbarProps {
  onSwitchToOrb: () => void
}

export default function BottomTaskbar({ onSwitchToOrb }: BottomTaskbarProps) {
  const [input, setInput] = useState('')
  const [historyOpen, setHistoryOpen] = useState(true)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  // 订阅 AI store
  const activeSessionId = useAIStore(s => s.activeSessionId)
  const sessions = useAIStore(s => s.sessions)
  const sendMessage = useAIStore(s => s.sendMessage)
  const isOnline = useAIStore(s => s.isOnline)
  const cancelRequest = useAIStore(s => s.cancelRequest)

  // 订阅 app store
  const activePanelId = useAppStore(s => s.activePanelId)
  const primaryAISessionId = useAppStore(s => s.primaryAISessionId)

  const sessionId = activeSessionId ?? primaryAISessionId
  const session = sessionId ? sessions[sessionId] : undefined
  const messages = session?.messages ?? []
  const status = session?.status ?? 'idle'
  const boundPanelId = session?.boundPanelId ?? activePanelId

  // 新消息到达时自动滚动到底部
  useEffect(() => {
    if (historyOpen && messagesEndRef.current) {
      messagesEndRef.current.scrollTop = messagesEndRef.current.scrollHeight
    }
  }, [messages, historyOpen])

  const handleSend = useCallback(async () => {
    const content = input.trim()
    if (!content || !sessionId) return
    if (status === 'thinking' || status === 'tool_calling') return
    setInput('')
    await sendMessage(sessionId, content)
  }, [input, sessionId, status, sendMessage])

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void handleSend()
    }
  }

  const isBusy = status === 'thinking' || status === 'tool_calling'
  const hasMessages = messages.length > 0

  return createPortal(
    <div className="bottom-taskbar-root" data-ai-mode="taskbar">
      {/* 上方对话历史气泡区（决策日志 40：类似微信聊天气泡） */}
      {historyOpen && (
        <div className="bottom-taskbar-history" data-taskbar-history="true">
          <div className="bottom-taskbar-history-header">
            <span className="bottom-taskbar-history-title">
              <MessageSquare size={12} />
              对话历史
            </span>
            <button
              className="bottom-taskbar-icon-btn"
              onClick={() => setHistoryOpen(false)}
              title="收起历史"
            >
              <X size={12} />
            </button>
          </div>
          <div className="bottom-taskbar-history-list" ref={messagesEndRef}>
            {messages.length === 0 && (
              <div className="bottom-taskbar-history-empty">
                {isOnline ? '输入消息开始对话' : '正在连接 AI 服务...'}
              </div>
            )}
            {!isOnline && <ConnectingBar />}
            {messages.map((msg, idx) => (
              <TaskbarMessage key={idx} msg={msg} />
            ))}
            {isBusy && <ThinkingBar messages={messages} status={status} />}
            <PermissionCard boundPanelId={boundPanelId} />
          </div>
        </div>
      )}

      {/* 椭圆形输入栏（glass-bg 毛玻璃） */}
      <div className="bottom-taskbar-input-bar" data-bottom-bar="true">
        {/* 历史收起时显示展开按钮 */}
        {!historyOpen && hasMessages && (
          <button
            className="bottom-taskbar-icon-btn bottom-taskbar-history-toggle"
            onClick={() => setHistoryOpen(true)}
            title="展开对话历史"
          >
            <MessageSquare size={16} />
          </button>
        )}
        <textarea
          className="bottom-taskbar-input"
          placeholder={isBusy ? 'AI 正在响应...' : '输入消息或指令...'}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          rows={1}
          disabled={isBusy}
          data-ai-input="true"
        />
        {isBusy ? (
          <button
            className="bottom-taskbar-send bottom-taskbar-send--busy"
            onClick={() => sessionId && cancelRequest(sessionId)}
            title="停止"
          >
            <Loader2 size={15} className="spin" />
          </button>
        ) : (
          <button
            className="bottom-taskbar-send"
            onClick={() => void handleSend()}
            disabled={!input.trim() || !sessionId}
            title="发送"
          >
            <Send size={15} />
          </button>
        )}
        <button
          className="bottom-taskbar-icon-btn"
          onClick={onSwitchToOrb}
          data-mode-switch="to-ball"
          title="切换到浮球模式"
        >
          <ArrowLeftRight size={16} />
        </button>
      </div>
    </div>,
    document.body,
  )
}

/**
 * 单条消息渲染：用户靠右，AI 靠左，tool/system 居中
 */
function TaskbarMessage({ msg }: { msg: ChatMessage }) {
  if (msg.role === 'user') {
    return (
      <div className="chat-bubble chat-bubble--user" data-msg-role="user">
        {msg.content}
      </div>
    )
  }

  if (msg.role === 'assistant') {
    if (msg.askUser) {
      return (
        <AskUserCard
          requestId={msg.askUser.requestId}
          question={msg.askUser.question}
          options={msg.askUser.options}
          allowMultiple={msg.askUser.allowMultiple}
          answered={msg.askUser.answered}
          selectedValues={msg.askUser.selectedValues}
        />
      )
    }
    if (!msg.content) return null
    return (
      <div className="chat-bubble chat-bubble--ai" data-msg-role="assistant">
        {msg.content}
      </div>
    )
  }

  return (
    <div className="chat-bubble chat-bubble--system" data-msg-role={msg.role}>
      {msg.content}
    </div>
  )
}
