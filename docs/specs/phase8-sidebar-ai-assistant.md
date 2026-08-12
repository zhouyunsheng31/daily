# Phase 8 Spec：Sidebar AI 助手形态 + 会话管理 + askUserQuestion + API 配置预设

> 生成日期：2026-06-26
> 前置：Phase 0-7 全部已完成
> 范围：6 个核心改造模块（A 砍旧入口 / B Sidebar 改造 / C AI 会话管理 / D askUserQuestion / E API 配置预设 / F 权限请求与数据发送预览迁移）
> 路径说明：所有文件路径基于项目根目录 `f:\allmylife\event\`。客户端代码在 `client/desktop/`，服务端代码在 `server/`。

---

## 一、背景与目标

### 1.1 当前问题
- 桌面端有两个 AI 唤起入口：
  - Omnibox `ai:` 命令（半残品，没传 `callerWidgetId`，AI 操控不了网页）
  - Alt 全局输入（`GlobalQuickInput`，依赖 `activePanel` 有主 AI 助手 widget，看网页时经常失效）
- 这两个入口都是"临时弹窗"模式，不是常驻的，用户无法持续跟 AI 对话
- AI 会话不支持管理（不能删除/重命名/绑定面板/改 API 配置）
- 没有任何"AI 主动向用户提问"的机制（askUserQuestion）
- API 配置是全局单例（服务端 `ai_settings` 表），不能 per-session 配置

### 1.2 目标
1. **砍掉旧入口**：删除 Omnibox `ai:` 命令分支 + `GlobalQuickInput` 组件 + Alt 键监听
2. **Sidebar 改造**：在 Sidebar 顶部加 toggle，切换"画布面板"和"AI 助手"两种形态
3. **AI 会话管理**：支持新建/删除/重命名/绑定面板/改 API 配置，每个会话独立上下文
4. **askUserQuestion 工具**：新增 customTool `ask_user`，AI 主动向用户提问（选项框形式）
5. **API 配置预设**：支持多套 API 配置预设（endpoint + apiKey + model 列表），per-session 选用
6. **权限请求与数据发送预览迁移（模块 F）**：把 `GlobalQuickInput` 中的权限请求 UI 和数据发送预览 UI 迁移到 `AIAssistantSidebar` 对话流中（避免删除 GlobalQuickInput 后功能丢失）

### 1.3 设计原则
- 网页不动，AI 在 Sidebar 对话（类 VS Code 侧边栏聊天）
- AI 能自己探索当前网页（用 `browser_list_tabs` / `browser_screenshot` / `browser_get_dom` / `browser_navigate`）
- 绑定面板 = 操控组件 + 共享上下文数据
- 视觉风格：白色洁净、透明优先、毛玻璃效果

### 1.4 约束条件
- TypeScript 优先
- 不下载到 C 盘
- git 版本管理（新建 `feature/phase8` 分支，按模块分批 commit）
- 与移动端数据互通（共享服务器数据库，新字段需向后兼容）
- 不破坏 Phase 0-7 已完成功能
- 所有改动须通过 `npm run typecheck` + `npm run build`
- 对抗审查必须包含运行时验证（Electron + Playwright CDP 方案），不能只读代码

---

## 二、模块详细设计

### 模块 A：砍掉旧入口

#### A.1 删除 Omnibox `ai:` 命令

**文件**：`f:\allmylife\event\client\desktop\src\components\Omnibox.tsx`

**当前代码（L30-54）**：
```ts
const handleSubmit = async () => {
  const trimmed = value.trim()
  if (!trimmed) return
  if (trimmed.startsWith('ai: ')) {
    // 发送给 AI ← 砍掉这个分支
    const { useAIStore } = await import('../stores/useAIStore')
    const state = useAIStore.getState()
    if (state.activeSessionId) {
      state.sendMessage(state.activeSessionId, trimmed.slice(4))
    }
  } else if (trimmed.startsWith('/')) {
    await handleSlashCommand(trimmed)
  } else if (isUrl(trimmed)) {
    await navigateToUrl(trimmed)
  } else {
    // 搜索
  }
}
```

**改造**：
- 删除 `if (trimmed.startsWith('ai: '))` 分支（L34-40）
- 修改 placeholder（L138），去掉 "ai: 对话"提示
- 改造后 `handleSubmit`：
  ```ts
  const handleSubmit = async () => {
    const trimmed = value.trim()
    if (!trimmed) return
    if (trimmed.startsWith('/')) {
      await handleSlashCommand(trimmed)
    } else if (isUrl(trimmed)) {
      await navigateToUrl(trimmed)
    } else {
      // 搜索
    }
  }
  ```

#### A.2 删除 GlobalQuickInput 组件

**文件 1**：`f:\allmylife\event\client\desktop\src\components\GlobalQuickInput.tsx`
- 整个文件删除

**文件 2**：`f:\allmylife\event\client\desktop\src\App.tsx`
- 删除 import（L9）：`import GlobalQuickInput from './components/GlobalQuickInput'`
- 删除使用（L407）：`<GlobalQuickInput />`

#### A.3 删除 Alt 键监听
- `GlobalQuickInput.tsx` 删除后，Alt 键监听自然消失（L83-112 在该文件内）
- `useKeyboardShortcuts.ts` 中的 `Alt+ArrowLeft` / `Alt+ArrowRight` 是浏览器后退/前进，**不动**

#### A.4 验证点
- Omnibox 输入 `ai: 你好` 不再触发 AI 对话（按回车走搜索/URL 逻辑）
- 按 Alt 键不再弹窗
- `GlobalQuickInput.tsx` 文件不存在
- App.tsx 不再 import GlobalQuickInput
- `useKeyboardShortcuts.ts` 中 Alt+方向键的后退/前进功能仍正常

---

### 模块 B：Sidebar 改造

#### B.1 Sidebar 形态切换

**文件**：`f:\allmylife\event\client\desktop\src\components\Sidebar.tsx`

**新增 store 字段**（`useAppStore.ts`）：
```ts
interface AppState {
  // ...existing fields
  sidebarMode: 'canvas' | 'ai-assistant'  // 默认 'canvas'
  setSidebarMode: (mode: 'canvas' | 'ai-assistant') => void
}
```

**Sidebar 顶部 toggle 布局**：
```
┌─Sidebar 顶部─────────────────┐
│ [📋 画布面板] [💬 AI助手]    │ ← 切换按钮组
└──────────────────────────────┘
```

**toggle 样式规范**：
- 两个按钮并排，当前激活的高亮（`rgba(0,0,0,0.08)` 背景）
- 非激活的透明，hover 时 `rgba(0,0,0,0.05)`
- 圆角 8px，padding `8px 16px`，字号 12px
- 切换动画 `0.2s ease-in-out`
- 整组 toggle 容器：`rgba(0,0,0,0.03)` 背景，圆角 10px，内 padding 4px

**两种模式**：
- `canvas` 模式：保持现有 Sidebar 逻辑不变（panel-list + footer + 新建面板按钮）
- `ai-assistant` 模式：渲染新的 `AIAssistantSidebar` 组件

**Sidebar.tsx 改造伪代码**（M3 修复：不抽取 SidebarCollapsed / CanvasSidebar 子组件，折叠态和展开态逻辑保留在原文件内，仅添加 toggle 切换分支）：
```tsx
export const Sidebar: React.FC = () => {
  const sidebarMode = useAppStore(s => s.sidebarMode)
  const setSidebarMode = useAppStore(s => s.setSidebarMode)
  const collapsed = useAppStore(s => s.sidebarCollapsed)
  const setSidebarCollapsed = useAppStore(s => s.setSidebarCollapsed)

  if (collapsed) {
    // 折叠态：根据 sidebarMode 显示对应图标，点击整个条带展开（L2 修复）
    return (
      <aside className="sidebar sidebar-collapsed" onClick={() => setSidebarCollapsed(false)}>
        {sidebarMode === 'canvas'
          ? <PanelLeftOpen size={20} />   // canvas 模式显示展开图标
          : <Bot size={20} />}           // ai-assistant 模式显示 Bot 图标
      </aside>
    )
  }

  return (
    <aside className="sidebar">
      <div className="sidebar-toggle-group">
        <button
          className={sidebarMode === 'canvas' ? 'active' : ''}
          onClick={() => setSidebarMode('canvas')}
        >📋 画布面板</button>
        <button
          className={sidebarMode === 'ai-assistant' ? 'active' : ''}
          onClick={() => setSidebarMode('ai-assistant')}
        >💬 AI助手</button>
      </div>
      {/* 展开态：原 Sidebar 的 panel-list / footer / 新建按钮逻辑保留在原文件内（canvas 模式） */}
      {sidebarMode === 'canvas' ? (
        <>
          {/* 原 Sidebar.tsx 内 panel-list + footer + 新建面板按钮逻辑 */}
        </>
      ) : (
        <AIAssistantSidebar />
      )}
    </aside>
  )
}
```

> **M3 说明**：不新增 `SidebarCollapsed.tsx` 和 `CanvasSidebar.tsx` 文件。折叠态和展开态的 canvas 分支逻辑都保留在 `Sidebar.tsx` 内，仅通过 `sidebarMode` 和 `collapsed` 两个分支控制渲染。

#### B.2 AIAssistantSidebar 组件

**新增文件**：`f:\allmylife\event\client\desktop\src\components\AIAssistantSidebar.tsx`

**布局结构**（S4 修复：含权限请求卡片 + 数据发送预览卡片）：
```
┌─AIAssistantSidebar─────────────┐
│ 会话选择器（按钮 + 下拉菜单）    │
│ [N 个会话等待回答] 徽章（如有）  │
│ ──────────────────────────── │
│ 对话流区域（可滚动）            │
│  - 用户消息气泡                 │
│  - AI回复气泡                  │
│  - 工具调用卡片                │
│  - askUserQuestion 选项框       │
│  - 权限请求卡片（PermissionCard）│
│  - 数据发送预览卡片（DataSendPreviewCard）│
│  - Thinking 指示器              │
│ ──────────────────────────── │
│ pill输入框 + 发送按钮           │
│ [⚙️ API配置] [快速切换model]    │
└──────────────────────────────┘
```

> **卡片位置说明（S4）**：`PermissionCard` 和 `DataSendPreviewCard` 显示在对话流中（类似 `AskUserCard`，非模态弹窗），按 `callerWidgetId` / `sessionId` 过滤归属。优先级：`PermissionCard`（权限请求）> `DataSendPreviewCard`（数据发送预览）> `AskUserCard`（askUser）。

**会话选择器**：
- 按钮：显示当前会话名 + 绑定面板标识 + 下拉箭头 ▼
- 点击展开下拉菜单：
  - 会话列表（每项：会话名 + 绑定面板图标 + 右键触发菜单：重命名 / 删除 / 绑定面板 / 切换 API 配置）
  - 分隔线
  - "+ 新建会话" 按钮
  - "+ 管理 API 配置" 按钮
- 下拉菜单样式：半透明背景、毛玻璃（`backdrop-filter: blur(12px)`）、圆角 12px、阴影

**对话流样式规范**：
- 用户消息：右对齐，气泡背景 `rgba(0,0,0,0.05)`，圆角 12px
- AI 回复：左对齐，气泡背景 `rgba(0,0,0,0.03)`，圆角 12px
- 工具调用卡片：半透明背景 `rgba(0,0,0,0.03)` + 左侧色条标识
  - 蓝色 = 进行中
  - 绿色 = 成功
  - 红色 = 失败
  - 显示工具名 + 参数摘要 + 结果摘要
- askUserQuestion 选项框：内嵌卡片，显示问题文本 + 选项按钮列表，用户点击选项后显示选中态
- Thinking 指示器：三个跳动的点 + "思考中..." 文字

**输入区样式规范**：
- pill 形输入框（`border-radius: 9999px`），半透明背景 `rgba(0,0,0,0.04)`，聚焦时 `rgba(0,0,0,0.06)`
- 发送按钮（Send 图标）
- 底部行：API 配置入口（⚙️ 图标）+ 快速切换 model 下拉

**折叠态行为**（L2 修复，详见 B.1）：
- 折叠态新增 `sidebarMode` 切换图标：canvas 模式显示 `PanelLeftOpen`，ai-assistant 模式显示 `Bot`
- 点击整个折叠条带展开（不是只点图标）
- 折叠/展开态切换逻辑保留在 `Sidebar.tsx` 内（不抽取子组件）

#### B.3 浏览网页时的行为

**关键场景**：用户在浏览网页（`mainView.type === 'web-tab'`）时切换到 AI 助手模式

**行为规则**：
- 网页继续显示在主区域（不动）
- Sidebar 显示 AI 助手形态
- AI 发消息时，如果当前会话**绑定了面板**：用绑定的 `panelId` 发 WS 消息
- AI 发消息时，如果当前会话**没绑定面板**：fallback 到当前 `activePanelId`（仍是 null 才报错）
- 纯对话模式：当用户在 `web-tab` 模式打开 AI 助手且没绑定面板时，允许发送不带 `panelId` 的 `user_message`（仅文本对话，不调 `browser_*` 工具）。如果 AI 需要调 `browser_*` 工具但没绑定面板，服务端返回错误提示"请先绑定面板或打开一个网页"
- AI 调 `browser_*` 工具时：前端自动注入 `lastActiveWidgetId`（当前最后交互的 webview），如果没有 webview 注册则报错"请先打开一个网页"

**sendMessage 改造**（`useAIStore.ts:843-886`）：
```ts
sendMessage: async (sessionId, content, callerWidgetId?) => {
  const session = get().sessions[sessionId]
  if (!session) return

  // 改造点 1：优先用 session 绑定的 panelId，否则 fallback 到 activePanelId
  // 仅当 boundPanelId 与 activePanelId 均为 null 时，进入纯对话模式（panelId = undefined）
  const panelId = session.boundPanelId ?? getUseAppStore().getState().activePanelId ?? undefined

  // 改造点 2：apiKey 前置检查
  const preset = useApiConfigStore.getState().getPreset(session.apiConfigId)
  if (preset && !preset.apiKey) {
    appendAssistantMessage(sessionId, '[提示] 当前 API 配置未填写 apiKey，请先在 ⚙️ API 配置 中填写。')
    return
  }

  // 改造点 3：携带 apiConfig（从 session 选用的预设中取）
  const apiConfig = preset ? {
    endpoint: preset.endpoint,
    apiKey: preset.apiKey,
    model: session.modelId,
  } : undefined

  // 改造点 4：携带 callerWidgetId 到 WS（为 askUserQuestion 路由做准备）
  const sent = sendWs({ kind: 'user_message', panelId, content, sessionId, callerWidgetId, apiConfig })
  // ...
}
```

> **fallback 行为说明（S6）**：`session.boundPanelId` 为 `null` 时 fallback 到 `activePanelId`；仅当 `activePanelId` 也为 `null` 时才进入纯对话模式（发不带 `panelId` 的 `user_message`）。CanvasHome 通过 `ensurePrimarySession` 创建的 session 会自动设置 `boundPanelId = currentPanelId`，避免落到纯对话模式。

#### B.4 验证点
- Sidebar 顶部 toggle 显示两个按钮，切换正常
- canvas 模式下，原 Sidebar 行为不变（panel-list / footer / 新建按钮）
- ai-assistant 模式下，渲染 `AIAssistantSidebar`，对话流 + 输入框正常
- 浏览网页时切换到 AI 助手模式，网页不动，AI 助手在 Sidebar 显示
- AI 调 `browser_*` 工具时，能拿到 `lastActiveWidgetId` 操控网页

---

### 模块 C：AI 会话管理

#### C.1 数据结构改造

**SessionState 新增字段**（`f:\allmylife\event\client\desktop\src\types\ai.ts:124-149`）：
```ts
export interface SessionState {
  sessionId: string
  messages: ChatMessage[]
  createdAt: number
  updatedAt: number
  model: string                    // @deprecated 由 modelId 取代（L1 修复，保留以兼容）
  // 当前 status：'idle' | 'thinking' | 'tool_calling' | 'waiting_confirmation' | 'error'
  // 新增 waiting_user_input（与 waiting_confirmation 是两个独立状态）
  status: 'idle' | 'thinking' | 'tool_calling' | 'waiting_confirmation' | 'waiting_user_input' | 'error'
  error?: string
  authorizedPrivateStores: string[]
  hasConfirmedFirstSend: boolean
  confirmedDataCategories: Set<string>
  confirmedModel: string | null
  role: string
  pendingSendPreview?: DataSendPreview

