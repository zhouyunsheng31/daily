import { useEffect, useState } from 'react'
import { Loader2, Wrench } from 'lucide-react'
import { api } from '../../api/client'

// ============================================================================
// S17.5: 工具管理 UI（重做）
// - 卡片式列表 + iOS 风格 toggle 开关，与其他 settings 组件设计语言一致
// - GET /api/tools → { tools, total, enabledCount }
// - PUT /api/tools/:name { enabled } → { ok, tool, enabled }
// - canDisable=false 的系统工具：开关禁用（始终启用）
// ============================================================================

interface Tool {
  name: string
  label: string
  description: string
  category: string
  canDisable: boolean
  enabled: boolean
}

interface ToolsResponse {
  tools: Tool[]
  total: number
  enabledCount: number
}

export default function ToolsManager() {
  const [tools, setTools] = useState<Tool[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [savingId, setSavingId] = useState<string | null>(null)

  const loadTools = async () => {
    setLoading(true)
    setError(null)
    try {
      const result = await api.get<ToolsResponse>('/tools')
      setTools(result.tools || [])
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载工具列表失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadTools()
  }, [])

  const handleToggle = async (toolName: string, enabled: boolean) => {
    setSavingId(toolName)
    try {
      await api.put(`/tools/${encodeURIComponent(toolName)}`, { enabled })
      setTools((prev) =>
        prev.map((t) => (t.name === toolName ? { ...t, enabled } : t)),
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : '更新工具状态失败')
    } finally {
      setSavingId(null)
    }
  }

  if (loading) {
    return (
      <div className="settings-section">
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            color: 'var(--text-secondary)',
            fontSize: 13,
          }}
        >
          <Loader2 size={16} className="animate-spin" />
          加载工具列表...
        </div>
      </div>
    )
  }

  return (
    <div className="settings-section">
      <h3
        className="settings-section-title"
        style={{ display: 'flex', alignItems: 'center', gap: 6 }}
      >
        <Wrench size={14} />
        工具管理
        <span className="settings-badge settings-badge--muted">{tools.length}</span>
      </h3>
      {error && (
        <div className="settings-alert settings-alert--error">{error}</div>
      )}
      <div>
        {tools.map((tool) => {
          const locked = !tool.canDisable
          const disabled = savingId === tool.name || locked
          return (
            <div key={tool.name} className="settings-row">
              <div className="settings-label-group">
                <div className="settings-label">
                  {tool.label || tool.name}
                  {locked && (
                    <span
                      className="settings-badge settings-badge--primary"
                      style={{ marginLeft: 8 }}
                    >
                      系统
                    </span>
                  )}
                </div>
                <div className="settings-desc">{tool.description}</div>
              </div>
              <label className="toggle-switch">
                <input
                  type="checkbox"
                  checked={tool.enabled}
                  disabled={disabled}
                  onChange={(e) => void handleToggle(tool.name, e.target.checked)}
                />
                <span className="toggle-slider" />
              </label>
            </div>
          )
        })}
      </div>
    </div>
  )
}
