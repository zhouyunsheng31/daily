import { ensureV2Ready, runIdbTransaction, upsertRecord } from '../db'
import type { HtmlCanvasWidgetData } from '../../types'
import * as entitiesApi from '../../api/entities'
import { withFallback } from '../../api/adapter'
import { v4 as uuidv4 } from 'uuid'

const STORE = 'htmlWidgets'

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

/**
 * 根据 id 获取单个 HTML widget 数据。
 * @param id widget 记录 id
 * @returns widget 数据；不存在时返回 null
 */
export async function getHtmlWidget(id: string): Promise<HtmlCanvasWidgetData | null> {
  return withFallback(
    async () => {
      try {
        const entity = await entitiesApi.getEntity(id)
        return entity.data as unknown as HtmlCanvasWidgetData
      } catch (err: unknown) {
        const e = err as { status?: number }
        if (e?.status === 404) return null
        throw err
      }
    },
    async () => {
      await ensureV2Ready()
      return runIdbTransaction([STORE], 'readonly', async (ctx) => {
        const record = await ctx.get<HtmlCanvasWidgetData>(STORE, id)
        return record?.data ?? null
      })
    },
  )
}

/**
 * 创建一个新的 HTML widget 记录。自动生成 id（uuid v4）、createdAt、updatedAt、schemaVersion。
 * @param data widget 内容，包含 html 字符串和可选 title
 * @param id 可选，指定记录 id（与 keyPath id 相同）；未提供时自动生成 uuid v4
 * @returns 创建后的 widget 数据（含生成的 id）
 */
export async function createHtmlWidget(
  data: { html: string; title?: string },
  id?: string,
): Promise<HtmlCanvasWidgetData> {
  const now = Date.now()
  const widgetId = id ?? uuidv4()
  const widgetData: HtmlCanvasWidgetData = {
    id: widgetId,
    html: data.html,
    title: data.title,
    createdAt: now,
    updatedAt: now,
    schemaVersion: 1,
  }
  await withFallback(
    async () => { await upsertEntity(widgetId, 'htmlWidget', widgetData) },
    async () => {
      await ensureV2Ready()
      await runIdbTransaction([STORE], 'readwrite', async (ctx) => {
        await upsertRecord(ctx, STORE, widgetId, widgetData)
      })
    },
  )
  return { ...widgetData }
}

/**
 * 更新指定 id 的 HTML widget 的 html/title 字段，并刷新 updatedAt。
 * @param id widget 记录 id
 * @param updates 需要更新的字段（html / title）
 * @returns 更新后的 widget 数据；若记录不存在返回 null
 */
export async function updateHtmlWidget(
  id: string,
  updates: Partial<Pick<HtmlCanvasWidgetData, 'html' | 'title'>>,
): Promise<HtmlCanvasWidgetData | null> {
  return withFallback(
    async () => {
      try {
        const entity = await entitiesApi.getEntity(id)
        const existing = entity.data as unknown as HtmlCanvasWidgetData
        const updated: HtmlCanvasWidgetData = {
          ...existing,
          ...updates,
          id,
          updatedAt: Date.now(),
        }
        await upsertEntity(id, 'htmlWidget', updated, entity.panelId ?? undefined, entity.widgetId ?? undefined)
        return updated
      } catch (err: unknown) {
        const e = err as { status?: number }
        if (e?.status === 404) return null
        throw err
      }
    },
    async () => {
      await ensureV2Ready()
      return runIdbTransaction([STORE], 'readwrite', async (ctx) => {
        const existing = await ctx.get<HtmlCanvasWidgetData>(STORE, id)
        if (!existing) return null
        const updated: HtmlCanvasWidgetData = {
          ...existing.data,
          ...updates,
          id,
          updatedAt: Date.now(),
        }
        await upsertRecord(ctx, STORE, id, updated)
        return updated
      })
    },
  )
}

/**
 * 删除指定 id 的 HTML widget 记录。
 * @param id widget 记录 id
 */
export async function deleteHtmlWidget(id: string): Promise<void> {
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
 * 列出所有 HTML widget 记录，按 createdAt 降序排列。
 * @returns 所有 widget 数据数组
 */
export async function listHtmlWidgets(): Promise<HtmlCanvasWidgetData[]> {
  return withFallback(
    async () => {
      const result = await entitiesApi.queryEntities({ type: 'htmlWidget' })
      const items = result.items.map(e => e.data as unknown as HtmlCanvasWidgetData)
      items.sort((a, b) => b.createdAt - a.createdAt)
      return items
    },
    async () => {
      await ensureV2Ready()
      return runIdbTransaction([STORE], 'readonly', async (ctx) => {
        const result: HtmlCanvasWidgetData[] = []
        await ctx.iterateStore<HtmlCanvasWidgetData>(STORE, (record) => {
          result.push(record.data)
        })
        result.sort((a, b) => b.createdAt - a.createdAt)
        return result
      })
    },
  )
}
