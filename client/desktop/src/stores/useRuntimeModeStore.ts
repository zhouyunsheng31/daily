/**
 * RuntimeMode Store — Phase 9 批次 1 模块 8（离线降级）
 *
 * 与移动端 RuntimeModeManager.kt 对齐：
 * - 3 档用户选择模式（cloud / local / auto）
 * - 实际生效模式（cloud / local）
 * - 服务器在线状态 2s 防抖（避免弱网频繁切换）
 *
 * 设计参考：
 * - 移动端 RuntimeModeManager.kt:31-52（combine + debounce(2000)）
 * - 桌面端 useAIStore.ts 的 WS 重连退避逻辑（module-level timer）
 *
 * 持久化：mode 字段存 localStorage（key='runtime-mode'），
 * 与移动端 SharedPreferences 对齐。
 *
 * 注意：
 * - isServerOnline 默认 true（乐观假设：避免启动时 effectiveMode='local' 误走 local 路径，
 *   LocalAgentService 初始化需要 ~15s 加载 pi-coding-agent，在此期间 local 不可用。
 *   若 server 真不在线，WS/HTTP 检查会很快 setServerOnline(false) 切回 local）
 * - mode='auto' 默认（与移动端 _selectedMode 默认 AUTO 对齐）
 * - _debounceTimer 是 zustand state 字段但用下划线前缀标记为内部状态，
 *   组件不应通过 selector 订阅它（仅 setServerOnline 内部使用）
 */

import { create } from 'zustand'

// ============================================================================
// 类型定义
// ============================================================================

/** 用户选择的手动模式（与移动端 AgentMode 枚举对齐，但桌面端用小写字符串） */
export type RuntimeMode = 'cloud' | 'local' | 'auto'

/** 实际生效的模式（cloud 或 local，不含 auto） */
export type EffectiveRuntimeMode = 'cloud' | 'local'

// ============================================================================
// 常量
// ============================================================================

const RUNTIME_MODE_STORAGE_KEY = 'runtime-mode'

/** 防抖时长：2s（与移动端 wsClient.state.debounce(2000) 一致） */
const SERVER_ONLINE_DEBOUNCE_MS = 2000

// ============================================================================
// 持久化辅助
// ============================================================================

function loadPersistedMode(): RuntimeMode {
  if (typeof window === 'undefined') return 'auto'
  try {
    const raw = window.localStorage.getItem(RUNTIME_MODE_STORAGE_KEY)
    if (raw === 'cloud' || raw === 'local' || raw === 'auto') return raw
    return 'auto'
  } catch {
    return 'auto'
  }
}

function persistMode(mode: RuntimeMode): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(RUNTIME_MODE_STORAGE_KEY, mode)
  } catch (err) {
    console.error('[useRuntimeModeStore] persist mode failed:', err)
  }
}

// ============================================================================
// Store 接口
// ============================================================================

interface RuntimeModeStoreState {
  // ===== 公开状态 =====
  /** 用户选择的模式（持久化 localStorage） */
  mode: RuntimeMode
  /** 服务器在线状态（受 2s 防抖保护） */
  isServerOnline: boolean
  /** 实际生效的模式 */
  effectiveMode: EffectiveRuntimeMode
  /** 是否处于离线降级状态（mode='auto' 且 isServerOnline=false 时为 true） */
  isOfflineDowngraded: boolean

  // ===== 内部状态（不应被组件 selector 订阅） =====
  /** 防抖计时器，setServerOnline 内部使用 */
  _debounceTimer: ReturnType<typeof setTimeout> | null

  // ===== Actions =====
  /** 设置模式：持久化 + 重算 effectiveMode */
  setMode: (mode: RuntimeMode) => void
  /**
   * 设置服务器在线状态（2s 防抖）
   *
   * 每次调用都重置计时器，2s 内无新调用才真正更新 isServerOnline，
   * 避免弱网抖动导致 effectiveMode 频繁切换。
   *
   * 与移动端 wsClient.state.debounce(2000) 行为一致：
   * - 连续调用 setServerOnline(true) / setServerOnline(false) 交替时，
   *   只有最后一次调用后稳定 2s 才生效
   */
  setServerOnline: (online: boolean) => void
  /** 内部方法：重算 effectiveMode 和 isOfflineDowngraded */
  recomputeEffectiveMode: () => void
}

