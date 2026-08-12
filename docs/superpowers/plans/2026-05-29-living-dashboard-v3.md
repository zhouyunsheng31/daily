# Living Dashboard V3 - UI重写+Bug修复 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking。

**Goal:** 修复拖拽抖动bug，基于DailyLife设计系统全面重写UI层，实现生产级视觉质量。

**Architecture:** 保留现有Store/DB/Registry/Types不变，修复hooks中的stale closure问题，用DailyLife Design Token（CSS变量）替换所有硬编码颜色/间距，重写每个组件的样式层以达成高质量视觉效果。核心修改：useDraggable用useRef存最新回调、CSS变量系统、组件级样式重写。

**Tech Stack:** React 19 + TypeScript + Vite + Zustand + Tailwind CSS v4 + IndexedDB (dexie)
**Design Reference:** F:\allmylife\dailylife\design\ (DailyLife Design System)

---

## DailyLife Design Tokens (CSS变量映射)

| Token | 值 | 用途 |
|-------|-----|------|
| `--color-primary` | `#4A90E2` | 主色-天空蓝 |
| `--color-secondary` | `#50E3C2` | 辅色-薄荷绿 |
| `--color-accent` | `#FF6B6B` | 强调色-珊瑚红 |
| `--bg-main` | `#1C1C1E` | 深色主背景 |
| `--bg-surface` | `#2C2C2E` | 深色表面 |
| `--bg-elevated` | `#3A3A3C` | 深色浮起 |
| `--text-primary` | `#FFFFFF` | 主文字 |
| `--text-secondary` | `#98989D` | 次文字 |
| `--border-color` | `#38383A` | 边框 |
| `--radius-sm` | `4px` | 小圆角 |
| `--radius-md` | `8px` | 中圆角 |
| `--radius-lg` | `12px` | 大圆角 |
| `--radius-xl` | `16px` | 超大圆角 |
| `--shadow-sm` | `0 1px 2px rgba(0,0,0,0.3)` | 小阴影 |
| `--shadow-md` | `0 4px 12px rgba(0,0,0,0.4)` | 中阴影 |
| `--shadow-lg` | `0 8px 24px rgba(0,0,0,0.5)` | 大阴影 |

---

### Task 1: 修复 useDraggable stale closure bug + 重写 useResizable 同样问题

**Files:**
- Modify: `src/hooks/useDraggable.ts`
- Modify: `src/hooks/useResizable.ts`

**Bug根因:** `handleMouseMove`闭包在mousedown时捕获了当时的`onMove`，但React每次position更新后`onMove`(Workspace.handleMove)引用变化，导致listener持有过期回调读取旧positions值→抖动。

**修复方案:** 使用`useRef`存储最新的onMove/onEnd回调，mousemove/mouseup listener始终从ref读取当前值。

- [ ] **Step 1: 重写 useDraggable.ts**

```typescript
import { useCallback, useEffect, useRef } from 'react'

interface UseDraggableOptions {
  enabled?: boolean
  onMove: (deltaX: number, deltaY: number) => void
  onEnd?: () => void
}

export function useDraggable({ enabled = true, onMove, onEnd }: UseDraggableOptions) {
  const dragState = useRef({ isDragging: false, startX: 0, startY: 0 })
  const onMoveRef = useRef(onMove)
  const onEndRef = useRef(onEnd)

  useEffect(() => { onMoveRef.current = onMove }, [onMove])
  useEffect(() => { if (onEnd) onEndRef.current = onEnd }, [onEnd])

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (!enabled) return
      e.preventDefault()
      dragState.current = { isDragging: true, startX: e.clientX, startY: e.clientY }

      const handleMouseMove = (e: MouseEvent) => {
        if (!dragState.current.isDragging) return
        const deltaX = e.clientX - dragState.current.startX
        const deltaY = e.clientY - dragState.current.startY
        dragState.current.startX = e.clientX
        dragState.current.startY = e.clientY
        onMoveRef.current(deltaX, deltaY)
      }

      const handleMouseUp = () => {
        if (!dragState.current.isDragging) return
        dragState.current.isDragging = false
        document.removeEventListener('mousemove', handleMouseMove)
        document.removeEventListener('mouseup', handleMouseUp)
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
        onEndRef.current?.()
      }

      document.addEventListener('mousemove', handleMouseMove)
      document.addEventListener('mouseup', handleMouseUp)
      document.body.style.cursor = 'grabbing'
      document.body.style.userSelect = 'none'
    },
    [enabled]
  )

  return { handleMouseDown, isDragging: () => dragState.current.isDragging }
}
```

- [ ] **Step 2: 重写 useResizable.ts（同样用useRef模式）**

