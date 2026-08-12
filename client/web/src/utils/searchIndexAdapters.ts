import type { SearchableRecord, SearchAdapter } from './searchCache'
import {
  getAllPanels,
  getAllWidgets,
  getAllTasks,
  getAllCalendarEvents,
  getAllHabits,
  getAllBookmarks,
  getAllMoodEntries,
  getAllDrawingStrokes,
  getAllWidgetConnections,
  getAllFocusSessions,
} from './db'
import { getAllNotes } from './dbStores/notes'
import { getAllJournals } from './dbStores/journals'
import { getAllQuickNotes } from './dbStores/quickNotes'
import { getAllMistakes } from './dbStores/mistakes'
import { getAllVocabDecks } from './dbStores/vocabDecks'
import { getAllVocabProgress } from './dbStores/vocabProgress'
import { getAllPanelTemplates } from './dbStores/panelTemplates'
import { listHtmlWidgets } from './dbStores/htmlWidgets'
import { getAllFavoritesFromIdb } from './dbStores/favorites'
import { getAllAIMemories, getAllAIConversations } from './dbStores/aiData'
import { getAllSavingsTransactions } from './dbStores/savings'
import { getAllDynamicWidgets } from '../api/dynamicWidgets'

// ============================================================
// Phase 12: 24 个搜索适配器
// 字段映射规则见 spec phase12-desktop-ai-search.md 3.5.4 节
// 每个适配器 try/catch 兜底，单个失败返回空数组不阻塞其他适配器
// ============================================================

// ---------- 1. panels ----------
async function adaptPanels(): Promise<SearchableRecord[]> {
  try {
    const panels = await getAllPanels()
    return panels.map((p): SearchableRecord => ({
      id: String(p.id),
      storeId: 'panels',
      type: 'panel',
      panelId: String(p.id),
      highWeightFields: { name: p.name || '' },
      mediumWeightFields: {},
      lowWeightFields: {},
      createdAt: 0,
      updatedAt: 0,
    }))
  } catch {
    return []
  }
}

// ---------- 2. widgetRecords ----------
async function adaptWidgets(): Promise<SearchableRecord[]> {
  try {
    const widgets = await getAllWidgets()
    return widgets.map((w): SearchableRecord => ({
      id: String(w.widgetId),
      storeId: 'widgetRecords',
      type: 'widget',
      highWeightFields: {},
      mediumWeightFields: {},
      lowWeightFields: { type: w.widgetType || '' },
      createdAt: 0,
      updatedAt: 0,
    }))
  } catch {
    return []
  }
}

// ---------- 3. tasks ----------
async function adaptTasks(): Promise<SearchableRecord[]> {
  try {
    const tasks = await getAllTasks()
    return tasks.map((t): SearchableRecord => ({
      id: String(t.id),
      storeId: 'tasks',
      type: 'task',
      panelId: String(t.panelId),
      highWeightFields: { title: t.title || '' },
      mediumWeightFields: {},
      lowWeightFields: {},
      createdAt: t.createdAt || 0,
      updatedAt: t.updatedAt || 0,
    }))
  } catch {
    return []
  }
}

// ---------- 4. calendarEvents ----------
async function adaptCalendarEvents(): Promise<SearchableRecord[]> {
  try {
    const events = await getAllCalendarEvents()
    return events.map((e): SearchableRecord => ({
      id: String(e.id),
      storeId: 'calendarEvents',
      type: 'calendarEvent',
      panelId: String(e.panelId),
      highWeightFields: { title: e.title || '' },
      mediumWeightFields: { note: e.note || '' },
      lowWeightFields: {},
      createdAt: e.createdAt || 0,
      updatedAt: e.updatedAt || 0,
    }))
  } catch {
    return []
  }
}

// ---------- 5. habits ----------
async function adaptHabits(): Promise<SearchableRecord[]> {
  try {
    const habits = await getAllHabits()
    return habits.map((h): SearchableRecord => ({
      id: String(h.id),
      storeId: 'habits',
      type: 'habit',
      panelId: String(h.panelId),
      highWeightFields: { title: h.title || '' },
      mediumWeightFields: {},
      lowWeightFields: {},
      createdAt: h.createdAt || 0,
      updatedAt: h.updatedAt || 0,
    }))
  } catch {
    return []
  }
}

