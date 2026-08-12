# Phase 6 Spec：内存休眠策略 + 依赖本地环境组件跨端 + 搜索引擎设置

> 生成日期：2026-06-24（v2，已通过对抗审查修复 10 个严重问题）
> 依据：[roadmap_desktop_v1.md](file:///f:/allmylife/event/docs/roadmap_desktop_v1.md) Phase 6
> 架构依据：[architecture_refactor.md](file:///f:/allmylife/event/docs/architecture_refactor.md) 6.3 方案A + 第十二章
> 前置：Phase 0-5 全部已完成（验收 14/14 通过）
>
> **说明**：本 Spec 超出 roadmap Phase 6 范围（roadmap 第 264-272 行只有内存休眠 7 项验收）。6.2（本地服务跨端）和 6.3（搜索引擎设置）是用户额外要求。

---

## 一、项目背景

### 1.1 产品定位
Living Dashboard 桌面端 = 浏览器 + 无限画布 + AI，形态上是日常 AI 助手。

### 1.2 当前状态
- Phase 0-5 全部完成
- 双轨管理（webTabs + panels）已落地
- 收藏组件、网站预览、主页定制已完成
- dynamic_widgets 表已有 component_env/local_services/cross_platform/desktop_only 字段（方案 C 已做）
- **WebviewWidget.tsx:251 已实现 webview.stop()**（F6 修复），本 Spec 不重复实现

### 1.3 Phase 6 目标
1. **6.1 内存休眠策略**：非活跃面板/标签休眠，释放内存
2. **6.2 依赖本地环境组件跨端（方案 A）**：服务器中转，让移动端能调用桌面端本地服务
3. **6.3 搜索引擎设置（用户要求）**：默认 Bing，可在设置界面切换

---

## 二、6.1 内存休眠策略

### 2.1 设计目标
- 非活跃面板/标签释放内存
- 恢复时无白屏（骨架屏）
- WebView 状态可恢复（URL + 滚动位置）
- LRU 策略：最近最少使用的先休眠

### 2.2 三级状态模型

| 状态 | 触发条件 | 行为 | 恢复成本 |
|------|----------|------|----------|
| **active** | 当前激活的面板/标签 | 完整渲染 | - |
| **background** | 切换到其他面板/标签 | 组件树保留内存（webview.stop() 已由 WebviewWidget 现有逻辑处理） | 低（重新激活即可） |
| **hibernated** | 后台超 5 分钟 **或** 内存达 1.5GB | 卸载组件树，状态存 `panel_memory_states` 表 | 中（从数据库恢复 + 骨架屏） |
| **deep-hibernated** | 内存达 2GB | 只保留面板元数据（id/name/sort_order），清空 `panelWidgets[panelId]` 和 `panelPositions[panelId]` | 高（重新加载面板所有数据） |

> **阈值调整说明**：原 Spec 1GB/1.5GB 阈值过低（Electron 初始 200-500MB + 5 个 webview 各 100-300MB 易触发）。改为 1.5GB/2GB，可在设置中配置。

### 2.3 实现任务

#### 2.3.1 PanelMemoryManager（核心管理器）
**文件**：`client/desktop/src/utils/panelMemoryManager.ts`（新建）

**职责**：
- 监控所有面板/标签的后台时间
- 监控进程内存使用（**通过 IPC 从主进程获取**，渲染进程无法直接调用 `process.memoryUsage()`）
- 触发休眠/深度休眠
- 维护 LRU 队列

**接口**：
```typescript
interface PanelMemoryState {
  panelId: string
  status: 'active' | 'background' | 'hibernated' | 'deep-hibernated'
  lastActiveAt: number  // 时间戳
  backgroundSince: number | null  // 进入后台的时间
  widgetCount: number
  estimatedMemoryBytes: number
  savedState: {
    webviewUrl?: string
    webviewScrollY?: number
    widgetStates?: Record<string, unknown>
  } | null
}

class PanelMemoryManager {
  private states = new Map<string, PanelMemoryState>()
  private listeners = new Set<(panelId: string, state: PanelMemoryState) => void>()
  private memoryCheckInterval: ReturnType<typeof setInterval> | null = null

  // 配置（从 settings.behavior 读取）
  private config = {
    hibernateAfterMs: 5 * 60 * 1000,      // 5 分钟
    hibernateMemoryThresholdBytes: 1.5 * 1024 * 1024 * 1024,  // 1.5GB
    deepHibernateThresholdBytes: 2 * 1024 * 1024 * 1024,      // 2GB
    memoryCheckIntervalMs: 30 * 1000,     // 30 秒检查一次
  }

  // API
  registerPanel(panelId: string): void
  unregisterPanel(panelId: string): void
  markActive(panelId: string): void  // 在 useAppStore.setActivePanel 中调用
  markBackground(panelId: string): void
  getPanelState(panelId: string): PanelMemoryState | undefined
  getAllStates(): PanelMemoryState[]
  forceHibernate(panelId: string): Promise<void>
  forceDeepHibernate(panelId: string): Promise<void>
  restorePanel(panelId: string): Promise<void>
  onStateChange(listener: (panelId: string, state: PanelMemoryState) => void): () => void
  start(): void  // 启动定时检查
  stop(): void
  updateConfig(newConfig: Partial<typeof config>): void

  // 内存获取（通过 IPC）
  private async getMemoryUsage(): Promise<{ rss: number; heapUsed: number; heapTotal: number; external: number }> {
    // 通过 preload 暴露的 window.memoryApi.getMemoryUsage() 调用主进程
    if (typeof window !== 'undefined' && (window as any).memoryApi) {
      return (window as any).memoryApi.getMemoryUsage()
    }
    // 降级：返回 0（不触发内存休眠）
    return { rss: 0, heapUsed: 0, heapTotal: 0, external: 0 }
  }
}
```

**LRU 策略实现**：
- `markActive` 时更新 `lastActiveAt`
- 触发休眠时，按 `lastActiveAt` 升序排序，先休眠最久未用的

**内存监控**：
- 通过 `window.memoryApi.getMemoryUsage()` IPC 调用主进程 `process.memoryUsage()`
- 达阈值时按 LRU 顺序触发休眠，直到内存降到阈值以下

#### 2.3.2 状态保存与恢复
**文件**：`client/desktop/src/utils/panelStatePersistence.ts`（新建）

**新建数据库表**（`server/src/db/schema.ts` 修改）：
```sql
CREATE TABLE IF NOT EXISTS panel_memory_states (
  panel_id TEXT PRIMARY KEY REFERENCES panels(id) ON DELETE CASCADE,
  saved_state JSONB NOT NULL DEFAULT '{}'::jsonb,
  saved_at BIGINT NOT NULL DEFAULT (EXTRACT(EPOCH FROM now()) * 1000)::BIGINT
);
```

**保存（休眠前）**：
```typescript
async function savePanelStateForHibernate(panelId: string): Promise<void> {
  // 1. 收集所有 widget 的当前 state（从 useAppStore.panelWidgets[panelId]）
  // 2. 对于 webPage widget，通过 webview.executeJavaScript('window.scrollY') 获取滚动位置
  //    （webview 标签无 getScrollY 方法，用 executeJavaScript 替代）
  // 3. 序列化到 panel_memory_states 表（通过新增的 API）
  // 4. 保存到 PanelMemoryManager.savedState
}
```

**恢复（激活时）**：
```typescript
async function restorePanelFromHibernation(panelId: string): Promise<void> {
  // 1. 从 panel_memory_states 表加载 saved_state
  // 2. 显示骨架屏（SkeletonScreen 组件）
  // 3. 渲染 widgets（从 saved_state 恢复 widget states）
  // 4. 对于 webPage widget，恢复 URL，在 did-finish-load 后执行 webview.executeJavaScript('window.scrollTo(0, ${y})')
  // 5. 延迟 300ms 移除骨架屏（确保渲染完成）
}
```

**deep-hibernated 恢复**：
```typescript
async function restorePanelFromDeepHibernation(panelId: string): Promise<void> {
  // 1. 显示骨架屏
  // 2. 调用 refreshWidgets(panelId) 从服务器重新加载该面板的所有 widgets
  //    （不调用全局 refreshWidgets，避免影响其他面板）
  // 3. 渲染 widgets
  // 4. 移除骨架屏
}
```

**与现有持久化的冲突避免**：
- `panel_memory_states` 表独立于 `widgets.state` 字段
- 休眠保存的是"当前未持久化的临时状态"（如 webview 滚动位置、未保存的 widget state）
- widget state 的常规持久化（`debouncedWidgetStateSave`）不受影响，休眠前会先触发一次 flush

#### 2.3.3 骨架屏组件
**文件**：`client/desktop/src/components/SkeletonScreen.tsx`（新建）

```tsx
// 休眠恢复时的占位 UI
// 在 Workspace.tsx 中，当面板状态为 hibernated/deep-hibernated 时显示
function SkeletonScreen({ panelName, widgetCount }: { panelName: string; widgetCount: number }) {
  return (
    <div className="skeleton-screen">
      <div className="skeleton-header">{panelName}</div>
      <div className="skeleton-widgets">
        {Array.from({ length: Math.min(widgetCount, 6) }).map((_, i) => (
          <div key={i} className="skeleton-widget" />
        ))}
      </div>
    </div>
  )
}
```

#### 2.3.4 集成到 useAppStore.setActivePanel
**文件**：`client/desktop/src/stores/useAppStore.ts`（修改）

> **修正**：原 Spec 说在 Workspace.tsx 集成，但面板切换逻辑在 useAppStore.setActivePanel 中。

在 `setActivePanel` 方法（约 useAppStore.ts:949）中：
```typescript
setActivePanel: async (panelId) => {
  const oldPanelId = get().activePanelId
  if (oldPanelId && oldPanelId !== panelId) {
    panelMemoryManager.markBackground(oldPanelId)
  }
  if (panelId) {
    panelMemoryManager.markActive(panelId)
    // 如果面板处于 hibernated/deep-hibernated，触发恢复
    const state = panelMemoryManager.getPanelState(panelId)
    if (state && (state.status === 'hibernated' || state.status === 'deep-hibernated')) {
      await panelMemoryManager.restorePanel(panelId)
    }
  }
  // ... 原有逻辑
}
```

#### 2.3.5 集成到 Workspace.tsx（渲染层）
**文件**：`client/desktop/src/components/Workspace.tsx`（修改）

- 订阅 `panelMemoryManager.onStateChange`
- 当面板状态为 hibernated/deep-hibernated 时，不渲染 `panelWidgets[panelId]`，改为渲染 `<SkeletonScreen>`
- 当状态恢复为 active 时，重新渲染 widgets

```tsx
// 在 panel-layer 渲染逻辑中
const panelState = panelMemoryManager.getPanelState(panel.id)
const isHibernated = panelState && (panelState.status === 'hibernated' || panelState.status === 'deep-hibernated')

{isHibernated ? (
  <SkeletonScreen panelName={panel.name} widgetCount={panelState?.widgetCount ?? 0} />
) : (
  /* 原有 widget 渲染逻辑 */
)}
```

#### 2.3.6 WebView 状态保存（用 executeJavaScript，不用 IPC）
**文件**：`client/desktop/src/components/widgets/WebviewWidget.tsx`（修改）

> **修正**：原 Spec 说新增 IPC `webview:getScrollY`/`webview:setScrollY`，但 Electron webview 标签无此方法。改用 `executeJavaScript`。

**保存滚动位置**（组件卸载前）：
```typescript
useEffect(() => {
  return () => {
    // cleanup 时保存滚动位置到 PanelMemoryManager
    if (webviewRef.current && panelId) {
      webviewRef.current.executeJavaScript('window.scrollY')
        .then(scrollY => {
          panelMemoryManager.saveWebviewState(panelId, widgetId, { url: currentUrl, scrollY })
        })
        .catch(() => {})
    }
  }
}, [])
```

**恢复滚动位置**（组件挂载后）：
```typescript
useEffect(() => {
  const webview = webviewRef.current
  if (!webview) return
  const savedState = panelMemoryManager.getWebviewState(panelId, widgetId)
  if (savedState?.scrollY) {
    const handler = () => {
      webview.executeJavaScript(`window.scrollTo(0, ${savedState.scrollY})`)
      webview.removeEventListener('did-finish-load', handler)
    }
    webview.addEventListener('did-finish-load', handler)
  }
}, [])
```

#### 2.3.7 内存监控 IPC
**文件**：`client/desktop/electron/main/index.ts`（修改）+ `client/desktop/electron/preload/index.ts`（修改）

**主进程**（main/index.ts）：
```typescript
import { ipcMain } from 'electron'

ipcMain.handle('app:getMemoryUsage', () => {
  return process.memoryUsage()
})
```

**Preload**（preload/index.ts）：
```typescript
import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('memoryApi', {
  getMemoryUsage: () => ipcRenderer.invoke('app:getMemoryUsage')
})
```

**类型声明**（`client/desktop/src/types/electron.d.ts` 修改）：
```typescript
interface MemoryApi {
  getMemoryUsage(): Promise<{ rss: number; heapUsed: number; heapTotal: number; external: number }>
}
interface Window {
  memoryApi?: MemoryApi
  // ... 现有声明
}
```

#### 2.3.8 设置项
**文件**：`client/desktop/src/components/SettingsPanel.tsx`（修改）+ `client/desktop/src/types/index.ts`（修改）

在 `BehaviorSettings` 新增：
```typescript
interface BehaviorSettings {
  // ... 现有字段
  searchEngine: 'google' | 'bing' | 'baidu' | 'duckduckgo'  // 6.3 新增
  memoryHibernateEnabled: boolean       // 6.1 新增，默认 true
  memoryHibernateAfterMin: number       // 6.1 新增，默认 5
  memoryHibernateThresholdGB: number    // 6.1 新增，默认 1.5
}
```

SettingsPanel 行为 tab 新增"内存管理"section：
- 启用内存休眠（开关）
- 后台休眠时间（分钟，数字输入）
- 内存阈值（GB，数字输入）

### 2.4 数据迁移（关键）

**文件**：`client/desktop/src/stores/useAppStore.ts`（修改）

> **修正**：原 Spec 遗漏数据迁移。现有 `?? DEFAULT_BEHAVIOR` 在 behavior 对象存在但缺新字段时不会补全。

**所有读取 behavior 的位置**（useAppStore.ts:558、2039 等）改为字段合并：
```typescript
// 修改前
behavior: (settingsData.behavior as AppSettings['behavior']) ?? DEFAULT_BEHAVIOR,

// 修改后
behavior: { ...DEFAULT_BEHAVIOR, ...(settingsData.behavior as AppSettings['behavior'] || {}) },
```

同样修改 appearance（虽然本 Phase 不改 appearance，但保持一致性）：
```typescript
appearance: { ...DEFAULT_APPEARANCE, ...(settingsData.appearance as AppSettings['appearance'] || {}) },
```

### 2.5 验收标准
- [ ] 后台面板 webview stop()（已有实现，不重复）
- [ ] 休眠状态卸载组件树，数据存 panel_memory_states 表
- [ ] 深度休眠只保留元数据（清空 panelWidgets/panelPositions）
- [ ] 恢复时显示骨架屏，无白屏
- [ ] WebView 恢复 URL + 滚动位置（用 executeJavaScript）
- [ ] LRU 策略正确
- [ ] 内存监控准确（通过 IPC 获取主进程 memoryUsage）
- [ ] 设置项可配置（启用/时间/阈值）

---

## 三、6.2 依赖本地环境组件跨端（方案 A：服务器中转）

### 3.1 设计目标
移动端组件能通过服务器代理调用桌面端本地服务，桌面端在线时近实时，离线时降级提示。

### 3.2 架构流程

```
移动端组件 fetch(服务器代理 URL)
    ↓
服务器收到 /proxy/:deviceId/:serviceName/* 请求
    ↓
服务器查 local_service_registry 表，确认服务 online=true
    ↓
服务器通过 WS 向桌面端发送 { kind: 'proxy_request', ... }
    ↓
桌面端收到 WS 消息，执行本地 fetch(localhost:xxx/api)
    ↓
桌面端通过 WS 返回 { kind: 'proxy_response', ... }
    ↓
服务器将响应返回给移动端
```

### 3.3 实现任务

#### 3.3.1 服务器：local_service_registry 表
**文件**：`server/src/db/schema.ts`（修改）

```sql
CREATE TABLE IF NOT EXISTS local_service_registry (
  id BIGSERIAL PRIMARY KEY,
  device_id VARCHAR(64) NOT NULL,
  service_name VARCHAR(128) NOT NULL,
  endpoint TEXT NOT NULL,           -- 如 http://localhost:3001
  description TEXT,
  online BOOLEAN NOT NULL DEFAULT FALSE,
  last_heartbeat BIGINT,            -- 最后心跳时间戳
  registered_at BIGINT NOT NULL DEFAULT (EXTRACT(EPOCH FROM now()) * 1000)::BIGINT,
  updated_at BIGINT NOT NULL DEFAULT (EXTRACT(EPOCH FROM now()) * 1000)::BIGINT,
  UNIQUE (device_id, service_name)
);
CREATE INDEX IF NOT EXISTS idx_local_service_device ON local_service_registry(device_id);
CREATE INDEX IF NOT EXISTS idx_local_service_online ON local_service_registry(online);
```

#### 3.3.2 服务器：本地服务注册 API
**文件**：`server/src/routes/localServices.ts`（新建）

| 端点 | 方法 | 功能 |
|------|------|------|
| `/api/local-services/register` | POST | 桌面端注册本地服务（upsert） |
| `/api/local-services/heartbeat` | POST | 桌面端心跳（更新 last_heartbeat + online=true） |
| `/api/local-services/unregister` | POST | 桌面端注销服务 |
| `/api/local-services/list` | GET | 列出所有在线服务（移动端查询用） |
| `/api/local-services/list/:deviceId` | GET | 列出指定设备的在线服务 |

**心跳超时机制**（服务器定时任务）：
- 服务器启动时新增 `setInterval`（60 秒）扫描 `local_service_registry`
- 将 `last_heartbeat` 超过 60 秒的记录 `online = false`
- 代理 API 查询时只看 `online = true`

#### 3.3.3 服务器：代理 API
**文件**：`server/src/routes/proxy.ts`（新建）

**端点**：`/proxy/:deviceId/:serviceName/*`

> **Express 4 通配符**：用 `*path` 捕获剩余路径，`req.params.path` 获取。

**流程**：
1. 解析 `deviceId`、`serviceName`、`req.params.path`（剩余路径）
2. 查 `local_service_registry` 确认 `online = true`
3. 通过 WS 向该 deviceId 发送 `proxy_request`：
   ```typescript
   {
     kind: 'proxy_request',         // 注意：用 kind，不用 type
     requestId: crypto.randomUUID(),
     serviceName: string,
     method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH',
     path: string,                  // 剩余路径
     headers: Record<string, string>,
     body: string | null            // 请求体（JSON.stringify）
   }
   ```
4. 等待桌面端通过 WS 返回 `proxy_response`（超时 30 秒）：
   ```typescript
   {
     kind: 'proxy_response',        // 注意：用 kind
     requestId: string,
     status: number,
     headers: Record<string, string>,
     body: string                   // 响应体（JSON.stringify 或 Base64）
   }
   ```
5. 将响应返回给请求方

**二进制响应处理**：
- 如果 `Content-Type` 是 `application/json` 或 `text/*`，body 直接用字符串
- 如果是二进制（图片/PDF 等），body 用 Base64 编码，headers 中加 `X-Proxy-Base64: true`
- 代理 API 返回时解码 Base64

**Headers 过滤**：
- 转发请求时过滤掉 `host`、`connection`、`content-length`
- 桌面端 fetch 时设置 `Content-Type`（从原始 headers 读取）

**离线降级**：
- 服务 `online = false` → 返回 503 `{ error: 'local_service_offline', message: '依赖的桌面端离线' }`
- 请求超时 → 返回 504 `{ error: 'proxy_timeout', message: '桌面端响应超时' }`

**认证**：
- 代理路由需要 `authMiddleware`（与其他 API 一致）

#### 3.3.4 服务器：WS 消息处理 + 类型扩展
**文件**：`server/src/ws.ts`（修改）

> **修正**：原 Spec 用 `type:` 字段，但现有 WS 协议统一用 `kind:`。且需扩展类型联合。

**类型扩展**：
```typescript
// 前端 → 后端（新增 proxy_response）
export type ClientMessage =
  | { kind: 'user_message'; panelId: string; content: string }
  | { kind: 'tool_result'; requestId: string; success: boolean; data?: unknown; error?: string }
  | { kind: 'error_report'; widgetId: string; message: string; stack?: string; source: string }
  | { kind: 'ping' }
  | { kind: 'proxy_response'; requestId: string; status: number; headers: Record<string, string>; body: string }  // 新增

// 后端 → 前端（新增 proxy_request）
export type ServerMessage =
  | { kind: 'tool_call'; requestId: string; tool: string; params: unknown; targetDeviceId?: string; panelId?: string }
  | { kind: 'pi_event'; event: string; data: unknown; panelId?: string }
  | { kind: 'session_ready'; sessionId: string; panelId?: string }
  | { kind: 'error'; message: string; panelId?: string }
  | { kind: 'pong' }
  | { kind: 'change'; changeType: string; data: unknown; sourceDeviceId?: string }
  | { kind: 'proxy_request'; requestId: string; serviceName: string; method: string; path: string; headers: Record<string, string>; body: string | null }  // 新增
```

**pendingProxyRequests 管理**（防泄漏）：
```typescript
interface PendingProxyRequest {
  resolve: (response: { status: number; headers: Record<string, string>; body: string }) => void
  reject: (error: Error) => void
  timeout: ReturnType<typeof setTimeout>
  targetDeviceId: string
}

const pendingProxyRequests = new Map<string, PendingProxyRequest>()

// 1. 超时后立即 delete
function handleProxyTimeout(requestId: string): void {
  const pending = pendingProxyRequests.get(requestId)
  if (pending) {
    pending.reject(new Error('proxy_timeout'))
    clearTimeout(pending.timeout)
    pendingProxyRequests.delete(requestId)
  }
}

// 2. WS disconnect 时清理该设备的所有 pending 请求
function handleDeviceDisconnect(deviceId: string): void {
  for (const [requestId, pending] of pendingProxyRequests) {
    if (pending.targetDeviceId === deviceId) {
      pending.reject(new Error('device_disconnected'))
      clearTimeout(pending.timeout)
      pendingProxyRequests.delete(requestId)
    }
  }
}

// 3. requestId 用 crypto.randomUUID() 保证唯一
```

**WS 消息路由**：
- 收到 `proxy_response` 时，查找 `pendingProxyRequests`，resolve 并 delete
- 设备 WS 断开时，调用 `handleDeviceDisconnect(deviceId)`

#### 3.3.5 服务器：路由注册
**文件**：`server/src/index.ts`（修改）

> **修正**：原 Spec 遗漏路由注册。

```typescript
import { localServicesRouter } from './routes/localServices.js'
import { proxyRouter } from './routes/proxy.js'

// 在现有路由注册后（约 index.ts:94 之后）
app.use('/api/local-services', localServicesRouter)
app.use('/proxy', authMiddleware, proxyRouter)  // 代理路由也需要认证
```

#### 3.3.6 桌面端：本地服务注册客户端
**文件**：`client/desktop/src/utils/localServiceRegistry.ts`（新建）

```typescript
interface LocalServiceConfig {
  serviceName: string
  endpoint: string          // 如 http://localhost:3001
  description?: string
}

class LocalServiceRegistryClient {
  private services: LocalServiceConfig[] = []
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null

  // 从配置文件加载要注册的本地服务
  // 配置文件路径：app.getPath('userData')/local-services.json（通过 IPC 获取路径）
  // 配置文件不存在时跳过注册（不创建文件）
  async loadConfig(): Promise<void>

  // 注册所有服务到服务器
  async registerAll(): Promise<void>

  // 启动心跳（30 秒一次）
  startHeartbeat(): void

  // 停止心跳
  stopHeartbeat(): void

  // 注销所有服务（应用退出时调用）
  // 在 electron/main/index.ts 的 before-quit 事件中通过 IPC 通知渲染进程调用
  async unregisterAll(): Promise<void>

  // 处理服务器发来的 proxy_request
  async handleProxyRequest(msg: {
    requestId: string
    serviceName: string
    method: string
    path: string
    headers: Record<string, string>
    body: string | null
  }): Promise<{
    requestId: string
    status: number
    headers: Record<string, string>
    body: string
  }>
}

export const localServiceRegistry = new LocalServiceRegistryClient()
```

**配置加载时机**：
- 在 useAIStore 的 WS onopen 回调中调用 `localServiceRegistry.loadConfig()` + `registerAll()` + `startHeartbeat()`
- 在 WS onclose 中调用 `stopHeartbeat()`

**应用退出时注销**：
- 主进程 `before-quit` 事件 → 通过 IPC 通知渲染进程 → 渲染进程调用 `unregisterAll()`
- 如果 HTTP 请求未完成，服务器的心跳超时机制会自动标记为 offline

#### 3.3.7 桌面端：WS 监听 proxy_request
**文件**：`client/desktop/src/stores/useAIStore.ts`（修改）

> **修正**：原 Spec 说在 useAIStore WS 监听中新增 case，但需注意 panelId 过滤逻辑。proxy_request 是设备级消息，不带 panelId。

**类型扩展**（镜像服务器类型）：
```typescript
type ClientMessage =
  | { kind: 'user_message'; panelId: string; content: string }
  | { kind: 'tool_result'; requestId: string; success: boolean; data?: unknown; error?: string }
  | { kind: 'error_report'; widgetId: string; message: string; stack?: string; source: string }
  | { kind: 'ping' }
  | { kind: 'proxy_response'; requestId: string; status: number; headers: Record<string, string>; body: string }  // 新增

type ServerMessage =
  | { kind: 'tool_call'; requestId: string; tool: string; params: unknown; targetDeviceId?: string; panelId?: string }
  | { kind: 'pi_event'; event: string; data: unknown; panelId?: string }
  | { kind: 'session_ready'; sessionId: string; panelId?: string }
  | { kind: 'error'; message: string; panelId?: string }
  | { kind: 'pong' }
  | { kind: 'change'; changeType: string; data: unknown; sourceDeviceId?: string }
  | { kind: 'proxy_request'; requestId: string; serviceName: string; method: string; path: string; headers: Record<string, string>; body: string | null }  // 新增
```

**handleServerMessage 修改**（在 panelId 过滤之前处理 proxy_request）：
```typescript
function handleServerMessage(msg: ServerMessage): void {
  // proxy_request 是设备级消息，不带 panelId，在 panelId 过滤之前处理
  if (msg.kind === 'proxy_request') {
    void handleProxyRequest(msg)
    return
  }

  // Phase 4：按 panelId 过滤（只处理当前活跃面板的事件）
  if ('panelId' in msg && msg.panelId !== undefined) {
    const activePanelId = getUseAppStore().getState().activePanelId
    if (!activePanelId || msg.panelId !== activePanelId) {
      return
    }
  }

  switch (msg.kind) {
    // ... 现有 case
  }
}

async function handleProxyRequest(msg: { requestId: string; serviceName: string; method: string; path: string; headers: Record<string, string>; body: string | null }): Promise<void> {
  const response = await localServiceRegistry.handleProxyRequest(msg)
  sendWs({ kind: 'proxy_response', ...response })
}
```

#### 3.3.8 移动端协议文档
**文件**：`docs/protocols/local-service-proxy.md`（新建）

> **修正**：原 Spec 遗漏移动端协议文档。

文档内容：
1. **服务发现**：移动端调用 `GET /api/local-services/list` 获取所有在线服务
2. **deviceId 获取**：移动端登录后查询用户绑定的设备列表（或从服务发现结果中获取）
3. **URL 改写规则**：
   ```
   原始：http://localhost:3001/api/notes
   改写：http://server:3456/proxy/{deviceId}/local-notes/api/notes
   ```
4. **请求/响应格式**：与 3.3.3 节一致
5. **离线处理**：服务返回 503 时显示"依赖的桌面端离线"提示

#### 3.3.9 HtmlCanvasWidget 修改（本 Phase 不做）
> **修正**：原 Spec 说修改 HtmlCanvasWidget 检测 localhost fetch 失败，但 iframe 内 fetch 错误受 CORS 限制无法冒泡。且桌面端自身不会触发此问题。

Phase 6 桌面端不做 HtmlCanvasWidget 修改，移动端实现时再改（在 iframeProxy.ts initScript 中注入 fetch 拦截器）。

### 3.4 验收标准
- [ ] local_service_registry 表创建
- [ ] 桌面端本地服务可注册到服务器
- [ ] 代理 API `/proxy/:deviceId/:serviceName/*` 可用
- [ ] WS 转发执行成功（用 kind 字段）
- [ ] 离线降级提示（503）
- [ ] 心跳机制正常（60 秒超时标记 offline）
- [ ] pendingProxyRequests 无泄漏（超时/断开时清理）
- [ ] 移动端协议文档完整

---

## 四、6.3 搜索引擎设置（用户要求）

### 4.1 问题
当前默认搜索引擎硬编码为 Google（3 处），用户要求默认 Bing，且需要设置界面可切换。

### 4.2 实现任务

#### 4.2.1 类型扩展
**文件**：`client/desktop/src/types/index.ts`（修改）

```typescript
export type SearchEngine = 'google' | 'bing' | 'baidu' | 'duckduckgo'

export interface BehaviorSettings {
  // ... 现有字段
  searchEngine: SearchEngine  // 新增
  memoryHibernateEnabled: boolean       // 6.1 新增
  memoryHibernateAfterMin: number       // 6.1 新增
  memoryHibernateThresholdGB: number    // 6.1 新增
}

export const DEFAULT_BEHAVIOR: BehaviorSettings = {
  // ... 现有字段
  searchEngine: 'bing',  // 默认 Bing（用户要求）
  memoryHibernateEnabled: true,
  memoryHibernateAfterMin: 5,
  memoryHibernateThresholdGB: 1.5,
}
```

#### 4.2.2 搜索 URL 构建函数
**文件**：`client/desktop/src/utils/browserToolBridge.ts`（修改）

```typescript
import type { SearchEngine } from '../types'

const SEARCH_ENGINES: Record<SearchEngine, (q: string) => string> = {
  google: q => `https://www.google.com/search?q=${encodeURIComponent(q)}`,
  bing: q => `https://www.bing.com/search?q=${encodeURIComponent(q)}`,
  baidu: q => `https://www.baidu.com/s?wd=${encodeURIComponent(q)}`,
  duckduckgo: q => `https://duckduckgo.com/?q=${encodeURIComponent(q)}`,
}

export function buildSearchUrl(query: string, engine: SearchEngine = 'bing'): string {
  return (SEARCH_ENGINES[engine] || SEARCH_ENGINES.bing)(query)
}
```

#### 4.2.3 调用点改造
**3 处硬编码全部改为读取 store 的 searchEngine**：

1. `client/desktop/src/components/Omnibox.tsx:42`
   - 从 `useAppStore` 读取 `settings.behavior.searchEngine`
   - 调用 `buildSearchUrl(trimmed, engine)`

2. `client/desktop/src/components/BrowserHome.tsx:57`
   - 同上

3. `client/desktop/src/utils/browserToolBridge.ts:31`（normalizeUrl 兜底分支）
   > **修正**：原 Spec 说 normalizeUrl 改为调用 buildSearchUrl(t, 'bing')，但这会导致 AI 工具调用 browser_navigate 时搜索引擎与用户选择不一致。
   
   **新方案**：normalizeUrl 不做搜索（只做 URL 规范化），搜索逻辑由调用方（Omnibox/BrowserHome）决定。normalizeUrl 的兜底分支保持原样（返回 Google），但实际上 Omnibox/BrowserHome 会在调用 normalizeUrl 之前先判断是否是搜索词并构建搜索 URL，所以 normalizeUrl 的兜底分支不会被触发。
   
   **或者**：normalizeUrl 接受可选的 engine 参数，由调用方传入。AI 工具调用时从 store 读取 engine 传入。

#### 4.2.4 设置 UI
**文件**：`client/desktop/src/components/SettingsPanel.tsx`（修改）

在「行为」tab 新增"搜索引擎"section（在现有设置项之前）：
```tsx
<div className="settings-row">
  <div className="settings-label-group">
    <span className="settings-label">默认搜索引擎</span>
    <span className="settings-desc">Omnibox 和浏览器主页搜索时使用</span>
  </div>
  <select
    className="select-field"
    value={settings.behavior.searchEngine}
    onChange={e => updateBehavior({ searchEngine: e.target.value as SearchEngine })}
  >
    <option value="bing">Bing</option>
    <option value="google">Google</option>
    <option value="baidu">百度</option>
    <option value="duckduckgo">DuckDuckGo</option>
  </select>
</div>
```

### 4.3 数据迁移
见 2.4 节（所有读取 behavior 的位置改为字段合并）。

### 4.4 验收标准
- [ ] 默认搜索引擎为 Bing
- [ ] 设置界面可切换 Bing/Google/Baidu/DuckDuckGo
- [ ] Omnibox 搜索使用所选引擎
- [ ] 浏览器主页搜索使用所选引擎
- [ ] 设置持久化（重启后保持，字段合并确保老用户升级无 undefined）

---

## 五、技术约束

| 约束 | 说明 |
|------|------|
| TypeScript 优先 | 桌面端和服务器都用 TypeScript |
| 不下载到 C 盘 | 所有依赖和缓存配置到非 C 盘 |
| git 版本管理 | 所有变更走 git commit |
| 不改 Phase 0-5 spec | 已完成的 phase 不动 |
| 与移动端数据互通 | 共享服务器数据库 |
| 幂等迁移 | 数据库 schema 变更用 IF NOT EXISTS / DO $$ |
| WS 协议一致 | 所有 WS 消息用 `kind` 字段，不用 `type` |

---

## 六、实现顺序

> **修正**：原 Spec 建议 3 个并行 sub-agent，但 6.3 的 DEFAULT_BEHAVIOR 修改会影响 6.1 的 memoryHibernate* 字段（都在 BehaviorSettings 中），并行实现会冲突。

**顺序实现**：
1. **6.3 搜索引擎设置**（先做，修改 types/index.ts + SettingsPanel + Omnibox + BrowserHome + browserToolBridge + 数据迁移）
2. **6.1 内存休眠策略**（在 6.3 完成后，types/index.ts 已有 memoryHibernate* 字段）
3. **6.2 本地服务跨端中转**（独立于 6.1/6.3，可并行）

**建议 sub-agent 分配**：
- Agent A：6.3 搜索引擎设置（含数据迁移逻辑）
- Agent B：6.2 本地服务跨端中转（服务器 + 桌面端，独立于 6.1/6.3）
- Agent C：6.1 内存休眠策略（在 Agent A 完成后启动，因为依赖 types/index.ts 修改）

或并行 A + B，A 完成后启动 C。

---

## 七、验收清单

### Phase 6.1 内存休眠
- [ ] PanelMemoryManager 实现完整
- [ ] 后台面板 webview stop()（已有，不重复）
- [ ] 休眠状态卸载组件树，数据存 panel_memory_states 表
- [ ] 深度休眠只保留元数据（清空 panelWidgets/panelPositions）
- [ ] 恢复时显示骨架屏，无白屏
- [ ] WebView 恢复 URL + 滚动位置（用 executeJavaScript）
- [ ] LRU 策略正确
- [ ] 内存监控准确（通过 IPC 获取主进程 memoryUsage）
- [ ] 设置项可配置（启用/时间/阈值）
- [ ] 数据迁移（字段合并确保老用户升级无 undefined）

### Phase 6.2 本地服务跨端
- [ ] local_service_registry 表创建
- [ ] 桌面端本地服务可注册到服务器
- [ ] 代理 API `/proxy/:deviceId/:serviceName/*` 可用
- [ ] WS 转发执行成功（用 kind 字段）
- [ ] 离线降级提示（503）
- [ ] 心跳机制正常（60 秒超时标记 offline）
- [ ] pendingProxyRequests 无泄漏（超时/断开时清理）
- [ ] 移动端协议文档完整
- [ ] 路由注册（index.ts）

### Phase 6.3 搜索引擎设置
- [ ] 默认搜索引擎为 Bing
- [ ] 设置界面可切换 4 种引擎
- [ ] Omnibox 和 BrowserHome 使用所选引擎
- [ ] 设置持久化（字段合并确保老用户升级无 undefined）

### 运行时验证
- [ ] 应用可正常启动
- [ ] TypeScript 编译无错误
- [ ] 搜索引擎切换后立即生效
- [ ] 内存休眠不导致数据丢失
- [ ] 代理 API 端到端测试通过（curl 测试）
- [ ] LRU 策略实际触发验证
- [ ] 搜索引擎持久化验证（重启后保持）
