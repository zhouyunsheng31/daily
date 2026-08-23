import { getPool } from './connection.js'
// 静态导入 SQLite schema（仅加载模块；SQLite 模式下才真正使用）
import { initializeSchema as initializeSqliteSchema } from './schema-sqlite.js'

const DB_DRIVER = process.env.DB_DRIVER || 'postgres'
const USE_SQLITE = DB_DRIVER === 'sqlite'

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS panels (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL DEFAULT '未命名',
  sort_order INTEGER NOT NULL DEFAULT 0,
  settings JSONB NOT NULL DEFAULT '{}'::jsonb,
  canvas_transform JSONB,
  created_at BIGINT NOT NULL DEFAULT (EXTRACT(EPOCH FROM now()) * 1000)::BIGINT,
  updated_at BIGINT NOT NULL DEFAULT (EXTRACT(EPOCH FROM now()) * 1000)::BIGINT
);

CREATE TABLE IF NOT EXISTS widgets (
  id TEXT PRIMARY KEY,
  panel_id TEXT NOT NULL REFERENCES panels(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  x DOUBLE PRECISION NOT NULL DEFAULT 0,
  y DOUBLE PRECISION NOT NULL DEFAULT 0,
  width DOUBLE PRECISION NOT NULL DEFAULT 300,
  height DOUBLE PRECISION NOT NULL DEFAULT 200,
  z_index INTEGER NOT NULL DEFAULT 0,
  minimized BOOLEAN NOT NULL DEFAULT FALSE,
  locked BOOLEAN NOT NULL DEFAULT FALSE,
  color_scheme TEXT,
  state JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_primary BOOLEAN NOT NULL DEFAULT FALSE,
  version INTEGER NOT NULL DEFAULT 1,
  created_at BIGINT NOT NULL DEFAULT (EXTRACT(EPOCH FROM now()) * 1000)::BIGINT,
  updated_at BIGINT NOT NULL DEFAULT (EXTRACT(EPOCH FROM now()) * 1000)::BIGINT
);
CREATE INDEX IF NOT EXISTS idx_widgets_panel_id ON widgets(panel_id);
CREATE INDEX IF NOT EXISTS idx_widgets_type ON widgets(type);

CREATE TABLE IF NOT EXISTS entities (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  scope TEXT NOT NULL DEFAULT 'default',
  panel_id TEXT,
  widget_id TEXT,
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  record_status TEXT NOT NULL DEFAULT 'active',
  version INTEGER NOT NULL DEFAULT 1,
  created_at BIGINT NOT NULL DEFAULT (EXTRACT(EPOCH FROM now()) * 1000)::BIGINT,
  updated_at BIGINT NOT NULL DEFAULT (EXTRACT(EPOCH FROM now()) * 1000)::BIGINT
);
CREATE INDEX IF NOT EXISTS idx_entities_type ON entities(type);
CREATE INDEX IF NOT EXISTS idx_entities_scope ON entities(scope);
CREATE INDEX IF NOT EXISTS idx_entities_type_scope ON entities(type, scope);
CREATE INDEX IF NOT EXISTS idx_entities_panel_id ON entities(panel_id);
CREATE INDEX IF NOT EXISTS idx_entities_widget_id ON entities(widget_id);
CREATE INDEX IF NOT EXISTS idx_entities_record_status ON entities(record_status);

CREATE TABLE IF NOT EXISTS entity_relations (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  target_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at BIGINT NOT NULL DEFAULT (EXTRACT(EPOCH FROM now()) * 1000)::BIGINT
);
CREATE INDEX IF NOT EXISTS idx_relations_source ON entity_relations(source_id);
CREATE INDEX IF NOT EXISTS idx_relations_target ON entity_relations(target_id);
CREATE INDEX IF NOT EXISTS idx_relations_type ON entity_relations(type);
CREATE UNIQUE INDEX IF NOT EXISTS idx_relations_unique ON entity_relations(source_id, target_id, type);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at BIGINT NOT NULL DEFAULT (EXTRACT(EPOCH FROM now()) * 1000)::BIGINT
);

CREATE TABLE IF NOT EXISTS dynamic_widgets (
  widget_type TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  icon TEXT NOT NULL DEFAULT 'box',
  default_layout JSONB NOT NULL DEFAULT '{}'::jsonb,
  default_state JSONB NOT NULL DEFAULT '{}'::jsonb,
  code TEXT NOT NULL DEFAULT '',
  created_at BIGINT NOT NULL DEFAULT (EXTRACT(EPOCH FROM now()) * 1000)::BIGINT,
  updated_at BIGINT NOT NULL DEFAULT (EXTRACT(EPOCH FROM now()) * 1000)::BIGINT
);

CREATE TABLE IF NOT EXISTS panel_templates (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  icon TEXT NOT NULL DEFAULT 'layout',
  description TEXT NOT NULL DEFAULT '',
  widgets JSONB NOT NULL DEFAULT '[]'::jsonb,
  is_builtin BOOLEAN NOT NULL DEFAULT FALSE,
  created_at BIGINT NOT NULL DEFAULT (EXTRACT(EPOCH FROM now()) * 1000)::BIGINT,
  updated_at BIGINT NOT NULL DEFAULT (EXTRACT(EPOCH FROM now()) * 1000)::BIGINT
);