// ---------- 6. notes ----------
async function adaptNotes(): Promise<SearchableRecord[]> {
  try {
    const notes = await getAllNotes()
    return notes.map((n): SearchableRecord => ({
      id: String(n.id),
      storeId: 'notes',
      type: 'note',
      highWeightFields: { title: n.title || '' },
      mediumWeightFields: { content: n.content || '' },
      lowWeightFields: { tags: (n.tags || []).join(' ') },
      createdAt: n.createdAt || 0,
      updatedAt: n.updatedAt || 0,
    }))
  } catch {
    return []
  }
}

// ---------- 7. journals ----------
async function adaptJournals(): Promise<SearchableRecord[]> {
  try {
    const journals = await getAllJournals()
    return journals.map((j): SearchableRecord => ({
      id: String(j.id),
      storeId: 'journals',
      type: 'journal',
      highWeightFields: {},
      mediumWeightFields: { content: j.content || '' },
      lowWeightFields: {},
      createdAt: j.createdAt || 0,
      updatedAt: j.updatedAt || 0,
    }))
  } catch {
    return []
  }
}

// ---------- 8. quickNotes ----------
async function adaptQuickNotes(): Promise<SearchableRecord[]> {
  try {
    const quickNotes = await getAllQuickNotes()
    return quickNotes.map((q): SearchableRecord => ({
      id: String(q.id),
      storeId: 'quickNotes',
      type: 'quickNote',
      highWeightFields: {},
      mediumWeightFields: { content: q.content || '' },
      lowWeightFields: { tags: (q.tags || []).join(' ') },
      createdAt: q.createdAt || 0,
      updatedAt: 0,
    }))
  } catch {
    return []
  }
}

// ---------- 9. mistakes ----------
async function adaptMistakes(): Promise<SearchableRecord[]> {
  try {
    const mistakes = await getAllMistakes()
    return mistakes.map((m): SearchableRecord => ({
      id: String(m.id),
      storeId: 'mistakes',
      type: 'mistake',
      panelId: String(m.panelId),
      highWeightFields: {},
      mediumWeightFields: {
        questionContent: m.questionContent || '',
        correctAnswer: m.correctAnswer || '',
        userAnswer: m.userAnswer || '',
        explanation: m.explanation || '',
      },
      lowWeightFields: {},
      createdAt: m.createdAt || 0,
      updatedAt: m.updatedAt || 0,
    }))
  } catch {
    return []
  }
}

// ---------- 10. vocabDecks ----------
async function adaptVocabDecks(): Promise<SearchableRecord[]> {
  try {
    const decks = await getAllVocabDecks()
    return decks.map((d): SearchableRecord => ({
      id: String(d.id),
      storeId: 'vocabDecks',
      type: 'vocabDeck',
      highWeightFields: { name: d.name || '' },
      mediumWeightFields: {},
      lowWeightFields: {},
      createdAt: d.createdAt || 0,
      updatedAt: d.updatedAt || 0,
    }))
  } catch {
    return []
  }
}

// ---------- 11. panelTemplates ----------
async function adaptPanelTemplates(): Promise<SearchableRecord[]> {
  try {
    const templates = await getAllPanelTemplates()
    return templates.map((t): SearchableRecord => ({
      id: String(t.id),
      storeId: 'panelTemplates',
      type: 'panelTemplate',
      highWeightFields: { name: t.name || '' },
      mediumWeightFields: {},
      lowWeightFields: {},
      createdAt: t.createdAt || 0,
      updatedAt: t.updatedAt || 0,
    }))
  } catch {
    return []
  }
}

// ---------- 12. htmlWidgets ----------
async function adaptHtmlWidgets(): Promise<SearchableRecord[]> {
  try {
    const widgets = await listHtmlWidgets()
    return widgets.map((h): SearchableRecord => ({
      id: String(h.id),
      storeId: 'htmlWidgets',
      type: 'htmlWidget',
      highWeightFields: { title: h.title || '' },
      mediumWeightFields: { html: h.html || '' },
      lowWeightFields: {},
      createdAt: h.createdAt || 0,
      updatedAt: h.updatedAt || 0,
    }))
  } catch {
    return []
  }
}

