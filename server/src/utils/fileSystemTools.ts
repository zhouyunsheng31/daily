// ============================================================================
// Phase 3：文件系统工具实现（spec §7）
// 7 个 PI 原生工具在服务端 Node.js 沙箱内运行
// 所有文件操作都经过 pathValidator 验证，bash 命令经过 commandRunner 过滤
// ============================================================================

import { Type } from 'typebox'
import type { ToolDefinition } from '@earendil-works/pi-coding-agent'
import fs from 'node:fs'
import path from 'node:path'
import { validateSandboxPath, getSandboxRoot, runCommand } from '../sandbox/index.js'

// ---------------------------------------------------------------------------
// 常量：大小/数量限制
// ---------------------------------------------------------------------------

const MAX_READ_BYTES = 1_048_576 // 1MB
const MAX_WRITE_BYTES = 1_048_576 // 1MB
const MAX_LIST_ENTRIES = 1000
const MAX_GREP_RESULTS = 200
const MAX_FIND_RESULTS = 1000

// ---------------------------------------------------------------------------
// 辅助函数
// ---------------------------------------------------------------------------

/**
 * glob 模式转正则（简单实现：* → .*, ? → ., 其他转义）
 */
function globToRegex(glob: string): string {
  return glob
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.')
}

/**
 * 构造统一的错误返回
 */
function errorResult(message: string, extra?: Record<string, unknown>) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify({ error: message, ...extra }) }],
    details: {},
  }
}

// ---------------------------------------------------------------------------
// 1. read - 读文件
// ---------------------------------------------------------------------------

const readTool: ToolDefinition = {
  name: 'read',
  label: '读取文件',
  description:
    '在服务端沙箱内读取文件内容（仅限沙箱目录）。支持 offset 和 limit 参数按行读取部分内容。' +
    '返回带行号的文本内容。',
  parameters: Type.Object({
    path: Type.String({ description: '要读取的文件路径（相对于沙箱根目录）' }),
    offset: Type.Optional(Type.Number({ description: '起始行号（从 1 开始，默认 1）' })),
    limit: Type.Optional(Type.Number({ description: '读取行数（默认 2000）' })),
  }),
  execute: async (_toolCallId, params) => {
    const { path: filePath, offset, limit } = params as {
      path: string
      offset?: number
      limit?: number
    }

    const validation = validateSandboxPath(filePath)
    if (!validation.safe) {
      return errorResult('Path validation failed', { message: validation.error })
    }

    try {
      const stat = fs.statSync(validation.absolutePath)
      if (!stat.isFile()) {
        return errorResult('Not a file', { path: filePath })
      }
      if (stat.size > MAX_READ_BYTES) {
        return errorResult('File too large', { size: stat.size, max: MAX_READ_BYTES })
      }

      const content = fs.readFileSync(validation.absolutePath, 'utf-8')
      const lines = content.split('\n')
      const startLine = Math.max(1, offset ?? 1) - 1
      const lineCount = limit ?? 2000
      const endLine = Math.min(lines.length, startLine + lineCount)
      const selectedLines = lines.slice(startLine, endLine)

      // 添加行号前缀（与 PI 原生 read 工具一致）
      const numbered = selectedLines
        .map((line, i) => `${String(startLine + i + 1).padStart(6)}→${line}`)
        .join('\n')

      return {
        content: [{ type: 'text', text: numbered }],
        details: { path: filePath, totalLines: lines.length, shownLines: selectedLines.length },
      }
    } catch (err) {
      return errorResult('Read failed', { message: err instanceof Error ? err.message : String(err) })
    }
  },
}

// ---------------------------------------------------------------------------
// 2. write - 写文件
// ---------------------------------------------------------------------------

