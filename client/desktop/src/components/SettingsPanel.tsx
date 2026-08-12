import { useState, useRef } from 'react'
import { useAppStore } from '../stores/useAppStore'
import type { SearchEngine } from '../types'
import { gradientIsLight } from '../utils/color'
import { X, FolderOpen, Bot, Sparkles, Star, Keyboard, Cloud, HardDrive, Zap } from 'lucide-react'
import * as exportApi from '../api/export'
import { withFallback } from '../api/adapter'
import { getDeviceId, getServerToken, setServerToken } from '../utils/deviceAuth'
import AIApiConfig from './settings/AIApiConfig'
import AIPromptConfig from './settings/AIPromptConfig'
import AISkillsManager from './settings/AISkillsManager'
// Phase 12: 搜索引擎 Key 管理（spec 3.16 节）
import SearchEngineConfig from './settings/SearchEngineConfig'
// Phase 7 批次4 任务7：新增三个设置 Tab
import FavoritesManager from './settings/FavoritesManager'
import ShortcutsConfig from './settings/ShortcutsConfig'
import AccessibilityConfig from './settings/AccessibilityConfig'
// Phase 7 批次6 任务5：主页模板选择器
import HomeTemplateSelector from './settings/HomeTemplateSelector'
// Phase 9 批次 3 模块 7：默认运行模式配置（云端/本地/自动）
import { useRuntimeModeStore, getModeLabel, getEffectiveModeLabel, type RuntimeMode } from '../stores/useRuntimeModeStore'
// Phase 9 批次 3 模块 6：默认思考等级配置
import { useThinkingLevelStore } from '../stores/useThinkingLevelStore'
import {
  getThinkingLevelLabel,
  getThinkingLevelDescription,
  getAvailableThinkingLevels,
  type ThinkingLevel,
} from '../utils/thinkingLevel'

interface ThemePreset {
  name: string
  bg: string
  accent: string
  surface: string
  surfaceBorder: string
  text: string
  textMuted: string
}

const THEME_PRESETS: ThemePreset[] = [
  // 亮色主题
  { name: 'Editorial', bg: '#FAF8F5', accent: '#C4463A', surface: '#FFFFFF', surfaceBorder: '#E8E4DD', text: '#2C2A25', textMuted: '#8A8680' },
  { name: 'Linear', bg: '#F8F9FC', accent: '#5E6AD2', surface: '#FFFFFF', surfaceBorder: '#E2E4EA', text: '#1B1B24', textMuted: '#7C7C8A' },
  { name: 'Airbnb', bg: '#F6F5F4', accent: '#FF385C', surface: '#FFFFFF', surfaceBorder: '#DDDDDD', text: '#222222', textMuted: '#717171' },
  { name: 'GitHub', bg: '#F6F8FA', accent: '#1A7F37', surface: '#FFFFFF', surfaceBorder: '#D1D9E0', text: '#1F2328', textMuted: '#656D76' },
  { name: 'Notion', bg: '#FFFFFF', accent: '#2383E2', surface: '#F7F7F5', surfaceBorder: '#E9E9E7', text: '#37352F', textMuted: '#9B9A97' },
  { name: 'Stripe', bg: '#F6F9FC', accent: '#635BFF', surface: '#FFFFFF', surfaceBorder: '#E3E8EE', text: '#1A1F36', textMuted: '#697386' },
  { name: 'Vercel', bg: '#FAFAFA', accent: '#171717', surface: '#FFFFFF', surfaceBorder: '#EAEAEA', text: '#171717', textMuted: '#666666' },
  { name: 'Apple', bg: '#F5F5F7', accent: '#0071E3', surface: '#FFFFFF', surfaceBorder: '#D2D2D7', text: '#1D1D1F', textMuted: '#86868B' },
  { name: 'Sakura', bg: '#FFF5F7', accent: '#E8457C', surface: '#FFFFFF', surfaceBorder: '#F5D5DD', text: '#3D1A24', textMuted: '#A07080' },
  { name: 'Sage', bg: '#F4F7F4', accent: '#4A7C59', surface: '#FFFFFF', surfaceBorder: '#D4DDD6', text: '#1A2E1F', textMuted: '#6B8070' },
  // 暗色主题
  { name: '深空黑', bg: '#09090B', accent: '#3B82F6', surface: '#18181B', surfaceBorder: '#27272A', text: '#E4E4E7', textMuted: '#A1A1AA' },
  { name: '午夜蓝', bg: '#0F172A', accent: '#6366F1', surface: '#1E293B', surfaceBorder: '#334155', text: '#E2E8F0', textMuted: '#94A3B8' },
  { name: '暗紫', bg: '#1A1025', accent: '#A855F7', surface: '#2D1B4E', surfaceBorder: '#3D2B5E', text: '#E8D5F5', textMuted: '#B89CC4' },
  { name: '深海绿', bg: '#0A1A1A', accent: '#14B8A6', surface: '#1A2E2E', surfaceBorder: '#2A3E3E', text: '#CCFBF1', textMuted: '#8BB8B0' },
  { name: '暖橙夜', bg: '#1C1410', accent: '#F97316', surface: '#2D2017', surfaceBorder: '#3D3027', text: '#FED7AA', textMuted: '#B8956A' },
  { name: '玫瑰夜', bg: '#1A0A10', accent: '#F43F5E', surface: '#2D1520', surfaceBorder: '#3D2530', text: '#FECDD3', textMuted: '#B88A90' },
  { name: '极光', bg: '#0C0F1A', accent: '#22D3EE', surface: '#162032', surfaceBorder: '#263042', text: '#CFFAFE', textMuted: '#8AB0B8' },
  { name: '森林', bg: '#0A150A', accent: '#22C55E', surface: '#152815', surfaceBorder: '#253825', text: '#BBF7D0', textMuted: '#8AB898' },
]

