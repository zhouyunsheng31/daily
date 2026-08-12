// ============================================================================
// Phase 2：相册三档缩放状态机
// 设计文档 §6.1-§6.7 + 决策日志 36/38/39/41
//
// 三档：
//   normal (zoom > normalThreshold) — 完整展示
//   mini   (iconThreshold ≤ zoom ≤ normalThreshold) — 精简 HTML（先用降级方案）
//   icon   (zoom < iconThreshold) — 圆形图标，卸载 iframe
//
// 触发：普通滚轮（向下 = normal→mini→icon，向上 = icon→mini→normal）
// 画布自由缩放保留为 Ctrl/⌘ + 滚轮（避免冲突，不破坏现有功能）
//
// 档位触发值用户可调，默认 normal>2.0、icon<0.4
// ============================================================================

import { create } from 'zustand'

export type ZoomTier = 'normal' | 'mini' | 'icon'

export const ZOOM_TIER_ORDER: ZoomTier[] = ['icon', 'mini', 'normal']

export const ZOOM_TIER_SCALES: Record<ZoomTier, number> = {
  normal: 1,
  mini: 0.5,
  icon: 0.2,
}

export const ZOOM_TIER_LABELS: Record<ZoomTier, string> = {
  normal: '正常 (100%)',
  mini: '缩小版 (50%)',
  icon: '图标 (20%)',
}

export interface AlbumZoomThresholds {
  /** zoom 严格大于该值 → normal 档 */
  normal: number
  /** zoom 严格小于该值 → icon 档 */
  icon: number
  /**
   * 大 widget 面积阈值（px²）。
   * 面积超过此值的 widget 在缩放时优先降级（大的先缩小，§6.4 + 决策36）。
   * widget 面积 = pos.w * pos.h（画布坐标系）。
   */
  largeWidgetThreshold: number
}

export const DEFAULT_ALBUM_THRESHOLDS: AlbumZoomThresholds = {
  normal: 2.0,
  icon: 0.4,
  largeWidgetThreshold: 100000,
}

interface AlbumZoomState {
  tier: ZoomTier
  /** 实际画布 zoom 值（来自 canvasTransform.zoom），用于辅助判断 */
  zoom: number
  thresholds: AlbumZoomThresholds
  /** 缩放档位变化时的视觉提示（key 变化触发动画重放） */
  indicator: { tier: ZoomTier; key: number } | null
  /** 上次滚轮吸附时间戳，用于节流 */
  lastSnapAt: number
  setTier: (tier: ZoomTier) => void
  setZoom: (zoom: number) => void
  setThresholds: (t: Partial<AlbumZoomThresholds>) => void
  snap: (direction: 'up' | 'down') => ZoomTier
  triggerIndicator: (tier: ZoomTier) => void
  clearIndicator: () => void
  /** 根据当前 zoom 重新计算 tier（被动响应画布自由缩放） */
  recomputeFromZoom: () => void
}

function getNextTier(current: ZoomTier, direction: 'up' | 'down'): ZoomTier {
  const idx = ZOOM_TIER_ORDER.indexOf(current)
  if (direction === 'down' && idx > 0) return ZOOM_TIER_ORDER[idx - 1]
  if (direction === 'up' && idx < ZOOM_TIER_ORDER.length - 1) return ZOOM_TIER_ORDER[idx + 1]
  return current
}

function tierFromZoom(zoom: number, thresholds: AlbumZoomThresholds): ZoomTier {
  if (zoom > thresholds.normal) return 'normal'
  if (zoom < thresholds.icon) return 'icon'
  return 'mini'
}

/**
 * 根据单个 widget 面积 + 当前画布 zoom 计算该 widget 应使用的 tier
 * 实现"大的先缩小"规则（设计文档 §6.4 + 决策36）：
 *   无论自由组件还是 iframe widget，都按大小决定怎么缩放；
 *   缩放时大的先缩小，确保整体协调统一。
 *
 * 算法：
 *   1. 小 widget（面积 ≤ largeWidgetThreshold）：直接使用全局 tier（来自 snap 或 zoom recompute）
 *   2. 大 widget（面积 > largeWidgetThreshold）：
 *      - 按面积相对阈值的比值计算 sizeFactor ∈ [0, 1]（log10 scale，每 10x 面积 → +0.3）
 *      - 降级档位数 = round(sizeFactor * 2) ∈ {0, 1, 2}
 *      - canvasZoom 接近当前 tier 下边界时，强制至少降 1 档（实现"zoom 稍大时就先缩到 mini"）
 *   3. 降级方向：normal → mini → icon（不会反向）
 *
 * 这样保证：
 *   - 用户 plain wheel snap 时，大 widget 也跟着降级（不会卡在 normal）
 *   - 用户 Ctrl+wheel 自由缩放接近阈值时，大 widget 提前进入更低 tier
 *   - 极大 widget（如 1000x 阈值）可能直接从 normal 跳到 icon
 *
 * @param widgetArea widget 在画布坐标系的面积（width * height，px²）
 * @param canvasZoom 当前画布 zoom（canvasTransform.zoom）
 * @returns 该 widget 应使用的 tier
 */
