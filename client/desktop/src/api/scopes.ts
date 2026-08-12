import { api } from './client'

export async function getAllScopes(): Promise<string[]> {
  return api.get<string[]>('/scopes')
}

export async function updateEntityScope(entityId: string, scope: string): Promise<void> {
  await api.put(`/scopes/entity/${entityId}`, { scope })
}

export async function mergeScopes(fromScope: string, toScope: string): Promise<{ moved: number }> {
  return api.post('/scopes/merge', { fromScope, toScope })
}

export async function splitScope(entityIds: string[], newScope: string): Promise<{ moved: number }> {
  return api.post('/scopes/split', { entityIds, newScope })
}
