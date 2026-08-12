import type { LocatedWidgetState, WidgetStateData, StorageWriteOutcome } from '../types/v2'
import { runIdbTransaction, toStorageWriteOutcome } from './idbTx'

export async function locateWidgetStateByWidgetId(widgetId: string): Promise<LocatedWidgetState> {
  return runIdbTransaction(['widgetStates'], 'readonly', async (ctx) => {
    const record = await ctx.get<WidgetStateData>('widgetStates', widgetId)

    if (record) {
      if (record.data.widgetId === widgetId) {
        return { kind: 'found', primaryKey: widgetId, record, matchedBy: 'id', needsRepair: false }
      }
      return { kind: 'found', primaryKey: widgetId, record, matchedBy: 'id', needsRepair: true }
    }

    const matches = await ctx.indexGetAll<WidgetStateData>('widgetStates', 'widgetId', widgetId)

    if (matches.length === 1) {
      const match = matches[0]
      return { kind: 'found', primaryKey: match.id, record: match, matchedBy: 'data.widgetId', needsRepair: true }
    }

    if (matches.length > 1) {
      return {
        kind: 'duplicate_conflict',
        widgetId,
        candidates: matches.map(r => ({ primaryKey: r.id, record: r })),
      }
    }

    return { kind: 'missing' }
  })
}

export async function repairWidgetStatePrimaryKey(primaryKey: string, expectedWidgetId: string): Promise<StorageWriteOutcome> {
  try {
    return await runIdbTransaction(['widgetStates'], 'readwrite', async (ctx) => {
      const record = await ctx.get<WidgetStateData>('widgetStates', primaryKey)

      if (!record) {
        return { ok: false, kind: 'not_found' }
      }

      if (record.data.widgetId !== expectedWidgetId) {
        return { ok: false, kind: 'condition_mismatch' }
      }

      if (record.id === expectedWidgetId) {
        return { ok: true }
      }

      await ctx.deleteChecked('widgetStates', { id: primaryKey, expectedVersion: record.version })
      await ctx.addNew<WidgetStateData>('widgetStates', { id: expectedWidgetId, data: record.data })

      return { ok: true }
    })
  } catch (err) {
    return toStorageWriteOutcome(err)
  }
}
