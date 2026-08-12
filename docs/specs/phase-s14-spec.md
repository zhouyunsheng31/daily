# Phase S14 Spec：Web 端动态组件 + 搜索工具 UI

> 生成日期：2026-07-05
> Roadmap 依据：[roadmap_server_v2.md](../roadmap_server_v2.md) 第三章 Phase S14（L337-375）
> v1 基线：[roadmap_server_v1.md](../roadmap_server_v1.md)（S0-S6/S9/S10 已完成）
> S11 前置：[phase-s11-spec.md](./phase-s11-spec.md)（Web 端基础设施 + 单用户认证）
> S12 前置：[phase-s12-spec.md](./phase-s12-spec.md)（Web 端画布核心，commit `a83ea09`）
> S13 前置：[phase-s13-spec.md](./phase-s13-spec.md)（Web 端 AI 集成，commit `bf950d9`）
> 架构依据：[architecture_refactor.md](../architecture_refactor.md)
> 状态：待编码实现

---

## 一、项目目的

让 Web 端用户能：

1. **S14.1 动态组件跨端**：渲染桌面端创建的 `pure-frontend` 动态 widget；过滤 `desktop_only=TRUE` 组件不显示；`local-dependent` 组件显示"依赖桌面端本地服务"提示。
2. **S14.2 搜索工具 UI**：在设置页配置 Metaso / GitHub 搜索 Key；让 AI 调用 `web_search`（Metaso）/ `academic_search`（ArXiv 无需 Key）/ `github_search`（7 mode）后，搜索结果在 `SearchResultsPanel` 中可见；`download_repo_zip` 和 `download_file ≥1MB` 返回的代理 URL 在 Web 端可点击下载。

**S14 不做**：

- 生产部署 + HTTPS（S15）
- 服务端搜索 API 改造（服务端 `searchApi.ts` / `searchTools.ts` / `routes/searchKeys.ts` / `routes/githubProxy.ts` 全部就绪，S14 仅改 `client/web/`）
- 新增搜索 provider（roadmap 明确白名单 `metaso` + `github`，ArXiv 无需 Key）
- 浏览器工具真实执行（S13 已降级处理）

**S14 与 roadmap 的差异**：

| 项 | Roadmap 表述 | 实际服务端实现 | S14 处理 |
|---|---|---|---|
| `github_search` mode 数量 | "6 mode" | **7 mode**（search_repos/search_code/search_users/search_issues/download_release/download_file/download_repo_zip） | 按服务端实现 7 mode 全部支持（不破坏已有能力，roadmap 表述为近似值） |

---

## 二、前置依赖与现状摸底

### 2.1 前置依赖

| 依赖 | 状态 | 说明 |
|------|------|------|
| v1 S0-S6/S9/S10 | ✅ | 后端 API + WS + Pi Agent + 24 工具完整 |
| S11 Web 端基础设施 + 认证 | ✅ | JWT cookie + SPA fallback + CORS |
| S12 Web 端画布核心 | ✅ | commit `a83ea09`，8 widget + 数据层 + WS 同步 |
| S13 Web 端 AI 集成 | ✅ | commit `bf950d9`，typecheck 通过；useAIStore/wsToolHandlers/AI 配置 UI 完整 |
| S14.1 依赖 S12 画布 | ✅ | HtmlCanvasWidget 已就绪 |
| S14.2 依赖 S13 useAIStore | ✅ | handleToolCall 已在客户端执行工具后调 addSearchResult（L770-808），仅需扩展识别 `papers`/`items`/`download` 字段 |

### 2.2 S14.1 现状（动态组件）

| 文件 | 现状 | S14 处理 |
|------|------|---------|
| `client/web/src/utils/evaluateWidget.ts` | **stub**（L15-28 直接 return true，不求值 code） | **替换**：完整实现（移植桌面端） |
| `client/web/src/main.tsx` | 仅 `createRoot().render()`，**无 bootstrap** | **改造**：新增 `bootstrap()` 异步初始化动态 widget |
| `client/web/src/App.tsx` | L17-18 仅 `registerBuiltInWidgets()` | **改造**：移除顶层调用，改由 `bootstrap()` 统一初始化 |
| `client/web/src/api/dynamicWidgets.ts` | L19-21 `getAllDynamicWidgets()` 未传 `?desktop=false` | **改造**：增加 `desktop=false` 查询参数 |
| `client/web/src/utils/db.ts` | L577 `getAllDynamicWidgets()` 签名 `()` 不接受参数，无法透传 `options` | **改造**（M8 修复）：接受 `options?: { desktop?: boolean }` 并透传给 `dynamicWidgetsApi.getAllDynamicWidgets(options)` |
| `client/web/src/components/CanvasHome.tsx` | L175 `getBuiltInWidgetConfigs()` 仅内置；L579-631 添加组件对话框无 env 徽章 | **改造**：合并内置+动态 widget，新增 env 徽章 |
| `client/web/src/registry/index.ts` | 已有 `getDynamicWidgetConfigs()` 过滤函数 | 直接使用 |
| `client/web/src/registry/builtIn.tsx` | 9 个内置配置 + 9 capabilities，`webPage: desktopOnly=true` | 直接使用 |
| `client/web/src/registry/capabilityRegistry.ts` | 已实现 `fetch('/api/component-capabilities', POST)` 同步 | 直接使用 |
| `client/web/src/types/componentCapability.ts` | zod schema 完整 | 直接使用 |
| `client/web/src/components/widgets/HtmlCanvasWidget.tsx` | 与桌面端逐字相同 | 直接使用 |
| `client/web/src/components/WidgetContainer.tsx` | 已删除 webview 分支 | 直接使用 |
| `client/web/src/stores/useAppStore.ts` | S13 已含 `dynamicWidgets`/`refreshDynamicWidgets`/`addDynamicWidget` | **改造**：`refreshDynamicWidgets` 支持 `{ desktop: false }` 参数（M4 修复，避免 WS 刷新时加载 `desktop_only=TRUE` 组件），其余直接使用 |

### 2.3 S14.2 现状（搜索工具）

| 文件 | 现状 | S14 处理 |
|------|------|---------|
| `client/web/src/api/searchKeys.ts` | ✅ 完整（5 端点） | 直接使用 |
| `client/web/src/components/settings/SearchKeysConfig.tsx` | **不存在** | **新建**：移植桌面端 `SearchEngineConfig.tsx` |
| `client/web/src/pages/Settings.tsx` | 仅 4 tab（api/prompt/skills/tools） | **改造**：新增 `search` tab |
| `client/web/src/stores/useAIStore.ts` `handlePiEvent` | `tool_execution_end` 仅恢复状态（SDK 发射该事件，`piBridge.forwardEventToClient` 转发到客户端 WS） | **不改造**：搜索结果不走 `tool_execution_end` 路径（详见 S14.2-T4 说明） |
| `client/web/src/stores/useAIStore.ts` `handleToolCall` L770-808 | 客户端执行工具后调 `addSearchResult`，但仅识别 `results` 字段 | **改造**：兼容 `papers` / `items` / `download` 字段，传递 `mode`/`items`/`download` 到 `addSearchResult` |
| `client/web/src/types/ai.ts` | 仅 `WebSearchHit`/`AcademicPaper`/`GithubRepoHit` | **新增**：`GithubCodeHit`/`GithubUserHit`/`GithubIssueHit`/`GithubDownloadResult` |
| `client/web/src/components/ai/SearchResultsCard.tsx` | `github` kind 仅渲染 `GithubRepoHit` | **改造**：按 mode 分流渲染，download mode 渲染下载链接 |
| `client/web/src/components/ai/SearchResultsPanel.tsx` | ✅ 完整 | 直接使用 |

### 2.4 服务端已就绪能力（S14 不改）

| 文件 | 能力 |
|------|------|
| `server/src/utils/searchApi.ts` | Metaso / ArXiv / GitHub 三家 API 调用 + `buildGithubProxyUrl` |
| `server/src/utils/searchTools.ts` | 3 个 ToolDefinition：`webSearchTool`/`academicSearchTool`/`githubSearchTool`（7 mode） |
| `server/src/routes/searchKeys.ts` | 5 端点 CRUD + `testSearchKey` |
| `server/src/routes/githubProxy.ts` | `GET /api/github/proxy?type={zip\|asset\|file}` + Range 透传 + 5 分钟超时 |
| `server/src/piBridge.ts` | L34 import searchTools，L1060 加入 customTools |
| `server/src/routes/dynamicWidgets.ts` | `?desktop=false` 过滤已支持（L14-18） |
| `server/src/routes/componentCapabilities.ts` | 5 端点 CRUD 全部实现 |

### 2.5 关键约束

| 约束 | 说明 |
|------|------|
| 不破坏桌面/移动端兼容 | 仅在 `client/web/` 内操作 |
| 不修改 server | 服务端搜索 API + 动态组件 API 全部就绪 |
| TypeScript 严格 | Web 端 tsconfig 继承桌面端，编译零 error |
| 复用优先 | 物理复制桌面端 `evaluateWidget.ts` + `SearchEngineConfig.tsx` + 小改造 |
| 运行时验证强制 | 不能只读代码，必须 Playwright 实际验证 |
| 不下载到 C 盘 | 依赖安装到 `client/web/node_modules/`（F: 盘） |
| git 版本管理 | 完成后 git commit（S13 已提交 `bf950d9`，S14 单独提交） |

---

## 三、S14.1 动态组件跨端

### 3.1 任务清单（文件级）

