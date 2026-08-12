// ============================================================================
// Phase S4：输入净化工具（spec 9.5 节安全考虑）
// 防止 prompt injection、过大 payload、控制字符注入
// ============================================================================

/** 各类输入的长度上限（字节） */
export const LENGTH_LIMITS = {
  PROMPT: 50_000,           // 单条提示词 50KB
  SKILL_CONTENT: 100_000,   // skill SKILL.md 内容 100KB
  SKILL_NAME: 128,          // skill 名称
  SKILL_DESCRIPTION: 1_000, // skill 描述
  API_KEY: 500,             // API key
  MODEL_NAME: 100,          // 模型名
  ENDPOINT_URL: 500,        // endpoint URL
} as const

/**
 * 去除控制字符（保留 \n \r \t）
 * 防止注入控制字符干扰 LLM 解析
 */
export function stripControlChars(s: string): string {
  // 保留 \n (0x0A) \r (0x0D) \t (0x09)，去除其他控制字符
  // eslint-disable-next-line no-control-regex
  return s.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
}

/**
 * 检测 prompt injection 攻击模式
 * 检测到危险模式返回错误描述字符串（用于抛错 message），未检测到返回 null
 *
 * 检测规则（使用精确正则匹配 + 上下文匹配，避免误报）：
 *
 * 1. 指令劫持（必须含"指令/instructions"上下文词）：
 *    - /忽略以上.{0,20}指令/      （中文，无 i flag）
 *    - /ignore (all )?(previous|above) instructions/i
 *    - /forget (all|previous) (instructions|rules)/i
 *    - /disregard (all|previous) (instructions|rules)/i
 *
 * 2. 角色越权（必须含明确越权动作词）：
 *    - /you are now (a|an|the) /i
 *    - /new role\s*:/i
 *    - /pretend to be (a|an|the) /i
 *    - /disregard your (role|instructions|rules)/i
 *
 *    注：不检测 "act as" 模式——该短语在正常英文文档中常见（如 "act as a helper"），
 *    误报率高；角色越权场景由 "pretend to be" 和 "you are now" 覆盖。
 *
 * 3. 系统提示词泄漏（必须含"system prompt/instructions/rules"目标词）：
 *    - /show (me )?(your )?(system prompt|instructions|rules)/i
 *    - /reveal (your )?(system prompt|instructions|rules)/i
 *    - /print (your )?(system prompt|instructions|rules)/i
 *    - /what (is|are) your (system prompt|instructions|rules)/i
 *
 * 4. 越权指令（必须含"rules/restrictions/system"目标词）：
 *    - /do not follow (your )?(rules|instructions)/i
 *    - /override (the )?(system|rules|instructions)/i
 *    - /you have no (restrictions|rules|limits)/i
 *
 * 5. 数据外泄（必须含"conversation/data/content"目标词 + "external/send/post"动作）：
 *    - /send (this|the) conversation to /i
 *    - /exfiltrate (the )?(data|conversation|content)/i
 *    - /post (this|the) (to|on) external /i
 *
 * 注意：仅做基本检测，无法覆盖所有变体。配合 LLM 自身防御 + 服务端沙箱。
 * 关键词使用上下文匹配（必须同时含动作词 + 目标词），避免误报正常中文/英文表达。
 */
export function detectPromptInjection(s: string): string | null {
  const rules: Array<{ pattern: RegExp; reason: string }> = [
    // 1. 指令劫持（中文规则无 i flag，英文规则带 i flag）
    { pattern: /忽略以上.{0,20}指令/, reason: 'instruction hijacking (忽略以上...指令)' },
    { pattern: /ignore (all )?(previous|above) instructions/i, reason: 'instruction hijacking (ignore previous/above instructions)' },
    { pattern: /forget (all|previous) (instructions|rules)/i, reason: 'instruction hijacking (forget instructions/rules)' },
    { pattern: /disregard (all|previous) (instructions|rules)/i, reason: 'instruction hijacking (disregard instructions/rules)' },

    // 2. 角色越权（不检测 "act as" —— 正常英文文档常见，误报率高）
    { pattern: /you are now (a|an|the) /i, reason: 'role hijacking (you are now a/an/the)' },
    { pattern: /new role\s*:/i, reason: 'role hijacking (new role:)' },
    { pattern: /pretend to be (a|an|the) /i, reason: 'role hijacking (pretend to be a/an/the)' },
    { pattern: /disregard your (role|instructions|rules)/i, reason: 'role hijacking (disregard your role/instructions/rules)' },

    // 3. 系统提示词泄漏
    { pattern: /show (me )?(your )?(system prompt|instructions|rules)/i, reason: 'system prompt leakage (show)' },
    { pattern: /reveal (your )?(system prompt|instructions|rules)/i, reason: 'system prompt leakage (reveal)' },
    { pattern: /print (your )?(system prompt|instructions|rules)/i, reason: 'system prompt leakage (print)' },
    { pattern: /what (is|are) your (system prompt|instructions|rules)/i, reason: 'system prompt leakage (what is/are your)' },

    // 4. 越权指令
    { pattern: /do not follow (your )?(rules|instructions)/i, reason: 'privilege override (do not follow rules/instructions)' },
    { pattern: /override (the )?(system|rules|instructions)/i, reason: 'privilege override (override system/rules/instructions)' },
    { pattern: /you have no (restrictions|rules|limits)/i, reason: 'privilege override (you have no restrictions/rules/limits)' },

    // 5. 数据外泄
    { pattern: /send (this|the) conversation to /i, reason: 'data exfiltration (send conversation to)' },
    { pattern: /exfiltrate (the )?(data|conversation|content)/i, reason: 'data exfiltration (exfiltrate data/conversation/content)' },
    { pattern: /post (this|the) (to|on) external /i, reason: 'data exfiltration (post to/on external)' },
  ]
  for (const { pattern, reason } of rules) {
    if (pattern.test(s)) {
      return reason
    }
  }
  return null
}

