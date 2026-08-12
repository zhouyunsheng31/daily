# event 项目精简改造方案 v3

> 基于 v1/v2 两轮对抗审核修复。v2 的核心缺陷是"存储割裂"（storage_read 走后端 SQLite，旧数据在前端 IndexedDB）、"types.ts 全删"（UI 层在用）、"auditLog 引用链路断裂"、"bash 未区分 WSL/git-bash"。v3 逐项修复。

## 一、总体目标与原则

**目标**：从"25 个固定 widget + 18 个 AI 工具的臃肿面板"返璞归真为"pi agent + 无限画布 + agent 自由摆放 HTML 页面"的轻量形态。

**原则**：
1. 画布核心不动（已稳定，重写无收益）
2. 删除所有"固定展示类 widget"，保留"有独立技术含量、agent 难以用 html 重建的 widget"
3. AI 工具从 18 个砍到 6 个核心操作（围绕 html widget 的增删改查 + 通用 storage）
4. agent 能力由 pi 提供（替代现有自研 llmBackend），模型用 step-3.7-flash
5. 后端从"可选的活动追踪服务"改造为"pi 桥接服务"
6. **存储统一**：6 个工具全部通过 WS 转发前端执行，前端用现有 `adapter.ts` 的 `withFallback()` 访问数据（自动协调 IndexedDB/API），后端不直接读写存储——解决存储割裂

## 二、前置条件（Windows 环境）

1. **Node.js >= 22.19.0**：当前 v24.11.1 ✅
2. **bash shell（指定 git-bash）**：pi 在 Windows 需要 bash。**必须使用 git-bash，不能用 WSL bash**。
   - git-bash 路径：`C:\Program Files\Git\bin\bash.exe`
   - WSL bash（`C:\Windows\system32\bash.exe`）无发行版会失败，**禁止使用**
   - Phase 2 启动前验证：`& "C:\Program Files\Git\bin\bash.exe" --version` 必须成功
   - pi 的 `settings.json` 配置 `shellPath: "C:\\Program Files\\Git\\bin\\bash.exe"`
3. **pi 依赖安装**：pi 是外部项目（`F:\allmylife\pi`），通过 npm 包引入。在 `server/` 下执行：
   ```
   npm install @earendil-works/pi-coding-agent @earendil-works/pi-ai
   ```
4. **模型 provider**：用 pi 的 custom provider 机制直连 api.stepfun.com，复用现有 `VITE_STEPFUN_API_KEY`。
   - 通过 `~/.pi/agent/models.json` 注册自定义 provider
   - endpoint: `https://api.stepfun.com/step_plan/v1/chat/completions`
   - model: `step-3.7-flash`
   - 备选：若 custom provider 注册失败，用 nvidia provider（`stepfun-ai/step-3.7-flash`，免费但需注册 NVIDIA_API_KEY）

## 三、删除清单（大清洗 v3）

### 3.1 widget 删除（26 个文件中删 19 个、保留 6 个、重写 1 个）

实际 26 个 .tsx 文件。处理方式：

| 类别 | 文件 | 处理 |
|------|------|------|
| 保留(6) | PdfViewer、FocusTimer、Sudoku、MusicPlayer、Calculator、LatexQuiz | 不动 |
| 重写(1) | AIAssistant.tsx | in-place 重写为简化版（WS 客户端） |
| 删除(19) | RichText、MarkdownEditor、Sticker、NoteBlock、Clock、CountdownCard、TaskList、AgendaList、VocabTrainer、MistakeBook、HabitTracker、MoodTracker、BreathingWidget、Journal、QuickNote、SavingsGoal、QuoteCard、StatsPanel、ActivityTracker | 删除文件 |

### 3.2 AI 工具删除（19 个文件全删）
`src/ai/tools/` 下 19 个文件全部删除（含 widgetTools.ts，新的 list_widgets 用 pi defineTool 重写，不复用旧实现）。

