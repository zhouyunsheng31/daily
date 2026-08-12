# SPEC: 面板持久运行 + 网页全屏功能

## 需求背景

### 问题 1：面板切换导致后台活动停止
当前 `Workspace.tsx` 仅渲染 `activePanelId` 对应的面板组件。切换面板时，旧面板的所有 React 组件（包括 `MusicPlayer` 的 `<audio>` 元素）被卸载，导致：
- 音乐播放中断
- 计时器/倒计时等持续性组件状态丢失
- 任何需要后台运行的功能都无法跨面板保持

用户期望：不同面板像浏览器标签页一样，切换后仍保持运行状态。

### 问题 2：缺少全屏功能
网页运行在浏览器中，被浏览器边框约束，用户希望能进入全屏模式以获得沉浸体验。

---

## 技术方案

### 方案 1：面板持久运行

**核心思路**：将"只渲染活跃面板"改为"渲染所有面板，用 CSS 隐藏非活跃面板"。

#### 1.1 修改 `Workspace.tsx` 的渲染逻辑

当前代码（约第 959 行）：
```tsx
const widgets = panelWidgets[activePanelId!] ?? []
```
仅渲染活跃面板的组件。

**改为**：遍历所有面板，每个面板渲染一个独立的 `.panel-layer` 容器，非活跃面板用 CSS 隐藏：
- `visibility: hidden` — 保持 DOM 存活（包括 `<audio>` 元素），浏览器不会重绘
- `pointer-events: none` — 阻止交互
- `position: absolute; inset: 0` — 所有面板层叠在同一位置

活跃面板：
- `visibility: visible`
- `pointer-events: auto`

#### 1.2 每个面板独立的 canvas transform

- 活跃面板：使用全局 `canvasTransform`（实时交互用）
- 非活跃面板：使用其保存的 `canvasTransform`（从 `panels` 数组中读取 `panel.canvasTransform`）
- `setActivePanel` 已实现保存/恢复逻辑，无需修改

#### 1.3 修复 Store 中 `activePanelId` 硬编码问题（关键）

**问题**：`useAppStore` 中的多个方法硬编码使用 `activePanelId` 来定位 widget。当非活跃面板的组件调用这些方法时（如 MusicPlayer 在后台播放时调用 `onUpdateState`），会在错误的面板中查找 widget，导致更新丢失。

**解决方案**：添加辅助函数 `findPanelIdForWidget`，在 store 方法中优先使用它定位 widget 所属面板：

```typescript
function findPanelIdForWidget(widgetId: string, panelWidgets: Record<string, WidgetInstance[]>): string | null {
  for (const [panelId, widgets] of Object.entries(panelWidgets)) {
    if (widgets.some(w => w.widgetId === widgetId)) {
      return panelId
    }
  }
  return null
}
```

**需要修改的方法**（8 个）：
1. `updateWidgetState` — 用 `findPanelIdForWidget` 替代 `activePanelId`
2. `updateWidgetPosition` — 同上
3. `bringToFront` — 同上
4. `toggleMinimize` — 同上
5. `toggleLock` — 同上
6. `changeLayer` — 同上
7. `updateWidgetColorScheme` — 同上
8. `removeWidget` — 同上，**注意** `removeWidget` 中 `connections[activePanelId]` 也要改为 `connections[panelId]`

**不修改的方法**（仅活跃面板调用，无需改动）：
- `updatePositions` — 接收 positions 数组，不含 widgetId 映射
- `batchUpdateWidgetColorScheme` — 批量操作，仅框选时调用
- `addWidget` — 已支持 `options.panelId`
- `moveSelectedWidgets` — 仅活跃面板的框选拖拽调用

**AI 工具文件**：`src/ai/tools/widgetTools.ts`、`connectionTools.ts`、`contextBuilder.ts` 中大量使用 `activePanelId`，但 AI 工具只操作活跃面板（AI 上下文仅包含活跃面板信息），无需修改。在 SPEC 的"不涉及"范围内。

