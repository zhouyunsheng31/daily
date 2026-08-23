// server/src/webos/engines/skill-engine.ts —— W4 type=skill 包执行引擎
// ----------------------------------------------------------------------------
// 依据：docs/routes/web/03-package-system.md §3（skill 包 = SKILL.md + references，
//       注入 pi skills / 用户级 skills/ 现有机制）。
// 职责：
//   - installSkillPackage：把包内 SKILL.md（manifest.entry 或 contents.skills 指
//     向的路径）复制/符号链接到调用者工作区 skills/<id>/（AI 立即可用，复用
//     2026-08-11 用户级 skills 机制）；
//   - uninstallSkillPackage：卸载时同步清理调用者 skills/<id>/（幂等，绝不删
//     调用者自行维护的其它 skill；只清理本引擎安装标记）；
//   - resolveSkillFiles：解析包内 skill 文件集（entry 优先 + contents.skills
//     列表去重，路径防穿越）。
// 安全：源 = 包属主文件夹（服务端权威）；目标 = 调用者工作区 skills/；安装
// 记录写 .engine-meta.json 标记，卸载只清标记目录。
// ============================================================================

import fs from 'node:fs'
import path from 'node:path'
import { getWorkspaceRoot, getUserSkillsDir } from '../../utils/webosWorkspace.js'

/** skill 引擎安装元数据（写进调用者 skills/<id>/.engine-meta.json，供卸载/切版本清理） */
export interface SkillInstallMeta {
  engine: 'skill-engine'
  packageId: string
  ownerKey: string
  installedAt: number
  /** 已复制到调用者 skills/<id>/ 的源文件相对路径（相对于包文件夹） */
  files: string[]
}

export interface SkillFileRef {
  /** 包内相对路径（防穿越后） */
  rel: string
  /** 包内绝对路径（源） */
  abs: string
}

/**
 * 解析包内 skill 文件集：manifest.entry（默认 SKILL.md）优先 + contents.skills
 * 列表（相对路径，如 skills/ui-guide/SKILL.md），去重、防穿越、只保留文件。
 * 返回空数组 = 包内没有任何可用 skill 文件（调用方自行决定是否报错）。
 */
export function resolveSkillFiles(pkgDir: string, manifest: Record<string, unknown>): SkillFileRef[] {
  const out: SkillFileRef[] = []
  const seen = new Set<string>()
  const push = (rel: string): void => {
    const clean = (rel ?? '').replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '')
    if (!clean || clean.includes('..') || clean.startsWith('..')) return
    if (seen.has(clean)) return
    const abs = path.join(pkgDir, clean)
    if (!abs.startsWith(pkgDir + path.sep) && !abs.startsWith(pkgDir)) return
    try {
      if (fs.existsSync(abs) && fs.statSync(abs).isFile()) {
        seen.add(clean)
        out.push({ rel: clean, abs })
      }
    } catch { /* 不可读的文件跳过 */ }
  }

  // 1) entry（skill 类型默认 SKILL.md）
  const entry = manifest.entry
  if (typeof entry === 'string' && entry) push(entry)
  if (!seen.has('SKILL.md') && (typeof entry !== 'string' || !entry)) push('SKILL.md')

  // 2) contents.skills 列表（可指向 entry 之外的多个 skill）
  const contents = manifest.contents
  if (contents && typeof contents === 'object' && !Array.isArray(contents)) {
    const skills = (contents as Record<string, unknown>).skills
    if (Array.isArray(skills)) {
      for (const s of skills) {
        if (typeof s === 'string' && s) push(s)
      }
    }
  }
  return out
}

/** 目标安装目录：调用者工作区 skills/<id>/（与市场 copySkillToCaller 一致） */
export function skillInstallDir(callerKey: string, packageId: string): string {
  const userSkills = getUserSkillsDir(callerKey)
  const safeId = String(packageId ?? '').replace(/[^\p{L}\p{N}._-]/gu, '_').slice(0, 128)
  return path.join(userSkills, safeId)
}

