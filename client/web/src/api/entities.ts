import { api } from './client'

export interface EntityDTO {
  id: string
  type: string
  scope: string
  panelId: string | null
  widgetId: string | null
  data: Record<string, unknown>
  recordStatus: string
  version: number
  createdAt: number
  updatedAt: number
}

export interface EntityListResult {
  items: EntityDTO[]
  total: number
  limit: number
  offset: number
}

export async function queryEntities(params?: {
  type?: string
  scope?: string
  panelId?: string
  widgetId?: string
  recordStatus?: string
  limit?: number
  offset?: number
}): Promise<EntityListResult> {
  const searchParams: Record<string, string> = {}
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null) searchParams[k] = String(v)
    }
  }
  return api.get<EntityListResult>('/entities', searchParams)
}

export async function getEntity(id: string): Promise<EntityDTO> {
  return api.get<EntityDTO>(`/entities/${id}`)
}

export async function createEntity(data: { id?: string; type: string; scope?: string; panelId?: string | null; widgetId?: string | null; data: Record<string, unknown>; recordStatus?: string }): Promise<EntityDTO> {
  return api.post<EntityDTO>('/entities', data)
}

export async function updateEntity(id: string, data: Partial<Pick<EntityDTO, 'type' | 'scope' | 'panelId' | 'widgetId' | 'data' | 'recordStatus'>>): Promise<EntityDTO> {
  return api.put<EntityDTO>(`/entities/${id}`, data)
}

export async function deleteEntity(id: string): Promise<void> {
  await api.delete(`/entities/${id}`)
}

export async function batchCreateEntities(entities: Array<{ id?: string; type: string; scope?: string; panelId?: string | null; widgetId?: string | null; data: Record<string, unknown> }>): Promise<EntityDTO[]> {
  return api.post<EntityDTO[]>('/entities/batch', { entities })
}

export async function batchUpdateEntities(entities: Array<{ id: string } & Partial<Pick<EntityDTO, 'type' | 'scope' | 'panelId' | 'widgetId' | 'data' | 'recordStatus'>>>): Promise<void> {
  await api.put('/entities/batch', { entities })
}

export async function batchDeleteEntities(ids: string[]): Promise<void> {
  await api.delete('/entities/batch', { ids })
}
