import { ensureV2Ready, runIdbTransaction, upsertRecord } from '../db'
import type { QuizSession } from '../../types'
import * as entitiesApi from '../../api/entities'
import { withFallback, getBackend } from '../../api/adapter'

const STORE = 'quizSessions'

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

export async function saveQuizSession(session: QuizSession): Promise<void> {
  await withFallback(
    async () => { await upsertEntity(session.id, 'quizSession', session, undefined, session.latexQuizWidgetId) },
    async () => {
      await ensureV2Ready()
      await runIdbTransaction([STORE], 'readwrite', async (ctx) => {
        await upsertRecord(ctx, STORE, session.id, session)
      })
    },
  )
}

export async function getQuizSessionById(id: string): Promise<QuizSession | undefined> {
  return withFallback(
    async () => {
      try {
        const entity = await entitiesApi.getEntity(id)
        return entity.data as unknown as QuizSession
      } catch (err: unknown) {
        const e = err as { status?: number }
        if (e?.status === 404) return undefined
        throw err
      }
    },
    async () => {
      await ensureV2Ready()
      return runIdbTransaction([STORE], 'readonly', async (ctx) => {
        const record = await ctx.get<QuizSession>(STORE, id)
        return record?.data
      })
    },
  )
}

export async function getAllQuizSessions(): Promise<QuizSession[]> {
  return withFallback(
    async () => {
      const result = await entitiesApi.queryEntities({ type: 'quizSession' })
      return result.items.map(e => e.data as unknown as QuizSession)
    },
    async () => {
      await ensureV2Ready()
      return runIdbTransaction([STORE], 'readonly', async (ctx) => {
        const result: QuizSession[] = []
        await ctx.iterateStore<QuizSession>(STORE, (record) => {
          result.push(record.data)
        })
        return result
      })
    },
  )
}

export async function getQuizSessionsByWidget(widgetId: string): Promise<QuizSession[]> {
  return withFallback(
    async () => {
      const result = await entitiesApi.queryEntities({ type: 'quizSession', widgetId })
      return result.items.map(e => e.data as unknown as QuizSession)
    },
    async () => {
      await ensureV2Ready()
      return runIdbTransaction([STORE], 'readonly', async (ctx) => {
        const records = await ctx.indexGetAll<QuizSession>(STORE, 'by_latexQuizWidgetId', widgetId)
        return records.map(r => r.data)
      })
    },
  )
}

export async function getQuizSessionsByPanel(panelId: string): Promise<QuizSession[]> {
  return withFallback(
    async () => {
      const result = await entitiesApi.queryEntities({ type: 'quizSession', panelId })
      return result.items.map(e => e.data as unknown as QuizSession)
    },
    async () => {
      await ensureV2Ready()
      return runIdbTransaction([STORE], 'readonly', async (ctx) => {
        const records = await ctx.indexGetAll<QuizSession>(STORE, 'by_panelId', panelId)
        return records.map(r => r.data)
      })
    },
  )
}

export async function updateQuizSession(
  id: string,
  partial: Partial<Omit<QuizSession, 'id' | 'schemaVersion'>>,
): Promise<void> {
  if (getBackend() === 'api') {
    const entity = await entitiesApi.getEntity(id)
    const merged: QuizSession = { ...(entity.data as unknown as QuizSession), ...partial, schemaVersion: 1 }
    await upsertEntity(id, 'quizSession', merged, entity.panelId ?? undefined, entity.widgetId ?? undefined)
    return
  }
  await ensureV2Ready()
  await runIdbTransaction([STORE], 'readwrite', async (ctx) => {
    const existing = await ctx.get<QuizSession>(STORE, id)
    if (!existing) {
      throw new Error(`quizSession not found: ${id}`)
    }
    const merged: QuizSession = { ...existing.data, ...partial, schemaVersion: 1 }
    await upsertRecord(ctx, STORE, id, merged)
  })
}

export async function deleteQuizSession(id: string): Promise<void> {
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
