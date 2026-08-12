/**
 * Toast 组件（Phase 7 批次2 任务3）
 *
 * 固定在屏幕右下角，支持 success/error/info/loading 四种类型。
 * 自动消失（默认 3000ms，loading 不自动消失，duration=0 表示不消失）。
 * 动画：从右滑入，淡出消失。
 *
 * 用法：在 App.tsx 根 div 内最外层渲染 <Toast />，全局任意位置调用
 * useToastStore.getState().showToast({ type, message }) 即可。
 */
import { useEffect, useState } from 'react'
import { CheckCircle, XCircle, Info, Loader2, X } from 'lucide-react'
import { useToastStore, type ToastItem } from '../stores/useToastStore'

/** 默认自动消失时长（ms） */
const DEFAULT_DURATION = 3000
/** 淡出动画时长（ms），与 CSS 中 .toast-item--leaving 的 transition 时长一致 */
const EXIT_ANIMATION_MS = 200

/** 单个 Toast 项 */
function ToastItemView({ toast }: { toast: ToastItem }) {
  const dismissToast = useToastStore((s) => s.dismissToast)
  const [leaving, setLeaving] = useState(false)

  // 自动消失定时器：loading 不消失；duration=0 不消失
  // 当 type 从 loading 变成其他类型时（updateToast 触发），重新启动定时器
  // 同时重置 leaving 状态（避免淡出中更新 type 导致 toast 一直处于淡出态）
  useEffect(() => {
    setLeaving(false)
    if (toast.type === 'loading') return
    const duration = toast.duration ?? DEFAULT_DURATION
    if (duration <= 0) return

    // 在 duration - EXIT_ANIMATION_MS 时开始淡出，duration 时移除
    const exitAt = Math.max(duration - EXIT_ANIMATION_MS, 0)
    const exitTimer = setTimeout(() => setLeaving(true), exitAt)
    const dismissTimer = setTimeout(() => dismissToast(toast.id), duration)

    return () => {
      clearTimeout(exitTimer)
      clearTimeout(dismissTimer)
    }
  }, [toast.id, toast.type, toast.duration, dismissToast])

  // 手动关闭：先淡出再移除
  const handleClose = () => {
    setLeaving(true)
    setTimeout(() => dismissToast(toast.id), EXIT_ANIMATION_MS)
  }

  // 图标 + 颜色按类型映射
  const iconNode = (() => {
    switch (toast.type) {
      case 'success':
        return <CheckCircle size={16} color="var(--color-success)" />
      case 'error':
        return <XCircle size={16} color="var(--color-error)" />
      case 'info':
        return <Info size={16} color="var(--color-info)" />
      case 'loading':
        return <Loader2 size={16} color="var(--color-primary)" className="animate-spin" />
    }
  })()

  return (
    <div
      className={`toast-item toast-item--${toast.type}${leaving ? ' toast-item--leaving' : ''}`}
      role="status"
    >
      <span className="toast-item__icon">{iconNode}</span>
      <span className="toast-item__message">{toast.message}</span>
      {/* loading 类型不显示关闭按钮（避免用户误关闭正在进行的操作反馈） */}
      {toast.type !== 'loading' && (
        <button
          className="toast-item__close"
          onClick={handleClose}
          aria-label="关闭"
          title="关闭"
        >
          <X size={12} />
        </button>
      )}
    </div>
  )
}

/** Toast 容器（固定右下角） */
export default function Toast() {
  const toasts = useToastStore((s) => s.toasts)

  if (toasts.length === 0) return null

  return (
    <div className="toast-container" aria-live="polite">
      {toasts.map((toast) => (
        <ToastItemView key={toast.id} toast={toast} />
      ))}
    </div>
  )
}
