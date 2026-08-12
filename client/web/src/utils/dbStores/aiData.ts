import { ensureV2Ready, runIdbTransaction, upsertRecord } from '../db'
import type { AIConversation, AIMemory } from '../../types'
import * as entitiesApi from '../../api/entities'
import { withFallback, getBackend } from '../../api/adapter'

export interface AIAuditLog {
  id: string
  sessionId: string
  toolName: string
  actionType: 'create' | 'update' | 'delete' | 'read' | 'suggest'
  targetType?: 'widget' | 'canvas' | 'task' | 'note' | 'calendar' | 'memory'
  status: 'success' | 'failure'
  userConfirmed: boolean
  params?: unknown
  result?: unknown
  createdAt: number
  schemaVersion: 1
}

const CONVERSATIONS_STORE = 'aiConversations'
const MEMORIES_STORE = 'aiMemories'
const AUDIT_LOG_STORE = 'aiAuditLog'

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

// --- AIConversation ---

export async function saveAIConversation(conversation: AIConversation): Promise<void> {
  await withFallback(
    async () => { await upsertEntity(conversation.id, 'aiConversation', conversation) },
    async () => {
      await ensureV2Ready()
      await runIdbTransaction([CONVERSATIONS_STORE], 'readwrite', async (ctx) => {
        await upsertRecord(ctx, CONVERSATIONS_STORE, conversation.id, conversation)
      })
    },
  )
}

export async function getAIConversationsBySession(sessionId: string): Promise<AIConversation[]> {
  return withFallback(
    async () => {
      const result = await entitiesApi.queryEntities({ type: 'aiConversation' })
      return result.items.filter(e => e.data.sessionId === sessionId).map(e => e.data as unknown as AIConversation)
    },
    async () => {
      await ensureV2Ready()
      return runIdbTransaction([CONVERSATIONS_STORE], 'readonly', async (ctx) => {
        const records = await ctx.indexGetAll<AIConversation>(CONVERSATIONS_STORE, 'by_sessionId', sessionId)
        return records.map(r => r.data)
      })
    },
  )
}

export async function deleteAIConversationsBySession(sessionId: string): Promise<void> {
  if (getBackend() === 'api') {
    const result = await entitiesApi.queryEntities({ type: 'aiConversation' })
    const ids = result.items.filter(e => e.data.sessionId === sessionId).map(e => e.id)
    if (ids.length > 0) {
      await entitiesApi.batchDeleteEntities(ids)
    }
    return
  }
  await ensureV2Ready()
  await runIdbTransaction([CONVERSATIONS_STORE], 'readwrite', async (ctx) => {
    const records = await ctx.indexGetAll<AIConversation>(CONVERSATIONS_STORE, 'by_sessionId', sessionId)
    for (const record of records) {
      await ctx.deleteChecked(CONVERSATIONS_STORE, { id: record.id })
    }
  })
}

export async function deleteAllAIConversations(): Promise<void> {
  if (getBackend() === 'api') {
    const result = await entitiesApi.queryEntities({ type: 'aiConversation' })
    const ids = result.items.map(e => e.id)
    if (ids.length > 0) {
      await entitiesApi.batchDeleteEntities(ids)
    }
    return
  }
  await ensureV2Ready()
  await runIdbTransaction([CONVERSATIONS_STORE], 'readwrite', async (ctx) => {
    const ids: string[] = []
    await ctx.iterateStore<unknown>(CONVERSATIONS_STORE, (record) => {
      ids.push(record.id)
    })
    for (const id of ids) {
      await ctx.deleteChecked(CONVERSATIONS_STORE, { id })
    }
  })
}

// --- AIMemory ---

export async function saveAIMemory(memory: AIMemory): Promise<void> {
  await withFallback(
    async () => { await upsertEntity(memory.id, 'aiMemory', memory) },
    async () => {
      await ensureV2Ready()
      await runIdbTransaction([MEMORIES_STORE], 'readwrite', async (ctx) => {
        await upsertRecord(ctx, MEMORIES_STORE, memory.id, memory)
      })
    },
  )
}

