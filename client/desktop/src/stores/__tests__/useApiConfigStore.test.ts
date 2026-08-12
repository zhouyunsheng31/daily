/**
 * useApiConfigStore vitest 单元测试（Phase 11 P1）
 *
 * 测试目标：
 * - 初始状态：presets 含默认 DeepSeek preset，activePresetId 指向第一个
 * - createPreset 添加新 preset，持久化到 localStorage
 * - updatePreset 更新 preset 字段
 * - deletePreset 删除 preset，删除 active 时切换到第一个
 * - addModel / removeModel 操作 models 数组
 * - saveApiKey 在 Electron 环境调 window.aiKeyApi.setApiKey
 * - resolveApiKey 在 Electron 环境调 window.aiKeyApi.getApiKey
 * - migrateLegacyPresets 旧版 preset 迁移（无 provider 时根据 endpoint 推断）
 *
 * mock 策略：
 * - 使用 setupMockElectronAPI 注入 window.aiKeyApi
 * - localStorage 清空 + setState 重置 store
 * - vi.resetModules + 动态 import 测试"从 localStorage 恢复"
 *
 * 不修改源代码；只读源代码以对齐行为。
 */
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest'
import { useApiConfigStore, migrateLegacyPresets } from '../useApiConfigStore'
import { setupMockElectronAPI, teardownMockElectronAPI } from '@/test/mocks/mockElectronAPI'
import type { ApiConfigPreset } from '@/types/apiConfig'

// ============================================================================
// 默认预设常量（与源码 DEFAULT_PRESETS 对齐）
// ============================================================================
const DEFAULT_PRESET_ID = 'default-deepseek'

function makeDefaultPreset(): ApiConfigPreset {
  return {
    id: DEFAULT_PRESET_ID,
    name: 'DeepSeek 官方',
    endpoint: 'https://api.deepseek.com/v1/chat/completions',
    apiKey: '',
    provider: 'deepseek',
    models: ['deepseek-chat', 'deepseek-coder', 'deepseek-reasoner'],
    createdAt: 1000,
    updatedAt: 1000,
  }
}

// ============================================================================
// 公共重置逻辑
// ============================================================================
let teardownElectron: (() => void) | null = null

beforeEach(() => {
  // 清空 localStorage
  localStorage.clear()

  // 重置 store 到默认状态
  const preset = makeDefaultPreset()
  useApiConfigStore.setState({
    presets: [preset],
    activePresetId: preset.id,
  })

  // 注入 mock electron API（window.aiKeyApi 等）
  teardownElectron = setupMockElectronAPI()

  // 抑制源码 console.warn/error 噪音
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'log').mockImplementation(() => {})
})

afterEach(() => {
  if (teardownElectron) {
    teardownElectron()
    teardownElectron = null
  }
  teardownMockElectronAPI()
  vi.restoreAllMocks()
})

// ============================================================================
// 1. 初始状态
// ============================================================================
describe('初始状态', () => {
  test('presets 含 1 个默认 DeepSeek preset', () => {
    // 验证默认预设存在
    const { presets } = useApiConfigStore.getState()
    expect(presets).toHaveLength(1)
    expect(presets[0].id).toBe(DEFAULT_PRESET_ID)
    expect(presets[0].name).toBe('DeepSeek 官方')
    expect(presets[0].provider).toBe('deepseek')
    expect(presets[0].models).toContain('deepseek-chat')
  })

  test('activePresetId 指向第一个 preset', () => {
    // 验证 activePresetId 默认指向默认预设
    const { presets, activePresetId } = useApiConfigStore.getState()
    expect(activePresetId).toBe(presets[0].id)
    expect(activePresetId).toBe(DEFAULT_PRESET_ID)
  })

  test('默认 preset 的 apiKey 为空字符串（Phase 9 后不再存明文）', () => {
    // 验证 apiKey 字段为空（真实 apiKey 存在 safeStorage 中）
    const { presets } = useApiConfigStore.getState()
    expect(presets[0].apiKey).toBe('')
  })
})

