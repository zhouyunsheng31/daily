# Phase S12 Spec：Web 端画布核心

> 生成日期：2026-07-05
> Roadmap 依据：[roadmap_server_v2.md](../roadmap_server_v2.md) 第三章 Phase S12（L216-274）
> v1 基线：[roadmap_server_v1.md](../roadmap_server_v1.md)（S0-S6/S9/S10 已完成）
> S11 前置：[phase-s11-spec.md](./phase-s11-spec.md)（已完成 Web 端基础设施 + 单用户认证）
> 架构依据：[architecture_refactor.md](../architecture_refactor.md)
> 状态：待编码实现

---

## 一、项目目的

让用户通过网页浏览器打开网址即可使用 Living Dashboard 的**完整画布能力**——8 个 widget + 拖拽/缩放/连线/笔迹/小地图全部可用。S12 在 S11（Web 端壳子 + 登录）基础上，把桌面端画布核心 100% 复用到 Web 端，为 S13（AI 集成）/S14（动态组件 + 搜索）/S15（生产部署）打基础。

**S12 范围**：
- S12.1 画布核心组件复用（7 个 + react-router 路由系统）
- S12.2 8 个 widget 复用 + WebviewWidget 降级 UI
- S12.3 数据层打通（IndexedDB + withFallback + syncQueue + 多端实时同步）

**S12 不做**：
- AI 对话 + 思考流 + 工具调用（S13）—— 但 `AIAssistant.tsx` widget 本身要能创建并渲染（UI 占位）
- 动态组件 + 搜索 UI（S14）
- 生产部署 + HTTPS（S15）
- WebviewWidget 真实网页嵌入（浏览器无法嵌套，本 spec 定义降级 UI）

---

## 二、前置依赖与现状摸底

### 2.1 前置依赖

| 依赖 | 状态 | 说明 |
|------|------|------|
| v1 S0-S6/S9/S10 | ✅ | 后端 API + WS + 工具完整 |
| S11 Web 端基础设施 + 认证 | ✅ | `client/web/` 已存在，登录闭环 + JWT cookie + SPA fallback + CORS |
| S11 server 静态托管 | ✅ | `server/src/index.ts` 已加 express.static + SPA fallback |
| S11 docker-compose 透传 | ✅ | `WEB_ACCESS_PASSWORD`/`JWT_SECRET`/`CORS_ORIGIN` 已透传 |

### 2.2 S11 已完成的 Web 端基础设施（可直接使用）

| 文件 | 用途 | S12 复用方式 |
|------|------|-------------|
| `client/web/src/api/client.ts` | fetch 封装，已加 `credentials:'include'`，`API_BASE='/api'` | 直接使用 |
| `client/web/src/api/`（15 个文件） | panels/widgets/entities/settings 等 API 客户端 | 直接使用 |
| `client/web/src/utils/dbV2.ts`、`idbTx.ts`、`dbStores/` | IDB V2 基础设施 | 直接使用 |
| `client/web/src/utils/syncQueue.ts` | syncQueue（保留 `window.syncLogApi` 守卫，Web 端走 api/syncLogs） | 直接使用 |
| `client/web/src/utils/deviceAuth.ts` | localStorage deviceId | 直接使用 |
| `client/web/src/utils/contextMenu.ts` | 保留 `window.contextMenuApi` 守卫 | 直接使用（Web 端注入 DOM 实现，已有 WebContextMenu.tsx） |
| `client/web/src/utils/localSearch.ts` 等 8 个 | 搜索工具链 | 直接使用 |
| `client/web/src/components/WebContextMenu.tsx` | DOM 右键菜单实现 | 直接使用 |
| `client/web/src/components/AuthGuard.tsx` | 路由鉴权守卫 | 直接使用 |
| `client/web/src/pages/Login.tsx`、`Home.tsx` | 登录页 + 主页占位 | Home.tsx 替换为 CanvasHome |
| `client/web/src/main.tsx`、`App.tsx` | BrowserRouter + 路由 | App.tsx 扩展路由 |
| `client/web/vite.config.ts` | Vite 配置 + /api + /ws 代理 | 直接使用 |
| `client/web/package.json` | react 19 + react-router-dom@7 + zustand + idb + uuid + lucide-react | S12 增补依赖 |

### 2.3 S11 stub 文件（S12.3 替换为真实实现）

| stub 文件 | 当前状态 | S12.3 改造 |
|----------|---------|-----------|
| `client/web/src/api/adapter.ts` | 39 行 stub，`withFallback` 直接走 apiFn 不降级 | **替换为桌面端完整版（无需改造，见 S12.3-T1）** |
| `client/web/src/utils/db.ts` | **S11 stub 存在**（行 1-29 抛 `'[Web S11] not implemented'`） | **覆盖为桌面端完整版 2832 行** |
| `client/web/src/stores/` | 不存在（S11 未复制） | **从桌面端复制** |
| `client/web/src/registry/` | 不存在 | **从桌面端复制 + 改造** |
| `client/web/src/hooks/` | 不存在 | **从桌面端复制** |

### 2.4 S11 已知缺口（S12 必须补丁）

**缺口 1**：S11 的 `POST /api/auth/login` 响应 body 仅返回 `{ authenticated: true }`（见 `server/src/routes/auth.ts:30`），**不返回 JWT token**。S12 WS 连接需要 token 拼 URL query，httpOnly cookie JS 读不到。

**修复方案**（S12.3-T9）：
- 修改 `server/src/routes/auth.ts:30` 为 `return res.json({ authenticated: true, token })`
- 修改 `client/web/src/pages/Login.tsx` 登录成功后将 `data.token` 存 `sessionStorage.setItem('ld-jwt', data.token)`
- 修改 `client/web/src/pages/Home.tsx` 的 logout 也清 `sessionStorage.removeItem('ld-jwt')`

**缺口 2**：S11 的 WS `change` 事件实际由桌面端 `useAIStore.handleServerChange` 处理（见 `useAIStore.ts:620-624` + `874-933`），调 `useAppStore.refreshPanels/refreshWidgets/refreshSettings/refreshDynamicWidgets`。S12 useAIStore 是 stub，**WS 不会初始化，change 事件无人处理**。

**修复方案**（S12.3-T11）：在 `useAppStore.initialize()` 中独立初始化 WS（不依赖 useAIStore），新增 `handleServerChange` 方法分发到 refresh* 系列。详见 S12.3-T11。

### 2.5 关键约束

| 约束 | 说明 |
|------|------|
| 不破坏桌面/移动端兼容 | 仅在 `client/web/` 内操作，不动 `client/desktop/` 与 `client/android/` |
| 单用户模式 | 沿用 S11 的 JWT cookie，无需 users 表 |
| TypeScript 严格 | Web 端 tsconfig 继承桌面端，编译零 error |
| 复用优先 | 优先物理复制 + 小改造，不重写已可用代码 |
| WebviewWidget 降级 | 浏览器无法嵌套网页，显示 URL + "在桌面端打开"按钮 |
| 不下载到 C 盘 | 所有依赖安装到 `client/web/node_modules/`（项目盘 F:） |
| git 版本管理 | 所有变更走 git commit |

---

## 三、S12.1 画布核心组件复用

### 3.1 任务清单（文件级）

#### S12.1-T1：复制 7 个画布核心组件

