/**
 * API 配置预设类型（Phase 8 批次2 模块 E）
 *
 * 一个 ApiConfigPreset 表示一组完整的 LLM API 配置：
 * endpoint + apiKey + models 列表，可在多预设之间切换。
 *
 * Phase 9 批次1（Bug J 修复）：
 * - 新增 provider 字段（可选，向后兼容），关联到 apiKeyStore 的 provider 标识
 * - apiKey 字段保留（可选），用于向后兼容旧版 localStorage 数据
 *   新版数据 apiKey 应为空字符串，真实 apiKey 存在主进程 safeStorage 中
 */
export interface ApiConfigPreset {
  id: string
  /** 配置名称（如 "DeepSeek 官方"） */
  name: string
  /** API endpoint URL */
  endpoint: string
  /**
   * API Key（向后兼容字段）
   *
   * Phase 9 后：
   * - 新版数据此字段应为空字符串，真实 apiKey 存在主进程 safeStorage 中
   * - 旧版数据此字段可能含明文 apiKey，migrateLegacyPresets 会迁移到 safeStorage 并清空
   * - 运行时需要 apiKey 时，优先调 window.aiKeyApi.getApiKey(provider)
   */
  apiKey: string
  /** provider 标识（Phase 9 新增，可选，向后兼容），关联到 apiKeyStore */
  provider?: string
  /** 该配置支持的 model 列表 */
  models: string[]
  createdAt: number
  updatedAt: number
}
