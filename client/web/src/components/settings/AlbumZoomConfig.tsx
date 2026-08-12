import { useAlbumZoomStore, ZOOM_TIER_LABELS, ZOOM_TIER_SCALES, type ZoomTier } from '../../stores/useAlbumZoomStore'

// ============================================================================
// Phase 2：相册缩放设置页（设计文档 §6.3 + 决策日志 36）
// 在 Settings 页提供档位触发值调整 UI（画布上无浮动面板，按决策41缩放仅滚轮触发）
// ============================================================================

const TIER_DESCRIPTIONS: Record<ZoomTier, string> = {
  normal: '完整展示。所有 widget 原样渲染，无缩放。',
  mini: 'AI 选择的精简 HTML 形态（当前用 scale(0.5) 降级，TODO: Phase 后续让 AI 生成精简 HTML 摘要）。视口虚拟化：只渲染视口内 widget。',
  icon: 'AI 画的 HTML 图标（当前用首字母圆形占位，TODO: Phase 后续让 AI 画圆形图标）。卸载 iframe 省性能。',
}

export default function AlbumZoomConfig() {
  const thresholds = useAlbumZoomStore(s => s.thresholds)
  const setThresholds = useAlbumZoomStore(s => s.setThresholds)
  const tier = useAlbumZoomStore(s => s.tier)
  const setTier = useAlbumZoomStore(s => s.setTier)

  return (
    <div className="settings-section" style={{ padding: 16, maxWidth: 640 }}>
      <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 12 }}>相册三档缩放</h2>
      <p style={{ fontSize: 12, color: 'var(--text-tertiary)', marginBottom: 16 }}>
        设计文档 §6.1-§6.7 + 决策日志 36/38/39/41。滚轮触发三档吸附（normal→mini→icon），
        Ctrl/⌘+滚轮自由缩放画布。大的先缩小保证整体协调。
      </p>

      {/* 当前档位 */}
      <div style={{
        padding: 12, borderRadius: 8, marginBottom: 16,
        background: 'var(--bg-elevated)', border: '1px solid var(--border-default)',
      }}>
        <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginBottom: 4 }}>当前档位</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{
            width: 10, height: 10, borderRadius: '50%',
            background: tier === 'normal' ? '#4A90E2' : tier === 'mini' ? '#FF9500' : '#FF6B6B',
          }} />
          <strong>{ZOOM_TIER_LABELS[tier]}</strong>
          <span style={{ fontSize: 11, color: 'var(--text-tertiary)', fontFamily: 'monospace' }}>
            scale={ZOOM_TIER_SCALES[tier]}
          </span>
        </div>
        <div style={{ marginTop: 8, fontSize: 12, color: 'var(--text-secondary)' }}>
          {TIER_DESCRIPTIONS[tier]}
        </div>
        <div style={{ display: 'flex', gap: 6, marginTop: 12 }}>
          {(['normal', 'mini', 'icon'] as ZoomTier[]).map(t => (
            <button
              key={t}
              onClick={() => setTier(t)}
              style={{
                padding: '4px 12px', borderRadius: 6, fontSize: 12, cursor: 'pointer',
                border: tier === t ? '1px solid var(--color-primary)' : '1px solid var(--border-default)',
                background: tier === t ? 'var(--color-primary-muted)' : 'var(--bg-surface)',
                color: tier === t ? 'var(--color-primary-dark)' : 'var(--text-secondary)',
              }}
            >
              {ZOOM_TIER_LABELS[t]}
            </button>
          ))}
        </div>
      </div>

      {/* 档位触发值 */}
      <div style={{
        padding: 12, borderRadius: 8, marginBottom: 16,
        background: 'var(--bg-elevated)', border: '1px solid var(--border-default)',
      }}>
        <h3 style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>档位触发值</h3>
        <div style={{ marginBottom: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
            <span style={{ fontSize: 12 }}>normal 档（zoom 严格大于）</span>
            <span style={{ fontFamily: 'monospace', fontSize: 12 }}>{thresholds.normal.toFixed(1)}</span>
          </div>
          <input
            type="range" min={0.5} max={3} step={0.1}
            value={thresholds.normal}
            onChange={(e) => setThresholds({ normal: parseFloat(e.target.value) })}
            style={{ width: '100%' }}
          />
        </div>
        <div style={{ marginBottom: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
            <span style={{ fontSize: 12 }}>icon 档（zoom 严格小于）</span>
            <span style={{ fontFamily: 'monospace', fontSize: 12 }}>{thresholds.icon.toFixed(1)}</span>
          </div>
          <input
            type="range" min={0.1} max={1.5} step={0.1}
            value={thresholds.icon}
            onChange={(e) => setThresholds({ icon: parseFloat(e.target.value) })}
            style={{ width: '100%' }}
          />
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
          中间区间（{thresholds.icon.toFixed(1)} ≤ zoom ≤ {thresholds.normal.toFixed(1)}）→ mini 档
        </div>
      </div>

      {/* 大 widget 阈值（§6.4 + 决策36：大的先缩小） */}
      <div style={{
        padding: 12, borderRadius: 8, marginBottom: 16,
        background: 'var(--bg-elevated)', border: '1px solid var(--border-default)',
      }}>
        <h3 style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>大 widget 阈值（大的先缩小）</h3>
        <p style={{ fontSize: 11, color: 'var(--text-tertiary)', marginBottom: 12, lineHeight: 1.6 }}>
          设计文档 §6.4 + 决策36：面积超过此值的 widget 在缩放时优先降级（normal→mini→icon），
          确保大 widget 先缩小，整体协调统一。面积 = widget 宽 × 高（画布坐标系）。
        </p>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
          <span style={{ fontSize: 12 }}>大 widget 面积阈值（px²）</span>
          <span style={{ fontFamily: 'monospace', fontSize: 12 }}>{thresholds.largeWidgetThreshold.toLocaleString()}</span>
        </div>
        <input
          type="range" min={10000} max={500000} step={10000}
          value={thresholds.largeWidgetThreshold}
          onChange={(e) => setThresholds({ largeWidgetThreshold: parseFloat(e.target.value) })}
          style={{ width: '100%' }}
        />
        <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 6, lineHeight: 1.6 }}>
          常见尺寸参考：300×300 = 90,000 · 400×400 = 160,000 · 500×500 = 250,000 · 800×600 = 480,000<br/>
          超过阈值的 widget 面积越大，降级档位越多（最多降 2 档：normal→icon）。
        </div>
      </div>

      {/* 使用说明 */}
      <div style={{
        padding: 12, borderRadius: 8,
        background: 'var(--bg-elevated)', border: '1px solid var(--border-default)',
        fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.8,
      }}>
        <strong style={{ display: 'block', marginBottom: 6 }}>使用方式</strong>
        <div>• 普通滚轮：三档吸附（向下 normal→mini→icon，向上反向）</div>
        <div>• Ctrl/⌘ + 滚轮：画布自由缩放（保留原有功能）</div>
        <div>• icon 档点击占位图标：恢复 normal 档</div>
        <div>• 每个 widget 按面积独立计算 tier（大的先缩小，§6.4 + 决策36）</div>
      </div>
    </div>
  )
}
