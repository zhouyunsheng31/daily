// ============================================================================
// Phase S4：AI 工具元数据（供 tool management API + piBridge 过滤使用）
// 工具执行定义在 piBridge.ts 的 customTools 数组中，本文件只提供管理元数据
// Phase 3：新增 filesystem 工具分类 + 7 个文件系统工具（默认禁用，spec §7）
// ============================================================================

export type ToolCategory = 'widget' | 'storage' | 'browser' | 'interaction' | 'search' | 'system' | 'filesystem'

export interface AiToolInfo {
  /** 工具名（与 piBridge.ts customTools[].name 一致） */
  name: string
  /** 显示标签 */
  label: string
  /** 简短描述（中文） */
  description: string
  /** 工具分类 */
  category: ToolCategory
  /** 是否允许用户禁用（ask_user 是系统工具，不允许禁用） */
  canDisable: boolean
  /**
   * 默认启用状态（Phase 3：文件系统工具默认禁用，需用户手动开启）
   * - true：未在 tool_settings 表中记录时视为启用（现有 30 个工具）
   * - false：未在 tool_settings 表中记录时视为禁用（7 个文件系统工具）
   */
  defaultEnabled: boolean
}

/**
 * AI 工具的元数据定义
 * 顺序与 piBridge.ts customTools 数组保持一致
 * （Phase 14 新增 query_capabilities 系统工具，从 29 升至 30）
 * （Phase 3 新增 7 个文件系统工具，从 30 升至 37，默认禁用，spec §7）
 * （Phase 5 新增 5 个背景/弹出层工具，从 37 升至 42，spec §3.2/§3.3）
 * （Phase 5 §3.2 新增 upload_background_image，从 42 升至 43）
 */
