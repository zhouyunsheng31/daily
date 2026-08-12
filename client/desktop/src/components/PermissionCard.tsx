/**
 * PermissionCard — Phase 8 批次5 模块F
 *
 * 权限请求卡片（迁移自已删除的 GlobalQuickInput）。
 *
 * 行为：
 *   - 监听 useAIStore.pendingPermissionRequests
 *   - 按 callerWidgetId 过滤，只显示属于当前 AI 会话绑定面板的权限请求
 *   - dangerous（irreversible）标记的请求二次确认（点击 Allow 后弹"确定？"确认）
 *   - Allow / Deny 后发 WS permission_response 回复服务端
 *   - 已处理后显示状态（"已允许" / "已拒绝"），禁用交互
 *
 * 样式（spec F.1）：
 *   - 卡片背景 rgba(0,0,0,0.03) + 左侧橙色色条标识（irreversible 为红色）
 *   - 圆角 12px，padding 12px
 *   - Allow 按钮：绿色文字；Deny 按钮：红色文字
 */
import { useState } from 'react'
import { ShieldAlert, ShieldCheck, Check, X } from 'lucide-react'
import { useAIStore } from '../stores/useAIStore'
import type { PermissionRequest } from '../types/ai'

export interface PermissionCardProps {
  /** 当前会话绑定的面板 ID（用于按 callerWidgetId 过滤） */
  boundPanelId: string | null
}