#### S14.1-T1：替换 evaluateWidget.ts（覆盖 S12 stub）

**源文件**：`client/desktop/src/utils/evaluateWidget.ts`（52 行）
**目标文件**：`client/web/src/utils/evaluateWidget.ts`（覆盖 S12 stub）

**改造点**：复制桌面端实现，**仅新增 M3 过滤**（`componentEnv === 'local-dependent'` 跳过注册，但仍保留在 store 中用于 env 徽章显示）。桌面端 `evaluateWidget.ts` 无 `window.*Api` 依赖，仅依赖 `React` / `lucide-react` / `registry`，全部在 web 端可用。

```typescript
// 桌面端完整实现（直接复制）：
import type { ComponentType } from 'react'
import type { WidgetProps, DynamicWidgetDef, WidgetConfig } from '../types'
import * as React from 'react'
import * as lucideIcons from 'lucide-react'
import { registerWidget } from '../registry'

export function evaluateDynamicComponent(code: string): ComponentType<WidgetProps> | null {
  try {
    const wrappedCode = `
      const { useState, useEffect, useCallback, useRef, useMemo } = React;
      const exports = {};
      ${code}
      return exports.default;
    `
    const factory = new Function('React', '__lucide', wrappedCode)
    const Component = factory(React, lucideIcons)
    if (typeof Component !== 'function') {
      console.error('Dynamic widget code did not export a function')
      return null
    }
    return Component
  } catch (err) {
    console.error('Failed to evaluate dynamic widget:', err)
    return null
  }
}

export function registerDynamicWidget(def: DynamicWidgetDef): boolean {
  const Component = evaluateDynamicComponent(def.code)
  if (!Component) return false
  const config: WidgetConfig = {
    widgetType: def.widgetType,
    displayName: def.displayName,
    icon: def.icon,
    defaultLayout: def.defaultLayout,
    defaultState: def.defaultState,
    component: Component,
    serialize: (state) => state,
    deserialize: (data) => data,
    isDynamic: true,
  }
  registerWidget(config)
  return true
}

export function loadAndRegisterDynamicWidgets(defs: DynamicWidgetDef[]): void {
  for (const def of defs) {
    // M3 修复：local-dependent 组件不在 Web 端注册为可渲染 widget
    // （它们依赖桌面端本地服务，Web 端无法执行）
    // 但仍保留在 useAppStore.dynamicWidgets 中，用于 CanvasHome 显示 env 徽章
    if (def.componentEnv === 'local-dependent') {
      continue  // 跳过注册，但不从 store 中移除
    }
    registerDynamicWidget(def)
  }
}
```

**验证**：
- TS 编译零 error（web 端 `types/index.ts` 已含 `WidgetProps`/`DynamicWidgetDef`/`WidgetConfig`）
- 注册后 `getWidgetConfig(widgetType)` 能取到 Component
- `getDynamicWidgetConfigs()` 能返回动态 widget 配置
- `local-dependent` 组件不被 `registerDynamicWidget` 注册（`getWidgetConfig` 返回 undefined），但仍存在于 `useAppStore.dynamicWidgets`（M3 修复）

#### S14.1-T2：改造 api/dynamicWidgets.ts 增加 `?desktop=false` 过滤 + 改造 useAppStore.ts refreshDynamicWidgets 支持 desktop 选项

**目标文件**：
- `client/web/src/api/dynamicWidgets.ts`
- `client/web/src/stores/useAppStore.ts`（M4 修复）

**改造点 1**：api/dynamicWidgets.ts 增加 desktop 参数

```typescript
// S14.1-T2 改造：getAllDynamicWidgets 增加 desktop 参数
export async function getAllDynamicWidgets(options?: { desktop?: boolean }): Promise<DynamicWidgetDTO[]> {
  const query = options?.desktop === false ? '?desktop=false' : ''
  return api.get(`/dynamic-widgets${query}`)
}
```

**改造点 2**（M4 修复）：useAppStore.ts `refreshDynamicWidgets` 支持 `options?: { desktop?: boolean }` 参数

**M6 修复**：同步更新 L264 接口类型声明为 `refreshDynamicWidgets: (options?: { desktop?: boolean }) => Promise<void>`（仅改实现不改接口 → TS2554 编译错误）

**M7 修复**：改造代码块补回 dynamic import + try-catch（当前实现 useAppStore.ts L2517-2524 含 `const { loadAndRegisterDynamicWidgets } = await import('../utils/evaluateWidget')` 和 try-catch，spec 原改造代码块遗漏）

```typescript
// S14.1-T2 改造（M4 修复）：refreshDynamicWidgets 透传 desktop 选项
// 现状（S13）：refreshDynamicWidgets() 调用 getAllDynamicWidgets() 未传参，会加载全部组件（含 desktop_only=TRUE）
// 改造后：支持 options 参数，web 端调用时传 { desktop: false }
// M6 修复：L264 接口类型声明同步更新为 (options?: { desktop?: boolean }) => Promise<void>
// M7 修复：补回 dynamic import + try-catch（与当前实现 useAppStore.ts L2517-2524 一致）

// L264 接口类型声明（同步更新）：
refreshDynamicWidgets: (options?: { desktop?: boolean }) => Promise<void>

// L2517-2524 实现（含 dynamic import + try-catch）：
refreshDynamicWidgets: async (options?: { desktop?: boolean }) => {
  try {
    const defs = await getAllDynamicWidgets(options)
    const { loadAndRegisterDynamicWidgets } = await import('../utils/evaluateWidget')
    loadAndRegisterDynamicWidgets(defs)
    set({ dynamicWidgets: defs })  // C6 修复：同步更新 store，触发 CanvasHome 响应式重渲染
  } catch (err) {
    console.error('[useAppStore] refreshDynamicWidgets failed:', err)
  }
},
```

**配套改造**（M4 修复）：WS `change` 事件触发的 `refreshDynamicWidgets` 调用需传 `{ desktop: false }`

```typescript
// useAppStore.ts WS 事件处理（约 L2551/L2560/L2577）：
// 旧：await get().refreshDynamicWidgets()
// 新：await get().refreshDynamicWidgets({ desktop: false })
```

**改造点 3**（M8 修复）：修改 `client/web/src/utils/db.ts` L577 `getAllDynamicWidgets` 接受 `options?: { desktop?: boolean }` 并透传给 `dynamicWidgetsApi.getAllDynamicWidgets(options)`

**M8 修复背景**：`useAppStore.ts` L24 从 `../utils/db` 导入 `getAllDynamicWidgets`，但 `db.ts` L577 签名为 `()` 不接受参数。若仅改 `api/dynamicWidgets.ts` 而不改 `db.ts`，`refreshDynamicWidgets(options)` 调用 `getAllDynamicWidgets(options)` 会触发 TS2554（参数数量不匹配）。

```typescript
// db.ts L577 改造前：
// export async function getAllDynamicWidgets(): Promise<DynamicWidgetDef[]> {
//   return dynamicWidgetsApi.getAllDynamicWidgets()
// }

// db.ts L577 改造后（M8 修复）：
export async function getAllDynamicWidgets(options?: { desktop?: boolean }): Promise<DynamicWidgetDef[]> {
  return dynamicWidgetsApi.getAllDynamicWidgets(options)
}
```

**说明**：
- `?desktop=false` 让服务端过滤 `desktop_only = TRUE` 的组件
- 默认不传参（兼容旧调用方与桌面端），Web 端 bootstrap 与 WS 触发的 `refreshDynamicWidgets` 均传 `{ desktop: false }`
- **M4 修复**：原 S13 `refreshDynamicWidgets` 未传 desktop 选项，WS `change` 事件触发的刷新（L2551/L2560/L2577）会加载 `desktop_only=TRUE` 组件。改造后 WS 事件触发的刷新也传 `{ desktop: false }`
- **M8 修复**：`useAppStore.ts` 从 `../utils/db` 导入 `getAllDynamicWidgets`，`db.ts` L577 签名需同步改造为接受 `options?` 参数，否则 TS2554 编译错误。`db.ts` 是 `useAppStore` 的导入入口，必须与 `api/dynamicWidgets.ts` 签名对齐；透传 `options` 给 `dynamicWidgetsApi.getAllDynamicWidgets(options)`，由 api 层负责拼装 `?desktop=false` 查询参数
- **C6 修复**：`refreshDynamicWidgets` 内部 `set({ dynamicWidgets: defs })` 是唯一填充 store 的入口，bootstrap 调用它即可同步更新 store（详见 S14.1-T3）

**验证**：
- 桌面端创建 `desktop_only=true` 的组件 → Web 端 `getAllDynamicWidgets({ desktop: false })` 不返回该组件
- 桌面端创建 `desktop_only=false` 的组件 → Web 端返回该组件
- WS `change` 事件触发 `refreshDynamicWidgets({ desktop: false })` → 不加载 `desktop_only=TRUE` 组件（M4 修复）
- bootstrap 调用 `refreshDynamicWidgets({ desktop: false })` 后 `useAppStore.getState().dynamicWidgets` 非空（C6 修复）

#### S14.1-T3：改造 main.tsx 新增 bootstrap()

**目标文件**：`client/web/src/main.tsx`

**改造点**（m8 修正）：参考桌面端 `main.tsx` L14-31 的结构，但 web 端采用同步注册在前 + 异步加载在后的拆分时序（避免白屏），与 desktop 全部前置不同。在 web 端新增异步初始化。

