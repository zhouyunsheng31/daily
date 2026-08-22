// server/test/unit/packages.test.ts —— W1 包体系守卫
// ----------------------------------------------------------------------------
// 验收（docs/routes/web/03-package-system.md §4/§5 + 09-roadmap W1）：
//   - 文件夹即包：AI 在 packages/<id>/ 写 daily.pkg.json → 校验通过自动注册 + 版本 v1
//   - 校验反馈回路：写错包（缺入口/非法能力词/type=app 错位）→ 人话错误回流且不建版本，
//     AI 修正后注册成功（3 次内闭环语义验证）
//   - 版本不可变 + 幂等（重复写同内容不产生垃圾版本）+ 自动小版本号 +1
//   - 生命周期：原子切指针 / 回滚 / 回收站（DELETE→restore）
//   - 契约守卫：包 id、dashboard 完全走 W0 daily-pkg.schema.json（45 守卫在 contracts.test）
// 运行：npm test -- --run test/unit/packages.test.ts
// ============================================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createTestDb } from '../helpers/db.js'
import { getSandboxRoot } from '../../src/sandbox/index.js'
import { setSandboxRoot } from '../../src/sandbox/pathValidator.js'
import { ensurePackageSchema } from '../../src/webos/packages/packages-db.js'
import { getPackage, listPackages, listVersions, getInstall } from '../../src/webos/packages/packages-db.js'
import {
  syncPackageFromFs,
  syncAllPackagesFromWorkspace,
  matchPackageFolder,
  nextPackageVersion,
  listForUser,
  getDetailForUser,
  setActiveVersion,
  rollbackTo,
  recyclePackage,
  restorePackage,
  createFromPaste,
  type PackageListItem,
} from '../../src/webos/packages/packages-service.js'
import { setAppViewProvider } from '../../src/webos/packages/index.js'

const USER_KEY = 'user:test-packages'
let sandboxDir = ''
let cleanup: () => Promise<void> = async () => {}
let oldRoot = ''

beforeEach(async () => {
  const db = await createTestDb()
  cleanup = db.cleanup
  await ensurePackageSchema()
  // 临时沙箱根（工作区根 = <sandbox>/webos/<key>/）
  sandboxDir = fs.mkdtempSync(path.join(os.tmpdir(), 'daily-pkg-'))
  oldRoot = getSandboxRoot()
  setSandboxRoot(sandboxDir)
  // 单测默认注入空 app 视图（listForUser 无 type 过滤时会取它）
  setAppViewProvider(async () => [])
})

afterEach(async () => {
  setAppViewProvider(async () => [])
  setSandboxRoot(oldRoot)
  try { fs.rmSync(sandboxDir, { recursive: true, force: true }) } catch { /* 忽略 */ }
  await cleanup()
})

function wsRoot(): string {
  return path.join(getSandboxRoot(), 'webos', USER_KEY)
}

/** 写一个包文件（相对 packages/<id>/）并返回其全路径 */
function writePkgFile(pkgId: string, rel: string, content: string): string {
  const full = path.join(wsRoot(), 'packages', pkgId, rel)
  fs.mkdirSync(path.dirname(full), { recursive: true })
  fs.writeFileSync(full, content, 'utf-8')
  return full
}

const themeManifest = (version = '1.0.0', id = 'com.daily.test-theme', extra: Record<string, unknown> = {}): string =>
  JSON.stringify({
    schema_version: 2,
    id,
    type: 'theme',
    version,
    display_name: { zh: '测试主题' },
    contents: { tokens: { primary: '#4F8CFF' } },
    ...extra,
  })

