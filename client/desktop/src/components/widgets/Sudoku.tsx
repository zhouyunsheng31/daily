import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { v4 as uuidv4 } from 'uuid'
import { PartyPopper, X, Play, Pause, Pencil, Lightbulb, Grid3x3, ArrowLeft } from 'lucide-react'
import { isLightTheme } from '../../utils/color'
import { useAppStore } from '../../stores/useAppStore'
import { widgetDefinitionMap } from '../../registry/widgetDefinitions'
import {
  saveSudokuGame,
  getSudokuGameById,
  updateSudokuGame,
  getSudokuGamesByWidget,
} from '../../utils/dbStores/sudokuGames'
import { getPuzzleByDifficulty } from './sudokuData'
import type { WidgetProps, SudokuGame } from '../../types'

type Difficulty = 'easy' | 'medium' | 'hard'

const DIFFICULTY_LABELS: Record<Difficulty, string> = {
  easy: '简单',
  medium: '中等',
  hard: '困难',
}

const DIFFICULTY_COLORS: Record<Difficulty, string> = {
  easy: '#10b981',
  medium: '#f59e0b',
  hard: '#ef4444',
}

interface UndoEntry {
  cellIndex: number
  prevValue: number
  prevNotes: number[] | null
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
}

// Find cells that have conflicts (same number in same row/col/box)
function findConflicts(userGrid: number[], solution: number[]): Set<number> {
  const conflicts = new Set<number>()

  for (let i = 0; i < 81; i++) {
    const val = userGrid[i]
    if (val === 0) continue
    // Only mark as conflict if it's wrong (user entered wrong number)
    if (val !== solution[i]) {
      conflicts.add(i)
      continue
    }

    const row = Math.floor(i / 9)
    const col = i % 9
    const boxRow = Math.floor(row / 3) * 3
    const boxCol = Math.floor(col / 3) * 3

    let hasConflict = false
    // Check row
    for (let c = 0; c < 9; c++) {
      const j = row * 9 + c
      if (j !== i && userGrid[j] === val && userGrid[j] !== solution[j]) {
        hasConflict = true
        break
      }
    }
    if (!hasConflict) {
      for (let r = 0; r < 9; r++) {
        const j = r * 9 + col
        if (j !== i && userGrid[j] === val && userGrid[j] !== solution[j]) {
          hasConflict = true
          break
        }
      }
    }
    if (!hasConflict) {
      for (let r = boxRow; r < boxRow + 3 && !hasConflict; r++) {
        for (let c = boxCol; c < boxCol + 3 && !hasConflict; c++) {
          const j = r * 9 + c
          if (j !== i && userGrid[j] === val && userGrid[j] !== solution[j]) {
            hasConflict = true
          }
        }
      }
    }
    if (hasConflict) conflicts.add(i)
  }
  return conflicts
}

// Count how many of each number are placed on the grid
function countNumbers(userGrid: number[]): Record<number, number> {
  const counts: Record<number, number> = {}
  for (let n = 1; n <= 9; n++) counts[n] = 0
  for (let i = 0; i < 81; i++) {
    if (userGrid[i] !== 0) counts[userGrid[i]]++
  }
  return counts
}