```typescript
// S14.1-T3 改造版 main.tsx：
import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import WebContextMenu from './components/WebContextMenu'
// C1 修复：registerBuiltInCapabilities 在 builtIn.tsx 中导出（L325），不在 capabilityRegistry.ts
import { registerBuiltInWidgets, registerBuiltInCapabilities } from './registry/builtIn'
import { syncCapabilitiesToServer } from './registry/capabilityRegistry'
import { registerAllDataSources } from './registry/dataSources'
import { useAppStore } from './stores/useAppStore'  // C6 修复：通过 refreshDynamicWidgets 一次性完成 fetch + register + setState
import './index.css'

// C4 修复：同步部分在 render 前执行（避免白屏），异步部分在 render 后执行
// 1. 同步注册（必须在 App 渲染前完成，否则 getBuiltInWidgetConfigs() 返回空）
registerBuiltInWidgets()
registerBuiltInCapabilities()
registerAllDataSources()

// 2. 先渲染 UI（避免白屏——getAllDynamicWidgets 是网络请求，期间不应阻塞页面）
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <WebContextMenu>
        <App />
      </WebContextMenu>
    </BrowserRouter>
  </React.StrictMode>,
)

// 3. 异步初始化（render 之后执行，动态 widget 加载完成后通过 store 触发 UI 更新）
void (async () => {
  try {
    // C6+M4 修复：通过 refreshDynamicWidgets 一次性完成 fetch + register + setState
    // refreshDynamicWidgets 内部调用：
    //   getAllDynamicWidgets({ desktop: false })  → HTTP GET /api/dynamic-widgets?desktop=false
    //   loadAndRegisterDynamicWidgets(defs)       → 注册组件到 registry（M3：local-dependent 跳过注册）
    //   set({ dynamicWidgets: defs })             → 更新 store，触发 CanvasHome 响应式重渲染（C7 修复）
    await useAppStore.getState().refreshDynamicWidgets({ desktop: false })
  } catch (err) {
    console.error('[bootstrap] load dynamic widgets failed:', err)
  }
  // 4. 同步 capabilities 到 server（最后执行，避免阻塞 UI）
  void syncCapabilitiesToServer()
})()
```

**说明**：
- **C4 修复**：`createRoot().render()` 不等待 `getAllDynamicWidgets()` 网络请求，避免白屏。同步注册（内置 widget/capabilities/数据源）在 render 前执行，异步加载（动态 widget + capabilities 同步）在 render 后执行
- **C6 修复**：bootstrap 不再手动调用 `getAllDynamicWidgets` + `loadAndRegisterDynamicWidgets`，而是统一调用 `refreshDynamicWidgets({ desktop: false })`。该函数内部 `set({ dynamicWidgets: defs })` 会更新 store，CanvasHome 通过响应式订阅（C7 修复）自动重渲染
- 注册顺序：内置 widget → 内置 capabilities → 数据源 → **render UI** → 动态 widget（fetch + register + setState）→ 同步 capabilities
- 动态 widget 加载失败不阻塞 UI（try-catch）
- 动态 widget 注册完成 + store 更新后，CanvasHome 通过响应式订阅自动重渲染，添加组件对话框显示新组件

**关键依赖验证**：
- `registerBuiltInCapabilities` 在 `client/web/src/registry/builtIn.tsx` L325 已导出（**C1 修复**：原 spec 错误声称在 capabilityRegistry.ts，实际在 builtIn.tsx）
- `syncCapabilitiesToServer` 在 `client/web/src/registry/capabilityRegistry.ts` 已存在（直接 import）
- `registerAllDataSources` 在 `client/web/src/registry/dataSources.ts` 已存在（直接 import）
- `refreshDynamicWidgets` 由 S13 实现，S14.1-T2 改造为支持 `{ desktop: false }` 参数（M4 修复）

#### S14.1-T4：改造 App.tsx 移除顶层 registerBuiltInWidgets 调用

**目标文件**：`client/web/src/App.tsx`

**改造点**：S14.1-T3 把 `registerBuiltInWidgets()` 迁移到 `bootstrap()` 后，App.tsx L17-18 的顶层调用删除。

```typescript
// S14.1-T4 改造版 App.tsx（删除 L15-18）：
// S12 验证前置：注册内置 widget configs
// 否则 getBuiltInWidgetConfigs() 返回空数组，widget 不渲染
// import { registerBuiltInWidgets } from './registry/builtIn'  ← 删除（迁移到 main.tsx bootstrap）
// registerBuiltInWidgets()  ← 删除
```

**验证**：
- App.tsx 不再 import `registerBuiltInWidgets`
- main.tsx `bootstrap()` 调用 `registerBuiltInWidgets()`
- Web 端启动后内置 widget 仍能渲染（验证：创建 Calculator widget 成功）

#### S14.1-T5：改造 CanvasHome.tsx 添加组件对话框显示动态 widget + env 徽章

**目标文件**：`client/web/src/components/CanvasHome.tsx`

**改造点 1**（m6 修正：实际涉及 L18 lucide import（+Monitor）+ L22 registry import（+getDynamicWidgetConfigs）+ L175 allWidgetConfigs + 新增 dynamicWidgetEnvs + renderEnvLabel 函数多处改造，非仅 L175）：L18 import + L175 `allWidgetConfigs` 合并内置 + 动态 widget + local-dependent 占位按钮（C7+C8 修复：响应式订阅 store 变化）

**m7 补充**：CanvasHome L22 import 语句新增 `getDynamicWidgetConfigs`（`getBuiltInWidgetConfigs` 和 `useAppStore` 已存在，仅需新增 `getDynamicWidgetConfigs`）

```typescript
// S14.1-T5 改造版（m6 修正：涉及 L18 import + L175 allWidgetConfigs + 新增 dynamicWidgetEnvs + renderEnvLabel 函数）：
// 旧：const allWidgetConfigs = useMemo(() => getBuiltInWidgetConfigs(), [])
// 新：合并内置 + 动态 widget + local-dependent 占位按钮，并响应式订阅 store 变化（C7+C8 修复）

// L22 import 语句新增 getDynamicWidgetConfigs（m7：getBuiltInWidgetConfigs / useAppStore 已存在）
import { getBuiltInWidgetConfigs, getDynamicWidgetConfigs } from '../registry'
import type { WidgetConfig } from '../types'
import { useAppStore } from '../stores/useAppStore'

// C9 修复：定义独立的 PlaceholderWidgetConfig 类型，避免污染 WidgetConfig 接口
// WidgetConfig.component 是 ComponentType<WidgetProps>（不可空），占位按钮用单独类型表示
// C10 修复：PlaceholderWidgetConfig 不含 serialize/deserialize 字段（避免签名不匹配 TS2322）
type PlaceholderWidgetConfig = {
  widgetType: string
  displayName: string
  icon: string
  defaultLayout: Record<string, unknown>
  defaultState: Record<string, unknown>
  isDynamic: true
  isPlaceholder: true  // 标记占位
}

// C7 修复：响应式订阅 dynamicWidgets，store 变化时自动重渲染
// 桌面端 bootstrap 在 render 前执行，useMemo([]) 也能工作；
// Web 端 C4 修复将动态 widget 加载移到 render 之后，必须响应式订阅才能在加载完成后更新 UI
const dynamicWidgets = useAppStore(s => s.dynamicWidgets)

// 动态 widget 列表（用于 env 徽章查询）——直接使用响应式值，无需 useMemo
const dynamicWidgetEnvs = dynamicWidgets

// C8+C9 修复：allWidgetConfigs 合并 local-dependent 占位按钮
// S14.1-T1 的 M3 修复让 loadAndRegisterDynamicWidgets 跳过 local-dependent 组件注册（不进 registry）
// 所以 getDynamicWidgetConfigs() 仅返回 pure-frontend 动态 widget
// 但 S14.1-T5 验证点要求"local-dependent 动态 widget → Web 端添加组件对话框显示该 widget + 橙色徽章"
// 因此需从 useAppStore.dynamicWidgets 取 local-dependent 组件，构造占位 PlaceholderWidgetConfig（isPlaceholder: true）
// C9 修复方案 A：返回类型为 Array<WidgetConfig | PlaceholderWidgetConfig>，不修改 WidgetConfig 接口
const allWidgetConfigs = useMemo<Array<WidgetConfig | PlaceholderWidgetConfig>>(() => {
  const builtIn = getBuiltInWidgetConfigs()
  const registered = getDynamicWidgetConfigs()  // 仅含 pure-frontend（M3 过滤后）
  // local-dependent 组件构造占位 PlaceholderWidgetConfig（不可渲染，仅用于显示徽章）
  const localDependentPlaceholders: PlaceholderWidgetConfig[] = dynamicWidgets
    .filter(d => d.componentEnv === 'local-dependent')
    .map(d => ({
      widgetType: d.widgetType,
      displayName: d.displayName,
      icon: d.icon,
      defaultLayout: d.defaultLayout,
      defaultState: d.defaultState,
      isDynamic: true,
      isPlaceholder: true,  // C9 修复：标记占位，避免 component: null 污染 WidgetConfig 类型
    }))
  return [...builtIn, ...registered, ...localDependentPlaceholders]
}, [dynamicWidgets])  // 依赖 store 变化，dynamicWidgets 更新时重新计算
```

**改造点 2**：渲染按钮时新增 env 徽章 + 处理 local-dependent 占位按钮点击（C8 修复）

参考桌面端 `client/desktop/src/components/AddWidgetMenu.tsx` L80-125 的 `renderEnvLabel`：

