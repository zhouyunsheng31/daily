# Minimap 宏观视图组件 — 设计规格

## 1. 概述

在 Workspace 右下角添加一个"小地图"（Minimap）组件，提供画布全局宏观视图，解决组件过多时无法纵览全貌的问题。

## 2. 核心需求

### 2.1 快速跳转
- 用户点击小地图上任意位置，主画布视口立即跳转到该位置（以点击点为视口中心）
- 使用自定义跳转逻辑（见§4.4），保持当前 zoom 不变

### 2.2 比例调节 — 滚轮缩放小地图视图
- 用户需先点击小地图使其获得焦点（选中态），然后滚轮事件缩放小地图自身的显示比例（不影响主画布 zoom）
- 点击小地图外任意区域或按 Esc 可取消选中
- 缩放范围：`minimapScale` ∈ [0.2, 3.0]，默认 1.0
- 每次滚轮增量 ±0.1
- 缩放中心：小地图视口中心
- 当 minimapScale > 1.0 时，小地图显示范围小于全部组件的 bounding box，超出部分裁剪不显示（不滚动）

### 2.3 组件尺寸调整 — 拖拽左上角
- 小地图左上角有一个拖拽手柄（resize handle）
- 拖拽手柄可调整小地图组件的宽高
- 尺寸范围：最小 120×80px，最大 500×400px，默认 240×160px
- 拖拽时实时更新小地图尺寸

## 3. 视觉设计

### 3.1 位置与层级
- 绝对定位（`position: absolute`）在 `.workspace-widgets-area` 容器右下角，距边缘 16px
- Minimap 作为 `.workspace-widgets-area` 的子元素，与 `.canvas-controls` 同级
- `.workspace-widgets-area` 已有 `position: relative`（index.css），作为定位上下文
- z-index: 10001（高于 canvas-controls 9999 和浮动工具栏 9000，低于批量配色菜单的 10000 级别但批量菜单是临时弹出不影响）
- CSS class: `minimap-container`

### 3.2 外观
- 半透明深色背景 `rgba(28, 28, 30, 0.85)` + backdrop-blur(8px)
- 圆角 `var(--radius-md)` = 10px
- 边框 `1px solid var(--border-default)`
- 阴影 `var(--shadow-lg)`
- 选中态（点击获得焦点后）：边框变为 `1px solid var(--color-primary)`

### 3.3 内容渲染
- 使用 Canvas 2D 绘制小地图内容（性能优于 DOM 渲染）
- 每个组件绘制为一个带圆角的小矩形
- 组件颜色映射逻辑：读取 `widget.colorScheme`，若为 undefined 则使用 `var(--color-primary)` 解析后的色值；若有值则从 `WIDGET_COLOR_SCHEMES` 数组中查找匹配 `scheme.name === colorScheme` 的方案，取 `scheme.dark.primary` 作为填充色
- 当前视口范围绘制一个虚线矩形框（viewport indicator），颜色 `var(--color-primary)`，透明度 0.6
- 组件矩形内不绘制文字（比例太小无意义）

### 3.4 拖拽手柄
- 左上角 16×16px 的 L 形手柄
- 颜色 `var(--text-tertiary)`，hover 时 `var(--text-secondary)`
- cursor: nwse-resize

## 4. 数据流

### 4.1 输入数据
- `panelPositions[activePanelId]` — 所有组件位置
- `panelWidgets[activePanelId]` — 所有组件实例（用于获取 colorScheme）
- `canvasTransform` — 当前视口变换（x, y, zoom）
- `widgetsAreaRef` 的 `getBoundingClientRect()` — 画布视口实际尺寸（注意：不使用 `window.innerWidth/Height`，因为侧栏/工具栏会占据空间）

### 4.2 坐标映射
小地图需要将画布坐标映射到自身像素坐标：

```
// 1. 计算所有组件的 bounding box
const allWidgets = panelPositions[activePanelId]
const canvasBounds = {
  minX: Math.min(...allWidgets.map(w => w.x)),
  minY: Math.min(...allWidgets.map(w => w.y)),
  maxX: Math.max(...allWidgets.map(w => w.x + w.w)),
  maxY: Math.max(...allWidgets.map(w => w.y + w.h)),
}

// 2. 加 padding（至少 100px 画布边距）
const paddedBounds = expandBounds(canvasBounds, 100)

// 3. 计算缩放比（fit to minimap）
const scaleX = minimapWidth / (paddedBounds.maxX - paddedBounds.minX)
const scaleY = minimapHeight / (paddedBounds.maxY - paddedBounds.minY)
const fitScale = Math.min(scaleX, scaleY)

// 4. 最终缩放 = fitScale * minimapScale（用户可调）
const finalScale = fitScale * minimapScale

// 5. 画布坐标 → 小地图像素
minimapX = (canvasX - paddedBounds.minX) * finalScale
minimapY = (canvasY - paddedBounds.minY) * finalScale
```

### 4.3 视口矩形映射
```
// 使用 widgetsAreaRef 的实际尺寸（非 window.innerWidth/Height）
const areaRect = widgetsAreaRef.current.getBoundingClientRect()
const viewportWidth = areaRect.width
const viewportHeight = areaRect.height

// 主画布视口在画布坐标系中的范围
const viewportCanvas = {
  x: -canvasTransform.x / canvasTransform.zoom,
  y: -canvasTransform.y / canvasTransform.zoom,
  w: viewportWidth / canvasTransform.zoom,
  h: viewportHeight / canvasTransform.zoom,
}
// 然后用同样的 finalScale 映射到小地图像素
```

