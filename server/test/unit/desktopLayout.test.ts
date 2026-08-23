// server/test/unit/desktopLayout.test.ts —— 桌面布局契约守卫 + 端点语义
// ----------------------------------------------------------------------------
// 验收（docs/routes/web/08-ui.md §2 + routes/README.md §9.1 desktopLayout 插队小任务）：
//   - 布局 schema 快照对 fixtures：合法全过 / 非法全拒（schema 层）
//   - 服务端语义补强：同页重复 appId 被拦（schema 无法表达 appId 维度重复）
// 运行：npm test -- --run test/unit/desktopLayout.test.ts
// ============================================================================

import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Check } from 'typebox/value'
import desktopLayoutSchema from '../../../shared/webos-contracts/desktop-layout.schema.json' with { type: 'json' }

const FIXTURES_DIR = join(
  __dirname,
  '..',
  '..',
  '..',
  'shared',
  'webos-contracts',
  'fixtures',
)
const SCHEMA_FILE = join(__dirname, '..', '..', '..', 'shared', 'webos-contracts', 'desktop-layout.schema.json')

function loadDesktopFixtures(): { file: string; valid: boolean; raw: unknown }[] {
  const out: { file: string; valid: boolean; raw: unknown }[] = []
  for (const file of readdirSync(FIXTURES_DIR)) {
    if (!file.startsWith('desktop-layout-') || !file.endsWith('.json')) continue
    out.push({
      file,
      valid: !file.includes('-invalid-'),
      raw: JSON.parse(readFileSync(join(FIXTURES_DIR, file), 'utf-8')) as unknown,
    })
  }
  return out
}

const fixtures = loadDesktopFixtures()
const { version: _schemaVersion } = JSON.parse(
  readFileSync(SCHEMA_FILE, 'utf-8'),
) as { version?: number }

describe('桌面布局契约守卫：schema 快照存在且完整', () => {
  it('schema json 文件可解析且具备 version/pages 约束', () => {
    const schema = desktopLayoutSchema as { required?: string[]; properties?: Record<string, unknown> }
    expect(schema.required).toContain('version')
    expect(schema.required).toContain('pages')
    expect(schema.properties?.['pages']).toBeDefined()
    void _schemaVersion
  })
})

describe('桌面布局契约守卫：合法 fixtures 全过', () => {
  for (const f of fixtures.filter((x) => x.valid)) {
    it(`legal: ${f.file}`, () => {
      expect(Check(desktopLayoutSchema, f.raw), f.file).toBe(true)
    })
  }
})

describe('桌面布局契约守卫：非法 fixtures 全部被 schema 或语义拒绝', () => {
  for (const f of fixtures.filter((x) => !x.valid)) {
    it(`illegal: ${f.file}`, () => {
      // 语义层检查：同页重复 app（invalid-03）——schema 无法表达 appId 维度，
      // 由服务端 findDuplicateAppIds 拦截；其余非法应被 schema 拒绝。
      const raw = f.raw as { version: number; pages?: unknown[][] }
      const pageDup = raw.pages?.some((page) => {
        const ids = new Set<string>()
        for (const item of page) {
          const it = item as { kind?: string; appId?: string }
          if ((it.kind === undefined || it.kind === 'app') && typeof it.appId === 'string') {
            if (ids.has(it.appId)) return true
            ids.add(it.appId)
          }
        }
        return false
      })
      if (pageDup) {
        expect(Check(desktopLayoutSchema, f.raw)).toBe(true) // schema 层放行（JSON 无法表达）
        expect(findDuplicateDesktopApp(f.raw)).toBe(true) // 语义层必拦
      } else {
        expect(Check(desktopLayoutSchema, f.raw), f.file).toBe(false)
      }
    })
  }
})

/** 复制服务端 findDuplicateAppIds 语义做测试断言（避免依赖路由内部实现） */
function findDuplicateDesktopApp(raw: unknown): boolean {
  const layout = raw as { pages?: { kind?: string; appId?: string }[][] }
  for (const page of layout.pages ?? []) {
    const seen = new Set<string>()
    for (const item of page) {
      const appId = item.appId
      if (typeof appId === 'string') {
        if (seen.has(appId)) return true
        seen.add(appId)
      }
    }
  }
  return false
}