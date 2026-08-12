/**
 * AIAssistantSidebar — Phase 8 批次4 模块B
 *
 * Sidebar 切换到 'ai-assistant' 模式时渲染的 AI 助手形态组件。
 *
 * 布局（参考 spec B.2）：
 *   ┌─AIAssistantSidebar─────────────┐
 *   │ 会话选择器（按钮 + 下拉菜单）    │
 *   │ [N 个会话等待回答] 徽章（如有）  │
 *   │ ──────────────────────────── │
 *   │ 对话流区域（可滚动）            │
 *   │  - 用户消息气泡                 │
 *   │  - AI回复气泡                  │
 *   │  - 工具调用卡片                │
 *   │  - AskUserCard（批次5 模块D）   │
 *   │  - PermissionCard（批次5 模块F）│
 *   │  - DataSendPreviewCard（批次5） │
 *   │  - Thinking 指示器              │
 *   │ ──────────────────────────── │
 *   │ pill输入框 + 发送按钮           │
 *   │ [⚙️ API配置] [快速切换model]    │
 *   └──────────────────────────────┘
 */
import { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import { Bot, Send, Settings, ChevronDown, Plus, MessageSquare, Loader2, Wrench, ChevronRight, PanelLeft, Brain } from 'lucide-react'
import { useAIStore } from '../stores/useAIStore'
import { useApiConfigStore } from '../stores/useApiConfigStore'
import { useAppStore } from '../stores/useAppStore'
import { useThinkingLevelStore } from '../stores/useThinkingLevelStore'
import {
  getThinkingLevelLabel,
  getThinkingLevelDescription,
  getAvailableThinkingLevels,
  mapThinkingLevelToPi,
  type ThinkingLevel,
} from '../utils/thinkingLevel'
import { ApiConfigModal } from './ApiConfigModal'
import AskUserCard from './AskUserCard'
import PermissionCard from './PermissionCard'
import DataSendPreviewCard from './DataSendPreviewCard'
import type { ChatMessage } from '../types/ai'
// Phase 9 批次 3 模块 7：Agent 模式切换器（云端/本地/自动 + 离线降级警告色）
import AgentModeSwitcher from './ai/AgentModeSwitcher'
import { SearchResultsPanel } from './ai/SearchResultsPanel'

export default function AIAssistantSidebar() {
  // ===== AI Store =====
  const sessions = useAIStore(s => s.sessions)
  const activeSessionId = useAIStore(s => s.activeSessionId)
  const sessionList = useAIStore(s => s.sessionList)
  const isOnline = useAIStore(s => s.isOnline)
  const isInitialized = useAIStore(s => s.isInitialized)
  const initialize = useAIStore(s => s.initialize)
  const createSession = useAIStore(s => s.createSession)
  const sendMessage = useAIStore(s => s.sendMessage)
  const switchSession = useAIStore(s => s.switchSession)
  const setSessionModel = useAIStore(s => s.setSessionModel)

  // ===== API Config Store =====
  const presets = useApiConfigStore(s => s.presets)

  // ===== App Store（用于查询绑定面板名） =====
  const panels = useAppStore(s => s.panels)
  const activePanelId = useAppStore(s => s.activePanelId)

  // ===== Thinking Level Store（Phase 9 批次 3 模块 6）=====
  const currentThinkingLevel = useThinkingLevelStore(s => s.currentLevel)
  const setThinkingLevel = useThinkingLevelStore(s => s.setLevel)

  // ===== Local state =====
  const [inputValue, setInputValue] = useState('')
  const [sessionDropdownOpen, setSessionDropdownOpen] = useState(false)
  const [modelDropdownOpen, setModelDropdownOpen] = useState(false)
  const [thinkingLevelDropdownOpen, setThinkingLevelDropdownOpen] = useState(false)
  const [apiConfigOpen, setApiConfigOpen] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const sessionDropdownRef = useRef<HTMLDivElement>(null)
  const modelDropdownRef = useRef<HTMLDivElement>(null)
  const thinkingLevelDropdownRef = useRef<HTMLDivElement>(null)

  // ===== Initialize AI store on mount =====
  useEffect(() => {
    if (!isInitialized) {
      initialize()
    }
  }, [isInitialized, initialize])

  // ===== Resolve current session =====
  const session = activeSessionId ? sessions[activeSessionId] : undefined
  const messages = useMemo<ChatMessage[]>(() => session?.messages ?? [], [session])
  const sessionStatus = session?.status ?? 'idle'

  // 当前会话的 meta（sessionList 是持久化元数据，可能比 sessions map 更全）
  const currentMeta = useMemo(
    () => sessionList.find(m => m.sessionId === activeSessionId),
    [sessionList, activeSessionId],
  )

  // 当前会话绑定的面板名
  const boundPanelName = useMemo(() => {
    const pid = session?.boundPanelId ?? currentMeta?.boundPanelId
    if (!pid) return null
    return panels.find(p => p.id === pid)?.name ?? null
  }, [session, currentMeta, panels])

  // 当前生效 preset（用于显示 model 列表）
  const currentPreset = useMemo(() => {
    const apiConfigId = session?.apiConfigId ?? currentMeta?.apiConfigId ?? ''
    return presets.find(p => p.id === apiConfigId) ?? presets[0]
  }, [session, currentMeta, presets])

  // 计算"等待回答"的会话数（thinking / tool_calling）
  const pendingCount = useMemo(() => {
    return Object.values(sessions).filter(s =>
      s.status === 'thinking' || s.status === 'tool_calling'
    ).length
  }, [sessions])

  // ===== Auto-scroll on new messages =====
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [messages, sessionStatus])

  // ===== Click-outside to close dropdowns =====
  useEffect(() => {
    if (!sessionDropdownOpen && !modelDropdownOpen && !thinkingLevelDropdownOpen) return
    function handleClick(e: MouseEvent) {
      if (sessionDropdownOpen && sessionDropdownRef.current && !sessionDropdownRef.current.contains(e.target as Node)) {
        setSessionDropdownOpen(false)
      }
      if (modelDropdownOpen && modelDropdownRef.current && !modelDropdownRef.current.contains(e.target as Node)) {
        setModelDropdownOpen(false)
      }
      if (thinkingLevelDropdownOpen && thinkingLevelDropdownRef.current && !thinkingLevelDropdownRef.current.contains(e.target as Node)) {
        setThinkingLevelDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [sessionDropdownOpen, modelDropdownOpen, thinkingLevelDropdownOpen])

  // ===== Handlers =====
  const handleSend = useCallback(async () => {
    const trimmed = inputValue.trim()
    if (!trimmed) return
    if (!isOnline) return
    if (sessionStatus === 'thinking' || sessionStatus === 'tool_calling') return
    // 如果没有活跃会话，自动创建一个
    let sid = activeSessionId
    if (!sid) {
      sid = createSession({
        boundPanelId: activePanelId ?? undefined,
        title: `新会话 ${new Date().toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}`,
      })
      await switchSession(sid)
    }
    setInputValue('')
    await sendMessage(sid, trimmed)
  }, [inputValue, activeSessionId, isOnline, sessionStatus, sendMessage, createSession, switchSession, activePanelId])

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }, [handleSend])

  const handleNewSession = useCallback(() => {
    // 新会话默认绑定当前活跃面板（若有）
    const newId = createSession({
      boundPanelId: activePanelId ?? undefined,
      title: `新会话 ${new Date().toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}`,
    })
    void switchSession(newId)
    setSessionDropdownOpen(false)
  }, [createSession, switchSession, activePanelId])

  const handleSelectSession = useCallback(async (sessionId: string) => {
    await switchSession(sessionId)
    setSessionDropdownOpen(false)
  }, [switchSession])

  const handleSwitchModel = useCallback((modelId: string) => {
    if (!activeSessionId) return
    setSessionModel(activeSessionId, modelId)
    setModelDropdownOpen(false)
  }, [activeSessionId, setSessionModel])

  /**
   * 切换思考等级（Phase 9 批次 3 模块 6）
   *
   * 流程：
   * 1. 更新 useThinkingLevelStore（同步 localStorage 持久化）
   * 2. 通过 IPC 通知主进程 LocalAgentService：
   *    - session 已存在：调 pi 原生 session.setThinkingLevel 实时切换
   *    - session 不存在：缓存到 pendingThinkingLevels，下次 createSession 时使用
   *
   * panelId 用 activeSessionId（与 spec 3.6.2 agentApi.sendMessage 的 panelId 对齐）
   * 若 activeSessionId 为空（用户未选会话），跳过 IPC（下次发消息时 createSession 会用新值）
   */
  const handleSwitchThinkingLevel = useCallback((level: ThinkingLevel) => {
    setThinkingLevel(level)
    setThinkingLevelDropdownOpen(false)
    // 通知主进程：session 存在则实时切换，不存在则缓存到 pending
    if (activeSessionId && typeof window !== 'undefined' && window.agentApi?.setThinkingLevel) {
      const piLevel = mapThinkingLevelToPi(level)
      window.agentApi.setThinkingLevel(activeSessionId, piLevel).catch((err) => {
        console.warn('[AIAssistantSidebar] failed to notify main process thinking level change:', err)
      })
    }
  }, [activeSessionId, setThinkingLevel])

  const handleOpenApiConfig = useCallback(() => {
    setApiConfigOpen(true)
    setSessionDropdownOpen(false)
  }, [])

  const isBusy = sessionStatus === 'thinking' || sessionStatus === 'tool_calling'
  const canSend = inputValue.trim().length > 0 && isOnline && !isBusy

  // 当前显示的会话标题
  const displayTitle = session?.title ?? currentMeta?.title ?? '未选择会话'
  const displayModel = session?.modelId ?? currentMeta?.modelId ?? currentPreset?.models[0] ?? '未配置'

  // ===== RENDER =====
  return (
    <div
      style={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--bg-surface)',
        overflow: 'hidden',
        position: 'relative',
      }}
    >
      {/* ============ 顶部：会话选择器 + 等待徽章 ============ */}
      <div
        style={{
          padding: '8px 10px',
          borderBottom: '1px solid var(--border-subtle)',
          flexShrink: 0,
            position: 'relative',
        }}
      >
        {/* Phase 9 批次 3 模块 7：Agent 切换按钮（云端/本地/自动）
            放在会话选择器上方独立一行，与思考等级按钮（底部输入区）形成完整的模式切换 UI */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'flex-end',
          marginBottom: 6,
        }}>
          <AgentModeSwitcher />
        </div>

        <div
          ref={sessionDropdownRef}
          style={{ position: 'relative' }}
        >
          {/* 会话选择按钮 */}
          <button
            type="button"
            onClick={() => setSessionDropdownOpen(!sessionDropdownOpen)}
            style={{
              width: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 6,
              padding: '6px 10px',
              background: 'rgba(0,0,0,0.03)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 8,
              cursor: 'pointer',
              fontSize: 12,
              color: 'var(--text-primary)',
              fontFamily: 'inherit',
              transition: 'background 0.2s ease-in-out',
            }}
            title={displayTitle}
          >
            <span style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              overflow: 'hidden',
              flex: 1,
              minWidth: 0,
            }}>
              <MessageSquare size={12} style={{ flexShrink: 0 }} />
              <span style={{
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}>
                {displayTitle}
              </span>
              {boundPanelName && (
                <span style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 2,
                  padding: '1px 5px',
                  background: 'rgba(0,0,0,0.05)',
                  borderRadius: 4,
                  fontSize: 10,
                  color: 'var(--text-tertiary)',
                  flexShrink: 0,
                }}>
                  <PanelLeft size={9} />
                  {boundPanelName}
                </span>
              )}
            </span>
            <ChevronDown
              size={12}
              style={{
                flexShrink: 0,
                transition: 'transform 0.2s ease-in-out',
                transform: sessionDropdownOpen ? 'rotate(180deg)' : 'none',
              }}
            />
          </button>

          {/* 下拉菜单 */}
          {sessionDropdownOpen && (
            <div
              style={{
                position: 'absolute',
                top: 'calc(100% + 4px)',
                left: 0,
                right: 0,
                background: 'rgba(255,255,255,0.85)',
                backdropFilter: 'blur(12px)',
                WebkitBackdropFilter: 'blur(12px)',
                border: '1px solid var(--border-subtle)',
                borderRadius: 12,
                boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
                zIndex: 1000,
                maxHeight: 320,
                overflowY: 'auto',
                padding: 4,
              }}
            >
              {/* 会话列表 */}
              {sessionList.length === 0 && (
                <div style={{
                  padding: '12px 10px',
                  fontSize: 11,
                  color: 'var(--text-tertiary)',
                  textAlign: 'center',
                }}>
                  暂无会话，点击下方按钮新建
                </div>
              )}
              {sessionList.map(meta => {
                const isActive = meta.sessionId === activeSessionId
                const panelName = meta.boundPanelId
                  ? panels.find(p => p.id === meta.boundPanelId)?.name ?? null
                  : null
                return (
                  <button
                    key={meta.sessionId}
                    type="button"
                    onClick={() => handleSelectSession(meta.sessionId)}
                    style={{
                      width: '100%',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 6,
                      padding: '6px 8px',
                      background: isActive ? 'rgba(0,0,0,0.06)' : 'transparent',
                      border: 'none',
                      borderRadius: 8,
                      cursor: 'pointer',
                      fontSize: 12,
                      color: 'var(--text-primary)',
                      fontFamily: 'inherit',
                      textAlign: 'left',
                      transition: 'background 0.15s ease',
                    }}
                    onMouseEnter={(e) => {
                      if (!isActive) e.currentTarget.style.background = 'rgba(0,0,0,0.03)'
                    }}
                    onMouseLeave={(e) => {
                      if (!isActive) e.currentTarget.style.background = 'transparent'
                    }}
                  >
                    <span style={{
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      flex: 1,
                    }}>
                      {meta.title}
                    </span>
                    {panelName && (
                      <span style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 2,
                        padding: '1px 5px',
                        background: 'rgba(0,0,0,0.05)',
                        borderRadius: 4,
                        fontSize: 10,
                        color: 'var(--text-tertiary)',
                        flexShrink: 0,
                      }}>
                        <PanelLeft size={9} />
                        {panelName}
                      </span>
                    )}
                  </button>
                )
              })}

              {/* 分隔线 */}
              <div style={{
                height: 1,
                background: 'var(--border-subtle)',
                margin: '4px 0',
              }} />

              {/* 新建会话 */}
              <button
                type="button"
                onClick={handleNewSession}
                style={{
                  width: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '6px 8px',
                  background: 'transparent',
                  border: 'none',
                  borderRadius: 8,
                  cursor: 'pointer',
                  fontSize: 12,
                  color: 'var(--text-primary)',
                  fontFamily: 'inherit',
                  textAlign: 'left',
                  transition: 'background 0.15s ease',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(0,0,0,0.03)' }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
              >
                <Plus size={12} />
                新建会话
              </button>

              {/* 管理 API 配置 */}
              <button
                type="button"
                onClick={handleOpenApiConfig}
                style={{
                  width: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '6px 8px',
                  background: 'transparent',
                  border: 'none',
                  borderRadius: 8,
                  cursor: 'pointer',
                  fontSize: 12,
                  color: 'var(--text-primary)',
                  fontFamily: 'inherit',
                  textAlign: 'left',
                  transition: 'background 0.15s ease',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(0,0,0,0.03)' }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
              >
                <Settings size={12} />
                管理 API 配置
              </button>
            </div>
          )}
        </div>

        {/* 等待徽章 */}
        {pendingCount > 0 && (
          <div style={{
            marginTop: 6,
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            padding: '2px 8px',
            background: 'rgba(59, 130, 246, 0.12)',
            color: 'rgb(37, 99, 235)',
            borderRadius: 9999,
            fontSize: 10,
            fontWeight: 500,
          }}>
            <Loader2 size={10} className="animate-spin" />
            {pendingCount} 个会话等待回答
          </div>
        )}
      </div>

      <SearchResultsPanel />

      {/* ============ 对话流区域 ============ */}
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '10px 12px',
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
          minHeight: 0,
        }}
      >
        {/* 空状态 */}
        {messages.length === 0 && !activeSessionId && (
          <div style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--text-tertiary)',
            fontSize: 12,
            textAlign: 'center',
            gap: 8,
          }}>
            <Bot size={32} style={{ opacity: 0.4 }} />
            <div>开始新对话</div>
            <button
              type="button"
              onClick={handleNewSession}
              style={{
                padding: '4px 12px',
                background: 'var(--color-primary)',
                color: '#fff',
                border: 'none',
                borderRadius: 9999,
                fontSize: 11,
                cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >
              + 新建会话
            </button>
          </div>
        )}

        {messages.length === 0 && activeSessionId && (
          <div style={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--text-tertiary)',
            fontSize: 12,
            textAlign: 'center',
          }}>
            {isOnline ? '向 AI 助手提问吧' : '正在连接 AI 服务...'}
          </div>
        )}

        {/* 消息列表 */}
        {messages.map((msg, idx) => (
          <MessageBubble key={`${msg.timestamp}-${idx}`} message={msg} />
        ))}

        {/* 批次5 模块F：PermissionCard（优先级最高，spec S4） */}
        {activeSessionId && (
          <PermissionCard boundPanelId={session?.boundPanelId ?? null} />
        )}

        {/* 批次5 模块F：DataSendPreviewCard（优先级次之，spec S4） */}
        {activeSessionId && session?.pendingSendPreview && (
          <DataSendPreviewCard
            sessionId={activeSessionId}
            preview={session.pendingSendPreview}
          />
        )}

        {/* Thinking 指示器 */}
        {isBusy && (
          <div style={{
            alignSelf: 'flex-start',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            padding: '6px 12px',
            background: 'rgba(0,0,0,0.03)',
            borderRadius: 12,
            fontSize: 11,
            color: 'var(--text-secondary)',
          }}>
            <ThinkingDots />
            {sessionStatus === 'tool_calling' ? '工具调用中...' : '思考中...'}
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* ============ 错误条 ============ */}
      {session?.error && sessionStatus === 'error' && (
        <div style={{
          padding: '4px 12px',
          background: 'rgba(255, 59, 48, 0.1)',
          borderTop: '1px solid rgba(255, 59, 48, 0.3)',
          fontSize: 10,
          color: 'var(--color-error)',
          flexShrink: 0,
        }}>
          {session.error}
        </div>
      )}

      {/* ============ 输入区 ============ */}
      <div
        style={{
          padding: '8px 12px',
          borderTop: '1px solid var(--border-subtle)',
          flexShrink: 0,
          display: 'flex',
          flexDirection: 'column',
          gap: 6,
        }}
      >
        {/* pill 输入框 + 发送按钮 */}
        <div style={{ display: 'flex', gap: 6, alignItems: 'flex-end' }}>
          <textarea
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
            disabled={isBusy}
            rows={1}
            style={{
              flex: 1,
              padding: '8px 14px',
              background: 'rgba(0,0,0,0.04)',
              color: 'var(--text-primary)',
              border: '1px solid transparent',
              borderRadius: 9999,
              fontSize: 12,
              resize: 'none',
              outline: 'none',
              fontFamily: 'inherit',
              lineHeight: 1.4,
              maxHeight: 100,
              opacity: isBusy ? 0.6 : 1,
              transition: 'background 0.2s ease-in-out',
              cursor: 'text',
            }}
            onFocus={(e) => { e.currentTarget.style.background = 'rgba(0,0,0,0.06)' }}
            onBlur={(e) => { e.currentTarget.style.background = 'rgba(0,0,0,0.04)' }}
          />
          <button
            type="button"
            onClick={handleSend}
            disabled={!canSend}
            style={{
              width: 32,
              height: 32,
              padding: 0,
              background: canSend ? 'var(--color-primary)' : 'rgba(0,0,0,0.05)',
              color: canSend ? '#fff' : 'var(--text-tertiary)',
              border: 'none',
              borderRadius: 9999,
              cursor: canSend ? 'pointer' : 'not-allowed',
              flexShrink: 0,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'background 0.2s ease-in-out',
            }}
            title="发送 (Enter)"
          >
            <Send size={14} />
          </button>
        </div>

        {/* 底部行：API 配置 + 思考等级 + 快速切换 model */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          fontSize: 10,
          color: 'var(--text-tertiary)',
        }}>
          <button
            type="button"
            onClick={() => setApiConfigOpen(true)}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              padding: '2px 8px',
              background: 'transparent',
              border: '1px solid var(--border-subtle)',
              borderRadius: 9999,
              cursor: 'pointer',
              fontSize: 10,
              color: 'var(--text-secondary)',
              fontFamily: 'inherit',
              flexShrink: 0,
            }}
            title="API 配置"
          >
            <Settings size={10} />
            API配置
          </button>

          {/* 思考等级快捷切换（Phase 9 批次 3 模块 6）*/}
          <div
            ref={thinkingLevelDropdownRef}
            style={{ position: 'relative', flexShrink: 0 }}
          >
            <button
              type="button"
              onClick={() => setThinkingLevelDropdownOpen(!thinkingLevelDropdownOpen)}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                padding: '2px 8px',
                background: 'transparent',
                border: '1px solid var(--border-subtle)',
                borderRadius: 9999,
                cursor: 'pointer',
                fontSize: 10,
                color: 'var(--text-secondary)',
                fontFamily: 'inherit',
                flexShrink: 0,
              }}
              title={`思考等级：${getThinkingLevelLabel(currentThinkingLevel)} - ${getThinkingLevelDescription(currentThinkingLevel)}`}
            >
              <Brain size={10} />
              <span>思考: {getThinkingLevelLabel(currentThinkingLevel)}</span>
              <ChevronDown
                size={10}
                style={{
                  flexShrink: 0,
                  transition: 'transform 0.2s ease-in-out',
                  transform: thinkingLevelDropdownOpen ? 'rotate(180deg)' : 'none',
                }}
              />
            </button>

            {/* 思考等级下拉菜单（4 档：极简/低/中/高）*/}
            {thinkingLevelDropdownOpen && (
              <div
                style={{
                  position: 'absolute',
                  bottom: 'calc(100% + 4px)',
                  left: 0,
                  minWidth: 140,
                  background: 'rgba(255,255,255,0.85)',
                  backdropFilter: 'blur(12px)',
                  WebkitBackdropFilter: 'blur(12px)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: 12,
                  boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
                  zIndex: 1000,
                  padding: 4,
                }}
              >
                {getAvailableThinkingLevels().map((level) => {
                  const isActive = level === currentThinkingLevel
                  return (
                    <button
                      key={level}
                      type="button"
                      onClick={() => handleSwitchThinkingLevel(level)}
                      title={getThinkingLevelDescription(level)}
                      style={{
                        width: '100%',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: 6,
                        padding: '6px 8px',
                        background: isActive ? 'rgba(0,0,0,0.06)' : 'transparent',
                        border: 'none',
                        borderRadius: 8,
                        cursor: 'pointer',
                        fontSize: 11,
                        color: 'var(--text-primary)',
                        fontFamily: 'inherit',
                        textAlign: 'left',
                        transition: 'background 0.15s ease',
                      }}
                      onMouseEnter={(e) => {
                        if (!isActive) e.currentTarget.style.background = 'rgba(0,0,0,0.03)'
                      }}
                      onMouseLeave={(e) => {
                        if (!isActive) e.currentTarget.style.background = 'transparent'
                      }}
                    >
                      <span style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 6,
                      }}>
                        <Brain size={11} style={{ flexShrink: 0, opacity: isActive ? 1 : 0.6 }} />
                        <span>{getThinkingLevelLabel(level)}</span>
                      </span>
                      {isActive && <span style={{ fontSize: 10, color: 'var(--color-primary)' }}>✓</span>}
                    </button>
                  )
                })}
              </div>
            )}
          </div>

          {/* 快速切换 model */}
          <div
            ref={modelDropdownRef}
            style={{ position: 'relative', flex: 1, minWidth: 0 }}
          >
            <button
              type="button"
              onClick={() => setModelDropdownOpen(!modelDropdownOpen)}
              disabled={!activeSessionId || !currentPreset}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                padding: '2px 8px',
                background: 'transparent',
                border: '1px solid var(--border-subtle)',
                borderRadius: 9999,
                cursor: activeSessionId && currentPreset ? 'pointer' : 'not-allowed',
                fontSize: 10,
                color: 'var(--text-secondary)',
                fontFamily: 'inherit',
                maxWidth: '100%',
                opacity: (!activeSessionId || !currentPreset) ? 0.5 : 1,
              }}
              title="切换 model"
            >
              <span style={{
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}>
                {displayModel}
              </span>
              <ChevronDown
                size={10}
                style={{
                  flexShrink: 0,
                  transition: 'transform 0.2s ease-in-out',
                  transform: modelDropdownOpen ? 'rotate(180deg)' : 'none',
                }}
              />
            </button>

            {/* model 下拉 */}
            {modelDropdownOpen && currentPreset && (
              <div
                style={{
                  position: 'absolute',
                  bottom: 'calc(100% + 4px)',
                  left: 0,
                  right: 0,
                  background: 'rgba(255,255,255,0.85)',
                  backdropFilter: 'blur(12px)',
                  WebkitBackdropFilter: 'blur(12px)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: 12,
                  boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
                  zIndex: 1000,
                  maxHeight: 200,
                  overflowY: 'auto',
                  padding: 4,
                }}
              >
                {currentPreset.models.length === 0 && (
                  <div style={{
                    padding: '8px 10px',
                    fontSize: 11,
                    color: 'var(--text-tertiary)',
                    textAlign: 'center',
                  }}>
                    该预设未配置 model
                  </div>
                )}
                {currentPreset.models.map(m => {
                  const isActive = m === displayModel
                  return (
                    <button
                      key={m}
                      type="button"
                      onClick={() => handleSwitchModel(m)}
                      style={{
                        width: '100%',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: 6,
                        padding: '6px 8px',
                        background: isActive ? 'rgba(0,0,0,0.06)' : 'transparent',
                        border: 'none',
                        borderRadius: 8,
                        cursor: 'pointer',
                        fontSize: 11,
                        color: 'var(--text-primary)',
                        fontFamily: 'inherit',
                        textAlign: 'left',
                        transition: 'background 0.15s ease',
                      }}
                      onMouseEnter={(e) => {
                        if (!isActive) e.currentTarget.style.background = 'rgba(0,0,0,0.03)'
                      }}
                      onMouseLeave={(e) => {
                        if (!isActive) e.currentTarget.style.background = 'transparent'
                      }}
                    >
                      <span style={{
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}>
                        {m}
                      </span>
                      {isActive && <span style={{ fontSize: 10, color: 'var(--color-primary)' }}>✓</span>}
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ============ API 配置弹窗 ============ */}
      <ApiConfigModal open={apiConfigOpen} onClose={() => setApiConfigOpen(false)} />
    </div>
  )
}

// ============================================================================
// 子组件：消息气泡
// ============================================================================

function MessageBubble({ message }: { message: ChatMessage }) {
  const [expanded, setExpanded] = useState(false)

  // 工具调用消息 — 可折叠卡片
  if (message.role === 'tool') {
    return (
      <div
        style={{
          alignSelf: 'flex-start',
          maxWidth: '85%',
          padding: '6px 10px',
          background: 'rgba(59, 130, 246, 0.08)',
          borderLeft: '3px solid rgba(59, 130, 246, 0.5)',
          borderRadius: 8,
          fontSize: 11,
          color: 'var(--text-secondary)',
        }}
      >
        <div
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
              background: 'rgba(0,0,0,0.04)',
              borderRadius: 4,
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

  // 用户消息 — 右对齐
  if (message.role === 'user') {
    return (
      <div
        style={{
          alignSelf: 'flex-end',
          maxWidth: '80%',
          padding: '8px 12px',
          background: 'rgba(0,0,0,0.05)',
          color: 'var(--text-primary)',
          borderRadius: 12,
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

  // AI 回复 — 左对齐
  if (message.role === 'assistant') {
    // 批次5 模块D：如果消息带 askUser 字段，渲染 AskUserCard
    if (message.askUser) {
      return (
        <AskUserCard
          requestId={message.askUser.requestId}
          question={message.askUser.question}
          options={message.askUser.options}
          allowMultiple={message.askUser.allowMultiple}
          answered={message.askUser.answered}
          selectedValues={message.askUser.selectedValues}
        />
      )
    }
    return (
      <div
        style={{
          alignSelf: 'flex-start',
          maxWidth: '85%',
          padding: '8px 12px',
          background: 'rgba(0,0,0,0.03)',
          color: 'var(--text-primary)',
          borderRadius: 12,
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

  // system 消息 — 不显示
  return null
}

// ============================================================================
// 子组件：思考中三个跳动点
// ============================================================================

function ThinkingDots() {
  return (
    <span style={{ display: 'inline-flex', gap: 3, alignItems: 'center' }}>
      {[0, 1, 2].map(i => (
        <span
          key={i}
          style={{
            width: 4,
            height: 4,
            background: 'var(--text-secondary)',
            borderRadius: '50%',
            display: 'inline-block',
            animation: `ai-thinking-bounce 1.2s ease-in-out ${i * 0.15}s infinite`,
          }}
        />
      ))}
      <style>{`
        @keyframes ai-thinking-bounce {
          0%, 60%, 100% { transform: translateY(0); opacity: 0.4; }
          30% { transform: translateY(-3px); opacity: 1; }
        }
      `}</style>
    </span>
  )
}
