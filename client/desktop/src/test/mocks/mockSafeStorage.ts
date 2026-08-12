/**
 * MockSafeStorage（Phase 11.1）
 *
 * 模拟 Electron 的 safeStorage 模块（主进程 IPC 测试用）：
 *   - encryptString(s) → Buffer（用 UTF-8 直接编码，不是真实加密）
 *   - decryptString(b) → string（UTF-8 解码）
 *   - isEncryptionAvailable() → true
 *
 * 用法：
 *   import { mockSafeStorage } from '@/test/mocks/mockSafeStorage'
 *   vi.mock('electron', () => ({ safeStorage: mockSafeStorage }))
 *
 * 验证点（测试用例可断言）：
 *   - mockSafeStorage.isEncryptionAvailable() === true
 *   - mockSafeStorage.decryptString(mockSafeStorage.encryptString('hello')) === 'hello'
 *   - encryptString 返回 Buffer 实例
 */
export const mockSafeStorage = {
  /** 加密字符串（mock：直接 UTF-8 编码，非真实加密） */
  encryptString(s: string): Buffer {
    return Buffer.from(s, 'utf8')
  },

  /** 解密 Buffer（mock：UTF-8 解码） */
  decryptString(b: Buffer): string {
    return b.toString('utf8')
  },

  /** 加密是否可用（mock：永远返回 true） */
  isEncryptionAvailable(): boolean {
    return true
  },

  /** （Electron 30+）加密字符串为 Buffer（plainTextString 变体） */
  encryptStringSync: undefined as ((s: string) => Buffer) | undefined,
}

/**
 * 创建可控的 mockSafeStorage（可指定 isEncryptionAvailable 返回值，便于测试 fallback 逻辑）
 */
export function createMockSafeStorage(options?: {
  isAvailable?: boolean
  encryptImpl?: (s: string) => Buffer
  decryptImpl?: (b: Buffer) => string
}): typeof mockSafeStorage {
  const isAvailable = options?.isAvailable ?? true
  return {
    encryptString: options?.encryptImpl ?? ((s: string) => Buffer.from(s, 'utf8')),
    decryptString: options?.decryptImpl ?? ((b: Buffer) => b.toString('utf8')),
    isEncryptionAvailable: () => isAvailable,
    encryptStringSync: undefined,
  }
}

/** 不可用的 safeStorage（测试 fallback 时使用，如未启用密钥链） */
export const unavailableMockSafeStorage = createMockSafeStorage({ isAvailable: false })
