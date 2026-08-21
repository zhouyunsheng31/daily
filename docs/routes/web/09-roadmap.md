# 09 · web 路线里程碑、交付清单与并行计划

> 每个任务带**交付清单**与**验收标准**；每个 W 完成 commit 一次（禁止多里程碑混提交）。
> 交付要求见 README §7（代码/测试/契约/文档/验证/回滚/红线七条，缺一不可）。
> 并行原则：**契约先行（W0）解锁双路线并行**；跨路线依赖一律"fixtures/mock 先行、真实联调随后"。

## 0. 里程碑总览

| # | 里程碑 | 目标 | 阻塞谁 | 状态 |
|---|---|---|---|---|
| W0 | 契约基线 | schema/词汇表/fixtures/守卫就位 | 双路线一切后续 | ✅ 2026-08-20 |
| W-F | 文件服务一阶段 | files 元数据 + manifest/blob 端点 + 双写 | 移动端 M1-7 同步 | ✅ 2026-08-20 |
| W1 | 包体系 | packages 三表 + 全类型流水线 + 校验反馈回路 | 移动端 M2 包客户端 | ✅ 2026-08-21 |
| W2 | App API | handler runtime + 端点 + AI 工具化 + 文档页（owner） | 移动端 M2 API 镜像 | 🚧 服务端核心+前端 2026-08-21（剩 Playwright 回归） |
| W3 | 市场 + public 管道 | 发布/审核/依赖闭包/计费/审计（public） | 移动端市场消费端增强 | ✅ 服务端核心上线 2026-08-21（剩 UI：商店模板 type 维度 / WS 实时 / app 适配） |
| W4 | 系统包化 + 桌面模板 V2 | theme/skill/bundle/UI 子包 + 桌面 V2（R7） | 移动端 M1-4 桌面消费 | ⏳ |
| W5 | 增强 | toolpkg/mcp/provider/subagent/url-app | 移动端 M2 同类镜像 | ⏳ |
| W6 | 生态（后置评审） | 联机 shared / workflow / 联邦评估 | — | ⏳ |

## 1. 任务分解（交付清单 + 验收）

### W0 · 契约基线（预估 2–4 天；双路线共同前提）——✅ 已完成（2026-08-20）

- **交付**：`shared/webos-contracts/packages/`（`daily.pkg.json` v2 + `api.json` TypeBox schema）；能力词汇表 `capabilities.ts`（26 词）；fixtures（合法/非法各 ≥10 例）；服务端校验器 `webos/contracts/`；CI 守卫（fixtures 反序列化测试）。✅
- **验收**：服务端校验器对 fixtures 全过（45/45 绿）；移动端 Kotlin DTO + 同款 fixtures 反序列化测试可建（移动端可**立即并行**启动，不等服务端实现）。⚠️ Kotlin DTO 待移动端路线接续。
- **架构决策（落地经验）**：server `tsconfig rootDir=./src` 不能直接 import shared 的 `.ts`（TS6059）→ schema/capabilities 生成**纯 JSON 快照**（`daily-pkg.schema.json` / `api.schema.json` / `capabilities.json`）提交 Git；服务端校验器 JSON import（不受 rootDir 限制）+ typebox 1.x `Check` 校验纯 JSON schema 通过；快照由 `server/scripts/gen-contract-schemas.mjs` 幂等生成。

### W-F · 文件服务一阶段（预估 3–5 天；可与 W1 并行）——✅ 已完成（2026-08-20）

- **交付**：`server/src/webos/files/`（files/file_versions 表 + manifest/blob/分块端点 + snapshot）；agent_fs 双写适配（行为不变）；reconcile 任务；单测（双写一致性/冲突/etag）。✅
- **验收**：07 §5 用例全过（10/10 单测：双写/manifest 契约/分块语义/reconcile 对齐/快照）；manifest 结构与 shared fixtures 一致（`shared/webos-contracts/files.ts`）；线上回归待部署后实测。⚠️ blob 内容寻址块后置（file_versions 存 sha256 引用，恢复内容待 blobs）。
- **解锁**：移动端 M1-7 文件同步（拿到 manifest 锚点即可开工）。
- **架构决策（落地经验）**：manifest 契约走 shared TS（R6/R7），服务端本地常量（rootDir 限制）+ shared 值守卫；reconcile 只标记「未删除且磁盘不存在」的行（含 stale 元数据清理），不物理删行（回收站语义）。

### W1 · 包体系（预估 1–2 周；核心）——✅ 已完成（2026-08-21）