```typescript
import { useCallback, useEffect, useRef } from 'react'

interface UseResizableOptions {
  enabled?: boolean
  onResize: (deltaW: number, deltaH: number) => void
  onEnd?: () => void
}

export function useResizable({ enabled = true, onResize, onEnd }: UseResizableOptions) {
  const resizeState = useRef({ isResizing: false, startX: 0, startY: 0, startW: 0, startH: 0 })
  const onResizeRef = useRef(onResize)
  const onEndRef = useRef(onEnd)

  useEffect(() => { onResizeRef.current = onResize }, [onResize])
  useEffect(() => { if (onEnd) onEndRef.current = onEnd }, [onEnd])

  const handleMouseDown = useCallback(
    (e: React.MouseEvent, direction: 'se' | 'e' | 's' = 'se') => {
      if (!enabled) return
      e.preventDefault()
      e.stopPropagation()

      const target = e.currentTarget as HTMLElement
      const rect = target.parentElement?.getBoundingClientRect()
      if (!rect) return

      resizeState.current = {
        isResizing: true,
        startX: e.clientX,
        startY: e.clientY,
        startW: rect.width,
        startH: rect.height,
      }

      const handleMouseMove = (e: MouseEvent) => {
        if (!resizeState.current.isResizing) return
        let deltaW = 0, deltaH = 0
        if (direction === 'se' || direction === 'e') deltaW = e.clientX - resizeState.current.startX
        if (direction === 'se' || direction === 's') deltaH = e.clientY - resizeState.current.startY
        const minSize = 200
        deltaW = Math.max(minSize - resizeState.current.startW, deltaW)
        deltaH = Math.max(150 - resizeState.current.startH, deltaH)
        onResizeRef.current(deltaW, deltaH)
      }

      const handleMouseUp = () => {
        if (!resizeState.current.isResizing) return
        resizeState.current.isResizing = false
        document.removeEventListener('mousemove', handleMouseMove)
        document.removeEventListener('mouseup', handleMouseUp)
        document.body.style.cursor = ''
        onEndRef.current?.()
      }

      document.addEventListener('mousemove', handleMouseMove)
      document.addEventListener('mouseup', handleMouseUp)
      document.body.style.cursor =
        direction === 'se' ? 'nwse-resize' : direction === 'e' ? 'ew-resize' : 'ns-resize'
    },
    [enabled]
  )

  return { handleMouseDown }
}
```

- [ ] **Step 3: 验证TypeScript编译通过**

Run: `npx tsc --noEmit`
Expected: 无错误

---

### Task 2: 重写 CSS 设计系统 (index.css)

**Files:**
- Modify: `src/index.css`

- [ ] **Step 1: 完全重写 index.css 为 DailyLife Design Token 系统**

完整内容（直接写入文件）：