### 3.3 AI 基础设施删除（11 个文件全删）
`src/ai/` 下除 tools/ 外的全部文件删除：
- apiTxContext.ts、auditLogger.ts、contextBuilder.ts、llmBackend.ts、permissionManager.ts、privacyGuard.ts、registerTools.ts、sessionManager.ts、storageApi.ts、toolRegistry.ts、types.ts

**注意**：`ai/types.ts` 不能直接全删——UI 层在用其中的类型。必须先执行 3.4 的类型迁移。

### 3.4 types.ts 拆分迁移（必须先做，再删 ai/types.ts）

`src/ai/types.ts` 被 5+ 个非 ai/ 文件引用。拆分方案：

| 类型 | 去向 | 引用方 |
|------|------|--------|
| ChatMessage | 迁移到 `src/types/ai.ts`（新建） | AIAssistant.tsx、useAIStore.ts、AIStatusBars.tsx |
| PermissionRequest、PermissionResponse、DataSendPreview | 迁移到 `src/types/ai.ts` | GlobalQuickInput.tsx、DesktopChatBar.tsx |
| HIGH_SENSITIVITY_STORES | 迁移到 `src/types/ai.ts` | GlobalQuickInput.tsx、DesktopChatBar.tsx |
| SessionState、PrivacySettings | 迁移到 `src/types/ai.ts` | useAIStore.ts |
| ExecutionContext、ToolDefinition、AuditLogRecord、ToolResult 等 ai/ 内部类型 | 随 ai/ 删除 | 仅 ai/ 内部引用 |

执行顺序：
1. 新建 `src/types/ai.ts`，迁移 UI 层类型
2. 更新 AIAssistant.tsx、useAIStore.ts、AIStatusBars.tsx、GlobalQuickInput.tsx、DesktopChatBar.tsx 的 import 路径
3. 验证 build 通过
4. Phase 1 删除 ai/ 目录（含 types.ts）

### 3.5 auditLog 引用清理（必须先做，再删 auditLog 表）

`aiData.ts` 的 auditLog 函数被非 ai/ 文件引用。清理清单：

| 文件 | 行 | 引用 | 处理 |
|------|----|------|------|
| `src/main.tsx` | 13, 27 | `import { cleanupExpiredAuditLogs }` + 调用 | 删除 import 与调用 |
| `src/utils/db.ts` | 820 | `'aiConversation', 'aiMemory', 'aiAuditLog'` store 列表 | 从 store 列表删除 `'aiAuditLog'` |
| `src/utils/db.ts` | 897-899 | `getAllAIAuditLogs` 用于数据导出 | 删除 `entityMap['aiAuditLog']` 赋值 |
| `src/utils/db.ts` | 1008 | `aiAuditLogs: entityMap['aiAuditLog'].filter(...)` 导出字段 | 删除该导出字段 |
| `src/components/MigrationPage.tsx` | 58-59 | `getAllAIAuditLogs` 用于迁移展示 | 删除该字段引用 |
| `src/utils/dbStores/index.ts` | 47-51 | 导出 5 个 auditLog 函数 | 删除导出 |

执行顺序：
1. Phase 0 清理上述 5 个文件的 auditLog 引用（含 db.ts 三处）
2. Phase 1 删除 `aiData.ts` 中 auditLog 函数 + auditLog 表

### 3.6 dbStores 逐项处理（12 个 store）

| store | 处理 | 理由 |
|------|------|------|
| sudokuGames | 保留 | Sudoku widget 依赖 |
| quizSessions | 保留 | LatexQuiz widget 依赖 |
| aiData | **精简保留** | 保留 AI 对话历史与记忆，删除 auditLog 函数与表（见 3.5） |
| panelTemplates | 保留 | 画布面板模板 |
| notes | 归档不删 | 旧数据保留只读，新数据走 kvStorage |
| journals | 归档不删 | 同上 |
| mistakes | 归档不删 | 同上 |
| quickNotes | 归档不删 | 同上 |
| savings | 归档不删 | 同上 |
| vocabDecks | 归档不删 | 同上 |
| vocabProgress | 归档不删 | 同上 |
| **新增** htmlWidgets | 新建 | 存 HtmlCanvasWidget 内容（id/html/x/y/agentWidth/agentHeight/title） |
| **新增** kvStorage | 新建 | 通用 KV 存储（key/value/updatedAt） |

