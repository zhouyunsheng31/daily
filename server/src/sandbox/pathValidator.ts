// ============================================================================
// Phase 3：沙箱路径验证器（spec §7）
// 确保所有文件操作都在沙箱目录内，防止路径遍历攻击（../）
// ============================================================================

import path from 'node:path'

let sandboxRoot: string = ''

/**
 * 设置沙箱根目录（绝对路径）
 */
export function setSandboxRoot(root: string): void {
  sandboxRoot = path.resolve(root)
}

/**
 * 获取沙箱根目录
 */
export function getSandboxRoot(): string {
  return sandboxRoot
}

export interface PathValidationResult {
  safe: boolean
  absolutePath: string
  error?: string
}

/**
 * 验证用户提供的路径是否在沙箱内
 *
 * 安全检查：
 * 1. 拒绝空路径
 * 2. 拒绝绝对路径输入（防止 /etc/passwd, C:\Windows 等）
 * 3. 解析路径（相对于沙箱根目录，处理 ../ 路径遍历）
 * 4. 检查解析后的绝对路径是否在沙箱目录内
 *
 * @param inputPath 用户提供的相对路径（相对于沙箱根目录）
 * @returns 验证结果，包含安全标志和解析后的绝对路径
 */
export function validateSandboxPath(inputPath: string): PathValidationResult {
  if (!sandboxRoot) {
    return { safe: false, absolutePath: '', error: 'Sandbox not initialized' }
  }

  // 拒绝空路径
  if (!inputPath || inputPath.trim() === '') {
    return { safe: false, absolutePath: '', error: 'Path is empty' }
  }

  const trimmedPath = inputPath.trim()

  // 拒绝绝对路径输入（防止 /etc/passwd, C:\Windows 等）
  if (path.isAbsolute(trimmedPath)) {
    return {
      safe: false,
      absolutePath: '',
      error: `Absolute paths are not allowed: ${trimmedPath}`,
    }
  }

  // 解析路径（相对于沙箱根目录，path.resolve 会规范化 ../ 等相对组件）
  const resolved = path.resolve(sandboxRoot, trimmedPath)

  // 检查解析后的路径是否在沙箱内
  // path.relative 返回从 sandboxRoot 到 resolved 的相对路径
  // - 如果结果以 .. 开头，说明路径逃出了沙箱
  // - 如果结果为空字符串，说明路径就是沙箱根目录本身（允许）
  // - 其他情况（不以 .. 开头）都在沙箱内
  const relative = path.relative(sandboxRoot, resolved)

  if (relative.startsWith('..')) {
    return {
      safe: false,
      absolutePath: resolved,
      error: `Path escapes sandbox: "${inputPath}" resolves outside sandbox root`,
    }
  }

  return { safe: true, absolutePath: resolved }
}

/**
 * 批量验证多个路径
 * 任一路径不安全则整体不安全
 */
export function validateSandboxPaths(inputPaths: string[]): PathValidationResult {
  for (const p of inputPaths) {
    const result = validateSandboxPath(p)
    if (!result.safe) {
      return result
    }
  }
  // 返回最后一个路径的绝对路径（调用方一般不会在批量验证后用这个值）
  const last = inputPaths[inputPaths.length - 1]
  return last ? validateSandboxPath(last) : { safe: true, absolutePath: '' }
}