/** 安装 skill 包：源包文件夹 → 调用者 skills/<id>/（复制模式；记录安装 meta） */
export function installSkillPackage(input: { ownerKey: string; callerKey: string; packageId: string; pkgDir: string; manifest: Record<string, unknown> }): { ok: boolean; note: string; installedFiles: string[] } {
  const { ownerKey, callerKey, packageId, pkgDir, manifest } = input
  const files = resolveSkillFiles(pkgDir, manifest)
  if (files.length === 0) {
    return { ok: false, note: `skill 包「${packageId}」内没有可安装的 SKILL.md（entry 或 contents.skills 指向的文件均缺失）`, installedFiles: [] }
  }
  const destDir = skillInstallDir(callerKey, packageId)
  try {
    fs.mkdirSync(destDir, { recursive: true })
    const copied: string[] = []
    for (const f of files) {
      const dest = path.join(destDir, f.rel)
      fs.mkdirSync(path.dirname(dest), { recursive: true })
      if (fs.existsSync(dest)) fs.rmSync(dest, { force: true })
      fs.copyFileSync(f.abs, dest)
      copied.push(f.rel)
    }
    // 安装标记：供卸载/切版本清理（只清理标记目录，绝不碰调用者其它 skill）
    const meta: SkillInstallMeta = {
      engine: 'skill-engine',
      packageId,
      ownerKey,
      installedAt: Date.now(),
      files: copied,
    }
    fs.writeFileSync(path.join(destDir, '.engine-meta.json'), JSON.stringify(meta, null, 2), 'utf-8')
    const entry = files.find((f) => f.rel === 'SKILL.md') ?? files[0]!
    return {
      ok: true,
      note: `✅ skill 已装入你的 skills/${packageId}/（${entry.rel}，共 ${copied.length} 个文件）`,
      installedFiles: copied,
    }
  } catch (error) {
    return { ok: false, note: `skill 安装失败：${error instanceof Error ? error.message : String(error)}`, installedFiles: [] }
  }
}

/**
 * 卸载 skill 包：清理调用者 skills/<id>/（幂等）。
 * 仅当目录存在且（无 .engine-meta.json 或 meta.packageId === packageId）时删除，
 * 防止误删调用者自行维护的同名 skill。
 */
export function uninstallSkillPackage(input: { callerKey: string; packageId: string }): { ok: boolean; note: string } {
  const { callerKey, packageId } = input
  const destDir = skillInstallDir(callerKey, packageId)
  try {
    if (!fs.existsSync(destDir)) return { ok: true, note: `skills/${packageId} 不存在，无需清理` }
    let canRemove = false
    try {
      const meta = JSON.parse(fs.readFileSync(path.join(destDir, '.engine-meta.json'), 'utf-8')) as Partial<SkillInstallMeta>
      canRemove = meta?.engine === 'skill-engine' && meta.packageId === packageId
    } catch {
      canRemove = false // 无标记 → 是调用者自有 skill，不删
    }
    if (!canRemove) {
      return { ok: false, note: `skills/${packageId} 无本引擎安装标记，拒绝删除（可能是调用者自有 skill）` }
    }
    fs.rmSync(destDir, { recursive: true, force: true })
    return { ok: true, note: `已将 skills/${packageId} 从你的技能目录清除（卸载 skill 包）` }
  } catch (error) {
    return { ok: false, note: `skill 卸载失败：${error instanceof Error ? error.message : String(error)}` }
  }
}

/** 统一入口（供 packages 生命周期挂接）：安装 = installSkillPackage；卸载 = uninstallSkillPackage */
export const skillEngine = {
  install: installSkillPackage,
  uninstall: uninstallSkillPackage,
  resolveFiles: resolveSkillFiles,
  installDir: skillInstallDir,
  /** 单测 / 生命周期用：解析调用者安装目录（不创建） */
  callerDir: (callerKey: string, packageId: string): string => skillInstallDir(callerKey, packageId),
}