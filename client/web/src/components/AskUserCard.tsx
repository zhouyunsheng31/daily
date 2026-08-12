/**
 * AskUserCard — Phase 8 批次5 模块D
 *
 * AI 主动向用户提问的选项卡片（askUserQuestion 工具的 UI 呈现）。
 *
 * 行为：
 *   - 单选模式（allowMultiple=false）：点击选项即提交
 *   - 多选模式（allowMultiple=true）：checkbox + "确认"按钮，点确认后提交
 *   - 提交后卡片变为"已回答"状态（显示选中项，禁用交互）
 *
 * 样式（spec D）：
 *   - 卡片背景 rgba(0,0,0,0.03) + 左侧紫色色条标识
 *   - 圆角 12px，padding 12px
 *   - 选项按钮：圆角 8px，hover 时 rgba(0,0,0,0.05)
 *   - 已选中选项：rgba(0,0,0,0.08) 背景
 */
import { useState } from 'react'
import { Check } from 'lucide-react'
import { useAIStore } from '../stores/useAIStore'
import type { AskUserOption } from '../types/ai'

export interface AskUserCardProps {
  requestId: string
  question: string
  options: AskUserOption[]
  allowMultiple: boolean
  answered: boolean
  selectedValues?: string[]
}

export default function AskUserCard({
  requestId,
  question,
  options,
  allowMultiple,
  answered,
  selectedValues,
}: AskUserCardProps) {
  // 多选模式的临时选择状态
  const [multiSelected, setMultiSelected] = useState<Set<string>>(() => {
    // 如果已回答，初始化为已选中的值
    return new Set(selectedValues ?? [])
  })

  const respondToAskUser = useAIStore(s => s.respondToAskUser)

  // 单选：点击即提交
  const handleSingleSelect = (value: string) => {
    if (answered) return
    respondToAskUser(requestId, [value])
  }

  // 多选：toggle 临时选择
  const handleMultiToggle = (value: string) => {
    if (answered) return
    setMultiSelected(prev => {
      const next = new Set(prev)
      if (next.has(value)) {
        next.delete(value)
      } else {
        next.add(value)
      }
      return next
    })
  }

  // 多选：确认提交
  const handleMultiConfirm = () => {
    if (answered) return
    if (multiSelected.size === 0) return
    respondToAskUser(requestId, Array.from(multiSelected))
  }

  // 当前选中值（用于显示）
  const currentSelected = answered ? new Set(selectedValues ?? []) : multiSelected

  return (
    <div
      style={{
        alignSelf: 'flex-start',
        maxWidth: '85%',
        padding: 12,
        background: 'rgba(0,0,0,0.03)',
        borderLeft: '3px solid rgb(139, 92, 246)', // 紫色色条
        borderRadius: 12,
        fontSize: 12,
        color: 'var(--text-primary)',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        opacity: answered ? 0.7 : 1,
      }}
    >
      {/* 问题文本 */}
      <div
        style={{
          fontWeight: 500,
          lineHeight: 1.5,
          wordBreak: 'break-word',
          whiteSpace: 'pre-wrap',
        }}
      >
        {question}
      </div>

      {/* 选项列表 */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 6,
        }}
      >
        {options.map((option, idx) => {
          const isSelected = currentSelected.has(option.value)
          return (
            <button
              key={`${option.value}-${idx}`}
              type="button"
              disabled={answered}
              onClick={() => {
                if (allowMultiple) {
                  handleMultiToggle(option.value)
                } else {
                  handleSingleSelect(option.value)
                }
              }}
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: 6,
                padding: '6px 10px',
                background: isSelected
                  ? 'rgba(0,0,0,0.08)'
                  : 'transparent',
                border: '1px solid var(--border-subtle)',
                borderRadius: 8,
                cursor: answered ? 'default' : 'pointer',
                fontSize: 12,
                color: 'var(--text-primary)',
                fontFamily: 'inherit',
                textAlign: 'left',
                width: '100%',
                transition: 'background 0.15s ease',
                opacity: answered && !isSelected ? 0.5 : 1,
              }}
              onMouseEnter={(e) => {
                if (!answered && !isSelected) e.currentTarget.style.background = 'rgba(0,0,0,0.05)'
              }}
              onMouseLeave={(e) => {
                if (!answered && !isSelected) e.currentTarget.style.background = 'transparent'
              }}
            >
              {/* checkbox 指示（多选）或 radio 指示（单选） */}
              <span
                style={{
                  flexShrink: 0,
                  width: 14,
                  height: 14,
                  marginTop: 1,
                  borderRadius: allowMultiple ? 3 : '50%',
                  border: isSelected
                    ? 'none'
                    : `1.5px solid var(--text-tertiary)`,
                  background: isSelected
                    ? 'rgb(139, 92, 246)'
                    : 'transparent',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#fff',
                }}
              >
                {isSelected && <Check size={10} strokeWidth={3} />}
              </span>
              <span
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 2,
                  flex: 1,
                  minWidth: 0,
                }}
              >
                <span
                  style={{
                    fontWeight: isSelected ? 500 : 400,
                    lineHeight: 1.4,
                  }}
                >
                  {option.label}
                </span>
                {option.description && (
                  <span
                    style={{
                      fontSize: 10,
                      color: 'var(--text-tertiary)',
                      lineHeight: 1.4,
                    }}
                  >
                    {option.description}
                  </span>
                )}
              </span>
            </button>
          )
        })}
      </div>

      {/* 多选确认按钮 */}
      {allowMultiple && !answered && (
        <button
          type="button"
          onClick={handleMultiConfirm}
          disabled={multiSelected.size === 0}
          style={{
            alignSelf: 'flex-end',
            padding: '4px 12px',
            background: multiSelected.size > 0
              ? 'rgb(139, 92, 246)'
              : 'rgba(0,0,0,0.05)',
            color: multiSelected.size > 0 ? '#fff' : 'var(--text-tertiary)',
            border: 'none',
            borderRadius: 9999,
            fontSize: 11,
            cursor: multiSelected.size > 0 ? 'pointer' : 'not-allowed',
            fontFamily: 'inherit',
            transition: 'background 0.2s ease-in-out',
          }}
        >
          确认 ({multiSelected.size})
        </button>
      )}

      {/* 已回答状态提示 */}
      {answered && (
        <div
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            fontSize: 10,
            color: 'var(--text-tertiary)',
          }}
        >
          <Check size={10} style={{ color: 'rgb(139, 92, 246)' }} />
          已回答
        </div>
      )}
    </div>
  )
}
