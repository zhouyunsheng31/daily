// Phase 12：dbStores 包装器
// 读操作：直接 re-export（不包装）
// 写操作（saveXxx / deleteXxx / updateXxx / createXxx / setXxx）：包装为成功后调 markSearchCacheStale
// async 失败时 throw，不调 markSearchCacheStale（数据未变更）
// 失效路径 A：本端通过 index.ts 写入立即失效（优化）
// 失效路径 B：handleServerChange 兜底（覆盖绕过 index.ts 的写入）
import { markSearchCacheStale } from '../searchCache'

import * as _notes from './notes'
// 读操作：直接 re-export
export const getNoteById = _notes.getNoteById
export const getAllNotes = _notes.getAllNotes
export const getNotesByTag = _notes.getNotesByTag
// 写操作：包装为成功后失效
export const saveNote: typeof _notes.saveNote = async (...args) => {
  try {
    const result = await _notes.saveNote(...args)
    markSearchCacheStale()
    return result
  } catch (err) {
    throw err
  }
}
export const deleteNote: typeof _notes.deleteNote = async (...args) => {
  try {
    const result = await _notes.deleteNote(...args)
    markSearchCacheStale()
    return result
  } catch (err) {
    throw err
  }
}

import * as _journals from './journals'
export const getJournalById = _journals.getJournalById
export const getJournalsByDate = _journals.getJournalsByDate
export const getAllJournals = _journals.getAllJournals
export const saveJournal: typeof _journals.saveJournal = async (...args) => {
  try {
    const result = await _journals.saveJournal(...args)
    markSearchCacheStale()
    return result
  } catch (err) {
    throw err
  }
}
export const deleteJournal: typeof _journals.deleteJournal = async (...args) => {
  try {
    const result = await _journals.deleteJournal(...args)
    markSearchCacheStale()
    return result
  } catch (err) {
    throw err
  }
}

import * as _quickNotes from './quickNotes'
export const getQuickNoteById = _quickNotes.getQuickNoteById
export const getAllQuickNotes = _quickNotes.getAllQuickNotes
export const getQuickNotesByTag = _quickNotes.getQuickNotesByTag
export const saveQuickNote: typeof _quickNotes.saveQuickNote = async (...args) => {
  try {
    const result = await _quickNotes.saveQuickNote(...args)
    markSearchCacheStale()
    return result
  } catch (err) {
    throw err
  }
}
export const deleteQuickNote: typeof _quickNotes.deleteQuickNote = async (...args) => {
  try {
    const result = await _quickNotes.deleteQuickNote(...args)
    markSearchCacheStale()
    return result
  } catch (err) {
    throw err
  }
}

import * as _savings from './savings'
export const getSavingsGoalById = _savings.getSavingsGoalById
export const getAllSavingsGoals = _savings.getAllSavingsGoals
export const getSavingsTransactionsByGoal = _savings.getSavingsTransactionsByGoal
export const saveSavingsGoal: typeof _savings.saveSavingsGoal = async (...args) => {
  try {
    const result = await _savings.saveSavingsGoal(...args)
    markSearchCacheStale()
    return result
  } catch (err) {
    throw err
  }
}
export const deleteSavingsGoal: typeof _savings.deleteSavingsGoal = async (...args) => {
  try {
    const result = await _savings.deleteSavingsGoal(...args)
    markSearchCacheStale()
    return result
  } catch (err) {
    throw err
  }
}
export const saveSavingsTransaction: typeof _savings.saveSavingsTransaction = async (...args) => {
  try {
    const result = await _savings.saveSavingsTransaction(...args)
    markSearchCacheStale()
    return result
  } catch (err) {
    throw err
  }
}
export const deleteSavingsTransaction: typeof _savings.deleteSavingsTransaction = async (...args) => {
  try {
    const result = await _savings.deleteSavingsTransaction(...args)
    markSearchCacheStale()
    return result
  } catch (err) {
    throw err
  }
}

import * as _aiData from './aiData'
export const getAIConversationsBySession = _aiData.getAIConversationsBySession
export const getAIMemoriesByCategory = _aiData.getAIMemoriesByCategory
export const getAIMemoriesByKey = _aiData.getAIMemoriesByKey
export const getAllAIMemories = _aiData.getAllAIMemories
export const getPinnedMemories = _aiData.getPinnedMemories
export const saveAIConversation: typeof _aiData.saveAIConversation = async (...args) => {
  try {
    const result = await _aiData.saveAIConversation(...args)
    markSearchCacheStale()
    return result
  } catch (err) {
    throw err
  }
}
export const deleteAIConversationsBySession: typeof _aiData.deleteAIConversationsBySession = async (...args) => {
  try {
    const result = await _aiData.deleteAIConversationsBySession(...args)
    markSearchCacheStale()
    return result
  } catch (err) {
    throw err
  }
}
export const deleteAllAIConversations: typeof _aiData.deleteAllAIConversations = async (...args) => {
  try {
    const result = await _aiData.deleteAllAIConversations(...args)
    markSearchCacheStale()
    return result
  } catch (err) {
    throw err
  }
}
export const saveAIMemory: typeof _aiData.saveAIMemory = async (...args) => {
  try {
    const result = await _aiData.saveAIMemory(...args)
    markSearchCacheStale()
    return result
  } catch (err) {
    throw err
  }
}
export const deleteAIMemory: typeof _aiData.deleteAIMemory = async (...args) => {
  try {
    const result = await _aiData.deleteAIMemory(...args)
    markSearchCacheStale()
    return result
  } catch (err) {
    throw err
  }
}
export const clearAllAIMemories: typeof _aiData.clearAllAIMemories = async (...args) => {
  try {
    const result = await _aiData.clearAllAIMemories(...args)
    markSearchCacheStale()
    return result
  } catch (err) {
    throw err
  }
}

