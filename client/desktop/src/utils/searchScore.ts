import type { SearchableRecord } from './searchCache'

const HIGH_WEIGHT = 3
const MEDIUM_WEIGHT = 2
const LOW_WEIGHT = 1

export interface ScoreResult {
  score: number
  matchedField: string
  snippet: string
}

export function scoreRecord(record: SearchableRecord, tokens: string[]): ScoreResult {
  if (tokens.length === 0) return { score: 0, matchedField: '', snippet: '' }

  let totalScore = 0
  let matchedField = ''
  let matchedText = ''

  // 高权重字段
  for (const [fieldName, value] of Object.entries(record.highWeightFields)) {
    if (!value) continue
    const lowerValue = value.toLowerCase()
    for (const token of tokens) {
      if (lowerValue.includes(token)) {
        totalScore += HIGH_WEIGHT
        if (!matchedField) {
          matchedField = fieldName
          matchedText = value
        }
      }
    }
  }

  // 中权重字段
  for (const [fieldName, value] of Object.entries(record.mediumWeightFields)) {
    if (!value) continue
    const lowerValue = value.toLowerCase()
    for (const token of tokens) {
      if (lowerValue.includes(token)) {
        totalScore += MEDIUM_WEIGHT
        if (!matchedField) {
          matchedField = fieldName
          matchedText = value
        }
      }
    }
  }

  // 低权重字段
  for (const [fieldName, value] of Object.entries(record.lowWeightFields)) {
    if (!value) continue
    const lowerValue = value.toLowerCase()
    for (const token of tokens) {
      if (lowerValue.includes(token)) {
        totalScore += LOW_WEIGHT
        if (!matchedField) {
          matchedField = fieldName
          matchedText = value
        }
      }
    }
  }

  const snippet = matchedText ? matchedText.slice(0, 120) : ''
  return { score: totalScore, matchedField, snippet }
}

export function pickTopN<T extends { score: number }>(hits: T[], n: number): T[] {
  return hits
    .sort((a, b) => b.score - a.score)
    .slice(0, n)
}