// ---------- 13. favorites ----------
async function adaptFavorites(): Promise<SearchableRecord[]> {
  try {
    const favorites = await getAllFavoritesFromIdb()
    return favorites.map((f): SearchableRecord => ({
      id: String(f.id),
      storeId: 'favorites',
      type: 'favorite',
      panelId: String(f.panelId),
      highWeightFields: { displayName: f.displayName || '' },
      mediumWeightFields: {},
      lowWeightFields: {},
      createdAt: f.createdAt || 0,
      updatedAt: f.updatedAt || 0,
    }))
  } catch {
    return []
  }
}

// ---------- 14. aiMemories ----------
async function adaptAIMemories(): Promise<SearchableRecord[]> {
  try {
    const memories = await getAllAIMemories()
    return memories.map((m): SearchableRecord => ({
      id: String(m.id),
      storeId: 'aiMemories',
      type: 'aiMemory',
      highWeightFields: {},
      mediumWeightFields: { value: m.value || '' },
      lowWeightFields: {
        category: m.category || '',
        key: m.key || '',
      },
      createdAt: m.createdAt || 0,
      updatedAt: m.updatedAt || 0,
    }))
  } catch {
    return []
  }
}

// ---------- 15. bookmarks ----------
async function adaptBookmarks(): Promise<SearchableRecord[]> {
  try {
    const bookmarks = await getAllBookmarks()
    return bookmarks.map((b): SearchableRecord => ({
      id: String(b.id),
      storeId: 'bookmarks',
      type: 'bookmark',
      highWeightFields: { title: b.title || '' },
      mediumWeightFields: {},
      lowWeightFields: { url: b.url || '' },
      createdAt: b.createdAt || 0,
      updatedAt: 0,
    }))
  } catch {
    return []
  }
}

// ---------- 17. moodEntries ----------
async function adaptMoodEntries(): Promise<SearchableRecord[]> {
  try {
    const entries = await getAllMoodEntries()
    return entries.map((e): SearchableRecord => ({
      id: String(e.id),
      storeId: 'moodEntries',
      type: 'moodEntry',
      panelId: String(e.panelId),
      highWeightFields: {},
      mediumWeightFields: { note: e.note || '' },
      lowWeightFields: {},
      createdAt: e.createdAt || 0,
      updatedAt: 0,
    }))
  } catch {
    return []
  }
}

// ---------- 18. savingsTransactions ----------
async function adaptSavingsTransactions(): Promise<SearchableRecord[]> {
  try {
    const txns = await getAllSavingsTransactions()
    return txns.map((t): SearchableRecord => ({
      id: String(t.id),
      storeId: 'savingsTransactions',
      type: 'savingsTransaction',
      highWeightFields: {},
      mediumWeightFields: { note: t.note || '' },
      lowWeightFields: {},
      createdAt: t.createdAt || 0,
      updatedAt: 0,
    }))
  } catch {
    return []
  }
}

// ---------- 19. drawingStrokes ----------
async function adaptDrawingStrokes(): Promise<SearchableRecord[]> {
  try {
    const strokes = await getAllDrawingStrokes()
    return strokes.map((s): SearchableRecord => ({
      id: String(s.id),
      storeId: 'drawingStrokes',
      type: 'drawingStroke',
      panelId: String(s.panelId),
      highWeightFields: {},
      mediumWeightFields: { text: s.text || '' },
      lowWeightFields: {},
      createdAt: s.createdAt || 0,
      updatedAt: s.updatedAt || 0,
    }))
  } catch {
    return []
  }
}

// ---------- 20. widgetConnections ----------
async function adaptWidgetConnections(): Promise<SearchableRecord[]> {
  try {
    const connections = await getAllWidgetConnections()
    return connections.map((c): SearchableRecord => ({
      id: String(c.id),
      storeId: 'widgetConnections',
      type: 'widgetConnection',
      panelId: String(c.panelId),
      highWeightFields: {},
      mediumWeightFields: { label: c.label || '' },
      lowWeightFields: {},
      createdAt: c.createdAt || 0,
      updatedAt: c.updatedAt || 0,
    }))
  } catch {
    return []
  }
}

// ---------- 21. focusSessions ----------
async function adaptFocusSessions(): Promise<SearchableRecord[]> {
  try {
    const sessions = await getAllFocusSessions()
    return sessions.map((s): SearchableRecord => ({
      id: String(s.id),
      storeId: 'focusSessions',
      type: 'focusSession',
      panelId: String(s.panelId),
      highWeightFields: {},
      mediumWeightFields: {
        label: s.label || '',
        taskTitleSnapshot: s.taskTitleSnapshot || '',
      },
      lowWeightFields: {},
      createdAt: s.createdAt || 0,
      updatedAt: 0,
    }))
  } catch {
    return []
  }
}

