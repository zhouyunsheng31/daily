import { lazy, type ComponentType } from 'react'
import { registerWidget } from './index'
import { registerCapability } from './capabilityRegistry'
import type { WidgetConfig, WidgetProps } from '../types'
import { LazyWidget } from '../components/LazyWidget'
import type { ComponentCapability } from '../types/componentCapability'

// ============================================================================
// 内置 widget 注册：仅保留 HtmlCanvasWidget（HTML 画布容器机制）
// 其他 widget 已移除，改为动态 widget 机制按需加载
// ============================================================================

const LazyHtmlCanvasWidget = lazy(() => import('../components/widgets/HtmlCanvasWidget'))

/**
 * 工厂函数：将 lazy 组件包装成带 Suspense 的普通 ComponentType
 * 模块级调用一次，wrapper 引用稳定（不会每次渲染创建新组件）
 */
function makeLazyWidgetWrapper(
  LazyComp: ComponentType<WidgetProps>
): ComponentType<WidgetProps> {
  return function LazyWidgetWrapper(props: WidgetProps) {
    return <LazyWidget Component={LazyComp} {...props} />
  }
}

// 包装后的 widget 组件（带 Suspense）
const HtmlCanvasWidget = makeLazyWidgetWrapper(LazyHtmlCanvasWidget)

// ============================================================================
// Phase 2：自由 HTML 组件（FreeHtmlComponent）适配器
// 设计文档 §3.1 / §3.4 + 决策日志 13/14/22/32
//
// 注册为 widget type（与 htmlCanvas 并列），供 AI query_capabilities 查询。
// 实际渲染时 Workspace.tsx 识别 widgetType === 'freeHtml'，跳过 WidgetContainer
// （避免 drag/resize 包装，符合"不可人为拖拽缩放"约束），
// 直接渲染 FreeHtmlComponent（共享 DOM，pointer-events: none 让点击穿透）。
//
// 此 Adapter 作为 WidgetConfig.component 占位（满足类型约束），
// 万一被 WidgetContainer 调用也能正常渲染（降级为可拖拽缩放形态）。
// ============================================================================

function FreeHtmlWidgetAdapter({ widgetId, state }: WidgetProps) {
  const html = typeof state.html === 'string' ? state.html : ''
  const customZIndex = typeof state.customZIndex === 'number' ? state.customZIndex : undefined
  // 降级渲染：占位（实际渲染走 Workspace.tsx 分流）
  return (
    <div
      data-widget-id={widgetId}
      data-free-html="true"
      data-free-html-fallback="true"
      style={{
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
        overflow: 'visible',
        position: 'relative',
        zIndex: customZIndex ?? 1,
      }}
      dangerouslySetInnerHTML={{
        __html: html || '<!-- free-html: 等待 AI 生成内容 -->',
      }}
    />
  )
}

// ============ SVG Icons ============
const svg = (paths: string, vb = '0 0 20 20') => (
  <svg width="18" height="18" viewBox={vb} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    {paths.split('|').map((p, i) => <path key={i} d={p} />)}
  </svg>
)

const ICONS = {
  htmlCanvas: svg('M3 3h14v14H3zM3 9h14M9 3v14'),
  // 自由 HTML：抽象的"任意形状 + 自由定位"图标（圆 + 散点，区别于矩形画布）
  freeHtml: svg('M4 10a6 6 0 1 1 12 0|M10 4a6 6 0 0 1 0 12|M10 10m-2 0a2 2 0 1 0 4 0a2 2 0 1 0 -4 0'),
} as const

const builtInConfigs: WidgetConfig[] = [
  {
    widgetType: 'htmlCanvas',
    displayName: 'HTML 画布',
    icon: ICONS.htmlCanvas,
    defaultLayout: { w: 400, h: 400, minW: 200, minH: 200 },
    defaultState: { html: '', title: 'HTML Widget', createdAt: 0, updatedAt: 0, schemaVersion: 1 },
    component: HtmlCanvasWidget,
    serialize: s => s,
    deserialize: d => d,
  },
  // Phase 2：自由 HTML 组件（与 htmlCanvas 并列）
  {
    widgetType: 'freeHtml',
    displayName: '自由 HTML',
    icon: ICONS.freeHtml,
    // 默认较小尺寸（自由 HTML 通常是装饰/覆盖层，不需要大画布）
    defaultLayout: { w: 120, h: 120, minW: 40, minH: 40 },
    defaultState: {
      html: '',
      title: '自由 HTML',
      isGlobal: false,
      createdAt: 0,
      updatedAt: 0,
      schemaVersion: 1,
    },
    component: FreeHtmlWidgetAdapter,
    serialize: s => s,
    deserialize: d => d,
  },
]

export function registerBuiltInWidgets(): void {
  builtInConfigs.forEach(config => {
    registerWidget(config)
  })
}

// ============================================================================
// 内置组件能力声明
// 静态注册到 capabilityRegistry，main.tsx bootstrap 时 syncCapabilitiesToServer
// 同步到服务器 component_capabilities 表，供 AI query_capabilities 工具查询
// ============================================================================

const BUILT_IN_CAPABILITIES: ComponentCapability[] = [
  {
    widgetType: 'htmlCanvas',
    displayName: 'HTML 画布',
    description: 'HTML 画布组件，可自定义 HTML/CSS/JS 内容并实时渲染（iframe 隔离，矩形可拖拽缩放）',
    api: [
      { name: 'setHtml', description: '设置 HTML 内容', parameters: { html: 'string' } },
      { name: 'getHtml', description: '获取当前 HTML 内容' },
      { name: 'runScript', description: '在画布中执行 JS 脚本', parameters: { script: 'string' } },
    ],
    dependencies: [],
    version: '1.0.0',
    componentEnv: 'pure-frontend',
    crossPlatform: true,
    desktopOnly: false,
  },
  // Phase 2：自由 HTML 组件能力声明
  // AI 生成 HTML 时两种都支持，AI 自己判断放哪：
  //   - 独立功能组件（游戏/工具/计算器）→ htmlCanvas（iframe 隔离）
  //   - 跨 widget 动画/装饰/全局特效/覆盖层 → freeHtml（共享 DOM）
  {
    widgetType: 'freeHtml',
    displayName: '自由 HTML',
    description:
      '自由 HTML 组件：任意形状，自由移动可跨 widget 边界，无隔离与画布共享 DOM，' +
      '默认 pointer-events:none 让点击穿透。适合跨 widget 动画/装饰/全局覆盖层。' +
      '不可人为拖拽缩放（但支持人操作和拖拽）。',
    api: [
      { name: 'setHtml', description: '设置 HTML 内容（共享 DOM，无隔离）', parameters: { html: 'string' } },
      { name: 'getHtml', description: '获取当前 HTML 内容' },
      { name: 'setGlobal', description: '切换全局覆盖 / 画布定位', parameters: { isGlobal: 'boolean' } },
      { name: 'setSize', description: '设置尺寸（不传则自适应）', parameters: { width: 'number?', height: 'number?' } },
      { name: 'setPosition', description: '设置基准位置（画布坐标）', parameters: { x: 'number', y: 'number' } },
    ],
    dependencies: [],
    version: '1.0.0',
    componentEnv: 'pure-frontend',
    crossPlatform: true,
    desktopOnly: false,
  },
]

/**
 * 注册所有内置组件的能力声明
 * 在 registerBuiltInWidgets 之后调用
 */
export function registerBuiltInCapabilities(): void {
  BUILT_IN_CAPABILITIES.forEach(cap => {
    registerCapability(cap)
  })
}
