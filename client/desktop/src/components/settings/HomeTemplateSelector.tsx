/**
 * HomeTemplateSelector 组件（Phase 7 批次6 任务5）
 *
 * 主页模板选择器：3 个模板卡片（极简/标准/丰富）
 * - 每个卡片有 CSS 绘制的简化预览图（不用真实截图）
 * - 选中状态高亮
 * - 点击切换 store 中的 homeTemplate
 * - 卡片样式：pill 形状、无边框半透明（符合批次1 设计规范）
 *
 * 注意：本组件可在 SettingsPanel 外观 Tab 的"主页定制"子区域使用，
 * 也可在其他位置独立使用（本批次不修改 SettingsPanel.tsx，由批次4 集成）。
 */
import { Check } from 'lucide-react'
import { useAppStore } from '../../stores/useAppStore'
import type { HomeTemplateType } from '../../types'

interface TemplateOption {
  type: HomeTemplateType
  name: string
  description: string
}

const TEMPLATE_OPTIONS: TemplateOption[] = [
  {
    type: 'minimal',
    name: '极简',
    description: '仅 AI 输入框 + 圆形图标',
  },
  {
    type: 'standard',
    name: '标准',
    description: 'AI 输入框 + 圆形图标 + 收藏组件网格',
  },
  {
    type: 'rich',
    name: '丰富',
    description: '标准 + 快捷链接区 + 最近访问面板',
  },
]

/**
 * 模板预览图（纯 CSS 绘制）
 * - minimal：仅顶部圆形 + 输入框
 * - standard：顶部圆形 + 输入框 + 2x2 网格
 * - rich：顶部圆形 + 输入框 + 2x2 网格 + 两行额外区块
 */
function TemplatePreview({ type }: { type: HomeTemplateType }) {
  return (
    <div
      style={{
        width: '100%',
        aspectRatio: '16/10',
        borderRadius: 8,
        background: 'var(--bg-canvas)',
        padding: 8,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 4,
        overflow: 'hidden',
      }}
    >
      {/* 圆形图标（所有模板都有） */}
      <div
        style={{
          width: 12,
          height: 12,
          borderRadius: '50%',
          background: 'var(--color-primary)',
          opacity: 0.8,
          flexShrink: 0,
        }}
      />
      {/* AI 输入框（pill 形状，所有模板都有） */}
      <div
        style={{
          width: '70%',
          height: 5,
          borderRadius: 3,
          background: 'var(--bg-surface)',
          border: '1px solid var(--border-subtle)',
          flexShrink: 0,
        }}
      />

      {/* standard/rich：收藏组件网格（2x2） */}
      {type !== 'minimal' && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(2, 1fr)',
            gap: 3,
            width: '70%',
            marginTop: 2,
          }}
        >
          {[0, 1, 2, 3].map(i => (
            <div
              key={i}
              style={{
                height: 8,
                borderRadius: 2,
                background: 'var(--bg-elevated)',
              }}
            />
          ))}
        </div>
      )}

      {/* rich：额外两行（快捷链接 + 最近访问） */}
      {type === 'rich' && (
        <>
          {/* 快捷链接行 */}
          <div
            style={{
              display: 'flex',
              gap: 3,
              width: '70%',
              marginTop: 2,
            }}
          >
            {[0, 1, 2, 3].map(i => (
              <div
                key={i}
                style={{
                  flex: 1,
                  height: 4,
                  borderRadius: 2,
                  background: 'var(--color-primary-muted)',
                  opacity: 0.6,
                }}
              />
            ))}
          </div>
          {/* 最近访问行 */}
          <div
            style={{
              display: 'flex',
              gap: 3,
              width: '70%',
            }}
          >
            {[0, 1].map(i => (
              <div
                key={i}
                style={{
                  flex: 1,
                  height: 4,
                  borderRadius: 2,
                  background: 'var(--bg-elevated)',
                  opacity: 0.7,
                }}
              />
            ))}
          </div>
        </>
      )}
    </div>
  )
}

export default function HomeTemplateSelector() {
  const homeTemplate = useAppStore(s => s.homeTemplate)
  const setHomeTemplate = useAppStore(s => s.setHomeTemplate)

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(3, 1fr)',
        gap: 8,
        marginTop: 8,
      }}
    >
      {TEMPLATE_OPTIONS.map(option => {
        const isActive = homeTemplate === option.type
        return (
          <button
            key={option.type}
            onClick={() => setHomeTemplate(option.type)}
            title={option.description}
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 6,
              padding: 8,
              borderRadius: 16, // pill 形状（圆角较大）
              border: 'none', // 无边框（批次1 规范）
              background: isActive
                ? 'rgba(59, 130, 246, 0.08)' // 选中态：主题色半透明
                : 'rgba(128, 128, 128, 0.04)', // 未选中：中性半透明
              cursor: 'pointer',
              position: 'relative',
              transition: 'background 0.2s',
              textAlign: 'left',
            }}
            onMouseEnter={e => {
              if (!isActive) {
                e.currentTarget.style.background = 'rgba(128, 128, 128, 0.08)'
              }
            }}
            onMouseLeave={e => {
              if (!isActive) {
                e.currentTarget.style.background = 'rgba(128, 128, 128, 0.04)'
              }
            }}
          >
            {/* 选中标记（右上角） */}
            {isActive && (
              <div
                style={{
                  position: 'absolute',
                  top: 6,
                  right: 6,
                  width: 16,
                  height: 16,
                  borderRadius: '50%',
                  background: 'var(--color-primary)',
                  color: '#fff',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Check size={10} />
              </div>
            )}

            <TemplatePreview type={option.type} />

            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span
                style={{
                  fontSize: 12,
                  fontWeight: isActive ? 600 : 500,
                  color: isActive ? 'var(--color-primary)' : 'var(--text-primary)',
                }}
              >
                {option.name}
              </span>
              <span
                style={{
                  fontSize: 10,
                  color: 'var(--text-tertiary)',
                  lineHeight: 1.3,
                }}
              >
                {option.description}
              </span>
            </div>
          </button>
        )
      })}
    </div>
  )
}
