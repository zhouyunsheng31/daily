// life-cli — 生活管理 Skill（合并 habit/mood/focus/savings/quickNote）
// 通过 fetch 调用服务器 /api/entities?type=<entity-type>，无外部依赖
//
// 命令：
//   habit ls [--json]
//   habit checkin --id <habitId> [--json]
//   mood add --score <n> [--note <text>] [--json]
//   mood history [--limit <n>] [--json]
//   focus start [--goal <text>] [--json]
//   focus stop [--json]
//   focus stats [--json]
//   savings ls [--json]
//   savings create --name <name> --target <amount> [--json]
//   savings update --id <id> --amount <amount> [--json]
//   quicknote add --content <text> [--json]
//   quicknote ls [--limit <n>] [--json]
//   quicknote search <query> [--json]

// ===== Minimal Node.js + fetch type declarations (self-contained) =====
declare const process: {
  argv: string[]
  env: Record<string, string | undefined>
  exitCode: number
  exit(code?: number): never
}
declare const console: {
  log(...args: unknown[]): void
  error(...args: unknown[]): void
}
interface FetchResponse {
  ok: boolean
  status: number
  statusText: string
  json(): Promise<unknown>
  text(): Promise<string>
}
interface FetchInit {
  method?: string
  headers?: Record<string, string>
  body?: string
}
declare function fetch(input: string, init?: FetchInit): Promise<FetchResponse>

// ===== Config =====
const SERVER_URL = process.env.LD_SERVER_URL || 'http://localhost:3456'
const SERVER_TOKEN = process.env.LD_SERVER_TOKEN || process.env.SERVER_TOKEN || ''
const DEVICE_ID = 'life-cli'

// ===== Helpers =====
function authHeaders(): Record<string, string> {
  const h: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Device-Id': DEVICE_ID,
  }
  if (SERVER_TOKEN) h['Authorization'] = `Bearer ${SERVER_TOKEN}`
  return h
}

async function healthCheck(): Promise<boolean> {
  try {
    const res = await fetch(`${SERVER_URL}/api/health`, {
      headers: { 'X-Device-Id': DEVICE_ID },
    })
    return res.ok
  } catch {
    return false
  }
}

async function apiFetch(path: string, options?: FetchInit): Promise<unknown> {
  const res = await fetch(`${SERVER_URL}${path}`, {
    ...options,
    headers: { ...authHeaders(), ...(options?.headers || {}) },
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) {
    const errObj = body as { error?: unknown }
    const msg = errObj?.error
    if (typeof msg === 'string') throw new Error(msg)
    throw new Error(JSON.stringify(msg || `HTTP ${res.status} ${res.statusText}`))
  }
  return body
}

interface ParsedArgs {
  positional: string[]
  flags: Record<string, string>
  json: boolean
}

function parseArgs(argv: string[]): ParsedArgs {
  const positional: string[] = []
  const flags: Record<string, string> = {}
  let json = false
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--json') {
      json = true
      continue
    }
    if (arg.startsWith('--')) {
      const key = arg.slice(2)
      const next = argv[i + 1]
      if (next !== undefined && !next.startsWith('--')) {
        flags[key] = next
        i++
      } else {
        flags[key] = 'true'
      }
    } else {
      positional.push(arg)
    }
  }
  return { positional, flags, json }
}

function jsonOut(ok: boolean, payload: unknown): void {
  console.log(JSON.stringify(ok ? { ok: true, data: payload } : { ok: false, error: payload }))
}

class ExitSignal extends Error {}

function fail(msg: string, json: boolean, code: number): never {
  if (json) {
    console.log(JSON.stringify({ ok: false, error: msg }))
  } else {
    console.error(`Error: ${msg}`)
  }
  process.exitCode = code
  throw new ExitSignal()
}

// ===== Entity Types =====
interface Entity {
  id: string
  type: string
  scope: string
  panelId: string | null
  widgetId: string | null
  data: Record<string, unknown>
  recordStatus: string
  version: number
  createdAt: number
  updatedAt: number
}

