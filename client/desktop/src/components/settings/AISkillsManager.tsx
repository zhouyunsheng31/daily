import { useState, useEffect, useCallback } from 'react'
import { api, ApiError } from '../../api/client'
import {
  Loader2, Plus, Trash2, Eye, X, Package, Sparkles,
} from 'lucide-react'

// ============================================================================
// Phase 4: Skills 管理 UI（spec 3.4 节）
// - Skills 列表（名称/描述/版本/来源：内置/用户）
// - 启用/禁用开关
// - 查看内容（显示 SKILL.md 内容，模态框）
// - 添加 skill（输入名称+内容）
// - 删除 skill（仅用户添加的，内置隐藏删除按钮）
// ============================================================================

/** GET /api/skills 返回的 skill 信息 */
interface SkillInfo {
  id: string
  name: string
  description: string
  version: string
  source: 'builtin' | 'user'
  enabled: boolean
  canDelete: boolean
}

/** GET /api/skills/:id/content 返回类型 */
interface SkillContentResponse {
  id: string
  content: string
  source: 'builtin' | 'user'
}

export default function AISkillsManager() {
  const [skills, setSkills] = useState<SkillInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // 查看内容模态框状态
  const [viewingSkill, setViewingSkill] = useState<SkillInfo | null>(null)
  const [skillContent, setSkillContent] = useState<string>('')
  const [contentLoading, setContentLoading] = useState(false)

  // 添加 skill 模态框状态
  const [showAddForm, setShowAddForm] = useState(false)
  const [newName, setNewName] = useState('')
  const [newDescription, setNewDescription] = useState('')
  const [newContent, setNewContent] = useState('')
  const [adding, setAdding] = useState(false)

  // 加载 skills 列表
  const loadSkills = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await api.get<{ skills: SkillInfo[] }>('/skills')
      setSkills(data.skills || [])
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : String(err)
      setError(msg)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadSkills()
  }, [loadSkills])

  // 切换启用/禁用
  const handleToggleEnabled = async (skill: SkillInfo) => {
    const newEnabled = !skill.enabled
    // 乐观更新
    setSkills(prev => prev.map(s => s.id === skill.id ? { ...s, enabled: newEnabled } : s))
    try {
      await api.put(`/skills/${encodeURIComponent(skill.id)}`, { enabled: newEnabled })
    } catch (err) {
      // 回滚
      setSkills(prev => prev.map(s => s.id === skill.id ? { ...s, enabled: skill.enabled } : s))
      const msg = err instanceof ApiError ? err.message : String(err)
      alert(`切换失败: ${msg}`)
    }
  }

  // 查看内容
  const handleViewContent = async (skill: SkillInfo) => {
    setViewingSkill(skill)
    setSkillContent('')
    setContentLoading(true)
    try {
      const data = await api.get<SkillContentResponse>(`/skills/${encodeURIComponent(skill.id)}/content`)
      setSkillContent(data.content)
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : String(err)
      setSkillContent(`加载失败: ${msg}`)
    } finally {
      setContentLoading(false)
    }
  }

  // 删除 skill（仅用户）
  const handleDelete = async (skill: SkillInfo) => {
    if (!skill.canDelete) return
    const confirmed = window.confirm(`确定要删除 skill "${skill.name}" 吗？此操作不可撤销。`)
    if (!confirmed) return

    try {
      await api.delete(`/skills/${encodeURIComponent(skill.id)}`)
      setSkills(prev => prev.filter(s => s.id !== skill.id))
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : String(err)
      alert(`删除失败: ${msg}`)
    }
  }

  // 添加 skill
  const handleAddSkill = async () => {
    if (!newName.trim() || !newContent.trim()) {
      alert('名称和内容不能为空')
      return
    }
    setAdding(true)
    try {
      const result = await api.post<SkillInfo>('/skills', {
        name: newName.trim(),
        description: newDescription.trim(),
        content: newContent,
        enabled: true,
      })
      setSkills(prev => [...prev, result])
      // 重置表单
      setNewName('')
      setNewDescription('')
      setNewContent('')
      setShowAddForm(false)
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : String(err)
      alert(`添加失败: ${msg}`)
    } finally {
      setAdding(false)
    }
  }

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: 24 }}>
        <Loader2 size={20} className="animate-spin" />
      </div>
    )
  }

  if (error) {
    return (
      <section className="settings-section">
        <h3 className="settings-section-title">Skills 管理</h3>
        <div style={{ color: 'var(--color-error)', fontSize: 12, padding: 12 }}>
          加载失败: {error}
        </div>
        <button className="toolbar-btn" onClick={loadSkills}>重试</button>
      </section>
    )
  }

  return (
    <section className="settings-section">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <h3 className="settings-section-title" style={{ margin: 0 }}>Skills 管理</h3>
        <button
          className="toolbar-btn primary"
          onClick={() => setShowAddForm(true)}
          style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12 }}
        >
          <Plus size={14} />
          添加 Skill
        </button>
      </div>

      {/* Skills 列表 */}
      {skills.length === 0 ? (
        <div style={{ padding: 16, textAlign: 'center', color: 'var(--text-tertiary)', fontSize: 12 }}>
          暂无 Skills，点击"添加 Skill"创建
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {skills.map(skill => (
            <div
              key={skill.id}
              style={{
                padding: 12,
                borderRadius: 8,
                border: '1px solid var(--border-subtle)',
                background: 'var(--bg-surface)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                    {skill.source === 'builtin' ? (
                      <Package size={14} style={{ color: 'var(--color-primary)', flexShrink: 0 }} />
                    ) : (
                      <Sparkles size={14} style={{ color: 'var(--color-secondary)', flexShrink: 0 }} />
                    )}
                    <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>
                      {skill.name}
                    </span>
                    {/* 来源标签 */}
                    <span style={{
                      fontSize: 10,
                      padding: '1px 6px',
                      borderRadius: 4,
                      background: skill.source === 'builtin' ? 'rgba(59,130,246,0.15)' : 'rgba(80,227,194,0.15)',
                      color: skill.source === 'builtin' ? 'var(--color-primary)' : 'var(--color-secondary)',
                      flexShrink: 0,
                    }}>
                      {skill.source === 'builtin' ? '内置' : '用户'}
                    </span>
                    {/* 版本 */}
                    <span style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>v{skill.version}</span>
                  </div>
                  {skill.description && (
                    <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.4 }}>
                      {skill.description}
                    </div>
                  )}
                </div>

                {/* 操作区 */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                  {/* 启用/禁用开关 */}
                  <label className="toggle-switch" title={skill.enabled ? '已启用，点击禁用' : '已禁用，点击启用'}>
                    <input
                      type="checkbox"
                      checked={skill.enabled}
                      onChange={() => handleToggleEnabled(skill)}
                    />
                    <span className="toggle-slider" />
                  </label>

                  {/* 查看内容 */}
                  <button
                    className="toolbar-btn"
                    onClick={() => handleViewContent(skill)}
                    title="查看内容"
                    style={{ padding: '4px 8px', display: 'flex', alignItems: 'center' }}
                  >
                    <Eye size={14} />
                  </button>

                  {/* 删除（仅用户 skill） */}
                  {skill.canDelete && (
                    <button
                      className="toolbar-btn"
                      onClick={() => handleDelete(skill)}
                      title="删除"
                      style={{ padding: '4px 8px', display: 'flex', alignItems: 'center', color: 'var(--color-error)' }}
                    >
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 查看内容模态框 */}
      {viewingSkill && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
          }}
          onClick={() => setViewingSkill(null)}
        >
          <div
            style={{
              background: 'var(--bg-surface)',
              borderRadius: 12,
              border: '1px solid var(--border-default)',
              width: '80%',
              maxWidth: 800,
              maxHeight: '80%',
              display: 'flex',
              flexDirection: 'column',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: '12px 16px',
              borderBottom: '1px solid var(--border-subtle)',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 14, fontWeight: 600 }}>{viewingSkill.name}</span>
                <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
                  {viewingSkill.source === 'builtin' ? '内置' : '用户'} · v{viewingSkill.version}
                </span>
              </div>
              <button
                className="toolbar-btn"
                onClick={() => setViewingSkill(null)}
                style={{ padding: '4px 8px', display: 'flex', alignItems: 'center' }}
              >
                <X size={14} />
              </button>
            </div>
            <div style={{ padding: 16, overflow: 'auto', flex: 1 }}>
              {contentLoading ? (
                <div style={{ display: 'flex', justifyContent: 'center', padding: 24 }}>
                  <Loader2 size={20} className="animate-spin" />
                </div>
              ) : (
                <pre style={{
                  margin: 0,
                  fontSize: 12,
                  fontFamily: 'monospace',
                  color: 'var(--text-primary)',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                  lineHeight: 1.5,
                }}>
                  {skillContent}
                </pre>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 添加 Skill 模态框 */}
      {showAddForm && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
          }}
          onClick={() => setShowAddForm(false)}
        >
          <div
            style={{
              background: 'var(--bg-surface)',
              borderRadius: 12,
              border: '1px solid var(--border-default)',
              width: '80%',
              maxWidth: 640,
              maxHeight: '80%',
              display: 'flex',
              flexDirection: 'column',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: '12px 16px',
              borderBottom: '1px solid var(--border-subtle)',
            }}>
              <span style={{ fontSize: 14, fontWeight: 600 }}>添加 Skill</span>
              <button
                className="toolbar-btn"
                onClick={() => setShowAddForm(false)}
                style={{ padding: '4px 8px', display: 'flex', alignItems: 'center' }}
              >
                <X size={14} />
              </button>
            </div>
            <div style={{ padding: 16, overflow: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: 12 }}>
              {/* 名称 */}
              <div>
                <label style={{ fontSize: 12, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>
                  名称 *
                </label>
                <input
                  className="input-field"
                  type="text"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="如：my-custom-skill"
                />
              </div>
              {/* 描述 */}
              <div>
                <label style={{ fontSize: 12, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>
                  描述
                </label>
                <input
                  className="input-field"
                  type="text"
                  value={newDescription}
                  onChange={(e) => setNewDescription(e.target.value)}
                  placeholder="简要描述 skill 的用途"
                />
              </div>
              {/* 内容（SKILL.md 全文） */}
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
                <label style={{ fontSize: 12, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>
                  内容 *（SKILL.md 全文，支持 frontmatter）
                </label>
                <textarea
                  style={{
                    flex: 1,
                    minHeight: 200,
                    padding: '8px 12px',
                    borderRadius: 'var(--radius-sm)',
                    border: '1px solid var(--border-default)',
                    background: 'var(--bg-canvas)',
                    color: 'var(--text-primary)',
                    fontSize: 12,
                    fontFamily: 'monospace',
                    outline: 'none',
                    resize: 'vertical',
                    lineHeight: 1.5,
                  }}
                  value={newContent}
                  onChange={(e) => setNewContent(e.target.value)}
                  placeholder={'---\nname: my-skill\ndescription: 我的自定义 skill\nversion: 1.0.0\n---\n\n# Skill 内容\n\n在这里编写 skill 指令...'}
                />
              </div>
            </div>
            <div style={{
              padding: '12px 16px',
              borderTop: '1px solid var(--border-subtle)',
              display: 'flex',
              justifyContent: 'flex-end',
              gap: 8,
            }}>
              <button className="toolbar-btn" onClick={() => setShowAddForm(false)}>取消</button>
              <button
                className="toolbar-btn primary"
                onClick={handleAddSkill}
                disabled={adding || !newName.trim() || !newContent.trim()}
              >
                {adding ? '添加中...' : '添加'}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
