/**
 * FavoriteWidgetPreview 组件（Phase 5 收藏组件预览 + Phase 7 批次5 性能优化）
 *
 * Phase 5 基础功能：
 * - 按 widgetType 分发预览渲染策略
 * - htmlCanvas：渲染 iframe srcdoc
 * - aiAssistant/webPage/pdfViewer：渲染图标 + 文字
 * - 未知类型：显示 LayoutGrid 图标 + displayName
 *
 * Phase 7 批次5 优化（冻结态/静态模式）：
 * - 用 React.memo 包裹整个组件，避免父组件重渲染导致预览重渲染
 * - 不再渲染实际 widget 组件（避免副作用：FocusTimer 跑计时器、MusicPlayer 加载音频等）
 * - calculator/focusTimer/sudoku/latexQuiz/musicPlayer 改为渲染静态图标 + 状态信息
 * - 保留 htmlCanvas 的 iframe 渲染（iframe 是惰性的，无副作用）
 */
import { memo, useMemo, type ReactNode } from 'react'
import { Star, Globe, Bot, FileText, LayoutGrid, Clock, Music, Calculator } from 'lucide-react'
import type { FavoriteEntry } from '../types'
import { getWidgetConfig } from '../registry'

interface FavoriteWidgetPreviewProps {
  favorite: FavoriteEntry
  onClick: () => void
}

/** 预览卡片尺寸 */
const CARD_W = 160
const CARD_H = 120

