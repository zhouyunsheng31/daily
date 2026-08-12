# Phase S8：AI 自动化测试 Spec

> 生成日期：2026-07-04
> 架构依据：[architecture_refactor.md](../architecture_refactor.md) 第二/三/四/九/十三章
> Roadmap：[roadmap_server_v1.md](../roadmap_server_v1.md) Phase S8（行 291-376）
> 前置依赖：Phase S1/S2/S4 已落地 ✅

---

## 一、项目目的与上下文

Living Dashboard 服务器是 AI 推理 + 数据同步 + 多端协作的中心。当前服务器 AI 相关模块测试覆盖率 0%，仅有的 26 个测试文件均为 tsx 脚本式端到端验证（需手动启动 dev server），无单元测试、无测试框架、无 CI。

Phase S8 目标：补齐服务器 AI 模块测试覆盖，确保 Pi Agent / WS 网关 / 30 个工具 / DB 迁移 / 协议兼容等核心链路不回归，**核心 AI 模块覆盖率 ≥ 70%**。

### 1.1 现状

- `server/package.json` 无 `test` 脚本、无 vitest 依赖
- `server/test/` 26 个文件中仅 `piBridge.permission.test.ts` 用 vitest（但因 vitest 未安装实际跑不起来）
- 无 `vitest.config.ts` / `vite.config.ts` / `tsconfig.spec.json`
- `server/tsconfig.json` 的 `include: ["src/**/*"]` 不包含 test 目录
- 现有 tsx 脚本测试有自定义 `ok()` / `assert()` helper（每个文件复制粘贴，无共享模块）

### 1.2 约束

- **TypeScript 优先**：测试代码用 TypeScript
- **不下载到 C 盘**：所有依赖装到 `server/node_modules`（项目在 F 盘）
- **不污染生产 DB**：测试 DB 用 SQLite 临时文件或 testcontainers 临时 PG 容器，绝不连生产
- **不破坏现有 tsx 脚本测试**：保留作为冒烟测试，新增 vitest 套件与之共存
- **生产安全红线**：测试绝不在生产 DB 上跑；测试代码不修改 `.env`

---

## 二、测试策略决策

### 2.1 测试运行器：vitest

**理由**：
- TypeScript 生态一致（与 client/desktop 42 个测试文件一致）
- ESM 原生支持（项目 `"type": "module"`）
- 内置 coverage（@vitest/coverage-v8）
- 与现有 `piBridge.permission.test.ts` 兼容

### 2.2 测试 DB 策略：SQLite 为主 + testcontainers PG 为辅

**主方案：SQLite 临时文件 DB**
- 服务器已有 `DB_DRIVER=sqlite` 模式（`connection-sqlite.ts`），API 与 PG 兼容
- 设置 `SQLITE_PATH=./test-data/test-<random>.db`，每个测试文件独立 DB
- 启动毫秒级，无 Docker 依赖
- 已有 `src/db/test-sqlite.ts` 自检脚本作为基础

**辅方案：testcontainers-node PG（可选）**
- 用于 PG 特有行为测试（JSONB 操作符、部分索引、BIGSERIAL）
- 用 `@testcontainers/postgresql` 启动 `postgres:16-alpine`
- 若 Docker 不可用则跳过（`describe.skipIf(!dockerAvailable)`）
- **不作为 CI 必须项**，避免 Windows Docker 环境不稳定阻塞

**为什么不强制 testcontainers**：
- 用户环境 Windows + Docker Desktop 偶发不稳定
- SQLite 模式已覆盖 90%+ 逻辑（SQL 转换层处理差异）
- 现有 tsx 端到端测试已用真实 PG 验证（保留作为冒烟测试）
- 强制 testcontainers 会让 `npm test` 在无 Docker 环境失败，违反"测试可移植"

### 2.3 Mock 策略

| 模块 | Mock 方式 | 理由 |
|---|---|---|
| `@earendil-works/pi-coding-agent` | `vi.mock()` 拦截 | 顶层 import 会卡住（ESM import CJS） |
| `@earendil-works/pi-ai` | `vi.mock()` 拦截 | 同上 |
| `typebox` | `vi.mock()` 返回 stub | piBridge 顶层用 Type.* 构造 schema |
| `ws` 模块（piBridge 内部用） | `vi.mock('../src/ws.js')` 返回 stub | 隔离 WS 副作用（路径根据测试文件位置调整） |
| `db/aiContext` | `vi.mock()` 返回 stub（persistConversation/restoreSessionContext/persistPiEvent 等） | 避免 aiContext 顶层 import getPool 触发 pg 加载 |
| `db/aiSettingsStore` | `vi.mock()` 返回 stub（getAiSettings/getPromptOverrides/clearPromptCache/getSearchKey 等） | 同上 |
| `utils/aiTools` | `vi.mock()` 返回 stub（AI_TOOL_MAP/DISABLEABLE_TOOL_NAMES） | piBridge 顶层 import |
| `utils/searchTools` | `vi.mock()` 返回 `{ searchTools: [] }` | piBridge 顶层 import |
| `utils/capabilityTools` | `vi.mock()` 返回 `{ queryCapabilitiesTool: {} }` | piBridge 顶层 import |
| `db/connection` | 用真实 SQLite（不 mock） | 测试真实 SQL 行为 |
| 外部 HTTP（GitHub/秘塔/ArXiv API） | `vi.fn()` mock `global.fetch` | 不消耗配额、不依赖网络（替代 roadmap 的 nock，减少依赖） |
| Express app | `supertest` 直接调 app（不监听端口） | 快速、无端口冲突（替代 roadmap 的 mock-websocket，用真实 ws 客户端） |