| # | 源文件 | 目标文件 | 改造 |
|---|--------|---------|------|
| 1 | `client/desktop/src/components/Workspace.tsx`（1542 行） | `client/web/src/components/Workspace.tsx` | 删除 webview wheel 分支（行 1132-1134） |
| 2 | `client/desktop/src/components/CanvasHome.tsx`（944 行） | `client/web/src/components/CanvasHome.tsx` | 直接复制 |
| 3 | `client/desktop/src/components/WidgetContainer.tsx`（547 行） | `client/web/src/components/WidgetContainer.tsx` | 删除 webview mousedown 分支（行 287-289），保留 `type === 'webPage'` drag handle 分支（行 291-293） |
| 4 | `client/desktop/src/components/StrokesLayer.tsx`（138 行） | `client/web/src/components/StrokesLayer.tsx` | 直接复制 |
| 5 | `client/desktop/src/components/ConnectionLayer.tsx`（163 行） | `client/web/src/components/ConnectionLayer.tsx` | 直接复制 |
| 6 | `client/desktop/src/components/Minimap.tsx`（561 行） | `client/web/src/components/Minimap.tsx` | 直接复制 + `html-to-image` 的 `toCanvas` 加 try-catch fallback（跨域 iframe 会 taint） |
| 7 | `client/desktop/src/components/CanvasModeToolbar.tsx`（177 行） | `client/web/src/components/CanvasModeToolbar.tsx` | 直接复制 |

#### S12.1-T2：复制依赖的辅助组件

| # | 源文件 | 目标文件 | 改造 |
|---|--------|---------|------|
| 1 | `client/desktop/src/components/WidgetErrorBoundary.tsx` | `client/web/src/components/WidgetErrorBoundary.tsx` | 直接复制（Workspace 依赖） |
| 2 | `client/desktop/src/components/SkeletonScreen.tsx` | `client/web/src/components/SkeletonScreen.tsx` | 直接复制（Workspace 依赖） |
| 3 | `client/desktop/src/components/ConflictBadge.tsx` | `client/web/src/components/ConflictBadge.tsx` | 直接复制（WidgetContainer 依赖） |
| 4 | `client/desktop/src/components/FavoriteWidgetPreview.tsx` | `client/web/src/components/FavoriteWidgetPreview.tsx` | 直接复制（CanvasHome 依赖） |
| 5 | `client/desktop/src/components/Toast.tsx` | `client/web/src/components/Toast.tsx` | 直接复制（useToastStore 渲染） |
| 6 | `client/desktop/src/components/GlobalErrorBoundary.tsx` | `client/web/src/components/GlobalErrorBoundary.tsx` | 直接复制（App.tsx 依赖） |
| 7 | `client/desktop/src/components/LazyWidget.tsx` | `client/web/src/components/LazyWidget.tsx` | 直接复制（registry/builtIn 依赖） |
| 8 | `client/desktop/src/components/OfflineBanner.tsx` | `client/web/src/components/OfflineBanner.tsx` | 直接复制 |
| 9 | `client/desktop/src/components/MigrationPage.tsx` | `client/web/src/components/MigrationPage.tsx` | 直接复制 |
| 10 | `client/desktop/src/assets/logo.png` | `client/web/src/assets/logo.png` | 直接复制（CanvasHome 依赖） |

#### S12.1-T3：引入 react-router 路由系统

**目标**：用 react-router 替代桌面端 `useAppStore.mainView` 条件渲染，路由映射：

| 路由 | 组件 | 对应桌面端 mainView.type |
|------|------|--------------------------|
| `/login` | `<Login>` | （已有） |
| `/` | `<CanvasHome>` | `canvas-home` |
| `/panel/:panelId` | `<Workspace>` | `canvas-panel` |
| `/migration` | `<MigrationPage>` | （已有 window.location 检测） |

**改造 `client/web/src/App.tsx`**：

```typescript
import { useEffect } from 'react'
import { Routes, Route, Navigate, useNavigate } from 'react-router-dom'
import Login from './pages/Login'
import CanvasHome from './components/CanvasHome'
import Workspace from './components/Workspace'
import MigrationPage from './components/MigrationPage'
import AuthGuard from './components/AuthGuard'
import { useAppStore, setUseAIStoreRef } from './stores/useAppStore'
import { useAIStore, setUseAppStoreRef, registerAppStateProvider } from './stores/useAIStore'

// useAppStore ↔ useAIStore 循环依赖运行时接线（必须在模块顶层执行，参考桌面端 App.tsx:52-70）
setUseAIStoreRef(() => useAIStore)
setUseAppStoreRef(() => useAppStore)
registerAppStateProvider(() => {
  const s = useAppStore.getState()
  return {
    activePanelId: s.activePanelId,
    panelWidgets: s.panelWidgets,
    // S13 完整实现时补充其他字段
  }
})

function MainViewSync() {
  const mainView = useAppStore(s => s.mainView)
  const navigate = useNavigate()
  useEffect(() => {
    if (mainView.type === 'canvas-home') navigate('/', { replace: true })
    else if (mainView.type === 'canvas-panel') navigate(`/panel/${mainView.panelId}`, { replace: true })
  }, [mainView])
  return null
}

export default function App() {
  return (
    <>
      <MainViewSync />
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/migration" element={<MigrationPage />} />
        <Route path="/" element={<AuthGuard><CanvasHome /></AuthGuard>} />
        <Route path="/panel/:panelId" element={<AuthGuard><Workspace /></AuthGuard>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </>
  )
}
```

**`useAppStore.setMainView` 适配**：
- 桌面端通过 `setMainView({type:'canvas-panel', panelId})` 切换视图
- Web 端在 `useAppStore` 内 `setMainView` action 中调用 `window.history.pushState` 或 React Router 的 `useNavigate`（推荐：通过 `useAppStore` 不直接调 router，而是组件订阅 `mainView` 变化后用 `useEffect` 触发 `navigate`）

**实现方案**：在 `App.tsx` 顶层加一个 `<MainViewSync/>` 组件，订阅 `useAppStore.mainView`，变化时调用 `useNavigate()` 跳转。这样不污染 store，也保留桌面端 store 接口。

```typescript
function MainViewSync() {
  const mainView = useAppStore(s => s.mainView)
  const navigate = useNavigate()
  useEffect(() => {
    if (mainView.type === 'canvas-home') navigate('/', { replace: true })
    else if (mainView.type === 'canvas-panel') navigate(`/panel/${mainView.panelId}`, { replace: true })
  }, [mainView])
  return null
}
```

#### S12.1-T4：复制 hooks/

| # | 源文件 | 目标文件 | 改造 |
|---|--------|---------|------|
| 1 | `client/desktop/src/hooks/useDraggable.ts`（113 行） | `client/web/src/hooks/useDraggable.ts` | 直接复制 |
| 2 | `client/desktop/src/hooks/useResizable.ts`（123 行） | `client/web/src/hooks/useResizable.ts` | 直接复制 |
| 3 | `client/desktop/src/hooks/useWebviewPool.ts`（77 行） | `client/web/src/hooks/useWebviewPool.ts` | 直接复制（Fallback 不用，但保留以减少 import 错误） |

#### S12.1-T5：复制 utils/ 中 S12 必需的工具

