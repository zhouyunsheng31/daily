# Living Dashboard 开发路线图 v3

> 生成日期：2026-06-03
> 综合 Gemini 3.5 Flash、GPT 5.5、Grok 4.3 三模型建议 + 用户需求 + 对抗审核反馈（5轮）

---

## 一、项目定位

**Living Dashboard** 是一个**以 AI 为主的自由画布式个人生活管理面板**，服务于学习、工作、放松一体化场景。

核心特质（按优先级排序）：
1. **AI 为核心** — AI 是项目的主轴，能感知、理解、操作画布上所有组件的数据，能创建和使用组件，具备完整的上下文管理和记忆能力。AI 不是辅助工具，而是用户与画布交互的主要方式之一
2. **自由画布** — 无限平移、缩放、组件自由拖拽和调整大小，不受网格约束。画布是 AI 和组件的承载空间
3. **本地优先** — 所有数据通过 IndexedDB 持久化，关闭浏览器后可恢复
4. **组件生态** — 丰富的内置组件覆盖学习、工作、生活、娱乐场景，AI 可动态创建新组件
5. **多面板管理** — 支持创建多个面板，每个面板有独立的组件布局

---

## 二、项目现状

### 技术栈
- React 19 + TypeScript + Vite
- Zustand（状态管理）
- Tailwind CSS v4
- IndexedDB（idb 持久化）
- MCP Server（组件动态创建，长期扩展用，MVP 阶段不依赖）

### 已有 16 个组件

| # | 类型 | 名称 | 功能 | 状态 |
|---|------|------|------|------|
| 1 | richText | 文本框 | 富文本编辑 | 正常 |
| 2 | clock | 时钟 | 时钟/秒表/计时器 | 正常 |
| 3 | pdfViewer | PDF 阅读器 | PDF 查看 | 正常 |
| 4 | musicPlayer | 音乐播放器 | 音乐播放+歌单 | 正常 |
| 5 | markdownEditor | Markdown 笔记 | MD 编辑 | 正常 |
| 6 | sticker | 便签贴纸 | 快速便签 | 正常 |
| 7 | countdownCard | 倒数日 | 倒计时 | 正常 |
| 8 | quoteCard | 每日一句 | 名言展示 | 正常 |
| 9 | focusTimer | 专注计时 | 番茄钟 | 正常 |
| 10 | taskList | 任务列表 | 任务管理 | 正常 |
| 11 | noteBlock | 笔记卡片 | Markdown 笔记卡片 | **不可用** |
| 12 | statsPanel | 专注统计 | 数据统计 | 正常 |
| 13 | habitTracker | 习惯打卡 | 习惯追踪 | 正常 |
| 14 | moodTracker | 心情记录 | 心情日志 | 正常 |
| 15 | breathingWidget | 呼吸练习 | 呼吸引导 | 正常 |
| 16 | agendaList | 轻量日程 | 日程管理 | 正常 |

### 数据库结构（IndexedDB v2）

现有存储表：panels, widgetRecords, widgetStates, tasks, calendarEvents, focusSessions, habits, habitCheckins, moodEntries, playlists, settings, meta, dynamic-widgets

### 已知问题

1. **笔记卡片(noteBlock)无法使用** — builtIn.ts 中 defaultState 是 `{text:''}`，但 widgetDefinitions.ts 中定义的 state 是 `{content:'', color:'#fef08a', schemaVersion:1}`，字段不匹配导致渲染异常
2. **组件列表无法滚动** — AddWidgetMenu 的 CSS 缺少 max-height 和 overflow-y:auto，16 个组件超出屏幕无法全部看到
3. **没有 AI 组件** — AI 应能：获取组件信息（音乐播放器歌单/歌曲、日记/笔记内容、待办、存钱罐目标等）、调用工具操作数据、完整上下文管理和记忆能力、创建和使用组件
4. **不支持自由画画** — 画布上没有画笔/绘图功能
5. **不支持组件间搭线** — 无法在组件之间创建连接/数据流
6. **透明组件边框无角标** — 组件设为透明时看不到边界，四个角应该有视觉指示
7. **按键交互不舒服** — 鼠标操作体验差（拖拽、点击区域等）
8. **没有用户手册** — 缺少使用说明文档
9. **缺少学习类组件** — 没有 LaTeX 渲染出题组件、计算器、百词斩、数独游戏
10. **缺少核心个人数据组件** — 没有日记组件、随身记组件、存钱罐组件

---

## 三、设计原则

1. **AI 为主** — AI 是用户与画布交互的主要方式，不是附属功能。AI 能感知所有组件、操作数据、创建组件、记忆上下文
2. **自由画布是承载** — 画布是 AI 和组件的活动空间，任何新增功能不得破坏自由拖拽、无限平移缩放的核心体验
3. **组件即岛屿** — 每个组件是独立的功能单元，有自己的状态和生命周期，不依赖其他组件即可运行
4. **AI 是增强而非替代** — AI 辅助用户操作，不取代用户的控制权；写操作需经用户确认
5. **本地优先** — 所有数据存本地，AI 组件也优先本地推理，不强制云服务
6. **渐进式复杂度** — 新用户看到简洁画布，高级功能按需解锁
7. **不喧宾夺主** — 新功能都是画布上的可选工具，不改变画布本身的工作方式。AI 虽是核心，但以组件形式存在，新建面板默认包含但用户可删除/隐藏/最小化
8. **一致性** — 所有组件遵循统一的注册协议、状态管理、AI 可读写接口
9. **数据先行** — AI 能力的前提是数据存在且结构化。核心个人数据（笔记、日记、随身记、存钱罐）必须先于或与 AI 同步建立

---

## 四、开发路线

### Phase 0：紧急修复 + 基础体验稳定（1-3 天）

**目标**：让现有 16 个组件全部可用，组件菜单完整可访问，基础交互可用

