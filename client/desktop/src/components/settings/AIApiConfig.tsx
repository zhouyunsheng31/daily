import { useState, useEffect, useCallback } from 'react'
import { api, ApiError } from '../../api/client'
import { Loader2, CheckCircle2, XCircle, Zap } from 'lucide-react'
import { inferProviderFromEndpoint, suppressNextServerSync } from '../../stores/useApiConfigStore'

// ============================================================================
// Phase 4: AI API 配置 UI（spec 3.2 节）
// - 模型选择：<provider>/<model> 文本输入（如 stepfun/step-3.7-flash）
// - API Key：密码输入框（经服务器 API 保存，客户端不持有）
// - Endpoint：自定义 API endpoint（可选）
// - 连接测试：按钮，调用 POST /api/ai/test-connection
// ============================================================================

/** GET /api/ai/settings 返回类型（不含 API Key） */
interface AiSettingsResponse {
  model: string
  endpoint: string | null
  hasApiKey: boolean
}

/** 连接测试状态 */
type TestStatus = 'idle' | 'testing' | 'success' | 'error'

export default function AIApiConfig() {
  // 表单状态
  const [model, setModel] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [endpoint, setEndpoint] = useState('')
  const [hasApiKey, setHasApiKey] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState(false)
  const [testStatus, setTestStatus] = useState<TestStatus>('idle')
  const [testMessage, setTestMessage] = useState('')

  // 加载现有设置
  const loadSettings = useCallback(async () => {
    setLoading(true)
    try {
      const data = await api.get<AiSettingsResponse>('/ai/settings')
      setModel(data.model || '')
      setEndpoint(data.endpoint || '')
      setHasApiKey(!!data.hasApiKey)
      // API Key 不回填（客户端不持有，spec 3.2 节）
      setApiKey('')
    } catch (err) {
      console.error('[AIApiConfig] 加载 AI 设置失败:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadSettings()
  }, [loadSettings])

  // 保存设置
  const handleSave = async () => {
    setSaving(true)
    try {
      const body: Record<string, string> = {}
      if (model !== '') body.model = model
      // API Key 仅在用户输入了新值时才提交（避免覆盖为空）
      if (apiKey !== '') body.apiKey = apiKey
      if (endpoint !== '') body.endpoint = endpoint
      await api.put('/ai/settings', body)

      // Phase 13.2.3 B1：API Key 正向同步（client → server）
      // 用户输入了新 apiKey 时，除了 PUT /ai/settings 同步到服务器，
      // 还需调 window.aiKeyApi.setApiKey 同步到本地 safeStorage
      // （LocalAgentService 读本地 ai-keys.json，否则两者不互通）。
      if (apiKey !== '' && typeof window !== 'undefined' && window.aiKeyApi) {
        // endpoint 为空时 inferProviderFromEndpoint 返回 'openai'（默认兼容）
        const provider = inferProviderFromEndpoint(endpoint || '')
        // 标记跳过下一次 'api-key:changed' 事件触发的服务器同步
        // （本函数已主动调 api.put，避免重复 PUT）
        suppressNextServerSync()
        try {
          await window.aiKeyApi.setApiKey(provider, apiKey, endpoint, model)
        } catch (err) {
          // 本地存储失败不阻塞保存流程（服务器 PUT 已成功，仅记录日志）
          console.error('[AIApiConfig] setApiKey via aiKeyApi failed:', err)
        }
      }

      // 保存后清空 API Key 输入框（不持有）
      setApiKey('')
      setHasApiKey(true)
      setSavedAt(true)
      setTimeout(() => setSavedAt(false), 2000)
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : String(err)
      alert(`保存失败: ${msg}`)
    } finally {
      setSaving(false)
    }
  }

  // 测试连接
  const handleTestConnection = async () => {
    setTestStatus('testing')
    setTestMessage('')
    try {
      const body: Record<string, string> = {}
      if (model) body.model = model
      if (apiKey) body.apiKey = apiKey
      if (endpoint) body.endpoint = endpoint
      const result = await api.post<{ ok: boolean; message?: string; error?: string }>('/ai/test-connection', body)
      if (result.ok) {
        setTestStatus('success')
        setTestMessage(result.message || '连接测试通过')
      } else {
        setTestStatus('error')
        setTestMessage(result.error || '连接测试失败')
      }
    } catch (err) {
      setTestStatus('error')
      setTestMessage(err instanceof ApiError ? err.message : String(err))
    }
  }

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: 24 }}>
        <Loader2 size={20} className="spin" />
      </div>
    )
  }

  return (
    <section className="settings-section">
      <h3 className="settings-section-title">API 配置</h3>

      {/* 模型选择 */}
      <div className="settings-row">
        <div className="settings-label-group">
          <span className="settings-label">模型</span>
          <span className="settings-desc">格式：provider/model（如 stepfun/step-3.7-flash）</span>
        </div>
        <input
          className="input-field"
          style={{ width: 260 }}
          type="text"
          value={model}
          onChange={(e) => setModel(e.target.value)}
          placeholder="stepfun/step-3.7-flash"
        />
      </div>

      {/* API Key（密码输入框，客户端不持有） */}
      <div className="settings-row">
        <div className="settings-label-group">
          <span className="settings-label">API Key</span>
          <span className="settings-desc">
            {hasApiKey ? '已配置（输入新值可覆盖）' : '输入 API Key（保存到服务器，客户端不持有）'}
          </span>
        </div>
        <input
          className="input-field"
          style={{ width: 260 }}
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder={hasApiKey ? '••••••••（已配置）' : '输入 API Key'}
          autoComplete="off"
        />
      </div>

      {/* Endpoint（可选） */}
      <div className="settings-row">
        <div className="settings-label-group">
          <span className="settings-label">Endpoint</span>
          <span className="settings-desc">自定义 API endpoint（可选，留空使用默认）</span>
        </div>
        <input
          className="input-field"
          style={{ width: 260 }}
          type="text"
          value={endpoint}
          onChange={(e) => setEndpoint(e.target.value)}
          placeholder="https://api.example.com/v1"
        />
      </div>

      {/* 保存按钮 */}
      <div className="settings-row">
        <button className="toolbar-btn primary" onClick={handleSave} disabled={saving}>
          {saving ? '保存中...' : '保存'}
        </button>
        {savedAt && (
          <span style={{ marginLeft: 12, fontSize: 12, color: 'var(--color-secondary)' }}>
            已保存
          </span>
        )}
      </div>

      {/* 连接测试 */}
      <div className="settings-row">
        <div className="settings-label-group">
          <span className="settings-label">连接测试</span>
          <span className="settings-desc">验证 API 配置是否可用</span>
        </div>
        <button
          className="toolbar-btn"
          onClick={handleTestConnection}
          disabled={testStatus === 'testing'}
          style={{ display: 'flex', alignItems: 'center', gap: 6 }}
        >
          {testStatus === 'testing' ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <Zap size={14} />
          )}
          {testStatus === 'testing' ? '测试中...' : '测试连接'}
        </button>
      </div>

      {/* 测试结果 */}
      {testStatus === 'success' && (
        <div style={{
          marginTop: 8,
          padding: 10,
          borderRadius: 8,
          background: 'rgba(80,227,194,0.1)',
          border: '1px solid rgba(80,227,194,0.2)',
          fontSize: 12,
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          color: 'var(--color-secondary)',
        }}>
          <CheckCircle2 size={16} />
          <span>{testMessage}</span>
        </div>
      )}
      {testStatus === 'error' && (
        <div style={{
          marginTop: 8,
          padding: 10,
          borderRadius: 8,
          background: 'rgba(255,59,48,0.1)',
          border: '1px solid rgba(255,59,48,0.2)',
          fontSize: 12,
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          color: 'var(--color-error)',
        }}>
          <XCircle size={16} />
          <span>{testMessage}</span>
        </div>
      )}
    </section>
  )
}