```tsx
// 在 widget 按钮渲染处（约 L598-628）新增 env 徽章：
function renderEnvLabel(widgetType: string): React.ReactNode {
  // 内置 widget 不显示徽章（已通过 WebviewWidgetFallback 处理降级）
  const dynDef = dynamicWidgetEnvs.find(d => d.widgetType === widgetType)
  if (!dynDef) return null

  const isLocalDependent = dynDef.componentEnv === 'local-dependent' || dynDef.desktopOnly === true
  if (isLocalDependent) {
    return (
      <span style={{
        display: 'inline-flex', alignItems: 'center', gap: 2,
        padding: '2px 6px', borderRadius: 4, fontSize: 10,
        background: 'rgba(255, 159, 67, 0.12)', color: '#ff9f43',
        border: '1px solid rgba(255, 159, 67, 0.3)',
      }}>
        <Monitor size={10} /> 仅桌面端
      </span>
    )
  }
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 2,
      padding: '2px 6px', borderRadius: 4, fontSize: 10,
      background: 'rgba(80, 227, 194, 0.12)', color: 'var(--color-secondary)',
      border: '1px solid rgba(80, 227, 194, 0.3)',
    }}>
      <Globe size={10} /> 纯前端
    </span>
  )
}

// C8+C9+M9 修复：处理 local-dependent 占位按钮点击
// allWidgetConfigs 中 local-dependent 占位按钮是 PlaceholderWidgetConfig（isPlaceholder: true）
// 点击时不真正添加 widget，而是提示用户"该组件依赖桌面端本地服务，Web 端不可用"
// M9 修复：正常添加分支调用 handleAddWidget(widgetType) 保留 toast loading/success/error 反馈
function handleWidgetButtonClick(config: WidgetConfig | PlaceholderWidgetConfig): void {
  // C9 修复：通过 'isPlaceholder' in config 判断是否占位（避免 component === null 比较 TS2367）
  if ('isPlaceholder' in config && config.isPlaceholder) {
    // local-dependent 占位按钮：不真正添加，仅提示
    alert('该组件依赖桌面端本地服务，Web 端不可用')
    return
  }
  // M9 修复：正常添加 widget，调用 handleAddWidget 保留 toast 反馈（不直接调用 useAppStore.getState().addWidget）
  // handleAddWidget 是 CanvasHome L138 已有的包裹函数，内部含 toast loading/success/error
  handleAddWidget(config.widgetType)
}
```

**关键约束**：
- `desktop_only=TRUE` 的组件理论上已被 `?desktop=false` 过滤，但出于稳健性考虑，仍渲染徽章（若 server 端未过滤或客户端缓存了旧数据，徽章提示用户）
- 内置 widget（9 个）不显示 env 徽章（`WebviewWidget` 已用 `WebviewWidgetFallback` 处理降级）
- **m4 修复**：CanvasHome L18 import 语句新增 `Monitor`（`Globe` 已存在）。改造后 import 形如 `import { Globe, Monitor } from 'lucide-react'`
- **C8+C9 修复**：local-dependent 占位按钮（PlaceholderWidgetConfig，`isPlaceholder: true`）点击时不真正添加 widget，仅提示用户"该组件依赖桌面端本地服务，Web 端不可用"。widget 按钮的 onClick 需改为 `() => handleWidgetButtonClick(config)`（替代直接 `addWidget`，**C9 修复**：传 `config` 而非 `widgetType`，函数签名改为 `(config: WidgetConfig | PlaceholderWidgetConfig) => void`）。JSX 渲染 `allWidgetConfigs.map(config => ...)` 时需注意 `WidgetConfig` 与 `PlaceholderWidgetConfig` 两种类型均能传入 `handleWidgetButtonClick`
- **M9 修复**：`handleWidgetButtonClick` 的"正常添加"分支调用 `handleAddWidget(config.widgetType)`（CanvasHome L138 已有的包裹函数，内部含 toast loading/success/error 反馈），而非 `useAppStore.getState().addWidget(widgetType)`，避免丢失 toast 反馈
- **C10 修复**：`PlaceholderWidgetConfig` 不含 `serialize`/`deserialize` 字段（避免与 `WidgetConfig` L25-26 的 `(state: Record<string, unknown>) => Record<string, unknown>` 签名不匹配，触发 TS2322）。占位按钮不可渲染，无需序列化/反序列化

**验证**：
- 桌面端创建 `pure-frontend` 动态 widget → Web 端添加组件对话框显示该 widget + 绿色"纯前端"徽章
- 桌面端创建 `local-dependent` 动态 widget → Web 端添加组件对话框显示该 widget + 橙色"仅桌面端"徽章（即使 `?desktop=false` 未过滤也能提示用户）
- 桌面端创建 `desktop_only=true` 动态 widget → Web 端添加组件对话框不显示（已被服务端过滤）

### 3.2 S14.1 验收标准

- [ ] `client/web/src/utils/evaluateWidget.ts` 完整实现（覆盖 S12 stub），导出 `evaluateDynamicComponent`/`registerDynamicWidget`/`loadAndRegisterDynamicWidgets`
- [ ] `client/web/src/main.tsx` 同步注册（registerBuiltInWidgets → registerBuiltInCapabilities → registerAllDataSources）在 `createRoot().render()` 前执行；异步加载（`refreshDynamicWidgets({ desktop: false })` → syncCapabilitiesToServer）在 render 后执行（**C4 修复**：避免白屏；**C6 修复**：通过 refreshDynamicWidgets 更新 store）
- [ ] `client/web/src/App.tsx` 删除顶层 `registerBuiltInWidgets()` 调用
- [ ] `client/web/src/api/dynamicWidgets.ts` `getAllDynamicWidgets` 支持 `{ desktop: false }` 选项
- [ ] `client/web/src/utils/db.ts` L577 `getAllDynamicWidgets` 签名同步改造为接受 `options?: { desktop?: boolean }`，透传给 `dynamicWidgetsApi.getAllDynamicWidgets(options)`（**M8 修复**）
- [ ] `client/web/src/stores/useAppStore.ts` `refreshDynamicWidgets` 支持 `{ desktop: false }` 选项，WS 事件触发的刷新也传此参数（**M4 修复**）
- [ ] `client/web/src/components/CanvasHome.tsx` 添加组件对话框显示内置 + 动态 widget，带 env 徽章；`allWidgetConfigs` 响应式订阅 `useAppStore(s => s.dynamicWidgets)`（**C7 修复**）；定义独立的 `PlaceholderWidgetConfig` 类型表示 local-dependent 占位按钮，`allWidgetConfigs` 返回 `Array<WidgetConfig | PlaceholderWidgetConfig>`（**C9+C10 修复**：不污染 WidgetConfig 接口，不含 serialize/deserialize 字段）；`handleWidgetButtonClick` 通过 `'isPlaceholder' in config` 判断占位，正常添加分支调用 `handleAddWidget(config.widgetType)` 保留 toast 反馈（**M9 修复**）
- [ ] 桌面端创建的 `pure-frontend` dynamic_widget，Web 端能渲染（Playwright 验证）
- [ ] `desktop_only=TRUE` 的组件，Web 端不显示（Playwright 验证）
- [ ] `local-dependent` 组件，Web 端显示"依赖桌面端"提示（Playwright 验证）
- [ ] TS 编译零 error

---

## 四、S14.2 搜索工具 UI

### 4.1 任务清单（文件级）

#### S14.2-T1：新建 SearchKeysConfig.tsx（移植桌面端 SearchEngineConfig.tsx）

**源文件**：`client/desktop/src/components/settings/SearchEngineConfig.tsx`（332 行）
**目标文件**：`client/web/src/components/settings/SearchKeysConfig.tsx`

**改造点**：直接物理复制桌面端，**仅改文件名和 export 名**，其余零改造。桌面端 `SearchEngineConfig.tsx` 仅依赖 `lucide-react` + `../../api/client` + `../../api/searchKeys`，全部在 web 端可用。

**关键说明**：
- 文件名改为 `SearchKeysConfig.tsx`（与 roadmap 表述一致）
- 默认导出名改为 `SearchKeysConfig`（语义对齐）
- `PROVIDERS` 数组保持 2 项（`metaso` + `github`）
- 不显示明文 Key（password 输入框 + 眼睛切换）
- 测试结果 ok（绿）/ fail（红）双色展示

**验证**：
- Settings 页 `search` tab 渲染 2 个 provider 行
- 输入 Metaso Key + 点更新 → 状态徽章变"已配置"
- 点测试 → 返回 ok / fail
- 点删除 → 状态徽章变"未配置"

#### S14.2-T2：改造 Settings.tsx 新增 search tab

**目标文件**：`client/web/src/pages/Settings.tsx`

**改造点**：

```typescript
// S14.2-T2 改造版 Settings.tsx：
import { useState } from 'react'
import AIApiConfig from '../components/settings/AIApiConfig'
import AIPromptConfig from '../components/settings/AIPromptConfig'
import AISkillsManager from '../components/settings/AISkillsManager'
import ToolsManager from '../components/settings/ToolsManager'
import SearchKeysConfig from '../components/settings/SearchKeysConfig'  // S14.2-T1 新增

type Tab = 'api' | 'prompt' | 'skills' | 'tools' | 'search'  // 新增 search

export default function Settings() {
  const [tab, setTab] = useState<Tab>('api')

  return (
    <div className="settings-page">
      <nav className="settings-nav">
        <button onClick={() => setTab('api')} className={tab === 'api' ? 'active' : ''}>AI API 配置</button>
        <button onClick={() => setTab('prompt')} className={tab === 'prompt' ? 'active' : ''}>提示词配置</button>
        <button onClick={() => setTab('skills')} className={tab === 'skills' ? 'active' : ''}>Skills 管理</button>
        <button onClick={() => setTab('tools')} className={tab === 'tools' ? 'active' : ''}>工具管理</button>
        <button onClick={() => setTab('search')} className={tab === 'search' ? 'active' : ''}>搜索 Key</button>
      </nav>
      <div className="settings-content">
        {tab === 'api' && <AIApiConfig />}
        {tab === 'prompt' && <AIPromptConfig />}
        {tab === 'skills' && <AISkillsManager />}
        {tab === 'tools' && <ToolsManager />}
        {tab === 'search' && <SearchKeysConfig />}
      </div>
    </div>
  )
}
```