#### 1.4 非活跃面板的笔迹和连线

- `StrokesLayer` 和 `ConnectionLayer` 接收 `panelId` prop，可以正常渲染任何面板的数据
- 非活跃面板的笔迹/连线数据可能尚未加载，此时渲染空内容即可
- 切换到该面板时 `setActivePanel` 会触发加载

#### 1.5 草稿笔迹层、连线预览、框选矩形

这些交互元素**仅渲染在活跃面板的 canvas-container 内**：
- `<StrokesLayer panelId={activePanelId!} mode="draft" draftStroke={draftStroke} />` — 仅活跃面板
- `connectingVisual` 连线拖拽预览 — 仅活跃面板
- `boxSelection` 框选矩形 — 仅活跃面板

非活跃面板不渲染这些交互元素。

#### 1.6 非活跃面板的 WidgetContainer 回调处理（关键）

**问题**：`WidgetContainer` 的 Props 中 `onMove`、`onResize`、`onScale`、`onClose`、`onToggleMinimize`、`onBringToFront`、`onToggleLock`、`onChangeLayer`、`onUpdateColorScheme` 都是**必选参数**（无 `?`），传入 `undefined` 会导致 TypeScript 编译错误。`useDraggable`/`useResizable` 也要求 `onMove`/`onResize` 为必选。

**解决方案**：非活跃面板传入**空函数**（no-op），而非 `undefined`。使用 `as any` 绕过 TypeScript 类型检查（因为修改 Props 接口使回调可选会影响所有调用方，代价过大）：

```typescript
const NOOP = () => {}
```

非活跃面板的 WidgetContainer props：
- `onMove={NOOP as any}` — 空函数，拖拽无效果
- `onResize={NOOP as any}` — 空函数
- `onScale={NOOP as any}` — 空函数
- `onClose={NOOP}` — 空函数
- `onToggleMinimize={NOOP}` — 空函数
- `onBringToFront={NOOP}` — 空函数，注意 `handleEditingChange` 中会调用 `onBringToFront()`，空函数不会报错
- `onToggleLock={NOOP}` — 空函数
- `onChangeLayer={NOOP as any}` — 空函数
- `onUpdateColorScheme={NOOP as any}` — 空函数
- `onUpdateState={(partial) => useAppStore.getState().updateWidgetState(widget.widgetId, partial)}` — **必须保留**，这是后台组件更新状态的通道
- `selected={false}` — 非活跃面板的组件始终不选中
- `onDragSelected={undefined}` — 此参数本身是可选的（`onDragSelected?`）

#### 1.7 空面板提示逻辑

- 非活跃面板如果 widget 列表为空，**不渲染**空面板提示（被 `visibility: hidden` 隐藏，渲染无意义的 DOM 浪费资源）
- 活跃面板如果 widget 列表为空，渲染空面板提示（同现有逻辑）
- 当所有面板被删除时（`panel` 为 `null`），保留现有的全屏空状态提示

#### 1.8 性能考虑

- `visibility: hidden` 的元素不会被重绘
- `.workspace-widgets-area` 已有 `position: relative`（index.css 第 639 行），`.panel-layer` 的 `position: absolute; inset: 0` 会正确相对于它定位
- React 仍会为非活跃面板执行 reconciliation，但 `visibility: hidden` 下浏览器跳过 paint
- 初期不做虚拟化优化

#### 1.9 需要修改的文件

1. **`src/components/Workspace.tsx`** — 主要修改点
2. **`src/stores/useAppStore.ts`** — 添加 `findPanelIdForWidget`，修改 8 个方法
3. **`src/index.css`** — 添加 `.panel-layer` 样式

### 方案 2：网页全屏功能

#### 2.1 实现方式

