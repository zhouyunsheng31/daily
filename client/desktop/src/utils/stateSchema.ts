import { getWidgetConfig } from '../registry'

const CORRUPTED_BACKUP_PREFIX = 'corrupted_backup_'

export function validateWidgetState(
  widgetType: string,
  state: Record<string, unknown>
): { valid: boolean; sanitized: Record<string, unknown> } {
  const config = getWidgetConfig(widgetType)
  if (!config) return { valid: false, sanitized: {} }

  const defaultState = config.defaultState
  if (!defaultState || Object.keys(defaultState).length === 0) {
    return { valid: true, sanitized: state }
  }

  const sanitized: Record<string, unknown> = {}
  let hasInvalidKey = false

  for (const key of Object.keys(defaultState)) {
    if (key in state) {
      const expectedType = typeof defaultState[key]
      const actualType = typeof state[key]
      if (actualType === expectedType) {
        sanitized[key] = state[key]
      } else {
        sanitized[key] = defaultState[key]
        hasInvalidKey = true
      }
    } else {
      sanitized[key] = defaultState[key]
      hasInvalidKey = true
    }
  }

  for (const key of Object.keys(state)) {
    if (!(key in defaultState) && !key.startsWith('_')) {
      sanitized[key] = state[key]
    }
  }

  return { valid: !hasInvalidKey, sanitized }
}

export async function saveCorruptedBackup(
  widgetId: string,
  widgetType: string,
  corruptedState: Record<string, unknown>
): Promise<void> {
  try {
    const key = `${CORRUPTED_BACKUP_PREFIX}${widgetId}`
    const entry = {
      widgetId,
      widgetType,
      state: corruptedState,
      backedUpAt: Date.now(),
    }
    const { openDB } = await import('idb')
    const db = await openDB('living-dashboard', 6)
    if (!db.objectStoreNames.contains('meta')) return
    await db.put('meta', { key, value: entry })
    db.close()
  } catch (e) {
    console.warn('[StateSchema] Failed to save corrupted backup:', e)
  }
}

export function sanitizeWidgetState(
  widgetType: string,
  state: Record<string, unknown>
): Record<string, unknown> {
  const { valid, sanitized } = validateWidgetState(widgetType, state)
  if (!valid) {
    console.warn(`[StateSchema] Widget "${widgetType}" has invalid state, resetting to defaults. Backup saved.`)
    saveCorruptedBackup(
      state.widgetId as string || 'unknown',
      widgetType,
      state
    )
  }
  return sanitized
}
