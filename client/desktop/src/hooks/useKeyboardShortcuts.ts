/**
 * Phase 7 批次3 任务6：全局快捷键中心（spec 5.2.2 节）
 *
 * 集中管理所有全局快捷键，避免散落在各组件中导致冲突。
 *
 * 设计要点：
 * - 在 App.tsx 顶层调用 `useKeyboardShortcuts()`（无参数）
 * - 通过 useAppStore 直接读取 state 和调用 action，避免 props drilling
 * - keydown 事件监听挂在 window 上
 * - 输入框聚焦时不触发（INPUT/TEXTAREA/SELECT/contentEditable），Escape 例外
 * - Ctrl+W/Ctrl+R/F5 由主进程 before-input-event 拦截后通过 IPC 转发，本 hook 监听 IPC 处理
 * - 其他快捷键直接在 renderer keydown 中处理
 * - 模块级 `recentlyClosedTabs` 栈用于 Ctrl+Shift+T 恢复最近关闭的标签页（会话级，不持久化）
 */
import { useEffect } from 'react'
import { useAppStore } from '../stores/useAppStore'
import { useToastStore } from '../stores/useToastStore'
// Phase 15 批次4 修复 P2-1：reload-tab 需要查找 active webview 并调用 reload()
import { browserToolBridge } from '../utils/browserToolBridge'
import type { WebTab, MainViewType } from '../types'

// 会话级"最近关闭的标签页"栈（最多 10 条），用于 Ctrl+Shift+T 恢复
const MAX_RECENTLY_CLOSED = 10
const recentlyClosedTabs: WebTab[] = []

function pushRecentlyClosed(tab: WebTab): void {
  recentlyClosedTabs.unshift(tab)
  if (recentlyClosedTabs.length > MAX_RECENTLY_CLOSED) {
    recentlyClosedTabs.length = MAX_RECENTLY_CLOSED
  }
}

function popRecentlyClosed(): WebTab | undefined {
  return recentlyClosedTabs.shift()
}

/** 判断键盘事件目标是否为输入元素（INPUT/TEXTAREA/SELECT/contentEditable） */
function isInputTarget(e: KeyboardEvent): boolean {
  const target = e.target as HTMLElement | null
  if (!target) return false
  const tag = target.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true
  if (target.isContentEditable) return true
  return false
}

/** 根据 mainView.type 推断当前作用域 */
function getScope(mainViewType: MainViewType): 'browser' | 'canvas' {
  // web-tab / browser-home 视为 browser 作用域；canvas-panel / canvas-home 视为 canvas 作用域
  return mainViewType === 'web-tab' || mainViewType === 'browser-home' ? 'browser' : 'canvas'
}

// ============================================================================
// Phase 7 批次4 任务7.2：快捷键定义与自定义映射（spec 6.2.2 节）
// ============================================================================

/** 快捷键定义（spec 5.2.3 节，含批次3 新增的 16 个快捷键 + 已有 Ctrl+F 迁移） */
export interface ShortcutDefinition {
  id: string
  defaultKeys: string
  description: string
  scope: 'global' | 'canvas' | 'browser'
  /** 只读快捷键（如 Ctrl+1..9 / Ctrl+Tab）不支持自定义，因为它们的按键匹配逻辑特殊 */
  readOnly?: boolean
}

