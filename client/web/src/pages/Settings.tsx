import { useState, lazy, Suspense, type CSSProperties } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Shield, Loader2, Palette, UserCircle, LayoutGrid, PackagePlus,
  Image as ImageIcon, Cloud, KeyRound, Upload, Plus
} from 'lucide-react'
import { useUserStore } from '../stores/useUserStore'
import { useAppStore } from '../stores/useAppStore'
import { useBackgroundStore } from '../stores/useBackgroundStore'

// Phase 7.2: 懒加载设置子组件，减少初始包体积
const AIApiConfig = lazy(() => import('../components/settings/AIApiConfig'))
const AIPromptConfig = lazy(() => import('../components/settings/AIPromptConfig'))
const AISkillsManager = lazy(() => import('../components/settings/AISkillsManager'))
const ToolsManager = lazy(() => import('../components/settings/ToolsManager'))
const AIToolsConfig = lazy(() => import('../components/settings/AIToolsConfig'))
const SearchKeysConfig = lazy(() => import('../components/settings/SearchKeysConfig'))
const AlbumZoomConfig = lazy(() => import('../components/settings/AlbumZoomConfig'))
const CommunityDiscovery = lazy(() => import('../components/settings/CommunityDiscovery'))
// T6+T7：弹出层管理（独立组件，含定时弹出 + 单次/重复区分）
const PopupManagementConfig = lazy(() => import('../components/settings/PopupManagementConfig'))

type Tab =
  | 'api' | 'prompt' | 'skills' | 'tools' | 'ai-tools' | 'search' | 'album' | 'community'
  | 'theme' | 'account' | 'panels' | 'import' | 'background' | 'popup'

function SettingsSuspenseFallback(): React.ReactElement {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 48, color: 'var(--text-tertiary)' }}>
      <Loader2 size={20} className="animate-spin" style={{ marginRight: 8 }} />
      加载中...
    </div>
  )
}

export default function Settings() {
  const [tab, setTab] = useState<Tab>('api')
  const navigate = useNavigate()
  const isAdmin = useUserStore(s => s.user?.role === 'admin')

  return (
    <div className="settings-page">
      <header className="settings-page__header">
        <h1 className="settings-page__title">设置</h1>
        <button
          type="button"
          className="toolbar-btn"
          onClick={() => navigate('/')}
        >
          返回画布
        </button>
      </header>
      <nav className="settings-nav">
        <button onClick={() => setTab('api')} className={tab === 'api' ? 'active' : ''}>AI API 配置</button>
        <button onClick={() => setTab('prompt')} className={tab === 'prompt' ? 'active' : ''}>提示词配置</button>
        <button onClick={() => setTab('skills')} className={tab === 'skills' ? 'active' : ''}>Skills 管理</button>
        <button onClick={() => setTab('tools')} className={tab === 'tools' ? 'active' : ''}>工具管理</button>
        <button onClick={() => setTab('ai-tools')} className={tab === 'ai-tools' ? 'active' : ''}>AI 文件工具</button>
        <button onClick={() => setTab('search')} className={tab === 'search' ? 'active' : ''}>搜索引擎</button>
        <button onClick={() => setTab('album')} className={tab === 'album' ? 'active' : ''}>相册缩放</button>
        <button onClick={() => setTab('community')} className={tab === 'community' ? 'active' : ''}>社区发现</button>
        <button onClick={() => setTab('theme')} className={tab === 'theme' ? 'active' : ''}>主题与显示</button>
        <button onClick={() => setTab('account')} className={tab === 'account' ? 'active' : ''}>用户账号</button>
        <button onClick={() => setTab('panels')} className={tab === 'panels' ? 'active' : ''}>面板管理</button>
        <button onClick={() => setTab('import')} className={tab === 'import' ? 'active' : ''}>组件导入</button>
        <button onClick={() => setTab('background')} className={tab === 'background' ? 'active' : ''}>背景层设置</button>
        <button onClick={() => setTab('popup')} className={tab === 'popup' ? 'active' : ''}>弹出层管理</button>
        {isAdmin && (
          <button
            onClick={() => navigate('/admin')}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
            title="管理员后台"
          >
            <Shield size={14} />
            管理员后台
          </button>
        )}
      </nav>
      <div className="settings-content">
        <Suspense fallback={<SettingsSuspenseFallback />}>
          {tab === 'api' && <AIApiConfig />}
          {tab === 'prompt' && <AIPromptConfig />}
          {tab === 'skills' && <AISkillsManager />}
          {tab === 'tools' && <ToolsManager />}
          {tab === 'ai-tools' && <AIToolsConfig />}
          {tab === 'search' && <SearchKeysConfig />}
          {tab === 'album' && <AlbumZoomConfig />}
          {tab === 'community' && <CommunityDiscovery />}
          {/* T6+T7：弹出层管理（独立懒加载组件） */}
          {tab === 'popup' && <PopupManagementConfig />}
        </Suspense>
        {/* 新增 5 个设置分区（popup 已改为独立懒加载组件，见上） */}
        {tab === 'theme' && <ThemeDisplayConfig />}
        {tab === 'account' && <AccountConfig />}
        {tab === 'panels' && <PanelManagementConfig />}
        {tab === 'import' && <ComponentImportConfig />}
        {tab === 'background' && <BackgroundLayerConfig />}
      </div>
    </div>
  )
}