| # | 源文件 | 目标文件 | 改造 |
|---|--------|---------|------|
| 1 | `client/desktop/src/utils/canvasCoords.ts` | `client/web/src/utils/canvasCoords.ts` | 直接复制 |
| 2 | `client/desktop/src/utils/drawingCoords.ts` | `client/web/src/utils/drawingCoords.ts` | 直接复制 |
| 3 | `client/desktop/src/utils/widgetColorSchemes.ts` | `client/web/src/utils/widgetColorSchemes.ts` | 直接复制 |
| 4 | `client/desktop/src/utils/color.ts` | `client/web/src/utils/color.ts` | 直接复制 |
| 5 | `client/desktop/src/utils/commandStack.ts` | `client/web/src/utils/commandStack.ts` | 直接复制 |
| 6 | `client/desktop/src/utils/stateSchema.ts` | `client/web/src/utils/stateSchema.ts` | 直接复制（注意：`saveCorruptedBackup` 中 `openDB('living-dashboard', 6)` 是 V1 数据库，Web 端可能无 V1 数据，加 try-catch） |
| 7 | `client/desktop/src/utils/sm2.ts` | `client/web/src/utils/sm2.ts` | 直接复制 |
| 8 | `client/desktop/src/utils/widgetRender.ts` | `client/web/src/utils/widgetRender.ts` | 直接复制 |
| 9 | `client/desktop/src/utils/editMode.ts` | `client/web/src/utils/editMode.ts` | 直接复制 |
| 10 | `client/desktop/src/utils/editorLease.ts` | `client/web/src/utils/editorLease.ts` | 直接复制 |
| 11 | `client/desktop/src/utils/multiTab.ts` | `client/web/src/utils/multiTab.ts` | 直接复制 |
| 12 | `client/desktop/src/utils/debounce.ts` | `client/web/src/utils/debounce.ts` | 直接复制 |
| 13 | `client/desktop/src/utils/widgetStateLocator.ts` | `client/web/src/utils/widgetStateLocator.ts` | 直接复制 |
| 14 | `client/desktop/src/utils/panelMemoryManager.ts` | `client/web/src/utils/panelMemoryManager.ts` | 直接复制（行 269-271 已有 `window.memoryApi` 守卫 + 行 275 `return null` fallback，无需改造） |
| 15 | `client/desktop/src/utils/panelStatePersistence.ts` | `client/web/src/utils/panelStatePersistence.ts` | webview 部分 stub：保留 widgetStates 持久化，`browserToolBridge.getWebview()` 调用包装在 try-catch + 返回 null |
| 16 | `client/desktop/src/utils/browserToolBridge.ts` | `client/web/src/utils/browserToolBridge.ts` | 仅保留 `normalizeUrl`/`isUrl`/`buildSearchUrl` 纯函数，webview 相关方法 stub（返回 null/空数组） |
| 17 | `client/desktop/src/utils/date.ts` | `client/web/src/utils/date.ts` | 直接复制（entityMigration 依赖） |

### 3.2 S12.1 验收标准

- [ ] `client/web/src/components/` 至少包含 7 个画布核心 + 10 个辅助组件
- [ ] `client/web/src/hooks/` 至少包含 useDraggable/useResizable/useWebviewPool
- [ ] `client/web/src/utils/` 包含上述 17 个工具文件
- [ ] `client/web/src/App.tsx` 路由：`/login` / `/` / `/panel/:panelId` / `/migration`
- [ ] TS 编译零 error（`npm run typecheck` 通过）
- [ ] 路由切换正常，刷新不 404（依赖 S11 SPA fallback）

---

## 四、S12.2 8 个 widget 复用 + WebviewWidget 降级

### 4.1 任务清单

#### S12.2-T1：复制 8 个 widget + 3 个数据文件

| # | 源文件 | 目标文件 | 改造 |
|---|--------|---------|------|
| 1 | `client/desktop/src/components/widgets/AIAssistant.tsx`（447 行） | `client/web/src/components/widgets/AIAssistant.tsx` | 直接复制（依赖 useAIStore S12.3 stub + types/ai S11 已存在） |
| 2 | `client/desktop/src/components/widgets/Calculator.tsx`（214 行） | `client/web/src/components/widgets/Calculator.tsx` | 直接复制 |
| 3 | `client/desktop/src/components/widgets/FocusTimer.tsx`（533 行） | `client/web/src/components/widgets/FocusTimer.tsx` | 直接复制 |
| 4 | `client/desktop/src/components/widgets/HtmlCanvasWidget.tsx`（212 行） | `client/web/src/components/widgets/HtmlCanvasWidget.tsx` | 直接复制（依赖 iframeProxy S12.3 改造 + useAIStore S12.3 stub + dbStores/htmlWidgets S11 已复制） |
| 5 | `client/desktop/src/components/widgets/LatexQuiz.tsx`（448 行） | `client/web/src/components/widgets/LatexQuiz.tsx` | 直接复制 |
| 6 | `client/desktop/src/components/widgets/MusicPlayer.tsx`（372 行） | `client/web/src/components/widgets/MusicPlayer.tsx` | 直接复制 |
| 7 | `client/desktop/src/components/widgets/PdfViewer.tsx`（301 行） | `client/web/src/components/widgets/PdfViewer.tsx` | 直接复制（pdfjs worker 由 Vite 处理，构建时验证） |
| 8 | `client/desktop/src/components/widgets/Sudoku.tsx`（1019 行） | `client/web/src/components/widgets/Sudoku.tsx` | 直接复制 |
| 9 | `client/desktop/src/components/widgets/calculatorParser.ts` | `client/web/src/components/widgets/calculatorParser.ts` | 直接复制 |
| 10 | `client/desktop/src/components/widgets/latexQuizData.ts` | `client/web/src/components/widgets/latexQuizData.ts` | 直接复制 |
| 11 | `client/desktop/src/components/widgets/sudokuData.ts` | `client/web/src/components/widgets/sudokuData.ts` | 直接复制 |

#### S12.2-T2：重写 WebviewWidgetFallback.tsx

**目标文件**：`client/web/src/components/widgets/WebviewWidgetFallback.tsx`

**功能**：
1. 显示 state.url + state.title（只读）
2. "在桌面端打开"按钮 → `window.open(state.url, '_blank')`（同源新标签页）+ 显示"复制链接"按钮
3. drag handle 标记 `data-widget-drag-handle`（保留 WidgetContainer 行 291-293 的 `type === 'webPage'` 拖拽分支）
4. 截图缩略图占位（用 lucide-react `Globe`/`ExternalLink` 图标 + URL 文字，不实际截图跨域 iframe）
5. 移除所有 webview 事件监听 + browserToolBridge 注册 + panelMemoryManager 滚动恢复

**JSX 结构**：
```tsx
<div className="webview-widget-fallback" data-widget-drag-handle>
  <div className="fallback-toolbar">
    <span className="fallback-url">{state.url || 'about:blank'}</span>
    <button onClick={() => window.open(state.url, '_blank')} disabled={!state.url}>
      <ExternalLink size={14} /> 在桌面端打开
    </button>
    <button onClick={copyUrl}>复制链接</button>
  </div>
  <div className="fallback-content">
    <Globe size={64} className="text-gray-400" />
    <p>Web 端不支持嵌入网页</p>
    <p className="text-sm text-gray-500">请在桌面端打开此 widget 以浏览网页内容</p>
  </div>
</div>
```

**关键约束**：
- 不使用 `<iframe>`（避免 CORS / X-Frame-Options 问题）
- 不调用 `browserToolBridge.registerWebview`（无 webview）
- 不调用 `panelMemoryManager.restoreWebviewScrollY`（无 webview）
- 保留 `data-widget-drag-handle` 让 WidgetContainer 仍可拖拽
- 保留 `state.url`/`state.title` 字段，与桌面端 widget state schema 兼容

#### S12.2-T3：复制 + 改造 registry/

| # | 源文件 | 目标文件 | 改造 |
|---|--------|---------|------|
| 1 | `client/desktop/src/registry/index.ts`（30 行） | `client/web/src/registry/index.ts` | 直接复制 |
| 2 | `client/desktop/src/registry/widgetDefinitions.ts`（577 行） | `client/web/src/registry/widgetDefinitions.ts` | 直接复制 |
| 3 | `client/desktop/src/registry/capabilityRegistry.ts` | `client/web/src/registry/capabilityRegistry.ts` | 直接复制 |
| 4 | `client/desktop/src/registry/builtIn.tsx`（329 行） | `client/web/src/registry/builtIn.tsx` | 改造：`webPage` widget 注册指向 `WebviewWidgetFallback`（而非 `WebviewWidget`） |
| 5 | `client/desktop/src/registry/dataSources.ts` | `client/web/src/registry/dataSources.ts` | 直接复制（S13 才用，但 builtIn 可能依赖） |

