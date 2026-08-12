import { lazy, type ComponentType } from 'react'
import { registerWidget } from './index'
import { registerCapability } from './capabilityRegistry'
import type { WidgetConfig, WidgetProps } from '../types'
import { LazyWidget } from '../components/LazyWidget'
import { webPageWidgetDef } from './widgetDefinitions'
import type { ComponentCapability } from 'shared/types/componentCapability'
// Phase 15 批次5：轻量 widget 同步导入（spec 7.2.3：Calculator/AIAssistant 等保持同步）
import FocusTimer from '../components/widgets/FocusTimer'
import Calculator from '../components/widgets/Calculator'
import AIAssistant from '../components/widgets/AIAssistant'
import HtmlCanvasWidget from '../components/widgets/HtmlCanvasWidget'
import WebviewWidget from '../components/widgets/WebviewWidget'
import { FreeHtmlComponent } from '../components/FreeHtmlComponent'

// ============================================================================
// Phase 15 批次5：仅重型 widget 用 React.lazy（spec 7.2.3）
// - 重型 widget（PdfViewer/MusicPlayer/LatexQuiz/Sudoku）：lazy 包裹，减小首屏 bundle
// - 轻量 widget（Calculator/AIAssistant/FocusTimer/HtmlCanvasWidget/WebviewWidget）：同步导入
// 通过 makeLazyWidgetWrapper 工厂函数统一包装 Suspense fallback
// ============================================================================

const LazyPdfViewer = lazy(() => import('../components/widgets/PdfViewer'))
const LazyMusicPlayer = lazy(() => import('../components/widgets/MusicPlayer'))
const LazySudoku = lazy(() => import('../components/widgets/Sudoku'))
const LazyLatexQuiz = lazy(() => import('../components/widgets/LatexQuiz'))

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

// 包装后的重型 widget 组件（带 Suspense）
const PdfViewer = makeLazyWidgetWrapper(LazyPdfViewer)
const MusicPlayer = makeLazyWidgetWrapper(LazyMusicPlayer)
const Sudoku = makeLazyWidgetWrapper(LazySudoku)
const LatexQuiz = makeLazyWidgetWrapper(LazyLatexQuiz)

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
  pdfViewer: svg('M4 2h9l4 4v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1ZM13 2v4h4M7 10h6M7 13h6'),
  musicPlayer: svg('M9 2v12a3 3 0 1 1-2-2.83V4l8-2v10a3 3 0 1 1-2-2.83V5'),
  focusTimer: svg('M10 2a8 8 0 1 0 0 16 8 8 0 0 0 0-16ZM10 6v4l2.5 2.5M8 1h4'),
  aiAssistant: svg('M10 2a6 6 0 0 0-6 6c0 2 1 3.5 2.5 4.5V16l2-1 1.5 1 1.5-1 2 1v-3.5C14.5 11.5 16 10 16 8a6 6 0 0 0-6-6ZM8 8h.01M12 8h.01M8 12c.5.5 1.2.8 2 .8s1.5-.3 2-.8'),
  latexQuiz: svg('M3 5l3-2v14M16 3l-4 7 4 7M9 10h4M7 7l3 3-3 3'),
  calculator: svg('M4 2h12a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1ZM7 6h.01M13 6h.01M7 10h.01M13 10h.01M7 14h6'),
  sudoku: svg('M3 3h14v14H3zM3 8h14M3 12h14M8 3v14M12 3v14'),
  htmlCanvas: svg('M3 3h14v14H3zM3 9h14M9 3v14'),
  // 自由 HTML：抽象的"任意形状 + 自由定位"图标（圆 + 散点，区别于矩形画布）
  freeHtml: svg('M4 10a6 6 0 1 1 12 0|M10 4a6 6 0 0 1 0 12|M10 10m-2 0a2 2 0 1 0 4 0a2 2 0 1 0 -4 0'),
  webPage: svg('M10 2a8 8 0 1 0 0 16 8 8 0 0 0 0-16ZM2 10h16M10 2c2.5 2.5 2.5 13.5 0 16M10 2c-2.5 2.5-2.5 13.5 0 16'),
} as const

