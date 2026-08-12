// S12.1-T3：Web 端路由版 App.tsx + store ref wiring + MainViewSync
// 改造自 S11 简单版（仅根据登录状态切换 Login/Home）
// 参考 spec §3.1 S12.1-T3 + 桌面端 App.tsx:52-70

import { useEffect } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import Login from './pages/Login'
import Settings from './pages/Settings'
import Admin from './pages/Admin'
import ShadowshubsPanel from './pages/ShadowshubsPanel'
import Workspace from './components/Workspace'
import MigrationPage from './components/MigrationPage'
import AuthGuard from './components/AuthGuard'
import TopRightEntry from './components/TopRightEntry'
import { PopupsRoot } from './components/PopupLayer'
import { useAppStore, setUseAIStoreRef } from './stores/useAppStore'
import { useAIStore, setUseAppStoreRef, registerAppStateProvider } from './stores/useAIStore'
import { useUserStore } from './stores/useUserStore'
import { usePopupStore } from './stores/usePopupStore'

// ============================================================================
// Phase 3: useAppStore ↔ useAIStore 循环依赖运行时接线
// 必须在模块顶层执行（参考桌面端 App.tsx:52-70）
// 不能放在组件内部，否则组件卸载后 ref 失效
// ============================================================================
setUseAIStoreRef(() => useAIStore)
setUseAppStoreRef(() => useAppStore)
registerAppStateProvider(() => {
  const s = useAppStore.getState()
  return {
    activePanelId: s.activePanelId,
    panelWidgets: s.panelWidgets,
    // S13 完整实现时补充其他字段
  }
})

// Phase 4：Admin 路由守卫 — 等待用户信息加载，非 admin 重定向到首页
function AdminGuard({ children }: { children: React.ReactNode }) {
  const user = useUserStore(s => s.user)
  const isSinglePasswordMode = useUserStore(s => s.isSinglePasswordMode)
  const isLoading = useUserStore(s => s.isLoading)

  // 若用户信息尚未加载（AuthGuard 异步 fetch 可能还在进行），主动触发一次
  useEffect(() => {
    if (!user && !isSinglePasswordMode && !isLoading) {
      void useUserStore.getState().fetchCurrentUser()
    }
  }, [user, isSinglePasswordMode, isLoading])

  // 单密码模式无用户身份，无权访问 admin
  if (isSinglePasswordMode) {
    return <Navigate to="/" replace />
  }
  // 用户信息尚未加载完，显示 loading
  if (!user) {
    return <div className="min-h-screen flex items-center justify-center">加载用户信息...</div>
  }
  if (user.role !== 'admin') {
    return <Navigate to="/" replace />
  }
  return <>{children}</>
}

export default function App() {
  useEffect(() => {
    // 先确认登录状态：让 initialize 能根据 isAuthenticated 决定是否进入游客模式
    // （后端 /api/panels 对未登录返回 200 + demo panel，不返回 401，
    //  因此 initialize 需在 getAllPanels 成功后主动检查登录状态）
    void (async () => {
      await useUserStore.getState().fetchCurrentUser()
      await useAppStore.getState().initialize()
    })()
    // T6：启动弹出层定时调度器（每 30 秒检查 scheduledPopups）
    // 幂等：内部会清理已有 timer，可重复调用（React StrictMode 双挂载安全）
    const stopScheduler = usePopupStore.getState().startScheduler()
    return () => {
      // 卸载时清理调度器
      stopScheduler()
    }
  }, [])
  return (
    <>
      {/* 全局右上角入口：未登录显示"登录"按钮，已登录显示用户菜单
          在 Workspace（/app, /panel/:id）和 Login（/login）路由下内部自动隐藏 */}
      <TopRightEntry />
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/migration" element={<MigrationPage />} />
        <Route path="/settings" element={<AuthGuard><Settings /></AuthGuard>} />
        <Route path="/admin" element={<AuthGuard><AdminGuard><Admin /></AdminGuard></AuthGuard>} />
        <Route path="/shadowshubs" element={<AuthGuard><ShadowshubsPanel /></AuthGuard>} />
        {/* 首页：直接显示画布工作区（游客可见，不包 AuthGuard）
            未登录用户由 useAppStore.initialize 的 401 回退加载展示面板（builtin-showcase）
            登录用户访问 / 仍会加载自己的面板（getAllPanels 成功） */}
        <Route path="/" element={<Workspace />} />
        {/* 画布工作区：移至 /app，受 AuthGuard 保护（未登录触发 LoginPopup） */}
        <Route path="/app" element={<AuthGuard><Workspace /></AuthGuard>} />
        <Route path="/panel/:panelId" element={<AuthGuard><Workspace /></AuthGuard>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      {/* 全局弹出层根：在 App 顶层统一渲染，确保任意路由触发 LoginPopup 等弹窗都能显示
          （原 AuthGuard 内部的 PopupsRoot 已移除以避免重复渲染） */}
      <PopupsRoot />
    </>
  )
}