const GRADIENT_PRESETS = [
  { name: '晨曦', value: 'linear-gradient(135deg, #FFF1EB, #ACE0F9)' },
  { name: '蜜桃', value: 'linear-gradient(135deg, #FFECD2, #FCB69F)' },
  { name: '薄荷糖', value: 'linear-gradient(135deg, #A8EDea, #FED6E3)' },
  { name: '天际', value: 'linear-gradient(135deg, #667EEA, #764BA2)' },
  { name: '极光绿', value: 'linear-gradient(135deg, #43E97B, #38F9D7)' },
  { name: '日落', value: 'linear-gradient(135deg, #FA709A, #FEE140)' },
  { name: '深海', value: 'linear-gradient(135deg, #0C3547, #1A1A2E, #16213E)' },
  { name: '星空', value: 'linear-gradient(135deg, #0F0C29, #302B63, #24243E)' },
  { name: '暮光', value: 'linear-gradient(135deg, #2C3E50, #4CA1AF)' },
  { name: '火山', value: 'linear-gradient(135deg, #F12711, #F5AF19)' },
  { name: '冰川', value: 'linear-gradient(135deg, #E0EAFC, #CFDEF3)' },
  { name: '薰衣草田', value: 'linear-gradient(135deg, #A18CD1, #FBC2EB)' },
  { name: '极夜', value: 'linear-gradient(135deg, #0D0D2B, #1A1A40, #0D0D2B)' },
  { name: '翡翠', value: 'linear-gradient(135deg, #0F2027, #203A43, #2C5364)' },
]