- 在 `UnifiedToolbar` 设置按钮前添加全屏切换按钮
- 使用 `document.documentElement.requestFullscreen()` 进入全屏
- 使用 `document.exitFullscreen()` 退出全屏
- 监听 `fullscreenchange` 事件同步按钮状态
- `requestFullscreen` 需要 `.catch(() => {})` 处理可能的异常（用户拒绝、iframe 限制等）
- F11 是浏览器默认全屏快捷键，无需额外处理
- 移动端不支持 Fullscreen API 时按钮隐藏或禁用

#### 2.2 UI 细节

- 图标：使用 `Maximize2`（进入全屏）和 `Minimize2`（退出全屏），来自 lucide-react
- 图标大小：14x14，与其他工具栏按钮一致
- 无文字标签（工具栏空间有限）
- 按钮样式：与现有工具栏按钮一致（`unified-toolbar-btn` class）
- 位置：设置按钮之前，中间有分隔符

#### 2.3 需要修改的文件

1. **`src/components/UnifiedToolbar.tsx`** — 添加全屏按钮

---

## 详细实现步骤

### Step 1: 修改 useAppStore.ts — 添加 findPanelIdForWidget 并修复硬编码

1. 在 store 文件顶部（`AppState` 接口之前）添加辅助函数：
```typescript
function findPanelIdForWidget(widgetId: string, panelWidgets: Record<string, WidgetInstance[]>): string | null {
  for (const [panelId, widgets] of Object.entries(panelWidgets)) {
    if (widgets.some(w => w.widgetId === widgetId)) {
      return panelId
    }
  }
  return null
}
```

2. 修改以下 8 个方法，将 `activePanelId` 替换为 `findPanelIdForWidget` 的结果：
   - 每个方法开头：`const panelId = findPanelIdForWidget(widgetId, get().panelWidgets); if (!panelId) return`
   - **注意**：当 `findPanelIdForWidget` 返回 `null` 时直接 `return`，不 fallback 到 `activePanelId`，避免已删除 widget 的状态更新污染活跃面板数据
   - 后续**所有** `activePanelId` 替换为 `panelId`，包括：
     - 数据访问：`panelWidgets[panelId]`、`panelPositions[panelId]`、`connections[panelId]`
     - 持久化调用：`debouncedWidgetStateSave.call(panelId, ...)`、`debouncedPositionSave.call(panelId, ...)`
     - `withFallback` 中的 fallback 函数：`saveWidgets(panelId, ...)`、`savePositions(panelId, ...)`
     - `set()` 中的 key：`{ ...panelWidgets, [panelId]: updatedWidgets }`
   - **`removeWidget` 特别注意**：
     - `connections[activePanelId]` → `connections[panelId]`
     - `dbDeleteConnectionsByWidget(activePanelId, widgetId)` → `dbDeleteConnectionsByWidget(panelId, widgetId)`
     - `saveWidgets(activePanelId, ...)` → `saveWidgets(panelId, ...)`
     - `savePositions(activePanelId, ...)` → `savePositions(panelId, ...)`
     - `set()` 中 `[activePanelId]: updatedWidgets` → `[panelId]: updatedWidgets`

### Step 2: 修改 Workspace.tsx — 多面板持久渲染

1. 在文件顶部定义 no-op 函数：
```typescript
const NOOP = () => {}
```

2. 将当前的单面板渲染逻辑重构为遍历所有面板

