// server/test/unit/engines.test.ts —— W4 包执行引擎守卫
// ----------------------------------------------------------------------------
// 验收（docs/routes/web/03-package-system.md §3 执行引擎表 + 06-billing.md §3.5 R15）：
//   - skill 引擎：安装复制 SKILL.md → 调用者 skills/<id>/ 出现；卸载清理（带标记）；
//   - theme 引擎：合法 tokens 生成 CSS 变量清单；缺必填 key 回退默认（不抛阻断）；
//   - bundle 引擎：children 嵌套 ≤3 BFS 解析闭包（skills/tools/tokens/assets 聚合）；
//     >3 层拒绝（issue 截断，可 isBundleDepthValid 判 False）；
//   - pet-layer 引擎：读 entry HTML + 行为参数 + assets → 返回场景；
//     entry 缺失回退 PET_LAYER_DEFAULT 不抛阻断；
//   - 计费（R15）：chargeCaller 从调用者扣积分成功；余额不足抛 INSUFFICIENT_CREDITS
//     且账本不变；包属主账号绝不被扣（注入属主 state 校验不变）。
// 运行：npx vitest run test/unit/engines.test.ts
// ============================================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createTestDb } from '../helpers/db.js'
import { getSandboxRoot } from '../../src/sandbox/index.js'
import { setSandboxRoot } from '../../src/sandbox/pathValidator.js'
import { ensurePackageSchema } from '../../src/webos/packages/packages-db.js'
import {
  syncPackageFromFs,
  syncAllPackagesFromWorkspace,
  recyclePackage,
} from '../../src/webos/packages/packages-service.js'
import { setAppViewProvider } from '../../src/webos/packages/index.js'

import {
  installSkillPackage,
  uninstallSkillPackage,
  resolveSkillFiles,
} from '../../src/webos/engines/skill-engine.js'
import {
  applyThemeTokens,
  resolveThemeTokens,
  DEFAULT_TOKENS,
} from '../../src/webos/engines/theme-engine.js'
import {
  resolveBundleClosure,
  isBundleDepthValid,
  BUNDLE_MAX_DEPTH,
} from '../../src/webos/engines/bundle-engine.js'
import {
  loadPetLayerScene,
  PET_LAYER_DEFAULT,
} from '../../src/webos/engines/pet-layer-engine.js'
import {
  chargeCaller,
  callerRemaining,
  chargeCallerCredits,
  InsufficientCreditsError,
  BILLING_CATALOG,
  SYSTEM_CAPABILITY_PACKAGES,
  type CallerCreditsState,
} from '../../src/webos/systemCapabilities.js'

const USER_KEY = 'user:test-engines'
const OTHER_KEY = 'user:test-owner'
let sandboxDir = ''
let cleanup: () => Promise<void> = async () => {}
let oldRoot = ''

beforeEach(async () => {
  const db = await createTestDb()
  cleanup = db.cleanup
  await ensurePackageSchema()
  sandboxDir = fs.mkdtempSync(path.join(os.tmpdir(), 'daily-eng-'))
  oldRoot = getSandboxRoot()
  setSandboxRoot(sandboxDir)
  setAppViewProvider(async () => [])
})

afterEach(async () => {
  setAppViewProvider(async () => [])
  setSandboxRoot(oldRoot)
  try { fs.rmSync(sandboxDir, { recursive: true, force: true }) } catch { /* 忽略 */ }
  await cleanup()
})

function wsRoot(key = USER_KEY): string {
  return path.join(getSandboxRoot(), 'webos', key.replace(/[^a-zA-Z0-9_.:-]/g, '_').slice(0, 96))
}

function writePkgFile(key: string, pkgId: string, rel: string, content: string): string {
  const full = path.join(wsRoot(key), 'packages', pkgId, rel)
  fs.mkdirSync(path.dirname(full), { recursive: true })
  fs.writeFileSync(full, content, 'utf-8')
  return full
}

function readJson(file: string): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(file, 'utf-8')) as Record<string, unknown>
}

// ---------------------------------------------------------------------------
// skill 引擎
// ---------------------------------------------------------------------------

