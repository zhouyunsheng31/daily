// ============================================================================
// Landing.tsx — 平台介绍页（游客可见）
//
// 设计依据：
// - 用户需求："不要把登录页放到开头了，那样的话游客用户无法看到我们这个平台是干什么的"
// - 设计文档 §1.2：Daily = 画布 + AI Agent 的可部署平台
//   - 画布是前端交互页面
//   - AI Agent 是核心能力
//   - 发挥 HTML 所有优势
//
// 路由：/ → Landing（无 AuthGuard，游客可见）
// CTA "开始使用" 跳转 /app（AuthGuard 保护，未登录会触发 LoginPopup）
// ============================================================================

import { type CSSProperties } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Sparkles,
  LayoutDashboard,
  Bot,
  Code2,
  Rocket,
  ArrowRight,
  MousePointer2,
  Zap,
} from 'lucide-react'

export default function Landing() {
  const navigate = useNavigate()

  const handleStart = () => navigate('/app')

  return (
    <div style={pageStyle}>
      {/* 装饰性背景光晕 */}
      <div style={glowOrb1} />
      <div style={glowOrb2} />
      <div style={gridPatternStyle} />

      {/* Hero 区 */}
      <section style={heroStyle}>
        <div style={badgeStyle}>
          <Sparkles size={14} />
          <span>可部署的画布 + AI Agent 平台</span>
        </div>
        <h1 style={titleStyle}>
          DAILY
        </h1>
        <p style={subtitleStyle}>
          一块无限画布，承载 HTML 的所有可能。<br />
          AI Agent 是核心能力，画布是它的舞台。
        </p>
        <div style={ctaRowStyle}>
          <button onClick={handleStart} style={primaryCtaStyle}>
            开始使用
            <ArrowRight size={16} />
          </button>
          <a
            href="#features"
            style={secondaryCtaStyle}
            onClick={(e) => {
              e.preventDefault()
              document.getElementById('features')?.scrollIntoView({ behavior: 'smooth' })
            }}
          >
            了解更多
          </a>
        </div>
      </section>

      {/* 特性区 */}
      <section id="features" style={featuresSectionStyle}>
        <h2 style={sectionTitleStyle}>为什么选择 Daily</h2>
        <div style={featuresGridStyle}>
          <FeatureCard
            icon={<LayoutDashboard size={22} />}
            title="自由画布"
            desc="无限尺寸的画布，自由布局组件、连接关系、绘制灵感。前端交互页面的终极形态。"
            accent="primary"
          />
          <FeatureCard
            icon={<Bot size={22} />}
            title="AI Agent 核心"
            desc="AI 不只是助手，它是画布的原生居民。调用工具、生成组件、连接数据，一切由对话驱动。"
            accent="secondary"
          />
          <FeatureCard
            icon={<Code2 size={22} />}
            title="HTML 全能力"
            desc="发挥 HTML 所有优势：组件、iframe、SVG、Canvas、WebGL。画布上的一切都是真实可交互的网页。"
            accent="accent"
          />
          <FeatureCard
            icon={<Rocket size={22} />}
            title="可部署平台"
            desc="从原型到产品，从个人画布到社区面板。一键部署，让你的画布成为可访问的 Web 应用。"
            accent="primary"
          />
        </div>
      </section>

      {/* 工作流区 */}
      <section style={workflowSectionStyle}>
        <h2 style={sectionTitleStyle}>三步上手</h2>
        <div style={workflowGridStyle}>
          <WorkflowStep
            step="01"
            icon={<MousePointer2 size={20} />}
            title="打开画布"
            desc="登录后即进入你的个人画布，空白无限。"
          />
          <WorkflowStep
            step="02"
            icon={<Zap size={20} />}
            title="召唤 AI"
            desc="点击右下角浮球，与 AI Agent 对话，让它为你生成组件。"
          />
          <WorkflowStep
            step="03"
            icon={<Rocket size={20} />}
            title="部署分享"
            desc="画布即应用，部署后获得可分享的 Web 链接。"
          />
        </div>
      </section>

      {/* 最终 CTA */}
      <section style={finalCtaSectionStyle}>
        <div style={finalCtaCardStyle}>
          <h2 style={finalCtaTitleStyle}>准备好开始了吗？</h2>
          <p style={finalCtaDescStyle}>几秒钟创建账号，进入你的专属画布。</p>
          <button onClick={handleStart} style={finalCtaBtnStyle}>
            进入画布
            <ArrowRight size={16} />
          </button>
        </div>
      </section>

      {/* Footer */}
      <footer style={footerStyle}>
        <span>Daily · 画布 + AI Agent 的可部署平台</span>
      </footer>
    </div>
  )
}

