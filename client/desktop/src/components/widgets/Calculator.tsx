import { useState, useEffect, useRef, useCallback } from 'react'
import { v4 as uuidv4 } from 'uuid'
import { widgetDefinitionMap } from '../../registry/widgetDefinitions'
import { evaluate, formatResult } from './calculatorParser'

interface Props {
  widgetId: string
  panelId: string
  state: Record<string, unknown>
  onUpdateState: (partial: Record<string, unknown>) => void
  onEditingChange?: (editing: boolean) => void
}

const QUICK_BUTTONS: Array<{ label: string; insert: string }> = [
  { label: 'sin', insert: 'sin(' },
  { label: 'cos', insert: 'cos(' },
  { label: 'tan', insert: 'tan(' },
  { label: '√', insert: 'sqrt(' },
  { label: 'log', insert: 'log(' },
  { label: 'ln', insert: 'ln(' },
  { label: '|x|', insert: 'abs(' },
  { label: 'xʸ', insert: '^' },
  { label: 'π', insert: 'pi' },
  { label: 'e', insert: 'e' },
  { label: '(', insert: '(' },
  { label: ')', insert: ')' },
  { label: '×', insert: '*' },
  { label: '÷', insert: '/' },
  { label: '+', insert: '+' },
  { label: '−', insert: '-' },
  { label: '.', insert: '.' },
  { label: '⌫', insert: 'BACK' },
  { label: 'AC', insert: 'AC' },
  { label: '=', insert: '=' },
]

export default function Calculator({ state, onUpdateState, onEditingChange }: Props) {
  const def = widgetDefinitionMap.get('calculator')!
  const validation = def.validateState(state)
  const s = (validation.ok ? validation.state : def.createDefaultState()) as Record<string, unknown>
  const history = (s.history ?? []) as Array<{ id: string; expression: string; result: string; timestamp: number }>

  const [expression, setExpression] = useState('')
  const [resultText, setResultText] = useState('')
  const [errorText, setErrorText] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const flushTimerRef = useRef<number | null>(null)
  const pendingFlushRef = useRef<Array<{ id: string; expression: string; result: string; timestamp: number }>>([])

  const flush = useCallback(() => {
    if (pendingFlushRef.current.length === 0) return
    const newHistory = [...pendingFlushRef.current, ...history].slice(0, 50)
    pendingFlushRef.current = []
    onUpdateState({ history: newHistory })
  }, [history, onUpdateState])

  useEffect(() => {
    onEditingChange?.(false)
  }, [onEditingChange])

  // beforeunload + unmount flush
  useEffect(() => {
    const onBeforeUnload = () => flush()
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload)
      flush()
    }
  }, [flush])

  const performCalculation = useCallback(() => {
    const trimmed = expression.trim()
    if (trimmed === '') {
      setErrorText('')
      setResultText('')
      return
    }
    const res = evaluate(trimmed)
    if (res.ok) {
      const formatted = formatResult(res.value)
      setResultText(formatted)
      setErrorText('')
      // Append to pending history
      const entry = {
        id: uuidv4(),
        expression: trimmed,
        result: formatted,
        timestamp: Date.now(),
      }
      pendingFlushRef.current = [entry]
      if (flushTimerRef.current !== null) {
        window.clearTimeout(flushTimerRef.current)
      }
      flushTimerRef.current = window.setTimeout(() => {
        flush()
        flushTimerRef.current = null
      }, 400)
    } else {
      setResultText('')
      setErrorText(res.error)
    }
  }, [expression, flush])

  const handleButton = (insert: string) => {
    setErrorText('')
    if (insert === 'AC') {
      setExpression('')
      setResultText('')
      setErrorText('')
      inputRef.current?.focus()
      return
    }
    if (insert === 'BACK') {
      setExpression(e => e.slice(0, -1))
      return
    }
    if (insert === '=') {
      performCalculation()
      return
    }
    setExpression(e => e + insert)
    inputRef.current?.focus()
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      performCalculation()
    }
  }

  const onHistoryClick = (expr: string) => {
    setExpression(expr)
    setErrorText('')
    setResultText('')
    inputRef.current?.focus()
  }

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', padding: 8, gap: 6, overflow: 'hidden' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <input
          ref={inputRef}
          type="text"
          value={expression}
          onChange={e => setExpression(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="输入表达式，如 2+3*sin(pi/4)"
          style={{ padding: '6px 8px', fontSize: 14, fontFamily: 'monospace', border: '1px solid #d1d5db', borderRadius: 4, outline: 'none' }}
        />
        <div
          style={{
            minHeight: 32,
            padding: '4px 8px',
            fontSize: 22,
            fontFamily: 'monospace',
            textAlign: 'right',
            background: '#f9fafb',
            borderRadius: 4,
            color: errorText ? '#dc2626' : '#111827',
            fontWeight: 600,
          }}
        >
          {errorText || resultText || '\u00A0'}
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 4 }}>
        {QUICK_BUTTONS.map(b => (
          <button
            key={b.label}
            onClick={() => handleButton(b.insert)}
            style={{
              padding: '8px 0',
              fontSize: 13,
              background: b.insert === '=' ? '#3b82f6' : b.insert === 'AC' ? '#fee2e2' : '#fff',
              color: b.insert === '=' ? '#fff' : b.insert === 'AC' ? '#dc2626' : '#374151',
              border: '1px solid #d1d5db',
              borderRadius: 4,
              cursor: 'pointer',
            }}
          >
            {b.label}
          </button>
        ))}
      </div>
      {history.length > 0 && (
        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', gap: 2, overflow: 'auto', marginTop: 4 }}>
          <div style={{ fontSize: 11, color: '#6b7280', padding: '0 4px' }}>历史（点击复用）</div>
          {history.slice(0, 20).map((h: { id: string; expression: string; result: string; timestamp: number }) => (
            <div
              key={h.id}
              data-widget-interactive="true"
              onClick={() => onHistoryClick(h.expression)}
              style={{
                padding: '4px 6px',
                fontSize: 12,
                fontFamily: 'monospace',
                background: '#f9fafb',
                borderRadius: 3,
                cursor: 'pointer',
                display: 'flex',
                justifyContent: 'space-between',
                gap: 8,
              }}
            >
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{h.expression}</span>
              <span style={{ color: '#059669', fontWeight: 600 }}>= {h.result}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
