// ============================================================================
// Phase 14.4：组件能力声明类型（server 本地副本）
// 注意：此文件是 shared/types/componentCapability.ts 的本地副本，
//       用于服务端 TypeScript 编译（rootDir: ./src 限制，不能引用 ../shared/）。
//       客户端继续使用 shared/types/componentCapability.ts（通过 Vite alias）。
//       修改其中一份时，请同步另一份。
// ============================================================================

/**
 * 单个组件提供的 API 项
 */
export interface ComponentApi {
  name: string
  description: string
  parameters?: Record<string, unknown>
}

/**
 * 组件能力声明类型
 * 与 server/src/db/schema.ts 的 component_capabilities 表结构对齐
 */
export interface ComponentCapability {
  /** 组件类型（widget_type，主键） */
  widgetType: string
  /** 显示名 */
  displayName: string
  /** 组件功能描述 */
  description: string
  /** 组件提供的 API 列表 */
  api: ComponentApi[]
  /** 依赖的本地服务名列表 */
  dependencies: string[]
  /** 组件版本号 */
  version: string
  /** 组件运行环境：纯前端 / 依赖本地服务 */
  componentEnv: 'pure-frontend' | 'local-dependent'
  /** 是否跨平台（Web + Desktop + Mobile） */
  crossPlatform: boolean
  /** 是否仅桌面端 */
  desktopOnly: boolean
}
