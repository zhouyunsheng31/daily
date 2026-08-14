# Daily Android 端 · 开工总索引（README）

> 版本：v1.1（决策增补 D15–D17：端侧 AI 唯一路径 + sub-agent 包化 + AI 开发包能力） · 状态：**已拍板，进入执行准备**
> 读者约定：本文档集面向**没有参与过前期讨论的工程师/AI**。读完本 README + 按顺序读完各分篇，即可独立开工，不需要任何对话上下文。

---

## 1. 这是什么项目

Daily 是一个 **AI-native 网页操作系统（webOS）**：AI 助手即系统主页，用户通过对话让 AI 创建/修改「HTML App」（版本化 HTML 包，沙箱中运行），系统自带余额计费、应用商店、权限中介、文件工作区。线上域名 `shadowshub.xyz`，现有形态为移动端优先 PWA（`client/shell-web/`）+ Node 服务端（`server/`，pi agent 内核 + PostgreSQL/SQLite）。

**现在要做的事**：为 Daily 做 **Android 原生端**（后续鸿蒙/iOS）。产品定位一句话：

> **「你的第二个桌面——更轻量，也更个性化。」** AI 可以在桌面上做任何事情：搓桌宠、做 MMD 渲染器、让 App 图标自由悬浮、把整个桌面变成可玩的活物；同时操作体验、性能、外观必须达到原生 Launcher 级水准。

前期调研与决策推导过程见 [`../android-app-plan.md`](../android-app-plan.md)（含 Operit / RikkaHub / pi 三个开源项目的一手源码考察结论）。**本文档集是执行规范，与那份方案不一致时以本文档集为准。**

## 2. 已拍板决策清单（D1–D17，禁止推翻，变更需用户确认）

| # | 决策 | 分篇 |
|---|---|---|
| D1 | **路线 C**：Kotlin + Jetpack Compose 原生 Shell + WebView 沙箱跑 HTML App + **端侧 pi 内核**（proot + Node）。**否决** Capacitor 套壳与 Flutter/RN 跨端重写 | 02 |
| D2 | Agent 内核用 **pi 且跑在端侧**（proot Ubuntu + Node ≥22，SDK 嵌入、单进程多会话）；客户端经**本地 Agent 桥**（stdio/JSON-RPC）与内核通信；**无云端 AI 兜底** | 02、15 |
| D3 | **一切皆包**：app / pet-layer / api / skill / theme / toolpkg / mcp / workflow / model-pack / url-app / **provider** / **subagent** 统一一条流水线（校验→不可变版本→安装→权限求交→审计→回滚）；**系统默认包可覆盖**——内置工具/模型/媒体 provider 都是默认包，AI/用户装包即替换（不写死代码） | 03 |
| D4 | **App API 体系为高优先级**（M2 核心项，排在 toolpkg 之前）：App = UI + 数据 + API；API 声明自动生成服务端代理 + pi 工具 + 文档页；API 包可上架市场 | 04 |
| D5 | 支持**外部 API 接入做 App**、支持**外部网页（含实时连自有服务器的动态站点）做 App**（url-app 包类型） | 05 |
| D6 | 联机先走**服务器中继房间**（Realtime Room + channel 原语），WebRTC 真 P2P 后置 | 06 |
| D7 | **权限两档**：Tier0 标准模式（无障碍+悬浮窗+截屏+proot，零门槛）/ Tier1 增强模式（Shizuku）。能力不满足只报 unavailable，禁止伪造成功 | 07 |
| D8 | **TTS/ASR/视觉/本地模型预留位**：媒体 Provider 抽象 + model-pack 包类型 + 计费目录扩展，M1 只落抽象不实现语音 | 08 |
| D9 | **文件服务重构**与 Android 同步进行：统一 File Service（DB 元数据 + blob）+ 移动端同步协议 + 云/本地备份；服务端单体文件（webos.ts 409KB 等）增量拆分 | 09 |
| D10 | **渲染分级**：Shell 纯 Compose 零 WebView；App 界面用 WebView；桌宠用共享 overlay WebView 单 canvas（10 桌宠≠10 WebView）；3D 后置 Filament/Live2D | 11 |
| D11 | **性能预算写入 M1 验收红线**：冷启动 <1s、滑动 60/120fps、10 桌宠稳 60fps、基座 APK <40MB | 11 |
| D12 | 首发渠道**官网直发 + F-Droid**；Google Play 裁剪变体后置（无障碍+全文件+装包权限组合在 Play 审核敏感） | 12 |
| D13 | HTML-in-Canvas（2026 WICG 提案）**只观察不集成**；架构不为其预留任何东西 | 11 |
| D14 | AI 生成包唯一路径保持「**文件夹即包**」（agent_fs_mkdir + agent_fs_write，系统自动注册建版本），推广到全部包类型 | 03 |
| D15 | **端侧 AI 为唯一路径，不要云端 AI 兜底**：AI 为用户服务、用户主导——模型/密钥由用户配置（BYOK 端侧加密、直连），平台不托管模型密钥、不参与对话链路计费；离线可用。服务端 pi 仅保留给现有 PWA/桌面维护模式 | 02、08、15 |
| D16 | **sub-agent 做成包**（新包类型 `subagent`，M2）：以 pi 官方 subagent 示例为蓝本；执行器双档（**in-process 默认** + 子进程可选）+ 全局并发池限流；dsh 的 in-process provider / guard 防重 / spill 截断仅作**后置参考**，不引入 dsh | 15 |
| D17 | **AI 可开发任意类型包**（D14 泛化）：AI 不仅能建 App，还能创建/修改 subagent / skill / toolpkg / workflow / theme / api 等全部包类型，支持「一键素材工作流」（AI 一条指令 → 调研→设计→生图→打包 → 产出全套素材资产为版本化包） | 15 |
| D18 | **沉浸式启动器体验为 Shell 导航最高方向（2026-08-16 用户拍板）**：去掉底部 Tab 栏与顶部系统栏的"应用感"（edge-to-edge 全沉浸）；桌面对齐手机系统体验——多页网格、拖图标到边缘自动翻页、拖图标叠放合并建文件夹；AI 对话页与桌面同层、手势自由滑入滑出。原「底部 4 Tab + NavigationSuiteScaffold」信息架构**作废待重写**（商店/我的入口随手势模型候选一并定）；宿主（Compose）负责沉浸/系统栏/跨页手势，桌面 HTML（AI 可改层）负责网格/多页/文件夹/拖拽——两层手势边界在 M1-4 设计定稿，60/120fps 手感预算进验收 | 10 §0 |

