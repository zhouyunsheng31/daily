# Phase 14：AI 基础设施解放 — 文件系统 + Skill 化 + 容器操控

> **生成日期**：2026-06-29
> **依据**：[roadmap_desktop_v1.md](../roadmap_desktop_v1.md) Phase 14（第 885-991 行）
> **前置依赖**：Phase 9（单机轻 Agent）✅ + Phase 11（AI 自动化测试）✅
> **估时**：约 13d（14.1 ~3d + 14.2 ~2d + 14.3 ~5d + 14.4 ~2d + 14.5 ~1d）

---

## 一、项目背景

Living Dashboard 桌面端 = "浏览器 + 无限画布 + AI" 形态的日常 AI 助手。Phase 0-11 已完成核心功能（产品形态、收藏预览、内存休眠、Sidebar AI 助手、单机轻 Agent、自动化测试）。Phase 14 的目标是**解放 AI 的基础设施操作能力**：让 AI 能读写宿主机文件、操控 Docker 容器、部署服务；同时将现有工具体系 Skill 化，减少 AI 上下文占用；并预留知识库接口。

## 二、调研发现（必读）

### 2.1 三套独立工具体系（关键架构错位）

| 体系 | 位置 | 工具数 | AI 实际使用？ |
|------|------|--------|-------------|
| **前端 toolRegistry** | `src/ai/toolRegistry.ts` + `registerTools.ts` + `tools/*.ts` | 13 组 51 个 | ❌ **未接入 AI** |
| **服务器 piBridge customTools** | `server/src/piBridge.ts:902-933` | 29 个 | ✅ 云端 AI 用 |
| **桌面 LocalAgentService customTools** | `client/desktop/electron/main/localAgent/LocalAgentService.ts:467-479` | 25 个 | ✅ 本地 AI 用 |

**roadmap 14.3 描述的"13 组工具"指前端 toolRegistry**，但**这套工具未接入 AI 主流程**。AI 实际用的是 piBridge/LocalAgentService 的 customTools。

### 2.2 Skill 加载不对齐

| 端 | 是否加载 `.pi/skills/` | 配置位置 |
|----|----------------------|---------|
| 桌面本地 Agent | ✅ 加载 | `LocalAgentService.ts:341-357` 配置 `additionalSkillPaths: [skillsDir]` |
| 服务器云端 Agent | ❌ **未加载** | `piBridge.ts:1047-1068` 未配置 `additionalSkillPaths` |

新创建的 Skill 在云端 AI 模式下加载不到，**必须在 Phase 14 同步修复**。

### 2.3 现有 Skill 体系（可复用）

- `.pi/skills/product-guide/SKILL.md` —— 唯一内置 Skill，格式参考
- Skill 管理 UI：`client/desktop/src/components/settings/AISkillsManager.tsx`
- Skill CRUD API：`server/src/routes/skills.ts`（`/api/skills`）
- 内置 Skill 扫描目录硬编码为 `.pi/skills/`

### 2.4 现状清单

| 功能 | 现状 |
|------|------|
| 14.1 文件系统 Skill | 完全从零（无 UI / IPC / 工具 / Skill 目录） |
| 14.2 Docker Skill | 完全从零（无 UI / IPC / 工具 / Skill / docker-compose.ai.yml） |
| 14.3 工具 Skill 化 | 前端 toolRegistry 13 组工具未接入 AI；canvas-cli/memory-cli/life-cli/music-cli 全不存在 |
| 14.4 组件能力声明 | dynamic_widgets 表有 4 个扩展字段（component_env/local_services/cross_platform/desktop_only），但无 component_capabilities 表、无 query_capabilities 工具 |
| 14.5 知识库预留 | 完全从零（无 /api/wiki 路由、无类型、无 Skill 目录） |
| Skill 两端对齐 | 服务器 piBridge 未配置 additionalSkillPaths |

### 2.5 顺手发现的小问题

- `server/src/types/index.ts:58-67` 的 `DynamicWidgetRow` 类型过时，未包含 Phase 5 扩展的 4 个字段（component_env/local_services/cross_platform/desktop_only），与实际 schema 不一致。

## 三、设计决策

### 3.1 14.3 工具 Skill 化策略（保守方案）

**不破坏现有 piBridge customTools**（避免影响 606+ 用例）。采取以下策略：

