// canvas-cli — Panel + Widget 操作 Skill
// 通过 fetch 调用服务器 HTTP API，无外部依赖，仅用 Node.js 内置 API
//
// 命令：
//   panel ls [--json]
//   panel get <panelId> [--json]
//   panel create --name <name> [--json]
//   panel delete <panelId> [--json]
//   widget ls [--panel <panelId>] [--json]
//   widget get <widgetId> [--json]
//   widget create --panel <panelId> --type <type> [--state <json>] [--json]
//   widget update <widgetId> --state <json> [--json]
//   widget delete <widgetId> [--json]

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
const DEVICE_ID = 'canvas-cli'

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

function safeJsonParse(s: string): unknown {
  try {
    return JSON.parse(s)
  } catch {
    throw new Error(`Invalid JSON: ${s}`)
  }
}

// ===== Panel Commands =====

interface Panel {
  id: string
  name: string
  sortOrder: number
  settings?: Record<string, unknown>
  canvasTransform?: unknown
  createdAt: number
  updatedAt: number
}

async function panelLs(json: boolean): Promise<void> {
  const panels = (await apiFetch('/api/panels')) as Panel[]
  if (json) {
    jsonOut(true, panels)
    return
  }
  if (panels.length === 0) {
    console.log('No panels found.')
    return
  }
  console.log(`Panels (${panels.length}):`)
  for (const p of panels) {
    console.log(`  ${p.id}  ${p.name}  (sort: ${p.sortOrder})`)
  }
}

async function panelGet(panelId: string, json: boolean): Promise<void> {
  const panel = (await apiFetch(`/api/panels/${panelId}`)) as Panel
  if (json) {
    jsonOut(true, panel)
    return
  }
  console.log(`Panel: ${panel.name}`)
  console.log(`  ID:         ${panel.id}`)
  console.log(`  Sort Order: ${panel.sortOrder}`)
  console.log(`  Created:    ${new Date(panel.createdAt).toISOString()}`)
  console.log(`  Updated:    ${new Date(panel.updatedAt).toISOString()}`)
}

async function panelCreate(name: string, json: boolean): Promise<void> {
  const panel = (await apiFetch('/api/panels', {
    method: 'POST',
    body: JSON.stringify({ name }),
  })) as Panel
  if (json) {
    jsonOut(true, panel)
    return
  }
  console.log(`Created panel: ${panel.name} (${panel.id})`)
}

async function panelDelete(panelId: string, json: boolean): Promise<void> {
  await apiFetch(`/api/panels/${panelId}`, { method: 'DELETE' })
  if (json) {
    jsonOut(true, { deleted: true, id: panelId })
    return
  }
  console.log(`Deleted panel: ${panelId}`)
}

// ===== Widget Commands =====

interface Widget {
  id: string
  panelId: string
  type: string
  x: number
  y: number
  width: number
  height: number
  zIndex: number
  minimized: boolean
  locked: boolean
  colorScheme: string | null
  state: Record<string, unknown>
  isPrimary: boolean
  version: number
  createdAt: number
  updatedAt: number
}

async function widgetLs(panelId: string | undefined, json: boolean): Promise<void> {
  let widgets: Widget[]
  if (panelId) {
    widgets = (await apiFetch(`/api/panels/${panelId}/widgets`)) as Widget[]
  } else {
    // No panel specified: fetch all panels, then gather widgets from each
    const panels = (await apiFetch('/api/panels')) as Panel[]
    widgets = []
    for (const p of panels) {
      const ws = (await apiFetch(`/api/panels/${p.id}/widgets`)) as Widget[]
      widgets.push(...ws)
    }
  }
  if (json) {
    jsonOut(true, widgets)
    return
  }
  if (widgets.length === 0) {
    console.log('No widgets found.')
    return
  }
  console.log(`Widgets (${widgets.length}):`)
  for (const w of widgets) {
    console.log(`  ${w.id}  [${w.type}]  panel=${w.panelId}  ${w.width}x${w.height} @ (${w.x},${w.y})`)
  }
}

async function widgetGet(widgetId: string, json: boolean): Promise<void> {
  const widget = (await apiFetch(`/api/widgets/${widgetId}`)) as Widget
  if (json) {
    jsonOut(true, widget)
    return
  }
  console.log(`Widget: ${widget.type} (${widget.id})`)
  console.log(`  Panel:      ${widget.panelId}`)
  console.log(`  Position:   (${widget.x}, ${widget.y})`)
  console.log(`  Size:       ${widget.width}x${widget.height}`)
  console.log(`  Z-Index:    ${widget.zIndex}`)
  console.log(`  Minimized:  ${widget.minimized}`)
  console.log(`  Locked:     ${widget.locked}`)
  console.log(`  Version:    ${widget.version}`)
  console.log(`  State:      ${JSON.stringify(widget.state)}`)
}

