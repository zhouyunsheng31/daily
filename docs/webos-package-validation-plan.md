# 包体系校验体验改造方案（Validation UX Overhaul）

> 状态：**提案，待拍板** ｜ 日期：2026-08-23 ｜ 关联：docs/routes/web/03-package-system.md §5、shared/webos-contracts/packages/
> 结论一句话：**安全语义字段维持严格，创作体验层全面放宽；过程态与终态分离；文档与实现对齐。**

---

## 0. 背景与调查结论

调查（2026-08-23，针对 server/src/webos/contracts、packages、appapi、market 与 daily-package-market SKILL.md）定位出五个问题，按影响排序：

| # | 问题 | 证据位置 | 影响 |
|---|---|---|---|
| 1 | **校验时机噪声**：`onFsFileWritten` 钩子对 packages/ 下每次写文件都触发全量校验，AI 无论先写 manifest 还是先写内容，中间状态必然收到 ⚠️ | `server/src/routes/webos.ts`（onFsFileWritten）→ `packages-service.ts: syncPackageFromFs` | 外部 AI 把过程性告警当成"审核终局失败"，反复重写反复失败——"怎么写都过不了"的体感根源 |
| 2 | **api.json 无自愈**：manifest 有 `normalizePackageManifest`（字符串转多语言、补版本号等），api.json 没有，同名写法一边过一边挂 | `contracts/index.ts: normalizePackageManifest`（仅 manifest）vs `validateApiSpec`（无 normalize） | 不对称的失败体验 |
| 3 | **`additionalProperties: false` 全字段封闭**：多写 `author`/`license`/`tags` 直接拒 | `shared/webos-contracts/packages/daily-pkg.schema.json` / `api.schema.json` | 元数据字段按安全级严格对待，属过度约束 |
| 4 | **HTML 外部资源文案误导**：报错说"声明 network.domains 后经 App API 访问"，但静态检查只豁免 `type=url-app`，声明了 domains 照样拒 | `packages-service.ts: validatePackageContent`（`type !== 'url-app'` 分支） | 文档承诺了实现没有的能力，违背"文档=实际能提供的服务" |
| 5 | **版本快照规范化不一致（附带发现）**：paste 路径存 `cr.normalized`，fs 路径存原始 manifest | `packages-service.ts: createFromPaste`（用 normalized）vs `syncPackageFromFs`（用原始对象） | 自愈结果不进版本快照，运行时需重复自愈，两路径行为漂移 |

另确认（不动项）：market 上架密钥扫描（sk-/Bearer/apiKey=）、vm 沙箱（5s/64KB/null-proto）、SSRF 拦截、storage 前缀权界均按预期工作，全部保持原样。

## 1. 目标 / 非目标 / 红线

**目标**
1. AI / 外部开发者**照文档写包一次通过**；中间过程只见"进行中"提示，不见错误告警。
2. 未知元数据字段不再阻断；拼写错误仍能被抓住。
3. 文档（SKILL.md + repo docs）与实现行为逐条对齐。

**非目标**
- 不改 13 种 type 枚举、REST API 面、packages 三表结构（**零 DB 迁移**）。
- 不引入常驻进程/数据库托管（R5 红线维持：api 包是被调用时执行的 FaaS）。

**红线（本方案全部保持，一处不松）**
- SSRF/内网/localhost 拦截、eval/new Function 拒绝、路径穿越防护、secrets 明文扫描（上架关）、storage 读写权界、vm 5s/64KB 限制、10MB 配额、`data:text/html` 拒绝、SVG 内嵌 script 拒绝。

## 2. 改造总览

