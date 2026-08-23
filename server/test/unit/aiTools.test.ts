/**
 * Phase S8.4：AI 工具元数据一致性测试（spec 第六章 6.2 节）
 *
 * 验证 aiTools.ts 导出的元数据定义：
 * - AI_TOOL_DEFINITIONS 长度与分类计数
 * - 每个工具字段非空且类型正确
 * - AI_TOOL_MAP / DISABLEABLE_TOOL_NAMES / isValidToolName 一致性
 * - ask_user / query_capabilities 不可禁用
 *
 * 注：spec 行 340 说"长度 = 30"，但实际源码已增至 45（Phase 3 新增 7 个 filesystem +
 * Phase 5 新增 5 个背景/弹出层 + upload_background_image）。本测试以实际源码为准。
 */
import { describe, it, expect } from 'vitest'

import {
  AI_TOOL_DEFINITIONS,
  AI_TOOL_MAP,
  DISABLEABLE_TOOL_NAMES,
  FILE_SYSTEM_TOOL_NAMES,
  getToolDefaultEnabled,
  isValidToolName,
  type ToolCategory,
} from '../../src/utils/aiTools.js'

// ============================================================================
// 预期常量（基于源码实际值，非 spec 旧值）
// ============================================================================

const EXPECTED_TOTAL = 46  // spec 说 30，实际 46（含 7 filesystem + 5 Phase5 + 1 upload_background_image + 2026-08-17 Exa/ArXiv 换供应商新增 academic_search/exa_find_similar）
const EXPECTED_CATEGORIES: Record<ToolCategory, number> = {
  widget: 10,       // 4 原始 + set_background + upload_background_image + add_effect + place_basic_component
  storage: 2,
  browser: 18,
  interaction: 3,   // ask_user + show_popup + dismiss_popup
  search: 5,        // 2026-08-17 供应商替换：local_search + web_search + read_webpage + academic_search + exa_find_similar
  system: 1,        // query_capabilities
  filesystem: 7,    // Phase 3 新增
}
const EXPECTED_DISABLEABLE = EXPECTED_TOTAL - 2  // 除 ask_user / query_capabilities 外都可禁用 → 44

// ============================================================================
// 测试套件
// ============================================================================