  // === 新增字段 ===
  title: string                    // 会话名称（用户可重命名）
  boundPanelId: string | null      // 绑定的面板 ID（null = 未绑定）
  apiConfigId: string               // 使用的 API 配置预设 ID
  modelId: string                  // 当前选用的 model（从 apiConfig 的 models 中选，取代 model 字段）
}
```

**status 字段说明（S2 修复）**：
- 现有值（保持不变）：`'idle'` / `'thinking'` / `'tool_calling'` / `'waiting_confirmation'`（权限请求等待）/ `'error'`
- 新增值：`'waiting_user_input'`（askUserQuestion 等待）
- **`waiting_confirmation` 与 `waiting_user_input` 是两个独立状态**：
  - `waiting_confirmation`：AI 请求执行危险操作（如发送数据），需要用户 allow/deny 权限
  - `waiting_user_input`：AI 主动提问，需要用户从选项中选择答案
- **同时出现时的优先级**：`waiting_confirmation` 优先。先处理权限请求（allow/deny），处理完后再处理 askUserQuestion。即：当 `pendingPermissionRequests` 非空时，UI 优先展示权限卡片；权限处理完后若仍有 `pendingAskUserRequests`，再展示 askUser 卡片。

#### C.2 会话 CRUD 操作

**useAIStore 新增方法**：
```ts
interface AIStore {
  // ...existing methods

