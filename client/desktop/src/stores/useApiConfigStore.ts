/**
 * API 配置预设 Store（Phase 8 批次2 模块 E）
 *
 * 多预设版本的 API 配置管理：
 * - presets: ApiConfigPreset[]，支持 CRUD
 * - activePresetId: 全局默认预设
 * - addModel/removeModel: 操作 preset.models 数组
 *
 * 持久化：
 * - presets → localStorage key 'ai-api-config-presets'（endpoint/model 等非敏感配置）
 * - activePresetId → localStorage key 'ai-api-config-active-preset'
 * - apiKey → Phase 9 后存主进程 safeStorage（通过 window.aiKeyApi），不再存 localStorage
 *
 * 初始化：从 localStorage 加载，若无数据用 DEFAULT_PRESETS。
 *
 * Phase 9 批次1（Bug J 修复）：
 * - 新增 migrateLegacyPresets()：迁移旧版明文 apiKey 到 safeStorage
 * - 新增 saveApiKey(presetId, apiKey)：保存 apiKey 到 safeStorage（Electron 环境）
 * - 新增 resolveApiKey(presetId)：从 safeStorage 读取 apiKey
 * - 保留 apiKey 字段（向后兼容），但新版数据应为空字符串
 */
import { create } from 'zustand'
import { v4 as uuidv4 } from 'uuid'
import type { ApiConfigPreset } from '../types/apiConfig'
import { api } from '../api/client'

const PRESETS_KEY = 'ai-api-config-presets'
const ACTIVE_KEY = 'ai-api-config-active-preset'

const DEFAULT_PRESETS: ApiConfigPreset[] = [
  {
    id: 'default-deepseek',
    name: 'DeepSeek 官方',
    endpoint: 'https://api.deepseek.com/v1/chat/completions',
    apiKey: '',
    provider: 'deepseek',
    // Phase 13.2.3 B2：pi-coding-agent 内置 deepseek provider 仅支持 V4 系列
    models: ['deepseek-v4-flash', 'deepseek-v4-pro'],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  },
]

/**
 * 根据 endpoint 推断 provider 标识（Phase 13.2.3 B2 调研结论对齐）
 *
 * pi-coding-agent ^0.79.10 内置 provider：anthropic / openai / deepseek / google
 * （无 qwen / gemini / stepfun 等内置 provider）
 *
 * 规则：匹配 endpoint URL 中的关键字。
 * 例如：
 * - api.deepseek.com → 'deepseek'
 * - api.openai.com   → 'openai'
 * - api.anthropic.com → 'anthropic'
 * - generativelanguage.googleapis.com → 'google'
 *
 * 无法识别时降级为 'openai'（openai 兼容协议，多数第三方 API 均兼容此格式）。
 */
export function inferProviderFromEndpoint(endpoint: string): string {
  const e = endpoint.toLowerCase()
  if (e.includes('deepseek')) return 'deepseek'
  if (e.includes('openai')) return 'openai'
  if (e.includes('anthropic')) return 'anthropic'
  if (e.includes('googleapis') || e.includes('gemini') || e.includes('google')) return 'google'
  console.warn(`[useApiConfigStore] cannot infer provider from endpoint "${endpoint}", defaulting to 'openai'`)
  return 'openai'
}

/**
 * 旧版 preset 数据迁移（Bug J 修复）
 *
 * 触发场景：Phase 9 改造后 ApiConfigPreset 新增 `provider` 字段，
 * 但 localStorage 中已存的旧版 preset 数据缺 `provider` 字段且仍含明文 `apiKey` 字段，
 * 直接 parse 会让 `provider` 为 undefined 导致后续 aiKeyApi.getApiKey(provider) 调用失败。
 *
 * 迁移策略：
 * 1. 检测每个 preset 是否有 `provider` 字段
 * 2. 无则根据 `endpoint` 推断 provider（如 api.deepseek.com → 'deepseek'）
 * 3. 旧版 `apiKey` 字段若有值，调 `window.aiKeyApi.setApiKey(provider, ...)` 迁移到 safeStorage
 * 4. 清空 preset 中的 `apiKey` 字段（不再存明文，但保留字段本身向后兼容）
 * 5. 迁移后写回 localStorage
 *
 * 调用时机：useApiConfigStore 初始化时（loadPresets 内部）调用一次。
 *
 * 注：此函数为 void，内部读 localStorage、迁移、写回 localStorage。
 *    异步迁移（aiKeyApi.setApiKey）不阻塞 store 初始化。
 */
