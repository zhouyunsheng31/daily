import { Router, type NextFunction, type Request, type Response } from 'express'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import dns from 'node:dns/promises'
import { deflateRawSync } from 'node:zlib'
import { Script as VmScript } from 'node:vm'
import { Type } from 'typebox'
import type { ToolDefinition } from '@earendil-works/pi-coding-agent'
import { getPool } from '../db/connection.js'
import { signTokenForUser, type UserRole } from '../utils/jwt.js'
import { createError } from '../middleware/error.js'
import {
  logAgentAction,
  appFilesRoot,
  resolveAppFilePath,
  resolveWorkspacePath,
  getWorkspaceRoot,
  getUserSkillsDir,
  sysSourceTools,
  workspaceFsTools,
  readLogoFile,
  readAvatarFile,
  readBootConfig,
  workspaceUsedBytes,
  workspaceLimitFor,
  workspaceLimitForState,
  workspaceLimitResolved,
  WORKSPACE_TIER_BYTES,
  resolveUserHomePath,
  sanitizeUploadName,
  isAllowedUploadName,
  workspaceDirName,
  APP_ID_PATTERN,
  PUBLIC_IMAGES_DIR,
  ensurePublicImageCopy,
  removePublicImageCopy,
  type WorkspaceFsHooks,
} from '../utils/webosWorkspace.js'
import { getSandboxRoot } from '../sandbox/index.js'
// 2026-08-14 MiniMax-M3 视觉桥接（AI 的眼睛）：DeepSeek 非视觉，
// 图片/视频经 M3 转文字描述注入对话；用量落 webos_vision_usage（管理后台实时查看）
import {
  describeMedia,
  visionConfigured,
  visionModelName,
} from '../vision/m3Vision.js'
import { WEBOS_DESKTOP_V1_HTML } from '../webosDesktopV1.js'
import { WEBOS_STORE_V1_HTML } from '../webosStoreV1.js'
import { WEBOS_TRASH_V1_HTML } from '../webosTrashV1.js'
// 2026-08-06 服务器负载监控（AI 工具 get_server_status 数据源）
import { getServerStats, serverHealthAlerts, markUserActive } from '../utils/serverMonitor.js'
// 2026-08-02 生图 + 图片编辑：ChatST 图像生成（gpt-image-2-super）+ 图片处理
import { generateImages, recordImageGenUsage, IMAGE_PRICING, imageGenConfigured } from '../imagegen/chatstImage.js'
import { editImage as editImageBuffer, resizePngToSize, imageSizeOf } from '../utils/imageEdit.js'
// 2026-08-02 统一计费（积分制）：DeepSeek 定价（含高峰 ×2）+ 生图定价 + 计费目录
import { chatCostMinor, isDeepSeekPeak, deepSeekPeakMultiplier, billingCatalog, videoCostMinor } from '../billing/pricing.js'
// 2026-08-05 视频生成：MiniMax H3（秘塔渠道）+ H3-Context-IR + 用量/充值统计
import {
  generateVideoAndSave,
  recordVideoUsage,
  videoGenConfigured,
  CONTEXT_IR_PRICE,
} from '../videogen/minimaxVideo.js'
// 2026-08-06 视频处理：FFmpeg（抽帧/精灵图/GIF/去背景/裁剪/拼接等）
import { editVideo as processVideo, ffmpegAvailable, isVideoFile } from '../utils/videoEdit.js'
// 2026-08-06 搜索工具（web_search/read_webpage/academic/github）注入 webOS 会话
import { searchTools } from '../utils/searchTools.js'
// 2026-08-06 爱发电支付（档位定义 / webhook 验签发货 / API 对账）
import { afdianConfigured, AFDIAN_TIERS, handleAfdianOrder, redeemAfdianCode } from '../payment/afdian.js'
// 2026-08-16 系统时间能力：北京时间换算 + 对话时间前缀 + GET /webos/api/time
import { beijingTimePrefix } from './webosTime.js'
// 2026-08-20（W-F File Service 一阶段）：agent_fs_* 双写 files 元数据（manifest 锚点）
import { recordFileStats, recordFileDeleted } from '../webos/files/index.js'
// 2026-08-21（W1 包体系）：文件夹即包 + 校验反馈回路 + 全量扫描（apps/、packages/ 双轨）
import { syncPackageFromFs, syncAllPackagesFromWorkspace } from '../webos/packages/index.js'
// 2026-08-21（W2 App API）：handler 受限 vm + 动态工具 + owner 级端点（deps 由本文件注入防循环）
import { setAppApiDeps, registerDynamicTools } from '../webos/appapi/index.js'
// 2026-08-21（W3 统一包市场 R14）：AI 找包/装包工具（search_market_packages / install_market_package）
import { registerMarketTools } from '../webos/market/index.js'
// 2026-08-22 云服务器远程运维与微信通道管理工具
import { createServerOpsTools } from '../webos/serverOpsTools.js'

// W2 App API 依赖注入：loadState/saveState/chargeCredits 均为本文件函数声明（已提升），
// 模块加载时注册，供 appapi-service 在 invoke 时访问 appStorage/扣积分（避免循环依赖）
setAppApiDeps({
  loadState: loadState as never,
  saveState: saveState as never,
  chargeCredits: chargeCredits as never,
})

// ---------------------------------------------------------------------------
// webOS 专用 skills（.pi/skills-webos/）：受控 skill 目录，AI 可读/写
// - read 工具：读取 skill 文件（同时触发 pi 的 <available_skills> 注入）
// - manage_skill 工具：创建/更新/删除 skill 文件与 reference（myself 等）
// 不开放 .pi/skills/（旧画布 skill 会操作服务器真实 cwd，webOS 会话禁用）
// ---------------------------------------------------------------------------
/** 解析 skills-webos 目录：优先 cwd（server/），回退项目根（../.pi/） */
function resolveWebosSkillsDir(): string {
  const cwd = process.cwd()
  const candidates = [
    path.join(cwd, '.pi', 'skills-webos'),
    path.join(cwd, '..', '.pi', 'skills-webos'),
  ]
  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) return candidate
    } catch { /* 继续尝试下一个 */ }
  }
  return candidates[0]!
}
const SKILLS_WEBOS_DIR = resolveWebosSkillsDir()
const MAX_SKILL_FILE_BYTES = 256 * 1024
// pi 的 skill 名校验：小写字母/数字/连字符（/^[a-z0-9-]+$/），与之一致
const SKILL_NAME_PATTERN = /^[a-z0-9-]{1,32}$/

/**
 * Daily webOS P0 API.
 *
 * This router intentionally lives outside the legacy `/api` namespace.  It is
 * mounted with `authMiddleware` by the server entry point, so the webOS shell
 * can evolve its domain API without changing the legacy Dashboard routes or
 * WebSocket protocol.
 *
 * Until dedicated webOS tables are approved, the small P0 state document is
 * stored as an owned row in the existing `entities` table (`type=webos_state`
 * and a principal-specific scope).  No legacy entity route is used to read or
 * write this state; all ownership checks happen here.
 */

export const webosRouter = Router()

// 动态 API 一律禁止浏览器缓存（bootstrap/apps 等响应含用户私有状态，
// 浏览器启发式缓存会导致用户看到过期桌面/App 版本）。
webosRouter.use((_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store')
  next()
})

type WebOsModel = 'flash'
// DeepSeek 官方思考深度四档（low/medium/high/max），与共享契约 WEBOS_THINKING_LEVELS 一致
type WebOsThinkingLevel = 'low' | 'medium' | 'high' | 'max'
type WebOsAppSource = 'builtin' | 'ai_generated' | 'local_import' | 'store'
type WebOsAppVersionStatus = 'draft' | 'ready' | 'active' | 'rolled_back'
type WebOsEmailBindingState =
  | 'idle'
  | 'email_sent'
  | 'verification_unavailable'
  | 'verified'
  | 'migration_pending'
  | 'migration_complete'
  | 'error'

type PrincipalRole = 'guest' | 'member' | 'admin'

const MODEL: WebOsModel = 'flash'
const THINKING_LEVELS: readonly WebOsThinkingLevel[] = ['low', 'medium', 'high', 'max']
// 默认思考档：medium（DeepSeek V4 Flash 官方四档中的中等思考）。
// 2026-07-31 线上回归：旧 high 档（reasoner 长思考）在 App 生成场景截断+超时；
// 默认取 medium 兼顾速度与质量，App 生成内部固定关闭思考（'off'）。
const DEFAULT_THINKING: WebOsThinkingLevel = 'medium'
const PRIVATE_STORAGE_CAPABILITY = 'app.storage.private'
/** App 内创建新 App 的能力（「权限给足」：所有新 App 默认拥有，可在宿主安全校验下调用） */
const APPS_CREATE_CAPABILITY = 'system.apps.create'
/** App 私有文件系统能力（App 通过 fs API 读写自己的工作区文件夹 apps/<appId>/） */
const APP_FS_CAPABILITY = 'app.fs'
/** 跨 App 共享文件能力（App 通过 fs.shared 读写 shared/ 共享区） */
const APP_FS_SHARED_CAPABILITY = 'app.fs.shared'
/** 所有新 App 的默认能力声明 */
const DEFAULT_APP_CAPABILITIES = [PRIVATE_STORAGE_CAPABILITY, APPS_CREATE_CAPABILITY, APP_FS_CAPABILITY, APP_FS_SHARED_CAPABILITY] as const
const BUILTIN_APPS = [
  { id: 'daily.ai', name: 'Daily AI' },
  { id: 'system.desktop', name: '系统桌面' },
  { id: 'system.store', name: '市场' },
  { id: 'system.files', name: '文件管理器' },
  { id: 'system.trash', name: '回收站' },
] as const

/** 应用商店（2026-08-03）：分享/下载奖励（单位：积分，1 积分 = ¥0.01） */
const STORE_REWARD_CREDITS = 100
/** 外部 API 代理（App 接入自己/第三方 API 用）：每用户每分钟请求上限 */
const HTTP_PROXY_RATE_PER_MINUTE = 30
/** 分享链接基础地址（前端部署路径） */
const APP_BASE_URL = process.env.WEBOS_BASE_URL ?? 'https://shadowshub.xyz/daily'

const MAX_CHAT_MESSAGES = 40
const MAX_MESSAGE_LENGTH = 12_000
// 2026-08-16 识图链路：消息里带 data URI 图片时允许更大的体积（前端压缩后仍可能
// 远超纯文本 12k 上限；M3 拿到 data URI 后会把原始 base64 替换为占位符再交给 DeepSeek）。
const MAX_MEDIA_MESSAGE_LENGTH = 128 * 1024 * 1024
// 2026-08-12 放开 App HTML 大小：50MB 为数据库安全阀（HTML 快照存 webos_state），
// 实际闸门是工作区空间配额（App HTML 镜像占工作区，满则无法创建/更新）。
const MAX_APP_HTML_LENGTH = 50 * 1024 * 1024
const MAX_GENERATED_SCRIPT_LENGTH = 512 * 1024
const AI_RATE_LIMIT_PER_MINUTE = 10
const AI_RATE_WINDOW_MS = 60_000
// pi AgentSession.prompt() 整体超时（与画布 handleUserMessage 的 180s 一致）
const PI_PROMPT_TIMEOUT_MS = 180_000

/**
 * 2026-08-12 工作区空间统一闸门：所有「占空间」的写入（上传/App 文件/App 数据/
 * App 创建/商店安装）都以「工作区总配额」为唯一限制，不再设单项大小上限。
 * 配额 = 游客 200MB / 登录 512MB / 月卡档位 10-100GB（state.workspaceBytes）。
 * extraBytes 为本次新增的磁盘占用（可传负数表示覆盖变小）。
 */
function assertWorkspaceRoom(principal: Principal, extraBytes: number, appStorageBytes = 0, state?: StoredState): void {
  const limit = state ? workspaceLimitForState(state) : workspaceLimitFor(principal.key)
  const used = workspaceUsedBytes(principal.key)
  if (used + appStorageBytes + Math.max(0, extraBytes) > limit) {
    throw createError(413, 'WORKSPACE_FULL', '工作区空间不足，请先删除部分文件；如有大量存储需求可联系站长单独扩容')
  }
}
/** 当前用户工作区剩余空间（磁盘文件 + App 私有数据字节） */
function workspaceFreeBytes(principal: Principal, appStorageBytes = 0, state?: StoredState): number {
  const limit = state ? workspaceLimitForState(state) : workspaceLimitFor(principal.key)
  const used = workspaceUsedBytes(principal.key)
  return Math.max(0, limit - used - appStorageBytes)
}
/**
 * 2026-08-12 App HTML 镜像占用工作区空间：创建/更新 App 前检查剩余空间
 *（已存在镜像时按净增量计算；App HTML 存库 + 镜像到 apps/<appId>/index.html）。
 */
function assertAppHtmlRoom(principal: Principal, appId: string | null, html: string, state?: StoredState): void {
  const extra = Buffer.byteLength(html, 'utf-8')
  let old = 0
  if (appId) {
    try {
      const mirror = path.join(appFilesRoot(principal.key, 'app', appId), 'index.html')
      old = fs.existsSync(mirror) ? fs.statSync(mirror).size : 0
    } catch { old = 0 }
  }
  assertWorkspaceRoom(principal, Math.max(0, extra - old), 0, state)
}

// ============================================================================
// 2026-08-02 统一积分体系（学分制，1 积分 = ¥0.01）
// 背景：不同 AI 能力 token 价值差异巨大（DeepSeek 对话 ~¥1/百万 vs
// gpt-image-2-super 生图 ¥16/¥60 每百万），单一 token 池会被贵模型白嫖。
// 游客 100 积分 / 已登录 1000 积分 / 套餐 990 积分（9.9 元）
// ============================================================================
export const GUEST_CREDITS = 100 // ¥1.00
export const MEMBER_CREDITS = 1_000 // ¥10.00
export const PLAN_CREDITS = 990 // ¥9.90（套餐售价）
const TOKEN_PLAN_PRICE_MINOR = 990 // 9.90 元
/** 客服微信（付费/额度相关文案展示；测试阶段加好友免费获取额度） */
const SUPPORT_WECHAT = 'fangyan876'
/** 客服 QQ（AI 提示词与设置页展示；用户反馈/分享讨论） */
const SUPPORT_QQ = '2893334965'
/** 套餐产品描述中展示的客服联系方式（2026-08-02 由 QQ 改为微信） */
const PLAN_SUPPORT_TEXT = `测试阶段可加微信 ${SUPPORT_WECHAT} 免费获取积分`

interface Principal {
  key: string
  id: string
  deviceId: string
  guest: boolean
  role: PrincipalRole
  /** 多用户模式下为用户邮箱（游客为 null；用于头部展示） */
  email?: string | null
  /** 多用户模式下的展示名（display_name 优先，回退用户名；游客为 null） */
  username?: string | null
  /** 多用户模式下是否已设置自定义称呼（display_name 非空） */
  displayNameSet?: boolean
}

// 邮箱验证码登录/注册迁移用：导出状态读写（emailAuth 路由需要把游客资产迁移到用户 scope）
export type { Principal }
export { loadState, saveState }

interface StoredVersion {
  id: string
  appId: string
  version: string
  status: WebOsAppVersionStatus
  source: WebOsAppSource
  capabilities: string[]
  html: string | null
  createdAt: number
  createdBy: 'system' | 'guest' | 'user'
  parentVersionId: string | null
}

interface StoredApp {
  id: string
  name: string
  source: WebOsAppSource
  activeVersionId: string | null
  installed: boolean
  createdAt: number
  icon?: string | null
  versions: StoredVersion[]
}

interface StoredState {
  createdAt: number
  balanceMinor: number
  freeBalanceMinor: number
  usedMinor: number
  /** 工作区空间配额（2026-08-12）：游客200MB/登录512MB；月卡档位10/30/100GB；
   *  管理员可调整（workspaceBytes 显式存储，workspaceLimitForState 优先读取） */
  workspaceBytes?: number
  /** 统一积分体系（2026-08-02）：1 积分 = ¥0.01。所有 AI 能力按定价表折算扣积分 */
  credits: {
    quota: number
    used: number
    /** 月卡（2026-08-06 爱发电）：monthly 存在且未到期时 quota/used 表示当月额度；
     *  到期后旧余额作废（expireMonthlyIfNeeded 惰性结算） */
    monthly?: {
      planId: string
      planName: string
      monthlyCredits: number
      expiresAt: number
      lastGrantAt: number
    } | null
    /** 永久积分池（尝鲜用量包，永不过期；扣费顺序：先月卡额度，再永久池） */
    permanent?: { quota: number; used: number }
    /** 爱发电发货历史（幂等/限购判定） */
    afdianRedeem?: Array<{ planId: string; planName: string; credits: number; at: number; outTradeNo?: string }>
  }
  ai: {
    model: WebOsModel
    thinking: WebOsThinkingLevel
  }
  apps: StoredApp[]
  appStorage: Record<string, Record<string, unknown>>
  email: {
    state: WebOsEmailBindingState
    boundEmail: string | null
  }
}

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

interface ChatBody {
  messages?: unknown
  model?: unknown
  thinking?: unknown
  appId?: unknown
  sourceVersionId?: unknown
  /** 多会话 ID（服务端按 用户+会话+思考档 隔离 pi 上下文） */
  conversationId?: unknown
  /** 重建会话上下文（编辑/回退重来时 true） */
  rebuild?: unknown
  /** 2026-08-11 SSE 重连（架构统一）：刷新/重开页面后重连任务事件流——
   *  服务端重放任务缓冲 + 实时转发，前端只保留一条 SSE 处理路径 */
  resume?: unknown
  /** 2026-08-11 resume 归属校验：最后一条 user 消息内容（服务端据此判断
   *  任务缓冲是否属于当前对话末尾，防止历史任务事件重放到新消息） */
  lastUser?: unknown
}

// pi AgentSession 的 token 用量（从 agent_end 事件的 assistant usage 提取）
interface TokenUsage {
  promptTokens: number
  completionTokens: number
}

const stateCache = new Map<string, StoredState>()
const aiRateMap = new Map<string, { count: number; windowStart: number }>()
let storageWarningLogged = false

function envNumber(name: string, fallback: number, minimum = 0): number {
  const parsed = Number(process.env[name])
  return Number.isFinite(parsed) && parsed >= minimum ? parsed : fallback
}

function asNonNegativeNumber(value: unknown, fallback: number): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback
}

function isThinkingLevel(value: unknown): value is WebOsThinkingLevel {
  return typeof value === 'string' && THINKING_LEVELS.includes(value as WebOsThinkingLevel)
}

function isAppSource(value: unknown): value is WebOsAppSource {
  return value === 'builtin' || value === 'ai_generated' || value === 'local_import' || value === 'store'
}

function isVersionStatus(value: unknown): value is WebOsAppVersionStatus {
  return value === 'draft' || value === 'ready' || value === 'active' || value === 'rolled_back'
}

function isEmailState(value: unknown): value is WebOsEmailBindingState {
  return value === 'idle'
    || value === 'email_sent'
    || value === 'verification_unavailable'
    || value === 'verified'
    || value === 'migration_pending'
    || value === 'migration_complete'
    || value === 'error'
}

function principalFromRequest(req: Request): Principal | null {
  const user = req.user
  if (!user?.authenticated) return null

  if (user.guest) {
    const deviceId = user.guestDeviceId || req.deviceId
    if (!deviceId) return null
    return {
      key: `guest:${deviceId}`,
      id: `guest-${deviceId}`,
      deviceId,
      guest: true,
      role: 'guest',
    }
  }

  if (user.userId) {
    const deviceId = req.deviceId || `account-${user.userId}`
    const role: PrincipalRole = user.role === 'admin' ? 'admin' : 'member'
    return {
      key: `user:${user.userId}`,
      id: user.userId,
      deviceId,
      guest: false,
      role,
      email: user.email ?? null,
      username: user.username ?? null,
      displayNameSet: Boolean(user.displayNameSet),
    }
  }

  // Single-password mode has no stable account owner for webOS assets.  It is
  // deliberately rejected instead of silently putting assets in a global row.
  return null
}

function requirePrincipal(req: Request): Principal {
  const principal = principalFromRequest(req)
  if (!principal) {
    throw createError(401, 'WEBOS_AUTH_REQUIRED', '需要有效的 webOS 游客或账户会话')
  }
  // 2026-08-06 在线人数统计：每次鉴权请求标记活跃（最近 5 分钟）
  try {
    markUserActive(principal.key)
  } catch { /* ignore */ }
  return principal
}

function stateEntityId(principal: Principal): string {
  return `webos-state:${principal.key}`
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function parseJsonValue(value: unknown): unknown {
  if (typeof value !== 'string') return value
  try {
    return JSON.parse(value)
  } catch {
    return value
  }
}

function normalizeCapabilities(value: unknown): string[] {
  if (!Array.isArray(value)) return [...DEFAULT_APP_CAPABILITIES]
  const allowed = new Set<string>([...DEFAULT_APP_CAPABILITIES])
  const capabilities = value.filter((item): item is string => typeof item === 'string' && allowed.has(item))
  return capabilities.length > 0 ? [...new Set(capabilities)] : [...DEFAULT_APP_CAPABILITIES]
}

function normalizeVersion(raw: unknown, appId: string): StoredVersion | null {
  if (!raw || typeof raw !== 'object') return null
  const row = raw as Record<string, unknown>
  if (typeof row.id !== 'string' || typeof row.version !== 'string') return null
  const source: WebOsAppSource = isAppSource(row.source) ? row.source : 'ai_generated'
  const status: WebOsAppVersionStatus = isVersionStatus(row.status) ? row.status : 'ready'
  const createdBy = row.createdBy === 'system' || row.createdBy === 'guest' || row.createdBy === 'user'
    ? row.createdBy
    : 'user'
  return {
    id: row.id,
    appId,
    version: row.version,
    status,
    source,
    capabilities: normalizeCapabilities(row.capabilities),
    html: typeof row.html === 'string' ? row.html : null,
    createdAt: asNonNegativeNumber(row.createdAt, Date.now()),
    createdBy,
    parentVersionId: typeof row.parentVersionId === 'string' ? row.parentVersionId : null,
  }
}

function normalizeApp(raw: unknown): StoredApp | null {
  if (!raw || typeof raw !== 'object') return null
  const row = raw as Record<string, unknown>
  if (typeof row.id !== 'string' || typeof row.name !== 'string') return null
  const appId = row.id
  const versions = Array.isArray(row.versions)
    ? row.versions.map((version) => normalizeVersion(version, appId)).filter((v): v is StoredVersion => v !== null)
    : []
  const activeVersionId = typeof row.activeVersionId === 'string' && versions.some((v) => v.id === row.activeVersionId)
    ? row.activeVersionId
    : null
  return {
    id: row.id,
    name: row.name.slice(0, 80),
    source: isAppSource(row.source) && row.source !== 'builtin' ? row.source : 'ai_generated',
    activeVersionId,
    installed: row.installed === true,
    createdAt: asNonNegativeNumber(row.createdAt, Date.now()),
    // 2026-08-08 修复：icon 字段此前被 normalizeApp 丢弃 → 任何一次 saveState
    // 都会把全部 App 的 DB icon 洗成 undefined（AI 画的图标全部变默认首字母）。
    // 保留 icon（限 8KB 防爆库；超限回退 null，由工作区 icon 文件兜底显示）。
    icon: typeof row.icon === 'string' && row.icon ? row.icon.slice(0, 8 * 1024) : null,
    versions,
  }
}

function defaultCredits(principal: Principal): number {
  return principal.guest ? GUEST_CREDITS : MEMBER_CREDITS
}

function defaultState(principal: Principal): StoredState {
  const freeBalanceMinor = envNumber('WEBOS_GUEST_FREE_BALANCE_MINOR', 100, 0)
  return {
    createdAt: Date.now(),
    balanceMinor: freeBalanceMinor,
    freeBalanceMinor,
    usedMinor: 0,
    // 2026-08-12 工作区基础配额：游客 200MB / 登录 512MB（月卡开通时升级到档位）
    workspaceBytes: workspaceLimitFor(principal.key),
    credits: { quota: defaultCredits(principal), used: 0 },
    ai: { model: MODEL, thinking: DEFAULT_THINKING },
    apps: [],
    appStorage: {},
    email: { state: 'idle', boundEmail: null },
  }
}

/**
 * 旧 token 配额 → 积分迁移（2026-08-02 一次性）：
 * 存量 tokens.quota 按原套餐语义折算（1 亿 token=990 积分；10 万=1000 积分；1 万=100 积分），
 * 已用按同比例折算；仅当状态里没有 credits 字段时触发（旧库升级）。
 */
function migrateLegacyTokens(row: Record<string, unknown>, principal: Principal): { quota: number; used: number } {
  const defaultQuota = defaultCredits(principal)
  const rawCredits = row.credits && typeof row.credits === 'object' ? row.credits as Record<string, unknown> : null
  if (rawCredits && asNonNegativeNumber(rawCredits.quota, 0) > 0) {
    return {
      quota: asNonNegativeNumber(rawCredits.quota, defaultQuota),
      used: asNonNegativeNumber(rawCredits.used, 0),
    }
  }
  // 旧 tokens 字段存在 → 折算（quota=1 亿→990；10 万→1000；1 万→100）
  const rawTokens = row.tokens && typeof row.tokens === 'object' ? row.tokens as Record<string, unknown> : null
  if (rawTokens) {
    const oldQuota = asNonNegativeNumber(rawTokens.quota, 0)
    const oldUsed = asNonNegativeNumber(rawTokens.used, 0)
    if (oldQuota > 0) {
      const quota = oldQuota >= 100_000_000 ? PLAN_CREDITS
        : oldQuota >= 100_000 ? MEMBER_CREDITS
          : GUEST_CREDITS
      const used = Math.min(quota, Math.round(oldUsed / oldQuota * quota))
      console.log(`[webos] migrated legacy tokens → credits for ${String(principal.key).slice(0, 16)}: ${oldQuota}/${oldUsed} → ${quota}/${used}`)
      return { quota, used }
    }
  }
  return { quota: defaultQuota, used: 0 }
}

function normalizeState(raw: unknown, principal: Principal): StoredState {
  const base = defaultState(principal)
  const data = parseJsonValue(raw)
  if (!data || typeof data !== 'object') return base
  const row = data as Record<string, unknown>
  const ai = row.ai && typeof row.ai === 'object' ? row.ai as Record<string, unknown> : {}
  const apps = Array.isArray(row.apps)
    ? row.apps.map(normalizeApp).filter((app): app is StoredApp => app !== null)
    : []
  const appStorage = row.appStorage && typeof row.appStorage === 'object'
    ? row.appStorage as Record<string, Record<string, unknown>>
    : {}
  const email = row.email && typeof row.email === 'object' ? row.email as Record<string, unknown> : {}
  const credits = migrateLegacyTokens(row, principal)
  // 2026-08-06 爱发电月卡/永久池：解析可选字段（旧状态无这些字段时保持默认）
  const rawCredits = row.credits && typeof row.credits === 'object' ? row.credits as Record<string, unknown> : null
  const rawMonthly = rawCredits?.monthly && typeof rawCredits.monthly === 'object'
    ? rawCredits.monthly as Record<string, unknown>
    : null
  const monthly = rawMonthly && asNonNegativeNumber(rawMonthly.expiresAt, 0) > 0
    ? {
        planId: String(rawMonthly.planId ?? ''),
        planName: String(rawMonthly.planName ?? '月卡'),
        monthlyCredits: asNonNegativeNumber(rawMonthly.monthlyCredits, credits.quota),
        expiresAt: asNonNegativeNumber(rawMonthly.expiresAt, 0),
        lastGrantAt: asNonNegativeNumber(rawMonthly.lastGrantAt, 0),
      }
    : null
  const rawPermanent = rawCredits?.permanent && typeof rawCredits.permanent === 'object'
    ? rawCredits.permanent as Record<string, unknown>
    : null
  const permanent = rawPermanent
    ? { quota: asNonNegativeNumber(rawPermanent.quota, 0), used: asNonNegativeNumber(rawPermanent.used, 0) }
    : undefined
  const afdianRedeem = Array.isArray(rawCredits?.afdianRedeem)
    ? (rawCredits.afdianRedeem as Array<Record<string, unknown>>).map((h) => ({
        planId: String(h.planId ?? ''),
        planName: String(h.planName ?? ''),
        credits: asNonNegativeNumber(h.credits, 0),
        at: asNonNegativeNumber(h.at, 0),
        outTradeNo: h.outTradeNo ? String(h.outTradeNo) : undefined,
      }))
    : undefined
  const parsedCredits: StoredState['credits'] = { ...credits, monthly, permanent, afdianRedeem }
  // 月卡到期惰性结算：旧额度作废，回到会员默认额度；工作区配额同步回落基础值
  let workspaceBytes = asNonNegativeNumber(row.workspaceBytes, base.workspaceBytes ?? workspaceLimitFor(principal.key))
  if (monthly && monthly.expiresAt <= Date.now()) {
    parsedCredits.monthly = null
    parsedCredits.quota = principal.guest ? GUEST_CREDITS : MEMBER_CREDITS
    parsedCredits.used = 0
    workspaceBytes = workspaceLimitFor(principal.key)
  }
  return {
    createdAt: asNonNegativeNumber(row.createdAt, base.createdAt),
    balanceMinor: asNonNegativeNumber(row.balanceMinor, base.balanceMinor),
    freeBalanceMinor: asNonNegativeNumber(row.freeBalanceMinor, base.freeBalanceMinor),
    usedMinor: asNonNegativeNumber(row.usedMinor, base.usedMinor),
    workspaceBytes,
    credits: parsedCredits,
    ai: {
      model: MODEL,
      thinking: isThinkingLevel(ai.thinking) ? ai.thinking : base.ai.thinking,
    },
    apps,
    appStorage,
    email: {
      state: isEmailState(email.state) ? email.state : 'idle',
      boundEmail: typeof email.boundEmail === 'string' ? email.boundEmail : null,
    },
  }
}

async function loadState(principal: Principal): Promise<StoredState> {
  const cached = stateCache.get(principal.key)
  if (cached) return cached

  let raw: unknown = null
  try {
    const pool = getPool()
    const result = await pool.query(
      'SELECT data FROM entities WHERE id = $1 AND type = $2 AND scope = $3',
      [stateEntityId(principal), 'webos_state', principal.key],
    )
    raw = result.rows[0]?.data ?? null
  } catch (error) {
    if (!storageWarningLogged) {
      storageWarningLogged = true
      console.warn('[webos] persistent state unavailable; using process memory:', error instanceof Error ? error.message : String(error))
    }
  }

  const state = normalizeState(raw, principal)
  stateCache.set(principal.key, state)
  if (raw === null) await saveState(principal, state)
  // 「AI 即系统」：确保 system.desktop 是 state.apps 里的真实 App（版本化、可回滚）。
  // AI 通过工作区源码（apps/system.desktop/index.html）与 update_webos_app 读写它；
  // 初始 HTML 是 v1 参考实现。
  await ensureSystemDesktop(principal, state)
  // 应用商店（2026-08-03）：system.store 是版本化 HTML App，AI 可自由改商店形态
  await ensureSystemStore(principal, state)
  // 回收站（2026-08-06）：system.trash 是版本化 HTML App，AI 可自由改形态
  await ensureSystemTrash(principal, state)
  // 「文件夹即 App」（2026-08-06）：扫描 apps/ 新文件夹（含 index.html）自动注册
  if (syncAppsFromWorkspaceFolders(principal, state)) await saveState(principal, state)
  // 「文件夹即包」（2026-08-21，W1）：全量扫描 packages/ 注册非 app 类型包（幂等；
  // 覆盖手动复制文件夹 / 回收站恢复 / 钩子未触发的历史目录），失败不阻断已有功能
  try { await syncAllPackagesFromWorkspace(principal.key) } catch (error) {
    console.warn('[webos] syncAllPackagesFromWorkspace failed:', describeHookError(error))
  }
  return state
}

/**
 * 初始化/升级 system.desktop 系统桌面 App（幂等）。
 * 桌面是版本化的 HTML App，AI 可以自由修改；v1 是简洁大方的参考实现，
 * AI 改砸了可回滚或参考 v1 恢复。
 * 自动升级规则：若桌面从未被 AI/用户改过（仅系统初始化的 v1.0.0），
 * 且当前 active HTML 不是最新模板，则自动创建新模板版本（保留旧版可回滚）。
 */
async function ensureSystemDesktop(principal: Principal, state: StoredState): Promise<void> {
  const existing = state.apps.find((app) => app.id === 'system.desktop')
  if (!existing) {
    const now = Date.now()
    const versionId = `version-${randomUUID()}`
    const desktop: StoredApp = {
      id: 'system.desktop',
      name: '系统桌面',
      source: 'ai_generated',
      activeVersionId: versionId,
      installed: true,
      createdAt: now,
      icon: null,
      versions: [{
        id: versionId,
        appId: 'system.desktop',
        version: '1.0.0',
        status: 'active',
        source: 'ai_generated',
        capabilities: [PRIVATE_STORAGE_CAPABILITY],
        html: WEBOS_DESKTOP_V1_HTML,
        createdAt: now,
        createdBy: 'system',
        parentVersionId: null,
      }],
    }
    state.apps.push(desktop)
    await saveState(principal, state)
    console.log(`[webos] system.desktop initialized for ${principal.key.slice(0, 12)} (v1.0.0)`)
    return
  }

  const active = existing.versions.find((version) => version.id === existing.activeVersionId)
    ?? existing.versions[existing.versions.length - 1]
  if (active?.html === WEBOS_DESKTOP_V1_HTML) return
  if (existing.versions.length === 0) {
    // 有 App 但没有版本（异常态）：补一个 v1 版本
    const versionId = `version-${randomUUID()}`
    const now = Date.now()
    existing.versions.push({
      id: versionId,
      appId: 'system.desktop',
      version: '1.0.0',
      status: 'active',
      source: 'ai_generated',
      capabilities: [PRIVATE_STORAGE_CAPABILITY],
      html: WEBOS_DESKTOP_V1_HTML,
      createdAt: now,
      createdBy: 'system',
      parentVersionId: null,
    })
    existing.activeVersionId = versionId
    await saveState(principal, state)
    return
  }
  // 从未被 AI/用户改过（所有版本都由系统模板创建）→ 升级到最新模板。
  // 2026-08-12 放宽：原条件只允许 v1.0.0 唯一版本升级一次（versions.length===1
  // && createdBy==='system' && version==='1.0.0'），此后模板改动永远推不到存量
  // 账号（长按菜单/拖拽等新功能上线后老用户看不到）。放宽为「任意数量版本、
  // 只要全部由系统创建」即升级——用户/AI 改过的桌面（存在 createdBy!=='system'
  // 的版本）保留不动，避免覆盖定制。
  const untouched = existing.versions.length > 0
    && existing.versions.every((version) => version.createdBy === 'system')
  if (!untouched) return
  const now = Date.now()
  const versionId = `version-${randomUUID()}`
  existing.versions[0].status = 'ready'
  existing.versions.push({
    id: versionId,
    appId: 'system.desktop',
    version: '1.0.1',
    status: 'active',
    source: 'ai_generated',
    capabilities: [PRIVATE_STORAGE_CAPABILITY],
    html: WEBOS_DESKTOP_V1_HTML,
    createdAt: now,
    createdBy: 'system',
    parentVersionId: existing.versions[0].id,
  })
  existing.activeVersionId = versionId
  // 2026-08-07 防御：升级模板时同步更新工作区镜像（与 ensureSystemStore 同因）
  try { writeAppSourceMirror(principal, 'system.desktop', WEBOS_DESKTOP_V1_HTML) } catch { /* 镜像失败不阻断 */ }
  await saveState(principal, state)
  console.log(`[webos] system.desktop template upgraded for ${principal.key.slice(0, 12)} → v1.0.1`)
}

// ============================================================================
// 应用商店（2026-08-03）：发布/分享/导出/奖励 + system.store（AI 可改形态）
// 商店数据全部走独立表（webos_store_*），形态是版本化 HTML App（system.store），
// AI 可自由修改形态（同 system.desktop 模式），数据契约不变。
// ============================================================================

/** 给某用户 +N 积分（写入 webos_state.credits.quota，失败不阻断） */
export async function grantCredits(key: string, amount: number): Promise<boolean> {
  try {
    const principal: Principal = key.startsWith('guest:')
      ? { key, id: `guest-${key.slice(6)}`, deviceId: key.slice(6), guest: true, role: 'guest' }
      : { key, id: key.slice(5), deviceId: `account-${key.slice(5)}`, guest: false, role: 'member' }
    const state = await loadState(principal)
    state.credits.quota += amount
    await saveState(principal, state)
    console.log(`[store] grant +${amount} credits to ${key.slice(0, 16)}`)
    return true
  } catch (error) {
    console.warn('[store] grantCredits failed:', error instanceof Error ? error.message : String(error))
    return false
  }
}

/**
 * 分享奖励结算：访问者登录成功后调用（emailAuth 游客迁移时触发）。
 * 该访问者（游客 key）此前通过分享链接访问过的所有商店条目 → 分享者各 +100 积分。
 */
export async function settleShareRewards(guestKey: string): Promise<number> {
  try {
    const pool = getPool()
    const rows = await pool.query(
      `SELECT id, owner_key FROM webos_store_visits WHERE visitor_key = $1 AND status = 'visited'`,
      [guestKey],
    )
    let credited = 0
    for (const row of rows.rows) {
      if (row.owner_key === guestKey) continue // 自己分享给自己不算
      const ok = await grantCredits(String(row.owner_key), STORE_REWARD_CREDITS)
      if (ok) {
        await pool.query(`UPDATE webos_store_visits SET status = 'credited', credited_at = $1 WHERE id = $2`, [Date.now(), row.id])
        credited += 1
      }
    }
    if (credited > 0) console.log(`[store] share rewards settled: visitor=${guestKey.slice(0, 12)} credited ${credited} owners`)
    return credited
  } catch (error) {
    console.warn('[store] settleShareRewards failed:', error instanceof Error ? error.message : String(error))
    return 0
  }
}

/** 初始化 system.store（幂等，同 ensureSystemDesktop 模式：AI 改过不覆盖）。
 *  2026-08-07 补充「未改动自动升级」：早期账号停留在 v1.0.0 旧模板（13098 bytes，
 *  无搜索/发布/下载奖励等新功能）——唯一版本且由系统创建时自动升级到当前模板，
 *  旧版保留 ready 可回滚；AI/用户改过的商店不自动覆盖。 */
async function ensureSystemStore(principal: Principal, state: StoredState): Promise<void> {
  const existing = state.apps.find((app) => app.id === 'system.store')
  if (!existing) {
    const now = Date.now()
    const versionId = `version-${randomUUID()}`
    state.apps.push({
      id: 'system.store',
      name: '市场',
      source: 'ai_generated',
      activeVersionId: versionId,
      installed: true,
      createdAt: now,
      icon: null,
      versions: [{
        id: versionId,
        appId: 'system.store',
        version: '1.0.0',
        status: 'active',
        source: 'ai_generated',
        capabilities: [],
        html: WEBOS_STORE_V1_HTML,
        createdAt: now,
        createdBy: 'system',
        parentVersionId: null,
      }],
    })
    await saveState(principal, state)
    console.log(`[webos] system.store initialized for ${principal.key.slice(0, 12)} (v1.0.0)`)
    return
  }
  // 2026-08-07：未改动（唯一版本由系统创建）且 active HTML 不是当前模板 → 自动升级；
  // 增强：所有版本都是「系统模板」（当前模板或旧模板）即视为未改动——覆盖早期账号
  // 与被旧工作区镜像覆盖回旧模板的账号（实测 store-test-a 升级后被 v1.0.2:guest 覆盖，
  // 其内容仍是旧模板，可安全再次升级）；AI/用户改过形态的（如 a7d202 的 31483 定制版）
  // 不满足条件 → 不自动覆盖。
  // 2026-08-09 应用商店改名「市场」（用户决策）：存量账号也强制改名，
  // 与桌面图标、bootstrap 展示名保持一致（系统 App 名不受 AI 定制影响）。
  const renamed = existing.name !== '市场'
  if (renamed) existing.name = '市场'
  const active = existing.versions.find((version) => version.id === existing.activeVersionId)
    ?? existing.versions[existing.versions.length - 1]
  if (active?.html === WEBOS_STORE_V1_HTML) {
    if (renamed) await saveState(principal, state)
    return
  }
  // 2026-08-12 放宽（与 ensureSystemDesktop 对齐）：所有版本都由系统模板创建
  //（createdBy==='system'，无论新旧模板）即升级到当前模板——保证本轮空间标注等
  // 新功能推送到所有存量账号；AI/用户改过形态的商店（存在非 system 版本）不覆盖。
  const allTemplateVersions = existing.versions.length > 0
    && existing.versions.every((version) => version.createdBy === 'system')
  if (!allTemplateVersions) return
  const now = Date.now()
  const versionId = `version-${randomUUID()}`
  if (active) active.status = 'ready'
  existing.versions.push({
    id: versionId,
    appId: 'system.store',
    version: nextVersion(existing),
    status: 'active',
    source: 'ai_generated',
    capabilities: [],
    html: WEBOS_STORE_V1_HTML,
    createdAt: now,
    createdBy: 'system',
    parentVersionId: active?.id ?? null,
  })
  existing.activeVersionId = versionId
  // 2026-08-07 修复：升级模板时必须同步更新工作区镜像文件——否则 syncAppSourceFromWorkspace
  // 会把旧镜像当「AI 修改」建版本覆盖回旧模板（实测 store-test-a 升级后被 v1.0.2:guest 覆盖）。
  try { writeAppSourceMirror(principal, 'system.store', WEBOS_STORE_V1_HTML) } catch { /* 镜像失败不阻断 */ }
  await saveState(principal, state)
  console.log(`[webos] system.store template upgraded for ${principal.key.slice(0, 12)} → v1.0.1`)
}

/** 初始化 system.trash（2026-08-06，幂等；AI 改过不覆盖） */
async function ensureSystemTrash(principal: Principal, state: StoredState): Promise<void> {
  const existing = state.apps.find((app) => app.id === 'system.trash')
  if (existing) return
  const now = Date.now()
  const versionId = `version-${randomUUID()}`
  state.apps.push({
    id: 'system.trash',
    name: '回收站',
    source: 'ai_generated',
    activeVersionId: versionId,
    installed: true,
    createdAt: now,
    icon: null,
    versions: [{
      id: versionId,
      appId: 'system.trash',
      version: '1.0.0',
      status: 'active',
      source: 'ai_generated',
      capabilities: [],
      html: WEBOS_TRASH_V1_HTML,
      createdAt: now,
      createdBy: 'system',
      parentVersionId: null,
    }],
  })
  await saveState(principal, state)
  console.log(`[webos] system.trash initialized for ${principal.key.slice(0, 12)} (v1.0.0)`)
}

// ---- zip 导出（Node zlib 手写标准 zip：deflate + central directory）----
const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n += 1) {
    let c = n
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()
function crc32(buf: Buffer): number {
  let crc = 0xffffffff
  for (const byte of buf) crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}
function buildZip(files: Array<{ name: string; data: Buffer }>): Buffer {
  const localParts: Buffer[] = []
  const centralParts: Buffer[] = []
  let offset = 0
  for (const file of files) {
    const nameBuf = Buffer.from(file.name, 'utf8')
    const crc = crc32(file.data)
    const compressed = deflateRawSync(file.data)
    const localHeader = Buffer.alloc(30)
    localHeader.writeUInt32LE(0x04034b50, 0)
    localHeader.writeUInt16LE(20, 4)
    localHeader.writeUInt16LE(0x0800, 6)
    localHeader.writeUInt16LE(8, 8)
    localHeader.writeUInt16LE(0, 10)
    localHeader.writeUInt16LE(0, 12)
    localHeader.writeUInt32LE(crc, 14)
    localHeader.writeUInt32LE(compressed.length, 18)
    localHeader.writeUInt32LE(file.data.length, 22)
    localHeader.writeUInt16LE(nameBuf.length, 26)
    localHeader.writeUInt16LE(0, 28)
    localParts.push(localHeader, nameBuf, compressed)
    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(0x0800, 8)
    central.writeUInt16LE(8, 10)
    central.writeUInt16LE(0, 12)
    central.writeUInt16LE(0, 14)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(compressed.length, 20)
    central.writeUInt32LE(file.data.length, 24)
    central.writeUInt16LE(nameBuf.length, 28)
    central.writeUInt16LE(0, 30)
    central.writeUInt16LE(0, 32)
    central.writeUInt16LE(0, 34)
    central.writeUInt16LE(0, 36)
    central.writeUInt32LE(0, 38)
    central.writeUInt32LE(offset, 42)
    centralParts.push(central, nameBuf)
    offset += localHeader.length + nameBuf.length + compressed.length
  }
  const centralDir = Buffer.concat(centralParts)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(0, 4)
  eocd.writeUInt16LE(0, 6)
  eocd.writeUInt16LE(files.length, 8)
  eocd.writeUInt16LE(files.length, 10)
  eocd.writeUInt32LE(centralDir.length, 12)
  eocd.writeUInt32LE(offset, 16)
  eocd.writeUInt16LE(0, 20)
  return Buffer.concat([...localParts, centralDir, eocd])
}

/** 收集 App 导出文件：index.html + assets/ 目录下全部文件（HTML 内相对引用保持结构） */
function collectAppExportFiles(principal: Principal, appId: string, html: string): Array<{ name: string; data: Buffer }> {
  const files: Array<{ name: string; data: Buffer }> = [{ name: 'index.html', data: Buffer.from(html, 'utf8') }]
  const assetsDir = path.join(appFilesRoot(principal.key, 'app', appId), 'assets')
  try {
    const walk = (dir: string, prefix: string): void => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) walk(full, `${prefix}${entry.name}/`)
        else if (entry.isFile() && entry.name !== 'index.html') {
          try { files.push({ name: `assets/${prefix}${entry.name}`, data: fs.readFileSync(full) }) } catch { /* 跳过不可读 */ }
        }
      }
    }
    walk(assetsDir, '')
  } catch { /* 无 assets 目录 */ }
  return files
}

// ---- 外部 API 代理安全校验（App 接入第三方/自建 API；防 SSRF）----
// 【安全修复 2026-08-16（H3）】：
// - isPrivateIp 增加 IPv6 与更多保留段识别（此前 IPv6 一律按私网拦截=过度拦截，
//   同时未覆盖 IPv6 私网/环回/链路本地段；现在用 net.isIP + 段前缀精确判断）
// - redirect 改为 manual + 逐跳校验：重定向目标也必须过协议/DNS/IP 检查，
//   最多跟随 3 跳，杜绝"合法域名 → 内网"的经典 SSRF 绕过
import { isIP } from 'net'

function isPrivateIp(ip: string): boolean {
  const version = isIP(ip)
  if (version === 4) {
    const parts = ip.split('.').map(Number)
    if (parts.length !== 4 || parts.some((p) => Number.isNaN(p) || p < 0 || p > 255)) return true
    const [a, b, c] = parts
    // RFC1918 / 回环 / 链路本地 / CGNAT / 文档段 / 组播 / 保留
    return a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || (a === 198 && (b === 18 || b === 19))
      || a === 0 || (a === 192 && b === 0 && c === 0) || a >= 224
  }
  if (version === 6) {
    const lower = ip.toLowerCase()
    // ::1 环回 / :: 未指定 / fc00::/7 唯一本地 / fe80::/10 链路本地 / ::ffff:0:0/96 IPv4-mapped / 2001:db8::/32 文档
    if (lower === '::1' || lower === '::' || lower.startsWith('fc') || lower.startsWith('fd')
      || lower.startsWith('fe8') || lower.startsWith('fe9') || lower.startsWith('fea') || lower.startsWith('feb')
      || lower.startsWith('::ffff:') || lower.startsWith('2001:db8:')) return true
    // 组播 ff00::/8
    if (lower.startsWith('ff')) return true
  }
  // 非 IP（域名或无法识别）由调用方按 hostname 解析处理
  return false
}

/** 校验 URL 目标：协议 + hostname 解析后所有 IP 过私网黑名单；不合法则抛错 */
async function assertProxyTargetAllowed(url: URL): Promise<void> {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw createError(400, 'PROXY_INVALID_URL', '仅支持 http/https 协议')
  }
  // 拒绝带 userinfo 的 URL（user@host 混淆）
  if (url.username || url.password) {
    throw createError(400, 'PROXY_INVALID_URL', 'URL 不允许包含用户名/密码')
  }
  if (url.hostname === 'localhost' || url.hostname === 'metadata.google.internal') {
    throw createError(403, 'PROXY_SSRF_BLOCKED', '目标地址被禁止（内网/回环地址不可代理）')
  }
  // 拒绝 IP 字面量（防混淆编码绕过），只允许域名
  if (isIP(url.hostname) !== 0) {
    throw createError(400, 'PROXY_INVALID_URL', '请使用域名访问（IP 字面量被禁止）')
  }
  try {
    const addresses = await dns.lookup(url.hostname, { all: true, verbatim: true })
    if (addresses.length === 0) throw new Error('no addresses')
    for (const addr of addresses) {
      if (isPrivateIp(addr.address)) {
        throw createError(403, 'PROXY_SSRF_BLOCKED', '目标地址被禁止（内网/回环地址不可代理）')
      }
    }
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && (error as { code?: string }).code === 'PROXY_SSRF_BLOCKED') throw error
    throw createError(502, 'PROXY_DNS_FAILED', '无法解析目标域名')
  }
}

async function proxyHttp(principal: Principal, input: { method?: unknown; url?: unknown; headers?: unknown; body?: unknown }): Promise<{ status: number; body: string; contentType: string | null }> {
  const method = typeof input.method === 'string' && ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD'].includes(input.method.toUpperCase()) ? input.method.toUpperCase() : 'GET'
  const rawUrl = typeof input.url === 'string' ? input.url.trim() : ''
  let parsed: URL
  try {
    parsed = new URL(rawUrl)
  } catch {
    throw createError(400, 'PROXY_INVALID_URL', 'url 必须是合法的 http/https 地址')
  }
  // 初始目标 SSRF 校验（含协议/IP 字面量/hostname 解析）
  await assertProxyTargetAllowed(parsed)

  const headers: Record<string, string> = { 'user-agent': 'Daily-webOS/1.0' }
  if (input.headers && typeof input.headers === 'object') {
    for (const [key, value] of Object.entries(input.headers as Record<string, unknown>)) {
      if (typeof value === 'string' && /^[a-zA-Z0-9-]+$/.test(key) && !['host', 'cookie', 'authorization'].includes(key.toLowerCase())) {
        headers[key] = value
      }
    }
  }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 15_000)
  try {
    // redirect: 'manual' + 手动逐跳校验（最多 3 跳），每跳都重新过 SSRF 检查
    let current = parsed
    for (let hop = 0; hop <= 3; hop += 1) {
      const response = await fetch(current.toString(), {
        method,
        headers,
        body: method === 'GET' || method === 'HEAD' ? undefined : (typeof input.body === 'string' ? input.body : JSON.stringify(input.body ?? {})),
        redirect: 'manual',
        signal: controller.signal,
      })
      if (response.status >= 300 && response.status < 400 && response.headers.get('location')) {
        const location = response.headers.get('location')!
        let next: URL
        try {
          next = new URL(location, current)
        } catch {
          throw createError(502, 'PROXY_INVALID_REDIRECT', '重定向地址不合法')
        }
        // 重定向跨源时剥离敏感请求头（Authorization/Cookie 由上层注入，此处统一防泄漏）
        if (next.origin !== current.origin) {
          for (const h of ['authorization', 'cookie', 'x-api-key', 'x-auth-token']) delete headers[h]
        }
        await assertProxyTargetAllowed(next)
        current = next
        continue
      }
      const arrayBuffer = await response.arrayBuffer()
      if (arrayBuffer.byteLength > 2 * 1024 * 1024) {
        throw createError(502, 'PROXY_RESPONSE_TOO_LARGE', '响应超过 2MB 限制')
      }
      const contentType = response.headers.get('content-type')
      const body = Buffer.from(arrayBuffer).toString('utf8')
      return { status: response.status, body, contentType }
    }
    throw createError(502, 'PROXY_TOO_MANY_REDIRECTS', '重定向次数超过 3 次上限')
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && (error as { code?: string }).code === 'PROXY_RESPONSE_TOO_LARGE') throw error
    if (error && typeof error === 'object' && 'code' in error && (error as { code?: string }).code === 'PROXY_SSRF_BLOCKED') throw error
    if (error instanceof Error && error.name === 'AbortError') throw createError(504, 'PROXY_TIMEOUT', '外部 API 响应超时（15s）')
    throw createError(502, 'PROXY_FETCH_FAILED', `外部 API 请求失败：${error instanceof Error ? error.message : String(error)}`)
  } finally {
    clearTimeout(timer)
  }
}

async function saveState(principal: Principal, state: StoredState): Promise<void> {
  stateCache.set(principal.key, state)
  try {
    const pool = getPool()
    const now = Date.now()
    const serialized = JSON.stringify(state)
    await pool.query(
      `INSERT INTO entities
        (id, type, scope, panel_id, widget_id, data, record_status, version, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (id) DO UPDATE SET
         data = EXCLUDED.data,
         record_status = EXCLUDED.record_status,
         version = entities.version + 1,
         updated_at = EXCLUDED.updated_at`,
      [stateEntityId(principal), 'webos_state', principal.key, null, null, serialized, 'active', 1, state.createdAt, now],
    )
  } catch (error) {
    if (!storageWarningLogged) {
      storageWarningLogged = true
      console.warn('[webos] failed to persist state; keeping process memory only:', error instanceof Error ? error.message : String(error))
    }
  }
}

function calculateStorageBytes(state: StoredState): number {
  try {
    return new TextEncoder().encode(JSON.stringify(state.appStorage)).byteLength
  } catch {
    return 0
  }
}

function guestView(principal: Principal, state: StoredState) {
  const usedCredits = Math.min(Math.round(state.credits.used), Math.round(state.credits.quota))
  return {
    id: principal.id,
    deviceId: principal.deviceId,
    balanceMinor: Math.round(state.balanceMinor),
    freeBalanceMinor: Math.round(state.freeBalanceMinor),
    usedMinor: Math.round(state.usedMinor),
    storageBytes: calculateStorageBytes(state),
    // 2026-08-12 工作区配额按状态解析（游客200MB/登录512MB/月卡档位10-100GB）
    storageLimitBytes: workspaceLimitForState(state),
    workspaceLimitBytes: workspaceLimitForState(state),
    createdAt: state.createdAt,
    synced: !principal.guest || state.email.state === 'migration_complete',
    // 2026-08-02 用户分层 + 积分额度（游客 100 / 登录 1000 / 套餐 990）
    kind: principal.guest
      ? ('guest' as const)
      : (state.credits.quota >= PLAN_CREDITS ? ('plan' as const) : ('member' as const)),
    credits: {
      quota: Math.round(state.credits.quota),
      used: usedCredits,
      remaining: Math.max(0, Math.round(state.credits.quota) - usedCredits),
      // 2026-08-06 月卡 / 永久池（爱发电）：个人中心展示用
      monthly: state.credits.monthly
        ? {
            planId: state.credits.monthly.planId,
            planName: state.credits.monthly.planName,
            monthlyCredits: state.credits.monthly.monthlyCredits,
            expiresAt: state.credits.monthly.expiresAt,
            remaining: Math.max(0, Math.round(state.credits.quota) - usedCredits),
          }
        : null,
      permanent: state.credits.permanent
        ? {
            quota: Math.round(state.credits.permanent.quota),
            used: Math.min(Math.round(state.credits.permanent.used), Math.round(state.credits.permanent.quota)),
            remaining: Math.max(0, Math.round(state.credits.permanent.quota) - Math.round(state.credits.permanent.used)),
          }
        : null,
      totalRemaining: remainingCredits(state),
    },
  }
}

function modelConfig() {
  return {
    id: MODEL,
    label: 'Flash',
    provider: 'DeepSeek',
    available: Boolean(process.env.DEEPSEEK_API_KEY?.trim()),
    priceHint: '按量计费，发送前预估',
    supportsThinking: [...THINKING_LEVELS],
  }
}

/** 支付商品目录（套餐；渠道未接入时仅展示，不创建订单） */
const PAYMENT_PRODUCTS = [
  {
    id: 'token-plan-100m',
    name: '990 积分套餐（¥9.9）',
    priceMinor: TOKEN_PLAN_PRICE_MINOR,
    currency: 'CNY' as const,
    description: `990 积分（≈¥9.9 等值额度，可用于对话/生图等全部 AI 能力；${PLAN_SUPPORT_TEXT}）`,
  },
]

/**
 * 支付状态（2026-08-06 爱发电接入）：
 * - providerStatus: configured（webhook/API 已配置）→ 前端展示真实档位与跳转链接；
 *   未配置 AFDIAN_USER_ID/AFDIAN_API_TOKEN 时为 unavailable（只展示，不可购买）。
 * - products：与爱发电后台档位一致（AFDIAN_TIERS），前端 AfdianView 直接渲染。
 * - 2026-08-12 修复「点档位跳不到支付页」：AFDIAN_PAGE_URL 曾配置成
 *   ifdian.net/a/<slug>（ifdian.net 是 API 域名不承载主页且 slug 不存在）→ 死链接。
 *   现在每档位下发 payUrl（afdian.com/order/create?plan_id=xxx 下单支付页），
 *   前端档位卡片直达支付页；afdianUrl 仅用于「前往主页」链接（公开宣传入口）。
 */
function paymentState() {
  const configured = afdianConfigured()
  return {
    providerStatus: configured ? ('configured' as const) : ('unavailable' as const),
    provider: 'afdian' as const,
    // 爱发电主页（站长创作页），前端「前往爱发电主页」跳转目标
    afdianUrl: process.env.AFDIAN_PAGE_URL?.trim() || null,
    tiers: AFDIAN_TIERS.map((tier) => ({
      planId: tier.planId,
      name: tier.name,
      priceYuan: tier.priceYuan,
      kind: tier.kind,
      monthlyCredits: tier.monthlyCredits ?? null,
      packCredits: tier.packCredits ?? null,
      // 2026-08-12 月卡档位对应工作区空间（轻量10GB/中量30GB/重量100GB；用量包无）
      workspaceBytes: WORKSPACE_TIER_BYTES[tier.planId] ?? null,
      // 该档位下单直达支付页（2026-08-12 两轮实测结论）：
// ① order/create?plan_id= / product_type=1&product_id= 都是错误格式（页面骨架正常
//    但商品不识别：金额为 0、提示「选择你的赞助期限」且无期限可选）；
// ② 真实购买路径 = 商品详情页 afdian.com/item/<plan_id>（自动识别赞助方案/售卖型
//    商品与型号，登录后可正常购买）。爱发电要求登录后才能购买，未登录会先跳登录页。
payUrl: `https://afdian.com/item/${tier.planId}`,
    })),
    // 未充值用户限制（2026-08-06）：视频 2 次 / 生图 10 次
    freeLimits: { videoTimes: 2, imageTimes: 10 },
    products: PAYMENT_PRODUCTS.map((product) => ({
      ...product,
      available: configured,
    })),
  }
}

/** 客户端真实 IP（nginx 反代后取 x-forwarded-for 第一跳） */
function clientIp(req: Request): string {
  const forwarded = req.headers['x-forwarded-for']
  if (typeof forwarded === 'string' && forwarded.trim()) return forwarded.split(',')[0].trim()
  return req.ip ?? '0.0.0.0'
}

function buildBootstrap(principal: Principal, state: StoredState) {
  const builtinApps = BUILTIN_APPS.map((app) => ({
    id: app.id,
    name: app.name,
    source: 'builtin' as const,
    activeVersionId: null,
    installed: true,
    createdAt: 0,
    versions: [],
  }))
  // 「文件夹即 App」（2026-08-06）：App 图标优先读文件夹 icon 文件
  // （icon.svg 内联 / icon.png 等 raw URL），无文件时回退 DB 字段
  // 2026-08-07 bootstrap 瘦身（修复大账号卡加载页）：用户 App 的版本 HTML
  // 不再随 bootstrap 全量下发（13 个 App 时 payload 达 1.6MB）——AppRuntime
  // 打开时按需 GET /apps/:appId 拉取；system.* 内置 App 保留 HTML（桌面/商店
  // iframe 直接渲染，模板仅 13-19KB）。
  const userApps = cloneJson(state.apps).map((app) => {
    const isSystem = app.id.startsWith('system.')
    const versions = (app.versions ?? []).map((version) =>
      isSystem ? version : { ...version, html: '' },
    )
    return {
      ...app,
      versions,
      icon: readAppIconFile(principal, app.id) ?? app.icon ?? null,
    }
  })
  return {
    session: {
      authenticated: true as const,
      guest: principal.guest,
      user: {
        id: principal.id,
        // 展示名：display_name（称呼）优先，回退邮箱前缀（游客显示「游客」）
        username: principal.guest
          ? '游客'
          : (principal.username ?? (principal.email ? principal.email.split('@')[0] : '账户用户')),
        role: principal.role,
        email: principal.email ?? null,
        displayNameSet: principal.guest ? false : Boolean(principal.displayNameSet),
      },
      guestState: guestView(principal, state),
    },
    ai: {
      model: state.ai.model,
      thinking: state.ai.thinking,
      models: [modelConfig()],
    },
    apps: [...builtinApps, ...userApps],
    payment: paymentState(),
    email: cloneJson(state.email),
    billing: {
      // 积分制（1 积分 = ¥0.01）；peak：DeepSeek 高峰时段（北京时间 9-12 / 14-18 价格 ×2）
      peak: isDeepSeekPeak(),
      peakMultiplier: deepSeekPeakMultiplier(),
      credits: guestView(principal, state).credits,
      catalog: billingCatalog(),
    },
    // 系统 Logo：AI 可替换（工作区 system/logo.svg|png）；未设置时为 null，前端显示文字标识
    logo: readLogoFile(principal.key),
    // 用户头像（工作区 system/avatar.svg|png，用户/AI 可替换）；未设置时前端显示首字母
    avatar: principal.guest ? null : readAvatarFile(principal.key),
    // 定制加载页：工作区 system/boot.html + boot.json（AI 可替换；默认时长 1200ms）
    boot: readBootConfig(principal.key),
  }
}

/** 预估本次对话积分消耗（按输入字符估算 token → chatCostMinor；仅用于前端展示与不足提示） */
function estimateCostMinor(messages: ChatMessage[], thinking: WebOsThinkingLevel): number {
  // 识图链路：data URI 只用于 M3，不会进入 DeepSeek 上下文，估算时不能按 base64 原文算
  const inputChars = messages.reduce((total, message) => {
    const text = message.content.replace(/data:image\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=]+/gi, '[图片]')
    return total + text.length
  }, 0)
  const outputBudget = {
    low: 400,
    medium: 800,
    high: 1_600,
    max: 2_400,
  }[thinking]
  const inputTokens = Math.ceil(inputChars / 4)
  return chatCostMinor({ promptTokens: inputTokens, completionTokens: outputBudget })
}

/** 剩余积分 = 月卡/常规额度剩余 + 永久池剩余（2026-08-06 月卡模型） */
function remainingCredits(state: StoredState): number {
  const base = Math.max(0, Math.round(state.credits.quota) - Math.round(state.credits.used))
  const perm = state.credits.permanent
    ? Math.max(0, Math.round(state.credits.permanent.quota) - Math.round(state.credits.permanent.used))
    : 0
  return base + perm
}

/**
 * 实际扣减积分（1 积分 = 1 分钱）：扣费顺序 = 先月卡/常规额度（快过期），
 * 不足时再扣永久池（尝鲜包永久有效）；不足时 clamp 到剩余（不超扣）。
 */
function chargeCredits(state: StoredState, costMinor: number): number {
  let remainingCost = Math.max(0, Math.round(costMinor))
  if (remainingCost === 0) return 0
  // 1) 月卡/常规额度
  const baseRemaining = Math.max(0, Math.round(state.credits.quota) - Math.round(state.credits.used))
  const fromBase = Math.min(baseRemaining, remainingCost)
  state.credits.used += fromBase
  remainingCost -= fromBase
  // 2) 永久池
  if (remainingCost > 0 && state.credits.permanent) {
    const permRemaining = Math.max(0, Math.round(state.credits.permanent.quota) - Math.round(state.credits.permanent.used))
    const fromPerm = Math.min(permRemaining, remainingCost)
    state.credits.permanent.used += fromPerm
    remainingCost -= fromPerm
  }
  return Math.max(0, Math.round(costMinor)) - remainingCost
}

/** 用户分层（供用量落库/管理后台）：付费 = 有月卡/有永久池余额/额度超会员默认 */
function principalKind(principal: Principal, state: StoredState): 'guest' | 'member' | 'plan' {
  if (principal.guest) return 'guest'
  const hasMonthly = !!state.credits.monthly
  const hasPermanent = (state.credits.permanent?.quota ?? 0) > 0
  return hasMonthly || hasPermanent || state.credits.quota > MEMBER_CREDITS ? 'plan' : 'member'
}

/** 从 usage 提取 token 数（无 usage 时回退 0） */
function usageTokens(u: TokenUsage | null): { promptTokens: number; completionTokens: number } {
  return { promptTokens: u?.promptTokens ?? 0, completionTokens: u?.completionTokens ?? 0 }
}

/** 2026-08-02 AI 用量落库（new-api 风格：每个请求一行，管理后台统计/审计用；失败不阻断） */
async function recordAiUsage(
  principal: Principal,
  state: StoredState,
  input: {
    model: WebOsModel
    /** pi 档位（low/medium/high/xhigh）或 off（如会话标题生成） */
    thinking: string
    promptTokens: number
    completionTokens: number
    costMinor: number
    status: 'ok' | 'failed' | 'insufficient' | 'empty_response'
    errorCode?: string
    ip?: string
  },
): Promise<void> {
  try {
    const pool = getPool()
    const now = Date.now()
    await pool.query(
      `INSERT INTO webos_ai_usage
        (id, user_key, user_email, kind, model, thinking, prompt_tokens, completion_tokens, total_tokens, cost_minor, status, error_code, ip, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
      [
        `usage-${randomUUID()}`,
        principal.key,
        principal.email ?? null,
        principalKind(principal, state),
        input.model,
        input.thinking,
        input.promptTokens,
        input.completionTokens,
        input.promptTokens + input.completionTokens,
        input.costMinor,
        input.status,
        input.errorCode ?? null,
        input.ip ?? null,
        now,
      ],
    )
  } catch (error) {
    console.warn('[webos] recordAiUsage failed:', error instanceof Error ? error.message : String(error))
  }
}

/**
 * 2026-08-11 对话内容落库（查 bug 必须看对话记录）。
 * 服务端此前只存用量审计（webos_ai_usage），不存对话内容——排查"消息重复/
 * 扣费异常/上下文丢失"只能靠 pm2 日志猜。现在每次 chat/stream 请求把
 * 用户消息 + AI 回复（纯文本）落库，管理后台可查完整对话记录。
 * 失败不阻断主流程。
 */
async function recordChatLog(
  principal: Principal,
  input: {
    conversationId: string
    requestId: string
    role: 'user' | 'assistant'
    content: string
    thinking: string
    rebuild: boolean
    status: 'ok' | 'failed' | 'empty_response' | 'insufficient'
    errorCode?: string
    promptTokens: number
    completionTokens: number
    costMinor: number
    ip?: string
  },
): Promise<void> {
  try {
    const pool = getPool()
    const now = Date.now()
    await pool.query(
      `INSERT INTO webos_chat_logs
        (id, user_key, user_email, conversation_id, request_id, role, content, thinking, rebuild, status, error_code, prompt_tokens, completion_tokens, total_tokens, cost_minor, ip, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)`,
      [
        `chat-${randomUUID()}`,
        principal.key,
        principal.email ?? null,
        input.conversationId,
        input.requestId,
        input.role,
        input.content.slice(0, 20_000), // 单条消息上限防御（正常消息远小于此）
        input.thinking,
        input.rebuild ? 1 : 0,
        input.status,
        input.errorCode ?? null,
        input.promptTokens,
        input.completionTokens,
        input.promptTokens + input.completionTokens,
        input.costMinor,
        input.ip ?? null,
        now,
      ],
    )
  } catch (error) {
    console.warn('[webos] recordChatLog failed:', error instanceof Error ? error.message : String(error))
  }
}

/**
 * 2026-08-13 统一对话 log 落库（一次 chat/stream 请求 = 一行完整记录）。
 * 一个对话里发生的全部事情（用户消息、AI 思考 reasoning、文字输出、工具调用、
 * 工具过程、App 创建/更新事件、最终状态与用量）统一保存为一个 events JSON——
 * 与 webos_chat_logs（按消息粒度、快速浏览）互补，查"AI 当时怎么想的/干了什么"
 * 必须看这里（reasoning 内容只在此表；webos_chat_logs 只存纯文本）。
 * 事件在 chat/stream 处理过程中由 collectChatSessionEvent() 累积（含断连后台任务），
 * 请求结束时（done/failed/empty/insufficient）统一落库。失败不阻断主流程。
 */
type ChatSessionEvent =
  | { kind: 'user'; content: string }
  | { kind: 'thinking'; content: string }
  | { kind: 'delta'; content: string }
  | { kind: 'tool_start'; tool: string }
  | { kind: 'tool_update'; tool: string; content: string }
  | { kind: 'tool_end'; tool: string; ok?: boolean }
  | { kind: 'html'; content: string; heightPx?: number }
  | { kind: 'app_created'; appId: string }
  | { kind: 'app_updated'; appId: string }
  | { kind: 'done'; usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number } }

/** 每个 in-flight 请求累积的完整事件序列（请求级，与任务缓冲解耦） */
const chatSessionEvents = new Map<string, ChatSessionEvent[]>()

/** 收集一次请求的会话事件（同时保证首条事件必为 user 消息） */
function collectChatSessionEvent(
  requestKey: string,
  ev: ChatSessionEvent,
  lastUserContent?: string,
): void {
  try {
    let list = chatSessionEvents.get(requestKey)
    if (!list) {
      list = []
      chatSessionEvents.set(requestKey, list)
      if (lastUserContent) list.push({ kind: 'user', content: lastUserContent })
    }
    list.push(ev)
  } catch { /* 收集失败不阻断 */ }
}

/** 落库统一会话 log（结束分支调用；失败静默） */
async function recordChatSessionLog(
  principal: Principal,
  input: {
    conversationId: string
    requestId: string
    thinking: string
    rebuild?: boolean
    status: 'ok' | 'failed' | 'empty_response' | 'insufficient'
    errorCode?: string
    promptTokens: number
    completionTokens: number
    costMinor: number
    ip?: string
    requestKey: string
  },
): Promise<void> {
  try {
    const events = chatSessionEvents.get(input.requestKey) ?? []
    chatSessionEvents.delete(input.requestKey)
    if (events.length === 0) return
    const pool = getPool()
    const now = Date.now()
    const total = input.promptTokens + input.completionTokens
    await pool.query(
      `INSERT INTO webos_chat_sessions
        (id, user_key, user_email, conversation_id, request_id, thinking, rebuild, model, status, error_code, prompt_tokens, completion_tokens, total_tokens, cost_minor, events, ip, created_at, ended_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)`,
      [
        `chat-session-${randomUUID()}`,
        principal.key,
        principal.email ?? null,
        input.conversationId,
        input.requestId,
        input.thinking,
        input.rebuild ? 1 : 0,
        MODEL,
        input.status,
        input.errorCode ?? null,
        input.promptTokens,
        input.completionTokens,
        total,
        input.costMinor,
        JSON.stringify(events),
        input.ip ?? null,
        now,
        now,
      ],
    )
  } catch (error) {
    console.warn('[webos] recordChatSessionLog failed:', error instanceof Error ? error.message : String(error))
  }
}

function validateMessages(raw: unknown): ChatMessage[] {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_CHAT_MESSAGES) {
    throw createError(400, 'INVALID_MESSAGES', `messages 必须是 1-${MAX_CHAT_MESSAGES} 条消息`)
  }
  return raw.map((item) => {
    if (!item || typeof item !== 'object') {
      throw createError(400, 'INVALID_MESSAGE', '消息格式不正确')
    }
    const row = item as Record<string, unknown>
    if (row.role !== 'user' && row.role !== 'assistant') {
      throw createError(400, 'INVALID_MESSAGE_ROLE', '只允许 user 或 assistant 消息')
    }
    const content = typeof row.content === 'string' ? row.content : ''
    const contentLimit = /data:image\/[a-z0-9.+-]+;base64,/i.test(content) ? MAX_MEDIA_MESSAGE_LENGTH : MAX_MESSAGE_LENGTH
    if (content.trim().length === 0 || content.length > contentLimit) {
      throw createError(400, 'INVALID_MESSAGE_CONTENT', `消息内容不能为空且不得超过 ${contentLimit} 字符`)
    }
    return { role: row.role, content }
  })
}

function resolveThinking(state: StoredState, value: unknown): WebOsThinkingLevel {
  if (value === undefined) return state.ai.thinking
  if (!isThinkingLevel(value)) {
    throw createError(400, 'INVALID_THINKING_LEVEL', 'thinking 必须是 low、medium、high 或 max')
  }
  return value
}

// UI 四档（DeepSeek 官方档位名）→ pi 原生档位（max → xhigh）
function thinkingToPi(thinking: WebOsThinkingLevel): 'low' | 'medium' | 'high' | 'xhigh' {
  switch (thinking) {
    case 'low': return 'low'
    case 'medium': return 'medium'
    case 'high': return 'high'
    case 'max': return 'xhigh'
  }
}

function resolveModel(value: unknown): WebOsModel {
  if (value === undefined || value === MODEL) return MODEL
  throw createError(400, 'INVALID_MODEL', '当前只支持 flash 模型')
}

function checkAiRateLimit(principal: Principal): boolean {
  const now = Date.now()
  const existing = aiRateMap.get(principal.key)
  if (!existing || now - existing.windowStart >= AI_RATE_WINDOW_MS) {
    aiRateMap.set(principal.key, { count: 1, windowStart: now })
    return true
  }
  existing.count += 1
  return existing.count <= AI_RATE_LIMIT_PER_MINUTE
}

/** 2026-08-08 会话最近请求记录：供诊断日志使用（不再用于拦截） */
const lastChatReq = new Map<string, { content: string; at: number }>()

/**
 * 2026-08-08 请求在途标记（scope:convId:thinking → { at, content }）：
 * 请求一到服务端就登记，前端断流后查询 /chat/background 能识别"第一次请求已在
 * 处理"（即使 pi 还在加载、尚未产生任何事件），从而放弃自动重试——
 * 根治"同一条消息被服务端处理两次"（pi 上下文重复 + 双倍扣费）。
 *
 * 2026-08-10 生命周期修复（关键）：
 * - TTL 从 60s 提到 240s：任务可能长达 180s（空闲超时）+ 排队等待，60s 过期会让
 *   断流重试在任务未结束时查询 miss → 前端盲目重发 → 同一条消息被 pi 处理两次。
 * - 标记生命周期 = 任务生命周期：任务真正结束（done/failed/catch/后台跑完/cancel）
 *   才删除；连接关闭（onClose）不再删除——断流 ≠ 任务结束，任务仍在后台跑，
 *   标记必须保留，前端查询才能看到"服务端在跑"而放弃重试。
 * - 记录最后一条 user 消息内容，用于识别"同一条消息的在途重复请求"（前端自动
 *   重试/双击误触）→ 直接拒绝并让前端走 recoverBackgroundTask 恢复第一次结果。
 */
interface ChatInFlightRec { at: number; content: string }
const INFLIGHT_TTL_MS = 240_000
const chatInFlight = new Map<string, ChatInFlightRec>()
function markChatInFlight(key: string, content: string, reason = 'req'): void {
  chatInFlight.set(key, { at: Date.now(), content })
  tlog(`inflight +${key.slice(-48)} content="${content.slice(0, 40).replace(/\s+/g, ' ')}" reason=${reason}`)
  if (chatInFlight.size > 2000) {
    const now = Date.now()
    for (const [k, v] of chatInFlight) {
      if (now - v.at > INFLIGHT_TTL_MS + 60_000) chatInFlight.delete(k)
    }
  }
}
function clearChatInFlight(key: string, reason: string): void {
  if (chatInFlight.delete(key)) {
    tlog(`inflight -${key.slice(-48)} reason=${reason}`)
  }
}
function chatInFlightActive(key: string, now = Date.now()): boolean {
  const rec = chatInFlight.get(key)
  return rec !== undefined && now - rec.at < INFLIGHT_TTL_MS
}

/**
 * 2026-08-11 消息重复发送防御第二道（docs/bug-duplicate-chat-request.md §5.1/§8.6）：
 * in-flight 拦截只管「任务处理中」，任务完成（done/bg-finished）后标记即删除——
 * 若客户端存在未知重复路径（IME 事件重放 / form 双 submit / 前端重试循环回归），
 * 会在 done 后立刻把同一条消息再发一次（线上实测 122ms 后到达，双倍扣费）。
 * 这里登记「最近完成」记录：同会话同 thinking 同内容在 5s 窗口内再次到达 →
 * 409 CHAT_DUPLICATE_RECENT 拒绝。rebuild=true（编辑/回退重来）豁免——它会
 * 在 done 后合法地重发相同内容。
 */
interface ChatRecentDoneRec { at: number; content: string }
const CHAT_RECENT_DONE_WINDOW_MS = 5_000
const recentChatDone = new Map<string, ChatRecentDoneRec>()
function markChatRecentDone(key: string, content: string): void {
  recentChatDone.set(key, { at: Date.now(), content })
  if (recentChatDone.size > 2000) {
    const now = Date.now()
    for (const [k, v] of recentChatDone) {
      if (now - v.at > CHAT_RECENT_DONE_WINDOW_MS + 30_000) recentChatDone.delete(k)
    }
  }
}

// ---------------------------------------------------------------------------
// AI 链路：pi agent session（pi-coding-agent）+ DeepSeek 内置 provider
// 2026-07-31 架构修正：不再自研 DeepSeek HTTP 直连，复用 piBridge 的
// createWebosSession（pi 内置 deepseek/deepseek-v4-flash，zen 网关 + DEEPSEEK_API_KEY 认证）。
// ---------------------------------------------------------------------------

// piBridge 懒加载：与 index.ts 一致，避免模块加载阶段 import pi-coding-agent 挂起
let piBridgeModule: Promise<typeof import('../piBridge.js')> | null = null
function loadPiBridge(): Promise<typeof import('../piBridge.js')> {
  if (!piBridgeModule) {
    piBridgeModule = import('../piBridge.js').catch((error) => {
      piBridgeModule = null
      throw error
    })
  }
  return piBridgeModule
}


// pi AgentMessage.usage → { promptTokens, completionTokens }
function piUsageToTokens(value: unknown): TokenUsage | null {
  if (!value || typeof value !== 'object') return null
  const row = value as Record<string, unknown>
  const input = Number(row.input)
  const output = Number(row.output)
  if (!Number.isFinite(input) && !Number.isFinite(output)) return null
  return {
    promptTokens: Number.isFinite(input) ? input : 0,
    completionTokens: Number.isFinite(output) ? output : 0,
  }
}

// 从 agent_end 事件的 messages 中取最后一个有效 assistant usage
function lastAssistantUsage(messages: unknown): TokenUsage | null {
  if (!Array.isArray(messages)) return null
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i]
    if (!message || typeof message !== 'object') continue
    const row = message as Record<string, unknown>
    if (row.role !== 'assistant' || !row.usage) continue
    const usage = piUsageToTokens(row.usage)
    if (usage) return usage
  }
  return null
}

// 从 agent_end 事件的 messages 中提取最后一个 assistant 消息的纯文本内容
function assistantText(messages: unknown): string {
  if (!Array.isArray(messages)) return ''
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i]
    if (!message || typeof message !== 'object') continue
    const row = message as Record<string, unknown>
    if (row.role !== 'assistant') continue
    const content = row.content
    if (typeof content === 'string' && content.trim()) return content
    if (Array.isArray(content)) {
      const text = content
        .map((part) => {
          if (!part || typeof part !== 'object') return ''
          const item = part as Record<string, unknown>
          return item.type === 'text' && typeof item.text === 'string' ? item.text : ''
        })
        .join('')
      if (text.trim()) return text
    }
  }
  return ''
}

// pi prompt 超时（2026-08-04 改为「空闲超时」）：不是从发起就倒计时 180s，
// 而是「180 秒内没有任何活动（LLM 输出/工具执行）」才中断——生图、多轮工具
// 等长任务只要还在推进就不会被误杀。chat/stream 的订阅回调里调用
// markPiActivity(activity) 刷新该请求的最后活动时间。
// 2026-08-11 修复：活动计时从模块级全局改为 per-request（共享对象）——
// 全局变量下多会话并行时，A 会话的活动会不断刷新 B 会话的空闲计时，
// 导致 B 会话卡住的请求（工具 hang/无事件）永不触发 180s 超时（表现为
// "AI 卡住不报错也不结束"）。每个请求独立计时后互不影响。
interface PiActivity { last: number }
/** 活跃请求集合：工具内无参 markPiActivity()（工具执行/进度回调）刷新其中
 *  所有请求的计时——工具执行期间该请求不会被 180s 空闲超时误杀。 */
const activePiRequests = new Set<PiActivity>()
function markPiActivity(activity?: PiActivity): void {
  const now = Date.now()
  if (activity) {
    activity.last = now
    return
  }
  for (const item of activePiRequests) item.last = now
}
async function runPiPrompt(session: unknown, text: string, timeoutMs: number, activity: PiActivity): Promise<void> {
  const promptable = session as { prompt(content: string): Promise<void> }
  activity.last = Date.now()
  activePiRequests.add(activity)
  try {
    await Promise.race([
      promptable.prompt(text),
      new Promise<never>((_, reject) => {
        const idleTimer = setInterval(() => {
          if (Date.now() - activity.last > timeoutMs) {
            clearInterval(idleTimer)
            reject(new Error(`AI 响应超过 ${Math.round(timeoutMs / 1000)} 秒无活动，已中断`))
          }
        }, 5000)
        idleTimer.unref?.()
      }),
    ])
  } finally {
    activePiRequests.delete(activity)
  }
}

// 多会话「编辑/回退重来」的历史上下文重放（2026-08-05）：
// 重建 pi 会话后，把修改后的完整消息历史（不含最后一条 user 消息）格式化为
// 一段背景文本拼进 userText，让 AI 基于修改后的历史重新推理，语义等价于
// DeepSeek 的「编辑消息后重新生成」。历史过长时截断（保留开头与结尾）。
const MAX_REBUILD_HISTORY_CHARS = 24_000
function formatHistoryContext(messages: ChatMessage[]): string {
  const parts: string[] = []
  for (const message of messages) {
    const content = message.content.trim()
    if (!content) continue
    parts.push(message.role === 'user' ? `用户：${content}` : `AI：${content}`)
  }
  if (parts.length === 0) return ''
  let text = parts.join('\n\n')
  if (text.length > MAX_REBUILD_HISTORY_CHARS) {
    const head = text.slice(0, Math.floor(MAX_REBUILD_HISTORY_CHARS * 0.7))
    const tail = text.slice(text.length - Math.floor(MAX_REBUILD_HISTORY_CHARS * 0.3))
    text = `${head}\n\n……（历史过长，中间部分已省略）……\n\n${tail}`
  }
  return `（以下是本会话之前的对话历史，仅作背景参考，请直接回应下面的最新消息，无需复述历史）\n${text}`
}

// ============================================================================
// 2026-08-14 M3 视觉桥接：从用户消息文本中提取图片/视频引用
// （data URI / 公网 URL / 平台公开产物 / 工作区相对路径），交给 MiniMax-M3
// 生成文字描述后注入 prompt（DeepSeek 非视觉，M3 是它的「眼睛」）。
// ============================================================================

/** 平台内部媒体端点前缀（均可被 m3Vision 解析为可读媒体） */
const PLATFORM_MEDIA_PREFIXES = [
  '/webos/api/apps/',
  '/webos/api/imagegen/file/',
  '/webos/api/videogen/file/',
  '/webos/api/workspace/files/raw',
]

/** 单条消息内最多桥接的媒体数量（防止恶意刷量） */
const MAX_BRIDGE_MEDIA_PER_MESSAGE = 8

function looksLikeMediaRef(text: string): boolean {
  if (/^data:image\/[a-z0-9.+-]+;base64,/i.test(text)) return true
  if (PLATFORM_MEDIA_PREFIXES.some((prefix) => text.startsWith(prefix))) return true
  if (/^https?:\/\//i.test(text)) {
    const pathPart = text.split(/[?#]/)[0] ?? ''
    return /\.(png|jpe?g|webp|gif|bmp|mp4|webm|mov)$/i.test(pathPart) || /image|video/i.test(text)
  }
  // 工作区相对路径（home/agent/apps/shared/skills/system + 图片/视频扩展名；允许 ./ 或 / 前缀）
  if (/^(?:\.\/|\/)?(home|agent|apps|shared|skills|system)\//i.test(text)) {
    return /\.(png|jpe?g|webp|gif|bmp|mp4|webm|mov)$/i.test(text)
  }
  return false
}

/** 提取消息文本中的媒体引用（去重、限量、清理尾部标点） */
function extractMediaRefs(text: string): string[] {
  const refs: string[] = []
  const add = (raw: string): void => {
    let value = raw.trim()
    value = value.replace(/[.,;:!?。，；：！？、）】」』"'`]+$/, '')
    if (!value || refs.includes(value)) return
    if (looksLikeMediaRef(value)) refs.push(value)
  }
  // Markdown 图片语法是显式媒体声明，URL 即使不带扩展名也直接按媒体引用处理
  const addMarkdownImage = (raw: string): void => {
    let value = raw.trim()
    value = value.replace(/[.,;:!?。，；：！？、）】」』"'`]+$/, '')
    if (!value || refs.includes(value)) return
    if (/^(?:https?:\/\/|data:image\/|\/webos\/api\/|(?:\.\/|\/)?(?:home|agent|apps|shared|skills|system)\/)/i.test(value)) {
      refs.push(value)
    }
  }
  // data URI
  for (const m of text.matchAll(/data:image\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=]+/gi)) add(m[0])
  // Markdown 图片语法：![alt](url) 里的 url 即使没有扩展名也按媒体引用处理
  for (const m of text.matchAll(/!\[[^\]]*\]\(([^)\s]+)\)/gi)) addMarkdownImage(m[1] ?? '')
  // 平台内部 URL（/webos/api/...）
  // 2026-08-17 修复：贪婪匹配会把正文尾巴吞进 URL（如「webos.ts:2862，支持」），
  // 导致把代码/描述文本误当媒体发给 M3 → HTTP 400 invalid param: image format。
  // 遇到中文标点/全角括号/反引号等正文分隔符立即截断。
  for (const m of text.matchAll(/\/webos\/api\/(?:apps\/[^\s"'<>()，。；：！？、（）【】「」『』`]+?\/files\/raw[^\s"'<>()，。；：！？、（）【】「」『』`]*|imagegen\/file\/[A-Za-z0-9]+(?:[._-][A-Za-z0-9]+)*(?:\.(?:png|jpe?g|webp|gif))?|videogen\/file\/[A-Za-z0-9]+(?:[._-][A-Za-z0-9]+)*(?:\.(?:mp4|webm))?|workspace\/files\/raw[^\s"'<>()，。；：！？、（）【】「」『』`]*)/g)) add(m[0])
  // 公网 URL（带媒体扩展名，或 URL 中带 image/video 的扩展名缺失地址）
  for (const m of text.matchAll(/https?:\/\/[^\s"'<>()]+/gi)) {
    const raw = m[0]
    if (looksLikeMediaRef(raw)) add(raw)
  }
  // 工作区相对路径
  for (const m of text.matchAll(/(?:^|[\s（(【\[「『])((?:\.\/|\/)?(?:home|agent|apps|shared|skills|system)\/[^\s"'<>()，。；：！？、]+\.(?:png|jpe?g|webp|gif|bmp|mp4|webm|mov))/gi)) add(m[1] ?? '')
  return refs.slice(0, MAX_BRIDGE_MEDIA_PER_MESSAGE)
}

/** 把消息里的 data URI 图片替换成短占位符，避免把 base64 原文喂给纯文本 DeepSeek */
function replaceDataUriMediaRefs(text: string, mediaRefs: string[]): string {
  let output = text
  // 1. 先用静态通用正则替换 ![] (data:image/...) Markdown 语法
  let counter = 1
  output = output.replace(/!\[([^\]]*)\]\((data:image\/[a-zA-Z0-9+.-]+;base64,[^)]+)\)/gi, () => {
    return `[图片${counter++}]`
  })
  // 2. 对于可能裸露存在的 data URI 字符串，使用非正则的 split/join 替换，彻底规避 RegExp 超长崩溃
  mediaRefs.forEach((ref, index) => {
    if (!/^data:image\//i.test(ref)) return
    const placeholder = `[图片${index + 1}]`
    output = output.split(ref).join(placeholder)
  })
  return output
}

/** 桥接一次对话消息：文本中的媒体 → M3 描述注入（失败降级为提示，不阻断主流程） */
async function bridgeVisionIntoText(
  principal: Principal,
  text: string,
  opts: { requestId: string; conversationId: string; ip?: string; ask?: string },
): Promise<{ text: string; injected: boolean }> {
  const mediaRefs = extractMediaRefs(text)
  if (mediaRefs.length === 0) return { text, injected: false }
  // data URI 只用于 M3 识图，不把 base64 原文喂给纯文本 DeepSeek
  const safeText = replaceDataUriMediaRefs(text, mediaRefs)
  const sourceLabel = (ref: string | undefined, index: number): string => {
    if (!ref) return '未知'
    if (/^data:image\//i.test(ref)) return `图片${index + 1}`
    return ref.length > 120 ? `${ref.slice(0, 120)}…` : ref
  }
  if (!visionConfigured()) {
    return { text: `${safeText}\n\n[系统：检测到图片/视频，但视觉模型未配置，暂时无法识图]`, injected: false }
  }
  try {
    const result = await describeMedia({
      ctx: { workspaceRoot: getWorkspaceRoot(principal.key), publicBase: PUBLIC_BASE },
      sources: mediaRefs,
      userKey: principal.key,
      userEmail: principal.email ?? null,
      requestId: opts.requestId,
      conversationId: opts.conversationId,
      trigger: 'chat_bridge',
      ip: opts.ip ?? null,
      ask: opts.ask,
    })
    if (result.ok && result.descriptions.length > 0) {
      const blocks = result.descriptions
        .map((desc, i) => `[视觉助手（${visionModelName()}）已分析你收到的媒体 #${i + 1}（来源：${sourceLabel(mediaRefs[i], i)}）：\n${desc}\n]`)
        .join('\n\n')
      return { text: `${safeText}\n\n${blocks}`, injected: true }
    }
    const reason = result.status === 'not_configured' ? '视觉模型未配置'
      : result.status === 'timeout' ? '视觉模型分析超时'
        : result.status === 'unsupported' ? '媒体格式暂不支持'
          : '视觉模型分析失败'
    return { text: `${safeText}\n\n[系统：检测到图片/视频，但${reason}，请稍后重试或改发文字描述]`, injected: false }
  } catch (error) {
    console.warn('[vision] bridge failed:', error instanceof Error ? error.message : String(error))
    return { text: `${safeText}\n\n[系统：检测到图片/视频，但视觉桥接异常，请稍后重试]`, injected: false }
  }
}

function writeSse(res: Response, event: unknown): void {
  if (!res.writableEnded) res.write(`data: ${JSON.stringify(event)}\n\n`)
}

// ============================================================================
// 可观测性（2026-08-10）：chat 链路全部日志带绝对时间戳（ISO 毫秒），
// 便于对齐前端/nginx/pm2 时间线，不再只有相对 gap。
// ============================================================================
const ts = (): string => new Date().toISOString()
/** 带毫秒时间戳的 chat 链路日志 */
function tlog(message: string): void {
  console.log(`[webos] ${ts()} ${message}`)
}
function twarn(message: string): void {
  console.warn(`[webos] ${ts()} ${message}`)
}

function setupSse(res: Response): void {
  res.status(200)
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
  res.setHeader('Cache-Control', 'no-cache, no-transform')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no')
  res.flushHeaders()
}

function validateGeneratedHtml(html: string): string {
  const scripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)]
  const styles = [...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)]
  try {
    for (const block of [...scripts, ...styles]) {
      const source = block[1]
      if (/(?:^|\s)(?:\.\.\.|…)(?=\s*(?:[;{}()[\],:]|$))/m.test(source)) {
        throw new Error('生成的 HTML 不得包含省略号或代码占位符')
      }
    }
    for (const match of scripts) {
      const script = match[1]
      if (script.length > MAX_GENERATED_SCRIPT_LENGTH) {
        throw new Error('生成的 JavaScript 单段过大')
      }
      new VmScript(script, { filename: 'webos-generated-app-check.js' })
    }
  } catch (error) {
    throw createError(502, 'APP_GENERATION_INVALID', 'AI 返回的 HTML 包含无法运行的 JavaScript', error instanceof Error ? error.message : undefined)
  }
  return html
}

function validateAppHtml(value: unknown, opts?: { allowExternalResources?: boolean }): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw createError(400, 'INVALID_APP_HTML', 'App 必须提供非空 HTML')
  }
  if (value.length > MAX_APP_HTML_LENGTH) {
    throw createError(400, 'APP_HTML_TOO_LARGE', `App HTML 不得超过 ${MAX_APP_HTML_LENGTH} 字节`)
  }
  if (/<\s*(iframe|object|embed|base)\b/i.test(value)) {
    throw createError(400, 'APP_HTML_FORBIDDEN_ELEMENT', 'App 不允许嵌套 iframe、object、embed 或 base')
  }
  // 危险协议一律禁止（可执行/逃逸/本地读取向量），与是否放开外部资源无关
  if (/(?:src|href|action|formaction)\s*=\s*["']?\s*(?:javascript:|vbscript:|file:|filesystem:)/i.test(value)) {
    throw createError(400, 'APP_FORBIDDEN_PROTOCOL', 'App 不允许 javascript: / vbscript: / file: 等危险协议资源')
  }
  if (/\s(?:src|href)\s*=\s*["']?\s*data:text\/html/i.test(value)) {
    throw createError(400, 'APP_HTML_FORBIDDEN_RESOURCE', 'App 不允许 data:text/html 资源')
  }
  // 外部网络资源（2026-08-20）：仅「用户显式粘贴的 HTML」（source=local_import / 该源 App 的后续编辑）
  // 放开 http(s) 与 // 引用（允许 CDN 脚本/样式/图片/普通外链，App 运行在 sandbox iframe、无令牌无宿主
  // DOM 权限，外部资源与内联脚本同级风险）；AI 生成与其他自动路径保持严格（防幻觉 URL / 供应链依赖）。
  if (!opts?.allowExternalResources
    && /(?:src|href|action|formaction)\s*=\s*["']?\s*(?:https?:|https?%3A|\x2f\x2f)/i.test(value)) {
    throw createError(400, 'APP_EXTERNAL_RESOURCE', '系统生成的静态 App 不允许外部网络资源')
  }
  return value.trim()
}

function normalizeAppName(value: unknown, fallback = '未命名 App'): string {
  if (typeof value !== 'string' || value.trim().length === 0) return fallback
  return value.trim().slice(0, 80)
}

function nextVersion(app: StoredApp): string {
  const versions = app.versions
    .map((version) => version.version.match(/^\d+\.\d+\.(\d+)$/)?.[1])
    .map((patch) => patch === undefined ? 0 : Number(patch))
  const latestPatch = versions.length > 0 ? Math.max(...versions) : 0
  return `1.0.${latestPatch + 1}`
}

/** 把 App 当前 active 版本 HTML 写回工作区镜像（apps/<appId>/index.html） */
function writeAppSourceMirror(principal: Principal, appId: string, html: string): void {
  try {
    const file = path.join(appFilesRoot(principal.key, 'app', appId), 'index.html')
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, html, 'utf-8')
  } catch (error) {
    console.warn(`[webos] write app source mirror failed for ${appId}:`, error instanceof Error ? error.message : String(error))
  }
}

/**
 * App 源码工作区镜像同步（「AI 即系统」核心路径）：
 * - 每个 App 的当前源码 HTML 镜像在工作区 apps/<appId>/index.html；
 * - AI 可以直接用 agent_fs_write/agent_fs_edit 修改该文件，系统在
 *   bootstrap / 详情读取时检测到文件与数据库 active 版本不一致，
 *   自动创建新版本并切换（版本化保留，可回滚；校验失败则保留原版本）；
 * - 首次调用建立镜像；rollback/install/active-version 切换后由调用方写回镜像。
 */
function syncAppSourceFromWorkspace(principal: Principal, app: StoredApp): boolean {
  const active = app.versions.find((version) => version.id === app.activeVersionId) ?? app.versions[0]
  if (!active?.html) return false
  let file: string
  try {
    file = path.join(appFilesRoot(principal.key, 'app', app.id), 'index.html')
  } catch {
    return false
  }
  let fileContent: string | null = null
  try {
    if (fs.existsSync(file)) fileContent = fs.readFileSync(file, 'utf-8')
  } catch {
    return false
  }
  if (fileContent === null) {
    // 首次：建立镜像（与 active 版本保持一致）
    writeAppSourceMirror(principal, app.id, active.html)
    return false
  }
  if (fileContent === active.html) return false
  // 工作区文件被 AI 直接修改：校验通过则发布为新版本（安全网：校验失败保留原版本）
  try {
    const html = validateAppHtml(fileContent)
    validateGeneratedHtml(html)
    const versionId = `version-${randomUUID()}`
    const now = Date.now()
    active.status = 'ready'
    const next = nextVersion(app)
    app.versions.push({
      id: versionId,
      appId: app.id,
      version: next,
      status: 'active',
      source: 'ai_generated',
      capabilities: active.capabilities.length > 0 ? [...active.capabilities] : [...DEFAULT_APP_CAPABILITIES],
      html,
      createdAt: now,
      createdBy: principal.guest ? 'guest' : 'user',
      parentVersionId: active.id,
    })
    app.activeVersionId = versionId
    app.installed = true
    // 2026-08-07 修复：建版本后把新版本内容写回镜像文件——否则只要工作区文件
    // 与 DB 存在字节级差异（BOM/换行符/编码），每次 bootstrap 都会误判
    // "changed" → 无限创建相同内容的新版本（线上曾出现 system.store v1.0.1~v1.0.20）。
    writeAppSourceMirror(principal, app.id, html)
    console.log(`[webos] workspace source changed → new version ${app.id} v${next} (${Buffer.byteLength(html, 'utf-8')} bytes)`)
    return true
  } catch (error) {
    console.warn(`[webos] workspace source invalid for ${app.id}, keeping active version: ${error instanceof Error ? error.message : String(error)}`)
    return false
  }
}

// ============================================================================
// 2026-08-06 「文件夹即 App」（用户需求：一切用文件夹管理，不做新 API）
// - AI 创建 App = 在 apps/ 下新建文件夹并写 index.html → 系统自动注册为 App；
// - App 图标 = 文件夹内 icon.svg（内联 SVG 文本）或 icon.png/jpg/jpeg/webp（图片）；
// - App 素材 = 文件夹内任意相对路径（assets/xxx.png、css/style.css、js/app.js），
//   App 运行时 <base> 指向该 App 的文件 raw 端点，相对引用自动生效（无需新 API）；
// - 删除 App = 文件夹移入 apps/.trash/<appId>/（可读取；复制回 apps/ 下即自动
//   重新注册恢复；彻底删除 = agent_fs_delete 删除回收站目录）。
// ============================================================================
const APP_TRASH_DIR = '.trash'
const APP_ICON_TEXT_MAX = 32 * 1024 // icon.svg 文本上限（与 validateAppIcon 一致）
const APP_ICON_FILE_MAX = 512 * 1024 // icon.png 等图片上限

/** 读取 App 文件夹图标：icon.svg（返回内联 SVG 文本）→ icon.png/jpg/jpeg/webp（返回 raw URL）；无则 null */
function readAppIconFile(principal: Principal, appId: string): string | null {
  try {
    const root = appFilesRoot(principal.key, 'app', appId)
    for (const name of ['icon.svg', 'icon.png', 'icon.jpg', 'icon.jpeg', 'icon.webp']) {
      const full = path.join(root, name)
      if (!fs.existsSync(full) || !fs.statSync(full).isFile()) continue
      const size = fs.statSync(full).size
      if (name === 'icon.svg') {
        if (size > APP_ICON_TEXT_MAX) continue // 超限跳过（回退 DB 字段）
        const text = fs.readFileSync(full, 'utf-8').trim()
        if (text.startsWith('<svg')) return text
        continue
      }
      if (size > APP_ICON_FILE_MAX) continue
      return `/webos/api/apps/${encodeURIComponent(appId)}/files/raw?scope=app&path=${encodeURIComponent(name)}`
    }
  } catch { /* 忽略 */ }
  return null
}

/** 把 App 文件夹移入回收站 apps/.trash/<appId>/（已存在则先清空旧回收项） */
function moveAppToTrash(principal: Principal, appId: string): void {
  try {
    const appDir = appFilesRoot(principal.key, 'app', appId)
    const trashDir = path.join(path.dirname(appDir), APP_TRASH_DIR)
    const target = path.join(trashDir, appId)
    if (fs.existsSync(target)) fs.rmSync(target, { recursive: true, force: true })
    if (fs.existsSync(appDir)) {
      fs.mkdirSync(trashDir, { recursive: true })
      fs.renameSync(appDir, target)
    }
  } catch { /* 移动失败不阻断删除（残留由 AI 用 agent_fs_* 处理） */ }
}

/**
 * 扫描 apps/ 文件夹注册新 App（「文件夹即 App」核心路径）：
 * - 在 apps/ 下新建文件夹并写入 index.html（AI 用 agent_fs_write）→ 自动注册；
 * - 校验失败/半成品文件夹跳过（AI 写完后再触发注册）；
 * - 系统 App（BUILTIN_APPS）不走文件夹注册；隐藏目录（.trash 等）跳过。
 */
function syncAppsFromWorkspaceFolders(principal: Principal, state: StoredState): boolean {
  let changed = false
  const appsDir = path.join(getWorkspaceRoot(principal.key), 'apps')
  let dirs: string[] = []
  try {
    dirs = fs.readdirSync(appsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.') && APP_ID_PATTERN.test(entry.name))
      .map((entry) => entry.name)
  } catch {
    return false
  }
  const builtinIds = new Set<string>(BUILTIN_APPS.map((app) => app.id))
  for (const folderName of dirs) {
    if (builtinIds.has(folderName)) continue // 系统 App 有专门 ensure 逻辑
    if (state.apps.some((app) => app.id === folderName)) continue
    const indexFile = path.join(appsDir, folderName, 'index.html')
    let html: string
    try {
      if (!fs.existsSync(indexFile)) continue
      html = fs.readFileSync(indexFile, 'utf-8')
    } catch {
      continue
    }
    try {
      html = validateGeneratedHtml(validateAppHtml(html))
    } catch {
      continue // 半成品/非法 HTML：跳过，AI 写完后再注册
    }
    const now = Date.now()
    const versionId = `version-${randomUUID()}`
    state.apps.unshift({
      id: folderName,
      name: folderName,
      source: 'ai_generated',
      activeVersionId: versionId,
      installed: true,
      createdAt: now,
      icon: null,
      versions: [{
        id: versionId,
        appId: folderName,
        version: '1.0.0',
        status: 'active',
        source: 'ai_generated',
        capabilities: [...DEFAULT_APP_CAPABILITIES],
        html,
        createdAt: now,
        createdBy: principal.guest ? 'guest' : 'user',
        parentVersionId: null,
      }],
    })
    console.log(`[webos] folder app registered: ${folderName} (${Buffer.byteLength(html, 'utf-8')} bytes)`)
    changed = true
  }
  return changed
}

function allowedCapabilities(value: unknown): string[] {
  if (value === undefined) return [...DEFAULT_APP_CAPABILITIES]
  if (!Array.isArray(value) || value.some((item) => (
    item !== PRIVATE_STORAGE_CAPABILITY && item !== APPS_CREATE_CAPABILITY
    && item !== APP_FS_CAPABILITY && item !== APP_FS_SHARED_CAPABILITY
  ))) {
    throw createError(400, 'APP_CAPABILITY_NOT_ALLOWED', `P0 只允许 ${DEFAULT_APP_CAPABILITIES.join(' / ')}`)
  }
  return [...new Set(value)] as string[]
}

function findApp(state: StoredState, appId: string): StoredApp {
  const app = state.apps.find((candidate) => candidate.id === appId)
  if (!app) throw createError(404, 'APP_NOT_FOUND', '找不到该 App')
  return app
}

function newApp(
  principal: Principal,
  name: string,
  html: string,
  source: 'ai_generated' | 'local_import',
  icon?: string | null,
): StoredApp {
  const appId = `app-${randomUUID()}`
  const versionId = `version-${randomUUID()}`
  const now = Date.now()
  return {
    id: appId,
    name,
    source,
    activeVersionId: versionId,
    installed: true,
    createdAt: now,
    icon: icon ?? null,
    versions: [{
      id: versionId,
      appId,
      version: '1.0.0',
      status: 'active',
      source,
      capabilities: [...DEFAULT_APP_CAPABILITIES],
      html,
      createdAt: now,
      createdBy: principal.guest ? 'guest' : 'user',
      parentVersionId: null,
    }],
  }
}

// AI 生成的 SVG 图标校验：只允许纯内联 SVG（无脚本、无外部引用、无事件处理器）
const MAX_APP_ICON_LENGTH = 32 * 1024
function validateAppIcon(value: unknown): string | null {
  if (value === undefined || value === null) return null
  if (typeof value !== 'string' || value.trim().length === 0) return null
  const icon = value.trim()
  if (icon.length > MAX_APP_ICON_LENGTH) {
    throw createError(400, 'APP_ICON_TOO_LARGE', `App 图标不得超过 ${MAX_APP_ICON_LENGTH} 字节`)
  }
  if (!/^<svg\b[\s\S]*<\/svg>$/i.test(icon)) {
    throw createError(400, 'INVALID_APP_ICON', 'App 图标必须是合法的 SVG 文档')
  }
  if (/<\s*(script|foreignObject|image|iframe|object|embed)\b/i.test(icon)) {
    throw createError(400, 'APP_ICON_FORBIDDEN_ELEMENT', 'App 图标不允许脚本或外部元素')
  }
  if (/\son\w+\s*=/i.test(icon) || /(?:href|xlink:href)\s*=\s*["']?\s*(?:https?:|\/\/)/i.test(icon)) {
    throw createError(400, 'APP_ICON_FORBIDDEN_REFERENCE', 'App 图标不允许事件处理器或外部引用')
  }
  return icon
}



/**
 * 对话会话注入的 App 工具集：pi agent 在对话中直接查看/修改 App。
 * 服务端只做安全校验与入库；费用由对话会话的 agent_end usage 统一计费。
 * 2026-08-14 已删除 create_webos_app 工具：创建 App 唯一路径 = 文件夹方式
 * （agent_fs_mkdir apps/<名称>/ + agent_fs_write index.html，系统自动注册）；
 * 用户粘贴 HTML 的 REST 入口 POST /webos/api/apps 保留（日后可单独做粘贴入口）。
 */

/** 列出用户已有的 App（轻量信息，不含 HTML 代码） */
function listWebosAppsTool(principal: Principal): ToolDefinition {
  return {
    name: 'list_webos_apps',
    label: '列出 App',
    description: '列出用户当前拥有的所有 App（id、名称、当前版本、是否有图标）。当用户要求“查看/列出我的 App、有什么应用”或需要修改某个已有 App 时先调用本工具。',
    parameters: Type.Object({}),
    execute: async () => {
      try {
        const state = await loadState(principal)
        const apps = state.apps
          .filter((app) => app.source !== 'builtin')
          .map((app) => ({
            id: app.id,
            name: app.name,
            version: app.versions.find((version) => version.id === app.activeVersionId)?.version ?? app.versions[0]?.version ?? null,
            hasIcon: Boolean(app.icon),
          }))
        return { content: [{ type: 'text', text: JSON.stringify({ success: true, apps }) }], details: {} }
      } catch (error) {
        return { content: [{ type: 'text', text: JSON.stringify({ success: false, message: error instanceof Error ? error.message : '列表获取失败' }) }], details: {}, isError: true }
      }
    },
  }
}

/** 修改已有 App：基于原代码生成新版本并切换运行版本（版本不可变，只新增指针） */
function updateWebosAppTool(principal: Principal): ToolDefinition {
  return {
    name: 'update_webos_app',
    label: '修改 App',
    description: [
      '修改用户已有的 App：先读取它的当前代码（用 agent_fs_read 读工作区文件 apps/<appId>/index.html，或先 list_webos_apps 拿到 appId），在保留原功能的基础上按用户要求改进，把完整的新 HTML 通过 html 参数传入。',
      '当用户要求“修改/改进/重做/换样式/加功能到某个已有 App”时调用。',
      '每次修改都会创建新的不可变版本并自动切换运行版本，历史版本保留可回滚。',
    ].join(' '),
    parameters: Type.Object({
      appId: Type.String({ description: 'App id（来自 list_webos_apps）' }),
      html: Type.String({ description: '修改后的完整自包含 HTML 文档（必填）' }),
      name: Type.Optional(Type.String({ description: '新的 App 名称（可选，不传保持原名）' })),
      icon: Type.Optional(Type.String({ description: '新的 App 图标（可选）：内联 SVG 字符串' })),
    }),
    execute: async (_toolCallId, params: { appId: string; html: string; name?: string; icon?: string }, _signal, _onUpdate) => {
      try {
        const state = await loadState(principal)
        const app = findApp(state, params.appId)
        const html = validateAppHtml(params.html)
        validateGeneratedHtml(html)
        assertAppHtmlRoom(principal, params.appId, html, state)
        const versionId = `version-${randomUUID()}`
        const now = Date.now()
        const current = app.versions.find((item) => item.id === app.activeVersionId) ?? app.versions[0]
        if (current) current.status = 'ready'
        const next = nextVersion(app)
        const newVersion: StoredVersion = {
          id: versionId,
          appId: app.id,
          version: next,
          status: 'active',
          source: 'ai_generated',
          // 2026-08-04 修复：继承 active 版本的能力声明（原写死仅 app.storage.private，
          // 导致 AI 每次修改 App 后 app.fs/app.fs.shared/system.apps.create 全部丢失，
          // App 内图片等文件资源读取 403）。AI 无法通过本工具缩小能力集（安全）。
          capabilities: current && current.capabilities.length > 0
            ? [...current.capabilities]
            : [...DEFAULT_APP_CAPABILITIES],
          html,
          createdAt: now,
          createdBy: principal.guest ? 'guest' : 'user',
          parentVersionId: current?.id ?? null,
        }
        app.versions.push(newVersion)
        app.activeVersionId = versionId
        if (typeof params.name === 'string' && params.name.trim()) app.name = params.name.trim().slice(0, 80)
        if (params.icon !== undefined) app.icon = validateAppIcon(params.icon)
        await saveState(principal, state)
        // 同步工作区源码镜像，保持 DB 与工作区文件一致
        writeAppSourceMirror(principal, app.id, html)
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({ success: true, appId: app.id, name: app.name, version: next }),
          }],
          details: {},
        }
      } catch (error) {
        const message = error && typeof error === 'object' && 'message' in error
          ? String((error as { message: unknown }).message)
          : 'App 修改失败，请稍后重试'
        const code = error && typeof error === 'object' && 'code' in error
          ? String((error as { code: unknown }).code)
          : 'APP_UPDATE_FAILED'
        return { content: [{ type: 'text', text: JSON.stringify({ success: false, code, message }) }], details: {}, isError: true }
      }
    },
  }
}

/**
 * 删除用户 App（含私有存储与 App 文件目录）。系统 App（builtin）受保护不可删。
 */
function deleteWebosAppTool(principal: Principal): ToolDefinition {
  const PROTECTED = new Set<string>(BUILTIN_APPS.map((app) => app.id))
  return {
    name: 'delete_webos_app',
    label: '删除 App',
    description: '删除用户创建的 App（App 文件夹移入回收站 apps/.trash/<appId>/，不直接删除文件；之后可用 agent_fs_* 读取被删内容，恢复 = 把文件夹复制回 apps/ 下即自动重新注册，彻底删除 = 删除回收站目录）。当用户要求“删除/移除/卸载某个 App”时调用。系统 App（system.desktop、daily.ai、system.store、system.files）受保护，不可删除。',
    parameters: Type.Object({
      appId: Type.String({ description: 'App id（来自 list_webos_apps）' }),
    }),
    execute: async (_toolCallId, params: { appId: string }) => {
      try {
        const state = await loadState(principal)
        const appId = params.appId
        if (PROTECTED.has(appId)) {
          return {
            content: [{ type: 'text', text: JSON.stringify({ success: false, code: 'SYSTEM_APP_PROTECTED', message: `系统 App（${appId}）不允许删除` }) }],
            details: {},
            isError: true,
          }
        }
        const before = state.apps.length
        state.apps = state.apps.filter((app) => app.id !== appId)
        if (state.apps.length === before) {
          return {
            content: [{ type: 'text', text: JSON.stringify({ success: false, code: 'APP_NOT_FOUND', message: `找不到 App：${appId}` }) }],
            details: {},
            isError: true,
          }
        }
        delete state.appStorage[appId]
        await saveState(principal, state)
        // 2026-08-06 删除 = 移入回收站 apps/.trash/<appId>/（不直接删除文件）：
        // AI 可用 agent_fs_* 读取被删 App 的文件；恢复 = 把文件夹复制回 apps/ 下
        // 即自动重新注册；彻底删除 = agent_fs_delete 删除回收站目录。
        moveAppToTrash(principal, appId)
        return { content: [{ type: 'text', text: JSON.stringify({ success: true, appId, deleted: true, trash: `apps/${APP_TRASH_DIR}/${appId}` }) }], details: {} }
      } catch (error) {
        const message = error && typeof error === 'object' && 'message' in error
          ? String((error as { message: unknown }).message)
          : 'App 删除失败，请稍后重试'
        return { content: [{ type: 'text', text: JSON.stringify({ success: false, code: 'APP_DELETE_FAILED', message }) }], details: {}, isError: true }
      }
    },
  }
}

// ---------------------------------------------------------------------------
// skill 读取/管理工具（webOS 受控 skills：.pi/skills-webos/）
// ---------------------------------------------------------------------------
// pi 的内置 skill 机制：只有「read」工具可用时，<available_skills> 才会被
// 注入系统提示词，且模型需要用 read 工具读取 SKILL.md。webOS 会话原本没有
// read 工具，导致 design/myself 等 skill 从未被 AI 感知。这里注册一个受控的
// read 工具：允许读取 .pi/skills-webos/ 下的 skill 文件（绝对/相对路径），
// 也兼容读取用户工作区文件（同 agent_fs_read），触发 skill 注入且不越权。

/** 解析 skill 文件路径：仅允许 .pi/skills-webos/ 内 */
function resolveSkillFilePath(inputPath: string): { full: string; label: string } {
  if (typeof inputPath !== 'string' || inputPath.length === 0 || inputPath.length > 512) {
    throw new Error('非法路径：长度必须在 1-512 之间')
  }
  if (inputPath.includes('\0')) throw new Error('非法路径：包含空字符')
  const trimmed = inputPath.trim().replace(/^\/+/, '')
  // 兼容绝对路径（把 /xxx/.pi/skills-webos/design/SKILL.md 归一化为相对）
  const skillsIdx = trimmed.indexOf('.pi/skills-webos/')
  const relative = skillsIdx >= 0 ? trimmed.slice(skillsIdx + '.pi/skills-webos/'.length) : trimmed
  if (relative.length === 0 || relative.startsWith('/') || relative.includes('..')) {
    throw new Error('skill 路径非法（仅允许 .pi/skills-webos/ 内）')
  }
  const full = path.resolve(SKILLS_WEBOS_DIR, relative)
  const check = path.relative(SKILLS_WEBOS_DIR, full)
  if (check.startsWith('..') || path.isAbsolute(check)) {
    throw new Error('skill 路径越界（仅允许 .pi/skills-webos/ 内）')
  }
  return { full, label: `.pi/skills-webos/${relative}` }
}

/** 受控 read 工具：只读 skill 文件（用户级 skills/ + 系统级 .pi/skills-webos/）。
 * 2026-08-14 职责收敛：此前本工具还兼容读取工作区文件（与 agent_fs_read 等价），
 * 造成两个 read 入口职责重复。现在工作区文件统一由 agent_fs_read 读取
 * （图片文件自动走 MiniMax-M3 视觉桥接），read 只保留 skill 读取语义。 */
function readTool(principal: Principal): ToolDefinition {
  return {
    name: 'read',
    label: '读取文件/Skill',
    description: [
      '读取 skill 文件内容（UTF-8，带行号，支持 offset/limit 按行读取）。',
      '1) 用户级 skill：path 为 skills 下的文件（如 "skills/myself/SKILL.md"——你自己的技能/记忆目录）；',
      '2) 系统级 skill：path 为 ".pi/skills-webos/design/SKILL.md" 或系统给出的绝对 <location> 路径。',
      '当任务匹配某个 skill 的描述时，先用本工具读取它的 SKILL.md。',
      '注意：本工具只读 skill 文件；读取工作区其他文件（草稿、素材、App 源码、图片等）请用 agent_fs_read。',
      '多个 skill 文件互不依赖时，可以在同一轮中多次调用本工具（并行读取，各自传 path），不要逐个等待。',
    ].join(' '),
    parameters: Type.Object({
      path: Type.String({ description: 'skill 文件路径：用户级 "skills/..." 或系统级 ".pi/skills-webos/..." 或系统给出的绝对 <location> 路径' }),
      offset: Type.Optional(Type.Number({ description: '起始行号（从 1 开始，默认 1）' })),
      limit: Type.Optional(Type.Number({ description: '读取行数（默认 2000）' })),
    }),
    execute: async (_toolCallId, params: { path: string; offset?: number; limit?: number }) => {
      const filePath = params.path
      try {
        let full: string
        let label: string
        if (filePath.includes('skills-webos')) {
          const resolved = resolveSkillFilePath(filePath)
          full = resolved.full
          label = resolved.label
        } else if (filePath.startsWith('skills/')) {
          // 2026-08-11 用户级 skills（myself 记忆等）：工作区 skills/ 目录
          const skillsRoot = getUserSkillsDir(principal.key)
          const rel = filePath.replace(/^skills\//, '')
          const candidate = path.resolve(skillsRoot, rel)
          const check = path.relative(skillsRoot, candidate)
          if (check.startsWith('..') || path.isAbsolute(check)) throw new Error('skill 路径越界（仅允许用户 skills 目录内）')
          full = candidate
          label = `skills/${rel}`
        } else {
          // 2026-08-14 职责收敛：read 只读 skill；工作区文件统一走 agent_fs_read
          return {
            content: [{ type: 'text', text: JSON.stringify({ success: false, message: 'read 工具只支持读取 skill 文件（skills/... 或 .pi/skills-webos/...）。读取工作区文件（草稿/素材/App 源码/图片）请用 agent_fs_read（图片会自动生成视觉描述）' }) }],
            details: {},
            isError: true,
          }
        }
        const stat = fs.statSync(full)
        if (!stat.isFile()) return { content: [{ type: 'text', text: JSON.stringify({ success: false, message: `不是文件：${label}` }) }], details: {}, isError: true }
        if (stat.size > 2 * 1024 * 1024) return { content: [{ type: 'text', text: JSON.stringify({ success: false, message: '文件过大' }) }], details: {}, isError: true }
        const content = fs.readFileSync(full, 'utf-8')
        const lines = content.split('\n')
        const startLine = Math.max(1, params.offset ?? 1) - 1
        const lineCount = params.limit ?? 2000
        const selected = lines.slice(startLine, startLine + lineCount)
        const numbered = selected.map((line, i) => `${String(startLine + i + 1).padStart(6)}→${line}`).join('\n')
        return {
          content: [{ type: 'text', text: numbered }],
          details: { path: label, totalLines: lines.length, shownLines: selected.length },
        }
      } catch (error) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ success: false, message: error instanceof Error ? error.message : '读取失败' }) }],
          details: {},
          isError: true,
        }
      }
    },
  }
}

/**
 * 管理 skill 文件（.pi/skills-webos/）：AI 可自由创建/更改自己的 skill，
 * 包括 SKILL.md 与 references/ 等参考文件。写 SKILL.md 时自动维护 frontmatter
 * （name = skill 目录名，保证被 pi 正确加载）。
 */
function manageSkillTool(principal: Principal): ToolDefinition {
  const log = (tool: string, params: Record<string, unknown>, ok: boolean, note?: string): void => {
    logAgentAction(principal.key, tool, params, ok, note)
  }
  const assertSkillName = (name: unknown): string => {
    if (typeof name !== 'string' || !SKILL_NAME_PATTERN.test(name)) {
      throw new Error(`skill 名非法（仅允许小写字母/数字/连字符，1-32 字符）：${String(name)}`)
    }
    return name
  }
  /** 从正文提取 description：第一行非空文本，去掉 markdown 标记，截断 120 字符 */
  const skillDescriptionFrom = (body: string, fallback: string): string => {
    const clean = body.replace(/^---[\s\S]*?---/, '').trim()
    const firstLine = clean.split('\n').find((line) => line.trim().length > 0) ?? ''
    const text = firstLine
      .trim()
      .replace(/^#{1,6}\s+/, '')
      .replace(/^[-*+]\s+/, '')
      .replace(/^\d+[.)]\s+/, '')
      .replace(/^>\s*/, '')
      .trim()
    return text.slice(0, 120) || fallback
  }
  return {
    name: 'manage_skill',
    label: '管理 Skill',
    description: [
      '创建/更新/删除你自己的 webOS skill（工作区 skills/ 目录下，**只影响你这个用户**）。',
      '用途：1) 运营你的长期记忆 skill「myself」——每次对话有新的发现、经验、教训、用户偏好时，更新它的 SKILL.md 或追加 references/ 下的参考文件；2) 创建新的专项 skill（如设计规范、项目知识）。',
      '写 SKILL.md 时无需带 --- frontmatter ---，工具会自动补全（name 固定为 skill 名）。',
      'action=write（默认）写文件，action=delete 删除文件。注意：系统级 skill（design 等）是全局只读的，不要尝试修改它们。',
    ].join(' '),
    parameters: Type.Object({
      skill: Type.String({ description: 'skill 名（目录名），如 "myself"、"design"；仅字母/数字/_-' }),
      path: Type.Optional(Type.String({ description: 'skill 内文件路径（默认 "SKILL.md"；reference 用 "references/xxx.md"）' })),
      content: Type.Optional(Type.String({ description: '文件内容（UTF-8）。写 SKILL.md 时不需要 frontmatter' })),
      action: Type.Optional(Type.String({ description: 'write（默认，创建/更新）或 delete（删除文件）' })),
    }),
    execute: async (_toolCallId, params: { skill: string; path?: string; content?: string; action?: string }) => {
      try {
        const name = assertSkillName(params.skill)
        // 2026-08-11 用户级 skills：写入工作区 skills/（每个用户独立，全局系统 skill 只读保护）
        const skillsRoot = getUserSkillsDir(principal.key)
        const relFile = (params.path ?? 'SKILL.md').trim().replace(/^\/+/, '')
        if (relFile.length === 0 || relFile === '.' || relFile.includes('..') || relFile.includes('\0') || relFile.length > 256) {
          throw new Error('skill 文件路径非法')
        }
        const dir = path.join(skillsRoot, name)
        const full = path.resolve(dir, relFile)
        const check = path.relative(dir, full)
        if (check.startsWith('..') || path.isAbsolute(check)) throw new Error('skill 文件路径越界')

        const action = params.action === 'delete' ? 'delete' : 'write'
        if (action === 'delete') {
          if (!fs.existsSync(full)) throw new Error(`文件不存在：${name}/${relFile}`)
          fs.unlinkSync(full)
          log('manage_skill', { skill: name, path: relFile, action }, true)
          return { content: [{ type: 'text', text: JSON.stringify({ success: true, action: 'delete', file: `${name}/${relFile}` }) }], details: {} }
        }

        if (typeof params.content !== 'string' || params.content.length === 0) {
          throw new Error('content 必填（写文件时需要文件内容）')
        }
        if (Buffer.byteLength(params.content, 'utf-8') > MAX_SKILL_FILE_BYTES) {
          throw new Error(`skill 文件过大（上限 ${MAX_SKILL_FILE_BYTES} 字节）`)
        }
        fs.mkdirSync(path.dirname(full), { recursive: true })
        let body = params.content
        if (relFile === 'SKILL.md') {
          // 自动维护 frontmatter：name 固定为 skill 名，保证 pi 正确加载
          const cleanBody = body.replace(/^---[\s\S]*?---/, '').trim()
          body = `---\nname: ${name}\ndescription: ${skillDescriptionFrom(body, `${name} skill`)}\nversion: 1.0.0\n---\n\n${cleanBody}`
        }
        fs.writeFileSync(full, body, 'utf-8')
        log('manage_skill', { skill: name, path: relFile, bytes: Buffer.byteLength(body, 'utf-8') }, true)
        return { content: [{ type: 'text', text: JSON.stringify({ success: true, action: 'write', file: `${name}/${relFile}`, bytes: Buffer.byteLength(body, 'utf-8') }) }], details: {} }
      } catch (error) {
        log('manage_skill', params as Record<string, unknown>, false, error instanceof Error ? error.message : String(error))
        return { content: [{ type: 'text', text: JSON.stringify({ success: false, message: error instanceof Error ? error.message : 'skill 操作失败' }) }], details: {}, isError: true }
      }
    },
  }
}

// ---------------------------------------------------------------------------
// 2026-08-02 生图 + 图片编辑工具（generate_image / edit_image）
// ---------------------------------------------------------------------------

/** 生图输出目录（工作区内）：agent/images/（AI 私有草稿区） */
function imagesRoot(key: string): string {
  const dir = path.join(getWorkspaceRoot(key), 'agent', 'images')
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

/** 公开图片目录（2026-08-07）：App 沙箱 iframe（opaque origin）加载 <img> 不携带
 *  cookie（SameSite 第三方上下文）→ 鉴权图片端点返回 401 被 Chrome ORB 拦截，
 *  图片无法显示。生图文件名含不可枚举 UUID（timestamp_uuid8），按公开资源处理
 *  （与分享链接同级风险），额外复制一份到全局目录供免鉴权读取。 */

/** 保存生成的图片（PNG buffer → 工作区文件；size 传入时强制缩放后再存；outputDir 指定输出目录，默认 agent/images/），返回 { path, url, width?, height? } */
async function saveImageFile(key: string, buffer: Buffer, tag: string, size?: string, outputDir?: string): Promise<{ path: string; url: string; width?: number; height?: number }> {
  let out = buffer
  if (size && /^\d+x\d+$/.test(size)) {
    try {
      out = await resizePngToSize(buffer, size)
    } catch (error) {
      console.warn('[webos] resize requested size failed, keep original:', error instanceof Error ? error.message : String(error))
    }
  }
  // 2026-08-14 产物尺寸探测（PNG/JPEG/GIF/WebP）：素材工具返回真实像素尺寸，
  // AI 写游戏碰撞/布局用真实尺寸，避免"猜尺寸"导致判定偏差
  const dim = imageSizeOf(out) ?? null
  const name = `${Date.now()}_${tag}_${randomUUID().slice(0, 8)}.png`
  // 2026-08-13 输出目录可指定（output_dir 参数，工作区相对路径；默认 agent/images/）
  let dir: string
  let relBase = 'agent/images'
  if (outputDir && typeof outputDir === 'string' && outputDir.trim()) {
    dir = resolveWorkspacePath(key, outputDir.trim())
    relBase = outputDir.trim().replace(/^\/+/, '')
  } else {
    dir = imagesRoot(key)
  }
  fs.mkdirSync(dir, { recursive: true })
  const full = path.join(dir, name)
  fs.writeFileSync(full, out)
  // 2026-08-07 双写公开目录（沙箱 iframe 免鉴权加载；失败不阻断）
  try {
    fs.mkdirSync(PUBLIC_IMAGES_DIR, { recursive: true })
    fs.copyFileSync(full, path.join(PUBLIC_IMAGES_DIR, name))
  } catch (error) {
    console.warn('[webos] public image mirror failed:', error instanceof Error ? error.message : String(error))
  }
  return {
    path: `${relBase}/${name}`,
    url: `/webos/api/imagegen/file/${name}`,
    ...(dim ? { width: dim.width, height: dim.height } : {}),
  }
}

// ---------------------------------------------------------------------------
// 2026-08-07 公开图片/App 素材端点（免鉴权，挂载在 authMiddleware 之前）：
// App 沙箱 iframe 的 img/素材请求不带 cookie，鉴权端点 401 → ORB 拦截 → 图片不显示。
// 文件名/App id 均为不可枚举 UUID，公开访问与分享链接同级风险。
// ---------------------------------------------------------------------------
const PUBLIC_FILE_NAME_PATTERN = /^[a-zA-Z0-9._-]{1,140}$/
// 2026-08-14 支持中文等 Unicode appId（「文件夹即 App」中文文件夹名）；仍排除路径分隔符
const PUBLIC_APP_ID_PATTERN = /^[\p{L}\p{N} ._:-]{1,128}$/u
/** App id → 其工作区根目录的缓存（首次找到后缓存，目录删除时失效重查） */
const publicAppRootCache = new Map<string, string>()

/** 公开素材端点统一 CORS 头（2026-08-08）：公开图片/视频/素材允许任意跨域读取，
 *  App sandbox iframe（opaque origin）内 canvas 绘制这些素材不会污染画布
 *  （如游戏用精灵图做动画后可 getImageData / toDataURL） */
function setPublicCors(res: Response): void {
  res.setHeader('Access-Control-Allow-Origin', '*')
}

/** GET /webos/api/imagegen/file/:name（免鉴权）：读公开图片目录（生图时双写）；?w= 缩放为 webp 缩略图 */
export async function servePublicImageFile(req: Request, res: Response): Promise<void> {
  try {
    const name = String(req.params.name ?? '')
    if (!PUBLIC_FILE_NAME_PATTERN.test(name) || name.includes('..')) {
      res.status(404).json({ error: 'NOT_FOUND' })
      return
    }
    const full = path.join(PUBLIC_IMAGES_DIR, name)
    if (!fs.existsSync(full) || !fs.statSync(full).isFile()) {
      res.status(404).json({ error: 'NOT_FOUND' })
      return
    }
    // 2026-08-05 低带宽优化：?w= 生成 webp 缩略图（ImageMagick + 磁盘缓存；失败回退原图）
    const scaleW = parseScaleWidth(req.query.w)
    if (scaleW !== null && await serveScaledImage(res, full, scaleW)) return
    setPublicCors(res)
    const ext = path.extname(full).toLowerCase()
    const mime = ext === '.png' ? 'image/png' : ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : ext === '.webp' ? 'image/webp' : ext === '.gif' ? 'image/gif' : 'application/octet-stream'
    res.setHeader('Content-Type', mime)
    res.setHeader('Cache-Control', 'public, max-age=86400')
    fs.createReadStream(full).pipe(res)
  } catch (error) {
    console.warn('[webos] servePublicImageFile failed:', error instanceof Error ? error.message : String(error))
    if (!res.headersSent) res.status(500).end()
  }
}

/**
 * GET /webos/api/videogen/file/:name（免鉴权）：AI 生成的视频文件（MiniMax-H3 / 视频处理产物）。
 * 支持 .mp4（Range 拖动）与 .webm（去背景 alpha 产物，VP9）。
 * 视频名含不可枚举 UUID；App sandbox iframe（opaque origin）加载 <video src> 不带
 * cookie，必须免鉴权。
 */
export function servePublicVideoFile(req: Request, res: Response): void {
  try {
    const name = String(req.params.name ?? '')
    if (!PUBLIC_FILE_NAME_PATTERN.test(name) || name.includes('..') || (!name.endsWith('.mp4') && !name.endsWith('.webm'))) {
      res.status(404).json({ error: 'NOT_FOUND' })
      return
    }
    const isWebm = name.endsWith('.webm')
    const full = path.join(process.cwd(), 'data', 'webos-public-videos', name)
    if (!fs.existsSync(full) || !fs.statSync(full).isFile()) {
      res.status(404).json({ error: 'NOT_FOUND' })
      return
    }
    const stat = fs.statSync(full)
    setPublicCors(res)
    res.setHeader('Content-Type', isWebm ? 'video/webm' : 'video/mp4')
    res.setHeader('Accept-Ranges', 'bytes')
    res.setHeader('Cache-Control', 'public, max-age=86400')
    // Range 请求支持（视频拖动/分段加载；nginx 反代下也透传）
    const range = req.headers.range
    if (range) {
      const match = /bytes=(\d*)-(\d*)/.exec(range)
      if (match) {
        const start = match[1] ? parseInt(match[1], 10) : 0
        const end = match[2] ? parseInt(match[2], 10) : stat.size - 1
        if (start >= 0 && end >= start && end < stat.size) {
          res.status(206)
          res.setHeader('Content-Range', `bytes ${start}-${end}/${stat.size}`)
          res.setHeader('Content-Length', end - start + 1)
          fs.createReadStream(full, { start, end }).pipe(res)
          return
        }
      }
      res.status(416).setHeader('Content-Range', `bytes */${stat.size}`).end()
      return
    }
    res.setHeader('Content-Length', stat.size)
    fs.createReadStream(full).pipe(res)
  } catch (error) {
    console.warn('[webos] servePublicVideoFile failed:', error instanceof Error ? error.message : String(error))
    if (!res.headersSent) res.status(500).end()
  }
}

/** 全局查找某个 appId 的工作区根目录（apps/<appId>/ 所在用户目录） */
function findPublicAppRoot(appId: string): string | null {
  const cached = publicAppRootCache.get(appId)
  if (cached) {
    if (fs.existsSync(cached)) return cached
    publicAppRootCache.delete(appId)
  }
  try {
    const workspaceRoot = path.join(getSandboxRoot(), 'webos')
    if (!fs.existsSync(workspaceRoot)) return null
    for (const dir of fs.readdirSync(workspaceRoot)) {
      const candidate = path.join(workspaceRoot, dir, 'apps', appId)
      if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) {
        publicAppRootCache.set(appId, candidate)
        return candidate
      }
    }
  } catch { /* 忽略 */ }
  return null
}

/** 公共图片/素材 MIME（png/jpg/webp/gif/svg/ico/json/txt/html/css/js/mp3/mp4 等） */
function publicRawMime(ext: string): string {
  const map: Record<string, string> = {
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', svg: 'image/svg+xml',
    ico: 'image/x-icon', json: 'application/json', txt: 'text/plain', html: 'text/html', htm: 'text/html',
    css: 'text/css', js: 'text/javascript', mjs: 'text/javascript', mp3: 'audio/mpeg', mp4: 'video/mp4', wav: 'audio/wav', ogg: 'audio/ogg',
    woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf', pdf: 'application/pdf', zip: 'application/zip',
  }
  return map[ext] ?? 'application/octet-stream'
}

// ---------------------------------------------------------------------------
// 2026-08-05 图片缩放代理（低带宽优化）：素材端点支持 ?w=<宽度> —— 服务端用
// ImageMagick 缩放 + 转 webp + 磁盘缓存。App 列表/缩略图/预览用 w=320 等小尺寸，
// 流量可省 60-90%；原图不变，仅多一个缩略产物。白名单尺寸防缓存爆炸。
// ---------------------------------------------------------------------------
const IMG_CACHE_DIR = path.join(process.cwd(), 'data', 'imgcache')
const IMG_SCALE_WIDTHS = new Set([96, 128, 192, 256, 320, 512, 640, 768, 1024, 1280])
let convertAvailable: boolean | null = null
async function hasImageMagick(): Promise<boolean> {
  if (convertAvailable !== null) return convertAvailable
  try {
    await new Promise<void>((resolve, reject) => {
      const { execFile } = require('node:child_process') as typeof import('node:child_process')
      execFile('which', ['convert'], (error) => (error ? reject(error) : resolve()))
    })
    convertAvailable = true
  } catch {
    convertAvailable = false
  }
  return convertAvailable
}

/**
 * 缩放图片响应：w 合法时生成 webp 缩略图（磁盘缓存）；返回 true 表示已接管响应。
 * 任何失败（无 ImageMagick/转换失败）回退 false → 调用方按原图处理。
 */
async function serveScaledImage(res: Response, full: string, w: number): Promise<boolean> {
  try {
    if (!IMG_SCALE_WIDTHS.has(w)) return false
    const stat = fs.statSync(full)
    if (!stat.isFile() || stat.size <= 0 || stat.size > 30 * 1024 * 1024) return false
    const ext = path.extname(full).toLowerCase()
    const isImage = ['.png', '.jpg', '.jpeg', '.webp', '.gif'].includes(ext)
    if (!isImage) return false
    if (!(await hasImageMagick())) return false
    const { createHash } = await import('node:crypto')
    const key = createHash('sha1').update(`${full}:${stat.size}:${Math.floor(stat.mtimeMs)}:${w}`).digest('hex').slice(0, 20)
    const cacheDir = path.join(IMG_CACHE_DIR, String(w))
    const cacheFile = path.join(cacheDir, `${key}.webp`)
    if (!fs.existsSync(cacheFile)) {
      fs.mkdirSync(cacheDir, { recursive: true })
      const tmpOut = `${cacheFile}.${Date.now()}.tmp`
      const { execFile } = require('node:child_process') as typeof import('node:child_process')
      await new Promise<void>((resolve, reject) => {
        execFile('convert', [full, '-auto-orient', '-resize', `${w}x`, '-strip', '-quality', '82', `webp:${tmpOut}`], { maxBuffer: 64 * 1024 * 1024 }, (error) => (error ? reject(error) : resolve()))
      })
      fs.renameSync(tmpOut, cacheFile)
    }
    res.setHeader('Content-Type', 'image/webp')
    res.setHeader('Cache-Control', 'public, max-age=86400')
    fs.createReadStream(cacheFile).pipe(res)
    return true
  } catch {
    return false
  }
}

/** 解析 ?w= 参数（非法返回 null；调用方忽略缩放） */
function parseScaleWidth(value: unknown): number | null {
  const w = Number(value)
  return Number.isInteger(w) && IMG_SCALE_WIDTHS.has(w) ? w : null
}

/** GET /webos/api/apps/:appId/files/raw/<rest> 或 ?path=（免鉴权）：App 素材文件（全局按 appId 查找）；?w= 缩放为 webp 缩略图 */
export async function servePublicAppRawFile(req: Request, res: Response): Promise<void> {
  try {
    if (req.method !== 'GET') { res.status(405).end(); return }
    const appId = String(req.params.appId ?? '')
    if (!PUBLIC_APP_ID_PATTERN.test(appId) || appId.includes('..')) {
      res.status(404).json({ error: 'NOT_FOUND' })
      return
    }
    // 支持两种形式：/raw/assets/x.png（前缀式，use 挂载）与 /raw?path=assets/x.png（query 式）
    let rel = ''
    if (req.query.path && typeof req.query.path === 'string' && req.query.path.trim()) {
      rel = req.query.path.trim()
    } else {
      rel = decodeURIComponent(req.url.replace(/^\//, ''))
    }
    if (!rel || rel.includes('..') || /^\/+/.test(rel) || rel.length > 500) {
      res.status(404).json({ error: 'NOT_FOUND' })
      return
    }
    const appRoot = findPublicAppRoot(appId)
    if (!appRoot) {
      res.status(404).json({ error: 'NOT_FOUND' })
      return
    }
    const full = path.normalize(path.join(appRoot, rel))
    if (!full.startsWith(path.normalize(appRoot) + path.sep) || !fs.existsSync(full) || !fs.statSync(full).isFile()) {
      res.status(404).json({ error: 'NOT_FOUND' })
      return
    }
    // 2026-08-05 低带宽优化：?w= 生成 webp 缩略图（ImageMagick + 磁盘缓存；失败回退原图）
    const scaleW = parseScaleWidth(req.query.w)
    if (scaleW !== null && await serveScaledImage(res, full, scaleW)) return
    setPublicCors(res)
    const ext = path.extname(full).toLowerCase().replace('.', '')
    res.setHeader('Content-Type', publicRawMime(ext))
    res.setHeader('Cache-Control', 'public, max-age=86400')
    // 【安全修复 2026-08-16（C4）】：html/js/mjs/xml 等可执行类型在公开同源
    // 端点直接内联返回会被当作主域脚本/页面执行（存储型 XSS）。强制下载（attachment）
    // + CSP sandbox，阻断同源执行。SVG 保留内联（<img> 上下文不执行脚本，且大量
    // App 用 SVG 做图标/素材）。
    // 【回归审查修正】：不能对所有请求加 attachment——App 静态包内 <iframe src="xxx.html">
    // 属子资源导航，attachment 会导致 ERR_ABORTED 加载失败。仅对**顶级导航**
    // （Sec-Fetch-Dest: document 且非 iframe/子资源）加 attachment+CSP。
    const EXECUTABLE_EXTENSIONS = new Set(['html', 'htm', 'js', 'mjs', 'xml'])
    const secFetchDest = String(req.headers['sec-fetch-dest'] ?? '')
    const isTopLevelNavigation = secFetchDest === 'document' || secFetchDest === ''
    if (EXECUTABLE_EXTENSIONS.has(ext) && isTopLevelNavigation) {
      res.setHeader('Content-Disposition', `attachment; filename="${path.basename(full)}"`)
      res.setHeader('Content-Security-Policy', "sandbox; default-src 'none'")
    }
    // 2026-08-08：视频素材（mp4/webm）支持 Range 分段加载——此前 App 里 <video src="assets/xxx.mp4">
    // 走此端点全量下载完才能播放（对话页走 videogen/file 支持 Range 所以秒开），
    // 跨境网络下几 MB 也要等几十秒。moov 已 faststart（偏移 ~36B），Range 一发即可秒播。
    if (ext === 'mp4' || ext === 'webm') {
      const stat = fs.statSync(full)
      res.setHeader('Accept-Ranges', 'bytes')
      const range = req.headers.range
      if (range) {
        const match = /bytes=(\d*)-(\d*)/.exec(range)
        if (match) {
          const start = match[1] ? parseInt(match[1], 10) : 0
          const end = match[2] ? parseInt(match[2], 10) : stat.size - 1
          if (start >= 0 && end >= start && end < stat.size) {
            res.status(206)
            res.setHeader('Content-Range', `bytes ${start}-${end}/${stat.size}`)
            res.setHeader('Content-Length', end - start + 1)
            fs.createReadStream(full, { start, end }).pipe(res)
            return
          }
        }
        res.status(416).setHeader('Content-Range', `bytes */${stat.size}`).end()
        return
      }
      res.setHeader('Content-Length', stat.size)
    }
    fs.createReadStream(full).pipe(res)
  } catch (error) {
    console.warn('[webos] servePublicAppRawFile failed:', error instanceof Error ? error.message : String(error))
    if (!res.headersSent) res.status(500).end()
  }
}

/** 生图工具：AI 在对话中直接生成图片到工作区（支持同图变体 n 张，或 prompts 数组一次生成多张不同内容的图） */
function generateImageTool(principal: Principal): ToolDefinition {
  return {
    name: 'generate_image',
    label: '生成图片',
    description: '用 AI 生成图片并保存到工作区（模型 gpt-image-2-super）。两种用法：①prompt + n：同一提示词的多张变体；②prompts：**给每张图单独设定提示词的批量生成**（1-6 张，每张不同内容，如一套饮品图/多张壁纸——一次调用全部生成，对话里一个工具卡片展示全部图片）。传 reference_image（工作区图片路径）则基于参考图生成变体/改图。返回图片路径、访问 URL **与真实像素尺寸 width/height**（写游戏碰撞判定/布局时务必用返回的真实尺寸，不要猜）。size 强制生效（生成后服务端缩放，如 512x512 / 1024x1024 / 1280x720，默认 1024x1024）。生成后可用 agent_fs_* 管理，App 素材放 apps/<appId>/assets/。⚠️内容边界（2026-08-20）：底层 OpenAI 系图像模型对「人物/动漫角色」题材审查极严，图生图（reference_image 为动漫/女性角色）极易被安全系统拒绝（错误码 SAFETY_REJECTED，违规类别多为 sexual）——这是上游内容审查的确定性策略，非系统故障、不扣费。生成人物类图请避免 anime girl、少女/女仆/校服、身材或衣着描写；遇 SAFETY_REJECTED 应主动改写题材（改场景/物品/动物等非人物主体）或更换参考图后重试，**不要用同一触雷提示词反复重试**。',
    parameters: Type.Object({
      prompt: Type.Optional(Type.String({ description: '图像内容描述（英文效果最佳；图生图时描述对参考图要做的修改）' })),
      prompts: Type.Optional(Type.Array(Type.String({ description: '每张图独立的提示词（1-6 个；传了则忽略 prompt/n，一次调用生成多张不同内容的图）' }), { description: '多张不同图片各自的提示词（如 ["抹茶拿铁","冰拿铁","珍珠奶茶"]）' })),
      n: Type.Optional(Type.Number({ description: '同一 prompt 的生成数量 1-4（默认 1；要每张不同内容请用 prompts）' })),
      size: Type.Optional(Type.String({ description: '输出尺寸（强制生效，服务端缩放）：如 512x512 / 1024x1024 / 768x1024 / 1280x720（默认 1024x1024）' })),
      reference_image: Type.Optional(Type.String({ description: '参考图的工作区路径（如 agent/images/xxx.png、home/素材/xxx.png、apps/<appId>/assets/xxx.png）；传了就走图生图（基于该图生成变体/修改）' })),
      output_dir: Type.Optional(Type.String({ description: '输出目录（工作区相对路径，默认 agent/images/；如 home/素材/、apps/<appId>/assets/ 直接生成进 App 素材区）' })),
    }),
    execute: async (_toolCallId, params: { prompt?: string; prompts?: string[]; n?: number; size?: string; reference_image?: string; output_dir?: string }, _signal, onUpdate) => {
      // output_dir 校验（可选；工作区内任意路径，越界/非法返回明确错误）
      let outputDir: string | undefined
      if (params.output_dir && typeof params.output_dir === 'string' && params.output_dir.trim()) {
        try {
          resolveWorkspacePath(principal.key, params.output_dir.trim())
          outputDir = params.output_dir.trim().replace(/^\/+/, '')
        } catch (error) {
          return {
            content: [{ type: 'text', text: JSON.stringify({ success: false, error: 'BAD_OUTPUT_DIR', message: `输出目录无效：${error instanceof Error ? error.message : String(error)}` }) }],
            details: {}, isError: true,
          }
        }
      }
      // 每张独立的提示词列表（优先 prompts；退化到单 prompt）
      const promptList = (Array.isArray(params.prompts) ? params.prompts : []).map((p) => String(p).trim()).filter(Boolean).slice(0, 6)
      const singlePrompt = String(params.prompt ?? '').trim()
      const prompts = promptList.length > 0 ? promptList : (singlePrompt ? [singlePrompt] : [])
      const summaryPrompt = prompts.join(' | ').slice(0, 500)
      const state = await loadState(principal)
      if (remainingCredits(state) <= 0) {
        await recordImageGenUsage({
          userKey: principal.key, userEmail: principal.email ?? null, kind: principalKind(principal, state),
          prompt: summaryPrompt, n: prompts.length, images: 0, inputTokens: 0, outputTokens: 0, costMinor: 0,
          status: 'insufficient', errorCode: 'TOKEN_INSUFFICIENT', durationMs: 0,
        })
        return {
          content: [{ type: 'text', text: JSON.stringify({ success: false, error: 'TOKEN_INSUFFICIENT', message: '积分已用完（剩余 0）。站长已开放免费获取额度通道，请用户到个人主页查看获取方式' }) }],
          details: {}, isError: true,
        }
      }
      // 2026-08-06 未充值用户限次：生图成功 ≤10 次（月卡/尝鲜包用户不限）
      const isPaidImage = !!state.credits.monthly || (state.credits.permanent?.quota ?? 0) > 0
      if (!isPaidImage) {
        try {
          const pool = getPool()
          const used = await pool.query('SELECT COUNT(*) AS n FROM webos_imagegen_usage WHERE user_key = $1 AND status = \'ok\'', [principal.key])
          if (Number(used.rows?.[0]?.n ?? 0) >= 10) {
            return {
              content: [{ type: 'text', text: JSON.stringify({ success: false, error: 'FREE_IMAGE_LIMIT', message: '未充值用户生图次数已达上限（10 次）。订阅月卡或购买尝鲜用量包后不限次数——个人主页「订阅支持」可购买（爱发电，付款后填注册邮箱自动到账）' }) }],
              details: {}, isError: true,
            }
          }
        } catch { /* 限次查询失败不阻断 */ }
      }
      if (!imageGenConfigured()) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ success: false, error: 'IMAGE_GEN_NOT_CONFIGURED', message: '生图渠道未配置（服务器缺少 CHATST_IMAGE_API_KEY）' }) }],
          details: {}, isError: true,
        }
      }
      if (prompts.length === 0) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ success: false, error: 'EMPTY_PROMPT', message: '请提供 prompt 或 prompts（每张图独立的提示词）' }) }],
          details: {}, isError: true,
        }
      }
      // 参考图（可选）：工作区路径 → buffer（prompts 多张模式同样支持，全部基于参考图改图）
      let referenceImage: Buffer | undefined
      if (params.reference_image) {
        try {
          const full = resolveWorkspacePath(principal.key, params.reference_image)
          const stat = fs.statSync(full)
          if (!stat.isFile()) throw new Error('参考图不是文件')
          if (stat.size > 8 * 1024 * 1024) throw new Error('参考图超过 8MB 限制')
          referenceImage = fs.readFileSync(full)
        } catch (error) {
          return {
            content: [{ type: 'text', text: JSON.stringify({ success: false, error: 'BAD_REFERENCE_IMAGE', message: `参考图读取失败：${error instanceof Error ? error.message : String(error)}` }) }],
            details: {}, isError: true,
          }
        }
      }
      // 多张不同提示词：并发生成（每张独立调用上游），全部成功才整体成功；失败张跳过并记录
      const perPromptN = promptList.length > 0 ? 1 : (Math.min(4, Math.max(1, Math.floor(Number(params.n) || 1))))
      // 2026-08-07 工具过程增量：每张开始/完成都报告进度（tool_execution_update → SSE tool_update），
      // 前端工具 chip 的「已输出 N 字」随生成进度实时跳动，不再卡在固定字数。
      const totalJobs = prompts.length * perPromptN
      let doneJobs = 0
      const jobs = prompts.map((p, idx) => (async () => {
        try {
          onUpdate?.({ content: [{ type: 'text', text: `正在生成第 ${idx + 1}/${prompts.length} 张：${p.slice(0, 30)}${p.length > 30 ? '…' : ''}` }], details: {} })
          const r = await generateImages({ prompt: p, n: perPromptN, size: params.size, referenceImage })
          doneJobs += perPromptN
          onUpdate?.({ content: [{ type: 'text', text: `第 ${idx + 1}/${prompts.length} 张完成（${doneJobs}/${totalJobs}）` }], details: {} })
          return r
        } catch (error) {
          throw error
        }
      })())
      const settled = await Promise.all(jobs.map((job) => job.then((r) => ({ r }), (error) => ({ r: {
        ok: false, images: [], inputTokens: 0, outputTokens: 0, costMinor: 0, durationMs: 0,
        status: 'failed', errorCode: 'UPSTREAM_ERROR',
        errorMessage: error instanceof Error ? error.message.slice(0, 200) : String(error),
      } }))))
      const results = settled.map((item) => item.r)
      let images = 0
      const files: Array<{ path: string; url: string }> = []
      const failures: string[] = []
      const totalCostMinor = results.reduce((sum, r) => sum + r.costMinor, 0)
      const totalInput = results.reduce((sum, r) => sum + r.inputTokens, 0)
      const totalOutput = results.reduce((sum, r) => sum + r.outputTokens, 0)
      const totalDuration = results.reduce((sum, r) => sum + r.durationMs, 0)
      for (let i = 0; i < results.length; i += 1) {
        const r = results[i]
        if (!r.ok || r.images.length === 0) {
          failures.push(`#${i + 1} ${prompts[i]?.slice(0, 40) ?? ''}${r.errorMessage ? `（${r.errorMessage.slice(0, 220)}）` : ''}`)
          continue
        }
        for (const buffer of r.images) {
          const file = await saveImageFile(principal.key, buffer, 'gen', params.size, outputDir)
          files.push(file)
          images += 1
        }
      }
      // 扣减积分（1 积分 = 1 分钱；按生图定价表折算，不足 clamp 不超扣）
      const actual = chargeCredits(state, totalCostMinor)
      await saveState(principal, state)
      // 2026-08-20 归因优化：全部失败时 errorCode 优先取第一个失败结果的独立错误码
      // （如 SAFETY_REJECTED / HTTP_400 / TIMEOUT），便于管理后台按类型筛选，不再
      // 把整段失败文本塞进 error_code（此前 SAFETY_REJECTED 被吞成原始 JSON 无法归类）。
      const failCode = results.find((r) => !r.ok)?.errorCode
        ?? (failures[0]?.slice(0, 300) ?? 'GENERATION_FAILED')
      await recordImageGenUsage({
        userKey: principal.key, userEmail: principal.email ?? null, kind: principalKind(principal, state),
        prompt: summaryPrompt, n: prompts.length, images,
        inputTokens: totalInput, outputTokens: totalOutput, costMinor: totalCostMinor,
        status: images > 0 ? 'ok' : 'failed', errorCode: images > 0 ? undefined : failCode,
        durationMs: totalDuration,
      })
      if (images === 0) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ success: false, error: 'GENERATION_FAILED', message: `全部生成失败：${failures.join('；')}` }) }],
          details: {}, isError: true,
        }
      }
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            files,
            failed: failures.length > 0 ? failures : undefined,
            tokens: { input: totalInput, output: totalOutput, charged: actual },
            costMinor: totalCostMinor,
            pricing: IMAGE_PRICING,
          }),
        }],
        details: {},
      }
    },
  }
}

// ============================================================================
// 2026-08-05 视频生成工具（generate_video）— 2026-08-06 增强
// 模型 MiniMax-H3（秘塔渠道）。
// - 权限：游客禁止；未充值（quota 未提升）用户仅可体验 1 次
// - 计费（2026-08-06 用户决策：**官方刊例价打 5 折**）：768P ¥0.25/秒、2K ¥0.40/秒
//   （4 秒 768P = 100 积分）；后台成本按秘塔渠道价落库统计
// - H3-Context-IR 增强默认开启（渠道未充值时自动降级），成功时单独落 h3_context_ir
//   用量行（官方价 5.8/23 元每百万 token 折算成本）
// - 输入：文生视频（推荐）；reference_images 参考图（1-9 张，效果比首尾帧好）；
//   start_image/end_image 首尾帧（**精确控制起止画面时才用，效果一般**）
// ============================================================================

/** 公网基础地址（MiniMax/秘塔要求 image_url 必须是完整 http(s) URL） */
const PUBLIC_BASE = process.env.WEBOS_PUBLIC_BASE_URL ?? 'https://shadowshub.xyz'

/** 工作区图片 → 全局公开 URL（视频生成输入帧需要公网 URL；不可枚举 UUID 与分享同级） */
function publicFrameUrl(principal: Principal, sourcePath: string): string | null {
  try {
    const full = resolveWorkspacePath(principal.key, String(sourcePath).trim())
    const stat = fs.statSync(full)
    if (!stat.isFile()) return null
    if (stat.size > 30 * 1024 * 1024) return null
    const buf = fs.readFileSync(full)
    const ext = path.extname(full).toLowerCase().replace('.', '')
    const allowedExt = ext === 'png' || ext === 'jpg' || ext === 'jpeg' || ext === 'webp' ? (ext === 'jpeg' ? 'jpg' : ext) : null
    if (!allowedExt) return null
    const name = `frame-${randomUUID().slice(0, 8)}-${Date.now().toString(36)}.${allowedExt}`
    fs.mkdirSync(PUBLIC_IMAGES_DIR, { recursive: true })
    fs.writeFileSync(path.join(PUBLIC_IMAGES_DIR, name), buf)
    // 2026-08-06 必须返回完整公网 URL：MiniMax 校验 image_url.url 为公开 http(s)
    return `${PUBLIC_BASE}/webos/api/imagegen/file/${name}`
  } catch {
    return null
  }
}

function generateVideoTool(principal: Principal): ToolDefinition {
  return {
    name: 'generate_video',
    label: '生成视频',
    description: [
      '用 AI 生成视频（模型 MiniMax-H3）。**推荐文生视频**：prompt 描述画面（场景/运镜/光线/动作，中文即可，细节越具体越好）。',
      '图生视频两种方式：① reference_images（参考图数组，1-9 张，**效果好，优先用**——给模型参考角色/风格）；② start_image/end_image 首尾帧（**效果一般，仅当需要精确控制起止画面时才用，不要滥用**）。',
      '参数：resolution 768P/2K（默认 768P，2K 更贵且生成更慢，默认不要用）、duration 4-15 秒（默认 4）、ratio 画面比例（16:9 横屏默认 / 9:16 竖屏短视频）。',
      '生成耗时约 1-5 分钟（对话内实时显示进度）。完成后返回视频路径与 URL，**同时返回 poster 首帧封面图**（App 里 <video poster="封面URL" src="视频URL" controls preload="metadata"> 秒开预览，小带宽友好）。',
      '生成的视频可用 edit_video 工具处理（抽帧/精灵图/GIF/去背景/裁剪/倍速等），App 素材放 apps/<appId>/assets/。',
      '计费：官方刊例价 5 折（768P 25 积分/秒、2K 40 积分/秒；4 秒 768P = 100 积分）。游客不可用；未充值用户仅 1 次免费体验。',
    ].join(' '),
    parameters: Type.Object({
      prompt: Type.String({ description: '视频内容描述（画面/运镜/光线/动作，越具体越好；中文即可）' }),
      duration: Type.Optional(Type.Number({ description: '视频时长（秒），4-15，默认 4' })),
      resolution: Type.Optional(Type.Union(
        [Type.Literal('768P'), Type.Literal('2K')],
        { description: '分辨率：768P（默认，推荐）/ 2K（更贵更慢，默认不用）' },
      )),
      ratio: Type.Optional(Type.Union(
        [Type.Literal('21:9'), Type.Literal('16:9'), Type.Literal('4:3'), Type.Literal('1:1'), Type.Literal('3:4'), Type.Literal('9:16'), Type.Literal('adaptive')],
        { description: '画面比例，默认 16:9；竖屏短视频用 9:16' },
      )),
      reference_images: Type.Optional(Type.Array(Type.String({ description: '参考图的工作区路径（1-9 张，如 ["agent/images/角色.png"]）；效果比首尾帧好，优先用；与 start/end_image 二选一' }), { description: '参考图列表（1-9 张）' })),
      start_image: Type.Optional(Type.String({ description: '首帧图片的工作区路径；**仅需精确控制起止画面时用**（效果一般，能不用就不用）' })),
      end_image: Type.Optional(Type.String({ description: '尾帧图片的工作区路径；与 start_image 组合为首尾帧控制（效果一般，尽量不用）' })),
      enhance: Type.Optional(Type.Boolean({ description: '是否启用 H3-Context-IR 提示词增强（默认 true；渠道未充值时自动降级）' })),
      output_dir: Type.Optional(Type.String({ description: '输出目录（工作区相对路径，默认 agent/videos/；如 apps/<appId>/assets/ 直接生成进 App 素材区）' })),
    }),
    execute: async (_toolCallId, params: {
      prompt?: string
      duration?: number
      resolution?: '768P' | '2K'
      ratio?: string
      reference_images?: string[]
      start_image?: string
      end_image?: string
      enhance?: boolean
      output_dir?: string
    }, _signal, onUpdate) => {
      const startedAt = Date.now()
      const prompt = String(params.prompt ?? '').trim()
      const resolution = params.resolution === '2K' ? '2K' : '768P'
      const duration = Number(params.duration) >= 4 && Number(params.duration) <= 15 ? Math.round(Number(params.duration)) : 4
      const enhance = params.enhance !== false
      const state = await loadState(principal)
      const fail = (code: string, message: string): { content: Array<{ type: 'text'; text: string }>; details: Record<string, never>; isError: true } => ({
        content: [{ type: 'text' as const, text: JSON.stringify({ success: false, error: code, message }) }],
        details: {}, isError: true,
      })
      // output_dir 校验（可选；工作区内任意路径，越界/非法返回明确错误）
      let outputDir: string | undefined
      if (params.output_dir && typeof params.output_dir === 'string' && params.output_dir.trim()) {
        try {
          resolveWorkspacePath(principal.key, params.output_dir.trim())
          outputDir = params.output_dir.trim().replace(/^\/+/, '')
        } catch (error) {
          return fail('BAD_OUTPUT_DIR', `输出目录无效：${error instanceof Error ? error.message : String(error)}`)
        }
      }
      // 1. 游客禁止
      if (principal.guest) {
        await recordVideoUsage({
          userKey: principal.key, userEmail: null, kind: 'guest', resolution, duration, imageCount: 0,
          enhance, prompt, costUserMinor: 0, costMetasoMinor: 0,
          status: 'rejected', errorCode: 'GUEST_NOT_ALLOWED', durationMs: Date.now() - startedAt,
        })
        return fail('GUEST_NOT_ALLOWED', '视频生成仅限登录用户使用（游客不可用），请先登录')
      }
      if (!prompt) return fail('EMPTY_PROMPT', '请提供 prompt（视频内容描述）')
      if (!videoGenConfigured()) {
        return fail('VIDEO_GEN_NOT_CONFIGURED', '视频生成渠道未配置（服务器缺少 METASO_API_KEY），请联系站长')
      }
      // 2. 未充值用户仅体验 2 次（2026-08-06：无月卡且无永久池 = 未付费；视频成本高，防白嫖）
      const paidUser = !!state.credits.monthly || (state.credits.permanent?.quota ?? 0) > 0
      if (!paidUser) {
        try {
          const pool = getPool()
          const used = await pool.query(
            'SELECT COUNT(*) AS n FROM webos_video_usage WHERE user_key = $1 AND status = \'ok\' AND task_type = \'generation\'',
            [principal.key],
          )
          if (Number(used.rows[0]?.n ?? 0) >= 2) {
            await recordVideoUsage({
              userKey: principal.key, userEmail: principal.email ?? null, kind: principalKind(principal, state),
              resolution, duration, imageCount: 0, enhance, prompt,
              costUserMinor: 0, costMetasoMinor: 0,
              status: 'rejected', errorCode: 'FREE_VIDEO_LIMIT', durationMs: Date.now() - startedAt,
            })
            return fail('FREE_VIDEO_LIMIT', '未充值用户视频生成次数已达上限（2 次）。订阅月卡或购买尝鲜用量包后不限次数——个人主页「订阅支持」可购买（爱发电，付款后填注册邮箱自动到账）')
          }
        } catch { /* 查询失败不阻断（放行一次） */ }
      }
      // 3. 输入图片（参考图 / 首尾帧 → 公开 URL；参考图与首尾帧互斥，优先参考图）
      let referenceImages: string[] | undefined
      let firstFrameUrl: string | undefined
      let lastFrameUrl: string | undefined
      const refPaths = (Array.isArray(params.reference_images) ? params.reference_images : [])
        .map((p) => String(p).trim()).filter(Boolean).slice(0, 9)
      const imageCount = refPaths.length + (params.start_image ? 1 : 0) + (params.end_image ? 1 : 0)
      if (refPaths.length > 0) {
        referenceImages = []
        for (const p of refPaths) {
          const url = publicFrameUrl(principal, p)
          if (!url) return fail('BAD_REFERENCE_IMAGE', `参考图读取失败：${p}（需为工作区内的 png/jpg/webp 图片）`)
          referenceImages.push(url)
        }
      } else {
        if (params.start_image) {
          firstFrameUrl = publicFrameUrl(principal, params.start_image) ?? undefined
          if (!firstFrameUrl) return fail('BAD_START_IMAGE', '首帧图片读取失败（需为工作区内的 png/jpg/webp 图片）')
        }
        if (params.end_image) {
          lastFrameUrl = publicFrameUrl(principal, params.end_image) ?? undefined
          if (!lastFrameUrl) return fail('BAD_END_IMAGE', '尾帧图片读取失败（需为工作区内的 png/jpg/webp 图片）')
        }
      }
      // 4. 积分检查（官方刊例价 5 折：768P 25 积分/秒、2K 40 积分/秒；4s 768P=100 积分）
      const costUserMinor = videoCostMinor({ resolution, seconds: duration, imageCount })
      if (remainingCredits(state) < costUserMinor) {
        await recordVideoUsage({
          userKey: principal.key, userEmail: principal.email ?? null, kind: principalKind(principal, state),
          resolution, duration, imageCount, enhance, prompt,
          costUserMinor: 0, costMetasoMinor: 0,
          status: 'insufficient', errorCode: 'TOKEN_INSUFFICIENT', durationMs: Date.now() - startedAt,
        })
        return fail('TOKEN_INSUFFICIENT', `积分不足（本次需 ${costUserMinor} 积分，剩余 ${remainingCredits(state)}）。请在个人主页查看获取额度的方式`)
      }
      // 5. 执行生成（进度回调：转发 tool_update + 刷新 pi 活动计时，防止长任务被空闲超时误杀）
      const result = await generateVideoAndSave({
        prompt,
        resolution,
        duration,
        // 合法比例白名单（21:9/16:9/4:3/1:1/3:4/9:16/adaptive），非法值交给模块默认 16:9
        ratio: /^(21:9|16:9|4:3|1:1|3:4|9:16|adaptive)$/.test(String(params.ratio ?? '')) ? String(params.ratio) : undefined,
        firstFrameUrl,
        lastFrameUrl,
        referenceImages,
        enhance,
        outputDir,
        workspaceRoot: getWorkspaceRoot(principal.key),
        onProgress: (text) => {
          markPiActivity()
          onUpdate?.({ content: [{ type: 'text', text }], details: {} })
        },
      })
      // 6. H3-Context-IR 单独落库（成功时；官方价 5.8/23 元每百万 token 折算成本，用户不单独扣费）
      if (result.contextIRUsage) {
        const irCostMinor = Math.round(
          (result.contextIRUsage.promptTokens / 1_000_000) * CONTEXT_IR_PRICE.inputPerMillion * 100
          + (result.contextIRUsage.completionTokens / 1_000_000) * CONTEXT_IR_PRICE.outputPerMillion * 100,
        )
        await recordVideoUsage({
          userKey: principal.key, userEmail: principal.email ?? null, kind: principalKind(principal, state),
          resolution, duration, imageCount, enhance, prompt,
          taskType: 'h3_context_ir',
          costUserMinor: 0,
          costMetasoMinor: irCostMinor,
          status: 'ok',
          durationMs: result.durationMs,
        })
        console.log(`[videogen] contextIR recorded: user=${principal.key.slice(0, 12)} tokens=${result.contextIRUsage.promptTokens}/${result.contextIRUsage.completionTokens} cost=${irCostMinor}分`)
      }
      // 7. 扣费 + 落库（失败不扣用户积分；渠道余额不足不扣）
      let actualCharged = 0
      if (result.ok) {
        actualCharged = chargeCredits(state, costUserMinor)
        await saveState(principal, state)
      }
      await recordVideoUsage({
        userKey: principal.key, userEmail: principal.email ?? null, kind: principalKind(principal, state),
        resolution, duration, imageCount, enhance, prompt,
        taskId: result.taskId, videoPath: result.path,
        costUserMinor: result.ok ? costUserMinor : 0,
        costMetasoMinor: result.ok ? result.costMetasoMinor : 0,
        status: result.ok ? 'ok' : (result.status === 'insufficient' ? 'insufficient' : result.status),
        errorCode: result.errorCode,
        errorMessage: result.errorMessage,
        durationMs: result.durationMs,
      })
      if (!result.ok) {
        return fail(result.errorCode ?? 'VIDEO_FAILED', result.errorMessage ?? '视频生成失败，请稍后重试')
      }
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            files: [{ path: result.path, url: result.url }],
            poster: result.posterUrl,
            enhanced: result.enhancedPrompt !== null,
            contextIR: result.contextIRUsage ?? undefined,
            charged: actualCharged,
            costMinor: costUserMinor,
            pricing: { model: 'MiniMax-H3', resolution, userPricePerSecond: resolution === '2K' ? 0.4 : 0.25, currency: 'CNY' },
          }),
        }],
        details: {},
      }
    },
  }
}

// ============================================================================
// 2026-08-06 媒体处理工具（edit_video，FFmpeg + ImageMagick）
// 参考 frameronin.com 类网站能力：抽帧/序列帧、精灵图（帧动画）、GIF、去背景、
// 裁剪/缩放/倍速/音频提取/静音/拼接、首帧封面；另支持图片滤镜/旋转/翻转/格式转换/
// 水印/拼图/音量。产物落工作区 agent/media/。
// - 权限：游客禁止（与视频生成一致）
// - 计费：免费（CPU 成本低，鼓励用于 App 制作）；每次落库 webos_video_usage
//   task_type='video_edit' 供后台统计
// ============================================================================

function editVideoTool(principal: Principal): ToolDefinition {
  return {
    name: 'edit_video',
    label: '处理媒体',
    description: [
      '处理工作区里的视频/图片/音频（FFmpeg + ImageMagick，系统内置）。inputs 传工作区路径（如 agent/videos/xxx.mp4、agent/images/a.png、agent/audio/a.mp3），产物写到 agent/media/ 并返回公开 URL **与真实像素尺寸 width/height**（写游戏碰撞判定/布局时务必用返回的真实尺寸，不要猜）。处理壁纸/图片素材/加字/拼图/格式转换都可以用它。',
      '**to-sprite（推荐，一键完成「视频→透明精灵图」）**：抽帧 → 自动检测背景色（绿幕/蓝幕/白底/黑底）→ 抠图（容差+羽化+抑色 despill 去边缘背景色溢）→ 逐帧裁剪到角色包围盒 → 统一画布 → 拼成一行 Sprite Sheet。做游戏角色动画/跑酷 App 直接用这一个操作即可，参数 frames（帧数 4-16，默认 8）、size（角色高度像素，默认 128）、duration（采样时长）。',
      '**新增图片/媒体操作**：filter（图片/视频帧滤镜：contrast/brightness/saturation/gamma/blur/alpha/darken/hue/negate，结构化参数，不做任意 filter 注入）；rotate（旋转 degrees，90/180/270 无损 transpose，其他角度黑底）；flip（翻转 direction=horizontal/vertical）；convert（格式转换 to=png/jpg/webp/gif/mp4/webm，quality 仅 jpg/webp）；watermark（水印：watermarkPath 图片水印或 text 文字水印，position=tl/tr/bl/br/center，margin/scale/fontsize/color，支持 #RRGGBBAA 半透明）；tile（网格拼图：2-12 张图片，columns/gap/background）；volume（音频音量 level=0-3）。',
      '其他既有操作：extract-frames（抽帧为图片序列）、sprite-sheet（拼精灵图，不抠图）、to-gif（转 GIF）、poster（提取首帧封面）、trim（裁剪片段 start/duration）、crop（画面裁剪）、scale（缩放）、extract-audio（提取 mp3）、mute（静音）、speed（倍速 0.5-4x）、remove-bg（绿幕/纯色背景抠除 → 透明 webm，**仅限纯色背景**，复杂背景做不到）、concat（拼接多个视频，inputs 传数组）。',
      '示例：把壁纸调半透明 60% 并暗化 20% 用 filter（alpha=0.6、darken=0.2）；给图片右下角加文字水印用 watermark（text="Daily"、position="br"）；把 4 张图拼成 2x2 用 tile（columns=2）。',
      '做游戏 App 时：角色动画用 to-sprite 一键生成透明精灵图（或 extract-frames 抽帧后自行处理），配 canvas 或 CSS 帧动画播放；去背景请先确认素材是纯色背景（生成视频时要求 AI 用纯绿背景）。',
    ].join(' '),
    parameters: Type.Object({
      operation: Type.Union([
        Type.Literal('extract-frames'),
        Type.Literal('sprite-sheet'),
        Type.Literal('to-sprite'),
        Type.Literal('to-gif'),
        Type.Literal('poster'),
        Type.Literal('trim'),
        Type.Literal('crop'),
        Type.Literal('scale'),
        Type.Literal('extract-audio'),
        Type.Literal('mute'),
        Type.Literal('speed'),
        Type.Literal('remove-bg'),
        Type.Literal('concat'),
        Type.Literal('filter'),
        Type.Literal('rotate'),
        Type.Literal('flip'),
        Type.Literal('convert'),
        Type.Literal('watermark'),
        Type.Literal('tile'),
        Type.Literal('volume'),
      ], { description: '操作类型（见描述）' }),
      inputs: Type.Array(Type.String({ description: '输入视频/图片/音频的工作区路径（concat/tile 时传多个）' }), { description: '输入文件列表' }),
      frames: Type.Optional(Type.Number({ description: 'extract-frames 帧率（默认 8）/ sprite-sheet 总帧数（默认 8，2-24）' })),
      gifFps: Type.Optional(Type.Number({ description: 'to-gif fps（默认 10）；sprite-sheet 的采样帧率' })),
      gifWidth: Type.Optional(Type.Number({ description: 'to-gif 宽度（默认 480）' })),
      start: Type.Optional(Type.Number({ description: 'trim 开始秒数（默认 0）' })),
      duration: Type.Optional(Type.Number({ description: 'trim 时长（秒，默认 4）；sprite-sheet 采样时长' })),
      crop: Type.Optional(Type.String({ description: 'crop 区域："宽x高+x+y" 如 "400x400+100+100"' })),
      size: Type.Optional(Type.String({ description: 'scale / sprite-sheet 尺寸："512x512" / "-1:480" / "50%"' })),
      speed: Type.Optional(Type.Number({ description: 'speed 倍速 0.5-4（默认 1）' })),
      bgColor: Type.Optional(Type.String({ description: 'remove-bg 背景色：green/blue/white/black（默认 green）' })),
      similarity: Type.Optional(Type.Number({ description: 'remove-bg 颜色相似度 0.01-0.9（默认 0.1，越大抠得越狠）' })),
      contrast: Type.Optional(Type.Number({ description: 'filter 对比度 0.1-3（默认 1）' })),
      brightness: Type.Optional(Type.Number({ description: 'filter 亮度 -1~1（默认 0）' })),
      saturation: Type.Optional(Type.Number({ description: 'filter 饱和度 0-3（默认 1）' })),
      gamma: Type.Optional(Type.Number({ description: 'filter 伽马 0.1-3（默认 1）' })),
      blur: Type.Optional(Type.Number({ description: 'filter 高斯模糊 sigma 0-50（默认 0）' })),
      alpha: Type.Optional(Type.Number({ description: 'filter 不透明度 0.05-1（默认 1，输出 PNG 带 alpha）' })),
      darken: Type.Optional(Type.Number({ description: 'filter 暗化 0-0.8（默认 0，colorlevels 压暗）' })),
      hue: Type.Optional(Type.Number({ description: 'filter 色相 -180~180（默认 0）' })),
      negate: Type.Optional(Type.Boolean({ description: 'filter 是否反色（默认 false）' })),
      degrees: Type.Optional(Type.Number({ description: 'rotate 旋转角度 -360~360（默认 0）' })),
      direction: Type.Optional(Type.String({ description: 'flip 方向 horizontal/vertical（默认 horizontal）' })),
      to: Type.Optional(Type.String({ description: 'convert 目标格式 png/jpg/webp/gif/mp4/webm' })),
      quality: Type.Optional(Type.Number({ description: 'convert 质量 1-100（默认 85，仅 jpg/webp）' })),
      watermarkPath: Type.Optional(Type.String({ description: 'watermark 图片水印的工作区路径（需已存在图片）' })),
      text: Type.Optional(Type.String({ description: 'watermark 文字水印内容' })),
      position: Type.Optional(Type.String({ description: 'watermark/tile 位置或布局 tl/tr/bl/br/center（默认 br）' })),
      margin: Type.Optional(Type.Number({ description: 'watermark 边距 0-200（默认 12）' })),
      scale: Type.Optional(Type.Number({ description: 'watermark 图片水印缩放 0.1-2（默认 1）' })),
      fontsize: Type.Optional(Type.Number({ description: 'watermark 文字字号 8-200（默认 28）' })),
      color: Type.Optional(Type.String({ description: 'watermark 文字颜色 CSS 颜色，支持 #RRGGBBAA 半透明（默认 white）' })),
      columns: Type.Optional(Type.Number({ description: 'tile 列数 1-6（默认按数量平方根取整）' })),
      gap: Type.Optional(Type.Number({ description: 'tile 间距 0-50（默认 0）' })),
      background: Type.Optional(Type.String({ description: 'tile 背景 white/black/transparent（默认 white）' })),
      level: Type.Optional(Type.Number({ description: 'volume 音量 0-3（默认 1）' })),
    }),
    execute: async (_toolCallId, params: {
      operation: string
      inputs: string[]
      frames?: number
      gifFps?: number
      gifWidth?: number
      start?: number
      duration?: number
      crop?: string
      size?: string
      speed?: number
      bgColor?: string
      similarity?: number
      contrast?: number
      brightness?: number
      saturation?: number
      gamma?: number
      blur?: number
      alpha?: number
      darken?: number
      hue?: number
      negate?: boolean
      degrees?: number
      direction?: string
      to?: string
      quality?: number
      watermarkPath?: string
      text?: string
      position?: string
      margin?: number
      scale?: number
      fontsize?: number
      color?: string
      columns?: number
      gap?: number
      background?: string
      level?: number
    }, _signal, onUpdate) => {
      const startedAt = Date.now()
      const state = await loadState(principal)
      const fail = (code: string, message: string): { content: Array<{ type: 'text'; text: string }>; details: Record<string, never>; isError: true } => ({
        content: [{ type: 'text' as const, text: JSON.stringify({ success: false, error: code, message }) }],
        details: {}, isError: true,
      })
      if (principal.guest) {
        return fail('GUEST_NOT_ALLOWED', '视频处理仅限登录用户使用（游客不可用），请先登录')
      }
      if (!Array.isArray(params.inputs) || params.inputs.length === 0) return fail('NO_INPUT', '请提供 inputs（工作区文件路径）')
      if (!(await ffmpegAvailable())) return fail('FFMPEG_UNAVAILABLE', '服务器未安装 ffmpeg，无法处理视频')
      // 解析输入为工作区绝对路径（每个都要存在且是视频/图片）
      const inputs: string[] = []
      for (const raw of params.inputs) {
        try {
          const full = resolveWorkspacePath(principal.key, String(raw).trim())
          const stat = fs.statSync(full)
          if (!stat.isFile()) throw new Error('不是文件')
          if (!isVideoFile(full)) throw new Error('不是支持的视频/图片/音频格式')
          if (stat.size > 100 * 1024 * 1024) throw new Error('文件超过 100MB 限制')
          inputs.push(full)
        } catch (error) {
          return fail('BAD_INPUT', `输入文件无效：${raw}（${error instanceof Error ? error.message : String(error)}）`)
        }
      }
      // watermark 图片水印必须解析为工作区内绝对路径并校验存在
      let watermarkFull: string | undefined
      if (params.operation === 'watermark' && params.watermarkPath) {
        try {
          watermarkFull = resolveWorkspacePath(principal.key, String(params.watermarkPath).trim())
          const wmStat = fs.statSync(watermarkFull)
          if (!wmStat.isFile()) throw new Error('不是文件')
          if (!/\.(png|jpe?g|webp)$/i.test(watermarkFull)) throw new Error('水印图仅支持 PNG/JPEG/WebP')
          if (wmStat.size > 100 * 1024 * 1024) throw new Error('水印图超过 100MB 限制')
        } catch (error) {
          return fail('BAD_WATERMARK', `水印图无效：${params.watermarkPath}（${error instanceof Error ? error.message : String(error)}）`)
        }
      }
      // 输出目录：agent/media/
      const mediaDir = path.join(getWorkspaceRoot(principal.key), 'agent', 'media')
      onUpdate?.({ content: [{ type: 'text', text: `正在处理媒体（${params.operation}）…` }], details: {} })
      markPiActivity()
      const result = await processVideo({
        operation: params.operation as never,
        input: inputs.length === 1 ? inputs[0]! : inputs,
        outputDir: mediaDir,
        frames: params.frames,
        gifFps: params.gifFps,
        gifWidth: params.gifWidth,
        start: params.start,
        duration: params.duration,
        crop: params.crop,
        size: params.size,
        speed: params.speed,
        bgColor: params.bgColor,
        similarity: params.similarity,
        contrast: params.contrast,
        brightness: params.brightness,
        saturation: params.saturation,
        gamma: params.gamma,
        blur: params.blur,
        alpha: params.alpha,
        darken: params.darken,
        hue: params.hue,
        negate: params.negate,
        degrees: params.degrees,
        direction: params.direction,
        to: params.to,
        quality: params.quality,
        watermarkPath: watermarkFull,
        text: params.text,
        position: params.position,
        margin: params.margin,
        scale: params.scale,
        fontsize: params.fontsize,
        color: params.color,
        columns: params.columns,
        gap: params.gap,
        background: params.background,
        level: params.level,
      })
      // 落库（免费，但记录每次调用供后台统计）
      await recordVideoUsage({
        userKey: principal.key, userEmail: principal.email ?? null, kind: principalKind(principal, state),
        resolution: '768P', duration: Number(params.duration) || 4, imageCount: inputs.length, enhance: false,
        taskType: 'video_edit',
        prompt: `edit_video:${params.operation} ${inputs.map((i) => path.basename(i)).join(',')}`.slice(0, 300),
        videoPath: result.files[0]?.path ? `agent/media/${result.files[0].path}` : null,
        costUserMinor: 0, costMetasoMinor: 0,
        status: result.ok ? 'ok' : 'failed',
        errorCode: result.errorCode,
        durationMs: result.durationMs,
      })
      if (!result.ok) {
        return fail(result.errorCode ?? 'EDIT_FAILED', result.errorMessage ?? '视频处理失败')
      }
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({ success: true, operation: params.operation, files: result.files, durationMs: result.durationMs }),
        }],
        details: {},
      }
    },
  }
}

/** 图片编辑工具：去白底/格式转换/缩放/裁剪/旋转/水印，支持批量 */
function editImageTool(principal: Principal): ToolDefinition {
  return {
    name: 'edit_image',
    label: '编辑图片',
    description: '批量处理工作区图片：remove-background（去白底，纯 JS 零依赖）、convert（格式）、resize（缩放）、crop（裁剪）、rotate（旋转）、watermark（水印）。inputs 传工作区相对路径数组（如 ["agent/images/a.png"]），输出默认写到 agent/images/。返回每张产物的路径 **与真实像素尺寸 width/height**（写游戏碰撞判定/布局时用返回的真实尺寸，不要猜）。',
    parameters: Type.Object({
      operation: Type.Union([
        Type.Literal('remove-background'),
        Type.Literal('convert'),
        Type.Literal('resize'),
        Type.Literal('crop'),
        Type.Literal('rotate'),
        Type.Literal('watermark'),
      ], { description: '操作类型' }),
      inputs: Type.Array(Type.String({ description: '输入图片的工作区路径（可批量）' }), { description: '输入文件列表' }),
      output: Type.Optional(Type.String({ description: '输出目录（工作区相对路径，默认 agent/images/）' })),
      format: Type.Optional(Type.String({ description: 'convert 目标格式：png/jpg/webp' })),
      quality: Type.Optional(Type.Number({ description: 'jpg/webp 质量 1-100（默认 90）' })),
      size: Type.Optional(Type.String({ description: 'resize 尺寸："50%" 或 "512x512" / "512x" / "x512"' })),
      crop: Type.Optional(Type.String({ description: 'crop 区域："宽x高+x+y" 如 "400x400+100+100"' })),
      rotate: Type.Optional(Type.Number({ description: 'rotate 角度：90/180/270' })),
      text: Type.Optional(Type.String({ description: 'watermark 水印文字' })),
      gravity: Type.Optional(Type.String({ description: 'watermark 位置：nw/n/ne/w/center/e/sw/s/se（默认 southeast）' })),
      threshold: Type.Optional(Type.Number({ description: 'remove-background 阈值 0-200（默认 40）' })),
    }),
    execute: async (_toolCallId, params: {
      operation: 'remove-background' | 'convert' | 'resize' | 'crop' | 'rotate' | 'watermark'
      inputs: string[]
      output?: string
      format?: string
      quality?: number
      size?: string
      crop?: string
      rotate?: number
      text?: string
      gravity?: string
      threshold?: number
    }, _signal, onUpdate) => {
      const results: Array<{ input: string; ok: boolean; output?: string; error?: string; width?: number; height?: number }> = []
      const root = getWorkspaceRoot(principal.key)
      let outputDir = params.output ?? 'agent/images'
      try {
        outputDir = path.relative(root, resolveWorkspacePath(principal.key, outputDir))
        if (outputDir === '' || outputDir.startsWith('..')) throw new Error('输出目录越界')
      } catch (error) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ success: false, error: 'BAD_OUTPUT', message: error instanceof Error ? error.message : '输出目录非法' }) }],
          details: {}, isError: true,
        }
      }
      const outFull = path.join(root, outputDir)
      fs.mkdirSync(outFull, { recursive: true })
      let processedCount = 0
      for (const inputPath of params.inputs) {
        processedCount += 1
        // 2026-08-07 工具过程增量：批量处理逐张报告进度（pi 转发为 tool_execution_update → SSE tool_update）
        try {
          onUpdate?.({ content: [{ type: 'text', text: `正在处理 ${processedCount}/${params.inputs.length}：${inputPath}` }], details: {} })
        } catch { /* 进度输出失败不阻断 */ }
        try {
          const full = resolveWorkspacePath(principal.key, inputPath)
          const stat = fs.statSync(full)
          if (!stat.isFile()) throw new Error('不是文件')
          if (stat.size > 8 * 1024 * 1024) throw new Error('文件超过 8MB 限制')
          const input = fs.readFileSync(full)
          const edited = await editImageBuffer(input, {
            operation: params.operation,
            format: params.format,
            quality: params.quality,
            size: params.size,
            crop: params.crop,
            rotate: params.rotate,
            text: params.text,
            gravity: params.gravity,
            threshold: params.threshold,
          })
          if (!edited.ok || !edited.buffer) throw new Error(edited.errorMessage ?? '处理失败')
          const base = path.basename(inputPath).replace(/\.(png|jpg|jpeg|webp)$/i, '')
          const ext = params.format === 'jpg' ? 'jpg' : params.format === 'webp' ? 'webp' : 'png'
          const outName = `${base}_${params.operation}_${Date.now()}.${ext}`
          fs.writeFileSync(path.join(outFull, outName), edited.buffer)
          // 2026-08-14 产物尺寸探测：返回真实像素尺寸，AI 写游戏碰撞/布局用真实值
          const dim = imageSizeOf(edited.buffer) ?? null
          results.push({
            input: inputPath,
            ok: true,
            output: `${outputDir}/${outName}`.replace(/^\.\//, ''),
            ...(dim ? { width: dim.width, height: dim.height } : {}),
          })
        } catch (error) {
          results.push({
            input: inputPath,
            ok: false,
            error: error instanceof Error ? error.message.slice(0, 200) : String(error),
          })
        }
      }
      const okCount = results.filter((r) => r.ok).length
      const failed = results.filter((r) => !r.ok)
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: okCount > 0,
            total: results.length,
            ok: okCount,
            failed,
            results: results.filter((r) => r.ok).map((r) => ({ input: r.input, output: r.output })),
          }),
        }],
        details: {},
        ...(failed.length > 0 && okCount === 0 ? { isError: true } : {}),
      }
    },
  }
}

// ============================================================================
// 2026-08-13 工作流工具：多步骤工具调用串联 + 结果传递 + AI 自行保存/复用
// ----------------------------------------------------------------------------
// 工作流 = 有序步骤列表 [{ tool, params }]，保存到工作区 system/workflows.json。
// 步骤按顺序执行，后一步参数可用 $N 引用前一步输出：
//   $0.files[0].path      → 第 0 步输出 files 数组第 1 个元素的 path
//   $0.files[].path       → 展开为数组（第 0 步所有文件的 path）
//   $last.files[].path    → 上一步的输出
// 支持工具（白名单）：generate_image / edit_image / generate_video / edit_video
// （各工具内部自行计费/限权/校验；工作流本身不额外收费，步骤失败即中止并报告）。
// 典型场景：一次性生成 10 张游戏 UI → 部分去背景 → 部分图生视频 → 视频转精灵图。
// ============================================================================

interface WorkflowStepDef {
  tool: string
  params: Record<string, unknown>
}
interface WorkflowDef {
  id: string
  name: string
  description?: string
  steps: WorkflowStepDef[]
  createdAt: number
  updatedAt: number
}

const WORKFLOW_ALLOWED_TOOLS = ['generate_image', 'edit_image', 'generate_video', 'edit_video'] as const

function workflowsFilePath(principal: Principal): string {
  return path.join(getWorkspaceRoot(principal.key), 'system', 'workflows.json')
}

function loadWorkflows(principal: Principal): WorkflowDef[] {
  try {
    const parsed = JSON.parse(fs.readFileSync(workflowsFilePath(principal), 'utf-8')) as { workflows?: WorkflowDef[] }
    return Array.isArray(parsed.workflows) ? parsed.workflows : []
  } catch {
    return []
  }
}

function saveWorkflows(principal: Principal, workflows: WorkflowDef[]): void {
  const file = workflowsFilePath(principal)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify({ workflows }, null, 2), 'utf-8')
}

/** 解析单个 $N 引用（.field / [index] / []展开），非引用原样返回 */
function resolveWorkflowRef(value: unknown, outputs: Array<Record<string, unknown>>, stepIndex: number): unknown {
  if (typeof value !== 'string') return value
  const m = /^\$(\d+|last)((?:\.[A-Za-z_$][\w$]*|\[\d+\]|\[\])*)$/.exec(value.trim())
  if (!m) return value
  const target = m[1] === 'last' ? outputs[outputs.length - 1] : outputs[Number(m[1])]
  if (target === undefined) {
    throw new Error(`$${m[1]} 引用无效：第 ${m[1]} 步不存在（当前执行到第 ${stepIndex} 步，已有 ${outputs.length} 个输出）`)
  }
  const tokens: Array<{ field?: string; index?: number; spread?: boolean }> = []
  for (const t of m[2].matchAll(/\.([A-Za-z_$][\w$]*)|\[(\d+)\]|(\[\])/g)) {
    if (t[1] !== undefined) tokens.push({ field: t[1] })
    else if (t[2] !== undefined) tokens.push({ index: Number(t[2]) })
    else tokens.push({ spread: true })
  }
  const walk = (cur: unknown, i: number): unknown => {
    if (i >= tokens.length) return cur
    const tok = tokens[i]!
    if (tok.spread) {
      if (!Array.isArray(cur)) throw new Error('[] 展开失败：当前值不是数组')
      return cur.map((item) => walk(item, i + 1))
    }
    if (tok.field !== undefined) return walk((cur as Record<string, unknown> | null)?.[tok.field], i + 1)
    return walk(Array.isArray(cur) ? cur[tok.index!] : undefined, i + 1)
  }
  return walk(target, 0)
}

/** 递归解析参数中的 $N 引用（对象/数组/字符串均支持；数组元素展开为数组时自动拍平） */
function resolveWorkflowParams(params: Record<string, unknown>, outputs: Array<Record<string, unknown>>, stepIndex: number): Record<string, unknown> {
  const walk = (val: unknown): unknown => {
    if (typeof val === 'string') return resolveWorkflowRef(val, outputs, stepIndex)
    if (Array.isArray(val)) {
      const out: unknown[] = []
      for (const item of val) {
        const resolved = walk(item)
        if (Array.isArray(resolved)) out.push(...resolved)
        else out.push(resolved)
      }
      return out
    }
    if (val && typeof val === 'object') {
      const out: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(val as Record<string, unknown>)) out[k] = walk(v)
      return out
    }
    return val
  }
  return walk(params) as Record<string, unknown>
}

/** 工作流工具（4 个）：create_workflow / run_workflow / list_workflows / delete_workflow */
function workflowTools(principal: Principal): ToolDefinition[] {
  const log = (tool: string, params: Record<string, unknown>, ok: boolean, note?: string): void => {
    logAgentAction(principal.key, tool, params, ok, note)
  }
  const fail = (code: string, message: string): { content: Array<{ type: 'text'; text: string }>; details: Record<string, never>; isError: true } => ({
    content: [{ type: 'text' as const, text: JSON.stringify({ success: false, error: code, message }) }],
    details: {}, isError: true,
  })

  /** 顺序执行工作流（$N 引用解析 → 白名单工具 execute；步骤失败即中止） */
  const runWorkflow = async (
    workflow: WorkflowDef,
    onUpdate?: (text: string) => void,
  ): Promise<{ ok: true; outputs: Array<Record<string, unknown>> } | { ok: false; failedStep: number; error: string }> => {
    const outputs: Array<Record<string, unknown>> = []
    const toolMap: Record<string, ToolDefinition> = {
      generate_image: generateImageTool(principal),
      edit_image: editImageTool(principal),
      generate_video: generateVideoTool(principal),
      edit_video: editVideoTool(principal),
    }
    for (let i = 0; i < workflow.steps.length; i += 1) {
      const step = workflow.steps[i]!
      if (!(WORKFLOW_ALLOWED_TOOLS as readonly string[]).includes(step.tool)) {
        return { ok: false, failedStep: i + 1, error: `第 ${i + 1} 步使用了白名单外工具 ${step.tool}（支持：${WORKFLOW_ALLOWED_TOOLS.join(' / ')}）` }
      }
      try {
        const params = resolveWorkflowParams(step.params ?? {}, outputs, i)
        onUpdate?.(`第 ${i + 1}/${workflow.steps.length} 步：${step.tool} ${JSON.stringify(params).slice(0, 140)}`)
        markPiActivity()
        const tool = toolMap[step.tool]!
        // 内部执行器只用前 4 个参数（现有工具定义均为 4 参实现），第 5 个 ctx 不需要
        const exec = tool.execute as (
          toolCallId: string,
          params: unknown,
          signal: AbortSignal | undefined,
          onUpdate: ((update: { content?: Array<{ type?: string; text?: string }>; details?: unknown }) => void) | undefined,
        ) => Promise<{ content?: Array<{ type?: string; text?: string }>; details?: unknown; isError?: boolean }>
        const result = await exec(`workflow-${workflow.name}-step-${i}`, params, undefined, (update) => {
          const text = update?.content?.find((p) => p?.type === 'text')?.text
          if (text) onUpdate?.(text)
        })
        const text = result?.content?.find((p) => p?.type === 'text')?.text ?? ''
        let parsed: Record<string, unknown>
        try {
          parsed = JSON.parse(text) as Record<string, unknown>
        } catch {
          parsed = { raw: text.slice(0, 500) }
        }
        if (result?.isError === true || parsed.success === false) {
          return {
            ok: false,
            failedStep: i + 1,
            error: `第 ${i + 1} 步（${step.tool}）失败：${String(parsed.message ?? parsed.error ?? text.slice(0, 200))}`,
          }
        }
        outputs.push(parsed)
      } catch (error) {
        return {
          ok: false,
          failedStep: i + 1,
          error: `第 ${i + 1} 步（${step.tool}）异常：${error instanceof Error ? error.message : String(error)}`,
        }
      }
    }
    return { ok: true, outputs }
  }

  return [
    {
      name: 'create_workflow',
      label: '创建工作流',
      description: '创建/更新一个可复用的多步骤工作流（保存到工作区 system/workflows.json，同名覆盖更新）。步骤 = 工具调用列表，按顺序执行；后一步参数可用 $N 引用第 N 步（从 0 开始）的输出：$0.files[0].path（第 0 步的第 1 个文件路径）、$0.files[].path（展开为数组，如 10 张图批量传给下一步）、$last（上一步完整输出）。支持工具：generate_image / edit_image / generate_video / edit_video。典型场景：一次性生成 10 张游戏 UI 图 → 部分去背景 → 部分图生视频 → 视频转精灵图。',
      parameters: Type.Object({
        name: Type.String({ description: '工作流名称（1-50 字符，唯一；同名覆盖更新）' }),
        description: Type.Optional(Type.String({ description: '用途说明（方便以后想起来这是干什么的）' })),
        steps: Type.Array(Type.Object({
          tool: Type.String({ description: '工具名：generate_image / edit_image / generate_video / edit_video' }),
          params: Type.Record(Type.String(), Type.Unknown(), { description: '该工具的参数对象；值可为 $N 引用（如 "$0.files[].path"）' }),
        }), { description: '步骤列表（1-20 步，顺序执行）' }),
      }),
      execute: async (_toolCallId, params: { name: string; description?: string; steps: Array<{ tool: string; params: Record<string, unknown> }> }) => {
        const name = String(params.name ?? '').trim()
        if (!name || name.length > 50) return fail('WF_BAD_NAME', '工作流名称必填且不超过 50 字符')
        const steps = Array.isArray(params.steps) ? params.steps.slice(0, 20) : []
        if (steps.length === 0) return fail('WF_BAD_STEPS', '至少需要 1 个步骤')
        for (const s of steps) {
          if (!(WORKFLOW_ALLOWED_TOOLS as readonly string[]).includes(String(s.tool ?? ''))) {
            return fail('WF_BAD_TOOL', `不支持工具 ${String(s.tool)}（支持：${WORKFLOW_ALLOWED_TOOLS.join(' / ')}）`)
          }
        }
        const workflows = loadWorkflows(principal)
        const now = Date.now()
        const existing = workflows.find((w) => w.name === name)
        const wf: WorkflowDef = {
          id: existing?.id ?? `wf-${randomUUID().slice(0, 8)}`,
          name,
          description: params.description ? String(params.description) : undefined,
          steps,
          createdAt: existing?.createdAt ?? now,
          updatedAt: now,
        }
        if (existing) Object.assign(existing, wf)
        else workflows.push(wf)
        saveWorkflows(principal, workflows)
        log('create_workflow', { name, steps: steps.length }, true)
        return {
          content: [{ type: 'text', text: JSON.stringify({ success: true, id: wf.id, name, steps: steps.length, note: '已保存，可用 run_workflow 执行' }) }],
          details: {},
        }
      },
    },
    {
      name: 'run_workflow',
      label: '执行工作流',
      description: '执行已保存的工作流：按步骤顺序执行，$N 引用自动替换为前一步输出；某步失败即中止并报告失败步骤（可修复工作流后重跑）。耗时长（生图/生视频）会实时报告进度。',
      parameters: Type.Object({
        name: Type.String({ description: '工作流名称（用 list_workflows 查看有哪些）' }),
      }),
      execute: async (_toolCallId, params: { name: string }, _signal, onUpdate) => {
        const name = String(params.name ?? '').trim()
        const wf = loadWorkflows(principal).find((w) => w.name === name)
        if (!wf) return fail('WF_NOT_FOUND', `工作流不存在：${name}（可用 list_workflows 查看）`)
        onUpdate?.({ content: [{ type: 'text', text: `开始执行工作流「${name}」（${wf.steps.length} 步）…` }], details: {} })
        markPiActivity()
        const result = await runWorkflow(wf, (text) => onUpdate?.({ content: [{ type: 'text', text }], details: {} }))
        log('run_workflow', { name, steps: wf.steps.length, ok: result.ok }, result.ok, result.ok ? undefined : result.error)
        if (!result.ok) return fail('WF_STEP_FAILED', `${result.error}；后续步骤未执行（可修复工作流后重跑）`)
        return {
          content: [{ type: 'text', text: JSON.stringify({ success: true, name, steps: wf.steps.length, outputs: result.outputs }) }],
          details: {},
        }
      },
    },
    {
      name: 'list_workflows',
      label: '列出工作流',
      description: '列出已保存的工作流（名称/描述/步骤数/更新时间）。',
      parameters: Type.Object({}),
      execute: async () => {
        const workflows = loadWorkflows(principal).map((w) => ({
          name: w.name,
          description: w.description ?? null,
          steps: w.steps.length,
          updatedAt: w.updatedAt,
        }))
        return { content: [{ type: 'text', text: JSON.stringify({ success: true, workflows }) }], details: {} }
      },
    },
    {
      name: 'delete_workflow',
      label: '删除工作流',
      description: '删除已保存的工作流。',
      parameters: Type.Object({
        name: Type.String({ description: '工作流名称' }),
      }),
      execute: async (_toolCallId, params: { name: string }) => {
        const name = String(params.name ?? '').trim()
        const workflows = loadWorkflows(principal)
        const next = workflows.filter((w) => w.name !== name)
        if (next.length === workflows.length) return fail('WF_NOT_FOUND', `工作流不存在：${name}`)
        saveWorkflows(principal, next)
        log('delete_workflow', { name }, true)
        return { content: [{ type: 'text', text: JSON.stringify({ success: true, name, deleted: true }) }], details: {} }
      },
    },
  ]
}

/** 设置用户称呼（AI 在用户告知称呼时调用，持久化到 users.display_name） */
function setDisplayNameTool(principal: Principal): ToolDefinition {
  return {
    name: 'set_display_name',
    label: '设置用户称呼',
    description: '把用户告知的称呼/昵称保存为系统显示名（AI 对话页、问候语、个人主页都会显示）。当用户说"叫我xxx/我的名字是xxx/以后叫我xxx"时调用；参数为 1-20 字的称呼。游客身份无法持久化，此时记住称呼即可并提示用户登录后可保存。',
    parameters: Type.Object({
      displayName: Type.String({ description: '用户的称呼/昵称（1-20 字）' }),
    }),
    execute: async (_toolCallId, params: { displayName: string }) => {
      try {
        const displayName = String(params.displayName ?? '').trim().replace(/[\u0000-\u001f\u007f]/g, '')
        if (displayName.length < 1 || displayName.length > 20) {
          return { content: [{ type: 'text', text: JSON.stringify({ success: false, error: '称呼长度需在 1-20 字之间' }) }], details: {}, isError: true }
        }
        if (principal.guest) {
          return { content: [{ type: 'text', text: JSON.stringify({ success: false, error: '游客身份无法保存称呼，请先登录；当前对话中我会记住你的称呼' }) }], details: {}, isError: true }
        }
        const pool = getPool()
        await pool.query('UPDATE users SET display_name = $1 WHERE id = $2', [displayName, principal.id])
        console.log(`[webos] display_name set by AI: ${principal.key.slice(0, 12)} → ${displayName}`)
        return { content: [{ type: 'text', text: JSON.stringify({ success: true, displayName, message: `已把你的称呼保存为「${displayName}」，AI 对话页与问候语都会这样叫你` }) }], details: {} }
      } catch (error) {
        return { content: [{ type: 'text', text: JSON.stringify({ success: false, error: error instanceof Error ? error.message : '保存失败' }) }], details: {}, isError: true }
      }
    },
  }
}

/**
 * 对话内互动 HTML（2026-08-03）：AI 在对话中插入可交互小部件
 * （sandbox iframe 渲染，尺寸受限；不落盘、不建 App）。
 */
function showInteractiveHtmlTool(principal: Principal): ToolDefinition {
  return {
    name: 'show_interactive_html',
    label: '插入互动内容',
    description: [
      '当用户想要「在对话里直接看/玩/操作」某个东西（实时计算器、可点击的流程图、投票、小游戏、动画演示、交互式表单、可折叠清单、倒计时等）时，在对话中插入一个可交互的 HTML 组件。',
      '生成完整的、自包含的 HTML 片段（内联 CSS 和 JavaScript；禁止 iframe、object、embed、base、外部 URL、网络请求、data:text/html）。',
      '尺寸约束（必须严格遵守）：宽度 = 100%（手机屏幕全宽）；高度通过 heightPx 指定，最小 120px、最大 480px（约大半屏）；一般建议 220-320px（约 4 倍输入框高度）。',
      '适合：让用户直接在对话里体验/操作的内容。不适合：完整的 App（请用文件夹方式创建：agent_fs_mkdir apps/<名称>/ + agent_fs_write index.html，系统自动注册为桌面 App）。',
      '提交值约定（必须遵守）：互动 HTML 里的按钮/选项通过 window.parent.postMessage({channel:"daily-webos-sdk", kind:"event", payload:{type:"interactive_answer", value:"..."}}, "*") 回传选择结果。value 必须是一个简短、独立的选项标识（如 "方向一"、"极简风格"、"A"、"是"/"否"），**严禁把用户原始需求原文或整段对话内容作为 value 回传**——否则系统会把需求原文当成新消息再次发送（用户看到"消息被发送两次"）。',
    ].join(' '),
    parameters: Type.Object({
      html: Type.String({ description: '自包含的 HTML 片段（内联 CSS/JS，禁止外部引用与 iframe）' }),
      heightPx: Type.Optional(Type.Integer({ minimum: 120, maximum: 480, default: 280, description: '组件高度（px）：120-480，建议 220-320' })),
    }),
    execute: async (_toolCallId, params: { html: string; heightPx?: number }, _signal, _onUpdate) => {
      try {
        const html = validateAppHtml(params.html)
        validateGeneratedHtml(html)
        const heightPx = typeof params.heightPx === 'number'
          ? Math.min(480, Math.max(120, Math.round(params.heightPx)))
          : 280
        return {
          content: [{ type: 'text', text: JSON.stringify({ success: true, html, heightPx }) }],
          details: {},
        }
      } catch (error) {
        const message = error && typeof error === 'object' && 'message' in error
          ? String((error as { message: unknown }).message)
          : '互动内容校验失败'
        return { content: [{ type: 'text', text: JSON.stringify({ success: false, message }) }], details: {}, isError: true }
      }
    },
  }
}

/** 发布/下架商店条目（AI 工具：让 AI 帮用户把 App 上架/下架应用商店） */
function publishWebosAppTool(principal: Principal): ToolDefinition {
  return {
    name: 'publish_webos_app',
    label: '发布到应用商店',
    description: '把用户的一个 App 发布到系统应用商店：生成分享链接（别人打开链接可直接体验、安装），商店列表可见。重复发布同一 App 会更新商店里的版本快照。发布成功后把分享链接告诉用户。',
    parameters: Type.Object({
      appId: Type.String({ description: '要发布的 App id（来自 list_webos_apps）' }),
      description: Type.Optional(Type.String({ maxLength: 200, description: '商店介绍（一句话说明用途，可选）' })),
    }),
    execute: async (_toolCallId, params: { appId: string; description?: string }) => {
      try {
        const { shareId, url } = await publishStoreAppEntry(principal, params.appId, String(params.description ?? ''))
        return { content: [{ type: 'text', text: JSON.stringify({ success: true, shareId, url, message: `已发布到应用商店，分享链接：${url}` }) }], details: {} }
      } catch (error) {
        const message = error && typeof error === 'object' && 'message' in error ? String((error as { message: unknown }).message) : '发布失败'
        return { content: [{ type: 'text', text: JSON.stringify({ success: false, message }) }], details: {}, isError: true }
      }
    },
  }
}

function unpublishWebosAppTool(principal: Principal): ToolDefinition {
  return {
    name: 'unpublish_webos_app',
    label: '从商店下架',
    description: '把用户已发布到应用商店的 App 下架（分享链接随之失效）。参数为商店条目 id（可让用户提供或从商店「我的发布」查看）。',
    parameters: Type.Object({
      shareId: Type.String({ description: '商店条目 id（分享链接 ?exp= 后面的部分）' }),
    }),
    execute: async (_toolCallId, params: { shareId: string }) => {
      try {
        const shareId = String(params.shareId ?? '').replace(/[^a-zA-Z0-9-]/g, '').slice(0, 64)
        const pool = getPool()
        const result = await pool.query('SELECT owner_key FROM webos_store_apps WHERE id = $1', [shareId])
        if (!result.rows[0]) return { content: [{ type: 'text', text: JSON.stringify({ success: false, message: '商店条目不存在' }) }], details: {}, isError: true }
        if (String(result.rows[0].owner_key) !== principal.key) return { content: [{ type: 'text', text: JSON.stringify({ success: false, message: '只能下架自己发布的应用' }) }], details: {}, isError: true }
        await pool.query(`UPDATE webos_store_apps SET status = 'unpublished' WHERE id = $1`, [shareId])
        return { content: [{ type: 'text', text: JSON.stringify({ success: true, message: '已下架' }) }], details: {} }
      } catch (error) {
        return { content: [{ type: 'text', text: JSON.stringify({ success: false, message: error instanceof Error ? error.message : '下架失败' }) }], details: {}, isError: true }
      }
    },
  }
}

/**
 * 2026-08-13 App 变更事件通知（「文件夹即 App」即时化）：
 * agent_fs_* 钩子（onAppFolderCreated/onAppSourceChanged）在工具执行时把
 * app_created/app_updated 记入 pendingAppEvents（按 tKey 分组），SSE 循环的
 * tool_execution_end 分支消费并推送前端（前端刷新 bootstrap → 桌面自动更新）。
 * 工具执行上下文拿不到 tKey，用「按 scope+convId+thinking 前缀匹配最近任务」兜底；
 * 若任务不存在（如会话外操作），事件保留 30s，等待下一轮 tool 结束消费。
 */
const pendingAppEvents = new Map<string, Array<{ type: 'app_created' | 'app_updated'; appId: string }>>()
function notifyAppEvent(type: 'app_created' | 'app_updated', appId: string): void {
  try {
    const now = Date.now()
    // 按前缀找最近一个活跃任务（scope:convId:thinking）
    let bestKey: string | null = null
    for (const [key] of activeSseByTask) {
      // activeSseByTask 的 key 就是 tKey；这里取「任意一个」即可——通知是广播式的，
      // 前端刷新 bootstrap 后所有会话的 App 列表都会更新。
      bestKey = key
      break
    }
    if (bestKey) {
      const list = pendingAppEvents.get(bestKey) ?? []
      list.push({ type, appId })
      pendingAppEvents.set(bestKey, list)
    }
  } catch { /* 通知失败静默 */ }
}

/** 消费并清空某任务的待推送 App 事件（tool_execution_end 分支调用） */
function drainPendingAppEvents(tKey: string): Array<{ type: 'app_created' | 'app_updated'; appId: string }> {
  const list = pendingAppEvents.get(tKey) ?? []
  pendingAppEvents.delete(tKey)
  return list
}

/**
 * 2026-08-13 AI 自测工具：检查 App 当前状态（版本/镜像一致性/素材/语法），
 * 让 AI 改完工作区文件后自查"我的修改是否已生效/是否会被加载"，不再盲等用户反馈。
 */
function inspectWebosAppTool(principal: Principal): ToolDefinition {
  return {
    name: 'inspect_webos_app',
    label: '检查 App 状态',
    description: [
      '检查用户某个 App 的当前状态（自测用）：当前 active 版本号、版本历史、',
      '工作区镜像 apps/<appId>/index.html 是否与 active 版本一致（changed=文件被改但未发布、',
      'clean=一致、missing=文件缺失）、文件夹内素材清单、index.html 语法校验结果（vm.Script）。',
      '修改 App 工作区文件后调用本工具确认变更已生效（若显示 changed，说明系统尚未同步，',
      '可再调用一次或检查文件名是否为 index.html）。',
    ].join(' '),
    parameters: Type.Object({
      appId: Type.String({ description: 'App id（来自 list_webos_apps）' }),
    }),
    execute: async (_toolCallId: string, params: { appId: string }) => {
      try {
        const state = await loadState(principal)
        const app = findApp(state, params.appId)
        if (!app) {
          return { content: [{ type: 'text', text: JSON.stringify({ success: false, message: 'App 不存在' }) }], details: {}, isError: true }
        }
        const active = app.versions.find((version) => version.id === app.activeVersionId) ?? app.versions[0]
        // 镜像一致性
        const root = appFilesRoot(principal.key, 'app', app.id)
        const indexFile = path.join(root, 'index.html')
        let mirror: 'clean' | 'changed' | 'missing' = 'missing'
        try {
          if (fs.existsSync(indexFile)) {
            const fileContent = fs.readFileSync(indexFile, 'utf-8')
            mirror = fileContent === active?.html ? 'clean' : 'changed'
          }
        } catch { /* ignore */ }
        // 素材清单
        let files: Array<{ path: string; bytes: number }> = []
        try {
          const walk = (dir: string, prefix: string): void => {
            for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
              const full = path.join(dir, entry.name)
              if (entry.isDirectory()) walk(full, `${prefix}${entry.name}/`)
              else files.push({ path: `${prefix}${entry.name}`, bytes: fs.statSync(full).size })
            }
          }
          if (fs.existsSync(root)) walk(root, '')
          files = files.sort((a, b) => a.path.localeCompare(b.path)).slice(0, 200)
        } catch { /* ignore */ }
        // index.html 语法校验
        let syntaxOk = true
        let syntaxError: string | null = null
        try {
          if (active?.html) {
            const scripts = active.html.match(/<script\b[^>]*>([\s\S]*?)<\/script>/gi) ?? []
            for (const sc of scripts) {
              const code = sc.replace(/^<script[^>]*>/, '').replace(/<\/script>$/, '')
              if (code.trim()) new VmScript(code, { filename: `webos-inspect-${app.id}.js` })
            }
          }
        } catch (error) {
          syntaxOk = false
          syntaxError = error instanceof Error ? error.message : String(error)
        }
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: true,
              appId: app.id,
              name: app.name,
              activeVersion: active?.version ?? null,
              versionCount: app.versions.length,
              mirror, // clean=镜像与 active 一致 / changed=文件被改但尚未发布 / missing=无镜像
              syntaxOk,
              syntaxError,
              files,
            }),
          }],
          details: {},
        }
      } catch (error) {
        return { content: [{ type: 'text', text: JSON.stringify({ success: false, message: error instanceof Error ? error.message : '检查失败' }) }], details: {}, isError: true }
      }
    },
  }
}

/** 钩子错误可读化：Error 取 message；createError 等普通对象展开 JSON（2026-08-14） */
function describeHookError(error: unknown): string {
  if (error instanceof Error) return error.message
  if (error && typeof error === 'object') {
    try { return JSON.stringify(error) } catch { /* ignore */ }
    return String(error)
  }
  return String(error)
}

/** 对话会话注入的全部 App 工具 + Agent 工作区文件系统工具 +（W2）App API 动态工具 */
async function webosAppTools(principal: Principal): Promise<ToolDefinition[]> {
  const appTools = [
    listWebosAppsTool(principal),
    updateWebosAppTool(principal),
    deleteWebosAppTool(principal),
    setDisplayNameTool(principal),
    showInteractiveHtmlTool(principal),
    publishWebosAppTool(principal),
    unpublishWebosAppTool(principal),
    ...createServerOpsTools(),
  ]
  // 2026-08-06 AI 商店工具（push 注入，避免数组字面量联合推断问题）
  appTools.push({
    name: 'list_webos_store',
    label: '浏览应用商店',
    description: '查看应用商店中的应用列表（名称/简介/安装量）。当用户要求“看看商店有什么、浏览应用商店、商店里有什么好应用”时调用。',
    parameters: Type.Object({}),
    execute: async () => {
      try {
        const pool = getPool()
        const rows = await pool.query(
          `SELECT s.id, s.name, s.description, s.downloads,
            (SELECT COUNT(*) FROM webos_store_installs i WHERE i.share_id = s.id) AS installs
           FROM webos_store_apps s WHERE s.status = 'published' ORDER BY s.created_at DESC LIMIT 50`,
        )
        return {
          content: [{ type: 'text', text: JSON.stringify({ success: true, items: rows.rows.map((r) => ({ shareId: String(r.id), name: String(r.name), description: String(r.description ?? ''), installs: Number(r.installs ?? 0) })) }) }],
          details: {},
        }
      } catch (error) {
        return { content: [{ type: 'text', text: JSON.stringify({ success: false, message: error instanceof Error ? error.message : '商店列表获取失败' }) }], details: {}, isError: true }
      }
    },
  })
  appTools.push({
    name: 'install_webos_store_app',
    label: '下载商店应用',
    description: '从应用商店下载指定应用，安装到用户桌面（参数 shareId：商店条目 ID，来自 list_webos_store）。当用户要求“下载/安装商店里的某个应用、把这个装到桌面”时调用。',
    parameters: Type.Object({
      shareId: Type.String({ description: '商店条目 ID（s- 开头）' }),
    }),
    execute: async (_toolCallId: string, params: { shareId: string }, _signal: any, _onUpdate: any) => {
      try {
        const shareId = String(params.shareId ?? '').replace(/[^a-zA-Z0-9-]/g, '').slice(0, 64)
        const pool = getPool()
        const result = await pool.query('SELECT * FROM webos_store_apps WHERE id = $1 AND status = $2', [shareId, 'published'])
        const row = result.rows[0]
        if (!row) throw createError(404, 'STORE_APP_NOT_FOUND', '该应用不存在或已下架')
        const state = await loadState(principal)
        const now = Date.now()
        const versionId = `version-${randomUUID()}`
        const existing = state.apps.find((app) => app.id === `store:${shareId}`)
        if (existing) {
          existing.versions.push({
            id: versionId, appId: existing.id, version: `1.0.${existing.versions.length}`, status: 'active', source: 'store',
            capabilities: [...DEFAULT_APP_CAPABILITIES], html: String(row.html ?? ''), createdAt: now, createdBy: 'user', parentVersionId: null,
          })
          existing.activeVersionId = versionId
        } else {
          state.apps.unshift({
            id: `store:${shareId}`, name: String(row.name ?? '商店应用'), source: 'store', activeVersionId: versionId, installed: true, createdAt: now,
            icon: typeof row.icon === 'string' ? row.icon : null,
            versions: [{ id: versionId, appId: `store:${shareId}`, version: '1.0.0', status: 'active', source: 'store', capabilities: [...DEFAULT_APP_CAPABILITIES], html: String(row.html ?? ''), createdAt: now, createdBy: 'user', parentVersionId: null }],
          })
        }
        await saveState(principal, state)
        // 素材：优先独立归档，回退发布者工作区
        try {
          const dstRoot = appFilesRoot(principal.key, 'app', `store:${shareId}`)
          fs.mkdirSync(dstRoot, { recursive: true })
          const archived = storeAssetsDir(shareId)
          if (fs.existsSync(archived) && fs.statSync(archived).isDirectory()) {
            fs.cpSync(archived, dstRoot, { recursive: true, force: true })
          } else {
            const srcRoot = appFilesRoot(String(row.owner_key), 'app', String(row.app_id))
            if (fs.existsSync(srcRoot)) {
              const assets = path.join(srcRoot, 'assets')
              if (fs.existsSync(assets) && fs.statSync(assets).isDirectory()) {
                fs.mkdirSync(path.join(dstRoot, 'assets'), { recursive: true })
                fs.cpSync(assets, path.join(dstRoot, 'assets'), { recursive: true, force: true })
              }
            }
          }
          try { fs.writeFileSync(path.join(dstRoot, 'index.html'), String(row.html ?? '')) } catch { /* 忽略 */ }
        } catch { /* 素材复制失败不阻断 */ }
        return { content: [{ type: 'text', text: JSON.stringify({ success: true, appId: `store:${shareId}`, name: String(row.name ?? '') }) }], details: {} }
      } catch (error) {
        const message = error instanceof Error ? error.message : '下载失败'
        return { content: [{ type: 'text', text: JSON.stringify({ success: false, message }) }], details: {}, isError: true }
      }
    },
  })
  // 2026-08-06 服务器负载监控工具：仅管理员会话注入——AI 直接读取服务器
  // CPU/内存/磁盘/带宽数据，判断是否需要升级/清理（数据源 serverMonitor）
  if (principal.role === 'admin') {
    appTools.push({
      name: 'get_server_status',
      label: '服务器状态',
      description: '读取服务器实时负载（CPU 使用率/负载、内存、磁盘、带宽、进程），并附健康告警。用于判断服务器是否过载、是否需要升级配置或清理资源。直接调用返回 JSON，根据数据给出判断与建议。',
      parameters: Type.Object({}),
      execute: async () => {
        const stats = getServerStats()
        const alerts = serverHealthAlerts(stats)
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({ stats, alerts }),
          }],
          details: {},
        }
      },
    })
    // 2026-08-06 负载历史追溯：查询某时间段的带宽/CPU/内存/磁盘记录（分钟粒度，
    // 保留 30 天）——用户问"几天前某个时段是不是带宽过高/服务器卡过"时调用。
    appTools.push({
      name: 'get_server_metrics',
      label: '服务器负载历史',
      description: '查询服务器负载历史（CPU/内存/磁盘/带宽，分钟粒度落库，保留 30 天）。参数：hours（最近 N 小时，默认 24，最大 720）或 from/to（毫秒时间戳，精确时间段）。返回该时段的趋势点（分钟/小时粒度）与峰值摘要（最高带宽时刻、最高 CPU 时刻、平均负载、最新内存/磁盘）。用于追溯某时间段服务器是否带宽过高/过载（如用户反馈某时段卡顿）。',
      parameters: Type.Object({
        hours: Type.Optional(Type.Number({ description: '查询最近 N 小时（默认 24，最大 720；与 from 二选一）' })),
        from: Type.Optional(Type.Number({ description: '起始时间戳（毫秒）' })),
        to: Type.Optional(Type.Number({ description: '结束时间戳（毫秒，默认现在）' })),
      }),
      execute: async (_toolCallId: string, params: { hours?: number; from?: number; to?: number }, _signal: any, _onUpdate: any) => {
        const now = Date.now()
        const from = typeof params.from === 'number' && Number.isFinite(params.from)
          ? params.from
          : (typeof params.hours === 'number' && Number.isFinite(params.hours)
            ? now - Math.min(720, Math.max(1, params.hours)) * 3600_000
            : now - 24 * 3600_000)
        const to = typeof params.to === 'number' && Number.isFinite(params.to) ? params.to : now
        const spanMs = Math.max(60_000, to - from)
        const bucketMs = spanMs > 3 * 24 * 3600_000 ? 3600_000 : 60_000
        const rows = await getPool().query(
          `SELECT CAST(ts / $3 AS INTEGER) * $3 AS bucket,
            AVG(cpu_usage) AS cpu, MAX(rx_mbps) AS rx_max, AVG(rx_mbps) AS rx_avg,
            MAX(tx_mbps) AS tx_max, AVG(tx_mbps) AS tx_avg,
            AVG(mem_used_pct) AS mem, AVG(disk_used_pct) AS disk, AVG(loadavg_1m) AS load1
           FROM webos_server_metrics
           WHERE ts >= $1 AND ts <= $2
           GROUP BY bucket ORDER BY bucket ASC`,
          [from, to, bucketMs],
        )
        const points = rows.rows.map((row) => ({
          ts: Number(row.bucket),
          cpu: Math.round(Number(row.cpu) * 10) / 10,
          rxMbps: Math.round(Number(row.rx_avg) * 100) / 100,
          txMbps: Math.round(Number(row.tx_avg) * 100) / 100,
          rxMaxMbps: Math.round(Number(row.rx_max) * 100) / 100,
          txMaxMbps: Math.round(Number(row.tx_max) * 100) / 100,
          memPct: Math.round(Number(row.mem) * 10) / 10,
          diskPct: Math.round(Number(row.disk) * 10) / 10,
          load1: Math.round(Number(row.load1) * 100) / 100,
        }))
        // 峰值摘要（AI 据此判断某时段是否异常）
        const pickPeak = (key: 'rxMbps' | 'txMbps' | 'cpu'): { value: number; at: number } | null => {
          let best: { value: number; at: number } | null = null
          for (const p of points) {
            const v = Number(p[key]) || 0
            if (!best || v > best.value) best = { value: v, at: p.ts }
          }
          return best
        }
        const avg = (key: 'rxMbps' | 'txMbps' | 'cpu' | 'memPct'): number => {
          if (points.length === 0) return 0
          return Math.round(points.reduce((acc, p) => acc + (Number(p[key]) || 0), 0) / points.length * 10) / 10
        }
        const summary = {
          range: { from, to, minutes: Math.round(spanMs / 60_000) },
          bucketMs,
          samples: points.length,
          peakRx: pickPeak('rxMbps'),
          peakTx: pickPeak('txMbps'),
          peakCpu: pickPeak('cpu'),
          avgRxMbps: avg('rxMbps'),
          avgTxMbps: avg('txMbps'),
          avgCpuPct: avg('cpu'),
          latestMemPct: points.length > 0 ? points[points.length - 1]?.memPct : null,
          latestDiskPct: points.length > 0 ? points[points.length - 1]?.diskPct : null,
          points: points.slice(0, 500), // 大数据量时截断（摘要已够判断）
        }
        return {
          content: [{ type: 'text', text: JSON.stringify(summary) }],
          details: {},
        }
      },
    })
  }
  // 统一包装：每次工具调用都标记"pi 活动"（空闲超时不误杀长工具）并记入
  // 用户工作区 logs/execution.log（AI 只读不可改）。所有注入工具都过这层包装。
  const wrapTool = (tool: ToolDefinition): ToolDefinition => {
    const originalExecute = tool.execute as (...args: unknown[]) => Promise<unknown>
    return {
      ...tool,
      execute: async (...args: unknown[]) => {
        // 工具执行期间视为 pi 活动：生图/批量处理等长工具不会被 180s 空闲超时误杀
        markPiActivity()
        const params = (args[1] ?? {}) as Record<string, unknown>
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const result: any = await originalExecute(...args)
          let ok = true
          try {
            const text = Array.isArray(result?.content) ? result.content.map((c: { text?: string }) => c.text ?? '').join('') : ''
            const parsed = JSON.parse(text) as { success?: boolean; error?: unknown }
            if (parsed && (parsed.error || parsed.success === false)) ok = false
          } catch { /* 结果非 JSON 视为成功 */ }
          logAgentAction(principal.key, tool.name, params, ok)
          return result
        } catch (error) {
          logAgentAction(principal.key, tool.name, params, false,
            error instanceof Error ? error.message : String(error))
          throw error
        }
      },
    }
  }
// 2026-08-13 「文件夹即 App」即时化：AI 用 agent_fs_* 直接操作 apps/ 文件夹时，
  // 系统自动完成「建版本/注册/push」——AI 不再需要理解版本库快照机制：
  // - mkdir apps/<name>/ → 自动写 index.html 骨架 + 注册为 App + push app_created；
  // - write/edit/copy/delete apps/<id>/index.html → 立即校验并发布新版本 + push app_updated。
  // 钩子失败只记录日志，绝不阻断文件操作本身。
  const fsHooks: WorkspaceFsHooks = {
    onAppFolderCreated: async (appId: string) => {
      try {
        const state = await loadState(principal)
        // 2026-08-14 修复：不能用 findApp 判断存在性——findApp 找不到时抛
        // createError(404)（普通对象），新文件夹必然抛错 → 钩子即时注册被中断，
        // 只能靠 loadState 兜底（时机不可控，曾导致"AI 建了 App 列表不显示"、
        // "分享出去的是旧版本"）。改为直接查找，找不到 = 新 App 走注册路径。
        const existing = state.apps.find((candidate) => candidate.id === appId)
        if (!existing) {
          // 骨架 index.html 已由 mkdir 写入：注册为新 App（校验通过才注册）
          const changed = syncAppsFromWorkspaceFolders(principal, state)
          if (changed) await saveState(principal, state)
          notifyAppEvent('app_created', appId)
        } else {
          // 已存在（如恢复回收站文件夹）→ 触发一次版本同步
          const changed = syncAppSourceFromWorkspace(principal, existing)
          if (changed) await saveState(principal, state)
          notifyAppEvent('app_updated', appId)
        }
      } catch (error) {
        console.warn(`[webos] onAppFolderCreated failed for ${appId}:`, describeHookError(error))
      }
    },
    onAppSourceChanged: async (appId: string, relPath: string) => {
      try {
        const state = await loadState(principal)
        // 同 onAppFolderCreated：findApp 抛错语义不适合钩子（App 可能尚未注册）
        const app = state.apps.find((candidate) => candidate.id === appId)
        if (!app) return
        // 立即同步工作区文件 → 版本库（校验通过建新版本并切换，失败保留原版本）
        const changed = syncAppSourceFromWorkspace(principal, app)
        if (changed) {
          await saveState(principal, state)
          notifyAppEvent('app_updated', appId)
        }
      } catch (error) {
        console.warn(`[webos] onAppSourceChanged failed for ${appId} ${relPath}:`, describeHookError(error))
      }
    },
    // 2026-08-20（W-F File Service 一阶段）：文件写入/删除后双写 files 元数据
    //（manifest 锚点，AI 无感知；失败静默，不影响文件操作本身）
    // 2026-08-21（W1 包体系）：命中 packages/<id>/ 时同步包校验并回流人话反馈
    //（返回 string → 随 agent_fs_write/edit/copy/delete 结果交给 AI 即时修正）
    onFsFileWritten: async (fullPath: string) => {
      let feedback: string | undefined
      try { await recordFileStats(principal.key, fullPath) } catch { /* 双写失败静默 */ }
      try {
        const r = await syncPackageFromFs(principal.key, fullPath)
        if (typeof r === 'string' && r) feedback = r
      } catch (error) {
        console.warn(`[webos] syncPackageFromFs failed:`, describeHookError(error))
      }
      return feedback
    },
    onFsFileDeleted: async (fullPath: string) => {
      let feedback: string | undefined
      try { await recordFileDeleted(principal.key, fullPath) } catch { /* 双写失败静默 */ }
      try {
        const r = await syncPackageFromFs(principal.key, fullPath)
        if (typeof r === 'string' && r) feedback = r
      } catch (error) {
        console.warn(`[webos] syncPackageFromFs(delete) failed:`, describeHookError(error))
      }
      return feedback
    },
  }
  const logged = appTools.map(wrapTool)
  // 2026-08-21（W2 App API）：本人已安装 api 包的端点动态注册为 pi 工具
  //（appapi_<ns>_<ep>，参数 schema 直接来自 api.json → AI 零幻觉知道怎么调）
  let apiTools: ToolDefinition[] = []
  try {
    apiTools = await registerDynamicTools(principal)
  } catch (error) {
    console.warn('[webos] registerDynamicTools failed:', describeHookError(error))
  }
  // 2026-08-21（W3 统一包市场）：AI 找包/装包（search_market_packages / install_market_package）
  let marketTools: ToolDefinition[] = []
  try {
    marketTools = await registerMarketTools(principal)
  } catch (error) {
    console.warn('[webos] registerMarketTools failed:', describeHookError(error))
  }
  return [
    ...logged,
    ...apiTools.map(wrapTool),
    ...marketTools.map(wrapTool),
    ...workspaceFsTools(principal.key, fsHooks).map(wrapTool),
    wrapTool(inspectWebosAppTool(principal)),
    ...sysSourceTools().map(wrapTool),
    wrapTool(readTool(principal)),
    wrapTool(manageSkillTool(principal)),
    wrapTool(generateImageTool(principal)),
    wrapTool(generateVideoTool(principal)),
    wrapTool(editVideoTool(principal)),
    wrapTool(editImageTool(principal)),
    ...workflowTools(principal).map(wrapTool),
  ]
}

// ---------------------------------------------------------------------------
// 2026-08-23 开发者与外部 API 凭证：获取当前账号的持久 JWT Token（供 curl/脚本/外部 AI 上传包使用）
// ---------------------------------------------------------------------------

webosRouter.get('/user/token', async (req, res, next) => {
  try {
    const principal = requirePrincipal(req)
    if (principal.guest) {
      throw createError(403, 'GUEST_NO_API_TOKEN', '游客身份无持久 API Token，请先登录邮箱账号')
    }
    const userId = principal.key.replace(/^user:/, '')
    const role: UserRole = (principal.role === 'admin' ? 'admin' : 'member')
    const token = signTokenForUser(userId, role)
    res.json({
      ok: true,
      token,
      userId,
      role: principal.role,
      hint: '在 HTTP 请求头中携带：Authorization: Bearer ' + token,
    })
  } catch (error) {
    next(error)
  }
})

// ---------------------------------------------------------------------------
// Bootstrap / configuration
// ---------------------------------------------------------------------------

webosRouter.get('/bootstrap', async (req, res, next) => {
  try {
    const principal = requirePrincipal(req)
    const state = await loadState(principal)
    // App 源码工作区镜像同步：AI 直接修改工作区 apps/<appId>/index.html 后，
    // 这里自动发布新版本（版本化保留），前端刷新即拿到最新源码
    let changed = false
    for (const app of state.apps) {
      if (syncAppSourceFromWorkspace(principal, app)) changed = true
    }
    // 「文件夹即 App」：apps/ 下新建的文件夹（含 index.html）自动注册
    if (syncAppsFromWorkspaceFolders(principal, state)) changed = true
    if (changed) await saveState(principal, state)
    res.json(buildBootstrap(principal, state))
  } catch (error) {
    next(error)
  }
})

// ---------------------------------------------------------------------------
// 系统 Logo（2026-08-02）
// Logo 是工作区 system/logo.svg（优先）或 system/logo.png——AI 可用
// agent_fs_write 直接修改这两个文件来更换 Logo（「AI 即系统」：连品牌都归 AI 管）。
// bootstrap 已带 logo（base64 dataUrl 由前端拼装），此端点供前端按需刷新。
// ---------------------------------------------------------------------------

webosRouter.get('/logo', (req, res) => {
  try {
    const principal = requirePrincipal(req)
    const logo = readLogoFile(principal.key)
    res.json({ present: logo !== null, logo })
  } catch (error) {
    res.status(500).json({ error: { message: error instanceof Error ? error.message : '读取 Logo 失败' } })
  }
})

// ---------------------------------------------------------------------------
// 用户头像（2026-08-03）
// 头像 = 工作区 system/avatar.svg（优先）或 system/avatar.png——用户可直接上传
// 更换，AI 也可用 agent_fs_write 修改；未设置时前端显示首字母。
// bootstrap 已带 avatar，此端点供上传与按需刷新。
// ---------------------------------------------------------------------------

webosRouter.get('/avatar', (req, res) => {
  try {
    const principal = requirePrincipal(req)
    if (principal.guest) {
      res.json({ present: false, avatar: null })
      return
    }
    const avatar = readAvatarFile(principal.key)
    res.json({ present: avatar !== null, avatar })
  } catch (error) {
    res.status(500).json({ error: { message: error instanceof Error ? error.message : '读取头像失败' } })
  }
})

/** POST /webos/api/avatar — 上传用户头像（仅登录；png/jpg/svg/webp，≤2MB，写 system/avatar.<ext>） */
webosRouter.post('/avatar', (req, res, next) => {
  try {
    const principal = requirePrincipal(req)
    if (principal.guest) {
      next(createError(403, 'GUEST_NOT_ALLOWED', '请先登录后再设置头像'))
      return
    }
    const body = req.body as { contentBase64?: unknown; ext?: unknown }
    const ext = typeof body.ext === 'string' ? body.ext.toLowerCase().replace(/[^a-z0-9]/g, '') : ''
    if (!['png', 'svg', 'jpg', 'jpeg', 'webp'].includes(ext)) {
      next(createError(400, 'INVALID_AVATAR_FORMAT', '头像仅支持 png / svg / jpg / webp'))
      return
    }
    const contentBase64 = typeof body.contentBase64 === 'string' ? body.contentBase64 : ''
    let buffer: Buffer
    try {
      buffer = Buffer.from(contentBase64, 'base64')
    } catch {
      next(createError(400, 'INVALID_BASE64', '头像内容编码不正确'))
      return
    }
    if (buffer.length === 0) {
      next(createError(400, 'EMPTY_AVATAR', '头像内容为空'))
      return
    }
    if (buffer.length > 2 * 1024 * 1024) {
      next(createError(413, 'AVATAR_TOO_LARGE', '头像最大 2MB'))
      return
    }
    const root = getWorkspaceRoot(principal.key)
    const systemDir = path.join(root, 'system')
    fs.mkdirSync(systemDir, { recursive: true })
    const extFile = ext === 'jpeg' ? 'jpg' : ext
    const target = path.join(systemDir, `avatar.${extFile}`)
    // 只保留当前扩展名的头像文件（删掉其他格式，避免旧头像残留）
    for (const old of ['avatar.svg', 'avatar.png', 'avatar.jpg', 'avatar.webp']) {
      if (old !== `avatar.${extFile}`) {
        try { fs.unlinkSync(path.join(systemDir, old)) } catch { /* 不存在忽略 */ }
      }
    }
    fs.writeFileSync(target, buffer)
    logAgentAction(principal.key, 'user_upload_avatar', { ext, bytes: buffer.length }, true)
    const mime = extFile === 'png' ? 'image/png' : extFile === 'svg' ? 'image/svg+xml' : extFile === 'webp' ? 'image/webp' : 'image/jpeg'
    res.json({ ok: true, avatar: { mime, base64: buffer.toString('base64') } })
  } catch (error) {
    next(error)
  }
})

// ---------------------------------------------------------------------------
// 用户文件工作区（2026-08-02）
// 用户可见区 = 工作区 home/（per-user 隔离：路径基于 principal.key 解析）。
// AI 通过 agent_fs_* 读写同一工作区，用户上传的文件 AI 可直接使用；
// agent/、system/、apps/、logs/ 是 AI/系统内部区，用户端点不可访问。
// 限制：无单文件大小限制（2026-08-12 取消），工作区总量按身份配额（游客 200MB/登录 512MB/月卡档位）、类型白名单（防脚本/可执行文件入库）。
// ---------------------------------------------------------------------------

const MIME_BY_EXT: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
  webp: 'image/webp', svg: 'image/svg+xml', bmp: 'image/bmp', ico: 'image/x-icon', avif: 'image/avif',
  md: 'text/markdown; charset=utf-8', txt: 'text/plain; charset=utf-8', json: 'application/json; charset=utf-8',
  csv: 'text/csv; charset=utf-8', pdf: 'application/pdf', epub: 'application/epub+zip',
  mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', m4a: 'audio/mp4', flac: 'audio/flac', aac: 'audio/aac',
  mp4: 'video/mp4', mov: 'video/quicktime', mkv: 'video/x-matroska', webm: 'video/webm', avi: 'video/x-msvideo', m4v: 'video/x-m4v',
  zip: 'application/zip', rar: 'application/vnd.rar', '7z': 'application/x-7z-compressed',
  tar: 'application/x-tar', gz: 'application/gzip',
  ics: 'text/calendar; charset=utf-8', vcf: 'text/vcard; charset=utf-8', srt: 'application/x-subrip; charset=utf-8',
  ttf: 'font/ttf', otf: 'font/otf', woff: 'font/woff', woff2: 'font/woff2', eot: 'application/vnd.ms-fontobject',
}

function mimeFor(name: string): string {
  const ext = name.toLowerCase().split('.').pop() ?? ''
  return MIME_BY_EXT[ext] ?? 'application/octet-stream'
}

function fileEntry(name: string, fullPath: string): { name: string; type: 'dir' | 'file'; size: number; modifiedAt: number; publicUrl?: string } | null {
  try {
    const stat = fs.statSync(fullPath)
    const entry: { name: string; type: 'dir' | 'file'; size: number; modifiedAt: number; publicUrl?: string } = {
      name,
      type: stat.isDirectory() ? 'dir' : 'file',
      size: stat.isDirectory() ? 0 : stat.size,
      modifiedAt: stat.mtimeMs,
    }
    if (stat.isFile()) {
      const publicUrl = ensurePublicImageCopy(fullPath)
      if (publicUrl) entry.publicUrl = publicUrl
    }
    return entry
  } catch {
    return null
  }
}

/** 路径类错误（越界/非法）统一返回 400 而非 500 */
function workspacePathError(error: unknown, next: (error: unknown) => void): void {
  const message = error instanceof Error ? error.message : String(error)
  if (message.includes('越界') || message.includes('非法路径')) {
    next(createError(400, 'INVALID_PATH', message))
    return
  }
  next(error)
}

/** GET /webos/api/workspace/files?path= — 列出用户可见区（home/）目录 */
webosRouter.get('/workspace/files', async (req, res, next) => {
  try {
    const principal = requirePrincipal(req)
    const dir = typeof req.query.path === 'string' && req.query.path.trim()
      ? req.query.path.trim().replace(/^\/+/, '')
      : ''
    const full = resolveUserHomePath(principal.key, dir)
    if (!fs.existsSync(full) || !fs.statSync(full).isDirectory()) {
      next(createError(404, 'DIR_NOT_FOUND', '目录不存在'))
      return
    }
    const entries = fs.readdirSync(full, { withFileTypes: true })
      .map((entry) => fileEntry(entry.name, path.join(full, entry.name)))
      .filter((entry): entry is NonNullable<typeof entry> => entry !== null)
      .sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name, 'zh-CN') : (a.type === 'dir' ? -1 : 1)))
    const used = workspaceUsedBytes(principal.key)
    // 2026-08-12 配额按状态解析（登录 512MB / 月卡档位 10-100GB）
    const state = await loadState(principal)
    res.json({
      path: dir,
      entries,
      workspaceBytes: used,
      workspaceLimitBytes: workspaceLimitForState(state),
    })
  } catch (error) {
    workspacePathError(error, next)
  }
})

// ---------------------------------------------------------------------------
// 2026-08-18 AI 工作区只读浏览（用户需求：文件管理器直接看 AI 工作区内容，
// 不再每次都要向 AI 要文件/耗 tokens；文件只读打开即可）
// - GET  /workspace/agent-files?path=      列出工作区任意目录（默认根）
// - GET  /workspace/agent-files/raw?path=  读取文件字节（图片预览/文本内容/下载）
// 与 home 区端点不同：这两个端点走 resolveWorkspacePath（工作区根=AI 工作区，
// 包含 home/ agent/ apps/ shared/ skills/ system/ logs 等全部结构），
// 只读不写：不提供上传/删除/编辑（AI 工作区文件由 Agent 管理，避免用户误改
// 破坏 App 版本链/系统资产；需要改文件时仍可让 AI 来做）。
// ---------------------------------------------------------------------------

/** GET /webos/api/workspace/agent-files?path= — 列出 AI 工作区目录（只读浏览） */
webosRouter.get('/workspace/agent-files', async (req, res, next) => {
  try {
    const principal = requirePrincipal(req)
    const dir = typeof req.query.path === 'string' && req.query.path.trim()
      ? req.query.path.trim().replace(/^\/+/, '')
      : ''
    const full = resolveWorkspacePath(principal.key, dir || '.')
    if (!fs.existsSync(full) || !fs.statSync(full).isDirectory()) {
      next(createError(404, 'DIR_NOT_FOUND', '目录不存在'))
      return
    }
    const entries = fs.readdirSync(full, { withFileTypes: true })
      .map((entry) => fileEntry(entry.name, path.join(full, entry.name)))
      .filter((entry): entry is NonNullable<typeof entry> => entry !== null)
      .sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name, 'zh-CN') : (a.type === 'dir' ? -1 : 1)))
    res.json({
      path: dir,
      entries,
      // AI 工作区与用户可见区共享同一存储配额，附带用量供界面展示
      workspaceBytes: workspaceUsedBytes(principal.key),
      workspaceLimitBytes: workspaceLimitForState(await loadState(principal)),
    })
  } catch (error) {
    workspacePathError(error, next)
  }
})

/** GET /webos/api/workspace/agent-files/raw?path= — 读取 AI 工作区文件字节（只读） */
webosRouter.get('/workspace/agent-files/raw', (req, res, next) => {
  try {
    const principal = requirePrincipal(req)
    const filePath = typeof req.query.path === 'string' ? req.query.path : ''
    if (!filePath) {
      next(createError(400, 'INVALID_PATH', '缺少 path 参数'))
      return
    }
    const full = resolveWorkspacePath(principal.key, filePath)
    if (!fs.existsSync(full) || !fs.statSync(full).isFile()) {
      next(createError(404, 'FILE_NOT_FOUND', '文件不存在'))
      return
    }
    const stat = fs.statSync(full)
    if (stat.size > 100 * 1024 * 1024) {
      next(createError(413, 'FILE_TOO_LARGE', '文件过大，暂不支持在线预览'))
      return
    }
    res.setHeader('Content-Type', mimeFor(filePath))
    res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(path.basename(filePath))}`)
    res.setHeader('Cache-Control', 'private, max-age=60')
    fs.createReadStream(full).pipe(res)
  } catch (error) {
    workspacePathError(error, next)
  }
})

/** POST /webos/api/workspace/files — 上传文件到用户可见区（body: { fileName, contentBase64, dir? }）
 * 仅已登录用户可上传（游客 403；游客工作区不开放文件上传） */
webosRouter.post('/workspace/files', async (req, res, next) => {
  try {
    const principal = requirePrincipal(req)
    if (principal.guest) {
      next(createError(403, 'GUEST_NOT_ALLOWED', '游客暂不支持上传文件。请先注册 / 登录，登录后获得 512MB 工作区空间，订阅月卡可扩容至 10GB 以上'))
      return
    }
    const body = req.body as { fileName?: unknown; contentBase64?: unknown; dir?: unknown }
    const fileName = sanitizeUploadName(typeof body.fileName === 'string' ? body.fileName : '')
    if (!isAllowedUploadName(fileName)) {
      next(createError(400, 'FILE_TYPE_NOT_ALLOWED', '该文件类型不允许上传（支持图片/文档/音频/视频/压缩包）'))
      return
    }
    const contentBase64 = typeof body.contentBase64 === 'string' ? body.contentBase64 : ''
    if (!contentBase64) {
      next(createError(400, 'EMPTY_FILE', '文件内容为空'))
      return
    }
    let buffer: Buffer
    try {
      buffer = Buffer.from(contentBase64, 'base64')
    } catch {
      next(createError(400, 'INVALID_BASE64', '文件内容编码不正确'))
      return
    }
    if (buffer.length === 0) {
      next(createError(400, 'EMPTY_FILE', '文件内容为空'))
      return
    }
    // 2026-08-12 取消单文件大小限制：只受工作区总配额约束
    // 工作区总量限制（游客 200MB / 登录 512MB / 月卡档位，含已有文件）
    const state = await loadState(principal)
    const used = workspaceUsedBytes(principal.key)
    const limit = workspaceLimitForState(state)
    if (used + buffer.length > limit) {
      next(createError(413, 'WORKSPACE_FULL', '工作区空间不足，请先清理部分文件；大量存储需求可联系站长单独扩容'))
      return
    }
    const dir = typeof body.dir === 'string' && body.dir.trim()
      ? body.dir.trim().replace(/^\/+/, '').replace(/\/+$/, '')
      : 'uploads'
    const target = resolveUserHomePath(principal.key, `${dir}/${fileName}`)
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, buffer)
    const entry = fileEntry(fileName, target)
    logAgentAction(principal.key, 'user_upload_file', { fileName, dir, bytes: buffer.length }, true)
    res.json({ ok: true, file: entry, workspaceBytes: workspaceUsedBytes(principal.key), workspaceLimitBytes: workspaceLimitForState(state) })
  } catch (error) {
    next(error)
  }
})

// ---------------------------------------------------------------------------
// 2026-08-13 大文件分片上传（顺序 append + 断点续传）
// 背景：单文件 >450MB（base64 后超 express/nginx 600MB body limit）无法用单请求上传；
//       直接调大 limit 不可行（服务器 3.7GB 内存，10GB 文件 base64 ~13.3GB 会 OOM）。
// 方案：前端把大文件切成 ~8MB 片逐片上传（每片独立请求，不超时、内存恒定），
//       服务端边收边 append 到临时文件，全部收完后原子 rename 到目标位置。
//       同 key + 同名 + 同大小未完成 session 自动复用 → 断点续传（重试即续）。
// 临时文件放 <sandbox>/webos/_uploads/<key>/（用户工作区之外，不计配额、不可见）。
// ---------------------------------------------------------------------------

interface UploadSession {
  key: string
  uploadId: string
  fileName: string
  dir: string
  totalBytes: number
  bytesSoFar: number
  partsCount: number
  tmpPath: string
  lastActiveAt: number
}

const uploadSessions = new Map<string, UploadSession>()
const UPLOAD_SESSION_TTL_MS = 24 * 60 * 60 * 1000 // 24h 未活动自动清理（配合定时器）
const UPLOAD_TMP_BASE = 'webos/_uploads' // 相对 sandbox 根

function uploadTmpDir(key: string): string {
  return path.join(getSandboxRoot(), UPLOAD_TMP_BASE, workspaceDirName(key))
}

/** 删除该 key 下全部残留上传（abort / 过期 / 服务重启后遗留清理） */
function purgeUploadSession(session: UploadSession): void {
  try {
    if (fs.existsSync(session.tmpPath)) fs.unlinkSync(session.tmpPath)
  } catch { /* 忽略 */ }
  uploadSessions.delete(session.uploadId)
}

/** 惰性清理：part/complete/abort 前调用；超时 session 删除并删临时文件 */
function expireUploadSessions(now = Date.now()): void {
  for (const session of [...uploadSessions.values()]) {
    if (now - session.lastActiveAt > UPLOAD_SESSION_TTL_MS) purgeUploadSession(session)
  }
}

// 模块级定时器：每小时清理过期 session 与残留临时文件（服务重启后内存 session 丢失，
// 残留临时文件由本定时器兜底删除）
const uploadCleanupTimer = setInterval(() => {
  try {
    expireUploadSessions()
    const base = path.join(getSandboxRoot(), UPLOAD_TMP_BASE)
    if (!fs.existsSync(base)) return
    for (const dirName of fs.readdirSync(base)) {
      const dir = path.join(base, dirName)
      const stat = fs.statSync(dir)
      if (stat.isDirectory() && Date.now() - stat.mtimeMs > UPLOAD_SESSION_TTL_MS) {
        try {
          fs.rmSync(dir, { recursive: true, force: true })
        } catch { /* 忽略 */ }
      }
    }
  } catch { /* 忽略 */ }
}, 60 * 60 * 1000)
if (typeof uploadCleanupTimer.unref === 'function') uploadCleanupTimer.unref()

/**
 * POST /webos/api/workspace/files/upload — 大文件分片上传
 * body: { action: 'init'|'part'|'complete'|'abort', uploadId?, fileName?, dir?, size?, index?, data? }
 *  - init:     创建上传会话（同 key+同名+同大小未完成会话自动复用 → 续传）；返回 { uploadId, partsCount }
 *  - part:     顺序上传一片（index 必须等于服务端已收片数）；data 为 base64
 *  - complete: 校验总字节一致后原子落盘（rename），返回最终 file 条目
 *  - abort:    放弃并删除临时文件
 */
webosRouter.post('/workspace/files/upload', async (req, res, next) => {
  try {
    const principal = requirePrincipal(req)
    if (principal.guest) {
      next(createError(403, 'GUEST_NOT_ALLOWED', '游客暂不支持上传文件。请先注册 / 登录，登录后获得 512MB 工作区空间，订阅月卡可扩容至 10GB 以上'))
      return
    }
    const body = req.body as { action?: unknown; uploadId?: unknown; fileName?: unknown; dir?: unknown; size?: unknown; index?: unknown; data?: unknown }
    const action = typeof body.action === 'string' ? body.action : ''
    expireUploadSessions()

    if (action === 'init') {
      const fileName = sanitizeUploadName(typeof body.fileName === 'string' ? body.fileName : '')
      if (!isAllowedUploadName(fileName)) {
        next(createError(400, 'FILE_TYPE_NOT_ALLOWED', '该文件类型不允许上传（支持图片/文档/音频/视频/压缩包）'))
        return
      }
      const size = typeof body.size === 'number' && Number.isFinite(body.size) ? Math.floor(body.size) : -1
      if (size <= 0) {
        next(createError(400, 'INVALID_SIZE', '文件大小无效'))
        return
      }
      const dir = typeof body.dir === 'string' && body.dir.trim()
        ? body.dir.trim().replace(/^\/+/, '').replace(/\/+$/, '')
        : 'uploads'
      // 预检目标路径合法（home/ 内；越界抛 400 INVALID_PATH）
      resolveUserHomePath(principal.key, `${dir}/${fileName}`)
      // 配额检查：总大小 ≤ 当前剩余空间
      const state = await loadState(principal)
      const used = workspaceUsedBytes(principal.key)
      const limit = workspaceLimitForState(state)
      if (size > Math.max(0, limit - used)) {
        next(createError(413, 'WORKSPACE_FULL', '工作区空间不足，无法上传该文件；请先清理部分文件，大量存储需求可联系站长单独扩容'))
        return
      }
      // 续传：同 key + 同名 + 同大小 + 未完成 → 复用会话
      for (const session of uploadSessions.values()) {
        if (session.key === principal.key && session.fileName === fileName && session.dir === dir && session.totalBytes === size) {
          if (session.bytesSoFar < session.totalBytes) {
            session.lastActiveAt = Date.now()
            res.json({ ok: true, uploadId: session.uploadId, partsCount: session.partsCount, totalBytes: session.totalBytes, resumed: true })
            return
          }
          // 已完成的僵尸会话：清理后重新开始
          purgeUploadSession(session)
          break
        }
      }
      const uploadId = randomUUID()
      const tmpDir = uploadTmpDir(principal.key)
      fs.mkdirSync(tmpDir, { recursive: true })
      const tmpPath = path.join(tmpDir, uploadId)
      fs.writeFileSync(tmpPath, Buffer.alloc(0))
      uploadSessions.set(uploadId, {
        key: principal.key,
        uploadId,
        fileName,
        dir,
        totalBytes: size,
        bytesSoFar: 0,
        partsCount: 0,
        tmpPath,
        lastActiveAt: Date.now(),
      })
      res.json({ ok: true, uploadId, partsCount: 0, totalBytes: size, resumed: false })
      return
    }

    const rawUploadId = typeof body.uploadId === 'string' ? body.uploadId : ''
    const session = rawUploadId ? uploadSessions.get(rawUploadId) : undefined
    if (!session || session.key !== principal.key) {
      next(createError(404, 'UPLOAD_NOT_FOUND', '上传会话不存在或已过期，请重新开始上传'))
      return
    }
    session.lastActiveAt = Date.now()

    if (action === 'part') {
      const index = typeof body.index === 'number' && Number.isInteger(body.index) ? body.index : -1
      if (index !== session.partsCount) {
        next(createError(400, 'PART_SEQUENCE', `分片顺序错误：期望第 ${session.partsCount} 片，收到第 ${index} 片`))
        return
      }
      const contentBase64 = typeof body.data === 'string' ? body.data : ''
      let buffer: Buffer
      try {
        buffer = Buffer.from(contentBase64, 'base64')
      } catch {
        next(createError(400, 'INVALID_BASE64', '分片内容编码不正确'))
        return
      }
      if (buffer.length === 0) {
        next(createError(400, 'EMPTY_PART', '分片内容为空'))
        return
      }
      if (session.bytesSoFar + buffer.length > session.totalBytes) {
        next(createError(400, 'PART_TOO_LARGE', '分片超出文件总大小'))
        return
      }
      fs.appendFileSync(session.tmpPath, buffer)
      session.bytesSoFar += buffer.length
      session.partsCount += 1
      res.json({ ok: true, received: session.bytesSoFar, partsCount: session.partsCount, totalBytes: session.totalBytes })
      return
    }

    if (action === 'complete') {
      if (session.bytesSoFar !== session.totalBytes) {
        next(createError(400, 'PART_INCOMPLETE', `文件不完整：已收 ${session.bytesSoFar}/${session.totalBytes} 字节，请继续上传剩余分片`))
        return
      }
      // 最终配额复核（防 init 后被其它上传占满空间）
      const state = await loadState(principal)
      const used = workspaceUsedBytes(principal.key)
      const limit = workspaceLimitForState(state)
      if (used + session.totalBytes > limit) {
        purgeUploadSession(session)
        next(createError(413, 'WORKSPACE_FULL', '工作区空间不足，上传已取消；请先清理部分文件'))
        return
      }
      const target = resolveUserHomePath(principal.key, `${session.dir}/${session.fileName}`)
      fs.mkdirSync(path.dirname(target), { recursive: true })
      // 同盘 rename 原子落盘（覆盖同名旧文件，与单文件上传语义一致）
      fs.renameSync(session.tmpPath, target)
      const entry = fileEntry(session.fileName, target)
      uploadSessions.delete(session.uploadId)
      logAgentAction(principal.key, 'user_upload_file_chunked', { fileName: session.fileName, dir: session.dir, bytes: session.totalBytes }, true)
      res.json({ ok: true, file: entry, workspaceBytes: workspaceUsedBytes(principal.key), workspaceLimitBytes: workspaceLimitForState(state) })
      return
    }

    if (action === 'abort') {
      purgeUploadSession(session)
      res.json({ ok: true, aborted: true })
      return
    }

    next(createError(400, 'INVALID_ACTION', '未知的上传操作（支持 init / part / complete / abort）'))
  } catch (error) {
    // 路径类错误（越界/非法）统一转 400 INVALID_PATH（与 GET/DELETE 端点一致）
    workspacePathError(error, next)
  }
})

/** GET /webos/api/workspace/files/raw?path= — 读取用户可见区文件字节（图片预览/下载；仅 home/ 内） */
webosRouter.get('/workspace/files/raw', (req, res, next) => {
  try {
    const principal = requirePrincipal(req)
    const filePath = typeof req.query.path === 'string' ? req.query.path : ''
    if (!filePath) {
      next(createError(400, 'INVALID_PATH', '缺少 path 参数'))
      return
    }
    const full = resolveUserHomePath(principal.key, filePath)
    if (!fs.existsSync(full) || !fs.statSync(full).isFile()) {
      next(createError(404, 'FILE_NOT_FOUND', '文件不存在'))
      return
    }
    res.setHeader('Content-Type', mimeFor(filePath))
    res.setHeader('Cache-Control', 'private, max-age=300')
    fs.createReadStream(full).pipe(res)
  } catch (error) {
    workspacePathError(error, next)
  }
})

/** DELETE /webos/api/workspace/files?path= — 删除用户可见区文件或空目录（仅 home/ 内） */
webosRouter.delete('/workspace/files', (req, res, next) => {
  try {
    const principal = requirePrincipal(req)
    const filePath = typeof req.query.path === 'string' ? req.query.path : ''
    if (!filePath) {
      next(createError(400, 'INVALID_PATH', '缺少 path 参数'))
      return
    }
    const full = resolveUserHomePath(principal.key, filePath)
    if (!fs.existsSync(full)) {
      next(createError(404, 'FILE_NOT_FOUND', '文件不存在'))
      return
    }
    const stat = fs.statSync(full)
    if (stat.isDirectory()) {
      if (fs.readdirSync(full).length > 0) {
        next(createError(400, 'DIR_NOT_EMPTY', '目录非空，无法删除'))
        return
      }
      fs.rmdirSync(full)
    } else {
      removePublicImageCopy(full)
      fs.unlinkSync(full)
    }
    logAgentAction(principal.key, 'user_delete_file', { path: filePath }, true)
    res.json({ ok: true })
  } catch (error) {
    workspacePathError(error, next)
  }
})

// ---------------------------------------------------------------------------
// 2026-08-02 生图 REST API（面向用户页/管理后台；AI 对话走 generate_image 工具）
// ---------------------------------------------------------------------------

/** 图片文件服务：读取当前用户工作区 agent/images/ 下的生成图（按用户隔离） */
webosRouter.get('/imagegen/file/:name', async (req, res, next) => {
  try {
    const principal = requirePrincipal(req)
    const name = String(req.params.name ?? '')
    if (!/^[a-zA-Z0-9._-]+$/.test(name) || !name.endsWith('.png')) {
      next(createError(400, 'INVALID_FILE', '非法文件名'))
      return
    }
    const full = path.join(imagesRoot(principal.key), name)
    if (!fs.existsSync(full) || !fs.statSync(full).isFile()) {
      next(createError(404, 'FILE_NOT_FOUND', '图片不存在'))
      return
    }
    res.setHeader('Content-Type', 'image/png')
    res.setHeader('Cache-Control', 'private, max-age=3600')
    fs.createReadStream(full).pipe(res)
  } catch (error) {
    next(error)
  }
})

/** 生图配置：定价 + 可用状态（管理后台/前端展示；不暴露 key） */
webosRouter.get('/imagegen/config', (_req, res) => {
  res.json({
    available: imageGenConfigured(),
    pricing: IMAGE_PRICING,
  })
})

/** REST 生图入口（与 generate_image 工具同链路：保存工作区 + 扣 token + 落库监测；支持图生图） */
webosRouter.post('/imagegen', async (req, res, next) => {
  try {
    const principal = requirePrincipal(req)
    const body = req.body as { prompt?: unknown; n?: unknown; size?: unknown; reference_image?: unknown }
    const prompt = typeof body.prompt === 'string' ? body.prompt.trim().slice(0, 8_000) : ''
    if (!prompt) {
      next(createError(400, 'EMPTY_PROMPT', 'prompt 必填'))
      return
    }
    const n = Math.min(4, Math.max(1, Math.floor(Number(body.n) || 1)))
    const size = typeof body.size === 'string' && /^\d+x\d+$/.test(body.size) ? body.size : '1024x1024'

    // 参考图（可选，图生图）：工作区路径 → buffer
    let referenceImage: Buffer | undefined
    if (typeof body.reference_image === 'string' && body.reference_image.length > 0) {
      try {
        const full = resolveWorkspacePath(principal.key, body.reference_image)
        const stat = fs.statSync(full)
        if (!stat.isFile()) throw new Error('参考图不是文件')
        if (stat.size > 8 * 1024 * 1024) throw new Error('参考图超过 8MB 限制')
        referenceImage = fs.readFileSync(full)
      } catch (error) {
        next(createError(400, 'BAD_REFERENCE_IMAGE', `参考图读取失败：${error instanceof Error ? error.message : String(error)}`))
        return
      }
    }

    const state = await loadState(principal)
    if (remainingCredits(state) <= 0) {
      await recordImageGenUsage({
        userKey: principal.key, userEmail: principal.email ?? null, kind: principalKind(principal, state),
        prompt, n, images: 0, inputTokens: 0, outputTokens: 0, costMinor: 0,
        status: 'insufficient', errorCode: 'TOKEN_INSUFFICIENT', durationMs: 0, ip: req.ip,
      })
      next(createError(402, 'TOKEN_INSUFFICIENT', `积分已用完。联系客服微信 ${SUPPORT_WECHAT} 获取额度`))
      return
    }
    if (!imageGenConfigured()) {
      next(createError(503, 'IMAGE_GEN_NOT_CONFIGURED', '生图渠道未配置'))
      return
    }

    const result = await generateImages({ prompt, n, size, referenceImage })
    const files: Array<{ path: string; url: string }> = []
    for (const buffer of result.images) {
      files.push(await saveImageFile(principal.key, buffer, 'gen', size))
    }
    const actual = chargeCredits(state, result.costMinor)
    await saveState(principal, state)
    await recordImageGenUsage({
      userKey: principal.key, userEmail: principal.email ?? null, kind: principalKind(principal, state),
      prompt, n, images: files.length,
      inputTokens: result.inputTokens, outputTokens: result.outputTokens, costMinor: result.costMinor,
      status: result.status, errorCode: result.errorCode, durationMs: result.durationMs, ip: req.ip,
    })
    if (!result.ok) {
      res.status(502).json({
        ok: false,
        error: result.errorCode ?? 'GENERATION_FAILED',
        message: result.errorMessage ?? '生图失败',
        durationMs: result.durationMs,
      })
      return
    }
    res.json({
      ok: true,
      files,
      tokens: { input: result.inputTokens, output: result.outputTokens, charged: actual },
      costMinor: result.costMinor,
      durationMs: result.durationMs,
      pricing: IMAGE_PRICING,
    })
  } catch (error) {
    next(error)
  }
})

webosRouter.put('/ai/config', async (req, res, next) => {
  try {
    const principal = requirePrincipal(req)
    const state = await loadState(principal)
    const body = req.body as { model?: unknown; thinking?: unknown }
    const model = resolveModel(body.model)
    const thinking = resolveThinking(state, body.thinking)
    state.ai = { model, thinking }
    await saveState(principal, state)
    res.json({ model, thinking, models: [modelConfig()] })
  } catch (error) {
    next(error)
  }
})

webosRouter.get('/usage', async (req, res, next) => {
  try {
    const principal = requirePrincipal(req)
    const state = await loadState(principal)
    res.json({
      balanceMinor: state.balanceMinor,
      freeBalanceMinor: state.freeBalanceMinor,
      usedMinor: state.usedMinor,
      currency: 'CNY',
      events: [],
      note: 'P0 账本接口已保留；详细事件审计见 /usage/credits-history。',
    })
  } catch (error) {
    next(error)
  }
})

/**
 * 2026-08-06 积分消耗明细（个人中心展示）：合并 对话（webos_ai_usage）/ 生图
 * （webos_imagegen_usage）/ 视频（webos_video_usage，含 contextIR/处理）三类记录，
 * 按时间倒序返回最近 N 条。1 积分 = ¥0.01。
 */
webosRouter.get('/usage/credits-history', async (req, res, next) => {
  const principal = requirePrincipal(req)
  try {
    const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 30))
    const pool = getPool()
    const rows = await pool.query(
      `SELECT * FROM (
        SELECT 'chat' AS kind, 'AI 对话' AS label, cost_minor AS cost,
               status, error_code AS err, created_at AS ts, '' AS detail
        FROM webos_ai_usage WHERE user_key = $1
        UNION ALL
        SELECT 'image', 'AI 生图', cost_minor, status, error_code, created_at,
               (images || ' 张') FROM webos_imagegen_usage WHERE user_key = $1
        UNION ALL
        SELECT CASE task_type
                 WHEN 'h3_context_ir' THEN 'video_ir'
                 WHEN 'video_edit' THEN 'video_edit'
                 ELSE 'video' END,
               CASE task_type
                 WHEN 'h3_context_ir' THEN '视频 · Context-IR 增强'
                 WHEN 'video_edit' THEN '视频处理（FFmpeg）'
                 ELSE 'AI 视频' END,
               cost_user_minor, status, error_code, created_at,
               (resolution || ' ' || duration || 's') FROM webos_video_usage WHERE user_key = $1
        UNION ALL
        -- 2026-08-06 爱发电充值到账（成本用负数表示收入；delivered=1 且已发放积分）
        SELECT CASE WHEN product_type = 1 THEN 'recharge_pack' ELSE 'recharge_monthly' END,
               CASE WHEN product_type = 1 THEN '充值 · 尝鲜用量包' ELSE '充值 · 月卡' END,
               -credits, 'ok', NULL, delivered_at,
               (plan_name || '（¥' || amount || '）') FROM webos_afdian_orders
        WHERE matched_user = $1 AND delivered = 1 AND credits > 0
      ) ORDER BY ts DESC LIMIT $2`,
      [principal.key, limit],
    )
    res.json({
      items: rows.rows.map((row) => ({
        kind: String(row.kind),
        label: String(row.label),
        costMinor: Number(row.cost ?? 0),
        status: String(row.status),
        errorCode: row.err ? String(row.err) : null,
        detail: String(row.detail ?? ''),
        createdAt: Number(row.ts),
      })),
    })
  } catch (error) {
    // SQLite 不支持 printf（PG 支持）时回退基础查询（不阻断个人中心展示）
    try {
      const pool = getPool()
      const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 30))
      const ai = await pool.query(
        "SELECT 'chat' AS kind, 'AI 对话' AS label, cost_minor AS cost, status, error_code AS err, created_at AS ts, '' AS detail FROM webos_ai_usage WHERE user_key = $1 ORDER BY created_at DESC LIMIT $2",
        [principal.key, limit],
      )
      const img = await pool.query(
        "SELECT 'image' AS kind, 'AI 生图' AS label, cost_minor AS cost, status, error_code AS err, created_at AS ts, '' AS detail FROM webos_imagegen_usage WHERE user_key = $1 ORDER BY created_at DESC LIMIT $2",
        [principal.key, limit],
      )
      const vid = await pool.query(
        "SELECT CASE task_type WHEN 'h3_context_ir' THEN 'video_ir' WHEN 'video_edit' THEN 'video_edit' ELSE 'video' END AS kind, CASE task_type WHEN 'h3_context_ir' THEN '视频 · Context-IR 增强' WHEN 'video_edit' THEN '视频处理（FFmpeg）' ELSE 'AI 视频' END AS label, cost_user_minor AS cost, status, error_code AS err, created_at AS ts, (resolution || ' ' || duration || 's') AS detail FROM webos_video_usage WHERE user_key = $1 ORDER BY created_at DESC LIMIT $2",
        [principal.key, limit],
      )
      const merged = [...ai.rows, ...img.rows, ...vid.rows]
        .sort((a, b) => Number(b.ts) - Number(a.ts))
        .slice(0, limit)
      res.json({
        items: merged.map((row) => ({
          kind: String(row.kind),
          label: String(row.label),
          costMinor: Number(row.cost ?? 0),
          status: String(row.status),
          errorCode: row.err ? String(row.err) : null,
          detail: String(row.detail ?? ''),
          createdAt: Number(row.ts),
        })),
      })
    } catch (error2) {
      next(error2)
    }
  }
})

// ---------------------------------------------------------------------------
// AI text stream
// ---------------------------------------------------------------------------

/** 2026-08-06 后台任务事件缓冲：每会话（sessionKey）当前运行任务的可读事件流。
 *  断连/刷新后任务在服务端继续跑，事件持续写入缓冲；busy 排队的新请求每 2s
 *  读取增量转发为 background_progress，处理过程对用户可见。
 *  缓冲在任务首个事件时创建；任务结束标记 endedAt（保留供查询，下次任务覆盖）。
 *  2026-08-11 粒度修正：缓冲事件与 SSE 转发**逐条对应**——delta/thinking 由
 *  flushDelta 合并后写入（120ms 窗口），tool 事件原样写入。此前缓冲存原始 pi
 *  delta（未合并），而前端收到的是合并后的 SSE 事件 →「已消费游标」与服务端
 *  缓冲长度不一致 → 刷新恢复时会把整段历史重复追加。lastUserContent 记录任务
 *  对应的最后一条 user 消息，前端据此判断缓冲是否属于当前对话末尾（防止把
 *  历史任务事件追加到新消息/错误卡片上）。 */
interface TaskBufferRec { events: BgTaskEvent[]; startedAt: number; endedAt: number | null; lastUserContent?: string }
const activeTaskEvents = new Map<string, TaskBufferRec>()

/** 清空某会话的后台任务缓冲（2026-08-08：用户按「停止」时调用——已取消的任务
 *  不再被前端恢复/展示，避免「按了停止还提示任务在后台」） */
function clearTaskBuffer(scope: string, conversationId: string): void {
  const prefix = `webos:${scope}:${conversationId}:`
  for (const key of activeTaskEvents.keys()) {
    if (key.startsWith(prefix)) activeTaskEvents.delete(key)
  }
}

/** 后台任务可读事件（与前端 background_progress.event 结构一致；2026-08-11
 *  新增 kind='html'——互动 HTML 组件，断连/刷新恢复也能渲染；
 *  kind='app_created'/'app_updated'——App 创建/更新结果（断连恢复后前端
 *  需要刷新桌面/打开 App，此前只 sseWrite 不写缓冲 → 刷新后 App 丢失通知） */
type BgTaskEvent = { kind: 'thinking' | 'delta' | 'tool_start' | 'tool_update' | 'tool_end' | 'html' | 'app_created' | 'app_updated'; content?: string; tool?: string; ok?: boolean; heightPx?: number }

// ============================================================================
// 2026-08-11 架构统一：SSE 重连（resume）——「前台/后台」两条处理路径合并为一条。
// 之前：任务在线时事件走 SSE 直推；断连/刷新后前端每 2s 轮询 /chat/background
// 拉缓冲增量再渲染（两套处理 + 游标对齐 + 归属判定，边界永远对不齐，反复出 bug）。
// 现在：无论在线还是刷新后，前端都只有一条 SSE 通道——
// - 在线：subscribe 回调直接转发（写「活跃连接」）；
// - 刷新后：前端重发 /chat/stream {resume:true} → 服务端先重放任务缓冲已有事件，
//   再把「活跃连接」切换到新 res，后续事件实时转发，任务结束发 done 并关闭。
// 前端删除轮询/游标/重建全部逻辑，只保留一套 onEvent 渲染。
// ============================================================================
/** 任务事件转发的「活跃 SSE 连接」：原请求断连后由 resume 请求接管 */
const activeSseByTask = new Map<string, { res: Response }>()

/** 任务事件转发：写到当前活跃连接（原请求或 resume 接管后的新连接） */
function sseWrite(tKey: string, event: unknown): void {
  const target = activeSseByTask.get(tKey)
  if (target && !target.res.writableEnded) {
    try {
      target.res.write(`data: ${JSON.stringify(event)}\n\n`)
    } catch { /* 连接异常：忽略 */ }
  }
}

/** 任务结束信号：写 done/error 给活跃连接并关闭它（resume 连接据此结束等待） */
function finishTaskStream(tKey: string, event: unknown): void {
  const target = activeSseByTask.get(tKey)
  if (target) {
    if (!target.res.writableEnded) {
      try { target.res.write(`data: ${JSON.stringify(event)}\n\n`) } catch { /* ignore */ }
      try { target.res.end() } catch { /* ignore */ }
    }
    activeSseByTask.delete(tKey)
  }
}

/** 缓冲事件 → SSE 事件（resume 重放用；kind 与 WebOsChatEvent.type 一一对应） */
function mapBgEventToSse(ev: BgTaskEvent): Record<string, unknown> {
  switch (ev.kind) {
    case 'thinking': return { type: 'thinking', content: ev.content ?? '' }
    case 'delta': return { type: 'delta', content: ev.content ?? '' }
    case 'tool_start': return { type: 'tool_start', tool: ev.tool ?? '' }
    case 'tool_update': return { type: 'tool_update', tool: ev.tool ?? '', content: ev.content ?? '' }
    case 'tool_end': return { type: 'tool_end', tool: ev.tool ?? '', ok: ev.ok }
    case 'html': return { type: 'interactive_html', html: ev.content ?? '', heightPx: ev.heightPx ?? 280 }
    case 'app_created': return { type: 'app_created', appId: ev.content ?? '' }
    case 'app_updated': return { type: 'app_updated', appId: ev.content ?? '' }
    default: return { type: ev.kind }
  }
}

/** 按 scope+conversationId 前缀找最近一次任务缓冲（返回缓冲 key + 记录） */
function findTaskRecByPrefix(prefix: string): { key: string; rec: TaskBufferRec } | null {
  for (const [key, value] of activeTaskEvents) {
    if (key.startsWith(prefix) && value.events.length > 0) return { key, rec: value }
  }
  return null
}

/** 2026-08-11 任务缓冲写入统一入口：缓冲惰性创建（首个事件时），
 *  记录任务对应的最后一条 user 消息（前端恢复时校验归属）。
 *  2026-08-13 同时累积到 chatSessionEvents（统一对话 log 的 events 数据源），
 *  一次请求的完整事件序列（含 reasoning/工具调用）在结束分支统一落库。 */
function appendTaskEvent(key: string, ue: BgTaskEvent, lastUserContent?: string): void {
  let taskRec = activeTaskEvents.get(key)
  if (!taskRec || taskRec.endedAt !== null) {
    // 2026-08-08 修复：新任务必须重建缓冲——旧任务结束后 endedAt 已标记，
    // 但数组仍保留（供前端查询/恢复）。若复用旧数组继续 push，断流恢复或
    // busy 读取会把「历史任务事件」当成当前任务重放，前端思考/回复重复
    // （表现为"消息被发送两次"）。
    taskRec = { events: [], startedAt: Date.now(), endedAt: null, lastUserContent }
    activeTaskEvents.set(key, taskRec)
    // 2026-08-13 新任务重建时同步重置会话 log 收集器（旧请求已落库）
    chatSessionEvents.delete(key)
  }
  taskRec.events.push(ue)
  // 2026-08-13 统一对话 log 收集：BgTaskEvent → ChatSessionEvent（结构同构）
  try {
    let ev: ChatSessionEvent | null = null
    if (ue.kind === 'thinking' || ue.kind === 'delta') ev = { kind: ue.kind, content: ue.content ?? '' }
    else if (ue.kind === 'tool_start') ev = { kind: 'tool_start', tool: ue.tool ?? '' }
    else if (ue.kind === 'tool_update') ev = { kind: 'tool_update', tool: ue.tool ?? '', content: ue.content ?? '' }
    else if (ue.kind === 'tool_end') ev = { kind: 'tool_end', tool: ue.tool ?? '', ok: ue.ok }
    else if (ue.kind === 'html') ev = { kind: 'html', content: ue.content ?? '', heightPx: ue.heightPx }
    else if (ue.kind === 'app_created') ev = { kind: 'app_created', appId: ue.content ?? '' }
    else if (ue.kind === 'app_updated') ev = { kind: 'app_updated', appId: ue.content ?? '' }
    if (ev) collectChatSessionEvent(key, ev, lastUserContent)
  } catch { /* 收集失败不阻断 */ }
}

/** 2026-08-11 从 assistantMessageEvent.partial（AssistantMessage）提取正在生成的
 *  工具调用名——DeepSeek 流式 toolcall_start/delta 事件携带 partial，其 content
 *  blocks 中 type='toolCall' 的 block.name 即工具名（用于工具参数生成阶段的
 *  实时进度展示，任何工具通用）。 */
function extractToolNameFromPartial(partial: unknown): string {
  try {
    const content = (partial as { content?: Array<{ type?: string; name?: string }> })?.content
    for (const block of content ?? []) {
      if (block?.type === 'toolCall' && typeof block.name === 'string' && block.name) return block.name
    }
  } catch { /* 忽略 */ }
  return ''
}

/** 从 pi 原始事件提取「用户可见事件」（与前端 WebOsChatEvent 轻量对应） */
function extractUserEvent(event: unknown): BgTaskEvent | null {
  const e = event as {
    type?: string
    assistantMessageEvent?: { type?: string; delta?: unknown }
    toolName?: string
    isError?: boolean
    /** pi tool_execution_update 的过程输出（工具 execute 第 4 参 onUpdate 的内容） */
    partialResult?: { content?: Array<{ type?: string; text?: string }> }
  }
  if (e.type === 'message_update') {
    // 2026-08-11 粒度修正：text_delta/thinking_delta 不再在此提取——SSE 转发
    // 是 120ms 窗口合并的（pushDelta/flushDelta），缓冲也必须按合并后粒度写入
    // （flushDelta 内 appendTaskEvent），否则前端「已消费游标」与缓冲长度
    // 不一致，刷新恢复会把整段历史重复追加。
    return null
  } else if (e.type === 'tool_execution_start' && typeof e.toolName === 'string') {
    return { kind: 'tool_start', tool: e.toolName }
  } else if (e.type === 'tool_execution_update' && typeof e.toolName === 'string') {
    // 2026-08-07 工具过程增量：pi 工具 onUpdate 输出的实时进度文本
    const content = e.partialResult?.content
    if (Array.isArray(content)) {
      const text = content.map((part) => (part.type === 'text' && typeof part.text === 'string' ? part.text : '')).join('').trim()
      if (text) return { kind: 'tool_update', tool: e.toolName, content: text }
    }
    return null
  } else if (e.type === 'tool_execution_end' && typeof e.toolName === 'string') {
    return { kind: 'tool_end', tool: e.toolName, ok: !e.isError }
  }
  return null
}

/** 2026-08-06 后台任务进度转发：busy 排队等待期间，pi 事件属于「上一条后台任务」，
 *  不作为本次回复处理，而是转发为 background_progress 让前端实时展示处理过程。 */

/**
 * 2026-08-11 SSE 重连（架构统一）：前端刷新/重开页面后重发 /chat/stream
 * {resume:true}——不触发 pi prompt、不排队、不扣费：
 * 1. 该会话有任务缓冲（含 pi 加载期无缓冲但有 in-flight 标记的等待）→ 重放
 *    缓冲全部事件，并把「活跃 SSE 连接」切换为本连接（后续事件实时转发）；
 * 2. 任务结束（原请求 done/failed/error 经 finishTaskStream）→ 补发 done 关闭；
 * 3. 无任何任务 → 返回 no_task，前端保持原状。
 */
async function handleResumeStream(principal: Principal, conversationId: string, body: ChatBody, res: Response): Promise<void> {
  const prefix = `webos:${principal.key}:${conversationId}:`
  const lastUser = typeof body.lastUser === 'string' ? body.lastUser : ''
  setupSse(res)
  const resumeThinking = typeof body.thinking === 'string' && isThinkingLevel(body.thinking) ? body.thinking : 'medium'
  writeSse(res, { type: 'start', requestId: randomUUID(), resume: true, config: { model: MODEL, thinking: resumeThinking } })
  const heartbeat = setInterval(() => {
    if (!res.writableEnded) {
      try { res.write(`data: ${JSON.stringify({ type: 'keep_alive' })}\n\n`) } catch { /* ignore */ }
    }
  }, 15_000)
  heartbeat.unref?.()
  // 等待任务缓冲出现（pi 首次加载期可能尚无缓冲，但有 in-flight 标记）
  const deadline = Date.now() + 240_000
  let found = findTaskRecByPrefix(prefix)
  while (!found && Date.now() < deadline) {
    let inflight = false
    for (const key of chatInFlight.keys()) {
      if (key.startsWith(prefix) && chatInFlightActive(key)) { inflight = true; break }
    }
    if (!inflight) {
      tlog(`chat resume scope=${principal.key} conv=${conversationId} → no task`)
      try {
        if (!res.writableEnded) { writeSse(res, { type: 'no_task' }); res.end() }
      } catch { /* ignore */ }
      clearInterval(heartbeat)
      return
    }
    await new Promise((resolve) => setTimeout(resolve, 1000))
    found = findTaskRecByPrefix(prefix)
  }
  if (!found) {
    tlog(`chat resume scope=${principal.key} conv=${conversationId} → timeout waiting task`)
    try {
      if (!res.writableEnded) {
        writeSse(res, { type: 'error', code: 'WEBOS_AI_BUSY', message: '任务仍在准备中，请刷新重试' })
        res.end()
      }
    } catch { /* ignore */ }
    clearInterval(heartbeat)
    return
  }
  // 归属校验：缓冲任务的 lastUserContent 与前端最后一条 user 消息一致才重放
  // （防止历史任务事件重放到当前新消息上）
  if (lastUser && found.rec.lastUserContent && found.rec.lastUserContent !== lastUser) {
    tlog(`chat resume scope=${principal.key} conv=${conversationId} → lastUser mismatch, no task`)
    try {
      if (!res.writableEnded) { writeSse(res, { type: 'no_task' }); res.end() }
    } catch { /* ignore */ }
    clearInterval(heartbeat)
    return
  }
  tlog(`chat resume scope=${principal.key} conv=${conversationId} taskKey=${found.key.slice(-36)} events=${found.rec.events.length} running=${found.rec.endedAt === null}`)
  // 接管活跃连接后再同步重放缓冲：重放为同步循环，subscribe 的异步事件必然排在其后
  activeSseByTask.set(found.key, { res })
  // 2026-08-11 修复：resume 连接断开时清理活跃登记——否则任务后续事件继续
  // 写到已断开的 res（sseWrite 静默失败），App 创建/文字输出等结果丢失
  // （线上实证：用户多次刷新后 AI 创建 App 成功但桌面不刷新）。
  res.once('close', () => {
    const activeNow = activeSseByTask.get(found.key)
    if (activeNow && activeNow.res === res) activeSseByTask.delete(found.key)
  })
  for (const ev of found.rec.events) {
    if (res.writableEnded) break
    writeSse(res, mapBgEventToSse(ev))
  }
  // 任务在 resume 前已结束：重放完补发 done（带 resume 标记，前端不重复累加用量）
  if (found.rec.endedAt !== null) {
    finishTaskStream(found.key, { type: 'done', usage: null, resume: true })
    clearInterval(heartbeat)
    return
  }
  // 任务仍在跑：等待结束信号（原请求 done/failed/error 经 finishTaskStream 写 done 并关闭）
  await new Promise<void>((resolve) => {
    const timeout = setTimeout(() => {
      try {
        if (!res.writableEnded) { writeSse(res, { type: 'no_task' }); res.end() }
      } catch { /* ignore */ }
      resolve()
    }, 300_000)
    timeout.unref?.()
    res.once('close', () => { clearTimeout(timeout); resolve() })
  })
  clearInterval(heartbeat)
}

webosRouter.post('/chat/stream', async (req, res, next) => {
  let principal: Principal
  try {
    principal = requirePrincipal(req)
    if (!checkAiRateLimit(principal)) {
      next(createError(429, 'WEBOS_AI_RATE_LIMITED', 'AI 请求过于频繁，请稍后再试'))
      return
    }

    const body = req.body as ChatBody
    // 2026-08-11 架构统一：SSE 重连（resume）。刷新/重开页面后前端重发
    // /chat/stream {resume:true}——不触发 pi prompt、不排队、不扣费：
    // 服务端重放任务缓冲全部事件并把「活跃 SSE 连接」切换为本连接，
    // 任务后续事件实时转发直到 done。前端从此只有一条 SSE 事件处理路径
    // （在线/恢复统一），轮询/游标/重建逻辑全部删除。
    const conversationId = typeof body.conversationId === 'string' && body.conversationId.trim()
      ? body.conversationId.trim().slice(0, 64)
      : 'default'
    if (body.resume === true) {
      await handleResumeStream(principal, conversationId, body, res)
      return
    }
    const messages = validateMessages(body.messages)
    const state = await loadState(principal)
    const model = resolveModel(body.model)
    const thinking = resolveThinking(state, body.thinking)
    const estimate = estimateCostMinor(messages, thinking)
    const requestId = randomUUID()
    // 多会话（2026-08-05）：每个会话独立 pi 上下文；rebuild 表示编辑/回退重来
    const rebuild = body.rebuild === true
    // 2026-08-08 诊断：打印请求消息列表 + 会话指纹，检测重复提交（自动重试特征）
    // 2026-08-10 升级：带绝对时间戳 + 完整 scope + requestId（对齐前端/nginx 时间线）
    try {
      const userTexts = messages.filter((m) => m.role === 'user').map((m) => m.content)
      let dupIdx = -1
      for (let di = 1; di < userTexts.length; di += 1) {
        if (userTexts[di] === userTexts[di - 1]) { dupIdx = di; break }
      }
      const lastUserContent = userTexts[userTexts.length - 1] ?? ''
      const diagKey = `${principal.key}:${conversationId}`
      const prevDiag = lastChatReq.get(diagKey)
      const gapMs = prevDiag ? Date.now() - prevDiag.at : -1
      const sameAsPrev = prevDiag && prevDiag.content === lastUserContent ? 'SAME' : 'diff'
      lastChatReq.set(diagKey, { content: lastUserContent, at: Date.now() })
      tlog(`chat req scope=${principal.key} req=${requestId.slice(0, 8)} conv=${conversationId} n=${messages.length} rebuild=${rebuild} thinking=${thinking} gap=${gapMs}ms ${sameAsPrev} dup=${dupIdx >= 0 ? `YES@${dupIdx}` : 'no'} users=[${userTexts.map((t) => t.slice(0, 30).replace(/\s+/g, ' ')).join(' | ')}]`)
    } catch { /* 诊断日志失败不影响请求 */ }

    // 2026-08-02 积分额度：用完后拦截（游客 100 / 登录 1000 / 套餐 990）
    if (remainingCredits(state) <= 0) {
      await recordAiUsage(principal, state, {
        model, thinking, promptTokens: 0, completionTokens: 0, costMinor: 0,
        status: 'insufficient', errorCode: 'TOKEN_INSUFFICIENT', ip: req.ip,
      })
      // 2026-08-11 对话内容落库：积分不足也记录用户消息（含错误码）
      const lastUserMsg = [...messages].reverse().find((message) => message.role === 'user')
      if (lastUserMsg) {
        await recordChatLog(principal, {
          conversationId, requestId, role: 'user',
          content: lastUserMsg.content, thinking, rebuild,
          status: 'insufficient', errorCode: 'TOKEN_INSUFFICIENT',
          promptTokens: 0, completionTokens: 0, costMinor: 0, ip: req.ip,
        })
        // 2026-08-13 统一对话 log：积分不足也落库（仅 user 消息 + 状态）
        await recordChatSessionLog(principal, {
          conversationId, requestId, thinking, rebuild,
          status: 'insufficient', errorCode: 'TOKEN_INSUFFICIENT',
          promptTokens: 0, completionTokens: 0, costMinor: 0, ip: req.ip,
          requestKey: `webos:${principal.key}:${conversationId}:${thinking}`,
        })
      }
      next(createError(
        402,
        'TOKEN_INSUFFICIENT',
        `积分已用完（剩余 0）。建议升级 9.9 元套餐（990 积分，即将开放），或加客服微信 ${SUPPORT_WECHAT}；当前为测试阶段，联系客服可免费获得更多积分`,
      ))
      return
    }

    // 2026-08-08 请求在途标记：请求一到即登记（积分检查之后）——前端断流后
    // 查询后台任务能识别"第一次请求已在处理"（pi 加载期尚无事件缓冲），
    // 从而放弃自动重试，避免同一条消息被服务端处理两次。
    // 2026-08-10 生命周期修复：登记时记录消息内容；同 key 已有在途请求且内容相同
    // （前端自动重试/双击误触）→ 直接拒绝（409），前端 attempt0 查询 /chat/background
    // 会看到 running=true → 走 recoverBackgroundTask 恢复第一次结果，不再向 pi
    // 发送第二条重复 prompt（根治"AI 完成一次会话后同一条消息又被处理一次"）。
    const inflightKey = `webos:${principal.key}:${conversationId}:${thinking}`
    const inflightLastUser = [...messages].reverse().find((message) => message.role === 'user')?.content ?? ''
    const inflightRec = chatInFlight.get(inflightKey)
    if (inflightRec && chatInFlightActive(inflightKey) && inflightRec.content === inflightLastUser) {
      tlog(`chat dup rejected scope=${principal.key} req=${requestId.slice(0, 8)} conv=${conversationId} sameMsgInflight content="${inflightLastUser.slice(0, 40).replace(/\s+/g, ' ')}"`)
      next(createError(409, 'CHAT_DUPLICATE_INFLIGHT', '同一条消息正在处理中，已为你恢复进度'))
      return
    }
    // 2026-08-11 done 后短窗口（5s）同内容重复请求拦截（防御第二道）：
    // 正常用户不会在 AI 刚回复完的 5s 内再次发送完全相同的消息（且不带 rebuild）——
    // 若出现，几乎可以确定是客户端 bug（IME 事件重放 / 双 submit / 前端重试循环
    // 回归），直接拒绝避免双倍扣费。rebuild=true 豁免（编辑/回退重来合法重发）。
    const recentDoneRec = recentChatDone.get(inflightKey)
    if (!rebuild && recentDoneRec && Date.now() - recentDoneRec.at < CHAT_RECENT_DONE_WINDOW_MS && recentDoneRec.content === inflightLastUser) {
      tlog(`chat dup recent rejected scope=${principal.key} req=${requestId.slice(0, 8)} conv=${conversationId} sameMsgRecent ago=${Date.now() - recentDoneRec.at}ms content="${inflightLastUser.slice(0, 40).replace(/\s+/g, ' ')}"`)
      next(createError(409, 'CHAT_DUPLICATE_RECENT', '刚刚已完成相同内容的回复，请勿重复发送'))
      return
    }
    markChatInFlight(inflightKey, inflightLastUser)

    // 先完成 pi 会话创建（失败时走 JSON 错误响应，避免 SSE 头已发送后无法报错）
    const appId = typeof body.appId === 'string' ? body.appId : undefined
    if (appId) findApp(state, appId)
    const sourceVersionId = typeof body.sourceVersionId === 'string' ? body.sourceVersionId : null
    const lastUser = [...messages].reverse().find((message) => message.role === 'user')
    if (!lastUser) throw createError(400, 'INVALID_MESSAGES', '缺少 user 消息')
    // 2026-08-18 rebuild 优化（用户反馈：刷新/重发消息会像第一条消息一样重跑
    // 整个上下文 + 重新执行开场 skill（读记忆/存快照等），一次多花上万 tokens）：
    // 旧实现：disposeWebosSessions 删除会话与 JSONL 文件 → 全新 session 重新加载
    //   skills 并重新执行开场流程，且 historyContext 把整段历史文本重放一遍 =
    //   「上下文没有损失但事实上跑了两遍」。
    // 新实现（会话存活时）：**不销毁会话、不重放历史**——复用当前内存会话上下文，
    //   AI 能看到之前已经执行过开场（读记忆/快照等记录都在上下文里），不会重复
    //   执行；token 消耗回到普通消息水平（几百 tokens 而非上万）。
    // 兜底（会话丢失，如服务重启/超时清理）：仍回退 historyContext 重放，避免
    //   AI 完全失忆；但同样不再 dispose（本来就没有会话可清）。
    const { hasWebosSession } = await loadPiBridge()
    const sessionAlive = rebuild && hasWebosSession(principal.key, conversationId)
    const timePrefix = beijingTimePrefix()
    const rebuildNotice = rebuild && sessionAlive
      ? '（系统提醒：用户修改了此前的消息或要求重新生成。请忽略你之前对应的旧回复，直接针对下面这条最新消息重新作答。本会话开场的初始化（读记忆/存快照等一次性动作）已完成，无需重复执行。）\n\n'
      : ''
    const historyContext = rebuild && !sessionAlive ? formatHistoryContext(messages.slice(0, -1)) : ''
    const userText = appId
      ? `${timePrefix}\n\n（当前 App 上下文：appId=${appId}，sourceVersionId=${sourceVersionId ?? 'none'}）\n${rebuildNotice}${historyContext ? `${historyContext}\n\n` : ''}${lastUser.content}`
      : `${timePrefix}\n\n${rebuildNotice}${historyContext ? `${historyContext}\n\n` : ''}${lastUser.content}`

    // 2026-08-14 M3 视觉桥接（AI 的眼睛）：DeepSeek 非视觉。用户消息里带
    // 图片/视频引用时，自动调 MiniMax-M3 生成文字描述注入 userText，让 AI
    // 感知媒体内容；用量与成本落 webos_vision_usage（管理后台实时查看）。
    // 失败静默降级（不影响对话主流程）；未配置 MINIMAX_API_KEY 时跳过。
    const bridged = await bridgeVisionIntoText(principal, userText, {
      requestId,
      conversationId,
      ip: req.ip,
    })
    const finalUserText = bridged.text

    // pi agent 会话：按 principal + conversationId 复用（同一会话连续对话共享
    // 上下文与记忆；不同会话独立上下文，可并行工作），并注入 App 工具集 + 工作区
    // 文件系统工具，让 pi agent 在对话中直接创建/修改 App（文件夹即 App 路径）。
    const { createWebosSession, disposeWebosSessions, abortWebosSessions } = await loadPiBridge()
    if (rebuild) {
      // 2026-08-18 不再 dispose：保留会话上下文，避免刷新/重发消息重复执行
      // 开场 skill 与重放完整历史（用户实测：刷新一次多花上万 tokens）。
      // 会话存活→直接复用；会话丢失→historyContext 重放兜底（见上方 userText 构造）。
      // 旧逻辑 `disposeWebosSessions` 已挪到真正需要清空会话的错误恢复路径。
      tlog(`chat rebuild conv=${conversationId} scope=${principal.key} sessionAlive=${sessionAlive} (keep/history fallback)`)
    }
    // 2026-08-11 架构统一：任务缓冲 key（scope:convId:thinking）——活跃连接登记/
    // 事件转发/结束信号统一用它（声明提前，供 setupSse 后登记活跃连接使用）
    const tKey = `webos:${principal.key}:${conversationId}:${thinking}`
    // 2026-08-10 性能优化：先发 SSE 头 + start 事件，再创建 pi 会话。
    // 此前 createWebosSession（首次加载 pi-coding-agent + 扫描 skills，实测 18s）
    // 期间前端收不到任何字节 → 移动网络/45s 超时误判断流 → 自动重试 →
    // 同一条消息被处理两次。SSE 提前后前端立即收到 start（receivedAny=true），
    // 45s 超时不再误杀；用户也立即看到"正在思考"而非白屏。
    setupSse(res)
    // 2026-08-06 SSE 心跳保活：长任务（大 HTML 生成/工具执行/busy 排队）期间
    // 每 15s 发送保活事件——防止移动网络/代理对长时间无数据的连接超时断开
    // （否则前端表现为"network error"，而任务其实在服务端后台正常跑）。
    const heartbeat = setInterval(() => {
      if (res.writableEnded) return
      try {
        res.write(`data: ${JSON.stringify({ type: 'keep_alive' })}\n\n`)
      } catch { /* 连接已断：忽略 */ }
    }, 15_000)
    writeSse(res, {
      type: 'start',
      requestId,
      config: { model, thinking },
      estimate: {
        balanceMinor: state.balanceMinor,
        estimatedMinor: estimate,
        currency: 'CNY',
        model,
        thinking,
        peak: isDeepSeekPeak(),
        credits: { remaining: remainingCredits(state), estimated: estimate },
      },
    })
    // 2026-08-10 事件级明细：SSE start 事件发出的绝对时间（首事件延迟基准）
    tlog(`chat sse start scope=${principal.key} req=${requestId.slice(0, 8)} conv=${conversationId} thinking=${thinking}`)
    // 2026-08-11 架构统一：登记「活跃 SSE 连接」——本请求在线时事件转发到本 res；
    // 断连后由 resume 请求接管（重放缓冲 + 切换转发目标），本请求后台继续跑。
    activeSseByTask.set(tKey, { res })
    let session: Awaited<ReturnType<typeof createWebosSession>>
    try {
      session = await createWebosSession(principal.key, thinkingToPi(thinking), {
        // 2026-08-06 搜索工具注入 webOS 会话（此前只在画布会话可用，webOS AI 搜不了网）
        // 2026-08-21（W2）动态 App API 工具：appapi_<ns>_<ep>
        customTools: [...(await webosAppTools(principal)), ...searchTools],
        conversationId,
      })
    } catch (error) {
      // SSE 头已发送，无法返回 JSON 错误——发 SSE error 事件并关闭
      twarn(`chat session create failed scope=${principal.key} conv=${conversationId} err=${error instanceof Error ? error.message : String(error)}`)
      clearChatInFlight(inflightKey, 'session-create-failed')
      try {
        if (!res.writableEnded) {
          writeSse(res, { type: 'error', code: 'WEBOS_SESSION_CREATE_FAILED', message: 'AI 会话创建失败，请重试' })
          res.end()
        }
      } catch { /* ignore */ }
      clearInterval(heartbeat)
      return
    }

  // 会话按 principal+thinking 复用；若上一个请求的 prompt 尚未结束
  // （如超时中断后仍在后台运行/客户端断连后立即重连），pi 会拒绝并发 prompt。
  // 此时排队等待同一会话（不 dispose，保留上下文），最多 180s。
  let busyRetried = 0
  /** 暂时性 AI 错误原文（503/429 等；非空表示本次失败但会话上下文已保留） */
  let transientError: string | null = null
  /** 2026-08-06：是否处于「排队等待后台任务」——期间 pi 事件属于上一条任务，
   *  转发为 background_progress（前端实时展示处理过程），不当作本次回复 */
  let waitingForBackground = false
  /** 2026-08-06 修复：subscribe 每轮迭代重新注册，旧订阅必须退订（否则事件多路转发） */
  let unsubscribe: (() => void) | null = null
  /** 后台任务缓冲读取游标（本请求已读取的事件数） */
  let bgCursor = 0
  /** 2026-08-11 修复：请求级空闲活动计时（per-request）——subscribe 回调刷新它，
   *  runPiPrompt 只检查它；多会话并行时互不干扰（此前模块级全局变量会被其他
   *  会话的活动刷新，导致本请求卡住时永不触发 180s 空闲超时）。 */
  const activity: PiActivity = { last: Date.now() }
  /** 2026-08-06 修复：disconnected 提到循环外——断连状态跨迭代保持
   *  （此前每次迭代重置为 false，断连后进入下一轮会误以为还在线，
   *   继续等待/重试甚至执行自己的 prompt）。 */
  let disconnected = false
  // 2026-08-08 结构性优化：SSE delta 合并推送（120ms 窗口）。
  // DeepSeek medium/high 档思考产生海量 thinking_delta 碎片（实测一条消息
  // 可达 2 万+ 次 message_update），若逐条转发，前端每事件全量渲染+持久化，
  // 移动端 WebView 直接卡退。按 120ms 窗口合并同类型增量后推送，
  // 事件数可降一个数量级，内容与顺序不变（前端按事件拼接，合并等价）。
  let pendingDelta: { kind: 'thinking' | 'delta'; content: string } | null = null
  let deltaFlushTimer: ReturnType<typeof setTimeout> | null = null
  const flushDelta = (): void => {
    deltaFlushTimer = null
    if (!pendingDelta) return
    const out = pendingDelta
    pendingDelta = null
    // 2026-08-11 粒度修正：合并后的增量写入任务缓冲（与 SSE 转发逐条对应，
    // 断连也写——后台任务过程完整可恢复）。tool 事件由 subscribe 回调经
    // appendTaskEvent 原样写入，事件顺序 = 前端收到的顺序。
    appendTaskEvent(tKey, out, inflightLastUser)
    // 2026-08-11 架构统一：转发到「活跃连接」（在线=本 res；断连后=resume 接管）
    sseWrite(tKey, { type: out.kind, content: out.content })
  }
  const pushDelta = (kind: 'thinking' | 'delta', content: string): void => {
    if (!content) return
    if (pendingDelta && pendingDelta.kind === kind) {
      // 同类型增量直接累积（内容上限防御：单事件不超过 4KB，防止极端单段）
      const next = pendingDelta.content + content
      pendingDelta.content = next.length > 4096 ? content : next
      if (next.length > 4096) flushDelta()
    } else {
      if (pendingDelta) flushDelta()
      pendingDelta = { kind, content }
    }
    if (!deltaFlushTimer) {
      deltaFlushTimer = setTimeout(flushDelta, 120)
      deltaFlushTimer.unref?.()
    }
  }
  // 2026-08-11 工具参数生成实时进度（所有工具通用）：DeepSeek 流式生成工具
  // 参数（如创建 App 的完整 HTML、生图 prompt、文件内容等）时推送
  // toolcall_start/toolcall_delta 事件，此前完全被忽略 → AI 生成大段参数期间
  // 前端零进度（用户反馈"不知道 AI 在干什么"）。现在捕获参数增量，合并后
  // 转发为 tool_update「正在生成参数（工具名）…已生成 N 字符」实时展示，
  // 并写入任务缓冲（断连/刷新恢复同样可见）。
  let pendingToolcall: { tool: string; chars: number; started: boolean } | null = null
  let toolcallFlushTimer: ReturnType<typeof setTimeout> | null = null
  const flushToolcall = (): void => {
    toolcallFlushTimer = null
    if (!pendingToolcall) return
    const out = pendingToolcall
    pendingToolcall = null
    // 2026-08-11 进度内容为**纯数字字符数**：前端工具段渲染为跳动的
    // 「↓ N」；参数生成完成（tool_execution_start）时清除数字、显示工具名。
    const progress = String(out.chars)
    appendTaskEvent(tKey, { kind: 'tool_update', tool: out.tool, content: progress }, inflightLastUser)
    // 2026-08-11 架构统一：转发到「活跃连接」（在线=本 res；断连后=resume 接管）
    sseWrite(tKey, { type: 'tool_update', tool: out.tool, content: progress })
  }
  const flushToolcallNow = (): void => {
    if (toolcallFlushTimer !== null) {
      clearTimeout(toolcallFlushTimer)
      toolcallFlushTimer = null
    }
    flushToolcall()
  }
  const pushToolcall = (tool: string, deltaLen: number): void => {
    // 2026-08-11 时间线顺序修复：工具参数开始生成前先冲刷挂起的思考/文字增量——
    // 否则 tool_start 会插在思考段中间把连续思考切碎（上一轮"跳过中间工具段
    // 合并"的补丁就是为此而加，但它破坏了时间线顺序——多段思考被强行并成一段）。
    // 先冲刷后，思考段完整收尾、tool 段按真实顺序排在后面，无需前端特殊合并。
    if (!pendingToolcall && !toolcallFlushTimer) {
      flushDeltaNow()
    }
    if (!pendingToolcall) {
      pendingToolcall = { tool, chars: 0, started: false }
    } else if (tool) {
      pendingToolcall.tool = tool
    }
    // 参数开始生成时先让前端出现工具段（真实 tool_execution_start 到达时去重）
    if (pendingToolcall && !pendingToolcall.started && pendingToolcall.tool) {
      pendingToolcall.started = true
      sseWrite(tKey, { type: 'tool_start', tool: pendingToolcall.tool })
    }
    if (pendingToolcall) pendingToolcall.chars += deltaLen
    if (!toolcallFlushTimer) {
      toolcallFlushTimer = setTimeout(flushToolcall, 200)
      toolcallFlushTimer.unref?.()
    }
  }
  const flushDeltaNow = (): void => {
    if (deltaFlushTimer !== null) {
      clearTimeout(deltaFlushTimer)
      deltaFlushTimer = null
    }
    flushDelta()
  }
  // 2026-08-10 onClose 生命周期修复：断流（close）≠ 任务结束——任务仍在后台跑，
  // 在途标记必须保留，前端断流后查询 /chat/background 才能看到"服务端在跑"
  // （running=true）而放弃自动重试；标记只在任务真正结束路径（done/failed/catch/
  // 后台跑完/cancel）删除。注册移到 for 循环外，避免每次迭代重复注册监听器。
  const onClose = (): void => {
    // Express emits `close` after a normal `res.end()` as well.  Only abort
    // while the response is still open, and never charge an interrupted stream.
    if (!res.writableEnded) disconnected = true
    // 2026-08-08：清理合并推送 timer（防泄漏）
    if (deltaFlushTimer !== null) {
      clearTimeout(deltaFlushTimer)
      deltaFlushTimer = null
    }
    // 2026-08-11：清理工具参数生成进度 timer（防泄漏）
    if (toolcallFlushTimer !== null) {
      clearTimeout(toolcallFlushTimer)
      toolcallFlushTimer = null
    }
    // 2026-08-11 架构统一：断连时若「活跃连接」还是本请求，移除登记——
    // resume 请求重放缓冲后接管转发目标（本请求后台继续跑，事件照常写缓冲）。
    const activeNow = activeSseByTask.get(tKey)
    if (activeNow && activeNow.res === res) activeSseByTask.delete(tKey)
    tlog(`chat onClose scope=${principal.key} req=${requestId.slice(0, 8)} conv=${conversationId} ended=${res.writableEnded ? 'normal' : 'disconnected'} inflight=${chatInFlightActive(inflightKey) ? 'kept' : 'absent'}`)
    // 注意：断连不退订 subscribe——本请求的任务（若在后台继续跑）事件仍写入
    // 任务缓冲（activeTaskEvents），供后续 busy 排队请求读取后台过程。
  }
  res.once('close', onClose)

  for (;;) {
    // 2026-08-06：前端已断开（按停止/关闭页面）且本请求仍在排队等待后台任务——
    // 立即终止（后台任务由 cancelChat 的 abort 处理，或按既有行为继续跑完；
    // 本请求不再继续等待、也不再执行自己的 prompt）
    if (disconnected && (waitingForBackground || busyRetried > 0)) {
      try { unsubscribe?.(); unsubscribe = null } catch { /* ignore */ }
      tlog(`chat queued request terminated (client disconnected while waiting) scope=${principal.key} conv=${conversationId} req=${requestId.slice(0, 8)}`)
      // 2026-08-07 修复：断连终止时必须关闭 SSE 响应——否则 res 悬挂，
      // 前端 fetch 永远等不到结束（表现为卡片不消失/网络报错）。
      try { if (!res.writableEnded) res.end() } catch { /* ignore */ }
      return
    }
    let usage: TokenUsage | null = null
    let failed = false
    // 2026-08-22 部分输出截断标记：agent_end 异常但有可见输出时置真（不判失败），
    // done 事件携带 truncated:true，前端提示「内容可能不完整」而不显示错误
    let truncatedOutput = false
    // 2026-08-11 对话落库：保存 agent_end 的 messages，done/failed 时提取 AI 回复文本
    let lastAgentMessages: unknown = null
    const eventStats: Record<string, number> = {}
    // 2026-08-11 修复（幽灵空回复防御）：每次迭代重新获取会话——若会话在
    // busy 等待期间被 cancel/dispose（或 400 自愈 dispose），重试必须使用
    // 新会话；继续用已销毁的旧 session 调用 prompt 会立即空返回（无事件、
    // 无 usage），产生"done 0 tokens"的幽灵空回复（线上实证「？」请求）。
    // 缓存命中时 createWebosSession 直接返回同一实例（O(1)，零开销）。
    try {
      session = await createWebosSession(principal.key, thinkingToPi(thinking), {
        customTools: [...(await webosAppTools(principal)), ...searchTools],
        conversationId,
      })
    } catch (error) {
      // 会话创建失败：SSE 已发，发 error 事件终止（首次创建失败已在循环外处理）
      twarn(`chat session re-create failed scope=${principal.key} conv=${conversationId} err=${error instanceof Error ? error.message : String(error)}`)
      clearChatInFlight(inflightKey, 'session-recreate-failed')
      try {
        if (!res.writableEnded) {
          writeSse(res, { type: 'error', code: 'WEBOS_SESSION_CREATE_FAILED', message: 'AI 会话创建失败，请重试' })
          res.end()
        }
      } catch { /* ignore */ }
      return
    }
    try { unsubscribe?.(); unsubscribe = null } catch { /* ignore */ }
    let unsubscribeFn: (() => void) | null = null
    try {
      unsubscribeFn = session.subscribe((event) => {
      try {
        // 空闲超时：任何 pi 事件（LLM 增量/工具执行）都视为活动，刷新本请求计时
        markPiActivity(activity)
        // 2026-08-10 事件级明细：首个 pi 事件到达的绝对时间（首字延迟 = 此刻 - sse start）
        if (!eventStats[event.type] && eventStats['agent_start'] === undefined && eventStats['message_update'] === undefined) {
          tlog(`chat first pi event scope=${principal.key} req=${requestId.slice(0, 8)} conv=${conversationId} type=${event.type}`)
        }
        eventStats[event.type] = (eventStats[event.type] ?? 0) + 1
        // 排队等待中：事件属于上一条后台任务——不做任何转发（本订阅注册于任务
        // 运行中，pi 可能不向其广播；可靠通道是 busy 循环每 2s 读任务缓冲）
        if (waitingForBackground) {
          return
        }
        // 本请求自己的任务：用户可见事件写入任务缓冲（断连后仍持续记录，
        // 供后续 busy 排队请求读取后台过程）。缓冲惰性创建（appendTaskEvent）——
        // busy 等待迭代（等待别人的任务）不会误建/误清空，缓冲生命周期与
        // 「实际运行的任务」绑定。delta/thinking 由 flushDelta 合并写入。
        const ue = extractUserEvent(event)
        if (ue) appendTaskEvent(tKey, ue, inflightLastUser)
        if (event.type === 'message_update') {
          // pi-ai 层的 text_delta / thinking_delta 通过 assistantMessageEvent 暴露增量
          // 2026-08-11 架构统一（关键修复）：**去掉 disconnected 守卫**——断连后
          // thinking/delta 必须照常进缓冲（flushDelta 内 appendTaskEvent 无条件写，
          // sseWrite 只写活跃连接：在线=本 res，断连后=resume 接管）。此前守卫
          // 导致断连后 AI 新增的思考/文字不进缓冲 → 刷新恢复只重放刷新前部分，
          // 而工具事件无守卫照常记录 → 表现为"刷新后只有工具结果渲染，
          // 思考/文字全不显示"（用户反复反馈的核心问题，至此根除）。
          const assistantEvent = (event as { assistantMessageEvent?: { type?: string; delta?: unknown; partial?: unknown } }).assistantMessageEvent
          if (assistantEvent?.type === 'text_delta' && typeof assistantEvent.delta === 'string' && assistantEvent.delta) {
            pushDelta('delta', assistantEvent.delta)
          } else if (assistantEvent?.type === 'thinking_delta' && typeof assistantEvent.delta === 'string' && assistantEvent.delta) {
            pushDelta('thinking', assistantEvent.delta)
          } else if (assistantEvent?.type === 'toolcall_start' || assistantEvent?.type === 'toolcall_delta') {
            // 2026-08-11 工具参数生成实时进度（所有工具通用）：DeepSeek 生成
            // 工具参数（HTML/prompt/文件内容等大段内容）时推送 toolcall 事件，
            // 捕获增量并合并转发为 tool_update（"正在生成参数…已生成 N字符"）。
            // partial 里的 toolCall block.name 提供工具名。
            const tool = extractToolNameFromPartial(assistantEvent.partial)
            const deltaLen = typeof assistantEvent.delta === 'string' ? assistantEvent.delta.length : 0
            pushToolcall(tool, deltaLen)
          }
        } else if (event.type === 'tool_execution_start') {
          // 工具调用开始：冲刷挂起的参数生成进度（避免进度停在旧值），
          // 转发给前端展示"正在调用工具"
          flushToolcallNow()
          const toolEvent = event as { toolName?: string }
          if (typeof toolEvent.toolName === 'string') {
            sseWrite(tKey, { type: 'tool_start', tool: toolEvent.toolName })
          }
        } else if (event.type === 'tool_execution_update') {
          // 2026-08-07 工具执行过程增量：pi 工具 onUpdate 输出的实时进度文本
          // （生图/批量处理/grep 等长工具执行期间逐段转发，前端在工具 chip 下展示）
          const toolEvent = event as { toolName?: string; partialResult?: { content?: Array<{ type?: string; text?: string }> } }
          if (typeof toolEvent.toolName === 'string') {
            const content = toolEvent.partialResult?.content
            if (Array.isArray(content)) {
              const text = content.map((part) => (part.type === 'text' && typeof part.text === 'string' ? part.text : '')).join('').trim()
              if (text) sseWrite(tKey, { type: 'tool_update', tool: toolEvent.toolName, content: text })
            }
          }
        } else if (event.type === 'agent_end') {
        usage = lastAssistantUsage((event as { messages?: unknown }).messages)
        lastAgentMessages = (event as { messages?: unknown }).messages ?? null
        try {
          const msgs = (event as unknown as { messages?: Array<Record<string, unknown>> }).messages
          const last = msgs?.[msgs.length - 1]
          if (last) {
            tlog(`agent_end scope=${principal.key} req=${requestId.slice(0, 8)} conv=${conversationId} role=${String(last.role)} contentLen=${JSON.stringify(last.content ?? '').length} stop=${String(last.stopReason ?? 'n/a')} err=${String(last.errorMessage ?? '')?.slice(0, 200)} usage=${JSON.stringify(last.usage ?? null)}`)
            // 防御：provider 错误（如 DeepSeek 400「tool 消息无 tool_calls」）会生成
            // 空 assistant 消息并污染会话历史，导致该会话此后每次请求都失败。
            // 检测到 stop=error 或 usage 全 0 时，dispose 该用户全部 webOS 会话，
            // 下次请求自动重建干净会话；同时标记本次请求失败（不扣费、不发 done）。
            const lastRole = typeof last.role === 'string' ? last.role : ''
            const lastStop = typeof last.stopReason === 'string' ? last.stopReason : ''
            const lastUsage = last.usage as { input?: number; output?: number } | null | undefined
            const zeroUsage = (!lastUsage) || (Number(lastUsage.input ?? 0) === 0 && Number(lastUsage.output ?? 0) === 0)
            const emptyContent = !last.content || (Array.isArray(last.content) ? last.content.length === 0 : String(last.content).trim().length === 0)
            if (lastRole === 'assistant' && (lastStop === 'error' || (zeroUsage && emptyContent))) {
              // 2026-08-22 修复（部分输出被误判失败）：DeepSeek/pi 在工具执行中途
              // 中断（agent_fs_write 大量写入/参数过长/上下文溢出）时，agent_end 的
              // 最后一条 assistant 消息 content 可能为空/usage 为 0，但此前已通过
              // message_update 输出了大量 thinking/tool 进度/部分 delta。此时若整轮
              // 判 failed，前端表现为「输出到一半卡住 → 服务端发 error/done → UI
              // 显示已结束但内容不全」。因此：**只要本轮已产生过任何用户可见事件
              // （thinking/delta/tool），就不判空失败**——保留已输出内容，正常结束
              // （不扣费逻辑仍由 usage/正常 done 路径处理），并把「可能被截断」的
              // 提示附在 done 里，前端据此展示。
              const hasAnyVisibleOutput = Object.keys(eventStats).some((k) =>
                k !== 'agent_start' && k !== 'agent_end' && k !== 'turn_start' && k !== 'turn_end' && k !== 'message_start' && k !== 'message_end',
              )
              if (!hasAnyVisibleOutput) {
                failed = true
                const rawErr = String(last.errorMessage ?? '')
                // 暂时性错误（DeepSeek 503 繁忙 / 429 限流）：保留会话上下文，
                // 用户重试时能接着之前的对话继续，不丢记忆；仅标记本次失败。
                const transient = /503|too busy|overload|capacity|429|rate\s*limit|temporar|繁忙|限流/i.test(rawErr)
                if (transient) {
                  console.warn(`[webos] agent_end transient error (${rawErr.slice(0, 160)}), KEEPING session for ${principal.key.slice(0, 12)}`)
                  transientError = rawErr
                } else {
                  console.warn(`[webos] agent_end failed (stop=${lastStop} err=${rawErr.slice(0, 160)}), disposing sessions for ${principal.key.slice(0, 12)}`)
                  try {
                    disposeWebosSessions(principal.key, conversationId)
                  } catch { /* ignore */ }
                }
              } else {
                // 有可见输出但 agent_end 异常：标记"可能截断"（不判失败），
                // done 事件携带 truncated 提示，前端渲染时告知用户内容可能不完整
                console.warn(`[webos] agent_end abnormal but has visible output (stop=${lastStop} err=${String(last.errorMessage ?? '').slice(0, 120)}), keeping output, mark truncated (${principal.key.slice(0, 12)})`)
                truncatedOutput = true
              }
            }
          }
        } catch (error) {
          console.warn('[webos] agent_end inspect failed:', error instanceof Error ? error.message : String(error))
        }
        // 2026-08-06 本请求任务结束：退订 pi 事件（防止残留订阅在下次任务开始时
        // 双写缓冲）；任务缓冲标记 endedAt（保留供前端查询，下次任务覆盖）。
        try { unsubscribe?.(); unsubscribe = null } catch { /* ignore */ }
        // 2026-08-11 粒度修正：结束前冲刷合并增量（否则缓冲缺尾段，恢复丢内容）
        flushDeltaNow()
        flushToolcallNow()
        const endedRec = activeTaskEvents.get(tKey)
        if (endedRec) endedRec.endedAt = Date.now()
} else if (event.type === 'tool_execution_end') {
          // 工具执行结束：转发 tool_end；创建/修改 App 时把结果转发为 app_created/app_updated；
          // 生图成功时把图片 URL 一并转发（前端在工具下方展示图片，可点开/下载）
          const toolEvent = event as { toolName?: string; result?: unknown; isError?: boolean }
          const toolName = toolEvent.toolName
          let toolImages: string[] | undefined
          let toolVideos: string[] | undefined
          if (toolName === 'generate_image' && !toolEvent.isError) {
            try {
              const result = toolEvent.result as { content?: Array<{ type?: string; text?: string }> } | undefined
              const text = result?.content?.find((part) => part.type === 'text')?.text
              if (text) {
                const payload = JSON.parse(text) as { success?: boolean; files?: Array<{ url?: string }> }
                if (payload.success && Array.isArray(payload.files)) {
                  toolImages = payload.files.map((file) => file.url ?? '').filter(Boolean)
                }
              }
            } catch { /* 解析失败不阻断 */ }
          }
          // 2026-08-05 视频生成成功：把视频 URL 转发为 tool_end.videos（前端在工具下方渲染 <video>）
          if (toolName === 'generate_video' && !toolEvent.isError) {
            try {
              const result = toolEvent.result as { content?: Array<{ type?: string; text?: string }> } | undefined
              const text = result?.content?.find((part) => part.type === 'text')?.text
              if (text) {
                const payload = JSON.parse(text) as { success?: boolean; files?: Array<{ url?: string }> }
                if (payload.success && Array.isArray(payload.files)) {
                  toolVideos = payload.files.map((file) => file.url ?? '').filter(Boolean)
                }
              }
            } catch { /* 解析失败不阻断 */ }
          }
          if (typeof toolName === 'string') {
            sseWrite(tKey, {
              type: 'tool_end',
              tool: toolName,
              ok: !toolEvent.isError,
              ...(toolImages && toolImages.length > 0 ? { images: toolImages } : {}),
              ...(toolVideos && toolVideos.length > 0 ? { videos: toolVideos } : {}),
            })
          }
          // 2026-08-14 消费 agent_fs_* 钩子登记的 app_created/app_updated 事件
          // （文件夹即 App：mkdir/写入 index.html 由钩子注册，此处统一推送）。
          // 提前到所有工具分支之前：任何工具结束都可能触发（不限于 update_webos_app）。
          const pendingAppEvts = drainPendingAppEvents(tKey)
          if (pendingAppEvts.length > 0) {
            for (const pev of pendingAppEvts) {
              appendTaskEvent(tKey, { kind: pev.type, content: pev.appId, tool: toolName ?? '' }, inflightLastUser)
              sseWrite(tKey, { type: pev.type, appId: pev.appId })
            }
          }
          if (toolName !== 'update_webos_app') {
            // 对话内互动 HTML：校验通过后把组件转发给前端渲染（sandbox iframe）
            if (toolName === 'show_interactive_html' && !toolEvent.isError) {
              try {
                const result = toolEvent.result as { content?: Array<{ type?: string; text?: string }> } | undefined
                const text = result?.content?.find((part) => part.type === 'text')?.text
                if (text) {
                  const payload = JSON.parse(text) as { success?: boolean; html?: string; heightPx?: number }
                  if (payload.success && payload.html) {
                    // 2026-08-11：互动 HTML 写入任务缓冲（刷新/断连恢复也能渲染——
                    // 此前只 writeSse，刷新后 HTML 丢失）
                    appendTaskEvent(tKey, { kind: 'html', content: payload.html, heightPx: payload.heightPx ?? 280 }, inflightLastUser)
                    sseWrite(tKey, { type: 'interactive_html', html: payload.html, heightPx: payload.heightPx ?? 280 })
                  }
                }
              } catch (error) {
                console.warn('[webos] interactive_html event parse failed:', error instanceof Error ? error.message : String(error))
              }
            }
            return
          }
          try {
            const result = toolEvent.result as { content?: Array<{ type?: string; text?: string }> } | undefined
            const text = result?.content?.find((part) => part.type === 'text')?.text
            if (!text) return
            const payload = JSON.parse(text) as { success?: boolean; appId?: string }
            if (payload.success && payload.appId) {
              // 2026-08-11 架构统一：App 更新结果写入任务缓冲——断连/刷新
            // 恢复时前端也能收到 app_updated 并刷新桌面（此前只 sseWrite，
            // 刷新后 App 更新成功但桌面看不到变化）。
            appendTaskEvent(tKey, { kind: 'app_updated', content: payload.appId, tool: toolName }, inflightLastUser)
            sseWrite(tKey, { type: 'app_updated', appId: payload.appId })
          }
        } catch (error) {
          console.warn('[webos] app_created event parse failed:', error instanceof Error ? error.message : String(error))
        }
      }
      } catch (error) {
        console.warn('[webos] pi event forward failed:', error instanceof Error ? error.message : String(error))
      }
    })
    } catch (error) {
      console.warn('[webos] subscribe failed:', error instanceof Error ? error.message : String(error))
    }
    unsubscribe = typeof unsubscribeFn === 'function' ? unsubscribeFn : null
    // 2026-08-10 onClose 已移到 for 循环外（见上方定义 + res.once 注册）——
    // 此处不再重复定义/注册，避免每次迭代叠加监听器。

    try {
      // 本次 prompt 真正开始：退出「等待后台任务」模式（此后事件属于本次回复）。
      // 任务事件缓冲由首个用户可见事件惰性创建（busy 等待迭代不会误清空别人
      // 正在运行的任务缓冲——此前在迭代开头重置导致缓冲被反复清空，进度丢失）。
      waitingForBackground = false
      tlog(`chat prompt start scope=${principal.key} req=${requestId.slice(0, 8)} conv=${conversationId} thinking=${thinking} userTextLen=${finalUserText.length} vision=${bridged.injected ? 'yes' : 'no'}`)
      await runPiPrompt(session, finalUserText, PI_PROMPT_TIMEOUT_MS, activity)
      tlog(`chat prompt done scope=${principal.key} req=${requestId.slice(0, 8)} conv=${conversationId} usage=${JSON.stringify(usage)} disconnected=${disconnected} events=${JSON.stringify(eventStats)}`)
      if (disconnected) {
        // 后台运行（2026-08-02）：客户端已断开（关浏览器/切页），但 prompt 已在服务端跑完——
        // 照常按真实 usage 扣积分并落库（任务确实执行了），pi 会话上下文保留，用户回来可继续对话。
        const bgUsage = usageTokens(usage)
        const bgTotal = bgUsage.promptTokens + bgUsage.completionTokens
        let bgActual = 0
        if (bgTotal > 0 || !failed) {
          // 积分计费：按 DeepSeek 真实 usage × 定价（含高峰 ×2）；无 usage 时按估算积分回退
          const bgCostMinor = bgTotal > 0
            ? chatCostMinor({ promptTokens: bgUsage.promptTokens, completionTokens: bgUsage.completionTokens })
            : estimate
          const actual = chargeCredits(state, bgCostMinor)
          bgActual = actual
          await saveState(principal, state)
          await recordAiUsage(principal, state, {
            model, thinking,
            promptTokens: bgUsage.promptTokens,
            completionTokens: bgUsage.completionTokens,
            costMinor: bgCostMinor,
            status: failed ? 'empty_response' : 'ok',
            errorCode: failed ? 'WEBOS_AI_EMPTY_RESPONSE' : undefined,
            ip: req.ip,
          })
          // 2026-08-11 对话内容落库：断连后台任务也记录（用户消息 + 回复）
          await recordChatLog(principal, {
            conversationId, requestId, role: 'user',
            content: lastUser.content, thinking, rebuild,
            status: failed ? 'empty_response' : 'ok',
            errorCode: failed ? 'WEBOS_AI_EMPTY_RESPONSE' : undefined,
            promptTokens: bgUsage.promptTokens, completionTokens: bgUsage.completionTokens, costMinor: bgCostMinor, ip: req.ip,
          })
          const bgReply = assistantText(lastAgentMessages)
          if (bgReply) {
            await recordChatLog(principal, {
              conversationId, requestId, role: 'assistant',
              content: bgReply, thinking, rebuild,
              status: failed ? 'empty_response' : 'ok',
              errorCode: failed ? 'WEBOS_AI_EMPTY_RESPONSE' : undefined,
              promptTokens: bgUsage.promptTokens, completionTokens: bgUsage.completionTokens, costMinor: bgCostMinor, ip: req.ip,
            })
          }
          tlog(`background task finished (client disconnected): scope=${principal.key} req=${requestId.slice(0, 8)} conv=${conversationId} charged=${actual} credits, status=${failed ? 'empty_response' : 'ok'}`)
          // 2026-08-13 统一对话 log：断连后台任务也落库完整事件序列
          await recordChatSessionLog(principal, {
            conversationId, requestId, thinking, rebuild,
            status: failed ? 'empty_response' : 'ok',
            errorCode: failed ? 'WEBOS_AI_EMPTY_RESPONSE' : undefined,
            promptTokens: bgUsage.promptTokens, completionTokens: bgUsage.completionTokens, costMinor: bgCostMinor, ip: req.ip,
            requestKey: tKey,
          })
        }
        // 2026-08-10：任务已跑完（断流后台任务也结束）→ 清理在途标记
        clearChatInFlight(inflightKey, 'bg-finished')
        // 2026-08-11 防御第二道：断连后台任务成功完成也登记最近完成——
        // 用户回来后若残留事件重发同一条消息，5s 窗口内会被 409 拦截
        if (!failed) markChatRecentDone(inflightKey, inflightLastUser)
        // 2026-08-11 架构统一：任务在后台跑完——把 done/error 发给「活跃连接」
        // （resume 接管后的连接），前端据此结束流式状态并恢复发送框。
        if (!failed) {
          finishTaskStream(tKey, {
            type: 'done',
            usage: {
              estimatedMinor: estimate,
              actualMinor: bgActual,
              model,
              thinking,
              peak: isDeepSeekPeak(),
              totalTokens: bgTotal,
              usedCredits: Math.round(state.credits.used),
              remainingCredits: remainingCredits(state),
            },
            ...(truncatedOutput ? { truncated: true } : {}),
          })
        } else {
          finishTaskStream(tKey, { type: 'error', code: 'WEBOS_AI_EMPTY_RESPONSE', message: 'AI 响应失败，请重发一次（本会话上下文已保留，不会丢失）。' })
        }
        return
      }
      if (failed) {
        // AI 回复失败：暂时性错误（503/429）保留会话上下文不 dispose，非暂时性
        // 错误（如 provider 400）已 dispose；都不扣 token、不发 done；落库失败记录
        const failedUsage = usageTokens(usage)
        const isTransient = transientError !== null
        await recordAiUsage(principal, state, {
          model, thinking,
          promptTokens: failedUsage.promptTokens,
          completionTokens: failedUsage.completionTokens,
          costMinor: 0,
          status: 'empty_response',
          errorCode: isTransient ? 'WEBOS_AI_BUSY' : 'WEBOS_AI_EMPTY_RESPONSE',
          ip: req.ip,
        })
        // 2026-08-11 对话内容落库：失败也记录用户消息（含错误码，便于排查）
        await recordChatLog(principal, {
          conversationId, requestId, role: 'user',
          content: lastUser.content, thinking, rebuild,
          status: 'empty_response',
          errorCode: isTransient ? 'WEBOS_AI_BUSY' : 'WEBOS_AI_EMPTY_RESPONSE',
          promptTokens: failedUsage.promptTokens, completionTokens: failedUsage.completionTokens, costMinor: 0, ip: req.ip,
        })
        // 2026-08-13 统一对话 log：失败也落库完整事件序列（含 reasoning，排查根因）
        await recordChatSessionLog(principal, {
          conversationId, requestId, thinking, rebuild,
          status: 'empty_response',
          errorCode: isTransient ? 'WEBOS_AI_BUSY' : 'WEBOS_AI_EMPTY_RESPONSE',
          promptTokens: failedUsage.promptTokens, completionTokens: failedUsage.completionTokens, costMinor: 0, ip: req.ip,
          requestKey: tKey,
        })
        // 2026-08-10：任务失败结束 → 清理在途标记
        clearChatInFlight(inflightKey, 'failed')
        // 2026-08-11 架构统一：结束信号发给「活跃连接」（在线=本 res；断连后=resume）
        finishTaskStream(tKey, {
          type: 'error',
          code: isTransient ? 'WEBOS_AI_BUSY' : 'WEBOS_AI_EMPTY_RESPONSE',
          message: isTransient
            ? `AI 服务暂时繁忙（${String(transientError ?? '503 Service is too busy').slice(0, 80)}）。请稍后重发一次；本会话上下文已保留，之前的对话不会丢失。`
            : 'AI 响应失败，已自动重置会话，请重发一次',
        })
        if (!res.writableEnded) { try { res.end() } catch { /* ignore */ } }
        return
      }
      const doneUsage = usageTokens(usage)
      const totalTokens = doneUsage.promptTokens + doneUsage.completionTokens
      // 2026-08-11 幽灵空回复防御：prompt 正常返回但**没有任何 pi 事件、没有
      // usage、也没有回复文本**（典型场景：会话被 dispose 后旧 session 空返回——
      // 已通过每次迭代重取会话修复，此处为最后防线）。此时不能发假 done（前端
      // 收到 0 tokens 空回复，显示"连接中断"假象），按空响应错误处理，不扣费。
      if (totalTokens === 0 && Object.keys(eventStats).length === 0 && !assistantText(lastAgentMessages)) {
        tlog(`chat ghost empty done blocked scope=${principal.key} req=${requestId.slice(0, 8)} conv=${conversationId}`)
        clearChatInFlight(inflightKey, 'ghost-empty')
        await recordAiUsage(principal, state, {
          model, thinking,
          promptTokens: 0, completionTokens: 0, costMinor: 0,
          status: 'empty_response', errorCode: 'WEBOS_AI_EMPTY_RESPONSE', ip: req.ip,
        })
        await recordChatLog(principal, {
          conversationId, requestId, role: 'user',
          content: lastUser.content, thinking, rebuild,
          status: 'empty_response', errorCode: 'WEBOS_AI_EMPTY_RESPONSE',
          promptTokens: 0, completionTokens: 0, costMinor: 0, ip: req.ip,
        })
        // 2026-08-13 统一对话 log：空响应也落库（无事件时仅 user 消息）
        await recordChatSessionLog(principal, {
          conversationId, requestId, thinking, rebuild,
          status: 'empty_response', errorCode: 'WEBOS_AI_EMPTY_RESPONSE',
          promptTokens: 0, completionTokens: 0, costMinor: 0, ip: req.ip,
          requestKey: tKey,
        })
        // 2026-08-11 架构统一：结束信号发给「活跃连接」（在线=本 res；断连后=resume）
        finishTaskStream(tKey, { type: 'error', code: 'WEBOS_AI_EMPTY_RESPONSE', message: 'AI 响应为空，请重发一次（本会话上下文已保留，不会丢失）。' })
        if (!res.writableEnded) { try { res.end() } catch { /* ignore */ } }
        return
      }
      // 2026-08-02 积分计费：按 DeepSeek 真实 usage × 定价（含高峰 ×2）；无 usage 时按估算回退
      const doneCostMinor = totalTokens > 0
        ? chatCostMinor({ promptTokens: doneUsage.promptTokens, completionTokens: doneUsage.completionTokens })
        : estimate
      const actual = chargeCredits(state, doneCostMinor)
      await saveState(principal, state)
      await recordAiUsage(principal, state, {
        model, thinking,
        promptTokens: doneUsage.promptTokens,
        completionTokens: doneUsage.completionTokens,
        costMinor: doneCostMinor,
        status: 'ok', ip: req.ip,
      })
      // 2026-08-11 对话内容落库（查 bug 必须看对话记录）：
      // user 消息（取最后一条，与发给 pi 的 userText 对齐）+ assistant 回复（agent_end 最后一条）
      await recordChatLog(principal, {
        conversationId, requestId, role: 'user',
        content: lastUser.content, thinking, rebuild,
        status: 'ok', promptTokens: doneUsage.promptTokens, completionTokens: doneUsage.completionTokens, costMinor: doneCostMinor, ip: req.ip,
      })
      const assistantReply = assistantText(lastAgentMessages)
      if (assistantReply) {
        await recordChatLog(principal, {
          conversationId, requestId, role: 'assistant',
          content: assistantReply, thinking, rebuild,
          status: 'ok', promptTokens: doneUsage.promptTokens, completionTokens: doneUsage.completionTokens, costMinor: doneCostMinor, ip: req.ip,
        })
      }
      // 2026-08-13 统一对话 log：完整事件序列（含 reasoning/工具调用）落库
      await recordChatSessionLog(principal, {
        conversationId, requestId, thinking, rebuild,
        status: 'ok',
        promptTokens: doneUsage.promptTokens, completionTokens: doneUsage.completionTokens, costMinor: doneCostMinor, ip: req.ip,
        requestKey: tKey,
      })
      // 2026-08-08：done 前冲刷未推送的合并 delta（否则最后一段思考/回复丢失）
      flushDeltaNow()
      // 2026-08-10 事件级明细：done 发出前记录绝对时间 + 清理在途标记
      tlog(`chat done sent scope=${principal.key} req=${requestId.slice(0, 8)} conv=${conversationId} totalTokens=${totalTokens} cost=${doneCostMinor}`)
      clearChatInFlight(inflightKey, 'done')
      // 2026-08-11 防御第二道：登记最近完成（同内容 5s 内再到达 → 409 CHAT_DUPLICATE_RECENT）
      markChatRecentDone(inflightKey, inflightLastUser)
      // 2026-08-11 架构统一：done 发给「活跃连接」（在线=本 res；断连后=resume 接管）
      finishTaskStream(tKey, {
        type: 'done',
        usage: {
          estimatedMinor: estimate,
          actualMinor: actual,
          model,
          thinking,
          peak: isDeepSeekPeak(),
          totalTokens,
          usedCredits: Math.round(state.credits.used),
          remainingCredits: remainingCredits(state),
        },
        // 2026-08-22 部分输出截断提示：agent_end 异常但保留了可见输出时
        // 标记 truncated，前端据此展示「内容可能不完整」而非正常完成
        ...(truncatedOutput ? { truncated: true } : {}),
      })
      if (!res.writableEnded) { try { res.end() } catch { /* ignore */ } }
      return
    } catch (error) {
      const busy = error && typeof error === 'object' && 'message' in error
        && /already processing/i.test(String((error as { message: unknown }).message))
      if (busy && !disconnected) {
        // 2026-08-04 忙重试不再 dispose（dispose = 清空会话上下文！）：
        // 上一个 prompt（可能是刷新/断连中断后还在后台跑的）完成后自然轮到本次请求。
        // 2026-08-06 改为排队等待：每 2s 重试、推送 busy_waiting 事件给前端显示
        // 「等待中」而非报错；最多 90 次（180s，与任务超时一致）——任务最迟
        // 180s 结束，等待期间必然轮得到；超时仍忙才明确提示（上下文保留）。
        if (busyRetried >= 90) {
          twarn(`pi session still busy after 180s, giving up (context preserved) scope=${principal.key} conv=${conversationId}`)
          if (!res.writableEnded) {
            writeSse(res, { type: 'error', code: 'WEBOS_AI_BUSY', message: 'AI 仍在处理上一条消息（超过 3 分钟仍未完成），请稍后重试；本会话上下文已保留，不会丢失。' })
            res.end()
          }
          clearChatInFlight(inflightKey, 'busy-giveup')
          return
        }
        busyRetried += 1
        twarn(`pi session busy scope=${principal.key} req=${requestId.slice(0, 8)} conv=${conversationId} waiting=${busyRetried * 2}s queued without disposing`)
        // 进入等待模式：此后 pi 事件（后台任务）转发为 background_progress
        waitingForBackground = true
        if (!res.writableEnded) {
          // 前端显示等待提示（不弹错误），后台任务完成后自动继续
          writeSse(res, {
            type: 'busy_waiting',
            elapsed: busyRetried * 2,
            message: `AI 仍在处理上一条消息（可能是刷新前未完成的任务），正在等待完成…（已等待 ${busyRetried * 2}s）`,
          })
          // 读取后台任务事件缓冲增量，转发为实时进度（处理过程对用户可见）
          const taskRec = activeTaskEvents.get(tKey)
          if (taskRec && bgCursor < taskRec.events.length) {
            for (; bgCursor < taskRec.events.length; bgCursor += 1) {
              const bgEvent = taskRec.events[bgCursor]
              if (bgEvent) writeSse(res, { type: 'background_progress', event: bgEvent })
            }
          }
        }
        await new Promise((resolve) => setTimeout(resolve, 2000))
        continue
      }
      if (!disconnected && !res.writableEnded) {
        const message = error && typeof error === 'object' && 'message' in error
          ? String((error as { message: unknown }).message)
          : 'AI 请求失败，请稍后重试'
        const code = error && typeof error === 'object' && 'code' in error
          ? String((error as { code: unknown }).code)
          : 'WEBOS_AI_ERROR'
        // 2026-08-11 架构统一：error 发给「活跃连接」（在线=本 res；断连后=resume）
        finishTaskStream(tKey, { type: 'error', code, message })
        if (!res.writableEnded) { try { res.end() } catch { /* ignore */ } }
      }
      // 2026-08-04：空闲超时/暂时性中断（"已中断/无活动"）不 dispose——
      // pi 会话上下文保留，用户重试即可接着之前的对话继续；仅真正坏掉的
      // 会话（400 等）才 dispose 自愈。只清当前会话，并行会话不受影响。
      const interruptMessage = error && typeof error === 'object' && 'message' in error
        ? String((error as { message: unknown }).message)
        : ''
      const timeoutInterrupt = /已中断|无活动|abort|cancel/i.test(interruptMessage)
      if (!timeoutInterrupt) {
        try {
          disposeWebosSessions(principal.key, conversationId)
        } catch { /* ignore */ }
      } else {
        twarn(`idle timeout interrupt, keeping session context scope=${principal.key} conv=${conversationId}`)
      }
      // 2026-08-10：任务被中断结束 → 清理在途标记（保留会话上下文）
      clearChatInFlight(inflightKey, timeoutInterrupt ? 'idle-interrupt' : 'catch')
      // 2026-08-02：请求失败落库（管理后台可见失败率）
      const catchUsage = usageTokens(usage)
      await recordAiUsage(principal, state, {
        model, thinking,
        promptTokens: catchUsage.promptTokens,
        completionTokens: catchUsage.completionTokens,
        costMinor: 0,
        status: 'failed',
        errorCode: error && typeof error === 'object' && 'code' in error ? String((error as { code: unknown }).code) : undefined,
        ip: req.ip,
      })
      // 2026-08-11 对话内容落库：异常失败也记录用户消息（含错误码，便于排查）
      await recordChatLog(principal, {
        conversationId, requestId, role: 'user',
        content: lastUser.content, thinking, rebuild,
        status: 'failed',
        errorCode: error && typeof error === 'object' && 'code' in error ? String((error as { code: unknown }).code) : undefined,
        promptTokens: catchUsage.promptTokens, completionTokens: catchUsage.completionTokens, costMinor: 0, ip: req.ip,
      })
      // 2026-08-13 统一对话 log：异常失败也落库（含 reasoning/工具调用，排查中断根因）
      await recordChatSessionLog(principal, {
        conversationId, requestId, thinking, rebuild,
        status: 'failed',
        errorCode: error && typeof error === 'object' && 'code' in error ? String((error as { code: unknown }).code) : undefined,
        promptTokens: catchUsage.promptTokens, completionTokens: catchUsage.completionTokens, costMinor: 0, ip: req.ip,
        requestKey: tKey,
      })
      return
    } finally {
      // 2026-08-06 修复：subscribe 可能未成功（抛异常/返回非函数）——
      // unsubscribe 可能为 null；且退订异常不得阻断 res 正常关闭（否则
      // SSE 流悬空，前端永远等不到 done，表现为"AI 执行几步后卡住"）。
      try { unsubscribe?.() } catch { /* ignore */ }
      clearInterval(heartbeat)
      res.off('close', onClose)
    }
  }
  } catch (error) {
    next(error)
  }
})

webosRouter.post('/chat/cancel', async (req, res, next) => {
  try {
    const principal = requirePrincipal(req)
    const conversationId = typeof req.body?.conversationId === 'string' && req.body.conversationId
      ? String(req.body.conversationId).slice(0, 128)
      : 'default'
    const { abortWebosSessions } = await loadPiBridge()
    // 2026-08-08 修复「按停止不生效」：s.abort() 对 pi 只是「中止当前操作并等待 agent
    // 回到空闲」——AI 在思考/工具执行中 abort 基本无效，任务会在服务端继续跑完，
    // 表现为「按了停止，AI 还在后台跑，下次发消息提示任务在后台」。
    // 2026-08-11 修复「停止后上下文丢失」：**不再 disposeWebosSessions**——
    // dispose 会销毁 pi 会话（含全部对话历史），而下次请求（非 rebuild）服务端
    // 只把最后一条 user 消息发给 pi、不注入历史（/chat/cancel 旧注释声称"前端
    // 下次请求带完整历史重建，与 rebuild 语义一致"与实现不符），重建后的会话是
    // 空上下文 → AI 完全失忆（线上实证：做 App 任务中途点停止 → 会话被 dispose →
    // 下次提问 AI 不记得之前任何内容）。
    // 现在停止只 abort（LLM 生成阶段立即停）：任务缓冲清空（已取消的任务不再被
    // 前端恢复展示）；工具执行阶段 abort 无效时任务在后台继续收尾，但 pi 会话
    // 上下文始终保留——任务跑完后用户继续对话，AI 记得前面。
    let aborted = 0
    try { aborted = await abortWebosSessions(principal.key, conversationId) } catch { /* ignore */ }
    clearTaskBuffer(principal.key, conversationId)
    // 2026-08-10：用户取消 = 任务真正终止 → 清理该会话全部在途标记
    const inflightPrefix = `webos:${principal.key}:${conversationId}:`
    for (const key of chatInFlight.keys()) {
      if (key.startsWith(inflightPrefix)) clearChatInFlight(key, 'cancel')
    }
    tlog(`chat cancelled scope=${principal.key} conv=${conversationId} sessions=${aborted}`)
    res.json({ ok: true, aborted })
  } catch (error) {
    next(error)
  }
})

// ---------------------------------------------------------------------------
// 后台任务状态查询（2026-08-06）：用户刷新/重开页面后，前端主动查询该会话
// 是否有「仍在后台运行的任务」，并取回其过程事件（思考/工具/输出）——
// 前端据此把后台任务正常渲染为对话消息流（而非只显示一张等待卡片）。
// ---------------------------------------------------------------------------
webosRouter.get('/chat/background', async (req, res, next) => {
  try {
    const principal = requirePrincipal(req)
    const conversationId = typeof req.query.conversationId === 'string' && req.query.conversationId.trim()
      ? String(req.query.conversationId).trim().slice(0, 64)
      : 'default'
    // 遍历任务缓冲，找该用户该会话最近一次任务（任意思考档位）
    const prefix = `webos:${principal.key}:${conversationId}:`
    let found: TaskBufferRec | null = null
    for (const [key, value] of activeTaskEvents) {
      if (key.startsWith(prefix) && value.events.length > 0) {
        found = value
        break
      }
    }
    // 2026-08-08：无事件缓冲但有「请求在途」标记（pi 加载期/尚未产生首个事件）——
    // 前端断流后查询到 running=true 会放弃自动重试，避免同一条消息被处理两次。
    // 2026-08-10：TTL 提到 240s（任务最长 180s+排队），并使用统一 chatInFlightActive。
    if (!found) {
      let inflight = false
      for (const key of chatInFlight.keys()) {
        if (key.startsWith(prefix) && chatInFlightActive(key)) { inflight = true; break }
      }
      if (inflight) {
        tlog(`chat bg query scope=${principal.key} conv=${conversationId} → running=true (inflight, no events yet)`)
        res.json({ running: true, elapsed: 0, events: [] })
        return
      }
      tlog(`chat bg query scope=${principal.key} conv=${conversationId} → running=false`)
      res.json({ running: false })
      return
    }
    // 无论运行中还是已结束都返回完整事件：前端据此把后台任务渲染为对话消息流
    // （运行中继续轮询增量；已结束则一次渲染最终回复）。2026-08-11 附带
    // lastUserContent：缓冲所属任务对应的最后一条 user 消息，前端恢复时校验
    // 缓冲是否属于当前对话末尾（防止历史任务事件追加到新消息/错误卡片）。
    tlog(`chat bg query scope=${principal.key} conv=${conversationId} → running=${found.endedAt === null} elapsed=${Math.max(0, Math.round((Date.now() - found.startedAt) / 1000))}s events=${found.events.length}`)
    res.json({
      running: found.endedAt === null,
      elapsed: Math.max(0, Math.round((Date.now() - found.startedAt) / 1000)),
      events: found.events,
      lastUserContent: found.lastUserContent ?? '',
    })
  } catch (error) {
    next(error)
  }
})

// ---------------------------------------------------------------------------
// AI 生成会话标题（2026-08-06）
// 前端在会话首次 AI 回复完成后调用：根据最近对话生成 4-15 字中文标题。
// 轻量一次性补全（thinking=off），不扣用户积分，仅落审计；失败返回 title: null，
// 前端回退到「取第一条用户消息前 20 字」。限频：每用户每 10 分钟最多 5 次。
// ---------------------------------------------------------------------------

const TITLE_RATE_WINDOW_MS = 10 * 60 * 1000
const TITLE_RATE_MAX = 5
const titleRateMap = new Map<string, { count: number; windowStart: number }>()

webosRouter.post('/chat/title', async (req, res, next) => {
  try {
    const principal = requirePrincipal(req)
    // 限频（防刷接口烧钱）：每用户每 10 分钟最多 5 次
    const now = Date.now()
    const rate = titleRateMap.get(principal.key)
    if (!rate || now - rate.windowStart >= TITLE_RATE_WINDOW_MS) {
      titleRateMap.set(principal.key, { count: 1, windowStart: now })
    } else if (rate.count >= TITLE_RATE_MAX) {
      next(createError(429, 'TITLE_RATE_LIMITED', '会话标题生成太频繁，请稍后再试'))
      return
    } else {
      rate.count += 1
    }

    // 校验：texts 为消息纯文本数组（≤10 条、每条 ≤500 字、总长 ≤4000 字符）
    const raw = (req.body ?? {}) as { texts?: unknown }
    const texts = Array.isArray(raw.texts)
      ? raw.texts
        .filter((item): item is string => typeof item === 'string')
        .map((item) => item.trim())
        .filter((item) => item.length > 0)
        .map((item) => item.slice(0, 500))
        .slice(0, 10)
      : []
    if (texts.length === 0) {
      next(createError(400, 'INVALID_TEXTS', 'texts 必须是非空字符串数组'))
      return
    }
    const joined = texts.join('\n').slice(0, 4000)

    const { generateConversationTitle } = await loadPiBridge()
    const title = await generateConversationTitle([joined])
    // 审计落库（不扣积分）：kind=用户分层，thinking=off；审计失败不阻断
    try {
      const state = await loadState(principal)
      await recordAiUsage(principal, state, {
        model: MODEL,
        thinking: 'off',
        promptTokens: 0,
        completionTokens: 0,
        costMinor: 0,
        status: title ? 'ok' : 'failed',
        errorCode: title ? undefined : 'TITLE_GENERATION_FAILED',
        ip: req.ip,
      })
    } catch { /* 审计失败不阻断 */ }
    res.json({ title })
  } catch (error) {
    next(error)
  }
})

// ============================================================================
// 应用商店 API（2026-08-03）
// 商店 = 数据 API（本组路由）+ 形态（system.store 版本化 HTML App，AI 可改）。
// 分享链接：https://shadowshub.xyz/daily/?exp=<shareId>（体验页直接运行商店快照）
// ============================================================================

function storeAppRowToPublic(row: Record<string, unknown>): Record<string, unknown> {
  return {
    id: String(row.id),
    name: String(row.name ?? '未命名'),
    icon: typeof row.icon === 'string' && row.icon ? row.icon : null,
    description: String(row.description ?? ''),
    ownerName: String(row.owner_name ?? '匿名'),
    downloads: Number(row.downloads ?? 0),
    installs: Number(row.installs ?? 0),
    // 2026-08-12 商店标注占内存：应用安装后占用的工作区空间（HTML 快照 + 素材）
    sizeBytes: Number(row.size_bytes ?? 0),
    createdAt: Number(row.created_at ?? 0),
  }
}

/** 商店列表（公开，不含 html；2026-08-09 支持服务端搜索 q 与排序 sort=latest|hot，
 *  列表 icon 超 4KB 截断（详情接口返回完整 icon，列表用渐变首字母兜底）——商店
 *  网格图标的 data URI 是列表 payload 的大头，瘦身后低带宽下浏览更快） */
webosRouter.get('/store/apps', async (req, res, next) => {
  try {
    const principal = requirePrincipal(req)
    const pool = getPool()
    const q = typeof req.query.q === 'string' && req.query.q.trim() ? req.query.q.trim().slice(0, 60) : ''
    const sort = req.query.sort === 'hot' ? 'hot' : 'latest'
    const params: Array<string | number> = []
    let where = `WHERE s.status = 'published'`
    if (q) {
      params.push(`%${q}%`, `%${q}%`)
      where += ` AND (s.name LIKE $${params.length - 1} OR s.description LIKE $${params.length})`
    }
    const orderBy = sort === 'hot'
      ? `installs DESC, s.created_at DESC`
      : `s.created_at DESC`
    const result = await pool.query(
      `SELECT s.*,
        (SELECT COUNT(*) FROM webos_store_installs i WHERE i.share_id = s.id) AS installs,
        COALESCE(u.display_name, u.username, '匿名') AS owner_name
       FROM webos_store_apps s
       LEFT JOIN users u ON u.id = REPLACE(s.owner_key, 'user:', '')
       ${where}
       ORDER BY ${orderBy}
       LIMIT 100`,
      params,
    )
    const state = await loadState(principal)
    // 2026-08-16 修复「已安装」标记恒为 false：安装的 App id 带 `store:` 前缀
    // （如 store:s-abc123），而商店条目 id 是 s-abc123 → 直接比 row.id 永不匹配。
    // 收集时去掉 `store:` 前缀，与 row.id 对齐；bundle 安装的 share:xxx 不在此集合。
    const installedIds = new Set(
      state.apps.filter((app) => app.source === 'store')
        .map((app) => (app.id.startsWith('store:') ? app.id.slice('store:'.length) : app.id)),
    )
    res.json({
      // 2026-08-12 商店标注用户剩余空间：工作区配额 -（磁盘已用 + App 私有数据）
      userFreeBytes: workspaceFreeBytes(principal, calculateStorageBytes(state), state),
      items: result.rows.map((row) => {
        const icon = typeof row.icon === 'string' && row.icon ? row.icon : null
        return {
          ...storeAppRowToPublic(row),
          icon: icon && icon.length > 4096 ? null : icon,
          installed: installedIds.has(String(row.id)),
        }
      }),
    })
  } catch (error) {
    next(error)
  }
})

/** 商店条目详情（含 html 快照，分享体验用） */
webosRouter.get('/store/apps/:shareId', async (req, res, next) => {
  try {
    const principal = requirePrincipal(req)
    const shareId = String(req.params.shareId ?? '').replace(/[^a-zA-Z0-9-]/g, '').slice(0, 64)
    if (!shareId) { next(createError(400, 'INVALID_SHARE_ID', '无效的分享 ID')); return }
    const pool = getPool()
    const result = await pool.query(
      `SELECT s.*,
        (SELECT COUNT(*) FROM webos_store_installs i WHERE i.share_id = s.id) AS installs,
        COALESCE(u.display_name, u.username, '匿名') AS owner_name
       FROM webos_store_apps s
       LEFT JOIN users u ON u.id = REPLACE(s.owner_key, 'user:', '')
       WHERE s.id = $1 AND s.status = 'published'`,
      [shareId],
    )
    const row = result.rows[0]
    if (!row) { next(createError(404, 'STORE_APP_NOT_FOUND', '该应用不存在或已下架')); return }
    res.json({ item: { ...storeAppRowToPublic(row), html: String(row.html ?? '') } })
  } catch (error) {
    next(error)
  }
})

/** GET /webos/api/store/apps/:shareId/raw?path= — 商店快照素材文件
 * （分享体验页 iframe 的 <base> 指向此端点：App 相对路径 assets/xxx.png
 *  自动加载发布者工作区 apps/<app_id>/ 下的文件，图片/CSS/JS 即可正常渲染）。
 * 仅限该 App 目录内（防越界）；免登录可访问（分享体验需要）。 */
async function serveStoreRaw(shareIdRaw: string, filePathRaw: string, res: Response): Promise<void> {
  const shareId = shareIdRaw.replace(/[^a-zA-Z0-9-]/g, '').slice(0, 64)
  if (!shareId) throw createError(400, 'INVALID_SHARE_ID', '无效的分享 ID')
  const filePath = filePathRaw
  if (!filePath) throw createError(400, 'APP_FS_PATH_REQUIRED', 'path 必填')
  const pool = getPool()
  const row = (await pool.query(
    'SELECT owner_key, app_id FROM webos_store_apps WHERE id = $1 AND status = $2',
    [shareId, 'published'],
  )).rows[0]
  if (!row) throw createError(404, 'STORE_APP_NOT_FOUND', '商店条目不存在')
  const ownerKey = String(row.owner_key)
  const appId = String(row.app_id)
  // 2026-08-06 优先读独立归档（发布者删除 App 后分享页/商店素材仍可用），
  // 否则回退发布者工作区 apps/<app_id>/（旧数据兼容）
  const archived = storeAssetsDir(shareId)
  const baseRoot = fs.existsSync(archived) && fs.statSync(archived).isDirectory() ? archived : appFilesRoot(ownerKey, 'app', appId)
  const full = path.normalize(path.join(baseRoot, filePath))
  console.log(`[webos] store raw share=${shareId} file=${JSON.stringify(filePath)} full=${full} exists=${fs.existsSync(full)}`)
  if (!full.startsWith(baseRoot + path.sep)) throw createError(400, 'INVALID_PATH', '路径越界')
   if (!fs.existsSync(full) || !fs.statSync(full).isFile()) throw createError(404, 'FILE_NOT_FOUND', '文件不存在')
   res.setHeader('Content-Type', rawMimeFor(filePath))
   res.setHeader('Cache-Control', 'public, max-age=300')
   fs.createReadStream(full).pipe(res)
 }

/** GET /webos/api/store/apps/:shareId/raw — 商店快照素材。
 * 2026-08-14 重构为导出函数：由 index.ts 在 authMiddleware **之前**挂载（分享页/商店
 * 预览游客无 cookie——此前挂 webosRouter 内被鉴权拦截 401，素材不显示）。
 * 支持 path 式（<base>/raw/assets/xxx.png）与 query 式（?path=assets/xxx.png）。 */
export async function serveStoreRawFile(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (req.method !== 'GET') { next(); return }
    const shareId = String((req.params as { shareId?: string }).shareId ?? '').replace(/[^a-zA-Z0-9-]/g, '').slice(0, 64)
    const rest = decodeURIComponent(req.url.replace(/^\//, ''))
    const filePath = rest || (typeof req.query.path === 'string' && req.query.path ? req.query.path : '')
    if (!filePath) { next(); return }
    await serveStoreRaw(shareId, filePath, res)
  } catch (error) {
    next(error)
  }
}

/** 发布到商店（把自己的 App 发布为商店条目；重复发布 = 更新快照，shareId 不变） */
async function publishStoreAppEntry(principal: Principal, appId: string, description: string): Promise<{ shareId: string; url: string }> {
  const state = await loadState(principal)
  const app = state.apps.find((candidate) => candidate.id === appId)
  if (!app) throw createError(404, 'APP_NOT_FOUND', '未找到该 App')
  // 2026-08-06 放开系统 UI 类 App（system.store / system.desktop 等）发布——
  // 用户可在商店看到/安装系统 App 的改版（AI 做两版：一版发布商店、一版应用系统）。
  // 仅 daily.ai（AI 本体）禁止发布。
  const isBannedBuiltin = app.source === 'builtin' && app.id === 'daily.ai'
  if (isBannedBuiltin) throw createError(403, 'APP_NOT_PUBLISHABLE', '该应用不能发布')
  // 2026-08-14 同 ap-分享：发布前先把工作区最新源码同步进版本库（防止
  // 「分享/发布出去的是旧版本」——工作区被 AI 直接修改但版本库未跟上）。
  try {
    if (syncAppSourceFromWorkspace(principal, app)) await saveState(principal, state)
  } catch (error) {
    console.warn(`[webos] store publish pre-sync failed for ${appId}:`, describeHookError(error))
  }
  const active = app.versions.find((version) => version.id === app.activeVersionId) ?? app.versions[app.versions.length - 1]
  if (!active?.html) throw createError(400, 'APP_NO_SOURCE', '该 App 没有可发布的源码')

  const pool = getPool()
  const now = Date.now()
  const shareId = `s-${randomUUID().slice(0, 8)}${Date.now().toString(36).slice(-6)}`
  // 同一用户对同一 App 重复发布：复用已有条目（shareId 不变，快照更新）
  const existing = await pool.query('SELECT id FROM webos_store_apps WHERE owner_key = $1 AND app_id = $2', [principal.key, appId])
  let rowId = String(existing.rows[0]?.id ?? '')
  // 2026-08-06 素材归档：发布时把 assets/ 与图标复制到独立 store-assets/<shareId>/
  //（与发布者工作区解耦——发布者删除/回收 App 后，商店快照与安装仍可用素材）
  archiveStoreAssets(principal, appId, rowId || shareId)
  // 2026-08-12 商店标注占内存：size_bytes = HTML 快照 + 归档素材总大小
  const sizeBytes = Buffer.byteLength(active.html, 'utf-8') + dirTotalBytes(storeAssetsDir(rowId || shareId))
  if (rowId) {
    await pool.query(
      `UPDATE webos_store_apps SET name = $1, icon = $2, description = $3, html = $4, version = $5, updated_at = $6, status = 'published', size_bytes = $7 WHERE id = $8`,
      [app.name, app.icon ?? null, description, active.html, active.version, now, sizeBytes, rowId],
    )
  } else {
    rowId = shareId
    await pool.query(
      `INSERT INTO webos_store_apps (id, app_id, owner_key, name, icon, description, html, version, created_at, updated_at, status, size_bytes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'published', $11)`,
      [rowId, appId, principal.key, app.name, app.icon ?? null, description, active.html, active.version, now, now, sizeBytes],
    )
  }
  return { shareId: rowId, url: `${APP_BASE_URL}?exp=${rowId}` }
}

/** 目录总字节数（递归；不存在/失败返回 0） */
function dirTotalBytes(dir: string): number {
  try {
    if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return 0
    let total = 0
    const walk = (d: string): void => {
      for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
        const full = path.join(d, entry.name)
        if (entry.isDirectory()) walk(full)
        else if (entry.isFile()) total += fs.statSync(full).size
      }
    }
    walk(dir)
    return total
  } catch {
    return 0
  }
}

/** 商店素材归档目录（与发布者工作区解耦——发布者删除 App 后商店/安装仍可用素材） */
function storeAssetsDir(shareId: string): string {
  return path.join(getSandboxRoot(), 'store-assets', shareId)
}

/** 发布时把发布者工作区 assets/ 与图标归档到 store-assets/<shareId>/（重复发布先清空） */
function archiveStoreAssets(principal: Principal, appId: string, shareId: string): void {
  try {
    const srcRoot = appFilesRoot(principal.key, 'app', appId)
    const dstRoot = storeAssetsDir(shareId)
    if (fs.existsSync(dstRoot)) fs.rmSync(dstRoot, { recursive: true, force: true })
    fs.mkdirSync(dstRoot, { recursive: true })
    if (!fs.existsSync(srcRoot)) return
    const srcAssets = path.join(srcRoot, 'assets')
    if (fs.existsSync(srcAssets) && fs.statSync(srcAssets).isDirectory()) {
      fs.mkdirSync(path.join(dstRoot, 'assets'), { recursive: true })
      fs.cpSync(srcAssets, path.join(dstRoot, 'assets'), { recursive: true, force: true })
    }
    for (const iconName of ['icon.svg', 'icon.png', 'icon.jpg', 'icon.webp']) {
      const srcIcon = path.join(srcRoot, iconName)
      if (fs.existsSync(srcIcon) && fs.statSync(srcIcon).isFile()) {
        try { fs.copyFileSync(srcIcon, path.join(dstRoot, iconName)) } catch { /* 忽略单个失败 */ }
      }
    }
  } catch (error) {
    console.warn('[webos] store assets archive failed:', error instanceof Error ? error.message : String(error))
  }
}

webosRouter.post('/store/apps', async (req, res, next) => {
  try {
    const principal = requirePrincipal(req)
    const body = (req.body ?? {}) as { appId?: unknown; description?: unknown }
    const appId = typeof body.appId === 'string' ? body.appId.trim().slice(0, 80) : ''
    const description = typeof body.description === 'string' ? body.description.trim().slice(0, 200) : ''
    if (!appId) { next(createError(400, 'INVALID_APP_ID', '缺少 appId')); return }
    const { shareId, url } = await publishStoreAppEntry(principal, appId, description)
    res.json({ ok: true, shareId, url, message: '已发布到商店' })
  } catch (error) {
    next(error)
  }
})

/** 下架（仅发布者本人） */
webosRouter.delete('/store/apps/:shareId', async (req, res, next) => {
  try {
    const principal = requirePrincipal(req)
    const shareId = String(req.params.shareId ?? '').replace(/[^a-zA-Z0-9-]/g, '').slice(0, 64)
    const pool = getPool()
    const result = await pool.query('SELECT owner_key FROM webos_store_apps WHERE id = $1', [shareId])
    if (!result.rows[0]) { next(createError(404, 'STORE_APP_NOT_FOUND', '该应用不存在')); return }
    if (String(result.rows[0].owner_key) !== principal.key) {
      next(createError(403, 'STORE_NOT_OWNER', '只有发布者可以下架')); return
    }
    await pool.query(`UPDATE webos_store_apps SET status = 'unpublished' WHERE id = $1`, [shareId])
    res.json({ ok: true, message: '已下架' })
  } catch (error) {
    next(error)
  }
})

/** 我的发布（发布者视角：下载/分享数据 + 是否本人） */
webosRouter.get('/store/my', async (req, res, next) => {
  try {
    const principal = requirePrincipal(req)
    const pool = getPool()
    const result = await pool.query(
      `SELECT s.*,
        (SELECT COUNT(*) FROM webos_store_installs i WHERE i.share_id = s.id) AS installs,
        (SELECT COUNT(*) FROM webos_store_visits v WHERE v.share_id = s.id AND v.status = 'credited') AS visits
       FROM webos_store_apps s
       WHERE s.owner_key = $1 AND s.status = 'published'
       ORDER BY s.created_at DESC`,
      [principal.key],
    )
    res.json({ items: result.rows.map((row) => storeAppRowToPublic(row)) })
  } catch (error) {
    next(error)
  }
})

// ============================================================================
// 整套系统分享（2026-08-06）：加载动画 + 桌面 + 应用 打包为分享包
// 数据：<sandbox>/share-assets/<shareId>/meta.json + apps/<appId>/** 素材归档
// 分享页（/daily/exp/sh-*）全屏预览 + 悬浮按钮；安装 = 批量复制为我的 App。
// 合集可上架商店（bundle 条目，html=选择列表，逐个/全部安装）。
// ============================================================================

function shareAssetsDir(shareId: string): string {
  return path.join(getSandboxRoot(), 'share-assets', shareId)
}

function readShareMeta(shareId: string): { shareId: string; ownerKey: string; ownerName: string; createdAt: number; bootHtml: string; desktopHtml: string; apps: Array<{ id: string; name: string; icon: string | null; html: string }> } | null {
  try {
    const metaPath = path.join(shareAssetsDir(shareId), 'meta.json')
    if (!fs.existsSync(metaPath)) return null
    return JSON.parse(fs.readFileSync(metaPath, 'utf-8'))
  } catch {
    return null
  }
}

/** POST /webos/api/share — 打包整套系统（boot + 桌面 + 全部用户 App 及素材） */
webosRouter.post('/share', async (req, res, next) => {
  try {
    const principal = requirePrincipal(req)
    const state = await loadState(principal)
    const shareId = `sh-${randomUUID().slice(0, 8)}${Date.now().toString(36).slice(-6)}`
    const dst = shareAssetsDir(shareId)
    fs.mkdirSync(dst, { recursive: true })
    // boot.html（加载动画）
    let bootHtml = ''
    try {
      const bootFile = path.join(getWorkspaceRoot(principal.key), 'system', 'boot.html')
      if (fs.existsSync(bootFile)) bootHtml = fs.readFileSync(bootFile, 'utf-8')
    } catch { /* 忽略 */ }
    // system.desktop 当前版本
    const desktop = state.apps.find((a) => a.id === 'system.desktop')
    const desktopActive = desktop?.versions.find((v) => v.id === desktop.activeVersionId) ?? desktop?.versions[0]
    const desktopHtml = desktopActive?.html ?? ''
    // 桌面素材归档
    try {
      const src = appFilesRoot(principal.key, 'app', 'system.desktop')
      const dstd = path.join(dst, 'system.desktop')
      fs.mkdirSync(dstd, { recursive: true })
      const assets = path.join(src, 'assets')
      if (fs.existsSync(assets) && fs.statSync(assets).isDirectory()) fs.cpSync(assets, path.join(dstd, 'assets'), { recursive: true, force: true })
    } catch { /* 忽略 */ }
    // 用户 App（含素材 + 图标 + 工作区文件）
    const userApps = state.apps.filter((a) => a.source !== 'builtin')
    const apps = userApps.map((a) => {
      const v = a.versions.find((x) => x.id === a.activeVersionId) ?? a.versions[0]
      return { id: a.id, name: a.name, icon: a.icon ?? null, html: v?.html ?? '' }
    })
    for (const app of userApps) {
      try {
        const src = appFilesRoot(principal.key, 'app', app.id)
        const appDst = path.join(dst, 'apps', app.id)
        fs.mkdirSync(appDst, { recursive: true })
        if (!fs.existsSync(src)) continue
        const assets = path.join(src, 'assets')
        if (fs.existsSync(assets) && fs.statSync(assets).isDirectory()) {
          fs.mkdirSync(path.join(appDst, 'assets'), { recursive: true })
          fs.cpSync(assets, path.join(appDst, 'assets'), { recursive: true, force: true })
        }
        for (const iconName of ['icon.svg', 'icon.png', 'icon.jpg', 'icon.webp']) {
          const f = path.join(src, iconName)
          if (fs.existsSync(f) && fs.statSync(f).isFile()) {
            try { fs.copyFileSync(f, path.join(appDst, iconName)) } catch { /* 忽略 */ }
          }
        }
      } catch { /* 忽略 */ }
    }
    const ownerName = principal.guest ? '游客' : principal.key.replace('user:', '').slice(0, 16)
    const meta = { shareId, ownerKey: principal.key, ownerName, createdAt: Date.now(), bootHtml, desktopHtml, apps }
    fs.writeFileSync(path.join(dst, 'meta.json'), JSON.stringify(meta))
    res.json({ ok: true, shareId, url: `/daily/exp/${shareId}`, apps: apps.length, message: '整套系统分享已生成' })
  } catch (error) {
    next(error)
  }
})

/** POST /webos/api/share/app — 单个 App 轻量分享（2026-08-08）：与「发布到商店」不同，
 * 不进入商店列表，纯链接分享给朋友（/daily/exp/ap-* 落地页直接运行该 App 快照）。 */
webosRouter.post('/share/app', async (req, res, next) => {
  try {
    const principal = requirePrincipal(req)
    const appId = String((req.body ?? {}).appId ?? '').trim().slice(0, 128)
    if (!appId) { next(createError(400, 'INVALID_APP_ID', '缺少 appId')); return }
    const state = await loadState(principal)
    const app = state.apps.find((a) => a.id === appId && a.source !== 'builtin')
    if (!app) { next(createError(404, 'APP_NOT_FOUND', '未找到该 App')); return }
    // 2026-08-14 修复：分享前先同步工作区 → 版本库。AI 直接修改工作区
    // apps/<appId>/index.html（agent_fs_write）后若即时钩子未生效（曾因 findApp
    // 抛错全挂），分享会拿到旧版本库快照——"分享出去的是没用素材的简陋版"。
    // 这里同步一次：工作区文件校验通过则建新版本并切换，失败保留现有版本（不伪造）。
    try {
      if (syncAppSourceFromWorkspace(principal, app)) await saveState(principal, state)
    } catch (error) {
      console.warn(`[webos] share pre-sync failed for ${appId}:`, describeHookError(error))
    }
    const version = app.versions.find((v) => v.id === app.activeVersionId) ?? app.versions[0]
    if (!version?.html) { next(createError(400, 'APP_NO_HTML', 'App 没有可分享的版本')); return }
    const shareId = `ap-${randomUUID().slice(0, 8)}${Date.now().toString(36).slice(-6)}`
    const dst = shareAssetsDir(shareId)
    fs.mkdirSync(dst, { recursive: true })
    // 素材归档（assets/ + 图标文件）
    const appDst = path.join(dst, 'apps', app.id)
    fs.mkdirSync(appDst, { recursive: true })
    try {
      const src = appFilesRoot(principal.key, 'app', app.id)
      if (fs.existsSync(src)) {
        const assets = path.join(src, 'assets')
        if (fs.existsSync(assets) && fs.statSync(assets).isDirectory()) {
          fs.mkdirSync(path.join(appDst, 'assets'), { recursive: true })
          fs.cpSync(assets, path.join(appDst, 'assets'), { recursive: true, force: true })
        }
        for (const iconName of ['icon.svg', 'icon.png', 'icon.jpg', 'icon.webp']) {
          const f = path.join(src, iconName)
          if (fs.existsSync(f) && fs.statSync(f).isFile()) {
            try { fs.copyFileSync(f, path.join(appDst, iconName)) } catch { /* 忽略 */ }
          }
        }
      }
    } catch { /* 素材归档失败不阻断 */ }
    const ownerName = principal.guest ? '游客' : principal.key.replace('user:', '').slice(0, 16)
    const meta = {
      shareId, ownerKey: principal.key, ownerName, createdAt: Date.now(),
      bootHtml: '', desktopHtml: '',
      apps: [{ id: app.id, name: app.name, icon: app.icon ?? null, html: version.html }],
    }
    fs.writeFileSync(path.join(dst, 'meta.json'), JSON.stringify(meta))
    res.json({ ok: true, shareId, url: `/daily/exp/${shareId}`, name: app.name, message: '分享链接已生成' })
  } catch (error) {
    next(error)
  }
})

/** GET /webos/api/share/:shareId/meta — 分享包元数据（2026-08-08：ap- 轻量分享
 *  体验页读取单个 App 快照；s- 商店分享仍走 /store/apps/:shareId） */
webosRouter.get('/share/:shareId/meta', async (req, res, next) => {
  try {
    const shareId = String(req.params.shareId ?? '').replace(/[^a-zA-Z0-9-]/g, '').slice(0, 64)
    if (!shareId.startsWith('ap-')) { next(createError(404, 'SHARE_NOT_FOUND', '仅支持 ap- 轻量分享')); return }
    const meta = readShareMeta(shareId)
    if (!meta || meta.apps.length === 0) { next(createError(404, 'SHARE_NOT_FOUND', '分享不存在或已失效')); return }
    const app = meta.apps[0]!
    res.json({
      item: {
        id: shareId,
        name: app.name,
        icon: app.icon,
        description: '朋友分享的应用',
        ownerName: meta.ownerName ?? '匿名',
        installs: 0,
        html: app.html,
      },
    })
  } catch (error) {
    next(error)
  }
})

/** GET /webos/api/share/:shareId/raw/*splat — 分享包素材。
 * 2026-08-14 重构为导出函数：由 index.ts 在 authMiddleware **之前**挂载（分享链接
 * 公开，游客无 cookie——此前挂在 webosRouter 内被鉴权拦截，App 内 assets/xxx.png
 * 全部 401 → 分享出去变成"没有素材的简陋版"）。与 store raw、apps raw 同级风险
 * （shareId 不可枚举 UUID）。 */
export async function serveShareRawFile(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (req.method !== 'GET') { next(); return }
    const rest = decodeURIComponent(req.url.replace(/^\//, ''))
    if (!rest) { next(); return }
    const shareId = String((req.params as { shareId?: string }).shareId ?? '').replace(/[^a-zA-Z0-9-]/g, '').slice(0, 64)
    const root = shareAssetsDir(shareId)
    if (!fs.existsSync(root)) { next(createError(404, 'SHARE_NOT_FOUND', '分享不存在')); return }
    const full = path.normalize(path.join(root, rest))
    if (!full.startsWith(root + path.sep)) throw createError(400, 'INVALID_PATH', '路径越界')
    if (!fs.existsSync(full) || !fs.statSync(full).isFile()) throw createError(404, 'FILE_NOT_FOUND', '文件不存在')
    res.setHeader('Content-Type', rawMimeFor(rest))
    res.setHeader('Cache-Control', 'public, max-age=300')
    fs.createReadStream(full).pipe(res)
  } catch (error) {
    next(error)
  }
}

/**
 * GET /webos/api/share/:shareId/preview?kind=boot|desktop|apps — 分享页预览 srcDoc。
 * 2026-08-08 改为免鉴权导出函数（分享链接公开：游客第一次打开无 cookie，
 * 挂在 authMiddleware 内会 401 导致预览空白——与 store raw 同级风险，shareId 不可枚举）。
 */
export async function serveSharePreview(req: Request, res: Response): Promise<void> {
  try {
    const shareId = String(req.params.shareId ?? '').replace(/[^a-zA-Z0-9-]/g, '').slice(0, 64)
    const meta = readShareMeta(shareId)
    if (!meta) { res.status(404).json({ ok: false, error: 'SHARE_NOT_FOUND' }); return }
    // 2026-08-14 修复：ap- 分享素材在 share-assets/<id>/apps/<appId>/（带 App 层），
    // base 必须指向 .../raw/apps/<appId>/（否则 App 相对路径 assets/xxx 404 → 分享是"简陋版"）；
    // sh- 整套分享 html 用绝对路径 apps/<id>/...，base 保持 raw/。
    const base = shareId.startsWith('ap-')
      ? `<base href="/webos/api/share/${encodeURIComponent(shareId)}/raw/apps/${encodeURIComponent(String(meta.apps[0]?.id ?? 'app'))}/">`
      : `<base href="/webos/api/share/${encodeURIComponent(shareId)}/raw/">`
    const polyfill = `<script>(()=>{let mem={};try{void window.localStorage.getItem('__t')}catch(e){const s={getItem:k=>(k in mem?mem[k]:null),setItem:(k,v)=>{mem[k]=String(v)},removeItem:k=>{delete mem[k]},clear:()=>{mem={}},key:i=>Object.keys(mem)[i]??null,get length(){return Object.keys(mem).length}};Object.defineProperty(window,'localStorage',{value:s,configurable:true})}})()<\/script>`
    const inject = (html: string): string => (html ? (html.replace(/<head\b[^>]*>/i, (m) => `${m}${base}${polyfill}`) || `${base}${polyfill}${html}`) : '')
    const kind = String(req.query.kind ?? 'boot')
    if (kind === 'desktop') {
      res.json({ ok: true, srcDoc: inject(meta.desktopHtml) })
      return
    }
    if (kind === 'apps') {
      const cards = meta.apps.map((a, i) => {
        const iconFile = ['icon.svg', 'icon.png', 'icon.jpg', 'icon.webp'].find((n) => fs.existsSync(path.join(shareAssetsDir(shareId), 'apps', a.id, n)))
        const icon = iconFile
          ? `<img src="apps/${encodeURIComponent(a.id)}/${iconFile}" alt="">`
          : `<span>${a.name.slice(0, 1)}</span>`
        return `<div class="card"><div class="icon">${icon}</div><div class="info"><div class="name">${String(a.name).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '"' })[c]!)}</div><a class="btn" href="/daily/?share=${encodeURIComponent(shareId)}&install=${encodeURIComponent(a.id)}">安装</a></div></div>`
      }).join('')
      const srcDoc = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>
        *{margin:0;padding:0;box-sizing:border-box}body{font-family:-apple-system,"PingFang SC",sans-serif;background:linear-gradient(160deg,#eef1f6,#dfe6f3);min-height:100vh;padding:18px 16px calc(20px + env(safe-area-inset-bottom))}
        h1{font-size:18px;margin-bottom:4px}.sub{font-size:12px;color:#6b7280;margin-bottom:14px}
        .card{display:flex;align-items:center;gap:12px;background:rgba(255,255,255,.85);border-radius:16px;padding:12px 14px;margin-bottom:10px;box-shadow:0 8px 20px rgba(30,41,59,.1)}
        .icon{width:46px;height:46px;border-radius:12px;background:linear-gradient(135deg,#c3cdff,#e5e9fb);flex-shrink:0;display:flex;align-items:center;justify-content:center;overflow:hidden;font-size:20px;font-weight:700;color:#4f6ef7}
        .icon img{width:100%;height:100%;object-fit:cover}.info{flex:1;min-width:0}.name{font-size:14px;font-weight:600}
        .btn{background:#4f6ef7;color:#fff;border-radius:10px;padding:7px 14px;font-size:12px;text-decoration:none;font-weight:600}
      </style></head><body><h1>${String(meta.ownerName).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '"' })[c]!)} 的应用</h1><p class="sub">点击安装到你的 Daily 桌面（${meta.apps.length} 个应用）</p>${cards}</body></html>`
      res.json({ ok: true, srcDoc })
      return
    }
    // boot 默认（2026-08-08：ap- 轻量分享直接运行 App 快照；sh- 整套分享显示加载页）
    const bootHtml = shareId.startsWith('ap-') ? (meta.apps[0]?.html ?? '') : (meta.bootHtml || meta.desktopHtml)
    res.json({ ok: true, srcDoc: inject(bootHtml) })
  } catch (error) {
    res.status(500).json({ ok: false, error: error instanceof Error ? error.message : 'SHARE_PREVIEW_FAILED' })
  }
}

/** POST /webos/api/share/:shareId/install {appIds:[]|'all', includeDesktop?} — 批量安装所选应用到我的桌面 */
webosRouter.post('/share/:shareId/install', async (req, res, next) => {
  try {
    const principal = requirePrincipal(req)
    const shareId = String(req.params.shareId ?? '').replace(/[^a-zA-Z0-9-]/g, '').slice(0, 64)
    const meta = readShareMeta(shareId)
    if (!meta) { next(createError(404, 'SHARE_NOT_FOUND', '分享不存在')); return }
    const body = (req.body ?? {}) as { appIds?: unknown; all?: unknown; includeDesktop?: unknown }
    let selected: string[] = []
    if (body.all || body.appIds === 'all') selected = meta.apps.map((a) => a.id)
    else if (Array.isArray(body.appIds)) selected = body.appIds.map(String).filter((id) => meta.apps.some((a) => a.id === id))
    const includeDesktop = Boolean(body.includeDesktop)
    if (!selected.length && !includeDesktop) { next(createError(400, 'NO_APPS_SELECTED', '未选择要安装的应用')); return }
    const state = await loadState(principal)
    const now = Date.now()
    let installed = 0
    const installOne = (appId: string, name: string, html: string): void => {
      const myId = `share:${shareId}:${appId}`
      if (state.apps.some((a) => a.id === myId)) return
      const versionId = `version-${randomUUID()}`
      state.apps.unshift({
        id: myId, name, source: 'store', activeVersionId: versionId, installed: true, createdAt: now, icon: null,
        versions: [{ id: versionId, appId: myId, version: '1.0.0', status: 'active', source: 'store', capabilities: [...DEFAULT_APP_CAPABILITIES], html, createdAt: now, createdBy: 'user', parentVersionId: null }],
      })
      try {
        const srcD = path.join(shareAssetsDir(shareId), 'apps', appId)
        const dstD = appFilesRoot(principal.key, 'app', myId)
        fs.mkdirSync(dstD, { recursive: true })
        if (fs.existsSync(srcD)) fs.cpSync(srcD, dstD, { recursive: true, force: true })
        fs.writeFileSync(path.join(dstD, 'index.html'), html)
      } catch { /* 素材复制失败不阻断 */ }
      installed += 1
    }
    for (const appId of selected) {
      const srcApp = meta.apps.find((a) => a.id === appId)
      if (srcApp) installOne(srcApp.id, srcApp.name, srcApp.html)
    }
    if (includeDesktop && meta.desktopHtml) {
      installOne('system.desktop', '系统桌面（分享版）', meta.desktopHtml)
    }
    await saveState(principal, state)
    res.json({ ok: true, installed, selected: selected.length + (includeDesktop ? 1 : 0) })
  } catch (error) {
    next(error)
  }
})

/** POST /webos/api/share/:shareId/publish — 整套系统上架应用商店（bundle 条目：选择列表逐个安装） */
webosRouter.post('/share/:shareId/publish', async (req, res, next) => {
  try {
    const principal = requirePrincipal(req)
    const shareId = String(req.params.shareId ?? '').replace(/[^a-zA-Z0-9-]/g, '').slice(0, 64)
    const meta = readShareMeta(shareId)
    if (!meta) { next(createError(404, 'SHARE_NOT_FOUND', '分享不存在')); return }
    if (meta.ownerKey !== principal.key) { next(createError(403, 'SHARE_NOT_OWNER', '只有分享者可以上架')); return }
    // bundle 选择页：勾选多选 → StoreSDK bundle.install 批量安装（商店 iframe 内运行）
    const allIds = meta.apps.map((a) => a.id)
    const cards = meta.apps.map((a) => {
      const iconFile = ['icon.svg', 'icon.png', 'icon.jpg', 'icon.webp'].find((n) => fs.existsSync(path.join(shareAssetsDir(shareId), 'apps', a.id, n)))
      const icon = iconFile ? `<img src="/webos/api/share/${encodeURIComponent(shareId)}/raw/apps/${encodeURIComponent(a.id)}/${iconFile}" alt="">` : `<span>${a.name.slice(0, 1)}</span>`
      return `<label class="card"><input type="checkbox" class="pick" value="${encodeURIComponent(a.id)}"><div class="icon">${icon}</div><div class="info"><div class="name">${String(a.name).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '"' })[c]!)}</div></div></label>`
    }).join('')
    const bundleHtml = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>
      *{margin:0;padding:0;box-sizing:border-box}body{font-family:-apple-system,"PingFang SC",sans-serif;background:linear-gradient(160deg,#eef1f6,#dfe6f3);min-height:100vh;padding:18px 16px calc(24px + env(safe-area-inset-bottom))}
      h1{font-size:18px}.sub{font-size:12px;color:#6b7280;margin:4px 0 14px}
      .all{display:flex;align-items:center;justify-content:center;gap:8px;width:100%;background:linear-gradient(135deg,#4f6ef7,#7c5cff);color:#fff;border-radius:14px;padding:14px;font-size:14px;font-weight:600;border:0;margin-bottom:8px;box-shadow:0 8px 20px rgba(79,110,247,.35)}
      .all:disabled{opacity:.6}
      .card{display:flex;align-items:center;gap:12px;background:rgba(255,255,255,.85);border-radius:16px;padding:12px 14px;margin-bottom:10px;box-shadow:0 8px 20px rgba(30,41,59,.1)}
      .pick{width:20px;height:20px;accent-color:#4f6ef7;flex-shrink:0}
      .icon{width:46px;height:46px;border-radius:12px;background:linear-gradient(135deg,#c3cdff,#e5e9fb);flex-shrink:0;display:flex;align-items:center;justify-content:center;overflow:hidden;font-size:20px;font-weight:700;color:#4f6ef7}
      .icon img{width:100%;height:100%;object-fit:cover}.info{flex:1;min-width:0}.name{font-size:14px;font-weight:600}
      .toast{position:fixed;left:50%;bottom:30px;transform:translateX(-50%);background:rgba(28,35,51,.92);color:#fff;padding:10px 18px;border-radius:999px;font-size:13px;opacity:0;transition:opacity .25s;z-index:9;max-width:82vw;text-align:center}
      .toast.show{opacity:1}
    </style></head><body><h1>${String(meta.ownerName).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '"' })[c]!)} 的整套系统</h1><p class="sub">${meta.apps.length} 个应用 · 勾选后安装所选</p>
    <button class="all" id="installBtn">安装所选（0）</button>
    ${cards}
    <div class="toast" id="toast"></div>
    <script>
      var ALL=${JSON.stringify(allIds)}, SHARE=${JSON.stringify(shareId)}
      var picks=document.querySelectorAll('.pick'), btn=document.getElementById('installBtn'), toastEl=document.getElementById('toast'), toastTimer=null
      function toast(m){toastEl.textContent=m;toastEl.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(function(){toastEl.classList.remove('show')},2200)}
      function selected(){var ids=[];picks.forEach(function(p){if(p.checked)ids.push(decodeURIComponent(p.value))});return ids}
      function refresh(){var n=selected().length;btn.textContent=n?('安装所选（'+n+'）'):'安装所选（0）';btn.disabled=!n}
      picks.forEach(function(p){p.addEventListener('change',refresh)})
      btn.addEventListener('click',function(){
        var ids=selected();if(!ids.length)return
        btn.disabled=true;btn.textContent='安装中…'
        var done=function(ok,msg){btn.disabled=false;toast(msg);if(ok){setTimeout(function(){picks.forEach(function(p){p.checked=false});refresh()},600)}else{btn.textContent='安装所选（'+selected().length+'）'}}
        var body={appIds:ids}
        // 优先 App SDK http（bundle 作为 App 打开时）；否则 StoreSDK postMessage（商店内打开时）
        if(window.DailyWebOs&&DailyWebOs.http){
          DailyWebOs.http.post('/webos/api/share/'+SHARE+'/install',body).then(function(res){
            try{var j=JSON.parse(res.body);done(j.ok,j.message||('已安装 '+j.installed+' 个应用'))}catch(e){done(false,'安装失败')}
          }).catch(function(e){done(false,(e&&e.message)||'安装失败')})
        }else{
          var rid='b-'+Date.now()
          parent.postMessage({channel:'daily-webos-store',kind:'request',method:'bundle.install',params:{shareId:SHARE,appIds:ids},requestId:rid},'*')
          function onResp(e){var d=e.data;if(!d||d.channel!=='daily-webos-store'||d.kind!=='response'||d.requestId!==rid)return;window.removeEventListener('message',onResp);if(d.ok&&d.data){done(true,d.data.message||('已安装 '+d.data.installed+' 个应用'))}else{done(false,(d.error&&d.error.message)||'安装失败')}}
          window.addEventListener('message',onResp)
          setTimeout(function(){btn.disabled=false;btn.textContent='安装所选（'+selected().length+'）'},8000)
        }
      })
    </script></body></html>`
    const pool = getPool()
    const now = Date.now()
    const bundleId = `s-${randomUUID().slice(0, 8)}${now.toString(36).slice(-6)}`
    await pool.query(
      `INSERT INTO webos_store_apps (id, app_id, owner_key, name, icon, description, html, version, created_at, updated_at, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'published')`,
      [bundleId, `bundle:${shareId}`, principal.key, `${meta.ownerName} 的整套系统`, null, `整套系统：${meta.apps.length} 个应用（加载动画 + 桌面 + 应用），可分别安装`, bundleHtml, '1.0.0', now, now],
    )
    res.json({ ok: true, shareId: bundleId, url: `/daily/exp/${bundleId}`, message: '整套系统已上架应用商店' })
  } catch (error) {
    next(error)
  }
})

/** 安装商店应用：快照复制为我的 App（source='store'）；他人安装 → 发布者 +100 积分（每用户每应用一次） */
webosRouter.post('/store/apps/:shareId/install', async (req, res, next) => {
  try {
    const principal = requirePrincipal(req)
    const shareId = String(req.params.shareId ?? '').replace(/[^a-zA-Z0-9-]/g, '').slice(0, 64)
    const pool = getPool()

    // 2026-08-08 ap- 轻量分享安装：从分享包（share-assets/ap-xxx/meta.json）读取快照，
    // 不经过 webos_store_apps 表（与商店发布相互独立）
    if (shareId.startsWith('ap-')) {
      const meta = readShareMeta(shareId)
      const app = meta?.apps?.[0]
      if (!meta || !app?.html) { next(createError(404, 'SHARE_NOT_FOUND', '分享不存在或已失效')); return }
      const state = await loadState(principal)
      // 2026-08-12 安装占工作区空间：HTML + 分享包素材，空间不足拒绝安装
      const installBytes = Buffer.byteLength(app.html, 'utf-8') + dirTotalBytes(path.join(shareAssetsDir(shareId), 'apps', app.id))
      if (installBytes > workspaceFreeBytes(principal, calculateStorageBytes(state), state)) {
        next(createError(413, 'WORKSPACE_FULL', '工作区空间不足，无法安装该应用（请先清理部分文件；大量存储需求可联系站长单独扩容）'))
        return
      }
      const now = Date.now()
      const versionId = `version-${randomUUID()}`
      const newAppId = `store:${shareId}`
      const existing = state.apps.find((a) => a.id === newAppId)
      if (existing) {
        const parent = existing.versions[existing.versions.length - 1]
        existing.versions.push({
          id: versionId, appId: newAppId, version: `1.0.${existing.versions.length}`, status: 'active', source: 'store',
          capabilities: [...DEFAULT_APP_CAPABILITIES], html: app.html, createdAt: now, createdBy: 'user', parentVersionId: parent?.id ?? null,
        })
        existing.activeVersionId = versionId
      } else {
        state.apps.unshift({
          id: newAppId, name: String(app.name ?? '分享应用'), source: 'store', activeVersionId: versionId, installed: true, createdAt: now,
          icon: typeof app.icon === 'string' ? app.icon : null,
          versions: [{ id: versionId, appId: newAppId, version: '1.0.0', status: 'active', source: 'store', capabilities: [...DEFAULT_APP_CAPABILITIES], html: app.html, createdAt: now, createdBy: 'user', parentVersionId: null }],
        })
      }
      await saveState(principal, state)
      // 素材：share-assets/ap-xxx/apps/<appId>/ → 安装者 apps/store:ap-xxx/
      try {
        const srcRoot = path.join(shareAssetsDir(shareId), 'apps', app.id)
        const dstRoot = appFilesRoot(principal.key, 'app', newAppId)
        fs.mkdirSync(dstRoot, { recursive: true })
        if (fs.existsSync(srcRoot) && fs.statSync(srcRoot).isDirectory()) {
          fs.cpSync(srcRoot, dstRoot, { recursive: true, force: true })
        }
        fs.writeFileSync(path.join(dstRoot, 'index.html'), app.html)
      } catch { /* 素材复制失败不阻断 */ }
      res.json({ ok: true, appId: newAppId, message: '已安装到桌面' })
      return
    }

    const result = await pool.query('SELECT * FROM webos_store_apps WHERE id = $1 AND status = $2', [shareId, 'published'])
    const row = result.rows[0]
    if (!row) { next(createError(404, 'STORE_APP_NOT_FOUND', '该应用不存在或已下架')); return }

    const state = await loadState(principal)
    // 2026-08-12 安装占工作区空间：标注 size_bytes（HTML 快照 + 素材），
    // 旧条目无标注时按 HTML 字节估算；空间不足拒绝安装
    const installBytes = Number(row.size_bytes ?? 0) || Buffer.byteLength(String(row.html ?? ''), 'utf-8')
    if (installBytes > workspaceFreeBytes(principal, calculateStorageBytes(state), state)) {
      next(createError(413, 'WORKSPACE_FULL', '工作区空间不足，无法安装该应用（请先清理部分文件；大量存储需求可联系站长单独扩容）'))
      return
    }
    const now = Date.now()
    const versionId = `version-${randomUUID()}`
    const existing = state.apps.find((app) => app.id === `store:${shareId}`)
    if (existing) {
      // 已安装过：更新到最新快照（新版本）
       const parent = existing.versions[existing.versions.length - 1]
      existing.versions.push({
        id: versionId,
        appId: existing.id,
        version: `1.0.${existing.versions.length}`,
        status: 'active',
        source: 'store',
        // 2026-08-06 修复：商店安装的 App 必须带默认能力（app.fs 等），
        // 否则运行页素材（图片/CSS）API 403，图片无法渲染
        capabilities: [...DEFAULT_APP_CAPABILITIES],
        html: String(row.html ?? ''),
        createdAt: now,
        createdBy: 'user',
        parentVersionId: parent?.id ?? null,
      })
      existing.activeVersionId = versionId
    } else {
      state.apps.unshift({
        id: `store:${shareId}`,
        name: String(row.name ?? '商店应用'),
        source: 'store',
        activeVersionId: versionId,
        installed: true,
        createdAt: now,
        icon: typeof row.icon === 'string' ? row.icon : null,
        versions: [{
          id: versionId,
          appId: `store:${shareId}`,
          version: '1.0.0',
          status: 'active',
          source: 'store',
          capabilities: [...DEFAULT_APP_CAPABILITIES],
          html: String(row.html ?? ''),
          createdAt: now,
          createdBy: 'user',
          parentVersionId: null,
        }],
      })
    }
    await saveState(principal, state)

    // 2026-08-06 安装时复制素材：优先独立归档 store-assets/<shareId>/（发布者
    // 删除 App 后仍可用），否则回退发布者工作区 apps/<app_id>/（旧数据兼容）。
    // 复制到安装者 apps/<store:shareId>/（App 运行页 base 指向该文件夹即资源根，
    // 图片/CSS/JS 素材随之可用，独立于发布者后续修改）；index.html 镜像快照。
    const ownerKey = String(row.owner_key)
    try {
      const dstRoot = appFilesRoot(principal.key, 'app', `store:${shareId}`)
      fs.mkdirSync(dstRoot, { recursive: true })
      const archived = storeAssetsDir(shareId)
      if (fs.existsSync(archived) && fs.statSync(archived).isDirectory()) {
        fs.cpSync(archived, dstRoot, { recursive: true, force: true })
      } else {
        const srcRoot = appFilesRoot(ownerKey, 'app', String(row.app_id))
        if (fs.existsSync(srcRoot)) {
          const srcAssets = path.join(srcRoot, 'assets')
          if (fs.existsSync(srcAssets) && fs.statSync(srcAssets).isDirectory()) {
            fs.mkdirSync(path.join(dstRoot, 'assets'), { recursive: true })
            fs.cpSync(srcAssets, path.join(dstRoot, 'assets'), { recursive: true, force: true })
          }
          for (const iconName of ['icon.svg', 'icon.png', 'icon.jpg', 'icon.webp']) {
            const srcIcon = path.join(srcRoot, iconName)
            if (fs.existsSync(srcIcon) && fs.statSync(srcIcon).isFile()) {
              try { fs.copyFileSync(srcIcon, path.join(dstRoot, iconName)) } catch { /* 忽略单个失败 */ }
            }
          }
        }
      }
      try { fs.writeFileSync(path.join(dstRoot, 'index.html'), String(row.html ?? '')) } catch { /* 忽略 */ }
    } catch (error) {
      console.warn('[webos] store install assets copy failed:', error instanceof Error ? error.message : String(error))
    }

    // 下载奖励：他人安装 → 发布者 +100 积分（同一用户对同一应用只记一次）
    let reward = false
    if (ownerKey !== principal.key) {
      try {
        const dup = await pool.query('SELECT id FROM webos_store_installs WHERE share_id = $1 AND installer_key = $2', [shareId, principal.key])
        if (!dup.rows[0]) {
          await pool.query(
            `INSERT INTO webos_store_installs (id, share_id, installer_key, owner_key, created_at) VALUES ($1, $2, $3, $4, $5)`,
            [`inst-${randomUUID()}`, shareId, principal.key, ownerKey, now],
          )
          await pool.query('UPDATE webos_store_apps SET downloads = downloads + 1 WHERE id = $1', [shareId])
          reward = await grantCredits(ownerKey, STORE_REWARD_CREDITS)
        }
      } catch (error) {
        console.warn('[store] install reward failed:', error instanceof Error ? error.message : String(error))
      }
    }
    res.json({ ok: true, appId: `store:${shareId}`, message: reward ? `已安装到桌面，发布者获得 ${STORE_REWARD_CREDITS} 积分奖励` : '已安装到桌面（或已是最新）' })
  } catch (error) {
    next(error)
  }
})

/** 分享访问上报：体验页打开时调用（记录访问者；分享者本人访问不算；每访问者每应用一次） */
webosRouter.post('/store/apps/:shareId/visit', async (req, res, next) => {
  try {
    const principal = requirePrincipal(req)
    const shareId = String(req.params.shareId ?? '').replace(/[^a-zA-Z0-9-]/g, '').slice(0, 64)
    const pool = getPool()
    const result = await pool.query('SELECT owner_key FROM webos_store_apps WHERE id = $1 AND status = $2', [shareId, 'published'])
    const row = result.rows[0]
    if (!row) { res.json({ ok: false }); return }
    const ownerKey = String(row.owner_key)
    if (ownerKey === principal.key) { res.json({ ok: true, self: true }); return }
    try {
      await pool.query(
        `INSERT INTO webos_store_visits (id, share_id, visitor_key, owner_key, created_at, status)
         VALUES ($1, $2, $3, $4, $5, 'visited')
         ON CONFLICT (share_id, visitor_key) DO NOTHING`,
        [`visit-${randomUUID()}`, shareId, principal.key, ownerKey, Date.now()],
      )
    } catch { /* 已记录过 */ }
    res.json({ ok: true })
  } catch (error) {
    next(error)
  }
})

// ============================================================================
// 技能市场（2026-08-09）：应用商店改名「市场」后承载技能分发——
// ① 系统级：全局 .pi/skills-webos/ 下的 skill（design/xhs-content 等）可一键
//    安装到用户工作区 skills/<id>/（用户级副本，AI 可用 manage_skill 自定义演进）。
//    超大 skill（>2MB，如 design 33MB 素材库）标记 installable=false 不提供安装——
//    全局只读已对所有人可用，复制进每个用户工作区浪费配额。
// ② 用户发布（2026-08-18）：用户把自己工作区 skills/<id>/ 的 skill 发布到市场
//    供他人安装（对齐 App 商店发布/下架/我的 链路）；发布时归档到独立
//    store-skill-assets/<id>/，与发布者工作区解耦。
// ============================================================================

/** 解析 skill SKILL.md frontmatter（name/description） */
function parseSkillFrontmatter(filePath: string): { name: string; description: string } {
  try {
    const content = fs.readFileSync(filePath, 'utf8').slice(0, 4096)
    const m = content.match(/^---\r?\n([\s\S]*?)\r?\n---/)
    if (!m) return { name: '', description: '' }
    const name = m[1].match(/^name:\s*(.+)$/m)?.[1]?.trim() ?? ''
    const description = m[1].match(/^description:\s*(.+)$/m)?.[1]?.trim() ?? ''
    return { name, description }
  } catch {
    return { name: '', description: '' }
  }
}

/** 递归复制目录（技能安装用） */
function copyDirRecursive(src: string, dest: string): void {
  fs.mkdirSync(dest, { recursive: true })
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name)
    const d = path.join(dest, entry.name)
    if (entry.isDirectory()) copyDirRecursive(s, d)
    else if (entry.isFile()) fs.copyFileSync(s, d)
  }
}

/** 技能可安装大小上限：超过视为系统内置（全局只读已可用，不复制进用户工作区） */
const SKILL_INSTALL_MAX_BYTES = 2 * 1024 * 1024

/** 技能发布大小上限（与安装上限一致：市场所有可安装技能 ≤2MB，超大仅系统全局可用） */
const SKILL_PUBLISH_MAX_BYTES = 2 * 1024 * 1024

/** my 隐私记忆目录名：用户级私人记忆，禁止发布到市场 */
const SKILL_PRIVATE_DIRS = new Set(['myself'])

/** 市场技能条目 -> 公开结构 */
function storeSkillRowToPublic(row: Record<string, unknown>): Record<string, unknown> {
  return {
    id: String(row.id),
    skillId: String(row.skill_id),
    name: String(row.name ?? '未命名'),
    description: String(row.description ?? ''),
    ownerName: String(row.owner_name ?? '匿名'),
    sizeBytes: Number(row.size_bytes ?? 0),
    createdAt: Number(row.created_at ?? 0),
  }
}

/** 技能市场素材归档目录（用户发布条目的技能副本，与发布者工作区解耦） */
function storeSkillAssetsDir(id: string): string {
  return path.join(getSandboxRoot(), 'store-skill-assets', id)
}

/** 发布时归档：把发布者工作区 skills/<skillId>/ 复制到 store-skill-assets/<id>/（重复发布先清空） */
function archiveStoreSkillAssets(principal: Principal, skillId: string, entryId: string): void {
  try {
    const srcRoot = path.join(getUserSkillsDir(principal.key), skillId)
    const dstRoot = storeSkillAssetsDir(entryId)
    if (fs.existsSync(dstRoot)) fs.rmSync(dstRoot, { recursive: true, force: true })
    if (!fs.existsSync(srcRoot)) return
    fs.mkdirSync(dstRoot, { recursive: true })
    copyDirRecursive(srcRoot, dstRoot)
  } catch (error) {
    console.warn('[webos] store skill archive failed:', error instanceof Error ? error.message : String(error))
  }
}

/** 列出用户工作区 skills/ 下的 skill（发布选择用；排除 myself 等隐私目录） */
function listUserSkills(principal: Principal): Array<{ id: string; name: string; description: string; sizeBytes: number }> {
  const root = getUserSkillsDir(principal.key)
  const items: Array<{ id: string; name: string; description: string; sizeBytes: number }> = []
  if (!fs.existsSync(root)) return items
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const id = entry.name
    if (!SKILL_NAME_PATTERN.test(id)) continue
    if (SKILL_PRIVATE_DIRS.has(id)) continue
    const skillFile = path.join(root, id, 'SKILL.md')
    if (!fs.existsSync(skillFile)) continue
    const meta = parseSkillFrontmatter(skillFile)
    if (!meta.name || meta.name !== id) continue // frontmatter name 与目录名不一致/缺失，视为无效
    items.push({ id, name: meta.name || id, description: meta.description || '（无描述）', sizeBytes: dirTotalBytes(path.join(root, id)) })
  }
  return items
}

/** 发布技能到市场（把自己的工作区 skills/<id>/ 发布；重复发布 = 更新快照，条目 id 不变） */
webosRouter.post('/store/skills', async (req, res, next) => {
  try {
    const principal = requirePrincipal(req)
    const body = (req.body ?? {}) as { skillId?: unknown; description?: unknown }
    const skillId = typeof body.skillId === 'string' ? body.skillId.trim().slice(0, 32) : ''
    const description = typeof body.description === 'string' ? body.description.trim().slice(0, 200) : ''
    if (!skillId) { next(createError(400, 'INVALID_SKILL_ID', '缺少 skillId')); return }
    if (!SKILL_NAME_PATTERN.test(skillId)) { next(createError(400, 'INVALID_SKILL_ID', '技能 ID 非法')); return }
    if (SKILL_PRIVATE_DIRS.has(skillId)) { next(createError(403, 'SKILL_NOT_PUBLISHABLE', '该技能属于私人记忆，不能发布')); return }
    const skillDir = path.join(getUserSkillsDir(principal.key), skillId)
    const skillFile = path.join(skillDir, 'SKILL.md')
    if (!fs.existsSync(skillFile)) { next(createError(404, 'SKILL_NOT_FOUND', '你的工作区没有该技能')); return }
    const sizeBytes = dirTotalBytes(skillDir)
    if (sizeBytes > SKILL_PUBLISH_MAX_BYTES) {
      next(createError(400, 'SKILL_TOO_LARGE', `技能超过发布上限（2MB），请精简后再发布`)); return
    }
    const meta = parseSkillFrontmatter(skillFile)
    if (!meta.name || meta.name !== skillId) {
      next(createError(400, 'SKILL_INVALID_META', '技能元数据无效（SKILL.md 的 name 需与目录名一致）')); return
    }
    const pool = getPool()
    const now = Date.now()
    // 同一用户对同一技能重复发布：复用已有条目（id 不变，快照更新）
    const existing = await pool.query('SELECT id FROM webos_store_skills WHERE owner_key = $1 AND skill_id = $2', [principal.key, skillId])
    let rowId = String(existing.rows[0]?.id ?? '')
    archiveStoreSkillAssets(principal, skillId, rowId || `sk-${randomUUID().slice(0, 8)}${now.toString(36).slice(-6)}`)
    if (rowId) {
      await pool.query(
        `UPDATE webos_store_skills SET name = $1, description = $2, size_bytes = $3, updated_at = $4, status = 'published' WHERE id = $5`,
        [meta.name, description, sizeBytes, now, rowId],
      )
    } else {
      rowId = `sk-${randomUUID().slice(0, 8)}${now.toString(36).slice(-6)}`
      await pool.query(
        `INSERT INTO webos_store_skills (id, skill_id, owner_key, name, description, size_bytes, created_at, updated_at, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'published')`,
        [rowId, skillId, principal.key, meta.name, description, sizeBytes, now, now],
      )
    }
    res.json({ ok: true, shareId: rowId, message: `已发布技能「${meta.name}」到市场` })
  } catch (error) {
    next(error)
  }
})

/** 我的可用技能（工作区 skills/ 下的，发布选择用；标注是否已发布） */
webosRouter.get('/store/skills/mine', async (req, res, next) => {
  try {
    const principal = requirePrincipal(req)
    const pool = getPool()
    const publishedRows = (await pool.query('SELECT skill_id FROM webos_store_skills WHERE owner_key = $1 AND status = $2', [principal.key, 'published'])).rows
    const published = new Set(publishedRows.map((row) => String(row.skill_id)))
    const items = listUserSkills(principal).map((skill) => ({ ...skill, published: published.has(skill.id) }))
    res.json({ items })
  } catch (error) {
    next(error)
  }
})

/** 我的已发布技能（发布者视角管理/下架） */
webosRouter.get('/store/skills/my', async (req, res, next) => {
  try {
    const principal = requirePrincipal(req)
    const pool = getPool()
    const result = await pool.query(
      `SELECT s.*,
        COALESCE(u.display_name, u.username, '匿名') AS owner_name
       FROM webos_store_skills s
       LEFT JOIN users u ON u.id = REPLACE(s.owner_key, 'user:', '')
       WHERE s.owner_key = $1 AND s.status = 'published'
       ORDER BY s.created_at DESC`,
      [principal.key],
    )
    res.json({ items: result.rows.map((row) => storeSkillRowToPublic(row)) })
  } catch (error) {
    next(error)
  }
})

/** 下架已发布技能（仅发布者本人） */
webosRouter.delete('/store/skills/:id', async (req, res, next) => {
  try {
    const principal = requirePrincipal(req)
    const id = String(req.params.id ?? '').replace(/[^a-zA-Z0-9-]/g, '').slice(0, 64)
    if (!id) { next(createError(400, 'INVALID_SKILL_ID', '无效的技能条目 ID')); return }
    const pool = getPool()
    const result = await pool.query('SELECT owner_key FROM webos_store_skills WHERE id = $1', [id])
    if (!result.rows[0]) { next(createError(404, 'STORE_SKILL_NOT_FOUND', '该技能条目不存在')); return }
    if (String(result.rows[0].owner_key) !== principal.key) {
      next(createError(403, 'STORE_NOT_OWNER', '只有发布者可以下架')); return
    }
    await pool.query(`UPDATE webos_store_skills SET status = 'unpublished' WHERE id = $1`, [id])
    res.json({ ok: true, message: '已下架' })
  } catch (error) {
    next(error)
  }
})

/** 列出市场技能：系统级（全局 .pi/skills-webos/）+ 用户发布（webos_store_skills 表） */
webosRouter.get('/store/skills', async (req, res, next) => {
  try {
    const principal = requirePrincipal(req)
    const pool = getPool()
    const globalDir = SKILLS_WEBOS_DIR
    const userSkills = getUserSkillsDir(principal.key)
    const items: Array<Record<string, unknown>> = []
    if (fs.existsSync(globalDir)) {
      for (const entry of fs.readdirSync(globalDir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue
        const skillDir = path.join(globalDir, entry.name)
        const skillFile = path.join(skillDir, 'SKILL.md')
        if (!fs.existsSync(skillFile)) continue
        const meta = parseSkillFrontmatter(skillFile)
        const id = meta.name || entry.name
        if (!SKILL_NAME_PATTERN.test(id)) continue
        const sizeBytes = dirTotalBytes(skillDir)
        const installed = fs.existsSync(path.join(userSkills, id, 'SKILL.md'))
        items.push({
          id,
          name: id,
          description: meta.description || '（无描述）',
          sizeBytes,
          installable: sizeBytes <= SKILL_INSTALL_MAX_BYTES,
          installed,
          system: true,
        })
      }
    }
    // 2026-08-18 用户发布条目（可安装到任意用户工作区；安装时传条目 id=sk-xxx 或 skill_id）
    const publishedRows = (await pool.query(
      `SELECT s.*,
        COALESCE(u.display_name, u.username, '匿名') AS owner_name
       FROM webos_store_skills s
       LEFT JOIN users u ON u.id = REPLACE(s.owner_key, 'user:', '')
       WHERE s.status = 'published'
       ORDER BY s.created_at DESC
       LIMIT 100`,
    )).rows
    for (const row of publishedRows) {
      const sid = String(row.skill_id)
      if (!SKILL_NAME_PATTERN.test(sid)) continue
      const sizeBytes = Number(row.size_bytes ?? 0)
      items.push({
        id: String(row.id),
        skillId: sid,
        name: String(row.name ?? sid),
        description: String(row.description ?? '（无描述）'),
        sizeBytes,
        installable: sizeBytes <= SKILL_INSTALL_MAX_BYTES,
        installed: fs.existsSync(path.join(userSkills, sid, 'SKILL.md')),
        ownerName: String(row.owner_name ?? '匿名'),
        system: false,
      })
    }
    res.json({ items })
  } catch (error) {
    next(error)
  }
})

/** 安装技能到用户工作区 skills/<id>/（用户级副本，AI 可用 manage_skill 自定义演进）
 * 2026-08-18 支持来源二选一：① 用户发布条目（传条目 id=sk-xxx 或 skill_id，从归档复制）；
 * ② 系统级全局 skill（design/xhs-content 等，skillRef 为全局目录名）。 */
webosRouter.post('/store/skills/:skillId/install', async (req, res, next) => {
  try {
    const principal = requirePrincipal(req)
    const skillRef = String(req.params.skillId ?? '').replace(/[^a-z0-9-]/g, '').slice(0, 64)
    if (!SKILL_NAME_PATTERN.test(skillRef)) {
      next(createError(400, 'INVALID_SKILL_ID', '技能 ID 非法')); return
    }
    const pool = getPool()
    // 用户发布条目优先（id=sk-xxx 或 skill_id 都匹配，同名取最新一条）
    const publishedRow = (await pool.query(
      `SELECT * FROM webos_store_skills WHERE status = 'published' AND (id = $1 OR skill_id = $1) ORDER BY created_at DESC LIMIT 1`,
      [skillRef],
    )).rows[0]
    if (publishedRow) {
      const entryId = String(publishedRow.id)
      const skillId = String(publishedRow.skill_id)
      if (!SKILL_NAME_PATTERN.test(skillId)) {
        next(createError(400, 'INVALID_SKILL_ID', '技能 ID 非法')); return
      }
      // 优先读独立归档（发布者删技能后仍可安装），否则回退发布者工作区（旧数据兼容）
      let src = storeSkillAssetsDir(entryId)
      if (!fs.existsSync(path.join(src, 'SKILL.md'))) {
        src = path.join(getUserSkillsDir(String(publishedRow.owner_key)), skillId)
      }
      if (!fs.existsSync(path.join(src, 'SKILL.md'))) {
        next(createError(404, 'SKILL_NOT_FOUND', '该技能的内容不存在')); return
      }
      const sizeBytes = dirTotalBytes(src)
      if (sizeBytes > SKILL_INSTALL_MAX_BYTES) {
        next(createError(400, 'SKILL_TOO_LARGE', '该技能太大，无法安装')); return
      }
      const dest = path.join(getUserSkillsDir(principal.key), skillId)
      copyDirRecursive(src, dest)
      console.log(`[store] skill installed (user): ${skillId} (${entryId}) → ${principal.key.slice(0, 12)} (${sizeBytes} B)`)
      res.json({ ok: true, skillId, message: `已安装技能「${skillId}」，AI 立即可用（可在对话中让它自定义演进）` })
      return
    }
    // 系统级全局 skill
    const src = path.join(SKILLS_WEBOS_DIR, skillRef)
    const skillFile = path.join(src, 'SKILL.md')
    if (!fs.existsSync(skillFile)) {
      next(createError(404, 'SKILL_NOT_FOUND', '技能不存在')); return
    }
    const sizeBytes = dirTotalBytes(src)
    if (sizeBytes > SKILL_INSTALL_MAX_BYTES) {
      next(createError(400, 'SKILL_BUILTIN', '该技能为系统内置，无需安装')); return
    }
    // 校验 frontmatter name 与目录名一致（防目录名伪造）
    const meta = parseSkillFrontmatter(skillFile)
    if (!meta.name || meta.name !== skillRef) {
      next(createError(400, 'SKILL_INVALID_META', '技能元数据无效')); return
    }
    const dest = path.join(getUserSkillsDir(principal.key), skillRef)
    copyDirRecursive(src, dest)
    console.log(`[store] skill installed: ${skillRef} → ${principal.key.slice(0, 12)} (${sizeBytes} B)`)
    res.json({ ok: true, skillId: skillRef, message: `已安装技能「${skillRef}」，AI 立即可用（可在对话中让它自定义演进）` })
  } catch (error) {
    next(error)
  }
})

/** 导出源码 zip：index.html + assets/（HTML 相对引用保持结构；公开条目可直接下载） */
webosRouter.get('/store/apps/:shareId/export', async (req, res, next) => {
  try {
    const principal = requirePrincipal(req)
    const shareId = String(req.params.shareId ?? '').replace(/[^a-zA-Z0-9-]/g, '').slice(0, 64)
    const pool = getPool()
    const result = await pool.query('SELECT * FROM webos_store_apps WHERE id = $1 AND status = $2', [shareId, 'published'])
    const row = result.rows[0]
    if (!row) { next(createError(404, 'STORE_APP_NOT_FOUND', '该应用不存在或已下架')); return }
    // 资源从发布者工作区读取（快照 html + 发布者 assets）
    const ownerKey = String(row.owner_key)
    const ownerPrincipal: Principal = ownerKey.startsWith('guest:')
      ? { key: ownerKey, id: `guest-${ownerKey.slice(6)}`, deviceId: ownerKey.slice(6), guest: true, role: 'guest' }
      : { key: ownerKey, id: ownerKey.slice(5), deviceId: `account-${ownerKey.slice(5)}`, guest: false, role: 'member' }
    const files = collectAppExportFiles(ownerPrincipal, String(row.app_id), String(row.html ?? ''))
    const zip = buildZip(files)
    const safeName = String(row.name ?? 'app').replace(/[^\w\u4e00-\u9fa5-]+/g, '_').slice(0, 40)
    res.setHeader('Content-Type', 'application/zip')
    res.setHeader('Content-Disposition', `attachment; filename="${safeName}.zip"`)
    res.setHeader('Cache-Control', 'no-store')
    res.send(zip)
  } catch (error) {
    next(error)
  }
})

/** 外部 API 代理（2026-08-03）：App 接入第三方/自建 API（如 uapis.cn），防 SSRF + 限频 */
const httpProxyRateMap = new Map<string, { count: number; windowStart: number }>()
webosRouter.post('/http', async (req, res, next) => {
  try {
    const principal = requirePrincipal(req)
    const now = Date.now()
    const rate = httpProxyRateMap.get(principal.key)
    if (!rate || now - rate.windowStart >= 60_000) {
      httpProxyRateMap.set(principal.key, { count: 1, windowStart: now })
    } else if (rate.count >= HTTP_PROXY_RATE_PER_MINUTE) {
      next(createError(429, 'PROXY_RATE_LIMITED', '外部 API 请求太频繁，请稍后再试'))
      return
    } else {
      rate.count += 1
    }
    const result = await proxyHttp(principal, (req.body ?? {}) as { method?: unknown; url?: unknown; headers?: unknown; body?: unknown })
    res.json(result)
  } catch (error) {
    next(error)
  }
})


webosRouter.get('/apps', async (req, res, next) => {
  try {
    const principal = requirePrincipal(req)
    const state = await loadState(principal)
    res.json({ apps: buildBootstrap(principal, state).apps })
  } catch (error) {
    next(error)
  }
})

webosRouter.post('/apps', async (req, res, next) => {
  try {
    const principal = requirePrincipal(req)
    const body = req.body as { name?: unknown; html?: unknown; source?: unknown }
    // 2026-08-20 「粘贴 HTML 创建 App」放开外部资源：仅 local_import（用户显式粘贴，地位等同
    // 手工维护自己的静态 App）；AI 生成（source=ai_generated）仍保持严格，防止幻觉 URL/供应链依赖。
    const html = validateAppHtml(body.html, { allowExternalResources: body.source === 'local_import' })
    const state = await loadState(principal)
    assertAppHtmlRoom(principal, null, html, state)
    const source = body.source === 'local_import' ? 'local_import' : 'ai_generated'
    const app = newApp(principal, normalizeAppName(body.name), html, source)
    state.apps.unshift(app)
    await saveState(principal, state)
    // 同步工作区源码镜像（apps/<appId>/index.html）
    writeAppSourceMirror(principal, app.id, html)
    res.status(201).json({ app, permission: { capabilities: [PRIVATE_STORAGE_CAPABILITY] } })
  } catch (error) {
    next(error)
  }
})

// 桌面图标排序：appIds 只包含用户 App（builtin 固定在前的除外），按传入顺序重排
webosRouter.put('/apps/order', async (req, res, next) => {
  try {
    const principal = requirePrincipal(req)
    const state = await loadState(principal)
    const body = req.body as { appIds?: unknown }
    const appIds = Array.isArray(body.appIds)
      ? body.appIds.filter((item): item is string => typeof item === 'string')
      : []
    const owned = new Set(state.apps.filter((app) => app.source !== 'builtin').map((app) => app.id))
    const ordered = appIds.filter((id) => owned.has(id))
    if (ordered.length !== owned.size) {
      next(createError(400, 'INVALID_APP_ORDER', '排序列表必须包含全部用户 App'))
      return
    }
    const builtin = state.apps.filter((app) => app.source === 'builtin')
    const rest = state.apps.filter((app) => app.source !== 'builtin')
    const byId = new Map(rest.map((app) => [app.id, app]))
    state.apps = [...builtin, ...ordered.map((id) => byId.get(id)!).filter(Boolean)]
    await saveState(principal, state)
    res.json({ ok: true, apps: state.apps.map((app) => app.id) })
  } catch (error) {
    next(error)
  }
})

webosRouter.get('/apps/:appId/storage', async (req, res, next) => {
  try {
    const principal = requirePrincipal(req)
    const state = await loadState(principal)
    findApp(state, req.params.appId)
    res.json({ items: state.appStorage[req.params.appId] ?? {} })
  } catch (error) {
    next(error)
  }
})

webosRouter.get('/apps/:appId/storage/:key', async (req, res, next) => {
  try {
    const principal = requirePrincipal(req)
    const state = await loadState(principal)
    findApp(state, req.params.appId)
    const key = req.params.key
    const items = state.appStorage[req.params.appId] ?? {}
    if (!Object.prototype.hasOwnProperty.call(items, key)) {
      next(createError(404, 'APP_STORAGE_KEY_NOT_FOUND', '找不到该 App 私有数据'))
      return
    }
    res.json({ key, value: items[key] })
  } catch (error) {
    next(error)
  }
})

webosRouter.put('/apps/:appId/storage/:key', async (req, res, next) => {
  try {
    const principal = requirePrincipal(req)
    const state = await loadState(principal)
    findApp(state, req.params.appId)
    const key = req.params.key
    if (!/^[a-zA-Z0-9._-]{1,64}$/.test(key)) {
      next(createError(400, 'INVALID_APP_STORAGE_KEY', '私有数据 key 格式不正确'))
      return
    }
    const value = (req.body as { value?: unknown }).value
    let encoded: string
    try {
      encoded = JSON.stringify(value)
    } catch {
      next(createError(400, 'INVALID_APP_STORAGE_VALUE', '私有数据必须可序列化'))
      return
    }
    const current = { ...(state.appStorage[req.params.appId] ?? {}) }
    current[key] = value
    // 2026-08-12 取消单项/固定总量限制：App 私有数据计入工作区总配额
    //（磁盘文件 + App 数据 之和 ≤ 工作区空间），空间满了自然写不进。
    const storageBytes = new TextEncoder().encode(JSON.stringify(current)).byteLength
    try {
      assertWorkspaceRoom(principal, 0, storageBytes, state)
    } catch (error) {
      next(error)
      return
    }
    state.appStorage[req.params.appId] = current
    await saveState(principal, state)
    res.json({ key, value })
  } catch (error) {
    next(error)
  }
})

webosRouter.delete('/apps/:appId/storage/:key', async (req, res, next) => {
  try {
    const principal = requirePrincipal(req)
    const state = await loadState(principal)
    findApp(state, req.params.appId)
    const current = { ...(state.appStorage[req.params.appId] ?? {}) }
    delete current[req.params.key]
    state.appStorage[req.params.appId] = current
    await saveState(principal, state)
    res.json({ ok: true })
  } catch (error) {
    next(error)
  }
})

// ---------------------------------------------------------------------------
// App 文件系统（每个 App 一个文件夹 + 跨 App 共享区）
//   GET    /apps/:appId/files?scope=app|shared&path=dir   列出目录
//   GET    /apps/:appId/files/content?scope=&path=        读取文件（UTF-8 文本）
//   PUT    /apps/:appId/files?scope=&path=  body{content} 写入文件
//   POST   /apps/:appId/files?scope=&path=                创建目录（可递归）
//   DELETE /apps/:appId/files?scope=&path=                删除文件或空目录
// 能力：scope=app 需要 app.fs；scope=shared 需要 app.fs.shared。
// 磁盘根：<workspace>/apps/<appId>/ 与 <workspace>/shared/（与 AI 工作区同一磁盘）。
// ---------------------------------------------------------------------------
// 2026-08-12 取消单文件大小限制（原 8MB）：App 文件与工作区其他内容共享
// 同一空间池（游客 200MB / 登录 512MB / 月卡档位），空间满了自然写不进。

function appFsScope(value: unknown): 'app' | 'shared' {
  if (value === 'app' || value === 'shared') return value
  throw createError(400, 'INVALID_APP_FS_SCOPE', 'scope 必须为 app 或 shared')
}

function appFsCapabilityFor(scope: 'app' | 'shared'): string {
  return scope === 'app' ? APP_FS_CAPABILITY : APP_FS_SHARED_CAPABILITY
}

/** 校验 App 存在且 active 版本声明了对应文件能力 */
function requireAppFsCapability(state: StoredState, appId: string, scope: 'app' | 'shared'): StoredApp {
  const app = findApp(state, appId)
  const active = app.versions.find((candidate) => candidate.id === app.activeVersionId)
  const declared = active ? active.capabilities : []
  if (!declared.includes(appFsCapabilityFor(scope))) {
    throw createError(403, 'APP_FS_CAPABILITY_MISSING', `App 未声明 ${appFsCapabilityFor(scope)} 能力`)
  }
  return app
}

/** App 文件路由统一错误转换：路径校验 → 400，文件不存在 → 404，权限 → 403，其余 500 */
function appFsError(error: unknown, next: (err: unknown) => void): void {
  if (error instanceof Error && /越界|非法|scope/.test(error.message)) {
    next(createError(400, 'APP_FS_INVALID_PATH', error.message))
    return
  }
  const code = (error as NodeJS.ErrnoException).code
  if (code === 'ENOENT' || code === 'ENOTDIR') {
    next(createError(404, 'APP_FS_NOT_FOUND', '文件或目录不存在'))
    return
  }
  if (code === 'EACCES' || code === 'EPERM') {
    next(createError(403, 'APP_FS_FORBIDDEN', '无权访问该路径'))
    return
  }
  next(error)
}

webosRouter.get('/apps/:appId/files', async (req, res, next) => {
  try {
    const principal = requirePrincipal(req)
    const state = await loadState(principal)
    const scope = appFsScope(req.query.scope)
    requireAppFsCapability(state, req.params.appId, scope)
    const dir = resolveAppFilePath(principal.key, scope, req.params.appId, typeof req.query.path === 'string' ? req.query.path : '.')
    const stat = fs.statSync(dir)
    if (!stat.isDirectory()) throw createError(400, 'APP_FS_NOT_DIR', 'path 不是目录')
    const entries = fs.readdirSync(dir, { withFileTypes: true })
      .slice(0, 500)
      .map((entry) => {
        const full = path.join(dir, entry.name)
        let info: { type: string; size: number; modifiedAt: number } = { type: 'file', size: 0, modifiedAt: 0 }
        try {
          const s = fs.statSync(full)
          info = { type: s.isDirectory() ? 'dir' : 'file', size: s.isDirectory() ? 0 : s.size, modifiedAt: s.mtimeMs }
        } catch { /* ignore */ }
        return { name: entry.name, ...info }
      })
    res.json({ scope, path: typeof req.query.path === 'string' ? req.query.path : '.', entries })
  } catch (error) {
    appFsError(error, next)
  }
})

webosRouter.get('/apps/:appId/files/content', async (req, res, next) => {
  try {
    const principal = requirePrincipal(req)
    const state = await loadState(principal)
    const scope = appFsScope(req.query.scope)
    requireAppFsCapability(state, req.params.appId, scope)
    const filePath = typeof req.query.path === 'string' && req.query.path ? req.query.path : null
    if (!filePath) throw createError(400, 'APP_FS_PATH_REQUIRED', 'path 必填')
    const full = resolveAppFilePath(principal.key, scope, req.params.appId, filePath)
    const stat = fs.statSync(full)
    if (!stat.isFile()) throw createError(400, 'APP_FS_NOT_FILE', 'path 不是文件')
    const content = fs.readFileSync(full, 'utf-8')
    res.json({ scope, path: filePath, size: stat.size, content })
  } catch (error) {
    appFsError(error, next)
  }
})

// ---------------------------------------------------------------------------
// App 私有文件 raw 读取（2026-08-04）：返回文件字节（图片/音频等二进制），
// MIME 按扩展名。App 运行时（srcdoc iframe）通过 <base> 注入后可用
// `/webos/api/apps/<appId>/files/raw?path=assets/xxx.png` 直接显示本地图片。
// 与 files/content（UTF-8 文本）区分：content 用于读写代码/数据，raw 用于展示。
// ---------------------------------------------------------------------------
const RAW_MIME: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif',
  svg: 'image/svg+xml', ico: 'image/x-icon', bmp: 'image/bmp',
  mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', m4a: 'audio/mp4',
  mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime',
  json: 'application/json', txt: 'text/plain', md: 'text/markdown', html: 'text/html', css: 'text/css', js: 'text/javascript',
  pdf: 'application/pdf', zip: 'application/zip', wasm: 'application/wasm',
}
function rawMimeFor(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  return RAW_MIME[ext] ?? 'application/octet-stream'
}

webosRouter.get('/apps/:appId/files/raw', async (req, res, next) => {
  try {
    const principal = requirePrincipal(req)
    const state = await loadState(principal)
    const scope = appFsScope(req.query.scope)
    requireAppFsCapability(state, req.params.appId, scope)
    const filePath = typeof req.query.path === 'string' && req.query.path ? req.query.path : null
    if (!filePath) throw createError(400, 'APP_FS_PATH_REQUIRED', 'path 必填')
    const full = resolveAppFilePath(principal.key, scope, req.params.appId, filePath)
    const stat = fs.statSync(full)
    if (!stat.isFile()) throw createError(400, 'APP_FS_NOT_FILE', 'path 不是文件')
    res.setHeader('Content-Type', rawMimeFor(filePath))
    res.setHeader('Cache-Control', 'private, max-age=300')
    fs.createReadStream(full).pipe(res)
  } catch (error) {
    appFsError(error, next)
  }
})

// 2026-08-06 path 式 raw 路由（<base href=".../files/raw/">）：相对路径
// assets/xxx.png 解析为 /apps/:appId/files/raw/assets/xxx.png（query 式 base
// 会丢参数导致图片 404——App 运行页与分享页统一改用此式）。同样用 use 前缀
// 中间件（Express5 *splat 会把 / 转成逗号）。
webosRouter.use('/apps/:appId/files/raw', async (req, res, next) => {
  try {
    if (req.method !== 'GET') { next(); return }
    const rest = decodeURIComponent(req.url.replace(/^\//, ''))
    if (!rest) { next(); return }
    const principal = requirePrincipal(req)
    const state = await loadState(principal)
    const scope = appFsScope(req.query.scope)
    requireAppFsCapability(state, (req.params as { appId?: string }).appId ?? '', scope)
    const filePath = rest
    if (!filePath) throw createError(400, 'APP_FS_PATH_REQUIRED', 'path 必填')
    const full = resolveAppFilePath(principal.key, scope, (req.params as { appId?: string }).appId, filePath)
    const stat = fs.statSync(full)
    if (!stat.isFile()) throw createError(400, 'APP_FS_NOT_FILE', 'path 不是文件')
    res.setHeader('Content-Type', rawMimeFor(filePath))
    res.setHeader('Cache-Control', 'private, max-age=300')
    fs.createReadStream(full).pipe(res)
  } catch (error) {
    appFsError(error, next)
  }
})

webosRouter.put('/apps/:appId/files', async (req, res, next) => {
  try {
    const principal = requirePrincipal(req)
    const state = await loadState(principal)
    const scope = appFsScope(req.query.scope)
    requireAppFsCapability(state, req.params.appId, scope)
    const filePath = typeof req.query.path === 'string' && req.query.path ? req.query.path : null
    if (!filePath) throw createError(400, 'APP_FS_PATH_REQUIRED', 'path 必填')
    const content = (req.body as { content?: unknown }).content
    if (typeof content !== 'string') throw createError(400, 'APP_FS_CONTENT_REQUIRED', 'content 必须为字符串')
    const bytes = Buffer.byteLength(content, 'utf-8')
    const full = resolveAppFilePath(principal.key, scope, req.params.appId, filePath)
    // 2026-08-12 取消单文件大小限制：只受工作区总配额约束
    //（仅新增/覆盖变大时检查，避免每次写入全量遍历）
    const oldSize = fs.existsSync(full) && fs.statSync(full).isFile() ? fs.statSync(full).size : 0
    if (bytes > oldSize) {
      assertWorkspaceRoom(principal, bytes - oldSize, 0, state)
    }
    fs.mkdirSync(path.dirname(full), { recursive: true })
    fs.writeFileSync(full, content, 'utf-8')
    res.json({ ok: true, scope, path: filePath, bytes })
  } catch (error) {
    appFsError(error, next)
  }
})

webosRouter.post('/apps/:appId/files', async (req, res, next) => {
  try {
    const principal = requirePrincipal(req)
    const state = await loadState(principal)
    const scope = appFsScope(req.query.scope)
    requireAppFsCapability(state, req.params.appId, scope)
    const dirPath = typeof req.query.path === 'string' && req.query.path ? req.query.path : null
    if (!dirPath) throw createError(400, 'APP_FS_PATH_REQUIRED', 'path 必填')
    const full = resolveAppFilePath(principal.key, scope, req.params.appId, dirPath)
    fs.mkdirSync(full, { recursive: true })
    res.json({ ok: true, scope, path: dirPath })
  } catch (error) {
    appFsError(error, next)
  }
})

webosRouter.delete('/apps/:appId/files', async (req, res, next) => {
  try {
    const principal = requirePrincipal(req)
    const state = await loadState(principal)
    const scope = appFsScope(req.query.scope)
    requireAppFsCapability(state, req.params.appId, scope)
    const filePath = typeof req.query.path === 'string' && req.query.path ? req.query.path : null
    if (!filePath) throw createError(400, 'APP_FS_PATH_REQUIRED', 'path 必填')
    const full = resolveAppFilePath(principal.key, scope, req.params.appId, filePath)
    const stat = fs.statSync(full)
    if (stat.isDirectory()) fs.rmdirSync(full)
    else fs.unlinkSync(full)
    res.json({ ok: true, scope, path: filePath })
  } catch (error) {
    appFsError(error, next)
  }
})

webosRouter.post('/apps/:appId/install', async (req, res, next) => {
  try {
    const principal = requirePrincipal(req)
    const state = await loadState(principal)
    const app = findApp(state, req.params.appId)
    const requestedVersionId = (req.body as { versionId?: unknown }).versionId
    const version = typeof requestedVersionId === 'string'
      ? app.versions.find((candidate) => candidate.id === requestedVersionId)
      : app.versions.find((candidate) => candidate.status === 'ready' || candidate.status === 'active')
    if (!version) {
      next(createError(409, 'APP_VERSION_NOT_READY', '没有可安装的 App 版本'))
      return
    }
    for (const candidate of app.versions) {
      if (candidate.id !== version.id && candidate.status === 'active') candidate.status = 'rolled_back'
    }
    version.status = 'active'
    app.activeVersionId = version.id
    app.installed = true
    // 切换版本后同步工作区源码镜像，避免下次 bootstrap 误判为「AI 改动」
    if (version.html) writeAppSourceMirror(principal, app.id, version.html)
    await saveState(principal, state)
    res.json({ app })
  } catch (error) {
    next(error)
  }
})

webosRouter.post('/apps/:appId/versions', async (req, res, next) => {
  try {
    const principal = requirePrincipal(req)
    const state = await loadState(principal)
    const app = findApp(state, req.params.appId)
    const body = req.body as { html?: unknown; capabilities?: unknown }
    // 2026-08-20 与创建入口对齐：仅「用户粘贴导入的 App」后续编辑放开外部资源；AI 生成保持严格
    const html = validateAppHtml(body.html, { allowExternalResources: app.source === 'local_import' })
    assertAppHtmlRoom(principal, req.params.appId, html, state)
    const version: StoredVersion = {
      id: `version-${randomUUID()}`,
      appId: app.id,
      version: nextVersion(app),
      status: 'ready',
      source: app.source === 'local_import' ? 'local_import' : 'ai_generated',
      capabilities: allowedCapabilities(body.capabilities),
      html,
      createdAt: Date.now(),
      createdBy: principal.guest ? 'guest' : 'user',
      parentVersionId: app.activeVersionId,
    }
    app.versions.push(version)
    await saveState(principal, state)
    res.status(201).json({ version, app })
  } catch (error) {
    next(error)
  }
})

webosRouter.put('/apps/:appId/active-version', async (req, res, next) => {
  try {
    const principal = requirePrincipal(req)
    const state = await loadState(principal)
    const app = findApp(state, req.params.appId)
    const versionId = (req.body as { versionId?: unknown }).versionId
    if (typeof versionId !== 'string') {
      next(createError(400, 'INVALID_VERSION_ID', 'versionId 必填'))
      return
    }
    const version = app.versions.find((candidate) => candidate.id === versionId)
    if (!version) {
      next(createError(404, 'APP_VERSION_NOT_FOUND', '找不到该 App 版本'))
      return
    }
    for (const candidate of app.versions) {
      if (candidate.id !== version.id && candidate.status === 'active') candidate.status = 'rolled_back'
    }
    version.status = 'active'
    app.activeVersionId = version.id
    app.installed = true
    // 切换版本后同步工作区源码镜像，避免下次 bootstrap 误判为「AI 改动」
    if (version.html) writeAppSourceMirror(principal, app.id, version.html)
    await saveState(principal, state)
    res.json({ app })
  } catch (error) {
    next(error)
  }
})

webosRouter.post('/apps/:appId/rollback', async (req, res, next) => {
  try {
    const principal = requirePrincipal(req)
    const state = await loadState(principal)
    const app = findApp(state, req.params.appId)
    const versionId = (req.body as { versionId?: unknown }).versionId
    if (typeof versionId !== 'string') {
      next(createError(400, 'INVALID_VERSION_ID', 'versionId 必填'))
      return
    }
    const version = app.versions.find((candidate) => candidate.id === versionId)
    if (!version) {
      next(createError(404, 'APP_VERSION_NOT_FOUND', '找不到该 App 版本'))
      return
    }
    for (const candidate of app.versions) {
      if (candidate.id !== version.id && candidate.status === 'active') candidate.status = 'rolled_back'
    }
    version.status = 'active'
    app.activeVersionId = version.id
    app.installed = true
    // 回滚后同步工作区源码镜像（以回滚版本为准，AI 后续改动会再触发新版本）
    if (version.html) writeAppSourceMirror(principal, app.id, version.html)
    await saveState(principal, state)
    res.json({ app, rolledBackTo: version.id })
  } catch (error) {
    next(error)
  }
})

webosRouter.delete('/apps/:appId', async (req, res, next) => {
  try {
    const principal = requirePrincipal(req)
    const state = await loadState(principal)
    // 「AI 即系统」保护：system.desktop 是系统桌面（版本化 HTML App），不可删除
    if (req.params.appId === 'system.desktop') {
      next(createError(403, 'SYSTEM_APP_PROTECTED', '系统桌面（system.desktop）是系统 App，不允许删除'))
      return
    }
    const before = state.apps.length
    state.apps = state.apps.filter((app) => app.id !== req.params.appId)
    if (state.apps.length === before) {
      next(createError(404, 'APP_NOT_FOUND', '找不到该 App'))
      return
    }
    delete state.appStorage[req.params.appId]
    await saveState(principal, state)
    // 2026-08-06 删除 = 移入回收站（apps/.trash/<appId>/），AI 可读取/恢复/彻底删除
    moveAppToTrash(principal, req.params.appId)
    res.json({ ok: true, trash: `apps/${APP_TRASH_DIR}/${req.params.appId}` })
  } catch (error) {
    next(error)
  }
})

// ============================================================================
// 回收站 API（2026-08-06）：删除的 App 在 apps/.trash/<appId>/，可恢复/彻底删除。
// 必须在 /apps/:appId 路由之前注册（否则 'trash' 会被当作 appId 匹配）。
// ============================================================================

/** 回收站列表（.trash/<appId>/；name 从 index.html <title> 提取，图标内联 base64） */
webosRouter.get('/apps/trash', (req, res, next) => {
  try {
    const principal = requirePrincipal(req)
    const appsRoot = path.join(getWorkspaceRoot(principal.key), 'apps')
    const trashRoot = path.join(appsRoot, APP_TRASH_DIR)
    if (!fs.existsSync(trashRoot)) { res.json({ items: [] }); return }
    const items: Array<{ appId: string; name: string; size: number; deletedAt: number; icon: string | null }> = []
    for (const entry of fs.readdirSync(trashRoot, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue
      const dir = path.join(trashRoot, entry.name)
      let stat: fs.Stats
      try { stat = fs.statSync(dir) } catch { continue }
      let name = entry.name
      try {
        const indexFile = path.join(dir, 'index.html')
        if (fs.existsSync(indexFile)) {
          const m = fs.readFileSync(indexFile, 'utf-8').match(/<title[^>]*>([^<]*)<\/title>/i)
          if (m?.[1]?.trim()) name = m[1].trim().slice(0, 60)
        }
      } catch { /* 忽略 */ }
      // 图标（svg 文本 / png base64，≤512KB）
      let icon: string | null = null
      try {
        for (const iconName of ['icon.svg', 'icon.png', 'icon.jpg', 'icon.webp']) {
          const iconFile = path.join(dir, iconName)
          if (!fs.existsSync(iconFile) || !fs.statSync(iconFile).isFile()) continue
          const size = fs.statSync(iconFile).size
          if (size > 512 * 1024) continue
          if (iconName === 'icon.svg') {
            const text = fs.readFileSync(iconFile, 'utf-8').trim()
            if (text.startsWith('<svg')) { icon = text; break }
            continue
          }
          icon = `data:${rawMimeFor(iconName)};base64,${fs.readFileSync(iconFile).toString('base64')}`
          break
        }
      } catch { /* 忽略 */ }
      items.push({ appId: entry.name, name, size: stat.size, deletedAt: stat.mtimeMs, icon })
    }
    items.sort((a, b) => b.deletedAt - a.deletedAt)
    res.json({ items })
  } catch (error) {
    next(error)
  }
})

/** 恢复：把 .trash/<appId>/ 移回 apps/<appId>/（下次 loadState 自动重新注册） */
webosRouter.post('/apps/trash/:appId/restore', async (req, res, next) => {
  try {
    const principal = requirePrincipal(req)
    const appId = String(req.params.appId ?? '').replace(/[^\p{L}\p{N} ._:-]/gu, '').slice(0, 128)
    if (!appId || !APP_ID_PATTERN.test(appId)) { next(createError(400, 'INVALID_APP_ID', '无效的 App id')); return }
    const appsRoot = path.join(getWorkspaceRoot(principal.key), 'apps')
    const trashDir = path.join(appsRoot, APP_TRASH_DIR, appId)
    const target = path.join(appsRoot, appId)
    if (!fs.existsSync(trashDir)) { next(createError(404, 'TRASH_ITEM_NOT_FOUND', '回收站中没有该项目')); return }
    if (fs.existsSync(target)) {
      // 目标已存在（同名 App 重建）：合并——保留现有，删除回收站副本
      fs.rmSync(trashDir, { recursive: true, force: true })
      res.json({ ok: true, merged: true, message: '已存在同名 App，回收站副本已移除' })
      return
    }
    fs.renameSync(trashDir, target)
    // 立即注册（文件夹即 App）
    const state = await loadState(principal)
    if (syncAppsFromWorkspaceFolders(principal, state)) await saveState(principal, state)
    res.json({ ok: true, appId })
  } catch (error) {
    next(error)
  }
})

/** 彻底删除 .trash/<appId>/（不可恢复） */
webosRouter.delete('/apps/trash/:appId', (req, res, next) => {
  try {
    const principal = requirePrincipal(req)
    const appId = String(req.params.appId ?? '').replace(/[^\p{L}\p{N} ._:-]/gu, '').slice(0, 128)
    if (!appId || !APP_ID_PATTERN.test(appId)) { next(createError(400, 'INVALID_APP_ID', '无效的 App id')); return }
    const dir = path.join(getWorkspaceRoot(principal.key), 'apps', APP_TRASH_DIR, appId)
    if (!fs.existsSync(dir)) { next(createError(404, 'TRASH_ITEM_NOT_FOUND', '回收站中没有该项目')); return }
    fs.rmSync(dir, { recursive: true, force: true })
    res.json({ ok: true })
  } catch (error) {
    next(error)
  }
})

/** 清空回收站 */
webosRouter.post('/apps/trash/empty', (req, res, next) => {
  try {
    const principal = requirePrincipal(req)
    const trashRoot = path.join(getWorkspaceRoot(principal.key), 'apps', APP_TRASH_DIR)
    if (fs.existsSync(trashRoot)) fs.rmSync(trashRoot, { recursive: true, force: true })
    res.json({ ok: true })
  } catch (error) {
    next(error)
  }
})

webosRouter.get('/apps/:appId', async (req, res, next) => {
  try {
    const principal = requirePrincipal(req)
    const state = await loadState(principal)
    const app = findApp(state, req.params.appId)
    // 工作区源码镜像同步：AI 直接改文件后，打开 App 即自动发布新版本
    if (syncAppSourceFromWorkspace(principal, app)) await saveState(principal, state)
    // 「文件夹即 App」：App 详情也返回文件夹图标（文件优先）
    app.icon = readAppIconFile(principal, app.id) ?? app.icon ?? null
    res.json({ app })
  } catch (error) {
    next(error)
  }
})

// ---------------------------------------------------------------------------
// Email verification and payment provider boundaries
// ---------------------------------------------------------------------------

async function markEmailUnavailable(principal: Principal, state: StoredState): Promise<void> {
  state.email = { state: 'verification_unavailable', boundEmail: state.email.boundEmail }
  await saveState(principal, state)
}

webosRouter.get('/email', async (req, res, next) => {
  try {
    const principal = requirePrincipal(req)
    const state = await loadState(principal)
    res.json(state.email)
  } catch (error) {
    next(error)
  }
})

webosRouter.post('/email/send-code', async (req, res, next) => {
  try {
    const principal = requirePrincipal(req)
    const state = await loadState(principal)
    await markEmailUnavailable(principal, state)
    res.status(503).json({
      state: 'verification_unavailable' satisfies WebOsEmailBindingState,
      message: '邮箱验证码服务待接入；当前不会发送或接受验证码。',
    })
  } catch (error) {
    next(error)
  }
})

webosRouter.post('/email/verify', async (req, res, next) => {
  try {
    const principal = requirePrincipal(req)
    const state = await loadState(principal)
    await markEmailUnavailable(principal, state)
    res.status(503).json({
      state: 'verification_unavailable' satisfies WebOsEmailBindingState,
      message: '邮箱验证码服务待接入；当前不会伪造绑定或迁移成功。',
    })
  } catch (error) {
    next(error)
  }
})

webosRouter.get('/payment/products', (_req, res) => {
  res.json(paymentState())
})

/**
 * 2026-08-12 兑换码兑换（用户决策：废弃「备注邮箱自动发货」）。
 * 用户在爱发电购买「兑换码商品」→ 订单里拿到兑换码 → 在这里输入兑换码 →
 * 服务端按 redeem_id 匹配订单并发放对应档位权益（积分/工作区空间），一次性。
 * 仅已登录账号可兑换（游客权益无法跨设备保留，先登录再兑换）。
 */
webosRouter.post('/payment/redeem', async (req, res, next) => {
  try {
    const principal = requirePrincipal(req)
    if (principal.guest) {
      throw createError(403, 'GUEST_NOT_ALLOWED', '请先登录后再兑换（兑换权益会发放到你的账号）')
    }
    const code = typeof req.body?.code === 'string' ? req.body.code : ''
    const result = await redeemAfdianCode(principal, code)
    res.json({ ok: true, result })
  } catch (error) {
    next(error)
  }
})

/**
 * 创建支付订单：支付渠道未接入（爱发电待接入），明确返回 503 PAYMENT_UNAVAILABLE，
 * 不创建假订单、不伪造到账。
 */
webosRouter.post('/payment/orders', (_req, res, next) => {
  next(createError(503, 'PAYMENT_UNAVAILABLE', `支付渠道接入中（爱发电），暂不可购买；测试阶段可加客服微信 ${SUPPORT_WECHAT} 免费获取积分`))
})

/** 查询订单状态：渠道未接入，无订单可查 */
webosRouter.get('/payment/orders/:orderId', (_req, res, next) => {
  next(createError(503, 'PAYMENT_UNAVAILABLE', '支付渠道接入中（爱发电），暂无订单'))
})

export function clearWebOsStateCache(): void {
  stateCache.clear()
  aiRateMap.clear()
}