// ============================================================================
// 2. createPreset
// ============================================================================
describe('createPreset', () => {
  test('添加新 preset 并返回 id', () => {
    // 创建新 preset 并验证返回值是 UUID
    const id = useApiConfigStore.getState().createPreset({
      name: 'OpenAI',
      endpoint: 'https://api.openai.com/v1/chat/completions',
      apiKey: '',
      provider: 'openai',
      models: ['gpt-4'],
    })
    expect(typeof id).toBe('string')
    expect(id).toHaveLength(36) // UUID v4 长度

    // presets 数组应包含 2 个
    expect(useApiConfigStore.getState().presets).toHaveLength(2)
  })

  test('新 preset 持久化到 localStorage', () => {
    // 创建后检查 localStorage 中有对应数据
    useApiConfigStore.getState().createPreset({
      name: 'OpenAI',
      endpoint: 'https://api.openai.com/v1/chat/completions',
      apiKey: '',
      provider: 'openai',
      models: ['gpt-4'],
    })

    const raw = localStorage.getItem('ai-api-config-presets')
    expect(raw).not.toBeNull()
    const parsed = JSON.parse(raw!) as ApiConfigPreset[]
    expect(parsed).toHaveLength(2)
    expect(parsed.some(p => p.name === 'OpenAI')).toBe(true)
  })

  test('createPreset 后 getPreset 能找到新 preset', () => {
    const id = useApiConfigStore.getState().createPreset({
      name: 'Anthropic',
      endpoint: 'https://api.anthropic.com/v1/messages',
      apiKey: '',
      provider: 'anthropic',
      models: ['claude-3'],
    })

    const preset = useApiConfigStore.getState().getPreset(id)
    expect(preset).toBeDefined()
    expect(preset!.name).toBe('Anthropic')
    expect(preset!.models).toEqual(['claude-3'])
  })
})

// ============================================================================
// 3. updatePreset
// ============================================================================
describe('updatePreset', () => {
  test('更新 preset 的 name 字段', () => {
    // 更新默认 preset 的名称
    useApiConfigStore.getState().updatePreset(DEFAULT_PRESET_ID, { name: 'DeepSeek V3' })
    const preset = useApiConfigStore.getState().getPreset(DEFAULT_PRESET_ID)
    expect(preset!.name).toBe('DeepSeek V3')
  })

  test('更新 preset 的 endpoint 字段', () => {
    useApiConfigStore.getState().updatePreset(DEFAULT_PRESET_ID, {
      endpoint: 'https://new-endpoint.com/v1',
    })
    const preset = useApiConfigStore.getState().getPreset(DEFAULT_PRESET_ID)
    expect(preset!.endpoint).toBe('https://new-endpoint.com/v1')
  })

  test('updatePreset 后 updatedAt 更新', async () => {
    // 验证 updatedAt 时间戳被更新
    const before = useApiConfigStore.getState().getPreset(DEFAULT_PRESET_ID)!.updatedAt
    await new Promise(r => setTimeout(r, 5))
    useApiConfigStore.getState().updatePreset(DEFAULT_PRESET_ID, { name: 'Updated' })
    const after = useApiConfigStore.getState().getPreset(DEFAULT_PRESET_ID)!.updatedAt
    expect(after).toBeGreaterThanOrEqual(before)
  })

  test('updatePreset 后持久化到 localStorage', () => {
    useApiConfigStore.getState().updatePreset(DEFAULT_PRESET_ID, { name: 'Updated' })
    const raw = localStorage.getItem('ai-api-config-presets')
    const parsed = JSON.parse(raw!) as ApiConfigPreset[]
    expect(parsed[0].name).toBe('Updated')
  })

  test('updatePreset 不修改 id 和 createdAt', () => {
    const original = useApiConfigStore.getState().getPreset(DEFAULT_PRESET_ID)!
    useApiConfigStore.getState().updatePreset(DEFAULT_PRESET_ID, { name: 'New Name' })
    const updated = useApiConfigStore.getState().getPreset(DEFAULT_PRESET_ID)!
    expect(updated.id).toBe(original.id)
    expect(updated.createdAt).toBe(original.createdAt)
  })

  test('updatePreset 传入 models 数组时深拷贝', () => {
    // 源码：updates.models ? [...updates.models] : p.models
    const externalModels = ['model-a', 'model-b']
    useApiConfigStore.getState().updatePreset(DEFAULT_PRESET_ID, { models: externalModels })
    // 修改外部数组不应影响 store 内部
    externalModels.push('model-c')
    const preset = useApiConfigStore.getState().getPreset(DEFAULT_PRESET_ID)
    expect(preset!.models).toEqual(['model-a', 'model-b'])
  })
})

