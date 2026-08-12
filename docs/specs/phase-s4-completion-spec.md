# Phase S4 收尾 Spec（P0 + P1）

> 生成日期：2026-06-28
> 范围依据：[roadmap_server_v1.md](../roadmap_server_v1.md) Phase S4 验收清单第 10 项未闭环 + 核查报告 P0/P1 问题
> 架构依据：[architecture_refactor.md](../architecture_refactor.md) 第九章 9.1-9.5
> 状态：待实施
>
> **目的**：闭环 S4 验收清单全部 10 项，将 roadmap 第 490 行的 `[ ]` 改为 `[x]`

---

## 一、项目背景

### 1.1 现状

S4 主体功能（ai_settings / user_skills / tool_settings 三张表 + API 配置 + Skills CRUD + 工具管理 + sanitize）已实现并 commit 到 master（`c170a00`）。但存在以下未闭环项：

| 类别 | 问题 | 影响 |
|------|------|------|
| **P0-1** | `sanitizeSkillContent` 仅去控制字符 + 限长度，未做 prompt injection 检测 | 违反 spec 9.5 节"Skills 内容审查（防止注入恶意指令）" |
| **P0-2** | `architecture_refactor.md` 第九章仍写"API Key 存 auth.json"，实际存 `ai_settings` DB 表 | spec 与实现不一致，误导后续开发 |
| **P0-3** | S4 验收第 10 项"Docker 镜像构建 + 迁移脚本执行成功"未验证 | 验收清单未闭环 |
| **P1-1** | `docker-compose.yml` 缺 `PI_API_ENDPOINT` 环境变量 | 容器内无法配置自定义 endpoint |
| **P1-2** | `tool_settings` 表混用（工具启用状态 + skill 启用状态存同一表） | 数据模型耦合，靠应用层 `isValidToolName` 过滤区分 |
| **P1-3** | `test-connection` 超时 10s 偏短 | reasoning 模型首次调用可能需 20-30s，误报失败 |

### 1.2 不在本次范围

- ❌ server 目录 vitest 单测（属 S8 范围）
- ❌ 远程生产服务器部署（属 S7 范围，本次仅本地 Docker 构建验证）
- ❌ Skills 目录可配置额外路径（spec 9.3.3 节，可作为独立小功能后续做）
- ❌ 版本化 migration 文件结构（schema.ts 已幂等，版本化结构属 S8 范畴）
- ❌ `getEnabledCustomTools` 缓存优化（性能优化，非 S4 验收项）
- ❌ `sanitizeApiKey` 字符白名单扩展（当前 4 个 provider 兼容，扩展时再说）
- ❌ `GET /api/tools/:name` 单工具详情查询（轻微性能优化，非 spec 必需）

---

## 二、详细方案

### 2.1 P0-1：sanitizeSkillContent 增强 prompt injection 检测

**文件**：`server/src/utils/sanitize.ts`

**当前实现**（L49-58）：仅 `stripControlChars` + 长度限制。

**改造方案**：在 `sanitizeSkillContent` 中追加 `detectPromptInjection` 检测，检测到危险模式时抛出 `INVALID_INPUT` 错误。同时新增独立的 `detectPromptInjection` 函数（导出，便于 `sanitizePromptInput` 复用）。

**检测规则**（基于 OWASP Prompt Injection Prevention 与常见攻击模式，使用**精确正则匹配**避免误报）：