| 任务 | 详情 | 验收标准 |
|------|------|----------|
| 修复 noteBlock state 不匹配 | 统一 builtIn.ts 和 widgetDefinitions.ts 的 schema，渲染层做兼容迁移：`content = state.content ?? state.text ?? ''` | noteBlock 可正常添加、编辑、保存、恢复 |
| 全量组件可用性审计 | 逐一检查 16 个组件的渲染、交互、数据持久化是否正常，记录问题并修复 | 所有 16 个组件均通过可用性检查 |
| 修复组件列表滚动 | AddWidgetMenu 添加 `max-height: min(80vh, 640px); overflow-y: auto`，组件列表分组展示 | 所有组件在菜单中可见且可滚动 |
| 透明组件角标 | 组件透明时四角显示半透明 L 型角标（CSS 伪元素实现），hover 时显示完整边框 | 透明组件在静止时四角可见，hover 时边框完整显示 |
| 基础交互优化 | 组件标题栏作为拖拽区、Space+拖动平移画布、Delete 删除选中组件、Esc 取消选择 | 拖拽不抖动、Space 平移流畅、Delete/Esc 响应正确 |
| 鼠标体验验收 | resize handle 最小 8px 可点击区域、滚轮缩放以鼠标为中心、hover 组件显示边框反馈 | resize 不难点击、缩放中心正确、hover 有视觉反馈 |
| 统一 Button/Control 规范 | 最小点击区域 32x32px、hover/active/disabled 状态样式、tooltip 提示、确认弹窗统一组件 | 所有按钮和控件符合交互规范，点击舒适 |
| 错误边界保护 | 为每个组件添加 WidgetErrorBoundary，单组件崩溃不影响其他组件 | 单组件报错时其他组件正常 |
| 最小文档 | 在画布空白处添加快捷键提示浮层（Space/滚轮/Delete/Esc） | 新用户能看到基本操作提示 |

### Phase 1：统一组件协议 + 核心个人数据模型 + 现有组件迁移（1-2 周）

**目标**：建立组件标准协议和数据访问协议，建立核心个人数据表，迁移现有组件，为 AI 读取和操作奠定基础

#### 1.1 Widget Schema Registry

统一组件注册协议，每个组件声明：

```typescript
interface WidgetSchema {
  type: string
  name: string
  icon: string
  category: 'basic' | 'study' | 'work' | 'life' | 'media' | 'stats' | 'fun'
  defaultLayout: { w: number; h: number; minW: number; minH: number }
  defaultState: Record<string, unknown>
  stateVersion: number
  capabilities: {
    aiReadable: boolean
    aiWritable: boolean
    connectable: boolean
    exportable: boolean
  }
  getAISummary?: (state: unknown) => string
  migrateState?: (oldState: unknown, fromVersion: number) => unknown
  lifecycle?: {
    onCreate?: (widgetId: string) => void
    onDestroy?: (widgetId: string) => void
    onStateChange?: (widgetId: string, newState: unknown) => void
  }
}
```

#### 1.2 Data Source Registry

AI 需要读取的不只是组件状态，还包括 IndexedDB 中的业务数据。建立 Data Source Registry：

```typescript
interface DataSourceDefinition {
  storeName: string               // IndexedDB 表名
  displayName: string             // 显示名称
  category: string                // 分类
  aiReadable: boolean
  aiWritable: boolean
  defaultQuery?: () => Promise<unknown[]>  // 默认查询
  schema: Record<string, string>  // 字段描述，供 AI 理解数据结构
}
```

#### 1.3 核心个人数据模型（新增 IndexedDB 表）

用户明确要求"笔记以及随身记应该有完整的数据库"、AI 要能获取"日记、笔记、待办、存钱罐目标"。以下数据表必须在 AI 之前建立：

| 新增表 | 用途 | 关键字段 | AI 可读 | AI 可写 |
|--------|------|----------|---------|---------|
| `notes` | 笔记（独立于组件的笔记数据库） | id, title, content, tags, createdAt, updatedAt | 是 | 是 |
| `journals` | 日记 | id, date, content, mood, tags, createdAt, updatedAt | 是 | 是 |
| `quickNotes` | 随身记（碎片想法快速记录） | id, content, tags, createdAt | 是 | 是 |
| `savingsGoals` | 存钱罐/存钱目标 | id, name, target, current, deadline, createdAt, updatedAt | 是 | 是 |
| `savingsTransactions` | 存钱罐交易记录 | id, goalId, amount, note, createdAt | 是 | 是 |
| `aiConversations` | AI 对话历史 | id, sessionId, role, content, toolCalls, createdAt | 是 | 是 |
| `aiMemories` | AI 记忆（跨会话） | id, category, key, value, confidence, source, pinned, expiresAt, createdAt, updatedAt | 是 | 是 |
| `aiAuditLog` | AI 工具调用审计 | id, sessionId, toolName, params, result, createdAt | 是 | 否 |

#### 1.3.1 IndexedDB 基础设施

新增表需配套：
- **版本迁移**：DB_VERSION 递增，onupgradeneeded 中创建新表和索引
- **索引定义**：notes(by_tags)、journals(by_date)、quickNotes(by_tags)、savingsGoals(by_deadline)、savingsTransactions(by_goalId)、aiConversations(by_sessionId)、aiMemories(by_category, by_key)、aiAuditLog(by_sessionId, by_createdAt)
- **分页查询**：Data Source Registry 的 defaultQuery 支持分页参数（offset/limit），避免一次加载全量数据
- **导入导出**：新增表纳入现有 exportImportV2 体系

#### 1.4 WidgetPort 初步定义

为 Phase 3 搭线做准备，提前定义组件端口概念：

```typescript
interface WidgetPort {
  id: string
  widgetId: string
  direction: 'top' | 'right' | 'bottom' | 'left'
  type: 'in' | 'out' | 'inout'
  dataType?: string  // 数据类型标识，Phase 3 视觉连接时不使用
}
```

Phase 1 只定义接口，不实现搭线逻辑。

#### 1.5 现有 16 个组件迁移计划

逐个将现有组件迁移到新协议，每个组件：
- 补充 `category` 分类
- 声明 `capabilities`
- 实现 `getAISummary()` 方法
- 补充 `migrateState()` 兼容旧数据
- 验证渲染和交互正常

迁移优先级：noteBlock（修复）→ taskList（AI 高频读取）→ focusTimer → habitTracker → moodTracker → musicPlayer → agendaList → 其余

#### 1.6 组件菜单分组

```
基础组件：文本框、便签贴纸、Markdown 笔记、笔记卡片
时间与任务：时钟、倒数日、专注计时、任务列表、轻量日程
生活与健康：习惯打卡、心情记录、呼吸练习
媒体与阅读：PDF 阅读器、音乐播放器、每日一句
统计面板：专注统计
```

预留学习工具分组（Phase 4 填充）。

#### 1.7 Phase 1 同步文档

- 更新快捷键提示浮层，加入组件分组说明
- 组件菜单分组后的使用提示

### Phase 2A：AI 助手核心 + 核心个人数据组件（2 周）

**目标**：AI 能读取所有组件数据和核心个人数据，通过工具调用操作数据，能创建和使用组件。同步建立日记、随身记、存钱罐组件