/**
 * 净化提示词内容（plain text，非 markdown）
 * - 去除控制字符
 * - 限制长度
 * - 不去除 HTML 标签（提示词可能 legitimately 包含 HTML 示例）
 * - 检测 prompt injection 攻击模式
 */
export function sanitizePromptInput(s: unknown, maxLength: number = LENGTH_LIMITS.PROMPT): string {
  if (typeof s !== 'string') {
    throw new Error('expected string input')
  }
  const cleaned = stripControlChars(s)
  if (cleaned.length > maxLength) {
    throw new Error(`prompt content exceeds length limit (${maxLength} chars, got ${cleaned.length})`)
  }
  const injection = detectPromptInjection(cleaned)
  if (injection) {
    throw new Error(`prompt content contains potential prompt injection pattern: ${injection}`)
  }
  return cleaned
}

/**
 * 净化 skill 内容（markdown，允许换行、代码块）
 * - 去除控制字符
 * - 限制长度
 * - 检测 prompt injection 攻击模式
 */
export function sanitizeSkillContent(s: unknown, maxLength: number = LENGTH_LIMITS.SKILL_CONTENT): string {
  if (typeof s !== 'string') {
    throw new Error('expected string input')
  }
  const cleaned = stripControlChars(s)
  if (cleaned.length > maxLength) {
    throw new Error(`skill content exceeds length limit (${maxLength} chars, got ${cleaned.length})`)
  }
  const injection = detectPromptInjection(cleaned)
  if (injection) {
    throw new Error(`skill content contains potential prompt injection pattern: ${injection}`)
  }
  return cleaned
}

/**
 * 净化短文本（名称、描述等）
 * - 去除控制字符（含换行）
 * - trim
 * - 限制长度
 */
export function sanitizeShortText(s: unknown, maxLength: number): string {
  if (typeof s !== 'string') {
    throw new Error('expected string input')
  }
  // 短文本不允许换行
  const cleaned = stripControlChars(s).replace(/[\n\r\t]/g, ' ').trim()
  if (cleaned.length > maxLength) {
    throw new Error(`text exceeds length limit (${maxLength} chars, got ${cleaned.length})`)
  }
  return cleaned
}

/**
 * 净化 API Key
 * - 去除空白
 * - 限制长度
 * - 仅允许字母数字和常见符号（_-）
 */
export function sanitizeApiKey(s: unknown): string {
  if (typeof s !== 'string') {
    throw new Error('expected string input')
  }
  const cleaned = s.trim()
  if (cleaned.length === 0) {
    throw new Error('api key is empty')
  }
  if (cleaned.length > LENGTH_LIMITS.API_KEY) {
    throw new Error(`api key exceeds length limit (${LENGTH_LIMITS.API_KEY} chars)`)
  }
  // 允许字母数字、连字符、下划线、点
  if (!/^[A-Za-z0-9_\-.]+$/.test(cleaned)) {
    throw new Error('api key contains invalid characters (only A-Z a-z 0-9 _ - . allowed)')
  }
  return cleaned
}

/**
 * 净化模型名（格式：provider/model 或 model）
 */
export function sanitizeModelName(s: unknown): string {
  if (typeof s !== 'string') {
    throw new Error('expected string input')
  }
  const cleaned = s.trim()
  if (cleaned.length === 0) {
    throw new Error('model name is empty')
  }
  if (cleaned.length > LENGTH_LIMITS.MODEL_NAME) {
    throw new Error(`model name exceeds length limit (${LENGTH_LIMITS.MODEL_NAME} chars)`)
  }
  // 允许字母数字、连字符、下划线、斜杠、点
  if (!/^[A-Za-z0-9_\-/.]+$/.test(cleaned)) {
    throw new Error('model name contains invalid characters')
  }
  return cleaned
}

/**
 * 净化 endpoint URL
 */
export function sanitizeEndpointUrl(s: unknown): string {
  if (typeof s !== 'string') {
    throw new Error('expected string input')
  }
  const cleaned = s.trim()
  if (cleaned.length === 0) {
    throw new Error('endpoint is empty')
  }
  if (cleaned.length > LENGTH_LIMITS.ENDPOINT_URL) {
    throw new Error(`endpoint url exceeds length limit (${LENGTH_LIMITS.ENDPOINT_URL} chars)`)
  }
  // 必须是 https:// 或 http:// 开头
  if (!/^https?:\/\//i.test(cleaned)) {
    throw new Error('endpoint must start with http:// or https://')
  }
  // 简单 URL 格式校验
  try {
    new URL(cleaned)
  } catch {
    throw new Error('endpoint is not a valid URL')
  }
  return cleaned
}
