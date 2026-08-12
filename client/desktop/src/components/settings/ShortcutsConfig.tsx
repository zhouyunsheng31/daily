/**
 * Phase 7 批次4 任务7.2：快捷键 Tab（spec 6.2.2 节）
 *
 * 功能：
 * - 显示所有快捷键列表（从 useKeyboardShortcuts 导出的 SHORTCUT_DEFINITIONS 读取）
 * - 每个快捷键显示：功能描述 + 当前按键组合 + 作用域标签
 * - 支持自定义修改：点击快捷键项 → 进入监听模式 → 按下新组合 → 保存
 *   - 自定义映射保存到 localStorage（key: shortcuts_custom_map）
 *   - useKeyboardShortcuts hook 读取自定义映射覆盖默认值（已实现）
 * - 录制模式按 Escape 取消
 * - "恢复默认"按钮（全部重置）
 * - 冲突检测：如果新组合与已有快捷键冲突，提示警告（仍允许保存，由用户决定）
 *
 * 只读快捷键（readOnly: true）不显示"修改"按钮，因为它们的按键匹配逻辑特殊。
 */
import { useState, useEffect, useCallback, useMemo } from 'react'
import {
  SHORTCUT_DEFINITIONS,
  getCustomShortcuts,
  setCustomShortcut,
  resetCustomShortcuts,
  getShortcutKeys,
  eventToCombo,
} from '../../hooks/useKeyboardShortcuts'
import { useToastStore } from '../../stores/useToastStore'
import { Keyboard, RotateCcw, X, AlertTriangle } from 'lucide-react'

/** 作用域标签文本 */
function scopeLabel(scope: 'global' | 'canvas' | 'browser'): string {
  switch (scope) {
    case 'global': return '全局'
    case 'canvas': return '画布'
    case 'browser': return '浏览器'
  }
}

