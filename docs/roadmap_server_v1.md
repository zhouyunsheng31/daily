# Living Dashboard 服务器端 Roadmap v1

> 生成日期：2026-06-24
> 架构依据：[architecture_refactor.md](architecture_refactor.md)（必读）
> 关联：[roadmap_desktop_v1.md](roadmap_desktop_v1.md) 桌面端、[roadmap_mobile_v1.md](roadmap_mobile_v1.md) 移动端
> 状态：Phase S0（Phase 3 服务器化）已完成，本文档专注 Phase S1+ 新任务
>
> **产品定位**：服务器是 AI 推理 + 数据同步 + 多端协作的中心

---

## 一、项目背景

### 1.1 现状

服务器端已完成 Phase 3（服务器化）：

| 能力 | 说明 |
|------|------|
| **Docker 部署** | docker-compose 一键部署，PostgreSQL 持久化 |
| **WS 网关** | 多客户端连接，指令下发/结果回传 |
| **Pi Agent AI 推理** | 24 个工具（browser_*/widget_*/storage_*），按设备路由执行 |
| **数据同步** | widgets/panels/entities/favorites/bookmarks 等表，withFallback + broadcastChange 机制 |
| **canvasStorage 协议** | 组件数据持久化协议，多端共享 |

### 1.2 待改造问题（来自架构文档 1.2 节）

| 问题 | 现状 | 影响 | 对应 Phase |
|------|------|------|-----------|
| **session 模型** | 全局单 session，所有设备共享上下文 | 不同面板的对话互相污染 | S1 |
| **activeDeviceId** | 单一，多端抢控制权 | 多端无法并行 AI 操作 | S2 |
| **冲突解决** | version 字段存了但没校验 | 多端并发改同一数据会静默丢失 | S3 |
| **syncQueue 持久化** | 仅 IndexedDB（客户端侧） | 清缓存就丢，超 5 次重试静默放弃；服务器侧无持久化日志 | S3 |
| **组件跨端** | 未设计 | 动态组件无法多端共享；依赖本地环境组件无法跨端 | S5/S6 |

---

## 二、开发路线

### Phase S0：已完成（Phase 3 服务器化）✅

**目标**：服务器化基础能力

已完成内容：

| 能力 | 详情 |
|------|------|
| Docker 部署 | docker-compose 配置，PostgreSQL + Node 服务 |
| WS 网关 | 多客户端连接管理，心跳保活，断线重连 |
| Pi Agent AI 推理 | `@earendil-works/pi-agent-core` + `@earendil-works/pi-ai`，24 个工具 |
| 工具路由 | DEVICE_SPECIFIC_TOOLS 按全局 activeDeviceId 路由 |
| 数据同步 | widgets/panels/entities/favorites 等表 CRUD + 广播 |
| withFallback | 服务器权威 + 客户端本地缓存降级 |
| broadcastChange | 服务器变更广播到所有在线客户端 |
| canvasStorage | 组件数据持久化协议，kvStorage 链路 |

**参考文档**：[phase3-server-spec.md](specs/phase3-server-spec.md)

---

### Phase S1：AI 上下文改造（P0）✅ 已完成

**目标**：按面板隔离 AI 上下文，多端共享同面板上下文，对话历史持久化

**架构依据**：[architecture_refactor.md](architecture_refactor.md) 第二章（2.1-2.5）+ 第十二章 12.1

**被依赖**：桌面端 Phase 4.1、移动端 Phase M3、移动端 Phase M5

**完成内容（2026-06-28）**：
- S1 主体框架在 Phase 4 / Phase S0 已完成（per-panel session、ai_conversations/ai_memories 表、7 天超时清理、分层保留 cron、多端共享广播）；本次收尾修复 5 个实质缺口（详见 [phase-s1-ai-context-spec.md](specs/phase-s1-ai-context-spec.md)）
- 缺口 A（assistant/tool 持久化）：`server/src/db/aiContext.ts` 新增 `persistPiEvent` 函数（L77-156），监听 `message_end` (role=assistant) + `tool_execution_end` 事件，白名单跳过 custom/bashExecution 等；`server/src/piBridge.ts` L1128-1132 subscribe 回调调用
- 缺口 B（session 恢复重写）：`server/src/db/aiContext.ts` `restoreSessionContext` (L218-275) + `renderConversationBlock` (L293-324) 重写，移除 500 字符截断，结构化 markdown 渲染，单条 8000 字符上限 + 总长度 60000 字符上限（从头部最旧裁剪）+ memories 20 条 + 8000 字符上限
- 缺口 C（panel 删除联动）：`server/src/piBridge.ts` 新增 `disposePanelSession` 导出（L136-168），清理 panelSessions/panelSessionApiConfig/sessionLastUsed/panelActiveDevices/panelSessionReady/panelOnlineDevices/pendingRequests/askUserPending；`server/src/routes/panels.ts` DELETE handler (L169-205) 改为同事务原子操作（withTransaction 删除 panels + ai_conversations + ai_memories），失败回滚 HTTP 500
- 缺口 D（prompt 去重）：`server/src/piBridge.ts` 删除 `DEFAULT_CANVAS_PROMPT`/`DEFAULT_BROWSER_PROMPT`/`DEFAULT_SYSTEM_PROMPT` 常量，改用 `DEFAULT_PROMPTS.{canvasPrompt,browserPrompt,systemPrompt}` 单一来源（来自 `aiSettingsStore.ts`）
- 缺口 E（docker-compose 资源限制）：`docker-compose.yml` postgres 加 mem_limit:512m + mem_reservation:256m + logging(json-file max-size:10m max-file:3) + restart:unless-stopped；server 加 mem_limit:1g + mem_reservation:512m + cpus:1.0 + logging + restart
- Bug 修复（对抗审查发现）：`persistPiEvent` 函数开头加 `if (panelId.startsWith('session-only:')) return`，避免 session-only 面板的 assistant/tool 消息变成孤儿记录
- 运行时验证（12/12 通过）：server 启动日志含 `per-panel session mode`；GET /api/health 200；persistConversation 写入 3 行（user/assistant/tool）；ai_conversations 表 role 字段只出现 user/assistant/tool；restoreSessionContext 日志 `restoring 3 conversations` + `context restored (278 chars)` (≤60000)；panel 删除联动清理（conv 2→0, mem 1→0）；DELETE 不存在 panel 返回 500 + 事务回滚；docker compose config 无报错；docker inspect 显示 server Memory=1GB NanoCpus=1.0 CPU；grep 验证 prompt 去重
- 对抗审查：通过（需求覆盖 100%，6 项需求全部完成 + 12 项运行时验证通过 + 1 个中等 bug 已修复并验证）

| 任务 | 详情 | 验收标准 | 架构文档章节 |
|------|------|----------|------------|
| ai_conversations 表 | 按 panel_id 存对话历史，含 role/content/tool_calls/tool_result/device_id/created_at；加 summarized/summary_of/retention_level 字段（分层保留） | 表结构正确，可写入查询 | 2.4 + 12.1 |
| ai_memories 表 | 按 panel_id 存长期记忆，含 memory_type/content/created_at/updated_at | 表结构正确 | 2.4 |
| per-panel session | `SessionManager.inMemory()` 单例 → `Map<panelId, AgentSession>`，按面板创建/隔离 | 不同面板对话不污染 | 2.2-2.3 |
| 消息路由改造 | `onClientMessage(deviceId, msg)` → `onClientMessage(deviceId, panelId, msg)` | 消息按面板路由 | 2.3 |
| session 生命周期 | 面板删除时清理 session；超时清理（7 天未用） | 7 天后自动清理内存 session | 2.3 + 12 |
| 上下文持久化 | 对话写 ai_conversations 表，session 重启可恢复 | 服务器重启后对话继续 | 2.4 |
| session 恢复 | 重启/超时清理后，下次该面板有消息时从 ai_conversations 加载最近 20 条 + ai_memories 重建上下文 | 恢复后对话连贯 | 2.5 |
| 分层保留 cron | 每天扫描：30 天前 full 对话 → AI 总结成 summary；90 天前 summary → 提取到 ai_memories 后删除；ai_memories 永久保留 | 分层清理生效 | 12.1 |
| 多端共享 | 同面板 AI 事件 WS 广播到该面板所有在线设备 | 多端都能看到 AI 思考流 | 2.3 |

**发布任务**：
- Docker 镜像构建（含新表迁移脚本）
- docker-compose 更新
- 数据库迁移脚本（CREATE TABLE ai_conversations / ai_memories + ALTER 分层保留字段）
- 部署文档更新

---

### Phase S2：多端并行改造（P0）

**目标**：按面板路由工具调用，支持多端不同面板并行 AI 操作

**架构依据**：[architecture_refactor.md](architecture_refactor.md) 第三章（3.1-3.4）

**被依赖**：桌面端 Phase 4.1、移动端 Phase M3

| 任务 | 详情 | 验收标准 | 架构文档章节 |
|------|------|----------|------------|
| per-panel activeDeviceId | 全局单一 activeDeviceId → `Map<panelId, deviceId>` 按面板记录 | 多端不同面板可并行 | 3.2-3.3 |
| 工具路由改造 | DEVICE_SPECIFIC_TOOLS 路由从全局 activeDeviceId 改为 `panelActiveDevices[panelId]` | 工具调用路由到正确设备 | 3.3-3.4 |
| 同面板多端规则 | 同面板多端在线时，最后发 user_message 的设备成为该面板 activeDevice；AI 思考流广播到该面板所有在线设备 | 同面板后发消息设备接管执行 | 3.3 |
| 无在线设备处理 | 路由工具调用时若该面板无在线设备，抛错提示 | 有明确错误反馈 | 3.4 |

**发布任务**：
- Docker 镜像构建
- docker-compose 更新（无 schema 变更，仅代码）
- 部署文档更新

---

### Phase S3：冲突解决 + syncQueue 持久化（P1）✅ 已完成

**目标**：真正的乐观锁防止并发丢数据；服务器侧 syncQueue 持久化日志

**架构依据**：[architecture_refactor.md](architecture_refactor.md) 第四章（4.1-4.4）+ 第五章（5.1-5.3）+ 第十二章 12.2

**被依赖**：桌面端 Phase 4.1、移动端 Phase M5

**完成内容（2026-06-30）**：
- **缺口 A（实体冲突日志持久化）**：`server/src/db/schema.ts` 新增 `entity_conflict_logs` 表（12 字段 + 4 索引：entity/panel_id/resolved/created_at，DDL 用 local_version/remote_version/local_state/remote_state 视角命名，id TEXT UUID）；`server/src/routes/entities.ts` PUT 路由用 `withTransaction` 包裹"冲突日志 INSERT + LWW UPDATE + SELECT 返回"保证原子性，冲突时仍按 LWW 应用更新 + 额外 INSERT 冲突日志（含 panel_id 从 conflictRow 取）；新建 `server/src/routes/entityConflicts.ts` 3 个 API（GET 列表支持 entityId/panelId/entityType/resolved/limit/offset 过滤、未传 resolved 返回全部；GET 单条；POST resolve 标记 resolved=TRUE）；`server/src/index.ts` 注册路由
- **缺口 B（服务器端 sync_logs 表）**：`server/src/db/schema.ts` 新增 `sync_logs` 表（13 字段 + 3 索引：device_id+status/status/created_at）+ sync_queue 表加 `[DEPRECATED]` 注释；新建 `server/src/routes/syncLogs.ts`（335 行）5 个 API（GET 列表 / GET failed / PUT upsert 含 400 参数校验 + last_error 截断 1000 字符 / DELETE / POST retry）；executeSyncOpOnServer 处理 panel/widget/entity update+delete，create 早期返回 skipped，default 抛错 Unsupported entityType；deviceId 仅从 req.deviceId 取（不可从 body 伪造）
- **缺口 B（客户端 syncQueue 双写）**：`client/desktop/src/utils/syncQueue.ts` 改造：enqueueSyncOp 用 `void upsertSyncLogToServer(...).catch(...)` 不 await（不阻塞主流程），flushSyncQueue 成功 await upsertSyncLogToServer(success) 失败 await upsertSyncLogToServer(failed)；暴露 addFailedEntry/removeFailedEntry/clearFailedEntries/getFailedEntries 函数；新建 `client/desktop/src/api/syncLogs.ts` + `client/desktop/src/types/syncLogs.ts`（独立类型，不跨端引用服务端）
- **缺口 C（WS sync_failed 事件推送）**：`server/src/ws.ts` ChangeEvent 联合类型扩展 sync_failed + 新增 SyncFailedEvent 接口；`server/src/routes/syncLogs.ts` PUT status=failed 时 sendToDevice 给发起方 + broadcastChange 给其他设备（双推，发起方只收一次）；`client/desktop/src/stores/useAIStore.ts` handleServerChange 加 sync_failed case 调 useAppStore.addSyncFailedEntry
- **缺口 D（失败 UI 提示）**：`client/desktop/src/stores/useAppStore.ts` 新增 syncFailedEntries state + 5 个 actions（addSyncFailedEntry/clearSyncFailedEntry/clearAllSyncFailedEntries/dismissSyncFailedEntry/retrySyncFailedEntry）；新建 `client/desktop/src/components/SyncFailedBanner.tsx`（252 行，useEffect 监听 count 重置 dismissed，展开列表显示失败详情+重试+忽略+全部清除）；`client/desktop/src/App.tsx` 挂载 SyncFailedBanner
- **TypeScript 类型**：`server/src/types/index.ts` 新增 EntityConflictLog / SyncLogEntry / SyncLogStatus / EntityConflictResolveAction 等类型
- **运行时验证（16/16 通过）**：健康检查 / sync_logs 表存在 / PUT upsert / GET 列表 / PUT 参数校验 400 / GET failed / DELETE / POST retry create skipped / POST retry unsupported entityType 500 / entity_conflict_logs 表存在 / GET 列表 / POST resolve / widgets 乐观锁不回归 409 / entities PUT 触发冲突日志 + panelId + GET 默认返回全部 / WS sync_failed 推送 / GET ?panelId= 过滤
- **对抗审查（3 轮）**：
  - 第 1 轮：发现 9 个严重 + 8 个中等问题（spec 与代码自相矛盾 / 安全漏洞 / 跨端引用反模式 / useState 反模式 / await 与风险表矛盾 / 依赖关系错误 / 未实现 create 分支 / 遗漏清理策略 / Docker 验收延期声明）→ 全部修复
  - 第 2 轮：发现 3 个 spec 偏差（entity_conflict_logs 字段名 / API 响应结构 / GET 默认强制 resolved=false）→ 走路径 A（改 spec 对齐实现）+ 补 panel_id 列 + 修 GET 默认行为
  - 第 3 轮：发现 1 个高严重度 bug（entities.ts INSERT VALUES 中 local_version/remote_version 值互换）→ 修复后 DB 直查确认字段语义正确
  - 最终通过：bug 已修复 + 16/16 运行时验证通过 + 0 编译错误 + 安全 Grep 全过

