import { LogoCircle } from '../Onboarding'

// ============================================================================
// Phase 13.1.4 Step 1：欢迎页（全宽居中布局）
// ----------------------------------------------------------------------------
// 反 AI slop：无紫渐变，用色块差和柔和阴影；CSS 变量驱动暗色主题
// ============================================================================
export default function WelcomeStep() {
  return (
    <div style={{
      width: '100%', height: '100%', background: 'var(--bg-canvas)',
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      gap: 20, padding: 40, position: 'relative',
    }}>
      <LogoCircle size={80} fontSize={30} />
      <div style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', gap: 8 }}>
        <h1 style={{
          fontSize: 30, fontWeight: 700, color: 'var(--text-primary)',
          letterSpacing: '-0.5px', margin: 0,
        }}>
          Daily
        </h1>
        <p style={{
          fontSize: 15, color: 'var(--text-secondary)', fontWeight: 400, margin: 0,
        }}>
          你的可定制 AI 学习工作台
        </p>
      </div>
      {/* 装饰性背景色块（反 AI slop：不用紫渐变，用色块差） */}
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0, height: 120,
        background: 'radial-gradient(ellipse at top, var(--color-primary-muted), transparent 70%)',
        pointerEvents: 'none',
      }} />
      <div style={{
        position: 'absolute', bottom: 0, left: 0, right: 0, height: 120,
        background: 'radial-gradient(ellipse at bottom, var(--color-primary-muted), transparent 70%)',
        pointerEvents: 'none',
      }} />
    </div>
  )
}