const writeTool: ToolDefinition = {
  name: 'write',
  label: '写入文件',
  description:
    '在服务端沙箱内写入文件（仅限沙箱目录，覆盖已存在文件）。' +
    '自动创建父目录。最大写入 1MB。',
  parameters: Type.Object({
    path: Type.String({ description: '要写入的文件路径（相对于沙箱根目录）' }),
    content: Type.String({ description: '要写入的文件内容' }),
  }),
  execute: async (_toolCallId, params) => {
    const { path: filePath, content } = params as { path: string; content: string }

    if (Buffer.byteLength(content, 'utf-8') > MAX_WRITE_BYTES) {
      return errorResult('Content too large', { max: MAX_WRITE_BYTES })
    }

    const validation = validateSandboxPath(filePath)
    if (!validation.safe) {
      return errorResult('Path validation failed', { message: validation.error })
    }

    try {
      // 自动创建父目录
      const dir = path.dirname(validation.absolutePath)
      fs.mkdirSync(dir, { recursive: true })

      fs.writeFileSync(validation.absolutePath, content, 'utf-8')

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            path: filePath,
            bytes: Buffer.byteLength(content, 'utf-8'),
          }),
        }],
        details: {},
      }
    } catch (err) {
      return errorResult('Write failed', { message: err instanceof Error ? err.message : String(err) })
    }
  },
}

// ---------------------------------------------------------------------------
// 3. edit - 编辑文件（字符串替换）
// ---------------------------------------------------------------------------

const editTool: ToolDefinition = {
  name: 'edit',
  label: '编辑文件',
  description:
    '在服务端沙箱内通过字符串替换编辑文件。提供 oldString 和 newString，' +
    '替换文件中的匹配内容。默认仅替换第一个匹配，oldString 多次匹配时报错除非设置 replaceAll=true。',
  parameters: Type.Object({
    path: Type.String({ description: '要编辑的文件路径（相对于沙箱根目录）' }),
    oldString: Type.String({ description: '要替换的字符串（必须唯一匹配，或设置 replaceAll=true）' }),
    newString: Type.String({ description: '替换后的字符串' }),
    replaceAll: Type.Optional(Type.Boolean({
      description: '是否替换所有匹配（默认 false，仅替换第一个）',
    })),
  }),
  execute: async (_toolCallId, params) => {
    const { path: filePath, oldString, newString, replaceAll } = params as {
      path: string
      oldString: string
      newString: string
      replaceAll?: boolean
    }

    const validation = validateSandboxPath(filePath)
    if (!validation.safe) {
      return errorResult('Path validation failed', { message: validation.error })
    }

    try {
      if (!fs.existsSync(validation.absolutePath)) {
        return errorResult('File not found', { path: filePath })
      }

      const content = fs.readFileSync(validation.absolutePath, 'utf-8')

      if (!content.includes(oldString)) {
        return errorResult('oldString not found in file', { path: filePath })
      }

      // 统计匹配次数
      const matchCount = content.split(oldString).length - 1
      if (matchCount > 1 && !replaceAll) {
        return errorResult('oldString matches multiple times', {
          matches: matchCount,
          hint: 'Set replaceAll=true to replace all, or provide a more specific oldString',
        })
      }

      // 执行替换
      const newContent = replaceAll
        ? content.split(oldString).join(newString)
        : content.replace(oldString, newString)

      fs.writeFileSync(validation.absolutePath, newContent, 'utf-8')

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            path: filePath,
            replacements: replaceAll ? matchCount : 1,
          }),
        }],
        details: {},
      }
    } catch (err) {
      return errorResult('Edit failed', { message: err instanceof Error ? err.message : String(err) })
    }
  },
}

// ---------------------------------------------------------------------------
// 4. bash - 执行 shell 命令
// ---------------------------------------------------------------------------

const bashTool: ToolDefinition = {
  name: 'bash',
  label: '执行命令',
  description:
    '在服务端沙箱内执行 shell 命令。命令必须在白名单中（ls/cat/grep/find/echo/mkdir/touch/cp/mv 等），' +
    '禁止 rm/sudo/dd 等危险命令。超时 30 秒，输出限制 1MB。工作目录为沙箱根目录。',
  parameters: Type.Object({
    command: Type.String({ description: '要执行的 shell 命令（支持管道和重定向）' }),
  }),
  execute: async (_toolCallId, params) => {
    const { command } = params as { command: string }
    const sandboxDir = getSandboxRoot()

    if (!sandboxDir) {
      return errorResult('Sandbox not initialized')
    }

    const result = await runCommand(command, sandboxDir)

    return {
      content: [{ type: 'text', text: JSON.stringify(result) }],
      details: { durationMs: result.durationMs },
    }
  },
}