function FavoriteWidgetPreviewBase({ favorite, onClick }: FavoriteWidgetPreviewProps) {
  const config = getWidgetConfig(favorite.widgetType)
  const displayName = favorite.displayName || config?.displayName || favorite.widgetType

  // 计算缩放比例（从 positionSnapshot 的原始尺寸缩放到卡片尺寸）
  const { scaleX, scaleY, originalW, originalH } = useMemo(() => {
    const w = favorite.positionSnapshot.w || CARD_W
    const h = favorite.positionSnapshot.h || CARD_H
    return {
      scaleX: CARD_W / w,
      scaleY: CARD_H / h,
      originalW: w,
      originalH: h,
    }
  }, [favorite.positionSnapshot.w, favorite.positionSnapshot.h])

  // 静态模式渲染（不渲染实际 widget，避免副作用）
  const renderContent = (): ReactNode => {
    const { widgetType, stateSnapshot } = favorite

    // 静态模式：根据 widgetType 渲染对应图标 + 状态信息
    switch (widgetType) {
      case 'focusTimer': {
        // 静态时间显示（不跑计时器）
        const mode = (stateSnapshot.mode as string) || 'pomodoro'
        const modeLabel = mode === 'pomodoro' ? '专注' : mode === 'shortBreak' ? '短休' : mode === 'longBreak' ? '长休' : '计时'
        return <StaticCard icon={<Clock size={32} />} label={modeLabel} color="var(--color-primary)" />
      }
      case 'musicPlayer': {
        // 静态封面（不加载音频）
        const trackName = (stateSnapshot.trackName as string) || '音乐播放器'
        return <StaticCard icon={<Music size={32} />} label={trackName} color="var(--color-secondary)" />
      }
      case 'latexQuiz': {
        // 静态题目（不响应点击）
        return <StaticCard icon={<FileText size={32} />} label="LaTeX 题目" color="var(--text-secondary)" />
      }
      case 'sudoku': {
        // 静态棋盘（不响应输入）
        return <StaticCard icon={<LayoutGrid size={32} />} label="数独" color="var(--text-secondary)" />
      }
      case 'calculator': {
        // 计算器静态显示
        return <StaticCard icon={<Calculator size={32} />} label="计算器" color="var(--text-secondary)" />
      }
      case 'htmlCanvas': {
        // HTML 画布：iframe srcdoc（iframe 是惰性的，无副作用，保持原有逻辑）
        const html = (stateSnapshot.html as string) || ''
        return (
          <iframe
            srcDoc={html}
            sandbox="allow-scripts"
            style={{
              width: originalW,
              height: originalH,
              border: 'none',
              background: '#fff',
            }}
            title={displayName}
          />
        )
      }
      case 'aiAssistant': {
        // AI 助手：图标 + 文字
        return (
          <div style={{
            width: originalW,
            height: originalH,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            color: 'var(--color-primary)',
            background: 'var(--bg-surface)',
          }}>
            <Bot size={32} />
            <span style={{ fontSize: 13, fontWeight: 600 }}>AI 助手</span>
          </div>
        )
      }
      case 'webPage': {
        // 网页：Globe 图标 + URL
        const url = (stateSnapshot.url as string) || ''
        return (
          <div style={{
            width: originalW,
            height: originalH,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            color: 'var(--text-secondary)',
            background: 'var(--bg-surface)',
            padding: 12,
          }}>
            <Globe size={32} />
            <span style={{
              fontSize: 11,
              color: 'var(--text-tertiary)',
              maxWidth: '80%',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}>
              {url || '网页'}
            </span>
          </div>
        )
      }
      case 'pdfViewer': {
        // PDF 阅读器：FileText 图标 + 文件名
        const fileName = (stateSnapshot.fileName as string)
          || (stateSnapshot.title as string)
          || displayName
        return (
          <div style={{
            width: originalW,
            height: originalH,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            color: 'var(--color-error)',
            background: 'var(--bg-surface)',
            padding: 12,
          }}>
            <FileText size={32} />
            <span style={{
              fontSize: 11,
              color: 'var(--text-tertiary)',
              maxWidth: '80%',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}>
              {fileName}
            </span>
          </div>
        )
      }
      default:
        // 未知类型：LayoutGrid 图标 + displayName
        return <FallbackIcon displayName={displayName} />
    }
  }

  return (
    <div
      className="favorite-preview-card"
      onClick={onClick}
      style={{
        width: CARD_W,
        height: CARD_H,
        borderRadius: 8,
        overflow: 'hidden',
        position: 'relative',
        cursor: 'pointer',
        border: '1px solid var(--border-subtle)',
        background: 'var(--bg-surface)',
        transition: 'border-color 0.15s',
      }}
      onMouseEnter={e => {
        e.currentTarget.style.borderColor = 'var(--color-primary)'
      }}
      onMouseLeave={e => {
        e.currentTarget.style.borderColor = 'var(--border-subtle)'
      }}
      title={`点击跳转到 ${displayName}`}
    >
      {/* 收藏星标 */}
      <div style={{
        position: 'absolute',
        top: 4,
        right: 4,
        zIndex: 2,
        color: 'var(--color-warning)',
        pointerEvents: 'none',
      }}>
        <Star size={12} fill="currentColor" />
      </div>

      {/* 预览内容区域（scale 缩放） */}
      <div
        className="favorite-preview-card__content"
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: originalW,
          height: originalH,
          transform: `scale(${scaleX}, ${scaleY})`,
          transformOrigin: 'top left',
          pointerEvents: 'none',
        }}
      >
        {renderContent()}
      </div>

      {/* 底部 label */}
      <div
        className="favorite-preview-card__label"
        style={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: 0,
          background: 'rgba(0,0,0,0.6)',
          color: 'white',
          fontSize: 11,
          padding: '2px 6px',
          zIndex: 2,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {displayName}
      </div>
    </div>
  )
}

/** 静态卡片：图标 + 标签（冻结态，无副作用） */
function StaticCard({ icon, label, color }: { icon: ReactNode; label: string; color: string }): ReactNode {
  return (
    <div style={{
      width: '100%',
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      color,
      background: 'var(--bg-surface)',
    }}>
      {icon}
      <span style={{
        fontSize: 11,
        color: 'var(--text-tertiary)',
        maxWidth: '80%',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
      }}>
        {label}
      </span>
    </div>
  )
}

/** 未知类型的兜底图标卡片 */
function FallbackIcon({ displayName }: { displayName: string }): ReactNode {
  return (
    <div style={{
      width: '100%',
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      color: 'var(--text-secondary)',
      background: 'var(--bg-surface)',
    }}>
      <LayoutGrid size={32} />
      <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>{displayName}</span>
    </div>
  )
}

// React.memo 冻结态：浅比较 props，避免父组件重渲染导致预览重渲染
const FavoriteWidgetPreview = memo(FavoriteWidgetPreviewBase)
export default FavoriteWidgetPreview