> 这是项目的核心 Phase。AI 是本项目的主轴。

#### 2A.1 AI 助手组件架构

```
AI Assistant Widget（普通组件，用户添加才出现）
        │
        ├── Context Builder（分层上下文 + token 预算管理）
        │     ├── L1: 当前视图上下文（面板ID、可见组件列表、选中组件）
        │     ├── L2: 组件摘要上下文（每个组件的 getAISummary() 返回值）
        │     ├── L3: 按需详细上下文（AI 需要时调用工具获取完整数据）
        │     ├── Token 预算：L1/L2 固定注入，L3 按需调用，总上下文不超过模型 token 限制
        │     ├── 视口优先级：当前可见组件优先注入上下文
        │     ├── 隐私过滤：用户标记"AI 不可读"的数据不注入上下文
        │     ├── 长内容摘要：笔记/日记超过 500 字时只注入摘要，AI 按需获取全文
        │     └── 对话压缩：对话历史超过 20 轮时，压缩早期对话为摘要
        │
        ├── Tool Registry（工具注册中心，前端内置）
        │     ├── 面板工具：list_panels, switch_panel, create_panel
        │     ├── 组件工具：list_widgets, get_widget_state, update_widget_state,
        │     │             create_widget(仅已注册类型), delete_widget,
        │     │             move_widget(widgetId, x, y), resize_widget(widgetId, w, h)
        │     ├── 任务工具：list_tasks, add_task, update_task, complete_task
        │     ├── 日程工具：list_events, add_event, update_event
        │     ├── 笔记工具：search_notes, read_note, create_note, update_note
        │     ├── 日记工具：list_journals, add_journal, read_journal, update_journal
        │     ├── 随身记工具：list_quick_notes, add_quick_note, search_quick_notes
        │     ├── 习惯工具：list_habits, checkin_habit, get_habit_stats
        │     ├── 心情工具：get_mood_history, add_mood_entry
        │     ├── 音乐工具：list_playlists, get_playlist_songs, get_music_playlist_detail, play_song
        │     ├── 专注工具：start_focus, stop_focus, get_focus_stats
        │     └── 存钱罐工具：list_savings_goals, create_savings_goal,
        │                   update_savings_progress, get_savings_stats,
        │                   add_savings_transaction, list_savings_transactions
        │
        ├── Session Context（会话级上下文）
        │     ├── 当前对话历史（持久化到 aiConversations 表）
        │     ├── 当前面板快照（组件列表+摘要）
        │     └── 会话内临时记忆
        │
        ├── Permission Manager（权限管理）
        │     ├── 只读操作：自动执行
        │     ├── 写入操作：需用户确认
        │     └── 危险操作：二次确认
        │
        ├── Audit Logger（工具调用审计日志）
        │     └── 记录每次 AI 工具调用的时间、工具名、参数、结果，存入 aiAuditLog 表
        │
        ├── Privacy Guard（隐私保护）
        │     ├── 首次使用时显示隐私提示（数据存本地、AI 调用远程 API 时数据会发送）
        │     ├── 用户可标记某些数据为"AI 不可读"
        │     └── API Key 本地存储（AES-GCM 加密，注意：此加密仅防止浏览器存储明文泄露，不抵御 XSS 攻击）
        │
        └── LLM Backend（可切换）
              ├── 远程 API（ChatST 等 OpenAI 兼容接口）
              ├── 错误重试（3 次，指数退避）
              └── 降级策略（主模型失败时切换备用模型）
```

**关于 MCP Bridge**：MVP 阶段不桥接 MCP Server，AI 工具全部前端内置。MCP Bridge 在 Phase 5 高级能力阶段再接入。

**关于 Tool Contract**：每个 AI 工具必须声明：
- 参数 JSON Schema（校验 AI 传入参数）
- 统一返回格式 `{ success: boolean, data?: unknown, error?: string }`
- dryRun 支持（写入操作可先 dryRun 预览效果，再确认执行）
- 失败回滚策略（写入操作失败时恢复原状态）

#### 2A.2 AI 组件 UI 设计

- 聊天式交互界面，支持 Markdown 渲染
- 工具调用过程可视化（显示 AI 正在调用的工具名称和返回结果摘要）
- 上下文面板（可折叠，显示当前 AI 感知的组件摘要列表）
- 模型切换下拉框
- 对话历史持久化到 IndexedDB
- AI 组件不占据固定位置，是普通可拖拽组件
- 隐私提示横幅（首次使用时显示）

#### 2A.3 AI 创建和使用组件

AI 通过工具调用操作组件：
- `create_widget(type, initialState, position?)` — 创建已有类型的新实例（仅限已注册类型）
- `update_widget_state(widgetId, partial)` — 更新组件状态
- `get_widget_state(widgetId)` — 读取组件完整状态
- `move_widget(widgetId, x, y)` — 移动组件位置
- `resize_widget(widgetId, w, h)` — 调整组件大小
- `delete_widget(widgetId)` — 删除组件（危险操作，二次确认）

示例场景：
- 用户："帮我创建一个倒计时，距离期末考试还有多少天" → AI 调用 create_widget + create_savings_goal
- 用户："我有哪些待办？" → AI 调用 list_tasks 并总结
- 用户："播放我的学习歌单" → AI 调用 list_playlists + play_song
- 用户："我最近心情怎么样？" → AI 调用 get_mood_history 并分析趋势
- 用户："我的存钱目标进度如何？" → AI 调用 get_savings_stats
- 用户："帮我写一篇日记" → AI 调用 add_journal

#### 2A.4 AI 不喧宾夺主的约束

- AI 是一个普通组件，但**新建面板可默认包含 AI 助手组件**（用户可删除/隐藏/最小化）
- AI 组件可关闭、最小化、拖拽，与其他组件平级
- AI 的写操作必须经用户确认，不能静默修改数据
- AI 不能改变画布的平移/缩放状态
- AI 不能自动弹出或抢占焦点
- AI 工具调用有审计日志，用户可查看

#### 2A.5 AI MVP 验收标准

| 场景 | 验收标准 |
|------|----------|
| AI 读取任务列表 | 用户问"我有哪些待办"，AI 正确返回任务列表并总结 |
| AI 创建组件 | 用户说"创建一个倒计时"，AI 创建组件并确认 |
| AI 读取音乐数据 | 用户问"我的歌单有哪些歌"，AI 正确返回歌单内容 |
| AI 读取存钱罐 | 用户问"存钱进度"，AI 正确返回存钱目标数据 |
| AI 权限 | 写操作弹出确认框，用户拒绝则不执行 |
| AI 审计 | 工具调用记录可在审计日志中查看 |