describe('W1：文件夹即包 —— 注册 + 版本 + 幂等', () => {
  it('theme 包（无入口类型）：写 manifest 即注册，版本 v1.0.0 + 自动安装', async () => {
    const full = writePkgFile('com.daily.test-theme', 'daily.pkg.json', themeManifest())
    const feedback = (await syncPackageFromFs(USER_KEY, full)) as string
    expect(feedback).toContain('已注册')
    expect(feedback).toContain('v1.0.0')

    const pkg = await getPackage('com.daily.test-theme')
    expect(pkg).not.toBeNull()
    expect(pkg!.type).toBe('theme')
    expect(pkg!.ownerKey).toBe(USER_KEY)
    const versions = await listVersions('com.daily.test-theme')
    expect(versions.length).toBe(1)
    expect(versions[0]!.version).toBe('1.0.0')
    expect(versions[0]!.status).toBe('active')
    const install = await getInstall('com.daily.test-theme', USER_KEY)
    expect(install?.installed).toBe(true)
  })

  it('幂等：重复写同内容 manifest 不产生新版本', async () => {
    const full = writePkgFile('com.daily.test-theme', 'daily.pkg.json', themeManifest())
    await syncPackageFromFs(USER_KEY, full)
    const feedback = (await syncPackageFromFs(USER_KEY, full)) as string
    expect(feedback).toContain('无内容变化')
    expect((await listVersions('com.daily.test-theme')).length).toBe(1)
  })

  it('改版本号 → 发布新不可变版本（旧版 ready、新版本版 active 且 parent 溯源）', async () => {
    const full = writePkgFile('com.daily.test-theme', 'daily.pkg.json', themeManifest('1.0.0'))
    await syncPackageFromFs(USER_KEY, full)
    fs.writeFileSync(full, themeManifest('1.1.0'))
    const feedback = (await syncPackageFromFs(USER_KEY, full)) as string
    expect(feedback).toContain('v1.1.0')

    const versions = await listVersions('com.daily.test-theme')
    expect(versions.length).toBe(2)
    const v1 = versions[0]!
    const v2 = versions[1]!
    expect(v1.version).toBe('1.0.0')
    expect(v1.status).toBe('ready')
    expect(v2.version).toBe('1.1.0')
    expect(v2.status).toBe('active')
    expect(v2.parentVersionId).toBe(v1.id)
    expect(v2.audit.length).toBeGreaterThan(0) // 审计链
  })

  it('同名版本被占用 → 自动小版本号 +1（AI 重复声明 v1.0.0 不冲突）', async () => {
    const full = writePkgFile('com.daily.test-theme', 'daily.pkg.json', themeManifest('1.0.0'))
    await syncPackageFromFs(USER_KEY, full)
    // 改内容但声明版本不变
    fs.writeFileSync(full, themeManifest('1.0.0', 'com.daily.test-theme', { description: { zh: 'changed' } }))
    await syncPackageFromFs(USER_KEY, full)
    const versions = await listVersions('com.daily.test-theme')
    expect(versions.map((v) => v.version)).toEqual(['1.0.0', '1.0.1'])
  })

  it('全量扫描（syncAll）：手动复制/恢复的文件夹也能注册（幂等）', async () => {
    const full = writePkgFile('com.daily.scan-theme', 'daily.pkg.json', themeManifest('1.0.0', 'com.daily.scan-theme'))
    await syncPackageFromFs(USER_KEY, full)
    // 直接把另一个包目录「手动」放进 packages/（不经钩子，模拟手动复制/回收站恢复）；
    // 文件夹名 = 该 manifest 自己的 id
    const dst = path.join(wsRoot(), 'packages', 'com.daily.scan2', 'daily.pkg.json')
    fs.mkdirSync(path.dirname(dst), { recursive: true })
    fs.writeFileSync(dst, themeManifest('1.0.0', 'com.daily.scan2'), 'utf-8')
    await syncAllPackagesFromWorkspace(USER_KEY)
    const scan2 = await getPackage('com.daily.scan2')
    expect(scan2).not.toBeNull()
    expect(scan2!.type).toBe('theme')
  })
})

