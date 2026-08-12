# Phase 3 服务器化（Serverization）实施 Spec

> **文档版本**：v1.1
> **创建日期**：2026-06-24
> **状态**：待实施
> **前置阶段**：Phase 0（Electron + Vite + React）、Phase 1（大清洗）、Phase 2（浏览器引擎集成）

---

## 一、目标与范围

### 1.1 目标

1. **Docker 本地部署**：用 Docker Compose 在本地部署 Pi Agent + PostgreSQL + WS 网关，模拟远程服务器环境
2. **PostgreSQL 迁移**：数据库从 SQLite 迁移到 PostgreSQL 16
3. **多端 WS 网关**：WS 从单客户端扩展为多客户端，支持局域网多端互通
4. **后续可部署上线**：Docker 化后随时可部署到远程服务器（用户后续可通过内网穿透/公网 IP 实现远程访问）

### 1.2 范围

**包含**：
- 服务器端 SQLite → PostgreSQL 迁移（含 schema、连接层、所有路由 handler）
- WS 网关多客户端化（含认证、路由、广播、心跳）
- Pi Agent 单 session 共享模式 + 模型可配置
- 客户端 HTTP/WS 配置化 + 认证 + deviceId + 数据同步（syncQueue）
- Docker 部署（Dockerfile + docker-compose.yml + .env.example）
- 局域网多端互通验证

**不包含**（明确排除）：
- 用户系统/多用户（Phase 4+）
- per-device agent session（后续扩展）
- 内网穿透配置（用户自行处理 frp/ngrok）
- 安卓端（Phase 4）
- 计算机操作（Phase 5）

### 1.3 现状基线

| 维度 | 现状 | Phase 3 目标 |
|------|------|--------------|
| 数据库 | SQLite（better-sqlite3，同步） | PostgreSQL 16（pg，异步 Pool） |
| WS | 单客户端（currentClient） | 多客户端（Map<deviceId, WebSocket>） |
| 认证 | 无 | 共享 token（SERVER_TOKEN） |
| Pi Agent session | 单全局 session | 单全局 session（共享，不变） |
| Pi Agent 模型 | 硬编码 stepfun/step-3.7-flash | 环境变量可配置 |
| 客户端 HTTP baseURL | 硬编码 `/api` | 可配置 `VITE_API_BASE_URL` |
| 客户端 WS URL | 可配置 `VITE_WS_URL` | 基础 URL 不变，连接 URL 增加 deviceId+token 参数 |
| 客户端 deviceId | 无 | localStorage 持久化 UUID |
| 数据同步 | withFallback（无回写） | withFallback + syncQueue 回写 |
| 部署 | 本地 npm run dev | Docker Compose |
| 数据卷 | C 盘外（F:\allmylife\event\data） | Docker volume（非 C 盘） |

---

## 二、技术决策

### 2.1 数据库迁移策略

**决策**：PostgreSQL 16 + pg（node-postgres）+ 手写 SQL（不引入 ORM）

**理由**：
1. 现有代码全部是手写 SQL（`db.prepare('SELECT...').all()`），引入 ORM（如 Prisma/TypeORM）会重写所有路由，成本过高
2. pg 是 Node.js 生态最成熟的 PG 驱动，Pool 连接池适合多客户端并发
3. PostgreSQL 16 是当前稳定版本，Docker 官方镜像可用
4. JSONB 类型比 SQLite TEXT 存储 JSON 更高效（支持索引查询）
5. 保留毫秒时间戳（BIGINT）而非 TIMESTAMPTZ，减少迁移成本（前端代码不需要改时间处理逻辑）

**客户端策略**：
- 保留 IndexedDB 作为离线缓存（32 个 store 不变）
- withFallback 机制保留：API 优先，IDB 降级
- 新增 syncQueue：API 不可用时写 IDB + 队列，恢复后批量回写

### 2.2 WS 多客户端策略

**决策**：Map<deviceId, WebSocket> + 共享 token 认证 + 单 session 共享

**理由**：
1. 现有 WS 是单客户端（`currentClient: WebSocket | null`），多客户端需要改为 Map
2. deviceId 标识每个 Electron 客户端（localStorage 持久化 UUID）
3. 单 session 共享：所有客户端共享一个 Pi Agent session（简化版），后续扩展为 per-device session
4. 工具调用按 deviceId 路由：browser_* 工具必须发到对应设备的 webview（每个设备有自己的活跃 webview）
5. 画布工具（create/update/delete_html_widget、storage_read/write、list_widgets）在服务器端执行或广播

### 2.3 认证策略

**决策**：共享 token（环境变量 SERVER_TOKEN）+ 无用户系统

**理由**：
1. 单用户多设备场景，不需要用户系统
2. 共享 token 简单可靠，防止局域网内未授权设备连接
3. HTTP 请求头 `Authorization: Bearer <token>`
4. WS 连接时携带 token + deviceId（query 参数）

### 2.4 数据同步策略

**决策**：服务器权威 + IDB 离线缓存 + syncQueue 回写 + WS 广播变更

**理由**：
1. 服务器权威：写操作先写服务器 PG，成功后返回客户端
2. 客户端缓存：IDB 作为离线缓存，API 模式下异步预写 IDB（保证离线可用）
3. 实时推送：WS 广播变更事件（panel/widget/entity 变更通知所有在线客户端）
4. 冲突解决：last-write-wins + version 字段（乐观锁，现有 schema 已有 version）
5. 离线写入：API 不可用时写 IDB + syncQueue，恢复后批量回写服务器

### 2.5 Docker 部署策略

**决策**：docker-compose.yml（postgres + server 两个服务）+ 多阶段构建 Dockerfile

**理由**：
1. 两个服务隔离：postgres 数据库独立，server 应用独立
2. 多阶段构建：build 阶段编译 TypeScript，runtime 阶段只保留 dist + node_modules
3. volume 持久化：pgdata volume 挂载到非 C 盘路径
4. 网络：默认 bridge，暴露 3456 端口（HTTP + WS）
5. 环境变量：.env 文件配置

### 2.6 局域网多端策略

**决策**：服务器监听 0.0.0.0:3456 + 客户端配置服务器 IP

**理由**：
1. Docker 默认监听 0.0.0.0
2. 客户端配置：`VITE_API_BASE_URL=http://<server-ip>:3456/api`，`VITE_WS_URL=ws://<server-ip>:3456/ws`
3. 内网穿透由用户自行配置（frp/ngrok），不在 Phase 3 范围

### 2.7 客户端改造策略

**决策**：HTTP baseURL 可配置 + WS 携带 deviceId + token + Authorization 头注入

**理由**：
1. HTTP baseURL 改为 `import.meta.env.VITE_API_BASE_URL || '/api'`
2. WS URL 已支持 `VITE_WS_URL`，连接时携带 `?deviceId=xxx&token=xxx`
3. HTTP 请求拦截器注入 `Authorization: Bearer <token>`
4. deviceId 首次启动生成 UUID，localStorage 持久化
5. token 配置：`VITE_SERVER_TOKEN` 环境变量或设置面板

---

## 三、数据库迁移

### 3.1 PostgreSQL Schema（完整 DDL）

**文件**：`server/src/db/schema.ts`（重写）

对照现有 SQLite schema（`server/src/db/schema.ts` 第 3-117 行），PostgreSQL DDL 如下：

```sql
-- ============================================================================
-- panels
-- ============================================================================
CREATE TABLE IF NOT EXISTS panels (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL DEFAULT '未命名',
  sort_order INTEGER NOT NULL DEFAULT 0,
  settings JSONB NOT NULL DEFAULT '{}'::jsonb,
  canvas_transform JSONB,
  created_at BIGINT NOT NULL DEFAULT (EXTRACT(EPOCH FROM now()) * 1000)::BIGINT,
  updated_at BIGINT NOT NULL DEFAULT (EXTRACT(EPOCH FROM now()) * 1000)::BIGINT
);

-- ============================================================================
-- widgets
-- ============================================================================
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

-- ============================================================================
-- entities
-- ============================================================================
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

-- ============================================================================
-- entity_relations
-- ============================================================================
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

-- ============================================================================
-- settings
-- ============================================================================
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at BIGINT NOT NULL DEFAULT (EXTRACT(EPOCH FROM now()) * 1000)::BIGINT
);

-- ============================================================================
-- dynamic_widgets
-- ============================================================================
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

-- ============================================================================
-- panel_templates
-- ============================================================================
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

-- ============================================================================
-- activity_sessions（保留表结构，Phase 1 已停止写入，但保留以兼容旧数据）
-- ============================================================================
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

-- ============================================================================
-- schema_version
-- ============================================================================
CREATE TABLE IF NOT EXISTS schema_version (
  key TEXT PRIMARY KEY DEFAULT 'current',
  version INTEGER NOT NULL
);

-- ============================================================================
-- sync_queue（Phase 3 新增：离线写入回写队列）
-- ============================================================================
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
```

**类型映射对照表**：

| SQLite | PostgreSQL | 说明 |
|--------|-----------|------|
| TEXT PRIMARY KEY | TEXT PRIMARY KEY | id 由 app 生成，保留 TEXT |
| INTEGER（布尔） | BOOLEAN | minimized/locked/is_primary/is_browser |
| REAL | DOUBLE PRECISION | x/y/width/height |
| TEXT（JSON） | JSONB | settings/state/data/metadata/widgets 等 |
| INTEGER（毫秒时间戳） | BIGINT | created_at/updated_at/started_at 等 |
| `unixepoch('now') * 1000` | `(EXTRACT(EPOCH FROM now()) * 1000)::BIGINT` | 默认值 |
| `INSERT OR IGNORE` | `INSERT ... ON CONFLICT DO NOTHING` | |
| `INSERT OR REPLACE` | `INSERT ... ON CONFLICT DO UPDATE` | |
| `db.transaction(() => {...})()` | `BEGIN; ...; COMMIT;`（pool.connect + client） | |
| `PRAGMA` | 无需 | |
| `result.changes` | `result.rowCount` | |

### 3.2 connection.ts 改造

**文件**：`server/src/db/connection.ts`（重写）

现有代码（`server/src/db/connection.ts` 第 1-56 行）使用 better-sqlite3 同步 API。改造为 pg Pool 异步 API：

```typescript
import { Pool, type PoolClient } from 'pg'

// 数据库连接配置
function buildConnectionString(): string {
  // 优先使用 DATABASE_URL（Docker 部署用）
  if (process.env.DATABASE_URL) {
    return process.env.DATABASE_URL
  }

  // 本地开发：从分散环境变量构建
  const pgHost = process.env.PGHOST || 'localhost'
  const pgPort = process.env.PGPORT || '5432'
  const pgUser = process.env.PGUSER || 'livingdashboard'
  const pgPassword = process.env.PGPASSWORD || 'livingdashboard'
  const pgDatabase = process.env.PGDATABASE || 'living_dashboard'

  return `postgresql://${pgUser}:${pgPassword}@${pgHost}:${pgPort}/${pgDatabase}`
}

let pool: Pool | null = null

export function getPool(): Pool {
  if (!pool) {
    throw new Error('Database pool not initialized. Call initDb() first.')
  }
  return pool
}

export async function initDb(): Promise<Pool> {
  if (pool) return pool

  const connectionString = buildConnectionString()

  pool = new Pool({
    connectionString,
    max: 20,                    // 最大连接数
    idleTimeoutMillis: 30000,   // 空闲连接超时
    connectionTimeoutMillis: 5000, // 连接超时
  })

  // 测试连接
  const client = await pool.connect()
  try {
    await client.query('SELECT 1')
    console.log('[DB] PostgreSQL connected:', connectionString.replace(/:[^:@]+@/, ':***@'))
  } finally {
    client.release()
  }

  // 错误处理
  pool.on('error', (err) => {
    console.error('[DB] Pool error:', err)
  })

  return pool
}

export async function closeDb(): Promise<void> {
  if (pool) {
    await pool.end()
    pool = null
    console.log('[DB] PostgreSQL pool closed')
  }
}

/**
 * 在事务中执行函数
 * 用法：
 *   await withTransaction(async (client) => {
 *     await client.query('INSERT ...')
 *     await client.query('UPDATE ...')
 *   })
 */
export async function withTransaction<T>(
  fn: (client: PoolClient) => Promise<T>
): Promise<T> {
  const pool = getPool()
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const result = await fn(client)
    await client.query('COMMIT')
    return result
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}
```

**关键变化**：
1. `initDb()` 从同步变为异步（`Promise<Pool>`）
2. `getDb()` 替换为 `getPool()`，返回 pg Pool
3. 新增 `withTransaction(fn)` 辅助函数，替代 `db.transaction(() => {...})()`
4. 连接字符串支持 `DATABASE_URL`（Docker）和分散环境变量（本地开发）
5. `closeDb()` 从同步变为异步

### 3.3 路由 handler async 化

**需要修改的文件清单**（共 10 个路由文件 + 1 个 schema 文件 + 1 个 seed 文件 + 1 个 index.ts）：

| 文件 | 改造点 |
|------|--------|
| `server/src/db/schema.ts` | `initializeSchema()` 异步化，执行 PG DDL |
| `server/src/db/seed.ts` | `seedBuiltinTemplates()` 异步化 |
| `server/src/index.ts` | `main()` 中 `await initDb()`，`await initializeSchema()`，`await seedBuiltinTemplates()` |
| `server/src/routes/panels.ts` | 所有 handler 改为 async，`pool.query()` 替代 `db.prepare()` |
| `server/src/routes/widgets.ts` | async + `pool.query()` + broadcastChange |
| `server/src/routes/entities.ts` | async + `pool.query()` + broadcastChange |
| `server/src/routes/relations.ts` | async + `pool.query()` + broadcastChange |
| `server/src/routes/scopes.ts` | async + `pool.query()` + broadcastChange |
| `server/src/routes/settings.ts` | async + `pool.query()` + broadcastChange |
| `server/src/routes/export.ts` | async + `pool.query()`（只读，无 broadcastChange） |
| `server/src/routes/import.ts` | async + `pool.query()` + withTransaction |
| `server/src/routes/dynamicWidgets.ts` | async + `pool.query()` + broadcastChange |
| `server/src/routes/panelTemplates.ts` | async + `pool.query()` + broadcastChange |

**改造模式**（以 `panels.ts` 为例，完整重写）：

现有代码（`server/src/routes/panels.ts` 第 1-131 行）改造后：

```typescript
import { Router } from 'express'
import { v4 as uuidv4 } from 'uuid'
import { getPool, withTransaction } from '../db/connection.js'
import { createError } from '../middleware/error.js'
import { broadcastChange } from '../ws.js'
import type { CreatePanelRequest, UpdatePanelRequest } from '../types/index.js'

export const panelsRouter = Router()

// GET /api/panels
panelsRouter.get('/', async (_req, res, next) => {
  try {
    const pool = getPool()
    const result = await pool.query('SELECT * FROM panels ORDER BY sort_order ASC')
    res.json(result.rows.map(parsePanelRow))
  } catch (e) { next(e) }
})

// GET /api/panels/active
panelsRouter.get('/active', async (_req, res, next) => {
  try {
    const pool = getPool()
    const result = await pool.query("SELECT value FROM settings WHERE key = 'activePanelId'")
    const row = result.rows[0]
    res.json({ activePanelId: row ? row.value : null })
  } catch (e) { next(e) }
})

// PUT /api/panels/active
panelsRouter.put('/active', async (req, res, next) => {
  try {
    const pool = getPool()
    const { activePanelId } = req.body as { activePanelId: string | null }
    await pool.query(
      `INSERT INTO settings (key, value, updated_at) VALUES ('activePanelId', $1, $2)
       ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = $2`,
      [activePanelId, Date.now()]
    )
    res.json({ activePanelId })
    // 广播变更（统一传 req.deviceId 作为 sourceDeviceId，排除发起方）
    broadcastChange({ kind: 'panel_active_changed', data: { activePanelId } }, req.deviceId)
  } catch (e) { next(e) }
})

// PUT /api/panels/reorder
panelsRouter.put('/reorder', async (req, res, next) => {
  try {
    const pool = getPool()
    const { panelIds } = req.body as { panelIds: string[] }
    const now = Date.now()
    await withTransaction(async (client) => {
      for (let i = 0; i < panelIds.length; i++) {
        await client.query(
          'UPDATE panels SET sort_order = $1, updated_at = $2 WHERE id = $3',
          [i, now, panelIds[i]]
        )
      }
    })
    res.json({ ok: true })
    broadcastChange({ kind: 'panels_reordered', data: { panelIds } }, req.deviceId)
  } catch (e) { next(e) }
})

// GET /api/panels/:id
panelsRouter.get('/:id', async (req, res, next) => {
  try {
    const pool = getPool()
    const result = await pool.query('SELECT * FROM panels WHERE id = $1', [req.params.id])
    if (result.rows.length === 0) throw createError(404, 'NOT_FOUND', `Panel ${req.params.id} not found`)
    res.json(parsePanelRow(result.rows[0]))
  } catch (e) { next(e) }
})