export function migrateLegacyPresets(): void {
  if (typeof window === 'undefined') return
  try {
    const raw = window.localStorage.getItem(PRESETS_KEY)
    if (!raw) return
    const parsed = JSON.parse(raw) as ApiConfigPreset[]
    if (!Array.isArray(parsed) || parsed.length === 0) return

    let changed = false
    const migrated = parsed.map((preset) => {
      // 1. 已有 provider 字段，且无遗留明文 apiKey：无需迁移
      if (preset.provider && !preset.apiKey) return preset

      const next: ApiConfigPreset = { ...preset }
      // 2. 补 provider 字段（无则根据 endpoint 推断）
      if (!next.provider) {
        next.provider = inferProviderFromEndpoint(preset.endpoint)
      }
      // 3. 旧版 apiKey 字段：迁移到 aiKeyApi（safeStorage 加密）
      //    异步迁移：不阻塞 store 初始化，主进程会处理 safeStorage 加密
      if (preset.apiKey && window.aiKeyApi) {
        void window.aiKeyApi.setApiKey(
          next.provider,
          preset.apiKey,
          preset.endpoint,
          preset.models[0] ?? '',
        ).catch((err) => {
          console.warn(`[useApiConfigStore] migrate apiKey for ${next.provider} failed:`, err)
        })
      }
      // 4. 清空 apiKey 字段（不再存明文，但保留字段本身向后兼容）
      next.apiKey = ''
      changed = true
      return next
    })

    // 5. 若有变更，写回 localStorage
    if (changed) {
      window.localStorage.setItem(PRESETS_KEY, JSON.stringify(migrated))
      console.log('[useApiConfigStore] migrated legacy presets, count=', migrated.length)
    }
  } catch (err) {
    console.error('[useApiConfigStore] migrateLegacyPresets failed:', err)
  }
}

/** 从 localStorage 读取 presets；若解析失败或为空，返回 DEFAULT_PRESETS 副本 */
function loadPresets(): ApiConfigPreset[] {
  if (typeof window === 'undefined') return cloneDefaults()
  // Phase 9 Bug J：先迁移旧版 preset（补 provider 字段 + 迁移明文 apiKey 到 safeStorage）
  migrateLegacyPresets()
  try {
    const raw = window.localStorage.getItem(PRESETS_KEY)
    if (!raw) return cloneDefaults()
    const parsed = JSON.parse(raw) as ApiConfigPreset[]
    if (!Array.isArray(parsed) || parsed.length === 0) return cloneDefaults()
    return parsed
  } catch {
    return cloneDefaults()
  }
}

/** 从 localStorage 读取 activePresetId；若不存在或不匹配 presets，返回第一个 preset 的 id */
function loadActivePresetId(presets: ApiConfigPreset[]): string {
  if (typeof window === 'undefined') return presets[0]?.id ?? ''
  const stored = window.localStorage.getItem(ACTIVE_KEY)
  if (stored && presets.some(p => p.id === stored)) return stored
  return presets[0]?.id ?? ''
}

function cloneDefaults(): ApiConfigPreset[] {
  return DEFAULT_PRESETS.map(p => ({ ...p, models: [...p.models] }))
}

function persistPresets(presets: ApiConfigPreset[]): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(PRESETS_KEY, JSON.stringify(presets))
  } catch (err) {
    console.error('[useApiConfigStore] persist presets failed:', err)
  }
}

