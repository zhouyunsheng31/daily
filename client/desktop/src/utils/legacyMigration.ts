import type { LoadedWidgetState, WidgetStateEnvelope, WidgetStateData, StorageWriteOutcome } from '../types/v2'
import { runIdbTransaction, toStorageWriteOutcome } from './idbTx'
import { widgetDefinitionMap } from '../registry/widgetDefinitions'

const WIDGET_STATES_STORE = 'widgetStates'

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function isValidEnvelope(v: unknown): v is WidgetStateEnvelope {
  if (!isPlainObject(v)) return false
  return (
    typeof v.widgetType === 'string' && v.widgetType.length > 0 &&
    typeof v.widgetVersion === 'string' &&
    typeof v.stateVersion === 'number' && Number.isFinite(v.stateVersion) &&
    typeof v.updatedAt === 'number' && Number.isFinite(v.updatedAt) &&
    'state' in v
  )
}

export function buildSyntheticEnvelope(widgetType: string, rawState: unknown): WidgetStateEnvelope {
  const definition = widgetDefinitionMap.get(widgetType)
  let validatedState: unknown = rawState

  if (definition) {
    try {
      const result = definition.validateState(rawState)
      if (result.ok) {
        validatedState = result.state
      } else {
        validatedState = definition.createDefaultState()
      }
    } catch {
      validatedState = definition.createDefaultState()
    }
  }

  return {
    widgetType,
    widgetVersion: definition?.widgetVersion ?? '0.0.0',
    stateVersion: definition?.stateVersion ?? 0,
    updatedAt: Date.now(),
    state: validatedState,
  }
}

export async function loadWidgetState(widgetId: string, widgetType: string): Promise<LoadedWidgetState> {
  return runIdbTransaction<LoadedWidgetState>([WIDGET_STATES_STORE], 'readonly', async (ctx) => {
    const record = await ctx.get<WidgetStateData>(WIDGET_STATES_STORE, widgetId)
    if (!record) return { kind: 'missing' }

    const data = record.data
    if (!isPlainObject(data)) return { kind: 'invalid', raw: record }

    if (isValidEnvelope(data.envelope)) {
      return { kind: 'envelope', envelope: data.envelope }
    }

    if (data.legacyRaw !== undefined) {
      return {
        kind: 'legacy',
        raw: data.legacyRaw,
        syntheticEnvelope: buildSyntheticEnvelope(widgetType, data.legacyRaw),
      }
    }

    return {
      kind: 'legacy',
      raw: data,
      syntheticEnvelope: buildSyntheticEnvelope(widgetType, data),
    }
  })
}

export async function wrapLegacyState(
  widgetId: string,
  panelId: string,
  widgetType: string,
  rawState: unknown,
): Promise<StorageWriteOutcome> {
  try {
    return await runIdbTransaction<StorageWriteOutcome>([WIDGET_STATES_STORE], 'readwrite', async (ctx) => {
      const record = await ctx.get<WidgetStateData>(WIDGET_STATES_STORE, widgetId)
      if (!record) return { ok: false, kind: 'not_found' } as StorageWriteOutcome

      if (isValidEnvelope(record.data.envelope)) {
        return { ok: true } as StorageWriteOutcome
      }

      const envelope = buildSyntheticEnvelope(widgetType, rawState)
      const newData: WidgetStateData = {
        widgetId,
        panelId,
        envelope,
        legacyRaw: rawState,
        legacyWrappedAt: ctx.now(),
        schemaVersion: 1,
      }

      await ctx.putCas(WIDGET_STATES_STORE, {
        id: widgetId,
        expectedVersion: record.version,
        data: newData,
      })

      return { ok: true } as StorageWriteOutcome
    })
  } catch (err) {
    return toStorageWriteOutcome(err)
  }
}

export async function dropLegacyRawIfNeeded(
  widgetId: string,
  maxAgeMs: number = 7 * 24 * 60 * 60 * 1000,
): Promise<StorageWriteOutcome> {
  try {
    return await runIdbTransaction<StorageWriteOutcome>([WIDGET_STATES_STORE], 'readwrite', async (ctx) => {
      const record = await ctx.get<WidgetStateData>(WIDGET_STATES_STORE, widgetId)
      if (!record) return { ok: true } as StorageWriteOutcome

      const data = record.data
      if (data.legacyRaw === undefined) return { ok: true } as StorageWriteOutcome

      const legacyWrappedAt = data.legacyWrappedAt
      if (typeof legacyWrappedAt !== 'number' || !Number.isFinite(legacyWrappedAt)) {
        return { ok: true } as StorageWriteOutcome
      }

      if (ctx.now() - legacyWrappedAt <= maxAgeMs) {
        return { ok: true } as StorageWriteOutcome
      }

      const { legacyRaw: _legacyRaw, ...dataWithoutLegacyRaw } = data
      const newData: WidgetStateData = {
        ...dataWithoutLegacyRaw,
        legacyRawDroppedAt: ctx.now(),
      }

      await ctx.putCas(WIDGET_STATES_STORE, {
        id: widgetId,
        expectedVersion: record.version,
        data: newData,
      })

      return { ok: true } as StorageWriteOutcome
    })
  } catch (err) {
    return toStorageWriteOutcome(err)
  }
}
