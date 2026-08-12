import type {
  PersistedRecord,
  ValidationResult,
  ReadCompatResult,
  StoreSchemaContract,
  PanelData,
  WidgetRecordData,
  WidgetStateData,
  TaskData,
  CalendarEventData,
  FocusSessionData,
  HabitData,
  HabitCheckinData,
  MoodEntryData,
} from '../types/v2'

const MAX_TS = 4102444800000

const RECORD_STATUSES = ['active', 'pending_delete'] as const

function isPlainObject(value: unknown): value is Record<PropertyKey, unknown> {
  if (typeof value !== 'object' || value === null) return false
  const proto = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

function safeOwnDataProp(obj: unknown, key: string): unknown | undefined {
  if (!isPlainObject(obj)) return undefined
  if (!Object.prototype.hasOwnProperty.call(obj, key)) return undefined
  return (obj as Record<PropertyKey, unknown>)[key]
}

function isValidDateString(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false
  const [y, m, d] = s.split('-').map(Number)
  const date = new Date(y, m - 1, d)
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value) && value > 0
}

function isRecordStatus(value: unknown): value is 'active' | 'pending_delete' {
  return typeof value === 'string' && (RECORD_STATUSES as readonly string[]).includes(value)
}

function isValidEnvelope(value: unknown): boolean {
  if (!isPlainObject(value)) return false
  const widgetType = safeOwnDataProp(value, 'widgetType')
  const widgetVersion = safeOwnDataProp(value, 'widgetVersion')
  const stateVersion = safeOwnDataProp(value, 'stateVersion')
  const updatedAt = safeOwnDataProp(value, 'updatedAt')
  return typeof widgetType === 'string' && widgetType.length > 0
    && typeof widgetVersion === 'string'
    && isPositiveInteger(stateVersion)
    && isFiniteNumber(updatedAt)
}

function extractDeletableFields(raw: Record<PropertyKey, unknown>, errors: string[]): {
  deleteToken?: string; deleteExpiresAt?: number; deletedAt?: number
} {
  const result: { deleteToken?: string; deleteExpiresAt?: number; deletedAt?: number } = {}
  const deleteToken = safeOwnDataProp(raw, 'deleteToken')
  if (deleteToken !== undefined) {
    if (typeof deleteToken === 'string') result.deleteToken = deleteToken
    else errors.push('deleteToken must be a string if present')
  }
  const deleteExpiresAt = safeOwnDataProp(raw, 'deleteExpiresAt')
  if (deleteExpiresAt !== undefined) {
    if (isFiniteNumber(deleteExpiresAt)) result.deleteExpiresAt = deleteExpiresAt
    else errors.push('deleteExpiresAt must be a number if present')
  }
  const deletedAt = safeOwnDataProp(raw, 'deletedAt')
  if (deletedAt !== undefined) {
    if (isFiniteNumber(deletedAt)) result.deletedAt = deletedAt
    else errors.push('deletedAt must be a number if present')
  }
  return result
}

function extractDeletableFieldsSilent(raw: Record<PropertyKey, unknown>): {
  deleteToken?: string; deleteExpiresAt?: number; deletedAt?: number
} {
  const result: { deleteToken?: string; deleteExpiresAt?: number; deletedAt?: number } = {}
  const deleteToken = safeOwnDataProp(raw, 'deleteToken')
  if (typeof deleteToken === 'string') result.deleteToken = deleteToken
  const deleteExpiresAt = safeOwnDataProp(raw, 'deleteExpiresAt')
  if (isFiniteNumber(deleteExpiresAt)) result.deleteExpiresAt = deleteExpiresAt
  const deletedAt = safeOwnDataProp(raw, 'deletedAt')
  if (isFiniteNumber(deletedAt)) result.deletedAt = deletedAt
  return result
}

function validateRecordShell(rawRecord: unknown): rawRecord is PersistedRecord<unknown> {
  if (!isPlainObject(rawRecord)) return false
  const id = safeOwnDataProp(rawRecord, 'id')
  const version = safeOwnDataProp(rawRecord, 'version')
  const updatedAt = safeOwnDataProp(rawRecord, 'updatedAt')
  const data = safeOwnDataProp(rawRecord, 'data')
  return typeof id === 'string' && isPositiveInteger(version) && isFiniteNumber(updatedAt) && isPlainObject(data)
}

function makeReadCompat<T>(
  rawRecord: unknown,
  supportedVersions: number[],
  validateData: (raw: unknown) => ValidationResult<T>,
  buildLegacy: (raw: Record<PropertyKey, unknown>) => T | null,
): ReadCompatResult<T> {
  if (!validateRecordShell(rawRecord)) return { ok: false, reason: 'bad_shell', raw: rawRecord }
  const data = rawRecord.data as Record<PropertyKey, unknown>
  const sv = safeOwnDataProp(data, 'schemaVersion')
  if (sv === undefined) {
    const syntheticData = buildLegacy(data)
    if (syntheticData === null) return { ok: false, reason: 'bad_legacy', raw: rawRecord }
    return { ok: true, kind: 'legacy', raw: rawRecord, syntheticData }
  }
  if (!isPositiveInteger(sv) || !supportedVersions.includes(sv)) {
    return { ok: false, reason: 'unsupported_schema', raw: rawRecord }
  }
  const result = validateData(data)
  if (result.ok) return { ok: true, kind: 'current', data: result.state }
  return { ok: false, reason: 'bad_legacy', raw: rawRecord }
}