**迁移策略**：被删 widget 的旧数据**保留在原 IndexedDB 表里作为只读归档**，不强制迁移。新数据统一走 kvStorage。agent 通过 storage_read 工具（WS 转发前端）读旧表——前端 WS 回调直接用 `src/api/adapter.ts` 的 `withFallback()` 访问 IndexedDB/API，**不复用 `src/ai/storageApi.ts`**（它要求 ExecutionContext，是 ai/ 内部安全模型，新工具层不需要）。storageApi.ts 随 ai/ 删除，withFallback 机制在 adapter.ts 中保留。**不存在存储割裂**。

### 3.7 注册表同步修改（必须，否则 build 断裂）
- `src/registry/widgetDefinitions.ts`：`allDefinitions` 数组从 26 项删到 7 项（6 保留 + 1 HtmlCanvasWidget）
- `src/registry/builtIn.tsx`：删除 19 个 import、ICONS 条目、builtInConfigs 条目；新增 HtmlCanvasWidget 的 import 与 config

### 3.8 活动追踪全套删除
- `src/components/widgets/ActivityTracker.tsx`
- `src/ai/tools/activityTools.ts`（已在 3.2）
- `src/api/activity.ts`
- `server/src/activity/`（activityCollector、cdpClient、classifier、powershellScript）

### 3.9 死代码删除
- `src/components/Sidebar.tsx`（AGENT.md 确认未使用）

### 3.10 QA 产物与多版本 spec 删除（路径修正）
- 根目录：`qa_step1~12*.py`、`qa_test_add_event.py`、`qa_verify_event.py`、`qa_final_db_check.py` 等所有 qa_*.py
- 截图目录：`qa_screenshots/`、`qa_shots/`、`_qa_shots/`、`_qa_scripts/`、`.qa-tmp/`
- `.trae/qa-*` 子目录、`.trae/adversarial-review-*.md`
- 多版本 spec：`SPEC_canvas_minimap_v2.md`~`v5.md`、`SPEC_canvas_minimap_sync.md`（**无 v1**）
- diff 文件：`minimap_diff.txt`、`unifiedToolbar_diff.txt`、`useAppStore_diff.txt`、`widgetTools_diff.txt`、`workspace_diff.txt`
- 废弃 roadmap：`docs/roadmap.md`、`docs/roadmap_v2.md`（**roadmap_v3.md 归档保留**）
- 历史计划：`docs/superpowers/plans/` 下 13 个文件（保留 `docs/superpowers/specs/` 与 `testsets/`）

### 3.11 依赖清理
- 移除 `marked`（grep 确认 src/ 零引用）
- **保留** `html-to-image`（Minimap.tsx 使用，不可移除）
- **保留** `katex`（LatexQuiz）、`pdfjs-dist`（PdfViewer）、`idb`、`zustand`、`lucide-react`、`uuid`

## 四、保留清单（核心资产）

| 模块 | 路径 | 说明 |
|------|------|------|
| 画布核心 | Workspace.tsx、WidgetContainer.tsx、Minimap.tsx、StrokesLayer.tsx、ConnectionLayer.tsx | 不动 |
| 画布工具 | CanvasModeToolbar.tsx、DrawingSettingsPopover.tsx、useDraggable.ts、useResizable.ts | 不动 |
| 坐标工具 | canvasCoords.ts、drawingCoords.ts | 不动 |
| 状态管理 | useAppStore.ts（精简）、useAIStore.ts（重写） | 精简/重写 |
| 持久化 | db.ts、dbV2.ts、dbStores/（精简） | 精简 |
| 数据访问层 | `src/api/adapter.ts` 的 `withFallback()` backend 切换机制 | **保留**（storageApi.ts 随 ai/ 删，withFallback 在 adapter.ts 中保留） |
| 组件注册 | widgetDefinitions.ts、builtIn.tsx | 精简为 7 项 |
| 难重建 widget | PdfViewer、FocusTimer、Sudoku、MusicPlayer、Calculator、LatexQuiz | 不动 |
| 顶层 UI | UnifiedToolbar.tsx、FloatingOrb.tsx、DesktopChatBar.tsx、GlobalQuickInput.tsx、SettingsPanel.tsx、AddWidgetMenu.tsx、WidgetSearch.tsx | 精简 |
| 后端骨架 | server/src/index.ts、db.ts | 改造为 pi 桥接 |

