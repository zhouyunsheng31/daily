import { useState, useEffect, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { v4 as uuidv4 } from 'uuid'
import { Play, Pause, X, Coffee, Timer, Hourglass, Cherry, Tag, CircleDot } from 'lucide-react'
import { saveFocusSession, getTasksByPanel, linkFocusSessionToTask } from '../../utils/db'
import { useAppStore } from '../../stores/useAppStore'
import type { Task, FocusSession } from '../../types'

interface Props {
  widgetId: string
  panelId: string
  state: Record<string, unknown>
  onUpdateState: (partial: Record<string, unknown>) => void
  onEditingChange?: (editing: boolean) => void
}

type FocusMode = 'pomodoro' | 'countup' | 'countdown'
type FocusStatus = 'idle' | 'running' | 'paused'
type PomodoroPhase = 'focus' | 'break'

interface RuntimeState {
  startedAt?: number
  pausedAt?: number
  accumulatedPausedMs: number
  mode: FocusMode
  targetMs?: number
  status: FocusStatus
  pomodoroPhase?: PomodoroPhase
  label?: string
}

const POMODORO_FOCUS_MS = 25 * 60 * 1000
const POMODORO_BREAK_MS = 5 * 60 * 1000
const MIN_RECORD_MS = 60 * 1000

function formatTimerDisplay(ms: number): string {
  const totalSec = Math.max(0, Math.ceil(ms / 1000))
  const h = Math.floor(totalSec / 3600)
  const m = Math.floor((totalSec % 3600) / 60)
  const s = totalSec % 60
  if (h > 0) return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

function getElapsedMs(rt: RuntimeState, now: number): number {
  if (!rt.startedAt) return 0
  if (rt.status === 'running') {
    return now - rt.startedAt - rt.accumulatedPausedMs
  }
  if (rt.status === 'paused' && rt.pausedAt) {
    return rt.pausedAt - rt.startedAt - rt.accumulatedPausedMs
  }
  return 0
}

function formatDuration(ms: number): string {
  const totalMin = Math.round(ms / 60000)
  if (totalMin < 60) return `${totalMin}分钟`
  const h = Math.floor(totalMin / 60)
  const m = totalMin % 60
  return m > 0 ? `${h}小时${m}分钟` : `${h}小时`
}

const PRIORITY_COLORS: Record<string, string> = { high: '#ef4444', medium: '#eab308', low: '#22c55e' }

function TaskPickerModal({
  panelId,
  sessionId,
  durationMs,
  label,
  onClose,
  containerRef,
}: {
  panelId: string
  sessionId: string
  durationMs: number
  label?: string
  onClose: () => void
  containerRef: React.RefObject<HTMLDivElement | null>
}) {
  const [tasks, setTasks] = useState<Task[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [linking, setLinking] = useState(false)
  const modalRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let cancelled = false
    getTasksByPanel(panelId).then(t => {
      if (!cancelled) {
        setTasks(t.filter(task => task.status !== 'done'))
        setLoading(false)
      }
    }).catch(() => {
      if (!cancelled) {
        setError('加载失败')
        setLoading(false)
      }
    })
    return () => { cancelled = true }
  }, [panelId])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose])

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (modalRef.current && !modalRef.current.contains(e.target as Node)) onClose()
    }
    const timer = setTimeout(() => document.addEventListener('mousedown', handler), 0)
    return () => { clearTimeout(timer); document.removeEventListener('mousedown', handler) }
  }, [onClose])

  const handleSelectTask = async (task: Task) => {
    setLinking(true)
    try {
      await linkFocusSessionToTask({ panelId, sessionId, taskId: task.id })
      onClose()
    } catch {
      setError('关联失败')
      setLinking(false)
    }
  }

  const [rect, setRect] = useState<DOMRect | null>(null)
  useEffect(() => {
    setRect(containerRef.current?.getBoundingClientRect() ?? null)
  }, [containerRef])
  const style: React.CSSProperties = {
    position: 'fixed',
    zIndex: 10001,
    background: 'var(--bg-surface)',
    border: '1px solid var(--border-primary)',
    borderRadius: 8,
    padding: 12,
    minWidth: 200,
    maxWidth: 280,
    maxHeight: 300,
    overflowY: 'auto',
    boxShadow: 'var(--shadow-lg)',
  }
  if (rect) {
    style.left = rect.left + rect.width / 2 - 120
    style.top = Math.max(8, rect.top + 20)
  } else {
    style.left = '50%'
    style.top = '20%'
  }

  return createPortal(
    <div ref={modalRef} style={style}>
      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>专注完成！</div>
      <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginBottom: 8 }}>
        专注了 {formatDuration(durationMs)}
        {label && <span> · <Tag size={10} style={{ verticalAlign: 'middle' }} /> {label}</span>}
      </div>
      <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginBottom: 6 }}>记录到哪个任务？</div>
      {loading ? (
        <div style={{ fontSize: 11, color: 'var(--text-tertiary)', padding: '8px 0' }}>加载任务...</div>
      ) : error && tasks.length === 0 ? (
        <div style={{ fontSize: 11, color: 'var(--color-error)', padding: '8px 0' }}>
          {error}
          <button className="panel-btn" style={{ fontSize: 10, marginLeft: 8 }} onClick={() => window.location.reload()}>重试</button>
        </div>
      ) : tasks.length === 0 ? (
        <div style={{ fontSize: 11, color: 'var(--text-tertiary)', padding: '8px 0' }}>暂无任务</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {tasks.map(task => (
            <button
              key={task.id}
              style={{
                background: 'none',
                border: '1px solid var(--border-primary)',
                borderRadius: 4,
                padding: '4px 8px',
                cursor: linking ? 'wait' : 'pointer',
                textAlign: 'left',
                fontSize: 12,
                color: 'var(--text-primary)',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
              }}
              onClick={() => handleSelectTask(task)}
              disabled={linking}
            >
              <span style={{ color: PRIORITY_COLORS[task.priority], fontSize: 8 }}><CircleDot size={8} /></span>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{task.title}</span>
            </button>
          ))}
        </div>
      )}
      {error && tasks.length > 0 && (
        <div style={{ fontSize: 10, color: 'var(--color-error)', marginTop: 4 }}>{error}</div>
      )}
      <button
        style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 11, color: 'var(--text-tertiary)', marginTop: 8, padding: 0 }}
        onClick={onClose}
      >跳过</button>
    </div>,
    document.body,
  )
}

