import { useState, useEffect, useCallback } from 'react'
import { api, ApiError } from '../../api/client'
import { Loader2, RotateCcw, Check } from 'lucide-react'

// ============================================================================
// Phase 4: AI 提示词配置 UI（spec 3.3 节）
// - 3 个文本域：系统提示词 / 画布提示词 / 浏览器提示词
// - "恢复默认"按钮（调用 POST /api/ai/prompts/reset）
// ============================================================================

/** GET /api/ai/prompts 返回类型 */
interface PromptsResponse {
  systemPrompt: string
  canvasPrompt: string
  browserPrompt: string
  defaults: {
    systemPrompt: string
    canvasPrompt: string
    browserPrompt: string
  }
}

export default function AIPromptConfig() {
  const [systemPrompt, setSystemPrompt] = useState('')
  const [canvasPrompt, setCanvasPrompt] = useState('')
  const [browserPrompt, setBrowserPrompt] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState(false)
  const [resetting, setResetting] = useState(false)

  // 加载提示词
  const loadPrompts = useCallback(async () => {
    setLoading(true)
    try {
      const data = await api.get<PromptsResponse>('/ai/prompts')
      setSystemPrompt(data.systemPrompt || '')
      setCanvasPrompt(data.canvasPrompt || '')
      setBrowserPrompt(data.browserPrompt || '')
    } catch (err) {
      console.error('[AIPromptConfig] 加载提示词失败:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadPrompts()
  }, [loadPrompts])

  // 保存提示词
  const handleSave = async () => {
    setSaving(true)
    try {
      await api.put('/ai/prompts', {
        systemPrompt,
        canvasPrompt,
        browserPrompt,
      })
      setSavedAt(true)
      setTimeout(() => setSavedAt(false), 2000)
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : String(err)
      alert(`保存失败: ${msg}`)
    } finally {
      setSaving(false)
    }
  }

  // 恢复默认提示词
  const handleReset = async () => {
    const confirmed = window.confirm('确定要恢复默认提示词吗？当前自定义提示词将被覆盖。')
    if (!confirmed) return

    setResetting(true)
    try {
      const result = await api.post<PromptsResponse>('/ai/prompts/reset')
      // 用返回的默认值回填
      setSystemPrompt(result.defaults.systemPrompt)
      setCanvasPrompt(result.defaults.canvasPrompt)
      setBrowserPrompt(result.defaults.browserPrompt)
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : String(err)
      alert(`恢复默认失败: ${msg}`)
    } finally {
      setResetting(false)
    }
  }

  if (loading) {
    return (
      <div className="settings-centered">
        <Loader2 size={20} className="animate-spin" />
      </div>
    )
  }

  return (
    <section className="settings-section">
      <h3 className="settings-section-title">提示词配置</h3>

      {/* 系统提示词 */}
      <div className="settings-row-block">
        <div className="settings-label-group">
          <span className="settings-label">系统提示词</span>
          <span className="settings-desc">覆盖/追加默认系统提示词（影响所有 AI 对话）</span>
        </div>
        <textarea
          className="settings-textarea settings-textarea--mono"
          value={systemPrompt}
          onChange={(e) => setSystemPrompt(e.target.value)}
          placeholder="输入系统提示词..."
        />
      </div>

      {/* 画布提示词 */}
      <div className="settings-row-block">
        <div className="settings-label-group">
          <span className="settings-label">画布提示词</span>
          <span className="settings-desc">画布模式下的 AI 行为提示词</span>
        </div>
        <textarea
          className="settings-textarea settings-textarea--mono"
          value={canvasPrompt}
          onChange={(e) => setCanvasPrompt(e.target.value)}
          placeholder="输入画布提示词..."
        />
      </div>

      {/* 浏览器提示词 */}
      <div className="settings-row-block">
        <div className="settings-label-group">
          <span className="settings-label">浏览器提示词</span>
          <span className="settings-desc">浏览器模式下的 AI 行为提示词</span>
        </div>
        <textarea
          className="settings-textarea settings-textarea--mono"
          value={browserPrompt}
          onChange={(e) => setBrowserPrompt(e.target.value)}
          placeholder="输入浏览器提示词..."
        />
      </div>

      {/* 操作按钮 */}
      <div className="settings-row">
        <button className="toolbar-btn" onClick={handleReset} disabled={resetting}>
          {resetting ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <RotateCcw size={14} />
          )}
          <span>{resetting ? '恢复中...' : '恢复默认'}</span>
        </button>
        <button className="toolbar-btn primary" onClick={handleSave} disabled={saving}>
          {saving ? '保存中...' : '保存'}
          {savedAt && <Check size={14} />}
        </button>
        {savedAt && (
          <span className="settings-saved-hint">
            已保存
          </span>
        )}
      </div>
    </section>
  )
}