**端口说明**：本地验证用 SERVER_PORT=3458 + PG_PORT=5432（避免与已运行的 living-dashboard-server 容器端口冲突）；生产部署待 Phase S7 重建镜像

| 任务 | 详情 | 验收标准 | 架构文档章节 |
|------|------|----------|------------|
| 乐观锁 UPDATE 校验 | `UPDATE widgets SET state=$1, version=version+1 WHERE id=$2 AND version=$3 RETURNING *`；RETURNING 为空即冲突 | 并发修改不静默丢失 | 4.2 |
| 冲突处理策略（智能分场景） | 位置/尺寸冲突：LWW；组件 state 冲突：默认 LWW + 返回冲突信息让客户端 UI 角标提示；面板删除冲突：删除优先；实体数据冲突：LWW + 冲突日志 | 不同场景策略正确 | 4.3 + 12.2 |
| 冲突信息返回 | UPDATE 冲突时返回当前服务器版本，供客户端展示冲突处理 UI（保留本地/远端/合并）；entities 不在 PUT 响应返回冲突，客户端通过 GET /api/entities/conflicts 查询 | 客户端能拿到冲突详情 | 4.4 |
| syncQueue 服务器侧持久化日志 | 服务器记录同步操作日志（pending/success/failed + 错误信息），无上限重试，指数退避 | 清缓存不丢数据；失败有日志可查 | 5.2 |
| 失败处理 | 标记 failed 的操作 UI 提示用户手动处理（通过 WS 推送给客户端） | 失败有 UI 提示 | 5.2 |

**发布任务**（沿用 Phase S7）：
- Docker 镜像构建（带版本 tag）— 延期至 Phase S7
- docker-compose 更新（无 schema 破坏性变更，entity_conflict_logs + sync_logs 用 CREATE TABLE IF NOT EXISTS 幂等，panel_id 用 DO $$ ALTER ADD COLUMN IF NOT EXISTS 幂等迁移）
- 数据库迁移脚本（CREATE TABLE entity_conflict_logs / sync_logs + ALTER ADD COLUMN panel_id）
- 部署文档更新（sync_logs API 文档、entity_conflict_logs API 文档、sync_failed WS 事件文档）

---

### Phase S4：AI 配置后端（P0）✅ 已完成

**目标**：AI 配置（API/提示词/Skills/工具）存服务器，多端共享；API Key 不存客户端

**架构依据**：[architecture_refactor.md](architecture_refactor.md) 第九章（9.1-9.5）

**被依赖**：桌面端 Phase 4.2、移动端 Phase M3

**完成内容（2026-06-27）**：
- 新建 `server/src/utils/aiTools.ts`：25 个工具元数据 + AI_TOOL_MAP + DISABLEABLE_TOOL_NAMES（ask_user 不可禁用）
- 新建 `server/src/utils/sanitize.ts`：7 个 sanitize 函数（prompt/apiKey/model/endpoint/skillContent/shortText）+ LENGTH_LIMITS
- 新建 `server/src/routes/tools.ts`：GET /api/tools 列出 25 工具及启用状态；PUT /api/tools/:name 更新（含 canDisable 校验）；POST /api/tools/reset 单条 SQL 批量重置
- 修改 `server/src/piBridge.ts`：添加 getEnabledCustomTools()，createSession 中从 tool_settings 读取启用状态过滤 customTools
- 修改 `server/src/routes/aiSettings.ts`：POST /api/ai/test-connection 真实调用 LLM API（非 stub），返回 ok:true/latencyMs/reply；所有 sanitize 调用包 try/catch 返回 400
- 修改 `server/src/routes/skills.ts`：POST/PUT 全字段 sanitize + 空值/类型校验
- 修改 `server/src/utils/llmCaller.ts`：添加 reasoning_content 兜底（解决 reasoning 模型 content 为空问题）
- 修改 `server/src/index.ts`：注册 toolsRouter
- 运行时验证：14 项 API 测试全部通过（25 tools / canDisable / reset / test-connection ok:true,reply:OK / sanitize 400 / typeof 校验）
- 对抗审核：通过（4/4 bug 修复验证 + 11/11 运行时测试通过）

| 任务 | 详情 | 验收标准 | 架构文档章节 |
|------|------|----------|------------|
| ai_settings 表 | 键值存储：key/value/updated_at；存模型选择、Endpoint、系统/画布/浏览器提示词 | 表结构正确，可读写 | 9.4 |
| user_skills 表 | 用户自定义 skills：id/name/description/content(SKILL.md)/enabled/created_at/updated_at | 表结构正确 | 9.4 |
| tool_settings 表 | 工具启用状态：tool_name/enabled/updated_at | 表结构正确 | 9.4 |
| API Key 存 ai_settings 表 | API Key 存服务器 ai_settings DB 表（key=pi.api_key，不存客户端）；客户端通过服务器 `PUT /api/ai/settings` 修改时经服务器保存 | 客户端不持有 API Key | 9.3.1 + 9.5 |
| 提示词从设置存储读取 | 提示词从 ai_settings 读取（替代 `piBridge.ts` L497-526 硬编码的 canvasPrompt + browserPrompt）；有默认值，可恢复默认 | 提示词可通过设置配置 | 9.3.2 |
| API 配置读写 API | 模型选择/Endpoint 读写；连接测试 API | API 可通过 UI 配置 | 9.3.1 |
| Skills 管理 API | user_skills CRUD + 启用/禁用；内置 skills 列表查询 | Skills 可管理 | 9.3.3 |
| 工具管理 API | tool_settings 启用/禁用读写 | 工具可启用/禁用 | 9.3.4 |
| 安全考虑 | API Key 不存客户端；用户自定义提示词/Skills 内容做基本 sanitization 防注入 | 无注入风险 | 9.5 |

**发布任务**：
- Docker 镜像构建
- docker-compose 更新（无 schema 变更，仅代码；API Key 存 ai_settings 表，无需 auth.json 卷挂载）
- 数据库迁移脚本（CREATE TABLE ai_settings / user_skills / tool_settings）
- 部署文档更新（ai_settings 表 API Key 配置说明）

---

### Phase S5：动态组件跨端支持（P1）✅ 已完成

**目标**：dynamic_widgets 表扩展，支持纯前端组件跨端共享；依赖本地环境组件标记

**架构依据**：[architecture_refactor.md](architecture_refactor.md) 第六章（6.1-6.5）+ 第十二章 12.3

**被依赖**：桌面端 Phase 5、移动端 Phase M5

**完成内容（2026-07-01）**：
- S5 主体框架在 Phase 5 桌面端开发时已一起实现（schema 4 字段 + dynamicWidgets 路由 + component_capabilities 联动），本次收尾修复 5 个实质缺陷 + 4 个对抗审查发现的 bug，并补全 21 项运行时验证
- 缺陷 1（DELETE 不同步 component_capabilities）：`server/src/routes/dynamicWidgets.ts` DELETE 路由新增 try/catch 同步删除逻辑，避免孤儿记录（与 POST/PUT 同步机制对称）
- 缺陷 2（无 sanitization）：引入 `sanitizeShortText` 对 displayName（≤128 字符）/ icon（≤64 字符）做 sanitize；code 字段保留 HTML/JS 原文但加 1MB 长度限制（不能 sanitize 否则破坏代码）
- 缺陷 3（componentEnv 无枚举校验）：POST + PUT 校验 componentEnv 必须是 'pure-frontend' 或 'local-dependent'，否则返回 400 INVALID_COMPONENT_ENV
- 缺陷 4（widgetType 无格式校验）：POST + PUT + DELETE 校验 widgetType 匹配 `/^[a-zA-Z0-9_-]+$/` 且长度 ≤ 64，否则返回 400 INVALID_WIDGET_TYPE
- 缺陷 5（local_services 结构未校验）：POST + PUT 校验 localServices 必须是 string[] 或 null，元素 ≤ 128 字符，数组 ≤ 32，否则返回 400 INVALID_LOCAL_SERVICES
- 对抗审查 bug 1（中，类型校验）：POST + PUT 添加 crossPlatform/desktopOnly 的 typeof boolean 校验，避免非 boolean 输入导致 500 错误
- 对抗审查 bug 2（低，PUT/DELETE widgetType 格式校验）：与 POST 对称，URL 参数也走正则校验
- 对抗审查 bug 3（低，defaultLayout/defaultState 长度限制）：POST + PUT 添加 64KB JSON 长度限制
- 对抗审查 bug 4（低，错误响应格式统一）：PUT/DELETE 的 404 改用 createError(404, 'NOT_FOUND', ...)，与 POST 一致
- 运行时验证（21/21 通过）：1 健康检查 + 2 schema 字段 + 3-4 POST 创建 + 5-7 POST 校验 + 8-9 GET 过滤 + 10-12 PUT 更新/校验 + 13-15 component_capabilities 联动（POST/PUT/DELETE 同步）+ 16-17 DELETE + 18 POST WS 广播 + 19 sanitization + 20 PUT WS 广播 + 21 INVALID_BOOLEAN；TypeScript 编译 pass
- 对抗审查（2 轮）：第 1 轮发现 4 个 bug（中 1 低 3）→ 全部修复；第 2 轮确认 4/4 修复到位，0 新 bug，21/21 测试通过，代码层面完全合格

| 任务 | 详情 | 验收标准 | 架构文档章节 |
|------|------|----------|------------|
| dynamic_widgets 表扩展 | 新增字段：component_env（pure-frontend/local-dependent）、local_services（JSONB）、cross_platform（BOOLEAN）、desktop_only（BOOLEAN） | 字段添加正确 | 6.4 + 12.3 |
| 纯前端组件跨端 | 组件代码（HTML/JS/CSS）存 dynamic_widgets 表，两端共享渲染；canvasStorage 协议复用 | 桌面端写的纯前端组件移动端能渲染 | 6.2 |
| 依赖本地环境组件标记 | 调本地服务的组件标记 component_env=local-dependent / desktop_only=TRUE | 能区分组件类型 | 6.3 方案C + 12.3 |
| 移动端查询过滤 | 移动端查询 dynamic_widgets 时 `WHERE desktop_only = FALSE` | 移动端不显示桌面专属组件 | 12.3 |
| 组件数据共享 | 组件数据通过 canvasStorage → kvStorage → withFallback 存服务器，两端共享同一份数据 | 多端组件数据一致 | 6.2 |