CREATE TABLE IF NOT EXISTS activity_sessions (
  id TEXT PRIMARY KEY,
  started_at BIGINT NOT NULL,
  ended_at BIGINT NOT NULL,
  duration_ms BIGINT NOT NULL,
  process_name TEXT NOT NULL,
  window_title TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT 'other',
  site_name TEXT,
  url TEXT,
  is_browser BOOLEAN NOT NULL DEFAULT FALSE,
  created_at BIGINT NOT NULL DEFAULT (EXTRACT(EPOCH FROM now()) * 1000)::BIGINT
);
CREATE INDEX IF NOT EXISTS idx_activity_started ON activity_sessions(started_at);
CREATE INDEX IF NOT EXISTS idx_activity_date ON activity_sessions(started_at, ended_at);
CREATE INDEX IF NOT EXISTS idx_activity_category ON activity_sessions(category, started_at);
CREATE INDEX IF NOT EXISTS idx_activity_process ON activity_sessions(process_name, started_at);

CREATE TABLE IF NOT EXISTS schema_version (
  key TEXT PRIMARY KEY DEFAULT 'current',
  version INTEGER NOT NULL
);

-- [DEPRECATED] sync_queue 表为 Phase S0 遗留死代码，Phase S3 起改用 sync_logs 表。
-- 此 CREATE TABLE 仅为兼容已部署 DB（避免破坏现有数据），不要在代码中引用 sync_queue 表。
-- 新代码应使用 sync_logs（见下方 DDL）。
-- 计划在 Phase S7 重建镜像时统一清理。
CREATE TABLE IF NOT EXISTS sync_queue (
  id TEXT PRIMARY KEY,
  device_id TEXT NOT NULL,
  operation TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  payload JSONB NOT NULL,
  created_at BIGINT NOT NULL DEFAULT (EXTRACT(EPOCH FROM now()) * 1000)::BIGINT,
  retry_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT
);
CREATE INDEX IF NOT EXISTS idx_sync_queue_device ON sync_queue(device_id);
CREATE INDEX IF NOT EXISTS idx_sync_queue_created ON sync_queue(created_at);

-- ============================================================================
-- Phase 4：AI 上下文 + 配置 + Skills（spec 2.1 节）
-- ============================================================================

-- AI 对话历史（按面板，架构文档 2.4）
CREATE TABLE IF NOT EXISTS ai_conversations (
  id BIGSERIAL PRIMARY KEY,
  panel_id TEXT NOT NULL,
  role VARCHAR(16) NOT NULL,             -- user/assistant/tool
  content TEXT NOT NULL,
  tool_calls JSONB,
  tool_result JSONB,
  device_id VARCHAR(64),
  summarized BOOLEAN NOT NULL DEFAULT FALSE,
  summary_of BIGINT[],
  retention_level VARCHAR(16) NOT NULL DEFAULT 'full',
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL DEFAULT (EXTRACT(EPOCH FROM now()) * 1000)::BIGINT
);
CREATE INDEX IF NOT EXISTS idx_ai_conv_panel_created ON ai_conversations(panel_id, created_at);

-- AI 记忆（按面板，长期记忆，架构文档 2.4）
CREATE TABLE IF NOT EXISTS ai_memories (
  id BIGSERIAL PRIMARY KEY,
  panel_id TEXT NOT NULL,
  memory_type VARCHAR(32),               -- fact/preference/summary
  content TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ai_mem_panel ON ai_memories(panel_id);

-- AI 设置（键值存储，架构文档 9.4）
CREATE TABLE IF NOT EXISTS ai_settings (
  key VARCHAR(128) PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at BIGINT NOT NULL
);

-- 模型注册表（Operit 式多模型配置：每套模型独立 API/参数，前端可切换）
CREATE TABLE IF NOT EXISTS ai_models (
  id VARCHAR(64) PRIMARY KEY,
  name VARCHAR(128) NOT NULL,
  provider VARCHAR(64) NOT NULL DEFAULT 'openai',
  endpoint TEXT,
  model VARCHAR(256) NOT NULL,
  api_key TEXT,
  params JSONB NOT NULL DEFAULT '{}'::jsonb,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ai_models_default ON ai_models(is_default) WHERE is_default = TRUE;

-- 用户自定义 skills（架构文档 9.4）
CREATE TABLE IF NOT EXISTS user_skills (
  id VARCHAR(64) PRIMARY KEY,
  name VARCHAR(128) NOT NULL,
  description TEXT,
  content TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);

-- 工具启用状态（架构文档 9.4）
CREATE TABLE IF NOT EXISTS tool_settings (
  tool_name VARCHAR(64) PRIMARY KEY,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at BIGINT NOT NULL
);

-- Skill 启用状态（Phase S4 收尾 P1-2：从 tool_settings 拆分出来，避免 skill ID 与工具名混存）
CREATE TABLE IF NOT EXISTS skill_settings (
  skill_id VARCHAR(64) PRIMARY KEY,
  enabled BOOLEAN DEFAULT TRUE,
  updated_at BIGINT NOT NULL
);

-- 迁移历史 skill 启用状态从 tool_settings 到 skill_settings（幂等）
-- 只迁移 builtin: 和 user: 前缀的记录（skill ID 格式），不误迁工具记录
DO $$
BEGIN
  INSERT INTO skill_settings (skill_id, enabled, updated_at)
  SELECT tool_name, enabled, updated_at FROM tool_settings
  WHERE tool_name LIKE 'builtin:%' OR tool_name LIKE 'user:%'
  ON CONFLICT (skill_id) DO NOTHING;
  -- 清理 tool_settings 表中的 skill 记录（保留工具记录）
  DELETE FROM tool_settings WHERE tool_name LIKE 'builtin:%' OR tool_name LIKE 'user:%';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'skill_settings migration skipped: %', SQLERRM;
END $$;

-- ============================================================================
-- Phase 5：收藏组件（spec 3.1.1 节）
-- ============================================================================

CREATE TABLE IF NOT EXISTS favorited_widgets (
  id TEXT PRIMARY KEY,
  widget_id TEXT NOT NULL,
  panel_id TEXT NOT NULL,
  widget_type TEXT NOT NULL,
  display_name TEXT NOT NULL,
  position_snapshot JSONB NOT NULL,
  state_snapshot JSONB NOT NULL DEFAULT '{}',
  device_id TEXT,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  UNIQUE (widget_id)
);
CREATE INDEX IF NOT EXISTS idx_favorited_widgets_panel_id ON favorited_widgets(panel_id);

-- dynamic_widgets 表扩展（架构文档 6.4 + 12.3，方案 C）
-- 用 DO 块幂等 ALTER（检查列是否存在）
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'dynamic_widgets' AND column_name = 'component_env') THEN
    ALTER TABLE dynamic_widgets ADD COLUMN component_env VARCHAR(16) NOT NULL DEFAULT 'pure-frontend';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'dynamic_widgets' AND column_name = 'local_services') THEN
    ALTER TABLE dynamic_widgets ADD COLUMN local_services JSONB;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'dynamic_widgets' AND column_name = 'cross_platform') THEN
    ALTER TABLE dynamic_widgets ADD COLUMN cross_platform BOOLEAN NOT NULL DEFAULT TRUE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'dynamic_widgets' AND column_name = 'desktop_only') THEN
    ALTER TABLE dynamic_widgets ADD COLUMN desktop_only BOOLEAN NOT NULL DEFAULT FALSE;
  END IF;