3. 核心渲染结构：
```tsx
{panels.map(panel => {
  const isActive = panel.id === activePanelId
  const panelWidgetList = panelWidgets[panel.id] ?? []
  const panelPositionList = panelPositions[panel.id] ?? []
  const panelTransform = isActive ? canvasTransform : (panel.canvasTransform ?? { x: 0, y: 0, zoom: 1 })

  return (
    <div
      key={panel.id}
      className={`panel-layer ${isActive ? 'panel-layer--active' : 'panel-layer--hidden'}`}
    >
      <div
        className="canvas-container"
        style={{
          transform: `translate(${panelTransform.x}px, ${panelTransform.y}px) scale(${panelTransform.zoom})`,
          transformOrigin: '0 0',
        }}
      >
        {/* 笔迹层 */}
        <StrokesLayer panelId={panel.id} mode="committed" />
        {/* 连线层 */}
        <ConnectionLayer panelId={panel.id} />
        {/* 组件层 */}
        {isActive && panelWidgetList.length === 0 ? (
          <div className="workspace-empty" style={{ pointerEvents: 'none' }}>
            <div className="workspace-empty-icon">⊕</div>
            <p className="workspace-empty-text">点击右下角 + 添加组件</p>
          </div>
        ) : (
          panelWidgetList.map(widget => {
            const pos = panelPositionList.find(p => p.widgetId === widget.widgetId)
            if (!pos) return null
            const sanitizedState = sanitizeWidgetState(widget.widgetType, widget.state)
            return (
              <WidgetErrorBoundary
                key={`${widget.widgetId}-${errorKeys[widget.widgetId] ?? 0}`}
                widgetType={widget.widgetType}
                widgetId={widget.widgetId}
                onRetry={() => setErrorKeys(prev => ({ ...prev, [widget.widgetId]: (prev[widget.widgetId] ?? 0) + 1 }))}
              >
                <WidgetContainer
                  key={widget.widgetId}
                  id={widget.widgetId}
                  type={widget.widgetType}
                  x={pos.x}
                  y={pos.y}
                  width={pos.w}
                  height={pos.h}
                  minimized={widget.minimized}
                  locked={widget.locked}
                  selected={isActive && selectedWidgetIds.has(widget.widgetId)}
                  widgetState={sanitizedState}
                  onMove={isActive ? (dx, dy) => {
                    const zoom = canvasTransform.zoom
                    updateWidgetPosition(widget.widgetId, { x: pos.x + dx / zoom, y: pos.y + dy / zoom })
                  } : NOOP as any}
                  onResize={isActive ? (dw, dh, dx) => {
                    const zoom = canvasTransform.zoom
                    updateWidgetPosition(widget.widgetId, {
                      ...(dx ? { x: pos.x + dx / zoom } : {}),
                      w: pos.w + dw / zoom,
                      h: pos.h + dh / zoom,
                    })
                  } : NOOP as any}
                  onScale={isActive ? (ds) => {
                    const currentScale = (sanitizedState.scale as number) ?? 1
                    const newScale = Math.max(0.5, Math.min(3, currentScale + ds))
                    useAppStore.getState().updateWidgetState(widget.widgetId, { scale: newScale })
                  } : NOOP as any}
                  onClose={isActive ? () => removeWidget(widget.widgetId) : NOOP}
                  onToggleMinimize={isActive ? () => toggleMinimize(widget.widgetId) : NOOP}
                  onUpdateState={(partial) => useAppStore.getState().updateWidgetState(widget.widgetId, partial)}
                  onBringToFront={isActive ? () => { bringToFront(widget.widgetId); setLastActiveWidget(widget.widgetId) } : NOOP}
                  onToggleLock={isActive ? () => toggleLock(widget.widgetId) : NOOP}
                  onChangeLayer={isActive ? (action) => changeLayer(widget.widgetId, action) : NOOP as any}
                  onDragSelected={isActive ? handleDragSelected : undefined}
                  panelId={panel.id}
                  colorScheme={widget.colorScheme}
                  onUpdateColorScheme={isActive ? (schemeName) => useAppStore.getState().updateWidgetColorScheme(widget.widgetId, schemeName) : NOOP as any}
                />
              </WidgetErrorBoundary>
            )
          })
        )}

        {/* 以下交互元素仅渲染在活跃面板 */}
        {isActive && <StrokesLayer panelId={activePanelId!} mode="draft" draftStroke={draftStroke} />}
        {isActive && connectingVisual && (() => { /* 连线拖拽预览，同现有逻辑 */ })()}
        {isActive && boxSelection?.active && ( /* 框选矩形，同现有逻辑 */ )}
      </div>
    </div>
  )
})}
```

