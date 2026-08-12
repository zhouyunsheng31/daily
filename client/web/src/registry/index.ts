import type { WidgetConfig } from '../types'

const registry = new Map<string, WidgetConfig>()

export function registerWidget(config: WidgetConfig): void {
  if (registry.has(config.widgetType)) {
    console.warn(`Widget type "${config.widgetType}" is already registered. Overwriting.`)
  }
  registry.set(config.widgetType, config)
}

export function unregisterWidget(widgetType: string): void {
  registry.delete(widgetType)
}

export function getWidgetConfig(widgetType: string): WidgetConfig | undefined {
  return registry.get(widgetType)
}

export function getAllWidgetConfigs(): WidgetConfig[] {
  return Array.from(registry.values())
}

export function getDynamicWidgetConfigs(): WidgetConfig[] {
  return Array.from(registry.values()).filter(c => c.isDynamic)
}

export function getBuiltInWidgetConfigs(): WidgetConfig[] {
  return Array.from(registry.values()).filter(c => !c.isDynamic)
}