**与 roadmap 偏离说明**：roadmap S8.1 列了 mock-websocket/nock，本 Spec 用 vitest 内置 `vi.fn()` + 真实 ws 客户端替代，理由是与 client/desktop 测试栈一致、减少依赖。

### 2.4 测试分层

```
单元测试（test/unit/**/*.test.ts）
  ├─ 纯函数测试（无 mock，无 DB）
  └─ 模块逻辑测试（mock 重依赖，可选 SQLite）

集成测试（test/integration/**/*.test.ts）
  ├─ DB 集成（真实 SQLite）
  ├─ 路由集成（supertest + SQLite）
  └─ WS 协议集成（真实 ws server + 客户端）

端到端冒烟测试（保留现有 tsx 脚本，不纳入 vitest）
```

---

## 三、S8.1 测试基础

### 3.1 任务表

| 任务 | 详情 | 验收标准 |
|---|---|---|
| 安装 vitest 依赖 | `npm i -D vitest @vitest/coverage-v8 supertest @types/supertest` | 依赖写入 package.json |
| 新建 `vitest.config.ts` | 配置 test 选项（include/globals/environment/coverage/setupFiles/pool） | `npx vitest run` 能跑 |
| 新建 `tsconfig.spec.json` | `{ extends: "./tsconfig.json", compilerOptions: { noEmit: true, rootDir: "./", declaration: false }, include: ["src/**/*", "test/**/*"] }` | tsc 能识别测试文件 |
| **不修改 tsconfig.json** | 保持 rootDir: "./src"，避免 build 时 tsc 报错 "test 不在 rootDir" + 避免污染 dist/ | `npm run build` 仍通过 |
| npm scripts | 新增 `test` / `test:watch` / `test:unit` / `test:integration` / `test:coverage` | 一键跑全套 |
| 共享 test helpers | `test/helpers/db.ts` / `server.ts` / `env.ts` / `assert.ts` | 可被各测试复用 |
| CI 脚本 | `scripts/ci-test.mjs`（跨平台 Node 脚本，非 shell） | lint + unit + integration + coverage |
| piBridge 导出测试 API | 在 `src/piBridge.ts` 末尾增加 `export const __test = { cleanupDeviceFromOtherPanels, getOrCreatePanelSession, executeViaWs, executeAskUser, handleAskUserResponse, withPanelContext, withCallerWidgetContext, forwardEventToClient, formatErrorMessage, getEnabledCustomTools, getCurrentPanelId, getCurrentCallerWidgetId, rejectAllPending, __resetInternalState }`，`__resetInternalState` 清空所有 8 个模块级 Map（含 permissionPending） | 内部函数可直测 + 测试间状态清理 |

### 3.2 vitest.config.ts 设计

```typescript
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    exclude: ['test/helpers/**', 'test/**/*-script.ts'],  // 排除 helper 和 tsx 脚本式测试
    globals: false,  // 显式 import，避免全局污染
    environment: 'node',
    pool: 'forks',  // 每测试文件独立子进程，process.env 完全隔离
    setupFiles: ['test/helpers/env.ts'],  // 全局前置 setupTestEnv，防止误连生产 PG
    testTimeout: 30_000,  // 30s（DB 测试可能慢；超时路径用 fake timers）
    hookTimeout: 60_000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      // 仅对核心 AI 模块要求覆盖率，避免边缘模块达不到阻塞 CI
      include: [
        'src/piBridge.ts',
        'src/ws.ts',
        'src/utils/**/*.ts',
        'src/db/aiContext.ts',
        'src/db/connection.ts',
        'src/db/schema.ts',
        'src/middleware/auth.ts',
      ],
      exclude: ['src/**/*.d.ts', 'src/db/migrateFromSqlite.ts', 'src/db/test-sqlite.ts', 'src/db/seed.ts'],
      thresholds: {
        // perFile 模式：每个核心模块文件单独达标，避免某文件低覆盖率被全局平均值掩盖
        perFile: true,
        statements: 70,
        branches: 60,
        functions: 70,
        lines: 70,
      },
    },
  },
})
```

