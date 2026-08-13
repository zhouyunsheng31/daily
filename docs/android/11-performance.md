# 11 · 性能预算与工程实践

> 定位要求"性能非常优秀"。本文把这句话变成可测量、可验收、可回归的工程标准（D10/D11/D13 落地）。

## 1. 渲染分级（再次明确，带否决权）

| 渲染目标 | 引擎 | 理由/红线 |
|---|---|---|
| Shell 全部界面 | **纯 Compose，零 WebView** | 系统界面 60/120fps 的根基；在 Shell 页面嵌 WebView 的 PR 一律打回 |
| App 功能界面 | WebView | 事件驱动 UI 是 WebView 擅长负载；预热池 ≤2 + LRU |
| 桌宠/桌面 2D 动画 | **单共享 overlay WebView + 单 canvas**（N 个桌宠 = 1 个 WebView） | 多 WebView 叠加是内存与掉帧元凶；物理可下沉原生协程批量回传 transform |
| 3D 桌宠（M3） | Filament / Live2D Cubism | 单独评审引入；MMD 级参考 Operit avator/mmd 的公开路径（自研） |
| 主题/壁纸/布局 | Compose + tokens | 状态驱动重组，无整页重绘 |

> WebView 认知纠偏（回应"WebView 很卡"的流行说法）：现代 Android WebView = Chromium 内核独立更新，canvas/WebGL 硬件加速，微信小程序/WebGL 手游为证。真实成本是首次进程创建（预热池解决）、单实例内存（上限+回收解决）、桥通信频率（事件化+批量 diff 解决）。**我们让 WebView 只做它擅长的事。**

## 2. 性能预算表（M1 验收红线；中端机：骁龙 7 系/天玑 8000 级实测）

| 指标 | 预算 | 测量方法 |
|---|---|---|
| 冷启动到可输入 | < 1.0s | Macrobenchmark `ColdStartup` + Baseline Profile；CI 卡点 |
| 热启动 | < 400ms | 同上 |
| 对话列表滑动 | P95 帧 < 16.6ms（120Hz 屏 < 8.3ms） | `FrameTimingMetric`（Macrobenchmark） |
| SSE 流式渲染 | delta→上屏 < 50ms，无掉帧尖峰 | 埋点 + JankStats |
| 端侧 pi 进程（D15，M0-3 实测入表） | **RSS 常态 ≤ 300MB**（含会话上下文，10 会话内）；首 token 延迟 ≤ 5s（中端机、用户 Key 网络正常） | `dumpsys meminfo` / 进程 RSS 埋点 + harness 内自报；M0-3 数据落档 perf-reports/ |
| 本地 AI 冷启动（D15） | proot 拉起 → 可对话 ≤ 10s（首启 rootfs 下载另计，需引导进度） | 埋点：harness ready 事件 |
| 桌宠场景（10 只） | 稳 60fps；内存增量 < 150MB | gfxinfo + 内存 Profiler 场景脚本 |
| App 打开（已预热） | < 300ms 首屏 | 埋点（webview attach → onPageFinished 关键资源） |
| 后台驻留 8h | 电量增量 < 3%；无 ANR | Battery Historian + Play Vitals 类指标 |
| APK 基座 | < 40MB（abi 仅 arm64-v8a） | CI 体积卡点（APK Analyzer 报告入库） |

## 3. 工程实践清单（强制）

**启动**
- Baseline Profiles + Macrobenchmark 模块从 M0 就建（不是补的）；`ProfileInstaller` 首启后台安装。
- App Startup：非首屏组件全部延迟初始化（Koin lazy / StartupProvider 白名单）；**WebView 预热在首帧渲染之后**（Choreographer postFrame → 后台线程预热）。
- 启动页 = 静态主题画面（windowBackground），无网络依赖。

**Compose**
- LazyColumn/LazyVerticalGrid 全部 key 化 + `contentType`；`remember`/`derivedStateOf` 防重组扩散；`@Stable/@Immutable` 标注数据类。
- 图片 Coil（内存+磁盘双缓存，占位与错误图统一）。
- 状态读取下沉到最小可组合项；动画用 `Modifier.graphicsLayer` 不触发 layout。

**WebView（app-runtime）**
- 预热池：首帧后创建 1 个空白实例；App 开启即 attach；关闭后回收复用（清 storage 分区按包隔离策略执行，05）。
- 硬件加速默认开；`setRenderPriority` 弃用 API 不用；后台 WebView `onPause`+停 JS 定时器。
- 桥通信：控制面走 `WebMessagePort`；高频数据（物理帧/进度）批量 diff，单帧 ≤1 次 evaluateJavascript。

**悬浮层（overlay-runtime）**
- 窗口数 ≤12；锁屏/来电自动隐藏；后台停 RAF（`onVisibilityChanged`）。
- hit-test 切换 flag 的频率 ≤ 每秒 4 次（防抖）。

**网络/数据**
- SSE：OkHttp 流式读取，delta 16ms 合帧进 StateFlow；断线指数退避（1s/2s/4s…≤30s）+ resume（02 §4.1）。
- Room 事务批量写；列表分页 Paging 3；同步/备份走 WorkManager 约束（有网+充电优先）。

**包体积（CI 卡点）**
- 仅 arm64-v8a；资源 shrinking + R8 full mode；图片 webp/矢量；proot rootfs/模型/语言包全部按需下载（不进 APK）。

## 4. 测量与回归

- **CI**：PR 必跑 `macrobenchmark:coldStartup`（模拟器基线，±10% 告警）+ Detekt/Lint + 契约守卫 fixtures + APK 体积 diff 报告。
- **真机回归**：每个里程碑在 2 台真机（中端 + 旗舰）跑 11 §2 全表，结果归档 `docs/android/perf-reports/`。
- **线上遥测**：启动耗时/帧率/ANR/崩溃/各 capability 引导转化率埋点（自建轻量上报或 Firebase，遵循隐私最小化）；性能回归 >20% 自动建 issue。

## 5. 技术观察清单（不集成，只跟踪）

| 技术 | 状态（2026-08 核实） | 复查节奏 |
|---|---|---|
| HTML-in-Canvas（WICG，`drawElementImage`/`layoutsubtree`，Chromium flag 阶段） | WebView 无法开 flag；Safari/Firefox 无支持；解决"HTML 画进 canvas"而非 WebView 性能 → **不集成**，远期"3D 桌面嵌可交互 App"再评估 | 每季度查 chromestatus |
| WebView 多进程隔离（Android U+ renderer 重要性 API） | 跟踪稳定性收益 | 每季度 |
| Live2D Cubism Native / Filament | M3 桌宠 3D 化候选 | M3 启动时评审 |