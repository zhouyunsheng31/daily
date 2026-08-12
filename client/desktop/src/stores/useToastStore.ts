/**
 * Toast Store（Phase 7 批次2 任务3）
 *
 * 管理 toasts 数组，提供 showToast/updateToast/dismissToast。
 * 不在此处处理自动消失定时器（由 Toast 组件用 useEffect 管理，
 * 避免 store 持有 setTimeout 引用导致内存泄漏风险）。
 */
import { create } from 'zustand'
import { v4 as uuidv4 } from 'uuid'

export type ToastType = 'success' | 'error' | 'info' | 'loading'

export interface ToastItem {
  id: string
  type: ToastType
  message: string
  /** ms，0 表示不自动关闭；loading 默认不自动关闭 */
  duration?: number
}

export interface ToastStore {
  toasts: ToastItem[]
  /** 添加 toast，返回 id 供后续 update/dismiss */
  showToast: (toast: Omit<ToastItem, 'id'>) => string
  /** 更新已有 toast（如 loading → success） */
  updateToast: (id: string, updates: Partial<Omit<ToastItem, 'id'>>) => void
  /** 移除 toast */
  dismissToast: (id: string) => void
}

export const useToastStore = create<ToastStore>((set) => ({
  toasts: [],
  showToast: (toast) => {
    const id = uuidv4()
    set((state) => ({
      toasts: [...state.toasts, { ...toast, id }],
    }))
    return id
  },
  updateToast: (id, updates) => {
    set((state) => ({
      toasts: state.toasts.map((t) => (t.id === id ? { ...t, ...updates } : t)),
    }))
  },
  dismissToast: (id) => {
    set((state) => ({
      toasts: state.toasts.filter((t) => t.id !== id),
    }))
  },
}))