1. **创建 4 个 Skill CLI**（`skills/canvas-cli/`、`skills/memory-cli/`、`skills/life-cli/`、`skills/music-cli/`），每个 CLI 内部通过 HTTP API 调用服务器（`/api/panels`、`/api/widgets`、`/api/entities` 等）实现业务工具操作。
2. **Skill CLI 作为 AI 的"按需加载"入口**：AI 读取 SKILL.md 后知道何时调用 CLI；CLI 通过 `--json` 输出结构化数据；不在 piBridge customTools 中注册这些工具。
3. **前端 toolRegistry 保持不动**（反正未接入 AI，留作 IDB 数据操作的备用库，未来如需可单独接入）。
4. **AI 上下文 token 减少**：AI 通过 Skill 调用业务工具，piBridge customTools 不增加新工具。Skill 是按需加载的文档，平时不在上下文中。

### 3.2 Skill 两端对齐（强制）

修复 `server/src/piBridge.ts` 的 `createSession()`，添加 `additionalSkillPaths: [join(cwd, '.pi', 'skills')]`，让云端 AI 也能加载 `.pi/skills/` 下的 Skill。

### 3.3 Skill 目录结构（统一规范）

所有新 Skill 放在 `.pi/skills/<skill-name>/` 下：
```
.pi/skills/<skill-name>/
├── SKILL.md           # Skill 描述（YAML frontmatter + Markdown）
├── cli.ts             # CLI 入口源码（TypeScript）
└── cli.js             # 编译产物（运行时直接 node cli.js 调用）
```

**注**：roadmap 写 `skills/<skill-name>/`，但 `.pi/skills/` 是项目已有 Skill 扫描路径，统一放这里避免维护两套扫描逻辑。

### 3.4 Skill CLI 调用约定

- 入口：`node .pi/skills/<skill-name>/cli.js <command> [args] [--json]`
- 输出：默认人类可读文本；加 `--json` 输出 JSON
- 退出码：0 成功，1 业务错误，2 参数错误
- 错误信息：JSON 模式下输出 `{ "error": "..." }`，文本模式输出 stderr

### 3.5 安全沙箱（fs-cli 必须）

- 白名单目录：`F:\allmylife\event\`（项目目录）+ `os.homedir()/Documents`（用户文档目录）+ `%APPDATA%/living-dashboard`（用户数据目录，等价于 app.getPath('userData')）
- 黑名单：C 盘系统目录（`C:\Windows`、`C:\Program Files`、`C:\Program Files (x86)`、`C:\System Volume Information`）
- **大小写不敏感比较**（Windows 路径不区分大小写）
- **显式拒绝 UNC 路径**（`\\SERVER\share`）
- **显式拒绝 8.3 短文件名**（如 `C:\PROGRA~1`）
- **path.resolve + fs.realpath 解析**：先解析为绝对路径，再 realpath 解析符号链接和 junction
- **拒绝包含 `..` 的原始输入**（realpath 之前先校验）
- 操作审计日志：`F:\allmylife\event\data\fs-audit.log`（追加模式，>10MB 自动轮转）

**注**：fs-cli 是独立 Node 进程，不在 Electron 上下文，不能用 `app.getPath()`。用 `os.homedir()` + 平台特定路径替代。

### 3.6 Docker Skill 安全策略

- 不暴露 `docker system prune`、`docker rm -f` 等危险命令
- 仅支持 `up/down/ps/logs/run/exec` 6 个命令
- `run/exec` 限制镜像白名单（用户可配置，默认允许常见镜像）
- 容器必须挂载到 `living-dashboard-net` 网络

## 四、详细实施计划

### 14.1 AI 文件系统访问（P0，~3d）

#### 14.1.1 文件系统 Skill CLI

**新建文件**：
- `.pi/skills/fs-cli/SKILL.md` —— Skill 描述
- `.pi/skills/fs-cli/cli.ts` —— CLI 源码（TypeScript）
- `.pi/skills/fs-cli/cli.js` —— 编译产物（或直接 .mjs）
- `.pi/skills/fs-cli/tsconfig.json` —— 独立 tsconfig（避免影响主项目）
- `scripts/build-fs-cli.mjs` —— 构建脚本（tsc 编译 cli.ts → cli.js）

**CLI 命令**：
```bash
node .pi/skills/fs-cli/cli.js ls <path> [--json]
node .pi/skills/fs-cli/cli.js read <path> [--json] [--encoding utf8|base64]
node .pi/skills/fs-cli/cli.js write <path> --content <text> [--encoding] [--json]
node .pi/skills/fs-cli/cli.js mkdir <path> [--json]
node .pi/skills/fs-cli/cli.js rm <path> [--recursive] [--json]
node .pi/skills/fs-cli/cli.js mv <src> <dst> [--json]
node .pi/skills/fs-cli/cli.js cp <src> <dst> [--recursive] [--json]
node .pi/skills/fs-cli/cli.js stat <path> [--json]
```

**安全沙箱实现**：
- `validatePath(p: string): { ok: boolean; error?: string }` —— 校验路径在白名单内
- 白名单：项目根目录 + `app.getPath('userData')` + 用户文档目录（`app.getPath('documents')`）
- 黑名单：`C:\Windows`、`C:\Program Files`、`C:\Program Files (x86)`、`C:\System Volume Information`
- 软链接解析：`fs.realpath` 后再校验，避免绕过

**审计日志**：
- 每次操作记录：时间戳 / 操作类型 / 路径 / 调用方（AI/user）/ 结果
- 日志文件：`F:\allmylife\event\data\fs-audit.log`（追加模式，自动轮转 >10MB）

#### 14.1.2 SKILL.md 内容

参照 `product-guide/SKILL.md` 格式：
```yaml
---
name: fs-cli
description: 文件系统操作 Skill，让 AI 能读写宿主机文件系统（受白名单沙箱约束）
version: 1.0.0
---