  // 新建会话
  createSession: (options?: {
    title?: string
    boundPanelId?: string
    apiConfigId?: string
    modelId?: string
  }) => string

  // 删除会话（已有，但需增强：同时清理服务端 session）
  deleteSession: (sessionId: string) => void

  // 重命名会话
  renameSession: (sessionId: string, newTitle: string) => void

  // 绑定面板
  bindPanelToSession: (sessionId: string, panelId: string | null) => void

  // 切换 API 配置
  setSessionApiConfig: (sessionId: string, apiConfigId: string) => void

  // 切换 model
  setSessionModel: (sessionId: string, modelId: string) => void
}
```

**实现要点**：
- `createSession`：生成 `sessionId`（UUID），初始化 `SessionState`，自动选用默认 API 预设和首个 model，加入 `sessions` Map，同步写入 `sessionList` 到 localStorage
- `deleteSession`：从 `sessions` 移除 + 从 `sessionList` 移除 + 同步 localStorage + **调用服务端 `disposePanelSession(panelId)` 清理服务端 session（通过 `dispose_session` WS 消息，见 E.3）**
- `renameSession` / `bindPanelToSession` / `setSessionApiConfig` / `setSessionModel`：更新 `sessions[sessionId]` + 同步 `sessionList` localStorage

**删除会话后的 UI 行为（M5 修复）**：
- 自动切换到下一个会话（按 `createdAt` 升序，取被删会话之后的第一个；若已是最后一个，取前一个）
- 若删除后无任何会话，显示空状态并提示"点击 + 新建会话 开始对话"
- 删除会话时同步调用服务端 `disposePanelSession(panelId)`（通过 `dispose_session` WS 消息）清理服务端 session

**ensurePrimarySession 改造（M10 修复）**：
- 保留 `ensurePrimarySession`（CanvasHome 仍依赖，见 S5），但改造为：
  - 创建的 session 加入新 `sessionList`（写入 localStorage）
  - 设置 `boundPanelId = currentPanelId`（避免落到纯对话模式）
  - `primaryAISessionId` 仍设置（兼容 CanvasHome），但标记为 `@deprecated`
- 新逻辑使用 `sessionList` 中的 activeSessionId 作为当前活跃会话

#### C.3 会话列表数据源

**现状**：`sessions` 仅在内存，不持久化，刷新即丢。

**改造方案**（分两步）：
- **Phase 8.1（本 spec）**：`sessions` 仍在内存，但新增 `sessionList` 持久化到 localStorage（仅存元数据：`sessionId` / `title` / `boundPanelId` / `apiConfigId` / `modelId` / `createdAt` / `updatedAt` / `lastActivityAt` / `messageCount`）
- **Phase 8.2（后续）**：接入服务端 API 持久化完整 session 数据

> **已知问题（M9 修复）**：`sessionList` 持久化但 `sessions`（含 `messages`）不持久化，会导致刷新后状态不一致（列表有会话但点进去是空的）。Phase 8.1 至少实现 `loadSessionHistory` 从服务端 `ai_conversations` 表读取历史 messages 回填到当前 session 的 `messages`，缓解此问题。`sessionList` 中显示"上次活动时间"（`lastActivityAt`）和"消息数"（`messageCount`）让用户识别会话。

**sessionList 结构**（localStorage key: `ai-session-list`）：
```ts
interface SessionMeta {
  sessionId: string
  title: string
  boundPanelId: string | null
  apiConfigId: string
  modelId: string
  createdAt: number
  updatedAt: number
  lastActivityAt: number    // M9：上次活动时间，用于列表显示
  messageCount: number     // M9：消息数，用于列表显示
}
```

**加载逻辑**：
- 应用启动时从 localStorage 读 `sessionList`，恢复元数据到 `sessions`（`messages` 为空）
- 用户首次切换到某 session 时，调用 `loadSessionHistory(sessionId)` 从服务端 `ai_conversations` 表读取历史 messages 回填
- 若服务端无历史（新会话或服务端已清理），显示空对话（重新开始）
- 每次 `sendMessage` / 收到 AI 回复时，更新 `sessionList` 中对应项的 `lastActivityAt` 和 `messageCount`

#### C.4 客户端-服务端 session 映射

**现状矛盾**：客户端全局只有一个 `primaryAISessionId`，但服务端按 `panelId` 维护独立 session。

**依赖现状澄清（S5 修复）**：
- 依赖 `primaryAISessionId` 的是 **CanvasHome**（`CanvasHome.tsx:72`），不是 `AIAssistant` widget
- `AIAssistant.tsx:57` 用的是 `widgetState.sessionId || activeSessionId`，不依赖 `primaryAISessionId`

**改造方案**：
- 客户端不再使用全局 `primaryAISessionId`
- 改为 per-session 的 `boundPanelId`：每个 AI 会话绑定一个面板
- `sendMessage` 时用 `session.boundPanelId` 作为 `panelId` 发 WS
- 服务端 `getOrCreatePanelSession(panelId)` 自然按 panelId 隔离

**CanvasHome.tsx 改造方案（S5 修复）**：
- 保留 `ensurePrimarySession` 调用，但改造其行为（见 M10）：
  - 创建的 session 加入 `sessionList`（写入 localStorage）
  - 设置 `boundPanelId = activePanelId`（自动绑定当前面板）
- `primaryAISessionId` 仍设置（兼容 CanvasHome L72 的读取），但标记为 `@deprecated`
- 新逻辑使用 `sessionList` 中的 activeSessionId（新增字段）作为当前活跃会话
- CanvasHome 不再独占"主会话"概念，会话由 sidebar 统一管理

**迁移策略**：
- `primaryAISessionId` 字段保留但标记为 `@deprecated`
- 新逻辑不依赖它，仅在向后兼容时（CanvasHome / 老 AIAssistant widget）才读
- 新建 session 时不再设置 `primaryAISessionId`
- 老的 `AIAssistant` widget 仍可工作（不破坏 Phase 0-7 功能），但其会话不在新的 `sessionList` 中管理

#### C.5 验证点
- 新建会话：在会话选择器中点击 "+ 新建会话"，能创建并自动切换到新会话
- 删除会话：右键会话 → 删除，会话从列表消失，localStorage 同步更新，**自动切换到下一个会话（M5）**，**服务端 session 被 dispose（S3）**
- 重命名会话：右键会话 → 重命名 → 输入新名 → 列表更新
- 绑定面板：右键会话 → 绑定面板 → 选择面板 → 会话标识更新
- 切换 API 配置：右键会话 → 切换 API 配置 → 选择预设 → 会话使用新配置，**服务端旧 session 被 dispose 后重建（S3）**
- 切换 model：在会话选择器旁的 model 下拉切换 → 会话使用新 model
- 刷新应用：sessionList 从 localStorage 恢复，元数据正确显示（含 `lastActivityAt` / `messageCount`，M9）
- 多会话独立：A 会话的对话不影响 B 会话
- `loadSessionHistory` 能从服务端回填历史 messages（M9）
- 删除最后一个会话后显示空状态并提示新建（M5）

---

### 模块 D：askUserQuestion 工具

#### D.1 服务端工具注册

**文件**：`f:\allmylife\event\server\src\piBridge.ts`

**新增 customTool `ask_user`**：
```ts
import { Type } from 'typebox'

