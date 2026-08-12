import { ensureV2Ready, runIdbTransaction, upsertRecord } from '../db'
import type { PanelTemplate } from '../../types'
import * as panelTemplatesApi from '../../api/panelTemplates'
import { withFallback, getBackend } from '../../api/adapter'

const STORE = 'panelTemplates'

export async function savePanelTemplate(template: PanelTemplate): Promise<void> {
  await withFallback(
    async () => {
      try {
        // panelTemplates 没有 update API，用 delete + create 模拟 upsert
        await panelTemplatesApi.deletePanelTemplate(template.id).catch(() => {})
        await panelTemplatesApi.createPanelTemplate({
          id: template.id,
          name: template.name,
          icon: template.icon || 'layout',
          description: template.description || '',
          widgets: template.widgets || [],
          isBuiltin: template.isBuiltin ?? false,
        })
      } catch (err: unknown) {
        const e = err as { message?: string }
        if (e?.message?.includes('not found')) {
          await panelTemplatesApi.createPanelTemplate({
            id: template.id,
            name: template.name,
            icon: template.icon || 'layout',
            description: template.description || '',
            widgets: template.widgets || [],
            isBuiltin: template.isBuiltin ?? false,
          })
        } else {
          throw err
        }
      }
    },
    async () => {
      await ensureV2Ready()
      await runIdbTransaction([STORE], 'readwrite', async (ctx) => {
        await upsertRecord(ctx, STORE, template.id, template)
      })
    },
  )
}

export async function getPanelTemplateById(id: string): Promise<PanelTemplate | undefined> {
  return withFallback(
    async () => {
      try {
        const templates = await panelTemplatesApi.getAllPanelTemplates()
        return templates.find(t => t.id === id) as PanelTemplate | undefined
      } catch {
        return undefined
      }
    },
    async () => {
      await ensureV2Ready()
      return runIdbTransaction([STORE], 'readonly', async (ctx) => {
        const record = await ctx.get<PanelTemplate>(STORE, id)
        return record?.data
      })
    },
  )
}

export async function getAllPanelTemplates(): Promise<PanelTemplate[]> {
  return withFallback(
    async () => {
      const templates = await panelTemplatesApi.getAllPanelTemplates()
      return templates.map(t => ({
        id: t.id,
        name: t.name,
        icon: t.icon,
        description: t.description,
        widgets: t.widgets,
        isBuiltin: t.isBuiltin,
        schemaVersion: 1,
      })) as PanelTemplate[]
    },
    async () => {
      await ensureV2Ready()
      return runIdbTransaction([STORE], 'readonly', async (ctx) => {
        const result: PanelTemplate[] = []
        await ctx.iterateStore<PanelTemplate>(STORE, (record) => {
          result.push(record.data)
        })
        return result
      })
    },
  )
}

export async function getBuiltinPanelTemplates(): Promise<PanelTemplate[]> {
  return withFallback(
    async () => {
      const templates = await panelTemplatesApi.getAllPanelTemplates()
      return templates.filter(t => t.isBuiltin).map(t => ({
        id: t.id,
        name: t.name,
        icon: t.icon,
        description: t.description,
        widgets: t.widgets,
        isBuiltin: t.isBuiltin,
        schemaVersion: 1,
      })) as PanelTemplate[]
    },
    async () => {
      await ensureV2Ready()
      return runIdbTransaction([STORE], 'readonly', async (ctx) => {
        const result: PanelTemplate[] = []
        await ctx.iterateStore<PanelTemplate>(STORE, (record) => {
          if (record.data.isBuiltin) {
            result.push(record.data)
          }
        })
        return result
      })
    },
  )
}

export async function updatePanelTemplate(
  id: string,
  partial: Partial<Omit<PanelTemplate, 'id' | 'schemaVersion'>>,
): Promise<void> {
  if (getBackend() === 'api') {
    // panelTemplates 没有 update API，先删后建
    await panelTemplatesApi.deletePanelTemplate(id)
    await panelTemplatesApi.createPanelTemplate({
      id,
      name: partial.name || '未命名模板',
      icon: partial.icon || 'layout',
      description: partial.description || '',
      widgets: partial.widgets || [],
      isBuiltin: partial.isBuiltin ?? false,
    })
    return
  }
  await ensureV2Ready()
  await runIdbTransaction([STORE], 'readwrite', async (ctx) => {
    const existing = await ctx.get<PanelTemplate>(STORE, id)
    if (!existing) {
      throw new Error(`panelTemplate not found: ${id}`)
    }
    const merged: PanelTemplate = { ...existing.data, ...partial, schemaVersion: 1 }
    await upsertRecord(ctx, STORE, id, merged)
  })
}

export async function deletePanelTemplate(id: string): Promise<void> {
  await withFallback(
    () => panelTemplatesApi.deletePanelTemplate(id),
    async () => {
      await ensureV2Ready()
      await runIdbTransaction([STORE], 'readwrite', async (ctx) => {
        const existing = await ctx.get(STORE, id)
        if (existing) {
          await ctx.deleteChecked(STORE, { id })
        }
      })
    },
  )
}
