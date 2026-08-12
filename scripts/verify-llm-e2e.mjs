/**
 * Phase 13.2.3 D2 真实 LLM 端到端验证脚本
 *
 * 在 Node.js 环境中直接调用 pi-coding-agent（绕过 Electron），验证：
 *   1. DeepSeek 模型真实对话（text_delta + turn_end 事件）
 *   2. 工具调用回路（tool_call + tool_result 事件）
 *
 * 模型查找策略：
 *   - 方案 0：内置 deepseek provider + deepseek-v4-flash / deepseek-v4-pro（pi ^0.79.10 内置）
 *   - 方案 1：openai provider + 自定义 baseUrl=https://api.deepseek.com + model=deepseek-chat（兜底）
 *
 * 运行：node scripts/verify-llm-e2e.mjs
 *
 * 注意：workerThreadsPatch 是 Electron 31 的兼容补丁，Node.js 环境（>= 22）原生有
 * markAsUncloneable，不需要 patch。
 */
import {
  AuthStorage,
  ModelRegistry,
  DefaultResourceLoader,
  SessionManager,
  createAgentSession,
} from '@earendil-works/pi-coding-agent'
import { Type } from 'typebox'
import { join } from 'path'
import { fileURLToPath } from 'url'
import { mkdirSync, writeFileSync, readFileSync } from 'fs'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const projectRoot = join(__dirname, '..')

// 读取 pi-coding-agent 版本（ESM 中用 readFileSync 替代 require）
const piVersion = JSON.parse(
  readFileSync(join(projectRoot, 'node_modules', '@earendil-works', 'pi-coding-agent', 'package.json'), 'utf8'),
).version

// ============================================================================
// 配置
// ============================================================================
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY
if (!DEEPSEEK_API_KEY) {
  console.error('✗ 未设置环境变量 DEEPSEEK_API_KEY，无法运行真实 LLM 验证')
  console.error('  PowerShell: $env:DEEPSEEK_API_KEY = "sk-..."')
  process.exit(2)
}
const CWD = projectRoot
const AGENT_DIR = join(CWD, '.pi')
const SKILLS_DIR = join(AGENT_DIR, 'skills')
const AUTH_PATH = join(AGENT_DIR, 'auth.json')

// 输出目录（步骤 4 存证用）
const OUTPUT_DIR = join(CWD, 'docs', 'verify', 'phase13', 'llm-e2e')
const OUTPUT_LOG_PATH = join(OUTPUT_DIR, 'verify-output.log')

// 收集所有 stdout 行用于存证
const logLines = []
function log(line = '') {
  console.log(line)
  logLines.push(line)
}
function logError(line = '') {
  console.error(line)
  logLines.push(`[stderr] ${line}`)
}

// 收集的事件流（用于步骤 4 报告）
const eventStream = []

// ============================================================================
// 步骤 1：初始化 Auth / ModelRegistry / ResourceLoader / SessionManager
// ============================================================================
log('=== Phase 13.2.3 D2 真实 LLM 端到端验证 ===')
log(`时间: ${new Date().toISOString()}`)
log(`项目根目录: ${CWD}`)
log(`pi-coding-agent 版本: ${piVersion}`)
log('')

// 1.1 AuthStorage：注入 DeepSeek API Key（运行时覆盖，不写盘）
log('--- [1.1] AuthStorage + DeepSeek API Key ---')
const authStorage = AuthStorage.create(AUTH_PATH)
authStorage.setRuntimeApiKey('deepseek', DEEPSEEK_API_KEY)
// 方案 1 兜底：openai provider 也注入相同 key，方便后续 fallback
authStorage.setRuntimeApiKey('openai', DEEPSEEK_API_KEY)
log(`✓ AuthStorage.create(${AUTH_PATH})`)
log(`✓ authStorage.setRuntimeApiKey('deepseek', 'sk-****${DEEPSEEK_API_KEY.slice(-6)}')`)
log(`✓ authStorage.setRuntimeApiKey('openai', 'sk-****${DEEPSEEK_API_KEY.slice(-6)}')  (fallback)`)
log(`✓ hasAuth('deepseek')=${authStorage.hasAuth('deepseek')}`)
log('')

// 1.2 ModelRegistry
log('--- [1.2] ModelRegistry ---')
const modelRegistry = ModelRegistry.create(authStorage)
log('✓ ModelRegistry.create(authStorage)')

