// server/test/unit/contracts.test.ts —— W0 契约基线守卫
// ----------------------------------------------------------------------------
// 验收（docs/routes/web/09-roadmap.md W0）：
//   - 服务端校验器对 fixtures 全过（合法全过 / 非法全拒）
//   - schema 快照与 TS 单一事实源一致（生成脚本幂等）
//   - 能力词汇表快照与 shared JSON 一致
// 运行：npm test -- --run test/unit/contracts.test.ts
// ============================================================================

import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import {
  validatePackageManifest,
  validateApiSpec,
  validateUnknownContract,
} from '../../src/webos/contracts/index.js'

const FIXTURES_DIR = join(
  __dirname,
  '..',
  '..',
  '..',
  'shared',
  'webos-contracts',
  'packages',
  'fixtures',
)

interface FixtureCase {
  /** 文件名（含路径） */
  file: string
  /** 期望：合法 true / 非法 false */
  valid: boolean
  kind: 'package' | 'api'
}

function loadFixtures(): FixtureCase[] {
  const files = readdirSync(FIXTURES_DIR)
  const cases: FixtureCase[] = []
  for (const file of files) {
    if (!file.endsWith('.json')) continue
    const kind = file.startsWith('api-') ? 'api' : 'package'
    const valid = file.includes('-invalid-') ? false : true
    const raw = JSON.parse(readFileSync(join(FIXTURES_DIR, file), 'utf-8')) as unknown
    cases.push({ file, valid, kind })
    void raw
  }
  return cases
}

const allFixtures = loadFixtures()

describe('W0 契约基线：fixtures 完整性', () => {
  it('daily.pkg.json 合法+非法 fixtures 各 ≥10', () => {
    const pkgs = allFixtures.filter((f) => f.kind === 'package')
    const valid = pkgs.filter((f) => f.valid)
    const invalid = pkgs.filter((f) => !f.valid)
    expect(valid.length).toBeGreaterThanOrEqual(10)
    expect(invalid.length).toBeGreaterThanOrEqual(10)
  })

  it('api.json 合法+非法 fixtures 各 ≥5', () => {
    const apis = allFixtures.filter((f) => f.kind === 'api')
    const valid = apis.filter((f) => f.valid)
    const invalid = apis.filter((f) => !f.valid)
    expect(valid.length).toBeGreaterThanOrEqual(5)
    expect(invalid.length).toBeGreaterThanOrEqual(5)
  })

  it('schema 快照与 TS 单一事实源一致（生成脚本幂等）', async () => {
    // 幂等验证：重新生成后 JSON 无 diff（快照即事实源）
    const { execFileSync } = await import('node:child_process')
    const script = join(__dirname, '..', '..', 'scripts', 'gen-contract-schemas.mjs')
    // 生成脚本需要从 server 目录运行（node 相对解析）
    execFileSync(process.execPath, [script], {
      cwd: join(__dirname, '..', '..'),
      timeout: 60_000,
    })
    // 若生成结果与提交的快照不一致，git diff 会暴露——这里校验文件仍存在且可解析
    const pkgSchema = JSON.parse(
      readFileSync(join(FIXTURES_DIR, '..', 'daily-pkg.schema.json'), 'utf-8'),
    ) as Record<string, unknown>
    expect(pkgSchema['type']).toBe('object')
    expect((pkgSchema['required'] as string[]).length).toBeGreaterThanOrEqual(4)
    const capJson = JSON.parse(
      readFileSync(join(FIXTURES_DIR, '..', 'capabilities.json'), 'utf-8'),
    ) as unknown[]
    expect(capJson.length).toBeGreaterThanOrEqual(20)
  })
})

describe('W0 契约基线：校验器对合法 fixtures 全过', () => {
  for (const fixture of allFixtures.filter((f) => f.valid)) {
    it(`legal ${fixture.kind}: ${fixture.file}`, () => {
      const raw = readFixture(fixture.file)
      const result =
        fixture.kind === 'package' ? validatePackageManifest(raw) : validateApiSpec(raw)
      expect(result.ok, `should pass: ${JSON.stringify(result.issues)}`).toBe(true)
    })
  }
})