function validatePanelData(rawData: unknown): ValidationResult<PanelData> {
  if (!isPlainObject(rawData)) {
    return {
      ok: false,
      fallbackState: { name: '未命名', createdAt: Date.now(), zIndex: 1, width: 800, height: 600, offsetX: 0, offsetY: 0, schemaVersion: 1 },
      errors: ['data is not a plain object'],
    }
  }
  const errors: string[] = []

  const name = safeOwnDataProp(rawData, 'name')
  const nameOk = typeof name === 'string' && name.length >= 1 && name.length <= 100
  if (!nameOk) errors.push('name must be a string of 1-100 characters')

  const createdAt = safeOwnDataProp(rawData, 'createdAt')
  const createdAtOk = isFiniteNumber(createdAt) && createdAt >= 0 && createdAt <= MAX_TS
  if (!createdAtOk) errors.push('createdAt must be a number in 0-4102444800000')

  const zIndex = safeOwnDataProp(rawData, 'zIndex')
  const zIndexOk = isFiniteNumber(zIndex) && zIndex >= 0 && zIndex <= 9999
  if (!zIndexOk) errors.push('zIndex must be a number in 0-9999')

  const width = safeOwnDataProp(rawData, 'width')
  const widthOk = isFiniteNumber(width) && width >= 20 && width <= 10000
  if (!widthOk) errors.push('width must be a number in 20-10000')

  const height = safeOwnDataProp(rawData, 'height')
  const heightOk = isFiniteNumber(height) && height >= 20 && height <= 10000
  if (!heightOk) errors.push('height must be a number in 20-10000')

  const offsetX = safeOwnDataProp(rawData, 'offsetX')
  const offsetXOk = isFiniteNumber(offsetX) && offsetX >= -10000 && offsetX <= 10000
  if (!offsetXOk) errors.push('offsetX must be a number in -10000-10000')

  const offsetY = safeOwnDataProp(rawData, 'offsetY')
  const offsetYOk = isFiniteNumber(offsetY) && offsetY >= -10000 && offsetY <= 10000
  if (!offsetYOk) errors.push('offsetY must be a number in -10000-10000')

  const schemaVersion = safeOwnDataProp(rawData, 'schemaVersion')
  const svOk = isPositiveInteger(schemaVersion)
  if (!svOk) errors.push('schemaVersion must be a positive integer')

  const importBatchId = safeOwnDataProp(rawData, 'importBatchId')
  if (importBatchId !== undefined && typeof importBatchId !== 'string') {
    errors.push('importBatchId must be a string if present')
  }

  const state: PanelData = {
    name: nameOk ? name as string : '未命名',
    createdAt: createdAtOk ? createdAt as number : Date.now(),
    zIndex: zIndexOk ? zIndex as number : 1,
    width: widthOk ? width as number : 800,
    height: heightOk ? height as number : 600,
    offsetX: offsetXOk ? offsetX as number : 0,
    offsetY: offsetYOk ? offsetY as number : 0,
    schemaVersion: svOk ? schemaVersion as number : 1,
    ...(typeof importBatchId === 'string' ? { importBatchId } : {}),
  }

  return errors.length > 0 ? { ok: false, fallbackState: state, errors } : { ok: true, state }
}

function buildLegacyPanelData(raw: Record<PropertyKey, unknown>): PanelData {
  const name = safeOwnDataProp(raw, 'name')
  const createdAt = safeOwnDataProp(raw, 'createdAt')
  const zIndex = safeOwnDataProp(raw, 'zIndex')
  const width = safeOwnDataProp(raw, 'width')
  const height = safeOwnDataProp(raw, 'height')
  const offsetX = safeOwnDataProp(raw, 'offsetX')
  const offsetY = safeOwnDataProp(raw, 'offsetY')
  const importBatchId = safeOwnDataProp(raw, 'importBatchId')
  return {
    name: typeof name === 'string' && name.length >= 1 && name.length <= 100 ? name : '未命名',
    createdAt: isFiniteNumber(createdAt) && createdAt >= 0 && createdAt <= MAX_TS ? createdAt : Date.now(),
    zIndex: isFiniteNumber(zIndex) && zIndex >= 0 && zIndex <= 9999 ? zIndex : 1,
    width: isFiniteNumber(width) && width >= 20 && width <= 10000 ? width : 800,
    height: isFiniteNumber(height) && height >= 20 && height <= 10000 ? height : 600,
    offsetX: isFiniteNumber(offsetX) && offsetX >= -10000 && offsetX <= 10000 ? offsetX : 0,
    offsetY: isFiniteNumber(offsetY) && offsetY >= -10000 && offsetY <= 10000 ? offsetY : 0,
    schemaVersion: 1,
    ...(typeof importBatchId === 'string' ? { importBatchId } : {}),
  }
}

function validateWidgetRecordData(rawData: unknown): ValidationResult<WidgetRecordData> {
  if (!isPlainObject(rawData)) {
    return {
      ok: false,
      fallbackState: { panelId: '', type: '', x: 0, y: 0, width: 200, height: 200, zIndex: 0, recordStatus: 'active', schemaVersion: 1 },
      errors: ['data is not a plain object'],
    }
  }
  const errors: string[] = []

  const panelId = safeOwnDataProp(rawData, 'panelId')
  const panelIdOk = typeof panelId === 'string' && panelId.length > 0
  if (!panelIdOk) errors.push('panelId must be a non-empty string')

  const type = safeOwnDataProp(rawData, 'type')
  const typeOk = typeof type === 'string' && type.length >= 1 && type.length <= 64
  if (!typeOk) errors.push('type must be a string of 1-64 characters')

  const x = safeOwnDataProp(rawData, 'x')
  const xOk = isFiniteNumber(x) && x >= -10000 && x <= 10000
  if (!xOk) errors.push('x must be a number in -10000-10000')

  const y = safeOwnDataProp(rawData, 'y')
  const yOk = isFiniteNumber(y) && y >= -10000 && y <= 10000
  if (!yOk) errors.push('y must be a number in -10000-10000')

  const width = safeOwnDataProp(rawData, 'width')
  const widthOk = isFiniteNumber(width) && width >= 20 && width <= 10000
  if (!widthOk) errors.push('width must be a number in 20-10000')

  const height = safeOwnDataProp(rawData, 'height')
  const heightOk = isFiniteNumber(height) && height >= 20 && height <= 10000
  if (!heightOk) errors.push('height must be a number in 20-10000')

  const zIndex = safeOwnDataProp(rawData, 'zIndex')
  const zIndexOk = isFiniteNumber(zIndex) && zIndex >= 0 && zIndex <= 9999
  if (!zIndexOk) errors.push('zIndex must be a number in 0-9999')

  const recordStatus = safeOwnDataProp(rawData, 'recordStatus')
  const rsOk = isRecordStatus(recordStatus)
  if (!rsOk) errors.push('recordStatus must be active or pending_delete')

  const schemaVersion = safeOwnDataProp(rawData, 'schemaVersion')
  const svOk = isPositiveInteger(schemaVersion)
  if (!svOk) errors.push('schemaVersion must be a positive integer')

  const minimized = safeOwnDataProp(rawData, 'minimized')
  if (minimized !== undefined && typeof minimized !== 'boolean') errors.push('minimized must be a boolean if present')

  const locked = safeOwnDataProp(rawData, 'locked')
  if (locked !== undefined && typeof locked !== 'boolean') errors.push('locked must be a boolean if present')

  const colorScheme = safeOwnDataProp(rawData, 'colorScheme')
  if (colorScheme !== undefined && typeof colorScheme !== 'string') errors.push('colorScheme must be a string if present')

  const deletable = extractDeletableFields(rawData, errors)

  const state: WidgetRecordData = {
    panelId: panelIdOk ? panelId as string : '',
    type: typeOk ? type as string : '',
    x: xOk ? x as number : 0,
    y: yOk ? y as number : 0,
    width: widthOk ? width as number : 200,
    height: heightOk ? height as number : 200,
    zIndex: zIndexOk ? zIndex as number : 0,
    recordStatus: rsOk ? recordStatus as 'active' | 'pending_delete' : 'active',
    schemaVersion: svOk ? schemaVersion as number : 1,
    ...(typeof minimized === 'boolean' ? { minimized } : {}),
    ...(typeof locked === 'boolean' ? { locked } : {}),
    ...(typeof colorScheme === 'string' ? { colorScheme } : {}),
    ...deletable,
  }

  return errors.length > 0 ? { ok: false, fallbackState: state, errors } : { ok: true, state }
}

