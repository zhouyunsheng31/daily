# Living Dashboard 开发路线图（经4轮对抗审核终版）

> 生成时间：2026-05-31
> 项目路径：f:\allmylife\event
> 咨询模型：Gemini 3.5 Flash ✅ | GPT 5.5 ✅（4轮对抗审核） | Claude Opus 4.8 ❌（服务端返回空内容）

---

## 设计原则（15条红线）

1. **自由优先**：所有功能可选，用户可以只放一个时钟
2. **轻盈不变**：不引入后端、路由、认证、云同步、重型库
3. **画布为核**：不做传统App布局，始终是自由画布
4. **积木感**：一个组件=一个积木，不是一个子系统
5. **显式绑定**：联动是用户显式连接"A→B"，不是广播
6. **按需引入**：不提前建DB表，不提前做架构抽象
7. **生活平衡**：组件类型不能全是生产力工具
8. **数据安全**：备份优先于功能，导入导出必须安全
9. **数据治理**：区分组件私有状态和实体数据，实体数据必须有独立store
10. **MCP安全**：AI操作组件必须有最小权限模型+作用域
11. **删除组件不删除实体数据**：Widget是视图入口，实体store是长期数据
12. **聚合数据默认不持久化**：累计时长、连续天数等运行时计算，不缓存
13. **组件编辑态优先于画布拖拽**：编辑时暂停拖拽、提升层级、工具栏不被遮挡
14. **实体数据必须支持迁移**：实体store不能简单reset，必须有schemaVersion和migration
15. **MCP权限必须带作用域**：不只限制能做什么，也限制能对哪些panel/widget/type做

---

## 数据分类原则

### 组件私有状态 → widgetState
- UI设置、颜色、模式、当前输入草稿
- 不需要跨组件统计的数据
- 不需要稳定导入导出schema的数据

### 实体数据 → 独立 IndexedDB store
- 长期增长、时间序列、需要统计、需要跨组件引用、需要稳定导入导出schema

| 数据 | 存储位置 | 理由 |
|---|---|---|
| focusSessions | store | 时间序列，需要统计 |
| tasks | store | 需要跨组件引用和统计 |
| habits | store | 被checkins引用，需要稳定schema |
| habitCheckins | store | 时间序列 |
| moodEntries | store | 时间序列，需要趋势图 |
| calendarEvents | store | 需要跨组件引用 |
| 笔记内容 | widgetState | 暂不跨组件引用，未来需要时再迁移到notes store |

---

## Phase 0：安全与画布基础（3 周）

### 0.1 安全导出

```typescript
export async function exportAllData(): Promise<Blob>
// 读取所有 IndexedDB stores + widgetStates
// 序列化为 JSON: { version, schema, exportedAt, data }
// 导入文件 Blob 大小上限：50MB
// 字段白名单校验
// 超过50MB拒绝导出，提示用户删除大体积widgetState
```

### 0.2 安全导入（简单版）

```typescript
export async function importData(blob: Blob): Promise<void>
// 1. 检测是否有其他标签页打开 → 提示关闭
// 2. 强制用户先下载当前数据备份（导出）
// 3. 解析 JSON，校验 version + schema + 字段白名单
// 4. 暂停自动保存
// 5. 清空当前数据
// 6. 写入新数据
// 7. 整页 reload
// 失败时：提示用户使用之前下载的备份手动恢复
```

导入报告：
```typescript
interface ImportReport {
  imported: Record<string, number>
  skipped: Record<string, number>
  warnings: string[]
}
```

### 0.3 错误边界 + State Schema 校验

- ErrorBoundary 包裹每个 WidgetContainer
- 每个组件定义 stateSchema，加载时校验
- widgetState 不合法时重置为 defaultState，并保留 corrupted backup
- 实体 store 不合法时跳过该记录，生成导入报告

### 0.4 组件搜索

- 按名称/类型搜索画布上的组件
- 搜索结果点击后定位并居中显示
- 快捷键 Ctrl+F 触发