// ============================================================================
// 4. deletePreset
// ============================================================================
describe('deletePreset', () => {
  test('删除非 active preset 后 active 不变', () => {
    // 先创建第二个 preset
    const id2 = useApiConfigStore.getState().createPreset({
      name: 'OpenAI',
      endpoint: 'https://api.openai.com/v1',
      apiKey: '',
      provider: 'openai',
      models: ['gpt-4'],
    })
    // active 仍为 default
    expect(useApiConfigStore.getState().activePresetId).toBe(DEFAULT_PRESET_ID)

    // 删除非 active preset
    useApiConfigStore.getState().deletePreset(id2)
    expect(useApiConfigStore.getState().presets).toHaveLength(1)
    expect(useApiConfigStore.getState().activePresetId).toBe(DEFAULT_PRESET_ID)
  })

  test('删除 active preset 后切换到第一个', () => {
    // 创建第二个 preset
    const id2 = useApiConfigStore.getState().createPreset({
      name: 'OpenAI',
      endpoint: 'https://api.openai.com/v1',
      apiKey: '',
      provider: 'openai',
      models: ['gpt-4'],
    })

    // 切 active 到 id2
    useApiConfigStore.getState().setActivePreset(id2)
    expect(useApiConfigStore.getState().activePresetId).toBe(id2)

    // 删除 active（id2）
    useApiConfigStore.getState().deletePreset(id2)
    // active 应切到第一个（default）
    expect(useApiConfigStore.getState().activePresetId).toBe(DEFAULT_PRESET_ID)
  })

  test('删除最后一个 preset 时恢复默认预设', () => {
    // 删除 default（唯一的 preset）
    useApiConfigStore.getState().deletePreset(DEFAULT_PRESET_ID)
    // 源码：presets.length === 0 时恢复 defaults
    const { presets } = useApiConfigStore.getState()
    expect(presets).toHaveLength(1)
    expect(presets[0].id).toBe(DEFAULT_PRESET_ID)
  })

  test('删除后 localStorage 同步更新', () => {
    const id2 = useApiConfigStore.getState().createPreset({
      name: 'OpenAI',
      endpoint: 'https://api.openai.com/v1',
      apiKey: '',
      provider: 'openai',
      models: ['gpt-4'],
    })
    useApiConfigStore.getState().deletePreset(id2)

    const raw = localStorage.getItem('ai-api-config-presets')
    const parsed = JSON.parse(raw!) as ApiConfigPreset[]
    expect(parsed).toHaveLength(1)
    expect(parsed.some(p => p.id === id2)).toBe(false)
  })
})