#### 2A.6 核心个人数据组件（与 AI 同步建立）

| 组件 | 类型名 | 功能 | 数据表 |
|------|--------|------|--------|
| **日记** | `journal` | 日记撰写、时间线浏览、标签分类、心情关联 | journals |
| **随身记** | `quickNote` | 快速记录碎片想法、标签整理、搜索 | quickNotes |
| **存钱罐** | `savingsGoal` | 存钱目标追踪、进度可视化、存入/取出记录 | savingsGoals, savingsTransactions |

每个组件：
- aiReadable=true, aiWritable=true
- 实现 getAISummary()
- 数据存入独立 IndexedDB 表（不依赖组件状态）

#### 2A.7 Phase 2A 同步文档

- AI 组件使用说明（如何添加、如何对话、权限说明）
- 新增组件（日记/随身记/存钱罐）的使用提示

### Phase 2B：AI 记忆系统 + AI 协作增强（1 周）

**目标**：完善 AI 记忆能力，支持 AI 协作学习场景

#### 2B.1 AI 记忆系统

- **aiMemories 表**（Phase 1 已创建）的完整实现
- **记忆写入时机**：用户主动告知（"记住我喜欢..."）、AI 推断并确认（"我注意到你经常..., 要我记住吗？"）
- **记忆读取时机**：每次新会话开始时加载相关记忆到上下文
- **记忆治理 UI**：用户可查看、编辑、删除、置顶 AI 记忆
- **记忆字段说明**：
  - confidence：AI 对此记忆的置信度（0-1）
  - source：记忆来源（user_explicit / ai_inferred / behavior_stat）
  - pinned：用户是否置顶（置顶记忆始终注入上下文）
  - expiresAt：过期时间（可选，行为统计类记忆可设过期）

#### 2B.2 AI 协作学习增强

- LaTeX 出题器 AI 协作：AI 可通过工具生成题目、解析、相似题（为 Phase 4A 准备）
- 音乐播放器 getAISummary 增强：返回歌单名称+歌曲数量+最近播放
- agendaList 迁移优先级提升（加入 Phase 1 迁移列表）

#### 2B.3 Phase 2B 同步文档

- AI 记忆管理说明
- 隐私设置说明

### Phase 3：自由画画 + 组件搭线（2-3 周）

**目标**：画布支持自由绘图，组件间可创建视觉连接

#### 3.1 画布模式状态机

```
select（默认）→ pan → draw → erase → connect → text
     ↑            │       │       │        │        │
     └────────────┴───────┴───────┴────────┴────────┘
```

快捷键：V 选择 | H 拖动 | P 画笔 | E 橡皮 | C 连线 | T 文本

**各模式下鼠标/键盘行为定义**：

| 模式 | 左键点击空白 | 左键拖拽空白 | 左键点击组件 | 左键拖拽组件 | 滚轮 |
|------|-------------|-------------|-------------|-------------|------|
| select | 取消选择 | 框选 | 选中组件 | 移动组件 | 缩放 |
| pan | 平移画布 | 平移画布 | 平移画布 | 平移画布 | 缩放 |
| draw | 开始画线 | 画线 | 开始画线 | 画线 | 缩放 |
| erase | 擦除笔迹 | 擦除笔迹 | 无效 | 无效 | 缩放 |
| connect | 无效 | 无效 | 选中锚点开始连线 | 拖出连线 | 缩放 |
| text | 放置文本框 | 无效 | 无效 | 无效 | 缩放 |

**关键约束**：所有模式下滚轮始终缩放，Space 键始终可临时切换到 pan 模式，Esc 始终回到 select 模式。

#### 3.2 绘图功能

- **技术方案**：SVG 绘图层（缩放不失真、易序列化存储、与画布 transform 协同）
- **pointer-events 策略**：SVG 绘图层默认 `pointer-events: none`，仅在 draw/erase 模式下设为 `auto`，其他模式下鼠标事件穿透到组件层
- **SVG 性能边界**：单面板笔迹 > 500 条时，将旧笔迹 rasterize 到离屏 Canvas 作为背景图（保留最近 200 条为可编辑 SVG）；> 2000 条时提示用户分层或清空
- **工具**：画笔（颜色/粗细）、橡皮擦（MVP 只做删除整条 stroke）、直线、箭头、矩形、椭圆、文本标注、高亮笔
- **操作**：撤销/重做（UndoStack，最多 50 步）、清空、导出为 PNG
- **坐标**：所有笔迹使用画布世界坐标，通过 `screenToWorld()` 转换
- **绘图文本 vs 组件文本**：绘图文本是画布上的标注（不可编辑的 SVG text），组件文本是组件内的富文本（可编辑）。视觉上通过字体和样式区分
- **持久化**：笔迹数据存入 IndexedDB 新增 `drawingStrokes` 表

数据结构：
```typescript
type DrawingStroke = {
  id: string
  panelId: string
  type: 'freehand' | 'line' | 'arrow' | 'rect' | 'ellipse' | 'text' | 'highlight'
  points: Array<{ x: number; y: number }>
  style: { color: string; width: number; opacity: number; fill?: string }
  createdAt: number
  updatedAt: number
}
```

画布层级（从底到顶，z-index 规则）：
```
背景网格 (z:0) < 绘图标注 (z:10) < 连接线 (z:20) < 组件 (z:100+) < 选择框 (z:500) < 浮动菜单 (z:1000)
```

#### 3.3 组件搭线

**本 Phase 只实现第一阶段：视觉连接线**

- 每个组件四边中点作为锚点（top/right/bottom/left），锚点在 hover 或 connect 模式下显示
- 从锚点拖出创建 SVG 贝塞尔曲线连接
- 连线支持颜色、箭头方向、标签编辑
- 连线可选中、删除
- **组件移动后连线自动跟随**（重新计算锚点位置）
- **组件删除时连线自动清除**
- **视觉连接不是数据流**：连线上显示"视觉连接"标签，避免用户误解为数据流连接。数据流连接在 Phase 5 实现

数据结构（预留后续阶段扩展字段）：
```typescript
type WidgetConnection = {
  id: string
  panelId: string
  source: { widgetId: string; anchor: 'top' | 'right' | 'bottom' | 'left' | 'center' }
  target: { widgetId: string; anchor: 'top' | 'right' | 'bottom' | 'left' | 'center' }
  type: 'visual' | 'semantic' | 'data'   // 本 Phase 只用 'visual'
  semanticType?: string                    // Phase 5 扩展
  label?: string
  style: { color: string; width: number; dashed?: boolean; arrow?: 'none' | 'end' | 'both' }
}
```