// ---------- 22. vocabProgress ----------
async function adaptVocabProgress(): Promise<SearchableRecord[]> {
  try {
    const progress = await getAllVocabProgress()
    return progress.map((v): SearchableRecord => ({
      id: String(v.id),
      storeId: 'vocabProgress',
      type: 'vocabProgress',
      highWeightFields: {},
      mediumWeightFields: {
        word: v.word || '',
        meaning: v.meaning || '',
      },
      lowWeightFields: {},
      createdAt: v.createdAt || 0,
      updatedAt: v.updatedAt || 0,
    }))
  } catch {
    return []
  }
}

// ---------- 23. aiConversations ----------
async function adaptAIConversations(): Promise<SearchableRecord[]> {
  try {
    const conversations = await getAllAIConversations()
    return conversations.map((c): SearchableRecord => ({
      id: String(c.id),
      storeId: 'aiConversations',
      type: 'aiConversation',
      highWeightFields: {},
      mediumWeightFields: { content: c.content || '' },
      lowWeightFields: {},
      createdAt: c.createdAt || 0,
      updatedAt: 0,
    }))
  } catch {
    return []
  }
}

// ---------- 24. dynamic-widgets ----------
async function adaptDynamicWidgets(): Promise<SearchableRecord[]> {
  try {
    const widgets = await getAllDynamicWidgets()
    return widgets.map((w): SearchableRecord => ({
      id: String(w.widgetType),
      storeId: 'dynamic-widgets',
      type: 'dynamicWidget',
      highWeightFields: { displayName: w.displayName || '' },
      mediumWeightFields: { code: w.code || '' },
      lowWeightFields: {},
      createdAt: w.createdAt || 0,
      updatedAt: w.updatedAt || 0,
    }))
  } catch {
    return []
  }
}

// ============================================================
// buildAllAdapters: 返回 24 个命名适配器
// 用 namedAdapter 包装，通过 Object.defineProperty 设置 name 属性。
// 注意：不能直接 Object.assign(fn, { name }) —— Function.name 在 ESM 严格模式下
// 是只读属性，Object.assign 会抛 TypeError。
// ============================================================
function namedAdapter(
  fn: () => Promise<SearchableRecord[]>,
  name: string,
): SearchAdapter {
  const wrapper = async () => fn()
  Object.defineProperty(wrapper, 'name', { value: name, configurable: true })
  return wrapper as SearchAdapter
}

export function buildAllAdapters(): SearchAdapter[] {
  return [
    namedAdapter(adaptPanels, 'panels'),
    namedAdapter(adaptWidgets, 'widgetRecords'),
    namedAdapter(adaptTasks, 'tasks'),
    namedAdapter(adaptCalendarEvents, 'calendarEvents'),
    namedAdapter(adaptHabits, 'habits'),
    namedAdapter(adaptNotes, 'notes'),
    namedAdapter(adaptJournals, 'journals'),
    namedAdapter(adaptQuickNotes, 'quickNotes'),
    namedAdapter(adaptMistakes, 'mistakes'),
    namedAdapter(adaptVocabDecks, 'vocabDecks'),
    namedAdapter(adaptPanelTemplates, 'panelTemplates'),
    namedAdapter(adaptHtmlWidgets, 'htmlWidgets'),
    namedAdapter(adaptFavorites, 'favorites'),
    namedAdapter(adaptAIMemories, 'aiMemories'),
    namedAdapter(adaptBookmarks, 'bookmarks'),
    namedAdapter(adaptMoodEntries, 'moodEntries'),
    namedAdapter(adaptSavingsTransactions, 'savingsTransactions'),
    namedAdapter(adaptDrawingStrokes, 'drawingStrokes'),
    namedAdapter(adaptWidgetConnections, 'widgetConnections'),
    namedAdapter(adaptFocusSessions, 'focusSessions'),
    namedAdapter(adaptVocabProgress, 'vocabProgress'),
    namedAdapter(adaptAIConversations, 'aiConversations'),
    namedAdapter(adaptDynamicWidgets, 'dynamic-widgets'),
  ]
}
