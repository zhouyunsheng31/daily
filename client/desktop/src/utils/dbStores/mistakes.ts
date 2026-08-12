import { ensureV2Ready, runIdbTransaction, upsertRecord } from '../db'
import type { Mistake } from '../../types'
import * as entitiesApi from '../../api/entities'
import { withFallback, getBackend } from '../../api/adapter'

const STORE = 'mistakes'

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

export async function saveMistake(mistake: Mistake): Promise<void> {
  await withFallback(
    async () => { await upsertEntity(mistake.id, 'mistake', mistake) },
    async () => {
      await ensureV2Ready()
      await runIdbTransaction([STORE], 'readwrite', async (ctx) => {
        await upsertRecord(ctx, STORE, mistake.id, mistake)
      })
    },
  )
}

export async function getMistakeById(id: string): Promise<Mistake | undefined> {
  return withFallback(
    async () => {
      try {
        const entity = await entitiesApi.getEntity(id)
        return entity.data as unknown as Mistake
      } catch (err: unknown) {
        const e = err as { status?: number }
        if (e?.status === 404) return undefined
        throw err
      }
    },
    async () => {
      await ensureV2Ready()
      return runIdbTransaction([STORE], 'readonly', async (ctx) => {
        const record = await ctx.get<Mistake>(STORE, id)
        return record?.data
      })
    },
  )
}

export async function getAllMistakes(): Promise<Mistake[]> {
  return withFallback(
    async () => {
      const result = await entitiesApi.queryEntities({ type: 'mistake' })
      return result.items.map(e => e.data as unknown as Mistake)
    },
    async () => {
      await ensureV2Ready()
      return runIdbTransaction([STORE], 'readonly', async (ctx) => {
        const result: Mistake[] = []
        await ctx.iterateStore<Mistake>(STORE, (record) => {
          result.push(record.data)
        })
        return result
      })
    },
  )
}

export async function getMistakesByPanel(panelId: string): Promise<Mistake[]> {
  return withFallback(
    async () => {
      const result = await entitiesApi.queryEntities({ type: 'mistake', panelId })
      return result.items.map(e => e.data as unknown as Mistake)
    },
    async () => {
      await ensureV2Ready()
      return runIdbTransaction([STORE], 'readonly', async (ctx) => {
        const records = await ctx.indexGetAll<Mistake>(STORE, 'by_panelId', panelId)
        return records.map(r => r.data)
      })
    },
  )
}

export async function getMistakesBySourceType(sourceType: string): Promise<Mistake[]> {
  return withFallback(
    async () => {
      const result = await entitiesApi.queryEntities({ type: 'mistake' })
      return result.items.filter(e => e.data.sourceType === sourceType).map(e => e.data as unknown as Mistake)
    },
    async () => {
      await ensureV2Ready()
      return runIdbTransaction([STORE], 'readonly', async (ctx) => {
        const records = await ctx.indexGetAll<Mistake>(STORE, 'by_sourceType', sourceType)
        return records.map(r => r.data)
      })
    },
  )
}

export async function findMistakeBySourceAndQuestion(sourceId: string, questionId: string): Promise<Mistake | undefined> {
  return withFallback(
    async () => {
      const result = await entitiesApi.queryEntities({ type: 'mistake' })
      const found = result.items.find(e => e.data.sourceId === sourceId && e.data.questionId === questionId)
      return found ? (found.data as unknown as Mistake) : undefined
    },
    async () => {
      await ensureV2Ready()
      return runIdbTransaction([STORE], 'readonly', async (ctx) => {
        const records = await ctx.indexGetAll<Mistake>(
          STORE,
          'by_sourceId_questionId',
          IDBKeyRange.only([sourceId, questionId]),
        )
        return records.length > 0 ? records[0].data : undefined
      })
    },
  )
}

export async function getDueMistakes(now: number): Promise<Mistake[]> {
  return withFallback(
    async () => {
      const result = await entitiesApi.queryEntities({ type: 'mistake' })
      return result.items
        .filter(e => (e.data.nextReviewAt as number) <= now && e.data.status !== 'mastered')
        .map(e => e.data as unknown as Mistake)
    },
    async () => {
      await ensureV2Ready()
      return runIdbTransaction([STORE], 'readonly', async (ctx) => {
        const records = await ctx.indexGetAll<Mistake>(
          STORE,
          'by_nextReviewAt',
          IDBKeyRange.upperBound(now),
        )
        return records.filter(r => r.data.status !== 'mastered').map(r => r.data)
      })
    },
  )
}

export async function getMistakesByStatus(status: Mistake['status']): Promise<Mistake[]> {
  return withFallback(
    async () => {
      const result = await entitiesApi.queryEntities({ type: 'mistake' })
      return result.items.filter(e => e.data.status === status).map(e => e.data as unknown as Mistake)
    },
    async () => {
      await ensureV2Ready()
      return runIdbTransaction([STORE], 'readonly', async (ctx) => {
        const records = await ctx.indexGetAll<Mistake>(STORE, 'by_status', status)
        return records.map(r => r.data)
      })
    },
  )
}

export async function getMistakeStats(): Promise<{
  total: number
  new: number
  learning: number
  review: number
  mastered: number
  dueToday: number
}> {
  return withFallback(
    async () => {
      const result = await entitiesApi.queryEntities({ type: 'mistake' })
      const stats = { total: 0, new: 0, learning: 0, review: 0, mastered: 0, dueToday: 0 }
      const now = Date.now()
      for (const e of result.items) {
        stats.total++
        const s = e.data.status as Mistake['status']
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
        const stats = { total: 0, new: 0, learning: 0, review: 0, mastered: 0, dueToday: 0 }
        const now = Date.now()
        await ctx.iterateStore<Mistake>(STORE, (record) => {
          stats.total++
          const s = record.data.status
          if (s === 'new') stats.new++
          else if (s === 'learning') stats.learning++
          else if (s === 'review') stats.review++
          else if (s === 'mastered') stats.mastered++
          if (s !== 'mastered' && record.data.nextReviewAt <= now) stats.dueToday++
        })
        return stats
      })
    },
  )
}

export async function updateMistake(
  id: string,
  partial: Partial<Omit<Mistake, 'id' | 'schemaVersion'>>,
): Promise<void> {
  if (getBackend() === 'api') {
    const entity = await entitiesApi.getEntity(id)
    const merged: Mistake = { ...(entity.data as unknown as Mistake), ...partial, schemaVersion: 1 }
    await upsertEntity(id, 'mistake', merged, entity.panelId ?? undefined, entity.widgetId ?? undefined)
    return
  }
  await ensureV2Ready()
  await runIdbTransaction([STORE], 'readwrite', async (ctx) => {
    const existing = await ctx.get<Mistake>(STORE, id)
    if (!existing) {
      throw new Error(`mistake not found: ${id}`)
    }
    const merged: Mistake = { ...existing.data, ...partial, schemaVersion: 1 }
    await upsertRecord(ctx, STORE, id, merged)
  })
}

export async function deleteMistake(id: string): Promise<void> {
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