# fs-cli — 文件系统操作 Skill

## 何时使用
- 用户要求读写项目目录内的文件
- 用户要求查看目录结构
- 用户要求创建/删除/移动/复制文件
- AI 需要读取配置文件、日志文件等

## 何时不能使用
- 操作 C 盘系统目录（C:\Windows / C:\Program Files 等）
- 操作白名单外的目录（会返回权限错误）

## 命令清单
（列出所有命令 + 参数 + 示例）

## 输出格式
- 默认人类可读文本
- 加 --json 输出 JSON：{ "ok": true, "data": {...} } 或 { "ok": false, "error": "..." }
```

#### 14.1.3 验收

- [ ] `node .pi/skills/fs-cli/cli.js ls F:/allmylife/event/docs --json` 正常返回目录列表
- [ ] `node .pi/skills/fs-cli/cli.js read F:/allmylife/event/package.json --json` 正常返回文件内容
- [ ] `node .pi/skills/fs-cli/cli.js write F:/allmylife/event/data/test.txt --content "hello" --json` 正常写入
- [ ] 访问 `C:/Windows/System32` 返回权限错误
- [ ] 访问白名单外目录（如 `D:/OtherProject`）返回权限错误
- [ ] 审计日志正常记录每次操作
- [ ] SKILL.md 格式与 product-guide 一致

### 14.2 AI Docker 容器操控（P0，~2d）

#### 14.2.1 Docker Skill CLI

**新建文件**：
- `.pi/skills/docker-cli/SKILL.md`
- `.pi/skills/docker-cli/cli.ts`
- `.pi/skills/docker-cli/cli.js`
- `.pi/skills/docker-cli/tsconfig.json`
- `scripts/build-docker-cli.mjs`

**CLI 命令**：
```bash
node .pi/skills/docker-cli/cli.js ps [--json]                          # 列出容器
node .pi/skills/docker-cli/cli.js up <service> [--file <compose-file>] [--json]  # 启动服务
node .pi/skills/docker-cli/cli.js down <service> [--file <compose-file>] [--json]  # 停止服务
node .pi/skills/docker-cli/cli.js logs <service> [--tail <n>] [--json]  # 查看日志
node .pi/skills/docker-cli/cli.js run <image> <cmd...> [--json]         # 运行一次性容器
node .pi/skills/docker-cli/cli.js exec <service> <cmd...> [--json]      # 在运行中容器执行命令
```

**实现方式**：通过 `child_process.execFile` 调用 `docker` CLI（要求宿主机已装 Docker）。

#### 14.2.2 docker-compose.ai.yml overlay

**新建文件**：`docker-compose.ai.yml`

```yaml
# AI 部署的服务 overlay（不与主 compose 冲突）
# 用法：docker compose -f docker-compose.yml -f docker-compose.ai.yml up -d <service>
# 注：不重复定义顶层 networks（沿用主 compose 的 living-dashboard-net bridge 网络）
version: '3.8'
services:
  # AI 部署的服务在此追加，每个服务必须：
  # 1. networks: [living-dashboard-net]（引用主 compose 已定义的网络）
  # 2. 数据卷挂载到 F:\allmylife\event\data\<service-name>\
  # 3. 资源限制（mem/cpus）
  # 示例：
  # knowledge-base:
  #   image: ...
  #   networks: [living-dashboard-net]
  #   volumes:
  #     - ./data/knowledge-base:/data
