import { ensureV2Ready, runIdbTransaction, upsertRecord } from '../db'
import type { VocabProgress } from '../../types'
import * as entitiesApi from '../../api/entities'
import { withFallback, getBackend } from '../../api/adapter'

const STORE = 'vocabProgress'

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

export async function saveVocabProgress(progress: VocabProgress): Promise<void> {
  await withFallback(
    async () => { await upsertEntity(progress.id, 'vocabProgress', progress) },
    async () => {
      await ensureV2Ready()
      await runIdbTransaction([STORE], 'readwrite', async (ctx) => {
        await upsertRecord(ctx, STORE, progress.id, progress)
      })
    },
  )
}

export async function getVocabProgressById(id: string): Promise<VocabProgress | undefined> {
  return withFallback(
    async () => {
      try {
        const entity = await entitiesApi.getEntity(id)
        return { ...(entity.data as unknown as VocabProgress), id: entity.id }
      } catch (err: unknown) {
        const e = err as { status?: number }
        if (e?.status === 404) return undefined
        throw err
      }
    },
    async () => {
      await ensureV2Ready()
      return runIdbTransaction([STORE], 'readonly', async (ctx) => {
        const record = await ctx.get<VocabProgress>(STORE, id)
        return record ? { ...record.data, id: record.id } : undefined
      })
    },
  )
}

export async function getVocabProgressByDeck(deckId: string): Promise<VocabProgress[]> {
  return withFallback(
    async () => {
      const result = await entitiesApi.queryEntities({ type: 'vocabProgress' })
      return result.items.filter(e => e.data.deckId === deckId).map(e => ({ ...(e.data as unknown as VocabProgress), id: e.id }))
    },
    async () => {
      await ensureV2Ready()
      return runIdbTransaction([STORE], 'readonly', async (ctx) => {
        const records = await ctx.indexGetAll<VocabProgress>(STORE, 'by_deckId', deckId)
        return records.map(r => ({ ...r.data, id: r.id }))
      })
    },
  )
}

export async function getVocabProgressByDeckAndStatus(
  deckId: string,
  status: VocabProgress['status'],
): Promise<VocabProgress[]> {
  return withFallback(
    async () => {
      const result = await entitiesApi.queryEntities({ type: 'vocabProgress' })
      return result.items
        .filter(e => e.data.deckId === deckId && e.data.status === status)
        .map(e => ({ ...(e.data as unknown as VocabProgress), id: e.id }))
    },
    async () => {
      await ensureV2Ready()
      return runIdbTransaction([STORE], 'readonly', async (ctx) => {
        const records = await ctx.indexGetAll<VocabProgress>(
          STORE,
          'by_deckId_status',
          IDBKeyRange.only([deckId, status]),
        )
        return records.map(r => ({ ...r.data, id: r.id }))
      })
    },
  )
}

export async function getDueVocabProgress(deckId: string, now: number): Promise<VocabProgress[]> {
  return withFallback(
    async () => {
      const result = await entitiesApi.queryEntities({ type: 'vocabProgress' })
      return result.items
        .filter(e => e.data.deckId === deckId && (e.data.nextReviewAt as number) <= now && e.data.status !== 'mastered')
        .map(e => ({ ...(e.data as unknown as VocabProgress), id: e.id }))
    },
    async () => {
      await ensureV2Ready()
      return runIdbTransaction([STORE], 'readonly', async (ctx) => {
        const records = await ctx.indexGetAll<VocabProgress>(
          STORE,
          'by_deckId_nextReviewAt',
          IDBKeyRange.bound([deckId, 0], [deckId, now]),
        )
        return records.filter(r => r.data.status !== 'mastered').map(r => ({ ...r.data, id: r.id }))
      })
    },
  )
}

