/**
 * 弹出层组件（Phase 1 占位 + Phase 3 AI 形态挂载 + Phase 5 弹出层触发引擎）
 *
 * 三层画布模型中的最上层，z-index: 1000。
 * 容器本身 pointer-events: none，子元素单独设置 pointer-events: auto。
 *
 * Phase 3：根据 aiMode 挂载 FloatingOrb / BottomTaskbar（互斥）。
 * 两个组件内部均通过 createPortal 挂载到 document.body，确保始终置顶。
 *
 * Phase 5：弹出层触发引擎
 * - 渲染 usePopupStore.popups 数组中的所有弹出项（可叠加）
 * - 4 种触发模式由调用方在 showPopup 时指定（enter/condition/timer/manual）
 *   触发模式仅用于日志/调试，不影响渲染逻辑
 * - 关闭条件（closeOn）：login_success / manual / timer / ai_dismiss
 *   - manual：显示关闭按钮，用户可手动关闭
 *   - timer：autoCloseMs > 0 时定时自动关闭
 *   - login_success：登录成功时由 dismissOnLoginSuccess() 关闭
 *   - ai_dismiss：AI 可通过 dismiss_popup 工具关闭
 * - 登录窗口弹出层（popupType='login'）：含用户名/密码输入框、登录按钮、注册入口
 *   登录成功后调用 dismissOnLoginSuccess() 关闭所有含 login_success 条件的弹出层
 */
import { useEffect, useState, useRef, type CSSProperties } from 'react'
import { X, Loader2, Globe, Link2 } from 'lucide-react'
import { useAppStore } from '../stores/useAppStore'
import { usePopupStore, type PopupItem } from '../stores/usePopupStore'
import { useUserStore } from '../stores/useUserStore'
import FloatingOrb from './FloatingOrb'
import BottomTaskbar from './BottomTaskbar'

export function PopupLayer() {
  const aiMode = useAppStore(s => s.aiMode)
  const setAiMode = useAppStore(s => s.setAiMode)
  const popups = usePopupStore(s => s.popups)
  const showPopup = usePopupStore(s => s.showPopup)
  const isAuthenticated = useUserStore(s => s.isAuthenticated)

  // 进入时触发欢迎引导弹窗（仅一次，设计文档 §3.3 触发模式：enter）
  const welcomeShownRef = useRef(false)
  useEffect(() => {
    if (isAuthenticated && !welcomeShownRef.current && popups.length === 0) {
      welcomeShownRef.current = true
      showPopup({
        popupType: 'html',
        title: '欢迎使用 Daily',
        content: `
          <div style="text-align:center;padding:8px 0;">
            <div style="font-size:32px;margin-bottom:8px;">✨</div>
            <p style="font-size:14px;color:var(--text-secondary,#86868b);line-height:1.6;margin:0 0 12px;">
              你的个人画布已准备就绪。<br/>点击右下角 <strong style="color:var(--color-primary,#4A90E2);">+</strong> 添加组件，
              或点击右下角浮球与 AI 对话。
            </p>
            <div style="display:flex;gap:8px;justify-content:center;flex-wrap:wrap;font-size:12px;color:var(--text-tertiary,#adb5bd);">
              <span>🕐 时钟</span>
              <span>📝 笔记</span>
              <span>✅ 待办</span>
              <span>🎵 音乐</span>
              <span>📄 PDF</span>
            </div>
          </div>
        `,
        closeOn: ['manual'],
        trigger: 'enter',
      })
    }
  }, [isAuthenticated, popups.length, showPopup])

  return (
    <div className="popup-layer">
      {aiMode === 'orb' ? (
        <FloatingOrb onSwitchToTaskbar={() => setAiMode('taskbar')} />
      ) : (
        <BottomTaskbar onSwitchToOrb={() => setAiMode('orb')} />
      )}

      {/* 弹出层渲染已移至 App.tsx 顶层 <PopupsRoot /> 统一渲染，
          避免与 App 的 PopupsRoot 重复渲染同一 popup（导致 LoginPopup 等弹窗出现两份） */}
    </div>
  )
}

/**
 * 仅渲染弹出层（不含 FloatingOrb/BottomTaskbar），用于非 Workspace 路由
 * 例如 AuthGuard 保护的路由（/settings、/admin、/shadowshubs），
 * 这些路由不渲染 Workspace，但需要在未登录时显示 LoginPopup（spec §3.3 条件触发）
 */
export function PopupsRoot() {
  const popups = usePopupStore(s => s.popups)
  return (
    <div className="popup-layer">
      {popups.map((popup, index) => (
        <PopupRenderer key={popup.id} popup={popup} stackIndex={index} />
      ))}
    </div>
  )
}