```typescript
/**
 * 检测 prompt injection 攻击模式
 * 检测到危险模式返回错误描述字符串（用于抛错 message），未检测到返回 null
 *
 * 检测规则（大小写不敏感，使用正则 + 上下文匹配，避免误报）：
 *
 * 1. 指令劫持（必须含"指令/instructions"上下文词）：
 *    - /忽略以上.{0,20}指令/
 *    - /ignore (all )?(previous|above) instructions/
 *    - /forget (all|previous) (instructions|rules)/
 *    - /disregard (all|previous) (instructions|rules)/
 *
 * 2. 角色越权（必须含明确越权动作词）：
 *    - /you are now (a|an|the) /i   （"you are now a different assistant"）
 *    - /new role\s*:/i
 *    - /act as (if|a|an|the) /i     （"act as if you were" "act as a hacker"）
 *    - /pretend to be (a|an|the) /i
 *    - /disregard your (role|instructions|rules)/i
 *
 * 3. 系统提示词泄漏（必须含"system prompt/instructions/rules"目标词）：
 *    - /show (me )?(your )?(system prompt|instructions|rules)/i
 *    - /reveal (your )?(system prompt|instructions|rules)/i
 *    - /print (your )?(system prompt|instructions|rules)/i
 *    - /what (is|are) your (system prompt|instructions|rules)/i
 *
 * 4. 越权指令（必须含"rules/restrictions/system"目标词）：
 *    - /do not follow (your )?(rules|instructions)/i
 *    - /override (the )?(system|rules|instructions)/i
 *    - /you have no (restrictions|rules|limits)/i
 *
 * 5. 数据外泄（必须含"conversation/data/content"目标词 + "external/send/post"动作）：
 *    - /send (this|the) conversation to /i
 *    - /exfiltrate (the )?(data|conversation|content)/i
 *    - /post (this|the) (to|on) external /i
 *
 * 注意：仅做基本检测，无法覆盖所有变体。配合 LLM 自身防御 + 服务端沙箱。
 * 关键词使用上下文匹配（必须同时含动作词 + 目标词），避免误报正常中文/英文表达。
 */
export function detectPromptInjection(s: string): string | null
```

**导出说明**：`detectPromptInjection` 导出用于未来 S8 阶段的单元测试文件导入（`server/src/__tests__/sanitize.test.ts`）。

**应用范围**：
- `sanitizeSkillContent`：检测到 injection 抛 `Error('skill content contains potential prompt injection pattern: <reason>')`
- `sanitizePromptInput`：同样追加检测（提示词也不应含 injection）
- `sanitizeShortText`：**不检测**（名称/描述太短，关键词误报率高）

**误报控制**：
- 检测规则用正则 + 上下文匹配（必须同时含动作词 + 目标词），避免误报正常 markdown 文档
- 例如"请勿忽略以上步骤"不会匹配（不含"指令/instructions"），"act as a helper library" 不会匹配（"act as" 后必须跟 if/a/an/the，"helper library" 不是单一对象）
- 关键词列表保守（仅明确攻击模式），不扩展到含糊词
- 单元测试覆盖：合法 skill 内容（含 markdown 代码块、"请勿忽略以上步骤"等正常表达）必须通过；明确攻击模式（"忽略以上所有指令"、"you are now a..."、"show your system prompt"）必须拒绝

**回归风险**：现有用户 skill 若含明确攻击模式会被拒绝。处理：返回明确错误信息（含匹配到的规则类型），用户修改后重新提交。

### 2.2 P0-2：回写 spec 与代码不一致的文档

**目标**：把所有写"API Key 存 auth.json"的活跃文档统一改为"存 ai_settings DB 表"。历史归档 spec（已落地的 phase 文档）保留原样但在 9.6 节注明"以本文档为准"。

**修改文件清单**（必须全部修改）：

| 文件 | 行号 | 当前内容 | 改为 |
|------|------|---------|------|
| `docs/architecture_refactor.md` | L443 | `API Key \| 对应 provider 的 API Key \| 服务器 auth.json（不存客户端）` | `API Key \| 对应 provider 的 API Key \| 服务器 ai_settings 表（key=pi.api_key，不存客户端）` |
| `docs/architecture_refactor.md` | L447 | `**注意**：API Key 存服务器（auth.json），客户端不持有。客户端通过 UI 修改时，经服务器 API 保存到 auth.json。` | `**注意**：API Key 存服务器 ai_settings 表（key=pi.api_key），客户端不持有。客户端通过 UI 修改时，经服务器 `PUT /api/ai/settings` 保存到 ai_settings 表。piBridge 启动时从 ai_settings 读取并注入到运行时 AuthStorage。` |
| `docs/architecture_refactor.md` | L509 | `- **API Key 不存客户端**：客户端 UI 修改 API Key 时，经服务器 API 保存到 auth.json，客户端不持有` | `- **API Key 不存客户端**：客户端 UI 修改 API Key 时，经服务器 `PUT /api/ai/settings` 保存到 ai_settings 表（key=pi.api_key），piBridge 启动时读取并注入运行时 AuthStorage，客户端不持有` |
| `docs/architecture_refactor.md` | L686 | `28 个工具` | `29 个工具`（S9 已追加 4 个搜索工具） |
| `docs/architecture_refactor.md` | L834 | `28 个工具` | `29 个工具` |
| `docs/roadmap_server_v1.md` | L484 | `[x] API Key 存 auth.json，客户端不持有` | `[x] API Key 存 ai_settings DB 表（key=pi.api_key），客户端不持有` |

