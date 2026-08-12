import { useState, useEffect } from 'react'
import katex from 'katex'
import 'katex/dist/katex.min.css'
import { v4 as uuidv4 } from 'uuid'
import { widgetDefinitionMap } from '../../registry/widgetDefinitions'
import { saveQuizSession, getQuizSessionById, updateQuizSession } from '../../utils/dbStores'
import { saveMistake, findMistakeBySourceAndQuestion } from '../../utils/dbStores/mistakes'
import { sm2InitialState } from '../../utils/sm2'
import { BarChart3, Hourglass, CircleCheck, CircleX, Triangle } from 'lucide-react'
import { getQuestionsByCategory, getQuestionById } from './latexQuizData'
import type { QuizCategory, QuizQuestion, QuizSession, Mistake } from '../../types'

interface Props {
  widgetId: string
  panelId: string
  state: Record<string, unknown>
  onUpdateState: (partial: Record<string, unknown>) => void
  onEditingChange?: (editing: boolean) => void
}

const CATEGORY_LABELS: Record<QuizCategory, string> = {
  algebra: '代数',
  geometry: '几何',
  calculus: '微积分',
  trig: '三角函数',
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function renderLatex(latex: string, displayMode: boolean): string {
  try {
    return katex.renderToString(latex, {
      displayMode,
      throwOnError: false,
      output: 'html',
    })
  } catch {
    return escapeHtml(latex)
  }
}

function renderPrompt(prompt: string): string {
  // Escape HTML first
  let html = escapeHtml(prompt)

  // Replace $$...$$ (block math) - non-greedy, no nested $
  html = html.replace(/\$\$([^$]+?)\$\$/g, (_, expr) => renderLatex(expr, true))

  // Replace $...$ (inline math) - non-greedy, no newlines
  html = html.replace(/\$([^$\n]+?)\$/g, (_, expr) => renderLatex(expr, false))

  // Simple Markdown: bold, italic, inline code
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>')
  html = html.replace(/`([^`]+)`/g, '<code style="background:#f3f4f6;padding:1px 4px;border-radius:3px;font-size:0.9em">$1</code>')

  // Newlines to <br>
  html = html.replace(/\n/g, '<br>')

  return html
}

// Helpers outside component to avoid React Compiler purity warnings for Date.now()
function buildNewSession(panelId: string, widgetId: string, category: QuizCategory, questions: QuizQuestion[]): QuizSession {
  return {
    id: uuidv4(),
    panelId,
    latexQuizWidgetId: widgetId,
    category,
    questionIds: questions.map(q => q.id),
    userAnswers: {},
    gradeResults: {},
    correctCount: 0,
    totalCount: questions.length,
    startedAt: Date.now(),
    finishedAt: 0,
    schemaVersion: 1,
  }
}

function buildSessionUpdate(userAnswers: Record<string, string>, grades: Record<string, boolean>, correctCount: number, totalCount: number) {
  return {
    userAnswers,
    gradeResults: grades,
    correctCount,
    totalCount,
    finishedAt: Date.now(),
  }
}

// Collect mistakes outside component to avoid React Compiler purity warnings for Date.now()
async function collectMistakes(questions: QuizQuestion[], userAnswers: Record<string, string>, grades: Record<string, boolean>, widgetId: string, panelId: string): Promise<void> {
  const now = Date.now()
  for (const q of questions) {
    const isCorrect = grades[q.id]
    if (isCorrect) continue
    const userAnswer = userAnswers[q.id] ?? ''
    try {
      const existing = await findMistakeBySourceAndQuestion(widgetId, q.id)
      if (existing) {
        await saveMistake({
          ...existing,
          userAnswer,
          errorCount: existing.errorCount + 1,
          repetition: 0,
          interval: 1,
          status: 'learning',
          nextReviewAt: now + 1 * 86400000,
          updatedAt: now,
        } satisfies Mistake)
      } else {
        const initial = sm2InitialState()
        const mistake: Mistake = {
          id: uuidv4(),
          panelId,
          sourceType: 'latexQuiz',
          sourceId: widgetId,
          questionId: q.id,
          questionContent: q.prompt,
          correctAnswer: q.answer,
          userAnswer,
          explanation: q.explanation ?? '',
          errorCount: 1,
          easeFactor: initial.easeFactor,
          interval: initial.interval,
          repetition: initial.repetition,
          nextReviewAt: initial.nextReviewAt || now,
          lastReviewAt: initial.lastReviewAt,
          status: initial.status,
          createdAt: now,
          updatedAt: now,
          schemaVersion: 1,
        }
        await saveMistake(mistake)
      }
    } catch (mistakeErr) {
      console.warn('[LatexQuiz] Failed to save mistake for question', q.id, mistakeErr)
    }
  }
}

export default function LatexQuiz({ widgetId, panelId, state, onUpdateState, onEditingChange }: Props) {
  const def = widgetDefinitionMap.get('latexQuiz')!
  const validation = def.validateState(state)
  const s = (validation.ok ? validation.state : def.createDefaultState()) as Record<string, unknown>

  const currentSessionId = s.currentSessionId as string | null
  const displayMode = s.displayMode as string
  const selectedCategory = s.selectedCategory as QuizCategory
  const userAnswers = s.userAnswers as Record<string, string>
  const gradeResults = s.gradeResults as Record<string, boolean>

  const [currentQuestionIdx, setCurrentQuestionIdx] = useState(0)
  const [answerDraft, setAnswerDraft] = useState('')
  const [_resumingSession, _setResumingSession] = useState(false)
  const [resolvingError, setResolvingError] = useState<string | null>(null)

  const questions = getQuestionsByCategory(selectedCategory)
  const currentQuestion: QuizQuestion | undefined = questions[currentQuestionIdx]
  const isEditing = displayMode !== 'menu'

  useEffect(() => {
    onEditingChange?.(isEditing)
  }, [isEditing, onEditingChange])

  useEffect(() => {
    if (currentQuestion && userAnswers[currentQuestion.id] !== undefined) {
      queueMicrotask(() => setAnswerDraft(userAnswers[currentQuestion.id]))
    } else {
      queueMicrotask(() => setAnswerDraft(''))
    }
  }, [currentQuestion, userAnswers])

  const startSession = async (resume: boolean) => {
    setResolvingError(null)
    if (resume && currentSessionId) {
      // Try to resume existing session
      try {
        const existing = await getQuizSessionById(currentSessionId)
        if (existing) {
          // Restore state from existing
          const resolvedQuestions = questions
          let firstUnanswered = 0
          for (let i = 0; i < resolvedQuestions.length; i++) {
            if (userAnswers[resolvedQuestions[i].id] === undefined) {
              firstUnanswered = i
              break
            }
            firstUnanswered = i + 1
          }
          setCurrentQuestionIdx(Math.min(firstUnanswered, resolvedQuestions.length - 1))
          onUpdateState({ displayMode: 'quiz' })
          return
        }
      } catch (err) {
        console.warn('failed to resume session', err)
      }
    }
    // Create new session
    try {
      const session = buildNewSession(panelId, widgetId, selectedCategory, questions)
      await saveQuizSession(session)
      onUpdateState({
        currentSessionId: session.id,
        userAnswers: {},
        gradeResults: {},
        displayMode: 'quiz',
      })
      setCurrentQuestionIdx(0)
    } catch (err) {
      console.warn('failed to start session', err)
      setResolvingError(err instanceof Error ? err.message : '开始会话失败')
    }
  }

  const submitAnswer = async () => {
    if (!currentQuestion) return
    const newAnswers = { ...userAnswers, [currentQuestion.id]: answerDraft }
    onUpdateState({ userAnswers: newAnswers })
    if (currentQuestionIdx < questions.length - 1) {
      setCurrentQuestionIdx(currentQuestionIdx + 1)
    }
  }

  const finishSession = async () => {
    if (!currentSessionId) return
    const grades: Record<string, boolean> = {}
    let correctCount = 0
    for (const q of questions) {
      const userAnswer = userAnswers[q.id] ?? ''
      const isCorrect = gradeAnswer(q, userAnswer)
      grades[q.id] = isCorrect
      if (isCorrect) correctCount++
    }
    onUpdateState({ gradeResults: grades, displayMode: 'result' })
    try {
      await updateQuizSession(currentSessionId, buildSessionUpdate(userAnswers, grades, correctCount, questions.length))
    } catch (err) {
      console.warn('failed to update session', err)
    }

    // Collect mistakes — isolated with try-catch to not affect quiz session completion
    try {
      await collectMistakes(questions, userAnswers, grades, widgetId, panelId)
    } catch (collectionErr) {
      console.warn('[LatexQuiz] Mistake collection failed:', collectionErr)
    }
  }

  const reset = () => {
    onUpdateState({
      currentSessionId: null,
      displayMode: 'menu',
      userAnswers: {},
      gradeResults: {},
    })
    setCurrentQuestionIdx(0)
    setAnswerDraft('')
  }

  // ============ Render ============

  if (displayMode === 'menu') {
    const hasOngoing = currentSessionId && Object.keys(userAnswers).length > 0 && Object.keys(gradeResults).length === 0
    return (
      <div style={{ height: '100%', display: 'flex', flexDirection: 'column', padding: 12, gap: 12, overflow: 'auto' }}>
        <h3 style={{ fontSize: 16, fontWeight: 600, margin: 0 }}><Triangle size={14} style={{ verticalAlign: 'middle', marginRight: 4 }} /> LaTeX 出题器</h3>
        {hasOngoing && (
          <div style={{ padding: 10, background: '#fef3c7', borderRadius: 6, fontSize: 13 }}>
            有未完成的 {CATEGORY_LABELS[selectedCategory]} 会话（{Object.keys(userAnswers).length}/{questions.length}）
            <div style={{ marginTop: 6, display: 'flex', gap: 8 }}>
              <button
                onClick={() => startSession(true)}
                style={{ padding: '4px 10px', fontSize: 12, background: '#3b82f6', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer' }}
              >
                继续
              </button>
              <button
                onClick={reset}
                style={{ padding: '4px 10px', fontSize: 12, background: '#fff', color: '#374151', border: '1px solid #d1d5db', borderRadius: 4, cursor: 'pointer' }}
              >
                重新开始
              </button>
            </div>
          </div>
        )}
        <div style={{ fontSize: 13, color: '#6b7280' }}>选择分类：</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          {(Object.keys(CATEGORY_LABELS) as QuizCategory[]).map(cat => (
            <button
              key={cat}
              onClick={() => onUpdateState({ selectedCategory: cat })}
              style={{
                padding: 10,
                fontSize: 14,
                background: selectedCategory === cat ? '#3b82f6' : '#fff',
                color: selectedCategory === cat ? '#fff' : '#374151',
                border: '1px solid ' + (selectedCategory === cat ? '#3b82f6' : '#d1d5db'),
                borderRadius: 6,
                cursor: 'pointer',
              }}
            >
              {CATEGORY_LABELS[cat]}
            </button>
          ))}
        </div>
        <button
          onClick={() => startSession(false)}
          style={{ padding: '8px 16px', fontSize: 14, background: '#10b981', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', marginTop: 'auto' }}
        >
          开始答题（{questions.length} 题）
        </button>
        {resolvingError && <div style={{ fontSize: 12, color: '#dc2626' }}>{resolvingError}</div>}
      </div>
    )
  }

  if (displayMode === 'quiz') {
    if (!currentQuestion) {
      return <div style={{ padding: 12 }}>题库加载失败</div>
    }
    return (
      <div style={{ height: '100%', display: 'flex', flexDirection: 'column', padding: 12, gap: 10, overflow: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: '#6b7280' }}>
          <span>{CATEGORY_LABELS[selectedCategory]}</span>
          <span>第 {currentQuestionIdx + 1} / {questions.length} 题</span>
        </div>
        <div
          style={{ padding: 12, background: '#f9fafb', borderRadius: 6, fontSize: 14, lineHeight: 1.6 }}
          dangerouslySetInnerHTML={{ __html: renderPrompt(currentQuestion.prompt) }}
        />
        <input
          type="text"
          value={answerDraft}
          onChange={e => setAnswerDraft(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') submitAnswer() }}
          placeholder="输入答案后按 Enter"
          autoFocus
          style={{ padding: 8, fontSize: 14, border: '1px solid #d1d5db', borderRadius: 4, outline: 'none' }}
        />
        <div style={{ display: 'flex', gap: 8, marginTop: 'auto' }}>
          {currentQuestionIdx < questions.length - 1 ? (
            <button
              onClick={submitAnswer}
              style={{ flex: 1, padding: '8px 16px', fontSize: 14, background: '#3b82f6', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer' }}
            >
              下一题
            </button>
          ) : (
            <button
              onClick={finishSession}
              style={{ flex: 1, padding: '8px 16px', fontSize: 14, background: '#10b981', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer' }}
            >
              结束并判分
            </button>
          )}
          <button
            onClick={reset}
            style={{ padding: '8px 16px', fontSize: 14, background: '#fff', color: '#374151', border: '1px solid #d1d5db', borderRadius: 6, cursor: 'pointer' }}
          >
            取消
          </button>
        </div>
      </div>
    )
  }

  // result mode
  const answeredIds = Object.keys(userAnswers)
  const validCount = answeredIds.filter(id => getQuestionById(id) !== undefined).length
  const correctCount = Object.values(gradeResults).filter(Boolean).length
  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', padding: 12, gap: 10, overflow: 'auto' }}>
      <h3 style={{ fontSize: 16, fontWeight: 600, margin: 0 }}><BarChart3 size={14} style={{ verticalAlign: 'middle', marginRight: 4 }} /> 答题结果</h3>
      <div style={{ padding: 12, background: correctCount === validCount && validCount > 0 ? '#d1fae5' : correctCount === 0 ? '#fee2e2' : '#fef3c7', borderRadius: 6, fontSize: 18, fontWeight: 600, textAlign: 'center' }}>
        {correctCount} / {validCount}{answeredIds.length > validCount ? ` (${answeredIds.length - validCount} 题已下架)` : ''}
      </div>
      <div style={{ flex: 1, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
        {answeredIds.map((qid, idx) => {
          const q = getQuestionById(qid)
          const correct = gradeResults[qid]
          const userAnswer = userAnswers[qid] ?? ''
          if (!q) {
            return (
              <div key={qid} style={{ padding: 10, background: '#f3f4f6', borderRadius: 6, fontSize: 13, opacity: 0.7 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                  <span><Hourglass size={14} /></span>
                  <strong>第 {idx + 1} 题（该题已下架）</strong>
                </div>
                <div style={{ fontSize: 12, color: '#6b7280' }}>
                  你的答案: {userAnswer || '(空)'}
                </div>
              </div>
            )
          }
          return (
            <div key={q.id} style={{ padding: 10, background: '#f9fafb', borderRadius: 6, fontSize: 13 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                <span>{correct ? <CircleCheck size={14} style={{ color: '#22c55e' }} /> : <CircleX size={14} style={{ color: '#ef4444' }} />}</span>
                <strong>第 {idx + 1} 题</strong>
              </div>
              <div
                style={{ marginBottom: 4, lineHeight: 1.5 }}
                dangerouslySetInnerHTML={{ __html: renderPrompt(q.prompt) }}
              />
              <div style={{ fontSize: 12, color: '#6b7280' }}>
                你的答案: <span style={{ color: correct ? '#059669' : '#dc2626' }}>{userAnswer || '(空)'}</span>
                {!correct && <span style={{ marginLeft: 8 }}>正确答案: <strong style={{ color: '#059669' }}>{q.answer}</strong></span>}
              </div>
              {q.explanation && (
                <div style={{ marginTop: 6, fontSize: 12, color: '#374151', padding: 6, background: '#fff', borderRadius: 4, border: '1px solid #e5e7eb' }}
                  dangerouslySetInnerHTML={{ __html: renderPrompt(q.explanation) }}
                />
              )}
            </div>
          )
        })}
      </div>
      <button
        onClick={reset}
        style={{ padding: '8px 16px', fontSize: 14, background: '#3b82f6', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer' }}
      >
        再来一次
      </button>
    </div>
  )
}

function gradeAnswer(question: QuizQuestion, userAnswer: string): boolean {
  if (!question || typeof question.answer !== 'string') return false
  const trimmed = userAnswer.trim()
  if (trimmed === '') return false
  if (question.answerType === 'exact') {
    return trimmed === question.answer.trim()
  }
  const userNum = Number(trimmed)
  const correctNum = Number(question.answer)
  if (!Number.isFinite(userNum) || !Number.isFinite(correctNum)) return false
  const tolerance = typeof question.tolerance === 'number' ? question.tolerance : 0.01
  return Math.abs(userNum - correctNum) <= tolerance
}