describe('W1：校验反馈回路 —— 写错包 3 次内修正闭环', () => {
  function skillManifest(version = '1.0.0'): string {
    return JSON.stringify({
      schema_version: 2,
      id: 'com.daily.test-skill',
      type: 'skill',
      version,
      entry: 'SKILL.md',
      capabilities: ['ui.theme'],
      description: { zh: '测试技能' },
    })
  }

  it('第 1 次失败：写 manifest 但缺 SKILL.md → 反馈指路且不建版本（含 ⏳ info 反馈）', async () => {
    const full = writePkgFile('com.daily.test-skill', 'daily.pkg.json', skillManifest())
    const feedback = (await syncPackageFromFs(USER_KEY, full)) as string
    expect(feedback).toContain('SKILL.md')
    expect(feedback).toContain('未建版本')
    expect(feedback).toContain('⏳')
    expect(feedback).not.toContain('校验未通过')
    expect(await getPackage('com.daily.test-skill')).toBeNull() // 包事务：不留半成品
    expect((await listVersions('com.daily.test-skill')).length).toBe(0)
  })

  it('第 2 次：补上 SKILL.md → 注册成功（反馈回路闭环）', async () => {
    const manifest = writePkgFile('com.daily.test-skill', 'daily.pkg.json', skillManifest())
    await syncPackageFromFs(USER_KEY, manifest)
    writePkgFile('com.daily.test-skill', 'SKILL.md', '# 测试技能\n\n我会做测试。')
    const feedback = (await syncPackageFromFs(USER_KEY, writePkgFile('com.daily.test-skill', 'daily.pkg.json', skillManifest()))) as string
    expect(feedback).toContain('已注册')
    expect((await listVersions('com.daily.test-skill')).length).toBe(1)
  })

  it('fs 路径注册后版本快照 manifest 为 normalized 形态（问题 #5 修复回归）', async () => {
    // 传入宽松字符串 display_name 且缺 schema_version
    const rawManifest = JSON.stringify({
      id: 'com.daily.fs-norm-test',
      type: 'theme',
      version: '1.0.0',
      display_name: '容错主题',
    })
    const full = writePkgFile('com.daily.fs-norm-test', 'daily.pkg.json', rawManifest)
    const feedback = (await syncPackageFromFs(USER_KEY, full)) as string
    expect(feedback).toContain('已注册')

    const versions = await listVersions('com.daily.fs-norm-test')
    expect(versions.length).toBe(1)
    const snap = versions[0]!.manifest as { schema_version?: number; display_name?: { zh?: string } }
    expect(snap.schema_version).toBe(2)
    expect(snap.display_name?.zh).toBe('容错主题')
  })

  it('内容校验：data:image/png 200KB 通过；image/svg+xml base64 60KB 拒绝', async () => {
    // 1) data:image/png 200KB (base64 length ≈ 270KB > 48KB but < 256KB) → 通过
    const pngBase64 = 'A'.repeat(200 * 1024)
    const validPet = writePkgFile(
      'com.daily.pet-png',
      'daily.pkg.json',
      JSON.stringify({ schema_version: 2, id: 'com.daily.pet-png', type: 'pet-layer', version: '1.0.0', entry: 'index.html' }),
    )
    writePkgFile('com.daily.pet-png', 'index.html', `<html><body><img src="data:image/png;base64,${pngBase64}"></body></html>`)
    const feedbackValid = (await syncPackageFromFs(USER_KEY, validPet)) as string
    expect(feedbackValid).toContain('已注册')

    // 2) data:image/svg+xml 60KB (> 48KB) → 拒绝
    const svgBase64 = 'A'.repeat(60 * 1024)
    const badSvgPet = writePkgFile(
      'com.daily.pet-svg',
      'daily.pkg.json',
      JSON.stringify({ schema_version: 2, id: 'com.daily.pet-svg', type: 'pet-layer', version: '1.0.0', entry: 'index.html' }),
    )
    writePkgFile('com.daily.pet-svg', 'index.html', `<html><body><img src="data:image/svg+xml;base64,${svgBase64}"></body></html>`)
    const feedbackBad = (await syncPackageFromFs(USER_KEY, badSvgPet)) as string
    expect(feedbackBad).toContain('base64 内联块过大')
    expect(await getPackage('com.daily.pet-svg')).toBeNull()
  })

  it('删除/目录不存在场景静默返回 undefined', async () => {
    const r = await syncPackageFromFs(USER_KEY, path.join(wsRoot(), 'packages', 'non-existent-pkg', 'daily.pkg.json'))
    expect(r).toBeUndefined()
  })

  it('非法能力词 → 反馈点名词汇表；非法 semver → 反馈点名版本号', async () => {
    const badCap = writePkgFile(
      'com.daily.bad-cap',
      'daily.pkg.json',
      themeManifest('1.0.0', 'com.daily.bad-cap', { capabilities: ['not.a.real.cap'] }),
    )
    const feedback = (await syncPackageFromFs(USER_KEY, badCap)) as string
    expect(feedback).toContain('能力词')
    expect(await getPackage('com.daily.bad-cap')).toBeNull()

    const badVer = writePkgFile(
      'com.daily.bad-ver',
      'daily.pkg.json',
      JSON.stringify({ schema_version: 2, id: 'com.daily.bad-ver', type: 'theme', version: '1.0' }),
    )
    const feedback2 = (await syncPackageFromFs(USER_KEY, badVer)) as string
    expect(feedback2).toContain('semver')
    expect(await getPackage('com.daily.bad-ver')).toBeNull()
  })

  it('type=app 放到 packages/ → 反馈指引去 apps/（文件夹即 App 单轨）', async () => {
    const full = writePkgFile(
      'com.daily.wrong-app',
      'daily.pkg.json',
      JSON.stringify({ schema_version: 2, id: 'com.daily.wrong-app', type: 'app', version: '1.0.0', entry: 'index.html' }),
    )
    // 补一个 index.html 让它其它校验都通过
    writePkgFile('com.daily.wrong-app', 'index.html', '<!DOCTYPE html><html><body>hi</body></html>')
    const feedback = (await syncPackageFromFs(USER_KEY, full)) as string
    expect(feedback).toContain('apps/')
    expect(await getPackage('com.daily.wrong-app')).toBeNull()
  })

  it('HTML 含危险元素（iframe）→ 静态拒绝，反馈点名文件', async () => {
    const full = writePkgFile(
      'com.daily.pet-bad',
      'daily.pkg.json',
      JSON.stringify({ schema_version: 2, id: 'com.daily.pet-bad', type: 'pet-layer', version: '1.0.0', entry: 'index.html' }),
    )
    writePkgFile('com.daily.pet-bad', 'index.html', '<html><body><iframe src="https://evil.example"></iframe></body></html>')
    const feedback = (await syncPackageFromFs(USER_KEY, full)) as string
    expect(feedback).toContain('iframe')
    expect(await getPackage('com.daily.pet-bad')).toBeNull()
  })
})