**保留不改的文件**（历史归档 spec，在 9.6 节统一注明）：
- `docs/specs/phase3-server-spec.md` L1878/L1880（S0 阶段 spec，已落地）
- `docs/specs/phase4-product-form-architecture.md` L782/L791/L802（桌面端 Phase 4 spec）
- `docs/specs/phase-m8-mobile-light-agent.md` L27（移动端 Phase M8 spec）
- `docs/specs/ai-search-spec.md` L32（S9 spec，引用 auth.json 是上下文说明）
- `docs/roadmap_desktop_v1.md` L97、`docs/roadmap_mobile_v1.md` L1631（桌面/移动端 roadmap，描述客户端侧行为）

**新增章节**（`docs/architecture_refactor.md` 9.6 节"实现说明"，放在 9.5 节后）：

```markdown
### 9.6 实现说明（S4 落地后修订）

实际实现相比 9.3.1 节有如下演进：

| 项 | spec 原方案 | 实际实现 | 原因 |
|----|------------|---------|------|
| API Key 存储 | auth.json | ai_settings DB 表（key=pi.api_key） | DB 比文件更易多端共享、审计、备份；与 model/endpoint 同表便于原子更新 |
| AuthStorage | 持久化 | 仅运行时容器（piBridge 启动时从 DB 注入） | 单一数据源（DB），避免双写 |

**关于 auth.json 文件**：`piBridge.ts` 中 `AuthStorage.create(...auth.json)` 仍会创建 auth.json 文件作为 AuthStorage 库的运行时载体，但 API Key 的持久化源已改为 ai_settings DB 表。piBridge 启动时从 ai_settings 读取并通过 `setRuntimeApiKey()` 注入到 AuthStorage；auth.json 文件不再作为持久化源，开发者调试时应以 ai_settings 表为准。

**历史 spec 文档**：phase3-server-spec.md / phase4-product-form-architecture.md / phase-m8-mobile-light-agent.md / ai-search-spec.md 等历史 spec 中关于"API Key 存 auth.json"的描述不再准确，以本节为准。
```

**验收范围**：`architecture_refactor.md` + `roadmap_server_v1.md` 全文搜索 `auth.json` 仅在 9.6 节"实现说明"和历史说明上下文中出现；其他活跃文档不增加新的 auth.json 描述。

### 2.3 P0-3：Docker 镜像构建 + 迁移脚本本地验证

**步骤**：

1. **Docker 镜像构建**：`docker-compose build server`（Windows PowerShell）
2. **启动 PostgreSQL + 服务器**：`docker-compose up -d`
3. **等待 healthy**：`docker-compose ps`（postgres healthcheck 通过 + server 启动）
4. **运行迁移脚本**：`docker-compose exec server npm run migrate`（schema.ts `initializeSchema()` 幂等执行）
5. **验证表结构**：`docker-compose exec postgres psql -U livingdashboard -d living_dashboard -c "\dt"` 应列出 ai_settings / user_skills / tool_settings（迁移后还应含 skill_settings）
6. **验证 API 响应**：`curl http://localhost:3456/api/health` 应返回 200；`curl -H "Authorization: Bearer $SERVER_TOKEN" http://localhost:3456/api/tools` 应返回 29 个工具
7. **再次运行迁移脚本**：验证幂等（无报错、无重复创建）
8. **清理**：`docker-compose down`（不删除数据卷）

**验收标准**：
- 镜像构建成功（无错误）
- 容器启动后 `docker-compose ps` 显示 `living-dashboard-server` 状态 `Up`
- `\dt` 显示所有预期表
- `/api/health` 返回 200
- `/api/tools` 返回工具列表
- 第二次运行 `npm run migrate` 不报错