export const AI_TOOL_DEFINITIONS: AiToolInfo[] = [
  // widget 工具（4 个）
  { name: 'create_html_widget', label: 'Create HTML Widget', description: '在画布上创建 HTML 网页组件', category: 'widget', canDisable: true, defaultEnabled: true },
  { name: 'update_html_widget', label: 'Update HTML Widget', description: '更新现有 HTML 网页组件', category: 'widget', canDisable: true, defaultEnabled: true },
  // Phase 2 决策38/39：mini/icon 档 AI 自定义 HTML 工具
  { name: 'set_widget_mini_html', label: 'Set Widget Mini HTML', description: '为 widget 设置 mini 档（精简档）的精简 HTML 形态（决策38，非简单缩放）', category: 'widget', canDisable: true, defaultEnabled: true },
  { name: 'set_widget_icon_html', label: 'Set Widget Icon HTML', description: '为 widget 设置 icon 档（图标档）的 HTML 图标（决策39，圆形/任意形状）', category: 'widget', canDisable: true, defaultEnabled: true },
  { name: 'delete_html_widget', label: 'Delete HTML Widget', description: '删除 HTML 网页组件', category: 'widget', canDisable: true, defaultEnabled: true },
  { name: 'list_widgets', label: 'List Widgets', description: '列出画布上所有组件', category: 'widget', canDisable: true, defaultEnabled: true },
  // Phase 5：背景层控制工具（4 个，spec §3.2）— upload_background_image 新增（AI 上传二进制图片当背景）
  { name: 'set_background', label: '设置背景', description: '设置画布背景层（纯色/渐变/图片），不参与相册缩放', category: 'widget', canDisable: true, defaultEnabled: true },
  { name: 'upload_background_image', label: '上传背景图片', description: 'AI 上传 base64 二进制图片作为画布背景（保存到服务端，自动设置 background）', category: 'widget', canDisable: true, defaultEnabled: true },
  { name: 'add_effect', label: '添加背景特效', description: '在背景层添加视觉特效（rain/snow/particles/stars）', category: 'widget', canDisable: true, defaultEnabled: true },
  { name: 'place_basic_component', label: '放置背景基础组件', description: '在背景层放置基础组件（clock/text/image），固定视口不随画布缩放', category: 'widget', canDisable: true, defaultEnabled: true },
  // storage 工具（2 个）
  { name: 'storage_read', label: 'Storage Read', description: '从统一 KV 存储读取数据', category: 'storage', canDisable: true, defaultEnabled: true },
  { name: 'storage_write', label: 'Storage Write', description: '写入数据到统一 KV 存储', category: 'storage', canDisable: true, defaultEnabled: true },
  // browser 工具（18 个）
  { name: 'browser_eval', label: '浏览器执行脚本', description: '在活跃网页组件中执行 JS 脚本', category: 'browser', canDisable: true, defaultEnabled: true },
  { name: 'browser_get_dom', label: '浏览器获取 DOM', description: '获取网页组件 DOM 内容', category: 'browser', canDisable: true, defaultEnabled: true },
  { name: 'browser_click', label: '浏览器点击', description: '点击网页组件中的元素', category: 'browser', canDisable: true, defaultEnabled: true },
  { name: 'browser_input', label: '浏览器输入', description: '在网页组件输入框输入文本', category: 'browser', canDisable: true, defaultEnabled: true },
  { name: 'browser_scroll', label: '浏览器滚动', description: '滚动网页组件到指定位置', category: 'browser', canDisable: true, defaultEnabled: true },
  { name: 'browser_wait_for', label: '浏览器等待', description: '等待条件满足', category: 'browser', canDisable: true, defaultEnabled: true },
  { name: 'browser_screenshot', label: '浏览器截图', description: '截取网页组件可视区域', category: 'browser', canDisable: true, defaultEnabled: true },
  { name: 'browser_navigate', label: '浏览器导航', description: '导航到指定 URL', category: 'browser', canDisable: true, defaultEnabled: true },
  { name: 'browser_get_url', label: '浏览器获取 URL', description: '获取当前 URL', category: 'browser', canDisable: true, defaultEnabled: true },
  { name: 'browser_get_title', label: '浏览器获取标题', description: '获取页面标题', category: 'browser', canDisable: true, defaultEnabled: true },
  { name: 'browser_back', label: '浏览器后退', description: '后退到上一页', category: 'browser', canDisable: true, defaultEnabled: true },
  { name: 'browser_forward', label: '浏览器前进', description: '前进到下一页', category: 'browser', canDisable: true, defaultEnabled: true },
  { name: 'browser_reload', label: '浏览器刷新', description: '刷新当前页面', category: 'browser', canDisable: true, defaultEnabled: true },
  { name: 'browser_get_cookie', label: '浏览器获取 Cookie', description: '获取网页组件 Cookie', category: 'browser', canDisable: true, defaultEnabled: true },
  { name: 'browser_set_cookie', label: '浏览器设置 Cookie', description: '设置网页组件 Cookie', category: 'browser', canDisable: true, defaultEnabled: true },
  { name: 'browser_open', label: '浏览器打开', description: '打开新网页组件', category: 'browser', canDisable: true, defaultEnabled: true },
  { name: 'browser_switch_tab', label: '浏览器切换标签', description: '切换到指定网页组件', category: 'browser', canDisable: true, defaultEnabled: true },
  { name: 'browser_list_tabs', label: '浏览器列出标签', description: '列出所有网页组件', category: 'browser', canDisable: true, defaultEnabled: true },
  // interaction 工具（1 个，系统级，不允许禁用）
  { name: 'ask_user', label: 'Ask User', description: '主动向用户提问（系统工具，不可禁用）', category: 'interaction', canDisable: false, defaultEnabled: true },
  // Phase 5：弹出层触发工具（2 个，spec §3.3）
  { name: 'show_popup', label: '显示弹出层', description: '在弹出层显示内容（登录窗口/引导/广告/自定义HTML），可叠加', category: 'interaction', canDisable: true, defaultEnabled: true },
  { name: 'dismiss_popup', label: '关闭弹出层', description: '关闭指定弹出层或所有弹出层', category: 'interaction', canDisable: true, defaultEnabled: true },
  // search 工具（6 个，Phase S9 + 2026-08-05 秘塔 reader/QA）
  { name: 'local_search', label: '本地搜索', description: '检索本端已同步数据（面板/笔记/任务/书签等）', category: 'search', canDisable: true, defaultEnabled: true },
  { name: 'web_search', label: '网页搜索', description: '联网搜索网页/学术/图片（秘塔 AI 搜索，metaso.cn）', category: 'search', canDisable: true, defaultEnabled: true },
  { name: 'read_webpage', label: '读取网页', description: '读取指定网页全文（markdown，含链接，可逐级深入打开）', category: 'search', canDisable: true, defaultEnabled: true },
  { name: 'academic_search', label: '学术搜索', description: '检索 ArXiv 学术论文（按提交日期倒序，支持开放获取 PDF，无需 API Key）', category: 'search', canDisable: true, defaultEnabled: true },
  { name: 'github_search', label: 'GitHub 搜索', description: 'GitHub 仓库/代码/用户/Issue 搜索 + 文件/Release/整仓 zip 下载（token 可选，无 token 60 req/hour，search_code 需 token）', category: 'search', canDisable: true, defaultEnabled: true },
  // system 工具（1 个，Phase 14.4，系统级，不允许禁用）
  { name: 'query_capabilities', label: '查询组件能力', description: '查询所有组件的能力声明（widgetType / displayName / description / api / dependencies）', category: 'system', canDisable: false, defaultEnabled: true },
  // filesystem 工具（7 个，Phase 3，spec §7）
  // PI 原本的文件系统工具，在服务端 Node.js 沙箱内运行，默认关闭，用户手动开启
  { name: 'read', label: '读取文件', description: '在服务端沙箱内读取文件内容（仅限沙箱目录）', category: 'filesystem', canDisable: true, defaultEnabled: false },
  { name: 'write', label: '写入文件', description: '在服务端沙箱内写入文件（仅限沙箱目录，覆盖已存在文件）', category: 'filesystem', canDisable: true, defaultEnabled: false },
  { name: 'edit', label: '编辑文件', description: '在服务端沙箱内通过字符串替换编辑文件（仅限沙箱目录）', category: 'filesystem', canDisable: true, defaultEnabled: false },
  { name: 'bash', label: '执行命令', description: '在服务端沙箱内执行 shell 命令（白名单+超时+工作目录限制）', category: 'filesystem', canDisable: true, defaultEnabled: false },
  { name: 'grep', label: '搜索文件内容', description: '在服务端沙箱内搜索文件内容（正则匹配）', category: 'filesystem', canDisable: true, defaultEnabled: false },
  { name: 'find', label: '查找文件', description: '在服务端沙箱内查找文件（按名称模式匹配）', category: 'filesystem', canDisable: true, defaultEnabled: false },
  { name: 'ls', label: '列出目录', description: '在服务端沙箱内列出目录内容', category: 'filesystem', canDisable: true, defaultEnabled: false },
]

/**
 * Phase 3：7 个文件系统工具名集合（spec §7）
 * 用于 /api/tools/settings 端点返回文件系统工具的开关状态
 */
export const FILE_SYSTEM_TOOL_NAMES: Set<string> = new Set([
  'read', 'write', 'edit', 'bash', 'grep', 'find', 'ls',
])

/**
 * Phase 3：获取工具的默认启用状态
 * 未在 tool_settings 表中记录的工具，按此默认值决定是否启用
 */
export function getToolDefaultEnabled(name: string): boolean {
  return AI_TOOL_MAP.get(name)?.defaultEnabled ?? true
}

/** 工具名 → 元数据 映射（快速查找） */
export const AI_TOOL_MAP: Map<string, AiToolInfo> = new Map(
  AI_TOOL_DEFINITIONS.map(t => [t.name, t])
)

/** 所有可禁用工具的名称集合 */
export const DISABLEABLE_TOOL_NAMES: Set<string> = new Set(
  AI_TOOL_DEFINITIONS.filter(t => t.canDisable).map(t => t.name)
)

/** 工具名是否合法 */
export function isValidToolName(name: string): boolean {
  return AI_TOOL_MAP.has(name)
}