export async function getAllDueVocabProgress(now: number): Promise<VocabProgress[]> {
  return withFallback(
    async () => {
      const result = await entitiesApi.queryEntities({ type: 'vocabProgress' })
      return result.items
        .filter(e => (e.data.nextReviewAt as number) <= now && e.data.status !== 'mastered')
        .map(e => ({ ...(e.data as unknown as VocabProgress), id: e.id }))
    },
    async () => {
      await ensureV2Ready()
      return runIdbTransaction([STORE], 'readonly', async (ctx) => {
        const records = await ctx.indexGetAll<VocabProgress>(
          STORE,
          'by_nextReviewAt',
          IDBKeyRange.upperBound(now),
        )
        return records.filter(r => r.data.status !== 'mastered').map(r => ({ ...r.data, id: r.id }))
      })
    },
  )
}

export async function getVocabProgressStats(deckId: string): Promise<{
  total: number
  new: number
  learning: number
  review: number
  mastered: number
  dueToday: number
}> {
  return withFallback(
    async () => {
      const result = await entitiesApi.queryEntities({ type: 'vocabProgress' })
      const items = result.items.filter(e => e.data.deckId === deckId)
      const now = Date.now()
      const stats = { total: 0, new: 0, learning: 0, review: 0, mastered: 0, dueToday: 0 }
      for (const e of items) {
        stats.total++
        const s = e.data.status as VocabProgress['status']
        if (s === 'new') stats.new++
        else if (s === 'learning') stats.learning++
        else if (s === 'review') stats.review++
        else if (s === 'mastered') stats.mastered++
        if (s !== 'mastered' && (e.data.nextReviewAt as number) <= now) stats.dueToday++
      }
      return stats
    },
    async () => {
      await ensureV2Ready()
      return runIdbTransaction([STORE], 'readonly', async (ctx) => {
        const all = await ctx.indexGetAll<VocabProgress>(STORE, 'by_deckId', deckId)
        const now = Date.now()
        const stats = { total: 0, new: 0, learning: 0, review: 0, mastered: 0, dueToday: 0 }
        for (const r of all) {
          stats.total++
          const s = r.data.status
          if (s === 'new') stats.new++
          else if (s === 'learning') stats.learning++
          else if (s === 'review') stats.review++
          else if (s === 'mastered') stats.mastered++
          if (s !== 'mastered' && r.data.nextReviewAt <= now) stats.dueToday++
        }
        return stats
      })
    },
  )
}

export async function updateVocabProgress(
  id: string,
  partial: Partial<Omit<VocabProgress, 'id' | 'schemaVersion'>>,
): Promise<void> {
  if (getBackend() === 'api') {
    const entity = await entitiesApi.getEntity(id)
    const merged: VocabProgress = { ...(entity.data as unknown as VocabProgress), ...partial, schemaVersion: 1 }
    await upsertEntity(id, 'vocabProgress', merged, entity.panelId ?? undefined, entity.widgetId ?? undefined)
    return
  }
  await ensureV2Ready()
  await runIdbTransaction([STORE], 'readwrite', async (ctx) => {
    const existing = await ctx.get<VocabProgress>(STORE, id)
    if (!existing) {
      throw new Error(`vocabProgress not found: ${id}`)
    }
    const merged: VocabProgress = { ...existing.data, ...partial, schemaVersion: 1 }
    await upsertRecord(ctx, STORE, id, merged)
  })
}

export async function deleteVocabProgress(id: string): Promise<void> {
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

/**
 * Phase 12 新增：全量读取 vocabProgress（用于本地搜索索引）。
 * 注意：与现有 getAllDueVocabProgress(now) 不同 ——
 *   - getAllDueVocabProgress(now): 只返回 nextReviewAt <= now 的到期 vocab
 *   - getAllVocabProgress(): 返回全部 vocab（不限 due 状态）
 *
 * 设计：直接走 runIdbTransaction 遍历 IDB store，不走 withFallback
 * （搜索索引需要本地全量数据，IDB 是真相源）
 */
export async function getAllVocabProgress(): Promise<VocabProgress[]> {
  await ensureV2Ready()
  return runIdbTransaction([STORE], 'readonly', async (ctx) => {
    const records: VocabProgress[] = []
    await ctx.iterateStore<VocabProgress>(STORE, (record) => {
      records.push(record.data as VocabProgress)
    })
    return records
  })
}