const askUserTool: ToolDefinition = {
  name: 'ask_user',
  description: 'Ask the user a question with selectable options. Use this when you need user input to proceed. The user will see a card with options to choose from. This does NOT stop the AI - the user can answer while AI continues thinking about other things.',
  inputSchema: Type.Object({
    question: Type.String({ description: 'The question to ask the user' }),
    options: Type.Array(Type.Object({
      label: Type.String({ description: 'Short label for the option' }),
      description: Type.Optional(Type.String({ description: 'Optional longer description of this option' })),
      value: Type.String({ description: 'The value to return when this option is selected' }),
    }), { minItems: 2, maxItems: 4 }),
    allowMultiple: Type.Optional(Type.Boolean({ description: 'Whether to allow multiple selections. Default: false' })),
  }),
  execute: async (args) => {
    const { question, options, allowMultiple } = args
    const panelId = getCurrentPanelId()
    if (!panelId) throw new Error('No panel context for ask_user')

    // 直接返回 executeAskUser 的 Promise（M12 修复：去掉冗余 Promise 包装）
    return executeAskUser(panelId, question, options, allowMultiple ?? false)
  },
```

#### D.2 WS 消息协议扩展

> **风格规范（L7 修复）**：所有 WS 消息类型统一字段顺序为 `kind` → `panelId`（如有）→ `requestId`（如有）→ 业务字段；可选字段统一标注 `?`。

**新增 ServerMessage 类型**（服务端 → 客户端）：
```ts
| {
    kind: 'ask_user'
    panelId: string
    requestId: string
    question: string
    options: AskUserOption[]
    allowMultiple: boolean
  }
```

```ts
interface AskUserOption {
  label: string
  description?: string
  value: string
}
```

**新增 ClientMessage 类型**（客户端 → 服务端）：
```ts
| {
    kind: 'ask_user_response'
    panelId: string              // 保留以向后兼容（L3 修复）
    requestId: string
    selectedValues: string[]
  }
```

> **L3 说明**：`panelId` 在 `ask_user_response` 中冗余（`requestId` 已唯一标识 pending 请求），但保留以向后兼容。安全检查以 `requestId` 在 `askUserPending` Map 中能命中为准（`requestId` 由 `randomUUID()` 生成，不可猜测）；不再要求 `pending.panelId === msg.panelId` 严格相等。

#### D.3 服务端 executeAskUser 实现

```ts
// 在 piBridge.ts 顶部维护 pending Map
interface AskUserPending {
  resolve: (value: unknown) => void
  reject: (reason: Error) => void
  timer: NodeJS.Timeout
  panelId: string
}

const askUserPending = new Map<string, AskUserPending>()

function executeAskUser(
  panelId: string,
  question: string,
  options: AskUserOption[],
  allowMultiple: boolean
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const requestId = randomUUID()
    const timer = setTimeout(() => {
      askUserPending.delete(requestId)
      reject(new Error('ask_user timeout (60s)'))
    }, 60000)  // 60s 超时

    askUserPending.set(requestId, { resolve, reject, timer, panelId })

    const targetDeviceId = panelActiveDevices.get(panelId)
    if (!targetDeviceId) {
      clearTimeout(timer)
      askUserPending.delete(requestId)
      reject(new Error(`No active device for panel ${panelId}`))
      return
    }

    sendToDevice(targetDeviceId, {
      kind: 'ask_user',
      panelId,
      requestId,
      question,
      options,
      allowMultiple,
    })
  })
}

// 处理客户端回答（L3 修复：安全检查以 requestId 命中为准，不再校验 panelId 严格相等）
function handleAskUserResponse(msg: AskUserResponseMessage) {
  const pending = askUserPending.get(msg.requestId)
  if (!pending) return  // 已超时或不存在
  clearTimeout(pending.timer)
  askUserPending.delete(msg.requestId)
  pending.resolve(msg.selectedValues)
}
```

#### D.4 客户端 UI

**新增组件**：`f:\allmylife\event\client\desktop\src\components\AskUserCard.tsx`

**触发流程**：
1. `useAIStore` 的 `handleServerMessage` 收到 `kind: 'ask_user'` 时：
   - 存入 `pendingAskUserRequests` Map（类似 `pendingPermissionRequests`），记录 `sessionId` 归属
   - 把 askUser 消息追加到**对应 `sessionId` 的**会话的 `messages`（作为特殊消息类型，按 `panelId → sessionId` 映射）
   - 设置该 session status 为 `waiting_user_input`

**会话切换时的行为（M6 修复）**：
- askUser 卡片属于特定 session（按 `sessionId` 归属），切换会话时新会话不显示原 askUser 卡片
- 用户回到原会话时卡片仍在，可继续回答
- AIAssistantSidebar 顶部用全局徽章显示"N 个会话等待你的回答"（聚合所有 session 的 `pendingAskUserRequests` 数量），点击徽章跳转到第一个等待会话

**callerWidgetId 注入说明（L6 修复）**：
- 现有 `wsToolHandlers.ts:502` 中 `lastActiveWidgetId` 逻辑已满足 `callerWidgetId` 注入需求，无需新增改造
- 客户端 `sendMessage` 透传 `callerWidgetId` 即可，服务端 `ask_user` 工具通过 `getCurrentPanelId()` 拿到 panel 上下文

**用户交互**：
- askUser 卡片显示在对话流中（不是模态弹窗）
- 显示问题文本 + 选项按钮列表
- 用户点击选项 → 调 `respondToAskUser(requestId, [selectedValue])` → 发 WS `ask_user_response`
- 如果 `allowMultiple`：显示 checkbox + "确认"按钮；否则单选，点击即提交
- 提交后卡片变为"已回答"状态（显示选中项，禁用交互）

**ChatMessage 扩展**（`types/ai.ts`）：
```ts
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
  toolCalls?: ToolCallRequest[]
  toolCallId?: string
  timestamp: number
  // === 新增 ===
  askUser?: {
    requestId: string
    question: string
    options: AskUserOption[]
    allowMultiple: boolean
    answered: boolean
    selectedValues?: string[]
  }
}
```

**useAIStore 新增方法**：
```ts
interface AIStore {
  // ...existing
  pendingAskUserRequests: Map<string, AskUserPendingRequest>
  respondToAskUser: (requestId: string, selectedValues: string[]) => void
}

interface AskUserPendingRequest {
  requestId: string
  sessionId: string
  question: string
  options: AskUserOption[]
  allowMultiple: boolean
  panelId: string
}
```

**respondToAskUser 实现**：
```ts
respondToAskUser: (requestId, selectedValues) => {
  const pending = get().pendingAskUserRequests.get(requestId)
  if (!pending) return

  // 发 WS 回复
  sendWs({
    kind: 'ask_user_response',
    requestId,
    selectedValues,
    panelId: pending.panelId,
  })

  // 更新对应 message 的 askUser 状态
  const session = get().sessions[pending.sessionId]
  if (session) {
    session.messages = session.messages.map(m =>
      m.askUser?.requestId === requestId
        ? { ...m, askUser: { ...m.askUser, answered: true, selectedValues } }
        : m
    )
    // 恢复 session 状态
    if (session.status === 'waiting_user_input') {
      session.status = 'thinking'
    }
  }

  get().pendingAskUserRequests.delete(requestId)
}
```

#### D.5 验证点
- AI 调 `ask_user` 工具 → 客户端在对话流中显示选项卡片（非模态）
- 卡片显示问题文本 + 选项按钮
- 单选模式：点击选项即提交
- 多选模式：显示 checkbox + "确认"按钮，点确认后提交
- 提交后卡片变为"已回答"状态（显示选中项，禁用交互）
- AI 收到用户回答后继续执行
- 60s 超时：AI 收到错误，会话状态恢复
- 安全检查：以 `requestId` 在 `askUserPending` Map 中命中为准（L3，不再要求 panelId 严格相等）

---

### 模块 E：API 配置预设

#### E.1 数据结构

**新增文件**：`f:\allmylife\event\client\desktop\src\types\apiConfig.ts`

```ts
export interface ApiConfigPreset {
  id: string
  name: string                    // 配置名称（如 "DeepSeek 官方"）
  endpoint: string                // API endpoint URL
  apiKey: string                  // API Key（客户端存储，掩码显示）
  models: string[]                // 该配置支持的 model 列表
  createdAt: number
  updatedAt: number
}
```

**存储**：localStorage key `ai-api-config-presets`（参考 `utils/apiConfigStore.ts` 的设计——当前为孤立模块、无任何 import，本 spec 将建立真正生效的多预设版本；新文件放在 `stores/useApiConfigStore.ts`，改造为多预设 + models 数组）

**默认预设**：
```ts
const DEFAULT_PRESETS: ApiConfigPreset[] = [
  {
    id: 'default-deepseek',
    name: 'DeepSeek 官方',
    endpoint: 'https://api.deepseek.com/v1/chat/completions',
    apiKey: '',
    models: ['deepseek-chat', 'deepseek-coder', 'deepseek-reasoner'],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  },
]
```

#### E.2 CRUD 操作

**新增 store**：`f:\allmylife\event\client\desktop\src\stores\useApiConfigStore.ts`（参考 `utils/apiConfigStore.ts` 孤立模块的设计，新建真正生效的 zustand store）

```ts
interface ApiConfigStore {
  presets: ApiConfigPreset[]
  activePresetId: string  // 全局默认预设

  createPreset: (data: Omit<ApiConfigPreset, 'id' | 'createdAt' | 'updatedAt'>) => string
  updatePreset: (id: string, updates: Partial<ApiConfigPreset>) => void
  deletePreset: (id: string) => void
  getPreset: (id: string) => ApiConfigPreset | undefined
  setActivePreset: (id: string) => void

