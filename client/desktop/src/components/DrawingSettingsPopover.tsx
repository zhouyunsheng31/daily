import { useState } from 'react'
import { Settings } from 'lucide-react'
import { useAppStore } from '../stores/useAppStore'

const PRESET_COLORS = [
  '#FF6B6B', // 红
  '#FFA94D', // 橙
  '#FFD43B', // 黄
  '#51CF66', // 绿
  '#4DABF7', // 蓝
  '#9775FA', // 紫
  '#F783AC', // 粉
  '#000000', // 黑
]

const FILL_PRESETS = [
  'none',
  '#FF6B6B',
  '#FFD43B',
  '#51CF66',
  '#4DABF7',
  '#9775FA',
  '#FFFFFF',
]

export function DrawingSettingsPopover() {
  const drawingStyle = useAppStore(s => s.drawingStyle)
  const drawingTool = useAppStore(s => s.drawingTool)
  const setDrawingStyle = useAppStore(s => s.setDrawingStyle)
  const [open, setOpen] = useState(false)

  if (drawingTool !== 'rect' && drawingTool !== 'ellipse') {
    // 简单处理：只在 rect/ellipse 模式下显示 fill 字段
  }

  const showFill = drawingTool === 'rect' || drawingTool === 'ellipse'

  return (
    <div className="drawing-settings-popover">
      <button
        type="button"
        className="drawing-settings-popover__toggle"
        onClick={() => setOpen(!open)}
        title="绘图设置"
      >
        <Settings size={14} />
      </button>
      {open && (
        <div className="drawing-settings-popover__panel">
          <div className="drawing-settings-popover__row">
            <span className="drawing-settings-popover__label">颜色</span>
            <div className="drawing-settings-popover__colors">
              {PRESET_COLORS.map(c => (
                <button
                  key={c}
                  type="button"
                  className={`drawing-settings-popover__color ${drawingStyle.color === c ? 'is-active' : ''}`}
                  style={{ backgroundColor: c }}
                  onClick={() => setDrawingStyle({ color: c })}
                  title={c}
                />
              ))}
              <input
                type="color"
                value={drawingStyle.color}
                onChange={(e) => setDrawingStyle({ color: e.target.value })}
                className="drawing-settings-popover__color-picker"
                title="自定义颜色"
              />
            </div>
          </div>
          <div className="drawing-settings-popover__row">
            <span className="drawing-settings-popover__label">粗细</span>
            <input
              type="range"
              min="1"
              max="20"
              step="1"
              value={drawingStyle.width}
              onChange={(e) => setDrawingStyle({ width: Number(e.target.value) })}
            />
            <span className="drawing-settings-popover__value">{drawingStyle.width}px</span>
          </div>
          <div className="drawing-settings-popover__row">
            <span className="drawing-settings-popover__label">透明度</span>
            <input
              type="range"
              min="0.1"
              max="1"
              step="0.05"
              value={drawingStyle.opacity}
              onChange={(e) => setDrawingStyle({ opacity: Number(e.target.value) })}
            />
            <span className="drawing-settings-popover__value">{Math.round(drawingStyle.opacity * 100)}%</span>
          </div>
          {showFill && (
            <div className="drawing-settings-popover__row">
              <span className="drawing-settings-popover__label">填充</span>
              <div className="drawing-settings-popover__colors">
                {FILL_PRESETS.map(c => (
                  <button
                    key={c}
                    type="button"
                    className={`drawing-settings-popover__color ${(drawingStyle.fill ?? 'none') === c ? 'is-active' : ''}`}
                    style={{
                      backgroundColor: c === 'none' ? 'transparent' : c,
                      backgroundImage: c === 'none' ? 'linear-gradient(45deg, #ccc 25%, transparent 25%, transparent 50%, #ccc 50%, #ccc 75%, transparent 75%)' : 'none',
                      backgroundSize: c === 'none' ? '8px 8px' : 'auto',
                    }}
                    onClick={() => setDrawingStyle({ fill: c })}
                    title={c}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
