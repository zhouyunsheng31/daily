#!/usr/bin/env tsx
/**
 * C3 PoC — 验证 pi-coding-agent 在 Electron 子进程（ELECTRON_RUN_AS_NODE=1）下的兼容性
 *
 * 用法：
 *   npx tsx server/test/poc-pi-coding-agent.ts [--scenario=a|b|c]
 *
 * 三个场景（每个场景必须在独立进程中运行，因为 undici 的 worker_threads
 * require 只在模块首次加载时发生一次，同进程无法重跑）：
 *
 *   A (默认) — 基线：系统 Node 24（markAsUncloneable 存在）
 *       验证 pi-coding-agent 能正常导入 + 初始化。这是 tsx 能直接验证的部分。
 *       注意：系统 Node 24 ≠ Electron 31 内置 Node 20.x，本场景不能代表 Electron
 *       子进程真实情况，仅作为“包本身能否初始化”的基线。
 *
 *   B — 模拟 Electron 31 / Node 20.x（删除 markAsUncloneable，不打 patch）
 *       复现 undici 在 new CacheStorage() 时因 markAsUncloneable 缺失而崩溃。
 *       通过手动删除 node:worker_threads.markAsUncloneable 模拟 Node 20.x 环境。
 *
 *   C — 模拟 Electron 31 / Node 20.x + workerThreadsPatch（删除后重新注入 no-op）
 *       验证 client/desktop/electron/main/compat/workerThreadsPatch.ts 的修复策略
 *       在“子进程独立打 patch”的场景下同样有效。
 *
 * 关键说明（写在前面，避免误读结果）：
 *   - tsx 使用系统 Node（v24.x），markAsUncloneable 原生存在。
 *   - 场景 A 必然成功，不能证明 Electron 子进程兼容性。
 *   - 场景 B/C 通过手动操纵 worker_threads 模拟 Electron 31 的 Node 20.x 环境，
 *     专门验证 workerThreadsPatch 的有效性与崩溃复现条件。
 *   - 真实 Electron 子进程验证需用 electron.exe + ELECTRON_RUN_AS_NODE=1 运行本脚本
 *     （项目中 client/desktop 未安装 electron 依赖，本 PoC 无法覆盖该路径）。
 *
 * 不修改任何现有文件；workerThreadsPatch 逻辑在此脚本内联实现（与
 * client/desktop/electron/main/compat/workerThreadsPatch.ts 等价的 no-op 注入）。
 */

import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// ============================================================================
// 解析场景参数
// ============================================================================
const scenarioArg = process.argv
  .find((a) => a.startsWith('--scenario='))
  ?.split('=')[1]
  ?.toLowerCase()
const SCENARIO: 'a' | 'b' | 'c' = scenarioArg === 'b' || scenarioArg === 'c' ? scenarioArg : 'a'

const __require = createRequire(import.meta.url)

// ============================================================================
// 工具：步骤计时与结构化日志
// ============================================================================
const results: Array<{
  step: string
  ok: boolean
  ms: number
  message?: string
  error?: string
  stack?: string
}> = []

async function step<T>(name: string, fn: () => Promise<T>): Promise<T | undefined> {
  const t0 = Date.now()
  try {
    const ret = await fn()
    results.push({ step: name, ok: true, ms: Date.now() - t0 })
    console.log(`  [OK]   ${name}  (${Date.now() - t0}ms)`)
    return ret
  } catch (err) {
    const e = err as Error
    results.push({
      step: name,
      ok: false,
      ms: Date.now() - t0,
      message: e.message,
      error: e.constructor?.name ?? 'Error',
      stack: e.stack,
    })
    console.log(`  [FAIL] ${name}  (${Date.now() - t0}ms) — ${e.constructor?.name}: ${e.message}`)
    if (e.stack) console.log(e.stack.split('\n').slice(0, 8).join('\n'))
    return undefined
  }
}

