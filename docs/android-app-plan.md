# Daily webOS → Android 原生端方案（含包体系 / 权限分级 / AI 全桌面能力）

> 状态：待评审 · 起草：2026-08-15 · 参考源码：Operit (AAswordman/Operit, LGPL-3.0)、RikkaHub (rikkahub/rikkahub, AGPL-3.0)、pi (earendil-works/pi, MIT)
>
> 本文回答四个问题：①Android 端怎么落地 ②"一切皆包"的包管理体系怎么设计 ③Shizuku 两档权限怎么做 ④如何在性能优秀的前提下让 AI 自由改写用户可见的一切。

---

## 0. 一手源码考察结论（先看证据再谈方案）

### 0.1 Operit（6.8k★，Kotlin + Compose 的 Android Agent 平台）

从 `app/build.gradle.kts`、`AndroidManifest.xml`、`Repo_Arch_Basic.md`、`docs/TOOLPKG_FORMAT_GUIDE.md` 核实：

| 维度 | 事实 |
|---|---|
| 技术栈 | Kotlin + Jetpack Compose（`compose = true`），ObjectBox（本地 DB），Coil/Glide，minSdk 26 / targetSdk 34，仅 arm64 |
| 权限架构 | **Shizuku**（`shizuku.api` + `shizuku.provider`，manifest 声明 `moe.shizuku.manager.permission.API_V23`）+ **libsu**（root 三件套 core/service/nio）双轨；`SYSTEM_ALERT_WINDOW` 悬浮窗、`MediaProjection` 截屏前台服务、通知监听、`QUERY_ALL_PACKAGES`、`MANAGE_EXTERNAL_STORAGE` |
| UI 自动化 | `UIDebuggerService` + `showerclient`（自研 Shower 虚拟显示客户端：建立虚拟屏、注入触控/按键、截图、视频解码渲染）——不止无障碍一条路 |
| 系统入口 | `VoiceInteractionService` 实现（可设为系统默认助手，长按 home/电源唤起）；`FloatingChatService` 全局悬浮聊天 |
| Linux 环境 | `terminal/` 子模块（OperitTerminalCore）= proot Ubuntu 24.04 用户空间，SSH/SFTP |
| 本地模型 | `llm/llama`（llama.cpp JNI）、`llm/mnn`（阿里 MNN）双引擎，跑 GGUF |
| 虚拟形象/3D | `avator/mmd`（Bullet3 + Saba Viewer 映射的 **MMD 运行时**）、`avator/dragonbones`（骨骼动画）、`avator/fbx`（ufbx）、Filament glTF——**用户想要的"MMD 渲染器/桌宠"Operit 已经做过一遍** |
| 包体系 | **ToolPkg** = ZIP 包：`manifest.json`（schema_version / toolpkg_id / semver version / subpackages 多子包 / resources / **wasm_modules** / i18n / workflow_templates / workspace_templates）+ `main.js` 入口 + `packages/*.js` 子包 + `ui/*.ui.js`（Compose DSL UI 模块）。脚本在 QuickJS JNI 引擎里跑，通过 Host Bridge 调原生能力 |

**结论**：Operit 证明了「JS 包 + Host Bridge + 版本化 manifest + 市场分发」这条路的可行性，也证明了 MMD/3D 虚拟形象在 Android 原生层完全可行。

### 0.2 RikkaHub（6.8k★，Kotlin 原生 LLM 客户端 + Agent 环境）

从 `workspace/` 模块源码核实（`ProotShellRunner.kt`、`WorkspaceShellRunner.kt`、`RootfsInstaller.kt`）：

| 维度 | 事实 |
|---|---|
| 技术栈 | Kotlin + Compose（Material You）+ Koin DI + Room + DataStore + OkHttp + kotlinx.serialization + Navigation 3；多模块（`ai`/`search`/`speech`/`workspace`/`web-ui` 等） |
| Agent 内核 | **自研 Kotlin agent loop**（`ai` 模块，OpenAI/Anthropic/Google 兼容端点），不内嵌任何 TS 运行时 |
| 本地权限 | **纯 proot，无需 root/Shizuku**：APK 内置 proot 二进制（`lib_proot.so` 放 nativeLibraryDir），rootfs 装进 filesDir，`-b` bind mount 挂工作区，`--kill-on-exit` 防泄漏，输出 128KB 截断防爆 LLM 上下文。降级路径：`HostShellRunner` 直接用 `/system/bin/sh` |
| 其他 | MCP 支持、记忆、消息分支、多 Provider、web-ui（局域网浏览器访问） |