// ============================================================================
// 单个弹出层渲染器
// ============================================================================

function PopupRenderer({ popup, stackIndex }: { popup: PopupItem; stackIndex: number }) {
  const _forceDismiss = usePopupStore(s => s._forceDismiss)

  // autoCloseMs 定时关闭（timer 条件）
  useEffect(() => {
    if (popup.autoCloseMs > 0) {
      const timer = setTimeout(() => _forceDismiss(popup.id), popup.autoCloseMs)
      return () => clearTimeout(timer)
    }
  }, [popup.id, popup.autoCloseMs, _forceDismiss])

  // 定位样式：未指定 position 时居中，叠加时轻微偏移避免完全重叠
  const positionStyle: CSSProperties = {}
  if (typeof popup.position.x === 'number' && typeof popup.position.y === 'number') {
    positionStyle.left = popup.position.x
    positionStyle.top = popup.position.y
    positionStyle.transform = 'translate(-50%, -50%)'
  } else {
    positionStyle.left = '50%'
    positionStyle.top = '50%'
    // 叠加偏移：每个弹出层向下右偏移 24px
    const offset = stackIndex * 24
    positionStyle.transform = `translate(calc(-50% + ${offset}px), calc(-50% + ${offset}px))`
  }

  const canManualClose = popup.closeOn.includes('manual')

  switch (popup.type) {
    case 'login':
      return <LoginPopup popup={popup} positionStyle={positionStyle} canClose={canManualClose} />
    case 'html':
      return <HtmlPopup popup={popup} positionStyle={positionStyle} canClose={canManualClose} />
    case 'text':
      return <TextPopup popup={popup} positionStyle={positionStyle} canClose={canManualClose} />
    case 'image':
      return <ImagePopup popup={popup} positionStyle={positionStyle} canClose={canManualClose} />
    case 'community_connect':
      return <CommunityConnectPopup popup={popup} positionStyle={positionStyle} canClose={canManualClose} />
    default:
      return null
  }
}

// ============================================================================
// 登录窗口弹出层
// ============================================================================

function LoginPopup({ popup, positionStyle, canClose }: {
  popup: PopupItem
  positionStyle: CSSProperties
  canClose: boolean
}) {
  const login = useUserStore(s => s.login)
  const register = useUserStore(s => s.register)
  const dismissOnLoginSuccess = usePopupStore(s => s.dismissOnLoginSuccess)
  const _forceDismiss = usePopupStore(s => s._forceDismiss)

  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [username, setUsername] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (loading) return
    setLoading(true)
    setError(null)
    try {
      if (mode === 'login') {
        if (username.includes('@')) {
          await login({ email: username, password })
        } else {
          await login({ username: username, password })
        }
      } else {
        if (!username || !email || !password) {
          throw new Error('请填写用户名、邮箱和密码')
        }
        await register(username, email, password)
      }
      // 登录/注册成功：关闭所有含 login_success 条件的弹出层
      dismissOnLoginSuccess()
    } catch (err) {
      setError(err instanceof Error ? err.message : '操作失败')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div
      className="popup-card popup-card--login"
      style={{
        ...positionStyle,
        position: 'absolute',
        width: 340,
        background: 'var(--bg-surface, #fff)',
        border: '1px solid var(--border-default, rgba(0,0,0,0.12))',
        borderRadius: 12,
        boxShadow: '0 12px 32px rgba(0,0,0,0.16), 0 4px 8px rgba(0,0,0,0.08)',
        padding: 24,
        zIndex: 1000 + 1,
        animation: 'popup-fade-in 0.2s ease-out',
        pointerEvents: 'auto',
      }}
    >
      {canClose && (
        <button
          onClick={() => _forceDismiss(popup.id)}
          style={{
            position: 'absolute', top: 8, right: 8,
            background: 'none', border: 'none', cursor: 'pointer',
            color: 'var(--text-tertiary, #adb5bd)', padding: 4,
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          }}
          title="关闭"
        >
          <X size={16} />
        </button>
      )}

      <h3 style={{ margin: 0, marginBottom: 16, fontSize: 18, fontWeight: 600, textAlign: 'center' }}>
        {popup.title || (mode === 'login' ? '登录' : '注册')}
      </h3>

      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <input
          type="text"
          placeholder="用户名或邮箱"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          autoComplete="username"
          style={inputStyle}
        />
        {mode === 'register' && (
          <input
            type="email"
            placeholder="邮箱"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            style={inputStyle}
          />
        )}
        <input
          type="password"
          placeholder="密码"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
          style={inputStyle}
        />

        {error && (
          <div style={{ color: 'var(--color-error, #FF3B30)', fontSize: 12, marginTop: -4 }}>
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={loading}
          style={{
            padding: '10px 16px', borderRadius: 8,
            background: 'var(--color-primary, #4A90E2)', color: '#fff',
            border: 'none', cursor: loading ? 'not-allowed' : 'pointer',
            fontSize: 14, fontWeight: 500,
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            opacity: loading ? 0.7 : 1,
          }}
        >
          {loading && <Loader2 size={14} className="animate-spin" />}
          {mode === 'login' ? '登录' : '注册'}
        </button>
      </form>

      <div style={{ marginTop: 12, textAlign: 'center', fontSize: 12, color: 'var(--text-secondary, #86868b)' }}>
        {mode === 'login' ? '没有账号？' : '已有账号？'}
        <button
          onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setError(null) }}
          style={{
            background: 'none', border: 'none', cursor: 'pointer',
            color: 'var(--color-primary, #4A90E2)', padding: '0 4px',
            fontSize: 12, textDecoration: 'underline',
          }}
        >
          {mode === 'login' ? '去注册' : '去登录'}
        </button>
      </div>
    </div>
  )
}