  // model 管理
  addModel: (presetId: string, model: string) => void
  removeModel: (presetId: string, model: string) => void
}
```

**实现要点**：
- 所有 CRUD 操作后同步写入 localStorage
- `createPreset`：生成 UUID，加入 `presets`，第一个 preset 自动设为 `activePresetId`
- `deletePreset`：移除 preset；如果删除的是 `activePresetId`，自动切换到第一个；如果删完没有 preset，恢复默认预设
- `addModel` / `removeModel`：操作 `preset.models` 数组，去重

#### E.3 服务端配合

**现状**：服务端 `ai_settings` 表是全局单例，`createSession` 时读取并固化到 session 实例中。

**关键代码位置**：
- `piBridge.ts:103-128 getOrCreatePanelSession`：首次创建/复用 session 的入口（首次创建时读 `ai_settings` 并固化）
- `piBridge.ts:760-829 createSession`：实际创建 session 的实现（含 `ai_settings` 读取逻辑）

**改造**（`piBridge.ts:103-128 getOrCreatePanelSession` + `piBridge.ts:760-829 createSession`）：
- 服务端不再从全局 `ai_settings` 读配置
- 改为接收客户端传来的 `apiConfigId`，在 `user_message` WS 消息中携带
- 服务端按 `apiConfigId` 从客户端传来的配置中读取 endpoint/apiKey/model

**WS 消息扩展**：
```ts
// user_message 扩展（新增 apiConfig 和 callerWidgetId 字段，都是可选的，向后兼容）
| {
    kind: 'user_message'
    panelId?: string              // 可选，纯对话模式时不带
    content: string
    sessionId: string
    apiConfig?: {
      endpoint: string
      apiKey: string
      model: string
    }
    callerWidgetId?: string
  }
```

**新增 `dispose_session` WS 消息类型**（S3 修复）：

由于 `getOrCreatePanelSession` 首次创建 session 时读配置并固化，之后再调用直接返回旧 session，切换 API 配置不生效。因此客户端切换 API 配置时，必须显式让服务端 dispose 旧 session。

```ts
// ClientMessage 扩展（客户端 → 服务端）
| {
    kind: 'dispose_session'
    panelId: string
  }
```

```ts
// 服务端新增 disposePanelSession 函数（piBridge.ts）
function disposePanelSession(panelId: string): void {
  const session = panelSessions.get(panelId)
  if (session) {
    // 清理 session 持有的资源（OpenAI client / pending askUser / 定时器等）
    panelSessions.delete(panelId)
  }
}

// WS 处理
if (msg.kind === 'dispose_session') {
  disposePanelSession(msg.panelId)
  return
}
```

**客户端调用时机**：
- 用户在会话选择器切换 API 配置预设时，先发送 `dispose_session` 清理服务端旧 session
- 下次 `user_message` 时，`getOrCreatePanelSession` 会重新创建 session，读取新配置
- 删除客户端 session 时，也调用 `dispose_session` 清理服务端

> **中期方案（Phase 8.2 改进）**：将服务端改为 per-session 的 OpenAI client 实例（每个 `panelSession` 持有自己的 client），切换 API 配置时直接重建 client，无需 dispose 整个 session。本 spec 暂用 dispose 方案。

**服务端 user_message 处理**：
```ts
if (msg.kind === 'user_message') {
  // 如果携带 apiConfig，用它覆盖默认配置（per-session）
  if (msg.apiConfig) {
    // 注入到环境变量（临时，仅当前请求周期）
    // 注意：这是临时方案，后续应改为 per-session 的 OpenAI client 实例
    process.env.PI_API_ENDPOINT = msg.apiConfig.endpoint
    process.env.PI_API_KEY = msg.apiConfig.apiKey
    // model 在 createSession 时设置
  }
  // ...
}
```

**安全考虑**：
- API Key 在 WS 消息中传输（仅在内网/本地，跟现有 ai_settings HTTP API 传输方式一致）
- 如果部署到公网，必须用 `wss://` 加密
- API Key 在 localStorage 中明文存储（跟现有 `utils/apiConfigStore.ts` 一致），UI 显示时掩码（如 `sk-***...***`）

#### E.4 UI 组件

**API 配置弹窗**：`f:\allmylife\event\client\desktop\src\components\ApiConfigModal.tsx`
- 预设列表（左侧）：显示所有预设，当前选中的高亮
- 编辑区（右侧）：
  - 配置名称（输入框）
  - endpoint（输入框）
  - apiKey（掩码输入框，可切换显示/隐藏）
  - models（chip 增删：输入框 + 添加按钮，已添加的显示为 chip 带 × 关闭）
- 底部按钮：新建预设 / 删除预设 / 保存
- 弹窗样式：居中模态，毛玻璃背景，圆角 16px，阴影

**快速切换 model**：会话选择器旁边的下拉
- 显示当前 model 名
- 点击展开该预设的所有 model 选项
- 选中后切换 `session.modelId`

#### E.5 验证点
- API 配置弹窗能 CRUD 预设
- models chip 增删正常
- localStorage 持久化（刷新应用后预设仍在）
- 快速切换 model 下拉显示当前预设的所有 model
- 切换 model 后 session 使用新 model
- 服务端能接收 `apiConfig` 并使用客户端配置
- API Key 在 UI 中掩码显示
- 切换 API 配置时 `dispose_session` 生效，旧 session 配置不固化（S3）

---

### 模块 F：权限请求与数据发送预览迁移（S4 修复）

> **背景**：模块 A 删除 `GlobalQuickInput` 会连带丢失两个关键功能——权限请求 UI 和数据发送预览 UI。本模块把这两个功能迁移到 `AIAssistantSidebar` 的对话流中（与 `AskUserCard` 同级显示）。

#### F.1 权限请求 UI 迁移（PermissionCard）

**新增组件**：`f:\allmylife\event\client\desktop\src\components\PermissionCard.tsx`

**迁移来源**：`GlobalQuickInput.tsx` 中的权限请求处理逻辑

**功能清单**：
- 监听 `useAIStore` 的 `pendingPermissionRequests`（已有数据结构）
- 按 `callerWidgetId` 过滤，只显示属于当前 AI 会话绑定面板的权限请求
- 显示权限请求卡片：操作描述 + 调用方信息 + Allow / Deny 按钮
- `dangerous` 标记的请求二次确认（点击 Allow 后弹"确定？"确认）
- Allow / Deny 后发 WS `permission_response` 回复服务端

**PermissionCard 样式规范**：
- 卡片背景 `rgba(0,0,0,0.03)` + 左侧橙色色条标识（dangerous 为红色）
- 圆角 12px，padding 12px
- Allow 按钮：绿色文字；Deny 按钮：红色文字
- 已处理后显示状态（"已允许" / "已拒绝"），禁用交互

#### F.2 数据发送预览 UI 迁移（DataSendPreviewCard）

**新增组件**：`f:\allmylife\event\client\desktop\src\components\DataSendPreviewCard.tsx`

**迁移来源**：`GlobalQuickInput.tsx` 中的 `pendingSendPreview` 处理逻辑

**功能清单**：
- 监听 `useAIStore` 的 `pendingSendPreview`（已有数据结构，`SessionState.pendingSendPreview`）
- 显示数据发送预览卡片：接收方 + 数据摘要 + 分类标签
- Confirm / Reject 按钮
- Confirm 后发 WS 确认消息；Reject 后取消发送

**DataSendPreviewCard 样式规范**：
- 卡片背景 `rgba(0,0,0,0.03)` + 左侧蓝色色条标识
- 圆角 12px，padding 12px
- 数据摘要可展开/折叠（默认折叠显示前 3 行）
- Confirm 按钮：绿色文字；Reject 按钮：灰色文字

#### F.3 验证点
- AI 请求权限时，对话流中显示 `PermissionCard`（非模态弹窗）
- Allow / Deny 操作正常，dangerous 请求有二次确认
- AI 发送数据前，对话流中显示 `DataSendPreviewCard`
- Confirm / Reject 操作正常
- 删除 `GlobalQuickInput.tsx` 后，权限请求和数据发送预览功能仍可用
- 按 `callerWidgetId` 过滤：只显示当前会话绑定面板的请求

---

## 三、实施计划

### 3.1 文件改动清单