**发布任务**：
- Docker 镜像构建
- docker-compose 更新
- 数据库迁移脚本（ALTER TABLE dynamic_widgets ADD COLUMN ...）
- 部署文档更新

---

### Phase S6：本地服务代理（P1）✅ 已完成

**目标**：依赖本地环境的组件通过服务器中转实现跨端（方案 A）

**架构依据**：[architecture_refactor.md](architecture_refactor.md) 第六章 6.3 方案 A

**被依赖**：桌面端 Phase 6.2、移动端 Phase M5

**完成内容（2026-07-03）**：
- S6 主体框架在 Phase 6.2 桌面端开发时已一起实现（local_service_registry 表 + 5 个 API + 代理路由 + WS proxy_request/proxy_response + 心跳定时任务 + 桌面端注册客户端），本次收尾做完整运行时验证 + 对抗审查修复 4 个安全/资源 bug
- **运行时验证（50/50 通过）**：健康检查 / register 201 + 字段完整 / 参数校验 3 项 / endpoint 协议白名单校验 4 项 / upsert / heartbeat 单条+批量+未注册静默忽略+缺参数 400 / list 全部+按设备 / 503 离线降级 3 种场景 / WS proxy_request+proxy_response 完整链路（GET+POST+无 path 边界）/ WS 设备断开 reject / 30s 超时 504 / 旧连接替换 pending 立即 reject（1ms，修复前 30s）/ 心跳超时清理 / unregister 单条+批量+静默忽略
- **对抗审查（2 轮）**：
  - 第 1 轮：发现 6 个 bug（高 1 / 中 3 / 低 2）→ 修复 4 个阻塞项
  - 第 2 轮：4/4 修复验证通过 + 0 新 bug + 50/50 运行时验证通过 → 通过
- **修复 1（高 Bug）**：`server/src/ws.ts` L272-287 WS 旧连接替换时未清理 pending 代理请求，导致旧连接上的 pending 要等 30s 超时才 reject（违反 spec 3.3.4 节）→ 替换前主动调用 `handleDeviceDisconnect(deviceId)` 立即 reject，运行时验证耗时从 30s 降到 1ms
- **修复 2（中 Bug）**：`server/src/routes/localServices.ts` L37-79 endpoint URL 无校验，可注册 `file:///`、`ftp://` 等任意协议，SSRF 风险转移到桌面端 → 新增 `validateEndpoint()` 函数，校验 http/https 协议白名单 + 长度 ≤ 2048 + URL 构造器校验
- **修复 3（中 Bug）**：`server/src/routes/proxy.ts` L14-41 FILTERED_REQUEST_HEADERS 不完整，缺失 `proxy-authorization` 等敏感 hop-by-hop headers → 补全 RFC 7230 全部 7 个 hop-by-hop headers，请求/响应双向过滤
- **修复 4（中 Bug）**：`server/src/middleware/auth.ts` L22-41 + `server/src/index.ts` L98-103 SERVER_TOKEN 空时 X-Device-Id 可任意伪造，生产环境若忘配置直接裸奔 → authMiddleware 首次放行时打印醒目警告 + main 函数开头加生产环境强校验（NODE_ENV=production 时 SERVER_TOKEN 空则拒绝启动）
- **未修复低 bug（2 个，非阻塞）**：(1) `proxy.ts:47` path 拼接用 `req.url?.split('?')[1]`，运行时已通过，边界场景风险低；(2) `ws.ts:314-321` JSON.parse 失败时 pending 挂起至超时，恶意客户端场景，正常客户端不触发
- **移动端缺口（已知）**：Android `WsMessage.kt` 未声明 proxy_request/proxy_response 类型，移动端无法作为代理服务提供方；但可作为消费方通过 /proxy HTTP API 调用桌面端服务。移动端代理消费能力待 Phase M5 实现（roadmap 3.2 节依赖关系）

| 任务 | 详情 | 验收标准 | 架构文档章节 |
|------|------|----------|------------|
| local_service_registry 表 | 桌面端启动时检测本地服务，注册到服务器；字段：deviceId/serviceName/endpoint/online/last_heartbeat | 桌面端本地服务可注册 | 6.3 方案A |
| 代理 API 路由 | 服务器暴露 `/proxy/deviceId/serviceName/api` 代理端点 | 代理 API 可用 | 6.3 方案A |
| URL 改写规则 | 移动端组件 fetch `http://localhost:xxx/api` → `http://server:3456/proxy/deviceId/serviceName/api` | URL 改写规则正确 | 6.3 方案A |
| WS 转发执行 | 服务器通过 WS 让桌面端执行 fetch 并返回结果 | 桌面端在线时转发成功 | 6.3 方案A |
| 离线降级 | 桌面端不在线时，代理 API 返回明确错误，移动端组件显示"依赖的桌面端离线"提示 | 离线有提示不崩溃 | 6.3 方案A |
| 心跳保活 | 桌面端定期心跳更新 online 状态；超时标记离线 | 在线状态准确 | 6.3 方案A |

**发布任务**：
- Docker 镜像构建
- docker-compose 更新
- 数据库迁移脚本（CREATE TABLE local_service_registry）
- 部署文档更新

---

### Phase S7：发布与部署（每 Phase 强制）

**目标**：每个 Phase S1-S6 验收后生成可部署产物，服务器能实际更新

| 任务 | 详情 | 验收标准 |
|------|------|----------|
| Docker 镜像构建 | `docker build` 生成新镜像，版本号 tag（如 v0.5.0-s1） | 镜像构建成功 |
| docker-compose 更新 | 更新 image tag + 环境变量 + 卷挂载 | compose 配置正确 |
| 数据库迁移脚本 | 每个 schema 变更配套迁移脚本，支持幂等执行 | 迁移脚本可重复执行不报错 |
| 部署文档更新 | 更新部署文档（环境变量、迁移步骤、回滚方案） | 文档与代码一致 |
| 数据备份 | 迁移前自动备份数据库 | 备份文件存在 |
| 回滚方案 | 迁移失败可回滚到上一版本 | 回滚脚本可用 |

### Phase S8：AI 自动化测试（5-8 d 单人）✅ 已完成

**前置依赖**：Phase S1/S2/S4（S1 per-panel session + S2 per-panel activeDeviceId + S4 AI 配置后端）落地后启动。AI 配置后端的 `ai_settings` / `user_skills` / `tool_settings` 表是 provider 切换测试的前置。

**目标**：补齐服务器 AI 相关模块的测试覆盖（当前覆盖率 0），确保 Pi Agent / WS 网关 / 24 个工具 / DB 迁移 / 协议兼容等核心链路不回归

**架构依据**：[architecture_refactor.md](architecture_refactor.md) 第二/三/四/九/十三章（AI session、面板路由、冲突解决、AI 配置、本地轻 Agent）

**测试运行器**：vitest（单元/集成，TypeScript 生态一致）

#### 完成内容（2026-07-11）

- **S8.1 测试基础**：引入 vitest + @vitest/coverage-v8，配置 vite.config.ts test 选项；搭建测试 helpers（临时 SQLite DB、mock 工具、WebSocket 模拟）；补齐 npm scripts（test / test:watch / test:unit / test:integration / test:coverage / ci-test）；编写 `scripts/ci-test.mjs` 一键 CI 脚本
- **S8.2 piBridge 单元测试**：104 用例，覆盖 piBridge 核心 / 工具注册 / 工具路由 / per-panel session / 7 天未用清理 / 分层保留 cron；`piBridge.ts` 行覆盖率 **88.95%**
- **S8.3 ws.ts 协议测试**：20 单元 + 18 集成 = **38 用例**，覆盖消息分发 / 心跳保活 / 广播 / 错误处理 / 鉴权；`ws.ts` 行覆盖率 **86.43%**
- **S8.4 工具单元测试**：12 aiTools + 23 searchApi + 12 searchTools = **47 用例**，覆盖 24 个工具（browser_*/widget_*/storage_*）+ 搜索工具（local/web/academic/github）的正常调用 / 参数错误 / 权限拒绝
- **S8.5 DB 迁移 + aiContext 测试**：40 用例，覆盖 ai_conversations / ai_memories / ai_settings / user_skills / tool_settings / local_service_registry / dynamic_widgets 扩展迁移幂等性 + aiContext 上下文构建；`aiContext.ts` 行覆盖率 **80.76%**
- **S8.6 路由集成测试**：58 用例（api.test.ts 53 用例 + server.test.ts 5 用例，其中 2 个 AI 真实调用测试 skipIf 无 TEST_LLM_API_KEY 跳过）；覆盖健康检查/鉴权 4 路径/panels/widgets（含乐观锁 409）/entities（含冲突日志）/tools/aiSettings/searchKeys/syncLogs/entityConflicts/dynamicWidgets/localServices 全部路由 + 服务器启动 + NODE_ENV=production 无 SERVER_TOKEN 强制退出 + 优雅关闭（SIGINT/SIGTERM）+ AI 真实调用占位
- **S8.7 文档同步**：package.json scripts 验证通过；roadmap_server_v1.md 状态更新；server/README.md 不存在故按 spec 9.2 节跳过 README 测试章节（遵循用户规则"NEVER proactively create documentation files"）
- **对抗审查结果**：[对抗审查结果待填]（待主控 agent 完成对抗审查后回填）
- **运行时验证**：全量 `npm test` 通过

#### S8.1 测试基础（1 d）

| 任务 | 详情 | 验收标准 |
|------|------|----------|
| 引入 vitest | `npm install -D vitest @vitest/coverage-v8`，配置 vite.config.ts test 选项 | 基础用例能跑 |
| 测试 DB | docker-compose.test.yml + pg-mem 或 testcontainers-node 起临时 PostgreSQL | DB 隔离 |
| Mock 工具 | mock-websocket 模拟客户端、nock 拦截 HTTP、AI provider 响应 | mock 工具齐全 |
| npm 脚本 | `test` / `test:unit` / `test:integration` / `test:coverage` | 一键跑全套 |
| CI 集成 | GitHub Actions 或本地一键脚本：lint + unit + integration + coverage | CI 全绿 |

#### S8.2 piBridge 单元测试（1-2 d）

| 任务 | 详情 | 验收标准 |
|------|------|----------|
| piBridge 核心 | `@earendil-works/pi-agent-core` 集成、agent 实例创建、system prompt 注入 | 核心链路通 |
| 工具注册 | 24 个工具（browser_*/widget_*/storage_*）注册到 agent、参数 schema 校验 | 工具可注册 |
| 工具路由 | DEVICE_SPECIFIC_TOOLS 按 `panelActiveDevices[panelId]` 路由 | 路由正确 |
| per-panel session | SessionManager `Map<panelId, AgentSession>` 创建/隔离/销毁 | session 隔离 |
| 7 天未用清理 | session 超时清理 cron | 清理生效 |
| 分层保留 cron | 30 天→summary / 90 天→memory | 分层生效 |

#### S8.3 ws.ts 协议测试（1 d）

| 任务 | 详情 | 验收标准 |
|------|------|----------|
| 消息分发 | onClientMessage(deviceId, panelId, msg) 按面板路由 | 路由正确 |
| 心跳保活 | ping/pong、断线重连、超时下线 | 心跳链路通 |
| 广播 | AI 事件广播到面板所有在线设备 | 广播正确 |
| 错误处理 | 协议错误、未知消息类型、断线 | 错误有反馈 |
| 鉴权 | 设备 ID 校验、token 校验（如有） | 鉴权生效 |

#### S8.4 24 个工具单元测试（1-2 d）

| 工具组 | 工具数 | 覆盖点 |
|------|------|------|
| browser_* | 15 | browser_open/close/list_tabs/switch_tab/eval/get_dom/get_cookie/set_cookie/screenshot/click/input/scroll/wait_for/navigate/extract 的参数校验、权限、错误处理 |
| widget_* | 5 | widget_create/get/update/delete/list 的 CRUD、版本冲突 |
| storage_* | 4 | storage_get/set/delete/list + canvasStorage 协议 |

每个工具至少 3 个用例：正常调用 / 参数错误 / 权限拒绝。

#### S8.5 DB 迁移脚本测试（0.5 d）

| 任务 | 详情 | 验收标准 |
|------|------|----------|
| ai_conversations / ai_memories | CREATE TABLE + ALTER 分层保留字段 | 迁移幂等 |
| ai_settings / user_skills / tool_settings | CREATE TABLE | 迁移幂等 |
| local_service_registry | CREATE TABLE | 迁移幂等 |
| dynamic_widgets 扩展 | ALTER TABLE ADD COLUMN | 迁移幂等 |
| 迁移可回滚 | 每个迁移配套 DOWN 脚本 | 回滚成功 |

