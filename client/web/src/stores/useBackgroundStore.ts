// ============================================================================
// Phase 5：背景层状态管理 store（spec §3.2）
//
// 管理背景层的三个方面：
// 1. 背景本身（color/gradient/image）—— 固定视口，不参与相册缩放
// 2. 视觉特效（rain/snow/particles/stars）—— 叠加在背景之上
// 3. 基础组件（clock/text/image）—— 固定视口的基础组件
//
// AI 通过 set_background / add_effect / place_basic_component 工具控制
// ============================================================================

import { create } from 'zustand'

export type BackgroundType = 'color' | 'gradient' | 'image'
export type EffectType = 'none' | 'rain' | 'snow' | 'particles' | 'stars'
export type BasicComponentType = 'clock' | 'text' | 'image'

export interface BasicComponent {
  id: string
  type: BasicComponentType
  position: { x: number; y: number }
  config: Record<string, unknown>
}

interface BackgroundState {
  // 背景本身
  backgroundType: BackgroundType
  color: string
  gradient: string
  imageUrl: string
  // 视觉特效
  effect: EffectType
  effectConfig: Record<string, unknown>
  // 基础组件列表
  basicComponents: BasicComponent[]

  // Actions
  setBackground: (params: {
    type: BackgroundType
    color?: string
    gradient?: string
    imageUrl?: string
  }) => void
  addEffect: (params: {
    effect: EffectType
    config?: Record<string, unknown>
  }) => void
  removeEffect: () => void
  placeBasicComponent: (params: {
    componentType: BasicComponentType
    position: { x: number; y: number }
    config?: Record<string, unknown>
  }) => string  // returns componentId
  removeBasicComponent: (id: string) => void
  clearBasicComponents: () => void
}

// 默认浅色主题（匹配 v8 原型 --bg-canvas: #f5f5f7）
const DEFAULT_COLOR = '#f5f5f7'
const DEFAULT_GRADIENT = 'linear-gradient(135deg, #f5f5f7 0%, #e8e8f0 50%, #e5e5ea 100%)'

let componentIdCounter = 0
function genComponentId(): string {
  componentIdCounter += 1
  return `bg-comp-${Date.now()}-${componentIdCounter}`
}

export const useBackgroundStore = create<BackgroundState>((set, get) => ({
  backgroundType: 'color',
  color: DEFAULT_COLOR,
  gradient: DEFAULT_GRADIENT,
  imageUrl: '',
  effect: 'none',
  effectConfig: {},
  basicComponents: [],

  setBackground: (params) => {
    set({
      backgroundType: params.type,
      color: params.color ?? get().color,
      gradient: params.gradient ?? get().gradient,
      imageUrl: params.imageUrl ?? get().imageUrl,
    })
  },

  addEffect: (params) => {
    set({
      effect: params.effect,
      effectConfig: params.config ?? {},
    })
  },

  removeEffect: () => {
    set({ effect: 'none', effectConfig: {} })
  },

  placeBasicComponent: (params) => {
    const id = genComponentId()
    const component: BasicComponent = {
      id,
      type: params.componentType,
      position: params.position,
      config: params.config ?? {},
    }
    set((state) => ({ basicComponents: [...state.basicComponents, component] }))
    return id
  },

  removeBasicComponent: (id) => {
    set((state) => ({
      basicComponents: state.basicComponents.filter(c => c.id !== id),
    }))
  },

  clearBasicComponents: () => {
    set({ basicComponents: [] })
  },
}))
