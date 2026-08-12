import { buildAllAdapters } from './searchIndexAdapters'  // A4 批次创建

// SearchableRecord schema
export interface SearchableRecord {
  id: string
  storeId: string  // V2StoreName
  type: 'panel' | 'task' | 'calendarEvent' | 'habit' | 'note' | 'journal'
    | 'quickNote' | 'mistake' | 'vocabDeck' | 'vocabProgress' | 'panelTemplate'
    | 'bookmark' | 'webTab' | 'widget' | 'dynamicWidget' | 'htmlWidget'
    | 'favorite' | 'aiConversation' | 'aiMemory' | 'moodEntry'
    | 'savingsTransaction' | 'drawingStroke' | 'widgetConnection' | 'focusSession'
  panelId?: string
  highWeightFields: Record<string, string>   // 高权重字段（如 name/title）
  mediumWeightFields: Record<string, string>  // 中权重（如 content）
  lowWeightFields: Record<string, string>     // 低权重（如 tags/url）
  createdAt: number
  updatedAt: number
}

// 搜索适配器类型：命名函数，调用返回 SearchableRecord[]
export type SearchAdapter = (() => Promise<SearchableRecord[]>) & { name: string }

type SearchCache = Map<string, SearchableRecord[]>  // key = storeId
let cache: SearchCache = new Map()
let cacheStale = true
let cacheBuilding: Promise<void> | null = null

export function markSearchCacheStale(): void {
  cacheStale = true
}

export async function ensureCacheReady(): Promise<void> {
  if (!cacheStale) return
  if (cacheBuilding) { await cacheBuilding; return }
  cacheBuilding = (async () => {
    try {
      const adapters = buildAllAdapters()
      const newCache: SearchCache = new Map()
      await Promise.all(adapters.map(async (adapter: SearchAdapter) => {
        try {
          const records = await adapter()
          if (records.length > 0) {
            newCache.set(records[0].storeId, records)
          }
        } catch (err) {
          console.error(`[searchCache] adapter ${adapter.name} failed:`, err)
        }
      }))
      cache = newCache
      cacheStale = false
    } finally {
      cacheBuilding = null
    }
  })()
  try { await cacheBuilding } catch { /* 已记录 */ }
}

export function _getCachedRecords(): SearchableRecord[] {
  const all: SearchableRecord[] = []
  for (const records of cache.values()) {
    all.push(...records)
  }
  return all
}

// 测试辅助
export function _resetCacheForTesting(): void {
  cache = new Map()
  cacheStale = true
  cacheBuilding = null
}
