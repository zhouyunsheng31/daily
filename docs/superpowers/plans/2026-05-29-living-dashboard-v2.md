# Living Dashboard V2 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 重构 Living Dashboard，替换网格布局为自由画布+网格对齐混合引擎，新增设置系统、保存指示器、运行时动态组件加载。

**Architecture:** 自由画布为底层布局模型（absolute positioning），网格模式是 snap-to-grid 辅助层。Zustand 管理全局状态，IndexedDB 持久化。动态组件通过 new Function 运行时评估。

**Tech Stack:** React 19, TypeScript, Vite, Tailwind CSS v4, Zustand, idb, lucide-react

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `src/types/index.ts` | Modify | 新增 WidgetPosition, PanelSettings, AppearanceSettings, BehaviorSettings, SaveStatus, DynamicWidgetDef 等类型 |
| `src/utils/db.ts` | Rewrite | 新增 positions/settings/dynamic-widgets stores，数据迁移 |
| `src/utils/migration.ts` | Create | V1→V2 布局数据迁移 |
| `src/utils/debounce.ts` | Keep | 不变 |
| `src/utils/evaluateWidget.ts` | Create | 动态组件代码评估 |
| `src/hooks/useDraggable.ts` | Create | 自由拖拽 hook |
| `src/hooks/useResizable.ts` | Create | 调整大小 hook |
| `src/registry/index.ts` | Modify | 支持 dynamic widget 注册/注销 |
| `src/stores/useAppStore.ts` | Rewrite | 适配新布局模型、增加设置管理、保存状态 |
| `src/components/Workspace.tsx` | Rewrite | 自由画布容器 |
| `src/components/WidgetContainer.tsx` | Rewrite | 自由拖拽、调整大小、最小化 |
| `src/components/Sidebar.tsx` | Modify | 增加布局模式图标、复制面板 |
| `src/components/AddWidgetMenu.tsx` | Modify | 支持动态组件显示 |
| `src/components/SettingsPanel.tsx` | Create | 设置面板（右侧抽屉） |
| `src/components/SaveIndicator.tsx` | Create | 保存状态指示器 |
| `src/components/LayoutModeToggle.tsx` | Create | 布局模式切换按钮 |
| `src/App.tsx` | Modify | 集成新组件 |
| `src/main.tsx` | Modify | 启动时加载动态组件 |
| `src/index.css` | Modify | 移除 react-grid-layout 样式，新增画布样式 |
| `package.json` | Modify | 移除 react-grid-layout |

---

### Task 1: 类型系统重构

**Files:**
- Modify: `src/types/index.ts`

- [ ] **Step 1: 重写类型定义文件**

```typescript
import type { ComponentType } from 'react'

export interface WidgetPosition {
  widgetId: string
  x: number
  y: number
  w: number
  h: number
  zIndex: number
}

export interface PanelSettings {
  layoutMode: 'free' | 'grid'
  gridSize: number
}

export interface WidgetConfig {
  widgetType: string
  displayName: string
  icon: string
  defaultLayout: { w: number; h: number; minW?: number; minH?: number }
  defaultState: Record<string, unknown>
  component: ComponentType<WidgetProps>
  serialize: (state: Record<string, unknown>) => Record<string, unknown>
  deserialize: (data: Record<string, unknown>) => Record<string, unknown>
  isDynamic?: boolean
}

export interface WidgetProps {
  widgetId: string
  state: Record<string, unknown>
  onUpdateState: (partial: Record<string, unknown>) => void
}

export interface WidgetInstance {
  widgetId: string
  widgetType: string
  state: Record<string, unknown>
  minimized?: boolean
}

export interface Panel {
  id: string
  name: string
  order: number
  settings: PanelSettings
}

export interface PanelData {
  panel: Panel
  widgets: WidgetInstance[]
  positions: WidgetPosition[]
}

export interface AppearanceSettings {
  accentColor: string
  backgroundType: 'color' | 'gradient' | 'image'
  backgroundColor: string
  backgroundGradient: string
  backgroundImage: string
  surfaceColor: string
  surfaceBorderColor: string
  textColor: string
  textMutedColor: string
  fontSize: number
}

export interface BehaviorSettings {
  defaultLayoutMode: 'free' | 'grid'
  defaultGridSize: number
  startupPanel: 'last' | 'first' | string
  confirmBeforeDelete: boolean
  widgetSnapToEdge: boolean
}

export interface AppSettings {
  appearance: AppearanceSettings
  behavior: BehaviorSettings
}

export interface SaveStatus {
  status: 'saved' | 'saving' | 'error'
  lastSavedAt: number | null
  error?: string
}

export interface DynamicWidgetDef {
  widgetType: string
  displayName: string
  icon: string
  defaultLayout: { w: number; h: number; minW?: number; minH?: number }
  defaultState: Record<string, unknown>
  code: string
  createdAt: string
}

export interface AppData {
  panels: PanelData[]
  activePanelId: string | null
  settings: AppSettings
  dynamicWidgets: DynamicWidgetDef[]
}

export const DEFAULT_APPEARANCE: AppearanceSettings = {
  accentColor: '#3b82f6',
  backgroundType: 'color',
  backgroundColor: '#09090b',
  backgroundGradient: 'linear-gradient(135deg, #0f172a, #1e1b4b)',
  backgroundImage: '',
  surfaceColor: '#18181b',
  surfaceBorderColor: '#27272a',
  textColor: '#e4e4e7',
  textMutedColor: '#a1a1aa',
  fontSize: 14,
}

export const DEFAULT_BEHAVIOR: BehaviorSettings = {
  defaultLayoutMode: 'free',
  defaultGridSize: 20,
  startupPanel: 'last',
  confirmBeforeDelete: true,
  widgetSnapToEdge: false,
}

export const DEFAULT_PANEL_SETTINGS: PanelSettings = {
  layoutMode: 'free',
  gridSize: 20,
}
```

- [ ] **Step 2: 验证 TypeScript 编译**

Run: `$env:PATH = "D:\nodejs\node-v22.16.0-win-x64;" + $env:PATH; cd f:\allmylife\event; npx tsc --noEmit 2>&1 | Select-Object -First 20`

Expected: 可能有其他文件的类型错误（因为旧类型被替换），但 types/index.ts 本身无错误

---

### Task 2: 数据迁移工具

**Files:**
- Create: `src/utils/migration.ts`

- [ ] **Step 1: 编写 V1→V2 迁移逻辑**

```typescript
import type { WidgetPosition, PanelSettings } from '../types'
import type { Layout } from 'react-grid-layout'

const V1_COLS = 12
const V1_ROW_HEIGHT = 60
const V1_MARGIN = 12
const V1_CONTAINER_WIDTH = 1200

export function migrateV1LayoutToV2(
  layout: Layout,
  containerWidth: number = V1_CONTAINER_WIDTH
): WidgetPosition[] {
  const colWidth = (containerWidth - V1_MARGIN * (V1_COLS + 1)) / V1_COLS

  return layout.map((item, index) => ({
    widgetId: item.i,
    x: item.x * (colWidth + V1_MARGIN) + V1_MARGIN,
    y: item.y * (V1_ROW_HEIGHT + V1_MARGIN) + V1_MARGIN,
    w: item.w * (colWidth + V1_MARGIN) - V1_MARGIN,
    h: item.h * (V1_ROW_HEIGHT + V1_MARGIN) - V1_MARGIN,
    zIndex: index,
  }))
}

export function getDefaultPanelSettings(): PanelSettings {
  return {
    layoutMode: 'free',
    gridSize: 20,
  }
}
```

---

### Task 3: IndexedDB 持久化层重构

**Files:**
- Rewrite: `src/utils/db.ts`

- [ ] **Step 1: 重写 db.ts**

