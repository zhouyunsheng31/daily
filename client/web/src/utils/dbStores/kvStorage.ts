import { ensureV2Ready, runIdbTransaction, upsertRecord } from '../db'
import type { KvStorageEntry } from '../../types'
import * as entitiesApi from '../../api/entities'
import { withFallback } from '../../api/adapter'

const STORE = 'kvStorage'

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
 * 根据 key 读取 KV 存储中的值。
 * @param key 业务 key（同时作为 IDB 记录的 id）
 * @returns value 值；不存在时返回 null
 */
export async function getKvValue(key: string): Promise<unknown | null> {
  return withFallback(
    async () => {
      try {
        const entity = await entitiesApi.getEntity(key)
        const entry = entity.data as unknown as KvStorageEntry
        return entry?.value ?? null
      } catch (err: unknown) {
        const e = err as { status?: number }
        if (e?.status === 404) return null
        throw err
      }
    },
    async () => {
      await ensureV2Ready()
      return runIdbTransaction([STORE], 'readonly', async (ctx) => {
        const record = await ctx.get<KvStorageEntry>(STORE, key)
        return record?.data?.value ?? null
      })
    },
  )
}

/**
 * 设置 KV 存储中指定 key 的值（upsert 语义：存在则更新，不存在则创建）。
 * @param key 业务 key（同时作为 IDB 记录的 id）
 * @param value 任意可序列化值
 */
export async function setKvValue(key: string, value: unknown): Promise<void> {
  const now = Date.now()
  const entry: KvStorageEntry = {
    key,
    value,
    updatedAt: now,
    schemaVersion: 1,
  }
  await withFallback(
    async () => { await upsertEntity(key, 'kvEntry', entry) },
    async () => {
      await ensureV2Ready()
      await runIdbTransaction([STORE], 'readwrite', async (ctx) => {
        await upsertRecord(ctx, STORE, key, entry)
      })
    },
  )
}

/**
 * 删除 KV 存储中指定 key 的记录。
 * @param key 业务 key
 */
export async function deleteKvValue(key: string): Promise<void> {
  await withFallback(
    () => entitiesApi.deleteEntity(key),
    async () => {
      await ensureV2Ready()
      await runIdbTransaction([STORE], 'readwrite', async (ctx) => {
        const existing = await ctx.get(STORE, key)
        if (existing) {
          await ctx.deleteChecked(STORE, { id: key })
        }
      })
    },
  )
}

/**
 * 列出 KV 存储中所有的 key。
 * @returns 所有 key 字符串数组
 */
export async function listKvKeys(): Promise<string[]> {
  return withFallback(
    async () => {
      const result = await entitiesApi.queryEntities({ type: 'kvEntry' })
      return result.items.map(e => (e.data as unknown as KvStorageEntry).key)
    },
    async () => {
      await ensureV2Ready()
      return runIdbTransaction([STORE], 'readonly', async (ctx) => {
        const keys: string[] = []
        await ctx.iterateStore<KvStorageEntry>(STORE, (record) => {
          keys.push(record.data.key)
        })
        return keys
      })
    },
  )
}