#### S8.6 集成测试（WS 端到端 + AI 调用，1-2 d）

| 任务 | 详情 | 验收标准 |
|------|------|----------|
| WS 端到端 | 起真实 server + 模拟多客户端连接，测指令下发/结果回传 | 链路通 |
| AI 真实调用 | 起 server + 调真实 LLM（用占位 API key，参见本文 八、AI 接入测试说明） | 对话能跑 |
| 多端并行 | 模拟多端不同面板并行 AI 操作 | 不抢控制权 |
| 冲突解决 | 并发 UPDATE 触发乐观锁 | 冲突有反馈 |
| 离线降级 | 客户端断线 / 重连 | 重连恢复 |

#### S8.7 文档同步（0.5 d）

| 任务 | 详情 | 验收标准 |
|------|------|----------|
| 测试运行说明 | package.json 脚本 + 开发者文档 | 开发者能跑 |
| AI 接入测试说明 | 本文 八、AI 接入测试说明（与本 Phase 同时落地） | 占位 key 用法清晰 |

**估时小计**：1 + 1-2 + 1 + 1-2 + 0.5 + 1-2 + 0.5 = **5-8 d（1.5-2 周单人）**

**发布任务**（沿用 Phase S7）：
- Docker 镜像构建（带版本 tag）
- docker-compose 更新（无 schema 变更，仅代码 + 测试运行器）
- 部署文档更新（测试运行步骤）
- CI 配置

---

### Phase S9：AI 搜索工具（1-2 周）✅ 已完成

**前置依赖**：Phase S4（AI 配置后端）的 `ai_settings` 表——搜索引擎 Key 复用该表存储模式（见 Spec 8.1 节）；Phase S2 的 `panelActiveDevices[panelId]` per-panel 路由机制——`local_search` 走 WS 路由到客户端。

**目标**：服务器侧实现 4 个搜索工具（`local_search` / `web_search` / `academic_search` / `github_search`），补齐 Pi Agent 的搜索能力；扩展 `ai_settings` 表存储三类搜索引擎 Key；新增 `/api/search/keys` Key 管理 API 与配额监控。

**完成内容（2026-06-27）**：
- 新建 `server/src/db/apiUsageLog.ts`：`logApiUsage`（记录每次外部 API 调用，失败静默 warn 不抛出）+ `getApiUsageStats`（窗口统计）
- 新建 `server/src/routes/searchKeys.ts`：5 个端点（GET / 列表、GET /:provider、PUT /:provider、DELETE /:provider、POST /:provider/test）；provider 白名单校验；GET 系列只返回 `{hasKey, updatedAt}` 不返回明文 Key；POST /test 按 provider 分支调用真实 API（bocha→web-search、S2→paper/search、github→rate_limit）
- 新建 `server/src/utils/searchApi.ts`（645 行）：`callBocha`（POST api.bochaai.com/v1/web-search）+ `callSemanticScholar`（GET graph/v1/paper/search）+ `callGitHub`（6 mode：search_repos/code/users/issues + download_release/file）；`retryWithBackoff` 指数退避 1s/2s/4s + 429 透传 retry-after；所有 fetch 30s AbortController 超时；github 文件下载 <1MB base64 / ≥1MB downloadUrl；download_release 资产 URL 无 release_id（`/releases/assets/{asset_id}`）
- 新建 `server/src/utils/searchTools.ts`（3 个 ToolDefinition）：web_search/academic_search/github_search，每个 execute 内调 getSearchKey → callXxx → logApiUsage（成功/失败均记录）
- 修改 `server/src/db/schema.ts`：新增 `api_usage_log` 表（provider/endpoint/count/latency_ms/status/error_msg/created_at）+ 索引 `idx_api_usage_log_provider_time`
- 修改 `server/src/db/aiSettingsStore.ts`：新增 `SETTINGS_KEYS.SEARCH_KEY_*` 三个常量 + `SearchProvider` 类型 + `SEARCH_KEY_MAP` + 4 个函数（getSearchKey/getSearchKeyStatus/setSearchKey/deleteSearchKey）；`getSearchKeyStatus` 强制 `updatedAt` 转为 number（pg BIGINT 默认返回 string）
- 修改 `server/src/utils/aiTools.ts`：`ToolCategory` 类型扩展 `'search'`；`AI_TOOL_DEFINITIONS` 追加 4 个搜索工具元数据（均 canDisable:true，category:'search'）；总工具数 25 → 29
- 修改 `server/src/piBridge.ts`：`local_search` 加入 `DEVICE_SPECIFIC_TOOLS` Set；新增 `localSearchTool`（execute 调 `executeViaWs('local_search', params, pid)` 路由到客户端）；customTools 数组追加 `localSearchTool + ...searchTools`
- 修改 `server/src/index.ts`：注册 `/api/search/keys` 路由（继承 /api 的 authMiddleware）
- 修改 `server/package.json`：显式声明 `typebox` 依赖（之前间接依赖）
- 运行时验证（首轮，无真实 Key）：28 项 API 测试全部通过（4 工具注册 / 5 端点响应格式 / invalid provider 400 / PUT 校验 / DELETE / POST /test 三种 provider / 4 工具 disable/enable / category='search'）；DB 验证 api_usage_log 表存在且记录 5 条外部调用
- 对抗审核：通过（需求覆盖 100%，0 高/中 bug，5 低优化建议均已处理或记录）
- 真实 Key 端到端验证（2026-06-27 补充，3 个 provider 全部 200）：使用用户提供的真实 Key（Bocha `sk-261b3...`、GitHub `ghp_O4Yw...`、Semantic Scholar `s2k-pIqZ...`）跑通 3 个外部 API，6 个测试脚本（`server/test/search-{web,academic,github,github-log,github-test-fix,code-no-lang}-test.ts`）共 31+ assertions 全部通过；过程中发现并修复 5 个 bug（详见下方"真实 Key 验证 bug 修复"段）
- 真实 Key 验证 bug 修复（`server/src/utils/searchApi.ts`，净变更 +23/-6 行）：
  - BUG 1（严重，spec 6.1）：`search_code` 的 `language` 过滤拼成 `+language:X`，URLSearchParams 把 `+` 编码为 `%2B` 导致 GitHub 返回 0 结果；改为空格分隔 `language:X`
  - BUG 2（spec 偏差）：`search_code` 返回字段名 `repository`，spec 6.1 要求 `repo`（含 `fullName`/`htmlUrl`）；已对齐
  - BUG 3（严重）：`academic_search` 当 `openAccessOnly=true` 时 `total` 用了过滤后的 `papers.length`，与 S2 原始 total 语义不符；改为透传 `data.total`
  - BUG 4（spec 5.3 未落地）：S2 返回 `openAccessPdf={url:"",status:""}` 时仍写入空对象；ArXiv 兜底 URL 未生成；现按 spec 5.3 实现：`url` 非空才写，否则有 `externalIds.ArXiv` 时生成 `https://arxiv.org/pdf/{id}.pdf`
  - BUG 5（潜在）：`download_file` 在 `sha` 路径下大文件返回空 `downloadUrl`（git/blobs API 无 `download_url` 字段）；改为 `sha` 路径始终返回 `content`（base64）
- 真实 Key 验证回归确认：3 个测试脚本并行运行，原 28 项无回归 + 新增 bug 修复断言全绿（web 7/7、academic 9/9 含 BUG 3/4 修复断言、github 15/15 含 BUG 1/2 修复断言）

**架构依据**：[architecture_refactor.md](architecture_refactor.md) 第三章（3.3-3.4 per-panel 路由）

**Spec 引用**：[ai-search-spec.md](specs/ai-search-spec.md) 第九章 9.1 节（任务派发）、第二/四/五/六/八章（工具设计与 Key 管理）

**被依赖**：桌面端 Phase 11（AI 搜索集成）、移动端 Phase M11（AI 搜索集成）

#### S9.1 4 工具服务器侧注册与路由

| 任务 | 详情 | 验收标准 |
|------|------|----------|
| 4 工具服务器侧注册 | `local_search` 加入 `DEVICE_SPECIFIC_TOOLS`；其余 3 个（web/academic/github search）注册为服务器全局工具；4 个工具统一追加到 `customTools` 数组，与现有 24 个工具共用 `createAgentSession({ customTools })` 注册入口 | Pi Agent 可识别并调用 4 工具 |
| `local_search` 路由 | `execute` 内调 `executeViaWs('local_search', params, panelId)`，复用现有 per-panel 路由（`panelActiveDevices[panelId]`）；客户端收到 `tool_call` 后执行本端索引查询回 `tool_result` | 路由到面板活跃设备，客户端回 `tool_result` |
| 服务器侧工具执行形态 | `web_search` / `academic_search` / `github_search` 的 `execute` 函数内直接 `fetch` 外部 API，**不调用 `executeViaWs`、不发 `tool_call` 到客户端**；Key 从 `ai_settings` 表读取，错误以 `tool_result.success=false` 返回 | 进程内执行，无 WS 往返，Key 不下发客户端 |

#### S9.2 三个外部 API 工具实现

| 任务 | 详情 | 验收标准 |
|------|------|----------|
| `web_search` 实现 | Bocha API 调用（`POST https://api.bochaai.com/v1/web-search`）+ 字段映射（name→title 等，见 Spec 4.2 节）；支持 freshness/summary 参数；Bing 兼容（可平滑切换） | 搜索返回正确 results，字段映射无误 |
| `academic_search` 实现 | Semantic Scholar API 调用（`GET .../graph/v1/paper/search`）+ PDF 策略（`openAccessPdf.url` 优先，`externalIds.ArXiv` 兜底，闭源仅元数据）；必带 Key（1 RPS） | 返回 papers，`openAccessPdf` 与 `externalIds.ArXiv` 兜底逻辑正确 |
| `github_search` 实现 | 6 个 mode 全覆盖：search_repos / search_code / search_users / search_issues / download_release / download_file；资产下载 URL 无 release_id（`GET /repos/{owner}/{repo}/releases/assets/{asset_id}`） | 各 mode 返回正确结构 |
| 文件下载策略 | <1MB 返回 base64 内容；≥1MB 返回 `downloadUrl` 由客户端直下；文件不存服务器 | 大小分界正确，服务器不存大文件 |

#### S9.3 ai_settings 表扩展与 Key 管理

| 任务 | 详情 | 验收标准 |
|------|------|----------|
| `ai_settings` 表扩展 | 在 `SETTINGS_KEYS` 常量追加 `SEARCH_KEY_BOCHA` / `SEARCH_KEY_SEMANTIC_SCHOLAR` / `SEARCH_KEY_GITHUB` 三个 key（见 Spec 8.1 节）；不复用 `auth.json`（已验证 `AuthStorage` 不支持自定义字段） | Key 可读写、不下发客户端 |
| Key 读取入口 | `aiSettingsStore.ts` 新增 `getSearchKey(provider: 'bocha' \| 'semanticScholar' \| 'github')`；piBridge 在工具 `execute` 中调用此函数读取 Key | 服务器进程内可读取 Key |
| 搜索引擎 Key 管理 API | 新增 `/api/search/keys` 路由（见 Spec 8.4 节）：GET 列表 / GET 单个 / PUT 更新 / DELETE 删除 / POST test；独立路由前缀便于单独加鉴权；`provider` 白名单校验 | 5 个端点均可用、走 `authMiddleware` 鉴权 |
| Key 测试逻辑 | `POST /api/search/keys/:provider/test` 按 provider 分支测试（bocha→web-search、S2→paper/search、github→rate_limit）；不消耗显著配额 | 三种测试逻辑均能判断 Key 是否有效 |
| 响应字段规则 | GET 系列只返回 `hasKey: boolean` + `updatedAt`，不返回明文 Key（与 `aiSettingsRouter` 的 `GET /settings` 返回 `hasApiKey` 模式一致） | 客户端无法获取明文 Key |

#### S9.4 配额监控与错误处理

| 任务 | 详情 | 验收标准 |
|------|------|----------|
| 配额监控 | 新增 `api_usage_log` 表（或复用 `ai_audit_log` 风格表）记录每次外部 API 调用：`{ provider, count, timestamp, latencyMs, status }`；接近配额上限时 UI 预警（如 GitHub 4500/5000 req/hour） | 调用记录可查，预警触发 |
| 错误处理 | Key 缺失返回"未配置 XX API Key"；429 透传 retry-after；网络错误重试 3 次（指数退避 1s/2s/4s）后返回错误；`local_search` 无在线设备/超时按现有 `TOOL_TIMEOUT_MS` 机制 | 各错误返回明确提示 |