export async function getAIMemoriesByCategory(category: string): Promise<AIMemory[]> {
  return withFallback(
    async () => {
      const result = await entitiesApi.queryEntities({ type: 'aiMemory' })
      return result.items.filter(e => e.data.category === category).map(e => e.data as unknown as AIMemory)
    },
    async () => {
      await ensureV2Ready()
      return runIdbTransaction([MEMORIES_STORE], 'readonly', async (ctx) => {
        const records = await ctx.indexGetAll<AIMemory>(MEMORIES_STORE, 'by_category', category)
        return records.map(r => r.data)
      })
    },
  )
}

export async function getAIMemoriesByKey(key: string): Promise<AIMemory[]> {
  return withFallback(
    async () => {
      const result = await entitiesApi.queryEntities({ type: 'aiMemory' })
      return result.items.filter(e => e.data.key === key).map(e => e.data as unknown as AIMemory)
    },
    async () => {
      await ensureV2Ready()
      return runIdbTransaction([MEMORIES_STORE], 'readonly', async (ctx) => {
        const records = await ctx.indexGetAll<AIMemory>(MEMORIES_STORE, 'by_key', key)
        return records.map(r => r.data)
      })
    },
  )
}

export async function getAllAIMemories(): Promise<AIMemory[]> {
  return withFallback(
    async () => {
      const result = await entitiesApi.queryEntities({ type: 'aiMemory' })
      return result.items.map(e => e.data as unknown as AIMemory)
    },
    async () => {
      await ensureV2Ready()
      return runIdbTransaction([MEMORIES_STORE], 'readonly', async (ctx) => {
        const result: AIMemory[] = []
        await ctx.iterateStore<AIMemory>(MEMORIES_STORE, (record) => {
          result.push(record.data)
        })
        return result
      })
    },
  )
}

export async function deleteAIMemory(id: string): Promise<void> {
  await withFallback(
    () => entitiesApi.deleteEntity(id),
    async () => {
      await ensureV2Ready()
      await runIdbTransaction([MEMORIES_STORE], 'readwrite', async (ctx) => {
        const existing = await ctx.get(MEMORIES_STORE, id)
        if (existing) {
          await ctx.deleteChecked(MEMORIES_STORE, { id })
        }
      })
    },
  )
}

export async function getPinnedMemories(): Promise<AIMemory[]> {
  return withFallback(
    async () => {
      const result = await entitiesApi.queryEntities({ type: 'aiMemory' })
      return result.items.filter(e => Boolean(e.data.pinned)).map(e => e.data as unknown as AIMemory)
    },
    async () => {
      await ensureV2Ready()
      return runIdbTransaction([MEMORIES_STORE], 'readonly', async (ctx) => {
        const records = await ctx.indexGetAll<AIMemory>(MEMORIES_STORE, 'by_pinned', 1)
        return records.map(r => r.data)
      })
    },
  )
}

export async function clearAllAIMemories(): Promise<void> {
  if (getBackend() === 'api') {
    const result = await entitiesApi.queryEntities({ type: 'aiMemory' })
    const ids = result.items.map(e => e.id)
    if (ids.length > 0) {
      await entitiesApi.batchDeleteEntities(ids)
    }
    return
  }
  await ensureV2Ready()
  await runIdbTransaction([MEMORIES_STORE], 'readwrite', async (ctx) => {
    const ids: string[] = []
    await ctx.iterateStore<unknown>(MEMORIES_STORE, (record) => {
      ids.push(record.id)
    })
    for (const id of ids) {
      await ctx.deleteChecked(MEMORIES_STORE, { id })
    }
  })
}

export async function updateAIMemory(id: string, updates: Partial<AIMemory>): Promise<void> {
  if (getBackend() === 'api') {
    const entity = await entitiesApi.getEntity(id)
    const updated = { ...entity.data, ...updates, updatedAt: Date.now() }
    await upsertEntity(id, 'aiMemory', updated, entity.panelId ?? undefined, entity.widgetId ?? undefined)
    return
  }
  await ensureV2Ready()
  await runIdbTransaction([MEMORIES_STORE], 'readwrite', async (ctx) => {
    const existing = await ctx.get<AIMemory>(MEMORIES_STORE, id)
    if (!existing) return
    const updated = { ...existing.data, ...updates, updatedAt: Date.now() }
    await upsertRecord(ctx, MEMORIES_STORE, id, updated)
  })
}

