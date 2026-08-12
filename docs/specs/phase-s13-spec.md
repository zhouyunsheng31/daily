# Phase S13 Spec：Web 端 AI Agent 集成

> 生成日期：2026-07-05
> Roadmap 依据：[roadmap_server_v2.md](../roadmap_server_v2.md) 第三章 Phase S13（L279-333）
> v1 基线：[roadmap_server_v1.md](../roadmap_server_v1.md)（S0-S6/S9/S10 已完成）
> S11 前置：[phase-s11-spec.md](./phase-s11-spec.md)（Web 端基础设施 + 单用户认证）
> S12 前置：[phase-s12-spec.md](./phase-s12-spec.md)（Web 端画布核心，已完成）
> 架构依据：[architecture_refactor.md](../architecture_refactor.md)
> 状态：待编码实现

---

## 一、项目目的

让用户在 Web 端浏览器中即可使用完整的 AI Agent 能力——AI 对话 + 思考流实时展示 + 工具调用 + ask_user/permission_request 交互 + 会话历史恢复 + 多端思考流广播。S13 在 S12（画布核心 + useAIStore stub）基础上，把桌面端 useAIStore（1703 行）完整移植到 Web 端，替换 S12 stub，让 AIAssistant widget 真正可用。

**S13 范围**：
- S13.1 AI 对话 + 思考流（useAIStore 完整实现 + WS 事件处理 + 6 个 AI 子组件复用）
- S13.2 AI 配置 UI（AIApiConfig/AIPromptConfig/AISkillsManager/ToolsManager）
- S13.3 工具调用适配（wsToolHandlers 改造：8 个数据类工具保留 + 18 个 browser_* 降级）

**S13 不做**：
- 动态组件 + 搜索工具 UI（S14）—— 但 `local_search` 工具本身要可用（S13.3）
- 生产部署 + HTTPS（S15）
- 本地 Agent 模式（Web 端只有云端模式，无 `window.agentApi`）
- 浏览器工具真实执行（browser_* 18 个全部降级返回"Web 端不支持"）

---

## 二、前置依赖与现状摸底

### 2.1 前置依赖

| 依赖 | 状态 | 说明 |
|------|------|------|
| v1 S0-S6/S9/S10 | ✅ | 后端 API + WS + Pi Agent + 24 工具完整 |
| S11 Web 端基础设施 + 认证 | ✅ | JWT cookie + SPA fallback + CORS |
| S12 Web 端画布核心 | ✅ | 8 widget + 数据层 + WS 同步（typecheck 通过，git commit `a83ea099`） |
| S12 useAIStore stub | ✅ | 导出 5 个必需符号，待 S13 替换为完整实现 |
| S12 useAppStore WS 初始化 | ✅ | initWebSocket + handleServerChange + 30s 心跳 + 5s 重连 |
| S12 sessionStorage JWT | ✅ | `sessionStorage['ld-jwt']` 存 token，供 WS URL query 使用 |

### 2.2 S12 已完成的 Web 端基础设施（S13 直接使用）

| 文件 | 用途 | S13 复用方式 |
|------|------|-------------|
| `client/web/src/stores/useAppStore.ts` | 含 WS 初始化 + handleServerChange | **S13 改造**：删除 WS 初始化（迁移到 useAIStore），保留 handleServerChange |
| `client/web/src/stores/useAIStore.ts` | S12 stub（5 个导出，no-op） | **S13 替换**：完整实现 1703 行（移植桌面端 + 改造） |
| `client/web/src/utils/wsToolHandlers.ts` | S12 stub（仅 readFromLegacyTable + ToolCallResult） | **S13 替换**：完整实现（8 工具保留 + 18 browser_* 降级） |
| `client/web/src/utils/iframeProxy.ts` | 完整版（S12 已复制） | 直接使用（S13 wsToolHandlers 完整实现后仍兼容） |
| `client/web/src/components/widgets/AIAssistant.tsx` | S12 已复制（447 行） | 直接使用（S13 useAIStore 完整后自动可用） |
| `client/web/src/api/client.ts` | fetch 封装 + credentials:'include' | 直接使用 |
| `client/web/src/types/ai.ts` | 31 个导出，与桌面端完全一致 | 直接使用 |
| `client/web/src/utils/localSearch.ts` 等 | 搜索工具链 | 直接使用（local_search 工具依赖） |
| `client/web/src/stores/useAppStore.handleServerChange` | change 事件分发 | 保留（被 useAIStore 调用） |

### 2.3 桌面端 useAIStore 现状（S13 改造依据）

**源文件**：`client/desktop/src/stores/useAIStore.ts`（1703 行）

**导出清单**：

| 名称 | 类型 | 行号 | S13 处理 |
|------|------|------|---------|
| `setUseAppStoreRef` | function | 395 | 保留（useAppStore 反向引用） |
| `registerAppStateProvider` | function | 410 | 保留（App.tsx 调用） |
| `useAIStore` | zustand store | 571 | 保留（主体） |
| `useAIStoreType` | type alias | 1703 | 保留（useAppStore import） |

**window.*Api 依赖清单（S13 改造点）**：

| 行号 | 调用 | 用途 | S13 改造 |
|------|------|------|---------|
| 188 | `window.serverPortApi?.getServerPort()` | buildWsUrl prod 分支 | **删除**：Web 端始终用 `window.location.host` |
| 1191 | `window.agentApi`（赋值给 agentApi） | 本地 agent 模式 | **删除**：Web 端无本地 agent |
| 1208 | `agentApi.onEvent(callback)` | 注册 agent 事件监听 | **删除**：pi_event 通过 WS 接收 |
| 1218 | `agentApi.sendMessage({panelId, message, thinkingLevel})` | 发起 agent loop | **删除**：Web 端走 `sendWs({kind:'user_message'})` |
| 1438 | `window.serverPortApi?.getServerPort()` | loadSessionHistory HTTP URL | **删除**：用相对路径 `/api` |
| 1696-1697 | `window.localServicesApi.onUnregister(cb)` | 监听本地服务注销 | **删除**：Web 端无本地服务 |

**关键方法签名 + 实现位置**：

| 方法 | 类型签名行 | 实现行 | S13 处理 |
|------|-----------|--------|---------|
| `initialize` | 441 | 1139 | 改造：移除 agentApi 初始化，保留 connectWs |
| `createSession(options?)` | 442 | 1167 | 保留 |
| `sendMessage(sessionId, content, callerWidgetId?)` | 448 | 1179 | 改造：删除 agentApi 分支，仅走 sendWs |
| `loadSessionHistory(sessionId)` | 458 | 1425 | 改造：HTTP URL 用相对路径 |
| `deleteSession(sessionId)` | 457 | 1385 | 保留（sendWs dispose_session） |
| `switchSession(sessionId)` | 469 | 1611 | 保留 |
| `renameSession(sessionId, newTitle)` | 471 | 1490 | 保留 |
| `setSessionModel(sessionId, modelId)` | 474 | 1529 | 保留 |
| `respondToPermission(requestId, response)` | 450 | 1297 | 保留（sendWs permission_response） |
| `respondToAskUser(requestId, selectedValues)` | 452 | 1314 | 保留（sendWs ask_user_response） |
| `confirmDataSend(sessionId, preview)` | 465 | 1573 | 保留 |
| `rejectDataSend(sessionId)` | 467 | 1590 | 保留 |
| `clearSearchResults()` | 489 | 1684 | 保留 |
| `handleServerChange(changeType, data, sourceDeviceId?)` | — | 877 | **删除**：迁移到 useAppStore（S12 已完成） |

**WS 事件处理位置（S13 保留）**：

| 事件 | case 行号 | 处理 |
|------|----------|------|
| `pi_event` | 598 | `handlePiEvent(msg.event, msg.data)` → 更新 session.messages |
| `tool_call` | 603 | `handleToolCall(msg.requestId, msg.tool, msg.params)` → 调 wsToolHandlers |
| `tool_result` | 829 | 恢复 thinking 状态 |
| `ask_user` | 626 | 设置 pendingAskUser |
| `permission_request` | 673 | 设置 pendingPermissionRequests |
| `change` | 622 | `useAppStore.handleServerChange(...)`（S12 已实现） |
| `session_ready` | — | 标记 session 就绪 |
| `pong` | — | 心跳响应，忽略 |
| `error` | — | console.error |

### 2.4 桌面端 wsToolHandlers 现状（S13 改造依据）

**源文件**：`client/desktop/src/utils/wsToolHandlers.ts`（614 行）

**导出**：
- `ToolCallResult` interface（line 47）
- `readFromLegacyTable(table, key)` async function（line 379）
- `executeToolCall(tool, params)` async function（line 492）

