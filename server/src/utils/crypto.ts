import { timingSafeEqual, scryptSync, randomBytes } from 'node:crypto'

/**
 * 恒定时间字符串比较，防止时序攻击。
 * 长度不等时直接返回 false（会泄露长度信息，但单用户密码场景可接受）。
 */
export function safeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  return timingSafeEqual(Buffer.from(a), Buffer.from(b))
}

// ============================================================================
// Phase 4：多用户系统密码哈希（使用 Node.js 内置 crypto.scrypt，无新依赖）
// ============================================================================

const SCRYPT_KEYLEN = 64
const SCRYPT_SALTLEN = 16
const SCRYPT_COST = 16384       // N
const SCRYPT_BLOCK_SIZE = 8     // r
const SCRYPT_PARALLELISM = 1    // p

/**
 * 使用 scrypt 哈希密码，返回格式：`scrypt:N:r:p:saltHex:hashHex`
 * salt 随机生成，每次哈希结果不同。
 */
export function hashPassword(password: string): string {
  const salt = randomBytes(SCRYPT_SALTLEN)
  const hash = scryptSync(password, salt, SCRYPT_KEYLEN, {
    N: SCRYPT_COST,
    r: SCRYPT_BLOCK_SIZE,
    p: SCRYPT_PARALLELISM,
  })
  return `scrypt:${SCRYPT_COST}:${SCRYPT_BLOCK_SIZE}:${SCRYPT_PARALLELISM}:${salt.toString('hex')}:${hash.toString('hex')}`
}

/**
 * 验证密码是否匹配哈希。
 * 支持格式：`scrypt:N:r:p:saltHex:hashHex`
 * 使用 timingSafeEqual 防止时序攻击。
 */
export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split(':')
  if (parts.length !== 6 || parts[0] !== 'scrypt') {
    return false
  }
  const N = parseInt(parts[1], 10)
  const r = parseInt(parts[2], 10)
  const p = parseInt(parts[3], 10)
  const salt = Buffer.from(parts[4], 'hex')
  const expectedHash = Buffer.from(parts[5], 'hex')
  if (!N || !r || !p || salt.length === 0 || expectedHash.length === 0) {
    return false
  }
  const hash = scryptSync(password, salt, expectedHash.length, { N, r, p })
  return timingSafeEqual(hash, expectedHash)
}
