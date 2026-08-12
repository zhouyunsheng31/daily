// Phase 6.1：面板状态持久化（spec 第 2 节）
// 保存：收集 widget state + webview scrollY + 序列化到 panel_memory_states 表
// 恢复：加载 saved_state + 显示骨架屏 + 渲染 widgets + 恢复 URL/scrollY + 延迟移除骨架屏
//
// 注意：
// - panel_memory_states 表独立于 widgets.state（widgets.state 存组件自身状态，panel_memory_states 存面板级休眠快照）
// - WebView 滚动位置用 executeJavaScript 获取/设置（spec 第 6 节）
// - 休眠前先 flush widget state（通过 debouncedWidgetStateSave.flush，spec 注意事项）
// - deep-hibernated 时清空 panelWidgets/panelPositions（由 useAppStore 调用方处理）
//
// S12 改造：Web 端 browserToolBridge.getWebview 返回 null（stub），webview 部分加 try-catch fallback
// 保留 widgetStates 持久化逻辑（spec S12.1-T5 #15）

import { getPanelMemoryState, savePanelMemoryState } from '../api/panelMemoryState'
import { browserToolBridge } from './browserToolBridge'
import { panelMemoryManager, type PanelSavedState } from './panelMemoryManager'
import type { WidgetInstance } from '../types'

/**
 * 保存面板状态到数据库（休眠前调用）
 * 1. 收集所有 widget 的 state
 * 2. 收集 webview widget 的 scrollY（通过 executeJavaScript）
 * 3. 序列化保存到 panel_memory_states 表
 * 4. 更新 panelMemoryManager 的 savedState
 *
 * @param panelId 面板 ID
 * @param widgets 面板内的 widget 列表
 * @param flushWidgetState 可选，休眠前 flush widget state 的函数（debouncedWidgetStateSave.flush）
 */
export async function savePanelState(
  panelId: string,
  widgets: WidgetInstance[],
  flushWidgetState?: () => void,
): Promise<void> {
  // 1. 休眠前先 flush widget state，确保最新状态已写入服务器
  if (flushWidgetState) {
    try {
      flushWidgetState()
    } catch (err) {
      console.error('[panelStatePersistence] flushWidgetState failed:', err)
    }
  }

  // 2. 收集 widget states
  const widgetStates: Record<string, unknown> = {}
  for (const widget of widgets) {
    widgetStates[widget.widgetId] = {
      widgetType: widget.widgetType,
      state: widget.state,
      minimized: widget.minimized,
      locked: widget.locked,
      colorScheme: widget.colorScheme,
      isPrimary: widget.isPrimary,
    }
  }

  // 3. 收集 webview widget 的 scrollY（spec 第 6 节）
  // S12 改造：Web 端 browserToolBridge.getWebview 返回 null（stub），整个 webview 部分用 try-catch 包裹
  // 失败时 webviewUrl/webviewScrollY 保持 undefined，不影响 widgetStates 持久化
  let webviewUrl: string | undefined
  let webviewScrollY: number | undefined
  try {
    for (const widget of widgets) {
      if (widget.widgetType === 'webPage' || widget.widgetType === 'webview') {
        const webview = browserToolBridge.getWebview(widget.widgetId)
        if (webview) {
          // S12 改造：Web 端 getWebview 返回 null，此分支不执行；保留类型断言以兼容桌面端逻辑
          const w = webview as {
            getURL: () => string
            executeJavaScript: (script: string, userGesture?: boolean) => Promise<unknown>
          }
          try {
            // 获取当前 URL
            webviewUrl = w.getURL()
            // 获取滚动位置（executeJavaScript，spec 第 6 节）
            const scrollY = await w.executeJavaScript('window.scrollY', false)
            if (typeof scrollY === 'number') {
              webviewScrollY = scrollY
            }
          } catch (err) {
            console.error('[panelStatePersistence] Failed to get webview state for widget:', widget.widgetId, err)
          }
          // 只保存第一个 webview 的状态（面板内通常一个主 webview）
          break
        }
      }
    }
  } catch (err) {
    // S12 改造：防御性 try-catch，确保 webview 部分失败不影响 widgetStates 持久化
    console.warn('[panelStatePersistence] webview state collection skipped:', err)
  }

  // 4. 构建保存的状态对象
  const savedState: PanelSavedState = {
    widgetStates,
  }
  if (webviewUrl !== undefined) savedState.webviewUrl = webviewUrl
  if (webviewScrollY !== undefined) savedState.webviewScrollY = webviewScrollY

  // 5. 保存到数据库
  try {
    await savePanelMemoryState(panelId, savedState as Record<string, unknown>)
    // 6. 更新 panelMemoryManager 的 savedState
    panelMemoryManager.setSavedState(panelId, savedState)
    console.log(`[panelStatePersistence] Saved state for panel ${panelId}, widgets: ${widgets.length}, scrollY: ${webviewScrollY ?? 'N/A'}`)
  } catch (err) {
    console.error('[panelStatePersistence] savePanelMemoryState failed:', err)
    throw err
  }
}

