import { useState, useEffect, useRef } from 'react'
import { useAppStore } from '../stores/useAppStore'

export default function FloatingOrb() {
  const [open, setOpen] = useState(false)
  const orbRef = useRef<HTMLDivElement>(null)

  const panels = useAppStore(s => s.panels)
  const activePanelId = useAppStore(s => s.activePanelId)
  const addPanel = useAppStore(s => s.addPanel)
  const setActivePanel = useAppStore(s => s.setActivePanel)
  const deletePanel = useAppStore(s => s.deletePanel)

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (orbRef.current && orbRef.current.contains(e.target as Node)) return
      setOpen(false)
    }
    const timer = setTimeout(() => document.addEventListener('mousedown', handler), 0)
    return () => { clearTimeout(timer); document.removeEventListener('mousedown', handler) }
  }, [open])

  const openSettings = () => {
    useAppStore.setState({ showSettings: true })
    setOpen(false)
  }

  return (
    <div ref={orbRef} className="floating-orb-container">
      <button
        className={`floating-orb ${open ? 'active' : ''}`}
        onClick={() => setOpen(!open)}
        title="菜单"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="1" />
          <circle cx="12" cy="5" r="1" />
          <circle cx="12" cy="19" r="1" />
        </svg>
      </button>

      {open && (
        <div className="orb-menu">
          <div className="orb-menu-section">
            <span className="orb-menu-label">面板</span>
            {panels.map(panel => (
              <button
                key={panel.id}
                className={`orb-menu-item ${panel.id === activePanelId ? 'active' : ''}`}
                onClick={() => { setActivePanel(panel.id); setOpen(false) }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2" /></svg>
                <span className="orb-menu-item-text">{panel.name}</span>
                <button className="orb-menu-item-action" onClick={e => { e.stopPropagation(); deletePanel(panel.id) }} title="删除">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                </button>
              </button>
            ))}
            <button className="orb-menu-item" onClick={() => addPanel('新面板')}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
              <span className="orb-menu-item-text">新建面板</span>
            </button>
          </div>

          <div className="orb-menu-divider" />

          <div className="orb-menu-section">
            <button className="orb-menu-item" onClick={openSettings}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /></svg>
              <span className="orb-menu-item-text">设置</span>
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