function buildLegacyWidgetRecordData(raw: Record<PropertyKey, unknown>): WidgetRecordData | null {
  const panelId = safeOwnDataProp(raw, 'panelId')
  if (typeof panelId !== 'string' || panelId.length === 0) return null
  const type = safeOwnDataProp(raw, 'type')
  if (typeof type !== 'string' || type.length < 1 || type.length > 64) return null
  const x = safeOwnDataProp(raw, 'x')
  const y = safeOwnDataProp(raw, 'y')
  const width = safeOwnDataProp(raw, 'width')
  const height = safeOwnDataProp(raw, 'height')
  const zIndex = safeOwnDataProp(raw, 'zIndex')
  const recordStatus = safeOwnDataProp(raw, 'recordStatus')
  const minimized = safeOwnDataProp(raw, 'minimized')
  const locked = safeOwnDataProp(raw, 'locked')
  const colorScheme = safeOwnDataProp(raw, 'colorScheme')
  const deletable = extractDeletableFieldsSilent(raw)
  return {
    panelId,
    type,
    x: isFiniteNumber(x) && x >= -10000 && x <= 10000 ? x : 0,
    y: isFiniteNumber(y) && y >= -10000 && y <= 10000 ? y : 0,
    width: isFiniteNumber(width) && width >= 20 && width <= 10000 ? width : 200,
    height: isFiniteNumber(height) && height >= 20 && height <= 10000 ? height : 200,
    zIndex: isFiniteNumber(zIndex) && zIndex >= 0 && zIndex <= 9999 ? zIndex : 0,
    recordStatus: isRecordStatus(recordStatus) ? recordStatus : 'active',
    schemaVersion: 1,
    ...(typeof minimized === 'boolean' ? { minimized } : {}),
    ...(typeof locked === 'boolean' ? { locked } : {}),
    ...(typeof colorScheme === 'string' ? { colorScheme } : {}),
    ...deletable,
  }
}

function validateWidgetStateData(rawData: unknown): ValidationResult<WidgetStateData> {
  if (!isPlainObject(rawData)) {
    return {
      ok: false,
      fallbackState: { widgetId: '', panelId: '', envelope: { widgetType: '', widgetVersion: '', stateVersion: 1, updatedAt: Date.now(), state: null }, schemaVersion: 1 },
      errors: ['data is not a plain object'],
    }
  }
  const errors: string[] = []

  const widgetId = safeOwnDataProp(rawData, 'widgetId')
  const widgetIdOk = typeof widgetId === 'string' && widgetId.length > 0
  if (!widgetIdOk) errors.push('widgetId must be a non-empty string')

  const panelId = safeOwnDataProp(rawData, 'panelId')
  const panelIdOk = typeof panelId === 'string' && panelId.length > 0
  if (!panelIdOk) errors.push('panelId must be a non-empty string')

  const envelope = safeOwnDataProp(rawData, 'envelope')
  const envelopeOk = isValidEnvelope(envelope)
  if (!envelopeOk) errors.push('envelope must be a valid WidgetStateEnvelope')

  const schemaVersion = safeOwnDataProp(rawData, 'schemaVersion')
  const svOk = isPositiveInteger(schemaVersion)
  if (!svOk) errors.push('schemaVersion must be a positive integer')

  const legacyRaw = safeOwnDataProp(rawData, 'legacyRaw')
  const legacyWrappedAt = safeOwnDataProp(rawData, 'legacyWrappedAt')
  if (legacyWrappedAt !== undefined && !isFiniteNumber(legacyWrappedAt)) errors.push('legacyWrappedAt must be a number if present')
  const legacyRawDroppedAt = safeOwnDataProp(rawData, 'legacyRawDroppedAt')
  if (legacyRawDroppedAt !== undefined && !isFiniteNumber(legacyRawDroppedAt)) errors.push('legacyRawDroppedAt must be a number if present')
  const importedAsOpaqueUnknown = safeOwnDataProp(rawData, 'importedAsOpaqueUnknown')
  if (importedAsOpaqueUnknown !== undefined && typeof importedAsOpaqueUnknown !== 'boolean') errors.push('importedAsOpaqueUnknown must be a boolean if present')
  const opaqueImportContext = safeOwnDataProp(rawData, 'opaqueImportContext')
  if (opaqueImportContext !== undefined && !isPlainObject(opaqueImportContext)) errors.push('opaqueImportContext must be a plain object if present')

  const envelopeObj = envelopeOk ? envelope as Record<PropertyKey, unknown> : null
  const state: WidgetStateData = {
    widgetId: widgetIdOk ? widgetId as string : '',
    panelId: panelIdOk ? panelId as string : '',
    envelope: envelopeObj
      ? {
          widgetType: safeOwnDataProp(envelopeObj, 'widgetType') as string,
          widgetVersion: safeOwnDataProp(envelopeObj, 'widgetVersion') as string,
          stateVersion: safeOwnDataProp(envelopeObj, 'stateVersion') as number,
          updatedAt: safeOwnDataProp(envelopeObj, 'updatedAt') as number,
          state: safeOwnDataProp(envelopeObj, 'state'),
        }
      : { widgetType: '', widgetVersion: '', stateVersion: 1, updatedAt: Date.now(), state: null },
    schemaVersion: svOk ? schemaVersion as number : 1,
    ...(legacyRaw !== undefined ? { legacyRaw } : {}),
    ...(isFiniteNumber(legacyWrappedAt) ? { legacyWrappedAt } : {}),
    ...(isFiniteNumber(legacyRawDroppedAt) ? { legacyRawDroppedAt } : {}),
    ...(typeof importedAsOpaqueUnknown === 'boolean' ? { importedAsOpaqueUnknown } : {}),
    ...(isPlainObject(opaqueImportContext) ? { opaqueImportContext: opaqueImportContext as WidgetStateData['opaqueImportContext'] } : {}),
  }

  return errors.length > 0 ? { ok: false, fallbackState: state, errors } : { ok: true, state }
}

