import type { ComponentType } from 'react'
import type { WidgetProps, DynamicWidgetDef, WidgetConfig } from '../types'
import * as React from 'react'
import * as lucideIcons from 'lucide-react'
import { registerWidget } from '../registry'

export function evaluateDynamicComponent(code: string): ComponentType<WidgetProps> | null {
  try {
    const wrappedCode = `
      const { useState, useEffect, useCallback, useRef, useMemo } = React;
      const exports = {};
      ${code}
      return exports.default;
    `
    const factory = new Function('React', '__lucide', wrappedCode)
    const Component = factory(React, lucideIcons)
    if (typeof Component !== 'function') {
      console.error('Dynamic widget code did not export a function')
      return null
    }
    return Component
  } catch (err) {
    console.error('Failed to evaluate dynamic widget:', err)
    return null
  }
}

export function registerDynamicWidget(def: DynamicWidgetDef): boolean {
  const Component = evaluateDynamicComponent(def.code)
  if (!Component) return false

  const config: WidgetConfig = {
    widgetType: def.widgetType,
    displayName: def.displayName,
    icon: def.icon,
    defaultLayout: def.defaultLayout,
    defaultState: def.defaultState,
    component: Component,
    serialize: (state) => state,
    deserialize: (data) => data,
    isDynamic: true,
  }

  registerWidget(config)
  return true
}

export function loadAndRegisterDynamicWidgets(defs: DynamicWidgetDef[]): void {
  for (const def of defs) {
    registerDynamicWidget(def)
  }
}