**关键决策**：
- `pool: 'forks'`：每测试文件独立子进程，process.env 修改不跨文件污染（解决 M12）
- `setupFiles: ['test/helpers/env.ts']`：全局前置加载 setupTestEnv，确保所有测试文件都先设 `DB_DRIVER=sqlite`（解决 S1 生产安全风险）
- `coverage.include` 只列核心模块：边缘模块（routes/*）不强制覆盖率，避免阻塞 CI（解决 C6）
- `perFile: true`：每个核心模块文件单独达标，避免平均值掩盖（解决 C6）

### 3.3 test helpers 设计

**`test/helpers/env.ts`**：
- `setupTestEnv()`：设置 `DB_DRIVER=sqlite` + `SQLITE_PATH` 临时文件 + `SERVER_TOKEN=test-token` + `NODE_ENV=test`
- `cleanupTestDb()`：删除临时 SQLite 文件
- 必须在 import 任何 src 模块**之前**调用（因为 connection.ts 在模块加载时读 env）

**`test/helpers/db.ts`**：
- `createTestDb()`：初始化 SQLite 临时 DB + `initializeSchema()` + `seedBuiltinTemplates()`，返回 cleanup 函数
- `withTestDb(fn)`：高阶函数，自动 setup/teardown
- `clearAllTables(pool)`：清空所有表数据（保留 schema），用于测试间隔离

**`test/helpers/server.ts`**：
- `createTestApp()`：动态 import `src/index.ts` 的 Express app（不 listen），返回 `{ app, cleanup }`
- 用 supertest 做 HTTP 请求
- 注意：必须 mock piBridge 动态 import（否则会卡住）

**`test/helpers/assert.ts`**：
- `expectOk(res, status=200)`：supertest 响应断言
- `expectJson(res, status=200)`：断言 Content-Type json
- `expectError(res, status, code?)`：错误响应断言

### 3.4 npm scripts

```json
{
  "test": "vitest run",
  "test:watch": "vitest",
  "test:unit": "vitest run --dir test/unit",
  "test:integration": "vitest run --dir test/integration",
  "test:coverage": "vitest run --coverage"
}
```

### 3.5 验收标准

- [ ] `npm test` 能跑通至少 1 个示例测试
- [ ] `npm run test:coverage` 生成 coverage 报告
- [ ] test helpers 可被复用
- [ ] tsconfig 包含 test 目录，IDE 无报错

---

## 四、S8.2 piBridge 单元测试

### 4.1 测试文件

`test/unit/piBridge.test.ts`

### 4.2 测试范围

**说明**：piBridge.ts 大部分关键函数是非导出的内部函数。本 Phase 在 piBridge.ts 末尾增加 `export const __test = { ... }` 导出测试专用 API（见 S8.1 任务表），让测试可直测内部函数。`__resetInternalState` 清空所有 8 个模块级 Map（panelSessions/panelSessionApiConfig/sessionLastUsed/panelActiveDevices/panelOnlineDevices/panelSessionReady/pendingRequests/askUserPending/permissionPending）。

**纯函数测试（通过 __test 直测，无 mock）**：
- `__test.formatErrorMessage(report)`：验证 widget 错误格式化（含/不含 stack/panelId）
- `isSessionReady()`：初始 false，set session 后 true
- `getPanelSessionId(panelId)`：未创建返回 undefined，创建后返回 id
- `setPanelActiveDevice(panelId, deviceId)`：设置后 panelActiveDevices 更新
- `__test.cleanupDeviceFromOtherPanels(deviceId, currentPanelId)`：设备切面板时清理旧面板映射（含 session-only 面板）
- `handlePermissionResponse(msg)`：pending 请求 resolve approved=true/false
- `__test.handleAskUserResponse(msg)`：pending 请求 resolve 选项

**Mock 测试（mock ws + db + 内部状态）**：
- `executeWithPermission(panelId, payload)`：验证 sendToDevice 调用 + 超时 reject（**fake timers** 推进 120s）
- `__test.executeAskUser(panelId, question, options)`：验证 sendToDevice + 超时（**fake timers** 推进 120s）
- `__test.executeViaWs(tool, params, panelId)`：DEVICE_SPECIFIC_TOOLS 路由到活跃设备；无活跃设备 reject；30s 超时 reject（**fake timers** 推进 30s）
- `__test.forwardEventToClient(event, panelId)`：按面板定向广播到 panelOnlineDevices 中的所有设备
- `__test.getEnabledCustomTools()`：从 tool_settings 读取过滤；DB 失败返回全部
- `disposePanelSession(panelId)`：清理所有相关状态（panelSessions/panelActiveDevices/panelOnlineDevices/pendingRequests/askUserPending/permissionPending）
- `disposePiBridge()`：销毁所有面板 session
- `onClientMessage` 分发：user_message/dispose_session/tool_result/ask_user_response/permission_response
- `onClientMessage` session-only 跳过持久化：`session-only:` 前缀的 panelId 不触发 persistConversation/persistPiEvent（mock 验证不被调用）
- `onClientDisconnect`：清理 panelActiveDevices + panelOnlineDevices + pendingRequests
- `setActiveDevice(deviceId)`（@deprecated）：写入所有面板
- `__test.getOrCreatePanelSession` 7 天超时清理：fake timers 推进 7 天 + 触发 cleanupTimer，验证 session 被销毁 + sessionLastUsed 清理

**AsyncLocalStorage 测试（通过 __test 直测）**：
- `__test.withPanelContext(panelId, fn)`：fn 内 `__test.getCurrentPanelId()` 返回 panelId
- `__test.withCallerWidgetContext(widgetId, fn)`：fn 内 `__test.getCurrentCallerWidgetId()` 返回 widgetId
- 并发场景：两个 withPanelContext 并发不污染（Promise.all）

**超时测试规范**：
- 所有超时路径测试**必须**用 `vi.useFakeTimers()` + `vi.advanceTimersByTime()`，禁止真实等待
- 测试结束后 `vi.useRealTimers()` 恢复

**Mock 策略**：
- `vi.mock('@earendil-works/pi-coding-agent')` 返回 stub SessionManager/DefaultResourceLoader/AuthStorage/ModelRegistry
- `vi.mock('@earendil-works/pi-ai')` 返回 stub
- `vi.mock('typebox')` 返回 stub Type.* 构造器
- `vi.mock('../src/ws.js')`（路径根据测试文件位置调整）返回 stub sendToDevice/broadcast/sendToolCall
- `vi.mock('../src/db/aiContext.js')` 返回 stub persistConversation/restoreSessionContext/persistPiEvent
- `vi.mock('../src/db/aiSettingsStore.js')` 返回 stub getAiSettings/getPromptOverrides/clearPromptCache/getSearchKey
- `vi.mock('../src/utils/aiTools.js')` 返回 stub AI_TOOL_MAP/DISABLEABLE_TOOL_NAMES
- `vi.mock('../src/utils/searchTools.js')` 返回 `{ searchTools: [] }`
- `vi.mock('../src/utils/capabilityTools.js')` 返回 `{ queryCapabilitiesTool: {} }`
- 动态 import `../src/piBridge.js`（在 mock 生效后）
- beforeEach 调用 `__test.__resetInternalState()` 清理状态

### 4.3 验收标准

- [ ] 至少 40 个测试用例（piBridge.ts 1549 行，需高覆盖）
- [ ] 覆盖 piBridge.ts 所有 11 个导出函数 + 14 个 __test 导出的内部函数
- [ ] 覆盖 onClientMessage 5 种消息类型分发 + session-only 跳过持久化
- [ ] 覆盖 onClientDisconnect 清理逻辑
- [ ] 覆盖 AsyncLocalStorage 上下文隔离 + 并发不污染
- [ ] 覆盖 permission/ask_user/executeViaWs 超时路径（fake timers）
- [ ] 覆盖 DEVICE_SPECIFIC_TOOLS 路由 + 无设备 reject + 30s 超时
- [ ] 覆盖 getOrCreatePanelSession 7 天超时清理
- [ ] 覆盖 disposePanelSession 清理所有 9 个 Map
- [ ] piBridge.ts 行覆盖率 ≥ 70%

---

## 五、S8.3 ws.ts 协议测试

### 5.1 测试文件

- `test/unit/ws.test.ts`（单元测试，mock clients Map）
- `test/integration/ws-protocol.test.ts`（集成测试，真实 ws server + 客户端）

### 5.2 单元测试范围

- `sendToDevice(deviceId, message)`：设备在线时发送成功；离线返回 false
- `broadcast(message, excludeDeviceId?)`：广播到所有客户端；排除指定设备
- `broadcastChange(event, sourceDeviceId?)`：包装 broadcast
- `sendToolCall(message)`：按 targetDeviceId 路由
- `sendToClient(message)`：发到任一在线客户端
- `hasClient()` / `hasDevice(deviceId)` / `getOnlineDeviceIds()`：查询函数
- `onClientMessage/onClientConnect/onClientDisconnect/onErrorReport`：注册 handler + 返回取消订阅

### 5.3 集成测试范围

- **鉴权**：SERVER_TOKEN 设置时，错误 token 拒绝（close code 1008）；无 token 拒绝；正确 token 通过
- **鉴权**：SERVER_TOKEN 未设置时，开发模式放行
- **心跳**：ping→pong 响应
- **心跳超时**：90s 无 ping，连接被关闭（**fake timers** 推进 90s + 触发 heartbeatCheckTimer）
- **消息分发**：客户端发 user_message，server 端 messageHandler 被调用
- **广播**：多客户端连接，broadcastChange 推送到所有客户端（除 source）
- **断开清理**：客户端断开，clients Map 清理 + disconnectHandler 调用
- **重连竞态**：同 deviceId 新连接替换旧连接，旧连接 close 不清理新连接状态
- **重连恢复**：客户端断开后用相同 panelId 重连，restoreSessionContext 从 DB 恢复对话历史（roadmap S8.6 离线降级/重连恢复）
- **多端并行**：≥2 客户端连不同 panelId 并发 user_message，验证 panelSessions 互不污染、AI 思考流定向广播到正确面板（roadmap S8.6 多端并行）
- **代理请求**：sendProxyRequest 路由到目标设备；30s 超时 reject（fake timers）；目标设备 WS 断开时 reject + pendingProxyRequests 清理（通过 close 客户端 WS 触发 handleDeviceDisconnect）
- **error_report 路由**：客户端发 error_report，errorReportHandler 被调用

### 5.4 测试方法

- 单元测试：直接操作 `clients` Map（通过内部函数暴露或重新设计为可测）
- 集成测试：用 `http.createServer` + `ws.WebSocketServer` 启动真实 server，用 `ws.WebSocket` 客户端连接
- 用 `await new Promise(resolve => setTimeout(resolve, 50))` 等待异步消息

### 5.5 验收标准

- [ ] 单元测试 ≥ 10 个用例
- [ ] 集成测试 ≥ 11 个用例（鉴权 3 + 心跳 2 + 消息分发 1 + 广播 1 + 断开 1 + 重连竞态 1 + 重连恢复 1 + 多端并行 1）
- [ ] 覆盖重连竞态场景
- [ ] 覆盖重连恢复场景（roadmap S8.6）
- [ ] 覆盖多端并行场景（roadmap S8.6）
- [ ] 覆盖代理请求超时 + 设备断开 reject
- [ ] 覆盖心跳超时 90s（fake timers）
- [ ] SERVER_TOKEN 鉴权三种路径（设置/未设置/错误）
- [ ] ws.ts 行覆盖率 ≥ 70%

---

## 六、S8.4 30 个工具单元测试

> **注**：roadmap S8.4 原列"24 个工具（browser_*/widget_*/storage_*）"，实际 aiTools.ts 已增至 30 个（Phase 14 新增 query_capabilities，Phase S9 新增 4 个搜索工具）。本 Spec 以实际 30 个为准，roadmap 待同步。

