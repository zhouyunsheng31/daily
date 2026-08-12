import { api } from './client'

export interface WidgetDTO {
  id: string
  panelId: string
  type: string
  x: number
  y: number
  width: number
  height: number
  zIndex: number
  minimized: boolean
  locked: boolean
  colorScheme: string | null
  state: Record<string, unknown>
  isPrimary?: boolean  // 新增：主AI助手标记（v4 C1 修复：全链路持久化）
  version: number
  createdAt: number
  updatedAt: number
}

export async function getPanelWidgets(panelId: string): Promise<WidgetDTO[]> {
  return api.get<WidgetDTO[]>(`/panels/${panelId}/widgets`)
}

export async function getWidget(id: string): Promise<WidgetDTO> {
  return api.get<WidgetDTO>(`/widgets/${id}`)
}

export async function createWidget(panelId: string, data: Partial<WidgetDTO> & { id?: string; type: string }): Promise<WidgetDTO> {
  return api.post<WidgetDTO>(`/panels/${panelId}/widgets`, data)
}

export async function updateWidget(id: string, data: Partial<WidgetDTO>): Promise<WidgetDTO> {
  return api.put<WidgetDTO>(`/widgets/${id}`, data)
}

/**
 * Phase 4: 单个 widget state 更新（带乐观锁，spec 2.5 节）
 * 服务器端 PUT /api/widgets/:id 当 expectedVersion 存在且为 state-only 更新时，
 * 校验 version，不匹配返回 409 + { conflict, currentVersion, currentState }
 */
export async function updateWidgetState(
  id: string,
  state: Record<string, unknown>,
  expectedVersion?: number,
): Promise<WidgetDTO> {
  const body: Record<string, unknown> = { state }
  if (expectedVersion !== undefined) {
    body.expectedVersion = expectedVersion
  }
  return api.put<WidgetDTO>(`/widgets/${id}`, body)
}

export async function deleteWidget(id: string): Promise<void> {
  await api.delete(`/widgets/${id}`)
}

export async function batchUpdatePositions(positions: Array<{ id: string; x: number; y: number; width: number; height: number; zIndex: number }>): Promise<void> {
  await api.put('/widgets/batch-positions', { positions })
}

export async function batchUpdateStates(widgets: Array<{ id: string; state: Record<string, unknown>; minimized?: boolean; locked?: boolean; colorScheme?: string | null }>): Promise<void> {
  await api.put('/widgets/batch-states', { widgets })
}
