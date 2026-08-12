/**
 * fs-cli — 文件系统操作 Skill CLI
 *
 * 仅依赖 Node.js 内置 API（fs/promises / path / os），不引入任何外部依赖。
 * 安全沙箱：白名单 / 黑名单 / realpath 解析 / 拒绝 UNC / 拒绝 8.3 / 拒绝 ..
 * 审计日志：F:\allmylife\event\data\fs-audit.log（>10MB 自动轮转）
 */

import { resolve, sep, join, dirname, basename } from 'node:path'
import { homedir } from 'node:os'
import {
  realpath,
  readdir,
  stat as fsStat,
  readFile,
  writeFile,
  mkdir,
  rm as fsRm,
  rename,
  copyFile,
  appendFile,
  stat,
} from 'node:fs/promises'

// ============ Constants ============

const WHITELIST: readonly string[] = [
  resolve('F:\\allmylife\\event'),
  resolve(join(homedir(), 'Documents')),
  resolve(join(homedir(), 'AppData', 'Roaming', 'living-dashboard')),
]

const BLACKLIST: readonly string[] = [
  resolve('C:\\Windows'),
  resolve('C:\\Program Files'),
  resolve('C:\\Program Files (x86)'),
  resolve('C:\\System Volume Information'),
]

const AUDIT_LOG_PATH = 'F:\\allmylife\\event\\data\\fs-audit.log'
const AUDIT_LOG_MAX_SIZE = 10 * 1024 * 1024 // 10MB

// ============ Types ============

type ValidateResult = { ok: true; realPath: string } | { ok: false; error: string }

class CliError extends Error {
  code: number
  constructor(message: string, code = 1) {
    super(message)
    this.code = code
    this.name = 'CliError'
  }
}

interface ParsedArgs {
  command: string | null
  positionals: string[]
  json: boolean
  recursive: boolean
  content: string | null
  encoding: 'utf8' | 'base64'
}

interface CommandResult {
  data: unknown
  text: string
}

// ============ Security Sandbox ============

async function validatePath(p: string): Promise<ValidateResult> {
  // 1. Reject UNC paths (\\SERVER\share)
  if (p.startsWith('\\\\')) {
    return { ok: false, error: 'UNC paths not allowed' }
  }
  // 2. Reject 8.3 short names in any path segment (e.g. PROGRA~1)
  const segments = p.split(/[\\/]/)
  if (segments.some((s) => /~\d+$/i.test(s))) {
    return { ok: false, error: '8.3 short names not allowed' }
  }
  // 3. Reject .. in raw input (must catch before realpath)
  if (p.includes('..')) {
    return { ok: false, error: 'Parent directory references not allowed' }
  }
  // 4. Resolve to absolute path
  const resolved = resolve(p)
  // 5. Realpath to resolve symlinks/junctions.
  //    For non-existent paths (new file/dir), walk up to nearest existing ancestor,
  //    realpath it, then re-append the remaining components. This prevents symlink
  //    bypass where a junction inside the whitelist points to a blacklisted dir
  //    and the target path doesn't exist yet (realpath would fail).
  let real: string
  try {
    real = await realpath(resolved)
  } catch {
    // Path doesn't exist — walk up to find existing ancestor
    let existingAncestor = resolved
    const pendingParts: string[] = []
    while (true) {
      try {
        existingAncestor = await realpath(existingAncestor)
        break // Found existing ancestor, realpath resolved
      } catch {
        pendingParts.unshift(basename(existingAncestor))
        const parent = dirname(existingAncestor)
        if (parent === existingAncestor) {
          // Reached filesystem root without finding existing path
          existingAncestor = parent
          break
        }
        existingAncestor = parent
      }
    }
    real = pendingParts.length > 0 ? join(existingAncestor, ...pendingParts) : existingAncestor
  }
  // 6. Case-insensitive blacklist check FIRST (deny overrides allow — spec: 黑名单优先于白名单)
  const normalized = real.toLowerCase()
  const inBlacklist = BLACKLIST.some((b) => {
    const bl = b.toLowerCase()
    return normalized === bl || normalized.startsWith(bl + sep)
  })
  if (inBlacklist) {
    return { ok: false, error: `Path in blacklist: ${real}` }
  }
  // 7. Case-insensitive whitelist check
  const inWhitelist = WHITELIST.some((w) => {
    const wl = w.toLowerCase()
    return normalized === wl || normalized.startsWith(wl + sep)
  })
  if (!inWhitelist) {
    return { ok: false, error: `Path not in whitelist: ${real}` }
  }
  return { ok: true, realPath: real }
}

