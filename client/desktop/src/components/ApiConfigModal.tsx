/**
 * API 配置弹窗（Phase 8 批次2 模块 E）
 *
 * 左侧：预设列表（高亮当前选中）
 * 右侧：编辑区（名称 / endpoint / apiKey 掩码 / models chip 增删）
 * 底部：新建预设 / 删除预设 / 保存
 *
 * 样式见 index.css 中的 `===== ApiConfigModal 样式 =====` 块。
 */
import { useEffect, useRef, useState } from 'react'
import { Plus, Trash2, Save, Eye, EyeOff, X } from 'lucide-react'
import { useApiConfigStore } from '../stores/useApiConfigStore'
import type { ApiConfigPreset } from '../types/apiConfig'

export interface ApiConfigModalProps {
  open: boolean
  onClose: () => void
}

/** 编辑区表单状态（受控输入） */
interface EditForm {
  name: string
  endpoint: string
  apiKey: string
  models: string[]
}

/** 从 preset 构造初始 form */
function presetToForm(p: ApiConfigPreset | undefined): EditForm {
  if (!p) return { name: '', endpoint: '', apiKey: '', models: [] }
  return {
    name: p.name,
    endpoint: p.endpoint,
    apiKey: p.apiKey,
    models: [...p.models],
  }
}

