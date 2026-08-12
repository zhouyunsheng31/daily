/**
 * DataSendPreviewCard — Phase 8 批次5 模块F
 *
 * 数据发送预览卡片（迁移自已删除的 GlobalQuickInput）。
 *
 * 行为：
 *   - 监听 useAIStore 的 session.pendingSendPreview
 *   - 显示数据发送预览卡片：接收方 + 数据摘要 + 分类标签
 *   - 数据摘要可展开/折叠（默认折叠显示前 3 行）
 *   - Confirm / Reject 按钮
 *   - Confirm 后调 confirmDataSend；Reject 后调 rejectDataSend
 *
 * 样式（spec F.2）：
 *   - 卡片背景 rgba(0,0,0,0.03) + 左侧蓝色色条标识
 *   - 圆角 12px，padding 12px
 *   - Confirm 按钮：绿色文字；Reject 按钮：灰色文字
 */
import { useState } from 'react'
import { ChevronDown, ChevronRight, Check, Database, Send } from 'lucide-react'
import { useAIStore } from '../stores/useAIStore'
import type { DataSendPreview } from '../types/ai'

export interface DataSendPreviewCardProps {
  sessionId: string
  preview: DataSendPreview
}

/** 确认原因的中文映射 */
const CONFIRMATION_REASON_LABELS: Record<string, string> = {
  first_send: '首次发送',
  new_data_category: '新数据类别',
  new_store_authorized: '新授权数据源',
  model_switched: '模型已切换',
}

/** 脱敏级别的中文映射 + 颜色 */
const SANITIZATION_LABELS: Record<string, { label: string; color: string }> = {
  full: { label: '完整', color: 'rgb(239, 68, 68)' },
  abstract: { label: '摘要', color: 'rgb(249, 115, 22)' },
  redacted: { label: '脱敏', color: 'rgb(59, 130, 246)' },
  excluded: { label: '排除', color: 'var(--text-tertiary)' },
}