// 1.3 ResourceLoader
log('--- [1.3] DefaultResourceLoader ---')
const resourceLoader = new DefaultResourceLoader({
  cwd: CWD,
  agentDir: AGENT_DIR,
  additionalSkillPaths: [SKILLS_DIR],
  extensionFactories: [
    (pi) => {
      // 模拟 LocalAgentService.ts 的 extensionFactory，验证 pi 上下文调用
      log('  [extensionFactory] called (pi 上下文可用)')
    },
  ],
})
await resourceLoader.reload()
log('✓ await resourceLoader.reload()')

// Flush extension provider registrations into modelRegistry BEFORE model lookup
// （参考 LocalAgentService.ts:393-397，与 server piBridge.ts:1096-1100 对齐）
const extensionsResult = resourceLoader.getExtensions()
const pendingCount = extensionsResult.runtime.pendingProviderRegistrations.length
for (const { name, config: providerConfig } of extensionsResult.runtime.pendingProviderRegistrations) {
  modelRegistry.registerProvider(name, providerConfig)
}
extensionsResult.runtime.pendingProviderRegistrations = []
if (pendingCount > 0) {
  log(`✓ Flushed ${pendingCount} pending provider registration(s) into ModelRegistry`)
} else {
  log('✓ No pending provider registrations (using built-in providers only)')
}

// 加载的 skills
const { skills, diagnostics } = resourceLoader.getSkills()
log(`✓ Loaded ${skills.length} skill(s): ${skills.map((s) => s.name).join(', ') || '(none)'}`)
if (diagnostics.length > 0) {
  log(`  Diagnostics: ${JSON.stringify(diagnostics)}`)
}
log('')

// 1.4 SessionManager
log('--- [1.4] SessionManager.inMemory ---')
const sessionManager = SessionManager.inMemory(CWD)
log(`✓ SessionManager.inMemory(${CWD})`)
log('')

// ============================================================================
// 步骤 2：查找模型（方案 0 → 方案 1 fallback）
// ============================================================================
log('--- [2] 查找 DeepSeek 模型 ---')
let chosenProvider
let chosenModelId
let chosenModel
let fallbackPlan = 'plan-0' // plan-0: built-in deepseek/v4-flash, plan-1: openai+deepseek-chat

chosenModel = modelRegistry.find('deepseek', 'deepseek-v4-flash')
if (chosenModel) {
  chosenProvider = 'deepseek'
  chosenModelId = 'deepseek-v4-flash'
  log(`✓ [plan-0] Found built-in model: deepseek/deepseek-v4-flash`)
} else {
  log(`  [plan-0] deepseek/deepseek-v4-flash not found, trying deepseek/deepseek-v4-pro...`)
  chosenModel = modelRegistry.find('deepseek', 'deepseek-v4-pro')
  if (chosenModel) {
    chosenProvider = 'deepseek'
    chosenModelId = 'deepseek-v4-pro'
    log(`✓ [plan-0] Found built-in model: deepseek/deepseek-v4-pro`)
  } else {
    log(`  [plan-0] deepseek/deepseek-v4-pro not found, falling back to plan-1...`)
    // 方案 1：openai provider + 自定义 endpoint + deepseek-chat
    // 通过 modelRegistry.registerProvider 注入一个 openai-completions provider 走 deepseek baseUrl
    fallbackPlan = 'plan-1'
    modelRegistry.registerProvider('openai', {
      baseUrl: 'https://api.deepseek.com',
      apiKey: DEEPSEEK_API_KEY,
      api: 'openai-completions',
      models: [
        {
          id: 'deepseek-chat',
          name: 'DeepSeek Chat (plan-1 fallback)',
          reasoning: false,
          input: ['text'],
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          contextWindow: 64000,
          maxTokens: 8192,
          compat: {
            supportsDeveloperRole: false,
            supportsReasoningEffort: false,
            maxTokensField: 'max_tokens',
          },
        },
      ],
    })
    chosenModel = modelRegistry.find('openai', 'deepseek-chat')
    if (!chosenModel) {
      logError('✗ [plan-1] Failed to find openai/deepseek-chat after registration')
      process.exit(1)
    }
    chosenProvider = 'openai'
    chosenModelId = 'deepseek-chat'
    log(`✓ [plan-1] Registered openai provider with baseUrl=https://api.deepseek.com`)
    log(`✓ [plan-1] Found model: openai/deepseek-chat`)
  }
}
log(`✓ Chosen: provider=${chosenProvider}, model=${chosenModelId}, fallbackPlan=${fallbackPlan}`)
log(`  model.baseUrl=${chosenModel.baseUrl}`)
log(`  model.api=${chosenModel.api}`)
log(`  model.reasoning=${chosenModel.reasoning}`)
log('')