**结论**：RikkaHub 证明了两点——①**没有 Shizuku 也能给 AI 一个完整 Linux 环境**（proot 是应用内进程，零门槛）；②agent loop 客户端化是可行的（但我们不必走这条路，见 §4）。

### 0.3 pi（88k★，我们的现有内核）

- 纯 TS monorepo：`pi-ai`（多 provider 统一 LLM API）/ `pi-agent-core`（agent 运行时：工具调用 + 状态管理）/ `pi-coding-agent`（CLI + 内置工具）。
- **官方明确声明：pi 没有内置权限/沙箱体系**（"Pi does not include a built-in permission system"），需要宿主自己容器化/代理——这与我们 webOS 已有的 Permission Broker 设计正好互补。
- 运行时要求 Node ≥20 或 Bun（arm64 均有官方构建）→ **pi 可以直接跑在 Android proot Ubuntu 里**（本工作区就是实证：Operit 的 proot Ubuntu24 里跑着 Node 工具链）。

---

## 1. 总体判断：不做"WebView 套壳"，做"原生 Shell + Web App 运行时"

候选路线对比：

| 路线 | 结论 |
|---|---|
| A. Capacitor/TWA 直接套现有 PWA | ❌ 否决。悬浮窗桌宠、Shizuku、无障碍、proot、全局覆盖层这些核心卖点在 WebView 沙箱里要么做不了要么性能差；套壳后还是要写大量原生桥，债越欠越多 |
| B. Flutter/RN 跨平台重写 | ❌ 否决。生态位不对：我们要深度调 Android 原生 API（无障碍/悬浮窗/Shizuku/AIDL），Kotlin 是第一公民；且 Operit/RikkaHub 两个最佳参考都是 Compose，可抄的代码路径最多 |
| C. **Kotlin 原生 Shell（Compose）+ 沙箱 WebView 跑 HTML App + 服务端 pi 内核** | ✅ **选定**。理由见下 |

选 C 的核心理由：

1. **我们的 HTML App 生态与原生 Shell 天然互补**。webOS 的 App 本来就是「版本化 HTML 包 + sandbox iframe + MessageChannel + Permission Broker」——这套契约可以几乎原样平移到 Android 的 WebView 沙箱里（`WebMessagePort` ≈ MessageChannel）。**`shared/app-manifest`、`shared/app-sdk`、`shared/permission-model` 三个共享契约继续是单一事实源**，Android 端只是新增一个宿主实现。
2. **AI 即主页的聊天体验必须原生**才够流畅（流式 SSE 渲染、输入法交互、通知、桌面小部件、默认助手入口）——RikkaHub/Operit 的流畅感都来自纯 Compose。
3. **服务端已经在跑 pi**，Android 端 Phase 1 零成本接入现有 `/webos/api/chat/stream`，不重写 agent loop。
4. 后续鸿蒙/iOS 各自做原生壳，**共享的只有服务端 + JSON 契约**，不被任何跨端框架锁死。

---

## 2. 目标架构

```
┌─────────────────────────── Android App (Kotlin) ───────────────────────────┐
│                                                                            │
│  Shell 层 (Compose, Material You)                                          │
│  ├── AI 聊天主页（=系统主页，SSE 流式，沿用方向A设计语言）                      │
│  ├── 桌面层（自由悬浮图标 / 桌宠舞台 / 壁纸，Compose + Overlay Window）        │
│  ├── App 管理（安装/版本/回滚/权限）· 包管理器 UI · 设置 · 余额/支付           │
│  └── 系统入口：默认助手(VoiceInteractionService) · 悬浮球 · 桌面小部件         │
│                                                                            │
│  运行时层                                                                   │
│  ├── App Runtime：WebView 沙箱(独立进程可配) + WebMessagePort ≈ iframe 沙箱   │
│  ├── Overlay Runtime：TYPE_APPLICATION_OVERLAY 透明窗口                     │
│  │    ├── WebView 渲染（2D 桌宠/bongo cat/漂浮图标，AI 生成 HTML 即可）        │
│  │    └── GL/Filament 渲染（MMD/Live2D 级 3D，后置阶段）                     │
│  ├── ToolPkg Runtime：JS 引擎（QuickJS JNI，Operit 同方案）                   │
│  └── Linux Runtime：proot Ubuntu（RikkaHub 式 rootfs 安装器，可选下载）        │
│                                                                            │
│  能力服务层（权限分级的物理载体）                                              │
│  ├── Tier0：AccessibilityService(UI自动化) · MediaProjection(截屏) ·         │
│  │    悬浮窗 · 通知监听 · UsageStats · 存储(SAF) · 前台服务保活                │
│  ├── Tier1：Shizuku(adb或root启动) → shell级 pm/am/input/settings/appops    │
│  └── Tier2：root(libsu) —— 有 root 时 Shizuku 自动增强，不单列产品档位        │
│                                                                            │
│  Agent Bridge（抽象层，唯一直连内核的地方）                                    │
│  └── Phase1: 远程 pi（现有 server，SSE）→ Phase2: 可选本地 pi（proot 内 Node）│
└────────────────────────────────────────────────────────────────────────────┘
                 │ HTTPS/SSE（credentials 复用现有 JWT cookie 体系）
                 ▼
┌──────────── 现有 server/（不动） ────────────┐
│ pi agent · /webos/api/* · 应用商店 · 计费 ·  │
│ 版本管理 · 权限审计 · 工作区文件               │
└───────────────────────────────────────────────┘
```

