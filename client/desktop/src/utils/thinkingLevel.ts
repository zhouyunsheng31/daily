/**
 * 思考等级映射（Phase 9 批次 1 模块 5）
 *
 * 桌面端 4 档思考等级 + pi-coding-agent 原生 6 档映射。
 *
 * 设计依据（spec 8.6 已落地方案）：
 * - pi-coding-agent 原生支持 `createAgentSession({ thinkingLevel })` 参数
 * - pi 的 ThinkingLevel 共 6 档：'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh'
 *   （来源：server/node_modules/@earendil-works/pi-coding-agent/dist/core/settings-manager.d.ts:62
 *    + sdk.d.ts:22-23 createAgentSession({ thinkingLevel })）
 * - 桌面端对齐 pi 6 档中的 4 档（minimal/low/medium/high），省略 off 和 xhigh，
 *   保持语义清晰；pi 内部会根据 model 能力 clamp 到实际支持的等级
 *   （见 agent-session.d.ts:441 _clampThinkingLevel）
 *
 * 映射表（identity 映射，4 档直接对应 pi 4 档）：
 * | 桌面端  | pi ThinkingLevel |
 * |--------|-------------------|
 * | minimal | 'minimal'        |
 * | low     | 'low'            |
 * | medium  | 'medium'         |
 * | high    | 'high'           |
 */

/**
 * 桌面端 4 档思考等级常量（供 UI 代码按名引用）
 *
 * 与 union type `ThinkingLevel` 同名同值，用法：
 * - 类型注解：`level: ThinkingLevel`
 * - 具名常量：`ThinkingLevel.MINIMAL`
 * - 字面量：`'minimal'`（直接赋值给 ThinkingLevel 类型）
 */
export const ThinkingLevel = {
  MINIMAL: 'minimal',
  LOW: 'low',
  MEDIUM: 'medium',
  HIGH: 'high',
} as const

/**
 * 桌面端 4 档思考等级类型（字符串字面量联合）
 *
 * 取值：'minimal' | 'low' | 'medium' | 'high'
 */
export type ThinkingLevel = (typeof ThinkingLevel)[keyof typeof ThinkingLevel]

/**
 * pi-coding-agent 原生 ThinkingLevel 类型（6 档）
 *
 * 来源：
 * - server/node_modules/@earendil-works/pi-coding-agent/dist/core/settings-manager.d.ts:62
 *   `defaultThinkingLevel?: "off" | "minimal" | "low" | "medium" | "high" | "xhigh"`
 * - server/node_modules/@earendil-works/pi-coding-agent/dist/core/sdk.d.ts:22-23
 *   `createAgentSession({ thinkingLevel?: ThinkingLevel })`（ThinkingLevel 从 @earendil-works/pi-agent-core 导入）
 *
 * 桌面端不直接 import pi 的类型（pi-coding-agent 未在桌面端安装），
 * 而是本地定义等价类型，保证类型安全。
 */
export type PiThinkingLevel = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh'

// ============================================================================
// 映射表（const Record，避免 switch 穿透风险，tsconfig noFallthroughCasesInSwitch）
// ============================================================================

const PI_LEVEL_MAP: Record<ThinkingLevel, PiThinkingLevel> = {
  minimal: 'minimal',
  low: 'low',
  medium: 'medium',
  high: 'high',
}

const LEVEL_LABELS: Record<ThinkingLevel, string> = {
  minimal: '极简',
  low: '低',
  medium: '中',
  high: '高',
}

const LEVEL_DESCRIPTIONS: Record<ThinkingLevel, string> = {
  minimal: '极简思考（最快响应，不触发深度推理）',
  low: '低度思考（轻度推理）',
  medium: '中度思考（默认，平衡速度与质量）',
  high: '高度思考（最深度推理，适合复杂任务）',
}

/** 4 档顺序（供 UI 渲染：从极简到高） */
const ALL_LEVELS: ThinkingLevel[] = ['minimal', 'low', 'medium', 'high']

// ============================================================================
// 公开函数
// ============================================================================

/**
 * 桌面端 4 档 ThinkingLevel → pi-coding-agent 原生 PiThinkingLevel 映射
 *
 * identity 映射（桌面端 4 档直接对应 pi 6 档中的同名 4 档，省略 off/xhigh）。
 * pi-coding-agent 内部会根据 model 能力 clamp 到实际支持的等级。
 *
 * @param level 桌面端思考等级
 * @returns pi-coding-agent 原生 ThinkingLevel 字符串
 */
export function mapThinkingLevelToPi(level: ThinkingLevel): PiThinkingLevel {
  return PI_LEVEL_MAP[level]
}

/**
 * 获取思考等级的中文标签（供 UI 显示）
 *
 * @param level 桌面端思考等级
 * @returns 中文短标签（极简/低/中/高）
 */
export function getThinkingLevelLabel(level: ThinkingLevel): string {
  return LEVEL_LABELS[level]
}

/**
 * 获取思考等级的描述（供 UI tooltip / 帮助文本）
 *
 * @param level 桌面端思考等级
 * @returns 中文描述
 */
export function getThinkingLevelDescription(level: ThinkingLevel): string {
  return LEVEL_DESCRIPTIONS[level]
}

/**
 * 获取全部 4 档思考等级列表（供 UI 渲染选择器）
 *
 * 顺序：minimal → low → medium → high（从极简到高）
 *
 * @returns 4 档等级数组
 */
export function getAvailableThinkingLevels(): ThinkingLevel[] {
  return ALL_LEVELS
}
