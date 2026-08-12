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
      <div className="settings-centered">
        <Loader2 size={20} className="animate-spin" />
      </div>
    )
  }

  if (error) {
    return (
      <section className="settings-section">
        <h3 className="settings-section-title">Skills 管理</h3>
        <div className="settings-alert settings-alert--error">
          加载失败: {error}
        </div>
        <button className="toolbar-btn" onClick={loadSkills}>重试</button>
      </section>
    )
  }

  return (
    <section className="settings-section">
      <div className="settings-section-head">
        <h3 className="settings-section-title">Skills 管理</h3>
        <button
          className="toolbar-btn primary"
          onClick={() => setShowAddForm(true)}
        >
          <Plus size={14} />
          添加 Skill
        </button>
      </div>

      {/* Skills 列表 */}
      {skills.length === 0 ? (
        <div className="skill-empty">
          暂无 Skills，点击"添加 Skill"创建
        </div>
      ) : (
        <div className="skill-list">
          {skills.map(skill => (
            <div key={skill.id} className="skill-card">
              <div className="skill-card__head">
                <div className="skill-card__main">
                  <div className="skill-card__title-row">
                    {skill.source === 'builtin' ? (
                      <Package size={14} className="skill-card__icon skill-card__icon--primary" />
                    ) : (
                      <Sparkles size={14} className="skill-card__icon skill-card__icon--secondary" />
                    )}
                    <span className="skill-card__name">
                      {skill.name}
                    </span>
                    {/* 来源标签 */}
                    <span className={`settings-badge ${skill.source === 'builtin' ? 'settings-badge--primary' : 'settings-badge--success'}`}>
                      {skill.source === 'builtin' ? '内置' : '用户'}
                    </span>
                    {/* 版本 */}
                    <span className="skill-card__version">v{skill.version}</span>
                  </div>
                  {skill.description && (
                    <div className="skill-card__desc">
                      {skill.description}
                    </div>
                  )}
                </div>

                {/* 操作区 */}
                <div className="skill-card__actions">
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
                    className="toolbar-btn toolbar-btn--icon"
                    onClick={() => handleViewContent(skill)}
                    title="查看内容"
                  >
                    <Eye size={14} />
                  </button>

                  {/* 删除（仅用户 skill） */}
                  {skill.canDelete && (
                    <button
                      className="toolbar-btn toolbar-btn--icon toolbar-btn--danger"
                      onClick={() => handleDelete(skill)}
                      title="删除"
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
          className="settings-modal-overlay"
          onClick={() => setViewingSkill(null)}
        >
          <div
            className="settings-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="settings-modal-header">
              <div className="settings-modal-title-row">
                <span>{viewingSkill.name}</span>
                <span className="settings-modal-title-sub">
                  {viewingSkill.source === 'builtin' ? '内置' : '用户'} · v{viewingSkill.version}
                </span>
              </div>
              <button
                className="toolbar-btn toolbar-btn--icon"
                onClick={() => setViewingSkill(null)}
              >
                <X size={14} />
              </button>
            </div>
            <div className="settings-modal-body">
              {contentLoading ? (
                <div className="settings-centered">
                  <Loader2 size={20} className="animate-spin" />
                </div>
              ) : (
                <pre className="settings-modal-pre">
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
          className="settings-modal-overlay"
          onClick={() => setShowAddForm(false)}
        >
          <div
            className="settings-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="settings-modal-header">
              <span>添加 Skill</span>
              <button
                className="toolbar-btn toolbar-btn--icon"
                onClick={() => setShowAddForm(false)}
              >
                <X size={14} />
              </button>
            </div>
            <div className="settings-modal-body settings-modal-body--stack">
              {/* 名称 */}
              <div className="settings-field">
                <label className="settings-field-label">
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
              <div className="settings-field">
                <label className="settings-field-label">
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
              <div className="settings-field settings-field--flex">
                <label className="settings-field-label">
                  内容 *（SKILL.md 全文，支持 frontmatter）
                </label>
                <textarea
                  className="settings-textarea settings-textarea--mono settings-textarea--canvas settings-textarea--flex"
                  value={newContent}
                  onChange={(e) => setNewContent(e.target.value)}
                  placeholder={'---\nname: my-skill\ndescription: 我的自定义 skill\nversion: 1.0.0\n---\n\n# Skill 内容\n\n在这里编写 skill 指令...'}
                />
              </div>
            </div>
            <div className="settings-modal-footer">
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
