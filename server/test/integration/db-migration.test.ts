// ============================================================================
// Phase S8.5：DB 迁移脚本测试 + aiContext 持久化与恢复测试
//
// Spec: docs/specs/phase-s8-test-spec.md 第七章 S8.5（行 411-479）
//
// 测试范围：
// - 幂等性测试（initializeSchema 两次调用、表数 ≥ 23、索引、ALTER 列）
// - 回滚测试（删列/删表后重新迁移可恢复）
// - seed 测试（4 个内置模板、重复调用不报错）
// - skill_settings 迁移测试（builtin:/user: 从 tool_settings 迁出）
// - 旧 search key 清理测试（bocha + semanticScholar）
// - aiContext.ts 持久化与恢复测试
//   （persistConversation/persistPiEvent/getRecentConversations/
//    restoreSessionContext 60000 上限/memories 8000 上限/runRetentionCleanup）
// - SQL 转换层测试（$N→? / ::jsonb / ::BIGINT / ANY() 展开 / 数组序列化 / JSONB 自动解析）
// ============================================================================

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type { Pool } from 'pg'
import { tmpdir } from 'os'
import { join } from 'path'

// ============================================================================
// vi.mock：拦截 aiContext.ts 的 LLM 依赖（hoisted，在 import 之前执行）
// 用于 runRetentionCleanup 测试（summarizeConversations/extractMemories 内部调用）
// ============================================================================
vi.mock('../../src/utils/llmCaller.js', () => ({
  callLlm: vi.fn(),
  callLlmWithFallback: vi.fn(),
}))

// ============================================================================
// 动态 import（在 vi.mock 生效后）
// ============================================================================

import { createTestDb } from '../helpers/db.js'
import { initializeSchema } from '../../src/db/schema.js'
import { seedBuiltinTemplates } from '../../src/db/seed.js'
import {
  persistConversation,
  persistPiEvent,
  getRecentConversations,
  restoreSessionContext,
  runRetentionCleanup,
} from '../../src/db/aiContext.js'
import { getDbInstance } from '../../src/db/connection-sqlite.js'
import { callLlm, callLlmWithFallback } from '../../src/utils/llmCaller.js'

const callLlmMock = vi.mocked(callLlm)
const callLlmWithFallbackMock = vi.mocked(callLlmWithFallback)

// ============================================================================
// 预期表名数组（对齐 schema-sqlite.ts 中的 CREATE TABLE 语句，避免硬编码过时）
// 28 张表（含 sync_queue 死代码表 + Phase 4 多用户系统新增表）
// ============================================================================
const EXPECTED_TABLES = [
  'panels', 'widgets', 'entities', 'entity_relations', 'settings',
  'dynamic_widgets', 'panel_templates', 'activity_sessions', 'schema_version',
  'sync_queue',                              // DEPRECATED 但表仍存在
  'ai_conversations', 'ai_memories', 'ai_settings',
  'user_skills', 'tool_settings', 'skill_settings',
  'favorited_widgets', 'local_service_registry', 'panel_memory_states',
  'api_usage_log', 'component_capabilities',
  'entity_conflict_logs', 'sync_logs',
  'users', 'communities', 'custom_widgets',
  'ai_providers', 'search_engines',
]

// 关键索引（spec 7.2 节"验证所有索引存在"，抽样检查跨表索引）
// 注意：idx_panels_owner_id / idx_panels_is_community 仅存在于 PG schema.ts，
//       schema-sqlite.ts 中未创建（SQLite 模式下不存在），故不列入预期
const EXPECTED_INDEXES = [
  'idx_widgets_panel_id', 'idx_widgets_type',
  'idx_entities_type', 'idx_entities_scope', 'idx_entities_type_scope',
  'idx_relations_source', 'idx_relations_target', 'idx_relations_unique',
  'idx_activity_started', 'idx_activity_category',
  'idx_ai_conv_panel_created', 'idx_ai_mem_panel',
  'idx_favorited_widgets_panel_id',
  'idx_local_service_device', 'idx_local_service_online',
  'idx_api_usage_log_provider_time',
  'idx_entity_conflict_logs_entity', 'idx_entity_conflict_logs_panel_id',
  'idx_sync_logs_device_status', 'idx_sync_logs_status', 'idx_sync_logs_created_at',
  'idx_users_role', 'idx_users_is_banned',
  'idx_widgets_is_global',
  'idx_communities_added_by', 'idx_communities_is_official', 'idx_communities_api_url',
  'idx_custom_widgets_owner_id', 'idx_custom_widgets_is_public',
  'idx_ai_providers_priority', 'idx_ai_providers_enabled',
]

