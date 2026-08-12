/**
 * AI UI Layer Types
 *
 * Migrated from src/ai/types.ts in Phase 0 (event-simplification-v3 §3.4).
 * These types are used by non-ai/ files (UI layer) and must survive the
 * Phase 1 deletion of the ai/ directory.
 *
 * Note: ai/-internal types (ExecutionContext, ToolDefinition, AuditLogRecord,
 * ToolResult, etc.) are NOT migrated — they are deleted with the ai/ directory.
 */

// ===== Confirmation Token =====

/** Confirmation token type — distinguishes write vs dangerous */
export type ConfirmationTokenType = 'write' | 'dangerous'

// ===== Tool Call =====

/** AI tool call request (from LLM function calling) */
export interface ToolCallRequest {
  id: string
  name: string
  arguments: Record<string, unknown>
}

// ===== Tool Result (used by PermissionRequest.dryRunResult) =====

/** Tool execution result */
export interface ToolResult {
  success: boolean
  data?: unknown
  error?: ToolError
}

/** Tool error (structured) */
export interface ToolError {
  code: 'INVALID_PARAMS' | 'NOT_FOUND' | 'PERMISSION_DENIED' | 'EXECUTION_FAILED' | 'IDEMPOTENT_CONFLICT' | 'CAPABILITY_EXPIRED' | 'CAPABILITY_DENIED' | 'TOKEN_EXPIRED' | 'TOKEN_REPLAY'
  message: string
  recoverable: boolean
}

// ===== Permission =====

/**
 * Four-tier permission model
 * - read_public: auto-execute (e.g. widget list, panel info)
 * - read_private: per-store authorization, store-level granularity, auto within session after auth
 * - write: single confirmation with confirmationToken
 * - dangerous: double confirmation + irreversible warning
 */
export type PermissionLevel = 'read_public' | 'read_private' | 'write' | 'dangerous'

/**
 * High-sensitivity store list — these stores' read_private authorization must be independently confirmed
 * Cannot be merged with other store authorizations
 */
export const HIGH_SENSITIVITY_STORES = [
  'journals',
  'moodEntries',
  'savingsGoals',
  'savingsTransactions',
] as const

export interface PermissionRequest {
  /** A6 补充：关联的 sessionId（用于 watchdog 清理 pending 条目） */
  sessionId: string
  toolName: string
  permission: PermissionLevel
  /** Bound storeName (required for read_private level) */
  storeName?: string
  arguments: Record<string, unknown>
  description: string
  dryRunResult?: ToolResult
  /** Whether this is an irreversible operation */
  irreversible?: boolean
  /** Confirmation token type */
  tokenType?: ConfirmationTokenType
  /** callerWidgetId — for routing permission requests to the correct AIAssistant widget / AIAssistantSidebar */
  callerWidgetId?: string
}

export interface PermissionResponse {
  approved: boolean
  rememberChoice?: boolean
}

// ===== Data Send Preview =====

/**
 * Data send preview — mandatory execution gate
 * Not optional UI, but a hard boundary check before data is sent
 */
export interface DataSendPreview {
  /** Included data source list */
  includedStores: string[]
  /** Per-data-source send content summary (sanitized) */
  storeSummaries: Array<{
    storeName: string
    /** Sanitization level: full=complete, abstract=summary, redacted=sanitized, excluded=not sent */
    sanitizationLevel: 'full' | 'abstract' | 'redacted' | 'excluded'
    /** Summary description */
    description: string
  }>
  /** Estimated send token count */
  estimatedTokens: number
  /** Whether user confirmation is required (true on first send / new data category / new store auth / model switch) */
  requiresConfirmation: boolean
  /** Confirmation reason */
  confirmationReason?: 'first_send' | 'new_data_category' | 'new_store_authorized' | 'model_switched'
}

// ===== Chat Message =====

/** askUserQuestion 选项（模块D） */
export interface AskUserOption {
  label: string
  description?: string
  value: string
}

/** Chat message */
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
  toolCalls?: ToolCallRequest[]
  toolCallId?: string  // role='tool' associated tool call ID
  timestamp: number
  // === Phase 8 批次5 模块D：askUserQuestion 字段 ===
  askUser?: {
    requestId: string
    question: string
    options: AskUserOption[]
    allowMultiple: boolean
    answered: boolean
    selectedValues?: string[]
  }
}

// ===== Session State =====

