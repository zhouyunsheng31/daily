import { api } from './client'

export interface DynamicWidgetDTO {
  widgetType: string
  displayName: string
  icon: string
  defaultLayout: Record<string, unknown>
  defaultState: Record<string, unknown>
  code: string
  // Phase 5 新增字段（schema 已就绪，API 补齐）
  componentEnv: 'pure-frontend' | 'local-dependent'
  localServices?: string[]
  crossPlatform: boolean
  desktopOnly: boolean
  createdAt: number
  updatedAt: number
}

export async function getAllDynamicWidgets(): Promise<DynamicWidgetDTO[]> {
  return api.get('/dynamic-widgets')
}

export async function createDynamicWidget(data: Partial<DynamicWidgetDTO> & { widgetType: string; displayName: string }): Promise<DynamicWidgetDTO> {
  return api.post('/dynamic-widgets', data)
}

export async function updateDynamicWidget(
  widgetType: string,
  data: Partial<Pick<DynamicWidgetDTO, 'componentEnv' | 'localServices' | 'crossPlatform' | 'desktopOnly' | 'displayName' | 'code'>>,
): Promise<DynamicWidgetDTO> {
  return api.put(`/dynamic-widgets/${widgetType}`, data)
}

export async function deleteDynamicWidget(widgetType: string): Promise<void> {
  await api.delete(`/dynamic-widgets/${widgetType}`)
}
