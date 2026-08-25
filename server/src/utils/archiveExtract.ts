// server/src/utils/archiveExtract.ts —— 压缩包检视/解压（home 工作区「解压」能力）
// ----------------------------------------------------------------------------
// 目的：让用户可见区（home/）里上传的压缩包可以被安全解压成文件夹。
// 安全约束（与文件上传/工作区配额/路径防穿越一致）：
//   1. 仅允许有限压缩格式：zip / tar / tar.gz(tgz) / gz（rar/7z 无服务端 CLI，明确返回不支持）；
//   2. 解压前检视条目：拒绝含 `..` 穿越、绝对路径、反斜杠、NUL 的压缩包（防解压逃逸）；
//   3. 解压到临时目录 → 统计真实体积 → 复核配额 → 再按类型白名单拷贝进目标目录；
//   4. 解出的每个文件沿用 isAllowedUploadName 白名单（跳过 .exe/.bat/.sh 等脚本）。
// 依赖系统 CLI：unzip、tar（生产服务器均已安装）。
// ============================================================================

import { randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { createGunzip } from 'node:zlib'
import fs from 'node:fs'
import path from 'node:path'

/** execFile 的统一选项（超时 + 大 buffer，与 videoEdit/imageEdit 一致） */
const EXEC_OPTS: { maxBuffer: number; timeout: number } = { maxBuffer: 128 * 1024 * 1024, timeout: 120_000 }

/** 单个压缩包最大条目数（防 zip 炸弹/病态档案撑爆内存） */
export const MAX_ARCHIVE_ENTRIES = 50_000

export type ArchiveKind = 'zip' | 'tar' | 'targz' | 'gz'

/** 由文件名判定压缩包类型；不支持返回 null */
export function archiveKindOf(fileName: string): ArchiveKind | null {
  const lower = String(fileName ?? '').toLowerCase()
  if (lower.endsWith('.zip')) return 'zip'
  if (lower.endsWith('.tar.gz') || lower.endsWith('.tgz')) return 'targz'
  if (lower.endsWith('.tar')) return 'tar'
  if (lower.endsWith('.gz')) return 'gz'
  return null
}

/** 目标目录名：去掉扩展名（upload/my.zip → upload/my；upload/backup.tar.gz → upload/backup） */
export function archiveBaseName(fileName: string): string {
  const base = path.basename(fileName)
  return base
    .replace(/\.tar\.gz$/i, '')
    .replace(/\.tgz$/i, '')
    .replace(/\.(tar|zip|gz)$/i, '')
    .replace(/[.]$/g, '') || 'extracted'
}

function sanitizeEntryNames(names: string[]): void {
  if (names.length > MAX_ARCHIVE_ENTRIES) {
    throw new Error(`压缩包条目过多（${names.length} > ${MAX_ARCHIVE_ENTRIES}），已拒绝解压`)
  }
  for (const name of names) {
    if (
      !name
      || name.includes('\0')
      || name.includes('\\')
      || name.includes('..')
      || name.startsWith('/')
      || /^[a-zA-Z]:/.test(name) // Windows 盘符绝对路径
    ) {
      throw new Error('压缩包内含非法路径（穿越/绝对路径），已拒绝解压')
    }
  }
}

/**
 * 检视压缩包：列出条目并做路径安全校验，同时尽力估算解压后体积（用于配额前置判断）。
 * 返回 { entries, estimatedBytes }；含非法条目时抛错。
 */
export async function inspectArchive(archivePath: string, kind: ArchiveKind): Promise<{ entries: string[]; estimatedBytes: number }> {
  let entries: string[] = []
  let estimatedBytes = 0

  if (kind === 'zip') {
    const { stdout } = await execFileP('unzip', ['-Z1', archivePath])
    entries = stdout.split('\n').map((s) => s.replace(/\r$/, '')).filter(Boolean)
    // 体积估算：解析 `unzip -l` 首列 Length（失败则跳过估算，靠解压后实际体积复核）
    try {
      const { stdout: listing } = await execFileP('unzip', ['-l', archivePath])
      for (const line of listing.split('\n')) {
        const m = /^\s*(\d+)\s+\d{4}-\d{2}-\d{2}\s+/.exec(line)
        if (m) estimatedBytes += parseInt(m[1]!, 10)
      }
    } catch { /* 估算失败不阻断 */ }
  } else if (kind === 'tar' || kind === 'targz') {
    const tv = kind === 'targz' ? ['-tvzf'] : ['-tvf']
    const tf = kind === 'targz' ? ['-tzf'] : ['-tf']
    try {
      const { stdout: listing } = await execFileP('tar', [...tv, archivePath])
      for (const line of listing.split('\n')) {
        if (!line.trim()) continue
        const parts = line.split(/\s+/)
        if (parts.length >= 3 && /^\d+$/.test(parts[2]!)) {
          estimatedBytes += parseInt(parts[2]!, 10)
        }
      }
    } catch { /* 估算失败不阻断 */ }
    const { stdout } = await execFileP('tar', [...tf, archivePath])
    entries = stdout.split('\n').map((s) => s.replace(/\r$/, '')).filter(Boolean)
  } else if (kind === 'gz') {
    // 单文件 gzip：解压得到同名文件（去掉 .gz）
    entries = [path.basename(archivePath).replace(/\.gz$/i, '')]
    try {
      const stat = fs.statSync(archivePath)
      estimatedBytes = stat.size * 4 // gzip 常见 ≤4x，仅估算
    } catch { /* 忽略 */ }
  }

  sanitizeEntryNames(entries)
  return { entries, estimatedBytes }
}

function execFileP(cmd: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, EXEC_OPTS, (error, stdout, stderr) => {
      if (error) reject(error)
      else resolve({ stdout: stdout ?? '', stderr: stderr ?? '' })
    })
  })
}

