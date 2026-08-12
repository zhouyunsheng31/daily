/**
 * API 配置端到端测试 — Phase 11.5.3
 *
 * 测试目标（任务 2.3，4+ 用例）：
 * - 完整 round trip：createPreset → saveApiKey → resolveApiKey（返回保存的 key）
 * - saveApiKey 后 preset.apiKey 字段被清空（不再存明文）
 * - saveApiKey 时 provider 从 endpoint 推断（inferProviderFromEndpoint）
 * - migrateLegacyPresets 旧版 preset 迁移：补 provider 字段 + 明文 apiKey 迁移到 safeStorage
 * - 非 Electron 环境 fallback：saveApiKey 写入 preset.apiKey 字段（localStorage）
 *
 * 与 useApiConfigStore.test.ts 的区别：
 * - useApiConfigStore.test.ts 单独测试各方法（单元测试）
 * - 本测试验证端到端流程（createPreset → saveApiKey → resolveApiKey 完整链路）
 *   + 迁移场景 + fallback 场景
 *
 * Mock 策略：
 * - setupMockElectronAPI()：注入 window.aiKeyApi（mock safeStorage 加密）
 * - localStorage 清空 + setState 重置 store
 */
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest'
import { useApiConfigStore, migrateLegacyPresets } from '../useApiConfigStore'
import { setupMockElectronAPI, teardownMockElectronAPI } from '@/test/mocks/mockElectronAPI'
import type { ApiConfigPreset } from '@/types/apiConfig'

// ============================================================================
// 测试辅助
// ============================================================================

let teardownElectron: (() => void) | null = null

function resetStore(presets: ApiConfigPreset[] = [], activePresetId: string = ''): void {
  useApiConfigStore.setState({
    presets,
    activePresetId,
  })
}

beforeEach(() => {
  localStorage.clear()
  resetStore()
  teardownElectron = setupMockElectronAPI()
})

afterEach(() => {
  teardownElectron?.()
  teardownElectron = null
  teardownMockElectronAPI()
  vi.clearAllMocks()
})

// ============================================================================
// 测试套件
// ============================================================================