**处理的工具（共 26 个）**：

| 类别 | 工具名 | case 行号 | S13 处理 |
|------|--------|----------|---------|
| 数据类（8 个，保留） | `create_html_widget` | 522 | 保留 |
| | `update_html_widget` | 524 | 保留 |
| | `delete_html_widget` | 526 | 保留 |
| | `list_widgets` | 528 | 保留 |
| | `storage_read` | 530 | 保留 |
| | `storage_write` | 532 | 保留 |
| | `local_search` | 570 | 保留 |
| | `query_capabilities` | 585 | 保留 |
| 浏览器类（18 个，降级） | `browser_eval` | 534 | 返回 not-supported |
| | `browser_get_dom` | 536 | 返回 not-supported |
| | `browser_click` | 538 | 返回 not-supported |
| | `browser_input` | 540 | 返回 not-supported |
| | `browser_scroll` | 542 | 返回 not-supported |
| | `browser_wait_for` | 544 | 返回 not-supported |
| | `browser_screenshot` | 546 | 返回 not-supported |
| | `browser_navigate` | 548 | 返回 not-supported |
| | `browser_get_url` | 550 | 返回 not-supported |
| | `browser_get_title` | 552 | 返回 not-supported |
| | `browser_back` | 554 | 返回 not-supported |
| | `browser_forward` | 556 | 返回 not-supported |
| | `browser_reload` | 558 | 返回 not-supported |
| | `browser_get_cookie` | 560 | 返回 not-supported |
| | `browser_set_cookie` | 562 | 返回 not-supported |
| | `browser_open` | 564 | 返回 not-supported |
| | `browser_switch_tab` | 566 | 返回 not-supported |
| | `browser_list_tabs` | 568 | 返回 not-supported |

### 2.5 关键约束

| 约束 | 说明 |
|------|------|
| 不破坏桌面/移动端兼容 | 仅在 `client/web/` 内操作，不动 `client/desktop/` 与 `client/android/` |
| 单用户模式 | 沿用 S11 JWT cookie + S12 sessionStorage JWT |
| TypeScript 严格 | Web 端 tsconfig 继承桌面端，编译零 error |
| 复用优先 | 物理复制桌面端 useAIStore + 小改造，不重写 |
| Web 端只走云端 | 删除所有 `window.agentApi`/`window.serverPortApi`/`window.localServicesApi` 调用 |
| browser_* 全降级 | 18 个浏览器工具统一返回 not-supported，AI 收到后能继续对话 |
| 不修改 server | server 端 WS 协议 + AI 路由已就绪，S13 仅改 client/web/ |
| 不下载到 C 盘 | 依赖安装到 `client/web/node_modules/`（F: 盘） |
| git 版本管理 | 完成后 git commit |
| 运行时验证强制 | 不能只读代码，必须 Playwright 实际验证 |

---

## 三、S13.1 AI 对话 + 思考流

### 3.1 任务清单（文件级）

#### S13.1-T0：复制 useThinkingLevelStore + thinkingLevel.ts（前置依赖）

**对抗审查发现**：桌面端 `useAIStore.ts:66` import `useThinkingLevelStore`，但 web 端 `client/web/src/stores/` 目录下不存在此文件。直接物理复制 useAIStore 会导致 TS 编译失败。

| # | 源文件 | 目标文件 | 行数 | 改造 |
|---|--------|---------|------|------|
| 1 | `client/desktop/src/stores/useThinkingLevelStore.ts` | `client/web/src/stores/useThinkingLevelStore.ts` | 111 | 直接复制（无 window.*Api，纯 localStorage + zustand） |
| 2 | `client/desktop/src/utils/thinkingLevel.ts` | `client/web/src/utils/thinkingLevel.ts` | 134 | 直接复制（纯类型 + 映射函数，无依赖） |

**验证**：
- `useThinkingLevelStore` 依赖 `../utils/thinkingLevel` 中的 `mapThinkingLevelToPi`/`ThinkingLevel`/`PiThinkingLevel`，复制后可用
- 无 `window.*Api` 依赖
- localStorage 持久化在 Web 端原生支持

#### S13.1-T1：复制 6 个 AI 子组件（可直接复用，无改造）

| # | 源文件 | 目标文件 | 行数 | 改造 |
|---|--------|---------|------|------|
| 1 | `client/desktop/src/components/ai/AIStatusBars.tsx` | `client/web/src/components/ai/AIStatusBars.tsx` | 125 | 直接复制 |
| 2 | `client/desktop/src/components/ai/SearchResultsPanel.tsx` | `client/web/src/components/ai/SearchResultsPanel.tsx` | 23 | 直接复制 |
| 3 | `client/desktop/src/components/ai/SearchResultsCard.tsx` | `client/web/src/components/ai/SearchResultsCard.tsx` | 144 | 直接复制 |
| 4 | `client/desktop/src/components/AskUserCard.tsx` | `client/web/src/components/AskUserCard.tsx` | 252 | 直接复制 |
| 5 | `client/desktop/src/components/PermissionCard.tsx` | `client/web/src/components/PermissionCard.tsx` | 269 | 直接复制 |
| 6 | `client/desktop/src/components/DataSendPreviewCard.tsx` | `client/web/src/components/DataSendPreviewCard.tsx` | 305 | 直接复制 |

**验证**（对抗审查修正）：
- 6 个文件均无 `window.*Api` 依赖
- AIStatusBars/SearchResultsPanel/AskUserCard/PermissionCard/DataSendPreviewCard 依赖 `useAIStore` 接口（S13.1-T2 完整实现后兼容）
- **SearchResultsCard 依赖 `useAppStore.setActivePanel`（不是 useAIStore）**，S12 已存在
- 注意：web 端 useAppStore 已删除 WS 逻辑（S13.1-T3），但 setActivePanel 保留，SearchResultsCard 仍可用

#### S13.1-T2：替换 useAIStore stub 为完整实现（核心改造）

**源文件**：`client/desktop/src/stores/useAIStore.ts`（1703 行）
**目标文件**：`client/web/src/stores/useAIStore.ts`（覆盖 S12 stub）

**桌面端 useAIStore 完整 import 清单（line 28-71）**：

桌面端 useAIStore.ts L28-71 共 13 个 import 语句。下表仅列出**需要 S13 改造的 import**（其余 9 个 import 直接复制，web 端已有对应文件）：

| 行号 | import | web 端状态 | S13 处理 |
|------|--------|-----------|---------|
| 60 | `getDeviceId, getServerToken` from `../utils/deviceAuth` | ✅ 已存在（S11 复制） | **改造 getServerToken 读取 sessionStorage['ld-jwt']**（见改造2） |
| 61 | `localServiceRegistry` from `../utils/localServiceRegistry` | ❌ 不存在 | **删除 import + 删除所有使用处**（connectWs onopen L292-294 / onclose L326 / handleProxyRequest L866 / beforeunload L1696-1700，见改造6） |
| 62 | `useApiConfigStore` from `./useApiConfigStore` | ✅ 已存在（S12 复制 + 改造） | 直接使用，接口兼容 |
| 64 | `useRuntimeModeStore` from `./useRuntimeModeStore` | ✅ 已存在（S12 复制） | 直接使用，但 Web 端只有云端模式，`effectiveMode === 'local'` 分支删除 |
| 66 | `useThinkingLevelStore` from `./useThinkingLevelStore` | ❌ 不存在 | **S13.1-T0 复制** |
| 67 | `AgentEvent` type from `../types/electron` | ✅ 已存在（`client/web/src/types/electron.d.ts` L309-314 已定义） | **直接使用已有定义**，无需新建 stub |
| 69 | `markSearchCacheStale` from `../utils/searchCache` | ✅ 已存在（S12 复制） | 直接使用 |
| 71 | `SyncFailedEvent` type from `../types/syncLogs` | ✅ 已存在 | **删除 import**（删除 handleServerChange 后不再使用，见改造7） |

**其余 9 个直接复制的 import**（L28-58，无需改造）：
- L28 `create` from `zustand`
- L29 `v4 as uuidv4` from `uuid`
- L30-48 types/ai type imports（SessionState/ChatMessage/LLMConfig 等 13 个 type）
- L50 types/ai 运行时函数 imports（isSearchTool/SEARCH_TOOL_KIND_MAP/isLocalSearchResult）
- L51 types `AIMemory`
- L52-58 aiData imports（getAllAIMemories/updateAIMemory 等 6 个函数）
- L59 `executeToolCall` from `../utils/wsToolHandlers`（S13.3 改造后的版本）