### 2.4 P1-1：docker-compose.yml 添加 PI_API_ENDPOINT

**文件**：`docker-compose.yml`

**修改点**：在 `server` 服务的 `environment` 块（L47-56）追加：

```yaml
      PI_API_ENDPOINT: ${PI_API_ENDPOINT:-}
```

放在 `PI_API_KEY` 之后，与 `PI_MODEL` / `PI_API_KEY` 同组。

**同步修改**：

1. **`.env.example`**：追加 `PI_API_ENDPOINT=` 注释行（如未存在）。`.env.example` 在 `.gitignore` 之外（可 commit），但真实 `.env` 在 `.gitignore` 中（不 commit）。
2. **`server/src/routes/aiSettings.ts`**：当前 L139 已读取 `process.env.PI_API_ENDPOINT`（`const rawEndpoint = endpoint || settings.endpoint || process.env.PI_API_ENDPOINT`），无需改动。
3. **`server/src/db/aiSettingsStore.ts`**：**无需改动**。`getAiSettings()` 只从 DB 读取 endpoint，无 env fallback 逻辑；env fallback 已在 `aiSettings.ts` L139（test-connection 路由）和 `piBridge.ts` L1090（piBridge 启动时）实现。

### 2.5 P1-2：拆分 tool_settings 表（新增 skill_settings）

**目标**：消除 `tool_settings` 表混用问题。

**子步骤顺序**：5a schema.ts 加表+迁移SQL → 5b skills.ts 改 → 5c tools.ts 改 → 5d 运行时验证

**文件**：

1. **`server/src/db/schema.ts`**：
   - **新增表定义**：在 `SCHEMA_SQL` 字符串里，`tool_settings` 表定义之后（L187 附近）追加：
     ```sql
     CREATE TABLE IF NOT EXISTS skill_settings (
       skill_id VARCHAR(64) PRIMARY KEY,
       enabled BOOLEAN DEFAULT TRUE,
       updated_at BIGINT NOT NULL
     );
     ```
     字段长度用 `VARCHAR(64)` 与 `tool_settings.tool_name` / `user_skills.id` 保持一致。
   - **数据迁移 SQL**：放在 `SCHEMA_SQL` 字符串里 `skill_settings` 表定义之后，参考 L210-223 `dynamic_widgets` 扩展的 `DO $$ BEGIN ... END $$` 幂等模式：
     ```sql
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
     ```
   - **不动 `initializeSchema()` 函数本身**：该函数只执行 `SCHEMA_SQL` 字符串 + 设置 schema_version，迁移 SQL 已在字符串里。

2. **`server/src/routes/skills.ts`**：
   - `getSkillEnabledStates()`（L140-153）：从 `tool_settings` 改为 `skill_settings`，字段名 `tool_name` 改为 `skill_id`
   - `setSkillEnabled()`（L158-166）：从 `tool_settings` 改为 `skill_settings`，字段名 `tool_name` 改为 `skill_id`，`ON CONFLICT (tool_name)` 改为 `ON CONFLICT (skill_id)`

3. **`server/src/routes/tools.ts`**：
   - **保留** L31 `isValidToolName(row.tool_name)` 过滤作为**防御性编程**（注释说明"迁移后理论上不需要，保留作为兜底，防止迁移部分失败时脏数据污染 /api/tools 响应"）
   - `isValidToolName` 写入校验保留（防止脏数据）

**回归风险**：
- 现有用户的 skill 启用状态会自动迁移到新表
- `tool_settings` 表清理后，客户端查 `/api/tools` 不再返回 skill 记录（之前也是过滤掉的，行为不变）
- 即使迁移部分失败，`isValidToolName` 过滤仍能保证 `/api/tools` 响应干净

**迁移幂等验证**：
- 第一次执行：`tool_settings` 中的 skill 记录 → 插入 `skill_settings` → 删除 `tool_settings` 中的 skill 记录
- 第二次执行：`tool_settings` 已无 skill 记录，INSERT 0 行，DELETE 0 行，无报错

### 2.6 P1-3：test-connection 超时 10s → 30s

**文件**：`server/src/routes/aiSettings.ts`

**修改点**：L165 `timeoutMs: 10_000` → `timeoutMs: 30_000`