// ============================================
// 子组件
// ============================================

function FeatureCard({
  icon,
  title,
  desc,
  accent,
}: {
  icon: React.ReactNode
  title: string
  desc: string
  accent: 'primary' | 'secondary' | 'accent'
}) {
  const accentColor =
    accent === 'primary'
      ? 'var(--color-primary, #4A90E2)'
      : accent === 'secondary'
        ? 'var(--color-secondary, #50E3C2)'
        : 'var(--color-accent, #FF6B6B)'
  const accentBg =
    accent === 'primary'
      ? 'var(--color-primary-muted, rgba(74,144,226,0.15))'
      : accent === 'secondary'
        ? 'rgba(80,227,194,0.15)'
        : 'rgba(255,107,107,0.15)'

  return (
    <div style={featureCardStyle}>
      <div style={{ ...featureIconStyle, background: accentBg, color: accentColor }}>
        {icon}
      </div>
      <h3 style={featureTitleStyle}>{title}</h3>
      <p style={featureDescStyle}>{desc}</p>
    </div>
  )
}

function WorkflowStep({
  step,
  icon,
  title,
  desc,
}: {
  step: string
  icon: React.ReactNode
  title: string
  desc: string
}) {
  return (
    <div style={workflowStepStyle}>
      <div style={stepBadgeStyle}>{step}</div>
      <div style={stepIconStyle}>{icon}</div>
      <h3 style={stepTitleStyle}>{title}</h3>
      <p style={stepDescStyle}>{desc}</p>
    </div>
  )
}

// ============================================
// Styles
// ============================================

const pageStyle: CSSProperties = {
  minHeight: '100vh',
  width: '100%',
  background: 'linear-gradient(135deg, #f5f5f7 0%, #e8e8f0 50%, #e5e5ea 100%)',
  position: 'relative',
  overflow: 'hidden auto',
  boxSizing: 'border-box',
  padding: '80px 24px 40px',
}

const glowOrb1: CSSProperties = {
  position: 'absolute',
  width: 500,
  height: 500,
  borderRadius: '50%',
  background: 'radial-gradient(circle, rgba(74,144,226,0.18) 0%, transparent 70%)',
  top: '-150px',
  right: '-150px',
  pointerEvents: 'none',
  zIndex: 0,
}

const glowOrb2: CSSProperties = {
  position: 'absolute',
  width: 400,
  height: 400,
  borderRadius: '50%',
  background: 'radial-gradient(circle, rgba(80,227,194,0.15) 0%, transparent 70%)',
  bottom: '-100px',
  left: '-100px',
  pointerEvents: 'none',
  zIndex: 0,
}

const gridPatternStyle: CSSProperties = {
  position: 'absolute',
  inset: 0,
  backgroundImage:
    'linear-gradient(rgba(0,0,0,0.025) 1px, transparent 1px), linear-gradient(90deg, rgba(0,0,0,0.025) 1px, transparent 1px)',
  backgroundSize: '32px 32px',
  pointerEvents: 'none',
  zIndex: 0,
  maskImage: 'radial-gradient(ellipse at center, black 30%, transparent 80%)',
  WebkitMaskImage: 'radial-gradient(ellipse at center, black 30%, transparent 80%)',
}