| 文件 | 操作 | 内容 |
|------|------|------|
| `client/desktop/src/components/Omnibox.tsx` | 修改 | 删除 `ai:` 分支，修改 placeholder |
| `client/desktop/src/components/GlobalQuickInput.tsx` | 删除 | 整个文件删除（权限/数据预览功能迁移到模块 F） |
| `client/desktop/src/App.tsx` | 修改 | 删除 GlobalQuickInput import 和使用 |
| `client/desktop/src/components/Sidebar.tsx` | 修改 | 增加 toggle，条件渲染 canvas/ai-assistant；折叠态逻辑保留本文件（M3：不抽取子组件） |
| `client/desktop/src/components/AIAssistantSidebar.tsx` | 新建 | AI 助手形态组件（含会话选择器、对话流、输入区、PermissionCard/DataSendPreviewCard/AskUserCard 集成） |
| `client/desktop/src/components/AskUserCard.tsx` | 新建 | askUserQuestion 选项卡片 |
| `client/desktop/src/components/PermissionCard.tsx` | 新建 | 权限请求卡片（模块 F，迁移自 GlobalQuickInput） |
| `client/desktop/src/components/DataSendPreviewCard.tsx` | 新建 | 数据发送预览卡片（模块 F，迁移自 GlobalQuickInput） |
| `client/desktop/src/components/ApiConfigModal.tsx` | 新建 | API 配置弹窗 |
| `client/desktop/src/components/CanvasHome.tsx` | 修改 | S5：保留 `ensurePrimarySession` 但改造为加入 sessionList + 设置 boundPanelId |
| `client/desktop/src/stores/useAppStore.ts` | 修改 | 新增 `sidebarMode` 字段 |
| `client/desktop/src/stores/useAIStore.ts` | 修改 | 新增会话 CRUD、askUser 处理、sendMessage 改造；**ClientMessage 扩展**（`user_message` 新增 `sessionId`/`apiConfig`/`callerWidgetId` 可选字段，新增 `dispose_session`/`ask_user_response` 类型）；**ServerMessage 扩展**（新增 `ask_user` 类型） |
| `client/desktop/src/stores/useApiConfigStore.ts` | 新建 | API 配置预设管理（参考 `utils/apiConfigStore.ts` 孤立模块设计） |
| `client/desktop/src/types/ai.ts` | 修改 | SessionState 新增字段，ChatMessage 新增 askUser |
| `client/desktop/src/types/apiConfig.ts` | 新建 | ApiConfigPreset 类型 |
| `server/src/piBridge.ts` | 修改 | 新增 `ask_user` 工具注册、`user_message` 处理 apiConfig、`disposePanelSession` 函数、`executeAskUser` 实现 |
| `server/src/ws.ts` | 修改 | M2：WS 消息类型扩展（`ClientMessage` 新增 `dispose_session`/`ask_user_response`；`ServerMessage` 新增 `ask_user`） |

> **M2 说明**：客户端 `ClientMessage`/`ServerMessage` 类型定义在 `useAIStore.ts:57-71`，服务端 WS 类型在 `ws.ts:14-31`。两边需同步扩展。

### 3.2 实施顺序

```
批次 1：模块 A 砍旧入口
  - Omnibox.tsx 删除 ai: 分支
  - GlobalQuickInput.tsx 删除
  - App.tsx 清理
  ↓
批次 2：模块 E API 配置预设
  - types/apiConfig.ts 新建
  - useApiConfigStore.ts 新建
  - ApiConfigModal.tsx 新建
  （C 依赖 E，所以先做 E）
  ↓
批次 3：模块 C AI 会话管理
  - types/ai.ts 修改 SessionState + ChatMessage
  - useAIStore.ts 新增 CRUD + sessionList 持久化 + sendMessage 改造
  - CanvasHome.tsx 改造 ensurePrimarySession（S5/M10）
  ↓
批次 4：模块 B Sidebar 改造
  - useAppStore.ts 新增 sidebarMode
  - Sidebar.tsx 增加 toggle + 条件渲染（含折叠态，M3/L2）
  - AIAssistantSidebar.tsx 新建（会话选择器 + 对话流 + 输入区）
  ↓
批次 5：模块 D askUserQuestion + 模块 F 权限/数据预览迁移
  - server/src/piBridge.ts 新增 ask_user 工具 + executeAskUser + disposePanelSession + WS 协议
  - server/src/ws.ts 扩展 WS 类型（M2）
  - useAIStore.ts 新增 pendingAskUserRequests + respondToAskUser + ClientMessage/ServerMessage 扩展
  - AskUserCard.tsx 新建
  - PermissionCard.tsx 新建（模块 F）
  - DataSendPreviewCard.tsx 新建（模块 F）
  - AIAssistantSidebar 集成 AskUserCard + PermissionCard + DataSendPreviewCard（L4：本步骤依赖批次 4 已完成 AIAssistantSidebar 骨架）
```

每批完成后：对抗审查（含运行时验证）→ git commit → 下一批。

### 3.3 Git 策略
- 新建分支 `feature/phase8`（从 main）
- 每批完成后 commit，commit message 格式：`feat(phase8): <batch summary>`
- 全部完成后合并回 main

---

## 四、验证标准

### 4.1 模块级验证

**模块 A（砍旧入口）**：
- Omnibox 输入 `ai: 你好` 不再触发 AI 对话
- 按 Alt 键不再弹窗
- `GlobalQuickInput.tsx` 文件不存在
- App.tsx 不再 import GlobalQuickInput
- `useKeyboardShortcuts.ts` 中 Alt+方向键的后退/前进功能仍正常
- `npm run typecheck` 通过

**模块 B（Sidebar 改造）**：
- Sidebar 顶部 toggle 显示两个按钮，切换正常
- canvas 模式下，原 Sidebar 行为不变
- ai-assistant 模式下，渲染 AIAssistantSidebar
- 浏览网页时切换到 AI 助手模式，网页不动
- AI 调 `browser_*` 工具时能操控网页
- 折叠态：48px 宽，按 `sidebarMode` 显示对应图标（canvas 显示 `PanelLeftOpen`，ai-assistant 显示 `Bot`），点击整个条带展开（L2）

**模块 C（AI 会话管理）**：
- 新建/删除/重命名/绑定面板/切换 API 配置都能正常工作
- sessionList 持久化到 localStorage
- 刷新应用后 sessionList 恢复
- 多会话独立：A 会话的对话不影响 B 会话
- `sendMessage` 优先用 `session.boundPanelId`，fallback 到 `activePanelId`
- 删除当前活跃会话后自动切换到下一个（M5）
- 切换会话时调用 `dispose_session` 清理服务端 session（S3）
- `loadSessionHistory` 能从服务端回填历史 messages（M9）

**模块 D（askUserQuestion）**：
- AI 调 `ask_user` → 客户端显示选项卡片
- 单选：点击即提交
- 多选：checkbox + 确认按钮
- 提交后卡片变"已回答"状态
- AI 收到回答继续执行
- 60s 超时：AI 收到错误
- 安全检查：以 `requestId` 命中为准（L3，不再要求 panelId 严格相等）
- 会话切换时 askUser 卡片归属正确（M6），顶部徽章显示等待数

**模块 E（API 配置预设）**：
- API 配置弹窗能 CRUD 预设
- models chip 增删正常
- localStorage 持久化
- 快速切换 model 下拉正常
- 服务端接收 `apiConfig` 并使用客户端配置
- 切换 API 配置时 `dispose_session` 生效（S3）

**模块 F（权限请求与数据发送预览迁移）**：
- AI 请求权限时，对话流中显示 `PermissionCard`（非模态弹窗）
- Allow / Deny 操作正常，dangerous 请求有二次确认
- AI 发送数据前，对话流中显示 `DataSendPreviewCard`
- Confirm / Reject 操作正常
- 删除 `GlobalQuickInput.tsx` 后，权限请求和数据发送预览功能仍可用
- 按 `callerWidgetId` 过滤：只显示当前会话绑定面板的请求

### 4.2 整体验证
- `npm run typecheck` 通过
- `npm run build` 通过
- Electron 应用启动正常
- Phase 0-7 功能未破坏（回归测试关键路径）
- 对抗审查通过（包含运行时验证）

### 4.3 运行时验证方案（L5 修复）

**CDP 端口与启动命令**：
- Electron 主进程启动时加 `--remote-debugging-port=9222`
- 启动命令：`cd client/desktop && npm run dev`（dev 脚本需带 `--remote-debugging-port=9222`）
- Playwright 通过 `chromium.connectOverCDP('http://localhost:9222')` 连接

**验证脚本调用方式**：
```bash
node "F:\Operit_workspace_full_backup\workspace_backup\.mcp-playwright-runtime\playwright-cli.js" run scripts/phase8-verify-<module>.ts
```

**各模块关键测试用例与截图存放**：
| 模块 | 关键测试用例 | 截图路径 |
|------|------------|---------|
| A | Omnibox 输入 `ai: 你好` 不触发 AI；Alt 键不弹窗 | `docs/verify/phase8/A-*.png` |
| B | toggle 切换 canvas/ai-assistant；折叠态点击展开；浏览网页时切换模式 | `docs/verify/phase8/B-*.png` |
| C | 新建/删除/重命名/绑定面板/切换 API 配置；删除当前会话后自动切换 | `docs/verify/phase8/C-*.png` |
| D | askUser 选项卡片显示；单选/多选提交；超时；会话切换归属 | `docs/verify/phase8/D-*.png` |
| E | API 配置 CRUD；model 切换；dispose_session 后切换配置生效 | `docs/verify/phase8/E-*.png` |
| F | PermissionCard 显示/Allow/Deny/dangerous 二次确认；DataSendPreviewCard 显示/Confirm/Reject | `docs/verify/phase8/F-*.png` |