function realDirSize(dir: string): number {
  let total = 0
  const walk = (d: string): void => {
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(d, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const full = path.join(d, entry.name)
      try {
        if (entry.isDirectory()) walk(full)
        else if (entry.isFile()) total += fs.statSync(full).size
      } catch { /* 忽略单文件错误 */ }
    }
  }
  walk(dir)
  return total
}

export interface ExtractResult {
  /** 成功解出的文件绝对路径（含目标目录前缀） */
  files: string[]
  /** 因类型白名单被跳过的文件名列表 */
  skipped: string[]
  /** 解压后总字节（实写进目标目录的字节） */
  bytesWritten: number
  /** 解压后（临时目录）真实字节总数 */
  extractedBytes: number
}

/**
 * 解压 archivePath 到临时目录并安全拷贝进 targetDir。
 * - 解压到 <targetDir 同级临时目录>，再由调用方经 checkCapacity 复核体积后才入库；
 * - checkCapacity(tmpBytes)：入库前配额复核，超容时抛错（调用方转 413，目标目录保持原样）；
 * - allow(name)：对每个解出文件的 basename 做类型白名单，返回 false 则跳过（记录到 skipped）；
 * - 解压/拷贝中途失败：清理临时目录并抛错，目标目录不产生半成品（拷贝阶段可能残留部分文件，可删）。
 */
export async function extractArchiveTo(
  archivePath: string,
  kind: ArchiveKind,
  targetDir: string,
  allow: (name: string) => boolean,
  tmpDir: string,
  checkCapacity?: (tmpBytes: number) => void,
): Promise<ExtractResult> {
  fs.mkdirSync(targetDir, { recursive: true })
  // 临时解压目录：调用方应传入工作区之外（如 sandbox 的 _uploads/ 区），
  // 避免解压中的文件被算进 workspaceUsedBytes 造成配额双计。
  const tmp = tmpDir
  fs.mkdirSync(tmp, { recursive: true })

  const files: string[] = []
  const skipped: string[] = []
  let bytesWritten = 0
  let extractedBytes = 0

  const cleanup = (): void => {
    try { fs.rmSync(tmp, { recursive: true, force: true }) } catch { /* 忽略 */ }
  }

  try {
    // 1) 解压到临时目录
    if (kind === 'zip') {
      await execFileP('unzip', ['-q', '-o', archivePath, '-d', tmp])
    } else if (kind === 'tar') {
      await execFileP('tar', ['-xf', archivePath, '-C', tmp])
    } else if (kind === 'targz') {
      await execFileP('tar', ['-xzf', archivePath, '-C', tmp])
    } else if (kind === 'gz') {
      const outName = path.basename(archivePath).replace(/\.gz$/i, '')
      const outPath = path.join(tmp, outName)
      fs.mkdirSync(path.dirname(outPath), { recursive: true })
      await gunzipFile(archivePath, outPath)
    } else {
      throw new Error(`不支持的解压格式：${kind}`)
    }

    // 2) 复核真实解压体积（解压后/入库前），超容由调用方抛错中止
    extractedBytes = realDirSize(tmp)
    if (checkCapacity) checkCapacity(extractedBytes)

    // 3) 校验解压内容未逃逸临时目录，并递归拷贝进目标目录 + 类型白名单
    const copyFrom = (srcDir: string, tgtDir: string): void => {
      const entries = fs.readdirSync(srcDir, { withFileTypes: true })
      for (const entry of entries) {
        const src = path.join(srcDir, entry.name)
        const tgt = path.join(tgtDir, entry.name)
        const relToTmp = path.relative(tmp, src)
        if (relToTmp.split(path.sep).includes('..')) {
          throw new Error('解压内容包含越界条目，已中止')
        }
        if (entry.isDirectory()) {
          fs.mkdirSync(tgt, { recursive: true })
          copyFrom(src, tgt)
        } else if (entry.isFile()) {
          if (!allow(entry.name)) {
            skipped.push(entry.name)
            continue
          }
          fs.mkdirSync(path.dirname(tgt), { recursive: true })
          fs.copyFileSync(src, tgt)
          bytesWritten += fs.statSync(tgt).size
          files.push(tgt)
        }
      }
    }
    copyFrom(tmp, targetDir)

    return { files, skipped, bytesWritten, extractedBytes }
  } catch (error) {
    cleanup()
    throw error
  } finally {
    cleanup()
  }
}

function gunzipFile(src: string, dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const rd = fs.createReadStream(src)
    const wr = fs.createWriteStream(dest)
    rd.pipe(createGunzip()).pipe(wr)
    wr.on('finish', resolve)
    wr.on('error', reject)
    rd.on('error', reject)
  })
}
