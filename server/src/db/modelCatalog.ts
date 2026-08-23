// ============================================================================
// 模型目录（modelCatalog）
// ----------------------------------------------------------------------------
// Operit 式多模型管理体系：ai_models 表 = 模型注册表，每行一个模型，
// 自带 provider / endpoint / api_key / 能力参数（多模态、成本、上下文）。
// 管理后台 CRUD + "拉取模型列表"自动导入；用户前端可切换。
// ============================================================================
import { getPool } from './connection.js'
import { randomUUID } from 'crypto'

/** 模型能力参数（存 ai_models.params JSON） */
export interface ModelParams {
  /** 多模态：true 表示原生支持图像/视频输入（无需识图功能模型桥接） */
  multimodal?: boolean
  /** 成本（元/百万 token），用于计费：成本 × CHAT_SALES_RATIO = 售价 */
  costInputPerMillion?: number
  costOutputPerMillion?: number
  costCacheReadPerMillion?: number
  /** 上下文窗口与最大输出 token（展示用） */
  contextWindow?: number
  maxTokens?: number
  /** 是否支持思考强度档位 */
  supportsThinking?: boolean
  /** 前端展示备注 */
  note?: string
}

export interface CatalogModel {
  id: string
  name: string
  provider: string
  endpoint: string | null
  model: string
  apiKeyMasked: string
  hasApiKey: boolean
  params: ModelParams
  enabled: boolean
  isDefault: boolean
  createdAt: number
  updatedAt: number
}

interface ModelRow {
  id: string
  name: string
  provider: string
  endpoint: string | null
  model: string
  api_key: string | null
  params: string
  enabled: number | boolean
  is_default: number | boolean
  created_at: number
  updated_at: number
}

function toCatalogModel(row: ModelRow): CatalogModel {
  let params: ModelParams = {}
  try {
    const parsed = JSON.parse(row.params || '{}')
    if (parsed && typeof parsed === 'object') params = parsed
  } catch { /* 参数损坏时回退空对象 */ }
  const key = row.api_key || ''
  const masked = key.length <= 8 ? '****' : `${key.slice(0, 4)}...${key.slice(-4)}`
  return {
    id: row.id,
    name: row.name,
    provider: row.provider,
    endpoint: row.endpoint || null,
    model: row.model,
    apiKeyMasked: masked,
    hasApiKey: Boolean(key),
    params,
    enabled: typeof row.enabled === 'number' ? row.enabled !== 0 : !!row.enabled,
    isDefault: typeof row.is_default === 'number' ? row.is_default !== 0 : !!row.is_default,
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  }
}

/** 列出全部模型（含禁用），默认按 enabled DESC、is_default DESC、created_at ASC */
export async function listModels(): Promise<CatalogModel[]> {
  const pool = getPool()
  const result = await pool.query(
    'SELECT * FROM ai_models ORDER BY enabled DESC, is_default DESC, created_at ASC',
  )
  return result.rows.map((row) => toCatalogModel(row as ModelRow))
}

/** 仅启用的模型（供 piBridge 注册 / 用户前端选择） */
export async function listEnabledModels(): Promise<CatalogModel[]> {
  const pool = getPool()
  const result = await pool.query('SELECT * FROM ai_models WHERE enabled = TRUE ORDER BY is_default DESC, created_at ASC')
  return result.rows.map((row) => toCatalogModel(row as ModelRow))
}

/**
 * 服务端注册用：返回启用的模型明文配置（含完整 api_key，仅限进程内部使用，
 * 严禁通过 HTTP 暴露）。piBridge 启动/创建会话时按 provider 分组注册。
 */
export async function listEnabledModelsForRegistry(): Promise<Array<{
  id: string
  name: string
  provider: string
  endpoint: string | null
  model: string
  apiKey: string
  params: ModelParams
}>> {
  const pool = getPool()
  const result = await pool.query('SELECT * FROM ai_models WHERE enabled = TRUE ORDER BY is_default DESC, created_at ASC')
  return result.rows.map((row) => {
    const r = row as ModelRow
    let params: ModelParams = {}
    try {
      const parsed = JSON.parse(r.params || '{}')
      if (parsed && typeof parsed === 'object') params = parsed
    } catch { /* ignore */ }
    return {
      id: r.id,
      name: r.name,
      provider: r.provider,
      endpoint: r.endpoint || null,
      model: r.model,
      apiKey: r.api_key || '',
      params,
    }
  })
}

/** 默认模型（is_default=1 且 enabled），无则取第一个启用的 */
export async function getDefaultModel(): Promise<CatalogModel | null> {
  const pool = getPool()
  const result = await pool.query(
    'SELECT * FROM ai_models WHERE enabled = TRUE ORDER BY is_default DESC, created_at ASC LIMIT 1',
  )
  return result.rows.length > 0 ? toCatalogModel(result.rows[0] as ModelRow) : null
}

export async function getModelById(id: string): Promise<CatalogModel | null> {
  const pool = getPool()
  const result = await pool.query('SELECT * FROM ai_models WHERE id = $1', [id])
  return result.rows.length > 0 ? toCatalogModel(result.rows[0] as ModelRow) : null
}

export interface UpsertModelInput {
  id?: string
  name: string
  provider: string
  endpoint?: string | null
  model: string
  apiKey?: string | null
  params?: ModelParams
  enabled?: boolean
  isDefault?: boolean
}

