/**
 * AIAssistant Widget — Phase 2 WS Client Simplified Version
 *
 * Per spec section 5.7: in-place rewrite of the legacy thousand-line implementation.
 * Only keeps: message list + input box + tool call progress display.
 *
 * Key simplifications:
 * - No privacy panel (Phase 1 stub removed)
 * - No model selection (pi backend pre-configured with step-3.7-flash)
 * - No API key config (pi backend uses VITE_STEPFUN_API_KEY env var)
 * - No permission request UI (6 tools all auto-execute, no user confirmation)
 * - No data send preview (tools execute directly)
 *
 * agent-created html widgets appear directly on the canvas (handled by useAIStore WS callbacks).
 */

import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { Bot, Send, Loader2, Wrench, ChevronDown, ChevronRight, Wifi, WifiOff } from 'lucide-react'
import { useAIStore } from '../../stores/useAIStore'
import type { ChatMessage } from '../../types/ai'

interface AIAssistantWidgetState {
  sessionId: string
  schemaVersion: 1
}

export default function AIAssistant({
  widgetId: _widgetId,
  panelId: _panelId,
  state,
  onUpdateState,
  isPrimary = false,
}: {
  widgetId: string
  panelId: string
  state: Record<string, unknown>
  onUpdateState: (partial: Record<string, unknown>) => void
  isPrimary?: boolean
}) {
  const widgetState = state as unknown as AIAssistantWidgetState

  // AI Store
  const sessions = useAIStore(s => s.sessions)
  const isInitialized = useAIStore(s => s.isInitialized)
  const activeSessionId = useAIStore(s => s.activeSessionId)
  const isOnline = useAIStore(s => s.isOnline)
  const initialize = useAIStore(s => s.initialize)
  const createSession = useAIStore(s => s.createSession)
  const sendMessage = useAIStore(s => s.sendMessage)

  // Local state
  const [inputValue, setInputValue] = useState('')
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  // 修复：防抖 ref，避免 click + Enter 双发导致同一消息发送两次
  const justSentRef = useRef(false)

  // Resolve sessionId: prefer widgetState.sessionId, fallback to activeSessionId
  const sessionId = widgetState.sessionId || activeSessionId || ''

  // Current session
  const session = sessionId ? sessions[sessionId] : undefined
  const messages = useMemo<ChatMessage[]>(() => session?.messages ?? [], [session])
  const sessionStatus = session?.status ?? 'idle'

  // Initialize on mount
  useEffect(() => {
    if (!isInitialized) {
      initialize()
    }
  }, [isInitialized, initialize])

  // Auto-create session if none exists
  // 修复：按 panelId 选择/创建 session，避免跨 panel 复用 session 导致事件路由错误。
  // 原逻辑：优先用 activeSessionId 或 store 第一个 session，不考虑 panelId 匹配，
  //         导致 widget 在 A 面板却复用 B 面板的 session，sendMessage 用错误的 panelId 发消息，
  //         客户端按 activePanelId 过滤时丢弃所有回复，widget 永远卡在 thinking。
  // 新逻辑：只复用 boundPanelId 匹配当前 panel 的 session；找不到则创建新的并绑定当前 panel。
  useEffect(() => {
    if (!isInitialized) return

    // 1. widgetState.sessionId 存在且有效 — 校验 boundPanelId 匹配当前 panel
    if (sessionId && sessions[sessionId]) {
      const s = sessions[sessionId]
      if (s.boundPanelId === _panelId) return
      // boundPanelId 不匹配，继续找匹配的 session
    }

    // 2. 优先找绑定到当前 panel 的 session
    const panelSession = Object.values(sessions).find(s => s.boundPanelId === _panelId)
    if (panelSession) {
      if (widgetState.sessionId !== panelSession.sessionId) {
        onUpdateState({ sessionId: panelSession.sessionId })
      }
      return
    }

    // 3. 没有匹配的 session — 创建新的，绑定到当前 panel
    const newSessionId = createSession({ boundPanelId: _panelId })
    onUpdateState({ sessionId: newSessionId })
  }, [isInitialized, sessionId, sessions, activeSessionId, createSession, onUpdateState, widgetState.sessionId, _panelId])

  // Auto-scroll to bottom on new messages or status change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [messages, sessionStatus])

  // Handle send message
  const handleSend = useCallback(async () => {
    const trimmed = inputValue.trim()
    if (!trimmed) return
    if (!sessionId) return
    if (!isOnline) return
    if (sessionStatus === 'thinking' || sessionStatus === 'tool_calling') return
    // 修复：防抖，避免 click + Enter 双发导致同一消息发送两次
    if (justSentRef.current) return
    justSentRef.current = true
    setTimeout(() => { justSentRef.current = false }, 500)

    setInputValue('')
    // 修复：传递 _panelId，让 sendMessage 用 widget 所在 panel 的 panelId，
    // 避免 session.boundPanelId 错位导致事件路由到错误 panel
    await sendMessage(sessionId, trimmed, _widgetId, _panelId)
  }, [inputValue, sessionId, isOnline, sessionStatus, sendMessage, _widgetId, _panelId])

  // Handle key down: Enter to send, Shift+Enter for newline
  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }, [handleSend])

  const isBusy = sessionStatus === 'thinking' || sessionStatus === 'tool_calling'
  const canSend = inputValue.trim().length > 0 && isOnline && !isBusy && !!sessionId

  // ===== RENDER =====

  return (
    <div
      style={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--bg-surface)',
        backdropFilter: 'blur(8px)',
        borderRadius: 'var(--radius-md)',
        overflow: 'hidden',
        position: 'relative',
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '6px 10px',
          borderBottom: '1px solid var(--border-subtle)',
          flexShrink: 0,
        }}
      >
        <span style={{ fontWeight: 600, fontSize: 13, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <Bot size={14} />
          {isPrimary && (
            <span
              style={{
                display: 'inline-block',
                width: 16,
                height: 16,
                lineHeight: '16px',
                textAlign: 'center',
                background: 'linear-gradient(135deg, #4A90E2, #7B68EE)',
                color: '#fff',
                borderRadius: '50%',
                fontSize: 10,
                fontWeight: 700,
                boxShadow: '0 0 4px rgba(74, 144, 226, 0.5)',
              }}
              title="主AI助手"
            >
              主
            </span>
          )}
          AI 助手
        </span>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 10 }}>
          {/* WS connection status */}
          {isOnline ? (
            <span style={{ color: 'var(--color-success)', display: 'inline-flex', alignItems: 'center', gap: 2 }} title="WS 已连接">
              <Wifi size={11} />
              在线
            </span>
          ) : (
            <span style={{ color: 'var(--color-error)', display: 'inline-flex', alignItems: 'center', gap: 2 }} title="WS 未连接">
              <WifiOff size={11} />
              离线
            </span>
          )}
          {/* Session ID (small, optional) */}
          {sessionId && (
            <span
              style={{
                color: 'var(--text-tertiary)',
                fontFamily: 'monospace',
                maxWidth: 120,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
              title={sessionId}
            >
              {sessionId.slice(0, 8)}
            </span>
          )}
        </div>
      </div>

      {/* Message List */}
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '8px 10px',
          display: 'flex',
          flexDirection: 'column',
          gap: 6,
          minHeight: 0,
        }}
      >
        {messages.length === 0 && (
          <div
            style={{
              flex: 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--text-tertiary)',
              fontSize: 12,
              textAlign: 'center',
            }}
          >
            {isOnline ? '向 AI 助手提问吧' : '正在连接 AI 服务...'}
          </div>
        )}

        {messages.map((msg, idx) => (
          <MessageBubble key={`${msg.timestamp}-${idx}`} message={msg} />
        ))}

        {/* Thinking / Tool calling indicator */}
        {(sessionStatus === 'thinking' || sessionStatus === 'tool_calling') && (
          <div
            style={{
              alignSelf: 'flex-start',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '4px 10px',
              background: 'var(--bg-elevated)',
              borderRadius: 'var(--radius-sm)',
              fontSize: 11,
              color: 'var(--text-secondary)',
            }}
          >
            <Loader2 size={12} className="animate-spin" />
            {sessionStatus === 'tool_calling' ? '工具调用中...' : 'AI 思考中...'}
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Error bar */}
      {session?.error && sessionStatus === 'error' && (
        <div
          style={{
            padding: '4px 10px',
            background: 'rgba(255, 59, 48, 0.1)',
            borderTop: '1px solid rgba(255, 59, 48, 0.3)',
            fontSize: 10,
            color: 'var(--color-error)',
            flexShrink: 0,
          }}
        >
          {session.error}
        </div>
      )}

      {/* Input Area */}
      <div
        style={{
          display: 'flex',
          gap: 6,
          padding: '6px 10px',
          borderTop: '1px solid var(--border-subtle)',
          flexShrink: 0,
        }}
      >
        <textarea
          ref={inputRef}
          value={inputValue}
          onChange={e => setInputValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={
            !isOnline
              ? '连接中...'
              : isBusy
                ? 'AI 响应中，请稍候...'
                : '输入消息... (Enter 发送, Shift+Enter 换行)'
          }
          disabled={!isOnline || isBusy}
          rows={1}
          style={{
            flex: 1,
            padding: '6px 8px',
            background: 'var(--bg-canvas)',
            color: 'var(--text-primary)',
            border: '1px solid var(--border-subtle)',
            borderRadius: 'var(--radius-sm)',
            fontSize: 12,
            resize: 'none',
            outline: 'none',
            fontFamily: 'inherit',
            lineHeight: 1.4,
            maxHeight: 80,
            opacity: !isOnline || isBusy ? 0.6 : 1,
          }}
        />
        <button
          onClick={handleSend}
          disabled={!canSend}
          style={{
            padding: '4px 10px',
            background: 'var(--color-primary)',
            color: '#fff',
            border: 'none',
            borderRadius: 'var(--radius-sm)',
            cursor: canSend ? 'pointer' : 'not-allowed',
            fontSize: 11,
            flexShrink: 0,
            opacity: canSend ? 1 : 0.5,
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
          }}
        >
          <Send size={12} />
          发送
        </button>
      </div>
    </div>
  )
}