### 6.1 测试文件

- `test/unit/aiTools.test.ts`（工具元数据一致性）
- `test/unit/searchTools.test.ts`（3 个外部搜索工具 execute；local_search 在 piBridge.ts 通过 WS 路由，归 S8.2 测）
- `test/unit/searchApi.test.ts`（外部 API 调用 + 纯函数）

### 6.2 aiTools.ts 元数据测试

- `AI_TOOL_DEFINITIONS` 长度 = 30
- 每个工具的 name/label/description/category/canDisable 字段非空
- `AI_TOOL_MAP` 与 DEFINITIONS 一致（每个 name 都映射）
- `DISABLEABLE_TOOL_NAMES` 与 `canDisable=true` 的工具一致（28 个）
- `isValidToolName(name)`：合法名返回 true；非法名（空/含特殊字符/不存在）返回 false
- 分类计数：widget 4 / storage 2 / browser 18 / interaction 1 / search 4 / system 1
- ask_user / query_capabilities 的 canDisable=false

### 6.3 searchTools.ts execute 测试（3 个工具）

> **注**：searchTools.ts 只导出 3 个工具（webSearchTool/academicSearchTool/githubSearchTool）。localSearchTool 定义在 piBridge.ts，通过 WS 路由到客户端，归 S8.2 测试。

