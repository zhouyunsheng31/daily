/**
 * SyncFailedBanner — Phase S3 缺口 D：失败操作 UI 提示（spec 2.4 节）
 *
 * 当 useAppStore.syncFailedEntries 非空时，在顶部显示红色 banner，
 * 提示用户当前有同步操作失败。
 *
 * banner 功能：
 * - 显示失败数量 "有 N 个同步操作失败，点击查看"
 * - 点击展开失败列表（每条显示 entityType/entityId/operation/last_error + 重试次数）
 * - 每条失败支持"重试"（调 api/syncLogs.retrySyncLog）和"忽略"（标记 dismissed=true）
 * - 顶部"×"按钮可关闭当前 banner（dismissed 本地状态）
 * - 底部"全部清除"按钮清空所有失败记录
 *
 * 设计要点：
 * - 视觉风格参考 OfflineBanner（红色版，与离线 banner 黄色版区分）
 * - 使用 lucide-react 图标（AlertCircle / RefreshCw / Trash2 / ChevronDown / ChevronUp / X）
 * - 不阻塞用户操作（仅顶部提示条）
 * - 与 App.tsx 的 app-topbar 同级（在 topbar 上方，OfflineBanner 之下）
 * - S-4 修复：用 useEffect 监听 count 变化重置 dismissed（非 useState 反模式）
 *
 * 数据流：
 * - 服务端 sync_logs PUT status=failed → WS sync_failed 事件
 * - useAIStore.handleServerChange 'sync_failed' 分支 → useAppStore.addSyncFailedEntry
 * - SyncFailedBanner 订阅 useAppStore.syncFailedEntries 渲染
 */

import { useState, useEffect, memo, type ReactElement } from 'react'
import { AlertCircle, RefreshCw, Trash2, ChevronDown, ChevronUp, X } from 'lucide-react'
import { useAppStore } from '../stores/useAppStore'

function SyncFailedBannerImpl(): ReactElement | null {
  const failedEntries = useAppStore(s => s.syncFailedEntries)
  const clearAll = useAppStore(s => s.clearAllSyncFailedEntries)
  const dismiss = useAppStore(s => s.dismissSyncFailedEntry)
  const retry = useAppStore(s => s.retrySyncFailedEntry)

  const [expanded, setExpanded] = useState(false)
  const [dismissed, setDismissed] = useState(false)

  // 过滤掉已 dismiss 的条目（dismissed=true 但不删除，避免服务器再次推送时重复显示）
  const visibleEntries = failedEntries.filter(e => !e.dismissed)
  const count = visibleEntries.length

  // S-4 修复：count 变化时如果 > 0 重置 dismissed（用 useEffect 不用 useState 反模式）
  // 用户上次 dismiss 后若有新失败应再次提示
  useEffect(() => {
    if (count > 0) setDismissed(false)
  }, [count])

  if (count === 0 || dismissed) return null

  const handleRetry = (id: string): void => {
    // retrySyncFailedEntry 是 async 函数，调用时不 await（避免阻塞 UI）
    void retry(id)
  }

  const handleDismiss = (id: string): void => {
    dismiss(id)
  }

  const handleClearAll = (): void => {
    clearAll()
  }

  const handleToggleExpand = (): void => {
    setExpanded(prev => !prev)
  }

  const handleClose = (): void => {
    setDismissed(true)
  }

  return (
    <div
      className="sync-failed-banner"
      role="alert"
      aria-live="polite"
      style={{
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        background: 'linear-gradient(90deg, #fef2f2 0%, #fee2e2 100%)',
        borderBottom: '1px solid #ef4444',
        color: '#991b1b',
        fontSize: '13px',
        fontWeight: 500,
        animation: 'syncFailedBannerSlideDown 240ms ease-out',
      }}
    >
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '12px',
        padding: '8px 32px 8px 16px',
      }}>
        <AlertCircle size={16} aria-hidden="true" />
        <span>有 {count} 个同步操作失败，点击查看</span>
        <button
          type="button"
          onClick={handleToggleExpand}
          aria-label={expanded ? '收起失败列表' : '展开失败列表'}
          style={{
            marginLeft: '4px',
            padding: '3px 10px',
            background: '#991b1b',
            color: '#fff',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer',
            fontSize: '12px',
            fontWeight: 500,
            display: 'flex',
            alignItems: 'center',
            gap: 4,
          }}
        >
          {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
          {expanded ? '收起' : '展开'}
        </button>
        <button
          type="button"
          onClick={handleClose}
          aria-label="关闭提示"
          style={{
            position: 'absolute',
            right: '8px',
            top: '50%',
            transform: 'translateY(-50%)',
            padding: 2,
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            color: '#991b1b',
            opacity: 0.7,
            lineHeight: 0,
          }}
        >
          <X size={14} />
        </button>
      </div>

      {expanded && (
        <div style={{
          maxHeight: 300,
          overflowY: 'auto',
          padding: '8px 16px',
          borderTop: '1px solid #fca5a5',
          background: '#fef2f2',
        }}>
          {visibleEntries.map((entry) => (
            <div key={entry.id} style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '6px 8px',
              marginBottom: 4,
              background: '#fff',
              borderRadius: 4,
              border: '1px solid #fecaca',
              fontSize: 12,
            }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600 }}>
                  {entry.operation} {entry.entityType}/{entry.entityId} 失败
                </div>
                <div style={{ color: '#7f1d1d', fontSize: 11, marginTop: 2, wordBreak: 'break-word' }}>
                  {entry.lastError || '未知错误'}
                </div>
                <div style={{ color: '#9ca3af', fontSize: 10, marginTop: 2 }}>
                  重试 {entry.retryCount} 次 · 设备 {entry.deviceId.slice(0, 8)} · {new Date(entry.updatedAt).toLocaleString()}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 4, marginLeft: 8 }}>
                <button
                  type="button"
                  onClick={() => handleRetry(entry.id)}
                  title="重试"
                  style={{
                    padding: 4,
                    background: 'transparent',
                    border: '1px solid #dc2626',
                    borderRadius: 4,
                    cursor: 'pointer',
                    color: '#dc2626',
                    display: 'flex',
                  }}
                >
                  <RefreshCw size={12} />
                </button>
                <button
                  type="button"
                  onClick={() => handleDismiss(entry.id)}
                  title="忽略（不再显示此条）"
                  style={{
                    padding: 4,
                    background: 'transparent',
                    border: '1px solid #dc2626',
                    borderRadius: 4,
                    cursor: 'pointer',
                    color: '#dc2626',
                    display: 'flex',
                  }}
                >
                  <Trash2 size={12} />
                </button>
              </div>
            </div>
          ))}
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
            <button
              type="button"
              onClick={handleClearAll}
              style={{
                padding: '4px 10px',
                background: '#dc2626',
                color: '#fff',
                border: 'none',
                borderRadius: 4,
                cursor: 'pointer',
                fontSize: 12,
                fontWeight: 500,
              }}
            >
              全部清除
            </button>
          </div>
        </div>
      )}
      <style>{`
        @keyframes syncFailedBannerSlideDown {
          from {
            max-height: 0;
            opacity: 0;
            overflow: hidden;
          }
          to {
            max-height: 60px;
            opacity: 1;
          }
        }
      `}</style>
    </div>
  )
}

/**
 * memo 优化：仅在 syncFailedEntries / actions 引用变化时重新渲染
 * （actions 是 zustand action，引用稳定）
 */
export const SyncFailedBanner = memo(SyncFailedBannerImpl)
export default SyncFailedBanner