// ---------------------------------------------------------------------------
// 5. grep - 搜索文件内容
// ---------------------------------------------------------------------------

const grepTool: ToolDefinition = {
  name: 'grep',
  label: '搜索文件内容',
  description:
    '在服务端沙箱内搜索文件内容（正则匹配）。递归搜索指定目录，' +
    '返回匹配的行、文件名和行号。最多返回 200 条结果。',
  parameters: Type.Object({
    pattern: Type.String({ description: '正则表达式模式' }),
    path: Type.Optional(Type.String({
      description: '搜索目录（相对于沙箱根目录，默认沙箱根目录）',
    })),
    include: Type.Optional(Type.String({
      description: '文件名过滤 glob 模式（如 *.ts, *.json），默认所有文件',
    })),
  }),
  execute: async (_toolCallId, params) => {
    const { pattern, path: searchPath, include } = params as {
      pattern: string
      path?: string
      include?: string
    }

    const searchDir = searchPath ?? '.'
    const validation = validateSandboxPath(searchDir)
    if (!validation.safe) {
      return errorResult('Path validation failed', { message: validation.error })
    }

    try {
      let regex: RegExp
      try {
        regex = new RegExp(pattern)
      } catch {
        return errorResult('Invalid regex', { pattern })
      }

      const includePattern = include ? new RegExp(globToRegex(include)) : null
      const results: Array<{ file: string; line: number; content: string }> = []

      // 递归搜索
      const walk = (dir: string, relativeBase: string): void => {
        if (results.length >= MAX_GREP_RESULTS) return

        let entries: fs.Dirent[]
        try {
          entries = fs.readdirSync(dir, { withFileTypes: true })
        } catch {
          return // 跳过无法读取的目录
        }

        for (const entry of entries) {
          if (results.length >= MAX_GREP_RESULTS) return

          const fullPath = path.join(dir, entry.name)
          const relativePath = path.join(relativeBase, entry.name)

          if (entry.isDirectory()) {
            // 跳过常见无关目录
            if (entry.name === 'node_modules' || entry.name === '.git') continue
            walk(fullPath, relativePath)
          } else if (entry.isFile()) {
            if (includePattern && !includePattern.test(entry.name)) continue

            try {
              const stat = fs.statSync(fullPath)
              if (stat.size > MAX_READ_BYTES) continue // 跳过大文件
              const content = fs.readFileSync(fullPath, 'utf-8')
              const lines = content.split('\n')
              for (let i = 0; i < lines.length; i++) {
                if (results.length >= MAX_GREP_RESULTS) break
                if (regex.test(lines[i])) {
                  results.push({ file: relativePath, line: i + 1, content: lines[i] })
                }
              }
            } catch {
              // 跳过无法读取的文件（如二进制文件）
            }
          }
        }
      }

      walk(validation.absolutePath, searchDir)

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            results,
            count: results.length,
            truncated: results.length >= MAX_GREP_RESULTS,
          }),
        }],
        details: {},
      }
    } catch (err) {
      return errorResult('Grep failed', { message: err instanceof Error ? err.message : String(err) })
    }
  },
}

// ---------------------------------------------------------------------------
// 6. find - 查找文件
// ---------------------------------------------------------------------------

