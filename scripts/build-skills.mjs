#!/usr/bin/env node
// Phase 14：统一 Skill CLI 构建脚本
//
// 遍历 .pi/skills/ 下所有子目录的 tsconfig.json，逐个调用 tsc 编译 cli.ts 到 cli.js
// 跳过没有 tsconfig.json 的 Skill（如 product-guide 是纯文档 Skill）
//
// 用法：node scripts/build-skills.mjs

import { readdir, stat, access } from 'node:fs/promises'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const PROJECT_ROOT = join(__dirname, '..')
const SKILLS_DIR = join(PROJECT_ROOT, '.pi', 'skills')

/**
 * 执行命令，返回 Promise<{ code, stdout, stderr }>
 * Windows 上 spawn 默认不解析 .cmd 扩展名（如 npx.cmd），需要 shell: true
 */
function run(cmd, args, cwd) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: process.platform === 'win32',  // Windows 需要 shell 解析 .cmd
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (d) => { stdout += d.toString() })
    child.stderr.on('data', (d) => { stderr += d.toString() })
    child.on('close', (code) => {
      resolve({ code: code ?? 0, stdout, stderr })
    })
    child.on('error', (err) => {
      resolve({ code: 1, stdout, stderr: err.message })
    })
  })
}

async function pathExists(p) {
  try {
    await access(p)
    return true
  } catch {
    return false
  }
}

async function main() {
  console.log(`[build-skills] Scanning ${SKILLS_DIR}...`)

  let entries
  try {
    entries = await readdir(SKILLS_DIR, { withFileTypes: true })
  } catch (err) {
    console.error(`[build-skills] Failed to read skills dir: ${err.message}`)
    process.exit(1)
  }

  const skillDirs = entries.filter((e) => e.isDirectory()).map((e) => e.name)
  if (skillDirs.length === 0) {
    console.log('[build-skills] No skill directories found.')
    return
  }

  console.log(`[build-skills] Found ${skillDirs.length} skill(s): ${skillDirs.join(', ')}`)

  const results = []
  for (const skillName of skillDirs) {
    const skillPath = join(SKILLS_DIR, skillName)
    const tsconfigPath = join(skillPath, 'tsconfig.json')
    const cliTsPath = join(skillPath, 'cli.ts')

    // 跳过没有 tsconfig.json 或 cli.ts 的 Skill（如 product-guide 纯文档 Skill）
    if (!(await pathExists(tsconfigPath)) || !(await pathExists(cliTsPath))) {
      console.log(`[build-skills] SKIP ${skillName} (no tsconfig.json or cli.ts)`)
      results.push({ skill: skillName, status: 'skip' })
      continue
    }

    console.log(`[build-skills] BUILD ${skillName}...`)
    const result = await run('npx', ['tsc', '-p', tsconfigPath], skillPath)
    if (result.code === 0) {
      console.log(`[build-skills]   ✅ ${skillName} compiled`)
      results.push({ skill: skillName, status: 'ok' })
    } else {
      console.error(`[build-skills]   ❌ ${skillName} failed (exit ${result.code})`)
      console.error(result.stderr || result.stdout)
      results.push({ skill: skillName, status: 'fail', error: result.stderr || result.stdout })
    }
  }

  // 汇总
  const ok = results.filter((r) => r.status === 'ok').length
  const skip = results.filter((r) => r.status === 'skip').length
  const fail = results.filter((r) => r.status === 'fail').length
  console.log(`\n[build-skills] Done: ${ok} ok, ${skip} skipped, ${fail} failed`)

  if (fail > 0) {
    process.exit(1)
  }
}

main().catch((err) => {
  console.error(`[build-skills] Fatal: ${err.message}`)
  process.exit(1)
})