**验证**：
- Settings 页有 5 个 tab，含"搜索 Key"
- 点击"搜索 Key" → 显示 2 个 provider 配置行

#### S14.2-T3：扩展 types/ai.ts 新增 GitHub 搜索结果类型

**目标文件**：`client/web/src/types/ai.ts`

**改造点**：在现有 `GithubRepoHit` 后新增 4 个类型（与 `server/src/utils/searchApi.ts` 返回结构对齐）。

```typescript
// S14.2-T3 新增类型（追加到 types/ai.ts 末尾）：

// GitHub 代码搜索结果
export interface GithubCodeHit {
  path: string
  repo: string  // owner/repo
  url: string
  score?: number
  textMatches?: string[]
}

// GitHub 用户搜索结果
export interface GithubUserHit {
  login: string
  avatarUrl: string
  htmlUrl: string
  type: string  // User / Organization
  score?: number
}

// GitHub issue 搜索结果
export interface GithubIssueHit {
  number: number
  title: string
  state: 'open' | 'closed'
  url: string
  repo: string  // owner/repo
  createdAt: string
  updatedAt: string
  score?: number
}

// GitHub 下载结果（download_repo_zip / download_release / download_file ≥1MB）
export interface GithubDownloadResult {
  mode: 'download_repo_zip' | 'download_release' | 'download_file'
  fileName: string
  size: number  // bytes
  downloadUrl: string  // 代理 URL（点击即下载）
  owner?: string
  repo?: string
  ref?: string
  path?: string
  sha?: string
  assetId?: number
}
```

> **m5 修复**：原 spec 此处定义了 `GithubSearchResult` 联合类型，但 T4/T5/T6 均未引用此类型（dead code）。已删除。`SearchResultsCard.tsx` 通过 `SearchSourceEntry.mode` + `SearchSourceEntry.items`/`download` 字段分流渲染，无需独立联合类型。

**验证**：
- TS 编译零 error
- `SearchResultsCard.tsx` 能 import 新类型（`GithubCodeHit`/`GithubUserHit`/`GithubIssueHit`/`GithubDownloadResult`）

#### S14.2-T4：改造 useAIStore.ts handleToolCall 识别 papers/items/download 字段

> **注**：原 S14.2-T4（"在 tool_execution_end 中解析搜索结果"）已删除（详见 CRITICAL C3）。原因：`handleToolCall`（L770-808）已在客户端执行工具后调 `addSearchResult`，若 `tool_execution_end` 中再次调用会导致搜索结果重复添加。桌面端 Phase 12 已废弃 `tool_execution_end` 路径。本任务改为扩展 `handleToolCall` 的字段识别能力。

**目标文件**：`client/web/src/stores/useAIStore.ts`（L770-808 `handleToolCall` 函数）

**现状**：当前 `handleToolCall` 仅识别 `results` 字段（L789-798），无法解析 `academic_search` 返回的 `papers` 字段、`github_search` 返回的 `items`/`mode`/`download` 字段。

**改造点**：扩展 `handleToolCall` L780-808 的结果解析逻辑，新增 `papers` / `items` / `download` / `mode` 字段识别，并将这些字段传递给 `addSearchResult`。

```typescript
// S14.2-T4 改造版 handleToolCall（L770-808）：
// 当前仅识别 results 字段，改造后兼容 papers / items / download / mode 字段

async function handleToolCall(requestId: string, tool: string, params: unknown): Promise<void> {
  const result = await executeToolCall(tool, params)
  sendWs({
    kind: 'tool_result',
    requestId,
    success: result.success,
    data: result.data,
    error: result.error,
  })

  // Phase 12 + S14.2-T4：搜索工具结果缓存到 searchResults
  if (result.success && isSearchTool(tool)) {
    const kind = SEARCH_TOOL_KIND_MAP[tool]
    const queryStr = typeof params === 'object' && params !== null && 'query' in params
      ? String((params as { query: unknown }).query || '')
      : ''

    // 通用字段
    let hits: ReadonlyArray<LocalSearchHit | WebSearchHit | AcademicPaper | GithubRepoHit | GithubCodeHit | GithubUserHit | GithubIssueHit> = []
    let total = 0
    let tookMs: number | undefined
    // S14.2-T4 新增字段（github_search 专用）
    let mode: string | undefined
    let items: unknown[] | undefined
    let download: GithubDownloadResult | undefined

    const d = (result.data && typeof result.data === 'object') ? result.data as Record<string, unknown> : null

    if (isLocalSearchResult(result.data)) {
      // local_search: { results, total, tookMs }
      hits = result.data.results
      total = result.data.total
      tookMs = result.data.tookMs
    } else if (d) {
      // S14.2-T4 新增：github_search download mode（优先判断，因 download mode 不含 items）
      if (typeof d.mode === 'string' && d.mode.startsWith('download_') && d.download) {
        mode = d.mode
        download = d.download as GithubDownloadResult
        total = 1
      }
      // github_search search mode: { mode, items, total }
      else if (typeof d.mode === 'string' && Array.isArray(d.items)) {
        mode = d.mode
        items = d.items
        hits = d.items as SearchSourceEntry['hits']
        total = typeof d.total === 'number' ? d.total : d.items.length
        tookMs = typeof d.tookMs === 'number' ? d.tookMs : undefined
      }
      // academic_search: { papers, total }
      else if (Array.isArray(d.papers)) {
        hits = d.papers as AcademicPaper[]
        total = typeof d.total === 'number' ? d.total : d.papers.length
        tookMs = typeof d.tookMs === 'number' ? d.tookMs : undefined
      }
      // web_search / 通用: { results, total }
      else if (Array.isArray(d.results)) {
        hits = d.results as SearchSourceEntry['hits']
        total = typeof d.total === 'number' ? d.total : d.results.length
        tookMs = typeof d.tookMs === 'number' ? d.tookMs : undefined
      }
    }

    get().addSearchResult({
      requestId,
      toolName: tool,
      kind,
      query: queryStr,
      hits,
      total,
      tookMs,
      // S14.2-T4 新增：传递 github_search 专用字段（需 S14.2-T5 扩展 SearchSourceEntry）
      ...(mode !== undefined && { mode }),
      ...(items !== undefined && { items }),
      ...(download !== undefined && { download }),
    })
  }
}
```

**关键说明**：
- **C3 修复**：搜索结果仅通过 `handleToolCall` 路径添加一次，不在 `tool_execution_end` 中重复添加
- `addSearchResult` 的参数类型是 `Omit<SearchSourceEntry, 'id' | 'timestamp'>`，新增的 `mode`/`items`/`download` 字段需在 S14.2-T5 中扩展到 `SearchSourceEntry`
- `GithubCodeHit`/`GithubUserHit`/`GithubIssueHit`/`GithubDownloadResult` 类型由 S14.2-T3 新增
- `tool_execution_end` 事件仅恢复会话状态（保留 S13 逻辑，不改造）

**验证**：
- AI 调用 `web_search` → `handleToolCall` 识别 `results` 字段 → `addSearchResult` 添加 web 结果
- AI 调用 `academic_search` → `handleToolCall` 识别 `papers` 字段 → `addSearchResult` 添加 academic 结果
- AI 调用 `github_search` mode=search_repos → `handleToolCall` 识别 `items`+`mode` 字段 → `addSearchResult` 添加 github 结果
- AI 调用 `github_search` mode=download_repo_zip → `handleToolCall` 识别 `download`+`mode` 字段 → `addSearchResult` 添加下载结果
- 搜索结果不重复添加（`tool_execution_end` 不调 `addSearchResult`）

#### S14.2-T5：扩展 SearchSourceEntry 类型支持 github 多 mode

**目标文件**：`client/web/src/types/ai.ts`（L346-357 `SearchSourceEntry` 接口）

**改造点**：扩展现有 `SearchSourceEntry` 类型（S13 已存在 `SearchSourceEntry`，本 spec 扩展它），新增 `mode` / `items` / `download` 字段，并扩展 `hits` 联合类型以包含新 GitHub hit 类型。

```typescript
// S14.2-T5 改造版 SearchSourceEntry（L346-357）：
// 原始定义（S13）：
// export interface SearchSourceEntry {
//   id: string
//   requestId: string
//   toolName: string
//   kind: SearchSourceKind
//   query: string
//   hits: ReadonlyArray<LocalSearchHit | WebSearchHit | AcademicPaper | GithubRepoHit>
//   total: number
//   tookMs?: number
//   timestamp: number
// }

// 改造后：
export interface SearchSourceEntry {
  id: string
  requestId: string
  toolName: string
  kind: SearchSourceKind
  query: string
  // C2 修复：扩展 hits 联合类型，包含 S14.2-T3 新增的 GitHub hit 类型
  hits: ReadonlyArray<LocalSearchHit | WebSearchHit | AcademicPaper | GithubRepoHit | GithubCodeHit | GithubUserHit | GithubIssueHit>
  total: number
  tookMs?: number
  timestamp: number
  // S14.2-T5 新增字段（github_search 专用，可选）：
  mode?: string  // search_repos / search_code / search_users / search_issues / download_repo_zip / download_release / download_file
  items?: unknown[]  // github_search 返回的原始 items（同 hits，但保留独立字段便于按 mode 分流）
  download?: GithubDownloadResult  // download_* mode 的下载结果
}
```