describe('API 配置端到端测试', () => {
  // ==========================================================================
  // 1. 完整 round trip：createPreset → saveApiKey → resolveApiKey
  // ==========================================================================

  test('1. createPreset → saveApiKey → resolveApiKey 完整 round trip（Electron 环境）', async () => {
    // 步骤 1：创建 preset
    const presetId = useApiConfigStore.getState().createPreset({
      name: 'DeepSeek',
      endpoint: 'https://api.deepseek.com/v1/chat/completions',
      apiKey: '',
      models: ['deepseek-chat'],
    })
    expect(presetId).toBeDefined()

    // 步骤 2：保存 API Key（应通过 window.aiKeyApi.setApiKey 加密存储到 safeStorage）
    await useApiConfigStore.getState().saveApiKey(presetId, 'sk-real-api-key-12345')

    // 验证：window.aiKeyApi.setApiKey 被调用，provider='deepseek'（从 endpoint 推断）
    const setApiKeyMock = window.aiKeyApi!.setApiKey as ReturnType<typeof vi.fn>
    expect(setApiKeyMock).toHaveBeenCalledTimes(1)
    expect(setApiKeyMock).toHaveBeenCalledWith(
      'deepseek',
      'sk-real-api-key-12345',
      'https://api.deepseek.com/v1/chat/completions',
      'deepseek-chat',
    )

    // 步骤 3：读取 API Key（应通过 window.aiKeyApi.getApiKey 解密返回）
    // 配置 mock 返回值
    const getApiKeyMock = window.aiKeyApi!.getApiKey as ReturnType<typeof vi.fn>
    getApiKeyMock.mockResolvedValue('sk-real-api-key-12345')

    const resolved = await useApiConfigStore.getState().resolveApiKey(presetId)

    // 验证：resolveApiKey 调用 window.aiKeyApi.getApiKey('deepseek')
    expect(getApiKeyMock).toHaveBeenCalledWith('deepseek')
    expect(resolved).toBe('sk-real-api-key-12345')
  })

  // ==========================================================================
  // 2. saveApiKey 后 preset.apiKey 字段被清空（不再存明文）
  // ==========================================================================

  test('2. saveApiKey 成功后 preset.apiKey 字段被清空（不再存明文，向后兼容保留字段）', async () => {
    const presetId = useApiConfigStore.getState().createPreset({
      name: 'OpenAI',
      endpoint: 'https://api.openai.com/v1/chat/completions',
      apiKey: 'should-be-cleared',
      models: ['gpt-4'],
    })

    // 保存前：preset.apiKey 应为 'should-be-cleared'
    const beforePreset = useApiConfigStore.getState().getPreset(presetId)
    expect(beforePreset?.apiKey).toBe('should-be-cleared')

    // 保存 API Key
    await useApiConfigStore.getState().saveApiKey(presetId, 'sk-new-key')

    // 保存后：preset.apiKey 应被清空（不再存明文）
    const afterPreset = useAIStore_getPreset(presetId)
    expect(afterPreset?.apiKey).toBe('')
    // 但 provider 字段应被设置（推断为 'openai'）
    expect(afterPreset?.provider).toBe('openai')
  })

  // ==========================================================================
  // 3. saveApiKey 时 provider 从 endpoint 推断（inferProviderFromEndpoint）
  // ==========================================================================

  test('3. saveApiKey 时 provider 从 endpoint 推断（4 内置 + 2 fallback）', async () => {
    // Phase 13.2.3 B2：pi-coding-agent 内置 provider 仅 anthropic/openai/deepseek/google
    // qwen/stepfun 等非内置 endpoint 降级为 'openai'（openai 兼容协议）
    const cases: Array<{ endpoint: string; expectedProvider: string }> = [
      { endpoint: 'https://api.deepseek.com/v1/chat/completions', expectedProvider: 'deepseek' },
      { endpoint: 'https://api.openai.com/v1/chat/completions', expectedProvider: 'openai' },
      { endpoint: 'https://api.anthropic.com/v1/messages', expectedProvider: 'anthropic' },
      { endpoint: 'https://generativelanguage.googleapis.com/v1beta/models', expectedProvider: 'google' },
      // 非内置 provider：降级为 'openai'（兼容）
      { endpoint: 'https://dashscope.aliyuncs.com/api/v1/services/aigc/text-generation', expectedProvider: 'openai' },
      { endpoint: 'https://api.stepfun.com/v1/chat/completions', expectedProvider: 'openai' },
    ]

    for (const { endpoint, expectedProvider } of cases) {
      const presetId = useApiConfigStore.getState().createPreset({
        name: `Test-${expectedProvider}`,
        endpoint,
        apiKey: '',
        models: ['test-model'],
      })

      await useApiConfigStore.getState().saveApiKey(presetId, 'sk-test')

      // 验证：window.aiKeyApi.setApiKey 被调用时 provider 参数正确
      const setApiKeyMock = window.aiKeyApi!.setApiKey as ReturnType<typeof vi.fn>
      const lastCall = setApiKeyMock.mock.calls[setApiKeyMock.mock.calls.length - 1]
      expect(lastCall[0]).toBe(expectedProvider)

      // preset.provider 字段应被设置
      const preset = useAIStore_getPreset(presetId)
      expect(preset?.provider).toBe(expectedProvider)
    }
  })

  // ==========================================================================
  // 4. migrateLegacyPresets 旧版 preset 迁移
  //    旧版 preset 无 provider 字段 + 含明文 apiKey → 补 provider + 迁移 apiKey 到 safeStorage
  // ==========================================================================

  test('4. migrateLegacyPresets 旧版 preset 迁移：补 provider 字段 + 明文 apiKey 迁移到 safeStorage', async () => {
    // 模拟 localStorage 中的旧版 preset 数据（无 provider 字段 + 含明文 apiKey）
    const legacyPresets: ApiConfigPreset[] = [
      {
        id: 'legacy-1',
        name: 'Legacy DeepSeek',
        endpoint: 'https://api.deepseek.com/v1/chat/completions',
        apiKey: 'sk-legacy-plaintext-key',
        models: ['deepseek-chat'],
        createdAt: 1000,
        updatedAt: 1000,
        // 注意：无 provider 字段
      },
    ]
    localStorage.setItem('ai-api-config-presets', JSON.stringify(legacyPresets))

    // 重置 mock 调用计数
    const setApiKeyMock = window.aiKeyApi!.setApiKey as ReturnType<typeof vi.fn>
    setApiKeyMock.mockClear()

    // 触发迁移
    migrateLegacyPresets()

    // 等待异步 setApiKey 完成
    await new Promise(resolve => setTimeout(resolve, 10))

    // 验证：window.aiKeyApi.setApiKey 被调用（明文 apiKey 迁移到 safeStorage）
    expect(setApiKeyMock).toHaveBeenCalledTimes(1)
    expect(setApiKeyMock).toHaveBeenCalledWith(
      'deepseek', // 从 endpoint 推断的 provider
      'sk-legacy-plaintext-key', // 旧版明文 apiKey
      'https://api.deepseek.com/v1/chat/completions',
      'deepseek-chat',
    )

    // 验证：localStorage 中的 preset 已迁移（apiKey 清空 + provider 补全）
    const migratedRaw = localStorage.getItem('ai-api-config-presets')
    expect(migratedRaw).not.toBeNull()
    const migrated = JSON.parse(migratedRaw!) as ApiConfigPreset[]
    expect(migrated[0].provider).toBe('deepseek')
    expect(migrated[0].apiKey).toBe('') // 明文已清空
  })

  test('4b. migrateLegacyPresets 已迁移过的 preset（有 provider + 无明文 apiKey）不重复迁移', async () => {
    // 模拟已迁移过的 preset 数据
    const migratedPresets: ApiConfigPreset[] = [
      {
        id: 'already-migrated',
        name: 'Already Migrated',
        endpoint: 'https://api.deepseek.com/v1/chat/completions',
        apiKey: '', // 已清空
        provider: 'deepseek', // 已有 provider
        models: ['deepseek-chat'],
        createdAt: 1000,
        updatedAt: 1000,
      },
    ]
    localStorage.setItem('ai-api-config-presets', JSON.stringify(migratedPresets))

    const setApiKeyMock = window.aiKeyApi!.setApiKey as ReturnType<typeof vi.fn>
    setApiKeyMock.mockClear()

    // 触发迁移
    migrateLegacyPresets()

    // 验证：不应再次调用 setApiKey（已迁移过）
    expect(setApiKeyMock).not.toHaveBeenCalled()
  })

  // ==========================================================================
  // 5. 非 Electron 环境 fallback：saveApiKey 写入 preset.apiKey 字段（localStorage）
  // ==========================================================================

  test('5. 非 Electron 环境（window.aiKeyApi 不可用）saveApiKey fallback 到 localStorage', async () => {
    // 移除 window.aiKeyApi（模拟非 Electron 环境）
    delete (window as { aiKeyApi?: unknown }).aiKeyApi

    const presetId = useApiConfigStore.getState().createPreset({
      name: 'Fallback Test',
      endpoint: 'https://api.deepseek.com/v1/chat/completions',
      apiKey: '',
      models: ['deepseek-chat'],
    })

    // 保存 API Key（应 fallback 到 preset.apiKey 字段）
    await useApiConfigStore.getState().saveApiKey(presetId, 'sk-fallback-key')

    // 验证：preset.apiKey 应为 'sk-fallback-key'（写入 localStorage）
    const preset = useAIStore_getPreset(presetId)
    expect(preset?.apiKey).toBe('sk-fallback-key')
    expect(preset?.provider).toBe('deepseek')

    // resolveApiKey 也应 fallback 到 preset.apiKey 字段
    const resolved = await useApiConfigStore.getState().resolveApiKey(presetId)
    expect(resolved).toBe('sk-fallback-key')
  })

  // ==========================================================================
  // 6. saveApiKey 失败时 fallback 到 localStorage（向后兼容）
  // ==========================================================================

  test('6. saveApiKey via aiKeyApi.setApiKey 失败时 fallback 到 preset.apiKey（向后兼容）', async () => {
    const presetId = useApiConfigStore.getState().createPreset({
      name: 'Error Fallback',
      endpoint: 'https://api.deepseek.com/v1/chat/completions',
      apiKey: '',
      models: ['deepseek-chat'],
    })

    // 让 window.aiKeyApi.setApiKey 抛错
    const setApiKeyMock = window.aiKeyApi!.setApiKey as ReturnType<typeof vi.fn>
    setApiKeyMock.mockRejectedValueOnce(new Error('safeStorage encryption failed'))

    // 抑制 console.error
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    // 保存 API Key（应 fallback 到 preset.apiKey）
    await useApiConfigStore.getState().saveApiKey(presetId, 'sk-should-fallback')

    // 验证：preset.apiKey 应为 'sk-should-fallback'（fallback 到 localStorage）
    const preset = useAIStore_getPreset(presetId)
    expect(preset?.apiKey).toBe('sk-should-fallback')
    expect(preset?.provider).toBe('deepseek')

    errorSpy.mockRestore()
  })

  // ==========================================================================
  // 7. resolveApiKey 失败时 fallback 到 preset.apiKey（向后兼容）
  // ==========================================================================

  test('7. resolveApiKey via aiKeyApi.getApiKey 失败时 fallback 到 preset.apiKey', async () => {
    const presetId = useApiConfigStore.getState().createPreset({
      name: 'Resolve Fallback',
      endpoint: 'https://api.deepseek.com/v1/chat/completions',
      apiKey: 'sk-fallback-for-resolve', // preset 中存了明文（fallback 场景）
      models: ['deepseek-chat'],
    })

    // 让 window.aiKeyApi.getApiKey 抛错
    const getApiKeyMock = window.aiKeyApi!.getApiKey as ReturnType<typeof vi.fn>
    getApiKeyMock.mockRejectedValueOnce(new Error('safeStorage decryption failed'))

    // 抑制 console.error
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    // 读取 API Key（应 fallback 到 preset.apiKey）
    const resolved = await useApiConfigStore.getState().resolveApiKey(presetId)

    expect(resolved).toBe('sk-fallback-for-resolve')

    errorSpy.mockRestore()
  })

  // ==========================================================================
  // 8. resolveApiKey 对不存在的 preset 返回 null
  // ==========================================================================

  test('8. resolveApiKey 对不存在的 presetId 返回 null', async () => {
    const resolved = await useApiConfigStore.getState().resolveApiKey('non-existent-preset-id')
    expect(resolved).toBeNull()
  })

  // ==========================================================================
  // 9. setActivePreset + 持久化集成
  // ==========================================================================

  test('9. setActivePreset 持久化到 localStorage（端到端）', () => {
    const preset1 = useApiConfigStore.getState().createPreset({
      name: 'Preset 1',
      endpoint: 'https://api.deepseek.com',
      apiKey: '',
      models: ['m1'],
    })
    const preset2 = useApiConfigStore.getState().createPreset({
      name: 'Preset 2',
      endpoint: 'https://api.openai.com',
      apiKey: '',
      models: ['m2'],
    })

    // 设置 activePresetId 为 preset2
    useApiConfigStore.getState().setActivePreset(preset2)

    // 验证 store 状态
    expect(useApiConfigStore.getState().activePresetId).toBe(preset2)

    // 验证 localStorage 持久化
    const storedActive = localStorage.getItem('ai-api-config-active-preset')
    expect(storedActive).toBe(preset2)

    // 切换到 preset1
    useApiConfigStore.getState().setActivePreset(preset1)
    expect(localStorage.getItem('ai-api-config-active-preset')).toBe(preset1)
  })
})

// ============================================================================
// 辅助函数：从 store 读取 preset（避免与 window.aiKeyApi 状态冲突）
// ============================================================================

function useAIStore_getPreset(presetId: string): ApiConfigPreset | undefined {
  return useApiConfigStore.getState().getPreset(presetId)
}