export default function FocusTimer({ widgetId, panelId, state, onUpdateState, onEditingChange }: Props) {
  const rt: RuntimeState = {
    startedAt: (state.startedAt as number) || undefined,
    pausedAt: (state.pausedAt as number) || undefined,
    accumulatedPausedMs: (state.accumulatedPausedMs as number) || 0,
    mode: (state.mode as FocusMode) || 'pomodoro',
    targetMs: (state.targetMs as number) || undefined,
    status: (state.status as FocusStatus) || 'idle',
    pomodoroPhase: (state.pomodoroPhase as PomodoroPhase) || 'focus',
    label: (state.label as string) || undefined,
  }

  const [now, setNow] = useState(() => Date.now())
  const [countdownInput, setCountdownInput] = useState('')
  const [labelInput, setLabelInput] = useState(rt.label || '')
  const [showLabelInput, setShowLabelInput] = useState(false)
  const [showTaskPicker, setShowTaskPicker] = useState(false)
  const [lastSessionId, setLastSessionId] = useState<string | null>(null)
  const [lastSessionDuration, setLastSessionDuration] = useState(0)
  const finishedRef = useRef(false)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (rt.status !== 'running') return
    const interval = setInterval(() => setNow(Date.now()), 200)
    return () => clearInterval(interval)
  }, [rt.status])

  useEffect(() => {
    const handler = () => {
      if (document.visibilityState === 'visible') {
        setNow(Date.now())
      }
    }
    document.addEventListener('visibilitychange', handler)
    return () => document.removeEventListener('visibilitychange', handler)
  }, [])

  const updateRuntime = useCallback((partial: Partial<RuntimeState>) => {
    onUpdateState(partial as Record<string, unknown>)
  }, [onUpdateState])

  const recordSession = useCallback(async (endedAt: number, durationMs: number, mode: FocusMode) => {
    if (!panelId || !rt.startedAt) return
    if (durationMs < MIN_RECORD_MS) return
    if (rt.pomodoroPhase === 'break') return

    const session: FocusSession = {
      id: uuidv4(),
      panelId,
      focusTimerWidgetId: widgetId,
      label: rt.label || undefined,
      startedAt: rt.startedAt,
      endedAt,
      durationMs,
      mode,
      createdAt: Date.now(),
      schemaVersion: 2,
    }
    try {
      await saveFocusSession(session)
      useAppStore.getState().incrementFocusSessionsRevision()
      setLastSessionId(session.id)
      setLastSessionDuration(durationMs)
      setShowTaskPicker(true)
    } catch {
      console.error('[FocusTimer] failed to save session')
    }
  }, [panelId, widgetId, rt.startedAt, rt.label, rt.pomodoroPhase])

  const handleStart = useCallback((mode: FocusMode, targetMs?: number) => {
    finishedRef.current = false
    updateRuntime({
      mode,
      status: 'running',
      startedAt: Date.now(),
      pausedAt: undefined,
      accumulatedPausedMs: 0,
      targetMs,
      pomodoroPhase: 'focus',
    })
  }, [updateRuntime])

  const handlePause = useCallback(() => {
    updateRuntime({ status: 'paused', pausedAt: Date.now() })
  }, [updateRuntime])

  const handleResume = useCallback(() => {
    const pausedDuration = rt.pausedAt ? Date.now() - rt.pausedAt : 0
    updateRuntime({
      status: 'running',
      pausedAt: undefined,
      accumulatedPausedMs: rt.accumulatedPausedMs + pausedDuration,
    })
  }, [updateRuntime, rt.pausedAt, rt.accumulatedPausedMs])

  const handleStop = useCallback(async () => {
    const endedAt = Date.now()
    const durationMs = getElapsedMs(rt, endedAt)
    await recordSession(endedAt, durationMs, rt.mode)
    finishedRef.current = false
    updateRuntime({
      status: 'idle',
      startedAt: undefined,
      pausedAt: undefined,
      accumulatedPausedMs: 0,
      targetMs: undefined,
      pomodoroPhase: 'focus',
    })
  }, [rt, updateRuntime, recordSession])

  useEffect(() => {
    if (rt.status !== 'running') return
    if (finishedRef.current) return

    const elapsed = getElapsedMs(rt, now)

    if (rt.mode === 'pomodoro' && rt.pomodoroPhase === 'focus' && elapsed >= POMODORO_FOCUS_MS) {
      finishedRef.current = true
      const endedAt = rt.startedAt! + POMODORO_FOCUS_MS + rt.accumulatedPausedMs
      queueMicrotask(() => {
        recordSession(endedAt, POMODORO_FOCUS_MS, 'pomodoro').then(() => {
          updateRuntime({
            pomodoroPhase: 'break',
            startedAt: Date.now(),
            accumulatedPausedMs: 0,
            pausedAt: undefined,
          })
          finishedRef.current = false
        })
      })
      return
    }

    if (rt.mode === 'pomodoro' && rt.pomodoroPhase === 'break' && elapsed >= POMODORO_BREAK_MS) {
      finishedRef.current = true
      updateRuntime({
        status: 'idle',
        startedAt: undefined,
        pausedAt: undefined,
        accumulatedPausedMs: 0,
        pomodoroPhase: 'focus',
        targetMs: undefined,
      })
      finishedRef.current = false
      return
    }

    if (rt.mode === 'countdown' && rt.targetMs && elapsed >= rt.targetMs) {
      finishedRef.current = true
      const endedAt = rt.startedAt! + rt.targetMs + rt.accumulatedPausedMs
      const targetMs = rt.targetMs
      queueMicrotask(() => {
        recordSession(endedAt, targetMs, 'countdown').then(() => {
          updateRuntime({
            status: 'idle',
            startedAt: undefined,
            pausedAt: undefined,
            accumulatedPausedMs: 0,
            targetMs: undefined,
          })
          finishedRef.current = false
        })
      })
    }
  }, [now, rt, updateRuntime, recordSession])

  const elapsed = getElapsedMs(rt, now)

  let displayMs: number
  if (rt.status === 'idle') {
    displayMs = 0
  } else if (rt.mode === 'pomodoro') {
    if (rt.pomodoroPhase === 'focus') {
      displayMs = Math.max(0, POMODORO_FOCUS_MS - elapsed)
    } else {
      displayMs = Math.max(0, POMODORO_BREAK_MS - elapsed)
    }
  } else if (rt.mode === 'countdown' && rt.targetMs) {
    displayMs = Math.max(0, rt.targetMs - elapsed)
  } else {
    displayMs = elapsed
  }

  const progress = rt.mode === 'pomodoro'
    ? rt.pomodoroPhase === 'focus'
      ? Math.min(1, elapsed / POMODORO_FOCUS_MS)
      : Math.min(1, elapsed / POMODORO_BREAK_MS)
    : rt.mode === 'countdown' && rt.targetMs
      ? Math.min(1, elapsed / rt.targetMs)
      : 0

  const isBreak = rt.mode === 'pomodoro' && rt.pomodoroPhase === 'break'

  return (
    <div ref={containerRef} style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 16, gap: 8 }}>
      {rt.status === 'idle' ? (
        <>
          <div style={{ display: 'flex', gap: 4, marginBottom: 12 }}>
            {(['pomodoro', 'countup', 'countdown'] as FocusMode[]).map(m => (
              <button
                key={m}
                className={`clock-tab ${rt.mode === m ? 'active' : ''}`}
                onClick={() => updateRuntime({ mode: m })}
                style={{ fontSize: 11, padding: '4px 10px' }}
              >
                {m === 'pomodoro' ? '番茄钟' : m === 'countup' ? '正计时' : '倒计时'}
              </button>
            ))}
          </div>

          {rt.mode === 'countdown' && (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
              <input
                className="panel-input"
                type="number"
                placeholder="分钟"
                value={countdownInput}
                onChange={e => setCountdownInput(e.target.value)}
                onFocus={() => onEditingChange?.(true)}
                onBlur={() => onEditingChange?.(false)}
                style={{ width: 80 }}
                min={1}
              />
            </div>
          )}

          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <button
              className="music-control-btn play-btn"
              onClick={() => {
                let targetMs: number | undefined
                if (rt.mode === 'countdown') {
                  const mins = parseInt(countdownInput, 10)
                  if (!mins || mins <= 0) return
                  targetMs = mins * 60 * 1000
                }
                handleStart(rt.mode, targetMs)
              }}
              style={{ width: 56, height: 56, fontSize: 20 }}
            >
              <Play size={14} />
            </button>
          </div>

          <button
            onClick={() => setShowLabelInput(!showLabelInput)}
            style={{ background: 'none', border: 'none', color: 'var(--text-tertiary)', fontSize: 11, cursor: 'pointer', marginTop: 4 }}
          >
            {rt.label ? <><Tag size={10} style={{ verticalAlign: 'middle', marginRight: 4 }} />{rt.label}</> : '+ 标签'}
          </button>
          {showLabelInput && (
            <input
              className="panel-input"
              type="text"
              placeholder="自由标签（可选）"
              value={labelInput}
              onChange={e => setLabelInput(e.target.value)}
              onBlur={() => {
                updateRuntime({ label: labelInput || undefined })
                setShowLabelInput(false)
                onEditingChange?.(false)
              }}
              onKeyDown={e => {
                if (e.key === 'Enter') {
                  updateRuntime({ label: labelInput || undefined })
                  setShowLabelInput(false)
                  onEditingChange?.(false)
                }
              }}
              onFocus={() => onEditingChange?.(true)}
              style={{ width: 140, marginTop: 4 }}
              autoFocus
            />
          )}
        </>
      ) : (
        <>
          <div style={{ fontSize: 11, color: isBreak ? 'var(--color-secondary)' : 'var(--color-primary)', fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase' }}>
            {isBreak ? <><Coffee size={14} style={{ verticalAlign: 'middle', marginRight: 4 }} /> 休息中</> : rt.mode === 'pomodoro' ? <><Cherry size={14} style={{ verticalAlign: 'middle', marginRight: 4 }} /> 专注中</> : rt.mode === 'countup' ? <><Timer size={14} style={{ verticalAlign: 'middle', marginRight: 4 }} /> 正计时</> : <><Hourglass size={14} style={{ verticalAlign: 'middle', marginRight: 4 }} /> 倒计时</>}
          </div>

          <div style={{ fontSize: 42, fontWeight: 200, color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums', lineHeight: 1, marginTop: 4 }}>
            {formatTimerDisplay(displayMs)}
          </div>

          {rt.label && (
            <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 2 }}><Tag size={10} style={{ verticalAlign: 'middle', marginRight: 4 }} />{rt.label}</div>
          )}

          <div style={{ width: '80%', height: 3, borderRadius: 2, background: 'var(--bg-canvas)', marginTop: 8, overflow: 'hidden' }}>
            <div style={{
              height: '100%', borderRadius: 2,
              background: isBreak ? 'var(--color-secondary)' : 'var(--color-primary)',
              width: `${progress * 100}%`,
              transition: 'width 0.3s linear',
            }} />
          </div>

          <div style={{ display: 'flex', gap: 12, marginTop: 12, alignItems: 'center' }}>
            {rt.status === 'running' ? (
              <button className="music-control-btn" onClick={handlePause} style={{ width: 40, height: 40, fontSize: 14 }}><Pause size={14} /></button>
            ) : (
              <button className="music-control-btn play-btn" onClick={handleResume} style={{ width: 40, height: 40, fontSize: 14 }}><Play size={14} /></button>
            )}
            <button className="music-control-btn" onClick={handleStop} style={{ width: 40, height: 40, fontSize: 14, color: 'var(--color-error)' }}><X size={14} /></button>
          </div>
        </>
      )}

      {showTaskPicker && lastSessionId && (
        <TaskPickerModal
          panelId={panelId}
          sessionId={lastSessionId}
          durationMs={lastSessionDuration}
          label={rt.label}
          onClose={() => { setShowTaskPicker(false); setLastSessionId(null) }}
          containerRef={containerRef}
        />
      )}
    </div>
  )
}