```css
@import "tailwindcss";

/* ============================================
   DailyLiving Dashboard - Design System
   基于 F:\allmylife\dailylife\design\ 规范
   ============================================ */

/* --- Design Tokens (CSS Variables) --- */
:root {
  /* Brand Colors */
  --color-primary: #4A90E2;
  --color-primary-light: #6BA3E8;
  --color-primary-dark: #3A7BC2;
  --color-primary-muted: rgba(74, 144, 226, 0.15);
  --color-secondary: #50E3C2;
  --color-secondary-light: #7AEBCF;
  --color-secondary-dark: #45C9A8;
  --color-accent: #FF6B6B;
  --color-accent-light: #FF8585;

  /* Dark Theme Surfaces */
  --bg-canvas: #1C1C1E;
  --bg-surface: #2C2C2E;
  --bg-elevated: #3A3A3C;
  --bg-hover: rgba(255, 255, 255, 0.06);
  --bg-active: rgba(255, 255, 255, 0.10);

  /* Text */
  --text-primary: #F5F5F7;
  --text-secondary: #98989D;
  --text-tertiary: #636366;
  --text-inverse: #1D1D1F;

  /* Borders & Dividers */
  --border-subtle: rgba(255, 255, 255, 0.08);
  --border-default: rgba(255, 255, 255, 0.12);
  --border-strong: rgba(255, 255, 255, 0.18);

  /* Status Colors */
  --color-success: #34C759;
  --color-warning: #FF9500;
  --color-error: #FF3B30;
  --color-info: #007AFF;

  /* Spacing Scale (4px base) */
  --space-xs: 4px;
  --space-sm: 8px;
  --space-md: 16px;
  --space-lg: 24px;
  --space-xl: 32px;
  --space-2xl: 48px;

  /* Radius Scale */
  --radius-sm: 6px;
  --radius-md: 10px;
  --radius-lg: 14px;
  --radius-xl: 18px;

  /* Shadow System */
  --shadow-sm: 0 1px 3px rgba(0, 0, 0, 0.35), 0 1px 2px rgba(0, 0, 0, 0.25);
  --shadow-md: 0 4px 12px rgba(0, 0, 0, 0.4), 0 2px 4px rgba(0, 0, 0, 0.25);
  --shadow-lg: 0 8px 28px rgba(0, 0, 0, 0.5), 0 4px 8px rgba(0, 0, 0, 0.3);
  --shadow-xl: 0 16px 40px rgba(0, 0, 0, 0.55), 0 8px 16px rgba(0, 0, 0, 0.3);
  --shadow-glow: 0 0 20px rgba(74, 144, 226, 0.15);

  /* Transitions */
  --ease-out: cubic-bezier(0.16, 1, 0.3, 1);
  --ease-in-out: cubic-bezier(0.65, 0, 0.35, 1);
  --duration-fast: 150ms;
  --duration-normal: 250ms;
  --duration-slow: 400ms;

  /* Z-Index Scale */
  --z-widget: 100;
  --z-widget-active: 200;
  --z-dropdown: 300;
  --z-overlay: 400;
  --z-modal: 500;

  /* Layout Constants */
  --sidebar-width: 240px;
  --toolbar-height: 44px;
  --widget-header-height: 38px;
}

/* --- Global Reset & Base --- */
*, *::before, *::after {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

html {
  font-size: 14px;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  text-rendering: optimizeLegibility;
}

body {
  font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Segoe UI',
               'PingFang SC', 'Noto Sans SC', 'Microsoft YaHei', sans-serif;
  color: var(--text-primary);
  background: var(--bg-canvas);
  overflow: hidden;
  height: 100vh;
  width: 100vw;
  line-height: 1.5;
  letter-spacing: -0.01em;
}

#root {
  height: 100vh;
  width: 100vw;
  overflow: hidden;
}

/* --- Scrollbar Styling --- */
::-webkit-scrollbar {
  width: 6px;
  height: 6px;
}
::-webkit-scrollbar-track {
  background: transparent;
}
::-webkit-scrollbar-thumb {
  background: var(--border-default);
  border-radius: 3px;
}
::-webkit-scrollbar-thumb:hover {
  background: var(--border-strong);
}

/* --- Focus Ring --- */
:focus-visible {
  outline: 2px solid var(--color-primary);
  outline-offset: 2px;
  border-radius: 2px;
}

/* --- Selection --- */
::selection {
  background: var(--color-primary-muted);
  color: var(--text-primary);
}

/* ============================================
   Component Styles
   ============================================ */

/* Sidebar */
.sidebar {
  width: var(--sidebar-width);
  min-width: var(--sidebar-width);
  background: var(--bg-surface);
  border-right: 1px solid var(--border-subtle);
  display: flex;
  flex-direction: column;
  height: 100vh;
  transition: width var(--duration-normal) var(--ease-out);
}

.sidebar-header {
  padding: var(--space-md) var(--space-lg);
  border-bottom: 1px solid var(--border-subtle);
  display: flex;
  align-items: center;
  gap: var(--space-sm);
}

.sidebar-logo {
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--color-primary);
  background: linear-gradient(135deg, var(--color-primary-light), var(--color-secondary));
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}

.sidebar-tabs {
  flex: 1;
  overflow-y: auto;
  padding: var(--space-sm) var(--space-xs);
}

.sidebar-tab {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  padding: 8px 12px;
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: all var(--duration-fast) var(--ease-out);
  color: var(--text-secondary);
  font-size: 13px;
  border: none;
  background: transparent;
  width: 100%;
  text-align: left;
}

.sidebar-tab:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.sidebar-tab.active {
  background: var(--color-primary-muted);
  color: var(--color-primary-light);
  font-weight: 600;
}

.tab-actions {
  margin-left: auto;
  opacity: 0;
  transition: opacity var(--duration-fast);
}

.sidebar-tab:hover .tab-actions,
.sidebar-tab.active .tab-actions {
  opacity: 1;
}

.tab-action-btn {
  padding: 2px 4px;
  border-radius: 4px;
  border: none;
  background: transparent;
  color: inherit;
  cursor: pointer;
  opacity: 0.6;
  transition: all var(--duration-fast);
  display: flex;
  align-items: center;
  justify-content: center;
}

.tab-action-btn:hover {
  opacity: 1;
  background: var(--bg-hover);
}

.tab-action-btn.danger:hover {
  color: var(--color-error);
  background: rgba(255, 59, 48, 0.1);
}

.sidebar-footer {
  padding: var(--space-sm) var(--space-md);
  border-top: 1px solid var(--border-subtle);
}

.new-panel-btn {
  width: 100%;
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  padding: 9px 14px;
  border-radius: var(--radius-md);
  border: 1px dashed var(--border-default);
  background: transparent;
  color: var(--text-secondary);
  font-size: 13px;
  cursor: pointer;
  transition: all var(--duration-fast) var(--ease-out);
}

.new-panel-btn:hover {
  border-color: var(--color-primary);
  color: var(--color-primary-light);
  background: var(--color-primary-muted);
}

/* Toolbar / Header Bar */
.toolbar {
  height: var(--toolbar-height);
  min-height: var(--toolbar-height);
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 var(--space-lg);
  border-bottom: 1px solid var(--border-subtle);
  background: var(--bg-surface);
  backdrop-filter: blur(20px) saturate(180%);
  -webkit-backdrop-filter: blur(20px) saturate(180%);
  z-index: var(--z-dropdown);
}

.toolbar-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-secondary);
  max-width: 280px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.toolbar-actions {
  display: flex;
  align-items: center;
  gap: var(--space-xs);
}

.toolbar-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 6px 12px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border-subtle);
  background: var(--bg-elevated);
  color: var(--text-secondary);
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: all var(--duration-fast) var(--ease-out);
  white-space: nowrap;
}

.toolbar-btn:hover {
  border-color: var(--border-default);
  color: var(--text-primary);
  background: var(--bg-hover);
}

.toolbar-btn.primary {
  border-color: var(--color-primary);
  background: var(--color-primary-muted);
  color: var(--color-primary-light);
}

.toolbar-btn.primary:hover {
  background: var(--color-primary);
  color: white;
}

/* Save Indicator */
.save-indicator {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.02em;
  padding: 3px 10px;
  border-radius: 20px;
  transition: all var(--duration-fast) var(--ease-out);
}

.save-indicator.saved {
  color: var(--color-secondary);
  background: rgba(80, 227, 194, 0.10);
}

.save-indicator.saving {
  color: var(--color-warning);
  background: rgba(255, 149, 0, 0.10);
}

.save-indicator.error {
  color: var(--color-error);
  background: rgba(255, 59, 48, 0.10);
}

/* Workspace / Canvas */
.workspace {
  flex: 1;
  position: relative;
  overflow: hidden;
  background: var(--bg-canvas);
  transition: background-image var(--duration-slow) var(--ease-out);
}

.workspace.grid-mode {
  background-image:
    linear-gradient(var(--border-subtle) 1px, transparent 1px),
    linear-gradient(90deg, var(--border-subtle) 1px, transparent 1px);
  background-size: 20px 20px;
  background-position: -1px -1px;
}

.workspace-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: var(--text-tertiary);
  gap: var(--space-sm);
}

.workspace-empty-icon {
  width: 56px;
  height: 56px;
  border-radius: var(--radius-lg);
  background: var(--bg-elevated);
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-tertiary);
  margin-bottom: var(--space-xs);
}

.workspace-empty-text {
  font-size: 14px;
  color: var(--text-tertiary);
}

/* Widget Container */
.widget-container {
  position: absolute;
  border-radius: var(--radius-md);
  overflow: hidden;
  transition: box-shadow var(--duration-fast) var(--ease-out),
              transform var(--duration-fast) var(--ease-out),
              opacity var(--duration-fast) var(--ease-out);
  box-shadow: var(--shadow-md);
  border: 1px solid var(--border-subtle);
  background: var(--bg-surface);
  display: flex;
  flex-direction: column;
}

.widget-container:hover {
  box-shadow: var(--shadow-lg);
  border-color: var(--border-default);
}

.widget-container.dragging {
  opacity: 0.92;
  box-shadow: var(--shadow-xl);
  transform: scale(1.01);
  z-index: var(--z-widget-active) !important;
  cursor: grabbing;
}

.widget-container.minimized {
  height: auto !important;
}

.widget-header {
  height: var(--widget-header-height);
  min-height: var(--widget-header-height);
  display: flex;
  align-items: center;
  padding: 0 var(--space-sm);
  background: var(--bg-elevated);
  border-bottom: 1px solid var(--border-subtle);
  cursor: grab;
  user-select: none;
  flex-shrink: 0;
  gap: var(--space-sm);
}

.widget-header:active {
  cursor: grabbing;
}

.widget-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-primary);
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  letter-spacing: 0.01em;
}

.widget-actions {
  display: flex;
  align-items: center;
  gap: 2px;
  flex-shrink: 0;
}

.widget-action-btn {
  width: 24px;
  height: 24px;
  border-radius: 5px;
  border: none;
  background: transparent;
  color: var(--text-tertiary);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all var(--duration-fast) var(--ease-out);
}

.widget-action-btn:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.widget-action-btn.close-btn:hover {
  color: var(--color-error);
  background: rgba(255, 59, 48, 0.1);
}

.widget-body {
  flex: 1;
  overflow: auto;
  background: var(--bg-surface);
  position: relative;
}

.resize-handle {
  position: absolute;
  bottom: 0;
  right: 0;
  width: 16px;
  height: 16px;
  cursor: nwse-resize;
  z-index: 10;
}

.resize-handle::after {
  content: '';
  position: absolute;
  bottom: 3px;
  right: 3px;
  width: 8px;
  height: 8px;
  border-right: 2px solid var(--border-default);
  border-bottom: 2px solid var(--border-default);
  border-radius: 0 0 3px 0;
  opacity: 0;
  transition: opacity var(--duration-fast);
}

.widget-container:hover .resize-handle::after {
  opacity: 1;
}

/* Add Widget Menu Dropdown */
.widget-menu-overlay {
  position: fixed;
  inset: 0;
  z-index: var(--z-overlay);
  background: transparent;
}

.widget-menu {
  position: absolute;
  top: calc(var(--toolbar-height) + 4px);
  right: var(--space-md);
  z-index: var(--z-dropdown);
  min-width: 220px;
  background: var(--bg-elevated);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-lg);
  padding: var(--space-xs);
  animation: menuIn 0.15s var(--ease-out);
}

@keyframes menuIn {
  from {
    opacity: 0;
    transform: translateY(-6px) scale(0.97);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}

.widget-menu-item {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  padding: 9px 12px;
  border-radius: var(--radius-sm);
  border: none;
  background: transparent;
  color: var(--text-primary);
  font-size: 13px;
  cursor: pointer;
  width: 100%;
  text-align: left;
  transition: all var(--duration-fast) var(--ease-out);
}

.widget-menu-item:hover {
  background: var(--color-primary-muted);
  color: var(--color-primary-light);
}

.widget-menu-item .menu-icon {
  width: 32px;
  height: 32px;
  border-radius: var(--radius-sm);
  background: var(--bg-hover);
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-secondary);
  font-size: 15px;
  flex-shrink: 0;
}

.widget-menu-item .menu-text {
  flex: 1;
}

.widget-menu-item .menu-desc {
  font-size: 11px;
  color: var(--text-tertiary);
}

/* Settings Panel */
.settings-overlay {
  position: fixed;
  inset: 0;
  z-index: var(--z-overlay);
  background: rgba(0, 0, 0, 0.6);
  backdrop-filter: blur(4px);
  animation: fadeIn 0.2s ease;
}

@keyframes fadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}

.settings-panel {
  position: fixed;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  z-index: var(--z-modal);
  width: 560px;
  max-width: 92vw;
  max-height: 85vh;
  background: var(--bg-elevated);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-xl);
  box-shadow: var(--shadow-xl);
  display: flex;
  flex-direction: column;
  animation: panelIn 0.25s var(--ease-out);
  overflow: hidden;
}

@keyframes panelIn {
  from {
    opacity: 0;
    transform: translate(-50%, -48%) scale(0.97);
  }
  to {
    opacity: 1;
    transform: translate(-50%, -50%) scale(1);
  }
}

.settings-header {
  padding: var(--space-lg) var(--space-xl) var(--space-md);
  border-bottom: 1px solid var(--border-subtle);
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.settings-title {
  font-size: 17px;
  font-weight: 700;
  color: var(--text-primary);
  letter-spacing: -0.02em;
}

.settings-close-btn {
  width: 30px;
  height: 30px;
  border-radius: var(--radius-sm);
  border: none;
  background: transparent;
  color: var(--text-tertiary);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all var(--duration-fast);
}

.settings-close-btn:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.settings-body {
  flex: 1;
  overflow-y: auto;
  padding: var(--space-md) var(--space-xl);
}

.settings-section {
  margin-bottom: var(--space-lg);
}

.settings-section-title {
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--text-tertiary);
  margin-bottom: var(--space-sm);
}

.settings-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 0;
  border-bottom: 1px solid var(--border-subtle);
}

.settings-row:last-child {
  border-bottom: none;
}

.settings-label {
  font-size: 13px;
  color: var(--text-primary);
  font-weight: 500;
}

.settings-desc {
  font-size: 11px;
  color: var(--text-tertiary);
  margin-top: 2px;
}

.settings-footer {
  padding: var(--space-md) var(--space-xl) var(--space-lg);
  border-top: 1px solid var(--border-subtle);
  display: flex;
  justify-content: flex-end;
  gap: var(--space-sm);
}

/* Form Elements */
.input-field {
  width: 100%;
  padding: 8px 12px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border-default);
  background: var(--bg-surface);
  color: var(--text-primary);
  font-size: 13px;
  outline: none;
  transition: border-color var(--duration-fast);
}

.input-field:focus {
  border-color: var(--color-primary);
  box-shadow: 0 0 0 3px var(--color-primary-muted);
}

.select-field {
  appearance: none;
  padding: 8px 32px 8px 12px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border-default);
  background: var(--bg-surface) url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%2398999D' stroke-width='2'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E") no-repeat right 12px center;
  color: var(--text-primary);
  font-size: 13px;
  cursor: pointer;
  outline: none;
  transition: border-color var(--duration-fast);
}

.select-field:focus {
  border-color: var(--color-primary);
}

.color-input-wrapper {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
}

.color-preview {
  width: 28px;
  height: 28px;
  border-radius: var(--radius-sm);
  border: 2px solid var(--border-default);
  cursor: pointer;
  flex-shrink: 0;
}

.toggle-switch {
  position: relative;
  width: 42px;
  height: 24px;
  cursor: pointer;
}

.toggle-switch input {
  opacity: 0;
  width: 0;
  height: 0;
}

.toggle-slider {
  position: absolute;
  inset: 0;
  background: var(--bg-canvas);
  border: 1px solid var(--border-default);
  border-radius: 12px;
  transition: all var(--duration-fast) var(--ease-out);
}

.toggle-slider::before {
  content: '';
  position: absolute;
  width: 18px;
  height: 18px;
  left: 2px;
  top: 2px;
  background: var(--text-tertiary);
  border-radius: 50%;
  transition: all var(--duration-fast) var(--ease-out);
}

.toggle-switch input:checked + .toggle-slider {
  background: var(--color-primary);
  border-color: var(--color-primary);
}

.toggle-switch input:checked + .toggle-slider::before {
  transform: translateX(18px);
  background: white;
}

/* Layout Mode Toggle */
.layout-toggle {
  display: inline-flex;
  align-items: center;
  background: var(--bg-canvas);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  padding: 2px;
  gap: 1px;
}

.layout-toggle-btn {
  padding: 4px 10px;
  border-radius: 4px;
  border: none;
  background: transparent;
  color: var(--text-tertiary);
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  transition: all var(--duration-fast) var(--ease-out);
  display: flex;
  align-items: center;
  gap: 4px;
}

.layout-toggle-btn.active {
  background: var(--bg-elevated);
  color: var(--text-primary);
  box-shadow: var(--shadow-sm);
}

.layout-toggle-btn:hover:not(.active) {
  color: var(--text-secondary);
}

/* Widget-specific styles */
.clock-display {
  padding: var(--space-lg);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--space-xs);
  height: 100%;
}

.clock-time {
  font-size: 36px;
  font-weight: 200;
  color: var(--text-primary);
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.03em;
  line-height: 1;
}

.clock-date {
  font-size: 13px;
  color: var(--text-secondary);
  font-weight: 500;
}

.clock-tabs {
  display: flex;
  gap: 0;
  border-bottom: 1px solid var(--border-subtle);
  margin-top: var(--space-sm);
}

.clock-tab {
  flex: 1;
  padding: 7px 0;
  text-align: center;
  font-size: 12px;
  font-weight: 500;
  color: var(--text-tertiary);
  border: none;
  background: transparent;
  cursor: pointer;
  border-bottom: 2px solid transparent;
  transition: all var(--duration-fast);
}

.clock-tab.active {
  color: var(--color-primary);
  border-bottom-color: var(--color-primary);
}

.clock-tab:hover:not(.active) {
  color: var(--text-secondary);
}

.pdf-viewer-body {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.pdf-toolbar {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  padding: 6px var(--space-sm);
  border-bottom: 1px solid var(--border-subtle);
  background: var(--bg-elevated);
}

.pdf-page-info {
  font-size: 12px;
  color: var(--text-secondary);
  font-variant-numeric: tabular-nums;
}

.pdf-canvas-wrap {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: auto;
  background: var(--bg-canvas);
}

.music-player-body {
  padding: var(--space-md);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-md);
  height: 100%;
}

.music-album-art {
  width: 140px;
  height: 140px;
  border-radius: var(--radius-lg);
  background: linear-gradient(135deg, var(--color-primary-muted), var(--bg-elevated));
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-tertiary);
  box-shadow: var(--shadow-md);
  flex-shrink: 0;
}

.music-track-name {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
  text-align: center;
}

.music-artist-name {
  font-size: 12px;
  color: var(--text-secondary);
}

.music-progress-bar {
  width: 100%;
  height: 4px;
  border-radius: 2px;
  background: var(--bg-canvas);
  cursor: pointer;
  position: relative;
}

.music-progress-fill {
  height: 100%;
  border-radius: 2px;
  background: linear-gradient(90deg, var(--color-primary), var(--color-secondary));
  transition: width 0.1s linear;
}

.music-controls {
  display: flex;
  align-items: center;
  gap: var(--space-md);
}

.music-control-btn {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  border: none;
  background: var(--bg-elevated);
  color: var(--text-primary);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all var(--duration-fast) var(--ease-out);
}

.music-control-btn:hover {
  background: var(--color-primary);
  color: white;
  transform: scale(1.05);
}

.music-control-btn.play-btn {
  width: 48px;
  height: 48px;
  background: var(--color-primary);
  color: white;
}

.music-control-btn.play-btn:hover {
  background: var(--color-primary-dark);
  box-shadow: var(--shadow-glow);
}

.markdown-editor-body {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.markdown-textarea {
  flex: 1;
  padding: var(--space-md);
  border: none;
  background: var(--bg-surface);
  color: var(--text-primary);
  font-family: 'SF Mono', 'Cascadia Code', 'JetBrains Mono', 'Consolas', monospace;
  font-size: 13px;
  line-height: 1.6;
  resize: none;
  outline: none;
}

.markdown-textarea::placeholder {
  color: var(--text-tertiary);
}

.markdown-preview {
  flex: 1;
  padding: var(--space-md);
  border-left: 1px solid var(--border-subtle);
  overflow-y: auto;
  font-size: 14px;
  line-height: 1.7;
}

.markdown-preview h1 { font-size: 1.6em; font-weight: 700; margin-bottom: 0.5em; color: var(--text-primary); }
.markdown-preview h2 { font-size: 1.35em; font-weight: 600; margin-bottom: 0.4em; color: var(--text-primary); }
.markdown-preview h3 { font-size: 1.15em; font-weight: 600; margin-bottom: 0.3em; color: var(--text-primary); }
.markdown-preview p { margin-bottom: 0.75em; color: var(--text-secondary); }
.markdown-preview code {
  padding: 2px 6px;
  border-radius: 4px;
  background: var(--bg-canvas);
  font-size: 0.9em;
  font-family: 'SF Mono', Consolas, monospace;
  color: var(--color-secondary-light);
}
.markdown-preview pre {
  padding: var(--space-md);
  border-radius: var(--radius-md);
  background: var(--bg-canvas);
  overflow-x: auto;
  margin-bottom: 1em;
}
.markdown-preview pre code {
  padding: 0;
  background: transparent;
}

/* Custom Background Support */
.bg-solid { background: var(--bg-canvas) !important; }
.bg-gradient {
  background: linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #1c1c1e 100%) !important;
}
.bg-image {
  background-size: cover !important;
  background-position: center !important;
  background-repeat: no-repeat !important;
}
```

