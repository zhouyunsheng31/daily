# web 路线总索引（README）

> 版本：v1（2026-08-18 双路线定稿）
> 定位：web 路线的执行规范入口。web 路线 = Daily 的**主场**——纯 web PWA（`client/shell-web`）+ 服务端（`server/`），承载全部核心功能首发。总纲见 `docs/routes/README.md`（冲突以总纲为准）。
> 读者约定：无上下文接手时，读 `docs/routes/README.md` → 本 README → 按顺序读各分篇即可独立开工。

---

## 1. 这是什么

web 路线把 Daily 打磨成**手机形态的 AI-native webOS**（已上线 `shadowshub.xyz`）：

- **AI 助手即系统主页**（服务端 pi + DeepSeek，四档思考，积分计费）——已有。
- **AI 生成/修改 HTML App**（版本化、iframe 沙箱、可回滚）——已有雏形，本路线补齐**包体系泛化 + 校验反馈回路 + 生成体验**。
- **一切皆包**：app/api/skill/theme/toolpkg/mcp/workflow/provider/url-app/subagent/bundle 统一流水线（03 分篇）。
- **App API 体系（核心）**：App = UI + 数据 + API；AI 可在 App 里创建 API（api.json + handlers）→ 发布到市场 → 他人安装调用（04 分篇，owner + public 技术管道）。
- **统一包市场·万物皆可包**（05 分篇）。
- **文件工作区**（07 分篇，一阶段为移动端同步铺路）。
- **明确不做（R5/R11）**：终端/任意进程（不开放"虚拟服务器"）；shared 联机后置；user-pays / 联邦 / web BYOK 记录为未来选项；社区运营后置。

## 2. 已拍板决策（W 系列；与总纲 R 系列并存，冲突以 R 为准）

| # | 决策 |
|---|---|
| W1 | **服务端为主场**：包/API/市场/文件/计费全部服务端实现先行；移动端后续镜像（R3） |
| W2 | **webos.ts 冻结**：一切新端点进 `server/src/webos/` 新模块；触及即瘦身（沿用 docs/android/02 §6 纪律） |
| W3 | **单一契约**：`shared/webos-contracts` + `shared/agent-bridge-contract` 承载 `daily.pkg.json`/`api.json`/能力词汇表 schema；移动端 Kotlin DTO + fixtures 守卫（R6） |
| W4 | **handler 受限模型**：App 自动执行 = 服务端受限 vm 函数（无任意网络/fs/process、超时、输出截断、域名白名单）；不开放终端/任意进程（R5） |
| W5 | **public 技术管道先行，社区运营后置**：AI 可创建 API 并发布到市场、他人可安装调用（完整计费/审计/白名单/审核门槛）；拉第三方开发者/分成/内容治理后置 |
| W6 | **现有实现为基座，不推倒重来**：shell-web（React 19 + Vite + Tailwind4 + Zustand）与 server（Express + pi + better-sqlite3/PG）继续演进；单体文件走"触及即瘦身"增量拆分 |
| W7 | **系统 App 模板 web 主场开发**（桌面 V2/商店/文件），移动端自动消费（R7） |
| W8 | **验证纪律**：Playwright 手册（根 AGENT.md）+ 真实账号实测；管理端三件套（chat-logs/sessions/trace）为排查标准 |
| W9 | **UI 由用户主导**（红线）；安全 UI 例外（权限弹窗/授权页）宿主 React 写死，不可被 AI 篡改 |

## 3. 文档地图与阅读顺序

| 序 | 文档 | 内容 | 谁必读 |
|---|---|---|---|
| 0 | 本文 | 决策、索引、红线、总验收 | 所有人 |
| 1 | [01-product.md](01-product.md) | 定位、用户分层、旅程、不做清单 | 全员 |
| 2 | [02-architecture.md](02-architecture.md) | 现状盘点、目标模块结构、契约、拆分纪律 | 全员 |
| 3 | [03-package-system.md](03-package-system.md) | 包体系（daily.pkg.json v2 / 流水线 / DB 三表 / 能力词汇表） | 服务端+前端 |
| 4 | [04-app-api.md](04-app-api.md) | App API（api.json / handler runtime / public 管道） | 服务端 |
| 5 | [05-market.md](05-market.md) | 统一包市场·万物皆可包（发布/审核/依赖/计费） | 服务端+前端 |
| 6 | [06-billing.md](06-billing.md) | 计费现状与扩展（api/room/compute 预留） | 服务端 |
| 7 | [07-files.md](07-files.md) | 文件工作区 + File Service 一阶段 | 服务端 |
| 8 | [08-ui.md](08-ui.md) | 信息架构、桌面模板 V2、UI 红线 | 前端 |
| 9 | [09-roadmap.md](09-roadmap.md) | W 里程碑任务分解、交付清单、验收、**与移动端并行清单** | 全员 |