| 工作流 | 内容 | 涉及文件 | 阶段 |
|---|---|---|---|
| P1 反馈分级 | 过程态 ⏳ / 错误 ⚠️ 分离，包事务语义不变 | `packages-service.ts`、`contracts/index.ts` | 1 |
| P2 api.json 自愈 | `normalizeApiSpec` + 两条注册路径统一存 normalized | `contracts/index.ts`、`packages-service.ts`、`appapi/appapi-service.ts`（确认接线） | 1 |
| P4a HTML 文案+图片分级 | 修正误导文案；`data:image`（非 svg）上限 48KB→256KB | `packages-service.ts` | 1 |
| P3 Schema 开放化 | 顶层开放+未知字段 warning+驼峰拼写守护；嵌套安全对象保持封闭 | `shared/webos-contracts/packages/*.ts` → 重新生成 JSON 快照 → `server/test/unit/contracts.test.ts` fixtures | 2 |
| P5 文档同步 | SKILL.md 增补 5 个章节；repo docs §5 更新 | `/storage/emulated/0/Download/Operit/skills/daily-package-market/SKILL.md`、`docs/routes/web/03-package-system.md` | 随各阶段 |
| P4b domains 联动（可选） | 静态检查放行 manifest.domains 内的外链 + per-app CSP 注入 | shell 渲染链路（需单独评估） | 3（拍板后） |

## 3. P1 校验反馈分级

### 3.1 设计原则
- **分级只改文案与心智模型，不改包事务语义**：未完整的包依旧不建版本、不留半成品（现有事务行为保留）。
- `ContractIssue` 增加 `level?: 'blocking' | 'info'`；`formatIssues` 按 level 分组渲染。
- info 级文案统一携带"（未建版本）"后缀——兼容现有测试断言（packages.test.ts 的 `toContain('未建版本')`）。

### 3.2 检查项分级表

| 检查项 | 现状 | 新等级 | 新文案要点 |
|---|---|---|---|
| 目录不存在（delete 钩子触发） | ⚠️ | 静默 | 正常删除场景不应告警 |
| 缺 daily.pkg.json | ⚠️ | **⏳ info** | "已检测到 packages/<id>/，写好 manifest 后系统自动注册（未建版本）" |
| 入口文件缺失（含 api.json 缺失、mcp entry 缺失） | ⚠️ | **⏳ info** | "缺入口文件 X（type=Y 需要）。写入过程中的正常状态，非审核失败；补齐后自动校验注册。若已写完请检查文件名与 entry 声明是否一致（未建版本）" |
| manifest JSON 解析失败 | ⚠️ | ⚠️ | 不变（单次写入即坏，需立即修） |
| id ≠ 文件夹名 | ⚠️ | ⚠️ | 不变 |
| manifest schema/语义失败 | ⚠️ | ⚠️（经 P3 后未知字段降 warning） | 不变 |
| type=app 误放 packages/ | ⚠️ | ⚠️ | 不变（指路 apps/） |
| 超配额 / eval / 危险协议 / iframe / 外部资源 / JS 语法错 / `...` 占位 / SVG script | ⚠️ | ⚠️ | 外部资源文案按 P4a 修正 |
| api.json 存在但不合法 | ⚠️ | ⚠️（经 P2 自愈后字符串写法转为通过） | 不变 |

### 3.3 完成信号
包完成判定不变：manifest + 入口齐 + 校验全过 → 自动建版本并回流 ✅（现有行为）。⏳ 文案中显式说明这一机制，消除"何时算完"的不确定感。

## 4. P2 api.json 容错自愈（normalizeApiSpec）

新增 `normalizeApiSpec(raw)`，规则对齐 manifest 侧自愈：

1. 顶层及 `endpoints[].description` 的 `display_name`/`description` 字符串 → `{ zh: str }`
2. `method` 小写 → 大写（`'get'` → `'GET'`）
3. `storage.read/write` 单字符串 → 单元素数组（`"read": "notes/*"` → `["notes/*"]`）
4. 缺 `schema_version` → 补 1
5. 剔除 `$schema`
6. `endpoints[].handler` 前导 `./` 剥离（仅当剩余路径仍合法）

