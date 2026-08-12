import { useAppStore } from '../stores/useAppStore'
import type { DrawingStroke } from '../types'
import { buildFreehandPath, buildLinePath, downsamplePoints } from '../utils/drawingCoords'

const EMPTY_STROKES: DrawingStroke[] = []

interface StrokesLayerProps {
  panelId: string
  mode: 'committed' | 'draft'
  draftStroke?: DrawingStroke | null
}

function renderStroke(stroke: DrawingStroke): React.ReactNode {
  const { type, points, style, text } = stroke
  const common = {
    stroke: style.color,
    strokeWidth: style.width,
    opacity: style.opacity,
    fill: 'none',
  }
  if (type === 'freehand') {
    const pts = downsamplePoints(points)
    return <path d={buildFreehandPath(pts)} {...common} strokeLinecap="round" strokeLinejoin="round" />
  }
  if (type === 'line') {
    if (points.length < 2) return null
    return <path d={buildLinePath(points[0], points[1])} {...common} strokeLinecap="round" />
  }
  if (type === 'arrow') {
    if (points.length < 2) return null
    const [p1, p2] = points
    const angle = Math.atan2(p2.y - p1.y, p2.x - p1.x)
    const arrowSize = Math.max(8, style.width * 2.5)
    const arrowX = p2.x - Math.cos(angle) * arrowSize
    const arrowY = p2.y - Math.sin(angle) * arrowSize
    const leftWingX = arrowX - Math.cos(angle - Math.PI / 2) * arrowSize * 0.4
    const leftWingY = arrowY - Math.sin(angle - Math.PI / 2) * arrowSize * 0.4
    const rightWingX = arrowX - Math.cos(angle + Math.PI / 2) * arrowSize * 0.4
    const rightWingY = arrowY - Math.sin(angle + Math.PI / 2) * arrowSize * 0.4
    return (
      <g>
        <path d={buildLinePath(p1, p2)} {...common} strokeLinecap="round" />
        <path
          d={`M ${p2.x} ${p2.y} L ${leftWingX} ${leftWingY} M ${p2.x} ${p2.y} L ${rightWingX} ${rightWingY}`}
          {...common}
          strokeLinecap="round"
        />
      </g>
    )
  }
  if (type === 'rect') {
    if (points.length < 2) return null
    const [p1, p2] = points
    const x = Math.min(p1.x, p2.x)
    const y = Math.min(p1.y, p2.y)
    const w = Math.abs(p2.x - p1.x)
    const h = Math.abs(p2.y - p1.y)
    return (
      <rect
        x={x}
        y={y}
        width={w}
        height={h}
        stroke={style.color}
        strokeWidth={style.width}
        opacity={style.opacity}
        fill={style.fill && style.fill !== 'none' ? style.fill : 'none'}
      />
    )
  }
  if (type === 'ellipse') {
    if (points.length < 2) return null
    const [p1, p2] = points
    const cx = (p1.x + p2.x) / 2
    const cy = (p1.y + p2.y) / 2
    const rx = Math.abs(p2.x - p1.x) / 2
    const ry = Math.abs(p2.y - p1.y) / 2
    return (
      <ellipse
        cx={cx}
        cy={cy}
        rx={rx}
        ry={ry}
        stroke={style.color}
        strokeWidth={style.width}
        opacity={style.opacity}
        fill={style.fill && style.fill !== 'none' ? style.fill : 'none'}
      />
    )
  }
  if (type === 'text') {
    if (points.length < 1) return null
    const p = points[0]
    return (
      <text
        x={p.x}
        y={p.y}
        fill={style.color}
        opacity={style.opacity}
        fontSize="16"
        fontFamily="sans-serif"
      >
        {text || ''}
      </text>
    )
  }
  return null
}

export function StrokesLayer({ panelId, mode, draftStroke }: StrokesLayerProps) {
  const committedStrokes = useAppStore(s => s.strokes[panelId] ?? EMPTY_STROKES)
  const canvasMode = useAppStore(s => (s.canvasMode[panelId] ?? 'select'))

  // committed 层在 draw/erase 模式 auto，select/pan/connect/text 模式 none
  const committedPointerEvents = (mode === 'committed' && (canvasMode === 'draw' || canvasMode === 'erase')) ? 'auto' : 'none'

  if (mode === 'draft') {
    if (!draftStroke) return null
    return (
      <svg className="strokes-layer strokes-layer--draft" style={{ pointerEvents: 'none' }}>
        {renderStroke(draftStroke)}
      </svg>
    )
  }

  return (
    <svg
      className="strokes-layer strokes-layer--committed"
      style={{ pointerEvents: committedPointerEvents as 'auto' | 'none' }}
    >
      {committedStrokes.map(s => (
        <g key={s.id} data-stroke-id={s.id}>
          {renderStroke(s)}
        </g>
      ))}
    </svg>
  )
}
