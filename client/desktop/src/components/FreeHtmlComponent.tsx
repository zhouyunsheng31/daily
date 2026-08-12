import { memo, useMemo } from 'react'

// ============================================================================
// Phase 2：自由 HTML 组件（FreeHtmlComponent）
// 设计文档 §3.1 / §3.4 + 决策日志 13/14/22/32
//
// 与 iframe widget (htmlCanvas) 的对比：
//   iframe widget  | 自由 HTML 组件
//   ---------------+------------------
//   矩形            | 任意形状
//   有位置和大小    | 自由移动，可跨 widget 边界
//   可拖拽缩放      | 不可人为拖拽缩放（但支持人操作和拖拽）
//   iframe 隔离     | 无隔离，和画布共享 DOM
//   内容只在矩形内  | 可配置全局覆盖 or 局部
//
// 实现：
//   - 使用 dangerouslySetInnerHTML 渲染 HTML（无隔离，共享 DOM）
//   - 容器层 pointerEvents: 'none'（点击穿透到画布，不可人为拖拽缩放）
//   - 子元素默认 pointerEvents: 'auto'（支持人操作：可点击/交互）
//     通过 wrapper div 实现：容器 none + wrapper auto
//   - interactive prop（默认 true）控制子元素是否可交互，AI 可设 false 完全穿透
//   - 不可人为拖拽缩放（不绑定 drag/resize handler）
//   - 可跨 widget 边界（overflow: visible）
//   - 缩放通过外层 wrapper 的 transform: scale 控制（相册缩放联动）
// ============================================================================

export interface FreeHtmlComponentProps {
  id: string
  /** HTML 字符串（AI 生成 or 用户配置） */
  htmlContent: string
  /** 画布坐标位置（isGlobal=false 时生效） */
  position: { x: number; y: number }
  /** 尺寸（不传则自适应内容） */
  size?: { width: number; height: number }
  /** 是否全局覆盖（true=fixed 定位覆盖视口，false=画布坐标定位） */
  isGlobal?: boolean
  /** z-index（默认 100，位于组件层内） */
  zIndex?: number
  /** 相册缩放比例（normal=1, mini=0.5, icon=0.2），默认 1 */
  scale?: number
  /** 缩放原点（默认 'top left'，与 V8 原型 widget-scaler 一致） */
  transformOrigin?: string
  /** 额外 className */
  className?: string
  /**
   * 子元素是否可交互（默认 true，符合决策32"支持人操作"）。
   * - true：容器穿透（不可拖拽），但子元素可点击/交互
   * - false：完全穿透（容器+子元素都 none），AI 可用于纯展示层
   */
  interactive?: boolean
}

function FreeHtmlComponentImpl({
  id,
  htmlContent,
  position,
  size,
  isGlobal = false,
  zIndex = 100,
  scale = 1,
  transformOrigin = 'top left',
  className,
  interactive = true,
}: FreeHtmlComponentProps): React.ReactElement | null {
  const style = useMemo<React.CSSProperties>(() => {
    const base: React.CSSProperties = {
      // 容器层 pointer-events: none —— 点击穿透到画布/下方 widget
      // 不可人为拖拽缩放（不绑定 drag/resize handler），符合决策32
      pointerEvents: 'none',
      overflow: 'visible',
      zIndex,
      transform: scale === 1 ? undefined : `scale(${scale})`,
      transformOrigin,
      transition: 'transform 200ms ease-out',
    }
    if (isGlobal) {
      base.position = 'fixed'
      base.left = 0
      base.top = 0
      base.width = '100vw'
      base.height = '100vh'
    } else {
      base.position = 'absolute'
      base.left = position.x
      base.top = position.y
      if (size) {
        base.width = size.width
        base.height = size.height
      }
    }
    return base
  }, [isGlobal, position.x, position.y, size, zIndex, scale, transformOrigin])

  // wrapper 层 pointer-events: auto —— 子元素默认可交互（支持人操作）
  // 当 interactive=false 时，wrapper 也设为 none（完全穿透，AI 用于纯展示层）
  const wrapperStyle = useMemo<React.CSSProperties>(() => ({
    pointerEvents: interactive ? 'auto' : 'none',
  }), [interactive])

  if (!htmlContent) return null

  return (
    <div
      className={`free-html-component${className ? ` ${className}` : ''}`}
      data-free-html="true"
      data-free-html-id={id}
      data-zoom-scale={scale}
      data-interactive={interactive ? 'true' : 'false'}
      style={style}
    >
      <div
        data-free-html-wrapper="true"
        style={wrapperStyle}
        dangerouslySetInnerHTML={{ __html: htmlContent }}
      />
    </div>
  )
}

export const FreeHtmlComponent = memo(FreeHtmlComponentImpl)
