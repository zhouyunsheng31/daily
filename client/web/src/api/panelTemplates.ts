import { api } from './client'

export interface PanelTemplateDTO {
  id: string
  name: string
  icon: string
  description: string
  widgets: Array<{ widgetType: string; position: Record<string, unknown> }>
  isBuiltin: boolean
  createdAt: number
  updatedAt: number
}

export async function getAllPanelTemplates(): Promise<PanelTemplateDTO[]> {
  return api.get('/panel-templates')
}

export async function createPanelTemplate(data: Partial<PanelTemplateDTO> & { name: string }): Promise<PanelTemplateDTO> {
  return api.post('/panel-templates', data)
}

export async function deletePanelTemplate(id: string): Promise<void> {
  await api.delete(`/panel-templates/${id}`)
}