export async function toggleAIMemoryPin(id: string): Promise<void> {
  if (getBackend() === 'api') {
    const entity = await entitiesApi.getEntity(id)
    const updated = { ...entity.data, pinned: !(entity.data.pinned as boolean), updatedAt: Date.now() }
    await upsertEntity(id, 'aiMemory', updated, entity.panelId ?? undefined, entity.widgetId ?? undefined)
    return
  }
  await ensureV2Ready()
  await runIdbTransaction([MEMORIES_STORE], 'readwrite', async (ctx) => {
    const existing = await ctx.get<AIMemory>(MEMORIES_STORE, id)
    if (!existing) return
    const updated = { ...existing.data, pinned: !existing.data.pinned, updatedAt: Date.now() }
    await upsertRecord(ctx, MEMORIES_STORE, id, updated)
  })
}

export async function cleanupExpiredMemories(): Promise<number> {
  if (getBackend() === 'api') {
    try {
      const result = await entitiesApi.queryEntities({ type: 'aiMemory' })
      const now = Date.now()
      const expiredIds = result.items
        .filter(e => e.data.expiresAt && (e.data.expiresAt as number) < now)
        .map(e => e.id)
      if (expiredIds.length > 0) {
        await entitiesApi.batchDeleteEntities(expiredIds)
      }
      if (expiredIds.length > 0) {
        console.warn(`[dbStores] cleanupExpiredMemories: 清理了 ${expiredIds.length} 条过期记忆`)
      }
      return expiredIds.length
    } catch (e) {
      console.warn('[dbStores] cleanupExpiredMemories failed:', e)
      return 0
    }
  }
  try {
    await ensureV2Ready()
    const now = Date.now()
    let count = 0
    await runIdbTransaction([MEMORIES_STORE], 'readwrite', async (ctx) => {
      const ids: string[] = []
      await ctx.iterateStore<AIMemory>(MEMORIES_STORE, (record) => {
        if (record.data.expiresAt && record.data.expiresAt < now) {
          ids.push(record.id)
        }
      })
      for (const id of ids) {
        await ctx.deleteChecked(MEMORIES_STORE, { id })
      }
      count = ids.length
    })
    if (count > 0) {
      console.warn(`[dbStores] cleanupExpiredMemories: 清理了 ${count} 条过期记忆`)
    }
    return count
  } catch (e) {
    console.warn('[dbStores] cleanupExpiredMemories failed:', e)
    return 0
  }
}

export async function getAIMemoriesByCategoryAndKey(category: string, key: string): Promise<AIMemory[]> {
  return withFallback(
    async () => {
      const result = await entitiesApi.queryEntities({ type: 'aiMemory' })
      return result.items
        .filter(e => e.data.category === category && e.data.key === key)
        .map(e => e.data as unknown as AIMemory)
    },
    async () => {
      await ensureV2Ready()
      return runIdbTransaction([MEMORIES_STORE], 'readonly', async (ctx) => {
        const records = await ctx.indexGetAll<AIMemory>(MEMORIES_STORE, 'by_category', category)
        return records.filter(r => r.data.key === key).map(r => r.data)
      })
    },
  )
}

// --- AIAuditLog ---

export async function saveAIAuditLog(log: AIAuditLog): Promise<void> {
  await withFallback(
    async () => { await upsertEntity(log.id, 'aiAuditLog', log) },
    async () => {
      await ensureV2Ready()
      await runIdbTransaction([AUDIT_LOG_STORE], 'readwrite', async (ctx) => {
        await upsertRecord(ctx, AUDIT_LOG_STORE, log.id, log)
      })
    },
  )
}