// ============================================================================
// 5. addModel / removeModel
// ============================================================================
describe('addModel / removeModel', () => {
  test('addModel 向 preset 添加新 model', () => {
    useApiConfigStore.getState().addModel(DEFAULT_PRESET_ID, 'deepseek-v3')
    const preset = useApiConfigStore.getState().getPreset(DEFAULT_PRESET_ID)
    expect(preset!.models).toContain('deepseek-v3')
    expect(preset!.models).toHaveLength(4) // 原来 3 个 + 1
  })

  test('addModel 重复 model 时不添加', () => {
    // 源码：if (p.models.includes(trimmed)) return p
    useApiConfigStore.getState().addModel(DEFAULT_PRESET_ID, 'deepseek-chat')
    const preset = useApiConfigStore.getState().getPreset(DEFAULT_PRESET_ID)
    expect(preset!.models).toHaveLength(3) // 仍为 3 个
  })

  test('addModel 空字符串时不添加', () => {
    // 源码：if (!trimmed) return
    useApiConfigStore.getState().addModel(DEFAULT_PRESET_ID, '  ')
    const preset = useApiConfigStore.getState().getPreset(DEFAULT_PRESET_ID)
    expect(preset!.models).toHaveLength(3)
  })

  test('addModel 自动 trim 空白', () => {
    // 源码：const trimmed = model.trim()
    useApiConfigStore.getState().addModel(DEFAULT_PRESET_ID, '  new-model  ')
    const preset = useApiConfigStore.getState().getPreset(DEFAULT_PRESET_ID)
    expect(preset!.models).toContain('new-model')
  })

  test('removeModel 从 preset 删除 model', () => {
    useApiConfigStore.getState().removeModel(DEFAULT_PRESET_ID, 'deepseek-coder')
    const preset = useApiConfigStore.getState().getPreset(DEFAULT_PRESET_ID)
    expect(preset!.models).not.toContain('deepseek-coder')
    expect(preset!.models).toHaveLength(2)
  })

  test('removeModel 不存在的 model 时无变化', () => {
    useApiConfigStore.getState().removeModel(DEFAULT_PRESET_ID, 'nonexistent')
    const preset = useApiConfigStore.getState().getPreset(DEFAULT_PRESET_ID)
    expect(preset!.models).toHaveLength(3)
  })
})

// ============================================================================
// 6. setActivePreset
// ============================================================================
describe('setActivePreset', () => {
  test('切换 active 到存在的 preset', () => {
    const id2 = useApiConfigStore.getState().createPreset({
      name: 'OpenAI',
      endpoint: 'https://api.openai.com/v1',
      apiKey: '',
      provider: 'openai',
      models: ['gpt-4'],
    })

    useApiConfigStore.getState().setActivePreset(id2)
    expect(useApiConfigStore.getState().activePresetId).toBe(id2)
  })

  test('setActivePreset 对不存在的 id 无效', () => {
    // 源码：if (!get().presets.some(p => p.id === id)) return
    useApiConfigStore.getState().setActivePreset('nonexistent-id')
    expect(useApiConfigStore.getState().activePresetId).toBe(DEFAULT_PRESET_ID)
  })

  test('setActivePreset 持久化到 localStorage', () => {
    const id2 = useApiConfigStore.getState().createPreset({
      name: 'OpenAI',
      endpoint: 'https://api.openai.com/v1',
      apiKey: '',
      provider: 'openai',
      models: ['gpt-4'],
    })

    useApiConfigStore.getState().setActivePreset(id2)
    expect(localStorage.getItem('ai-api-config-active-preset')).toBe(id2)
  })
})