// ============================================================================
// 共享状态
// ============================================================================

let pool: Pool
let cleanup: () => Promise<void>

beforeEach(async () => {
  // 重置 SQLITE_PATH 为短路径，避免 createTestDb() 累加导致 Windows MAX_PATH 溢出
  // （createTestDb 每次会在 SQLITE_PATH 后追加 .{pid}.{counter}.db）
  process.env.SQLITE_PATH = join(tmpdir(), `ld-migration-${process.pid}-${Date.now()}.db`)
  const db = await createTestDb()
  pool = db.pool
  cleanup = db.cleanup
  callLlmMock.mockReset()
  callLlmWithFallbackMock.mockReset()
})

afterEach(async () => {
  await cleanup()
})

// ============================================================================
// 辅助函数
// ============================================================================

async function listTables(): Promise<string[]> {
  const result = await pool.query(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
  )
  return result.rows.map(r => r.name as string)
}

async function listIndexes(): Promise<string[]> {
  const result = await pool.query(
    "SELECT name FROM sqlite_master WHERE type='index' AND name NOT LIKE 'sqlite_%' ORDER BY name",
  )
  return result.rows.map(r => r.name as string)
}

async function tableColumns(tableName: string): Promise<string[]> {
  const result = await pool.query(`PRAGMA table_info(${tableName})`)
  return result.rows.map(r => r.name as string)
}

// ============================================================================
// S8.5 幂等性测试
// ============================================================================

describe('S8.5 幂等性测试', () => {
  it('1. initializeSchema() 第二次调用不报错', async () => {
    // createTestDb() 已调用一次 initializeSchema()
    await expect(initializeSchema()).resolves.not.toThrow()
  })

  it('2. 所有预期表都存在（表数 ≥ 23）', async () => {
    const tables = await listTables()
    expect(tables.length).toBeGreaterThanOrEqual(23)
    for (const t of EXPECTED_TABLES) {
      expect(tables).toContain(t)
    }
  })

  it('3. 第二次 initializeSchema() 后表结构不变（表集合相同）', async () => {
    const tablesBefore = await listTables()
    await initializeSchema()
    const tablesAfter = await listTables()
    expect(tablesAfter).toEqual(tablesBefore)
  })

  it('4. 所有关键索引存在', async () => {
    const indexes = await listIndexes()
    for (const idx of EXPECTED_INDEXES) {
      expect(indexes).toContain(idx)
    }
  })

  it('5. ALTER 列存在：dynamic_widgets 4 列（component_env/local_services/cross_platform/desktop_only）', async () => {
    const cols = await tableColumns('dynamic_widgets')
    expect(cols).toContain('component_env')
    expect(cols).toContain('local_services')
    expect(cols).toContain('cross_platform')
    expect(cols).toContain('desktop_only')
  })

  it('6. ALTER 列存在：api_usage_log.credits_consumed', async () => {
    const cols = await tableColumns('api_usage_log')
    expect(cols).toContain('credits_consumed')
  })

  it('7. ALTER 列存在：entity_conflict_logs.panel_id', async () => {
    const cols = await tableColumns('entity_conflict_logs')
    expect(cols).toContain('panel_id')
  })

  it('8. ALTER 列存在：panels.owner_id / is_community / community_api_url', async () => {
    const cols = await tableColumns('panels')
    expect(cols).toContain('owner_id')
    expect(cols).toContain('is_community')
    expect(cols).toContain('community_api_url')
  })

  it('9. ALTER 列存在：widgets.is_global', async () => {
    const cols = await tableColumns('widgets')
    expect(cols).toContain('is_global')
  })

  it('10. ALTER 列存在：custom_widgets.is_global', async () => {
    const cols = await tableColumns('custom_widgets')
    expect(cols).toContain('is_global')
  })

  it('11. schema_version 表已初始化为版本 1', async () => {
    const result = await pool.query("SELECT version FROM schema_version WHERE key = 'current'")
    expect(result.rows.length).toBe(1)
    expect(result.rows[0].version).toBe(1)
  })
})

