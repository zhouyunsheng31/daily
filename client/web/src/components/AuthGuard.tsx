import { useEffect, useState, type ReactNode } from 'react'
import { useUserStore } from '../stores/useUserStore'
import { usePopupStore } from '../stores/usePopupStore'

type Status = 'checking' | 'authenticated' | 'unauthenticated' | 'network-error'

export default function AuthGuard({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>('checking')
  // 监听 useUserStore.isAuthenticated：登录成功（如 LoginPopup 提交后）时自动从 unauthenticated → authenticated
  const isAuthenticated = useUserStore(s => s.isAuthenticated)

  useEffect(() => {
    let cancelled = false
    let retryCount = 0
    const MAX_RETRY = 2

    const check = () => {
      fetch('/api/auth/me', { credentials: 'include' })
        .then((res) => {
          if (cancelled) return
          if (res.ok) {
            setStatus('authenticated')
            // Phase 4：同步用户信息到 useUserStore（用于 admin 判断、社区面板创建等）
            void useUserStore.getState().fetchCurrentUser()
          } else if (res.status === 401) {
            // 401 明确未鉴权 → 条件触发登录弹窗（spec §3.3：未登录时自动弹 LoginPopup）
            // 不再跳转路由，改为允许渲染画布但弹出登录窗
            setStatus('unauthenticated')
            triggerLoginPopup('请登录以继续')
          } else {
            // 5xx 等其他错误 → 视为服务器故障，重试
            if (retryCount < MAX_RETRY) {
              retryCount++
              setTimeout(check, 1000 * retryCount)
            } else {
              setStatus('network-error')
            }
          }
        })
        .catch(() => {
          // fetch 抛错 = 网络错误（服务器不可达）→ 重试
          if (cancelled) return
          if (retryCount < MAX_RETRY) {
            retryCount++
            setTimeout(check, 1000 * retryCount)
          } else {
            setStatus('network-error')
          }
        })
    }
    check()

    return () => {
      cancelled = true
    }
  }, [])

  // 监听 isAuthenticated 变化：
  // 当 AuthGuard 因 401 进入 unauthenticated 状态后，若用户在 LoginPopup 中登录成功，
  // useUserStore.isAuthenticated 会变为 true，此处自动将 status 切换为 authenticated。
  useEffect(() => {
    if (isAuthenticated && status === 'unauthenticated') {
      setStatus('authenticated')
    }
  }, [isAuthenticated, status])

  if (status === 'checking') {
    return <div className="min-h-screen flex items-center justify-center">验证中...</div>
  }
  if (status === 'network-error') {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <p className="text-red-500 mb-2">无法连接服务器</p>
          <button onClick={() => window.location.reload()} className="px-4 py-2 bg-blue-500 text-white rounded">
            重试
          </button>
        </div>
      </div>
    )
  }
  // unauthenticated / authenticated：均渲染 children
  // LoginPopup 由 App 顶层 <PopupsRoot /> 统一渲染（spec §3.3 条件触发）
  // 登录成功后由 dismissOnLoginSuccess() 关闭弹窗，本组件通过 isAuthenticated 监听自动更新
  return <>{children}</>
}

/**
 * 条件触发登录弹窗（spec §3.3：未登录时自动弹 LoginPopup）
 * 防重复：若已存在 login 类型弹出层，不再触发
 * closeOn 含 'login_success' 与 'manual'，允许用户手动关闭（避免在 Landing 页之外的入口被强制）
 */
function triggerLoginPopup(title: string): void {
  const { popups, showPopup } = usePopupStore.getState()
  if (popups.some(p => p.type === 'login')) return
  showPopup({
    popupType: 'login',
    title,
    closeOn: ['login_success', 'manual'],
    trigger: 'condition',
  })
}