```

#### 14.2.3 验收

- [ ] `node .pi/skills/docker-cli/cli.js ps --json` 返回当前容器列表
- [ ] `node .pi/skills/docker-cli/cli.js up postgres --json` 启动 postgres 服务
- [ ] `node .pi/skills/docker-cli/cli.js logs postgres --tail 10 --json` 返回日志
- [ ] `docker-compose.ai.yml` overlay 文件存在且格式正确
- [ ] SKILL.md 描述清晰，AI 能理解何时调用

### 14.3 现有工具 Skill 化（P1，~5d）

#### 14.3.1 canvas-cli Skill（合并 panel + widget）

**新建文件**：
- `.pi/skills/canvas-cli/SKILL.md`
- `.pi/skills/canvas-cli/cli.ts`
- `.pi/skills/canvas-cli/cli.js`
- `.pi/skills/canvas-cli/tsconfig.json`

**CLI 命令**：
```bash
node .pi/skills/canvas-cli/cli.js panel ls [--json]
node .pi/skills/canvas-cli/cli.js panel get <panelId> [--json]
node .pi/skills/canvas-cli/cli.js panel create --name <name> [--json]
node .pi/skills/canvas-cli/cli.js panel delete <panelId> [--json]
node .pi/skills/canvas-cli/cli.js widget ls [--panel <panelId>] [--json]
node .pi/skills/canvas-cli/cli.js widget get <widgetId> [--json]
node .pi/skills/canvas-cli/cli.js widget create --panel <panelId> --type <type> [--state <json>] [--json]
node .pi/skills/canvas-cli/cli.js widget update <widgetId> --state <json> [--json]
node .pi/skills/canvas-cli/cli.js widget delete <widgetId> [--json]
```

**实现**：通过 `fetch` 调用服务器 HTTP API（`http://localhost:3456/api/panels`、`/api/widgets`）。

#### 14.3.2 memory-cli Skill

**CLI 命令**：
```bash
node .pi/skills/memory-cli/cli.js save --content <text> [--type <type>] [--json]
node .pi/skills/memory-cli/cli.js list [--type <type>] [--limit <n>] [--json]
node .pi/skills/memory-cli/cli.js update <id> --content <text> [--json]
node .pi/skills/memory-cli/cli.js delete <id> [--json]
node .pi/skills/memory-cli/cli.js search <query> [--limit <n>] [--json]
```

**实现**：通过 `fetch` 调用服务器 `/api/entities?type=memory` + `/api/scopes` 等。

#### 14.3.3 life-cli Skill（合并 habit/mood/focus/savings/quickNote）

**CLI 命令**：
```bash
node .pi/skills/life-cli/cli.js habit ls [--json]
node .pi/skills/life-cli/cli.js habit checkin --id <habitId> [--json]
node .pi/skills/life-cli/cli.js mood add --score <n> [--note <text>] [--json]
node .pi/skills/life-cli/cli.js mood history [--limit <n>] [--json]
node .pi/skills/life-cli/cli.js focus start [--goal <text>] [--json]
node .pi/skills/life-cli/cli.js focus stop [--json]
node .pi/skills/life-cli/cli.js focus stats [--json]
node .pi/skills/life-cli/cli.js savings ls [--json]
node .pi/skills/life-cli/cli.js savings create --name <name> --target <amount> [--json]
node .pi/skills/life-cli/cli.js savings update --id <id> --amount <amount> [--json]
node .pi/skills/life-cli/cli.js quicknote add --content <text> [--json]
node .pi/skills/life-cli/cli.js quicknote ls [--limit <n>] [--json]
node .pi/skills/life-cli/cli.js quicknote search <query> [--json]
```

**实现**：通过 `fetch` 调用服务器 `/api/entities?type=<entity-type>` 等。

#### 14.3.4 music-cli Skill