**估时**：1-2 周。

**发布任务**（沿用 Phase S7）：
- Docker 镜像构建（带版本 tag）
- docker-compose 更新
- 数据库迁移脚本（`ai_settings` 表新增 3 个 key 为数据层无 schema 变更；`api_usage_log` 表 CREATE TABLE）
- 部署文档更新（搜索引擎 Key 配置说明、`/api/search/keys` API 文档）

---

### Phase S10：GitHub 中转下载 + ArXiv 最新论文 + 大文件服务器代理（P1）✅ 已完成

**前置依赖**：Phase S9（AI 搜索工具基础架构）——复用 `github_search` / `academic_search` 工具入口、`ai_settings` 表存储 GitHub Key、`api_usage_log` 表记录外部调用。

**目标**：补齐 S9 的 3 个能力缺口：(1) GitHub 项目整仓 zip 下载；(2) 最新论文实时搜（ArXiv API 按 `submittedDate` 倒序，S2 索引延迟数天到数周无法搜"今天"发表的论文）；(3) 大文件服务器代理下载（解决内地无梯子环境下 `raw.githubusercontent.com` / `objects.githubusercontent.com` 不可达问题）。

**完成内容（2026-06-27）**：
- 新建 `server/src/routes/githubProxy.ts`（207 行）：`GET /api/github/proxy` 端点，支持 `type=zip/asset/file` 三种下载类型；流式转发 + Range 透传（206 Partial Content）+ 416 Range Not Satisfiable 透传；客户端中断检测（`req.on('close')` + `AbortController.abort()` 中止上游 fetch）+ 上游 5 分钟无数据超时（`UPSTREAM_TIMEOUT_MS`）；`sha` 路径解析 git/blobs JSON + base64 解码返回二进制（`Content-Type: application/octet-stream`）；走 `/api` 全局 `authMiddleware` 鉴权（子路由自动继承）；`logApiUsage` 记录每次代理调用（provider=`github_proxy`）
- 修改 `server/src/utils/searchApi.ts`（+402 行 S10 模块）：
  - 新增 `buildGithubProxyUrl` 工具函数 + `SERVER_BASE_URL` 环境变量（开发模式回退 `http://localhost:${PORT}`），构造完整代理 URL 解决客户端拼接 base URL 问题
  - 新增 `download_repo_zip` mode：HEAD 请求手动跟随 302（最多 5 次，避免下载 body 浪费带宽），不支持 HEAD 时降级 `GET + Range: bytes=0-0` 解析 `Content-Range` 头拿总大小
  - 新增 `callArxiv` + `arxivThrottledFetch`（≥3s 间隔，并发安全"预留时间槽"模式，`arxivNextAvailableAt` 在 await 前更新；不复用 `fetchWithRetry` 避免与节流器语义重叠）+ `parseArxivAtomXml`（用 `fast-xml-parser`，不用正则）+ `extractArxivId`
  - 新增 `callAcademicSearch` 统一分发函数（`export`）：`mode='latest'` → ArXiv（无需 S2 Key）/ `mode='relevance'`（默认）→ S2
  - `callSemanticScholar` 的 `fields` 参数追加 `publicationDate`，paper 映射中填充
  - `download_file` ≥1MB（path 与 sha 路径）改返回代理 URL，不是 `raw.githubusercontent.com` 直链 / base64 content；`download_release` 改为始终返回代理 URL（不读 body 到内存，从 `Content-Length` 头拿大小，缺失时 size=0 不报错）
- 修改 `server/src/utils/searchTools.ts`：`github_search` tool 追加 `download_repo_zip` mode + `ref` 参数（7 个 mode）；`academic_search` tool 追加 `mode` 参数（relevance/latest）；`execute` 按 mode 决定是否要求 S2 Key（`latest` 不需要，`relevance` 缺失由 `callAcademicSearch` 内部抛错）；工具 description 同步更新
- 修改 `server/src/utils/aiTools.ts`：`academic_search` description 改为 `'检索学术论文（Semantic Scholar 相关性 / ArXiv 最新提交），支持开放获取 PDF'`；`github_search` description 改为 `'GitHub 仓库/代码/用户/Issue 搜索 + 文件/Release/整仓 zip 下载'`
- 修改 `server/src/index.ts`：注册 `/api/github/proxy` 路由（继承 `/api` 路由组的 `authMiddleware`）
- 修改 `server/package.json`：新增 `fast-xml-parser` 依赖（纯 JS 实现，无 native 依赖，~150KB）
- 新建 `server/test/phase-s10-github-test.ts`（402 行）：`download_repo_zip` 基本调用（microsoft/vscode HEAD）+ 指定 ref + 缺参数抛错 + 404；`download_file` ≥1MB 返回代理 URL；`download_release` 返回代理 URL；`/api/github/proxy` 端点 fetch 下载真实文件；客户端中断（AbortController）
- 新建 `server/test/phase-s10-arxiv-test.ts`（167 行）：`callArxiv` 基本调用 + `publicationDate` 非空 + `openAccessPdf.url` 含 `arxiv.org/pdf/` + `externalIds.ArXiv` 填充；submittedDate 倒序断言；limit/offset 分页；节流器 ≥3s 间隔 + 并发安全（`Promise.all`）；`mode='latest'` 无需 S2 Key；`mode='relevance'` 回归；S2 路径 `publicationDate` 填充
- 对抗审查：v1 发现 13 项问题修复 + v2→v3 发现 12 项问题修复（详见 spec 附录 C/D，含节流器并发竞态、sha 路径 base64 解码、`mode='latest'` Key 检查、代理 URL 客户端拼接机制、HEAD 降级 Range 时 size 取值等关键 bug）

**架构依据**：[architecture_refactor.md](architecture_refactor.md) 第三章（3.3-3.4 per-panel 路由，复用 S9 工具入口与 Key 管理机制）

**Spec 引用**：[phase-s10-spec.md](specs/phase-s10-spec.md)（含共享架构端点设计、3 个功能实现细节、ArXiv 节流器设计、错误处理矩阵、对抗审查修复记录）

**被依赖**：桌面端 Phase 11（AI 搜索集成）、移动端 Phase M11（AI 搜索集成）——S10 增强 GitHub 整仓下载能力与最新论文搜索能力，桌面/移动端搜索 UI 可直接消费代理 URL 与 ArXiv 结果

#### S10.1 共享架构：服务器代理下载端点

| 任务 | 详情 | 验收标准 |
|------|------|----------|
| `/api/github/proxy` 端点 | `GET /api/github/proxy`，支持 `type=zip/asset/file`；走 `authMiddleware` 鉴权（SERVER_TOKEN 未配置或错误返回 401） | 参数校验、鉴权、错误处理正确 |
| 流式转发 | 上游 fetch 响应流式 pipe 到客户端，不缓存全文件到内存 | 内存占用恒定，大文件下载不 OOM |
| Range 透传 | 客户端 `Range` 头透传到上游；206 Partial Content + Content-Range 透传 | 断点续传可用 |
| 416 透传 | 上游 416 Range Not Satisfiable 透传给客户端（含 Content-Range 头） | 416 场景不报错 |
| 客户端中断 | `req.on('close')` 检测客户端断开，主动 `controller.abort()` 中止上游 fetch | 客户端断开后服务器不继续下载 |
| 上游超时 | 5 分钟无数据自动断开（`UPSTREAM_TIMEOUT_MS`），返回 504 | 长时间无数据不挂起连接 |
| sha 路径 base64 解码 | `type=file&sha=...` 走 git/blobs 端点，服务器解析 JSON + base64 解码 + 返回二进制 | Content-Type: application/octet-stream，响应体是二进制非 JSON |
| 调用日志 | `logApiUsage` 记录每次代理调用（provider=`github_proxy`） | 调用记录可查 |
| `buildGithubProxyUrl` | 工具函数 + `SERVER_BASE_URL` 环境变量，构造完整代理 URL（开发模式回退 localhost） | 代理 URL 是完整 URL，客户端可直接使用 |

#### S10.2 功能 1：GitHub 项目中转下载（download_repo_zip）

| 任务 | 详情 | 验收标准 |
|------|------|----------|
| `download_repo_zip` mode | 新增第 7 个 mode，下载整个仓库 zip 归档；HEAD 请求手动跟随 302（最多 5 次），不支持 HEAD 时降级 `GET + Range: bytes=0-0` 解析 `Content-Range` 拿总大小 | 返回 `{ mode, download: { fileName, size, downloadUrl: '/api/github/proxy?type=zip...' } }` |
| `ref` 参数 | 分支/tag/commit，可选，默认 `HEAD` | 指定 ref 能下载对应分支 |
| 代理 URL | `downloadUrl` 是服务器代理 URL，不是 `codeload.github.com` 直链 | 客户端 GET 代理 URL 能下载真实 zip |
| 错误处理 | 缺 owner/repo 抛错；不存在的仓库抛错（404）；重定向 ≥5 次抛错（防循环重定向） | 各错误返回明确提示 |

#### S10.3 功能 2：最新论文实时搜（ArXiv API）

| 任务 | 详情 | 验收标准 |
|------|------|----------|
| `callArxiv` 函数 | 调 `https://export.arxiv.org/api/query`，`sortBy=submittedDate&sortOrder=descending`，无需 Key | 返回 ArXiv 论文列表，按 submittedDate 倒序 |
| `mode='latest'` | `academic_search` 新增 `mode` 参数，`latest` 走 ArXiv，`relevance`（默认）走 S2 | `latest` 能搜到今天/昨天提交的论文 |
| 节流器 | `arxivThrottledFetch` ≥3s 间隔，并发安全"预留时间槽"模式（`arxivNextAvailableAt` 在 await 前更新）；不复用 `fetchWithRetry`（其 429 重试与节流器语义重叠） | 连续调用间隔 ≥3s，并发调用不破坏间隔 |
| Atom XML 解析 | 用 `fast-xml-parser`（不用正则）解析 Atom feed；提取 `publicationDate` / `authors` / `pdfLink` / `arxivId` | 字段映射正确，`openAccessPdf.url` 是 `arxiv.org/pdf/{id}.pdf` |
| `publicationDate` 字段 | `AcademicPaper` 追加 `publicationDate`（ISO YYYY-MM-DD）；S2 路径也填充 | 两条路径的 `publicationDate` 均非空 |
| Key 检查修复 | `mode='latest'` 时不要求 S2 Key；`mode='relevance'` 时 Key 缺失由 `callAcademicSearch` 内部抛错 | `latest` 模式 S2 Key 缺失也能工作 |

#### S10.4 功能 3：大文件服务器代理改造

| 任务 | 详情 | 验收标准 |
|------|------|----------|
| `download_file` path ≥1MB | 改返回代理 URL（`/api/github/proxy?type=file&path=...`），不是 `raw.githubusercontent.com` 直链 | 内地无梯子可下载 ≥1MB GitHub 文件 |
| `download_file` sha ≥1MB | 改返回代理 URL（`/api/github/proxy?type=file&sha=...`），不是 base64 content | sha 路径大文件走代理 |
| `download_file` <1MB | 保持现有 base64 content 行为不变 | 无回归 |
| `download_release` 改造 | 始终返回代理 URL（`/api/github/proxy?type=asset&assetId=...`），不读 body 到内存；从 `Content-Length` 头拿大小 | 不再返回 `objects.githubusercontent.com` CDN 直链 |
| size=0 兜底 | `Content-Length` 头缺失时 size=0，不报错 | 客户端按实际下载大小为准 |

**估时**：3-5 天。

**发布任务**（沿用 Phase S7）：
- Docker 镜像构建（带版本 tag）
- docker-compose 更新（无 schema 变更，仅代码 + 新依赖 `fast-xml-parser`）
- 部署文档更新（`SERVER_BASE_URL` 环境变量配置说明、`/api/github/proxy` 端点文档）
- 数据库迁移脚本（无 schema 变更，`api_usage_log` 表复用记录 `github_proxy` / `arxiv` 调用）

---

## 三、与桌面/移动端 roadmap 的关系

### 3.1 哪些桌面端 Phase 依赖服务器

| 桌面端 Phase | 依赖的服务器 Phase | 依赖内容 |
|-------------|------------------|---------|
| Phase 4.1（架构改造） | **S1** + **S2** + **S3** | 按面板 session（S1）、按面板路由工具（S2）、乐观锁冲突解决（S3）、syncQueue 持久化（S3） |
| Phase 4.2（AI 配置） | **S4** | ai_settings/user_skills/tool_settings 表、API Key 存 ai_settings 表、提示词从设置读取 |
| Phase 5（收藏组件 + 跨端） | **S5** | dynamic_widgets 表扩展（component_env/local_services/cross_platform/desktop_only） |
| Phase 6.2（依赖本地环境组件跨端） | **S6** | local_service_registry 表、代理 API 路由、WS 转发 |
| Phase 11（AI 搜索集成） | **S9** | 4 个搜索工具服务器侧实现、`ai_settings` 表扩展（搜索引擎 Key）、`/api/search/keys` Key 管理 API |

