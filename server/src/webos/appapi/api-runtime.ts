// server/src/webos/appapi/api-runtime.ts —— handler 受限 vm 执行器
// ----------------------------------------------------------------------------
// 依据：docs/routes/web/04-app-api.md §1（handler 编程模型）+ shared api.schema.ts
//   API_HANDLER_LIMITS（5s 超时 / 输出 ≤64KB / http ≤256KB & 30s）。
// 安全模型（R5 红线：不开终端/任意代码，只执行受限 handler）：
//   - vm.createContext 隔离全局：handler 只暴露「async function main(ctx)」，
//     无 process / require / fs / 任意网络（fetch 不在上下文里）；
//   - ctx 白名单：storage（前缀受控的 App 私有 KV）、params、userKey、
//     http（仅白名单域名 + SSRF 拦截）、secrets（脱敏，永不进日志/返回）；
//   - 超时（Promise.race）+ 输出字节截断；失败信息对 secrets 脱敏。
// ============================================================================

import vm from 'node:vm'

// ---- 常量（单一事实源在 shared api.schema.ts API_HANDLER_LIMITS；服务端本地定义，
//      shared 的 JSON 快照只含 schema 结构不含常数值 → 值守卫注释对齐） ----
const LIMITS = {
  timeoutMs: 5000,
  maxOutputBytes: 64 * 1024,
  maxHttpResponseBytes: 256 * 1024,
  maxHttpTimeoutMs: 30_000,
} as const

export interface ApiHandlerContext {
  storage: { get: (k: string) => unknown; set: (k: string, v: unknown) => void; del: (k: string) => void; list: (prefix: string) => Array<{ key: string; value: unknown }> }
  params: Record<string, unknown>
  userKey: string
  http?: { fetch: (url: string, init?: Record<string, unknown>) => Promise<{ status: number; ok: boolean; text: () => Promise<string>; json: () => Promise<unknown> }> }
  secrets?: Record<string, string>
}

export type ApiRunResult =
  | { ok: true; value: unknown; durationMs: number }
  | { ok: false; error: string; errorCode: string; timedOut?: boolean; durationMs: number }

/** 内部：带超时的 Promise 包装（不真正终止 vm 内长循环，但超时即放弃等待并报错） */
function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<{ timedOut: boolean; value?: T }> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve({ timedOut: true }), timeoutMs)
    promise.then(
      (value) => { clearTimeout(timer); resolve({ timedOut: false, value }) },
      // handler 抛错 → 透传原始错误（勿与超时混淆，否则脱敏/错误归因失效）
      (error) => { clearTimeout(timer); reject(error) },
    )
  })
}

/**
 * 执行单个 handler（受限 vm）。主流程：
 *   runInContext(code) 定义 async function main(ctx) → 调用之并约束超时/输出。
 * ctx 由调用方（appapi-service）按 endpoint 的 storage/network/secrets 声明构建。
 */