export async function getAIAuditLogsBySession(sessionId: string): Promise<AIAuditLog[]> {
  return withFallback(
    async () => {
      const result = await entitiesApi.queryEntities({ type: 'aiAuditLog' })
      return result.items.filter(e => e.data.sessionId === sessionId).map(e => e.data as unknown as AIAuditLog)
    },
    async () => {
      await ensureV2Ready()
      return runIdbTransaction([AUDIT_LOG_STORE], 'readonly', async (ctx) => {
        const records = await ctx.indexGetAll<AIAuditLog>(AUDIT_LOG_STORE, 'by_sessionId', sessionId)
        return records.map(r => r.data)
      })
    },
  )
}

export async function getAllAIAuditLogs(): Promise<AIAuditLog[]> {
  return withFallback(
    async () => {
      const result = await entitiesApi.queryEntities({ type: 'aiAuditLog' })
      return result.items.map(e => e.data as unknown as AIAuditLog)
    },
    async () => {
      await ensureV2Ready()
      return runIdbTransaction([AUDIT_LOG_STORE], 'readonly', async (ctx) => {
        const result: AIAuditLog[] = []
        await ctx.iterateStore<AIAuditLog>(AUDIT_LOG_STORE, (record) => {
          result.push(record.data)
        })
        return result
      })
    },
  )
}

export async function clearAIAuditLogs(): Promise<void> {
  if (getBackend() === 'api') {
    const result = await entitiesApi.queryEntities({ type: 'aiAuditLog' })
    const ids = result.items.map(e => e.id)
    if (ids.length > 0) {
      await entitiesApi.batchDeleteEntities(ids)
    }
    return
  }
  await ensureV2Ready()
  await runIdbTransaction([AUDIT_LOG_STORE], 'readwrite', async (ctx) => {
    const ids: string[] = []
    await ctx.iterateStore<unknown>(AUDIT_LOG_STORE, (record) => {
      ids.push(record.id)
    })
    for (const id of ids) {
      await ctx.deleteChecked(AUDIT_LOG_STORE, { id })
    }
  })
}

export async function cleanupExpiredAuditLogs(): Promise<void> {
  if (getBackend() === 'api') {
    try {
      const result = await entitiesApi.queryEntities({ type: 'aiAuditLog' })
      const cutoff = Date.now() - 90 * 24 * 60 * 60 * 1000
      const expiredIds = result.items
        .filter(e => (e.data.createdAt as number) < cutoff)
        .map(e => e.id)
      if (expiredIds.length > 0) {
        await entitiesApi.batchDeleteEntities(expiredIds)
      }
    } catch (e) {
      console.warn('[dbStores] cleanupExpiredAuditLogs failed:', e)
    }
    return
  }
  try {
    await ensureV2Ready()
    const cutoff = Date.now() - 90 * 24 * 60 * 60 * 1000
    await runIdbTransaction([AUDIT_LOG_STORE], 'readwrite', async (ctx) => {
      const ids: string[] = []
      await ctx.iterateStore<AIAuditLog>(AUDIT_LOG_STORE, (record) => {
        if (record.data.createdAt < cutoff) {
          ids.push(record.id)
        }
      })
      for (const id of ids) {
        await ctx.deleteChecked(AUDIT_LOG_STORE, { id })
      }
    })
  } catch (e) {
    console.warn('[dbStores] cleanupExpiredAuditLogs failed:', e)
  }
}

/**
 * Phase 12 新增：全量读取 aiConversations（用于本地搜索索引）。
 * 类型注意：返回 AIConversation[]（不是 AIConversationRecord[]）——
 *   record.data as AIConversation 是安全的，V2 schema 保证 data 字段类型正确。
 *
 * 设计：直接走 runIdbTransaction 遍历 IDB store，不走 withFallback
 * （与现有 getAllAIMemories() 的 IDB 路径风格一致；搜索索引需要本地全量数据）
 */
export async function getAllAIConversations(): Promise<AIConversation[]> {
  await ensureV2Ready()
  return runIdbTransaction([CONVERSATIONS_STORE], 'readonly', async (ctx) => {
    const records: AIConversation[] = []
    await ctx.iterateStore<AIConversation>(CONVERSATIONS_STORE, (record) => {
      records.push(record.data as AIConversation)
    })
    return records
  })
}