function persistActivePreset(id: string): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(ACTIVE_KEY, id)
  } catch (err) {
    console.error('[useApiConfigStore] persist active preset failed:', err)
  }
}

export interface ApiConfigStore {
  presets: ApiConfigPreset[]
  activePresetId: string

  createPreset: (data: Omit<ApiConfigPreset, 'id' | 'createdAt' | 'updatedAt'>) => string
  updatePreset: (id: string, updates: Partial<ApiConfigPreset>) => void
  deletePreset: (id: string) => void
  getPreset: (id: string) => ApiConfigPreset | undefined
  setActivePreset: (id: string) => void

  // model 管理
  addModel: (presetId: string, model: string) => void
  removeModel: (presetId: string, model: string) => void

  // Phase 9 批次1：API Key 加密存储（safeStorage）
  /**
   * 保存 apiKey 到主进程 safeStorage（Electron 环境）
   *
   * 行为：
   * - Electron 环境（window.aiKeyApi 可用）：调 aiKeyApi.setApiKey 加密存储到 userData/ai-keys.json
   * - 非 Electron 环境（fallback）：写入 preset.apiKey 字段存 localStorage（向后兼容）
   * - 保存后会清空 preset.apiKey 字段（不再存明文，但保留字段本身向后兼容）
   *
   * @param presetId preset ID
   * @param apiKey 明文 API Key
   */
  saveApiKey: (presetId: string, apiKey: string) => Promise<void>
  /**
   * 从主进程 safeStorage 读取 apiKey（Electron 环境）
   *
   * 行为：
   * - Electron 环境（window.aiKeyApi 可用）：调 aiKeyApi.getApiKey 解密返回明文
   * - 非 Electron 环境（fallback）：返回 preset.apiKey 字段（向后兼容）
   *
   * @param presetId preset ID
   * @returns 明文 API Key，未配置时返回 null
   */
  resolveApiKey: (presetId: string) => Promise<string | null>
}

const initialPresets = loadPresets()
const initialActiveId = loadActivePresetId(initialPresets)

// ============================================================================
// Phase 13.2.3 B1：API Key 正向同步（client → server）
//
// 监听主进程 'api-key:changed' 事件（agentIpc.ts 的 'agent:set-api-key' handler
// 在 apiKeyStore.setApiKey 后通过 event.sender.send 转发），收到后调
// api.put('/ai/settings', ...) 同步到服务器。
//
// 避免循环同步：
// - AIApiConfig.tsx 主动保存时会同时调 setApiKey + api.put，setApiKey 会触发
//   'api-key:changed' 事件，为避免重复 PUT，AIApiConfig.tsx 在调 setApiKey 前
//   调 suppressNextServerSync() 标记跳过下一次事件同步。
// - 反向同步（server → client）本期不做，记为已知限制。
// ============================================================================

let suppressServerSync = false

/**
 * 标记下一次 'api-key:changed' 事件由本地用户主动触发，跳过服务器同步
 *
 * 使用场景：AIApiConfig.tsx handleSave 中已主动调 api.put('/ai/settings')，
 * 调 window.aiKeyApi.setApiKey 前先调此函数，避免 'api-key:changed' 监听器
 * 重复触发 api.put。
 */
export function suppressNextServerSync(): void {
  suppressServerSync = true
}

/** 'api-key:changed' 事件 payload 类型（与 agentIpc.ts sendApiKeyListener 对齐） */
interface ApiKeyChangedPayload {
  provider: string
  endpoint: string
  model: string
}

/**
 * 注册 'api-key:changed' IPC 事件监听器
 *
 * 通过 window.electron.ipcRenderer.on 监听（@electron-toolkit/preload 的
 * electronAPI 通过 contextBridge 暴露 ipcRenderer）。
 *
 * 收到事件后：
 * 1. 检查 suppressServerSync 标志，true 则跳过并重置（避免与 AIApiConfig.tsx 重复 PUT）
 * 2. 从 window.aiKeyApi.getApiKey 读取明文 apiKey（事件本身不传明文 key，安全考虑）
 * 3. 调 api.put('/ai/settings', body) 同步到服务器
 */