### 0.5 编辑态层级规则

当组件进入编辑模式：
1. 暂停该组件拖拽
2. 组件临时提升到最高 z-index 的编辑层
3. 编辑工具栏渲染到 portal 层，避免被裁切
4. Esc 退出编辑模式
5. 点击组件外部保存并退出

### 0.6 MCP 最小权限模型

```typescript
type McpPermission =
  | 'widget:create'
  | 'widget:move'
  | 'widget:resize'
  | 'widget:updateProps'
  | 'widget:delete'
  | 'widget:readState'
  | 'widget:writeState'

interface McpSession {
  permissions: McpPermission[]
  scope: {
    panelIds?: string[]
    widgetIds?: string[]
    widgetTypes?: string[]
    maxCreateCount?: number
    allowLockedWidgets: false
  }
  auditLog: Array<{
    id: string
    action: string
    target: string
    timestamp: number
    before?: unknown
    after?: unknown
  }>
}
```

默认权限：`['widget:create', 'widget:readState']`
默认 scope：`{ panelIds: [currentPanelId], allowLockedWidgets: false, maxCreateCount: 3 }`
禁止默认：`widget:delete`, `widget:writeState`
修改文本类组件内容前必须用户确认
批量操作必须确认
锁定组件 MCP 不可改
MCP 操作记录审计日志
MCP Undo：只撤销最近一次由MCP发起的单组件结构操作（create/move/resize/updateProps），不支持delete/writeState/批量

### 0.7 多标签页处理（简单版）

- 不做完整 leader election
- 每个 tab 都可保存，以 widgetId 为粒度使用 updatedAt 做 last-write-wins
- BroadcastChannel 用于提示"其他标签页有更新"
- 同一 widget 被两个 tab 修改时显示非阻塞提示
- 导入时检测其他标签页，提示关闭

### 0.8 自动保存策略

- 拖拽/resize：debounce 500ms
- 文本编辑：debounce 1000ms
- Timer 运行状态：不持久化每秒tick，只持久化 startedAt/mode/status
- 组件 state 最大尺寸：1MB（超过警告）
- 每个 panel 超过 50 个 widget 时提示性能警告（不强制阻止）

### 0.9 日期工具规则

- 所有生活统计使用用户本地时区
- 本周默认从周一开始
- 最近7天包含今天

---

## ⚠️ 执行铁律：每个 Phase 必须先写 Spec → 对抗审查 → 再开工

**此规则优先级高于一切。** 任何 Phase 在开始编码前，必须完成以下步骤：

1. **写 Spec**：针对当前 Phase 的每个任务，编写详细实施规格
2. **对抗审查**：将 Spec + 完整上下文做对抗审查
3. **审查通过才能编码**：不通过则修订 Spec 重新审查（新对话，不告诉它是第几次）
4. **编码完成后再次审查**：将实际代码对照 Spec 检查

**跳过此流程直接编码 = 违规。** 详见"开发工作流（强制）"章节。

---

## Phase 1：轻组件 + 独立 FocusTimer + 主题预设（2 周）

### 1.0 主题预设包

提供丰富的色彩主题预设，让画布不只是功能空间，更是视觉享受：

- 至少 6 套预设主题：森林（绿系）、海洋（蓝系）、日落（橙红系）、薰衣草（紫系）、极简暗黑、暖白日间
- 每套主题包含：渐变背景色、组件默认背景色、文字色、强调色、边框色
- 主题存储在 settings store，自动保存
- 组件颜色跟随主题（组件可通过 CSS 变量读取主题色）
- 用户可自定义任意主题色值
- 主题切换即时生效，无需刷新

### 1.1 Sticker 便签贴纸
- 一段文字 + 背景色（黄/粉/蓝/绿/紫）
- 可调大小，无格式/Markdown/文件管理

### 1.2 CountdownCard 倒数日
- 设置目标日期和标题
- 以本地时区自然日计算
- 目标日当天显示"就是今天"
- 过去显示"已过去 N 天"