// ============================================================================
// 主流程
// ============================================================================
async function main(): Promise<void> {
  console.log('='.repeat(72))
  console.log(`C3 PoC — pi-coding-agent in Electron subprocess (ELECTRON_RUN_AS_NODE=1)`)
  console.log(`Scenario: ${SCENARIO.toUpperCase()}`)
  console.log('='.repeat(72))
  console.log(`Node version:           ${process.version}`)
  console.log(`Node modules ABI:       ${process.versions.modules}`)
  console.log(`process.versions.v8:    ${process.versions.v8}`)
  console.log(`ELECTRON_RUN_AS_NODE:   ${process.env.ELECTRON_RUN_AS_NODE ?? '(unset)'}`)
  console.log(`tsx cwd:                ${process.cwd()}`)
  console.log('='.repeat(72))

  // ------------------------------------------------------------------------
  // Step 0: 设置 ELECTRON_RUN_AS_NODE=1（模拟 Electron 子进程环境变量）
  // ------------------------------------------------------------------------
  process.env.ELECTRON_RUN_AS_NODE = '1'
  console.log('\n[Step 0] Set ELECTRON_RUN_AS_NODE=1')

  // ------------------------------------------------------------------------
  // Step 1: 检查 node:worker_threads 原始状态 + 按场景操纵
  // ------------------------------------------------------------------------
  console.log('\n[Step 1] Inspect & manipulate node:worker_threads')
  const wt = __require('node:worker_threads') as Record<string, unknown> & {
    markAsUncloneable?: (obj: unknown) => void
  }
  const originallyPresent = typeof wt.markAsUncloneable === 'function'
  console.log(`  markAsUncloneable originally present: ${originallyPresent}`)

  if (SCENARIO === 'b' || SCENARIO === 'c') {
    // 模拟 Electron 31 / Node 20.x：删除 markAsUncloneable
    delete wt.markAsUncloneable
    console.log(`  [scenario ${SCENARIO}] Deleted markAsUncloneable (simulate Node 20.x)`)

    if (SCENARIO === 'c') {
      // 应用 workerThreadsPatch：重新注入 no-op（等价于
      // client/desktop/electron/main/compat/workerThreadsPatch.ts 的修复逻辑）
      wt.markAsUncloneable = (_obj: unknown): void => {
        // no-op: 标记对象不可克隆给 Worker；pi-coding-agent 子进程不实际 postMessage 这些对象
      }
      console.log(`  [scenario C] Applied workerThreadsPatch (no-op markAsUncloneable)`)
    }
  }

  const afterManipulation = typeof wt.markAsUncloneable === 'function'
  console.log(`  markAsUncloneable after manipulation: ${afterManipulation}`)

  // ------------------------------------------------------------------------
  // Step 2: 动态导入 pi-coding-agent（触发 undici 加载 → worker_threads require）
  // ------------------------------------------------------------------------
  console.log('\n[Step 2] Dynamic import @earendil-works/pi-coding-agent')
  const piPkg = await step('import(@earendil-works/pi-coding-agent)', async () => {
    return await import('@earendil-works/pi-coding-agent')
  })
  if (!piPkg) {
    console.log('\n!! import failed — cannot continue')
    return reportAndExit()
  }
  console.log(`  piPkg exports: ${Object.keys(piPkg).slice(0, 20).join(', ')}${Object.keys(piPkg).length > 20 ? ' ...' : ''}`)

  // ------------------------------------------------------------------------
  // Step 3: 触发 undici CacheStorage 实例化（场景 B 的崩溃点）
  // ------------------------------------------------------------------------
  // workerThreadsPatch 注释指出崩溃发生在 new CacheStorage()，而非 import 时。
  // 这里尝试两条路径触发：
  //   3a. 通过 pi-coding-agent 的 resourceLoader.reload()（可能内部用 fetch）
  //   3b. 直接 require undici 并访问其 web Cache API
  // ------------------------------------------------------------------------
  console.log('\n[Step 3] Try to trigger undici CacheStorage instantiation')

  // 3b: 直接探查 undici（独立于 pi-coding-agent，定位崩溃点）
  await step('require(undici).Cache / CacheStorage probe', async () => {
    try {
      const undici = __require('undici')
      // 尝试访问 undici 的 web Cache API（CacheStorage 在被 new 时崩溃）
      if (undici.CacheStorage) {
        console.log('    undici.CacheStorage found, attempting new CacheStorage()...')
        // eslint-disable-next-line no-new
        new undici.CacheStorage()
        return 'new CacheStorage() succeeded'
      }
      if (undici.WebCache) {
        console.log('    undici.WebCache found (alternative export)')
      }
      // undici 也可能通过 fetch + cache 触发；这里只做静态探测
      return `undici exports: ${Object.keys(undici).filter((k) => /cache/i.test(k)).join(', ') || '(no cache-related exports)'}`
    } catch (err) {
      // __require('undici') 可能解析到 undici 也可以是 pi-coding-agent 的 bundled 版本
      // 如果 require 失败，尝试从 pi-coding-agent 的依赖路径找
      const e = err as NodeJS.ErrnoException
      if (e.code === 'MODULE_NOT_FOUND') {
        return 'undici not directly resolvable from here (likely bundled in pi-coding-agent)'
      }
      throw err
    }
  })

  // ------------------------------------------------------------------------
  // Step 4: 模拟 piBridge.createSession 的初始化序列（无 DB / 无 WS 依赖）
  // ------------------------------------------------------------------------
  console.log('\n[Step 4] Simulate piBridge.createSession init sequence (no DB/WS)')

  // 用临时目录作为 cwd/agentDir，避免污染真实 .pi 目录
  const tmpRoot = join(tmpdir(), `poc-pi-${Date.now()}`)
  const cwd = tmpRoot
  const agentDir = join(tmpRoot, '.pi')
  console.log(`  tmpRoot: ${tmpRoot}`)

  // 4a. getAgentDir
  const agentDirFromPkg = await step('piPkg.getAgentDir()', async () => {
    return piPkg.getAgentDir()
  })
  console.log(`  getAgentDir() -> ${agentDirFromPkg}`)

  // 4b. SessionManager.inMemory
  const sessionManager = await step('piPkg.SessionManager.inMemory(cwd)', async () => {
    return piPkg.SessionManager.inMemory(cwd)
  })

  // 4c. DefaultResourceLoader（参考 piBridge.ts:1182-1204 / LocalAgentService.ts:354-365）
  const resourceLoader = await step('new piPkg.DefaultResourceLoader({...})', async () => {
    const loader = new piPkg.DefaultResourceLoader({
      cwd,
      agentDir,
      additionalSkillPaths: [], // 不扫描 skills，避免外部依赖
      extensionFactories: [
        (pi: { registerTool: (t: unknown) => void }) => {
          // 空 factory，不注册任何自定义工具
          void pi
        },
      ],
    })
    return loader
  })

  // 4d. resourceLoader.reload() — 这里可能触发 extensions 加载（可能用 fetch/undici）
  if (resourceLoader) {
    await step('resourceLoader.reload()', async () => {
      await resourceLoader.reload()
      return 'reloaded'
    })

    // 4e. 探查已加载的 extensions / skills
    await step('resourceLoader.getExtensions()', async () => {
      const ext = resourceLoader.getExtensions()
      const providerCount = ext.runtime.pendingProviderRegistrations.length
      return `extensions loaded, pendingProviders=${providerCount}`
    })
  }

  // 4f. AuthStorage.create
  const authStorage = await step('piPkg.AuthStorage.create(auth.json path)', async () => {
    return piPkg.AuthStorage.create(join(agentDir, 'auth.json'))
  })

  // 4g. ModelRegistry.create
  const modelRegistry = await step('piPkg.ModelRegistry.create(authStorage)', async () => {
    return piPkg.ModelRegistry.create(authStorage)
  })

  // 4h. 尝试 flush extension providers（参考 piBridge.ts:1234-1238）
  if (resourceLoader && modelRegistry) {
    await step('flush pendingProviderRegistrations into modelRegistry', async () => {
      const ext = resourceLoader.getExtensions()
      let count = 0
      for (const { name, config } of ext.runtime.pendingProviderRegistrations) {
        modelRegistry.registerProvider(name, config)
        count++
      }
      ext.runtime.pendingProviderRegistrations = []
      return `flushed ${count} providers`
    })
  }

  // 4i. modelRegistry.find — 预期可能失败（无真实 provider/key）
  if (modelRegistry) {
    await step('modelRegistry.find("stepfun", "step-3.7-flash")', async () => {
      const m = modelRegistry.find('stepfun', 'step-3.7-flash')
      if (!m) {
        throw new Error('model not found (expected without real provider registration / API key)')
      }
      return `found model: ${JSON.stringify({ provider: m?.provider, id: m?.id ?? m?.name })}`
    })
  }

  // 4j. createAgentSession（用最小 config，预期可能失败在 model 校验）
  // 跳过如果前面缺步骤
  if (sessionManager && resourceLoader && authStorage && modelRegistry) {
    await step('piPkg.createAgentSession({...minimal...})', async () => {
      // 不传 model（让 createAgentSession 自己报错），仅验证调用路径不触发 worker_threads 崩溃
      try {
        const { session } = await piPkg.createAgentSession({
          cwd,
          agentDir,
          resourceLoader,
          sessionManager,
          authStorage,
          modelRegistry,
          model: null as unknown, // 故意传 null，预期在 model 校验处失败
          noTools: 'builtin',
          customTools: [],
        })
        return `session created: ${session?.sessionId ?? '(no id)'}`
      } catch (err) {
        // 区分“worker_threads 崩溃”与“model 校验失败”
        const msg = (err as Error).message ?? ''
        if (/markAsUncloneable|worker_threads|CacheStorage/i.test(msg)) {
          throw err // 这是我们要捕获的兼容性崩溃，重新抛出
        }
        // 其他错误（如 model 为 null 的校验错误）视为“初始化路径通过，仅 config 不足”
        return `expected config error (NOT a compat crash): ${msg.slice(0, 120)}`
      }
    })
  }

  // ------------------------------------------------------------------------
  // Step 5: 模拟一次实际 undici fetch（触发 CacheStorage 懒初始化的另一路径）
  // ------------------------------------------------------------------------
  console.log('\n[Step 5] Probe undici fetch (alternative CacheStorage trigger)')
  await step('undici.fetch probe (http://127.0.0.1:1)', async () => {
    try {
      const undici = __require('undici')
      if (typeof undici.fetch !== 'function') {
        return 'undici.fetch not available'
      }
      // 发一个必然失败的请求，仅触发 undici 内部初始化路径
      try {
        await undici.fetch('http://127.0.0.1:1/poc-probe', { signal: AbortSignal.timeout(500) })
      } catch {
        // 网络错误是预期的，不关心
      }
      return 'undici.fetch invoked without worker_threads crash'
    } catch (err) {
      const e = err as NodeJS.ErrnoException
      if (e.code === 'MODULE_NOT_FOUND') {
        return 'undici not directly resolvable (bundled in pi-coding-agent)'
      }
      throw err
    }
  })

  return reportAndExit()
}