**builtIn.tsx 改造点**（行 22）：
- 行 22：`const LazyWebviewWidget = lazy(() => import('../components/widgets/WebviewWidget'))` → `lazy(() => import('../components/widgets/WebviewWidgetFallback'))`
- 行 45 + 行 153 的 `WebviewWidget` 变量名保留（仅 import 源改变）

#### S12.2-T4：复制 shared/types/componentCapability

| # | 源文件 | 目标文件 | 改造 |
|---|--------|---------|------|
| 1 | `shared/types/componentCapability.ts` | `client/web/src/types/componentCapability.ts` | 直接复制（避免跨目录 import，复制到本地 types/） |

> 注：builtIn.tsx 依赖此类型。原桌面端从 `../../../shared/types/componentCapability` 导入。Web 端复制到 `client/web/src/types/componentCapability.ts`，builtIn.tsx 改为 `../types/componentCapability`。

#### S12.2-T5：新增依赖到 client/web/package.json

```json
{
  "dependencies": {
    "react": "^19.2.6",
    "react-dom": "^19.2.6",
    "react-router-dom": "^7.1.0",
    "zustand": "^5.0.14",
    "idb": "^8.0.3",
    "uuid": "^14.0.0",
    "lucide-react": "^1.17.0",
    "katex": "^0.16.11",
    "pdfjs-dist": "^4.8.69",
    "html-to-image": "^1.11.13"
  },
  "devDependencies": {
    "@types/react": "^19.2.0",
    "@types/react-dom": "^19.2.0",
    "@types/uuid": "^10.0.0",
    "@types/katex": "^0.16.7",
    "@vitejs/plugin-react": "^6.0.1",
    "tailwindcss": "^4.1.0",
    "@tailwindcss/vite": "^4.1.0",
    "typescript": "~6.0.2",
    "vite": "^8.0.12"
  }
}
```

新增依赖说明：
- `katex` — LatexQuiz widget 依赖
- `pdfjs-dist` — PdfViewer widget 依赖
- `html-to-image` — Minimap 截图依赖
- `@types/katex` — KaTeX 类型

### 4.2 S12.2 验收标准

- [ ] `client/web/src/components/widgets/` 包含 8 个 widget + WebviewWidgetFallback + 3 个数据文件
- [ ] `client/web/src/registry/` 包含 index/widgetDefinitions/capabilityRegistry/builtIn/dataSources
- [ ] `builtIn.tsx` 中 `webPage` 注册指向 `WebviewWidgetFallback`
- [ ] `client/web/src/types/componentCapability.ts` 存在
- [ ] `npm install` 成功，无依赖错误
- [ ] TS 编译零 error
- [ ] 8 个 widget 能创建 + 渲染 + 拖拽 + 缩放 + 右键菜单
- [ ] WebviewWidgetFallback 显示 URL + "在桌面端打开"按钮
- [ ] Calculator/FocusTimer/LatexQuiz/MusicPlayer/PdfViewer/Sudoku 功能完整

---

## 五、S12.3 数据层打通

### 5.1 任务清单

#### S12.3-T1：替换 api/adapter.ts（替换 S11 stub）

**源文件**：`client/desktop/src/api/adapter.ts`（152 行）
**目标文件**：`client/web/src/api/adapter.ts`（覆盖 S11 stub）

**改造点**：**无改造**，直接物理复制。

- 行 5：`import { useRuntimeModeStore } from '../stores/useRuntimeModeStore'` 保留（S12.3-T3 复制 store）
- 行 50-67：`useRuntimeModeStore.subscribe` 逻辑保留（store 在 Web 端也工作）
- `detectBackend()` 已用 `fetch(healthUrl, ...)`（行 30），**无 `window.serverHealthCheck` 调用**（spec v1 错误描述已修正）
- `flushSyncQueue` 调用 `syncQueue` 逻辑保留

**验证**：
- `withFallback(apiFn, idbFn, syncOp)` 在 API 可用时走 apiFn，失败时降级 idbFn + 入队 syncOp
- `getBackend()` 返回 `'api'` 或 `'idb'`，由 `useRuntimeModeStore.isServerOnline` 决定

#### S12.3-T2：复制 utils/db.ts + entityMigration.ts + migration.ts

| # | 源文件 | 目标文件 | 改造 |
|---|--------|---------|------|
| 1 | `client/desktop/src/utils/db.ts`（2832 行） | `client/web/src/utils/db.ts` | **覆盖 S11 stub**（行 1-29 抛错的 stub 替换为完整 2832 行）。无 window.*Api，依赖 api/adapter + dbV2 + idbTx + dbStores + api/panels/widgets/entities/settings/dynamicWidgets/panelMemoryState，全部已存在或 S12.3 复制 |
| 2 | `client/desktop/src/utils/entityMigration.ts`（327 行） | `client/web/src/utils/entityMigration.ts` | 直接复制 |
| 3 | `client/desktop/src/utils/migration.ts`（148 行） | `client/web/src/utils/migration.ts` | 直接复制 |

#### S12.3-T3：复制 stores/

| # | 源文件 | 目标文件 | 改造 |
|---|--------|---------|------|
| 1 | `client/desktop/src/stores/useAppStore.ts`（3023 行） | `client/web/src/stores/useAppStore.ts` | 直接复制（无 window.*Api，无 Electron API） |
| 2 | `client/desktop/src/stores/useToastStore.ts`（50 行） | `client/web/src/stores/useToastStore.ts` | 直接复制 |
| 3 | `client/desktop/src/stores/useRuntimeModeStore.ts`（218 行） | `client/web/src/stores/useRuntimeModeStore.ts` | 直接复制（localStorage 持久化，无 window.*Api） |
| 4 | `client/desktop/src/stores/useOnboardingStore.ts`（92 行） | `client/web/src/stores/useOnboardingStore.ts` | 直接复制 |
| 5 | `client/desktop/src/stores/useApiConfigStore.ts`（455 行） | `client/web/src/stores/useApiConfigStore.ts` | 改造：`window.aiKeyApi` 调用（行 109/418/444）改为 Web Crypto API fallback；`window.electron.ipcRenderer.on('api-key:changed')`（行 271-282）删除 |
| 6 | `client/desktop/src/stores/useAIStore.ts`（1703+ 行） | `client/web/src/stores/useAIStore.ts` | **S12 stub**：仅导出 `useAIStore`（最小化 state + 空 actions）+ `setUseAppStoreRef`，S13 完整实现 |

#### S12.3-T4：useAIStore stub 设计

**目标文件**：`client/web/src/stores/useAIStore.ts`

**Stub 接口**（仅满足 S12 编译 + 运行时占位）：