## 五、新增/改造清单（v3）

### 5.1 HtmlCanvasWidget（核心，从零新建）
- 路径：`src/components/widgets/HtmlCanvasWidget.tsx`（**新建文件，非"提前骨架"**）
- 渲染：iframe `srcdoc` 注入完整 HTML 文档
- sandbox：`allow-scripts allow-forms allow-popups`（**不给 allow-same-origin**，防 XSS 读取父域）
- 能力边界（明确告知 agent）：
  - ✅ 完整 HTML+CSS+JS 执行、DOM 操作、Canvas、SVG、动画
  - ❌ localStorage/sessionStorage（SecurityError）→ 通过 postMessage 代理到父窗口
  - ❌ fetch 跨域（受限）→ 通过 postMessage 代理
  - ❌ document.cookie
  - ❌ 加载外部 CDN 资源（受限）→ agent 生成的 html 必须自包含，或通过 postMessage 请求父窗口注入
- 尺寸协调机制（与现有 defaultLayout 集成）：
  - HtmlCanvasWidget 在 `src/registry/builtIn.tsx` 的 `builtInConfigs` 中设 `defaultLayout: { w: 400, h: 300, minW: 100, minH: 100 }`（默认值）
  - agent 创建时通过 `create_html_widget` 的 width/height 参数覆盖默认值，写入 widget instance 的 `w/h`
  - 用户拖拽调整后，widget instance 的 `w/h` 更新（现有 useResizable 机制）
  - agent `update_html_widget` 时**除非显式传 width/height 参数，否则不覆盖当前 w/h**
  - IndexedDB `htmlWidgets` 表存 `agentWidth/agentHeight`（agent 建议尺寸）；实际 w/h 由 widget instance 管理（useAppStore 状态）
- 错误捕获（**父页面包装注入**，非 agent 生成）：
  - 父页面收到 agent 的 html 后，**检测是否为完整 HTML 文档**，分别处理：
    ```typescript
    function wrapAgentHtml(agentHtml: string): string {
      const errorScript = `<script>
        window.onerror = function(msg, src, line, col, err) {
          parent.postMessage({type: 'html_widget_error', message: msg, stack: err?.stack, source: 'runtime'}, '*');
        };
        window.addEventListener('unhandledrejection', function(e) {
          parent.postMessage({type: 'html_widget_error', message: e.reason?.message || e.reason, stack: e.reason?.stack, source: 'promise'}, '*');
        });
      </script>`
      // 完整文档：在 <head> 第一个位置插入错误捕获脚本
      if (/<head[^>]*>/i.test(agentHtml)) {
        return agentHtml.replace(/<head([^>]*)>/i, `<head$1>${errorScript}`)
      }
      // 片段：拼接包装为完整 HTML 文档
      return `<html><head>${errorScript}</head><body>${agentHtml}</body></html>`
    }
    ```
  - 然后 `iframe.srcdoc = wrapAgentHtml(agentHtml)`
  - 父窗口监听 message 事件，错误回传后端，注入 agent 上下文作为 tool result

### 5.2 postMessage 协议（HtmlCanvasWidget ↔ 父窗口）
```typescript
// 父窗口 → iframe（首次加载注入 token）
{ type: 'canvas_init', token: string }  // token 用于后续消息防伪

// iframe → 父窗口（请求，必须携带 token）
{ type: 'canvas_action', token: string, action: 'read_storage'|'write_storage'|'http_fetch'|'create_widget', params: {...}, requestId: string }

// 父窗口 → iframe（响应）
{ type: 'canvas_response', requestId: string, success: boolean, data?: any, error?: string }

// iframe → 父窗口（错误）
{ type: 'html_widget_error', message: string, stack?: string, source: 'runtime'|'promise'|'resource' }
```
- **防伪**：父窗口生成随机 token，iframe 首次加载注入；后续 iframe 消息必须携带 token，父窗口校验
- **requestId**：由 iframe 生成（UUID）
- **大数据**：agent 生成的 html 可能 > 1MB，通过 srcdoc 直接注入（不走 postMessage），无分片问题