// ============================================================================
// S8.5 回滚测试
// ============================================================================

describe('S8.5 回滚测试', () => {
  it('12. 删除 ALTER 列后重新 initializeSchema() 列被重建', async () => {
    const db = getDbInstance()
    // 删除 dynamic_widgets.component_env 列（SQLite 3.35+ 支持 DROP COLUMN）
    db.exec('ALTER TABLE dynamic_widgets DROP COLUMN component_env')

    // 验证列已删除
    let cols = await tableColumns('dynamic_widgets')
    expect(cols).not.toContain('component_env')

    // 重新迁移
    await initializeSchema()

    // 列被重新添加
    cols = await tableColumns('dynamic_widgets')
    expect(cols).toContain('component_env')
  })

  it('13. 删除表后重新 initializeSchema() 表被重建', async () => {
    const db = getDbInstance()
    // 删除 settings 表（独立表，无 FK 依赖，无 seed 数据）
    db.exec('DROP TABLE settings')

    // 验证表已删除
    let tables = await listTables()
    expect(tables).not.toContain('settings')

    // 重新迁移
    await initializeSchema()

    // 表被重建
    tables = await listTables()
    expect(tables).toContain('settings')

    // 验证表结构正确
    const cols = await tableColumns('settings')
    expect(cols).toContain('key')
    expect(cols).toContain('value')
    expect(cols).toContain('updated_at')
  })
})

// ============================================================================
// S8.5 seed 测试
// ============================================================================

describe('S8.5 seed 测试', () => {
  it('14. seedBuiltinTemplates() 插入 4 个内置模板（builtin-study/work/relax/review）', async () => {
    // createTestDb() 已调用 seedBuiltinTemplates() 一次
    const result = await pool.query('SELECT id, name, icon, is_builtin FROM panel_templates ORDER BY id')
    expect(result.rows.length).toBe(4)

    const ids = result.rows.map(r => r.id)
    expect(ids).toContain('builtin-study')
    expect(ids).toContain('builtin-work')
    expect(ids).toContain('builtin-relax')
    expect(ids).toContain('builtin-review')

    // 验证 is_builtin 标记（SQLite 中 BOOLEAN 存为 INTEGER 0/1）
    for (const row of result.rows) {
      expect(row.is_builtin).toBe(1)
    }
  })

  it('15. 重复调用 seedBuiltinTemplates() 不报错（ON CONFLICT DO NOTHING）', async () => {
    await expect(seedBuiltinTemplates()).resolves.not.toThrow()

    const result = await pool.query('SELECT id FROM panel_templates ORDER BY id')
    expect(result.rows.length).toBe(4)
  })
})

// ============================================================================
// S8.5 skill_settings 迁移测试
// ============================================================================

describe('S8.5 skill_settings 迁移测试', () => {
  it('16. builtin:/user: 前缀记录从 tool_settings 迁移到 skill_settings', async () => {
    const now = Date.now()
    // 预置 tool_settings：2 个 skill 记录 + 1 个普通工具记录
    await pool.query(
      `INSERT INTO tool_settings (tool_name, enabled, updated_at) VALUES
        ('builtin:test-skill', 1, $1),
        ('user:my-skill', 0, $1),
        ('taskList', 1, $1)
      ON CONFLICT (tool_name) DO NOTHING`,
      [now],
    )

    // 调用 initializeSchema()（migrateSkillSettings 会迁移 builtin:/user: 记录）
    await initializeSchema()

    // 验证 skill_settings 表有 builtin:/user: 记录
    const skillResult = await pool.query('SELECT skill_id, enabled FROM skill_settings ORDER BY skill_id')
    const skillIds = skillResult.rows.map(r => r.skill_id)
    expect(skillIds).toContain('builtin:test-skill')
    expect(skillIds).toContain('user:my-skill')

    // 验证 enabled 值正确迁移（user:my-skill 原 enabled=0）
    const userSkill = skillResult.rows.find(r => r.skill_id === 'user:my-skill')
    expect(userSkill?.enabled).toBe(0)

    // 验证 tool_settings 中无 builtin:/user: 前缀记录
    const toolSkillResult = await pool.query(
      "SELECT tool_name FROM tool_settings WHERE tool_name LIKE 'builtin:%' OR tool_name LIKE 'user:%'",
    )
    expect(toolSkillResult.rows.length).toBe(0)

    // 验证 tool_settings 仍保留普通工具记录
    const taskListResult = await pool.query("SELECT tool_name FROM tool_settings WHERE tool_name = 'taskList'")
    expect(taskListResult.rows.length).toBe(1)
  })
})

