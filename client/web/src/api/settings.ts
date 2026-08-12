import { api } from './client'

export async function getSettings(): Promise<Record<string, unknown>> {
  return api.get<Record<string, unknown>>('/settings')
}

export async function updateSettings(settings: Record<string, unknown>): Promise<void> {
  await api.put('/settings', settings)
}