### 5.3 WS 工具调用协议（前端 ↔ 后端 pi）

**核心设计**：6 个工具**全部通过 WS 转发前端执行**，后端不直接读写存储。前端 WS 回调直接用 `src/api/adapter.ts` 的 `withFallback()` 访问数据（自动协调 IndexedDB/API），解决存储割裂。

```typescript
// 后端 → 前端（工具调用请求）
{ kind: 'tool_call', requestId: string, tool: 'create_html_widget'|'update_html_widget'|'delete_html_widget'|'list_widgets'|'storage_read'|'storage_write', params: any }

// 前端 → 后端（工具调用响应）
{ kind: 'tool_result', requestId: string, success: boolean, data?: any, error?: string }

// 后端 → 前端（pi 事件流转发）
{ kind: 'pi_event', event: 'text_delta'|'tool_call_start'|'tool_call_end'|'agent_end', data: any }
```
- 超时：30s，超时返回 `{success: false, error: 'timeout'}`
- 超时状态机：timeout → 工具标记为 cancelled，agent 收到错误结果，可决定重试或放弃
- 并发：每个工具调用独立 requestId，支持并发
- **性能**：agent 单次会话工具调用频率通常 < 10 次，WS 往返延迟可接受；无需批量化/缓存
- **WS 服务器实现位置**：`server/src/ws.ts`（新建），与现有 Express HTTP 共存于 `server/src/index.ts`

**pi customTool execute 等待 WS 响应的伪代码**：
```typescript
// server/src/piBridge.ts
// ws 为单例 WS 连接（piBridge 模块内维护，所有 agent session 共享）
const pendingRequests = new Map<string, { resolve: Function, reject: Function, timer: NodeJS.Timeout }>()

function executeViaWs(tool: string, params: any): Promise<any> {
  return new Promise((resolve, reject) => {
    const requestId = uuid()
    const timer = setTimeout(() => {
      pendingRequests.delete(requestId)
      reject(new Error('timeout'))
    }, 30000)
    pendingRequests.set(requestId, { resolve, reject, timer })
    ws.send(JSON.stringify({ kind: 'tool_call', requestId, tool, params }))
  })
}

// 收到前端 tool_result 时
ws.on('message', (data) => {
  const msg = JSON.parse(data)
  if (msg.kind === 'tool_result') {
    const pending = pendingRequests.get(msg.requestId)
    if (pending) {
      clearTimeout(pending.timer)
      pendingRequests.delete(msg.requestId)
      msg.success ? pending.resolve(msg.data) : pending.reject(new Error(msg.error))
    }
  }
})

// WS 断连时主动 reject 所有 pending 请求（避免等到 30s timeout）
ws.on('close', () => {
  for (const [requestId, pending] of pendingRequests) {
    clearTimeout(pending.timer)
    pending.reject(new Error('websocket closed'))
    pendingRequests.delete(requestId)
  }
})
ws.on('error', (err) => {
  for (const [requestId, pending] of pendingRequests) {
    clearTimeout(pending.timer)
    pending.reject(new Error('websocket error: ' + err.message))
    pendingRequests.delete(requestId)
  }
})

// 注册 customTool
defineTool({
  name: 'create_html_widget',
  // ...
  execute: async (params) => {
    const result = await executeViaWs('create_html_widget', params)
    return { content: [{ type: 'text', text: JSON.stringify(result) }] }
  }
})
```