**webSearchTool.execute**：
- mock `getSearchKey('metaso')` 返回 key → mock `callMetaso` 返回结果 → 验证返回 `{content:[{type:'text',text:JSON.stringify(result)}], details:{}}`
- mock `getSearchKey` 返回 null → 抛错"未配置秘塔 API Key"
- mock `callMetaso` 抛错 → 验证 `logApiUsage` 被调用 with status='error'，并 re-throw
- 成功路径 → 验证 `logApiUsage` 被调用 with status='ok'
- 验证 `_credits` 字段被移除

**academicSearchTool.execute**：
- mock `callArxiv` 返回结果 → 验证返回格式
- mock `callArxiv` 抛错 → 验证 logApiUsage status='error'
- `sortBy: 'relevance' | 'lastUpdatedDate' | 'submittedDate'` 三种排序参数透传给 `callArxiv`（academicSearchTool 实际只调 callArxiv，不调 SemanticScholar；SemanticScholar 已被 S10 替换为 ArXiv）
- 成功路径 → 验证 logApiUsage status='ok'

**githubSearchTool.execute**：
- mock `getSearchKey('github')` 返回 key → mock `callGitHub` 返回结果 → 验证返回格式
- 7 个 mode（search_repos/search_code/search_users/search_issues/download_release/download_file/download_repo_zip）
- mock `getSearchKey` 返回 null → 抛错"未配置 GitHub API Key"
- 验证 endpoint 命名 `mode.replace(/_/g, '-')`

### 6.4 searchApi.ts 纯函数测试

- `extractFileName(contentDisposition)`：
  - `attachment; filename="test.zip"` → `test.zip`
  - `attachment; filename=test.zip` → `test.zip`
  - `null` → 默认名
  - `attachment; filename*=UTF-8''%E4%B8%AD%E6%96%87.zip` → 解码
- `buildGithubProxyUrl(params)`：
  - 构造完整 URL（含 SERVER_BASE_URL 或 localhost fallback）
  - type=zip/asset/file 三种
- `parseArxivAtomXml(xmlText)`：
  - 解析标准 Atom feed → papers 数组
  - 提取 title/authors/pdfLink/arxivId/publicationDate
  - 空结果 → papers=[]
- `extractArxivId(idUrl)`：
  - `http://arxiv.org/abs/2401.12345v1` → `2401.12345v1`
  - 非 arxiv URL → 原样返回
