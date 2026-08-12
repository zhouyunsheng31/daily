import { useOnboardingStore } from '../../stores/useOnboardingStore'
import { LogoCircle, OnboardingIcon } from '../Onboarding'

// ============================================================================
// Phase 13.1.4 Step 6：完成页（庆祝页 + "开始使用"按钮）
// ============================================================================
export default function CompleteStep() {
  const complete = useOnboardingStore(s => s.complete)

  return (
    <div style={{
      width: '100%', height: '100%', background: 'var(--bg-canvas)',
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      gap: 20, padding: 40, position: 'relative',
    }}>
      <LogoCircle size={80} fontSize={30} />
      <div style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', gap: 8 }}>
        <h1 style={{
          fontSize: 24, fontWeight: 700, color: 'var(--text-primary)', letterSpacing: '-0.5px',
          margin: 0,
        }}>
          配置完成
        </h1>
        <p style={{
          fontSize: 13, color: 'var(--text-secondary)', fontWeight: 400, margin: 0,
        }}>
          你已准备好开始使用 Daily
        </p>
      </div>

      {/* 功能亮点列表 */}
      <div style={{
        display: 'flex', flexDirection: 'column', gap: 8,
        background: 'var(--bg-surface)', borderRadius: 12, padding: 16,
        boxShadow: 'var(--shadow-sm)', maxWidth: 380,
      }}>
        {[
          { icon: 'panelLeftOpen' as const, label: '可定制画布面板' },
          { icon: 'bot' as const, label: 'AI 助手随时协助' },
          { icon: 'layout' as const, label: '丰富的组件生态' },
          { icon: 'cloud' as const, label: '云端同步与本地存储' },
        ].map((item, i) => (
          <div key={i} style={{
            display: 'flex', alignItems: 'center', gap: 10,
            padding: '6px 0',
          }}>
            <div style={{
              width: 24, height: 24, borderRadius: '50%',
              background: 'var(--color-primary-muted)', color: 'var(--color-primary)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <OnboardingIcon name={item.icon} size={12} color="var(--color-primary)" />
            </div>
            <span style={{ fontSize: 12, color: 'var(--text-primary)' }}>{item.label}</span>
          </div>
        ))}
      </div>

      {/* 开始使用按钮 */}
      <button
        onClick={() => void complete()}
        style={{
          padding: '12px 32px', borderRadius: 9999,
          border: 'none', cursor: 'pointer',
          background: 'var(--color-primary)', color: '#FFFFFF',
          fontSize: 14, fontWeight: 500, fontFamily: 'inherit',
          boxShadow: '0 4px 12px var(--color-primary-muted)',
          display: 'inline-flex', alignItems: 'center', gap: 8,
          transition: 'all 0.18s',
        }}
      >
        <OnboardingIcon name="check" size={14} color="#FFFFFF" />
        开始使用
      </button>

      {/* 装饰性背景色块 */}
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0, height: 120,
        background: 'radial-gradient(ellipse at top, var(--color-primary-muted), transparent 70%)',
        pointerEvents: 'none',
      }} />
    </div>
  )
}
