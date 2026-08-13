'use strict'

/**
 * Daily Agent Harness · pi 内核封装（M0-2 spike）
 * - BYOK：自定义 OpenAI 兼容端点（用户自带 Key），模型 DeepSeek V4 Flash 四档思考
 * - 单进程多会话：按 conversationId 缓存 AgentSession（上下文保留在 session 内）
 * - 事件词汇对齐 shared/webos-contracts WebOsChatEvent（delta / thinking / tool_start / done / error）
 *
 * 同源改造自 server/src/piBridge.ts（registerDeepseekModels + createAgentSession 模式）。
 */

const fs = require('fs')
const path = require('path')
const os = require('os')

let piAgentModule = null
function loadPiAgent() {
  if (!piAgentModule) {
    // pi-coding-agent 是 ESM-only 包（exports 无 require 条件），CJS 中必须用动态 import()
    piAgentModule = import('@earendil-works/pi-coding-agent')
  }
  return piAgentModule
}

/** 本地数据目录（harness 状态：auth.json / agent 配置） */
function defaultAgentDir() {
  const dir = path.join(os.homedir(), '.pi-agent-harness')
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

/**
 * 初始化 harness：注册 BYOK provider + 共享 pi 服务。
 * @param {object} opts
 * @param {string} opts.baseUrl OpenAI 兼容端点（如 https://opencode.ai/zen/go/v1）
 * @param {string} opts.apiKey  BYOK 密钥（仅内存，不落盘）
 * @param {string} [opts.modelId] 模型 id（默认 deepseek-v4-flash）
 * @param {string} [opts.cwd] 工作目录（默认 os.tmpdir()/daily-harness）
 */
async function initHarness(opts) {
  const pi = await loadPiAgent()
  const {
    AuthStorage, DefaultResourceLoader, ModelRegistry, getAgentDir,
  } = pi

  const agentDir = opts.agentDir || defaultAgentDir()
  const cwd = opts.cwd || fs.mkdtempSync(path.join(os.tmpdir(), 'daily-harness-'))

  const resourceLoader = new DefaultResourceLoader({ cwd, agentDir })
  await resourceLoader.reload()

  const authStorage = AuthStorage.create(path.join(agentDir, 'auth.json'))
  const modelRegistry = ModelRegistry.create(authStorage)

  // BYOK provider：覆盖 DeepSeek V4 Flash 模型定义（四档思考全可用）
  const modelId = opts.modelId || 'deepseek-v4-flash'
  modelRegistry.registerProvider('byok', {
    baseUrl: opts.baseUrl,
    apiKey: opts.apiKey,
    models: [
      {
        id: modelId,
        name: 'DeepSeek V4 Flash (BYOK)',
        api: 'openai-completions',
        baseUrl: opts.baseUrl,
        compat: { requiresReasoningContentOnAssistantMessages: true, thinkingFormat: 'deepseek' },
        reasoning: true,
        thinkingLevelMap: { low: 'low', medium: 'medium', high: 'high', xhigh: 'max' },
        input: ['text'],
        cost: { input: 0.14, output: 0.28, cacheRead: 0.0028, cacheWrite: 0 },
        contextWindow: 1000000,
        maxTokens: 384000,
      },
    ],
  })
  // 运行时密钥（进程重启后失效，仅内存）
  authStorage.setRuntimeApiKey('byok', opts.apiKey)

  const model = modelRegistry.find('byok', modelId)
  if (!model) throw new Error(`model not found in registry: byok/${modelId}`)

  return {
    pi, cwd, agentDir, resourceLoader, authStorage, modelRegistry, model,
  }
}

/**
 * 会话工厂：单进程多会话，按 conversationId 缓存。
 * 返回 { turn, abort, dispose, disposeAll }
 */
function createConversationManager(services, opts) {
  const { createAgentSession, SessionManager } = services.pi
  const sessions = new Map()
  const subscribers = new Map()
  const inflight = new Map()   // conversationId -> session 创建 promise（in-flight 去重）
  const queues = new Map()     // conversationId -> 串行队列（同会话 turn 排队，跨会话并行）

  async function getSession(conversationId, thinking) {
    const cached = sessions.get(conversationId)
    if (cached) return cached
    // 并发 turn 同时进入时共享同一个创建 promise，避免创建两个 session 并发请求
    if (inflight.has(conversationId)) return inflight.get(conversationId)
    const creating = (async () => {
      const start = Date.now()
      // 每会话独立 SessionManager.inMemory（同 server webosSessions 模式）：
      // 共享实例会让不同会话上下文串扰（会话 B 看到 A 的内容），独立实例 = 天然并行隔离。
      const sessionManager = SessionManager.inMemory(services.cwd)
      const { session } = await createAgentSession({
        cwd: services.cwd,
        agentDir: services.agentDir,
        resourceLoader: services.resourceLoader,
        sessionManager,
        authStorage: services.authStorage,
        modelRegistry: services.modelRegistry,
        model: services.model,
        thinkingLevel: thinking || 'medium',
        noTools: 'builtin',
        customTools: opts.customTools || [],
      })
      const entry = { session, sessionManager, thinking: thinking || 'medium', busy: false }
      sessions.set(conversationId, entry)
      const subscribeHandler = (event) => {
        const cb = subscribers.get(conversationId)
        if (cb) {
          try { cb(event) } catch { /* 忽略回调错误 */ }
        }
      }
      session.subscribe(subscribeHandler)
      entry.unsubscribe = subscribeHandler
      console.error(`[harness] session created conv=${conversationId} thinking=${thinking} in ${Date.now() - start}ms`)
      return entry
    })()
    inflight.set(conversationId, creating)
    try {
      return await creating
    } finally {
      inflight.delete(conversationId)
    }
  }

  /**
   * 同会话串行执行（排队）；跨会话并行。
   * 前一轮失败不阻塞后续轮次。
   */
  function turn(conversationId, text, optsTurn) {
    const run = async () => {
      const entry = await getSession(conversationId, optsTurn && optsTurn.thinking)
      if (entry.busy) throw Object.assign(new Error('conversation busy'), { code: 'CONVERSATION_BUSY' })
      entry.busy = true
      try {
        await entry.session.prompt(text)
      } finally {
        entry.busy = false
      }
    }
    const prev = queues.get(conversationId) || Promise.resolve()
    const next = prev.then(run, run)
    queues.set(conversationId, next.catch(() => { /* 队列本身吞掉错误 */ }))
    return next
  }

  function subscribe(conversationId, cb) {
    subscribers.set(conversationId, cb)
  }

  function abort(conversationId) {
    const entry = sessions.get(conversationId)
    if (!entry) return false
    try { entry.session.abort() } catch { /* ignore */ }
    return true
  }

  async function dispose(conversationId) {
    const entry = sessions.get(conversationId)
    if (!entry) return
    sessions.delete(conversationId)
    subscribers.delete(conversationId)
    try { entry.session.dispose() } catch { /* ignore */ }
  }

  async function disposeAll() {
    for (const id of [...sessions.keys()]) await dispose(id)
  }

  return { turn, subscribe, abort, dispose, disposeAll, count: () => sessions.size }
}

module.exports = { initHarness, createConversationManager, loadPiAgent }