/**
 * 从数据库恢复面板状态（恢复面板时调用）
 * 1. 从 panel_memory_states 表加载 saved_state
 * 2. 更新 panelMemoryManager 的 savedState
 * 3. 返回 savedState 供调用方恢复 widgets 和 webview 状态
 *
 * 注意：实际的 widget 渲染和 webview 滚动恢复由调用方（useAppStore/Workspace）处理，
 *      因为涉及 React state 更新和 DOM 操作。
 *
 * @param panelId 面板 ID
 * @returns 保存的状态，或 null（无保存状态）
 */
export async function restorePanelState(panelId: string): Promise<PanelSavedState | null> {
  try {
    const dto = await getPanelMemoryState(panelId)
    if (!dto.savedState) {
      console.log(`[panelStatePersistence] No saved state for panel ${panelId}`)
      return null
    }

    const savedState = dto.savedState as unknown as PanelSavedState
    // 更新 panelMemoryManager 的 savedState
    panelMemoryManager.setSavedState(panelId, savedState)
    console.log(`[panelStatePersistence] Restored state for panel ${panelId}, savedAt: ${dto.savedAt}`)
    return savedState
  } catch (err) {
    console.error('[panelStatePersistence] restorePanelState failed:', err)
    return null
  }
}

/**
 * 恢复 webview 滚动位置（webview 重新加载后调用）
 * 通过 executeJavaScript 设置 scrollY（spec 第 6 节）
 *
 * S12 改造：Web 端 browserToolBridge.getWebview 返回 null（stub），此函数 no-op
 *
 * @param widgetId webview widget ID
 * @param scrollY 滚动位置
 */
export async function restoreWebviewScrollY(widgetId: string, scrollY: number): Promise<void> {
  // S12 改造：getWebview 调用包装在 try-catch + 返回 null fallback
  let webview: unknown = null
  try {
    webview = browserToolBridge.getWebview(widgetId)
  } catch (err) {
    console.warn(`[panelStatePersistence] getWebview failed for widget ${widgetId}:`, err)
    return
  }
  if (!webview) {
    // S12 改造：Web 端 getWebview 始终返回 null，此处直接 return
    console.warn(`[panelStatePersistence] Webview not found for widget: ${widgetId}`)
    return
  }
  try {
    const w = webview as { executeJavaScript: (script: string, userGesture?: boolean) => Promise<unknown> }
    await w.executeJavaScript(`window.scrollTo(0, ${Math.max(0, scrollY)})`, false)
    console.log(`[panelStatePersistence] Restored scrollY=${scrollY} for widget ${widgetId}`)
  } catch (err) {
    console.error('[panelStatePersistence] restoreWebviewScrollY failed:', err)
  }
}

/**
 * 删除面板的保存状态（deletePanel 时调用，清理数据库）
 * 注意：panel_memory_states 表有 ON DELETE CASCADE，删除 panel 时会自动清理，
 *      但显式删除可确保 IDB 降级模式下也清理。
 *
 * @param panelId 面板 ID
 */
export async function clearPanelState(panelId: string): Promise<void> {
  // 服务器端通过 ON DELETE CASCADE 自动清理，这里仅清理内存中的 savedState
  panelMemoryManager.setSavedState(panelId, { widgetStates: {} })
  // 清空 savedState
  const state = panelMemoryManager.getPanelState(panelId)
  if (state) {
    state.savedState = null
  }
}
