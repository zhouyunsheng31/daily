// ============================================================================
// TopRightEntry.tsx — 全局右上角入口（垂直按钮组：用户/登录 + 面板切换）
//
// 设计依据：用户需求"右上角一个用户主页/登录的按钮，下方提供其他按钮"。
// 之前 AI 对话里的面板切换按钮已移除，面板切换功能移到右上角。
//
// 结构（垂直按钮组，fixed 定位右上角）：
// - 顶部：用户/登录入口
//   - 未登录：显示"登录"按钮 → 触发 LoginPopup
//   - 已登录：显示头像/用户名 + 下拉菜单（进入画布/设置/管理后台/登出）
// - 下方：面板切换按钮（仅登录且非游客模式显示）
//   - 点击展开下拉面板列表（社区面板分组 + 个人面板分组）
//   - 底部"新建个人面板"入口；admin 显示"新建社区面板"入口
//   - 点击面板项切换 activePanel + navigate
//
// 游客模式（isGuestMode）：面板切换按钮不显示（游客只有展示面板，不能切换）。
//
// 渲染策略：
// - fixed 定位，z-index 高于画布元素
// - 在 Login（/login）和 Migration（/migration）路由下不渲染
//   （Login 页本身不需要登录入口；Migration 是迁移流程）
// - 其他路由（含 / 、/app、/panel/:id、/settings、/admin 等）均渲染
// ============================================================================

import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { LogIn, LogOut, Settings as SettingsIcon, LayoutDashboard, ChevronDown, Shield, LayoutGrid, Plus, Users, Upload } from 'lucide-react'
import { useUserStore } from '../stores/useUserStore'
import { usePopupStore } from '../stores/usePopupStore'
import { useAppStore } from '../stores/useAppStore'
import { UploadDialog } from './UploadWidget'