/** 新增或更新模型；apiKey 不传/为空时保留原值（编辑场景） */
export async function upsertModel(input: UpsertModelInput): Promise<CatalogModel> {
  const pool = getPool()
  const now = Date.now()
  const paramsJson = JSON.stringify(input.params ?? {})
  const enabled = input.enabled ?? true
  const isDefault = input.isDefault ?? false

  if (input.id) {
    const existing = await getModelById(input.id)
    if (!existing) throw new Error(`model not found: ${input.id}`)
    const apiKey = input.apiKey !== undefined && input.apiKey !== null && input.apiKey !== ''
      ? input.apiKey
      : null // 编辑时未传 key → 保留原密文（由调用方决定是否覆盖）
    await pool.query(
      `UPDATE ai_models SET
         name = $1, provider = $2, endpoint = $3, model = $4,
         api_key = COALESCE($5, api_key), params = $6, enabled = $7, is_default = $8,
         updated_at = $9
       WHERE id = $10`,
      [input.name, input.provider, input.endpoint || null, input.model,
       apiKey, paramsJson, enabled ? 1 : 0, isDefault ? 1 : 0, now, input.id],
    )
  } else {
    const apiKey = input.apiKey ?? ''
    await pool.query(
      `INSERT INTO ai_models (id, name, provider, endpoint, model, api_key, params, enabled, is_default, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [randomUUID(), input.name, input.provider, input.endpoint || null, input.model,
       apiKey, paramsJson, enabled ? 1 : 0, isDefault ? 1 : 0, now, now],
    )
  }

  if (isDefault) {
    // 唯一默认：清除其他默认标记
    const all = await listModels()
    for (const m of all) {
      if (m.isDefault && (!input.id || m.id !== input.id)) {
        await pool.query('UPDATE ai_models SET is_default = 0, updated_at = $1 WHERE id = $2', [now, m.id])
      }
    }
  }

  const result = await pool.query(
    'SELECT * FROM ai_models WHERE name = $1 AND provider = $2 AND model = $3 ORDER BY created_at DESC LIMIT 1',
    [input.name, input.provider, input.model],
  )
  return toCatalogModel(result.rows[0] as ModelRow)
}

export async function deleteModel(id: string): Promise<boolean> {
  const pool = getPool()
  const result = await pool.query('DELETE FROM ai_models WHERE id = $1 RETURNING id', [id])
  return result.rows.length > 0
}

export async function setModelDefault(id: string): Promise<CatalogModel | null> {
  const pool = getPool()
  const existing = await getModelById(id)
  if (!existing) return null
  await pool.query('UPDATE ai_models SET is_default = 0, updated_at = $1', [Date.now()])
  await pool.query('UPDATE ai_models SET is_default = 1, updated_at = $1 WHERE id = $2', [Date.now(), id])
  return getModelById(id)
}

export async function setModelEnabled(id: string, enabled: boolean): Promise<CatalogModel | null> {
  const pool = getPool()
  await pool.query('UPDATE ai_models SET enabled = $1, updated_at = $2 WHERE id = $3', [enabled ? 1 : 0, Date.now(), id])
  return getModelById(id)
}

// ---------------------------------------------------------------------------
// 种子数据：首次启动（目录为空）时写入默认模型
// - chatst / gemini-3.7-flash（多模态，ChatST 网关）
// - deepseek / deepseek-v4-flash（zen 网关，默认）
// - deepseek / deepseek-v4-pro
// ---------------------------------------------------------------------------
export async function seedModelsIfEmpty(): Promise<void> {
  const pool = getPool()
  const countResult = await pool.query('SELECT COUNT(*) as cnt FROM ai_models')
  if (Number(countResult.rows[0].cnt) > 0) return

  const now = Date.now()
  const zenKey = process.env.DEEPSEEK_API_KEY?.trim() ?? ''
  const chatstGatewayKey = 'sk-Fxvm0LjrVwpUOqyXwCkfbQn62rotB0Xj8b1Srf4J3rziOOHA'
  const visionKey = process.env.DEEPSEEK_VISION_API_KEY?.trim() ?? ''

  const models: Array<[string, string, string, string, string, ModelParams, boolean]> = [
    // name, provider, endpoint, model, apiKey, params, isDefault
    ['DeepSeek V4 Flash', 'deepseek', process.env.DEEPSEEK_BASE_URL ?? 'https://opencode.ai/zen/go/v1', 'deepseek-v4-flash', zenKey,
     { costInputPerMillion: 0.14, costOutputPerMillion: 0.28, costCacheReadPerMillion: 0.0028, contextWindow: 1_000_000, maxTokens: 384_000, multimodal: false, supportsThinking: true },
     true],
    ['DeepSeek V4 Pro', 'deepseek', process.env.DEEPSEEK_BASE_URL ?? 'https://opencode.ai/zen/go/v1', 'deepseek-v4-pro', zenKey,
     { costInputPerMillion: 0.435, costOutputPerMillion: 0.87, costCacheReadPerMillion: 0.003625, contextWindow: 1_000_000, maxTokens: 384_000, multimodal: false, supportsThinking: true },
     false],
    ['Gemini 3.7 Flash（多模态）', 'chatst', 'https://api.chatst.org/v1', 'gemini-3.7-flash', chatstGatewayKey,
     { costInputPerMillion: 0.14, costOutputPerMillion: 0.28, costCacheReadPerMillion: 0.0028, contextWindow: 1_000_000, maxTokens: 384_000, multimodal: true, supportsThinking: true, note: '原生多模态，图片/视频直接理解' },
     false],
  ]
  for (const [name, provider, endpoint, model, apiKey, params, isDefault] of models) {
    await pool.query(
      `INSERT INTO ai_models (id, name, provider, endpoint, model, api_key, params, enabled, is_default, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [randomUUID(), name, provider, endpoint, model, apiKey, JSON.stringify(params), 1, isDefault ? 1 : 0, now, now],
    )
  }
  console.log(`[ModelCatalog] Seeded ${models.length} default models (chatst gemini-3.7-flash + deepseek zen)`)
  void visionKey // 预留：识图功能模型走独立链路，不入目录
}