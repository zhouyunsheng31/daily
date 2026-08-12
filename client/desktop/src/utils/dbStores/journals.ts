import { ensureV2Ready, runIdbTransaction, upsertRecord } from '../db'
import type { Journal } from '../../types'
import * as entitiesApi from '../../api/entities'
import { withFallback } from '../../api/adapter'

const STORE = 'journals'

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

export async function saveJournal(journal: Journal): Promise<void> {
  await withFallback(
    async () => { await upsertEntity(journal.id, 'journal', journal) },
    async () => {
      await ensureV2Ready()
      await runIdbTransaction([STORE], 'readwrite', async (ctx) => {
        await upsertRecord(ctx, STORE, journal.id, journal)
      })
    },
  )
}

export async function getJournalById(id: string): Promise<Journal | undefined> {
  return withFallback(
    async () => {
      try {
        const entity = await entitiesApi.getEntity(id)
        return entity.data as unknown as Journal
      } catch (err: unknown) {
        const e = err as { status?: number }
        if (e?.status === 404) return undefined
        throw err
      }
    },
    async () => {
      await ensureV2Ready()
      return runIdbTransaction([STORE], 'readonly', async (ctx) => {
        const record = await ctx.get<Journal>(STORE, id)
        return record?.data
      })
    },
  )
}

export async function getJournalsByDate(date: string): Promise<Journal[]> {
  return withFallback(
    async () => {
      const result = await entitiesApi.queryEntities({ type: 'journal' })
      return result.items.filter(e => e.data.date === date).map(e => e.data as unknown as Journal)
    },
    async () => {
      await ensureV2Ready()
      return runIdbTransaction([STORE], 'readonly', async (ctx) => {
        const records = await ctx.indexGetAll<Journal>(STORE, 'by_date', date)
        return records.map(r => r.data)
      })
    },
  )
}

export async function getAllJournals(): Promise<Journal[]> {
  return withFallback(
    async () => {
      const result = await entitiesApi.queryEntities({ type: 'journal' })
      return result.items.map(e => e.data as unknown as Journal)
    },
    async () => {
      await ensureV2Ready()
      return runIdbTransaction([STORE], 'readonly', async (ctx) => {
        const result: Journal[] = []
        await ctx.iterateStore<Journal>(STORE, (record) => {
          result.push(record.data)
        })
        return result
      })
    },
  )
}

export async function deleteJournal(id: string): Promise<void> {
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
