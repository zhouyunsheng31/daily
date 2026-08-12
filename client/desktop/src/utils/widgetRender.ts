import type {
  LoadedWidgetState,
  WidgetDefinitionV2A,
  WidgetDisplayMode,
  WidgetRenderStatus,
  DiagnosticIssueKind,
} from '../types/v2'

export function resolveWidgetDisplayMode(params: {
  widgetType: string
  loadedState: LoadedWidgetState
  definition: WidgetDefinitionV2A | undefined
}): WidgetDisplayMode {
  const { loadedState, definition } = params

  if (loadedState.kind === 'missing') {
    if (definition) {
      return { kind: 'render', status: 'missing_state' }
    }
    return { kind: 'render', status: 'unknown_type' }
  }

  if (loadedState.kind === 'invalid') {
    return { kind: 'render', status: 'bad_state' }
  }

  if (loadedState.kind === 'legacy') {
    if (definition) {
      return { kind: 'render', status: 'ok' }
    }
    return { kind: 'render', status: 'unknown_type' }
  }

  if (loadedState.kind === 'envelope') {
    if (!definition) {
      return { kind: 'render', status: 'unknown_type' }
    }
    if (loadedState.envelope.widgetType !== definition.type) {
      return { kind: 'render', status: 'unknown_type' }
    }
    if (loadedState.envelope.stateVersion > definition.stateVersion) {
      return { kind: 'render', status: 'incompatible_state_version' }
    }
    const validation = definition.validateState(loadedState.envelope.state)
    if (validation.ok) {
      return { kind: 'render', status: 'ok' }
    }
    return { kind: 'render', status: 'bad_state' }
  }

  return { kind: 'render', status: 'unknown_type' }
}

export function getEffectiveState<T>(
  loadedState: LoadedWidgetState,
  definition: WidgetDefinitionV2A<T>,
): T {
  if (loadedState.kind === 'envelope') {
    const validation = definition.validateState(loadedState.envelope.state)
    if (validation.ok) {
      return validation.state
    }
    return validation.fallbackState
  }

  if (loadedState.kind === 'legacy') {
    const validation = definition.validateState(loadedState.raw)
    if (validation.ok) {
      return validation.state
    }
    return definition.createDefaultState()
  }

  if (loadedState.kind === 'missing') {
    return definition.createDefaultState()
  }

  return definition.createDefaultState()
}

export function shouldAutoCreateState(displayMode: WidgetDisplayMode): boolean {
  return displayMode.kind === 'render' && displayMode.status === 'missing_state'
}

export function isRenderableStatus(status: WidgetRenderStatus): boolean {
  return status === 'ok' || status === 'missing_state' || status === 'bad_state'
}

export function getDiagnosticDisplayForStatus(
  status: WidgetRenderStatus,
): DiagnosticIssueKind | null {
  if (status === 'bad_state') return 'widget_state_repair_failed'
  if (status === 'unknown_type') return 'widget_record_missing'
  return null
}
