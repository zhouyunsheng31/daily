import type { DrawingPoint, WidgetPosition, ConnectionAnchor } from '../types'

// 获取指定边的中点（画布世界坐标）
export function getAnchorPosition(
  widget: { x: number; y: number; w: number; h: number },
  anchor: ConnectionAnchor
): DrawingPoint {
  switch (anchor) {
    case 'top':    return { x: widget.x + widget.w / 2, y: widget.y }
    case 'right':  return { x: widget.x + widget.w,     y: widget.y + widget.h / 2 }
    case 'bottom': return { x: widget.x + widget.w / 2, y: widget.y + widget.h }
    case 'left':   return { x: widget.x,                y: widget.y + widget.h / 2 }
  }
}

// 贝塞尔曲线路径（用于连线）
export function buildConnectionPath(p1: DrawingPoint, p2: DrawingPoint): string {
  const dx = p2.x - p1.x
  const dy = p2.y - p1.y
  const dist = Math.sqrt(dx * dx + dy * dy)
  const handle = Math.min(dist * 0.3, 100)

  // 控制点垂直于连线方向（产生弧度）
  const angle = Math.atan2(dy, dx) - Math.PI / 2
  const cx1 = p1.x + Math.cos(angle) * handle
  const cy1 = p1.y + Math.sin(angle) * handle
  const cx2 = p2.x + Math.cos(angle) * handle
  const cy2 = p2.y + Math.sin(angle) * handle

  return `M ${p1.x} ${p1.y} C ${cx1} ${cy1}, ${cx2} ${cy2}, ${p2.x} ${p2.y}`
}

// 直线路径（用于直线笔迹）
export function buildLinePath(p1: DrawingPoint, p2: DrawingPoint): string {
  return `M ${p1.x} ${p1.y} L ${p2.x} ${p2.y}`
}

// 自由画笔 SVG path（多个点）
export function buildFreehandPath(points: DrawingPoint[]): string {
  if (points.length === 0) return ''
  if (points.length === 1) {
    return `M ${points[0].x} ${points[0].y}`
  }
  const parts: string[] = [`M ${points[0].x} ${points[0].y}`]
  for (let i = 1; i < points.length; i++) {
    parts.push(`L ${points[i].x} ${points[i].y}`)
  }
  return parts.join(' ')
}

// 距离计算
export function distance(a: DrawingPoint, b: DrawingPoint): number {
  const dx = a.x - b.x
  const dy = a.y - b.y
  return Math.sqrt(dx * dx + dy * dy)
}

// 点到线段的距离
export function distanceToSegment(p: DrawingPoint, v: DrawingPoint, w: DrawingPoint): number {
  const l2 = (v.x - w.x) * (v.x - w.x) + (v.y - w.y) * (v.y - w.y)
  if (l2 === 0) return distance(p, v)
  let t = ((p.x - v.x) * (w.x - v.x) + (p.y - v.y) * (w.y - v.y)) / l2
  t = Math.max(0, Math.min(1, t))
  const projection: DrawingPoint = {
    x: v.x + t * (w.x - v.x),
    y: v.y + t * (w.y - v.y),
  }
  return distance(p, projection)
}

// 检测点是否在矩形内（用于锚点吸附判断）
export function isPointInRect(
  point: DrawingPoint,
  rect: { x: number; y: number; w: number; h: number }
): boolean {
  return (
    point.x >= rect.x &&
    point.x <= rect.x + rect.w &&
    point.y >= rect.y &&
    point.y <= rect.y + rect.h
  )
}

// 找最近的锚点（用于连线拖拽时的吸附）
export function findNearestAnchor(
  point: DrawingPoint,
  widgets: Array<{ widgetId: string; position: WidgetPosition }>,
  excludeWidgetId: string | null,
  snapDistance: number = 16
): { widgetId: string; anchor: ConnectionAnchor; position: DrawingPoint } | null {
  let nearest: { widgetId: string; anchor: ConnectionAnchor; position: DrawingPoint; dist: number } | null = null
  for (const w of widgets) {
    if (w.widgetId === excludeWidgetId) continue
    const anchors: ConnectionAnchor[] = ['top', 'right', 'bottom', 'left']
    for (const a of anchors) {
      const pos = getAnchorPosition(w.position, a)
      const d = distance(point, pos)
      if (d <= snapDistance && (!nearest || d < nearest.dist)) {
        nearest = { widgetId: w.widgetId, anchor: a, position: pos, dist: d }
      }
    }
  }
  if (!nearest) return null
  return { widgetId: nearest.widgetId, anchor: nearest.anchor, position: nearest.position }
}

// 检测点是否在组件内（用于 hover）
export function findWidgetAtPoint(
  point: DrawingPoint,
  widgets: Array<{ widgetId: string; position: WidgetPosition }>
): string | null {
  // 从上往下（zIndex 大的优先）检测
  const sorted = [...widgets].sort((a, b) => b.position.zIndex - a.position.zIndex)
  for (const w of sorted) {
    if (isPointInRect(point, w.position)) {
      return w.widgetId
    }
  }
  return null
}

// 笔迹降采样：每 2 个点保留 1 个
export function downsamplePoints(points: DrawingPoint[]): DrawingPoint[] {
  if (points.length <= 200) return points
  const result: DrawingPoint[] = [points[0]]
  for (let i = 2; i < points.length; i += 2) {
    result.push(points[i])
  }
  // 保留最后一个点
  if (result[result.length - 1] !== points[points.length - 1]) {
    result.push(points[points.length - 1])
  }
  return result
}

// 生成 ID
export function generateId(prefix: string = 'id'): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
}

// 检查鼠标事件目标是否是组件内的输入区域（用于透传判断）
export function isInteractiveElement(target: EventTarget | null): boolean {
  if (!target || !(target instanceof Element)) return false
  const selector = 'input, textarea, select, button, [contenteditable], [role="textbox"], [role="button"], [role="listbox"], [role="option"], a[href], [data-widget-interactive="true"]'
  if (target.matches(selector)) {
    return true
  }
  if (target.closest(selector)) {
    return true
  }
  return false
}
