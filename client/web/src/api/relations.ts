import { api } from './client'
import type { EntityDTO } from './entities'

export interface RelationDTO {
  id: string
  sourceId: string
  targetId: string
  type: string
  metadata: Record<string, unknown>
  createdAt: number
}

export interface ConnectedResult {
  relations: RelationDTO[]
  entities: EntityDTO[]
}

export async function queryRelations(params?: { sourceId?: string; targetId?: string; type?: string }): Promise<RelationDTO[]> {
  const searchParams: Record<string, string> = {}
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null) searchParams[k] = String(v)
    }
  }
  return api.get<RelationDTO[]>('/relations', searchParams)
}

export async function createRelation(data: { sourceId: string; targetId: string; type: string; metadata?: Record<string, unknown> }): Promise<RelationDTO> {
  return api.post<RelationDTO>('/relations', data)
}

export async function deleteRelation(id: string): Promise<void> {
  await api.delete(`/relations/${id}`)
}

export async function getEntityRelations(entityId: string): Promise<RelationDTO[]> {
  return api.get<RelationDTO[]>(`/relations/entity/${entityId}`)
}

export async function getConnectedEntities(entityId: string, depth: number = 1): Promise<ConnectedResult> {
  return api.get<ConnectedResult>(`/relations/entity/${entityId}/connected`, { depth: String(depth) })
}
