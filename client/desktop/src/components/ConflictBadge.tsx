import { useState, useRef, useEffect } from 'react'
import { AlertTriangle, X, Check, GitMerge, Download } from 'lucide-react'
import { useAppStore } from '../stores/useAppStore'

/**
 * Phase 4: 冲突角标组件（spec 2.5 节）
 *
 * 在 WidgetContainer 右上角显示冲突角标，点击展开冲突处理面板。
 * 选项：保留本地 / 保留远端 / 合并 / 查看差异
 *
 * UI 交互流程：
 * 1. 检测到 409 响应 → useAppStore.conflicts[widgetId] 存储冲突信息
 * 2. WidgetContainer 渲染时检查 conflicts[widgetId]，有冲突则显示本组件
 * 3. 点击角标 → 展开冲突处理面板
 * 4. 用户选择 → 调用 resolveConflict → 用最新 version 重新提交
 */
interface ConflictBadgeProps {
  widgetId: string
}

export default function ConflictBadge({ widgetId }: ConflictBadgeProps) {
  const conflict = useAppStore(s => s.conflicts[widgetId])
  const resolveConflict = useAppStore(s => s.resolveConflict)
  const [expanded, setExpanded] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)

  // 点击外部关闭面板
  useEffect(() => {
    if (!expanded) return
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setExpanded(false)
      }
    }
    const timer = setTimeout(() => {
      document.addEventListener('mousedown', handler)
    }, 0)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('mousedown', handler)
    }
  }, [expanded])

  // 没有冲突时不渲染
  if (!conflict) return null

  const handleResolve = async (action: 'keep-local' | 'keep-remote' | 'merge') => {
    try {
      await resolveConflict(widgetId, action)
      setExpanded(false)
    } catch (err) {
      console.error('[ConflictBadge] resolve failed:', err)
    }
  }

  return (
    <div ref={panelRef} className="conflict-badge-container" style={{
      position: 'absolute',
      top: -8,
      right: -8,
      zIndex: 30,
    }}>
      {/* 角标按钮 */}
      <button
        className="conflict-badge-button"
        onClick={(e) => {
          e.stopPropagation()
          setExpanded(prev => !prev)
        }}
        onMouseDown={(e) => e.stopPropagation()}
        title={`组件状态有冲突（本地 v${conflict.localVersion} ↔ 远端 v${conflict.remoteVersion}），点击查看`}
        style={{
          width: 20,
          height: 20,
          borderRadius: '50%',
          border: 'none',
          background: 'var(--color-danger, #ff3b30)',
          color: '#fff',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          boxShadow: '0 2px 6px rgba(255, 59, 48, 0.4)',
        }}
      >
        <AlertTriangle size={12} />
      </button>

      {/* 冲突处理面板 */}
      {expanded && (
        <div
          className="conflict-badge-panel"
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          style={{
            position: 'absolute',
            top: 24,
            right: 0,
            width: 260,
            padding: 12,
            borderRadius: 8,
            background: 'var(--bg-elevated, #2c2c2e)',
            border: '1px solid var(--border-default, #3a3a3c)',
            boxShadow: '0 8px 24px rgba(0, 0, 0, 0.4)',
            fontSize: 12,
            color: 'var(--text-primary, #f5f5f7)',
          }}
        >
          {/* 头部 */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 8,
            paddingBottom: 8,
            borderBottom: '1px solid var(--border-default, #3a3a3c)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 600 }}>
              <AlertTriangle size={14} style={{ color: 'var(--color-danger, #ff3b30)' }} />
              <span>状态冲突</span>
            </div>
            <button
              onClick={() => setExpanded(false)}
              style={{
                border: 'none',
                background: 'transparent',
                color: 'var(--text-tertiary, #8e8e93)',
                cursor: 'pointer',
                padding: 2,
                display: 'flex',
              }}
              title="关闭"
            >
              <X size={14} />
            </button>
          </div>

          {/* 版本信息 */}
          <div style={{ marginBottom: 10, color: 'var(--text-secondary, #aeaeb2)', fontSize: 11 }}>
            <div>本地版本：v{conflict.localVersion}</div>
            <div>远端版本：v{conflict.remoteVersion}</div>
            <div style={{ marginTop: 4 }}>冲突时间：{new Date(conflict.timestamp).toLocaleString()}</div>
          </div>

          {/* 操作按钮 */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <button
              className="conflict-action-btn keep-local"
              onClick={() => handleResolve('keep-local')}
              style={{
                padding: '8px 10px',
                borderRadius: 6,
                border: '1px solid var(--border-default, #3a3a3c)',
                background: 'var(--bg-secondary, #1c1c1e)',
                color: 'var(--text-primary, #f5f5f7)',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                fontSize: 12,
                textAlign: 'left',
              }}
            >
              <Check size={14} style={{ color: 'var(--color-success, #34c759)' }} />
              <div>
                <div style={{ fontWeight: 600 }}>保留本地</div>
                <div style={{ fontSize: 10, color: 'var(--text-tertiary, #8e8e93)' }}>用本地状态覆盖远端</div>
              </div>
            </button>

            <button
              className="conflict-action-btn keep-remote"
              onClick={() => handleResolve('keep-remote')}
              style={{
                padding: '8px 10px',
                borderRadius: 6,
                border: '1px solid var(--border-default, #3a3a3c)',
                background: 'var(--bg-secondary, #1c1c1e)',
                color: 'var(--text-primary, #f5f5f7)',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                fontSize: 12,
                textAlign: 'left',
              }}
            >
              <Download size={14} style={{ color: 'var(--color-primary, #0a84ff)' }} />
              <div>
                <div style={{ fontWeight: 600 }}>保留远端</div>
                <div style={{ fontSize: 10, color: 'var(--text-tertiary, #8e8e93)' }}>用远端状态覆盖本地</div>
              </div>
            </button>

            <button
              className="conflict-action-btn merge"
              onClick={() => handleResolve('merge')}
              style={{
                padding: '8px 10px',
                borderRadius: 6,
                border: '1px solid var(--border-default, #3a3a3c)',
                background: 'var(--bg-secondary, #1c1c1e)',
                color: 'var(--text-primary, #f5f5f7)',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                fontSize: 12,
                textAlign: 'left',
              }}
            >
              <GitMerge size={14} style={{ color: 'var(--color-warning, #ff9f0a)' }} />
              <div>
                <div style={{ fontWeight: 600 }}>合并</div>
                <div style={{ fontSize: 10, color: 'var(--text-tertiary, #8e8e93)' }}>用本地状态重新提交（基于远端版本）</div>
              </div>
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