**关键决策：服务端代码零改动起步。** Android 端是一个新客户端，消费现有 `/webos/api/` 全部端点（bootstrap/chat.stream/apps/versions/storage/store/payment）。

---

## 3. 包体系：一切皆包（Package = AI 的 App）

这是用户最看重的部分。参考 Operit ToolPkg，但做得更彻底：**除系统工具外的所有扩展统一为一种包，一条流水线**。

### 3.1 统一包模型

```
Package {
  id: "com.daily.pet-brawl",        // 反向域名，全局唯一
  type: app | skill | mcp | toolpkg | theme | workflow | pet-layer | model-pack,
  version: "1.2.0",                 // semver，版本不可变（沿用 App Version 原则）
  entry: "index.html" | "main.js" | "SKILL.md" | "server.js" ...,
  manifest: { ... },                // 类型特定字段
  permissions: [...],               // 能力声明，接入 Permission Broker 求交
  dependencies: [{ id, range }],    // 包依赖（skill 依赖 toolpkg 等）
  source: ai-generated | store | sideload | community,
  audit: { createdBy, createdAt, changelog }
}
```

| 包类型 | 内容物 | 执行引擎 | 对应现有概念 |
|---|---|---|---|
| `app` | HTML/JS/CSS 静态包 | WebView 沙箱 | **现有 webOS App，契约直接复用** |
| `pet-layer` | HTML(2D) 或 GL 场景描述(3D) + 物理/行为脚本 | **Overlay Runtime**（悬浮透明窗） | 新增，桌宠/漂浮图标的载体 |
| `skill` | SKILL.md + references | 注入 pi skills 目录（服务端/本地） | 现有 skills 机制 |
| `mcp` | MCP server 配置（stdio/sse/remote） | MCP client（服务端先行） | 现有 mcp/ 目录思路 |
| `toolpkg` | JS 工具包（QuickJS 跑）+ 资源 + wasm | ToolPkg Runtime（端侧） | 对标 Operit ToolPkg |
| `theme` | 校验过的 design tokens + 壁纸 + 模糊/动画参数 | Shell 主题引擎（**非源码改写**，沿用现有安全约束） | 现有方向A主题机制 |
| `workflow` | 触发器 + 步骤图（可含 speech/定时/事件触发） | Workflow 引擎（端侧前台服务调度） | 对标 Operit workflow |
| `model-pack` | GGUF/MNN 模型文件 + 元数据（后置） | llama.cpp/MNN（后置） | 对标 Operit llm/ |

### 3.2 一条流水线

```
创建(AI生成/本地上传/商店) → 静态校验(schema/权限/恶意模式扫描)
   → 不可变版本落库 → 安装(指针切换) → 运行时按类型分发引擎
   → 权限求交(平台策略 ∩ 用户授权 ∩ Agent工具权限 ∩ 包能力声明)
   → 审计日志(谁/何时/改了什么) → 回滚(切回旧版本指针)
```

- **版本不可变 + 指针切换 + 回滚**：直接复用现有 App Version 实现，推广到全部包类型（这是相对 Operit ToolPkg 的优势——我们已有完整版本基建）。
- **商店即包注册表**：现有 store 端点扩展 `type` 维度即可，社区发布/审核/撤回后置。
- **AI 创建包的路径保持「文件夹即 App」哲学**：`mkdir packages/<name>/` + 写 manifest + 入口文件，系统自动注册建版本（沿用 2026-08-14 决策，推广到所有包类型）。