interface EntityListResponse {
  items: Entity[]
  total: number
  limit: number
  offset: number
}

async function listEntities(type: string, limit: number): Promise<Entity[]> {
  const resp = (await apiFetch(`/api/entities?type=${type}&limit=${limit}`)) as EntityListResponse
  return resp.items
}

async function createEntity(type: string, data: Record<string, unknown>): Promise<Entity> {
  return (await apiFetch('/api/entities', {
    method: 'POST',
    body: JSON.stringify({ type, data }),
  })) as Entity
}

// ===== Habit Commands =====

async function habitLs(json: boolean): Promise<void> {
  const items = await listEntities('habit', 1000)
  if (json) {
    jsonOut(true, items)
    return
  }
  if (items.length === 0) {
    console.log('No habits found.')
    return
  }
  console.log(`Habits (${items.length}):`)
  for (const e of items) {
    const name = String(e.data?.name || e.data?.content || e.id)
    console.log(`  ${e.id}  ${name}`)
  }
}

async function habitCheckin(habitId: string, json: boolean): Promise<void> {
  const entity = await createEntity('habitCheckin', {
    habitId,
    timestamp: Date.now(),
  })
  if (json) {
    jsonOut(true, entity)
    return
  }
  console.log(`Habit check-in recorded: ${entity.id} (habit: ${habitId})`)
}

// ===== Mood Commands =====

async function moodAdd(score: number, note: string | undefined, json: boolean): Promise<void> {
  const data: Record<string, unknown> = { score, timestamp: Date.now() }
  if (note) data.note = note
  const entity = await createEntity('moodEntry', data)
  if (json) {
    jsonOut(true, entity)
    return
  }
  console.log(`Mood recorded: ${entity.id} (score: ${score}${note ? `, note: ${note}` : ''})`)
}

async function moodHistory(limit: number, json: boolean): Promise<void> {
  const items = await listEntities('moodEntry', limit)
  if (json) {
    jsonOut(true, items)
    return
  }
  if (items.length === 0) {
    console.log('No mood entries found.')
    return
  }
  console.log(`Mood History (${items.length}):`)
  for (const e of items) {
    const score = e.data?.score
    const note = e.data?.note ? `  ${e.data.note}` : ''
    const date = new Date(e.createdAt).toISOString().slice(0, 16)
    console.log(`  ${date}  score=${score}${note}`)
  }
}

// ===== Focus Commands =====

async function focusStart(goal: string | undefined, json: boolean): Promise<void> {
  const data: Record<string, unknown> = { action: 'start', startTime: Date.now() }
  if (goal) data.goal = goal
  const entity = await createEntity('focusSession', data)
  if (json) {
    jsonOut(true, entity)
    return
  }
  console.log(`Focus session started: ${entity.id}${goal ? ` (goal: ${goal})` : ''}`)
}

async function focusStop(json: boolean): Promise<void> {
  const entity = await createEntity('focusSession', {
    action: 'stop',
    stopTime: Date.now(),
  })
  if (json) {
    jsonOut(true, entity)
    return
  }
  console.log(`Focus session stopped: ${entity.id}`)
}

async function focusStats(json: boolean): Promise<void> {
  const items = await listEntities('focusSession', 10000)
  const starts = items.filter((e) => e.data?.action === 'start')
  const stops = items.filter((e) => e.data?.action === 'stop')
  const stats = {
    totalSessions: starts.length,
    totalStops: stops.length,
    sessions: items.length,
  }
  if (json) {
    jsonOut(true, stats)
    return
  }
  console.log('Focus Stats:')
  console.log(`  Total sessions started: ${stats.totalSessions}`)
  console.log(`  Total sessions stopped: ${stats.totalStops}`)
  console.log(`  Total records:          ${stats.sessions}`)
}

// ===== Savings Commands =====

