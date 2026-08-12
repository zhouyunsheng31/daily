import { ensureCacheReady, _getCachedRecords, type SearchableRecord } from './searchCache'
import { tokenize } from './searchTokenizer'
import { scoreRecord, pickTopN } from './searchScore'
import type {
  LocalSearchParams,
  LocalSearchResult,
  LocalSearchHit,
} from '../types/ai'

const DEFAULT_LIMIT = 20
const HARD_LIMIT = 50

export async function runLocalSearch(params: LocalSearchParams): Promise<LocalSearchResult> {
  const t0 = performance.now()
  const query = (params.query || '').trim()
  if (!query) {
    return { results: [], total: 0, tookMs: Math.round(performance.now() - t0) }
  }

  await ensureCacheReady()
  const records = _getCachedRecords()
  const tokens = tokenize(query)

  const filtered = params.type
    ? records.filter((r) => r.type === params.type)
    : records

  const hits: LocalSearchHit[] = []
  for (const record of filtered) {
    const { score, matchedField, snippet } = scoreRecord(record, tokens)
    if (score <= 0) continue
    hits.push({
      type: record.type,
      id: record.id,
      title: pickTitle(record),
      snippet,
      location: matchedField,
      panelId: record.panelId,
      score,
    })
  }

  const limit = Math.min(Math.max(params.limit ?? DEFAULT_LIMIT, 1), HARD_LIMIT)
  const top = pickTopN(hits, limit)

  return {
    results: top,
    total: hits.length,
    tookMs: Math.round(performance.now() - t0),
  }
}

function pickTitle(record: SearchableRecord): string {
  for (const v of Object.values(record.highWeightFields)) {
    if (v && v.trim()) return v.trim().slice(0, 100)
  }
  for (const v of Object.values(record.mediumWeightFields)) {
    if (v && v.trim()) return v.trim().slice(0, 100)
  }
  return record.id
}