function buildLegacyWidgetStateData(raw: Record<PropertyKey, unknown>): WidgetStateData | null {
  const widgetId = safeOwnDataProp(raw, 'widgetId')
  if (typeof widgetId !== 'string' || widgetId.length === 0) return null
  const panelId = safeOwnDataProp(raw, 'panelId')
  if (typeof panelId !== 'string' || panelId.length === 0) return null
  const envelope = safeOwnDataProp(raw, 'envelope')
  if (!isValidEnvelope(envelope)) return null
  const envelopeObj = envelope as Record<PropertyKey, unknown>
  const legacyRaw = safeOwnDataProp(raw, 'legacyRaw')
  const legacyWrappedAt = safeOwnDataProp(raw, 'legacyWrappedAt')
  const legacyRawDroppedAt = safeOwnDataProp(raw, 'legacyRawDroppedAt')
  const importedAsOpaqueUnknown = safeOwnDataProp(raw, 'importedAsOpaqueUnknown')
  const opaqueImportContext = safeOwnDataProp(raw, 'opaqueImportContext')
  return {
    widgetId,
    panelId,
    envelope: {
      widgetType: safeOwnDataProp(envelopeObj, 'widgetType') as string,
      widgetVersion: safeOwnDataProp(envelopeObj, 'widgetVersion') as string,
      stateVersion: safeOwnDataProp(envelopeObj, 'stateVersion') as number,
      updatedAt: safeOwnDataProp(envelopeObj, 'updatedAt') as number,
      state: safeOwnDataProp(envelopeObj, 'state'),
    },
    schemaVersion: 1,
    ...(legacyRaw !== undefined ? { legacyRaw } : {}),
    ...(isFiniteNumber(legacyWrappedAt) ? { legacyWrappedAt } : {}),
    ...(isFiniteNumber(legacyRawDroppedAt) ? { legacyRawDroppedAt } : {}),
    ...(typeof importedAsOpaqueUnknown === 'boolean' ? { importedAsOpaqueUnknown } : {}),
    ...(isPlainObject(opaqueImportContext) ? { opaqueImportContext: opaqueImportContext as WidgetStateData['opaqueImportContext'] } : {}),
  }
}

function validateTaskData(rawData: unknown): ValidationResult<TaskData> {
  if (!isPlainObject(rawData)) {
    return {
      ok: false,
      fallbackState: { panelId: '', title: '', description: '', taskStatus: 'todo', priority: 'medium', dueAt: null, createdAt: Date.now(), recordStatus: 'active', schemaVersion: 1 },
      errors: ['data is not a plain object'],
    }
  }
  const errors: string[] = []

  const panelId = safeOwnDataProp(rawData, 'panelId')
  const panelIdOk = typeof panelId === 'string' && panelId.length > 0
  if (!panelIdOk) errors.push('panelId must be a non-empty string')

  const title = safeOwnDataProp(rawData, 'title')
  const titleOk = typeof title === 'string' && title.length >= 1 && title.length <= 10000
  if (!titleOk) errors.push('title must be a string of 1-10000 characters')

  const description = safeOwnDataProp(rawData, 'description')
  const descOk = typeof description === 'string' && description.length >= 0 && description.length <= 10000
  if (!descOk) errors.push('description must be a string of 0-10000 characters')

  const taskStatus = safeOwnDataProp(rawData, 'taskStatus')
  const taskStatusOk = typeof taskStatus === 'string' && ['todo', 'in_progress', 'done'].includes(taskStatus)
  if (!taskStatusOk) errors.push('taskStatus must be todo, in_progress, or done')

  const priority = safeOwnDataProp(rawData, 'priority')
  const priorityOk = typeof priority === 'string' && ['low', 'medium', 'high'].includes(priority)
  if (!priorityOk) errors.push('priority must be low, medium, or high')

  const dueAt = safeOwnDataProp(rawData, 'dueAt')
  const dueAtOk = dueAt === null || (isFiniteNumber(dueAt) && dueAt >= 0 && dueAt <= MAX_TS)
  if (!dueAtOk) errors.push('dueAt must be null or a number in 0-4102444800000')

  const createdAt = safeOwnDataProp(rawData, 'createdAt')
  const createdAtOk = isFiniteNumber(createdAt) && createdAt >= 0 && createdAt <= MAX_TS
  if (!createdAtOk) errors.push('createdAt must be a number in 0-4102444800000')

  const recordStatus = safeOwnDataProp(rawData, 'recordStatus')
  const rsOk = isRecordStatus(recordStatus)
  if (!rsOk) errors.push('recordStatus must be active or pending_delete')

  const schemaVersion = safeOwnDataProp(rawData, 'schemaVersion')
  const svOk = isPositiveInteger(schemaVersion)
  if (!svOk) errors.push('schemaVersion must be a positive integer')

  const deletable = extractDeletableFields(rawData, errors)

  const state: TaskData = {
    panelId: panelIdOk ? panelId as string : '',
    title: titleOk ? title as string : '',
    description: descOk ? description as string : '',
    taskStatus: taskStatusOk ? taskStatus as TaskData['taskStatus'] : 'todo',
    priority: priorityOk ? priority as TaskData['priority'] : 'medium',
    dueAt: dueAtOk ? dueAt as number | null : null,
    createdAt: createdAtOk ? createdAt as number : Date.now(),
    recordStatus: rsOk ? recordStatus as 'active' | 'pending_delete' : 'active',
    schemaVersion: svOk ? schemaVersion as number : 1,
    ...deletable,
  }

  return errors.length > 0 ? { ok: false, fallbackState: state, errors } : { ok: true, state }
}