```typescript
import { openDB, type IDBPDatabase } from 'idb'
import type { PanelData, AppData, Panel, WidgetInstance, WidgetPosition, AppSettings, DynamicWidgetDef } from '../types'
import { DEFAULT_APPEARANCE, DEFAULT_BEHAVIOR } from '../types'
import { migrateV1LayoutToV2, getDefaultPanelSettings } from './migration'

const DB_NAME = 'living-dashboard'
const DB_VERSION = 2
const PANEL_STORE = 'panels'
const WIDGET_STORE = 'widgets'
const POSITION_STORE = 'positions'
const SETTINGS_STORE = 'settings'
const META_STORE = 'meta'
const DYNAMIC_WIDGET_STORE = 'dynamic-widgets'

let dbInstance: IDBPDatabase | null = null

async function getDB(): Promise<IDBPDatabase> {
  if (dbInstance) return dbInstance
  dbInstance = await openDB(DB_NAME, DB_VERSION, {
    upgrade(db, oldVersion) {
      if (!db.objectStoreNames.contains(PANEL_STORE)) {
        db.createObjectStore(PANEL_STORE, { keyPath: 'id' })
      }
      if (!db.objectStoreNames.contains(WIDGET_STORE)) {
        db.createObjectStore(WIDGET_STORE, { keyPath: 'panelId' })
      }
      if (!db.objectStoreNames.contains(POSITION_STORE)) {
        db.createObjectStore(POSITION_STORE, { keyPath: 'panelId' })
      }
      if (!db.objectStoreNames.contains(SETTINGS_STORE)) {
        db.createObjectStore(SETTINGS_STORE, { keyPath: 'key' })
      }
      if (!db.objectStoreNames.contains(META_STORE)) {
        db.createObjectStore(META_STORE, { keyPath: 'key' })
      }
      if (!db.objectStoreNames.contains(DYNAMIC_WIDGET_STORE)) {
        db.createObjectStore(DYNAMIC_WIDGET_STORE, { keyPath: 'widgetType' })
      }
    },
  })
  return dbInstance
}

export async function savePanel(panel: Panel): Promise<void> {
  const db = await getDB()
  await db.put(PANEL_STORE, panel)
}

export async function deletePanel(panelId: string): Promise<void> {
  const db = await getDB()
  await db.delete(PANEL_STORE, panelId)
  await db.delete(WIDGET_STORE, panelId)
  await db.delete(POSITION_STORE, panelId)
}

export async function getAllPanels(): Promise<Panel[]> {
  const db = await getDB()
  return db.getAll(PANEL_STORE)
}

export async function saveWidgets(panelId: string, widgets: WidgetInstance[]): Promise<void> {
  const db = await getDB()
  await db.put(WIDGET_STORE, { panelId, widgets })
}

export async function getWidgets(panelId: string): Promise<WidgetInstance[]> {
  const db = await getDB()
  const data = await db.get(WIDGET_STORE, panelId)
  return data?.widgets ?? []
}

export async function savePositions(panelId: string, positions: WidgetPosition[]): Promise<void> {
  const db = await getDB()
  await db.put(POSITION_STORE, { panelId, positions })
}

export async function getPositions(panelId: string): Promise<WidgetPosition[]> {
  const db = await getDB()
  const data = await db.get(POSITION_STORE, panelId)
  return data?.positions ?? []
}

export async function saveActivePanelId(panelId: string | null): Promise<void> {
  const db = await getDB()
  await db.put(META_STORE, { key: 'activePanelId', value: panelId })
}

export async function getActivePanelId(): Promise<string | null> {
  const db = await getDB()
  const data = await db.get(META_STORE, 'activePanelId')
  return data?.value ?? null
}

export async function saveSettings(settings: AppSettings): Promise<void> {
  const db = await getDB()
  await db.put(SETTINGS_STORE, { key: 'appSettings', value: settings })
}

export async function getSettings(): Promise<AppSettings | null> {
  const db = await getDB()
  const data = await db.get(SETTINGS_STORE, 'appSettings')
  return data?.value ?? null
}

export async function saveDynamicWidget(def: DynamicWidgetDef): Promise<void> {
  const db = await getDB()
  await db.put(DYNAMIC_WIDGET_STORE, def)
}

export async function deleteDynamicWidget(widgetType: string): Promise<void> {
  const db = await getDB()
  await db.delete(DYNAMIC_WIDGET_STORE, widgetType)
}

export async function getAllDynamicWidgets(): Promise<DynamicWidgetDef[]> {
  const db = await getDB()
  return db.getAll(DYNAMIC_WIDGET_STORE)
}

export async function loadAllData(): Promise<AppData> {
  const panels = await getAllPanels()
  const panelDataList: PanelData[] = []
  for (const panel of panels) {
    const widgets = await getWidgets(panel.id)
    let positions = await getPositions(panel.id)

    if (positions.length === 0 && widgets.length > 0) {
      const db = await getDB()
      const layoutStore = db.objectStoreNames.contains('layouts') ? 'layouts' : null
      if (layoutStore) {
        try {
          const layoutData = await db.get('layouts', panel.id)
          if (layoutData?.layout) {
            positions = migrateV1LayoutToV2(layoutData.layout)
            await savePositions(panel.id, positions)
          }
        } catch {
          // V1 layout data not available, skip migration
        }
      }
    }

    const migratedPanel = {
      ...panel,
      settings: panel.settings || getDefaultPanelSettings(),
    }
    await savePanel(migratedPanel)

    panelDataList.push({ panel: migratedPanel, widgets, positions })
  }

  const activePanelId = await getActivePanelId()
  const settings = await getSettings() || { appearance: DEFAULT_APPEARANCE, behavior: DEFAULT_BEHAVIOR }
  const dynamicWidgets = await getAllDynamicWidgets()

  return { panels: panelDataList, activePanelId, settings, dynamicWidgets }
}

export async function exportAllData(): Promise<string> {
  const data = await loadAllData()
  return JSON.stringify({ version: 2, exportedAt: new Date().toISOString(), ...data }, null, 2)
}

export async function importAllData(json: string): Promise<AppData> {
  const data = JSON.parse(json) as AppData & { version?: number }
  if (data.version !== 2) {
    throw new Error('Unsupported data version')
  }

  const db = await getDB()
  const tx = db.transaction(
    [PANEL_STORE, WIDGET_STORE, POSITION_STORE, SETTINGS_STORE, META_STORE, DYNAMIC_WIDGET_STORE],
    'readwrite'
  )

  await tx.objectStore(PANEL_STORE).clear()
  await tx.objectStore(WIDGET_STORE).clear()
  await tx.objectStore(POSITION_STORE).clear()
  await tx.objectStore(DYNAMIC_WIDGET_STORE).clear()

  for (const pd of data.panels) {
    await tx.objectStore(PANEL_STORE).put(pd.panel)
    await tx.objectStore(WIDGET_STORE).put({ panelId: pd.panel.id, widgets: pd.widgets })
    await tx.objectStore(POSITION_STORE).put({ panelId: pd.panel.id, positions: pd.positions })
  }

  if (data.settings) {
    await tx.objectStore(SETTINGS_STORE).put({ key: 'appSettings', value: data.settings })
  }

  if (data.activePanelId) {
    await tx.objectStore(META_STORE).put({ key: 'activePanelId', value: data.activePanelId })
  }

  for (const dw of (data.dynamicWidgets || [])) {
    await tx.objectStore(DYNAMIC_WIDGET_STORE).put(dw)
  }

  await tx.done
  return data
}

export async function clearAllData(): Promise<void> {
  const db = await getDB()
  const tx = db.transaction(
    [PANEL_STORE, WIDGET_STORE, POSITION_STORE, SETTINGS_STORE, META_STORE, DYNAMIC_WIDGET_STORE],
    'readwrite'
  )
  await tx.objectStore(PANEL_STORE).clear()
  await tx.objectStore(WIDGET_STORE).clear()
  await tx.objectStore(POSITION_STORE).clear()
  await tx.objectStore(SETTINGS_STORE).clear()
  await tx.objectStore(META_STORE).clear()
  await tx.objectStore(DYNAMIC_WIDGET_STORE).clear()
  await tx.done
}
```

---

### Task 4: 动态组件评估器

**Files:**
- Create: `src/utils/evaluateWidget.ts`

- [ ] **Step 1: 编写动态组件评估器**

```typescript
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
    registerDynamicWidget(def)
  }
}
```

---

### Task 5: 拖拽 Hook

**Files:**
- Create: `src/hooks/useDraggable.ts`

- [ ] **Step 1: 编写 useDraggable hook**

```typescript
import { useCallback, useRef } from 'react'

interface UseDraggableOptions {
  onMove: (deltaX: number, deltaY: number) => void
  onEnd: () => void
  enabled?: boolean
}

export function useDraggable({ onMove, onEnd, enabled = true }: UseDraggableOptions) {
  const dragState = useRef({
    isDragging: false,
    startX: 0,
    startY: 0,
  })

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (!enabled) return
      e.preventDefault()
      dragState.current = {
        isDragging: true,
        startX: e.clientX,
        startY: e.clientY,
      }

      const handleMouseMove = (e: MouseEvent) => {
        if (!dragState.current.isDragging) return
        const deltaX = e.clientX - dragState.current.startX
        const deltaY = e.clientY - dragState.current.startY
        dragState.current.startX = e.clientX
        dragState.current.startY = e.clientY
        onMove(deltaX, deltaY)
      }

      const handleMouseUp = () => {
        dragState.current.isDragging = false
        onEnd()
        document.removeEventListener('mousemove', handleMouseMove)
        document.removeEventListener('mouseup', handleMouseUp)
      }

      document.addEventListener('mousemove', handleMouseMove)
      document.addEventListener('mouseup', handleMouseUp)
    },
    [enabled, onMove, onEnd]
  )

  return { handleMouseDown }
}
```

