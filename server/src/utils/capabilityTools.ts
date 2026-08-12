// ============================================================================
// Phase 14.4.4：query_capabilities 工具定义（spec 14.4.4 节）
// AI 可调用此工具查询所有组件的能力声明
// ============================================================================

import { Type } from 'typebox'
import type { ToolDefinition } from '@earendil-works/pi-coding-agent'
import { getPool } from '../db/connection.js'
import { rowToCapability } from './capabilityTypes.js'

/**
 * query_capabilities 工具
 *
 * 查询所有组件的能力声明（widgetType / displayName / description / api / dependencies）。
 * 用于 AI 在编排任务前了解可用组件及其能力，避免误调用不存在的组件 API。
 */
export const queryCapabilitiesTool: ToolDefinition = {
  name: 'query_capabilities',
  label: '查询组件能力',
  description:
    '查询所有组件的能力声明（widgetType / displayName / description / api / dependencies）。' +
    '在编排涉及组件的任务前调用此工具，了解可用组件及其能力。可指定 widgetType 查询单个组件。',
  parameters: Type.Object({
    widgetType: Type.Optional(
      Type.String({
        description: '指定组件类型（如 htmlCanvas），省略则列出所有组件能力',
      }),
    ),
  }),
  execute: async (_toolCallId, params, _signal, _onUpdate, _ctx) => {
    const pool = getPool()
    const widgetType = (params as { widgetType?: string }).widgetType
    const query = widgetType
      ? 'SELECT * FROM component_capabilities WHERE widget_type = $1'
      : 'SELECT * FROM component_capabilities ORDER BY widget_type'
    const result = await pool.query(query, widgetType ? [widgetType] : [])
    const capabilities = result.rows.map((r: any) => rowToCapability(r))
    return {
      content: [{ type: 'text', text: JSON.stringify(capabilities) }],
      details: {},
    }
  },
}