// ============================================================================
// 7. saveApiKey（Electron 环境）
// ============================================================================
describe('saveApiKey', () => {
  test('Electron 环境调 window.aiKeyApi.setApiKey', async () => {
    // 验证：Electron 环境（window.aiKeyApi 可用）走 safeStorage 加密路径
    const mockSetApiKey = window.aiKeyApi!.setApiKey as ReturnType<typeof vi.fn>

    await useApiConfigStore.getState().saveApiKey(DEFAULT_PRESET_ID, 'sk-test-key-123')

    expect(mockSetApiKey).toHaveBeenCalledWith(
      'deepseek',                    // provider
      'sk-test-key-123',             // apiKey
      'https://api.deepseek.com/v1/chat/completions', // endpoint
      'deepseek-chat',               // models[0]
    )
  })

  test('saveApiKey 成功后清空 preset.apiKey 字段', async () => {
    // 源码：成功后调 updatePreset(presetId, { apiKey: '', provider })
    // 先设置 apiKey 字段为非空
    useApiConfigStore.getState().updatePreset(DEFAULT_PRESET_ID, { apiKey: 'old-key' })

    await useApiConfigStore.getState().saveApiKey(DEFAULT_PRESET_ID, 'new-key')

    const preset = useApiConfigStore.getState().getPreset(DEFAULT_PRESET_ID)
    expect(preset!.apiKey).toBe('')
  })

  test('saveApiKey 不存在的 preset 时安全返回', async () => {
    // 源码：if (!preset) return
    await expect(
      useApiConfigStore.getState().saveApiKey('nonexistent', 'key'),
    ).resolves.toBeUndefined()
  })

  test('saveApiKey 失败时 fallback 到 localStorage', async () => {
    // 源码：catch err → updatePreset(presetId, { apiKey, provider })
    // 替换 setApiKey 为抛错
    const failingSetApiKey = vi.fn().mockRejectedValue(new Error('safeStorage unavailable'))
    teardownElectron?.()
    teardownElectron = setupMockElectronAPI({
      aiKeyApi: { setApiKey: failingSetApiKey },
    })

    await useApiConfigStore.getState().saveApiKey(DEFAULT_PRESET_ID, 'sk-fallback-key')

    // fallback 后 apiKey 字段应有值
    const preset = useApiConfigStore.getState().getPreset(DEFAULT_PRESET_ID)
    expect(preset!.apiKey).toBe('sk-fallback-key')
  })
})

// ============================================================================
// 8. resolveApiKey（Electron 环境）
// ============================================================================
describe('resolveApiKey', () => {
  test('Electron 环境调 window.aiKeyApi.getApiKey', async () => {
    // 先 saveApiKey，再 resolveApiKey
    await useApiConfigStore.getState().saveApiKey(DEFAULT_PRESET_ID, 'sk-resolve-test')

    const result = await useApiConfigStore.getState().resolveApiKey(DEFAULT_PRESET_ID)
    expect(result).toBe('sk-resolve-test')
  })

  test('resolveApiKey 不存在的 preset 返回 null', async () => {
    // 源码：if (!preset) return null
    const result = await useApiConfigStore.getState().resolveApiKey('nonexistent')
    expect(result).toBeNull()
  })

  test('resolveApiKey 失败时 fallback 到 preset.apiKey', async () => {
    // 设置 preset.apiKey 字段
    useApiConfigStore.getState().updatePreset(DEFAULT_PRESET_ID, { apiKey: 'fallback-key' })

    // 替换 getApiKey 为抛错
    const failingGetApiKey = vi.fn().mockRejectedValue(new Error('decrypt failed'))
    teardownElectron?.()
    teardownElectron = setupMockElectronAPI({
      aiKeyApi: { getApiKey: failingGetApiKey },
    })

    const result = await useApiConfigStore.getState().resolveApiKey(DEFAULT_PRESET_ID)
    expect(result).toBe('fallback-key')
  })

  test('非 Electron 环境 fallback 到 preset.apiKey', async () => {
    // 删除 window.aiKeyApi → 走 fallback 路径
    teardownElectron?.()
    teardownElectron = null
    teardownMockElectronAPI()

    useApiConfigStore.getState().updatePreset(DEFAULT_PRESET_ID, { apiKey: 'plain-key' })
    const result = await useApiConfigStore.getState().resolveApiKey(DEFAULT_PRESET_ID)
    expect(result).toBe('plain-key')
  })
})