/** 全部快捷键定义（暴露给 ShortcutsConfig UI 读取） */
export const SHORTCUT_DEFINITIONS: ShortcutDefinition[] = [
  { id: 'new-web-tab', defaultKeys: 'Ctrl+T', description: '新建网页标签', scope: 'global' },
  { id: 'reopen-closed-tab', defaultKeys: 'Ctrl+Shift+T', description: '恢复最近关闭的标签', scope: 'global' },
  { id: 'new-canvas-panel', defaultKeys: 'Ctrl+N', description: '新建画布面板', scope: 'global' },
  // Phase 15 批次4 修复 P1-1：新增 focus-omnibox 定义（Ctrl+L 聚焦地址栏），统一由 hook 处理
  { id: 'focus-omnibox', defaultKeys: 'Ctrl+L', description: '聚焦地址栏', scope: 'global' },
  { id: 'close-tab', defaultKeys: 'Ctrl+W', description: '关闭当前标签（由主进程拦截）', scope: 'global', readOnly: true },
  { id: 'next-tab', defaultKeys: 'Ctrl+Tab', description: '切换到下一个标签', scope: 'global', readOnly: true },
  { id: 'prev-tab', defaultKeys: 'Ctrl+Shift+Tab', description: '切换到上一个标签', scope: 'global', readOnly: true },
  { id: 'switch-tab-1-9', defaultKeys: 'Ctrl+1..9', description: '切换到第 N 个标签', scope: 'global', readOnly: true },
  { id: 'web-back', defaultKeys: 'Alt+ArrowLeft', description: '网页后退', scope: 'browser' },
  { id: 'web-forward', defaultKeys: 'Alt+ArrowRight', description: '网页前进', scope: 'browser' },
  { id: 'reload-tab', defaultKeys: 'Ctrl+R', description: '刷新当前网页（由主进程拦截）', scope: 'browser', readOnly: true },
  { id: 'favorite-current', defaultKeys: 'Ctrl+D', description: '收藏当前页/组件', scope: 'global' },
  { id: 'open-settings', defaultKeys: 'Ctrl+,', description: '打开设置', scope: 'global' },
  { id: 'canvas-zoom-in', defaultKeys: 'Ctrl+=', description: '画布放大', scope: 'canvas', readOnly: true },
  { id: 'canvas-zoom-out', defaultKeys: 'Ctrl+-', description: '画布缩小', scope: 'canvas', readOnly: true },
  { id: 'canvas-zoom-reset', defaultKeys: 'Ctrl+0', description: '画布重置缩放', scope: 'canvas', readOnly: true },
  { id: 'history-panel', defaultKeys: 'Ctrl+H', description: '历史记录面板', scope: 'global' },
  { id: 'bookmarks-manager', defaultKeys: 'Ctrl+J', description: '书签管理', scope: 'global' },
  { id: 'search-widget', defaultKeys: 'Ctrl+F', description: '搜索组件', scope: 'global' },
  { id: 'save-layout', defaultKeys: 'Ctrl+Shift+S', description: '保存当前面板布局', scope: 'global' },
  { id: 'print', defaultKeys: 'Ctrl+P', description: '打印当前页', scope: 'global' },
]

/** localStorage key：自定义快捷键映射（id → keys 字符串） */
const SHORTCUTS_CUSTOM_STORAGE_KEY = 'shortcuts_custom_map'
const SHORTCUTS_CUSTOM_LEGACY_KEY = 'ld_shortcuts_custom'