export function computeWidgetTier(widgetArea: number, canvasZoom: number): ZoomTier {
  const { tier: globalTier, thresholds } = useAlbumZoomStore.getState()

  // 小 widget：直接用全局 tier（不受面积影响）
  if (widgetArea <= thresholds.largeWidgetThreshold) {
    return globalTier
  }

  // 大 widget：基于面积比计算降级档位
  const ratio = widgetArea / thresholds.largeWidgetThreshold
  // sizeFactor: 10x 面积 → 0.3，100x → 0.6，1000x → 0.9（封顶 1.0）
  const sizeFactor = Math.min(1, Math.log10(ratio) * 0.3)
  let downgradeLevels = Math.round(sizeFactor * 2)

  // canvasZoom 边界微调：当 zoom 接近当前 tier 下边界时，大 widget 至少降 1 档
  // 实现"zoom 稍大时就先缩到 mini"的视觉效果（§6.4）
  // 必须同时检查下界 canvasZoom > thresholds.X：否则当 globalTier 与 canvasZoom
  // 不一致时（如初始状态 tier='normal' 但 canvasZoom=1.0），会错误触发降级，
  // 导致展示面板的大 widget（如 480×360 的 showcase-demo-1）在默认视图下被降到 mini。
  // 只有 canvasZoom 真正处于该 tier 范围内且接近下边界时才应预降级。
  if (globalTier === 'normal'
      && canvasZoom > thresholds.normal
      && canvasZoom <= thresholds.normal * 1.2) {
    downgradeLevels = Math.max(1, downgradeLevels)
  } else if (globalTier === 'mini'
      && canvasZoom > thresholds.icon
      && canvasZoom <= thresholds.icon * 2) {
    downgradeLevels = Math.max(1, downgradeLevels)
  }

  const idx = ZOOM_TIER_ORDER.indexOf(globalTier)
  return ZOOM_TIER_ORDER[Math.max(0, idx - downgradeLevels)]
}

export const useAlbumZoomStore = create<AlbumZoomState>((set, get) => ({
  tier: 'normal',
  zoom: 1,
  thresholds: DEFAULT_ALBUM_THRESHOLDS,
  indicator: null,
  lastSnapAt: 0,

  setTier: (tier) => set({ tier }),

  setZoom: (zoom) => {
    const { thresholds } = get()
    const next = tierFromZoom(zoom, thresholds)
    set({ zoom, tier: next })
  },

  setThresholds: (t) => {
    const thresholds = { ...get().thresholds, ...t }
    // 防止阈值反向（normal 必须大于 icon + 余量）
    if (thresholds.normal <= thresholds.icon + 0.1) {
      thresholds.normal = thresholds.icon + 0.1
    }
    // largeWidgetThreshold 必须为正数（防御性校验）
    if (!(thresholds.largeWidgetThreshold > 0)) {
      thresholds.largeWidgetThreshold = DEFAULT_ALBUM_THRESHOLDS.largeWidgetThreshold
    }
    const zoom = get().zoom
    const next = tierFromZoom(zoom, thresholds)
    set({ thresholds, tier: next })
  },

  snap: (direction) => {
    const now = Date.now()
    const { tier, lastSnapAt } = get()
    // 节流：120ms 内不重复吸附，避免滚轮连触跳档
    if (now - lastSnapAt < 120) return tier
    const next = getNextTier(tier, direction)
    if (next === tier) return tier
    set({ tier: next, lastSnapAt: now, indicator: { tier: next, key: now } })
    return next
  },

  triggerIndicator: (tier) => {
    set({ indicator: { tier, key: Date.now() } })
  },

  clearIndicator: () => set({ indicator: null }),

  recomputeFromZoom: () => {
    const { zoom, thresholds } = get()
    const next = tierFromZoom(zoom, thresholds)
    set({ tier: next })
  },
}))