describe('W1：生命周期 —— 指针切换 / 回滚 / 回收站', () => {
  async function makeThemeWithTwoVersions(): Promise<string> {
    const full = writePkgFile('com.daily.life-theme', 'daily.pkg.json', themeManifest('1.0.0', 'com.daily.life-theme'))
    await syncPackageFromFs(USER_KEY, full)
    fs.writeFileSync(full, themeManifest('1.1.0', 'com.daily.life-theme'))
    await syncPackageFromFs(USER_KEY, full)
    return full
  }

  it('原子切指针到指定（旧）版本', async () => {
    await makeThemeWithTwoVersions()
    const versions = await listVersions('com.daily.life-theme')
    const v1 = versions[0]!
    const r = await setActiveVersion(USER_KEY, 'com.daily.life-theme', v1.id)
    expect(r.ok).toBe(true)
    const pkg = await getPackage('com.daily.life-theme')
    expect(pkg!.activeVersionId).toBe(v1.id)
    // v1 回到 active，v2 变 ready
    const after = await listVersions('com.daily.life-theme')
    expect(after.find((v) => v.id === v1.id)!.status).toBe('active')
    expect(after.find((v) => v.version === '1.1.0')!.status).toBe('ready')
  })

  it('回滚到上一版本（指针语义 + 审计 + rolled_back 状态）', async () => {
    await makeThemeWithTwoVersions()
    const r = await rollbackTo(USER_KEY, 'com.daily.life-theme')
    expect(r.ok).toBe(true)
    expect(r.feedback).toContain('1.0.0')
    const pkg = await getPackage('com.daily.life-theme')
    const versions = await listVersions('com.daily.life-theme')
    const active = versions.find((v) => v.id === pkg!.activeVersionId)!
    expect(active.version).toBe('1.0.0')
    const rolled = versions.find((v) => v.version === '1.1.0')!
    expect(rolled.status).toBe('rolled_back')
    expect(rolled.audit.length).toBeGreaterThan(0)
  })

  it('回收站：DELETE 移文件夹 + 卸载标记；restore 恢复后版本指针不变', async () => {
    await makeThemeWithTwoVersions()
    const r = await recyclePackage(USER_KEY, 'com.daily.life-theme')
    expect(r.ok).toBe(true)
    expect(fs.existsSync(path.join(wsRoot(), 'packages', 'com.daily.life-theme'))).toBe(false)
    expect(fs.existsSync(path.join(wsRoot(), 'packages', '.trash', 'com.daily.life-theme', 'daily.pkg.json'))).toBe(true)
    const recycled = await getPackage('com.daily.life-theme')
    expect(recycled!.installed).toBe(false)
    expect((await listForUser(USER_KEY)).find((i) => i.id === 'com.daily.life-theme')?.installed).toBe(false)

    const rr = await restorePackage(USER_KEY, 'com.daily.life-theme')
    expect(rr.ok).toBe(true)
    expect(fs.existsSync(path.join(wsRoot(), 'packages', 'com.daily.life-theme', 'daily.pkg.json'))).toBe(true)
    const restored = await getPackage('com.daily.life-theme')
    expect(restored!.installed).toBe(true)
    expect(restored!.activeVersionId).toBe((await listVersions('com.daily.life-theme')).find((v) => v.version === '1.1.0')!.id)
  })
})