**理由**：
- reasoning 模型（step-3.7、deepseek-r1）首次调用可能 20-30s
- 10s 误报失败率高，影响用户体验
- 30s 是 OpenAI/Anthropic SDK 默认超时下限，业界可接受

**运行时验证**：用 `stepfun/step-3.7-flash`（默认模型）+ 至少一个 reasoning 模型（如 `deepseek/deepseek-chat`）测试，确认 30s 内能完成首次调用。如果 reasoning 模型仍超时，考虑后续按 model 类型动态调整（本次不实现，记录为 P2 后续优化）。

---

## 三、实施顺序

| 步骤 | 任务 | 并行性 |
|------|------|--------|
| 1 | P0-2 回写 spec（修改 architecture_refactor.md 5 处 + roadmap_server_v1.md 1 处 + 新增 9.6 节） | 可与 P1-1/P1-3 并行 |
| 2 | P1-1 docker-compose.yml + .env.example 加 PI_API_ENDPOINT | 可与 P0-2/P1-3 并行 |
| 3 | P1-3 test-connection 超时调整（独立小改动） | 可与 P0-2/P1-1 并行 |
| 4 | P0-1 sanitize 增强（含 detectPromptInjection 函数 + 精确正则） | 独立 |
| 5a | P1-2 schema.ts 加 skill_settings 表 + 数据迁移 SQL（DO $$ BEGIN 模式） | 依赖前序无冲突 |
| 5b | P1-2 skills.ts 改 getSkillEnabledStates / setSkillEnabled 操作 skill_settings | 依赖 5a |
| 5c | P1-2 tools.ts 保留 isValidToolName 过滤 + 加防御性注释 | 依赖 5a |
| 5d | P1-2 运行时验证（数据迁移幂等 + 两表数据不互相污染） | 依赖 5a/5b/5c |
| 6 | TypeScript 编译验证（`npm run build` 0 error） | 依赖 1-5 全部完成 |
| 7 | P0-3 Docker 构建验证（必须所有代码改完后） | 串行 |
| 8 | 更新 roadmap_server_v1.md S4 验收清单第 10 项 `[ ]` → `[x]` | 依赖 P0-3 通过 |
| 9 | 对抗审查（含运行时验证） | 串行 |
| 10 | git commit | 串行 |

---

## 四、验收标准

### 4.1 P0-1 sanitize 增强

- [ ] `detectPromptInjection` 函数实现，覆盖 5 类攻击模式（用精确正则 + 上下文匹配）
- [ ] `sanitizeSkillContent` 调用 `detectPromptInjection`，检测到抛错
- [ ] `sanitizePromptInput` 调用 `detectPromptInjection`，检测到抛错
- [ ] `sanitizeShortText` **不**调用 `detectPromptInjection`（避免误报）
- [ ] 运行时验证：
  - 合法 skill 内容通过（含 markdown 代码块、"请勿忽略以上步骤"、"act as a helper library" 等正常表达）
  - 明确攻击模式拒绝（"忽略以上所有指令"、"you are now a..."、"show your system prompt"、"ignore all previous instructions"）

### 4.2 P0-2 spec 回写

- [ ] `architecture_refactor.md` L443/L447/L509/L686/L834 修改完成（5 处）
- [ ] `roadmap_server_v1.md` L484 修改完成（1 处）
- [ ] 新增 `architecture_refactor.md` 9.6 节"实现说明"（含 auth.json 文件仍存在的说明 + 历史 spec 文档声明）
- [ ] `architecture_refactor.md` + `roadmap_server_v1.md` 全文搜索 `auth.json` 仅在 9.6 节"实现说明"和历史说明上下文中出现（其他活跃文档不增加新的 auth.json 描述）

### 4.3 P0-3 Docker 验证

- [ ] `docker-compose build server` 成功
- [ ] `docker-compose up -d` 后 `living-dashboard-server` 状态 `Up`
- [ ] `docker-compose exec server npm run migrate` 成功
- [ ] `psql \dt` 显示 ai_settings / user_skills / tool_settings / skill_settings
- [ ] `curl /api/health` 返回 200
- [ ] `curl /api/tools` 返回 29 个工具（带 SERVER_TOKEN）
- [ ] 第二次 `npm run migrate` 不报错（幂等）

