import { ensureV2Ready, runIdbTransaction, upsertRecord } from '../db'
import type { VocabDeck } from '../../types'
import * as entitiesApi from '../../api/entities'
import { withFallback, getBackend } from '../../api/adapter'

const STORE = 'vocabDecks'

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

export async function saveVocabDeck(deck: VocabDeck): Promise<void> {
  await withFallback(
    async () => { await upsertEntity(deck.id, 'vocabDeck', deck) },
    async () => {
      await ensureV2Ready()
      await runIdbTransaction([STORE], 'readwrite', async (ctx) => {
        await upsertRecord(ctx, STORE, deck.id, deck)
      })
    },
  )
}

export async function getVocabDeckById(id: string): Promise<VocabDeck | undefined> {
  return withFallback(
    async () => {
      try {
        const entity = await entitiesApi.getEntity(id)
        return entity.data as unknown as VocabDeck
      } catch (err: unknown) {
        const e = err as { status?: number }
        if (e?.status === 404) return undefined
        throw err
      }
    },
    async () => {
      await ensureV2Ready()
      return runIdbTransaction([STORE], 'readonly', async (ctx) => {
        const record = await ctx.get<VocabDeck>(STORE, id)
        return record?.data
      })
    },
  )
}

export async function getAllVocabDecks(): Promise<VocabDeck[]> {
  return withFallback(
    async () => {
      const result = await entitiesApi.queryEntities({ type: 'vocabDeck' })
      return result.items.map(e => e.data as unknown as VocabDeck)
    },
    async () => {
      await ensureV2Ready()
      return runIdbTransaction([STORE], 'readonly', async (ctx) => {
        const result: VocabDeck[] = []
        await ctx.iterateStore<VocabDeck>(STORE, (record) => {
          result.push(record.data)
        })
        return result
      })
    },
  )
}

export async function getVocabDecksBySource(source: 'builtin' | 'custom'): Promise<VocabDeck[]> {
  return withFallback(
    async () => {
      const result = await entitiesApi.queryEntities({ type: 'vocabDeck' })
      return result.items.filter(e => e.data.source === source).map(e => e.data as unknown as VocabDeck)
    },
    async () => {
      await ensureV2Ready()
      return runIdbTransaction([STORE], 'readonly', async (ctx) => {
        const records = await ctx.indexGetAll<VocabDeck>(STORE, 'by_source', source)
        return records.map(r => r.data)
      })
    },
  )
}

export async function updateVocabDeck(
  id: string,
  partial: Partial<Omit<VocabDeck, 'id' | 'schemaVersion'>>,
): Promise<void> {
  if (getBackend() === 'api') {
    const entity = await entitiesApi.getEntity(id)
    const merged: VocabDeck = { ...(entity.data as unknown as VocabDeck), ...partial, schemaVersion: 1 }
    await upsertEntity(id, 'vocabDeck', merged, entity.panelId ?? undefined, entity.widgetId ?? undefined)
    return
  }
  await ensureV2Ready()
  await runIdbTransaction([STORE], 'readwrite', async (ctx) => {
    const existing = await ctx.get<VocabDeck>(STORE, id)
    if (!existing) {
      throw new Error(`vocabDeck not found: ${id}`)
    }
    const merged: VocabDeck = { ...existing.data, ...partial, schemaVersion: 1 }
    await upsertRecord(ctx, STORE, id, merged)
  })
}

export async function deleteVocabDeck(id: string): Promise<void> {
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