新增 IndexedDB 表：`widgetConnections`

#### 3.4 Phase 3 同步文档

- 画布模式切换说明（V/H/P/E/C/T 快捷键）
- 绘图工具使用提示
- 连线功能说明（明确标注"视觉连接，非数据流"）

> **3.4 实施状态备注（2026-06-03 实施完成）**
>
> 实际实施范围见 [phase3 spec](../.trae/specs/phase3/spec.md)。下表列出 roadmap v3 中提到但**未在本次 Phase 3 实施**的功能，移至后续阶段：
>
> | roadmap 提到的功能 | 实际状态 | 后续 |
> |------------------|---------|------|
> | 高亮笔（highlight 工具） | 未实施 | Phase 5（与笔迹编辑一起） |
> | 笔迹导出为 PNG | 未实施 | Phase 5 |
> | 连线可选中、删除 | 未实施 | Phase 5 |
> | 笔迹 rasterize 离屏 Canvas | 未实施 | Phase 5（性能优化阶段） |
> | 连线"视觉连接"标签 | 未实施 | Phase 5（与连线编辑一起） |
> | 锚点位置在 hover 时显示 | **已实施为 connect 模式 hover widget 时显示** | — |
> | 连线支持颜色/箭头/标签编辑 | 部分实施（创建时使用当前绘图样式，编辑未实施） | Phase 5 |
>
> **已确认实现**：
> - 6 种绘图工具（画笔/直线/箭头/矩形/椭圆/文本）
> - 笔迹持久化（IndexedDB drawingStrokes 表，DB_VERSION 升到 4）
> - 橡皮擦（删除整条 stroke）
> - 撤销/重做（按面板独立的 CommandStack，最多 50 步）
> - 连线创建（从锚点拖拽到另一锚点）
> - 组件移动时连线自动跟随
> - 组件删除时相关连线自动清理
> - 快捷键 V/H/P/E/C/L/A/R/O/T、Esc、Ctrl+Z/Y
> - 导出/导入兼容（v5 → v6）
> - 模式工具栏默认隐藏，hover 顶部 80px 区域才显示
> - 草稿笔迹在 z:200（组件之上）保证用户画在组件上的线立即可见

### §4.2 Phase 3 实际范围说明

| Roadmap 范围 | 实际实施范围 | 偏差原因 |
|------------|------------|---------|
| **3.2 画笔/高亮笔/直线/箭头/矩形/椭圆** | 实施：画笔/直线/箭头/矩形/椭圆/文本（6 种）<br>未实施：高亮笔 | 高亮笔需要独立渲染模式（半透明叠加），技术复杂度与画笔/橡皮擦组合高，移至 Phase 5 |
| **3.2 笔迹导出为 PNG** | 未实施 | 需要 canvas rasterize 集成，依赖 §1 视觉风格统一，移至 Phase 5 |
| **3.2 颜色拾取器 + 粗细 + 透明度** | 实施：8 预设色 + 自定义色 + 粗细 1-20 滑块 + 透明度 0.1-1 滑块 | 完整 |
| **3.2 橡皮擦（删除整条 stroke）** | 实施 | 完整 |
| **3.2 撤销/重做（笔迹/连线）** | 实施：按面板独立 CommandStack，最多 50 步，"清空笔迹"占 1 步 | 完整 |
| **3.3 连线创建（从锚点拖拽）** | 实施 | 完整 |
| **3.3 连线可选中、删除** | 未实施 | 选中/删除涉及完整的连线管理 UI（hover 高亮、右键菜单、Delete 键等），与 Phase 5 语义连接一起做 |
| **3.3 视觉连接"标签"渲染** | 未实施 | 与"连线可选中"绑定，移至 Phase 5 |
| **3.3 连线颜色/箭头/标签编辑** | 部分：创建时使用当前绘图样式<br>未实施：编辑 | 移至 Phase 5 |
| **3.3 组件移动/删除时连线自动跟随/清理** | 实施：移动时实时计算端点（无需重存 DB）；删除时批量清理 DB | 完整 |
| **3.4 模式切换快捷键 V/H/P/E/C/T** | 实施：扩展为 V/H/P/E/C/L/A/R/O/T（添加工具快捷键 L/A/R/O） | UX 改进 |
| **3.4 模式工具栏 hover 80px 才显示** | 实施 | 完整 |
| **3.4 画线输入区透传** | 实施：`input/textarea/select/[contenteditable]/[role=textbox]/[data-widget-interactive]` 内不画线 | 完整（spec §8.17） |
| **AI 工具创建/操作笔迹和连线** | 未实施 | 属于 AI 高级代理（Phase 5） |
| **笔迹 rasterize 离屏 Canvas（性能优化）** | 未实施 | 笔迹 < 2000 时 SVG 性能可接受，> 2000 直接阻止新增。rasterize 留至性能优化阶段 |

**总体偏差**：Phase 3 实际实施范围 = 100% 设计（spec 实现）+ 90% 功能（高亮笔/导出/编辑/选中 4 项移至 Phase 5）。所有核心交互（创建/绘制/擦除/撤销/重做/连线跟随/连线清理）均完整实施。

### Phase 4A：学习组件 MVP（1-2 周）

**目标**：建立最核心的学习组件 MVP

| 组件 | 类型名 | 功能 | MVP 范围 | 数据表 |
|------|--------|------|----------|--------|
| **LaTeX 出题器** | `latexQuiz` | LaTeX 渲染 + 出题 | KaTeX 渲染公式，预置题库（数学基础），手动出题模式，简单判分，AI 协作生成题目/解析/相似题 | quizSessions |
| **计算器** | `calculator` | 科学计算器 | 四则运算 + 科学函数(sin/cos/log/sqrt/pow) + 历史记录 + 表达式输入 | — (无独立表，状态存组件state) |

每个学习组件：aiReadable=true, 实现 getAISummary()

#### 4A.1 Phase 4A 同步文档

- LaTeX 出题器使用说明
- 计算器快捷键

### Phase 4B：学习组件增强 + 面板模板（1-2 周）

**目标**：补齐更多学习组件，提供面板模板

