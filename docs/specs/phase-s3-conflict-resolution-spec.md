# Phase S3：冲突解决 + syncQueue 持久化 — 详细 Spec

> 生成日期：2026-06-30
> 架构依据：[architecture_refactor.md](../architecture_refactor.md) 第四章（4.1-4.4）+ 第五章（5.1-5.3）+ 第十二章 12.2
> Roadmap：[roadmap_server_v1.md](../roadmap_server_v1.md) Phase S3 验收（L594-602）
> 关联：
> - [phase-s2-multi-device-spec.md](phase-s2-multi-device-spec.md) 第 5.1 节（S2 已为 S3 预留 `panelOnlineDevices` 定向广播基础设施，可复用于 sync_failed 事件）
> - [phase-s1-ai-context-spec.md](phase-s1-ai-context-spec.md)（S1 已落地 `broadcastChange` + ChangeEvent 联合类型）
>
> **项目目的**：服务器是 AI 推理 + 数据同步 + 多端协作的中心。S3 让多端并发修改 widget / entity 时不静默丢失数据、客户端 syncQueue 失败操作不丢可恢复、用户能感知到失败操作并手动处理。S3 是 S1（按面板 session）+ S2（多端并行路由）之后的"数据一致性兜底"层。

---

## 一、现状分析

> **关键结论**：S3 的客户端链路（ConflictBadge + syncQueue IndexedDB 持久化 + 指数退避）+ widgets 表乐观锁已在 Phase 4 落地；本 Spec 修复 **5 个实质缺口**（实体冲突日志 / sync_logs 服务器持久化 / sync_failed WS 推送 / 失败 UI 渲染 / 独立 spec + commit）+ **1 项死代码清理**（`sync_queue` 表标记 deprecated）。

### 1.1 已完成（无需重做）

| 任务 | 现状 | 文件位置 |
|------|------|---------|
| widgets 表乐观锁（state-only 更新） | PUT /api/widgets/:id 校验 `WHERE id AND version RETURNING *`，RETURNING 空返回 409 | [widgets.ts:109-187](../../server/src/routes/widgets.ts) |
| widgets 表 schema `version` 字段 | `version INTEGER NOT NULL DEFAULT 1` | [schema.ts:28](../../server/src/db/schema.ts) |
| entities 表 schema `version` 字段 | `version INTEGER NOT NULL DEFAULT 1` | [schema.ts:43](../../server/src/db/schema.ts) |
| 客户端 ConflictBadge 全链路 | 角标按钮 + 保留本地/远端/合并三选项面板 | [ConflictBadge.tsx](../../client/desktop/src/components/ConflictBadge.tsx) |
| useAppStore addConflict/resolveConflict | 状态机 + 409 二次冲突更新 | [useAppStore.ts:2496-2586](../../client/desktop/src/stores/useAppStore.ts) |
| updateWidgetState 传 expectedVersion | body.expectedVersion 透传 | [api/widgets.ts:43-53](../../client/desktop/src/api/widgets.ts) |
| syncQueue 客户端 IndexedDB 持久化 | IDB store `living-dashboard-sync/pendingOps` | [syncQueue.ts:6-7](../../client/desktop/src/utils/syncQueue.ts) |
| syncQueue 指数退避 | RETRY_DELAYS=[1000,2000,4000,8000,16000,60000] | [syncQueue.ts:12](../../client/desktop/src/utils/syncQueue.ts) |
| syncQueue 失败阈值 | FAILED_THRESHOLD=10，超阈值加入 `syncQueueFailedEntries` Set | [syncQueue.ts:13,34,184](../../client/desktop/src/utils/syncQueue.ts) |
| syncQueue 无上限重试 | 不再放弃任何操作，retryCount 持续递增 | [syncQueue.ts:139-194](../../client/desktop/src/utils/syncQueue.ts) |
| sync-log.jsonl Electron 双持久化 | `appendSyncLog` / `readSyncLog` / `rotateSyncLog` 经 IPC 写本地文件 | [syncQueue.ts:40-76](../../client/desktop/src/utils/syncQueue.ts) |
| syncQueue 启动恢复 | `initSyncQueue` 从 sync-log 恢复 failed 到 IDB | [syncQueue.ts:82-114](../../client/desktop/src/utils/syncQueue.ts) |
| panels 删除优先（ON DELETE CASCADE） | DELETE panels 走级联，已删就删了 | [schema.ts:16](../../server/src/db/schema.ts) |
| favorites upsert | `ON CONFLICT (widget_id) DO UPDATE` | [favorites.ts](../../server/src/routes/favorites.ts) |
| broadcastChange 排除发起方 | `broadcastChange(event, sourceDeviceId)` | [ws.ts:449-457](../../server/src/ws.ts) |
| ChangeEvent 联合类型 26 种事件 | panel/widget/entity/relation/dynamic_widget/template/settings/favorite/capability/data_imported | [ws.ts:55-82](../../server/src/ws.ts) |
| panelOnlineDevices 定向广播 | S2 已落地，可复用于 sync_failed 事件定向广播 | [piBridge.ts:76](../../server/src/piBridge.ts) |
| sendToDevice(deviceId, message) | 单设备定向发送 API | [ws.ts:427-433](../../server/src/ws.ts) |
| ServerMessage `kind: 'change'` 协议 | `{ kind: 'change'; changeType: string; data: unknown; sourceDeviceId?: string }` | [useAIStore.ts:95](../../client/desktop/src/stores/useAIStore.ts) |
| useAIStore handleServerChange 路由 | 按 changeType 分发到 refreshPanels/refreshWidgets/refreshSettings | [useAIStore.ts:848-909](../../client/desktop/src/stores/useAIStore.ts) |
| OfflineBanner 组件 | 离线降级模式顶部黄色 banner，可参考布局 | [OfflineBanner.tsx](../../client/desktop/src/components/OfflineBanner.tsx) |

### 1.2 实质未对齐项（本 Spec 修复目标）

#### 缺口 A：实体冲突日志持久化（**P1 数据可审计性**）

**问题**：[entities.ts:153-198](../../server/src/routes/entities.ts) PUT 路由当 `body.expectedVersion !== existing.rows[0].version` 时仅 `console.warn`（L167-171），架构文档 4.3 要求"LWW + 记录冲突日志"。

**roadmap 要求**（[roadmap_server_v1.md L598](../roadmap_server_v1.md)）：
> 智能分场景策略正确（位置 LWW / state LWW+角标 / 删除优先 / 实体 LWW+日志）

**当前后果**：
- 实体数据并发冲突仅写控制台，进程重启后丢失
- 无法事后审计"哪个设备、什么时候、改了什么实体、覆盖了谁的数据"
- 与架构文档 4.3 表"实体数据冲突：last-write-wins + 记录冲突日志"不一致

**修复**：新建 `entity_conflict_logs` 表持久化冲突记录；entities.ts PUT 检测版本不匹配时 INSERT 一条记录（保留 LWW 默认策略不丢数据，但记录冲突供审计）；新增查询/解决 API。

#### 缺口 B：服务器端 sync_logs 表（替代死代码 sync_queue）（**P1 数据不丢**）

**问题**：
- [schema.ts:118-130](../../server/src/db/schema.ts) 的 `sync_queue` 表是死代码（[piBridge.ts:1224 注释](../../server/src/piBridge.ts) "sync_queue_flush 已删除"），全代码库 Grep 确认无 INSERT/SELECT 引用
- 客户端 syncQueue 失败操作仅存本地（IndexedDB + Electron sync-log.jsonl），清缓存或换设备后无法看到其他设备的失败队列
- 架构文档 5.2 与 roadmap L599 提到"可能新增 sync_logs 表"

**当前后果**：
- 多设备场景下，device-A 的失败操作 device-B 看不到（多端协作断裂）
- 浏览器清缓存即丢失败队列（虽然 Electron sync-log 兜底，但纯浏览器模式无 fallback）
- `sync_queue` 死表占 DB 空间，开发者误以为还在用

**修复**：
- 新建 `sync_logs` 表（id/device_id/operation/entity_type/entity_id/payload JSONB/status/retry_count/last_error/created_at/updated_at/next_retry_at）
- 客户端 syncQueue 写入 pending、更新 success/failed（调服务器 API）
- 新增 4 个 API：GET /api/sync/logs、GET /api/sync/logs/failed、POST /api/sync/logs/retry/:id、DELETE /api/sync/logs/:id

**决策**：保留旧 `sync_queue` 表 schema 不动（避免破坏已部署 DB），新增 `sync_logs` 表并行存在；在 schema.ts 中加注释标记 `sync_queue` 为 `[DEPRECATED]`。

#### 缺口 C：WS 推送 sync_failed 事件给客户端（**P1 实时感知**）

**问题**：架构文档 5.2 要求"标记 failed 的操作 UI 提示用户手动处理（通过 WS 推送给客户端）"，但当前 server 端无 `sync_failed` 事件类型，客户端 `syncQueueFailedEntries` 是本地 Set，无 WS 订阅入口。

**当前后果**：
- device-A 触发失败操作后，device-B 不会实时感知到（要等 device-B 主动查询 sync_logs）
- 客户端 syncQueueFailedEntries 是单端集合，无服务器推送合并
- 与架构文档 5.2 的"WS 推送"承诺不一致

**修复**：
- `ws.ts` ChangeEvent 联合类型新增 `sync_failed` 事件
- 服务器端 sync_logs 标记 failed 时通过 broadcastChange（或 sendToDevice 定向）推送到对应 device_id
- 客户端 useAppStore 监听 `sync_failed` 事件，更新 `syncQueueFailedEntries` 集合（双源合并：本地 + 服务器）

#### 缺口 D：失败操作 UI 提示渲染（**P1 用户可感知**）

**问题**：[syncQueue.ts:34](../../client/desktop/src/utils/syncQueue.ts) 的 `syncQueueFailedEntries` Set 未在 UI 中渲染，`getFailedCount()` 函数（L207-209）无调用方。

**当前后果**：
- 用户无法感知"有 N 个同步操作失败"
- 失败操作堆积在 IDB 中无 UI 提示
- 与架构文档 5.2 的"UI 提示用户手动处理"承诺不一致

**修复**：
- 新增 `SyncFailedBanner` 组件（参考 OfflineBanner 布局）
- 在 App.tsx 顶部与 OfflineBanner 同级渲染
- 显示"有 N 个同步操作失败，点击查看"
- 点击展开失败列表（每条显示 entityType/entityId/operation/last_error），支持"重试"和"删除"操作

**决策**：让 sub-agent 在编码阶段先探索现有 UI 组件决定最终位置（候选：复用 OfflineBanner 旁挂 / 新增 SyncFailedBanner / 用 Toast 通知），最终推荐方案是新增 SyncFailedBanner（与 OfflineBanner 视觉一致但功能独立）。