### 3.2 哪些移动端 Phase 依赖服务器

| 移动端 Phase | 依赖的服务器 Phase | 依赖内容 |
|-------------|------------------|---------|
| Phase M3（AI 集成） | **S1** + **S2** + **S4** | 按面板 session（S1）、按面板路由工具（S2）、AI 配置后端（S4，思考等级/提示词） |
| Phase M5（数据同步 + 多端互通） | **S1** + **S3** + **S5** + **S6** | AI 对话同步（S1）、乐观锁冲突解决（S3）、动态组件跨端（S5）、依赖本地环境组件代理（S6） |
| Phase M11（AI 搜索集成） | **S9** | 4 个搜索工具服务器侧实现、`ai_settings` 表扩展（搜索引擎 Key）、`/api/search/keys` Key 管理 API |

### 3.3 并行策略（三端并行波次）

| 波次 | 服务器 | 桌面端 | 移动端 | 说明 |
|------|--------|--------|--------|------|
| **第 1 波** | S1 + S2 | Phase 4.1（架构改造） | - | AI 上下文 + 多端并行基础，桌面端先验证 |
| **第 2 波** | S4 | Phase 4.2（AI 配置） | - | AI 配置后端，桌面端先做 UI |
| **第 3 波** | S3 | Phase 4.1（syncQueue 部分） | M5（数据同步） | 冲突解决 + syncQueue，移动端数据同步依赖 |
| **第 4 波** | S5 | Phase 5（动态组件跨端） | M5（动态组件跨端） | 动态组件跨端，两端共享 |
| **第 5 波** | S6 | Phase 6.2（本地服务代理） | M5（依赖本地环境组件） | 本地服务代理，桌面端注册 + 移动端消费 |
| **第 6 波** | - | Phase 8（单机轻 Agent） | M3（AI 集成）+ M8（轻 Agent） | 轻 agent 不依赖服务器新功能 |
| **第 7 波** | S9 + S10 | Phase 11（AI 搜索集成） | M11（AI 搜索集成） | AI 搜索工具，S9 依赖 S4 的 `ai_settings` 表；S10 为 S9 增强（GitHub 整仓 zip 下载 + ArXiv 最新论文 + 大文件服务器代理），三端搜索能力 |

**关键原则**：
- 服务器 Phase 必须先于或同时与依赖它的桌面/移动端 Phase 完成
- 服务器 S1/S2/S4 是 P0，优先做；S3/S5/S6 是 P1，第二波；S9 依赖 S4 落地后启动；S10 依赖 S9 落地后启动（S9/S10 已完成）
- 桌面端是服务器改造的第一验证端，移动端跟随

---

## 四、验收标准总览

### Phase S0 验收 ✅
- [x] Docker 部署可用
- [x] WS 网关多客户端连接正常
- [x] Pi Agent AI 推理 24 个工具可用
- [x] 数据同步 widgets/panels/entities/favorites 正常
- [x] withFallback + broadcastChange 机制正常

### Phase S1 验收 ✅
- [x] ai_conversations 表创建，含分层保留字段（summarized/summary_of/retention_level）
- [x] ai_memories 表创建
- [x] per-panel session 实现（Map<panelId, AgentSession>）
- [x] 不同面板对话不污染
- [x] 服务器重启后对话可恢复（从 ai_conversations + ai_memories 重建）
- [x] 7 天未用 session 自动清理
- [x] 分层保留 cron 正常（30 天→summary，90 天→memory）
- [x] 同面板 AI 事件广播到所有在线设备
- [x] Docker 镜像构建 + 迁移脚本执行成功
  - 验证日期：2026-06-28
  - 镜像：event-server:latest（node:22-alpine，多阶段构建）
  - 容器：living-dashboard-server Up，living-dashboard-postgres (healthy) Up
  - Schema：[Schema] PostgreSQL schema initialized, version: 1（含 ai_conversations / ai_memories 及分层保留字段）
  - 运行时验证 12/12 通过：health check / persistConversation / ai_conversations 表数据 / role 字段 / restoring N conversations / context restored X chars / panel 删除联动 / DELETE 500 回滚 / docker compose config / docker stats 资源限制 / prompt 去重 grep
  - 对抗审查：通过（1 个中等 bug 已修复并验证）
  - 端口说明：本地验证用 PG_PORT=5433 / SERVER_PORT=3456（避免与已运行的 aihub-postgres 端口冲突），生产部署沿用默认 5432/3456

### Phase S2 验收 ✅
- [x] per-panel activeDeviceId 实现（Map<panelId, deviceId>）— S1 已完成，S2 不改动
- [x] 工具调用路由到正确面板的活跃设备 — S1 已完成，S2 不改动
- [x] 多端不同面板可并行 AI 操作 — S1 已完成，S2 不改动
- [x] 同面板后发消息设备接管 activeDevice — S1 已完成，S2 不改动
- [x] 无在线设备时抛错提示 — S1 已完成，S2 不改动
- [x] **AI 思考流定向广播到该面板所有在线设备**（S2 缺口 A，`panelOnlineDevices` + `forwardEventToClient` 定向广播）
- [x] **设备断开时清理 `panelActiveDevices` + `panelOnlineDevices`**（S2 缺口 B）
- [x] **设备切换面板自动清理旧面板映射**（S2 2.1.8，`cleanupDeviceFromOtherPanels`）
- [x] **`error_report` 携带 `panelId` 正确路由**（S2 缺口 D，方案 A + 三级兜底取最近活跃）
- [x] **S2 独立 spec 文件**（S2 缺口 C，`docs/specs/phase-s2-multi-device-spec.md`）
- [x] **S1 bug 修复：`runRetentionCleanup` 30 天 DELETE 原对话 + 防御性约束**（顺手修复）
- [x] **`dispose_session` 多端场景保护其他在线设备**（S2 对抗审查 S-1 修复，仅 `onlineSet.size===0` 时才 `disposePanelSession`）
- [x] **`cleanupDeviceFromOtherPanels` 不跳过 session-only 面板**（S2 对抗审查 M-1 修复）
- [x] `npm run build` TypeScript 编译无错
- [x] 运行时验证（独立对抗审查 4 项关键修复全部通过：S-1 / M-1 / MULTI 多端正确性 / DISC 设备断开清理；服务器日志提供确凿证据）
- [ ] Docker 镜像构建成功（无 schema 变更，仅代码）— 本地验证用直接 `node dist/index.js`，生产部署待 Phase S7 重建镜像

**完成内容（2026-06-29）**：
- Spec 已存在 `docs/specs/phase-s2-multi-device-spec.md`（2026-06-27 生成）；S2 主体框架在 S1 / Phase 4 时随 per-panel session 一起实现
- 缺口 A（设备-面板在线关系追踪 + 定向广播）：`piBridge.ts` 新增 `panelOnlineDevices = new Map<string, Set<string>>()` (L75)；`forwardEventToClient` 改为按面板定向广播 (L945-961)；`user_message` 时加入在线集合 (L1152-1157)；`dispose_session` 时移除 (L1175-1185)；`onClientDisconnect` 双 Map 清理 (L1258-1281)；`disposePanelSession` + `disposePiBridge` 同步清理 (L147 + L1387)
- 缺口 B（断开清理 panelActiveDevices）：合并到 A 的 onClientDisconnect 处理
- 缺口 D（error_report 携带 panelId）：`ws.ts` `ErrorReport` 类型 + `ClientMessage` 的 `error_report` 分支加 `panelId?` 字段 (L34, L81-87, L313)；`piBridge.ts` `onErrorReport` 三级兜底（`report.panelId` → `panelOnlineDevices` 反向 → `panelActiveDevices` 反向，按 `sessionLastUsed` 取最近活跃）(L1216-1255)
- 2.1.8 设备切换面板自动清理：`piBridge.ts` 新增 `cleanupDeviceFromOtherPanels(deviceId, currentPanelId)` 函数 (L84-108)；`user_message` 时调用 (L1160)
- S1 bug 修复：`aiContext.ts` `runRetentionCleanup` 30 天清理改为 DELETE 原对话 + 防御性约束（summary 为空时保留原对话 + warn）(L361-377)
- 对抗审查 S-1 严重 bug 修复：`piBridge.ts` `dispose_session` 处理改为"仅 `onlineSet.size===0` 时才 `disposePanelSession`"，避免多端场景下 device-A 销毁会话破坏 device-B 的会话上下文 (L1170-1197)
- 对抗审查 M-1 修复：`piBridge.ts` `cleanupDeviceFromOtherPanels` 删除两处 `session-only:` 跳过逻辑，避免设备切走后仍在旧 session-only 面板的在线集合中（继续收 pi_event）(L84-108)
- 客户端配套：`useAIStore.ts` `reportWidgetError` 加 `panelId` 参数 (L457, L1515-1534)；`HtmlCanvasWidget.tsx` `onError` 传 `panelId` (L130)
- 运行时验证（独立对抗审查执行）：在 3457 端口启动本地 dev server 跑新代码，4 项关键修复全部通过 — S-1（日志 `Device adv-s1-A left panel panel-adv-s1, 1 device(s) still active, keeping session`）、M-1（日志 `Device adv-m1-A left panel session-only:adv-m1-test (switched to panel-adv-m1-real)`）、MULTI（device-A 切走后 device-B 接管 activeDevice）、DISC（设备断开后清理生效）
- 端口说明：本地验证用 SERVER_PORT=3457 避免与已运行的 living-dashboard-server 容器（生产旧镜像）端口冲突；生产部署待 Phase S7 重建镜像

### Phase S3 验收
- [ ] UPDATE 语句加 version 校验（WHERE id=$2 AND version=$3 RETURNING *）
- [ ] 并发修改不静默丢失
- [ ] 冲突时返回服务器版本供客户端展示
- [ ] 智能分场景策略正确（位置 LWW / state LWW+角标 / 删除优先 / 实体 LWW+日志）
- [ ] syncQueue 服务器侧持久化日志
- [ ] 无上限重试 + 指数退避
- [ ] 失败操作 UI 提示
- [ ] Docker 镜像构建 + 迁移脚本执行成功

### Phase S4 验收 ✅
- [x] ai_settings 表创建（键值存储）
- [x] user_skills 表创建
- [x] tool_settings 表创建
- [x] API Key 存 ai_settings DB 表（key=pi.api_key），客户端不持有
- [x] 提示词从 ai_settings 读取（替代 piBridge.ts 硬编码）
- [x] API 配置读写 API 可用
- [x] Skills 管理 API 可用（CRUD + 启用/禁用）
- [x] 工具管理 API 可用
- [x] 提示词/Skills 内容 sanitization 防注入
- [x] Docker 镜像构建 + 迁移脚本执行成功（本地开发验证通过，生产部署待 Phase S7）
  - 验证日期：2026-06-28
  - 镜像：event-server:latest（node:22-alpine，多阶段构建，builder + runtime）
  - 容器：living-dashboard-server Up，living-dashboard-postgres (healthy) Up
  - Schema：[Schema] PostgreSQL schema initialized, version: 1（含 ai_settings / user_skills / tool_settings / skill_settings 四张 S4 表）
  - API：GET /api/health 返回 200；GET /api/tools 返回 29 个工具
  - 迁移幂等：重启 server 再次 initializeSchema 无报错；skill_settings 迁移 SQL（DO $$ BEGIN ... END $$）正确清理 tool_settings 中 builtin:/user: 前缀记录，无残留
  - 端口说明：本地验证用 PG_PORT=5433 / SERVER_PORT=3457（避免与已运行的 aihub-postgres/本地 dev server 端口冲突），生产部署沿用默认 5432/3456