const inputStyle: CSSProperties = {
  padding: '8px 12px',
  borderRadius: 8,
  border: '1px solid var(--border-default, rgba(0,0,0,0.12))',
  background: 'var(--bg-elevated, #f0f0f2)',
  color: 'var(--text-primary, #1d1d1f)',
  fontSize: 14,
  fontFamily: 'inherit',
  outline: 'none',
}

// ============================================================================
// HTML 弹出层
// ============================================================================

function HtmlPopup({ popup, positionStyle, canClose }: {
  popup: PopupItem
  positionStyle: CSSProperties
  canClose: boolean
}) {
  const _forceDismiss = usePopupStore(s => s._forceDismiss)
  return (
    <div
      className="popup-card popup-card--html"
      style={{
        ...positionStyle,
        position: 'absolute',
        maxWidth: 600,
        maxHeight: '80vh',
        overflow: 'auto',
        background: 'var(--bg-surface, #fff)',
        border: '1px solid var(--border-default, rgba(0,0,0,0.12))',
        borderRadius: 12,
        boxShadow: '0 12px 32px rgba(0,0,0,0.16), 0 4px 8px rgba(0,0,0,0.08)',
        padding: 16,
        zIndex: 1000 + 1,
        animation: 'popup-fade-in 0.2s ease-out',
        pointerEvents: 'auto',
      }}
    >
      {canClose && (
        <button
          onClick={() => _forceDismiss(popup.id)}
          style={{
            position: 'absolute', top: 8, right: 8,
            background: 'none', border: 'none', cursor: 'pointer',
            color: 'var(--text-tertiary, #adb5bd)', padding: 4,
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          }}
          title="关闭"
        >
          <X size={16} />
        </button>
      )}
      {popup.title && (
        <h3 style={{ margin: 0, marginBottom: 12, fontSize: 16, fontWeight: 600 }}>
          {popup.title}
        </h3>
      )}
      <div dangerouslySetInnerHTML={{ __html: popup.content }} />
    </div>
  )
}

// ============================================================================
// 文本弹出层
// ============================================================================

function TextPopup({ popup, positionStyle, canClose }: {
  popup: PopupItem
  positionStyle: CSSProperties
  canClose: boolean
}) {
  const _forceDismiss = usePopupStore(s => s._forceDismiss)
  return (
    <div
      className="popup-card popup-card--text"
      style={{
        ...positionStyle,
        position: 'absolute',
        maxWidth: 400,
        background: 'var(--bg-surface, #fff)',
        border: '1px solid var(--border-default, rgba(0,0,0,0.12))',
        borderRadius: 12,
        boxShadow: '0 12px 32px rgba(0,0,0,0.16), 0 4px 8px rgba(0,0,0,0.08)',
        padding: 16,
        zIndex: 1000 + 1,
        animation: 'popup-fade-in 0.2s ease-out',
        pointerEvents: 'auto',
      }}
    >
      {canClose && (
        <button
          onClick={() => _forceDismiss(popup.id)}
          style={{
            position: 'absolute', top: 8, right: 8,
            background: 'none', border: 'none', cursor: 'pointer',
            color: 'var(--text-tertiary, #adb5bd)', padding: 4,
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          }}
          title="关闭"
        >
          <X size={16} />
        </button>
      )}
      {popup.title && (
        <h3 style={{ margin: 0, marginBottom: 8, fontSize: 16, fontWeight: 600 }}>
          {popup.title}
        </h3>
      )}
      <div style={{ whiteSpace: 'pre-wrap', fontSize: 14, color: 'var(--text-primary, #1d1d1f)', lineHeight: 1.5 }}>
        {popup.content}
      </div>
    </div>
  )
}

