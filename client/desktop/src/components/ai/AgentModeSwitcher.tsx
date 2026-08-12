/**
 * AgentModeSwitcher — Phase 9 批次 3 模块 7（Agent 切换 UI）
 *
 * 与 useRuntimeModeStore 集成，支持 cloud / local / auto 三档切换。
 *
 * 设计要点（spec 3.7.3）：
 * - 按钮显示当前 effectiveMode 的图标 + 标签
 *   - cloud: ☁️ 云端
 *   - local: 💻 本地
 *   - auto: ⚡ 自动（实际生效模式用括号显示，如 "自动 (云端)"）
 * - 点击展开 3 选项菜单：云端 / 本地 / 自动
 * - 选中后调用 useRuntimeModeStore.setMode(mode)
 * - 当 isOfflineDowngraded 为 true 时，按钮显示警告色（黄色），
 *   tooltip "服务器离线，已自动切换到本地"
 *
 * 与移动端 AgentModeSwitcher.kt 对齐（label 文案一致）。
 *
 * 注意：
 * - 这里直接调用 useRuntimeModeStore 的 action，无需父组件传 props
 * - 组件内部管理下拉菜单 open 状态
 * - 与 OfflineBanner 配合使用：OfflineBanner 是顶部全宽提示条，
 *   AgentModeSwitcher 是 sidebar 顶部按钮区的小按钮
 */

import { useState, useRef, useEffect, useCallback, type ReactElement } from 'react'
import { Cloud, HardDrive, Zap, ChevronDown, AlertTriangle } from 'lucide-react'
import { useRuntimeModeStore, getModeLabel, getEffectiveModeLabel, type RuntimeMode } from '../../stores/useRuntimeModeStore'

/** 三档模式配置（与 useRuntimeModeStore 的 RuntimeMode 类型对齐，小写字符串） */
const MODES: Array<{ mode: RuntimeMode; label: string; icon: typeof Cloud }> = [
  { mode: 'cloud', label: '云端', icon: Cloud },
  { mode: 'local', label: '本地', icon: HardDrive },
  { mode: 'auto', label: '自动', icon: Zap },
]

export default function AgentModeSwitcher(): ReactElement {
  // ===== 从 useRuntimeModeStore 订阅状态 =====
  const mode = useRuntimeModeStore(s => s.mode)
  const effectiveMode = useRuntimeModeStore(s => s.effectiveMode)
  const isOfflineDowngraded = useRuntimeModeStore(s => s.isOfflineDowngraded)
  const setMode = useRuntimeModeStore(s => s.setMode)

  // ===== 本地 UI 状态 =====
  const [open, setOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  // ===== 点击外部关闭下拉菜单 =====
  useEffect(() => {
    if (!open) return
    function handleClick(e: MouseEvent): void {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  // ===== 切换模式 =====
  const handleSelectMode = useCallback((next: RuntimeMode) => {
    setMode(next)
    setOpen(false)
  }, [setMode])

  // ===== 计算按钮显示 =====
  // 当前用户选中的模式对应的图标
  const currentModeConfig = MODES.find(m => m.mode === mode) ?? MODES[2] // fallback 'auto'
  const CurrentIcon = currentModeConfig.icon

  // 按钮显示文案：
  // - cloud/local：直接显示 "云端" / "本地"
  // - auto：显示 "自动 (云端)" 或 "自动 (本地)" —— 括号内是实际生效模式
  const buttonLabel = mode === 'auto'
    ? `自动 (${getEffectiveModeLabel(effectiveMode)})`
    : getModeLabel(mode)

  // 按钮颜色：离线降级时显示警告色（黄色）
  // 与 OfflineBanner 的 #f59e0b 边框色系一致
  const isWarning = isOfflineDowngraded

  const buttonTooltip = isOfflineDowngraded
    ? '服务器离线，已自动切换到本地'
    : `当前 Agent 模式：${buttonLabel}（点击切换）`

  return (
    <div
      ref={dropdownRef}
      style={{ position: 'relative' }}
    >
      {/* 切换按钮 */}
      <button
        type="button"
        onClick={() => setOpen(!open)}
        title={buttonTooltip}
        aria-label={`切换 Agent 模式，当前：${buttonLabel}`}
        aria-expanded={open}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 4,
          padding: '2px 8px',
          background: isWarning ? 'rgba(245, 158, 11, 0.12)' : 'transparent',
          border: `1px solid ${isWarning ? 'rgba(245, 158, 11, 0.5)' : 'var(--border-subtle)'}`,
          borderRadius: 9999,
          cursor: 'pointer',
          fontSize: 10,
          color: isWarning ? '#b45309' : 'var(--text-secondary)',
          fontFamily: 'inherit',
          transition: 'background 0.2s ease-in-out',
        }}
        onMouseEnter={(e) => {
          if (!isWarning) e.currentTarget.style.background = 'rgba(0,0,0,0.04)'
        }}
        onMouseLeave={(e) => {
          if (!isWarning) e.currentTarget.style.background = 'transparent'
        }}
      >
        {isWarning ? (
          <AlertTriangle size={10} style={{ flexShrink: 0 }} />
        ) : (
          <CurrentIcon size={10} style={{ flexShrink: 0 }} />
        )}
        <span style={{
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}>
          {buttonLabel}
        </span>
        <ChevronDown
          size={10}
          style={{
            flexShrink: 0,
            transition: 'transform 0.2s ease-in-out',
            transform: open ? 'rotate(180deg)' : 'none',
          }}
        />
      </button>

      {/* 下拉菜单 */}
      {open && (
        <div
          style={{
            position: 'absolute',
            top: 'calc(100% + 4px)',
            left: 0,
            minWidth: 120,
            background: 'rgba(255,255,255,0.95)',
            backdropFilter: 'blur(12px)',
            WebkitBackdropFilter: 'blur(12px)',
            border: '1px solid var(--border-subtle)',
            borderRadius: 12,
            boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
            zIndex: 1000,
            padding: 4,
          }}
        >
          {MODES.map(({ mode: m, label, icon: Icon }) => {
            const isActive = m === mode
            return (
              <button
                key={m}
                type="button"
                onClick={() => handleSelectMode(m)}
                style={{
                  width: '100%',
                  display: 'flex',
                  alignItems: 'center',
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
                <Icon size={11} style={{ flexShrink: 0 }} />
                <span style={{ flex: 1 }}>{label}</span>
                {/* 显示生效模式提示（仅 auto 模式下显示当前实际生效的模式） */}
                {m === 'auto' && (
                  <span style={{
                    fontSize: 9,
                    color: 'var(--text-tertiary)',
                  }}>
                    ({getEffectiveModeLabel(effectiveMode)})
                  </span>
                )}
                {isActive && (
                  <span style={{ fontSize: 10, color: 'var(--color-primary)' }}>✓</span>
                )}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
