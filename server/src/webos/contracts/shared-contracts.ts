// server/src/webos/contracts/shared-contracts.ts
// ----------------------------------------------------------------------------
// 从 shared/webos-contracts/packages/capabilities.json 快照导入能力词汇表，
// 供服务端校验器（index.ts）做语义校验。快照由 gen-contract-schemas.mjs 生成并
// 提交 Git；词汇表本体的唯一事实源是 shared/webos-contracts/packages/capabilities.ts。
// 此文件避免 server/src 直接 import shared 的 .ts（rootDir=./src 限制）。
// ============================================================================

import capabilitiesJson from '../../../../shared/webos-contracts/packages/capabilities.json' with { type: 'json' }

export type WebOsCapabilityAvailability = 'available' | 'unavailable' | 'mobile-only'

export interface WebOsCapabilityDef {
  id: string
  web: WebOsCapabilityAvailability
  desc: string
  phase?: string
}

export const WEBOS_CAPABILITIES = capabilitiesJson as readonly WebOsCapabilityDef[]

export const WEBOS_CAPABILITY_IDS: readonly string[] = WEBOS_CAPABILITIES.map((c) => c.id)

export const PACKAGE_CHILDREN_MAX_DEPTH = 3

export function isWebOsCapability(id: string): boolean {
  return WEBOS_CAPABILITY_IDS.includes(id)
}

export function isWebOsCapabilityAvailable(id: string): boolean {
  const def = WEBOS_CAPABILITIES.find((c) => c.id === id)
  return def?.web === 'available'
}