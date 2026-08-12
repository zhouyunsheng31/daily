import { useState } from 'react'

// 从 IndexedDB 直接读取所有数据，通过 REST API 逐条写入 SQLite
async function migrateAllData(): Promise<Record<string, number>> {
  const report: Record<string, number> = {}

  // 1. 读取 V2 格式的所有 IDB 数据
  const { runIdbTransaction } = await import('../utils/idbTx')
  const { ensureV2Ready } = await import('../utils/db')
  await ensureV2Ready()

  // 1.1 读取 panels
  const panelRecords: unknown[] = []
  await runIdbTransaction(['panels'], 'readonly', async (ctx) => {
    await ctx.iterateStore('panels', async (record: unknown) => {
      panelRecords.push(record)
    })
  })

  // 1.2 读取 widgetRecords + widgetStates
  const widgetRecordMap = new Map<string, unknown>()
  const widgetStateMap = new Map<string, unknown>()
  await runIdbTransaction(['widgetRecords', 'widgetStates'], 'readonly', async (ctx) => {
    await ctx.iterateStore('widgetRecords', async (record: unknown) => {
      const r = record as { id: string }
      widgetRecordMap.set(r.id, record)
    })
    await ctx.iterateStore('widgetStates', async (record: unknown) => {
      const r = record as { id: string }
      widgetStateMap.set(r.id, record)
    })
  })

  // 1.3 读取所有 dbStores 管理的数据
  const dbStores = await import('../utils/dbStores')
  const [notes, journals, quickNotes, savingsGoals, vocabDecks, mistakes, panelTemplates] = await Promise.all([
    dbStores.getAllNotes(), dbStores.getAllJournals(), dbStores.getAllQuickNotes(),
    dbStores.getAllSavingsGoals(), dbStores.getAllVocabDecks(),
    dbStores.getAllMistakes(), dbStores.getAllPanelTemplates(),
  ])
  // 读取 dynamicWidgets（通过 db 工具函数）
  const { getAllDynamicWidgets } = await import('../utils/db')
  const dynamicWidgets = await getAllDynamicWidgets() || []
  const savingsTransactions: unknown[] = []
  for (const goal of savingsGoals) {
    const txns = await dbStores.getSavingsTransactionsByGoal(goal.id)
    if (txns?.length) savingsTransactions.push(...txns)
  }
  const vocabProgress: unknown[] = []
  for (const deck of vocabDecks) {
    const progress = await dbStores.getVocabProgressByDeck(deck.id)
    if (progress?.length) vocabProgress.push(...progress)
  }
  const sudokuGames: unknown[] = []
  for (const pr of panelRecords) {
    const panelId = (pr as { id: string }).id
    const games = await dbStores.getSudokuGamesByPanel(panelId)
    if (games?.length) sudokuGames.push(...games)
  }
  const aiMemories = await dbStores.getAllAIMemories()
  // aiConversations 没有 getAll 函数，用 runIdbTransaction 直接读取
  const aiConversations: unknown[] = []
  await runIdbTransaction(['aiConversations'], 'readonly', async (ctx) => {
    await ctx.iterateStore('aiConversations', async (record: unknown) => {
      aiConversations.push((record as { data: unknown }).data)
    })
  })

  // 1.4 读取 playlists
  const { getPlaylist } = await import('../utils/db')
  const playlists: unknown[] = []
  for (const [widgetId, record] of widgetRecordMap) {
    const r = record as { data?: { widgetType?: string } }
    if (r.data?.widgetType === 'musicPlayer') {
      const pl = await getPlaylist(widgetId)
      if (pl) playlists.push(pl)
    }
  }

  // 1.5 读取 V1 格式的其他数据（tasks, habits, etc.）
  const { exportAllData } = await import('../utils/db')
  const blob = await exportAllData()
  const v1Data = JSON.parse(await blob.text())

  // 2. 通过 REST API 写入 SQLite
  const panelsApi = await import('../api/panels')
  const widgetsApi = await import('../api/widgets')
  const entitiesApi = await import('../api/entities')
  const settingsApi = await import('../api/settings')

  // 2.1 写入 panels（保留原始 ID）
  let count = 0
  for (const record of panelRecords) {
    const r = record as { id: string; data: Record<string, unknown> }
    const d = r.data
    await panelsApi.createPanel({
      id: r.id,
      name: (d.name as string) || '未命名',
      sortOrder: (d.order as number) ?? 0,
      settings: (d.settings as Record<string, unknown>) ?? {},
      canvasTransform: (d.canvasTransform as Record<string, unknown> | null) ?? null,
    }).catch(() => {})
    count++
  }
  report['panels'] = count

  // 2.2 写入 widgets（合并 widgetRecords + widgetStates，保留原始 ID）
  count = 0
  for (const [widgetId, record] of widgetRecordMap) {
    const r = record as { data: Record<string, unknown> }
    const d = r.data
    const stateRecord = widgetStateMap.get(widgetId) as { data?: { envelope?: { state?: unknown }; state?: unknown } } | undefined
    const widgetState = stateRecord?.data?.envelope?.state ?? stateRecord?.data?.state ?? {}
    await widgetsApi.createWidget(d.panelId as string, {
      id: widgetId,
      type: d.type as string,
      x: (d.x as number) ?? 0, y: (d.y as number) ?? 0, width: (d.width as number) ?? 300, height: (d.height as number) ?? 200,
      zIndex: (d.zIndex as number) ?? 0,
      minimized: (d.minimized as boolean) ?? false, locked: (d.locked as boolean) ?? false,
      colorScheme: (d.colorScheme as string | null) ?? null,
      state: widgetState as Record<string, unknown>,
    }).catch(() => {})
    count++
  }
  report['widgets'] = count

  // 2.3 写入 entities（所有业务数据）
  const entityData: Array<{ type: string; items: unknown[] }> = [
    { type: 'task', items: v1Data.tasks || [] },
    { type: 'focusSession', items: v1Data.focusSessions || [] },
    { type: 'habit', items: v1Data.habits || [] },
    { type: 'habitCheckin', items: v1Data.habitCheckins || [] },
    { type: 'moodEntry', items: v1Data.moodEntries || [] },
    { type: 'calendarEvent', items: v1Data.calendarEvents || [] },
    { type: 'drawingStroke', items: v1Data.drawingStrokes || [] },
    { type: 'widgetConnection', items: v1Data.widgetConnections || [] },
    { type: 'quizSession', items: v1Data.quizSessions || [] },
    { type: 'note', items: notes },
    { type: 'journal', items: journals },
    { type: 'quickNote', items: quickNotes },
    { type: 'savingsGoal', items: savingsGoals },
    { type: 'savingsTransaction', items: savingsTransactions },
    { type: 'aiMemory', items: aiMemories },
    { type: 'aiConversation', items: aiConversations },
    { type: 'vocabDeck', items: vocabDecks },
    { type: 'vocabProgress', items: vocabProgress },
    { type: 'sudokuGame', items: sudokuGames },
    { type: 'mistake', items: mistakes },
    { type: 'playlist', items: playlists },
  ]

  let totalEntities = 0
  for (const { type, items } of entityData) {
    let entityCount = 0
    for (let i = 0; i < items.length; i += 100) {
      const batch = items.slice(i, i + 100).map(item => {
        const r = item as Record<string, unknown>
        return {
          id: (type === 'playlist' ? r.widgetId : r.id) as string | undefined,
          type,
          scope: 'default',
          panelId: (r.panelId as string | null) || null,
          widgetId: (r.widgetId as string | null) || null,
          data: item as Record<string, unknown>,
        }
      })
      try {
        await entitiesApi.batchCreateEntities(batch)
        entityCount += batch.length
      } catch (err) {
        console.warn(`Failed to batch create ${type}:`, err)
      }
    }
    report[type] = entityCount
    totalEntities += entityCount
  }
  report['totalEntities'] = totalEntities

  // 2.4 写入 panelTemplates
  const dynamicWidgetsApi = await import('../api/dynamicWidgets')
  const panelTemplatesApi = await import('../api/panelTemplates')
  if (panelTemplates?.length) {
    let ptCount = 0
    for (const pt of panelTemplates) {
      await panelTemplatesApi.createPanelTemplate({
        id: pt.id,
        name: pt.name,
        icon: pt.icon || 'layout',
        description: pt.description || '',
        widgets: pt.widgets || [],
        isBuiltin: pt.isBuiltin ?? false,
      }).catch(() => {})
      ptCount++
    }
    report['panelTemplates'] = ptCount
  }
  // 2.5 写入 dynamicWidgets
  if (dynamicWidgets?.length) {
    let dwCount = 0
    for (const dw of dynamicWidgets) {
      await dynamicWidgetsApi.createDynamicWidget({
        widgetType: dw.widgetType,
        displayName: dw.displayName || '新组件',
        icon: dw.icon || 'box',
        defaultLayout: dw.defaultLayout || {},
        defaultState: dw.defaultState || {},
        code: dw.code || '',
      }).catch(() => {})
      dwCount++
    }
    report['dynamicWidgets'] = dwCount
  }

  // 2.6 写入 settings
  if (v1Data.settings) {
    await settingsApi.updateSettings(v1Data.settings)
    report['settings'] = 1
  }
  if (v1Data.activePanelId) {
    await panelsApi.setActivePanelId(v1Data.activePanelId)
  }

  return report
}

