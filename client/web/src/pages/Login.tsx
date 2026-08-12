import { useState, type FormEvent, type CSSProperties } from 'react'
import { useNavigate } from 'react-router-dom'
import { Sparkles, Lock, Mail, User, Eye, EyeOff, Loader2, ArrowRight, KeyRound } from 'lucide-react'
import { useUserStore } from '../stores/useUserStore'
import { useAppStore } from '../stores/useAppStore'

type Mode = 'login' | 'register'

export default function Login() {
  const [mode, setMode] = useState<Mode>('login')
  const [identifier, setIdentifier] = useState('')
  const [username, setUsername] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [showQuickLogin, setShowQuickLogin] = useState(false)
  const [quickPassword, setQuickPassword] = useState('')
  const [showQuickPwd, setShowQuickPwd] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const navigate = useNavigate()
  const login = useUserStore(s => s.login)
  const register = useUserStore(s => s.register)

  async function handleLogin(e: FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      await login({ username: identifier, password })
      // 登录成功：重置游客模式并重新加载用户面板（游客模式 isGuestMode 在登录前 initialize 中设置）
      useAppStore.setState({ isGuestMode: false, initialized: false })
      void useAppStore.getState().initialize()
      navigate('/app', { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : '登录失败')
    } finally {
      setLoading(false)
    }
  }

  async function handleRegister(e: FormEvent) {
    e.preventDefault()
    setError('')
    if (password !== confirmPassword) {
      setError('两次输入的密码不一致')
      return
    }
    if (password.length < 6) {
      setError('密码至少 6 个字符')
      return
    }
    setLoading(true)
    try {
      await register(username, email, password)
      useAppStore.setState({ isGuestMode: false, initialized: false })
      void useAppStore.getState().initialize()
      navigate('/app', { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : '注册失败')
    } finally {
      setLoading(false)
    }
  }

  async function handleQuickLogin(e: FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      await login({ password: quickPassword })
      useAppStore.setState({ isGuestMode: false, initialized: false })
      void useAppStore.getState().initialize()
      navigate('/app', { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : '登录失败')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={pageStyle}>
      {/* 装饰性背景光晕 */}
      <div style={glowOrb1} />
      <div style={glowOrb2} />

      <div style={cardStyle}>
        {/* Logo / 标题区 */}
        <div style={headerStyle}>
          <div style={logoIconStyle}>
            <Sparkles size={28} color="var(--color-primary, #4A90E2)" />
          </div>
          <h1 style={titleStyle}>DAILY</h1>
          <p style={subtitleStyle}>你的个人画布 · 自由布局一切</p>
        </div>

        {/* 模式切换 */}
        <div style={tabContainerStyle}>
          <button
            type="button"
            onClick={() => { setMode('login'); setError('') }}
            style={mode === 'login' ? tabActiveStyle : tabInactiveStyle}
          >
            登录
          </button>
          <button
            type="button"
            onClick={() => { setMode('register'); setError('') }}
            style={mode === 'register' ? tabActiveStyle : tabInactiveStyle}
          >
            注册
          </button>
        </div>

        {mode === 'login' ? (
          <form onSubmit={handleLogin} style={formStyle}>
            <div style={inputWrapperStyle}>
              <User size={16} style={inputIconStyle} />
              <input
                type="text"
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                placeholder="用户名或邮箱"
                style={inputWithIconStyle}
                autoFocus
                required
              />
            </div>
            <div style={inputWrapperStyle}>
              <Lock size={16} style={inputIconStyle} />
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="密码"
                style={inputWithIconStyle}
                required
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                style={eyeBtnStyle}
                title={showPassword ? '隐藏密码' : '显示密码'}
              >
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
            {error && <div style={errorStyle}>{error}</div>}
            <button type="submit" disabled={loading} style={primaryBtnStyle}>
              {loading ? <Loader2 size={16} className="animate-spin" /> : <>登录 <ArrowRight size={16} /></>}
            </button>
          </form>
        ) : (
          <form onSubmit={handleRegister} style={formStyle}>
            <div style={inputWrapperStyle}>
              <User size={16} style={inputIconStyle} />
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="用户名（至少 2 个字符）"
                style={inputWithIconStyle}
                autoFocus
                required
              />
            </div>
            <div style={inputWrapperStyle}>
              <Mail size={16} style={inputIconStyle} />
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="邮箱"
                style={inputWithIconStyle}
                required
              />
            </div>
            <div style={inputWrapperStyle}>
              <Lock size={16} style={inputIconStyle} />
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="密码（至少 6 个字符）"
                style={inputWithIconStyle}
                required
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                style={eyeBtnStyle}
              >
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
            <div style={inputWrapperStyle}>
              <Lock size={16} style={inputIconStyle} />
              <input
                type={showPassword ? 'text' : 'password'}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="确认密码"
                style={inputWithIconStyle}
                required
              />
            </div>
            {error && <div style={errorStyle}>{error}</div>}
            <button type="submit" disabled={loading} style={registerBtnStyle}>
              {loading ? <Loader2 size={16} className="animate-spin" /> : <>注册 <ArrowRight size={16} /></>}
            </button>
          </form>
        )}

        {/* 分隔线 */}
        <div style={dividerStyle}>
          <span style={dividerLineStyle} />
          <span style={dividerTextStyle}>或</span>
          <span style={dividerLineStyle} />
        </div>

        {/* 单密码快速登录 */}
        {showQuickLogin ? (
          <form onSubmit={handleQuickLogin} style={formStyle}>
            <div style={inputWrapperStyle}>
              <KeyRound size={16} style={inputIconStyle} />
              <input
                type={showQuickPwd ? 'text' : 'password'}
                value={quickPassword}
                onChange={(e) => setQuickPassword(e.target.value)}
                placeholder="访问密码"
                style={inputWithIconStyle}
                required
              />
              <button
                type="button"
                onClick={() => setShowQuickPwd(!showQuickPwd)}
                style={eyeBtnStyle}
              >
                {showQuickPwd ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
            {error && <div style={errorStyle}>{error}</div>}
            <button type="submit" disabled={loading} style={quickBtnStyle}>
              {loading ? <Loader2 size={16} className="animate-spin" /> : '快速登录'}
            </button>
          </form>
        ) : (
          <button
            type="button"
            onClick={() => { setShowQuickLogin(true); setError('') }}
            style={quickLinkStyle}
          >
            <KeyRound size={14} />
            使用访问密码快速登录
          </button>
        )}
      </div>
    </div>
  )
}

// ============================================
// Styles（使用设计 tokens + 毛玻璃）
// ============================================

const pageStyle: CSSProperties = {
  minHeight: '100vh',
  width: '100%',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: 'linear-gradient(135deg, #f5f5f7 0%, #e8e8f0 50%, #e5e5ea 100%)',
  position: 'relative',
  overflow: 'hidden',
  padding: '20px',
  boxSizing: 'border-box',
}

const glowOrb1: CSSProperties = {
  position: 'absolute',
  width: 400,
  height: 400,
  borderRadius: '50%',
  background: 'radial-gradient(circle, rgba(74,144,226,0.15) 0%, transparent 70%)',
  top: '-100px',
  right: '-100px',
  pointerEvents: 'none',
}

const glowOrb2: CSSProperties = {
  position: 'absolute',
  width: 350,
  height: 350,
  borderRadius: '50%',
  background: 'radial-gradient(circle, rgba(80,227,194,0.12) 0%, transparent 70%)',
  bottom: '-80px',
  left: '-80px',
  pointerEvents: 'none',
}

const cardStyle: CSSProperties = {
  position: 'relative',
  zIndex: 1,
  width: 400,
  maxWidth: '100%',
  padding: 36,
  borderRadius: 'var(--radius-lg, 16px)',
  background: 'rgba(255, 255, 255, 0.72)',
  backdropFilter: 'blur(20px) saturate(180%)',
  WebkitBackdropFilter: 'blur(20px) saturate(180%)',
  border: '1px solid rgba(255, 255, 255, 0.18)',
  boxShadow: 'var(--shadow-lg, 0 8px 28px rgba(0,0,0,0.12), 0 4px 8px rgba(0,0,0,0.08))',
}

const headerStyle: CSSProperties = {
  textAlign: 'center',
  marginBottom: 28,
}

const logoIconStyle: CSSProperties = {
  width: 56,
  height: 56,
  borderRadius: 'var(--radius-lg, 16px)',
  background: 'var(--color-primary-muted, rgba(74,144,226,0.15))',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  marginBottom: 12,
}

const titleStyle: CSSProperties = {
  fontSize: 28,
  fontWeight: 800,
  letterSpacing: '0.12em',
  color: 'var(--text-primary, #1d1d1f)',
  margin: 0,
  background: 'linear-gradient(135deg, var(--color-primary, #4A90E2), var(--color-secondary, #50E3C2))',
  WebkitBackgroundClip: 'text',
  WebkitTextFillColor: 'transparent',
  backgroundClip: 'text',
}

const subtitleStyle: CSSProperties = {
  fontSize: 13,
  color: 'var(--text-secondary, #86868b)',
  margin: '4px 0 0',
}

const tabContainerStyle: CSSProperties = {
  display: 'flex',
  marginBottom: 24,
  borderBottom: '1px solid var(--border-subtle, rgba(0,0,0,0.08))',
}

const tabActiveStyle: CSSProperties = {
  flex: 1,
  padding: '10px 0',
  border: 'none',
  borderBottom: '2px solid var(--color-primary, #4A90E2)',
  background: 'transparent',
  color: 'var(--color-primary, #4A90E2)',
  fontSize: 14,
  fontWeight: 600,
  cursor: 'pointer',
  marginBottom: -1,
}

const tabInactiveStyle: CSSProperties = {
  flex: 1,
  padding: '10px 0',
  border: 'none',
  borderBottom: '2px solid transparent',
  background: 'transparent',
  color: 'var(--text-secondary, #86868b)',
  fontSize: 14,
  fontWeight: 500,
  cursor: 'pointer',
  marginBottom: -1,
}

const formStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 14,
}

const inputWrapperStyle: CSSProperties = {
  position: 'relative',
  display: 'flex',
  alignItems: 'center',
}

const inputIconStyle: CSSProperties = {
  position: 'absolute',
  left: 14,
  color: 'var(--text-tertiary, #adb5bd)',
  pointerEvents: 'none',
}

const inputWithIconStyle: CSSProperties = {
  width: '100%',
  padding: '12px 40px 12px 42px',
  borderRadius: 'var(--radius-md, 12px)',
  border: '1px solid var(--border-default, rgba(0,0,0,0.12))',
  background: 'rgba(255,255,255,0.6)',
  color: 'var(--text-primary, #1d1d1f)',
  fontSize: 14,
  outline: 'none',
  boxSizing: 'border-box',
  transition: 'border-color 0.15s, box-shadow 0.15s',
}

const eyeBtnStyle: CSSProperties = {
  position: 'absolute',
  right: 10,
  border: 'none',
  background: 'transparent',
  color: 'var(--text-tertiary, #adb5bd)',
  cursor: 'pointer',
  padding: 6,
  borderRadius: 6,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
}

const errorStyle: CSSProperties = {
  color: 'var(--color-error, #FF3B30)',
  fontSize: 13,
  padding: '8px 12px',
  borderRadius: 'var(--radius-sm, 8px)',
  background: 'rgba(255,59,48,0.08)',
}

const primaryBtnStyle: CSSProperties = {
  width: '100%',
  padding: '12px 16px',
  borderRadius: 'var(--radius-md, 12px)',
  border: 'none',
  background: 'var(--color-primary, #4A90E2)',
  color: '#fff',
  fontSize: 14,
  fontWeight: 600,
  cursor: 'pointer',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 6,
  boxShadow: '0 4px 12px rgba(74,144,226,0.3)',
  transition: 'background 0.15s, transform 0.1s',
}

const registerBtnStyle: CSSProperties = {
  ...primaryBtnStyle,
  background: 'var(--color-success, #34C759)',
  boxShadow: '0 4px 12px rgba(52,199,89,0.3)',
}

const quickBtnStyle: CSSProperties = {
  width: '100%',
  padding: '10px 16px',
  borderRadius: 'var(--radius-md, 12px)',
  border: '1px solid var(--border-default, rgba(0,0,0,0.12))',
  background: 'rgba(255,255,255,0.5)',
  color: 'var(--text-primary, #1d1d1f)',
  fontSize: 13,
  fontWeight: 500,
  cursor: 'pointer',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 6,
}

const dividerStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  margin: '20px 0',
}

const dividerLineStyle: CSSProperties = {
  flex: 1,
  height: 1,
  background: 'var(--border-subtle, rgba(0,0,0,0.08))',
}

const dividerTextStyle: CSSProperties = {
  fontSize: 11,
  color: 'var(--text-tertiary, #adb5bd)',
  textTransform: 'uppercase',
  letterSpacing: '0.08em',
}

const quickLinkStyle: CSSProperties = {
  width: '100%',
  border: 'none',
  background: 'transparent',
  color: 'var(--text-tertiary, #adb5bd)',
  fontSize: 13,
  cursor: 'pointer',
  padding: '8px 0',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 6,
  transition: 'color 0.15s',
}
