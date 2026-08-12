// ============================================================================
// Phase 14.4.5：客户端组件能力注册表（spec 14.4.5 节）
// 组件启动时调用 registerCapability 声明自身能力，
// main.tsx bootstrap 调用 syncCapabilitiesToServer() 同步到服务器
// ============================================================================

import type { ComponentCapability } from 'shared/types/componentCapability'

const capabilityRegistry = new Map<string, ComponentCapability>()

/**
 * 注册组件能力声明（重复注册同 widgetType 会覆盖）
 */
export function registerCapability(cap: ComponentCapability): void {
  if (capabilityRegistry.has(cap.widgetType)) {
    console.warn(`[capabilityRegistry] "${cap.widgetType}" already registered, overwriting.`)
  }
  capabilityRegistry.set(cap.widgetType, cap)
}

/**
 * 获取单个组件能力声明
 */
export function getCapability(widgetType: string): ComponentCapability | undefined {
  return capabilityRegistry.get(widgetType)
}

/**
 * 获取所有已注册组件能力声明
 */
export function getAllCapabilities(): ComponentCapability[] {
  return Array.from(capabilityRegistry.values())
}

/**
 * 同步所有已注册组件能力声明到服务器（upsert 模式）
 * 在 main.tsx bootstrap 中调用，失败不阻塞启动
 */
export async function syncCapabilitiesToServer(): Promise<void> {
  const caps = getAllCapabilities()
  if (caps.length === 0) {
    console.log('[capabilityRegistry] no capabilities to sync')
    return
  }

  console.log(`[capabilityRegistry] syncing ${caps.length} capabilities to server...`)
  let success = 0
  let failed = 0

  for (const cap of caps) {
    try {
      const resp = await fetch('/api/component-capabilities', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cap),
      })
      if (resp.ok) {
        success++
      } else {
        failed++
        console.warn(
          `[capabilityRegistry] sync "${cap.widgetType}" failed: HTTP ${resp.status}`,
        )
      }
    } catch (err) {
      failed++
      console.warn(`[capabilityRegistry] sync "${cap.widgetType}" error:`, err)
    }
  }

  console.log(
    `[capabilityRegistry] sync done: ${success} success, ${failed} failed (total ${caps.length})`,
  )
}
