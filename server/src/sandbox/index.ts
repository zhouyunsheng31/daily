// ============================================================================
// Phase 3：沙箱入口（spec §7）
// 初始化沙箱目录 + 导出工具函数
// ============================================================================

import path from 'node:path'
import fs from 'node:fs'
import { setSandboxRoot, getSandboxRoot } from './pathValidator.js'

let initialized = false

/**
 * 初始化沙箱目录
 * - 读取 SANDBOX_DIR 环境变量，默认为 <cwd>/data/workspace
 * - 创建沙箱目录（如果不存在）
 * - 设置路径验证器的根目录
 *
 * 幂等：重复调用安全
 */
export function initSandbox(): void {
  if (initialized) {
    return
  }

  const sandboxDir = process.env.SANDBOX_DIR
    || path.resolve(process.cwd(), 'data', 'workspace')

  // 确保沙箱目录存在
  if (!fs.existsSync(sandboxDir)) {
    fs.mkdirSync(sandboxDir, { recursive: true })
    console.log(`[Sandbox] Created sandbox directory: ${sandboxDir}`)
  }

  setSandboxRoot(sandboxDir)
  initialized = true
  console.log(`[Sandbox] Initialized at ${sandboxDir}`)
}

/**
 * 获取沙箱根目录
 */
export function getSandboxDir(): string {
  return getSandboxRoot()
}

/**
 * 检查沙箱是否已初始化
 */
export function isSandboxInitialized(): boolean {
  return initialized
}

// 导出沙箱工具函数
export { validateSandboxPath, getSandboxRoot, validateSandboxPaths } from './pathValidator.js'
export { runCommand, getWhitelistedCommands, type CommandResult } from './commandRunner.js'