| 组件 | 类型名 | 功能 | MVP 范围 | 数据表 |
|------|--------|------|----------|--------|
| **单词记忆** | `vocabTrainer` | 英语单词记忆 | 预置词库(CET4核心)，SM-2 间隔重复，学习进度统计 | vocabDecks, vocabProgress |
| **数独** | `sudoku` | 数独游戏 | 预置题库(简单/中等/困难各20题)，笔记模式，计时 | sudokuGames |
| **错题本** | `mistakeBook` | 错题收集与复习 | 从 latexQuiz 自动收集错题，间隔重复复习 | mistakes |

#### 4B.1 面板模板

提供预设面板模板，一键创建包含预配置组件的面板：
- **学习模板**：LaTeX 出题器 + 计算器 + 单词记忆 + 专注计时
- **工作模板**：任务列表 + 轻量日程 + 专注计时 + Markdown 笔记
- **放松模板**：音乐播放器 + 呼吸练习 + 每日一句 + 心情记录
- **复盘模板**：专注统计 + 心情记录 + 习惯打卡 + 日记

模板数据结构存入 IndexedDB `panelTemplates` 表。

#### 4B.2 组件菜单更新

```
基础组件：文本框、便签贴纸、Markdown 笔记、笔记卡片
时间与任务：时钟、倒数日、专注计时、任务列表、轻量日程
学习工具：LaTeX 出题器、计算器、单词记忆、数独、错题本
生活与健康：习惯打卡、心情记录、呼吸练习、日记、随身记、存钱罐
媒体与阅读：PDF 阅读器、音乐播放器、每日一句
统计面板：专注统计
```

#### 4B.3 Phase 4B 同步文档

- 单词记忆和数独使用说明
- 面板模板使用方法

### Phase 5：交互抛光 + 完整手册 + 高级能力（2-3 周 + 长期）

**目标**：提升操作舒适度，完善文档，扩展高级能力

#### 5.1 交互优化

| 优化项 | 详情 | 自由画布保护 |
|--------|------|-------------|
| 拖拽体验 | 拖拽时显示半透明影子、8 个 resize handle | 不改变自由拖拽行为 |
| 网格吸附 | 可选 8px 网格吸附辅助 | **默认关闭**，用户手动开启 |
| 对齐辅助线 | 拖拽时显示与其他组件的对齐参考线 | 仅视觉提示，不强制对齐 |
| 命令面板 | Ctrl+K 呼出，搜索组件/笔记/任务、执行 AI 指令 | 不改变画布操作 |
| 右键菜单增强 | 画布空白处和组件分别有不同菜单 | 不改变画布操作 |
| 快捷键体系 | V/H/P/E/C/T 切换模式，Ctrl+Z/Y 撤销重做 | 不改变已有快捷键 |
| 多选操作 | 框选多个组件，批量移动/删除/对齐 | 不改变单选行为 |
| 组件搜索 | 在 AddWidgetMenu 中添加搜索过滤 | 不改变画布操作 |

#### 5.2 完整用户手册

- 内嵌帮助面板（可搜索的 Markdown 文档，**汇总所有 Phase 同步交付的手册章节**）
- 首次进入的新手引导（Onboarding Tour，5 步核心操作：添加组件→拖拽→画布平移缩放→AI对话→模式切换）
- 快捷键速查面板（? 键呼出）
- 每个组件的帮助按钮（组件右上角 ? 图标）
- **手册交付策略**：每个 Phase 同步交付对应章节（Phase 0 快捷键提示、Phase 1 组件分组说明、Phase 2A AI使用说明、Phase 2B 记忆管理说明、Phase 3 画画搭线说明、Phase 4A/B 学习组件说明），Phase 5 负责整合为完整手册

#### 5.3 高级能力（长期迭代）

| 方向 | 详情 | 风险等级 |
|------|------|----------|
| AI 高级代理 | 自动化工作流（如"每天早上总结昨日习惯和心情"）、跨组件智能建议 | 中 |
| AI + MCP Bridge | 复用 MCP Server，AI 可通过 MCP 动态创建自定义组件（需用户授权） | 高 |
| 语义连接 | 搭线第二阶段：连接加语义类型，AI 可利用语义连接理解组件关系 | 中 |
| 数据流连接 | 搭线第三阶段：组件声明 emits/accepts，事件总线 | 高 |
| 社区插件 | 第三方组件市场、组件开发 SDK | 高 |
| 移动适配 | 响应式布局、触控优化 | 中 |
| 云同步 | 可选的云端备份和跨设备同步（仅备份，不替代本地存储） | 高 |

---

## 五、关键设计决策

### 5.1 为什么 AI 在画画和搭线之前？

项目定位是"以 AI 为主的自由画布"。AI 是用户与画布交互的主要方式，必须先完成 AI MVP 才能让项目具备核心差异化价值。

### 5.2 为什么核心个人数据（日记/随身记/存钱罐）与 AI 同步建立？

数据先行原则：AI 能力的前提是数据存在且结构化。用户明确要求 AI 能获取日记、笔记、存钱罐数据，这些数据表必须在 AI 工具之前建立，否则 AI MVP 无法满足核心需求。

### 5.3 为什么 AI MVP 包含基础记忆？

用户要求"完整的上下文管理和记忆能力"。会话级上下文不够，至少需要跨会话的基础记忆（aiMemories 表），否则每次新对话 AI 都从零开始，违背"AI 是核心"的定位。

### 5.4 为什么画画用 SVG 而非 Canvas？

- SVG 缩放不失真，与画布 transform 天然协同
- SVG 元素可独立选中、编辑、删除
- SVG 易序列化为 JSON 持久化
- 性能：笔迹 < 500 条时 SVG 性能足够；超量时合并旧笔迹为静态 group
- pointer-events 策略确保 SVG 层不拦截组件交互

### 5.5 为什么搭线本 Phase 只做视觉连接？

- 视觉连接是最低成本最高感知的功能
- 连线明确标注"视觉连接"避免误解为数据流
- 数据结构预留 semanticType 和 type 字段，后续升级无破坏性

### 5.6 如何保证新功能不喧宾夺主？

- **AI**：虽是核心，但以普通组件形式存在，新建面板默认包含但用户可删除/隐藏/最小化，写操作需确认
- **画画**：绘图层默认 pointer-events:none，需要切换到 draw 模式才启用
- **搭线**：需要切换到 connect 模式才创建，连线标注"视觉连接"
- **学习组件**：与现有组件平级，不改变其他组件的行为
- **模式切换**：默认始终是 select 模式，Esc 即回到 select
- **画布操作不变**：所有模式下滚轮始终缩放，Space 始终可平移
- **网格吸附**：默认关闭，用户手动开启
- **对齐辅助线**：仅视觉提示，不强制对齐