- `extractRepoFullName(repositoryUrl)`：
  - `https://github.com/owner/repo` → `owner/repo`
  - 非 github URL → 空

### 6.5 searchApi.ts retryWithBackoff 测试

- fn 成功 → 返回结果，不重试
- fn 抛 NetworkError → 重试 3 次（1s/2s/4s 退避，用 fake timers）
- fn 抛 HttpError(429) + retry-after → 重试
- fn 抛 HttpError(500) → 重试
- fn 抛 HttpError(400) → 不重试，直接抛出
- fn 重试 3 次仍失败 → 抛最后一次错误

### 6.6 验收标准

- [ ] aiTools 元数据测试 ≥ 8 个用例（含分类计数硬性验收）
- [ ] searchTools execute 测试 ≥ 9 个用例（3 工具 × 3 路径）
- [ ] searchApi 纯函数测试 ≥ 15 个用例
- [ ] retryWithBackoff 测试 ≥ 6 个用例
- [ ] 所有外部 API 调用均 mock，不发起真实网络请求

---

## 七、S8.5 DB 迁移脚本测试

### 7.1 测试文件

`test/integration/db-migration.test.ts`

### 7.2 测试范围

**幂等性测试（核心）**：
- 调用 `initializeSchema()` 两次，第二次不报错
- 第一次后所有表存在；第二次后表结构不变
- 验证 schema.ts 中所有 CREATE TABLE 语句对应的表都存在（表数 ≥ 23；用动态解析或维护预期表名数组，避免硬编码过时）
- 验证所有索引存在
- 验证 ALTER 列存在（dynamic_widgets 4 列、api_usage_log.credits_consumed、entity_conflict_logs.panel_id）

**回滚测试（roadmap S8.5 验收）**：
- 项目实际用幂等模式（CREATE TABLE IF NOT EXISTS + DO $$ ALTER IF NOT EXISTS），**没有 up/down migration 版本管理**
- 验证策略：删除某 ALTER 列后重新调 initializeSchema()，列被重新添加（模拟"回滚到无列状态再迁移"）
- 验证删除某表后重新调 initializeSchema()，表被重建（schema 不依赖已有数据）
- 与 roadmap 偏离说明：roadmap 要求"DOWN 脚本"，但项目架构用幂等模式，DOWN 脚本无意义（删列会丢数据，违反生产安全红线）

**seed 测试**：
- `seedBuiltinTemplates()` 插入 4 个内置模板
- 重复调用不报错（ON CONFLICT DO NOTHING）
- 模板 id 为 `builtin-study` / `builtin-work` / `builtin-relax` / `builtin-review`

**skill_settings 迁移测试**：
- 预置 tool_settings 中 `builtin:xxx` / `user:xxx` 记录
- 调用 `initializeSchema()`
- 验证 skill_settings 表有对应记录，tool_settings 中无 `builtin:` / `user:` 前缀记录

**旧 search key 清理测试**：
- 预置 ai_settings 中旧 key：`searchKey.bocha` / `search_key_bocha` / `searchKey.semanticScholar` / `search_key_semantic_scholar`
- 调用 `initializeSchema()`
- 验证旧 key 全部被删除（M14：补 semanticScholar）

**aiContext.ts 持久化与恢复测试（M5/M6/M9）**：
- `persistConversation(panelId, role, content)`：写入 ai_conversations 表，验证字段
- `persistPiEvent(panelId, event)`：处理 `message_end`（assistant）+ `tool_execution_end` 事件，写入 ai_conversations；`session-only:` 前缀面板跳过
- `getRecentConversations(panelId, limit)`：返回最近 N 条（retention_level='full'）
- `restoreSessionContext(session, panelId)`：预置 >60000 字符对话历史，验证从头部裁剪至 ≤60000；memories 8000 字符上限
- `runRetentionCleanup()`：预置 30 天前对话 → summarize；90 天前 summary → extract memories（mock LLM 调用）

**SQL 转换层测试（SQLite 模式，与 test-sqlite.ts 重叠但纳入 vitest 统一管理）**：
- `$1/$2 → ?` 转换
- `::jsonb` / `::BIGINT` 类型转换剥离
- `ANY($N)` → `IN (?, ?)` 展开
- 数组参数 JSON 序列化
- JSONB 列读出时自动 JSON.parse

### 7.3 测试方法

- 用 SQLite 临时 DB（`DB_DRIVER=sqlite` + `SQLITE_PATH=./test-data/test-migration-<random>.db`）
- 直接调 `initializeSchema()` + 查 `sqlite_master` / `PRAGMA table_info()` 验证
- 用 `pg` Pool API（SQLite 兼容层）做 SQL 操作

### 7.4 验收标准

- [ ] 幂等性测试通过（initializeSchema 两次调用不报错）
- [ ] 表数 ≥ 23，关键表全部存在
- [ ] 所有索引存在
- [ ] ALTER 列存在
- [ ] 回滚测试通过（删列/删表后重新迁移可恢复）
- [ ] seed 4 个模板正确插入
- [ ] skill_settings 迁移正确
- [ ] 旧 search key（bocha + semanticScholar）被清理
- [ ] aiContext.ts 持久化与恢复测试通过（persistConversation/persistPiEvent/restoreSessionContext 60000 上限/runRetentionCleanup）
- [ ] SQL 转换层测试通过

