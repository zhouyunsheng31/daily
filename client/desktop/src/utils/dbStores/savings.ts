import { ensureV2Ready, runIdbTransaction, upsertRecord } from '../db'
import type { SavingsGoal, SavingsTransaction } from '../../types'
import * as entitiesApi from '../../api/entities'
import { withFallback } from '../../api/adapter'

const GOALS_STORE = 'savingsGoals'
const TRANSACTIONS_STORE = 'savingsTransactions'

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

// --- SavingsGoal ---

export async function saveSavingsGoal(goal: SavingsGoal): Promise<void> {
  await withFallback(
    async () => { await upsertEntity(goal.id, 'savingsGoal', goal) },
    async () => {
      await ensureV2Ready()
      await runIdbTransaction([GOALS_STORE], 'readwrite', async (ctx) => {
        await upsertRecord(ctx, GOALS_STORE, goal.id, goal)
      })
    },
  )
}

export async function getSavingsGoalById(id: string): Promise<SavingsGoal | undefined> {
  return withFallback(
    async () => {
      try {
        const entity = await entitiesApi.getEntity(id)
        return entity.data as unknown as SavingsGoal
      } catch (err: unknown) {
        const e = err as { status?: number }
        if (e?.status === 404) return undefined
        throw err
      }
    },
    async () => {
      await ensureV2Ready()
      return runIdbTransaction([GOALS_STORE], 'readonly', async (ctx) => {
        const record = await ctx.get<SavingsGoal>(GOALS_STORE, id)
        return record?.data
      })
    },
  )
}

export async function getAllSavingsGoals(): Promise<SavingsGoal[]> {
  return withFallback(
    async () => {
      const result = await entitiesApi.queryEntities({ type: 'savingsGoal' })
      return result.items.map(e => e.data as unknown as SavingsGoal)
    },
    async () => {
      await ensureV2Ready()
      return runIdbTransaction([GOALS_STORE], 'readonly', async (ctx) => {
        const result: SavingsGoal[] = []
        await ctx.iterateStore<SavingsGoal>(GOALS_STORE, (record) => {
          result.push(record.data)
        })
        return result
      })
    },
  )
}

export async function deleteSavingsGoal(id: string): Promise<void> {
  await withFallback(
    () => entitiesApi.deleteEntity(id),
    async () => {
      await ensureV2Ready()
      await runIdbTransaction([GOALS_STORE], 'readwrite', async (ctx) => {
        const existing = await ctx.get(GOALS_STORE, id)
        if (existing) {
          await ctx.deleteChecked(GOALS_STORE, { id })
        }
      })
    },
  )
}

// --- SavingsTransaction ---

export async function saveSavingsTransaction(transaction: SavingsTransaction): Promise<void> {
  await withFallback(
    async () => { await upsertEntity(transaction.id, 'savingsTransaction', transaction) },
    async () => {
      await ensureV2Ready()
      await runIdbTransaction([TRANSACTIONS_STORE], 'readwrite', async (ctx) => {
        await upsertRecord(ctx, TRANSACTIONS_STORE, transaction.id, transaction)
      })
    },
  )
}

export async function getSavingsTransactionsByGoal(goalId: string): Promise<SavingsTransaction[]> {
  return withFallback(
    async () => {
      const result = await entitiesApi.queryEntities({ type: 'savingsTransaction' })
      return result.items.filter(e => e.data.goalId === goalId).map(e => e.data as unknown as SavingsTransaction)
    },
    async () => {
      await ensureV2Ready()
      return runIdbTransaction([TRANSACTIONS_STORE], 'readonly', async (ctx) => {
        const records = await ctx.indexGetAll<SavingsTransaction>(TRANSACTIONS_STORE, 'by_goalId', goalId)
        return records.map(r => r.data)
      })
    },
  )
}

export async function deleteSavingsTransaction(id: string): Promise<void> {
  await withFallback(
    () => entitiesApi.deleteEntity(id),
    async () => {
      await ensureV2Ready()
      await runIdbTransaction([TRANSACTIONS_STORE], 'readwrite', async (ctx) => {
        const existing = await ctx.get(TRANSACTIONS_STORE, id)
        if (existing) {
          await ctx.deleteChecked(TRANSACTIONS_STORE, { id })
        }
      })
    },
  )
}

/**
 * Phase 12 新增：全量读取 savingsTransactions（聚合所有 goal，用于本地搜索索引）。
 *
 * 设计：直接走 runIdbTransaction 遍历 IDB store，不走 withFallback
 * （与现有 getAllSavingsGoals() 的 IDB 路径风格一致；搜索索引需要本地全量数据）
 */
export async function getAllSavingsTransactions(): Promise<SavingsTransaction[]> {
  await ensureV2Ready()
  return runIdbTransaction([TRANSACTIONS_STORE], 'readonly', async (ctx) => {
    const records: SavingsTransaction[] = []
    await ctx.iterateStore<SavingsTransaction>(TRANSACTIONS_STORE, (record) => {
      records.push(record.data as SavingsTransaction)
    })
    return records
  })
}