export function ApiConfigModal({ open, onClose }: ApiConfigModalProps) {
  const presets = useApiConfigStore(s => s.presets)
  const activePresetId = useApiConfigStore(s => s.activePresetId)
  const setActivePreset = useApiConfigStore(s => s.setActivePreset)
  const createPreset = useApiConfigStore(s => s.createPreset)
  const updatePreset = useApiConfigStore(s => s.updatePreset)
  const deletePreset = useApiConfigStore(s => s.deletePreset)

  // 当前在编辑的 preset id（独立于 activePresetId，编辑时本地选中）
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<EditForm>({ name: '', endpoint: '', apiKey: '', models: [] })
  const [showApiKey, setShowApiKey] = useState(false)
  const [modelInput, setModelInput] = useState('')
  const wasOpenRef = useRef(false)

  // 弹窗打开时（false→true）初始化 editingId 为 activePresetId；
  // 弹窗已打开时若 editingId 失效（如被删除后 store 恢复默认），自动切换到第一个。
  // 不在每次 presets 变化时重置 editingId，否则会破坏 handleNewPreset/handleDeletePreset 的切换逻辑。
  useEffect(() => {
    if (!open) {
      wasOpenRef.current = false
      return
    }
    const wasOpen = wasOpenRef.current
    wasOpenRef.current = true

    if (!wasOpen) {
      // 首次打开：选中 active 预设
      const targetId = activePresetId || presets[0]?.id || null
      setEditingId(targetId)
      setForm(presetToForm(presets.find(p => p.id === targetId)))
      setShowApiKey(false)
      setModelInput('')
      return
    }

    // 已打开状态下 presets 变化：若 editingId 失效，切换到第一个
    const isValid = editingId !== null && presets.some(p => p.id === editingId)
    if (!isValid) {
      const nextId = presets[0]?.id ?? null
      setEditingId(nextId)
      setForm(presetToForm(presets.find(p => p.id === nextId)))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, presets])

  // 切换编辑目标
  function handleSelectPreset(id: string) {
    setEditingId(id)
    setForm(presetToForm(presets.find(p => p.id === id)))
    setShowApiKey(false)
    setModelInput('')
  }

  // 新建预设（空白模板）
  function handleNewPreset() {
    const name = `新配置 ${presets.length + 1}`
    const newId = createPreset({
      name,
      endpoint: '',
      apiKey: '',
      models: [],
    })
    setEditingId(newId)
    // createPreset 同步更新 store，但闭包内的 presets 是旧值，需手动构造 form
    setForm({ name, endpoint: '', apiKey: '', models: [] })
    setShowApiKey(false)
    setModelInput('')
  }

  // 删除当前编辑的 preset
  function handleDeletePreset() {
    if (!editingId) return
    const remaining = presets.filter(p => p.id !== editingId)
    deletePreset(editingId)
    // 切换到剩余的第一个（deletePreset 内部也会修正 activePresetId）
    const nextId = remaining[0]?.id ?? null
    setEditingId(nextId)
    setForm(presetToForm(remaining.find(p => p.id === nextId)))
  }

  // 保存当前编辑
  function handleSave() {
    if (!editingId) return
    updatePreset(editingId, {
      name: form.name.trim() || '未命名配置',
      endpoint: form.endpoint.trim(),
      apiKey: form.apiKey,
      models: form.models,
    })
    // 同步设为全局 active（用户主动保存的预设视为当前生效配置）
    setActivePreset(editingId)
    onClose()
  }

  // 添加 model
  function handleAddModel() {
    const trimmed = modelInput.trim()
    if (!trimmed) return
    if (form.models.includes(trimmed)) {
      setModelInput('')
      return
    }
    setForm(prev => ({ ...prev, models: [...prev.models, trimmed] }))
    setModelInput('')
  }

  // 移除 model
  function handleRemoveModel(model: string) {
    setForm(prev => ({ ...prev, models: prev.models.filter(m => m !== model) }))
  }

  // model 输入框回车提交
  function handleModelInputKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleAddModel()
    }
  }

  if (!open) return null

  return (
    <div className="apicfg-modal__overlay" onClick={onClose}>
      <div className="apicfg-modal" onClick={(e) => e.stopPropagation()}>
        {/* 头部 */}
        <div className="apicfg-modal__header">
          <h2 className="apicfg-modal__title">API 配置</h2>
          <button
            type="button"
            className="apicfg-modal__close-btn"
            onClick={onClose}
            title="关闭"
          >
            <X size={18} />
          </button>
        </div>

        <div className="apicfg-modal__body">
          {/* 左侧：预设列表 */}
          <div className="apicfg-modal__sidebar">
            {presets.map(p => (
              <button
                key={p.id}
                type="button"
                className={`apicfg-modal__preset-item ${p.id === editingId ? 'is-active' : ''}`}
                onClick={() => handleSelectPreset(p.id)}
                title={p.name}
              >
                <span className="apicfg-modal__preset-name">{p.name}</span>
                {p.id === activePresetId && (
                  <span className="apicfg-modal__preset-badge">默认</span>
                )}
              </button>
            ))}
          </div>

          {/* 右侧：编辑区 */}
          <div className="apicfg-modal__editor">
            {editingId ? (
              <>
                <div className="apicfg-modal__field">
                  <label className="apicfg-modal__label">配置名称</label>
                  <input
                    type="text"
                    className="apicfg-modal__input"
                    value={form.name}
                    onChange={(e) => setForm(prev => ({ ...prev, name: e.target.value }))}
                    placeholder="如：DeepSeek 官方"
                  />
                </div>

                <div className="apicfg-modal__field">
                  <label className="apicfg-modal__label">Endpoint</label>
                  <input
                    type="text"
                    className="apicfg-modal__input"
                    value={form.endpoint}
                    onChange={(e) => setForm(prev => ({ ...prev, endpoint: e.target.value }))}
                    placeholder="https://api.example.com/v1/chat/completions"
                  />
                </div>

                <div className="apicfg-modal__field">
                  <label className="apicfg-modal__label">API Key</label>
                  <div className="apicfg-modal__input-wrap">
                    <input
                      type={showApiKey ? 'text' : 'password'}
                      className="apicfg-modal__input apicfg-modal__input--with-icon"
                      value={form.apiKey}
                      onChange={(e) => setForm(prev => ({ ...prev, apiKey: e.target.value }))}
                      placeholder="sk-..."
                    />
                    <button
                      type="button"
                      className="apicfg-modal__toggle-btn"
                      onClick={() => setShowApiKey(!showApiKey)}
                      title={showApiKey ? '隐藏' : '显示'}
                    >
                      {showApiKey ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                </div>

                <div className="apicfg-modal__field">
                  <label className="apicfg-modal__label">Models</label>
                  <div className="apicfg-modal__chips">
                    {form.models.map(m => (
                      <span key={m} className="apicfg-modal__chip">
                        <span className="apicfg-modal__chip-text">{m}</span>
                        <button
                          type="button"
                          className="apicfg-modal__chip-remove"
                          onClick={() => handleRemoveModel(m)}
                          title={`移除 ${m}`}
                        >
                          <X size={12} />
                        </button>
                      </span>
                    ))}
                  </div>
                  <div className="apicfg-modal__input-wrap">
                    <input
                      type="text"
                      className="apicfg-modal__input apicfg-modal__input--with-icon"
                      value={modelInput}
                      onChange={(e) => setModelInput(e.target.value)}
                      onKeyDown={handleModelInputKeyDown}
                      placeholder="输入 model 名称后回车或点击 +"
                    />
                    <button
                      type="button"
                      className="apicfg-modal__toggle-btn"
                      onClick={handleAddModel}
                      title="添加 model"
                    >
                      <Plus size={16} />
                    </button>
                  </div>
                </div>
              </>
            ) : (
              <div className="apicfg-modal__empty">没有可编辑的预设，点击「新建预设」创建一个。</div>
            )}
          </div>
        </div>

        {/* 底部按钮 */}
        <div className="apicfg-modal__footer">
          <button
            type="button"
            className="apicfg-modal__btn apicfg-modal__btn--new"
            onClick={handleNewPreset}
          >
            <Plus size={14} />
            <span>新建预设</span>
          </button>
          <button
            type="button"
            className="apicfg-modal__btn apicfg-modal__btn--delete"
            onClick={handleDeletePreset}
            disabled={!editingId}
          >
            <Trash2 size={14} />
            <span>删除预设</span>
          </button>
          <button
            type="button"
            className="apicfg-modal__btn apicfg-modal__btn--save"
            onClick={handleSave}
            disabled={!editingId}
          >
            <Save size={14} />
            <span>保存</span>
          </button>
        </div>
      </div>
    </div>
  )
}