function setupApiKeyChangeListener(): void {
  if (typeof window === 'undefined') return
  // window.electron 由 @electron-toolkit/preload 的 electronAPI 通过 contextBridge 暴露
  const electronApi = (window as unknown as {
    electron?: {
      ipcRenderer?: {
        on?: (channel: string, listener: (event: unknown, ...args: unknown[]) => void) => void
      }
    }
  }).electron
  if (!electronApi?.ipcRenderer?.on) {
    // 非 Electron 环境（如测试环境）无 ipcRenderer，安全跳过
    return
  }
  electronApi.ipcRenderer.on('api-key:changed', (_event, ...args: unknown[]) => {
    if (suppressServerSync) {
      suppressServerSync = false
      return
    }
    const payload = args[0] as ApiKeyChangedPayload | undefined
    if (!payload || typeof payload !== 'object') return
    // 异步同步到服务器，错误只记录日志（不阻塞监听器）
    void (async () => {
      try {
        const body: Record<string, string> = {}
        if (payload.model) body.model = payload.model
        if (payload.endpoint) body.endpoint = payload.endpoint
        // 从主进程 safeStorage 读取明文 apiKey（事件本身不传明文 key）
        if (window.aiKeyApi) {
          const apiKey = await window.aiKeyApi.getApiKey(payload.provider)
          if (apiKey) body.apiKey = apiKey
        }
        if (Object.keys(body).length === 0) return
        await api.put('/ai/settings', body)
        console.log(`[useApiConfigStore] api-key:changed synced to server for provider=${payload.provider}`)
      } catch (err) {
        console.error(`[useApiConfigStore] sync api-key:changed to server failed for provider=${payload.provider}:`, err)
      }
    })()
  })
}

setupApiKeyChangeListener()

