import { useState } from 'react'
import { useOnboardingStore, type AiProviderKey } from '../../stores/useOnboardingStore'
import { OnboardingIcon } from '../Onboarding'
import { api, ApiError } from '../../api/client'

// ============================================================================
// Phase 13.1.4 Step 5：AI 配置（provider + endpoint + model + apiKey + 测试 + 完成）
// ----------------------------------------------------------------------------
// 完成按钮：window.aiKeyApi.setApiKey + setActiveProvider → next() 跳到 CompleteStep
// 连接测试：window.aiKeyApi.setApiKey + POST /ai/test-connection
// ============================================================================

const PROVIDER_PRESETS: Record<AiProviderKey, { label: string; endpoint: string; model: string }> = {
  deepseek: {
    label: 'DeepSeek',
    endpoint: 'https://api.deepseek.com/v1/chat/completions',
    model: 'deepseek-v4-flash',
  },
  openai: {
    label: 'OpenAI',
    endpoint: 'https://api.openai.com/v1/chat/completions',
    model: 'gpt-4o-mini',
  },
  anthropic: {
    label: 'Anthropic Claude',
    endpoint: 'https://api.anthropic.com/v1/messages',
    model: 'claude-3-5-sonnet-20241022',
  },
  google: {
    label: 'Google Gemini',
    endpoint: 'https://generativelanguage.googleapis.com/v1beta/models',
    model: 'gemini-1.5-flash',
  },
}

