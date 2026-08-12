// ============================================================================
// Phase 3：沙箱命令执行器（spec §7）
// 白名单命令 + 超时控制 + 输出大小限制 + 危险模式检测
// ============================================================================

import { exec } from 'node:child_process'

const COMMAND_TIMEOUT_MS = 30_000
const MAX_OUTPUT_BYTES = 1_048_576 // 1MB

/**
 * 安全命令白名单
 * 仅允许读取/搜索/文本处理/安全文件操作命令
 * 危险命令（rm, rmdir, del, shutdown, reboot, mkfs, dd, format 等）不在白名单中
 */
const COMMAND_WHITELIST = new Set([
  // 文件查看
  'ls', 'cat', 'head', 'tail', 'tac', 'rev',
  'file', 'stat', 'wc', 'tree', 'basename', 'dirname', 'realpath',
  // 搜索
  'grep', 'egrep', 'fgrep', 'rg', 'find', 'locate', 'which', 'whereis',
  // 文本处理
  'echo', 'printf', 'sed', 'awk', 'tr', 'cut', 'paste', 'column',
  'sort', 'uniq', 'comm', 'join', 'split', 'csplit', 'fold', 'fmt',
  // 文件操作（安全）
  'mkdir', 'touch', 'cp', 'mv', 'ln', 'tee',
  // 信息查询
  'pwd', 'date', 'whoami', 'id', 'env', 'printenv', 'hostname',
  'uname', 'df', 'du', 'lsb_release',
  // 测试
  'test', 'true', 'false',
])

/**
 * 危险命令模式（黑名单，双重保险）
 * 即使命令在白名单中，如果匹配这些模式也会被拒绝
 * 这些模式检测无法通过白名单拦截的危险构造
 */
const DANGEROUS_PATTERNS: RegExp[] = [
  /\b:\(\)\s*\{/,                  // fork bomb :(){:|:&};:
  /\/dev\/sd[a-z]/i,              // 引用磁盘设备 /dev/sda 等
  /\/dev\/disk/i,                 // 引用磁盘设备 /dev/disk
  /\bcurl\s+.*\|\s*(sh|bash)/i,   // curl pipe to shell
  /\bwget\s+.*\|\s*(sh|bash)/i,   // wget pipe to shell
  /\bsudo\b/i,                    // sudo 提权
  /\bsu\s+/i,                     // su 切换用户
]

export interface CommandResult {
  success: boolean
  stdout: string
  stderr: string
  exitCode: number | null
  durationMs: number
  error?: string
}

/**
 * 从命令字符串中提取所有命令名（处理管道、&&、||、; 分隔的多命令）
 * 用于检查管道后的命令是否也在白名单中
 *
 * 例如："ls -la | grep foo; cat bar.txt" → ['ls', 'grep', 'cat']
 */
function extractCommandNames(command: string): string[] {
  // 按管道 |、分号 ;、&& 、|| 分割
  const parts = command.split(/\|\||&&|[|;]/)
  const names: string[] = []
  for (const part of parts) {
    const trimmed = part.trim()
    if (!trimmed) continue
    // 取第一个 token 作为命令名
    const tokens = trimmed.split(/\s+/)
    if (tokens[0]) {
      names.push(tokens[0])
    }
  }
  return names
}

/**
 * 执行 shell 命令（在沙箱内）
 *
 * 安全措施：
 * 1. 命令名白名单检查（包括管道后的每个命令）
 * 2. 危险模式黑名单检测（fork bomb, /dev/sd, sudo 等）
 * 3. 禁止命令替换 $() 和反引号（防止绕过白名单）
 * 4. 超时 30 秒
 * 5. 输出大小限制 1MB
 * 6. 工作目录设置为沙箱目录
 *
 * @param command 要执行的命令字符串
 * @param cwd 工作目录（应为沙箱目录）
 */
export function runCommand(command: string, cwd: string): Promise<CommandResult> {
  const start = Date.now()

  // 1. 拒绝空命令
  if (!command || command.trim() === '') {
    return Promise.resolve({
      success: false,
      stdout: '',
      stderr: '',
      exitCode: null,
      durationMs: 0,
      error: 'Command is empty',
    })
  }

  const trimmedCommand = command.trim()

  // 2. 禁止命令替换 $() 和反引号（防止绕过白名单执行任意命令）
  if (trimmedCommand.includes('$(') || trimmedCommand.includes('`')) {
    return Promise.resolve({
      success: false,
      stdout: '',
      stderr: '',
      exitCode: null,
      durationMs: Date.now() - start,
      error: 'Command substitution ($() or backticks) is not allowed',
    })
  }

  // 3. 检查危险模式
  for (const pattern of DANGEROUS_PATTERNS) {
    if (pattern.test(trimmedCommand)) {
      return Promise.resolve({
        success: false,
        stdout: '',
        stderr: '',
        exitCode: null,
        durationMs: Date.now() - start,
        error: `Command matches dangerous pattern: ${pattern.source}`,
      })
    }
  }

  // 4. 提取所有命令名（包括管道后的），检查是否都在白名单中
  const commandNames = extractCommandNames(trimmedCommand)
  if (commandNames.length === 0) {
    return Promise.resolve({
      success: false,
      stdout: '',
      stderr: '',
      exitCode: null,
      durationMs: Date.now() - start,
      error: 'No command found in input',
    })
  }

  for (const cmdName of commandNames) {
    if (!COMMAND_WHITELIST.has(cmdName)) {
      return Promise.resolve({
        success: false,
        stdout: '',
        stderr: '',
        exitCode: null,
        durationMs: Date.now() - start,
        error: `Command not in whitelist: "${cmdName}". Allowed commands: ${Array.from(COMMAND_WHITELIST).sort().join(', ')}`,
      })
    }
  }

  // 5. 执行命令
  return new Promise((resolve) => {
    exec(
      trimmedCommand,
      {
        cwd,
        timeout: COMMAND_TIMEOUT_MS,
        maxBuffer: MAX_OUTPUT_BYTES,
        env: { ...process.env, PWD: cwd },
      },
      (err, stdout, stderr) => {
        const durationMs = Date.now() - start
        if (err) {
          // exec 超时会设置 err.killed = true 和 err.signal = 'SIGTERM'
          const isTimeout = (err as NodeJS.ErrnoException & { killed?: boolean }).killed === true
          resolve({
            success: false,
            stdout: stdout?.toString() ?? '',
            stderr: stderr?.toString() ?? '',
            exitCode: (err as NodeJS.ErrnoException & { code?: number }).code ?? null,
            durationMs,
            error: isTimeout
              ? `Command timed out after ${COMMAND_TIMEOUT_MS}ms`
              : err.message,
          })
        } else {
          resolve({
            success: true,
            stdout: stdout?.toString() ?? '',
            stderr: stderr?.toString() ?? '',
            exitCode: 0,
            durationMs,
          })
        }
      },
    )
  })
}

/**
 * 获取白名单命令列表（供 API 查询）
 */
export function getWhitelistedCommands(): string[] {
  return Array.from(COMMAND_WHITELIST).sort()
}
