/**
 * CanvasHome 组件（Phase 4 任务 5.4 画布主页）
 *
 * 内容：
 * - 圆形图标（可替换，默认 logo.png）
 * - AI 对话框（类 Tabbit，不创建组件，可导航/创建面板）
 * - 收藏组件网格（Phase 5 做预览，Phase 4 先做图标形式）
 *   - + 添加收藏组件按钮
 * - 收藏组件入口
 *
 * AI 对话框行为：
 * - 输入消息 → 发送到当前面板的 AI session
 * - AI 回复不创建组件，直接在对话框显示
 * - 可通过命令创建新面板（如 "创建学习面板"）
 */
import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { Bot, Send, Plus, Sparkles, LayoutGrid, Star, Settings, X, Globe, Clock, ExternalLink, Monitor } from 'lucide-react'
import { useAppStore } from '../stores/useAppStore'
import { useToastStore } from '../stores/useToastStore'
import { useAIStore } from '../stores/useAIStore'
import { getBuiltInWidgetConfigs, getDynamicWidgetConfigs } from '../registry'
import type { ChatMessage } from '../types/ai'
import type { FavoriteEntry, WebTab, Panel, WidgetConfig } from '../types'
import FavoriteWidgetPreview from './FavoriteWidgetPreview'
import logoUrl from '../assets/logo.png'

interface CanvasHomeProps {
  /** 关联的画布面板 ID */
  panelId?: string
}