**说明**：
- **C2 修复**：原 spec 引用不存在的 `SearchHitResult` 类型，实际 S13 已存在 `SearchSourceEntry`（types/ai.ts L346-357），本 spec 扩展它
- **m3 修复**：原 spec 措辞"S13 已有"虚假，改为"S13 已存在 SearchSourceEntry，本 spec 扩展它"
- 保留 `hits` 字段兼容 S13 的 `local_search`/`web_search`/`academic_search` 渲染逻辑
- 新增 `items` / `download` 字段用于 github_search 多 mode 分流
- `SearchResultsCard.tsx` 优先用 `mode` 字段判断 github 子类型，fallback 到 `hits`

#### S14.2-T6：改造 SearchResultsCard.tsx 按 mode 分流渲染

**目标文件**：`client/web/src/components/ai/SearchResultsCard.tsx`

**改造点**：当前 `github` kind 仅渲染 `GithubRepoHit`，需扩展为按 `mode` 字段分流。

```tsx
// S14.2-T6 改造版 SearchResultsCard.tsx：
// 当前仅渲染 4 种 kind：web / academic / github(local repos) / local
// 改造后：github kind 按 mode 分流，新增 download mode 渲染下载链接
// C2+M2 修复：使用 SearchSourceEntry（非 SearchHitResult），与现有 Props 签名一致

// 当前 SearchResultsCard.tsx L12 已用 `entry: SearchSourceEntry`，本改造保持一致
function renderGithubResult(entry: SearchSourceEntry): React.ReactNode {
  const mode = entry.mode ?? 'search_repos'  // 默认 repos（兼容旧数据）

  // download mode：渲染下载链接
  if (mode.startsWith('download_') && entry.download) {
    const dl = entry.download
    return (
      <div className="github-download-card">
        <div className="download-icon">📦</div>
        <div className="download-info">
          <div className="download-name">{dl.fileName}</div>
          <div className="download-meta">
            <span>大小: {(dl.size / 1024 / 1024).toFixed(2)} MB</span>
            <span>模式: {dl.mode}</span>
            {dl.owner && dl.repo && <span>{dl.owner}/{dl.repo}</span>}
          </div>
        </div>
        <a
          href={dl.downloadUrl}
          download={dl.fileName}
          target="_blank"
          rel="noopener noreferrer"
          className="download-button"
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 4,
            padding: '6px 12px', borderRadius: 6,
            background: 'var(--color-primary)', color: 'white',
            textDecoration: 'none', fontSize: 12,
          }}
        >
          ⬇ 下载
        </a>
      </div>
    )
  }

  // search mode：按 mode 分流渲染 items（优先用 items 字段，fallback 到 hits）
  const items = entry.items ?? entry.hits ?? []
  if (items.length === 0) {
    return <div className="no-results">无 GitHub 搜索结果</div>
  }

  switch (mode) {
    case 'search_repos':
      return items.map((item, idx) => renderRepoHit(item as GithubRepoHit, idx))
    case 'search_code':
      return items.map((item, idx) => renderCodeHit(item as GithubCodeHit, idx))
    case 'search_users':
      return items.map((item, idx) => renderUserHit(item as GithubUserHit, idx))
    case 'search_issues':
      return items.map((item, idx) => renderIssueHit(item as GithubIssueHit, idx))
    default:
      return <div className="unknown-mode">未知 GitHub 搜索模式: {mode}</div>
  }
}

function renderRepoHit(hit: GithubRepoHit, idx: number): React.ReactNode {
  // 现有 GithubRepoHit 渲染逻辑（保留）
}

function renderCodeHit(hit: GithubCodeHit, idx: number): React.ReactNode {
  return (
    <div key={idx} className="github-code-hit">
      <div className="hit-repo">{hit.repo}</div>
      <div className="hit-path">{hit.path}</div>
      <a href={hit.url} target="_blank" rel="noopener noreferrer">查看代码</a>
    </div>
  )
}

function renderUserHit(hit: GithubUserHit, idx: number): React.ReactNode {
  return (
    <div key={idx} className="github-user-hit">
      <img src={hit.avatarUrl} alt={hit.login} width={32} height={32} />
      <div>
        <div>{hit.login} <span className="hit-type">({hit.type})</span></div>
        <a href={hit.htmlUrl} target="_blank" rel="noopener noreferrer">查看主页</a>
      </div>
    </div>
  )
}

function renderIssueHit(hit: GithubIssueHit, idx: number): React.ReactNode {
  return (
    <div key={idx} className="github-issue-hit">
      <div className="hit-title">
        <span className={`hit-state hit-state-${hit.state}`}>{hit.state}</span>
        #{hit.number} {hit.title}
      </div>
      <div className="hit-meta">
        <span>{hit.repo}</span>
        <a href={hit.url} target="_blank" rel="noopener noreferrer">查看 issue</a>
      </div>
    </div>
  )
}
```

**关键说明**：
- **C2 修复**：所有 `SearchHitResult` 引用改为 `SearchSourceEntry`（与现有 `SearchResultsCard.tsx` L12 `entry: SearchSourceEntry` 签名一致）
- **M2 修复**：`renderGithubResult` 接收 `entry: SearchSourceEntry`，而非不存在的 `SearchHitResult`
- download mode 的 `<a href={downloadUrl} download={fileName}>` 是浏览器原生下载，点击即下载
- `target="_blank" rel="noopener noreferrer"` 避免打开新 tab 被劫持
- search_repos 渲染逻辑保留（兼容旧数据）

**验证**：
- AI 调用 `web_search` → SearchResultsCard 显示 web 搜索结果
- AI 调用 `academic_search` → 显示 ArXiv 论文（按 submittedDate 倒序）
- AI 调用 `github_search` mode=search_repos → 显示仓库列表
- AI 调用 `github_search` mode=search_code → 显示代码片段列表
- AI 调用 `github_search` mode=search_users → 显示用户列表
- AI 调用 `github_search` mode=search_issues → 显示 issue 列表
- AI 调用 `github_search` mode=download_repo_zip → 显示下载卡片 + 下载按钮
- AI 调用 `github_search` mode=download_file ≥1MB → 显示下载卡片 + 下载按钮
- 点击下载按钮 → 浏览器开始下载 zip/file

#### S14.2-T7：运行时验证 4 个搜索场景

| 场景 | 验证方式 |
|------|---------|
| 配置 Metaso Key → AI 调用 web_search | 在 Settings 配置 Metaso Key → 让 AI "搜索 Living Dashboard" → SearchResultsCard 显示 web 结果 |
| 无 Key → AI 调用 academic_search | 让 AI "搜索 LLM 最新论文" → SearchResultsCard 显示 ArXiv 论文（按 submittedDate 倒序） |
| 配置 GitHub Key → AI 调用 github_search 7 mode | 在 Settings 配置 GitHub Key → 让 AI "搜索 react 仓库" / "搜索 useState 代码" / "搜索 facebook 用户" / "搜索 react issue #1" / "下载 facebook/react zip" / "下载 react main 分支 README.md" |
| 下载代理 URL | AI 调用 download_repo_zip → 点击下载按钮 → 浏览器下载 zip 文件 |

### 4.2 S14.2 验收标准

- [ ] `client/web/src/components/settings/SearchKeysConfig.tsx` 存在，2 个 provider 行（metaso + github）
- [ ] `client/web/src/pages/Settings.tsx` 含 `search` tab
- [ ] `client/web/src/types/ai.ts` 含 `GithubCodeHit`/`GithubUserHit`/`GithubIssueHit`/`GithubDownloadResult` 类型，`SearchSourceEntry` 扩展 `mode`/`items`/`download` 字段
- [ ] `client/web/src/stores/useAIStore.ts` `handleToolCall`（L770-808）识别 `papers`/`items`/`download`/`mode` 字段并传递给 `addSearchResult`（**C3 修复**：不走 `tool_execution_end` 路径）
- [ ] `client/web/src/components/ai/SearchResultsCard.tsx` 按 mode 分流渲染（含 download mode 下载链接），使用 `SearchSourceEntry` 类型（**C2+M2 修复**）
- [ ] 配置 Metaso Key 后，AI 调用 `web_search` 返回结果（Playwright 验证）
- [ ] 无需任何 Key，AI 调用 `academic_search` 返回 ArXiv 论文（按 submittedDate 倒序）（Playwright 验证）
- [ ] 配置 GitHub Key 后，AI 调用 `github_search` 7 mode 全部可用（Playwright 验证）
- [ ] AI 调用 `download_repo_zip`，Web 端点击代理 URL 下载 zip（Playwright 验证）
- [ ] AI 调用 `download_file ≥1MB`，Web 端点击代理 URL 下载（Playwright 验证）
- [ ] TS 编译零 error

---

## 五、整体数据流

### 5.1 动态组件加载流程