### 5.7 AI 权限模型

| 操作类型 | 权限级别 | 示例 |
|----------|----------|------|
| 读取数据 | 自动执行 | "我有哪些待办？" |
| 创建内容 | 需确认 | "帮我创建一个倒计时" |
| 修改数据 | 需确认 | "把任务标记为完成" |
| 删除数据 | 二次确认 | "删除这个组件" |

### 5.8 AI create_widget 的限制

AI 只能创建**已注册类型**的组件实例，不能创建未知类型。自定义组件的创建由 MCP Server 在 Phase 5 支持（需用户授权）。

---

## 六、参考项目

| 项目 | 可借鉴之处 |
|------|-----------|
| **Notion** | `/` 快捷添加、模板化面板、AI 总结、命令菜单 |
| **Obsidian** | 双向链接（组件间关系）、本地优先、插件生态、Canvas 画布 |
| **Figma / FigJam** | 无限画布、平滑拖拽、对齐辅助线、连接线、手绘白板 |
| **tldraw** | 白板绘图、工具模式切换、箭头绑定、撤销/重做 |
| **Excalidraw** | 手绘风格、低门槛绘图、导出 |
| **Heptabase** | 白板式知识管理、卡片式笔记、视觉化连接 |
| **AFFiNE** | 混合 Notion 结构 + Miro 画布、开源、Edgeless 模式 |
| **Anytype** | 本地优先、对象架构、E2EE 加密 |
| **Flowise / Langflow** | 可视化 AI 工作流搭线，连线即执行逻辑 |
| **Capacities** | 对象化知识管理、AI 跨对象查询 |

---

## 七、风险与缓解

| 风险 | 缓解措施 |
|------|----------|
| AI MVP 过重导致延期 | MVP 只做前端内置工具 + 会话级上下文 + 基础记忆，不做 MCP Bridge |
| 画布性能下降（组件+绘图+连线过多） | 分层渲染、旧笔迹 rasterize 到离屏 Canvas、组件数量警告 |
| AI 工具调用复杂度爆炸 | MVP 先做核心工具组，按需扩展；工具定义遵循 JSON Schema |
| 搭线数据流实现过于复杂 | 本 Phase 只做视觉连接，语义和数据流延后到 Phase 5 |
| 学习组件开发量大 | 拆为 4A/4B 两阶段，MVP 范围明确限定，数独用预置题库 |
| 新功能破坏自由画布体验 | 所有新功能默认不激活；网格吸附默认关；对齐线不强制；画布操作不变 |
| 云同步与本地优先冲突 | 云同步仅作为可选备份，不替代本地存储 |
| SVG 绘图层拦截组件交互 | pointer-events 策略：默认 none，仅 draw/erase 模式 auto |
| AI 远程 API 隐私风险 | 首次使用隐私提示、API Key 加密存储、审计日志 |

---

## 八、审核通过后的补充细节

> 以下内容为 GPT 5.5 对抗审核通过后建议补充的 7 项细节

### 8.1 noteBlock 与 notes 表的绑定关系

- noteBlock 组件通过 `state.noteId` 关联 notes 表中的记录
- 删除 noteBlock 组件不删除 notes 表中的数据（数据独立于组件存在）
- AI 读取笔记时以 notes 表为权威数据源，而非组件 state
- noteBlock 渲染时从 notes 表读取内容，编辑时写回 notes 表

### 8.2 AI 创建组件的位置策略

- 新建组件默认放置在**当前视口中心**
- 连续创建时偏移放置（+30px, +30px），避免重叠
- 确认弹窗中展示组件预览和位置
- AI 创建组件不改变画布的缩放和平移状态

### 8.3 组件级安全 aiActions

- AI 优先调用组件的业务动作（aiActions）而非直接修改 state
- 例如：taskList 组件暴露 `addTask(title, dueDate)` 动作，AI 调用此动作而非直接 `update_widget_state`
- aiActions 在 Widget Schema 的 capabilities 中声明
- 好处：组件可校验业务逻辑、触发副作用（如通知）、保持数据一致性

### 8.4 画布事件优先级规则

从高到低：
```
组件内部控件（输入框、按钮等） > resize handle > 组件拖拽 > 框选 > 锚点交互 > 绘图 > 画布平移/缩放
```

低优先级事件在高优先级区域被抑制。例如：在组件输入框内滚轮不触发画布缩放。

### 8.5 统一 Undo/Redo 规划

- Phase 3 建立 Command Stack（命令栈），首期覆盖：绘图操作、连线操作、组件移动/删除
- 命令接口：`execute() / undo() / redo()`
- 后续 Phase 逐步扩展覆盖范围
- 快捷键：Ctrl+Z 撤销、Ctrl+Y / Ctrl+Shift+Z 重做

### 8.6 AI 不可用时的降级行为

- AI 组件离线时显示"AI 暂时不可用"提示，不影响其他组件
- 本地功能（所有组件、画画、搭线）完全不受 AI 可用性影响
- LaTeX 出题器保留手动出题模式，AI 不可用时仍可正常使用
- AI 记忆和对话历史仍可本地查看（只读），但不能新增对话

### 8.7 基础测试策略

| 测试类型 | 覆盖范围 | 阶段 |
|----------|----------|------|
| 迁移测试 | DB_VERSION 升级、旧数据兼容、新表创建 | Phase 1 |
| Tool Contract 测试 | 参数校验、返回格式、dryRun、回滚 | Phase 2A |
| 权限流程测试 | 只读/写入/危险三级权限、确认/拒绝 | Phase 2A |
| 坐标转换测试 | screenToWorld / worldToScreen、缩放/平移下绘图 | Phase 3 |
| 组件可用性测试 | 16+组件渲染、交互、持久化 | Phase 0 |

### 8.8 AI 功能真实测试要求

**AI 相关功能必须做真实 API 调用测试，不允许只写代码不验证。**

测试 API 配置：
- 端点：`https://api.st0722.top/v1/chat/completions`
- API Key：`sk-0BTb1eC7IAeIKWZTNeJpiwGaBZGBTUxBzpWXiRwBftqWvN0q`
- 模型选择：先调用 `https://api.st0722.top/v1/models` 获取可用模型列表，选择 **DeepSeek v4 flash**

必须真实测试的场景：