// ============================================================================
// 步骤 3：构建 customTools（至少包含 storage_write，参照 LocalAgentService.ts）
// ============================================================================
log('--- [3] 构建 customTools ---')
const toolCallLog = [] // 收集 tool_call 事件用于步骤 4 报告
const storageKv = new Map() // mock 存储

const customTools = [
  {
    name: 'storage_write',
    label: 'storage_write',
    description:
      '写入一个 KV 存储条目。参数: { key: string, value: string }。' +
      'key 建议使用 "namespace:name" 格式，例如 "test:hello"。',
    parameters: Type.Object({
      key: Type.String({ description: 'KV 键名，建议 "namespace:name" 格式' }),
      value: Type.String({ description: 'KV 值' }),
    }),
    execute: async (toolCallId, params) => {
      const { key, value } = params
      log(`  [storage_write.execute] toolCallId=${toolCallId}, key=${key}, value=${value}`)
      storageKv.set(key, value)
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ success: true, key, value, storedAt: Date.now() }),
          },
        ],
        details: { key, value },
      }
    },
  },
  {
    name: 'storage_read',
    label: 'storage_read',
    description: '读取一个 KV 存储条目。参数: { key: string }',
    parameters: Type.Object({
      key: Type.String({ description: 'KV 键名' }),
    }),
    execute: async (toolCallId, params) => {
      const { key } = params
      const value = storageKv.get(key)
      log(`  [storage_read.execute] toolCallId=${toolCallId}, key=${key}, found=${value !== undefined}`)
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ success: true, key, value: value ?? null }),
          },
        ],
        details: { key, value },
      }
    },
  },
]
log(`✓ Built ${customTools.length} customTools: ${customTools.map((t) => t.name).join(', ')}`)
log('')

// ============================================================================
// 步骤 4：创建 AgentSession
// ============================================================================
log('--- [4] createAgentSession ---')
const { session, extensionsResult: sessionExtensionsResult } = await createAgentSession({
  cwd: CWD,
  agentDir: AGENT_DIR,
  resourceLoader,
  sessionManager,
  authStorage,
  modelRegistry,
  model: chosenModel,
  noTools: 'builtin', // 禁用内置 read/bash/edit/write，仅 customTools
  customTools,
  thinkingLevel: 'off', // DeepSeek V4 仅 high/xhigh 支持 thinking，先关闭避免 clamp 麻烦
})
log('✓ createAgentSession() succeeded')
log(`  sessionId=${session.sessionId}`)
log(`  model=${session.model?.provider}/${session.model?.id}`)
log(`  thinkingLevel=${session.thinkingLevel}`)
log('')

// ============================================================================
// 步骤 5：对话验证（基础对话 → text_delta + turn_end）
// ============================================================================
log('--- [5] 对话验证：发送 "你好，请回复一句话" ---')

let textDeltas = []
let turnEndCount = 0
let assistantMessageCount = 0
let errorEvents = []
let lastErrorMessage = null