function ServerConfigSection() {
  const [token, setToken] = useState(getServerToken() || '')
  const [apiBaseUrl] = useState(import.meta.env.VITE_API_BASE_URL || '/api')
  const [wsUrl] = useState(import.meta.env.VITE_WS_URL || '')
  const [saved, setSaved] = useState(false)
  const deviceId = getDeviceId()

  const handleSaveToken = () => {
    setServerToken(token || null)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  return (
    <section className="settings-section">
      <h3 className="settings-section-title">服务器配置</h3>

      <div className="settings-row">
        <div className="settings-label-group">
          <span className="settings-label">设备 ID</span>
          <span className="settings-desc">本设备的唯一标识（只读）</span>
        </div>
        <input className="input-field" style={{ width: 260 }} type="text" value={deviceId} readOnly />
      </div>

      <div className="settings-row">
        <div className="settings-label-group">
          <span className="settings-label">API Base URL</span>
          <span className="settings-desc">通过 .env.local 的 VITE_API_BASE_URL 配置</span>
        </div>
        <input className="input-field" style={{ width: 260 }} type="text" value={apiBaseUrl} readOnly />
      </div>

      <div className="settings-row">
        <div className="settings-label-group">
          <span className="settings-label">WS URL</span>
          <span className="settings-desc">通过 .env.local 的 VITE_WS_URL 配置</span>
        </div>
        <input className="input-field" style={{ width: 260 }} type="text" value={wsUrl} readOnly />
      </div>

      <div className="settings-row">
        <div className="settings-label-group">
          <span className="settings-label">服务器 Token</span>
          <span className="settings-desc">与服务器 SERVER_TOKEN 一致，保存后重新连接 WS 生效</span>
        </div>
        <input
          className="input-field"
          style={{ width: 260 }}
          type="password"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder="输入服务器 token"
        />
      </div>

      <div className="settings-row">
        <button className="toolbar-btn primary" onClick={handleSaveToken}>保存 Token</button>
        {saved && (
          <span style={{ marginLeft: 12, fontSize: 12, color: 'var(--color-secondary)' }}>
            已保存，重新连接 WS 后生效
          </span>
        )}
      </div>
    </section>
  )
}

export default function SettingsPanel() {
  const { settings, updateAppearance, updateBehavior, updateHomeCustomization } = useAppStore()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const imageInputRef = useRef<HTMLInputElement>(null)
  // Phase 4: 主页定制图片上传 refs（spec 5.8 节）
  const browserHomeBgRef = useRef<HTMLInputElement>(null)
  const canvasHomeBgRef = useRef<HTMLInputElement>(null)
  const canvasHomeIconRef = useRef<HTMLInputElement>(null)

  const [activeTab, setActiveTab] = useState('appearance')
  const [customGradient, setCustomGradient] = useState(settings.appearance.backgroundGradient)

  const handleClose = () => {
    useAppStore.setState({ showSettings: false })
  }

  const handleApplyTheme = (theme: ThemePreset) => {
    updateAppearance({
      backgroundColor: theme.bg,
      accentColor: theme.accent,
      surfaceColor: theme.surface,
      surfaceBorderColor: theme.surfaceBorder,
      textColor: theme.text,
      textMutedColor: theme.textMuted,
      backgroundType: 'color',
    })
  }

  const handleApplyGradient = (gradient: string) => {
    setCustomGradient(gradient)
    const light = gradientIsLight(gradient)
    updateAppearance({
      backgroundType: 'gradient',
      backgroundGradient: gradient,
      backgroundColor: light ? '#f5f5f5' : '#0a0a0a',
      textColor: light ? '#1a202c' : '#e4e4e7',
      textMutedColor: light ? '#718096' : '#a1a1aa',
      surfaceColor: light ? 'rgba(255,255,255,0.75)' : 'rgba(20,20,25,0.75)',
      surfaceBorderColor: light ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.06)',
    })
  }

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      const base64 = ev.target?.result as string
      updateAppearance({
        backgroundType: 'image',
        backgroundImage: base64,
      })
    }
    reader.readAsDataURL(file)
  }

  // Phase 4: 主页定制图片上传处理（spec 5.8 节）
  // 浏览器主页背景图上传
  const handleBrowserHomeBgUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      const base64 = ev.target?.result as string
      updateHomeCustomization({ browserHome: { backgroundImage: base64 } })
    }
    reader.readAsDataURL(file)
  }

  // 画布主页背景图上传
  const handleCanvasHomeBgUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      const base64 = ev.target?.result as string
      updateHomeCustomization({ canvasHome: { backgroundImage: base64 } })
    }
    reader.readAsDataURL(file)
  }

  // 画布主页圆形图标上传
  const handleCanvasHomeIconUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      const base64 = ev.target?.result as string
      updateHomeCustomization({ canvasHome: { circleIcon: base64 } })
    }
    reader.readAsDataURL(file)
  }

  const [importReport, setImportReport] = useState<{ show: boolean; report: Record<string, unknown> | null; error: string | null }>({ show: false, report: null, error: null })

  const handleExport = async () => {
    try {
      const { exportV2Data } = await import('../utils/exportImportV2')
      const data = await withFallback(
        () => exportApi.exportAllData(),
        async () => {
          const blob = await exportV2Data()
          return JSON.parse(await blob.text())
        },
      )
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `daily-v2-backup-${new Date().toISOString().slice(0, 10)}.json`
      a.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      alert(`导出失败: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    const confirmed = window.confirm('导入将合并到当前数据中。建议先导出备份。\n\n确定要继续吗？')
    if (!confirmed) return

    try {
      const { importDataV2 } = await import('../utils/exportImportV2')
      const text = await file.text()
      const data = JSON.parse(text)
      const report = await withFallback(
        () => exportApi.importData(data),
        () => importDataV2(file),
      )
      setImportReport({ show: true, report: report as unknown as Record<string, unknown>, error: null })
      setTimeout(() => window.location.reload(), 1500)
    } catch (err) {
      setImportReport({ show: true, report: null, error: err instanceof Error ? err.message : String(err) })
    }
  }

  const isThemeActive = (theme: ThemePreset) =>
    settings.appearance.backgroundColor === theme.bg &&
    settings.appearance.accentColor === theme.accent

  const isGradientActive = (gradient: string) =>
    settings.appearance.backgroundType === 'gradient' &&
    settings.appearance.backgroundGradient === gradient

  // Phase 7 批次4 任务7.4：8 个 Tab，按 spec 6.3 节顺序排列
  // 1.外观 2.行为 3.动效与无障碍(新) 4.收藏管理(新) 5.快捷键(新) 6.数据管理 7.服务器 8.AI 配置
  const tabs = [
    { key: 'appearance', label: '外观', icon: undefined },
    { key: 'behavior', label: '行为', icon: undefined },
    { key: 'accessibility', label: '动效与无障碍', icon: Sparkles },
    { key: 'favorites', label: '收藏管理', icon: Star },
    { key: 'shortcuts', label: '快捷键', icon: Keyboard },
    { key: 'data', label: '数据管理', icon: undefined },
    { key: 'server', label: '服务器', icon: undefined },
    { key: 'ai', label: 'AI 配置', icon: Bot },  // Phase 4: AI 配置 tab（spec 3.1 节，使用 Bot 图标）
    { key: 'search', label: '搜索', icon: undefined },  // Phase 12: 搜索引擎 Key 管理 tab（spec 3.16 节）
  ]

  return (
    <>
      <div className="settings-overlay" onClick={handleClose} />
      <div className="settings-panel">
        <div className="settings-header">
          <h2 className="settings-title">设置</h2>
          <button className="settings-close-btn" onClick={handleClose}><X size={14} /></button>
        </div>

        {/* Phase 7 批次4 任务7.4：pill 形状 Tab 栏，可横向滚动（spec 6.3 节） */}
        <div className="settings-tabs-bar">
          {tabs.map(tab => {
            const TabIcon = tab.icon
            return (
              <button
                key={tab.key}
                className={`settings-tab-pill${activeTab === tab.key ? ' active' : ''}`}
                onClick={() => setActiveTab(tab.key)}
              >
                {TabIcon && <TabIcon size={13} />}
                {tab.label}
              </button>
            )
          })}
        </div>

        <div className="settings-body">
          {activeTab === 'appearance' && (
            <>
              <section className="settings-section">
                <h3 className="settings-section-title">主题预设</h3>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(9, 1fr)', gap: 6, marginTop: 8 }}>
                  {THEME_PRESETS.map(theme => (
                    <div
                      key={theme.name}
                      onClick={() => handleApplyTheme(theme)}
                      title={theme.name}
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        gap: 3,
                        padding: 6,
                        borderRadius: 8,
                        border: isThemeActive(theme) ? '2px solid var(--color-primary)' : '2px solid transparent',
                        cursor: 'pointer',
                        background: 'rgba(128,128,128,0.06)',
                        transition: 'border-color 0.2s',
                      }}
                    >
                      <div style={{
                        width: '100%',
                        aspectRatio: '16/10',
                        borderRadius: 4,
                        background: theme.bg,
                        position: 'relative',
                        overflow: 'hidden',
                      }}>
                        <div style={{ position: 'absolute', top: 3, right: 3, width: 10, height: 6, borderRadius: 2, background: theme.surface }} />
                        <div style={{ position: 'absolute', bottom: 3, left: 3, width: 8, height: 3, borderRadius: 1, background: theme.accent }} />
                      </div>
                      <span style={{ fontSize: 10, opacity: 0.7, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '100%' }}>{theme.name}</span>
                    </div>
                  ))}
                </div>
              </section>

              <section className="settings-section">
                <h3 className="settings-section-title">背景</h3>

                <div className="settings-row">
                  <div className="settings-label-group">
                    <span className="settings-label">背景类型</span>
                  </div>
                  <select
                    className="select-field"
                    value={settings.appearance.backgroundType}
                    onChange={e => updateAppearance({ backgroundType: e.target.value as 'color' | 'gradient' | 'image' })}
                  >
                    <option value="color">纯色</option>
                    <option value="gradient">渐变</option>
                    <option value="image">图片</option>
                  </select>
                </div>

                {settings.appearance.backgroundType === 'color' && (
                  <div className="settings-row">
                    <div className="settings-label-group">
                      <span className="settings-label">背景颜色</span>
                    </div>
                    <div className="color-input-wrapper">
                      <input
                        type="color"
                        className="color-preview"
                        value={settings.appearance.backgroundColor}
                        onChange={e => updateAppearance({ backgroundColor: e.target.value })}
                      />
                    </div>
                  </div>
                )}

                {settings.appearance.backgroundType === 'gradient' && (
                  <>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6, marginTop: 8 }}>
                      {GRADIENT_PRESETS.map(preset => (
                        <div
                          key={preset.name}
                          onClick={() => handleApplyGradient(preset.value)}
                          title={preset.name}
                          style={{
                            display: 'flex',
                            flexDirection: 'column',
                            alignItems: 'center',
                            gap: 3,
                            padding: 5,
                            borderRadius: 8,
                            border: isGradientActive(preset.value) ? '2px solid var(--color-primary)' : '2px solid transparent',
                            cursor: 'pointer',
                            background: 'rgba(128,128,128,0.06)',
                            transition: 'border-color 0.2s',
                          }}
                        >
                          <div style={{
                            width: '100%',
                            aspectRatio: '16/9',
                            borderRadius: 4,
                            background: preset.value,
                          }} />
                          <span style={{ fontSize: 10, opacity: 0.7, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '100%' }}>{preset.name}</span>
                        </div>
                      ))}
                    </div>
                    <div className="settings-row" style={{ marginTop: 12 }}>
                      <div className="settings-label-group">
                        <span className="settings-label">自定义渐变</span>
                        <span className="settings-desc">输入 CSS 渐变值</span>
                      </div>
                      <input
                        className="input-field"
                        style={{ width: 220 }}
                        value={customGradient}
                        placeholder="linear-gradient(135deg, #000, #fff)"
                        onChange={e => setCustomGradient(e.target.value)}
                        onBlur={() => {
                          if (customGradient.trim()) {
                            handleApplyGradient(customGradient.trim())
                          }
                        }}
                      />
                    </div>
                  </>
                )}

                {settings.appearance.backgroundType === 'image' && (
                  <div>
                    <div
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        gap: 8,
                        padding: 16,
                        borderRadius: 8,
                        border: '1px dashed rgba(128,128,128,0.25)',
                        cursor: 'pointer',
                        marginTop: 8,
                      }}
                      onClick={() => imageInputRef.current?.click()}
                    >
                      <span style={{ fontSize: 24, opacity: 0.4 }}><FolderOpen size={24} /></span>
                      <span style={{ fontSize: 13, opacity: 0.6 }}>点击上传背景图片</span>
                      <span style={{ fontSize: 11, opacity: 0.35 }}>支持 JPG / PNG / WebP</span>
                    </div>
                    <input
                      ref={imageInputRef}
                      type="file"
                      accept="image/*"
                      style={{ display: 'none' }}
                      onChange={handleImageUpload}
                    />
                    {settings.appearance.backgroundImage && (
                      <div style={{ position: 'relative', marginTop: 8 }}>
                        <img
                          src={settings.appearance.backgroundImage}
                          alt="背景预览"
                          style={{ width: '100%', maxHeight: 120, objectFit: 'cover', borderRadius: 4 }}
                        />
                        <button
                          onClick={() => updateAppearance({ backgroundImage: '' })}
                          style={{
                            position: 'absolute',
                            top: 4,
                            right: 4,
                            width: 20,
                            height: 20,
                            borderRadius: '50%',
                            border: 'none',
                            background: 'var(--overlay-bg)',
                            color: '#fff',
                            fontSize: 11,
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                          }}
                        ><X size={14} /></button>
                      </div>
                    )}
                  </div>
                )}
              </section>

              {/* Phase 7 批次6 任务5：主页模板选择器（外观 Tab 中） */}
              <section className="settings-section">
                <h3 className="settings-section-title">主页模板</h3>
                <HomeTemplateSelector />
              </section>

              <section className="settings-section">
                <h3 className="settings-section-title">颜色</h3>

                <div className="settings-row">
                  <div className="settings-label-group">
                    <span className="settings-label">强调色</span>
                  </div>
                  <div className="color-input-wrapper">
                    <input type="color" className="color-preview" value={settings.appearance.accentColor} onChange={e => updateAppearance({ accentColor: e.target.value })} />
                  </div>
                </div>

                <div className="settings-row">
                  <div className="settings-label-group">
                    <span className="settings-label">表面颜色</span>
                  </div>
                  <div className="color-input-wrapper">
                    <input type="color" className="color-preview" value={settings.appearance.surfaceColor.startsWith('rgba') ? '#ffffff' : settings.appearance.surfaceColor} onChange={e => updateAppearance({ surfaceColor: e.target.value })} />
                  </div>
                </div>

                <div className="settings-row">
                  <div className="settings-label-group">
                    <span className="settings-label">文字颜色</span>
                  </div>
                  <div className="color-input-wrapper">
                    <input type="color" className="color-preview" value={settings.appearance.textColor} onChange={e => updateAppearance({ textColor: e.target.value })} />
                  </div>
                </div>

                <div className="settings-row">
                  <div className="settings-label-group">
                    <span className="settings-label">表面透明度</span>
                    <span className="settings-desc">{Math.round(settings.appearance.surfaceOpacity * 100)}%</span>
                  </div>
                  <input type="range" min={0} max={1} step={0.05} value={settings.appearance.surfaceOpacity} onChange={e => updateAppearance({ surfaceOpacity: parseFloat(e.target.value) })} style={{ width: 120 }} />
                </div>

                <div className="settings-row">
                  <div className="settings-label-group">
                    <span className="settings-label">表面模糊</span>
                    <span className="settings-desc">{settings.appearance.surfaceBlur}px</span>
                  </div>
                  <input type="range" min={0} max={20} step={1} value={settings.appearance.surfaceBlur} onChange={e => updateAppearance({ surfaceBlur: parseInt(e.target.value) })} style={{ width: 120 }} />
                </div>

                <div className="settings-row">
                  <div className="settings-label-group">
                    <span className="settings-label">字体大小</span>
                    <span className="settings-desc">{settings.appearance.fontSize}px</span>
                  </div>
                  <input type="range" min={12} max={20} step={1} value={settings.appearance.fontSize} onChange={e => updateAppearance({ fontSize: parseInt(e.target.value) })} style={{ width: 120 }} />
                </div>
              </section>

              {/* Phase 4: 主页定制（spec 5.8 节） */}
              <section className="settings-section">
                <h3 className="settings-section-title">主页定制</h3>

                {/* 浏览器主页定制 */}
                <div style={{ padding: '10px 0', borderBottom: '1px solid var(--border-subtle)' }}>
                  <div className="settings-label-group" style={{ marginBottom: 8 }}>
                    <span className="settings-label">浏览器主页</span>
                    <span className="settings-desc">自定义浏览器主页的背景图 / Logo / 主题色</span>
                  </div>

                  {/* 背景图 */}
                  <div className="settings-row">
                    <div className="settings-label-group">
                      <span className="settings-label">背景图</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      {settings.browserHome?.backgroundImage && (
                        <img
                          src={settings.browserHome.backgroundImage}
                          alt="浏览器主页背景"
                          style={{ width: 40, height: 28, objectFit: 'cover', borderRadius: 4, border: 'none' }}
                        />
                      )}
                      <button className="toolbar-btn" onClick={() => browserHomeBgRef.current?.click()} style={{ fontSize: 12 }}>
                        <FolderOpen size={14} />
                      </button>
                      {settings.browserHome?.backgroundImage && (
                        <button
                          className="toolbar-btn"
                          onClick={() => updateHomeCustomization({ browserHome: { backgroundImage: '' } })}
                          style={{ fontSize: 12, padding: '4px 8px' }}
                        >
                          <X size={14} />
                        </button>
                      )}
                      <input ref={browserHomeBgRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleBrowserHomeBgUpload} />
                    </div>
                  </div>

                  {/* Logo */}
                  <div className="settings-row">
                    <div className="settings-label-group">
                      <span className="settings-label">Logo URL</span>
                      <span className="settings-desc">浏览器主页 Logo 图片地址</span>
                    </div>
                    <input
                      className="input-field"
                      style={{ width: 200 }}
                      type="text"
                      value={settings.browserHome?.logo || ''}
                      onChange={(e) => updateHomeCustomization({ browserHome: { logo: e.target.value } })}
                      placeholder="https://example.com/logo.png"
                    />
                  </div>

                  {/* 主题色 */}
                  <div className="settings-row">
                    <div className="settings-label-group">
                      <span className="settings-label">主题色</span>
                    </div>
                    <div className="color-input-wrapper">
                      <input
                        type="color"
                        className="color-preview"
                        value={settings.browserHome?.accentColor || '#3b82f6'}
                        onChange={(e) => updateHomeCustomization({ browserHome: { accentColor: e.target.value } })}
                      />
                    </div>
                  </div>
                </div>

                {/* 画布主页定制 */}
                <div style={{ padding: '10px 0' }}>
                  <div className="settings-label-group" style={{ marginBottom: 8 }}>
                    <span className="settings-label">画布主页</span>
                    <span className="settings-desc">自定义画布主页的背景图 / 圆形图标 / 主题色</span>
                  </div>

                  {/* 背景图 */}
                  <div className="settings-row">
                    <div className="settings-label-group">
                      <span className="settings-label">背景图</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      {settings.canvasHome?.backgroundImage && (
                        <img
                          src={settings.canvasHome.backgroundImage}
                          alt="画布主页背景"
                          style={{ width: 40, height: 28, objectFit: 'cover', borderRadius: 4, border: 'none' }}
                        />
                      )}
                      <button className="toolbar-btn" onClick={() => canvasHomeBgRef.current?.click()} style={{ fontSize: 12 }}>
                        <FolderOpen size={14} />
                      </button>
                      {settings.canvasHome?.backgroundImage && (
                        <button
                          className="toolbar-btn"
                          onClick={() => updateHomeCustomization({ canvasHome: { backgroundImage: '' } })}
                          style={{ fontSize: 12, padding: '4px 8px' }}
                        >
                          <X size={14} />
                        </button>
                      )}
                      <input ref={canvasHomeBgRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleCanvasHomeBgUpload} />
                    </div>
                  </div>

                  {/* 圆形图标 */}
                  <div className="settings-row">
                    <div className="settings-label-group">
                      <span className="settings-label">圆形图标</span>
                      <span className="settings-desc">画布主页中央的圆形图标</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      {settings.canvasHome?.circleIcon && (
                        <img
                          src={settings.canvasHome.circleIcon}
                          alt="画布主页图标"
                          style={{ width: 28, height: 28, objectFit: 'cover', borderRadius: '50%', border: 'none' }}
                        />
                      )}
                      <button className="toolbar-btn" onClick={() => canvasHomeIconRef.current?.click()} style={{ fontSize: 12 }}>
                        <FolderOpen size={14} />
                      </button>
                      {settings.canvasHome?.circleIcon && (
                        <button
                          className="toolbar-btn"
                          onClick={() => updateHomeCustomization({ canvasHome: { circleIcon: '' } })}
                          style={{ fontSize: 12, padding: '4px 8px' }}
                        >
                          <X size={14} />
                        </button>
                      )}
                      <input ref={canvasHomeIconRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleCanvasHomeIconUpload} />
                    </div>
                  </div>

                  {/* 主题色 */}
                  <div className="settings-row">
                    <div className="settings-label-group">
                      <span className="settings-label">主题色</span>
                    </div>
                    <div className="color-input-wrapper">
                      <input
                        type="color"
                        className="color-preview"
                        value={settings.canvasHome?.accentColor || '#3b82f6'}
                        onChange={(e) => updateHomeCustomization({ canvasHome: { accentColor: e.target.value } })}
                      />
                    </div>
                  </div>
                </div>
              </section>
            </>
          )}

          {activeTab === 'behavior' && (
            <section className="settings-section">
              <h3 className="settings-section-title">行为</h3>

              <div className="settings-row">
                <div className="settings-label-group">
                  <span className="settings-label">默认搜索引擎</span>
                  <span className="settings-desc">Omnibox 和浏览器主页搜索时使用</span>
                </div>
                <select
                  className="select-field"
                  value={settings.behavior.searchEngine}
                  onChange={e => updateBehavior({ searchEngine: e.target.value as SearchEngine })}
                >
                  <option value="bing">Bing</option>
                  <option value="google">Google</option>
                  <option value="baidu">百度</option>
                  <option value="duckduckgo">DuckDuckGo</option>
                </select>
              </div>

              <div className="settings-row">
                <div className="settings-label-group">
                  <span className="settings-label">默认布局模式</span>
                </div>
                <select className="select-field" value={settings.behavior.defaultLayoutMode} onChange={e => updateBehavior({ defaultLayoutMode: e.target.value as 'free' | 'grid' })}>
                  <option value="free">自由拖拽</option>
                  <option value="grid">网格对齐</option>
                </select>
              </div>

              {/* Phase 6.1：内存管理设置（spec 第 8 节） */}
              <div className="settings-row" style={{ marginTop: '16px', paddingTop: '12px', borderTop: '1px solid var(--border-subtle)' }}>
                <div className="settings-label-group">
                  <span className="settings-label">内存休眠</span>
                  <span className="settings-desc">非活跃面板自动休眠以释放内存</span>
                </div>
                <label className="toggle-switch">
                  <input type="checkbox" checked={settings.behavior.memoryHibernateEnabled} onChange={e => updateBehavior({ memoryHibernateEnabled: e.target.checked })} />
                  <span className="toggle-slider" />
                </label>
              </div>

              {settings.behavior.memoryHibernateEnabled && (
                <>
                  <div className="settings-row">
                    <div className="settings-label-group">
                      <span className="settings-label">休眠等待时间</span>
                      <span className="settings-desc">面板非活跃多少分钟后自动休眠</span>
                    </div>
                    <select
                      className="select-field"
                      value={settings.behavior.memoryHibernateAfterMin}
                      onChange={e => updateBehavior({ memoryHibernateAfterMin: Number(e.target.value) })}
                    >
                      <option value={1}>1 分钟</option>
                      <option value={3}>3 分钟</option>
                      <option value={5}>5 分钟（推荐）</option>
                      <option value={10}>10 分钟</option>
                      <option value={30}>30 分钟</option>
                    </select>
                  </div>

                  <div className="settings-row">
                    <div className="settings-label-group">
                      <span className="settings-label">休眠内存阈值</span>
                      <span className="settings-desc">内存达到此值时触发休眠（GB）</span>
                    </div>
                    <select
                      className="select-field"
                      value={settings.behavior.memoryHibernateThresholdGB}
                      onChange={e => updateBehavior({ memoryHibernateThresholdGB: Number(e.target.value) })}
                    >
                      <option value={1}>1 GB</option>
                      <option value={1.5}>1.5 GB（推荐）</option>
                      <option value={2}>2 GB</option>
                      <option value={4}>4 GB</option>
                      <option value={8}>8 GB</option>
                    </select>
                  </div>
                </>
              )}

              <div className="settings-row">
                <div className="settings-label-group">
                  <span className="settings-label">删除前确认</span>
                  <span className="settings-desc">删除面板或组件时弹出确认</span>
                </div>
                <label className="toggle-switch">
                  <input type="checkbox" checked={settings.behavior.confirmBeforeDelete} onChange={e => updateBehavior({ confirmBeforeDelete: e.target.checked })} />
                  <span className="toggle-slider" />
                </label>
              </div>

              <div className="settings-row">
                <div className="settings-label-group">
                  <span className="settings-label">组件吸附边缘</span>
                </div>
                <label className="toggle-switch">
                  <input type="checkbox" checked={settings.behavior.widgetSnapToEdge} onChange={e => updateBehavior({ widgetSnapToEdge: e.target.checked })} />
                  <span className="toggle-slider" />
                </label>
              </div>

              {/* Phase 15 批次2 任务2.0：隐私模式开关 */}
              <div className="settings-row">
                <div className="settings-label-group">
                  <span className="settings-label">隐私模式</span>
                  <span className="settings-desc">启用后 webview 使用独立 partition，不共享 cookie/storage</span>
                </div>
                <label className="toggle-switch">
                  <input
                    type="checkbox"
                    checked={settings.behavior.privacyMode}
                    onChange={e => updateBehavior({ privacyMode: e.target.checked })}
                  />
                  <span className="toggle-slider" />
                </label>
              </div>

              {/* Phase 7 批次4 任务7（spec 6.4 节）：标签行为 */}
              <div className="settings-row" style={{ marginTop: '16px', paddingTop: '12px', borderTop: '1px solid var(--border-subtle)' }}>
                <div className="settings-label-group">
                  <span className="settings-label">新建标签默认行为</span>
                  <span className="settings-desc">创建新标签时默认打开的页面</span>
                </div>
                <select
                  className="select-field"
                  value={settings.behavior.newTabDefault}
                  onChange={e => updateBehavior({ newTabDefault: e.target.value as 'home' | 'blank' })}
                >
                  <option value="home">主页</option>
                  <option value="blank">空白页</option>
                </select>
              </div>

              <div className="settings-row">
                <div className="settings-label-group">
                  <span className="settings-label">关闭标签后跳转</span>
                  <span className="settings-desc">关闭当前标签后自动激活哪个标签</span>
                </div>
                <select
                  className="select-field"
                  value={settings.behavior.closeTabJumpStrategy}
                  onChange={e => updateBehavior({ closeTabJumpStrategy: e.target.value as 'prev' | 'next' | 'none' })}
                >
                  <option value="prev">上一个标签</option>
                  <option value="next">下一个标签</option>
                  <option value="none">不自动跳转</option>
                </select>
              </div>
            </section>
          )}

          {/* Phase 7 批次4 任务7.3：动效与无障碍 Tab（spec 6.2.3 节） */}
          {activeTab === 'accessibility' && <AccessibilityConfig />}

          {/* Phase 7 批次4 任务7.1：收藏管理 Tab（spec 6.2.1 节） */}
          {activeTab === 'favorites' && <FavoritesManager />}

          {/* Phase 7 批次4 任务7.2：快捷键 Tab（spec 6.2.2 节） */}
          {activeTab === 'shortcuts' && <ShortcutsConfig />}

          {activeTab === 'data' && (
            <section className="settings-section">
              <h3 className="settings-section-title">数据管理</h3>

              <div className="settings-row">
                <div className="settings-label-group">
                  <span className="settings-label">导出数据</span>
                  <span className="settings-desc">下载 JSON 备份文件（含版本校验和字段白名单）</span>
                </div>
                <button className="toolbar-btn" onClick={handleExport}>导出</button>
              </div>

              <div className="settings-row">
                <div className="settings-label-group">
                  <span className="settings-label">导入数据</span>
                  <span className="settings-desc">从 JSON 文件恢复（导入前会提示备份）</span>
                </div>
                <button className="toolbar-btn" onClick={() => fileInputRef.current?.click()}>导入</button>
                <input ref={fileInputRef} type="file" accept=".json" style={{ display: 'none' }} onChange={handleImport} />
              </div>

              {importReport.show && (
                <div style={{
                  marginTop: 12,
                  padding: 12,
                  borderRadius: 8,
                  background: importReport.error ? 'rgba(255,59,48,0.1)' : 'rgba(80,227,194,0.1)',
                  border: `1px solid ${importReport.error ? 'rgba(255,59,48,0.2)' : 'rgba(80,227,194,0.2)'}`,
                  fontSize: 12,
                }}>
                  {importReport.error ? (
                    <div style={{ color: 'var(--color-error)' }}>
                      <strong>导入失败</strong>
                      <div style={{ marginTop: 4 }}>{importReport.error}</div>
                    </div>
                  ) : (
                    <div style={{ color: 'var(--color-secondary)' }}>
                      <strong>导入成功，页面即将刷新</strong>
                      <pre style={{ marginTop: 4, fontSize: 11, color: 'var(--text-secondary)', whiteSpace: 'pre-wrap' }}>
                        {JSON.stringify(importReport.report, null, 2)}
                      </pre>
                    </div>
                  )}
                </div>
              )}
            </section>
          )}

          {activeTab === 'server' && <ServerConfigSection />}

          {/* Phase 4: AI 配置 tab（spec 3.1 节）—— 默认思考等级 + 默认运行模式 + 3 个子区域：API 配置 / 提示词配置 / Skills 管理 */}
          {activeTab === 'ai' && (
            <>
              {/* Phase 9 批次 3 模块 6：默认思考等级配置 */}
              <DefaultThinkingLevelSection />
              {/* Phase 9 批次 3 模块 7：默认运行模式配置（云端/本地/自动） */}
              <DefaultRuntimeModeSection />
              <AIApiConfig />
              <AIPromptConfig />
              <AISkillsManager />
            </>
          )}

          {/* Phase 12: 搜索引擎 Key 管理 tab（spec 3.16 节） */}
          {activeTab === 'search' && <SearchEngineConfig />}
        </div>

        <div className="settings-footer">
          <button className="toolbar-btn primary" onClick={handleClose}>完成</button>
        </div>
      </div>
    </>
  )
}

// ============================================================================
// Phase 9 批次 3 模块 6：默认思考等级配置子组件
// ============================================================================

/**
 * 默认思考等级配置（Phase 9 批次 3 模块 6）
 *
 * 在 SettingsPanel → AI 配置 Tab 中渲染，让用户配置"默认思考等级"。
 *
 * 设计：
 * - 4 档下拉（极简/低/中/高），与 useThinkingLevelStore.defaultLevel 双向绑定
 * - 选中后调用 useThinkingLevelStore.setDefaultLevel(level)（同步 localStorage 持久化）
 * - 描述行随选中等级动态变化（显示当前等级的详细说明）
 *
 * 与 AIAssistantSidebar 思考等级按钮的关系：
 * - sidebar 按钮：切换当前会话的思考等级（currentLevel），立即生效
 * - 此处配置：切换默认思考等级（defaultLevel），应用于新创建的 AI 会话
 */
function DefaultThinkingLevelSection() {
  const defaultLevel = useThinkingLevelStore(s => s.defaultLevel)
  const setDefaultLevel = useThinkingLevelStore(s => s.setDefaultLevel)

  return (
    <section className="settings-section">
      <h3 className="settings-section-title">默认思考等级</h3>

      <div className="settings-row">
        <div className="settings-label-group">
          <span className="settings-label">默认思考等级</span>
          <span className="settings-desc">
            {getThinkingLevelDescription(defaultLevel)}。新创建的 AI 会话将使用此等级；当前会话可在 AI 助手 sidebar 中实时切换。
          </span>
        </div>
        <select
          className="select-field"
          value={defaultLevel}
          onChange={(e) => setDefaultLevel(e.target.value as ThinkingLevel)}
        >
          {getAvailableThinkingLevels().map(level => (
            <option key={level} value={level}>
              {getThinkingLevelLabel(level)}
            </option>
          ))}
        </select>
      </div>
    </section>
  )
}

// ============================================================================
// Phase 9 批次 3 模块 7：默认运行模式配置子组件
// ============================================================================

/**
 * 默认运行模式配置（Phase 9 批次 3 模块 7）
 *
 * 在 SettingsPanel → AI 配置 Tab 中渲染，让用户配置"默认运行模式"。
 *
 * 设计：
 * - 3 选项（云端/本地/自动），与 useRuntimeModeStore.mode 双向绑定
 * - 选中后调用 useRuntimeModeStore.setMode(mode)（同步 localStorage 持久化）
 * - 描述行随选中模式动态变化（显示当前模式 + 实际生效模式）
 *
 * 与 AIAssistantSidebar Agent 切换按钮的关系：
 * - sidebar 按钮：切换当前会话的运行模式（mode），立即生效
 * - 此处配置：与 sidebar 按钮等价（直接修改当前 mode，因为只有 3 个选项不需要单独的"默认"概念）
 *
 * 与移动端对齐（RuntimeModeManager.kt：3 mode + label "云端"/"本地"/"自动"）
 */
function DefaultRuntimeModeSection() {
  const mode = useRuntimeModeStore(s => s.mode)
  const effectiveMode = useRuntimeModeStore(s => s.effectiveMode)
  const isServerOnline = useRuntimeModeStore(s => s.isServerOnline)
  const isOfflineDowngraded = useRuntimeModeStore(s => s.isOfflineDowngraded)
  const setMode = useRuntimeModeStore(s => s.setMode)

  // 各模式对应的图标（与 AIAssistantSidebar AgentModeSwitcher 保持一致）
  const modeIcons: Record<RuntimeMode, typeof Cloud> = {
    cloud: Cloud,
    local: HardDrive,
    auto: Zap,
  }

  // 描述文案：根据当前 mode + isServerOnline 动态变化
  const descriptionText = (() => {
    if (mode === 'cloud') {
      return '所有 AI 请求走服务器 Pi Agent（云端）。需要服务器在线。'
    }
    if (mode === 'local') {
      return '所有 AI 请求走本地轻 Agent（调用户自配 API Key）。无需服务器。'
    }
    // auto
    if (isServerOnline) {
      return `自动模式：当前在线，使用云端。离线时自动切换到本地。`
    }
    return `自动模式：当前离线，已降级到本地。服务器恢复后自动切回云端。`
  })()

  return (
    <section className="settings-section">
      <h3 className="settings-section-title">默认运行模式</h3>

      <div className="settings-row">
        <div className="settings-label-group">
          <span className="settings-label">运行模式</span>
          <span className="settings-desc">{descriptionText}</span>
        </div>
        <select
          className="select-field"
          value={mode}
          onChange={(e) => setMode(e.target.value as RuntimeMode)}
        >
          <option value="cloud">☁️ 云端（服务器 Pi Agent）</option>
          <option value="local">💻 本地（轻 Agent，调 API Key）</option>
          <option value="auto">⚡ 自动（在线用云端，离线切本地）</option>
        </select>
      </div>

      {/* 当前生效模式提示行 */}
      <div className="settings-row" style={{ marginTop: 8 }}>
        <div className="settings-label-group">
          <span className="settings-label">当前生效</span>
          <span className="settings-desc">
            实际生效模式：{getEffectiveModeLabel(effectiveMode)}
            {isOfflineDowngraded && '（已离线降级）'}
            <br />
            服务器状态：{isServerOnline ? '✅ 在线' : '❌ 离线'}
          </span>
        </div>
        {(() => {
          const ModeIcon = modeIcons[mode]
          return (
            <span style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              padding: '4px 10px',
              background: isOfflineDowngraded ? 'rgba(245, 158, 11, 0.12)' : 'rgba(0,0,0,0.04)',
              borderRadius: 9999,
              fontSize: 11,
              color: isOfflineDowngraded ? '#b45309' : 'var(--text-secondary)',
              border: `1px solid ${isOfflineDowngraded ? 'rgba(245, 158, 11, 0.4)' : 'transparent'}`,
            }}>
              <ModeIcon size={12} />
              {getModeLabel(mode)}
              {mode === 'auto' && (
                <span style={{ fontSize: 10, opacity: 0.7 }}>
                  ({getEffectiveModeLabel(effectiveMode)})
                </span>
              )}
            </span>
          )
        })()}
      </div>
    </section>
  )
}