#### 缺口 E：S3 独立 spec 文件 + git commit（**P2 工程合规**）

**问题**：S3 没有独立 spec 文件，无法从 git 历史明确判断 S3 是否"完成"。

**修复**：本 Spec 即为 S3 spec；编码完成后独立 git commit（conventional commit 格式 `feat(server): phase S3 conflict resolution + syncQueue persistence`）。

### 1.3 顺手修复：sync_queue 表标记 deprecated

**问题**：[schema.ts:118-130](../../server/src/db/schema.ts) 的 `sync_queue` 表是死代码，无引用。

**修复**：在 schema.ts 中加注释标记 `[DEPRECATED]`，保留 schema 不动（避免破坏已部署 DB）。

---

## 二、详细设计

### 2.1 缺口 A：实体冲突日志持久化

#### 2.1.1 数据模型：entity_conflict_logs 表

```sql
-- ============================================================================
-- Phase S3 缺口 A：实体冲突日志（架构文档 4.3）
-- 记录 entity PUT 时版本不匹配的冲突信息，供事后审计
-- 保留 LWW 默认策略（仍应用更新），仅追加日志
-- ============================================================================
-- 字段命名理由：采用 local/remote 视角（从服务器视角描述冲突）
--   - local_* = 服务器当前状态（冲突时的 existing 行）
--   - remote_* = 客户端尝试写入的状态（body）
--   - source_device_id = 发起冲突的设备
--   - resolved_action = 解决动作（keep-local/keep-remote/merge）
-- 相比早期 expected/current 命名，local/remote 更直观地描述"服务器方 vs 客户端方"。
-- id 用 TEXT(UUID) 比 BIGSERIAL 更适合分布式多端场景（客户端可预生成）。
CREATE TABLE IF NOT EXISTS entity_conflict_logs (
  id TEXT PRIMARY KEY,                        -- UUID，分布式场景客户端可预生成
  entity_id TEXT NOT NULL,                    -- 关联 entities.id（不外键，避免 entity 删除时丢日志）
  entity_type TEXT NOT NULL,                  -- 冗余字段，便于按类型查询
  panel_id TEXT,                              -- 冗余字段，便于按面板查询
  local_version INTEGER NOT NULL,             -- 服务器当前版本（冲突时的 existing.version）
  remote_version INTEGER NOT NULL,            -- 客户端期望版本（body.expectedVersion）
  local_state JSONB,                          -- 服务器当前 data（conflictRow.data）
  remote_state JSONB,                         -- 客户端尝试 data（body.data）
  source_device_id TEXT,                      -- 发起冲突的设备（req.deviceId）
  resolved BOOLEAN NOT NULL DEFAULT FALSE,    -- 是否已被用户标记为已解决
  resolved_action TEXT,                       -- 解决动作：keep-local/keep-remote/merge
  resolved_at BIGINT,                         -- 解决时间戳
  created_at BIGINT NOT NULL DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT
);
CREATE INDEX IF NOT EXISTS idx_entity_conflict_logs_entity ON entity_conflict_logs(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_entity_conflict_logs_panel_id ON entity_conflict_logs(panel_id);
CREATE INDEX IF NOT EXISTS idx_entity_conflict_logs_resolved ON entity_conflict_logs(resolved) WHERE resolved = FALSE;
CREATE INDEX IF NOT EXISTS idx_entity_conflict_logs_created_at ON entity_conflict_logs(created_at);
```

#### 2.1.2 TypeScript 类型定义

在 `server/src/types/index.ts` 新增：

```typescript
// Phase S3 缺口 A：实体冲突日志
// 字段命名理由：local/remote 视角（local=服务器当前，remote=客户端尝试）
export interface EntityConflictLog {
  id: string
  entityId: string
  entityType: string
  panelId: string | null
  localVersion: number                  // 服务器当前版本（冲突时的 existing.version）
  remoteVersion: number                 // 客户端期望版本（body.expectedVersion）
  localState: unknown                   // 服务器当前 data（conflictRow.data）
  remoteState: unknown                  // 客户端尝试 data（body.data）
  sourceDeviceId: string | null         // 发起冲突的设备（req.deviceId）
  resolved: boolean
  resolvedAction: string | null         // 解决动作：keep-local/keep-remote/merge
  resolvedAt: number | null
  createdAt: number
}

export interface EntityConflictLogQueryParams {
  entityId?: string
  panelId?: string
  entityType?: string
  resolved?: boolean
  limit?: number
  offset?: number
}
```

#### 2.1.3 entities.ts PUT 路由改造

在 [entities.ts:153-198](../../server/src/routes/entities.ts) PUT 路由的版本不匹配分支 INSERT 冲突日志。**事务化要求**：将整个"冲突日志 INSERT + 实体 UPDATE + SELECT 返回"包进 `withTransaction`（参考 [connection.ts:74](../../server/src/db/connection.ts) 已存在的实现），所有 `pool.query` 改为 `client.query`，避免 INSERT 成功但 UPDATE 失败导致数据不一致：

```typescript
// PUT /api/entities/:id — 改造 L165-198 整段（冲突日志 INSERT + 实体 UPDATE + SELECT 返回）
import { randomUUID } from 'crypto'
import { withTransaction } from '../db/connection.js'

// ... existing 查询保持不变（在事务外读取，避免长事务）...
const existing = await pool.query('SELECT * FROM entities WHERE id = $1', [req.params.id])
if (existing.rows.length === 0) {
  res.status(404).json({ error: 'NOT_FOUND' })
  return
}
const conflictRow = existing.rows[0]

// 整个写操作（INSERT 冲突日志 + UPDATE 实体 + SELECT 返回）包进事务
const updatedRow = await withTransaction(async (client) => {
  // S3 缺口 A：版本不匹配时记录冲突日志（仍应用更新，LWW + 日志策略）
  // 字段命名采用 local/remote 视角（local=服务器当前，remote=客户端尝试）
  if (body.expectedVersion !== undefined && conflictRow.version !== body.expectedVersion) {
    const conflictId = randomUUID()
    await client.query(
      `INSERT INTO entity_conflict_logs
        (id, entity_id, entity_type, panel_id,
         local_version, remote_version,
         local_state, remote_state,
         source_device_id, resolved, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, FALSE, EXTRACT(EPOCH FROM NOW())::BIGINT * 1000)`,
      [
        conflictId,
        req.params.id,
        conflictRow.type || 'entity',
        conflictRow.panel_id,                  // panel_id 从 conflictRow 取（冗余字段，便于按面板查询）
        conflictRow.version,                   // local_version = 服务器当前版本
        body.expectedVersion as number,         // remote_version = 客户端期望版本
        JSON.stringify(conflictRow.data ?? null),  // local_state = 服务器当前 data
        JSON.stringify(body.data ?? null),         // remote_state = 客户端尝试 data
        req.deviceId ?? null,                      // source_device_id = 发起冲突的设备
      ],
    )
    console.warn(
      `[Conflict] Entity ${req.params.id} version mismatch: ` +
      `expected=${body.expectedVersion}, current=${conflictRow.version}, ` +
      `logged to entity_conflict_logs, applying LWW update`,
    )
  }

  // LWW 强制应用更新（version 递增）
  const now = Date.now()
  const updateResult = await client.query(
    `UPDATE entities
     SET data = $1, version = version + 1, updated_at = $2
     WHERE id = $3
     RETURNING *`,
    [JSON.stringify(body.data ?? {}), now, req.params.id],
  )
  return updateResult.rows[0]
})

res.json(parseEntityRow(updatedRow))
```

#### 2.1.4 查询 API：GET /api/entities/conflicts

新增 `server/src/routes/entityConflicts.ts` 路由文件，挂载到 `/api/entities/conflicts`：

| 路径 | 方法 | 功能 |
|------|------|------|
| `/api/entities/conflicts` | GET | 查询冲突日志列表，支持 entityId/panelId/entityType/resolved/limit/offset 过滤 |
| `/api/entities/conflicts/:id` | GET | 查询单条冲突日志详情 |
| `/api/entities/conflicts/:id/resolve` | POST | 标记冲突为已解决（resolved=TRUE） |

**GET /api/entities/conflicts 请求**：

```
GET /api/entities/conflicts?panelId=panel-1&resolved=false&limit=50&offset=0
```

**默认行为说明**：未传 `resolved` 参数时返回全部（含已解决 + 未解决）；显式传 `resolved=true/false` 时按值过滤。`panelId` 过滤可选。

**响应**（采用 `{conflicts: [...]}` 包装，符合 RESTful 资源集合风格）：

```json
{
  "conflicts": [
    {
      "id": "a1b2c3d4-...",
      "entityId": "ent-abc",
      "entityType": "task",
      "panelId": "panel-1",
      "localVersion": 7,
      "remoteVersion": 5,
      "localState": { "title": "new title from other device" },
      "remoteState": { "title": "old title" },
      "sourceDeviceId": "device-A",
      "resolved": false,
      "resolvedAction": null,
      "resolvedAt": null,
      "createdAt": 1719700000000
    }
  ],
  "total": 1,
  "limit": 50,
  "offset": 0
}
```

**GET /api/entities/conflicts/:id 响应**（采用 `{conflict: {...}}` 包装）：

```json
{
  "conflict": {
    "id": "a1b2c3d4-...",
    "entityId": "ent-abc",
    "entityType": "task",
    "panelId": "panel-1",
    "localVersion": 7,
    "remoteVersion": 5,
    "localState": { "title": "new title from other device" },
    "remoteState": { "title": "old title" },
    "sourceDeviceId": "device-A",
    "resolved": false,
    "resolvedAction": null,
    "resolvedAt": null,
    "createdAt": 1719700000000
  }
}
```

**POST /api/entities/conflicts/:id/resolve 响应**（采用 `{ok, conflict}` 包装）：

```json
// 请求 body: { "action": "keep-local" | "keep-remote" | "merge", "mergedState"?: unknown }
// 响应
{
  "ok": true,
  "conflict": {
    "id": "a1b2c3d4-...",
    "entityId": "ent-abc",
    "entityType": "task",
    "panelId": "panel-1",
    "localVersion": 7,
    "remoteVersion": 5,
    "localState": { "title": "new title from other device" },
    "remoteState": { "title": "old title" },
    "sourceDeviceId": "device-A",
    "resolved": true,
    "resolvedAction": "keep-local",
    "resolvedAt": 1719700600000,
    "createdAt": 1719700000000
  }
}
```

**响应包装决策说明**：实现采用 `{conflicts}` / `{conflict}` / `{ok, conflict}` 包装（而非 spec 早期版本的 `{items}` 或裸对象 / `{ok, id, ...}`），理由：
1. 三端点响应结构一致（list/detail/resolve 均以资源名包装），符合 RESTful 风格
2. `{ok, conflict}` 让客户端能同时拿到操作结果与最新冲突状态，避免二次查询
3. `resolved_action` 字段持久化解决动作（keep-local/keep-remote/merge），便于审计

