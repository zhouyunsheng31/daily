import { LogoCircle, OnboardingIcon } from '../Onboarding'

// ============================================================================
// Phase 13.1.4 Step 2：Panel 与 Canvas（CanvasHome 风格预览）
// ============================================================================
export default function CanvasStep() {
  const widgets = [
    { id: 1, name: '笔记', color: '#FEF3C7', accent: '#D97706', letter: 'N' },
    { id: 2, name: '待办', color: '#DBEAFE', accent: '#2563EB', letter: 'T' },
    { id: 3, name: '计算器', color: '#F3E8FF', accent: '#7C3AED', letter: 'C' },
    { id: 4, name: '番茄钟', color: '#FEE2E2', accent: '#DC2626', letter: 'P' },
  ]
  return (
    <div style={{
      width: '100%', height: '100%', background: 'var(--bg-canvas)',
      padding: 28, display: 'flex', flexDirection: 'column', gap: 18,
      overflow: 'hidden',
    }}>
      {/* 顶部 Logo + 标题 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <LogoCircle size={40} fontSize={16} />
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>Daily</span>
          <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>我的学习工作台</span>
        </div>
      </div>
      {/* AI 对话框 */}
      <div style={{
        background: 'var(--bg-surface)', borderRadius: 16, padding: '14px 16px',
        boxShadow: 'var(--shadow-sm)',
        display: 'flex', alignItems: 'center', gap: 10,
      }}>
        <OnboardingIcon name="sparkles" size={16} color="var(--color-primary)" />
        <span style={{ flex: 1, fontSize: 13, color: 'var(--text-tertiary)' }}>问 AI 帮你创建学习面板...</span>
        <button style={{
          width: 30, height: 30, borderRadius: '50%', border: 'none',
          background: 'var(--color-primary)', color: '#fff', cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0,
        }}>
          <OnboardingIcon name="send" size={12} color="#fff" />
        </button>
      </div>
      {/* 收藏组件网格 */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)' }}>收藏组件</span>
          <span style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>查看全部</span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
          {widgets.map(w => (
            <div key={w.id} style={{
              background: 'var(--bg-surface)', borderRadius: 12, padding: 12,
              boxShadow: 'var(--shadow-sm)',
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
            }}>
              <div style={{
                width: 32, height: 32, borderRadius: 8,
                background: w.color, color: w.accent,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 14, fontWeight: 700,
              }}>{w.letter}</div>
              <span style={{ fontSize: 10, color: 'var(--text-secondary)' }}>{w.name}</span>
            </div>
          ))}
        </div>
      </div>
      {/* 进入画布按钮 */}
      <button style={{
        marginTop: 4, padding: '10px 16px', background: 'transparent',
        color: 'var(--color-primary)', border: 'none', cursor: 'pointer',
        fontSize: 12, fontWeight: 500, borderRadius: 8,
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
        width: 'fit-content', alignSelf: 'center', fontFamily: 'inherit',
      }}>
        进入画布 <OnboardingIcon name="arrowRight" size={12} color="var(--color-primary)" />
      </button>
    </div>
  )
}
