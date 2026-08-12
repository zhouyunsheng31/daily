// ============================================================================
// 弹出层管理设置（spec §3.3 + T6 定时触发 + T7 单次/重复弹出区分）
//
// 三个配置区：
//  1. 基础测试：触发/关闭条件 + 单次开关 + 手动测试弹出
//  2. 定时弹出（T6）：添加/启用/禁用/删除定时弹出配置（popupType + 间隔 + once）
//  3. 单次弹出管理（T7）：查看已显示过的 once key 集合 + 管理员重置
//
// 当前活跃弹出层列表（沿用旧版）。
// ============================================================================

import { useState, type CSSProperties } from 'react'
import { Layers, Plus, Trash2, Clock, RotateCcw, Power } from 'lucide-react'
import {
  usePopupStore,
  type PopupType,
  type CloseCondition,
  type PopupConfig,
} from '../../stores/usePopupStore'

const rowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '10px 0',
  borderBottom: '1px solid var(--border-subtle)',
  gap: 12,
}

const sectionTitleStyle: CSSProperties = {
  marginBottom: 8,
  marginTop: 16,
}

const inputBaseStyle: CSSProperties = {
  padding: '6px 10px',
  borderRadius: 6,
  border: '1px solid var(--border-default, rgba(0,0,0,0.12))',
  background: 'var(--bg-elevated, #f0f0f2)',
  color: 'var(--text-primary, #1d1d1f)',
  fontSize: 13,
  fontFamily: 'inherit',
  outline: 'none',
}