export default function AiConfigStep() {
  const aiConfig = useOnboardingStore(s => s.aiConfig)
  const setAiConfig = useOnboardingStore(s => s.setAiConfig)
  const testStatus = useOnboardingStore(s => s.testStatus)
  const testMessage = useOnboardingStore(s => s.testMessage)
  const setTestStatus = useOnboardingStore(s => s.setTestStatus)
  const next = useOnboardingStore(s => s.next)
  const [saving, setSaving] = useState(false)

  // 切换 provider 时自动填充 endpoint 和 model
  function handleProviderChange(nextProvider: AiProviderKey) {
    const preset = PROVIDER_PRESETS[nextProvider]
    setAiConfig({
      provider: nextProvider,
      endpoint: preset.endpoint,
      model: preset.model,
    })
    setTestStatus('idle')
  }

  // 连接测试：先 setApiKey 保存到本地 safeStorage，再 POST /ai/test-connection
  async function handleTest() {
    const { provider, endpoint, model, apiKey } = aiConfig
    if (!apiKey.trim()) {
      setTestStatus('error', '请先输入 API Key')
      return
    }
    setTestStatus('testing')
    // 1. 先 setApiKey 保存到本地 safeStorage（window.aiKeyApi）
    if (typeof window !== 'undefined' && window.aiKeyApi) {
      try {
        await window.aiKeyApi.setApiKey(provider, apiKey, endpoint, model)
      } catch (err) {
        setTestStatus('error', `保存 API Key 失败: ${err instanceof Error ? err.message : String(err)}`)
        return
      }
    }
    // 2. POST /ai/test-connection 测试连接
    try {
      const result = await api.post<{ ok: boolean; message?: string; error?: string }>(
        '/ai/test-connection',
        { model, apiKey, endpoint },
      )
      if (result.ok) {
        setTestStatus('success', result.message || '连接测试通过')
      } else {
        setTestStatus('error', result.error || '连接测试失败')
      }
    } catch (err) {
      // 服务器未启动或测试端点不可用时，本地 setApiKey 成功即视为部分通过
      const msg = err instanceof ApiError ? err.message : String(err)
      setTestStatus('error', `连接测试失败: ${msg}`)
    }
  }

  // 完成按钮：setApiKey + setActiveProvider + next()
  async function handleComplete() {
    const { provider, endpoint, model, apiKey } = aiConfig
    setSaving(true)
    try {
      // 调用 window.aiKeyApi.setApiKey + setActiveProvider
      if (typeof window !== 'undefined' && window.aiKeyApi) {
        try {
          await window.aiKeyApi.setApiKey(provider, apiKey, endpoint, model)
          await window.aiKeyApi.setActiveProvider(provider)
        } catch (err) {
          console.error('[AiConfigStep] setApiKey/setActiveProvider failed:', err)
          // 不阻塞流程，用户可在设置中重新配置
        }
      }
      next()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{
      width: '100%', height: '100%', background: 'var(--bg-canvas)',
      padding: 28, display: 'flex', flexDirection: 'column', gap: 14, overflowY: 'auto',
    }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 4 }}>
        <h2 style={{ fontSize: 16, fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>
          配置 AI 助手
        </h2>
        <p style={{ fontSize: 11, color: 'var(--text-secondary)', margin: 0 }}>
          填写 API 信息以启用 AI 功能，可稍后在设置中修改
        </p>
      </div>

      {/* Provider 选择 */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <label style={{ fontSize: 11, fontWeight: 500, color: 'var(--text-secondary)' }}>Provider</label>
        <select
          value={aiConfig.provider}
          onChange={(e) => handleProviderChange(e.target.value as AiProviderKey)}
          style={{
            width: '100%',
            background: 'var(--bg-hover)',
            border: 'none',
            padding: '12px 14px',
            borderRadius: 12,
            fontSize: 13,
            color: 'var(--text-primary)',
            fontFamily: 'inherit',
            outline: 'none',
            cursor: 'pointer',
            appearance: 'none',
            backgroundImage: "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%2386868b' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><polyline points='6 9 12 15 18 9'/></svg>\")",
            backgroundRepeat: 'no-repeat',
            backgroundPosition: 'right 12px center',
            paddingRight: 32,
          }}
        >
          {Object.entries(PROVIDER_PRESETS).map(([key, val]) => (
            <option key={key} value={key}>{val.label}</option>
          ))}
        </select>
      </div>

      {/* Endpoint */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <label style={{ fontSize: 11, fontWeight: 500, color: 'var(--text-secondary)' }}>API Endpoint</label>
        <input
          type="text"
          value={aiConfig.endpoint}
          onChange={(e) => setAiConfig({ endpoint: e.target.value })}
          placeholder="https://api.example.com/v1/chat/completions"
          style={{
            width: '100%',
            background: 'var(--bg-hover)',
            border: 'none',
            padding: '12px 14px',
            borderRadius: 12,
            fontSize: 13,
            color: 'var(--text-primary)',
            fontFamily: 'inherit',
            outline: 'none',
          }}
        />
      </div>

      {/* Model */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <label style={{ fontSize: 11, fontWeight: 500, color: 'var(--text-secondary)' }}>Model</label>
        <input
          type="text"
          value={aiConfig.model}
          onChange={(e) => setAiConfig({ model: e.target.value })}
          placeholder="model-id"
          style={{
            width: '100%',
            background: 'var(--bg-hover)',
            border: 'none',
            padding: '12px 14px',
            borderRadius: 12,
            fontSize: 13,
            color: 'var(--text-primary)',
            fontFamily: 'inherit',
            outline: 'none',
          }}
        />
      </div>

      {/* API Key */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <label style={{ fontSize: 11, fontWeight: 500, color: 'var(--text-secondary)' }}>API Key</label>
        <input
          type="password"
          value={aiConfig.apiKey}
          onChange={(e) => {
            setAiConfig({ apiKey: e.target.value })
            setTestStatus('idle')
          }}
          placeholder="sk-..."
          style={{
            width: '100%',
            background: 'var(--bg-hover)',
            border: 'none',
            padding: '12px 14px',
            borderRadius: 12,
            fontSize: 13,
            color: 'var(--text-primary)',
            fontFamily: 'inherit',
            outline: 'none',
          }}
        />
      </div>

      {/* 测试按钮 + 状态 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <button
          onClick={handleTest}
          disabled={testStatus === 'testing'}
          style={{
            padding: '8px 16px', fontSize: 12, borderRadius: 9999,
            border: 'none', cursor: testStatus === 'testing' ? 'not-allowed' : 'pointer',
            background: 'var(--bg-hover)', color: 'var(--text-primary)',
            fontFamily: 'inherit', fontWeight: 500,
            opacity: testStatus === 'testing' ? 0.6 : 1,
          }}
        >
          {testStatus === 'testing' ? '测试中...' : '连接测试'}
        </button>
        {testStatus === 'success' && (
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: 4,
            fontSize: 11, color: 'var(--color-success)',
          }}>
            <OnboardingIcon name="check" size={12} color="var(--color-success)" /> {testMessage}
          </span>
        )}
        {testStatus === 'error' && (
          <span style={{ fontSize: 11, color: 'var(--color-error)' }}>{testMessage}</span>
        )}
      </div>

      {/* 完成按钮（内嵌在表单底部） */}
      <div style={{
        marginTop: 8, padding: 12,
        background: 'var(--color-primary-muted)', borderRadius: 12,
        display: 'flex', alignItems: 'center', gap: 10,
      }}>
        <OnboardingIcon name="check" size={14} color="var(--color-primary)" />
        <span style={{ flex: 1, fontSize: 11, color: 'var(--text-secondary)' }}>
          配置完成，可以开始使用 Daily
        </span>
        <button
          onClick={handleComplete}
          disabled={saving}
          style={{
            padding: '8px 20px', fontSize: 12, fontWeight: 500, borderRadius: 9999,
            border: 'none', cursor: saving ? 'not-allowed' : 'pointer',
            background: 'var(--color-primary)', color: '#FFFFFF',
            fontFamily: 'inherit',
            boxShadow: '0 4px 12px var(--color-primary-muted)',
            opacity: saving ? 0.6 : 1,
          }}
        >
          {saving ? '保存中...' : '配置完成'}
        </button>
      </div>
    </div>
  )
}