async function widgetCreate(
  panelId: string,
  type: string,
  stateJson: string | undefined,
  json: boolean,
): Promise<void> {
  const state = stateJson ? safeJsonParse(stateJson) : {}
  const widget = (await apiFetch(`/api/panels/${panelId}/widgets`, {
    method: 'POST',
    body: JSON.stringify({ type, state }),
  })) as Widget
  if (json) {
    jsonOut(true, widget)
    return
  }
  console.log(`Created widget: ${widget.type} (${widget.id}) in panel ${widget.panelId}`)
}

async function widgetUpdate(widgetId: string, stateJson: string, json: boolean): Promise<void> {
  const state = safeJsonParse(stateJson)
  const widget = (await apiFetch(`/api/widgets/${widgetId}`, {
    method: 'PUT',
    body: JSON.stringify({ state }),
  })) as Widget
  if (json) {
    jsonOut(true, widget)
    return
  }
  console.log(`Updated widget: ${widget.id} (version ${widget.version})`)
}

async function widgetDelete(widgetId: string, json: boolean): Promise<void> {
  await apiFetch(`/api/widgets/${widgetId}`, { method: 'DELETE' })
  if (json) {
    jsonOut(true, { deleted: true, id: widgetId })
    return
  }
  console.log(`Deleted widget: ${widgetId}`)
}

// ===== Main =====

async function main(): Promise<void> {
  const argv = process.argv.slice(2)
  if (argv.length === 0) {
    fail(
      'Usage: canvas-cli <panel|widget> <command> [args] [--json]\n' +
        'Commands:\n' +
        '  panel ls [--json]\n' +
        '  panel get <panelId> [--json]\n' +
        '  panel create --name <name> [--json]\n' +
        '  panel delete <panelId> [--json]\n' +
        '  widget ls [--panel <panelId>] [--json]\n' +
        '  widget get <widgetId> [--json]\n' +
        '  widget create --panel <panelId> --type <type> [--state <json>] [--json]\n' +
        '  widget update <widgetId> --state <json> [--json]\n' +
        '  widget delete <widgetId> [--json]',
      false,
      2,
    )
  }

  const resource = argv[0] // 'panel' | 'widget'
  const rest = argv.slice(1)
  const { positional, flags, json } = parseArgs(rest)

  // Health check
  const healthy = await healthCheck()
  if (!healthy) {
    fail(`Server not running at ${SERVER_URL}`, json, 1)
  }

  try {
    if (resource === 'panel') {
      const cmd = positional[0]
      if (cmd === 'ls') {
        await panelLs(json)
      } else if (cmd === 'get') {
        const id = positional[1]
        if (!id) fail('Usage: panel get <panelId> [--json]', json, 2)
        await panelGet(id, json)
      } else if (cmd === 'create') {
        const name = flags['name']
        if (!name) fail('Usage: panel create --name <name> [--json]', json, 2)
        await panelCreate(name, json)
      } else if (cmd === 'delete') {
        const id = positional[1]
        if (!id) fail('Usage: panel delete <panelId> [--json]', json, 2)
        await panelDelete(id, json)
      } else {
        fail(`Unknown panel command: ${cmd || '(none)'}\nAvailable: ls, get, create, delete`, json, 2)
      }
    } else if (resource === 'widget') {
      const cmd = positional[0]
      if (cmd === 'ls') {
        await widgetLs(flags['panel'], json)
      } else if (cmd === 'get') {
        const id = positional[1]
        if (!id) fail('Usage: widget get <widgetId> [--json]', json, 2)
        await widgetGet(id, json)
      } else if (cmd === 'create') {
        const panelId = flags['panel']
        const type = flags['type']
        if (!panelId || !type)
          fail('Usage: widget create --panel <panelId> --type <type> [--state <json>] [--json]', json, 2)
        await widgetCreate(panelId, type, flags['state'], json)
      } else if (cmd === 'update') {
        const id = positional[1]
        const state = flags['state']
        if (!id || !state) fail('Usage: widget update <widgetId> --state <json> [--json]', json, 2)
        await widgetUpdate(id, state, json)
      } else if (cmd === 'delete') {
        const id = positional[1]
        if (!id) fail('Usage: widget delete <widgetId> [--json]', json, 2)
        await widgetDelete(id, json)
      } else {
        fail(
          `Unknown widget command: ${cmd || '(none)'}\nAvailable: ls, get, create, update, delete`,
          json,
          2,
        )
      }
    } else {
      fail(`Unknown resource: ${resource}\nAvailable: panel, widget`, json, 2)
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