## 3. 文档地图与阅读顺序

| 序 | 文档 | 内容 | 谁必读 |
|---|---|---|---|
| 0 | **本文档** | 决策、索引、红线、总验收 | 所有人 |
| 1 | [01-product.md](01-product.md) | 定位、用户旅程、可用性原则 | 全员 |
| 2 | [02-architecture.md](02-architecture.md) | 总架构、工程结构、Agent Bridge 协议、服务端拆分纪律 | 全员 |
| 3 | [03-package-system.md](03-package-system.md) | 包体系完整规范（manifest schema/生命周期/商店） | 服务端+客户端 |
| 4 | [04-app-api.md](04-app-api.md) | App API 体系（声明→代理→AI 工具化→市场） | 服务端 |
| 5 | [05-external-apps.md](05-external-apps.md) | 外部 API / 外部网页 App（url-app）安全模型 | 服务端+客户端 |
| 6 | [06-realtime.md](06-realtime.md) | 联机房间与 channel 原语 | 服务端+客户端 |
| 7 | [07-permissions.md](07-permissions.md) | 权限分级、能力矩阵、Shizuku/无障碍实现要点 | 客户端 |
| 8 | [08-media-ai.md](08-media-ai.md) | TTS/ASR/视觉/本地模型预留位 | 服务端+客户端 |
| 9 | [09-files-sync-backup.md](09-files-sync-backup.md) | 文件服务重构、同步协议、备份 | 服务端+客户端 |
| 10 | [10-ui-design.md](10-ui-design.md) | UI/UX 规范、页面清单、图标设计 brief、可用性检查清单 | 客户端 |
| 11 | [11-performance.md](11-performance.md) | 性能预算、工程实践、测量方法 | 客户端 |
| 12 | [12-roadmap.md](12-roadmap.md) | M0–M3 任务分解与验收标准 | 全员 |
| 13 | [13-dev-toolchain.md](13-dev-toolchain.md) | **开发工具链与脚手架（动手前第一件事）**：Android Studio/SDK/Gradle 安装、多模块初始化、签名与凭证、CI | 客户端（第一个读） |
| 14 | [14-dev-status.md](14-dev-status.md) | 开发状态快照、已拍板执行决策、里程碑进度 | 全员 |
| 15 | [15-subagent.md](15-subagent.md) | **sub-agent 与 AI 开发包**：subagent 包类型、执行器双档、并发池、AI 开发任意包机制、一键素材工作流、harness/前端分离开发 | 全员 |