// ============================================================================
// S8.5 旧 search key 清理测试
// ============================================================================

describe('S8.5 旧 search key 清理测试', () => {
  it('17. 旧 key（bocha + semanticScholar）被清理，其他 key 保留', async () => {
    const now = Date.now()
    // 预置旧 key + 1 个正常 key
    await pool.query(
      `INSERT INTO ai_settings (key, value, updated_at) VALUES
        ('searchKey.bocha', 'old-bocha-1', $1),
        ('search_key_bocha', 'old-bocha-2', $1),
        ('searchKey.semanticScholar', 'old-scholar-1', $1),
        ('search_key_semantic_scholar', 'old-scholar-2', $1),
        ('other.valid.key', 'kept', $1)
      ON CONFLICT (key) DO NOTHING`,
      [now],
    )

    // 调用 initializeSchema()（cleanupOldSearchKeys 会删除旧 key）
    await initializeSchema()

    // 验证旧 key 全部被删除
    const oldResult = await pool.query(
      `SELECT key FROM ai_settings WHERE key IN
        ('searchKey.bocha', 'search_key_bocha', 'searchKey.semanticScholar', 'search_key_semantic_scholar')`,
    )
    expect(oldResult.rows.length).toBe(0)

    // 验证其他 key 仍保留
    const otherResult = await pool.query("SELECT key, value FROM ai_settings WHERE key = 'other.valid.key'")
    expect(otherResult.rows.length).toBe(1)
    expect(otherResult.rows[0].value).toBe('kept')
  })
})

// ============================================================================
// S8.5 aiContext.ts 持久化与恢复测试
// ============================================================================