END $$;

-- ============================================================================
-- Phase 6.2：本地服务注册表（spec 3.3.1 节）—— 服务器中转跨端方案
-- ============================================================================

CREATE TABLE IF NOT EXISTS local_service_registry (
  id BIGSERIAL PRIMARY KEY,
  device_id VARCHAR(64) NOT NULL,
  service_name VARCHAR(128) NOT NULL,
  endpoint TEXT NOT NULL,
  description TEXT,
  online BOOLEAN NOT NULL DEFAULT FALSE,
  last_heartbeat BIGINT,
  registered_at BIGINT NOT NULL DEFAULT (EXTRACT(EPOCH FROM now()) * 1000)::BIGINT,
  updated_at BIGINT NOT NULL DEFAULT (EXTRACT(EPOCH FROM now()) * 1000)::BIGINT,
  UNIQUE (device_id, service_name)
);
CREATE INDEX IF NOT EXISTS idx_local_service_device ON local_service_registry(device_id);
CREATE INDEX IF NOT EXISTS idx_local_service_online ON local_service_registry(online);

-- ============================================================================
-- Phase 6.1：面板内存休眠状态（spec 第 2 节）
-- ============================================================================

CREATE TABLE IF NOT EXISTS panel_memory_states (
  panel_id TEXT PRIMARY KEY REFERENCES panels(id) ON DELETE CASCADE,
  saved_state JSONB NOT NULL DEFAULT '{}'::jsonb,
  saved_at BIGINT NOT NULL DEFAULT (EXTRACT(EPOCH FROM now()) * 1000)::BIGINT
);

-- ============================================================================
-- Phase S9：AI 搜索工具 API 调用日志（spec 8.4 节）
-- ============================================================================

CREATE TABLE IF NOT EXISTS api_usage_log (
  id BIGSERIAL PRIMARY KEY,
  provider VARCHAR(32) NOT NULL,
  endpoint VARCHAR(256) NOT NULL,
  count INTEGER NOT NULL DEFAULT 1,
  latency_ms INTEGER,
  status VARCHAR(16) NOT NULL,
  error_msg TEXT,
  created_at BIGINT NOT NULL,
  -- 2026-08-17 搜索 API 状态可视化：用户/关键词/来源工具（可空，兼容旧记录）
  user_key VARCHAR(128),
  query TEXT,
  tool VARCHAR(64)
);
CREATE INDEX IF NOT EXISTS idx_api_usage_log_provider_time ON api_usage_log(provider, created_at);
CREATE INDEX IF NOT EXISTS idx_api_usage_log_tool_time ON api_usage_log(tool, created_at);

-- ============================================================================
-- Phase 14.4：组件能力声明表（spec 14.4.2 节）
-- 独立表，widget_type 仅作字符串主键（不外键引用 dynamic_widgets，
-- 因内置组件如 htmlCanvas 不在 dynamic_widgets 表中）
-- ============================================================================
CREATE TABLE IF NOT EXISTS component_capabilities (
  widget_type TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  api JSONB NOT NULL DEFAULT '[]'::jsonb,
  dependencies TEXT[] NOT NULL DEFAULT '{}',
  version TEXT NOT NULL DEFAULT '1.0.0',
  component_env VARCHAR(16) NOT NULL DEFAULT 'pure-frontend',
  cross_platform BOOLEAN NOT NULL DEFAULT TRUE,
  desktop_only BOOLEAN NOT NULL DEFAULT FALSE,
  created_at BIGINT NOT NULL DEFAULT (EXTRACT(EPOCH FROM now()) * 1000)::BIGINT,
  updated_at BIGINT NOT NULL DEFAULT (EXTRACT(EPOCH FROM now()) * 1000)::BIGINT
);

-- ============================================================================
-- Phase S11：搜索工具优化迁移（spec 2.5 + 3.6 + 2.7.5 节，幂等执行）
-- ============================================================================

-- 1. 清理旧 Bocha Key 残留（spec 2.5 节）
DELETE FROM ai_settings WHERE key IN ('searchKey.bocha', 'search_key_bocha');

-- 2. 清理旧 Semantic Scholar Key 残留（spec 3.6 节，S2 已移除）
DELETE FROM ai_settings WHERE key IN ('searchKey.semanticScholar', 'search_key_semantic_scholar');

-- 3. api_usage_log 新增 credits_consumed 列（spec 2.7.5 节，秘塔 credits 字段记录）
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'api_usage_log' AND column_name = 'credits_consumed') THEN
    ALTER TABLE api_usage_log ADD COLUMN credits_consumed INTEGER;
  END IF;