export async function executeApiHandler(input: {
  code: string
  ctx: ApiHandlerContext
  timeoutMs?: number
  maxOutputBytes?: number
}): Promise<ApiRunResult> {
  const startedAt = Date.now()
  const timeoutMs = input.timeoutMs ?? LIMITS.timeoutMs
  const maxOutput = input.maxOutputBytes ?? LIMITS.maxOutputBytes

  // 1) 编译进隔离上下文（同步编译/define，2s 硬闸防超长脚本）
  // 安全要点（2026-08-21 真机验证）：sandbox 必须是 **null-prototype 对象**
  // （Object.create(null)），否则普通 {} 的 constructor 链桥接宿主 realm，
  // handler 可用 `this.constructor.constructor("return process")` 逃逸拿到宿主 process
  // （Node vm 对 host-origin 传入对象会桥接原型）。null-proto 使 this.constructor
  // 为 undefined，经典逃逸被阻断；主函数只依赖 ctx 参数，不走 this。
  const sandbox: Record<string, unknown> = Object.create(null) as Record<string, unknown>
  sandbox['console'] = {
    log: () => {}, warn: () => {}, error: () => {}, info: () => {}, debug: () => {},
  }
  // 注入宿主定时器（安全：回调仍运行在 vm realm，仅触达 vm 全局，无宿主访问；
  // handler 可做限时等待，长挂起仍由上方 5s 超时兜底）
  sandbox['setTimeout'] = setTimeout
  sandbox['clearTimeout'] = clearTimeout
  try {
    vm.createContext(sandbox)
    vm.runInContext(input.code, sandbox, { filename: 'api-handler.js', timeout: 2000 })
  } catch (error) {
    return { ok: false, error: `handler 编译失败：${safeMessage(error)}`, errorCode: 'HANDLER_COMPILE', durationMs: Date.now() - startedAt }
  }

  // 2) 只允许 main(ctx)
  const main = sandbox['main']
  if (typeof main !== 'function') {
    return { ok: false, error: 'handler 必须导出 async function main(ctx)', errorCode: 'HANDLER_NO_MAIN', durationMs: Date.now() - startedAt }
  }

  // 3) 执行 main
  try {
    const run = main(input.ctx) as unknown
    if (run === undefined || (typeof run === 'object' && run !== null && typeof (run as { then?: unknown }).then !== 'function')) {
      return { ok: false, error: 'handler 的 main(ctx) 必须返回 Promise（async function）', errorCode: 'HANDLER_NOT_ASYNC', durationMs: Date.now() - startedAt }
    }
    const awaited = await withTimeout(Promise.resolve(run) as Promise<unknown>, timeoutMs)
    if (awaited.timedOut) {
      return { ok: false, error: `handler 执行超时（${timeoutMs}ms）`, errorCode: 'HANDLER_TIMEOUT', timedOut: true, durationMs: Date.now() - startedAt }
    }

    // 4) 输出序列化 + 字节截断
    let text: string
    try {
      text = JSON.stringify(awaited.value ?? null)
    } catch {
      return { ok: false, error: 'handler 返回了不可序列化的值', errorCode: 'HANDLER_UNSERIALIZABLE', durationMs: Date.now() - startedAt }
    }
    if (text === undefined) text = 'null'
    if (Buffer.byteLength(text, 'utf8') > maxOutput) {
      return { ok: false, error: `handler 输出超过 ${Math.round(maxOutput / 1024)}KB 上限`, errorCode: 'HANDLER_OUTPUT_TOO_LARGE', durationMs: Date.now() - startedAt }
    }
    return { ok: true, value: awaited.value, durationMs: Date.now() - startedAt }
  } catch (error) {
    return { ok: false, error: `handler 执行失败：${safeMessage(error)}`, errorCode: 'HANDLER_ERROR', durationMs: Date.now() - startedAt }
  }
}

function safeMessage(error: unknown): string {
  const msg = error instanceof Error ? error.message : String(error)
  // 行号/列号为 vm 编译错误的一部分，保留前 300 字符避免刷屏
  return msg.slice(0, 300)
}

// ============================================================================
// 前缀匹配助手（storage 权界）
// ============================================================================

/**
 * storage 前缀规则匹配：`notes/*` → key 以 `notes/` 开头；
 * `notes`（无星）→ key === 'notes' 或 startsWith('notes/')。
 */
export function matchStoragePrefix(rule: string, key: string): boolean {
  const r = rule.trim()
  if (!r) return false
  if (r.endsWith('/*')) {
    const base = r.slice(0, -2).replace(/\/+$/, '')
    return key === base || key.startsWith(`${base}/`)
  }
  if (r.endsWith('/')) {
    return key.startsWith(r)
  }
  return key === r || key.startsWith(`${r}/`)
}

/** key 命中「任一允许规则」；允许列表为空 = 拒绝（storage 声明须显式授权） */
export function allowedByPrefix(rules: string[] | undefined, key: string): boolean {
  if (!rules || rules.length === 0) return false
  return rules.some((rule) => matchStoragePrefix(rule, key))
}

// ============================================================================
// SSRF 域名校验（http 白名单）
// ============================================================================

const PRIVATE_IP_RE = /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|0\.|::1|fc|fd)/
const BLOCKED_HOSTS = new Set(['localhost', 'localhost.localdomain', 'metadata.google.internal'])

/** 校验 host（域名/主机名）：不允许本机/内网 IP、localhost；返回带端口剥离的 host */
export function validateHttpTarget(host: string): string | null {
  const clean = (host ?? '').trim().toLowerCase().replace(/^https?:\/\//, '').split('/')[0]!.split(':')[0]!
  if (!clean) return null
  if (BLOCKED_HOSTS.has(clean)) return null
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(clean) && PRIVATE_IP_RE.test(clean)) return null
  // 形如 192.168 的 IPv4 字面前缀也拒（防 010.0.0.1 等混淆）
  if (/^(127|10|192\.168|172\.(1[6-9]|2\d|3[01]))\./.test(clean)) return null
  return clean
}