export const useApiConfigStore = create<ApiConfigStore>((set, get) => ({
  presets: initialPresets,
  activePresetId: initialActiveId,

  createPreset: (data) => {
    const now = Date.now()
    const newPreset: ApiConfigPreset = {
      ...data,
      id: uuidv4(),
      models: [...data.models],
      createdAt: now,
      updatedAt: now,
    }
    const presets = [...get().presets, newPreset]
    set({ presets })
    persistPresets(presets)
    // 第一个 preset 自动设为 activePresetId
    if (presets.length === 1) {
      set({ activePresetId: newPreset.id })
      persistActivePreset(newPreset.id)
    }
    return newPreset.id
  },

  updatePreset: (id, updates) => {
    const presets = get().presets.map(p => {
      if (p.id !== id) return p
      const next: ApiConfigPreset = {
        ...p,
        ...updates,
        // models 数组需深拷贝避免外部引用污染
        models: updates.models ? [...updates.models] : p.models,
        id: p.id,
        createdAt: p.createdAt,
        updatedAt: Date.now(),
      }
      return next
    })
    set({ presets })
    persistPresets(presets)
  },

  deletePreset: (id) => {
    const prev = get()
    const presets = prev.presets.filter(p => p.id !== id)
    let activePresetId = prev.activePresetId

    if (prev.activePresetId === id) {
      // 删除的是 active，切换到第一个；若无 preset，恢复默认预设
      if (presets.length > 0) {
        activePresetId = presets[0].id
      } else {
        const defaults = cloneDefaults()
        presets.push(...defaults)
        activePresetId = defaults[0].id
      }
    }

    set({ presets, activePresetId })
    persistPresets(presets)
    persistActivePreset(activePresetId)
  },

  getPreset: (id) => get().presets.find(p => p.id === id),

  setActivePreset: (id) => {
    if (!get().presets.some(p => p.id === id)) return
    set({ activePresetId: id })
    persistActivePreset(id)
  },

  addModel: (presetId, model) => {
    const trimmed = model.trim()
    if (!trimmed) return
    const presets = get().presets.map(p => {
      if (p.id !== presetId) return p
      if (p.models.includes(trimmed)) return p
      return { ...p, models: [...p.models, trimmed], updatedAt: Date.now() }
    })
    set({ presets })
    persistPresets(presets)
  },

  removeModel: (presetId, model) => {
    const presets = get().presets.map(p => {
      if (p.id !== presetId) return p
      if (!p.models.includes(model)) return p
      return { ...p, models: p.models.filter(m => m !== model), updatedAt: Date.now() }
    })
    set({ presets })
    persistPresets(presets)
  },

  // Phase 9 批次1：API Key 加密存储（safeStorage）
  saveApiKey: async (presetId, apiKey) => {
    const preset = get().getPreset(presetId)
    if (!preset) {
      console.warn(`[useApiConfigStore] saveApiKey: preset ${presetId} not found`)
      return
    }
    // provider 优先取 preset.provider，无则根据 endpoint 推断
    const provider = preset.provider || inferProviderFromEndpoint(preset.endpoint)

    if (typeof window !== 'undefined' && window.aiKeyApi) {
      // Electron 环境：加密存储到主进程 safeStorage
      try {
        await window.aiKeyApi.setApiKey(provider, apiKey, preset.endpoint, preset.models[0] ?? '')
      } catch (err) {
        console.error(`[useApiConfigStore] saveApiKey via aiKeyApi failed for ${provider}:`, err)
        // 失败时 fallback 到 localStorage（向后兼容）
        get().updatePreset(presetId, { apiKey, provider })
        return
      }
      // 成功后清空 preset.apiKey 字段（不再存明文），并补 provider 字段
      get().updatePreset(presetId, { apiKey: '', provider })
    } else {
      // 非 Electron 环境（fallback）：写入 preset.apiKey 字段存 localStorage（向后兼容）
      get().updatePreset(presetId, { apiKey, provider })
    }
  },

  resolveApiKey: async (presetId) => {
    const preset = get().getPreset(presetId)
    if (!preset) {
      console.warn(`[useApiConfigStore] resolveApiKey: preset ${presetId} not found`)
      return null
    }
    const provider = preset.provider || inferProviderFromEndpoint(preset.endpoint)

    if (typeof window !== 'undefined' && window.aiKeyApi) {
      // Electron 环境：从主进程 safeStorage 解密读取
      try {
        let apiKey = await window.aiKeyApi.getApiKey(provider)
        // safeStorage 返回空字符串或 null 时，从后端数据库同步恢复
        if (!apiKey) {
          console.log(`[useApiConfigStore] safeStorage apiKey empty for ${provider}, fetching from backend...`)
          try {
            const data = await api.get<{ apiKey: string }>('/ai/settings/api-key')
            if (data.apiKey) {
              // 恢复到 safeStorage（避免下次再 fetch）
              await window.aiKeyApi.setApiKey(
                provider,
                data.apiKey,
                preset.endpoint || '',
                preset.models?.[0] || '',
              )
              console.log(`[useApiConfigStore] apiKey restored from backend to safeStorage for ${provider}`)
              return data.apiKey
            }
          } catch (fetchErr) {
            console.error(`[useApiConfigStore] Failed to fetch apiKey from backend:`, fetchErr)
          }
          return null
        }
        return apiKey
      } catch (err) {
        console.error(`[useApiConfigStore] resolveApiKey via aiKeyApi failed for ${provider}:`, err)
        // 失败时 fallback 到 preset.apiKey 字段（向后兼容）
        return preset.apiKey || null
      }
    }
    // 非 Electron 环境（fallback）：返回 preset.apiKey 字段（向后兼容）
    return preset.apiKey || null
  },
}))