**CLI 命令**：
```bash
node .pi/skills/music-cli/cli.js playlist ls [--json]
node .pi/skills/music-cli/cli.js playlist get <playlistId> [--json]
node .pi/skills/music-cli/cli.js song play --id <songId> [--json]
```

**实现**：通过 `fetch` 调用服务器 `/api/entities?type=musicPlaylist` 等。

#### 14.3.5 服务器 piBridge 加载 Skill（两端对齐）

**修改文件**：`server/src/piBridge.ts` 的 `createSession()` 函数（约第 1047-1068 行）

```typescript
// 修改前
const resourceLoader = new piPkg.DefaultResourceLoader({
  cwd,
  agentDir,
  extensionFactories: [...],
})

// 修改后
const skillsDir = join(cwd, '.pi', 'skills')
const resourceLoader = new piPkg.DefaultResourceLoader({
  cwd,
  agentDir,
  additionalSkillPaths: [skillsDir],  // 新增
  extensionFactories: [...],
})
```

**验收**：服务器启动后日志输出加载的 Skill 列表（含 product-guide + 6 个新 Skill）。

#### 14.3.6 验收

- [ ] 4 个 Skill CLI 命令全部可用，`--json` 输出正常
- [ ] AI 读取 SKILL.md 后能正确调用 CLI
- [ ] 服务器 piBridge 启动后加载所有新 Skill（日志可见）
- [ ] 桌面 LocalAgentService 加载所有新 Skill（日志可见）
- [ ] **AI 上下文 token 数对比**：迁移前后 piBridge customTools 数量不变（仍是 29 个），但 AI 通过 Skill 可调用更多业务功能（不增加 customTools）

### 14.4 组件间信息传递（P1，~2d）

#### 14.4.1 ComponentCapability 类型定义

**新建文件**：`shared/types/componentCapability.ts`

```typescript
import { z } from 'zod'

export const ComponentCapabilitySchema = z.object({
  widgetType: z.string(),                    // 组件类型（widget_type）
  displayName: z.string(),
  description: z.string(),                   // 组件功能描述
  api: z.array(z.object({                    // 组件提供的 API
    name: z.string(),
    description: z.string(),
    parameters: z.record(z.unknown()).optional(),
  })).default([]),
  dependencies: z.array(z.string()).default([]),  // 依赖的本地服务名
  version: z.string().default('1.0.0'),
  componentEnv: z.enum(['pure-frontend', 'local-dependent']).default('pure-frontend'),
  crossPlatform: z.boolean().default(true),
  desktopOnly: z.boolean().default(false),
})

export type ComponentCapability = z.infer<typeof ComponentCapabilitySchema>
```

**修改文件**：`server/src/types/index.ts` —— 修正 `DynamicWidgetRow` 补齐 Phase 5 扩展的 4 个字段。

#### 14.4.2 component_capabilities 表

**修改文件**：`server/src/db/schema.ts`

新增表（**注意：不外键引用 dynamic_widgets**，因内置组件 pdfViewer 等不在 dynamic_widgets 表中）：
```sql
CREATE TABLE IF NOT EXISTS component_capabilities (
  widget_type TEXT PRIMARY KEY,  -- 不外键引用 dynamic_widgets（内置组件不在该表）
  display_name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  api JSONB NOT NULL DEFAULT '[]',
  dependencies TEXT[] NOT NULL DEFAULT '{}',
  version TEXT NOT NULL DEFAULT '1.0.0',
  component_env VARCHAR(16) NOT NULL DEFAULT 'pure-frontend',
  cross_platform BOOLEAN NOT NULL DEFAULT TRUE,
  desktop_only BOOLEAN NOT NULL DEFAULT FALSE,
  created_at BIGINT NOT NULL DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT,
  updated_at BIGINT NOT NULL DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT
);
```

#### 14.4.3 CRUD API

**新建文件**：`server/src/routes/componentCapabilities.ts`

路由：
- `GET /api/component-capabilities` —— 列出所有
- `GET /api/component-capabilities/:widgetType` —— 获取单个
- `POST /api/component-capabilities` —— 创建/更新（upsert）
- `PUT /api/component-capabilities/:widgetType` —— 更新
- `DELETE /api/component-capabilities/:widgetType` —— 删除

**修改文件**：`server/src/index.ts` —— 注册路由 `app.use('/api/component-capabilities', componentCapabilitiesRouter)`