import * as _quizSessions from './quizSessions'
export const getQuizSessionById = _quizSessions.getQuizSessionById
export const getAllQuizSessions = _quizSessions.getAllQuizSessions
export const getQuizSessionsByWidget = _quizSessions.getQuizSessionsByWidget
export const getQuizSessionsByPanel = _quizSessions.getQuizSessionsByPanel
export const saveQuizSession: typeof _quizSessions.saveQuizSession = async (...args) => {
  try {
    const result = await _quizSessions.saveQuizSession(...args)
    markSearchCacheStale()
    return result
  } catch (err) {
    throw err
  }
}
export const updateQuizSession: typeof _quizSessions.updateQuizSession = async (...args) => {
  try {
    const result = await _quizSessions.updateQuizSession(...args)
    markSearchCacheStale()
    return result
  } catch (err) {
    throw err
  }
}
export const deleteQuizSession: typeof _quizSessions.deleteQuizSession = async (...args) => {
  try {
    const result = await _quizSessions.deleteQuizSession(...args)
    markSearchCacheStale()
    return result
  } catch (err) {
    throw err
  }
}

import * as _vocabDecks from './vocabDecks'
export const getVocabDeckById = _vocabDecks.getVocabDeckById
export const getAllVocabDecks = _vocabDecks.getAllVocabDecks
export const getVocabDecksBySource = _vocabDecks.getVocabDecksBySource
export const saveVocabDeck: typeof _vocabDecks.saveVocabDeck = async (...args) => {
  try {
    const result = await _vocabDecks.saveVocabDeck(...args)
    markSearchCacheStale()
    return result
  } catch (err) {
    throw err
  }
}
export const updateVocabDeck: typeof _vocabDecks.updateVocabDeck = async (...args) => {
  try {
    const result = await _vocabDecks.updateVocabDeck(...args)
    markSearchCacheStale()
    return result
  } catch (err) {
    throw err
  }
}
export const deleteVocabDeck: typeof _vocabDecks.deleteVocabDeck = async (...args) => {
  try {
    const result = await _vocabDecks.deleteVocabDeck(...args)
    markSearchCacheStale()
    return result
  } catch (err) {
    throw err
  }
}

import * as _vocabProgress from './vocabProgress'
export const getVocabProgressById = _vocabProgress.getVocabProgressById
export const getVocabProgressByDeck = _vocabProgress.getVocabProgressByDeck
export const getVocabProgressByDeckAndStatus = _vocabProgress.getVocabProgressByDeckAndStatus
export const getDueVocabProgress = _vocabProgress.getDueVocabProgress
export const getAllDueVocabProgress = _vocabProgress.getAllDueVocabProgress
export const getVocabProgressStats = _vocabProgress.getVocabProgressStats
export const saveVocabProgress: typeof _vocabProgress.saveVocabProgress = async (...args) => {
  try {
    const result = await _vocabProgress.saveVocabProgress(...args)
    markSearchCacheStale()
    return result
  } catch (err) {
    throw err
  }
}
export const updateVocabProgress: typeof _vocabProgress.updateVocabProgress = async (...args) => {
  try {
    const result = await _vocabProgress.updateVocabProgress(...args)
    markSearchCacheStale()
    return result
  } catch (err) {
    throw err
  }
}
export const deleteVocabProgress: typeof _vocabProgress.deleteVocabProgress = async (...args) => {
  try {
    const result = await _vocabProgress.deleteVocabProgress(...args)
    markSearchCacheStale()
    return result
  } catch (err) {
    throw err
  }
}

