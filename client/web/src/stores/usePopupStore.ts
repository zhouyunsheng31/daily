// ============================================================================
// Phase 5：弹出层状态管理 store（spec §3.3）
//
// 管理弹出层（z-index 1000）的多个弹出项，支持：
// - 4 种触发模式：enter（进入时）/ condition（条件触发）/ timer（定时）/ manual（手动/AI 调用）
// - 关闭条件：login_success / manual / timer / ai_dismiss
// - 多个弹出层可叠加（数组管理，后入先出视觉排序）
//
// T6（定时触发）：scheduledPopups 数组 + startScheduler() 30秒轮询调度器
//   - 配置持久化到 localStorage，页面刷新后保留
//   - addScheduledPopup / removeScheduledPopup / toggleScheduledPopup
//
// T7（单次/重复弹出区分）：PopupConfig.once + shownOncePopups（localStorage 持久化）
//   - once=true 且调用方提供 id → 已显示过则跳过，显示后写入 shownOncePopups
//   - resetShownOncePopups() 供管理员重置
//
// AI 通过 show_popup / dismiss_popup 工具控制
// 登录窗口弹出层在用户未登录时可由条件触发自动弹出
// ============================================================================

import { create } from 'zustand'

export type PopupType = 'login' | 'html' | 'text' | 'image' | 'community_connect'
export type CloseCondition = 'login_success' | 'manual' | 'timer' | 'ai_dismiss'

/**
 * 弹出层配置（showPopup 入参 + ScheduledPopup.popupConfig 复用类型）
 *
 * T6：作为定时弹出配置的载体
 * T7：once + id 字段控制单次/重复
 *
 * §8.2/§9.4：community_connect 弹窗通过 onClose 回调把用户操作结果（skipped/connected）
 *           回传给调用方，由调用方决定是否创建面板。
 */
export interface PopupConfig {
  popupType: PopupType
  content?: string
  title?: string
  closeOn?: CloseCondition[]
  autoCloseMs?: number
  position?: { x?: number; y?: number }
  trigger?: PopupItem['trigger']
  /** T7: 调用方提供的稳定标识符，用于 once 跟踪。如未提供则运行时生成（不跨会话） */
  id?: string
  /** T7: 是否只显示一次（once=true 且已显示过 → 跳过）。默认 false=可重复 */
  once?: boolean
  /** §8.2/§9.4: 弹窗关闭/提交时回调（由弹窗组件自身在 _forceDismiss 前调用）。
   *  result 含 skipped/connected 等字段，类型由调用方约定。
   *  注意：用户点 X 手动取消时不会触发 onClose（视为放弃操作）。 */
  onClose?: (result?: unknown) => void
}

export interface PopupItem {
  id: string
  type: PopupType
  content: string
  title: string
  closeOn: CloseCondition[]
  autoCloseMs: number
  position: { x?: number; y?: number }
  createdAt: number
  /** 触发模式（用于日志/调试，不影响渲染） */
  trigger: 'enter' | 'condition' | 'timer' | 'manual'
  /** T7: 是否只显示一次（渲染参考，不影响行为） */
  once?: boolean
  /** T7: 稳定标识符（用于 shownOncePopups 跟踪，可选） */
  onceKey?: string
  /** §8.2/§9.4: 关闭/提交回调（由弹窗组件在主动结束时调用，X 取消不触发） */
  onClose?: (result?: unknown) => void
}

/**
 * T6: 定时弹出配置
 */
export interface ScheduledPopup {
  id: string
  popupConfig: PopupConfig
  /** 触发间隔（毫秒），最小 1000ms */
  intervalMs: number
  /** 上次显示时间戳；0 表示从未触发过（下次调度立即触发） */
  lastShown: number
  enabled: boolean
}

const SHOWN_ONCE_STORAGE_KEY = 'daily:popup:shownOnce'
const SCHEDULED_STORAGE_KEY = 'daily:popup:scheduled'

// ----------------------------------------------------------------------------
// localStorage 持久化辅助
// ----------------------------------------------------------------------------

function loadShownOnce(): Set<string> {
  try {
    const raw = typeof localStorage !== 'undefined'
      ? localStorage.getItem(SHOWN_ONCE_STORAGE_KEY)
      : null
    if (!raw) return new Set()
    const arr = JSON.parse(raw) as unknown
    if (!Array.isArray(arr)) return new Set()
    return new Set(arr.filter((x): x is string => typeof x === 'string'))
  } catch {
    return new Set()
  }
}