### 1.3 QuoteCard 每日一句
- 内置50条名言
- seed = YYYY-MM-DD + widgetId（避免多实例重复）
- 点击换一条只改变当天offset，存入widgetState

### 1.4 FocusTimer（独立版）
- 番茄钟（25min+5min休息）/ 正计时 / 倒计时
- 可选手动填写标签（自由文本，不绑定任务）
- 专注结束自动记录到 focusSessions store
- **不绑定 TaskList，不做联动**

FocusTimer 运行时状态：
```typescript
interface FocusTimerRuntimeState {
  startedAt?: number
  pausedAt?: number
  accumulatedPausedMs: number
  mode: 'pomodoro' | 'countup' | 'countdown'
  targetMs?: number
  status: 'idle' | 'running' | 'paused'
}
```

异常退出规则：
- 页面刷新后通过 Date.now() - startedAt 恢复
- 暂停时间不计入 durationMs
- 用户手动结束且专注时长 >= 60秒才记录 focusSession
- 休息阶段不记录 focusSession
- 浏览器睡眠后回来通过时间差恢复

### 1.5 focusSessions store

```typescript
interface FocusSession {
  id: string
  panelId: string
  focusTimerWidgetId: string
  label?: string
  startedAt: number
  endedAt: number
  durationMs: number
  mode: 'pomodoro' | 'countup' | 'countdown'
  createdAt: number
}
```

### 1.6 tasks store

```typescript
interface Task {
  id: string
  panelId: string
  title: string
  status: 'todo' | 'doing' | 'done'
  priority: 'low' | 'medium' | 'high'
  dueAt?: number
  estimatedMinutes?: number
  createdAt: number
  updatedAt: number
}
```

注意：Task 是 panel 级实体，不属于 TaskList 组件。删除 TaskList 不删除 tasks。
注意：没有 actualMinutes 字段，累计专注时长从 focusSessions 聚合。

---

## Phase 2：TaskList + 手动关联（2 周）

### 2.1 TaskList 任务列表
- 创建/编辑/删除任务（通过 tasks store）
- 设置优先级、截止时间
- 任务状态切换
- 筛选：今天/本周/逾期/已完成
- 每个任务显示累计专注时长（从 focusSessions 按 taskId 聚合）

### 2.2 FocusTimer ↔ TaskList 手动关联

**不做自动联动，不做 pendingFocus，不做 store 通信。**

关联方式：
1. FocusTimer 结束时，**先写入 focusSession（无taskId）**
2. 弹出"记录到哪个任务？"，用户可选择：
   - 关联到任务（从当前面板的 tasks store 选择）
   - 仅保存为自由标签
   - 跳过
3. 用户选择后 update 该 focusSession 的 taskId 和 taskTitleSnapshot

这是最安全的关联方式：
- session 写入不依赖弹窗选择（防止关闭弹窗丢失记录）
- 用户在 FocusTimer 端主动选择
- 不需要跨组件 store 通信
- 不需要 EventBus
- 多实例无冲突

### 2.3 focusSessions schema 更新

```typescript
interface FocusSession {
  id: string
  panelId: string
  focusTimerWidgetId: string
  sourceTaskListWidgetId?: string
  taskId?: string
  taskTitleSnapshot?: string  // 防止任务删除后历史无法显示
  label?: string
  startedAt: number
  endedAt: number
  durationMs: number
  mode: 'pomodoro' | 'countup' | 'countdown'
  createdAt: number
}
```

---

## Phase 3：画布增强（2 周） ✅ 已完成

### 3.1 组件锁定 ✅
- 锁定组件位置和大小，防止误操作
- 锁定组件 MCP 不可改（白名单机制：除 widget:readState 外全部拒绝）
- 右键菜单锁定/解锁切换
- 锁定状态下关闭按钮灰色不可点
- 锁定状态下最小化和编辑仍可用
- 锁定视觉反馈：hover 时 cursor:default、右上角锁图标、虚线边框
- 锁定状态持久化，导出/导入包含 locked 字段