```typescript
// server/src/routes/entityConflicts.ts 关键骨架
import { Router } from 'express'
import { getPool } from '../db/connection.js'
import { createError } from '../middleware/error.js'
import { broadcastChange } from '../ws.js'
import type { EntityConflictLog, EntityConflictResolveAction } from '../types/index.js'

export const entityConflictsRouter = Router()

// GET /api/entities/conflicts — 查询冲突日志列表
// 默认行为：未传 resolved 参数时返回全部（含已解决 + 未解决），与 spec 早期版本的"默认仅未解决"不同
entityConflictsRouter.get('/', async (req, res, next) => {
  try {
    const pool = getPool()
    const params = req.query as Record<string, string | undefined>
    const conditions: string[] = []
    const values: unknown[] = []
    let paramIdx = 1

    if (params.entityId) { conditions.push(`entity_id = $${paramIdx++}`); values.push(params.entityId) }
    if (params.panelId) { conditions.push(`panel_id = $${paramIdx++}`); values.push(params.panelId) }
    if (params.entityType) { conditions.push(`entity_type = $${paramIdx++}`); values.push(params.entityType) }
    // 显式传 resolved=true/false 时按值过滤；未传时返回全部
    if (params.resolved !== undefined) {
      conditions.push(`resolved = $${paramIdx++}`)
      values.push(params.resolved === 'true')
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
    const limit = Math.min(Math.max(parseInt(String(params.limit || '100'), 10), 1), 1000)
    const offset = Math.max(parseInt(String(params.offset || '0'), 10), 0)

    const dataResult = await pool.query(
      `SELECT * FROM entity_conflict_logs ${where} ORDER BY created_at DESC LIMIT $${paramIdx++} OFFSET $${paramIdx++}`,
      [...values, limit, offset],
    )
    const countResult = await pool.query(
      `SELECT COUNT(*) as count FROM entity_conflict_logs ${where}`,
      values,
    )

    res.json({
      conflicts: dataResult.rows.map(parseEntityConflictLogRow),
      total: parseInt(String(countResult.rows[0].count), 10),
      limit,
      offset,
    })
  } catch (e) { next(e) }
})

// GET /api/entities/conflicts/:id — 查询单个冲突详情
entityConflictsRouter.get('/:id', async (req, res, next) => {
  try {
    const pool = getPool()
    const result = await pool.query('SELECT * FROM entity_conflict_logs WHERE id = $1', [req.params.id])
    if (result.rows.length === 0) {
      throw createError(404, 'NOT_FOUND', `Conflict log ${req.params.id} not found`)
    }
    res.json({ conflict: parseEntityConflictLogRow(result.rows[0]) })
  } catch (e) { next(e) }
})

// POST /api/entities/conflicts/:id/resolve — 解决冲突
// body: { action: 'keep-local' | 'keep-remote' | 'merge', mergedState?: unknown }
entityConflictsRouter.post('/:id/resolve', async (req, res, next) => {
  try {
    const pool = getPool()
    const body = req.body as { action?: string; mergedState?: unknown }
    const validActions: EntityConflictResolveAction[] = ['keep-local', 'keep-remote', 'merge']
    if (!body.action || !validActions.includes(body.action as EntityConflictResolveAction)) {
      throw createError(400, 'INVALID_PARAMS', `action must be one of: keep-local, keep-remote, merge`)
    }
    const action = body.action as EntityConflictResolveAction
    // mergedState 当前仅作为客户端意图记录，不应用到 entity（如需应用，客户端应单独调 PUT /api/entities/:id）
    const _mergedState = body.mergedState
    void _mergedState

    const now = Date.now()
    const result = await pool.query(
      `UPDATE entity_conflict_logs
       SET resolved = TRUE, resolved_action = $1, resolved_at = $2
       WHERE id = $3 RETURNING *`,
      [action, now, req.params.id],
    )
    if (result.rows.length === 0) {
      throw createError(404, 'NOT_FOUND', `Conflict log ${req.params.id} not found`)
    }

    const conflict = parseEntityConflictLogRow(result.rows[0])
    res.json({ ok: true, conflict })
  } catch (e) { next(e) }
})

function parseEntityConflictLogRow(row: any): EntityConflictLog {
  return {
    id: row.id,
    entityId: row.entity_id,
    entityType: row.entity_type,
    panelId: row.panel_id,
    localVersion: row.local_version,
    remoteVersion: row.remote_version,
    localState: row.local_state,
    remoteState: row.remote_state,
    sourceDeviceId: row.source_device_id,
    resolved: row.resolved,
    resolvedAction: row.resolved_action,
    resolvedAt: row.resolved_at,
    createdAt: row.created_at,
  }
}
```

#### 2.1.5 路由挂载

在 `server/src/index.ts`（或对应入口文件）添加：

```typescript
import { entityConflictsRouter } from './routes/entityConflicts.js'
app.use('/api/entities/conflicts', entityConflictsRouter)
```

### 2.2 缺口 B：sync_logs 表 + API

#### 2.2.1 数据模型：sync_logs 表

```sql
-- ============================================================================
-- Phase S3 缺口 B：sync_logs 服务器端持久化（架构文档 5.2）
-- 替代死代码 sync_queue 表（保留旧表不删，避免破坏已部署 DB）
-- ============================================================================
CREATE TABLE IF NOT EXISTS sync_logs (
  id TEXT PRIMARY KEY,                         -- 客户端生成，全局唯一（UUID 或 timestamp-random）
  device_id VARCHAR(64) NOT NULL,              -- 发起设备
  operation VARCHAR(16) NOT NULL,              -- create / update / delete
  entity_type VARCHAR(32) NOT NULL,            -- panel / widget / entity / settings / favorite
  entity_id TEXT NOT NULL,                    -- 关联实体 ID
  payload JSONB NOT NULL,                      -- 客户端尝试写入的载荷
  status VARCHAR(16) NOT NULL DEFAULT 'pending', -- pending / success / failed
  retry_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,                              -- 应用层截断 1000 字符（schema 仍 TEXT，由客户端 String(err).slice(0, 1000)）
  created_at BIGINT NOT NULL DEFAULT (EXTRACT(EPOCH FROM now()) * 1000)::BIGINT,
  updated_at BIGINT NOT NULL DEFAULT (EXTRACT(EPOCH FROM now()) * 1000)::BIGINT,
  next_retry_at BIGINT                         -- 下次重试时间戳（毫秒），用于指数退避
);
CREATE INDEX IF NOT EXISTS idx_sync_logs_device_id ON sync_logs(device_id);
CREATE INDEX IF NOT EXISTS idx_sync_logs_status ON sync_logs(status);
CREATE INDEX IF NOT EXISTS idx_sync_logs_device_status ON sync_logs(device_id, status);
CREATE INDEX IF NOT EXISTS idx_sync_logs_next_retry ON sync_logs(next_retry_at) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_sync_logs_created_at ON sync_logs(created_at);
```

**注**：`dismissed` 仅是客户端 `SyncFailedBanner` 的本地 UI 状态（useState 持久化在内存中），不持久化到 `sync_logs.status`；`sync_logs.status` 仅枚举 `pending` / `success` / `failed` 三态。

#### 2.2.2 TypeScript 类型定义

在 `server/src/types/index.ts` 新增：

```typescript
// Phase S3 缺口 B：sync_logs
export type SyncLogStatus = 'pending' | 'success' | 'failed'

export interface SyncLogEntry {
  id: string
  deviceId: string
  operation: 'create' | 'update' | 'delete'
  entityType: string
  entityId: string
  payload: unknown
  status: SyncLogStatus
  retryCount: number
  lastError: string | null
  createdAt: number
  updatedAt: number
  nextRetryAt: number | null
}

export interface SyncLogQueryParams {
  deviceId?: string
  status?: SyncLogStatus
  entityType?: string
  entityId?: string
  limit?: number
  offset?: number
}

export interface UpsertSyncLogRequest {
  id: string
  operation: 'create' | 'update' | 'delete'
  entityType: string
  entityId: string
  payload: unknown
  status: SyncLogStatus
  retryCount?: number
  lastError?: string
  nextRetryAt?: number | null
}
```

#### 2.2.3 路由：sync_logs.ts

新增 `server/src/routes/syncLogs.ts`，挂载到 `/api/sync/logs`：

| 路径 | 方法 | 功能 |
|------|------|------|
| `/api/sync/logs` | GET | 查询 sync_logs（支持 deviceId/status/entityType/entityId/limit/offset 过滤） |
| `/api/sync/logs/failed` | GET | 查询 status=failed 的记录（便捷端点） |
| `/api/sync/logs` | PUT | upsert（客户端写入 pending 或更新 success/failed） |
| `/api/sync/logs/:id` | DELETE | 删除单条记录（客户端成功后或用户手动清理时调用） |
| `/api/sync/logs/retry/:id` | POST | 手动触发重试（服务器执行 payload 指向的操作，成功后更新 status=success） |

**GET /api/sync/logs?deviceId=device-A&status=failed**：

```json
{
  "items": [
    {
      "id": "1719700000000-abc123",
      "deviceId": "device-A",
      "operation": "update",
      "entityType": "widget",
      "entityId": "widget-xyz",
      "payload": { "state": { "tabs": ["tab1"] }, "expectedVersion": 5 },
      "status": "failed",
      "retryCount": 11,
      "lastError": "Conflict: version mismatch",
      "createdAt": 1719700000000,
      "updatedAt": 1719700600000,
      "nextRetryAt": 1719701200000
    }
  ],
  "total": 1,
  "limit": 100,
  "offset": 0
}
```

**PUT /api/sync/logs**（upsert）：

```json
// 请求
{
  "id": "1719700000000-abc123",
  "operation": "update",
  "entityType": "widget",
  "entityId": "widget-xyz",
  "payload": { "state": { "tabs": ["tab1"] }, "expectedVersion": 5 },
  "status": "pending",
  "retryCount": 0,
  "nextRetryAt": null
}

// 响应
{ "ok": true, "id": "1719700000000-abc123", "status": "pending" }
```

**PUT 错误响应**（M-3 参数校验）：

| HTTP 状态 | error | 触发条件 |
|----------|-------|---------|
| 400 | `INVALID_PARAMS` | 缺 `id` / `operation` / `entityType` / `entityId` 任一必填字段 |
| 400 | `INVALID_PARAMS` | `operation` 不在 `create|update|delete` 枚举内 |
| 400 | `INVALID_PARAMS` | `status` 不在 `pending|success|failed` 枚举内（status 为可选字段，传值时校验） |

错误响应格式：`{ "error": "INVALID_PARAMS", "message": "<具体说明>" }`