const unsubscribe1 = session.subscribe((event) => {
  eventStream.push({ phase: 'chat', event })
  const e = event
  // 文本流
  if (e.type === 'message_update' && e.assistantMessageEvent?.type === 'text_delta') {
    textDeltas.push(e.assistantMessageEvent.delta)
    process.stdout.write(e.assistantMessageEvent.delta)
  }
  // 工具调用相关
  if (e.type === 'tool_execution_start') {
    log(`\n  [event] tool_execution_start: ${e.toolName}, toolCallId=${e.toolCallId}, args=${JSON.stringify(e.args)}`)
    toolCallLog.push({ type: 'tool_call', toolName: e.toolName, toolCallId: e.toolCallId, args: e.args })
  }
  if (e.type === 'tool_execution_end') {
    log(`  [event] tool_execution_end: toolCallId=${e.toolCallId}, isError=${e.isError}`)
    toolCallLog.push({ type: 'tool_result', toolCallId: e.toolCallId, isError: !!e.isError })
  }
  // turn / message / agent 生命周期
  if (e.type === 'turn_start') log(`\n  [event] turn_start`)
  if (e.type === 'turn_end') {
    turnEndCount++
    log(`\n  [event] turn_end (#${turnEndCount})`)
  }
  if (e.type === 'message_start') assistantMessageCount++
  if (e.type === 'agent_start') log(`  [event] agent_start`)
  if (e.type === 'agent_end') log(`  [event] agent_end (messages added)`)
  if (e.type === 'error' || (e.type === 'message_end' && e.message?.stopReason === 'error')) {
    const errMsg = e.message?.errorMessage || e.message?.error?.message || JSON.stringify(e)
    errorEvents.push(errMsg)
    lastErrorMessage = errMsg
    logError(`  [event] error: ${errMsg}`)
  }
})

try {
  await session.prompt('你好，请回复一句话')
  log('\n  ✓ session.prompt() resolved')
} catch (err) {
  logError(`\n  ✗ session.prompt() threw: ${err?.stack || err?.message || err}`)
  throw err
} finally {
  unsubscribe1()
}

log('')
log(`--- [5] 对话验证结果 ---`)
const fullText = textDeltas.join('')
log(`text_delta 事件数: ${textDeltas.length}`)
log(`turn_end 事件数: ${turnEndCount}`)
log(`assistant_message 数: ${assistantMessageCount}`)
log(`error 事件数: ${errorEvents.length}`)
log(`AI 回复全文 (${fullText.length} chars):`)
log(fullText || '(空)')
log('')

const chatOk = textDeltas.length > 0 && turnEndCount >= 1 && errorEvents.length === 0
log(`对话验证: ${chatOk ? '✓ PASS' : '✗ FAIL'}`)
log('')

// ============================================================================
// 步骤 6：工具调用回路验证
// ============================================================================
log('--- [6] 工具调用验证：发送 "帮我用 storage_write 写一个 kv:test=hello" ---')

// 清空上一轮收集
textDeltas = []
turnEndCount = 0
assistantMessageCount = 0
errorEvents = []
const toolCallsThisTurn = []
const toolResultsThisTurn = []

const unsubscribe2 = session.subscribe((event) => {
  eventStream.push({ phase: 'tool', event })
  const e = event
  if (e.type === 'message_update' && e.assistantMessageEvent?.type === 'text_delta') {
    textDeltas.push(e.assistantMessageEvent.delta)
    process.stdout.write(e.assistantMessageEvent.delta)
  }
  if (e.type === 'tool_execution_start') {
    log(`\n  [event] tool_execution_start: ${e.toolName}, toolCallId=${e.toolCallId}, args=${JSON.stringify(e.args)}`)
    toolCallsThisTurn.push({ toolName: e.toolName, toolCallId: e.toolCallId, args: e.args })
  }
  if (e.type === 'tool_execution_end') {
    const resultSummary = e.result?.content?.[0]?.text ?? '(no text content)'
    log(`  [event] tool_execution_end: toolCallId=${e.toolCallId}, isError=${e.isError}, result=${resultSummary}`)
    toolResultsThisTurn.push({ toolCallId: e.toolCallId, isError: !!e.isError, result: resultSummary })
  }
  if (e.type === 'turn_start') log(`\n  [event] turn_start`)
  if (e.type === 'turn_end') {
    turnEndCount++
    log(`\n  [event] turn_end (#${turnEndCount})`)
  }
  if (e.type === 'message_start') assistantMessageCount++
  if (e.type === 'agent_start') log(`  [event] agent_start`)
  if (e.type === 'agent_end') log(`  [event] agent_end (messages added)`)
  if (e.type === 'error' || (e.type === 'message_end' && e.message?.stopReason === 'error')) {
    const errMsg = e.message?.errorMessage || e.message?.error?.message || JSON.stringify(e)
    errorEvents.push(errMsg)
    lastErrorMessage = errMsg
    logError(`  [event] error: ${errMsg}`)
  }
})