4. 当 `panel` 为 `null` 时（所有面板被删除），保留现有的全屏空状态提示

### Step 3: 添加 CSS 样式

在 `index.css` 中添加：
```css
.panel-layer {
  position: absolute;
  inset: 0;
}
.panel-layer--hidden {
  visibility: hidden;
  pointer-events: none;
}
.panel-layer--active {
  visibility: visible;
  pointer-events: auto;
}
```

注意：`.workspace-widgets-area` 已有 `position: relative`（第 639 行），`.panel-layer` 的 `position: absolute; inset: 0` 会正确相对于它定位。

### Step 4: 修改 UnifiedToolbar.tsx — 添加全屏按钮

1. 导入 `Maximize2` 和 `Minimize2` 图标（来自 lucide-react）
2. 添加全屏状态和切换逻辑：

```tsx
import { Maximize2, Minimize2 } from 'lucide-react'

const [isFullscreen, setIsFullscreen] = useState(false)

useEffect(() => {
  const handler = () => setIsFullscreen(!!document.fullscreenElement)
  document.addEventListener('fullscreenchange', handler)
  return () => document.removeEventListener('fullscreenchange', handler)
}, [])

const toggleFullscreen = () => {
  if (document.fullscreenElement) {
    document.exitFullscreen()
  } else {
    document.documentElement.requestFullscreen().catch(() => {})
  }
}
```

3. 在设置按钮之前添加全屏按钮：
```tsx
<div className="unified-toolbar-sep" />
<button
  className="unified-toolbar-btn"
  onClick={toggleFullscreen}
  title={isFullscreen ? '退出全屏' : '全屏'}
>
  {isFullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
</button>
```

### Step 5: 验证

- 切换面板后音乐继续播放
- 切回面板后组件状态保持（音乐进度、播放状态等）
- 非活跃面板的 widget 状态更新正确（通过 `findPanelIdForWidget`）
- 全屏按钮正常工作
- 退出全屏正常工作
- 框选、拖拽、快捷键等交互仅作用于活跃面板
- 删除面板后音乐停止（预期行为）
- 只有一个面板时布局正常
- TypeScript 编译无错误

---

## 风险与注意事项

1. **性能**：所有面板的组件都在 DOM 中，React 会为所有面板执行 reconciliation。`visibility: hidden` 跳过 paint 但不跳过 React reconciliation。初期可接受，后续可优化。
2. **内存**：非活跃面板的组件仍在内存中。这是预期行为。
3. **事件**：非活跃面板通过 `pointer-events: none` 阻止交互。`onUpdateState` 是 React prop 回调，不受 `pointer-events` 影响。
4. **canvasTransform 一致性**：活跃面板使用全局 `canvasTransform`，非活跃面板使用 `panel.canvasTransform`，切换时 `setActivePanel` 保证两者一致。
5. **findPanelIdForWidget 性能**：O(P*W)，典型场景下可接受。
6. **全屏 API**：`requestFullscreen` 可能抛异常，已用 `.catch(() => {})` 处理。移动端不支持时按钮仍可点击但无效果。
7. **删除面板**：面板删除后 React 卸载对应 `.panel-layer`，音乐停止，这是预期行为。
8. **Minimap**：使用 `activePanelId` 读取位置数据，只显示活跃面板，无需修改。
9. **WidgetSearch**：检查 `item.panelId !== activePanelId` 过滤非活跃面板的 widget，无需修改。

---

## 不涉及的部分

- 不修改面板的增删逻辑
- 不修改组件的内部状态管理（MusicPlayer 等组件的代码不变）
- 不修改 `WidgetContainer.tsx` 的内部逻辑和 Props 接口
- 不修改 `Sidebar.tsx`
- 不修改 AI 工具文件（AI 只操作活跃面板）
- 不添加虚拟化/懒加载优化
