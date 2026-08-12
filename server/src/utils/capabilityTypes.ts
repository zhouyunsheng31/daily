// ============================================================================
// Phase 14.4：服务端组件能力声明辅助函数
// 包含从数据库行（snake_case）到 ComponentCapability（camelCase）的转换
// 引用本地类型副本（server/src/types/componentCapability.ts），避免 rootDir 越界
// ============================================================================

import type { ComponentCapability } from '../types/componentCapability.js'

/**
 * 从数据库行（snake_case）转换为 ComponentCapability（camelCase）
 * 用于 query_capabilities 工具与 GET API 响应
 */
export function rowToCapability(row: {
  widget_type: string
  display_name: string
  description: string
  api: unknown
  dependencies: unknown
  version: string
  component_env: string
  cross_platform: boolean
  desktop_only: boolean
}): ComponentCapability {
  return {
    widgetType: row.widget_type,
    displayName: row.display_name,
    description: row.description,
    api: Array.isArray(row.api) ? (row.api as ComponentCapability['api']) : [],
    dependencies: Array.isArray(row.dependencies)
      ? (row.dependencies as string[])
      : [],
    version: row.version,
    componentEnv: (row.component_env as ComponentCapability['componentEnv']) ?? 'pure-frontend',
    crossPlatform: row.cross_platform,
    desktopOnly: row.desktop_only,
  }
}