---

## 八、S8.6 集成测试

### 8.1 测试文件

- `test/integration/api.test.ts`（路由集成）
- `test/integration/server.test.ts`（服务器启动 + 健康检查）

### 8.2 路由集成测试（supertest + SQLite）

> **broadcastChange 副作用处理**：路由集成测试不 mock ws.ts，clients Map 为空时 broadcast 是 no-op 无副作用；如需验证广播调用，用 `vi.spyOn(ws, 'broadcastChange')` 断言调用次数和参数。

**健康检查**：
- `GET /api/health` 返回 200 + `{ status: 'ok' }`

**鉴权**：
- SERVER_TOKEN 设置时，无 Authorization → 401
- SERVER_TOKEN 设置时，错误 token → 401
- SERVER_TOKEN 设置时，正确 token → 200
- SERVER_TOKEN 未设置时，开发模式放行

**panels 路由**：
- `POST /api/panels` 创建面板 → 201
- `GET /api/panels` 列出面板 → 200
- `GET /api/panels/:id` → 200 / 404
- `PUT /api/panels/:id` 更新 → 200 / 404
- `DELETE /api/panels/:id` 删除 → 200 / 404（验证 session 清理 + 事务）

**widgets 路由**：
- `POST /api/widgets` 创建（带 panel_id）→ 201
- `GET /api/widgets?panelId=xxx` → 200
- `PUT /api/widgets/:id` 更新 → 200；version 不匹配 → 409
- `DELETE /api/widgets/:id` → 200

**entities 路由**：
- `POST /api/entities` 创建 → 201
- `GET /api/entities?type=xxx` → 200
- `PUT /api/entities/:id` 更新（带 expectedVersion）→ 200；冲突时 INSERT entity_conflict_logs
- `DELETE /api/entities/:id` → 200

**tools 路由**：
- `GET /api/tools` → 200，返回 30 个工具
- `PUT /api/tools/:name` 禁用工具 → 200；canDisable=false → 400
- `POST /api/tools/reset` → 200

**aiSettings 路由**：
- `GET /api/ai/settings` → 200，hasApiKey 字段
- `PUT /api/ai/settings` 更新 → 200
- `POST /api/ai/test-connection`（mock callLlm）→ 200

**searchKeys 路由**：
- `GET /api/search/keys` → 200，不含明文 key
- `PUT /api/search/keys/:provider` → 200；invalid provider → 400

**syncLogs 路由**：
- `PUT /api/sync/logs` upsert → 200；参数校验 → 400
- `GET /api/sync/logs` → 200
- `GET /api/sync/logs/failed` → 200
- `POST /api/sync/logs/:id/retry` → 200 / 500（unsupported entityType）

**entityConflicts 路由**：
- `GET /api/entities/conflicts` → 200
- `POST /api/entities/conflicts/:id/resolve` → 200；invalid action → 400

**dynamicWidgets 路由**：
- `POST /api/dynamic-widgets` → 201；invalid componentEnv → 400
- `GET /api/dynamic-widgets?desktop=false` → 200
- `PUT /api/dynamic-widgets/:widgetType` → 200 / 404
- `DELETE /api/dynamic-widgets/:widgetType` → 200 / 404

**localServices 路由**：
- `POST /api/local-services/register` → 201；invalid endpoint（file://）→ 400
- `POST /api/local-services/heartbeat` → 200
- `GET /api/local-services/list` → 200

### 8.3 服务器启动测试

- `main()` 启动后 `GET /api/health` 200
- `NODE_ENV=production` + 无 SERVER_TOKEN → `process.exit(1)`：用 `vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('__EXIT__') })`，try/catch 捕获（避免真的退出测试进程）
- 优雅关闭（SIGINT/SIGTERM）：发信号验证 closeDb 被调用

### 8.4 AI 真实调用测试（roadmap S8.6 验收）

- `describe.skipIf(!process.env.TEST_LLM_API_KEY)` 跳过无 key 环境
- 用占位 key（`TEST_LLM_API_KEY` 环境变量，不进 git）
- 测试 `handleUserMessage(panelId, content)` 真实调 LLM，验证返回非空回复
- 测试 `/api/ai/test-connection` 端点真实调 LLM
- 默认 CI 跳过（不消耗配额），本地手动 `TEST_LLM_API_KEY=xxx npm test` 时跑

### 8.5 验收标准

- [ ] 健康检查测试通过
- [ ] 鉴权测试 4 种路径通过
- [ ] 主要路由（panels/widgets/entities/tools/aiSettings/searchKeys/syncLogs）测试通过，每路由 ≥ 3-5 用例
- [ ] 乐观锁冲突（widgets PUT 409）测试通过
- [ ] 实体冲突日志写入测试通过
- [ ] 服务器启动 + 健康检查测试通过
- [ ] 生产环境 SERVER_TOKEN 强制测试通过（不真的退出进程）
- [ ] 优雅关闭测试通过
- [ ] AI 真实调用测试用例存在（skipIf 无 key 时跳过，不阻塞 CI）
- [ ] 路由集成测试用例 ≥ 50 个

