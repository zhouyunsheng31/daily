// ============================================================================
// Phase 14.4：组件能力声明类型（spec 14.4.1 节）
// 服务端与客户端共享的类型定义，用于 component_capabilities 表 + AI 工具查询
// 注意：本文件只导出类型与 zod schema（客户端通过 Vite alias 解析 bare import）
// 服务端通过 `import type` 引用类型（编译时擦除，无运行时解析需求）
// ============================================================================

import { z } from 'zod'

/**
 * 单个组件提供的 API 项
 */
export const ComponentApiSchema = z.object({
  name: z.string(),
  description: z.string(),
  parameters: z.record(z.string(), z.unknown()).optional(),
})

/**
 * 组件能力声明 schema（zod）
 * 与 server/src/db/schema.ts 的 component_capabilities 表结构对齐
 */
export const ComponentCapabilitySchema = z.object({
  /** 组件类型（widget_type，主键） */
  widgetType: z.string(),
  /** 显示名 */
  displayName: z.string(),
  /** 组件功能描述 */
  description: z.string(),
  /** 组件提供的 API 列表 */
  api: z.array(ComponentApiSchema).default([]),
  /** 依赖的本地服务名列表 */
  dependencies: z.array(z.string()).default([]),
  /** 组件版本号 */
  version: z.string().default('1.0.0'),
  /** 组件运行环境：纯前端 / 依赖本地服务 */
  componentEnv: z.enum(['pure-frontend', 'local-dependent']).default('pure-frontend'),
  /** 是否跨平台（Web + Desktop + Mobile） */
  crossPlatform: z.boolean().default(true),
  /** 是否仅桌面端 */
  desktopOnly: z.boolean().default(false),
})

/** 组件能力声明类型（从 zod schema 推导） */
export type ComponentCapability = z.infer<typeof ComponentCapabilitySchema>

/** 单个组件 API 项类型 */
export type ComponentApi = z.infer<typeof ComponentApiSchema>