### 4.4 点击跳转映射（逆映射）
```
// 小地图像素 → 画布坐标
canvasX = minimapPixelX / finalScale + paddedBounds.minX
canvasY = minimapPixelY / finalScale + paddedBounds.minY

// 跳转：使用自定义跳转逻辑（不直接使用 teleportTo，因为 teleportTo 内部使用 window.innerWidth/Height）
// 自定义跳转：
const areaRect = widgetsAreaRef.current.getBoundingClientRect()
setCanvasTransform({
  x: areaRect.width / 2 - canvasX * canvasTransform.zoom,
  y: areaRect.height / 2 - canvasY * canvasTransform.zoom,
  zoom: canvasTransform.zoom,
})
```

## 5. 交互逻辑

### 5.1 点击跳转
- mousedown 在小地图 canvas 上时：
  1. 计算点击位置对应的画布坐标
  2. 使用自定义跳转逻辑（§4.4）跳转到目标位置
  3. 同时将小地图设为选中态（focused）
- 支持拖拽跳转：mousedown 后持续 mousemove 时持续更新视口位置（实时跟随鼠标）

### 5.2 滚轮缩放
- 仅在小地图处于选中态（focused）时，滚轮事件缩放小地图自身的显示比例
- wheel 事件处理：
  1. `e.preventDefault()` 阻止默认滚动
  2. `e.stopPropagation()` 阻止冒泡
- **关键**：Workspace 全局 wheel handler 注册在 capture 阶段（Workspace.tsx:934），stopPropagation 无法阻止 capture 阶段。必须在 Workspace.tsx 的全局 wheel handler 排除列表（line 902）中添加 `.minimap-container`，确保小地图上的滚轮事件不会同时缩放主画布
- 更新 `minimapScale`，重绘

### 5.3 拖拽手柄
- mousedown 在 resize handle 上时：
  1. 记录起始尺寸和鼠标位置
  2. mousemove 时计算新尺寸（向左上方扩展），clamp 到 [120×80, 500×400]
  3. mouseup 时结束拖拽
- 拖拽期间小地图实时重绘

### 5.4 事件隔离
- 小地图内的所有鼠标事件必须 `stopPropagation()`，防止触发 Workspace 的 pan/select/draw 等逻辑
- Workspace 的 `handleMouseDown` 已有 `target.closest('.minimap-container')` 的排除检查（line 399）
- **必须修改**：Workspace 全局 wheel handler（capture 阶段，line 902-904）的排除列表中添加 `.minimap-container`，否则小地图滚轮缩放时主画布会同时缩放
- 小地图 mousedown 事件也需 `stopPropagation()`，防止触发 Workspace 的框选逻辑

### 5.5 取消选中
- 点击小地图外部区域时取消 focused 状态
- 按 Esc 键取消 focused 状态
- 取消选中后，滚轮在小地图上不再触发缩放（滚轮事件正常传递给主画布）

## 6. 状态管理

### 6.1 组件内部状态（useState）
- `minimapScale: number` — 小地图显示比例，默认 1.0
- `minimapSize: { width: number; height: number }` — 小地图尺寸，默认 { width: 240, height: 160 }
- `focused: boolean` — 小地图是否处于选中态，默认 false

### 6.2 不持久化
- minimapScale 和 minimapSize 不保存到 store 或数据库，每次刷新重置为默认值
- 理由：这些是临时查看偏好，不值得持久化增加复杂度

## 7. 渲染优化

### 7.1 requestAnimationFrame
- 使用 `requestAnimationFrame` 节流重绘，避免每次 mousemove 都重绘
- canvas 2D 绑定到 rAF 循环，仅在数据变化时标记 dirty

### 7.2 数据订阅
- 从 useAppStore 订阅 `panelPositions`、`canvasTransform`、`activePanelId`
- 使用 shallow comparison 避免不必要的重渲染

### 7.3 无组件时隐藏
- 当 `activePanelId` 为 null 或 `panelPositions[activePanelId]` 为空数组时，隐藏小地图

## 8. 文件变更清单

### 新增文件
| 文件 | 说明 |
|------|------|
| `src/components/Minimap.tsx` | Minimap 组件 |

### 修改文件
| 文件 | 变更 |
|------|------|
| `src/components/Workspace.tsx` | 在 `.workspace-widgets-area` 内引入 `<Minimap />`（与 canvas-container 同级）；全局 wheel handler 排除列表中添加 `.minimap-container`；将 `widgetsAreaRef` 通过 prop 传递给 Minimap |
| `src/index.css` | 添加 `.minimap-container` 相关样式 |

## 9. 边界情况

1. **无组件时**：隐藏小地图，不渲染
2. **所有组件重叠在同一点**：bounding box 极小，fitScale 会很大 → clamp finalScale 上限，确保组件在小地图中不会过大
3. **组件在负坐标**：bounding box 计算已考虑负值，映射逻辑正确
4. **小地图尺寸极小（120×80）**：视口矩形和组件矩形可能重叠，视觉上可接受
5. **快速连续滚轮**：minimapScale 已 clamp 到 [0.2, 3.0]，不会越界
6. **面板切换**：小地图自动更新为新面板的组件数据，同时取消 focused 状态
7. **主画布缩放**：视口矩形自动跟随变化
8. **侧栏展开/收起**：视口尺寸使用 `widgetsAreaRef` 的实际尺寸，自动适应
9. **minimapScale > 1.0**：小地图显示范围小于全部组件 bounding box，超出部分裁剪不显示
10. **minimapScale < 1.0**：全部组件缩小显示，周围有空白区域

## 10. 不做的事

- 不在小地图上显示笔迹（strokes）和连线（connections）— 太复杂且性能差
- 不支持小地图的拖拽移动（只支持左上角 resize）
- 不持久化小地图设置
- 不在小地图上显示组件文字内容