## 4. 现有代码库速览（动手前必须知道的事实）

```
daily/                              # 仓库根（本文档集在 docs/android/）
├── server/src/
│   ├── index.ts                    # Express 入口（40KB）
│   ├── piBridge.ts                 # pi agent session + 30+ 工具（114KB，单体）
│   ├── routes/webos.ts             # ⚠️ /webos/api/* 全部路由（409KB 单体，新功能禁止再往里加）
│   ├── routes/adminWebos.ts        # 管理端（51KB）
│   ├── utils/webosWorkspace.ts     # 工作区 + agent_fs_* 工具（服务端磁盘，按用户隔离）
│   ├── imagegen/chatstImage.ts     # 生图（gpt-image-2-super，经 ChatST 网关）
│   ├── vision/ videogen/ payment/ billing/ sandbox/
│   └── webosDesktopV1.ts / webosStoreV1.ts / webosTrashV1.ts   # 内建桌面/商店/回收站模板
├── client/shell-web/src/           # 现有 PWA Shell（App.tsx 182KB 单体；维护模式，不加新功能）
├── shared/webos-contracts/index.ts # ⭐ 跨端契约单一事实源（模型档/事件/应用/计费/bootstrap 类型）
└── docs/                           # 历史文档；android-app-plan.md = 本项目的调研与决策推导
```

**线上事实**：生产服务 pm2 托管于 `shadowshub.xyz`；DB 为 PostgreSQL（entities 表存用户 state）+ 工作区磁盘目录 `/root/daily/server/data/workspace/webos/<userKey>/`；站长账号 `2893334965@qq.com`（排查用户问题必须实测真实账号，见根 AGENT.md）。

## 5. 红线清单（违反 = 返工）

1. **平台密钥不出服务端**：`DEEPSEEK_API_KEY`/`CHATST_IMAGE_API_KEY` 等禁止进 APK、`VITE_*`、日志、Git；**用户自带 Key（BYOK）只存端侧加密**（Android Keystore / EncryptedSharedPreferences），不上传服务端、不入归档。
2. **AI 不得改写 Shell 特权内核**：导航骨架/消息核心/权限 UI/安全回退不可改；一切个性化走包/数据/版本（design tokens、壁纸、布局 JSON、UI slot 包，见 03 §5.1），保留安全回退。
3. **能力不满足只报 unavailable**，禁止伪造成功（支付/邮箱/权限能力同纪律）。
4. **版本不可变**：任何修改产新版本，指针切换，保留审计链。
5. **权限求交**：平台安全策略 ∩ 用户授权 ∩ Agent 工具权限 ∩ 包能力声明，四者交集才放行。
6. **危险 Git 操作禁令**（禁 `add -A`/`push --force`/`reset --hard` 等，见根 AGENT.md）。
7. **服务端 webos.ts 冻结**：新端点一律进新模块（见 02-architecture §6 拆分纪律）。
8. **许可证**：Operit(LGPL)/RikkaHub(AGPL) 只可参考设计，**禁止拷贝代码**；pi(MIT) 无限制。

## 6. 总验收（M1 完成时必须全部成立）

- [ ] Android 端可完成：进入 → 配置模型 Key（BYOK）→ 本地 AI 对话 → AI 建 App → 桌面运行 App → AI 改 App（新版本）→ 回滚，全链路（对话走端侧 pi，**不依赖服务端 AI**）。
- [ ] 性能预算（11-performance §2）实测达标（中端机：骁龙 7 系/天玑 8000 级），其中端侧 pi 进程内存占用纳入预算表（11 §2 增补）。
- [ ] Tier0 权限引导完成率埋点可见；无 Shizuku 设备可完整使用对话/App/桌宠/文件同步。
- [ ] 与网页端数据互通：AI 会话记录、App 列表、桌面布局经 09 同步协议双向同步（对话本身各自独立，本地会话优先）。
- [ ] 崩溃率 < 0.5%，ANR < 0.1%（Firebase Crashlytics 或自建上报）。