- **交付**：packages/package_versions/package_installs 三表 + 迁移（只读适配视图，不动现有 apps state）；`webos/packages.ts` 端点族；daily.pkg.json 校验器接入；**文件夹即包泛化**（AI 写包目录 → 识别 type → 校验 → 版本）；**校验反馈回路**（人话错误随 agent_fs_write 工具结果回流）；包事务（校验不过不建版本）。✅
- **落地形态**：`server/src/webos/packages/`（db/service/router/index 四件套）；工作区新增 `packages/<id>/` 顶层目录；REST 端点族 `GET/POST /packages`、`/packages/:id`、`/packages/:id/versions|active-version|rollback`、`DELETE /packages/:id`、`/packages/:id/files/raw/*`；app 只读适配视图（GET /packages 合并 type=app）。
- **验收**：03 §4 流水线全通；AI 创建 theme 包 + skill 包全程无需人工干预（18/18 单测覆盖，含「写错 3 次内靠校验反馈自行修正」闭环）；版本/回滚/审计齐。✅
- **边界记录**：`type=app` 仍走 apps/（文件夹即 App 单轨）；raw 端点 W1 仅 owner+安装态（W4 执行引擎按类型再开放免鉴权）；包内容恢复（非 manifest 文件）依赖 W2 执行引擎按版本重建（当前指针语义）。
- **架构决策（落地经验）**：JSON 存 TEXT 列时，**SQLite 驱动会把 JSON 列自动反序列化为对象/数组**（PG 返回字符串）——所有「读 JSON 文本」的 mapper 必须容忍两种形态（`parseJsonText`：非字符串原样返回，字符串才 JSON.parse），否则 `JSON.parse(null/对象)` 会把 manifest/audit 读成 `{}`/`[]` 导致幂等失效、审计为空（packages-db 曾踩坑）；三表 id 全局唯一 + owner_key，权限初版四交集求交时以 owner/installed 为先。

### W2 · App API（预估 2–3 周；核心 ⭐）——🚧 服务端核心已完成（2026-08-21）

- **交付（已完成）**：`webos/appapi.ts`（loadApiSpecs/registerDynamicTools/invokeEndpoint）+ `webos/apiRuntime.ts`（vm 池 + 超时/截断/白名单 ctx）；`POST /webos/api/appapi/:ns/:ep`；计费 kind='api'（`webos_api_usage` 表）；secrets 存 `appStorage[<id>]['__api_secrets__']`；必测族单测 20/20（沙箱逃逸/越权/超时/截断/SSRF/secrets 脱敏/计费+用例 A）。
- **待续（仍在 W2）**：Playwright 线上回归（真实账号，用例 A/D）；用例 C 依赖 W3 市场。
- **架构决策（落地经验）**：受限 vm 沙箱必须 **null-prototype**（`Object.create(null)`）阻断 `this.constructor.constructor('return process')` 逃逸（普通 `{}` 会桥接宿主 realm，真机验证逃逸成功）；`withTimeout` 的 rejection 必须透传（否则 handler 抛错被误判超时，secrets 脱敏失效）；deps 用 setAppApiDeps 注入（webos.ts ←→ appapi 防循环）。
- **解锁**：移动端 M2 端侧 handler runtime 镜像（消费同一 api.json/handler 契约）。

### W3 · 市场 + public 管道（✅ 完成上线，2026-08-21；核心 ⭐）