---

### Task 6: 调整大小 Hook

**Files:**
- Create: `src/hooks/useResizable.ts`

- [ ] **Step 1: 编写 useResizable hook**

```typescript
import { useCallback, useRef } from 'react'

interface UseResizableOptions {
  onResize: (deltaW: number, deltaH: number) => void
  onEnd: () => void
  enabled?: boolean
}

export function useResizable({ onResize, onEnd, enabled = true }: UseResizableOptions) {
  const resizeState = useRef({
    isResizing: false,
    startX: 0,
    startY: 0,
  })

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (!enabled) return
      e.preventDefault()
      e.stopPropagation()
      resizeState.current = {
        isResizing: true,
        startX: e.clientX,
        startY: e.clientY,
      }

      const handleMouseMove = (e: MouseEvent) => {
        if (!resizeState.current.isResizing) return
        const deltaW = e.clientX - resizeState.current.startX
        const deltaH = e.clientY - resizeState.current.startY
        resizeState.current.startX = e.clientX
        resizeState.current.startY = e.clientY
        onResize(deltaW, deltaH)
      }

      const handleMouseUp = () => {
        resizeState.current.isResizing = false
        onEnd()
        document.removeEventListener('mousemove', handleMouseMove)
        document.removeEventListener('mouseup', handleMouseUp)
      }

      document.addEventListener('mousemove', handleMouseMove)
      document.addEventListener('mouseup', handleMouseUp)
    },
    [enabled, onResize, onEnd]
  )

  return { handleMouseDown }
}
```

---

### Task 7: 组件注册表扩展

**Files:**
- Modify: `src/registry/index.ts`

- [ ] **Step 1: 扩展注册表，支持注销和动态组件查询**

```typescript
import type { WidgetConfig } from '../types'

const registry = new Map<string, WidgetConfig>()

export function registerWidget(config: WidgetConfig): void {
  if (registry.has(config.widgetType)) {
    console.warn(`Widget type "${config.widgetType}" is already registered. Overwriting.`)
  }
  registry.set(config.widgetType, config)
}

export function unregisterWidget(widgetType: string): void {
  registry.delete(widgetType)
}

export function getWidgetConfig(widgetType: string): WidgetConfig | undefined {
  return registry.get(widgetType)
}

export function getAllWidgetConfigs(): WidgetConfig[] {
  return Array.from(registry.values())
}

export function getDynamicWidgetConfigs(): WidgetConfig[] {
  return Array.from(registry.values()).filter(c => c.isDynamic)
}

export function getBuiltInWidgetConfigs(): WidgetConfig[] {
  return Array.from(registry.values()).filter(c => !c.isDynamic)
}
```

---

### Task 8: Zustand Store 重构

**Files:**
- Rewrite: `src/stores/useAppStore.ts`

- [ ] **Step 1: 重写 useAppStore**