### 3.3 为什么这样能"版本号非常好管理"

单一 `packages` 表 + `package_versions` 表（type 字段区分），统一 semver、统一 install/active-version/rollback 端点族（`/webos/api/packages/:type/:id/...` 由现有 apps 端点泛化），统一审计。AI 改任何东西 = 产出新版本，用户可见一切变化都有版本轨迹、可一键回滚。

---

## 4. 内核：pi 保留吗？——保留，且不要客户端化重写

**我的结论：同意用户，内核继续用 pi，且 Phase 1 维持服务端托管。**

1. **不重写**：RikkaHub 把 agent loop 写在 Kotlin 里，代价是每次内核升级都要双端同步。我们已有 pi + 30+ 工具 + skills + 记忆 + 审计的成熟服务端，重写纯亏。
2. **pi 官方不管权限沙箱** → 我们的 Permission Broker（服务端已落地）正是正确答案，客户端只需加「端侧能力 Broker」镜像同一套求交逻辑。
3. **端侧解耦**：客户端只依赖 `Agent Bridge` 协议（SSE 事件流 + tool_call/tool_result 往返——现有 WS 协议的移动版），不依赖 pi 内部 API。**未来想换内核（比如本地小模型）只动 Bridge 实现**。
4. **本地 pi 作为 Phase 2 可选项**：proot Ubuntu 里装 Node arm64 → 真·离线跑 pi（技术已被本工作区实证可行）。定位是「高级用户的本地模式」，不是默认路径——默认路径是服务端 pi（省 200MB+ 体积、省电、密钥不出服务端，符合 `DEEPSEEK_API_KEY` 禁令）。

---

## 5. 权限分级：两档产品档位（参考 RikkaHub 兜底 + Operit 增强）

### 5.1 档位定义

| | **Tier 0 标准模式**（默认，零门槛） | **Tier 1 增强模式**（Shizuku） |
|---|---|---|
| 前置条件 | 应用内引导授权即可 | 用户装 Shizuku 并用 adb/root/无线调试激活 |
| UI 自动化（点/滑/输入/读屏） | **AccessibilityService**（Android 官方免 root 方案，Tasker/AutoInput 同款） | Shizuku shell `input tap/swipe/text`（更快、无无障碍卡顿）+ 无障碍保留兜底 |
| 截屏/屏幕感知 | MediaProjection（每次需用户点允许，可用前台服务+无障碍辅助保活） | 直接 shell screencap / 虚拟显示（Operit Shower 方案后置） |
| Linux 终端 | **proot Ubuntu（RikkaHub 式，无需任何特殊权限）** | proot + Shizuku 挂载更宽（可选 bind /sdcard 深层路径） |
| 桌宠/悬浮图标/覆盖层 | `SYSTEM_ALERT_WINDOW` 悬浮窗权限（**Tier 0 就够**，这是桌面玩法的基础，引导里重点要这个权） | 同左（覆盖层本就不需要 Shizuku） |
| 应用管理（装/卸/冻结/授权） | 只能跳系统设置页引导用户手点 | `pm install/uninstall/disable`、`appops set` 全自动 |
| 文件 | SAF + 应用私有目录 +（可选）MANAGE_EXTERNAL_STORAGE | shell 直接读写 |
| 系统设置 | 跳设置页 | `settings put` 直改 |
| 日志/诊断 | 自己进程的 logcat | 全量 logcat、dumpsys |

> 有 root 的机器上 Shizuku 本身即以 root 运行 → Tier 1 自动获得 root 级能力，**产品上不单独设 Tier 2**（Operit 的 libsu 路径作为 Shizuku 不可用时的 root 兜底内置即可）。

### 5.2 落地机制

- **Capability Matrix 进 bootstrap**：`GET /webos/api/bootstrap` 响应加 `capabilities: { tier: 0|1, accessibility: bool, overlay: bool, shizuku: bool, projection: bool, ... }`，由端侧采集上报。AI 的每个工具声明 `requires: ["accessibility"]`，Permission Broker 按矩阵求交，**不满足的能力明确返回 unavailable 状态，绝不伪造成功**（沿用支付/邮箱同款纪律）。
- **优雅降级**：同一工具多实现（点击 = 无障碍 gesture | shizuku input | root input），Broker 选最高可用档位执行，AI 无感知。
- **权限升级引导**：聊天内 AI 可发起「开启增强模式」引导卡片（教程 + 跳转），开启后 capability 热更新。
- **审计**：端侧能力调用全部上报服务端 execution.log（现有 trace 体系直接覆盖移动端排查）。