describe('W4 skill 引擎', () => {
  const PKG = 'com.daily.eng-skill'

  function skillManifest(extra: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      schema_version: 2,
      id: PKG,
      type: 'skill',
      version: '1.0.0',
      entry: 'SKILL.md',
      ...extra,
    }
  }

  it('resolveSkillFiles：entry 优先 + contents.skills 去重', () => {
    const dir = path.join(sandboxDir, 'pkg-src')
    fs.mkdirSync(path.join(dir, 'skills', 'guide'), { recursive: true })
    fs.writeFileSync(path.join(dir, 'SKILL.md'), '# Main', 'utf-8')
    fs.writeFileSync(path.join(dir, 'skills/guide/SKILL.md'), '# Guide', 'utf-8')
    const files = resolveSkillFiles(dir, skillManifest({ contents: { skills: ['skills/guide/SKILL.md', 'skills/guide/SKILL.md', '../evil.md'] } }))
    expect(files.map((f) => f.rel)).toEqual(['SKILL.md', 'skills/guide/SKILL.md'])
  })

  it('安装：复制 SKILL.md 到调用者 skills/<id>/，并写 .engine-meta.json 标记', () => {
    const pkgDir = path.join(wsRoot(OTHER_KEY), 'packages', PKG)
    fs.mkdirSync(path.join(pkgDir, 'skills', 'guide'), { recursive: true })
    fs.writeFileSync(path.join(pkgDir, 'SKILL.md'), '# 测试技能\n\n我会做测试。', 'utf-8')
    fs.writeFileSync(path.join(pkgDir, 'skills/guide/SKILL.md'), '# Guide Skill', 'utf-8')

    const r = installSkillPackage({ ownerKey: OTHER_KEY, callerKey: USER_KEY, packageId: PKG, pkgDir, manifest: skillManifest({ contents: { skills: ['skills/guide/SKILL.md'] } }) })
    expect(r.ok).toBe(true)
    const dest = path.join(wsRoot(USER_KEY), 'skills', PKG)
    expect(fs.existsSync(path.join(dest, 'SKILL.md'))).toBe(true)
    expect(fs.readFileSync(path.join(dest, 'SKILL.md'), 'utf-8')).toContain('测试技能')
    expect(fs.existsSync(path.join(dest, 'skills', 'guide', 'SKILL.md'))).toBe(true)
    const meta = readJson(path.join(dest, '.engine-meta.json'))
    expect(meta.engine).toBe('skill-engine')
    expect(meta.packageId).toBe(PKG)
  })

  it('卸载：清理调用者 skills/<id>/（带引擎标记）', () => {
    const pkgDir = path.join(wsRoot(OTHER_KEY), 'packages', PKG)
    fs.mkdirSync(pkgDir, { recursive: true })
    fs.writeFileSync(path.join(pkgDir, 'SKILL.md'), '# x', 'utf-8')
    installSkillPackage({ ownerKey: OTHER_KEY, callerKey: USER_KEY, packageId: PKG, pkgDir, manifest: skillManifest() })

    const r = uninstallSkillPackage({ callerKey: USER_KEY, packageId: PKG })
    expect(r.ok).toBe(true)
    expect(fs.existsSync(path.join(wsRoot(USER_KEY), 'skills', PKG))).toBe(false)
  })

  it('卸载：无引擎标记的调用者自有 skill 不删除（防误删）', () => {
    const dest = path.join(wsRoot(USER_KEY), 'skills', 'myself')
    fs.mkdirSync(dest, { recursive: true })
    fs.writeFileSync(path.join(dest, 'SKILL.md'), '用户自有技能', 'utf-8')
    const r = uninstallSkillPackage({ callerKey: USER_KEY, packageId: 'myself' })
    expect(r.ok).toBe(false)
    expect(fs.existsSync(path.join(dest, 'SKILL.md'))).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// theme 引擎
// ---------------------------------------------------------------------------

describe('W4 theme 引擎', () => {
  it('合法 tokens → 生成 :root CSS 变量清单（自动补 -- 前缀）', () => {
    const r = applyThemeTokens({ paper: '#ffffff', ink: '#111111', accent: '#315bd6', radius: '20px' })
    expect(r.missing).toEqual([])
    expect(r.cssVars).toContain('--paper: #ffffff;')
    expect(r.cssVars).toContain('--accent: #315bd6;')
    expect(r.cssVars.startsWith(':root {')).toBe(true)
  })

  it('缺必填 key → 回退 DEFAULT_TOKENS，不抛阻断', () => {
    const r = applyThemeTokens({ paper: '#ffffff' })
    expect(r.missing).toContain('--ink')
    expect(r.missing).toContain('--accent')
    expect(r.tokens['--ink']).toBe(DEFAULT_TOKENS['--ink'])
    expect(r.tokens['--accent']).toBe(DEFAULT_TOKENS['--accent'])
    expect(r.tokens['--paper']).toBe('#ffffff')
  })

  it('防注入：非法 key（含分号/CSS 语法）/ 恶意值被剔除', () => {
    const r = applyThemeTokens({ 'paper; color: red} body{': '#fff', '--ok': 'hello', '--evil': 'red;} body{background:url(javascript:x)' })
    expect(r.tokens['--ok']).toBe('hello')
    expect(Object.keys(r.tokens).some((k) => k.includes(';'))).toBe(false)
    // 分号 key 与恶意值都在归一化/过滤中被剔除（不在 tokens 里，也不进 ignored 列表）
    expect(r.tokens['--evil']).toBeUndefined()
    expect(Object.values(r.tokens).some((v) => v.includes('{') || v.includes(';'))).toBe(false)
  })

  it('resolveThemeTokens 从 manifest.contents.tokens 读取', () => {
    const tokens = resolveThemeTokens({ contents: { tokens: { primary: '#4F8CFF' } } })
    expect(tokens['--primary']).toBe('#4F8CFF')
  })
})

// ---------------------------------------------------------------------------
// bundle 引擎
// ---------------------------------------------------------------------------

describe('W4 bundle 引擎', () => {
  function bundleManifest(id: string, children: string[], contents: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      schema_version: 2,
      id,
      type: 'bundle',
      version: '1.0.0',
      children,
      contents: { skills: [], tools: [], tokens: {}, assets: [], ...contents },
    }
  }

  it('children 嵌套 ≤3 BFS 解析闭包 + contents 聚合', () => {
    // tree: A(bundle root) → children [B, C]；B → [D]
    const dirs = new Map<string, string>()
    const mkdir = (id: string): string => {
      const d = path.join(sandboxDir, 'bundles', id)
      fs.mkdirSync(d, { recursive: true })
      fs.writeFileSync(path.join(d, 'daily.pkg.json'), JSON.stringify(bundleManifest(id, [])), 'utf-8')
      dirs.set(id, d)
      return d
    }
    mkdir('C')
    mkdir('D')
    const bDir = mkdir('B')
    fs.writeFileSync(path.join(bDir, 'daily.pkg.json'), JSON.stringify(bundleManifest('B', ['D'], { skills: ['skills/b/SKILL.md'], tools: ['tools/b.js'], tokens: { b: '1' } })), 'utf-8')
    const aDir = mkdir('A')
    fs.writeFileSync(path.join(aDir, 'daily.pkg.json'), JSON.stringify(bundleManifest('A', ['B', 'C'], { skills: [], tools: ['tools/a.js'], assets: ['assets/a.png'], tokens: { a: '#fff' } })), 'utf-8')

    const resolver = { pkgDirOf: (id: string) => dirs.get(id) ?? null }
    const r = resolveBundleClosure('A', resolver)
    expect(r.ok).toBe(true)
    const ids = r.items.map((i) => i.packageId)
    expect(ids[0]).toBe('A')
    expect(ids).toContain('B')
    expect(ids).toContain('C')
    expect(ids).toContain('D')
    const d = r.items.find((i) => i.packageId === 'D')!
    expect(d.depth).toBe(2)
    // 聚合：A(0 层) + B(1) + C(1) + D(2)
    expect(r.aggregate.skills).toEqual(['skills/b/SKILL.md'])
    expect(r.aggregate.tools).toEqual(['tools/a.js', 'tools/b.js'])
    expect(r.aggregate.assets).toEqual(['assets/a.png'])
    expect(r.aggregate.tokens['--a'] ?? r.aggregate.tokens.a).toBe('#fff')
  })

  it('环（A→B→A）去环不无限循环；深度 >3 拒绝并出 issue', () => {
    const dirs = new Map<string, string>()
    const mkdir = (id: string, children: string[]): void => {
      const d = path.join(sandboxDir, 'bundles', id)
      fs.mkdirSync(d, { recursive: true })
      fs.writeFileSync(path.join(d, 'daily.pkg.json'), JSON.stringify(bundleManifest(id, children)), 'utf-8')
      dirs.set(id, d)
    }
    mkdir('A', ['B'])
    mkdir('B', ['A']) // 环
    mkdir('C1', [])
    mkdir('C2', ['C1'])
    const r = resolveBundleClosure('A', { pkgDirOf: (id) => dirs.get(id) ?? null })
    expect(r.items.length).toBe(2) // A, B；A 被 visited 去环
    expect(r.issues.length).toBe(0)

    // 深度 >3：root + C1(1) + C2(2) + C3(3) + C4(4) → C4 触发 depth 守卫
    mkdir('C3', ['C4'])
    mkdir('C4', [])
    const deep = resolveBundleClosure('C1', { pkgDirOf: (id) => dirs.get(id) ?? null })
    expect(BUNDLE_MAX_DEPTH).toBe(3)
    expect(isBundleDepthValid(['x'], 3)).toBe(false) // 第 3 层挂 children → 拒绝
    expect(isBundleDepthValid(['x'], 1)).toBe(true)
  })

  it('深度 >3 的链闭包解析时截断并出 issue（不抛阻断）', () => {
    const dirs = new Map<string, string>()
    const mkdir = (id: string, children: string[]): void => {
      const d = path.join(sandboxDir, 'bundles', id)
      fs.mkdirSync(d, { recursive: true })
      fs.writeFileSync(path.join(d, 'daily.pkg.json'), JSON.stringify(bundleManifest(id, children)), 'utf-8')
      dirs.set(id, d)
    }
    // chain: L1 → L2 → L3 → L4（children 深度 3 层）
    mkdir('L1', ['L2'])
    mkdir('L2', ['L3'])
    mkdir('L3', ['L4'])
    mkdir('L4', [])
    const r = resolveBundleClosure('L1', { pkgDirOf: (id) => dirs.get(id) ?? null })
    expect(r.issues.length).toBeGreaterThan(0)
    expect(r.items.some((i) => i.packageId === 'L4')).toBe(false) // L3 children 被截断
  })
})

// ---------------------------------------------------------------------------
// pet-layer 引擎
// ---------------------------------------------------------------------------

describe('W4 pet-layer 引擎', () => {
  it('读 entry HTML + 行为参数 + assets → 返回场景', () => {
    const pkgDir = path.join(wsRoot(USER_KEY), 'packages', 'com.daily.pet1')
    fs.mkdirSync(pkgDir, { recursive: true })
    fs.writeFileSync(path.join(pkgDir, 'index.html'), '<section class="pet">🐱</section>', 'utf-8')
    const scene = loadPetLayerScene({
      packageId: 'com.daily.pet1',
      pkgDir,
      manifest: {
        entry: 'index.html',
        pets: { maxInstances: 2, physics: 'bounce' },
        contents: { assets: ['assets/cat.png', '../evil.png'] },
      },
    })
    expect(scene.ok).toBe(true)
    expect(scene.html).toContain('🐱')
    expect(scene.behavior.maxInstances).toBe(2)
    expect(scene.behavior.physics).toBe('bounce')
    expect(scene.assets).toEqual(['assets/cat.png']) // 防穿越剔除
  })

  it('entry 缺失 → 回退 PET_LAYER_DEFAULT，不抛阻断', () => {
    const pkgDir = path.join(wsRoot(USER_KEY), 'packages', 'com.daily.pet2')
    fs.mkdirSync(pkgDir, { recursive: true })
    const scene = loadPetLayerScene({ packageId: 'com.daily.pet2', pkgDir, manifest: {} })
    expect(scene.ok).toBe(false)
    expect(scene.note).toContain('默认场景')
    expect(scene.html).toBe(PET_LAYER_DEFAULT.html)
  })
})

// ---------------------------------------------------------------------------
// 计费（R15：调用者计费租户）
// ---------------------------------------------------------------------------

describe('W4 计费（R15 调用者计费租户）', () => {
  it('chargeCaller 从调用者扣积分成功', async () => {
    const caller: CallerCreditsState = { credits: { quota: 100, used: 0 } }
    const owner: CallerCreditsState = { credits: { quota: 1000, used: 0 } }
    const loads = new Map<string, CallerCreditsState>([
      ['user:caller', caller],
      ['user:owner', owner], // 属主账本（不应被扣）
    ])
    const charged = await chargeCaller('user:caller', 'search', 8, {
      loadState: async (k) => loads.get(k) ?? null,
      saveState: async (k, s) => { loads.set(k, s) },
    })
    expect(charged).toBe(8)
    expect(callerRemaining(loads.get('user:caller')!)).toBe(92)
    expect(callerRemaining(loads.get('user:owner')!)).toBe(1000) // 属主分文未动
  })

  it('余额不足 → 抛 INSUFFICIENT_CREDITS，且账本不变（不扣）', async () => {
    const caller: CallerCreditsState = { credits: { quota: 5, used: 0 } }
    const loads = new Map<string, CallerCreditsState>([['user:caller', caller]])
    await expect(chargeCaller('user:caller', 'image', 8, {
      loadState: async (k) => loads.get(k) ?? null,
      saveState: async (k, s) => { loads.set(k, s) },
    })).rejects.toThrow(InsufficientCreditsError)
    expect(callerRemaining(caller)).toBe(5) // 原封不动
  })

  it('chargeCallerCredits：先常规额度再永久池（与 webos.ts chargeCredits 语义一致）', () => {
    const state: CallerCreditsState = { credits: { quota: 10, used: 9, permanent: { quota: 50, used: 0 } } }
    const charged = chargeCallerCredits(state, 5)
    expect(charged).toBe(5)
    expect(state.credits!.used).toBe(10) // 常规额度 1
    expect(state.credits!.permanent!.used).toBe(4) // 永久池 4
  })

  it('计费目录与系统能力包声明齐备（生图/搜索/对话统一目录）', () => {
    const kinds = BILLING_CAPACITY_KINDS()
    for (const kind of ['image', 'search', 'chat', 'video', 'api']) expect(kinds).toContain(kind)
    const caps = SYSTEM_CAPABILITY_PACKAGES.map((c) => c.id)
    expect(caps).toContain('com.daily.cap.image')
    expect(caps).toContain('com.daily.cap.search')
    expect(caps).toContain('com.daily.cap.chat')
    // secrets 声明只读名字，不携带值（防泄漏契约）
    for (const cap of SYSTEM_CAPABILITY_PACKAGES) {
      expect(cap.secrets.length).toBeGreaterThan(0)
      expect(cap.secrets.every((s) => !s.includes('=') && !process.env[s]?.includes(s))).toBe(true)
    }
  })

  function BILLING_CAPACITY_KINDS(): string[] {
    return BILLING_CATALOG.map((c) => c.kind)
  }
})

// ---------------------------------------------------------------------------
// 引擎接入 packages 生命周期（端到端：注册 skill 包 → skills/ 出现；回收 → 清理）
// ---------------------------------------------------------------------------

describe('W4 引擎接入 packages 生命周期', () => {
  it('注册 skill 包后调用者 skills/<id>/ 出现 SKILL.md；回收后清理', async () => {
    const pkgId = 'com.daily.lifecycle-skill'
    const manifest = JSON.stringify({
      schema_version: 2,
      id: pkgId,
      type: 'skill',
      version: '1.0.0',
      entry: 'SKILL.md',
    })
    const mf = writePkgFile(USER_KEY, pkgId, 'daily.pkg.json', manifest)
    writePkgFile(USER_KEY, pkgId, 'SKILL.md', '# 生命周期技能\n\n内容。')
    const feedback = (await syncPackageFromFs(USER_KEY, mf)) as string
    expect(feedback).toContain('已注册')
    expect(fs.existsSync(path.join(wsRoot(USER_KEY), 'skills', pkgId, 'SKILL.md'))).toBe(true)

    const r = await recyclePackage(USER_KEY, pkgId)
    expect(r.ok).toBe(true)
    expect(fs.existsSync(path.join(wsRoot(USER_KEY), 'skills', pkgId))).toBe(false)
  })

  it('注册 theme 包后 system/engines/theme/<id>/ 生成 tokens.json + theme.css', async () => {
    const pkgId = 'com.daily.lifecycle-theme'
    const manifest = JSON.stringify({
      schema_version: 2,
      id: pkgId,
      type: 'theme',
      version: '1.0.0',
      contents: { tokens: { primary: '#4F8CFF', paper: '#f8f7f3' } },
    })
    const mf = writePkgFile(USER_KEY, pkgId, 'daily.pkg.json', manifest)
    const feedback = (await syncPackageFromFs(USER_KEY, mf)) as string
    expect(feedback).toContain('已注册')
    const dir = path.join(wsRoot(USER_KEY), 'system', 'engines', 'theme', pkgId)
    expect(fs.existsSync(path.join(dir, 'tokens.json'))).toBe(true)
    expect(fs.existsSync(path.join(dir, 'theme.css'))).toBe(true)
    const css = fs.readFileSync(path.join(dir, 'theme.css'), 'utf-8')
    expect(css).toContain('--primary: #4F8CFF;')
  })

  it('注册 bundle 包后 system/engines/bundle/<id>/ 生成 closure.json + aggregate.json', async () => {
    const pkgId = 'com.daily.lifecycle-bundle'
    const childId = 'com.daily.lifecycle-child'
    writePkgFile(USER_KEY, childId, 'daily.pkg.json', JSON.stringify({
      schema_version: 2,
      id: childId,
      type: 'theme',
      version: '1.0.0',
      contents: { tokens: { accent: '#ff0000' } },
    }))
    const manifest = JSON.stringify({
      schema_version: 2,
      id: pkgId,
      type: 'bundle',
      version: '1.0.0',
      children: [childId],
      contents: { skills: [], tools: [], tokens: {}, assets: [] },
    })
    const mf = writePkgFile(USER_KEY, pkgId, 'daily.pkg.json', manifest)
    const feedback = (await syncPackageFromFs(USER_KEY, mf)) as string
    expect(feedback).toContain('已注册')
    const dir = path.join(wsRoot(USER_KEY), 'system', 'engines', 'bundle', pkgId)
    expect(fs.existsSync(path.join(dir, 'closure.json'))).toBe(true)
    expect(fs.existsSync(path.join(dir, 'aggregate.json'))).toBe(true)
    const agg = readJson(path.join(dir, 'aggregate.json'))
    expect(agg.tokens).toBeDefined()
  })

  it('注册 pet-layer 包后 system/engines/pet-layer/<id>/ 生成 scene.json', async () => {
    const pkgId = 'com.daily.lifecycle-pet'
    const manifest = JSON.stringify({
      schema_version: 2,
      id: pkgId,
      type: 'pet-layer',
      version: '1.0.0',
      entry: 'index.html',
      pets: { maxInstances: 1 },
    })
    writePkgFile(USER_KEY, pkgId, 'index.html', '<section class="pet">🐶</section>')
    const mf = writePkgFile(USER_KEY, pkgId, 'daily.pkg.json', manifest)
    const feedback = (await syncPackageFromFs(USER_KEY, mf)) as string
    expect(feedback).toContain('已注册')
    const sceneFile = path.join(wsRoot(USER_KEY), 'system', 'engines', 'pet-layer', pkgId, 'scene.json')
    expect(fs.existsSync(sceneFile)).toBe(true)
    const scene = readJson(sceneFile)
    expect(scene.html).toContain('🐶')
  })
})