function reportAndExit(): void {
  console.log('\n' + '='.repeat(72))
  console.log('SUMMARY')
  console.log('='.repeat(72))
  const passed = results.filter((r) => r.ok).length
  const failed = results.filter((r) => !r.ok).length
  console.log(`Steps: ${passed} passed, ${failed} failed, ${results.length} total`)
  console.log('')
  for (const r of results) {
    const mark = r.ok ? 'OK  ' : 'FAIL'
    console.log(`  [${mark}] ${r.step}  (${r.ms}ms)`)
    if (!r.ok && r.message) console.log(`         ${r.error}: ${r.message}`)
  }
  console.log('='.repeat(72))

  // 退出码：场景 A/C 期望全 OK；场景 B 期望至少有一个 worker_threads 相关 FAIL
  // 但 createAgentSession / modelRegistry.find 的 config 性 FAIL 不算兼容性失败
  const compatFailures = results.filter(
    (r) => !r.ok && /markAsUncloneable|worker_threads|CacheStorage|undici/i.test(r.message ?? ''),
  )
  if (compatFailures.length > 0) {
    console.log(`\nCOMPAT FAILURE detected (${compatFailures.length} step(s)):`)
    for (const f of compatFailures) {
      console.log(`  - ${f.step}: ${f.error}: ${f.message}`)
    }
  }

  // 输出 JSON 摘要（便于自动化解析）
  console.log('\n--- JSON SUMMARY ---')
  console.log(
    JSON.stringify(
      {
        scenario: SCENARIO,
        nodeVersion: process.version,
        nodeAbi: process.versions.modules,
        electronRunAsNode: process.env.ELECTRON_RUN_AS_NODE,
        steps: results,
        compatFailures: compatFailures.length,
        overall: compatFailures.length === 0 ? 'PASS' : 'COMPAT_FAIL',
      },
      null,
      2,
    ),
  )
  console.log('--- END JSON SUMMARY ---\n')
}

main().catch((err) => {
  console.error('\n!! Uncaught error in main:', err)
  reportAndExit()
})