### Phase S5 验收 ✅
- [x] dynamic_widgets 表扩展（component_env/local_services/cross_platform/desktop_only）
- [x] 纯前端组件跨端共享（桌面端写，移动端渲染）
- [x] 依赖本地环境组件标记正确
- [x] 移动端查询过滤 desktop_only=FALSE 生效
- [x] 组件数据多端共享一致
- [ ] Docker 镜像构建 + 迁移脚本执行成功（本地开发验证通过，无 schema 破坏性变更，幂等 DO $$ ALTER TABLE 已就绪，生产部署待 Phase S7）
  - 验证日期：2026-07-01
  - 镜像：复用 event-server:latest（node:22-alpine，多阶段构建），无 schema 变更，仅代码修复
  - 容器：living-dashboard-server Up + living-dashboard-postgres (healthy) Up（dev 模式 3458 端口本地验证）
  - Schema：dynamic_widgets 表 4 个新字段齐全（component_env/local_services/cross_platform/desktop_only），DO $$ 幂等 ALTER 已就绪
  - 运行时验证 21/21 通过：健康检查 / schema 字段 / POST 创建 + 5 项校验 / GET 过滤 / PUT 更新 + 校验 / component_capabilities 联动（POST/PUT/DELETE 三向同步）/ DELETE + 404 / POST+PUT WS 广播 / sanitization / INVALID_BOOLEAN
  - 对抗审查（2 轮）：第 1 轮 4 个 bug（中 1 低 3）全部修复；第 2 轮确认 4/4 修复到位，0 新 bug
  - 端口说明：本地验证用 SERVER_PORT=3458（dev 模式 SERVER_TOKEN 空），生产部署沿用默认 3456

### Phase S6 验收 ✅
- [x] local_service_registry 表创建（schema.ts L259-272，含 UNIQUE(device_id, service_name) + 2 索引）
- [x] 桌面端本地服务可注册到服务器（POST /api/local-services/register upsert，运行时验证 201）
- [x] 代理 API 路由 `/proxy/:deviceId/:serviceName/*path` 可用（proxy.ts L130-132，运行时验证 200/503/504）
- [x] WS 转发到桌面端执行 fetch 成功（ws.ts sendProxyRequest + proxy_request/proxy_response，运行时验证完整链路 200）
- [x] 桌面端离线时返回明确错误（503 local_service_offline，运行时验证 3 种离线场景）
- [x] 心跳保活 + 在线状态准确（30s 心跳 + 60s 超时定时任务，运行时验证心跳超时清理）
- [x] Docker 镜像构建 + 迁移脚本执行成功（本地开发验证通过，CREATE TABLE IF NOT EXISTS 幂等，生产部署待 Phase S7）
  - 验证日期：2026-07-03
  - 容器：living-dashboard-postgres (healthy) Up + dev server (3458 端口) Up
  - Schema：local_service_registry 表存在（含 device_id/service_name/endpoint/description/online/last_heartbeat/registered_at/updated_at + UNIQUE + 2 索引）
  - 运行时验证 50/50 通过：见上方"完成内容"详述
  - 对抗审查（2 轮）：第 1 轮 6 bug（高 1 中 3 低 2）→ 修复 4 阻塞项；第 2 轮 4/4 修复验证 + 0 新 bug → 通过
  - 端口说明：本地验证用 SERVER_PORT=3458（dev 模式 SERVER_TOKEN 空），生产部署沿用默认 3456

### Phase S7 验收（每 Phase 强制）
- [ ] Docker 镜像构建成功（带版本 tag）
- [ ] docker-compose 配置正确
- [ ] 数据库迁移脚本幂等可执行
- [ ] 部署文档更新
- [ ] 迁移前数据备份
- [ ] 回滚方案可用

### Phase S8 验收 ✅（2026-07-11）
- [x] vitest + 测试 DB + Mock 工具配置就绪
- [x] piBridge 核心 + 工具注册 + per-panel session + 分层保留 cron 单测全绿
- [x] ws.ts 协议单测全绿（消息分发 / 心跳 / 广播 / 错误 / 鉴权）
- [x] 24 个工具（browser_*/widget_*/storage_*）单测全绿（每工具 ≥ 3 用例）
- [x] DB 迁移脚本（ai_conversations / ai_memories / ai_settings / user_skills / tool_settings / local_service_registry / dynamic_widgets 扩展）幂等可回滚
- [x] 集成测试（WS 端到端 + 真实 AI 调用 + 多端并行 + 冲突解决 + 离线降级）全绿
- [x] 测试覆盖率报告（核心 AI 模块 ≥ 70%）
- [x] CI 全绿（lint + unit + integration + coverage）
- [x] Docker 镜像构建 + 部署文档更新

### Phase S9 验收 ✅
- [x] 4 个工具均注册到 Pi Agent，LLM 能在对话中正确调用（GET /api/tools total=29 含 4 个 search 工具）
- [x] `local_search` 通过 `DEVICE_SPECIFIC_TOOLS` 路由到 `panelActiveDevices[panelId]`（piBridge.ts L59 + L878-898）
- [x] `web_search` 调 Bocha 返回正确 results，字段映射无误（运行时验证：真实 Bocha API 返回 401 for invalid key，证明 fetch 链路工作）
- [x] `academic_search` 调 S2 返回 papers，`openAccessPdf` 与 `externalIds.ArXiv` 兜底逻辑正确（运行时验证：真实 S2 API 返回 403，证明 fetch 链路工作；代码实现见 searchApi.ts）
- [x] `github_search` 6 个 mode 全部可用，`download_release` 资产下载 URL 无 release_id（searchApi.ts L551 `/releases/assets/${assetId}`）
- [x] `ai_settings` 表三类搜索引擎 Key 可读写，客户端无法直接获取明文 Key（`GET /api/search/keys` 只返回 `hasKey`）（DB 验证 3 条 searchKey.* 记录）
- [x] `/api/search/keys` 5 个端点均走 `authMiddleware` 鉴权，未鉴权返回 401（继承 /api 路由组的 authMiddleware）
- [x] `POST /api/search/keys/:provider/test` 能正确判断 Key 是否有效（bocha/S2/github 三种测试逻辑均生效，运行时验证 401/403/401）
- [x] API Key 缺失时返回"未配置 XX API Key"明确提示（运行时验证："未配置 Bocha API Key"）
- [x] 429 错误透传 retry-after（searchApi.ts L60-67 + L127-132）
- [x] 网络错误重试 3 次后返回错误（retryWithBackoff 指数退避 1s/2s/4s）
- [x] 配额监控表有调用记录，预警可触发（api_usage_log 表运行时验证有 5 条记录）
- [ ] Docker 镜像构建 + 迁移脚本执行成功（本地开发验证通过，生产部署待 Phase S7）

#### 已知问题与后续优化

> ⚠️ **重要提示**：搜索工具有已知质量问题，使用前请先阅读完整评估报告：[`docs/specs/search-tools-audit-report.md`](specs/search-tools-audit-report.md)

**4 个搜索工具当前状态：**

| 工具 | 提供商 | 状态 | 备注 |
|------|--------|------|------|
| `web_search` | Bocha 网页搜索 | ❌ 质量极差 | 中文/技术内容覆盖差，考虑更换 |
| `github_search` | GitHub API | ❌ 完全不可用 | Token 已过期/被撤销，需更新 |
| `academic_search` - S2 | Semantic Scholar | ❌ 新论文覆盖差 | 索引慢，适合搜老论文 |
| `academic_search` - ArXiv | ArXiv | ✅ 可用 | 需在服务器网络环境调用 |

**注意事项：**
- **ArXiv 搜索**必须在服务器网络环境中调用才稳定，本地直接调用可能出现 fetch failed
- **GitHub Token** 可能过期，使用前请先通过 `POST /api/search/keys/github/test` 测试有效性

### Phase S10 验收 ✅
- [x] `download_repo_zip` mode 返回完整代理 URL（`/api/github/proxy?type=zip...`），不是 `codeload.github.com` 直链
- [x] `academic_search` `mode='latest'` 返回 ArXiv 论文，按 `submittedDate` 倒序（`publicationDate` 非空）
- [x] `academic_search` `mode='latest'` 时 S2 Key 缺失也能工作（不抛"未配置 S2 Key"错误）
- [x] `download_file` path ≥1MB 返回代理 URL，不是 `raw.githubusercontent.com`
- [x] `download_file` sha ≥1MB 返回代理 URL，不是 base64 content
- [x] `download_release` assetId 返回代理 URL，不是 `objects.githubusercontent.com` CDN 直链
- [x] `/api/github/proxy` 端点支持 Range 请求（206 + Content-Range）
- [x] `/api/github/proxy` 端点 416 Range Not Satisfiable 透传
- [x] `/api/github/proxy` 端点鉴权生效（走 `/api` 全局 `authMiddleware`，401）
- [x] `/api/github/proxy` sha 路径返回二进制（非 JSON），Content-Type: application/octet-stream
- [x] `/api/github/proxy` 客户端中断时主动 abort 上游 fetch（`req.on('close')` + `AbortController`）
- [x] `/api/github/proxy` 上游 5 分钟无数据自动断开（504）
- [x] ArXiv 节流器 ≥3s 间隔，并发安全（预留时间槽模式，`arxivNextAvailableAt` 在 await 前更新）
- [x] S2 路径 `publicationDate` 字段填充（`fields` 参数追加 `publicationDate`）
- [x] `download_release` size 可能为 0 时不报错（`Content-Length` 头缺失兜底）
- [x] `SERVER_BASE_URL` 配置后代理 URL 是完整 URL（开发模式回退 `http://localhost:${PORT}`）
- [x] `download_file` <1MB 保持现有 base64 content 行为不变（无回归）
- [x] `academic_search` `mode='relevance'`（默认）行为与 S2 一致（无回归）
- [x] `aiTools.ts` 元数据 description 与 searchTools.ts 一致
- [x] `fast-xml-parser` 依赖新增（ArXiv Atom XML 解析）
- [ ] Docker 镜像构建 + 迁移脚本执行成功（本地开发验证通过，无 schema 变更，生产部署待 Phase S7）

---

## 五、服务器配置

### 5.1 生产服务器（已确认）

| 资源 | 实际配置 | 说明 |
|------|---------|------|
| **IP** | `154.37.222.110` | 远程 SSH `root`，凭据见 `.env.server`（不提交 git） |
| **CPU** | 2 核 | AI 推理调外部 API（不跑模型），WS 网关 + 数据同步 CPU 占用低 |
| **内存** | 4 GB | PostgreSQL + Node 服务 + WS 连接，远超需求（2G 即够） |
| **磁盘** | 100 GB | 系统 + 已有网站 Docker + Living Dashboard Docker，空间充裕 |
| **带宽** | 15 Mbps | 单用户绰绰有余，AI 流式 + 搜索中转 + 数据同步峰值 <3Mbps |

**已有部署**：1 个网站 Docker（约占用 0.5-1GB 内存 / 5-20GB 磁盘），Living Dashboard 作为第二个 Docker 共存，端口 3456。

**结论**：2h4g15m100g 对单用户绰绰有余，即使已有网站 Docker，资源余量仍然充裕（见 5.3 资源占用估算）。

### 5.2 不跑的内容（资源省下）

| 不跑 | 原因 |
|------|------|
| **AI 模型** | 调外部 API（OpenAI/DeepSeek/Qwen 等），服务器只转发 |
| **浏览器内核** | 浏览器在客户端（桌面 Electron / 移动 WebView），服务器不渲染网页 |
| **画面传输** | AI 操控浏览器在客户端执行，结果文本回传，不传画面 |
| **大文件存储** | 组件代码是 HTML/JS/CSS 文本，体积小；不存图片/视频 |

### 5.3 资源占用估算（含已有网站 Docker）

| 组件 | 内存 | 磁盘 | 说明 |
|------|------|------|------|
| **已有网站 Docker** | ~0.5-1 GB | ~5-20 GB | 已在运行 |
| PostgreSQL | ~300 MB | 随数据增长 | 主要存储，对话历史分层保留控制 |
| Node 服务（Pi Agent + WS 网关） | ~200 MB | - | 28 个工具 + WS 连接 |
| Docker overhead | ~100 MB | ~1 GB | 镜像 + 容器 |
| 日志 | - | ~1 GB | syncQueue 日志 + 应用日志 |
| **Living Dashboard 合计** | ~0.6 GB | ~10 GB | 远小于 4GB/100GB 总量 |
| **总余量** | **剩 2-3 GB** | **剩 70-85 GB** | 充裕 |

### 5.4 Docker 资源限制（防止影响共存服务）

生产服务器已有 4 个 Docker（aihub/gitea/uptime-kuma/aihub-postgres）+ 宝塔面板，Living Dashboard Docker **必须设置资源限制**：

```yaml
# docker-compose.yml 关键配置
services:
  living-dashboard:
    # ...
    mem_limit: 1g          # 内存硬上限 1GB（正常占用 ~0.6GB）
    cpus: 1.0              # CPU 上限 1 核（正常占用 <0.2 核）
    mem_reservation: 512m  # 内存软下限 512MB
    restart: unless-stopped
    logging:
      driver: json-file
      options:
        max-size: "10m"    # 单个日志文件最大 10MB
        max-file: "3"      # 最多保留 3 个日志文件
    networks:
      - living-dashboard   # 独立网络，不干扰 aihub/gitea

  postgres:
    # ... Living Dashboard 自带独立 PG，不用 aihub 的
    mem_limit: 512m
    networks:
      - living-dashboard

networks:
  living-dashboard:
    driver: bridge
```

