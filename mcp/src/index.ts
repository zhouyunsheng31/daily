import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import * as fs from 'fs'
import * as path from 'path'

const PROJECT_ROOT = findProjectRoot()

function findProjectRoot(): string {
  let dir = process.cwd()
  for (let i = 0; i < 10; i++) {
    if (fs.existsSync(path.join(dir, 'package.json'))) {
      const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf-8'))
      if (pkg.name === 'event') return dir
    }
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  const envRoot = process.env.DASHBOARD_PROJECT_ROOT
  if (envRoot) return envRoot
  return process.cwd()
}

const WIDGETS_DIR = path.join(PROJECT_ROOT, 'src', 'components', 'widgets')
const REGISTRY_FILE = path.join(PROJECT_ROOT, 'src', 'registry', 'builtIn.ts')
const CONTAINER_FILE = path.join(PROJECT_ROOT, 'src', 'components', 'WidgetContainer.tsx')
const ADD_MENU_FILE = path.join(PROJECT_ROOT, 'src', 'components', 'AddWidgetMenu.tsx')

function toPascalCase(s: string): string {
  return s.replace(/(^|[_-])(\w)/g, (_, _sep, c) => c.toUpperCase())
}

function toKebabCase(s: string): string {
  return s.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase()
}

function widgetFileExists(widgetType: string): boolean {
  const pascalName = toPascalCase(widgetType)
  return fs.existsSync(path.join(WIDGETS_DIR, `${pascalName}.tsx`))
}

function readWidgetSource(widgetType: string): string | null {
  const pascalName = toPascalCase(widgetType)
  const filePath = path.join(WIDGETS_DIR, `${pascalName}.tsx`)
  if (!fs.existsSync(filePath)) return null
  return fs.readFileSync(filePath, 'utf-8')
}

function writeWidgetFile(widgetType: string, code: string): string {
  const pascalName = toPascalCase(widgetType)
  const filePath = path.join(WIDGETS_DIR, `${pascalName}.tsx`)
  fs.writeFileSync(filePath, code, 'utf-8')
  return filePath
}

function listExistingWidgets(): { type: string; name: string; file: string }[] {
  const results: { type: string; name: string; file: string }[] = []
  if (!fs.existsSync(WIDGETS_DIR)) return results
  const files = fs.readdirSync(WIDGETS_DIR).filter(f => f.endsWith('.tsx'))
  for (const f of files) {
    const name = f.replace('.tsx', '')
    const content = fs.readFileSync(path.join(WIDGETS_DIR, f), 'utf-8')
    const typeMatch = content.match(/widgetType:\s*['"](\w+)['"]/)
    const displayMatch = content.match(/displayName:\s*['"]([^'"]+)['"]/)
    results.push({
      type: typeMatch?.[1] ?? toKebabCase(name),
      name: displayMatch?.[1] ?? name,
      file: f,
    })
  }
  return results
}

function isRegisteredInBuiltIn(widgetType: string): boolean {
  if (!fs.existsSync(REGISTRY_FILE)) return false
  const content = fs.readFileSync(REGISTRY_FILE, 'utf-8')
  return content.includes(`widgetType: '${widgetType}'`)
}

function isImportedInContainer(widgetType: string): boolean {
  if (!fs.existsSync(CONTAINER_FILE)) return false
  const content = fs.readFileSync(CONTAINER_FILE, 'utf-8')
  const pascalName = toPascalCase(widgetType)
  return content.includes(`import ${pascalName} from`) || content.includes(`case '${widgetType}'`)
}

function registerInBuiltIn(config: {
  widgetType: string
  displayName: string
  icon: string
  width: number
  height: number
  minW: number
  minH: number
  defaultState: Record<string, unknown>
}): string {
  const content = fs.readFileSync(REGISTRY_FILE, 'utf-8')

  if (content.includes(`widgetType: '${config.widgetType}'`)) {
    return 'already registered'
  }

  const newConfigEntry = `  {
    widgetType: '${config.widgetType}',
    displayName: '${config.displayName}',
    icon: '${config.icon}',
    defaultLayout: { w: ${config.width}, h: ${config.height}, minW: ${config.minW}, minH: ${config.minH} },
    defaultState: ${JSON.stringify(config.defaultState)},
    component: () => null,
    serialize: s => s,
    deserialize: d => d,
  },`

  const updated = content.replace(
    /const builtInConfigs: WidgetConfig\[\] = \[/,
    `const builtInConfigs: WidgetConfig[] = [\n${newConfigEntry}`
  )

  fs.writeFileSync(REGISTRY_FILE, updated, 'utf-8')
  return 'registered'
}

function registerInContainer(widgetType: string): string {
  const pascalName = toPascalCase(widgetType)
  let content = fs.readFileSync(CONTAINER_FILE, 'utf-8')

  if (content.includes(`case '${widgetType}'`)) {
    return 'already imported'
  }

  const lastImport = content.match(/import \w+ from '\.\/widgets\/\w+'\n/g)
  if (lastImport) {
    const lastOne = lastImport[lastImport.length - 1]
    content = content.replace(
      lastOne,
      `${lastOne}import ${pascalName} from './widgets/${pascalName}'\n`
    )
  }

  content = content.replace(
    /default: return null/,
    `case '${widgetType}': return <${pascalName} widgetId={id} state={widgetState} onUpdateState={onUpdateState} />\n      default: return null`
  )

  fs.writeFileSync(CONTAINER_FILE, content, 'utf-8')
  return 'imported and added to render switch'
}

function registerInAddMenu(widgetType: string, displayName: string, desc: string): string {
  let content = fs.readFileSync(ADD_MENU_FILE, 'utf-8')

  if (content.includes(`type: '${widgetType}'`)) {
    return 'already in menu'
  }

  const newOption = `  {
    type: '${widgetType}', name: '${displayName}', desc: '${desc}',
    icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="21" x2="9" y2="9"/></svg>,
  },`

  const lastEntry = content.match(/},\n\]/g)
  if (lastEntry) {
    content = content.replace(
      lastEntry[0],
      `},\n${newOption}\n]`
    )
  }

  fs.writeFileSync(ADD_MENU_FILE, content, 'utf-8')
  return 'added to menu'
}

function generateBasicWidgetCode(config: {
  widgetType: string
  displayName: string
  defaultState: Record<string, unknown>
  description: string
}): string {
  const pascalName = toPascalCase(config.widgetType)
  const stateKeys = Object.keys(config.defaultState)
  const stateDeclarations = stateKeys
    .map(k => {
      const v = config.defaultState[k]
      const typeStr = typeof v === 'number' ? 'number' : 'string'
      const defaultVal = typeof v === 'string' ? `'${v}'` : v
      return `  const ${k} = (state.${k} as ${typeStr}) ?? ${defaultVal}`
    })
    .join('\n')

  return `import { useState, useEffect, useCallback, useRef, useMemo } from 'react'

interface Props {
  widgetId: string
  state: Record<string, unknown>
  onUpdateState: (partial: Record<string, unknown>) => void
}

export default function ${pascalName}({ state, onUpdateState }: Props) {
${stateDeclarations || '  // Add your state declarations here'}

  return (
    <div style={{ padding: 16, height: '100%', display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>
        ${config.displayName}
      </div>
      <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
        ${config.description}
      </div>
    </div>
  )
}
`
}

function generateApiWidgetCode(config: {
  widgetType: string
  displayName: string
  description: string
  apiEndpoints: { name: string; method: string; path: string; description: string }[]
  defaultState: Record<string, unknown>
}): string {
  const pascalName = toPascalCase(config.widgetType)
  const endpointsCode = config.apiEndpoints.map(ep => {
    return `    { name: '${ep.name}', method: '${ep.method}', path: '${ep.path}', description: '${ep.description}' }`
  }).join(',\n')

  return `import { useState, useEffect, useCallback, useRef } from 'react'

interface Props {
  widgetId: string
  state: Record<string, unknown>
  onUpdateState: (partial: Record<string, unknown>) => void
}

interface ApiEndpoint {
  name: string
  method: string
  path: string
  description: string
}

const API_ENDPOINTS: ApiEndpoint[] = [
${endpointsCode}
]

export default function ${pascalName}({ state, onUpdateState }: Props) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [results, setResults] = useState<Record<string, unknown>[]>([])
  const [activeEndpoint, setActiveEndpoint] = useState<string>(API_ENDPOINTS[0]?.name || '')
  const [params, setParams] = useState<Record<string, string>>({})
  const [rawResponse, setRawResponse] = useState<string>('')

  const apiBaseUrl = (state.apiBaseUrl as string) || ''
  const savedResults = (state.savedResults as Record<string, unknown>[]) || []

  const executeApi = useCallback(async (endpoint: ApiEndpoint) => {
    if (!apiBaseUrl) {
      setError('API base URL not configured. Right-click this widget and set apiBaseUrl in state.')
      return
    }
    setLoading(true)
    setError(null)
    try {
      const url = new URL(endpoint.path, apiBaseUrl)
      const fetchOptions: RequestInit = {
        method: endpoint.method,
        headers: { 'Content-Type': 'application/json' },
      }
      if (endpoint.method !== 'GET' && Object.keys(params).length > 0) {
        fetchOptions.body = JSON.stringify(params)
      } else {
        Object.entries(params).forEach(([k, v]) => {
          if (v) url.searchParams.set(k, v)
        })
      }
      const res = await fetch(url.toString(), fetchOptions)
      const data = await res.json()
      setRawResponse(JSON.stringify(data, null, 2))
      if (Array.isArray(data)) {
        setResults(data)
      } else if (data.data && Array.isArray(data.data)) {
        setResults(data.data)
      } else {
        setResults([data])
      }
      onUpdateState({ savedResults: Array.isArray(data) ? data : [data] })
    } catch (err) {
      setError(String(err))
    } finally {
      setLoading(false)
    }
  }, [apiBaseUrl, params, onUpdateState])

  const currentEndpoint = API_ENDPOINTS.find(e => e.name === activeEndpoint)

  return (
    <div style={{ padding: 12, height: '100%', display: 'flex', flexDirection: 'column', gap: 8, overflow: 'auto', fontSize: 13 }}>
      <div style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: 14 }}>
        ${config.displayName}
      </div>

      {!apiBaseUrl && (
        <div style={{ padding: 8, borderRadius: 6, background: 'rgba(255,149,0,0.1)', color: '#FF9500', fontSize: 12 }}>
          Right-click this widget, click Edit, and set apiBaseUrl in state to your API server address.
        </div>
      )}

      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
        {API_ENDPOINTS.map(ep => (
          <button
            key={ep.name}
            onClick={() => { setActiveEndpoint(ep.name); setParams({}); setRawResponse('') }}
            style={{
              padding: '4px 10px',
              borderRadius: 6,
              border: activeEndpoint === ep.name ? '1px solid var(--color-primary)' : '1px solid var(--border-default)',
              background: activeEndpoint === ep.name ? 'var(--color-primary-muted)' : 'transparent',
              color: activeEndpoint === ep.name ? 'var(--color-primary-light)' : 'var(--text-secondary)',
              cursor: 'pointer',
              fontSize: 12,
            }}
          >
            {ep.name}
          </button>
        ))}
      </div>

      {currentEndpoint && (
        <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
          {currentEndpoint.method} {currentEndpoint.path} - {currentEndpoint.description}
        </div>
      )}

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <input
          placeholder="param key"
          style={{ flex: 1, minWidth: 60, padding: '4px 8px', borderRadius: 4, border: '1px solid var(--border-default)', background: 'var(--bg-surface)', color: 'var(--text-primary)', fontSize: 12 }}
          onChange={e => setParams(p => ({ ...p, key: e.target.value }))}
        />
        <input
          placeholder="value"
          style={{ flex: 1, minWidth: 60, padding: '4px 8px', borderRadius: 4, border: '1px solid var(--border-default)', background: 'var(--bg-surface)', color: 'var(--text-primary)', fontSize: 12 }}
          onChange={e => setParams(p => ({ ...p, value: e.target.value }))}
        />
      </div>

      <button
        onClick={() => currentEndpoint && executeApi(currentEndpoint)}
        disabled={loading || !currentEndpoint}
        style={{
          padding: '6px 14px',
          borderRadius: 6,
          border: 'none',
          background: loading ? 'var(--bg-elevated)' : 'var(--color-primary)',
          color: loading ? 'var(--text-tertiary)' : '#fff',
          cursor: loading ? 'not-allowed' : 'pointer',
          fontSize: 12,
          fontWeight: 600,
        }}
      >
        {loading ? 'Loading...' : 'Execute'}
      </button>

      {error && (
        <div style={{ padding: 8, borderRadius: 6, background: 'rgba(255,59,48,0.1)', color: '#FF3B30', fontSize: 12 }}>
          {error}
        </div>
      )}

      {results.length > 0 && (
        <div style={{ flex: 1, overflow: 'auto', borderRadius: 6, border: '1px solid var(--border-subtle)', padding: 8 }}>
          {results.map((item, i) => (
            <div key={i} style={{ padding: '6px 0', borderBottom: '1px solid var(--border-subtle)', fontSize: 12, color: 'var(--text-secondary)' }}>
              {Object.entries(item).slice(0, 5).map(([k, v]) => (
                <span key={k} style={{ marginRight: 12 }}>
                  <span style={{ color: 'var(--text-tertiary)' }}>{k}:</span> {String(v).slice(0, 50)}
                </span>
              ))}
            </div>
          ))}
        </div>
      )}

      {rawResponse && (
        <details style={{ fontSize: 11 }}>
          <summary style={{ cursor: 'pointer', color: 'var(--text-tertiary)' }}>Raw Response</summary>
          <pre style={{ maxHeight: 200, overflow: 'auto', padding: 8, borderRadius: 4, background: 'var(--bg-canvas)', color: 'var(--text-secondary)', fontSize: 10 }}>
            {rawResponse}
          </pre>
        </details>
      )}
    </div>
  )
}
`
}

function deleteWidgetFiles(widgetType: string): string[] {
  const deleted: string[] = []
  const pascalName = toPascalCase(widgetType)
  const widgetFile = path.join(WIDGETS_DIR, `${pascalName}.tsx`)
  if (fs.existsSync(widgetFile)) {
    fs.unlinkSync(widgetFile)
    deleted.push(widgetFile)
  }

  let registryContent = fs.readFileSync(REGISTRY_FILE, 'utf-8')
  const configPattern = new RegExp(
    `\\s*\\{[\\s\\S]*?widgetType: '${widgetType}'[\\s\\S]*?\\},?\\n`
  )
  registryContent = registryContent.replace(configPattern, '\n')
  fs.writeFileSync(REGISTRY_FILE, registryContent, 'utf-8')
  deleted.push('registry entry removed')

  let containerContent = fs.readFileSync(CONTAINER_FILE, 'utf-8')
  containerContent = containerContent.replace(
    new RegExp(`import ${pascalName} from '\\.\\/widgets\\/${pascalName}'\\n`),
    ''
  )
  containerContent = containerContent.replace(
    new RegExp(`\\s*case '${widgetType}': return[^\\n]+\\n`),
    ''
  )
  fs.writeFileSync(CONTAINER_FILE, containerContent, 'utf-8')
  deleted.push('container import/switch removed')

  let menuContent = fs.readFileSync(ADD_MENU_FILE, 'utf-8')
  const menuPattern = new RegExp(
    `\\s*\\{[\\s\\S]*?type: '${widgetType}'[\\s\\S]*?\\},?\\n`
  )
  menuContent = menuContent.replace(menuPattern, '\n')
  fs.writeFileSync(ADD_MENU_FILE, menuContent, 'utf-8')
  deleted.push('menu entry removed')

  return deleted
}

const server = new McpServer({
  name: 'living-dashboard',
  version: '1.0.0',
})

type McpPermission =
  | 'widget:create'
  | 'widget:move'
  | 'widget:resize'
  | 'widget:updateProps'
  | 'widget:delete'
  | 'widget:readState'
  | 'widget:writeState'

interface McpScope {
  panelIds?: string[]
  widgetIds?: string[]
  widgetTypes?: string[]
  maxCreateCount?: number
  allowLockedWidgets: boolean
}

interface AuditLogEntry {
  id: string
  action: string
  target: string
  timestamp: number
  before?: unknown
  after?: unknown
}

const DEFAULT_PERMISSIONS: McpPermission[] = ['widget:create', 'widget:readState']
const DEFAULT_SCOPE: McpScope = {
  panelIds: undefined,
  maxCreateCount: 3,
  allowLockedWidgets: false,
}

const auditLog: AuditLogEntry[] = []
let createCountThisSession = 0

function addAuditEntry(action: string, target: string, before?: unknown, after?: unknown): void {
  auditLog.push({
    id: `audit_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    action,
    target,
    timestamp: Date.now(),
    before,
    after,
  })
  if (auditLog.length > 1000) {
    auditLog.splice(0, auditLog.length - 1000)
  }
}

function checkPermission(permission: McpPermission): boolean {
  return DEFAULT_PERMISSIONS.includes(permission)
}

function checkCreateLimit(): boolean {
  const limit = DEFAULT_SCOPE.maxCreateCount ?? 3
  return createCountThisSession < limit
}

server.tool(
  'dashboard_create_widget',
  'Create a new widget component for the Daily. This generates a React component file, registers it in the builtIn registry, adds it to the WidgetContainer render switch, and adds it to the AddWidgetMenu. The widget will be available immediately after the dev server hot-reloads.',
  {
    widgetType: z.string().describe('Unique identifier for the widget, in camelCase (e.g. "todoList", "weatherCard")'),
    displayName: z.string().describe('Human-readable name shown in UI (e.g. "待办列表", "天气卡片")'),
    description: z.string().describe('Short description of what the widget does'),
    icon: z.string().default('📋').describe('Emoji icon for the widget'),
    width: z.number().default(350).describe('Default width in pixels'),
    height: z.number().default(300).describe('Default height in pixels'),
    minW: z.number().default(200).describe('Minimum width in pixels'),
    minH: z.number().default(150).describe('Minimum height in pixels'),
    defaultState: z.record(z.unknown()).default({}).describe('Default state object for the widget'),
    customCode: z.string().optional().describe('Custom React component code. If provided, this will be used instead of the generated template. Must export default a function component with Props: { widgetId: string; state: Record<string, unknown>; onUpdateState: (partial: Record<string, unknown>) => void }'),
  },
  async (params) => {
    if (!checkPermission('widget:create')) {
      return {
        content: [{ type: 'text', text: 'Error: Permission denied. widget:create is not allowed in current session.' }],
        isError: true,
      }
    }
    if (!checkCreateLimit()) {
      return {
        content: [{ type: 'text', text: `Error: Create limit reached (${DEFAULT_SCOPE.maxCreateCount} per session). This is a safety measure.` }],
        isError: true,
      }
    }

    if (widgetFileExists(params.widgetType)) {
      return {
        content: [{ type: 'text', text: `Error: Widget "${params.widgetType}" already exists. Use dashboard_update_widget to modify it, or dashboard_delete_widget first.` }],
        isError: true,
      }
    }

    const code = params.customCode || generateBasicWidgetCode({
      widgetType: params.widgetType,
      displayName: params.displayName,
      defaultState: params.defaultState,
      description: params.description,
    })

    const filePath = writeWidgetFile(params.widgetType, code)
    const regResult = registerInBuiltIn({
      widgetType: params.widgetType,
      displayName: params.displayName,
      icon: params.icon,
      width: params.width,
      height: params.height,
      minW: params.minW,
      minH: params.minH,
      defaultState: params.defaultState,
    })
    const containerResult = registerInContainer(params.widgetType)
    const menuResult = registerInAddMenu(params.widgetType, params.displayName, params.description)

    createCountThisSession++
    addAuditEntry('widget:create', params.widgetType, undefined, { widgetType: params.widgetType, displayName: params.displayName })

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: true,
          widgetType: params.widgetType,
          files: {
            component: filePath,
            registry: regResult,
            container: containerResult,
            menu: menuResult,
          },
          message: `Widget "${params.displayName}" created successfully. The dev server should hot-reload automatically.`,
        }, null, 2),
      }],
    }
  }
)

server.tool(
  'dashboard_create_api_widget',
  'Create a widget that integrates with an external API or CLI service. Generates a full-featured component with: endpoint selector, parameter inputs, execute button, results display, and raw response viewer. Perfect for integrating services like Xiaohongshu CLI, GitHub API, etc. The widget communicates with a backend API proxy that wraps the actual CLI/API calls.',
  {
    widgetType: z.string().describe('Unique identifier (e.g. "xiaohongshu", "githubIssues")'),
    displayName: z.string().describe('Human-readable name (e.g. "小红书", "GitHub Issues")'),
    description: z.string().describe('What this widget does'),
    icon: z.string().default('🔌').describe('Emoji icon'),
    width: z.number().default(400).describe('Default width'),
    height: z.number().default(450).describe('Default height'),
    minW: z.number().default(300).describe('Minimum width'),
    minH: z.number().default(300).describe('Minimum height'),
    apiEndpoints: z.array(z.object({
      name: z.string().describe('Endpoint display name (e.g. "搜索笔记", "获取评论")'),
      method: z.string().default('GET').describe('HTTP method (GET, POST, etc.)'),
      path: z.string().describe('API path (e.g. "/api/xhs/search", "/api/github/issues")'),
      description: z.string().describe('What this endpoint does'),
    })).describe('List of API endpoints this widget will call'),
    apiBaseUrl: z.string().default('http://localhost:3100').describe('Default API base URL for the backend proxy'),
    customCode: z.string().optional().describe('Custom component code overriding the generated API widget template'),
  },
  async (params) => {
    if (widgetFileExists(params.widgetType)) {
      return {
        content: [{ type: 'text', text: `Error: Widget "${params.widgetType}" already exists.` }],
        isError: true,
      }
    }

    const defaultState: Record<string, unknown> = {
      apiBaseUrl: params.apiBaseUrl,
      savedResults: [],
    }

    const code = params.customCode || generateApiWidgetCode({
      widgetType: params.widgetType,
      displayName: params.displayName,
      description: params.description,
      apiEndpoints: params.apiEndpoints,
      defaultState,
    })

    const filePath = writeWidgetFile(params.widgetType, code)
    const regResult = registerInBuiltIn({
      widgetType: params.widgetType,
      displayName: params.displayName,
      icon: params.icon,
      width: params.width,
      height: params.height,
      minW: params.minW,
      minH: params.minH,
      defaultState,
    })
    const containerResult = registerInContainer(params.widgetType)
    const menuResult = registerInAddMenu(params.widgetType, params.displayName, params.description)

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: true,
          widgetType: params.widgetType,
          files: {
            component: filePath,
            registry: regResult,
            container: containerResult,
            menu: menuResult,
          },
          note: `This widget requires a backend API proxy at ${params.apiBaseUrl}. You need to set up a separate API server that wraps the CLI/API calls and exposes them as REST endpoints. The widget will call these endpoints from the browser.`,
          endpoints: params.apiEndpoints.map(e => `${e.method} ${e.path}`),
          message: `API widget "${params.displayName}" created. Set up the backend proxy and configure apiBaseUrl via right-click > Edit on the widget.`,
        }, null, 2),
      }],
    }
  }
)

server.tool(
  'dashboard_list_widgets',
  'List all existing widget components in the Daily project, including their type, display name, and registration status.',
  {},
  async () => {
    const widgets = listExistingWidgets()
    const details = widgets.map(w => ({
      type: w.type,
      name: w.name,
      file: w.file,
      registeredInBuiltIn: isRegisteredInBuiltIn(w.type),
      importedInContainer: isImportedInContainer(w.type),
    }))
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({ total: details.length, widgets: details }, null, 2),
      }],
    }
  }
)

server.tool(
  'dashboard_read_widget',
  'Read the source code of an existing widget component.',
  {
    widgetType: z.string().describe('The widget type identifier'),
  },
  async (params) => {
    const source = readWidgetSource(params.widgetType)
    if (!source) {
      return {
        content: [{ type: 'text', text: `Widget "${params.widgetType}" not found.` }],
        isError: true,
      }
    }
    return {
      content: [{ type: 'text', text: source }],
    }
  }
)

server.tool(
  'dashboard_update_widget',
  'Update the source code of an existing widget component. Only modifies the component file, not the registry or container.',
  {
    widgetType: z.string().describe('The widget type identifier'),
    code: z.string().describe('The new React component source code. Must export default a function component with Props: { widgetId: string; state: Record<string, unknown>; onUpdateState: (partial: Record<string, unknown>) => void }'),
  },
  async (params) => {
    if (!checkPermission('widget:delete')) {
      return {
        content: [{ type: 'text', text: 'Error: Permission denied. widget:delete is not allowed by default. This is a safety measure to prevent accidental data loss. If you really need to delete, ask the user to confirm and they can delete from the UI.' }],
        isError: true,
      }
    }

    if (!widgetFileExists(params.widgetType)) {
      return {
        content: [{ type: 'text', text: `Widget "${params.widgetType}" not found. Use dashboard_create_widget first.` }],
        isError: true,
      }
    }
    const filePath = writeWidgetFile(params.widgetType, params.code)
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: true,
          widgetType: params.widgetType,
          file: filePath,
          message: 'Widget updated. Dev server should hot-reload.',
        }, null, 2),
      }],
    }
  }
)

server.tool(
  'dashboard_delete_widget',
  'Delete a widget component and remove it from the registry, container, and menu. This is destructive and cannot be undone.',
  {
    widgetType: z.string().describe('The widget type identifier to delete'),
  },
  async (params) => {
    if (!widgetFileExists(params.widgetType)) {
      return {
        content: [{ type: 'text', text: `Widget "${params.widgetType}" not found.` }],
        isError: true,
      }
    }
    const deleted = deleteWidgetFiles(params.widgetType)
    addAuditEntry('widget:delete', params.widgetType, { widgetType: params.widgetType }, undefined)
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: true,
          widgetType: params.widgetType,
          deleted,
          message: 'Widget deleted. Dev server should hot-reload.',
        }, null, 2),
      }],
    }
  }
)

server.tool(
  'dashboard_get_project_info',
  'Get information about the Daily project structure, including paths to key files and directories.',
  {},
  async () => {
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          projectRoot: PROJECT_ROOT,
          keyPaths: {
            widgetsDir: WIDGETS_DIR,
            registryFile: REGISTRY_FILE,
            containerFile: CONTAINER_FILE,
            addMenuFile: ADD_MENU_FILE,
          },
          existingWidgets: listExistingWidgets().map(w => w.type),
          widgetComponentPattern: 'src/components/widgets/{PascalName}.tsx',
          propsInterface: 'interface Props { widgetId: string; state: Record<string, unknown>; onUpdateState: (partial: Record<string, unknown>) => void }',
        }, null, 2),
      }],
    }
  }
)

server.tool(
  'dashboard_get_audit_log',
  'Get the MCP audit log for this session. Shows all widget:create and widget:delete operations performed by MCP.',
  {
    limit: z.number().default(20).describe('Maximum number of entries to return'),
  },
  async (params) => {
    const entries = auditLog.slice(-params.limit)
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          totalEntries: auditLog.length,
          showing: entries.length,
          createCountThisSession,
          createLimit: DEFAULT_SCOPE.maxCreateCount,
          defaultPermissions: DEFAULT_PERMISSIONS,
          entries,
        }, null, 2),
      }],
    }
  }
)

server.tool(
  'dashboard_mcp_undo',
  'Undo the most recent MCP-initiated single-widget structural operation (create only). Does NOT support undo of delete or writeState. This is a safety measure.',
  {},
  async () => {
    const createEntries = [...auditLog].reverse().filter(e => e.action === 'widget:create')
    if (createEntries.length === 0) {
      return {
        content: [{ type: 'text', text: 'No MCP create operations to undo.' }],
      }
    }

    const lastCreate = createEntries[0]
    const widgetType = lastCreate.target

    if (!widgetFileExists(widgetType)) {
      return {
        content: [{ type: 'text', text: `Widget "${widgetType}" no longer exists, nothing to undo.` }],
      }
    }

    const deleted = deleteWidgetFiles(widgetType)
    addAuditEntry('mcp:undo', widgetType, { originalAction: 'widget:create' }, undefined)
    createCountThisSession = Math.max(0, createCountThisSession - 1)

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: true,
          undoneAction: 'widget:create',
          widgetType,
          deleted,
          message: `Undone: widget "${widgetType}" creation has been reverted.`,
        }, null, 2),
      }],
    }
  }
)

async function main() {
  const transport = new StdioServerTransport()
  await server.connect(transport)
}

main().catch(console.error)