```
Web 端启动（C4 修复：同步注册在 render 前，异步加载在 render 后）
  ├── 同步部分（createRoot().render() 前执行，避免白屏）
  │   ├── registerBuiltInWidgets()  → 9 个内置 widget 注册到 registry
  │   ├── registerBuiltInCapabilities()  → 9 个 capabilities 注册（从 builtIn.tsx 导入）
  │   └── registerAllDataSources()  → 数据源注册
  ├── createRoot().render(<App />)  → UI 立即渲染（不等网络请求）
  └── 异步部分（render 后执行，不阻塞 UI）
      └── useAppStore.getState().refreshDynamicWidgets({ desktop: false })  ← C6+M4 修复：统一入口
          ├── getAllDynamicWidgets({ desktop: false })  → HTTP GET /api/dynamic-widgets?desktop=false
          │   └── server 过滤 desktop_only=TRUE，返回 pure-frontend + local-dependent 组件
          ├── loadAndRegisterDynamicWidgets(defs)
          │   ├── M3 修复：local-dependent 组件跳过注册（componentEnv === 'local-dependent' → continue）
          │   │   但仍保留在 useAppStore.dynamicWidgets 中，用于 CanvasHome 显示 env 徽章
          │   └── pure-frontend 组件 → evaluateDynamicComponent(def.code) → registerWidget(config)
          └── set({ dynamicWidgets: defs })  → C6 修复：更新 store，触发 CanvasHome 响应式重渲染

CanvasHome 添加组件对话框（C7 修复：响应式订阅 store；C9 修复：返回类型 Array<WidgetConfig | PlaceholderWidgetConfig>）
  └── const dynamicWidgets = useAppStore(s => s.dynamicWidgets)  ← 响应式订阅
      └── allWidgetConfigs = useMemo<Array<WidgetConfig | PlaceholderWidgetConfig>>(() => {
            const builtIn = getBuiltInWidgetConfigs()
            const registered = getDynamicWidgetConfigs()
            const localDependentPlaceholders = dynamicWidgets.filter(...).map(d => ({...isPlaceholder: true}))
            return [...builtIn, ...registered, ...localDependentPlaceholders]
          }, [dynamicWidgets])
          └── store 变化时重新计算 → 渲染按钮 + env 徽章
              ├── 内置 widget（WidgetConfig）→ 无徽章
              ├── pure-frontend 动态 widget（WidgetConfig）→ 绿色"纯前端"
              └── local-dependent 动态 widget（PlaceholderWidgetConfig，isPlaceholder: true）→ 橙色"仅桌面端"（在 store 中但未注册为可渲染）

用户点击 widget 按钮
  └── handleWidgetButtonClick(config: WidgetConfig | PlaceholderWidgetConfig)
      ├── PlaceholderWidgetConfig（isPlaceholder: true）→ alert 提示"依赖桌面端本地服务"，不真正添加
      └── WidgetConfig → handleAddWidget(config.widgetType)  ← M9 修复：保留 toast 反馈
          └── WidgetContainer 渲染
              └── getWidgetConfig(widgetType).component  → React 组件实例化
```

### 5.2 搜索工具结果流程

```
用户发送消息 "搜索 Living Dashboard"
  └── useAIStore.sendMessage → sendWs({kind: 'user_message'})
      └── server pi agent 收到 → 决定调用 web_search 工具
          ├── server 发送 tool_call 请求到客户端（WS tool_call 事件）
          │   └── useAIStore handleToolCall(requestId, 'web_search', params)
          │       ├── executeToolCall('web_search', params) → 服务端执行 callMetaso() → 返回 {results, total}
          │       ├── sendWs({kind: 'tool_result', ...}) → 返回结果给 server
          │       ├── isSearchTool('web_search') → true
          │       ├── 识别 d.results 字段 → hits = d.results, total = d.total
          │       └── addSearchResult({requestId, toolName, kind:'web', query, hits, total, tookMs})
          │           → SearchResultsPanel 重新渲染
          ├── SDK 发射 tool_execution_end 事件（M1 修复：SDK 发射，piBridge.forwardEventToClient 仅转发）
          │   └── useAIStore handlePiEvent → 仅恢复会话状态（**C3 修复**：不提取搜索结果，避免重复）
          └── server agent 继续 LLM loop → 发送 pi_event(text_delta, ...) → 最终回复

academic_search 流程（同上，但 handleToolCall 识别 d.papers 字段）
github_search search mode 流程（同上，但 handleToolCall 识别 d.mode + d.items 字段）
github_search download mode 流程（同上，但 handleToolCall 识别 d.mode + d.download 字段）

SearchResultsPanel 渲染（C2 修复：使用 SearchSourceEntry，非 SearchHitResult）
  └── useAIStore.searchResults.map(entry => <SearchResultsCard entry={entry} />)
      └── SearchResultsCard
          ├── kind='web' → 渲染 WebSearchHit 列表
          ├── kind='academic' → 渲染 AcademicPaper 列表
          └── kind='github'
              ├── mode='search_repos' → 渲染 GithubRepoHit 列表
              ├── mode='search_code' → 渲染 GithubCodeHit 列表
              ├── mode='search_users' → 渲染 GithubUserHit 列表
              ├── mode='search_issues' → 渲染 GithubIssueHit 列表
              └── mode='download_*' → 渲染下载卡片 + <a href={downloadUrl} download> 按钮
```

---

## 六、关键风险与缓解

### 6.1 技术风险

| 风险 | 概率 | 影响 | 缓解方案 |
|------|------|------|---------|
| 动态 widget `code` 字段在浏览器中 `new Function` 求值失败 | 中 | 中 | evaluateDynamicComponent 已 try-catch，失败返回 null，console.error 提示。不影响其他 widget |
| 动态 widget `code` 引用了 web 端不支持的 API（如 `window.electron`） | 中 | 中 | `code` 求值时只注入 `React` + `lucide`，其他 API 引用会 ReferenceError，被 try-catch 捕获 |
| Metaso API 在国内网络不稳定 | 低 | 中 | 服务端 `testSearchKey` 已实现，UI 显示测试结果。搜索失败时 LLM 收到错误，能继续对话 |
| GitHub search_code 强制要 token | 100% | 低 | SearchKeysConfig UI 引导用户配置 GitHub Key；未配置时 search_code 返回错误，AI 收到后继续对话 |
| `?desktop=false` 过滤对 local-dependent 组件无效（M3 修复） | 低 | 低 | `desktop_only` 默认 FALSE，与 `component_env` 完全独立。服务端 `?desktop=false` 只过滤 `desktop_only=TRUE`，不过滤 `local-dependent`。客户端 `loadAndRegisterDynamicWidgets` 需运行时检查 `componentEnv === 'local-dependent'` 并跳过注册（但仍保留在 store 中用于 env 徽章显示） |
| 下载代理 URL 在浏览器中跨域失败 | 低 | 中 | 代理 URL 是同源 `/api/github/proxy`，无跨域问题。浏览器原生 `<a download>` 下载 |
| 大文件下载占用浏览器内存 | 低 | 低 | 浏览器原生下载流式写入磁盘，不占用内存 |

### 6.2 产品风险

| 风险 | 概率 | 影响 | 缓解方案 |
|------|------|------|---------|
| 动态 widget 在 Web 端体验差 | 中 | 中 | 桌面端是首选体验，Web 端定位"随时访问" |
| 搜索结果在 Web 端展示不全 | 中 | 中 | 7 mode 全部支持，download mode 提供下载链接 |
| GitHub API 限流 | 中 | 低 | 配置 token 后 5000 req/hour，单用户场景足够 |

---

## 七、对抗审查检查清单（spec 自审）

### 7.1 完整性检查

- [x] S14.1 5 个任务覆盖（evaluateWidget/api/main.tsx/App.tsx/CanvasHome）
- [x] S14.2 7 个任务覆盖（SearchKeysConfig/Settings/types/useAIStore/SearchResultsCard/验证）
- [x] 服务端已就绪能力明确（不改 server）
- [x] 与 roadmap v2 第三章 S14 验收标准对齐
- [x] 与 S13 已实现代码兼容（不破坏 useAIStore/wsToolHandlers/SearchResultsCard 现有逻辑）

### 7.2 一致性检查

- [x] S14 验收标准与 roadmap v2 第三章 S14 验收标准一致（含 7 mode 替代 6 mode 的差异说明）
- [x] 不破坏桌面/移动端兼容（仅在 client/web/ 操作）
- [x] 不重写 v1 已有能力
- [x] TypeScript 优先（所有文件 .ts/.tsx）
- [x] 不下载到 C 盘（依赖安装到 F:\allmylife\event\client\web\node_modules\）
- [x] 不修改 server（server 端搜索 API + 动态组件 API 全部就绪）
- [x] 运行时验证强制（Playwright 验证 4 个搜索场景 + 3 个动态组件场景）

### 7.3 风险覆盖

- [x] 动态 widget 求值失败风险已识别 + 缓解方案
- [x] GitHub API 限流风险已识别 + 缓解方案
- [x] 下载代理 URL 跨域风险已识别 + 缓解方案
- [x] `?desktop=false` 过滤对 local-dependent 组件无效风险已识别 + 缓解方案（M3 修复）

### 7.4 待运行时确认问题

1. **`local-dependent` 组件的 `desktop_only` 字段值**：服务端 `?desktop=false` 过滤 `desktop_only = TRUE` 的组件，`local-dependent` 组件的 `desktop_only` 默认 FALSE（与 `component_env` 独立），不会被服务端过滤。客户端 `loadAndRegisterDynamicWidgets` 需运行时检查 `componentEnv === 'local-dependent'` 并跳过注册（M3 修复）。

