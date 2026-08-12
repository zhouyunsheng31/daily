import { OnboardingIcon } from '../Onboarding'

// ============================================================================
// Phase 13.1.4 Step 3：AI 助手（AIAssistantSidebar 风格预览）
// ============================================================================
export default function AiAssistantStep() {
  const modeOptions = [
    { key: 'cloud' as const, label: '云端', active: true },
    { key: 'hardDrive' as const, label: '本地', active: false },
    { key: 'zap' as const, label: '自动', active: false },
  ]
  return (
    <div style={{
      width: '100%', height: '100%', background: 'var(--bg-surface)',
      display: 'flex', flexDirection: 'column', overflow: 'hidden',
    }}>
      {/* 顶部：Agent 模式切换 */}
      <div style={{
        padding: '10px 12px',
        borderBottom: '1px solid var(--border-subtle)',
        display: 'flex', alignItems: 'center', gap: 8,
      }}>
        <div style={{
          flex: 1, display: 'flex', background: 'var(--bg-canvas)', borderRadius: 8, padding: 3, gap: 2,
        }}>
          {modeOptions.map(opt => (
            <button key={opt.key} style={{
              flex: 1, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 4,
              padding: '6px 8px', borderRadius: 6, border: 'none', cursor: 'pointer',
              fontSize: 11, fontWeight: 500, fontFamily: 'inherit',
              background: opt.active ? 'var(--bg-surface)' : 'transparent',
              color: 'var(--text-primary)',
              boxShadow: opt.active ? 'var(--shadow-sm)' : 'none',
            }}>
              <OnboardingIcon name={opt.key} size={10} color="var(--text-secondary)" />
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* 对话流 */}
      <div style={{
        flex: 1, overflowY: 'auto', padding: '12px 14px',
        display: 'flex', flexDirection: 'column', gap: 10,
      }}>
        {/* 用户消息 */}
        <div style={{
          alignSelf: 'flex-end', maxWidth: '80%', padding: '8px 12px',
          background: 'var(--color-primary)', color: '#fff', borderRadius: 12, borderBottomRightRadius: 4,
          fontSize: 12,
        }}>
          帮我创建一个学习面板，包含笔记和待办
        </div>
        {/* AI 思考折叠 */}
        <div style={{
          alignSelf: 'flex-start', maxWidth: '85%', padding: '8px 12px',
          background: 'var(--bg-canvas)', borderRadius: 12, borderBottomLeftRadius: 4,
          fontSize: 12, color: 'var(--text-secondary)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
            <OnboardingIcon name="brain" size={11} color="var(--color-primary)" />
            <span style={{ fontWeight: 500, color: 'var(--text-primary)' }}>思考中</span>
            <span style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>· 中等</span>
          </div>
          <div style={{
            padding: '4px 6px', background: 'var(--bg-hover)', borderRadius: 4,
            fontSize: 10, color: 'var(--text-tertiary)',
          }}>
            用户想要创建学习面板，需要包含笔记和待办组件。我需要先创建面板...
          </div>
        </div>
        {/* 权限请求卡片 */}
        <div style={{
          alignSelf: 'flex-start', maxWidth: '90%', padding: 10,
          background: 'rgba(239,68,68,0.06)', borderRadius: 10,
          border: '1px solid rgba(239,68,68,0.18)',
          display: 'flex', flexDirection: 'column', gap: 6,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <OnboardingIcon name="shield" size={11} color="rgb(239,68,68)" />
            <span style={{ fontSize: 11, fontWeight: 600, color: 'rgb(239,68,68)' }}>权限请求</span>
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>AI 想要创建新面板，是否允许？</div>
          <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
            <button style={{
              padding: '3px 10px', background: 'transparent', border: 'none',
              borderRadius: 9999, fontSize: 10, cursor: 'pointer', fontFamily: 'inherit',
              color: 'var(--text-secondary)',
            }}>拒绝</button>
            <button style={{
              padding: '3px 10px', background: 'var(--color-primary)', color: '#fff',
              border: 'none', borderRadius: 9999, fontSize: 10, cursor: 'pointer', fontFamily: 'inherit',
            }}>允许</button>
          </div>
        </div>
      </div>

      {/* 底部：思考等级滑块 + 模型 */}
      <div style={{
        padding: '8px 12px',
        borderTop: '1px solid var(--border-subtle)',
        display: 'flex', alignItems: 'center', gap: 8,
      }}>
        <button style={{
          display: 'inline-flex', alignItems: 'center', gap: 4, padding: '4px 10px',
          background: 'transparent', border: 'none', cursor: 'pointer', fontFamily: 'inherit',
          fontSize: 10, color: 'var(--text-secondary)',
        }}>
          <OnboardingIcon name="settings" size={10} color="var(--text-secondary)" /> API配置
        </button>
        <div style={{ flex: 1, minWidth: 80, display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 4 }}>
            <OnboardingIcon name="brain" size={10} color="var(--text-secondary)" />
            <span style={{ fontSize: 10, color: 'var(--text-secondary)' }}>思考等级</span>
          </div>
          <div style={{
            position: 'relative', height: 4, background: 'var(--bg-hover)',
            borderRadius: 9999,
          }}>
            <div style={{
              position: 'absolute', height: '100%', width: '50%',
              background: 'var(--color-primary)', borderRadius: 9999,
            }} />
            <div style={{
              position: 'absolute', top: '50%', left: '50%', width: 14, height: 14,
              background: 'var(--bg-surface)', border: '2px solid var(--color-primary)',
              borderRadius: '50%', transform: 'translate(-50%, -50%)',
              boxShadow: '0 1px 4px var(--color-primary-muted)',
            }} />
          </div>
        </div>
        <button style={{
          display: 'inline-flex', alignItems: 'center', gap: 4, padding: '4px 10px',
          background: 'transparent', border: 'none', cursor: 'pointer', fontFamily: 'inherit',
          fontSize: 10, color: 'var(--text-secondary)',
        }}>
          deepseek-v4 <OnboardingIcon name="chevronDown" size={10} color="var(--text-secondary)" />
        </button>
      </div>
    </div>
  )
}
