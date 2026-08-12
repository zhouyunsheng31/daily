import type { WidgetDefinitionV2A, ValidationResult, JSONValue } from '../types/v2'

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function str(v: unknown, fallback: string): string {
  return typeof v === 'string' ? v : fallback
}

function num(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback
}

function nullableNum(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

function checkSchemaVersion(raw: Record<string, unknown>): string | null {
  if (!('schemaVersion' in raw)) return 'missing schemaVersion'
  if (raw.schemaVersion !== 1) return `unsupported schemaVersion: ${raw.schemaVersion}`
  return null
}

interface HtmlCanvasWidgetState {
  html: string
  title: string
  createdAt: number
  updatedAt: number
  agentWidth?: number
  agentHeight?: number
  schemaVersion: 1
}

const htmlCanvasWidgetDef: WidgetDefinitionV2A<HtmlCanvasWidgetState> = {
  type: 'htmlCanvas',
  widgetVersion: '1.0.0',
  stateVersion: 1,
  category: 'ai',
  capabilities: { aiReadable: true, aiWritable: true, connectable: false, exportable: true },
  createDefaultState(): HtmlCanvasWidgetState {
    return { html: '', title: 'HTML Widget', createdAt: 0, updatedAt: 0, schemaVersion: 1 }
  },
  validateState(raw: unknown): ValidationResult<HtmlCanvasWidgetState> {
    const def = this.createDefaultState()
    if (!isObject(raw)) return { ok: false, fallbackState: def, errors: ['state is not an object'] }
    const err = checkSchemaVersion(raw)
    if (err) return { ok: false, fallbackState: def, errors: [err] }
    return {
      ok: true,
      state: {
        html: str(raw.html, def.html),
        title: str(raw.title, def.title),
        createdAt: num(raw.createdAt, def.createdAt),
        updatedAt: num(raw.updatedAt, def.updatedAt),
        agentWidth: nullableNum(raw.agentWidth) ?? def.agentWidth,
        agentHeight: nullableNum(raw.agentHeight) ?? def.agentHeight,
        schemaVersion: 1,
      },
    }
  },
  normalizeStateForSave(state: HtmlCanvasWidgetState): JSONValue {
    return { ...state }
  },
  normalizeState(raw: unknown): HtmlCanvasWidgetState {
    const def = this.createDefaultState()
    if (!isObject(raw)) return def
    return {
      html: (raw.html as string) ?? def.html,
      title: (raw.title as string) ?? def.title,
      createdAt: (raw.createdAt as number) ?? def.createdAt,
      updatedAt: (raw.updatedAt as number) ?? def.updatedAt,
      agentWidth: nullableNum(raw.agentWidth) ?? def.agentWidth,
      agentHeight: nullableNum(raw.agentHeight) ?? def.agentHeight,
      schemaVersion: 1,
    }
  },
  getAISummary(state: HtmlCanvasWidgetState): string {
    return `HTML Widget: ${state.title || '(无标题)'}, 内容长度=${state.html.length}`
  },
  migrateState(oldState: unknown, fromVersion: number): HtmlCanvasWidgetState {
    if (fromVersion === this.stateVersion) return oldState as HtmlCanvasWidgetState
    return this.normalizeState ? this.normalizeState(oldState) : this.createDefaultState()
  },
  lifecycle: {},
}

const allDefinitions: WidgetDefinitionV2A[] = [
  htmlCanvasWidgetDef,
]

export const widgetDefinitionMap: Map<string, WidgetDefinitionV2A> = new Map(
  allDefinitions.map(d => [d.type, d]),
)
