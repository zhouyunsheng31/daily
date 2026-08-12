import { api } from './client'

export interface PanelDTO {
  id: string
  name: string
  sortOrder: number
  settings: Record<string, unknown>
  canvasTransform: Record<string, unknown> | null
  createdAt: number
  updatedAt: number
}

export async function getAllPanels(): Promise<PanelDTO[]> {
  return api.get<PanelDTO[]>('/panels')
}

export async function getPanel(id: string): Promise<PanelDTO> {
  return api.get<PanelDTO>(`/panels/${id}`)
}

export async function createPanel(data: { id?: string; name: string; sortOrder?: number; settings?: Record<string, unknown>; canvasTransform?: Record<string, unknown> | null }): Promise<PanelDTO> {
  return api.post<PanelDTO>('/panels', data)
}

export async function updatePanel(id: string, data: Partial<Pick<PanelDTO, 'name' | 'sortOrder' | 'settings' | 'canvasTransform'>>): Promise<PanelDTO> {
  return api.put<PanelDTO>(`/panels/${id}`, data)
}

export async function deletePanel(id: string): Promise<void> {
  await api.delete(`/panels/${id}`)
}

export async function reorderPanels(panelIds: string[]): Promise<void> {
  await api.put('/panels/reorder', { panelIds })
}

export async function getActivePanelId(): Promise<string | null> {
  const res = await api.get<{ activePanelId: string | null }>('/panels/active')
  return res.activePanelId
}

export async function setActivePanelId(id: string | null): Promise<void> {
  await api.put('/panels/active', { activePanelId: id })
}