// ============================================================================
// 图片弹出层
// ============================================================================

function ImagePopup({ popup, positionStyle, canClose }: {
  popup: PopupItem
  positionStyle: CSSProperties
  canClose: boolean
}) {
  const _forceDismiss = usePopupStore(s => s._forceDismiss)
  return (
    <div
      className="popup-card popup-card--image"
      style={{
        ...positionStyle,
        position: 'absolute',
        maxWidth: 500,
        background: 'var(--bg-surface, #fff)',
        border: '1px solid var(--border-default, rgba(0,0,0,0.12))',
        borderRadius: 12,
        boxShadow: '0 12px 32px rgba(0,0,0,0.16), 0 4px 8px rgba(0,0,0,0.08)',
        padding: 16,
        zIndex: 1000 + 1,
        animation: 'popup-fade-in 0.2s ease-out',
        pointerEvents: 'auto',
      }}
    >
      {canClose && (
        <button
          onClick={() => _forceDismiss(popup.id)}
          style={{
            position: 'absolute', top: 8, right: 8,
            background: 'none', border: 'none', cursor: 'pointer',
            color: 'var(--text-tertiary, #adb5bd)', padding: 4,
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          }}
          title="关闭"
        >
          <X size={16} />
        </button>
      )}
      {popup.title && (
        <h3 style={{ margin: 0, marginBottom: 8, fontSize: 16, fontWeight: 600 }}>
          {popup.title}
        </h3>
      )}
      <img
        src={popup.content}
        alt={popup.title || 'popup image'}
        style={{ maxWidth: '100%', height: 'auto', borderRadius: 8, display: 'block' }}
      />
    </div>
  )
}

// ============================================================================
// 社区面板连接弹出层（spec §8.2 + §9.4）
// ============================================================================

/**
 * CommunityConnectPopup — 创建社区面板时弹出（不直接建空白面板）
 *
 * 设计文档 §8.2：创建社区面板时弹出登录窗口，登录窗口必须有用，不能只是漂亮，
 *   登录成功后关闭弹出层。
 * 设计文档 §9.4：创建社群面板时输入内容（社区地址/API），连接到外部社群，
 *   连接涉及用户管理、用户筛选。
 *
 * 行为：
 * - "跳过，创建本地社区面板"：不连接外部，onClose({ skipped: true })
 * - "连接并创建"：用用户名+密码对 {apiUrl}/api/auth/login 发起真实 POST 鉴权
 *   成功 → onClose({ connected: true, apiUrl, communityName })
 *   失败 → 显示错误，弹窗保留
 * - X 关闭：放弃操作（不触发 onClose）
 */
