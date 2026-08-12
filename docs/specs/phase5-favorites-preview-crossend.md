# Phase 5 Spec：收藏组件 + 预览功能 + 动态组件跨端

> 生成日期：2026-06-24（对抗审查修订版 v2）
> 基于 [roadmap_desktop_v1.md](file:///f:/allmylife/event/docs/roadmap_desktop_v1.md) Phase 5
> 架构依据：[architecture_refactor.md](file:///f:/allmylife/event/docs/architecture_refactor.md) 第六章（动态组件跨端共享）
> 前置：Phase 4 已完成（commit `48b932a`），产品形态改造 + 架构改造 + AI 配置 + UI 图标统一已就绪

---

## 一、项目目的

Living Dashboard 桌面端是"浏览器 + 无限画布 + AI"形态的日常 AI 助手。Phase 4 已完成产品形态改造（两种主页、标签管理分离、嵌入按钮、UI 图标统一、AI 配置、按面板 session）。

**Phase 5 目标**：实现跨面板收藏组件 + 主页预览 + 动态组件跨端共享，让用户能跨面板快速访问常用组件，并在主页直接预览组件/网站内容。

---

## 二、任务总览

| 编号 | 任务 | 验收标准 | 架构文档章节 |
|------|------|----------|------------|
| T1 | 收藏组件数据模型 | favorited_widgets 表 + 客户端 store 完整 | - |
| T2 | 收藏/取消收藏 | 组件右键菜单有"收藏"按钮，可切换 | - |
| T3 | 画布主页收藏组件展示 | 画布主页显示收藏组件（跨面板） | - |
| T4 | 收藏组件预览 | 桌面端直接预览组件内容（非图标） | - |
| T5 | 点击跳转 | 点击收藏组件→跳转到对应面板的对应位置 | - |
| T6 | 收藏组件同步 | 存服务器，多端共享 | - |
| T7 | 浏览器主页网站预览 | 常用网站可直接预览 | - |
| T8 | 书签与主页快捷同源 | 主页常用网站 = 书签标记"显示在主页" | - |
| T9 | 动态组件跨端（纯前端） | dynamic_widgets 代码存服务器，两端共享渲染 | 架构文档 6.2 |
| T10 | 组件元数据扩展 | dynamic_widgets API 暴露 component_env/cross_platform/desktop_only 字段 | 架构文档 6.4 |
| T11 | 依赖本地环境组件标记 | 调本地服务的组件标记为 local-dependent，移动端显示提示 | 架构文档 6.3 方案C |

**T8 已在 Phase 4 完成**（`homeBookmarks = bookmarks.filter(b => b.showOnHome)`），Phase 5 仅验证。

**重要前提**：`server/src/db/schema.ts` L189-204 的 `DO $$` 块**已在 Phase 4 添加了 dynamic_widgets 的 4 个扩展字段**（component_env / local_services / cross_platform / desktop_only）。Phase 5 的 T10 仅需修改 API 路由暴露这些字段，**不需要改 schema**。

---

## 三、详细设计

### 3.1 T1：收藏组件数据模型

#### 3.1.1 服务器 Schema

在 `server/src/db/schema.ts` 新增 `favorited_widgets` 表（使用 TEXT 类型，与现有 schema 风格一致）：

```sql
CREATE TABLE IF NOT EXISTS favorited_widgets (
  id TEXT PRIMARY KEY,                    -- 收藏记录 ID（uuid v4）
  widget_id TEXT NOT NULL,                -- 被收藏的 widget ID
  panel_id TEXT NOT NULL,                 -- widget 所在面板 ID
  widget_type TEXT NOT NULL,              -- widget 类型（用于预览渲染）
  display_name TEXT NOT NULL,             -- 显示名称（快照）
  position_snapshot JSONB NOT NULL,       -- 位置快照 {x, y, w, h, zIndex}（不含 widgetId）
  state_snapshot JSONB NOT NULL DEFAULT '{}', -- widget state 快照（用于预览渲染）
  device_id TEXT,                         -- 收藏发起设备
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  UNIQUE (widget_id)                      -- 一个 widget 只能被收藏一次（去重约束）
);
CREATE INDEX IF NOT EXISTS idx_favorited_widgets_panel_id ON favorited_widgets(panel_id);
```

**设计决策**：
- **UNIQUE (widget_id)**：数据库层面保证一个 widget 只能被收藏一次，防止多端并发收藏产生重复。
- **state_snapshot**：收藏时保存 widget state 快照，预览时直接用快照渲染，无需加载原面板。快照在收藏时生成。
- **position_snapshot**：用于跳转时定位。跳转时优先用 live position（从 `panelPositions[panelId]` 查），找不到时回退快照。类型为 `Omit<WidgetPosition, 'widgetId'>`（不含 widgetId，因为 widgetId 已是顶层字段）。
- **ON DELETE CASCADE 不加**：favorited_widgets 不引用 panels/widgets 表的外键（panels/widgets 用 TEXT 非 FK），改为应用层联动删除（见 3.5.5）。

#### 3.1.2 客户端类型

在 `client/desktop/src/types/index.ts` 新增：

```typescript
/** 位置快照（不含 widgetId，因为 widgetId 已是 FavoriteEntry 顶层字段） */
export type PositionSnapshot = Omit<WidgetPosition, 'widgetId'>

/** 收藏组件条目 */
export interface FavoriteEntry {
  id: string                    // 收藏记录 ID
  widgetId: string              // 被收藏的 widget ID
  panelId: string               // widget 所在面板 ID
  widgetType: string            // widget 类型
  displayName: string           // 显示名称
  positionSnapshot: PositionSnapshot  // 位置快照
  stateSnapshot: Record<string, unknown>  // state 快照
  createdAt: number
}
```

#### 3.1.3 客户端 Store

在 `useAppStore.ts` 新增：

```typescript
// 状态
favorites: FavoriteEntry[]

// Actions
addFavorite: (widgetId: string) => Promise<void>
removeFavorite: (favoriteId: string) => Promise<void>
removeFavoriteByWidgetId: (widgetId: string) => Promise<void>
removeFavoritesByPanelId: (panelId: string) => Promise<void>  // 面板删除联动
isFavorited: (widgetId: string) => boolean
getFavoriteByWidgetId: (widgetId: string) => FavoriteEntry | undefined
refreshFavorites: () => Promise<void>  // 从服务器刷新
```

**addFavorite 流程**：
1. 从 `panelWidgets` + `panelPositions` 查找 widget 的 panelId、widgetType、state、position
2. 从 registry 查找 displayName
3. 生成 FavoriteEntry（id = uuid v4），position_snapshot 排除 widgetId
4. 调用 API 创建（withFallback：服务器优先，失败入 syncQueue）
5. 更新 `favorites` 数组

**removeFavorite 流程**：
1. 调用 API 删除（withFallback）
2. 从 `favorites` 数组移除

**state_snapshot 更新策略**：
- 收藏时生成快照
- 用户可通过右键菜单"刷新收藏预览"手动更新快照（调用 `addFavorite` 重新收藏，UNIQUE 约束下走 upsert 逻辑）
- 不自动同步（预览是"预览"不是"实时镜像"）

### 3.2 T2：收藏/取消收藏 UI

#### 3.2.1 WidgetContainer 右键菜单

修改 `client/desktop/src/components/WidgetContainer.tsx`：

1. **Props 新增**：
   ```typescript
   isFavorite?: boolean
   onToggleFavorite?: () => void
   ```

2. **菜单项**：在"锁定组件"项（L319-324）之后、分隔符（L325）之前插入"收藏/取消收藏"：
   ```tsx
   <div
     className="widget-context-item"
     onClick={() => { onToggleFavorite?.(); closeMenu(); }}
   >
     {isFavorite ? <StarOff size={12} /> : <Star size={12} />}
     {isFavorite ? '取消收藏' : '收藏'}
   </div>
   ```

3. **图标**：从 `lucide-react` 导入 `Star`（收藏）和 `StarOff`（取消收藏）

4. **isPrimary widget 也可收藏**：AIAssistant 等主组件也能被收藏

#### 3.2.2 Workspace 传参

修改 `client/desktop/src/components/Workspace.tsx` 渲染 WidgetContainer 处：
- 传入 `isFavorite={useAppStore.getState().getFavoriteByWidgetId(widget.widgetId) !== undefined}`

**注意**：为避免性能问题，Workspace 组件订阅 `favorites` 数组（`useAppStore(s => s.favorites)`），在渲染时通过 `favorites.find(f => f.widgetId === widget.widgetId)` 判断。由于 favorites 数组通常较小（< 50），find 操作开销可忽略。

- 传入 `onToggleFavorite={() => handleToggleFavorite(widget.widgetId)}`

**handleToggleFavorite 逻辑**：
```typescript
const handleToggleFavorite = async (widgetId: string) => {
  const existing = useAppStore.getState().getFavoriteByWidgetId(widgetId)
  if (existing) {
    await removeFavorite(existing.id)
  } else {
    await addFavorite(widgetId)
  }
}
```

### 3.3 T3 + T4：画布主页收藏组件展示 + 预览

#### 3.3.1 修改 CanvasHome.tsx

**当前问题**：CanvasHome 显示的是当前面板的 widgets（`currentWidgets`），不是收藏组件。

**改造**：
1. 订阅 `favorites` 数组（`useAppStore(s => s.favorites)`）
2. 替换"收藏组件"网格数据源：`currentWidgets` → `favorites`
3. 每个收藏组件卡片显示**预览**（非图标）
4. **最多渲染 8 个实际组件预览**，超过的显示图标形式（性能控制）

#### 3.3.2 收藏组件预览组件

新建 `client/desktop/src/components/FavoriteWidgetPreview.tsx`：

```typescript
interface FavoriteWidgetPreviewProps {
  favorite: FavoriteEntry
  onClick: () => void  // 点击跳转
}
```

**预览渲染策略**（按 widgetType 分发）：

| widgetType | 预览方式 |
|------------|---------|
| calculator, focusTimer, sudoku, latexQuiz, musicPlayer | 渲染实际组件（`config.component`），传入 `stateSnapshot`，`pointer-events: none`，`transform: scale()` 缩放 |
| htmlCanvas | 渲染 iframe srcdoc（复用 HtmlCanvasWidget 的 wrapAgentHtml，sandbox="allow-scripts"，但只读模式，不注入 canvasStorage token） |
| aiAssistant | 显示最近消息摘要 + AI 图标（不渲染完整组件，避免 session 冲突） |
| webPage | 显示 URL + 标题卡片 + 网页图标（不渲染 live webview，太重） |
| pdfViewer | 显示 PDF 文件名 + 页数（不渲染 PDF，太重） |
| 未知类型 | 显示 displayName + 图标 |

**预览容器样式**：
```css
.favorite-preview-card {
  width: 160px;
  height: 120px;
  border-radius: 8px;
  overflow: hidden;
  position: relative;
  cursor: pointer;
}
.favorite-preview-card__content {
  position: absolute;
  top: 0;
  left: 0;
  width: VAR(--original-w);  /* 原始 widget 宽度（从 positionSnapshot.w） */
  height: VAR(--original-h); /* 原始 widget 高度（从 positionSnapshot.h） */
  transform: scale(calc(160 / VAR(--original-w)), calc(120 / VAR(--original-h)));
  transform-origin: top left;
  pointer-events: none;
}
.favorite-preview-card__label {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  background: rgba(0,0,0,0.6);
  color: white;
  font-size: 11px;
  padding: 2px 6px;
}
```

**关键决策**：
- 预览用 `stateSnapshot` 渲染，不与原 widget 共享 state
- `pointer-events: none` 确保预览不响应交互
- `onUpdateState` 传入 NOOP 函数 `() => {}`（预览不写回状态）
- `transform: scale()` 将原尺寸 widget 缩放到预览卡片大小
- 底部 label 显示 displayName
- **最多 8 个实际组件预览**（性能控制），第 9+ 个显示图标形式

### 3.4 T5：点击跳转

**跳转流程**（在 CanvasHome 中点击收藏组件）：

```typescript
const handleFavoriteClick = async (favorite: FavoriteEntry) => {
  // 1. 切换主视图到画布
  setMainView({ type: 'canvas-panel', panelId: favorite.panelId })
  // 2. 切换活跃面板（异步，会恢复该面板的 canvasTransform）
  await setActivePanel(favorite.panelId)
  // 3. 查找 live position（优先），找不到用 snapshot
  const livePos = useAppStore.getState().panelPositions[favorite.panelId]
    ?.find(p => p.widgetId === favorite.widgetId)
  const pos = livePos
    ? { x: livePos.x, y: livePos.y, w: livePos.w, h: livePos.h }
    : favorite.positionSnapshot
  // 4. 跳转到 widget 中心位置（必须在 setActivePanel 之后）
  teleportTo(pos.x + pos.w / 2, pos.y + pos.h / 2)
}
```

**关键点**：
- `setActivePanel` 是异步的，会从 sessionStorage 恢复面板的 canvasTransform
- `teleportTo` 必须在 `setActivePanel` 完成**之后**调用，否则会被 transform 恢复覆盖
- 如果 widget 已被删除（live position 找不到），用 snapshot 跳转（跳到大致位置）
- **Phase 6 内存休眠影响**：Phase 6 后面板 positions 可能不在内存中，此时用 snapshot 跳转。Phase 5 不处理此情况，预留 snapshot 作为 fallback。

### 3.5 T6：收藏组件同步

#### 3.5.1 服务器 API

新建 `server/src/routes/favorites.ts`：

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/favorites` | 获取所有收藏 |
| POST | `/api/favorites` | 添加收藏（UNIQUE 约束下，重复收藏走 upsert） |
| DELETE | `/api/favorites/:id` | 删除收藏 |
| DELETE | `/api/favorites/by-widget/:widgetId` | 按 widgetId 删除（widget 删除时联动） |
| DELETE | `/api/favorites/by-panel/:panelId` | 按 panelId 删除（面板删除时联动） |

**广播**：添加/删除收藏时广播 WS 事件 `favorite_added` / `favorite_removed` / `favorite_panel_cleared`。

#### 3.5.2 WS ChangeEvent 类型更新

**修改 `server/src/ws.ts`**：在 `ChangeEvent` 联合类型（L30-49）新增：

```typescript
export type ChangeEvent =
  | ...（现有类型）
  | { kind: 'favorite_added'; data: unknown }
  | { kind: 'favorite_removed'; data: unknown }
  | { kind: 'favorite_panel_cleared'; data: { panelId: string } }
  | { kind: 'dynamic_widget_updated'; data: unknown }  // T10 新增
```

#### 3.5.3 客户端 API

新建 `client/desktop/src/api/favorites.ts`：

```typescript
export interface FavoriteDTO {
  id: string
  widgetId: string
  panelId: string
  widgetType: string
  displayName: string
  positionSnapshot: PositionSnapshot
  stateSnapshot: Record<string, unknown>
  createdAt: number
}

export async function getAllFavorites(): Promise<FavoriteDTO[]>
export async function createFavorite(data: Omit<FavoriteDTO, 'id' | 'createdAt'>): Promise<FavoriteDTO>
export async function deleteFavorite(id: string): Promise<void>
export async function deleteFavoriteByWidgetId(widgetId: string): Promise<void>
export async function deleteFavoritesByPanelId(panelId: string): Promise<void>
```

#### 3.5.4 客户端 IDB Store（withFallback）

新建 `client/desktop/src/utils/dbStores/favorites.ts`：

使用 withFallback 模式（与 kvStorage 相同的双写策略）：
- API 模式：调用服务器 API
- IDB 模式：写入 IDB `favorites` store + 入队 syncQueue
- 提供 `getAllFavoritesFromIdb` / `saveFavoriteToIdb` / `deleteFavoriteFromIdb` 等 IDB 操作函数

#### 3.5.5 客户端 WS 消息处理

**修改 `client/desktop/src/stores/useAIStore.ts`** 的 `handleServerChange` 函数（L527）：

在 switch 语句中新增：
```typescript
case 'favorite_added':
case 'favorite_removed':
case 'favorite_panel_cleared':
  void (getUseAppStore().getState() as { refreshFavorites?: () => Promise<void> }).refreshFavorites?.()
  break
```

**注意**：WS 消息处理在 `useAIStore.ts`（不在 `useAppStore.ts`），通过 `getUseAppStore().getState()` 调用 useAppStore 的方法。

#### 3.5.6 删除联动

**Widget 删除联动**（修改 `useAppStore.ts` 的 `removeWidget`）：
```typescript
// 在 removeWidget 成功后
const fav = getFavoriteByWidgetId(widgetId)
if (fav) {
  await removeFavorite(fav.id)
}
```

**面板删除联动**（修改 `useAppStore.ts` 的 `deletePanel`）：
```typescript
// 在 deletePanel 成功后
await removeFavoritesByPanelId(panelId)
```

### 3.6 T7：浏览器主页网站预览

#### 3.6.1 修改 BrowserHome.tsx

**当前状态**：常用网站网格只显示 Globe 图标。

**改造**：
1. 新增"预览模式"切换按钮（图标模式 / 预览模式）
2. 预览模式下，每个常用网站卡片显示**缩略图预览**

#### 3.6.2 预览实现

**方案**：使用 `<webview>` 标签渲染缩略图

新建 `client/desktop/src/components/SitePreview.tsx`：

```typescript
interface SitePreviewProps {
  url: string
  title: string
  onClick: () => void
}
```

**渲染**：
- 使用 `<webview>` 标签，`partition="persist:preview"`（所有预览共享一个 partition，减少内存）
- **共享 partition 风险说明**：多个预览共享 cookie/session，某些网站登录态可能串扰。预览场景下可接受（预览不用于登录操作），且用户可切换到图标模式。
- `pointer-events: none`（预览不响应交互）
- `transform: scale()` 缩放到卡片大小
- 加载完成后自动停止（`did-finish-load` → `webview.stop()`）减少资源占用
- **限制预览数量**：最多 6 个 live webview（前 6 个 homeBookmarks），超过的显示图标
- **内存估算**：每个 webview 约 50-100MB，6 个约 300-600MB，可接受

**预览卡片样式**：
```css
.site-preview-card {
  width: 160px;
  height: 120px;
  position: relative;
  overflow: hidden;
  border-radius: 8px;
  cursor: pointer;
}
.site-preview-card__webview {
  width: 800px;   /* 原始宽度 */
  height: 600px;  /* 原始高度 */
  transform: scale(0.2);  /* 800*0.2=160, 600*0.2=120 */
  transform-origin: top left;
  pointer-events: none;
}
```

**内存控制**：
- 预览模式下最多 6 个 live webview（前 6 个 homeBookmarks）
- 超过 6 个的网站显示图标
- 切换到图标模式时卸载所有预览 webview
- 组件卸载时清理 webview（`webview.remove()` / `webview.destroy()`）

#### 3.6.3 预览模式切换

```typescript
const [previewMode, setPreviewMode] = useState(false)
```

- 默认 `false`（图标模式，与当前行为一致）
- 点击切换按钮切换到 `true`（预览模式）
- 预览模式显示 webview 缩略图
- 图标模式显示 Globe 图标（当前行为）

### 3.7 T8：书签与主页快捷同源

**已在 Phase 4 完成**：
- `homeBookmarks = bookmarks.filter(b => b.showOnHome)`
- `toggleBookmarkHome` 切换 `showOnHome`
- `addBookmark` 默认 `showOnHome: true`

**Phase 5 验证**：确认功能正常，无需额外开发。

### 3.8 T9 + T10 + T11：动态组件跨端 + 元数据扩展 + 本地依赖标记

#### 3.8.1 服务器 API 更新（T10）

**前提**：`server/src/db/schema.ts` L189-204 已在 Phase 4 添加了 dynamic_widgets 的 4 个扩展字段。Phase 5 仅需修改 API 路由。

修改 `server/src/routes/dynamicWidgets.ts`：

1. **GET 响应**（L12-21）：新增 4 个字段
   ```typescript
   componentEnv: r.component_env,
   localServices: r.local_services,
   crossPlatform: r.cross_platform,
   desktopOnly: r.desktop_only,
   ```

2. **POST 请求**（L30-42）：INSERT 新增 4 个字段
   ```sql
   INSERT INTO dynamic_widgets (widget_type, display_name, icon, default_layout, default_state, code,
     component_env, local_services, cross_platform, desktop_only, created_at, updated_at)
   VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
   ```
   - `componentEnv` 默认 `'pure-frontend'`
   - `localServices` 默认 `null`
   - `crossPlatform` 默认 `true`
   - `desktopOnly` 默认 `false`

3. **新增 PUT 端点**：`PUT /api/dynamic-widgets/:widgetType` 更新元数据
   ```typescript
   dynamicWidgetsRouter.put('/:widgetType', async (req, res, next) => {
     // 更新 component_env, local_services, cross_platform, desktop_only, display_name, code
     // 广播 dynamic_widget_updated
   })
   ```

4. **GET 支持 `?desktop=false` 查询参数**（T11 移动端过滤）：
   ```typescript
   const desktopOnly = req.query.desktop
   let query = 'SELECT * FROM dynamic_widgets ORDER BY created_at'
   if (desktopOnly === 'false') {
     query = 'SELECT * FROM dynamic_widgets WHERE desktop_only = FALSE ORDER BY created_at'
   }
   ```

#### 3.8.2 客户端 DTO 更新（T10）

修改 `client/desktop/src/api/dynamicWidgets.ts`：

```typescript
export interface DynamicWidgetDTO {
  widgetType: string
  displayName: string
  icon: string
  defaultLayout: Record<string, unknown>
  defaultState: Record<string, unknown>
  code: string
  // Phase 5 新增字段（schema 已就绪，API 补齐）
  componentEnv: 'pure-frontend' | 'local-dependent'
  localServices?: string[]
  crossPlatform: boolean
  desktopOnly: boolean
  createdAt: number
  updatedAt: number
}

// 新增 update 函数
export async function updateDynamicWidget(
  widgetType: string,
  data: Partial<Pick<DynamicWidgetDTO, 'componentEnv' | 'localServices' | 'crossPlatform' | 'desktopOnly' | 'displayName' | 'code'>>
): Promise<DynamicWidgetDTO>
```

#### 3.8.3 动态组件跨端渲染（T9）

**现状分析**（对抗审查修正）：
- `dynamic_widgets` 表已存储组件代码（`code` 字段）—— 但这是**组件模板定义**，不是实例数据
- `HtmlCanvasWidget.tsx` L65 直接从 `state.html` 读取 HTML 内容—— **未调用 htmlWidgets store**
- `htmlWidgets.ts` 已使用 withFallback + entitiesApi—— 但 **HtmlCanvasWidget 没有调用它**
- canvasStorage 协议已实现（iframeProxy.ts）—— 通过 kvStorage + withFallback 实现服务器同步

**Phase 5 改造**：

1. **HtmlCanvasWidget 加载改造**：加载时优先从 `htmlWidgets` store 获取 HTML 内容（withFallback），而非直接用 `state.html`
   ```typescript
   // 改造前：const html = typeof state.html === 'string' ? state.html : ''
   // 改造后：
   const htmlWidgetId = state.htmlWidgetId as string | undefined
   const [html, setHtml] = useState(typeof state.html === 'string' ? state.html : '')
   useEffect(() => {
     if (htmlWidgetId) {
       getHtmlWidget(htmlWidgetId).then(data => {
         if (data?.html) setHtml(data.html)
       }).catch(console.error)
     }
   }, [htmlWidgetId])
   ```

2. **HtmlCanvasWidget 编辑改造**：编辑时调用 `updateHtmlWidget` 同步到服务器
   ```typescript
   // 编辑保存时
   if (htmlWidgetId) {
     await updateHtmlWidget(htmlWidgetId, { html: newHtml })
   }
   ```

3. **canvasStorage 协议**：无需改动（已通过 kvStorage + withFallback 实现服务器同步）

4. **移动端获取**：移动端通过 `GET /api/dynamic-widgets?desktop=false` 获取可跨端组件，通过 `GET /api/entities?type=htmlWidget` 获取 HTML 内容，用 WebView loadDataWithBaseURL 渲染

#### 3.8.4 依赖本地环境组件标记（T11）

**方案 C 实现**（架构文档 6.3 方案 C）：

1. **UI 标记入口**：在 HTML widget 编辑器中新增"组件环境"选项：
   - 纯前端组件（`pure-frontend`，默认）
   - 依赖本地环境（`local-dependent`）

2. **标记存储**：当用户选择"依赖本地环境"时：
   - `componentEnv = 'local-dependent'`
   - `desktopOnly = true`
   - `crossPlatform = false`
   - 调用 `updateDynamicWidget(widgetType, { componentEnv, desktopOnly, crossPlatform })`

3. **移动端过滤**：服务器 GET `/api/dynamic-widgets?desktop=false` 只返回 `desktop_only = FALSE` 的组件（见 3.8.1 第 4 点）

4. **移动端提示**：移动端遇到 `desktop_only = true` 的组件时，显示"此组件依赖桌面端环境"提示（移动端实现，桌面端 Phase 5 仅提供数据支持）

5. **桌面端 UI**：在 AddWidgetMenu 中，显示组件的 `componentEnv` 标签（"纯前端" / "仅桌面端"），让用户知道组件的跨端能力

---

## 四、文件变更清单

### 4.1 新增文件

| 文件 | 说明 |
|------|------|
| `server/src/routes/favorites.ts` | 收藏组件 API 路由 |
| `client/desktop/src/api/favorites.ts` | 收藏组件客户端 API |
| `client/desktop/src/components/FavoriteWidgetPreview.tsx` | 收藏组件预览组件 |
| `client/desktop/src/components/SitePreview.tsx` | 网站预览组件 |
| `client/desktop/src/utils/dbStores/favorites.ts` | 收藏组件 IDB store（withFallback） |

### 4.2 修改文件

| 文件 | 变更 |
|------|------|
| `server/src/db/schema.ts` | 新增 favorited_widgets 表（dynamic_widgets 字段已在 Phase 4 添加，不改） |
| `server/src/index.ts` | 注册 favoritesRouter |
| `server/src/ws.ts` | ChangeEvent 新增 favorite_added/favorite_removed/favorite_panel_cleared/dynamic_widget_updated |
| `server/src/routes/dynamicWidgets.ts` | GET/POST 加 4 字段 + ?desktop=false 过滤，新增 PUT 端点 |
| `client/desktop/src/types/index.ts` | 新增 FavoriteEntry / PositionSnapshot 类型 |
| `client/desktop/src/stores/useAppStore.ts` | 新增 favorites 状态 + actions + deletePanel/removeWidget 联动 |
| `client/desktop/src/stores/useAIStore.ts` | handleServerChange 新增 favorite_* 事件处理 |
| `client/desktop/src/components/WidgetContainer.tsx` | 右键菜单加"收藏"项 |
| `client/desktop/src/components/Workspace.tsx` | 传 isFavorite/onToggleFavorite props |
| `client/desktop/src/components/CanvasHome.tsx` | 收藏组件网格替换为 favorites + 预览 |
| `client/desktop/src/components/BrowserHome.tsx` | 新增预览模式切换 + SitePreview |
| `client/desktop/src/api/dynamicWidgets.ts` | DTO 加 4 字段 + updateDynamicWidget |
| `client/desktop/src/components/AddWidgetMenu.tsx` | 显示 componentEnv 标签 |
| `client/desktop/src/components/widgets/HtmlCanvasWidget.tsx` | 加载/编辑时调用 htmlWidgets store（withFallback） |

---

## 五、验收标准

### 5.1 功能验收

- [ ] 可收藏/取消收藏组件（右键菜单）
- [ ] 画布主页显示收藏组件（跨面板）
- [ ] 收藏组件可直接预览内容（非图标）
- [ ] 点击收藏组件跳转到对应面板+位置
- [ ] 收藏组件存服务器，多端同步（WS 广播）
- [ ] widget 删除时联动删除收藏
- [ ] **面板删除时联动删除该面板下所有收藏**
- [ ] 浏览器主页可预览网站（预览模式）
- [ ] 书签与主页快捷同源（Phase 4 已实现，验证）
- [ ] dynamic_widgets API 支持 4 个新字段
- [ ] HTML widget 可标记为"依赖本地环境"
- [ ] 服务器 GET /api/dynamic-widgets 支持 ?desktop=false 过滤
- [ ] HtmlCanvasWidget 加载/编辑通过 htmlWidgets store 同步服务器

### 5.2 运行时验证

- [ ] 桌面端启动无报错
- [ ] 收藏组件后刷新页面，收藏仍在
- [ ] 多端（模拟）收藏同步
- [ ] 预览模式不导致内存溢出（6 个 webview 预览稳定运行）
- [ ] 跳转功能定位准确
- [ ] 面板删除后收藏列表无残留
- [ ] widget 删除后收藏列表无残留
- [ ] TypeScript 编译无错误

### 5.3 代码质量

- [ ] 无 console.error（预期之外的）
- [ ] withFallback 模式正确使用
- [ ] WS 广播事件正确处理
- [ ] UNIQUE 约束生效（重复收藏不报错，走 upsert）

---

## 六、约束条件

| 约束 | 说明 |
|------|------|
| TypeScript 优先 | 桌面端用 TypeScript |
| 不下载到 C 盘 | 开发工具/缓存配置到非 C 盘 |
| git 版本管理 | 所有变更走 git commit |
| 不改 Phase 0-3 spec | Phase 0-3 已完成 |
| 与移动端数据互通 | 共享服务器数据库 |
| 不引入新依赖 | 复用现有 lucide-react / webview 等 |

---

## 七、实现顺序

1. **T1 数据模型**：服务器 schema + API + 客户端 API + store + IDB store
2. **T2 收藏 UI**：WidgetContainer 菜单 + Workspace 传参
3. **T3+T4 主页展示+预览**：CanvasHome 改造 + FavoriteWidgetPreview
4. **T5 跳转**：CanvasHome 点击跳转逻辑
5. **T6 同步**：WS 广播 + withFallback + 删除联动（widget + 面板）
6. **T7 网站预览**：BrowserHome 预览模式 + SitePreview
7. **T8 验证**：书签同源验证
8. **T9+T10+T11 动态组件**：API 更新 + DTO + HtmlCanvasWidget 改造 + 标记 UI + 过滤

---

## 八、对抗审查修订记录

### v2 修订（2026-06-24）

**修复的 Critical 问题**：
- C1：明确 dynamic_widgets 的 4 个字段已在 Phase 4 添加，Phase 5 仅改 API
- C2：新增 ws.ts ChangeEvent 类型更新 + useAIStore.ts handleServerChange 修改
- C3：新增面板删除联动（removeFavoritesByPanelId + DELETE /api/favorites/by-panel/:panelId）
- C4：修正 HtmlCanvasWidget 改造描述（从"已实现"改为"需改造"，明确加载/编辑时调用 htmlWidgets store）
- C5：补全文件变更清单（ws.ts、useAIStore.ts）

**修复的 Major 问题**：
- M1：schema 改用 TEXT 类型（与现有风格一致）
- M2：明确"schema 已就绪，API 需补齐"
- M3：WS 消息处理位置改为 useAIStore.ts（正确位置）
- M4：说明共享 partition 的风险（cookie 串扰，预览场景可接受）
- M5：收藏组件预览限制最多 8 个实际组件
- M6：state_snapshot 更新策略（手动刷新，右键菜单"刷新收藏预览"）
- M7：positionSnapshot 类型改为 Omit<WidgetPosition, 'widgetId'>
- M8：schema 加 UNIQUE (widget_id) 约束
- M9：验收标准新增面板删除联动