export default function PermissionCard({ boundPanelId }: PermissionCardProps) {
  // 订阅 store：pendingPermissionRequests、_permissionResponses、respondToPermission
  const pendingPermissionRequests = useAIStore(s => s.pendingPermissionRequests)
  const permissionResponses = useAIStore(s => s._permissionResponses)
  const respondToPermission = useAIStore(s => s.respondToPermission)

  // 本地状态：记录正在二次确认的 requestId（dangerous 请求）
  const [confirmingId, setConfirmingId] = useState<string | null>(null)

  // 按 callerWidgetId 过滤：只显示属于当前会话绑定面板的请求
  // 同时也显示 callerWidgetId 为空的请求（兼容无 caller 的场景）
  const visibleRequests = Array.from(pendingPermissionRequests.entries()).filter(
    ([, req]) => {
      if (!boundPanelId) return false
      // callerWidgetId 匹配 boundPanelId，或 callerWidgetId 为空（全局请求）
      return req.callerWidgetId === boundPanelId || !req.callerWidgetId
    },
  )

  if (visibleRequests.length === 0) return null

  const handleAllow = (requestId: string, req: PermissionRequest) => {
    // dangerous（irreversible）请求二次确认
    if (req.irreversible && confirmingId !== requestId) {
      setConfirmingId(requestId)
      return
    }
    setConfirmingId(null)
    respondToPermission(requestId, { approved: true })
  }

  const handleDeny = (requestId: string) => {
    setConfirmingId(null)
    respondToPermission(requestId, { approved: false })
  }

  return (
    <>
      {visibleRequests.map(([requestId, req]) => {
        const response = permissionResponses.get(requestId)
        const answered = !!response
        const isDangerous = !!req.irreversible
        const isConfirming = confirmingId === requestId

        return (
          <div
            key={requestId}
            style={{
              alignSelf: 'flex-start',
              maxWidth: '85%',
              padding: 12,
              background: 'rgba(0,0,0,0.03)',
              borderLeft: `3px solid ${isDangerous ? 'rgb(239, 68, 68)' : 'rgb(249, 115, 22)'}`, // 红色/橙色
              borderRadius: 12,
              fontSize: 12,
              color: 'var(--text-primary)',
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
              opacity: answered ? 0.7 : 1,
            }}
          >
            {/* 头部：图标 + 权限级别 */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                fontSize: 10,
                color: isDangerous ? 'rgb(239, 68, 68)' : 'rgb(249, 115, 22)',
                fontWeight: 500,
              }}
            >
              {isDangerous ? <ShieldAlert size={12} /> : <ShieldCheck size={12} />}
              {isDangerous ? '危险操作（不可逆）' : '权限请求'}
              {req.permission && (
                <span
                  style={{
                    padding: '1px 5px',
                    background: 'rgba(0,0,0,0.05)',
                    borderRadius: 4,
                    fontSize: 9,
                    color: 'var(--text-tertiary)',
                  }}
                >
                  {req.permission}
                </span>
              )}
            </div>

            {/* 操作描述 */}
            <div
              style={{
                lineHeight: 1.5,
                wordBreak: 'break-word',
                whiteSpace: 'pre-wrap',
              }}
            >
              {req.description}
            </div>

            {/* 调用方信息 */}
            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: 4,
                fontSize: 10,
                color: 'var(--text-tertiary)',
              }}
            >
              {req.toolName && (
                <span style={{ fontFamily: 'monospace' }}>
                  tool: {req.toolName}
                </span>
              )}
              {req.storeName && (
                <span style={{ fontFamily: 'monospace' }}>
                  store: {req.storeName}
                </span>
              )}
              {req.callerWidgetId && (
                <span style={{ fontFamily: 'monospace' }}>
                  caller: {req.callerWidgetId.slice(0, 8)}
                </span>
              )}
            </div>

            {/* dryRun 结果（如有） */}
            {req.dryRunResult && (
              <div
                style={{
                  padding: '4px 6px',
                  background: 'rgba(0,0,0,0.04)',
                  borderRadius: 4,
                  fontSize: 10,
                  fontFamily: 'monospace',
                  color: req.dryRunResult.success ? 'var(--text-secondary)' : 'rgb(239, 68, 68)',
                  wordBreak: 'break-all',
                }}
              >
                {req.dryRunResult.success
                  ? '预演成功'
                  : `预演失败: ${req.dryRunResult.error?.message ?? 'unknown'}`}
              </div>
            )}

            {/* 二次确认提示（dangerous） */}
            {isConfirming && !answered && (
              <div
                style={{
                  padding: '4px 8px',
                  background: 'rgba(239, 68, 68, 0.1)',
                  borderRadius: 6,
                  fontSize: 10,
                  color: 'rgb(239, 68, 68)',
                  fontWeight: 500,
                }}
              >
                ⚠️ 此操作不可逆，确定要允许吗？
              </div>
            )}

            {/* 操作按钮 / 已处理状态 */}
            {!answered ? (
              <div
                style={{
                  display: 'flex',
                  gap: 8,
                  justifyContent: 'flex-end',
                }}
              >
                <button
                  type="button"
                  onClick={() => handleDeny(requestId)}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 4,
                    padding: '4px 12px',
                    background: 'transparent',
                    border: '1px solid rgba(239, 68, 68, 0.3)',
                    borderRadius: 9999,
                    fontSize: 11,
                    color: 'rgb(239, 68, 68)',
                    cursor: 'pointer',
                    fontFamily: 'inherit',
                    transition: 'background 0.15s ease',
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(239, 68, 68, 0.08)' }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
                >
                  <X size={11} />
                  拒绝
                </button>
                <button
                  type="button"
                  onClick={() => handleAllow(requestId, req)}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 4,
                    padding: '4px 12px',
                    background: isConfirming ? 'rgba(22, 163, 74, 0.1)' : 'transparent',
                    border: `1px solid ${isConfirming ? 'rgba(22, 163, 74, 0.5)' : 'rgba(22, 163, 74, 0.3)'}`,
                    borderRadius: 9999,
                    fontSize: 11,
                    color: 'rgb(22, 163, 74)',
                    cursor: 'pointer',
                    fontFamily: 'inherit',
                    transition: 'background 0.15s ease',
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(22, 163, 74, 0.08)' }}
                  onMouseLeave={(e) => {
                    if (!isConfirming) e.currentTarget.style.background = 'transparent'
                  }}
                >
                  <Check size={11} />
                  {isConfirming ? '确认允许' : '允许'}
                </button>
              </div>
            ) : (
              <div
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                  fontSize: 10,
                  color: response.approved ? 'rgb(22, 163, 74)' : 'rgb(239, 68, 68)',
                  fontWeight: 500,
                }}
              >
                {response.approved ? <Check size={11} /> : <X size={11} />}
                {response.approved ? '已允许' : '已拒绝'}
              </div>
            )}
          </div>
        )
      })}
    </>
  )
}
