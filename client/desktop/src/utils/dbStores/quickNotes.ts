import { ensureV2Ready, runIdbTransaction, upsertRecord } from '../db'
import type { QuickNote } from '../../types'
import * as entitiesApi from '../../api/entities'
import { withFallback } from '../../api/adapter'

const STORE = 'quickNotes'

async function upsertEntity(id: string, type: string, data: unknown, panelId?: string, widgetId?: string) {
  try {
    return await entitiesApi.updateEntity(id, { data: data as Record<string, unknown>, panelId: panelId || null, widgetId: widgetId || null })
  } catch (err: unknown) {
    const e = err as { message?: string; status?: number }
    if (e?.message?.includes('not found') || e?.status === 404) {
      return await entitiesApi.createEntity({ id, type, scope: 'default', data: data as Record<string, unknown>, panelId: panelId || null, widgetId: widgetId || null })
    }
    throw err
  }
}

export async function saveQuickNote(quickNote: QuickNote): Promise<void> {
  await withFallback(
    async () => { await upsertEntity(quickNote.id, 'quickNote', quickNote) },
    async () => {
      await ensureV2Ready()
      await runIdbTransaction([STORE], 'readwrite', async (ctx) => {
        await upsertRecord(ctx, STORE, quickNote.id, quickNote)
      })
    },
  )
}

export async function getQuickNoteById(id: string): Promise<QuickNote | undefined> {
  return withFallback(
    async () => {
      try {
        const entity = await entitiesApi.getEntity(id)
        return entity.data as unknown as QuickNote
      } catch (err: unknown) {
        const e = err as { status?: number }
        if (e?.status === 404) return undefined
        throw err
      }
    },
    async () => {
      await ensureV2Ready()
      return runIdbTransaction([STORE], 'readonly', async (ctx) => {
        const record = await ctx.get<QuickNote>(STORE, id)
        return record?.data
      })
    },
  )
}

export async function getAllQuickNotes(): Promise<QuickNote[]> {
  return withFallback(
    async () => {
      const result = await entitiesApi.queryEntities({ type: 'quickNote' })
      return result.items.map(e => e.data as unknown as QuickNote)
    },
    async () => {
      await ensureV2Ready()
      return runIdbTransaction([STORE], 'readonly', async (ctx) => {
        const result: QuickNote[] = []
        await ctx.iterateStore<QuickNote>(STORE, (record) => {
          result.push(record.data)
        })
        return result
      })
    },
  )
}

export async function getQuickNotesByTag(tag: string): Promise<QuickNote[]> {
  return withFallback(
    async () => {
      const result = await entitiesApi.queryEntities({ type: 'quickNote' })
      return result.items.filter(e => (e.data.tags as string[] | undefined)?.includes(tag)).map(e => e.data as unknown as QuickNote)
    },
    async () => {
      await ensureV2Ready()
      return runIdbTransaction([STORE], 'readonly', async (ctx) => {
        const records = await ctx.indexGetAll<QuickNote>(STORE, 'by_tags', tag)
        return records.map(r => r.data)
      })
    },
  )
}

export async function deleteQuickNote(id: string): Promise<void> {
  await withFallback(
    () => entitiesApi.deleteEntity(id),
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