接线点：
- `validateApiSpec` 内部先 normalize，返回结构对齐 `validatePackageManifest`（`{ ok, issues, normalized }`）。
- `packages-service.validatePackageContent`（api 分支）：以 normalized 判定。
- `appapi-service.loadApiSpecs`：**现读磁盘后走契约校验**（文件头注释确认），改为消费 normalized 结果，保证注册时与调用时的 spec 一致。
- **附带修复（问题 #5）**：`syncPackageFromFs` 改为用 `cr.normalized` 传给 `registerOrUpdate`，与 `createFromPaste` 对齐；版本快照统一存规范化后的 manifest。
- 磁盘文件不回写（保持作者原文），normalize 仅发生在内存——与 manifest 侧现状一致。

## 5. P3 Schema 开放化 + 拼写守护

### 5.1 分字段治理

| 层级 | 现状 | 新策略 | 理由 |
|---|---|---|---|
| daily.pkg.json 顶层 | 封闭 | **开放**：未知字段 → warning（"已按元数据保留，无功能影响"），不阻断 | author/license/tags 等元数据无安全语义 |
| api.json 顶层 + endpoints[] 条目 | 封闭 | **开放**（同上） | 同上 |
| 嵌套安全对象：`network`、`dependencies[]`、`api`、`url`、`contents`（含 `mcp[]`）、`pets`、`storage` | 封闭 | **维持封闭** | 键名即权限语义（domains/range/spec/startUrl/env/read/write），打错字=权限错配，必须拦 |

### 5.2 拼写守护（防"开放后静默丢能力"）
开放的最大代价是可选字段打错字不再报错（如 `capabilitis` 被静默忽略 → 运行时缺权限）。对策：
- **驼峰/下划线变体**（`displayName` vs `display_name`，比较时忽略大小写与 `_`/`-`）：命中已知字段 → **blocking**，"字段疑似拼写错误：想写 display_name？"
- 其它未知字段 → warning。
- 实现位置：`contracts/index.ts` 语义校验层（known-keys 集合与 schema 属性列表同源维护）。

### 5.3 快照再生成流程（不可省）
改 `shared/webos-contracts/packages/daily-pkg.schema.ts` / `api.schema.ts` → 跑 `server/scripts/gen-contract-schemas.mjs` 重新生成 JSON 快照 → **.ts、.json 快照、fixtures 三者同一 commit**（否则 CI 校验漂移）→ `contracts/index.ts` 消费新快照自动生效。

`ContractResult` 增加 `warnings: ContractIssue[]`；反馈文案输出 "ℹ️" 段，不阻断注册。

## 6. P4 HTML 资源策略

### 6.1 Phase 1（随本方案上线）
1. **文案修正**（消除文档-实现落差）：
   - 旧："静态包不允许外部网络资源（外部引用请用 url-app 类型或声明 network.domains 后经 App API 访问）"
   - 新："静态包不允许外部网络资源：素材放包内用相对路径（如 assets/bg.png）；外部数据走前端 SDK DailyWebOs.http 或 App API（network.domains 仅对 handler/SDK 出站生效，不放行 HTML 静态引用）"
2. **data:image 分级**：`data:image/(png|jpe?g|gif|webp|avif);base64` 上限 48KB → **256KB**（AI 单文件 HTML 内联图片是主流写法，10MB 配额内安全）；`image/svg+xml`（可携带脚本）及其它 mime 维持 48KB。常量 `MAX_BASE64_BLOB` 拆为两个。

### 6.2 Phase 3（可选，单独拍板）
- 静态检查联动 `manifest.network.domains`：HTML 外链 host ∈ domains → 放行。
- **前置条件**：App HTML 响应注入 per-app CSP（`img-src` 等按 domains 生成），否则"声明即放行"是假放行（运行时仍被拦）。涉及 shell-web iframe 渲染链路，需独立评估后另立方案。

## 7. P5 文档同步

