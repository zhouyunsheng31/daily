import { useEffect, type ReactNode } from 'react'
import { useOnboardingStore, ONBOARDING_TOTAL_STEPS } from '../stores/useOnboardingStore'
import WelcomeStep from './onboarding/WelcomeStep'
import CanvasStep from './onboarding/CanvasStep'
import AiAssistantStep from './onboarding/AiAssistantStep'
import WidgetStep from './onboarding/WidgetStep'
import AiConfigStep from './onboarding/AiConfigStep'
import CompleteStep from './onboarding/CompleteStep'

// ============================================================================
// Phase 13.1.4：首次启动 Onboarding 主组件
// ----------------------------------------------------------------------------
// 设计原则（反 AI slop）：
// - 无紫渐变背景，用色块差和柔和阴影
// - 无 emoji 图标，全内联 SVG
// - 无圆角卡片+左border，用大圆角色块
// - CSS 变量驱动，自动适配暗色主题
// ============================================================================

const STEP_META = [
  { id: 1, label: '欢迎' },
  { id: 2, label: '面板与画布' },
  { id: 3, label: 'AI 助手' },
  { id: 4, label: '组件生态' },
  { id: 5, label: 'AI 配置' },
  { id: 6, label: '完成' },
]

// SVG Icon 集（反 AI slop：无 emoji，全内联 SVG）
type IconName =
  | 'arrowRight' | 'arrowLeft' | 'check' | 'plus' | 'cloud' | 'hardDrive'
  | 'zap' | 'bot' | 'brain' | 'settings' | 'panelLeftOpen' | 'layout'
  | 'bookmark' | 'send' | 'loader' | 'chevronDown' | 'sparkles' | 'shield'

const ICON_PATHS: Record<IconName, ReactNode> = {
  arrowRight: <polyline points="9 18 15 12 9 6" />,
  arrowLeft: <polyline points="15 18 9 12 15 6" />,
  check: <polyline points="20 6 9 17 4 12" />,
  plus: <><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></>,
  cloud: <path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z" />,
  hardDrive: <><line x1="22" y1="12" x2="2" y2="12" /><path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" /><line x1="6" y1="16" x2="6.01" y2="16" /><line x1="10" y1="16" x2="10.01" y2="16" /></>,
  zap: <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />,
  bot: <><rect x="3" y="11" width="18" height="10" rx="2" /><circle cx="12" cy="5" r="2" /><path d="M12 7v4" /><line x1="8" y1="16" x2="8" y2="16" /><line x1="16" y1="16" x2="16" y2="16" /></>,
  brain: <><path d="M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-4.96.44 2.5 2.5 0 0 1-2.96-3.08 3 3 0 0 1-.34-5.58 2.5 2.5 0 0 1 1.32-4.24 2.5 2.5 0 0 1 1.98-3A2.5 2.5 0 0 1 9.5 2Z" /><path d="M14.5 2A2.5 2.5 0 0 0 12 4.5v15a2.5 2.5 0 0 0 4.96.44 2.5 2.5 0 0 0 2.96-3.08 3 3 0 0 0 .34-5.58 2.5 2.5 0 0 0-1.32-4.24 2.5 2.5 0 0 0-1.98-3A2.5 2.5 0 0 0 14.5 2Z" /></>,
  settings: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" /></>,
  panelLeftOpen: <><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M9 3v18" /></>,
  layout: <><rect x="3" y="3" width="18" height="18" rx="2" /><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M3 9h18M9 21V9" /></>,
  bookmark: <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />,
  send: <><line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" /></>,
  loader: <><line x1="12" y1="2" x2="12" y2="6" /><line x1="12" y1="18" x2="12" y2="22" /><line x1="4.93" y1="4.93" x2="7.76" y2="7.76" /><line x1="16.24" y1="16.24" x2="19.07" y2="19.07" /><line x1="2" y1="12" x2="6" y2="12" /><line x1="18" y1="12" x2="22" y2="12" /><line x1="4.93" y1="19.07" x2="7.76" y2="16.24" /><line x1="16.24" y1="7.76" x2="19.07" y2="4.93" /></>,
  chevronDown: <polyline points="6 9 12 15 18 9" />,
  sparkles: <path d="M12 3l1.9 5.8a2 2 0 0 0 1.3 1.3L21 12l-5.8 1.9a2 2 0 0 0-1.3 1.3L12 21l-1.9-5.8a2 2 0 0 0-1.3-1.3L3 12l5.8-1.9a2 2 0 0 0 1.3-1.3L12 3z" />,
  shield: <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />,
}