describe('aiTools 元数据一致性', () => {
  describe('AI_TOOL_DEFINITIONS 基础验证', () => {
    it('1. 定义总数 = 46（实际值，非 spec 旧值 30）', () => {
      expect(AI_TOOL_DEFINITIONS).toHaveLength(EXPECTED_TOTAL)
    })

    it('2. 每个工具的 name 非空且全局唯一', () => {
      const names = AI_TOOL_DEFINITIONS.map(t => t.name)
      for (const n of names) {
        expect(typeof n).toBe('string')
        expect(n.length).toBeGreaterThan(0)
      }
      const unique = new Set(names)
      expect(unique.size).toBe(names.length)
    })

    it('3. 每个工具的 label / description 非空字符串', () => {
      for (const t of AI_TOOL_DEFINITIONS) {
        expect(typeof t.label).toBe('string')
        expect(t.label.length).toBeGreaterThan(0)
        expect(typeof t.description).toBe('string')
        expect(t.description.length).toBeGreaterThan(0)
      }
    })

    it('4. 每个工具的 category 合法且 canDisable / defaultEnabled 为 boolean', () => {
      const validCategories: ToolCategory[] = ['widget', 'storage', 'browser', 'interaction', 'search', 'system', 'filesystem']
      for (const t of AI_TOOL_DEFINITIONS) {
        expect(validCategories).toContain(t.category)
        expect(typeof t.canDisable).toBe('boolean')
        expect(typeof t.defaultEnabled).toBe('boolean')
      }
    })
  })

  describe('AI_TOOL_MAP 一致性', () => {
    it('5. MAP 的 size 与 DEFINITIONS 长度一致，且每个 name 都映射到正确的元数据', () => {
      expect(AI_TOOL_MAP.size).toBe(AI_TOOL_DEFINITIONS.length)
      for (const def of AI_TOOL_DEFINITIONS) {
        const mapped = AI_TOOL_MAP.get(def.name)
        expect(mapped).toBeDefined()
        expect(mapped).toBe(def)  // 同一引用
      }
    })
  })

  describe('DISABLEABLE_TOOL_NAMES 一致性', () => {
    it('6. DISABLEABLE 集合与 canDisable=true 的工具完全一致（44 个）', () => {
      expect(DISABLEABLE_TOOL_NAMES.size).toBe(EXPECTED_DISABLEABLE)
      for (const def of AI_TOOL_DEFINITIONS) {
        if (def.canDisable) {
          expect(DISABLEABLE_TOOL_NAMES.has(def.name)).toBe(true)
        } else {
          expect(DISABLEABLE_TOOL_NAMES.has(def.name)).toBe(false)
        }
      }
    })
  })

  describe('isValidToolName', () => {
    it('7. 合法工具名返回 true', () => {
      // 抽样几个不同分类的工具
      expect(isValidToolName('create_html_widget')).toBe(true)
      expect(isValidToolName('browser_eval')).toBe(true)
      expect(isValidToolName('ask_user')).toBe(true)
      expect(isValidToolName('query_capabilities')).toBe(true)
      expect(isValidToolName('web_search')).toBe(true)
      expect(isValidToolName('read')).toBe(true)  // filesystem
    })

    it('8. 非法工具名返回 false（空串 / 不存在 / 含特殊字符）', () => {
      expect(isValidToolName('')).toBe(false)
      expect(isValidToolName('nonexistent_tool')).toBe(false)
      expect(isValidToolName('create_html_widget ')).toBe(false)  // 末尾空格
      expect(isValidToolName('CREATE_HTML_WIDGET')).toBe(false)   // 大写
      expect(isValidToolName('browser-eval')).toBe(false)         // 连字符
    })
  })

  describe('分类计数', () => {
    it('9. 每个分类的工具数与预期一致', () => {
      const counts: Record<string, number> = {}
      for (const t of AI_TOOL_DEFINITIONS) {
        counts[t.category] = (counts[t.category] ?? 0) + 1
      }
      for (const [cat, expected] of Object.entries(EXPECTED_CATEGORIES)) {
        expect(counts[cat] ?? 0).toBe(expected)
      }
    })
  })

  describe('系统工具不可禁用', () => {
    it('10. ask_user 和 query_capabilities 的 canDisable=false', () => {
      const askUser = AI_TOOL_MAP.get('ask_user')
      expect(askUser).toBeDefined()
      expect(askUser!.canDisable).toBe(false)

      const queryCaps = AI_TOOL_MAP.get('query_capabilities')
      expect(queryCaps).toBeDefined()
      expect(queryCaps!.canDisable).toBe(false)
    })
  })

  describe('FILE_SYSTEM_TOOL_NAMES', () => {
    it('11. 包含 7 个文件系统工具且 defaultEnabled=false', () => {
      expect(FILE_SYSTEM_TOOL_NAMES.size).toBe(7)
      const expected = ['read', 'write', 'edit', 'bash', 'grep', 'find', 'ls']
      for (const name of expected) {
        expect(FILE_SYSTEM_TOOL_NAMES.has(name)).toBe(true)
        const def = AI_TOOL_MAP.get(name)
        expect(def).toBeDefined()
        expect(def!.defaultEnabled).toBe(false)
      }
    })
  })

  describe('getToolDefaultEnabled', () => {
    it('11a. 已知工具返回其 defaultEnabled 值（覆盖 ?? 的左侧 truthy 分支）', () => {
      // defaultEnabled=true 的工具
      expect(getToolDefaultEnabled('create_html_widget')).toBe(true)
      expect(getToolDefaultEnabled('ask_user')).toBe(true)
      expect(getToolDefaultEnabled('web_search')).toBe(true)
      // defaultEnabled=false 的工具（filesystem）
      expect(getToolDefaultEnabled('read')).toBe(false)
      expect(getToolDefaultEnabled('bash')).toBe(false)
    })

    it('11b. 未知工具名返回 true（覆盖 ?? 的右侧 fallback 分支）', () => {
      expect(getToolDefaultEnabled('nonexistent_tool')).toBe(true)
      expect(getToolDefaultEnabled('')).toBe(true)
    })
  })

  describe('工具名命名规范', () => {
    it('12. 所有工具名仅含小写字母/数字/下划线', () => {
      for (const t of AI_TOOL_DEFINITIONS) {
        expect(t.name).toMatch(/^[a-z][a-z0-9_]*$/)
      }
    })
  })
})