### 3.2 图层管理 ✅
- 调整组件前后层级（置顶/置底/上移/下移）
- WidgetInstance 增加 locked 字段，WidgetPosition 已有 zIndex
- 新建组件 zIndex = 当前 panel 最大 zIndex + 1
- 右键菜单 + 快捷键（] / [ / Ctrl+] / Ctrl+[）
- lastActiveWidgetId 追踪最近操作组件
- zIndex 压缩：span > 10000 时自动重排

### 3.3 框选移动 ✅
- 左键拖拽空白区域框选多个组件
- 画布平移改为中键/Space+左键
- 批量移动选中组件（锁定组件保持原位）
- 选中组件蓝色 outline，锁定组件灰色 outline
- 框选面积 < 4px² 不触发
- 面板切换时清空选择
- Escape 取消选择

### 3.4 小地图 ⏳ 可选，已后移
- 画布右下角缩略图，点击可快速跳转
- 如果时间不够可后移

---

## Phase 4：笔记整理（1 周） ✅ 已完成

### 4.1 编辑器定位 ✅

| 组件 | 定位 | 编辑模式 | 默认状态 | 场景 |
|---|---|---|---|---|
| Sticker | 短纯文本便签，不支持 Markdown | 点击编辑纯文本 | 显示内容 | 快速记一句话 |
| RichText | 视觉展示文本块，强调样式设置 | 点击编辑 Markdown | 预览模式 | 标题、说明、装饰文本 |
| MarkdownEditor | 编辑工作台，编辑优先 | 左右分栏实时预览 | 编辑模式 | 较长 Markdown 草稿、技术笔记 |
| NoteBlock | 预览优先的轻量 Markdown 文本卡片 | 单 textarea 编辑，无实时预览 | 预览模式 | 画布上展示一段中短笔记/摘录 |

NoteBlock 存在理由：
- RichText 强调样式自定义（fontSize/textColor/bgOpacity），NoteBlock 不提供这些设置
- MarkdownEditor 是编辑工作台（双栏实时预览），NoteBlock 是展示卡片（编辑时只显示 textarea，预览时渲染 Markdown）
- NoteBlock 比 MarkdownEditor 更轻量紧凑，适合画布上放置多个笔记卡片

NoteBlock 数据属性声明：
- 内容属于 widget 私有状态，不属于实体数据
- 删除 NoteBlock 组件会删除其中内容
- 不承诺跨组件引用、统计、搜索、迁移或长期文档管理能力
- 未来如需跨组件引用笔记内容，必须迁移到独立 notes store（本阶段不做）

NoteBlock 和 MarkdownEditor 的内容暂不参与全局搜索、统计、引用、标签和反链。一旦支持这些能力，笔记内容必须迁移到 notes store。

### 4.2 NoteBlock ✅
- 一个 NoteBlock = 一个画布私有 Markdown 文本块
- 编辑模式只显示 textarea（无实时预览），保存后预览模式渲染 Markdown
- 默认预览模式，点击进入编辑
- 不内置文档管理器
- 数据存 widgetState（仅 text: string，不持久化 mode）
- 专属 safeMarkdownRender 函数（先转义 &,<,> 再替换 Markdown 语法）
- 工具栏：B/I/H/•/</>/👁，所有按钮 onMouseDown preventDefault
- debounce 400ms 保存，退出时 flush 保证不丢数据
- onBlur relatedTarget 检测，Esc 保存退出
- normalizeNoteBlockState 归一化（防止导入损坏 state）

### 4.3 PdfViewer 小升级 ✅
- 使用 pdfjs-dist v5.7.284 官方 TextLayer API 叠加文本层
- 文本选择后通过 navigator.clipboard.writeText() 复制到剪贴板
- 复制按钮只复制 PdfViewer 内选区（selectionchange 监听）
- 文本选择时暂停画布拖拽（全局 pointerup/pointercancel/blur 监听）
- 完整竞态控制：renderIdRef + cancel RenderTask + cancel TextLayer + loadIdRef
- 不做自动摘录

---

## Phase 5：轻量统计 + 生活增强（2-3 周） ✅ 已完成

### 5.1 StatsPanel Lite ✅
- 今日/本周专注总时长
- 番茄钟数量
- 最近7天专注柱状图（纯SVG）
- 数据来源：只从 focusSessions store 读取
- **不统计任务完成数**（暂不做）
- 初版只支持当前 panel，未来可选 all panels
- focusSessionsRevision 内存态刷新机制

### 5.2 HabitTracker 习惯打卡 ✅
- 创建习惯、每日打卡
- 连续天数统计
- 简易热力图（纯CSS grid，自然周布局）
- 归档习惯（不删除数据）
- 编辑态阻止画布拖拽

数据存储：
```typescript
interface Habit {
  id: string
  panelId: string
  title: string
  color?: string
  archivedAt?: number
  createdAt: number
  updatedAt: number
  schemaVersion: 1
}

interface HabitCheckin {
  id: string
  panelId: string
  habitId: string
  date: string  // YYYY-MM-DD
  createdAt: number
  schemaVersion: 1
}
```

### 5.3 MoodTracker 心情记录 ✅
- 快速选择心情（5个等级）
- 每日一条，可追加文字
- 心情趋势（纯SVG折线，无数据天断开）
- 备注onBlur保存，无MoodEntry时禁用备注

```typescript
interface MoodEntry {
  id: string
  panelId: string
  level: 1 | 2 | 3 | 4 | 5
  note?: string
  date: string  // YYYY-MM-DD
  createdAt: number
  schemaVersion: 1
}
```

### 5.4 BreathingWidget 呼吸练习 ✅
- 呼吸引导动画（吸气4s→屏息4s→呼气4s）
- 可选时长（3min/5min/10min）
- 纯CSS动画，零联动
- 零实体数据，运行态不持久化

---

## Phase 6：工作增强（1-2 周） ✅ 已完成

### 6.1 TaskList 看板视图 ✅
- 在 TaskList 中增加"看板视图"模式
- 与列表视图共享 tasks store 数据
- 三列布局：待办/进行中/已完成
- 任务卡片左侧优先级色条
- 看板添加状态按列隔离
- 视图模式持久化到 widgetState

### 6.2 AgendaList 轻量日程 ✅
- 显示今日/本周日程列表
- 显示任务截止日期（从 tasks store 读取，**只读**）
- 创建简单日程
- 严格 datetime-local 解析 + roundtrip 校验

```typescript
interface CalendarEvent {
  id: string
  panelId: string
  title: string
  startsAt: number
  endsAt?: number
  note?: string
  createdAt: number
  updatedAt: number
}
```

明确不做：重复事件、邀请、外部同步、时区复杂处理、多日程视图、拖拽日历

---

## 远期探索（不承诺，不做排期）

通用EventBus、Repository层、统一注册表重构、WidgetCapabilities完整模型、完整Calendar、ResourceLibrary、AutomationRules、MCP读写实体数据、DailyReview、TodayPanel、MusicPlayer联动、外部日历同步、RSSReader、WeatherWidget、云同步、notes store（笔记跨组件引用时再迁移）

---

## 不做的事（20条排除清单）

1. 不引入后端服务器
2. 不引入用户认证
3. 不引入云同步
4. 不引入路由
5. 不引入传统App布局
6. 不做社交功能
7. 不做移动端适配
8. 不引入重型图表库
9. 不删除旧组件
10. 不做通用EventBus
11. 不做完整Repository层
12. 不做完整Calendar
13. 不做独立Kanban
14. 不做MusicPlayer联动
15. 不做DailyReview
16. 不做TodayPanel
17. 不做NoteEditor多文档
18. 不做PDF自动摘录
19. 不允许AI默认删除组件或写入组件state
20. 不提前建未使用的IndexedDB store

---

## MVP 定义与验收标准

### MVP A：安全与画布基础（3周）
- 导出备份 + 错误边界 + State校验 + 组件搜索 + 编辑态层级规则 + MCP最小权限 + 多标签页简单处理 + 自动保存策略

验收：
1. 任意 widget render 抛错，不影响其他 widget
2. 旧版本非法 widgetState 被重置，不导致白屏
3. 导出文件可重新导入到空环境
4. 导入错误 JSON 被拒绝，不污染当前数据
5. Ctrl+F 可以定位到画布外 widget
6. 多标签页打开时导入会阻止或警告
7. 拖拽20个 widget 后刷新位置不丢失

### MVP B：轻组件 + 独立FocusTimer（2周）
- MVP A + Sticker + CountdownCard + QuoteCard + FocusTimer（独立版）+ focusSessions store + tasks store

验收：
1. 单 panel 50个轻组件仍可拖拽
2. FocusTimer 页面刷新后能恢复运行状态
3. 完成一次专注后写入 focusSessions
4. 小于60秒的测试计时不记录

### MVP C：TaskList + 手动关联（2周）
- MVP B + TaskList + FocusTimer结束后手动选择任务关联

验收：
1. 创建任务后刷新不丢失
2. 专注结束后可选择任务关联
3. 删除任务后历史 focusSession 仍显示 taskTitleSnapshot
4. TaskList 累计时长由 focusSessions 聚合，不依赖缓存字段

### MVP D：画布增强 + 笔记（3周）
- MVP C + 组件锁定 + 图层管理 + 框选移动 + NoteBlock + PdfViewer小升级

### MVP E：统计 + 生活（2-3周）
- MVP D + StatsPanel Lite + HabitTracker + MoodTracker + BreathingWidget

### MVP F：工作增强（1-2周）
- MVP E + TaskList看板视图 + AgendaList

---

## 总新增/改造清单

| Phase | 组件/功能 | 类型 | 分类 |
|---|---|---|---|
| 0 | 安全导出/导入 | 基础设施 | 系统 |
| 0 | 错误边界+State校验 | 基础设施 | 系统 |
| 0 | 组件搜索 | 基础设施 | 画布 |
| 0 | 编辑态层级规则 | 基础设施 | 画布 |
| 0 | MCP最小权限+作用域 | 基础设施 | 安全 |
| 0 | 多标签页简单处理 | 基础设施 | 系统 |
| 0 | 自动保存策略 | 基础设施 | 系统 |
| 1 | 主题预设包 | 新增 | 生活/视觉 |
| 1 | Sticker | 新增 | 生活/装饰 |
| 1 | CountdownCard | 新增 | 生活 |
| 1 | QuoteCard | 新增 | 生活/装饰 |
| 1 | FocusTimer | 新增 | 工作 |
| 1 | focusSessions store | 基础设施 | 数据 |
| 1 | tasks store | 基础设施 | 数据 |
| 2 | TaskList | 新增 | 工作 |
| 2 | FocusTimer手动关联 | 改造 | 联动 |
| 3 | 组件锁定 | 基础设施 | 画布 |
| 3 | 图层管理 | 基础设施 | 画布 |
| 3 | 框选移动 | 基础设施 | 画布 |
| 4 | NoteBlock | 新增 | 学习 |
| 4 | PdfViewer小升级 | 改造 | 学习 |
| 5 | StatsPanel Lite | 新增 | 数据 |
| 5 | HabitTracker | 新增 | 生活 |
| 5 | MoodTracker | 新增 | 生活/放松 |
| 5 | BreathingWidget | 新增 | 放松 |
| 6 | TaskList看板视图 | 改造 | 工作 |
| 6 | AgendaList | 新增 | 工作/生活 |

组件分类占比：
- 生活/放松/装饰：Sticker、CountdownCard、QuoteCard、HabitTracker、MoodTracker、BreathingWidget = 6
- 生产力：TaskList、FocusTimer、StatsPanel、AgendaList = 4
- 学习：NoteBlock、PdfViewer = 2
- 系统/画布：搜索、锁定、图层、框选、备份、MCP权限 = 6

**生活类(6) > 生产力类(4)，维持产品定位平衡。**

---

## IndexedDB 按需演进

Phase 0: 无新store
Phase 1: focusSessions, tasks
Phase 5: habits, habitCheckins, moodEntries
Phase 6: calendarEvents

每个 store 在对应 Phase 实现时才创建。实体 store 必须有 schemaVersion 字段。

---

## 联动策略

当前唯一联动：FocusTimer结束后手动选择任务关联。
不做自动联动、不做广播、不做pendingFocus。
未来联动扩展条件：当联动场景超过3个时才考虑抽象EventBus。

---

## 删除策略

- 删除组件默认不删除实体 store 数据
- 删除面板时提示是否同时删除该 panel 下实体数据
- FocusTimer 删除后，其历史 focusSessions 保留
- TaskList 删除后，tasks 保留
- MoodTracker 删除后，moodEntries 保留
- HabitTracker 删除后，habits 和 habitCheckins 保留

---

## 实体数据迁移策略

导入或加载实体数据时：
1. 检查 schemaVersion
2. 如果是旧版本，执行已知 migration
3. 如果未知版本，拒绝导入
4. 如果单条记录不合法，跳过该记录并生成导入报告

---

## 排期总览

| Phase | 建议周期 |
|---|---|
| Phase 0 | 3 周 |
| Phase 1 | 2 周 |
| Phase 2 | 2 周 |
| Phase 3 | 2 周 |
| Phase 4 | 1 周 |
| Phase 5 | 2-3 周 |
| Phase 6 | 1-2 周 |
| **总计** | **13-15 周** |

如果需要压缩到12周，可砍：小地图、MCP undo、框选移动后移、Agenda提醒后移。

---

## 开发工作流（强制）

### 参谋：chatst GPT 5.5

每个 Phase 开始实施前，必须使用 chatst（`F:\allmylife\chatst\chat.py`，模型 `gpt-5.5`）作为外部参谋。具体流程：

### 1. 行动前先写 Spec

针对当前 Phase 的每个具体任务，先编写详细的实施 Spec，包括：
- 要改哪些文件、新增哪些文件
- 具体的接口定义、数据结构
- 与现有代码的交互方式
- 边界条件和异常处理
- 验收标准

### 2. Spec 发给 GPT 5.5 做对抗审查

将 Spec + 完整项目上下文发给 chatst 的 GPT 5.5，要求它以最严格、对抗性的立场审查：
- 不放水，不"基本通过"，要么完美要么不通过
- 特别关注：是否违反15条设计原则红线、是否喧宾夺主破坏自由画布、是否过度工程化、是否有数据安全风险
- 审查不通过就修订 Spec 重新提交（每次都是新对话，不告诉它是第几次审查）
- 直到审查通过才能开始编码

### 3. 任务完成后执行对抗审查

每个 Spec 对应的任务完成后（不是整个 Phase，而是单个 Spec 的实现），必须：
- 将实际代码和实现结果发给 GPT 5.5
- 要求它对照 Spec 逐项检查，找出偏差、遗漏、bug
- 审查不通过则修复后重新审查
- 审查通过后才能进入下一个 Spec

### 发给 GPT 5.5 的上下文清单（每次审查必须包含）

GPT 5.5 只能根据收到的文字做判断，无法主动查看项目文件。因此每次发送审查请求时，必须包含以下内容：

#### A. 项目全局上下文（每次必发）

| 内容 | 说明 | 来源 |
|---|---|---|
| 项目目的 | "学习/工作/放松一体化的自由画布式生活管理面板" | roadmap.md 顶部 |
| 15条设计原则红线 | 完整列出，让GPT以此为审查基准 | roadmap.md 设计原则章节 |
| 20条排除清单 | 完整列出，防止Spec越界 | roadmap.md 不做的事章节 |
| 当前已有组件清单 | Clock/RichText/PdfViewer/MusicPlayer/MarkdownEditor 及各自功能 | AGENT.md |
| 技术栈 | React 19 + TS 6 + Vite 8 + Zustand 5 + Tailwind v4 + IndexedDB + MCP | AGENT.md |
| 核心优势 | 自由画布、多面板、自动保存、MCP动态组件、轻盈感 | AGENT.md |
| 数据分类原则 | widgetState vs 独立store的判断标准 | roadmap.md 数据分类章节 |
| 联动策略 | 当前唯一联动：FocusTimer结束后手动选择任务关联 | roadmap.md 联动策略章节 |
| 删除策略 | 删除组件不删除实体数据 | roadmap.md 删除策略章节 |

#### B. 当前 Phase 上下文（每次必发）

| 内容 | 说明 |
|---|---|
| 当前Phase编号和目标 | 如"Phase 0：安全与画布基础" |
| 当前Phase的完整规划 | roadmap.md 中对应Phase的所有内容（含代码接口定义） |
| 本Phase新增的IndexedDB store | 如有，包含完整schema |
| 本Phase的MVP验收标准 | 完整列出 |

#### C. Spec 相关上下文（Spec审查时必发）

| 内容 | 说明 |
|---|---|
| Spec全文 | 完整的实施规格说明 |
| Spec涉及的现有文件内容 | 被修改的文件的当前完整代码 |
| Spec涉及的新文件 | 如有参考模板，附上相似组件的代码 |
| Spec涉及的数据结构 | 相关的TypeScript类型定义 |
| Spec与现有代码的交互点 | 哪些现有函数/接口会被调用或修改 |

#### D. 实现审查时额外上下文（实现审查时必发）

| 内容 | 说明 |
|---|---|
| A+B 全部内容 | 同上 |
| Spec全文 | 同上 |
| 实际实现的完整代码 | 新增/修改的所有文件内容 |
| 实现与Spec的对照说明 | 逐项说明每个Spec要求的实现情况 |
| 测试结果 | 如有测试，附上测试输出 |
| 已知偏差 | 主动列出与Spec不符的地方及原因 |

#### 上下文精简原则

- 代码文件只发与当前Spec相关的部分，不发送无关文件
- 如果文件过长，只发送被修改的函数/类及其上下文（前后各20行）
- 类型定义发完整，不截断
- 不要省略任何错误处理逻辑
- 不要省略任何边界条件

### 流程图

```
编写 Spec → GPT 5.5 对抗审查 Spec → 审查通过？
                                        ↓ 否 → 修订 Spec → 重新审查（新对话）
                                        ↓ 是 → 编码实现 → GPT 5.5 对抗审查实现 → 审查通过？
                                                                                    ↓ 否 → 修复 → 重新审查（新对话）
                                                                                    ↓ 是 → 完成，进入下一个 Spec
```

---

## 审核历程

| 轮次 | 结论 | 主要问题 |
|---|---|---|
| 第1轮 | ❌ 不通过 | MVP过大、EventBus过度工程化、EntityStore不必要、NoteEditor多文档变笔记应用、MusicPlayer联动伪需求 |
| 第2轮 | ❌ 不通过 | Capability模型装饰化、IndexedDB提前膨胀、联动仍然过多、组件设置污染UI、14组件破坏焦点、缺画布复杂度控制 |
| 第3轮 | ❌ 不通过 | MCP安全不足、导入原子性不成立、多标签页缺失、自动保存风暴、编辑器重叠未解决、数据一致性不清 |
| 第4轮 | ✅ 有条件通过 | 需收紧边界：拆分Phase0、删除actualMinutes缓存、FocusTimer先写session再选任务、补充删除策略、Habit加store、MCP加scope、leader election降级、编辑态置顶、实体迁移策略 |