export function OnboardingIcon({ name, size = 14, color = 'currentColor', strokeWidth = 1.8 }: {
  name: IconName
  size?: number
  color?: string
  strokeWidth?: number
}) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round"
      style={{ flexShrink: 0 }}>
      {ICON_PATHS[name]}
    </svg>
  )
}

// Logo 圆形（蓝色渐变 + LD 白字）
export function LogoCircle({ size = 80, fontSize = 30 }: { size?: number; fontSize?: number }) {
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%',
      background: 'linear-gradient(135deg, var(--color-primary), var(--color-primary-dark))',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      color: '#FFFFFF', fontWeight: 700, fontSize, letterSpacing: '-1px',
      boxShadow: '0 8px 24px var(--color-primary-muted), 0 2px 6px rgba(0,0,0,0.08)',
    }}>LD</div>
  )
}

// MacosWindow 设备框（与原型一致）
export function MacosWindow({ title = 'Daily', width = 720, height = 480, children }: {
  title?: string
  width?: number
  height?: number
  children: ReactNode
}) {
  return (
    <div style={{
      display: 'inline-block',
      background: 'var(--bg-surface)',
      borderRadius: 10,
      overflow: 'hidden',
      boxShadow: '0 30px 80px rgba(0,0,0,0.18), 0 0 0 0.5px var(--border-subtle)',
    }}>
      <div style={{
        height: 38,
        background: 'linear-gradient(to bottom, var(--bg-elevated), var(--bg-hover))',
        display: 'flex', alignItems: 'center', padding: '0 14px',
        position: 'relative', userSelect: 'none',
      }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <div style={{ width: 12, height: 12, borderRadius: '50%', background: '#FF5F57', border: '0.5px solid rgba(0,0,0,0.12)' }} />
          <div style={{ width: 12, height: 12, borderRadius: '50%', background: '#FEBC2E', border: '0.5px solid rgba(0,0,0,0.12)' }} />
          <div style={{ width: 12, height: 12, borderRadius: '50%', background: '#28C840', border: '0.5px solid rgba(0,0,0,0.12)' }} />
        </div>
        <div style={{
          position: 'absolute', left: 0, right: 0, textAlign: 'center',
          fontSize: 13, color: 'var(--text-secondary)', fontWeight: 500, pointerEvents: 'none',
        }}>{title}</div>
      </div>
      <div style={{ background: 'var(--bg-surface)', width, height, overflow: 'hidden' }}>
        {children}
      </div>
    </div>
  )
}

// 步骤指示器（圆点 + 标签，可点击跳转）
function StepIndicator({ current, onSelect }: { current: number; onSelect: (idx: number) => void }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '0 24px' }}>
      {STEP_META.map((s, i) => (
        <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <div
            onClick={() => onSelect(s.id - 1)}
            style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}
          >
            <div style={{
              width: s.id === current + 1 ? 28 : 8,
              height: 8,
              borderRadius: 9999,
              background: s.id === current + 1
                ? 'var(--color-primary)'
                : s.id < current + 1
                  ? 'var(--color-primary)'
                  : 'var(--border-default)',
              opacity: s.id < current + 1 ? 0.5 : 1,
              transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
            }} />
            <span style={{
              fontSize: 11, fontWeight: 500,
              color: s.id === current + 1 ? 'var(--text-primary)' : 'var(--text-tertiary)',
            }}>{s.label}</span>
          </div>
          {i < STEP_META.length - 1 && (
            <div style={{ width: 24, height: 1, background: 'var(--border-subtle)' }} />
          )}
        </div>
      ))}
    </div>
  )
}

