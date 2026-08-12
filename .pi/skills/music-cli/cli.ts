// music-cli — 音乐播放操控 Skill
// 通过 fetch 调用服务器 /api/entities?type=musicPlaylist 等，无外部依赖
//
// 命令：
//   playlist ls [--json]
//   playlist get <playlistId> [--json]
//   song play --id <songId> [--json]

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
const DEVICE_ID = 'music-cli'

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

// ===== Playlist Commands =====

async function playlistLs(json: boolean): Promise<void> {
  const resp = (await apiFetch('/api/entities?type=musicPlaylist&limit=1000')) as EntityListResponse
  const items = resp.items
  if (json) {
    jsonOut(true, items)
    return
  }
  if (items.length === 0) {
    console.log('No playlists found.')
    return
  }
  console.log(`Playlists (${items.length}):`)
  for (const e of items) {
    const name = String(e.data?.name || e.id)
    const songCount = Array.isArray(e.data?.songs) ? (e.data!.songs as unknown[]).length : 0
    console.log(`  ${e.id}  ${name}  (${songCount} songs)`)
  }
}

async function playlistGet(playlistId: string, json: boolean): Promise<void> {
  const entity = (await apiFetch(`/api/entities/${playlistId}`)) as Entity
  if (json) {
    jsonOut(true, entity)
    return
  }
  console.log(`Playlist: ${entity.data?.name || entity.id}`)
  console.log(`  ID:      ${entity.id}`)
  console.log(`  Data:    ${JSON.stringify(entity.data)}`)
}

// ===== Song Commands =====

async function songPlay(songId: string, json: boolean): Promise<void> {
  const entity = (await apiFetch('/api/entities', {
    method: 'POST',
    body: JSON.stringify({
      type: 'musicPlayAction',
      data: { songId, action: 'play', timestamp: Date.now() },
    }),
  })) as Entity
  if (json) {
    jsonOut(true, entity)
    return
  }
  console.log(`Play action recorded: ${entity.id} (song: ${songId})`)
}

// ===== Main =====

const USAGE =
  'Usage: music-cli <playlist|song> <command> [args] [--json]\n' +
  'Commands:\n' +
  '  playlist ls [--json]\n' +
  '  playlist get <playlistId> [--json]\n' +
  '  song play --id <songId> [--json]'

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
    if (resource === 'playlist') {
      const cmd = positional[0]
      if (cmd === 'ls') {
        await playlistLs(json)
      } else if (cmd === 'get') {
        const id = positional[1]
        if (!id) fail('Usage: playlist get <playlistId> [--json]', json, 2)
        await playlistGet(id, json)
      } else {
        fail(`Unknown playlist command: ${cmd || '(none)'}\nAvailable: ls, get`, json, 2)
      }
    } else if (resource === 'song') {
      const cmd = positional[0]
      if (cmd === 'play') {
        const id = flags['id']
        if (!id) fail('Usage: song play --id <songId> [--json]', json, 2)
        await songPlay(id, json)
      } else {
        fail(`Unknown song command: ${cmd || '(none)'}\nAvailable: play`, json, 2)
      }
    } else {
      fail(`Unknown resource: ${resource}\nAvailable: playlist, song`, json, 2)
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