#### 14.4.4 query_capabilities 工具

**新建文件**：`server/src/utils/capabilityTools.ts`

```typescript
export const queryCapabilitiesTool: ToolDefinition = {
  name: 'query_capabilities',
  label: '查询组件能力',
  description: '查询所有组件的能力声明（widgetType / displayName / description / api / dependencies）',
  parameters: Type.Object({
    widgetType: Type.Optional(Type.String({ description: '指定组件类型，省略则列出所有' })),
  }),
  execute: async (_toolCallId, params, _signal, _onUpdate, _ctx) => {
    const pool = getPool()
    const widgetType = (params as { widgetType?: string }).widgetType
    const query = widgetType
      ? 'SELECT * FROM component_capabilities WHERE widget_type = $1'
      : 'SELECT * FROM component_capabilities ORDER BY widget_type'
    const result = await pool.query(query, widgetType ? [widgetType] : [])
    return { content: [{ type: 'text', text: JSON.stringify(result.rows) }], details: {} }
  },
}
```

**修改文件**：`server/src/piBridge.ts` —— 在 customTools 数组末尾追加 `queryCapabilitiesTool`。
**修改文件**：`server/src/utils/aiTools.ts` —— `ToolCategory` 类型追加 `'system'` 值；在 AI_TOOL_DEFINITIONS 追加 query_capabilities 元数据（category: 'system'，canDisable: false）。
**修改文件**：`client/desktop/electron/main/localAgent/LocalAgentService.ts` —— 在 toolNames 数组追加 `'query_capabilities'`，同步更新注释计数 25→26。
**修改文件**：`client/desktop/src/utils/wsToolHandlers.ts` —— 在 executeToolCall 的 switch 增加 `query_capabilities` 分支（通过 fetch 调服务器 `/api/component-capabilities`，参数 widgetType 可选）。**否则本地 agent 模式下 AI 调此工具会返回 'unknown tool'**。

#### 14.4.5 组件自注册逻辑

**修改文件**：`server/src/routes/dynamicWidgets.ts` 的 POST 处理器

创建/更新 dynamic_widget 时，同步 upsert 到 component_capabilities 表（基础信息从 dynamic_widgets 复制，api/dependencies 默认空数组，待组件运行时主动声明）。

**修改文件**：`client/desktop/src/registry/builtIn.tsx`

为 9 个内置组件添加能力声明（静态注册）：
- pdfViewer：阅读 PDF 文件，翻页，文本选择
- musicPlayer：播放音乐，播放列表管理
- focusTimer：专注计时，番茄钟
- aiAssistant：AI 对话
- latexQuiz：LaTeX 出题
- calculator：科学计算
- sudoku：数独游戏
- htmlCanvas：HTML 画布
- webPage：网页嵌入

**新建文件**：`client/desktop/src/registry/capabilityRegistry.ts`

```typescript
import type { ComponentCapability } from 'shared/types/componentCapability'

const capabilityRegistry = new Map<string, ComponentCapability>()

export function registerCapability(cap: ComponentCapability): void { ... }
export function getCapability(widgetType: string): ComponentCapability | undefined { ... }
export function getAllCapabilities(): ComponentCapability[] { ... }
export async function syncCapabilitiesToServer(): Promise<void> { ... }  // 启动时调用
```

**修改文件**：`client/desktop/src/main.tsx` —— 启动时调 `syncCapabilitiesToServer()` 同步到服务器。

#### 14.4.6 验收

- [ ] `ComponentCapability` 类型定义存在，含 zod schema
- [ ] `component_capabilities` 表存在，CRUD API 可用
- [ ] `query_capabilities` 工具注册在 piBridge customTools + LocalAgentService toolNames
- [ ] 9 个内置组件有静态能力声明
- [ ] 启动时同步能力声明到服务器（验证 `SELECT * FROM component_capabilities` 有 9 条记录）
- [ ] AI 调 `query_capabilities` 工具能返回组件能力列表
- [ ] `DynamicWidgetRow` 类型已修正（含 4 个扩展字段）

### 14.5 知识库预留接口（P2，~1d）

> **状态**：已实施（2026-06-29）。本节为已完成任务的记录，验证即可。

#### 14.5.1 知识库 Skill 接口规范

**新建文件**：`.pi/skills/knowledge-cli/SKILL.md`

