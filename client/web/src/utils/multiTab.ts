import { useEffect, useRef } from 'react'

const CHANNEL_NAME = 'daily-sync'

interface SyncMessage {
  type: 'widget-updated' | 'import-started'
  widgetId?: string
  panelId?: string
  timestamp: number
}

let channel: BroadcastChannel | null = null

export function initMultiTabSync(): () => void {
  if (typeof BroadcastChannel === 'undefined') return () => {}

  channel = new BroadcastChannel(CHANNEL_NAME)

  channel.onmessage = (event: MessageEvent<SyncMessage>) => {
    const msg = event.data
    if (msg.type === 'widget-updated') {
      showUpdateNotification()
    }
    if (msg.type === 'import-started') {
      showImportWarning()
    }
  }

  return () => {
    channel?.close()
    channel = null
  }
}

export function broadcastWidgetUpdate(widgetId: string, panelId: string): void {
  if (!channel) return
  channel.postMessage({
    type: 'widget-updated',
    widgetId,
    panelId,
    timestamp: Date.now(),
  } satisfies SyncMessage)
}

export function broadcastImportStarted(): void {
  if (!channel) return
  channel.postMessage({
    type: 'import-started',
    timestamp: Date.now(),
  } satisfies SyncMessage)
}

function showUpdateNotification(): void {
  const existing = document.getElementById('multi-tab-notification')
  if (existing) existing.remove()

  const el = document.createElement('div')
  el.id = 'multi-tab-notification'
  el.style.cssText = `
    position: fixed; top: 12px; right: 12px; z-index: 10000;
    padding: 8px 16px; border-radius: 8px;
    background: rgba(74,144,226,0.15); border: 1px solid rgba(74,144,226,0.3);
    color: var(--color-primary-light); font-size: 12px; font-weight: 500;
    pointer-events: none; animation: fadeIn 0.2s ease;
  `
  el.textContent = '其他标签页有数据更新'
  document.body.appendChild(el)

  setTimeout(() => el.remove(), 3000)
}

function showImportWarning(): void {
  const existing = document.getElementById('multi-tab-import-warning')
  if (existing) return

  const el = document.createElement('div')
  el.id = 'multi-tab-import-warning'
  el.style.cssText = `
    position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
    z-index: 10001; padding: 20px 28px; border-radius: 12px;
    background: var(--bg-elevated); border: 1px solid rgba(255,149,0,0.3);
    box-shadow: var(--shadow-xl); text-align: center;
  `
  el.innerHTML = `
    <div style="font-size: 16px; font-weight: 600; color: var(--color-warning); margin-bottom: 8px;">&#9888; 其他标签页正在导入数据</div>
    <div style="font-size: 13px; color: var(--text-secondary);">请关闭此标签页或等待导入完成</div>
  `
  document.body.appendChild(el)
}

export function useMultiTabSync(): void {
  const cleanupRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    cleanupRef.current = initMultiTabSync()
    return () => cleanupRef.current?.()
  }, [])
}

export function checkOtherTabs(): boolean {
  return typeof BroadcastChannel !== 'undefined'
}
