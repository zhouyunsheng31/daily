import { ensureV2Ready, runIdbTransaction, upsertRecord } from '../db'
import type { FavoriteEntry } from '../../types'

const STORE = 'favorites'

/**
 * 从 IDB 读取所有收藏组件记录。
 * @returns 所有收藏数据数组；IDB 不可用时返回空数组
 */
export async function getAllFavoritesFromIdb(): Promise<FavoriteEntry[]> {
  try {
    await ensureV2Ready()
    return await runIdbTransaction([STORE], 'readonly', async (ctx) => {
      const result: FavoriteEntry[] = []
      await ctx.iterateStore<FavoriteEntry>(STORE, (record) => {
        result.push(record.data)
      })
      return result
    })
  } catch (err) {
    console.error('[DB] getAllFavoritesFromIdb failed, returning empty array:', err)
    return []
  }
}

/**
 * 保存（upsert）单条收藏记录到 IDB。
 * @param favorite 收藏条目
 */
export async function saveFavoriteToIdb(favorite: FavoriteEntry): Promise<void> {
  try {
    await ensureV2Ready()
    await runIdbTransaction([STORE], 'readwrite', async (ctx) => {
      await upsertRecord(ctx, STORE, favorite.id, favorite)
    })
  } catch (err) {
    console.error('[DB] saveFavoriteToIdb failed:', err)
  }
}

/**
 * 从 IDB 删除指定 id 的收藏记录。
 * @param id 收藏记录 id
 */
export async function deleteFavoriteFromIdb(id: string): Promise<void> {
  try {
    await ensureV2Ready()
    await runIdbTransaction([STORE], 'readwrite', async (ctx) => {
      const existing = await ctx.get(STORE, id)
      if (existing) {
        await ctx.deleteChecked(STORE, { id })
      }
    })
  } catch (err) {
    console.error('[DB] deleteFavoriteFromIdb failed:', err)
  }
}

/**
 * 从 IDB 删除指定 panelId 下的所有收藏记录。
 * @param panelId 面板 id
 */
export async function deleteFavoritesByPanelIdFromIdb(panelId: string): Promise<void> {
  try {
    await ensureV2Ready()
    await runIdbTransaction([STORE], 'readwrite', async (ctx) => {
      const ids: string[] = []
      await ctx.iterateStore<FavoriteEntry>(STORE, (record) => {
        if (record.data?.panelId === panelId) ids.push(record.id)
      })
      for (const id of ids) {
        await ctx.deleteChecked(STORE, { id })
      }
    })
  } catch (err) {
    console.error('[DB] deleteFavoritesByPanelIdFromIdb failed:', err)
  }
}
