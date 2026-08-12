/**
 * Phase 7 批次4 任务7（spec 6.2.3 节）：动效与无障碍 Tab
 *
 * 功能：
 * - 减弱动画开关（reduceMotion）
 *   - 通过 document.documentElement 上的 data-reduce-motion="true" 属性实现
 *   - 配合 index.css 中的 [data-reduce-motion="true"] * 选择器禁用 transition/animation
 * - 高对比度模式开关（highContrast）
 *   - 切换 data-high-contrast 属性，配合 CSS 中的高对比度色彩覆盖
 * - 字体缩放滑块（fontScale 80% - 150%）
 *   - 通过 document.documentElement.style.fontSize = `${fontScale * 100}%` 实现
 *   - 基于 rem 的样式自动缩放（1rem = 根 font-size）
 * - 紧凑模式开关（compactMode）
 *   - 切换 data-compact-mode 属性，配合 CSS 减小间距
 *
 * 持久化：useAppStore.settings.accessibility（与 appearance/behavior 同级），spec 6.5 节注 10。
 * App.tsx 订阅 settings.accessibility 变化并应用到 document.documentElement，
 * 保证应用启动时（即使未打开设置面板）无障碍设置也生效。
 */
import { useAppStore } from '../../stores/useAppStore'
import { useToastStore } from '../../stores/useToastStore'
import { DEFAULT_ACCESSIBILITY } from '../../types'
import type { AccessibilitySettings } from '../../types'
import { Sparkles, Type, Contrast, Shrink, RotateCcw } from 'lucide-react'

export default function AccessibilityConfig() {
  const accessibility = useAppStore(s => s.settings.accessibility ?? DEFAULT_ACCESSIBILITY)
  const updateAccessibility = useAppStore(s => s.updateAccessibility)
  const showToast = useToastStore(s => s.showToast)

  const update = <K extends keyof AccessibilitySettings>(key: K, value: AccessibilitySettings[K]) => {
    void updateAccessibility({ [key]: value } as Pick<AccessibilitySettings, K>)
  }

  const handleReset = async () => {
    await updateAccessibility(DEFAULT_ACCESSIBILITY)
    showToast({ type: 'success', message: '已恢复默认', duration: 1500 })
  }

  const fontScalePercent = Math.round(accessibility.fontScale * 100)

  return (
    <section className="settings-section">
      <h3 className="settings-section-title">动效与无障碍</h3>

      {/* 减弱动画 */}
      <div className="settings-row">
        <div className="settings-label-group">
          <span className="settings-label">
            <Sparkles size={13} style={{ marginRight: 6, verticalAlign: 'middle' }} />
            减弱动画
          </span>
          <span className="settings-desc">
            禁用界面过渡和动画（适合对动效敏感或性能较差的设备）
          </span>
        </div>
        <label className="toggle-switch">
          <input
            type="checkbox"
            checked={accessibility.reduceMotion}
            onChange={e => update('reduceMotion', e.target.checked)}
          />
          <span className="toggle-slider" />
        </label>
      </div>

      {/* 字体缩放滑块（80% - 150%） */}
      <div className="settings-row">
        <div className="settings-label-group">
          <span className="settings-label">
            <Type size={13} style={{ marginRight: 6, verticalAlign: 'middle' }} />
            字体缩放
          </span>
          <span className="settings-desc">
            调整界面基础字体大小（基于 rem 自动缩放）。当前：{fontScalePercent}%
          </span>
        </div>
        <div className="ac-slider-wrap">
          <input
            type="range"
            min={0.8}
            max={1.5}
            step={0.05}
            value={accessibility.fontScale}
            onChange={e => update('fontScale', parseFloat(e.target.value))}
            className="ac-slider"
          />
          <span className="ac-slider-value">{fontScalePercent}%</span>
        </div>
      </div>

      {/* 高对比度模式 */}
      <div className="settings-row">
        <div className="settings-label-group">
          <span className="settings-label">
            <Contrast size={13} style={{ marginRight: 6, verticalAlign: 'middle' }} />
            高对比度模式
          </span>
          <span className="settings-desc">
            增强文字与背景的对比度，提升可读性（适合视力辅助）
          </span>
        </div>
        <label className="toggle-switch">
          <input
            type="checkbox"
            checked={accessibility.highContrast}
            onChange={e => update('highContrast', e.target.checked)}
          />
          <span className="toggle-slider" />
        </label>
      </div>

      {/* 紧凑模式 */}
      <div className="settings-row">
        <div className="settings-label-group">
          <span className="settings-label">
            <Shrink size={13} style={{ marginRight: 6, verticalAlign: 'middle' }} />
            紧凑模式
          </span>
          <span className="settings-desc">
            减小界面间距和 padding，在同样空间内容纳更多内容
          </span>
        </div>
        <label className="toggle-switch">
          <input
            type="checkbox"
            checked={accessibility.compactMode}
            onChange={e => update('compactMode', e.target.checked)}
          />
          <span className="toggle-slider" />
        </label>
      </div>

      {/* 恢复默认 */}
      <div className="settings-row">
        <div className="settings-label-group">
          <span className="settings-label">恢复默认</span>
          <span className="settings-desc">重置所有无障碍设置为默认值</span>
        </div>
        <button className="toolbar-btn" onClick={handleReset}>
          <RotateCcw size={12} />
          恢复默认
        </button>
      </div>
    </section>
  )
}