```typescript
import { create } from 'zustand'
import { v4 as uuidv4 } from 'uuid'
import type { Panel, WidgetInstance, WidgetPosition, AppSettings, SaveStatus, DynamicWidgetDef } from '../types'
import { DEFAULT_APPEARANCE, DEFAULT_BEHAVIOR, DEFAULT_PANEL_SETTINGS } from '../types'
import {
  savePanel,
  deletePanel as dbDeletePanel,
  saveWidgets,
  savePositions,
  saveActivePanelId,
  saveSettings,
  saveDynamicWidget,
  deleteDynamicWidget as dbDeleteDynamicWidget,
  loadAllData,
} from '../utils/db'
import { createDebouncedSave } from '../utils/debounce'
import { getWidgetConfig } from '../registry'

interface AppState {
  panels: Panel[]
  activePanelId: string | null
  panelWidgets: Record<string, WidgetInstance[]>
  panelPositions: Record<string, WidgetPosition[]>
  settings: AppSettings
  saveStatus: SaveStatus
  dynamicWidgets: DynamicWidgetDef[]
  initialized: boolean

  initialize: () => Promise<void>
  addPanel: (name: string) => Promise<void>
  deletePanel: (panelId: string) => Promise<void>
  renamePanel: (panelId: string, name: string) => Promise<void>
  reorderPanels: (panels: Panel[]) => Promise<void>
  setActivePanel: (panelId: string) => Promise<void>
  updatePanelSettings: (panelId: string, settings: Partial<Panel['settings']>) => Promise<void>

  addWidget: (widgetType: string) => Promise<void>
  removeWidget: (widgetId: string) => Promise<void>
  updateWidgetState: (widgetId: string, partial: Record<string, unknown>) => void
  updateWidgetPosition: (widgetId: string, partial: Partial<WidgetPosition>) => void
  updatePositions: (positions: WidgetPosition[]) => void
  bringToFront: (widgetId: string) => void
  toggleMinimize: (widgetId: string) => void

  updateAppearance: (partial: Partial<AppSettings['appearance']>) => Promise<void>
  updateBehavior: (partial: Partial<AppSettings['behavior']>) => Promise<void>

  addDynamicWidget: (def: DynamicWidgetDef) => Promise<boolean>
  removeDynamicWidget: (widgetType: string) => Promise<void>
}

const debouncedPositionSave = createDebouncedSave(
  (panelId: string, positions: WidgetPosition[]) => {
    savePositions(panelId, positions)
  },
  500
)

const debouncedWidgetStateSave = createDebouncedSave(
  (panelId: string, widgets: WidgetInstance[]) => {
    saveWidgets(panelId, widgets)
  },
  1000
)

function setSaving(): Partial<AppState> {
  return { saveStatus: { status: 'saving', lastSavedAt: null } }
}

function setSaved(state: AppState): Partial<AppState> {
  return { saveStatus: { status: 'saved', lastSavedAt: Date.now() } }
}

function setError(error: string): Partial<AppState> {
  return { saveStatus: { status: 'error', lastSavedAt: null, error } }
}

export const useAppStore = create<AppState>((set, get) => ({
  panels: [],
  activePanelId: null,
  panelWidgets: {},
  panelPositions: {},
  settings: { appearance: DEFAULT_APPEARANCE, behavior: DEFAULT_BEHAVIOR },
  saveStatus: { status: 'saved', lastSavedAt: null },
  dynamicWidgets: [],
  initialized: false,

  initialize: async () => {
    try {
      const data = await loadAllData()
      const panels = data.panels.map(pd => pd.panel).sort((a, b) => a.order - b.order)
      const panelWidgets: Record<string, WidgetInstance[]> = {}
      const panelPositions: Record<string, WidgetPosition[]> = {}
      for (const pd of data.panels) {
        panelWidgets[pd.panel.id] = pd.widgets
        panelPositions[pd.panel.id] = pd.positions
      }
      set({
        panels,
        activePanelId: data.activePanelId ?? panels[0]?.id ?? null,
        panelWidgets,
        panelPositions,
        settings: data.settings,
        dynamicWidgets: data.dynamicWidgets,
        initialized: true,
        saveStatus: { status: 'saved', lastSavedAt: Date.now() },
      })
    } catch (err) {
      set({ initialized: true, ...setError(String(err)) })
    }
  },

  addPanel: async (name: string) => {
    const { behavior } = get().settings
    const panels = get().panels
    const newPanel: Panel = {
      id: uuidv4(),
      name,
      order: panels.length,
      settings: { layoutMode: behavior.defaultLayoutMode, gridSize: behavior.defaultGridSize },
    }
    await savePanel(newPanel)
    await saveActivePanelId(newPanel.id)
    set(state => ({
      panels: [...state.panels, newPanel],
      activePanelId: newPanel.id,
      panelWidgets: { ...state.panelWidgets, [newPanel.id]: [] },
      panelPositions: { ...state.panelPositions, [newPanel.id]: [] },
      ...setSaved(state),
    }))
  },

  deletePanel: async (panelId: string) => {
    await dbDeletePanel(panelId)
    set(state => {
      const newPanels = state.panels.filter(p => p.id !== panelId)
      const newPanelWidgets = { ...state.panelWidgets }
      const newPanelPositions = { ...state.panelPositions }
      delete newPanelWidgets[panelId]
      delete newPanelPositions[panelId]
      const newActiveId = state.activePanelId === panelId
        ? newPanels[0]?.id ?? null
        : state.activePanelId
      if (newActiveId) saveActivePanelId(newActiveId)
      return {
        panels: newPanels,
        activePanelId: newActiveId,
        panelWidgets: newPanelWidgets,
        panelPositions: newPanelPositions,
        ...setSaved(state),
      }
    })
  },

  renamePanel: async (panelId: string, name: string) => {
    const panel = get().panels.find(p => p.id === panelId)
    if (!panel) return
    const updated = { ...panel, name }
    await savePanel(updated)
    set(state => ({
      panels: state.panels.map(p => p.id === panelId ? updated : p),
      ...setSaved(state),
    }))
  },

  reorderPanels: async (panels: Panel[]) => {
    const reordered = panels.map((p, i) => ({ ...p, order: i }))
    for (const p of reordered) await savePanel(p)
    set({ panels: reordered })
  },

  setActivePanel: async (panelId: string) => {
    await saveActivePanelId(panelId)
    set({ activePanelId: panelId })
  },

  updatePanelSettings: async (panelId: string, settings: Partial<Panel['settings']>) => {
    const panel = get().panels.find(p => p.id === panelId)
    if (!panel) return
    const updated = { ...panel, settings: { ...panel.settings, ...settings } }
    await savePanel(updated)
    set(state => ({
      panels: state.panels.map(p => p.id === panelId ? updated : p),
      ...setSaved(state),
    }))
  },

  addWidget: async (widgetType: string) => {
    const config = getWidgetConfig(widgetType)
    if (!config) return
    const { activePanelId, panelWidgets, panelPositions } = get()
    if (!activePanelId) return

    const widgetId = uuidv4()
    const newWidget: WidgetInstance = {
      widgetId,
      widgetType,
      state: { ...config.defaultState },
    }

    const existingPositions = panelPositions[activePanelId] ?? []
    const maxZ = existingPositions.reduce((max, p) => Math.max(max, p.zIndex), 0)

    const newPosition: WidgetPosition = {
      widgetId,
      x: 20,
      y: 20,
      w: config.defaultLayout.w,
      h: config.defaultLayout.h,
      zIndex: maxZ + 1,
    }

    const updatedWidgets = [...(panelWidgets[activePanelId] ?? []), newWidget]
    const updatedPositions = [...existingPositions, newPosition]

    await saveWidgets(activePanelId, updatedWidgets)
    await savePositions(activePanelId, updatedPositions)

    set({
      panelWidgets: { ...panelWidgets, [activePanelId]: updatedWidgets },
      panelPositions: { ...panelPositions, [activePanelId]: updatedPositions },
      ...setSaved(get()),
    })
  },

  removeWidget: async (widgetId: string) => {
    const { activePanelId, panelWidgets, panelPositions } = get()
    if (!activePanelId) return

    const updatedWidgets = (panelWidgets[activePanelId] ?? []).filter(w => w.widgetId !== widgetId)
    const updatedPositions = (panelPositions[activePanelId] ?? []).filter(p => p.widgetId !== widgetId)

    await saveWidgets(activePanelId, updatedWidgets)
    await savePositions(activePanelId, updatedPositions)

    set({
      panelWidgets: { ...panelWidgets, [activePanelId]: updatedWidgets },
      panelPositions: { ...panelPositions, [activePanelId]: updatedPositions },
      ...setSaved(get()),
    })
  },

  updateWidgetState: (widgetId: string, partial: Record<string, unknown>) => {
    const { activePanelId, panelWidgets } = get()
    if (!activePanelId) return

    const widgets = panelWidgets[activePanelId] ?? []
    const updatedWidgets = widgets.map(w =>
      w.widgetId === widgetId ? { ...w, state: { ...w.state, ...partial } } : w
    )

    set({ panelWidgets: { ...panelWidgets, [activePanelId]: updatedWidgets } })
    debouncedWidgetStateSave.call(activePanelId, updatedWidgets)
  },

  updateWidgetPosition: (widgetId: string, partial: Partial<WidgetPosition>) => {
    const { activePanelId, panelPositions } = get()
    if (!activePanelId) return

    const positions = panelPositions[activePanelId] ?? []
    const updatedPositions = positions.map(p =>
      p.widgetId === widgetId ? { ...p, ...partial } : p
    )

    set({ panelPositions: { ...panelPositions, [activePanelId]: updatedPositions } })
    debouncedPositionSave.call(activePanelId, updatedPositions)
  },

  updatePositions: (positions: WidgetPosition[]) => {
    const { activePanelId, panelPositions } = get()
    if (!activePanelId) return

    set({ panelPositions: { ...panelPositions, [activePanelId]: positions } })
    debouncedPositionSave.call(activePanelId, positions)
  },

  bringToFront: (widgetId: string) => {
    const { activePanelId, panelPositions } = get()
    if (!activePanelId) return

    const positions = panelPositions[activePanelId] ?? []
    const maxZ = positions.reduce((max, p) => Math.max(max, p.zIndex), 0)
    const updatedPositions = positions.map(p =>
      p.widgetId === widgetId ? { ...p, zIndex: maxZ + 1 } : p
    )

    set({ panelPositions: { ...panelPositions, [activePanelId]: updatedPositions } })
    debouncedPositionSave.call(activePanelId, updatedPositions)
  },

  toggleMinimize: (widgetId: string) => {
    const { activePanelId, panelWidgets } = get()
    if (!activePanelId) return

    const widgets = panelWidgets[activePanelId] ?? []
    const updatedWidgets = widgets.map(w =>
      w.widgetId === widgetId ? { ...w, minimized: !w.minimized } : w
    )

    set({ panelWidgets: { ...panelWidgets, [activePanelId]: updatedWidgets } })
    debouncedWidgetStateSave.call(activePanelId, updatedWidgets)
  },

  updateAppearance: async (partial: Partial<AppSettings['appearance']>) => {
    const newSettings = {
      ...get().settings,
      appearance: { ...get().settings.appearance, ...partial },
    }
    await saveSettings(newSettings)
    set({ settings: newSettings, ...setSaved(get()) })
  },

  updateBehavior: async (partial: Partial<AppSettings['behavior']>) => {
    const newSettings = {
      ...get().settings,
      behavior: { ...get().settings.behavior, ...partial },
    }
    await saveSettings(newSettings)
    set({ settings: newSettings, ...setSaved(get()) })
  },

  addDynamicWidget: async (def: DynamicWidgetDef) => {
    const { registerDynamicWidget } = await import('../utils/evaluateWidget')
    const success = registerDynamicWidget(def)
    if (!success) return false

    await saveDynamicWidget(def)
    set(state => ({
      dynamicWidgets: [...state.dynamicWidgets, def],
      ...setSaved(state),
    }))
    return true
  },

  removeDynamicWidget: async (widgetType: string) => {
    const { unregisterWidget } = await import('../registry')
    unregisterWidget(widgetType)
    await dbDeleteDynamicWidget(widgetType)
    set(state => ({
      dynamicWidgets: state.dynamicWidgets.filter(d => d.widgetType !== widgetType),
      ...setSaved(state),
    }))
  },
}))
```

---

### Task 9: WidgetContainer 重写

**Files:**
- Rewrite: `src/components/WidgetContainer.tsx`

- [ ] **Step 1: 重写 WidgetContainer，支持自由拖拽、调整大小、最小化**

