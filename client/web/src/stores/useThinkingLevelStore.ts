/**
 * 思考等级 Store（Phase 9 批次 1 模块 5）
 *
 * 管理当前思考等级 + 用户默认思考等级，持久化到 localStorage。
 *
 * 设计依据：
 * - currentLevel：当前会话生效的思考等级（运行时可切换，持久化以便重启后保留）
 * - defaultLevel：用户在设置面板配置的默认值（新会话 / 应用启动时的初始值）
 *
 * 持久化 key（与 spec 3.6.3 SettingsPanel 对齐）：
 * - 'ai-thinking-level'：当前思考等级
 * - 'ai-thinking-level-default'：默认思考等级
 *
 * LocalAgentService 通过 getPiThinkingLevel() 获取映射后的 pi 原生 ThinkingLevel，
 * 传入 createAgentSession({ thinkingLevel })。
 */
import { create } from 'zustand'
import { mapThinkingLevelToPi, type ThinkingLevel, type PiThinkingLevel } from '../utils/thinkingLevel'

// ============================================================================
// localStorage 持久化辅助
// ============================================================================

const STORAGE_KEY_CURRENT = 'ai-thinking-level'
const STORAGE_KEY_DEFAULT = 'ai-thinking-level-default'
const DEFAULT_LEVEL: ThinkingLevel = 'medium'

/** 4 档合法值集合（用于校验 localStorage 读取值的合法性） */
const VALID_LEVELS: ReadonlySet<ThinkingLevel> = new Set<ThinkingLevel>([
  'minimal',
  'low',
  'medium',
  'high',
])

/**
 * 从 localStorage 读取思考等级，校验合法性后返回；非法或缺失时返回 fallback。
 *
 * 与 useAppStore 的 loadLayoutSizes / loadHomeTemplateFromStorage 模式一致：
 * - typeof window === 'undefined' 时走 fallback（SSR / 主进程 import 防护）
 * - JSON.parse 失败时静默降级（隐私模式 / 存储损坏）
 */
function loadLevelFromStorage(key: string, fallback: ThinkingLevel): ThinkingLevel {
  if (typeof window === 'undefined') return fallback
  try {
    const raw = window.localStorage.getItem(key)
    if (!raw) return fallback
    // localStorage 存的是字符串字面量（如 'medium'），直接校验
    if (VALID_LEVELS.has(raw as ThinkingLevel)) {
      return raw as ThinkingLevel
    }
    console.warn(`[useThinkingLevelStore] invalid value in localStorage "${key}": ${raw}, falling back to ${fallback}`)
    return fallback
  } catch {
    return fallback
  }
}

function saveLevelToStorage(key: string, level: ThinkingLevel): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(key, level)
  } catch (err) {
    console.error(`[useThinkingLevelStore] failed to persist level to "${key}":`, err)
  }
}

// ============================================================================
// Store 类型定义
// ============================================================================

interface ThinkingLevelState {
  /** 当前生效的思考等级（运行时可切换，持久化到 localStorage） */
  currentLevel: ThinkingLevel
  /** 用户配置的默认思考等级（从 localStorage 读取，供新会话初始化） */
  defaultLevel: ThinkingLevel

  /** 设置当前思考等级 + 持久化 localStorage */
  setLevel: (level: ThinkingLevel) => void
  /** 设置默认思考等级 + 持久化 localStorage */
  setDefaultLevel: (level: ThinkingLevel) => void
  /**
   * 获取映射到 pi-coding-agent 原生的 ThinkingLevel（供 LocalAgentService 使用）。
   * 返回 mapThinkingLevelToPi(currentLevel)。
   */
  getPiThinkingLevel: () => PiThinkingLevel
}

// ============================================================================
// Store 实现
// ============================================================================

export const useThinkingLevelStore = create<ThinkingLevelState>((set, get) => ({
  // 初始化：从 localStorage 读取（fallback 'medium'）
  currentLevel: loadLevelFromStorage(STORAGE_KEY_CURRENT, DEFAULT_LEVEL),
  defaultLevel: loadLevelFromStorage(STORAGE_KEY_DEFAULT, DEFAULT_LEVEL),

  setLevel: (level: ThinkingLevel) => {
    saveLevelToStorage(STORAGE_KEY_CURRENT, level)
    set({ currentLevel: level })
  },

  setDefaultLevel: (level: ThinkingLevel) => {
    saveLevelToStorage(STORAGE_KEY_DEFAULT, level)
    set({ defaultLevel: level })
  },

  getPiThinkingLevel: (): PiThinkingLevel => {
    return mapThinkingLevelToPi(get().currentLevel)
  },
}))
