import type { PanelData as V1PanelData, AppData, Panel, WidgetInstance, WidgetPosition, AppSettings, DynamicWidgetDef, MusicPlaylist, FocusSession, Task, Habit, HabitCheckin, MoodEntry, CalendarEvent, DrawingStroke, WidgetConnection, QuizSession, WebTab, Bookmark } from '../types'
import type { PersistedRecord, PanelData as V2PanelData, WidgetRecordData, WidgetStateData } from '../types/v2'
import { migrateFocusSession, migrateTask, migrateHabit, migrateHabitCheckin, migrateMoodEntry, migrateCalendarEvent, migrateQuizSession } from './entityMigration'
import { DEFAULT_APPEARANCE, DEFAULT_BEHAVIOR } from '../types'
import { getDefaultPanelSettings } from './migration'
import { initV2Storage } from './dbV2'
import { runIdbTransaction, type IdbTxContext } from './idbTx'
import * as panelsApi from '../api/panels'
import * as widgetsApi from '../api/widgets'
import * as entitiesApi from '../api/entities'
import * as settingsApi from '../api/settings'
import * as dynamicWidgetsApi from '../api/dynamicWidgets'
import { withFallback, getBackend } from '../api/adapter'
import type { EntityDTO } from '../api/entities'

export { runIdbTransaction, type IdbTxContext, type IdbRunContext } from './idbTx'

/** 将 entity 的顶级 id/panelId/widgetId 合并到 data 中，供 migrateXxx 使用 */
function entityDataWithMeta(e: EntityDTO): Record<string, unknown> {
  return { ...e.data, id: e.id, panelId: e.panelId, widgetId: e.widgetId }
}

const PANEL_STORE = 'panels'
const WIDGET_RECORDS_STORE = 'widgetRecords'
const WIDGET_STATES_STORE = 'widgetStates'
const SETTINGS_STORE = 'settings'
const META_STORE = 'meta'
const DYNAMIC_WIDGET_STORE = 'dynamic-widgets'
const PLAYLIST_STORE = 'playlists'
const FOCUS_SESSIONS_STORE = 'focusSessions'
const TASKS_STORE = 'tasks'
const HABITS_STORE = 'habits'
const HABIT_CHECKINS_STORE = 'habitCheckins'
const MOOD_ENTRIES_STORE = 'moodEntries'
const CALENDAR_EVENTS_STORE = 'calendarEvents'
const QUIZ_SESSIONS_STORE = 'quizSessions'

let v2Initialized = false

export async function ensureV2Ready(): Promise<void> {
  if (v2Initialized) return
  await initV2Storage()
  v2Initialized = true
}

export async function upsertRecord<T>(ctx: IdbTxContext, storeName: string, id: string, data: T): Promise<void> {
  const existing = await ctx.get<T>(storeName, id)
  if (existing) {
    await ctx.putCas(storeName, { id, expectedVersion: existing.version, data })
  } else {
    await ctx.addNew(storeName, { id, data })
  }
}

async function clearStore(ctx: IdbTxContext, storeName: string): Promise<void> {
  const ids: string[] = []
  await ctx.iterateStore<unknown>(storeName, (record) => {
    ids.push(record.id)
  })
  for (const id of ids) {
    await ctx.deleteChecked(storeName, { id })
  }
}

function v1PanelToV2Data(panel: Panel): V2PanelData {
  return {
    name: panel.name,
    createdAt: Date.now(),
    zIndex: panel.order,
    width: 0,
    height: 0,
    offsetX: panel.canvasTransform?.x ?? 0,
    offsetY: panel.canvasTransform?.y ?? 0,
    order: panel.order,
    settings: panel.settings,
    canvasTransform: panel.canvasTransform,
    schemaVersion: 1,
  }
}

function v2RecordToV1Panel(record: PersistedRecord<V2PanelData>): Panel {
  const d = record.data
  return {
    id: record.id,
    name: d.name,
    order: d.order ?? d.zIndex,
    settings: d.settings || getDefaultPanelSettings(),
    canvasTransform: d.canvasTransform,
  }
}

function v2RecordsToV1Widget(widgetRecord: PersistedRecord<WidgetRecordData>, widgetState: PersistedRecord<WidgetStateData> | undefined): WidgetInstance {
  const state = widgetState?.data?.envelope?.state
  return {
    widgetId: widgetRecord.id,
    widgetType: widgetRecord.data.type,
    state: typeof state === 'object' && state !== null ? state as Record<string, unknown> : {},
    minimized: widgetRecord.data.minimized ?? false,
    locked: widgetRecord.data.locked,
    colorScheme: widgetRecord.data.colorScheme,
  }
}

function v2RecordToV1Position(widgetRecord: PersistedRecord<WidgetRecordData>): WidgetPosition {
  const d = widgetRecord.data
  return {
    widgetId: widgetRecord.id,
    x: d.x,
    y: d.y,
    w: d.width,
    h: d.height,
    zIndex: d.zIndex,
  }
}

// ========================= API 辅助函数 =========================

async function apiEntityUpsert(type: string, entity: Record<string, unknown>): Promise<void> {
  try {
    await entitiesApi.updateEntity(entity.id as string, { data: entity })
  } catch (err: unknown) {
    if (isNotFoundError(err)) {
      await entitiesApi.createEntity({
        id: entity.id as string,
        type,
        panelId: (entity.panelId as string) ?? null,
        data: entity,
      })
      return
    }
    throw err
  }
}

async function apiDeleteEntitiesByPanel(panelId: string, types?: string[]): Promise<void> {
  const entityTypes = types ?? ['focusSession', 'task', 'habit', 'habitCheckin', 'moodEntry', 'calendarEvent', 'drawingStroke', 'widgetConnection', 'quizSession', 'playlist']
  for (const type of entityTypes) {
    try {
      const result = await entitiesApi.queryEntities({ type, panelId, limit: 10000 })
      if (result.items.length > 0) {
        await entitiesApi.batchDeleteEntities(result.items.map(e => e.id))
      }
    } catch { /* ignore if type has no entities */ }
  }
}

function isNotFoundError(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false
  const e = err as { message?: unknown; status?: unknown }
  return (typeof e.message === 'string' && e.message.includes('not found')) || e.status === 404
}

// ========================= Panel CRUD =========================

export async function savePanel(panel: Panel): Promise<void> {
  return withFallback(
    async () => {
      try {
        await panelsApi.updatePanel(panel.id, {
          name: panel.name,
          sortOrder: panel.order,
          settings: panel.settings as Record<string, unknown>,
          canvasTransform: panel.canvasTransform as Record<string, unknown> | null ?? null,
        })
      } catch (err: unknown) {
        if (isNotFoundError(err)) {
          await panelsApi.createPanel({
            id: panel.id,
            name: panel.name,
            sortOrder: panel.order,
            settings: panel.settings as Record<string, unknown>,
            canvasTransform: panel.canvasTransform as Record<string, unknown> | null ?? null,
          })
          return
        }
        throw err
      }
    },
    async () => {
      await ensureV2Ready()
      await runIdbTransaction([PANEL_STORE], 'readwrite', async (ctx) => {
        await upsertRecord(ctx, PANEL_STORE, panel.id, v1PanelToV2Data(panel))
      })
    },
    { operation: 'update', entityType: 'panel', entityId: panel.id, payload: { name: panel.name, sortOrder: panel.order, settings: panel.settings, canvasTransform: panel.canvasTransform } },
  )
}

export async function deletePanel(panelId: string, options?: { deleteEntityData?: boolean }): Promise<void> {
  return withFallback(
    async () => {
      if (options?.deleteEntityData) {
        await apiDeleteEntitiesByPanel(panelId)
      }
      await panelsApi.deletePanel(panelId)
    },
    async () => {
      await ensureV2Ready()
      const storeNames = [PANEL_STORE, WIDGET_RECORDS_STORE, WIDGET_STATES_STORE]
      if (options?.deleteEntityData) {
        storeNames.push(FOCUS_SESSIONS_STORE, TASKS_STORE, HABITS_STORE, HABIT_CHECKINS_STORE, MOOD_ENTRIES_STORE, CALENDAR_EVENTS_STORE, DRAWING_STROKES_STORE, WIDGET_CONNECTIONS_STORE)
      }
      await runIdbTransaction(storeNames, 'readwrite', async (ctx) => {
        const existing = await ctx.get(PANEL_STORE, panelId)
        if (existing) {
          await ctx.deleteChecked(PANEL_STORE, { id: panelId })
        }

        const widgetRecords = await ctx.indexGetAll<WidgetRecordData>(WIDGET_RECORDS_STORE, 'by_panelId', panelId)
        for (const wr of widgetRecords) {
          await ctx.deleteChecked(WIDGET_RECORDS_STORE, { id: wr.id })
          await ctx.deleteChecked(WIDGET_STATES_STORE, { id: wr.id })
        }

        if (options?.deleteEntityData) {
          await deleteEntitiesByPanelInCtx(ctx, panelId)
          await deleteStrokesByPanelInCtx(ctx, panelId)
          await deleteConnectionsByPanelInCtx(ctx, panelId)
        }
      })
    },
    { operation: 'delete', entityType: 'panel', entityId: panelId, payload: {} },
  )
}

async function deleteStrokesByPanelInCtx(ctx: IdbTxContext, panelId: string): Promise<void> {
  const ids: string[] = []
  await ctx.iterateStore<DrawingStroke>(DRAWING_STROKES_STORE, (record) => {
    if (record.data?.panelId === panelId) ids.push(record.id)
  })
  for (const id of ids) {
    await ctx.deleteChecked(DRAWING_STROKES_STORE, { id })
  }
}

async function deleteConnectionsByPanelInCtx(ctx: IdbTxContext, panelId: string): Promise<void> {
  const ids: string[] = []
  await ctx.iterateStore<WidgetConnection>(WIDGET_CONNECTIONS_STORE, (record) => {
    if (record.data?.panelId === panelId) ids.push(record.id)
  })
  for (const id of ids) {
    await ctx.deleteChecked(WIDGET_CONNECTIONS_STORE, { id })
  }
}

async function deleteEntitiesByPanelInCtx(ctx: IdbTxContext, panelId: string): Promise<void> {
  const entityStores = [FOCUS_SESSIONS_STORE, TASKS_STORE, HABITS_STORE, HABIT_CHECKINS_STORE, MOOD_ENTRIES_STORE, CALENDAR_EVENTS_STORE]
  for (const storeName of entityStores) {
    const ids: string[] = []
    await ctx.iterateStore<Record<string, unknown>>(storeName, (record) => {
      if (record.data?.panelId === panelId) {
        ids.push(record.id)
      }
    })
    for (const id of ids) {
      await ctx.deleteChecked(storeName, { id })
    }
  }
}

export async function getAllPanels(): Promise<Panel[]> {
  return withFallback(
    async () => {
      const dtos = await panelsApi.getAllPanels()
      return dtos.map(dto => ({
        id: dto.id,
        name: dto.name,
        order: dto.sortOrder,
        settings: (dto.settings as Panel['settings']) || getDefaultPanelSettings(),
        canvasTransform: (dto.canvasTransform as Panel['canvasTransform']) || undefined,
      }))
    },
    async () => {
      await ensureV2Ready()
      return runIdbTransaction([PANEL_STORE], 'readonly', async (ctx) => {
        const panels: Panel[] = []
        await ctx.iterateStore<V2PanelData>(PANEL_STORE, (record) => {
          panels.push(v2RecordToV1Panel(record))
        })
        return panels
      })
    },
  )
}

export async function saveWidgets(panelId: string, widgets: WidgetInstance[]): Promise<void> {
  return withFallback(
    async () => {
      const existingWidgets = await widgetsApi.getPanelWidgets(panelId)
      const existingIds = new Set(existingWidgets.map(w => w.id))
      const newIds = new Set(widgets.map(w => w.widgetId))

      for (const w of existingWidgets) {
        if (!newIds.has(w.id)) {
          await widgetsApi.deleteWidget(w.id)
        }
      }

      for (const widget of widgets) {
        if (existingIds.has(widget.widgetId)) {
          await widgetsApi.updateWidget(widget.widgetId, {
            type: widget.widgetType,
            minimized: widget.minimized,
            locked: widget.locked,
            colorScheme: widget.colorScheme ?? null,
            state: widget.state as Record<string, unknown>,
          })
        } else {
          await widgetsApi.createWidget(panelId, {
            id: widget.widgetId,
            type: widget.widgetType,
            minimized: widget.minimized,
            locked: widget.locked,
            colorScheme: widget.colorScheme ?? null,
            state: widget.state as Record<string, unknown>,
          })
        }
      }
    },
    async () => {
      await ensureV2Ready()
      await runIdbTransaction([WIDGET_RECORDS_STORE, WIDGET_STATES_STORE], 'readwrite', async (ctx) => {
        const existingRecords = await ctx.indexGetAll<WidgetRecordData>(WIDGET_RECORDS_STORE, 'by_panelId', panelId)
        const newIds = new Set(widgets.map(w => w.widgetId))

        for (const record of existingRecords) {
          if (!newIds.has(record.id)) {
            await ctx.deleteChecked(WIDGET_RECORDS_STORE, { id: record.id })
            await ctx.deleteChecked(WIDGET_STATES_STORE, { id: record.id })
          }
        }

        for (const widget of widgets) {
          const existingRecord = existingRecords.find(r => r.id === widget.widgetId)
          const recordData: WidgetRecordData = existingRecord
            ? { ...existingRecord.data, minimized: widget.minimized, locked: widget.locked, colorScheme: widget.colorScheme }
            : {
                panelId,
                type: widget.widgetType,
                x: 0, y: 0, width: 300, height: 200, zIndex: 0,
                minimized: widget.minimized,
                locked: widget.locked,
                colorScheme: widget.colorScheme,
                recordStatus: 'active',
                schemaVersion: 1,
              }
          await upsertRecord(ctx, WIDGET_RECORDS_STORE, widget.widgetId, recordData)

          const stateData: WidgetStateData = {
            widgetId: widget.widgetId,
            panelId,
            envelope: {
              widgetType: widget.widgetType,
              widgetVersion: '1',
              stateVersion: 1,
              updatedAt: Date.now(),
              state: widget.state,
            },
            schemaVersion: 1,
          }
          await upsertRecord(ctx, WIDGET_STATES_STORE, widget.widgetId, stateData)
        }
      })
    },
    { operation: 'update', entityType: 'widget', entityId: 'batch', payload: widgets },
  )
}