const heroStyle: CSSProperties = {
  position: 'relative',
  zIndex: 1,
  maxWidth: 880,
  margin: '0 auto',
  textAlign: 'center',
  paddingTop: 48,
  paddingBottom: 80,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 20,
}

const badgeStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  padding: '6px 14px',
  borderRadius: 'var(--radius-full, 9999px)',
  background: 'var(--color-primary-muted, rgba(74,144,226,0.15))',
  color: 'var(--color-primary-dark, #3A7BC2)',
  fontSize: 12,
  fontWeight: 600,
  letterSpacing: '0.02em',
}

const titleStyle: CSSProperties = {
  fontSize: 'clamp(56px, 12vw, 120px)',
  fontWeight: 800,
  letterSpacing: '0.08em',
  margin: 0,
  lineHeight: 1,
  background: 'linear-gradient(135deg, var(--color-primary, #4A90E2) 0%, var(--color-secondary, #50E3C2) 100%)',
  WebkitBackgroundClip: 'text',
  WebkitTextFillColor: 'transparent',
  backgroundClip: 'text',
}

const subtitleStyle: CSSProperties = {
  fontSize: 'clamp(16px, 2.4vw, 20px)',
  color: 'var(--text-secondary, #86868b)',
  margin: 0,
  lineHeight: 1.6,
  maxWidth: 620,
}

const ctaRowStyle: CSSProperties = {
  display: 'flex',
  gap: 12,
  flexWrap: 'wrap',
  justifyContent: 'center',
  marginTop: 8,
}

const primaryCtaStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 8,
  padding: '14px 28px',
  borderRadius: 'var(--radius-full, 9999px)',
  border: 'none',
  background: 'linear-gradient(135deg, var(--color-primary, #4A90E2), var(--color-primary-dark, #3A7BC2))',
  color: '#fff',
  fontSize: 15,
  fontWeight: 600,
  cursor: 'pointer',
  boxShadow: '0 8px 24px rgba(74,144,226,0.35)',
  transition: 'transform 0.15s ease, box-shadow 0.15s ease',
}

const secondaryCtaStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  padding: '14px 24px',
  borderRadius: 'var(--radius-full, 9999px)',
  border: '1px solid var(--border-default, rgba(0,0,0,0.12))',
  background: 'rgba(255,255,255,0.6)',
  backdropFilter: 'blur(12px)',
  WebkitBackdropFilter: 'blur(12px)',
  color: 'var(--text-primary, #1d1d1f)',
  fontSize: 15,
  fontWeight: 500,
  cursor: 'pointer',
  textDecoration: 'none',
  transition: 'border-color 0.15s ease, background 0.15s ease',
}

const featuresSectionStyle: CSSProperties = {
  position: 'relative',
  zIndex: 1,
  maxWidth: 1120,
  margin: '0 auto',
  padding: '40px 0 80px',
}

const sectionTitleStyle: CSSProperties = {
  fontSize: 'clamp(28px, 4vw, 40px)',
  fontWeight: 700,
  color: 'var(--text-primary, #1d1d1f)',
  margin: '0 0 32px',
  textAlign: 'center',
  letterSpacing: '-0.02em',
}

const featuresGridStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
  gap: 20,
}

const featureCardStyle: CSSProperties = {
  padding: 28,
  borderRadius: 'var(--radius-lg, 16px)',
  background: 'rgba(255, 255, 255, 0.72)',
  backdropFilter: 'blur(20px) saturate(180%)',
  WebkitBackdropFilter: 'blur(20px) saturate(180%)',
  border: '1px solid rgba(255, 255, 255, 0.4)',
  boxShadow: '0 4px 16px rgba(0,0,0,0.04)',
  transition: 'transform 0.2s ease, box-shadow 0.2s ease',
}

const featureIconStyle: CSSProperties = {
  width: 48,
  height: 48,
  borderRadius: 'var(--radius-md, 12px)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  marginBottom: 16,
}