**说明**：web 端已有 `client/web/src/types/electron.d.ts` L307-314 定义了 `AgentEvent` 类型（5 个变体：text_delta/tool_call/tool_result/turn_end/error），与桌面端 `client/desktop/src/types/electron.ts` 定义一致。直接使用已有定义即可，**不要新建 `electron.ts` stub**（会与已有 `electron.d.ts` 冲突，TS 解析歧义）。

**改造点**：

##### 改造 1：WS_URL_BASE 常量（line 186-189）删除 file:// 分支 + serverPortApi

**桌面端现状**：`window.serverPortApi?.getServerPort()` 在 **WS_URL_BASE 常量定义**（L186-189），不在 buildWsUrl 函数里。buildWsUrl 函数本身只做 deviceId+token query 拼接，无需改造。

```typescript
// 桌面端原版（line 186-189）：
const WS_URL_BASE = (import.meta.env.VITE_WS_URL as string | undefined)
  ?? (typeof window !== 'undefined' && window.location.protocol === 'file:'
    ? `ws://localhost:${window.serverPortApi?.getServerPort() ?? 3456}/ws`  // ← 删除 file:// 分支
    : `ws://${window.location.host}/ws`)

// Web 端改造版（line 186-189）：
const WS_URL_BASE = (import.meta.env.VITE_WS_URL as string | undefined)
  ?? `ws://${window.location.host}/ws`  // Web 端始终同源，无 file:// 分支，无 serverPortApi
```

**buildWsUrl 函数（L195-201）保留无改造**：

```typescript
// 桌面端 buildWsUrl（line 195-201，直接复制，无改造）：
function buildWsUrl(): string {
  const deviceId = getDeviceId()
  const token = getServerToken()  // 改造后从 sessionStorage['ld-jwt'] 读取（见改造2）
  const params = new URLSearchParams({ deviceId })
  if (token) params.set('token', token)
  return `${WS_URL_BASE}?${params.toString()}`
}
```

##### 改造 2：getServerToken 改造为读取 sessionStorage['ld-jwt']

**问题**：桌面端 `getServerToken()` 从 `localStorage['living-dashboard-server-token']` 读取。S12 把 JWT 存入 `sessionStorage['ld-jwt']`，桌面端 getServerToken 读不到。

**改造方案**：改造 web 端 `client/web/src/utils/deviceAuth.ts` 的 `getServerToken()` 函数，让它优先从 `sessionStorage['ld-jwt']` 读取（S12 JWT），fallback 到 localStorage 和环境变量。

```typescript
// Web 端 deviceAuth.ts 改造版：
const SESSION_JWT_KEY = 'ld-jwt'  // S12.3-T10 存入的 JWT key

export function getServerToken(): string | null {
  // 优先从 sessionStorage 读取 S12 JWT（web 端登录后存入）
  const sessionJwt = sessionStorage.getItem(SESSION_JWT_KEY)
  if (sessionJwt) return sessionJwt
  // fallback 到 localStorage（设置面板存入）
  const stored = localStorage.getItem(SERVER_TOKEN_KEY)
  if (stored) return stored
  // fallback 到环境变量
  const envToken = import.meta.env.VITE_SERVER_TOKEN
  if (envToken) return envToken as string
  return null
}
```

**关键说明**：
- 桌面端 buildWsUrl（L195-201）已包含 token query 拼接逻辑，**无需改造 connectWs**
- connectWs 函数（L255-354）保持原样，调用 `buildWsUrl()` 获取完整 URL（含 deviceId+token）
- S12 在 useAppStore 中独立初始化 WS，S13 把 WS 初始化迁移到 useAIStore。useAppStore 的 `initWebSocket`/`startHeartbeat`/`handleWsMessage` 删除（见 S13.1-T3）

##### 改造 3：sendMessage 删除 agentApi 分支（line 1179-1230）

```typescript
// 桌面端 sendMessage（line 1179-1230）：
sendMessage: async (sessionId, content, callerWidgetId) => {
  // ... session 状态更新 ...
  
  // 桌面端双路径（line 1191）：
  const agentApi = window.agentApi  // ← 删除（无 typeof 检查，直接读 window.agentApi）
  if (agentApi && get().effectiveMode === 'local') {  // ← 删除整个 if 分支
    await agentApi.sendMessage({
      panelId: session.panelId,
      message: content,
      thinkingLevel: session.thinkingLevel,
    })
    return
  }
  
  // 云端 WS 路径（保留 + 增强）：
  sendWs({
    kind: 'user_message',
    sessionId,
    panelId: session.panelId,
    content,
    thinkingLevel: session.thinkingLevel,  // 透传给 server agent
    callerWidgetId,
  })
}

// Web 端改造版：仅保留云端 WS 路径
sendMessage: async (sessionId, content, callerWidgetId) => {
  // ... session 状态更新 ...
  sendWs({
    kind: 'user_message',
    sessionId,
    panelId: session.panelId,
    content,
    thinkingLevel: session.thinkingLevel,
    callerWidgetId,
  })
}
```

##### 改造 4：initialize 保留无改造（line 1139-1165）

**桌面端现状**（实际读取 L1139-1165 确认）：initialize 中**无 agentApi 初始化代码**，**不调用 startHeartbeat**。心跳由 connectWs 的 onopen 回调自动启动（L277-287 wsPingTimer）。

```typescript
// 桌面端 initialize（line 1139-1165，直接复制，无改造）：
initialize: async () => {
  if (get().isInitialized) return

  // Register WS handlers
  onlineHandlers.add((online) => {
    set({ isOnline: online })
  })
  messageHandlers.add(handleServerMessage)

  // Start WS connection
  wsManuallyClosed = false
  connectWs()  // 心跳在 connectWs 的 onopen 中启动，无需单独 startHeartbeat

  // Set up LLM config stub (pi backend uses env var VITE_STEPFUN_API_KEY)
  const envApiKey = import.meta.env.VITE_STEPFUN_API_KEY as string | undefined
  set({
    llmConfig: {
      endpoint: 'wss://pi-bridge-local',
      apiKey: envApiKey ?? '',
      model: 'step-3.7-flash',
      maxTokens: 8192,
      temperature: 0.7,
    },
    availableModels: ['step-3.7-flash'],
    isInitialized: true,
  })
}
```

**说明**：initialize 无需任何改造，直接复制即可。agentApi 初始化在 sendMessage 里（L1191），不是 initialize 里（见改造3）。

##### 改造 5：loadSessionHistory URL 删除 file:// 分支 + serverPortApi（line 1436-1439）

**桌面端现状**（实际读取 L1436-1439 确认）：URL 路径是 `/api/panels/${panelId}/conversations?limit=50`（不是 `/api/conversations/${sessionId}`）。需要删除的是 baseUrl 拼接中的 file:// 分支和 serverPortApi 调用。

```typescript
// 桌面端原版（line 1436-1439）：
const baseUrl = (import.meta.env.VITE_API_URL as string | undefined)
  ?? (typeof window !== 'undefined' && window.location.protocol === 'file:'
    ? `http://localhost:${window.serverPortApi?.getServerPort() ?? 3456}`  // ← 删除 file:// 分支
    : window.location.origin)
const url = `${baseUrl}/api/panels/${encodeURIComponent(panelId)}/conversations?limit=50`

// Web 端改造版（line 1436-1439）：
const baseUrl = (import.meta.env.VITE_API_URL as string | undefined)
  ?? window.location.origin  // Web 端始终同源，无 file:// 分支，无 serverPortApi
const url = `${baseUrl}/api/panels/${encodeURIComponent(panelId)}/conversations?limit=50`
```

**说明**：loadSessionHistory 的其余代码（headers 设置、fetch、messages 映射）直接复制，无改造。

##### 改造 6：删除 localServiceRegistry 所有使用处 + localServicesApi 监听

**桌面端 localServiceRegistry 共 4 处使用**（实际读取代码确认）：
1. **L292-294** connectWs onopen 中：`localServiceRegistry.loadConfig() + registerAll() + startHeartbeat()`
2. **L326** connectWs onclose 中：`localServiceRegistry.stopHeartbeat()`
3. **L858-866** handleProxyRequest 函数：`localServiceRegistry.handleProxyRequest(msg)`
4. **L1696-1697** beforeunload 监听附近：`window.localServicesApi.onUnregister(() => closeWs())`

**改造步骤**：

**6.1 删除 connectWs onopen 中 localServiceRegistry 调用（L289-298）**：

```typescript
// 桌面端原版（line 289-298）：
    // Phase 6.2：WS 连接成功后注册本地服务（spec 3.3.6 节）
    void (async () => {
      try {
        await localServiceRegistry.loadConfig()
        await localServiceRegistry.registerAll()
        localServiceRegistry.startHeartbeat()
      } catch (err) {
        console.error('[useAIStore] local service registry failed:', err)
      }
    })()

