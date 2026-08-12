import type { DataSourceDefinition } from '../types'

import { getAllNotes } from '../utils/dbStores/notes'
import { getAllJournals } from '../utils/dbStores/journals'
import { getAllQuickNotes } from '../utils/dbStores/quickNotes'
import { getAllSavingsGoals, getSavingsTransactionsByGoal } from '../utils/dbStores/savings'
import { getAllAIMemories, getAllAIAuditLogs } from '../utils/dbStores/aiData'

const dataSourceMap = new Map<string, DataSourceDefinition>()

export function registerDataSource(ds: DataSourceDefinition): void {
  dataSourceMap.set(ds.storeName, ds)
}

export function getDataSource(storeName: string): DataSourceDefinition | undefined {
  return dataSourceMap.get(storeName)
}

export function getAllDataSources(): DataSourceDefinition[] {
  return Array.from(dataSourceMap.values())
}

export function getReadableDataSources(): DataSourceDefinition[] {
  return Array.from(dataSourceMap.values()).filter(ds => ds.aiReadable === true)
}

export function registerAllDataSources(): void {
  // Existing data sources (7)
  registerDataSource({
    storeName: 'tasks',
    displayName: '任务',
    category: 'work',
    aiReadable: true,
    aiWritable: true,
    schema: { id: 'ID', panelId: '面板ID', title: '标题', status: '状态', priority: '优先级', dueAt: '截止时间', createdAt: '创建时间' },
  })

  registerDataSource({
    storeName: 'calendarEvents',
    displayName: '日程',
    category: 'work',
    aiReadable: true,
    aiWritable: true,
    schema: { id: 'ID', panelId: '面板ID', title: '标题', startsAt: '开始时间', endsAt: '结束时间', note: '备注' },
  })

  registerDataSource({
    storeName: 'habits',
    displayName: '习惯',
    category: 'life',
    aiReadable: true,
    aiWritable: true,
    schema: { id: 'ID', name: '名称', frequency: '频率', createdAt: '创建时间' },
  })

  registerDataSource({
    storeName: 'habitCheckins',
    displayName: '习惯打卡',
    category: 'life',
    aiReadable: true,
    aiWritable: true,
    schema: { id: 'ID', habitId: '习惯ID', date: '日期', checkedAt: '打卡时间' },
  })

  registerDataSource({
    storeName: 'moodEntries',
    displayName: '心情记录',
    category: 'life',
    aiReadable: true,
    aiWritable: true,
    schema: { id: 'ID', date: '日期', mood: '心情值', note: '备注' },
  })

  // New data sources (8)
  registerDataSource({
    storeName: 'notes',
    displayName: '笔记',
    category: 'basic',
    aiReadable: true,
    aiWritable: true,
    schema: { id: 'ID', title: '标题', content: '内容', tags: '标签', createdAt: '创建时间', updatedAt: '更新时间' },
    defaultQuery: async (options) => {
      const all = await getAllNotes()
      const offset = options?.offset ?? 0
      const limit = options?.limit ?? 50
      return { items: all.slice(offset, offset + limit), total: all.length }
    },
  })

  registerDataSource({
    storeName: 'journals',
    displayName: '日记',
    category: 'life',
    aiReadable: true,
    aiWritable: true,
    schema: { id: 'ID', date: '日期', content: '内容', mood: '心情', tags: '标签', createdAt: '创建时间', updatedAt: '更新时间' },
    defaultQuery: async (options) => {
      const all = await getAllJournals()
      const offset = options?.offset ?? 0
      const limit = options?.limit ?? 50
      return { items: all.slice(offset, offset + limit), total: all.length }
    },
  })

  registerDataSource({
    storeName: 'quickNotes',
    displayName: '随身记',
    category: 'life',
    aiReadable: true,
    aiWritable: true,
    schema: { id: 'ID', content: '内容', tags: '标签', createdAt: '创建时间' },
    defaultQuery: async (options) => {
      const all = await getAllQuickNotes()
      const offset = options?.offset ?? 0
      const limit = options?.limit ?? 50
      return { items: all.slice(offset, offset + limit), total: all.length }
    },
  })

  registerDataSource({
    storeName: 'savingsGoals',
    displayName: '存钱目标',
    category: 'life',
    aiReadable: true,
    aiWritable: true,
    schema: { id: 'ID', name: '名称', target: '目标金额', current: '当前金额', deadline: '截止日期', createdAt: '创建时间', updatedAt: '更新时间' },
    defaultQuery: async (options) => {
      const all = await getAllSavingsGoals()
      const offset = options?.offset ?? 0
      const limit = options?.limit ?? 50
      return { items: all.slice(offset, offset + limit), total: all.length }
    },
  })

  registerDataSource({
    storeName: 'savingsTransactions',
    displayName: '存钱交易',
    category: 'life',
    aiReadable: true,
    aiWritable: true,
    schema: { id: 'ID', goalId: '目标ID', amount: '金额', note: '备注', createdAt: '创建时间' },
    defaultQuery: async (options) => {
      // getAllSavingsTransactions 不存在，需要遍历所有 goals
      const goals = await getAllSavingsGoals()
      const all = []
      for (const goal of goals) {
        const txns = await getSavingsTransactionsByGoal(goal.id)
        all.push(...txns)
      }
      const offset = options?.offset ?? 0
      const limit = options?.limit ?? 50
      return { items: all.slice(offset, offset + limit), total: all.length }
    },
  })

  registerDataSource({
    storeName: 'aiConversations',
    displayName: 'AI对话',
    category: 'ai',
    aiReadable: true,
    aiWritable: true,
    schema: { id: 'ID', sessionId: '会话ID', role: '角色', content: '内容', createdAt: '创建时间' },
    // getAllAIConversations 不存在，暂不提供 defaultQuery
    // AI 工具通过 getAIConversationsBySession 按会话查询
  })

  registerDataSource({
    storeName: 'aiMemories',
    displayName: 'AI记忆',
    category: 'ai',
    aiReadable: true,
    aiWritable: true,
    schema: { id: 'ID', category: '分类', key: '键', value: '值', confidence: '置信度', source: '来源', pinned: '是否置顶', expiresAt: '过期时间', createdAt: '创建时间', updatedAt: '更新时间' },
    defaultQuery: async (options) => {
      const all = await getAllAIMemories()
      const offset = options?.offset ?? 0
      const limit = options?.limit ?? 50
      return { items: all.slice(offset, offset + limit), total: all.length }
    },
  })

  registerDataSource({
    storeName: 'aiAuditLog',
    displayName: 'AI审计日志',
    category: 'ai',
    aiReadable: true,
    aiWritable: false,
    schema: { id: 'ID', sessionId: '会话ID', toolName: '工具名', actionType: '操作类型', status: '状态', userConfirmed: '用户确认', createdAt: '创建时间' },
    defaultQuery: async (options) => {
      const all = await getAllAIAuditLogs()
      const offset = options?.offset ?? 0
      const limit = options?.limit ?? 50
      return { items: all.slice(offset, offset + limit), total: all.length }
    },
  })
}