/** 读取自定义快捷键映射 */
export function getCustomShortcuts(): Record<string, string> {
  try {
    const raw = localStorage.getItem(SHORTCUTS_CUSTOM_STORAGE_KEY) ?? localStorage.getItem(SHORTCUTS_CUSTOM_LEGACY_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as Record<string, string>
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

/** 写入单条自定义快捷键映射（keys 为空表示删除该自定义，回退到默认） */
export function setCustomShortcut(id: string, keys: string): void {
  const map = getCustomShortcuts()
  if (keys.trim() === '') {
    delete map[id]
  } else {
    map[id] = keys.trim()
  }
  try {
    localStorage.setItem(SHORTCUTS_CUSTOM_STORAGE_KEY, JSON.stringify(map))
    // Phase 15 batch4: migration - cleanup legacy key
    localStorage.removeItem(SHORTCUTS_CUSTOM_LEGACY_KEY)
  } catch { /* ignore quota / privacy errors */ }
}

/** 清除全部自定义快捷键映射，恢复默认 */
export function resetCustomShortcuts(): void {
  try {
    localStorage.removeItem(SHORTCUTS_CUSTOM_STORAGE_KEY)
    localStorage.removeItem(SHORTCUTS_CUSTOM_LEGACY_KEY)
  } catch { /* ignore */ }
}

/** 获取某快捷键当前生效的按键组合（自定义优先，否则默认） */
export function getShortcutKeys(id: string): string {
  const custom = getCustomShortcuts()[id]
  if (custom) return custom
  const def = SHORTCUT_DEFINITIONS.find(d => d.id === id)
  return def?.defaultKeys ?? ''
}

/**
 * 将组合字符串解析为修饰键 + 主键。
 * 输入示例：'Ctrl+Shift+T' / 'Alt+ArrowLeft' / 'Ctrl+,'
 */
interface ParsedCombo {
  ctrl: boolean
  shift: boolean
  alt: boolean
  key: string
}

function parseCombo(combo: string): ParsedCombo {
  const parts = combo.split('+')
  const result: ParsedCombo = { ctrl: false, shift: false, alt: false, key: '' }
  for (const p of parts) {
    const t = p.trim()
    if (t === 'Ctrl' || t === 'Cmd' || t === 'CmdOrCtrl') result.ctrl = true
    else if (t === 'Shift') result.shift = true
    else if (t === 'Alt') result.alt = true
    else result.key = t
  }
  return result
}

/**
 * 判断 KeyboardEvent 是否匹配给定组合字符串。
 * - 字母键大小写不敏感
 * - Ctrl 修饰键同时接受 ctrlKey 和 metaKey（macOS Cmd）
 */
export function matchCombo(e: KeyboardEvent, combo: string): boolean {
  const parsed = parseCombo(combo)
  const ctrl = e.ctrlKey || e.metaKey
  if (parsed.ctrl !== ctrl) return false
  if (parsed.shift !== e.shiftKey) return false
  if (parsed.alt !== e.altKey) return false
  if (!parsed.key) return false
  const eventKey = e.key.length === 1 ? e.key.toLowerCase() : e.key
  const comboKey = parsed.key.length === 1 ? parsed.key.toLowerCase() : parsed.key
  return eventKey === comboKey
}

/** 判断 KeyboardEvent 是否匹配某快捷键 ID 的当前生效组合（自定义优先） */
export function matchShortcutId(e: KeyboardEvent, id: string): boolean {
  const keys = getShortcutKeys(id)
  if (!keys) return false
  return matchCombo(e, keys)
}

/**
 * 将 KeyboardEvent 转换为按键组合字符串（用于录制模式）。
 * 例如：Ctrl+Shift+T / Alt+ArrowLeft / Ctrl+,
 */
export function eventToCombo(e: KeyboardEvent): string {
  const parts: string[] = []
  if (e.ctrlKey || e.metaKey) parts.push('Ctrl')
  if (e.shiftKey) parts.push('Shift')
  if (e.altKey) parts.push('Alt')
  // 主键：字母转大写，其他保留
  let key = e.key
  if (key.length === 1) key = key.toUpperCase()
  // 跳过纯修饰键（Shift/Control/Alt/Meta 单独按下时不构成完整组合）
  if (key === 'Shift' || key === 'Control' || key === 'Alt' || key === 'Meta') return ''
  parts.push(key)
  return parts.join('+')
}

/**
 * 主快捷键 hook：在 App.tsx 顶层调用一次。
 * 内部用 useEffect 注册 keydown 和 IPC 监听，组件卸载时自动清理。
 */
export function useKeyboardShortcuts(): void {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const state = useAppStore.getState()
      const { mainView, webTabs, activeWebTabId } = state
      const scope = getScope(mainView.type)
      const ctrl = e.ctrlKey || e.metaKey // macOS 用 Cmd

      // Escape：关闭模态框/搜索（即使在输入框中也触发）
      if (e.key === 'Escape') {
        if (state.showWidgetSearch) {
          e.preventDefault()
          state.setShowWidgetSearch(false)
          return
        }
        if (state.showSettings) {
          e.preventDefault()
          useAppStore.setState({ showSettings: false })
          return
        }
        return
      }

      // 输入框聚焦时跳过后续所有快捷键（避免与文本输入冲突）
      if (isInputTarget(e)) return

      // Ctrl+Tab / Ctrl+Shift+Tab：切换标签页（放在 Ctrl+1..9 之前，避免被数字分支误捕）
      if (ctrl && e.key === 'Tab') {
        if (webTabs.length === 0) return
        e.preventDefault()
        const currentIdx = activeWebTabId ? webTabs.findIndex(t => t.id === activeWebTabId) : -1
        let nextIdx: number
        if (e.shiftKey) {
          // 反向：上一个
          nextIdx = currentIdx <= 0 ? webTabs.length - 1 : currentIdx - 1
        } else {
          // 正向：下一个
          nextIdx = currentIdx < 0 || currentIdx >= webTabs.length - 1 ? 0 : currentIdx + 1
        }
        const nextTab = webTabs[nextIdx]
        if (nextTab) {
          state.setActiveWebTab(nextTab.id)
          state.setMainView({ type: 'web-tab', tabId: nextTab.id })
        }
        return
      }

      // Ctrl+1..9：切换到第 N 个标签页
      if (ctrl && /^[1-9]$/.test(e.key)) {
        const idx = parseInt(e.key, 10) - 1
        if (idx >= 0 && idx < webTabs.length) {
          e.preventDefault()
          const target = webTabs[idx]
          state.setActiveWebTab(target.id)
          state.setMainView({ type: 'web-tab', tabId: target.id })
        }
        return
      }

      // Ctrl+T：新建网页标签 → 浏览器主页（spec 5.2.3）
      // 批次4：使用 matchShortcutId 支持自定义映射覆盖默认值
      if (matchShortcutId(e, 'new-web-tab')) {
        e.preventDefault()
        void state.addWebTab().then(tabId => {
          state.setMainView({ type: 'browser-home', tabId })
        })
        return
      }

      // Phase 15 批次4 修复 P1-1：Ctrl+L 聚焦地址栏（统一由 hook 处理，Omnibox 内不再监听）
      if (matchShortcutId(e, 'focus-omnibox')) {
        e.preventDefault()
        const omniboxInput = document.querySelector<HTMLInputElement>('.omnibox__input')
        if (omniboxInput) {
          omniboxInput.focus()
          omniboxInput.select()
        }
        return
      }

      // Ctrl+Shift+T：恢复最近关闭的标签页
      if (matchShortcutId(e, 'reopen-closed-tab')) {
        e.preventDefault()
        const restored = popRecentlyClosed()
        if (restored) {
          void state.addWebTab(restored.url).then(tabId => {
            // 还原标题（addWebTab 默认标题是"新标签页"）
            state.updateWebTab(tabId, { title: restored.title })
            state.setMainView({ type: 'browser-home', tabId })
          })
        } else {
          useToastStore.getState().showToast({ type: 'info', message: '没有可恢复的标签页', duration: 2000 })
        }
        return
      }

      // Ctrl+D：收藏当前页/当前组件（spec 5.2.3）
      if (matchShortcutId(e, 'favorite-current')) {
        e.preventDefault()
        if (scope === 'browser' && mainView.type === 'web-tab' && mainView.tabId) {
          const tab = webTabs.find(t => t.id === mainView.tabId)
          if (tab && tab.url) {
            void state.addBookmark(tab.url, tab.title || tab.url).then(() => {
              useToastStore.getState().showToast({ type: 'success', message: '已加入书签', duration: 2000 })
            })
          }
        } else if (scope === 'canvas' && state.lastActiveWidgetId) {
          void state.addFavorite(state.lastActiveWidgetId).then(() => {
            useToastStore.getState().showToast({ type: 'success', message: '已加入收藏', duration: 2000 })
          })
        }
        return
      }

      // Ctrl+F：打开组件搜索（迁移自 App.tsx 旧 useEffect）
      if (matchShortcutId(e, 'search-widget')) {
        e.preventDefault()
        state.setShowWidgetSearch(!state.showWidgetSearch)
        return
      }

      // Ctrl+,：打开设置（spec 5.2.3）
      if (matchShortcutId(e, 'open-settings')) {
        e.preventDefault()
        useAppStore.setState({ showSettings: true })
        return
      }

      // Ctrl+N：新建画布面板并切换到画布视图（spec 5.2.3）
      // 注：文件菜单的 CmdOrCtrl+N accelerator 已移除，由 hook 统一处理
      if (matchShortcutId(e, 'new-canvas-panel')) {
        e.preventDefault()
        void state.addPanel('新面板').then(panelId => {
          state.setMainView({ type: 'canvas-panel', panelId })
        }).catch(err => {
          console.error('[shortcut] Ctrl+N addPanel failed:', err)
        })
        return
      }

      // Ctrl+= / Ctrl++：画布放大（spec 5.2.3，canvas 作用域）
      // 注：readOnly，保留原有 = / + 双键兼容逻辑（不通过 matchShortcutId）
      if (ctrl && (e.key === '=' || e.key === '+')) {
        if (scope === 'canvas') {
          e.preventDefault()
          const currentZoom = state.canvasTransform.zoom ?? 1
          const newZoom = Math.min(currentZoom * 1.2, 5)
          state.setCanvasTransform({ zoom: newZoom })
        }
        return
      }

      // Ctrl+-：画布缩小（spec 5.2.3，canvas 作用域，readOnly）
      if (matchShortcutId(e, 'canvas-zoom-out')) {
        if (scope === 'canvas') {
          e.preventDefault()
          const currentZoom = state.canvasTransform.zoom ?? 1
          const newZoom = Math.max(currentZoom / 1.2, 0.2)
          state.setCanvasTransform({ zoom: newZoom })
        }
        return
      }

      // Ctrl+0：画布重置缩放（spec 5.2.3，canvas 作用域，readOnly）
      if (matchShortcutId(e, 'canvas-zoom-reset')) {
        if (scope === 'canvas') {
          e.preventDefault()
          state.setCanvasTransform({ zoom: 1 })
        }
        return
      }

      // Alt+←：网页后退（spec 5.2.3，browser 作用域）
      // 注：webview.goBack() 需在 WebviewWidget 内调用，此处派发自定义事件由 WebviewWidget 监听
      if (matchShortcutId(e, 'web-back')) {
        if (scope === 'browser') {
          e.preventDefault()
          window.dispatchEvent(new CustomEvent('shortcut:web-back'))
        }
        return
      }

      // Alt+→：网页前进（spec 5.2.3，browser 作用域）
      if (matchShortcutId(e, 'web-forward')) {
        if (scope === 'browser') {
          e.preventDefault()
          window.dispatchEvent(new CustomEvent('shortcut:web-forward'))
        }
        return
      }

      // Ctrl+Shift+S：保存当前面板布局（auto-save 已生效，此处仅给用户反馈）
      if (matchShortcutId(e, 'save-layout')) {
        e.preventDefault()
        useToastStore.getState().showToast({ type: 'info', message: '布局已自动保存', duration: 1500 })
        return
      }

      // Ctrl+P：打印当前页（可选，spec 标注"可选"）
      if (matchShortcutId(e, 'print')) {
        e.preventDefault()
        window.print()
        return
      }

      // Ctrl+H：历史记录面板（spec 5.2.3）—— 桌面端未实现历史记录 UI，先 Toast 提示
      if (matchShortcutId(e, 'history-panel')) {
        e.preventDefault()
        useToastStore.getState().showToast({ type: 'info', message: '历史记录（暂未实现）', duration: 1500 })
        return
      }

      // Ctrl+J：书签管理（spec 5.2.3）—— 桌面端未实现书签管理 UI，先 Toast 提示
      if (matchShortcutId(e, 'bookmarks-manager')) {
        e.preventDefault()
        useToastStore.getState().showToast({ type: 'info', message: '书签管理（暂未实现）', duration: 1500 })
        return
      }
    }

    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  // 监听主进程转发的快捷键 IPC（Ctrl+W / Ctrl+R / F5 由 main 拦截 default 后发送）
  useEffect(() => {
    const unsub = window.shortcutApi?.onShortcutAction((action: string) => {
      const state = useAppStore.getState()
      switch (action) {
        case 'close-tab': {
          // Ctrl+W：关闭当前 web tab（不关闭窗口）
          const { activeWebTabId, webTabs } = state
          if (!activeWebTabId) return
          const closed = webTabs.find(t => t.id === activeWebTabId)
          if (closed) pushRecentlyClosed(closed)
          void state.closeWebTab(activeWebTabId)
          break
        }
        case 'reload-tab': {
          // Phase 15 批次4 修复 P2-1：Ctrl+R / F5 刷新当前 web tab 的 webview
          // 主进程 before-input-event 拦截后通过 IPC 转发到此，由 hook 统一调用 webview.reload()
          // 仅在 browser 作用域（web-tab / browser-home）下处理；canvas 作用域下不会收到（主进程未拦截 canvas 内的 Ctrl+R，由 webview 自身处理）
          const { activeWebTabId, mainView } = state
          // browser-home 模式下没有 webview 渲染，无需 reload（用户在主页按 Ctrl+R 不应触发任何 webview 刷新）
          if (mainView.type !== 'web-tab' || !activeWebTabId) break
          // web-tab 模式下 WebviewWidget 的 widgetId 是 `webtab-${tabId}`（见 App.tsx WebviewWidgetFullscreen）
          const webview = browserToolBridge.getWebview(`webtab-${activeWebTabId}`)
          if (webview) {
            try {
              webview.reload()
            } catch (err) {
              console.error('[shortcut] reload-tab webview.reload failed:', err)
            }
          }
          break
        }
        default:
          console.log('[shortcut] Unknown shortcut action:', action)
      }
    })
    return () => {
      if (unsub) unsub()
    }
  }, [])
}