```typescript
import { create } from 'zustand'

// S12 stub：S13 完整实现 AI 对话 + 思考流 + 工具调用
// 当前仅提供 useAppStore 的循环依赖接口 + 空 state

interface WidgetErrorInfo {
  widgetId: string
  panelId: string
  error: string
  timestamp: number
}

interface AIStoreStubState {
  sessions: Record<string, unknown>
  activeSessionId: string | null
  isInitialized: boolean
  isOnline: boolean
  initialize: () => Promise<void>
  createSession: (panelId: string) => Promise<string>
  sendMessage: (panelId: string, message: string) => Promise<void>
  // HtmlCanvasWidget.tsx:127-130 调用签名：(widgetId, panelId, error: WidgetErrorInfo)
  reportWidgetError: (widgetId: string, panelId: string, error: unknown) => void
}

export const useAIStore = create<AIStoreStubState>(() => ({
  sessions: {},
  activeSessionId: null,
  isInitialized: false,
  isOnline: false,
  initialize: async () => { /* S13 stub */ },
  createSession: async () => { /* S13 stub */ return '' },
  sendMessage: async () => { /* S13 stub */ },
  reportWidgetError: () => { /* S13 stub */ },
}))

// 类型名必须是 useAIStoreType（useAppStore.ts:120 import { useAIStoreType }）
export type useAIStoreType = typeof useAIStore

// 循环依赖：useAppStore ↔ useAIStore
let _useAppStoreRef: (() => unknown) | null = null
export function setUseAppStoreRef(ref: () => unknown) {
  _useAppStoreRef = ref
}
export function getUseAppStoreRef() {
  return _useAppStoreRef?.()
}

// App.tsx:57 调用 registerAppStateProvider（必须导出，no-op 即可）
export function registerAppStateProvider(_fn: () => Record<string, unknown>): void {
  /* S13 stub */
}
```

**关键约束**：
- 必须导出 `useAIStore`、`useAIStoreType`（不是 AIStoreType）、`setUseAppStoreRef`、`getUseAppStoreRef`、`registerAppStateProvider`
- 必须满足 useAppStore 行 119-128 的反向引用（`import('./useAIStore').useAIStoreType`）
- 必须满足 App.tsx 行 4/52/54/57 的三件套接线（setUseAIStoreRef/setUseAppStoreRef/registerAppStateProvider）
- 必须满足 AIAssistant.tsx 行 43-49 + HtmlCanvasWidget.tsx 行 127-130 的方法调用
- `reportWidgetError` 签名必须是 `(widgetId, panelId, error)` 3 参数（HtmlCanvasWidget.tsx:127-130）
- S13 完整实现时替换此 stub

#### S12.3-T5：复制 + 改造 utils/iframeProxy.ts

**源文件**：`client/desktop/src/utils/iframeProxy.ts`（224 行）
**目标文件**：`client/web/src/utils/iframeProxy.ts`

**改造点**：
- 行 14-15：保留 `./dbStores/kvStorage` 依赖（S11 已复制）
- 行 15：`./wsToolHandlers` 依赖 → S12.3-T6 创建简化版
- 主体逻辑（`generateToken`/`getInitScript`/`handleCanvasAction`/`createMessageHandler`）保留

#### S12.3-T6：创建简化版 utils/wsToolHandlers.ts

**目标文件**：`client/web/src/utils/wsToolHandlers.ts`

**S12 范围**：仅提供 iframeProxy.ts:15 实际依赖的 `readFromLegacyTable` 函数 stub + `ToolCallResult` 类型，移除 browser_* 工具（S13 完整集成）。

**重要**：`handleCanvasAction` 和 `createMessageHandler` 是 `iframeProxy.ts` 自身的方法（行 86/164），**不在 wsToolHandlers.ts 中**，本 stub 不应导出。

**Stub 接口**：

```typescript
// S12 stub：iframeProxy.ts:15 import { readFromLegacyTable } from './wsToolHandlers'
// S13 完整实现 AI 工具调用（widget/storage/search 类）

export interface ToolCallResult {
  success: boolean
  data?: unknown
  error?: string
}

// iframeProxy.ts:96 调用 readFromLegacyTable(table, key)
export async function readFromLegacyTable(
  _table: string,
  _key: string,
): Promise<ToolCallResult> {
  // S12 stub：返回 not implemented，HtmlCanvasWidget 应处理此 fallback
  return { success: false, error: 'S12 stub: readFromLegacyTable not implemented' }
}

// 可选：S13 完整实现的占位（如其他模块依赖）
export async function executeToolCall(
  _toolName: string,
  _args: unknown,
): Promise<ToolCallResult> {
  return { success: false, error: 'S13 stub: executeToolCall not implemented' }
}
```

**关键约束**：
- **必须导出 `readFromLegacyTable`**（iframeProxy.ts:15 + 行 96 实际依赖）
- **必须导出 `ToolCallResult` 接口**
- 不引入 `browserToolBridge`（Web 端不使用）
- 不引入 `useAppStore`（避免循环依赖）
- 不导出 `handleCanvasAction`/`createMessageHandler`（这两个是 iframeProxy 自身方法）

#### S12.3-T7：useApiConfigStore Web Crypto fallback

**目标文件**：`client/web/src/stores/useApiConfigStore.ts`

**改造点**：

1. **行 109/418/444 `window.aiKeyApi` 调用**：替换为 Web Crypto API：

```typescript
// 工具函数：Web Crypto API 加密 apiKey
async function encryptApiKey(plaintext: string): Promise<string> {
  if (typeof window === 'undefined' || !window.crypto?.subtle) {
    // fallback：localStorage 不加密（开发模式）
    return `plain:${plaintext}`
  }
  const encoder = new TextEncoder()
  const keyMaterial = await window.crypto.subtle.importKey(
    'raw',
    encoder.encode(navigator.userAgent || 'living-dashboard-web'),
    { name: 'PBKDF2' },
    false,
    ['deriveKey'],
  )
  const salt = window.crypto.getRandomValues(new Uint8Array(16))
  const key = await window.crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt'],
  )
  const iv = window.crypto.getRandomValues(new Uint8Array(12))
  const ciphertext = await window.crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    encoder.encode(plaintext),
  )
  // base64 编码
  const combined = new Uint8Array(salt.length + iv.length + ciphertext.byteLength)
  combined.set(salt, 0)
  combined.set(iv, salt.length)
  combined.set(new Uint8Array(ciphertext), salt.length + iv.length)
  return `enc:${btoa(String.fromCharCode(...combined))}`
}

async function decryptApiKey(stored: string): Promise<string> {
  if (stored.startsWith('plain:')) return stored.slice(6)
  if (!stored.startsWith('enc:')) return stored
  // ... 反向解密
}
```

2. **删除整个 `setupApiKeyChangeListener` 函数（行 268-290）及其调用点**：Web 端无 Electron IPC，多标签同步通过 `multiTab.ts` 的 BroadcastChannel。**注意**：仅删行 271-282 会留下孤立代码（行 268-270 函数头 + 行 283-289 监听器回调体）导致 TS 编译失败，必须整个函数（行 268-290）删除。

   ```typescript
   // 行 268-290 整个函数删除：
   // function setupApiKeyChangeListener(): void {
   //   const electronApi = (window as any).electron
   //   if (!electronApi?.ipcRenderer) return
   //   electronApi.ipcRenderer.on('api-key:changed', ...)
   //   ...
   // }
   ```
   同时删除该函数的调用点（在 useApiConfigStore 初始化处 grep `setupApiKeyChangeListener`）。

#### S12.3-T8：替换 utils/db.ts stub（已在 S12.3-T2 完成）

S11 中 `client/web/src/utils/db.ts` 已存在为 stub（行 1-29 抛 `'[Web S11] not implemented'`），S12.3-T2 覆盖为完整版 2832 行。

**验证**：grep `client/web/src/` 中所有 `from '../utils/db'` 或 `from '../../utils/db'`，确认 import 路径正确，无残留 stub 引用。

#### S12.3-T9：server 端 auth.ts 返回 JWT token（补 S11 缺口）

**目标文件**：`server/src/routes/auth.ts`

**改造点**（行 30）：
```typescript
// 改造前：
return res.json({ authenticated: true })

// 改造后：
return res.json({ authenticated: true, token })  // token 已签发用于 cookie，同时返回 body 让前端存 sessionStorage
```

**`POST /api/auth/refresh` 也同步返回 token**（行号在编码时定位）。