function buildLegacyTaskData(raw: Record<PropertyKey, unknown>): TaskData | null {
  const panelId = safeOwnDataProp(raw, 'panelId')
  if (typeof panelId !== 'string' || panelId.length === 0) return null
  const title = safeOwnDataProp(raw, 'title')
  const description = safeOwnDataProp(raw, 'description')
  const taskStatus = safeOwnDataProp(raw, 'taskStatus')
  const priority = safeOwnDataProp(raw, 'priority')
  const dueAt = safeOwnDataProp(raw, 'dueAt')
  const createdAt = safeOwnDataProp(raw, 'createdAt')
  const recordStatus = safeOwnDataProp(raw, 'recordStatus')
  const deletable = extractDeletableFieldsSilent(raw)
  return {
    panelId,
    title: typeof title === 'string' && title.length >= 1 && title.length <= 10000 ? title : '',
    description: typeof description === 'string' && description.length <= 10000 ? description : '',
    taskStatus: typeof taskStatus === 'string' && ['todo', 'in_progress', 'done'].includes(taskStatus) ? taskStatus as TaskData['taskStatus'] : 'todo',
    priority: typeof priority === 'string' && ['low', 'medium', 'high'].includes(priority) ? priority as TaskData['priority'] : 'medium',
    dueAt: dueAt === null || (isFiniteNumber(dueAt) && dueAt >= 0 && dueAt <= MAX_TS) ? dueAt as number | null : null,
    createdAt: isFiniteNumber(createdAt) && createdAt >= 0 && createdAt <= MAX_TS ? createdAt : Date.now(),
    recordStatus: isRecordStatus(recordStatus) ? recordStatus : 'active',
    schemaVersion: 1,
    ...deletable,
  }
}

function validateCalendarEventData(rawData: unknown): ValidationResult<CalendarEventData> {
  if (!isPlainObject(rawData)) {
    return {
      ok: false,
      fallbackState: { panelId: '', title: '', startsAt: 0, recordStatus: 'active', schemaVersion: 1 },
      errors: ['data is not a plain object'],
    }
  }
  const errors: string[] = []

  const panelId = safeOwnDataProp(rawData, 'panelId')
  const panelIdOk = typeof panelId === 'string' && panelId.length > 0
  if (!panelIdOk) errors.push('panelId must be a non-empty string')

  const title = safeOwnDataProp(rawData, 'title')
  const titleOk = typeof title === 'string' && title.length >= 1 && title.length <= 10000
  if (!titleOk) errors.push('title must be a string of 1-10000 characters')

  // 兼容旧字段名 startAt
  const startsAt = safeOwnDataProp(rawData, 'startsAt') ?? safeOwnDataProp(rawData, 'startAt')
  const startsAtOk = isFiniteNumber(startsAt) && startsAt >= 0 && startsAt <= MAX_TS
  if (!startsAtOk) errors.push('startsAt must be a number in 0-4102444800000')

  // 兼容旧字段名 endAt
  const endsAt = safeOwnDataProp(rawData, 'endsAt') ?? safeOwnDataProp(rawData, 'endAt')
  const endsAtOk = endsAt === undefined || (isFiniteNumber(endsAt) && endsAt >= 0 && endsAt <= MAX_TS)
  if (!endsAtOk) errors.push('endsAt must be a number in 0-4102444800000')

  if (startsAtOk && endsAtOk && endsAt !== undefined && (endsAt as number) < (startsAt as number)) {
    errors.push('endsAt must be >= startsAt')
  }

  // 兼容旧字段名 description
  const note = safeOwnDataProp(rawData, 'note') ?? safeOwnDataProp(rawData, 'description')
  const noteOk = note === undefined || (typeof note === 'string' && note.length >= 0 && note.length <= 10000)
  if (!noteOk) errors.push('note must be a string of 0-10000 characters')

  const recordStatus = safeOwnDataProp(rawData, 'recordStatus')
  const rsOk = isRecordStatus(recordStatus)
  if (!rsOk) errors.push('recordStatus must be active or pending_delete')

  const schemaVersion = safeOwnDataProp(rawData, 'schemaVersion')
  const svOk = isPositiveInteger(schemaVersion)
  if (!svOk) errors.push('schemaVersion must be a positive integer')

  const deletable = extractDeletableFields(rawData, errors)

  const state: CalendarEventData = {
    panelId: panelIdOk ? panelId as string : '',
    title: titleOk ? title as string : '',
    startsAt: startsAtOk ? startsAt as number : 0,
    ...(endsAtOk && endsAt !== undefined ? { endsAt: endsAt as number } : {}),
    ...(noteOk && note !== undefined ? { note: note as string } : {}),
    recordStatus: rsOk ? recordStatus as 'active' | 'pending_delete' : 'active',
    schemaVersion: svOk ? schemaVersion as number : 1,
    ...deletable,
  }

  return errors.length > 0 ? { ok: false, fallbackState: state, errors } : { ok: true, state }
}

function buildLegacyCalendarEventData(raw: Record<PropertyKey, unknown>): CalendarEventData | null {
  const panelId = safeOwnDataProp(raw, 'panelId')
  if (typeof panelId !== 'string' || panelId.length === 0) return null
  // 兼容旧字段名 startAt/endAt/description
  const startsAt = safeOwnDataProp(raw, 'startsAt') ?? safeOwnDataProp(raw, 'startAt')
  const endsAt = safeOwnDataProp(raw, 'endsAt') ?? safeOwnDataProp(raw, 'endAt')
  if (!isFiniteNumber(startsAt) || startsAt < 0 || startsAt > MAX_TS) return null
  if (endsAt !== undefined && (!isFiniteNumber(endsAt) || endsAt < 0 || endsAt > MAX_TS)) return null
  if (endsAt !== undefined && endsAt < startsAt) return null
  const title = safeOwnDataProp(raw, 'title')
  const note = safeOwnDataProp(raw, 'note') ?? safeOwnDataProp(raw, 'description')
  const recordStatus = safeOwnDataProp(raw, 'recordStatus')
  const deletable = extractDeletableFieldsSilent(raw)
  return {
    panelId,
    title: typeof title === 'string' && title.length >= 1 && title.length <= 10000 ? title : '',
    startsAt,
    ...(endsAt !== undefined ? { endsAt: endsAt as number } : {}),
    ...(note !== undefined && typeof note === 'string' && note.length <= 10000 ? { note: note as string } : {}),
    recordStatus: isRecordStatus(recordStatus) ? recordStatus : 'active',
    schemaVersion: 1,
    ...deletable,
  }
}