function saveShownOnce(set: Set<string>): void {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(SHOWN_ONCE_STORAGE_KEY, JSON.stringify([...set]))
    }
  } catch {
    // 隐私模式或配额满，忽略
  }
}

function loadScheduled(): ScheduledPopup[] {
  try {
    const raw = typeof localStorage !== 'undefined'
      ? localStorage.getItem(SCHEDULED_STORAGE_KEY)
      : null
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    // 基本字段校验，丢弃损坏项
    return parsed.filter((x): x is ScheduledPopup =>
      x != null &&
      typeof x === 'object' &&
      typeof (x as ScheduledPopup).id === 'string' &&
      typeof (x as ScheduledPopup).intervalMs === 'number' &&
      (x as ScheduledPopup).popupConfig != null
    )
  } catch {
    return []
  }
}

function saveScheduled(list: ScheduledPopup[]): void {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(SCHEDULED_STORAGE_KEY, JSON.stringify(list))
    }
  } catch {
    // 隐私模式或配额满，忽略
  }
}

interface PopupState {
  popups: PopupItem[]
  /** T6: 定时弹出配置列表（localStorage 持久化） */
  scheduledPopups: ScheduledPopup[]
  /** T7: 已显示过的 once 弹出 key 集合（localStorage 持久化） */
  shownOncePopups: Set<string>

  /** 显示弹出层，返回 popupId（若因 once 跳过则返回空串） */
  showPopup: (params: PopupConfig) => string

  /** 关闭指定弹出层（需含 ai_dismiss 或 manual 关闭条件） */
  dismissPopup: (popupId?: string) => number

  /** 内部使用：强制关闭（不受 closeOn 限制，用于登录成功等场景） */
  _forceDismiss: (popupId: string) => void

  /** 关闭所有含 login_success 条件的弹出层（登录成功时调用） */
  dismissOnLoginSuccess: () => void

  /** 判断弹出层是否可被 AI 关闭 */
  isDismissible: (popupId: string) => boolean

  /** T6: 添加定时弹出配置。返回 scheduledId */
  addScheduledPopup: (config: PopupConfig, intervalMs: number) => string
  /** T6: 移除定时弹出配置 */
  removeScheduledPopup: (id: string) => void
  /** T6: 启用/禁用定时弹出 */
  toggleScheduledPopup: (id: string, enabled: boolean) => void
  /** T6: 启动调度器（每 30 秒检查一次）。返回清理函数（幂等可重复调用） */
  startScheduler: () => () => void

  /** T7: 重置已显示过的 once 弹出集合（管理员用） */
  resetShownOncePopups: () => void
}

let popupIdCounter = 0
function genPopupId(): string {
  popupIdCounter += 1
  return `popup-${Date.now()}-${popupIdCounter}`
}

let scheduledIdCounter = 0
function genScheduledId(): string {
  scheduledIdCounter += 1
  return `sched-${Date.now()}-${scheduledIdCounter}`
}

// 模块级调度器 timer 引用（保证全局唯一，支持 HMR 重启）
let schedulerTimer: ReturnType<typeof setInterval> | null = null