// POST /api/panels
panelsRouter.post('/', async (req, res, next) => {
  try {
    const pool = getPool()
    const body = req.body as CreatePanelRequest
    const id = body.id || uuidv4()
    const now = Date.now()
    await pool.query(
      `INSERT INTO panels (id, name, sort_order, settings, canvas_transform, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        id, body.name || '未命名', body.sortOrder ?? 0,
        JSON.stringify(body.settings ?? {}),
        body.canvasTransform ? JSON.stringify(body.canvasTransform) : null,
        now, now
      ]
    )
    const result = await pool.query('SELECT * FROM panels WHERE id = $1', [id])
    // 复用 parsePanelRow 结果，避免重复调用（M4 修复）
    const panel = parsePanelRow(result.rows[0])
    res.status(201).json(panel)
    broadcastChange({ kind: 'panel_created', data: panel }, req.deviceId)
  } catch (e) { next(e) }
})

// PUT /api/panels/:id
panelsRouter.put('/:id', async (req, res, next) => {
  try {
    const pool = getPool()
    const body = req.body as UpdatePanelRequest
    const existing = await pool.query('SELECT * FROM panels WHERE id = $1', [req.params.id])
    if (existing.rows.length === 0) throw createError(404, 'NOT_FOUND', `Panel ${req.params.id} not found`)

    const now = Date.now()
    const updates: string[] = []
    const values: unknown[] = []
    let paramIdx = 1

    if (body.name !== undefined) { updates.push(`name = $${paramIdx++}`); values.push(body.name) }
    if (body.sortOrder !== undefined) { updates.push(`sort_order = $${paramIdx++}`); values.push(body.sortOrder) }
    if (body.settings !== undefined) { updates.push(`settings = $${paramIdx++}`); values.push(JSON.stringify(body.settings)) }
    if (body.canvasTransform !== undefined) {
      updates.push(`canvas_transform = $${paramIdx++}`)
      values.push(body.canvasTransform ? JSON.stringify(body.canvasTransform) : null)
    }

    if (updates.length > 0) {
      updates.push(`updated_at = $${paramIdx++}`)
      values.push(now)
      values.push(req.params.id)
      await pool.query(`UPDATE panels SET ${updates.join(', ')} WHERE id = $${paramIdx}`, values)
    }

    const result = await pool.query('SELECT * FROM panels WHERE id = $1', [req.params.id])
    // 复用 parsePanelRow 结果，避免重复调用（M4 修复）
    const panel = parsePanelRow(result.rows[0])
    res.json(panel)
    broadcastChange({ kind: 'panel_updated', data: panel }, req.deviceId)
  } catch (e) { next(e) }
})

// DELETE /api/panels/:id
panelsRouter.delete('/:id', async (req, res, next) => {
  try {
    const pool = getPool()
    const result = await pool.query('DELETE FROM panels WHERE id = $1', [req.params.id])
    if (result.rowCount === 0) throw createError(404, 'NOT_FOUND', `Panel ${req.params.id} not found`)
    res.json({ ok: true })
    broadcastChange({ kind: 'panel_deleted', data: { id: req.params.id } }, req.deviceId)
  } catch (e) { next(e) }
})

function parsePanelRow(row: any) {
  return {
    id: row.id,
    name: row.name,
    sortOrder: row.sort_order,
    settings: row.settings || {},
    canvasTransform: row.canvas_transform || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}
```

**改造模式总结**（适用于所有路由文件）：

1. **handler 签名**：`(req, res, next) => { try {...} catch(e){next(e)} }` → `async (req, res, next) => { try {...} catch(e){next(e)} }`
2. **获取连接**：`const db = getDb()` → `const pool = getPool()`
3. **查询**：`db.prepare('SELECT...').all()` → `await pool.query('SELECT...')`，结果从 `.all()` 数组改为 `result.rows` 数组
4. **单行查询**：`db.prepare('SELECT...').get(params)` → `const result = await pool.query('SELECT...', [params])`，结果从 `row` 改为 `result.rows[0]`
5. **参数占位符**：`?` → `$1, $2, $3...`（按顺序递增）
6. **INSERT**：`db.prepare('INSERT...').run(params)` → `await pool.query('INSERT...', [params])`
7. **UPDATE/DELETE 影响行数**：`result.changes` → `result.rowCount`
8. **事务**：`db.transaction(() => {...})()` → `await withTransaction(async (client) => {...})`
9. **布尔字段**：`row.minimized === 1` → `row.minimized`（PG BOOLEAN 直接是 boolean）
10. **JSON 字段**：`JSON.parse(row.settings)` → `row.settings`（PG JSONB 自动解析为对象）
11. **JSON 写入**：`JSON.stringify(body.settings)` → `JSON.stringify(body.settings)`（pg 接受字符串，会自动转 JSONB）
12. **INSERT OR IGNORE**：`INSERT OR IGNORE INTO` → `INSERT INTO ... ON CONFLICT DO NOTHING`
13. **INSERT OR REPLACE**：`INSERT OR REPLACE INTO` → `INSERT INTO ... ON CONFLICT (key) DO UPDATE SET ...`
14. **广播变更**：写操作成功后调用 `broadcastChange({ kind, data }, req.deviceId)`，第二个参数 `req.deviceId` 由 auth 中间件从 `X-Device-Id` 请求头解析，用于排除发起方客户端（避免发起方收到自己触发的变更广播后重复刷新）

**其余 9 个路由文件的改造要点**（按相同模式，不逐一展开完整代码，但列出关键差异点）：

- `widgets.ts`：`minimized/locked/is_primary` 字段从 `? 1 : 0` 改为直接传 boolean；`row.minimized === 1` 改为 `row.minimized`
- `entities.ts`：`data` 字段 JSONB；批量操作用 `withTransaction`
- `relations.ts`：BFS 查询用 `client.query` 替代 `db.prepare`；`IN ($1, $2...)` 需要动态构建占位符
- `scopes.ts`：`db.transaction(() => {...})()` → `withTransaction`
- `settings.ts`：`INSERT OR REPLACE` → `ON CONFLICT (key) DO UPDATE`；`JSON.parse(row.value)` → `row.value`
- `export.ts`：所有查询异步化；`JSON.parse` 全部去掉
- `import.ts`：`db.transaction(() => {...})()` → `withTransaction`；`INSERT OR IGNORE` → `ON CONFLICT DO NOTHING`；备份逻辑移除（PG 用 pg_dump，不在代码内做）
- `dynamicWidgets.ts`：`JSON.parse(r.default_layout)` → `r.default_layout`
- `panelTemplates.ts`：`!!r.is_builtin` → `r.is_builtin`；`isBuiltin ? 1 : 0` → `isBuiltin`

### 3.4 数据迁移脚本（SQLite → PG）

**新建文件**：`server/src/db/migrateFromSqlite.ts`

```typescript
import Database from 'better-sqlite3'
import { getPool, withTransaction } from './connection.js'

const DEFAULT_SQLITE_PATH = 'F:\\allmylife\\event\\data\\living-dashboard.db'

interface MigrateOptions {
  sqlitePath?: string
  batchSize?: number
}

interface MigrateReport {
  tables: Record<string, number>
  errors: string[]
  startTime: number
  endTime: number
}

export async function migrateFromSqlite(options: MigrateOptions = {}): Promise<MigrateReport> {
  const sqlitePath = options.sqlitePath || process.env.SQLITE_PATH || DEFAULT_SQLITE_PATH
  const batchSize = options.batchSize || 500

  const report: MigrateReport = {
    tables: {},
    errors: [],
    startTime: Date.now(),
    endTime: 0,
  }

  console.log(`[Migrate] Opening SQLite: ${sqlitePath}`)
  const sqliteDb = new Database(sqlitePath, { readonly: true })
  const pool = getPool()

  try {
    // 1. panels
    await migrateTable({
      name: 'panels',
      sqliteDb,
      pool,
      selectSql: 'SELECT * FROM panels ORDER BY sort_order ASC',
      insertSql: `INSERT INTO panels (id, name, sort_order, settings, canvas_transform, created_at, updated_at)
                  VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (id) DO NOTHING`,
      mapRow: (r: any) => [
        r.id, r.name, r.sort_order,
        r.settings || '{}', r.canvas_transform,
        r.created_at, r.updated_at
      ],
      report,
      batchSize,
    })

    // 2. widgets
    await migrateTable({
      name: 'widgets',
      sqliteDb,
      pool,
      selectSql: 'SELECT * FROM widgets ORDER BY z_index ASC',
      insertSql: `INSERT INTO widgets (id, panel_id, type, x, y, width, height, z_index, minimized, locked, color_scheme, state, is_primary, version, created_at, updated_at)
                  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16) ON CONFLICT (id) DO NOTHING`,
      mapRow: (r: any) => [
        r.id, r.panel_id, r.type, r.x, r.y, r.width, r.height, r.z_index,
        !!r.minimized, !!r.locked, r.color_scheme, r.state || '{}',
        !!r.is_primary, r.version || 1, r.created_at, r.updated_at
      ],
      report,
      batchSize,
    })

    // 3. entities
    await migrateTable({
      name: 'entities',
      sqliteDb,
      pool,
      selectSql: 'SELECT * FROM entities ORDER BY created_at DESC',
      insertSql: `INSERT INTO entities (id, type, scope, panel_id, widget_id, data, record_status, version, created_at, updated_at)
                  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) ON CONFLICT (id) DO NOTHING`,
      mapRow: (r: any) => [
        r.id, r.type, r.scope, r.panel_id, r.widget_id,
        r.data || '{}', r.record_status, r.version || 1, r.created_at, r.updated_at
      ],
      report,
      batchSize,
    })

    // 4. entity_relations
    await migrateTable({
      name: 'entity_relations',
      sqliteDb,
      pool,
      selectSql: 'SELECT * FROM entity_relations ORDER BY created_at DESC',
      insertSql: `INSERT INTO entity_relations (id, source_id, target_id, type, metadata, created_at)
                  VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (id) DO NOTHING`,
      mapRow: (r: any) => [r.id, r.source_id, r.target_id, r.type, r.metadata || '{}', r.created_at],
      report,
      batchSize,
    })

    // 5. settings
    await migrateTable({
      name: 'settings',
      sqliteDb,
      pool,
      selectSql: 'SELECT * FROM settings',
      insertSql: `INSERT INTO settings (key, value, updated_at)
                  VALUES ($1, $2, $3) ON CONFLICT (key) DO NOTHING`,
      mapRow: (r: any) => [r.key, r.value || '{}', r.updated_at],
      report,
      batchSize,
    })

    // 6. dynamic_widgets
    await migrateTable({
      name: 'dynamic_widgets',
      sqliteDb,
      pool,
      selectSql: 'SELECT * FROM dynamic_widgets ORDER BY created_at',
      insertSql: `INSERT INTO dynamic_widgets (widget_type, display_name, icon, default_layout, default_state, code, created_at, updated_at)
                  VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT (widget_type) DO NOTHING`,
      mapRow: (r: any) => [
        r.widget_type, r.display_name, r.icon,
        r.default_layout || '{}', r.default_state || '{}', r.code,
        r.created_at, r.updated_at
      ],
      report,
      batchSize,
    })

    // 7. panel_templates
    await migrateTable({
      name: 'panel_templates',
      sqliteDb,
      pool,
      selectSql: 'SELECT * FROM panel_templates ORDER BY created_at',
      insertSql: `INSERT INTO panel_templates (id, name, icon, description, widgets, is_builtin, created_at, updated_at)
                  VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT (id) DO NOTHING`,
      mapRow: (r: any) => [
        r.id, r.name, r.icon, r.description,
        r.widgets || '[]', !!r.is_builtin, r.created_at, r.updated_at
      ],
      report,
      batchSize,
    })

    // 8. activity_sessions（保留迁移，虽然 Phase 1 已停止写入）
    await migrateTable({
      name: 'activity_sessions',
      sqliteDb,
      pool,
      selectSql: 'SELECT * FROM activity_sessions ORDER BY started_at DESC',
      insertSql: `INSERT INTO activity_sessions (id, started_at, ended_at, duration_ms, process_name, window_title, category, site_name, url, is_browser, created_at)
                  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) ON CONFLICT (id) DO NOTHING`,
      mapRow: (r: any) => [
        r.id, r.started_at, r.ended_at, r.duration_ms,
        r.process_name, r.window_title, r.category,
        r.site_name, r.url, !!r.is_browser, r.created_at
      ],
      report,
      batchSize,
    })

    // 9. schema_version
    await migrateTable({
      name: 'schema_version',
      sqliteDb,
      pool,
      selectSql: 'SELECT * FROM schema_version',
      insertSql: `INSERT INTO schema_version (key, version) VALUES ($1, $2) ON CONFLICT (key) DO NOTHING`,
      mapRow: (r: any) => [r.key || 'current', r.version],
      report,
      batchSize,
    })

  } catch (err) {
    report.errors.push(`Migration failed: ${err instanceof Error ? err.message : String(err)}`)
    console.error('[Migrate] Failed:', err)
  } finally {
    sqliteDb.close()
  }

  report.endTime = Date.now()
  console.log(`[Migrate] Done in ${report.endTime - report.startTime}ms. Report:`, report)
  return report
}

interface MigrateTableParams {
  name: string
  sqliteDb: Database.Database
  pool: ReturnType<typeof getPool>
  selectSql: string
  insertSql: string
  mapRow: (row: any) => unknown[]
  report: MigrateReport
  batchSize: number
}

async function migrateTable(params: MigrateTableParams): Promise<void> {
  const { name, sqliteDb, pool, selectSql, insertSql, mapRow, report, batchSize } = params
  console.log(`[Migrate] Migrating table: ${name}`)

  const rows = sqliteDb.prepare(selectSql).all() as any[]
  let count = 0

  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize)
    await withTransaction(async (client) => {
      for (const row of batch) {
        try {
          await client.query(insertSql, mapRow(row))
          count++
        } catch (err) {
          report.errors.push(`[${name}] row ${row.id || row.key || JSON.stringify(row).slice(0, 100)}: ${err instanceof Error ? err.message : String(err)}`)
        }
      }
    })
  }

  report.tables[name] = count
  console.log(`[Migrate] ${name}: ${count} rows migrated`)
}
```

**触发方式**：手动执行脚本 `npm run migrate`（在 `server/package.json` 中新增 script）。

### 3.5 seed.ts 改造

**文件**：`server/src/db/seed.ts`（重写）

现有代码（`server/src/db/seed.ts` 第 1-70 行）改造后：

```typescript
import { getPool } from './connection.js'

const BUILTIN_TEMPLATES = [
  {
    id: 'builtin-study',
    name: '学习模板',
    icon: 'book-open',
    description: '学习场景预设',
    widgets: [
      { widgetType: 'latexQuiz', position: { x: 20, y: 20, w: 360, h: 480 } },
      { widgetType: 'calculator', position: { x: 400, y: 20, w: 320, h: 460 } },
      { widgetType: 'vocabTrainer', position: { x: 20, y: 520, w: 360, h: 480 } },
      { widgetType: 'focusTimer', position: { x: 400, y: 520, w: 260, h: 300 } },
    ],
    is_builtin: true,
  },
  {
    id: 'builtin-work',
    name: '工作模板',
    icon: 'briefcase',
    description: '工作场景预设',
    widgets: [
      { widgetType: 'taskList', position: { x: 20, y: 20, w: 340, h: 400 } },
      { widgetType: 'agendaList', position: { x: 380, y: 20, w: 320, h: 380 } },
      { widgetType: 'focusTimer', position: { x: 20, y: 440, w: 260, h: 300 } },
      { widgetType: 'markdownEditor', position: { x: 380, y: 440, w: 450, h: 400 } },
    ],
    is_builtin: true,
  },
  {
    id: 'builtin-relax',
    name: '放松模板',
    icon: 'leaf',
    description: '放松场景预设',
    widgets: [
      { widgetType: 'musicPlayer', position: { x: 20, y: 20, w: 320, h: 380 } },
      { widgetType: 'breathingWidget', position: { x: 360, y: 20, w: 240, h: 280 } },
      { widgetType: 'quoteCard', position: { x: 20, y: 420, w: 280, h: 160 } },
      { widgetType: 'moodTracker', position: { x: 360, y: 420, w: 300, h: 340 } },
    ],
    is_builtin: true,
  },
  {
    id: 'builtin-review',
    name: '复盘模板',
    icon: 'bar-chart-3',
    description: '复盘场景预设',
    widgets: [
      { widgetType: 'statsPanel', position: { x: 20, y: 20, w: 340, h: 300 } },
      { widgetType: 'moodTracker', position: { x: 380, y: 20, w: 300, h: 340 } },
      { widgetType: 'habitTracker', position: { x: 20, y: 380, w: 340, h: 400 } },
      { widgetType: 'journal', position: { x: 380, y: 380, w: 380, h: 460 } },
    ],
    is_builtin: true,
  },
]

export async function seedBuiltinTemplates(): Promise<void> {
  const pool = getPool()
  const now = Date.now()

  for (const t of BUILTIN_TEMPLATES) {
    await pool.query(
      `INSERT INTO panel_templates (id, name, icon, description, widgets, is_builtin, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (id) DO NOTHING`,
      [t.id, t.name, t.icon, t.description, JSON.stringify(t.widgets), t.is_builtin, now, now]
    )
  }

  console.log(`[Seed] ${BUILTIN_TEMPLATES.length} builtin templates seeded`)
}
```

**关键变化**：
1. `seedBuiltinTemplates()` 从同步变为异步
2. `INSERT OR IGNORE` → `INSERT ... ON CONFLICT (id) DO NOTHING`
3. `db.prepare().run()` → `await pool.query()`
4. `JSON.stringify(t.widgets)` 直接传入（pg 会自动转 JSONB）
5. **widgets 字段类型变化**：现有 SQLite 代码中 `widgets` 字段存储为 JSON 字符串（TEXT），改造后 PostgreSQL 使用 JSONB 类型存储。`BUILTIN_TEMPLATES` 中的 `widgets` 数组通过 `JSON.stringify(t.widgets)` 传入，pg 自动转为 JSONB。读取时 `row.widgets` 直接是数组对象（无需 `JSON.parse`），类型从 `string` 改为 `array`。

### 3.6 schema.ts 改造

**文件**：`server/src/db/schema.ts`（重写）

现有代码（`server/src/db/schema.ts` 第 1-143 行）改造后：

```typescript
import { getPool } from './connection.js'

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
`

export async function initializeSchema(): Promise<void> {
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
```

**关键变化**：
1. `initializeSchema()` 从同步变为异步
2. `db.exec(SCHEMA_SQL)` → `await pool.query(SCHEMA_SQL)`（pg 支持多语句执行）
3. 移除 `PRAGMA table_info(widgets)` 的 ALTER TABLE 迁移逻辑（PG 用 `CREATE TABLE IF NOT EXISTS` 已包含 is_primary）
4. `db.prepare().get()` → `await pool.query()` + `result.rows[0]`

---

## 四、WS 网关扩展

### 4.1 多客户端管理

**文件**：`server/src/ws.ts`（重写）

现有代码（`server/src/ws.ts` 第 1-193 行）使用单客户端模式（`currentClient: WebSocket | null`）。改造为多客户端模式：

```typescript
import { WebSocketServer, WebSocket } from 'ws'
import type { Server as HttpServer, IncomingMessage } from 'http'
import { URL } from 'url'

// ============================================================================
// 消息协议（扩展：新增 broadcast 消息类型）
// ============================================================================

// 前端 → 后端
// 注：sync_queue_flush 已删除，统一用 HTTP 回写方案（见 6.6 节 syncQueue.ts）
export type ClientMessage =
  | { kind: 'user_message'; sessionId: string; content: string }
  | { kind: 'tool_result'; requestId: string; success: boolean; data?: unknown; error?: string }
  | { kind: 'error_report'; widgetId: string; message: string; stack?: string; source: string }
  | { kind: 'ping' }

// 后端 → 前端
export type ServerMessage =
  | { kind: 'tool_call'; requestId: string; tool: string; params: unknown; targetDeviceId?: string }
  | { kind: 'pi_event'; event: string; data: unknown }
  | { kind: 'session_ready'; sessionId: string }
  | { kind: 'error'; message: string }
  | { kind: 'pong' }
  | { kind: 'change'; changeType: string; data: unknown; sourceDeviceId?: string }

// 变更广播事件类型
export type ChangeEvent =
  | { kind: 'panel_created'; data: unknown }
  | { kind: 'panel_updated'; data: unknown }
  | { kind: 'panel_deleted'; data: { id: string } }
  | { kind: 'panel_active_changed'; data: { activePanelId: string | null } }
  | { kind: 'panels_reordered'; data: { panelIds: string[] } }
  | { kind: 'widget_created'; data: unknown }
  | { kind: 'widget_updated'; data: unknown }
  | { kind: 'widget_deleted'; data: { id: string } }
  | { kind: 'entity_created'; data: unknown }
  | { kind: 'entity_updated'; data: unknown }
  | { kind: 'entity_deleted'; data: { id: string } }
  | { kind: 'settings_updated'; data: unknown }

/** Widget 错误报告 */
export type ErrorReport = {
  widgetId: string
  message: string
  stack?: string
  source: string
}

// ============================================================================
// 客户端连接管理
// ============================================================================

interface ClientConnection {
  ws: WebSocket
  deviceId: string
  authenticated: boolean
  lastPing: number
}

type ClientMessageHandler = (msg: ClientMessage, deviceId: string) => void
type ClientConnectHandler = (deviceId: string) => void
type ClientDisconnectHandler = (deviceId: string) => void
type ErrorReportHandler = (report: ErrorReport, deviceId: string) => void

let wss: WebSocketServer | null = null

// 多客户端管理：Map<deviceId, ClientConnection>
const clients = new Map<string, ClientConnection>()

const messageHandlers: Set<ClientMessageHandler> = new Set()
const connectHandlers: Set<ClientConnectHandler> = new Set()
const disconnectHandlers: Set<ClientDisconnectHandler> = new Set()
const errorReportHandlers: Set<ErrorReportHandler> = new Set()

// 认证 token（从环境变量读取）
function getServerToken(): string | null {
  return process.env.SERVER_TOKEN || null
}

// 心跳超时（毫秒）：90 秒无 ping 视为断开
const HEARTBEAT_TIMEOUT_MS = 90_000
// 心跳检查间隔
const HEARTBEAT_CHECK_INTERVAL_MS = 30_000
let heartbeatCheckTimer: ReturnType<typeof setInterval> | null = null

function safeSend(ws: WebSocket, message: ServerMessage): boolean {
  if (ws.readyState !== WebSocket.OPEN) return false
  try {
    ws.send(JSON.stringify(message))
    return true
  } catch (err) {
    console.error('[WS] Failed to send message:', err)
    return false
  }
}

/**
 * 启动 WS 服务器
 * 每个连接需要携带 ?deviceId=xxx&token=xxx query 参数
 */
export function startWebSocketServer(server: HttpServer): void {
  if (wss) {
    console.warn('[WS] Server already started')
    return
  }

  wss = new WebSocketServer({ server, path: '/ws' })

  wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
    // 解析 query 参数
    const url = new URL(req.url || '', 'http://localhost')
    const deviceId = url.searchParams.get('deviceId')
    const token = url.searchParams.get('token')

    // 认证校验
    const serverToken = getServerToken()
    if (serverToken) {
      if (!token || token !== serverToken) {
        console.warn('[WS] Connection rejected: invalid token')
        safeSend(ws, { kind: 'error', message: 'invalid token' })
        ws.close(1008, 'invalid token')
        return
      }
    }
    if (!deviceId) {
      console.warn('[WS] Connection rejected: missing deviceId')
      safeSend(ws, { kind: 'error', message: 'missing deviceId' })
      ws.close(1008, 'missing deviceId')
      return
    }

    // 同一 deviceId 的旧连接替换为新连接
    const existing = clients.get(deviceId)
    if (existing && existing.ws.readyState === WebSocket.OPEN) {
      console.log(`[WS] Replacing existing connection for device: ${deviceId}`)
      try {
        existing.ws.close(1000, 'replaced by new connection')
      } catch {
        // ignore
      }
      clients.delete(deviceId)
    }

    const conn: ClientConnection = {
      ws,
      deviceId,
      authenticated: true,
      lastPing: Date.now(),
    }
    clients.set(deviceId, conn)
    console.log(`[WS] Client connected: deviceId=${deviceId}, total=${clients.size}`)

    // 通知连接建立
    for (const handler of connectHandlers) {
      try {
        handler(deviceId)
      } catch (err) {
        console.error('[WS] Connect handler error:', err)
      }
    }

    ws.on('message', (raw: Buffer | ArrayBuffer | Buffer[]) => {
      let text: string
      if (Buffer.isBuffer(raw)) {
        text = raw.toString('utf8')
      } else if (raw instanceof ArrayBuffer) {
        text = Buffer.from(raw).toString('utf8')
      } else if (Array.isArray(raw)) {
        text = Buffer.concat(raw).toString('utf8')
      } else {
        text = String(raw)
      }

      let msg: ClientMessage
      try {
        msg = JSON.parse(text) as ClientMessage
      } catch (err) {
        console.error('[WS] Failed to parse message:', err)
        safeSend(ws, { kind: 'error', message: 'invalid JSON' })
        return
      }

      // 更新 lastPing（任何消息都视为活跃）
      conn.lastPing = Date.now()

      // 心跳 ping
      if ((msg as { kind: string }).kind === 'ping') {
        safeSend(ws, { kind: 'pong' })
        return
      }

      // error_report 单独分发
      if (msg.kind === 'error_report') {
        const report: ErrorReport = {
          widgetId: msg.widgetId,
          message: msg.message,
          stack: msg.stack,
          source: msg.source,
        }
        for (const handler of errorReportHandlers) {
          try {
            handler(report, deviceId)
          } catch (err) {
            console.error('[WS] Error report handler error:', err)
          }
        }
        return
      }

      // 其他消息分发（携带 deviceId）
      for (const handler of messageHandlers) {
        try {
          handler(msg, deviceId)
        } catch (err) {
          console.error('[WS] Message handler error:', err)
        }
      }
    })

    ws.on('close', () => {
      if (clients.get(deviceId)?.ws === ws) {
        clients.delete(deviceId)
      }
      console.log(`[WS] Client disconnected: deviceId=${deviceId}, total=${clients.size}`)
      for (const handler of disconnectHandlers) {
        try {
          handler(deviceId)
        } catch (err) {
          console.error('[WS] Disconnect handler error:', err)
        }
      }
    })

    ws.on('error', (err: Error) => {
      console.error(`[WS] Client error (deviceId=${deviceId}):`, err)
    })
  })

  // 启动心跳检查
  startHeartbeatCheck()

  console.log('[WS] WebSocket server started at /ws (multi-client mode)')
}

/**
 * 心跳检查：定期清理超时连接
 */
function startHeartbeatCheck(): void {
  if (heartbeatCheckTimer) return
  heartbeatCheckTimer = setInterval(() => {
    const now = Date.now()
    for (const [deviceId, conn] of clients) {
      if (now - conn.lastPing > HEARTBEAT_TIMEOUT_MS) {
        console.warn(`[WS] Heartbeat timeout, closing: deviceId=${deviceId}`)
        try {
          conn.ws.close(1001, 'heartbeat timeout')
        } catch {
          // ignore
        }
        clients.delete(deviceId)
        for (const handler of disconnectHandlers) {
          try {
            handler(deviceId)
          } catch (err) {
            console.error('[WS] Disconnect handler error (heartbeat):', err)
          }
        }
      }
    }
  }, HEARTBEAT_CHECK_INTERVAL_MS)
}

// ============================================================================
// 消息发送 API
// ============================================================================

/**
 * 发送消息到指定设备
 */
export function sendToDevice(deviceId: string, message: ServerMessage): boolean {
  const conn = clients.get(deviceId)
  if (!conn || conn.ws.readyState !== WebSocket.OPEN) {
    return false
  }
  return safeSend(conn.ws, message)
}

/**
 * 广播消息到所有在线客户端（可选排除某个设备）
 */
export function broadcast(message: ServerMessage, excludeDeviceId?: string): void {
  for (const [deviceId, conn] of clients) {
    if (excludeDeviceId && deviceId === excludeDeviceId) continue
    safeSend(conn.ws, message)
  }
}

/**
 * 广播变更事件（路由 handler 调用）
 */
export function broadcastChange(event: ChangeEvent, sourceDeviceId?: string): void {
  const message: ServerMessage = {
    kind: 'change',
    changeType: event.kind,
    data: event.data,
    sourceDeviceId,
  }
  broadcast(message, sourceDeviceId)
}

/**
 * 发送到任意一个在线客户端（兼容旧 API，用于无目标设备的工具调用）
 * 优先选择第一个连接的设备
 */
export function sendToClient(message: ServerMessage): boolean {
  for (const [, conn] of clients) {
    if (conn.ws.readyState === WebSocket.OPEN) {
      return safeSend(conn.ws, message)
    }
  }
  return false
}

/**
 * 发送到指定设备或任意客户端（用于工具调用路由）
 * 如果 message.targetDeviceId 存在，发到指定设备；否则发到任意客户端
 */
export function sendToolCall(message: ServerMessage & { targetDeviceId?: string }): boolean {
  if (message.targetDeviceId) {
    return sendToDevice(message.targetDeviceId, message)
  }
  return sendToClient(message)
}

export function hasClient(): boolean {
  return clients.size > 0
}

export function hasDevice(deviceId: string): boolean {
  const conn = clients.get(deviceId)
  return conn !== undefined && conn.ws.readyState === WebSocket.OPEN
}

export function getOnlineDeviceIds(): string[] {
  return Array.from(clients.keys())
}

// ============================================================================
// 事件订阅 API
// ============================================================================

export function onClientMessage(handler: ClientMessageHandler): () => void {
  messageHandlers.add(handler)
  return () => messageHandlers.delete(handler)
}

export function onClientConnect(handler: ClientConnectHandler): () => void {
  connectHandlers.add(handler)
  return () => connectHandlers.delete(handler)
}

export function onClientDisconnect(handler: ClientDisconnectHandler): () => void {
  disconnectHandlers.add(handler)
  return () => disconnectHandlers.delete(handler)
}

export function onErrorReport(handler: ErrorReportHandler): () => void {
  errorReportHandlers.add(handler)
  return () => errorReportHandlers.delete(handler)
}
```

**关键变化**：
1. `currentClient: WebSocket | null` → `clients: Map<string, ClientConnection>`
2. 连接时解析 `?deviceId=xxx&token=xxx` query 参数
3. 认证校验：token 不匹配拒绝连接（close 1008）
4. 同一 deviceId 新连接替换旧连接
5. `sendToClient()` 保留（发到任意客户端），新增 `sendToDevice()`、`broadcast()`、`broadcastChange()`
6. 心跳检查：90 秒无 ping 视为断开
7. `onClientMessage` 等 handler 签名增加 `deviceId` 参数

### 4.2 认证流程

**连接时验证 token + deviceId**：

1. 客户端连接 URL：`ws://<server-ip>:3456/ws?deviceId=<uuid>&token=<SERVER_TOKEN>`
2. 服务端 `wss.on('connection')` 解析 query 参数
3. 校验：
   - `SERVER_TOKEN` 环境变量未设置 → 跳过 token 校验（开发模式）
   - `SERVER_TOKEN` 已设置但 `token` 不匹配 → close 1008
   - `deviceId` 缺失 → close 1008
4. 同一 deviceId 旧连接被替换

**HTTP 请求认证**（新增中间件）：

**新建文件**：`server/src/middleware/auth.ts`

```typescript
import type { Request, Response, NextFunction } from 'express'
import { createError } from './error.js'

// 扩展 Express Request 类型，增加 deviceId 字段
declare module 'express-serve-static-core' {
  interface Request {
    deviceId?: string
  }
}

export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  const serverToken = process.env.SERVER_TOKEN

  // SERVER_TOKEN 未设置 → 跳过 token 认证（开发模式）
  if (!serverToken) {
    // 即使跳过 token 认证，也解析 deviceId（用于广播变更时排除发起方）
    req.deviceId = req.headers['x-device-id'] as string | undefined
    next()
    return
  }

  const authHeader = req.headers.authorization
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    next(createError(401, 'UNAUTHORIZED', 'Missing or invalid Authorization header'))
    return
  }

  const token = authHeader.slice(7)
  if (token !== serverToken) {
    next(createError(401, 'UNAUTHORIZED', 'Invalid token'))
    return
  }

  // 解析 deviceId（用于广播变更时排除发起方）
  req.deviceId = req.headers['x-device-id'] as string | undefined

  next()
}
```

**关键点**：
- 认证中间件同时解析 `X-Device-Id` 请求头并挂到 `req.deviceId`
- 即使 `SERVER_TOKEN` 未设置（开发模式），也解析 `deviceId`（保证广播变更排除发起方在开发模式下也生效）
- `deviceId` 是可选的（客户端可能未发送），路由 handler 使用时需做 null 检查

**在 `index.ts` 中注册**（在路由之前）：

```typescript
import { authMiddleware } from './middleware/auth.js'

// ... 在 app.use(cors()) 之后、路由之前
app.use('/api', authMiddleware)
```

**健康检查豁免**（`/api/health` 不需要认证，供 detectBackend 探测）：

```typescript
// 健康检查（不需要认证）
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: Date.now() })
})

// 认证中间件（健康检查之后）
app.use('/api', authMiddleware)

// 注册路由（需要认证）
app.use('/api/panels', panelWidgetsRouter)
// ...
```

### 4.3 工具调用路由

**文件**：`server/src/piBridge.ts`（修改 `executeViaWs` 函数）

现有代码（`server/src/piBridge.ts` 第 38-60 行）的 `executeViaWs` 函数改造：

```typescript
// 需要路由到特定设备的工具（browser_* 工具）
const DEVICE_SPECIFIC_TOOLS = new Set([
  'browser_eval', 'browser_get_dom', 'browser_click', 'browser_input',
  'browser_scroll', 'browser_wait_for', 'browser_screenshot', 'browser_navigate',
  'browser_get_url', 'browser_get_title', 'browser_back', 'browser_forward',
  'browser_reload', 'browser_get_cookie', 'browser_set_cookie',
  'browser_open', 'browser_switch_tab', 'browser_list_tabs',
])

// 当前活跃设备 ID（用于工具调用路由）
let activeDeviceId: string | null = null

function executeViaWs(tool: string, params: unknown): Promise<unknown> {
  return new Promise((resolve, reject) => {
    // 确定目标设备
    let targetDeviceId: string | undefined

    if (DEVICE_SPECIFIC_TOOLS.has(tool)) {
      // browser_* 工具：路由到活跃设备
      if (!activeDeviceId || !hasDevice(activeDeviceId)) {
        reject(new Error(`no active device for browser tool: ${tool}`))
        return
      }
      targetDeviceId = activeDeviceId
    } else {
      // 画布工具：发到任意客户端（或活跃设备）
      if (!hasClient()) {
        reject(new Error('no websocket client connected'))
        return
      }
      if (activeDeviceId && hasDevice(activeDeviceId)) {
        targetDeviceId = activeDeviceId
      }
    }

    const requestId = randomUUID()
    const timer = setTimeout(() => {
      pendingRequests.delete(requestId)
      reject(new Error('timeout'))
    }, TOOL_TIMEOUT_MS)

    pendingRequests.set(requestId, { resolve, reject, timer })

    const ok = sendToolCall({
      kind: 'tool_call',
      requestId,
      tool,
      params,
      targetDeviceId,
    })

    if (!ok) {
      clearTimeout(timer)
      pendingRequests.delete(requestId)
      reject(new Error('failed to send tool_call to client'))
    }
  })
}

/**
 * 设置活跃设备（用于工具调用路由）
 * 当某个设备发送 user_message 时，设为活跃设备
 */
export function setActiveDevice(deviceId: string): void {
  activeDeviceId = deviceId
  console.log(`[PiBridge] Active device set: ${deviceId}`)
}
```

**关键变化**：
1. 新增 `DEVICE_SPECIFIC_TOOLS` 集合（18 个 browser_* 工具）
2. 新增 `activeDeviceId` 变量（当前活跃设备）
3. `executeViaWs` 根据 tool 类型路由到 `activeDeviceId` 或任意客户端
4. 新增 `setActiveDevice()` 函数（user_message 时设置）
5. `sendToClient()` → `sendToolCall()`（支持 targetDeviceId）

### 4.4 变更广播机制

**路由 handler 调用 `broadcastChange()`**（见 3.3 节 panels.ts 示例）

所有写操作（POST/PUT/DELETE）成功后调用 `broadcastChange({ kind, data }, req.deviceId)`，广播到所有在线客户端（排除发起方 `req.deviceId`）。

**客户端接收变更事件**：

客户端 WS 消息处理新增 `change` 类型（在 `useAIStore.ts` 的 `handleServerMessage` 中新增 `case 'change'` 分支）：

```typescript
// 在 handleServerMessage 的 switch 中新增
case 'change': {
  handleServerChange(msg.changeType, msg.data, msg.sourceDeviceId)
  break
}
```

`handleServerChange` 的完整实现见 **6.2 节改造点 5**。核心逻辑：
- 如果 `sourceDeviceId === getDeviceId()` 则忽略（避免自己发起的变更触发刷新）
- 根据 `changeType` 调用 `useAppStore.getState().refreshPanels()` / `refreshWidgets()` / `refreshSettings()`
- `refreshPanels/refreshWidgets/refreshSettings` 方法的实现见 **6.7 节**

### 4.5 心跳与超时

**服务端**（见 4.1 节 `startHeartbeatCheck`）：
- 每 30 秒检查一次所有连接的 `lastPing`
- 90 秒无任何消息（含 ping）→ close 1001 + 清理

**客户端**（**已有心跳，无需新增**）：

现有 `useAIStore.ts` 第 146-156 行已实现客户端心跳：
```typescript
// 现有代码（useAIStore.ts 第 146-156 行，无需改动）
if (wsPingTimer) clearInterval(wsPingTimer)
wsPingTimer = setInterval(() => {
  if (ws === thisWs && thisWs.readyState === WebSocket.OPEN) {
    try {
      thisWs.send(JSON.stringify({ kind: 'ping' }))
    } catch {
      // 连接可能已关闭，忽略
    }
  }
}, WS_PING_INTERVAL_MS)  // 30_000ms
```

服务端收到 `ping` 后回复 `pong`（见 4.1 节 `wss.on('connection')` 中的 ping 处理）。客户端收到 `pong` 后无需特殊处理（现有 `ServerMessage` 类型已包含 `pong`）。

---

## 五、Pi Agent 改造

### 5.1 单 session 共享模式

**文件**：`server/src/piBridge.ts`（修改 `initPiBridge`）

现有代码（`server/src/piBridge.ts` 第 587-660 行）保持单 session 模式不变，但 `onClientMessage` handler 需要适配 `deviceId` 参数：

```typescript
export async function initPiBridge(): Promise<void> {
  if (session) {
    console.warn('[PiBridge] Already initialized')
    return
  }

  try {
    session = await createSession()
    sessionReady = true
    console.log(`[PiBridge] Agent session created (model: ${process.env.PI_MODEL || 'stepfun/step-3.7-flash'})`)

    // 通知所有已连接的 WS 客户端
    broadcast({ kind: 'session_ready', sessionId: session.sessionId })
  } catch (err) {
    console.error('[PiBridge] Failed to create agent session:', err)
    throw err
  }

  // WS message handler（携带 deviceId）
  onClientMessage((msg, deviceId) => {
    if (msg.kind === 'user_message') {
      // 设置活跃设备（用于工具调用路由）
      setActiveDevice(deviceId)
      handleUserMessage(msg.content).catch((err) => {
        console.error('[PiBridge] Error handling user_message:', err)
        sendToDevice(deviceId, {
          kind: 'error',
          message: `Failed to handle user message: ${err instanceof Error ? err.message : String(err)}`,
        })
      })
    } else if (msg.kind === 'tool_result') {
      const pending = pendingRequests.get(msg.requestId)
      if (!pending) {
        console.warn('[PiBridge] Received tool_result for unknown requestId:', msg.requestId)
        return
      }
      clearTimeout(pending.timer)
      pendingRequests.delete(msg.requestId)
      if (msg.success) {
        pending.resolve(msg.data)
      } else {
        pending.reject(new Error(msg.error || 'tool execution failed on client'))
      }
    }
    // 注：sync_queue_flush 消息处理已删除，统一用 HTTP 回写方案（见 6.6 节）
  })

  // error_report handler（携带 deviceId）
  onErrorReport((report, deviceId) => {
    const errorMessage = formatErrorMessage(report)
    console.log(`[PiBridge] Widget error reported (widgetId=${report.widgetId}, device=${deviceId}), injecting to agent context`)
    setActiveDevice(deviceId)
    handleUserMessage(errorMessage).catch((err) => {
      console.error('[PiBridge] Error injecting widget error to agent:', err)
      sendToDevice(deviceId, {
        kind: 'error',
        message: `Failed to inject widget error to agent: ${err instanceof Error ? err.message : String(err)}`,
      })
    })
  })

  // WS disconnect：只清理该设备的 pending 请求
  onClientDisconnect((deviceId) => {
    // 拒绝该设备相关的 pending 请求（通过 targetDeviceId 判断）
    // 注意：pendingRequests 不存储 deviceId，所以这里只清理超时的请求
    // 实际实现中，可以在 PendingRequest 中存储 deviceId
    if (pendingRequests.size > 0) {
      console.log(`[PiBridge] Device disconnected: ${deviceId}, ${pendingRequests.size} pending tool calls`)
      // 不全部拒绝，只拒绝超时的（由 timer 处理）
    }
  })

  // WS connect：如果 session ready，通知新连接的设备
  onClientConnect((deviceId) => {
    if (sessionReady && session) {
      sendToDevice(deviceId, { kind: 'session_ready', sessionId: session.sessionId })
    }
  })
}
```

**关键变化**：
1. `onClientMessage` handler 签名增加 `deviceId`
2. `user_message` 时调用 `setActiveDevice(deviceId)`
3. `sendToClient()` → `sendToDevice(deviceId, ...)`（错误消息定向发送）
4. `onClientConnect` 通知特定设备而非"当前客户端"
5. `onClientDisconnect` 只清理该设备相关请求（不全部拒绝）
6. 删除 `sync_queue_flush` 消息处理（统一用 HTTP 回写方案，见 6.6 节）

### 5.1.1 forwardEventToClient 改造（pi 事件广播）

**文件**：`server/src/piBridge.ts`（修改 `forwardEventToClient`）

**问题**：现有 `forwardEventToClient`（`server/src/piBridge.ts` 第 488-493 行）内部调用 `sendToClient({ kind: 'pi_event' ... })`，而 `sendToClient` 只发到"第一个连接的客户端"。在多客户端模式下，pi 事件（agent 思考流、工具调用进度等）必须广播到所有在线客户端，否则只有第一个连接的设备能看到 agent 实时输出。

**改造**：将 `sendToClient` 改为 `broadcast`，让 pi 事件广播到所有在线客户端。

现有代码（`server/src/piBridge.ts` 第 488-493 行）：
```typescript
function forwardEventToClient(event: unknown): void {
  // We don't know the exact shape here; cast to a generic event with `type`
  const e = event as { type?: string; [key: string]: unknown }
  if (!e || typeof e.type !== 'string') return
  sendToClient({ kind: 'pi_event', event: e.type, data: e })
}
```

改造后：
```typescript
function forwardEventToClient(event: unknown): void {
  // We don't know the exact shape here; cast to a generic event with `type`
  const e = event as { type?: string; [key: string]: unknown }
  if (!e || typeof e.type !== 'string') return
  // Phase 3：pi 事件广播到所有在线客户端（多端共享同一 session）
  broadcast({ kind: 'pi_event', event: e.type, data: e })
}
```

**关键变化**：
1. `sendToClient({ kind: 'pi_event' ... })` → `broadcast({ kind: 'pi_event' ... })`
2. pi 事件（agent 思考、工具调用进度、错误等）现在广播到所有在线客户端，所有设备都能实时看到 agent 输出
3. `sendToClient` 函数保留（用于无目标设备的工具调用回退，见 4.3 节 `sendToolCall`）

**注意**：`broadcast` 已在 4.1 节定义，无需额外 import。`createSession` 内部 `s.subscribe((event) => { forwardEventToClient(event) })`（第 580-582 行）无需改动，自动生效。

### 5.2 模型可配置

**文件**：`server/src/piBridge.ts`（修改 `createSession`）

现有代码（`server/src/piBridge.ts` 第 540-564 行）硬编码 `stepfun/step-3.7-flash` 模型和 `stepfun` provider 的 API Key 注入。改造为环境变量可配置，API Key 也根据 provider 动态注入：

```typescript
// 在 createSession 函数中
// 1. 解析模型标识（PI_MODEL，格式 <provider>/<model>）
const modelEnv = process.env.PI_MODEL || 'stepfun/step-3.7-flash'
const [providerName, modelName] = modelEnv.includes('/')
  ? modelEnv.split('/')
  : ['stepfun', modelEnv]

// 2. 动态注入 API Key（PI_API_KEY）
//    PI_API_KEY 优先级最高，覆盖 auth.json 和 env vars
//    兼容旧变量：VITE_STEPFUN_API_KEY（仅当 provider=stepfun 且 PI_API_KEY 未设置时使用）
const authStorage = AuthStorage.create(agentDir ? join(agentDir, 'auth.json') : undefined)
const piApiKey = process.env.PI_API_KEY
if (piApiKey) {
  authStorage.setRuntimeApiKey(providerName, piApiKey)
} else if (providerName === 'stepfun' && process.env.VITE_STEPFUN_API_KEY) {
  // 向后兼容：旧变量名 VITE_STEPFUN_API_KEY
  authStorage.setRuntimeApiKey('stepfun', process.env.VITE_STEPFUN_API_KEY)
}
const modelRegistry = ModelRegistry.create(authStorage)

// 3. 刷新 extension provider 注册（保持现有逻辑）
const extensionsResult = resourceLoader.getExtensions()
for (const { name, config } of extensionsResult.runtime.pendingProviderRegistrations) {
  modelRegistry.registerProvider(name, config)
}
extensionsResult.runtime.pendingProviderRegistrations = []

// 4. 显式选择模型（避免 findInitialModel 选到无 API key 的内置模型）
const model = modelRegistry.find(providerName, modelName)
if (!model) {
  throw new Error(`model not found in registry: ${modelEnv}. Ensure provider "${providerName}" is registered and model "${modelName}" exists, and PI_API_KEY is set.`)
}

console.log(`[PiBridge] Using model: ${providerName}/${modelName}`)
```

**环境变量**：
- `PI_MODEL`：模型标识，格式 `<provider>/<model>`，默认 `stepfun/step-3.7-flash`
- `PI_API_KEY`：对应 provider 的 API Key（优先级最高，根据 PI_MODEL 的 provider 部分动态注入到对应 provider）
- `VITE_STEPFUN_API_KEY`：向后兼容，仅当 `PI_MODEL` 的 provider 为 `stepfun` 且 `PI_API_KEY` 未设置时使用
- 示例：
  - `PI_MODEL=stepfun/step-3.7-flash` + `PI_API_KEY=sk-xxx`（注入到 stepfun provider）
  - `PI_MODEL=openai/gpt-4o` + `PI_API_KEY=sk-xxx`（注入到 openai provider）

**关键变化**：
1. 模型从硬编码改为 `PI_MODEL` 环境变量可配置
2. API Key 注入从硬编码 `stepfun` 改为根据 `PI_MODEL` 的 provider 部分动态注入
3. 新增 `PI_API_KEY` 环境变量（推荐），保留 `VITE_STEPFUN_API_KEY` 向后兼容
4. `setRuntimeApiKey('stepfun', ...)` → `setRuntimeApiKey(providerName, ...)`

### 5.3 工具调用路由

见 4.3 节。`executeViaWs` 根据 tool 类型路由：
- `browser_*` 工具 → `activeDeviceId`（必须存在）
- 画布工具（create/update/delete_html_widget、storage_read/write、list_widgets）→ `activeDeviceId` 或任意客户端

---

## 六、客户端改造

### 6.1 HTTP baseURL 可配置

**文件**：`client/desktop/src/api/client.ts`（修改）

现有代码（`client/desktop/src/api/client.ts` 第 1-66 行）改造：

```typescript
import { getServerToken, getDeviceId } from '../utils/deviceAuth'

const API_BASE = import.meta.env.VITE_API_BASE_URL || '/api'

class ApiClient {
  private baseUrl: string

  constructor(baseUrl: string = API_BASE) {
    this.baseUrl = baseUrl
  }

  async get<T>(path: string, params?: Record<string, string>): Promise<T> {
    const url = new URL(this.baseUrl + path, window.location.origin)
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        if (v !== undefined && v !== null) url.searchParams.set(k, v)
      }
    }
    const res = await fetch(url.toString(), {
      headers: this.getAuthHeaders(),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: { message: res.statusText } }))
      throw new Error(err.error?.message || `API error: ${res.status}`)
    }
    return res.json()
  }

  async post<T>(path: string, body?: unknown): Promise<T> {
    const res = await fetch(this.baseUrl + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...this.getAuthHeaders() },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: { message: res.statusText } }))
      throw new Error(err.error?.message || `API error: ${res.status}`)
    }
    return res.json()
  }

  async put<T>(path: string, body?: unknown): Promise<T> {
    const res = await fetch(this.baseUrl + path, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...this.getAuthHeaders() },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: { message: res.statusText } }))
      throw new Error(err.error?.message || `API error: ${res.status}`)
    }
    return res.json()
  }

  async delete<T = { ok: boolean }>(path: string, body?: unknown): Promise<T> {
    const opts: RequestInit = {
      method: 'DELETE',
      headers: this.getAuthHeaders(),
    }
    if (body !== undefined) {
      opts.headers = { 'Content-Type': 'application/json', ...this.getAuthHeaders() }
      opts.body = JSON.stringify(body)
    }
    const res = await fetch(this.baseUrl + path, opts)
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: { message: res.statusText } }))
      throw new Error(err.error?.message || `API error: ${res.status}`)
    }
    return res.json()
  }

  private getAuthHeaders(): Record<string, string> {
    const headers: Record<string, string> = {}
    const token = getServerToken()
    if (token) headers['Authorization'] = `Bearer ${token}`
    const deviceId = getDeviceId()
    if (deviceId) headers['X-Device-Id'] = deviceId
    return headers
  }
}

export const api = new ApiClient()
```

**关键变化**：
1. `const API_BASE = '/api'` → `const API_BASE = import.meta.env.VITE_API_BASE_URL || '/api'`
2. 所有 fetch 调用注入 `getAuthHeaders()`
3. 新增 `getAuthHeaders()` 方法（从 localStorage 读取 token + deviceId）
4. `getAuthHeaders()` 同时返回 `Authorization`（token 认证）和 `X-Device-Id`（标识发起方设备，用于服务器广播变更时排除发起方）

### 6.2 WS 连接携带 deviceId + token

**文件**：`client/desktop/src/stores/useAIStore.ts`（修改）+ `client/desktop/src/api/adapter.ts`（修改）

**重要现状说明**：

现有 WS 客户端逻辑**已经存在**于 `client/desktop/src/stores/useAIStore.ts` 第 67-244 行，作为模块级单例实现，包含：
- `WS_URL` 常量（第 71 行）：`(import.meta.env.VITE_WS_URL as string | undefined) || 'ws://localhost:3456/ws'`
- `ws`、`wsReconnectAttempts`、`wsReconnectTimer`、`wsManuallyClosed`、`wsPingTimer` 等模块级变量（第 76-80 行）
- `onlineHandlers`、`messageHandlers` 两个 Set（第 87-88 行）用于解耦订阅
- `notifyOnline`、`notifyMessage` 分发函数（第 90-108 行）
- `scheduleReconnect` 指数退避重连（第 110-123 行）
- `connectWs` 连接函数（第 125-210 行），含心跳 ping（30s）、被替换时 30s 退避
- `sendWs` 发送函数（第 212-224 行）
- `closeWs` 关闭函数（第 226-244 行）
- `handleServerMessage` 在 store 创建时注册到 `messageHandlers`（第 364-394 行），调用 `set`/`get` 操作 store 状态

**改造决策**：**不新建 `wsClient.ts`**，直接修改 `useAIStore.ts` 中的 WS 逻辑。理由：
1. WS 逻辑与 store 状态紧密耦合（`handleServerMessage` 调用 `set`/`get`）
2. 提取到独立文件需要注入大量回调（onlineHandlers、messageHandlers 已是解耦设计，再提取收益低）
3. 最小改动原则，降低引入 bug 的风险

**改造点 1**：修改 `useAIStore.ts` 第 71 行的 `WS_URL` 构建，加入 deviceId 和 token

现有代码（`useAIStore.ts` 第 71 行）：
```typescript
const WS_URL = (import.meta.env.VITE_WS_URL as string | undefined) || 'ws://localhost:3456/ws'
```

改造后（替换第 71 行，并新增 `buildWsUrl` 函数）：
```typescript
import { getDeviceId, getServerToken } from '../utils/deviceAuth'

// WS_URL 基础地址（不含 query 参数）
const WS_URL_BASE = (import.meta.env.VITE_WS_URL as string | undefined) || 'ws://localhost:3456/ws'

/**
 * 构建带 deviceId + token 的完整 WS URL
 * 每次连接时调用（deviceId/token 可能在运行时被设置面板修改）
 */
function buildWsUrl(): string {
  const deviceId = getDeviceId()
  const token = getServerToken()
  const params = new URLSearchParams({ deviceId })
  if (token) params.set('token', token)
  return `${WS_URL_BASE}?${params.toString()}`
}
```

**改造点 2**：修改 `useAIStore.ts` 第 125-138 行的 `connectWs` 函数，使用 `buildWsUrl()`

现有代码（`useAIStore.ts` 第 125-138 行）：
```typescript
function connectWs(): void {
  if (wsManuallyClosed) return
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
    return
  }

  let thisWs: WebSocket
  try {
    thisWs = new WebSocket(WS_URL)
  } catch (err) {
    console.error('[useAIStore] WS construction failed:', err)
    scheduleReconnect()
    return
  }
  ws = thisWs
```

改造后：
```typescript
function connectWs(): void {
  if (wsManuallyClosed) return
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
    return
  }

  const wsUrl = buildWsUrl()
  let thisWs: WebSocket
  try {
    thisWs = new WebSocket(wsUrl)
  } catch (err) {
    console.error('[useAIStore] WS construction failed:', err)
    scheduleReconnect()
    return
  }
  ws = thisWs
```

**改造点 3**：修改 `useAIStore.ts` 第 142 行的 `onopen` 日志，使用 `wsUrl`

现有代码（`useAIStore.ts` 第 141-142 行）：
```typescript
  thisWs.onopen = () => {
    console.log('[useAIStore] WS connected to', WS_URL)
```

改造后：
```typescript
  thisWs.onopen = () => {
    console.log('[useAIStore] WS connected to', wsUrl.replace(/token=([^&]+)/, 'token=***'))
```

**改造点 4**：`handleServerMessage` 新增 `change` 消息类型处理

现有 `handleServerMessage`（`useAIStore.ts` 第 364-394 行）处理 `session_ready`、`pi_event`、`tool_call`、`error`。需要新增 `change` 类型：

```typescript
function handleServerMessage(msg: ServerMessage): void {
    switch (msg.kind) {
      case 'session_ready': {
        set({ activeSessionId: msg.sessionId })
        console.log('[useAIStore] session_ready:', msg.sessionId)
        break
      }

      case 'pi_event': {
        handlePiEvent(msg.event, msg.data)
        break
      }

      case 'tool_call': {
        void handleToolCall(msg.requestId, msg.tool, msg.params)
        break
      }

      case 'error': {
        console.error('[useAIStore] server error:', msg.message)
        const sessionId = get().activeSessionId
        if (sessionId) {
          appendAssistantMessage(sessionId, `[error] ${msg.message}`)
          setSessionStatus(sessionId, 'error', msg.message)
        }
        break
      }

      case 'change': {
        // Phase 3 新增：服务器变更广播
        handleServerChange(msg.changeType, msg.data, msg.sourceDeviceId)
        break
      }
    }
  }
```

**改造点 5**：新增 `handleServerChange` 函数（在 useAIStore.ts 中，store 创建闭包内）

```typescript
// 注意：不要 import { useAppStore } from './useAppStore'（会导致循环依赖）
// 使用下方 ref 机制（getUseAppStore）获取 useAppStore
function handleServerChange(changeType: string, data: unknown, sourceDeviceId?: string): void {
    // 如果是自己发起的变更，忽略（避免重复刷新）
    if (sourceDeviceId === getDeviceId()) return

    console.log(`[useAIStore] Received change: ${changeType}`)
    // 触发对应 store 刷新（通过 ref 机制调用 useAppStore.getState()，避免循环依赖）
    const appStore = getUseAppStore().getState()
    switch (changeType) {
      case 'panel_created':
      case 'panel_updated':
      case 'panel_deleted':
      case 'panel_active_changed':
      case 'panels_reordered':
        void appStore.refreshPanels()
        break
      case 'widget_created':
      case 'widget_updated':
      case 'widget_deleted':
        void appStore.refreshWidgets()
        break
      case 'entity_created':
      case 'entity_updated':
      case 'entity_deleted':
        // entities 按需刷新（当前不主动刷新，避免性能问题）
        break
      case 'settings_updated':
        void appStore.refreshSettings()
        break
    }
  }
```

**注意**：`useAppStore` 需要新增 `refreshPanels()`、`refreshWidgets()`、`refreshSettings()` 方法（见 6.7 节）。`useAIStore.ts` 和 `useAppStore.ts` 之间已有循环依赖处理机制（`useAppStore.ts` 第 73-80 行的 `setUseAIStoreRef` / `getUseAIStore`），反向引用 `useAppStore` 需要使用动态 import 或类似的 ref 机制避免循环依赖问题。推荐做法：

```typescript
// useAIStore.ts 顶部，避免循环依赖
let _useAppStoreRef: (() => typeof import('./useAppStore')['useAppStore']) | null = null
export function setUseAppStoreRef(ref: () => typeof import('./useAppStore')['useAppStore']) {
  _useAppStoreRef = ref
}
function getUseAppStore() {
  if (!_useAppStoreRef) {
    throw new Error('[useAIStore] useAppStore ref not set')
  }
  return _useAppStoreRef()
}
```

并在应用初始化时（如 `App.tsx` 或 `main.tsx`）调用 `setUseAppStoreRef(() => useAppStore)`，与现有 `useAppStore.ts` 的 `setUseAIStoreRef` 模式对称。

**改造点 6**：`ServerMessage` 类型扩展

现有 `ServerMessage` 类型（`useAIStore.ts` 第 60-65 行）需要新增 `change` 类型：

```typescript
type ServerMessage =
  | { kind: 'tool_call'; requestId: string; tool: string; params: unknown }
  | { kind: 'pi_event'; event: string; data: unknown }
  | { kind: 'session_ready'; sessionId: string }
  | { kind: 'error'; message: string }
  | { kind: 'pong' }
  | { kind: 'change'; changeType: string; data: unknown; sourceDeviceId?: string }
```

**adapter.ts detectBackend 改造**（见 6.6 节末尾）：现有 `detectBackend`（第 10-48 行）硬编码 `/api/health`，改为可配置 baseURL。

### 6.3 HTTP 请求注入 Authorization 头

见 6.1 节 `getAuthHeaders()` 方法。

### 6.4 deviceId 生成与持久化

**新建文件**：`client/desktop/src/utils/deviceAuth.ts`

```typescript
import { v4 as uuidv4 } from 'uuid'

const DEVICE_ID_KEY = 'living-dashboard-device-id'
const SERVER_TOKEN_KEY = 'living-dashboard-server-token'

/**
 * 获取或生成 deviceId（localStorage 持久化）
 */
export function getDeviceId(): string {
  let id = localStorage.getItem(DEVICE_ID_KEY)
  if (!id) {
    id = uuidv4()
    localStorage.setItem(DEVICE_ID_KEY, id)
    console.log(`[DeviceAuth] Generated new deviceId: ${id}`)
  }
  return id
}

/**
 * 获取服务器 token
 * 优先级：localStorage（设置面板）> 环境变量 VITE_SERVER_TOKEN > null
 */
export function getServerToken(): string | null {
  const stored = localStorage.getItem(SERVER_TOKEN_KEY)
  if (stored) return stored
  const envToken = import.meta.env.VITE_SERVER_TOKEN
  if (envToken) return envToken
  return null
}

/**
 * 设置服务器 token（设置面板调用）
 */
export function setServerToken(token: string | null): void {
  if (token) {
    localStorage.setItem(SERVER_TOKEN_KEY, token)
  } else {
    localStorage.removeItem(SERVER_TOKEN_KEY)
  }
  console.log(`[DeviceAuth] Server token ${token ? 'updated' : 'cleared'}`)
}
```

**说明**：直接使用项目已有的 `uuid` 包（`useAppStore.ts`、`useAIStore.ts` 等已使用 `import { v4 as uuidv4 } from 'uuid'`），保持代码库一致性，不再手动实现 UUID 生成。

### 6.5 token 配置（环境变量 + 设置面板）

**环境变量**：`.env.local` 中配置 `VITE_SERVER_TOKEN`

**设置面板**：在 `SettingsPanel.tsx` 中新增"服务器配置"区块：

```tsx
// 在 SettingsPanel.tsx 中新增
// 注意：SettingsPanel.tsx 第 1 行已 import { useState, useRef } from 'react'，
// 复用现有 useState import，无需重复导入
import { getServerToken, setServerToken } from '../utils/deviceAuth'
import { getDeviceId } from '../utils/deviceAuth'

function ServerConfigSection() {
  const [token, setToken] = useState(getServerToken() || '')
  const [apiBaseUrl, setApiBaseUrl] = useState(import.meta.env.VITE_API_BASE_URL || '/api')
  const [wsUrl, setWsUrl] = useState(import.meta.env.VITE_WS_URL || '')
  const deviceId = getDeviceId()

  const handleSaveToken = () => {
    setServerToken(token || null)
    alert('Token 已保存，重新连接 WS 后生效')
  }

  return (
    <div className="space-y-4">
      <h3>服务器配置</h3>
      <div>
        <label className="block text-sm font-medium mb-1">设备 ID（只读）</label>
        <input type="text" value={deviceId} readOnly className="w-full px-3 py-2 bg-gray-100 rounded" />
      </div>
      <div>
        <label className="block text-sm font-medium mb-1">API Base URL</label>
        <input type="text" value={apiBaseUrl} readOnly className="w-full px-3 py-2 bg-gray-100 rounded" />
        <p className="text-xs text-gray-500 mt-1">通过 .env.local 的 VITE_API_BASE_URL 配置</p>
      </div>
      <div>
        <label className="block text-sm font-medium mb-1">WS URL</label>
        <input type="text" value={wsUrl} readOnly className="w-full px-3 py-2 bg-gray-100 rounded" />
        <p className="text-xs text-gray-500 mt-1">通过 .env.local 的 VITE_WS_URL 配置</p>
      </div>
      <div>
        <label className="block text-sm font-medium mb-1">服务器 Token</label>
        <input
          type="password"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder="输入服务器 token"
          className="w-full px-3 py-2 border rounded"
        />
        <button onClick={handleSaveToken} className="mt-2 px-4 py-2 bg-blue-500 text-white rounded">
          保存 Token
        </button>
      </div>
    </div>
  )
}
```

### 6.6 数据同步（IDB 异步预写 + syncQueue 回写）

**新建文件**：`client/desktop/src/utils/syncQueue.ts`

```typescript
import { api } from '../api/client'

const SYNC_QUEUE_DB = 'living-dashboard-sync'
const SYNC_QUEUE_STORE = 'pendingOps'
const SYNC_FLUSH_INTERVAL_MS = 60_000

export interface SyncQueueEntry {
  id: string
  operation: 'create' | 'update' | 'delete'
  entityType: string
  entityId: string
  payload: unknown
  createdAt: number
  retryCount: number
}

let flushTimer: ReturnType<typeof setInterval> | null = null
let isFlushing = false

/**
 * 初始化 syncQueue（应用启动时调用）
 */
export async function initSyncQueue(): Promise<void> {
  // 启动定时刷新
  if (!flushTimer) {
    flushTimer = setInterval(() => {
      flushSyncQueue().catch((err) => {
        console.error('[SyncQueue] Flush failed:', err)
      })
    }, SYNC_FLUSH_INTERVAL_MS)
  }
}

/**
 * 添加操作到 syncQueue
 * 当 API 不可用时调用
 */
export async function enqueueSyncOp(entry: Omit<SyncQueueEntry, 'id' | 'createdAt' | 'retryCount'>): Promise<void> {
  const fullEntry: SyncQueueEntry = {
    ...entry,
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: Date.now(),
    retryCount: 0,
  }
  await addToIdbQueue(fullEntry)
  console.log(`[SyncQueue] Enqueued: ${entry.operation} ${entry.entityType}/${entry.entityId}`)
}

/**
 * 刷新 syncQueue（API 恢复后批量回写）
 */
export async function flushSyncQueue(): Promise<void> {
  if (isFlushing) return
  isFlushing = true

  try {
    const entries = await getAllFromIdbQueue()
    if (entries.length === 0) return

    console.log(`[SyncQueue] Flushing ${entries.length} entries`)

    for (const entry of entries) {
      try {
        await executeSyncOp(entry)
        await removeFromIdbQueue(entry.id)
        console.log(`[SyncQueue] Synced: ${entry.operation} ${entry.entityType}/${entry.entityId}`)
      } catch (err) {
        console.warn(`[SyncQueue] Failed to sync ${entry.id}:`, err)
        // 增加重试计数，超过 5 次放弃
        entry.retryCount++
        if (entry.retryCount >= 5) {
          await removeFromIdbQueue(entry.id)
          console.error(`[SyncQueue] Giving up on ${entry.id} after 5 retries`)
        } else {
          await updateInIdbQueue(entry)
        }
      }
    }
  } finally {
    isFlushing = false
  }
}

/**
 * 获取 syncQueue 长度
 */
export async function getSyncQueueSize(): Promise<number> {
  const entries = await getAllFromIdbQueue()
  return entries.length
}

/**
 * 执行单个同步操作
 * 注意：create 用 POST，update 用 PUT（与 RESTful 约定一致）
 * - panels create: POST /api/panels
 * - widgets create: POST /api/panels/:panelId/widgets（payload 需包含 panelId）
 * - entities create: POST /api/entities
 */
async function executeSyncOp(entry: SyncQueueEntry): Promise<void> {
  const { operation, entityType, entityId, payload } = entry
  const p = payload as Record<string, unknown>

  switch (entityType) {
    case 'panel':
      if (operation === 'create') {
        await api.post('/panels', payload)
      } else if (operation === 'update') {
        await api.put(`/panels/${entityId}`, payload)
      } else if (operation === 'delete') {
        await api.delete(`/panels/${entityId}`)
      }
      break
    case 'widget':
      if (operation === 'create') {
        // widget create 需要 panelId（POST /api/panels/:panelId/widgets）
        const panelId = p.panelId as string
        if (!panelId) throw new Error('[SyncQueue] widget create missing panelId in payload')
        await api.post(`/panels/${panelId}/widgets`, payload)
      } else if (operation === 'update') {
        await api.put(`/widgets/${entityId}`, payload)
      } else if (operation === 'delete') {
        await api.delete(`/widgets/${entityId}`)
      }
      break
    case 'entity':
      if (operation === 'create') {
        await api.post('/entities', payload)
      } else if (operation === 'update') {
        await api.put(`/entities/${entityId}`, payload)
      } else if (operation === 'delete') {
        await api.delete(`/entities/${entityId}`)
      }
      break
    case 'settings':
      if (operation === 'update') {
        await api.put('/settings', payload)
      }
      break
    default:
      console.warn(`[SyncQueue] Unknown entityType: ${entityType}`)
  }
}

// ============================================================================
// IndexedDB 操作（syncQueue 自己的 IDB store）
// ============================================================================

function openSyncDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(SYNC_QUEUE_DB, 1)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(SYNC_QUEUE_STORE)) {
        db.createObjectStore(SYNC_QUEUE_STORE, { keyPath: 'id' })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function addToIdbQueue(entry: SyncQueueEntry): Promise<void> {
  const db = await openSyncDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(SYNC_QUEUE_STORE, 'readwrite')
    tx.objectStore(SYNC_QUEUE_STORE).add(entry)
    tx.oncomplete = () => { db.close(); resolve() }
    tx.onerror = () => { db.close(); reject(tx.error) }
  })
}

async function getAllFromIdbQueue(): Promise<SyncQueueEntry[]> {
  const db = await openSyncDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(SYNC_QUEUE_STORE, 'readonly')
    const req = tx.objectStore(SYNC_QUEUE_STORE).getAll()
    req.onsuccess = () => { db.close(); resolve(req.result as SyncQueueEntry[]) }
    req.onerror = () => { db.close(); reject(req.error) }
  })
}

async function removeFromIdbQueue(id: string): Promise<void> {
  const db = await openSyncDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(SYNC_QUEUE_STORE, 'readwrite')
    tx.objectStore(SYNC_QUEUE_STORE).delete(id)
    tx.oncomplete = () => { db.close(); resolve() }
    tx.onerror = () => { db.close(); reject(tx.error) }
  })
}

async function updateInIdbQueue(entry: SyncQueueEntry): Promise<void> {
  const db = await openSyncDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(SYNC_QUEUE_STORE, 'readwrite')
    tx.objectStore(SYNC_QUEUE_STORE).put(entry)
    tx.oncomplete = () => { db.close(); resolve() }
    tx.onerror = () => { db.close(); reject(tx.error) }
  })
}
```

**withFallback 改造**（`client/desktop/src/api/adapter.ts`）：

现有 `withFallback`（第 66-98 行）在 API 失败时降级到 IDB，但不回写。改造为：API 失败时写 IDB + syncQueue：

```typescript
// adapter.ts 顶部新增 import（与现有 import 一起）
import { enqueueSyncOp, flushSyncQueue } from '../utils/syncQueue'

// 通用请求包装：API 优先，失败时降级到 IDB + syncQueue
export async function withFallback<T>(
  apiFn: () => Promise<T>,
  idbFn: () => Promise<T>,
  syncOp?: { operation: 'create' | 'update' | 'delete'; entityType: string; entityId: string; payload: unknown }
): Promise<T> {
  if (currentBackend === 'api') {
    try {
      const result = await apiFn()
      // API 成功：异步预写 IDB（保证离线可用）
      // 注意：预写不能阻塞主流程，且不能影响返回值
      return result
    } catch (err) {
      console.warn('[Storage] API failed, falling back to IDB:', err)
      apiAvailable = false
      currentBackend = 'idb'
      const idbResult = await idbFn()
      // 如果是写操作，加入 syncQueue
      if (syncOp) {
        enqueueSyncOp(syncOp).catch((e) => {
          console.error('[Storage] Failed to enqueue sync op:', e)
        })
      }
      return idbResult
    }
  }
  // IDB 模式
  const idbResult = await idbFn()
  if (Array.isArray(idbResult) && idbResult.length === 0) {
    try {
      const apiResult = await apiFn()
      if (Array.isArray(apiResult) && apiResult.length > 0) {
        apiAvailable = true
        currentBackend = 'api'
        console.log('[Storage] API has data, switching back to api')
        return apiResult
      }
    } catch {
      // API 仍然不可用
    }
  }
  // IDB 模式下的写操作也加入 syncQueue
  if (syncOp) {
    enqueueSyncOp(syncOp).catch((e) => {
      console.error('[Storage] Failed to enqueue sync op:', e)
    })
  }
  return idbResult
}
```

**注意**：现有 `db.ts` 中所有 `withFallback` 调用需要补充 `syncOp` 参数。这是大量改动，但模式统一。以 `savePanel` 为例：

```typescript
export async function savePanel(panel: Panel): Promise<void> {
  return withFallback(
    async () => {
      try {
        await panelsApi.updatePanel(panel.id, {
          name: panel.name,
          sortOrder: panel.order,
          settings: panel.settings as Record<string, unknown>,
          canvasTransform: panel.canvasTransform as Record<string, unknown> | null ?? null,
        })
      } catch (err: unknown) {
        if (isNotFoundError(err)) {
          await panelsApi.createPanel({
            id: panel.id,
            name: panel.name,
            sortOrder: panel.order,
            settings: panel.settings as Record<string, unknown>,
            canvasTransform: panel.canvasTransform as Record<string, unknown> | null ?? null,
          })
          return
        }
        throw err
      }
    },
    async () => {
      await ensureV2Ready()
      await runIdbTransaction([PANEL_STORE], 'readwrite', async (ctx) => {
        await upsertRecord(ctx, PANEL_STORE, panel.id, v1PanelToV2Data(panel))
      })
    },
    {
      operation: 'update',
      entityType: 'panel',
      entityId: panel.id,
      payload: {
        name: panel.name,
        sortOrder: panel.order,
        settings: panel.settings,
        canvasTransform: panel.canvasTransform,
      },
    }
  )
}
```

**所有写操作函数的 syncOp 清单**（读操作不需要 syncOp）：

下表列出 `db.ts` 中所有需要补充 `syncOp` 参数的写操作函数（共约 40 个，对应 65 处 withFallback 调用中的写操作部分）。读操作（如 `loadAllData`、`getStrokesByPanel`、`getConnectionsByPanel` 等）不需要 syncOp。

| 函数名 | operation | entityType | entityId | payload 来源 |
|--------|-----------|------------|----------|--------------|
| `savePanel` | `update` | `panel` | `panel.id` | `{ name, sortOrder, settings, canvasTransform }` |
| `deletePanel` | `delete` | `panel` | `panelId` | `{}` |
| `saveWidgets` | `update` | `widget` | （批量，见说明） | `widgets` 数组（每项含 panelId） |
| `savePositions` | `update` | `widget` | （批量） | `positions` 数组 |
| `saveActivePanelId` | `update` | `settings` | `activePanelId` | `{ activePanelId: panelId }` |
| `saveSettings` | `update` | `settings` | `settings` | `settings` 对象 |
| `saveDynamicWidget` | `update` | `dynamicWidget` | `def.widgetType` | `def` 对象 |
| `deleteDynamicWidget` | `delete` | `dynamicWidget` | `widgetType` | `{}` |
| `savePlaylist` | `update` | `playlist` | `playlist.id` | `playlist` 对象 |
| `deletePlaylist` | `delete` | `playlist` | `widgetId` | `{}` |
| `saveFocusSession` | `update` | `focusSession` | `session.id` | `session` 对象 |
| `deleteFocusSession` | `delete` | `focusSession` | `id` | `{}` |
| `deleteFocusSessionsByPanel` | `delete` | `focusSession` | （批量） | `{ panelId }` |
| `deleteFocusSessionsByWidget` | `delete` | `focusSession` | （批量） | `{ widgetId }` |
| `saveTask` | `update` | `task` | `task.id` | `task` 对象 |
| `deleteTask` | `delete` | `task` | `id` | `{}` |
| `deleteTasksByPanel` | `delete` | `task` | （批量） | `{ panelId }` |
| `saveHabit` | `update` | `habit` | `habit.id` | `habit` 对象 |
| `deleteHabit` | `delete` | `habit` | `id` | `{}` |
| `deleteHabitsByPanel` | `delete` | `habit` | （批量） | `{ panelId }` |
| `deleteHabitCheckin` | `delete` | `habitCheckin` | `id` | `{}` |
| `deleteHabitCheckinsByPanel` | `delete` | `habitCheckin` | （批量） | `{ panelId }` |
| `createMoodEntry` | `create` | `moodEntry` | `entry.id` | `entry` 对象 |
| `updateMoodEntryLevel` | `update` | `moodEntry` | `id` | `{ level }` |
| `updateMoodEntryNote` | `update` | `moodEntry` | `id` | `{ note }` |
| `deleteMoodEntriesByPanel` | `delete` | `moodEntry` | （批量） | `{ panelId }` |
| `saveCalendarEvent` | `update` | `calendarEvent` | `event.id` | `event` 对象 |
| `deleteCalendarEvent` | `delete` | `calendarEvent` | `id` | `{}` |
| `deleteCalendarEventsByPanel` | `delete` | `calendarEvent` | （批量） | `{ panelId }` |
| `saveStroke` | `update` | `entity` | `stroke.id` | `{ type: 'drawingStroke', panelId, data: stroke }` |
| `saveStrokesBatch` | `update` | `entity` | （批量） | `strokes` 数组 |
| `deleteStroke` | `delete` | `entity` | `id` | `{}` |
| `deleteStrokesBatch` | `delete` | `entity` | （批量） | `{ ids }` |
| `deleteStrokesByPanel` | `delete` | `entity` | （批量） | `{ panelId, type: 'drawingStroke' }` |
| `saveConnection` | `update` | `entity` | `conn.id` | `{ type: 'widgetConnection', panelId, data: conn }` |
| `deleteConnection` | `delete` | `entity` | `id` | `{}` |
| `deleteConnectionsBatch` | `delete` | `entity` | （批量） | `{ ids }` |
| `deleteConnectionsByPanel` | `delete` | `entity` | （批量） | `{ panelId, type: 'widgetConnection' }` |
| `deleteConnectionsByWidget` | `delete` | `entity` | （批量） | `{ panelId, widgetId }` |

**说明**：
1. **批量操作**：对于 `saveWidgets`、`saveStrokesBatch` 等批量函数，syncOp 的 `entityId` 可设为空字符串或 `'batch'`，`payload` 包含完整数组。`executeSyncOp` 需要扩展支持批量（或在 `enqueueSyncOp` 中拆分为多个单独 entry）。推荐做法：在 `enqueueSyncOp` 内部检测数组 payload，自动拆分为多个 entry。
2. **entity 类型映射**：strokes 和 connections 在 IDB 中是独立 store，但在服务器端存储为 `entities` 表（`type='drawingStroke'` 或 `type='widgetConnection'`）。syncOp 的 `entityType` 统一为 `'entity'`，payload 中包含 `type` 字段区分。
3. **settings 类型**：`saveActivePanelId` 和 `saveSettings` 都映射到 `entityType='settings'`，`entityId` 用 key 名（`activePanelId` 或 `settings`）。
4. **读操作不补充 syncOp**：如 `loadAllData`、`getStrokesByPanel`、`getConnectionsByPanel`、`getAllFromIdbQueue` 等纯读函数不需要 syncOp 参数。
5. **upsertRecord**：这是底层 IDB 工具函数，不直接暴露给业务层，不需要 syncOp（由上层调用方如 `savePanel` 补充）。

**adapter.ts detectBackend 改造**：

现有 `detectBackend`（第 10-48 行）硬编码 `/api/health`。改造为可配置：

```typescript
export async function detectBackend(): Promise<StorageBackend> {
  const MAX_RETRIES = 10
  apiAvailable = false
  const healthUrl = (import.meta.env.VITE_API_BASE_URL || '/api') + '/health'

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(healthUrl, { signal: AbortSignal.timeout(3000) })
      if (res.ok) {
        apiAvailable = true
        break
      }
    } catch {
      // 本次探测失败
    }
    if (attempt < MAX_RETRIES) {
      console.log(`[Storage] Retrying backend detection (attempt ${attempt}/${MAX_RETRIES})...`)
      await new Promise((resolve) => setTimeout(resolve, 1000))
    }
  }
  currentBackend = apiAvailable ? 'api' : 'idb'
  console.log('[Storage] Backend detected:', currentBackend)

  // 启动定时健康检查
  if (!healthCheckInterval) {
    healthCheckInterval = setInterval(async () => {
      if (currentBackend === 'idb') {
        try {
          const res = await fetch(healthUrl, { signal: AbortSignal.timeout(2000) })
          if (res.ok) {
            apiAvailable = true
            currentBackend = 'api'
            console.log('[Storage] API recovered, switching back to api')
            // API 恢复后，刷新 syncQueue
            flushSyncQueue().catch((err) => {
              console.error('[Storage] SyncQueue flush failed:', err)
            })
          }
        } catch { /* still down */ }
      }
    }, 30000)
  }

  return currentBackend
}
```

### 6.7 useAppStore 新增 refresh 方法

**文件**：`client/desktop/src/stores/useAppStore.ts`（修改）

现有 `useAppStore.ts` 的 `initialize` 方法（约第 387-669 行）包含完整的数据加载逻辑（API 模式 + IDB 降级模式）。为了支持 WS 变更广播触发的局部刷新，需要新增三个 refresh 方法。

**现状分析**：
- `initialize` 方法一次性加载所有数据（panels + panelWidgets + panelPositions + settings + dynamicWidgets + canvasTransform）
- 现有代码没有独立的 `loadPanels`、`loadWidgets`、`loadSettings` 函数，所有加载逻辑都在 `initialize` 闭包内
- 直接复用 `initialize` 会重复执行迁移检测、runtimeModeManager.start() 等副作用

**改造方案**：新增三个轻量级 refresh 方法，只重新拉取对应数据并 set，不执行迁移和副作用。

在 `useAppStore.ts` 的 store 创建闭包内新增：

```typescript
// ============================================================================
// Phase 3 新增：WS 变更广播触发的局部刷新
// ============================================================================

/**
 * 刷新面板列表（WS 收到 panel_* 变更时调用）
 * 重新拉取所有 panels + activePanelId，更新 store
 */
async function refreshPanels(): Promise<void> {
  try {
    const [panelsData, activeId] = await Promise.all([
      panelsApi.getAllPanels(),
      panelsApi.getActivePanelId(),
    ])
    const panels = panelsData.sort((a, b) => a.sortOrder - b.sortOrder)

    // 重新拉取每个面板的 widgets（因为面板顺序可能变化）
    // 注意：widget 映射必须与 initialize（第 447-455 行）完全一致，
    // 包含 state/minimized/locked/colorScheme/isPrimary 全部字段，
    // 否则刷新后 widget 会丢失运行时状态（如 minimized、colorScheme）
    const panelWidgets: Record<string, WidgetInstance[]> = {}
    const panelPositions: Record<string, WidgetPosition[]> = {}
    for (const panel of panels) {
      const ws = await widgetsApi.getPanelWidgets(panel.id)
      panelWidgets[panel.id] = ws.map(w => ({
        widgetId: w.id,
        widgetType: w.type,
        state: w.state,
        minimized: w.minimized,
        locked: w.locked,
        colorScheme: w.colorScheme ?? undefined,
        isPrimary: w.isPrimary ?? false,
      }))
      panelPositions[panel.id] = ws.map(w => ({
        widgetId: w.id,
        x: w.x, y: w.y, w: w.width, h: w.height, zIndex: w.zIndex,
      }))
    }

    set(state => ({
      panels,
      activePanelId: activeId ?? state.activePanelId,
      panelWidgets,
      panelPositions,
    }))
    console.log(`[useAppStore] refreshPanels: ${panels.length} panels loaded`)
  } catch (err) {
    console.error('[useAppStore] refreshPanels failed:', err)
  }
}

/**
 * 刷新 widgets（WS 收到 widget_* 变更时调用）
 * 重新拉取当前活跃面板的 widgets
 */
async function refreshWidgets(): Promise<void> {
  try {
    const state = get()
    const activeId = state.activePanelId
    if (!activeId) return

    const ws = await widgetsApi.getPanelWidgets(activeId)
    // 注意：widget 映射必须与 initialize（第 447-455 行）完全一致，
    // 包含 state/minimized/locked/colorScheme/isPrimary 全部字段
    const widgetInstances = ws.map(w => ({
      widgetId: w.id,
      widgetType: w.type,
      state: w.state,
      minimized: w.minimized,
      locked: w.locked,
      colorScheme: w.colorScheme ?? undefined,
      isPrimary: w.isPrimary ?? false,
    }))
    const positions = ws.map(w => ({
      widgetId: w.id,
      x: w.x, y: w.y, w: w.width, h: w.height, zIndex: w.zIndex,
    }))

    set(state => ({
      panelWidgets: { ...state.panelWidgets, [activeId]: widgetInstances },
      panelPositions: { ...state.panelPositions, [activeId]: positions },
    }))
    console.log(`[useAppStore] refreshWidgets: ${widgetInstances.length} widgets loaded for panel ${activeId}`)
  } catch (err) {
    console.error('[useAppStore] refreshWidgets failed:', err)
  }
}

/**
 * 刷新设置（WS 收到 settings_updated 变更时调用）
 */
async function refreshSettings(): Promise<void> {
  try {
    const settingsData = await settingsApi.getSettings()
    set({ settings: settingsData })
    console.log('[useAppStore] refreshSettings: settings loaded')
  } catch (err) {
    console.error('[useAppStore] refreshSettings failed:', err)
  }
}
```

**在 `useAppStore` 的返回对象中导出这三个方法**（在 store 创建函数的 return 语句中新增）：

```typescript
return {
  // ... 现有属性和方法 ...
  refreshPanels,
  refreshWidgets,
  refreshSettings,
}
```

**注意**：这三个方法需要在 `useAppStore` 的 TypeScript 接口（如果存在）中声明返回类型。如果 `useAppStore` 使用 `create<AppStoreState>()` 模式，需要在 `AppStoreState` 接口中新增：

```typescript
refreshPanels: () => Promise<void>
refreshWidgets: () => Promise<void>
refreshSettings: () => Promise<void>
```

**循环依赖处理**：`useAIStore.ts` 需要调用 `useAppStore.getState().refreshPanels()` 等，但两个 store 之间已有循环依赖处理机制（`useAppStore.ts` 第 73-80 行的 `setUseAIStoreRef` / `getUseAIStore`）。需要在 `useAIStore.ts` 中新增对称的 `setUseAppStoreRef` / `getUseAppStore`（见 6.2 节改造点 5），并在应用初始化时互相设置 ref。

**初始化时机**（在 `App.tsx` 或 `main.tsx` 中）：

```typescript
import { useAppStore, setUseAIStoreRef } from './stores/useAppStore'
import { useAIStore, setUseAppStoreRef } from './stores/useAIStore'

// 互相设置 ref，解决循环依赖
setUseAIStoreRef(() => useAIStore)
setUseAppStoreRef(() => useAppStore)
```

---

## 七、Docker 部署

### 7.1 Dockerfile（多阶段构建）

**新建文件**：`server/Dockerfile`

```dockerfile
# ============================================================================
# Stage 1: Build
# ============================================================================
FROM node:20-alpine AS builder

WORKDIR /app

# 复制 package.json 和 package-lock.json（利用 Docker 缓存）
COPY server/package.json server/package-lock.json ./

# 安装所有依赖（含 devDependencies，用于 tsc 编译）
RUN npm ci

# 复制源代码
COPY server/tsconfig.json ./
COPY server/src ./src

# 编译 TypeScript
RUN npm run build

# ============================================================================
# Stage 2: Runtime
# ============================================================================
FROM node:20-alpine AS runtime

WORKDIR /app

# 安装 dumb-init（用于正确处理信号）
# 安装 python3/make/g++：docker-migrate.bat 在 runtime 阶段动态 import better-sqlite3，
# 该原生模块需要编译工具链（node-gyp）。即使生产依赖不含 better-sqlite3，
# 迁移脚本运行时才加载，保留工具链以防编译失败（M7 修复）
RUN apk add --no-cache dumb-init python3 make g++

# 复制 package.json 和 package-lock.json
COPY server/package.json server/package-lock.json ./

# 只安装生产依赖
# 注意：better-sqlite3 需要作为 devDependency 保留（迁移脚本用），
# 但生产运行时通过 docker-migrate.bat 临时安装（见 docker-migrate.bat 说明）
RUN npm ci --omit=dev && npm cache clean --force

# 复制编译结果
COPY --from=builder /app/dist ./dist

# 暴露端口
EXPOSE 3456

# 使用 dumb-init 处理信号
ENTRYPOINT ["dumb-init", "--"]

# 启动命令
CMD ["node", "dist/index.js"]
```

### 7.2 docker-compose.yml

**新建文件**：`docker-compose.yml`（项目根目录）

```yaml
services:
  postgres:
    image: postgres:16-alpine
    container_name: living-dashboard-postgres
    restart: unless-stopped
    environment:
      POSTGRES_USER: ${POSTGRES_USER:-livingdashboard}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-livingdashboard}
      POSTGRES_DB: ${POSTGRES_DB:-living_dashboard}
    ports:
      - "${PG_PORT:-5432}:5432"
    volumes:
      # 数据卷挂载到非 C 盘路径（Windows: F:\allmylife\event\data\pgdata）
      - ${PGDATA_HOST_PATH:-F:/allmylife/event/data/pgdata}:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${POSTGRES_USER:-livingdashboard} -d ${POSTGRES_DB:-living_dashboard}"]
      interval: 10s
      timeout: 5s
      retries: 5
    networks:
      - living-dashboard-net

  server:
    build:
      context: .
      dockerfile: server/Dockerfile
    container_name: living-dashboard-server
    restart: unless-stopped
    depends_on:
      postgres:
        condition: service_healthy
    environment:
      NODE_ENV: production
      PORT: 3456
      DATABASE_URL: postgresql://${POSTGRES_USER:-livingdashboard}:${POSTGRES_PASSWORD:-livingdashboard}@postgres:5432/${POSTGRES_DB:-living_dashboard}
      SERVER_TOKEN: ${SERVER_TOKEN:-}
      PI_MODEL: ${PI_MODEL:-stepfun/step-3.7-flash}
      VITE_STEPFUN_API_KEY: ${STEPFUN_API_KEY:-}
    ports:
      - "${SERVER_PORT:-3456}:3456"
    networks:
      - living-dashboard-net

networks:
  living-dashboard-net:
    driver: bridge
```

### 7.3 .env.example

**新建文件**：`.env.example`（项目根目录）

```bash
# ============================================================================
# Living Dashboard Phase 3 环境变量配置
# ============================================================================

# PostgreSQL 配置
POSTGRES_USER=livingdashboard
POSTGRES_PASSWORD=livingdashboard
POSTGRES_DB=living_dashboard
PG_PORT=5432
# PostgreSQL 数据卷挂载路径（非 C 盘）
PGDATA_HOST_PATH=F:/allmylife/event/data/pgdata

# 服务器配置
SERVER_PORT=3456
# 共享 token（客户端连接需要携带，为空则不启用认证）
SERVER_TOKEN=

# Pi Agent 配置
PI_MODEL=stepfun/step-3.7-flash
# StepFun API Key
STEPFUN_API_KEY=

# 客户端配置（.env.local 中配置，不在服务器 .env 中）
# VITE_API_BASE_URL=http://localhost:3456/api
# VITE_WS_URL=ws://localhost:3456/ws
# VITE_SERVER_TOKEN=
```

**客户端 `.env.local.example`**：

```bash
# 客户端环境变量（.env.local）
# API Base URL（默认 /api，通过 Vite proxy 转发；远程部署时改为完整 URL）
VITE_API_BASE_URL=http://localhost:3456/api
# WS URL（默认 ws://localhost:3456/ws）
VITE_WS_URL=ws://localhost:3456/ws
# 服务器 token（与服务器 SERVER_TOKEN 一致）
VITE_SERVER_TOKEN=
```

### 7.4 数据卷与网络

**数据卷**：
- PostgreSQL 数据：`${PGDATA_HOST_PATH:-F:/allmylife/event/data/pgdata}:/var/lib/postgresql/data`
  - Windows 默认：`F:/allmylife/event/data/pgdata`
  - Linux/Mac 默认：`./data/pgdata`（需调整 .env）
- 服务器无状态化：不挂载数据卷（所有数据在 PostgreSQL）

**网络**：
- `living-dashboard-net`（bridge 网络）
- postgres 和 server 在同一网络
- server 通过 `postgres:5432` 连接数据库
- 外部通过 `${SERVER_PORT:-3456}` 访问 server

**端口暴露**：
- `5432`（PostgreSQL，可选暴露用于调试）
- `3456`（server HTTP + WS）

### 7.5 启动/停止脚本

**新建文件**：`docker-up.bat`（Windows）

```bat
@echo off
echo Starting Living Dashboard (Docker Compose)...
docker compose --env-file .env up -d
if errorlevel 1 (
    echo Failed to start. Check .env file exists.
    pause
    exit /b 1
)
echo.
echo Services started:
echo   - PostgreSQL: localhost:5432
echo   - Server:     http://localhost:3456
echo.
echo View logs: docker compose logs -f
echo Stop:      docker-down.bat
```

**新建文件**：`docker-down.bat`（Windows）

```bat
@echo off
echo Stopping Living Dashboard (Docker Compose)...
docker compose down
echo Services stopped.
```

**新建文件**：`docker-logs.bat`（Windows）

```bat
@echo off
docker compose logs -f
```

**新建文件**：`docker-migrate.bat`（Windows，从 SQLite 迁移数据到 PG）

```bat
@echo off
echo Migrating data from SQLite to PostgreSQL...
echo Ensure PostgreSQL container is running: docker-up.bat
echo.
docker compose exec server node -e "import('./dist/db/migrateFromSqlite.js').then(m => m.migrateFromSqlite()).then(r => { console.log('Migration report:', r); process.exit(0); }).catch(e => { console.error(e); process.exit(1); })"
pause
```

---

## 八、实施步骤（按顺序，每步可独立验证）

### 步骤 1：安装 pg 依赖，移除 better-sqlite3

**操作**：
```bash
cd server
npm install pg @types/pg
# 暂时保留 better-sqlite3（迁移脚本需要）
```

**验证**：`server/package.json` 中出现 `pg` 和 `@types/pg`

### 步骤 2：重写 connection.ts

**操作**：按 3.2 节重写 `server/src/db/connection.ts`

**验证**：
```bash
cd server
npx tsc --noEmit
```
无类型错误。

### 步骤 3：重写 schema.ts

**操作**：按 3.6 节重写 `server/src/db/schema.ts`

**验证**：`npx tsc --noEmit` 无错误

### 步骤 4：重写 seed.ts

**操作**：按 3.5 节重写 `server/src/db/seed.ts`

**验证**：`npx tsc --noEmit` 无错误

### 步骤 5：改造所有路由 handler（10 个文件）

**操作**：按 3.3 节模式改造以下文件：
- `server/src/routes/panels.ts`
- `server/src/routes/widgets.ts`
- `server/src/routes/entities.ts`
- `server/src/routes/relations.ts`
- `server/src/routes/scopes.ts`
- `server/src/routes/settings.ts`
- `server/src/routes/export.ts`
- `server/src/routes/import.ts`
- `server/src/routes/dynamicWidgets.ts`
- `server/src/routes/panelTemplates.ts`

**验证**：`npx tsc --noEmit` 无错误

### 步骤 6：改造 index.ts

**操作**：修改 `server/src/index.ts`：
1. `initDb()` → `await initDb()`（第 56 行）
2. `initializeSchema()` → `await initializeSchema()`（第 57 行）
3. `seedBuiltinTemplates()` → `await seedBuiltinTemplates()`（第 58 行）
4. `closeDb()` → `await closeDb()`（第 103 行，shutdown 函数内，需将 shutdown 改为 async）
5. 注册 authMiddleware（在 `/api/health` 路由之后、其他路由之前）
6. 移除 `console.log('[DB] SQLite initialized at:', db.name)`（PG 无 db.name 属性）

**改造后的完整 shutdown 函数代码**（替换现有第 98-107 行）：

```typescript
  // 优雅关闭（改为 async，确保 await closeDb() 在 process.exit(0) 之前完成）
  const shutdown = async (signal: string): Promise<void> => {
    console.log(`[Server] Shutting down (${signal})...`)
    try {
      await disposePiBridge()
    } catch (err) {
      console.error('[Server] Pi bridge dispose failed:', err)
    }
    try {
      await closeDb()
      console.log('[Server] Database closed')
    } catch (err) {
      console.error('[Server] Database close failed:', err)
    }
    process.exit(0)
  }
  process.on('SIGINT', () => { void shutdown('SIGINT') })
  process.on('SIGTERM', () => { void shutdown('SIGTERM') })
```

**关键变化**：
1. `shutdown` 从同步函数改为 `async` 函数
2. `closeDb()` → `await closeDb()`（确保 PG Pool 正确关闭，所有连接释放）
3. `disposePiBridge()` 也改为 `await`（已是 async，原来用 `.catch()` 现在用 try/catch 更清晰）
4. `process.on('SIGINT', ...)` 回调中用 `void shutdown('SIGINT')` 触发异步关闭（不阻塞信号处理）
5. `await closeDb()` 在 `process.exit(0)` 之前完成，确保数据库连接正确释放

**验证**：`npx tsc --noEmit` 无错误

### 步骤 7：新建 auth 中间件

**操作**：按 4.2 节新建 `server/src/middleware/auth.ts`

**验证**：`npx tsc --noEmit` 无错误

### 步骤 8：重写 ws.ts

**操作**：按 4.1 节重写 `server/src/ws.ts`

**验证**：`npx tsc --noEmit` 无错误

### 步骤 9：改造 piBridge.ts

**操作**：按 5.1、5.2、5.3 节修改 `server/src/piBridge.ts`

**验证**：`npx tsc --noEmit` 无错误

### 步骤 10：新建数据迁移脚本

**操作**：按 3.4 节新建 `server/src/db/migrateFromSqlite.ts`，在 `server/package.json` 中新增 script：
```json
"migrate": "tsx src/db/migrateFromSqlite.ts"
```

**验证**：`npx tsc --noEmit` 无错误

### 步骤 11：客户端 deviceAuth.ts

**操作**：按 6.4 节新建 `client/desktop/src/utils/deviceAuth.ts`

**验证**：`npm run typecheck` 无错误

### 步骤 12：改造客户端 useAIStore.ts（WS 连接携带 deviceId+token + change 消息处理）

**操作**：按 6.2 节修改 `client/desktop/src/stores/useAIStore.ts`：
1. 新增 `import { getDeviceId, getServerToken } from '../utils/deviceAuth'`
2. `WS_URL` 常量改为 `WS_URL_BASE`，新增 `buildWsUrl()` 函数
3. `connectWs()` 中 `new WebSocket(WS_URL)` 改为 `new WebSocket(wsUrl)`（wsUrl = buildWsUrl()）
4. `onopen` 日志使用 `wsUrl`（脱敏 token）
5. `ServerMessage` 类型新增 `change` 分支
6. `handleServerMessage` 新增 `case 'change'` 分支，调用 `handleServerChange`
7. 新增 `handleServerChange` 函数（调用 useAppStore 的 refresh 方法）
8. 新增 `setUseAppStoreRef` / `getUseAppStore` 解决循环依赖

**验证**：`npm run typecheck` 无错误

### 步骤 13：改造客户端 api/client.ts

**操作**：按 6.1 节修改 `client/desktop/src/api/client.ts`

**验证**：`npm run typecheck` 无错误

### 步骤 14：改造客户端 adapter.ts

**操作**：按 6.6 节修改 `client/desktop/src/api/adapter.ts`（detectBackend + withFallback）

**验证**：`npm run typecheck` 无错误

### 步骤 15：新建客户端 syncQueue.ts

**操作**：按 6.6 节新建 `client/desktop/src/utils/syncQueue.ts`

**验证**：`npm run typecheck` 无错误

### 步骤 16：改造客户端 db.ts（withFallback 调用补充 syncOp）

**操作**：按 6.6 节模式，给 `client/desktop/src/utils/db.ts` 中所有 `withFallback` 调用补充 `syncOp` 参数

**验证**：`npm run typecheck` 无错误

### 步骤 17：设置面板新增服务器配置

**操作**：按 6.5 节修改 `client/desktop/src/components/SettingsPanel.tsx`

**验证**：`npm run typecheck` 无错误

### 步骤 18：useAppStore 新增 refresh 方法 + 初始化 ref 互相设置

**操作**：
1. 按 6.7 节在 `client/desktop/src/stores/useAppStore.ts` 中新增 `refreshPanels`、`refreshWidgets`、`refreshSettings` 方法并导出
2. 在应用初始化入口（`App.tsx` 或 `main.tsx`）中调用 `setUseAIStoreRef(() => useAIStore)` 和 `setUseAppStoreRef(() => useAppStore)` 互相设置 ref

**验证**：`npm run typecheck` 无错误

### 步骤 19：新建 Dockerfile

**操作**：按 7.1 节新建 `server/Dockerfile`

**验证**：`docker build -f server/Dockerfile -t living-dashboard-server .` 成功

### 步骤 20：新建 docker-compose.yml

**操作**：按 7.2 节新建 `docker-compose.yml`

**验证**：`docker compose config` 无错误

### 步骤 21：新建 .env.example 和启动脚本

**操作**：按 7.3、7.5 节新建 `.env.example`、`docker-up.bat`、`docker-down.bat`、`docker-logs.bat`、`docker-migrate.bat`

**验证**：文件存在

### 步骤 22：端到端验证

**操作**：
1. 复制 `.env.example` 为 `.env`，配置 `STEPFUN_API_KEY` 和 `SERVER_TOKEN`
2. 运行 `docker-up.bat`
3. 运行 `docker-migrate.bat`（从现有 SQLite 迁移数据）
4. 客户端 `.env.local` 配置 `VITE_API_BASE_URL=http://localhost:3456/api`、`VITE_WS_URL=ws://localhost:3456/ws`、`VITE_SERVER_TOKEN=<与服务器一致>`
5. 启动客户端 `npm run dev`
6. 验证数据加载、WS 连接、AI 对话、浏览器工具

**验证**：见第九章验收标准

---

## 九、验收标准（含运行时验证项）

### 9.1 数据库迁移验收

| 验收项 | 验证方法 | 通过标准 |
|--------|----------|----------|
| PG 容器启动 | `docker compose ps` | postgres 状态为 healthy |
| Schema 初始化 | `docker compose exec postgres psql -U livingdashboard -d living_dashboard -c "\dt"` | 10 张表存在（含 sync_queue） |
| 数据迁移 | `docker-migrate.bat` | 迁移报告显示各表行数 > 0（除 activity_sessions 可能为 0） |
| API 健康检查 | `curl http://localhost:3456/api/health` | 返回 `{"status":"ok","timestamp":...}` |
| Panels 查询 | `curl -H "Authorization: Bearer <token>" http://localhost:3456/api/panels` | 返回面板数组 |
| Widgets 查询 | `curl -H "Authorization: Bearer <token>" http://localhost:3456/api/widgets/<id>` | 返回 widget 对象 |
| 无 token 拒绝 | `curl http://localhost:3456/api/panels`（SERVER_TOKEN 已设置时） | 返回 401 |

### 9.2 WS 多客户端验收

| 验收项 | 验证方法 | 通过标准 |
|--------|----------|----------|
| 单客户端连接 | 启动一个 Electron 客户端 | 服务器日志 `[WS] Client connected: deviceId=xxx, total=1` |
| 多客户端连接 | 启动两个 Electron 客户端（不同 deviceId） | 服务器日志 `total=2` |
| 同设备替换 | 同一 deviceId 重新连接 | 旧连接关闭，新连接建立，total 不变 |
| 无 token 拒绝 | WS 连接不携带 token（SERVER_TOKEN 已设置时） | 连接被 close 1008 |
| 心跳超时 | 客户端停止 ping 90 秒 | 服务器日志 `Heartbeat timeout, closing` |
| 变更广播 | 客户端 A 创建 panel | 客户端 B 收到 `change` 消息，刷新面板列表 |

### 9.3 Pi Agent 验收

| 验收项 | 验证方法 | 通过标准 |
|--------|----------|----------|
| Session 创建 | 启动服务器 | 日志 `[PiBridge] Agent session created (model: stepfun/step-3.7-flash)` |
| 模型可配置 | 设置 `PI_MODEL=stepfun/step-3.7-flash` | 日志显示对应模型 |
| user_message | 客户端发送消息 | 服务器日志 `Active device set: xxx`，agent 响应 |
| browser_* 路由 | 客户端 A 发送 user_message，agent 调用 browser_eval | tool_call 发送到客户端 A |
| 画布工具 | agent 调用 create_html_widget | tool_call 发送到活跃设备 |

### 9.4 客户端验收

| 验收项 | 验证方法 | 通过标准 |
|--------|----------|----------|
| deviceId 生成 | 首次启动客户端 | localStorage 中存在 `living-dashboard-device-id` |
| HTTP baseURL 可配置 | `.env.local` 设置 `VITE_API_BASE_URL=http://localhost:3456/api` | 网络请求发到 3456 端口 |
| Authorization 头 | 浏览器 DevTools Network 面板 | 请求头包含 `Authorization: Bearer xxx` |
| WS 连接携带参数 | 浏览器 DevTools Network WS 面板 | 连接 URL 包含 `?deviceId=xxx&token=xxx` |
| 数据加载 | 启动客户端 | 面板和 widget 正常显示 |
| 离线降级 | 关闭服务器，客户端写操作 | 写入 IDB，syncQueue 有待同步项 |
| 恢复回写 | 重新启动服务器 | syncQueue 清空，数据同步到 PG |
| 变更接收 | 客户端 A 修改 panel，客户端 B | 客户端 B 自动刷新 |

### 9.5 Docker 部署验收

| 验收项 | 验证方法 | 通过标准 |
|--------|----------|----------|
| 镜像构建 | `docker build -f server/Dockerfile -t living-dashboard-server .` | 构建成功 |
| Compose 启动 | `docker-up.bat` | 两个容器运行（postgres + server） |
| 数据持久化 | 重启容器 | 数据仍在 |
| 局域网访问 | 另一台机器配置 `VITE_API_BASE_URL=http://<server-ip>:3456/api` | 客户端可连接 |
| 非 C 盘数据 | 检查 `F:/allmylife/event/data/pgdata` | 目录存在且有数据 |

### 9.6 端到端验收

| 验收项 | 验证方法 | 通过标准 |
|--------|----------|----------|
| 完整流程 | Docker 部署 + 客户端连接 + AI 对话 | 全流程无错误 |
| 多端互通 | 两台客户端同时连接 | 都能收到变更广播 |
| 浏览器工具 | AI 调用 browser_navigate | 对应设备的 webview 导航 |
| 数据一致性 | 客户端 A 创建 widget，客户端 B 刷新 | 数据一致 |

---

## 十、风险与对策

### 10.1 数据迁移风险

**风险**：SQLite → PG 迁移过程中数据丢失或类型转换错误

**对策**：
1. 迁移前备份 SQLite 文件（`living-dashboard.db.backup-<timestamp>`）
2. 迁移脚本使用 `ON CONFLICT DO NOTHING`（幂等，可重试）
3. 迁移报告记录每表行数和错误
4. 迁移后用 `curl` 验证关键数据（panels/widgets 数量对比）

### 10.2 WS 多客户端冲突

**风险**：多客户端同时写同一数据，导致冲突

**对策**：
1. version 字段乐观锁（现有 schema 已有，但当前未启用）
2. last-write-wins（最后写入覆盖）
3. WS 广播变更，让其他客户端及时刷新
4. 后续可启用 version 检查（UPDATE ... WHERE version = $X）

### 10.3 browser_* 工具路由错误

**风险**：agent 调用 browser_* 工具时，目标设备不在线或 webview 不存在

**对策**：
1. `executeViaWs` 检查 `activeDeviceId` 是否在线
2. 不在线时返回错误 `no active device for browser tool`
3. agent 收到错误后可提示用户打开网页

### 10.4 Docker 网络问题

**风险**：Windows Docker 网络配置问题导致容器间无法通信

**对策**：
1. 使用 docker-compose 默认 bridge 网络
2. server 通过 `postgres:5432` 连接（服务名解析）
3. 健康检查确保 postgres 就绪后再启动 server

### 10.5 性能风险

**风险**：pg Pool 连接数过多或查询性能下降

**对策**：
1. Pool max=20（足够多客户端并发）
2. 索引完整（对照 SQLite 索引）
3. JSONB 查询比 SQLite TEXT JSON 解析更快
4. 监控 `pg_stat_activity`（连接数）

### 10.6 客户端兼容性

**风险**：现有客户端 withFallback 逻辑改动量大，可能引入 bug

**对策**：
1. withFallback 第三参数 `syncOp` 可选（向后兼容）
2. 逐步补充 syncOp（先核心写操作，后其他）
3. 现有 IDB store 不变（32 个 store 保持不变）

### 10.7 认证配置错误

**风险**：SERVER_TOKEN 配置不一致导致客户端无法连接

**对策**：
1. `.env.example` 提供模板
2. 设置面板可动态修改 token（无需重启）
3. 健康检查不需要认证（detectBackend 探测可用）

---

## 十一、修订记录

| 版本 | 日期 | 修订内容 | 作者 |
|------|------|----------|------|
| v1.0 | 2026-06-24 | 初始版本 | Phase 3 Spec 编写 |
| v1.1 | 2026-06-24 | 对抗审查修复：9 个致命问题（F1-F9）+ 5 个严重问题（S1-S5）+ 7 个中等问题（M1-M7）+ 4 个轻微问题（L1-L4）。详见下方修订说明 | 对抗审查修复 |

**v1.1 修订说明**：

**致命问题修复（F1-F9）**：
- F1：新增 5.1.1 节，改造 `forwardEventToClient` 使用 `broadcast` 替代 `sendToClient`，让 pi 事件广播到所有在线客户端
- F2/F3：删除 `sync_queue_flush` WS 消息类型、`SyncQueueItem` 接口、5.1 节中处理 `sync_queue_flush` 的代码和 `handleSyncQueueFlush` 调用，统一用 HTTP 回写方案（6.6 节 syncQueue.ts）
- F4：6.7 节 `refreshPanels` 和 `refreshWidgets` 的 widget 映射补全 `state/minimized/locked/colorScheme/isPrimary` 字段，与 `initialize` 完全一致
- F5：6.2 节改造点 5 `handleServerChange` 改用 `getUseAppStore().getState()`（ref 机制），删除 `import { useAppStore }` 行
- F6：6.1 节 client.ts 代码顶部添加 `import { getServerToken, getDeviceId } from '../utils/deviceAuth'`
- F7：6.6 节 adapter.ts 改造代码添加 `import { enqueueSyncOp, flushSyncQueue } from '../utils/syncQueue'`
- F8：6.6 节 `executeSyncOp` 的 create 分支改用 `api.post`，update 分支用 `api.put`，widget create 正确调用 `POST /api/panels/:panelId/widgets`
- F9：6.5 节 ServerConfigSection 说明复用 SettingsPanel.tsx 第 1 行已有的 `useState` import

**严重问题修复（S1-S5）**：
- S1：5.2 节 `createSession` API Key 注入改为根据 `PI_MODEL` 的 provider 部分动态注入，新增 `PI_API_KEY` 环境变量，保留 `VITE_STEPFUN_API_KEY` 向后兼容
- S2：3.3 节 panels.ts 所有 `broadcastChange` 调用统一传 `req.deviceId` 作为 `sourceDeviceId`
- S3：6.6 节新增所有写操作函数的 syncOp 清单表（约 40 个函数），包含 operation/entityType/entityId/payload
- S4：删除 `SyncQueueItem` 后与 `SyncQueueEntry` 的类型不匹配问题自动消失
- S5：步骤 6 新增改造后的完整 `shutdown` 函数代码（async + await closeDb() + try/catch）

**中等问题修复（M1-M7）**：
- M1：3.2 节 connection.ts 删除未使用的 `import path` 和 `DEFAULT_DATA_DIR` 常量
- M2：3.4 节 migrateFromSqlite.ts 删除未使用的 `import path`
- M3：7.2 节 docker-compose.yml 删除已弃用的 `version: '3.8'` 行
- M4：3.3 节 POST / 和 PUT /:id 中 `parsePanelRow` 结果存入变量复用，避免重复调用
- M5：6.7 节 `initialize` 行号引用修正为"约第 387-669 行"
- M6：6.4 节 deviceAuth.ts 改用 `import { v4 as uuidv4 } from 'uuid'`，保持代码库一致性
- M7：7.1 节 Dockerfile runtime 阶段添加 `apk add --no-cache python3 make g++` 以支持 better-sqlite3 原生模块编译

**轻微问题修复（L1-L4）**：
- L1：1.3 节现状基线表 WS URL 措辞改为"基础 URL 不变，连接 URL 增加 deviceId+token 参数"
- L2：附录 A 新建文件数修正为 13 个
- L3：附录 A 修改文件数修正为 23 个
- L4：3.5 节 seed.ts 关键变化补充说明 widgets 字段类型从 string 改为 array（JSONB）

---

## 附录 A：文件变更清单

### 新建文件（13 个）

| 文件路径 | 说明 |
|----------|------|
| `server/src/middleware/auth.ts` | HTTP 认证中间件 |
| `server/src/db/migrateFromSqlite.ts` | SQLite → PG 数据迁移脚本 |
| `client/desktop/src/utils/deviceAuth.ts` | deviceId + token 管理 |
| `client/desktop/src/utils/syncQueue.ts` | 离线写入回写队列 |
| `server/Dockerfile` | 服务器 Docker 镜像构建 |
| `docker-compose.yml` | Docker Compose 编排 |
| `.env.example` | 环境变量模板 |
| `.env.local.example` | 客户端环境变量模板 |
| `docker-up.bat` | 启动脚本 |
| `docker-down.bat` | 停止脚本 |
| `docker-logs.bat` | 日志脚本 |
| `docker-migrate.bat` | 迁移脚本 |
| `docs/specs/phase3-server-spec.md` | 本 Spec 文档 |

### 修改文件（23 个）

| 文件路径 | 说明 |
|----------|------|
| `server/src/db/connection.ts` | better-sqlite3 → pg Pool |
| `server/src/db/schema.ts` | SQLite DDL → PG DDL |
| `server/src/db/seed.ts` | 同步 → 异步 |
| `server/src/index.ts` | 异步初始化 + authMiddleware + await closeDb() |
| `server/src/ws.ts` | 单客户端 → 多客户端 |
| `server/src/piBridge.ts` | 模型可配置 + 工具路由 + deviceId |
| `server/src/routes/panels.ts` | async + pg + broadcastChange |
| `server/src/routes/widgets.ts` | async + pg + broadcastChange |
| `server/src/routes/entities.ts` | async + pg + broadcastChange |
| `server/src/routes/relations.ts` | async + pg + broadcastChange |
| `server/src/routes/scopes.ts` | async + pg + broadcastChange |
| `server/src/routes/settings.ts` | async + pg + broadcastChange |
| `server/src/routes/export.ts` | async + pg |
| `server/src/routes/import.ts` | async + pg + withTransaction |
| `server/src/routes/dynamicWidgets.ts` | async + pg + broadcastChange |
| `server/src/routes/panelTemplates.ts` | async + pg + broadcastChange |
| `server/package.json` | 新增 pg 依赖 + migrate script |
| `client/desktop/src/api/client.ts` | baseURL 可配置 + Authorization 头 |
| `client/desktop/src/api/adapter.ts` | detectBackend 可配置 + withFallback syncOp |
| `client/desktop/src/utils/db.ts` | withFallback 调用补充 syncOp |
| `client/desktop/src/components/SettingsPanel.tsx` | 新增服务器配置区块 |
| `client/desktop/src/stores/useAIStore.ts` | WS URL 携带 deviceId+token + handleServerChange + ServerMessage 类型扩展 |
| `client/desktop/src/stores/useAppStore.ts` | 新增 refreshPanels/refreshWidgets/refreshSettings |

### 删除文件

无（better-sqlite3 暂时保留，迁移脚本依赖；迁移完成后可移除）

---

## 附录 B：环境变量清单

### 服务器端（.env）

| 变量名 | 默认值 | 说明 |
|--------|--------|------|
| `POSTGRES_USER` | `livingdashboard` | PG 用户名 |
| `POSTGRES_PASSWORD` | `livingdashboard` | PG 密码 |
| `POSTGRES_DB` | `living_dashboard` | PG 数据库名 |
| `PG_PORT` | `5432` | PG 暴露端口 |
| `PGDATA_HOST_PATH` | `F:/allmylife/event/data/pgdata` | PG 数据卷宿主路径 |
| `SERVER_PORT` | `3456` | 服务器暴露端口 |
| `SERVER_TOKEN` | （空） | 共享认证 token |
| `PI_MODEL` | `stepfun/step-3.7-flash` | Pi Agent 模型 |
| `STEPFUN_API_KEY` | （空） | StepFun API Key |
| `DATABASE_URL` | （自动生成） | PG 连接字符串（Docker 内） |
| `SQLITE_PATH` | `F:\allmylife\event\data\living-dashboard.db` | 迁移脚本用 SQLite 路径 |

### 客户端（.env.local）

| 变量名 | 默认值 | 说明 |
|--------|--------|------|
| `VITE_API_BASE_URL` | `/api` | API Base URL |
| `VITE_WS_URL` | `ws://localhost:3456/ws` | WS URL |
| `VITE_SERVER_TOKEN` | （空） | 服务器 token（也可在设置面板配置） |
| `VITE_STEPFUN_API_KEY` | （空） | StepFun API Key（LLM proxy 用） |