try {
  await session.prompt('帮我用 storage_write 写一个 kv:test=hello，写完后告诉我成功')
  log('\n  ✓ session.prompt() resolved')
} catch (err) {
  logError(`\n  ✗ session.prompt() threw: ${err?.stack || err?.message || err}`)
  throw err
} finally {
  unsubscribe2()
}

log('')
log(`--- [6] 工具调用验证结果 ---`)
const toolFullText = textDeltas.join('')
log(`text_delta 事件数: ${textDeltas.length}`)
log(`turn_end 事件数: ${turnEndCount}`)
log(`assistant_message 数: ${assistantMessageCount}`)
log(`tool_execution_start 数: ${toolCallsThisTurn.length}`)
log(`tool_execution_end 数: ${toolResultsThisTurn.length}`)
log(`error 事件数: ${errorEvents.length}`)
log('')
log(`tool_calls 详情:`)
for (const tc of toolCallsThisTurn) {
  log(`  - ${tc.toolName} (${tc.toolCallId}): args=${JSON.stringify(tc.args)}`)
}
log('')
log(`tool_results 详情:`)
for (const tr of toolResultsThisTurn) {
  log(`  - (${tr.toolCallId}) isError=${tr.isError}: ${tr.result}`)
}
log('')
log(`AI 工具调用后的回复 (${toolFullText.length} chars):`)
log(toolFullText || '(空)')
log('')
log(`storageKv 当前内容:`)
for (const [k, v] of storageKv) {
  log(`  ${k} = ${v}`)
}
log('')

const storageWriteCalled = toolCallsThisTurn.some((t) => t.toolName === 'storage_write')
const storageWriteSucceeded = toolResultsThisTurn.some(
  (t) => !t.isError && toolCallsThisTurn.find((c) => c.toolCallId === t.toolCallId)?.toolName === 'storage_write',
)
// AI 对 "kv:test=hello" 的解读可能不同：可能 key="test" 也可能 key="kv:test"，两者都算成功
const storageKvHasTest =
  (storageKv.has('test') && storageKv.get('test') === 'hello') ||
  (storageKv.has('kv:test') && storageKv.get('kv:test') === 'hello')
const toolTurnEnd = turnEndCount >= 1
const toolChatOk =
  storageWriteCalled && storageWriteSucceeded && storageKvHasTest && toolTurnEnd && errorEvents.length === 0

log(`工具调用验证: ${toolChatOk ? '✓ PASS' : '✗ FAIL'}`)
log(`  storage_write 被调用: ${storageWriteCalled ? '✓' : '✗'}`)
log(`  storage_write 成功返回: ${storageWriteSucceeded ? '✓' : '✗'}`)
log(`  storageKv['test']=='hello' 或 storageKv['kv:test']=='hello': ${storageKvHasTest ? '✓' : '✗'}`)
log(`  turn_end 收到: ${toolTurnEnd ? '✓' : '✗'}`)
log(`  无 error 事件: ${errorEvents.length === 0 ? '✓' : '✗'}`)
log('')

// ============================================================================
// 步骤 7：总体结论
// ============================================================================
log('=== 总体结论 ===')
log(`方案: ${fallbackPlan}`)
log(`Provider: ${chosenProvider}`)
log(`Model: ${chosenModelId}`)
log(`Endpoint: ${chosenModel.baseUrl}`)
log('')
log(`[基础对话] ${chatOk ? '✓ PASS' : '✗ FAIL'}`)
log(`[工具调用] ${toolChatOk ? '✓ PASS' : '✗ FAIL'}`)
log('')
if (chatOk && toolChatOk) {
  log('🎉 真实 LLM 端到端验证全部通过！')
} else {
  log('⚠️  验证未完全通过，请检查上方日志。')
  if (lastErrorMessage) {
    log(`最后错误: ${lastErrorMessage}`)
  }
}
log('')

// ============================================================================
// 步骤 8：存证 - 保存完整日志到 docs/verify/phase13/llm-e2e/verify-output.log
// ============================================================================
mkdirSync(OUTPUT_DIR, { recursive: true })
writeFileSync(OUTPUT_LOG_PATH, logLines.join('\n'), 'utf8')
log(`✓ 完整日志已保存: ${OUTPUT_LOG_PATH}`)

// 清理
session.dispose()

// 退出码
if (chatOk && toolChatOk) {
  process.exit(0)
} else {
  process.exit(1)
}
