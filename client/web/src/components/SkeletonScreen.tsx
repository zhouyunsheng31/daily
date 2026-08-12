// Phase 6.1：骨架屏组件（spec 第 3 节）
// 面板休眠时显示，恢复时延迟移除，提供视觉反馈
// shimmer 动画在 index.css 中定义

import { useEffect, useState } from 'react'
import { Moon, Eye } from 'lucide-react'
import type { PanelMemoryStatus } from '../utils/panelMemoryManager'

interface SkeletonScreenProps {
  panelId: string
  panelName?: string
  status: PanelMemoryStatus | 'restoring'
  widgetCount?: number
}

/**
 * 骨架屏组件
 * - hibernated：显示"已休眠，点击恢复"提示 + 骨架块
 * - deep-hibernated：显示"已深度休眠，点击恢复"提示 + 简化骨架
 * - restoring：显示"恢复中..."提示 + 骨架块（spec 第 5 节"恢复时显示骨架屏，无白屏"）
 */
export default function SkeletonScreen({ panelId, panelName, status, widgetCount = 0 }: SkeletonScreenProps) {
  // 恢复时延迟移除骨架屏（等待 widgets 渲染完成）
  const [visible, setVisible] = useState(true)

  useEffect(() => {
    // status 变化时重置 visible
    setVisible(true)
  }, [status, panelId])

  const isDeep = status === 'deep-hibernated'
  const isRestoring = status === 'restoring'
  const label = isRestoring ? '恢复中...' : (isDeep ? '已深度休眠' : '已休眠')
  const desc = isRestoring
    ? '正在从数据库恢复面板状态'
    : (isDeep
        ? '组件已卸载以释放内存，切换到该面板将重新加载'
        : '组件已暂停以释放内存，切换到该面板将恢复')

  return (
    <div
      className={`skeleton-screen ${isDeep ? 'skeleton-screen--deep' : ''}`}
      style={{
        position: 'absolute',
        inset: 0,
        display: visible ? 'flex' : 'none',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--bg-surface, #2C2C2E)',
        zIndex: 50,
        pointerEvents: 'none',
        padding: '24px',
      }}
      data-panel-id={panelId}
      data-status={status}
    >
      <div className="skeleton-screen__icon" style={{ marginBottom: '12px' }}>
        {isDeep ? <Moon size={32} color="var(--text-tertiary, #636366)" /> : <Eye size={32} color="var(--text-tertiary, #636366)" />}
      </div>
      <div className="skeleton-screen__label" style={{
        fontSize: '14px',
        color: 'var(--text-secondary, #98989D)',
        marginBottom: '4px',
      }}>
        {label}
      </div>
      {panelName && (
        <div className="skeleton-screen__name" style={{
          fontSize: '12px',
          color: 'var(--text-tertiary, #636366)',
          marginBottom: '8px',
        }}>
          {panelName}
        </div>
      )}
      <div className="skeleton-screen__desc" style={{
        fontSize: '11px',
        color: 'var(--text-tertiary, #636366)',
        marginBottom: '16px',
        textAlign: 'center',
      }}>
        {desc}
      </div>

      {/* 骨架块（模拟 widget 布局） */}
      {!isDeep && widgetCount > 0 && (
        <div className="skeleton-screen__blocks" style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))',
          gap: '8px',
          width: '100%',
          maxWidth: '600px',
        }}>
          {Array.from({ length: Math.min(widgetCount, 6) }).map((_, i) => (
            <div
              key={i}
              className="skeleton-block shimmer"
              style={{
                height: `${60 + (i % 3) * 20}px`,
                borderRadius: '8px',
                background: 'var(--bg-elevated, #3A3A3C)',
              }}
            />
          ))}
        </div>
      )}
    </div>
  )
}