/** Session state */
export interface SessionState {
  sessionId: string
  messages: ChatMessage[]
  createdAt: number
  updatedAt: number
  /** @deprecated 由 modelId 取代，向后兼容保留 */
  model: string
  status: 'idle' | 'thinking' | 'tool_calling' | 'waiting_confirmation' | 'waiting_user_input' | 'error'
  error?: string
  // === Phase 8 批次3 新增字段 ===
  /** 会话名称（用户可重命名） */
  title: string
  /** 绑定的面板 ID（null = 未绑定） */
  boundPanelId: string | null
  /** 使用的 API 配置预设 ID */
  apiConfigId: string
  /** 当前选用的 model（从 apiConfig 的 models 中选，取代 model 字段） */
  modelId: string
  /**
   * Currently authorized read_private store list for this session
   * Authorization granularity: store level (not field level, MVP no over-engineering)
   * Each store must be independently authorized
   * High-sensitivity categories (journals, moodEntries, savingsGoals, savingsTransactions) must be independently authorized
   */
  authorizedPrivateStores: string[]
  /** Whether first data send confirmation has been completed */
  hasConfirmedFirstSend: boolean
  /** Set of confirmed data categories for sending */
  confirmedDataCategories: Set<string>
  /** Confirmed model */
  confirmedModel: string | null
  /** AI assistant role/persona (e.g. "生活助手", "学习助手") */
  role: string
  /** Pending data send preview waiting for user confirmation */
  pendingSendPreview?: DataSendPreview
}

// ===== Privacy =====

/**
 * Privacy settings
 * Core principle: no personal data is read by default, only after explicit user authorization
 */
export interface PrivacySettings {
  /** Whether user has accepted the privacy notice */
  hasAcceptedPrivacyNotice: boolean
  /**
   * AI-readable store list (default empty array, only readable after explicit user authorization)
   * Persisted as JSON array
   * New stores are NOT in the list by default (not readable)
   */
  aiReadableStores: string[]
  /**
   * API Key encrypted storage info
   * Default: API Key not persisted (session-only)
   * User can choose to save; when saving, uses user-input passphrase to derive key via PBKDF2
   */
  apiKeyStorage: ApiKeyStorage | null
}

/**
 * API Key encrypted storage info
 * Uses user passphrase + PBKDF2 derived key, AES-256-GCM encryption
 */
export interface ApiKeyStorage {
  /** PBKDF2 salt (Base64, 16 random bytes per encryption) */
  salt: string
  /** AES-GCM IV (Base64, 12 random bytes per encryption) */
  iv: string
  /** AES-GCM authentication tag (Base64, 16 bytes) */
  tag: string
  /** Encryption version, currently 1 */
  version: 1
  /** Encrypted API Key (Base64) */
  encryptedApiKey: string
  /** Encryption timestamp */
  encryptedAt: number
}

/** API Key storage mode */
export type ApiKeyStorageMode = 'session' | 'persistent'

// ===== LLM Backend Types (used by useAIStore, will be removed in Phase 2 when useAIStore is rewritten) =====

export interface LLMConfig {
  endpoint: string
  apiKey: string
  model: string
  fallbackModel?: string
  maxTokens: number
  temperature: number
}

export interface LLMResponse {
  content: string | null
  toolCalls?: ToolCallRequest[]
  finishReason: 'stop' | 'tool_calls' | 'length' | 'error'
  usage?: {
    promptTokens: number
    completionTokens: number
    totalTokens: number
  }
}

export type LLMStreamEvent =
  | { type: 'content'; content: string }
  | { type: 'reasoning'; content: string }
  | { type: 'tool_call'; toolCall: Partial<ToolCallRequest> }
  | { type: 'done'; finishReason: string; usage?: { promptTokens: number; completionTokens: number; totalTokens: number } }
  | { type: 'error'; error: string }

// ===== Phase 12: AI 搜索集成类型 =====

export type LocalSearchableType =
  | 'panel' | 'task' | 'calendarEvent' | 'habit' | 'note' | 'journal'
  | 'quickNote' | 'mistake' | 'vocabDeck' | 'vocabProgress' | 'panelTemplate'
  | 'bookmark' | 'webTab' | 'widget' | 'dynamicWidget' | 'htmlWidget'
  | 'favorite' | 'aiConversation' | 'aiMemory' | 'moodEntry'
  | 'savingsTransaction' | 'drawingStroke' | 'widgetConnection' | 'focusSession'

export interface LocalSearchParams {
  query: string
  type?: LocalSearchableType
  limit?: number
}

export interface LocalSearchHit {
  type: LocalSearchableType
  id: string
  title: string
  snippet: string
  location: string
  panelId?: string
  score: number
}