---

### Task 3: 重写 App.tsx — 背景生效 + 字体渲染 + 全局布局

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: 重写 App.tsx**

关键改动：
1. 移除内联 style 的硬编码背景色，改用 CSS 变量
2. 确保 backgroundStyle 正确应用到 workspace 层而非被覆盖
3. 添加字体平滑和全局样式类名

```tsx
import { useEffect } from 'react'
import { useAppStore } from './stores/useAppStore'
import Sidebar from './components/Sidebar'
import Workspace from './components/Workspace'
import SettingsPanel from './components/SettingsPanel'

export default function App() {
  const { settings, loadAllData } = useAppStore()

  useEffect(() => {
    loadAllData().catch(console.error)
  }, [loadAllData])

  const bgClass = (() => {
    switch (settings.background.type) {
      case 'gradient': return 'bg-gradient'
      case 'image': return 'bg-image'
      default: return 'bg-solid'
    }
  })()

  const customBgStyle = settings.background.type === 'solid'
    ? { '--bg-canvas': settings.background.value } as React.CSSProperties
    : settings.background.type === 'image'
      ? { backgroundImage: `url(${settings.background.value})` }
      : undefined

  return (
    <div className="app-root" style={customBgStyle}>
      <Sidebar />
      <div className={`workspace ${settings.layoutMode === 'grid' ? 'grid-mode' : ''} ${bgClass}`}>
        <Workspace />
      </div>
      {settings.showSettings && <SettingsPanel />}
    </div>
  )
}
```