END $$;

-- 4. api_usage_log 新增 user_key/query/tool 列（搜索 API 状态可视化，幂等）
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'api_usage_log' AND column_name = 'user_key') THEN
    ALTER TABLE api_usage_log ADD COLUMN user_key VARCHAR(128);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'api_usage_log' AND column_name = 'query') THEN
    ALTER TABLE api_usage_log ADD COLUMN query TEXT;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'api_usage_log' AND column_name = 'tool') THEN
    ALTER TABLE api_usage_log ADD COLUMN tool VARCHAR(64);
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_api_usage_log_tool_time ON api_usage_log(tool, created_at);

-- ============================================================================
-- Phase S3 缺口 A：实体冲突日志（架构文档 4.3）
-- 记录 entity PUT 时版本不匹配的冲突信息，供事后审计
-- 保留 LWW 默认策略（仍应用更新），仅追加日志
-- ============================================================================
CREATE TABLE IF NOT EXISTS entity_conflict_logs (
  id TEXT PRIMARY KEY,
  entity_id TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  panel_id TEXT,
  local_version INTEGER NOT NULL,
  remote_version INTEGER NOT NULL,
  local_state JSONB,
  remote_state JSONB,
  source_device_id TEXT,
  resolved BOOLEAN NOT NULL DEFAULT FALSE,
  resolved_action TEXT,
  resolved_at BIGINT,
  created_at BIGINT NOT NULL DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT
);
-- 幂等迁移：已部署 DB（表已存在但无 panel_id 列）通过 ALTER TABLE 补加
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'entity_conflict_logs' AND column_name = 'panel_id') THEN
    ALTER TABLE entity_conflict_logs ADD COLUMN panel_id TEXT;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_entity_conflict_logs_entity ON entity_conflict_logs(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_entity_conflict_logs_panel_id ON entity_conflict_logs(panel_id);
CREATE INDEX IF NOT EXISTS idx_entity_conflict_logs_resolved ON entity_conflict_logs(resolved) WHERE resolved = FALSE;
CREATE INDEX IF NOT EXISTS idx_entity_conflict_logs_created_at ON entity_conflict_logs(created_at);

-- ============================================================================
-- Phase S3 缺口 B：sync_logs 服务器端持久化（架构文档 5.2）
-- 替代死代码 sync_queue 表（保留旧表不删，避免破坏已部署 DB）
-- 注：dismissed 仅是客户端 SyncFailedBanner 的本地 UI 状态（useState 持久化在内存中），
--     不持久化到 sync_logs.status；sync_logs.status 仅枚举 pending / success / failed 三态。
-- ============================================================================
CREATE TABLE IF NOT EXISTS sync_logs (
  id TEXT PRIMARY KEY,
  device_id TEXT NOT NULL,
  operation TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  payload JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  retry_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at BIGINT NOT NULL DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT,
  updated_at BIGINT NOT NULL DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT,
  next_retry_at BIGINT
);
CREATE INDEX IF NOT EXISTS idx_sync_logs_device_status ON sync_logs(device_id, status);
CREATE INDEX IF NOT EXISTS idx_sync_logs_status ON sync_logs(status);
CREATE INDEX IF NOT EXISTS idx_sync_logs_created_at ON sync_logs(created_at);

-- ============================================================================
-- Phase 4：多用户系统 + 面板多建（spec §8/§9/§10）
-- ============================================================================

-- users 表（多用户系统）
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member',
  is_banned BOOLEAN NOT NULL DEFAULT FALSE,
  created_at BIGINT NOT NULL DEFAULT (EXTRACT(EPOCH FROM now()) * 1000)::BIGINT,
  last_login_at BIGINT
);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
CREATE INDEX IF NOT EXISTS idx_users_is_banned ON users(is_banned);

-- 2026-08-02 账号系统：注册/登录 IP（防批量注册，后台可查同 IP 注册数）
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'registered_ip') THEN
    ALTER TABLE users ADD COLUMN registered_ip TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'last_login_ip') THEN
    ALTER TABLE users ADD COLUMN last_login_ip TEXT;
  END IF;
END $$;