// ============ Audit Log ============

async function writeAuditLog(operation: string, path: string, result: string): Promise<void> {
  try {
    // Ensure data directory exists
    const dir = dirname(AUDIT_LOG_PATH)
    await mkdir(dir, { recursive: true })

    // Check size for rotation
    try {
      const st = await stat(AUDIT_LOG_PATH)
      if (st.size > AUDIT_LOG_MAX_SIZE) {
        try {
          await rename(AUDIT_LOG_PATH, AUDIT_LOG_PATH + '.1')
        } catch {
          // If rename fails (e.g. .1 exists and locked), continue appending
        }
      }
    } catch {
      // File doesn't exist yet — no rotation needed
    }

    const timestamp = new Date().toISOString()
    const line = `[${timestamp}] | ${operation} | ${path} | ${result}\n`
    await appendFile(AUDIT_LOG_PATH, line, 'utf8')
  } catch {
    // Audit log failure must not crash the CLI
  }
}

// ============ Argument Parsing ============

function parseArgs(argv: string[]): ParsedArgs {
  const args = argv.slice(2) // skip node + script path
  let command: string | null = null
  if (args.length > 0 && !args[0].startsWith('-')) {
    command = args[0]
  }
  const rest = command ? args.slice(1) : args

  const positionals: string[] = []
  let json = false
  let recursive = false
  let content: string | null = null
  let encoding: 'utf8' | 'base64' = 'utf8'

  for (let i = 0; i < rest.length; i++) {
    const a = rest[i]
    if (a === '--json') {
      json = true
    } else if (a === '--recursive' || a === '-r') {
      recursive = true
    } else if (a === '--content') {
      if (i + 1 >= rest.length) {
        throw new CliError('--content requires a value', 2)
      }
      content = rest[++i]
    } else if (a === '--encoding') {
      if (i + 1 >= rest.length) {
        throw new CliError('--encoding requires a value', 2)
      }
      const enc = rest[++i]
      if (enc !== 'utf8' && enc !== 'base64') {
        throw new CliError(`Invalid encoding: ${enc} (must be utf8 or base64)`, 2)
      }
      encoding = enc
    } else if (a.startsWith('--content=')) {
      content = a.slice('--content='.length)
    } else if (a.startsWith('--encoding=')) {
      const enc = a.slice('--encoding='.length)
      if (enc !== 'utf8' && enc !== 'base64') {
        throw new CliError(`Invalid encoding: ${enc} (must be utf8 or base64)`, 2)
      }
      encoding = enc
    } else if (a.startsWith('-')) {
      throw new CliError(`Unknown option: ${a}`, 2)
    } else {
      positionals.push(a)
    }
  }

  return { command, positionals, json, recursive, content, encoding }
}

// ============ Helpers ============