export default function DataSendPreviewCard({ sessionId, preview }: DataSendPreviewCardProps) {
  const [expanded, setExpanded] = useState(false)

  const confirmDataSend = useAIStore(s => s.confirmDataSend)
  const rejectDataSend = useAIStore(s => s.rejectDataSend)

  const handleConfirm = () => {
    confirmDataSend(sessionId, preview)
  }

  const handleReject = () => {
    rejectDataSend(sessionId)
  }

  // 默认折叠：只显示前 3 行；展开后显示全部
  const visibleSummaries = expanded
    ? preview.storeSummaries
    : preview.storeSummaries.slice(0, 3)
  const hiddenCount = preview.storeSummaries.length - visibleSummaries.length

  return (
    <div
      style={{
        alignSelf: 'flex-start',
        maxWidth: '85%',
        padding: 12,
        background: 'rgba(0,0,0,0.03)',
        borderLeft: '3px solid rgb(59, 130, 246)', // 蓝色色条
        borderRadius: 12,
        fontSize: 12,
        color: 'var(--text-primary)',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}
    >
      {/* 头部：图标 + 标题 */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          fontSize: 10,
          color: 'rgb(59, 130, 246)',
          fontWeight: 500,
        }}
      >
        <Send size={12} />
        数据发送预览
      </div>

      {/* 接收方信息 + token 估算 */}
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 6,
          fontSize: 10,
          color: 'var(--text-secondary)',
        }}
      >
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 3,
            padding: '1px 6px',
            background: 'rgba(59, 130, 246, 0.1)',
            borderRadius: 4,
            color: 'rgb(37, 99, 235)',
          }}
        >
          <Database size={10} />
          {preview.includedStores.length} 个数据源
        </span>
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            padding: '1px 6px',
            background: 'rgba(0,0,0,0.05)',
            borderRadius: 4,
            color: 'var(--text-tertiary)',
            fontFamily: 'monospace',
          }}
        >
          ~{preview.estimatedTokens} tokens
        </span>
        {preview.requiresConfirmation && preview.confirmationReason && (
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              padding: '1px 6px',
              background: 'rgba(249, 115, 22, 0.1)',
              borderRadius: 4,
              color: 'rgb(249, 115, 22)',
            }}
          >
            {CONFIRMATION_REASON_LABELS[preview.confirmationReason] ?? preview.confirmationReason}
          </span>
        )}
      </div>

      {/* 数据摘要（可展开/折叠） */}
      <div>
        <div
          onClick={() => setExpanded(!expanded)}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            cursor: 'pointer',
            fontSize: 11,
            color: 'var(--text-secondary)',
            fontWeight: 500,
          }}
        >
          {expanded ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
          数据摘要 ({preview.storeSummaries.length})
        </div>
        <div
          style={{
            marginTop: 4,
            display: 'flex',
            flexDirection: 'column',
            gap: 4,
          }}
        >
          {visibleSummaries.map((summary, idx) => {
            const sanInfo = SANITIZATION_LABELS[summary.sanitizationLevel] ?? {
              label: summary.sanitizationLevel,
              color: 'var(--text-tertiary)',
            }
            return (
              <div
                key={`${summary.storeName}-${idx}`}
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 6,
                  padding: '4px 6px',
                  background: 'rgba(0,0,0,0.02)',
                  borderRadius: 4,
                  fontSize: 10,
                }}
              >
                <span
                  style={{
                    flexShrink: 0,
                    padding: '0 4px',
                    background: 'rgba(0,0,0,0.05)',
                    borderRadius: 3,
                    color: sanInfo.color,
                    fontWeight: 500,
                    fontSize: 9,
                  }}
                >
                  {sanInfo.label}
                </span>
                <span
                  style={{
                    fontFamily: 'monospace',
                    color: 'var(--text-secondary)',
                    flexShrink: 0,
                  }}
                >
                  {summary.storeName}
                </span>
                <span
                  style={{
                    color: 'var(--text-tertiary)',
                    lineHeight: 1.4,
                    wordBreak: 'break-word',
                    flex: 1,
                    minWidth: 0,
                  }}
                >
                  {summary.description}
                </span>
              </div>
            )
          })}
          {/* 折叠时的展开提示 */}
          {!expanded && hiddenCount > 0 && (
            <button
              type="button"
              onClick={() => setExpanded(true)}
              style={{
                padding: '2px 6px',
                background: 'transparent',
                border: 'none',
                fontSize: 10,
                color: 'rgb(59, 130, 246)',
                cursor: 'pointer',
                fontFamily: 'inherit',
                textAlign: 'left',
              }}
            >
              展开剩余 {hiddenCount} 项...
            </button>
          )}
        </div>
      </div>

      {/* 操作按钮 */}
      <div
        style={{
          display: 'flex',
          gap: 8,
          justifyContent: 'flex-end',
        }}
      >
        <button
          type="button"
          onClick={handleReject}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            padding: '4px 12px',
            background: 'transparent',
            border: '1px solid var(--border-subtle)',
            borderRadius: 9999,
            fontSize: 11,
            color: 'var(--text-tertiary)',
            cursor: 'pointer',
            fontFamily: 'inherit',
            transition: 'background 0.15s ease',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(0,0,0,0.04)' }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
        >
          拒绝
        </button>
        <button
          type="button"
          onClick={handleConfirm}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            padding: '4px 12px',
            background: 'transparent',
            border: '1px solid rgba(22, 163, 74, 0.3)',
            borderRadius: 9999,
            fontSize: 11,
            color: 'rgb(22, 163, 74)',
            cursor: 'pointer',
            fontFamily: 'inherit',
            transition: 'background 0.15s ease',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(22, 163, 74, 0.08)' }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
        >
          <Check size={11} />
          确认发送
        </button>
      </div>
    </div>
  )
}