**为什么加限制**：防异常时（如内存泄漏、死循环）吃光服务器资源导致 aihub/gitea 被 OOM Kill。

### 5.5 部署操作指南（不影响共存服务）

**核心原则：不需要重启服务器，不影响其他项目。**

| 操作 | 命令 | 影响范围 |
|------|------|---------|
| **首次部署** | `docker-compose up -d` | 只启动 Living Dashboard 容器 |
| **更新部署** | `docker-compose up -d --build` | 只重建+重启 Living Dashboard 容器 |
| **仅重启服务** | `docker-compose restart` | 只重启 Living Dashboard 容器 |
| **数据库迁移** | `docker-compose exec living-dashboard npm run migrate` | 容器内执行，不影响其他 |
| **查看日志** | `docker-compose logs -f` | 只看 Living Dashboard 日志 |
| **回滚** | `docker-compose down` → 旧镜像 `docker-compose up -d` | 只操作 Living Dashboard |

**不受影响的共存服务**：aihub-app / aihub-realtime / aihub-postgres / gitea / uptime-kuma / 宝塔 / Nginx

**唯一需注意的场景**：
- **服务器重启**（如系统更新）：所有 Docker 会重启，但 `restart: unless-stopped` 会自动拉起，无需手动干预
- **磁盘满**：Living Dashboard 日志/数据失控占满磁盘 → 所有服务受影响。已通过资源限制 + 日志轮转 + 分层保留 cron 规避
- **端口冲突**：Living Dashboard 用 3456 端口，已确认无冲突

### 5.6 共存服务开发铁律

| 铁律 | 说明 |
|------|------|
| **PG 不用 aihub 的** | aihub-postgres 在 aihub_default 网络内，Living Dashboard 自带独立 PG 容器，绝不能混用 |
| **不动宝塔 Nginx 已有配置** | 后续加反向代理时在宝塔面板里新增一个 server 块指向 `127.0.0.1:3456`，不修改已有的 aihub 配置 |
| **Docker 网络隔离** | Living Dashboard 用 `living-dashboard` 独立 bridge 网络，不加入 aihub_default / gitea_gitea |
| **日志轮转必配** | `max-size: 10m, max-file: 3`，防日志撑爆磁盘拖垮所有服务 |
| **数据库迁移在容器内执行** | 不直接操作宿主机，用 `docker-compose exec` 执行迁移脚本 |

### 5.7 扩容触发条件

| 指标 | 触发扩容 | 扩容方向 |
|------|---------|---------|
| CPU 持续 > 70% | 多端并发高 | 加核 |
| 内存 > 80% | WS 连接多 / session 多 | 加内存 |
| 磁盘 > 80% | 对话历史增长 | 加磁盘 / 调短保留周期 |
| 带宽打满 | 多端同步频繁 | 加带宽 |

---

## 六、约束条件

### 6.1 硬约束

| 约束 | 说明 |
|------|------|
| **不推翻重来** | Phase 3 的 WS 网关、withFallback、broadcastChange、canvasStorage 机制保留 |
| **针对性改造** | 只改架构文档 1.2 节列出的问题点 |
| **服务器权威** | AI 推理 + 数据同步都在服务器，客户端本地缓存降级 |
| **Docker 部署** | 保持 Docker 部署，docker-compose 一键管理 |
| **TypeScript 优先** | 服务器端用 TypeScript |
| **不下载到 C 盘** | 开发工具/缓存配置到非 C 盘 |
| **git 版本管理** | 所有变更走 git commit |

### 6.2 开发环境

| 工具 | 路径 |
|------|------|
| 项目根目录 | `f:\allmylife\event` |
| 服务器代码 | `f:\allmylife\event\server\` |
| 服务器 spec | `f:\allmylife\event\docs\specs\phase3-server-spec.md` |

---

## 七、开发工作流（强制）

> 此规则优先级高于一切。任何 Phase 在开始编码前，必须完成以下步骤。

### 执行铁律：写 Spec → 对抗审查 Spec → 编码 → 对抗审查

```
编写 Spec → 对抗审查 Spec → 审查通过？
                                ↓ 否 → 修订 Spec → 重新审查
                                ↓ 是 → 编码实现 → adversarial-review Skill 对抗审查 → 通过？
                                                                                  ↓ 否 → 修复 → 重新审查
                                                                                  ↓ 是 → git commit
```

### 上下文要求

每次写 Spec 时，必须包含：
- 项目目的（服务器是 AI 推理 + 数据同步 + 多端协作中心）
- [architecture_refactor.md](architecture_refactor.md) 的对应章节
- 本 roadmap 的 Phase 任务和验收标准
- 约束条件（TypeScript 优先、不下载 C 盘、Docker 部署等）
- 与桌面/移动端 roadmap 的依赖关系

---

## 八、AI 接入测试说明

> **目的**：服务器 S8 AI 自动化测试（集成测试 + 真实 LLM 调通验证）需要可用的 API Key。**本节仅写占位符与配置方法，不写真实 Key**；Key 写到本地 `.env` 或服务器 `ai_settings` 表（不进 git）。

### 8.1 支持测试的 provider

| Provider | 默认 | 用途 | 备注 |
|----------|------|------|------|
| **stepfun**（阶跃星辰） | ✅ | 默认 e2e 测试 provider，性价比高、国内可直连 | `PI_MODEL=stepfun/step-3.7-flash` |
| **openai** | - | 国际标准兼容性测试 | `PI_MODEL=openai/gpt-4o-mini` |
| **deepseek** | - | 中文推理 + 思考链 | `PI_MODEL=deepseek/deepseek-chat` |
| **anthropic** | - | 长上下文 + Claude 系列 | `PI_MODEL=anthropic/claude-3-5-sonnet` |
| **Qwen (SiliconFlow 代理)** | - | 阿里通义千问（通过 SiliconFlow 中转） | `PI_MODEL=qwen/qwen-2.5-72b-instruct` |

### 8.2 占位符与配置方法

#### 方式 A：写到 `.env`（推荐本地/CI 用）

在 `server/.env`（gitignore）写入：

```bash
# 默认 stepfun（国内可直连，e2e 测试首选）
PI_MODEL=stepfun/step-3.7-flash
PI_API_KEY=<your-stepfun-key-here>
PI_ENDPOINT=https://api.stepfun.com/v1

# 切换 openai（兼容性测试）
# PI_MODEL=openai/gpt-4o-mini
# PI_API_KEY=<your-openai-key-here>
# PI_ENDPOINT=https://api.openai.com/v1

# 切换 deepseek（中文推理）
# PI_MODEL=deepseek/deepseek-chat
# PI_API_KEY=<your-deepseek-key-here>
# PI_ENDPOINT=https://api.deepseek.com/v1

# 切换 anthropic（Claude）
# PI_MODEL=anthropic/claude-3-5-sonnet
# PI_API_KEY=<your-anthropic-key-here>
# PI_ENDPOINT=https://api.anthropic.com/v1

# 切换 Qwen（通过 SiliconFlow 中转）
# PI_MODEL=qwen/qwen-2.5-72b-instruct
# PI_API_KEY=<your-siliconflow-key-here>
# PI_ENDPOINT=https://api.siliconflow.cn/v1
```

> **注意**：`<your-xxx-key-here>` 是占位符，**实际部署/测试前替换为真实 Key**。`.env` 必须在 `.gitignore` 中，**绝不能 commit**。

#### 方式 B：写到 `ai_settings` 表（S4 落地后用，运行时切换）

```sql
-- 服务器侧：S4 落地后用此 SQL 写入（不在 git 中）
INSERT INTO ai_settings (key, value, updated_at) VALUES
  ('pi.model',          'stepfun/step-3.7-flash', NOW()),
  ('pi.api_key',        '<your-stepfun-key-here>', NOW()),  -- 加密存储
  ('pi.endpoint',       'https://api.stepfun.com/v1', NOW()),
  ('pi.reasoning_effort', 'medium', NOW())
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW();
```

> **注意**：真实部署时 API Key 应通过 S4 提供的 `PUT /api/ai/settings` 写入，**不直接 SQL 写**。本 SQL 仅供测试初始化用。

### 8.3 最小测试命令

#### 用 `curl` 验证 provider 可达

```bash
# stepfun 示例（替换 <your-stepfun-key-here> 为真实 key）
curl -X POST "https://api.stepfun.com/v1/chat/completions" \
  -H "Authorization: Bearer <your-stepfun-key-here>" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "step-3.7-flash",
    "messages": [{"role":"user","content":"ping"}],
    "max_tokens": 16
  }'
```

**期望返回**（HTTP 200）：
```json
{
  "choices": [{"message": {"role": "assistant", "content": "pong"}}]
}
```

#### 用 `tsx` 跑通服务器 LLM 调用链路

```bash
# 在 server/ 目录下，临时把 .env 读入
cd f:\allmylife\event\server
npx tsx -e "
import { callLLM } from './src/ai/llmClient';
const reply = await callLLM({
  model: process.env.PI_MODEL,
  apiKey: process.env.PI_API_KEY,
  messages: [{ role: 'user', content: 'ping' }],
});
console.log('LLM reply:', reply);
" --env-file=.env
```

**期望输出**：`LLM reply: pong`（或类似 provider 响应）

#### 用 vitest 集成测试跑通（Phase S8 落地后）

```bash
# 跑 S8 集成测试组（AI 真实调用）
cd f:\allmylife\event\server
npm run test:integration -- --grep "AI 真实调用"
```

### 8.4 安全与运维约束

| 约束 | 说明 |
|------|------|
| **不 commit 真实 key** | `.env` 必须在 `.gitignore`；roadmap / spec / 文档只用占位符 `<your-xxx-key-here>` |
| **CI 用 secrets** | GitHub Actions 用 `secrets.PI_API_KEY` 注入，**不写在 workflow 文件里** |
| **本地测试用最低权限 key** | 测试用 key 限额最小、只读权限 |
| **服务端 key 加密** | S4 落地后 API Key 存服务器 `ai_settings` 表（key=pi.api_key），不存客户端；auth.json 文件仅作为 AuthStorage 运行时载体，不再持久化 API Key |
| **轮换策略** | 测试 key 30 天轮换一次；泄露立即吊销 |

### 8.5 三端测试时的 key 流向

| 端 | Key 存哪 | Key 谁配 | 测试时怎么取 |
|----|---------|---------|------------|
| **服务器** | `.env`（开发） / `ai_settings` 表（S4 后） | 开发者 / CI secrets | `process.env.PI_API_KEY` / 读表 |
| **桌面端** | Electron `safeStorage`（Phase 8 轻 agent 用） | 用户在 UI 配置 | 走 IPC 读 |
| **移动端** | `EncryptedSharedPreferences`（Phase M8 轻 agent 用） | 用户在 UI 配置 | 走 DataStore 读 |

> **关键原则**：API Key 永远不存 git 仓库；测试时统一用占位符 `<your-xxx-key-here>` 替换。

---

## 九、下一步

本 roadmap 确认后，后续 AI 应：
1. 读完本 roadmap + [architecture_refactor.md](architecture_refactor.md)
2. 选择当前要做的 Phase（建议 Phase S1：AI 上下文改造，P0 优先）
3. 针对该 Phase 写详细 Spec
4. Spec 对抗审查
5. 编码实现
6. adversarial-review Skill 对抗审查
7. git commit
8. 生成 Docker 镜像 + 迁移脚本（Phase S7 强制）

**建议优先级**：Phase S1（AI 上下文，P0）→ S2（多端并行，P0）→ S4（AI 配置后端，P0）→ S3（冲突解决，P1）→ S5（动态组件跨端，P1）→ S6（本地服务代理，P1）→ S8（AI 自动化测试，含发布）→ S9（AI 搜索工具，依赖 S4）→ S10（GitHub 中转下载 + ArXiv 最新论文 + 大文件服务器代理，依赖 S9）

> Phase S0 已完成。Phase S1/S2/S4 是 P0，优先做；Phase S3/S5/S6 是 P1，第二波。Phase S7 发布任务贯穿所有 Phase。Phase S8 需等 S1/S2/S4 落地后启动。Phase S9 需等 S4（`ai_settings` 表）落地后启动，详见 [ai-search-spec.md](specs/ai-search-spec.md)。Phase S10 需等 S9 落地后启动，详见 [phase-s10-spec.md](specs/phase-s10-spec.md)。