```typescript
import { useCallback, useMemo } from 'react'
import type { ReactNode } from 'react'
import { X, GripVertical, Minus } from 'lucide-react'
import { useDraggable } from '../hooks/useDraggable'
import { useResizable } from '../hooks/useResizable'
import type { WidgetPosition, PanelSettings } from '../types'
import type { WidgetConfig } from '../types'

interface WidgetContainerProps {
  widgetId: string
  title: string
  icon: string
  position: WidgetPosition
  panelSettings: PanelSettings
  config: WidgetConfig
  minimized: boolean
  onMove: (widgetId: string, deltaX: number, deltaY: number) => void
  onResize: (widgetId: string, deltaW: number, deltaH: number) => void
  onDragEnd: () => void
  onResizeEnd: () => void
  onRemove: () => void
  onBringToFront: () => void
  onToggleMinimize: () => void
  children: ReactNode
}

function snapToGrid(value: number, gridSize: number): number {
  return Math.round(value / gridSize) * gridSize
}

export function WidgetContainer({
  widgetId,
  title,
  icon,
  position,
  panelSettings,
  config,
  minimized,
  onMove,
  onResize,
  onDragEnd,
  onResizeEnd,
  onRemove,
  onBringToFront,
  onToggleMinimize,
  children,
}: WidgetContainerProps) {
  const { layoutMode, gridSize } = panelSettings

  const handleMove = useCallback(
    (deltaX: number, deltaY: number) => {
      if (layoutMode === 'grid') {
        onMove(widgetId, snapToGrid(deltaX, gridSize), snapToGrid(deltaY, gridSize))
      } else {
        onMove(widgetId, deltaX, deltaY)
      }
    },
    [layoutMode, gridSize, onMove, widgetId]
  )

  const handleResize = useCallback(
    (deltaW: number, deltaH: number) => {
      const minW = config.defaultLayout.minW ?? 100
      const minH = config.defaultLayout.minH ?? 80
      const newW = Math.max(minW, position.w + deltaW)
      const newH = Math.max(minH, position.h + deltaH)

      if (layoutMode === 'grid') {
        const snappedW = snapToGrid(newW, gridSize)
        const snappedH = snapToGrid(newH, gridSize)
        onResize(widgetId, snappedW - position.w, snappedH - position.h)
      } else {
        onResize(widgetId, newW - position.w, newH - position.h)
      }
    },
    [layoutMode, gridSize, config, position, onResize, widgetId]
  )

  const { handleMouseDown: handleDragStart } = useDraggable({
    onMove: handleMove,
    onEnd: onDragEnd,
  })

  const { handleMouseDown: handleResizeStart } = useResizable({
    onResize: handleResize,
    onEnd: onResizeEnd,
  })

  const containerStyle = useMemo(
    () => ({
      position: 'absolute' as const,
      left: position.x,
      top: position.y,
      width: position.w,
      height: minimized ? 'auto' : position.h,
      zIndex: position.zIndex,
    }),
    [position, minimized]
  )

  return (
    <div
      style={containerStyle}
      className="flex flex-col bg-zinc-900 border border-zinc-800 rounded overflow-hidden shadow-lg"
      onMouseDown={onBringToFront}
    >
      <div
        className="widget-drag-handle flex items-center gap-2 px-3 py-1.5 border-b border-zinc-800 cursor-move select-none"
        style={{ backgroundColor: '#1c1d24' }}
        onMouseDown={handleDragStart}
      >
        <GripVertical size={14} className="text-zinc-500" />
        <span className="text-sm">{icon}</span>
        <span className="text-xs font-medium text-zinc-300 flex-1 truncate">{title}</span>
        <button
          onClick={(e) => { e.stopPropagation(); onToggleMinimize() }}
          className="text-zinc-500 hover:text-zinc-300 transition-colors p-0.5"
        >
          <Minus size={14} />
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); onRemove() }}
          className="text-zinc-500 hover:text-red-400 transition-colors p-0.5"
        >
          <X size={14} />
        </button>
      </div>
      {!minimized && (
        <div className="flex-1 overflow-auto relative">
          {children}
          <div
            className="absolute bottom-0 right-0 w-4 h-4 cursor-se-resize"
            onMouseDown={handleResizeStart}
            style={{
              background: 'linear-gradient(135deg, transparent 50%, rgba(161,161,170,0.3) 50%)',
            }}
          />
        </div>
      )}
    </div>
  )
}
```

---

### Task 10: Workspace 重写

**Files:**
- Rewrite: `src/components/Workspace.tsx`

- [ ] **Step 1: 重写 Workspace 为自由画布容器**

```typescript
import { useCallback, useMemo } from 'react'
import { useAppStore } from '../stores/useAppStore'
import { getWidgetConfig } from '../registry'
import { WidgetContainer } from './WidgetContainer'

export function Workspace() {
  const activePanelId = useAppStore(s => s.activePanelId)
  const panelWidgets = useAppStore(s => s.panelWidgets)
  const panelPositions = useAppStore(s => s.panelPositions)
  const panels = useAppStore(s => s.panels)
  const updateWidgetPosition = useAppStore(s => s.updateWidgetPosition)
  const updatePositions = useAppStore(s => s.updatePositions)
  const removeWidget = useAppStore(s => s.removeWidget)
  const bringToFront = useAppStore(s => s.bringToFront)
  const toggleMinimize = useAppStore(s => s.toggleMinimize)
  const updateWidgetState = useAppStore(s => s.updateWidgetState)

  const activePanel = panels.find(p => p.id === activePanelId)
  const widgets = activePanelId ? (panelWidgets[activePanelId] ?? []) : []
  const positions = activePanelId ? (panelPositions[activePanelId] ?? []) : []

  const handleMove = useCallback(
    (widgetId: string, deltaX: number, deltaY: number) => {
      const pos = positions.find(p => p.widgetId === widgetId)
      if (!pos) return
      updateWidgetPosition(widgetId, {
        x: Math.max(0, pos.x + deltaX),
        y: Math.max(0, pos.y + deltaY),
      })
    },
    [positions, updateWidgetPosition]
  )

  const handleResize = useCallback(
    (widgetId: string, deltaW: number, deltaH: number) => {
      const pos = positions.find(p => p.widgetId === widgetId)
      if (!pos) return
      updateWidgetPosition(widgetId, {
        w: Math.max(100, pos.w + deltaW),
        h: Math.max(80, pos.h + deltaH),
      })
    },
    [positions, updateWidgetPosition]
  )

  const handleDragEnd = useCallback(() => {
    if (!activePanelId) return
    const currentPositions = useAppStore.getState().panelPositions[activePanelId] ?? []
    updatePositions(currentPositions)
  }, [activePanelId, updatePositions])

  const handleResizeEnd = useCallback(() => {
    if (!activePanelId) return
    const currentPositions = useAppStore.getState().panelPositions[activePanelId] ?? []
    updatePositions(currentPositions)
  }, [activePanelId, updatePositions])

  const canvasBackground = useMemo(() => {
    if (!activePanel) return {}
    const { layoutMode, gridSize } = activePanel.settings
    if (layoutMode === 'grid') {
      return {
        backgroundImage: `
          linear-gradient(rgba(255,255,255,0.03) 1px, transparent 1px),
          linear-gradient(90deg, rgba(255,255,255,0.03) 1px, transparent 1px)
        `,
        backgroundSize: `${gridSize}px ${gridSize}px`,
      }
    }
    return {
      backgroundImage: 'radial-gradient(circle, rgba(255,255,255,0.04) 1px, transparent 1px)',
      backgroundSize: '40px 40px',
    }
  }, [activePanel])

  if (!activePanelId) {
    return (
      <div className="flex-1 flex items-center justify-center bg-zinc-950 text-zinc-500">
        <p>请创建或选择一个面板</p>
      </div>
    )
  }

  if (widgets.length === 0) {
    return (
      <div
        className="flex-1 flex items-center justify-center bg-zinc-950 text-zinc-500"
        style={canvasBackground}
      >
        <p>点击上方 + 按钮添加组件</p>
      </div>
    )
  }

  return (
    <div
      className="flex-1 overflow-auto bg-zinc-950 relative"
      style={canvasBackground}
    >
      <div className="relative min-h-full min-w-full" style={{ minHeight: '100%', minWidth: '100%' }}>
        {widgets.map(widget => {
          const config = getWidgetConfig(widget.widgetType)
          if (!config) return null
          const WidgetComponent = config.component
          const pos = positions.find(p => p.widgetId === widget.widgetId)
          if (!pos) return null

          return (
            <WidgetContainer
              key={widget.widgetId}
              widgetId={widget.widgetId}
              title={config.displayName}
              icon={config.icon}
              position={pos}
              panelSettings={activePanel!.settings}
              config={config}
              minimized={!!widget.minimized}
              onMove={handleMove}
              onResize={handleResize}
              onDragEnd={handleDragEnd}
              onResizeEnd={handleResizeEnd}
              onRemove={() => removeWidget(widget.widgetId)}
              onBringToFront={() => bringToFront(widget.widgetId)}
              onToggleMinimize={() => toggleMinimize(widget.widgetId)}
            >
              <WidgetComponent
                widgetId={widget.widgetId}
                state={widget.state}
                onUpdateState={(partial) => updateWidgetState(widget.widgetId, partial)}
              />
            </WidgetContainer>
          )
        })}
      </div>
    </div>
  )
}
```

---

### Task 11: 保存状态指示器

**Files:**
- Create: `src/components/SaveIndicator.tsx`