// Web 端改造版：删除整个 void (async () => { ... })() 块
// onopen 仅保留 notifyOnline(true) + wsPingTimer 启动
```

**6.2 删除 connectWs onclose 中 localServiceRegistry 调用（L326）**：

```typescript
// 桌面端原版（line 326）：
      localServiceRegistry.stopHeartbeat()

// Web 端改造版：删除该行
```

**6.3 删除 handleProxyRequest 函数（L854-868）**：

```typescript
// 桌面端原版（line 854-868）：
  /**
   * Phase 6.2：处理服务器发来的 proxy_request（spec 3.3.7 节）
   * 调用 localServiceRegistry 执行本地 fetch，返回 proxy_response
   */
  async function handleProxyRequest(msg: {
    requestId: string
    serviceName: string
    method: string
    path: string
    headers: Record<string, string>
    body: string | null
  }): Promise<void> {
    const response = await localServiceRegistry.handleProxyRequest(msg)
    sendWs({ kind: 'proxy_response', ...response })
  }

// Web 端改造版：删除整个 handleProxyRequest 函数
```

**6.4 删除 handleServerMessage 中 proxy_request if 分支（L575-579）**：

**桌面端现状**（实际读取 L574-579 确认）：`proxy_request` 不是 switch case 分支，而是 handleServerMessage 函数开头的 if 语句（在 panelId 过滤之前处理设备级消息）。

```typescript
// 桌面端原版（line 574-579）：
  function handleServerMessage(msg: ServerMessage): void {
    // Phase 6.2：proxy_request 是设备级消息，不带 panelId，在 panelId 过滤之前处理
    if (msg.kind === 'proxy_request') {
      void handleProxyRequest(msg)
      return
    }
    // ... 后续 panelId 过滤 + switch case ...
  }

// Web 端改造版（line 574-579）：
  function handleServerMessage(msg: ServerMessage): void {
    // 删除 proxy_request if 分支（web 端无 localServiceRegistry）
    // ... 后续 panelId 过滤 + switch case ...
  }
```

**6.5 删除 handleAgentEvent 函数（L813-852）**：

```typescript
// 桌面端原版（line 813-852）：
  function handleAgentEvent(sessionId: string, event: AgentEvent): void {
    switch (event.type) {
      case 'text_delta': { ... }
      case 'tool_call': { ... }
      case 'tool_result': { ... }
      case 'turn_end': { ... }
      case 'error': { ... }
    }
  }

// Web 端改造版：删除整个 handleAgentEvent 函数
// 说明：handleAgentEvent 仅用于本地 agent 模式（agentApi.onEvent 回调）
// Web 端无本地 agent，pi_event 通过 WS 接收，由 handlePiEvent 处理
```

**6.6 删除 localServicesApi onUnregister 监听（L1696-1700）**：

**桌面端现状**（实际读取 L1695-1700 确认）：`onUnregister` 回调内调用的是 `localServiceRegistry.unregisterAll()`（不是 `closeWs()`），且条件包含 `typeof window !== 'undefined'` 检查。

```typescript
// 桌面端原版（line 1695-1700）：
// Phase 6.2：监听主进程 before-quit 通知，注销本地服务（spec 3.3.6 节）
if (typeof window !== 'undefined' && window.localServicesApi) {
  window.localServicesApi.onUnregister(() => {
    void localServiceRegistry.unregisterAll()
  })
}

// Web 端改造版：删除整个 if 块（line 1695-1700）
// Web 端无 localServicesApi，无 localServiceRegistry
```

**6.7 删除 import**：

```typescript
// 桌面端 line 61：
import { localServiceRegistry } from '../utils/localServiceRegistry'  // ← 删除

// Web 端：不复制该 import
```

##### 改造 7：删除 handleServerChange（line 877-933）

```typescript
// 桌面端 useAIStore.handleServerChange（line 877-933）：
// 调用 useAppStore.refreshPanels/refreshWidgets 等
// S12 已在 useAppStore 中实现 handleServerChange
// S13 useAIStore 的 onmessage 'change' case 直接调用 useAppStore.handleServerChange

// Web 端 useAIStore onmessage 'change' case：
case 'change':
  useAppStore.getState().handleServerChange(
    msg.changeType,
    msg.data,
    msg.sourceDeviceId,
  )
  break
// useAIStore 自身不再定义 handleServerChange 方法
```

##### 改造 8：保留所有其他逻辑

以下方法/逻辑**直接复制，无改造**：
- `loadSessionList`(133) / `persistSessionList`(145) / `upsertSessionMeta`(154) / `removeSessionMeta`(175)
- `notifyOnline`(220) / `notifyMessage`(230)
- `scheduleReconnect`(240) / `sendWs`(356) / `closeWs`(370)
- `getUseAppStore`(398)
- `createEmptySession`(492) / `extractTextDelta`(539) / `extractToolStart`(555)
- `handlePiEvent` / `handleToolCall`
- `respondToPermission`(1297) / `respondToAskUser`(1314)
- `confirmDataSend`(1573) / `rejectDataSend`(1590)
- `switchSession`(1611) / `renameSession`(1490) / `setSessionModel`(1529)
- `deleteSession`(1385)（sendWs dispose_session）
- `clearSearchResults`(1684)
- WS 事件处理 case：`pi_event`(598) / `tool_call`(603) / `tool_result`(829) / `ask_user`(626) / `permission_request`(673) / `change`(622) / `session_ready` / `pong` / `error`
  - **注意**：`proxy_request` case 已在改造6.4 中删除，不要保留

**已删除的函数**（不要复制）：
- `handleAgentEvent`(813) — 本地 agent 模式专用，已在改造6.5 中删除
- `handleProxyRequest`(854-868) — 依赖 localServiceRegistry，已在改造6.3 中删除

**验证**：
- `useAIStore` 导出 `useAIStore`/`useAIStoreType`/`setUseAppStoreRef`/`getUseAppStoreRef`/`registerAppStateProvider`（兼容 S12 stub 接口）
  - **新增 `getUseAppStoreRef` 导出**（桌面端 L398 `getUseAppStore` 是内部函数不导出，但 web 端 S12 stub L75-77 导出了 `getUseAppStoreRef`。S13 替换 useAIStore 时需新增 `export function getUseAppStoreRef() { return _useAppStoreRef?.() }` 以兼容 S12 stub 接口）
- `reportWidgetError(widgetId, panelId, error)` 3 参数签名保留（HtmlCanvasWidget 依赖）
- TS 编译零 error

#### S13.1-T3：useAppStore 删除 WS 初始化（迁移到 useAIStore）

**目标文件**：`client/web/src/stores/useAppStore.ts`

**改造点**：

S12 在 useAppStore 中独立初始化 WS（S12.3-T11）。S13 把 WS 逻辑迁移到 useAIStore（恢复桌面端架构），useAppStore 仅保留 `handleServerChange`。

##### 删除 `initWebSocket` 函数（S12 line 3111-3147）

```typescript
// 删除整个 initWebSocket 函数
// let wsClient: WebSocket | null = null
// async function initWebSocket(): Promise<void> { ... }
```

##### 删除 `handleWsMessage` 函数（S12 line 3157-3185）

```typescript
// 删除整个 handleWsMessage 函数
// function handleWsMessage(msg: { kind: string; [key: string]: unknown }): void { ... }
```

##### 删除 `startHeartbeat` 函数（S12 line 3190-3197）

```typescript
// 删除整个 startHeartbeat 函数
// let heartbeatTimer: ReturnType<typeof setInterval> | null = null
// function startHeartbeat(): void { ... }
```

##### `initialize` action 删除 WS 调用（S12 line 1076-1081）

```typescript
// S12 版本：
initialize: async () => {
  // ... 原有初始化逻辑 ...
  await initWebSocket()    // ← 删除
  startHeartbeat()         // ← 删除
  set({ initialized: true })
}

