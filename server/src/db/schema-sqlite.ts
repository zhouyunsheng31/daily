// ============================================================================
// C1 SQLite 改造：SQLite schema（22+ 张表 DDL）
//
// 转换规则：
// - JSONB → TEXT
// - BIGSERIAL → INTEGER PRIMARY KEY AUTOINCREMENT
// - BIGINT[] / TEXT[] → TEXT（JSON 序列化）
// - EXTRACT(EPOCH FROM now())::BIGINT * 1000 → 移除默认值（应用层 Date.now() 填充）
// - ::jsonb 类型转换 → 删除
// - DO $$ ... END $$ 幂等 ALTER → PRAGMA table_info() 检查列是否存在
// - BOOLEAN → INTEGER（0/1）
// - DOUBLE PRECISION → REAL
// - VARCHAR(N) → TEXT（SQLite 忽略长度）
// - DEFAULT FALSE/TRUE → DEFAULT 0/1
// ============================================================================

import type { SqliteDatabase } from './sqlite-compat.js'
import { getPool, getDbInstance } from './connection-sqlite.js'

// ---------------------------------------------------------------------------
// DDL：表结构定义
// ---------------------------------------------------------------------------

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS panels (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL DEFAULT '未命名',
  sort_order INTEGER NOT NULL DEFAULT 0,
  settings TEXT NOT NULL DEFAULT '{}',
  canvas_transform TEXT,
  created_at INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS widgets (
  id TEXT PRIMARY KEY,
  panel_id TEXT NOT NULL REFERENCES panels(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  x REAL NOT NULL DEFAULT 0,
  y REAL NOT NULL DEFAULT 0,
  width REAL NOT NULL DEFAULT 300,
  height REAL NOT NULL DEFAULT 200,
  z_index INTEGER NOT NULL DEFAULT 0,
  minimized INTEGER NOT NULL DEFAULT 0,
  locked INTEGER NOT NULL DEFAULT 0,
  color_scheme TEXT,
  state TEXT NOT NULL DEFAULT '{}',
  is_primary INTEGER NOT NULL DEFAULT 0,
  version INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_widgets_panel_id ON widgets(panel_id);
CREATE INDEX IF NOT EXISTS idx_widgets_type ON widgets(type);

CREATE TABLE IF NOT EXISTS entities (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  scope TEXT NOT NULL DEFAULT 'default',
  panel_id TEXT,
  widget_id TEXT,
  data TEXT NOT NULL DEFAULT '{}',
  record_status TEXT NOT NULL DEFAULT 'active',
  version INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL DEFAULT 0
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
  metadata TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_relations_source ON entity_relations(source_id);
CREATE INDEX IF NOT EXISTS idx_relations_target ON entity_relations(target_id);
CREATE INDEX IF NOT EXISTS idx_relations_type ON entity_relations(type);
CREATE UNIQUE INDEX IF NOT EXISTS idx_relations_unique ON entity_relations(source_id, target_id, type);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL DEFAULT '{}',
  updated_at INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS dynamic_widgets (
  widget_type TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  icon TEXT NOT NULL DEFAULT 'box',
  default_layout TEXT NOT NULL DEFAULT '{}',
  default_state TEXT NOT NULL DEFAULT '{}',
  code TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS panel_templates (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  icon TEXT NOT NULL DEFAULT 'layout',
  description TEXT NOT NULL DEFAULT '',
  widgets TEXT NOT NULL DEFAULT '[]',
  is_builtin INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS activity_sessions (
  id TEXT PRIMARY KEY,
  started_at INTEGER NOT NULL,
  ended_at INTEGER NOT NULL,
  duration_ms INTEGER NOT NULL,
  process_name TEXT NOT NULL,
  window_title TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT 'other',
  site_name TEXT,
  url TEXT,
  is_browser INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT 0
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
CREATE TABLE IF NOT EXISTS sync_queue (
  id TEXT PRIMARY KEY,
  device_id TEXT NOT NULL,
  operation TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  payload TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT 0,
  retry_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT
);
CREATE INDEX IF NOT EXISTS idx_sync_queue_device ON sync_queue(device_id);
CREATE INDEX IF NOT EXISTS idx_sync_queue_created ON sync_queue(created_at);

-- ============================================================================
-- Phase 4：AI 上下文 + 配置 + Skills
-- ============================================================================

-- AI 对话历史（按面板）
CREATE TABLE IF NOT EXISTS ai_conversations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  panel_id TEXT NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  tool_calls TEXT,
  tool_result TEXT,
  device_id TEXT,
  summarized INTEGER NOT NULL DEFAULT 0,
  summary_of TEXT,
  retention_level TEXT NOT NULL DEFAULT 'full',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_ai_conv_panel_created ON ai_conversations(panel_id, created_at);

-- AI 记忆（按面板，长期记忆）
CREATE TABLE IF NOT EXISTS ai_memories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  panel_id TEXT NOT NULL,
  memory_type TEXT,
  content TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ai_mem_panel ON ai_memories(panel_id);

-- AI 设置（键值存储）
CREATE TABLE IF NOT EXISTS ai_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

-- 用户自定义 skills
CREATE TABLE IF NOT EXISTS user_skills (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  content TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- 工具启用状态
CREATE TABLE IF NOT EXISTS tool_settings (
  tool_name TEXT PRIMARY KEY,
  enabled INTEGER NOT NULL DEFAULT 1,
  updated_at INTEGER NOT NULL
);

-- Skill 启用状态（从 tool_settings 拆分）
CREATE TABLE IF NOT EXISTS skill_settings (
  skill_id TEXT PRIMARY KEY,
  enabled INTEGER DEFAULT 1,
  updated_at INTEGER NOT NULL
);

-- ============================================================================
-- Phase 5：收藏组件
-- ============================================================================

CREATE TABLE IF NOT EXISTS favorited_widgets (
  id TEXT PRIMARY KEY,
  widget_id TEXT NOT NULL,
  panel_id TEXT NOT NULL,
  widget_type TEXT NOT NULL,
  display_name TEXT NOT NULL,
  position_snapshot TEXT NOT NULL,
  state_snapshot TEXT NOT NULL DEFAULT '{}',
  device_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (widget_id)
);
CREATE INDEX IF NOT EXISTS idx_favorited_widgets_panel_id ON favorited_widgets(panel_id);

-- ============================================================================
-- Phase 6.2：本地服务注册表
-- ============================================================================

CREATE TABLE IF NOT EXISTS local_service_registry (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id TEXT NOT NULL,
  service_name TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  description TEXT,
  online INTEGER NOT NULL DEFAULT 0,
  last_heartbeat INTEGER,
  registered_at INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL DEFAULT 0,
  UNIQUE (device_id, service_name)
);
CREATE INDEX IF NOT EXISTS idx_local_service_device ON local_service_registry(device_id);
CREATE INDEX IF NOT EXISTS idx_local_service_online ON local_service_registry(online);

-- ============================================================================
-- Phase 6.1：面板内存休眠状态
-- ============================================================================

CREATE TABLE IF NOT EXISTS panel_memory_states (
  panel_id TEXT PRIMARY KEY REFERENCES panels(id) ON DELETE CASCADE,
  saved_state TEXT NOT NULL DEFAULT '{}',
  saved_at INTEGER NOT NULL DEFAULT 0
);

-- ============================================================================
-- Phase S9：AI 搜索工具 API 调用日志
-- ============================================================================

CREATE TABLE IF NOT EXISTS api_usage_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 1,
  latency_ms INTEGER,
  status TEXT NOT NULL,
  error_msg TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_api_usage_log_provider_time ON api_usage_log(provider, created_at);

-- ============================================================================
-- Phase 14.4：组件能力声明表
-- ============================================================================

CREATE TABLE IF NOT EXISTS component_capabilities (
  widget_type TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  api TEXT NOT NULL DEFAULT '[]',
  dependencies TEXT NOT NULL DEFAULT '[]',
  version TEXT NOT NULL DEFAULT '1.0.0',
  component_env TEXT NOT NULL DEFAULT 'pure-frontend',
  cross_platform INTEGER NOT NULL DEFAULT 1,
  desktop_only INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL DEFAULT 0
);

-- ============================================================================
-- Phase S3 缺口 A：实体冲突日志
-- ============================================================================

CREATE TABLE IF NOT EXISTS entity_conflict_logs (
  id TEXT PRIMARY KEY,
  entity_id TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  panel_id TEXT,
  local_version INTEGER NOT NULL,
  remote_version INTEGER NOT NULL,
  local_state TEXT,
  remote_state TEXT,
  source_device_id TEXT,
  resolved INTEGER NOT NULL DEFAULT 0,
  resolved_action TEXT,
  resolved_at INTEGER,
  created_at INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_entity_conflict_logs_entity ON entity_conflict_logs(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_entity_conflict_logs_panel_id ON entity_conflict_logs(panel_id);
-- SQLite 部分索引：WHERE resolved = 0（对应 PG 的 WHERE resolved = FALSE）
CREATE INDEX IF NOT EXISTS idx_entity_conflict_logs_resolved ON entity_conflict_logs(resolved) WHERE resolved = 0;
CREATE INDEX IF NOT EXISTS idx_entity_conflict_logs_created_at ON entity_conflict_logs(created_at);

-- ============================================================================
-- Phase S3 缺口 B：sync_logs 服务器端持久化
-- ============================================================================

CREATE TABLE IF NOT EXISTS sync_logs (
  id TEXT PRIMARY KEY,
  device_id TEXT NOT NULL,
  operation TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  payload TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  retry_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL DEFAULT 0,
  next_retry_at INTEGER
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
  is_banned INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT 0,
  last_login_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
CREATE INDEX IF NOT EXISTS idx_users_is_banned ON users(is_banned);

-- 2026-08-02 账号系统：注册/登录 IP（防批量注册；旧库列由 ensureUserIpColumns 迁移）
-- ALTER TABLE users ADD COLUMN registered_ip TEXT;
-- ALTER TABLE users ADD COLUMN last_login_ip TEXT;

-- 2026-08-02 AI 用量明细（new-api 风格：每个请求一行；管理后台统计/审计用）
CREATE TABLE IF NOT EXISTS webos_ai_usage (
  id TEXT PRIMARY KEY,
  user_key TEXT NOT NULL,
  user_email TEXT,
  kind TEXT NOT NULL DEFAULT 'guest',
  model TEXT NOT NULL,
  thinking TEXT NOT NULL,
  prompt_tokens INTEGER NOT NULL DEFAULT 0,
  completion_tokens INTEGER NOT NULL DEFAULT 0,
  total_tokens INTEGER NOT NULL DEFAULT 0,
  cost_minor INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'ok',
  error_code TEXT,
  ip TEXT,
  created_at INTEGER NOT NULL
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
  thinking TEXT,                     -- 思考档（low/medium/high/max/off）
  rebuild INTEGER NOT NULL DEFAULT 0, -- 1 = 编辑/回退重来
  status TEXT NOT NULL DEFAULT 'ok',  -- ok / failed / empty_response / insufficient
  error_code TEXT,
  prompt_tokens INTEGER NOT NULL DEFAULT 0,
  completion_tokens INTEGER NOT NULL DEFAULT 0,
  total_tokens INTEGER NOT NULL DEFAULT 0,
  cost_minor INTEGER NOT NULL DEFAULT 0,
  ip TEXT,
  created_at INTEGER NOT NULL
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
  created_at INTEGER NOT NULL,     -- 请求开始
  ended_at INTEGER NOT NULL        -- 请求结束（落库时间）
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
  description TEXT,                -- 视觉模型返回的描述（≤500 字符，审计用）
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
  created_at INTEGER NOT NULL
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
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'published'
);
CREATE INDEX IF NOT EXISTS idx_store_apps_owner ON webos_store_apps(owner_key, status);
CREATE INDEX IF NOT EXISTS idx_store_apps_status ON webos_store_apps(status, created_at);

-- 2026-08-03 分享访问：别人通过分享链接进入并登录 → 分享者 +100 积分
CREATE TABLE IF NOT EXISTS webos_store_visits (
  id TEXT PRIMARY KEY,
  share_id TEXT NOT NULL REFERENCES webos_store_apps(id) ON DELETE CASCADE,
  visitor_key TEXT NOT NULL,       -- 访问者（游客 deviceId / 用户 key）
  owner_key TEXT NOT NULL,         -- 分享者
  status TEXT NOT NULL DEFAULT 'visited', -- visited → credited
  created_at INTEGER NOT NULL,
  credited_at INTEGER
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_store_visits_unique ON webos_store_visits(share_id, visitor_key);

-- 2026-08-03 商店下载：他人安装你的应用 → 你 +100 积分（一个用户对一个应用最多一次）
CREATE TABLE IF NOT EXISTS webos_store_installs (
  id TEXT PRIMARY KEY,
  share_id TEXT NOT NULL REFERENCES webos_store_apps(id) ON DELETE CASCADE,
  installer_key TEXT NOT NULL,
  owner_key TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_store_installs_unique ON webos_store_installs(share_id, installer_key);

-- 2026-08-18 技能市场发布：用户把自己工作区 skills/<skill_id>/ 发布到市场（他人可安装）
CREATE TABLE IF NOT EXISTS webos_store_skills (
  id TEXT PRIMARY KEY,             -- 条目 id（sk- 前缀，市场列表/安装/下架用）
  skill_id TEXT NOT NULL,          -- 发布时的技能目录名（安装到用户工作区 skills/<skill_id>/）
  owner_key TEXT NOT NULL,         -- 发布者（guest:<deviceId> / user:<userId>）
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  size_bytes INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'published'
);
CREATE INDEX IF NOT EXISTS idx_store_skills_owner ON webos_store_skills(owner_key, status);
CREATE INDEX IF NOT EXISTS idx_store_skills_status ON webos_store_skills(status, created_at);

-- 2026-08-06 服务器负载历史（每分钟一条，保留 30 天；管理后台趋势图 + AI 追溯查询）
CREATE TABLE IF NOT EXISTS webos_server_metrics (
  id TEXT PRIMARY KEY,
  ts INTEGER NOT NULL,
  cpu_usage REAL NOT NULL DEFAULT 0,
  loadavg_1m REAL NOT NULL DEFAULT 0,
  loadavg_5m REAL NOT NULL DEFAULT 0,
  loadavg_15m REAL NOT NULL DEFAULT 0,
  mem_used_pct REAL NOT NULL DEFAULT 0,
  disk_used_pct REAL NOT NULL DEFAULT 0,
  rx_mbps REAL NOT NULL DEFAULT 0,
  tx_mbps REAL NOT NULL DEFAULT 0,
  online_users INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_server_metrics_ts ON webos_server_metrics(ts);

-- 2026-08-06 爱发电订单与发货记录（webhook + API 轮询共用；out_trade_no 幂等）
CREATE TABLE IF NOT EXISTS webos_afdian_orders (
  out_trade_no TEXT PRIMARY KEY,       -- 爱发电订单号（幂等键）
  user_id TEXT,                        -- 爱发电下单用户 ID
  plan_id TEXT NOT NULL,               -- 档位 plan_id
  plan_name TEXT,                      -- 档位名（发货时解析）
  product_type INTEGER NOT NULL DEFAULT 0, -- 0=订阅 1=售卖商品
  amount TEXT NOT NULL,                -- 实付金额
  month INTEGER NOT NULL DEFAULT 1,
  remark TEXT,                         -- 留言（用户填的注册邮箱）
  status INTEGER NOT NULL DEFAULT 2,   -- 爱发电订单状态（2=交易成功）
  channel TEXT NOT NULL DEFAULT 'webhook', -- webhook / api
  delivered INTEGER NOT NULL DEFAULT 0,    -- 是否已发货
  delivered_at INTEGER,
  matched_user TEXT,                   -- 匹配到的 Daily 账号（user:xxx / guest:xxx）
  match_mode TEXT,                     -- email / manual / none / redeem
  credits INTEGER NOT NULL DEFAULT 0,  -- 发放积分
  error TEXT,                          -- 发货失败原因
  -- 2026-08-12 兑换码商品订单：非空 = 该订单是兑换码发货（用户凭兑换码在个人中心主动兑换）
  redeem_id TEXT,
  raw TEXT,                            -- 原始回调 JSON（截断）
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_afdian_orders_created ON webos_afdian_orders(created_at);
CREATE INDEX IF NOT EXISTS idx_afdian_orders_delivered ON webos_afdian_orders(delivered, created_at);
-- 注意：redeem_id 列与索引由 migrations.ts ensureAfdianRedeemColumn 幂等创建
-- （旧库无该列时 CREATE INDEX 会报 no such column 导致启动崩溃）

-- 2026-08-12 爱发电兑换码本地表（站长在爱发电后台生成兑换码 → 导入本表 →
-- 用户个人中心输入兑换码 → 本地验证发放，不依赖爱发电 API 匹配）
CREATE TABLE IF NOT EXISTS webos_redeem_codes (
  code TEXT PRIMARY KEY,               -- 兑换码（爱发电后台生成）
  plan_id TEXT NOT NULL,               -- 对应档位 plan_id
  plan_name TEXT,                      -- 档位名（冗余，方便管理后台显示）
  status TEXT NOT NULL DEFAULT 'unused', -- unused / used / revoked
  redeemed_by TEXT,                    -- 兑换人（user:xxx）
  redeemed_at INTEGER,
  note TEXT,                           -- 备注（批次/来源）
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
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
-- cost_user_minor：用户扣费（按 MiniMax 官方刊例价 2K ¥0.80/秒、768P ¥0.50/秒）
-- cost_metaso_minor：后台成本（按秘塔渠道价 2K ¥0.15/秒、768P ¥0.09/秒）
CREATE TABLE IF NOT EXISTS webos_video_usage (
  id TEXT PRIMARY KEY,
  user_key TEXT NOT NULL,             -- guest:<deviceId> / user:<userId>
  user_email TEXT,
  kind TEXT NOT NULL DEFAULT 'member',-- guest / member / plan
  model TEXT NOT NULL DEFAULT 'MiniMax-H3',
  task_type TEXT NOT NULL DEFAULT 'generation', -- generation / h3_context_ir
  resolution TEXT NOT NULL DEFAULT '768P',      -- 768P / 2K
  duration INTEGER NOT NULL DEFAULT 4,          -- 生成时长（秒）
  image_count INTEGER NOT NULL DEFAULT 0,       -- 输入图片数量（超出 5 张计费）
  enhance INTEGER NOT NULL DEFAULT 0,           -- 是否启用 H3-Context-IR 增强
  prompt TEXT,                                  -- 提示词摘要（≤500 字符）
  task_id TEXT,
  video_path TEXT,                              -- 工作区相对路径 agent/videos/xxx.mp4
  cost_user_minor INTEGER NOT NULL DEFAULT 0,   -- 用户扣费（官方价，分）
  cost_metaso_minor INTEGER NOT NULL DEFAULT 0, -- 后台成本（秘塔价，分）
  status TEXT NOT NULL DEFAULT 'ok',            -- ok / failed / timeout / insufficient / rejected
  error_code TEXT,
  error_message TEXT,                           -- 失败/降级详情（渠道原始 message，2026-08-08 补列）
  duration_ms INTEGER NOT NULL DEFAULT 0,       -- 任务总耗时（监测用）
  ip TEXT,
  created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_webos_video_created ON webos_video_usage(created_at);
CREATE INDEX IF NOT EXISTS idx_webos_video_user ON webos_video_usage(user_key, created_at);
CREATE INDEX IF NOT EXISTS idx_webos_video_status ON webos_video_usage(status);

-- 2026-08-05 秘塔/MiniMax 渠道充值记录（站长在秘塔账户充值；管理后台统计「充了多少 / 花了多少」）
CREATE TABLE IF NOT EXISTS webos_video_recharges (
  id TEXT PRIMARY KEY,
  amount_minor INTEGER NOT NULL,      -- 充值金额（分）
  note TEXT,                          -- 备注（如「秘塔充值 100 元」）
  created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_video_recharges_created ON webos_video_recharges(created_at);

-- Phase 6：联邦式社区注册表（spec §9 节）
-- 与 PG schema 对应：BOOLEAN→INTEGER，BIGINT→INTEGER
CREATE TABLE IF NOT EXISTS communities (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  api_url TEXT NOT NULL,
  icon TEXT,
  is_official INTEGER NOT NULL DEFAULT 0,
  added_by TEXT,
  created_at INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_communities_added_by ON communities(added_by);
CREATE INDEX IF NOT EXISTS idx_communities_is_official ON communities(is_official) WHERE is_official = 1;
CREATE UNIQUE INDEX IF NOT EXISTS idx_communities_api_url ON communities(api_url);

-- ============================================================================
-- Phase 5：自定义上传组件（custom_widgets 表，与 PG schema 对应）
-- BOOLEAN→INTEGER，JSONB→TEXT，BIGINT→INTEGER
-- ============================================================================

CREATE TABLE IF NOT EXISTS custom_widgets (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  html TEXT NOT NULL,
  width INTEGER NOT NULL DEFAULT 400,
  height INTEGER NOT NULL DEFAULT 300,
  tags TEXT NOT NULL DEFAULT '[]',
  owner_id TEXT,
  is_public INTEGER NOT NULL DEFAULT 0,
  is_global INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_custom_widgets_owner_id ON custom_widgets(owner_id);
CREATE INDEX IF NOT EXISTS idx_custom_widgets_is_public ON custom_widgets(is_public) WHERE is_public = 1;
-- 注意：idx_custom_widgets_is_global 索引在 addColumnIfNotExists 之后创建（见 initializeSchema）
-- 避免老库 custom_widgets 表无 is_global 列时 CREATE INDEX 失败导致整个 SCHEMA_SQL 中断
CREATE INDEX IF NOT EXISTS idx_custom_widgets_created_at ON custom_widgets(created_at);

-- ============================================================================
-- Phase 4 Admin：AI 配置管理（spec §10.3）
-- ai_providers：多供应商管理（BOOLEAN→INTEGER，BIGINT→INTEGER）
-- search_engines：搜索引擎配置（local/metaso/arxiv/github）
-- ============================================================================

CREATE TABLE IF NOT EXISTS ai_providers (
  id TEXT PRIMARY KEY,
  provider_name TEXT NOT NULL,
  endpoint TEXT,
  model TEXT NOT NULL,
  api_key TEXT NOT NULL,
  priority INTEGER NOT NULL DEFAULT 0,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_ai_providers_priority ON ai_providers(priority DESC);
CREATE INDEX IF NOT EXISTS idx_ai_providers_enabled ON ai_providers(enabled) WHERE enabled = 1;

CREATE TABLE IF NOT EXISTS search_engines (
  name TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  config TEXT NOT NULL DEFAULT '{}',
  updated_at INTEGER NOT NULL DEFAULT 0
);
`

// ---------------------------------------------------------------------------
// 幂等 ALTER：用 PRAGMA table_info() 检查列是否存在
// ---------------------------------------------------------------------------

/**
 * 检查表中是否已存在指定列
 */
function columnExists(db: SqliteDatabase, tableName: string, columnName: string): boolean {
  const rows = db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>
  return rows.some(r => r.name === columnName)
}

/**
 * 幂等地为表添加列（若列已存在则跳过）
 */
function addColumnIfNotExists(
  db: SqliteDatabase,
  tableName: string,
  columnName: string,
  columnDef: string
): void {
  if (!columnExists(db, tableName, columnName)) {
    db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${columnDef}`)
    console.log(`[Schema] Added column ${tableName}.${columnName}`)
  }
}

/**
 * 幂等创建索引（若索引已存在则跳过）
 * 用于依赖 ALTER TABLE 之后才存在的列的索引创建
 */
function createIndexIfNotExists(
  db: SqliteDatabase,
  indexName: string,
  indexDef: string
): void {
  try {
    db.exec(`CREATE INDEX IF NOT EXISTS ${indexName} ON ${indexDef}`)
  } catch (err) {
    // 列可能仍不存在（极端情况），仅记录不中断启动
    console.warn(`[Schema] createIndex ${indexName} skipped:`, err instanceof Error ? err.message : String(err))
  }
}

// ---------------------------------------------------------------------------
// 迁移：skill_settings 从 tool_settings 拆分（幂等）
// ---------------------------------------------------------------------------

/**
 * 迁移历史 skill 启用状态从 tool_settings 到 skill_settings（幂等）
 * 只迁移 builtin: 和 user: 前缀的记录，不误迁工具记录
 *
 * 对应 PG schema.ts 中的 DO $$ ... END $$ 块
 */
function migrateSkillSettings(db: SqliteDatabase): void {
  // 检查 tool_settings 表是否存在（首次初始化时可能为空）
  try {
    db.exec(`
      INSERT INTO skill_settings (skill_id, enabled, updated_at)
      SELECT tool_name, enabled, updated_at FROM tool_settings
      WHERE tool_name LIKE 'builtin:%' OR tool_name LIKE 'user:%'
      ON CONFLICT (skill_id) DO NOTHING;
    `)
    // 清理 tool_settings 表中的 skill 记录（保留工具记录）
    db.exec(`
      DELETE FROM tool_settings WHERE tool_name LIKE 'builtin:%' OR tool_name LIKE 'user:%';
    `)
  } catch (err) {
    // 首次初始化时 tool_settings 不存在或为空，忽略
    console.log('[Schema] skill_settings migration skipped:', err instanceof Error ? err.message : String(err))
  }
}

// ---------------------------------------------------------------------------
// 清理旧 Bocha / Semantic Scholar Key 残留（幂等）
// ---------------------------------------------------------------------------

function cleanupOldSearchKeys(db: SqliteDatabase): void {
  try {
    db.prepare("DELETE FROM ai_settings WHERE key IN ('searchKey.bocha', 'search_key_bocha')").run()
    db.prepare("DELETE FROM ai_settings WHERE key IN ('searchKey.semanticScholar', 'search_key_semantic_scholar')").run()
  } catch (err) {
    console.log('[Schema] search key cleanup skipped:', err instanceof Error ? err.message : String(err))
  }
}

// ---------------------------------------------------------------------------
// 种子数据：3 个默认搜索引擎（spec §10.3，幂等；2026-08-17：移除秘塔/GitHub，web 改用 Exa）
// ---------------------------------------------------------------------------

function seedSearchEngines(db: SqliteDatabase): void {
  const engines = [
    { name: 'local', display_name: '本地搜索', enabled: 1, config: '{}' },
    { name: 'exa', display_name: 'Exa 搜索', enabled: 1, config: '{}' },
    { name: 'arxiv', display_name: '学术搜索(ArXiv)', enabled: 1, config: '{}' },
  ]
  const now = Date.now()
  for (const e of engines) {
    try {
      db.prepare(
        `INSERT OR IGNORE INTO search_engines (name, display_name, enabled, config, updated_at) VALUES (?, ?, ?, ?, ?)`,
      ).run(e.name, e.display_name, e.enabled, e.config, now)
    } catch (err) {
      console.warn('[Schema] seedSearchEngines skipped:', err instanceof Error ? err.message : String(err))
    }
  }
}

// ---------------------------------------------------------------------------
// 初始化 schema
// ---------------------------------------------------------------------------

export async function initializeSchema(): Promise<void> {
  // [server-boot] 诊断日志（保留便于未来排查启动卡点）
  const t0 = Date.now()
  const logStep = (label: string): void => {
    console.error(`[server-boot] +${Date.now() - t0}ms [sqlite-schema] ${label}`)
  }

  logStep('entry')
  const pool = getPool()

  // 执行 DDL（CREATE TABLE IF NOT EXISTS 是幂等的）
  logStep('before SCHEMA_SQL exec')
  await pool.query(SCHEMA_SQL)
  logStep('SCHEMA_SQL exec done')

  // 获取底层 SQLite 实例用于幂等 ALTER
  const db = getDbInstance()

  // dynamic_widgets 扩展列（架构文档 6.4 + 12.3）
  addColumnIfNotExists(db, 'dynamic_widgets', 'component_env', "TEXT NOT NULL DEFAULT 'pure-frontend'")
  addColumnIfNotExists(db, 'dynamic_widgets', 'local_services', 'TEXT')
  addColumnIfNotExists(db, 'dynamic_widgets', 'cross_platform', 'INTEGER NOT NULL DEFAULT 1')
  addColumnIfNotExists(db, 'dynamic_widgets', 'desktop_only', 'INTEGER NOT NULL DEFAULT 0')
  logStep('dynamic_widgets ALTER done')

  // api_usage_log 新增 credits_consumed 列（spec 2.7.5 节）
  addColumnIfNotExists(db, 'api_usage_log', 'credits_consumed', 'INTEGER')

  // api_usage_log 新增 user_key/query/tool 列（2026-08-17 搜索 API 状态可视化）
  addColumnIfNotExists(db, 'api_usage_log', 'user_key', 'TEXT')
  addColumnIfNotExists(db, 'api_usage_log', 'query', 'TEXT')
  addColumnIfNotExists(db, 'api_usage_log', 'tool', 'TEXT')
  createIndexIfNotExists(db, 'idx_api_usage_log_tool_time', 'api_usage_log(tool, created_at)')

  // entity_conflict_logs 补加 panel_id 列（已部署 DB 兼容）
  addColumnIfNotExists(db, 'entity_conflict_logs', 'panel_id', 'TEXT')

  // Phase 4：panels 表扩展 owner_id + is_community；widgets 表扩展 is_global
  addColumnIfNotExists(db, 'panels', 'owner_id', 'TEXT')
  addColumnIfNotExists(db, 'panels', 'is_community', 'INTEGER NOT NULL DEFAULT 0')
  // spec §9.4：社区面板可连接外部社区，记录外部社区 API 地址
  addColumnIfNotExists(db, 'panels', 'community_api_url', 'TEXT')
  addColumnIfNotExists(db, 'widgets', 'is_global', 'INTEGER NOT NULL DEFAULT 0')
  // custom_widgets 表扩展 is_global（仅 admin 可设，全局可见组件标记）
  addColumnIfNotExists(db, 'custom_widgets', 'is_global', 'INTEGER NOT NULL DEFAULT 0')

  // is_global 索引必须在 addColumnIfNotExists 之后创建（老库 custom_widgets 表可能无 is_global 列）
  // 放在 SCHEMA_SQL 中会导致整个批量 DDL 失败，从而 addColumnIfNotExists 永远没有机会执行
  createIndexIfNotExists(db, 'idx_custom_widgets_is_global', 'custom_widgets(is_global) WHERE is_global = 1')
  createIndexIfNotExists(db, 'idx_widgets_is_global', 'widgets(is_global) WHERE is_global = 1')
  logStep('all ALTER done')

  // 迁移 skill_settings
  migrateSkillSettings(db)
  logStep('migrateSkillSettings done')

  // 清理旧 search key
  cleanupOldSearchKeys(db)
  logStep('cleanupOldSearchKeys done')

  // 种子默认搜索引擎（spec §10.3）
  seedSearchEngines(db)
  logStep('seedSearchEngines done')

  // 初始化或升级 schema 版本
  const result = await pool.query("SELECT version FROM schema_version WHERE key = 'current'")
  const currentVersion = (result.rows[0]?.version as number) ?? 0

  if (currentVersion === 0) {
    await pool.query("INSERT INTO schema_version (key, version) VALUES ('current', 1)")
  }

  console.log('[Schema] SQLite schema initialized, version:', currentVersion || 1)
  logStep('done')
}
