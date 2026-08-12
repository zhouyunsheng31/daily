import { useAppStore } from '../stores/useAppStore'
import { getCommandStack } from '../utils/commandStack'
import type { CanvasMode, DrawingStroke, DrawingStrokeType } from '../types'

const EMPTY_STROKES: DrawingStroke[] = []

interface ToolButtonProps {
  active: boolean
  label: string
  shortcut: string
  onClick: () => void
  disabled?: boolean
  hidden?: boolean
}

function ToolButton({ active, label, shortcut, onClick, disabled, hidden }: ToolButtonProps) {
  if (hidden) return null
  return (
    <button
      type="button"
      className={`canvas-mode-toolbar__btn ${active ? 'is-active' : ''}`}
      onClick={onClick}
      disabled={disabled}
      title={`${label} (${shortcut})`}
    >
      <span className="canvas-mode-toolbar__icon">{label[0]}</span>
      <span className="canvas-mode-toolbar__full">{label}</span>
    </button>
  )
}

function Separator() {
  return <div className="canvas-mode-toolbar__sep" />
}

export function CanvasModeToolbar() {
  const activePanelId = useAppStore(s => s.activePanelId)
  const mode = useAppStore(s => (activePanelId ? (s.canvasMode[activePanelId] ?? 'select') : 'select'))
  const drawingTool = useAppStore(s => s.drawingTool)
  const setCanvasMode = useAppStore(s => s.setCanvasMode)
  const setDrawingTool = useAppStore(s => s.setDrawingTool)
  const clearStrokes = useAppStore(s => s.clearStrokes)
  const undo = useAppStore(s => s.undo)
  const redo = useAppStore(s => s.redo)
  const canUndo = useAppStore(s => s.canUndo())
  const canRedo = useAppStore(s => s.canRedo())
  const strokes = useAppStore(s => (activePanelId ? (s.strokes[activePanelId] ?? EMPTY_STROKES) : EMPTY_STROKES))

  if (!activePanelId) return null

  const setMode = (m: CanvasMode) => {
    setCanvasMode(activePanelId, m)
  }

  const setTool = (tool: DrawingStrokeType) => {
    setDrawingTool(tool)
    setMode('draw')
  }

  const handleClear = async () => {
    if (strokes.length === 0) return
    const ok = window.confirm(`确定清空当前面板的所有笔迹？共 ${strokes.length} 条。`)
    if (!ok) return
    // 记录清空前的所有 stroke 快照
    const snapshot = [...strokes]
    // 检查是否超过 2000 条限制
    const canUndo = snapshot.length <= 2000
    await clearStrokes(activePanelId)
    if (canUndo) {
      // 入命令栈（占 1 步，可恢复）
      getCommandStack(activePanelId).push({
        description: `clear ${snapshot.length} strokes`,
        execute: async () => { await useAppStore.getState().clearStrokes(activePanelId) },
        undo: async () => {
          // 恢复所有 stroke
          for (const s of snapshot) {
            await useAppStore.getState().addStroke(activePanelId, s)
          }
        },
        redo: async () => { await useAppStore.getState().clearStrokes(activePanelId) },
      })
    } else {
      // 超过 2000 不入命令栈
      window.alert('已清空笔迹，但因笔迹过多（> 2000 条）操作不可撤销。')
    }
  }

  return (
    <div className="canvas-mode-toolbar" role="toolbar" aria-label="画布模式工具栏">
      <ToolButton
        label="选择"
        shortcut="V"
        active={mode === 'select'}
        onClick={() => setMode('select')}
      />
      <ToolButton
        label="拖动"
        shortcut="H"
        active={mode === 'pan'}
        onClick={() => setMode('pan')}
      />
      <Separator />
      <ToolButton
        label="画笔"
        shortcut="P"
        active={mode === 'draw' && drawingTool === 'freehand'}
        onClick={() => { setDrawingTool('freehand'); setMode('draw') }}
      />
      <ToolButton
        label="直线"
        shortcut="L"
        active={mode === 'draw' && drawingTool === 'line'}
        onClick={() => setTool('line')}
      />
      <ToolButton
        label="箭头"
        shortcut="A"
        active={mode === 'draw' && drawingTool === 'arrow'}
        onClick={() => setTool('arrow')}
      />
      <ToolButton
        label="矩形"
        shortcut="R"
        active={mode === 'draw' && drawingTool === 'rect'}
        onClick={() => setTool('rect')}
      />
      <ToolButton
        label="椭圆"
        shortcut="O"
        active={mode === 'draw' && drawingTool === 'ellipse'}
        onClick={() => setTool('ellipse')}
      />
      <ToolButton
        label="文本"
        shortcut="T"
        active={mode === 'draw' && drawingTool === 'text'}
        onClick={() => setTool('text')}
      />
      <Separator />
      <ToolButton
        label="橡皮"
        shortcut="E"
        active={mode === 'erase'}
        onClick={() => setMode('erase')}
      />
      <ToolButton
        label="连线"
        shortcut="C"
        active={mode === 'connect'}
        onClick={() => setMode('connect')}
      />
      <Separator />
      <ToolButton
        label="撤销"
        shortcut="Ctrl+Z"
        active={false}
        onClick={() => void undo()}
        disabled={!canUndo}
      />
      <ToolButton
        label="重做"
        shortcut="Ctrl+Y"
        active={false}
        onClick={() => void redo()}
        disabled={!canRedo}
      />
      <Separator />
      <ToolButton
        label="清空"
        shortcut=""
        active={false}
        onClick={handleClear}
        disabled={strokes.length === 0}
      />
    </div>
  )
}