const builtInConfigs: WidgetConfig[] = [
  {
    widgetType: 'pdfViewer',
    displayName: 'PDF 阅读器',
    icon: ICONS.pdfViewer,
    defaultLayout: { w: 400, h: 500, minW: 300, minH: 350 },
    defaultState: {},
    component: PdfViewer,
    serialize: s => s,
    deserialize: d => d,
  },
  {
    widgetType: 'musicPlayer',
    displayName: '音乐播放器',
    icon: ICONS.musicPlayer,
    defaultLayout: { w: 320, h: 380, minW: 240, minH: 280 },
    defaultState: { trackName: '', currentTime: 0 },
    component: MusicPlayer,
    serialize: s => s,
    deserialize: d => d,
  },
  {
    widgetType: 'focusTimer',
    displayName: '专注计时',
    icon: ICONS.focusTimer,
    defaultLayout: { w: 260, h: 300, minW: 220, minH: 260 },
    defaultState: { mode: 'pomodoro', status: 'idle', accumulatedPausedMs: 0 },
    component: FocusTimer,
    serialize: s => s,
    deserialize: d => d,
  },
  {
    widgetType: 'aiAssistant',
    displayName: 'AI 助手',
    icon: ICONS.aiAssistant,
    defaultLayout: { w: 400, h: 520, minW: 320, minH: 400 },
    defaultState: { sessionId: '', selectedModel: 'deepseek-v4-flash', contextPanelOpen: false, privacyAccepted: false, configPanelOpen: false, role: '生活助手', theme: 'default', schemaVersion: 1 },
    component: AIAssistant,
    serialize: s => s,
    deserialize: d => d,
  },
  {
    widgetType: 'latexQuiz',
    displayName: 'LaTeX 出题器',
    icon: ICONS.latexQuiz,
    defaultLayout: { w: 360, h: 480, minW: 280, minH: 360 },
    defaultState: {},
    component: LatexQuiz,
    serialize: s => s,
    deserialize: d => d,
  },
  {
    widgetType: 'calculator',
    displayName: '科学计算器',
    icon: ICONS.calculator,
    defaultLayout: { w: 320, h: 460, minW: 260, minH: 380 },
    defaultState: {},
    component: Calculator,
    serialize: s => s,
    deserialize: d => d,
  },
  {
    widgetType: 'sudoku',
    displayName: '数独',
    icon: ICONS.sudoku,
    defaultLayout: { w: 380, h: 500, minW: 300, minH: 400 },
    defaultState: {},
    component: Sudoku,
    serialize: s => s,
    deserialize: d => d,
  },
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
  {
    widgetType: 'webPage',
    displayName: '网页',
    icon: ICONS.webPage,
    defaultLayout: { w: 480, h: 600, minW: 320, minH: 400 },
    defaultState: { ...webPageWidgetDef.createDefaultState() },
    component: WebviewWidget,
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
// Phase 14.4.5：9 个内置组件能力声明（spec 14.4.5 节）
// 静态注册到 capabilityRegistry，main.tsx bootstrap 时 syncCapabilitiesToServer
// 同步到服务器 component_capabilities 表，供 AI query_capabilities 工具查询
// ============================================================================

const BUILT_IN_CAPABILITIES: ComponentCapability[] = [
  {
    widgetType: 'pdfViewer',
    displayName: 'PDF 阅读器',
    description: '阅读 PDF 文件，支持翻页、缩放、文本选择与复制',
    api: [
      { name: 'openPdf', description: '打开指定 PDF 文件', parameters: { filePath: 'string' } },
      { name: 'nextPage', description: '翻到下一页' },
      { name: 'prevPage', description: '翻到上一页' },
      { name: 'gotoPage', description: '跳转到指定页码', parameters: { pageNum: 'number' } },
      { name: 'getSelection', description: '获取当前选中的文本' },
    ],
    dependencies: [],
    version: '1.0.0',
    componentEnv: 'pure-frontend',
    crossPlatform: true,
    desktopOnly: false,
  },
  {
    widgetType: 'musicPlayer',
    displayName: '音乐播放器',
    description: '播放本地音乐文件，支持播放列表管理、暂停/恢复、上一首/下一首',
    api: [
      { name: 'play', description: '播放当前曲目' },
      { name: 'pause', description: '暂停播放' },
      { name: 'next', description: '播放下一首' },
      { name: 'prev', description: '播放上一首' },
      { name: 'addToPlaylist', description: '添加文件到播放列表', parameters: { filePath: 'string' } },
      { name: 'getPlaylist', description: '获取当前播放列表' },
    ],
    dependencies: [],
    version: '1.0.0',
    componentEnv: 'pure-frontend',
    crossPlatform: true,
    desktopOnly: false,
  },
  {
    widgetType: 'focusTimer',
    displayName: '专注计时',
    description: '专注计时器，支持番茄钟模式（25分钟工作 + 5分钟休息循环）',
    api: [
      { name: 'start', description: '开始计时' },
      { name: 'pause', description: '暂停计时' },
      { name: 'reset', description: '重置计时器' },
      { name: 'setMode', description: '设置模式（pomodoro / shortBreak / longBreak）', parameters: { mode: 'string' } },
      { name: 'getStatus', description: '获取当前计时状态' },
    ],
    dependencies: [],
    version: '1.0.0',
    componentEnv: 'pure-frontend',
    crossPlatform: true,
    desktopOnly: false,
  },
  {
    widgetType: 'aiAssistant',
    displayName: 'AI 助手',
    description: 'AI 对话助手，支持多模型切换、上下文管理、角色配置',
    api: [
      { name: 'sendMessage', description: '向 AI 发送消息', parameters: { content: 'string' } },
      { name: 'switchModel', description: '切换 AI 模型', parameters: { modelId: 'string' } },
      { name: 'clearHistory', description: '清空对话历史' },
      { name: 'setRole', description: '设置 AI 角色', parameters: { role: 'string' } },
    ],
    dependencies: [],
    version: '1.0.0',
    componentEnv: 'pure-frontend',
    crossPlatform: true,
    desktopOnly: false,
  },
  {
    widgetType: 'latexQuiz',
    displayName: 'LaTeX 出题器',
    description: '基于 LaTeX 公式的出题与答题工具，支持数学公式渲染与自动判分',
    api: [
      { name: 'generateQuiz', description: '生成题目', parameters: { topic: 'string', difficulty: 'string' } },
      { name: 'submitAnswer', description: '提交答案', parameters: { answer: 'string' } },
      { name: 'getScore', description: '获取当前得分' },
    ],
    dependencies: [],
    version: '1.0.0',
    componentEnv: 'pure-frontend',
    crossPlatform: true,
    desktopOnly: false,
  },
  {
    widgetType: 'calculator',
    displayName: '科学计算器',
    description: '科学计算器，支持四则运算、三角函数、对数、幂运算、常数等',
    api: [
      { name: 'evaluate', description: '计算表达式', parameters: { expression: 'string' } },
      { name: 'clear', description: '清空当前输入' },
      { name: 'getHistory', description: '获取计算历史' },
    ],
    dependencies: [],
    version: '1.0.0',
    componentEnv: 'pure-frontend',
    crossPlatform: true,
    desktopOnly: false,
  },
  {
    widgetType: 'sudoku',
    displayName: '数独',
    description: '数独游戏，支持难度选择、提示、检查答案、自动求解',
    api: [
      { name: 'newGame', description: '开始新游戏', parameters: { difficulty: 'string' } },
      { name: 'setCell', description: '设置格子数字', parameters: { row: 'number', col: 'number', value: 'number' } },
      { name: 'hint', description: '获取提示' },
      { name: 'check', description: '检查当前答案是否正确' },
      { name: 'solve', description: '自动求解' },
    ],
    dependencies: [],
    version: '1.0.0',
    componentEnv: 'pure-frontend',
    crossPlatform: true,
    desktopOnly: false,
  },
  {
    widgetType: 'htmlCanvas',
    displayName: 'HTML 画布',
    description: 'HTML 画布组件，可自定义 HTML/CSS/JS 内容并实时渲染',
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
  {
    widgetType: 'webPage',
    displayName: '网页',
    description: '网页嵌入组件，可加载并显示外部网页，支持前进/后退/刷新',
    api: [
      { name: 'navigate', description: '导航到指定 URL', parameters: { url: 'string' } },
      { name: 'back', description: '后退' },
      { name: 'forward', description: '前进' },
      { name: 'reload', description: '刷新页面' },
      { name: 'getUrl', description: '获取当前 URL' },
    ],
    dependencies: [],
    version: '1.0.0',
    componentEnv: 'pure-frontend',
    crossPlatform: true,
    desktopOnly: true,
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