**daily-package-market SKILL.md**（`/storage/emulated/0/Download/Operit/skills/daily-package-market/SKILL.md`）增补：
1. **推荐写作顺序**：mkdir → 写 manifest → 写内容文件 → 自动注册；明确"中间收到 ⏳ 进行中提示属正常，写完即自动注册"。
2. **自愈清单表**：字符串 display_name/description、缺 schema_version/version、dependencies 字典式、method 小写、storage 单字符串、`./` 前缀 handler——系统自动修正，无需返工。
3. **硬性拒绝清单表**：eval/new Function、内网/localhost、iframe/object/embed、外部 http 引用（附正确替代方案）、data:image 非 svg >256KB、JS `...` 占位、明文密钥（sk-/Bearer/apiKey=，上架关拦截）。
4. **常见报错对照表**：系统人话 message → 原因 → 修法（与实现文案逐一对应）。
5. **目录归属**：app → `apps/`，其余 → `packages/`（现有 ✅ 已覆盖，加粗强化）。

**repo docs**：`docs/routes/web/03-package-system.md` §5 补"反馈分级"说明（⏳/⚠️/ℹ️ 三级语义）。

## 8. 测试与验收

### 8.1 新增/调整用例
- `contracts.test.ts` fixtures：
  - legal：api.json display_name 为字符串（自愈后过）；manifest 带 author/tags（ok 且 warnings 非空）
  - illegal：`displayName` 驼峰变体（blocking 拼写守护）；network 对象内未知键（嵌套封闭维持）
- `packages.test.ts`：
  - 写 manifest 缺 SKILL.md → 反馈含 ⏳、含"未建版本"、不含"校验未通过"；无版本产生（事务不变）
  - 补齐 SKILL.md → ✅ 注册 v1.0.0（现有用例回归）
  - fs 路径注册后版本快照 manifest 为 normalized 形态（修复 #5 的回归）
- 内容校验：data:image/png 200KB 通过；image/svg+xml base64 60KB 拒绝
- `market.test.ts`：密钥扫描行为不变（回归确认）

### 8.2 验收旅程（全部通过才算完成）
- **A（内部 AI）**：`agent_fs_mkdir` → 写 manifest → 写 SKILL.md，全程仅出现一次 ⏳，终态 ✅ v1.0.0 注册，无 ⚠️。
- **B（外部开发者）**：按 SKILL.md 一次 `POST /webos/api/packages` 提交含字符串 display_name 的 api 包 → ok；端点以 `appapi_*` 工具可调用。
- **C（恶意/事故回归）**：eval 包、内网域名包、sk- 明文包分别在注册、注册、上架三关被拦（行为与现状一致）。

## 9. 实施顺序与部署纪律

| 阶段 | 内容 | 规模 |
|---|---|---|
| Phase 1 | P1 分级 + P2 自愈（含 #5 修复）+ P4a + SKILL.md 对应小节 | 纯服务端，零 schema/DB 变更 |
| Phase 2 | P3 开放化 + 快照再生成 + fixtures + 文档字段治理章节 | shared + server + test 同 commit |
| Phase 3 | P4b domains 联动 + per-app CSP（独立评估后另立方案） | 拍板后启动 |

每阶段严格执行 AGENT.md 部署纪律：`git fetch/pull` 最新 → 本地 vitest 全绿 → 构建 → push GitHub（SSH）→ 服务器部署 → CHANGELOG 记录（YYYY-MM-DD HH:mm + commit hash + 修改文件路径 + 验证结果）。

## 10. 风险与回滚

| 风险 | 缓解 |
|---|---|
| 分级文案破坏既有测试断言 | ⏳ 文案保留"未建版本"短语；同步更新断言 |
| 开放顶层后可选字段打错字静默失效 | 驼峰变体 blocking + 编辑距离守护（§5.2） |
| 快照与 .ts 漂移 | 三者同 commit；CI contracts.test 兜底 |
| 历史已注册包受 schema 变更影响 | 无：校验只作用于新写入/新版本，存量版本不可变 |
| 回滚 | 纯代码 revert，无数据迁移、无指针改写 |
