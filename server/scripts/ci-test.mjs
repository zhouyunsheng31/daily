#!/usr/bin/env node
/**
 * Phase S8.1：跨平台 CI 测试脚本（Node ESM）
 *
 * 串联执行：
 *   1. tsc 类型检查（tsconfig.spec.json --noEmit）
 *   2. vitest unit 测试（test/unit）
 *   3. vitest integration 测试（test/integration）
 *   4. vitest coverage（可选，--no-coverage 跳过）
 *
 * 用法：
 *   node scripts/ci-test.mjs                     # 全套（tsc + unit + integration + coverage）
 *   node scripts/ci-test.mjs --no-coverage       # 跳过 coverage
 *   node scripts/ci-test.mjs --unit-only         # 仅 tsc + unit（跳过 integration + coverage）
 *   node scripts/ci-test.mjs --integration-only  # 仅 tsc + integration（跳过 unit + coverage）
 *
 * 每步失败立即 exit(1)。
 * Windows 下 npx 需通过 shell:true 找到 npx.cmd。
 */

import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { existsSync } from 'node:fs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const serverRoot = resolve(__dirname, '..')

// ANSI 颜色转义
const C = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
  bold: '\x1b[1m',
}

const argv = process.argv.slice(2)
const noCoverage = argv.includes('--no-coverage')
const unitOnly = argv.includes('--unit-only')
const integrationOnly = argv.includes('--integration-only')

function color(col, msg) {
  return `${col}${msg}${C.reset}`
}

/**
 * 执行一个命令，stdout/stderr 直接继承父进程（实时输出）
 * @returns {Promise<number>} 退出码
 */
function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd: serverRoot,
      stdio: 'inherit',
      shell: process.platform === 'win32',  // Windows 下需 shell:true 找到 npx.cmd
      ...opts,
    })
    child.on('close', (code, signal) => {
      if (signal) {
        reject(new Error(`进程被信号 ${signal} 终止`))
      } else {
        resolve(code ?? -1)
      }
    })
    child.on('error', (err) => {
      reject(err)
    })
  })
}

async function runStep(num, total, label, fn) {
  console.log()
  console.log(color(C.bold + C.cyan, `▶ [${num}/${total}] ${label}`))
  console.log(color(C.gray, '─'.repeat(60)))
  try {
    const code = await fn()
    if (code !== 0) {
      console.log(color(C.red, `  ✗ ${label} 失败（退出码 ${code}）`))
      return false
    }
    console.log(color(C.green, `  ✓ ${label} 通过`))
    return true
  } catch (err) {
    console.log(color(C.red, `  ✗ ${label} 异常: ${err instanceof Error ? err.message : String(err)}`))
    return false
  }
}

async function main() {
  const startTime = Date.now()

  console.log(color(C.bold + C.magenta, '╔══════════════════════════════════════════════════════════╗'))
  console.log(color(C.bold + C.magenta, '║          Phase S8.1 CI Test Runner                       ║'))
  console.log(color(C.bold + C.magenta, '╚══════════════════════════════════════════════════════════╝'))
  console.log()
  console.log(color(C.gray, `工作目录: ${serverRoot}`))
  console.log(color(C.gray, `参数: ${argv.length > 0 ? argv.join(' ') : '(无)'}`))

  // 构建步骤列表
  const steps = []

  // 步骤 1：tsc 类型检查（始终执行）
  steps.push({
    label: 'TypeScript 类型检查 (tsc -p tsconfig.spec.json --noEmit)',
    run: () => run('npx', ['tsc', '-p', 'tsconfig.spec.json', '--noEmit']),
  })

  // 步骤 2：vitest unit
  if (!integrationOnly) {
    const unitDir = resolve(serverRoot, 'test', 'unit')
    if (existsSync(unitDir)) {
      steps.push({
        label: 'Vitest 单元测试 (test/unit)',
        run: () => run('npx', ['vitest', 'run', 'test/unit', '--reporter=verbose']),
      })
    } else {
      console.log(color(C.yellow, '  ⚠ test/unit 目录不存在，跳过单元测试'))
    }
  }

  // 步骤 3：vitest integration
  if (!unitOnly) {
    const intDir = resolve(serverRoot, 'test', 'integration')
    if (existsSync(intDir)) {
      steps.push({
        label: 'Vitest 集成测试 (test/integration)',
        run: () => run('npx', ['vitest', 'run', 'test/integration', '--reporter=verbose']),
      })
    } else {
      console.log(color(C.yellow, '  ⚠ test/integration 目录不存在，跳过集成测试'))
    }
  }

  // 步骤 4：vitest coverage
  if (!noCoverage) {
    steps.push({
      label: 'Vitest 覆盖率报告 (--coverage)',
      run: () => run('npx', ['vitest', 'run', '--coverage']),
    })
  }

  console.log(color(C.gray, `步骤数: ${steps.length}`))

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i]
    const ok = await runStep(i + 1, steps.length, step.label, step.run)
    if (!ok) {
      console.log()
      console.log(color(C.bold + C.red, `✗ CI 失败：步骤 ${i + 1} (${step.label}) 未通过`))
      process.exit(1)
    }
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
  console.log()
  console.log(color(C.bold + C.green, `✓ 全部 ${steps.length} 步通过（${elapsed}s）`))
}

main().catch((err) => {
  console.log(color(C.bold + C.red, `✗ CI 脚本异常: ${err instanceof Error ? err.message : String(err)}`))
  process.exit(1)
})
