/**
 * 组件导入 - 手动上传按钮（Phase 5，spec §11.1）
 *
 * 功能：
 * 1. 浮动按钮入口（登录用户均可见，右下角 AddWidgetFab 上方）
 * 2. 点击后弹出上传弹窗，支持：
 *    - 拖拽 HTML 文件到指定区域（自动读取文件内容）
 *    - 粘贴 HTML 代码到文本框
 *    - 实时预览（iframe srcDoc 沙箱隔离）
 *    - 填写名称、描述、标签、是否公开
 *    - admin 额外可勾选"全局可见"（is_global=true）
 * 3. 确认上传：
 *    - 调用 uploadCustomWidget API 存储到数据库
 *    - 调用 addWidget('freeHtml', ...) 添加到当前面板画布
 *    - 显示成功/失败 toast
 *
 * 权限（spec §11.2，T8 放开）：
 * - 所有登录用户均可上传（后端 requireUser 校验）
 * - member 上传的组件 owner_id=self（默认私有 isPublic=false）
 * - admin 上传可选 is_global=true（全局可见，仅 admin 显示该开关）
 *
 * 安全：
 * - 预览用 iframe sandbox 隔离，禁止访问父窗口
 */
import { useState, useRef, useCallback, type DragEvent } from 'react'
import { Upload, X, Loader2, FileCode, Eye } from 'lucide-react'
import { useAppStore } from '../stores/useAppStore'
import { useUserStore } from '../stores/useUserStore'
import { useToastStore } from '../stores/useToastStore'
import { uploadCustomWidget } from '../api/widgets'

export function UploadWidget() {
  const [open, setOpen] = useState(false)

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        title="上传自定义组件"
        style={{
          position: 'absolute',
          bottom: 84,
          right: 24,
          zIndex: 100,
          width: 44,
          height: 44,
          borderRadius: '50%',
          background: 'var(--bg-surface, #fff)',
          border: '1px solid var(--border-default, rgba(0,0,0,0.12))',
          color: 'var(--color-primary, #4A90E2)',
          cursor: 'pointer',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          boxShadow: '0 2px 8px rgba(0,0,0,0.12)',
        }}
      >
        <Upload size={20} />
      </button>

      {open && <UploadDialog onClose={() => setOpen(false)} />}
    </>
  )
}

// ============================================================================
// 上传弹窗
// ============================================================================