export async function getWidgets(panelId: string): Promise<WidgetInstance[]> {
  return withFallback(
    async () => {
      const dtos = await widgetsApi.getPanelWidgets(panelId)
      return dtos.map((dto): WidgetInstance => ({
        widgetId: dto.id,
        widgetType: dto.type,
        state: typeof dto.state === 'object' && dto.state !== null ? dto.state as Record<string, unknown> : {},
        minimized: dto.minimized ?? false,
        locked: dto.locked,
        colorScheme: dto.colorScheme ?? undefined,
      }))
    },
    async () => {
      await ensureV2Ready()
      return runIdbTransaction([WIDGET_RECORDS_STORE, WIDGET_STATES_STORE], 'readonly', async (ctx) => {
        const widgetRecords = await ctx.indexGetAll<WidgetRecordData>(WIDGET_RECORDS_STORE, 'by_panelId', panelId)
        const result: WidgetInstance[] = []
        for (const wr of widgetRecords) {
          const ws = await ctx.get<WidgetStateData>(WIDGET_STATES_STORE, wr.id)
          result.push(v2RecordsToV1Widget(wr, ws))
        }
        return result
      })
    },
  )
}

export async function savePositions(panelId: string, positions: WidgetPosition[]): Promise<void> {
  return withFallback(
    async () => {
      await widgetsApi.batchUpdatePositions(
        positions.map(pos => ({
          id: pos.widgetId,
          x: pos.x,
          y: pos.y,
          width: pos.w,
          height: pos.h,
          zIndex: pos.zIndex,
        }))
      )
    },
    async () => {
      await ensureV2Ready()
      await runIdbTransaction([WIDGET_RECORDS_STORE], 'readwrite', async (ctx) => {
        for (const pos of positions) {
          const existing = await ctx.get<WidgetRecordData>(WIDGET_RECORDS_STORE, pos.widgetId)
          if (existing) {
            await ctx.putCas(WIDGET_RECORDS_STORE, {
              id: pos.widgetId,
              expectedVersion: existing.version,
              data: {
                ...existing.data,
                x: pos.x,
                y: pos.y,
                width: pos.w,
                height: pos.h,
                zIndex: pos.zIndex,
              },
            })
          } else {
            await ctx.addNew(WIDGET_RECORDS_STORE, {
              id: pos.widgetId,
              data: {
                panelId,
                type: 'unknown',
                x: pos.x,
                y: pos.y,
                width: pos.w,
                height: pos.h,
                zIndex: pos.zIndex,
                recordStatus: 'active',
                schemaVersion: 1,
              },
            })
          }
        }
      })
    },
    { operation: 'update', entityType: 'widget', entityId: 'batch', payload: positions },
  )
}

export async function getPositions(panelId: string): Promise<WidgetPosition[]> {
  return withFallback(
    async () => {
      const dtos = await widgetsApi.getPanelWidgets(panelId)
      return dtos.map(dto => ({
        widgetId: dto.id,
        x: dto.x,
        y: dto.y,
        w: dto.width,
        h: dto.height,
        zIndex: dto.zIndex,
      }))
    },
    async () => {
      await ensureV2Ready()
      return runIdbTransaction([WIDGET_RECORDS_STORE], 'readonly', async (ctx) => {
        const widgetRecords = await ctx.indexGetAll<WidgetRecordData>(WIDGET_RECORDS_STORE, 'by_panelId', panelId)
        return widgetRecords.map(v2RecordToV1Position)
      })
    },
  )
}

export async function saveActivePanelId(panelId: string | null): Promise<void> {
  return withFallback(
    async () => {
      await panelsApi.setActivePanelId(panelId)
    },
    async () => {
      await ensureV2Ready()
      await runIdbTransaction([META_STORE], 'readwrite', async (ctx) => {
        await upsertRecord(ctx, META_STORE, 'activePanelId', { value: panelId })
      })
    },
    { operation: 'update', entityType: 'settings', entityId: 'activePanelId', payload: { activePanelId: panelId } },
  )
}

export async function getActivePanelId(): Promise<string | null> {
  return withFallback(
    async () => {
      return await panelsApi.getActivePanelId()
    },
    async () => {
      await ensureV2Ready()
      return runIdbTransaction([META_STORE], 'readonly', async (ctx) => {
        const record = await ctx.get<{ value: string | null }>(META_STORE, 'activePanelId')
        return record?.data?.value ?? null
      })
    },
  )
}

export async function saveSettings(settings: AppSettings): Promise<void> {
  return withFallback(
    async () => {
      await settingsApi.updateSettings(settings as unknown as Record<string, unknown>)
    },
    async () => {
      await ensureV2Ready()
      await runIdbTransaction([SETTINGS_STORE], 'readwrite', async (ctx) => {
        await upsertRecord(ctx, SETTINGS_STORE, 'appSettings', settings)
      })
    },
    { operation: 'update', entityType: 'settings', entityId: 'settings', payload: settings },
  )
}

export async function getSettings(): Promise<AppSettings | null> {
  return withFallback(
    async () => {
      const result = await settingsApi.getSettings()
      return (result && Object.keys(result).length > 0) ? result as unknown as AppSettings : null
    },
    async () => {
      await ensureV2Ready()
      return runIdbTransaction([SETTINGS_STORE], 'readonly', async (ctx) => {
        const record = await ctx.get<AppSettings>(SETTINGS_STORE, 'appSettings')
        return record?.data ?? null
      })
    },
  )
}

export async function saveDynamicWidget(def: DynamicWidgetDef): Promise<void> {
  return withFallback(
    async () => {
      try { await dynamicWidgetsApi.deleteDynamicWidget(def.widgetType) } catch { /* ignore */ }
      await dynamicWidgetsApi.createDynamicWidget({
        widgetType: def.widgetType,
        displayName: def.displayName,
        icon: def.icon || '',
        defaultLayout: def.defaultLayout || {},
        defaultState: def.defaultState || {},
        code: def.code,
      })
    },
    async () => {
      await ensureV2Ready()
      await runIdbTransaction([DYNAMIC_WIDGET_STORE], 'readwrite', async (ctx) => {
        await upsertRecord(ctx, DYNAMIC_WIDGET_STORE, def.widgetType, def)
      })
    },
    { operation: 'update', entityType: 'dynamicWidget', entityId: def.widgetType, payload: def },
  )
}

export async function deleteDynamicWidget(widgetType: string): Promise<void> {
  return withFallback(
    async () => {
      await dynamicWidgetsApi.deleteDynamicWidget(widgetType)
    },
    async () => {
      await ensureV2Ready()
      await runIdbTransaction([DYNAMIC_WIDGET_STORE], 'readwrite', async (ctx) => {
        const existing = await ctx.get(DYNAMIC_WIDGET_STORE, widgetType)
        if (existing) {
          await ctx.deleteChecked(DYNAMIC_WIDGET_STORE, { id: widgetType })
        }
      })
    },
    { operation: 'delete', entityType: 'dynamicWidget', entityId: widgetType, payload: {} },
  )
}

export async function getAllDynamicWidgets(): Promise<DynamicWidgetDef[]> {
  return withFallback(
    async () => {
      const dtos = await dynamicWidgetsApi.getAllDynamicWidgets()
      return dtos.map(dto => ({
        widgetType: dto.widgetType,
        displayName: dto.displayName,
        icon: dto.icon,
        defaultLayout: dto.defaultLayout as { w: number; h: number; minW?: number; minH?: number },
        defaultState: dto.defaultState,
        code: dto.code,
        createdAt: dto.createdAt,
        componentEnv: dto.componentEnv,
        localServices: dto.localServices,
        crossPlatform: dto.crossPlatform,
        desktopOnly: dto.desktopOnly,
      }))
    },
    async () => {
      await ensureV2Ready()
      return runIdbTransaction([DYNAMIC_WIDGET_STORE], 'readonly', async (ctx) => {
        const result: DynamicWidgetDef[] = []
        await ctx.iterateStore<DynamicWidgetDef>(DYNAMIC_WIDGET_STORE, (record) => {
          result.push(record.data)
        })
        return result
      })
    },
  )
}

export async function savePlaylist(playlist: MusicPlaylist): Promise<void> {
  return withFallback(
    async () => {
      await apiEntityUpsert('playlist', { ...playlist, id: playlist.widgetId } as unknown as Record<string, unknown>)
    },
    async () => {
      await ensureV2Ready()
      await runIdbTransaction([PLAYLIST_STORE], 'readwrite', async (ctx) => {
        await upsertRecord(ctx, PLAYLIST_STORE, playlist.widgetId, playlist)
      })
    },
    { operation: 'update', entityType: 'playlist', entityId: playlist.widgetId, payload: playlist },
  )
}

export async function getPlaylist(widgetId: string): Promise<MusicPlaylist | null> {
  return withFallback(
    async () => {
      try {
        const entity = await entitiesApi.getEntity(widgetId)
        return entity.data as unknown as MusicPlaylist
      } catch (err: unknown) {
        if (isNotFoundError(err)) return null
        throw err
      }
    },
    async () => {
      await ensureV2Ready()
      return runIdbTransaction([PLAYLIST_STORE], 'readonly', async (ctx) => {
        const record = await ctx.get<MusicPlaylist>(PLAYLIST_STORE, widgetId)
        return record?.data ?? null
      })
    },
  )
}

export async function deletePlaylist(widgetId: string): Promise<void> {
  return withFallback(
    async () => {
      await entitiesApi.deleteEntity(widgetId)
    },
    async () => {
      await ensureV2Ready()
      await runIdbTransaction([PLAYLIST_STORE], 'readwrite', async (ctx) => {
        const existing = await ctx.get(PLAYLIST_STORE, widgetId)
        if (existing) {
          await ctx.deleteChecked(PLAYLIST_STORE, { id: widgetId })
        }
      })
    },
    { operation: 'delete', entityType: 'playlist', entityId: widgetId, payload: {} },
  )
}

export async function loadAllData(): Promise<AppData> {
  const panels = await getAllPanels()

  const panelDataPromises = panels.map(async (panel) => {
    const [widgets, positions] = await Promise.all([
      getWidgets(panel.id),
      getPositions(panel.id),
    ])

    const migratedPanel = {
      ...panel,
      settings: panel.settings || getDefaultPanelSettings(),
    }
    await savePanel(migratedPanel)

    return { panel: migratedPanel, widgets, positions } as V1PanelData
  })

  const panelDataList = await Promise.all(panelDataPromises)

  const [activePanelId, settings, dynamicWidgets] = await Promise.all([
    getActivePanelId(),
    getSettings(),
    getAllDynamicWidgets(),
  ])

  return {
    panels: panelDataList,
    activePanelId,
    settings: settings || { appearance: DEFAULT_APPEARANCE, behavior: DEFAULT_BEHAVIOR },
    dynamicWidgets,
  }
}

const EXPORT_VERSION = 7
const EXPORT_SCHEMA = 'living-dashboard-v1'
const MAX_EXPORT_SIZE = 50 * 1024 * 1024
const SUPPORTED_IMPORT_VERSIONS = new Set([5, 6, 7])

const PANEL_ALLOWED_KEYS = new Set(['id', 'name', 'order', 'settings', 'canvasTransform'])
const PANEL_SETTINGS_ALLOWED_KEYS = new Set(['layoutMode', 'gridSize'])
const WIDGET_ALLOWED_KEYS = new Set(['widgetId', 'widgetType', 'state', 'minimized', 'locked', 'colorScheme'])
const POSITION_ALLOWED_KEYS = new Set(['widgetId', 'x', 'y', 'w', 'h', 'zIndex'])
const APPEARANCE_ALLOWED_KEYS = new Set([
  'accentColor', 'backgroundType', 'backgroundColor', 'backgroundGradient',
  'backgroundImage', 'surfaceColor', 'surfaceBorderColor', 'surfaceOpacity',
  'surfaceBlur', 'textColor', 'textMutedColor', 'fontSize',
])
const BEHAVIOR_ALLOWED_KEYS = new Set([
  'defaultLayoutMode', 'defaultGridSize', 'startupPanel',
  'confirmBeforeDelete', 'widgetSnapToEdge',
])
const DYNAMIC_WIDGET_ALLOWED_KEYS = new Set([
  'widgetType', 'displayName', 'icon', 'defaultLayout', 'defaultState', 'code', 'createdAt',
])

const FOCUS_SESSION_ALLOWED_KEYS = new Set([
  'id', 'panelId', 'focusTimerWidgetId', 'taskId', 'taskTitleSnapshot',
  'label', 'startedAt', 'endedAt', 'durationMs', 'mode', 'createdAt', 'schemaVersion',
])

const TASK_ALLOWED_KEYS = new Set([
  'id', 'panelId', 'title', 'status', 'priority', 'dueAt',
  'createdAt', 'updatedAt', 'schemaVersion',
])