**关键约束**：
- 不破坏 S11 的 cookie 设置（httpOnly cookie 仍设置）
- 不破坏桌面端兼容（桌面端不调 `/api/auth/login`，仍用 SERVER_TOKEN）
- token 仅用于 Web 端 WS URL query

#### S12.3-T10：Web 端 Login.tsx 存 token 到 sessionStorage

**目标文件**：`client/web/src/pages/Login.tsx`

**改造点**：登录成功后（行 24-25 navigate 之前）：
```typescript
const data = await res.json()
if (data.token) {
  sessionStorage.setItem('ld-jwt', data.token)
}
navigate('/', { replace: true })
```

**Home.tsx logout 同步清理**：
```typescript
async function handleLogout() {
  setLoggingOut(true)
  try {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' })
  } finally {
    sessionStorage.removeItem('ld-jwt')  // 新增
    navigate('/login', { replace: true })
  }
}
```

#### S12.3-T11：useAppStore WS 初始化 + handleServerChange（补 S11 缺口）

**目标文件**：`client/web/src/stores/useAppStore.ts`（在桌面端复制版基础上新增 WS 逻辑）

**问题**：桌面端 WS 在 `useAIStore.ts:188-310` 初始化（含 `getServerPort` + `new WebSocket`）。S12 useAIStore 是 stub，WS 不会初始化，多端同步全断。

**S12 方案**：在 `useAppStore.initialize()` 中独立初始化 WS（不依赖 useAIStore），新增 `handleServerChange` 方法分发到 refresh* 系列。

**新增方法**：

```typescript
// 在 useAppStore.ts 中新增（紧邻 initialize 方法）

let wsClient: WebSocket | null = null

async function initWebSocket(): Promise<void> {
  const token = sessionStorage.getItem('ld-jwt')
  if (!token) {
    console.warn('[S12 WS] no JWT token in sessionStorage, skip WS init')
    return
  }
  const deviceId = getDeviceId()  // 来自 utils/deviceAuth
  const wsProtocol = window.location.protocol === 'https:' ? 'wss' : 'ws'
  const wsUrl = `${wsProtocol}://${window.location.host}/ws?token=${encodeURIComponent(token)}&deviceId=${encodeURIComponent(deviceId)}`
  
  wsClient = new WebSocket(wsUrl)
  
  wsClient.onopen = () => {
    console.log('[S12 WS] connected')
    // 发送初始 ping
    wsClient?.send(JSON.stringify({ kind: 'ping' }))
  }
  
  wsClient.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data)
      handleWsMessage(msg)
    } catch (err) {
      console.error('[S12 WS] parse message error:', err)
    }
  }
  
  wsClient.onerror = (err) => {
    console.error('[S12 WS] error:', err)
  }
  
  wsClient.onclose = () => {
    console.warn('[S12 WS] closed, retry in 5s')
    wsClient = null
    setTimeout(() => initWebSocket().catch(console.error), 5000)
  }
}

function handleWsMessage(msg: { kind: string; [key: string]: unknown }): void {
  switch (msg.kind) {
    case 'change':
      // 桌面端 useAIStore.ts:620-624 + 874-933 的 handleServerChange 等价实现
      useAppStore.getState().handleServerChange(
        msg.changeType as string,
        msg.data as unknown,
        msg.sourceDeviceId as string | undefined,
      )
      break
    case 'pong':
      // 心跳响应，忽略
      break
    case 'error':
      console.error('[S12 WS] server error:', msg)
      break
    case 'session_ready':
    case 'pi_event':
    case 'tool_call':
    case 'ask_user':
    case 'permission_request':
    case 'proxy_request':
      // S13/S14 在 useAIStore 完整实现时处理，S12 stub 忽略
      console.log(`[S12 WS] ignored ${msg.kind} (S13/S14 will handle)`)
      break
    default:
      console.warn('[S12 WS] unknown message kind:', msg.kind)
  }
}

// 心跳定时器（30s，沿用桌面端 v1 S0 实现）
let heartbeatTimer: ReturnType<typeof setInterval> | null = null
function startHeartbeat(): void {
  if (heartbeatTimer) clearInterval(heartbeatTimer)
  heartbeatTimer = setInterval(() => {
    if (wsClient?.readyState === WebSocket.OPEN) {
      wsClient.send(JSON.stringify({ kind: 'ping' }))
    }
  }, 30000)
}
```

**在 useAppStore state 中新增 action**：

```typescript
// 在 useAppStore.ts create() 的 set/get 中新增
handleServerChange: async (changeType: string, data: unknown, sourceDeviceId?: string) => {
  const state = get()
  // 忽略自己发起的 change（避免循环）
  if (sourceDeviceId && sourceDeviceId === getDeviceId()) return
  
  // 根据 changeType 分发到 refresh* 系列（参考 useAIStore.ts:874-933）
  switch (changeType) {
    case 'panel':
    case 'panels':
      await state.refreshPanels()
      break
    case 'widget':
    case 'widgets':
      await state.refreshWidgets()
      break
    case 'entity':
    case 'entities':
      await state.refreshAll()  // 刷新所有
      break
    case 'setting':
    case 'settings':
      await state.refreshSettings?.()  // 如存在
      break
    case 'dynamic_widget':
    case 'dynamic_widgets':
      await state.refreshDynamicWidgets?.()  // 如存在
      break
    case 'stroke':
    case 'connection':
      await state.refreshAll()  // 简化：全量刷新
      break
    default:
      console.warn('[S12 WS] unknown changeType:', changeType)
      await state.refreshAll()
  }
}
```

**在 `initialize` action 末尾调用**：

```typescript
initialize: async () => {
  // ... 原有初始化逻辑 ...
  await initWebSocket()
  startHeartbeat()
  set({ initialized: true })
}
```

**关键约束**：
- WS 初始化必须在 `useAppStore.initialize()` 中（不依赖 useAIStore stub）
- `handleServerChange` 必须忽略 `sourceDeviceId === getDeviceId()` 的事件（避免自己触发自己的刷新循环）
- 心跳间隔 30s（沿用 v1 S0）
- WS 关闭后 5s 自动重连
- `refreshPanels`/`refreshWidgets`/`refreshAll` 等方法在桌面端 useAppStore 已存在（直接复制即可）
- `refreshSettings`/`refreshDynamicWidgets` 如不存在，用 `refreshAll` fallback

**验收**：
- 桌面端创建 widget → Web 端 WS 收到 change 事件 → `handleServerChange` 调 `refreshWidgets` → UI 更新
- Web 端创建 widget → server 入库 → WS 广播 → 桌面端 useAIStore.handleServerChange 处理
- 关闭网络 → WS 断开 → 恢复网络 → 5s 后自动重连

### 5.2 S12.3 验收标准

- [ ] `client/web/src/api/adapter.ts` 完整版（替换 stub），`withFallback` 真实工作
- [ ] `client/web/src/utils/db.ts` 完整版（2832 行，覆盖 S11 stub），所有 CRUD 函数可用
- [ ] `client/web/src/utils/entityMigration.ts` + `migration.ts` 存在
- [ ] `client/web/src/utils/iframeProxy.ts` + `wsToolHandlers.ts`（简化版，含 `readFromLegacyTable` + `ToolCallResult`）存在
- [ ] `client/web/src/stores/` 包含 6 个 store 文件
- [ ] `useAIStore` stub 导出 `useAIStore`/`useAIStoreType`/`setUseAppStoreRef`/`getUseAppStoreRef`/`registerAppStateProvider`，不抛运行时错误
- [ ] `reportWidgetError` 签名为 `(widgetId, panelId, error)` 3 参数
- [ ] `useApiConfigStore` 在 Web 端能编译 + 运行（Web Crypto fallback 生效，整个 `setupApiKeyChangeListener` 函数删除）
- [ ] IndexedDB 初始化无错（`db.ts` 的 `ensureV2Ready` 调用成功）
- [ ] `withFallback` 在线时走 API，离线时降级 IDB + 入队 syncQueue
- [ ] 设备 ID 稳定（同一浏览器 deviceId 不变）
- [ ] panels/widgets/entities API CRUD 全链路通
- [ ] **S12.3-T9**：`POST /api/auth/login` 响应 body 返回 `{ authenticated, token }`
- [ ] **S12.3-T10**：Login.tsx 登录成功后 token 存 `sessionStorage['ld-jwt']`；Home.tsx logout 清除
- [ ] **S12.3-T11**：`useAppStore.initialize()` 中独立初始化 WS（不依赖 useAIStore），含心跳 30s + 5s 重连
- [ ] **S12.3-T11**：`handleServerChange` 方法存在，分发 change 事件到 refreshPanels/refreshWidgets/refreshAll
- [ ] **S12.3-T11**：忽略 `sourceDeviceId === deviceId` 的 change 事件（避免循环）

---

## 六、整体路由 + 启动流程

### 6.1 启动流程

```
1. 浏览器打开 https://domain.com/
2. AuthGuard 调 GET /api/auth/me
   ├── 401 → 跳转 /login
   └── 200 → 渲染 CanvasHome
