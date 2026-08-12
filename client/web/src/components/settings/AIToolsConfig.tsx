import { useEffect, useState } from 'react'
import { Loader2, FileCog, ShieldAlert } from 'lucide-react'
import { api, ApiError } from '../../api/client'

// ============================================================================
// Phase 3 任务5：AI 文件系统工具开关 UI（spec §7.1）
// - 管理 PI 原生 7 个文件系统工具：read/write/edit/bash/grep/find/ls
// - 默认关闭，用户手动开启（spec §7.1 + 决策日志 16）
// - 复用 ToolsManager 的 API：GET /api/tools + PUT /api/tools/:name
// - 与 ToolsManager 区别：本组件只显示文件系统工具，并提供更聚焦的说明
// ============================================================================

/** PI 原生 7 个文件系统工具名称 */
const FILESYSTEM_TOOL_NAMES = ['read', 'write', 'edit', 'bash', 'grep', 'find', 'ls'] as const

/** 工具默认描述（后端未返回时 fallback） */
const TOOL_DEFAULT_META: Record<string, { label: string; description: string }> = {
  read: { label: 'read', description: '读取文件内容（可读项目内任意文件）' },
  write: { label: 'write', description: '写入文件（覆盖或新建文件）' },
  edit: { label: 'edit', description: '编辑文件（精确替换/插入文本片段）' },
  bash: { label: 'bash', description: '执行 bash 命令（shell，高风险）' },
  grep: { label: 'grep', description: '正则搜索文件内容' },
  find: { label: 'find', description: '按名称/路径查找文件' },
  ls: { label: 'ls', description: '列目录内容' },
}

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

export default function AIToolsConfig() {
  // 工具状态：key=toolName, value=enabled。默认全 false（spec §7.1 默认关闭）
  const [toolStates, setToolStates] = useState<Record<string, boolean>>(() => {
    const initial: Record<string, boolean> = {}
    for (const name of FILESYSTEM_TOOL_NAMES) initial[name] = false
    return initial
  })
  // 工具元数据（从后端获取，fallback 用 TOOL_DEFAULT_META）
  const [toolMeta, setToolMeta] = useState<Record<string, Tool>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [savingId, setSavingId] = useState<string | null>(null)

  const loadTools = async () => {
    setLoading(true)
    setError(null)
    try {
      const result = await api.get<ToolsResponse>('/tools')
      const metaMap: Record<string, Tool> = {}
      const states: Record<string, boolean> = {}
      // 初始化为默认关闭
      for (const name of FILESYSTEM_TOOL_NAMES) states[name] = false
      // 用后端返回的数据覆盖
      for (const tool of result.tools || []) {
        if ((FILESYSTEM_TOOL_NAMES as readonly string[]).includes(tool.name)) {
          metaMap[tool.name] = tool
          states[tool.name] = tool.enabled
        }
      }
      setToolMeta(metaMap)
      setToolStates(states)
    } catch (err) {
      // 后端不可用时仍显示默认列表（全关闭）
      setError(err instanceof ApiError ? err.message : '加载工具列表失败，显示默认状态')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadTools()
  }, [])

  const handleToggle = async (toolName: string, enabled: boolean) => {
    setSavingId(toolName)
    setError(null)
    try {
      await api.put(`/tools/${encodeURIComponent(toolName)}`, { enabled })
      setToolStates(prev => ({ ...prev, [toolName]: enabled }))
    } catch (err) {
      setError(err instanceof ApiError ? err.message : `更新 ${toolName} 工具状态失败`)
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
          加载文件系统工具列表...
        </div>
      </div>
    )
  }

  const enabledCount = Object.values(toolStates).filter(Boolean).length

  return (
    <div className="settings-section">
      <h3
        className="settings-section-title"
        style={{ display: 'flex', alignItems: 'center', gap: 6 }}
      >
        <FileCog size={14} />
        AI 文件系统工具
        <span className="settings-badge settings-badge--muted">
          {enabledCount}/{FILESYSTEM_TOOL_NAMES.length}
        </span>
      </h3>

      {/* 安全提示 */}
      <div className="settings-alert settings-alert--warning" style={{ marginBottom: 12 }}>
        <ShieldAlert size={14} />
        <span>
          文件系统工具允许 AI 在<b>服务器端</b>读写文件、执行命令。默认全部关闭，请按需开启。
          <b>bash</b> 工具风险最高，建议仅在可信环境启用。
        </span>
      </div>

      {error && (
        <div className="settings-alert settings-alert--error">{error}</div>
      )}

      <div>
        {FILESYSTEM_TOOL_NAMES.map(name => {
          const meta = toolMeta[name]
          const label = meta?.label || TOOL_DEFAULT_META[name].label
          const description = meta?.description || TOOL_DEFAULT_META[name].description
          const enabled = toolStates[name] ?? false
          const locked = meta ? !meta.canDisable : false
          const disabled = savingId === name || locked
          const isBash = name === 'bash'
          return (
            <div key={name} className="settings-row">
              <div className="settings-label-group">
                <div className="settings-label">
                  <code style={{ fontFamily: 'monospace', fontSize: 12 }}>{label}</code>
                  {locked && (
                    <span
                      className="settings-badge settings-badge--primary"
                      style={{ marginLeft: 8 }}
                    >
                      系统
                    </span>
                  )}
                  {isBash && (
                    <span
                      className="settings-badge"
                      style={{
                        marginLeft: 8,
                        background: 'rgba(239, 68, 68, 0.15)',
                        color: 'rgb(239, 68, 68)',
                      }}
                    >
                      高风险
                    </span>
                  )}
                </div>
                <div className="settings-desc">{description}</div>
              </div>
              <label className="toggle-switch">
                <input
                  type="checkbox"
                  checked={enabled}
                  disabled={disabled}
                  onChange={(e) => void handleToggle(name, e.target.checked)}
                />
                <span className="toggle-slider" />
              </label>
            </div>
          )
        })}
      </div>

      <div className="settings-desc" style={{ marginTop: 12, fontSize: 11 }}>
        开关状态通过 <code>PUT /api/tools/:name</code> 保存到后端。
        工具在服务端 Node.js 沙箱中执行。
      </div>
    </div>
  )
}
