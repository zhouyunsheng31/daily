# Living Dashboard V2 — 重构设计文档

## Why

V1 实现了基础的面板管理和组件系统，但存在以下核心问题：
1. **布局系统受限**：react-grid-layout 强制网格对齐，组件无法自由摆放，网格粒度粗糙
2. **无设置系统**：无法自定义外观、管理组件、导出导入数据
3. **无保存反馈**：自动保存没有视觉指示，用户无法确认状态是否已持久化
4. **组件扩展受限**：仅支持开发时注册，无法运行时动态加载 AI 创建的组件

## What Changes

- 替换 react-grid-layout 为自研混合布局引擎（自由画布 + 网格对齐辅助）
- 新增设置系统（外观自定义、保存与导出、行为偏好、组件管理）
- 新增保存状态指示器
- 新增运行时动态组件加载机制
- 重构 Store 和持久化层以适配新布局模型
- 改进整体 UI 设计

## Impact

- Affected code: 全部核心模块（Workspace、Store、WidgetContainer、Sidebar、db）
- 数据迁移: 需要将旧 react-grid-layout 格式的布局数据迁移为新像素坐标格式
- 依赖变更: 移除 react-grid-layout，无新增外部依赖

---

## 1. 混合布局引擎

### 数据模型

```typescript
interface WidgetPosition {
  widgetId: string
  x: number      // 像素坐标
  y: number      // 像素坐标
  w: number      // 像素宽度
  h: number      // 像素高度
  zIndex: number  // 层叠顺序
}

interface PanelSettings {
  layoutMode: 'free' | 'grid'
  gridSize: number  // 网格单元大小，默认 20px
}
```

每个面板独立存储 `WidgetPosition[]` 和 `PanelSettings`。`Panel` 类型扩展：

```typescript
interface Panel {
  id: string
  name: string
  order: number
  settings: PanelSettings
}
```

### 自由模式 (free)

- 组件使用 `position: absolute` + `left/top/width/height` 定位
- 拖拽移动：鼠标按住标题栏拖拽，组件跟随鼠标自由移动，无吸附
- 调整大小：右下角拖拽手柄，自由调整像素尺寸
- 组件可重叠，点击组件自动置顶（zIndex = max(zIndex) + 1）
- 最小尺寸限制：每个组件类型仍保留 `minW` / `minH`（像素值）

### 网格模式 (grid)

- 同样使用 absolute 定位
- 拖拽和调整大小时，坐标自动 snap 到 `gridSize` 的整数倍：`snapped = Math.round(value / gridSize) * gridSize`
- 画布上绘制淡色网格线（CSS background-image 实现，不占 DOM）
- 组件最小尺寸为 1 个网格单元

### 模式切换

- 工具栏中提供布局模式切换按钮（图标：自由模式用十字箭头，网格模式用网格图标）
- free → grid：所有组件位置 snap 到最近网格点
- grid → free：保持当前位置不变
- 切换即时生效，无需重新布局

### 拖拽实现

自研拖拽，不依赖第三方库：

```typescript
// useDraggable hook
interface DragState {
  isDragging: boolean
  startX: number
  startY: number
  offsetX: number
  offsetY: number
}
```

- mousedown on `.widget-drag-handle` → 记录起始位置
- mousemove → 计算偏移，更新组件 x/y（网格模式下 snap）
- mouseup → 结束拖拽，触发持久化

### 调整大小实现

```typescript
// useResizable hook
interface ResizeState {
  isResizing: boolean
  startW: number
  startH: number
  startX: number
  startY: number
}
```

- mousedown on resize handle → 记录起始尺寸
- mousemove → 计算新尺寸，应用 minW/minH 约束（网格模式下 snap）
- mouseup → 结束调整，触发持久化

### 画布滚动

- 画布区域可滚动，组件可放置在可视区域之外
- 画布逻辑尺寸 = max(容器尺寸, 所有组件边界 + padding)
- 添加新组件时默认放在可视区域左上角附近

---

## 2. 设置系统

### 设置面板入口

- 顶部工具栏右侧齿轮图标，点击打开设置面板（右侧抽屉式滑出，宽度 360px）
- 设置面板分为 4 个 tab：外观、保存、行为、组件

### 外观自定义 (Appearance)

```typescript
interface AppearanceSettings {
  accentColor: string       // 主题强调色，默认 '#3b82f6'
  backgroundType: 'color' | 'gradient' | 'image'
  backgroundColor: string   // 背景色，默认 '#09090b' (zinc-950)
  backgroundGradient: string // CSS gradient，如 'linear-gradient(135deg, #0f172a, #1e1b4b)'
  backgroundImage: string   // 背景图片 URL 或 data URI
  surfaceColor: string      // 组件表面色，默认 '#18181b' (zinc-900)
  surfaceBorderColor: string // 组件边框色，默认 '#27272a' (zinc-800)
  textColor: string         // 主文字色，默认 '#e4e4e7' (zinc-200)
  textMutedColor: string    // 次要文字色，默认 '#a1a1aa' (zinc-400)
  fontSize: number          // 基础字号，默认 14
}
```