describe('S8.5 aiContext.ts 持久化与恢复测试', () => {
  it('18. persistConversation() 写入 ai_conversations 表，字段正确', async () => {
    await persistConversation('panel-ctx-1', 'user', 'hello world', 'device-1')

    const result = await pool.query('SELECT * FROM ai_conversations WHERE panel_id = $1', ['panel-ctx-1'])
    expect(result.rows.length).toBe(1)
    const row = result.rows[0]
    expect(row.panel_id).toBe('panel-ctx-1')
    expect(row.role).toBe('user')
    expect(row.content).toBe('hello world')
    expect(row.device_id).toBe('device-1')
    expect(row.retention_level).toBe('full')
    expect(row.summarized).toBe(0) // SQLite BOOLEAN 存为 INTEGER
  })

  it('19. persistConversation() 带可选参数（toolCalls/toolResult）', async () => {
    await persistConversation(
      'panel-ctx-2', 'assistant', 'response text',
      undefined,
      [{ toolCallId: 'tc1', toolName: 'search', input: { q: 'test' } }],
      { toolCallId: 'tc1', toolName: 'search', result: 'result text', isError: false },
    )

    const result = await pool.query('SELECT * FROM ai_conversations WHERE panel_id = $1', ['panel-ctx-2'])
    expect(result.rows.length).toBe(1)
    const row = result.rows[0]
    expect(row.role).toBe('assistant')
    expect(row.content).toBe('response text')
    expect(row.device_id).toBeNull()
    // tool_calls/tool_result 是 TEXT 列存 JSON，读出时自动解析为对象
    expect(row.tool_calls).toEqual([{ toolCallId: 'tc1', toolName: 'search', input: { q: 'test' } }])
    expect(row.tool_result).toEqual({
      toolCallId: 'tc1', toolName: 'search', result: 'result text', isError: false,
    })
  })

  it('20. persistConversation() 无可选参数时 tool_calls/tool_result 为 NULL', async () => {
    await persistConversation('panel-ctx-2b', 'user', 'plain message')

    const result = await pool.query('SELECT * FROM ai_conversations WHERE panel_id = $1', ['panel-ctx-2b'])
    expect(result.rows.length).toBe(1)
    expect(result.rows[0].tool_calls).toBeNull()
    expect(result.rows[0].tool_result).toBeNull()
  })

  it('21. persistPiEvent() 处理 message_end（assistant）事件，提取文本+toolCalls', async () => {
    const event = {
      type: 'message_end',
      message: {
        role: 'assistant',
        content: [
          { type: 'text', text: 'hello from assistant' },
          { type: 'toolCall', id: 'tc1', name: 'search', arguments: { q: 'test' } },
        ],
      },
    }
    await persistPiEvent('panel-ctx-3', event)

    const result = await pool.query('SELECT * FROM ai_conversations WHERE panel_id = $1', ['panel-ctx-3'])
    expect(result.rows.length).toBe(1)
    const row = result.rows[0]
    expect(row.role).toBe('assistant')
    expect(row.content).toBe('hello from assistant')
    expect(row.tool_calls).toEqual([{ toolCallId: 'tc1', toolName: 'search', input: { q: 'test' } }])
  })

  it('22. persistPiEvent() 处理 tool_execution_end 事件', async () => {
    const event = {
      type: 'tool_execution_end',
      toolCallId: 'tc1',
      toolName: 'search',
      result: { content: [{ type: 'text', text: 'search result text' }] },
      isError: false,
    }
    await persistPiEvent('panel-ctx-4', event)

    const result = await pool.query('SELECT * FROM ai_conversations WHERE panel_id = $1', ['panel-ctx-4'])
    expect(result.rows.length).toBe(1)
    const row = result.rows[0]
    expect(row.role).toBe('tool')
    expect(row.content).toContain('search')
    expect(row.content).toContain('search result text')
    expect(row.tool_result).toEqual({
      toolCallId: 'tc1', toolName: 'search', result: 'search result text', isError: false,
    })
  })

  it('23. persistPiEvent() 跳过 session-only: 前缀面板', async () => {
    const event = {
      type: 'message_end',
      message: { role: 'assistant', content: [{ type: 'text', text: 'should not persist' }] },
    }
    await persistPiEvent('session-only:abc-123', event)

    const result = await pool.query("SELECT * FROM ai_conversations WHERE panel_id = 'session-only:abc-123'")
    expect(result.rows.length).toBe(0)
  })

  it('24. persistPiEvent() 跳过 user 角色（仅处理 assistant）', async () => {
    const event = {
      type: 'message_end',
      message: { role: 'user', content: [{ type: 'text', text: 'user msg' }] },
    }
    await persistPiEvent('panel-ctx-5', event)

    const result = await pool.query("SELECT * FROM ai_conversations WHERE panel_id = 'panel-ctx-5'")
    expect(result.rows.length).toBe(0)
  })

  it('25. persistPiEvent() 无效事件类型不报错', async () => {
    await persistPiEvent('panel-ctx-5b', { type: 'unknown_event' })
    await persistPiEvent('panel-ctx-5b', { notype: 'missing' })
    await persistPiEvent('panel-ctx-5b', null as never)

    const result = await pool.query("SELECT * FROM ai_conversations WHERE panel_id = 'panel-ctx-5b'")
    expect(result.rows.length).toBe(0)
  })

  it('26. getRecentConversations() 返回最近 N 条（按时间正序）', async () => {
    const now = Date.now()
    for (let i = 0; i < 5; i++) {
      await pool.query(
        `INSERT INTO ai_conversations (panel_id, role, content, retention_level, created_at, updated_at)
         VALUES ($1, 'user', $2, 'full', $3, $3)`,
        ['panel-ctx-6', `msg-${i}`, now + i],
      )
    }

    const result = await getRecentConversations('panel-ctx-6', 3)
    expect(result.length).toBe(3)
    // 正序：最旧在前，最新在后
    expect(result[0].content).toBe('msg-2')
    expect(result[2].content).toBe('msg-4')
  })

  it('27. getRecentConversations() 仅返回 retention_level=full 的对话', async () => {
    const now = Date.now()
    await pool.query(
      `INSERT INTO ai_conversations (panel_id, role, content, retention_level, created_at, updated_at)
       VALUES ($1, 'user', 'full-msg', 'full', $2, $2)`,
      ['panel-ctx-7', now],
    )
    await pool.query(
      `INSERT INTO ai_conversations (panel_id, role, content, retention_level, created_at, updated_at)
       VALUES ($1, 'user', 'summary-msg', 'summary', $2, $2)`,
      ['panel-ctx-7', now + 1],
    )

    const result = await getRecentConversations('panel-ctx-7', 10)
    expect(result.length).toBe(1)
    expect(result[0].content).toBe('full-msg')
  })

  it('28. restoreSessionContext() 从头部裁剪至 ≤ 60000 字符', async () => {
    const now = Date.now()
    // 预置 >60000 字符对话历史：10 条 × 8000 字符 = 80000 字符
    for (let i = 0; i < 10; i++) {
      await pool.query(
        `INSERT INTO ai_conversations (panel_id, role, content, retention_level, created_at, updated_at)
         VALUES ($1, 'user', $2, 'full', $3, $3)`,
        ['panel-ctx-8', 'x'.repeat(8000), now + i],
      )
    }

    const sendCustomMessage = vi.fn().mockResolvedValue(undefined)
    const fakeSession = { sendCustomMessage } as never

    await restoreSessionContext(fakeSession as never, 'panel-ctx-8')

    expect(sendCustomMessage).toHaveBeenCalledTimes(1)
    const callArg = sendCustomMessage.mock.calls[0][0] as { content: string; customType: string }
    expect(callArg.customType).toBe('context_restore')
    // conversationMarkdown 被裁剪至 ≤ 60000，content 含外层 prefix（~30 字符）+ conversationMarkdown
    expect(callArg.content.length).toBeLessThanOrEqual(60100)
    // 验证确实发生了裁剪（原始 80000 字符 → < 70000）
    expect(callArg.content.length).toBeLessThan(70000)
  })

  it('29. restoreSessionContext() memories 8000 字符上限', async () => {
    const now = Date.now()
    // 1 条对话 + 10 条 memory（每条 ~1000 字符 = 10000 字符 > 8000）
    await pool.query(
      `INSERT INTO ai_conversations (panel_id, role, content, retention_level, created_at, updated_at)
       VALUES ($1, 'user', 'short msg', 'full', $2, $2)`,
      ['panel-ctx-9', now],
    )
    for (let i = 0; i < 10; i++) {
      await pool.query(
        `INSERT INTO ai_memories (panel_id, memory_type, content, created_at, updated_at)
         VALUES ($1, 'fact', $2, $3, $3)`,
        ['panel-ctx-9', `${i}-` + 'y'.repeat(1000), now + i],
      )
    }

    const sendCustomMessage = vi.fn().mockResolvedValue(undefined)
    const fakeSession = { sendCustomMessage } as never

    await restoreSessionContext(fakeSession as never, 'panel-ctx-9')

    const callArg = sendCustomMessage.mock.calls[0][0] as { content: string }
    // 提取 memory 部分（## 长期记忆 之后）
    const memSection = callArg.content.split('## 长期记忆')[1] || ''
    // memoryLines.join('\n') ≤ 8000，加上前缀 \n\n ≤ 8002
    expect(memSection.length).toBeLessThanOrEqual(8050)
  })

  it('30. restoreSessionContext() 无历史时不调用 sendCustomMessage', async () => {
    const sendCustomMessage = vi.fn().mockResolvedValue(undefined)
    const fakeSession = { sendCustomMessage } as never

    await restoreSessionContext(fakeSession as never, 'empty-panel-ctx')

    expect(sendCustomMessage).not.toHaveBeenCalled()
  })

  it('31. restoreSessionContext() sendCustomMessage 失败时不抛错（容错）', async () => {
    const now = Date.now()
    await pool.query(
      `INSERT INTO ai_conversations (panel_id, role, content, retention_level, created_at, updated_at)
       VALUES ($1, 'user', 'msg', 'full', $2, $2)`,
      ['panel-ctx-10', now],
    )

    const sendCustomMessage = vi.fn().mockRejectedValue(new Error('network error'))
    const fakeSession = { sendCustomMessage } as never

    // 不抛错（容错处理）
    await expect(restoreSessionContext(fakeSession as never, 'panel-ctx-10')).resolves.not.toThrow()
  })

  it('32. runRetentionCleanup() 30 天前 full 对话 → AI 总结成 summary，原对话删除', async () => {
    const now = Date.now()
    const thirtyOneDaysAgo = now - 31 * 24 * 60 * 60 * 1000
    // 预置 2 条 31 天前的 full 对话
    await pool.query(
      `INSERT INTO ai_conversations (panel_id, role, content, retention_level, created_at, updated_at)
       VALUES ($1, 'user', 'old conversation 1', 'full', $2, $2)`,
      ['panel-ctx-11', thirtyOneDaysAgo],
    )
    await pool.query(
      `INSERT INTO ai_conversations (panel_id, role, content, retention_level, created_at, updated_at)
       VALUES ($1, 'user', 'old conversation 2', 'full', $2, $2)`,
      ['panel-ctx-11', thirtyOneDaysAgo + 1],
    )

    // mock LLM 返回摘要
    callLlmWithFallbackMock.mockResolvedValue('AI generated summary')

    await runRetentionCleanup()

    // 验证原 full 对话被删除
    const oldResult = await pool.query(
      "SELECT * FROM ai_conversations WHERE panel_id = 'panel-ctx-11' AND retention_level = 'full'",
    )
    expect(oldResult.rows.length).toBe(0)

    // 验证 summary 条目被插入
    const summaryResult = await pool.query(
      "SELECT * FROM ai_conversations WHERE panel_id = 'panel-ctx-11' AND retention_level = 'summary'",
    )
    expect(summaryResult.rows.length).toBe(1)
    expect(summaryResult.rows[0].content).toBe('AI generated summary')
    expect(summaryResult.rows[0].role).toBe('assistant')
    // summary_of 是 convIds 数组，读出时自动解析
    expect(Array.isArray(summaryResult.rows[0].summary_of)).toBe(true)
    expect(summaryResult.rows[0].summary_of.length).toBe(2)
  })

  it('33. runRetentionCleanup() 90 天前 summary → 提取为 memories，summary 删除', async () => {
    const now = Date.now()
    const ninetyOneDaysAgo = now - 91 * 24 * 60 * 60 * 1000
    // 预置 1 条 91 天前的 summary
    await pool.query(
      `INSERT INTO ai_conversations (panel_id, role, content, retention_level, created_at, updated_at)
       VALUES ($1, 'assistant', 'old summary content', 'summary', $2, $2)`,
      ['panel-ctx-12', ninetyOneDaysAgo],
    )

    // mock LLM 返回 memories JSON
    callLlmMock.mockResolvedValue(JSON.stringify([
      { type: 'fact', content: 'user is a programmer' },
      { type: 'preference', content: 'user likes dark theme' },
    ]))

    await runRetentionCleanup()

    // 验证 summary 被删除
    const summaryResult = await pool.query(
      "SELECT * FROM ai_conversations WHERE panel_id = 'panel-ctx-12' AND retention_level = 'summary'",
    )
    expect(summaryResult.rows.length).toBe(0)

    // 验证 memories 被插入
    const memResult = await pool.query("SELECT * FROM ai_memories WHERE panel_id = 'panel-ctx-12'")
    expect(memResult.rows.length).toBe(2)
    const contents = memResult.rows.map(r => r.content)
    expect(contents).toContain('user is a programmer')
    expect(contents).toContain('user likes dark theme')
    // 验证 memory_type
    const types = memResult.rows.map(r => r.memory_type)
    expect(types).toContain('fact')
    expect(types).toContain('preference')
  })
})