function validateFocusSessionData(rawData: unknown): ValidationResult<FocusSessionData> {
  if (!isPlainObject(rawData)) {
    return {
      ok: false,
      fallbackState: { startedAt: 0, endedAt: 0, duration: 0, schemaVersion: 1 },
      errors: ['data is not a plain object'],
    }
  }
  const errors: string[] = []

  const taskId = safeOwnDataProp(rawData, 'taskId')
  const taskIdOk = taskId === null || taskId === undefined || (typeof taskId === 'string' && taskId.length > 0)
  if (!taskIdOk) errors.push('taskId must be null or a non-empty string')

  const taskSnapshot = safeOwnDataProp(rawData, 'taskSnapshot')
  let taskSnapshotOk = true
  if (taskSnapshot !== undefined && taskSnapshot !== null) {
    if (!isPlainObject(taskSnapshot)) {
      taskSnapshotOk = false
      errors.push('taskSnapshot must be a plain object if present')
    } else {
      const tsTitle = safeOwnDataProp(taskSnapshot as Record<PropertyKey, unknown>, 'title')
      if (tsTitle !== null && tsTitle !== undefined && (typeof tsTitle !== 'string' || tsTitle.length > 10000)) {
        taskSnapshotOk = false
        errors.push('taskSnapshot.title must be null or a string of 0-10000 characters')
      }
    }
  }

  const startedAt = safeOwnDataProp(rawData, 'startedAt')
  const startedAtOk = isFiniteNumber(startedAt) && startedAt >= 0 && startedAt <= MAX_TS
  if (!startedAtOk) errors.push('startedAt must be a number in 0-4102444800000')

  const endedAt = safeOwnDataProp(rawData, 'endedAt')
  const endedAtOk = isFiniteNumber(endedAt) && endedAt >= 0 && endedAt <= MAX_TS
  if (!endedAtOk) errors.push('endedAt must be a number in 0-4102444800000')

  if (startedAtOk && endedAtOk && (endedAt as number) < (startedAt as number)) {
    errors.push('endedAt must be >= startedAt')
  }

  const duration = safeOwnDataProp(rawData, 'duration')
  const durationOk = isFiniteNumber(duration) && duration >= 0
  if (!durationOk) errors.push('duration must be a number >= 0')

  const schemaVersion = safeOwnDataProp(rawData, 'schemaVersion')
  const svOk = isPositiveInteger(schemaVersion)
  if (!svOk) errors.push('schemaVersion must be a positive integer')

  const panelId = safeOwnDataProp(rawData, 'panelId')
  if (panelId !== undefined && typeof panelId !== 'string') errors.push('panelId must be a string if present')

  const focusTimerWidgetId = safeOwnDataProp(rawData, 'focusTimerWidgetId')
  if (focusTimerWidgetId !== undefined && typeof focusTimerWidgetId !== 'string') errors.push('focusTimerWidgetId must be a string if present')

  const label = safeOwnDataProp(rawData, 'label')
  if (label !== undefined && typeof label !== 'string') errors.push('label must be a string if present')

  const mode = safeOwnDataProp(rawData, 'mode')
  if (mode !== undefined && typeof mode !== 'string') errors.push('mode must be a string if present')

  const tsObj = (taskSnapshot !== undefined && taskSnapshot !== null && isPlainObject(taskSnapshot))
    ? taskSnapshot as Record<PropertyKey, unknown> : null
  const tsTitle = tsObj ? safeOwnDataProp(tsObj, 'title') : undefined
  const tsDeletedAt = tsObj ? safeOwnDataProp(tsObj, 'deletedAt') : undefined

  const state: FocusSessionData = {
    ...(typeof panelId === 'string' ? { panelId } : {}),
    ...(typeof focusTimerWidgetId === 'string' ? { focusTimerWidgetId } : {}),
    ...(taskIdOk && taskId !== undefined ? { taskId: taskId as string } : {}),
    ...(taskSnapshotOk && tsObj ? {
      taskSnapshot: {
        title: (tsTitle === null || typeof tsTitle === 'string') ? tsTitle as string : '',
        ...(isFiniteNumber(tsDeletedAt) ? { deletedAt: tsDeletedAt } : {}),
      },
    } : {}),
    ...(typeof label === 'string' ? { label } : {}),
    startedAt: startedAtOk ? startedAt as number : 0,
    endedAt: endedAtOk ? endedAt as number : 0,
    duration: durationOk ? duration as number : 0,
    ...(typeof mode === 'string' ? { mode } : {}),
    schemaVersion: svOk ? schemaVersion as number : 1,
  }

  return errors.length > 0 ? { ok: false, fallbackState: state, errors } : { ok: true, state }
}

function buildLegacyFocusSessionData(raw: Record<PropertyKey, unknown>): FocusSessionData | null {
  const startedAt = safeOwnDataProp(raw, 'startedAt')
  const endedAt = safeOwnDataProp(raw, 'endedAt')
  if (!isFiniteNumber(startedAt) || startedAt < 0 || startedAt > MAX_TS) return null
  if (!isFiniteNumber(endedAt) || endedAt < 0 || endedAt > MAX_TS) return null
  if (endedAt < startedAt) return null

  const taskId = safeOwnDataProp(raw, 'taskId')
  const duration = safeOwnDataProp(raw, 'duration')
  const panelId = safeOwnDataProp(raw, 'panelId')
  const focusTimerWidgetId = safeOwnDataProp(raw, 'focusTimerWidgetId')
  const label = safeOwnDataProp(raw, 'label')
  const mode = safeOwnDataProp(raw, 'mode')
  const taskSnapshot = safeOwnDataProp(raw, 'taskSnapshot')

  const tsObj = (taskSnapshot !== undefined && taskSnapshot !== null && isPlainObject(taskSnapshot))
    ? taskSnapshot as Record<PropertyKey, unknown> : null
  const tsTitle = tsObj ? safeOwnDataProp(tsObj, 'title') : undefined
  const tsDeletedAt = tsObj ? safeOwnDataProp(tsObj, 'deletedAt') : undefined

  return {
    startedAt,
    endedAt,
    duration: isFiniteNumber(duration) && duration >= 0 ? duration : endedAt - startedAt,
    schemaVersion: 1,
    ...(typeof panelId === 'string' ? { panelId } : {}),
    ...(typeof focusTimerWidgetId === 'string' ? { focusTimerWidgetId } : {}),
    ...(taskId === null || (typeof taskId === 'string' && taskId.length > 0) ? { taskId: taskId as string } : {}),
    ...(tsObj ? {
      taskSnapshot: {
        title: (tsTitle === null || typeof tsTitle === 'string') ? tsTitle as string : '',
        ...(isFiniteNumber(tsDeletedAt) ? { deletedAt: tsDeletedAt } : {}),
      },
    } : {}),
    ...(typeof label === 'string' ? { label } : {}),
    ...(typeof mode === 'string' ? { mode } : {}),
  }
}

