/**
 * LazyWidget：React.lazy 组件的 Suspense 包装（Phase 7 批次5 任务8）
 *
 * 职责：为所有 lazy 加载的 widget 组件提供统一的 Suspense fallback。
 * - 加载中显示骨架屏（SkeletonScreen）
 * - 加载失败由 React.lazy 自身抛出错误（外层 ErrorBoundary 处理）
 *
 * 使用方式：
 *   const LazyPdfViewer = lazy(() => import('../components/widgets/PdfViewer'))
 *   <LazyWidget Component={LazyPdfViewer} {...widgetProps} />
 */
import { Suspense, type ComponentType } from 'react'
import type { WidgetProps } from '../types'

interface LazyWidgetProps extends WidgetProps {
  /** 已 React.lazy 包裹的组件 */
  Component: ComponentType<WidgetProps>
}

/** 加载中骨架屏 */
function WidgetSkeleton(): React.ReactElement {
  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--bg-elevated, #f0f0f2)',
        color: 'var(--text-tertiary, #adb5bd)',
        fontSize: 12,
      }}
    >
      加载中...
    </div>
  )
}

/**
 * LazyWidget：包裹 lazy 组件 + Suspense
 * 用法见模块注释
 */
export function LazyWidget({ Component, ...props }: LazyWidgetProps): React.ReactElement {
  return (
    <Suspense fallback={<WidgetSkeleton />}>
      <Component {...props} />
    </Suspense>
  )
}