// ============================================================================
// S8.5 SQL 转换层测试
// ============================================================================

describe('S8.5 SQL 转换层测试（SQLite 模式）', () => {
  it('34. $1/$2 → ? 转换', async () => {
    const result = await pool.query('SELECT $1 as a, $2 as b', ['hello', 'world'])
    expect(result.rows[0].a).toBe('hello')
    expect(result.rows[0].b).toBe('world')
  })

  it('35. ::jsonb 类型转换剥离 + JSONB 列读出自动 JSON.parse', async () => {
    const now = Date.now()
    await pool.query(
      `INSERT INTO settings (key, value, updated_at) VALUES ('test-jsonb', $1::jsonb, $2)
       ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = $2`,
      [JSON.stringify({ foo: 'bar', num: 42 }), now],
    )

    const result = await pool.query("SELECT value FROM settings WHERE key = 'test-jsonb'")
    expect(result.rows[0].value).toEqual({ foo: 'bar', num: 42 })
    expect(typeof result.rows[0].value).toBe('object')
  })

  it('36. ::BIGINT 类型转换剥离', async () => {
    const result = await pool.query('SELECT $1::BIGINT as val', [42])
    expect(result.rows[0].val).toBe(42)
  })

  it('37. ANY($N) → IN (?, ?) 展开', async () => {
    const now = Date.now()
    await pool.query(
      `INSERT INTO tool_settings (tool_name, enabled, updated_at) VALUES
        ('test_tool_a', 1, $1),
        ('test_tool_b', 1, $1)
      ON CONFLICT (tool_name) DO NOTHING`,
      [now],
    )

    const result = await pool.query(
      'SELECT tool_name FROM tool_settings WHERE tool_name = ANY($1) ORDER BY tool_name',
      [['test_tool_a', 'test_tool_b']],
    )
    expect(result.rows.length).toBe(2)
    expect(result.rows[0].tool_name).toBe('test_tool_a')
    expect(result.rows[1].tool_name).toBe('test_tool_b')
  })

  it('38. ANY($N::text[]) 同时剥离类型转换并展开', async () => {
    const now = Date.now()
    await pool.query(
      `INSERT INTO tool_settings (tool_name, enabled, updated_at) VALUES
        ('test_tool_c', 1, $1)
      ON CONFLICT (tool_name) DO NOTHING`,
      [now],
    )

    const result = await pool.query(
      'SELECT tool_name FROM tool_settings WHERE tool_name = ANY($1::text[]) ORDER BY tool_name',
      [['test_tool_c', 'nonexistent']],
    )
    expect(result.rows.length).toBe(1)
    expect(result.rows[0].tool_name).toBe('test_tool_c')
  })

  it('39. 数组参数 JSON 序列化（summary_of BIGINT[]）', async () => {
    const now = Date.now()
    await pool.query(
      `INSERT INTO ai_conversations (panel_id, role, content, retention_level, summary_of, created_at, updated_at)
       VALUES ($1, 'assistant', 'test summary', 'summary', $2, $3, $3)`,
      ['panel-sql-1', [1, 2, 3], now],
    )

    const result = await pool.query(
      "SELECT summary_of FROM ai_conversations WHERE panel_id = 'panel-sql-1' AND retention_level = 'summary'",
    )
    expect(result.rows.length).toBe(1)
    // 数组参数被 JSON.stringify 存储，读出时被 autoParseRows 解析为数组
    expect(Array.isArray(result.rows[0].summary_of)).toBe(true)
    expect(result.rows[0].summary_of).toEqual([1, 2, 3])
  })

  it('40. boolean 参数序列化为 0/1（SQLite 不支持原生 boolean 绑定）', async () => {
    const now = Date.now()
    // enabled 参数为 boolean，应被序列化为 0/1
    await pool.query(
      `INSERT INTO tool_settings (tool_name, enabled, updated_at) VALUES ('bool-test', $1, $2)
       ON CONFLICT (tool_name) DO NOTHING`,
      [true, now],
    )
    const result = await pool.query("SELECT enabled FROM tool_settings WHERE tool_name = 'bool-test'")
    expect(result.rows.length).toBe(1)
    expect(result.rows[0].enabled).toBe(1)
  })
})