// S13 版本：
initialize: async () => {
  // ... 原有初始化逻辑 ...
  // WS 初始化由 useAIStore.initialize() 负责（CanvasHome useEffect 调用）
  set({ initialized: true })
}
```

##### 保留 `handleServerChange` 方法（S12 line 2535）

```typescript
// 保留，被 useAIStore onmessage 'change' case 调用
handleServerChange: async (changeType: string, data: unknown, sourceDeviceId?: string) => {
  // ... S12 已实现，无改造 ...
}
```

**验证**：
- useAppStore 不再含 WS 初始化代码
- `handleServerChange` 保留
- `initialize` 不再调 `initWebSocket`/`startHeartbeat`
- TS 编译零 error

#### S13.1-T4：验证 CanvasHome.initialize 已调用（S12 已存在，无需改造）

**目标文件**：`client/web/src/components/CanvasHome.tsx`

**现状**（S12 已实现，无需新增代码）：
- line 20：`import { useAIStore } from '../stores/useAIStore'`
- line 50：`const isInitialized = useAIStore(s => s.isInitialized)`
- line 52：`const initialize = useAIStore(s => s.initialize)`
- line 78-82：`useEffect(() => { if (!isInitialized) initialize() }, [isInitialized, initialize])`

**说明**：S12 把 useAIStore 实现为 stub 时，CanvasHome 已正确接入 useAIStore 的 `initialize()`。S13 把 useAIStore stub 替换为完整实现后，CanvasHome 的 `useEffect` 会自动调用真正的 `initialize()`（建立 WS 连接），无需修改 CanvasHome 代码。

**验证**：
- CanvasHome 加载时 useAIStore.initialize() 被调用（控制台应出现 `[useAIStore] WS connected to ...`）
- WS 连接建立（浏览器 DevTools Network 面板可见 `ws://...?deviceId=...&token=...`）
- 控制台无 error

#### S13.1-T5：会话历史恢复验证

**目标**：`useAIStore.loadSessionHistory` 调用 `/api/conversations/:sessionId` 恢复历史

**验证**：
- 创建 AIAssistant widget → 发送消息 → 刷新页面 → 对话历史从 server 恢复
- 桌面端创建的会话，Web 端能恢复（同 panelId）

#### S13.1-T6：多端思考流广播验证

**目标**：同一面板多端在线时，AI 思考流广播到所有端

**验证**：
- 桌面端 + Web 端同时打开同一面板
- 桌面端发消息 → Web 端实时看到思考流（pi_event 广播）
- Web 端发消息 → 桌面端实时看到思考流

**依赖**：v1 S2 per-panel activeDeviceId + 定向广播（已实现）

### 3.2 S13.1 验收标准

- [ ] `client/web/src/components/ai/` 包含 AIStatusBars/SearchResultsPanel/SearchResultsCard
- [ ] `client/web/src/components/AskUserCard.tsx` + `PermissionCard.tsx` + `DataSendPreviewCard.tsx` 存在
- [ ] `client/web/src/stores/useAIStore.ts` 完整实现（覆盖 S12 stub），导出 5 个必需符号
- [ ] useAIStore 无 `window.serverPortApi`/`window.agentApi`/`window.localServicesApi` 调用
- [ ] useAIStore WS URL 用 `window.location.host`（同源）
- [ ] useAIStore WS 连接携带 `?deviceId=xxx&token=<JWT from sessionStorage>`
- [ ] useAIStore sendMessage 仅走 `sendWs({kind:'user_message'})`，无 agentApi 分支
- [ ] useAIStore onmessage 处理 pi_event/tool_call/tool_result/ask_user/permission_request/change/session_ready/pong/error
- [ ] useAIStore 'change' case 调用 `useAppStore.handleServerChange`
- [ ] useAppStore 删除 initWebSocket/handleWsMessage/startHeartbeat
- [ ] useAppStore 保留 handleServerChange
- [ ] CanvasHome useEffect 调用 useAIStore.initialize()
- [ ] Web 端创建 AIAssistant widget，输入消息发送，看到思考流 + 回复
- [ ] AI 调用 ask_user，Web 端弹 AskUserCard，用户选择后 AI 继续
- [ ] AI 调用 permission_request，Web 端弹 PermissionCard
- [ ] 刷新页面，对话历史从 server 恢复
- [ ] 桌面端发消息，Web 端同面板实时看到思考流
- [ ] TS 编译零 error

---

## 四、S13.2 AI 配置 UI

### 4.1 任务清单

#### S13.2-T1：复制 AIPromptConfig.tsx（可直接复用）

| 源文件 | 目标文件 | 行数 |
|--------|---------|------|
| `client/desktop/src/components/settings/AIPromptConfig.tsx` | `client/web/src/components/settings/AIPromptConfig.tsx` | 182 |

**改造**：无。仅依赖 `api/client`（HTTP 调用 `/api/ai/prompts`）。

#### S13.2-T2：复制 AISkillsManager.tsx（可直接复用）

| 源文件 | 目标文件 | 行数 |
|--------|---------|------|
| `client/desktop/src/components/settings/AISkillsManager.tsx` | `client/web/src/components/settings/AISkillsManager.tsx` | 455 |

**改造**：无。仅依赖 `api/client`（HTTP 调用 `/api/skills` CRUD）。

#### S13.2-T3：改造 AIApiConfig.tsx

| 源文件 | 目标文件 | 行数 |
|--------|---------|------|
| `client/desktop/src/components/settings/AIApiConfig.tsx` | `client/web/src/components/settings/AIApiConfig.tsx` | 255 |

**改造点**：

##### 保留 useApiConfigStore 依赖（line 4 import）

```typescript
// 桌面端 line 4 import（保留，S12 已复制 useApiConfigStore 到 web 端）：
import { inferProviderFromEndpoint, suppressNextServerSync } from '../../stores/useApiConfigStore'
```

**说明**：S12 已将 `useApiConfigStore` 复制到 `client/web/src/stores/useApiConfigStore.ts`，接口与桌面端兼容。`inferProviderFromEndpoint`（从 endpoint URL 推断 provider）和 `suppressNextServerSync`（防止下次 PUT /ai/settings 触发 server 反向同步）都是纯函数/纯 store 方法，无 window.*Api 依赖，直接复用。

##### 删除 window.aiKeyApi 调用（line 72-84）

```typescript
// 桌面端原版（line 72-84）：
async function handleSave() {
  // ...
  // 桌面端：同步 API key 到 Electron safeStorage
  if (typeof window !== 'undefined' && window.aiKeyApi?.setApiKey) {  // ← 删除整个 if 块
    await window.aiKeyApi.setApiKey(provider, apiKey, endpoint, model)
  }
  // 纯走 server API
  await api.put('/ai/settings', { provider, apiKey, endpoint, model })
}

// Web 端改造版：
async function handleSave() {
  // ...
  // Web 端：纯走 server API，apiKey 由 server 端加密存储
  await api.put('/ai/settings', { provider, apiKey, endpoint, model })
}
```

##### 保留 /api/ai/test-connection 调用（line 108）

```typescript
// 保留，无改造
const result = await api.post('/ai/test-connection', body)
```

#### S13.2-T4：新建 ToolsManager.tsx（工具管理 UI）

**目标文件**：`client/web/src/components/settings/ToolsManager.tsx`

**功能**：管理工具启用/禁用，调用 `/api/tools` CRUD

**依据**：桌面端是否有 ToolsManager？调查未明确，假设需要新建（roadmap 要求"工具管理 UI"）。

```typescript
import { useEffect, useState } from 'react'
import { api } from '../../api/client'

interface Tool {
  name: string
  enabled: boolean
  description?: string
}

export default function ToolsManager() {
  const [tools, setTools] = useState<Tool[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api.get('/tools')
      .then((data) => setTools(data as Tool[]))
      .catch((err) => setError(String(err)))
      .finally(() => setLoading(false))
  }, [])

  async function toggleTool(name: string, enabled: boolean) {
    try {
      await api.put(`/tools/${encodeURIComponent(name)}`, { enabled })
      setTools((prev) => prev.map((t) => t.name === name ? { ...t, enabled } : t))
    } catch (err) {
      setError(String(err))
    }
  }

  if (loading) return <div>加载工具列表...</div>
  if (error) return <div>错误：{error}</div>

  return (
    <div className="tools-manager">
      <h3>工具管理</h3>
      <ul>
        {tools.map((tool) => (
          <li key={tool.name}>
            <span>{tool.name}</span>
            {tool.description && <small> — {tool.description}</small>}
            <label>
              <input
                type="checkbox"
                checked={tool.enabled}
                onChange={(e) => toggleTool(tool.name, e.target.checked)}
              />
              {tool.enabled ? '已启用' : '已禁用'}
            </label>
          </li>
        ))}
      </ul>
    </div>
  )
}
```

#### S13.2-T5：复制 ApiConfigModal（如有）

**调查**：桌面端 `AIAssistantSidebar.tsx:37` import `ApiConfigModal`。S13 不复制 AIAssistantSidebar，但 AIAssistant widget 可能依赖 ApiConfigModal。

**验证步骤**：
1. grep `client/desktop/src/components/widgets/AIAssistant.tsx` 是否 import ApiConfigModal
2. 如是，复制 ApiConfigModal + 其依赖
3. 如否，跳过此任务

**预期**：AIAssistant widget 不直接依赖 ApiConfigModal（它是 sidebar 的子组件）。S13 跳过此任务。