const HABIT_ALLOWED_KEYS = new Set([
  'id', 'panelId', 'title', 'color', 'archivedAt', 'createdAt', 'updatedAt', 'schemaVersion',
])

const HABIT_CHECKIN_ALLOWED_KEYS = new Set([
  'id', 'panelId', 'habitId', 'date', 'createdAt', 'schemaVersion',
])

const MOOD_ENTRY_ALLOWED_KEYS = new Set([
  'id', 'panelId', 'level', 'note', 'date', 'createdAt', 'schemaVersion',
])

const CALENDAR_EVENT_ALLOWED_KEYS = new Set([
  'id', 'panelId', 'title', 'startsAt', 'endsAt', 'note', 'createdAt', 'updatedAt', 'schemaVersion',
])

const QUIZ_SESSION_ALLOWED_KEYS = new Set([
  'id', 'panelId', 'latexQuizWidgetId', 'category', 'questionIds',
  'userAnswers', 'gradeResults', 'correctCount', 'totalCount',
  'startedAt', 'finishedAt', 'schemaVersion',
])

const DRAWING_STROKE_ALLOWED_KEYS = new Set([
  'id', 'panelId', 'type', 'points', 'text', 'style', 'createdAt', 'updatedAt', 'schemaVersion',
])

const WIDGET_CONNECTION_ALLOWED_KEYS = new Set([
  'id', 'panelId', 'source', 'target', 'type', 'label', 'style', 'createdAt', 'updatedAt', 'schemaVersion',
])

function filterObject<T extends Record<string, unknown>>(obj: T, allowedKeys: Set<string>): Partial<T> {
  const result: Record<string, unknown> = {}
  for (const key of Object.keys(obj)) {
    if (allowedKeys.has(key)) {
      result[key] = obj[key]
    }
  }
  return result as Partial<T>
}

function filterPanelSettings(settings: Record<string, unknown>): Record<string, unknown> {
  return filterObject(settings, PANEL_SETTINGS_ALLOWED_KEYS)
}

function filterPanel(panel: Panel): Record<string, unknown> {
  const filtered = filterObject(panel as unknown as Record<string, unknown>, PANEL_ALLOWED_KEYS)
  if (panel.settings) {
    filtered.settings = filterPanelSettings(panel.settings as unknown as Record<string, unknown>)
  }
  return filtered
}

function filterWidget(widget: WidgetInstance): Record<string, unknown> {
  return filterObject(widget as unknown as Record<string, unknown>, WIDGET_ALLOWED_KEYS)
}

function filterPosition(pos: WidgetPosition): Record<string, unknown> {
  return filterObject(pos as unknown as Record<string, unknown>, POSITION_ALLOWED_KEYS)
}

function filterAppearance(appearance: Record<string, unknown>): Record<string, unknown> {
  return filterObject(appearance, APPEARANCE_ALLOWED_KEYS)
}

function filterBehavior(behavior: Record<string, unknown>): Record<string, unknown> {
  return filterObject(behavior, BEHAVIOR_ALLOWED_KEYS)
}

function filterDynamicWidget(dw: DynamicWidgetDef): Record<string, unknown> {
  return filterObject(dw as unknown as Record<string, unknown>, DYNAMIC_WIDGET_ALLOWED_KEYS)
}

function filterFocusSession(session: FocusSession): Record<string, unknown> {
  return filterObject(session as unknown as Record<string, unknown>, FOCUS_SESSION_ALLOWED_KEYS)
}

function filterTask(task: Task): Record<string, unknown> {
  return filterObject(task as unknown as Record<string, unknown>, TASK_ALLOWED_KEYS)
}

function filterHabit(habit: Habit): Record<string, unknown> {
  return filterObject(habit as unknown as Record<string, unknown>, HABIT_ALLOWED_KEYS)
}

function filterHabitCheckin(checkin: HabitCheckin): Record<string, unknown> {
  return filterObject(checkin as unknown as Record<string, unknown>, HABIT_CHECKIN_ALLOWED_KEYS)
}

function filterMoodEntry(entry: MoodEntry): Record<string, unknown> {
  return filterObject(entry as unknown as Record<string, unknown>, MOOD_ENTRY_ALLOWED_KEYS)
}

function filterCalendarEvent(event: CalendarEvent): Record<string, unknown> {
  return filterObject(event as unknown as Record<string, unknown>, CALENDAR_EVENT_ALLOWED_KEYS)
}

function filterQuizSession(session: QuizSession): Record<string, unknown> {
  return filterObject(session as unknown as Record<string, unknown>, QUIZ_SESSION_ALLOWED_KEYS)
}

export async function exportAllData(): Promise<Blob> {
  const data = await loadAllData()

  // 通用实体类型列表（API 模式和 IDB 模式共用）
  const entityTypes = [
    'focusSession', 'task', 'habit', 'habitCheckin', 'moodEntry', 'calendarEvent',
    'drawingStroke', 'widgetConnection', 'quizSession',
    'note', 'journal', 'quickNote', 'savingsGoal', 'savingsTransaction',
    'aiConversation', 'aiMemory',
    'vocabDeck', 'vocabProgress', 'sudokuGame', 'mistake', 'playlist',
  ] as const

  // 收集所有实体数据
  const entityMap: Record<string, unknown[]> = {}
  for (const type of entityTypes) {
    entityMap[type] = []
  }

  if (getBackend() === 'api') {
    // API 模式：批量查询所有实体类型
    const results = await Promise.all(
      entityTypes.map(type =>
        entitiesApi.queryEntities({ type, limit: 10000 })
          .then(r => r.items.map(e => ({ ...e.data, id: e.id, panelId: e.panelId, widgetId: e.widgetId })))
          .catch(() => [] as unknown[])
      )
    )
    for (let i = 0; i < entityTypes.length; i++) {
      entityMap[entityTypes[i]] = results[i]
    }
  } else {
    // IDB 模式：通过各 dbStores 的函数读取
    await ensureV2Ready()
    const idbStores = [
      FOCUS_SESSIONS_STORE, TASKS_STORE, HABITS_STORE, HABIT_CHECKINS_STORE,
      MOOD_ENTRIES_STORE, CALENDAR_EVENTS_STORE, DRAWING_STROKES_STORE,
      WIDGET_CONNECTIONS_STORE, QUIZ_SESSIONS_STORE,
    ]
    const idbTypes = [
      'focusSession', 'task', 'habit', 'habitCheckin',
      'moodEntry', 'calendarEvent', 'drawingStroke',
      'widgetConnection', 'quizSession',
    ]
    const idbData = await runIdbTransaction(idbStores, 'readonly', async (ctx) => {
      const result: Record<string, unknown[]> = {}
      for (const type of idbTypes) result[type] = []
      const storeNames = idbStores
      for (let i = 0; i < storeNames.length; i++) {
        await ctx.iterateStore(storeNames[i], (record) => {
          const type = idbTypes[i]
          if (type) result[type].push(record.data)
        })
      }
      return result
    })
    for (const type of idbTypes) {
      entityMap[type] = idbData[type] || []
    }

    // 额外的 dbStores（不在 db.ts 的 store 列表中）
    try {
      const { getAllNotes } = await import('./dbStores/notes')
      entityMap['note'] = await getAllNotes().catch(() => [])
    } catch { /* ignore */ }
    try {
      const { getAllJournals } = await import('./dbStores/journals')
      entityMap['journal'] = await getAllJournals().catch(() => [])
    } catch { /* ignore */ }
    try {
      const { getAllQuickNotes } = await import('./dbStores/quickNotes')
      entityMap['quickNote'] = await getAllQuickNotes().catch(() => [])
    } catch { /* ignore */ }
    try {
      const { getAllSavingsGoals } = await import('./dbStores/savings')
      const goals = await getAllSavingsGoals().catch(() => [] as unknown[])
      entityMap['savingsGoal'] = goals
      // 获取所有 savings transactions（需要遍历 goals）
      const { getSavingsTransactionsByGoal } = await import('./dbStores/savings')
      const allTx: unknown[] = []
      for (const g of goals) {
        const tx = await getSavingsTransactionsByGoal((g as { id: string }).id).catch(() => [])
        allTx.push(...tx)
      }
      entityMap['savingsTransaction'] = allTx
    } catch { /* ignore */ }
    try {
      const { getAllAIMemories } = await import('./dbStores/aiData')
      entityMap['aiMemory'] = await getAllAIMemories().catch(() => [])
    } catch { /* ignore */ }
    try {
      // AI conversations: 通过 IDB store 直接读取
      await ensureV2Ready()
      const convData = await runIdbTransaction(['aiConversations'], 'readonly', async (ctx) => {
        const items: unknown[] = []
        await ctx.iterateStore<unknown>('aiConversations', (record) => items.push(record.data))
        return items
      })
      entityMap['aiConversation'] = convData
    } catch { /* ignore */ }
    try {
      const { getAllVocabDecks } = await import('./dbStores/vocabDecks')
      const decks = await getAllVocabDecks().catch(() => [] as unknown[])
      entityMap['vocabDeck'] = decks
      // 获取所有 vocab progress（需要遍历 decks）
      const { getVocabProgressByDeck } = await import('./dbStores/vocabProgress')
      const allProgress: unknown[] = []
      for (const d of decks) {
        const progress = await getVocabProgressByDeck((d as { id: string }).id).catch(() => [])
        allProgress.push(...progress)
      }
      entityMap['vocabProgress'] = allProgress
    } catch { /* ignore */ }
    try {
      const { getSudokuGamesByPanel } = await import('./dbStores/sudokuGames')
      const allSudokuGames: unknown[] = []
      for (const pd of data.panels) {
        const games = await getSudokuGamesByPanel(pd.panel.id).catch(() => [])
        allSudokuGames.push(...games)
      }
      entityMap['sudokuGame'] = allSudokuGames
    } catch { /* ignore */ }
    try {
      const { getAllMistakes } = await import('./dbStores/mistakes')
      entityMap['mistake'] = await getAllMistakes().catch(() => [])
    } catch { /* ignore */ }
    try {
      // Playlists: 通过 IDB store 直接读取
      await ensureV2Ready()
      const plData = await runIdbTransaction([PLAYLIST_STORE], 'readonly', async (ctx) => {
        const items: unknown[] = []
        await ctx.iterateStore<unknown>(PLAYLIST_STORE, (record) => items.push(record.data))
        return items
      })
      entityMap['playlist'] = plData
    } catch { /* ignore */ }
  }

  const exportPayload = {
    version: EXPORT_VERSION,
    schema: EXPORT_SCHEMA,
    exportedAt: new Date().toISOString(),
    panels: data.panels.map(pd => ({
      panel: filterPanel(pd.panel),
      widgets: pd.widgets.map(filterWidget),
      positions: pd.positions.map(filterPosition),
    })),
    activePanelId: data.activePanelId,
    settings: {
      appearance: filterAppearance(data.settings.appearance as unknown as Record<string, unknown>),
      behavior: filterBehavior(data.settings.behavior as unknown as Record<string, unknown>),
    },
    dynamicWidgets: (data.dynamicWidgets || []).map(filterDynamicWidget),
    focusSessions: entityMap['focusSession'].map(s => {
      try { return filterFocusSession(migrateFocusSession(s)) } catch { return null }
    }).filter(Boolean),
    tasks: entityMap['task'].map(t => {
      try { return filterTask(migrateTask(t)) } catch { return null }
    }).filter(Boolean),
    habits: entityMap['habit'].map(h => {
      try { return filterHabit(migrateHabit(h)) } catch { return null }
    }).filter(Boolean),
    habitCheckins: entityMap['habitCheckin'].map(c => {
      try { return filterHabitCheckin(migrateHabitCheckin(c)) } catch { return null }
    }).filter(Boolean),
    moodEntries: entityMap['moodEntry'].map(e => {
      try { return filterMoodEntry(migrateMoodEntry(e)) } catch { return null }
    }).filter(Boolean),
    calendarEvents: entityMap['calendarEvent'].map(e => {
      try { return filterCalendarEvent(migrateCalendarEvent(e)) } catch { return null }
    }).filter(Boolean),
    drawingStrokes: (entityMap['drawingStroke'] as DrawingStroke[]).filter(s => {
      if (!s?.id || !s?.panelId) return false
      return true
    }).map(s => {
      try { return filterObject(s as unknown as Record<string, unknown>, DRAWING_STROKE_ALLOWED_KEYS) } catch { return null }
    }).filter(Boolean),
    widgetConnections: (entityMap['widgetConnection'] as WidgetConnection[]).filter(c => {
      if (!c?.id || !c?.panelId) return false
      return true
    }).map(c => {
      try { return filterObject(c as unknown as Record<string, unknown>, WIDGET_CONNECTION_ALLOWED_KEYS) } catch { return null }
    }).filter(Boolean),
    quizSessions: (entityMap['quizSession'] as QuizSession[]).filter(s => {
      if (!s?.id || !s?.panelId) return false
      return true
    }).map(s => {
      try { return filterQuizSession(migrateQuizSession(s)) } catch { return null }
    }).filter(Boolean),
    // 新增的实体类型（直接导出原始数据，导入端会处理格式）
    notes: entityMap['note'].filter(n => Boolean(n && (n as Record<string, unknown>).id)),
    journals: entityMap['journal'].filter(j => Boolean(j && (j as Record<string, unknown>).id)),
    quickNotes: entityMap['quickNote'].filter(q => Boolean(q && (q as Record<string, unknown>).id)),
    savingsGoals: entityMap['savingsGoal'].filter(s => Boolean(s && (s as Record<string, unknown>).id)),
    savingsTransactions: entityMap['savingsTransaction'].filter(s => Boolean(s && (s as Record<string, unknown>).id)),
    aiConversations: entityMap['aiConversation'].filter(c => Boolean(c && (c as Record<string, unknown>).id)),
    aiMemories: entityMap['aiMemory'].filter(m => Boolean(m && (m as Record<string, unknown>).id)),
    vocabDecks: entityMap['vocabDeck'].filter(v => Boolean(v && (v as Record<string, unknown>).id)),
    vocabProgress: entityMap['vocabProgress'].filter(v => Boolean(v && (v as Record<string, unknown>).id)),
    sudokuGames: entityMap['sudokuGame'].filter(s => Boolean(s && (s as Record<string, unknown>).id)),
    mistakes: entityMap['mistake'].filter(m => Boolean(m && (m as Record<string, unknown>).id)),
    playlists: entityMap['playlist'].filter(p => Boolean(p && (p as Record<string, unknown>).widgetId)),
  }

  const json = JSON.stringify(exportPayload)
  const blob = new Blob([json], { type: 'application/json' })

  if (blob.size > MAX_EXPORT_SIZE) {
    throw new Error(`导出数据过大 (${(blob.size / 1024 / 1024).toFixed(1)}MB)，超过 50MB 上限。请删除大体积组件数据后重试。`)
  }

  return blob
}