export default function Sudoku({ widgetId, panelId, state, onUpdateState, onEditingChange }: WidgetProps) {
  const isLight = useAppStore(s => isLightTheme(s.settings.appearance))
  const FALLBACKS = isLight ? {
  surface: '#f8f9fa',
  bgSecondary: '#e9ecef',
  border: '#dee2e6',
  textPrimary: '#212529',
  textSecondary: '#6c757d',
  textTertiary: '#adb5bd',
  accent: '#3b82f6',
  accentLight: '#60a5fa',
  error: '#ef4444',
  errorBg: 'rgba(239,68,68,0.12)',
  errorBgSubtle: 'rgba(239,68,68,0.08)',
  success: '#10b981',
  successBg: 'rgba(16,185,129,0.12)',
  warning: '#f59e0b',
  onSurface: '#fff',
  widgetSecondary: '#8b5cf6',
} : {
  surface: '#1a1a2e',
  bgSecondary: '#2a2a4a',
  border: '#3a3a5a',
  textPrimary: '#e0e0e0',
  textSecondary: '#9ca3af',
  textTertiary: '#636366',
  accent: '#3b82f6',
  accentLight: '#60a5fa',
  error: '#ef4444',
  errorBg: 'rgba(239,68,68,0.2)',
  errorBgSubtle: 'rgba(239,68,68,0.15)',
  success: '#10b981',
  successBg: 'rgba(16,185,129,0.15)',
  warning: '#f59e0b',
  onSurface: '#fff',
  widgetSecondary: '#8b5cf6',
}
  const def = widgetDefinitionMap.get('sudoku')!
  const validation = def.validateState(state)
  // Use validated state for safe defaults, but read displayMode/currentGameId directly from raw props
  // This ensures the UI always reflects the actual stored state, not a validation fallback
  const rawDisplayMode = (state?.displayMode as string) || null
  const rawCurrentGameId = (state?.currentGameId as string) || null
  const rawDifficulty = (state?.difficulty as string) || null
  const rawNoteMode = state?.noteMode as boolean | undefined
  const s = (validation.ok ? validation.state : def.createDefaultState()) as Record<string, unknown>

  const currentGameId = rawCurrentGameId ?? s.currentGameId as string | null
  const displayMode = (rawDisplayMode === 'game' || rawDisplayMode === 'menu' ? rawDisplayMode : s.displayMode) as 'menu' | 'game'
  const difficulty = (rawDifficulty === 'easy' || rawDifficulty === 'medium' || rawDifficulty === 'hard' ? rawDifficulty : s.difficulty) as Difficulty
  const noteMode = rawNoteMode !== undefined ? rawNoteMode : s.noteMode as boolean

  // Game state
  const [game, setGame] = useState<SudokuGame | null>(null)
  const [userGrid, setUserGrid] = useState<number[]>([])
  const [notes, setNotes] = useState<Record<string, number[]>>({})
  const [selectedCell, setSelectedCell] = useState<number | null>(null)
  const [selectedNumber, setSelectedNumber] = useState<number>(0)
  const [elapsedSeconds, setElapsedSeconds] = useState(0)
  const [isPaused, setIsPaused] = useState(false)
  const [undoStack, setUndoStack] = useState<UndoEntry[]>([])
  const [completedGames, setCompletedGames] = useState<SudokuGame[]>([])
  const [message, setMessage] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [mistakes, setMistakes] = useState(0)
  const [, setHintsUsed] = useState(0)

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const gridRef = useRef<HTMLDivElement>(null)
  const isEditing = displayMode !== 'menu'

  const onEditingChangeRef = useRef(onEditingChange)
  useEffect(() => {
    onEditingChangeRef.current = onEditingChange
  }, [onEditingChange])

  useEffect(() => {
    onEditingChangeRef.current?.(isEditing)
  }, [isEditing])

  // Load completed games for menu
  const loadCompletedGames = useCallback(() => {
    if (displayMode === 'menu') {
      getSudokuGamesByWidget(widgetId).then(games => {
        setCompletedGames(games.filter(g => g.status === 'completed'))
      }).catch(() => {})
    }
  }, [displayMode, widgetId])

  useEffect(() => {
    loadCompletedGames()
  }, [loadCompletedGames])

  // Listen for AI tool execution events to refresh data when AI gets sudoku stats
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail
      if (detail?.store === 'sudoku' || detail?.targetType === 'sudoku') {
        loadCompletedGames()
      }
    }
    window.addEventListener('ai-entity-changed', handler)
    return () => window.removeEventListener('ai-entity-changed', handler)
  }, [loadCompletedGames])

  // Restore game on mount or game mode switch
  useEffect(() => {
    if (displayMode !== 'game' || !currentGameId) return
    let cancelled = false
    getSudokuGameById(currentGameId).then(g => {
      if (cancelled || !g) return
      setGame(g)
      setUserGrid([...g.userGrid])
      setNotes({ ...g.notes })
      setElapsedSeconds(g.elapsedSeconds)
      setIsPaused(g.isPaused)
      setUndoStack([])
      setMessage(null)
      setSelectedCell(null)
      setSelectedNumber(0)
      // Count mistakes from current grid
      let m = 0
      for (let i = 0; i < 81; i++) {
        if (g.puzzle[i] === 0 && g.userGrid[i] !== 0 && g.userGrid[i] !== g.solution[i]) m++
      }
      setMistakes(m)
    }).catch(() => {})
    return () => { cancelled = true }
  }, [displayMode, currentGameId])

  // Timer management
  useEffect(() => {
    if (displayMode !== 'game' || isPaused || !currentGameId) {
      if (timerRef.current) {
        clearInterval(timerRef.current)
        timerRef.current = null
      }
      return
    }
    timerRef.current = setInterval(() => {
      setElapsedSeconds(prev => prev + 1)
    }, 1000)
    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current)
        timerRef.current = null
      }
    }
  }, [displayMode, isPaused, currentGameId])

  // Save game to DB
  const saveGame = useCallback(async (gameData: SudokuGame, updates: Partial<SudokuGame> = {}) => {
    const merged = { ...gameData, ...updates, updatedAt: Date.now() }
    try {
      await updateSudokuGame(gameData.id, updates)
      setGame(merged)
    } catch (err) {
      console.warn('Failed to save game', err)
    }
  }, [])

  const startNewGame = useCallback(async () => {
    setLoading(true)
    try {
      const puzzleData = getPuzzleByDifficulty(difficulty)
      const newGame: SudokuGame = {
        id: uuidv4(),
        panelId,
        sudokuWidgetId: widgetId,
        difficulty,
        puzzle: [...puzzleData.puzzle],
        solution: [...puzzleData.solution],
        userGrid: [...puzzleData.puzzle],
        notes: {},
        startedAt: Date.now(),
        finishedAt: 0,
        elapsedSeconds: 0,
        isPaused: false,
        status: 'playing',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        schemaVersion: 1,
      }
      await saveSudokuGame(newGame)
      setGame(newGame)
      setUserGrid([...newGame.userGrid])
      setNotes({})
      setElapsedSeconds(0)
      setIsPaused(false)
      setUndoStack([])
      setSelectedCell(null)
      setSelectedNumber(0)
      setMessage(null)
      setMistakes(0)
      setHintsUsed(0)
      onUpdateState({ currentGameId: newGame.id, displayMode: 'game' })
    } catch (err) {
      console.warn('Failed to start game', err)
    } finally {
      setLoading(false)
    }
  }, [difficulty, panelId, widgetId, onUpdateState])

  const continueGame = useCallback(() => {
    if (currentGameId) {
      onUpdateState({ displayMode: 'game' })
    }
  }, [currentGameId, onUpdateState])

  const backToMenu = useCallback(async () => {
    if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
    if (game) {
      await saveGame(game, {
        userGrid,
        notes,
        elapsedSeconds,
        isPaused: true,
      })
    }
    onUpdateState({ displayMode: 'menu' })
    setSelectedCell(null)
    setSelectedNumber(0)
    setMessage(null)
  }, [game, userGrid, notes, elapsedSeconds, saveGame, onUpdateState])

  const togglePause = useCallback(async () => {
    const newPaused = !isPaused
    setIsPaused(newPaused)
    if (game) {
      await saveGame(game, { isPaused: newPaused, elapsedSeconds, userGrid, notes })
    }
  }, [isPaused, game, elapsedSeconds, userGrid, notes, saveGame])

  const handleHint = useCallback(() => {
    if (!game) return
    // Find a suitable cell for hint: prefer selected cell if empty, otherwise find random empty cell
    let targetCell: number
    if (selectedCell !== null && game.puzzle[selectedCell] === 0 && userGrid[selectedCell] !== game.solution[selectedCell]) {
      targetCell = selectedCell
    } else {
      // Find all empty or wrong cells
      const candidates: number[] = []
      for (let i = 0; i < 81; i++) {
        if (game.puzzle[i] === 0 && userGrid[i] !== game.solution[i]) {
          candidates.push(i)
        }
      }
      if (candidates.length === 0) return
      targetCell = candidates[Math.floor(Math.random() * candidates.length)]
    }

    const prevValue = userGrid[targetCell]
    const key = `${Math.floor(targetCell / 9)}-${targetCell % 9}`
    const prevNotes = notes[key] ?? null

    const newGrid = [...userGrid]
    newGrid[targetCell] = game.solution[targetCell]
    setUserGrid(newGrid)

    const newNotesMap = { ...notes }
    delete newNotesMap[key]
    setNotes(newNotesMap)

    const newUndo: UndoEntry = { cellIndex: targetCell, prevValue, prevNotes }
    setUndoStack(prev => [...prev.slice(-49), newUndo])
    setHintsUsed(prev => prev + 1)
    setSelectedCell(targetCell)
    setSelectedNumber(game.solution[targetCell])

    saveGame(game, { userGrid: newGrid, notes: newNotesMap, elapsedSeconds })

    // Check completion
    const allFilled = newGrid.every(v => v !== 0)
    if (allFilled) {
      const isCorrect = newGrid.every((v, i) => v === game.solution[i])
      if (isCorrect) {
        if (timerRef.current) {
          clearInterval(timerRef.current)
          timerRef.current = null
        }
        setMessage('恭喜完成！')
        saveGame(game, {
          userGrid: newGrid,
          notes: newNotesMap,
          elapsedSeconds,
          finishedAt: Date.now(),
          status: 'completed',
          isPaused: false,
        })
      }
    }
  }, [game, userGrid, notes, selectedCell, elapsedSeconds, saveGame])

  const handleCellClick = useCallback((cellIndex: number) => {
    if (!game) return
    const isPreset = game.puzzle[cellIndex] !== 0

    setSelectedCell(cellIndex)

    if (isPreset) return

    if (noteMode) {
      const key = `${Math.floor(cellIndex / 9)}-${cellIndex % 9}`
      const currentNotes = notes[key] ?? []
      if (selectedNumber !== 0) {
        const newNotes = currentNotes.includes(selectedNumber)
          ? currentNotes.filter(n => n !== selectedNumber)
          : [...currentNotes, selectedNumber].sort()
        const newNotesMap = { ...notes, [key]: newNotes }
        setNotes(newNotesMap)
        if (game) {
          saveGame(game, { notes: newNotesMap, userGrid, elapsedSeconds })
        }
      }
    } else {
      if (selectedNumber === 0) {
        // No number selected, just select the cell (don't erase)
        return
      } else {
        // Fill number
        const prevValue = userGrid[cellIndex]
        const key = `${Math.floor(cellIndex / 9)}-${cellIndex % 9}`
        const prevNotes = notes[key] ?? null

        const newGrid = [...userGrid]
        newGrid[cellIndex] = selectedNumber
        setUserGrid(newGrid)

        // Track mistakes
        if (selectedNumber !== game.solution[cellIndex]) {
          setMistakes(prev => prev + 1)
        }

        // Clear notes for this cell
        const newNotesMap = { ...notes }
        delete newNotesMap[key]

        // Remove this number from notes in same row/col/box
        const row = Math.floor(cellIndex / 9)
        const col = cellIndex % 9
        const boxRow = Math.floor(row / 3) * 3
        const boxCol = Math.floor(col / 3) * 3

        for (let c = 0; c < 9; c++) {
          const nk = `${row}-${c}`
          if (newNotesMap[nk]) {
            newNotesMap[nk] = newNotesMap[nk].filter(n => n !== selectedNumber)
            if (newNotesMap[nk].length === 0) delete newNotesMap[nk]
          }
        }
        for (let r = 0; r < 9; r++) {
          const nk = `${r}-${col}`
          if (newNotesMap[nk]) {
            newNotesMap[nk] = newNotesMap[nk].filter(n => n !== selectedNumber)
            if (newNotesMap[nk].length === 0) delete newNotesMap[nk]
          }
        }
        for (let r = boxRow; r < boxRow + 3; r++) {
          for (let c = boxCol; c < boxCol + 3; c++) {
            const nk = `${r}-${c}`
            if (newNotesMap[nk]) {
              newNotesMap[nk] = newNotesMap[nk].filter(n => n !== selectedNumber)
              if (newNotesMap[nk].length === 0) delete newNotesMap[nk]
            }
          }
        }

        setNotes(newNotesMap)

        const newUndo: UndoEntry = { cellIndex, prevValue, prevNotes }
        setUndoStack(prev => [...prev.slice(-49), newUndo])

        if (game) {
          saveGame(game, { userGrid: newGrid, notes: newNotesMap, elapsedSeconds })
        }

        // Check completion
        const allFilled = newGrid.every(v => v !== 0)
        if (allFilled) {
          const isCorrect = newGrid.every((v, i) => v === game.solution[i])
          if (isCorrect) {
            if (timerRef.current) {
              clearInterval(timerRef.current)
              timerRef.current = null
            }
            setMessage('恭喜完成！')
            saveGame(game, {
              userGrid: newGrid,
              notes: newNotesMap,
              elapsedSeconds,
              finishedAt: Date.now(),
              status: 'completed',
              isPaused: false,
            })
          }
        }
      }
    }
  }, [game, userGrid, notes, selectedNumber, noteMode, elapsedSeconds, saveGame])

  const handleUndo = useCallback(() => {
    if (undoStack.length === 0) return
    const entry = undoStack[undoStack.length - 1]
    const newGrid = [...userGrid]
    newGrid[entry.cellIndex] = entry.prevValue
    setUserGrid(newGrid)

    const key = `${Math.floor(entry.cellIndex / 9)}-${entry.cellIndex % 9}`
    const newNotesMap = { ...notes }
    if (entry.prevNotes !== null && entry.prevNotes.length > 0) {
      newNotesMap[key] = entry.prevNotes
    } else {
      delete newNotesMap[key]
    }
    setNotes(newNotesMap)
    setUndoStack(prev => prev.slice(0, -1))

    if (game) {
      saveGame(game, { userGrid: newGrid, notes: newNotesMap, elapsedSeconds })
    }
  }, [undoStack, userGrid, notes, game, elapsedSeconds, saveGame])

  const toggleNoteMode = useCallback(() => {
    onUpdateState({ noteMode: !noteMode })
  }, [noteMode, onUpdateState])

  const handleNumberSelect = useCallback((n: number) => {
    setSelectedNumber(n)
    onUpdateState({ noteMode: false })

    // Auto-fill selected cell if it's not a preset cell (sudoku.com style)
    if (selectedCell !== null && game && game.puzzle[selectedCell] === 0) {
      if (noteMode) {
        const key = `${Math.floor(selectedCell / 9)}-${selectedCell % 9}`
        const currentNotes = notes[key] ?? []
        const newNotes = currentNotes.includes(n)
          ? currentNotes.filter(x => x !== n)
          : [...currentNotes, n].sort()
        const newNotesMap = { ...notes, [key]: newNotes }
        setNotes(newNotesMap)
        saveGame(game, { notes: newNotesMap, userGrid, elapsedSeconds })
      } else {
        const prevValue = userGrid[selectedCell]
        const key = `${Math.floor(selectedCell / 9)}-${selectedCell % 9}`
        const prevNotes = notes[key] ?? null

        const newGrid = [...userGrid]
        newGrid[selectedCell] = n
        setUserGrid(newGrid)

        if (n !== game.solution[selectedCell]) {
          setMistakes(prev => prev + 1)
        }

        const newNotesMap = { ...notes }
        delete newNotesMap[key]

        // Remove this number from notes in same row/col/box
        const row = Math.floor(selectedCell / 9)
        const col = selectedCell % 9
        const boxRow = Math.floor(row / 3) * 3
        const boxCol = Math.floor(col / 3) * 3

        for (let c = 0; c < 9; c++) {
          const nk = `${row}-${c}`
          if (newNotesMap[nk]) {
            newNotesMap[nk] = newNotesMap[nk].filter(x => x !== n)
            if (newNotesMap[nk].length === 0) delete newNotesMap[nk]
          }
        }
        for (let r = 0; r < 9; r++) {
          const nk = `${r}-${col}`
          if (newNotesMap[nk]) {
            newNotesMap[nk] = newNotesMap[nk].filter(x => x !== n)
            if (newNotesMap[nk].length === 0) delete newNotesMap[nk]
          }
        }
        for (let r = boxRow; r < boxRow + 3; r++) {
          for (let c = boxCol; c < boxCol + 3; c++) {
            const nk = `${r}-${c}`
            if (newNotesMap[nk]) {
              newNotesMap[nk] = newNotesMap[nk].filter(x => x !== n)
              if (newNotesMap[nk].length === 0) delete newNotesMap[nk]
            }
          }
        }

        setNotes(newNotesMap)

        const newUndo: UndoEntry = { cellIndex: selectedCell, prevValue, prevNotes }
        setUndoStack(prev => [...prev.slice(-49), newUndo])

        saveGame(game, { userGrid: newGrid, notes: newNotesMap, elapsedSeconds })

        // Check completion
        const allFilled = newGrid.every(v => v !== 0)
        if (allFilled) {
          const isCorrect = newGrid.every((v, i) => v === game.solution[i])
          if (isCorrect) {
            if (timerRef.current) {
              clearInterval(timerRef.current)
              timerRef.current = null
            }
            setMessage('恭喜完成！')
            saveGame(game, {
              userGrid: newGrid, notes: newNotesMap, elapsedSeconds,
              finishedAt: Date.now(), status: 'completed', isPaused: false,
            })
          }
        }
      }
    }
  }, [onUpdateState, selectedCell, game, userGrid, notes, noteMode, elapsedSeconds, saveGame])

  const handleErase = useCallback(() => {
    if (selectedCell === null || !game) return
    const isPreset = game.puzzle[selectedCell] !== 0
    if (isPreset) return
    if (userGrid[selectedCell] === 0) return

    const prevValue = userGrid[selectedCell]
    const key = `${Math.floor(selectedCell / 9)}-${selectedCell % 9}`
    const prevNotes = notes[key] ?? null

    const newGrid = [...userGrid]
    newGrid[selectedCell] = 0
    setUserGrid(newGrid)

    const newNotesMap = { ...notes }
    delete newNotesMap[key]
    setNotes(newNotesMap)

    const newUndo: UndoEntry = { cellIndex: selectedCell, prevValue, prevNotes }
    setUndoStack(prev => [...prev.slice(-49), newUndo])

    saveGame(game, { userGrid: newGrid, notes: newNotesMap, elapsedSeconds })
  }, [selectedCell, game, userGrid, notes, elapsedSeconds, saveGame])

  // Computed values
  const numberCounts = useMemo(() => countNumbers(userGrid), [userGrid])
  const conflicts = useMemo(() => game ? findConflicts(userGrid, game.solution) : new Set<number>(), [userGrid, game])

  // ============ Render: Menu Mode ============
  if (displayMode === 'menu') {
    const hasActiveGame = currentGameId !== null
    return (
      <div style={{
        height: '100%', display: 'flex', flexDirection: 'column',
        padding: 16, gap: 12, overflow: 'auto',
        background: `var(--widget-surface, ${FALLBACKS.surface})`, color: `var(--text-primary, ${FALLBACKS.textPrimary})`,
      }}>
        <div style={{ textAlign: 'center', marginBottom: 4 }}>
          <div style={{ fontSize: 28, marginBottom: 4 }}><Grid3x3 size={28} /></div>
          <h3 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>数独</h3>
        </div>

        {hasActiveGame && (
          <div style={{
            padding: 12, background: FALLBACKS.accent + '26', borderRadius: 8,
            fontSize: 13, display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          }}>
            <span>有未完成的游戏</span>
            <button
              onClick={continueGame}
              style={{
                padding: '6px 16px', fontSize: 13, fontWeight: 600,
                background: FALLBACKS.accent, color: `var(--widget-on-surface, ${FALLBACKS.onSurface})`, border: 'none', borderRadius: 6, cursor: 'pointer',
              }}
            >
              继续
            </button>
          </div>
        )}

        <div style={{ fontSize: 13, color: `var(--text-secondary, ${FALLBACKS.textSecondary})`, textAlign: 'center' }}>选择难度</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {(['easy', 'medium', 'hard'] as Difficulty[]).map(d => (
            <button
              key={d}
              onClick={() => onUpdateState({ difficulty: d })}
              style={{
                padding: '12px 16px', fontSize: 14, fontWeight: 600,
                background: difficulty === d ? DIFFICULTY_COLORS[d] : `var(--bg-secondary, ${FALLBACKS.bgSecondary})`,
                color: difficulty === d ? `var(--widget-on-surface, ${FALLBACKS.onSurface})` : `var(--text-primary, ${FALLBACKS.textPrimary})`,
                border: '2px solid ' + (difficulty === d ? DIFFICULTY_COLORS[d] : `var(--border-color, ${FALLBACKS.border})`),
                borderRadius: 8, cursor: 'pointer',
                transition: 'all 0.15s',
              }}
            >
              {DIFFICULTY_LABELS[d]}
            </button>
          ))}
        </div>

        <button
          onClick={startNewGame}
          disabled={loading}
          style={{
            padding: '12px 24px', fontSize: 15, fontWeight: 700,
            background: loading ? `var(--text-tertiary, ${FALLBACKS.textTertiary})` : FALLBACKS.accent,
            color: `var(--widget-on-surface, ${FALLBACKS.onSurface})`, border: 'none', borderRadius: 8,
            cursor: loading ? 'not-allowed' : 'pointer',
            transition: 'all 0.15s',
          }}
        >
          {loading ? '加载中...' : '开始游戏'}
        </button>

        {completedGames.length > 0 && (
          <div style={{ marginTop: 4 }}>
            <div style={{ fontSize: 12, color: `var(--text-tertiary, ${FALLBACKS.textTertiary})`, marginBottom: 4 }}>
              已完成 ({completedGames.length})
            </div>
            <div style={{ maxHeight: 100, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 3 }}>
              {completedGames.slice().reverse().map(g => (
                <div key={g.id} style={{
                  fontSize: 12, padding: '4px 8px',
                  background: `var(--bg-secondary, ${FALLBACKS.bgSecondary})`, borderRadius: 4,
                  display: 'flex', justifyContent: 'space-between',
                }}>
                  <span style={{ color: DIFFICULTY_COLORS[g.difficulty] }}>{DIFFICULTY_LABELS[g.difficulty]}</span>
                  <span style={{ color: `var(--text-secondary, ${FALLBACKS.textSecondary})` }}>{formatTime(g.elapsedSeconds)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    )
  }

  // ============ Render: Game Mode ============
  if (!game) {
    return <div style={{ padding: 12, fontSize: 13, color: `var(--text-tertiary, ${FALLBACKS.textTertiary})` }}>加载中...</div>
  }

  const puzzle = game.puzzle
  const selectedRow = selectedCell !== null ? Math.floor(selectedCell / 9) : -1
  const selectedCol = selectedCell !== null ? selectedCell % 9 : -1
  const selectedBoxRow = Math.floor(selectedRow / 3) * 3
  const selectedBoxCol = Math.floor(selectedCol / 3) * 3

  return (
    <div style={{
      height: '100%', display: 'flex', flexDirection: 'column',
      padding: 4, gap: 4, userSelect: 'none',
      background: `var(--widget-surface, ${FALLBACKS.surface})`, color: `var(--text-primary, ${FALLBACKS.textPrimary})`,
      overflow: 'hidden',
    }}>
      {/* Top bar: back + difficulty + timer + mistakes */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        padding: '2px 4px', fontSize: 12, flexShrink: 0,
      }}>
        <button
          onClick={backToMenu}
          style={{
            fontSize: 12, padding: '3px 8px',
            background: `var(--bg-secondary, ${FALLBACKS.bgSecondary})`, color: `var(--text-primary, ${FALLBACKS.textPrimary})`,
            border: `1px solid var(--border-color, ${FALLBACKS.border})`, borderRadius: 4, cursor: 'pointer',
          }}
        >
          <ArrowLeft size={12} /> 返回
        </button>
        <span style={{
          fontSize: 11, fontWeight: 600, color: DIFFICULTY_COLORS[game.difficulty],
          padding: '2px 6px', borderRadius: 4,
          background: `${DIFFICULTY_COLORS[game.difficulty]}20`,
        }}>
          {DIFFICULTY_LABELS[game.difficulty]}
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 11, color: `var(--color-error, ${FALLBACKS.error})` }}>
            <X size={12} style={{ verticalAlign: 'middle' }} /> {mistakes}
          </span>
          <span style={{ fontSize: 13, fontFamily: 'monospace', fontWeight: 600, color: `var(--text-primary, ${FALLBACKS.textPrimary})` }}>
            {formatTime(elapsedSeconds)}
          </span>
          <button
            onClick={togglePause}
            style={{
              fontSize: 10, padding: '2px 6px',
              background: isPaused ? `var(--color-success, ${FALLBACKS.success})` : `var(--text-tertiary, ${FALLBACKS.textTertiary})`, color: `var(--widget-on-surface, ${FALLBACKS.onSurface})`,
              border: 'none', borderRadius: 3, cursor: 'pointer',
            }}
          >
            {isPaused ? <Play size={14} /> : <Pause size={14} />}
          </button>
        </div>
      </div>

      {/* Message */}
      {message && (
        <div style={{
          textAlign: 'center', fontSize: 14, fontWeight: 700,
          padding: '4px 0', flexShrink: 0,
          color: message.includes('恭喜') ? `var(--color-success, ${FALLBACKS.success})` : `var(--color-error, ${FALLBACKS.error})`,
          background: message.includes('恭喜') ? `var(--color-success-bg, ${FALLBACKS.successBg})` : `var(--color-error-bg-subtle, ${FALLBACKS.errorBgSubtle})`,
          borderRadius: 4,
        }}>
          {message.includes('恭喜') ? <><PartyPopper size={14} style={{ verticalAlign: 'middle', marginRight: 4 }} />{message}</> : message}
        </div>
      )}

      {/* 9x9 Grid */}
      {isPaused ? (
        <div style={{
          flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: `var(--bg-secondary, ${FALLBACKS.bgSecondary})`, borderRadius: 8,
          fontSize: 16, color: `var(--text-secondary, ${FALLBACKS.textSecondary})`,
        }}>
          已暂停 — 点击 <Play size={14} style={{ verticalAlign: 'middle' }} /> 继续
        </div>
      ) : (
        <div
          ref={gridRef}
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(9, 1fr)',
            gridTemplateRows: 'repeat(9, 1fr)',
            flex: '1 1 auto',
            minHeight: 0,
            border: `2px solid var(--text-primary, ${FALLBACKS.textPrimary})`,
            borderRadius: 4,
            overflow: 'hidden',
          }}
        >
          {userGrid.map((val, i) => {
            const row = Math.floor(i / 9)
            const col = i % 9
            const isPreset = puzzle[i] !== 0
            const isSelected = selectedCell === i
            const isConflict = conflicts.has(i) && !isPreset
            const cellNotes = notes[`${row}-${col}`] ?? []

            // Highlight same row/col/box
            const isSameRow = row === selectedRow
            const isSameCol = col === selectedCol
            const isSameBox = row >= selectedBoxRow && row < selectedBoxRow + 3 &&
                              col >= selectedBoxCol && col < selectedBoxCol + 3
            const isHighlighted = selectedCell !== null && (isSameRow || isSameCol || isSameBox)

            // Highlight same number (sudoku.com style)
            const isSameNumber = selectedNumber !== 0 && val === selectedNumber && val !== 0

            // Border styles for 3x3 boxes
            const borderRight = (col === 2 || col === 5) ? `2px solid var(--text-primary, ${FALLBACKS.textPrimary})` : (col < 8 ? `1px solid var(--border-color, ${FALLBACKS.border})` : 'none')
            const borderBottom = (row === 2 || row === 5) ? `2px solid var(--text-primary, ${FALLBACKS.textPrimary})` : (row < 8 ? `1px solid var(--border-color, ${FALLBACKS.border})` : 'none')

            // Background color logic (priority: selected > same number > highlighted > conflict > default)
            let bg: string
            if (isSelected) {
              bg = FALLBACKS.accent + '4D'
            } else if (isSameNumber) {
              bg = FALLBACKS.accent + '2E'
            } else if (isConflict) {
              bg = `var(--color-error-bg, ${FALLBACKS.errorBg})`
            } else if (isHighlighted) {
              bg = FALLBACKS.accent + '14'
            } else {
              bg = `var(--widget-surface, ${FALLBACKS.surface})`
            }

            // Text color
            let textColor: string
            if (isConflict && !isPreset) {
              textColor = `var(--color-error, ${FALLBACKS.error})`
            } else if (isPreset) {
              textColor = `var(--text-primary, ${FALLBACKS.textPrimary})`
            } else if (isSameNumber) {
              textColor = FALLBACKS.accentLight
            } else {
              textColor = FALLBACKS.accent
            }

            return (
              <div
                key={i}
                onClick={() => handleCellClick(i)}
                data-widget-interactive="true"
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 'clamp(10px, 2.5vw, 18px)',
                  fontWeight: isPreset ? 500 : 700,
                  color: textColor,
                  background: bg,
                  borderRight,
                  borderBottom,
                  cursor: 'pointer',
                  position: 'relative',
                  lineHeight: 1,
                  transition: 'background 0.1s',
                }}
              >
                {val !== 0 ? val : cellNotes.length > 0 ? (
                  <div style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(3, 1fr)',
                    gridTemplateRows: 'repeat(3, 1fr)',
                    width: '100%', height: '100%',
                    fontSize: 'clamp(5px, 1.2vw, 9px)',
                    color: `var(--text-tertiary, ${FALLBACKS.textTertiary})`,
                  }}>
                    {[1,2,3,4,5,6,7,8,9].map(n => (
                      <span key={n} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        {cellNotes.includes(n) ? n : ''}
                      </span>
                    ))}
                  </div>
                ) : null}
              </div>
            )
          })}
        </div>
      )}

      {/* Number bar */}
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(9, 1fr)',
        gap: 3, flexShrink: 0, padding: '2px 0',
      }}>
        {[1,2,3,4,5,6,7,8,9].map(n => {
          const isComplete = numberCounts[n] >= 9
          const isSelected = selectedNumber === n && !noteMode
          return (
            <button
              key={n}
              onClick={() => handleNumberSelect(n)}
              disabled={isComplete}
              style={{
                aspectRatio: '1',
                fontSize: 'clamp(11px, 2.5vw, 16px)',
                fontWeight: 700,
                background: isSelected ? FALLBACKS.accent : `var(--bg-secondary, ${FALLBACKS.bgSecondary})`,
                color: isSelected ? `var(--widget-on-surface, ${FALLBACKS.onSurface})` : isComplete ? `var(--text-tertiary, ${FALLBACKS.textTertiary})` : `var(--text-primary, ${FALLBACKS.textPrimary})`,
                border: '1px solid ' + (isSelected ? FALLBACKS.accent : `var(--border-color, ${FALLBACKS.border})`),
                borderRadius: 4, cursor: isComplete ? 'default' : 'pointer',
                position: 'relative', opacity: isComplete ? 0.4 : 1,
                transition: 'all 0.1s',
              }}
            >
              {n}
              {!isComplete && numberCounts[n] > 0 && (
                <span style={{
                  position: 'absolute', top: 1, right: 2,
                  fontSize: 'clamp(6px, 1vw, 8px)', color: `var(--text-tertiary, ${FALLBACKS.textTertiary})`,
                  fontWeight: 400,
                }}>
                  {numberCounts[n]}
                </span>
              )}
            </button>
          )
        })}
      </div>

      {/* Bottom controls */}
      <div style={{
        display: 'flex', gap: 4, justifyContent: 'center', flexShrink: 0,
        padding: '2px 0',
      }}>
        <button
          onClick={handleUndo}
          disabled={undoStack.length === 0}
          style={{
            padding: '5px 10px', fontSize: 11, fontWeight: 600,
            background: `var(--bg-secondary, ${FALLBACKS.bgSecondary})`,
            color: undoStack.length > 0 ? `var(--text-primary, ${FALLBACKS.textPrimary})` : `var(--text-tertiary, ${FALLBACKS.textTertiary})`,
            border: `1px solid var(--border-color, ${FALLBACKS.border})`,
            borderRadius: 6, cursor: undoStack.length > 0 ? 'pointer' : 'not-allowed',
          }}
        >
          ↩ 撤销
        </button>
        <button
          onClick={handleErase}
          style={{
            padding: '5px 10px', fontSize: 11, fontWeight: 600,
            background: `var(--bg-secondary, ${FALLBACKS.bgSecondary})`,
            color: `var(--text-primary, ${FALLBACKS.textPrimary})`,
            border: `1px solid var(--border-color, ${FALLBACKS.border})`,
            borderRadius: 6, cursor: 'pointer',
          }}
        >
          <X size={12} style={{ verticalAlign: 'middle', marginRight: 2 }} /> 擦除
        </button>
        <button
          onClick={toggleNoteMode}
          style={{
            padding: '5px 10px', fontSize: 11, fontWeight: 600,
            background: noteMode ? FALLBACKS.widgetSecondary : `var(--bg-secondary, ${FALLBACKS.bgSecondary})`,
            color: noteMode ? `var(--widget-on-surface, ${FALLBACKS.onSurface})` : `var(--text-primary, ${FALLBACKS.textPrimary})`,
            border: '1px solid ' + (noteMode ? FALLBACKS.widgetSecondary : `var(--border-color, ${FALLBACKS.border})`),
            borderRadius: 6, cursor: 'pointer',
          }}
        >
          {noteMode ? <><Pencil size={12} style={{ verticalAlign: 'middle', marginRight: 2 }} /> 笔记ON</> : <><Pencil size={12} style={{ verticalAlign: 'middle', marginRight: 2 }} /> 笔记</>}
        </button>
        <button
          onClick={handleHint}
          style={{
            padding: '5px 10px', fontSize: 11, fontWeight: 600,
            background: `var(--bg-secondary, ${FALLBACKS.bgSecondary})`,
            color: `var(--color-warning, ${FALLBACKS.warning})`,
            border: `1px solid var(--border-color, ${FALLBACKS.border})`,
            borderRadius: 6, cursor: 'pointer',
          }}
        >
          <Lightbulb size={12} style={{ verticalAlign: 'middle', marginRight: 2 }} /> 提示
        </button>
      </div>
    </div>
  )
}