#### S13.2-T6：设置页路由 + 入口

**目标文件**：`client/web/src/App.tsx`

**改造点**：新增 `/settings` 路由

```typescript
// App.tsx 新增 import：
import Settings from './pages/Settings'

// Routes 新增：
<Route path="/settings" element={<AuthGuard><Settings /></AuthGuard>} />
```

**新建 `client/web/src/pages/Settings.tsx`**：

```typescript
import { useState } from 'react'
import AIApiConfig from '../components/settings/AIApiConfig'
import AIPromptConfig from '../components/settings/AIPromptConfig'
import AISkillsManager from '../components/settings/AISkillsManager'
import ToolsManager from '../components/settings/ToolsManager'

type Tab = 'api' | 'prompt' | 'skills' | 'tools'

export default function Settings() {
  const [tab, setTab] = useState<Tab>('api')

  return (
    <div className="settings-page">
      <nav className="settings-nav">
        <button onClick={() => setTab('api')} className={tab === 'api' ? 'active' : ''}>AI API 配置</button>
        <button onClick={() => setTab('prompt')} className={tab === 'prompt' ? 'active' : ''}>提示词配置</button>
        <button onClick={() => setTab('skills')} className={tab === 'skills' ? 'active' : ''}>Skills 管理</button>
        <button onClick={() => setTab('tools')} className={tab === 'tools' ? 'active' : ''}>工具管理</button>
      </nav>
      <div className="settings-content">
        {tab === 'api' && <AIApiConfig />}
        {tab === 'prompt' && <AIPromptConfig />}
        {tab === 'skills' && <AISkillsManager />}
        {tab === 'tools' && <ToolsManager />}
      </div>
    </div>
  )
}
```

**CanvasHome 添加设置入口**：

```typescript
// CanvasHome.tsx 新增"设置"按钮
import { useNavigate } from 'react-router-dom'

function CanvasHome() {
  const navigate = useNavigate()
  // ...
  return (
    <div>
      {/* ... 原有内容 ... */}
      <button onClick={() => navigate('/settings')}>设置</button>
    </div>
  )
}
```

### 4.2 S13.2 验收标准

- [ ] `client/web/src/components/settings/` 包含 AIApiConfig/AIPromptConfig/AISkillsManager/ToolsManager
- [ ] `client/web/src/pages/Settings.tsx` 存在，4 个 tab 切换正常
- [ ] App.tsx 含 `/settings` 路由
- [ ] CanvasHome 有"设置"入口按钮
- [ ] AIApiConfig 无 `window.aiKeyApi` 调用，纯走 `PUT /api/ai/settings`
- [ ] Web 端配置 LLM Key（DeepSeek/StepFun/OpenAI），保存到 server，AI 对话可用
- [ ] Web 端配置提示词，保存后生效
- [ ] Web 端管理 Skills，启用/禁用生效
- [ ] Web 端管理工具，启用/禁用生效
- [ ] 连接测试 `POST /api/ai/test-connection` 返回 ok
- [ ] TS 编译零 error

---

## 五、S13.3 工具调用适配

### 5.1 任务清单

#### S13.3-T1：替换 wsToolHandlers.ts（覆盖 S12 stub）

**源文件**：`client/desktop/src/utils/wsToolHandlers.ts`（614 行）
**目标文件**：`client/web/src/utils/wsToolHandlers.ts`（覆盖 S12 stub）

**改造点**：

##### 改造 1：删除 browserToolBridge import（line 41）

```typescript
// 桌面端原版（line 41）：
import { browserToolBridge } from './browserToolBridge'  // ← 删除

// Web 端：不 import browserToolBridge
// browser_* 工具统一返回 not-supported
```

##### 改造 2：新增 browserToolNotSupported helper

```typescript
// Web 端新增 helper（在文件顶部）：
const BROWSER_TOOL_NOT_SUPPORTED_MSG = 'Web 端不支持浏览器工具，请在桌面端操作'

function browserToolNotSupported(toolName: string): ToolCallResult {
  return {
    success: false,
    error: `${BROWSER_TOOL_NOT_SUPPORTED_MSG} (tool: ${toolName})`,
  }
}
```

##### 改造 3：executeToolCall switch 中 browser_* case 改为降级（line 534-568）

```typescript
// 桌面端原版（line 534-568）：每个 browser_* case 调用 browserToolBridge.xxx
// Web 端改造版：所有 browser_* case 统一返回 browserToolNotSupported

case 'browser_eval':
case 'browser_get_dom':
case 'browser_click':
case 'browser_input':
case 'browser_scroll':
case 'browser_wait_for':
case 'browser_screenshot':
case 'browser_navigate':
case 'browser_get_url':
case 'browser_get_title':
case 'browser_back':
case 'browser_forward':
case 'browser_reload':
case 'browser_get_cookie':
case 'browser_set_cookie':
case 'browser_open':
case 'browser_switch_tab':
case 'browser_list_tabs':
  return browserToolNotSupported(tool)
```

##### 改造 4：保留 8 个数据类工具 case（line 522-585）

```typescript
// 保留，无改造：
case 'create_html_widget':  // line 522
  // 调用 useAppStore.addWidget
case 'update_html_widget':  // line 524
  // 调用 useAppStore.updateWidgetState/Position
case 'delete_html_widget':  // line 526
  // 调用 useAppStore.removeWidget
case 'list_widgets':        // line 528
  // 读取 useAppStore.panelWidgets
case 'storage_read':        // line 530
  // 调用 readFromLegacyTable
case 'storage_write':       // line 532
  // 写入 IDB
case 'local_search':        // line 570
  // 调用 localSearch 模块
case 'query_capabilities':  // line 585
  // 返回能力清单
```

##### 改造 5：Web 端新建 BROWSER_TOOLS 数组（桌面端无此数组）

**桌面端现状**：`wsToolHandlers.ts` line 496-501 是 `browserToolsNeedingWidgetId` Set（15 项，仅记录需要 widgetId 注入的工具），不是 BROWSER_TOOLS 数组。case 语句在 line 534-568 共 18 项 browser_*。

**Web 端做法**：新建 BROWSER_TOOLS 数组（const string[]），用于 executeToolCall 入口处快速判断工具是否为 browser_* 类，统一返回 not-supported 错误。无需复制 `browserToolsNeedingWidgetId` Set（web 端 browser_* 全部降级，不需要 widgetId 注入）。

```typescript
// Web 端新建：BROWSER_TOOLS 数组（用于快速判断工具是否为浏览器类）
// 即使全部降级，仍需保留数组以便 executeToolCall 入口处快速 return
const BROWSER_TOOLS = [
  'browser_eval', 'browser_get_dom', 'browser_click', 'browser_input',
  'browser_scroll', 'browser_wait_for', 'browser_screenshot', 'browser_navigate',
  'browser_get_url', 'browser_get_title', 'browser_back', 'browser_forward',
  'browser_reload', 'browser_get_cookie', 'browser_set_cookie',
  'browser_open', 'browser_switch_tab', 'browser_list_tabs',
]
```

##### 改造 6：保留 readFromLegacyTable + ToolCallResult 导出

```typescript
// 保留导出：
export interface ToolCallResult { ... }  // line 47
export async function readFromLegacyTable(table, key): Promise<ToolCallResult> { ... }  // line 379
export async function executeToolCall(tool, params): Promise<ToolCallResult> { ... }  // line 492
```

**验证**：
- AI 调用 `create_html_widget` → Web 端成功创建 HtmlCanvasWidget
- AI 调用 `local_search` → Web 端 IndexedDB 索引查询返回结果
- AI 调用 `browser_*` → 返回 `tool_result.success=false, error='Web 端不支持...'`
- AI 收到 browser_* 错误后能继续对话（不卡死）

#### S13.3-T2：验证 8 个数据类工具

| 工具 | 验证方式 |
|------|---------|
| `create_html_widget` | AI 调用 → Web 端创建 HtmlCanvasWidget，渲染在画布上 |
| `update_html_widget` | AI 调用 → widget state/position 更新 |
| `delete_html_widget` | AI 调用 → widget 从画布删除 |
| `list_widgets` | AI 调用 → 返回当前面板 widget 清单 |
| `storage_read` | AI 调用 → 返回 IDB 存储数据 |
| `storage_write` | AI 调用 → 写入 IDB |
| `local_search` | AI 调用 → 返回本地搜索结果 |
| `query_capabilities` | AI 调用 → 返回能力清单 |

#### S13.3-T3：验证 browser_* 降级

**测试方法**：让 AI 调用 `browser_navigate`，验证返回 not-supported 错误，AI 能继续对话。