- [ ] **Step 1: 编写 SaveIndicator 组件**

```typescript
import { useAppStore } from '../stores/useAppStore'
import { Check, Loader2, AlertCircle } from 'lucide-react'

export function SaveIndicator() {
  const saveStatus = useAppStore(s => s.saveStatus)

  if (saveStatus.status === 'saved') {
    return (
      <div className="flex items-center gap-1.5 text-xs text-emerald-500">
        <Check size={12} />
        <span>已保存</span>
      </div>
    )
  }

  if (saveStatus.status === 'saving') {
    return (
      <div className="flex items-center gap-1.5 text-xs text-amber-400">
        <Loader2 size={12} className="animate-spin" />
        <span>保存中...</span>
      </div>
    )
  }

  return (
    <div className="flex items-center gap-1.5 text-xs text-red-400">
      <AlertCircle size={12} />
      <span>保存失败</span>
    </div>
  )
}
```

---

### Task 12: 布局模式切换

**Files:**
- Create: `src/components/LayoutModeToggle.tsx`

- [ ] **Step 1: 编写 LayoutModeToggle 组件**

```typescript
import { LayoutGrid, Move } from 'lucide-react'
import { useAppStore } from '../stores/useAppStore'
import type { PanelSettings } from '../types'

export function LayoutModeToggle() {
  const activePanelId = useAppStore(s => s.activePanelId)
  const panels = useAppStore(s => s.panels)
  const updatePanelSettings = useAppStore(s => s.updatePanelSettings)

  const activePanel = panels.find(p => p.id === activePanelId)
  if (!activePanel) return null

  const currentMode = activePanel.settings.layoutMode

  const handleToggle = async (mode: PanelSettings['layoutMode']) => {
    if (!activePanelId || mode === currentMode) return
    await updatePanelSettings(activePanelId, { layoutMode: mode })
  }

  return (
    <div className="flex items-center gap-0.5 bg-zinc-800 rounded p-0.5">
      <button
        onClick={() => handleToggle('free')}
        className={`p-1.5 rounded transition-colors ${
          currentMode === 'free'
            ? 'bg-zinc-600 text-zinc-100'
            : 'text-zinc-500 hover:text-zinc-300'
        }`}
        title="自由布局"
      >
        <Move size={14} />
      </button>
      <button
        onClick={() => handleToggle('grid')}
        className={`p-1.5 rounded transition-colors ${
          currentMode === 'grid'
            ? 'bg-zinc-600 text-zinc-100'
            : 'text-zinc-500 hover:text-zinc-300'
        }`}
        title="网格布局"
      >
        <LayoutGrid size={14} />
      </button>
    </div>
  )
}
```

---

### Task 13: 设置面板

**Files:**
- Create: `src/components/SettingsPanel.tsx`

- [ ] **Step 1: 编写 SettingsPanel 组件**

```typescript
import { useState } from 'react'
import { X, Palette, Save, Settings2, Puzzle, Download, Upload, Trash2 } from 'lucide-react'
import { useAppStore } from '../stores/useAppStore'
import { getAllWidgetConfigs, getBuiltInWidgetConfigs, getDynamicWidgetConfigs } from '../registry'
import { exportAllData, importAllData, clearAllData } from '../utils/db'
import type { AppSettings } from '../types'

type SettingsTab = 'appearance' | 'data' | 'behavior' | 'widgets'

const TABS: { key: SettingsTab; label: string; icon: typeof Palette }[] = [
  { key: 'appearance', label: '外观', icon: Palette },
  { key: 'data', label: '数据', icon: Save },
  { key: 'behavior', label: '行为', icon: Settings2 },
  { key: 'widgets', label: '组件', icon: Puzzle },
]

const PRESETS: { name: string; settings: Partial<AppSettings['appearance']> }[] = [
  {
    name: '深色默认',
    settings: {
      accentColor: '#3b82f6',
      backgroundColor: '#09090b',
      surfaceColor: '#18181b',
      surfaceBorderColor: '#27272a',
      textColor: '#e4e4e7',
      textMutedColor: '#a1a1aa',
    },
  },
  {
    name: '暖色调',
    settings: {
      accentColor: '#f59e0b',
      backgroundColor: '#1c1917',
      surfaceColor: '#292524',
      surfaceBorderColor: '#44403c',
      textColor: '#fafaf9',
      textMutedColor: '#a8a29e',
    },
  },
  {
    name: '冷色调',
    settings: {
      accentColor: '#06b6d4',
      backgroundColor: '#0c1222',
      surfaceColor: '#1e293b',
      surfaceBorderColor: '#334155',
      textColor: '#f1f5f9',
      textMutedColor: '#94a3b8',
    },
  },
  {
    name: '浅色',
    settings: {
      accentColor: '#3b82f6',
      backgroundColor: '#f8fafc',
      surfaceColor: '#ffffff',
      surfaceBorderColor: '#e2e8f0',
      textColor: '#1e293b',
      textMutedColor: '#64748b',
    },
  },
]

export function SettingsPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [tab, setTab] = useState<SettingsTab>('appearance')
  const appearance = useAppStore(s => s.settings.appearance)
  const behavior = useAppStore(s => s.settings.behavior)
  const updateAppearance = useAppStore(s => s.updateAppearance)
  const updateBehavior = useAppStore(s => s.updateBehavior)
  const removeDynamicWidget = useAppStore(s => s.removeDynamicWidget)

  if (!open) return null

  return (
    <>
      <div className="fixed inset-0 bg-black/30 z-40" onClick={onClose} />
      <div className="fixed right-0 top-0 bottom-0 w-[360px] bg-zinc-900 border-l border-zinc-800 z-50 flex flex-col shadow-2xl">
        <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800">
          <h2 className="text-sm font-semibold text-zinc-200">设置</h2>
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-300 transition-colors">
            <X size={18} />
          </button>
        </div>

        <div className="flex border-b border-zinc-800">
          {TABS.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs transition-colors ${
                tab === key
                  ? 'text-zinc-100 border-b-2 border-blue-500'
                  : 'text-zinc-500 hover:text-zinc-300'
              }`}
            >
              <Icon size={14} />
              {label}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {tab === 'appearance' && (
            <AppearanceTab
              appearance={appearance}
              onUpdate={updateAppearance}
            />
          )}
          {tab === 'data' && <DataTab />}
          {tab === 'behavior' && (
            <BehaviorTab
              behavior={behavior}
              onUpdate={updateBehavior}
            />
          )}
          {tab === 'widgets' && <WidgetsTab onRemoveDynamic={removeDynamicWidget} />}
        </div>
      </div>
    </>
  )
}

function ColorField({
  label,
  value,
  onChange,
}: {
  label: string
  value: string
  onChange: (v: string) => void
}) {
  return (
    <div className="flex items-center justify-between py-1.5">
      <span className="text-xs text-zinc-400">{label}</span>
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-7 h-7 rounded border border-zinc-700 cursor-pointer bg-transparent"
        />
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-20 px-2 py-1 text-xs bg-zinc-800 border border-zinc-700 rounded text-zinc-300 font-mono"
        />
      </div>
    </div>
  )
}

function AppearanceTab({
  appearance,
  onUpdate,
}: {
  appearance: AppSettings['appearance']
  onUpdate: (partial: Partial<AppSettings['appearance']>) => void
}) {
  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-xs font-medium text-zinc-300 mb-2">预设主题</h3>
        <div className="grid grid-cols-2 gap-2">
          {PRESETS.map((preset) => (
            <button
              key={preset.name}
              onClick={() => onUpdate(preset.settings)}
              className="px-3 py-2 text-xs bg-zinc-800 hover:bg-zinc-700 rounded text-zinc-300 transition-colors"
            >
              {preset.name}
            </button>
          ))}
        </div>
      </div>

      <div>
        <h3 className="text-xs font-medium text-zinc-300 mb-2">颜色</h3>
        <div className="space-y-0.5">
          <ColorField label="强调色" value={appearance.accentColor} onChange={(v) => onUpdate({ accentColor: v })} />
          <ColorField label="背景色" value={appearance.backgroundColor} onChange={(v) => onUpdate({ backgroundColor: v, backgroundType: 'color' })} />
          <ColorField label="组件色" value={appearance.surfaceColor} onChange={(v) => onUpdate({ surfaceColor: v })} />
          <ColorField label="边框色" value={appearance.surfaceBorderColor} onChange={(v) => onUpdate({ surfaceBorderColor: v })} />
          <ColorField label="文字色" value={appearance.textColor} onChange={(v) => onUpdate({ textColor: v })} />
          <ColorField label="次要文字" value={appearance.textMutedColor} onChange={(v) => onUpdate({ textMutedColor: v })} />
        </div>
      </div>

      <div>
        <h3 className="text-xs font-medium text-zinc-300 mb-2">字号</h3>
        <div className="flex items-center gap-3">
          <input
            type="range"
            min={12}
            max={20}
            value={appearance.fontSize}
            onChange={(e) => onUpdate({ fontSize: parseInt(e.target.value) })}
            className="flex-1"
          />
          <span className="text-xs text-zinc-400 w-8 text-right">{appearance.fontSize}px</span>
        </div>
      </div>
    </div>
  )
}