const findTool: ToolDefinition = {
  name: 'find',
  label: '查找文件',
  description:
    '在服务端沙箱内查找文件（按名称 glob 模式匹配）。递归搜索指定目录，' +
    '返回匹配的文件路径列表。最多返回 1000 条结果。',
  parameters: Type.Object({
    name: Type.Optional(Type.String({
      description: '文件名 glob 模式（如 *.ts, *.json, test.*），默认所有文件',
    })),
    path: Type.Optional(Type.String({
      description: '搜索目录（相对于沙箱根目录，默认沙箱根目录）',
    })),
  }),
  execute: async (_toolCallId, params) => {
    const { name, path: searchPath } = params as {
      name?: string
      path?: string
    }

    const searchDir = searchPath ?? '.'
    const validation = validateSandboxPath(searchDir)
    if (!validation.safe) {
      return errorResult('Path validation failed', { message: validation.error })
    }

    try {
      const namePattern = name ? new RegExp(globToRegex(name)) : null
      const results: string[] = []

      const walk = (dir: string, relativeBase: string): void => {
        if (results.length >= MAX_FIND_RESULTS) return

        let entries: fs.Dirent[]
        try {
          entries = fs.readdirSync(dir, { withFileTypes: true })
        } catch {
          return
        }

        for (const entry of entries) {
          if (results.length >= MAX_FIND_RESULTS) return

          // 跳过常见无关目录
          if (entry.name === 'node_modules' || entry.name === '.git') continue

          const fullPath = path.join(dir, entry.name)
          const relativePath = path.join(relativeBase, entry.name)

          if (!namePattern || namePattern.test(entry.name)) {
            results.push(relativePath)
          }

          if (entry.isDirectory()) {
            walk(fullPath, relativePath)
          }
        }
      }

      walk(validation.absolutePath, searchDir)

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            results,
            count: results.length,
            truncated: results.length >= MAX_FIND_RESULTS,
          }),
        }],
        details: {},
      }
    } catch (err) {
      return errorResult('Find failed', { message: err instanceof Error ? err.message : String(err) })
    }
  },
}

// ---------------------------------------------------------------------------
// 7. ls - 列出目录
// ---------------------------------------------------------------------------

const lsTool: ToolDefinition = {
  name: 'ls',
  label: '列出目录',
  description:
    '在服务端沙箱内列出目录内容，返回文件/目录名、类型和大小。' +
    '最多返回 1000 条结果。',
  parameters: Type.Object({
    path: Type.Optional(Type.String({
      description: '要列出的目录（相对于沙箱根目录，默认沙箱根目录）',
    })),
  }),
  execute: async (_toolCallId, params) => {
    const { path: dirPath } = params as { path?: string }

    const targetDir = dirPath ?? '.'
    const validation = validateSandboxPath(targetDir)
    if (!validation.safe) {
      return errorResult('Path validation failed', { message: validation.error })
    }

    try {
      const stat = fs.statSync(validation.absolutePath)
      if (!stat.isDirectory()) {
        return errorResult('Not a directory', { path: targetDir })
      }

      const entries = fs.readdirSync(validation.absolutePath, { withFileTypes: true })
      const truncated = entries.length > MAX_LIST_ENTRIES
      const items = entries.slice(0, MAX_LIST_ENTRIES).map((entry) => {
        const item: { name: string; type: string; size?: number } = {
          name: entry.name,
          type: entry.isDirectory() ? 'directory' : 'file',
        }
        if (entry.isFile()) {
          try {
            item.size = fs.statSync(path.join(validation.absolutePath, entry.name)).size
          } catch {
            // 忽略 stat 失败
          }
        }
        return item
      })

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            path: targetDir,
            entries: items,
            count: entries.length,
            truncated,
          }),
        }],
        details: {},
      }
    } catch (err) {
      return errorResult('Ls failed', { message: err instanceof Error ? err.message : String(err) })
    }
  },
}

// ---------------------------------------------------------------------------
// 导出
// ---------------------------------------------------------------------------

/**
 * Phase 3：7 个文件系统工具定义（spec §7）
 * PI 原生工具，在服务端 Node.js 沙箱内运行
 */
export const fileSystemTools: ToolDefinition[] = [
  readTool,
  writeTool,
  editTool,
  bashTool,
  grepTool,
  findTool,
  lsTool,
]
