import { useAppStore } from '../stores/useAppStore'
import { Move, Grid3x3 } from 'lucide-react'

export default function LayoutModeToggle() {
  const { activePanelId, panels, updatePanelSettings } = useAppStore()

  const panel = panels.find(p => p.id === activePanelId)
  const layoutMode = panel?.settings.layoutMode ?? 'free'

  const handleToggle = () => {
    if (!activePanelId) return
    const newMode = layoutMode === 'free' ? 'grid' : 'free'
    updatePanelSettings(activePanelId, { layoutMode: newMode })
  }

  return (
    <div className="layout-toggle">
      <button
        className={`layout-toggle-btn ${layoutMode === 'free' ? 'active' : ''}`}
        onClick={layoutMode === 'free' ? undefined : handleToggle}
      >
        <Move size={12} /> 自由
      </button>
      <button
        className={`layout-toggle-btn ${layoutMode === 'grid' ? 'active' : ''}`}
        onClick={layoutMode === 'grid' ? undefined : handleToggle}
      >
        <Grid3x3 size={12} /> 网格
      </button>
    </div>
  )
}