-- 2026-08-02 AI 用量明细（new-api 风格：每个请求一行；管理后台统计/审计用）
CREATE TABLE IF NOT EXISTS webos_ai_usage (
  id TEXT PRIMARY KEY,
  user_key TEXT NOT NULL,             -- guest:<deviceId> / user:<userId>
  user_email TEXT,                    -- 已登录用户邮箱（游客为 NULL）
  kind TEXT NOT NULL DEFAULT 'guest', -- guest / member / plan（用户分层）
  model TEXT NOT NULL,
  thinking TEXT NOT NULL,
  prompt_tokens INTEGER NOT NULL DEFAULT 0,
  completion_tokens INTEGER NOT NULL DEFAULT 0,
  total_tokens INTEGER NOT NULL DEFAULT 0,
  cost_minor INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'ok',  -- ok / failed / insufficient / empty_response
  error_code TEXT,
  ip TEXT,
  created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_webos_ai_usage_user ON webos_ai_usage(user_key, created_at);
CREATE INDEX IF NOT EXISTS idx_webos_ai_usage_created ON webos_ai_usage(created_at);
CREATE INDEX IF NOT EXISTS idx_webos_ai_usage_status ON webos_ai_usage(status);

-- 2026-08-11 对话内容落库（查 bug 必须看对话记录；服务端此前不存对话内容，
-- 只有用量审计，导致排查"消息重复/扣费异常"只能靠 pm2 日志猜）
CREATE TABLE IF NOT EXISTS webos_chat_logs (
  id TEXT PRIMARY KEY,
  user_key TEXT NOT NULL,             -- guest:<deviceId> / user:<userId>
  user_email TEXT,                    -- 已登录用户邮箱（游客为 NULL）
  conversation_id TEXT NOT NULL DEFAULT 'default',
  request_id TEXT,                    -- chat/stream 的 requestId（对齐用量表/日志）
  role TEXT NOT NULL,                 -- user / assistant
  content TEXT NOT NULL,              -- 消息纯文本（assistant 取最后一条 assistant 消息）
  thinking TEXT,                      -- 思考档（low/medium/high/max/off）
  rebuild BOOLEAN NOT NULL DEFAULT FALSE, -- 编辑/回退重来
  status TEXT NOT NULL DEFAULT 'ok',  -- ok / failed / empty_response / insufficient
  error_code TEXT,
  prompt_tokens INTEGER NOT NULL DEFAULT 0,
  completion_tokens INTEGER NOT NULL DEFAULT 0,
  total_tokens INTEGER NOT NULL DEFAULT 0,
  cost_minor INTEGER NOT NULL DEFAULT 0,
  ip TEXT,
  created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_webos_chat_logs_user ON webos_chat_logs(user_key, created_at);
CREATE INDEX IF NOT EXISTS idx_webos_chat_logs_conv ON webos_chat_logs(user_key, conversation_id, created_at);
CREATE INDEX IF NOT EXISTS idx_webos_chat_logs_created ON webos_chat_logs(created_at);

-- 2026-08-13 统一对话 log（一次 chat/stream 请求 = 一行完整记录）：
-- 一个对话里发生的全部事情（用户消息、AI 思考 reasoning、文字输出、工具调用、
-- 工具过程、App 创建/更新事件、最终状态与用量）统一保存为一个 events JSON，
-- 与 webos_chat_logs（按消息粒度、快速浏览）互补——查"AI 当时怎么想的/干了什么"
-- 必须看这里（reasoning 内容只在此表；webos_chat_logs 只存纯文本）。
CREATE TABLE IF NOT EXISTS webos_chat_sessions (
  id TEXT PRIMARY KEY,             -- chat-session-<uuid>
  user_key TEXT NOT NULL,          -- guest:<deviceId> / user:<userId>
  user_email TEXT,                 -- 已登录用户邮箱（游客为 NULL）
  conversation_id TEXT NOT NULL DEFAULT 'default',
  request_id TEXT,                 -- chat/stream 的 requestId（对齐用量表/日志）
  thinking TEXT,                   -- 思考档（low/medium/high/max/off）
  rebuild INTEGER NOT NULL DEFAULT 0,
  model TEXT NOT NULL DEFAULT 'deepseek-v4-flash',
  status TEXT NOT NULL DEFAULT 'ok', -- ok / failed / empty_response / insufficient
  error_code TEXT,
  prompt_tokens INTEGER NOT NULL DEFAULT 0,
  completion_tokens INTEGER NOT NULL DEFAULT 0,
  total_tokens INTEGER NOT NULL DEFAULT 0,
  cost_minor INTEGER NOT NULL DEFAULT 0,
  events TEXT NOT NULL DEFAULT '[]', -- JSON 数组：完整事件序列（user/thinking/delta/tool_start/tool_update/tool_end/html/app_created/app_updated/done）
  ip TEXT,
  created_at BIGINT NOT NULL,      -- 请求开始
  ended_at BIGINT NOT NULL         -- 请求结束（落库时间）
);
CREATE INDEX IF NOT EXISTS idx_webos_chat_sessions_user ON webos_chat_sessions(user_key, created_at);
CREATE INDEX IF NOT EXISTS idx_webos_chat_sessions_conv ON webos_chat_sessions(user_key, conversation_id, created_at);
CREATE INDEX IF NOT EXISTS idx_webos_chat_sessions_created ON webos_chat_sessions(created_at);

-- 2026-08-14 视觉桥接用量明细（AI 的眼睛：图片/视频 → 文字描述）
-- 主模型（DeepSeek）非视觉，每次视觉模型调用一行；2026-08-21 双 provider：
--   图片优先 deepseek-v4-flash-vision-exp（官方价，高峰×2）/ 兜底与视频走 MiniMax-M3（官方五折价），
--   model 列区分实际执行模型，成本按各自价格折算，管理后台实时查看
CREATE TABLE IF NOT EXISTS webos_vision_usage (
  id TEXT PRIMARY KEY,             -- vision-<uuid>
  user_key TEXT NOT NULL,          -- guest:<deviceId> / user:<userId>
  user_email TEXT,                 -- 已登录用户邮箱（游客为 NULL）
  request_id TEXT,                 -- 关联 chat/stream 的 requestId（可为 NULL：工具触发）
  conversation_id TEXT,
  trigger TEXT NOT NULL DEFAULT 'chat_bridge', -- chat_bridge / read_tool / describe_media
  kind TEXT NOT NULL DEFAULT 'image',          -- image / video / mixed / unsupported
  model TEXT,                                  -- 2026-08-21 实际执行模型：deepseek-v4-flash-vision-exp / MiniMax-M3
  media_count INTEGER NOT NULL DEFAULT 0,
  prompt TEXT,                     -- 附带指令摘要（≤300 字符）
  description TEXT,                -- M3 返回的描述（≤500 字符，审计用）
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cached_tokens INTEGER NOT NULL DEFAULT 0,
  total_tokens INTEGER NOT NULL DEFAULT 0,
  cost_minor INTEGER NOT NULL DEFAULT 0,       -- 平台成本（分；输入×2.1 + 输出×8.4 每百万）
  status TEXT NOT NULL DEFAULT 'ok',           -- ok / failed / timeout / not_configured / unsupported / empty
  error_code TEXT,
  error_message TEXT,                          -- 失败/降级详情（M3 原始 message）
  duration_ms INTEGER NOT NULL DEFAULT 0,
  ip TEXT,
  created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_webos_vision_usage_user ON webos_vision_usage(user_key, created_at);
CREATE INDEX IF NOT EXISTS idx_webos_vision_usage_created ON webos_vision_usage(created_at);
CREATE INDEX IF NOT EXISTS idx_webos_vision_usage_status ON webos_vision_usage(status);

-- 2026-08-03 应用商店：已发布 App（AI 可通过 API 自由塑造商店形态）
CREATE TABLE IF NOT EXISTS webos_store_apps (
  id TEXT PRIMARY KEY,             -- shareId（分享链接 ?exp=<id>）
  app_id TEXT NOT NULL,            -- 发布者的原始 App id
  owner_key TEXT NOT NULL,         -- 发布者（guest:<deviceId> / user:<userId>）
  name TEXT NOT NULL,
  icon TEXT,
  description TEXT NOT NULL DEFAULT '',
  html TEXT NOT NULL,              -- 发布时的源码快照（版本化由发布者 App 侧保证）
  version TEXT NOT NULL DEFAULT '1.0.0',
  downloads INTEGER NOT NULL DEFAULT 0,
  size_bytes INTEGER NOT NULL DEFAULT 0,   -- 2026-08-12 应用占内存（HTML 快照 + 素材归档）
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  status TEXT NOT NULL DEFAULT 'published'
);
CREATE INDEX IF NOT EXISTS idx_store_apps_owner ON webos_store_apps(owner_key, status);
CREATE INDEX IF NOT EXISTS idx_store_apps_status ON webos_store_apps(status, created_at);

-- 2026-08-03 分享访问：别人通过分享链接进入并登录 → 分享者 +100 积分
CREATE TABLE IF NOT EXISTS webos_store_visits (
  id TEXT PRIMARY KEY,
  share_id TEXT NOT NULL REFERENCES webos_store_apps(id) ON DELETE CASCADE,
  visitor_key TEXT NOT NULL,
  owner_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'visited',
  created_at BIGINT NOT NULL,
  credited_at BIGINT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_store_visits_unique ON webos_store_visits(share_id, visitor_key);

-- 2026-08-03 商店下载：他人安装你的应用 → 你 +100 积分（一个用户对一个应用最多一次）
CREATE TABLE IF NOT EXISTS webos_store_installs (
  id TEXT PRIMARY KEY,
  share_id TEXT NOT NULL REFERENCES webos_store_apps(id) ON DELETE CASCADE,
  installer_key TEXT NOT NULL,
  owner_key TEXT NOT NULL,
  created_at BIGINT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_store_installs_unique ON webos_store_installs(share_id, installer_key);

-- 2026-08-18 技能市场发布：用户把自己工作区 skills/<skill_id>/ 发布到市场（他人可安装）
CREATE TABLE IF NOT EXISTS webos_store_skills (
  id TEXT PRIMARY KEY,             -- 条目 id（sk- 前缀，市场列表/安装/下架用）
  skill_id TEXT NOT NULL,          -- 发布时的技能目录名（安装到用户工作区 skills/<skill_id>/）
  owner_key TEXT NOT NULL,         -- 发布者（guest:<deviceId> / user:<userId>）
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  size_bytes BIGINT NOT NULL DEFAULT 0,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  status TEXT NOT NULL DEFAULT 'published'
);
CREATE INDEX IF NOT EXISTS idx_store_skills_owner ON webos_store_skills(owner_key, status);
CREATE INDEX IF NOT EXISTS idx_store_skills_status ON webos_store_skills(status, created_at);

-- 2026-08-06 服务器负载历史（每分钟一条，保留 30 天；管理后台趋势图 + AI 追溯查询）
CREATE TABLE IF NOT EXISTS webos_server_metrics (
  id TEXT PRIMARY KEY,
  ts BIGINT NOT NULL,
  cpu_usage REAL NOT NULL DEFAULT 0,
  loadavg_1m REAL NOT NULL DEFAULT 0,
  loadavg_5m REAL NOT NULL DEFAULT 0,
  loadavg_15m REAL NOT NULL DEFAULT 0,
  mem_used_pct REAL NOT NULL DEFAULT 0,
  disk_used_pct REAL NOT NULL DEFAULT 0,
  rx_mbps REAL NOT NULL DEFAULT 0,
  tx_mbps REAL NOT NULL DEFAULT 0,
  online_users BIGINT NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_server_metrics_ts ON webos_server_metrics(ts);

-- 2026-08-06 爱发电订单与发货记录（webhook + API 轮询共用；out_trade_no 幂等）
CREATE TABLE IF NOT EXISTS webos_afdian_orders (
  out_trade_no TEXT PRIMARY KEY,
  user_id TEXT,
  plan_id TEXT NOT NULL,
  plan_name TEXT,
  product_type BIGINT NOT NULL DEFAULT 0,
  amount TEXT NOT NULL,
  month BIGINT NOT NULL DEFAULT 1,
  remark TEXT,
  status BIGINT NOT NULL DEFAULT 2,
  channel TEXT NOT NULL DEFAULT 'webhook',
  delivered BIGINT NOT NULL DEFAULT 0,
  delivered_at BIGINT,
  matched_user TEXT,
  match_mode TEXT,
  credits BIGINT NOT NULL DEFAULT 0,
  error TEXT,
  -- 2026-08-12 兑换码商品订单：非空 = 该订单是兑换码发货（用户凭兑换码在个人中心主动兑换）
  redeem_id TEXT,
  raw TEXT,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_afdian_orders_created ON webos_afdian_orders(created_at);
CREATE INDEX IF NOT EXISTS idx_afdian_orders_delivered ON webos_afdian_orders(delivered, created_at);
-- 注意：redeem_id 列与索引由 migrations.ts ensureAfdianRedeemColumn 幂等创建
-- （旧库无该列时 CREATE INDEX 会报 no such column 导致启动崩溃）

-- 2026-08-12 爱发电兑换码本地表（站长在爱发电后台生成兑换码 → 导入本表 →
-- 用户个人中心输入兑换码 → 本地验证发放，不依赖爱发电 API 匹配）
CREATE TABLE IF NOT EXISTS webos_redeem_codes (
  code TEXT PRIMARY KEY,
  plan_id TEXT NOT NULL,
  plan_name TEXT,
  status TEXT NOT NULL DEFAULT 'unused',
  redeemed_by TEXT,
  redeemed_at BIGINT,
  note TEXT,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_redeem_codes_status ON webos_redeem_codes(status);
CREATE INDEX IF NOT EXISTS idx_redeem_codes_plan ON webos_redeem_codes(plan_id);

-- 2026-08-02 生图用量明细（每张图/每次批量请求一行；管理后台监测模型调用是否正常）
CREATE TABLE IF NOT EXISTS webos_imagegen_usage (
  id TEXT PRIMARY KEY,
  user_key TEXT NOT NULL,             -- guest:<deviceId> / user:<userId>
  user_email TEXT,
  kind TEXT NOT NULL DEFAULT 'guest', -- guest / member / plan
  model TEXT NOT NULL,
  prompt TEXT,                        -- 提示词摘要（≤500 字符，避免存超长）
  n INTEGER NOT NULL DEFAULT 1,       -- 请求的图片数量
  images INTEGER NOT NULL DEFAULT 0,  -- 实际成功图片数
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  total_tokens INTEGER NOT NULL DEFAULT 0,
  cost_minor INTEGER NOT NULL DEFAULT 0, -- 按 输入¥16/输出¥60 每百万 token 折算（分）
  status TEXT NOT NULL DEFAULT 'ok',  -- ok / failed / timeout / insufficient
  error_code TEXT,
  duration_ms INTEGER NOT NULL DEFAULT 0, -- 模型调用耗时（监测用）
  ip TEXT,
  created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_webos_imagegen_created ON webos_imagegen_usage(created_at);
CREATE INDEX IF NOT EXISTS idx_webos_imagegen_user ON webos_imagegen_usage(user_key, created_at);
CREATE INDEX IF NOT EXISTS idx_webos_imagegen_status ON webos_imagegen_usage(status);

-- 2026-08-05 视频生成用量明细（MiniMax-H3，秘塔渠道；每个任务一行）
CREATE TABLE IF NOT EXISTS webos_video_usage (
  id TEXT PRIMARY KEY,
  user_key TEXT NOT NULL,
  user_email TEXT,
  kind TEXT NOT NULL DEFAULT 'member',
  model TEXT NOT NULL DEFAULT 'MiniMax-H3',
  task_type TEXT NOT NULL DEFAULT 'generation',
  resolution TEXT NOT NULL DEFAULT '768P',
  duration INTEGER NOT NULL DEFAULT 4,
  image_count INTEGER NOT NULL DEFAULT 0,
  enhance INTEGER NOT NULL DEFAULT 0,
  prompt TEXT,
  task_id TEXT,
  video_path TEXT,
  cost_user_minor INTEGER NOT NULL DEFAULT 0,
  cost_metaso_minor INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'ok',
  error_code TEXT,
  error_message TEXT,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  ip TEXT,
  created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_webos_video_created ON webos_video_usage(created_at);
CREATE INDEX IF NOT EXISTS idx_webos_video_user ON webos_video_usage(user_key, created_at);
CREATE INDEX IF NOT EXISTS idx_webos_video_status ON webos_video_usage(status);

-- 2026-08-05 秘塔/MiniMax 渠道充值记录（站长在秘塔账户充值）
CREATE TABLE IF NOT EXISTS webos_video_recharges (
  id TEXT PRIMARY KEY,
  amount_minor INTEGER NOT NULL,
  note TEXT,
  created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_video_recharges_created ON webos_video_recharges(created_at);

-- panels 表扩展：owner_id（关联 users.id）+ is_community（社区面板标记）
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'panels' AND column_name = 'owner_id') THEN
    ALTER TABLE panels ADD COLUMN owner_id TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'panels' AND column_name = 'is_community') THEN
    ALTER TABLE panels ADD COLUMN is_community BOOLEAN NOT NULL DEFAULT FALSE;
  END IF;
  -- spec §9.4：社区面板可连接外部社区，记录外部社区 API 地址
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'panels' AND column_name = 'community_api_url') THEN
    ALTER TABLE panels ADD COLUMN community_api_url TEXT;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_panels_owner_id ON panels(owner_id);
CREATE INDEX IF NOT EXISTS idx_panels_is_community ON panels(is_community) WHERE is_community = TRUE;

-- widgets 表扩展：is_global（全局组件，所有用户可见）
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'widgets' AND column_name = 'is_global') THEN
    ALTER TABLE widgets ADD COLUMN is_global BOOLEAN NOT NULL DEFAULT FALSE;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_widgets_is_global ON widgets(is_global) WHERE is_global = TRUE;

-- ============================================================================
-- Phase 6：联邦式社区注册表（spec §9 节）
-- 一个 Daily 部署 = 一个平台实例 = 一个社区。
-- communities 表记录本实例已聚合的外部社区（联邦），每条记录指向另一个 Daily 实例的 API 地址。
-- 官方社区列表（is_official=TRUE）由部署者预置；普通用户也可手动添加社区地址。
-- ============================================================================
CREATE TABLE IF NOT EXISTS communities (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  api_url TEXT NOT NULL,
  icon TEXT,
  is_official BOOLEAN NOT NULL DEFAULT FALSE,
  added_by TEXT REFERENCES users(id),
  created_at BIGINT NOT NULL DEFAULT (EXTRACT(EPOCH FROM now()) * 1000)::BIGINT
);
CREATE INDEX IF NOT EXISTS idx_communities_added_by ON communities(added_by);
CREATE INDEX IF NOT EXISTS idx_communities_is_official ON communities(is_official) WHERE is_official = TRUE;
CREATE UNIQUE INDEX IF NOT EXISTS idx_communities_api_url ON communities(api_url);

-- ============================================================================
-- Phase 5：自定义 HTML 组件上传（spec §11.2）
-- 用户/开发者通过 UI 拖拽或 API 上传的纯 HTML 组件，区别于 dynamic_widgets（eval 代码）
-- 字段：
--   id            UUID 主键
--   name          展示名（≤128 字符）
--   description   描述（≤1024 字符）
--   html          HTML 内容（≤5MB，存放完整 HTML 文档或片段）
--   width/height  默认尺寸（用于添加到画布时的初始 w/h）
--   tags          标签数组（用于分类搜索）
--   owner_id      上传者用户 ID（多用户模式；单密码模式为 NULL）
--   is_public     是否公开（admin 上传的可设为公开，所有用户可见）
--   is_global     是否全局组件（仅 admin 可设，标记为 admin 全局可见组件）
--   created_at    创建时间
--   updated_at    更新时间
-- ============================================================================
CREATE TABLE IF NOT EXISTS custom_widgets (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  html TEXT NOT NULL,
  width INTEGER NOT NULL DEFAULT 400,
  height INTEGER NOT NULL DEFAULT 300,
  tags JSONB NOT NULL DEFAULT '[]'::jsonb,
  owner_id TEXT,
  is_public BOOLEAN NOT NULL DEFAULT FALSE,
  is_global BOOLEAN NOT NULL DEFAULT FALSE,
  created_at BIGINT NOT NULL DEFAULT (EXTRACT(EPOCH FROM now()) * 1000)::BIGINT,
  updated_at BIGINT NOT NULL DEFAULT (EXTRACT(EPOCH FROM now()) * 1000)::BIGINT
);

-- custom_widgets 表扩展：is_global（仅 admin 可设，全局可见组件标记）
-- 必须在 CREATE INDEX idx_custom_widgets_is_global 之前执行，
-- 否则老库（custom_widgets 表无 is_global 列）会在 CREATE INDEX 处失败导致整个 SCHEMA_SQL 中断
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'custom_widgets' AND column_name = 'is_global') THEN
    ALTER TABLE custom_widgets ADD COLUMN is_global BOOLEAN NOT NULL DEFAULT FALSE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_custom_widgets_owner_id ON custom_widgets(owner_id);
CREATE INDEX IF NOT EXISTS idx_custom_widgets_is_public ON custom_widgets(is_public) WHERE is_public = TRUE;
CREATE INDEX IF NOT EXISTS idx_custom_widgets_is_global ON custom_widgets(is_global) WHERE is_global = TRUE;
CREATE INDEX IF NOT EXISTS idx_custom_widgets_created_at ON custom_widgets(created_at);

-- ============================================================================
-- Phase 4 Admin：AI 配置管理（spec §10.3）
-- ai_providers：多供应商管理（管理员可配置多个 AI provider，priority 最高的 enabled provider 为默认）
-- search_engines：搜索引擎配置（local/metaso/arxiv/github）
-- ============================================================================

CREATE TABLE IF NOT EXISTS ai_providers (
  id TEXT PRIMARY KEY,
  provider_name TEXT NOT NULL,
  endpoint TEXT,
  model TEXT NOT NULL,
  api_key TEXT NOT NULL,
  priority INTEGER NOT NULL DEFAULT 0,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at BIGINT NOT NULL DEFAULT (EXTRACT(EPOCH FROM now()) * 1000)::BIGINT,
  updated_at BIGINT NOT NULL DEFAULT (EXTRACT(EPOCH FROM now()) * 1000)::BIGINT
);
CREATE INDEX IF NOT EXISTS idx_ai_providers_priority ON ai_providers(priority DESC);
CREATE INDEX IF NOT EXISTS idx_ai_providers_enabled ON ai_providers(enabled) WHERE enabled = TRUE;

CREATE TABLE IF NOT EXISTS search_engines (
  name TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at BIGINT NOT NULL DEFAULT (EXTRACT(EPOCH FROM now()) * 1000)::BIGINT
);

-- 种子数据：3 个默认搜索引擎（2026-08-17：移除秘塔/GitHub，web 改用 Exa）
INSERT INTO search_engines (name, display_name, enabled, config) VALUES
  ('local', '本地搜索', TRUE, '{}'::jsonb),
  ('exa', 'Exa 搜索', TRUE, '{}'::jsonb),
  ('arxiv', '学术搜索(ArXiv)', TRUE, '{}'::jsonb)
ON CONFLICT (name) DO NOTHING;
`

export async function initializeSchema(): Promise<void> {
  // SQLite 模式：委托给 schema-sqlite.ts
  if (USE_SQLITE) {
    return initializeSqliteSchema()
  }

  // PG 模式：原有逻辑
  const pool = getPool()

  // 执行 DDL（CREATE TABLE IF NOT EXISTS 是幂等的）
  await pool.query(SCHEMA_SQL)

  // 初始化或升级 schema 版本
  const result = await pool.query("SELECT version FROM schema_version WHERE key = 'current'")
  const currentVersion = result.rows[0]?.version ?? 0

  if (currentVersion === 0) {
    await pool.query("INSERT INTO schema_version (key, version) VALUES ('current', 1)")
  }

  console.log('[Schema] PostgreSQL schema initialized, version:', currentVersion || 1)
}
