import { useMemo } from 'react'
import type { WidgetPosition, WidgetConnection } from '../types'
import { useAppStore } from '../stores/useAppStore'
import { buildConnectionPath, getAnchorPosition } from '../utils/drawingCoords'

const EMPTY_CONNECTIONS: WidgetConnection[] = []
const EMPTY_POSITIONS: WidgetPosition[] = []

interface ConnectionLayerProps {
  panelId: string
}

function ArrowMarker({ id, color }: { id: string; color: string }) {
  return (
    <marker
      id={id}
      viewBox="0 0 10 10"
      refX="9"
      refY="5"
      markerWidth="6"
      markerHeight="6"
      orient="auto-start-reverse"
    >
      <path d="M 0 0 L 10 5 L 0 10 z" fill={color} />
    </marker>
  )
}

export function ConnectionLayer({ panelId }: ConnectionLayerProps) {
  const connections = useAppStore(s => s.connections[panelId] ?? EMPTY_CONNECTIONS)
  const positions = useAppStore(s => s.panelPositions[panelId] ?? EMPTY_POSITIONS)
  const canvasMode = useAppStore(s => (s.canvasMode[panelId] ?? 'select'))
  const hoveredWidgetId = useAppStore(s => s.hoveredWidgetId)
  const hideConnections = useAppStore(s => s.hideConnections)

  // 缓存 widget 位置查找
  const positionMap = useMemo(() => {
    const map = new Map<string, WidgetPosition>()
    for (const p of positions) {
      map.set(p.widgetId, p)
    }
    return map
  }, [positions])

  // 过滤掉引用不存在 widget 的连线
  const validConnections = useMemo(() => {
    return connections.filter(c => {
      if (!positionMap.has(c.source.widgetId) || !positionMap.has(c.target.widgetId)) return false
      return true
    })
  }, [connections, positionMap])

  // 计算某 widget 的锚点位置（用于 connect 模式渲染）
  const getWidgetAnchors = (widgetId: string) => {
    const pos = positionMap.get(widgetId)
    if (!pos) return null
    return {
      top: getAnchorPosition(pos, 'top'),
      right: getAnchorPosition(pos, 'right'),
      bottom: getAnchorPosition(pos, 'bottom'),
      left: getAnchorPosition(pos, 'left'),
    }
  }

  // 找出 hover 命中的 widget
  const hoveredAnchors = (() => {
    if (canvasMode !== 'connect' || !hoveredWidgetId) return null
    const anchors = getWidgetAnchors(hoveredWidgetId)
    if (!anchors) return null
    return anchors
  })()

  return (
    <svg
      className="connection-layer"
      style={{ pointerEvents: 'none' }}
    >
      <defs>
        {!hideConnections && validConnections.map(c => (
          <ArrowMarker key={`marker-${c.id}`} id={`arrow-${c.id}`} color={c.style.color} />
        ))}
      </defs>
      {!hideConnections && validConnections.map(c => {
        const sp = positionMap.get(c.source.widgetId)!
        const tp = positionMap.get(c.target.widgetId)!
        const p1 = getAnchorPosition(sp, c.source.anchor)
        const p2 = getAnchorPosition(tp, c.target.anchor)
        const path = buildConnectionPath(p1, p2)
        return (
          <g key={c.id} className="connection-layer__connection">
            <path
              d={path}
              stroke={c.style.color}
              strokeWidth={c.style.width}
              fill="none"
              strokeDasharray={c.style.dashed ? '6,4' : undefined}
              markerEnd={c.style.arrow && c.style.arrow !== 'none' ? `url(#arrow-${c.id})` : undefined}
              markerStart={c.style.arrow === 'both' ? `url(#arrow-${c.id})` : undefined}
            />
            {c.label && (
              <text
                x={(p1.x + p2.x) / 2}
                y={(p1.y + p2.y) / 2 - 8}
                fill={c.style.color}
                fontSize="12"
                textAnchor="middle"
                className="connection-layer__label"
              >
                {c.label}
              </text>
            )}
          </g>
        )
      })}
      {/* connect 模式：hover 命中的 widget 显示锚点（不受 hideConnections 影响） */}
      {hoveredAnchors && (
        <g className="connection-layer__anchors">
          {(['top', 'right', 'bottom', 'left'] as const).map(anchor => {
            const p = hoveredAnchors[anchor]
            return (
              <g key={anchor} className="connection-layer__anchor-group">
                <circle
                  cx={p.x}
                  cy={p.y}
                  r={10}
                  fill="rgba(74, 144, 226, 0.15)"
                  pointerEvents="none"
                />
                <circle
                  cx={p.x}
                  cy={p.y}
                  r={8}
                  fill="#4A90E2"
                  stroke="white"
                  strokeWidth={1.5}
                  className="connection-layer__anchor"
                  data-anchor={anchor}
                />
              </g>
            )
          })}
        </g>
      )}
    </svg>
  )
}