// ============================================================================
// 主题与显示
// ============================================================================

function ThemeDisplayConfig() {
  const appearance = useAppStore(s => s.settings.appearance)
  const setAppearance = useAppStore(s => s.setAppearance)
  const [theme, setTheme] = useState<'light' | 'dark' | 'auto'>(appearance?.theme ?? 'light')
  const [aiMode, setAiMode] = useState<'orb' | 'taskbar'>(useAppStore.getState().aiMode)
  const setStoreAiMode = useAppStore(s => s.setAiMode)
  const [zoomTrigger, setZoomTrigger] = useState('80')

  const rowStyle: CSSProperties = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px solid var(--border-subtle)' }

  const handleThemeChange = (t: 'light' | 'dark' | 'auto') => {
    setTheme(t)
    if (setAppearance) setAppearance({ ...appearance, theme: t })
  }

  const handleAiModeChange = (m: 'orb' | 'taskbar') => {
    setAiMode(m)
    setStoreAiMode(m)
  }

  return (
    <div>
      <div className="settings-section-head">
        <h2 className="settings-section-title"><Palette size={14} style={{ display: 'inline', marginRight: 6 }} />主题与显示</h2>
      </div>
      <div className="settings-section">
        <div style={rowStyle}>
          <div className="settings-label-group">
            <span className="settings-label">界面主题</span>
            <span className="settings-desc">白色 / 黑色 / 跟随系统</span>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            {(['light', 'dark', 'auto'] as const).map(t => (
              <button key={t} className="toolbar-btn" style={theme === t ? { background: 'var(--color-primary)', color: '#fff', borderColor: 'var(--color-primary)' } : {}} onClick={() => handleThemeChange(t)}>
                {t === 'light' ? '白色' : t === 'dark' ? '黑色' : '自动'}
              </button>
            ))}
          </div>
        </div>
        <div style={rowStyle}>
          <div className="settings-label-group">
            <span className="settings-label">AI 对话方式</span>
            <span className="settings-desc">浮球 / 底部任务栏（互斥）</span>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            {(['orb', 'taskbar'] as const).map(m => (
              <button key={m} className="toolbar-btn" style={aiMode === m ? { background: 'var(--color-primary)', color: '#fff', borderColor: 'var(--color-primary)' } : {}} onClick={() => handleAiModeChange(m)}>
                {m === 'orb' ? '浮球' : '底部任务栏'}
              </button>
            ))}
          </div>
        </div>
        <div style={rowStyle}>
          <div className="settings-label-group">
            <span className="settings-label">缩放档位触发值</span>
            <span className="settings-desc">鼠标悬停顶部多少 px 触发工具栏</span>
          </div>
          <input className="input-field input-field--w260" type="number" value={zoomTrigger} onChange={(e) => setZoomTrigger(e.target.value)} />
        </div>
      </div>
    </div>
  )
}

// ============================================================================
// 用户账号
// ============================================================================

function AccountConfig() {
  const user = useUserStore(s => s.user)
  const isSinglePasswordMode = useUserStore(s => s.isSinglePasswordMode)
  const logout = useUserStore(s => s.logout)
  const navigate = useNavigate()

  const rowStyle: CSSProperties = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px solid var(--border-subtle)' }

  return (
    <div>
      <div className="settings-section-head">
        <h2 className="settings-section-title"><UserCircle size={14} style={{ display: 'inline', marginRight: 6 }} />用户账号</h2>
      </div>
      <div className="settings-section">
        {user ? (
          <>
            <div style={rowStyle}>
              <span className="settings-label">用户名</span>
              <span className="settings-desc">{user.username}</span>
            </div>
            <div style={rowStyle}>
              <span className="settings-label">邮箱</span>
              <span className="settings-desc">{user.email}</span>
            </div>
            <div style={rowStyle}>
              <span className="settings-label">角色</span>
              <span className="settings-badge settings-badge--primary">{user.role}</span>
            </div>
            <div style={{ marginTop: 16 }}>
              <button className="toolbar-btn toolbar-btn--danger" onClick={async () => { await logout(); navigate('/login') }}>退出登录</button>
            </div>
          </>
        ) : isSinglePasswordMode ? (
          <>
            <div className="settings-alert settings-alert--warning" style={{ marginBottom: 12 }}>
              <KeyRound size={16} />
              <span>当前为单密码模式，未绑定用户账号</span>
            </div>
            <div style={rowStyle}>
              <span className="settings-label">登录方式</span>
              <span className="settings-desc">访问密码</span>
            </div>
            <div style={{ marginTop: 16, display: 'flex', gap: 8 }}>
              <button className="toolbar-btn toolbar-btn--primary" onClick={() => navigate('/login')}>登录/注册</button>
              <button className="toolbar-btn" onClick={async () => { await logout(); navigate('/login') }}>退出</button>
            </div>
          </>
        ) : (
          <div className="settings-centered">
            <button className="toolbar-btn toolbar-btn--primary" onClick={() => navigate('/login')}>去登录</button>
          </div>
        )}
      </div>
    </div>
  )
}