export default function TopRightEntry() {
  const location = useLocation()
  const navigate = useNavigate()
  const user = useUserStore(s => s.user)
  const isAuthenticated = useUserStore(s => s.isAuthenticated)
  const isSinglePasswordMode = useUserStore(s => s.isSinglePasswordMode)
  const logout = useUserStore(s => s.logout)
  const showPopup = usePopupStore(s => s.showPopup)
  const popups = usePopupStore(s => s.popups)

  // 面板切换相关
  const panels = useAppStore(s => s.panels)
  const activePanelId = useAppStore(s => s.activePanelId)
  const isGuestMode = useAppStore(s => s.isGuestMode)
  const setActivePanel = useAppStore(s => s.setActivePanel)
  const addPanel = useAppStore(s => s.addPanel)
  const deletePanel = useAppStore(s => s.deletePanel)

  const [menuOpen, setMenuOpen] = useState(false)
  const [panelOpen, setPanelOpen] = useState(false)
  const [uploadOpen, setUploadOpen] = useState(false)
  const wrapperRef = useRef<HTMLDivElement>(null)

  // 点击外部关闭所有下拉
  useEffect(() => {
    if (!menuOpen && !panelOpen) return
    const handler = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setMenuOpen(false)
        setPanelOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [menuOpen, panelOpen])

  // 路由切换时关闭所有下拉
  useEffect(() => {
    setMenuOpen(false)
    setPanelOpen(false)
    setUploadOpen(false)
  }, [location.pathname])

  // 仅在 /login 和 /migration 下不渲染
  const path = location.pathname
  if (path === '/login' || path === '/migration') {
    return null
  }

  const isAdmin = user?.role === 'admin'
  // 面板切换按钮仅在登录且非游客模式显示
  const showPanelSwitch = isAuthenticated && !isGuestMode

  // 触发登录弹窗（复用现有 LoginPopup 机制）
  const handleLoginClick = () => {
    if (popups.some(p => p.type === 'login')) return
    showPopup({
      popupType: 'login',
      title: '登录到 Daily',
      closeOn: ['login_success', 'manual'],
      trigger: 'manual',
    })
  }

  const handleLogout = async () => {
    setMenuOpen(false)
    try {
      await logout()
      navigate('/')
    } catch (err) {
      console.error('[TopRightEntry] logout failed:', err)
    }
  }

  const handleNavigate = (target: string) => {
    setMenuOpen(false)
    navigate(target)
  }

  // ===== 面板切换处理（复用 Workspace.tsx PanelSwitcher 逻辑）=====
  const handlePanelSwitch = async (panelId: string) => {
    await setActivePanel(panelId)
    navigate(`/panel/${panelId}`)
    setPanelOpen(false)
  }

  const handleNewPersonal = async () => {
    const id = await addPanel('新面板')
    navigate(`/panel/${id}`)
    setPanelOpen(false)
  }

  const handleNewCommunity = async () => {
    if (!isAdmin) return
    setPanelOpen(false)
    // spec §8.2 + §9.4：创建社区面板时弹出连接窗口，不直接建空白面板
    usePopupStore.getState().showPopup({
      popupType: 'community_connect',
      trigger: 'manual',
      closeOn: ['manual'],
      onClose: async (result) => {
        const r = result as { skipped?: boolean; connected?: boolean; apiUrl?: string; communityName?: string } | undefined
        if (r?.skipped) {
          const id = await addPanel('新社区面板', { isCommunity: true })
          navigate(`/panel/${id}`)
        } else if (r?.connected) {
          const id = await addPanel(r.communityName || '新社区面板', {
            isCommunity: true,
            communityApiUrl: r.apiUrl ?? null,
          })
          navigate(`/panel/${id}`)
        }
        // result === undefined 表示用户点 X 放弃，不创建面板
      },
    })
  }

  const handlePanelDelete = async (e: React.MouseEvent, panelId: string) => {
    e.stopPropagation()
    if (!confirm('确认删除该面板？')) return
    await deletePanel(panelId)
    const remaining = useAppStore.getState().panels
    if (remaining.length > 0) {
      navigate(`/panel/${remaining[0].id}`)
    } else {
      navigate('/app')
    }
    setPanelOpen(false)
  }

  // 分组：社区面板 vs 个人面板
  const communityPanels = panels.filter(p => p.isCommunity)
  const personalPanels = panels.filter(p => !p.isCommunity)

  // 未登录：仅显示"登录"按钮（游客模式下也只有登录按钮，无面板切换）
  if (!isAuthenticated) {
    return (
      <div style={wrapperStyle}>
        <button onClick={handleLoginClick} style={loginBtnStyle} className="top-right-login-btn">
          <LogIn size={15} />
          <span>登录</span>
        </button>
      </div>
    )
  }

  // 已登录：垂直按钮组
  const displayName = isSinglePasswordMode
    ? '已登录'
    : (user?.username || user?.email || '用户')
  const initial = isSinglePasswordMode
    ? '✓'
    : (displayName.charAt(0).toUpperCase())

  return (
    <>
    <div ref={wrapperRef} style={wrapperStyle}>
      {/* 顶部：用户头像 + 下拉菜单 */}
      <div style={slotStyle}>
        <button
          onClick={() => { setMenuOpen(v => !v); setPanelOpen(false) }}
          style={avatarBtnStyle}
          className="top-right-avatar-btn"
          aria-label="用户菜单"
          aria-expanded={menuOpen}
        >
          <div style={avatarStyle}>{initial}</div>
          <span style={userNameStyle}>{displayName}</span>
          <ChevronDown
            size={14}
            style={{
              transition: 'transform 0.15s ease',
              transform: menuOpen ? 'rotate(180deg)' : 'none',
              color: 'var(--text-tertiary, #adb5bd)',
            }}
          />
        </button>

        {menuOpen && (
          <div style={dropdownStyle} className="top-right-dropdown">
            <div style={dropdownHeaderStyle}>
              <div style={avatarStyleLarge}>{initial}</div>
              <div style={dropdownUserInfoStyle}>
                <div style={dropdownUserNameStyle}>{displayName}</div>
                {user?.email && <div style={dropdownUserEmailStyle}>{user.email}</div>}
                {isAdmin && (
                  <div style={adminBadgeStyle}>
                    <Shield size={10} /> 管理员
                  </div>
                )}
              </div>
            </div>

            <div style={dividerStyle} />

            <button style={menuItemStyle} onClick={() => handleNavigate('/app')} className="top-right-menu-item">
              <LayoutDashboard size={15} />
              <span>进入画布</span>
            </button>

            <button style={menuItemStyle} onClick={() => handleNavigate('/settings')} className="top-right-menu-item">
              <SettingsIcon size={15} />
              <span>设置</span>
            </button>

            {isAdmin && (
              <button style={menuItemStyle} onClick={() => handleNavigate('/admin')} className="top-right-menu-item">
                <Shield size={15} />
                <span>管理后台</span>
              </button>
            )}

            <div style={dividerStyle} />

            <button
              style={{ ...menuItemStyle, color: 'var(--color-error, #FF3B30)' }}
              onClick={handleLogout}
              className="top-right-menu-item top-right-menu-item--danger"
            >
              <LogOut size={15} />
              <span>登出</span>
            </button>
          </div>
        )}
      </div>

      {/* 下方：面板切换按钮（仅登录且非游客模式显示） */}
      {showPanelSwitch && (
        <div style={slotStyle}>
          <button
            onClick={() => { setPanelOpen(v => !v); setMenuOpen(false) }}
            style={panelBtnStyle(panelOpen)}
            className="top-right-panel-btn"
            aria-label="切换面板"
            aria-expanded={panelOpen}
          >
            <LayoutGrid size={17} />
          </button>

          {panelOpen && (
            <div style={panelDropdownStyle} className="top-right-panel-dropdown">
              {/* 社区面板分组 */}
              {communityPanels.length > 0 && (
                <>
                  <div style={sectionHeaderStyle}>
                    <Users size={11} />
                    <span>社区面板</span>
                  </div>
                  {communityPanels.map(p => (
                    <PanelItem
                      key={p.id}
                      panel={p}
                      active={p.id === activePanelId}
                      onSwitch={handlePanelSwitch}
                      onDelete={handlePanelDelete}
                    />
                  ))}
                </>
              )}

              {/* 个人面板分组 */}
              <div style={{ ...sectionHeaderStyle, borderTop: communityPanels.length > 0 ? '1px solid var(--border-subtle, rgba(0,0,0,0.08))' : 'none' }}>
                <LayoutGrid size={11} />
                <span>个人面板</span>
              </div>
              {personalPanels.length === 0 ? (
                <div style={emptyHintStyle}>暂无个人面板</div>
              ) : (
                personalPanels.map(p => (
                  <PanelItem
                    key={p.id}
                    panel={p}
                    active={p.id === activePanelId}
                    onSwitch={handlePanelSwitch}
                    onDelete={handlePanelDelete}
                  />
                ))
              )}

              {/* 新建入口 */}
              <div style={panelDropdownFooterStyle}>
                <button
                  style={newPanelBtnStyle}
                  onClick={handleNewPersonal}
                  className="top-right-new-personal"
                >
                  <Plus size={14} />
                  <span>新建个人面板</span>
                </button>
                {isAdmin && (
                  <button
                    style={{ ...newPanelBtnStyle, color: 'var(--color-primary, #4A90E2)' }}
                    onClick={handleNewCommunity}
                    className="top-right-new-community"
                    title="仅管理员可创建社区面板"
                  >
                    <Plus size={14} />
                    <span>新建社区面板</span>
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* 上传自定义组件按钮（仅登录且非游客模式显示，与面板切换按钮同条件） */}
      {showPanelSwitch && (
        <div style={slotStyle}>
          <button
            onClick={() => { setUploadOpen(true); setMenuOpen(false); setPanelOpen(false) }}
            style={panelBtnStyle(false)}
            className="top-right-upload-btn"
            aria-label="上传自定义组件"
            title="上传自定义组件"
          >
            <Upload size={17} />
          </button>
        </div>
      )}
    </div>

    {/* 上传组件弹窗（渲染在 wrapper 之外，避免被 wrapperRef 的 z-index:9998 堆叠上下文裁剪） */}
    {uploadOpen && <UploadDialog onClose={() => setUploadOpen(false)} />}
    </>
  )
}

// ============================================
// PanelItem — 面板列表项子组件
// ============================================
function PanelItem({ panel, active, onSwitch, onDelete }: {
  panel: { id: string; name: string; isCommunity?: boolean }
  active: boolean
  onSwitch: (id: string) => void
  onDelete: (e: React.MouseEvent, id: string) => void
}) {
  return (
    <div
      onClick={() => onSwitch(panel.id)}
      style={{
        ...panelItemStyle,
        background: active ? 'var(--bg-elevated, rgba(74,144,226,0.10))' : 'transparent',
        color: active ? 'var(--color-primary, #4A90E2)' : 'var(--text-primary, #1d1d1f)',
        fontWeight: active ? 600 : 500,
      }}
      onMouseEnter={(e) => {
        if (!active) e.currentTarget.style.background = 'var(--bg-elevated, rgba(0,0,0,0.04))'
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = active ? 'var(--bg-elevated, rgba(74,144,226,0.10))' : 'transparent'
      }}
    >
      <span style={panelItemNameStyle}>{panel.name}</span>
      <button
        onClick={(e) => onDelete(e, panel.id)}
        style={panelDeleteBtnStyle}
        title="删除面板"
        aria-label="删除面板"
      >
        ×
      </button>
    </div>
  )
}

// ============================================
// Styles
// ============================================

const wrapperStyle: CSSProperties = {
  position: 'fixed',
  top: 16,
  right: 20,
  zIndex: 9998,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'flex-end',
  gap: 8,
}

const slotStyle: CSSProperties = {
  position: 'relative',
  display: 'flex',
  alignItems: 'center',
}

const loginBtnStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  padding: '8px 18px',
  borderRadius: 'var(--radius-full, 9999px)',
  border: '1px solid var(--color-primary, #4A90E2)',
  background: 'var(--color-primary, #4A90E2)',
  color: '#fff',
  fontSize: 13,
  fontWeight: 600,
  cursor: 'pointer',
  boxShadow: '0 4px 12px rgba(74,144,226,0.3)',
  transition: 'transform 0.1s ease, box-shadow 0.15s ease, background 0.15s ease',
}

const avatarBtnStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 8,
  padding: '6px 10px 6px 6px',
  borderRadius: 'var(--radius-full, 9999px)',
  border: '1px solid var(--border-default, rgba(0,0,0,0.12))',
  background: 'rgba(255,255,255,0.72)',
  backdropFilter: 'blur(16px) saturate(180%)',
  WebkitBackdropFilter: 'blur(16px) saturate(180%)',
  cursor: 'pointer',
  color: 'var(--text-primary, #1d1d1f)',
  fontSize: 13,
  fontWeight: 600,
  transition: 'border-color 0.15s ease, box-shadow 0.15s ease',
}

const avatarStyle: CSSProperties = {
  width: 28,
  height: 28,
  borderRadius: '50%',
  background: 'linear-gradient(135deg, var(--color-primary, #4A90E2), var(--color-secondary, #50E3C2))',
  color: '#fff',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: 13,
  fontWeight: 700,
  flexShrink: 0,
}

const avatarStyleLarge: CSSProperties = {
  ...avatarStyle,
  width: 40,
  height: 40,
  fontSize: 17,
}

const userNameStyle: CSSProperties = {
  maxWidth: 120,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
}

const dropdownStyle: CSSProperties = {
  position: 'absolute',
  top: 'calc(100% + 8px)',
  right: 0,
  minWidth: 240,
  background: 'rgba(255,255,255,0.85)',
  backdropFilter: 'blur(20px) saturate(180%)',
  WebkitBackdropFilter: 'blur(20px) saturate(180%)',
  border: '1px solid var(--border-default, rgba(0,0,0,0.12))',
  borderRadius: 'var(--radius-md, 12px)',
  boxShadow: '0 12px 32px rgba(0,0,0,0.16), 0 4px 8px rgba(0,0,0,0.08)',
  padding: 6,
  animation: 'menuIn 0.15s ease-out',
  overflow: 'hidden',
}

const dropdownHeaderStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  padding: '10px 10px 12px',
}

const dropdownUserInfoStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
  minWidth: 0,
  flex: 1,
}

const dropdownUserNameStyle: CSSProperties = {
  fontSize: 14,
  fontWeight: 700,
  color: 'var(--text-primary, #1d1d1f)',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
}

const dropdownUserEmailStyle: CSSProperties = {
  fontSize: 11,
  color: 'var(--text-tertiary, #adb5bd)',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
}

const adminBadgeStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 3,
  alignSelf: 'flex-start',
  marginTop: 4,
  padding: '1px 6px',
  borderRadius: 'var(--radius-full, 9999px)',
  background: 'rgba(255,149,0,0.12)',
  color: 'var(--color-warning, #FF9500)',
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: '0.04em',
}

const dividerStyle: CSSProperties = {
  height: 1,
  background: 'var(--border-subtle, rgba(0,0,0,0.08))',
  margin: '4px 0',
}

const menuItemStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  width: '100%',
  padding: '9px 12px',
  borderRadius: 'var(--radius-sm, 8px)',
  border: 'none',
  background: 'transparent',
  color: 'var(--text-primary, #1d1d1f)',
  fontSize: 13,
  fontWeight: 500,
  cursor: 'pointer',
  textAlign: 'left',
  transition: 'background 0.1s ease',
}