---

## 6. "AI 自由改写用户可见的一切" + 性能优秀：怎么同时成立

### 6.1 核心原则：**一切可见物皆数据，AI 只改数据，渲染器是可信的**

| 用户可见的 | 载体 | AI 怎么改 | 性能保障 |
|---|---|---|---|
| 主题/壁纸/动效 | design tokens JSON（版本化） | 写 token 包 → Compose `collectAsState` 响应式重组 | Compose 状态驱动，改色不重绘树 |
| App（功能界面） | 版本化 HTML 包 | 现有「文件夹即 App」 | WebView 硬件加速 + 预热池 |
| 桌面布局/图标 | 布局 JSON（图标位置/分组/物理参数） | 改 JSON → Compose 重排 | 原生渲染，60/120fps |
| 桌宠/漂浮物 | `pet-layer` 包：2D=HTML(canvas/lottie)，3D=GL 场景描述 | AI 生成包 → Overlay Runtime 实例化 N 个透明悬浮窗 | 见 6.2 |
| 聊天气泡/界面文案 | 校验过的局部配置 | 受限修改 | 原生 |

渲染引擎（Compose Shell + WebView Runtime + Overlay Runtime）是**可信代码，AI 永远不能改**——与 webOS「AI 不得改写运行中的 Shell 源码」同一铁律。AI 的所有创造力都通过「数据 + 包 + 版本」表达，天然带撤销/回滚。

### 6.2 桌宠大乱斗 / Live2D bongo cat / 漂浮图标的具体实现

- **悬浮层基建**：`WindowManager` + `TYPE_APPLICATION_OVERLAY` + 透明背景（`PixelFormat.RGBA_8888` + `FLAG_NOT_TOUCH_MODAL`）。每个桌宠 = 一个 overlay 窗口；「10 个桌宠大乱斗」= 10 个窗口 + 一个轻量物理协程（Kotlin 写主循环，AI 只写行为参数/外观）。
- **点击穿透与可触发兼得**：窗口默认 `FLAG_NOT_TOUCHABLE`（不挡用户），桌宠本体区域通过透明像素 hit-test 动态切 flag（RikkaHub/悬浮球类应用的标准技巧）；「图标自由悬浮但依然轻松触发点击」同理——图标窗口接收点击，空白处穿透。
- **2D 先行，3D 后置**：
 - Phase A：WebView overlay 跑 AI 生成的 HTML canvas/lottie/CSS 动画（bongo cat、像素宠物，今天就能做）——**复用 App Runtime，零新渲染器**。
 - Phase B：Live2D Cubism Native SDK（官方有 Android 版）或 Filament/glTF（Operit 在用，1.69.2）承载 3D；MMD 级需求可直接参考 Operit `avator/mmd`（Bullet3 物理 + Saba Viewer 渲染管线）——**源码可读，路径已验证**。
- **性能红线**：overlay 窗口数量设上限（如 12）；每个 WebView overlay 限制帧率/内存；后台只留合成器不留渲染（`onPause` 停 RAF）；Compose 侧全部 Lazy 布局 + 状态下沉。

### 6.3 聊天/流式性能

SSE 流复用现有 `/webos/api/chat/stream`；Compose 侧用 `Flow` 收集 delta，`SnapshotStateList` + key 化 LazyColumn（RikkaHub 同款渲染路径，实测 6.8k 星项目的流畅度即证据）；思考档/模型选择 UI 直接消费现有 `PUT /webos/api/ai/config`。

---

## 7. 分阶段路线图

| 阶段 | 内容 | 验收 |
|---|---|---|
| **M0 技术验证**（2-3 周） | Kotlin 空壳：Compose 聊天页接现有 SSE；WebView 沙箱跑通 1 个现有 webOS App（WebMessagePort 桥 + app-sdk 最小子集）；一个透明悬浮窗桌宠（HTML 版 bongo cat） | 真机跑通三条链路 |
| **M1 Android MVP** | 完整聊天主页（游客/登录/余额/四档思考）· App 列表/安装/版本/回滚（复用现有端点）· Tier0 权限引导（悬浮窗+无障碍+截屏）· 主题引擎 | 替代 PWA 成为日常主力 |
| **M2 包体系 + 增强模式** | packages/packages_versions 泛化（skill/mcp/toolpkg/theme/pet-layer 统一流水线）· Shizuku Tier1 · proot Ubuntu（可选下载）· 桌面层（漂浮图标、多桌宠）· Workflow 引擎基础 | 「一切皆包」闭环 |
| **M3 生态与多终端** | 商店社区分发/审核 · Live2D/Filament 3D pet-layer · 本地 pi（proot 内）可选模式 · **鸿蒙/iOS 立项**（各自原生壳 + 共享服务端与 JSON 契约）· 桌面端继续由现有 PWA/Electron 承载 | 多端契约稳定 |