function validateHabitData(rawData: unknown): ValidationResult<HabitData> {
  if (!isPlainObject(rawData)) {
    return {
      ok: false,
      fallbackState: { name: '', frequency: 'daily', createdAt: Date.now(), schemaVersion: 1 },
      errors: ['data is not a plain object'],
    }
  }
  const errors: string[] = []

  const name = safeOwnDataProp(rawData, 'name')
  const nameOk = typeof name === 'string' && name.length >= 1 && name.length <= 100
  if (!nameOk) errors.push('name must be a string of 1-100 characters')

  const frequency = safeOwnDataProp(rawData, 'frequency')
  const freqOk = typeof frequency === 'string' && ['daily', 'weekly'].includes(frequency)
  if (!freqOk) errors.push('frequency must be daily or weekly')

  const createdAt = safeOwnDataProp(rawData, 'createdAt')
  const createdAtOk = isFiniteNumber(createdAt) && createdAt >= 0 && createdAt <= MAX_TS
  if (!createdAtOk) errors.push('createdAt must be a number in 0-4102444800000')

  const schemaVersion = safeOwnDataProp(rawData, 'schemaVersion')
  const svOk = isPositiveInteger(schemaVersion)
  if (!svOk) errors.push('schemaVersion must be a positive integer')

  const state: HabitData = {
    name: nameOk ? name as string : '',
    frequency: freqOk ? frequency as HabitData['frequency'] : 'daily',
    createdAt: createdAtOk ? createdAt as number : Date.now(),
    schemaVersion: svOk ? schemaVersion as number : 1,
  }

  return errors.length > 0 ? { ok: false, fallbackState: state, errors } : { ok: true, state }
}

function buildLegacyHabitData(raw: Record<PropertyKey, unknown>): HabitData {
  const name = safeOwnDataProp(raw, 'name')
  const frequency = safeOwnDataProp(raw, 'frequency')
  const createdAt = safeOwnDataProp(raw, 'createdAt')
  return {
    name: typeof name === 'string' && name.length >= 1 && name.length <= 100 ? name : '',
    frequency: typeof frequency === 'string' && ['daily', 'weekly'].includes(frequency) ? frequency as HabitData['frequency'] : 'daily',
    createdAt: isFiniteNumber(createdAt) && createdAt >= 0 && createdAt <= MAX_TS ? createdAt : Date.now(),
    schemaVersion: 1,
  }
}

function validateHabitCheckinData(rawData: unknown): ValidationResult<HabitCheckinData> {
  if (!isPlainObject(rawData)) {
    return {
      ok: false,
      fallbackState: { habitId: '', date: '', checkedAt: Date.now(), schemaVersion: 1 },
      errors: ['data is not a plain object'],
    }
  }
  const errors: string[] = []

  const habitId = safeOwnDataProp(rawData, 'habitId')
  const habitIdOk = typeof habitId === 'string' && habitId.length > 0
  if (!habitIdOk) errors.push('habitId must be a non-empty string')

  const date = safeOwnDataProp(rawData, 'date')
  const dateOk = typeof date === 'string' && isValidDateString(date)
  if (!dateOk) errors.push('date must be a valid YYYY-MM-DD string')

  const checkedAt = safeOwnDataProp(rawData, 'checkedAt')
  const checkedAtOk = isFiniteNumber(checkedAt) && checkedAt >= 0 && checkedAt <= MAX_TS
  if (!checkedAtOk) errors.push('checkedAt must be a number in 0-4102444800000')

  const schemaVersion = safeOwnDataProp(rawData, 'schemaVersion')
  const svOk = isPositiveInteger(schemaVersion)
  if (!svOk) errors.push('schemaVersion must be a positive integer')

  const state: HabitCheckinData = {
    habitId: habitIdOk ? habitId as string : '',
    date: dateOk ? date as string : '',
    checkedAt: checkedAtOk ? checkedAt as number : Date.now(),
    schemaVersion: svOk ? schemaVersion as number : 1,
  }

  return errors.length > 0 ? { ok: false, fallbackState: state, errors } : { ok: true, state }
}

function buildLegacyHabitCheckinData(raw: Record<PropertyKey, unknown>): HabitCheckinData | null {
  const habitId = safeOwnDataProp(raw, 'habitId')
  if (typeof habitId !== 'string' || habitId.length === 0) return null
  const date = safeOwnDataProp(raw, 'date')
  if (typeof date !== 'string' || !isValidDateString(date)) return null
  const checkedAt = safeOwnDataProp(raw, 'checkedAt')
  return {
    habitId,
    date,
    checkedAt: isFiniteNumber(checkedAt) && checkedAt >= 0 && checkedAt <= MAX_TS ? checkedAt : Date.now(),
    schemaVersion: 1,
  }
}

function validateMoodEntryData(rawData: unknown): ValidationResult<MoodEntryData> {
  if (!isPlainObject(rawData)) {
    return {
      ok: false,
      fallbackState: { date: '', mood: 3, note: '', recordStatus: 'active', schemaVersion: 1 },
      errors: ['data is not a plain object'],
    }
  }
  const errors: string[] = []

  const date = safeOwnDataProp(rawData, 'date')
  const dateOk = typeof date === 'string' && isValidDateString(date)
  if (!dateOk) errors.push('date must be a valid YYYY-MM-DD string')

  const mood = safeOwnDataProp(rawData, 'mood')
  const moodOk = typeof mood === 'number' && Number.isFinite(mood) && Number.isInteger(mood) && mood >= 1 && mood <= 5
  if (!moodOk) errors.push('mood must be an integer in 1-5')

  const note = safeOwnDataProp(rawData, 'note')
  const noteOk = typeof note === 'string' && note.length >= 0 && note.length <= 10000
  if (!noteOk) errors.push('note must be a string of 0-10000 characters')

  const recordStatus = safeOwnDataProp(rawData, 'recordStatus')
  const rsOk = isRecordStatus(recordStatus)
  if (!rsOk) errors.push('recordStatus must be active or pending_delete')

  const schemaVersion = safeOwnDataProp(rawData, 'schemaVersion')
  const svOk = isPositiveInteger(schemaVersion)
  if (!svOk) errors.push('schemaVersion must be a positive integer')

  const deletable = extractDeletableFields(rawData, errors)

  const state: MoodEntryData = {
    date: dateOk ? date as string : '',
    mood: moodOk ? mood as number : 3,
    note: noteOk ? note as string : '',
    recordStatus: rsOk ? recordStatus as 'active' | 'pending_delete' : 'active',
    schemaVersion: svOk ? schemaVersion as number : 1,
    ...deletable,
  }

  return errors.length > 0 ? { ok: false, fallbackState: state, errors } : { ok: true, state }
}