export interface ImportReport {
  imported: Record<string, number>
  skipped: Record<string, number>
  warnings: string[]
}

function validateImportData(raw: unknown): { valid: boolean; data?: Record<string, unknown>; error?: string } {
  if (!raw || typeof raw !== 'object') {
    return { valid: false, error: '导入数据格式错误：不是有效的 JSON 对象' }
  }

  const data = raw as Record<string, unknown>

  if (!SUPPORTED_IMPORT_VERSIONS.has(data.version as number)) {
    return { valid: false, error: `不支持的版本号: ${data.version}，当前支持版本: ${EXPORT_VERSION} (兼容 v5)` }
  }

  if (data.schema !== EXPORT_SCHEMA) {
    return { valid: false, error: `不支持的 schema: ${data.schema}，当前支持: ${EXPORT_SCHEMA}` }
  }

  if (!Array.isArray(data.panels)) {
    return { valid: false, error: '导入数据缺少 panels 数组' }
  }

  return { valid: true, data }
}

export async function importData(blob: Blob): Promise<ImportReport> {
  const report: ImportReport = {
    imported: {},
    skipped: {},
    warnings: [],
  }

  let raw: unknown
  try {
    const text = await blob.text()
    raw = JSON.parse(text)
  } catch {
    throw new Error('导入文件不是有效的 JSON 格式')
  }

  const validation = validateImportData(raw)
  if (!validation.valid) {
    throw new Error(validation.error)
  }

  const data = validation.data!
  await ensureV2Ready()

  const allStoreNames = [
    PANEL_STORE, WIDGET_RECORDS_STORE, WIDGET_STATES_STORE, SETTINGS_STORE,
    META_STORE, DYNAMIC_WIDGET_STORE, FOCUS_SESSIONS_STORE, TASKS_STORE,
    HABITS_STORE, HABIT_CHECKINS_STORE, MOOD_ENTRIES_STORE, CALENDAR_EVENTS_STORE,
    DRAWING_STROKES_STORE, WIDGET_CONNECTIONS_STORE, QUIZ_SESSIONS_STORE,
  ]

  await runIdbTransaction(allStoreNames, 'readwrite', async (ctx) => {
    await clearStore(ctx, PANEL_STORE)
    await clearStore(ctx, WIDGET_RECORDS_STORE)
    await clearStore(ctx, WIDGET_STATES_STORE)
    await clearStore(ctx, DYNAMIC_WIDGET_STORE)
    await clearStore(ctx, FOCUS_SESSIONS_STORE)
    await clearStore(ctx, TASKS_STORE)
    await clearStore(ctx, HABITS_STORE)
    await clearStore(ctx, HABIT_CHECKINS_STORE)
    await clearStore(ctx, MOOD_ENTRIES_STORE)
    await clearStore(ctx, CALENDAR_EVENTS_STORE)
    await clearStore(ctx, DRAWING_STROKES_STORE)
    await clearStore(ctx, WIDGET_CONNECTIONS_STORE)
    await clearStore(ctx, QUIZ_SESSIONS_STORE)

    const panels = data.panels as Array<{ panel: Record<string, unknown>; widgets: Record<string, unknown>[]; positions: Record<string, unknown>[] }>

    let importedPanels = 0
    let skippedPanels = 0
    let importedWidgets = 0
    let skippedWidgets = 0

    for (const pd of panels) {
      try {
        if (!pd.panel?.id || !pd.panel?.name) {
          report.warnings.push(`跳过无效面板: 缺少 id 或 name`)
          skippedPanels++
          continue
        }

        const panel: Panel = {
          id: pd.panel.id as string,
          name: pd.panel.name as string,
          order: typeof pd.panel.order === 'number' ? pd.panel.order : 0,
          settings: (pd.panel.settings as Panel['settings']) || getDefaultPanelSettings(),
          canvasTransform: pd.panel.canvasTransform as Panel['canvasTransform'],
        }

        await ctx.addNew(PANEL_STORE, { id: panel.id, data: v1PanelToV2Data(panel) })

        const validWidgets: WidgetInstance[] = []
        for (const w of (pd.widgets || [])) {
          if (!w.widgetId || !w.widgetType) {
            report.warnings.push(`面板 "${pd.panel.name}" 中跳过无效组件: 缺少 widgetId 或 widgetType`)
            skippedWidgets++
            continue
          }
          validWidgets.push({
            widgetId: w.widgetId as string,
            widgetType: w.widgetType as string,
            state: (w.state || {}) as Record<string, unknown>,
            minimized: Boolean(w.minimized),
            locked: typeof w.locked === 'boolean' ? w.locked : undefined,
            colorScheme: typeof w.colorScheme === 'string' ? w.colorScheme : undefined,
          })
          importedWidgets++
        }

        const posLookup = new Map<string, WidgetPosition>()
        const validPositions: WidgetPosition[] = []
        for (const p of (pd.positions || [])) {
          if (!p.widgetId || typeof p.x !== 'number' || typeof p.y !== 'number') {
            continue
          }
          const pos: WidgetPosition = {
            widgetId: p.widgetId as string,
            x: p.x as number,
            y: p.y as number,
            w: typeof p.w === 'number' ? p.w : 300,
            h: typeof p.h === 'number' ? p.h : 200,
            zIndex: typeof p.zIndex === 'number' ? p.zIndex : 0,
          }
          validPositions.push(pos)
          posLookup.set(pos.widgetId, pos)
        }

        for (const widget of validWidgets) {
          const pos = posLookup.get(widget.widgetId)
          await ctx.addNew(WIDGET_RECORDS_STORE, {
            id: widget.widgetId,
            data: {
              panelId: panel.id,
              type: widget.widgetType,
              x: pos?.x ?? 0,
              y: pos?.y ?? 0,
              width: pos?.w ?? 300,
              height: pos?.h ?? 200,
              zIndex: pos?.zIndex ?? 0,
              minimized: widget.minimized,
              locked: widget.locked,
              recordStatus: 'active',
              schemaVersion: 1,
            } as WidgetRecordData,
          })
          await ctx.addNew(WIDGET_STATES_STORE, {
            id: widget.widgetId,
            data: {
              widgetId: widget.widgetId,
              panelId: panel.id,
              envelope: {
                widgetType: widget.widgetType,
                widgetVersion: '1',
                stateVersion: 1,
                updatedAt: Date.now(),
                state: widget.state,
              },
              schemaVersion: 1,
            } as WidgetStateData,
          })
        }

        importedPanels++
      } catch (e) {
        report.warnings.push(`面板导入出错: ${e}`)
        skippedPanels++
      }
    }

    if (data.settings) {
      const settings = data.settings as Record<string, unknown>
      await upsertRecord(ctx, SETTINGS_STORE, 'appSettings', {
        appearance: settings.appearance || DEFAULT_APPEARANCE,
        behavior: settings.behavior || DEFAULT_BEHAVIOR,
      })
      report.imported['settings'] = 1
    }

    if (data.activePanelId) {
      await upsertRecord(ctx, META_STORE, 'activePanelId', { value: data.activePanelId })
    }

    let importedDynamicWidgets = 0
    for (const dw of (data.dynamicWidgets || []) as Record<string, unknown>[]) {
      if (!dw.widgetType || !dw.code) {
        report.warnings.push(`跳过无效动态组件: 缺少 widgetType 或 code`)
        continue
      }
      await upsertRecord(ctx, DYNAMIC_WIDGET_STORE, dw.widgetType as string, dw as unknown as DynamicWidgetDef)
      importedDynamicWidgets++
    }

    const validPanelIds = new Set<string>()
    const allValidWidgetIds = new Set<string>()
    for (const pd of panels) {
      if (pd.panel?.id) validPanelIds.add(pd.panel.id as string)
      for (const w of (pd.widgets || [])) {
        if (w.widgetId) allValidWidgetIds.add(w.widgetId as string)
      }
    }

    let importedTasks = 0
    let skippedTasks = 0
    const validTaskMap = new Map<string, Task>()

    for (const t of (data.tasks || []) as Record<string, unknown>[]) {
      try {
        const task = migrateTask(t)
        if (!validPanelIds.has(task.panelId)) {
          report.warnings.push(`跳过任务 "${task.title}": panelId 不存在`)
          skippedTasks++
          continue
        }
        await upsertRecord(ctx, TASKS_STORE, task.id, task)
        validTaskMap.set(task.id, task)
        importedTasks++
      } catch (e) {
        report.warnings.push(`跳过无效任务: ${e}`)
        skippedTasks++
      }
    }

    let importedSessions = 0
    let skippedSessions = 0

    for (const s of (data.focusSessions || []) as Record<string, unknown>[]) {
      try {
        const session = migrateFocusSession(s)
        if (!validPanelIds.has(session.panelId)) {
          report.warnings.push(`跳过专注记录: panelId 不存在`)
          skippedSessions++
          continue
        }
        if (session.taskId) {
          const task = validTaskMap.get(session.taskId)
          if (!task || task.panelId !== session.panelId) {
            session.taskId = undefined
            if (!session.taskTitleSnapshot) session.taskTitleSnapshot = '未知任务'
          } else {
            session.taskTitleSnapshot = task.title.slice(0, 200)
          }
        }
        await upsertRecord(ctx, FOCUS_SESSIONS_STORE, session.id, session)
        importedSessions++
      } catch (e) {
        report.warnings.push(`跳过无效专注记录: ${e}`)
        skippedSessions++
      }
    }

    let importedHabits = 0
    let skippedHabits = 0
    const validHabitMap = new Map<string, Habit>()

    for (const h of (data.habits || []) as Record<string, unknown>[]) {
      try {
        const habit = migrateHabit(h)
        if (!validPanelIds.has(habit.panelId)) {
          report.warnings.push(`跳过习惯 "${habit.title}": panelId 不存在`)
          skippedHabits++
          continue
        }
        await upsertRecord(ctx, HABITS_STORE, habit.id, habit)
        validHabitMap.set(habit.id, habit)
        importedHabits++
      } catch (e) {
        report.warnings.push(`跳过无效习惯: ${e}`)
        skippedHabits++
      }
    }

    let importedHabitCheckins = 0
    let skippedHabitCheckins = 0

    for (const c of (data.habitCheckins || []) as Record<string, unknown>[]) {
      try {
        const checkin = migrateHabitCheckin(c)
        if (!validPanelIds.has(checkin.panelId)) {
          report.warnings.push(`跳过打卡记录: panelId 不存在`)
          skippedHabitCheckins++
          continue
        }
        const habit = validHabitMap.get(checkin.habitId)
        if (!habit) {
          report.warnings.push(`跳过打卡记录: habitId 不存在`)
          skippedHabitCheckins++
          continue
        }
        if (habit.panelId !== checkin.panelId) {
          report.warnings.push(`跳过打卡记录: panelId 与习惯不一致`)
          skippedHabitCheckins++
          continue
        }
        await upsertRecord(ctx, HABIT_CHECKINS_STORE, checkin.id, checkin)
        importedHabitCheckins++
      } catch (e) {
        report.warnings.push(`跳过无效打卡记录: ${e}`)
        skippedHabitCheckins++
      }
    }

    let importedMoodEntries = 0
    let skippedMoodEntries = 0

    for (const e of (data.moodEntries || []) as Record<string, unknown>[]) {
      try {
        const entry = migrateMoodEntry(e)
        if (!validPanelIds.has(entry.panelId)) {
          report.warnings.push(`跳过心情记录: panelId 不存在`)
          skippedMoodEntries++
          continue
        }
        await upsertRecord(ctx, MOOD_ENTRIES_STORE, entry.id, entry)
        importedMoodEntries++
      } catch (e2) {
        report.warnings.push(`跳过无效心情记录: ${e2}`)
        skippedMoodEntries++
      }
    }

    let importedCalendarEvents = 0
    let skippedCalendarEvents = 0
    const seenCalendarEventIds = new Set<string>()

    for (const e of (data.calendarEvents || []) as Record<string, unknown>[]) {
      try {
        const stripped = filterObject(e, CALENDAR_EVENT_ALLOWED_KEYS)
        const event = migrateCalendarEvent(stripped)
        if (!validPanelIds.has(event.panelId)) {
          report.warnings.push(`跳过日程 "${event.title}": panelId 不存在`)
          skippedCalendarEvents++
          continue
        }
        if (seenCalendarEventIds.has(event.id)) {
          report.warnings.push(`跳过日程 "${event.title}": 导入中重复 ID`)
          skippedCalendarEvents++
          continue
        }
        seenCalendarEventIds.add(event.id)
        const existing = await ctx.get(CALENDAR_EVENTS_STORE, event.id)
        if (existing) {
          report.warnings.push(`跳过日程 "${event.title}": ID 冲突`)
          skippedCalendarEvents++
          continue
        }
        await upsertRecord(ctx, CALENDAR_EVENTS_STORE, event.id, event)
        importedCalendarEvents++
      } catch (e2) {
        report.warnings.push(`跳过无效日程: ${e2}`)
        skippedCalendarEvents++
      }
    }

    report.imported['panels'] = importedPanels
    report.imported['widgets'] = importedWidgets
    report.imported['dynamicWidgets'] = importedDynamicWidgets
    report.imported['tasks'] = importedTasks
    report.imported['focusSessions'] = importedSessions
    report.imported['habits'] = importedHabits
    report.imported['habitCheckins'] = importedHabitCheckins
    report.imported['moodEntries'] = importedMoodEntries
    report.imported['calendarEvents'] = importedCalendarEvents
    report.skipped['panels'] = skippedPanels
    report.skipped['widgets'] = skippedWidgets
    report.skipped['tasks'] = skippedTasks
    report.skipped['focusSessions'] = skippedSessions
    report.skipped['habits'] = skippedHabits
    report.skipped['habitCheckins'] = skippedHabitCheckins
    report.skipped['moodEntries'] = skippedMoodEntries
    report.skipped['calendarEvents'] = skippedCalendarEvents

    // v6 字段：笔迹 + 连线（v5 数据中可能缺失，按空处理）
    let importedStrokes = 0
    let skippedStrokes = 0
    for (const s of (data.drawingStrokes || []) as DrawingStroke[]) {
      try {
        if (!s.id || !s.panelId || !validPanelIds.has(s.panelId)) {
          skippedStrokes++
          continue
        }
        await upsertRecord(ctx, DRAWING_STROKES_STORE, s.id, s)
        importedStrokes++
      } catch {
        skippedStrokes++
      }
    }
    report.imported['drawingStrokes'] = importedStrokes
    report.skipped['drawingStrokes'] = skippedStrokes

    let importedConnections = 0
    let skippedConnections = 0
    for (const c of (data.widgetConnections || []) as WidgetConnection[]) {
      try {
        if (!c.id || !c.panelId || !validPanelIds.has(c.panelId)) {
          skippedConnections++
          continue
        }
        if (!c.source?.widgetId || !c.target?.widgetId) {
          skippedConnections++
          continue
        }
        // source/target widget 必须存在于本批次导入的面板
        if (!allValidWidgetIds.has(c.source.widgetId) || !allValidWidgetIds.has(c.target.widgetId)) {
          report.warnings.push(`跳过连线 "${c.id}": source/target widget 不存在`)
          skippedConnections++
          continue
        }
        await upsertRecord(ctx, WIDGET_CONNECTIONS_STORE, c.id, c)
        importedConnections++
      } catch {
        skippedConnections++
      }
    }
    report.imported['widgetConnections'] = importedConnections
    report.skipped['widgetConnections'] = skippedConnections

    // v7 字段：LaTeX 答题会话
    let importedQuizSessions = 0
    let skippedQuizSessions = 0
    const seenQuizSessionIds = new Set<string>()
    for (const qs of (data.quizSessions || []) as QuizSession[]) {
      try {
        if (!qs.id || !qs.panelId || !validPanelIds.has(qs.panelId)) {
          skippedQuizSessions++
          continue
        }
        if (seenQuizSessionIds.has(qs.id)) {
          skippedQuizSessions++
          continue
        }
        seenQuizSessionIds.add(qs.id)
        const stripped = filterObject(qs as unknown as Record<string, unknown>, QUIZ_SESSION_ALLOWED_KEYS)
        const session = migrateQuizSession(stripped)
        const existing = await ctx.get(QUIZ_SESSIONS_STORE, session.id)
        if (existing) {
          skippedQuizSessions++
          continue
        }
        await upsertRecord(ctx, QUIZ_SESSIONS_STORE, session.id, session)
        importedQuizSessions++
      } catch {
        skippedQuizSessions++
      }
    }
    report.imported['quizSessions'] = importedQuizSessions
    report.skipped['quizSessions'] = skippedQuizSessions
  })

  return report
}

