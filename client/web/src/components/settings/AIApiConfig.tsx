import { useState, useEffect, useCallback } from 'react'
import { api, ApiError } from '../../api/client'
import { Loader2, CheckCircle2, XCircle, Zap } from 'lucide-react'

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

  // S17.3：模型列表 + 手动输入模式
  const [models, setModels] = useState<Array<{ id: string; owned_by?: string }>>([])
  const [loadingModels, setLoadingModels] = useState(false)
  const [modelsError, setModelsError] = useState<string | null>(null)
  const [manualMode, setManualMode] = useState(false)

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

  // S17.3/S17.7：加载可用模型列表（POST /api/ai/models，接受 form apiKey）
  // S17.7 修复：API key 解析对称化，传 form apiKey 避免与 test-connection 不一致
  const loadModels = useCallback(async () => {
    setLoadingModels(true)
    setModelsError(null)
    try {
      const result = await api.post<{
        models: Array<{ id: string; owned_by?: string }>
        cached?: boolean
      }>('/ai/models', { apiKey: apiKey || undefined })
      const list = result.models || []
      setModels(list)
      if (list.length === 0) {
        setModelsError('模型列表为空（可能是订阅失效或配额用尽）')
        setManualMode(true)
      } else {
        setManualMode(false)
      }
    } catch (err) {
      // S17.2 错误体结构：{ error: string, code: string }（error 是字符串）
      // ApiError.data 是整个 JSON body，故 code 在 data.code（非 data.error.code）
      const apiErr = err as ApiError
      const data = apiErr?.data as { error?: string; code?: string } | undefined
      const code = data?.code
      if (code === 'API_KEY_MISSING') {
        setModelsError('未配置 API Key，请先在下方填写 API Key 并保存')
      } else if (code === 'SUBSCRIPTION_EXPIRED') {
        setModelsError('StepFun 订阅已过期，请续订')
      } else if (code === 'QUOTA_EXCEEDED') {
        setModelsError('StepFun 配额已用尽，请充值')
      } else if (code === 'API_KEY_INVALID') {
        setModelsError('API Key 无效，请检查')
      } else {
        setModelsError(`加载模型列表失败：${data?.error || apiErr?.message || '未知错误'}`)
      }
      setManualMode(true) // 加载失败时自动切换到手动输入
    } finally {
      setLoadingModels(false)
    }
  }, [apiKey])

  // S17.7：apiKey 变化时重新加载模型列表（debounce 400ms 避免频繁请求）
  useEffect(() => {
    const timer = setTimeout(() => {
      void loadModels()
    }, 400)
    return () => clearTimeout(timer)
  }, [loadModels])

  // 保存设置
  const handleSave = async () => {
    setSaving(true)
    try {
      const body: Record<string, string> = {}
      if (model !== '') body.model = model
      // API Key 仅在用户输入了新值时才提交（避免覆盖为空）
      if (apiKey !== '') body.apiKey = apiKey
      if (endpoint !== '') body.endpoint = endpoint
      // S13 改造：删除 window.aiKeyApi 调用，Web 端纯走 server API
      // apiKey 由 server 端加密存储
      await api.put('/ai/settings', body)

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
      const result = await api.post<{
        ok: boolean
        message?: string
        error?: string
        errorKind?: string
      }>('/ai/test-connection', body)
      if (result.ok) {
        setTestStatus('success')
        setTestMessage(result.message || '连接测试通过')
        // S17.7-C: 测试成功后自动保存 apiKey（如果 form 里有）
        // 避免出现"测试通过"但"未配置 API Key"的矛盾提示
        if (apiKey) {
          try {
            const saveBody: Record<string, string> = { apiKey }
            if (model) saveBody.model = model
            if (endpoint) saveBody.endpoint = endpoint
            await api.put('/ai/settings', saveBody)
            setApiKey('')
            setHasApiKey(true)
            setSavedAt(true)
            setTimeout(() => setSavedAt(false), 2000)
          } catch (err) {
            console.error('[AIApiConfig] 自动保存失败:', err)
          }
        }
      } else {
        setTestStatus('error')
        // S17.4: 根据 errorKind 显示不同提示
        const kind = result.errorKind
        if (kind === 'SUBSCRIPTION_EXPIRED') {
          setTestMessage('StepFun 订阅已过期，请续订 step plan 订阅')
        } else if (kind === 'QUOTA_EXCEEDED') {
          setTestMessage('StepFun 配额已用尽，请充值')
        } else if (kind === 'API_KEY_MISSING') {
          setTestMessage('未配置 API Key，请先填写')
        } else if (kind === 'API_KEY_INVALID') {
          setTestMessage('API Key 无效，请检查')
        } else if (kind === 'TIMEOUT') {
          setTestMessage('连接超时，请稍后重试')
        } else {
          setTestMessage(result.error || '连接测试失败')
        }
      }
    } catch (err) {
      setTestStatus('error')
      setTestMessage(err instanceof ApiError ? err.message : String(err))
    }
  }

  if (loading) {
    return (
      <div className="settings-centered">
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
          <span className="settings-desc">
            {manualMode || models.length === 0
              ? '格式：model（如 step-3.7-flash），无需 stepfun/ 前缀'
              : '从列表选择，或点击"手动输入"自定义'}
          </span>
        </div>
        <div className="settings-field-stack">
          {manualMode || models.length === 0 ? (
            <div className="settings-inline-group">
              <input
                className="input-field input-field--w260"
                type="text"
                value={model}
                onChange={(e) => setModel(e.target.value)}
                placeholder="step-3.7-flash"
                disabled={saving}
              />
              {models.length > 0 && (
                <button
                  type="button"
                  className="toolbar-btn"
                  onClick={() => setManualMode(false)}
                  disabled={saving}
                >
                  选择模型
                </button>
              )}
            </div>
          ) : (
            <div className="settings-inline-group">
              <select
                className="input-field input-field--w260"
                value={model}
                onChange={(e) => setModel(e.target.value)}
                disabled={saving}
              >
                {model && !models.some((m) => m.id === model) && (
                  <option value={model}>{model}（当前）</option>
                )}
                {models.map((m) => (
                  <option key={m.id} value={m.id}>{m.id}</option>
                ))}
              </select>
              <button
                type="button"
                className="toolbar-btn"
                onClick={() => setManualMode(true)}
                disabled={saving}
              >
                手动输入
              </button>
              <button
                type="button"
                className="toolbar-btn"
                onClick={loadModels}
                disabled={saving || loadingModels}
              >
                {loadingModels ? '加载中...' : '刷新'}
              </button>
            </div>
          )}
          {modelsError && (
            <div className="settings-alert settings-alert--warning">
              {modelsError}
            </div>
          )}
        </div>
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
          className="input-field input-field--w260"
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
          className="input-field input-field--w260"
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
          <span className="settings-saved-hint">
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
        <div className="settings-alert settings-alert--success">
          <CheckCircle2 size={16} />
          <span>{testMessage}</span>
        </div>
      )}
      {testStatus === 'error' && (
        <div className="settings-alert settings-alert--error">
          <XCircle size={16} />
          <span>{testMessage}</span>
        </div>
      )}
    </section>
  )
}
