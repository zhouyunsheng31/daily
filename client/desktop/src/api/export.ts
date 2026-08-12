import { api } from './client'

export async function exportAllData(): Promise<Record<string, unknown>> {
  return api.get('/export')
}

export async function importFromIdb(data: unknown): Promise<{ imported: Record<string, number>; errors: string[] }> {
  return api.post('/import/idb', data)
}

export async function importData(data: unknown): Promise<{ imported: Record<string, number> }> {
  return api.post('/import', data)
}
