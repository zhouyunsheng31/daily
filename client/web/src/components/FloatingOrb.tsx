/**
 * FloatingOrb — Phase 3 浮球形态 AI 对话组件
 *
 * 设计依据：
 * - UI 原型 canvas-core-v8.html 第 1669-1697 行（浮球模式）
 * - 设计文档 §5.1 两种形态切换 + 决策日志第 21 条
 *
 * 行为：
 * - 右下角 56x56 圆形按钮，fixed 定位，z-index: 9999（始终置顶）
 * - 渐变背景 + 呼吸动画（orb-glow keyframes）
 * - 点击展开 300px 宽对话面板（含历史气泡 + 输入框 + 切换按钮）
 * - 通过 createPortal 挂载到 document.body，确保不受父级 overflow/z-index 限制
 *
 * 能力迁移（来自原 AIAssistant widget）：
 * - WS 流式响应：订阅 useAIStore.sessions[activeSessionId].messages
 * - ask_user：渲染 AskUserCard
 * - permission_request：渲染 PermissionCard
 * - 双 watchdog：保留在 useAIStore 中（不动）
 * - 多会话管理：保留 useAIStore 现有逻辑
 */
import { useState, useRef, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { MessageSquare, X, ArrowLeftRight, Send, Loader2 } from 'lucide-react'
import { useAIStore } from '../stores/useAIStore'
import { useAppStore } from '../stores/useAppStore'
import AskUserCard from './AskUserCard'
import PermissionCard from './PermissionCard'
import { ThinkingBar, ConnectingBar } from './ai/AIStatusBars'
import type { ChatMessage } from '../types/ai'

export interface FloatingOrbProps {
  onSwitchToTaskbar: () => void
}

export default function FloatingOrb({ onSwitchToTaskbar }: FloatingOrbProps) {
  const [expanded, setExpanded] = useState(false)
  const [input, setInput] = useState('')
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

  // 优先用 activeSessionId，fallback 到 primaryAISessionId
  const sessionId = activeSessionId ?? primaryAISessionId
  const session = sessionId ? sessions[sessionId] : undefined
  const messages = session?.messages ?? []
  const status = session?.status ?? 'idle'
  const boundPanelId = session?.boundPanelId ?? activePanelId

  // 新消息到达时自动滚动到底部
  useEffect(() => {
    if (expanded && messagesEndRef.current) {
      messagesEndRef.current.scrollTop = messagesEndRef.current.scrollHeight
    }
  }, [messages, expanded])

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

  return createPortal(
    <div className="floating-orb-root" data-ai-mode="orb">
      {/* 展开后的对话面板 */}
      {expanded && (
        <div className="floating-orb-panel pop-in" data-orb-panel="true">
          {/* 头部 */}
          <div className="floating-orb-panel-header">
            <div className="floating-orb-panel-title">
              <span className="floating-orb-panel-dot" />
              AI 助手
            </div>
            <div className="floating-orb-panel-actions">
              <button
                onClick={onSwitchToTaskbar}
                data-mode-switch="to-dialog"
                title="切换到底部任务栏"
                className="floating-orb-icon-btn"
              >
                <ArrowLeftRight size={16} />
              </button>
              <button
                onClick={() => setExpanded(false)}
                title="关闭"
                className="floating-orb-icon-btn"
              >
                <X size={14} />
              </button>
            </div>
          </div>

          {/* 消息列表 */}
          <div className="floating-orb-messages" ref={messagesEndRef}>
            {messages.length === 0 && (
              <div className="floating-orb-empty">
                {isOnline ? '输入消息开始对话' : '正在连接 AI 服务...'}
              </div>
            )}
            {!isOnline && <ConnectingBar />}
            {messages.map((msg, idx) => (
              <FloatingOrbMessage key={idx} msg={msg} />
            ))}
            {isBusy && <ThinkingBar messages={messages} status={status} />}
            {/* 权限请求卡片（按 boundPanelId 过滤） */}
            <PermissionCard boundPanelId={boundPanelId} />
          </div>

          {/* 输入区 */}
          <div className="floating-orb-input-row">
            <textarea
              className="floating-orb-input"
              placeholder={isBusy ? 'AI 正在响应...' : '说点什么...'}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              rows={1}
              disabled={isBusy}
              data-ai-input="true"
            />
            {isBusy ? (
              <button
                className="floating-orb-send floating-orb-send--busy"
                onClick={() => sessionId && cancelRequest(sessionId)}
                title="停止"
              >
                <Loader2 size={14} className="spin" />
              </button>
            ) : (
              <button
                className="floating-orb-send"
                onClick={() => void handleSend()}
                disabled={!input.trim() || !sessionId}
                title="发送"
              >
                <Send size={13} />
              </button>
            )}
          </div>
        </div>
      )}

      {/* 浮球按钮 */}
      <button
        className={`floating-orb-btn ai-ball-glow ${expanded ? 'floating-orb-btn--active' : ''}`}
        onClick={() => setExpanded(v => !v)}
        data-ai-ball="true"
        title={expanded ? '收起 AI 助手' : '展开 AI 助手'}
        aria-label="AI 助手"
      >
        {expanded ? <X size={22} /> : <MessageSquare size={22} />}
      </button>
    </div>,
    document.body,
  )
}

/**
 * 单条消息渲染：根据 role 分流
 * - user：靠右紫色气泡
 * - assistant：靠左灰色气泡（支持 askUser 卡片）
 * - tool/system：居中系统提示
 */
function FloatingOrbMessage({ msg }: { msg: ChatMessage }) {
  if (msg.role === 'user') {
    return (
      <div className="chat-bubble chat-bubble--user" data-msg-role="user">
        {msg.content}
      </div>
    )
  }

  if (msg.role === 'assistant') {
    // askUser 卡片：渲染 AskUserCard 替代纯文本
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
    // 空内容（流式占位）不渲染
    if (!msg.content) return null
    return (
      <div className="chat-bubble chat-bubble--ai" data-msg-role="assistant">
        {msg.content}
      </div>
    )
  }

  // tool / system 消息：居中淡色提示
  return (
    <div className="chat-bubble chat-bubble--system" data-msg-role={msg.role}>
      {msg.content}
    </div>
  )
}