3. App.tsx 模块顶层执行 store ref wiring（setUseAIStoreRef/setUseAppStoreRef/registerAppStateProvider）
4. App.tsx useEffect 调 useAppStore.initialize()（桌面端 App.tsx:76/166 模式）
   ├── ensureV2Ready() → IDB 初始化
   ├── loadAllData() → withFallback(panels API, IDB)
   ├── loadAllWidgets() → withFallback(widgets API, IDB)
   ├── initWebSocket() → WS 连接 + 心跳（S12.3-T11 新增）
   └── setInitialized(true)
5. CanvasHome useEffect 调 useAIStore.initialize()（桌面端 CanvasHome.tsx:52 模式，S12 stub no-op）
6. 用户点击面板 → setMainView({type:'canvas-panel', panelId})
7. MainViewSync 监听 mainView 变化 → navigate(/panel/:panelId)
8. Workspace 渲染，加载 panelWidgets + strokes + connections
```

### 6.2 多端实时同步

**场景**：Web 端创建 widget → 桌面端实时收到

```
Web 端 addWidget()
  ├── withFallback(API create widget, IDB save widget, syncOp)
  │   └── API 成功 → server 入库
  └── server WS 广播 change 事件 → 所有同面板设备
       └── 桌面端 useAIStore.handleServerChange → useAppStore.refreshWidgets → 渲染新 widget
```

**反向场景**：桌面端创建 widget → Web 端实时收到
```
桌面端 addWidget() → server 入库 → WS 广播 change
  └── Web 端 useAppStore.handleWsMessage → handleServerChange → refreshWidgets → 渲染新 widget
```

**Web 端 WS 连接**（S12.3-T11）：
- WS URL：`wss://domain.com/ws?token=<JWT from sessionStorage>&deviceId=<deviceId>`
- JWT token 从 `sessionStorage['ld-jwt']` 读取（S12.3-T10 存入）
- WS 事件处理：`useAppStore.handleWsMessage`（独立于 useAIStore stub）

### 6.3 WS 客户端初始化（详见 S12.3-T11）

**问题**：桌面端 WS 在 `useAIStore.ts:188-310` 初始化。S12 useAIStore 是 stub，WS 不会初始化，多端同步全断。

**S12 方案**：在 `useAppStore.initialize()` 中独立初始化 WS（不依赖 useAIStore），新增 `handleServerChange` 方法分发到 refresh* 系列。详细实现见 S12.3-T11。

**S12 WS 事件处理范围**：
- ✅ `change`（panel/widget/stroke/connection/entity CRUD）— `useAppStore.handleServerChange` 分发到 refreshPanels/refreshWidgets/refreshAll
- ✅ `pong`（心跳响应，忽略）
- ✅ `error`（连接错误，console.error）
- ❌ `session_ready`（S13 在 useAIStore 完整实现时处理）
- ❌ `pi_event`/`tool_call`/`ask_user`/`permission_request`（S13 处理）
- ❌ `proxy_request`（S14 处理）

---

## 七、关键风险与缓解

### 7.1 技术风险

| 风险 | 概率 | 影响 | 缓解方案 |
|------|------|------|---------|
| useAppStore ↔ useAIStore 循环依赖 | 高 | 高 | S12 stub 必须保留 `setUseAppStoreRef`/`getUseAppStoreRef` 双向引用，useAppStore 行 119-128 不能破坏 |
| `api/adapter.ts` useRuntimeModeStore 订阅在 Web 端失效 | 中 | 高 | S12.3-T3 复制 useRuntimeModeStore，store 在 Web 端用 localStorage 持久化 + fetch /api/health 检测 |
| `html-to-image` 跨域 iframe taint Minimap 截图 | 高 | 中 | Minimap.tsx `toCanvas` 加 try-catch，失败 fallback 到 schematic 模式（不截图，仅画矩形） |
| pdfjs-dist worker 在 Vite 构建中路径错误 | 中 | 中 | `new URL('pdfjs-dist/build/pdf.worker.mjs', import.meta.url)` Vite 原生支持，构建时验证 |
| KaTeX CSS 加载失败 | 低 | 低 | `import 'katex/dist/katex.min.css'` Vite 原生支持 |
| `stateSchema.ts` V1 数据库不存在 | 低 | 低 | `saveCorruptedBackup` 加 try-catch，失败 console.warn 跳过 |
| `panelStatePersistence.ts` browserToolBridge 调用 | 中 | 中 | webview 部分 try-catch + 返回 null，保留 widgetStates 持久化 |
| `useApiConfigStore` Web Crypto API 兼容性 | 低 | 中 | HTTPS + 现代浏览器原生支持，fallback 到 localStorage 不加密（开发模式） |
| WS 连接在 S12 stub 阶段不工作 | 高 | 高 | S12 在 useAppStore.initialize 中独立初始化 WS（不依赖 useAIStore） |
| Minimap 截图 HtmlCanvasWidget iframe 失败 | 中 | 低 | toCanvas try-catch + fallback schematic |
| 多 panel 切换时 WS 订阅未切换 | 中 | 中 | useAppStore.setActivePanel 调用 WS `subscribe` panel（沿用桌面端逻辑） |

### 7.2 产品风险

| 风险 | 概率 | 影响 | 缓解方案 |
|------|------|------|---------|
| Web 端画布体验差（无 webview） | 中 | 中 | WebviewWidgetFallback 显示清晰提示 + "在桌面端打开"按钮 |
| AIAssistant widget 创建后无 AI 对话 | 100% | 低 | S12 范围内预期行为，widget UI 渲染正常即可，AI 对话 S13 实现 |
| 浏览器 IndexedDB 配额限制 | 低 | 低 | 单用户数据量 < 100MB，远低于浏览器配额 |

---

## 八、对抗审查检查清单（spec 自审）

### 8.1 完整性检查