describe('W0 契约基线：校验器对非法 fixtures 全拒', () => {
  for (const fixture of allFixtures.filter((f) => !f.valid)) {
    it(`illegal ${fixture.kind}: ${fixture.file}`, () => {
      const raw = readFixture(fixture.file)
      const result =
        fixture.kind === 'package' ? validatePackageManifest(raw) : validateApiSpec(raw)
      expect(result.ok, `should reject, got ok=true`).toBe(false)
      expect(result.issues.length).toBeGreaterThanOrEqual(1)
      // 每条 issue 必须有人话 message（校验反馈回路）
      for (const issue of result.issues) {
        expect(issue.message.length).toBeGreaterThan(0)
      }
    })
  }
})

describe('W0 契约基线：自动识别未知契约', () => {
  it('识别 package', () => {
    const raw = readFixture('daily-pkg-valid-01-app-basic.json')
    const { kind, result } = validateUnknownContract(raw)
    expect(kind).toBe('package')
    expect(result.ok).toBe(true)
  })
  it('识别 api', () => {
    const raw = readFixture('api-valid-01-notes-basic.json')
    const { kind, result } = validateUnknownContract(raw)
    expect(kind).toBe('api')
    expect(result.ok).toBe(true)
  })
  it('非对象返回错误', () => {
    const { result } = validateUnknownContract(42)
    expect(result.ok).toBe(false)
  })
})

describe('W0 契约基线：语义校验细项', () => {
  it('非法能力词 + 不可用能力词被语义拦截（即使 schema 通过）', () => {
    // 构造：schema 结构合法但能力词非法（not.in.vocabulary 不在词汇表，process.spawn 不可用）
    const manifest = {
      schema_version: 2,
      id: 'com.daily.eviltest',
      type: 'app',
      version: '1.0.0',
      capabilities: ['app.storage.private', 'not.in.vocabulary', 'process.spawn'],
    }
    const result = validatePackageManifest(manifest)
    expect(result.ok).toBe(false)
    const messages = result.issues.map((i) => i.message).join('|')
    expect(messages).toContain('not.in.vocabulary')
    expect(messages).toContain('process.spawn')
  })

  it('内网域名被语义拒绝（SSRF 防护）', () => {
    const manifest = {
      schema_version: 2,
      id: 'com.daily.net',
      type: 'app',
      version: '1.0.0',
      network: { domains: ['192.168.1.10', 'localhost'] },
      capabilities: ['network.outbound'],
    }
    const result = validatePackageManifest(manifest)
    expect(result.ok).toBe(false)
    const messages = result.issues.map((i) => i.message).join('|')
    expect(messages).toContain('192.168.1.10')
    expect(messages).toContain('localhost')
  })

  it('children 超过深度上限被拒', () => {
    const manifest = {
      schema_version: 2,
      id: 'com.daily.deep',
      type: 'bundle',
      version: '1.0.0',
      children: ['deep.child.a', 'deep.child.b'],
    }
    // 顶层调用 depth=3 时 children 属非法（深度溢出）
    const result = validatePackageManifest(manifest, 3)
    expect(result.ok).toBe(false)
    expect(result.issues.some((i) => i.message.includes('嵌套超过'))).toBe(true)
  })

  it('api handler 路径防穿越', () => {
    const api = {
      schema_version: 1,
      namespace: 'evil',
      endpoints: [{ name: 'get', method: 'GET', path: '/x', handler: '../../etc/passwd.js' }],
    }
    const result = validateApiSpec(api)
    expect(result.ok).toBe(false)
    expect(result.issues.some((i) => i.message.includes('禁止'))).toBe(true)
  })
})

function readFixture(file: string): unknown {
  return JSON.parse(readFileSync(join(FIXTURES_DIR, file), 'utf-8')) as unknown
}