function buildLegacyMoodEntryData(raw: Record<PropertyKey, unknown>): MoodEntryData | null {
  const date = safeOwnDataProp(raw, 'date')
  if (typeof date !== 'string' || !isValidDateString(date)) return null
  const mood = safeOwnDataProp(raw, 'mood')
  const note = safeOwnDataProp(raw, 'note')
  const recordStatus = safeOwnDataProp(raw, 'recordStatus')
  const deletable = extractDeletableFieldsSilent(raw)
  return {
    date,
    mood: typeof mood === 'number' && Number.isFinite(mood) && Number.isInteger(mood) && mood >= 1 && mood <= 5 ? mood : 3,
    note: typeof note === 'string' && note.length <= 10000 ? note : '',
    recordStatus: isRecordStatus(recordStatus) ? recordStatus : 'active',
    schemaVersion: 1,
    ...deletable,
  }
}

function validateImportStagingData(rawData: unknown): ValidationResult<unknown> {
  return { ok: true, state: rawData }
}

function buildLegacyImportStagingData(_raw: Record<PropertyKey, unknown>): unknown {
  return null
}

export const panelSchema: StoreSchemaContract<PanelData> = {
  storeName: 'panels',
  currentSchemaVersion: 1,
  supportedSchemaVersions: [1],
  validateRecordShell,
  validateData: validatePanelData,
  readCompatValidateRecord: (raw) => makeReadCompat(raw, [1], validatePanelData, buildLegacyPanelData),
}

export const widgetRecordSchema: StoreSchemaContract<WidgetRecordData> = {
  storeName: 'widgetRecords',
  currentSchemaVersion: 1,
  supportedSchemaVersions: [1],
  validateRecordShell,
  validateData: validateWidgetRecordData,
  readCompatValidateRecord: (raw) => makeReadCompat(raw, [1], validateWidgetRecordData, buildLegacyWidgetRecordData),
}

export const widgetStateSchema: StoreSchemaContract<WidgetStateData> = {
  storeName: 'widgetStates',
  currentSchemaVersion: 1,
  supportedSchemaVersions: [1],
  validateRecordShell,
  validateData: validateWidgetStateData,
  readCompatValidateRecord: (raw) => makeReadCompat(raw, [1], validateWidgetStateData, buildLegacyWidgetStateData),
}

export const taskSchema: StoreSchemaContract<TaskData> = {
  storeName: 'tasks',
  currentSchemaVersion: 1,
  supportedSchemaVersions: [1],
  validateRecordShell,
  validateData: validateTaskData,
  readCompatValidateRecord: (raw) => makeReadCompat(raw, [1], validateTaskData, buildLegacyTaskData),
}

export const calendarEventSchema: StoreSchemaContract<CalendarEventData> = {
  storeName: 'calendarEvents',
  currentSchemaVersion: 1,
  supportedSchemaVersions: [1],
  validateRecordShell,
  validateData: validateCalendarEventData,
  readCompatValidateRecord: (raw) => makeReadCompat(raw, [1], validateCalendarEventData, buildLegacyCalendarEventData),
}

export const focusSessionSchema: StoreSchemaContract<FocusSessionData> = {
  storeName: 'focusSessions',
  currentSchemaVersion: 1,
  supportedSchemaVersions: [1],
  validateRecordShell,
  validateData: validateFocusSessionData,
  readCompatValidateRecord: (raw) => makeReadCompat(raw, [1], validateFocusSessionData, buildLegacyFocusSessionData),
}

export const habitSchema: StoreSchemaContract<HabitData> = {
  storeName: 'habits',
  currentSchemaVersion: 1,
  supportedSchemaVersions: [1],
  validateRecordShell,
  validateData: validateHabitData,
  readCompatValidateRecord: (raw) => makeReadCompat(raw, [1], validateHabitData, buildLegacyHabitData),
}

export const habitCheckinSchema: StoreSchemaContract<HabitCheckinData> = {
  storeName: 'habitCheckins',
  currentSchemaVersion: 1,
  supportedSchemaVersions: [1],
  validateRecordShell,
  validateData: validateHabitCheckinData,
  readCompatValidateRecord: (raw) => makeReadCompat(raw, [1], validateHabitCheckinData, buildLegacyHabitCheckinData),
}

export const moodEntrySchema: StoreSchemaContract<MoodEntryData> = {
  storeName: 'moodEntries',
  currentSchemaVersion: 1,
  supportedSchemaVersions: [1],
  validateRecordShell,
  validateData: validateMoodEntryData,
  readCompatValidateRecord: (raw) => makeReadCompat(raw, [1], validateMoodEntryData, buildLegacyMoodEntryData),
}

export const importStagingSchema: StoreSchemaContract<unknown> = {
  storeName: 'importStaging',
  currentSchemaVersion: 1,
  supportedSchemaVersions: [1],
  validateRecordShell,
  validateData: validateImportStagingData,
  readCompatValidateRecord: (raw) => {
    if (!validateRecordShell(raw)) return { ok: false, reason: 'bad_shell', raw }
    const data = raw.data as Record<PropertyKey, unknown>
    const sv = safeOwnDataProp(data, 'schemaVersion')
    if (sv === undefined) {
      return { ok: true, kind: 'legacy', raw, syntheticData: buildLegacyImportStagingData(data) }
    }
    if (!isPositiveInteger(sv) || ![1].includes(sv)) return { ok: false, reason: 'unsupported_schema', raw }
    const result = validateImportStagingData(data)
    if (result.ok) return { ok: true, kind: 'current', data: result.state }
    return { ok: false, reason: 'bad_legacy', raw }
  },
}

export const storeSchemaMap: Map<string, StoreSchemaContract<unknown>> = new Map([
  ['panels', panelSchema],
  ['widgetRecords', widgetRecordSchema],
  ['widgetStates', widgetStateSchema],
  ['tasks', taskSchema],
  ['calendarEvents', calendarEventSchema],
  ['focusSessions', focusSessionSchema],
  ['habits', habitSchema],
  ['habitCheckins', habitCheckinSchema],
  ['moodEntries', moodEntrySchema],
  ['importStaging', importStagingSchema],
])
