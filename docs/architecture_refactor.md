# Living Dashboard 架构改造文档

> 生成日期：2026-06-23
> 状态：Phase 4-6 已完成（桌面端），Phase M0-M2 已完成（移动端），Phase S0 已完成（服务器端）。本文档覆盖 Phase S1+/Phase 7+/Phase M3+ 的架构依据。
> 被引用：[roadmap_desktop_v1.md](file:///f:/allmylife/event/docs/roadmap_desktop_v1.md) Phase 4+、[roadmap_mobile_v1.md](file:///f:/allmylife/event/docs/roadmap_mobile_v1.md)

---

## 一、背景

### 1.1 产品定位

Living Dashboard 形态上是"浏览器 + 无限画布 + AI"，但**功能用途上是日常 AI 助手**。这决定了架构优先级：
- AI 随时可用（服务器推理，但需高可用）
- AI 上下文按面板共享（同一面板多端共享，不同面板独立）
- 多端数据同步
- 动态组件跨端共享（需区分纯前端组件 vs 依赖本地环境组件）

### 1.2 现有方案问题（Phase 3）

| 问题 | 现状 | 影响 |
|------|------|------|
| **session 模型** | 全局单 session，所有设备共享上下文 | 不同面板的对话互相污染 |
| **activeDeviceId** | 单一，多端抢控制权 | 多端无法并行 AI 操作 |
| **冲突解决** | version 字段存了但没校验 | 多端并发改同一数据会静默丢失 |
| **syncQueue 持久化** | 仅 IndexedDB | 清缓存就丢，超 5 次重试静默放弃 |
| **组件跨端** | 未设计 | 动态组件无法多端共享 |

### 1.3 改造原则

- **不推翻重来**：Phase 3 的 WS 网关、withFallback、broadcastChange、canvasStorage 等机制成熟，保留
- **针对性改造**：只改问题点
- **保持服务器权威**：AI 推理 + 数据同步都在服务器
- **用户不在乎部署难度**：保持 Docker 部署

---

## 二、AI 上下文改造：按面板 session

### 2.1 现状

```
全局单 session（SessionManager.inMemory）
  → 所有设备共享一个上下文
  → A 设备对话，B 设备能看到并继续
```

### 2.2 目标

```
per-panel session（Map<panelId, AgentSession>）
  → 同一面板多端共享上下文
  → 不同面板独立上下文
```

### 2.3 改造点

| 改造点 | 现状 | 目标 |
|--------|------|------|
| session 存储 | `SessionManager.inMemory()` 单例 | `Map<panelId, Session>` 按面板创建 |
| 消息路由 | `onClientMessage(deviceId, msg)` | `onClientMessage(deviceId, panelId, msg)` |
| session 生命周期 | 全局，永不清理 | 面板删除时清理 session；超时清理（7 天未用，见第十二章决策） |
| 上下文持久化 | 内存，重启丢失 | 存 PostgreSQL（ai_conversations 表 + ai_memories 表），分层保留（见 12.1） |
| 多端共享 | 全局共享 | 同面板共享（WS 广播 AI 事件到该面板的所有在线设备） |

### 2.4 数据模型

```sql
-- AI 对话历史（按面板）
CREATE TABLE ai_conversations (
  id BIGSERIAL PRIMARY KEY,
  panel_id VARCHAR(64) NOT NULL,        -- 关联面板
  role VARCHAR(16) NOT NULL,             -- user/assistant/tool
  content TEXT NOT NULL,
  tool_calls JSONB,                      -- AI 调用的工具
  tool_result JSONB,                     -- 工具返回结果
  created_at BIGINT NOT NULL,
  device_id VARCHAR(64),                 -- 发起设备
  INDEX idx_panel_created (panel_id, created_at)
);

-- AI 记忆（按面板，长期记忆）
CREATE TABLE ai_memories (
  id BIGSERIAL PRIMARY KEY,
  panel_id VARCHAR(64) NOT NULL,
  memory_type VARCHAR(32),               -- fact/preference/summary
  content TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  INDEX idx_panel (panel_id)
);
```

### 2.5 session 恢复

服务器重启或面板 session 超时清理后，下次该面板有消息时：
1. 从 `ai_conversations` 加载最近 N 条对话（如 20 条）
2. 从 `ai_memories` 加载该面板的记忆
3. 重建 session 上下文
4. 继续对话

---

## 三、多端并行改造：按面板路由工具调用

### 3.1 现状

```
单一 activeDeviceId
  → A 设备发消息 → activeDeviceId = A
  → B 设备发消息 → activeDeviceId = B（抢走控制权）
  → A 的浏览器操作中断
```

### 3.2 目标

```
per-panel activeDeviceId
  → 面板1 的 AI 操作路由到面板1 的活跃设备
  → 面板2 的 AI 操作路由到面板2 的活跃设备
  → 多端不同面板可并行
```

### 3.3 改造点

| 改造点 | 现状 | 目标 |
|--------|------|------|
| activeDeviceId | 全局单一 | `Map<panelId, deviceId>` 按面板记录 |
| 工具路由 | `DEVICE_SPECIFIC_TOOLS` 路由到全局 activeDeviceId | 路由到 `panelActiveDevices[panelId]` |
| 并行支持 | 不支持 | 不同面板可并行 AI 操作 |
| 同面板多端 | 后发消息设备抢控制权 | 同面板后发消息设备更新该面板的 activeDeviceId（符合预期：同面板共享上下文，最后操作的设备负责执行） |

### 3.4 路由规则

```typescript
// 伪代码
function routeToolCall(panelId: string, tool: string, params: any) {
  const targetDeviceId = panelActiveDevices[panelId];
  if (!targetDeviceId) {
    throw new Error(`面板 ${panelId} 无在线设备`);
  }
  sendToolCall({ targetDeviceId, tool, params });
}
```

**同面板多端规则**：
- 同面板多端在线时，最后发 user_message 的设备成为该面板的 activeDevice
- AI 工具调用路由到该面板的 activeDevice
- AI 思考流广播到该面板的所有在线设备（多端都能看到 AI 在想什么）

---

## 四、冲突解决改造：真正的乐观锁

### 4.1 现状

```sql
-- version 字段存了，但 UPDATE 没校验
UPDATE widgets SET state = $1, version = version + 1 WHERE id = $2;
-- 问题：多端并发改同一 widget，后写覆盖先写，无冲突提示
```

### 4.2 目标

```sql
-- 真正的乐观锁
UPDATE widgets SET state = $1, version = version + 1
WHERE id = $2 AND version = $3
RETURNING *;
-- 如果 RETURNING 为空，说明版本不匹配，冲突
```

### 4.3 冲突处理策略（智能分场景，见第十二章决策）

| 场景 | 策略 |
|------|------|
| **组件位置/尺寸冲突** | last-write-wins（位置冲突不重要） |
| **组件 state 冲突** | 默认 last-write-wins + UI 角标"有冲突，点击查看"，用户可选择回滚/合并（见 12.2） |
| **面板删除冲突** | 删除优先（已删就删了） |
| **实体数据冲突** | last-write-wins + 记录冲突日志 |

### 4.4 客户端冲突处理

```typescript
// 客户端提交更新
const result = await api.updateWidget(id, state, expectedVersion);
if (!result) {
  // 版本不匹配，冲突
  const serverVersion = await api.getWidget(id);
  showConflictDialog({
    local: state,
    remote: serverVersion.state,
    onKeepLocal: () => api.updateWidget(id, state, serverVersion.version),
    onKeepRemote: () => refreshFromServer(id),
    onMerge: (merged) => api.updateWidget(id, merged, serverVersion.version),
  });
}
```

---

## 五、syncQueue 持久化加强

### 5.1 现状

- 离线写入仅存 IndexedDB（`living-dashboard-sync/pendingOps`）
- 浏览器清缓存 → 队列丢失
- 超 5 次重试 → 静默放弃

### 5.2 改造

| 改造点 | 现状 | 目标 |
|--------|------|------|
| 持久化 | 仅 IndexedDB | IndexedDB + 日志文件（Electron 本地文件系统） |
| 重试上限 | 5 次放弃 | 无上限，但指数退避（1s/2s/4s/8s/16s/60s...） |
| 失败处理 | 静默放弃 | 标记为 failed，UI 提示用户手动处理 |
| 冲突检测 | 无 | 回写时校验 version，冲突则提示 |

### 5.3 日志文件（桌面端）

```typescript
// Electron 主进程写日志
function logSyncOp(op: SyncOp, status: 'pending' | 'success' | 'failed', error?: string) {
  const logPath = path.join(app.getPath('userData'), 'sync-log.jsonl');
  fs.appendFileSync(logPath, JSON.stringify({
    timestamp: Date.now(),
    op,
    status,
    error,
  }) + '\n');
}
```

---

## 六、动态组件跨端共享

### 6.1 组件分类

| 类型 | 例子 | 依赖本地环境 | 能否跨端 |
|------|------|------------|---------|
| **纯前端组件** | 计算器、待办列表、CSS 动画 | 否 | ✅ 可跨端 |
| **依赖本地环境组件** | 调本地笔记 API 的 HTML、访问本地文件、调 localhost 服务 | 是 | ❌ 不能直接跨端 |
| **内置组件** | Calculator/FocusTimer 等 9 个 | 否（但代码不跨端） | ❌ 需各端重写（桌面 React / 移动 Kotlin） |

### 6.2 纯前端组件跨端

**机制**：
- 组件代码（HTML/JS/CSS）存服务器 PostgreSQL `dynamic_widgets` 表
- 桌面端：iframe srcdoc 渲染
- 移动端：WebView loadDataWithBaseURL 渲染
- `canvasStorage` 协议复用，各端实现 postMessage 桥接

**数据持久化**：
- 组件数据通过 `canvasStorage` → `kvStorage` → `withFallback` 存储到服务器
- 两端共享同一份数据（服务器权威）

### 6.3 依赖本地环境组件跨端

**问题**：
- 组件 HTML 里 `fetch('http://localhost:xxx/api')` 调本地服务
- 桌面端：localhost 指向桌面本机，能访问 ✅
- 移动端：localhost 指向手机本机，访问不到桌面服务 ❌

**优先级决策（见第十二章）**：先 C 后 A，方案 B 不做。

**方案 C：不共享（Phase 4 先做）**

```
依赖本地环境的组件标记为"仅桌面端"
移动端不显示，或显示提示"此组件依赖桌面端环境"
```

**方案 A：服务器中转（Phase 6 做）**

```
桌面端本地服务 → 注册到服务器 → 服务器暴露代理 API
移动端组件 fetch 服务器代理 API → 服务器转发到桌面端本地服务
（需桌面端在线）
```

实现：
1. 桌面端启动本地服务检测，注册可用 API 到服务器
2. 服务器维护 `local_service_registry` 表（deviceId, serviceName, endpoint, online）
3. 移动端组件 fetch 时，URL 改写：`http://localhost:xxx/api` → `http://server:3456/proxy/deviceId/serviceName/api`
4. 服务器代理转发到桌面端（通过 WS 让桌面端执行 fetch 并返回结果）

**方案 B：数据同步（非实时，不做）**

```
桌面端本地数据 → 定期同步到服务器
移动端组件 fetch 服务器数据（非实时）
（离线可用，但不是最新）
```

理由：非实时不如直接用服务器数据，价值不大。

### 6.4 组件元数据扩展

`dynamic_widgets` 表新增字段：

```sql
ALTER TABLE dynamic_widgets ADD COLUMN:
  component_env VARCHAR(16) DEFAULT 'pure-frontend',  -- pure-frontend / local-dependent
  local_services JSONB,                               -- 依赖的本地服务列表（方案A用）
  cross_platform BOOLEAN DEFAULT TRUE,                -- 是否跨端可用
  desktop_only BOOLEAN DEFAULT FALSE,                 -- 是否仅桌面端
```

### 6.5 实时获取新信息

| 场景 | 桌面端 | 移动端 |
|------|--------|--------|
| **纯前端组件** | iframe 内 setInterval/fetch 服务器 API | WebView 内 setInterval/fetch 服务器 API |
| **依赖本地服务** | iframe fetch localhost（实时） | 方案A：fetch 服务器代理（近实时，需桌面在线）；方案B：fetch 服务器缓存数据（非实时） |

---

## 七、UI 图标方案

### 7.1 桌面端（Electron + React）

**方案**：`lucide-react`（轻量 SVG 图标库，tree-shaking）

```bash
npm install lucide-react
```

```tsx
import { Home, Search, ArrowLeft, ArrowRight, Plus, X, Pin } from 'lucide-react';

// 使用
<Home size={20} color="currentColor" />
<Pin size={16} />
```

**优势**：
- Tree-shaking，只打包用到的图标
- SVG 矢量，任意缩放
- 支持 tint（color 属性）
- 体积小（单图标 ~1KB）

**Logo**：用 SVG 或 WebP，放 `client/desktop/src/assets/`

### 7.2 移动端（Kotlin + Compose）

见 [roadmap_mobile_v1.md](file:///f:/allmylife/event/docs/roadmap_mobile_v1.md) 3.12 节（Compose Icons + VectorDrawable + R8）

---

## 八、Skills 与 MCP 支持

### 8.1 Skills 支持

**现状**：Pi Agent 引擎原生支持 skills（默认开启），自动扫描以下路径加载 `SKILL.md`：
- `~/.pi/agent/skills/`（用户全局）
- `.pi/skills/`（项目级）
- `~/.agents/skills/`（跨工具共享）
- `.agents/skills/`（项目级）

**项目现状**：未禁用 skills，但项目内无任何 skill 文件。

**改造方向**：

| 改造项 | 说明 |
|--------|------|
| **内置 skills** | 在 `.pi/skills/` 放置产品内置 skill（如 product-guide，让 AI 了解产品本身） |
| **Skills 管理 UI** | 设置区域加 Skills 管理 tab：列出已加载 skills、启用/禁用、查看内容 |
| **用户自定义 skills** | 用户可添加自己的 skill（存服务器，多端共享） |
| **Skills 目录配置** | 支持配置额外的 skills 目录路径 |

**Skill 格式**（Pi Agent 标准）：

```
.pi/skills/
└── skill-name/
    └── SKILL.md    # YAML frontmatter + Markdown 指令
```

```yaml
---
name: product-guide
description: Living Dashboard 产品使用指南，帮助用户了解产品功能
version: 1.0.0
---

# 产品使用指南

## 产品定位
Living Dashboard 是一个日常 AI 助手...

## 功能说明
...
```

### 8.2 MCP 支持

**现状**：Pi Agent 引擎**明确不支持 MCP**（设计哲学拒绝），官方建议用 skills 替代。

**项目残留**：
- `.mcp.json`（失效，指向不存在的文件，给编辑器用的，非 Pi Agent）
- `mcpManifest.ts`（禁用占位代码）

**决策**：**不引入 MCP**，用 skills 替代 MCP 的功能。

**理由**：
1. Pi Agent 官方明确拒绝 MCP，强行接入需写 extension，维护成本高
2. Skills 能覆盖大部分 MCP 场景（CLI 工具 + README 模式）
3. 项目已有完整的工具系统（24 个自定义工具），不需要 MCP 协议
4. 清理残留的 `.mcp.json` 和 `mcpManifest.ts` 占位代码

**清理任务**：
- 删除 `.mcp.json`（失效配置）
- 删除 `mcpManifest.ts`（禁用占位）
- 清理 `types/v2.ts` 中的 `DisabledMcpComponentManifest` 类型
- 清理 `WidgetContainer.tsx` 和 `widgetRender.ts` 中的 MCP 占位引用

---

## 九、设置区域设计

### 9.1 现状

现有 SettingsPanel 只有 4 个 tab：外观/行为/数据/服务器。完全缺失 AI 相关配置。

### 9.2 目标：新增 AI 配置 tab

| Tab | 现状 | 改造 |
|-----|------|------|
| 外观 | ✅ 已有 | 保留 |
| 行为 | ✅ 已有 | 保留 |
| 数据管理 | ✅ 已有 | 保留 |
| 服务器 | ✅ 已有 | 保留（连接配置） |
| **AI 配置** | ❌ 缺失 | **新增** |

### 9.3 AI 配置 tab 内容

#### 9.3.1 API 配置

| 配置项 | 说明 | 存储 |
|--------|------|------|
| 模型选择 | `<provider>/<model>`（如 stepfun/step-3.7-flash） | 服务器环境变量 / 设置存储 |
| API Key | 对应 provider 的 API Key | 服务器 ai_settings 表（key=pi.api_key，不存客户端） |
| Endpoint | 自定义 API endpoint（可选） | 服务器环境变量 |
| 连接测试 | 测试 API 是否可用 | - |

**注意**：API Key 存服务器 ai_settings 表（key=pi.api_key），客户端不持有。客户端通过 UI 修改时，经服务器 `PUT /api/ai/settings` 保存到 ai_settings 表。piBridge 启动时从 ai_settings 读取并注入到运行时 AuthStorage。

#### 9.3.2 提示词配置

| 配置项 | 说明 | 存储 |
|--------|------|------|
| 系统提示词 | 覆盖/追加默认系统提示词 | 服务器设置存储 |
| 画布提示词 | 画布助手专用提示词 | 服务器设置存储 |
| 浏览器提示词 | 浏览器工具使用说明提示词 | 服务器设置存储 |
| 恢复默认 | 恢复硬编码的默认提示词 | - |

**现状**：提示词硬编码在 `piBridge.ts` L497-526（canvasPrompt + browserPrompt）。改造为从设置存储读取，有默认值。

#### 9.3.3 Skills 管理

| 功能 | 说明 |
|------|------|
| Skills 列表 | 列出已加载的 skills（名称/描述/版本/来源） |
| 启用/禁用 | 每个 skill 可单独启用/禁用 |
| 查看内容 | 查看 SKILL.md 内容 |
| 添加 skill | 用户可添加自定义 skill（输入名称+内容，存服务器） |
| 删除 skill | 删除用户添加的 skill（内置 skill 不可删） |
| Skills 目录 | 配置额外的 skills 目录路径 |

#### 9.3.4 工具管理（可选）

| 功能 | 说明 |
|------|------|
| 工具列表 | 列出 24 个工具（名称/描述/参数） |
| 启用/禁用 | 每个工具可单独启用/禁用（高级功能） |

### 9.4 数据模型

```sql
-- AI 设置（键值存储）
CREATE TABLE ai_settings (
  key VARCHAR(128) PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at BIGINT NOT NULL
);

-- 用户自定义 skills
CREATE TABLE user_skills (
  id VARCHAR(64) PRIMARY KEY,
  name VARCHAR(128) NOT NULL,
  description TEXT,
  content TEXT NOT NULL,           -- SKILL.md 内容
  enabled BOOLEAN DEFAULT TRUE,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);

-- 工具启用状态
CREATE TABLE tool_settings (
  tool_name VARCHAR(64) PRIMARY KEY,
  enabled BOOLEAN DEFAULT TRUE,
  updated_at BIGINT NOT NULL
);
```

### 9.5 安全考虑

- **API Key 不存客户端**：客户端 UI 修改 API Key 时，经服务器 `PUT /api/ai/settings` 保存到 ai_settings 表（key=pi.api_key），piBridge 启动时读取并注入运行时 AuthStorage，客户端不持有
- **提示词注入防护**：用户自定义提示词需做基本 sanitization（防止注入恶意指令）
- **Skills 内容审查**：用户自定义 skill 内容需审查（防止注入恶意指令）

### 9.6 实现说明（S4 落地后修订）

实际实现相比 9.3.1 节有如下演进：

| 项 | spec 原方案 | 实际实现 | 原因 |
|----|------------|---------|------|
| API Key 存储 | auth.json | ai_settings DB 表（key=pi.api_key） | DB 比文件更易多端共享、审计、备份；与 model/endpoint 同表便于原子更新 |
| AuthStorage | 持久化 | 仅运行时容器（piBridge 启动时从 DB 注入） | 单一数据源（DB），避免双写 |

**关于 auth.json 文件**：`piBridge.ts` 中 `AuthStorage.create(...auth.json)` 仍会创建 auth.json 文件作为 AuthStorage 库的运行时载体，但 API Key 的持久化源已改为 ai_settings DB 表。piBridge 启动时从 ai_settings 读取并通过 `setRuntimeApiKey()` 注入到 AuthStorage；auth.json 文件不再作为持久化源，开发者调试时应以 ai_settings 表为准。

**历史 spec 文档**：phase3-server-spec.md / phase4-product-form-architecture.md / phase-m8-mobile-light-agent.md / ai-search-spec.md 等历史 spec 中关于"API Key 存 auth.json"的描述不再准确，以本节为准。

---

## 十、改造优先级

| 改造项 | 优先级 | 建议时机 | 状态 | 影响 |
|--------|--------|---------|------|------|
| **按面板 session** | P0 | Phase 4 | ✅ 已完成 | AI 上下文正确性 |
| **按面板路由工具调用** | P0 | Phase 4 | ✅ 已完成 | 多端并行 |
| **UI 图标方案** | P0 | Phase 4 | ✅ 已完成 | 桌面端 UI |
| **AI 配置 tab（API+提示词）** | P0 | Phase 4 | ✅ 已完成 | AI 可配置 |
| **内置 product-guide skill** | P0 | Phase 4 | ✅ 已完成 | AI 了解产品 |
| **Skills 管理 UI** | P1 | Phase 4-5 | ✅ 已完成 | Skills 可管理 |
| **冲突解决（乐观锁）** | P1 | Phase 4-5 | ✅ 已完成 | 数据一致性 |
| **syncQueue 持久化** | P1 | Phase 4-5 | ✅ 已完成 | 数据不丢 |
| **MCP 残留清理** | P1 | Phase 4-5 | ✅ 已完成 | 代码整洁 |
| **动态组件跨端（纯前端）** | P1 | Phase 5 | ✅ 已完成 | 组件共享 |
| **用户自定义 skills** | P2 | Phase 5+ | ✅ 已完成 | 高级功能 |
| **动态组件跨端（依赖本地）** | P2 | Phase 6+ | ✅ 已完成 | 高级场景 |
| **单机轻 Agent** | P1 | Phase 8（桌面）/ M8（移动） | 待做 | 离线 AI 可用 |
| **思考等级** | P0 | Phase 4.2（桌面）/ M3（移动） | 待做 | AI 推理深度可调 |
| **发布与分发** | P0 | 每 Phase 强制 | 持续 | 用户能实际使用 |

---

## 十一、与 roadmap 的关系

- **桌面端 roadmap**：Phase 4+ 任务引用本文档作为架构依据
- **移动端 roadmap**：Phase M3（AI 集成）+ Phase M5（数据同步）引用本文档
- **实现时**：先读本文档，再读对应 Phase 的 spec

---

## 十二、已确认决策（2026-06-24）

| 问题 | 决策 | 理由 |
|------|------|------|
| **session 超时清理时间** | **7 天未用清理内存 session** | 对话历史持久化到 `ai_conversations` 表，下次有消息时从数据库恢复最近 20 条 + `ai_memories`。7 天平衡内存占用与活跃用户不被误清。24h 太短，30 天内存占用太高。 |
| **冲突解决策略** | **智能分场景** | 位置/尺寸冲突：last-write-wins（不重要）；组件 state 冲突：默认 last-write-wins + UI 角标"有冲突，点击查看"，用户可选择回滚/合并；面板删除冲突：删除优先；实体数据冲突：LWW + 冲突日志。纯弹框打断多（移动端尤其烦），纯 LWW 静默丢数据。 |
| **依赖本地环境组件跨端** | **先 C 后 A** | Phase 4 先做方案 C（标记仅桌面端，移动端显示"此组件依赖桌面端环境"提示），保证移动端不报错；Phase 6 做方案 A（服务器中转）实现真正跨端。方案 B（数据同步非实时）价值不大，不做。 |
| **AI 对话历史保留** | **分层保留** | 近期（30 天内）：完整保留；中期（30-90 天）：AI 自动总结成摘要，丢弃原始对话；长期（90 天+）：只保留 `ai_memories` 表中的结构化记忆。兼顾长期记忆与存储成本。 |

### 12.1 分层保留实现要点

```sql
-- ai_conversations 表新增字段
ALTER TABLE ai_conversations ADD COLUMN:
  summarized BOOLEAN DEFAULT FALSE,           -- 是否已总结成摘要
  summary_of BIGINT[],                        -- 该条摘要包含的原始对话 id 列表
  retention_level VARCHAR(16) DEFAULT 'full'; -- full / summary / memory-only
```

**清理任务**（服务器定时 cron）：
1. 每天扫描 30 天前的 `full` 对话 → 调 AI 总结成 `summary` 条目，原对话标记 `summarized=TRUE`
2. 每天扫描 90 天前的 `summary` 条目 → 提取关键信息到 `ai_memories`，删除 `summary` 条目
3. `ai_memories` 永久保留（结构化记忆，体积小）

### 12.2 冲突解决 UI 实现

```typescript
// 组件 state 冲突时的 UI 处理
interface ConflictBadge {
  widgetId: string;
  localVersion: number;
  remoteVersion: number;
  remoteState: WidgetState;
  timestamp: number;
}

// 组件右上角显示角标，点击展开冲突处理面板
// 选项：保留本地 / 保留远端 / 合并 / 查看差异
```

### 12.3 依赖本地环境组件标记

```sql
-- dynamic_widgets 表字段（方案 C）
ALTER TABLE dynamic_widgets ADD COLUMN:
  desktop_only BOOLEAN DEFAULT FALSE,          -- 标记仅桌面端
  local_services JSONB,                        -- 依赖的本地服务列表（方案 A 用，Phase 6）
  cross_platform BOOLEAN DEFAULT TRUE;         -- 是否跨端可用

-- 移动端查询时过滤
SELECT * FROM dynamic_widgets WHERE desktop_only = FALSE;
```

---

## 十三、单机轻 Agent + 思考等级

### 13.1 背景

**现状**：AI 推理只在服务器 Pi Agent，无服务器 = 无 AI。

**目标**：双端各实现一个单机轻 agent，无服务器时也能用 AI（调用户自配 API Key）。服务器 Pi Agent 作为云端增强（多端共享上下文 + skills 同步）。

**决策**（2026-06-24）：
- 双端都做轻 agent
- 调用户自配 API Key（OpenAI/DeepSeek/Qwen 等兼容）
- 桌面端用 TS 直接复用 `@earendil-works/pi-agent-core` + `@earendil-works/pi-ai` 包
- 移动端用 Kotlin 从零仿写（约 6 个核心文件）

### 13.2 Pi 包安装修复

**现状**：`f:\allmylife\event\server\node_modules\@earendil-works\` 下的 pi 包未正确安装（只有 README + package.json，无 dist/）。

**修复**：在 server 目录重新 `npm install`，确保 dist/ 目录存在。桌面端复用时，在 `client/desktop/package.json` 加依赖或用 workspace 引用。

### 13.3 轻 agent 核心架构

#### 桌面端（TypeScript，复用 pi-agent-core）

```
Electron 主进程
├── pi-agent-core (Agent + AgentLoop)
├── pi-ai (LLM 客户端，30+ provider)
├── ToolRegistry (复用 server/piBridge.ts 的 24 个工具定义)
├── SessionManager.inMemory() (按面板 session)
└── IPC 桥接 → 渲染进程执行工具
```

**关键**：工具 execute 函数从 WS 路由改为 IPC 路由（`ipcMain.handle` → 渲染进程 `ipcRenderer.invoke`）。

#### 移动端（Kotlin，从零仿写）

```
Android App
├── LlmClient.kt (OkHttp SSE 流式调 OpenAI 兼容 API)
├── AgentLoop.kt (Coroutines Flow: stream → 解析 tool_calls → execute → 循环)
├── Tool.kt + ToolRegistry.kt (工具接口 + 注册表)
├── Session.kt (inMemory 消息历史 + systemPrompt + tools)
├── SkillLoader.kt (扫描 SKILL.md，注入 system prompt)
└── AgentEvent.kt (sealed class: TextDelta/ToolExecution/TurnEnd)
```

**核心 Agent Loop 伪代码**（Kotlin）：

```kotlin
suspend fun agentLoop(
    session: Session,
    userMessage: String,
    thinkingLevel: Int
): Flow<AgentEvent> = flow {
    session.addMessage(UserMessage(userMessage))
    while (true) {
        val stream = llmClient.stream(
            model = session.model,
            messages = session.messages,
            tools = session.tools,
            thinkingLevel = thinkingLevel  // 映射到 provider 参数
        )
        val assistantMsg = StringBuilder()
        val toolCalls = mutableListOf<ToolCall>()
        stream.collect { event ->
            when (event) {
                is TextDelta -> { assistantMsg.append(event.text); emit(event) }
                is ToolCallDelta -> toolCalls.add(event.call)
                else -> {}
            }
        }
        session.addMessage(AssistantMessage(assistantMsg.toString(), toolCalls))
        if (toolCalls.isEmpty()) break
        // 执行工具
        for (call in toolCalls) {
            val result = toolRegistry.execute(call.name, call.args)
            session.addMessage(ToolResultMessage(call.id, result))
            emit(ToolExecution(call.id, result))
        }
    }
}
```

### 13.4 工具桥接

**桌面端**：现有 29 个工具（browser_*/widget_*/storage_*/local_search 等）的 execute 函数从 WS 路由改为 IPC 路由。

```typescript
// 桌面端轻 agent 工具执行（替代 executeViaWs）
async function executeViaIpc(tool: string, params: unknown, panelId: string): Promise<unknown> {
  const win = BrowserWindow.getFocusedWindow();
  return await win.webContents.executeJavaScript(
    `window.__agentToolExecute(${JSON.stringify({ tool, params, panelId })})`
  );
}
```

**移动端**：工具通过 Kotlin 接口实现，WebView 操作通过 `evaluateJavascript`。

```kotlin
interface Tool {
    val name: String
    val parameters: JsonObject
    suspend fun execute(args: JsonObject): ToolResult
}

class BrowserEvalTool(private val webView: WebView) : Tool {
    override val name = "browser_eval"
    override suspend fun execute(args: JsonObject): ToolResult {
        val script = args["script"]!!.jsonPrimitive.content
        val result = webView.evaluateJavascriptBlocking(script)
        return ToolResult.success(result)
    }
}
```

### 13.5 用户 API Key 存储

**桌面端**：Electron `safeStorage`（系统级加密，Windows DPAPI）

```typescript
import { safeStorage } from 'electron';

function saveApiKey(provider: string, key: string) {
  const encrypted = safeStorage.encryptString(key);
  fs.writeFileSync(apiKeyPath(provider), encrypted);
}

function loadApiKey(provider: string): string | null {
  const path = apiKeyPath(provider);
  if (!fs.existsSync(path)) return null;
  const encrypted = fs.readFileSync(path);
  return safeStorage.decryptString(encrypted);
}
```

**移动端**：`EncryptedSharedPreferences`（Android Keystore）

```kotlin
val masterKey = MasterKey.Builder(context).setKeyScheme(MasterKey.KeyScheme.AES256_GCM).build()
val sharedPreferences = EncryptedSharedPreferences.create(
    context, "ai_keys", masterKey,
    EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
    EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
)
sharedPreferences.edit { putString("openai_key", apiKey) }
```

### 13.6 思考等级映射（参考 Operit）

**4 档**：1=自动，2=标准，3=深度，4=最深

| Provider | 等级 1 | 等级 2 | 等级 3 | 等级 4 | API 字段 |
|----------|--------|--------|--------|--------|---------|
| **DeepSeek** | auto | high | high | max | `reasoning_effort` |
| **Qwen (SiliconFlow)** | null（自动） | 4096 | 8192 | 16384 | `thinking_budget` |
| **OpenAI Responses** | low | medium | high | xhigh | `reasoning.effort` |
| **Claude** | adaptive | adaptive | enabled(8000) | enabled(16000) | `thinking.type` + `budget_tokens` |
| **Gemini** | auto | auto | includeThoughts | includeThoughts | `thinkingConfig.includeThoughts` |

**实现**：每个 provider 一个 `mapThinkingLevel(level: Int): Map<String, Any>` 函数，在构建 API 请求体时注入。

### 13.7 Agent 切换 UI

AI 对话框加"云端/本地"切换：

```
┌─────────────────────────────────────┐
│ [云端●] [本地○]  [思考:2▼]  [⋮]    │
│ ┌─────────────────────────────────┐ │
│ │ AI 对话内容...                  │ │
│ └─────────────────────────────────┘ │
│ [输入消息...]              [发送]   │
└─────────────────────────────────────┘
```

- **云端**：连服务器 Pi Agent（多端共享上下文 + skills 同步）
- **本地**：用轻 agent（调用户 API Key，上下文本地）
- **自动**：服务器在线用云端，离线自动切本地

### 13.8 离线降级

```typescript
// 桌面端伪代码
async function sendMessage(panelId: string, message: string) {
  const useCloud = serverOnline && userPreference.agentMode !== 'local';
  try {
    if (useCloud) {
      await cloudAgent.send(panelId, message);
    } else {
      await localAgent.send(panelId, message);
    }
  } catch (e) {
    if (useCloud) {
      // 云端失败，降级到本地
      showToast('服务器不可用，切换到本地 agent');
      await localAgent.send(panelId, message);
    } else {
      throw e;
    }
  }
}
```

### 13.9 Skills 本地加载

轻 agent 也加载 `.pi/skills/` 的 skills（含 product-guide）。

**桌面端**：pi-agent-core 原生支持 skills 加载，配置 `DefaultResourceLoader` 的 skills 目录即可。

**移动端**：`SkillLoader.kt` 扫描 assets 或内部存储的 `.pi/skills/*/SKILL.md`，解析 YAML frontmatter，注入 system prompt。

```kotlin
class SkillLoader(private val context: Context) {
    fun loadSkills(): List<Skill> {
        val skills = mutableListOf<Skill>()
        // 从 assets/pi/skills/ 扫描
        context.assets.list("pi/skills")?.forEach { dir ->
            val content = context.assets.open("pi/skills/$dir/SKILL.md").bufferedReader().readText()
            skills.add(parseSkill(dir, content))
        }
        return skills
    }
}
```

### 13.10 与服务器 Pi Agent 的关系

| 维度 | 服务器 Pi Agent（云端） | 单机轻 Agent（本地） |
|------|----------------------|-------------------|
| **模型** | 服务器配置的模型 | 用户自配 API Key 的模型 |
| **上下文** | 按面板共享，多端同步 | 本地，不同步 |
| **Skills** | 服务器 `.pi/skills/` + 用户上传 | 本地 `.pi/skills/` |
| **工具** | 29 个工具（WS 路由到设备） | 29 个工具（IPC/直接执行） |
| **思考等级** | 支持 | 支持 |
| **离线** | 不可用 | 可用 |
| **多端协作** | 支持 | 不支持 |

**定位**：云端是增强（多端 + 持久化），本地是保底（离线 + 自配 Key 省钱）。

---

## 十四、Sidebar AI 助手（Phase 8）

### 14.1 目标

浏览网页时随时唤起 AI 对话和操作网页，无需切换到画布面板。

### 14.2 核心改造

**砍旧入口**：
- 删除 Omnibox `ai:` 命令入口
- 删除 `GlobalQuickInput` 组件
- 删除 Alt 键监听唤起逻辑

**Sidebar 新增 AI 助手形态**：
- Sidebar 增加"AI 助手"标签页，与现有标签页并列
- AI 助手面板包含：对话区 + 输入框 + 工具执行状态
- 上下文绑定当前浏览页面（自动注入页面 URL/标题/DOM 摘要）

### 14.3 API 配置预设

支持多套 API 配置，per-session 选用：

| 配置项 | 说明 |
|--------|------|
| 预设名称 | 如"快速"、"深度"、"省钱" |
| 模型 | 每个预设可配不同模型 |
| API Key | 每个预设可配不同 Key（或复用全局） |
| Endpoint | 每个预设可配不同 Endpoint |
| 思考等级 | 每个预设默认思考等级 |

AI 会话创建时选择使用哪套预设配置。

### 14.4 AI 会话管理

| 功能 | 说明 |
|------|------|
| 新建会话 | 选择 API 配置预设，创建新 AI 会话 |
| 删除会话 | 删除 AI 会话及其历史 |
| 重命名会话 | 修改会话显示名称 |
| 绑定面板 | 将会话绑定到特定画布面板（共享该面板上下文） |
| 会话列表 | Sidebar 侧边栏显示历史会话列表 |

### 14.5 askUserQuestion 工具

AI 可主动向用户弹选项框，获取用户确认或选择：

```typescript
// 工具定义
{
  name: "askUserQuestion",
  description: "向用户提问并等待回答",
  parameters: {
    question: { type: "string", description: "向用户提出的问题" },
    options: { type: "array", items: { type: "string" }, description: "可选选项列表" },
    allowFreeText: { type: "boolean", description: "是否允许自由文本输入" }
  }
}
```

- 工具路由：非 `DEVICE_SPECIFIC_TOOLS`，服务器直接渲染提示到客户端
- 客户端弹出对话框，用户选择/输入后返回结果
- 超时（60s）默认返回"用户未响应"

### 14.6 Spec 引用

详见 [specs/phase8-sidebar-ai-assistant.md](file:///f:/allmylife/event/specs/phase8-sidebar-ai-assistant.md)

---

## 十五、AI 搜索工具（Phase S9/12/M11）

### 15.1 目标

为 AI 提供 4 个搜索工具，使其能检索本地内容、网络信息、学术论文和 GitHub 仓库。

### 15.2 工具定义

| 工具名 | 类型 | 执行位置 | 说明 |
|--------|------|---------|------|
| `local_search` | `DEVICE_SPECIFIC_TOOLS` | 路由到客户端 | 查询客户端本地索引（书签/历史/笔记等） |
| `web_search` | 普通工具 | 服务器进程内 fetch | 调用 Bocha Web Search API 搜索网页 |
| `academic_search` | 普通工具 | 服务器进程内 fetch | 调用 Semantic Scholar API 搜索学术论文 |
| `github_search` | 普通工具 | 服务器进程内 fetch | 调用 GitHub Search API 搜索仓库/代码 |

### 15.3 local_search（路由到客户端）

- 归类为 `DEVICE_SPECIFIC_TOOLS`，由服务器路由到面板活跃设备执行
- 客户端维护本地索引（SQLite FTS5 / 内存倒排），AI 调用时查询并返回结果
- 搜索范围：书签、浏览历史、本地笔记、画布面板内容

### 15.4 web_search / academic_search / github_search（服务器进程内）

- **不路由到客户端**，在服务器 Node.js 进程内直接 fetch 外部 API
- 减少客户端网络开销和延迟
- 结果经服务器过滤/摘要后返回给 AI

### 15.5 AI 设置表扩展

`ai_settings` 表新增搜索相关配置键：

| Key | 说明 | 示例值 |
|-----|------|--------|
| `SEARCH_KEY_BOCHA` | Bocha Web Search API Key | `sk-xxx` |
| `SEARCH_KEY_SEMANTIC_SCHOLAR` | Semantic Scholar API Key | `xxx` |
| `SEARCH_KEY_GITHUB` | GitHub Personal Access Token | `ghp_xxx` |

### 15.6 /api/search/keys Key 管理 API

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/search/keys` | GET | 获取所有搜索 Key（值脱敏显示） |
| `/api/search/keys` | PUT | 更新搜索 Key（写入 ai_settings 表） |
| `/api/search/keys/:provider/test` | POST | 测试指定搜索 Key 是否可用 |

### 15.7 Spec 引用

详见 [specs/ai-search-spec.md](file:///f:/allmylife/event/specs/ai-search-spec.md)

---

## 十六、AI 自动化测试（Phase S8/11/M10）

### 16.1 服务器端测试（Phase S8）

| 维度 | 说明 |
|------|------|
| **框架** | vitest |
| **工期** | 5-8 天单人 |
| **覆盖范围** | piBridge + WS 网关 + 工具数 24→29 + DB 迁移 + 集成测试 |
| **关键测试点** | 工具路由逻辑、乐观锁冲突、session 按面板隔离、搜索工具 API 集成、AI 设置 CRUD |

### 16.2 桌面端测试（Phase 11）

| 维度 | 说明 |
|------|------|
| **框架** | vitest + Testing Library + Playwright Electron |
| **工期** | 3-5 周单人 |
| **覆盖范围** | 单元测试（工具执行/状态管理）+ 组件测试（UI 交互）+ E2E（Electron 集成） |
| **关键测试点** | AI 对话流、Sidebar AI 助手、工具 IPC 桥接、离线降级、搜索结果展示 |

### 16.3 移动端测试（Phase M10）

| 维度 | 说明 |
|------|------|
| **框架** | JUnit4 + MockK + Turbine + Robolectric |
| **工期** | 3-5 天单人 |
| **覆盖范围** | 单元测试（AgentLoop / ToolRegistry / SkillLoader）+ ViewModel 测试 |
| **关键测试点** | SSE 流式解析、工具执行协程、思考等级映射、API Key 加密存储 |