- 颜色选择器使用原生 `<input type="color">`
- 提供预设主题（深色默认、浅色、暖色调、冷色调）一键切换
- 背景图片支持上传到 IndexedDB 或输入 URL
- 所有外观设置实时预览，无需保存按钮

### 保存与导出 (Data)

- **导出**：将所有面板数据（面板列表、组件实例、布局位置、组件状态、设置）打包为 JSON 文件下载
- **导入**：从 JSON 文件恢复，覆盖当前数据（需确认）
- **清除数据**：清除所有 IndexedDB 数据，重置为初始状态（需确认）
- 导出格式：

```typescript
interface ExportData {
  version: 2
  exportedAt: string
  panels: PanelData[]
  settings: AppSettings
  dynamicWidgets: DynamicWidgetDef[]
}
```

### 行为偏好 (Behavior)

```typescript
interface BehaviorSettings {
  defaultLayoutMode: 'free' | 'grid'  // 新建面板的默认布局模式
  defaultGridSize: number              // 新建面板的默认网格大小
  startupPanel: 'last' | 'first' | string  // 启动时显示的面板，'last'=上次活跃, 'first'=第一个, 或面板ID
  confirmBeforeDelete: boolean         // 删除面板/组件前是否确认，默认 true
  widgetSnapToEdge: boolean            // 自由模式下是否吸附到画布边缘，默认 false
}
```

### 组件管理 (Widgets)

- 列表展示所有已注册组件（内置 + 动态）
- 每个组件显示：图标、名称、类型（内置/动态）、状态（启用/禁用）
- 内置组件不可删除，可禁用（禁用后不出现在添加组件菜单中）
- 动态组件可删除（删除后从注册表和 IndexedDB 中移除代码）
- 点击组件可查看详情：widgetType、描述、默认布局参数

---

## 3. 保存状态指示器

### 位置与样式

- 顶部工具栏右侧，齿轮图标左边
- 三种状态：
  - `saved`：绿色圆点 + "已保存"，静态显示
  - `saving`：黄色圆点 + "保存中..."，带旋转动画
  - `error`：红色圆点 + "保存失败"，可点击重试

### 实现机制

```typescript
interface SaveStatus {
  status: 'saved' | 'saving' | 'error'
  lastSavedAt: number | null
  error?: string
}
```

- Store 中新增 `saveStatus` 状态
- 每次触发防抖保存时：先设为 `saving`，保存完成后设为 `saved`，失败设为 `error`
- 页面 `beforeunload` 事件中尝试同步保存（使用 `navigator.sendBeacon` 或同步 IndexedDB 写入）

---

## 4. 运行时动态组件加载

### 动态组件定义

```typescript
interface DynamicWidgetDef {
  widgetType: string
  displayName: string
  icon: string
  defaultLayout: { w: number; h: number; minW?: number; minH?: number }
  defaultState: Record<string, unknown>
  code: string  // 组件源代码字符串
  createdAt: string
}
```

### 组件代码规范

AI 创建动态组件时，代码需遵循以下格式（使用 CommonJS 赋值模式，因为 `new Function` 不支持 ES module 语法）：

```javascript
// 可用变量：React, useState, useEffect, useCallback, useRef, useMemo
// 可用图标：通过 __lucide 对象访问，如 const { Search } = __lucide
// 可用类型：WidgetProps（通过参数类型推断）

function MyWidget({ widgetId, state, onUpdateState }) {
  const [count, setCount] = useState(0)

  return (
    <div className="h-full flex items-center justify-center">
      <button onClick={() => setCount(c => c + 1)}>Count: {count}</button>
    </div>
  )
}

exports.default = MyWidget
```

### 运行时评估

```typescript
function evaluateDynamicComponent(code: string): ComponentType<WidgetProps> {
  const wrappedCode = `
    const { useState, useEffect, useCallback, useRef, useMemo } = React;
    const exports = {};
    ${code}
    return exports.default;
  `
  const factory = new Function('React', '__lucide', wrappedCode)
  const Component = factory(React, lucideIcons)
  return Component
}
```

- 动态组件代码存储在 IndexedDB 的 `dynamic-widgets` store 中
- 应用启动时从 IndexedDB 加载所有动态组件，评估并注册
- 评估失败的组件标记为 `error` 状态，在组件管理中显示错误信息
- 动态组件可使用 Tailwind 类名（因为 Tailwind v4 是 JIT 编译，动态类名可能不生效，需在文档中说明限制）

### AI 创建组件的流程

1. AI 生成组件代码字符串
2. 创建 `DynamicWidgetDef` 对象
3. 调用 `registerDynamicWidget(def)` 将代码存入 IndexedDB 并注册
4. 组件立即可用于添加到面板