---

### Task 4: 重写 Sidebar.tsx — DailyLife 设计语言

**Files:**
- Modify: `src/components/Sidebar.tsx`

- [ ] **Step 1: 重写 Sidebar 组件**

关键改动：
1. 使用新的 CSS class 名称（`.sidebar`, `.sidebar-header` 等）
2. Logo 使用渐变色文字效果
3. Tab 激活态使用 primary muted 背景
4. New Panel 按钮使用虚线边框风格
5. 删除/编辑按钮在 hover 时才显示
6. Panel 输入框使用 `.input-field` 样式

---

### Task 5: 重写 WidgetContainer.tsx — 阴影、圆角、动效、拖拽状态

**Files:**
- Modify: `src/components/WidgetContainer.tsx`

- [ ] **Step 1: 重写 WidgetContainer**

关键改动：
1. 外层容器使用 `.widget-container` class
2. 拖拽时添加 `.dragging` class（opacity 0.92 + scale 1.01 + 更深阴影）
3. Header 使用 `.widget-header` + `.widget-drag-handle`
4. Action 按钮使用 `.widget-action-btn` 系列
5. Resize handle 使用 `.resize-handle`
6. 最小化状态添加 `.minimized` class
7. z-index 在拖拽时提升到 active 级别

---

### Task 6: 重写 Workspace.tsx — 画布背景 + 工具栏分离