```typescript
// server/src/routes/syncLogs.ts 关键骨架
import { Router } from 'express'
import { getPool } from '../db/connection.js'
import { broadcastChange } from '../ws.js'
import { sendToDevice } from '../ws.js'
import type { UpsertSyncLogRequest, SyncLogStatus } from '../types/index.js'

export const syncLogsRouter = Router()

// GET /api/sync/logs
syncLogsRouter.get('/', async (req, res, next) => {
  try {
    const pool = getPool()
    const params = req.query as Record<string, string | undefined>
    const conditions: string[] = []
    const values: unknown[] = []
    let paramIdx = 1

    if (params.deviceId) { conditions.push(`device_id = $${paramIdx++}`); values.push(params.deviceId) }
    if (params.status) { conditions.push(`status = $${paramIdx++}`); values.push(params.status) }
    if (params.entityType) { conditions.push(`entity_type = $${paramIdx++}`); values.push(params.entityType) }
    if (params.entityId) { conditions.push(`entity_id = $${paramIdx++}`); values.push(params.entityId) }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
    const limit = Math.min(Math.max(parseInt(String(params.limit || '100'), 10), 1), 1000)
    const offset = Math.max(parseInt(String(params.offset || '0'), 10), 0)

    const dataResult = await pool.query(
      `SELECT * FROM sync_logs ${where} ORDER BY created_at DESC LIMIT $${paramIdx++} OFFSET $${paramIdx++}`,
      [...values, limit, offset],
    )
    const countResult = await pool.query(`SELECT COUNT(*) as count FROM sync_logs ${where}`, values)

    res.json({
      items: dataResult.rows.map(parseSyncLogRow),
      total: parseInt(String(countResult.rows[0].count), 10),
      limit,
      offset,
    })
  } catch (e) { next(e) }
})

// GET /api/sync/logs/failed — 便捷端点
syncLogsRouter.get('/failed', async (req, res, next) => {
  try {
    const pool = getPool()
    const params = req.query as Record<string, string | undefined>
    const conditions = ['status = $1']
    const values: unknown[] = ['failed']
    let paramIdx = 2

    if (params.deviceId) { conditions.push(`device_id = $${paramIdx++}`); values.push(params.deviceId) }

    const limit = Math.min(Math.max(parseInt(String(params.limit || '100'), 10), 1), 1000)
    const offset = Math.max(parseInt(String(params.offset || '0'), 10), 0)

    const dataResult = await pool.query(
      `SELECT * FROM sync_logs WHERE ${conditions.join(' AND ')} ORDER BY updated_at DESC LIMIT $${paramIdx++} OFFSET $${paramIdx++}`,
      [...values, limit, offset],
    )
    res.json({
      items: dataResult.rows.map(parseSyncLogRow),
      limit,
      offset,
    })
  } catch (e) { next(e) }
})

// PUT /api/sync/logs — upsert（客户端写入 pending 或更新 success/failed）
syncLogsRouter.put('/', async (req, res, next) => {
  try {
    const pool = getPool()
    const body = req.body as UpsertSyncLogRequest
    // M-3：参数校验（缺 id/operation/entityType/entityId 时返回 400）
    if (!body.id || !body.operation || !body.entityType || !body.entityId) {
      res.status(400).json({
        error: 'INVALID_PARAMS',
        message: 'Required fields: id, operation, entityType, entityId',
      })
      return
    }
    // 校验 operation / status 枚举
    if (!['create', 'update', 'delete'].includes(body.operation)) {
      res.status(400).json({ error: 'INVALID_PARAMS', message: `operation must be create|update|delete, got: ${body.operation}` })
      return
    }
    if (body.status && !['pending', 'success', 'failed'].includes(body.status)) {
      res.status(400).json({ error: 'INVALID_PARAMS', message: `status must be pending|success|failed, got: ${body.status}` })
      return
    }
    const now = Date.now()
    // S2 修复：deviceId 仅从 req.deviceId 取（由 /api 全局 authMiddleware 注入），不可从 body 伪造
    const deviceId = req.deviceId ?? 'unknown'

    await pool.query(
      `INSERT INTO sync_logs
        (id, device_id, operation, entity_type, entity_id, payload, status,
         retry_count, last_error, created_at, updated_at, next_retry_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       ON CONFLICT (id) DO UPDATE SET
         status = EXCLUDED.status,
         retry_count = EXCLUDED.retry_count,
         last_error = EXCLUDED.last_error,
         updated_at = EXCLUDED.updated_at,
         next_retry_at = EXCLUDED.next_retry_at`,
      [
        body.id, deviceId, body.operation, body.entityType, body.entityId,
        JSON.stringify(body.payload), body.status,
        body.retryCount ?? 0, body.lastError ?? null,
        now, now, body.nextRetryAt ?? null,
      ],
    )

    // S3 缺口 C：如果状态变为 failed，通过 WS 推送 sync_failed 事件到对应 device
    if (body.status === 'failed') {
      const failedEntry = {
        id: body.id,
        deviceId,
        operation: body.operation,
        entityType: body.entityType,
        entityId: body.entityId,
        lastError: body.lastError ?? null,
        retryCount: body.retryCount ?? 0,
        updatedAt: now,
      }
      // 推送到发起设备（让发起方实时感知失败）
      sendToDevice(deviceId, {
        kind: 'change',
        changeType: 'sync_failed',
        data: failedEntry,
        sourceDeviceId: deviceId,
      })
      // 也广播到所有设备（让多端协作的其他设备能看到该设备的失败操作）
      broadcastChange({ kind: 'sync_failed', data: failedEntry }, deviceId)
    }

    res.json({ ok: true, id: body.id, status: body.status })
  } catch (e) { next(e) }
})

// DELETE /api/sync/logs/:id
syncLogsRouter.delete('/:id', async (req, res, next) => {
  try {
    const pool = getPool()
    const result = await pool.query('DELETE FROM sync_logs WHERE id = $1', [req.params.id])
    if (result.rowCount === 0) {
      res.status(404).json({ error: 'NOT_FOUND', message: `Sync log ${req.params.id} not found` })
      return
    }
    res.json({ ok: true })
  } catch (e) { next(e) }
})

// POST /api/sync/logs/retry/:id — 手动重试
syncLogsRouter.post('/retry/:id', async (req, res, next) => {
  try {
    const pool = getPool()
    const result = await pool.query('SELECT * FROM sync_logs WHERE id = $1', [req.params.id])
    if (result.rows.length === 0) {
      res.status(404).json({ error: 'NOT_FOUND', message: `Sync log ${req.params.id} not found` })
      return
    }
    const row = result.rows[0]
    const now = Date.now()

    // S-7 修复：create 重试不在服务器端处理（客户端 syncQueue 本地处理去重）
    if (row.operation === 'create') {
      res.json({ ok: false, status: 'skipped', reason: 'create retry not supported on server' })
      return
    }

    // 重新执行 payload 指向的操作（复用客户端 syncQueue.executeSyncOp 的逻辑）
    // 注意：服务器端重试仅适用于"幂等"操作（update/delete）
    // **M-1 说明**：sync_logs retry 是兜底重试机制，**不参与乐观锁**（按 LWW 强制覆盖），
    //   直接 UPDATE SQL 跳过 widgets.ts 的乐观锁 WHERE version=$expected 校验。
    //   如未来需要严格乐观锁，应抽 `server/src/services/syncExecutor.ts` 统一处理
    //   （S3 不抽，列入后续优化）。
    try {
      await executeSyncOpOnServer(row.operation, row.entity_type, row.entity_id, row.payload)
      await pool.query(
        `UPDATE sync_logs SET status = 'success', retry_count = retry_count + 1, last_error = NULL, updated_at = $1 WHERE id = $2`,
        [now, req.params.id],
      )
      res.json({ ok: true, id: req.params.id, status: 'success' })
    } catch (retryErr) {
      const errorMsg = retryErr instanceof Error ? retryErr.message : String(retryErr)
      await pool.query(
        `UPDATE sync_logs SET retry_count = retry_count + 1, last_error = $1, updated_at = $2, next_retry_at = $3 WHERE id = $4`,
        [errorMsg, now, now + 60_000, req.params.id],
      )
      res.status(500).json({ ok: false, id: req.params.id, status: 'failed', error: errorMsg })
    }
  } catch (e) { next(e) }
})

// 服务器端重试执行器（简化版，仅处理 HTTP 路由内部调用）
// **S-7 修复**：retry 路由对 create 操作早期返回 skipped，不会进入此函数。
// 此函数仅处理 panel/widget/entity 三种 entityType 的 update/delete；
// settings/favorite 等不支持类型走 default 抛错（M-2 修复）。
async function executeSyncOpOnServer(operation: string, entityType: string, entityId: string, payload: unknown): Promise<void> {
  // 复用 server/src/routes/* 的内部函数
  // 对 update 操作：直接 UPDATE SQL（按 entityType 路由到对应表，**M-1 修复**：跳过 widgets.ts 的乐观锁，按 LWW 强制覆盖）
  // 对 delete 操作：直接 DELETE SQL
  const p = payload as Record<string, unknown>
  const pool = getPool()
  if (entityType === 'panel') {
    if (operation === 'update') {
      const now = Date.now()
      await pool.query(
        `UPDATE panels SET name = $1, sort_order = $2, settings = $3, canvas_transform = $4, updated_at = $5 WHERE id = $6`,
        [p.name ?? '未命名', p.sortOrder ?? 0, JSON.stringify(p.settings ?? {}), JSON.stringify(p.canvasTransform ?? null), now, entityId],
      )
    } else if (operation === 'delete') {
      await pool.query('DELETE FROM panels WHERE id = $1', [entityId])
    }
  } else if (entityType === 'widget') {
    // widget 重试用 PUT /api/widgets/:id 的同款逻辑（不在此重复实现，直接 require widgets 路由或抽公共函数）
    // 推荐做法：抽 server/src/services/syncExecutor.ts 统一处理
    if (operation === 'update') {
      const now = Date.now()
      await pool.query(
        `UPDATE widgets SET state = $1, version = version + 1, updated_at = $2 WHERE id = $3`,
        [JSON.stringify(p.state ?? {}), now, entityId],
      )
    } else if (operation === 'delete') {
      await pool.query('DELETE FROM widgets WHERE id = $1', [entityId])
    }
  } else if (entityType === 'entity') {
    if (operation === 'update') {
      const now = Date.now()
      await pool.query(
        `UPDATE entities SET data = $1, version = version + 1, updated_at = $2 WHERE id = $3`,
        [JSON.stringify(p.data ?? {}), now, entityId],
      )
    } else if (operation === 'delete') {
      await pool.query('DELETE FROM entities WHERE id = $1', [entityId])
    }
  } else {
    // S-7 修复 + M-2 修复：default 抛错，不静默跳过 settings/favorite 等不支持类型
    throw new Error(`Unsupported entityType for server retry: ${entityType}`)
  }
  // 注：operation=create 已在 retry 路由早期返回，不会进入此函数
}

// API 文档说明（在 2.2.3 API 表后补充）：
// retry 仅支持 panel/widget/entity 三种 entityType 的 update/delete 操作；
// create 重试由客户端 syncQueue 本地处理（去重逻辑）；settings/favorite 由客户端本地重试。

function parseSyncLogRow(row: any) {
  return {
    id: row.id,
    deviceId: row.device_id,
    operation: row.operation,
    entityType: row.entity_type,
    entityId: row.entity_id,
    payload: row.payload,
    status: row.status,
    retryCount: row.retry_count,
    lastError: row.last_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    nextRetryAt: row.next_retry_at,
  }
}
```

#### 2.2.4 路由挂载

在 `server/src/index.ts` 添加：

```typescript
import { syncLogsRouter } from './routes/syncLogs.js'
app.use('/api/sync/logs', syncLogsRouter)
```

#### 2.2.5 客户端 syncQueue.ts 改造

在 [syncQueue.ts](../../client/desktop/src/utils/syncQueue.ts) 的 `flushSyncQueue` 与 `enqueueSyncOp` 中增加服务器双写（**S-5 修复**：`enqueueSyncOp` 中不 await 避免阻塞用户操作；`flushSyncQueue` 中可以 await，因 flush 本身在异步任务中不阻塞主流程）：

```typescript
// client/desktop/src/utils/syncQueue.ts 改造点

// 1. 新增：upsertSyncLogToServer 函数
async function upsertSyncLogToServer(entry: SyncQueueEntry, status: 'pending' | 'success' | 'failed', lastError?: string): Promise<void> {
  try {
    await api.put('/sync/logs', {
      id: entry.id,
      operation: entry.operation,
      entityType: entry.entityType,
      entityId: entry.entityId,
      payload: entry.payload,
      status,
      retryCount: entry.retryCount,
      lastError,
      nextRetryAt: entry.nextRetryAt,
    })
  } catch (err) {
    // 服务器写入失败不阻塞主流程，仅 warn
    console.warn('[SyncQueue] Failed to upsert sync_log to server:', err)
  }
}

// 2. flushSyncQueue 中调用（**已在异步 flush 任务中，可以 await**，不阻塞主流程）
// 在 executeSyncOp 成功后：
await upsertSyncLogToServer(entry, 'success')

// 在 catch 分支中（retryCount++ 后）：
await upsertSyncLogToServer(entry, 'failed', errorMsg)

// 3. 在 enqueueSyncOp 中也调用（写入 pending）
// **S-5 修复**：enqueueSyncOp 是面向用户操作（如点击保存）的同步入口，
// 服务器双写必须**异步不阻塞主流程**（避免网络抖动导致 UI 卡顿）。
// 用 `void promise.catch(...)` 模式触发异步但不 await；与 4.1 风险表第 2 行一致。
export async function enqueueSyncOp(entry: Omit<SyncQueueEntry, 'id' | 'createdAt' | 'retryCount'>): Promise<void> {
  const fullEntry: SyncQueueEntry = {
    ...entry,
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: Date.now(),
    retryCount: 0,
  }
  await addToIdbQueue(fullEntry)
  // S3 缺口 B：异步写入服务器 sync_logs（pending 状态）— 不 await 不阻塞
  void upsertSyncLogToServer(fullEntry, 'pending').catch(err =>
    console.warn('[SyncQueue] Failed to upsert sync_log to server (pending):', err),
  )
  console.log(`[SyncQueue] Enqueued: ${entry.operation} ${entry.entityType}/${entry.entityId}`)
}
```

#### 2.2.6 客户端手动重试 / 删除 API

**S-3 修复**：客户端**不**跨端引用服务端类型（避免构建耦合 + 反模式）。在 `client/desktop/src/types/syncLogs.ts` 新建客户端独立类型文件，与服务端结构相同但独立：

```typescript
// client/desktop/src/types/syncLogs.ts — 客户端独立类型（不跨端引用 server/src/types）
// S3 修复：与服务端 SyncLogEntry 结构相同但独立维护，避免客户端/服务端构建耦合

export type SyncLogStatus = 'pending' | 'success' | 'failed'

export interface SyncLogEntry {
  id: string
  deviceId: string
  operation: 'create' | 'update' | 'delete'
  entityType: string
  entityId: string
  payload: unknown
  status: SyncLogStatus
  retryCount: number
  lastError: string | null
  createdAt: number
  updatedAt: number
  nextRetryAt: number | null
}

// retry 响应可能返回 skipped（create 重试不支持）
export type RetryStatus = SyncLogStatus | 'skipped'

export interface RetryResponse {
  ok: boolean
  status: RetryStatus
  error?: string
  reason?: string
}
```

新增 `client/desktop/src/api/syncLogs.ts`：

```typescript
import { api } from './client'
import type { SyncLogEntry, RetryResponse } from '../types/syncLogs.js'

export async function getFailedSyncLogs(deviceId?: string): Promise<SyncLogEntry[]> {
  const params = deviceId ? `?deviceId=${encodeURIComponent(deviceId)}` : ''
  const res = await api.get<{ items: SyncLogEntry[] }>(`/sync/logs/failed${params}`)
  return res.items
}

export async function retrySyncLog(id: string): Promise<RetryResponse> {
  return await api.post(`/sync/logs/retry/${id}`)
}

export async function deleteSyncLog(id: string): Promise<void> {
  await api.delete(`/sync/logs/${id}`)
}
```

### 2.3 缺口 C：sync_failed WS 事件

#### 2.3.1 ChangeEvent 联合类型扩展

在 [ws.ts:55-82](../../server/src/ws.ts) 的 ChangeEvent 联合类型末尾新增：

```typescript
export type ChangeEvent =
  | { kind: 'panel_created'; data: unknown }
  // ... 现有 26 种 ...
  | { kind: 'component_capability_deleted'; data: unknown }
  // S3 缺口 C：sync_failed 事件
  | { kind: 'sync_failed'; data: SyncFailedEvent }
```

新增 `SyncFailedEvent` 类型（在 ws.ts 顶部）：

```typescript
// Phase S3 缺口 C：sync_failed 推送载荷
export interface SyncFailedEvent {
  id: string                       // sync_log ID（客户端可用此 ID 调 retry/delete API）
  deviceId: string                // 失败操作发起设备
  operation: 'create' | 'update' | 'delete'
  entityType: string
  entityId: string
  lastError: string | null
  retryCount: number
  updatedAt: number
}
```

#### 2.3.2 调用入口

调用入口在 [syncLogs.ts PUT 路由](#223-路由synclogsts) 的"状态变为 failed"分支：

```typescript
if (body.status === 'failed') {
  const failedEntry: SyncFailedEvent = {
    id: body.id,
    deviceId,
    operation: body.operation,
    entityType: body.entityType,
    entityId: body.entityId,
    lastError: body.lastError ?? null,
    retryCount: body.retryCount ?? 0,
    updatedAt: now,
  }
  // 推送到发起设备（让发起方实时感知失败）
  sendToDevice(deviceId, {
    kind: 'change',
    changeType: 'sync_failed',
    data: failedEntry,
    sourceDeviceId: deviceId,
  })
  // 广播到所有设备（让多端协作的其他设备能看到该设备的失败操作）
  broadcastChange({ kind: 'sync_failed', data: failedEntry }, deviceId)
}
```

#### 2.3.3 客户端 useAppStore 监听

在 [useAIStore.ts:848-909](../../client/desktop/src/stores/useAIStore.ts) 的 `handleServerChange` 中新增 `sync_failed` 分支，调用 useAppStore 的 `addSyncFailedEntry`：

```typescript
case 'sync_failed': {
  const failed = data as {
    id: string
    deviceId: string
    operation: string
    entityType: string
    entityId: string
    lastError: string | null
    retryCount: number
    updatedAt: number
  }
  // 通过 ref 调用 useAppStore.getState()
  const appStore = getUseAppStore().getState() as {
    addSyncFailedEntry?: (entry: typeof failed) => void
  }
  appStore.addSyncFailedEntry?.(failed)
  break
}
```

在 [useAppStore.ts](../../client/desktop/src/stores/useAppStore.ts) 新增：

```typescript
// State
syncFailedEntries: Record<string, SyncFailedEntry>  // key: sync_log id

// Action
addSyncFailedEntry: (entry: SyncFailedEntry) => void
clearSyncFailedEntry: (id: string) => void
clearAllSyncFailedEntries: () => void

// 类型定义
interface SyncFailedEntry {
  id: string
  deviceId: string
  operation: string
  entityType: string
  entityId: string
  lastError: string | null
  retryCount: number
  updatedAt: number
}

// 实现（M-6 修复：useAppStore 通过 syncQueue.ts 暴露的封装函数操作 Set，
//       不直接 import 修改 syncQueueFailedEntries Set）
addSyncFailedEntry: (entry) => {
  set(state => ({
    syncFailedEntries: {
      ...state.syncFailedEntries,
      [entry.id]: entry,
    },
  }))
  // 通过 syncQueue.ts 暴露的封装函数操作本地 Set（双源统一）
  addFailedEntry(entry.id)
},
clearSyncFailedEntry: (id) => {
  set(state => {
    const newEntries = { ...state.syncFailedEntries }
    delete newEntries[id]
    return { syncFailedEntries: newEntries }
  })
  removeFailedEntry(id)
},
clearAllSyncFailedEntries: () => {
  set({ syncFailedEntries: {} })
  clearFailedEntries()
},
```

**M-6 修复**：在 `client/desktop/src/utils/syncQueue.ts` 暴露 3 个封装函数（不直接暴露 Set，避免外部模块直接修改内部状态）：

```typescript
// client/desktop/src/utils/syncQueue.ts 新增导出（M-6 修复）
// 这些函数封装对 syncQueueFailedEntries Set 的操作，避免 useAppStore 直接修改模块内 Set

export function addFailedEntry(id: string): void {
  syncQueueFailedEntries.add(id)
}

export function removeFailedEntry(id: string): void {
  syncQueueFailedEntries.delete(id)
}

export function clearFailedEntries(): void {
  syncQueueFailedEntries.clear()
}
```

useAppStore.ts 顶部 import：

```typescript
import { addFailedEntry, removeFailedEntry, clearFailedEntries } from '../utils/syncQueue'
```

### 2.4 缺口 D：失败 UI 提示组件

#### 2.4.1 候选位置分析

| 候选 | 优点 | 缺点 | 决策 |
|------|------|------|------|
| 复用 OfflineBanner 同位置 | 视觉一致 | 职责混淆（离线 vs 失败） | ❌ |
| Toast 通知 | 简洁 | 不持久，用户错过即丢 | ❌ |
| 新增 SyncFailedBanner | 独立职责，可展开列表 | 多一个组件 | ✅（推荐） |

#### 2.4.2 最终方案：新增 SyncFailedBanner 组件

新增 `client/desktop/src/components/SyncFailedBanner.tsx`，参考 [OfflineBanner.tsx](../../client/desktop/src/components/OfflineBanner.tsx) 的布局：

```tsx
import { useState, useEffect, memo, type ReactElement } from 'react'
import { AlertCircle, RefreshCw, Trash2, ChevronDown, ChevronUp, X } from 'lucide-react'
import { useAppStore } from '../stores/useAppStore'
import { retrySyncLog, deleteSyncLog } from '../api/syncLogs'

function SyncFailedBannerImpl(): ReactElement | null {
  const failedEntries = useAppStore(s => s.syncFailedEntries)
  const clearSyncFailedEntry = useAppStore(s => s.clearSyncFailedEntry)
  const [expanded, setExpanded] = useState(false)
  const [dismissed, setDismissed] = useState(false)

  const entryList = Object.values(failedEntries)
  const count = entryList.length

  // S-4 修复：用 useEffect 监听 count 变化重置 dismissed（不是 useState 反模式）
  // count > 0 时强制显示 banner（用户上次 dismiss 后若有新失败应再次提示）
  useEffect(() => {
    if (count > 0) setDismissed(false)
  }, [count])

  if (count === 0 || dismissed) return null

  const handleRetry = async (id: string) => {
    try {
      const result = await retrySyncLog(id)
      if (result.ok) {
        clearSyncFailedEntry(id)
      }
    } catch (err) {
      console.error('[SyncFailedBanner] retry failed:', err)
    }
  }

  const handleDelete = async (id: string) => {
    try {
      await deleteSyncLog(id)
      clearSyncFailedEntry(id)
    } catch (err) {
      console.error('[SyncFailedBanner] delete failed:', err)
    }
  }

  return (
    <div
      className="sync-failed-banner"
      role="alert"
      aria-live="polite"
      style={{
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        background: 'linear-gradient(90deg, #fef2f2 0%, #fee2e2 100%)',
        borderBottom: '1px solid #ef4444',
        color: '#991b1b',
        fontSize: '13px',
        fontWeight: 500,
      }}
    >
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '12px',
        padding: '8px 32px 8px 16px',
      }}>
        <AlertCircle size={16} aria-hidden="true" />
        <span>有 {count} 个同步操作失败，点击查看</span>
        <button
          type="button"
          onClick={() => setExpanded(prev => !prev)}
          aria-label={expanded ? '收起失败列表' : '展开失败列表'}
          style={{
            marginLeft: '4px',
            padding: '3px 10px',
            background: '#991b1b',
            color: '#fff',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer',
            fontSize: '12px',
            fontWeight: 500,
            display: 'flex',
            alignItems: 'center',
            gap: 4,
          }}
        >
          {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
          {expanded ? '收起' : '展开'}
        </button>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          aria-label="关闭提示"
          style={{
            position: 'absolute',
            right: '8px',
            top: '50%',
            transform: 'translateY(-50%)',
            padding: 2,
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            color: '#991b1b',
            opacity: 0.7,
            lineHeight: 0,
          }}
        >
          <X size={14} />
        </button>
      </div>

      {expanded && (
        <div style={{
          maxHeight: 300,
          overflowY: 'auto',
          padding: '8px 16px',
          borderTop: '1px solid #fca5a5',
          background: '#fef2f2',
        }}>
          {entryList.map((entry) => (
            <div key={entry.id} style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '6px 8px',
              marginBottom: 4,
              background: '#fff',
              borderRadius: 4,
              border: '1px solid #fecaca',
              fontSize: 12,
            }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600 }}>
                  {entry.operation} {entry.entityType}/{entry.entityId}
                </div>
                <div style={{ color: '#7f1d1d', fontSize: 11, marginTop: 2, wordBreak: 'break-word' }}>
                  {entry.lastError || '未知错误'}
                </div>
                <div style={{ color: '#9ca3af', fontSize: 10, marginTop: 2 }}>
                  重试 {entry.retryCount} 次 · 设备 {entry.deviceId.slice(0, 8)} · {new Date(entry.updatedAt).toLocaleString()}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 4, marginLeft: 8 }}>
                <button
                  onClick={() => handleRetry(entry.id)}
                  title="重试"
                  style={{
                    padding: 4,
                    background: 'transparent',
                    border: '1px solid #dc2626',
                    borderRadius: 4,
                    cursor: 'pointer',
                    color: '#dc2626',
                    display: 'flex',
                  }}
                >
                  <RefreshCw size={12} />
                </button>
                <button
                  onClick={() => handleDelete(entry.id)}
                  title="删除（放弃此操作）"
                  style={{
                    padding: 4,
                    background: 'transparent',
                    border: '1px solid #dc2626',
                    borderRadius: 4,
                    cursor: 'pointer',
                    color: '#dc2626',
                    display: 'flex',
                  }}
                >
                  <Trash2 size={12} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export const SyncFailedBanner = memo(SyncFailedBannerImpl)
export default SyncFailedBanner
```

#### 2.4.3 App.tsx 挂载

在 [App.tsx](../../client/desktop/src/App.tsx) 中，与 OfflineBanner 同级渲染：

```tsx
import { OfflineBanner } from './components/OfflineBanner'
import { SyncFailedBanner } from './components/SyncFailedBanner'

// 在 app-topbar 上方
<OfflineBanner />
<SyncFailedBanner />
<div className="app-topbar">...</div>
```

### 2.5 死代码清理：sync_queue 标记 deprecated

在 [schema.ts:118-130](../../server/src/db/schema.ts) 的 `sync_queue` 表定义上方加注释。**位置精确**：在 `schema.ts` 现有 L117（即 `CREATE TABLE IF NOT EXISTS sync_queue` 语句上方）插入以下 4 行注释：

```sql
-- [DEPRECATED] sync_queue 表：Phase 3 遗留死代码，无任何 INSERT/SELECT 引用
-- Phase S3 替代为 sync_logs 表（保留旧表不删，避免破坏已部署 DB）
-- 新代码请使用 sync_logs 表
-- （此 4 行注释插入到 sync_queue CREATE TABLE 语句正上方）
CREATE TABLE IF NOT EXISTS sync_queue (
  -- ... 原字段保持不变 ...
);
```

**决策**：保留 schema 不动，仅在注释中标记 `[DEPRECATED]`，避免破坏已部署 DB。

---

## 三、实施步骤

### 步骤 1：备份（可跳过）

无 DB schema 破坏性变更（所有 DDL 用 `CREATE TABLE IF NOT EXISTS` 幂等，sync_queue 不删），可跳过备份。如需保险可执行：

```bash
docker exec living-dashboard-postgres pg_dump -U postgres living_dashboard > data/backup-pre-s3.sql
```

### 步骤 2：编码（分 5 个并行 sub-agent）

#### Sub-agent A：实体冲突日志（缺口 A）

- 新建 `server/src/db/schema.ts` 末尾追加 `entity_conflict_logs` 表 DDL（CREATE TABLE IF NOT EXISTS 幂等）
- 新建 `server/src/routes/entityConflicts.ts`（GET / + GET /:id + POST /:id/resolve）
- 改造 `server/src/routes/entities.ts` PUT 路由 L165-172 分支，版本不匹配时 INSERT 冲突日志
- 新建 `server/src/types/index.ts` 类型定义
- 在 `server/src/index.ts` 挂载路由
- 验证：`npm run build` 无错

#### Sub-agent B：sync_logs 表 + API + 客户端 api/syncLogs.ts（缺口 B）

- 新建 `server/src/db/schema.ts` 末尾追加 `sync_logs` 表 DDL（CREATE TABLE IF NOT EXISTS 幂等）
- 新建 `server/src/routes/syncLogs.ts`（GET / + GET /failed + PUT / + DELETE /:id + POST /retry/:id + PUT 参数校验 + create 早期返回 skipped + executeSyncOpOnServer default 抛错）
- 新建 `server/src/types/index.ts` 类型定义
- 在 `server/src/index.ts` 挂载路由
- 改造 `client/desktop/src/utils/syncQueue.ts`：新增 `upsertSyncLogToServer` 函数；在 `enqueueSyncOp` 写 pending（**不 await**，void + catch）、`flushSyncQueue` 成功/失败时双写（**可以 await**）；新增 M-6 暴露的 `addFailedEntry` / `removeFailedEntry` / `clearFailedEntries` 函数
- 新建 `client/desktop/src/types/syncLogs.ts`（S-3 客户端独立类型：SyncLogEntry / SyncLogStatus / RetryResponse）
- 新建 `client/desktop/src/api/syncLogs.ts`（getFailedSyncLogs/retrySyncLog/deleteSyncLog，引用客户端独立类型）
- 验证：`npm run build` 无错

#### Sub-agent C：服务端 sync_failed WS 事件推送（缺口 C 服务端部分）

- 改造 `server/src/ws.ts`：ChangeEvent 联合类型新增 `sync_failed`；新增 `SyncFailedEvent` 类型
- 改造 `server/src/routes/syncLogs.ts` PUT 路由：状态变为 failed 时调用 sendToDevice + broadcastChange 推送 sync_failed 事件（**依赖 Sub-agent B 完成**，串行）
- 验证：`npm run build` 无错

#### Sub-agent D：客户端 sync_failed 监听 + 失败 UI 提示（缺口 C 客户端部分 + 缺口 D 全部）

**S-6 修复**：将 `useAppStore` 的 syncFailedEntries state/actions 划入 D（与 SyncFailedBanner 同 sub-agent），让 D 自包含不再依赖 C。D 仅依赖 B（提供客户端 `api/syncLogs.ts` 与 `types/syncLogs.ts`）。

- 改造 `client/desktop/src/stores/useAppStore.ts`：新增 syncFailedEntries state + addSyncFailedEntry/clearSyncFailedEntry/clearAllSyncFailedEntries actions（通过 M-6 暴露的 `addFailedEntry` / `removeFailedEntry` / `clearFailedEntries` 操作 syncQueue.ts 的 Set，不直接修改模块内 Set）
- 改造 `client/desktop/src/stores/useAIStore.ts` handleServerChange：新增 `sync_failed` 分支，调用 useAppStore.addSyncFailedEntry（与 useAppStore 改造同 sub-agent，自包含）
- 新建 `client/desktop/src/components/SyncFailedBanner.tsx`（参考 OfflineBanner 布局，useEffect 监听 count 变化重置 dismissed）
- 改造 `client/desktop/src/App.tsx`：在 app-topbar 上方挂载 SyncFailedBanner
- 探索现有 UI 组件确认最终位置（候选：OfflineBanner 旁挂 / Toast / 新组件，推荐新组件）
- 验证：`npm run build` 无错

#### Sub-agent E：spec 完善 + schema.ts 注释（缺口 E + 死代码清理）

- 完善 `docs/specs/phase-s3-conflict-resolution-spec.md`（本文件）
- 改造 `server/src/db/schema.ts` sync_queue 表加 `[DEPRECATED]` 注释
- 更新 `docs/roadmap_server_v1.md` Phase S3 验收清单勾选

**并行依赖**（S-6 修复后）：A/B/E 完全独立可并行；C 依赖 B（syncLogs.ts PUT 路由推送 sync_failed）；D 依赖 B（需要客户端 `api/syncLogs.ts` 与 `types/syncLogs.ts`，以及 syncQueue.ts 暴露的 addFailedEntry/removeFailedEntry/clearFailedEntries 函数）。建议 A/B/E 并行启动，B 完成后 C+D 并行启动。

### 步骤 3：运行时验证

```bash
cd f:\allmylife\event\server
# 端口 3458 避免与已运行的 living-dashboard-server 容器（生产旧镜像）端口冲突
$env:SERVER_PORT=3458; $env:PG_PORT=5433; npm run dev
```

**运行时验证清单**（必须全部通过，不能只读代码）：

1. ✅ Server 启动无报错，日志 `[Schema] PostgreSQL schema initialized, version: 1` 输出
2. ✅ 新表创建成功（用 psql 或 docker exec 验证）：
   ```sql
   \dt entity_conflict_logs
   \dt sync_logs
   -- 两条表都应存在
   ```
3. ✅ 缺口 A 实体冲突日志：
   - 用 curl/Postman 先 POST /api/entities 创建一个 entity（拿到 id 和 version=1）
   - 同时发起两个 PUT /api/entities/:id（都用 expectedVersion=1）：
     ```
     curl -X PUT http://localhost:3458/api/entities/<id> \
       -H "Content-Type: application/json" \
       -d '{"data":{"title":"v2"},"expectedVersion":1}'
     ```
   - 验证：两个请求都返回 200（LWW 都成功），但服务器日志输出 `[Conflict] Entity ... version mismatch: ... logged to entity_conflict_logs`
   - 验证：`SELECT * FROM entity_conflict_logs;` 应有一条记录
   - 验证：GET /api/entities/conflicts 返回该条日志
   - 验证：POST /api/entities/conflicts/:id/resolve 后 resolved=TRUE
4. ✅ 缺口 B sync_logs 表 + API：
   - PUT /api/sync/logs 写入 pending：
     ```
     curl -X PUT http://localhost:3458/api/sync/logs \
       -H "Content-Type: application/json" \
       -d '{"id":"test-1","operation":"update","entityType":"widget","entityId":"w1","payload":{"state":{}},"status":"pending"}'
     ```
   - 验证：`SELECT * FROM sync_logs WHERE id='test-1';` 有一条 status=pending
   - PUT /api/sync/logs 更新为 failed：`{"id":"test-1",...,"status":"failed","lastError":"test error","retryCount":11}`
   - 验证：GET /api/sync/logs/failed 返回该条
   - DELETE /api/sync/logs/test-1 后再 GET，应 404
   - POST /api/sync/logs/retry/:id 手动重试（写入一条 entityType=widget + operation=update 的 sync_log，再调 retry，应执行 UPDATE）
5. ✅ 缺口 C sync_failed WS 推送：
   - 用 wscat 或浏览器 devtools 连 ws://localhost:3458
   - PUT /api/sync/logs status=failed
   - 验证：所有连接的 WS 客户端收到 `{ kind: 'change', changeType: 'sync_failed', data: {...} }` 消息
   - 验证：发起方 deviceId 也收到（sendToDevice 定向）
6. ✅ **M-4 新增**：客户端 syncQueue 双写验证：
   - 桌面端启动后断网（如关闭服务器或断开 Wi-Fi），修改一个 widget
   - 验证：`SELECT * FROM sync_logs WHERE entity_type='widget' AND entity_id='<id>'` 应有一条 `status='pending'` 记录（enqueueSyncOp 写入）
   - 恢复网络，sync 成功后查询：应有 `status='success'` 记录（flushSyncQueue 成功分支双写）
   - 触发持续失败（如把 widget 的 id 改为不存在让 PUT 返回 404）超过 FAILED_THRESHOLD=10 次：应有 `status='failed'` 记录（flushSyncQueue catch 分支双写）
   - 验证：上述双写过程中 UI 不卡顿（enqueueSyncOp 双写不 await，flushSyncQueue 双写已脱离主流程）
7. ✅ 缺口 D 失败 UI 渲染：
   - 桌面端启动，触发一个 syncQueue 失败（如断网时修改 widget 再恢复网络）
   - 验证：顶部出现红色 SyncFailedBanner，显示"有 1 个同步操作失败，点击查看"
   - 点击展开，看到失败列表
   - 点击"重试"按钮，调用 POST /api/sync/logs/retry/:id，成功后 banner 消失
   - 点击"删除"按钮，调用 DELETE /api/sync/logs/:id，banner 消失
8. ✅ 缺口 E + 死代码清理：
   - 验证 schema.ts 中 sync_queue 表注释包含 `[DEPRECATED]`
   - 验证新代码无引用 sync_queue 表
9. ✅ 多端协作验证：
   - 启动两个桌面端实例（device-A / device-B）
   - device-A 触发 sync 失败
   - 验证：device-B 顶部也出现 SyncFailedBanner（多端都能感知到 device-A 的失败操作）
10. ✅ `docker compose config` 无报错（无 schema 破坏性变更，仅新增表 + 注释）
11. ✅ `npm run build` TypeScript 编译无错（server + client/desktop 都验证）

### 步骤 4：对抗审查

使用 `adversarial-review` skill 对编码成果做对抗审查（含运行时验证），不合格则修复后重审。

**对抗审查重点**：
- 实体冲突日志的 INSERT 是否在 LWW UPDATE 之前/之后？是否在事务中？（**已用 `withTransaction` 包裹**，spec 2.1.3 落地）
- sync_logs upsert 的 ON CONFLICT (id) 是否正确？device_id 在 ON CONFLICT 时不更新是否合理？（合理：同一 id 必属同一设备）
- sync_failed 事件是否会重复推送给发起方？（发起方既被 sendToDevice 又被 broadcastChange 推送，但 broadcastChange 排除 sourceDeviceId，因此发起方只收到一次）
- SyncFailedBanner 的 dismissed 状态在 failed 数量变化时是否重置？（**已用 useEffect 监听 count**，非 useState 反模式，spec 2.4.2 落地）
- 客户端 syncQueue 双写是否阻塞主流程？（**enqueueSyncOp 中已用 `void promise.catch(...)` 不 await**；flushSyncQueue 中可以 await — 已在异步 flush 任务中不阻塞主流程，spec 2.2.5 落地）
- **S-2 重点**：所有 `/api/sync/logs` 与 `/api/entities/conflicts` API 走 `/api` 全局 `authMiddleware`，**deviceId 仅从 `req.deviceId` 取**（由 authMiddleware 注入），**禁止**从 `req.body.deviceId` 读取（防止伪造）。代码审查时 Grep `body.deviceId` 应无匹配（spec 2.2.3 已删除 `?? body.deviceId`）
- **M-3 重点**：PUT `/api/sync/logs` 入参校验是否覆盖 id/operation/entityType/entityId 必填 + operation/status 枚举（spec 2.2.3 已落地）
- **S-7 重点**：retry 路由对 create 操作是否早期返回 `{ ok: false, status: 'skipped', reason: 'create retry not supported on server' }`；executeSyncOpOnServer 是否对 settings/favorite 等不支持类型 default 抛错（spec 2.2.3 已落地）
- API 是否有权限校验？（当前仅 deviceId 透传，未做鉴权 — S3 范围内不引入鉴权，沿用现有 routes 的 deviceId 透传约定）

### 步骤 5：git commit + 更新 roadmap

```bash
cd f:\allmylife\event
git add docs/specs/phase-s3-conflict-resolution-spec.md \
        server/src/db/schema.ts \
        server/src/routes/entityConflicts.ts \
        server/src/routes/syncLogs.ts \
        server/src/routes/entities.ts \
        server/src/ws.ts \
        server/src/types/index.ts \
        server/src/index.ts \
        client/desktop/src/utils/syncQueue.ts \
        client/desktop/src/types/syncLogs.ts \
        client/desktop/src/api/syncLogs.ts \
        client/desktop/src/stores/useAppStore.ts \
        client/desktop/src/stores/useAIStore.ts \
        client/desktop/src/components/SyncFailedBanner.tsx \
        client/desktop/src/App.tsx \
        docs/roadmap_server_v1.md

git commit -m "feat(server): phase S3 conflict resolution + syncQueue persistence

- entity_conflict_logs table for conflict auditing (gap A)
- sync_logs table + 4 APIs to replace dead sync_queue (gap B)
- sync_failed WS event via broadcastChange + sendToDevice (gap C)
- SyncFailedBanner UI component with retry/delete actions (gap D)
- mark sync_queue table as [DEPRECATED] in schema (gap E + cleanup)

Refs: docs/specs/phase-s3-conflict-resolution-spec.md"
```

更新 [roadmap_server_v1.md](../roadmap_server_v1.md) Phase S3 验收清单勾选（L594-602）。

---

## 四、风险与回滚

### 4.1 风险

| 风险 | 影响 | 缓解 |
|------|------|------|
| sync_logs 表数据增长（每次 sync 都写一条） | DB 占用增加 | 客户端 success 后调 DELETE 删除；服务器端可加 cron 定期清理 success 记录（保留 7 天）；failed 记录保留至用户手动删除 |
| 客户端 syncQueue 双写性能（每次 enqueue/flush 多一次 HTTP 调用） | 主流程延迟 | `enqueueSyncOp` 中双写用 `void promise.catch(...)` **不 await**（避免阻塞用户操作）；`flushSyncQueue` 中可以 await（已在异步 flush 任务中不阻塞主流程）；catch err 仅 warn 不抛 |
| sync_failed 事件广播导致发起方重复收到 | UI 重复刷新 | `broadcastChange` 排除 sourceDeviceId；发起方仅由 `sendToDevice` 收到一次 |
| SyncFailedBanner dismissed 状态导致新失败被忽略 | 用户错过失败提示 | **已用** `useEffect(() => { if (count > 0) setDismissed(false) }, [count])` 监听 count 变化重置 dismissed（spec 2.4.2 已落地，非 useState 反模式） |
| 实体冲突日志 INSERT 与 UPDATE 不一致 | 数据不一致 | **已用** `withTransaction` 包裹 INSERT + UPDATE + SELECT 返回（参考 [connection.ts:74](../../server/src/db/connection.ts) 实现，spec 2.1.3 已落地）；事务内任何步骤失败整体回滚，避免 INSERT 成功但 UPDATE 失败 |
| sync_logs.retry 服务器端重试 create 操作产生重复 | 数据重复 | retry 路由对 create 操作早期返回 `{ ok: false, status: 'skipped', reason: 'create retry not supported on server' }`；create 重试由客户端 syncQueue 本地处理去重 |
| sync_failed 事件被旧客户端收到导致报错 | 旧客户端崩溃 | 客户端 handleServerChange 已有 `default: break` 兜底，未知 changeType 忽略 |
| Docker 镜像构建（如包含新 routes）需重建镜像 | 部署需新镜像 | S3 范围内仅本地验证用 `node dist/index.js`，生产部署待 Phase S7 重建镜像 |
| **S-8 新增**：entity_conflict_logs 表无限增长 | DB 占用持续增加 | resolved=TRUE 且 created_at < 30 天前的记录定期清理（可复用 scheduleRetentionCleanup cron 时机，或在 server 启动时执行一次清理 SQL）；schema 已有 `idx_entity_conflict_logs_created_at` 索引便于清理；保留 30 天内未解决冲突供审计 |

### 4.2 回滚方案

1. **代码回滚**：`git revert <commit>` 回到 S3 前的提交
2. **数据库回滚**：
   - 所有 DDL 用 `CREATE TABLE IF NOT EXISTS` 幂等，回滚后表仍存在但无引用（不影响）
   - 如需彻底清理：`DROP TABLE IF EXISTS entity_conflict_logs; DROP TABLE IF EXISTS sync_logs;`
3. **客户端回滚**（M-8 修复明确）：删除 `client/desktop/src/utils/syncQueue.ts` 中 `enqueueSyncOp` 与 `flushSyncQueue` 的 `upsertSyncLogToServer(...)` 调用（包括 enqueueSyncOp 中的 `void upsertSyncLogToServer(...).catch(...)` 和 flushSyncQueue 中的 `await upsertSyncLogToServer(...)`），恢复纯 IndexedDB 路径；保留 `upsertSyncLogToServer` 函数定义不删（避免引用断裂，下次恢复 S3 时直接调用即可）；服务端 `sync_logs` 表保留（不影响功能，可后续手动 `DROP TABLE IF EXISTS sync_logs;`）
4. **API 失败降级**：syncLogs API 失败时客户端 catch err + warn，不影响主流程；可降级到原 `console.warn` 行为

---

## 五、与后续 Phase 的契约

### 5.1 与桌面端 Phase 4.1（架构改造）的契约

S3 完成后，桌面端 Phase 4.1 可以消费：
- `GET /api/sync/logs/failed` 查询失败操作
- `POST /api/sync/logs/retry/:id` 手动重试
- `DELETE /api/sync/logs/:id` 删除记录
- `sync_failed` WS 事件实时监听
- `GET /api/entities/conflicts` 查询实体冲突日志

### 5.2 与移动端 Phase M5（数据同步）的契约

S3 完成后，移动端 Phase M5 可以消费：
- `PUT /api/sync/logs` 写入移动端的 sync 操作
- `GET /api/sync/logs?deviceId=<移动端id>` 查询本设备的 sync 状态
- `sync_failed` WS 事件实时监听
- 移动端实现自己的 SyncFailedBanner（参考桌面端布局）

### 5.3 与 S2 的关系

S3 复用 S2 已落地的 `panelOnlineDevices` 定向广播基础设施：
- `sync_failed` 事件用 `sendToDevice(deviceId, ...)` 定向推送给发起方
- 用 `broadcastChange({kind: 'sync_failed', ...}, deviceId)` 广播给所有设备（排除发起方）
- 不冲突，可消费

### 5.4 与 S5/S6 的关系

S3 不涉及 dynamic_widgets / local_service_registry，与 S5（动态组件跨端）/ S6（本地服务代理）不冲突，可并行。

---

## 六、附录：关键文件变更清单

| 文件 | 变更类型 | 行数估计 |
|------|---------|---------|
| `server/src/db/schema.ts` | 追加 `entity_conflict_logs` + `sync_logs` 表 DDL；`sync_queue` 加 `[DEPRECATED]` 注释 | +50 / -0 |
| `server/src/routes/entityConflicts.ts` | 新建（GET / + GET /:id + POST /:id/resolve） | +120 行 |
| `server/src/routes/syncLogs.ts` | 新建（GET / + GET /failed + PUT / + 参数校验 + create 早期返回 skipped + DELETE /:id + POST /retry/:id + sync_failed 推送 + executeSyncOpOnServer default 抛错） | +220 行 |
| `server/src/routes/entities.ts` | PUT 路由 L165-198 整段改造：`withTransaction` 包裹 INSERT entity_conflict_logs + UPDATE entities + RETURNING | +30 / -10 行 |
| `server/src/ws.ts` | ChangeEvent 新增 `sync_failed`；新增 `SyncFailedEvent` 类型 | +10 行 |
| `server/src/types/index.ts` | 新增 EntityConflictLog / SyncLogEntry / UpsertSyncLogRequest 类型 | +50 行 |
| `server/src/index.ts` | 挂载 entityConflictsRouter + syncLogsRouter | +4 行 |
| `client/desktop/src/utils/syncQueue.ts` | 新增 `upsertSyncLogToServer` 函数；enqueueSyncOp 双写用 `void promise.catch(...)` 不 await；flushSyncQueue 双写可以 await；新增 M-6 暴露的 `addFailedEntry` / `removeFailedEntry` / `clearFailedEntries` 函数 | +50 行 |
| **`client/desktop/src/types/syncLogs.ts`** | **S-3 新建**：客户端独立类型 SyncLogEntry / SyncLogStatus / RetryResponse（不跨端引用 server/src/types） | **+30 行** |
| `client/desktop/src/api/syncLogs.ts` | 新建（getFailedSyncLogs/retrySyncLog/deleteSyncLog，引用客户端独立类型） | +25 行 |
| `client/desktop/src/stores/useAppStore.ts` | 新增 syncFailedEntries state + 3 个 actions；新增 SyncFailedEntry 类型；通过 M-6 函数操作 syncQueue Set 不直接修改 | +65 行 |
| `client/desktop/src/stores/useAIStore.ts` | handleServerChange 新增 `sync_failed` 分支 | +15 行 |
| `client/desktop/src/components/SyncFailedBanner.tsx` | 新建（参考 OfflineBanner 布局，含展开列表 + 重试 + 删除；useEffect 监听 count 变化重置 dismissed） | +185 行 |
| `client/desktop/src/App.tsx` | 挂载 SyncFailedBanner | +3 行 |
| `docs/specs/phase-s3-conflict-resolution-spec.md` | 新建（本文件） | +700 行 |
| `docs/roadmap_server_v1.md` | Phase S3 验收清单勾选 | -8 / +8 行 |

**总变更**：9 个新建文件 + 7 个修改文件，约 +1535 行 / -18 行

---

## 七、验收清单（与 roadmap L594-602 对齐）

### Phase S3 验收

- [ ] **UPDATE 语句加 version 校验（WHERE id=$2 AND version=$3 RETURNING *）** — widgets 已落地（[widgets.ts:130-156](../../server/src/routes/widgets.ts)），S3 不改动 widgets 路由；entities 走 LWW + 冲突日志策略（[entities.ts:165-172](../../server/src/routes/entities.ts)），与架构文档 4.3 表"实体数据冲突：LWW + 记录冲突日志"一致 — 验收：完全合格（widgets 既有 + entities LWW 策略符合设计）
- [ ] **并发修改不静默丢失** — widgets 走乐观锁（冲突 409 让用户感知）；entities 走 LWW + 冲突日志（INSERT entity_conflict_logs 供审计） — 验收：完全合格（双策略均不静默丢数据）
- [ ] **冲突时返回服务器版本供客户端展示** — widgets PUT 返回 `{conflict:true, currentVersion, currentState}`（[widgets.ts:143-149](../../server/src/routes/widgets.ts)）；entities **不在 PUT 响应中返回冲突**，客户端通过 `GET /api/entities/conflicts` 查询；响应字段为 `{conflicts}` / `{conflict}` / `{ok, conflict}`（采用资源名包装，三端点结构一致，符合 RESTful 风格） — 验收：完全合格（widgets 既有；entities 对 roadmap L597 的弱化对齐 — roadmap L597 期望"返回冲突"，但架构文档 4.3 明确"实体数据冲突：LWW + 记录冲突日志"不返回，spec 以架构文档为准；客户端可主动查询冲突日志获得等价信息）
  - **加注**：`entity_conflict_logs` 表字段命名采用 **local/remote 视角**（`local_*` = 服务器当前，`remote_*` = 客户端尝试），与 spec 早期版本的 `expected/current` 命名不同 — 采用 local/remote 因其更直观地从服务器视角描述冲突。对应字段映射：`local_version` = 服务器当前版本（existing.version）；`remote_version` = 客户端期望版本（body.expectedVersion）；`local_state` = 服务器当前 data；`remote_state` = 客户端尝试 data；`source_device_id` = 发起冲突的设备；`resolved_action` = 解决动作（keep-local/keep-remote/merge）。`id` 用 `TEXT(UUID)` 比 `BIGSERIAL` 更适合分布式多端场景（客户端可预生成）
- [ ] **智能分场景策略正确（位置 LWW / state LWW+角标 / 删除优先 / 实体 LWW+日志）** — 位置 LWW（[widgets.ts:159-180](../../server/src/routes/widgets.ts)）；state LWW+角标（ConflictBadge 已落地）；删除优先（panels ON DELETE CASCADE）；实体 LWW+日志（S3 缺口 A 落地） — 验收：完全合格（四策略均落地）
- [ ] **syncQueue 服务器侧持久化日志** — S3 缺口 B 落地 sync_logs 表 + 4 API + 客户端双写 — 验收：完全合格
- [ ] **无上限重试 + 指数退避** — 客户端既有（[syncQueue.ts:12-13](../../client/desktop/src/utils/syncQueue.ts) RETRY_DELAYS + FAILED_THRESHOLD），S3 不改动 — 验收：完全合格（既有）
- [ ] **失败操作 UI 提示** — S3 缺口 D 落地 SyncFailedBanner 组件 — 验收：完全合格
- [ ] **Docker 镜像构建 + 迁移脚本执行成功** — **延期至 Phase S7**，S3 范围内不验收 Docker 镜像构建；本地验证用 `node dist/index.js`，迁移脚本通过 `initializeSchema` 幂等执行验证（`CREATE TABLE IF NOT EXISTS`，重启服务后日志 `[Schema] PostgreSQL schema initialized, version: 1` 输出即视为迁移成功） — 验收：S3 范围内完全合格（本地验证通过），Docker 镜像构建留待 S7 验收