---

## 5. UI 改进

### 顶部工具栏

```
[面板名称]                    [布局模式切换] [保存状态] [添加组件] [设置]
```

- 布局模式切换：两个图标按钮，当前模式高亮
- 保存状态：如上所述
- 添加组件：保持现有下拉菜单
- 设置：齿轮图标，打开右侧抽屉

### 左侧边栏

- 保持现有功能，视觉微调
- 面板标签增加小图标指示布局模式（自由/网格）
- 面板标签右键菜单增加"复制面板"选项

### WidgetContainer 改进

- 标题栏增加最小化按钮（点击后组件折叠为仅标题栏）
- 最小化状态存储在组件 state 中
- 拖拽手柄视觉优化：hover 时显示移动光标和微弱高亮
- 调整大小手柄视觉优化：hover 时显示对角线光标和边角高亮

### 画布背景

- 网格模式下显示网格线
- 自由模式下显示微弱的点阵（间距 40px），提供空间参考
- 背景颜色/图片跟随外观设置

---

## 6. 数据迁移

### V1 → V2 迁移策略

- 应用启动时检测 IndexedDB 中的数据版本
- 如果是 V1 数据（布局为 react-grid-layout 格式），执行迁移：
  1. 读取旧 `Layout[]` 数据
  2. 将网格坐标转换为像素坐标：`x_px = layoutItem.x * colWidth + layoutItem.x * margin`
  3. 由于 V1 使用 12 列 + 60px 行高，转换公式：
     - `colWidth = containerWidth / 12`
     - `x_px = layoutItem.x * (colWidth + 12)`
     - `y_px = layoutItem.y * 72` (60px rowHeight + 12px margin)
     - `w_px = layoutItem.w * (colWidth + 12) - 12`
     - `h_px = layoutItem.h * 72 - 12`
  4. 容器宽度使用默认 1200px 估算
  5. 写入新的 `WidgetPosition[]` 格式
  6. 更新数据版本标记

### IndexedDB Schema 变更

- 新增 `positions` store（替代 `layouts` store）
- 新增 `settings` store（存储外观/行为设置）
- 新增 `dynamic-widgets` store（存储动态组件代码）
- `panels` store 中的 Panel 对象增加 `settings` 字段
- 保留 `layouts` store 不删除（迁移用），版本号升为 2

---

## 7. 架构变更总结

### 文件变更

| 文件 | 操作 | 说明 |
|------|------|------|
| `src/components/Workspace.tsx` | 重写 | 自由画布容器，替代 react-grid-layout |
| `src/components/WidgetContainer.tsx` | 重写 | 支持自由拖拽、调整大小、最小化 |
| `src/components/Sidebar.tsx` | 修改 | 增加布局模式图标、复制面板 |
| `src/components/AddWidgetMenu.tsx` | 修改 | 支持动态组件显示 |
| `src/components/SettingsPanel.tsx` | 新增 | 设置面板（右侧抽屉） |
| `src/components/SaveIndicator.tsx` | 新增 | 保存状态指示器 |
| `src/components/LayoutModeToggle.tsx` | 新增 | 布局模式切换按钮 |
| `src/hooks/useDraggable.ts` | 新增 | 拖拽 hook |
| `src/hooks/useResizable.ts` | 新增 | 调整大小 hook |
| `src/stores/useAppStore.ts` | 重写 | 适配新布局模型、增加设置管理 |
| `src/types/index.ts` | 修改 | 新增 WidgetPosition、PanelSettings、AppSettings 等类型 |
| `src/registry/index.ts` | 修改 | 支持 dynamic widget 注册 |
| `src/utils/db.ts` | 重写 | 新增 stores、数据迁移 |
| `src/utils/migration.ts` | 新增 | V1 → V2 数据迁移逻辑 |
| `src/utils/evaluateWidget.ts` | 新增 | 动态组件代码评估 |
| `src/App.tsx` | 修改 | 集成设置面板、保存指示器、布局切换 |
| `src/index.css` | 修改 | 移除 react-grid-layout 样式，新增画布网格样式 |
| `src/main.tsx` | 修改 | 无需变更（组件注册保持不变） |

### 依赖变更

- 移除：`react-grid-layout` 及其类型
- 保留：所有其他依赖不变

### Store 重构

```typescript
interface AppState {
  // 面板
  panels: Panel[]
  activePanelId: string | null
  panelWidgets: Record<string, WidgetInstance[]>
  panelPositions: Record<string, WidgetPosition[]>  // 替代 panelLayouts

  // 设置
  appearance: AppearanceSettings
  behavior: BehaviorSettings

  // 状态
  initialized: boolean
  saveStatus: SaveStatus

  // 动态组件
  dynamicWidgets: DynamicWidgetDef[]

  // 方法...
}
```