function formatTime(d: Date): string {
  const pad = (n: number): string => n.toString().padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

async function copyRecursive(src: string, dst: string): Promise<void> {
  const st = await fsStat(src)
  if (st.isDirectory()) {
    await mkdir(dst, { recursive: true })
    const entries = await readdir(src, { withFileTypes: true })
    for (const entry of entries) {
      await copyRecursive(join(src, entry.name), join(dst, entry.name))
    }
  } else {
    await copyFile(src, dst)
  }
}

async function moveSafe(src: string, dst: string): Promise<void> {
  try {
    await rename(src, dst)
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (code === 'EXDEV') {
      // Cross-device move: fall back to copy + delete
      const st = await fsStat(src)
      if (st.isDirectory()) {
        await copyRecursive(src, dst)
        await fsRm(src, { recursive: true })
      } else {
        await copyFile(src, dst)
        await fsRm(src)
      }
    } else {
      throw err
    }
  }
}

// ============ Command Handlers ============

async function cmdLs(args: ParsedArgs): Promise<CommandResult> {
  const rawPath = args.positionals[0]
  if (!rawPath) throw new CliError('ls requires <path>', 2)

  const validation = await validatePath(rawPath)
  if (!validation.ok) {
    await writeAuditLog('ls', rawPath, `denied:${validation.error}`)
    throw new CliError(validation.error, 1)
  }

  try {
    const entries = await readdir(validation.realPath, { withFileTypes: true })
    const result = await Promise.all(
      entries.map(async (e) => {
        const fullPath = join(validation.realPath, e.name)
        const st = await fsStat(fullPath)
        return {
          name: e.name,
          type: e.isDirectory() ? 'directory' : 'file',
          size: st.size,
          mtime: st.mtime.toISOString(),
        }
      }),
    )
    // Sort: directories first, then files, alphabetically
    result.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'directory' ? -1 : 1
      return a.name.localeCompare(b.name)
    })

    await writeAuditLog('ls', validation.realPath, 'ok')

    const textLines = [validation.realPath]
    for (const e of result) {
      const isDir = e.type === 'directory'
      const nameDisplay = isDir ? e.name + '/' : e.name
      const sizeDisplay = isDir ? '' : `${e.size} bytes`
      const timeDisplay = formatTime(new Date(e.mtime))
      const padded = nameDisplay.padEnd(28)
      textLines.push(`  ${padded}  ${isDir ? '(directory)' : `(${sizeDisplay})`}, ${timeDisplay}`)
    }
    return {
      data: { path: validation.realPath, entries: result },
      text: textLines.join('\n'),
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    await writeAuditLog('ls', validation.realPath, `error:${msg}`)
    throw new CliError(msg, 1)
  }
}