// ============================================================================
// 面板管理
// ============================================================================

function PanelManagementConfig() {
  const panels = useAppStore(s => s.panels)
  const activePanelId = useAppStore(s => s.activePanelId)
  const setActivePanel = useAppStore(s => s.setActivePanel)
  const createPanel = useAppStore(s => s.createPanel)

  const rowStyle: CSSProperties = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 12px', borderRadius: 'var(--radius-sm)', cursor: 'pointer', border: '1px solid transparent' }

  return (
    <div>
      <div className="settings-section-head">
        <h2 className="settings-section-title"><LayoutGrid size={14} style={{ display: 'inline', marginRight: 6 }} />面板管理</h2>
        <button className="toolbar-btn toolbar-btn--primary" onClick={() => createPanel({ name: `面板 ${panels.length + 1}` })}>
          <Plus size={14} /> 创建新面板
        </button>
      </div>
      <div className="settings-section">
        <div className="settings-section-title" style={{ marginBottom: 8 }}>个人面板</div>
        {panels.map(p => (
          <div
            key={p.id}
            style={{
              ...rowStyle,
              background: p.id === activePanelId ? 'var(--color-primary-muted)' : 'var(--bg-hover)',
              borderColor: p.id === activePanelId ? 'var(--color-primary)' : 'transparent',
              marginBottom: 4,
            }}
            onClick={() => setActivePanel(p.id)}
          >
            <span className="settings-label">{p.name}</span>
            {p.id === activePanelId && <span className="settings-badge settings-badge--primary">活跃</span>}
          </div>
        ))}
        {panels.length === 0 && <div className="settings-desc">暂无面板</div>}

        <div className="settings-section-title" style={{ marginTop: 16, marginBottom: 8 }}>社区面板</div>
        <div className="settings-desc">社区面板从社区发现页浏览订阅。</div>
      </div>
    </div>
  )
}

// ============================================================================
// 组件导入
// ============================================================================

function ComponentImportConfig() {
  const [pasteCode, setPasteCode] = useState('')

  const dropZoneStyle: CSSProperties = {
    border: '2px dashed var(--border-default)',
    borderRadius: 'var(--radius-md)',
    padding: 32,
    textAlign: 'center',
    color: 'var(--text-tertiary)',
    cursor: 'pointer',
    transition: 'border-color 0.15s, background 0.15s',
    marginBottom: 16,
  }

  return (
    <div>
      <div className="settings-section-head">
        <h2 className="settings-section-title"><PackagePlus size={14} style={{ display: 'inline', marginRight: 6 }} />组件导入</h2>
      </div>
      <div className="settings-section">
        <div className="settings-section-title" style={{ marginBottom: 8 }}>拖拽上传</div>
        <div style={dropZoneStyle} onDragOver={(e) => { e.preventDefault(); e.currentTarget.style.borderColor = 'var(--color-primary)' }} onDragLeave={(e) => { e.currentTarget.style.borderColor = 'var(--border-default)' }} onDrop={(e) => { e.preventDefault(); e.currentTarget.style.borderColor = 'var(--border-default)' }}>
          <Upload size={24} style={{ marginBottom: 8 }} />
          <div>拖拽 .json 组件文件到此处</div>
          <div className="settings-desc" style={{ marginTop: 4 }}>或点击选择文件</div>
        </div>

        <div className="settings-section-title" style={{ marginBottom: 8, marginTop: 16 }}>粘贴代码</div>
        <textarea
          className="settings-textarea settings-textarea--mono"
          placeholder='{"widgetType": "customWidget", "name": "我的组件", ...}'
          value={pasteCode}
          onChange={(e) => setPasteCode(e.target.value)}
          style={{ minHeight: 120 }}
        />
        <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
          <button className="toolbar-btn toolbar-btn--primary" disabled={!pasteCode.trim()}>导入组件</button>
          <button className="toolbar-btn" onClick={() => setPasteCode('')}>清空</button>
        </div>

        <div className="settings-section-title" style={{ marginBottom: 8, marginTop: 16 }}>API 说明</div>
        <div className="settings-desc">
          通过 <code style={{ background: 'var(--bg-elevated)', padding: '2px 6px', borderRadius: 4 }}>POST /api/widgets/import</code> 导入 JSON 格式组件定义。
          组件需包含 widgetType、name、render 字段。
        </div>

        <div className="settings-section-title" style={{ marginBottom: 8, marginTop: 16 }}>已导入组件</div>
        <div className="settings-desc">暂无已导入的自定义组件。</div>
      </div>
    </div>
  )
}