**Files:**
- Modify: `src/components/Workspace.tsx`

- [ ] **Step 1: 重写 Workspace**

关键改动：
1. 移除 `bg-zinc-950` 硬编码背景
2. Toolbar 使用 `.toolbar` class，从 workspace 内部分离为独立 header 区域
3. Empty state 使用 `.workspace-empty` 样式
4. Grid mode 通过 `.grid-mode` class 切换
5. 背景由外层 App 控制，workspace 不再覆盖

---

### Task 7: 重写 Toolbar 子组件

**Files:**
- Modify: `src/components/SaveIndicator.tsx`
- Modify: `src/components/LayoutModeToggle.tsx`
- Modify: `src/components/AddWidgetMenu.tsx`

- [ ] **Step 1: 重写 SaveIndicator**

使用 `.save-indicator` class，saved/saving/error 三态有不同配色（secondary绿/warning橙/error红）

- [ ] **Step 2: 重写 LayoutModeToggle**

使用 `.layout-toggle` + `.layout-toggle-btn`，active 态有浮起效果

- [ ] **Step 3: 重写 AddWidgetMenu**

使用 `.widget-menu` + `.widget-menu-item` + `.widget-menu-overlay`，带入场动画

---

### Task 8: 重写 SettingsPanel.tsx — DailyLife 风格设置面板