export async function importAllData(json: string): Promise<AppData> {
  const blob = new Blob([json], { type: 'application/json' })
  const report = await importData(blob)
  console.log('[Import] Report:', report)
  return await loadAllData()
}

export async function clearAllData(): Promise<void> {
  return withFallback(
    async () => {
      const allPanels = await panelsApi.getAllPanels()
      for (const p of allPanels) {
        await panelsApi.deletePanel(p.id)
      }
      const entityTypes = ['focusSession', 'task', 'habit', 'habitCheckin', 'moodEntry', 'calendarEvent', 'drawingStroke', 'widgetConnection', 'quizSession', 'playlist']
      for (const type of entityTypes) {
        try {
          const result = await entitiesApi.queryEntities({ type, limit: 10000 })
          if (result.items.length > 0) {
            await entitiesApi.batchDeleteEntities(result.items.map(e => e.id))
          }
        } catch { /* ignore */ }
      }
      try { await settingsApi.updateSettings({}) } catch { /* ignore */ }
      try {
        const dws = await dynamicWidgetsApi.getAllDynamicWidgets()
        for (const dw of dws) {
          await dynamicWidgetsApi.deleteDynamicWidget(dw.widgetType)
        }
      } catch { /* ignore */ }
    },
    async () => {
      await ensureV2Ready()
      const storeNames = [
        PANEL_STORE, WIDGET_RECORDS_STORE, WIDGET_STATES_STORE, SETTINGS_STORE,
        META_STORE, DYNAMIC_WIDGET_STORE, PLAYLIST_STORE, FOCUS_SESSIONS_STORE,
        TASKS_STORE, HABITS_STORE, HABIT_CHECKINS_STORE, MOOD_ENTRIES_STORE,
        CALENDAR_EVENTS_STORE, DRAWING_STROKES_STORE, WIDGET_CONNECTIONS_STORE,
        QUIZ_SESSIONS_STORE,
      ]
      await runIdbTransaction(storeNames, 'readwrite', async (ctx) => {
        for (const name of storeNames) {
          await clearStore(ctx, name)
        }
      })
    },
  )
}

// ========================= FocusSession CRUD =========================

export async function saveFocusSession(session: FocusSession): Promise<void> {
  return withFallback(
    async () => {
      await apiEntityUpsert('focusSession', session as unknown as Record<string, unknown>)
    },
    async () => {
      await ensureV2Ready()
      await runIdbTransaction([FOCUS_SESSIONS_STORE], 'readwrite', async (ctx) => {
        await upsertRecord(ctx, FOCUS_SESSIONS_STORE, session.id, session)
      })
    },
    { operation: 'update', entityType: 'entity', entityId: session.id, payload: { type: 'focusSession', panelId: session.panelId, data: session } },
  )
}

export async function getFocusSessionsByPanel(panelId: string): Promise<FocusSession[]> {
  return withFallback(
    async () => {
      const result = await entitiesApi.queryEntities({ type: 'focusSession', panelId })
      return result.items.map(e => migrateFocusSession(entityDataWithMeta(e))).filter(Boolean) as FocusSession[]
    },
    async () => {
      await ensureV2Ready()
      return runIdbTransaction([FOCUS_SESSIONS_STORE], 'readonly', async (ctx) => {
        const result: FocusSession[] = []
        await ctx.iterateStore<unknown>(FOCUS_SESSIONS_STORE, (record) => {
          try {
            const s = migrateFocusSession(record.data)
            if (s.panelId === panelId) result.push(s)
          } catch {
            console.warn('[DB] skipping invalid focusSession', record.data)
          }
        })
        return result
      })
    },
  )
}

export async function getFocusSessionsByWidget(widgetId: string): Promise<FocusSession[]> {
  return withFallback(
    async () => {
      const result = await entitiesApi.queryEntities({ type: 'focusSession', limit: 10000 })
      return result.items
        .map(e => { try { return migrateFocusSession(entityDataWithMeta(e)) } catch { return null } })
        .filter((s): s is FocusSession => s !== null && s.focusTimerWidgetId === widgetId)
    },
    async () => {
      await ensureV2Ready()
      return runIdbTransaction([FOCUS_SESSIONS_STORE], 'readonly', async (ctx) => {
        const result: FocusSession[] = []
        await ctx.iterateStore<unknown>(FOCUS_SESSIONS_STORE, (record) => {
          try {
            const s = migrateFocusSession(record.data)
            if (s.focusTimerWidgetId === widgetId) result.push(s)
          } catch {
            console.warn('[DB] skipping invalid focusSession', record.data)
          }
        })
        return result
      })
    },
  )
}

export async function deleteFocusSession(id: string): Promise<void> {
  return withFallback(
    async () => {
      await entitiesApi.deleteEntity(id)
    },
    async () => {
      await ensureV2Ready()
      await runIdbTransaction([FOCUS_SESSIONS_STORE], 'readwrite', async (ctx) => {
        const existing = await ctx.get(FOCUS_SESSIONS_STORE, id)
        if (existing) {
          await ctx.deleteChecked(FOCUS_SESSIONS_STORE, { id })
        }
      })
    },
    { operation: 'delete', entityType: 'entity', entityId: id, payload: {} },
  )
}

export async function deleteFocusSessionsByPanel(panelId: string): Promise<void> {
  return withFallback(
    async () => {
      const result = await entitiesApi.queryEntities({ type: 'focusSession', panelId })
      if (result.items.length > 0) {
        await entitiesApi.batchDeleteEntities(result.items.map(e => e.id))
      }
    },
    async () => {
      await ensureV2Ready()
      await runIdbTransaction([FOCUS_SESSIONS_STORE], 'readwrite', async (ctx) => {
        const ids: string[] = []
        await ctx.iterateStore<unknown>(FOCUS_SESSIONS_STORE, (record) => {
          try {
            const s = migrateFocusSession(record.data)
            if (s.panelId === panelId) ids.push(record.id)
          } catch { /* skip */ }
        })
        for (const id of ids) {
          await ctx.deleteChecked(FOCUS_SESSIONS_STORE, { id })
        }
      })
    },
    { operation: 'delete', entityType: 'entity', entityId: 'batch', payload: { panelId, type: 'focusSession' } },
  )
}

export async function deleteFocusSessionsByWidget(widgetId: string): Promise<void> {
  return withFallback(
    async () => {
      const result = await entitiesApi.queryEntities({ type: 'focusSession', limit: 10000 })
      const toDelete = result.items
        .map(e => { try { return migrateFocusSession(entityDataWithMeta(e)) } catch { return null } })
        .filter((s): s is FocusSession => s !== null && s.focusTimerWidgetId === widgetId)
      if (toDelete.length > 0) {
        await entitiesApi.batchDeleteEntities(toDelete.map(s => s.id))
      }
    },
    async () => {
      await ensureV2Ready()
      await runIdbTransaction([FOCUS_SESSIONS_STORE], 'readwrite', async (ctx) => {
        const ids: string[] = []
        await ctx.iterateStore<unknown>(FOCUS_SESSIONS_STORE, (record) => {
          try {
            const s = migrateFocusSession(record.data)
            if (s.focusTimerWidgetId === widgetId) ids.push(record.id)
          } catch { /* skip */ }
        })
        for (const id of ids) {
          await ctx.deleteChecked(FOCUS_SESSIONS_STORE, { id })
        }
      })
    },
    { operation: 'delete', entityType: 'entity', entityId: 'batch', payload: { widgetId, type: 'focusSession' } },
  )
}

// ========================= Task CRUD =========================

export async function saveTask(task: Task): Promise<void> {
  return withFallback(
    async () => {
      await apiEntityUpsert('task', task as unknown as Record<string, unknown>)
    },
    async () => {
      await ensureV2Ready()
      await runIdbTransaction([TASKS_STORE], 'readwrite', async (ctx) => {
        await upsertRecord(ctx, TASKS_STORE, task.id, task)
      })
    },
    { operation: 'update', entityType: 'entity', entityId: task.id, payload: { type: 'task', panelId: task.panelId, data: task } },
  )
}

export async function getTasksByPanel(panelId: string): Promise<Task[]> {
  return withFallback(
    async () => {
      const result = await entitiesApi.queryEntities({ type: 'task', panelId })
      return result.items
        .map(e => { try { return migrateTask(entityDataWithMeta(e)) } catch { return null } })
        .filter((t): t is Task => t !== null)
    },
    async () => {
      await ensureV2Ready()
      return runIdbTransaction([TASKS_STORE], 'readonly', async (ctx) => {
        const result: Task[] = []
        await ctx.iterateStore<unknown>(TASKS_STORE, (record) => {
          try {
            const t = migrateTask(record.data)
            if (t.panelId === panelId) result.push(t)
          } catch {
            console.warn('[DB] skipping invalid task', record.data)
          }
        })
        return result
      })
    },
  )
}

export async function deleteTask(id: string): Promise<void> {
  return withFallback(
    async () => {
      await entitiesApi.deleteEntity(id)
    },
    async () => {
      await ensureV2Ready()
      await runIdbTransaction([TASKS_STORE], 'readwrite', async (ctx) => {
        const existing = await ctx.get(TASKS_STORE, id)
        if (existing) {
          await ctx.deleteChecked(TASKS_STORE, { id })
        }
      })
    },
    { operation: 'delete', entityType: 'entity', entityId: id, payload: {} },
  )
}