// ============================================================================
// 背景层设置
// ============================================================================

function BackgroundLayerConfig() {
  const bgStore = useBackgroundStore()
  const [bgType, setBgType] = useState(bgStore.backgroundType)
  const [bgColor, setBgColor] = useState(bgStore.color)
  const [bgImage, setBgImage] = useState(bgStore.imageUrl)
  const [effect, setEffect] = useState(bgStore.effect)
  const [showClock, setShowClock] = useState(bgStore.basicComponents.some(c => c.type === 'clock'))

  const rowStyle: CSSProperties = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px solid var(--border-subtle)' }

  const applyBg = (type: 'color' | 'gradient' | 'image', color?: string, imageUrl?: string) => {
    setBgType(type)
    bgStore.setBackground({ type, color, imageUrl })
  }

  const applyEffect = (e: 'none' | 'rain' | 'snow' | 'particles' | 'stars') => {
    setEffect(e)
    if (e === 'none') bgStore.removeEffect()
    else bgStore.addEffect({ effect: e })
  }

  const toggleClock = (on: boolean) => {
    setShowClock(on)
    const existing = bgStore.basicComponents.find(c => c.type === 'clock')
    if (on && !existing) {
      bgStore.placeBasicComponent({ componentType: 'clock', position: { x: 20, y: 20 }, config: { format: 'HH:mm:ss', fontSize: 16, color: 'var(--text-secondary)' } })
    } else if (!on && existing) {
      bgStore.removeBasicComponent(existing.id)
    }
  }

  return (
    <div>
      <div className="settings-section-head">
        <h2 className="settings-section-title"><ImageIcon size={14} style={{ display: 'inline', marginRight: 6 }} />背景层设置</h2>
      </div>
      <div className="settings-section">
        <div className="settings-section-title" style={{ marginBottom: 8 }}>背景类型</div>
        <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
          {(['color', 'gradient', 'image'] as const).map(t => (
            <button key={t} className="toolbar-btn" style={bgType === t ? { background: 'var(--color-primary)', color: '#fff', borderColor: 'var(--color-primary)' } : {}} onClick={() => applyBg(t, bgColor, bgImage)}>
              {t === 'color' ? '纯色' : t === 'gradient' ? '渐变' : '图片'}
            </button>
          ))}
        </div>

        {bgType === 'color' && (
          <div style={rowStyle}>
            <span className="settings-label">背景颜色</span>
            <input type="color" value={bgColor} onChange={(e) => { setBgColor(e.target.value); applyBg('color', e.target.value) }} style={{ width: 60, height: 30, border: '1px solid var(--border-default)', borderRadius: 6 }} />
          </div>
        )}

        {bgType === 'image' && (
          <div style={rowStyle}>
            <span className="settings-label">图片 URL</span>
            <input className="input-field input-field--w260" type="text" value={bgImage} placeholder="https://..." onChange={(e) => setBgImage(e.target.value)} onBlur={() => applyBg('image', undefined, bgImage)} />
          </div>
        )}

        <div className="settings-section-title" style={{ marginBottom: 8, marginTop: 16 }}>视觉特效</div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {(['none', 'rain', 'snow', 'particles', 'stars'] as const).map(e => (
            <button key={e} className="toolbar-btn" style={effect === e ? { background: 'var(--color-primary)', color: '#fff', borderColor: 'var(--color-primary)' } : {}} onClick={() => applyEffect(e)}>
              {e === 'none' ? '无' : e === 'rain' ? '🌧 雨' : e === 'snow' ? '❄️ 雪' : e === 'particles' ? '✨ 粒子' : '⭐ 星空'}
            </button>
          ))}
        </div>

        <div style={rowStyle}>
          <div className="settings-label-group">
            <span className="settings-label">背景时钟</span>
            <span className="settings-desc">在画布左上角显示时钟</span>
          </div>
          <label className="toggle-switch">
            <input type="checkbox" checked={showClock} onChange={(e) => toggleClock(e.target.checked)} />
            <span className="toggle-slider" />
          </label>
        </div>
      </div>
    </div>
  )
}

// 注：PopupManagementConfig 已迁移为独立懒加载组件
// components/settings/PopupManagementConfig.tsx（T6 定时触发 + T7 单次/重复弹出区分）
