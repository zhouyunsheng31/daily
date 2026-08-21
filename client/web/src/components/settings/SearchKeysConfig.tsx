import { useState, useEffect, useCallback } from 'react'
import { Eye, EyeOff, RefreshCw, Trash2, FlaskConical, CheckCircle, XCircle, Loader2 } from 'lucide-react'
import { ApiError } from '../../api/client'
import {
  getSearchKey,
  updateSearchKey,
  deleteSearchKey,
  testSearchKey,
  type SearchKeyProvider,
  type SearchKeyStatus,
  type SearchKeyTestResult,
} from '../../api/searchKeys'

// ============================================================================
// Phase 12: AI 搜索引擎 Key 管理 UI（spec 3.15 节）
// - 2 provider 行（metaso / github）（Phase S11：S2 路径已移除，仅保留 ArXiv）
// - 每行 4 操作按钮（更新 / 测试 / 删除 / 刷新状态）
// - 输入框用 type="password" + 眼睛图标切换显隐
// - 测试结果用 ok / fail 两色展示
// - 不显示明文 Key（Key 保存在服务器，客户端不明文展示）
// ============================================================================

interface ProviderMeta {
  id: SearchKeyProvider
  label: string
  description: string
}

const PROVIDERS: ProviderMeta[] = [
  { id: 'exa', label: 'Exa 搜索', description: 'web_search/read_webpage/exa_find_similar 工具使用（$0.007-0.013/次，预充值，dashboard.exa.ai）' },
  { id: 'github', label: 'GitHub', description: 'GitHub 下载代理使用（token 可选，无 token 60 req/hour）' },
]

interface ProviderRowState {
  status: SearchKeyStatus | null
  loading: boolean
  inputValue: string
  showKey: boolean
  updating: boolean
  testing: boolean
  deleting: boolean
  testResult: SearchKeyTestResult | null
  testError: string | null
  error: string | null
}