async function savingsLs(json: boolean): Promise<void> {
  const items = await listEntities('savingsGoal', 1000)
  if (json) {
    jsonOut(true, items)
    return
  }
  if (items.length === 0) {
    console.log('No savings goals found.')
    return
  }
  console.log(`Savings Goals (${items.length}):`)
  for (const e of items) {
    const name = String(e.data?.name || e.id)
    const target = e.data?.target ?? '?'
    console.log(`  ${e.id}  ${name}  (target: ${target})`)
  }
}

async function savingsCreate(name: string, target: number, json: boolean): Promise<void> {
  const entity = await createEntity('savingsGoal', { name, target })
  if (json) {
    jsonOut(true, entity)
    return
  }
  console.log(`Savings goal created: ${entity.id} (${name}, target: ${target})`)
}

async function savingsUpdate(goalId: string, amount: number, json: boolean): Promise<void> {
  const entity = await createEntity('savingsTransaction', {
    goalId,
    amount,
    timestamp: Date.now(),
  })
  if (json) {
    jsonOut(true, entity)
    return
  }
  console.log(`Savings updated: ${entity.id} (goal: ${goalId}, amount: ${amount})`)
}

// ===== QuickNote Commands =====

async function quicknoteAdd(content: string, json: boolean): Promise<void> {
  const entity = await createEntity('quickNote', { content, timestamp: Date.now() })
  if (json) {
    jsonOut(true, entity)
    return
  }
  console.log(`Quick note added: ${entity.id}`)
  console.log(`  ${content.slice(0, 80)}${content.length > 80 ? '...' : ''}`)
}

async function quicknoteLs(limit: number, json: boolean): Promise<void> {
  const items = await listEntities('quickNote', limit)
  if (json) {
    jsonOut(true, items)
    return
  }
  if (items.length === 0) {
    console.log('No quick notes found.')
    return
  }
  console.log(`Quick Notes (${items.length}):`)
  for (const e of items) {
    const content = String(e.data?.content || '')
    const date = new Date(e.createdAt).toISOString().slice(0, 16)
    console.log(`  ${e.id}  ${date}  ${content.slice(0, 60)}${content.length > 60 ? '...' : ''}`)
  }
}

async function quicknoteSearch(query: string, json: boolean): Promise<void> {
  const items = await listEntities('quickNote', 1000)
  const q = query.toLowerCase()
  const matches = items.filter((e) =>
    JSON.stringify(e.data || {}).toLowerCase().includes(q),
  )
  if (json) {
    jsonOut(true, matches)
    return
  }
  if (matches.length === 0) {
    console.log(`No quick notes matching "${query}".`)
    return
  }
  console.log(`Search results (${matches.length}):`)
  for (const e of matches) {
    const content = String(e.data?.content || '')
    console.log(`  ${e.id}  ${content.slice(0, 60)}${content.length > 60 ? '...' : ''}`)
  }
}

// ===== Main =====

const USAGE =
  'Usage: life-cli <resource> <command> [args] [--json]\n' +
  'Resources & Commands:\n' +
  '  habit ls [--json]\n' +
  '  habit checkin --id <habitId> [--json]\n' +
  '  mood add --score <n> [--note <text>] [--json]\n' +
  '  mood history [--limit <n>] [--json]\n' +
  '  focus start [--goal <text>] [--json]\n' +
  '  focus stop [--json]\n' +
  '  focus stats [--json]\n' +
  '  savings ls [--json]\n' +
  '  savings create --name <name> --target <amount> [--json]\n' +
  '  savings update --id <id> --amount <amount> [--json]\n' +
  '  quicknote add --content <text> [--json]\n' +
  '  quicknote ls [--limit <n>] [--json]\n' +
  '  quicknote search <query> [--json]'