function DataTab() {
  const handleExport = async () => {
    const json = await exportAllData()
    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `living-dashboard-backup-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  const handleImport = async () => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.json'
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0]
      if (!file) return
      if (!confirm('导入将覆盖当前所有数据，确定继续吗？')) return
      const text = await file.text()
      try {
        await importAllData(text)
        window.location.reload()
      } catch (err) {
        alert('导入失败：' + String(err))
      }
    }
    input.click()
  }

  const handleClear = async () => {
    if (!confirm('确定要清除所有数据吗？此操作不可恢复！')) return
    await clearAllData()
    window.location.reload()
  }

  return (
    <div className="space-y-3">
      <button
        onClick={handleExport}
        className="w-full flex items-center gap-2 px-4 py-3 bg-zinc-800 hover:bg-zinc-700 rounded text-sm text-zinc-300 transition-colors"
      >
        <Download size={16} />
        导出数据
      </button>
      <button
        onClick={handleImport}
        className="w-full flex items-center gap-2 px-4 py-3 bg-zinc-800 hover:bg-zinc-700 rounded text-sm text-zinc-300 transition-colors"
      >
        <Upload size={16} />
        导入数据
      </button>
      <button
        onClick={handleClear}
        className="w-full flex items-center gap-2 px-4 py-3 bg-zinc-800 hover:bg-red-900/50 rounded text-sm text-red-400 transition-colors"
      >
        <Trash2 size={16} />
        清除所有数据
      </button>
    </div>
  )
}

function BehaviorTab({
  behavior,
  onUpdate,
}: {
  behavior: AppSettings['behavior']
  onUpdate: (partial: Partial<AppSettings['behavior']>) => void
}) {
  return (
    <div className="space-y-4">
      <div>
        <label className="text-xs text-zinc-400 block mb-1">新建面板默认布局</label>
        <select
          value={behavior.defaultLayoutMode}
          onChange={(e) => onUpdate({ defaultLayoutMode: e.target.value as 'free' | 'grid' })}
          className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded text-sm text-zinc-300"
        >
          <option value="free">自由布局</option>
          <option value="grid">网格布局</option>
        </select>
      </div>

      <div>
        <label className="text-xs text-zinc-400 block mb-1">默认网格大小</label>
        <div className="flex items-center gap-3">
          <input
            type="range"
            min={10}
            max={50}
            step={5}
            value={behavior.defaultGridSize}
            onChange={(e) => onUpdate({ defaultGridSize: parseInt(e.target.value) })}
            className="flex-1"
          />
          <span className="text-xs text-zinc-400 w-10 text-right">{behavior.defaultGridSize}px</span>
        </div>
      </div>

      <div>
        <label className="text-xs text-zinc-400 block mb-1">启动时显示</label>
        <select
          value={behavior.startupPanel}
          onChange={(e) => onUpdate({ startupPanel: e.target.value })}
          className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded text-sm text-zinc-300"
        >
          <option value="last">上次活跃面板</option>
          <option value="first">第一个面板</option>
        </select>
      </div>

      <div className="flex items-center justify-between">
        <span className="text-xs text-zinc-400">删除前确认</span>
        <button
          onClick={() => onUpdate({ confirmBeforeDelete: !behavior.confirmBeforeDelete })}
          className={`w-10 h-5 rounded-full transition-colors ${
            behavior.confirmBeforeDelete ? 'bg-blue-500' : 'bg-zinc-700'
          }`}
        >
          <div
            className={`w-4 h-4 rounded-full bg-white transition-transform ${
              behavior.confirmBeforeDelete ? 'translate-x-5' : 'translate-x-0.5'
            }`}
          />
        </button>
      </div>
    </div>
  )
}

function WidgetsTab({ onRemoveDynamic }: { onRemoveDynamic: (type: string) => void }) {
  const builtIn = getBuiltInWidgetConfigs()
  const dynamic = getDynamicWidgetConfigs()

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-xs font-medium text-zinc-300 mb-2">内置组件</h3>
        <div className="space-y-1">
          {builtIn.map((config) => (
            <div key={config.widgetType} className="flex items-center gap-2 px-3 py-2 bg-zinc-800 rounded">
              <span>{config.icon}</span>
              <span className="text-sm text-zinc-300 flex-1">{config.displayName}</span>
              <span className="text-[10px] text-zinc-600">内置</span>
            </div>
          ))}
        </div>
      </div>

      {dynamic.length > 0 && (
        <div>
          <h3 className="text-xs font-medium text-zinc-300 mb-2">动态组件</h3>
          <div className="space-y-1">
            {dynamic.map((config) => (
              <div key={config.widgetType} className="flex items-center gap-2 px-3 py-2 bg-zinc-800 rounded">
                <span>{config.icon}</span>
                <span className="text-sm text-zinc-300 flex-1">{config.displayName}</span>
                <button
                  onClick={() => onRemoveDynamic(config.widgetType)}
                  className="text-zinc-600 hover:text-red-400 transition-colors"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
```

---

### Task 14: Sidebar 更新

**Files:**
- Modify: `src/components/Sidebar.tsx`

- [ ] **Step 1: 更新 Sidebar，增加布局模式图标和复制面板功能**

在现有 Sidebar 代码基础上修改：

1. 导入 `LayoutGrid, Move, Copy` 图标
2. 面板标签中增加布局模式小图标（在名称右边）
3. 右键菜单增加"复制面板"选项
4. `handleDuplicate` 函数：复制面板及其组件和位置数据

关键修改点：

```typescript
import { Plus, X, LayoutGrid, Move, Copy } from 'lucide-react'

// 在面板标签渲染中，名称后增加布局模式图标
{editingId === panel.id ? (
  // ... existing input
) : (
  <span className="truncate block flex-1">{panel.name}</span>
  {panel.settings?.layoutMode === 'grid' ? (
    <LayoutGrid size={12} className="text-zinc-600 flex-shrink-0" />
  ) : (
    <Move size={12} className="text-zinc-600 flex-shrink-0" />
  )}
)}

// 右键菜单增加复制选项
<button
  onClick={() => handleDuplicate(contextMenu.panelId)}
  className="w-full px-4 py-1.5 text-sm text-zinc-300 hover:bg-zinc-700 text-left flex items-center gap-2"
>
  <Copy size={14} />
  复制面板
</button>
```

`handleDuplicate` 实现：

```typescript
const handleDuplicate = async (panelId: string) => {
  const panel = useAppStore.getState().panels.find(p => p.id === panelId)
  if (!panel) return
  const widgets = useAppStore.getState().panelWidgets[panelId] ?? []
  const positions = useAppStore.getState().panelPositions[panelId] ?? []

  const newPanelId = uuidv4()
  const newPanel: Panel = {
    id: newPanelId,
    name: `${panel.name} (副本)`,
    order: useAppStore.getState().panels.length,
    settings: { ...panel.settings },
  }

  const widgetIdMap = new Map<string, string>()
  const newWidgets: WidgetInstance[] = widgets.map(w => {
    const newId = uuidv4()
    widgetIdMap.set(w.widgetId, newId)
    return { ...w, widgetId: newId }
  })
  const newPositions: WidgetPosition[] = positions.map(p => ({
    ...p,
    widgetId: widgetIdMap.get(p.widgetId) ?? p.widgetId,
    x: p.x + 20,
    y: p.y + 20,
  }))

  await savePanel(newPanel)
  await saveWidgets(newPanelId, newWidgets)
  await savePositions(newPanelId, newPositions)
  await saveActivePanelId(newPanelId)

  set(state => ({
    panels: [...state.panels, newPanel],
    activePanelId: newPanelId,
    panelWidgets: { ...state.panelWidgets, [newPanelId]: newWidgets },
    panelPositions: { ...state.panelPositions, [newPanelId]: newPositions },
  }))
  setContextMenu(null)
}
```

---

### Task 15: App.tsx 集成

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: 集成新组件到 App**

```typescript
import { useEffect, useState } from 'react'
import { Settings } from 'lucide-react'
import { Sidebar } from './components/Sidebar'
import { Workspace } from './components/Workspace'
import { AddWidgetMenu } from './components/AddWidgetMenu'
import { SaveIndicator } from './components/SaveIndicator'
import { LayoutModeToggle } from './components/LayoutModeToggle'
import { SettingsPanel } from './components/SettingsPanel'
import { useAppStore } from './stores/useAppStore'

export default function App() {
  const initialize = useAppStore(s => s.initialize)
  const initialized = useAppStore(s => s.initialized)
  const activePanelId = useAppStore(s => s.activePanelId)
  const panels = useAppStore(s => s.panels)
  const appearance = useAppStore(s => s.settings.appearance)
  const activePanel = panels.find(p => p.id === activePanelId)
  const [settingsOpen, setSettingsOpen] = useState(false)

  useEffect(() => {
    initialize()
  }, [initialize])

  if (!initialized) {
    return (
      <div className="h-screen w-screen flex items-center justify-center text-zinc-500"
        style={{ backgroundColor: appearance.backgroundColor }}>
        <p>加载中...</p>
      </div>
    )
  }

  return (
    <div
      className="h-screen w-screen flex overflow-hidden"
      style={{
        backgroundColor: appearance.backgroundColor,
        color: appearance.textColor,
        fontSize: appearance.fontSize,
      }}
    >
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <header
          className="h-10 min-h-[40px] flex items-center justify-between px-4 border-b"
          style={{ backgroundColor: appearance.surfaceColor, borderColor: appearance.surfaceBorderColor }}
        >
          <span className="text-sm truncate" style={{ color: appearance.textMutedColor }}>
            {activePanel ? activePanel.name : 'Living Dashboard'}
          </span>
          <div className="flex items-center gap-2">
            <LayoutModeToggle />
            <SaveIndicator />
            <AddWidgetMenu />
            <button
              onClick={() => setSettingsOpen(true)}
              className="p-1.5 rounded transition-colors hover:bg-zinc-800"
              style={{ color: appearance.textMutedColor }}
            >
              <Settings size={16} />
            </button>
          </div>
        </header>
        <Workspace />
      </div>
      <SettingsPanel open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  )
}
```

---

### Task 16: CSS 更新

**Files:**
- Modify: `src/index.css`

- [ ] **Step 1: 移除 react-grid-layout 样式，新增画布样式**

```css
@import "tailwindcss";

.widget-drag-handle {
  cursor: move;
  user-select: none;
}

.widget-drag-handle:hover {
  background-color: rgba(255, 255, 255, 0.03);
}

input[type="range"] {
  -webkit-appearance: none;
  appearance: none;
  height: 4px;
  background: #3f3f46;
  border-radius: 9999px;
  outline: none;
}

input[type="range"]::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: #a1a1aa;
  cursor: pointer;
}

input[type="range"]::-moz-range-thumb {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: #a1a1aa;
  cursor: pointer;
  border: none;
}

select {
  outline: none;
}

select:focus {
  border-color: #3b82f6;
}
```

---

### Task 17: main.tsx 更新

**Files:**
- Modify: `src/main.tsx`

- [ ] **Step 1: 启动时加载动态组件**

```typescript
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import './components/widgets/PdfViewer'
import './components/widgets/MusicPlayer'
import './components/widgets/MarkdownEditor'
import './components/widgets/Clock'
import { loadAndRegisterDynamicWidgets } from './utils/evaluateWidget'

async function bootstrap() {
  const { getAllDynamicWidgets } = await import('./utils/db')
  const defs = await getAllDynamicWidgets()
  loadAndRegisterDynamicWidgets(defs)

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}

bootstrap()
```

---

### Task 18: 移除 react-grid-layout 依赖

**Files:**
- Modify: `package.json`

- [ ] **Step 1: 卸载 react-grid-layout**

Run: `$env:PATH = "D:\nodejs\node-v22.16.0-win-x64;" + $env:PATH; cd f:\allmylife\event; npm uninstall react-grid-layout`

- [ ] **Step 2: 清理所有 react-grid-layout 导入**

搜索代码中所有 `from 'react-grid-layout'` 的导入并移除。主要在：
- `src/types/index.ts` — 移除 `import type { Layout } from 'react-grid-layout'`
- `src/utils/db.ts` — 移除 `import type { Layout } from 'react-grid-layout'`
- `src/utils/migration.ts` — 保留 `import type { Layout } from 'react-grid-layout'`（迁移需要，但运行时可能已卸载）

对于 migration.ts，将 Layout 类型内联定义：

```typescript
interface V1LayoutItem {
  i: string
  x: number
  y: number
  w: number
  h: number
}
type V1Layout = V1LayoutItem[]
```

替换 migration.ts 中的导入。

---

### Task 19: 内置组件适配

**Files:**
- Modify: `src/components/widgets/PdfViewer.tsx`
- Modify: `src/components/widgets/MusicPlayer.tsx`
- Modify: `src/components/widgets/MarkdownEditor.tsx`
- Modify: `src/components/widgets/Clock.tsx`

- [ ] **Step 1: 更新内置组件的 defaultLayout 为像素值**

各组件的 `defaultLayout` 需要从网格单位改为像素值：

PdfViewer:
```typescript
defaultLayout: { w: 600, h: 480, minW: 300, minH: 240 }
```

MusicPlayer:
```typescript
defaultLayout: { w: 400, h: 360, minW: 250, minH: 200 }
```

MarkdownEditor:
```typescript
defaultLayout: { w: 700, h: 400, minW: 400, minH: 250 }
```

Clock:
```typescript
defaultLayout: { w: 240, h: 240, minW: 180, minH: 180 }
```

---

### Task 20: 构建验证与修复

- [ ] **Step 1: 运行 TypeScript 编译检查**

Run: `$env:PATH = "D:\nodejs\node-v22.16.0-win-x64;" + $env:PATH; cd f:\allmylife\event; npx tsc --noEmit`

修复所有类型错误。

- [ ] **Step 2: 运行 ESLint**

Run: `$env:PATH = "D:\nodejs\node-v22.16.0-win-x64;" + $env:PATH; cd f:\allmylife\event; npm run lint`

修复所有 lint 错误。

- [ ] **Step 3: 运行 Vite 构建**

Run: `$env:PATH = "D:\nodejs\node-v22.16.0-win-x64;" + $env:PATH; cd f:\allmylife\event; npm run build`

确保构建成功。

- [ ] **Step 4: 启动开发服务器手动验证**

Run: `$env:PATH = "D:\nodejs\node-v22.16.0-win-x64;" + $env:PATH; cd f:\allmylife\event; npm run dev`

验证：
1. 创建新面板
2. 添加组件到面板
3. 自由拖拽组件
4. 切换到网格模式，验证 snap 行为
5. 打开设置面板，切换主题
6. 导出/导入数据
7. 刷新页面，验证状态恢复

---

## Task Dependencies

- Task 1 (types) → Task 2, 3, 4, 7, 8
- Task 2 (migration) → Task 3 (db)
- Task 3 (db) → Task 8 (store)
- Task 5, 6 (hooks) → Task 9 (WidgetContainer)
- Task 7 (registry) → Task 8 (store)
- Task 8 (store) → Task 9, 10, 11, 12, 13, 14, 15
- Task 9 (WidgetContainer) → Task 10 (Workspace)
- Task 10 (Workspace) → Task 15 (App)
- Task 11, 12, 13 → Task 15 (App)
- Task 14 (Sidebar) → Task 15 (App)
- Task 16, 17, 18, 19 → Task 20 (验证)

## Recommended Execution Order

1. Task 1 (types) — 基础
2. Task 2 (migration) + Task 7 (registry) — 可并行
3. Task 3 (db) + Task 4 (evaluate) + Task 5 (draggable) + Task 6 (resizable) — 可并行
4. Task 8 (store) — 依赖 1,2,3,7
5. Task 9 (WidgetContainer) — 依赖 5,6,8
6. Task 10 (Workspace) — 依赖 9
7. Task 11 (SaveIndicator) + Task 12 (LayoutModeToggle) + Task 13 (SettingsPanel) — 可并行，依赖 8
8. Task 14 (Sidebar) — 依赖 8
9. Task 15 (App) — 依赖 10,11,12,13,14
10. Task 16 (CSS) + Task 17 (main) + Task 18 (remove dep) + Task 19 (widget defaults) — 可并行
11. Task 20 (验证) — 最终