**验证原则**：
- 不允许只读代码审查就判定通过
- 每个模块必须通过 Playwright CDP 实际操作并截图存证
- 截图存放在 `f:\allmylife\event\docs\verify\phase8\` 下（按模块分目录）

---

## 五、风险与注意事项

### 5.1 兼容性风险

1. **`primaryAISessionId` 迁移**：
   - 依赖 `primaryAISessionId` 的是 **CanvasHome**（`CanvasHome.tsx:72`），不是 AIAssistant widget（S5 澄清）
   - 改造时需保持向后兼容（保留 `ensurePrimarySession`，但改造为加入 sessionList + 设置 boundPanelId）
   - 字段标记为 `@deprecated`，新逻辑不依赖它
   - 老 AIAssistant widget 仍可工作（其会话不在新 sessionList 中管理）

2. **服务端 session 映射**：
   - 客户端 session 和服务端 per-panel session 的映射关系需明确
   - `boundPanelId` 作为桥梁
   - 一个客户端 session 始终对应一个服务端 panel session

3. **WS 消息向后兼容**：
   - 新增字段（`sessionId` / `apiConfig` / `callerWidgetId`）是可选的
   - 服务端需处理不带这些字段的老客户端消息
   - 客户端需处理不带新字段的服务端消息

4. **多设备 `panelActiveDevices` 路由冲突（M8 修复）**：
   - Phase 8.1 假设**单设备使用**（一个 panelId 同时只在一个设备上活跃）
   - 多设备场景下 `panelActiveDevices.get(panelId)` 可能返回非当前设备，导致 `ask_user` 消息发到错误设备
   - Phase 8.2 处理多设备场景（按 deviceId 维护多端 pending、或锁定 panel 到单一活跃设备）

### 5.2 安全风险

5. **API Key 安全**：
   - API Key 在 localStorage 中明文存储（跟现有 `utils/apiConfigStore.ts` 一致）
   - WS 传输加密靠 `wss://`
   - UI 显示时掩码（如 `sk-***...***`）
   - 如部署到公网，必须用 `wss://` 加密

### 5.3 功能限制

6. **`loadSessionHistory` 部分实现（M9 修复）**：
   - Phase 8.1 实现 `loadSessionHistory` 从服务端 `ai_conversations` 表读取历史 messages 回填
   - `sessionList` 持久化但 `sessions`（含 messages）不持久化是已知问题（刷新后列表有会话但点进去需回填）
   - Phase 8.2 接入服务端 API 持久化完整 session 数据，彻底解决状态不一致

7. **`ask_user` 超时**：
   - 60s 超时后 AI 收到错误
   - 需在 AI 的 system prompt 中告知"用户可能不回答，要有超时兜底逻辑"
   - 超时后 session 状态恢复为 `idle`

8. **服务端临时环境变量注入 + dispose_session（S3 修复）**：
   - 当前方案用 `process.env.PI_API_ENDPOINT` 临时覆盖
   - 这在并发场景下有竞态风险（多 session 同时发请求）
   - Phase 8.1 通过 `dispose_session` WS 消息显式清理旧 session（切换 API 配置时先 dispose 再重建），避免旧 session 配置固化
   - Phase 8.2 应改为 per-session 的 OpenAI client 实例（彻底消除竞态）
   - Phase 8.1 可接受（单用户桌面端，并发度低）

### 5.4 性能考虑

9. **sessionList 持久化频率**：
   - 每次 CRUD 操作都写入 localStorage
   - 如果 session 数量很多（>100），可能影响性能
   - Phase 8.1 可接受（用户手动管理，数量有限）
   - 可考虑 debounce 写入

10. **AIAssistantSidebar 对话流渲染**：
    - 长对话（>100 条消息）可能影响渲染性能
    - 可考虑虚拟滚动（react-window）
    - Phase 8.1 可接受（默认显示最近 50 条，更老的折叠）

---

## 六、附录

### 6.1 相关文档
- [Phase 7 Spec](./phase7-polish-optimization.md)：前置 Phase
- [Roadmap](../roadmap_desktop_v1.md)：整体路线图
- [Layout Design](../layout-design-desktop.md)：布局设计依据
- [Product Design](../desktop_product_design.md)：产品设计依据

### 6.2 关键文件路径速查
- 客户端入口：`f:\allmylife\event\client\desktop\src\App.tsx`
- AI Store：`f:\allmylife\event\client\desktop\src\stores\useAIStore.ts`
- App Store：`f:\allmylife\event\client\desktop\src\stores\useAppStore.ts`
- AI Types：`f:\allmylife\event\client\desktop\src\types\ai.ts`
- Sidebar：`f:\allmylife\event\client\desktop\src\components\Sidebar.tsx`
- Omnibox：`f:\allmylife\event\client\desktop\src\components\Omnibox.tsx`
- CanvasHome：`f:\allmylife\event\client\desktop\src\components\CanvasHome.tsx`（依赖 `primaryAISessionId`，S5 改造点）
- 服务端 PI Bridge：`f:\allmylife\event\server\src\piBridge.ts`（含 `getOrCreatePanelSession` L103-128、`createSession` L760-829）
- 服务端 WS：`f:\allmylife\event\server\src\ws.ts`（WS 消息类型定义 L14-31）

### 6.3 术语表
- **Sidebar**：桌面端左侧栏，可切换"画布面板"和"AI 助手"两种形态
- **boundPanelId**：AI 会话绑定的面板 ID，作为客户端 session 和服务端 panel session 的桥梁
- **askUserQuestion**：AI 主动向用户提问的机制，通过 `ask_user` customTool 实现
- **API 配置预设（ApiConfigPreset）**：endpoint + apiKey + models 的组合，per-session 选用
- **sessionList**：客户端 localStorage 持久化的会话元数据列表
- **waiting_confirmation**：session 状态，AI 请求执行危险操作（如发送数据），需要用户 allow/deny 权限（来自 GlobalQuickInput 迁移）
- **waiting_user_input**：session 状态，表示 AI 正在等待用户回答 askUserQuestion。与 `waiting_confirmation` 独立，优先级低于后者
- **dispose_session**：WS 消息类型，客户端切换 API 配置/删除会话时通知服务端清理旧 panel session（S3）
- **PermissionCard**：权限请求卡片组件（模块 F），迁移自 GlobalQuickInput
- **DataSendPreviewCard**：数据发送预览卡片组件（模块 F），迁移自 GlobalQuickInput

---

## 七、对抗审核修复（2026-06-26 第二轮）

> 本章节是对 spec 主体内容的对抗审核修复，实施时以本章节为准。

### 7.1 CRITICAL 修复

#### C1 修复：apiConfig 注入方案改为参数传递（替代 process.env 注入）

**问题**：原 spec E.3 用 `process.env.PI_API_ENDPOINT/PI_API_KEY` 临时注入 apiConfig，但 `createSession`（实际位于 `piBridge.ts:720-826`）从 `ai_settings` 表读取配置，会覆盖 `process.env` 注入值，导致客户端 apiConfig 完全失效。

**修复方案**：改为通过函数参数传递 apiConfig。

**修改 `createSession` 签名**（`piBridge.ts:720-826`）：
```ts
async function createSession(
  panelId: string,
  apiConfig?: { endpoint: string; apiKey: string; model: string }
): Promise<AgentSession> {
  // ...
  const aiSettings = await getAiSettings()
  // 优先级：客户端 apiConfig > ai_settings 表 > 环境变量
  const modelEnv = apiConfig?.model ?? aiSettings.model ?? process.env.PI_MODEL ?? 'stepfun/step-3.7-flash'
  const piApiKey = apiConfig?.apiKey ?? aiSettings.apiKey ?? process.env.PI_API_KEY
  const endpoint = apiConfig?.endpoint ?? aiSettings.endpoint
  // ...
}
```

**修改 `getOrCreatePanelSession` 签名**（`piBridge.ts:133-153`）：
```ts
async function getOrCreatePanelSession(
  panelId: string,
  apiConfig?: { endpoint: string; apiKey: string; model: string }
): Promise<AgentSession> {
  // ...（传 apiConfig 给 createSession）
  s = await createSession(panelId, apiConfig)
  // ...
}
```

**修改 `handleUserMessage`**（`piBridge.ts` 内）：
```ts
async function handleUserMessage(content: string, deviceId: string, panelId: string, apiConfig?: {...}) {
  const session = await getOrCreatePanelSession(panelId, apiConfig)
  // ...
}
```