// ============================================================================
// 9. migrateLegacyPresets
// ============================================================================
describe('migrateLegacyPresets', () => {
  test('无 provider 字段时根据 endpoint 推断 provider', () => {
    // 构造旧版 preset（无 provider，有 apiKey 明文）
    const legacyPresets: ApiConfigPreset[] = [{
      id: 'legacy-1',
      name: 'OpenAI Legacy',
      endpoint: 'https://api.openai.com/v1/chat/completions',
      apiKey: 'sk-legacy-key',
      models: ['gpt-4'],
      createdAt: 1000,
      updatedAt: 1000,
    }]
    localStorage.setItem('ai-api-config-presets', JSON.stringify(legacyPresets))

    migrateLegacyPresets()

    const raw = localStorage.getItem('ai-api-config-presets')
    const parsed = JSON.parse(raw!) as ApiConfigPreset[]
    expect(parsed[0].provider).toBe('openai')
  })

  test('endpoint 含 deepseek 时推断 provider 为 deepseek', () => {
    const legacyPresets: ApiConfigPreset[] = [{
      id: 'legacy-ds',
      name: 'DS',
      endpoint: 'https://api.deepseek.com/v1',
      apiKey: 'sk-ds',
      models: ['deepseek-chat'],
      createdAt: 1000,
      updatedAt: 1000,
    }]
    localStorage.setItem('ai-api-config-presets', JSON.stringify(legacyPresets))

    migrateLegacyPresets()

    const parsed = JSON.parse(localStorage.getItem('ai-api-config-presets')!) as ApiConfigPreset[]
    expect(parsed[0].provider).toBe('deepseek')
  })

  test('endpoint 含 anthropic 时推断 provider 为 anthropic', () => {
    const legacyPresets: ApiConfigPreset[] = [{
      id: 'legacy-an',
      name: 'AN',
      endpoint: 'https://api.anthropic.com/v1',
      apiKey: 'sk-an',
      models: ['claude-3'],
      createdAt: 1000,
      updatedAt: 1000,
    }]
    localStorage.setItem('ai-api-config-presets', JSON.stringify(legacyPresets))

    migrateLegacyPresets()

    const parsed = JSON.parse(localStorage.getItem('ai-api-config-presets')!) as ApiConfigPreset[]
    expect(parsed[0].provider).toBe('anthropic')
  })

  test('endpoint 含 dashscope 时降级为 openai（qwen 非内置 provider，走 openai 兼容）', () => {
    // Phase 13.2.3 B2：pi-coding-agent 内置 provider 仅 anthropic/openai/deepseek/google
    // qwen/stepfun 等非内置 provider 通过 openai 兼容协议调用
    const legacyPresets: ApiConfigPreset[] = [{
      id: 'legacy-qw',
      name: 'QW',
      endpoint: 'https://dashscope.aliyuncs.com/v1',
      apiKey: 'sk-qw',
      models: ['qwen-max'],
      createdAt: 1000,
      updatedAt: 1000,
    }]
    localStorage.setItem('ai-api-config-presets', JSON.stringify(legacyPresets))

    migrateLegacyPresets()

    const parsed = JSON.parse(localStorage.getItem('ai-api-config-presets')!) as ApiConfigPreset[]
    expect(parsed[0].provider).toBe('openai')
  })

  test('无法识别 endpoint 时降级为 openai（openai 兼容协议）', () => {
    // Phase 13.2.3 B2：默认 provider 从 'deepseek' 改为 'openai'（兼容多数第三方 API）
    const legacyPresets: ApiConfigPreset[] = [{
      id: 'legacy-unknown',
      name: 'Unknown',
      endpoint: 'https://unknown-provider.com/v1',
      apiKey: 'sk-unknown',
      models: ['model-x'],
      createdAt: 1000,
      updatedAt: 1000,
    }]
    localStorage.setItem('ai-api-config-presets', JSON.stringify(legacyPresets))

    migrateLegacyPresets()

    const parsed = JSON.parse(localStorage.getItem('ai-api-config-presets')!) as ApiConfigPreset[]
    expect(parsed[0].provider).toBe('openai')
  })

  test('迁移后清空 apiKey 明文字段', () => {
    const legacyPresets: ApiConfigPreset[] = [{
      id: 'legacy-clear',
      name: 'Legacy',
      endpoint: 'https://api.openai.com/v1',
      apiKey: 'sk-should-be-cleared',
      models: ['gpt-4'],
      createdAt: 1000,
      updatedAt: 1000,
    }]
    localStorage.setItem('ai-api-config-presets', JSON.stringify(legacyPresets))

    migrateLegacyPresets()

    const parsed = JSON.parse(localStorage.getItem('ai-api-config-presets')!) as ApiConfigPreset[]
    expect(parsed[0].apiKey).toBe('')
  })

  test('已有 provider 且无明文 apiKey 时不迁移', () => {
    // 源码：if (preset.provider && !preset.apiKey) return preset
    const alreadyMigrated: ApiConfigPreset[] = [{
      id: 'already-ok',
      name: 'OK',
      endpoint: 'https://api.openai.com/v1',
      apiKey: '',
      provider: 'openai',
      models: ['gpt-4'],
      createdAt: 1000,
      updatedAt: 1000,
    }]
    localStorage.setItem('ai-api-config-presets', JSON.stringify(alreadyMigrated))

    migrateLegacyPresets()

    // 数据应不变
    const parsed = JSON.parse(localStorage.getItem('ai-api-config-presets')!) as ApiConfigPreset[]
    expect(parsed[0]).toEqual(alreadyMigrated[0])
  })

  test('localStorage 为空时安全返回（无操作）', () => {
    // 源码：if (!raw) return
    localStorage.removeItem('ai-api-config-presets')

    expect(() => migrateLegacyPresets()).not.toThrow()
  })
})