function CommunityConnectPopup({ popup, positionStyle, canClose }: {
  popup: PopupItem
  positionStyle: CSSProperties
  canClose: boolean
}) {
  const _forceDismiss = usePopupStore(s => s._forceDismiss)

  const [apiUrl, setApiUrl] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [communityName, setCommunityName] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  /** 规范化外部社区 API 地址：去除尾部斜杠 */
  const normalizeUrl = (raw: string): string => raw.trim().replace(/\/+$/, '')

  const finishWith = (result: unknown): void => {
    if (popup.onClose) {
      try {
        popup.onClose(result)
      } catch (err) {
        console.error('[CommunityConnectPopup] onClose threw:', err)
      }
    }
    _forceDismiss(popup.id)
  }

  const handleSkip = (): void => {
    if (loading) return
    finishWith({ skipped: true })
  }

  const handleConnect = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    if (loading) return
    const normalizedUrl = normalizeUrl(apiUrl)
    if (!normalizedUrl) {
      setError('请输入外部社区地址')
      return
    }
    // 基本 URL 校验
    try {
      // URL 构造会校验协议合法性
      void new URL(normalizedUrl)
    } catch {
      setError('社区地址格式不正确，需包含协议（如 https://）')
      return
    }
    if (!username || !password) {
      setError('请输入外部社区的用户名和密码')
      return
    }

    setLoading(true)
    setError(null)
    try {
      // 真实鉴权：调用外部社区的 /api/auth/login（与本地 Daily 部署一致的契约）
      const resp = await fetch(`${normalizedUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
        // 不携带本地凭据，避免误用 cookie
        credentials: 'omit',
      })
      if (!resp.ok) {
        // 尝试解析错误信息
        let detail = `外部社区返回 ${resp.status}`
        try {
          const body = await resp.json()
          if (body && typeof body.error === 'string') detail = body.error
        } catch { /* 非 JSON 响应，使用默认 detail */ }
        throw new Error(`登录失败：${detail}`)
      }
      // 登录成功 → 关闭弹窗并回传结果
      const name = communityName.trim() || (() => {
        try { return new URL(normalizedUrl).hostname } catch { return '新社区面板' }
      })()
      finishWith({ connected: true, apiUrl: normalizedUrl, communityName: name })
    } catch (err) {
      const msg = err instanceof Error ? err.message : '无法连接到外部社区'
      setError(msg)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div
      className="popup-card popup-card--community-connect"
      style={{
        ...positionStyle,
        position: 'absolute',
        width: 380,
        background: 'var(--bg-surface, #fff)',
        border: '1px solid var(--border-default, rgba(0,0,0,0.12))',
        borderRadius: 12,
        boxShadow: '0 12px 32px rgba(0,0,0,0.16), 0 4px 8px rgba(0,0,0,0.08)',
        padding: 24,
        zIndex: 1000 + 1,
        animation: 'popup-fade-in 0.2s ease-out',
        pointerEvents: 'auto',
      }}
    >
      {canClose && (
        <button
          onClick={() => _forceDismiss(popup.id)}
          style={{
            position: 'absolute', top: 8, right: 8,
            background: 'none', border: 'none', cursor: 'pointer',
            color: 'var(--text-tertiary, #adb5bd)', padding: 4,
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          }}
          title="关闭"
        >
          <X size={16} />
        </button>
      )}

      <h3 style={{ margin: 0, marginBottom: 4, fontSize: 18, fontWeight: 600, textAlign: 'center' }}>
        创建社区面板
      </h3>
      <p style={{ margin: 0, marginBottom: 16, fontSize: 12, color: 'var(--text-secondary, #86868b)', textAlign: 'center', lineHeight: 1.5 }}>
        连接外部社群以同步用户与内容，或跳过创建本地社区面板
      </p>

      <form onSubmit={handleConnect} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {/* 外部社区地址 */}
        <div style={{ position: 'relative' }}>
          <Link2 size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-tertiary, #adb5bd)' }} />
          <input
            type="url"
            placeholder="外部社区 API 地址（如 https://community.example.com）"
            value={apiUrl}
            onChange={(e) => setApiUrl(e.target.value)}
            autoComplete="url"
            style={{ ...inputStyle, paddingLeft: 30 }}
          />
        </div>
        {/* 社区面板名称（可选） */}
        <input
          type="text"
          placeholder="社区面板名称（可选，留空用域名）"
          value={communityName}
          onChange={(e) => setCommunityName(e.target.value)}
          autoComplete="off"
          style={inputStyle}
        />
        {/* 外部社区登录凭据 */}
        <div style={{ height: 1, background: 'var(--border-default, rgba(0,0,0,0.08))', margin: '4px 0' }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-secondary, #86868b)' }}>
          <Globe size={12} /> 外部社区登录（用户管理 / 用户筛选）
        </div>
        <input
          type="text"
          placeholder="外部社区用户名"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          autoComplete="username"
          style={inputStyle}
        />
        <input
          type="password"
          placeholder="外部社区密码"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          style={inputStyle}
        />

        {error && (
          <div style={{ color: 'var(--color-error, #FF3B30)', fontSize: 12, marginTop: -4, wordBreak: 'break-word' }}>
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={loading}
          style={{
            padding: '10px 16px', borderRadius: 8,
            background: 'var(--color-primary, #4A90E2)', color: '#fff',
            border: 'none', cursor: loading ? 'not-allowed' : 'pointer',
            fontSize: 14, fontWeight: 500,
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            opacity: loading ? 0.7 : 1,
          }}
        >
          {loading && <Loader2 size={14} className="animate-spin" />}
          连接并创建
        </button>
      </form>

      <button
        onClick={handleSkip}
        disabled={loading}
        style={{
          marginTop: 10, width: '100%', padding: '8px 16px', borderRadius: 8,
          background: 'transparent', color: 'var(--text-secondary, #86868b)',
          border: '1px solid var(--border-default, rgba(0,0,0,0.12))',
          cursor: loading ? 'not-allowed' : 'pointer',
          fontSize: 13, fontWeight: 500,
        }}
      >
        跳过，创建本地社区面板
      </button>
    </div>
  )
}