```typescript
// 预期 tool_result：
{
  success: false,
  error: 'Web 端不支持浏览器工具，请在桌面端操作 (tool: browser_navigate)'
}
```

### 5.2 S13.3 验收标准

- [ ] `client/web/src/utils/wsToolHandlers.ts` 完整实现（覆盖 S12 stub）
- [ ] 导出 `ToolCallResult`/`readFromLegacyTable`/`executeToolCall`
- [ ] 8 个数据类工具可调用，功能正常
- [ ] 18 个 browser_* 工具统一返回 not-supported 错误
- [ ] AI 收到 browser_* 错误后能继续对话
- [ ] 无 `browserToolBridge` import
- [ ] TS 编译零 error

---

## 六、整体数据流

### 6.1 AI 对话完整流程

```
1. 用户打开 Web 端，登录后跳转 CanvasHome
2. CanvasHome useEffect 调用：
   - useAppStore.initialize() → IDB 初始化 + loadAllData
   - useAIStore.initialize() → connectWs + startHeartbeat + loadSessionList
3. WS 连接：wss://host/ws?deviceId=xxx&token=<JWT>
4. 用户创建 AIAssistant widget
5. 用户输入消息 → AIAssistant 调 useAIStore.sendMessage(sessionId, content)
6. useAIStore.sendMessage:
   ├── 更新 session.messages（user message）
   ├── sendWs({ kind: 'user_message', sessionId, panelId, content, thinkingLevel })
   └── server 收到 user_message
       ├── server 调用云端 agent（Pi Agent）
       └── agent 流式生成 pi_event → server 通过 WS 推送
           └── useAIStore onmessage case 'pi_event':
               ├── handlePiEvent(msg.event, msg.data)
               ├── 更新 session.messages（thinking/reply）
               └── AIAssistant widget 重新渲染，显示思考流 + 回复
7. agent 调用工具：
   └── server 通过 WS 推送 tool_call
       └── useAIStore onmessage case 'tool_call':
           ├── handleToolCall(requestId, tool, params)
           ├── wsToolHandlers.executeToolCall(tool, params)
           │   ├── 数据类工具 → 执行 → 返回 result
           │   └── browser_* → 返回 not-supported
           └── sendWs({ kind: 'tool_result', requestId, result })
               └── server 收到 tool_result，继续 agent loop
8. agent 提问用户：
   └── server 通过 WS 推送 ask_user
       └── useAIStore onmessage case 'ask_user':
           ├── set({ pendingAskUser: { requestId, options } })
           └── AIAssistant widget 渲染 AskUserCard
               └── 用户选择 → useAIStore.respondToAskUser(requestId, selectedValues)
                   └── sendWs({ kind: 'ask_user_response', requestId, selectedValues })
9. agent 危险操作授权：
   └── server 通过 WS 推送 permission_request
       └── useAIStore onmessage case 'permission_request':
           ├── set({ pendingPermissionRequests: [...] })
           └── AIAssistant widget 渲染 PermissionCard
               └── 用户授权 → useAIStore.respondToPermission(requestId, response)
                   └── sendWs({ kind: 'permission_response', requestId, response })
10. 数据变更广播：
    └── server 通过 WS 推送 change 事件
        └── useAIStore onmessage case 'change':
            └── useAppStore.handleServerChange(changeType, data, sourceDeviceId)
                └── refreshPanels/refreshWidgets/refreshAll
```

### 6.2 WS 连接生命周期

```
useAIStore.initialize()
  ├── connectWs()
  │   ├── buildWsUrl() → wss://host/ws
  │   ├── 拼接 ?deviceId=xxx&token=<JWT from sessionStorage>
  │   ├── new WebSocket(fullUrl)
  │   ├── onopen → notifyOnline(true) + sendWs({kind:'ping'})
  │   ├── onmessage → handleWsMessage(msg)
  │   ├── onerror → console.error
  │   └── onclose → notifyOnline(false) + scheduleReconnect(5s)
  └── startHeartbeat()
      └── setInterval(30s) → sendWs({kind:'ping'})

handleWsMessage(msg):
  ├── case 'pi_event' → handlePiEvent
  ├── case 'tool_call' → handleToolCall
  ├── case 'tool_result' → 恢复 thinking 状态
  ├── case 'ask_user' → set pendingAskUser
  ├── case 'permission_request' → set pendingPermissionRequests
  ├── case 'change' → useAppStore.handleServerChange
  ├── case 'session_ready' → 标记 session 就绪
  ├── case 'pong' → 心跳响应，忽略
  └── case 'error' → console.error
```

### 6.3 WS 迁移说明（S12 → S13）

| 项 | S12（useAppStore） | S13（useAIStore） |
|----|-------------------|------------------|
| WS 初始化 | `useAppStore.initWebSocket()` | `useAIStore.connectWs()` |
| 心跳 | `useAppStore.startHeartbeat()` | `useAIStore.startHeartbeat()` |
| 消息分发 | `useAppStore.handleWsMessage()` | `useAIStore.handleWsMessage()` |
| change 事件 | 直接调 `handleServerChange` | 调 `useAppStore.handleServerChange` |
| pi_event/tool_call 等 | 忽略（S13 处理） | useAIStore 内部处理 |
| 调用时机 | `useAppStore.initialize()` | `useAIStore.initialize()`（CanvasHome useEffect） |

---

## 七、关键风险与缓解

### 7.1 技术风险

| 风险 | 概率 | 影响 | 缓解方案 |
|------|------|------|---------|
| useAIStore 1703 行移植后 TS 编译错误多 | 高 | 高 | 物理复制后逐个删除 window.*Api 调用，每次 typecheck 验证 |
| WS 迁移后 S12 change 事件处理失效 | 中 | 高 | S13.1-T3 保留 useAppStore.handleServerChange，useAIStore 'change' case 调用它 |
| useAIStore ↔ useAppStore 循环依赖 | 高 | 高 | 保留 setUseAppStoreRef/getUseAppStoreRef 双向引用（S12 stub 已建立） |
| AIAssistant widget S12 复制版与 S13 useAIStore 接口不匹配 | 中 | 中 | S13.1-T2 完整实现 useAIStore 后，typecheck 会暴露不匹配 |
| sessionStorage JWT 过期后 WS 连接失败 | 中 | 中 | connectWs 检测 token 缺失 → console.warn + 跳转 /login |
| browser_* 降级后 AI 卡死不继续对话 | 低 | 中 | tool_result.success=false + 明确错误信息，AI 应能 fallback |
| ToolsManager 桌面端无对应组件，新建风格不一致 | 低 | 低 | 参考桌面端 settings 组件风格，使用相同的 className 模式 |
| 多端思考流广播不工作 | 中 | 高 | 依赖 v1 S2 per-panel activeDeviceId，验证桌面端 + Web 端同面板场景 |
| WS 重连后 session 状态丢失 | 中 | 中 | scheduleReconnect 保留，重连后重新 subscribe panel |
| pdfjs-dist worker 在 Vite 构建中路径错误（S12 遗留） | 低 | 低 | S12 已处理，S13 不动 |

### 7.2 产品风险

| 风险 | 概率 | 影响 | 缓解方案 |
|------|------|------|---------|
| Web 端无本地 agent，离线时 AI 不可用 | 100% | 中 | 明确产品定位：Web 端始终在线，离线用桌面端 |
| browser_* 不可用导致 AI 能力打折 | 100% | 中 | AI 自动 fallback：browser_* 失败后用 search 工具替代；提示用户用桌面端 |
| Web 端 thinkingLevel 动态切换不支持 | 中 | 低 | sendMessage 时携带 thinkingLevel，slider 改为"下次发送生效" |

---

## 八、对抗审查检查清单（spec 自审）

### 8.1 完整性检查

- [x] useAIStore 完整移植覆盖（1703 行，8 个改造点）
- [x] 6 个 AI 子组件复用覆盖（AIStatusBars/SearchResultsPanel/SearchResultsCard/AskUserCard/PermissionCard/DataSendPreviewCard）
- [x] 3 个 AI 配置 UI 覆盖（AIApiConfig/AIPromptConfig/AISkillsManager）
- [x] 1 个新建组件覆盖（ToolsManager）
- [x] wsToolHandlers 完整改造覆盖（8 工具保留 + 18 browser_* 降级）
- [x] WS 迁移方案明确（useAppStore → useAIStore）
- [x] CanvasHome 调用 useAIStore.initialize() 覆盖
- [x] 设置页路由 + 入口覆盖
- [x] 多端思考流广播验证覆盖

### 8.2 一致性检查