function formatInterval(ms: number): string {
  if (ms < 60_000) return `${Math.round(ms / 1000)} 秒`
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)} 分钟`
  return `${(ms / 3_600_000).toFixed(1)} 小时`
}

function formatTimestamp(ts: number): string {
  if (!ts) return '从未触发'
  try {
    return new Date(ts).toLocaleTimeString()
  } catch {
    return String(ts)
  }
}

export default function PopupManagementConfig() {
  // 现有 popups 操作
  const popups = usePopupStore(s => s.popups)
  const showPopup = usePopupStore(s => s.showPopup)
  const dismissPopup = usePopupStore(s => s.dismissPopup)
  const _forceDismiss = usePopupStore(s => s._forceDismiss)

  // T6: 定时弹出
  const scheduledPopups = usePopupStore(s => s.scheduledPopups)
  const addScheduledPopup = usePopupStore(s => s.addScheduledPopup)
  const removeScheduledPopup = usePopupStore(s => s.removeScheduledPopup)
  const toggleScheduledPopup = usePopupStore(s => s.toggleScheduledPopup)

  // T7: 单次弹出
  const shownOncePopups = usePopupStore(s => s.shownOncePopups)
  const resetShownOncePopups = usePopupStore(s => s.resetShownOncePopups)

  // 基础测试表单
  const [trigger, setTrigger] = useState<'enter' | 'condition' | 'timer' | 'manual'>('enter')
  const [closeOn, setCloseOn] = useState<CloseCondition>('manual')
  const [once, setOnce] = useState(false)
  const [popupKey, setPopupKey] = useState('')

  // 定时弹出新增表单
  const [schedType, setSchedType] = useState<PopupType>('text')
  const [schedTitle, setSchedTitle] = useState('')
  const [schedContent, setSchedContent] = useState('')
  const [schedIntervalSec, setSchedIntervalSec] = useState(60)
  const [schedOnce, setSchedOnce] = useState(false)
  const [schedKey, setSchedKey] = useState('')

  const handleTestPopup = () => {
    const cfg: PopupConfig = {
      popupType: 'text',
      title: '测试弹窗',
      content: '这是一个测试弹出层。',
      closeOn: [closeOn],
      trigger,
      once,
      id: popupKey.trim() || undefined,
    }
    const id = showPopup(cfg)
    if (cfg.once && !id) {
      // 因 once 跳过
      window.alert('该弹出层已显示过（once=true），已跳过。如需重置请在下方"单次弹出管理"点击重置。')
    }
  }

  const handleAddScheduled = () => {
    if (schedIntervalSec < 1) {
      window.alert('间隔必须 ≥ 1 秒')
      return
    }
    const cfg: PopupConfig = {
      popupType: schedType,
      title: schedTitle.trim(),
      content: schedContent,
      closeOn: ['manual'],
      trigger: 'timer',
      once: schedOnce,
      id: schedKey.trim() || undefined,
    }
    addScheduledPopup(cfg, schedIntervalSec * 1000)
    // 清空表单
    setSchedTitle('')
    setSchedContent('')
    setSchedKey('')
    setSchedOnce(false)
  }

  const handleResetShownOnce = () => {
    if (window.confirm('确认重置所有"只显示一次"弹出的记录？重置后所有 once 弹出将可再次显示。')) {
      resetShownOncePopups()
    }
  }

  return (
    <div>
      <div className="settings-section-head">
        <h2 className="settings-section-title">
          <Layers size={14} style={{ display: 'inline', marginRight: 6 }} />
          弹出层管理
        </h2>
      </div>

      {/* ============================================================ */
      /* 1. 基础测试                                                    */
      /* ============================================================ */}
      <div className="settings-section">
        <div className="settings-section-title" style={{ marginBottom: 8 }}>基础测试</div>

        <div style={rowStyle}>
          <div className="settings-label-group">
            <span className="settings-label">触发条件</span>
            <span className="settings-desc">弹窗何时出现</span>
          </div>
          <select
            className="select-field"
            value={trigger}
            onChange={(e) => setTrigger(e.target.value as typeof trigger)}
          >
            <option value="enter">进入时</option>
            <option value="condition">条件触发</option>
            <option value="timer">定时触发</option>
            <option value="manual">手动/AI 调用</option>
          </select>
        </div>

        <div style={rowStyle}>
          <div className="settings-label-group">
            <span className="settings-label">关闭条件</span>
            <span className="settings-desc">弹窗如何关闭</span>
          </div>
          <select
            className="select-field"
            value={closeOn}
            onChange={(e) => setCloseOn(e.target.value as CloseCondition)}
          >
            <option value="login_success">登录成功时</option>
            <option value="manual">手动关闭</option>
            <option value="timer">定时关闭</option>
            <option value="ai_dismiss">AI 关闭</option>
          </select>
        </div>

        {/* T7: 单次弹出开关 */}
        <div style={rowStyle}>
          <div className="settings-label-group">
            <span className="settings-label">只显示一次（once）</span>
            <span className="settings-desc">开启后，相同 id 的弹窗仅显示一次（localStorage 持久化）</span>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input
              type="text"
              placeholder="弹出 id（once 必填）"
              value={popupKey}
              onChange={(e) => setPopupKey(e.target.value)}
              style={{ ...inputBaseStyle, width: 160 }}
            />
            <label className="toggle-switch">
              <input
                type="checkbox"
                checked={once}
                onChange={(e) => setOnce(e.target.checked)}
              />
              <span className="toggle-slider" />
            </label>
          </div>
        </div>

        <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
          <button className="toolbar-btn toolbar-btn--primary" onClick={handleTestPopup}>
            测试弹出
          </button>
          <button className="toolbar-btn" onClick={() => dismissPopup()}>关闭全部</button>
        </div>
      </div>

      {/* ============================================================ */
      /* 2. T6: 定时弹出配置                                            */
      /* ============================================================ */}
      <div className="settings-section">
        <div className="settings-section-title" style={sectionTitleStyle}>
          <Clock size={14} style={{ display: 'inline', marginRight: 6 }} />
          定时弹出（T6）
        </div>
        <div className="settings-desc" style={{ marginBottom: 8 }}>
          调度器每 30 秒检查一次，到达间隔自动触发。配置持久化到 localStorage。
        </div>

        {/* 新增定时弹出表单 */}
        <div style={{
          padding: 12,
          border: '1px solid var(--border-subtle)',
          borderRadius: 8,
          background: 'var(--bg-elevated, #f7f7f9)',
          marginBottom: 12,
        }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
            <select
              value={schedType}
              onChange={(e) => setSchedType(e.target.value as PopupType)}
              style={{ ...inputBaseStyle, flex: '0 0 auto' }}
            >
              <option value="text">文本</option>
              <option value="html">HTML</option>
              <option value="image">图片</option>
              <option value="login">登录</option>
            </select>
            <input
              type="text"
              placeholder="标题"
              value={schedTitle}
              onChange={(e) => setSchedTitle(e.target.value)}
              style={{ ...inputBaseStyle, flex: '1 1 160px' }}
            />
            <input
              type="number"
              min={1}
              placeholder="间隔（秒）"
              value={schedIntervalSec}
              onChange={(e) => setSchedIntervalSec(Number(e.target.value) || 0)}
              style={{ ...inputBaseStyle, flex: '0 0 100px' }}
            />
          </div>
          <textarea
            placeholder="内容（text/html 为文本或 HTML；image 为图片 URL）"
            value={schedContent}
            onChange={(e) => setSchedContent(e.target.value)}
            style={{
              ...inputBaseStyle,
              width: '100%',
              minHeight: 60,
              resize: 'vertical',
              marginBottom: 8,
            }}
          />
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <input
              type="text"
              placeholder="once id（可选，开启 once 时必填）"
              value={schedKey}
              onChange={(e) => setSchedKey(e.target.value)}
              style={{ ...inputBaseStyle, flex: '1 1 200px' }}
            />
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
              <input
                type="checkbox"
                checked={schedOnce}
                onChange={(e) => setSchedOnce(e.target.checked)}
              />
              只显示一次
            </label>
            <button
              className="toolbar-btn toolbar-btn--primary"
              onClick={handleAddScheduled}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
            >
              <Plus size={14} /> 添加
            </button>
          </div>
        </div>

        {/* 已配置列表 */}
        {scheduledPopups.length === 0 ? (
          <div className="settings-desc">暂无定时弹出配置</div>
        ) : (
          scheduledPopups.map(s => (
            <div
              key={s.id}
              style={{
                padding: '8px 12px',
                background: 'var(--bg-hover)',
                borderRadius: 6,
                marginBottom: 4,
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: 8,
                opacity: s.enabled ? 1 : 0.5,
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <span className="settings-label">
                    {s.popupConfig.title || s.popupConfig.popupType}
                  </span>
                  <span className="settings-badge settings-badge--primary">
                    {s.popupConfig.popupType}
                  </span>
                  {s.popupConfig.once && (
                    <span className="settings-badge">once</span>
                  )}
                </div>
                <div className="settings-desc" style={{ marginTop: 2 }}>
                  间隔 {formatInterval(s.intervalMs)} · 上次 {formatTimestamp(s.lastShown)}
                  {s.popupConfig.id ? ` · id=${s.popupConfig.id}` : ''}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                <button
                  className="toolbar-btn toolbar-btn--icon"
                  title={s.enabled ? '禁用' : '启用'}
                  onClick={() => toggleScheduledPopup(s.id, !s.enabled)}
                >
                  <Power size={14} />
                </button>
                <button
                  className="toolbar-btn toolbar-btn--icon toolbar-btn--danger"
                  title="删除"
                  onClick={() => removeScheduledPopup(s.id)}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {/* ============================================================ */
      /* 3. T7: 单次弹出管理                                            */
      /* ============================================================ */}
      <div className="settings-section">
        <div className="settings-section-title" style={sectionTitleStyle}>
          <RotateCcw size={14} style={{ display: 'inline', marginRight: 6 }} />
          单次弹出管理（T7）
        </div>
        <div className="settings-desc" style={{ marginBottom: 8 }}>
          已记录的 once 弹出 id（显示过即加入此集合，阻止重复显示）。共 {shownOncePopups.size} 条。
        </div>
        {shownOncePopups.size === 0 ? (
          <div className="settings-desc">暂无记录</div>
        ) : (
          <div style={{
            padding: 8,
            background: 'var(--bg-elevated, #f7f7f9)',
            borderRadius: 6,
            maxHeight: 160,
            overflow: 'auto',
            marginBottom: 8,
          }}>
            {[...shownOncePopups].map(k => (
              <div key={k} style={{ padding: '4px 8px', fontSize: 12, fontFamily: 'monospace' }}>
                {k}
              </div>
            ))}
          </div>
        )}
        <button
          className="toolbar-btn toolbar-btn--danger"
          onClick={handleResetShownOnce}
          disabled={shownOncePopups.size === 0}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
        >
          <RotateCcw size={14} /> 重置全部记录
        </button>
      </div>

      {/* ============================================================ */
      /* 4. 当前活跃弹出层                                              */
      /* ============================================================ */}
      <div className="settings-section">
        <div className="settings-section-title" style={sectionTitleStyle}>当前活跃弹出层</div>
        {popups.length === 0 ? (
          <div className="settings-desc">暂无活跃弹窗</div>
        ) : (
          popups.map(p => (
            <div
              key={p.id}
              style={{
                padding: '8px 12px',
                background: 'var(--bg-hover)',
                borderRadius: 6,
                marginBottom: 4,
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <div>
                <span className="settings-label">{p.title || p.type}</span>
                <span className="settings-desc" style={{ marginLeft: 8 }}>
                  触发: {p.trigger} · 关闭: {p.closeOn.join(',')}
                  {p.once ? ' · once' : ''}
                </span>
              </div>
              <button
                className="toolbar-btn toolbar-btn--icon toolbar-btn--danger"
                onClick={() => _forceDismiss(p.id)}
              >
                关闭
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