export function UploadDialog({ onClose }: { onClose: () => void }) {
  const activePanelId = useAppStore(s => s.activePanelId)
  const addWidget = useAppStore(s => s.addWidget)
  const showToast = useToastStore(s => s.showToast)
  const updateToast = useToastStore(s => s.updateToast)
  const isAdmin = useUserStore(s => s.user?.role === 'admin')

  const [html, setHtml] = useState('')
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [tagsText, setTagsText] = useState('')
  const [isPublic, setIsPublic] = useState(true)
  const [isGlobal, setIsGlobal] = useState(false)
  const [width, setWidth] = useState(400)
  const [height, setHeight] = useState(300)
  const [loading, setLoading] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [showPreview, setShowPreview] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fileInputRef = useRef<HTMLInputElement>(null)

  // 读取 HTML 文件内容
  const readFile = useCallback((file: File) => {
    if (!file) return
    const isHtml = file.type === 'text/html' || file.name.toLowerCase().endsWith('.html') || file.name.toLowerCase().endsWith('.htm')
    if (!isHtml) {
      setError('请上传 .html 或 .htm 文件')
      return
    }
    setError(null)
    const reader = new FileReader()
    reader.onload = (e) => {
      const content = typeof e.target?.result === 'string' ? e.target.result : ''
      setHtml(content)
      if (!name) {
        // 用文件名作为默认组件名
        const baseName = file.name.replace(/\.(html?|htm)$/i, '')
        setName(baseName)
      }
    }
    reader.onerror = () => setError('读取文件失败')
    reader.readAsText(file)
  }, [name])

  // 拖拽处理
  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files?.[0]
    if (file) readFile(file)
  }

  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setDragOver(true)
  }

  const handleDragLeave = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setDragOver(false)
  }

  // 文件选择
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) readFile(file)
    // 清空 input 以便重复选择同一文件
    e.target.value = ''
  }

  // 粘贴处理
  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const pasted = e.clipboardData.getData('text')
    if (pasted) {
      // 允许默认粘贴行为，textarea 会自动插入
      if (!name) {
        // 尝试从 HTML 中提取 <title>
        const titleMatch = pasted.match(/<title[^>]*>([^<]*)<\/title>/i)
        if (titleMatch && titleMatch[1].trim()) {
          setName(titleMatch[1].trim())
        }
      }
    }
  }

  // 确认上传
  const handleSubmit = async () => {
    if (loading) return
    if (!html.trim()) {
      setError('请提供 HTML 内容')
      return
    }
    if (!name.trim()) {
      setError('请填写组件名称')
      return
    }
    if (!activePanelId) {
      setError('请先选择一个面板')
      return
    }

    setLoading(true)
    setError(null)
    const toastId = showToast({ type: 'loading', message: '正在上传组件...' })

    try {
      const tags = tagsText.split(',').map(t => t.trim()).filter(Boolean)
      // 1. 上传到数据库
      await uploadCustomWidget({
        name: name.trim(),
        html,
        description: description.trim(),
        width,
        height,
        tags,
        isPublic,
        // isGlobal 仅 admin 可设，后端会二次校验角色
        isGlobal: isAdmin ? isGlobal : false,
      })
      // 2. 添加到当前面板画布（作为 freeHtml 组件）
      await addWidget('freeHtml', {
        panelId: activePanelId,
        initialState: {
          html,
          title: name.trim(),
          width,
          height,
        },
      })
      updateToast(toastId, { type: 'success', message: '组件已上传并添加到画布', duration: 3000 })
      onClose()
    } catch (err) {
      const msg = err instanceof Error ? err.message : '上传失败'
      setError(msg)
      updateToast(toastId, { type: 'error', message: msg, duration: 4000 })
    } finally {
      setLoading(false)
    }
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 10000,
        background: 'rgba(0,0,0,0.4)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        animation: 'popup-fade-in 0.15s ease-out',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 'min(720px, 90vw)',
          maxHeight: '85vh',
          overflow: 'auto',
          background: 'var(--bg-surface, #fff)',
          border: '1px solid var(--border-default, rgba(0,0,0,0.12))',
          borderRadius: 12,
          boxShadow: '0 16px 40px rgba(0,0,0,0.2)',
          padding: 24,
        }}
      >
        {/* 头部 */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>上传自定义组件</h2>
          <button
            onClick={onClose}
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              color: 'var(--text-tertiary, #adb5bd)', padding: 4,
              display: 'inline-flex', alignItems: 'center',
            }}
            title="关闭"
          >
            <X size={20} />
          </button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          {/* 左侧：输入区 */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {/* 拖拽区 */}
            <div
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onClick={() => fileInputRef.current?.click()}
              style={{
                border: `2px dashed ${dragOver ? 'var(--color-primary, #4A90E2)' : 'var(--border-default, rgba(0,0,0,0.18))'}`,
                borderRadius: 8,
                padding: '24px 16px',
                textAlign: 'center',
                cursor: 'pointer',
                background: dragOver ? 'var(--color-primary-muted, rgba(74,144,226,0.08))' : 'var(--bg-elevated, #f0f0f2)',
                transition: 'all 0.15s ease',
              }}
            >
              <FileCode size={32} style={{ color: 'var(--text-tertiary, #adb5bd)', marginBottom: 8 }} />
              <div style={{ fontSize: 13, color: 'var(--text-secondary, #86868b)' }}>
                拖拽 HTML 文件到此处，或点击选择
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept=".html,.htm,text/html"
                onChange={handleFileSelect}
                style={{ display: 'none' }}
              />
            </div>

            {/* HTML 代码文本框 */}
            <div>
              <label style={{ fontSize: 12, color: 'var(--text-secondary, #86868b)', marginBottom: 4, display: 'block' }}>
                或粘贴 HTML 代码
              </label>
              <textarea
                value={html}
                onChange={(e) => setHtml(e.target.value)}
                onPaste={handlePaste}
                placeholder="<div>你的 HTML 组件代码</div>"
                style={{
                  width: '100%',
                  minHeight: 120,
                  maxHeight: 200,
                  padding: '8px 12px',
                  borderRadius: 8,
                  border: '1px solid var(--border-default, rgba(0,0,0,0.12))',
                  background: 'var(--bg-elevated, #f0f0f2)',
                  color: 'var(--text-primary, #1d1d1f)',
                  fontSize: 12,
                  fontFamily: 'monospace',
                  resize: 'vertical',
                  outline: 'none',
                }}
              />
            </div>

            {/* 元信息 */}
            <div>
              <label style={labelStyle}>组件名称 *</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="例如：天气卡片"
                style={inputStyle}
              />
            </div>

            <div>
              <label style={labelStyle}>描述</label>
              <input
                type="text"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="组件功能描述"
                style={inputStyle}
              />
            </div>

            <div>
              <label style={labelStyle}>标签（逗号分隔）</label>
              <input
                type="text"
                value={tagsText}
                onChange={(e) => setTagsText(e.target.value)}
                placeholder="天气, 卡片"
                style={inputStyle}
              />
            </div>

            <div style={{ display: 'flex', gap: 12 }}>
              <div style={{ flex: 1 }}>
                <label style={labelStyle}>宽度</label>
                <input
                  type="number"
                  value={width}
                  onChange={(e) => setWidth(Math.max(50, Math.floor(Number(e.target.value) || 400)))}
                  min={50}
                  style={inputStyle}
                />
              </div>
              <div style={{ flex: 1 }}>
                <label style={labelStyle}>高度</label>
                <input
                  type="number"
                  value={height}
                  onChange={(e) => setHeight(Math.max(50, Math.floor(Number(e.target.value) || 300)))}
                  min={50}
                  style={inputStyle}
                />
              </div>
            </div>

            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={isPublic}
                onChange={(e) => setIsPublic(e.target.checked)}
              />
              <span>公开（所有用户可见，否则仅自己可见）</span>
            </label>

            {/* 全局可见开关：仅 admin 可见（spec §11.2，T8） */}
            {isAdmin && (
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={isGlobal}
                  onChange={(e) => setIsGlobal(e.target.checked)}
                />
                <span>全局可见（admin 专属：标记为全局组件）</span>
              </label>
            )}
          </div>

          {/* 右侧：预览区 */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <label style={{ fontSize: 12, color: 'var(--text-secondary, #86868b)', fontWeight: 600 }}>
                预览
              </label>
              <button
                onClick={() => setShowPreview(!showPreview)}
                style={{
                  background: 'none', border: 'none', cursor: 'pointer',
                  color: 'var(--color-primary, #4A90E2)', fontSize: 12,
                  display: 'inline-flex', alignItems: 'center', gap: 4,
                }}
              >
                <Eye size={12} />
                {showPreview ? '隐藏预览' : '显示预览'}
              </button>
            </div>
            <div
              style={{
                width: '100%',
                height: 300,
                border: '1px solid var(--border-default, rgba(0,0,0,0.12))',
                borderRadius: 8,
                background: '#fff',
                overflow: 'hidden',
                position: 'relative',
              }}
            >
              {showPreview && html ? (
                <iframe
                  srcDoc={html}
                  style={{ width: '100%', height: '100%', border: 'none' }}
                  sandbox="allow-scripts"
                  title="preview"
                />
              ) : (
                <div style={{
                  height: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: 'var(--text-tertiary, #adb5bd)',
                  fontSize: 12,
                }}>
                  {html ? '预览已隐藏' : '提供 HTML 内容后显示预览'}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* 错误提示 */}
        {error && (
          <div style={{
            marginTop: 16, padding: '8px 12px', borderRadius: 8,
            background: 'rgba(255,59,48,0.1)', color: 'var(--color-error, #FF3B30)',
            fontSize: 13,
          }}>
            {error}
          </div>
        )}

        {/* 底部按钮 */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
          <button
            onClick={onClose}
            style={{
              padding: '8px 16px', borderRadius: 8,
              border: '1px solid var(--border-default, rgba(0,0,0,0.12))',
              background: 'var(--bg-elevated, #f0f0f2)',
              color: 'var(--text-primary, #1d1d1f)',
              cursor: 'pointer', fontSize: 13,
            }}
          >
            取消
          </button>
          <button
            onClick={handleSubmit}
            disabled={loading || !html.trim() || !name.trim()}
            style={{
              padding: '8px 16px', borderRadius: 8,
              border: 'none',
              background: 'var(--color-primary, #4A90E2)', color: '#fff',
              cursor: loading ? 'not-allowed' : 'pointer', fontSize: 13, fontWeight: 500,
              display: 'inline-flex', alignItems: 'center', gap: 6,
              opacity: (loading || !html.trim() || !name.trim()) ? 0.6 : 1,
            }}
          >
            {loading && <Loader2 size={14} className="animate-spin" />}
            上传并添加到画布
          </button>
        </div>
      </div>
    </div>
  )
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '6px 10px',
  borderRadius: 6,
  border: '1px solid var(--border-default, rgba(0,0,0,0.12))',
  background: 'var(--bg-elevated, #f0f0f2)',
  color: 'var(--text-primary, #1d1d1f)',
  fontSize: 13,
  fontFamily: 'inherit',
  outline: 'none',
}

const labelStyle: React.CSSProperties = {
  fontSize: 12,
  color: 'var(--text-secondary, #86868b)',
  marginBottom: 4,
  display: 'block',
}