export default function CanvasHome({ panelId }: CanvasHomeProps) {
  // 订阅 app store
  const panels = useAppStore(s => s.panels)
  const navigate = useNavigate()
  const activePanelId = useAppStore(s => s.activePanelId)
  const favorites = useAppStore(s => s.favorites)
  const addWidget = useAppStore(s => s.addWidget)
  const setActivePanel = useAppStore(s => s.setActivePanel)
  const setMainView = useAppStore(s => s.setMainView)
  const ensurePrimarySession = useAppStore(s => s.ensurePrimarySession)
  const primaryAISessionId = useAppStore(s => s.primaryAISessionId)
  const getPrimaryAIWidgetIdOfPanel = useAppStore(s => s.getPrimaryAIWidgetIdOfPanel)
  // Phase 7 批次6 任务5：主页模板 + 快捷链接数据
  const homeTemplate = useAppStore(s => s.homeTemplate)
  const webTabs = useAppStore(s => s.webTabs)
  const setActiveWebTab = useAppStore(s => s.setActiveWebTab)

  // 订阅 AI store
  const sessions = useAIStore(s => s.sessions)
  const isInitialized = useAIStore(s => s.isInitialized)
  const isOnline = useAIStore(s => s.isOnline)
  const initialize = useAIStore(s => s.initialize)
  const sendMessage = useAIStore(s => s.sendMessage)
  // Phase 7 批次2 任务3: toast 反馈
  const showToast = useToastStore(s => s.showToast)
  const updateToast = useToastStore(s => s.updateToast)

  // 本地状态
  const [inputValue, setInputValue] = useState('')
  const [showAddWidgetDialog, setShowAddWidgetDialog] = useState(false)
  // AI 对话框状态机：idle（收起）→ focused（聚焦未输入）→ expanded（有消息或正在对话）
  const [aiMode, setAiMode] = useState<'idle' | 'focused' | 'expanded'>('idle')
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const aiContainerRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // 当前面板 ID（优先使用 props，其次用 activePanelId）
  const currentPanelId = panelId ?? activePanelId ?? ''
  const currentPanel = panels.find(p => p.id === currentPanelId)

  // 当前面板的 AI session ID（优先用 primaryAISessionId，否则用 activeSessionId）
  const sessionId = primaryAISessionId ?? ''
  const session = sessionId ? sessions[sessionId] : undefined
  const messages = useMemo<ChatMessage[]>(() => session?.messages ?? [], [session])
  const sessionStatus = session?.status ?? 'idle'

  // 初始化 AI store
  useEffect(() => {
    if (!isInitialized) {
      initialize()
    }
  }, [isInitialized, initialize])

  // 确保主 AI session 存在
  useEffect(() => {
    if (!currentPanelId) return
    void ensurePrimarySession(currentPanelId).catch(console.error)
  }, [currentPanelId, ensurePrimarySession])

  // 自动滚动到底部
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, sessionStatus])

  // 点击外部区域收起 AI 对话框
  useEffect(() => {
    if (aiMode === 'idle') return
    const handler = (e: MouseEvent) => {
      if (aiContainerRef.current && !aiContainerRef.current.contains(e.target as Node)) {
        setAiMode('idle')
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [aiMode])

  // 处理发送消息
  const handleSend = useCallback(async () => {
    const trimmed = inputValue.trim()
    if (!trimmed) return
    if (!sessionId) return
    if (!isOnline) return
    if (sessionStatus === 'thinking' || sessionStatus === 'tool_calling') return

    // 确保当前面板是活跃面板（sendMessage 内部会从 activePanelId 获取）
    if (currentPanelId && activePanelId !== currentPanelId) {
      await setActivePanel(currentPanelId)
    }

    setInputValue('')
    setAiMode('expanded')
    // 使用主 AI widget ID 作为 callerWidgetId（如果存在）
    const callerWidgetId = currentPanelId ? getPrimaryAIWidgetIdOfPanel(currentPanelId) : undefined
    await sendMessage(sessionId, trimmed, callerWidgetId ?? undefined)
  }, [inputValue, sessionId, isOnline, sessionStatus, sendMessage, currentPanelId, activePanelId, setActivePanel, getPrimaryAIWidgetIdOfPanel])

  // 处理键盘事件
  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }, [handleSend])

  // 添加组件到当前面板（Phase 7 批次2 任务3: 包裹 toast loading/success/error 反馈）
  const handleAddWidget = useCallback(async (widgetType: string) => {
    if (!currentPanelId) return
    const toastId = showToast({ type: 'loading', message: '正在添加组件...' })
    try {
      await addWidget(widgetType, { panelId: currentPanelId })
      // 添加后切换到画布面板视图
      await setActivePanel(currentPanelId)
      setMainView({ type: 'canvas-panel', panelId: currentPanelId })
      updateToast(toastId, { type: 'success', message: '已添加组件', duration: 2000 })
    } catch (err) {
      const msg = err instanceof Error ? err.message : '添加组件失败'
      updateToast(toastId, { type: 'error', message: msg, duration: 4000 })
    } finally {
      setShowAddWidgetDialog(false)
    }
  }, [currentPanelId, addWidget, setActivePanel, setMainView, showToast, updateToast])

  // 进入画布面板（点击圆形图标或收藏组件入口）
  const handleEnterCanvas = useCallback(async () => {
    if (!currentPanelId) return
    await setActivePanel(currentPanelId)
    setMainView({ type: 'canvas-panel', panelId: currentPanelId })
  }, [currentPanelId, setActivePanel, setMainView])

  // Phase 5: 点击收藏组件跳转到对应面板和位置
  const handleFavoriteClick = useCallback(async (favorite: FavoriteEntry) => {
    setMainView({ type: 'canvas-panel', panelId: favorite.panelId })
    await setActivePanel(favorite.panelId)
    const livePos = useAppStore.getState().panelPositions[favorite.panelId]
      ?.find(p => p.widgetId === favorite.widgetId)
    const pos = livePos
      ? { x: livePos.x, y: livePos.y, w: livePos.w, h: livePos.h }
      : favorite.positionSnapshot
    useAppStore.getState().teleportTo(pos.x + pos.w / 2, pos.y + pos.h / 2)
  }, [setMainView, setActivePanel])

  // C9 修复：定义独立的 PlaceholderWidgetConfig 类型，避免污染 WidgetConfig 接口
  // C10 修复：PlaceholderWidgetConfig 不含 serialize/deserialize 字段（避免签名不匹配 TS2322）
  type PlaceholderWidgetConfig = {
    widgetType: string
    displayName: string
    icon: string
    defaultLayout: Record<string, unknown>
    defaultState: Record<string, unknown>
    isDynamic: true
    isPlaceholder: true  // 标记占位
  }

  // C7 修复：响应式订阅 store 中的 dynamicWidgets
  const dynamicWidgets = useAppStore(s => s.dynamicWidgets)

  // 合并 built-in + 已注册 dynamic（pure-frontend）+ local-dependent 占位
  const allWidgetConfigs = useMemo<Array<WidgetConfig | PlaceholderWidgetConfig>>(() => {
    const builtIn = getBuiltInWidgetConfigs()
    const registered = getDynamicWidgetConfigs()  // 仅含 pure-frontend（M3 过滤后）
    // C8 修复：local-dependent 组件构造占位 WidgetConfig（不可渲染，仅用于显示徽章）
    const localDependentPlaceholders: PlaceholderWidgetConfig[] = dynamicWidgets
      .filter(d => d.componentEnv === 'local-dependent')
      .map(d => ({
        widgetType: d.widgetType,
        displayName: d.displayName,
        icon: d.icon,
        defaultLayout: d.defaultLayout,
        defaultState: d.defaultState,
        isDynamic: true,
        isPlaceholder: true,
      }))
    return [...builtIn, ...registered, ...localDependentPlaceholders]
  }, [dynamicWidgets])

  const dynamicWidgetEnvs = dynamicWidgets  // 直接使用响应式值

  const renderEnvLabel = (config: WidgetConfig | PlaceholderWidgetConfig) => {
    if ('isPlaceholder' in config && config.isPlaceholder) {
      // local-dependent 占位：橙色徽章（spec 验收标准：仅桌面端）
      return (
        <span style={{
          display: 'inline-flex', alignItems: 'center', gap: 2,
          padding: '1px 4px', borderRadius: 4, fontSize: 9,
          background: 'rgba(255, 159, 64, 0.15)', color: '#ff9f40',
          border: '1px solid rgba(255, 159, 64, 0.3)',
        }}>
          <Monitor size={8} /> 仅桌面端
        </span>
      )
    }
    // 查找该 widget 的 env 信息
    const dynDef = dynamicWidgetEnvs.find(d => d.widgetType === config.widgetType)
    if (dynDef) {
      if (dynDef.desktopOnly) {
        // desktop_only 组件不应出现在 web 端（已被过滤），但兜底处理
        return null
      }
      if (dynDef.componentEnv === 'pure-frontend') {
        return (
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: 2,
            padding: '1px 4px', borderRadius: 4, fontSize: 9,
            background: 'rgba(80, 227, 194, 0.15)', color: 'var(--color-secondary)',
            border: '1px solid rgba(80, 227, 194, 0.3)',
          }}>
            <Globe size={8} /> 纯前端
          </span>
        )
      }
    }
    return null
  }

  // C8 修复：占位按钮点击时提示，正常按钮调用 handleAddWidget（保留 toast 反馈）
  const handleWidgetButtonClick = (config: WidgetConfig | PlaceholderWidgetConfig) => {
    if ('isPlaceholder' in config && config.isPlaceholder) {
      alert('该组件依赖桌面端本地服务，Web 端不可用')
      return
    }
    handleAddWidget(config.widgetType)  // M9 修复：保留 toast 反馈
  }

  // Phase 7 批次6 任务5：rich 模板的快捷链接（前 6 个 webTabs）
  const quickLinks = useMemo<WebTab[]>(() => webTabs.slice(0, 6), [webTabs])

  // Phase 7 批次6 任务5：rich 模板的最近访问面板（排除当前面板，按 order 降序取前 4 个）
  // 注：Panel 无 lastAccessedAt 字段，用 order 降序近似"最近"（新创建的排前）
  const recentPanels = useMemo<Panel[]>(() => {
    return panels
      .filter(p => p.id !== currentPanelId)
      .slice(-4)         // 取最后 4 个（order 较大的）
      .reverse()         // 降序：最新创建的在前
  }, [panels, currentPanelId])

  // Phase 7 批次6 任务5：点击快捷链接 → 切换到对应 web-tab 视图
  const handleQuickLinkClick = useCallback((tab: WebTab) => {
    if (!tab.url) {
      // URL 为空时切换到浏览器主页
      setMainView({ type: 'browser-home', tabId: tab.id })
      return
    }
    setActiveWebTab(tab.id)
    setMainView({ type: 'web-tab', tabId: tab.id })
  }, [setActiveWebTab, setMainView])

  // Phase 7 批次6 任务5：点击最近面板 → 切换到对应画布面板视图
  const handleRecentPanelClick = useCallback(async (panel: Panel) => {
    await setActivePanel(panel.id)
    setMainView({ type: 'canvas-panel', panelId: panel.id })
  }, [setActivePanel, setMainView])

  const isBusy = sessionStatus === 'thinking' || sessionStatus === 'tool_calling'
  const canSend = inputValue.trim().length > 0 && isOnline && !isBusy && !!sessionId

  return (
    <div
      className="canvas-home"
      style={{
        height: '100%',
        overflowY: 'auto',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        padding: '32px 24px 24px',
        background: 'var(--bg-canvas)',
        position: 'relative',
      }}
    >
      {/* S13.2-T6：设置入口按钮（浮动右上角，跳转 /settings 路由） */}
      <button
        onClick={() => navigate('/settings')}
        title="设置"
        style={{
          position: 'absolute',
          top: 16,
          right: 16,
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          padding: '6px 12px',
          borderRadius: 8,
          border: '1px solid var(--border-default)',
          background: 'var(--bg-surface)',
          color: 'var(--text-secondary)',
          fontSize: 12,
          cursor: 'pointer',
          fontFamily: 'inherit',
          zIndex: 100,
          transition: 'background 0.15s ease',
        }}
        onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-elevated)' }}
        onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--bg-surface)' }}
      >
        <Settings size={14} />
        <span>设置</span>
      </button>

      {/* 圆形图标区域 */}
      <div
        className="canvas-home__icon"
        onClick={handleEnterCanvas}
        style={{
          marginBottom: 24,
          cursor: 'pointer',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 8,
        }}
        title="点击进入画布"
      >
        <div
          style={{
            width: 80,
            height: 80,
            borderRadius: '50%',
            overflow: 'hidden',
            boxShadow: '0 4px 20px rgba(74, 144, 226, 0.3)',
            border: '2px solid var(--color-primary)',
            transition: 'transform 0.2s',
          }}
          onMouseEnter={e => {
            e.currentTarget.style.transform = 'scale(1.05)'
          }}
          onMouseLeave={e => {
            e.currentTarget.style.transform = 'scale(1)'
          }}
        >
          <img
            src={logoUrl}
            alt="Logo"
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'cover',
            }}
          />
        </div>
        <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>
          {currentPanel?.name ?? '画布'}
        </span>
        <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
          点击进入画布
        </span>
      </div>

      {/* AI 对话框（收起式：pill 输入框 ↔ 展开对话区域） */}
      <div
        ref={aiContainerRef}
        className="canvas-home__ai-input"
        style={{
          width: '100%',
          maxWidth: 640,
          marginBottom: 32,
          position: 'relative',
          display: 'flex',
          flexDirection: 'column',
          // 收起态 maxHeight 48px（仅 pill），展开态最大 480px
          maxHeight: aiMode === 'idle' ? 48 : 480,
          overflow: 'hidden',
          // 0.3s cubic-bezier 展开/收起动画
          transition: 'max-height 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
        }}
      >
        {/* 消息列表（融入页面，无边框无标题，气泡直接浮在页面上） */}
        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: '8px 12px',
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
            minHeight: 0,
          }}
        >
          {messages.length === 0 && !isBusy && (
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
              {isOnline ? '向 AI 助手提问吧（如"创建学习面板"）' : '正在连接 AI 服务...'}
            </div>
          )}

          {messages.map((msg, idx) => (
            <MessageBubble key={`${msg.timestamp}-${idx}`} message={msg} />
          ))}

          {/* 思考中指示器（typing dots 动画，3 个小圆点交替闪烁） */}
          {isBusy && (
            <div className="ai-typing-dots" title={sessionStatus === 'tool_calling' ? '工具调用中...' : 'AI 思考中...'}>
              <span className="ai-typing-dot" />
              <span className="ai-typing-dot" />
              <span className="ai-typing-dot" />
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* 右上角悬浮小图标：设置 + 关闭展开（仅展开态显示） */}
        {aiMode !== 'idle' && (
          <div
            style={{
              position: 'absolute',
              top: 4,
              right: 4,
              display: 'flex',
              gap: 4,
              zIndex: 10,
            }}
          >
            <button
              onClick={() => useAppStore.setState({ showSettings: true })}
              title="设置"
              style={{
                width: 28,
                height: 28,
                borderRadius: '50%',
                border: 'none',
                background: 'var(--bg-elevated)',
                color: 'var(--text-secondary)',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Settings size={14} />
            </button>
            <button
              onClick={() => setAiMode('idle')}
              title="收起"
              style={{
                width: 28,
                height: 28,
                borderRadius: '50%',
                border: 'none',
                background: 'var(--bg-elevated)',
                color: 'var(--text-secondary)',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <X size={14} />
            </button>
          </div>
        )}

        {/* 错误条 */}
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

        {/* pill 输入框（收起态居中显示，展开态固定底部） */}
        <div
          onClick={() => {
            // 点击 pill 任意区域聚焦 textarea（收起态切换到 focused）
            if (aiMode === 'idle') setAiMode('focused')
            textareaRef.current?.focus()
          }}
          style={{
            height: 48,
            borderRadius: 24,
            background: 'var(--bg-surface)',
            border: '1px solid var(--border-default)',
            display: 'flex',
            alignItems: 'center',
            padding: '0 12px',
            gap: 8,
            flexShrink: 0,
            boxShadow: 'var(--shadow-sm)',
            cursor: 'text',
            transition: 'border-color 0.2s, box-shadow 0.2s',
          }}
        >
          {/* 左侧 AI 图标 + 在线/离线小圆点（直径 8px） */}
          <div
            style={{
              position: 'relative',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <Bot size={18} color="var(--color-primary)" />
            <span
              style={{
                position: 'absolute',
                bottom: -1,
                right: -1,
                width: 8,
                height: 8,
                borderRadius: '50%',
                background: isOnline ? 'var(--color-success)' : 'var(--color-error)',
                border: '1.5px solid var(--bg-surface)',
              }}
              title={isOnline ? '在线' : '离线'}
            />
          </div>

          {/* 输入框（pill 内部，无边框透明） */}
          <textarea
            ref={textareaRef}
            value={inputValue}
            onChange={e => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            onFocus={() => {
              // 聚焦时从收起态切换到展开态
              if (aiMode === 'idle') setAiMode('focused')
            }}
            placeholder={
              !isOnline
                ? '连接中...'
                : !sessionId
                ? '初始化中...'
                : '有什么想问的...'
            }
            style={{
              flex: 1,
              padding: '4px 0',
              border: 'none',
              background: 'transparent',
              color: 'var(--text-primary)',
              fontSize: 13,
              fontFamily: 'inherit',
              resize: 'none',
              outline: 'none',
              minHeight: 24,
              maxHeight: 80,
              lineHeight: 1.4,
            }}
            rows={1}
          />

          {/* 发送按钮（仅展开态显示，圆形） */}
          {aiMode !== 'idle' && (
            <button
              onClick={handleSend}
              disabled={!canSend}
              style={{
                width: 32,
                height: 32,
                borderRadius: '50%',
                border: 'none',
                background: canSend ? 'var(--color-primary)' : 'var(--bg-elevated)',
                color: canSend ? '#fff' : 'var(--text-tertiary)',
                cursor: canSend ? 'pointer' : 'not-allowed',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}
            >
              <Send size={14} />
            </button>
          )}
        </div>
      </div>

      {/* Phase 7 批次6 任务5：minimal 模板隐藏收藏组件网格 */}
      {homeTemplate !== 'minimal' && (
      <div
        className="canvas-home__widgets"
        style={{
          width: '100%',
          maxWidth: 800,
          marginBottom: 24,
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 12,
          }}
        >
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <Sparkles size={14} />
            收藏组件
          </span>
          <button
            onClick={() => setShowAddWidgetDialog(!showAddWidgetDialog)}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              padding: '4px 10px',
              borderRadius: 6,
              border: '1px dashed var(--border-default)',
              background: 'transparent',
              color: 'var(--text-secondary)',
              fontSize: 12,
              cursor: 'pointer',
            }}
          >
            <Plus size={12} /> 添加组件
          </button>
        </div>

        {/* 添加组件对话框 */}
        {showAddWidgetDialog && (
          <div
            style={{
              padding: 12,
              marginBottom: 12,
              borderRadius: 8,
              border: '1px solid var(--border-default)',
              background: 'var(--bg-surface)',
              maxHeight: 240,
              overflowY: 'auto',
            }}
          >
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))',
                gap: 8,
              }}
            >
              {allWidgetConfigs.map(config => (
                <button
                  key={config.widgetType}
                  onClick={() => handleWidgetButtonClick(config)}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: 4,
                    padding: 10,
                    borderRadius: 6,
                    border: '1px solid var(--border-subtle)',
                    background: 'var(--bg-canvas)',
                    color: 'var(--text-secondary)',
                    fontSize: 11,
                    cursor: 'pointer',
                    transition: 'all 0.15s',
                  }}
                  onMouseEnter={e => {
                    e.currentTarget.style.borderColor = 'var(--color-primary)'
                    e.currentTarget.style.color = 'var(--color-primary)'
                  }}
                  onMouseLeave={e => {
                    e.currentTarget.style.borderColor = 'var(--border-subtle)'
                    e.currentTarget.style.color = 'var(--text-secondary)'
                  }}
                >
                  <span style={{ fontSize: 18 }}>{config.icon}</span>
                  <span>{config.displayName}</span>
                  {renderEnvLabel(config)}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* 收藏组件网格（Phase 5：预览 + 跳转） */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
            gap: 12,
            justifyItems: 'center',
          }}
        >
          {favorites.slice(0, 8).map(favorite => (
            <FavoriteWidgetPreview
              key={favorite.id}
              favorite={favorite}
              onClick={() => handleFavoriteClick(favorite)}
            />
          ))}
          {favorites.length > 8 && favorites.slice(8).map(favorite => {
            const config = allWidgetConfigs.find(c => c.widgetType === favorite.widgetType)
            return (
              <div
                key={favorite.id}
                onClick={() => handleFavoriteClick(favorite)}
                style={{
                  width: 160,
                  height: 120,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 6,
                  borderRadius: 8,
                  border: '1px solid var(--border-subtle)',
                  background: 'var(--bg-surface)',
                  cursor: 'pointer',
                  transition: 'border-color 0.15s',
                  position: 'relative',
                }}
                onMouseEnter={e => {
                  e.currentTarget.style.borderColor = 'var(--color-primary)'
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.borderColor = 'var(--border-subtle)'
                }}
                title={`点击跳转到 ${favorite.displayName}`}
              >
                <div style={{
                  position: 'absolute',
                  top: 4,
                  right: 4,
                  color: 'var(--color-warning)',
                  pointerEvents: 'none',
                }}>
                  <Star size={12} fill="currentColor" />
                </div>
                <div
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: 8,
                    background: 'var(--bg-elevated)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: 'var(--color-primary)',
                    fontSize: 18,
                  }}
                >
                  {config?.icon ?? <LayoutGrid size={18} />}
                </div>
                <span
                  style={{
                    fontSize: 11,
                    color: 'var(--text-secondary)',
                    textAlign: 'center',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    maxWidth: '90%',
                  }}
                >
                  {favorite.displayName}
                </span>
              </div>
            )
          })}
          {favorites.length === 0 && (
            <div
              style={{
                gridColumn: '1 / -1',
                padding: 24,
                textAlign: 'center',
                color: 'var(--text-tertiary)',
                fontSize: 12,
              }}
            >
              还没有收藏组件，右键组件选择'收藏'
            </div>
          )}
        </div>
      </div>
      )}

      {/* Phase 7 批次6 任务5：rich 模板专属区块（快捷链接区 + 最近访问面板区） */}
      {homeTemplate === 'rich' && (
        <>
          {/* 快捷链接区（前 6 个 webTabs 的快捷入口） */}
          <div
            className="canvas-home__quick-links"
            style={{
              width: '100%',
              maxWidth: 800,
              marginBottom: 24,
            }}
          >
            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)', display: 'inline-flex', alignItems: 'center', gap: 4, marginBottom: 12 }}>
              <Globe size={14} />
              快捷链接
            </span>
            {quickLinks.length === 0 ? (
              <div style={{ fontSize: 12, color: 'var(--text-tertiary)', padding: '12px 0' }}>
                还没有网页标签，新建标签后会出现在这里
              </div>
            ) : (
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))',
                  gap: 8,
                }}
              >
                {quickLinks.map(tab => (
                  <button
                    key={tab.id}
                    onClick={() => handleQuickLinkClick(tab)}
                    title={tab.url || '空白标签'}
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      gap: 4,
                      padding: '10px 8px',
                      borderRadius: 12, // pill 形状（批次1 规范）
                      border: 'none',   // 无边框
                      background: 'rgba(128, 128, 128, 0.04)', // 半透明
                      color: 'var(--text-secondary)',
                      fontSize: 11,
                      cursor: 'pointer',
                      transition: 'background 0.15s',
                      overflow: 'hidden',
                    }}
                    onMouseEnter={e => {
                      e.currentTarget.style.background = 'rgba(128, 128, 128, 0.08)'
                    }}
                    onMouseLeave={e => {
                      e.currentTarget.style.background = 'rgba(128, 128, 128, 0.04)'
                    }}
                  >
                    <div
                      style={{
                        width: 28,
                        height: 28,
                        borderRadius: '50%',
                        background: 'var(--bg-elevated)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: 'var(--color-primary)',
                        flexShrink: 0,
                      }}
                    >
                      <Globe size={14} />
                    </div>
                    <span
                      style={{
                        textAlign: 'center',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        maxWidth: '100%',
                      }}
                    >
                      {tab.title || tab.url || '新标签页'}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* 最近访问面板区（最近 4 个 panels，排除当前面板） */}
          <div
            className="canvas-home__recent-panels"
            style={{
              width: '100%',
              maxWidth: 800,
              marginBottom: 24,
            }}
          >
            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)', display: 'inline-flex', alignItems: 'center', gap: 4, marginBottom: 12 }}>
              <Clock size={14} />
              最近访问面板
            </span>
            {recentPanels.length === 0 ? (
              <div style={{ fontSize: 12, color: 'var(--text-tertiary)', padding: '12px 0' }}>
                还没有其他面板，新建面板后会出现在这里
              </div>
            ) : (
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
                  gap: 8,
                }}
              >
                {recentPanels.map(panel => (
                  <button
                    key={panel.id}
                    onClick={() => handleRecentPanelClick(panel)}
                    title={`切换到面板：${panel.name}`}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      padding: '10px 12px',
                      borderRadius: 12, // pill 形状
                      border: 'none',
                      background: 'rgba(128, 128, 128, 0.04)',
                      color: 'var(--text-secondary)',
                      fontSize: 12,
                      cursor: 'pointer',
                      transition: 'background 0.15s',
                      textAlign: 'left',
                    }}
                    onMouseEnter={e => {
                      e.currentTarget.style.background = 'rgba(128, 128, 128, 0.08)'
                    }}
                    onMouseLeave={e => {
                      e.currentTarget.style.background = 'rgba(128, 128, 128, 0.04)'
                    }}
                  >
                    <div
                      style={{
                        width: 24,
                        height: 24,
                        borderRadius: 6,
                        background: 'var(--color-primary-muted)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: 'var(--color-primary)',
                        flexShrink: 0,
                      }}
                    >
                      <LayoutGrid size={12} />
                    </div>
                    <span
                      style={{
                        flex: 1,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {panel.name}
                    </span>
                    <ExternalLink size={12} style={{ opacity: 0.5, flexShrink: 0 }} />
                  </button>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {/* 收藏组件入口（点击进入画布） */}
      <button
        onClick={handleEnterCanvas}
        style={{
          padding: '8px 16px',
          borderRadius: 8,
          border: '1px solid var(--color-primary)',
          background: 'var(--color-primary-muted)',
          color: 'var(--color-primary-light)',
          fontSize: 12,
          cursor: 'pointer',
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
        }}
      >
        进入画布 →
      </button>
    </div>
  )
}

/**
 * 消息气泡组件（复用 AIAssistant 的样式）
 */
function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === 'user'
  const isTool = message.role === 'tool'

  if (isTool) {
    // 工具消息折叠显示
    return (
      <div
        style={{
          alignSelf: 'flex-start',
          maxWidth: '85%',
          padding: '4px 8px',
          background: 'var(--bg-elevated)',
          borderRadius: 4,
          fontSize: 10,
          color: 'var(--text-tertiary)',
          fontFamily: 'monospace',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
        }}
      >
        [工具] {message.content.slice(0, 100)}
        {message.content.length > 100 ? '...' : ''}
      </div>
    )
  }

  return (
    <div
      style={{
        alignSelf: isUser ? 'flex-end' : 'flex-start',
        maxWidth: '85%',
        padding: '6px 10px',
        background: isUser ? 'var(--color-primary)' : 'var(--bg-elevated)',
        color: isUser ? '#fff' : 'var(--text-primary)',
        borderRadius: isUser ? '12px 12px 2px 12px' : '12px 12px 12px 2px',
        fontSize: 12,
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
      }}
    >
      {message.content}
    </div>
  )
}