async function cmdRead(args: ParsedArgs): Promise<CommandResult> {
  const rawPath = args.positionals[0]
  if (!rawPath) throw new CliError('read requires <path>', 2)

  const validation = await validatePath(rawPath)
  if (!validation.ok) {
    await writeAuditLog('read', rawPath, `denied:${validation.error}`)
    throw new CliError(validation.error, 1)
  }

  try {
    let content: string
    if (args.encoding === 'base64') {
      const buf = await readFile(validation.realPath)
      content = buf.toString('base64')
    } else {
      content = await readFile(validation.realPath, 'utf8')
    }

    await writeAuditLog('read', validation.realPath, 'ok')

    return {
      data: { path: validation.realPath, encoding: args.encoding, content },
      text: content,
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    await writeAuditLog('read', validation.realPath, `error:${msg}`)
    throw new CliError(msg, 1)
  }
}

async function cmdWrite(args: ParsedArgs): Promise<CommandResult> {
  const rawPath = args.positionals[0]
  if (!rawPath) throw new CliError('write requires <path>', 2)
  if (args.content === null) throw new CliError('write requires --content <text>', 2)

  const validation = await validatePath(rawPath)
  if (!validation.ok) {
    await writeAuditLog('write', rawPath, `denied:${validation.error}`)
    throw new CliError(validation.error, 1)
  }

  try {
    // Auto-create parent directory
    const parent = dirname(validation.realPath)
    await mkdir(parent, { recursive: true })

    let bytes: number
    if (args.encoding === 'base64') {
      const buf = Buffer.from(args.content, 'base64')
      await writeFile(validation.realPath, buf)
      bytes = buf.length
    } else {
      await writeFile(validation.realPath, args.content, 'utf8')
      bytes = Buffer.byteLength(args.content, 'utf8')
    }

    await writeAuditLog('write', validation.realPath, 'ok')

    return {
      data: { path: validation.realPath, bytes },
      text: `Wrote ${bytes} bytes to ${validation.realPath}`,
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    await writeAuditLog('write', validation.realPath, `error:${msg}`)
    throw new CliError(msg, 1)
  }
}

async function cmdMkdir(args: ParsedArgs): Promise<CommandResult> {
  const rawPath = args.positionals[0]
  if (!rawPath) throw new CliError('mkdir requires <path>', 2)

  const validation = await validatePath(rawPath)
  if (!validation.ok) {
    await writeAuditLog('mkdir', rawPath, `denied:${validation.error}`)
    throw new CliError(validation.error, 1)
  }

  try {
    await mkdir(validation.realPath, { recursive: true })
    await writeAuditLog('mkdir', validation.realPath, 'ok')
    return {
      data: { path: validation.realPath },
      text: `Created directory ${validation.realPath}`,
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    await writeAuditLog('mkdir', validation.realPath, `error:${msg}`)
    throw new CliError(msg, 1)
  }
}

async function cmdRm(args: ParsedArgs): Promise<CommandResult> {
  const rawPath = args.positionals[0]
  if (!rawPath) throw new CliError('rm requires <path>', 2)

  const validation = await validatePath(rawPath)
  if (!validation.ok) {
    await writeAuditLog('rm', rawPath, `denied:${validation.error}`)
    throw new CliError(validation.error, 1)
  }

  try {
    // Check if it's a directory; if so, require --recursive
    const st = await fsStat(validation.realPath)
    if (st.isDirectory() && !args.recursive) {
      throw new Error('Cannot remove directory without --recursive')
    }

    await fsRm(validation.realPath, { recursive: args.recursive })
    await writeAuditLog('rm', validation.realPath, 'ok')
    return {
      data: { path: validation.realPath, removed: true },
      text: `Removed ${validation.realPath}`,
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    await writeAuditLog('rm', validation.realPath, `error:${msg}`)
    throw new CliError(msg, 1)
  }
}

async function cmdMv(args: ParsedArgs): Promise<CommandResult> {
  const rawSrc = args.positionals[0]
  const rawDst = args.positionals[1]
  if (!rawSrc || !rawDst) throw new CliError('mv requires <src> <dst>', 2)

  const srcValidation = await validatePath(rawSrc)
  if (!srcValidation.ok) {
    await writeAuditLog('mv', rawSrc, `denied:${srcValidation.error}`)
    throw new CliError(srcValidation.error, 1)
  }
  const dstValidation = await validatePath(rawDst)
  if (!dstValidation.ok) {
    await writeAuditLog('mv', rawDst, `denied:${dstValidation.error}`)
    throw new CliError(dstValidation.error, 1)
  }

  try {
    // Auto-create parent directory of destination
    const parent = dirname(dstValidation.realPath)
    await mkdir(parent, { recursive: true })

    await moveSafe(srcValidation.realPath, dstValidation.realPath)
    await writeAuditLog('mv', `${srcValidation.realPath} -> ${dstValidation.realPath}`, 'ok')
    return {
      data: { src: srcValidation.realPath, dst: dstValidation.realPath },
      text: `Moved ${srcValidation.realPath} -> ${dstValidation.realPath}`,
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    await writeAuditLog('mv', `${srcValidation.realPath} -> ${dstValidation.realPath}`, `error:${msg}`)
    throw new CliError(msg, 1)
  }
}

async function cmdCp(args: ParsedArgs): Promise<CommandResult> {
  const rawSrc = args.positionals[0]
  const rawDst = args.positionals[1]
  if (!rawSrc || !rawDst) throw new CliError('cp requires <src> <dst>', 2)

  const srcValidation = await validatePath(rawSrc)
  if (!srcValidation.ok) {
    await writeAuditLog('cp', rawSrc, `denied:${srcValidation.error}`)
    throw new CliError(srcValidation.error, 1)
  }
  const dstValidation = await validatePath(rawDst)
  if (!dstValidation.ok) {
    await writeAuditLog('cp', rawDst, `denied:${dstValidation.error}`)
    throw new CliError(dstValidation.error, 1)
  }

  try {
    const st = await fsStat(srcValidation.realPath)
    if (st.isDirectory() && !args.recursive) {
      throw new Error('Cannot copy directory without --recursive')
    }

    // Auto-create parent directory of destination
    const parent = dirname(dstValidation.realPath)
    await mkdir(parent, { recursive: true })

    if (st.isDirectory()) {
      await copyRecursive(srcValidation.realPath, dstValidation.realPath)
    } else {
      await copyFile(srcValidation.realPath, dstValidation.realPath)
    }

    await writeAuditLog('cp', `${srcValidation.realPath} -> ${dstValidation.realPath}`, 'ok')
    return {
      data: { src: srcValidation.realPath, dst: dstValidation.realPath },
      text: `Copied ${srcValidation.realPath} -> ${dstValidation.realPath}`,
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    await writeAuditLog('cp', `${srcValidation.realPath} -> ${dstValidation.realPath}`, `error:${msg}`)
    throw new CliError(msg, 1)
  }
}

async function cmdStat(args: ParsedArgs): Promise<CommandResult> {
  const rawPath = args.positionals[0]
  if (!rawPath) throw new CliError('stat requires <path>', 2)

  const validation = await validatePath(rawPath)
  if (!validation.ok) {
    await writeAuditLog('stat', rawPath, `denied:${validation.error}`)
    throw new CliError(validation.error, 1)
  }

  try {
    const st = await fsStat(validation.realPath)
    const data = {
      path: validation.realPath,
      size: st.size,
      mtime: st.mtime.toISOString(),
      ctime: st.ctime.toISOString(),
      atime: st.atime.toISOString(),
      isFile: st.isFile(),
      isDirectory: st.isDirectory(),
      mode: st.mode,
    }

    await writeAuditLog('stat', validation.realPath, 'ok')

    const type = st.isDirectory() ? 'directory' : 'file'
    const text = [
      validation.realPath,
      `  size: ${st.size} bytes`,
      `  type: ${type}`,
      `  modified: ${formatTime(st.mtime)}`,
      `  created: ${formatTime(st.ctime)}`,
    ].join('\n')

    return { data, text }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    await writeAuditLog('stat', validation.realPath, `error:${msg}`)
    throw new CliError(msg, 1)
  }
}

// ============ Main ============

async function main(): Promise<void> {
  let args: ParsedArgs
  try {
    args = parseArgs(process.argv)
  } catch (err) {
    if (err instanceof CliError) {
      // args not assigned yet; detect --json from raw argv
      const isJson = process.argv.includes('--json')
      if (isJson) {
        process.stdout.write(JSON.stringify({ ok: false, error: err.message }) + '\n')
      } else {
        process.stderr.write(`Error: ${err.message}\n`)
      }
      process.exit(err.code)
    }
    throw err
  }

  if (!args.command) {
    const usage = [
      'fs-cli — 文件系统操作 Skill CLI',
      '',
      'Usage: node cli.js <command> [args] [--json]',
      '',
      'Commands:',
      '  ls <path>                              List directory contents',
      '  read <path> [--encoding utf8|base64]   Read file content',
      '  write <path> --content <text> [--enc]  Write file (auto-creates parent dir)',
      '  mkdir <path>                           Create directory (recursive)',
      '  rm <path> [--recursive]                Remove file or directory',
      '  mv <src> <dst>                         Move/rename',
      '  cp <src> <dst> [--recursive]           Copy file or directory',
      '  stat <path>                            Get file metadata',
      '',
      'Options:',
      '  --json                   Output JSON: { ok: true, data } or { ok: false, error }',
      '  --encoding utf8|base64   Encoding for read/write (default: utf8)',
      '  --recursive / -r         Required for rm/cp on directories',
      '  --content <text>         Content to write (required for write)',
      '',
      'Exit codes: 0=success, 1=business error, 2=argument error',
    ].join('\n')
    process.stderr.write(usage + '\n')
    process.exit(2)
  }

  const commands: Record<string, (args: ParsedArgs) => Promise<CommandResult>> = {
    ls: cmdLs,
    read: cmdRead,
    write: cmdWrite,
    mkdir: cmdMkdir,
    rm: cmdRm,
    mv: cmdMv,
    cp: cmdCp,
    stat: cmdStat,
  }

  const handler = commands[args.command]
  if (!handler) {
    const msg = `Unknown command: ${args.command}`
    if (args.json) {
      process.stdout.write(JSON.stringify({ ok: false, error: msg }) + '\n')
    } else {
      process.stderr.write(`Error: ${msg}\n`)
    }
    process.exit(2)
  }

  try {
    const result = await handler(args)
    if (args.json) {
      process.stdout.write(JSON.stringify({ ok: true, data: result.data }) + '\n')
    } else {
      process.stdout.write(result.text + '\n')
    }
    process.exit(0)
  } catch (err) {
    if (err instanceof CliError) {
      if (args.json) {
        process.stdout.write(JSON.stringify({ ok: false, error: err.message }) + '\n')
      } else {
        process.stderr.write(`Error: ${err.message}\n`)
      }
      process.exit(err.code)
    }
    // Unexpected error — last resort
    const msg = err instanceof Error ? err.message : String(err)
    if (args.json) {
      process.stdout.write(JSON.stringify({ ok: false, error: `Unexpected: ${msg}` }) + '\n')
    } else {
      process.stderr.write(`Unexpected error: ${msg}\n`)
    }
    process.exit(1)
  }
}

main().catch((err) => {
  const msg = err instanceof Error ? err.message : String(err)
  process.stderr.write(`Fatal: ${msg}\n`)
  process.exit(1)
})
