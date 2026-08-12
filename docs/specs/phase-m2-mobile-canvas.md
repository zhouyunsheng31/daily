# Phase M2 实施 Spec — 移动端画布主页 + 分层画布 + MVP 组件

> 生成日期：2026-06-25
> 依据：[roadmap_mobile_v1.md](file:///f:/allmylife/event/docs/roadmap_mobile_v1.md) 第六章 Phase M2
> 布局设计：[layout-design-mobile.md](file:///f:/allmylife/event/docs/layout-design-mobile.md) 第 2.10-2.13 节 + 第 5 节设计规范
> 架构参考：[architecture_refactor.md](file:///f:/allmylife/event/docs/architecture_refactor.md) 第三章（按面板路由工具调用）+ 第六章（动态组件跨端）
> 工作流：roadmap 第九章（写 Spec → 对抗审查 → 编码 → 对抗审查 → commit）
> 前置：M1 已完成（浏览器主页 + WebView 浏览器 + 标签页 + 书签 + 历史 + 设置）
>
> **产品定位**：移动端 AI 浏览器客户端（形态=浏览器+无限画布+AI，用途=日常 AI 助手）
> **M2 目标**：实现画布主页 + 分层画布 + 5 个 MVP 组件 + 面板管理 + 收藏组件 + 聚合面板 + UI 白色洁净色系升级，让 App 具备"无限画布"核心能力

## 修订记录

| 版本 | 日期 | 说明 |
|------|------|------|
| v1 | 2026-06-25 | 初版 |
| v2 | 2026-06-25 | 修复对抗审查发现的 6 个 Critical 问题：NC1 WidgetDao.observeAll() 缺失、NC2 WidgetRenderParams 缺 type 字段、NC3 FavoriteItem 缺 type 字段、NC4 CalculatorEngine 用 Android 不支持的 javax.script、NC5 CanvasViewModel.isFavorite() 主线程 runBlocking、NC6 WidgetContainer 拖拽结束检测缺失（改用 detectDragGesturesAfterLongPress，同时解决 D8/T10 长按手势冲突：拖拽用长按+拖拽，收藏/删除改 ⋮ 按钮） |
| v3 | 2026-06-25 | 修复第二轮对抗审查发现的 7 个问题：NC7 createAggregatePanel() 误写为顶层函数（改为 CanvasRepository 类成员）、NC8 CanvasRepository Hilt 重复绑定（@Inject constructor + @Provides 冲突，移除 @Provides）、NC9 AppNavGraph 用硬编码 "current_panel_id"（改为 CanvasHomeViewModel.currentPanelId）、NC10 android.R.drawable.ic_menu_calc 不存在（改为 ic_menu_sort_by_size）、NC11 目录结构注释 LivingDashboardApp "M2 不改" 与实际矛盾（改为 "M2 改"）、NC12 CanvasViewModel 缺 aggregatePanelId 属性（AggregatePanelScreen 引用未定义属性，补充 StateFlow）、NC13 PanelManagerViewModel 未定义（补充完整类定义 + clickable import） |
| v4 | 2026-06-25 | 修复第三轮对抗审查发现的 29 个问题。**P0 阻断性架构漏洞 4 个**：①toggleFavorite 未往 widget_positions 表加聚合面板记录（修复 4.8 toggleFavorite + DAO 新增 deleteByPanelAndWidget/countByPanel）②WebOSFavoritesScreen 状态不同步（新建 WebOSFavoritesViewModel 注入 CanvasRepository，6.5 重写）③CanvasHomeViewModel 缺 toggleFavorite（6.2 补充）④聚合面板 widgets 查询漏洞（6.4 observeWidgets 改用 flatMapLatest 分流，4.8 新增 observeAggregateWidgets JOIN 查询）。**P0 破坏性变更未迁移 3 个**：⑤BottomBar 签名变更（7.4 改为加 `mode: BottomBarMode = BottomBarMode.BROWSER` 默认参数，保留 M1 调用兼容）⑥AppNavGraph 签名变更（8.1 给出 MainActivityContent 完整新签名保留外部 URL 处理）⑦SettingsStore Hilt 重复绑定（10.2 显式移除 provideSettingsStore + 新增 provideDataStore）。**P1 与 layout-design 不一致 4 个**：⑧画布底部栏改 5 按钮 `[缩小][放大][Home][标签][⋮]`（D5/7.4，面板/收藏移到 ⋮ 菜单）⑨CircleIcon 加 onClick（6.1）⑩AIInputPill 实现收起/展开切换（6.1+6.2）⑪AggregatePanelScreen 上滑回主页（6.6 包裹 detectVerticalDragGestures）。**P1 任务无实现路径 2 个**：⑫T5 标签页统一改 TabManagerScreen 加 TabRow（3.1/5.1）⑬T8 缩放按钮 CanvasViewModel.zoomIn/zoomOut（6.4）。**P1 编译错误 4 个**：⑭WidgetContainer 缺 Alignment import（5.5）⑮AIAssistantWidget 缺 LazyColumn/items import（A.1）⑯HtmlCanvasWidget update lambda 用 remember 快照 bug（A.5 改用 lastLoadedHtml 比对）⑰createAggregatePanel 散乱（4.8 整合，8.3 改为引用）。**P1 决策不一致 2 个**：⑱D1 AI 占位与 onAiSend 不一致（6.2 加 _aiPlaceholderReply StateFlow）⑲MainViewModel.isAtHome 同步未说明（7.3 + 附录 B 加 destination 监听）。**P2 性能/风险 3 个**：⑳WidgetContainer 用 graphicsLayer 替代 offset+size（5.5）㉑CanvasScreen 视口检测只渲染可见组件（6.3）㉒双指缩放与长按拖拽手势冲突风险（12.1）。**P2 验收/依赖 7 个**：㉓11.2 加签名 APK 测试㉔包体改 release APK < 20MB + R8 + shrinkResources㉕移除 core-splashscreen 依赖㉖9.3 列出 M1 各页面具体修改位置㉗Room v1→v2 数据丢失警告（1.5+附录 C 标记 M5 前必须实现）㉘deletePanel 删除死代码（4.8）㉙FavoriteEntryEntity 加 widgetId 唯一索引（4.5） |
| v5 | 2026-06-25 | 修复第四轮验证审查发现的 11 个问题（v4 修复 24/29，但引入 8 新问题 + 3 部分修复）。**P0 阻断性 6 个**：#N1 附录 B AppNavGraph 签名与 8.1 矛盾（附录 B 改为接收 navController 参数，不再自建）#N2 TabManagerScreen M1 签名破坏未迁移（6.7 明确标注必须改 M1 AppNavGraph.kt 调用点，给出新旧对照，#30 标记破坏性变更）#N3 Routes 路由名变更破坏 M1（Routes 对象保留 M1 字符串值 `"home"`/`"browser/{tabId}"` 等，新增 `browser(tabId)` helper，附录 B 所有 `navigate(Routes.BROWSER)` 改为 `navigate(Routes.browser(tabId))`，#31 标记修复）#N4 CanvasHomeScreen 调用缺 onCircleIconClick（附录 B 补全所有必填参数 onCircleIconClick/onFavoriteClick/onSwipeDownToCanvas/onShowAggregate/onShowTabs/onShowSettings）#N5 destination changed listener 缺失（附录 B 加 DisposableEffect + addOnDestinationChangedListener）#N6 三个画布页面缺 BottomBar（6.1 CanvasHomeScreen + 6.3 CanvasScreen 函数体加 BottomBar 调用，6.6 复用 CanvasScreen 自动获得）。**P1 重要 2 个**：#N7 CanvasScreen onBack 未使用（6.3 加 BackHandler + BottomBar Home 按钮调用 onBack）#3 CanvasHomeViewModel.toggleFavorite 死代码（6.2 明确用途为长按收藏组件取消收藏，6.1 FavoriteCard 加 combinedClickable onLongClick 调用）。**P2 改进 3 个**：#N8 observeAggregateWidgets 缓存竞态（4.8 改为 Flow 方式 observeAggregatePanelId + flatMapLatest，移除 aggregatePanelIdCache，4.7 PanelDao 加 observeAggregatePanel）#22 手势冲突缓解未落地（5.5 WidgetContainer pointerInput 加 awaitEachGesture 多指检测）SettingsStore 重写未显式说明（4.9 加 SettingsStore.kt 改写说明）。**额外发现 2 个**：#N9 10.2 节 DB 名从 M1 的 `"living.db"` 误改为 `"living_dashboard.db"`，会破坏 MIGRATION_1_2 迁移（即使实现迁移脚本也找不到旧数据），已回退为 `"living.db"`；#N10 6.6 AggregatePanelScreen 复用 CanvasScreen 时未传 onShowTabs/onShowSettings，导致聚合面板页 BottomBar 的标签/更多按钮失效（虽有默认空操作值但功能不完整），6.6 签名新增 onShowTabs/onShowSettings 参数并传给 CanvasScreen，附录 B 调用补全 |
| v6 | 2026-06-25 | 修复第五轮验证审查发现的 1 个 P0 阻断问题：#22 多指检测代码不可编译（`change.pointerId` 不是 PointerInputChange 的有效字段，且 `onDrag` 回调无法检测第二根手指落下）。**最终方案**：删除不可编译的多指检测代码，改为在 5.5 节明确文档说明"长按阈值（400ms）前不消费事件，双指可正常接管；长按阈值后进入拖拽态则消费事件，双指无法接管"的边缘场景限制。M2 阶段接受此限制（用户需抬起手指重新双指缩放），M7+ 用 `awaitEachGesture` 自实现长按+拖拽+多指检测彻底解决。12.1 风险表已记录此限制 |

---

## 一、概述

### 1.1 项目背景

M1 已完成浏览器主页 + WebView 浏览器，App 能正常上网。M2 在此基础上实现"无限画布"核心能力——画布主页、分层画布、组件拖拽/缩放、5 个 MVP 组件、面板管理、收藏组件、聚合面板。M2 不涉及 AI 实际接入（M3）、脚本系统（M4）、数据同步（M5/M6）。

### 1.2 M2 目标

| 目标 | 说明 |
|------|------|
| 画布主页 | 圆形图标 + AI 输入框（占位）+ 收藏组件网格 + 下滑进入画布 |
| 分层画布 | 双指缩放 4 档级别（缩略图/卡片摘要/可交互卡片/完整组件） |
| 5 个 MVP 组件 | AIAssistant / WebviewWidget / Calculator / FocusTimer / HtmlCanvasWidget |
| 组件拖拽/缩放 | 长按拖拽（detectDragGesturesAfterLongPress）+ 双指缩放画布（detectTransformGestures） |
| 面板管理 | 创建/切换/删除面板，面板=画布（共生，组件隔离） |
| 收藏组件 | 收藏组件到画布主页，WebOS 风格全屏页 |
| 聚合面板 | 系统自动创建，收藏组件真实引用（同一 widgetId 多位置） |
| Home 键切换 | 先回当前模式主页再切换模式 |
| 首次启动 | 选择默认主页（浏览器 or 画布） |
| UI 升级 | 白色洁净色系（透明/半透明背景、无边框、毛玻璃效果） |

### 1.3 硬约束（沿用 M1）

| 约束 | 说明 |
|------|------|
| 技术栈 | Kotlin + Jetpack Compose + WebView（不用 TS/React） |
| Gradle | `F:\allmylife\gradle-8.2-bin\gradle-8.2\bin\gradle.bat` |
| Java | `D:\Java`（Java 17） |
| Android SDK | `F:\Android SDK`（android-36 + build-tools 36.1.0） |
| 包体 | < 20MB（M2 验收时检查 debug APK 体积） |
| git | 所有变更走 git commit |
| compileSdk | 36 |
| minSdk | 26（Android 8.0） |
| 包名 | `com.livingdashboard` |

### 1.4 M1 现状（已实现，M2 在此基础上扩展）

| 模块 | 状态 | 说明 |
|------|------|------|
| 浏览器主页 | ✅ | `ui/home/BrowserHomeScreen.kt`（搜索框 + Logo + 常用网站） |
| WebView 浏览器 | ✅ | `ui/browser/BrowserScreen.kt` + `browser/LivingWebView.kt` |
| 标签页 | ✅ | `ui/tab/TabManagerScreen.kt`（单 WebView 实例 + URL 重载） |
| 书签/历史 | ✅ | `ui/bookmark/` + `ui/history/` + Room 存储 |
| 设置 | ✅ | `ui/settings/SettingsScreen.kt`（主题色 + 主页定制 + 调试信息） |
| 底部栏 | ✅ | `ui/components/BottomBar.kt`（浏览器模式 5 按钮） |
| Room | ✅ | `data/db/LivingDatabase.kt`（version=1，BookmarkEntity + HistoryEntity + TabEntity） |
| DataStore | ✅ | `data/prefs/SettingsStore.kt`（主页定制 + 浏览器设置） |
| DI | ✅ | `di/AppModule.kt` + `di/DatabaseModule.kt` |
| WS 客户端 | ✅ | `sync/WsClient.kt`（M2 不改，M3 接入 AI） |
| WebViewController | ✅ | M1 已建立 inward 控制接口模式（M2 复用） |

### 1.5 不做的事（M2 范围外）

| 不做 | 留给 |
|------|------|
| AI 实际接入（WS 消息发送/接收） | M3 |
| AI 工具调用（browser_navigate 等） | M3 |
| 脚本系统 | M4 |
| 数据同步（画布/组件跨设备同步） | M5/M6 |
| 组件连线（ConnectionLayer） | M3+（M2 只做组件拖拽/缩放，不做连线） |
| 手绘笔迹（StrokesLayer） | M3+ |
| 多选/框选 | M3+ |
| 撤销/重做 | M3+ |
| 组件最小化/锁定 | M3+ |
| WebView 池/状态恢复 | M7 |

> ⚠️ **v4 #27 数据丢失警告（Room v1→v2 迁移）**：M2 将 `LivingDatabase` 从 version 1 升到 version 2，开发期使用 `fallbackToDestructiveMigration()`，**会清空 M1 已有数据（书签/历史/标签）**。开发期可接受，但**正式版发布前必须实现 `MIGRATION_1_2` 迁移脚本**（详见附录 C），最晚在 **M5 之前**完成。M5 启动数据同步功能后，破坏性迁移会丢失用户已同步的数据，绝对不允许。

---

## 二、设计依据

### 2.1 参考文档

| 文档 | 用途 |
|------|------|
| `docs/roadmap_mobile_v1.md` 第六章 | M2 任务表（13 个任务）+ 验收标准 + 产品形态设计 |
| `docs/layout-design-mobile.md` 第 2.10-2.13 节 | 画布主页/分层画布/WebOS 收藏组件页/聚合面板布局设计 |
| `docs/layout-design-mobile.md` 第 5 节 | 设计规范（间距/圆角/字体/图标/颜色/动效） |
| `docs/architecture_refactor.md` 第三章 | 按面板路由工具调用（per-panel session） |
| `docs/architecture_refactor.md` 第六章 | 动态组件跨端（纯前端 vs 依赖本地环境） |
| `docs/specs/phase-m1-mobile-browser.md` | M1 spec（风格参考 + WebViewController 模式 + Room 模式） |
| `client/desktop/src/components/CanvasHome.tsx` | 桌面端画布主页思路参考（移动端用 Kotlin 重写） |
| `client/desktop/src/components/Workspace.tsx` | 桌面端画布缩放/平移/坐标转换思路参考 |
| `client/desktop/src/components/WidgetContainer.tsx` | 桌面端组件拖拽/缩放思路参考 |
| `client/desktop/src/components/widgets/AIAssistant.tsx` | AI 助手组件功能参考 |
| `client/desktop/src/components/widgets/Calculator.tsx` | 计算器组件功能参考 |
| `client/desktop/src/components/widgets/FocusTimer.tsx` | 专注计时器组件功能参考 |
| `client/desktop/src/components/widgets/WebviewWidget.tsx` | WebView 组件功能参考 |
| `client/desktop/src/components/widgets/HtmlCanvasWidget.tsx` | HTML 画布组件功能参考 |

### 2.2 关键设计决策（12 项，必须遵守）

| # | 决策 | 选择 | 理由 |
|---|------|------|------|
| D1 | AI 占位策略 | M2 仅 UI 占位，AI 输入框发送消息只回显"AI 功能将在 M3 接入" | M2 不接 AI 后端，先做 UI 骨架让用户能体验画布交互 |
| D2 | 数据持久化 | Room（SQLite）+ DataStore Preferences | 画布数据是关系数据（面板→组件→位置），用 Room；设置项用 DataStore |
| D3 | Home 键规则 | 先回当前模式主页，再按一次切换模式 | 用户规则：Home 键精确规则。浏览器模式按 Home→回浏览器主页→再按 Home→切到画布模式画布主页；画布模式同理 |
| D4 | 首次启动 | 首次启动弹出选择主页页，用户选择默认主页（浏览器/画布），存入 DataStore | 让用户自主选择核心体验 |
| D5 | 画布模式底部栏 | v4 #8：5 按钮 `[缩小][放大][Home][标签][⋮]`，与浏览器模式 `[后退][前进][Home][标签][⋮]` 对称。原 4 按钮方案（[Home][面板][收藏][⋮]）违反 layout-design 2.10（要求 5 按钮与浏览器模式对称）。"面板"和"收藏"入口移到"⋮"更多菜单中 | layout-design 2.10 要求"画布模式底部栏毛玻璃 5 按钮"。缩小/放大按钮提供快捷缩放（T8 实现）。面板/收藏是低频操作，放更多菜单更合理 |
| D6 | 白色洁净色系 | 透明/半透明背景、无边框、毛玻璃效果（backdrop-filter blur）。色值：背景 #ffffff、卡片 rgba(0,0,0,0.03)、底部栏 rgba(255,255,255,0.85)+blur(20dp) | layout-design-mobile.md 第 5.5 节色值表 |
| D7 | 聚合面板真实引用 | 收藏组件 = 同一 widgetId 数据在多位置呈现。聚合面板不复制组件数据，引用同一 widgetId。组件状态变更同步到所有位置 | 避免数据冗余，保证一致性。架构_refactor 第六章"动态组件跨端"思路 |
| D8 | 组件拖拽/缩放 | 画布级用 `detectTransformGestures` 处理双指缩放/平移；组件级用 `detectDragGesturesAfterLongPress` 处理长按+拖拽（NC6 修复后：有 onDragEnd 回调，确保位置提交） | Compose 原生手势 API；注意 detectTransformGestures 无结束回调，不适合组件拖拽 |
| D9 | 分层画布 4 档缩放级别 | <0.3x 缩略图（只显示图标+标题）/ 0.3-0.7x 卡片摘要 / 0.7-1.0x 可交互卡片 / >1.0x 完整组件 | layout-design-mobile.md 第 2.11 节 |
| D10 | MVP 5 个组件 | AIAssistant / WebviewWidget / Calculator / FocusTimer / HtmlCanvasWidget | roadmap 指定，覆盖 AI/浏览器/工具/计时/HTML 五类场景 |
| D11 | WebviewWidget 是 HtmlCanvasWidget 前置依赖 | WebviewWidget 先实现（复用 M1 的 LivingWebView + WebViewController），HtmlCanvasWidget 依赖 WebviewWidget 建立的 WebView 控制模式 | HtmlCanvasWidget 用 WebView 渲染 HTML，需复用 WebviewWidget 的 WebView 生命周期管理 |
| D12 | 面板=画布（共生） | 面板和画布是同一概念的两个面。每个面板有自己的画布（组件隔离）。切换面板=切换画布。聚合面板是特殊面板（系统创建，收藏组件真实引用） | architecture_refactor 第三章"按面板路由工具调用" |

---

## 三、任务清单

### 3.1 M2 任务表（来自 roadmap 第六章，共 13 个任务）

| # | 任务 | 详情 | 验收标准 |
|---|------|------|----------|
| T1 | 画布主页 | 圆形图标 + AI 输入框（占位）+ 收藏组件网格 + 下滑提示 | 画布主页正常显示，下滑可进入画布 |
| T2 | Home 键切换 | Home 键先回当前模式主页再切换模式 | Home 键行为符合 D3 规则 |
| T3 | 分层画布 | 双指缩放 4 档级别 | 缩放时组件呈现 4 种级别 |
| T4 | 面板管理 | 创建/切换/删除面板，面板=画布 | 面板 CRUD 正常，组件隔离 |
| T5 | 标签页统一 | `TabManagerScreen` 顶部加 `TabRow`，含两个 Tab：**网页标签**（M1 已有，展示 TabEntity 列表）+ **画布面板**（M2 新增，展示 PanelEntity 列表）。两个 Tab 共享同一页面骨架（TopAppBar + LazyVerticalGrid + 关闭/新建按钮），仅数据源不同。底部栏"标签"按钮进入时根据当前 `AppMode` 默认选中对应 Tab（BROWSER→网页标签，CANVAS→画布面板）。**不再单独建 `PanelManagerScreen`**（v4 #12 修订：与 layout-design-mobile.md 2.4 节"统一管理网页标签和画布面板标签"对齐） | 两个 Tab 可切换；网页标签 Tab 显示 M1 标签列表；画布面板 Tab 显示 M2 面板列表，支持创建/切换/删除；进入时默认 Tab 与当前 AppMode 一致 |
| T6 | 组件渲染（5 个 MVP） | AIAssistant/WebviewWidget/Calculator/FocusTimer/HtmlCanvasWidget | 5 个组件能正常渲染和交互 |
| T7 | 组件拖拽 | 长按拖拽组件，实时跟随手指 | 拖拽流畅，位置持久化 |
| T8 | 画布缩放按钮 | 底部栏或浮动按钮提供缩放快捷操作 | 缩放按钮可用 |
| T9 | 画布主页下滑 | 画布主页下滑进入画布（当前面板的画布） | 下滑手势识别正确 |
| T10 | 收藏组件 | 组件右上角"⋮"按钮→弹出菜单→收藏，收藏后显示在画布主页（D8/T10 手势冲突修订：长按已用于拖拽，收藏改 ⋮ 按钮） | 收藏功能正常，主页显示收藏 |
| T11 | WebOS 收藏组件页 | 点击画布主页收藏组件→进入 WebOS 风格全屏页 | 全屏页正常展示组件 |
| T12 | 聚合面板 | 系统自动创建聚合面板，显示所有收藏组件 | 聚合面板自动创建，收藏组件真实引用 |
| T13 | UI 视觉升级 | 白色洁净色系（透明/半透明/毛玻璃） | 所有 M2 页面符合 D6 色值表 |

### 3.2 任务依赖关系

```
T1(画布主页) ──→ T9(下滑进画布) ──→ T3(分层画布)
                                        ↓
T4(面板管理) ──→ T6(组件渲染) ──→ T7(拖拽) ──→ T10(收藏)
                    ↑                              ↓
              T11(WebOS页) ←───────────── T12(聚合面板)
                    
T2(Home键) 依赖 T1 + M1浏览器主页
T5(标签页统一) 独立（底部栏模式切换）
T8(缩放按钮) 依赖 T3
T13(UI升级) 贯穿所有任务
```

---

## 四、数据模型

### 4.1 Room 数据库扩展（version 1 → version 2）

M1 的 `LivingDatabase` 是 version=1（BookmarkEntity + HistoryEntity + TabEntity）。M2 新增 4 张表，version 升到 2，用 `fallbackToDestructiveMigration`（开发期）。

> ⚠️ **v4 #27 数据丢失警告**：`fallbackToDestructiveMigration()` 会**清空整个数据库**（包括 M1 的书签/历史/标签），然后按新 schema 重建。开发期可接受（数据可重建），但：
> - **正式版发布前必须替换为 `MIGRATION_1_2` 迁移脚本**（见附录 C）
> - **最晚在 M5 之前完成**（M5 启动数据同步后，破坏性迁移会丢失用户已同步数据）
> - 测试 M2 时，每次升级数据库版本都会清空数据，需提前备份测试数据

```kotlin
package com.livingdashboard.data.db

import androidx.room.Database
import androidx.room.RoomDatabase
import androidx.room.TypeConverters
import com.livingdashboard.data.dao.*
import com.livingdashboard.data.entity.*

@Database(
    entities = [
        BookmarkEntity::class,      // M1
        HistoryEntity::class,       // M1
        TabEntity::class,           // M1
        PanelEntity::class,         // M2 新增
        WidgetEntity::class,        // M2 新增
        WidgetPositionEntity::class,// M2 新增
        FavoriteEntryEntity::class  // M2 新增
    ],
    version = 2,
    exportSchema = false
)
@TypeConverters(Converters::class)
abstract class LivingDatabase : RoomDatabase() {
    abstract fun bookmarkDao(): BookmarkDao
    abstract fun historyDao(): HistoryDao
    abstract fun tabDao(): TabDao
    abstract fun panelDao(): PanelDao              // M2
    abstract fun widgetDao(): WidgetDao            // M2
    abstract fun widgetPositionDao(): WidgetPositionDao // M2
    abstract fun favoriteDao(): FavoriteDao        // M2
}
```

### 4.2 PanelEntity（面板）

```kotlin
package com.livingdashboard.data.entity

import androidx.room.Entity
import androidx.room.PrimaryKey

@Entity(tableName = "panels")
data class PanelEntity(
    @PrimaryKey val id: String,           // UUID
    val name: String,
    val type: PanelType,                  // NORMAL / AGGREGATE（聚合面板，系统创建）
    val sortOrder: Int = 0,
    val createdAt: Long = System.currentTimeMillis(),
    val updatedAt: Long = System.currentTimeMillis()
)

enum class PanelType { NORMAL, AGGREGATE }
```

**说明**：
- `type = AGGREGATE` 的面板系统自动创建，用户不可删除（D12）
- `id` 用 UUID 字符串（不用自增 Long，方便跨设备同步预留）
- 聚合面板全局唯一，App 首次启动时自动创建

### 4.3 WidgetEntity（组件实例）

```kotlin
package com.livingdashboard.data.entity

import androidx.room.Entity
import androidx.room.PrimaryKey

@Entity(tableName = "widgets")
data class WidgetEntity(
    @PrimaryKey val id: String,           // widgetId，UUID
    val panelId: String,                  // 所属面板（聚合面板的收藏组件也指向原 panelId？否，见 D7）
    val type: WidgetType,                 // 组件类型
    val stateJson: String,                // 组件状态 JSON（Map<String, Any> 序列化）
    val width: Float,                     // 组件基础宽度（dp）
    val height: Float,                    // 组件基础高度（dp）
    val createdAt: Long = System.currentTimeMillis(),
    val updatedAt: Long = System.currentTimeMillis()
)

enum class WidgetType {
    AI_ASSISTANT,
    WEBVIEW,
    CALCULATOR,
    FOCUS_TIMER,
    HTML_CANVAS
}
```

**说明**：
- `stateJson` 存储组件状态（如 Calculator 的 history、FocusTimer 的 mode/startedAt、WebviewWidget 的 url/title）
- 用 `TypeConverters` 序列化 `Map<String, Any>` 到 JSON 字符串
- D7 聚合面板真实引用：收藏组件不创建新 WidgetEntity，而是通过 `FavoriteEntryEntity` 引用同一 `widgetId`

### 4.4 WidgetPositionEntity（组件在画布上的位置）

```kotlin
package com.livingdashboard.data.entity

import androidx.room.Entity
import androidx.room.ForeignKey
import androidx.room.Index
import androidx.room.PrimaryKey

@Entity(
    tableName = "widget_positions",
    foreignKeys = [
        ForeignKey(
            entity = PanelEntity::class,
            parentColumns = ["id"],
            childColumns = ["panelId"],
            onDelete = ForeignKey.CASCADE    // 面板删除时，位置也删除
        )
    ],
    indices = [Index("panelId"), Index("widgetId")]
)
data class WidgetPositionEntity(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val panelId: String,                  // 在哪个面板的画布上
    val widgetId: String,                 // 引用 WidgetEntity.id（D7：同一 widgetId 可在多 panelId 出现）
    val x: Float,                         // 画布坐标 X（非屏幕坐标）
    val y: Float,                         // 画布坐标 Y
    val zIndex: Int = 0                   // 层级
)
```

**说明**：
- D7 核心实现：`widgetId` + `panelId` 是多对多关系。同一个 `widgetId` 可以在多个 `panelId` 的画布上有不同位置（原始面板 + 聚合面板）
- 外键 CASCADE 只在面板删除时删除位置，不影响 WidgetEntity 本身
- 画布坐标 = 缩放/平移前的原始坐标，渲染时通过 CanvasTransform 转换到屏幕坐标

### 4.5 FavoriteEntryEntity（收藏条目）

```kotlin
package com.livingdashboard.data.entity

import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey

// v4 #29：加 widgetId 唯一索引，防止同一组件被收藏两次（与 toggleFavorite 的"已存在则取消"语义一致）
@Entity(
    tableName = "favorites",
    indices = [Index(value = ["widgetId"], unique = true)]
)
data class FavoriteEntryEntity(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val widgetId: String,                 // 收藏的组件 ID（D7：真实引用）
    val sortOrder: Int = 0,               // 画布主页收藏网格排序
    val createdAt: Long = System.currentTimeMillis()
)
```

**说明**：
- 收藏 = 在 `favorites` 表加一条记录，引用 `widgetId`
- v4 #29：`widgetId` 加唯一索引，防止重复收藏（与 `toggleFavorite` 语义一致：已存在则取消）
- 聚合面板自动显示所有 `favorites` 表中的组件（查询时 JOIN WidgetEntity）
- 取消收藏 = 删除 `favorites` 表中对应记录，不删除 WidgetEntity

### 4.6 TypeConverters（M2 扩展）

```kotlin
package com.livingdashboard.data.db

import androidx.room.TypeConverter
import com.livingdashboard.data.entity.PanelType
import com.livingdashboard.data.entity.WidgetType
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement

class Converters {
    @TypeConverter
    fun fromPanelType(value: PanelType): String = value.name

    @TypeConverter
    fun toPanelType(value: String): PanelType = PanelType.valueOf(value)

    @TypeConverter
    fun fromWidgetType(value: WidgetType): String = value.name

    @TypeConverter
    fun toWidgetType(value: String): WidgetType = WidgetType.valueOf(value)

    @TypeConverter
    fun fromStateJson(value: String): Map<String, Any> {
        // 简化：用 org.json.JSONObject 解析（避免 kotlinx.serialization 的 Map<String, Any> 不支持）
        val obj = org.json.JSONObject(value)
        val map = mutableMapOf<String, Any>()
        for (key in obj.keys()) {
            map[key] = obj.get(key)
        }
        return map
    }

    @TypeConverter
    fun toStateJson(map: Map<String, Any>): String {
        val obj = org.json.JSONObject()
        for ((key, value) in map) {
            obj.put(key, value)
        }
        return obj.toString()
    }
}
```

### 4.7 DAOs

```kotlin
// PanelDao.kt
package com.livingdashboard.data.dao

import androidx.room.*
import com.livingdashboard.data.entity.PanelEntity
import kotlinx.coroutines.flow.Flow

@Dao
interface PanelDao {
    @Query("SELECT * FROM panels ORDER BY sortOrder ASC")
    fun observeAll(): Flow<List<PanelEntity>>

    @Query("SELECT * FROM panels WHERE type = 'AGGREGATE' LIMIT 1")
    suspend fun getAggregatePanel(): PanelEntity?

    // v5 #N8：聚合面板 ID 的流式订阅（替代同步缓存 aggregatePanelIdCache，消除竞态）
    @Query("SELECT * FROM panels WHERE type = 'AGGREGATE' LIMIT 1")
    fun observeAggregatePanel(): Flow<PanelEntity?>

    @Query("SELECT * FROM panels WHERE id = :id")
    suspend fun getById(id: String): PanelEntity?

    @Insert
    suspend fun insert(panel: PanelEntity)

    @Update
    suspend fun update(panel: PanelEntity)

    @Delete
    suspend fun delete(panel: PanelEntity)
}
```

```kotlin
// WidgetDao.kt
package com.livingdashboard.data.dao

import androidx.room.*
import com.livingdashboard.data.entity.WidgetEntity
import kotlinx.coroutines.flow.Flow

@Dao
interface WidgetDao {
    @Query("SELECT * FROM widgets WHERE panelId = :panelId")
    fun observeByPanel(panelId: String): Flow<List<WidgetEntity>>

    @Query("SELECT * FROM widgets")
    fun observeAll(): Flow<List<WidgetEntity>>  // NC1：补充 observeAll（聚合面板查询用）

    @Query("SELECT * FROM widgets WHERE id = :id")
    suspend fun getById(id: String): WidgetEntity?

    @Insert
    suspend fun insert(widget: WidgetEntity)

    @Update
    suspend fun update(widget: WidgetEntity)

    @Delete
    suspend fun delete(widget: WidgetEntity)

    @Query("DELETE FROM widgets WHERE panelId = :panelId")
    suspend fun deleteByPanel(panelId: String)
}
```

```kotlin
// WidgetPositionDao.kt
package com.livingdashboard.data.dao

import androidx.room.*
import com.livingdashboard.data.entity.WidgetPositionEntity
import kotlinx.coroutines.flow.Flow

@Dao
interface WidgetPositionDao {
    @Query("SELECT * FROM widget_positions WHERE panelId = :panelId ORDER BY zIndex ASC")
    fun observeByPanel(panelId: String): Flow<List<WidgetPositionEntity>>

    @Insert
    suspend fun insert(position: WidgetPositionEntity)

    @Update
    suspend fun update(position: WidgetPositionEntity)

    @Delete
    suspend fun delete(position: WidgetPositionEntity)

    @Query("SELECT * FROM widget_positions WHERE panelId = :panelId AND widgetId = :widgetId LIMIT 1")
    suspend fun getByPanelAndWidget(panelId: String, widgetId: String): WidgetPositionEntity?

    // v4 #1：聚合面板真实引用落地所需方法
    @Query("DELETE FROM widget_positions WHERE panelId = :panelId AND widgetId = :widgetId")
    suspend fun deleteByPanelAndWidget(panelId: String, widgetId: String)

    // v4 #1：聚合面板自动布局（横向每行 4 个）所需计数
    @Query("SELECT COUNT(*) FROM widget_positions WHERE panelId = :panelId")
    suspend fun countByPanel(panelId: String): Int

    @Query("DELETE FROM widget_positions WHERE widgetId = :widgetId")
    suspend fun deleteByWidget(widgetId: String)
}
```

```kotlin
// FavoriteDao.kt
package com.livingdashboard.data.dao

import androidx.room.*
import com.livingdashboard.data.entity.FavoriteEntryEntity
import kotlinx.coroutines.flow.Flow

@Dao
interface FavoriteDao {
    @Query("SELECT * FROM favorites ORDER BY sortOrder ASC")
    fun observeAll(): Flow<List<FavoriteEntryEntity>>

    @Query("SELECT * FROM favorites WHERE widgetId = :widgetId LIMIT 1")
    suspend fun getByWidget(widgetId: String): FavoriteEntryEntity?

    @Insert
    suspend fun insert(entry: FavoriteEntryEntity)

    @Delete
    suspend fun delete(entry: FavoriteEntryEntity)

    @Query("DELETE FROM favorites WHERE widgetId = :widgetId")
    suspend fun deleteByWidget(widgetId: String)
}
```

### 4.8 Repository

```kotlin
// CanvasRepository.kt
package com.livingdashboard.data.repository

import com.livingdashboard.data.dao.*
import com.livingdashboard.data.entity.*
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.map
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class CanvasRepository @Inject constructor(
    private val panelDao: PanelDao,
    private val widgetDao: WidgetDao,
    private val widgetPositionDao: WidgetPositionDao,
    private val favoriteDao: FavoriteDao
) {
    // ===== Panel =====
    fun observePanels(): Flow<List<PanelEntity>> = panelDao.observeAll()

    suspend fun getAggregatePanel(): PanelEntity? = panelDao.getAggregatePanel()

    suspend fun createPanel(name: String): PanelEntity {
        val panel = PanelEntity(
            id = java.util.UUID.randomUUID().toString(),
            name = name,
            type = PanelType.NORMAL
        )
        panelDao.insert(panel)
        return panel
    }

    suspend fun deletePanel(panel: PanelEntity) {
        // 聚合面板不可删除
        if (panel.type == PanelType.AGGREGATE) return
        panelDao.delete(panel)
        // widget_positions 外键 CASCADE 自动删除
        // widgets 需手动清理（只删属于此面板且未被收藏的）
        // v4 #28：删除死代码 val widgets = widgetDao.observeByPanel(panel.id)（返回 Flow 无法在此处消费，且后续未使用）
        widgetDao.deleteByPanel(panel.id)
    }

    // ===== Widget =====
    fun observeWidgets(panelId: String): Flow<List<WidgetEntity>> =
        widgetDao.observeByPanel(panelId)

    suspend fun createWidget(
        panelId: String,
        type: WidgetType,
        state: Map<String, Any>,
        width: Float,
        height: Float
    ): WidgetEntity {
        val widget = WidgetEntity(
            id = java.util.UUID.randomUUID().toString(),
            panelId = panelId,
            type = type,
            stateJson = convertStateToJson(state),
            width = width,
            height = height
        )
        widgetDao.insert(widget)
        return widget
    }

    suspend fun updateWidgetState(widgetId: String, state: Map<String, Any>) {
        val widget = widgetDao.getById(widgetId) ?: return
        widgetDao.update(widget.copy(
            stateJson = convertStateToJson(state),
            updatedAt = System.currentTimeMillis()
        ))
    }

    suspend fun deleteWidget(widgetId: String) {
        val widget = widgetDao.getById(widgetId) ?: return
        widgetDao.delete(widget)
        // 同时删除所有面板中该组件的位置（避免孤儿位置记录）
        widgetPositionDao.deleteByWidget(widgetId)
        // 同时删除收藏（如果有）
        favoriteDao.deleteByWidget(widgetId)
    }

    // ===== Position =====
    fun observePositions(panelId: String): Flow<List<WidgetPositionEntity>> =
        widgetPositionDao.observeByPanel(panelId)

    suspend fun updatePosition(panelId: String, widgetId: String, x: Float, y: Float) {
        val existing = widgetPositionDao.getByPanelAndWidget(panelId, widgetId)
        if (existing != null) {
            widgetPositionDao.update(existing.copy(x = x, y = y))
        } else {
            widgetPositionDao.insert(WidgetPositionEntity(
                panelId = panelId,
                widgetId = widgetId,
                x = x,
                y = y
            ))
        }
    }

    // ===== Favorite (D7 真实引用) =====
    fun observeFavorites(): Flow<List<FavoriteEntryEntity>> = favoriteDao.observeAll()

    /**
     * v4 #1：D7 聚合面板真实引用落地。
     *
     * 收藏时不仅往 favorites 表加记录，还要往 widget_positions 表加
     * (panelId=聚合面板, widgetId) 记录，否则聚合面板 CanvasScreen 渲染时
     * positions 为空，永远不显示任何组件。
     *
     * 取消收藏时同步删除聚合面板中的位置记录。
     */
    suspend fun toggleFavorite(widgetId: String) {
        val existing = favoriteDao.getByWidget(widgetId)
        val aggregate = panelDao.getAggregatePanel() ?: return  // 聚合面板未创建时直接返回
        if (existing != null) {
            favoriteDao.delete(existing)
            widgetPositionDao.deleteByPanelAndWidget(aggregate.id, widgetId)
        } else {
            favoriteDao.insert(FavoriteEntryEntity(
                widgetId = widgetId,
                createdAt = System.currentTimeMillis()
            ))
            // 自动布局：横向排列，每行 4 个（300dp 宽 + 20dp 间距 ≈ 320dp 步进）
            val count = widgetPositionDao.countByPanel(aggregate.id)
            val x = (count % 4) * 320f
            val y = (count / 4) * 320f
            widgetPositionDao.insert(WidgetPositionEntity(
                panelId = aggregate.id,
                widgetId = widgetId,
                x = x,
                y = y
                // width/height 不存：WidgetPositionEntity 无此字段，渲染时用 WidgetEntity.width/height
            ))
        }
    }

    suspend fun isFavorite(widgetId: String): Boolean =
        favoriteDao.getByWidget(widgetId) != null

    /**
     * v4 #4 / v5 #N8：D7 聚合面板真实引用查询（Flow 方式，消除竞态）。
     *
     * 聚合面板在 widgets 表中没有自己的记录（不复制组件数据）。
     * 此方法 JOIN widget_positions（panelId=聚合面板）+ widgets 表，
     * 返回聚合面板中所有收藏组件的真实数据。
     *
     * 组件状态变更自动同步（因为是同一 WidgetEntity）。
     *
     * v5 #N8 修复：原实现用同步缓存 `aggregatePanelIdCache` + 异步填充，存在竞态
     * （App 启动时 cacheAggregatePanelId() 尚未完成，observeAggregateWidgets() 读到空字符串）。
     * 现改为 Flow 方式：observeAggregatePanelId() 返回 Flow<String?>，
     * flatMapLatest 监听聚合面板 ID 变化，自动切换数据源。
     */
    @OptIn(kotlinx.coroutines.ExperimentalCoroutinesApi::class)
    fun observeAggregatePanelId(): Flow<String?> =
        panelDao.observeAggregatePanel().map { it?.id }

    @OptIn(kotlinx.coroutines.ExperimentalCoroutinesApi::class)
    fun observeAggregateWidgets(): Flow<List<WidgetEntity>> =
        observeAggregatePanelId().flatMapLatest { aggId ->
            if (aggId != null) {
                // JOIN widget_positions（聚合面板）+ widgets 表
                widgetPositionDao.observeByPanel(aggId)
                    .combine(widgetDao.observeAll()) { positions, allWidgets ->
                        val widgetIds = positions.map { it.widgetId }.toSet()
                        allWidgets.filter { it.id in widgetIds }
                    }
            } else {
                flowOf(emptyList())
            }
        }

    /**
     * v4 #17：聚合面板自动创建（NC7 修复后整合到类内部，8.3 节只引用此方法）。
     * App 首次启动时调用。
     */
    suspend fun createAggregatePanel(): PanelEntity {
        val panel = PanelEntity(
            id = java.util.UUID.randomUUID().toString(),
            name = "聚合面板",
            type = PanelType.AGGREGATE,
            sortOrder = Int.MAX_VALUE  // 排在最后
        )
        panelDao.insert(panel)
        // v5 #N8：无需手动缓存 ID，observeAggregatePanelId() 通过 Flow 自动感知新插入的聚合面板
        return panel
    }

    private fun convertStateToJson(state: Map<String, Any>): String {
        val obj = org.json.JSONObject()
        for ((key, value) in state) {
            obj.put(key, value)
        }
        return obj.toString()
    }
}
```

**说明**：
- D7 聚合面板真实引用：`observeAggregateWidgets()` JOIN `widget_positions`（聚合面板）+ `widgets` 表，返回收藏组件的真实数据。组件状态变更时，所有引用位置自动看到最新状态（因为是同一个 WidgetEntity）
- v4 #1：`toggleFavorite` 收藏时同步往 `widget_positions` 表加聚合面板记录，取消收藏时同步删除——这是聚合面板能渲染组件的关键
- v4 #17：`createAggregatePanel` 整合到类内部（NC7 修复后此处为最终位置，8.3 节只引用）
- v4 #28：`deletePanel` 删除死代码 `val widgets = widgetDao.observeByPanel(panel.id)`（Flow 无法在此消费）
- v5 #N8：`observeAggregateWidgets()` 改为 Flow 方式（`observeAggregatePanelId().flatMapLatest{...}`），移除 `aggregatePanelIdCache`/`getAggregatePanelSyncId()`/`cacheAggregatePanelId()` 三个方法，消除"App 启动时缓存未填充"竞态。6.4 CanvasViewModel.init 中对 `cacheAggregatePanelId()` 的调用也需同步移除
- `deletePanel` 中聚合面板不可删除（D12）
- `deleteWidget` 同时清理收藏记录

### 4.9 SettingsStore 扩展（DataStore）

M1 的 `SettingsStore` 新增 `defaultHomeMode`（首次启动选择的主页）。

> **v5 修复：SettingsStore.kt 重写说明**（`f:\allmylife\event\client\android\app\src\main\java\com\livingdashboard\data\prefs\SettingsStore.kt`）：
>
> M1 现有代码：
> ```kotlin
> class SettingsStore(@ApplicationContext private val context: Context) {
>     private val dataStore = context.dataStore
>     // ...
> }
> ```
>
> M2 改为（构造函数注入 DataStore，配合 10.2 节 `provideDataStore` + 移除 `provideSettingsStore`）：
> ```kotlin
> @Singleton
> class SettingsStore @Inject constructor(
>     private val dataStore: DataStore<Preferences>
> ) {
>     // 类内所有 context.dataStore 引用改为 dataStore
>     // ...
> }
> ```
>
> **具体改写步骤**：
> 1. 构造函数从 `class SettingsStore(@ApplicationContext context: Context)` 改为 `class SettingsStore @Inject constructor(private val dataStore: DataStore<Preferences>)`
> 2. 删除类内的 `private val dataStore = context.dataStore` 行（构造函数已注入）
> 3. 类内所有 `context.dataStore` 引用改为 `dataStore`（M1 中 `themeColorIndex`/`searchEngine`/`uaMode`/`homeBackgroundUri`/`homeLogoUri`/`showHomeShortcuts`/`javaScriptEnabled` 等 Flow 属性，以及 `setThemeColor`/`setSearchEngine` 等 suspend 方法中的 `dataStore.edit`）
> 4. 添加 `@Singleton` 注解（与 10.2 节 `provideDataStore` 单例配套）
> 5. 添加 `@Inject constructor` 注解（Hilt 自动注入，无需 @Provides）
> 6. 新增 M2 字段 `defaultHomeMode` + `setDefaultHomeMode()`（见下方代码）
> 7. 10.2 节 DatabaseModule 中**必须删除** `provideSettingsStore` 方法（否则与 @Inject constructor 重复绑定）

```kotlin
// SettingsStore.kt 扩展（在 M1 基础上加）
package com.livingdashboard.data.prefs

import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.stringPreferencesKey
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class SettingsStore @Inject constructor(
    private val dataStore: androidx.datastore.core.DataStore<Preferences>
) {
    // M1 已有的 keys...

    // M2 新增
    val DEFAULT_HOME_MODE_KEY = stringPreferencesKey("default_home_mode")

    /** D4：首次启动选择的主页模式。null = 未选择（首次启动），"browser" / "canvas" */
    val defaultHomeMode: Flow<String?> = dataStore.data.map { it[DEFAULT_HOME_MODE_KEY] }

    suspend fun setDefaultHomeMode(mode: String) {
        dataStore.edit { it[DEFAULT_HOME_MODE_KEY] = mode }
    }
}
```

---

## 五、模块设计

### 5.1 目标目录结构（M2 结束后）

```
client/android/app/src/main/java/com/livingdashboard/
├── LivingDashboardApp.kt              # 已有，M2 改：初始化 WidgetRegistry + 确保聚合面板存在
├── ui/
│   ├── MainActivity.kt                # 已有，M2 改：加首次启动检测 + 模式切换
│   ├── MainViewModel.kt               # 已有，M2 扩展：加 AppMode 状态 + Home 键逻辑
│   ├── theme/                         # 已有，M2 扩展白色洁净色系
│   │   ├── Color.kt                   # 改：加 M2 白色洁净色值
│   │   ├── Theme.kt                   # 不改
│   │   └── Type.kt                    # 不改
│   ├── nav/
│   │   └── AppNavGraph.kt             # 改：加画布相关路由
│   ├── home/
│   │   ├── BrowserHomeScreen.kt       # 已有（M1）
│   │   ├── BrowserHomeViewModel.kt    # 已有（M1）
│   │   └── components/                # 已有（M1）
│   ├── canvas/                        # M2 新增
│   │   ├── CanvasHomeScreen.kt        # 新：画布主页（T1）
│   │   ├── CanvasHomeViewModel.kt     # 新
│   │   ├── CanvasScreen.kt            # 新：分层画布（T3）
│   │   ├── CanvasViewModel.kt         # 新
│   │   ├── components/
│   │   │   ├── CircleIcon.kt          # 新：圆形图标
│   │   │   ├── AIInputPill.kt         # 新：AI 输入框（占位）
│   │   │   ├── FavoriteWidgetGrid.kt  # 新：收藏组件网格
│   │   │   ├── WidgetContainer.kt     # 新：组件容器（拖拽/缩放）
│   │   │   ├── WidgetRenderer.kt      # 新：根据缩放级别渲染组件
│   │   │   └── CanvasBottomBar.kt     # 新：画布模式底部栏（D5）
│   │   └── WebOSFavoritesScreen.kt    # 新：WebOS 收藏组件页（T11）
│   ├── aggregate/                     # M2 新增
│   │   └── AggregatePanelScreen.kt    # 新：聚合面板（T12）
│   ├── onboarding/                    # M2 新增
│   │   └── HomeModeSelectorScreen.kt  # 新：首次启动选择主页（D4）
│   ├── widgets/                       # M2 新增
│   │   ├── WidgetRegistry.kt          # 新：组件注册表
│   │   ├── aiassistant/
│   │   │   └── AIAssistantWidget.kt   # 新：AI 助手组件（D1 占位）
│   │   ├── webview/
│   │   │   └── WebviewWidget.kt       # 新：WebView 组件（D11 前置）
│   │   ├── calculator/
│   │   │   ├── CalculatorWidget.kt    # 新：计算器组件
│   │   │   └── CalculatorEngine.kt    # 新：表达式解析
│   │   ├── focustimer/
│   │   │   └── FocusTimerWidget.kt    # 新：专注计时器组件
│   │   └── htmlcanvas/
│   │       └── HtmlCanvasWidget.kt    # 新：HTML 画布组件（D11 依赖 WebviewWidget）
│   ├── browser/                       # 已有（M1）
│   ├── tab/                           # 已有（M1），M2 改：TabManagerScreen 加 TabRow（网页标签 + 画布面板），承担 T4 面板 CRUD（v4 #12）
│   ├── bookmark/                      # 已有（M1）
│   ├── history/                       # 已有（M1）
│   ├── settings/                      # 已有，M2 加"默认主页"设置项
│   └── components/                    # 已有，M2 扩展
│       ├── BottomBar.kt               # 改：支持画布模式（D5）
│       └── MoreMenuSheet.kt           # 已有（M1）
├── browser/                           # 已有（M1）
├── canvas/                            # M2 新增
│   ├── CanvasEngine.kt               # 新：画布引擎（缩放/平移/坐标转换）
│   └── CanvasTransform.kt            # 新：画布变换状态
├── data/                              # 已有（M1），M2 扩展
│   ├── db/
│   │   ├── LivingDatabase.kt          # 改：version 2 + 新表
│   │   └── Converters.kt             # 改：加新类型转换
│   ├── dao/
│   │   ├── BookmarkDao.kt            # 已有（M1）
│   │   ├── HistoryDao.kt             # 已有（M1）
│   │   ├── TabDao.kt                 # 已有（M1）
│   │   ├── PanelDao.kt               # 新
│   │   ├── WidgetDao.kt              # 新
│   │   ├── WidgetPositionDao.kt      # 新
│   │   └── FavoriteDao.kt            # 新
│   ├── entity/
│   │   ├── BookmarkEntity.kt         # 已有（M1）
│   │   ├── HistoryEntity.kt          # 已有（M1）
│   │   ├── TabEntity.kt              # 已有（M1）
│   │   ├── PanelEntity.kt            # 新
│   │   ├── WidgetEntity.kt           # 新
│   │   ├── WidgetPositionEntity.kt   # 新
│   │   └── FavoriteEntryEntity.kt    # 新
│   ├── repository/
│   │   ├── BookmarkRepository.kt     # 已有（M1）
│   │   ├── HistoryRepository.kt      # 已有（M1）
│   │   ├── TabRepository.kt          # 已有（M1）
│   │   └── CanvasRepository.kt       # 新
│   └── prefs/
│       └── SettingsStore.kt          # 改：加 defaultHomeMode
├── di/
│   ├── AppModule.kt                  # 改：加 CanvasRepository @Provides
│   └── DatabaseModule.kt             # 改：加新 DAO @Provides
└── sync/                              # 已有（M1），M2 不改
```

### 5.2 CanvasEngine（画布引擎）

负责画布的缩放/平移/坐标转换。参考桌面端 `Workspace.tsx` 的 `canvasTransform` + `screenToCanvas`。

```kotlin
package com.livingdashboard.canvas

import androidx.compose.runtime.Immutable

/** 画布变换状态（缩放 + 平移） */
@Immutable
data class CanvasTransform(
    val x: Float = 0f,      // 平移 X（屏幕坐标）
    val y: Float = 0f,      // 平移 Y（屏幕坐标）
    val zoom: Float = 1f    // 缩放级别（1.0 = 100%）
) {
    companion object {
        val INITIAL = CanvasTransform(x = 0f, y = 0f, zoom = 1f)
        const val MIN_ZOOM = 0.15f   // < 0.3x 缩略图级别
        const val MAX_ZOOM = 2.0f    // > 1.0x 完整组件级别
    }
}

/**
 * 缩放级别分档（D9）。
 * <0.3x  → THUMBNAIL（缩略图：只显示图标+标题）
 * 0.3-0.7x → CARD_SUMMARY（卡片摘要：显示摘要信息）
 * 0.7-1.0x → INTERACTIVE_CARD（可交互卡片：完整组件，可交互）
 * >1.0x → FULL（完整组件：放大查看细节）
 */
enum class ZoomLevel {
    THUMBNAIL,       // zoom < 0.3
    CARD_SUMMARY,    // 0.3 <= zoom < 0.7
    INTERACTIVE_CARD,// 0.7 <= zoom <= 1.0
    FULL;            // zoom > 1.0

    companion object {
        fun fromZoom(zoom: Float): ZoomLevel = when {
            zoom < 0.3f -> THUMBNAIL
            zoom < 0.7f -> CARD_SUMMARY
            zoom <= 1.0f -> INTERACTIVE_CARD
            else -> FULL
        }
    }
}

/**
 * 画布引擎：坐标转换 + 缩放钳制。
 * 参考 Workspace.tsx 的 screenToCanvas。
 */
object CanvasEngine {
    /** 屏幕坐标 → 画布坐标 */
    fun screenToCanvas(
        screenX: Float,
        screenY: Float,
        transform: CanvasTransform
    ): Pair<Float, Float> {
        val canvasX = (screenX - transform.x) / transform.zoom
        val canvasY = (screenY - transform.y) / transform.zoom
        return canvasX to canvasY
    }

    /** 画布坐标 → 屏幕坐标 */
    fun canvasToScreen(
        canvasX: Float,
        canvasY: Float,
        transform: CanvasTransform
    ): Pair<Float, Float> {
        val screenX = canvasX * transform.zoom + transform.x
        val screenY = canvasY * transform.zoom + transform.y
        return screenX to screenY
    }

    /** 钳制缩放级别 */
    fun clampZoom(zoom: Float): Float =
        zoom.coerceIn(CanvasTransform.MIN_ZOOM, CanvasTransform.MAX_ZOOM)
}
```

### 5.3 WidgetRegistry（组件注册表）

```kotlin
package com.livingdashboard.ui.widgets

import androidx.compose.runtime.Composable
import com.livingdashboard.data.entity.WidgetType
import com.livingdashboard.ui.canvas.ZoomLevel

/**
 * 组件注册信息。
 * @param type 组件类型
 * @param displayName 显示名称
 * @param defaultWidth 默认宽度（dp）
 * @param defaultHeight 默认高度（dp）
 * @param iconRes 图标资源 ID
 * @param render 渲染函数（根据缩放级别渲染不同呈现）
 */
data class WidgetDefinition(
    val type: WidgetType,
    val displayName: String,
    val defaultWidth: Float,
    val defaultHeight: Float,
    val iconRes: Int,
    val render: @Composable (WidgetRenderParams) -> Unit
)

data class WidgetRenderParams(
    val widgetId: String,
    val panelId: String,
    val type: WidgetType,           // NC2：补充 type 字段（WidgetRenderer 查找 definition 用）
    val state: Map<String, Any>,
    val zoomLevel: ZoomLevel,
    val onUpdateState: (Map<String, Any>) -> Unit,
    val onToggleFavorite: () -> Unit,
    val isFavorite: Boolean
)

object WidgetRegistry {
    private val definitions = mutableMapOf<WidgetType, WidgetDefinition>()

    fun register(definition: WidgetDefinition) {
        definitions[definition.type] = definition
    }

    fun get(type: WidgetType): WidgetDefinition? = definitions[type]

    fun getAll(): List<WidgetDefinition> = definitions.values.toList()

    /** App 启动时注册所有 MVP 组件 */
    fun init() {
        register(AIAssistantWidget.definition)
        register(WebviewWidget.definition)
        register(CalculatorWidget.definition)
        register(FocusTimerWidget.definition)
        register(HtmlCanvasWidget.definition)
    }
}
```

### 5.4 WidgetRenderer（根据缩放级别渲染）

```kotlin
package com.livingdashboard.ui.canvas.components

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.livingdashboard.canvas.ZoomLevel
import com.livingdashboard.ui.widgets.WidgetRegistry
import com.livingdashboard.ui.widgets.WidgetRenderParams

/**
 * 根据缩放级别渲染组件（D9）。
 * - THUMBNAIL：只显示图标 + 标题
 * - CARD_SUMMARY / INTERACTIVE_CARD / FULL：调用 WidgetDefinition.render
 */
@Composable
fun WidgetRenderer(
    params: WidgetRenderParams,
    modifier: Modifier = Modifier
) {
    val definition = WidgetRegistry.get(params.type)
    if (definition == null) {
        UnknownWidget(modifier)
        return
    }

    when (params.zoomLevel) {
        ZoomLevel.THUMBNAIL -> ThumbnailWidget(definition, modifier)
        ZoomLevel.CARD_SUMMARY,
        ZoomLevel.INTERACTIVE_CARD,
        ZoomLevel.FULL -> {
            // 交互级别：调用组件的 render 函数
            // D6 白色洁净色系：透明背景、无边框、圆角
            Box(
                modifier = modifier
                    .background(
                        color = Color(0x08000000),  // rgba(0,0,0,0.03)
                        shape = RoundedCornerShape(12.dp)
                    )
            ) {
                definition.render(params)
            }
        }
    }
}

/**
 * v4 #21：缩略图占位（公开，供 CanvasScreen 视口剔除用）。
 * 超出视口的组件用此占位，只显示图标+标题，不渲染 WebView，节省内存。
 */
@Composable
fun ThumbnailPlaceholder(
    definition: com.livingdashboard.ui.widgets.WidgetDefinition,
    modifier: Modifier = Modifier
) {
    Column(
        modifier = modifier.padding(8.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center
    ) {
        Icon(
            painter = painterResource(definition.iconRes),
            contentDescription = definition.displayName,
            modifier = Modifier.size(24.dp),
            tint = Color(0xFF666666)
        )
        Text(
            text = definition.displayName,
            fontSize = 10.sp,
            color = Color(0xFF999999)
        )
    }
}

@Composable
private fun ThumbnailWidget(
    definition: com.livingdashboard.ui.widgets.WidgetDefinition,
    modifier: Modifier
) = ThumbnailPlaceholder(definition, modifier)

@Composable
private fun UnknownWidget(modifier: Modifier) {
    Box(
        modifier = modifier.background(Color(0xFFFFE0E0), RoundedCornerShape(8.dp)),
        contentAlignment = Alignment.Center
    ) {
        Text("未知组件", fontSize = 12.sp, color = Color(0xFFFF0000))
    }
}
```

### 5.5 WidgetContainer（拖拽容器，D8 + NC6 修复）

> **NC6 修复**：原实现用 `detectTransformGestures` 处理拖拽，但该 API 没有手势结束回调，导致 `isDragging` 设为 true 后永不回 false，`LaunchedEffect(isDragging)` 的 `!isDragging` 分支永远不执行，拖拽位置永不提交。
>
> **修复方案**：改用 `detectDragGesturesAfterLongPress`（有 `onDragEnd`/`onDragCancel` 回调），自然实现 D8"长按进入拖拽模式"语义。
>
> **设计冲突解决（D8 vs T10）**：D8 要"长按进入拖拽模式"，T10 要"长按弹出菜单→收藏"。两者都用长按手势，冲突。解决：长按+拖拽 = 移动组件（D8/T7）；收藏/删除入口改为组件右上角"⋮"按钮（T10 修订）。这避免了手势冲突，且符合移动端习惯（组件有可见操作入口，不用猜手势）。

```kotlin
package com.livingdashboard.ui.canvas.components

import androidx.compose.foundation.gestures.detectDragGesturesAfterLongPress
import androidx.compose.foundation.layout.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.dp
import com.livingdashboard.canvas.CanvasTransform
import com.livingdashboard.canvas.ZoomLevel
import com.livingdashboard.data.entity.WidgetPositionEntity
import com.livingdashboard.ui.widgets.WidgetRenderParams

/**
 * 组件容器：处理长按拖拽（D8 + NC6 修复）。
 *
 * - 长按 + 拖拽：移动组件位置（detectDragGesturesAfterLongPress 有 onDragEnd 回调）
 * - 双指缩放/平移：由父级 CanvasScreen 的 detectTransformGestures 处理（不在 WidgetContainer）
 * - 收藏/删除：组件右上角"⋮"按钮弹出菜单（T10 修订，避免与长按拖拽冲突）
 *
 * @param position 组件位置（画布坐标）
 * @param widgetSize 组件尺寸（width, height in dp）
 * @param transform 当前画布变换
 * @param onMove 拖拽结束回调（画布坐标增量）
 * @param onShowMenu 点击"⋮"按钮回调（弹出收藏/删除菜单）
 */
@Composable
fun WidgetContainer(
    params: WidgetRenderParams,
    position: WidgetPositionEntity,
    widgetSize: Pair<Float, Float>,
    transform: CanvasTransform,
    onMove: (Float, Float) -> Unit,
    onShowMenu: () -> Unit,
    modifier: Modifier = Modifier
) {
    // 拖拽期间的临时偏移（屏幕坐标）
    var dragOffset by remember { mutableStateOf(Offset.Zero) }

    // NC6 修复：用 rememberUpdatedState 确保 pointerInput 长生命周期协程中读到最新值
    // （pointerInput 只在 widgetId 变化时重启，期间 transform/onMove 可能已更新）
    val currentTransform by rememberUpdatedState(transform)
    val currentOnMove by rememberUpdatedState(onMove)

    val zoomLevel = ZoomLevel.fromZoom(currentTransform.zoom)
    val density = LocalDensity.current

    // 计算屏幕位置 = 画布坐标 * zoom + transform + dragOffset
    val screenX = position.x * currentTransform.zoom + currentTransform.x + dragOffset.x
    val screenY = position.y * currentTransform.zoom + currentTransform.y + dragOffset.y

    // v4 #20 修复：用 graphicsLayer 替代 offset+size，避免拖拽/缩放期间每帧触发重新布局
    // - graphicsLayer 只更新绘制层（GPU 合成层），不触发 measure/layout
    // - translationX/Y 为屏幕像素（Float），scaleX/Y 为缩放系数
    // - 内部 Box 使用未缩放的 widgetSize，由 graphicsLayer 的 scaleX/Y 视觉缩放
    Box(
        modifier = modifier
            .graphicsLayer {
                translationX = screenX
                translationY = screenY
                scaleX = currentTransform.zoom
                scaleY = currentTransform.zoom
            }
            .size(
                width = with(density) { widgetSize.first.toDp() },
                height = with(density) { widgetSize.second.toDp() }
            )
            // NC6 修复：用 detectDragGesturesAfterLongPress 替代 detectTransformGestures
            // 原因：detectTransformGestures 没有 onEnd 回调，无法检测拖拽结束
            // detectDragGesturesAfterLongPress 有 onDragEnd/onDragCancel，能正确提交位置
            //
            // v6 #22 修复（最终方案）：双指缩放与长按拖拽手势冲突缓解。
            // Compose 手势分发机制：pointerInput 修饰符的事件会分发给所有子节点 + 父节点。
            // detectDragGesturesAfterLongPress 在长按阈值（约 400ms）到达前**不消费事件**，
            // 因此在长按阈值前若第二根手指落下，父级 CanvasScreen 的 detectTransformGestures
            // 能正常接收到双指事件并处理缩放/平移。
            //
            // 边缘场景限制（M2 可接受）：
            // 若用户先长按组件（已过 400ms 阈值，WidgetContainer 进入拖拽态并开始消费事件），
            // 再落下第二根手指，此时 WidgetContainer 已消费事件，父级 detectTransformGestures
            // 无法介入，双指缩放不工作。用户需抬起手指重新双指缩放。
            // 此边缘场景在 M2 阶段不完美解决，记录在 12.1 风险表中，留待 M7+ 用 awaitEachGesture
            // 自实现长按+拖拽+多指检测来彻底解决。
            .pointerInput(position.widgetId) {
                detectDragGesturesAfterLongPress(
                    onDragStart = {
                        // 长按阈值已过，开始拖拽（不需要额外状态标记）
                    },
                    onDrag = { change, dragAmount ->
                        change.consume()
                        // 累积屏幕坐标增量
                        dragOffset += dragAmount
                    },
                    onDragEnd = {
                        // 手指抬起：提交位置并重置
                        if (dragOffset != Offset.Zero) {
                            val canvasDx = dragOffset.x / currentTransform.zoom
                            val canvasDy = dragOffset.y / currentTransform.zoom
                            currentOnMove(canvasDx, canvasDy)
                            dragOffset = Offset.Zero
                        }
                    },
                    onDragCancel = {
                        // 取消拖拽：丢弃偏移，不提交
                        dragOffset = Offset.Zero
                    }
                )
            }
    ) {
        WidgetRenderer(
            params = params.copy(zoomLevel = zoomLevel),
            modifier = Modifier.fillMaxSize()
        )

        // T10 修订：右上角"⋮"按钮，点击弹出收藏/删除菜单
        // 仅在可交互缩放级别显示（THUMBNAIL 级别不显示，避免遮挡）
        if (zoomLevel != ZoomLevel.THUMBNAIL) {
            WidgetMenuButton(
                onClick = onShowMenu,
                modifier = Modifier.align(Alignment.TopEnd).padding(4.dp)
            )
        }
    }
}

/** 组件菜单按钮（⋮） */
@Composable
private fun WidgetMenuButton(
    onClick: () -> Unit,
    modifier: Modifier = Modifier
) {
    androidx.compose.material3.IconButton(
        onClick = onClick,
        modifier = modifier.size(24.dp)
    ) {
        androidx.compose.material3.Icon(
            painter = androidx.compose.ui.res.painterResource(
                android.R.drawable.ic_menu_more
            ),
            contentDescription = "组件菜单",
            tint = androidx.compose.ui.graphics.Color(0xFF666666),
            modifier = Modifier.size(16.dp)
        )
    }
}
```

**说明**：
- NC6 修复：`detectDragGesturesAfterLongPress` 有 `onDragEnd`（正常结束）和 `onDragCancel`（被其他手势打断）回调，确保拖拽位置总能提交或清理
- D8 实现：`detectDragGesturesAfterLongPress` 天然实现"长按进入拖拽模式"语义（长按阈值过后才开始 drag 回调）
- 缩放/平移：由父级 `CanvasScreen` 的 `detectTransformGestures` 处理，WidgetContainer 不处理（避免手势冲突）
- `rememberUpdatedState`：`pointerInput(position.widgetId)` 只在 widgetId 变化时重启，期间 `transform`/`onMove` 可能已更新，用 `rememberUpdatedState` 确保读到最新值
- T10 修订：收藏/删除入口从"长按"改为"⋮ 按钮"，避免与 D8 长按拖拽冲突
- v4 #14 修复：补充 `import androidx.compose.ui.Alignment`，修复 `Alignment.TopEnd` 未解析的编译错误
- v4 #20 修复：用 `Modifier.graphicsLayer { translationX/Y; scaleX/Y }` 替代 `.offset()`+`.size(scaled)`，避免拖拽/缩放期间每帧触发 measure/layout（仅更新 GPU 合成层）；Box 内部使用未缩放的 `widgetSize`，由 `scaleX = zoom` 视觉缩放；与 6.3 节 `ThumbnailPlaceholder` 的 graphicsLayer 用法保持一致；与 12.1 风险表的缓解措施一致
- v6 #22 修复（最终方案）：删除 v5 中不可编译的多指检测代码（`change.pointerId` 不是 PointerInputChange 的有效字段，且 onDrag 回调无法检测第二根手指落下）。改为依赖 Compose 内置手势分发机制：`detectDragGesturesAfterLongPress` 在长按阈值（~400ms）前不消费事件，双指在阈值前落下时父级 `detectTransformGestures` 自动接管。边缘场景（长按阈值后落第二指）在 M2 阶段不完美解决，记录在 12.1 风险表，M7+ 用 `awaitEachGesture` 自实现彻底解决

---

## 六、页面详细设计

### 6.1 CanvasHomeScreen（画布主页，T1）

参考 `layout-design-mobile.md` 第 2.10 节 + 桌面端 `CanvasHome.tsx`。

```kotlin
package com.livingdashboard.ui.canvas

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.gestures.detectVerticalDragGestures
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.filled.Send
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.livingdashboard.ui.components.BottomBar
import com.livingdashboard.ui.components.BottomBarMode
import com.livingdashboard.ui.components.CanvasMoreMenuSheet

@Composable
fun CanvasHomeScreen(
    onCircleIconClick: () -> Unit,           // v4 #9：点击圆形图标进入画布面板
    onFavoriteClick: (String) -> Unit,       // v5 #N4：点击收藏组件 → WebOS 页
    onSwipeDownToCanvas: () -> Unit,         // v5 #N4：下滑进入画布
    onShowAggregate: () -> Unit,             // v5 #N4：显示聚合面板
    onShowTabs: () -> Unit,                  // v5 #N6：BottomBar 标签按钮
    onShowSettings: () -> Unit,              // v5 #N6：BottomBar 更多菜单 → 设置
    onAddWidget: () -> Unit = {},            // 添加组件（可选，默认无操作）
    viewModel: CanvasHomeViewModel = hiltViewModel()
) {
    val favorites by viewModel.favorites.collectAsStateWithLifecycle()
    val aiInputText by viewModel.aiInputText.collectAsStateWithLifecycle()
    val aiExpanded by viewModel.aiExpanded.collectAsStateWithLifecycle()  // v4 #10
    val aiMessages by viewModel.aiMessages.collectAsStateWithLifecycle()  // v4 #18

    // v5 #N6：BottomBar 更多菜单展开状态
    var showMoreMenu by remember { mutableStateOf(false) }

    // v4 #10：点击外部收起 AI 输入框
    val focusManager = LocalFocusManager.current
    BackHandler(enabled = aiExpanded) {
        viewModel.collapseAi()
        focusManager.clearFocus()
    }

    // v5 #N6：用 Box 包裹，让 BottomBar 固定在底部
    Box(modifier = Modifier.fillMaxSize().background(Color.White)) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(horizontal = 16.dp, vertical = 24.dp)
        ) {
            // 1. 圆形图标（v4 #9：可点击进入画布面板）
            CircleIcon(
                onClick = onCircleIconClick,
                modifier = Modifier
                    .align(Alignment.CenterHorizontally)
                    .padding(top = 32.dp)
            )

            Spacer(modifier = Modifier.height(24.dp))

            // 2. AI 输入框（v4 #10：收起/展开两态切换）
            AIInputPill(
                text = aiInputText,
                onTextChange = viewModel::onAiInputTextChange,
                onSend = {
                    viewModel.onAiSend()
                    // 发送后保持展开态（layout-design 2.10 要求）
                },
                expanded = aiExpanded,
                messages = aiMessages,
                onFocus = viewModel::expandAi,
                onCollapse = {
                    viewModel.collapseAi()
                    focusManager.clearFocus()
                },
                modifier = Modifier.fillMaxWidth()
            )

            Spacer(modifier = Modifier.height(32.dp))

            // 3. 收藏组件网格
            Text(
                text = "收藏组件",
                fontSize = 14.sp,
                fontWeight = FontWeight.Medium,
                color = Color(0xFF333333)
            )
            Spacer(modifier = Modifier.height(12.dp))
            FavoriteWidgetGrid(
                favorites = favorites,
                onClickFavorite = onFavoriteClick,
                onAddWidget = onAddWidget,
                onLongClickFavorite = { widgetId ->
                    // v5 #3：长按收藏组件 → 取消收藏（CanvasHomeViewModel.toggleFavorite 用途明确）
                    viewModel.toggleFavorite(widgetId)
                },
                modifier = Modifier.weight(1f)
            )

            // 4. 下滑提示
            Spacer(modifier = Modifier.height(8.dp))
            SwipeDownHint(
                onEnterCanvas = onSwipeDownToCanvas,
                modifier = Modifier.align(Alignment.CenterHorizontally)
            )
        }

        // v5 #N6：底部栏（layout-design 2.10 要求 5 按钮对称布局）
        BottomBar(
            mode = BottomBarMode.CANVAS,
            onHome = { /* 已在画布主页，无操作 */ },
            onTabs = onShowTabs,
            onMore = { showMoreMenu = true }
        )
    }

    // v5 #N6：画布模式更多菜单（面板管理/收藏管理/设置）
    CanvasMoreMenuSheet(
        show = showMoreMenu,
        onDismiss = { showMoreMenu = false },
        onOpenPanelManager = onShowTabs,    // 面板管理 → TabManagerScreen
        onOpenFavorites = onShowAggregate,  // 收藏管理 → 聚合面板
        onOpenSettings = onShowSettings
    )
}

/**
 * 圆形图标（可替换，默认 logo）。
 * v4 #9：添加 onClick 参数（layout-design 2.10 要求"点击圆形图标进入画布面板"）。
 */
@Composable
fun CircleIcon(
    modifier: Modifier = Modifier,
    onClick: () -> Unit = {}
) {
    Box(
        modifier = modifier
            .size(72.dp)
            .background(
                color = Color(0x08000000),  // D6 rgba(0,0,0,0.03)
                shape = CircleShape
            )
            .clickable(onClick = onClick),  // v4 #9：可点击
        contentAlignment = Alignment.Center
    ) {
        Icon(
            painter = painterResource(com.livingdashboard.R.drawable.ic_logo),
            contentDescription = "Logo",
            modifier = Modifier.size(40.dp),
            tint = Color.Unspecified
        )
    }
}

/**
 * AI 输入框（D1 占位）。
 * v4 #10：实现收起态/展开态切换（layout-design 2.10）。
 *
 * - 收起态：pill 形状输入框
 * - 展开态：上方对话历史（消息气泡列表），下方固定底部输入框（pill + 发送按钮）
 *   融入页面（无边框、无标题）
 * - 点击输入框聚焦 → 自动展开（onFocus 回调）
 * - 点击外部或按返回 → 收起（onCollapse 回调）
 */
@Composable
fun AIInputPill(
    text: String,
    onTextChange: (String) -> Unit,
    onSend: () -> Unit,
    expanded: Boolean,
    messages: List<AiPlaceholderMessage>,
    onFocus: () -> Unit,
    onCollapse: () -> Unit,
    modifier: Modifier = Modifier
) {
    if (!expanded) {
        // 收起态：pill 形状输入框
        Row(
            modifier = modifier
                .height(44.dp)
                .background(
                    color = Color(0x0D000000),  // D6 rgba(0,0,0,0.05)
                    shape = RoundedCornerShape(22.dp)
                )
                .padding(horizontal = 16.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            TextField(
                value = text,
                onValueChange = onTextChange,
                placeholder = { Text("有什么想问的...", fontSize = 14.sp, color = Color(0xFF999999)) },
                modifier = Modifier.weight(1f),
                colors = TextFieldDefaults.colors(
                    focusedContainerColor = Color.Transparent,
                    unfocusedContainerColor = Color.Transparent,
                    focusedIndicatorColor = Color.Transparent,
                    unfocusedIndicatorColor = Color.Transparent
                ),
                textStyle = LocalTextStyle.current.copy(fontSize = 14.sp),
                interactionSource = remember { MutableInteractionSource() }.also { source ->
                    LaunchedEffect(source) {
                        source.interactions.collect { interaction ->
                            if (interaction is androidx.compose.foundation.interaction.FocusInteraction.Focus) {
                                onFocus()  // 聚焦时自动展开
                            }
                        }
                    }
                }
            )
            IconButton(onClick = {
                onFocus()  // 点击发送按钮也展开
                onSend()
            }, modifier = Modifier.size(32.dp)) {
                Icon(
                    Icons.Default.Add,
                    contentDescription = "发送",
                    tint = Color(0xFF4A90E2)
                )
            }
        }
    } else {
        // 展开态：对话区域融入页面（无边框、无标题）
        Column(modifier = modifier) {
            // 上方：对话历史（消息气泡列表）
            LazyColumn(
                modifier = Modifier
                    .weight(1f)
                    .fillMaxWidth(),
                verticalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                items(messages) { msg ->
                    val isUser = msg.isUser
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = if (isUser) Arrangement.End else Arrangement.Start
                    ) {
                        Box(
                            modifier = Modifier
                                .background(
                                    color = if (isUser) Color(0x0D000000) else Color(0x08000000),
                                    shape = RoundedCornerShape(12.dp)
                                )
                                .padding(horizontal = 12.dp, vertical = 8.dp)
                        ) {
                            Text(
                                text = msg.text,
                                fontSize = 13.sp,
                                color = Color(0xFF333333)
                            )
                        }
                    }
                }
            }

            // 下方：固定底部输入框（pill + 发送按钮）
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .height(44.dp)
                    .background(
                        color = Color(0x0D000000),
                        shape = RoundedCornerShape(22.dp)
                    )
                    .padding(horizontal = 16.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                TextField(
                    value = text,
                    onValueChange = onTextChange,
                    placeholder = { Text("输入消息...", fontSize = 14.sp, color = Color(0xFF999999)) },
                    modifier = Modifier.weight(1f),
                    colors = TextFieldDefaults.colors(
                        focusedContainerColor = Color.Transparent,
                        unfocusedContainerColor = Color.Transparent,
                        focusedIndicatorColor = Color.Transparent,
                        unfocusedIndicatorColor = Color.Transparent
                    ),
                    textStyle = LocalTextStyle.current.copy(fontSize = 14.sp)
                )
                IconButton(onClick = onSend, modifier = Modifier.size(32.dp)) {
                    Icon(
                        Icons.Default.Send,
                        contentDescription = "发送",
                        tint = Color(0xFF4A90E2)
                    )
                }
            }
        }
    }
}

/** 收藏组件网格 */
@Composable
fun FavoriteWidgetGrid(
    favorites: List<FavoriteItem>,
    onClickFavorite: (String) -> Unit,
    onAddWidget: () -> Unit,
    onLongClickFavorite: (String) -> Unit = {},  // v5 #3：长按取消收藏
    modifier: Modifier = Modifier
) {
    LazyVerticalGrid(
        columns = GridCells.Fixed(3),
        modifier = modifier,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        items(favorites) { item ->
            FavoriteCard(
                item = item,
                onClick = { onClickFavorite(item.widgetId) },
                onLongClick = { onLongClickFavorite(item.widgetId) }  // v5 #3
            )
        }
        item {
            AddWidgetCard(onClick = onAddWidget)
        }
    }
}

@Composable
private fun FavoriteCard(
    item: FavoriteItem,
    onClick: () -> Unit,
    onLongClick: () -> Unit = {}  // v5 #3：长按取消收藏
) {
    Card(
        modifier = Modifier
            .fillMaxWidth()
            .aspectRatio(1f)
            .combinedClickable(  // v5 #3：用 combinedClickable 支持长按
                onClick = onClick,
                onLongClick = onLongClick
            ),
        shape = RoundedCornerShape(16.dp),
        colors = CardDefaults.cardColors(
            containerColor = Color(0x08000000)  // D6 rgba(0,0,0,0.03)
        ),
        elevation = CardDefaults.cardElevation(defaultElevation = 0.dp)
    ) {
        Column(
            modifier = Modifier.fillMaxSize().padding(8.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center
        ) {
            Icon(
                painter = painterResource(item.iconRes),
                contentDescription = item.name,
                modifier = Modifier.size(32.dp),
                tint = Color(0xFF666666)
            )
            Text(item.name, fontSize = 11.sp, color = Color(0xFF666666))
        }
    }
}

@Composable
private fun AddWidgetCard(onClick: () -> Unit) {
    Card(
        modifier = Modifier.fillMaxWidth().aspectRatio(1f),
        shape = RoundedCornerShape(16.dp),
        colors = CardDefaults.cardColors(containerColor = Color(0x08000000)),
        elevation = CardDefaults.cardElevation(0.dp),
        onClick = onClick
    ) {
        Box(contentAlignment = Alignment.Center) {
            Icon(Icons.Default.Add, contentDescription = "添加", tint = Color(0xFF999999))
        }
    }
}

/** 下滑提示 */
@Composable
fun SwipeDownHint(
    onEnterCanvas: () -> Unit,
    modifier: Modifier = Modifier
) {
    var dragAccum by remember { mutableStateOf(0f) }

    Column(
        modifier = modifier
            .pointerInput(Unit) {
                detectVerticalDragGestures(
                    onDragStart = { dragAccum = 0f },
                    onVerticalDrag = { _, dragAmount ->
                        // 下滑 dragAmount > 0
                        dragAccum += dragAmount
                    },
                    onDragEnd = {
                        if (dragAccum > 80f) onEnterCanvas()
                    }
                )
            }
            .padding(8.dp),
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        Icon(
            Icons.Default.KeyboardArrowDown,
            contentDescription = "下滑进入画布",
            tint = Color(0xFF999999)
        )
        Text("下滑进入画布", fontSize = 10.sp, color = Color(0xFF999999))
    }
}
```

### 6.2 CanvasHomeViewModel

```kotlin
package com.livingdashboard.ui.canvas

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.livingdashboard.data.entity.PanelType
import com.livingdashboard.data.repository.CanvasRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.launch
import javax.inject.Inject

data class FavoriteItem(
    val widgetId: String,
    val name: String,
    val iconRes: Int,
    val type: com.livingdashboard.data.entity.WidgetType  // NC3：补充 type 字段（WebOS 页查找 definition 用）
)

/** v4 #18：D1 AI 对话占位消息（用于 AIInputPill 展开态显示） */
data class AiPlaceholderMessage(
    val text: String,
    val isUser: Boolean,
    val timestamp: Long
)

@HiltViewModel
class CanvasHomeViewModel @Inject constructor(
    private val canvasRepository: CanvasRepository
) : ViewModel() {

    private val _aiInputText = MutableStateFlow("")
    val aiInputText: StateFlow<String> = _aiInputText.asStateFlow()

    // v4 #10：AI 输入框展开状态（收起态/展开态切换）
    private val _aiExpanded = MutableStateFlow(false)
    val aiExpanded: StateFlow<Boolean> = _aiExpanded.asStateFlow()

    // v4 #18：D1 AI 占位回复（展开态对话历史区域显示）
    private val _aiMessages = MutableStateFlow<List<AiPlaceholderMessage>>(emptyList())
    val aiMessages: StateFlow<List<AiPlaceholderMessage>> = _aiMessages.asStateFlow()

    // NC9 修复：暴露当前面板 ID（第一个非聚合面板，或聚合面板），供 onEnterCanvas 导航用
    val currentPanelId: StateFlow<String?> = canvasRepository.observePanels()
        .map { panels -> panels.firstOrNull { it.type != PanelType.AGGREGATE }?.id ?: panels.firstOrNull()?.id }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), null)

    val favorites: StateFlow<List<FavoriteItem>> = canvasRepository.observeFavorites()
        .combine(canvasRepository.observeAggregateWidgets()) { favEntries, widgets ->
            // v4 #2：用 observeAggregateWidgets（JOIN widget_positions + widgets）替代 observeAllWidgets
            // 保证 favorites 列表与聚合面板真实引用一致
            favEntries.mapNotNull { entry ->
                val widget = widgets.find { it.id == entry.widgetId }
                if (widget != null) {
                    val def = com.livingdashboard.ui.widgets.WidgetRegistry.get(widget.type)
                    FavoriteItem(
                        widgetId = widget.id,
                        name = def?.displayName ?: "未知",
                        iconRes = def?.iconRes ?: android.R.drawable.ic_menu_help,
                        type = widget.type  // NC3：补充 type 字段
                    )
                } else null
            }
        }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), emptyList())

    fun onAiInputTextChange(text: String) {
        _aiInputText.value = text
    }

    // v4 #10：AI 输入框展开/收起控制
    fun expandAi() { _aiExpanded.value = true }
    fun collapseAi() { _aiExpanded.value = false }

    /**
     * v4 #18：D1 AI 占位策略。
     *
     * 发送消息时：
     * 1. 把用户消息加入对话历史（展开态显示）
     * 2. 立即回显 AI 占位回复"AI 功能将在 M3 接入"
     * 3. 清空输入框
     * 4. 保持展开态
     *
     * M3 接入 AI 后替换为真实 sendMessage。
     */
    fun onAiSend() {
        val text = _aiInputText.value
        if (text.isBlank()) return

        val now = System.currentTimeMillis()
        _aiMessages.value = _aiMessages.value + AiPlaceholderMessage(
            text = text,
            isUser = true,
            timestamp = now
        )
        _aiInputText.value = ""

        // D1 占位回复（M2 不接 AI 后端）
        viewModelScope.launch {
            delay(300)  // 模拟 AI 思考延迟
            _aiMessages.value = _aiMessages.value + AiPlaceholderMessage(
                text = "AI 功能将在 M3 接入",
                isUser = false,
                timestamp = System.currentTimeMillis()
            )
        }
        // TODO(M3): 接入 AI session，发送消息
    }

    /**
     * v4 #3 / v5 #3：CanvasHomeScreen 长按收藏组件取消收藏。
     *
     * **用途**（v5 #3 明确）：CanvasHomeScreen 的 FavoriteWidgetGrid 中，长按收藏组件卡片
     * 触发此方法 → 调用 canvasRepository.toggleFavorite(widgetId) → 同步删除 favorites 表记录
     * + widget_positions 表中聚合面板的位置记录（D7 真实引用，4.8 节 toggleFavorite 实现）。
     *
     * **调用方**：6.1 CanvasHomeScreen → FavoriteWidgetGrid → FavoriteCard.onLongClick
     * （v5 #3：FavoriteCard 用 combinedClickable(onLongClick = ...) 接入）
     *
     * **注意**：6.5 WebOSFavoritesScreen 用的是 WebOSFavoritesViewModel.toggleFavorite（独立 ViewModel），
     * 不是此方法。两个 ViewModel 各自注入 CanvasRepository，最终都调用 canvasRepository.toggleFavorite。
     */
    fun toggleFavorite(widgetId: String) {
        viewModelScope.launch {
            canvasRepository.toggleFavorite(widgetId)
        }
    }
}
```

### 6.3 CanvasScreen（分层画布，T3）

参考 `layout-design-mobile.md` 第 2.11 节 + 桌面端 `Workspace.tsx`。

```kotlin
package com.livingdashboard.ui.canvas

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectTransformGestures
import androidx.compose.foundation.layout.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.livingdashboard.ui.components.BottomBar
import com.livingdashboard.ui.components.BottomBarMode
import com.livingdashboard.ui.components.CanvasMoreMenuSheet

@Composable
fun CanvasScreen(
    panelId: String,
    onBack: () -> Unit,                 // 返回画布主页（v5 #N7：BackHandler + BottomBar Home 按钮调用）
    onShowTabs: () -> Unit = {},        // v5 #N6：BottomBar 标签按钮
    onShowSettings: () -> Unit = {},    // v5 #N6：BottomBar 更多菜单 → 设置
    viewModel: CanvasViewModel = hiltViewModel()
) {
    val transform by viewModel.transform.collectAsStateWithLifecycle()
    val widgets by viewModel.observeWidgets(panelId).collectAsStateWithLifecycle(emptyList())
    val positions by viewModel.observePositions(panelId).collectAsStateWithLifecycle(emptyList())
    val menuWidgetId by viewModel.menuWidgetId.collectAsStateWithLifecycle()  // NC6/T10：组件菜单

    // v4 #21：视口检测——只渲染可见组件，超出视口的用 ThumbnailWidget 占位
    // 避免大量 WebView 同时渲染导致内存溢出（WebviewWidget + HtmlCanvasWidget）
    val configuration = androidx.compose.ui.platform.LocalConfiguration.current
    val screenWidthPx = with(androidx.compose.ui.platform.LocalDensity.current) { configuration.screenWidthDp.dp.toPx() }
    val screenHeightPx = with(androidx.compose.ui.platform.LocalDensity.current) { configuration.screenHeightDp.dp.toPx() }

    // v5 #N7：系统返回键 → onBack（返回画布主页）
    BackHandler { onBack() }

    // v5 #N6：BottomBar 更多菜单展开状态
    var showMoreMenu by remember { mutableStateOf(false) }

    // v5 #N6：用 Column 包裹，让 BottomBar 固定在底部
    Column(modifier = Modifier.fillMaxSize().background(Color.White)) {
        // 双指缩放/平移手势
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .weight(1f)  // v5 #N6：让出底部空间给 BottomBar
                .pointerInput(panelId) {
                    detectTransformGestures(
                        onGesture = { centroid, pan, zoom, _ ->
                            viewModel.onCanvasGesture(centroid, pan, zoom)
                        }
                    )
                }
        ) {
            // 渲染所有组件（带视口检测）
            widgets.forEach { widget ->
                val position = positions.find { it.widgetId == widget.id } ?: return@forEach
                val def = com.livingdashboard.ui.widgets.WidgetRegistry.get(widget.type) ?: return@forEach

                // v4 #21：计算组件在屏幕上的位置（含 transform）
                val screenX = position.x * transform.zoom + transform.x
                val screenY = position.y * transform.zoom + transform.y
                val scaledWidth = def.defaultWidth * transform.zoom
                val scaledHeight = def.defaultHeight * transform.zoom

                // 视口剔除：完全在屏幕外的不渲染
                val isVisible = screenX + scaledWidth >= 0 &&
                    screenX <= screenWidthPx &&
                    screenY + scaledHeight >= 0 &&
                    screenY <= screenHeightPx

                if (!isVisible) {
                    // v4 #21：超出视口用 ThumbnailWidget 占位（只显示图标+标题，不渲染 WebView）
                    com.livingdashboard.ui.canvas.components.ThumbnailPlaceholder(
                        definition = def,
                        modifier = Modifier
                            .graphicsLayer {
                                translationX = screenX
                                translationY = screenY
                                scaleX = transform.zoom
                                scaleY = transform.zoom
                            }
                    )
                } else {
                    com.livingdashboard.ui.canvas.components.WidgetContainer(
                        params = com.livingdashboard.ui.widgets.WidgetRenderParams(
                            widgetId = widget.id,
                            panelId = panelId,
                            type = widget.type,  // NC2：补充 type 字段
                            state = parseStateJson(widget.stateJson),
                            zoomLevel = com.livingdashboard.canvas.ZoomLevel.fromZoom(transform.zoom),
                            onUpdateState = { newState -> viewModel.updateWidgetState(widget.id, newState) },
                            onToggleFavorite = { viewModel.toggleFavorite(widget.id) },
                            isFavorite = viewModel.isFavorite(widget.id)
                        ),
                        position = position,
                        widgetSize = def.defaultWidth to def.defaultHeight,
                        transform = transform,
                        onMove = { dx, dy -> viewModel.moveWidget(panelId, widget.id, dx, dy) },
                        onShowMenu = { viewModel.showWidgetMenu(widget.id) }  // NC6/T10：⋮ 按钮弹出菜单
                    )
                }
            }
        }

        // v5 #N6：底部栏（layout-design 2.11 要求画布页有底部栏）
        // v5 #N7：onHome 调用 onBack（返回画布主页）
        BottomBar(
            mode = BottomBarMode.CANVAS,
            onZoomOut = { viewModel.zoomOut() },
            onZoomIn = { viewModel.zoomIn() },
            onHome = onBack,         // v5 #N7：Home 按钮 → 返回画布主页
            onTabs = onShowTabs,
            onMore = { showMoreMenu = true }
        )
    }

    // NC6/T10：组件菜单 ModalBottomSheet（收藏/删除）
    if (menuWidgetId != null) {
        val widgetId = menuWidgetId!!
        val isFavorite = viewModel.isFavorite(widgetId)
        androidx.compose.material3.ModalBottomSheet(
            onDismissRequest = { viewModel.dismissWidgetMenu() }
        ) {
            androidx.compose.foundation.layout.Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(16.dp)
            ) {
                androidx.compose.material3.ListItem(
                    headlineContent = { androidx.compose.material3.Text(if (isFavorite) "取消收藏" else "收藏") },
                    leadingContent = { androidx.compose.material3.Icon(androidx.compose.ui.res.painterResource(android.R.drawable.btn_star), contentDescription = null) },
                    modifier = Modifier.clickable {
                        viewModel.toggleFavorite(widgetId)
                        viewModel.dismissWidgetMenu()
                    }
                )
                androidx.compose.material3.ListItem(
                    headlineContent = { androidx.compose.material3.Text("删除组件") },
                    leadingContent = { androidx.compose.material3.Icon(androidx.compose.ui.res.painterResource(android.R.drawable.ic_menu_delete), contentDescription = null) },
                    modifier = Modifier.clickable {
                        viewModel.deleteWidget(widgetId)
                    }
                )
            }
        }
    }

    // v5 #N6：画布模式更多菜单
    CanvasMoreMenuSheet(
        show = showMoreMenu,
        onDismiss = { showMoreMenu = false },
        onOpenPanelManager = onShowTabs,
        onOpenFavorites = onShowTabs,   // 画布页的"收藏管理"也进入 TabManagerScreen（画布面板 Tab）
        onOpenSettings = onShowSettings
    )
}

private fun parseStateJson(json: String): Map<String, Any> {
    val obj = org.json.JSONObject(json)
    val map = mutableMapOf<String, Any>()
    for (key in obj.keys()) {
        map[key] = obj.get(key)
    }
    return map
}
```

### 6.4 CanvasViewModel

```kotlin
package com.livingdashboard.ui.canvas

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.livingdashboard.canvas.CanvasEngine
import com.livingdashboard.canvas.CanvasTransform
import com.livingdashboard.data.entity.PanelType
import com.livingdashboard.data.entity.WidgetEntity
import com.livingdashboard.data.entity.WidgetPositionEntity
import com.livingdashboard.data.repository.CanvasRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.launch
import javax.inject.Inject

@HiltViewModel
class CanvasViewModel @Inject constructor(
    private val canvasRepository: CanvasRepository
) : ViewModel() {

    private val _transform = MutableStateFlow(CanvasTransform.INITIAL)
    val transform: StateFlow<CanvasTransform> = _transform.asStateFlow()

    // NC5 修复：用 StateFlow 缓存收藏 widgetId 集合，避免主线程 runBlocking
    private val _favoriteWidgetIds = MutableStateFlow<Set<String>>(emptySet())
    val favoriteWidgetIds: StateFlow<Set<String>> = _favoriteWidgetIds.asStateFlow()

    // NC12 修复：聚合面板 ID（AggregatePanelScreen 用）
    val aggregatePanelId: StateFlow<String?> = canvasRepository.observePanels()
        .map { panels -> panels.firstOrNull { it.type == PanelType.AGGREGATE }?.id }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), null)

    init {
        // NC5：启动时订阅 favorites 流，更新缓存
        viewModelScope.launch {
            canvasRepository.observeFavorites().collect { favorites ->
                _favoriteWidgetIds.value = favorites.map { it.widgetId }.toSet()
            }
        }
        // v5 #N8：移除 cacheAggregatePanelId() 调用——observeAggregateWidgets() 现在通过
        // observeAggregatePanelId().flatMapLatest 自动感知聚合面板 ID，无需手动缓存
    }

    /**
     * v4 #4：observeWidgets 修复聚合面板查询漏洞。
     *
     * 聚合面板在 widgets 表中没有自己的记录（不复制组件数据），
     * 直接调用 canvasRepository.observeWidgets(panelId) 会返回空列表。
     *
     * 修复：用 flatMapLatest 监听 aggregatePanelId 变化，当 panelId == 聚合面板 ID 时
     * 走 observeAggregateWidgets()（JOIN widget_positions + widgets），
     * 否则走普通 observeWidgets(panelId)。
     */
    @OptIn(kotlinx.coroutines.ExperimentalCoroutinesApi::class)
    fun observeWidgets(panelId: String): Flow<List<WidgetEntity>> {
        return aggregatePanelId.flatMapLatest { aggId ->
            if (panelId == aggId) {
                canvasRepository.observeAggregateWidgets()
            } else {
                canvasRepository.observeWidgets(panelId)
            }
        }
    }

    fun observePositions(panelId: String): Flow<List<WidgetPositionEntity>> =
        canvasRepository.observePositions(panelId)

    /** 双指缩放/平移手势处理 */
    fun onCanvasGesture(centroid: Offset, pan: Offset, zoom: Float) {
        val current = _transform.value
        val newZoom = CanvasEngine.clampZoom(current.zoom * zoom)

        // 以手势中心点为缩放锚点
        val newX = centroid.x - (centroid.x - current.x) * (newZoom / current.zoom) + pan.x
        val newY = centroid.y - (centroid.y - current.y) * (newZoom / current.zoom) + pan.y

        _transform.value = CanvasTransform(x = newX, y = newY, zoom = newZoom)
    }

    /** 重置画布 */
    fun resetTransform() {
        _transform.value = CanvasTransform.INITIAL
    }

    /** 缩放到指定级别 */
    fun setZoom(zoom: Float) {
        val clamped = CanvasEngine.clampZoom(zoom)
        _transform.value = _transform.value.copy(zoom = clamped)
    }

    // v4 #13：T8 缩放按钮实现（底部栏缩小/放大按钮调用）
    fun zoomOut() {
        _transform.value = _transform.value.copy(
            zoom = (_transform.value.zoom * 0.8f).coerceAtLeast(CanvasTransform.MIN_ZOOM)
        )
    }

    fun zoomIn() {
        _transform.value = _transform.value.copy(
            zoom = (_transform.value.zoom * 1.25f).coerceAtMost(CanvasTransform.MAX_ZOOM)
        )
    }

    fun moveWidget(panelId: String, widgetId: String, dx: Float, dy: Float) {
        viewModelScope.launch {
            val pos = canvasRepository.observePositions(panelId).first()
                .find { it.widgetId == widgetId }
            if (pos != null) {
                canvasRepository.updatePosition(panelId, widgetId, pos.x + dx, pos.y + dy)
            }
        }
    }

    fun updateWidgetState(widgetId: String, state: Map<String, Any>) {
        viewModelScope.launch {
            canvasRepository.updateWidgetState(widgetId, state)
        }
    }

    fun toggleFavorite(widgetId: String) {
        viewModelScope.launch {
            canvasRepository.toggleFavorite(widgetId)
        }
    }

    // NC5 修复：从 StateFlow 读取，非阻塞
    fun isFavorite(widgetId: String): Boolean = widgetId in _favoriteWidgetIds.value

    // NC6/T10：显示组件菜单（收藏/删除）
    // 由 UI 层监听 menuWidgetId 弹出 ModalBottomSheet
    private val _menuWidgetId = MutableStateFlow<String?>(null)
    val menuWidgetId: StateFlow<String?> = _menuWidgetId.asStateFlow()

    fun showWidgetMenu(widgetId: String) {
        _menuWidgetId.value = widgetId
    }

    fun dismissWidgetMenu() {
        _menuWidgetId.value = null
    }

    fun deleteWidget(widgetId: String) {
        viewModelScope.launch {
            canvasRepository.deleteWidget(widgetId)
            _menuWidgetId.value = null
        }
    }
}
```

### 6.5 WebOSFavoritesScreen（收藏组件页，T11）

参考 `layout-design-mobile.md` 第 2.12 节。几乎全屏，回退退一级（回画布主页）。

> **v4 #2 修复**：原代码 `state = emptyMap()` 且 `onUpdateState = { _ -> }`，组件状态根本不同步。
> 现新建 `WebOSFavoritesViewModel` 注入 `CanvasRepository`，加载 widget.stateJson 并持久化状态变更。

```kotlin
// WebOSFavoritesViewModel.kt（v4 #2 新增）
package com.livingdashboard.ui.canvas

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.livingdashboard.data.entity.WidgetEntity
import com.livingdashboard.data.repository.CanvasRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.launch
import javax.inject.Inject

@HiltViewModel
class WebOSFavoritesViewModel @Inject constructor(
    private val canvasRepository: CanvasRepository
) : ViewModel() {

    /** 加载指定 widgetId 的组件数据（含真实 stateJson） */
    fun observeWidget(widgetId: String): Flow<WidgetEntity?> =
        canvasRepository.observeAggregateWidgets().map { widgets ->
            widgets.find { it.id == widgetId }
        }

    /** v4 #2：持久化组件状态变更（同步到原面板，D7 真实引用） */
    fun updateWidgetState(widgetId: String, newState: Map<String, Any>) {
        viewModelScope.launch {
            canvasRepository.updateWidgetState(widgetId, newState)
        }
    }

    /** 取消收藏 */
    fun toggleFavorite(widgetId: String) {
        viewModelScope.launch {
            canvasRepository.toggleFavorite(widgetId)
        }
    }
}
```

```kotlin
// WebOSFavoritesScreen.kt
package com.livingdashboard.ui.canvas

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.livingdashboard.canvas.ZoomLevel
import com.livingdashboard.ui.widgets.WidgetRegistry
import com.livingdashboard.ui.widgets.WidgetRenderParams

@Composable
fun WebOSFavoritesScreen(
    widgetId: String,
    onBack: () -> Unit,
    viewModel: WebOSFavoritesViewModel = hiltViewModel()  // v4 #2：改用 WebOSFavoritesViewModel
) {
    // v4 #2：加载真实 widget 数据（含 stateJson）
    val widget by viewModel.observeWidget(widgetId).collectAsStateWithLifecycle(initialValue = null)

    // 查找 widget 类型（用于显示名称）
    val def = widget?.let { WidgetRegistry.get(it.type) }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(def?.displayName ?: "收藏组件") },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "返回")
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = Color(0xE6FFFFFF)  // D6 rgba(255,255,255,0.9)
                )
            )
        }
    ) { padding ->
        Box(
            modifier = Modifier
                .fillMaxSize()
                .background(Color.White)
                .padding(padding)
        ) {
            // 几乎全屏渲染组件（ZoomLevel.FULL），用真实状态
            val currentWidget = widget
            if (currentWidget != null && def != null) {
                // v4 #2：解析真实 stateJson（不再是 emptyMap()）
                val state = parseStateJson(currentWidget.stateJson)
                def.render.invoke(
                    WidgetRenderParams(
                        widgetId = widgetId,
                        panelId = "",  // 收藏组件页不绑定面板，但状态真实同步
                        type = currentWidget.type,
                        state = state,  // v4 #2：真实状态
                        zoomLevel = ZoomLevel.FULL,
                        onUpdateState = { newState ->
                            // v4 #2：持久化状态变更（同步到原面板，D7 真实引用）
                            viewModel.updateWidgetState(widgetId, newState)
                        },
                        onToggleFavorite = { viewModel.toggleFavorite(widgetId) },
                        isFavorite = true
                    )
                )
            } else {
                // 加载中
                Box(
                    modifier = Modifier.fillMaxSize(),
                    contentAlignment = androidx.compose.ui.Alignment.Center
                ) {
                    CircularProgressIndicator()
                }
            }
        }
    }
}

private fun parseStateJson(json: String): Map<String, Any> {
    val obj = org.json.JSONObject(json)
    val map = mutableMapOf<String, Any>()
    for (key in obj.keys()) {
        map[key] = obj.get(key)
    }
    return map
}
```

### 6.6 AggregatePanelScreen（聚合面板，T12）

聚合面板 = 特殊面板，显示所有收藏组件。布局同 CanvasScreen，但数据源是 `favorites` 表。

> **v4 #11 修复**：layout-design 2.13 要求"上滑回到画布主页"，原代码直接复用 CanvasScreen 无法识别上滑手势。
> 现包裹一层 `detectVerticalDragGestures` 识别上滑（向上拖拽超过阈值后触发 onBack）。

```kotlin
package com.livingdashboard.ui.aggregate

import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectVerticalDragGestures
import androidx.compose.foundation.layout.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.pointerInput
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.livingdashboard.ui.canvas.CanvasScreen
import com.livingdashboard.ui.canvas.CanvasViewModel

@Composable
fun AggregatePanelScreen(
    onBack: () -> Unit,
    onShowTabs: () -> Unit = {},        // v5 #N6 延伸：传给复用的 CanvasScreen 的 BottomBar
    onShowSettings: () -> Unit = {},    // v5 #N6 延伸：传给复用的 CanvasScreen 的 BottomBar
    viewModel: CanvasViewModel = hiltViewModel()
) {
    // 聚合面板 ID 需在 App 初始化时获取
    val aggregatePanelId by viewModel.aggregatePanelId.collectAsStateWithLifecycle()

    if (aggregatePanelId == null) {
        // 加载中
        Box(
            modifier = Modifier.fillMaxSize().background(Color.White),
            contentAlignment = Alignment.Center
        ) {
            androidx.compose.material3.CircularProgressIndicator()
        }
        return
    }

    // v4 #11：包裹上滑手势识别（layout-design 2.13 要求"上滑回到画布主页"）
    // 上滑阈值 80px，超过则触发 onBack
    var dragAccum by remember { mutableStateOf(0f) }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .pointerInput(Unit) {
                detectVerticalDragGestures(
                    onDragStart = { dragAccum = 0f },
                    onVerticalDrag = { _, dragAmount ->
                        // 上滑 dragAmount < 0（屏幕坐标 Y 向下为正）
                        dragAccum += dragAmount
                    },
                    onDragEnd = {
                        // 上滑超过阈值（dragAccum < -80）触发回主页
                        if (dragAccum < -80f) onBack()
                    }
                )
            }
    ) {
        // 复用 CanvasScreen，传入聚合面板 ID
        // D7：聚合面板的组件列表来自 widget_positions 表（panelId = 聚合面板 ID）
        //      通过 observeAggregateWidgets() JOIN widgets 表获取真实数据
        // 位置来自 widget_positions 表（panelId = 聚合面板 ID，由 toggleFavorite 写入）
        // v5 #N6 延伸：传入 onShowTabs/onShowSettings，让复用的 CanvasScreen 的 BottomBar 按钮可用
        CanvasScreen(
            panelId = aggregatePanelId!!,
            onBack = onBack,
            onShowTabs = onShowTabs,
            onShowSettings = onShowSettings,
            viewModel = viewModel
        )
    }
}
```

### 6.7 TabManagerScreen 扩展（T5 标签页统一 + T4 面板管理，v4 #12 修订）

> **v4 #12 修订**：原 spec 单独建 `PanelManagerScreen`，与 `layout-design-mobile.md` 2.4 节"统一管理网页标签和画布面板标签"冲突。修订：M2 在 M1 已有 `TabManagerScreen` 顶部加 `TabRow`，含两个 Tab：**网页标签**（M1 数据源：`TabEntity`）+ **画布面板**（M2 数据源：`PanelEntity`）。底部栏"标签"按钮进入时根据当前 `AppMode` 默认选中对应 Tab。
>
> ⚠️ **v5 #N2 / #30 破坏性变更**：M2 的 `TabManagerScreen` 签名与 M1 完全不同，**必须修改 M1 `AppNavGraph.kt` 中的调用点**（`f:\allmylife\event\client\android\app\src\main\java\com\livingdashboard\ui\nav\AppNavGraph.kt` 第 70-80 行）。
>
> **M1 原代码**（必须替换）：
> ```kotlin
> // M1 AppNavGraph.kt 第 70-80 行
> composable("tabs") {
>     TabManagerScreen(
>         onTabClick = { tabId ->
>             navController.navigate("browser/$tabId") {
>                 popUpTo("home")
>             }
>         },
>         onClose = { navController.popBackStack() }
>     )
> }
> ```
>
> **M2 新代码**（v5 #N2 / #30：签名改为 onBack + onTabClick + onPanelClick + initialMode）：
> ```kotlin
> // M2 AppNavGraph.kt（附录 B 完整实现）
> composable(Routes.TABS) {
>     TabManagerScreen(
>         onBack = { navController.popBackStack() },           // M1 onClose 改名
>         onTabClick = { tabId ->
>             navController.navigate(Routes.browser(tabId)) {  // v5 #N3：用 Routes.browser(tabId)
>                 popUpTo(Routes.BROWSER_HOME)
>             }
>         },
>         onPanelClick = { panelId ->
>             navController.navigate(Routes.canvas(panelId))   // M2 新增：进入画布
>         },
>         initialMode = appMode  // v4 #12：根据当前模式默认选中 Tab
>     )
> }
> ```
>
> **变更摘要**：
> - `onClose` → `onBack`（重命名，语义不变）
> - 新增 `onPanelClick`（M2 画布面板 Tab 用）
> - 新增 `initialMode`（默认选中哪个 Tab）
> - `viewModel` 参数拆分为 `tabViewModel` + `panelTabViewModel`（M2 新增 PanelTabViewModel）
> - 移除 M1 的 `onClose` 参数（被 `onBack` 替代）

```kotlin
// TabManagerScreen.kt 改（M2 扩展现有 M1 文件）
package com.livingdashboard.ui.tab

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.livingdashboard.ui.AppMode
import kotlinx.coroutines.launch

/**
 * M2 扩展：TabManagerScreen 加 TabRow 统一管理"网页标签"+"画布面板"。
 *
 * @param initialMode 进入时默认选中的 Tab（BROWSER→网页标签，CANVAS→画布面板）
 * @param tabViewModel M1 已有：管理 TabEntity
 * @param panelTabViewModel M2 新增：管理 PanelEntity（替代原 PanelManagerViewModel）
 */
@Composable
fun TabManagerScreen(
    onBack: () -> Unit,
    onTabClick: (String) -> Unit,
    onPanelClick: (String) -> Unit,
    initialMode: AppMode = AppMode.BROWSER,  // v4 #12：由 BottomBar onTabs 回调传入当前 AppMode
    tabViewModel: TabManagerViewModel = hiltViewModel(),         // M1 已有
    panelTabViewModel: PanelTabViewModel = hiltViewModel()       // M2 新增
) {
    // v4 #12：默认 Tab 由 initialMode 决定
    var selectedTab by remember { mutableStateOf(if (initialMode == AppMode.CANVAS) 1 else 0) }
    val tabTitles = listOf("网页标签", "画布面板")

    // M1 TabManagerViewModel.createNewTab()/closeTab() 是 suspend，需协程作用域
    val scope = androidx.compose.runtime.rememberCoroutineScope()

    // M1 TabManagerViewModel 暴露 uiState: StateFlow<TabManagerUiState>（含 tabs: List<TabEntity>）
    val tabUiState by tabViewModel.uiState.collectAsStateWithLifecycle()
    val panels by panelTabViewModel.panels.collectAsStateWithLifecycle()

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("标签管理") },
                actions = {
                    IconButton(onClick = {
                        if (selectedTab == 0) {
                            scope.launch { tabViewModel.createNewTab() }  // M1 suspend API
                        } else {
                            panelTabViewModel.createPanel("新面板")
                        }
                    }) {
                        Icon(Icons.Default.Add, contentDescription = "新建")
                    }
                }
            )
        }
    ) { padding ->
        Column(modifier = Modifier.padding(padding)) {
            // v4 #12：顶部 TabRow 统一两个 Tab
            TabRow(selectedTabIndex = selectedTab) {
                tabTitles.forEachIndexed { index, title ->
                    Tab(
                        selected = selectedTab == index,
                        onClick = { selectedTab = index },
                        text = { Text(title) }
                    )
                }
            }

            when (selectedTab) {
                0 -> {
                    // 网页标签 Tab（M1 已有逻辑，复用 tabUiState.tabs）
                    LazyColumn {
                        items(tabUiState.tabs) { tab ->
                            ListItem(
                                headlineContent = { Text(tab.title) },
                                supportingContent = { Text(tab.url) },
                                trailingContent = {
                                    IconButton(onClick = {
                                        scope.launch { tabViewModel.closeTab(tab.id) }  // M1 suspend API
                                    }) {
                                        Icon(Icons.Default.Delete, contentDescription = "关闭")
                                    }
                                },
                                modifier = Modifier.clickable { onTabClick(tab.id) }
                            )
                            HorizontalDivider()
                        }
                    }
                }
                1 -> {
                    // 画布面板 Tab（M2 新增，原 PanelManagerScreen 逻辑迁入）
                    LazyColumn {
                        items(panels) { panel ->
                            ListItem(
                                headlineContent = { Text(panel.name) },
                                supportingContent = {
                                    if (panel.type == com.livingdashboard.data.entity.PanelType.AGGREGATE) {
                                        Text("聚合面板（系统）", style = MaterialTheme.typography.labelSmall)
                                    }
                                },
                                trailingContent = {
                                    if (panel.type != com.livingdashboard.data.entity.PanelType.AGGREGATE) {
                                        IconButton(onClick = { panelTabViewModel.deletePanel(panel) }) {
                                            Icon(Icons.Default.Delete, contentDescription = "删除")
                                        }
                                    }
                                },
                                modifier = Modifier.clickable { onPanelClick(panel.id) }
                            )
                            HorizontalDivider()
                        }
                    }
                }
            }
        }
    }
}
```

```kotlin
// PanelTabViewModel.kt（M2 新增，原 PanelManagerViewModel 改名迁入 ui/tab/）
package com.livingdashboard.ui.tab

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.livingdashboard.data.entity.PanelEntity
import com.livingdashboard.data.repository.CanvasRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.launch
import javax.inject.Inject

@HiltViewModel
class PanelTabViewModel @Inject constructor(
    private val canvasRepository: CanvasRepository
) : ViewModel() {

    val panels: StateFlow<List<PanelEntity>> = canvasRepository.observePanels()
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), emptyList())

    fun createPanel(name: String) {
        viewModelScope.launch {
            canvasRepository.createPanel(name)
        }
    }

    fun deletePanel(panel: PanelEntity) {
        viewModelScope.launch {
            canvasRepository.deletePanel(panel)
        }
    }
}
```

---

## 七、Home 键切换（T2，D3）

### 7.1 AppMode 状态

```kotlin
package com.livingdashboard.ui

/** App 模式（浏览器 / 画布） */
enum class AppMode {
    BROWSER,  // 浏览器模式
    CANVAS    // 画布模式
}

/** Home 键导航目标（当前模式的主页） */
enum class HomeTarget {
    BROWSER_HOME,   // BrowserHomeScreen
    CANVAS_HOME     // CanvasHomeScreen
}
```

### 7.2 Home 键规则（D3）

```
当前模式 = BROWSER：
  按 Home → 如果不在 BrowserHomeScreen，回到 BrowserHomeScreen
  再按 Home → 切换到 CANVAS 模式，回到 CanvasHomeScreen

当前模式 = CANVAS：
  按 Home → 如果不在 CanvasHomeScreen，回到 CanvasHomeScreen
  再按 Home → 切换到 BROWSER 模式，回到 BrowserHomeScreen
```

### 7.3 MainViewModel 扩展（Home 键状态机）

```kotlin
package com.livingdashboard.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.livingdashboard.data.prefs.SettingsStore
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.launch
import javax.inject.Inject

@HiltViewModel
class MainViewModel @Inject constructor(
    private val settingsStore: SettingsStore
) : ViewModel() {

    // M1 已有的状态...

    // M2 新增：App 模式
    private val _appMode = MutableStateFlow(AppMode.BROWSER)
    val appMode: StateFlow<AppMode> = _appMode.asStateFlow()

    // 当前是否在当前模式的主页
    private val _isAtHome = MutableStateFlow(true)
    val isAtHome: StateFlow<Boolean> = _isAtHome.asStateFlow()

    // D4：首次启动选择的主页模式
    val defaultHomeMode: StateFlow<String?> = settingsStore.defaultHomeMode
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), null)

    /** D4：首次启动设置默认主页 */
    fun setDefaultHomeMode(mode: String) {
        viewModelScope.launch {
            settingsStore.setDefaultHomeMode(mode)
            _appMode.value = if (mode == "canvas") AppMode.CANVAS else AppMode.BROWSER
        }
    }

    /** 切换模式 */
    fun switchMode() {
        _appMode.value = if (_appMode.value == AppMode.BROWSER) AppMode.CANVAS else AppMode.BROWSER
        _isAtHome.value = true
    }

    /**
     * D3：Home 键处理。
     * 规则：
     * - 如果不在当前模式主页，先回当前模式主页
     * - 如果已在当前模式主页，切换到另一模式的主页
     */
    fun onHomePressed() {
        if (_isAtHome.value) {
            // 已在主页 → 切换模式
            switchMode()
        } else {
            // 不在主页 → 回当前模式主页
            _isAtHome.value = true
            // 导航回主页的逻辑由 AppNavGraph 监听 isAtHome 处理
        }
    }

    /** 离开主页（进入子页面） */
    fun onLeaveHome() {
        _isAtHome.value = false
    }

    /** v4 #19：进入主页（导航回主页时调用） */
    fun onEnterHome() {
        _isAtHome.value = true
    }
}
```

> **v4 #19 修复**：`onLeaveHome()` 和 `onEnterHome()` 由 AppNavGraph 监听 destination 变化自动调用，无需手动在每个导航点插入。
>
> AppNavGraph 中监听 destination 变化的代码片段（见附录 B 完整实现）：
>
> ```kotlin
> navController.addOnDestinationChangedListener { _, destination, _ ->
>     when (destination.route) {
>         Routes.BROWSER_HOME, Routes.CANVAS_HOME -> mainViewModel.onEnterHome()
>         else -> mainViewModel.onLeaveHome()
>     }
> }
> ```

### 7.4 底部栏模式切换（D5）

> **v4 #5 修复**：原 spec 完全重写 BottomBar 签名（用 `mode: AppMode` 替换原参数），导致 M1 BrowserScreen 调用编译失败。
> **修复方案**：新增 `mode: BottomBarMode = BottomBarMode.BROWSER` 参数（默认 BROWSER），其他参数保持 M1 不变。
> M1 BrowserScreen 调用点无需强制修改（因 mode 有默认值），但建议显式加 `mode = BottomBarMode.BROWSER` 提高可读性。
>
> **v4 #8 修复**：画布模式底部栏改 5 按钮 `[缩小][放大][Home][标签][⋮]`（与浏览器模式对称）。
> 原 4 按钮方案 `[Home][面板][收藏][⋮]` 违反 layout-design 2.10（要求 5 按钮）。
> "面板"和"收藏"入口移到"⋮"更多菜单中。

```kotlin
// BottomBar.kt 扩展（M2）
package com.livingdashboard.ui.components

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.ArrowForward
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.Tab
import androidx.compose.material.icons.filled.ZoomIn
import androidx.compose.material.icons.filled.ZoomOut
import androidx.compose.material3.Badge
import androidx.compose.material3.BadgedBox
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp

/**
 * v4 #5：底部栏模式枚举。
 * - BROWSER：浏览器模式（M1 原有，5 按钮 [后退][前进][Home][标签][⋮]）
 * - CANVAS：画布模式（M2 新增，5 按钮 [缩小][放大][Home][标签][⋮]，与浏览器模式对称）
 */
enum class BottomBarMode {
    BROWSER,
    CANVAS
}

/**
 * 底部栏（M1 + M2 扩展）。
 *
 * v4 #5：新增 `mode: BottomBarMode = BottomBarMode.BROWSER` 参数（默认 BROWSER），
 * 保持 M1 BrowserScreen 调用兼容（不传 mode 时默认浏览器模式）。
 *
 * v4 #8：画布模式改 5 按钮 `[缩小][放大][Home][标签][⋮]`（与浏览器模式对称）。
 * 面板/收藏入口移到 ⋮ 更多菜单。
 *
 * @param mode 底部栏模式（v4 #5：默认 BROWSER 保持 M1 兼容）
 * @param canGoBack WebView 是否可后退（浏览器模式用）
 * @param canGoForward WebView 是否可前进（浏览器模式用）
 * @param onBack 后退按钮回调（浏览器模式）
 * @param onForward 前进按钮回调（浏览器模式）
 * @param onHome Home 按钮回调（两种模式都用）
 * @param onTabs 标签按钮回调（两种模式都用，画布模式进入 TabManagerScreen 默认画布面板 Tab）
 * @param onMore 更多按钮回调（两种模式都用，画布模式弹出含"面板管理"/"收藏管理"的更多菜单）
 * @param onZoomOut 缩小按钮回调（画布模式，v4 #13：调用 canvasViewModel.zoomOut()）
 * @param onZoomIn 放大按钮回调（画布模式，v4 #13：调用 canvasViewModel.zoomIn()）
 * @param tabCount 当前标签总数（浏览器模式徽章用）
 */
@Composable
fun BottomBar(
    mode: BottomBarMode = BottomBarMode.BROWSER,  // v4 #5：默认 BROWSER 保持 M1 兼容
    canGoBack: Boolean = false,
    canGoForward: Boolean = false,
    onBack: () -> Unit = {},
    onForward: () -> Unit = {},
    onHome: () -> Unit = {},
    onTabs: () -> Unit = {},
    onMore: () -> Unit = {},
    onZoomOut: () -> Unit = {},  // v4 #8/#13：画布模式缩小按钮
    onZoomIn: () -> Unit = {},   // v4 #8/#13：画布模式放大按钮
    tabCount: Int = 0
) {
    Surface(
        modifier = Modifier.fillMaxWidth(),
        color = androidx.compose.ui.graphics.Color(0xD9FFFFFF),  // D6 rgba(255,255,255,0.85)
        tonalElevation = 3.dp
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 8.dp, vertical = 4.dp),
            horizontalArrangement = Arrangement.SpaceEvenly
        ) {
            when (mode) {
                BottomBarMode.BROWSER -> {
                    // 浏览器模式：5 按钮 [←][→][Home][标签][⋮]（M1 原样保留）
                    IconButton(
                        onClick = onBack,
                        enabled = canGoBack,
                        modifier = Modifier.semantics { contentDescription = "后退" }
                    ) {
                        Icon(
                            imageVector = Icons.AutoMirrored.Filled.ArrowBack,
                            contentDescription = null,
                            tint = if (canGoBack) MaterialTheme.colorScheme.onSurface
                            else MaterialTheme.colorScheme.onSurface.copy(alpha = 0.38f)
                        )
                    }
                    IconButton(
                        onClick = onForward,
                        enabled = canGoForward,
                        modifier = Modifier.semantics { contentDescription = "前进" }
                    ) {
                        Icon(
                            imageVector = Icons.AutoMirrored.Filled.ArrowForward,
                            contentDescription = null,
                            tint = if (canGoForward) MaterialTheme.colorScheme.onSurface
                            else MaterialTheme.colorScheme.onSurface.copy(alpha = 0.38f)
                        )
                    }
                    IconButton(
                        onClick = onHome,
                        modifier = Modifier.semantics { contentDescription = "主页" }
                    ) {
                        Icon(
                            imageVector = Icons.Default.Home,
                            contentDescription = null,
                            tint = MaterialTheme.colorScheme.onSurface
                        )
                    }
                    BadgedBox(
                        badge = {
                            if (tabCount > 0) {
                                Badge {
                                    Text(text = if (tabCount > 99) "99+" else tabCount.toString())
                                }
                            }
                        },
                        modifier = Modifier.padding(top = 8.dp)
                    ) {
                        IconButton(
                            onClick = onTabs,
                            modifier = Modifier.semantics { contentDescription = "标签页" }
                        ) {
                            Icon(
                                imageVector = Icons.Default.Tab,
                                contentDescription = null,
                                tint = MaterialTheme.colorScheme.onSurface
                            )
                        }
                    }
                    IconButton(
                        onClick = onMore,
                        modifier = Modifier.semantics { contentDescription = "更多" }
                    ) {
                        Icon(
                            imageVector = Icons.Default.MoreVert,
                            contentDescription = null,
                            tint = MaterialTheme.colorScheme.onSurface
                        )
                    }
                }
                BottomBarMode.CANVAS -> {
                    // v4 #8：画布模式 5 按钮 [缩小][放大][Home][标签][⋮]（与浏览器模式对称）
                    // 面板/收藏入口移到 ⋮ 更多菜单
                    IconButton(
                        onClick = onZoomOut,
                        modifier = Modifier.semantics { contentDescription = "缩小" }
                    ) {
                        Icon(
                            imageVector = Icons.Default.ZoomOut,
                            contentDescription = null,
                            tint = MaterialTheme.colorScheme.onSurface
                        )
                    }
                    IconButton(
                        onClick = onZoomIn,
                        modifier = Modifier.semantics { contentDescription = "放大" }
                    ) {
                        Icon(
                            imageVector = Icons.Default.ZoomIn,
                            contentDescription = null,
                            tint = MaterialTheme.colorScheme.onSurface
                        )
                    }
                    IconButton(
                        onClick = onHome,
                        modifier = Modifier.semantics { contentDescription = "主页" }
                    ) {
                        Icon(
                            imageVector = Icons.Default.Home,
                            contentDescription = null,
                            tint = MaterialTheme.colorScheme.onSurface
                        )
                    }
                    IconButton(
                        onClick = onTabs,
                        modifier = Modifier.semantics { contentDescription = "标签页" }
                    ) {
                        Icon(
                            imageVector = Icons.Default.Tab,
                            contentDescription = null,
                            tint = MaterialTheme.colorScheme.onSurface
                        )
                    }
                    IconButton(
                        onClick = onMore,
                        modifier = Modifier.semantics { contentDescription = "更多" }
                    ) {
                        Icon(
                            imageVector = Icons.Default.MoreVert,
                            contentDescription = null,
                            tint = MaterialTheme.colorScheme.onSurface
                        )
                    }
                }
            }
        }
    }
}
```

**v4 #5：M1 BrowserScreen 调用点修改示例**（`client/android/app/src/main/java/com/livingdashboard/ui/browser/BrowserScreen.kt` 第 216-225 行）：

```kotlin
// 修改前（M1 原代码）：
BottomBar(
    canGoBack = uiState.canGoBack,
    canGoForward = uiState.canGoForward,
    onBack = { controller.goBack() },
    onForward = { controller.goForward() },
    onHome = onNavigateToHome,
    onTabs = onOpenTabs,
    onMore = { showMoreMenu = true },
    tabCount = uiState.tabCount
)

// 修改后（v4 #5：显式加 mode = BottomBarMode.BROWSER 提高可读性，不加也可编译因有默认值）：
BottomBar(
    mode = BottomBarMode.BROWSER,  // v4 #5：显式声明浏览器模式
    canGoBack = uiState.canGoBack,
    canGoForward = uiState.canGoForward,
    onBack = { controller.goBack() },
    onForward = { controller.goForward() },
    onHome = onNavigateToHome,
    onTabs = onOpenTabs,
    onMore = { showMoreMenu = true },
    tabCount = uiState.tabCount
)
```

**v4 #8：CanvasScreen 调用点示例**（画布模式底部栏）：

```kotlin
// 在 CanvasScreen 中调用（画布模式）：
BottomBar(
    mode = BottomBarMode.CANVAS,  // v4 #8：画布模式
    onZoomOut = { canvasViewModel.zoomOut() },  // v4 #13
    onZoomIn = { canvasViewModel.zoomIn() },    // v4 #13
    onHome = { /* 回画布主页 */ },
    onTabs = { /* 进入 TabManagerScreen，默认画布面板 Tab（v4 #12） */ },
    onMore = { /* 弹出更多菜单（含面板管理/收藏管理） */ }
)
```

**画布模式 ⋮ 更多菜单扩展**（v4 #8：原"面板"/"收藏"入口移到此处）：

```kotlin
// CanvasMoreMenuSheet.kt（新组件，画布模式更多菜单）
@Composable
fun CanvasMoreMenuSheet(
    show: Boolean,
    onDismiss: () -> Unit,
    onOpenPanelManager: () -> Unit,  // v4 #8：面板管理入口
    onOpenFavorites: () -> Unit,     // v4 #8：收藏管理入口（进入聚合面板）
    onOpenSettings: () -> Unit
) {
    if (show) {
        androidx.compose.material3.ModalBottomSheet(onDismissRequest = onDismiss) {
            androidx.compose.foundation.layout.Column {
                androidx.compose.material3.ListItem(
                    headlineContent = { androidx.compose.material3.Text("面板管理") },
                    leadingContent = { androidx.compose.material3.Icon(Icons.Default.Dashboard, contentDescription = null) },
                    modifier = Modifier.clickable { onOpenPanelManager(); onDismiss() }
                )
                androidx.compose.material3.ListItem(
                    headlineContent = { androidx.compose.material3.Text("收藏管理") },
                    leadingContent = { androidx.compose.material3.Icon(Icons.Default.Star, contentDescription = null) },
                    modifier = Modifier.clickable { onOpenFavorites(); onDismiss() }
                )
                androidx.compose.material3.ListItem(
                    headlineContent = { androidx.compose.material3.Text("设置") },
                    leadingContent = { androidx.compose.material3.Icon(Icons.Default.Settings, contentDescription = null) },
                    modifier = Modifier.clickable { onOpenSettings(); onDismiss() }
                )
            }
        }
    }
}
```

---

## 八、首次启动（T2，D4）

### 8.1 首次启动检测

> **v4 #6 修复**：原 spec 改 AppNavGraph 签名为 `AppNavGraph(appMode, mainViewModel)`，
> 但 M1 MainActivity.MainActivityContent 现有调用 `AppNavGraph(navController = navController)`，
> 且 MainActivityContent 还需处理外部 URL（pendingExternalUrl）。
>
> **修复方案**：给出 MainActivityContent 完整新签名和调用代码，保留外部 URL 处理逻辑，
> 同时把 navController 创建移到 MainActivityContent 内部（因 AppNavGraph 不再接收外部 navController）。

```kotlin
// MainActivity.kt 改（M2，v4 #6：保留外部 URL 处理 + 兼容新 AppNavGraph 签名）
@Composable
fun MainActivityContent(
    pendingExternalUrl: StateFlow<String?>,           // M1 保留：外部 URL Flow
    onExternalUrlConsumed: () -> Unit,                 // M1 保留：消费完毕回调
    mainViewModel: MainViewModel = hiltViewModel()
) {
    val defaultHomeMode by mainViewModel.defaultHomeMode.collectAsStateWithLifecycle()
    val appMode by mainViewModel.appMode.collectAsStateWithLifecycle()
    val themeColorIndex by mainViewModel.themeColorIndex.collectAsStateWithLifecycle()  // M1 保留

    // v4 #6：navController 在 MainActivityContent 内部创建，传给 AppNavGraph
    val navController = rememberNavController()

    // M1 保留：观察外部 URL
    val externalUrl by pendingExternalUrl.collectAsStateWithLifecycle()

    // M1 保留：外部 URL 变化时创建标签页 + 导航到浏览器页
    LaunchedEffect(externalUrl) {
        val url = externalUrl ?: return@LaunchedEffect
        val newTabId = mainViewModel.createTabForUrl(url)
        navController.navigate("browser/$newTabId") {
            popUpTo("home") { inclusive = false }
        }
        onExternalUrlConsumed()
    }

    LivingDashboardTheme(themeColorIndex = themeColorIndex) {
        when {
            // D4：首次启动，defaultHomeMode == null
            defaultHomeMode == null -> {
                HomeModeSelectorScreen(
                    onSelect = { mode -> mainViewModel.setDefaultHomeMode(mode) }
                )
            }
            // 正常启动
            else -> {
                AppNavGraph(
                    navController = navController,        // v4 #6：保留 navController 参数
                    appMode = appMode,                    // M2 新增：模式状态
                    mainViewModel = mainViewModel         // M2 新增：MainViewModel 引用
                )
            }
        }
    }
}
```

**M1 MainActivity.onCreate 修改**（保留外部 URL 注入）：

```kotlin
// MainActivity.kt（M1 onCreate 不变，仍调用 MainActivityContent）
override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    setContent {
        MainActivityContent(
            pendingExternalUrl = pendingExternalUrl,           // M1 保留
            onExternalUrlConsumed = { _pendingExternalUrl.value = null }  // M1 保留
            // mainViewModel 由 MainActivityContent 内部 hiltViewModel() 获取
        )
    }
    handleViewIntent(intent)
}
```

### 8.2 HomeModeSelectorScreen

```kotlin
package com.livingdashboard.ui.onboarding

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

@Composable
fun HomeModeSelectorScreen(
    onSelect: (String) -> Unit
) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center
    ) {
        Text(
            text = "选择你的默认主页",
            fontSize = 24.sp,
            fontWeight = FontWeight.Bold,
            color = Color(0xFF333333)
        )
        Spacer(modifier = Modifier.height(8.dp))
        Text(
            text = "你可以在设置中随时更改",
            fontSize = 14.sp,
            color = Color(0xFF999999)
        )
        Spacer(modifier = Modifier.height(48.dp))

        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            // 浏览器主页
            ModeCard(
                title = "浏览器",
                description = "搜索 + 网页浏览",
                onClick = { onSelect("browser") },
                modifier = Modifier.weight(1f)
            )
            // 画布主页
            ModeCard(
                title = "画布",
                description = "无限画布 + 组件",
                onClick = { onSelect("canvas") },
                modifier = Modifier.weight(1f)
            )
        }
    }
}

@Composable
private fun ModeCard(
    title: String,
    description: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier
) {
    Card(
        modifier = modifier
            .fillMaxWidth()
            .aspectRatio(0.8f),
        shape = RoundedCornerShape(20.dp),
        colors = CardDefaults.cardColors(
            containerColor = Color(0x08000000)  // D6 rgba(0,0,0,0.03)
        ),
        elevation = CardDefaults.cardElevation(0.dp),
        onClick = onClick
    ) {
        Column(
            modifier = Modifier.fillMaxSize().padding(16.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center
        ) {
            Text(title, fontSize = 20.sp, fontWeight = FontWeight.Bold, color = Color(0xFF333333))
            Spacer(modifier = Modifier.height(8.dp))
            Text(description, fontSize = 12.sp, color = Color(0xFF999999))
        }
    }
}
```

### 8.3 聚合面板自动创建

App 首次启动时（或聚合面板不存在时）自动创建。

> **v4 #17 修复**：`createAggregatePanel` 已整合到 `CanvasRepository` 类内部（见 4.8 节），
> 此处只调用 `canvasRepository.createAggregatePanel()`，不再重复定义方法。

```kotlin
// LivingDashboardApp.kt 扩展（M2）
package com.livingdashboard

import android.app.Application
import com.livingdashboard.data.repository.CanvasRepository
import dagger.hilt.android.HiltAndroidApp
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import javax.inject.Inject

@HiltAndroidApp
class LivingDashboardApp : Application() {
    @Inject lateinit var canvasRepository: CanvasRepository

    private val appScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    override fun onCreate() {
        super.onCreate()
        // M1 已有的初始化...

        // M2：初始化组件注册表
        com.livingdashboard.ui.widgets.WidgetRegistry.init()

        // M2：确保聚合面板存在（D12）
        // v4 #17：createAggregatePanel 已在 CanvasRepository 类内部定义（见 4.8 节），此处只调用
        appScope.launch {
            val aggregate = canvasRepository.getAggregatePanel()
            if (aggregate == null) {
                canvasRepository.createAggregatePanel()  // 见 4.8 节定义
            } else {
                // v4 #4：缓存聚合面板 ID，供 observeAggregateWidgets 用
                canvasRepository.cacheAggregatePanelId()
            }
        }
    }
}
```

---

## 九、UI 升级清单（T13，D6）

### 9.1 白色洁净色系色值表

| 用途 | 色值 | 说明 |
|------|------|------|
| 页面背景 | `#FFFFFF` | 纯白 |
| 卡片背景 | `rgba(0,0,0,0.03)` = `Color(0x08000000)` | 极淡灰 |
| 底部栏背景 | `rgba(255,255,255,0.85)` = `Color(0xD9FFFFFF)` | 半透明白 + 模糊 |
| 输入框背景 | `rgba(0,0,0,0.05)` = `Color(0x0D000000)` | 淡灰 |
| 主文字 | `#333333` | 深灰 |
| 次文字 | `#666666` | 中灰 |
| 辅助文字 | `#999999` | 浅灰 |
| 主题色 | `#4A90E2` | 蓝色（沿用 M1） |
| 错误色 | `#FF3B30` | 红色 |
| 成功色 | `#34C759` | 绿色 |
| 圆角-小 | 8.dp | 按钮、小卡片 |
| 圆角-中 | 12.dp | 组件卡片 |
| 圆角-大 | 16.dp | 大卡片 |
| 圆角-圆 | 22.dp / CircleShape | 输入框、圆形图标 |

### 9.2 毛玻璃效果

Android 12+ (API 31+) 支持 `RenderEffect.createBlurEffect`，低版本降级为半透明背景：

```kotlin
package com.livingdashboard.ui.theme

import android.os.Build
import androidx.compose.foundation.background
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.blur
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

/**
 * D6 毛玻璃效果。
 * Android 12+ 用 blur Modifier，低版本降级为半透明白色。
 */
fun Modifier.glassmorphism(
    blurRadius: Dp = 20.dp,
    backgroundColor: Color = Color(0xD9FFFFFF)
): Modifier = this.then(
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
        Modifier
            .background(backgroundColor)
            .blur(blurRadius)
    } else {
        Modifier.background(backgroundColor)
    }
)
```

### 9.3 各页面升级清单

> **v4 #26 修订**：原表只列 M2 新页面，缺 M1 已有页面的 UI 升级项，导致 T13 验收时 M1 页面可能漏改。补充 M1 页面具体改造点（每项均为 D6 白色洁净色系 + 毛玻璃落地）。

#### M2 新增页面

| 页面 | 升级项 |
|------|--------|
| CanvasHomeScreen | 纯白背景、圆形图标 rgba(0,0,0,0.03)、AI 输入框 rgba(0,0,0,0.05) 圆角 22dp、收藏卡片 rgba(0,0,0,0.03) 圆角 16dp |
| CanvasScreen | 纯白背景、组件容器 rgba(0,0,0,0.03) 圆角 12dp、无边框 |
| BottomBar（画布模式）| rgba(255,255,255,0.85) + blur(20dp) 毛玻璃 |
| BottomBar（浏览器模式）| 同上，保持 M1 风格但加毛玻璃 |
| WebOSFavoritesScreen | 顶栏 rgba(255,255,255,0.9) + 模糊、内容区纯白 |
| TabManagerScreen（M2 扩展，v4 #12）| TabRow rgba(255,255,255,0.9) + 模糊、卡片 rgba(0,0,0,0.03) 圆角 12dp |
| HomeModeSelectorScreen | 卡片 rgba(0,0,0,0.03) 圆角 20dp |
| 所有弹窗/菜单 | rgba(255,255,255,0.95) + 模糊 |

#### M1 已有页面升级项（v4 #26 新增）

| M1 页面 | 文件路径 | 升级项 |
|---------|---------|--------|
| BrowserHomeScreen | `ui/home/BrowserHomeScreen.kt` | 背景改纯白 `#FFFFFF`；Logo 容器改 rgba(0,0,0,0.03) 圆角 16dp；SearchBar pill 背景 rgba(0,0,0,0.05) 圆角 22dp；书签圆形图标未选中态 rgba(0,0,0,0.03)，按下态 rgba(0,0,0,0.06) |
| BrowserScreen / AddressBar | `ui/browser/BrowserScreen.kt` + `ui/browser/components/AddressBar.kt` | 地址栏 pill 背景 rgba(0,0,0,0.05) 圆角 22dp + blur(12dp) 毛玻璃；ProgressBar 颜色改主题色 `#4A90E2`；WebView 区背景纯白 |
| BookmarkScreen | `ui/bookmark/BookmarkScreen.kt` | 卡片背景 rgba(0,0,0,0.03) 圆角 12dp，移除实线边框；TopAppBar 背景 rgba(255,255,255,0.9) + blur(16dp) |
| HistoryScreen | `ui/history/HistoryScreen.kt` | 同 BookmarkScreen 卡片样式；搜索框 pill 背景 rgba(0,0,0,0.05) 圆角 22dp；日期分组标题色 `#666666` |
| SettingsScreen | `ui/settings/SettingsScreen.kt` | 分组卡片 rgba(0,0,0,0.03) 圆角 12dp；设置项背景透明，分隔线 rgba(0,0,0,0.06)；开关用主题色 `#4A90E2` |
| TabManagerScreen（M1 网页标签部分）| `ui/tab/TabManagerScreen.kt` | 标签卡片 rgba(0,0,0,0.03) 圆角 12dp，移除实线边框；TopAppBar 背景 rgba(255,255,255,0.9) + blur(16dp)；关闭按钮未按下 rgba(0,0,0,0.05)，按下 rgba(0,0,0,0.1) |
| BottomBar（浏览器模式） | `ui/components/BottomBar.kt` | 背景 rgba(255,255,255,0.85) + blur(20dp) 毛玻璃；按钮未选中图标 `#666666`，选中 `#4A90E2`；按钮背景未按下透明，按下 rgba(0,0,0,0.05) 圆角 24dp |
| MoreMenuSheet | `ui/components/MoreMenuSheet.kt` | 半屏面板背景 rgba(255,255,255,0.95) + blur(20dp) 毛玻璃；菜单项卡片 rgba(0,0,0,0.03) 圆角 12dp；分隔线 rgba(0,0,0,0.06) |
| LivingWebView 进度条 | `ui/browser/components/ProgressBar.kt` | 进度条颜色改主题色 `#4A90E2`，高度 2dp，圆角 1dp |

> **验收要求**：M2 结束时，以上所有 M1 页面需符合 D6 色值表（9.1 节）和毛玻璃规范（9.2 节）。验收方式：在 M1 页面上截图，与 M2 新页面并排比对，确保视觉风格一致（无实线边框、统一半透明 + 毛玻璃）。

---

## 十、依赖项

### 10.1 build.gradle.kts 变更

M2 新增依赖：

```kotlin
// build.gradle.kts (app)
dependencies {
    // M1 已有的依赖...

    // M2 新增
    // Coroutines（Flow 操作，如 combine）
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.7.3")  // 已有，确认

    // material-icons-extended（画布模式图标：Dashboard 等）
    implementation("androidx.compose.material:material-icons-extended")  // 已有，确认

    // JSON 解析（组件状态序列化，用 org.json 即可，无需额外依赖）
    // org.json.JSONObject 是 Android SDK 自带，无需添加

    // v4 #25：移除 core-splashscreen 依赖（无用，首次启动选择页用 HomeModeSelectorScreen 即可，无需 splash-screen）
    // 原 spec 写的 implementation("androidx.core:core-splashscreen:1.0.1") 已删除

    // NC4：exp4j 计算器表达式解析库（CalculatorEngine 用）
    implementation("net.objecthunter:exp4j:0.4.8")
}
```

### 10.2 DatabaseModule 扩展

> **v4 #7 修复**：spec 4.9 改 `SettingsStore` 为 `@Inject constructor(dataStore)`，
> 但现有 `DatabaseModule.provideSettingsStore(ctx)` 仍存在 → Hilt 重复绑定报错。
>
> **修复方案**：必须从 DatabaseModule.kt **删除** `provideSettingsStore` 方法，
> 新增 `provideDataStore` 提供 `DataStore<Preferences>` 单例（供 SettingsStore 构造函数注入）。

```kotlin
// DatabaseModule.kt 改（M2，v4 #7：删除 provideSettingsStore + 新增 provideDataStore）
package com.livingdashboard.di

import android.content.Context
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.PreferenceDataStoreFactory
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.preferencesDataStoreFile
import androidx.room.Room
import com.livingdashboard.data.dao.*
import com.livingdashboard.data.db.Converters
import com.livingdashboard.data.db.LivingDatabase
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.android.qualifiers.ApplicationContext
import dagger.hilt.components.SingletonComponent
import javax.inject.Singleton

@Module
@InstallIn(SingletonComponent::class)
object DatabaseModule {

    @Provides
    @Singleton
    fun provideDatabase(@ApplicationContext context: Context): LivingDatabase {
        return Room.databaseBuilder(
            context,
            LivingDatabase::class.java,
            "living.db"  // v5 #N9：回退为 M1 原值（M1 DatabaseModule.kt 第 39 行），避免破坏 MIGRATION_1_2
        )
            .addTypeConverter(Converters())
            .fallbackToDestructiveMigration()  // M2 version 1→2 破坏性迁移
            .build()
    }

    // M1 DAOs...
    @Provides fun provideBookmarkDao(db: LivingDatabase) = db.bookmarkDao()
    @Provides fun provideHistoryDao(db: LivingDatabase) = db.historyDao()
    @Provides fun provideTabDao(db: LivingDatabase) = db.tabDao()

    // M2 DAOs
    @Provides fun providePanelDao(db: LivingDatabase) = db.panelDao()
    @Provides fun provideWidgetDao(db: LivingDatabase) = db.widgetDao()
    @Provides fun provideWidgetPositionDao(db: LivingDatabase) = db.widgetPositionDao()
    @Provides fun provideFavoriteDao(db: LivingDatabase) = db.favoriteDao()

    // v4 #7：新增 provideDataStore（供 SettingsStore @Inject constructor 用）
    @Provides
    @Singleton
    fun provideDataStore(@ApplicationContext ctx: Context): DataStore<Preferences> =
        PreferenceDataStoreFactory.create(
            produceFile = { ctx.preferencesDataStoreFile("settings") }
        )

    // v4 #7：必须从此处删除 provideSettingsStore 方法！
    // 原因：spec 4.9 已改 SettingsStore 为 @Inject constructor(dataStore)，
    //       若保留 provideSettingsStore 会与构造函数注入冲突，Hilt 报重复绑定错误。
    // 删除以下代码（M1 原有）：
    // @Provides @Singleton
    // fun provideSettingsStore(@ApplicationContext ctx: Context): SettingsStore = SettingsStore(ctx)

    // NC8 修复：CanvasRepository 已用 @Inject constructor，无需再写 @Provides（否则 Hilt 重复绑定报错）
    // Hilt 自动通过构造函数注入 4 个 DAO
}
```

### 10.3 AppModule 扩展

M1 的 AppModule 不需要大改，CanvasRepository 的依赖通过 DatabaseModule 的 @Provides 注入。

---

## 十一、验收清单

### 11.1 任务验收标准

| # | 任务 | 验收标准 | 验证方法 |
|---|------|----------|----------|
| T1 | 画布主页 | 圆形图标 + AI 输入框 + 收藏网格 + 下滑提示均显示 | 启动 App→切到画布模式→肉眼检查 |
| T2 | Home 键切换 | 浏览器模式按 Home 回浏览器主页→再按切到画布主页；画布模式同理 | 在浏览器子页按 Home→回主页→再按→切画布 |
| T3 | 分层画布 | 双指缩放时组件呈现 4 种级别（缩略图/摘要/交互/完整） | 进入画布→双指捏合/展开→观察组件呈现变化 |
| T4 | 面板管理 | 创建/切换/删除面板正常，聚合面板不可删除 | 面板管理页→新建→切换→删除普通面板→尝试删聚合面板（应不可删） |
| T5 | 标签页统一 | 浏览器标签页和画布面板各自独立，底部栏切换 | 浏览器模式按标签→标签页；画布模式按面板→面板页 |
| T6 | 5 个组件 | AIAssistant（占位回显）/ WebviewWidget / Calculator / FocusTimer / HtmlCanvasWidget 均可渲染交互 | 在画布上添加每种组件→操作验证 |
| T7 | 组件拖拽 | 长按拖拽组件，实时跟随手指，松开后位置持久化 | 添加组件→长按拖拽→松开→切换面板再切回→位置保持 |
| T8 | 缩放按钮 | 底部栏或浮动按钮可缩放 | 画布模式→点击缩放按钮→观察缩放变化 |
| T9 | 下滑进画布 | 画布主页下滑进入当前面板画布 | 画布主页→下滑→进入画布 |
| T10 | 收藏组件 | 组件"⋮"按钮→菜单→收藏→画布主页显示收藏 | 添加组件→点击⋮→收藏→回画布主页→收藏网格显示 |
| T11 | WebOS 页 | 点击画布主页收藏→全屏页展示组件 | 画布主页→点击收藏组件→全屏页→返回退到画布主页 |
| T12 | 聚合面板 | 系统自动创建聚合面板，显示所有收藏组件 | 首次启动→检查聚合面板存在→收藏组件→打开聚合面板→显示收藏 |
| T13 | UI 升级 | 所有 M2 页面符合 D6 色值表（白色洁净、毛玻璃） | 肉眼检查各页面背景/卡片/底部栏样式 |

### 11.2 整体验收标准

| 标准 | 说明 |
|------|------|
| 编译通过 | `gradle.bat assembleDebug` 成功，无编译错误 |
| 启动正常 | App 能启动，首次启动弹出选择主页页 |
| v4 #24：release APK 体积 < 20MB | **release APK** 体积 < 20MB（开 R8 + shrinkResources，非 debug APK） |
| v4 #23：签名 APK 安装测试 | 生成签名 APK 并通过干净 Android 安装测试（卸载旧版后安装，验证无 crash） |
| 无崩溃 | 完成所有验收操作，App 无崩溃 |
| 数据持久化 | 杀掉 App 再启动，画布/面板/组件/收藏数据保留 |
| Home 键规则 | D3 规则严格验证（先回主页再切换） |
| 缩放流畅 | 双指缩放/平移流畅，无明显卡顿 |
| 拖拽流畅 | 组件拖拽流畅，无明显延迟 |

---

## 十二、风险与缓解

### 12.1 技术风险

| 风险 | 级别 | 缓解 |
|------|------|------|
| Room version 1→2 迁移丢数据（v4 #27） | 中 | 开发期用 `fallbackToDestructiveMigration`（M1 数据丢失可接受）；**正式版前必须实现 `MIGRATION_1_2` 脚本**（附录 C），**最晚 M5 之前完成**（M5 启动数据同步后绝不允许破坏性迁移）。M5 PR review 必须包含 `MigrationTestHelper` 单元测试 |
| WebView 内存占用高（WebviewWidget + HtmlCanvasWidget） | 高 | M2 限制同时渲染的 WebView 数量（只渲染可见组件）；非可见组件用缩略图占位；M7 优化 WebView 池 |
| 双指缩放性能问题（大量组件重渲染） | 高 | 缩放期间只更新画布变换矩阵（不重渲染组件树）；用 `graphicsLayer` 而非 `Modifier.offset`；缩放结束时再更新组件缩放级别 |
| 组件拖拽期间每帧更新 Room 导致卡顿 | 中 | 拖拽期间用内存中的 `dragOffset` 临时偏移，松开时一次性提交到 Room（参考 WidgetContainer.tsx） |
| D7 聚合面板真实引用数据一致性 | 中 | 收藏组件不复制数据，通过 widgetId 引用。组件状态变更自动同步到所有位置（因为是同一 WidgetEntity）。删除组件时同时清理 favorites 表 |
| 首次启动选择主页后状态丢失 | 低 | 选择结果存入 DataStore（持久化），App 重启后直接读取 |
| 毛玻璃效果在低版本 Android 不支持 | 低 | API < 31 降级为半透明白色背景（9.2 节 glassmorphism Modifier 已处理） |
| v6 #22：双指缩放与长按拖拽手势冲突 | 中 | WidgetContainer 用 `detectDragGesturesAfterLongPress`（单指长按+拖拽），CanvasScreen 用 `detectTransformGestures`（双指缩放）。**Compose 内置手势分发机制**：`detectDragGesturesAfterLongPress` 在长按阈值（~400ms）前**不消费事件**，因此双指在长按阈值前落下时，父级 `CanvasScreen` 的 `detectTransformGestures` 能正常接管双指缩放。**边缘场景限制（M2 可接受）**：若用户先长按组件（已过 400ms 阈值，WidgetContainer 进入拖拽态并开始消费事件），再落下第二根手指，此时双指缩放不工作。用户需抬起手指重新双指缩放。**M7+ 计划**：用 `awaitEachGesture` 自实现长按+拖拽+多指检测，在 `onDrag` 中检测 `awaitPointerEvent().changes.size > 1` 时主动让出事件，彻底解决此边缘场景 |

**v6 #22：手势冲突缓解说明**（不依赖额外代码，依赖 Compose 内置手势分发机制）：

```
正常流程（双指缩放）：
  用户双指同时落下
    → WidgetContainer 的 detectDragGesturesAfterLongPress 在长按阈值（400ms）前不消费事件
    → 父级 CanvasScreen 的 detectTransformGestures 接收双指事件
    → 双指缩放正常工作

边缘场景（不完美支持，M2 接受）：
  用户先长按组件（>400ms）→ WidgetContainer 进入拖拽态 → 开始消费事件
  用户再落下第二根手指
    → WidgetContainer 已消费事件，父级 detectTransformGestures 无法介入
    → 双指缩放不工作
  解决：用户抬起手指，重新双指缩放

M7+ 彻底解决：
  用 awaitEachGesture 自实现，在 onDrag 中检测 awaitPointerEvent().changes.size
  若 >1 则主动 cancelDrag 并让出事件给父级
```

### 12.2 UX 风险

| 风险 | 级别 | 缓解 |
|------|------|------|
| Home 键规则复杂，用户可能困惑 | 中 | 在设置页加"Home 键行为说明"；首次切换模式时显示 Toast 提示 |
| 分层画布 4 档级别切换突兀 | 中 | 缩放级别切换时加 200ms 动画过渡；缩略图→卡片摘要时用 AnimatedContent |
| 画布缩放后找不到组件 | 中 | 提供"重置视图"按钮（回到 CanvasTransform.INITIAL）；加缩放百分比指示器 |
| 收藏组件后用户不知道在哪看 | 低 | 收藏成功后 Toast 提示"已收藏，可在画布主页和聚合面板查看" |

### 12.3 并行编码波次建议

```
波次 1（基础层，无依赖，可完全并行）：
  - T13 UI 升级（色值表 + glassmorphism Modifier）
  - T4 面板管理（Room 表 + Repository + TabManagerScreen 画布面板 Tab，v4 #12）
  - T2 Home 键状态机（MainViewModel 扩展 + AppMode）

波次 2（依赖波次 1）：
  - T1 画布主页（依赖 T13 色值 + T4 CanvasRepository）
  - T6 组件渲染（依赖 T4 WidgetEntity）
    - 先做 WebviewWidget（D11 前置）
    - 再做 HtmlCanvasWidget（依赖 WebviewWidget 模式）
    - AIAssistant / Calculator / FocusTimer 可并行

波次 3（依赖波次 2）：
  - T3 分层画布（依赖 T6 组件渲染 + CanvasEngine）
  - T9 下滑进画布（依赖 T1）
  - T7 组件拖拽（依赖 T6）
  - T8 缩放按钮（依赖 T3）

波次 4（依赖波次 3）：
  - T10 收藏组件（依赖 T7 WidgetContainer ⋮ 按钮 + T4 FavoriteEntry）
  - T11 WebOS 页（依赖 T10）
  - T12 聚合面板（依赖 T10 + T4 聚合面板创建）
  - T5 标签页统一（独立，底部栏模式切换）
```

---

## 附录 A：5 个 MVP 组件设计

### A.1 AIAssistantWidget（D1 占位）

```kotlin
package com.livingdashboard.ui.widgets.aiassistant

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.livingdashboard.data.entity.WidgetType
import com.livingdashboard.ui.widgets.WidgetDefinition
import com.livingdashboard.ui.widgets.WidgetRenderParams

object AIAssistantWidget {
    val definition = WidgetDefinition(
        type = WidgetType.AI_ASSISTANT,
        displayName = "AI 助手",
        defaultWidth = 280f,
        defaultHeight = 360f,
        iconRes = android.R.drawable.ic_menu_help,  // M2 临时图标，正式版用 VectorDrawable
        render = { params -> AIAssistantContent(params) }
    )
}

@Composable
private fun AIAssistantContent(params: WidgetRenderParams) {
    val messages = remember { mutableStateListOf<ChatMessage>() }
    var inputText by remember { mutableStateOf("") }

    Column(
        modifier = Modifier.fillMaxSize().padding(8.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp)
    ) {
        // 消息列表
        LazyColumn(
            modifier = Modifier.weight(1f).fillMaxWidth(),
            verticalArrangement = Arrangement.spacedBy(4.dp)
        ) {
            items(messages) { msg ->
                Text(
                    text = "${if (msg.isUser) "你" else "AI"}: ${msg.content}",
                    fontSize = 12.sp,
                    color = if (msg.isUser) Color(0xFF333333) else Color(0xFF666666)
                )
            }
        }

        // D1：AI 占位输入框
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(4.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            TextField(
                value = inputText,
                onValueChange = { inputText = it },
                placeholder = { Text("问 AI...", fontSize = 12.sp) },
                modifier = Modifier.weight(1f),
                colors = TextFieldDefaults.colors(
                    focusedContainerColor = Color.Transparent,
                    unfocusedContainerColor = Color.Transparent,
                    focusedIndicatorColor = Color.Transparent,
                    unfocusedIndicatorColor = Color.Transparent
                ),
                textStyle = LocalTextStyle.current.copy(fontSize = 12.sp)
            )
            IconButton(
                onClick = {
                    val trimmed = inputText.trim()
                    if (trimmed.isNotEmpty()) {
                        messages.add(ChatMessage(content = trimmed, isUser = true))
                        // D1：M2 占位回显
                        messages.add(ChatMessage(
                            content = "AI 功能将在 M3 接入",
                            isUser = false
                        ))
                        inputText = ""
                    }
                },
                modifier = Modifier.size(32.dp)
            ) {
                Icon(Icons.Default.Add, "发送", tint = Color(0xFF4A90E2))
            }
        }
    }
}

data class ChatMessage(val content: String, val isUser: Boolean)
```

> **v4 #15 修复**：补充缺失的 imports `androidx.compose.foundation.lazy.LazyColumn`、`androidx.compose.foundation.lazy.items`、`androidx.compose.material.icons.Icons`、`androidx.compose.material.icons.filled.Add`，修复 `LazyColumn`、`items(messages)`、`Icons.Default.Add` 未解析的编译错误。

### A.2 WebviewWidget（D11 前置依赖）

复用 M1 的 `LivingWebView` + `WebViewController` 模式。

```kotlin
package com.livingdashboard.ui.widgets.webview

import android.webkit.WebView
import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material.icons.filled.ArrowForward
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import com.livingdashboard.browser.LivingWebView
import com.livingdashboard.data.entity.WidgetType
import com.livingdashboard.ui.widgets.WidgetDefinition
import com.livingdashboard.ui.widgets.WidgetRenderParams

object WebviewWidget {
    val definition = WidgetDefinition(
        type = WidgetType.WEBVIEW,
        displayName = "网页",
        defaultWidth = 320f,
        defaultHeight = 400f,
        iconRes = android.R.drawable.ic_menu_view,
        render = { params -> WebviewContent(params) }
    )
}

@Composable
private fun WebviewContent(params: WidgetRenderParams) {
    val url = (params.state["url"] as? String) ?: "https://www.baidu.com"
    var localUrl by remember { mutableStateOf(url) }
    var webViewRef by remember { mutableStateOf<WebView?>(null) }

    Column(modifier = Modifier.fillMaxSize()) {
        // 工具栏
        Row(
            modifier = Modifier.fillMaxWidth().padding(4.dp),
            horizontalArrangement = Arrangement.spacedBy(4.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            IconButton(
                onClick = { webViewRef?.goBack() },
                modifier = Modifier.size(28.dp)
            ) {
                Icon(Icons.Default.ArrowBack, "后退", Modifier.size(14.dp))
            }
            IconButton(
                onClick = { webViewRef?.goForward() },
                modifier = Modifier.size(28.dp)
            ) {
                Icon(Icons.Default.ArrowForward, "前进", Modifier.size(14.dp))
            }
            IconButton(
                onClick = { webViewRef?.reload() },
                modifier = Modifier.size(28.dp)
            ) {
                Icon(Icons.Default.Refresh, "刷新", Modifier.size(14.dp))
            }
            TextField(
                value = localUrl,
                onValueChange = { localUrl = it },
                modifier = Modifier.weight(1f),
                placeholder = { Text("URL", fontSize = 11.sp) },
                colors = TextFieldDefaults.colors(
                    focusedContainerColor = Color(0x0D000000),
                    unfocusedContainerColor = Color(0x0D000000),
                    focusedIndicatorColor = Color.Transparent,
                    unfocusedIndicatorColor = Color.Transparent
                ),
                textStyle = LocalTextStyle.current.copy(fontSize = 11.sp),
                singleLine = true
            )
        }

        // WebView（复用 M1 的 LivingWebView）
        AndroidView(
            factory = { context ->
                LivingWebView(context).also { wv ->
                    webViewRef = wv
                    wv.loadUrl(url)
                }
            },
            update = { wv ->
                // D11：URL 变化时导航
                val currentUrl = params.state["url"] as? String
                if (currentUrl != null && currentUrl != wv.url) {
                    wv.loadUrl(currentUrl)
                }
            },
            modifier = Modifier.fillMaxSize()
        )
    }
}
```

### A.3 CalculatorWidget

```kotlin
package com.livingdashboard.ui.widgets.calculator

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.livingdashboard.data.entity.WidgetType
import com.livingdashboard.ui.widgets.WidgetDefinition
import com.livingdashboard.ui.widgets.WidgetRenderParams

object CalculatorWidget {
    val definition = WidgetDefinition(
        type = WidgetType.CALCULATOR,
        displayName = "计算器",
        defaultWidth = 240f,
        defaultHeight = 320f,
        iconRes = android.R.drawable.ic_menu_sort_by_size,  // NC10：ic_menu_calc 不存在于 Android SDK，用 ic_menu_sort_by_size 替代（临时）
        render = { params -> CalculatorContent(params) }
    )
}

@Composable
private fun CalculatorContent(params: WidgetRenderParams) {
    var expression by remember { mutableStateOf("") }
    var result by remember { mutableStateOf("") }
    var error by remember { mutableStateOf("") }

    val buttons = listOf(
        "7", "8", "9", "/",
        "4", "5", "6", "*",
        "1", "2", "3", "-",
        "0", ".", "=", "+",
        "C"
    )

    Column(
        modifier = Modifier.fillMaxSize().padding(8.dp),
        verticalArrangement = Arrangement.spacedBy(4.dp)
    ) {
        // 表达式显示
        Text(
            text = expression.ifEmpty { "0" },
            fontSize = 16.sp,
            modifier = Modifier.fillMaxWidth().padding(4.dp),
            color = Color(0xFF333333)
        )
        // 结果显示
        Text(
            text = error.ifEmpty { result },
            fontSize = 24.sp,
            modifier = Modifier.fillMaxWidth().padding(4.dp),
            color = if (error.isNotEmpty()) Color(0xFFFF3B30) else Color(0xFF333333)
        )

        // 按钮网格
        for (row in buttons.chunked(4)) {
            Row(
                modifier = Modifier.fillMaxWidth().weight(1f),
                horizontalArrangement = Arrangement.spacedBy(4.dp)
            ) {
                for (btn in row) {
                    Button(
                        onClick = {
                            when (btn) {
                                "C" -> { expression = ""; result = ""; error = "" }
                                "=" -> {
                                    try {
                                        val evalResult = CalculatorEngine.evaluate(expression)
                                        result = CalculatorEngine.formatResult(evalResult)
                                        error = ""
                                    } catch (e: Exception) {
                                        error = "错误"
                                        result = ""
                                    }
                                }
                                else -> {
                                    expression += btn
                                    error = ""
                                }
                            }
                        },
                        modifier = Modifier.weight(1f),
                        colors = ButtonDefaults.buttonColors(
                            containerColor = if (btn == "=") Color(0xFF4A90E2) else Color(0x0D000000),
                            contentColor = if (btn == "=") Color.White else Color(0xFF333333)
                        ),
                        contentPadding = PaddingValues(4.dp)
                    ) {
                        Text(btn, fontSize = 14.sp)
                    }
                }
            }
        }
    }
}
```

```kotlin
// CalculatorEngine.kt
package com.livingdashboard.ui.widgets.calculator

import net.objecthunter.exp4j.ExpressionBuilder

/**
 * 计算器表达式解析引擎。
 * 参考 desktop Calculator.tsx 的 evaluate + formatResult。
 * NC4 修复：用 exp4j 库替代 javax.script（Android 不自带 Rhino 引擎）。
 * exp4j 依赖：net.objecthunter:exp4j:0.4.8（见第十章依赖项）
 */
object CalculatorEngine {
    fun evaluate(expression: String): Double {
        val cleaned = expression
            .replace("×", "*")
            .replace("÷", "/")
            .replace("−", "-")
            .replace("π", Math.PI.toString())
            .replace("e", Math.E.toString())
        // NC4：用 exp4j 解析表达式
        val exp = ExpressionBuilder(cleaned).build()
        return exp.evaluate()
    }

    fun formatResult(value: Double): String {
        return if (value % 1.0 == 0.0) {
            value.toLong().toString()
        } else {
            String.format("%.6f", value).trimEnd('0').trimEnd('.')
        }
    }
}
```

### A.4 FocusTimerWidget

```kotlin
package com.livingdashboard.ui.widgets.focustimer

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.livingdashboard.data.entity.WidgetType
import com.livingdashboard.ui.widgets.WidgetDefinition
import com.livingdashboard.ui.widgets.WidgetRenderParams
import kotlinx.coroutines.delay

object FocusTimerWidget {
    val definition = WidgetDefinition(
        type = WidgetType.FOCUS_TIMER,
        displayName = "专注计时",
        defaultWidth = 200f,
        defaultHeight = 240f,
        iconRes = android.R.drawable.ic_menu_recent_history,
        render = { params -> FocusTimerContent(params) }
    )
}

private const val POMODORO_FOCUS_MS = 25 * 60 * 1000L

@Composable
private fun FocusTimerContent(params: WidgetRenderParams) {
    val mode = (params.state["mode"] as? String) ?: "pomodoro"
    val status = (params.state["status"] as? String) ?: "idle"
    val startedAt = (params.state["startedAt"] as? Number)?.toLong() ?: 0L

    var now by remember { mutableStateOf(System.currentTimeMillis()) }
    LaunchedEffect(status) {
        while (status == "running") {
            now = System.currentTimeMillis()
            delay(200)
        }
    }

    val elapsed = if (status == "running" && startedAt > 0) now - startedAt else 0L
    val remaining = (POMODORO_FOCUS_MS - elapsed).coerceAtLeast(0)
    val minutes = (remaining / 60000).toInt()
    val seconds = ((remaining % 60000) / 1000).toInt()
    val timeText = String.format("%02d:%02d", minutes, seconds)

    Column(
        modifier = Modifier.fillMaxSize().padding(16.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center
    ) {
        Text(
            text = if (status == "running") "专注中" else "准备开始",
            fontSize = 11.sp,
            color = Color(0xFF666666)
        )
        Spacer(modifier = Modifier.height(8.dp))
        Text(
            text = timeText,
            fontSize = 36.sp,
            color = Color(0xFF333333)
        )
        Spacer(modifier = Modifier.height(16.dp))
        Button(
            onClick = {
                if (status == "idle") {
                    params.onUpdateState(mapOf(
                        "mode" to "pomodoro",
                        "status" to "running",
                        "startedAt" to System.currentTimeMillis()
                    ))
                } else {
                    params.onUpdateState(mapOf(
                        "status" to "idle",
                        "startedAt" to 0L
                    ))
                }
            },
            modifier = Modifier.size(48.dp),
            shape = RoundedCornerShape(24.dp),
            colors = ButtonDefaults.buttonColors(
                containerColor = Color(0xFF4A90E2)
            ),
            contentPadding = PaddingValues(0.dp)
        ) {
            Icon(
                Icons.Default.PlayArrow,
                contentDescription = if (status == "running") "停止" else "开始",
                tint = Color.White
            )
        }
    }
}
```

### A.5 HtmlCanvasWidget（D11 依赖 WebviewWidget）

```kotlin
package com.livingdashboard.ui.widgets.htmlcanvas

import android.webkit.WebView
import androidx.compose.foundation.layout.*
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import com.livingdashboard.browser.LivingWebView
import com.livingdashboard.data.entity.WidgetType
import com.livingdashboard.ui.widgets.WidgetDefinition
import com.livingdashboard.ui.widgets.WidgetRenderParams

object HtmlCanvasWidget {
    val definition = WidgetDefinition(
        type = WidgetType.HTML_CANVAS,
        displayName = "HTML 画布",
        defaultWidth = 280f,
        defaultHeight = 280f,
        iconRes = android.R.drawable.ic_menu_edit,
        render = { params -> HtmlCanvasContent(params) }
    )
}

@Composable
private fun HtmlCanvasContent(params: WidgetRenderParams) {
    // D11：复用 WebviewWidget 的 LivingWebView + WebViewController 模式
    val html = (params.state["html"] as? String) ?: ""

    // v4 #16 修复：跟踪上次加载到 WebView 的 HTML
    // 原Bug：update lambda 中 `currentHtml = params.state["html"]` 与外层 `html`（同源）比较，
    // recomposition 后两者都更新为新值，恒相等，导致 HTML 变化后永不重新加载。
    // 修复：用 remember 持久化 lastLoadedHtml，factory/update 完成加载后更新它，
    // 后续 update 与 lastLoadedHtml 比较（而非与当前 html 比较）。
    val lastLoadedHtml = remember { mutableStateOf<String?>(null) }

    if (html.isEmpty()) {
        Box(
            modifier = Modifier.fillMaxSize(),
            contentAlignment = Alignment.Center
        ) {
            Text(
                text = "等待内容...",
                fontSize = 12.sp,
                color = Color(0xFF999999)
            )
        }
        return
    }

    AndroidView(
        factory = { context ->
            LivingWebView(context).apply {
                settings.javaScriptEnabled = true
                settings.domStorageEnabled = true
                // 用 loadDataWithBaseURL 渲染 HTML（避免外网请求）
                loadDataWithBaseURL(
                    "about:blank",
                    html,
                    "text/html",
                    "UTF-8",
                    null
                )
            }.also { lastLoadedHtml.value = html }  // 记录 factory 已加载的 HTML
        },
        update = { wv ->
            // v4 #16：与 lastLoadedHtml 比较，避免与当前 html 比较导致恒相等的死代码
            if (html != lastLoadedHtml.value) {
                wv.loadDataWithBaseURL("about:blank", html, "text/html", "UTF-8", null)
                lastLoadedHtml.value = html
            }
        },
        modifier = Modifier.fillMaxSize()
    )
}
```

---

## 附录 B：AppNavGraph 路由扩展

```kotlin
// AppNavGraph.kt 改（M2）
package com.livingdashboard.ui.nav

import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.navigation.NavController
import androidx.navigation.NavHostController
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.navArgument
import com.livingdashboard.ui.AppMode
import com.livingdashboard.ui.MainViewModel

object Routes {
    // M1 路由（v5 #N3：保留 M1 字符串值，避免破坏 M1 代码）
    const val BROWSER_HOME = "home"              // M1 原值 "home"
    const val BROWSER = "browser/{tabId}"        // M1 原值 "browser/{tabId}"（含模板参数）
    const val TABS = "tabs"                      // M1 原值
    const val BOOKMARKS = "bookmarks"            // M1 原值
    const val HISTORY = "history"                // M1 原值
    const val SETTINGS = "settings"              // M1 原值

    // M2 新增路由
    const val CANVAS_HOME = "canvas_home"
    const val CANVAS = "canvas/{panelId}"
    // v4 #12：移除 PANEL_MANAGER 路由，面板管理合并到 TabManagerScreen 的"画布面板"Tab
    const val WEBOS = "webos/{widgetId}"         // v5 #N3：重命名 WEBOS_FAVORITES → WEBOS
    const val AGGREGATE = "aggregate"            // v5 #N3：重命名 AGGREGATE_PANEL → AGGREGATE

    // v5 #N3：新增 browser(tabId) helper（M1 用硬编码 "browser/$tabId"，现在统一用 Routes.browser）
    fun browser(tabId: String) = "browser/$tabId"
    fun canvas(panelId: String) = "canvas/$panelId"
    fun webos(widgetId: String) = "webos/$widgetId"
}

/**
 * v5 #N1：AppNavGraph 签名与 8.1 节一致——接收外部传入的 navController。
 * 不再在函数内部 rememberNavController()，由 MainActivityContent 创建并传入。
 */
@Composable
fun AppNavGraph(
    navController: NavHostController,
    appMode: AppMode,
    mainViewModel: MainViewModel
) {
    // v5 #N5：destination 变化监听——自动调用 onEnterHome/onLeaveHome（7.3 节要求的完整实现）
    DisposableEffect(navController) {
        val listener = NavController.OnDestinationChangedListener { _, destination, _ ->
            when (destination.route) {
                Routes.BROWSER_HOME, Routes.CANVAS_HOME -> mainViewModel.onEnterHome()
                else -> mainViewModel.onLeaveHome()
            }
        }
        navController.addOnDestinationChangedListener(listener)
        onDispose { navController.removeOnDestinationChangedListener(listener) }
    }

    NavHost(
        navController = navController,
        startDestination = if (appMode == AppMode.BROWSER) Routes.BROWSER_HOME else Routes.CANVAS_HOME
    ) {
        // M1 路由（保留）
        composable(Routes.BROWSER_HOME) { /* BrowserHomeScreen */ }
        composable(Routes.BROWSER) { /* BrowserScreen */ }
        composable(Routes.TABS) {
            // v4 #12：TabManagerScreen 加 TabRow（网页标签 + 画布面板），initialMode 由当前 appMode 决定
            com.livingdashboard.ui.tab.TabManagerScreen(
                onBack = { navController.popBackStack() },
                onTabClick = { tabId ->
                    // v5 #N3：用 Routes.browser(tabId) 替代 Routes.BROWSER（含 tabId 参数）
                    navController.navigate(Routes.browser(tabId))
                },
                onPanelClick = { panelId ->
                    navController.navigate(Routes.canvas(panelId))  // 进入画布
                },
                initialMode = appMode  // v4 #12：根据当前模式默认选中 Tab
            )
        }
        composable(Routes.BOOKMARKS) { /* BookmarkScreen */ }
        composable(Routes.HISTORY) { /* HistoryScreen */ }
        composable(Routes.SETTINGS) { /* SettingsScreen */ }

        // M2 新增路由
        composable(Routes.CANVAS_HOME) {
            // NC9 修复：用 CanvasHomeViewModel.currentPanelId 而非硬编码 "current_panel_id"
            val canvasHomeViewModel: com.livingdashboard.ui.canvas.CanvasHomeViewModel = hiltViewModel()
            val currentPanelId by canvasHomeViewModel.currentPanelId.collectAsStateWithLifecycle()
            // v5 #N4：补全 CanvasHomeScreen 所有必填参数（onCircleIconClick 等）
            com.livingdashboard.ui.canvas.CanvasHomeScreen(
                onCircleIconClick = {
                    mainViewModel.onLeaveHome()
                    currentPanelId?.let { navController.navigate(Routes.canvas(it)) }
                },
                onFavoriteClick = { widgetId ->
                    mainViewModel.onLeaveHome()
                    navController.navigate(Routes.webos(widgetId))
                },
                onSwipeDownToCanvas = {
                    mainViewModel.onLeaveHome()
                    currentPanelId?.let { navController.navigate(Routes.canvas(it)) }
                },
                onShowAggregate = {
                    mainViewModel.onLeaveHome()
                    navController.navigate(Routes.AGGREGATE)
                },
                onShowTabs = {
                    mainViewModel.onLeaveHome()
                    navController.navigate(Routes.TABS)
                },
                onShowSettings = {
                    mainViewModel.onLeaveHome()
                    navController.navigate(Routes.SETTINGS)
                },
                viewModel = canvasHomeViewModel
            )
        }
        composable(
            route = Routes.CANVAS,
            arguments = listOf(navArgument("panelId") { type = NavType.StringType })
        ) { backStackEntry ->
            val panelId = backStackEntry.arguments?.getString("panelId") ?: return@composable
            // v5 #N6：CanvasScreen 加 BottomBar，需传 onShowTabs/onShowSettings
            com.livingdashboard.ui.canvas.CanvasScreen(
                panelId = panelId,
                onBack = { navController.popBackStack() },
                onShowTabs = {
                    mainViewModel.onLeaveHome()
                    navController.navigate(Routes.TABS)
                },
                onShowSettings = {
                    mainViewModel.onLeaveHome()
                    navController.navigate(Routes.SETTINGS)
                }
            )
        }
        // v4 #12：移除 PANEL_MANAGER 路由，面板管理合并到 TabManagerScreen 的"画布面板"Tab
        composable(
            route = Routes.WEBOS,
            arguments = listOf(navArgument("widgetId") { type = NavType.StringType })
        ) { backStackEntry ->
            val widgetId = backStackEntry.arguments?.getString("widgetId") ?: return@composable
            com.livingdashboard.ui.canvas.WebOSFavoritesScreen(
                widgetId = widgetId,
                onBack = { navController.popBackStack() }
            )
        }
        composable(Routes.AGGREGATE) {
            // v5 #N6 延伸：传 onShowTabs/onShowSettings 给 AggregatePanelScreen（再传给复用的 CanvasScreen 的 BottomBar）
            com.livingdashboard.ui.aggregate.AggregatePanelScreen(
                onBack = { navController.popBackStack() },
                onShowTabs = {
                    mainViewModel.onLeaveHome()
                    navController.navigate(Routes.TABS)
                },
                onShowSettings = {
                    mainViewModel.onLeaveHome()
                    navController.navigate(Routes.SETTINGS)
                }
            )
        }
    }
}
```

---

## 附录 C：数据库迁移说明

M2 将 `LivingDatabase` version 从 1 升到 2，新增 4 张表（panels / widgets / widget_positions / favorites）。

**开发期策略**：`fallbackToDestructiveMigration()` — 删除旧数据库重建。M1 的书签/历史/标签数据会丢失，开发期可接受。

> ⚠️ **v4 #27 强制要求**：以下 `MIGRATION_1_2` 迁移脚本**必须在 M5 之前实现并替换 `fallbackToDestructiveMigration()`**。M5 启动数据同步功能后，破坏性迁移会丢失用户已同步数据，绝对不允许。验收节点：M5 开发前 PR review 必须包含此迁移脚本的单元测试（建议用 `MigrationTestHelper` 验证 1→2 迁移保留 M1 数据）。

**正式版策略**（**M5 之前必须实现**，v4 #27）：

```kotlin
val MIGRATION_1_2 = object : Migration(1, 2) {
    override fun migrate(database: SupportSQLiteDatabase) {
        database.execSQL("""
            CREATE TABLE IF NOT EXISTS panels (
                id TEXT NOT NULL PRIMARY KEY,
                name TEXT NOT NULL,
                type TEXT NOT NULL,
                sortOrder INTEGER NOT NULL,
                createdAt INTEGER NOT NULL,
                updatedAt INTEGER NOT NULL
            )
        """.trimIndent())
        database.execSQL("""
            CREATE TABLE IF NOT EXISTS widgets (
                id TEXT NOT NULL PRIMARY KEY,
                panelId TEXT NOT NULL,
                type TEXT NOT NULL,
                stateJson TEXT NOT NULL,
                width REAL NOT NULL,
                height REAL NOT NULL,
                createdAt INTEGER NOT NULL,
                updatedAt INTEGER NOT NULL
            )
        """.trimIndent())
        database.execSQL("""
            CREATE TABLE IF NOT EXISTS widget_positions (
                id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
                panelId TEXT NOT NULL,
                widgetId TEXT NOT NULL,
                x REAL NOT NULL,
                y REAL NOT NULL,
                zIndex INTEGER NOT NULL,
                FOREIGN KEY(panelId) REFERENCES panels(id) ON DELETE CASCADE
            )
        """.trimIndent())
        database.execSQL("CREATE INDEX IF NOT EXISTS index_widget_positions_panelId ON widget_positions(panelId)")
        database.execSQL("CREATE INDEX IF NOT EXISTS index_widget_positions_widgetId ON widget_positions(widgetId)")
        database.execSQL("""
            CREATE TABLE IF NOT EXISTS favorites (
                id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
                widgetId TEXT NOT NULL,
                sortOrder INTEGER NOT NULL,
                createdAt INTEGER NOT NULL
            )
        """.trimIndent())
    }
}

// DatabaseModule.provideDatabase 中：
// .addMigrations(MIGRATION_1_2)
// 替代 .fallbackToDestructiveMigration()
```

---

**Spec 结束**