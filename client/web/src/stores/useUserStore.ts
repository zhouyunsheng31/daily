// ============================================================================
// Phase 4：用户状态管理 store
// ============================================================================
// 管理：当前用户信息、登录状态、角色判断
// 与 useAppStore 分离，避免影响面板初始化逻辑
// ============================================================================

import { create } from 'zustand'
import * as authApi from '../api/auth'
import type { UserInfo, UserRole } from '../api/auth'

interface UserState {
  user: UserInfo | null
  /** 单密码模式（无用户身份，仅通过 WEB_ACCESS_PASSWORD 登录） */
  isSinglePasswordMode: boolean
  isAuthenticated: boolean
  isLoading: boolean
  /** 从 /api/auth/me 加载当前用户信息 */
  fetchCurrentUser: () => Promise<void>
  /** 注册并自动登录 */
  register: (username: string, email: string, password: string) => Promise<void>
  /** 登录（用户名/邮箱+密码，或单密码） */
  login: (params: { username?: string; email?: string; password: string }) => Promise<void>
  /** 登出 */
  logout: () => Promise<void>
  /** 便捷判断 */
  isAdmin: () => boolean
}

export const useUserStore = create<UserState>((set, get) => ({
  user: null,
  isSinglePasswordMode: false,
  isAuthenticated: false,
  isLoading: false,

  fetchCurrentUser: async () => {
    set({ isLoading: true })
    try {
      const me = await authApi.getMe()
      if (me.authenticated && !(me as { guest?: boolean }).guest) {
        // 真实用户或单密码模式登录
        set({
          user: me.user ?? null,
          isSinglePasswordMode: me.singlePassword === true,
          isAuthenticated: true,
          isLoading: false,
        })
      } else {
        // 未登录 或 游客 JWT（guest: true）：不标记为已认证用户
        // 游客身份由 useAppStore.isGuestMode 管理，此处保持未登录状态
        set({
          user: null,
          isSinglePasswordMode: false,
          isAuthenticated: false,
          isLoading: false,
        })
      }
    } catch {
      set({
        user: null,
        isSinglePasswordMode: false,
        isAuthenticated: false,
        isLoading: false,
      })
    }
  },

  register: async (username: string, email: string, password: string) => {
    const res = await authApi.register(username, email, password)
    set({
      user: {
        id: res.user.id,
        username: res.user.username,
        email: res.user.email,
        role: res.user.role,
        isBanned: false,
        createdAt: Date.now(),
        lastLoginAt: Date.now(),
      },
      isSinglePasswordMode: false,
      isAuthenticated: true,
    })
  },

  login: async (params) => {
    const res = await authApi.login(params)
    set({
      user: res.user ?? null,
      isSinglePasswordMode: res.singlePassword === true,
      isAuthenticated: true,
    })
  },

  logout: async () => {
    await authApi.logout()
    set({
      user: null,
      isSinglePasswordMode: false,
      isAuthenticated: false,
    })
  },

  isAdmin: () => {
    return get().user?.role === 'admin'
  },
}))

export type { UserInfo, UserRole }