- [x] S13 验收标准与 roadmap v2 第三章 S13 验收标准一致
- [x] 不破坏桌面/移动端兼容（仅在 client/web/ 操作）
- [x] 不重写 v1 已有能力
- [x] TypeScript 优先（所有文件 .ts/.tsx）
- [x] 不下载到 C 盘（依赖安装到 F:\allmylife\event\client\web\node_modules\）
- [x] 不修改 server（server 端 WS + AI 路由已就绪）

### 8.3 风险覆盖

- [x] useAIStore 移植编译错误风险已识别 + 缓解方案
- [x] WS 迁移风险已识别 + 缓解方案
- [x] 循环依赖风险已识别 + 缓解方案
- [x] 多端广播风险已识别 + 缓解方案
- [x] browser_* 降级风险已识别 + 缓解方案

### 8.4 已确认问题

1. **useAIStore 中无 `disposeSession` 方法**：使用 `deleteSession`（通过 sendWs dispose_session）。S13 保留此设计。

2. **thinkingLevel 动态切换**：桌面端通过 `window.agentApi.setThinkingLevel` 动态切换。Web 端无 agentApi，改为 sendMessage 时携带 thinkingLevel（user_message 消息字段）。slider 调整后下次发送消息生效。

3. **AgentModeSwitcher 不复制**：Web 端只有云端模式，无需模式切换。如 AIAssistant widget 不依赖它，就不复制。

4. **AIAssistantSidebar 不复制**：S13 只实现 AIAssistant widget（roadmap 验收标准）。Sidebar 是桌面端侧边栏形式，Web 端用 widget 形式。

5. **useThinkingLevelStore 已在 S13.1-T0 复制**：useAIStore import `useThinkingLevelStore`（L66），S13.1-T0 已明确复制 `useThinkingLevelStore.ts` + `thinkingLevel.ts` 到 web 端。

6. **WS 迁移决策**：S12 在 useAppStore 初始化 WS（临时方案）。S13 把 WS 迁移到 useAIStore（恢复桌面端架构），useAppStore 仅保留 handleServerChange。

7. **browser_* 工具数量**：roadmap 说 14 个，实际代码 18 个（含 browser_open/browser_switch_tab/browser_list_tabs）。S13 按 18 个降级。

8. **ToolsManager**：桌面端调查未明确发现 ToolsManager 组件。S13 新建简单版本（roadmap 要求"工具管理 UI"）。

---

## 九、Phase S13 验收标准（与 roadmap v2 对齐）

### 9.1 功能验收

- [ ] Web 端创建 AIAssistant widget，输入消息发送，看到思考流 + 回复
- [ ] AI 调用 `create_html_widget` 工具，Web 端成功创建 HtmlCanvasWidget
- [ ] AI 调用 `local_search` 工具，Web 端 IndexedDB 索引查询返回结果
- [ ] AI 调用 `browser_*` 工具，返回"Web 端不支持"提示，AI 继续对话
- [ ] AI 主动 `ask_user`，Web 端弹窗，用户选择后 AI 继续
- [ ] AI 危险操作 `permission_request`，Web 端授权弹窗
- [ ] 刷新页面，对话历史从 server 恢复
- [ ] 桌面端发消息，Web 端同面板实时看到思考流
- [ ] Web 端配置 LLM Key（DeepSeek/StepFun/OpenAI），保存到 server，AI 对话可用
- [ ] Web 端配置提示词，保存后生效
- [ ] Web 端管理 Skills，启用/禁用生效
- [ ] Web 端管理工具，启用/禁用生效
- [ ] 连接测试 API 返回 ok

### 9.2 运行时验证（强制）

- [ ] `cd client/web && npm run typecheck` 零 error
- [ ] `cd client/web && npm run build` 成功生成 dist/
- [ ] `cd client/web && npm run dev` 启动成功
- [ ] 登录后跳转 CanvasHome，创建 AIAssistant widget
- [ ] 输入消息 → 看到思考流 + 回复（Playwright 验证）
- [ ] AI 调用 create_html_widget → 画布出现新 widget（Playwright 验证）
- [ ] AI 调用 ask_user → 弹窗显示，用户选择后 AI 继续（Playwright 验证）
- [ ] AI 调用 permission_request → 授权弹窗显示（Playwright 验证）
- [ ] 刷新页面 → 对话历史恢复（Playwright 验证）
- [ ] 桌面端 + Web 端同面板 → 桌面端发消息 → Web 端实时看到思考流（多端验证）
- [ ] 配置 LLM Key → AI 对话可用（Playwright 验证）
- [ ] 连接测试 → 返回 ok（Playwright 验证）
- [ ] 工具启用/禁用 → 生效（Playwright 验证）

### 9.3 代码质量验收

- [ ] TypeScript 严格模式零 error
- [ ] 无 `console.log` 残留（除 stub 注释 + 错误日志 console.error）
- [ ] 无未使用 import
- [ ] 无 `any` 类型（除明确标注）
- [ ] 所有改造点有注释说明（如 `// S13 改造：移除 agentApi 分支`）

---

## 十、执行计划

### 10.1 执行顺序

```
1. S13.1-T1 复制 6 个 AI 子组件（无改造，可并行）
2. S13.2-T1 + T2 复制 AIPromptConfig + AISkillsManager（无改造，可并行）
3. S13.2-T3 改造 AIApiConfig（删除 window.aiKeyApi）
4. S13.2-T4 新建 ToolsManager
5. S13.2-T6 新建 Settings.tsx + 改造 App.tsx 路由 + CanvasHome 入口
6. S13.3-T1 替换 wsToolHandlers（覆盖 S12 stub，8 工具保留 + 18 browser_* 降级）
7. S13.1-T2 替换 useAIStore（核心，1703 行，8 个改造点）
8. S13.1-T3 useAppStore 删除 WS 初始化（迁移到 useAIStore）
9. S13.1-T4 CanvasHome 调用 useAIStore.initialize()
10. npm install + typecheck + 修复编译错误（迭代）
11. 运行时验证（Playwright）
12. 对抗审查（含运行时验证）
13. git commit
```

### 10.2 并行策略

**Phase A（并行，2 个 sub-agent）**：

- **Sub-agent 1**（UI 组件复制）：
  - S13.1-T1 复制 6 个 AI 子组件
  - S13.2-T1/T2/T3 复制 + 改造 AIPromptConfig/AISkillsManager/AIApiConfig
  - S13.2-T4 新建 ToolsManager
  - S13.2-T6 新建 Settings.tsx + 改造 App.tsx + CanvasHome

- **Sub-agent 2**（核心逻辑改造）：
  - S13.3-T1 替换 wsToolHandlers
  - S13.1-T2 替换 useAIStore（8 个改造点）
  - S13.1-T3 useAppStore 删除 WS 初始化
  - S13.1-T4 CanvasHome 调用 useAIStore.initialize()

**Phase B（串行验证）**：
- typecheck + 修复错误
- Playwright 运行时验证

### 10.3 关键依赖

```
S13.1-T2 (useAIStore) 依赖：
  ├── S13.3-T1 (wsToolHandlers) — handleToolCall 调用 executeToolCall
  ├── S12 useAppStore.handleServerChange — 'change' case 调用
  └── S12 sessionStorage JWT — connectWs 读取 token

S13.1-T3 (useAppStore 改造) 依赖：
  └── S13.1-T2 (useAIStore) — WS 逻辑迁移到 useAIStore 后才能删除

S13.1-T4 (CanvasHome) 依赖：
  └── S13.1-T2 (useAIStore) — 调用 initialize()

S13.2-T6 (Settings 路由) 依赖：
  └── S13.2-T1/T2/T3/T4 — 4 个配置组件就绪
```

---

## 十一、约束条件

| 约束 | 说明 |
|------|------|
| 不重写 v1 | v1 S0-S6/S9/S10 后端能力完全复用 |
| 不破坏桌面/移动端 | 仅在 `client/web/` 操作，不动 `client/desktop/` 与 `client/android/` |
| TypeScript 优先 | 所有文件 .ts/.tsx |
| 不下载到 C 盘 | node_modules 安装到 F:\allmylife\event\client\web\ |
| git 版本管理 | 完成后 git commit |
| 复用优先 | 物理复制 + 小改造，不重写已可用代码 |
| 运行时验证强制 | 不能只读代码，必须 Playwright 实际验证 |
| 不修改 server | server 端 WS + AI 路由已就绪，S13 仅改 client/web/ |
| Web 端只走云端 | 删除所有 window.agentApi/window.serverPortApi/window.localServicesApi 调用 |
| browser_* 全降级 | 18 个浏览器工具统一返回 not-supported |

---

**Spec 完成。下一步：对抗审查 → 编码实现 → 运行时对抗审查 → git commit。**