function ProviderRow({ provider }: { provider: ProviderMeta }) {
  const [state, setState] = useState<ProviderRowState>({
    status: null,
    loading: true,
    inputValue: '',
    showKey: false,
    updating: false,
    testing: false,
    deleting: false,
    testResult: null,
    testError: null,
    error: null,
  })

  const setPartial = (patch: Partial<ProviderRowState>) =>
    setState(prev => ({ ...prev, ...patch }))

  // 加载时调 getSearchKey 获取 hasKey 状态
  const refreshStatus = useCallback(async () => {
    setPartial({ loading: true, error: null })
    try {
      const status = await getSearchKey(provider.id)
      setPartial({ status, loading: false })
    } catch (err) {
      setPartial({
        loading: false,
        error: err instanceof ApiError ? err.message : String(err),
      })
    }
  }, [provider.id])

  useEffect(() => {
    refreshStatus()
  }, [refreshStatus])

  // 更新 Key
  const handleUpdate = async () => {
    if (!state.inputValue.trim()) return
    setPartial({ updating: true, error: null })
    try {
      await updateSearchKey(provider.id, state.inputValue.trim())
      // 更新成功后清空输入框（不持有明文 Key）
      setPartial({
        updating: false,
        inputValue: '',
        showKey: false,
      })
      await refreshStatus()
    } catch (err) {
      setPartial({
        updating: false,
        error: err instanceof ApiError ? err.message : String(err),
      })
    }
  }

  // 测试 Key（用户输入了新值则测新值，否则测服务器已保存的 Key）
  const handleTest = async () => {
    setPartial({ testing: true, testResult: null, testError: null })
    try {
      const keyArg = state.inputValue.trim() || undefined
      const result = await testSearchKey(provider.id, keyArg)
      setPartial({ testing: false, testResult: result })
    } catch (err) {
      setPartial({
        testing: false,
        testError: err instanceof ApiError ? err.message : String(err),
      })
    }
  }

  // 删除 Key
  const handleDelete = async () => {
    if (!window.confirm(`确认删除 ${provider.label} 的 Key？删除后该搜索工具将无法使用。`)) return
    setPartial({ deleting: true, error: null })
    try {
      await deleteSearchKey(provider.id)
      setPartial({
        deleting: false,
        inputValue: '',
        testResult: null,
        testError: null,
      })
      await refreshStatus()
    } catch (err) {
      setPartial({
        deleting: false,
        error: err instanceof ApiError ? err.message : String(err),
      })
    }
  }

  const hasKey = state.status?.hasKey ?? false
  const updatedAt = state.status?.updatedAt
  const inputType = state.showKey ? 'text' : 'password'
  const placeholder = hasKey
    ? '••••••••（已配置，输入新值可覆盖）'
    : `输入 ${provider.label} API Key`

  return (
    <div className="provider-row">
      {/* 头部：provider 名称 + 状态徽章 */}
      <div className="provider-row__head">
        <div>
          <span className="settings-label">{provider.label}</span>
          <div className="settings-desc">{provider.description}</div>
        </div>
        <span className={`settings-badge ${hasKey ? 'settings-badge--success' : 'settings-badge--muted'}`}>
          {hasKey ? <CheckCircle size={11} /> : <XCircle size={11} />}
          {hasKey ? '已配置' : '未配置'}
        </span>
      </div>

      {/* 输入框（password）+ 显隐切换 */}
      <div className="provider-row__input-row">
        <input
          className="input-field input-field--flex"
          type={inputType}
          value={state.inputValue}
          onChange={(e) => setPartial({ inputValue: e.target.value })}
          placeholder={placeholder}
          autoComplete="off"
        />
        <button
          className="toolbar-btn toolbar-btn--icon"
          onClick={() => setPartial({ showKey: !state.showKey })}
          title={state.showKey ? '隐藏' : '显示'}
        >
          {state.showKey ? <EyeOff size={14} /> : <Eye size={14} />}
        </button>
      </div>

      {/* 4 操作按钮 */}
      <div className="provider-row__actions">
        <button
          className="toolbar-btn primary"
          onClick={handleUpdate}
          disabled={state.updating || !state.inputValue.trim()}
        >
          {state.updating ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle size={12} />}
          {state.updating ? '更新中...' : '更新'}
        </button>
        <button
          className="toolbar-btn"
          onClick={handleTest}
          disabled={state.testing || (!state.inputValue.trim() && !hasKey)}
          title={!state.inputValue.trim() && !hasKey ? '未配置 Key，无法测试' : '测试 Key 是否可用'}
        >
          {state.testing ? <Loader2 size={12} className="animate-spin" /> : <FlaskConical size={12} />}
          {state.testing ? '测试中...' : '测试'}
        </button>
        <button
          className="toolbar-btn"
          onClick={handleDelete}
          disabled={state.deleting || !hasKey}
          title={!hasKey ? '未配置 Key，无需删除' : '删除已保存的 Key'}
        >
          {state.deleting ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
          {state.deleting ? '删除中...' : '删除'}
        </button>
        <button
          className="toolbar-btn"
          onClick={refreshStatus}
          disabled={state.loading}
          title="刷新状态"
        >
          {state.loading ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
          {state.loading ? '加载中...' : '刷新状态'}
        </button>
      </div>

      {/* 上次更新时间 */}
      {hasKey && updatedAt != null && (
        <div className="provider-row__meta">
          上次更新：{new Date(updatedAt).toLocaleString()}
        </div>
      )}

      {/* 测试结果 - ok 绿色 */}
      {state.testResult && state.testResult.ok && (
        <div className="settings-alert settings-alert--success">
          <CheckCircle size={14} />
          <span>
            测试通过
            {typeof state.testResult.latencyMs === 'number' && `（${state.testResult.latencyMs}ms）`}
          </span>
        </div>
      )}

      {/* 测试结果 - fail 红色 */}
      {state.testResult && !state.testResult.ok && (
        <div className="settings-alert settings-alert--error">
          <XCircle size={14} />
          <span>
            测试失败
            {state.testResult.latencyMs != null && `（${state.testResult.latencyMs}ms）`}
            {state.testResult.error && `：${state.testResult.error}`}
          </span>
        </div>
      )}

      {/* 网络/调用错误 */}
      {state.testError && (
        <div className="settings-alert settings-alert--error">
          测试请求异常：{state.testError}
        </div>
      )}
      {state.error && (
        <div className="settings-alert settings-alert--error">
          {state.error}
        </div>
      )}
    </div>
  )
}

export default function SearchKeysConfig() {
  return (
    <section className="settings-section">
      <h3 className="settings-section-title">AI 搜索引擎 Key 管理</h3>
      <p className="settings-desc">
        配置 AI 搜索工具使用的第三方 API Key。Key 保存在服务器，客户端不明文展示。
      </p>
      <div>
        {PROVIDERS.map(p => <ProviderRow key={p.id} provider={p} />)}
      </div>
    </section>
  )
}
