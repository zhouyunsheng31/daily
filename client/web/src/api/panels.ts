import { api } from './client'
import type { WidgetDTO } from './widgets'

export interface PanelDTO {
  id: string
  name: string
  sortOrder: number
  settings: Record<string, unknown>
  canvasTransform: Record<string, unknown> | null
  ownerId: string | null
  isCommunity: boolean
  /** spec §9.4：外部社区 API 地址 */
  communityApiUrl: string | null
  createdAt: number
  updatedAt: number
}

export async function getAllPanels(): Promise<PanelDTO[]> {
  return api.get<PanelDTO[]>('/panels')
}

export async function getPanel(id: string): Promise<PanelDTO> {
  return api.get<PanelDTO>(`/panels/${id}`)
}

export async function createPanel(data: { id?: string; name: string; sortOrder?: number; settings?: Record<string, unknown>; canvasTransform?: Record<string, unknown> | null; isCommunity?: boolean; communityApiUrl?: string | null }): Promise<PanelDTO> {
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

/**
 * 获取展示面板（免鉴权）—— 游客模式回退数据源
 * 后端 GET /api/panels/demo 返回 builtin-showcase 面板 + 3 个展示 widgets
 * 返回结构：{ panel: PanelDTO, widgets: WidgetDTO[] }
 */
export async function getDemoPanel(): Promise<{ panel: PanelDTO; widgets: WidgetDTO[] }> {
  const res = await fetch('/api/panels/demo', { credentials: 'include' })
  if (!res.ok) throw new Error(`demo panel fetch failed: ${res.status}`)
  return res.json()
}
