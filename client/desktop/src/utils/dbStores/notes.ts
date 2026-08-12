import { ensureV2Ready, runIdbTransaction, upsertRecord } from '../db'
import type { Note } from '../../types'
import * as entitiesApi from '../../api/entities'
import { withFallback } from '../../api/adapter'

const STORE = 'notes'

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

export async function saveNote(note: Note): Promise<void> {
  await withFallback(
    async () => { await upsertEntity(note.id, 'note', note) },
    async () => {
      await ensureV2Ready()
      await runIdbTransaction([STORE], 'readwrite', async (ctx) => {
        await upsertRecord(ctx, STORE, note.id, note)
      })
    },
  )
}

export async function getNoteById(id: string): Promise<Note | undefined> {
  return withFallback(
    async () => {
      try {
        const entity = await entitiesApi.getEntity(id)
        return entity.data as unknown as Note
      } catch (err: unknown) {
        const e = err as { status?: number }
        if (e?.status === 404) return undefined
        throw err
      }
    },
    async () => {
      await ensureV2Ready()
      return runIdbTransaction([STORE], 'readonly', async (ctx) => {
        const record = await ctx.get<Note>(STORE, id)
        return record?.data
      })
    },
  )
}

export async function getAllNotes(): Promise<Note[]> {
  return withFallback(
    async () => {
      const result = await entitiesApi.queryEntities({ type: 'note' })
      return result.items.map(e => e.data as unknown as Note)
    },
    async () => {
      await ensureV2Ready()
      return runIdbTransaction([STORE], 'readonly', async (ctx) => {
        const result: Note[] = []
        await ctx.iterateStore<Note>(STORE, (record) => {
          result.push(record.data)
        })
        return result
      })
    },
  )
}

export async function getNotesByTag(tag: string): Promise<Note[]> {
  return withFallback(
    async () => {
      const result = await entitiesApi.queryEntities({ type: 'note' })
      return result.items.filter(e => (e.data.tags as string[] | undefined)?.includes(tag)).map(e => e.data as unknown as Note)
    },
    async () => {
      await ensureV2Ready()
      return runIdbTransaction([STORE], 'readonly', async (ctx) => {
        const records = await ctx.indexGetAll<Note>(STORE, 'by_tags', tag)
        return records.map(r => r.data)
      })
    },
  )
}

export async function deleteNote(id: string): Promise<void> {
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
