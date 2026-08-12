import { useState, useEffect, useCallback, useRef } from 'react'
import { useAppStore } from '../stores/useAppStore'
import { getWidgetConfig } from '../registry'
import type { WidgetPosition } from '../types'

const EMPTY_POSITIONS: WidgetPosition[] = []

interface Props {
  onClose: () => void
}

export default function WidgetSearch({ onClose }: Props) {
  const [query, setQuery] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  const panels = useAppStore(s => s.panels)
  const activePanelId = useAppStore(s => s.activePanelId)
  const panelWidgets = useAppStore(s => s.panelWidgets)
  const setActivePanel = useAppStore(s => s.setActivePanel)
  const setCanvasTransform = useAppStore(s => s.setCanvasTransform)
  const bringToFront = useAppStore(s => s.bringToFront)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  const results = query.trim() ? (() => {
    const q = query.toLowerCase()
    const items: Array<{ widgetId: string; widgetType: string; displayName: string; panelId: string; panelName: string }> = []

    for (const panel of panels) {
      const widgets = panelWidgets[panel.id] ?? []
      for (const w of widgets) {
        const config = getWidgetConfig(w.widgetType)
        const displayName = config?.displayName || w.widgetType
        if (
          displayName.toLowerCase().includes(q) ||
          w.widgetType.toLowerCase().includes(q)
        ) {
          items.push({
            widgetId: w.widgetId,
            widgetType: w.widgetType,
            displayName,
            panelId: panel.id,
            panelName: panel.name,
          })
        }
      }
    }
    return items
  })() : []

  const handleSelect = useCallback((item: { widgetId: string; panelId: string }) => {
    if (item.panelId !== activePanelId) {
      setActivePanel(item.panelId)
    }

    const positions = useAppStore.getState().panelPositions[item.panelId] ?? EMPTY_POSITIONS
    const pos = positions.find(p => p.widgetId === item.widgetId)
    if (pos) {
      const vw = window.innerWidth
      const vh = window.innerHeight
      setCanvasTransform({
        x: vw / 2 - (pos.x + pos.w / 2),
        y: vh / 2 - (pos.y + pos.h / 2),
        zoom: 1,
      })
      bringToFront(item.widgetId)
    }
    onClose()
  }, [activePanelId, setActivePanel, setCanvasTransform, bringToFront, onClose])

  return (
    <div className="settings-overlay" onClick={onClose}>
      <div
        className="widget-search-panel"
        onClick={e => e.stopPropagation()}
        style={{
          position: 'fixed',
          top: '20%',
          left: '50%',
          transform: 'translateX(-50%)',
          width: 420,
          maxWidth: '90vw',
          background: 'var(--bg-elevated)',
          border: 'none',
          borderRadius: 'var(--radius-lg)',
          boxShadow: 'var(--shadow-xl)',
          overflow: 'hidden',
          animation: 'panelIn 0.2s var(--ease-out)',
        }}
      >
        <div style={{ padding: '12px 16px', borderBottom: '1px solid rgba(0,0,0,0.06)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="var(--text-tertiary)" strokeWidth="2" strokeLinecap="round"><circle cx="9" cy="9" r="6" /><line x1="13.5" y1="13.5" x2="18" y2="18" /></svg>
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="搜索组件名称或类型..."
            style={{
              flex: 1,
              background: 'rgba(0,0,0,0.04)',
              border: 'none',
              outline: 'none',
              color: 'var(--text-primary)',
              fontSize: 14,
              borderRadius: 'var(--radius-full)',
              padding: '8px 16px',
              transition: 'background 0.15s',
            }}
            onFocus={e => (e.currentTarget.style.background = 'rgba(0,0,0,0.06)')}
            onBlur={e => (e.currentTarget.style.background = 'rgba(0,0,0,0.04)')}
          />
          <span style={{ color: 'var(--text-tertiary)', fontSize: 11 }}>Esc 关闭</span>
        </div>

        {results.length > 0 && (
          <div style={{ maxHeight: 300, overflow: 'auto' }}>
            {results.map(item => (
              <button
                key={item.widgetId}
                onClick={() => handleSelect(item)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  width: '100%',
                  padding: '10px 16px',
                  border: 'none',
                  background: 'transparent',
                  color: 'var(--text-primary)',
                  cursor: 'pointer',
                  textAlign: 'left',
                  fontSize: 13,
                  transition: 'background 0.1s',
                }}
                onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-hover)')}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
              >
                <span style={{ color: 'var(--text-tertiary)', display: 'flex', alignItems: 'center' }}>
                  {getWidgetConfig(item.widgetType)?.icon}
                </span>
                <span style={{ flex: 1 }}>{item.displayName}</span>
                <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
                  {item.panelName}
                </span>
              </button>
            ))}
          </div>
        )}

        {query.trim() && results.length === 0 && (
          <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-tertiary)', fontSize: 13 }}>
            未找到匹配的组件
          </div>
        )}
      </div>
    </div>
  )
}
