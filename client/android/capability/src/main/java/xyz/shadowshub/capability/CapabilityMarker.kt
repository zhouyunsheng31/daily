package xyz.shadowshub.capability

/**
 * capability：权限能力层（Tier0 标准模式 / Tier1 Shizuku 增强）。
 * - capability matrix 上报 bootstrap
 * - 工具多实现优雅降级，不满足只报 unavailable
 * M1-5（权限 Tier0）时填充；M0-1 仅建模块。
 */
object CapabilityMarker