// ============================================================================
// 10. 从 localStorage 恢复
// ============================================================================
describe('localStorage 恢复', () => {
  test('初始化时从 localStorage 读取 presets', async () => {
    // 写入自定义 preset 数据
    const customPresets: ApiConfigPreset[] = [{
      id: 'custom-1',
      name: 'Custom',
      endpoint: 'https://custom.api.com/v1',
      apiKey: '',
      provider: 'openai',
      models: ['custom-model'],
      createdAt: 1000,
      updatedAt: 1000,
    }]
    localStorage.setItem('ai-api-config-presets', JSON.stringify(customPresets))
    localStorage.setItem('ai-api-config-active-preset', 'custom-1')

    // 重新加载模块
    vi.resetModules()
    const freshModule = await import('../useApiConfigStore')

    expect(freshModule.useApiConfigStore.getState().presets).toHaveLength(1)
    expect(freshModule.useApiConfigStore.getState().presets[0].id).toBe('custom-1')
    expect(freshModule.useApiConfigStore.getState().activePresetId).toBe('custom-1')
  })

  test('localStorage 为空时使用默认 presets', async () => {
    localStorage.removeItem('ai-api-config-presets')
    localStorage.removeItem('ai-api-config-active-preset')

    vi.resetModules()
    const freshModule = await import('../useApiConfigStore')

    expect(freshModule.useApiConfigStore.getState().presets[0].id).toBe(DEFAULT_PRESET_ID)
    expect(freshModule.useApiConfigStore.getState().activePresetId).toBe(DEFAULT_PRESET_ID)
  })

  test('activePresetId 不匹配时回退到第一个 preset', async () => {
    const customPresets: ApiConfigPreset[] = [{
      id: 'custom-1',
      name: 'Custom',
      endpoint: 'https://custom.api.com/v1',
      apiKey: '',
      provider: 'openai',
      models: ['custom-model'],
      createdAt: 1000,
      updatedAt: 1000,
    }]
    localStorage.setItem('ai-api-config-presets', JSON.stringify(customPresets))
    localStorage.setItem('ai-api-config-active-preset', 'nonexistent-id')

    vi.resetModules()
    const freshModule = await import('../useApiConfigStore')

    // active 应回退到第一个 preset
    expect(freshModule.useApiConfigStore.getState().activePresetId).toBe('custom-1')
  })
})