export async function deleteTasksByPanel(panelId: string): Promise<void> {
  return withFallback(
    async () => {
      const result = await entitiesApi.queryEntities({ type: 'task', panelId })
      if (result.items.length > 0) {
        await entitiesApi.batchDeleteEntities(result.items.map(e => e.id))
      }
    },
    async () => {
      await ensureV2Ready()
      await runIdbTransaction([TASKS_STORE], 'readwrite', async (ctx) => {
        const ids: string[] = []
        await ctx.iterateStore<unknown>(TASKS_STORE, (record) => {
          try {
            const t = migrateTask(record.data)
            if (t.panelId === panelId) ids.push(record.id)
          } catch { /* skip */ }
        })
        for (const id of ids) {
          await ctx.deleteChecked(TASKS_STORE, { id })
        }
      })
    },
    { operation: 'delete', entityType: 'entity', entityId: 'batch', payload: { panelId, type: 'task' } },
  )
}

// ========================= FocusSession misc =========================

export async function getFocusSessionById(id: string): Promise<FocusSession | undefined> {
  return withFallback(
    async () => {
      try {
        const entity = await entitiesApi.getEntity(id)
        return migrateFocusSession(entity.data)
      } catch (err: unknown) {
        if (isNotFoundError(err)) return undefined
        throw err
      }
    },
    async () => {
      await ensureV2Ready()
      return runIdbTransaction([FOCUS_SESSIONS_STORE], 'readonly', async (ctx) => {
        const record = await ctx.get<unknown>(FOCUS_SESSIONS_STORE, id)
        if (!record) return undefined
        try {
          return migrateFocusSession(record.data)
        } catch {
          console.warn('[DB] skipping invalid focusSession', record.data)
          return undefined
        }
      })
    },
  )
}

export async function linkFocusSessionToTask(params: {
  panelId: string
  sessionId: string
  taskId: string
}): Promise<void> {
  return withFallback(
    async () => {
      const sessionEntity = await entitiesApi.getEntity(params.sessionId)
      const session = migrateFocusSession(sessionEntity.data)
      if (session.panelId !== params.panelId) throw new Error('session panelId mismatch')

      const taskEntity = await entitiesApi.getEntity(params.taskId)
      const task = migrateTask(taskEntity.data)
      if (task.panelId !== params.panelId) throw new Error('task panelId mismatch')
      if (task.status === 'done') throw new Error('task is done')

      session.taskId = task.id
      session.taskTitleSnapshot = task.title.slice(0, 200)

      await entitiesApi.updateEntity(params.sessionId, { data: session as unknown as Record<string, unknown> })
    },
    async () => {
      await ensureV2Ready()
      await runIdbTransaction([FOCUS_SESSIONS_STORE, TASKS_STORE], 'readwrite', async (ctx) => {
        const rawSessionRecord = await ctx.get<unknown>(FOCUS_SESSIONS_STORE, params.sessionId)
        if (!rawSessionRecord) throw new Error('session not found')

        const session = migrateFocusSession(rawSessionRecord.data)
        if (session.panelId !== params.panelId) throw new Error('session panelId mismatch')

        const rawTaskRecord = await ctx.get<unknown>(TASKS_STORE, params.taskId)
        if (!rawTaskRecord) throw new Error('task not found')

        const task = migrateTask(rawTaskRecord.data)
        if (task.panelId !== params.panelId) throw new Error('task panelId mismatch')
        if (task.status === 'done') throw new Error('task is done')

        session.taskId = task.id
        session.taskTitleSnapshot = task.title.slice(0, 200)

        await upsertRecord(ctx, FOCUS_SESSIONS_STORE, session.id, session)
      })
    },
    { operation: 'update', entityType: 'entity', entityId: params.sessionId, payload: { type: 'focusSession', panelId: params.panelId, data: { sessionId: params.sessionId, taskId: params.taskId } } },
  )
}

// ========================= Habit CRUD =========================

export async function saveHabit(habit: Habit): Promise<void> {
  return withFallback(
    async () => {
      await apiEntityUpsert('habit', habit as unknown as Record<string, unknown>)
    },
    async () => {
      await ensureV2Ready()
      await runIdbTransaction([HABITS_STORE], 'readwrite', async (ctx) => {
        await upsertRecord(ctx, HABITS_STORE, habit.id, habit)
      })
    },
    { operation: 'update', entityType: 'entity', entityId: habit.id, payload: { type: 'habit', panelId: habit.panelId, data: habit } },
  )
}

export async function getHabitById(id: string): Promise<Habit | undefined> {
  return withFallback(
    async () => {
      try {
        const entity = await entitiesApi.getEntity(id)
        return migrateHabit(entity.data)
      } catch (err: unknown) {
        if (isNotFoundError(err)) return undefined
        throw err
      }
    },
    async () => {
      await ensureV2Ready()
      return runIdbTransaction([HABITS_STORE], 'readonly', async (ctx) => {
        const record = await ctx.get<unknown>(HABITS_STORE, id)
        if (!record) return undefined
        try {
          return migrateHabit(record.data)
        } catch {
          console.warn('[DB] skipping invalid habit', record.data)
          return undefined
        }
      })
    },
  )
}

export async function getHabitsByPanel(panelId: string): Promise<Habit[]> {
  return withFallback(
    async () => {
      const result = await entitiesApi.queryEntities({ type: 'habit', panelId })
      return result.items.map(e => migrateHabit(entityDataWithMeta(e))).filter(Boolean) as Habit[]
    },
    async () => {
      await ensureV2Ready()
      return runIdbTransaction([HABITS_STORE], 'readonly', async (ctx) => {
        const result: Habit[] = []
        await ctx.iterateStore<unknown>(HABITS_STORE, (record) => {
          try {
            const h = migrateHabit(record.data)
            if (h.panelId === panelId) result.push(h)
          } catch {
            console.warn('[DB] skipping invalid habit', record.data)
          }
        })
        return result
      })
    },
  )
}

export async function archiveHabitInDb(id: string, archivedAt: number): Promise<void> {
  return withFallback(
    async () => {
      const entity = await entitiesApi.getEntity(id)
      const habit = migrateHabit(entity.data)
      if (habit.archivedAt) return
      habit.archivedAt = archivedAt
      habit.updatedAt = archivedAt
      await entitiesApi.updateEntity(id, { data: habit as unknown as Record<string, unknown> })
    },
    async () => {
      await ensureV2Ready()
      await runIdbTransaction([HABITS_STORE], 'readwrite', async (ctx) => {
        const record = await ctx.get<unknown>(HABITS_STORE, id)
        if (!record) throw new Error('habit not found')
        const habit = migrateHabit(record.data)
        if (habit.archivedAt) return
        habit.archivedAt = archivedAt
        habit.updatedAt = archivedAt
        await ctx.putCas(HABITS_STORE, { id, expectedVersion: record.version, data: habit })
      })
    },
    { operation: 'update', entityType: 'entity', entityId: id, payload: { type: 'habit', data: { archivedAt } } },
  )
}

export async function deleteHabit(id: string): Promise<void> {
  return withFallback(
    async () => {
      await entitiesApi.deleteEntity(id)
    },
    async () => {
      await ensureV2Ready()
      await runIdbTransaction([HABITS_STORE], 'readwrite', async (ctx) => {
        const existing = await ctx.get(HABITS_STORE, id)
        if (existing) {
          await ctx.deleteChecked(HABITS_STORE, { id })
        }
      })
    },
    { operation: 'delete', entityType: 'entity', entityId: id, payload: {} },
  )
}

export async function deleteHabitsByPanel(panelId: string): Promise<void> {
  return withFallback(
    async () => {
      const result = await entitiesApi.queryEntities({ type: 'habit', panelId })
      if (result.items.length > 0) {
        await entitiesApi.batchDeleteEntities(result.items.map(e => e.id))
      }
    },
    async () => {
      await ensureV2Ready()
      await runIdbTransaction([HABITS_STORE], 'readwrite', async (ctx) => {
        const ids: string[] = []
        await ctx.iterateStore<unknown>(HABITS_STORE, (record) => {
          try {
            const h = migrateHabit(record.data)
            if (h.panelId === panelId) ids.push(record.id)
          } catch { /* skip */ }
        })
        for (const id of ids) {
          await ctx.deleteChecked(HABITS_STORE, { id })
        }
      })
    },
    { operation: 'delete', entityType: 'entity', entityId: 'batch', payload: { panelId, type: 'habit' } },
  )
}

// ========================= HabitCheckin CRUD =========================

export async function addHabitCheckin(checkin: HabitCheckin): Promise<HabitCheckin> {
  const migrated = migrateHabitCheckin(checkin)
  return withFallback(
    async () => {
      const habitEntity = await entitiesApi.getEntity(migrated.habitId)
      const habit = migrateHabit(habitEntity.data)
      if (habit.panelId !== migrated.panelId) throw new Error('panelId mismatch')
      if (habit.archivedAt) throw new Error('habit is archived')
      let existingCheckin: HabitCheckin | null = null
      try {
        const checkinEntity = await entitiesApi.getEntity(migrated.id)
        existingCheckin = migrateHabitCheckin(checkinEntity.data)
      } catch (err: unknown) {
        if (!isNotFoundError(err)) throw err
      }
      if (!existingCheckin) {
        await entitiesApi.createEntity({
          id: migrated.id,
          type: 'habitCheckin',
          panelId: migrated.panelId,
          data: migrated as unknown as Record<string, unknown>,
        })
      }
      return existingCheckin ?? migrated
    },
    async () => {
      let existingCheckin: HabitCheckin | null = null
      await ensureV2Ready()
      await runIdbTransaction([HABITS_STORE, HABIT_CHECKINS_STORE], 'readwrite', async (ctx) => {
        const habitRecord = await ctx.get<unknown>(HABITS_STORE, migrated.habitId)
        if (!habitRecord) throw new Error('habit not found')
        const habit = migrateHabit(habitRecord.data)
        if (habit.panelId !== migrated.panelId) throw new Error('panelId mismatch')
        if (habit.archivedAt) throw new Error('habit is archived')
        const existing = await ctx.get(HABIT_CHECKINS_STORE, migrated.id)
        if (existing) {
          existingCheckin = migrateHabitCheckin(existing.data)
          return
        }
        await ctx.addNew(HABIT_CHECKINS_STORE, { id: migrated.id, data: migrated })
      })
      return existingCheckin ?? migrated
    },
    { operation: 'create', entityType: 'entity', entityId: migrated.id, payload: { type: 'habitCheckin', panelId: migrated.panelId, data: migrated } },
  )
}

export async function getHabitCheckinsByPanel(panelId: string): Promise<HabitCheckin[]> {
  return withFallback(
    async () => {
      const result = await entitiesApi.queryEntities({ type: 'habitCheckin', panelId })
      return result.items.map(e => migrateHabitCheckin(entityDataWithMeta(e))).filter(Boolean) as HabitCheckin[]
    },
    async () => {
      await ensureV2Ready()
      return runIdbTransaction([HABIT_CHECKINS_STORE], 'readonly', async (ctx) => {
        const result: HabitCheckin[] = []
        await ctx.iterateStore<unknown>(HABIT_CHECKINS_STORE, (record) => {
          try {
            const c = migrateHabitCheckin(record.data)
            if (c.panelId === panelId) result.push(c)
          } catch {
            console.warn('[DB] skipping invalid habitCheckin', record.data)
          }
        })
        return result
      })
    },
  )
}

export async function getHabitCheckinsByHabit(habitId: string): Promise<HabitCheckin[]> {
  return withFallback(
    async () => {
      const result = await entitiesApi.queryEntities({ type: 'habitCheckin', limit: 10000 })
      return result.items
        .map(e => { try { return migrateHabitCheckin(entityDataWithMeta(e)) } catch { return null } })
        .filter((c): c is HabitCheckin => c !== null && c.habitId === habitId)
    },
    async () => {
      await ensureV2Ready()
      return runIdbTransaction([HABIT_CHECKINS_STORE], 'readonly', async (ctx) => {
        const result: HabitCheckin[] = []
        await ctx.iterateStore<unknown>(HABIT_CHECKINS_STORE, (record) => {
          try {
            const c = migrateHabitCheckin(record.data)
            if (c.habitId === habitId) result.push(c)
          } catch {
            console.warn('[DB] skipping invalid habitCheckin', record.data)
          }
        })
        return result
      })
    },
  )
}

export async function deleteHabitCheckin(id: string): Promise<void> {
  return withFallback(
    async () => {
      await entitiesApi.deleteEntity(id)
    },
    async () => {
      await ensureV2Ready()
      await runIdbTransaction([HABIT_CHECKINS_STORE], 'readwrite', async (ctx) => {
        const existing = await ctx.get(HABIT_CHECKINS_STORE, id)
        if (existing) {
          await ctx.deleteChecked(HABIT_CHECKINS_STORE, { id })
        }
      })
    },
    { operation: 'delete', entityType: 'entity', entityId: id, payload: {} },
  )
}

export async function deleteHabitCheckinsByPanel(panelId: string): Promise<void> {
  return withFallback(
    async () => {
      const result = await entitiesApi.queryEntities({ type: 'habitCheckin', panelId })
      if (result.items.length > 0) {
        await entitiesApi.batchDeleteEntities(result.items.map(e => e.id))
      }
    },
    async () => {
      await ensureV2Ready()
      await runIdbTransaction([HABIT_CHECKINS_STORE], 'readwrite', async (ctx) => {
        const ids: string[] = []
        await ctx.iterateStore<unknown>(HABIT_CHECKINS_STORE, (record) => {
          try {
            const c = migrateHabitCheckin(record.data)
            if (c.panelId === panelId) ids.push(record.id)
          } catch { /* skip */ }
        })
        for (const id of ids) {
          await ctx.deleteChecked(HABIT_CHECKINS_STORE, { id })
        }
      })
    },
    { operation: 'delete', entityType: 'entity', entityId: 'batch', payload: { panelId, type: 'habitCheckin' } },
  )
}