> 鸿蒙提示：HarmonyOS NEXT 无 AOSP 兼容层，WebView(ArkWeb) 跑 HTML App 可行，但 Shizuku/proot/无障碍体系全无，需单独设计能力矩阵——所以契约层（app-sdk/manifest JSON Schema）必须平台无关，这正是我们已有 shared/ 契约的价值。

---

## 8. 风险与红线（沿用现有纪律）

1. **AI 不得改写 Shell 原生源码**——一切个性化走包/数据/版本（现有铁律平移）。
2. **能力不满足只报 unavailable**，不伪造成功（支付/邮箱同款）。
3. **DEEPSEEK_API_KEY 等密钥永不下发端侧**；本地 pi 模式需用户自备 Key。
4. **Google Play 政策风险**：无障碍 + 全文件访问 + REQUEST_INSTALL_PACKAGES 组合在 Play 审核敏感，首发建议官网/F-Droid 直发（Operit/RikkaHub 均如此），Play 版做能力裁剪变体。
5. **许可证注意**：Operit(LGPL-3.0)/RikkaHub(AGPL-3.0) 源码可**参考设计**不可直接拷贝代码进闭源版本；pi 是 MIT 无限制。
6. **overlay 滥用防护**：桌宠/悬浮层包必须经权限声明（`overlay.spawn`），数量上限 + 一键全部清除入口，防 AI 生成物把桌面搞成无法操作。

---

## 9. 待用户确认的决策点

1. 路线 C（原生 Compose Shell + Web App 运行时 + 服务端 pi）是否拍板？
2. 包体系 8 种类型的优先级排序（我的建议：app/pet-layer/skill/theme 先行，toolpkg/mcp 随 M2，model-pack 最后）。
3. 首发渠道：官网直发 + F-Droid，Play 裁剪版后置——是否同意？
4. M0 是否立即开工（建议先在真机验证 WebView 沙箱跑现有 App 的包契约兼容性，这是全方案最大不确定性）。

---

# 第二部分：增补设计（2026-08-15 第二轮：渲染性能 / App API / 联机 / 同步备份 / 定位）

## 10. "AI 什么都能用 HTML 搓出来"——对，包不是门槛

需要澄清一个概念：**包体系是管理层（版本/分发/权限/回滚），不是创作的额外负担**。

- AI 即兴搓一个桌宠 = 在 `apps/<名字>/` 写个 `index.html`（现有「文件夹即 App」机制原样复用），系统自动注册建版本——**AI 视角就是"写 HTML"，包是系统自动套的封套**。
- 桌面上一切可渲染物（桌宠、漂浮图标、动态壁纸、桌面小组件）= `pet-layer` 场景包，内容物依然是 HTML + 资源 + 行为参数。区别只在宿主窗口：App 跑在应用内 WebView，pet-layer 跑在**透明悬浮窗**里。
- 所以用户理解的没错：**优秀架构 + HTML 即内容**。HTML 干不动的（60fps 物理、3D），由运行时提供原生渲染后端，AI 依然只写 HTML/参数/资源，不碰原生代码。

## 11. WebView 到底卡不卡——渲染分级策略（正面回应性能质疑）

### 11.1 先纠正认知

「WebView 只配做静态场景」是过时结论。现代 Android WebView = **Chromium 内核**（独立随 Play 商店更新，与 Chrome 同代码基），canvas 2D / WebGL 全程硬件加速。微信小程序、淘宝美团海量核心页面、WebGL 手游都跑在 WebView 里。中高端机上 canvas/WebGL 稳 60fps 没有争议。

### 11.2 WebView 的真实成本（不回避）

| 成本 | 量级 | 对策 |
|---|---|---|
| 首次创建进程 | 100-300ms 一次性 | **预热池**：Shell 启动后后台预建 1-2 个 WebView，开 App 秒切 |
| 单实例内存 | 几十 ~ 150MB | 数量上限 + LRU 回收 + 多场景共享一个 WebView |
| JS 桥频繁通信 | 序列化开销 | 高频数据（物理帧）不走桥；桥只传事件/指令，状态同步批量 diff |
| 低端机/后台掉帧 | — | 帧率/内存遥测，超红线自动降级（降帧、合窗、暂停后台渲染） |