import * as _sudokuGames from './sudokuGames'
export const getSudokuGameById = _sudokuGames.getSudokuGameById
export const getSudokuGamesByPanel = _sudokuGames.getSudokuGamesByPanel
export const getSudokuGamesByWidget = _sudokuGames.getSudokuGamesByWidget
export const getActiveSudokuGames = _sudokuGames.getActiveSudokuGames
export const getSudokuGameStats = _sudokuGames.getSudokuGameStats
export const saveSudokuGame: typeof _sudokuGames.saveSudokuGame = async (...args) => {
  try {
    const result = await _sudokuGames.saveSudokuGame(...args)
    markSearchCacheStale()
    return result
  } catch (err) {
    throw err
  }
}
export const updateSudokuGame: typeof _sudokuGames.updateSudokuGame = async (...args) => {
  try {
    const result = await _sudokuGames.updateSudokuGame(...args)
    markSearchCacheStale()
    return result
  } catch (err) {
    throw err
  }
}
export const deleteSudokuGame: typeof _sudokuGames.deleteSudokuGame = async (...args) => {
  try {
    const result = await _sudokuGames.deleteSudokuGame(...args)
    markSearchCacheStale()
    return result
  } catch (err) {
    throw err
  }
}

import * as _mistakes from './mistakes'
export const getMistakeById = _mistakes.getMistakeById
export const getAllMistakes = _mistakes.getAllMistakes
export const getMistakesByPanel = _mistakes.getMistakesByPanel
export const getMistakesBySourceType = _mistakes.getMistakesBySourceType
export const findMistakeBySourceAndQuestion = _mistakes.findMistakeBySourceAndQuestion
export const getDueMistakes = _mistakes.getDueMistakes
export const getMistakesByStatus = _mistakes.getMistakesByStatus
export const getMistakeStats = _mistakes.getMistakeStats
export const saveMistake: typeof _mistakes.saveMistake = async (...args) => {
  try {
    const result = await _mistakes.saveMistake(...args)
    markSearchCacheStale()
    return result
  } catch (err) {
    throw err
  }
}
export const updateMistake: typeof _mistakes.updateMistake = async (...args) => {
  try {
    const result = await _mistakes.updateMistake(...args)
    markSearchCacheStale()
    return result
  } catch (err) {
    throw err
  }
}
export const deleteMistake: typeof _mistakes.deleteMistake = async (...args) => {
  try {
    const result = await _mistakes.deleteMistake(...args)
    markSearchCacheStale()
    return result
  } catch (err) {
    throw err
  }
}

import * as _panelTemplates from './panelTemplates'
export const getPanelTemplateById = _panelTemplates.getPanelTemplateById
export const getAllPanelTemplates = _panelTemplates.getAllPanelTemplates
export const getBuiltinPanelTemplates = _panelTemplates.getBuiltinPanelTemplates
export const savePanelTemplate: typeof _panelTemplates.savePanelTemplate = async (...args) => {
  try {
    const result = await _panelTemplates.savePanelTemplate(...args)
    markSearchCacheStale()
    return result
  } catch (err) {
    throw err
  }
}
export const updatePanelTemplate: typeof _panelTemplates.updatePanelTemplate = async (...args) => {
  try {
    const result = await _panelTemplates.updatePanelTemplate(...args)
    markSearchCacheStale()
    return result
  } catch (err) {
    throw err
  }
}
export const deletePanelTemplate: typeof _panelTemplates.deletePanelTemplate = async (...args) => {
  try {
    const result = await _panelTemplates.deletePanelTemplate(...args)
    markSearchCacheStale()
    return result
  } catch (err) {
    throw err
  }
}

import * as _htmlWidgets from './htmlWidgets'
export const getHtmlWidget = _htmlWidgets.getHtmlWidget
export const listHtmlWidgets = _htmlWidgets.listHtmlWidgets
export const createHtmlWidget: typeof _htmlWidgets.createHtmlWidget = async (...args) => {
  try {
    const result = await _htmlWidgets.createHtmlWidget(...args)
    markSearchCacheStale()
    return result
  } catch (err) {
    throw err
  }
}
export const updateHtmlWidget: typeof _htmlWidgets.updateHtmlWidget = async (...args) => {
  try {
    const result = await _htmlWidgets.updateHtmlWidget(...args)
    markSearchCacheStale()
    return result
  } catch (err) {
    throw err
  }
}
export const deleteHtmlWidget: typeof _htmlWidgets.deleteHtmlWidget = async (...args) => {
  try {
    const result = await _htmlWidgets.deleteHtmlWidget(...args)
    markSearchCacheStale()
    return result
  } catch (err) {
    throw err
  }
}

import * as _kvStorage from './kvStorage'
export const getKvValue = _kvStorage.getKvValue
export const listKvKeys = _kvStorage.listKvKeys
export const setKvValue: typeof _kvStorage.setKvValue = async (...args) => {
  try {
    const result = await _kvStorage.setKvValue(...args)
    markSearchCacheStale()
    return result
  } catch (err) {
    throw err
  }
}
export const deleteKvValue: typeof _kvStorage.deleteKvValue = async (...args) => {
  try {
    const result = await _kvStorage.deleteKvValue(...args)
    markSearchCacheStale()
    return result
  } catch (err) {
    throw err
  }
}