/** 校验目标 URL：host ∈ 白名单域名（含 *. 子域通配）+ 非内网 */
export function targetAllowed(url: string, domains: string[]): boolean {
  let host: string
  try {
    host = new URL(url).hostname
  } catch {
    return false
  }
  const cleanHost = validateHttpTarget(host)
  if (!cleanHost) return false
  return domains.some((rule) => {
    if (rule.startsWith('*.')) {
      const suffix = rule.slice(2)
      return cleanHost === suffix || cleanHost.endsWith(`.${suffix}`)
    }
    return cleanHost === rule
  })
}

// ============================================================================
// ctx 适配器（storage / http），由 appapi-service 在 invoke 时组装
// ============================================================================

function clone<T>(v: T): T {
  try {
    return v === undefined ? v : structuredClone(v)
  } catch {
    return v
  }
}

/**
 * 构建 ctx.storage：读写都受 endpoint.storage 前缀白名单约束（权限四交集求交的
 * 存储侧落点）。bag 是 state.appStorage[packageId] 的同址引用——handler 写操作
 * 直接进 state，调用方 saveState 持久化。
 */
export function makeStorage(input: {
  bag: Record<string, unknown>
  readRules: string[]
  writeRules: string[]
  match?: (rule: string, key: string) => boolean
}): ApiHandlerContext['storage'] {
  const match = input.match ?? matchStoragePrefix
  const checkRead = (key: string): boolean => input.readRules.some((r) => match(r, key))
  const checkWrite = (key: string): boolean => input.writeRules.some((r) => match(r, key))
  return {
    get: (key: string): unknown => {
      if (!checkRead(key)) throw new Error(`storage.read 越权：前缀「${prefixes(input.readRules)}」不允许读 ${key}`)
      return clone(input.bag[key])
    },
    set: (key: string, value: unknown): void => {
      if (!checkWrite(key)) throw new Error(`storage.write 越权：前缀「${prefixes(input.writeRules)}」不允许写 ${key}`)
      input.bag[key] = value
    },
    del: (key: string): void => {
      if (!checkWrite(key)) throw new Error(`storage.write 越权：前缀「${prefixes(input.writeRules)}」不允许删 ${key}`)
      delete input.bag[key]
    },
    list: (prefix: string): Array<{ key: string; value: unknown }> =>
      Object.entries(input.bag)
        .filter(([key]) => !prefix || key.startsWith(prefix))
        .filter(([key]) => checkRead(key))
        .map(([key, value]) => ({ key, value: clone(value) })),
  }
}

function prefixes(rules: string[]): string {
  return rules.length > 0 ? rules.join('、') : '（空=禁止）'
}

/** 构建 ctx.http（白名单 fetch）：仅允许 network.domains 内域名 + SSRF 拦截 + 体积/超时双限 */
export function makeHttp(domains: string[]): NonNullable<ApiHandlerContext['http']> {
  return {
    fetch: async (url: string, init?: Record<string, unknown>) => {
      const target = String(url)
      if (!targetAllowed(target, domains)) {
        throw new Error(`出站目标不在 network.domains 白名单（${domains.join('、')}）：${target}`)
      }
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), LIMITS.maxHttpTimeoutMs)
      try {
        const resp = await fetch(target, { ...(init ?? {}), signal: controller.signal })
        const raw = await resp.text().catch(() => '')
        const truncated = raw.slice(0, LIMITS.maxHttpResponseBytes)
        return {
          status: resp.status,
          ok: resp.ok,
          text: async () => truncated,
          json: async () => {
            try {
              return JSON.parse(truncated) as unknown
            } catch {
              throw new Error('http 响应不是合法 JSON')
            }
          },
        }
      } finally {
        clearTimeout(timer)
      }
    },
  }
}

// ============================================================================
// 脱敏
// ============================================================================

/** 把文本里的秘密值替换为 ***（错误消息/审计不得含秘密） */
export function redactSecrets(text: string, secrets: Record<string, string> | undefined): string {
  if (!secrets || !text) return text
  let out = text
  const values = new Set<string>()
  for (const v of Object.values(secrets)) {
    if (typeof v === 'string' && v.length >= 4) values.add(v)
  }
  // 太短的值（<4 字符）不替换，避免误伤（如 "1"）
  for (const v of values) {
    if (v.length >= 4) out = out.split(v).join('***')
  }
  return out
}