/** Message bubble component */
function MessageBubble({ message }: { message: ChatMessage }) {
  const [expanded, setExpanded] = useState(false)

  // Tool call message — collapsible
  if (message.role === 'tool') {
    return (
      <div
        style={{
          alignSelf: 'flex-start',
          maxWidth: '85%',
          padding: '4px 8px',
          background: 'rgba(59, 130, 246, 0.1)',
          border: '1px solid rgba(59, 130, 246, 0.3)',
          borderRadius: 'var(--radius-sm)',
          fontSize: 11,
          color: 'var(--text-secondary)',
        }}
      >
        <div
          data-widget-interactive="true"
          onClick={() => setExpanded(!expanded)}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            cursor: 'pointer',
          }}
        >
          {expanded ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
          <Wrench size={11} />
          <span>{message.content}</span>
        </div>
        {expanded && message.toolCallId && (
          <div
            style={{
              marginTop: 4,
              padding: '4px 6px',
              background: 'var(--bg-hover)',
              borderRadius: 'var(--radius-sm)',
              fontSize: 10,
              fontFamily: 'monospace',
              color: 'var(--text-tertiary)',
              wordBreak: 'break-all',
            }}
          >
            ID: {message.toolCallId}
          </div>
        )}
      </div>
    )
  }

  // User message — right aligned, blue background
  if (message.role === 'user') {
    return (
      <div
        style={{
          alignSelf: 'flex-end',
          maxWidth: '80%',
          padding: '6px 10px',
          background: 'var(--color-primary)',
          color: '#fff',
          borderRadius: '10px 10px 2px 10px',
          fontSize: 12,
          lineHeight: 1.5,
          wordBreak: 'break-word',
          whiteSpace: 'pre-wrap',
        }}
      >
        {message.content}
      </div>
    )
  }

  // Assistant message — left aligned, gray background
  if (message.role === 'assistant') {
    return (
      <div
        style={{
          alignSelf: 'flex-start',
          maxWidth: '85%',
          padding: '6px 10px',
          background: 'var(--bg-elevated)',
          color: 'var(--text-primary)',
          borderRadius: '10px 10px 10px 2px',
          fontSize: 12,
          lineHeight: 1.5,
          wordBreak: 'break-word',
          whiteSpace: 'pre-wrap',
        }}
      >
        {message.content || '...'}
      </div>
    )
  }

  // system messages — not displayed
  return null
}