**WS 选型理由（修正）**：pi SDK 跑在 server 端（Node.js），前端通过 WS 调用——这是跨进程通信。选 WS 而非 RPC mode 的真实理由：
1. WS 支持双向通信（工具调用结果回推 + pi 事件流转发）
2. 长连接减少握手开销
3. RPC mode 适合 pi 作为独立子进程集成；本方案用 SDK 同进程集成（pi 在 server 进程内），需自建 WS 桥接

### 5.4 6 个核心 AI 工具（pi defineTool，全部 WS 转发前端）

| 工具 | 参数 | 执行位置 | 数据访问 |
|------|------|---------|---------|
| `create_html_widget` | html, x, y, width?, height?, title? | 前端（WS 回调） | 前端 IndexedDB（htmlWidgets 表） |
| `update_html_widget` | id, html?, width?, height? | 前端（WS 回调） | 前端 IndexedDB |
| `delete_html_widget` | id | 前端（WS 回调） | 前端 IndexedDB |
| `list_widgets` | 无 | 前端（WS 回调） | 前端 useAppStore 状态 |
| `storage_read` | key | 前端（WS 回调） | 前端 `adapter.ts` 的 `withFallback()`（自动协调 IDB/API） |
| `storage_write` | key, value | 前端（WS 回调） | 前端 `adapter.ts` 的 `withFallback()` |

**存储统一**：所有工具在前端执行，用 `src/api/adapter.ts` 的 `withFallback()` 访问数据。`withFallback()` 自动选择 IndexedDB 或后端 API，agent 无需感知数据在哪。旧数据在 IndexedDB，agent 通过 storage_read 可读——**不存在存储割裂**。**不复用 `src/ai/storageApi.ts`**（它要求 ExecutionContext，是 ai/ 内部安全模型，新工具层不需要；该文件随 ai/ 删除）。

**新建 IDB 操作函数**：
- `src/utils/dbStores/htmlWidgets.ts`：get/create/update/delete/list（操作 htmlWidgets 表）
- `src/utils/dbStores/kvStorage.ts`：get/set/delete/list（操作 kvStorage 表）
- 这两个文件在 Phase 2 新建，供前端 WS 回调使用

### 5.5 server/ 改造为 pi 桥接
- 依赖：`@earendil-works/pi-coding-agent`、`@earendil-works/pi-ai`、`ws`
- 入口：`server/src/index.ts` 保留现有 Express HTTP，新增 WS 服务
- 新建 `server/src/piBridge.ts`：
  - `createAgentSession()` 创建 pi 会话，模型用 step-3.7-flash（custom provider 直连 api.stepfun.com）
  - 维护 WS 连接，转发 pi 事件流到前端
  - 注册 6 个 customTools，execute 函数通过 WS 发 tool_call 到前端，等待 tool_result
- 新建 `server/src/ws.ts`：WS 服务器实现

### 5.6 useAIStore 重写
- 删除自研 LLM 调用逻辑（llmBackend.ts 已删）
- 改为 WS 客户端，订阅 pi 事件流（text_delta、tool_call、tool_result、agent_end）驱动 UI
- `src/api/adapter.ts` 的 `withFallback()` 保留（供 storage_read/write 工具使用）

### 5.7 AIAssistant 简化版（in-place 重写）
- 替代旧版千行级实现
- 仅保留：消息列表 + 输入框 + 工具调用进度展示
- agent 创建的 html widget 直接出现在画布上

## 六、pi 接入架构（v3）