- **已完成（2026-08-21 互通原语 v1 切片，`server/src/webos/net/`）**：共享数据空间（net_spaces/持久化 KV 乐观版本 409）+ 事件总线（net_events，afterSeq 增量 + to=handle 定向 + **`?wait=` 长轮询实时**）；三种可见性模式 public-ro/open/invite + owner 按 handle 邀请成员；`resolveHandle` 注册用户名寻址（R13 游客排除，不引入 guest deviceId）；REST `/webos/api/net/spaces*`；单测 13/13。
- **互通 ②（已完成 2026-08-21，`webos_api_public` 发布索引 + `invokeEndpoint` public 分支）**：owner 发布含 public 端点的命名空间 → 注册用户按 namespace 跨用户调用（属主 storage 执行 + 调用者计费 R15 + 游客拒 R13）；`POST/GET /appapi/:namespace/publish|unpublish|status`；appapi-public 6/6。
- **统一包市场（已完成 2026-08-21，`server/src/webos/market/`）**：`market_entries`/`market_installs` 两表；发布（owner + api ≥1 public 端点 + **静态扫描**明文密钥/Bearer/硬编码拒发带人话 issues）；浏览/详情（数据范围+安装态）；安装（**依赖闭包** BFS ≤3 层 + semver range 匹配全通过才落库）；skill 复制 SKILL.md 到调用者 skills/；pi 工具 `search_market_packages`/`install_market_package`；market 9/9。
- **收尾三件（已完成 + 部署 2026-08-21，R14 全链路线上）**：① 事件总线长轮询（service `eventPollWait` waitMs≤30s + router `?wait=`）；② 宿主 SDK 市场适配（api.ts 5 个 market clients + runtime `StoreSdkAdapters` 扩 5 + `market.*` 分发 + App.tsx buildStoreAdapters 接线）；③ 商店模板「统一包市场」type 维度 UI（`tab-market` + type chips 全部/API/技能/主题/工具包/App + 详情弹层含数据范围/安装态/R15 计费提示 + 我的安装 + App 只读适配）。
- **验收**：✅ 04 §6 用例 B 全过（甲发布 → 乙安装 → 乙调用 → 计费/审计落库）；静态扫描拦截用例过；AI 找包闭环；九模块 **132/132** 全绿（W0 45 + desktopLayout 8 + W-F 10 + W1 18 + W2 20 + W2-sdk 3 + appapi-public 6 + net 13 + market 9）；公网上线（bootstrap/market 200、游客 R13 401、SSE 链路通）。
- **边界**：发布者分成、第三方开放投稿、内容治理**不做**（社区运营后置）。
- **隔空互通设计要点（2026-08-21 用户提问沉淀，强调「通用原语，不按业务造专用 API」）**：
  - **寻址**：账号已有唯一内部键（`guest:<deviceId>` / `user:<userId>`），是隔离键而非公开地址；互通加一层**公开别名层**（注册用户名 handle + 分享/邀请链接）由服务端路由到 user_key，不暴露内部 uuid。**游客排除在互通体系外（R13，2026-08-21 拍板）**——寻址只用注册用户名 handle，不引入 guest deviceId 寻址。
  - **通用互通原语（平台级，业务只是用法不同）**：不做「聊天 API / 游戏 API」这类按业务定制的专用接口，而是三个**通用原语**：
    1. **跨用户共享数据（shared data space）**——包内声明可共享的命名空间（授权细分：公开读 / 白名单用户读写 / 按写入规则），服务端持久化、长期存。→ 论坛=「公开读+多人写」的共享命名空间；五子棋=对局房间状态（谁都能读、走子按规则写）。
    2. **跨用户消息/事件（message/event bus）**——服务端转发的跨用户投递（from/to 用 handle 寻址），WS 实时 + 拉取兜底。→ 聊天=消息流；五子棋=走子事件流广播给房间双方；论坛=新帖/回复事件推给关注者。
    3. **跨用户受限执行（public endpoint）**——在「属主数据 + 调用者参数」上跑 W2 受限 handler；承载落库校验 / 权限 / 版主操作等业务逻辑。
  - **组合式包承载（D19）**：业务包 = **一个组合式包同时装 App UI + api.json（端点只是调用原语的入口）+ skill（规则/自动化）+ assets**，children 嵌套 ≤3 层；同一个包对平台是「一个可安装/可版本/可回滚/可审计的自包含单元」。聊天 / 五子棋 / 论坛都只是「包的声明 + UI + 规则」不同，全都搭在同样的互通原语上。
  - **用户发现**：首版**通过包/命名空间发现 + 邀请/分享链接**，不建公开用户目录（隐私+滥用）；已有 `/daily/exp/ap-*` 单 App 分享底子可扩展为「邀请即互通」。

### W4 · 系统包化 + 桌面模板 V2（预估 2 周）

- **交付**：theme/skill/bundle/pet-layer（web 最小）类型执行引擎；`webos/desktopLayout.ts` + `webosDesktopV1 → V2`（多页/边缘翻页/文件夹）；生成体验补强（实时预览 + 自检循环 + 逐轮快照描述）；design tokens 契约（shared）。
- **skill 包执行引擎（「AI 调用包」闭环）**：包内 `SKILL.md`（type=skill / 组合式 contents.skills）注册进 pi skillsDir → AI **装包即获得技能**，对话内直接调用；原本的 skill（用户工作区/系统全局）迁移为包形态（R15 要求：skill 也进包）。
- **系统能力包 + 调用者计费（R15）**：生图/生视频/对话/搜索等平台能力封装为系统包（声明制端点 + 统一计费目录）；**计费租户 = 调用者账号**——App/端点/Agent 任何触发都从实际触发者扣积分，禁止借用/汇聚到包属主账号，系统密钥永不下发。
- **验收**：08 §6 全过（PWA 与 Android WebView 行为一致——联合移动端 M1-4 验收）；生成体验对标项逐条过；skill 装包即被 AI 用（对话内可调）；他人 App 触发系统能力时扣的是**调用者本人**积分（双账号验证）。