仅定义接口规范，不实现 CLI：
```yaml
---
name: knowledge-cli
description: 知识库 Skill（预留接口，未实现）。让 AI 能 ingest/search/list/delete/lint 知识库文档
version: 0.1.0
status: stub
---

# knowledge-cli — 知识库 Skill（预留接口，未实现）

## 状态
**本 Skill 仅为接口规范，CLI 尚未实现。** 调用任何命令会返回 501 Not Implemented。

## 计划命令（未实现）
- `knowledge-cli ingest <file|url>` —— 导入文档
- `knowledge-cli search <query>` —— 检索
- `knowledge-cli list` —— 列出所有文档
- `knowledge-cli delete <id>` —— 删除
- `knowledge-cli lint` —— 检查知识库完整性

## 计划数据模型
（详见 shared/types/wiki.ts）
```

#### 14.5.2 知识库数据模型预留

**新建文件**：`shared/types/wiki.ts`

```typescript
import { z } from 'zod'

export const WikiPageSchema = z.object({
  id: z.string(),
  title: z.string(),
  content: z.string(),
  sourceId: z.string().nullable(),
  tags: z.array(z.string()).default([]),
  createdAt: z.number(),
  updatedAt: z.number(),
})

export const WikiSourceSchema = z.object({
  id: z.string(),
  type: z.enum(['pdf', 'web', 'markdown', 'text']),
  url: z.string().nullable(),
  filePath: z.string().nullable(),
  metadata: z.record(z.unknown()).default({}),
  createdAt: z.number(),
})

export const WikiRelationSchema = z.object({
  id: z.string(),
  fromPageId: z.string(),
  toPageId: z.string(),
  type: z.enum(['references', 'related', 'derived_from']),
  weight: z.number().default(1.0),
})

export type WikiPage = z.infer<typeof WikiPageSchema>
export type WikiSource = z.infer<typeof WikiSourceSchema>
export type WikiRelation = z.infer<typeof WikiRelationSchema>
```

#### 14.5.3 知识库路由预留

**新建文件**：`server/src/routes/wiki.ts`

```typescript
import { Router } from 'express'
const router = Router()

// 所有路由返回 501 Not Implemented
router.get('/', (_req, res) => res.status(501).json({ error: 'Wiki API not implemented (Phase 14.5 stub)' }))
router.post('/', (_req, res) => res.status(501).json({ error: 'Wiki API not implemented' }))
router.get('/:id', (_req, res) => res.status(501).json({ error: 'Wiki API not implemented' }))
router.put('/:id', (_req, res) => res.status(501).json({ error: 'Wiki API not implemented' }))
router.delete('/:id', (_req, res) => res.status(501).json({ error: 'Wiki API not implemented' }))
router.post('/search', (_req, res) => res.status(501).json({ error: 'Wiki API not implemented' }))

export { router as wikiRouter }
```

**修改文件**：`server/src/index.ts` —— 注册路由 `app.use('/api/wiki', wikiRouter)`

#### 14.5.4 验收

- [ ] `.pi/skills/knowledge-cli/SKILL.md` 存在且标记 status: stub
- [ ] `shared/types/wiki.ts` 存在，3 个 zod schema 定义完整
- [ ] `/api/wiki/` 路由存在，所有端点返回 501
- [ ] `curl http://localhost:3456/api/wiki/` 返回 501 + JSON 错误

## 五、Skill 编译与构建

### 5.1 统一构建脚本

**新建文件**：`scripts/build-skills.mjs`

遍历 `.pi/skills/*/tsconfig.json`，调用 `tsc` 编译每个 Skill 的 `cli.ts` → `cli.js`。

**修改文件**：`package.json` 添加脚本：
```json
{
  "scripts": {
    "build:skills": "node scripts/build-skills.mjs",
    "build:all": "npm run build && npm run build:skills"
  }
}
```