### 11.3 渲染分级（核心设计：每个渲染目标用它最合适的引擎）

| 渲染目标 | 引擎 | 理由 |
|---|---|---|
| Shell 全部界面（聊天/列表/设置/桌面合成/动画） | **纯 Compose，零 WebView** | 系统界面必须 60/120fps，这是"第二个桌面"流畅感的根基 |
| App 功能界面 | WebView | 应用界面是事件驱动 UI，非每帧动画，WebView 是其擅长负载 |
| 桌宠/桌面动画（2D） | **一个共享 overlay WebView + 单 canvas** | **10 个桌宠大乱斗 = 1 个 WebView 1 个 canvas，不是 10 个 WebView**；物理主循环可下沉原生协程，只回传 transform |
| 桌宠/桌面动画（3D，后置） | Filament / Live2D SDK | 参考 Operit `avator/mmd` 验证路径 |
| 壁纸/主题 | Compose + token | 状态驱动重组 |

**结论：我们不是"全 WebView 应用"，是"原生 Shell + WebView 只出现在它擅长的地方"。** 桌宠这类场景还可以随时把渲染后端从 canvas 切到原生，AI 产物（HTML/参数）不变。

## 12. App API 体系——「App = UI + 数据 + API」三位一体

用户洞察非常准：**AI 造了 App 却不知道 App 里的用户数据**，这是当前架构的真实缺口。解法：让 App 可以声明式地暴露 API，系统自动把 API 变成 AI 可用的包。

### 12.1 机制

```
AI 开发记事本 App 时，在 App 目录额外写 api/ 声明（或在 manifest provides 字段）：
  apis/notes.api.json → 定义端点 { name: "list_notes", read: "notes/*", schema: {...} }
系统自动完成三件事：
  ① 服务端代理：注册 GET/POST /webos/api/apps/:appId/api/<endpoint>
     （在服务端执行，直接操作该 App 的 app.storage —— 数据本来就在服务端）
  ② AI 工具化：API 包激活后，pi 自动获得 appapi_<app>_<endpoint> 工具
     → 用户问"我昨天记了什么"，AI 调 API 实时查到
  ③ 文档页：自动生成"该 App 全部 API"的可视化页面（用户可看、可调试着玩）
```

- **API 包 = 可独立分发的能力契约**（包类型新增 `api`）：其他 App 在 manifest 声明 `dependencies: [{api包}]`，app-sdk 里获得类型化 client（`sdk.useApi('forum').listPosts()`）。
- **「两个人对话、双方客户端页面完全不同」** = 同一 API 包（数据与语义层共享）+ 各自的 UI 包（表现层自由）。这是 API 市场的杀手级场景。
- **API 包市场**：商店新增 `api` 类型分区；用户可下载，**AI 也可通过工具搜索/安装**（走额度与权限管控，安装即审计）。

### 12.2 安全边界

- 端点必须声明读写范围（storage key 前缀隔离），Broker 求交后放行；跨用户数据默认不可见，必须 App 显式 `publish` 的命名空间才进共享域。
- 全链路审计：谁在何时通过哪个 API 读了什么，进现有 trace 体系。
- 频率限制 + 额度计费（API 调用计入用量，与现有余额体系打通）。

## 13. 联机（"P2P"）——务实两段走

移动端真 P2P 受 NAT/后台存活限制不可靠，务实路线：

| 阶段 | 方案 | 说明 |
|---|---|---|
| Phase 1（先做） | **服务器中继房间（Realtime Room）** | App 实例 = 房间，分享链接即邀请；复用现有 WS 基建做 pub/sub channel + 共享 storage 命名空间。论坛联机、聊天记录同步、协作看板全部覆盖。**体验是联机，实现是中继**——稳定、省电、跨端（网页端同协议直接加入） |
| Phase 2（后置） | **WebRTC DataChannel 真 P2P** | Web 与 Android WebView 原生支持 WebRTC；服务端只做信令 + TURN 兜底。用于低延迟/隐私敏感场景（局域网联机、对战同步） |

**关键抽象：channel 原语进 app-sdk**——`sdk.channel('room').publish/subscribe/onJoin/onLeave`，中继与 WebRTC 只是 transport 实现，对 App 和 AI 完全透明。论坛 App = 共享 storage + channel 广播；联机游戏 = channel + App 自定义同步策略。服务端保留房间审计（联机内容也要可追查，沿用审计纪律）。