// ========================= MoodEntry CRUD =========================

export async function createMoodEntry(entry: MoodEntry): Promise<void> {
  const migrated = migrateMoodEntry(entry)
  return withFallback(
    async () => {
      await entitiesApi.createEntity({
        id: migrated.id,
        type: 'moodEntry',
        panelId: migrated.panelId,
        data: migrated as unknown as Record<string, unknown>,
      })
    },
    async () => {
      await ensureV2Ready()
      await runIdbTransaction([MOOD_ENTRIES_STORE], 'readwrite', async (ctx) => {
        const existing = await ctx.get(MOOD_ENTRIES_STORE, migrated.id)
        if (existing) throw new Error('mood entry already exists')
        await ctx.addNew(MOOD_ENTRIES_STORE, { id: migrated.id, data: migrated })
      })
    },
    { operation: 'create', entityType: 'entity', entityId: migrated.id, payload: { type: 'moodEntry', panelId: migrated.panelId, data: migrated } },
  )
}

export async function getMoodEntriesByPanel(panelId: string): Promise<MoodEntry[]> {
  return withFallback(
    async () => {
      const result = await entitiesApi.queryEntities({ type: 'moodEntry', panelId })
      return result.items.map(e => migrateMoodEntry(entityDataWithMeta(e))).filter(Boolean) as MoodEntry[]
    },
    async () => {
      await ensureV2Ready()
      return runIdbTransaction([MOOD_ENTRIES_STORE], 'readonly', async (ctx) => {
        const result: MoodEntry[] = []
        await ctx.iterateStore<unknown>(MOOD_ENTRIES_STORE, (record) => {
          try {
            const e = migrateMoodEntry(record.data)
            if (e.panelId === panelId) result.push(e)
          } catch {
            console.warn('[DB] skipping invalid moodEntry', record.data)
          }
        })
        return result
      })
    },
  )
}

export async function getMoodEntryById(id: string): Promise<MoodEntry | undefined> {
  return withFallback(
    async () => {
      try {
        const entity = await entitiesApi.getEntity(id)
        return migrateMoodEntry(entity.data)
      } catch (err: unknown) {
        if (isNotFoundError(err)) return undefined
        throw err
      }
    },
    async () => {
      await ensureV2Ready()
      return runIdbTransaction([MOOD_ENTRIES_STORE], 'readonly', async (ctx) => {
        const record = await ctx.get<unknown>(MOOD_ENTRIES_STORE, id)
        if (!record) return undefined
        try {
          return migrateMoodEntry(record.data)
        } catch {
          console.warn('[DB] skipping invalid moodEntry', record.data)
          return undefined
        }
      })
    },
  )
}

export async function updateMoodEntryLevel(id: string, level: 1 | 2 | 3 | 4 | 5): Promise<void> {
  return withFallback(
    async () => {
      const entity = await entitiesApi.getEntity(id)
      const entry = migrateMoodEntry(entity.data)
      entry.level = level
      await entitiesApi.updateEntity(id, { data: entry as unknown as Record<string, unknown> })
    },
    async () => {
      await ensureV2Ready()
      await runIdbTransaction([MOOD_ENTRIES_STORE], 'readwrite', async (ctx) => {
        const record = await ctx.get<unknown>(MOOD_ENTRIES_STORE, id)
        if (!record) throw new Error('mood entry not found')
        const entry = migrateMoodEntry(record.data)
        entry.level = level
        await ctx.putCas(MOOD_ENTRIES_STORE, { id, expectedVersion: record.version, data: entry })
      })
    },
    { operation: 'update', entityType: 'entity', entityId: id, payload: { type: 'moodEntry', data: { level } } },
  )
}

export async function updateMoodEntryNote(id: string, note: string | undefined): Promise<void> {
  return withFallback(
    async () => {
      const entity = await entitiesApi.getEntity(id)
      const entry = migrateMoodEntry(entity.data)
      entry.note = note || undefined
      await entitiesApi.updateEntity(id, { data: entry as unknown as Record<string, unknown> })
    },
    async () => {
      await ensureV2Ready()
      await runIdbTransaction([MOOD_ENTRIES_STORE], 'readwrite', async (ctx) => {
        const record = await ctx.get<unknown>(MOOD_ENTRIES_STORE, id)
        if (!record) throw new Error('mood entry not found')
        const entry = migrateMoodEntry(record.data)
        entry.note = note || undefined
        await ctx.putCas(MOOD_ENTRIES_STORE, { id, expectedVersion: record.version, data: entry })
      })
    },
    { operation: 'update', entityType: 'entity', entityId: id, payload: { type: 'moodEntry', data: { note } } },
  )
}

export async function deleteMoodEntriesByPanel(panelId: string): Promise<void> {
  return withFallback(
    async () => {
      const result = await entitiesApi.queryEntities({ type: 'moodEntry', panelId })
      if (result.items.length > 0) {
        await entitiesApi.batchDeleteEntities(result.items.map(e => e.id))
      }
    },
    async () => {
      await ensureV2Ready()
      await runIdbTransaction([MOOD_ENTRIES_STORE], 'readwrite', async (ctx) => {
        const ids: string[] = []
        await ctx.iterateStore<unknown>(MOOD_ENTRIES_STORE, (record) => {
          try {
            const e = migrateMoodEntry(record.data)
            if (e.panelId === panelId) ids.push(record.id)
          } catch { /* skip */ }
        })
        for (const id of ids) {
          await ctx.deleteChecked(MOOD_ENTRIES_STORE, { id })
        }
      })
    },
    { operation: 'delete', entityType: 'entity', entityId: 'batch', payload: { panelId, type: 'moodEntry' } },
  )
}

// ========================= CalendarEvent CRUD =========================

export async function saveCalendarEvent(event: CalendarEvent): Promise<void> {
  const migrated = migrateCalendarEvent(event)
  return withFallback(
    async () => {
      await apiEntityUpsert('calendarEvent', migrated as unknown as Record<string, unknown>)
    },
    async () => {
      await ensureV2Ready()
      await runIdbTransaction([CALENDAR_EVENTS_STORE], 'readwrite', async (ctx) => {
        await upsertRecord(ctx, CALENDAR_EVENTS_STORE, migrated.id, migrated)
      })
    },
    { operation: 'update', entityType: 'entity', entityId: migrated.id, payload: { type: 'calendarEvent', panelId: migrated.panelId, data: migrated } },
  )
}

export async function getCalendarEventById(id: string): Promise<CalendarEvent | null> {
  return withFallback(
    async () => {
      try {
        const entity = await entitiesApi.getEntity(id)
        return migrateCalendarEvent(entity.data)
      } catch (err: unknown) {
        if (isNotFoundError(err)) return null
        throw err
      }
    },
    async () => {
      await ensureV2Ready()
      return runIdbTransaction([CALENDAR_EVENTS_STORE], 'readonly', async (ctx) => {
        const record = await ctx.get<unknown>(CALENDAR_EVENTS_STORE, id)
        if (!record) return null
        try {
          return migrateCalendarEvent(record.data)
        } catch {
          console.warn('[DB] skipping invalid calendarEvent', record.data)
          return null
        }
      })
    },
  )
}

export async function getCalendarEventsByPanel(panelId: string): Promise<CalendarEvent[]> {
  return withFallback(
    async () => {
      const result = await entitiesApi.queryEntities({ type: 'calendarEvent', panelId })
      return result.items.map(e => migrateCalendarEvent(entityDataWithMeta(e))).filter(Boolean) as CalendarEvent[]
    },
    async () => {
      await ensureV2Ready()
      return runIdbTransaction([CALENDAR_EVENTS_STORE], 'readonly', async (ctx) => {
        const result: CalendarEvent[] = []
        await ctx.iterateStore<unknown>(CALENDAR_EVENTS_STORE, (record) => {
          try {
            const e = migrateCalendarEvent(record.data)
            if (e.panelId === panelId) result.push(e)
          } catch {
            console.warn('[DB] skipping invalid calendarEvent', record.data)
          }
        })
        return result
      })
    },
  )
}

export async function deleteCalendarEvent(id: string): Promise<void> {
  return withFallback(
    async () => {
      await entitiesApi.deleteEntity(id)
    },
    async () => {
      await ensureV2Ready()
      await runIdbTransaction([CALENDAR_EVENTS_STORE], 'readwrite', async (ctx) => {
        const existing = await ctx.get(CALENDAR_EVENTS_STORE, id)
        if (existing) {
          await ctx.deleteChecked(CALENDAR_EVENTS_STORE, { id })
        }
      })
    },
    { operation: 'delete', entityType: 'entity', entityId: id, payload: {} },
  )
}

export async function deleteCalendarEventsByPanel(panelId: string): Promise<void> {
  return withFallback(
    async () => {
      const result = await entitiesApi.queryEntities({ type: 'calendarEvent', panelId })
      if (result.items.length > 0) {
        await entitiesApi.batchDeleteEntities(result.items.map(e => e.id))
      }
    },
    async () => {
      await ensureV2Ready()
      await runIdbTransaction([CALENDAR_EVENTS_STORE], 'readwrite', async (ctx) => {
        const ids: string[] = []
        await ctx.iterateStore<unknown>(CALENDAR_EVENTS_STORE, (record) => {
          try {
            const e = migrateCalendarEvent(record.data)
            if (e.panelId === panelId) ids.push(record.id)
          } catch { /* skip */ }
        })
        for (const id of ids) {
          await ctx.deleteChecked(CALENDAR_EVENTS_STORE, { id })
        }
      })
    },
    { operation: 'delete', entityType: 'entity', entityId: 'batch', payload: { panelId, type: 'calendarEvent' } },
  )
}

// ========================= Phase 3: 笔迹 + 连线 CRUD =========================

const DRAWING_STROKES_STORE = 'drawingStrokes'
const WIDGET_CONNECTIONS_STORE = 'widgetConnections'

export async function saveStroke(stroke: DrawingStroke): Promise<void> {
  return withFallback(
    async () => {
      await apiEntityUpsert('drawingStroke', stroke as unknown as Record<string, unknown>)
    },
    async () => {
      await ensureV2Ready()
      await runIdbTransaction([DRAWING_STROKES_STORE], 'readwrite', async (ctx) => {
        await upsertRecord(ctx, DRAWING_STROKES_STORE, stroke.id, stroke)
      })
    },
    { operation: 'update', entityType: 'entity', entityId: stroke.id, payload: { type: 'drawingStroke', panelId: stroke.panelId, data: stroke } },
  )
}

export async function saveStrokesBatch(strokes: DrawingStroke[]): Promise<void> {
  if (strokes.length === 0) return
  return withFallback(
    async () => {
      for (const stroke of strokes) {
        await apiEntityUpsert('drawingStroke', stroke as unknown as Record<string, unknown>)
      }
    },
    async () => {
      await ensureV2Ready()
      await runIdbTransaction([DRAWING_STROKES_STORE], 'readwrite', async (ctx) => {
        for (const stroke of strokes) {
          await upsertRecord(ctx, DRAWING_STROKES_STORE, stroke.id, stroke)
        }
      })
    },
    { operation: 'update', entityType: 'entity', entityId: 'batch', payload: strokes.map(s => ({ type: 'drawingStroke', panelId: s.panelId, data: s })) },
  )
}

export async function getStrokesByPanel(panelId: string): Promise<DrawingStroke[]> {
  return withFallback(
    async () => {
      const result = await entitiesApi.queryEntities({ type: 'drawingStroke', panelId })
      return result.items.map(e => e.data as unknown as DrawingStroke)
    },
    async () => {
      await ensureV2Ready()
      return runIdbTransaction([DRAWING_STROKES_STORE], 'readonly', async (ctx) => {
        const result: DrawingStroke[] = []
        await ctx.iterateStore<DrawingStroke>(DRAWING_STROKES_STORE, (record) => {
          if (record.data?.panelId === panelId) {
            result.push(record.data)
          }
        })
        return result
      })
    },
  )
}

export async function deleteStroke(id: string): Promise<void> {
  return withFallback(
    async () => {
      await entitiesApi.deleteEntity(id)
    },
    async () => {
      await ensureV2Ready()
      await runIdbTransaction([DRAWING_STROKES_STORE], 'readwrite', async (ctx) => {
        const existing = await ctx.get(DRAWING_STROKES_STORE, id)
        if (existing) {
          await ctx.deleteChecked(DRAWING_STROKES_STORE, { id })
        }
      })
    },
    { operation: 'delete', entityType: 'entity', entityId: id, payload: {} },
  )
}

export async function deleteStrokesBatch(ids: string[]): Promise<void> {
  if (ids.length === 0) return
  return withFallback(
    async () => {
      await entitiesApi.batchDeleteEntities(ids)
    },
    async () => {
      await ensureV2Ready()
      await runIdbTransaction([DRAWING_STROKES_STORE], 'readwrite', async (ctx) => {
        for (const id of ids) {
          const existing = await ctx.get(DRAWING_STROKES_STORE, id)
          if (existing) {
            await ctx.deleteChecked(DRAWING_STROKES_STORE, { id })
          }
        }
      })
    },
    { operation: 'delete', entityType: 'entity', entityId: 'batch', payload: { ids } },
  )
}