// ============================================================================
// Store 实现
// ============================================================================

function computeEffectiveMode(mode: RuntimeMode, isServerOnline: boolean): EffectiveRuntimeMode {
  // mode='cloud' / 'local' 时直接返回（用户显式选择，不自动降级）
  if (mode === 'cloud') return 'cloud'
  if (mode === 'local') return 'local'
  // mode='auto'：根据在线状态决定
  return isServerOnline ? 'cloud' : 'local'
}

function computeOfflineDowngraded(mode: RuntimeMode, isServerOnline: boolean): boolean {
  // 仅 'auto' 模式下离线才视为"降级"
  // （'cloud' 模式即使离线也不算降级，因为用户显式选择云端；
  //  'local' 模式无论在线离线都不算降级）
  return mode === 'auto' && !isServerOnline
}

// ============================================================================
// 标签辅助函数（Phase 9 批次 3 模块 7）
// ============================================================================

/**
 * 获取用户选择的模式（mode）的中文标签
 *
 * 用于 AgentModeSwitcher UI 显示当前选中的模式名称：
 * - 'cloud' → '云端'
 * - 'local' → '本地'
 * - 'auto'  → '自动'
 *
 * 与移动端 AgentMode.label 对齐（"云端" / "本地" / "自动"）
 */
export function getModeLabel(mode: RuntimeMode): string {
  switch (mode) {
    case 'cloud':
      return '云端'
    case 'local':
      return '本地'
    case 'auto':
      return '自动'
  }
}

/**
 * 获取实际生效模式（effectiveMode）的中文标签
 *
 * effectiveMode 只有 'cloud' / 'local' 两种值（auto 已被解析为 cloud/local）。
 *
 * 用途：
 * - AgentModeSwitcher 在 auto 模式下显示"自动 (云端)" / "自动 (本地)"
 * - OfflineBanner 显示"当前本地模式"提示
 * - SettingsPanel 显示当前生效模式
 */
export function getEffectiveModeLabel(effectiveMode: EffectiveRuntimeMode): string {
  return effectiveMode === 'cloud' ? '云端' : '本地'
}

export const useRuntimeModeStore = create<RuntimeModeStoreState>((set, get) => ({
  // ===== 初始状态 =====
  // 乐观假设 server 在线：避免启动时 effectiveMode='local' 导致误走 local 路径
  // （LocalAgentService 初始化需要 ~15s 加载 pi-coding-agent，在此期间 local 不可用）
  // 若 server 真不在线，WS/HTTP 检查会很快 setServerOnline(false) 切回 local
  mode: loadPersistedMode(),
  isServerOnline: true,
  effectiveMode: computeEffectiveMode(loadPersistedMode(), true),
  isOfflineDowngraded: computeOfflineDowngraded(loadPersistedMode(), true),
  _debounceTimer: null,

  // ===== Actions =====
  setMode: (mode: RuntimeMode): void => {
    persistMode(mode)
    const { isServerOnline } = get()
    set({
      mode,
      effectiveMode: computeEffectiveMode(mode, isServerOnline),
      isOfflineDowngraded: computeOfflineDowngraded(mode, isServerOnline),
    })
  },

  setServerOnline: (online: boolean): void => {
    const state = get()
    // 重置已有计时器
    if (state._debounceTimer) {
      clearTimeout(state._debounceTimer)
    }

    // 启动新的 2s 防抖计时器
    const timer = setTimeout(() => {
      // 2s 内无新调用，真正更新 isServerOnline 并重算
      const current = get()
      if (current.isServerOnline === online) {
        // 值未变化，仍要清理计时器引用（避免悬空 timer）
        set({ _debounceTimer: null })
        return
      }
      const newEffective = computeEffectiveMode(current.mode, online)
      const newDowngraded = computeOfflineDowngraded(current.mode, online)
      set({
        isServerOnline: online,
        effectiveMode: newEffective,
        isOfflineDowngraded: newDowngraded,
        _debounceTimer: null,
      })
    }, SERVER_ONLINE_DEBOUNCE_MS)

    set({ _debounceTimer: timer })
  },

  recomputeEffectiveMode: (): void => {
    const { mode, isServerOnline } = get()
    set({
      effectiveMode: computeEffectiveMode(mode, isServerOnline),
      isOfflineDowngraded: computeOfflineDowngraded(mode, isServerOnline),
    })
  },
}))