describe('W1：REST/服务接口 —— 列表 / 详情 / 粘贴创建', () => {
  it('listForUser 无 type 过滤合并 app 视图；type 过滤只回真包', async () => {
    writePkgFile('com.daily.list-theme', 'daily.pkg.json', themeManifest('1.0.0', 'com.daily.list-theme'))
    await syncAllPackagesFromWorkspace(USER_KEY)
    setAppViewProvider(async () => [{
      id: 'daily.ai', type: 'app', displayName: 'Daily AI', icon: null, version: '1.0.0',
      source: 'builtin', installed: true, owner: true, capabilities: [], activeVersionId: 'v1', createdAt: 0, updatedAt: 0,
    }] as PackageListItem[])
    const all = await listForUser(USER_KEY)
    expect(all.map((i) => i.id)).toContain('com.daily.list-theme')
    expect(all.map((i) => i.id)).toContain('daily.ai')
    const themes = await listForUser(USER_KEY, { type: 'theme' })
    expect(themes.map((i) => i.id)).toEqual(['com.daily.list-theme'])
    const appsV = await listForUser(USER_KEY, { type: 'app' })
    expect(appsV.map((i) => i.id)).toEqual(['daily.ai'])
  })

  it('getDetailForUser 返回版本列表 + 安装态', async () => {
    writePkgFile('com.daily.detail-theme', 'daily.pkg.json', themeManifest('1.0.0', 'com.daily.detail-theme'))
    await syncAllPackagesFromWorkspace(USER_KEY)
    const detail = await getDetailForUser(USER_KEY, 'com.daily.detail-theme')
    expect(detail).not.toBeNull()
    expect(detail!.versions.length).toBe(1)
    expect(detail!.item.type).toBe('theme')
    expect(detail!.install?.installed).toBe(true)
  })

  it('createFromPaste：粘贴 manifest+pasted 文件 → 校验不过不注册，通过即注册', async () => {
    const bad = await createFromPaste(USER_KEY, {
      manifest: JSON.parse(themeManifest('1.0.0', 'com.daily.paste', { capabilities: ['nope'] })),
    })
    expect(bad.ok).toBe(false)
    expect(await getPackage('com.daily.paste')).toBeNull()

    const good = await createFromPaste(USER_KEY, {
      manifest: JSON.parse(themeManifest('1.0.0', 'com.daily.paste2')),
      files: [{ path: 'icon.svg', content: '<svg xmlns="http://www.w3.org/2000/svg"></svg>' }],
    })
    expect(good.ok).toBe(true)
    expect(good.id).toBe('com.daily.paste2')
    expect(fs.existsSync(path.join(wsRoot(), 'packages', 'com.daily.paste2', 'icon.svg'))).toBe(true)
  })
})

describe('W1：辅助纯函数', () => {
  it('matchPackageFolder 只认 packages/<id>/（顶层），含非法 id 拒绝', () => {
    expect(matchPackageFolder('packages/com.daily.notes/daily.pkg.json')).toBe('com.daily.notes')
    expect(matchPackageFolder('packages/主题-包/icon.svg')).toBe('主题-包')
    expect(matchPackageFolder('packages/.trash/x/1')).toBe(null) // 隐藏目录
    expect(matchPackageFolder('apps/com.daily.notes/index.html')).toBe(null)
    expect(matchPackageFolder('home/readme.md')).toBe(null)
    expect(matchPackageFolder('packages/../apps/x')).toBe(null) // 穿越
  })

  it('nextPackageVersion：未占用用声明值；占用自动 +1（含 pre 后缀保留）', () => {
    expect(nextPackageVersion([], '1.2.0')).toBe('1.2.0')
    expect(nextPackageVersion(['1.2.0'], '1.2.0')).toBe('1.2.1')
    expect(nextPackageVersion(['1.2.0', '1.2.1'], '1.2.0')).toBe('1.2.2')
    expect(nextPackageVersion(['1.2.0-beta.1'], '1.2.0-beta.1')).toBe('1.2.0-beta.2')
  })
})