```
┌─────────────────────────────┐         ┌──────────────────────────────────┐
│  浏览器 (React + Vite)       │         │  Node.js 后端 (server/)           │
│                             │         │                                  │
│  ┌─────────────────────┐    │  WS     │  ┌────────────────────────────┐  │
│  │ Workspace 画布      │    │ ◄─────► │  │ pi AgentSession             │  │
│  │ ├─ 6 个保留 widget  │    │         │  │ ├─ model: step-3.7-flash   │  │
│  │ └─ HtmlCanvasWidget │◄───┼─────────┼──┤ ├─ customTools (6 个)      │  │
│  │   (iframe 渲染)     │    │ 工具    │  │ │  └─ execute: WS 转发前端 │  │
│  ├─ AIAssistant (新)   │    │ 回调    │  │ └─ 事件流 → WS 转发        │  │
│  └─ useAIStore (WS)    │    │         │  └────────────────────────────┘  │
│      │                    │         │                                  │
│      ▼                    │         │  ┌────────────────────────────┐  │
│  ┌─────────────────────┐  │         │  │ Express HTTP (保留)         │  │
│  │ adapter.ts          │  │         │  └────────────────────────────┘  │
│  │ ├─ withFallback()   │  │         │                                  │
│  │ ├─ IDB 模式 → 前端  │  │         │  ┌────────────────────────────┐  │
│  │ └─ API 模式 → 后端  │──┼─────────┼─►│ SQLite (better-sqlite3)    │  │
│  └─────────────────────┘  │  HTTP   │  └────────────────────────────┘  │
└─────────────────────────────┘         └──────────────────────────────────┘
```

**工具执行流向**：
1. agent 调 `create_html_widget(html, x, y, w, h)`
2. 后端 pi customTool execute 通过 WS 发 `tool_call` 到前端
3. 前端执行：创建 HtmlCanvasWidget + 写 IndexedDB（htmlWidgets 表）
4. 前端回 `tool_result` 到后端
5. 后端 pi 继续 agent loop

**数据访问流向**：
- agent 调 `storage_read(key)` → WS 转发前端 → 前端 `adapter.ts` 的 `withFallback()` 选择 IDB 或 API → 返回
- 旧数据在 IndexedDB，agent 可读——无存储割裂

## 七、实施阶段（v3 调整顺序）

### Phase 0: 修复当前 build 基线 + 清理引用（前置）
- 运行 `npm run build` 收集错误清单
- **仅修复与 ai/ 无关的 TS 错误**（因 ai/ 类型缺失导致的错误在 Phase 1 删 ai/ 后自动消失，不在 Phase 0 修）（预估 1-2 天）：
  - `useAppStore.ts`：PanelSettings/CanvasTransform 加 index signature；WidgetInstance.minimized 改为 required boolean；修复函数返回值签名
  - `utils/db.ts`：DynamicWidgetDef.createdAt 统一类型（string vs number）
  - `App.tsx`、`components/*` 的类型错误（排除因 ai/ 引用导致的错误）
- **清理 auditLog 引用**（见 3.5）：
  - `main.tsx` 删除 cleanupExpiredAuditLogs import 与调用
  - `db.ts` 删除 store 列表中 `'aiAuditLog'`（行 820）+ entityMap['aiAuditLog'] 赋值（行 897-899）+ 导出字段（行 1008）
  - `MigrationPage.tsx` 删除 getAllAIAuditLogs 引用
  - `dbStores/index.ts` 删除 auditLog 函数导出
- **执行 types.ts 拆分迁移**（见 3.4）：
  - 新建 `src/types/ai.ts`，迁移 UI 层类型
  - 更新 5 个文件的 import 路径
- 验证：`npm run build` 通过（或仅剩 ai/ 目录错误，待 Phase 1 删）

### Phase 1: 大清洗（删除）
- 执行 3.1~3.11 全部删除清单
- 同步修改 widgetDefinitions.ts、builtIn.tsx
- 精简 useAppStore.ts（移除已删 widget 相关状态）
- 精简 dbStores/index.ts（移除已删 store 导出，保留归档表）
- 删除 ai/ 目录（含 types.ts，已迁移）
- 验证：`npm run build` 通过 + `npm run lint` 通过 + 画布可启动 + 6 个保留 widget 可用

### Phase 2: pi 接入 + HtmlCanvasWidget 新建（合并）
- **验证 bash**：`& "C:\Program Files\Git\bin\bash.exe" --version` 必须成功
- **server/ 安装 pi 依赖**：`npm install @earendil-works/pi-coding-agent @earendil-works/pi-ai ws`
- **配置 pi**：`~/.pi/agent/models.json` 注册 custom provider 直连 api.stepfun.com；`settings.json` 配置 shellPath
- **新建 `server/src/ws.ts`**：WS 服务器
- **新建 `server/src/piBridge.ts`**：createAgentSession + WS 转发 + 6 个 customTools（execute 通过 WS 转发前端）
- **前端 useAIStore 重写**：WS 客户端
- **新建 `src/components/widgets/HtmlCanvasWidget.tsx`**：
  - iframe srcdoc 渲染（含错误捕获脚本注入）
  - **不含 postMessage 代理**（Phase 3 完善）
  - 尺寸用 defaultLayout 默认值，agent 创建时可覆盖