export default function ShortcutsConfig() {
  const showToast = useToastStore(s => s.showToast)
  // 自定义映射快照（用于触发 UI 重渲染：localStorage 写入后递增）
  const [customVersion, setCustomVersion] = useState(0)
  // 当前正在录制的快捷键 ID（null 表示未在录制模式）
  const [recordingId, setRecordingId] = useState<string | null>(null)
  // 录制过程中的临时提示（如"按下新组合..."）
  const [recordingHint, setRecordingHint] = useState('')

  // 读取当前自定义映射（每次 customVersion 变化时重新读取）
  // customVersion 仅作为依赖触发重新计算，值本身不需要使用
  const customMap = useMemo(() => getCustomShortcuts(), [customVersion])

  // 录制模式：监听 keydown 捕获新组合
  const handleRecordKeydown = useCallback((e: KeyboardEvent) => {
    // Escape 取消录制
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      setRecordingId(null)
      setRecordingHint('')
      return
    }
    const combo = eventToCombo(e)
    if (!combo) {
      // 单独按下修饰键，提示用户继续
      setRecordingHint('请按下完整组合（如 Ctrl+K）')
      e.preventDefault()
      e.stopPropagation()
      return
    }
    e.preventDefault()
    e.stopPropagation()
    // 保存自定义映射
    setCustomShortcut(recordingId!, combo)
    setCustomVersion(v => v + 1)
    setRecordingId(null)
    setRecordingHint('')
    showToast({ type: 'success', message: `已设置为 ${combo}`, duration: 2000 })
  }, [recordingId, showToast])

  useEffect(() => {
    if (!recordingId) return
    // 录制期间在 window 上捕获（capture 阶段，避免被 useKeyboardShortcuts 拦截）
    window.addEventListener('keydown', handleRecordKeydown, true)
    return () => {
      window.removeEventListener('keydown', handleRecordKeydown, true)
    }
  }, [recordingId, handleRecordKeydown])

  // 进入录制模式
  const handleStartRecording = (id: string) => {
    setRecordingId(id)
    setRecordingHint('按下新组合（Escape 取消）')
  }

  // 取消录制
  const handleCancelRecording = () => {
    setRecordingId(null)
    setRecordingHint('')
  }

  // 清除单条自定义（恢复该快捷键为默认）
  const handleResetOne = (id: string) => {
    setCustomShortcut(id, '')
    setCustomVersion(v => v + 1)
    showToast({ type: 'info', message: '已恢复默认', duration: 1500 })
  }

  // 全部恢复默认
  const handleResetAll = () => {
    if (!window.confirm('确定要将所有快捷键恢复为默认值吗？')) return
    resetCustomShortcuts()
    setCustomVersion(v => v + 1)
    showToast({ type: 'success', message: '所有快捷键已恢复默认', duration: 2000 })
  }

  // 冲突检测：检查 combo 是否与其他快捷键的当前生效组合相同
  const checkConflict = (combo: string, exceptId: string): string | null => {
    for (const def of SHORTCUT_DEFINITIONS) {
      if (def.id === exceptId) continue
      const otherKeys = getShortcutKeys(def.id)
      if (otherKeys === combo) {
        return def.description
      }
    }
    return null
  }

  // 按作用域分组显示
  const groupedByScope = {
    global: SHORTCUT_DEFINITIONS.filter(d => d.scope === 'global'),
    canvas: SHORTCUT_DEFINITIONS.filter(d => d.scope === 'canvas'),
    browser: SHORTCUT_DEFINITIONS.filter(d => d.scope === 'browser'),
  }

  // 渲染单个快捷键行
  const renderShortcutRow = (def: typeof SHORTCUT_DEFINITIONS[number]) => {
    const currentKeys = customMap[def.id] ?? def.defaultKeys
    const isCustomized = !!customMap[def.id]
    const isRecording = recordingId === def.id
    const conflict = isCustomized ? checkConflict(currentKeys, def.id) : null

    return (
      <div
        key={def.id}
        className={`sc-row${isRecording ? ' recording' : ''}${isCustomized ? ' customized' : ''}`}
      >
        <div className="sc-info">
          <div className="sc-desc">{def.description}</div>
          <div className="sc-meta">
            <span className={`sc-scope sc-scope-${def.scope}`}>{scopeLabel(def.scope)}</span>
            {isCustomized && <span className="sc-custom-tag">已自定义</span>}
            {conflict && (
              <span className="sc-conflict" title={`与"${conflict}"冲突`}>
                <AlertTriangle size={11} />
                与"{conflict}"冲突
              </span>
            )}
          </div>
        </div>
        <div className="sc-actions">
          {isRecording ? (
            <>
              <span className="sc-recording-hint">{recordingHint || '等待按键...'}</span>
              <button className="sc-icon-btn" title="取消" onClick={handleCancelRecording}>
                <X size={13} />
              </button>
            </>
          ) : (
            <>
              <kbd className={`sc-kbd${isCustomized ? ' customized' : ''}`}>
                {currentKeys}
              </kbd>
              {def.readOnly ? (
                <span className="sc-readonly-tag" title="此快捷键不支持自定义">只读</span>
              ) : (
                <>
                  <button
                    className="sc-icon-btn"
                    title="修改"
                    onClick={() => handleStartRecording(def.id)}
                  >
                    <Keyboard size={13} />
                  </button>
                  {isCustomized && (
                    <button
                      className="sc-icon-btn"
                      title="恢复默认"
                      onClick={() => handleResetOne(def.id)}
                    >
                      <RotateCcw size={12} />
                    </button>
                  )}
                </>
              )}
            </>
          )}
        </div>
      </div>
    )
  }

  const hasCustom = Object.keys(customMap).length > 0

  return (
    <section className="settings-section">
      <h3 className="settings-section-title">快捷键</h3>

      <div className="sc-toolbar">
        <span className="sc-tip">
          点击 <Keyboard size={11} /> 进入录制模式，按下新组合即可保存。Escape 取消。
        </span>
        <button
          className="toolbar-btn"
          onClick={handleResetAll}
          disabled={!hasCustom}
          title={hasCustom ? '恢复全部默认' : '没有自定义快捷键'}
          style={{ opacity: hasCustom ? 1 : 0.5 }}
        >
          <RotateCcw size={12} />
          恢复默认
        </button>
      </div>

      <div className="sc-group">
        <h4 className="sc-group-title">全局</h4>
        {groupedByScope.global.map(renderShortcutRow)}
      </div>

      <div className="sc-group">
        <h4 className="sc-group-title">画布作用域</h4>
        {groupedByScope.canvas.map(renderShortcutRow)}
      </div>

      <div className="sc-group">
        <h4 className="sc-group-title">浏览器作用域</h4>
        {groupedByScope.browser.map(renderShortcutRow)}
      </div>
    </section>
  )
}
