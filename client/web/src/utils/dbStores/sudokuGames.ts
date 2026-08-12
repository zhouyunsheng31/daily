import { ensureV2Ready, runIdbTransaction, upsertRecord } from '../db'
import type { SudokuGame } from '../../types'
import * as entitiesApi from '../../api/entities'
import { withFallback } from '../../api/adapter'

const STORE = 'sudokuGames'

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

export async function saveSudokuGame(game: SudokuGame): Promise<void> {
  await withFallback(
    async () => { await upsertEntity(game.id, 'sudokuGame', game, game.panelId, game.sudokuWidgetId) },
    async () => {
      await ensureV2Ready()
      await runIdbTransaction([STORE], 'readwrite', async (ctx) => {
        await upsertRecord(ctx, STORE, game.id, game)
      })
    },
  )
}

export async function getSudokuGameById(id: string): Promise<SudokuGame | undefined> {
  return withFallback(
    async () => {
      try {
        const entity = await entitiesApi.getEntity(id)
        return entity.data as unknown as SudokuGame
      } catch (err: unknown) {
        const e = err as { status?: number }
        if (e?.status === 404) return undefined
        throw err
      }
    },
    async () => {
      await ensureV2Ready()
      return runIdbTransaction([STORE], 'readonly', async (ctx) => {
        const record = await ctx.get<SudokuGame>(STORE, id)
        return record?.data
      })
    },
  )
}

export async function getSudokuGamesByPanel(panelId: string): Promise<SudokuGame[]> {
  return withFallback(
    async () => {
      const result = await entitiesApi.queryEntities({ type: 'sudokuGame', panelId })
      return result.items.map(e => e.data as unknown as SudokuGame)
    },
    async () => {
      await ensureV2Ready()
      return runIdbTransaction([STORE], 'readonly', async (ctx) => {
        const records = await ctx.indexGetAll<SudokuGame>(STORE, 'by_panelId', panelId)
        return records.map(r => r.data)
      })
    },
  )
}

export async function getSudokuGamesByWidget(widgetId: string): Promise<SudokuGame[]> {
  return withFallback(
    async () => {
      const result = await entitiesApi.queryEntities({ type: 'sudokuGame', widgetId })
      return result.items.map(e => e.data as unknown as SudokuGame)
    },
    async () => {
      await ensureV2Ready()
      return runIdbTransaction([STORE], 'readonly', async (ctx) => {
        const records = await ctx.indexGetAll<SudokuGame>(STORE, 'by_sudokuWidgetId', widgetId)
        return records.map(r => r.data)
      })
    },
  )
}

export async function getActiveSudokuGames(): Promise<SudokuGame[]> {
  return withFallback(
    async () => {
      const result = await entitiesApi.queryEntities({ type: 'sudokuGame' })
      return result.items.filter(e => e.data.status === 'playing').map(e => e.data as unknown as SudokuGame)
    },
    async () => {
      await ensureV2Ready()
      return runIdbTransaction([STORE], 'readonly', async (ctx) => {
        const records = await ctx.indexGetAll<SudokuGame>(STORE, 'by_status', 'playing')
        return records.map(r => r.data)
      })
    },
  )
}

export async function getSudokuGameStats(): Promise<{
  totalGames: number
  completed: number
  byDifficulty: { easy: number; medium: number; hard: number }
}> {
  return withFallback(
    async () => {
      const result = await entitiesApi.queryEntities({ type: 'sudokuGame' })
      const stats = { totalGames: 0, completed: 0, byDifficulty: { easy: 0, medium: 0, hard: 0 } }
      for (const e of result.items) {
        stats.totalGames++
        if (e.data.status === 'completed') stats.completed++
        const d = (e.data as unknown as SudokuGame).difficulty
        if (d === 'easy' || d === 'medium' || d === 'hard') {
          stats.byDifficulty[d]++
        }
      }
      return stats
    },
    async () => {
      await ensureV2Ready()
      return runIdbTransaction([STORE], 'readonly', async (ctx) => {
        const result = { totalGames: 0, completed: 0, byDifficulty: { easy: 0, medium: 0, hard: 0 } }
        await ctx.iterateStore<SudokuGame>(STORE, (record) => {
          result.totalGames++
          if (record.data.status === 'completed') result.completed++
          const d = record.data.difficulty
          if (d === 'easy' || d === 'medium' || d === 'hard') {
            result.byDifficulty[d]++
          }
        })
        return result
      })
    },
  )
}

export async function updateSudokuGame(
  id: string,
  partial: Partial<Omit<SudokuGame, 'id' | 'schemaVersion'>>,
): Promise<void> {
  await withFallback(
    async () => {
      const entity = await entitiesApi.getEntity(id)
      const merged: SudokuGame = { ...(entity.data as unknown as SudokuGame), ...partial, schemaVersion: 1 }
      await upsertEntity(id, 'sudokuGame', merged, entity.panelId ?? undefined, entity.widgetId ?? undefined)
    },
    async () => {
      await ensureV2Ready()
      await runIdbTransaction([STORE], 'readwrite', async (ctx) => {
        const existing = await ctx.get<SudokuGame>(STORE, id)
        if (!existing) {
          throw new Error(`sudokuGame not found: ${id}`)
        }
        const merged: SudokuGame = { ...existing.data, ...partial, schemaVersion: 1 }
        await upsertRecord(ctx, STORE, id, merged)
      })
    },
  )
}

export async function deleteSudokuGame(id: string): Promise<void> {
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