---

## 九、S8.7 文档同步

### 9.1 任务

| 任务 | 详情 | 验收标准 |
|---|---|---|
| 更新 package.json scripts | test/test:watch/test:unit/test:integration/test:coverage | 一键跑 |
| 在 `server/README.md` 增加"测试"章节 | 测试运行说明 + 环境配置 + CI 集成（不新建 TESTING.md，遵循用户规则"NEVER proactively create documentation files"） | 开发者能跑 |
| 更新 `docs/roadmap_server_v1.md` | S8 状态标记完成 + 完成内容摘要 | 文档与代码一致 |

> **注**：用户规则"NEVER proactively create documentation files (*.md)"，因此不新建 `TESTING.md`，改为在已有 README.md 增加"测试"章节。如果 server/README.md 不存在，则仅在 package.json scripts + roadmap 更新。

### 9.2 README.md "测试"章节内容

- 前置条件：Node 22+ / npm 10+ / Windows 需 Visual Studio Build Tools（better-sqlite3 编译）
- 安装依赖：`cd server && npm install`
- 运行测试：`npm test` / `npm run test:unit` / `npm run test:integration`
- 覆盖率：`npm run test:coverage`
- 测试 DB 策略说明（SQLite 临时文件，不连生产 PG）
- AI 真实调用测试：`TEST_LLM_API_KEY=xxx npm test`（可选）
- 添加新测试指南

### 9.3 验收标准

- [ ] npm scripts 可一键运行
- [ ] README.md "测试"章节存在且内容完整（或 server/README.md 不存在时跳过）
- [ ] roadmap S8 状态更新

---

## 十、对抗审查清单

### 10.1 Spec 审查点

- [ ] 测试 DB 策略是否可行（SQLite 是否覆盖关键路径）
- [ ] Mock 策略是否完整（pi-coding-agent 顶层 import 是否被拦截）
- [ ] 测试隔离是否充分（每个测试文件独立 DB / 状态清理）
- [ ] 覆盖率阈值 70% 是否合理（核心模块 vs 边缘模块）
- [ ] 是否有遗漏的关键场景（如 AsyncLocalStorage 并发、重连竞态）
- [ ] testTimeout 30s 是否足够（SQLite 启动 + schema 初始化）
- [ ] 现有 tsx 脚本测试是否被破坏
- [ ] 生产安全红线是否遵守（不连生产 DB）

### 10.2 实现审查点

- [ ] vitest.config.ts 配置正确（include/exclude/coverage）
- [ ] test helpers 可复用（无重复代码）
- [ ] mock 模式正确（vi.mock 在 import 之前）
- [ ] 测试用例覆盖所有导出函数
- [ ] 运行时验证：`npm test` 全绿
- [ ] 运行时验证：`npm run test:coverage` 达到 70% 阈值
- [ ] 无误报（测试通过但实际有 bug）
- [ ] 无漏报（测试失败但代码正确）

---

## 十一、估时与里程碑

| 子任务 | 用例数（估） | 优先级 |
|---|---|---|
| S8.1 测试基础 | - | P0（基础） |
| S8.2 piBridge | 40+ | P0 |
| S8.3 ws.ts | 21+（10 单元 + 11 集成） | P0 |
| S8.4 工具 | 38+（8 + 9 + 15 + 6） | P1 |
| S8.5 DB 迁移 + aiContext | 20+ | P1 |
| S8.6 集成 | 50+ | P1 |
| S8.7 文档 | - | P2 |
| **合计** | **169+** | - |

---

## 十二、风险与缓解

| 风险 | 缓解措施 |
|---|---|
| pi-coding-agent mock 不完整导致测试卡住 | 参考现有 `piBridge.permission.test.ts` mock 模式；用 `vi.mock` 拦截所有顶层 import |
| SQLite 与 PG 行为差异掩盖 bug | 保留现有 tsx 端到端测试（真实 PG）作为冒烟测试；testcontainers PG 作为可选补充 |
| coverage 70% 阈值过高导致阻塞 | 仅对 `src/piBridge.ts` / `src/ws.ts` / `src/utils/*` / `src/db/aiContext.ts` 核心模块要求 70%，其他模块不强制 |
| testTimeout 30s 不够 | hookTimeout 60s；SQLite 启动 <1s，应足够 |
| Windows 路径问题 | 用 `path.join` / `resolve` 而非硬编码分隔符 |
| better-sqlite3 原生模块编译 | 已在 dependencies，npm install 时自动编译；CI 需装 python3/make/g++ |

---

## 十三、不在本 Phase 范围

- 移动端测试（属移动端 Phase）
- 桌面端测试（属桌面端 Phase）
- 性能测试 / 压力测试（属长期优化）
- 安全渗透测试（属安全审查）
- E2E 浏览器自动化测试（已有 tsx 脚本 + Playwright MCP，不纳入 vitest）
- 真实 LLM 调用测试（需 API Key，属手动验证）