// 步骤右侧要点说明
export function StepHighlights({ items }: {
  items: Array<{ title: string; desc: string }>
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, flex: 1, maxWidth: 320 }}>
      {items.map((item, i) => (
        <div key={i} style={{
          display: 'flex', gap: 12, padding: '14px 16px',
          background: 'var(--bg-surface)', borderRadius: 12,
          boxShadow: 'var(--shadow-sm)', alignItems: 'flex-start',
        }}>
          <div style={{
            flexShrink: 0, width: 26, height: 26, borderRadius: '50%',
            background: 'var(--color-primary-muted)', color: 'var(--color-primary)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 12, fontWeight: 600,
          }}>{i + 1}</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{item.title}</div>
            <div style={{ fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.55 }}>{item.desc}</div>
          </div>
        </div>
      ))}
    </div>
  )
}

// 主组件
export default function Onboarding() {
  const step = useOnboardingStore(s => s.step)
  const next = useOnboardingStore(s => s.next)
  const prev = useOnboardingStore(s => s.prev)
  const setStep = useOnboardingStore(s => s.setStep)
  const skip = useOnboardingStore(s => s.skip)

  // ESC 键跳过 onboarding
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        void skip()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [skip])

  const isLastStep = step === ONBOARDING_TOTAL_STEPS - 1
  const isFirstStep = step === 0
  // Step 4 (AiConfig) 不显示底部"下一步"按钮，因为该步骤有内嵌的完成逻辑
  const isAiConfigStep = step === 4

  const renderStep = () => {
    switch (step) {
      case 0: return <WelcomeStep />
      case 1: return <CanvasStep />
      case 2: return <AiAssistantStep />
      case 3: return <WidgetStep />
      case 4: return <AiConfigStep />
      case 5: return <CompleteStep />
      default: return <WelcomeStep />
    }
  }

  return (
    <div style={{
      width: '100vw', height: '100vh',
      background: 'var(--bg-canvas)',
      display: 'flex', flexDirection: 'column',
      position: 'fixed', top: 0, left: 0, zIndex: 9999,
      fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'PingFang SC', 'Microsoft YaHei', sans-serif",
    }}>
      {/* 顶栏：跳过按钮（右上角） */}
      <div style={{
        height: 48, padding: '0 24px',
        display: 'flex', alignItems: 'center', justifyContent: 'flex-end',
      }}>
        {!isLastStep && (
          <button
            onClick={() => void skip()}
            style={{
              padding: '8px 16px', borderRadius: 9999,
              border: 'none', cursor: 'pointer',
              background: 'transparent', color: 'var(--text-secondary)',
              fontSize: 12, fontWeight: 500, fontFamily: 'inherit',
              transition: 'all 0.18s',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-hover)' }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
          >
            跳过
          </button>
        )}
      </div>

      {/* 主内容区：MacosWindow 预览（左） + 要点说明（右） */}
      <div style={{
        flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '0 48px', gap: 48, overflow: 'auto',
      }}>
        <div style={{ flexShrink: 0 }}>
          <MacosWindow width={720} height={480}>
            {renderStep()}
          </MacosWindow>
        </div>
      </div>

      {/* 底栏：步骤指示器 + 上一步/下一步 */}
      <div style={{
        height: 80, padding: '0 48px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 24,
      }}>
        <StepIndicator current={step} onSelect={(idx) => setStep(idx)} />
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          {!isFirstStep && !isLastStep && (
            <button
              onClick={prev}
              style={{
                padding: '12px 24px', borderRadius: 9999,
                border: 'none', cursor: 'pointer',
                background: 'var(--bg-hover)', color: 'var(--text-primary)',
                fontSize: 14, fontWeight: 500, fontFamily: 'inherit',
                display: 'inline-flex', alignItems: 'center', gap: 6,
                transition: 'all 0.18s',
              }}
            >
              <OnboardingIcon name="arrowLeft" size={14} color="var(--text-primary)" />
              上一步
            </button>
          )}
          {!isLastStep && !isAiConfigStep && (
            <button
              onClick={next}
              style={{
                padding: '12px 28px', borderRadius: 9999,
                border: 'none', cursor: 'pointer',
                background: 'var(--color-primary)', color: '#FFFFFF',
                fontSize: 14, fontWeight: 500, fontFamily: 'inherit',
                boxShadow: '0 4px 12px var(--color-primary-muted)',
                display: 'inline-flex', alignItems: 'center', gap: 6,
                transition: 'all 0.18s',
              }}
            >
              {step === 0 ? '开始' : '下一步'}
              <OnboardingIcon name="arrowRight" size={14} color="#FFFFFF" />
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