### W5 · 增强（预估 3–4 周，按需）

- toolpkg（服务端沙箱工具包双层注册）、mcp（服务端 MCP client）、provider（注册表 + 适配参数）、subagent（服务端 in-process + 并发池）、url-app（iframe 直连/快照）。
- 各项独立验收；与移动端 M2 同类镜像并行。

### W6 · 生态（后置，启动前重新评审）

- 联机房间（shared visibility 开启）、workflow 引擎、联邦 API 网络评估、user-pays 评估。

## 2. 与移动端并行清单（确保双线可并行）

> 原则：**W0 契约先行**后，两路线在各自轨道上并行；跨路线依赖全部"fixtures/mock 先行、真实联调随后"，任何一条线不被另一条线阻塞超过一个任务粒度。

| 移动端任务 | 依赖的 web 产出 | 并行策略（移动端不等 web 完成的做法） |
|---|---|---|
| M1-2 端侧 AI（harness + BYOK） | 无 | **完全独立**，立即开工 |
| M1-3 App 管理（版本/回滚） | 现有 `/webos/api/apps/*`（已就绪） | **完全独立**，立即开工 |
| M1-4 桌面（阶段一：布局端点 + 手势让渡宿主层） | `webos/desktopLayout.ts`（W4 前置小项）✅ **已交付（2026-08-20）** | **mock 先行**：本地 fixtures 模拟 layout.get/put 开发宿主层；端点已上线（GET/PUT `/webos/api/desktop-layout`，优化 version + 409 冲突合并），可直接真实联调 |
| M1-4 桌面（阶段二：模板 V2 消费） | 桌面模板 V2（W4） | 先继续用 V1；V2 上线后 WebView 自动获得（R7），移动端零改动 |
| M1-5 权限引导 | 无 | **完全独立** |
| M1-6 账号 | 现有 `/api/auth/email/*`（已就绪） | **完全独立** |
| M1-7 文件同步 | W-F（manifest/blob 端点） | **mock 先行**：按 fixtures 建同步模块（diff/LWW/冲突副本）；W-F 交付后联调 |
| M2 包客户端（安装/版本/回滚/缓存） | W1（packages 端点族 + fixtures） | **mock 先行**：W0 fixtures 即可建 DTO 与 UI；W1 交付后联调 |
| M2 端侧 API 镜像（owner 级 handler） | W2（api.json schema + handler 语义 + 校验器逻辑） | **mock 先行**：W0/W2 契约 fixtures + 端侧 vm（harness）先行实现；W2 上线后对齐行为用例 |
| M2 市场消费端 | W3（市场端点） | 沿用现有商店端点浏览/安装；W3 后升级 type/依赖闭包 |

**跨路线交付承诺**：
1. web 路线把 **desktopLayout.ts** 与 **W-F 文件端点** 提前为小粒度任务插队交付（移动端 M1-4/M1-7 的真实联调依赖）。
2. 一切跨路线接口只认 `shared/` fixtures；**禁止**未落契约先联调（避免双端各自发明协议）。
3. 每条线周维度同步：契约变更 → 当周双端 DTO/fixtures 同步 PR。

## 3. 交付清单模板（每个任务完成时必须齐活）

- [ ] **代码**：新端点只在 `server/src/webos/`；server `tsc --noEmit` 0 错；shell-web `tsc -b --noEmit` + `vite build` 0 警告。
- [ ] **测试**：新逻辑单测（必测族见各篇）；契约 fixtures 更新且守卫全绿。
- [ ] **契约**：shared 变更双端同步（PR 注明契约版本）。
- [ ] **文档**：当天 CHANGELOG；决策进对应 README；坑进 playbook。
- [ ] **验证**：Playwright 线上回归（真实账号）；AI 对话相关问题先查管理端三件套。
- [ ] **回滚**：版本化对象可回滚；授权可收回；危险操作二次确认。
- [ ] **红线**：README §5 + 总纲 §7 逐条自查。

## 4. 执行纪律（沿用）

1. 一里程碑一 commit；禁止混提；类型检查 + 构建 + 单测绿才提交。
2. webos.ts 冻结；触及即瘦身；piBridge 只做适配层。
3. 真实账号实测原则（禁游客/模拟数据代替）。
4. 每里程碑结束：更新本文件状态 + CHANGELOG + 根 AGENT.md 状态行。