describe('验收旅程（Validation UX Overhaul 验收）', () => {
  it('旅程 A（内部 AI）：mkdir → 写 manifest → 写 SKILL.md，全程仅 1 次 ⏳，终态 ✅ v1.0.0 注册，无 ⚠️', async () => {
    // 1. mkdir
    const pkgDir = path.join(wsRoot(), 'packages', 'com.daily.journey-a')
    fs.mkdirSync(pkgDir, { recursive: true })
    const manifestPath = path.join(pkgDir, 'daily.pkg.json')

    // 2. 写 manifest（此时缺 SKILL.md）
    fs.writeFileSync(
      manifestPath,
      JSON.stringify({
        schema_version: 2,
        id: 'com.daily.journey-a',
        type: 'skill',
        version: '1.0.0',
        entry: 'SKILL.md',
      }),
      'utf-8',
    )
    const fb1 = (await syncPackageFromFs(USER_KEY, manifestPath)) as string
    expect(fb1).toContain('⏳')
    expect(fb1).toContain('未建版本')
    expect(fb1).not.toContain('⚠️')
    expect(await getPackage('com.daily.journey-a')).toBeNull()

    // 3. 写 SKILL.md
    const skillPath = path.join(pkgDir, 'SKILL.md')
    fs.writeFileSync(skillPath, '# Journey A Skill\n\nAI skill content', 'utf-8')
    const fb2 = (await syncPackageFromFs(USER_KEY, skillPath)) as string
    expect(fb2).toContain('✅')
    expect(fb2).toContain('v1.0.0')
    expect(fb2).not.toContain('⚠️')
    expect(fb2).not.toContain('⏳')

    const pkg = await getPackage('com.daily.journey-a')
    expect(pkg).not.toBeNull()
  })

  it('旅程 B（外部开发者）：提交含字符串 display_name / 小写 method 的 api 包 → 容错注册成功', async () => {
    const res = await createFromPaste(USER_KEY, {
      manifest: {
        id: 'com.daily.journey-b-api',
        type: 'api',
        display_name: '旅程B服务',
      },
      files: {
        'api.json': JSON.stringify({
          namespace: 'journey_b',
          display_name: '旅程B接口',
          endpoints: [
            {
              name: 'ping',
              method: 'get',
              path: '/ping',
              handler: './handlers/ping.js',
            },
          ],
        }),
        'handlers/ping.js': 'async function main(ctx) { return { ok: true }; }',
      },
    })
    expect(res.ok).toBe(true)
    expect(res.feedback).toContain('✅')
    const pkg = await getPackage('com.daily.journey-b-api')
    expect(pkg).not.toBeNull()
  })

  it('旅程 C（恶意/事故回归）：eval、内网域名拦截阻断', async () => {
    // 1. eval 拦截
    const evalFull = writePkgFile(
      'com.daily.evil-eval',
      'daily.pkg.json',
      JSON.stringify({ schema_version: 2, id: 'com.daily.evil-eval', type: 'toolpkg', version: '1.0.0', entry: 'main.js' }),
    )
    writePkgFile('com.daily.evil-eval', 'main.js', 'eval("console.log(1)")')
    const fbEval = (await syncPackageFromFs(USER_KEY, evalFull)) as string
    expect(fbEval).toContain('⚠️')
    expect(fbEval).toContain('eval')
    expect(await getPackage('com.daily.evil-eval')).toBeNull()

    // 2. 内网域名拦截
    const ssrfFull = writePkgFile(
      'com.daily.evil-ssrf',
      'daily.pkg.json',
      JSON.stringify({
        schema_version: 2,
        id: 'com.daily.evil-ssrf',
        type: 'toolpkg',
        version: '1.0.0',
        entry: 'main.js',
        network: { domains: ['127.0.0.1'] },
      }),
    )
    writePkgFile('com.daily.evil-ssrf', 'main.js', 'function run() {}')
    const fbSsrf = (await syncPackageFromFs(USER_KEY, ssrfFull)) as string
    expect(fbSsrf).toContain('⚠️')
    expect(fbSsrf).toContain('SSRF')
    expect(await getPackage('com.daily.evil-ssrf')).toBeNull()
  })
})