- [x] 7 个画布核心组件全部覆盖（Workspace/CanvasHome/WidgetContainer/StrokesLayer/ConnectionLayer/Minimap/CanvasModeToolbar）
- [x] 8 个 widget 全部覆盖（AIAssistant/Calculator/FocusTimer/HtmlCanvasWidget/LatexQuiz/MusicPlayer/PdfViewer/Sudoku）
- [x] WebviewWidgetFallback 重写方案明确
- [x] 数据层 5 个文件覆盖（db.ts/entityMigration.ts/migration.ts/adapter.ts/iframeProxy.ts）
- [x] 6 个 store 覆盖（useAppStore/useToastStore/useRuntimeModeStore/useOnboardingStore/useApiConfigStore/useAIStore stub）
- [x] registry 4 个文件覆盖（index/builtIn/widgetDefinitions/capabilityRegistry + dataSources）
- [x] hooks 3 个文件覆盖
- [x] utils 17 个文件覆盖
- [x] 路由系统设计完整
- [x] WS 初始化方案明确（不依赖 useAIStore stub）

### 8.2 一致性检查

- [x] S12 验收标准与 roadmap v2 第三章 S12 验收标准一致
- [x] 不破坏桌面/移动端兼容（仅在 client/web/ 操作）
- [x] 不重写 v1 已有能力
- [x] TypeScript 优先（所有文件 .ts/.tsx）
- [x] 不下载到 C 盘（依赖安装到 F:\allmylife\event\client\web\node_modules\）

### 8.3 风险覆盖

- [x] 循环依赖风险已识别 + 缓解方案
- [x] useRuntimeModeStore 订阅风险已识别 + 缓解方案
- [x] html-to-image 跨域风险已识别 + 缓解方案
- [x] WS 初始化风险已识别 + 缓解方案
- [x] Web Crypto API 兼容性风险已识别 + 缓解方案

### 8.4 已确认问题（spec v2 修订后）

1. ~~S11 `POST /api/auth/login` 响应 body 是否返回 JWT token？~~ **已确认不返回**（`server/src/routes/auth.ts:30` 仅返回 `{ authenticated: true }`）。S12.3-T9 补丁 server 返回 token，S12.3-T10 Login.tsx 存 sessionStorage。

2. ~~`registry/builtIn.tsx` 的 `webPage` widget 注册行号~~ **已确认行 22**（`const LazyWebviewWidget = lazy(() => import('../components/widgets/WebviewWidget'))`）。

3. **`useApiConfigStore` Web Crypto 密钥派生**：使用 `navigator.userAgent` 作为密钥材料（不是最佳实践，但单用户场景可接受）。替代方案：登录密码派生密钥（需要 server 配合，S13 可升级）。

4. ~~`useAppStore.applyChange` 方法~~ **已确认不存在**。S12.3-T11 新增 `handleServerChange` 方法在 useAppStore 中处理 WS change 事件。

5. ~~`useAIStore` stub 接口~~ **已修正**：类型名 `useAIStoreType`（不是 `AIStoreType`），导出 `registerAppStateProvider`，`reportWidgetError` 3 参数。

6. ~~`wsToolHandlers` stub 导出~~ **已修正**：导出 `readFromLegacyTable` + `ToolCallResult`（iframeProxy.ts:15/96 实际依赖），不导出 `handleCanvasAction`/`createMessageHandler`（在 iframeProxy 自身）。

---

## 九、Phase S12 验收标准（与 roadmap v2 对齐）

### 9.1 功能验收

- [ ] Web 端打开后看到画布主页（CanvasHome），能创建/删除/重命名面板
- [ ] 8 个 widget 全部能创建 + 渲染 + 拖拽 + 缩放 + 右键菜单
- [ ] WebviewWidget 显示降级 UI（URL + "在桌面端打开"按钮）
- [ ] 笔迹层（StrokesLayer）能绘制 + 擦除
- [ ] 连线层（ConnectionLayer）能连接两个 widget
- [ ] 小地图（Minimap）实时反映画布状态
- [ ] 多面板切换正常，画布状态保持
- [ ] 刷新页面后面板 + widget 数据从 server 恢复（withFallback 走 API）
- [ ] 离线时创建 widget，恢复在线后 syncQueue 同步到 server
- [ ] 桌面端创建的 widget，Web 端通过 WS `change` 事件实时收到并渲染（多端同步）
- [ ] Web 端创建的 widget，桌面端实时收到
- [ ] 路由切换正常，刷新不 404

### 9.2 运行时验证（强制）

- [ ] `cd client/web && npm run typecheck` 零 error
- [ ] `cd client/web && npm run build` 成功生成 dist/
- [ ] `cd client/web && npm run dev` 启动成功，浏览器打开看到登录页
- [ ] 登录后跳转到 CanvasHome，看到画布主页
- [ ] 创建面板 → 创建 widget → 拖拽 → 缩放 → 右键菜单（Playwright 验证）
- [ ] 创建 WebviewWidget → 显示降级 UI（Playwright 验证）
- [ ] 绘制笔迹 → 显示在 StrokesLayer（Playwright 验证）
- [ ] 连接两个 widget → 显示连线（Playwright 验证）
- [ ] Minimap 实时反映画布状态（Playwright 截图验证）
- [ ] 桌面端 + Web 端同时打开同一面板 → Web 端创建 widget → 桌面端实时收到（多端同步验证）
- [ ] 关闭网络 → 创建 widget → 恢复网络 → syncQueue 同步到 server（离线验证）

### 9.3 代码质量验收

- [ ] TypeScript 严格模式零 error
- [ ] 无 `console.log` 残留（除 stub 注释）
- [ ] 无未使用 import
- [ ] 无 `any` 类型（除 stub 明确标注）
- [ ] 所有改造点有注释说明（如 `// S12 改造：移除 webview 分支`）

---

## 十、执行计划

### 10.1 执行顺序

```
1. S12.1-T5 复制 utils（17 个文件） — 无依赖，可并行
2. S12.1-T4 复制 hooks（3 个文件） — 无依赖，可并行
3. S12.2-T4 复制 componentCapability 类型
4. S12.3-T2 复制 db.ts（覆盖 S11 stub） + entityMigration.ts + migration.ts
5. S12.3-T3 复制 stores（6 个，含 useAIStore stub + useApiConfigStore 改造）
6. S12.3-T1 替换 api/adapter.ts（直接复制，无改造）
7. S12.3-T5 + S12.3-T6 复制 iframeProxy + 创建 wsToolHandlers stub（导出 readFromLegacyTable + ToolCallResult）
8. S12.3-T11 在 useAppStore 中新增 WS 初始化 + handleServerChange
9. S12.3-T9 修改 server/src/routes/auth.ts 返回 token
10. S12.3-T10 修改 Login.tsx + Home.tsx 处理 sessionStorage
11. S12.2-T3 复制 + 改造 registry（5 个文件，builtIn.tsx 行 22 改 WebviewWidgetFallback）
12. S12.2-T1 复制 8 widget + 3 数据文件
13. S12.2-T2 重写 WebviewWidgetFallback
14. S12.1-T1 + S12.1-T2 复制 7 画布核心 + 10 辅助组件
15. S12.1-T3 改造 App.tsx 路由 + store ref wiring
16. S12.2-T5 增补 package.json 依赖
17. npm install + typecheck
18. 修复编译错误（迭代）
19. 运行时验证（Playwright）
20. 对抗审查（含运行时验证）
21. git commit
```

### 10.2 并行策略

**Phase A（并行，2 个 sub-agent）**：
- Sub-agent 1：复制 utils + hooks + types + 画布核心组件 + 辅助组件（S12.1-T1/T2/T4/T5 + S12.2-T4）
- Sub-agent 2：复制 stores + 数据层 + WS 初始化（S12.3-T1/T2/T3/T5/T6/T11）

**Phase B（串行，依赖 Phase A）**：
- 复制 registry + widget + 重写 Fallback + 改造 App.tsx + 改造 auth.ts + Login.tsx

**Phase C（验证）**：
- npm install + typecheck + 修复错误
- Playwright 运行时验证

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

---

**Spec 完成。下一步：对抗审查 → 编码实现 → 运行时对抗审查 → git commit。**