### 4.4 P1-1 docker-compose 环境变量

- [ ] `docker-compose.yml` `server.environment` 含 `PI_API_ENDPOINT`
- [ ] `.env.example` 含 `PI_API_ENDPOINT=` 注释
- [ ] 运行时验证：`docker-compose up` 后容器内 `echo $PI_API_ENDPOINT` 与宿主机一致

### 4.5 P1-2 拆分 skill_settings 表

- [ ] `schema.ts` 含 `skill_settings` 表定义（VARCHAR(64) 与现有规范一致）
- [ ] `schema.ts` 含数据迁移 SQL（DO $$ BEGIN 模式，从 tool_settings 迁移到 skill_settings）
- [ ] `skills.ts` `getSkillEnabledStates` / `setSkillEnabled` 操作 `skill_settings` 表（字段名 skill_id）
- [ ] `tools.ts` 保留 `isValidToolName` 过滤 + 加防御性注释（不删，作为兜底）
- [ ] 验证 `AI_TOOL_DEFINITIONS` 中无工具名以 `builtin:` 或 `user:` 开头（确认 LIKE 过滤不会误迁工具记录）
- [ ] 运行时验证：
  - 启用/禁用 skill → 查 `skill_settings` 表有记录
  - 启用/禁用 tool → 查 `tool_settings` 表有记录
  - 两个表数据不互相污染
  - 数据迁移幂等（重复执行不报错）

### 4.6 P1-3 test-connection 超时

- [ ] `aiSettings.ts` L165 `timeoutMs: 30_000`
- [ ] 运行时验证：用 `stepfun/step-3.7-flash`（默认模型）+ 至少一个 reasoning 模型（如 `deepseek/deepseek-chat`）测试 `/api/ai/test-connection`，30s 内能完成首次调用

---

## 五、对抗审查清单

### 5.1 代码审查

- [ ] 所有修改文件 TypeScript 编译通过（`npm run build` 0 error）
- [ ] `detectPromptInjection` 规则无遗漏（5 类全覆盖）
- [ ] `detectPromptInjection` 误报率可控（合法 skill 内容不误报）
- [ ] `skill_settings` 表数据迁移 SQL 幂等
- [ ] `tool_settings` 表清理 SQL 不误删工具记录
- [ ] docker-compose 改动不破坏现有服务

### 5.2 运行时验证

- [ ] Docker 镜像构建 + 容器启动 + 迁移成功
- [ ] API 响应正常（/api/health, /api/tools, /api/skills）
- [ ] sanitize 拒绝攻击模式 + 通过合法内容
- [ ] skill_settings 表独立 + 数据迁移成功
- [ ] 迁移脚本幂等

### 5.3 文档一致性

- [ ] spec 与代码一致（auth.json → ai_settings）
- [ ] roadmap 验收清单闭环
- [ ] .env.example 与 docker-compose.yml 一致

---

## 六、约束条件

- **TypeScript 优先**：所有代码改动用 TypeScript
- **不下载到 C 盘**：Docker 数据卷挂载到 F 盘
- **Docker 部署**：保持 docker-compose 一键管理
- **git 版本管理**：所有变更走 git commit
- **不破坏现有功能**：所有修改保持向后兼容
- **迁移幂等**：所有 schema 变更支持重复执行

---

## 七、依赖与风险

### 7.1 依赖

- S4 主体功能已完成（commit `c170a00`）
- S9 搜索工具已完成（commit `dea5dbc`，不冲突）
- Docker Desktop 可用（本地已安装）

### 7.2 风险

| 风险 | 概率 | 影响 | 缓解 |
|------|------|------|------|
| `detectPromptInjection` 误报率高 | 中 | 用户合法 skill 被拒 | 关键词保守、单元测试覆盖合法用例 |
| `skill_settings` 数据迁移失败 | 低 | skill 启用状态丢失 | 迁移前备份 tool_settings 表；迁移 SQL 幂等 |
| Docker 构建失败 | 低 | 验收阻塞 | 先 `npm run build` 确保编译通过 |
| 现有用户 skill 含攻击关键词 | 低 | 升级后无法保存 | 提示明确错误信息，用户修改后重试 |