export interface LocalSearchResult {
  results: LocalSearchHit[]
  total: number
  tookMs: number
}

export type SearchSourceKind = 'local' | 'web' | 'academic' | 'github'

export interface WebSearchHit {
  title: string
  url: string
  snippet: string
  summary?: string
  siteName?: string
  siteIcon?: string
  datePublished?: string
}

export interface AcademicPaper {
  paperId: string                  // = arxivId，保留以兼容客户端
  title: string
  abstract: string
  authors: string[]
  year: number
  venue: string                    // 固定 'ArXiv'，保留以兼容客户端
  citationCount: number            // 固定 0，保留以兼容客户端
  openAccessPdf?: { url: string; status: string }  // status 固定 'GREEN'
  externalIds?: { ArXiv?: string }  // 仅保留 ArXiv，移除 DOI（Phase S11：S2 移除）
  publicationDate?: string         // ISO YYYY-MM-DD
  // ArXiv 特有字段（Phase S11：S2 移除后新增）
  absUrl?: string                  // ArXiv abs 页面 URL
  categories?: string[]            // ArXiv 分类列表
  primaryCategory?: string         // ArXiv 主分类
}

export interface GithubRepoHit {
  id: number
  fullName: string
  description: string
  htmlUrl: string
  stargazersCount: number
  forksCount: number
  language: string
  updatedAt: string
  topics?: string[]
}

// S14.2-T3：GitHub 搜索子类型（spec 3.3 节）
// S14 修复：字段名 repository → repo，与 server searchApi.ts callGitHub 返回对齐
export interface GithubCodeHit {
  name: string
  path: string
  htmlUrl: string
  repo: { fullName: string; htmlUrl?: string }
  score?: number
}

export interface GithubUserHit {
  login: string
  htmlUrl: string
  avatarUrl: string
  type: string
  bio?: string
  publicRepos?: number
  followers?: number
}

export interface GithubIssueHit {
  number: number
  title: string
  state: string
  htmlUrl: string
  repo: { fullName: string }  // S14 修复：repository? → repo（必填，与 server 对齐）
  createdAt: string
  updatedAt: string
}

export interface GithubDownloadResult {
  mode: 'download_repo_zip' | 'download_release' | 'download_file'
  downloadUrl: string  // 代理 URL，可点击下载
  fileName: string   // S14 修复：可选 → 必填（server 总是返回）
  size: number       // S14 修复：fileSize? → size: number（必填，与 server 对齐）
  sha?: string
  assetId?: number
  owner?: string
  repo?: string
  ref?: string
  path?: string
}

// 工具名 → SearchSourceKind 映射（避免字符串 replace 的脆弱性）
export const SEARCH_TOOL_KIND_MAP: Record<string, SearchSourceKind> = {
  local_search: 'local',
  web_search: 'web',
  academic_search: 'academic',
  github_search: 'github',
}

export const SEARCH_TOOL_NAMES = new Set(Object.keys(SEARCH_TOOL_KIND_MAP))

export function isSearchTool(toolName: string): boolean {
  return SEARCH_TOOL_NAMES.has(toolName)
}

/** 类型守卫 */
export function isLocalSearchResult(data: unknown): data is LocalSearchResult {
  return (
    typeof data === 'object' && data !== null &&
    'results' in data && Array.isArray((data as LocalSearchResult).results) &&
    'total' in data && typeof (data as LocalSearchResult).total === 'number'
  )
}

export interface SearchSourceEntry {
  id: string  // 唯一 ID（uuid）
  requestId: string
  toolName: string
  kind: SearchSourceKind
  query: string
  // 用 ReadonlyArray<联合类型> 而非 联合数组类型，避免 TS 严格模式下 push 等操作受限
  // S14.2-T5：hits 联合类型扩展为包含新增的 4 个 GitHub 子类型
  hits: ReadonlyArray<LocalSearchHit | WebSearchHit | AcademicPaper | GithubRepoHit | GithubCodeHit | GithubUserHit | GithubIssueHit | GithubDownloadResult>
  total: number
  tookMs?: number
  timestamp: number
  // S14.2 新增字段（可选，仅 github_search 使用）
  mode?: string
  // S15 修复：items 类型从 unknown[] 改为与 hits 相同的联合类型（修复 TS2322）
  items?: ReadonlyArray<LocalSearchHit | WebSearchHit | AcademicPaper | GithubRepoHit | GithubCodeHit | GithubUserHit | GithubIssueHit | GithubDownloadResult>
  download?: GithubDownloadResult
}
