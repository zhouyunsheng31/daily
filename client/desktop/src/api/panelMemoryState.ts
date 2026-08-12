import { api } from './client'

export interface PanelMemoryStateDTO {
  savedState: Record<string, unknown> | null
  savedAt: number | null
}

export async function getPanelMemoryState(panelId: string): Promise<PanelMemoryStateDTO> {
  return api.get<PanelMemoryStateDTO>(`/panels/${panelId}/memory-state`)
}

export async function savePanelMemoryState(
  panelId: string,
  savedState: Record<string, unknown>,
): Promise<{ ok: boolean; savedAt: number }> {
  return api.put<{ ok: boolean; savedAt: number }>(`/panels/${panelId}/memory-state`, { savedState })
}