**Files:**
- Modify: `src/components/SettingsPanel.tsx`

- [ ] **Step 1: 重写 SettingsPanel**

关键改动：
1. 使用 `.settings-panel` + `.settings-overlay`
2. 入场动画 `panelIn`
3. 分区标题使用 uppercase + tracking
4. 表单元素使用 `.input-field`, `.select-field`, `.toggle-switch`, `.color-preview`
5. Footer 操作按钮右对齐

---

### Task 9: 重写内置 Widget 组件样式

**Files:**
- Modify: `src/components/widgets/Clock.tsx`
- Modify: `src/components/widgets/PdfViewer.tsx`
- Modify: `src/components/widgets/MusicPlayer.tsx`
- Modify: `src/components/widgets/MarkdownEditor.tsx`

- [ ] **Step 1: 重写 Clock 样式**

使用 `.clock-display`, `.clock-time`(font-weight 200, tabular-nums), `.clock-date`, `.clock-tabs`

- [ ] **Step 2: 重写 PdfViewer 样式**

使用 `.pdf-viewer-body`, `.pdf-toolbar`, `.pdf-page-info`, `.pdf-canvas-wrap`

- [ ] **Step 3: 重写 MusicPlayer 样式**

使用 `.music-player-body`, `.music-album-art`(渐变背景), `.music-progress-bar`(渐变填充), `.music-controls`

- [ ] **Step 4: 重写 MarkdownEditor 样式**

使用 `.markdown-editor-body`, `.markdown-textarea`(等宽字体), `.markdown-preview`(排版样式)

---

### Task 10: 构建验证 + 浏览器测试

- [ ] **Step 1: TypeScript 编译检查**

Run: `npx tsc --noEmit`
Expected: 0 errors

- [ ] **Step 2: Vite 构建检查**

Run: `npm run build`
Expected: Build 成功无错误

- [ ] **Step 3: 启动 dev server 并浏览器验证**

Run: `npm run dev`
然后通过 Playwright 验证：
1. 页面正常渲染，无白屏
2. 新建面板 → 正常显示
3. 添加时钟组件 → 显示正确
4. **拖拽组件 → 平滑跟随鼠标，不抖动**
5. 调整大小 → 正常工作
6. 设置面板打开 → 动画流畅
7. 切换布局模式 → 网格线出现/消失
8. 保存指示器 → 状态切换正常
