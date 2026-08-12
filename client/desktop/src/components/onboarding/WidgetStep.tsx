import { OnboardingIcon } from '../Onboarding'

// ============================================================================
// Phase 13.1.4 Step 4：Widget 生态（FAB + widget 网格 + 环境标签）
// ============================================================================
export default function WidgetStep() {
  const widgets = [
    { name: 'AI 助手', color: '#DBEAFE', accent: '#2563EB', env: 'desktop' as const, icon: 'bot' as const },
    { name: '笔记', color: '#FEF3C7', accent: '#D97706', env: 'frontend' as const, icon: 'bookmark' as const },
    { name: '计算器', color: '#F3E8FF', accent: '#7C3AED', env: 'frontend' as const, icon: 'layout' as const },
    { name: '番茄钟', color: '#FEE2E2', accent: '#DC2626', env: 'frontend' as const, icon: 'zap' as const },
    { name: '网页', color: '#D1FAE5', accent: '#059669', env: 'desktop' as const, icon: 'cloud' as const },
    { name: 'PDF', color: '#FED7AA', accent: '#EA580C', env: 'desktop' as const, icon: 'panelLeftOpen' as const },
  ]
  return (
    <div style={{
      width: '100%', height: '100%', background: 'var(--bg-canvas)',
      padding: 24, position: 'relative', overflow: 'hidden',
    }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)' }}>组件生态</span>
          <span style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>点击右下角 + 添加</span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
          {widgets.map((w, i) => (
            <div key={i} style={{
              background: 'var(--bg-surface)', borderRadius: 12, padding: 14,
              boxShadow: 'var(--shadow-sm)',
              display: 'flex', flexDirection: 'column', gap: 8, position: 'relative',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{
                  width: 32, height: 32, borderRadius: 8,
                  background: w.color, color: w.accent,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <OnboardingIcon name={w.icon} size={14} color={w.accent} />
                </div>
                {/* 环境标签：纯前端绿色 / 仅桌面端橙色 */}
                <span style={{
                  padding: '2px 6px', borderRadius: 9999, fontSize: 9, fontWeight: 500,
                  background: w.env === 'frontend' ? 'rgba(16,185,129,0.12)' : 'rgba(249,115,22,0.12)',
                  color: w.env === 'frontend' ? 'rgb(16,185,129)' : 'rgb(249,115,22)',
                }}>
                  {w.env === 'frontend' ? '纯前端' : '仅桌面端'}
                </span>
              </div>
              <span style={{ fontSize: 11, fontWeight: 500, color: 'var(--text-primary)' }}>{w.name}</span>
            </div>
          ))}
        </div>
      </div>
      {/* 右下角 FAB + 按钮 */}
      <button style={{
        position: 'absolute', right: 18, bottom: 18,
        width: 44, height: 44, borderRadius: '50%',
        background: 'var(--color-primary)', border: 'none', cursor: 'pointer', padding: 0,
        boxShadow: '0 6px 16px var(--color-primary-muted), 0 2px 6px rgba(0,0,0,0.12)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <OnboardingIcon name="plus" size={20} color="#fff" strokeWidth={2.4} />
      </button>
    </div>
  )
}
