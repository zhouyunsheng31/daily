import { app, safeStorage } from 'electron'
import { join } from 'path'
import * as fs from 'fs'

/**
 * API Key 加密存储（Phase 9 模块 4）
 *
 * 用 Electron safeStorage 加密（Windows: DPAPI，macOS: Keychain，Linux: libsecret）
 * 存储位置：app.getPath('userData')/ai-keys.json（密文）
 *
 * 替代 useApiConfigStore.ts 的明文 localStorage 方案（apiKey 字段）。
 *
 * 数据结构（Bug K 修复后）：
 * - activeProvider 拆为独立字段，与 keys 同级
 * - keys 是 provider → entry 映射
 */

/** 单个 provider 的加密条目 */
export interface ApiKeyEntry {
  /** base64 编码的加密后 API Key（safeStorage 不可用时为明文 fallback） */
  encryptedKey: string
  endpoint: string
  model: string
}

/** 持久化存储结构 */
export interface ApiKeyStoreData {
  /** 当前激活的 provider */
  activeProvider: string
  /** provider → entry 映射 */
  keys: Record<string, ApiKeyEntry>
}

/** 空存储（首次启动或文件损坏时使用） */
function emptyStore(): ApiKeyStoreData {
  return { activeProvider: '', keys: {} }
}

/**
 * API Key 存储（主进程单例）
 *
 * 设计要点：
 * - safeStorage 在 dev 模式下可能不可用（macOS 钥匙串未解锁），有明文 fallback
 * - 文件路径：app.getPath('userData')/ai-keys.json（系统默认在 %APPDATA%，非项目目录）
 * - 加密后的密文以 base64 字符串存储，便于 JSON 序列化
 */
class ApiKeyStore {
  /** 获取存储文件路径 */
  private getStorePath(): string {
    return join(app.getPath('userData'), 'ai-keys.json')
  }

  /**
   * 读取所有配置（不解密 apiKey，返回原始 store 结构）
   * 文件不存在或解析失败时返回空 store
   */
  loadStore(): ApiKeyStoreData {
    const path = this.getStorePath()
    if (!fs.existsSync(path)) return emptyStore()
    try {
      const content = fs.readFileSync(path, 'utf-8')
      const parsed = JSON.parse(content) as Partial<ApiKeyStoreData>
      // 兼容旧版数据格式（无 activeProvider / keys 字段时的兜底）
      return {
        activeProvider: parsed.activeProvider ?? '',
        keys: parsed.keys ?? {},
      }
    } catch (err) {
      console.error('[ApiKeyStore] Failed to read store:', err)
      return emptyStore()
    }
  }

  /** 写入所有配置（覆盖写） */
  saveStore(data: ApiKeyStoreData): void {
    const path = this.getStorePath()
    try {
      // 确保 userData 目录存在（正常情况下一定存在，但兜底）
      const dir = app.getPath('userData')
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true })
      }
      fs.writeFileSync(path, JSON.stringify(data, null, 2))
    } catch (err) {
      console.error('[ApiKeyStore] Failed to write store:', err)
      throw err
    }
  }

  /**
   * 设置 provider 的 API Key（加密后存入 store）
   *
   * @param provider provider 标识（pi-coding-agent 内置：'deepseek'/'openai'/'anthropic'/'google'）
   * @param apiKey 明文 API Key
   * @param endpoint API endpoint URL
   * @param model 默认 model 名
   */
  setApiKey(provider: string, apiKey: string, endpoint: string, model: string): void {
    // 拒绝保存空 apiKey（防止根因再发：encryptedKey 存在但解密为空）
    if (!apiKey) {
      console.warn(`[ApiKeyStore] Refusing to save empty apiKey for provider ${provider}`)
      return
    }

    const store = this.loadStore()

    let encryptedKey: string
    if (!safeStorage.isEncryptionAvailable()) {
      console.warn('[ApiKeyStore] safeStorage encryption not available, storing plaintext (fallback)')
      // Fallback：明文存（仅 Linux 无 libsecret 时，Windows/macOS 一定可用）
      encryptedKey = apiKey
    } else {
      // safeStorage.encryptString 返回 Buffer，转 base64 便于 JSON 序列化
      encryptedKey = safeStorage.encryptString(apiKey).toString('base64')
    }

    store.keys[provider] = { encryptedKey, endpoint, model }
    this.saveStore(store)
  }

  /**
   * 读取 provider 的 API Key（解密后返回明文）
   *
   * @param provider provider 标识
   * @returns 明文 API Key，未配置或解密失败时返回 null
   */
  getApiKey(provider: string): string | null {
    const store = this.loadStore()
    const entry = store.keys[provider]
    if (!entry) return null

    let apiKey: string
    if (safeStorage.isEncryptionAvailable()) {
      try {
        // 从 base64 还原 Buffer，再解密为明文
        apiKey = safeStorage.decryptString(Buffer.from(entry.encryptedKey, 'base64'))
      } catch (err) {
        console.error(`[ApiKeyStore] Failed to decrypt key for ${provider}:`, err)
        return null
      }
    } else {
      // Fallback：明文（Linux 无 libsecret 时，或之前用明文存的旧数据）
      apiKey = entry.encryptedKey
    }

    return apiKey
  }

  /**
   * 读取 provider 的完整配置（apiKey 解密 + endpoint + model）
   * 用于 LocalAgentService 创建 session 时一次性获取所有参数
   */
  getConfig(provider: string): { provider: string; apiKey: string; endpoint: string; model: string } | null {
    const store = this.loadStore()
    const entry = store.keys[provider]
    if (!entry) return null

    let apiKey: string
    if (safeStorage.isEncryptionAvailable()) {
      try {
        apiKey = safeStorage.decryptString(Buffer.from(entry.encryptedKey, 'base64'))
      } catch (err) {
        console.error(`[ApiKeyStore] Failed to decrypt key for ${provider}:`, err)
        return null
      }
    } else {
      apiKey = entry.encryptedKey
    }

    return {
      provider,
      apiKey,
      endpoint: entry.endpoint,
      model: entry.model,
    }
  }

  /** 设置当前激活的 provider */
  setActiveProvider(provider: string): void {
    const store = this.loadStore()
    store.activeProvider = provider
    this.saveStore(store)
  }

  /** 获取当前激活的 provider（未设置时返回 null） */
  getActiveProvider(): string | null {
    const store = this.loadStore()
    return store.activeProvider || null
  }

  /** 删除指定 provider 的配置 */
  deleteApiKey(provider: string): void {
    const store = this.loadStore()
    delete store.keys[provider]
    // 如果删除的是 activeProvider，清空（不再 delete 字段，保持类型一致）
    if (store.activeProvider === provider) {
      store.activeProvider = ''
    }
    this.saveStore(store)
  }

  /** 列出所有已配置的 provider（store.keys 的所有 key） */
  listProviders(): string[] {
    const store = this.loadStore()
    return Object.keys(store.keys)
  }
}

/** 主进程单例 */
export const apiKeyStore = new ApiKeyStore()