// ===== 面板切换按钮样式（玻璃拟态方形按钮）=====
const panelBtnStyle = (active: boolean): CSSProperties => ({
  width: 40,
  height: 40,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  borderRadius: 'var(--radius-md, 12px)',
  border: active
    ? '1px solid var(--color-primary, #4A90E2)'
    : '1px solid var(--border-default, rgba(0,0,0,0.12))',
  background: active
    ? 'rgba(74,144,226,0.14)'
    : 'rgba(255,255,255,0.72)',
  backdropFilter: 'blur(16px) saturate(180%)',
  WebkitBackdropFilter: 'blur(16px) saturate(180%)',
  color: active ? 'var(--color-primary, #4A90E2)' : 'var(--text-secondary, #495057)',
  cursor: 'pointer',
  boxShadow: active ? '0 4px 12px rgba(74,144,226,0.18)' : '0 2px 8px rgba(0,0,0,0.06)',
  transition: 'transform 0.1s ease, box-shadow 0.15s ease, background 0.15s ease, border-color 0.15s ease, color 0.15s ease',
})

// ===== 面板切换下拉样式（玻璃拟态）=====
const panelDropdownStyle: CSSProperties = {
  position: 'absolute',
  top: 'calc(100% + 8px)',
  right: 0,
  minWidth: 240,
  maxHeight: 420,
  overflowY: 'auto',
  background: 'rgba(255,255,255,0.85)',
  backdropFilter: 'blur(20px) saturate(180%)',
  WebkitBackdropFilter: 'blur(20px) saturate(180%)',
  border: '1px solid var(--border-default, rgba(0,0,0,0.12))',
  borderRadius: 'var(--radius-md, 12px)',
  boxShadow: '0 12px 32px rgba(0,0,0,0.16), 0 4px 8px rgba(0,0,0,0.08)',
  padding: 6,
  animation: 'menuIn 0.15s ease-out',
}

const sectionHeaderStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 5,
  padding: '8px 12px 4px',
  fontSize: 11,
  color: 'var(--text-tertiary, #adb5bd)',
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: '0.5px',
}

const emptyHintStyle: CSSProperties = {
  padding: '8px 12px',
  fontSize: 12,
  color: 'var(--text-tertiary, #adb5bd)',
  fontStyle: 'italic',
}

const panelItemStyle: CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  gap: 8,
  padding: '8px 12px',
  borderRadius: 'var(--radius-sm, 8px)',
  cursor: 'pointer',
  fontSize: 13,
  transition: 'background 0.1s ease',
}

const panelItemNameStyle: CSSProperties = {
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  flex: 1,
}

const panelDeleteBtnStyle: CSSProperties = {
  background: 'none',
  border: 'none',
  cursor: 'pointer',
  color: 'var(--text-tertiary, #adb5bd)',
  padding: 0,
  fontSize: 16,
  lineHeight: 1,
  fontWeight: 400,
  flexShrink: 0,
  transition: 'color 0.1s ease',
}

const panelDropdownFooterStyle: CSSProperties = {
  borderTop: '1px solid var(--border-subtle, rgba(0,0,0,0.08))',
  marginTop: 4,
  paddingTop: 4,
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
}

const newPanelBtnStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  width: '100%',
  padding: '9px 12px',
  borderRadius: 'var(--radius-sm, 8px)',
  border: 'none',
  background: 'transparent',
  color: 'var(--text-primary, #1d1d1f)',
  fontSize: 13,
  fontWeight: 500,
  cursor: 'pointer',
  textAlign: 'left',
  transition: 'background 0.1s ease',
}