**修改 `user_message` WS 处理**（`piBridge.ts:833-848`）：
```ts
if (msg.kind === 'user_message') {
  if (!msg.panelId) { /* 见 M2 修复：纯对话模式 */ }
  setPanelActiveDevice(msg.panelId, deviceId)
  handleUserMessage(msg.content, deviceId, msg.panelId, msg.apiConfig).catch(...)
}
```

**关键：切换 API 配置时必须先 dispose_session**（已在原 spec E.3 说明，此处重申）：客户端切换 API 配置预设时，先发 `dispose_session` 清理旧 session，下次 `user_message` 时 `getOrCreatePanelSession` 会用新 apiConfig 重建 session。

### 7.2 MAJOR 修复

#### M1 修复：新增 `server/src/routes/conversations.ts` HTTP 路由

**问题**：spec C.3 的 `loadSessionHistory` 需从服务端 `ai_conversations` 表读取历史 messages，但服务端无对应 HTTP API。

**修复方案**：

1. **新增文件** `server/src/routes/conversations.ts`：
```ts
import { Router } from 'express'
import { getRecentConversations } from '../db/aiContext.js'

const router = Router()

// GET /api/panels/:panelId/conversations?limit=100
router.get('/panels/:panelId/conversations', async (req, res) => {
  const { panelId } = req.params
  const limit = Math.min(Number(req.query.limit) || 100, 500)
  try {
    const conversations = await getRecentConversations(panelId, limit)
    res.json({ conversations })
  } catch (err) {
    res.status(500).json({ error: 'Failed to load conversations' })
  }
})

export default router
```

2. **修改** `server/src/index.ts`：注册路由 `app.use('/api', conversationsRouter)`

3. **修改 spec 3.1 文件清单**：增加 `server/src/routes/conversations.ts`（新建）+ `server/src/index.ts`（修改，注册路由）

#### M2 修复：纯对话模式 panelId 可选化

**问题**：服务端 `piBridge.ts:836-839` 主动拒绝不带 `panelId` 的 `user_message`，与 spec B.3 纯对话模式矛盾。

**修复方案**：

修改 `piBridge.ts` 的 `user_message` 处理（L833-848）：
```ts
if (msg.kind === 'user_message') {
  // 纯对话模式：panelId 可选
  // 若无 panelId，用 sessionId 作为 panelId 的 fallback（维持 Map key 逻辑）
  const effectivePanelId = msg.panelId ?? `session-only:${msg.sessionId}`
  setPanelActiveDevice(effectivePanelId, deviceId)
  handleUserMessage(msg.content, deviceId, effectivePanelId, msg.apiConfig).catch(...)
}
```

**ClientMessage 类型修改**（`ws.ts:14-19` + `useAIStore.ts:57-62`）：
```ts
| { kind: 'user_message'; panelId?: string; content: string; sessionId: string; apiConfig?: {...}; callerWidgetId?: string }
```
`panelId` 从必填改为可选。

#### M3 修复：`ensurePrimarySession` 签名改为接受 panelId 参数

**问题**：spec M10 说 `ensurePrimarySession` 改造为"设置 `boundPanelId = currentPanelId`"，但未说明如何获取 `currentPanelId`。

**修复方案**：

1. **修改 `useAppStore.ts`**：
```ts
// 接口
ensurePrimarySession: (panelId: string) => Promise<string>

// 实现
ensurePrimarySession: async (panelId: string) => {
  // ...创建 session...
  set({ primaryAISessionId: newSessionId })
  // 同步到 useAIStore 的 sessionList，设置 boundPanelId
  useAIStore.getState().bindPanelToSession?.(newSessionId, panelId)
  return newSessionId
}
```

2. **修改 `CanvasHome.tsx:86-88`**：
```ts
void ensurePrimarySession(currentPanelId).catch(console.error)
```
其中 `currentPanelId` 来自 CanvasHome L68 的 `panelId ?? activePanelId ?? ''`。

#### M4 修复：callerWidgetId 路由完整实现

**问题**：`AIAssistantSidebar` 的 callerWidgetId 解析未说明；服务端不传播 callerWidgetId，导致权限请求永远无 callerWidgetId，PermissionCard 过滤失效。

**修复方案**：

1. **服务端 `piBridge.ts` user_message 处理**：提取 `msg.callerWidgetId`，存入 AsyncLocalStorage（已有 `getCurrentPanelId` 机制，新增 `getCurrentCallerWidgetId`）：
```ts
const callerWidgetIdStorage = new AsyncLocalStorage<string>()

// user_message 处理
if (msg.callerWidgetId) {
  callerWidgetIdStorage.enter(msg.callerWidgetId, () => {
    handleUserMessage(msg.content, deviceId, effectivePanelId, msg.apiConfig)
  })
} else {
  handleUserMessage(msg.content, deviceId, effectivePanelId, msg.apiConfig)
}

function getCurrentCallerWidgetId(): string | undefined {
  return callerWidgetIdStorage.getStore()
}
```

2. **权限请求创建时**：在 customTools 的 execute 中（如 storageReadTool/storageWriteTool），创建 PermissionRequest 时填充 `callerWidgetId: getCurrentCallerWidgetId()`。

3. **客户端 `AIAssistantSidebar`**：通过 `useAppStore.getState().getPrimaryAIWidgetIdOfPanel(session.boundPanelId)` 解析自己的 callerWidgetId。若该面板无 primary AI widget，PermissionCard 显示所有未归属的权限请求（fallback）。

### 7.3 MINOR 修复

#### m1：清理 useAppStore.ts 死代码
spec 3.1 的 `useAppStore.ts` 行增加："删除 `isGlobalQuickInputOpen` / `setGlobalQuickInputOpen` 字段和方法"。

#### m2：清理 index.css 中 GlobalQuickInput 样式
spec 3.1 增加 `client/desktop/src/index.css` 修改项："删除 `/* ===== GlobalQuickInput 样式 ===== */` 及其下所有样式（约 L3076 起）"。

#### m3：删除旧 utils/apiConfigStore.ts
spec 3.1 增加 `client/desktop/src/utils/apiConfigStore.ts`（删除）。新建 `stores/useApiConfigStore.ts` 后，旧孤立模块删除。

#### m4：Sidebar.tsx 伪代码改用 sidebarWidth
spec B.1 伪代码修正：
```tsx
const sidebarWidth = useAppStore(s => s.sidebarWidth)
const collapsed = sidebarWidth <= 48
// 折叠态逻辑...
```
不使用 `sidebarCollapsed` / `setSidebarCollapsed`（store 中无此字段）。

#### m5：loadSessionHistory 的 sessionId → panelId 映射
spec C.3 加载逻辑补充：
```ts
loadSessionHistory: async (sessionId) => {
  const session = get().sessions[sessionId]
  if (!session?.boundPanelId) return
  const panelId = session.boundPanelId
  // 调 HTTP API: GET /api/panels/{panelId}/conversations
  const res = await fetch(`/api/panels/${panelId}/conversations?limit=100`)
  const data = await res.json()
  // 回填 session.messages
}
```

#### m6：ask_user 超时改为 120s
spec D.3 的 60s 超时改为 120s（更合理，用户可能正在深度对话）。

### 7.4 代码位置修正

原 spec 中 piBridge.ts 行号偏差，修正如下：
- `getOrCreatePanelSession`：原 spec 标 L103-128，**实际 L133-153**
- `createSession`：原 spec 标 L760-829，**实际 L720-826**
- `user_message` 处理：原 spec 标 L833-848，**实际 L833-848**（基本匹配）

### 7.5 修复后的文件改动清单（增量）

在 spec 3.1 文件清单基础上增加/修改：

| 文件 | 操作 | 内容 |
|------|------|------|
| `server/src/routes/conversations.ts` | 新建 | GET /api/panels/:panelId/conversations 路由（M1） |
| `server/src/index.ts` | 修改 | 注册 conversations 路由（M1） |
| `server/src/piBridge.ts` | 修改 | C1+M2+M4：createSession 接受 apiConfig 参数；user_message panelId 可选化；callerWidgetId AsyncLocalStorage |
| `client/desktop/src/utils/apiConfigStore.ts` | 删除 | 旧孤立模块（m3） |
| `client/desktop/src/index.css` | 修改 | 删除 GlobalQuickInput 样式（m2） |
| `client/desktop/src/stores/useAppStore.ts` | 修改 | 新增 sidebarMode + 删除 isGlobalQuickInputOpen/setGlobalQuickInputOpen + ensurePrimarySession 改签名（m1+M3） |
| `client/desktop/src/components/CanvasHome.tsx` | 修改 | ensurePrimarySession(currentPanelId) 调用（M3） |