## 4. 现有代码库速览（动手前必须知道的事实）

```
client/shell-web/src/     # PWA Shell：App.tsx(187KB)/store.ts(88KB)/api.ts(30KB)/runtime.ts(35KB)/styles.css(95KB)
server/src/
├── routes/webos.ts       # ⚠️ 409KB 单体（/webos/api/* 全部路由）——冻结，新端点禁入
├── piBridge.ts           # 114KB pi 集成 + 30+ 工具
├── utils/webosWorkspace.ts   # 工作区 + agent_fs_* 工具
├── webosDesktopV1.ts / webosStoreV1.ts / webosTrashV1.ts   # 系统 App HTML 模板（版本化，AI 可改）
├── billing/ imagegen/ videogen/ vision/ payment/ sandbox/
└── webos/                # 🆕 本路线新建的模块目录（packages/appApi/market/files/...）
shared/webos-contracts/   # 契约单一事实源
```

线上事实：pm2 `daily-server`（3456）；PG/SQLite；工作区 `data/workspace/webos/<userKey>/`；站长账号排查纪律见根 AGENT.md。

## 5. 红线（沿用总纲 §7 + web 特化）

1. webos.ts 冻结（W2）；新模块只进 `server/src/webos/`。
2. 密钥不出服务端；App iframe 沙箱不拿 cookie/JWT/存储密钥；secrets 值永不进日志/AI 上下文。
3. 能力不满足只报 `unavailable`，禁止伪造成功（支付/邮箱/handler/网络同纪律）。
4. 版本不可变 + 指针切换 + 审计链；任何 AI 改动可回滚。
5. 权限四交集：平台策略 ∩ 用户授权 ∩ Agent 工具权限 ∩ 包能力声明。
6. **不开终端/任意进程**（R5）；`process.spawn/compute.exec` 标 unavailable。
7. UI 用户主导；安全 UI 例外宿主写死（W9）。

## 6. 总验收（web 路线核心闭环全绿）

- [ ] 对话内 AI 生成 App：实时预览 + 版本 + 回滚全链路；生成体验可对标 Puter builder（见调研文档）。
- [ ] 包体系：非 app 类型（api/skill/theme/bundle 至少 4 类）可创建/校验/安装/回滚；校验反馈回路 AI 可自我纠错。
- [ ] App API：AI 建 App 时写 api.json → AI 对话里能答出该 App 的真实数据（用例 A）；另一 App 经 sdk.useApi 调用（用例 C）。
- [ ] public 管道：甲的 App 发布 API 到市场 → 乙安装 → 乙的 App/AI 调用成功；计费（kind='api'）与审计落库；secrets 不出现在任何日志。
- [ ] 市场：api 包详情页展示端点清单与数据范围声明；安装带依赖闭包。
- [ ] 文件：files 表元数据与磁盘 reconcile diff 为空；manifest 端点供移动端同步使用。
- [ ] 桌面模板 V2：多页/文件夹/边缘翻页在 PWA 与 Android WebView 行为一致（R7 验收）。
- [ ] 质量门槛：server `tsc --noEmit` 0 错；shell-web `tsc -b --noEmit` + `vite build` 过；契约守卫 fixtures 全绿；Playwright 线上回归（真实账号）通过。

## 7. 交付要求（每个任务必须满足，不满足不算完成——与 09 分篇交付清单一一对应）

1. **代码**：服务端 `npx tsc --noEmit` 0 错；shell-web `tsc -b --noEmit` + `vite build` 0 警告；新端点只在 `webos/` 新模块。
2. **测试**：新逻辑有单测（handler 沙箱逃逸/越权/超时/截断/计费落库为必测族）；契约变更同步 fixtures 且守卫全绿。
3. **契约**：`shared/` 变更双端同步（服务端 TS + 移动端 Kotlin DTO），PR 描述注明契约版本。
4. **文档**：当天记 `CHANGELOG.md`；状态/决策同步对应 README；坑进 playbook。
5. **验证**：Playwright 线上回归（真实账号，禁游客代替）；涉及 AI 对话的问题先查管理端三件套再动手。
6. **回滚**：任何版本化对象（包/模板/UI）可回滚；任何授权可收回；危险操作二次确认。
7. **红线**：不触碰本文 §5 与总纲 §7 红线；能力不满足只报 unavailable。