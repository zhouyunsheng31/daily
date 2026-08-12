import { create } from 'zustand'
import { useAppStore } from './useAppStore'

// ============================================================================
// Phase 13.1.4：Onboarding 流程状态管理
// ----------------------------------------------------------------------------
// 6 步骤：0=Welcome / 1=Canvas / 2=AiAssistant / 3=Widget / 4=AiConfig / 5=Complete
// skip()/complete() 都会调 useAppStore.setHasCompletedOnboarding(true) 持久化到 IDB
// ============================================================================

export const ONBOARDING_TOTAL_STEPS = 6

export type AiProviderKey = 'deepseek' | 'openai' | 'anthropic' | 'google'

export interface OnboardingAiConfig {
  provider: AiProviderKey
  endpoint: string
  model: string
  apiKey: string
}

export interface OnboardingState {
  /** 当前步骤索引（0-4） */
  step: number
  /** AiConfigStep 表单状态（跨步骤保留，避免来回切换丢输入） */
  aiConfig: OnboardingAiConfig
  /** 测试连接状态：idle | testing | success | error */
  testStatus: 'idle' | 'testing' | 'success' | 'error'
  testMessage: string
  /** 步骤切换 */
  setStep: (step: number) => void
  next: () => void
  prev: () => void
  /** 跳过 onboarding（标记完成，不调 setApiKey） */
  skip: () => Promise<void>
  /** 完成 onboarding（标记完成；AiConfigStep 已调 setApiKey 时此函数仅标记完成） */
  complete: () => Promise<void>
  /** 更新 AiConfig 表单字段 */
  setAiConfig: (patch: Partial<OnboardingAiConfig>) => void
  /** 更新测试状态 */
  setTestStatus: (status: 'idle' | 'testing' | 'success' | 'error', message?: string) => void
}

export const useOnboardingStore = create<OnboardingState>((set, get) => ({
  step: 0,
  aiConfig: {
    provider: 'deepseek',
    endpoint: 'https://api.deepseek.com/v1/chat/completions',
    model: 'deepseek-v4-flash',
    apiKey: '',
  },
  testStatus: 'idle',
  testMessage: '',

  setStep: (step) => {
    const clamped = Math.max(0, Math.min(ONBOARDING_TOTAL_STEPS - 1, step))
    set({ step: clamped })
  },

  next: () => {
    const { step } = get()
    if (step < ONBOARDING_TOTAL_STEPS - 1) {
      set({ step: step + 1 })
    }
  },

  prev: () => {
    const { step } = get()
    if (step > 0) {
      set({ step: step - 1 })
    }
  },

  skip: async () => {
    // 跳过：仅标记完成，不调用 setApiKey
    await useAppStore.getState().setHasCompletedOnboarding(true)
  },

  complete: async () => {
    // 完成：AiConfigStep 已在自身 handleComplete 中调用 setApiKey + setActiveProvider
    // 此函数仅负责标记 onboarding 完成
    await useAppStore.getState().setHasCompletedOnboarding(true)
  },

  setAiConfig: (patch) => {
    set(state => ({ aiConfig: { ...state.aiConfig, ...patch } }))
  },

  setTestStatus: (status, message) => {
    set({ testStatus: status, testMessage: message ?? '' })
  },
}))