2. **`getDynamicWidgetConfigs()` 返回顺序**：合并内置 + 动态 widget 后，列表顺序是否影响 UI（用户期望内置在前，动态在后）。

3. **GitHub `search_code` mode 在无 token 时的错误信息**：服务端 `searchApi.ts:532-538` 强制要 token，需确认错误信息能被 AI 理解并继续对话。

---

## 八、Phase S14 验收标准（与 roadmap v2 对齐）

### 8.1 功能验收

- [ ] 桌面端创建的 pure-frontend dynamic_widget，Web 端能渲染
- [ ] desktop_only=TRUE 的组件，Web 端不显示
- [ ] local-dependent 组件，Web 端显示"依赖桌面端"提示
- [ ] 配置 Metaso Key 后，AI 调用 web_search 返回结果
- [ ] 无需任何 Key，AI 调用 academic_search 返回 ArXiv 论文（按 submittedDate 倒序）
- [ ] 配置 GitHub Key 后，AI 调用 github_search 7 mode 全部可用
- [ ] AI 调用 download_repo_zip，Web 端点击代理 URL 下载 zip
- [ ] AI 调用 download_file ≥1MB，Web 端点击代理 URL 下载

### 8.2 运行时验证（强制）

- [ ] `cd client/web && npm run typecheck` 零 error
- [ ] `cd client/web && npm run build` 成功生成 dist/
- [ ] `cd client/web && npm run dev` 启动成功
- [ ] 桌面端创建 pure-frontend 动态 widget → Web 端添加组件对话框显示该 widget + 绿色"纯前端"徽章（Playwright 验证）
- [ ] 桌面端创建 desktop_only=true 动态 widget → Web 端添加组件对话框不显示（Playwright 验证）
- [ ] 桌面端创建 local-dependent 动态 widget → Web 端添加组件对话框显示该 widget + 橙色"仅桌面端"徽章（Playwright 验证）
- [ ] Web 端点击 pure-frontend 动态 widget 按钮 → 画布上渲染该 widget（Playwright 验证）
- [ ] Settings 页配置 Metaso Key → 状态徽章变"已配置"（Playwright 验证）
- [ ] Settings 页配置 GitHub Key → 状态徽章变"已配置"（Playwright 验证）
- [ ] AI 调用 web_search → SearchResultsCard 显示 web 结果（Playwright 验证）
- [ ] AI 调用 academic_search → SearchResultsCard 显示 ArXiv 论文（Playwright 验证）
- [ ] AI 调用 github_search mode=search_repos → SearchResultsCard 显示仓库列表（Playwright 验证）
- [ ] AI 调用 github_search mode=download_repo_zip → SearchResultsCard 显示下载卡片 + 下载按钮（Playwright 验证）
- [ ] 点击下载按钮 → 浏览器开始下载 zip（Playwright 验证）

### 8.3 代码质量验收

- [ ] TypeScript 严格模式零 error
- [ ] 无 `console.log` 残留（除错误日志 console.error）
- [ ] 无未使用 import
- [ ] 无 `any` 类型（除明确标注）
- [ ] 所有改造点有注释说明（如 `// S14.1-T2 改造：增加 desktop=false 过滤`）

---

## 九、执行计划

### 9.1 执行顺序

```
1. S14.1-T1 替换 evaluateWidget.ts（覆盖 S12 stub，含 M3 修复：local-dependent 过滤）
2. S14.1-T2 改造 api/dynamicWidgets.ts 增加 ?desktop=false + 改造 useAppStore.ts refreshDynamicWidgets（含 M4 修复；M8 修复：同步改造 db.ts getAllDynamicWidgets 签名）
3. S14.1-T3 改造 main.tsx 新增 bootstrap()（含 C1+C4+C6 修复：bootstrap 调用 refreshDynamicWidgets）
4. S14.1-T4 改造 App.tsx 移除顶层 registerBuiltInWidgets
5. S14.1-T5 改造 CanvasHome.tsx 合并 widget 列表 + env 徽章（含 C7 修复：响应式订阅 store；m4 修复：Monitor import；C9+C10 修复：定义 PlaceholderWidgetConfig 类型，避免污染 WidgetConfig；M9 修复：handleWidgetButtonClick 调用 handleAddWidget 保留 toast 反馈）
6. S14.2-T1 新建 SearchKeysConfig.tsx（移植桌面端）
7. S14.2-T2 改造 Settings.tsx 新增 search tab
8. S14.2-T3 扩展 types/ai.ts 新增 GitHub 搜索结果类型
9. S14.2-T5 扩展 SearchSourceEntry 类型（含 C2+m3 修复）
10. S14.2-T4 改造 useAIStore.ts handleToolCall 识别 papers/items/download 字段（含 C3+C5 修复）
11. S14.2-T6 改造 SearchResultsCard.tsx 按 mode 分流渲染（含 C2+M2 修复）
12. npm install + typecheck + 修复编译错误（迭代）
13. 运行时验证（Playwright）
14. 对抗审查（含运行时验证）
15. git commit（含 S13 + S14 一起提交）
```

### 9.2 并行策略

**Phase A（并行，2 个 sub-agent）**：

- **Sub-agent 1**（S14.1 动态组件）：
  - S14.1-T1 替换 evaluateWidget.ts
  - S14.1-T2 改造 api/dynamicWidgets.ts + useAppStore.ts refreshDynamicWidgets + db.ts getAllDynamicWidgets（M4+M8 修复）
  - S14.1-T3 改造 main.tsx（bootstrap 调用 refreshDynamicWidgets，C6 修复）
  - S14.1-T4 改造 App.tsx
  - S14.1-T5 改造 CanvasHome.tsx（响应式订阅 store，C7 修复；Monitor import，m4 修复；PlaceholderWidgetConfig 类型 + handleWidgetButtonClick 调 handleAddWidget，C9+C10+M9 修复）

- **Sub-agent 2**（S14.2 搜索工具 UI）：
  - S14.2-T1 新建 SearchKeysConfig.tsx
  - S14.2-T2 改造 Settings.tsx
  - S14.2-T3 扩展 types/ai.ts
  - S14.2-T5 扩展 SearchSourceEntry 类型
  - S14.2-T4 改造 useAIStore.ts handleToolCall
  - S14.2-T6 改造 SearchResultsCard.tsx

**Phase B（串行验证）**：
- typecheck + 修复错误
- Playwright 运行时验证

### 9.3 关键依赖

```
S14.1-T3 (main.tsx bootstrap) 依赖：
  ├── S14.1-T2 (refreshDynamicWidgets 改造) — bootstrap 调用 refreshDynamicWidgets({ desktop: false })（C6+M4 修复）
  │   └── S14.1-T2 内部依赖：S14.1-T1 (loadAndRegisterDynamicWidgets) + api/dynamicWidgets (getAllDynamicWidgets) + utils/db (getAllDynamicWidgets，M8 修复：必须同步改造)
  ├── registry/builtIn.tsx — registerBuiltInWidgets/registerBuiltInCapabilities（C1 修复：已存在）
  └── registry/capabilityRegistry.ts — syncCapabilitiesToServer（已存在）

S14.1-T4 (App.tsx 改造) 依赖：
  └── S14.1-T3 (main.tsx bootstrap) — registerBuiltInWidgets 迁移后才能删除

S14.1-T5 (CanvasHome 改造) 依赖：
  ├── S14.1-T1 (evaluateWidget) — 动态 widget 注册后 getDynamicWidgetConfigs() 才有数据
  ├── S14.1-T3 (bootstrap) — refreshDynamicWidgets 更新 store 后 CanvasHome 才能响应式重渲染（C6+C7 联动修复）
  ├── useAppStore.dynamicWidgets — S13 已存在，由 S14.1-T2 改造后的 refreshDynamicWidgets 填充
  └── CanvasHome L138 handleAddWidget — M9 修复依赖此函数保留 toast 反馈（已存在，无需新增）

S14.2-T4 (useAIStore handleToolCall 改造) 依赖：
  ├── S14.2-T3 (types/ai.ts) — GithubDownloadResult 等类型
  └── S14.2-T5 (SearchSourceEntry) — 扩展后的 mode/items/download 字段

S14.2-T6 (SearchResultsCard 改造) 依赖：
  ├── S14.2-T3 (types/ai.ts) — GithubCodeHit 等
  └── S14.2-T5 (SearchSourceEntry) — mode/items/download 字段
```

---

## 十、约束条件

| 约束 | 说明 |
|------|------|
| 不重写 v1 | v1 S0-S6/S9/S10 后端能力完全复用 |
| 不破坏桌面/移动端 | 仅在 `client/web/` 操作，不动 `client/desktop/` 与 `client/android/` |
| 不修改 server | 服务端搜索 API + 动态组件 API 全部就绪 |
| TypeScript 优先 | 所有文件 .ts/.tsx |
| 不下载到 C 盘 | node_modules 安装到 F:\allmylife\event\client\web\ |
| git 版本管理 | 完成后 git commit（S13 已提交 `bf950d9`，S14 单独提交） |
| 复用优先 | 物理复制 + 小改造，不重写已可用代码 |
| 运行时验证强制 | 不能只读代码，必须 Playwright 实际验证 |
| github_search 7 mode | 按服务端实现 7 mode 全部支持（不破坏已有能力） |

---

**Spec 完成。下一步：对抗审查 → 编码实现 → 运行时对抗审查 → git commit。**