export const usePopupStore = create<PopupState>((set, get) => ({
  popups: [],
  scheduledPopups: loadScheduled(),
  shownOncePopups: loadShownOnce(),

  showPopup: (params) => {
    // T7: 单次弹出检查
    if (params.once === true) {
      const onceKey = params.id
      if (onceKey) {
        if (get().shownOncePopups.has(onceKey)) {
          // 已显示过，跳过
          return ''
        }
      } else if (typeof console !== 'undefined' && console.warn) {
        console.warn('[usePopupStore] once=true 但未提供 id，无法跨会话去重；当次仍会显示。')
      }
    }

    const runtimeId = genPopupId()
    const popup: PopupItem = {
      id: runtimeId,
      type: params.popupType,
      content: params.content ?? '',
      title: params.title ?? '',
      closeOn: params.closeOn ?? ['manual'],
      autoCloseMs: params.autoCloseMs ?? 0,
      position: params.position ?? {},
      createdAt: Date.now(),
      trigger: params.trigger ?? 'manual',
      once: params.once,
      onceKey: params.id,
      onClose: params.onClose,
    }
    set((state) => ({ popups: [...state.popups, popup] }))

    // T7: 显示后记录到 shownOncePopups（仅当 once=true 且有 id）
    if (params.once === true && params.id) {
      const newSet = new Set(get().shownOncePopups)
      newSet.add(params.id)
      saveShownOnce(newSet)
      set({ shownOncePopups: newSet })
    }
    return runtimeId
  },

  dismissPopup: (popupId) => {
    if (!popupId) {
      // 关闭所有可被 AI 关闭的弹出层
      const dismissible = get().popups.filter(p =>
        p.closeOn.includes('ai_dismiss') || p.closeOn.includes('manual')
      )
      const dismissibleIds = new Set(dismissible.map(p => p.id))
      set((state) => ({ popups: state.popups.filter(p => !dismissibleIds.has(p.id)) }))
      return dismissible.length
    }
    // 关闭指定弹出层（需可被 AI 关闭）
    const target = get().popups.find(p => p.id === popupId)
    if (!target) return 0
    if (!target.closeOn.includes('ai_dismiss') && !target.closeOn.includes('manual')) {
      return 0  // 不可被 AI 关闭
    }
    set((state) => ({ popups: state.popups.filter(p => p.id !== popupId) }))
    return 1
  },

  _forceDismiss: (popupId) => {
    set((state) => ({ popups: state.popups.filter(p => p.id !== popupId) }))
  },

  dismissOnLoginSuccess: () => {
    set((state) => ({
      popups: state.popups.filter(p => !p.closeOn.includes('login_success')),
    }))
  },

  isDismissible: (popupId) => {
    const target = get().popups.find(p => p.id === popupId)
    if (!target) return false
    return target.closeOn.includes('ai_dismiss') || target.closeOn.includes('manual')
  },

  // T6: 定时弹出 ============================================================

  addScheduledPopup: (config, intervalMs) => {
    const id = genScheduledId()
    const safeInterval = Math.max(1000, Math.floor(intervalMs))
    const sched: ScheduledPopup = {
      id,
      // 强制 trigger=timer（调度器触发的弹出统一标记）
      popupConfig: { ...config, trigger: 'timer' },
      intervalMs: safeInterval,
      lastShown: 0, // 0 → 下次调度立即触发一次
      enabled: true,
    }
    const newList = [...get().scheduledPopups, sched]
    saveScheduled(newList)
    set({ scheduledPopups: newList })
    return id
  },

  removeScheduledPopup: (id) => {
    const newList = get().scheduledPopups.filter(s => s.id !== id)
    saveScheduled(newList)
    set({ scheduledPopups: newList })
  },

  toggleScheduledPopup: (id, enabled) => {
    const newList = get().scheduledPopups.map(s =>
      s.id === id ? { ...s, enabled } : s
    )
    saveScheduled(newList)
    set({ scheduledPopups: newList })
  },

  startScheduler: () => {
    // 幂等：清理已有 timer（也支持 HMR 重启 / 多次调用）
    if (schedulerTimer !== null) {
      clearInterval(schedulerTimer)
      // 不置 null，让旧 cleanup 函数通过 === 比较识别自己已失效
    }

    const tick = () => {
      const now = Date.now()
      const { scheduledPopups } = get()
      if (scheduledPopups.length === 0) return

      const dueIds: string[] = []
      const newList = scheduledPopups.map(s => {
        if (!s.enabled) return s
        if (now - s.lastShown >= s.intervalMs) {
          dueIds.push(s.id)
          return { ...s, lastShown: now }
        }
        return s
      })

      if (dueIds.length === 0) return

      // 先触发所有 due 的弹出（showPopup 内部会处理 once 跳过）
      const dueConfigs = newList
        .filter(s => dueIds.includes(s.id))
        .map(s => s.popupConfig)
      for (const cfg of dueConfigs) {
        get().showPopup(cfg)
      }

      // 再更新 lastShown
      saveScheduled(newList)
      set({ scheduledPopups: newList })
    }

    // 启动后立即检查一次（防止页面刷新后长时间未触发）
    tick()
    const myTimer = setInterval(tick, 30 * 1000)
    schedulerTimer = myTimer

    // cleanup 只清理自己启动的 timer（防止 App.tsx + PopupLayer 双调用时互相误杀）
    return () => {
      if (schedulerTimer === myTimer) {
        clearInterval(schedulerTimer)
        schedulerTimer = null
      }
    }
  },

  // T7: 单次弹出 ============================================================

  resetShownOncePopups: () => {
    const empty = new Set<string>()
    saveShownOnce(empty)
    set({ shownOncePopups: empty })
  },
}))