export async function deleteStrokesByPanel(panelId: string): Promise<void> {
  return withFallback(
    async () => {
      const result = await entitiesApi.queryEntities({ type: 'drawingStroke', panelId })
      if (result.items.length > 0) {
        await entitiesApi.batchDeleteEntities(result.items.map(e => e.id))
      }
    },
    async () => {
      await ensureV2Ready()
      await runIdbTransaction([DRAWING_STROKES_STORE], 'readwrite', async (ctx) => {
        const ids: string[] = []
        await ctx.iterateStore<DrawingStroke>(DRAWING_STROKES_STORE, (record) => {
          if (record.data?.panelId === panelId) ids.push(record.id)
        })
        for (const id of ids) {
          await ctx.deleteChecked(DRAWING_STROKES_STORE, { id })
        }
      })
    },
    { operation: 'delete', entityType: 'entity', entityId: 'batch', payload: { panelId, type: 'drawingStroke' } },
  )
}

export async function saveConnection(conn: WidgetConnection): Promise<void> {
  return withFallback(
    async () => {
      await apiEntityUpsert('widgetConnection', conn as unknown as Record<string, unknown>)
    },
    async () => {
      await ensureV2Ready()
      await runIdbTransaction([WIDGET_CONNECTIONS_STORE], 'readwrite', async (ctx) => {
        await upsertRecord(ctx, WIDGET_CONNECTIONS_STORE, conn.id, conn)
      })
    },
    { operation: 'update', entityType: 'entity', entityId: conn.id, payload: { type: 'widgetConnection', panelId: conn.panelId, data: conn } },
  )
}

export async function getConnectionsByPanel(panelId: string): Promise<WidgetConnection[]> {
  return withFallback(
    async () => {
      const result = await entitiesApi.queryEntities({ type: 'widgetConnection', panelId })
      return result.items.map(e => e.data as unknown as WidgetConnection)
    },
    async () => {
      await ensureV2Ready()
      return runIdbTransaction([WIDGET_CONNECTIONS_STORE], 'readonly', async (ctx) => {
        const result: WidgetConnection[] = []
        await ctx.iterateStore<WidgetConnection>(WIDGET_CONNECTIONS_STORE, (record) => {
          if (record.data?.panelId === panelId) {
            result.push(record.data)
          }
        })
        return result
      })
    },
  )
}

export async function deleteConnection(id: string): Promise<void> {
  return withFallback(
    async () => {
      await entitiesApi.deleteEntity(id)
    },
    async () => {
      await ensureV2Ready()
      await runIdbTransaction([WIDGET_CONNECTIONS_STORE], 'readwrite', async (ctx) => {
        const existing = await ctx.get(WIDGET_CONNECTIONS_STORE, id)
        if (existing) {
          await ctx.deleteChecked(WIDGET_CONNECTIONS_STORE, { id })
        }
      })
    },
    { operation: 'delete', entityType: 'entity', entityId: id, payload: {} },
  )
}

export async function deleteConnectionsBatch(ids: string[]): Promise<void> {
  if (ids.length === 0) return
  return withFallback(
    async () => {
      await entitiesApi.batchDeleteEntities(ids)
    },
    async () => {
      await ensureV2Ready()
      await runIdbTransaction([WIDGET_CONNECTIONS_STORE], 'readwrite', async (ctx) => {
        for (const id of ids) {
          const existing = await ctx.get(WIDGET_CONNECTIONS_STORE, id)
          if (existing) {
            await ctx.deleteChecked(WIDGET_CONNECTIONS_STORE, { id })
          }
        }
      })
    },
    { operation: 'delete', entityType: 'entity', entityId: 'batch', payload: { ids } },
  )
}

export async function deleteConnectionsByPanel(panelId: string): Promise<void> {
  return withFallback(
    async () => {
      const result = await entitiesApi.queryEntities({ type: 'widgetConnection', panelId })
      if (result.items.length > 0) {
        await entitiesApi.batchDeleteEntities(result.items.map(e => e.id))
      }
    },
    async () => {
      await ensureV2Ready()
      await runIdbTransaction([WIDGET_CONNECTIONS_STORE], 'readwrite', async (ctx) => {
        const ids: string[] = []
        await ctx.iterateStore<WidgetConnection>(WIDGET_CONNECTIONS_STORE, (record) => {
          if (record.data?.panelId === panelId) ids.push(record.id)
        })
        for (const id of ids) {
          await ctx.deleteChecked(WIDGET_CONNECTIONS_STORE, { id })
        }
      })
    },
    { operation: 'delete', entityType: 'entity', entityId: 'batch', payload: { panelId, type: 'widgetConnection' } },
  )
}

export async function deleteConnectionsByWidget(panelId: string, widgetId: string): Promise<string[]> {
  return withFallback(
    async () => {
      const result = await entitiesApi.queryEntities({ type: 'widgetConnection', panelId })
      const toDelete = result.items.filter(e => {
        const d = e.data
        return (d as { source?: { widgetId?: string }; target?: { widgetId?: string } })?.source?.widgetId === widgetId || (d as { source?: { widgetId?: string }; target?: { widgetId?: string } })?.target?.widgetId === widgetId
      })
      if (toDelete.length > 0) {
        await entitiesApi.batchDeleteEntities(toDelete.map(e => e.id))
      }
      return toDelete.map(e => e.id)
    },
    async () => {
      await ensureV2Ready()
      const removedIds: string[] = []
      await runIdbTransaction([WIDGET_CONNECTIONS_STORE], 'readwrite', async (ctx) => {
        const ids: string[] = []
        await ctx.iterateStore<WidgetConnection>(WIDGET_CONNECTIONS_STORE, (record) => {
          const d = record.data
          if (d?.panelId === panelId && (d.source?.widgetId === widgetId || d.target?.widgetId === widgetId)) {
            ids.push(record.id)
          }
        })
        for (const id of ids) {
          const existing = await ctx.get(WIDGET_CONNECTIONS_STORE, id)
          if (existing) {
            await ctx.deleteChecked(WIDGET_CONNECTIONS_STORE, { id })
            removedIds.push(id)
          }
        }
      })
      return removedIds
    },
    { operation: 'delete', entityType: 'entity', entityId: 'batch', payload: { panelId, widgetId } },
  )
}

// ========================= WebTab / Bookmark 持久化 =========================
// 说明：webTabs 和 bookmarks 暂无服务端 API，直接使用 IDB 持久化。
// 不使用 withFallback，因为其 API 失败会把全局 backend 切到 idb，破坏其他 API 调用。
// IDB 不可用时降级到内存（调用方仍持有内存数据，不阻塞 UI）。

const WEB_TABS_STORE = 'webTabs'
const BOOKMARKS_STORE = 'bookmarks'
// 单条记录的固定 id，整组数据作为一个数组存储
const COLLECTION_RECORD_ID = 'all'

/** 保存所有网页标签到 IDB */
export async function saveWebTabs(tabs: WebTab[]): Promise<void> {
  try {
    await ensureV2Ready()
    await runIdbTransaction([WEB_TABS_STORE], 'readwrite', async (ctx) => {
      await upsertRecord(ctx, WEB_TABS_STORE, COLLECTION_RECORD_ID, tabs)
    })
  } catch (err) {
    // IDB 不可用时降级到内存：调用方仍持有内存数据，仅记录错误
    console.error('[DB] saveWebTabs failed, falling back to memory:', err)
  }
}

/** 从 IDB 读取所有网页标签 */
export async function getWebTabs(): Promise<WebTab[]> {
  try {
    await ensureV2Ready()
    return await runIdbTransaction([WEB_TABS_STORE], 'readonly', async (ctx) => {
      const record = await ctx.get<WebTab[]>(WEB_TABS_STORE, COLLECTION_RECORD_ID)
      return record?.data ?? []
    })
  } catch (err) {
    console.error('[DB] getWebTabs failed, returning empty array:', err)
    return []
  }
}

/** 保存所有书签到 IDB */
export async function saveBookmarks(bookmarks: Bookmark[]): Promise<void> {
  try {
    await ensureV2Ready()
    await runIdbTransaction([BOOKMARKS_STORE], 'readwrite', async (ctx) => {
      await upsertRecord(ctx, BOOKMARKS_STORE, COLLECTION_RECORD_ID, bookmarks)
    })
  } catch (err) {
    console.error('[DB] saveBookmarks failed, falling back to memory:', err)
  }
}

/** 从 IDB 读取所有书签 */
export async function getBookmarks(): Promise<Bookmark[]> {
  try {
    await ensureV2Ready()
    return await runIdbTransaction([BOOKMARKS_STORE], 'readonly', async (ctx) => {
      const record = await ctx.get<Bookmark[]>(BOOKMARKS_STORE, COLLECTION_RECORD_ID)
      return record?.data ?? []
    })
  } catch (err) {
    console.error('[DB] getBookmarks failed, returning empty array:', err)
    return []
  }
}

// ============================================================
// Phase 12: 全量 getAll 函数（用于本地搜索索引）
// 设计：直接走 runIdbTransaction 遍历 IDB store，不走 withFallback
// 注意：runIdbTransaction 第一个参数是 string[]（idbTx.ts:348）
// ============================================================

/** Phase 12：全量读取 widgetRecords（聚合所有 panel，用于本地搜索索引） */
export async function getAllWidgets(): Promise<WidgetInstance[]> {
  return runIdbTransaction([WIDGET_RECORDS_STORE], 'readonly', async (ctx) => {
    const records: WidgetInstance[] = []
    await ctx.iterateStore<WidgetInstance>(WIDGET_RECORDS_STORE, (record) => {
      records.push(record.data as WidgetInstance)
    })
    return records
  })
}

/** Phase 12：全量读取 tasks（用于本地搜索索引） */
export async function getAllTasks(): Promise<Task[]> {
  return runIdbTransaction([TASKS_STORE], 'readonly', async (ctx) => {
    const records: Task[] = []
    await ctx.iterateStore<Task>(TASKS_STORE, (record) => {
      records.push(record.data as Task)
    })
    return records
  })
}

/** Phase 12：全量读取 calendarEvents（用于本地搜索索引） */
export async function getAllCalendarEvents(): Promise<CalendarEvent[]> {
  return runIdbTransaction([CALENDAR_EVENTS_STORE], 'readonly', async (ctx) => {
    const records: CalendarEvent[] = []
    await ctx.iterateStore<CalendarEvent>(CALENDAR_EVENTS_STORE, (record) => {
      records.push(record.data as CalendarEvent)
    })
    return records
  })
}

/** Phase 12：全量读取 habits（用于本地搜索索引） */
export async function getAllHabits(): Promise<Habit[]> {
  return runIdbTransaction([HABITS_STORE], 'readonly', async (ctx) => {
    const records: Habit[] = []
    await ctx.iterateStore<Habit>(HABITS_STORE, (record) => {
      records.push(record.data as Habit)
    })
    return records
  })
}

/** Phase 12：全量读取 moodEntries（用于本地搜索索引） */
export async function getAllMoodEntries(): Promise<MoodEntry[]> {
  return runIdbTransaction([MOOD_ENTRIES_STORE], 'readonly', async (ctx) => {
    const records: MoodEntry[] = []
    await ctx.iterateStore<MoodEntry>(MOOD_ENTRIES_STORE, (record) => {
      records.push(record.data as MoodEntry)
    })
    return records
  })
}

/** Phase 12：全量读取 drawingStrokes（用于本地搜索索引） */
export async function getAllDrawingStrokes(): Promise<DrawingStroke[]> {
  return runIdbTransaction([DRAWING_STROKES_STORE], 'readonly', async (ctx) => {
    const records: DrawingStroke[] = []
    await ctx.iterateStore<DrawingStroke>(DRAWING_STROKES_STORE, (record) => {
      records.push(record.data as DrawingStroke)
    })
    return records
  })
}

/** Phase 12：全量读取 widgetConnections（用于本地搜索索引） */
export async function getAllWidgetConnections(): Promise<WidgetConnection[]> {
  return runIdbTransaction([WIDGET_CONNECTIONS_STORE], 'readonly', async (ctx) => {
    const records: WidgetConnection[] = []
    await ctx.iterateStore<WidgetConnection>(WIDGET_CONNECTIONS_STORE, (record) => {
      records.push(record.data as WidgetConnection)
    })
    return records
  })
}

/** Phase 12：全量读取 focusSessions（用于本地搜索索引） */
export async function getAllFocusSessions(): Promise<FocusSession[]> {
  return runIdbTransaction([FOCUS_SESSIONS_STORE], 'readonly', async (ctx) => {
    const records: FocusSession[] = []
    await ctx.iterateStore<FocusSession>(FOCUS_SESSIONS_STORE, (record) => {
      records.push(record.data as FocusSession)
    })
    return records
  })
}

/**
 * Phase 12：全量读取 bookmarks（用于本地搜索索引）
 * 注意：bookmarks store 以单条 collection 记录存储（id='all'，data=Bookmark[]），
 * 故直接封装现有 getBookmarks() —— 与 spec 3.5.3 注释「封装现有 getBookmarks() 保持命名一致」一致。
 */
export async function getAllBookmarks(): Promise<Bookmark[]> {
  return getBookmarks()
}

/**
 * Phase 12：全量读取 webTabs（用于本地搜索索引）
 * 注意：webTabs store 以单条 collection 记录存储（id='all'，data=WebTab[]），
 * 故直接封装现有 getWebTabs() —— 与 spec 3.5.3 注释「封装现有 getWebTabs() 保持命名一致」一致。
 */
export async function getAllWebTabs(): Promise<WebTab[]> {
  return getWebTabs()
}