| 测试场景 | 验证内容 | 阶段 |
|----------|----------|------|
| AI 对话基本连通 | 发送消息并收到流式/非流式回复 | Phase 2A |
| AI 工具调用 | AI 正确调用 list_tasks/get_widget_state 等工具并返回结果 | Phase 2A |
| AI 创建组件 | AI 通过 create_widget 工具在画布上创建组件 | Phase 2A |
| AI 权限拦截 | 写操作弹出确认、危险操作二次确认 | Phase 2A |
| AI 记忆存取 | 写入记忆后新会话能读取 | Phase 2B |
| AI 协作出题 | AI 生成 LaTeX 题目并渲染 | Phase 4A |
| AI 降级 | API 不可用时组件正常、AI 显示离线提示 | Phase 2A |

测试方法：
- 在开发环境中直接调用 API，观察完整请求/响应链路
- 验证工具调用的 function calling 格式是否正确
- 验证流式输出的 SSE 解析是否正常
- 验证错误重试和降级策略是否生效
- 每次测试记录请求参数和响应内容作为测试日志

---

## 九、开发工作流（强制）

> **此规则优先级高于一切。** 任何 Phase 在开始编码前，必须完成以下步骤。跳过此流程直接编码 = 违规。

### 执行铁律：写 Spec → 对抗审查 Spec → 编码 → Skill 对抗审查

```
编写 Spec → ChatST GPT 5.5 对抗审查 Spec → 审查通过？
                                                ↓ 否 → 修订 Spec → 重新审查（新对话，不告诉它是第几次）
                                                ↓ 是 → 编码实现 → adversarial-review Skill 对抗审查 → 通过？
                                                                                                  ↓ 否 → 修复 → 重新 Skill 审查
                                                                                                  ↓ 是 → 完成，进入下一个 Spec
```

### 步骤详解

#### 步骤 1：行动前先写 Spec

针对当前 Phase 的每个具体任务，先编写详细的实施 Spec，包括：
- 要改哪些文件、新增哪些文件
- 具体的接口定义、数据结构
- 与现有代码的交互方式
- 边界条件和异常处理
- 验收标准

#### 步骤 2：Spec 发给 ChatST GPT 5.5 做对抗审查

将 Spec + 完整项目上下文发给 ChatST 的 GPT 5.5（`F:\allmylife\chatst\chat.py`，模型 `gpt-5.5`），要求它以最严格、对抗性的立场审查：
- 不放水，不"基本通过"，要么完美要么不通过
- 特别关注：是否违反设计原则、是否喧宾夺主破坏自由画布、是否过度工程化、是否有数据安全风险
- 审查不通过就修订 Spec 重新提交（**每次都是新对话，不告诉它是第几次审查**）
- 直到审查通过才能开始编码

**降级方案**：如果 ChatST 额度用尽无法调用 GPT 5.5，则改用 sub agent（Task 工具，subagent_type=general_purpose_task）代替 GPT 5.5 做对抗审查。sub agent 审查标准与 GPT 5.5 一致，同样要求明确"通过/不通过"结论。

#### 步骤 3：编码实现

按照通过的 Spec 编码。

#### 步骤 4：使用 adversarial-review Skill 做对抗审查

编码完成后，**必须**使用 `adversarial-review` skill 进行对抗审查：
- Skill 会派遣独立智能体，主动探索项目代码和文件
- 以对抗性立场审查任务完成度、代码 bug、漏洞隐患和优化空间
- Skill 审查不通过则修复后重新使用 Skill 审查
- Skill 审查通过后才能确认该 Spec 任务完成，进入下一个 Spec

### 发给 ChatST GPT 5.5 的上下文清单（每次审查必须包含）

GPT 5.5 只能根据收到的文字做判断，无法主动查看项目文件。因此每次发送审查请求时，必须包含以下内容：

#### A. 项目全局上下文（每次必发）

| 内容 | 说明 | 来源 |
|---|---|---|
| 项目目的 | "以AI为主的自由画布式个人生活管理面板，服务于学习、工作、放松一体化" | roadmap_v3.md 项目定位 |
| 设计原则 | 完整列出9条设计原则，让GPT以此为审查基准 | roadmap_v3.md 设计原则章节 |
| 技术栈 | React 19 + TS + Vite + Zustand + Tailwind v4 + IndexedDB + MCP Server(长期) | roadmap_v3.md 技术栈 |
| 当前已有组件清单 | 16个组件及其功能、状态 | roadmap_v3.md 已有组件章节 |
| 核心个人数据模型 | 8个新增IndexedDB表的schema | roadmap_v3.md Phase 1 数据模型 |
| 不喧宾夺主约束 | AI默认包含但可删、画画需draw模式、搭线需connect模式、默认select、网格默认关 | roadmap_v3.md 关键设计决策 |
| 删除策略 | 删除组件不删除实体数据 | roadmap_v3.md 补充细节8.1 |

#### B. 当前 Phase 上下文（每次必发）

| 内容 | 说明 |
|---|---|
| 当前Phase编号和目标 | 如"Phase 2A：AI助手核心+核心个人数据组件" |
| 当前Phase的完整规划 | roadmap_v3.md 中对应Phase的所有内容 |
| 本Phase新增的IndexedDB store | 如有，包含完整schema |
| 本Phase的验收标准 | 完整列出 |

#### C. Spec 相关上下文（Spec 审查时必发）

| 内容 | 说明 |
|---|---|
| Spec 全文 | 完整的实施规格说明 |
| Spec 涉及的现有文件内容 | 被修改的文件的当前完整代码 |
| Spec 涉及的新文件 | 如有参考模板，附上相似组件的代码 |
| Spec 涉及的数据结构 | 相关的 TypeScript 类型定义 |
| Spec 与现有代码的交互点 | 哪些现有函数/接口会被调用或修改 |

#### 上下文精简原则

- 代码文件只发与当前 Spec 相关的部分，不发送无关文件
- 如果文件过长，只发送被修改的函数/类及其上下文（前后各 20 行）
- 类型定义发完整，不截断
- 不要省略任何错误处理逻辑
- 不要省略任何边界条件

### 审核历程记录

每个 Phase 的审核历程记录在此：

| Phase | Spec 审核轮次 | Skill 审核轮次 | 最终结论 |
|---|---|---|---|---|
| Phase 0 | - | - | - | 待执行 |
| Phase 1 | - | - | - | 待执行 |
| Phase 2A | - | - | - | 待执行 |
| Phase 2B | - | - | - | 待执行 |
| Phase 3 | - | - | - | 待执行 |
| Phase 4A | - | - | - | 待执行 |
| Phase 4B | - | - | - | 待执行 |
| Phase 5 | - | - | - | 待执行 |