### 5.2 每个 Skill 的 tsconfig.json

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "esModuleInterop": true,
    "strict": true,
    "outDir": "./",
    "rootDir": "./",
    "skipLibCheck": true
  },
  "include": ["cli.ts"]
}
```

## 六、风险与对策

| 风险 | 对策 |
|------|------|
| Skill CLI 通过 fetch 调服务器 API，但服务器未启动时失败 | CLI 启动时检查 `http://localhost:3456/api/health`，未启动时返回明确错误提示 |
| fs-cli 安全沙箱被绕过（软链接、相对路径） | `fs.realpath` 解析后校验；拒绝包含 `..` 的路径 |
| docker-cli 在未装 Docker 的机器上失败 | CLI 启动时检查 `docker --version`，未装时返回明确错误 |
| 服务器 piBridge 加载 Skill 失败（路径错误） | 启动日志输出加载的 Skill 列表，失败时 warn 但不阻塞 |
| component_capabilities 表迁移失败 | schema.ts 用 `CREATE TABLE IF NOT EXISTS` 幂等 |
| 内置组件能力声明与实际不符 | 启动时调 `syncCapabilitiesToServer()`，覆盖服务器旧数据 |
| Skill CLI 编译产物过大 | 每个 CLI 独立 tsconfig，仅编译 cli.ts，不打包依赖 |

## 七、实施顺序（推荐）

1. **14.5 知识库预留接口**（最简单，1d）—— 先做 stub
2. **14.4 组件能力声明**（2d）—— 类型 + 表 + API + 工具 + 自注册
3. **14.1 文件系统 Skill**（3d）—— CLI + 沙箱 + 审计
4. **14.2 Docker Skill**（2d）—— CLI + docker-compose.ai.yml
5. **14.3 工具 Skill 化**（5d）—— 4 个 CLI + 服务器 Skill 加载修复
6. **构建脚本 + 集成验证**

## 八、回归测试

- 606+ 现有单元测试全绿
- 新增模块测试：
  - fs-cli 沙箱校验单测
  - docker-cli 命令解析单测
  - 4 个 Skill CLI HTTP 调用单测（mock fetch）
  - component_capabilities CRUD 集成测试
  - query_capabilities 工具单测
- E2E 验证（Playwright MCP）：
  - AI 通过 fs-cli 读取项目文件
  - AI 通过 docker-cli 列出容器
  - AI 调 query_capabilities 返回组件能力

## 九、发布任务（沿用 Phase 10）

- [ ] `npm run build` 成功
- [ ] `npm run build:skills` 成功（所有 Skill CLI 编译）
- [ ] `npm run build:win` 生成 exe 安装包
- [ ] git commit + tag（版本号 0.9.0 → 0.10.0）

## 十、验收清单（汇总）

### 14.1 文件系统
- [ ] fs-cli Skill 目录 + SKILL.md + cli.ts + cli.js 存在
- [ ] `ls/read/write/mkdir/rm/mv/cp/stat` 8 个命令全部可用
- [ ] `--json` 输出正常
- [ ] 安全沙箱：白名单外操作被拒绝，C 盘系统目录不可访问
- [ ] 审计日志正常记录

### 14.2 Docker
- [ ] docker-cli Skill 目录 + SKILL.md + cli.ts + cli.js 存在
- [ ] `ps/up/down/logs/run/exec` 6 个命令全部可用
- [ ] `docker-compose.ai.yml` overlay 文件存在
- [ ] 容器加入 `living-dashboard-net` 网络

### 14.3 工具 Skill 化
- [ ] canvas-cli/memory-cli/life-cli/music-cli 4 个 Skill 目录 + SKILL.md + cli.ts + cli.js 存在
- [ ] 所有 CLI 命令 `--json` 输出正常
- [ ] 服务器 piBridge 配置 `additionalSkillPaths`，加载所有新 Skill（日志可见）
- [ ] 桌面 LocalAgentService 加载所有新 Skill（日志可见）

### 14.4 组件能力声明
- [ ] `ComponentCapability` 类型定义存在，含 zod schema
- [ ] `component_capabilities` 表 + CRUD API 可用
- [ ] `query_capabilities` 工具注册在 piBridge + LocalAgentService
- [ ] 9 个内置组件有静态能力声明
- [ ] 启动时同步能力到服务器
- [ ] `DynamicWidgetRow` 类型修正

### 14.5 知识库预留
- [ ] `knowledge-cli` SKILL.md 存在（status: stub）
- [ ] `shared/types/wiki.ts` 类型定义存在
- [ ] `/api/wiki/` 路由骨架存在，返回 501

### 构建 + 回归
- [ ] `npm run build` 成功
- [ ] `npm run build:skills` 成功
- [ ] 606+ 单元测试全绿
- [ ] 新增模块测试全绿
- [ ] E2E 验证通过
- [ ] `npm run build:win` 生成 exe