async function main(): Promise<void> {
  const argv = process.argv.slice(2)
  if (argv.length === 0) {
    fail(USAGE, false, 2)
  }

  const resource = argv[0]
  const rest = argv.slice(1)
  const { positional, flags, json } = parseArgs(rest)

  // Health check
  const healthy = await healthCheck()
  if (!healthy) {
    fail(`Server not running at ${SERVER_URL}`, json, 1)
  }

  try {
    if (resource === 'habit') {
      const cmd = positional[0]
      if (cmd === 'ls') {
        await habitLs(json)
      } else if (cmd === 'checkin') {
        const id = flags['id']
        if (!id) fail('Usage: habit checkin --id <habitId> [--json]', json, 2)
        await habitCheckin(id, json)
      } else {
        fail(`Unknown habit command: ${cmd || '(none)'}\nAvailable: ls, checkin`, json, 2)
      }
    } else if (resource === 'mood') {
      const cmd = positional[0]
      if (cmd === 'add') {
        const scoreStr = flags['score']
        if (!scoreStr) fail('Usage: mood add --score <n> [--note <text>] [--json]', json, 2)
        const score = parseInt(scoreStr, 10)
        if (isNaN(score)) fail(`Invalid score: ${scoreStr}`, json, 2)
        await moodAdd(score, flags['note'], json)
      } else if (cmd === 'history') {
        const limit = flags['limit'] ? parseInt(flags['limit'], 10) : 50
        if (isNaN(limit) || limit < 1) fail(`Invalid --limit: ${flags['limit']}`, json, 2)
        await moodHistory(limit, json)
      } else {
        fail(`Unknown mood command: ${cmd || '(none)'}\nAvailable: add, history`, json, 2)
      }
    } else if (resource === 'focus') {
      const cmd = positional[0]
      if (cmd === 'start') {
        await focusStart(flags['goal'], json)
      } else if (cmd === 'stop') {
        await focusStop(json)
      } else if (cmd === 'stats') {
        await focusStats(json)
      } else {
        fail(`Unknown focus command: ${cmd || '(none)'}\nAvailable: start, stop, stats`, json, 2)
      }
    } else if (resource === 'savings') {
      const cmd = positional[0]
      if (cmd === 'ls') {
        await savingsLs(json)
      } else if (cmd === 'create') {
        const name = flags['name']
        const targetStr = flags['target']
        if (!name || !targetStr)
          fail('Usage: savings create --name <name> --target <amount> [--json]', json, 2)
        const target = parseFloat(targetStr)
        if (isNaN(target)) fail(`Invalid target amount: ${targetStr}`, json, 2)
        await savingsCreate(name, target, json)
      } else if (cmd === 'update') {
        const id = flags['id']
        const amountStr = flags['amount']
        if (!id || !amountStr)
          fail('Usage: savings update --id <id> --amount <amount> [--json]', json, 2)
        const amount = parseFloat(amountStr)
        if (isNaN(amount)) fail(`Invalid amount: ${amountStr}`, json, 2)
        await savingsUpdate(id, amount, json)
      } else {
        fail(`Unknown savings command: ${cmd || '(none)'}\nAvailable: ls, create, update`, json, 2)
      }
    } else if (resource === 'quicknote') {
      const cmd = positional[0]
      if (cmd === 'add') {
        const content = flags['content']
        if (!content) fail('Usage: quicknote add --content <text> [--json]', json, 2)
        await quicknoteAdd(content, json)
      } else if (cmd === 'ls') {
        const limit = flags['limit'] ? parseInt(flags['limit'], 10) : 50
        if (isNaN(limit) || limit < 1) fail(`Invalid --limit: ${flags['limit']}`, json, 2)
        await quicknoteLs(limit, json)
      } else if (cmd === 'search') {
        const query = positional[1]
        if (!query) fail('Usage: quicknote search <query> [--json]', json, 2)
        await quicknoteSearch(query, json)
      } else {
        fail(
          `Unknown quicknote command: ${cmd || '(none)'}\nAvailable: add, ls, search`,
          json,
          2,
        )
      }
    } else {
      fail(
        `Unknown resource: ${resource}\nAvailable: habit, mood, focus, savings, quicknote`,
        json,
        2,
      )
    }
  } catch (err) {
    if (err instanceof ExitSignal) throw err
    const msg = err instanceof Error ? err.message : String(err)
    fail(msg, json, 1)
  }
}

main().catch((err) => {
  if (!(err instanceof ExitSignal)) {
    process.exitCode = 1
    console.error(err instanceof Error ? err.message : String(err))
  }
})