const featureTitleStyle: CSSProperties = {
  fontSize: 18,
  fontWeight: 700,
  color: 'var(--text-primary, #1d1d1f)',
  margin: '0 0 8px',
}

const featureDescStyle: CSSProperties = {
  fontSize: 14,
  color: 'var(--text-secondary, #86868b)',
  lineHeight: 1.6,
  margin: 0,
}

const workflowSectionStyle: CSSProperties = {
  position: 'relative',
  zIndex: 1,
  maxWidth: 1120,
  margin: '0 auto',
  padding: '40px 0 80px',
}

const workflowGridStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
  gap: 20,
}

const workflowStepStyle: CSSProperties = {
  padding: 28,
  borderRadius: 'var(--radius-lg, 16px)',
  background: 'rgba(255, 255, 255, 0.6)',
  backdropFilter: 'blur(16px)',
  WebkitBackdropFilter: 'blur(16px)',
  border: '1px solid rgba(255, 255, 255, 0.3)',
  position: 'relative',
}

const stepBadgeStyle: CSSProperties = {
  position: 'absolute',
  top: 16,
  right: 16,
  fontSize: 28,
  fontWeight: 800,
  color: 'var(--color-primary-muted, rgba(74,144,226,0.2))',
  background: 'linear-gradient(135deg, var(--color-primary, #4A90E2), var(--color-secondary, #50E3C2))',
  WebkitBackgroundClip: 'text',
  WebkitTextFillColor: 'transparent',
  backgroundClip: 'text',
  letterSpacing: '-0.02em',
}

const stepIconStyle: CSSProperties = {
  width: 44,
  height: 44,
  borderRadius: 'var(--radius-md, 12px)',
  background: 'var(--color-primary-muted, rgba(74,144,226,0.15))',
  color: 'var(--color-primary, #4A90E2)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  marginBottom: 16,
}

const stepTitleStyle: CSSProperties = {
  fontSize: 17,
  fontWeight: 700,
  color: 'var(--text-primary, #1d1d1f)',
  margin: '0 0 6px',
}

const stepDescStyle: CSSProperties = {
  fontSize: 13,
  color: 'var(--text-secondary, #86868b)',
  lineHeight: 1.6,
  margin: 0,
}

const finalCtaSectionStyle: CSSProperties = {
  position: 'relative',
  zIndex: 1,
  maxWidth: 880,
  margin: '0 auto',
  padding: '40px 0 80px',
}

const finalCtaCardStyle: CSSProperties = {
  padding: '48px 32px',
  borderRadius: 'var(--radius-xl, 24px)',
  background: 'linear-gradient(135deg, var(--color-primary, #4A90E2) 0%, var(--color-primary-dark, #3A7BC2) 100%)',
  color: '#fff',
  textAlign: 'center',
  boxShadow: '0 16px 48px rgba(74,144,226,0.3)',
}

const finalCtaTitleStyle: CSSProperties = {
  fontSize: 'clamp(24px, 3.5vw, 32px)',
  fontWeight: 700,
  margin: '0 0 8px',
  letterSpacing: '-0.02em',
}

const finalCtaDescStyle: CSSProperties = {
  fontSize: 15,
  opacity: 0.9,
  margin: '0 0 24px',
}

const finalCtaBtnStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 8,
  padding: '14px 28px',
  borderRadius: 'var(--radius-full, 9999px)',
  border: 'none',
  background: '#fff',
  color: 'var(--color-primary-dark, #3A7BC2)',
  fontSize: 15,
  fontWeight: 700,
  cursor: 'pointer',
  boxShadow: '0 4px 16px rgba(0,0,0,0.15)',
  transition: 'transform 0.15s ease',
}

const footerStyle: CSSProperties = {
  position: 'relative',
  zIndex: 1,
  textAlign: 'center',
  padding: '24px 0',
  color: 'var(--text-tertiary, #adb5bd)',
  fontSize: 12,
}