export default function MigrationPage() {
  const [status, setStatus] = useState<'idle' | 'reading' | 'migrating' | 'done' | 'error'>('idle')
  const [progress, setProgress] = useState('')
  const [report, setReport] = useState<Record<string, number> | null>(null)

  const handleMigrate = async () => {
    try {
      setStatus('reading')
      setProgress('正在从 IndexedDB 读取数据...')

      setStatus('migrating')
      setProgress('正在迁移到 SQLite 数据库...')

      const result = await migrateAllData()
      setReport(result)

      setStatus('done')
      setProgress('迁移完成！')
    } catch (err) {
      setStatus('error')
      setProgress(`迁移失败: ${err}`)
    }
  }

  return (
    <div style={{ padding: 40, maxWidth: 600, margin: '0 auto' }}>
      <h1>数据迁移</h1>
      <p>将 IndexedDB 中的数据迁移到 SQLite 后端数据库。</p>
      <p>请在 <strong>Tabbit 浏览器</strong>中打开此页面进行迁移，以确保所有数据被读取。</p>

      {status === 'idle' && (
        <button onClick={handleMigrate} style={{ padding: '12px 24px', fontSize: 16 }}>
          开始迁移
        </button>
      )}

      {status !== 'idle' && <p>{progress}</p>}

      {report && (
        <div style={{ marginTop: 20 }}>
          <h3>迁移结果</h3>
          <table style={{ borderCollapse: 'collapse', width: '100%' }}>
            <tbody>
              {Object.entries(report).map(([key, count]) => (
                <tr key={key}>
                  <td style={{ border: '1px solid #ddd', padding: 8 }}>{key}</td>
                  <td style={{ border: '1px solid #ddd', padding: 8 }}>{count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {status === 'done' && (
        <p style={{ color: 'green', marginTop: 20 }}>
          迁移成功！请刷新页面开始使用新数据库。
        </p>
      )}
    </div>
  )
}