- **实现 6 个工具的前端 WS 回调**：
  - create/update/delete_html_widget：操作画布 + IndexedDB
  - list_widgets：读 useAppStore 状态
  - storage_read/write：用现有 `adapter.ts` 的 `withFallback()`
- **IndexedDB 新增 htmlWidgets 表 + kvStorage 表**
- 验证：
  - 前端发"帮我画一个时钟"→ agent 生成 html → 画布出现可运行的时钟（纯展示型，不含 localStorage）
  - storage_read/write 可读写 KV

### Phase 3: HtmlCanvasWidget 完善 + postMessage 代理
- 实现 postMessage 协议（token 防伪 + read_storage/write_storage/http_fetch 代理）
- 实现 iframe 错误捕获与回传（window.onerror + unhandledrejection）
- 实现尺寸协调机制（agentWidth/agentHeight vs 实际 w/h）
- 验证：
  - agent 生成含 localStorage 的 html → 通过 postMessage 代理可持久化
  - agent 生成有 bug 的 html → 错误回传 agent 自我修复
  - agent 生成番茄钟（需持久化）→ 可正常运行

### Phase 4: 旧数据归档 + 端到端验证
- 旧 dbStores 数据保留只读归档，不迁移
- agent 可通过 storage_read 读旧表（前端 `adapter.ts` 的 `withFallback()` 访问 IndexedDB）
- 对抗审查（sub-agent，含运行时验证）
- 更新 README/AGENT/SPEC 文档
- Git 提交
- 验证：
  - 旧 IndexedDB 数据可读
  - 代码行数从 ~3-5 万降至 ~1-1.5 万
  - 无死代码、无多版本 spec、无 QA 产物残留

## 八、风险与对策（v3）

| 风险 | 对策 |
|------|------|
| pi Windows bash 不可用 | Phase 2 启动前验证 git-bash 路径；配置 settings.json shellPath；禁止用 WSL bash |
| pi custom provider 注册失败 | 备选：nvidia provider（需注册 NVIDIA_API_KEY） |
| WS 断连 agent 中断 | 后端 pi session 持久化到磁盘，重连可恢复 |
| iframe sandbox 限制 | postMessage 代理 localStorage/fetch；agent 生成的 html 必须自包含 |
| 旧数据丢失 | 保留原 IndexedDB 表只读归档，不删 |
| 删除范围误伤 | Phase 1 用 git 分支操作，每步可回滚 |
| pi 依赖体积大 | SDK 模式按需加载 |
| build 基线已坏 | Phase 0 先修复非 ai/ 目录错误 + 清理 auditLog 引用 + types.ts 迁移 |
| 存储割裂 | 6 个工具全部 WS 转发前端执行，前端用 `adapter.ts` 的 `withFallback()` 访问数据 |
| iframe 跨 origin error 被 sanitize | 父页面注入错误捕获脚本到 srcdoc 头部，主动 postMessage |
| postMessage 伪造 | token 防伪机制 |

## 九、验收标准

1. `npm run build` + `npm run lint` 全绿
2. 画布启动后仅显示 6 个保留 widget + 1 个 HtmlCanvasWidget 类型
3. 前端发"帮我画一个番茄钟"→ agent 生成 html → 画布出现可运行的番茄钟（含 localStorage 持久化）
4. 旧 IndexedDB 数据可读（通过 storage_read）
5. 代码行数从 ~3-5 万降至 ~1-1.5 万
6. 无死代码、无多版本 spec、无 QA 产物残留
7. `& "C:\Program Files\Git\bin\bash.exe" --version` 可用
8. pi session 可创建，step-3.7-flash 可响应
