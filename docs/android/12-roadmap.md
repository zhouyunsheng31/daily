# 12 · 路线图与任务分解（M0–M3）

> 每个任务带验收标准；完成一个里程碑 commit 一次（禁止多里程碑混提交，根 AGENT.md 纪律）。
> 顺序即依赖关系；标记 ⚠️ 的是最大不确定性，优先做。

## M0 技术验证（2–3 周，纯客户端 + 零服务端改动）

| # | 任务 | 验收标准 |
|---|---|---|
| M0-1 | 工程脚手架：**先按 [13-dev-toolchain.md](13-dev-toolchain.md) 搭好工具链**（工作区无现成 Android 工具，需从零安装），再建 `client/android/` 多模块（app/core）+ Compose 导航骨架 + Koin + CI（assemble + lint + macrobenchmark 基线） | 13 §6 验收清单全过：CI 绿、真机可装空壳、冷启动基线数据入库 |
| M0-2 ⚠️ | 对话链路：游客鉴权（POST /api/auth/guest → CookieJar 持久化）→ bootstrap → chat/stream SSE 全事件渲染（含 thinking/tool chip/resume） | 真机完成 10 轮对话无事件丢失；断网恢复 resume 正确 |
| M0-3 ⚠️ | **App Runtime 验证（全方案最大不确定性）**：WebView 沙箱加载线上现有 App（从 `/webos/api/apps` 拉 HTML + 文件 raw 端点 + `<base>` 素材），app-sdk 最小子集（storage.get/set + event 上报）经 WebMessagePort 桥跑通 | 线上 3 个真实 App（含一个带素材/图片的）在 Android 运行功能完整；storage 读写与网页端互通 |
| M0-4 | 悬浮窗验证：透明 overlay + HTML 桌宠（共享 canvas 方案雏形）+ 点击穿透 hit-test | bongo-cat 级 2D 桌宠在其他 App 上层 60fps；点击本体响应、空白穿透 |
| M0-5 | 设计走查：10-ui-design §1 tokens 落到 Compose 主题 | 双主题截图评审通过 |

**M0 出口评审**：M0-3 若不达标（契约不兼容点 >3 处），回 02/03 修契约再进 M1。

## M1 Android MVP（4–6 周，目标：替代 PWA 成为日常主力）

| # | 任务 | 验收标准 |
|---|---|---|
| M1-1 | 四大页面完整实现（对话/桌面/商店浏览/我的）按 10 篇规格；空态/错误/加载全套 | 10 §6 可用性清单逐条通过 |
| M1-2 | 对话全能力：附件图片、系统 ASR 输入（08）、长按菜单、rebuild 重发、busy/background_progress 展示 | J3 旅程实测；08 §5 预留位验收 |
| M1-3 | App 管理：列表/安装/打开/版本时间线/回滚/删除（回收站）；apps_changed 实时刷新 | J4 全链路（建→改→新版本→回滚） |
| M1-4 | 桌面：网格模式 + 长按编辑 + 壁纸 + 桌宠层（应用内） | J5 实测；50 图标流畅（11 §2） |
| M1-5 | 权限 Tier0：悬浮窗/无障碍/通知/截屏引导卡（J2）+ capability 上报端点（服务端新模块 `webos/deviceWs.ts` 先落 REST 上报，WSS 通道可 M2） | 07 §5 用例 1、3 通过 |
| M1-6 | 账号：邮箱验证码登录/注册/忘记密码（复用 `/api/auth/email/*`）+ 游客资产迁移 | J7 迁移用例（游客建 App → 登录 → 资产在） |
| M1-7 | 文件服务第一阶段（服务端 `webos/files/`：manifest/blob/分块上传 + agent_fs 双写适配）+ 移动端同步（home/ 双向） | 09 §6 用例 1、2、6 通过；线上回归无 413 |
| M1-8 | 性能达标：Baseline Profile + 预算表全绿 | 11 §2 全表实测归档 perf-reports/ |
| M1-9 | 发布通道：官网下载页 + F-Droid 提审；崩溃/ANR 上报接入 | README §6 总验收全绿 |

## M2 包体系与增强模式（6–8 周）

| # | 任务 | 验收标准 |
|---|---|---|
| M2-1 | 包流水线（服务端 `webos/packages.ts` + DB 三表 + app 只读适配视图） | 03 §4 流程全通；版本/回滚/审计齐 |
| M2-2 ⭐ | **App API 体系**（`webos/appApi.ts`：api.json 解析、vm 沙箱 handler、代理端点、pi 动态工具、文档页） | 04 §5 用例 A/B/C 全过；沙箱逃逸单测全红转绿 |
| M2-3 | url-app + 外部 API 包（`webos/externalApps.ts`：白名单拦截、存储分区隔离、快照抓取） | 05 §4 用例全过 |
| M2-4 | 联机房间 Phase 1（`webos/rooms.ts` + app-sdk channel 原语 + 计费 kind='room'） | 06 §6 用例全过 |
| M2-5 | pet-layer 包类型 + overlay-runtime 完整版（多桌宠、桌面自由图标模式） | 10 桌宠 60fps（11 §2）；J5 自由模式可一键复原 |
| M2-6 | theme 包 + skill 包（包装现有 skills 机制进包流水线） | 主题应用/回退/分享链接安装全通 |
| M2-7 | Shizuku Tier1 完整接入 + 设备工具 WSS 通道 + Broker 求交落地 | 07 §5 用例 2 通过；降级链实测 |
| M2-8 | proot Linux（按需下载 rootfs + 运行器 + 工作区 bind） | 07 §5 用例 4 通过 |
| M2-9 | TTS Provider 首个接入（云端）+ 消息朗读 | 08 §5 M2 验收 |
| M2-10 | 商店扩展：type 分区 + api 包详情 + AI 找包工具（search/install_package） | J6 商店旅程 + AI 安装审计可查 |

## M3 生态与多终端（后续规划，启动前重新评审）

- 社区发布/审核/撤回；workflow 包引擎；model-pack + 本地 LLM（llama.cpp）；Live2D/Filament 3D 桌宠；WebRTC P2P；VoiceInteractionService 默认助手；Launcher（ROLE_HOME）评估；**鸿蒙（ArkTS + ArkWeb）与 iOS（SwiftUI + WKWebView）立项**——共享服务端与 JSON 契约，各自原生壳（02 §1 分层不变）。
- 桌面端：现有 PWA/Electron 继续承载，不进本路线图。

## 执行纪律（每个任务 PR 必过）

1. 类型检查 + 构建 + 单测绿（服务端 `tsc --noEmit`；Android assemble + lint + 契约守卫）。
2. 触及 webos.ts 必走"触及即瘦身"（02 §6.2）；新端点只在 `webos/` 新模块。
3. 涉及线上行为变化的，按根 AGENT.md Playwright 手册做线上回归（真实账号实测原则）。
4. 每里程碑结束：更新根 AGENT.md 状态行 + perf-report 归档 + 打 tag。
5. 排查 AI 对话类 bug：先查对话记录/trace（管理端三件套），禁止凭猜（根 AGENT.md 2026-08-11/13 决策）。