## 14. HTML-in-Canvas（2026 WICG 提案）评估：**关注，不集成**

已核实一手资料（WICG/html-in-canvas 仓库 + chrome.dev 演示页）：

- **它是什么**：Chromium 实验 API（`chrome://flags/#canvas-draw-element` 后方可用），三个原语——`layoutsubtree` 属性让 canvas 子元素参与布局与命中测试、`drawElementImage()` 把 HTML 元素画进 2D canvas、`texElementImage2D` 画进 WebGL/WebGPU 纹理，外加 paint 事件与 worker 快照。
- **对我们的真实价值**：唯一高价值场景是远期形态「**3D 桌面里嵌入真实可交互的 App 界面**」（HTML UI 作为 WebGL 纹理贴在 3D 空间里的窗口上，变形成曲面/翻书/公告板效果）——很酷，但非 MVP。
- **为什么不能指望它**：①仍在 flag 阶段，**Android System WebView 不开放 chrome://flags**，应用无法开启；②跨浏览器零支持（Safari/Firefox 无承诺），网页端用了就分裂；③它解决的是"把 HTML 画进 canvas"，**不解决 WebView 性能问题**——我们的性能靠渲染分级（§11）解决，不靠它。
- **结论**：列入技术观察清单，每季度复查 Chrome 状态；等 WebView 跟进且进稳定版后再评估用于「3D 桌面」形态。**当前不集成，架构上也无需为它预留任何东西**（它是渲染层优化，不影响契约）。

## 15. 数据同步与备份

### 15.1 网页端 ↔ 移动端同步（天然成立 + 离线增强）

- 现有架构里聊天、App storage、版本、桌面布局**全部服务端化** → 双端同账号即同步，无额外工作。
- 移动端加 **Room/DataStore 离线缓存层**：服务端权威，读走缓存秒开 + 后台刷新；写操作乐观更新 + 失败入队重放（网络恢复自动同步）。冲突策略：storage 按 key 最后写入获胜（LWW），桌面布局/聊天天然单写者无冲突；CRDT 后置到协作文档类场景再引。

### 15.2 备份

- **云端自动备份**：服务端定时任务导出用户档案（DB 行 + 工作区文件快照）→ 对象存储，保留最近 N 份（如 7 日 + 4 周 + 12 月）；用户可手动触发、可下载归档。备份计云存储配额（与商业模式对齐）。
- **本地备份**：Android 端 SAF 导出加密归档（用户自选目录）；恢复 = 导入 → 校验 → 以"新版本"落库（**恢复也走版本指针，可再回滚**，与版本体系自洽）。
- 红线沿用：备份归档不含任何 Provider 密钥明文。

## 16. 定位校准：「你的第二个桌面——更轻量，也更个性化」

这一定位直接转化为**硬性性能预算**（M1 验收标准，中端机实测）：

| 指标 | 预算 | 手段 |
|---|---|---|
| 冷启动到可输入 | < 1s | Baseline Profiles + App Startup 延迟初始化；**WebView 不进启动关键路径**（预热在首帧之后） |
| 聊天/桌面滑动 | 稳 60fps（高刷机 120fps） | 纯 Compose + LazyColumn key 化 + 状态下沉 |
| 桌宠场景（10 只大乱斗） | 稳 60fps | 单共享 canvas + 原生物理协程；超预算自动降帧 |
| APK 体积 | 基座 < 40MB | proot rootfs / 本地模型 / 语言包全部**按需下载**（对标 RikkaHub rootfs 安装器模式） |
| 后台存活 | 低耗电 | 前台服务仅在有活动时挂；桌宠停帧策略；WorkManager 调度备份/同步 |

- 「更轻量」= 不抢系统桌面：应用内桌面为主，**"设为系统默认 Launcher"（ROLE_HOME）作为后置可选模式**单独评估，不在 M1 承诺。
- 「更个性化」= §6.1 的"一切可见物皆数据"：主题/桌面/桌宠/App 全部 AI 可改、全部版本化可回滚。

## 17. 决策点更新（在 §9 基础上追加）

5. **App API 体系**（§12）是否列为 M2 核心项？——它同时解开"AI 不知道 App 数据"和"联机/双端异构 UI"两个需求，建议优先级提到 toolpkg 之前。
6. 联机先走服务器中继房间（§13 Phase 1），真 WebRTC P2P 后置——是否同意？
7. HTML-in-Canvas 确认只观察不集成（§14）。
8. M1 性能预算表（§16）是否作为验收红线写入里程碑？
