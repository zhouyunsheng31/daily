# 17 · M1（Lite 内测）任务执行卡

> 面向：执行 AI（含弱模型）。**做任何一个任务前，先读 [16-execution-playbook.md](16-execution-playbook.md)**（构建/调试/坑全在那里，本文不重复）。
> 范围：**内测 Lite**（用户 2026-08-16 认可的口径）= M1-1 / M1-2 / M1-3 / M1-4 / M1-5 + M0-6 合并进 M1-1。M1-6~M1-9（账号/文件同步/性能/发布）**不在 Lite 范围**，卡未写。
> 顺序即依赖：M1-1 → M1-2 → M1-3 → M1-4 → M1-5（M1-4 依赖 M1-1 的宿主骨架；M1-5 随时可插）。
> 卡片状态用「⬜ 未开始 / 🔶 进行中 / ✅ 完成」标记，完成时更新本表 + `14-dev-status.md`。

| 卡 | 任务 | 状态 |
|---|---|---|
| M1-1 | 沉浸式宿主骨架（方案 A 横滑导航 + edge-to-edge） | ⬜ |
| M1-2 | 端侧 AI 真实接入（harness + BYOK 配置页） | ⬜ |
| M1-3 | App 管理（版本时间线 / 回滚 / 删除） | ⬜ |
| M1-4 | 桌面启动器体验（多页 / 边缘翻页 / 文件夹 / 手势让渡） | ⬜ |
| M1-5 | 权限 Tier0 引导卡 | ⬜ |

**公共纪律（每张卡都适用，不在卡内重复）**：

1. 构建按 16 §2；真机验证按 16 §3（导航命令链！截图必须链内！）。
2. UI/视觉细节**不得自行拍板**（红线）：卡内标「📐需用户定」的点，出候选给用户选；M0 占位风格（Material 默认）仅作为骨架期过渡，不得宣称最终设计。
3. 触及服务端：新端点一律进 `server/src/webos/` 新模块，**禁止改 webos.ts**（冻结；触及即瘦身纪律）；改完需服务器重启验证（pm2 restart daily-server）。
4. 每卡完成：commit（一卡一提交）+ CHANGELOG 记条目 + 更新本表状态 + 14-dev-status。
5. 遇到卡内没写的问题：先查 16 §5 坑索引；还解决不了 → 停下问用户，**不要自由发挥架构**。

---

## 卡 M1-1：沉浸式宿主骨架（方案 A 横滑导航 + edge-to-edge）

**前置阅读**：10-ui-design §0（用户方向 v1）+ §2（信息架构 v2）；16 §6（手势前置知识）。

**目标**：App 从"四 Tab + 顶栏"变成"沉浸启动器骨架"——

```
HorizontalPager:
  page 0 = ChatScreen（宿主 Compose，现有组件复用）
  page 1 = DesktopHostScreen（系统桌面 App 的 WebView 宿主，复用 AppRuntimeHost）
初始页 = page 1（桌面）；桌面继续右滑 → 露出对话页（方案 A）
App 运行页（AppRunScreen）= 全屏覆盖层：去顶栏、edge-to-edge、predictive back
```

**验收**（真机）：

- [ ] 无底部 NavigationBar、无 Scaffold 顶栏；壁纸透底到状态栏/手势条区域。
- [ ] 横滑可在 对话页 ⇄ 桌面 间切换（HorizontalPager 两页即可；桌面内多页翻页 M1-4 做）。
- [ ] 桌面 WebView 内横滑与 Pager 滑动**不冲突**（桌面页未到边缘时 Pager 不动——M1-1 允许先做"桌面页整体不响应 Pager 拖拽、仅状态/按钮切页"的降级版，跟手版随 M1-4 让渡机制一起做）。
- [ ] AppRunScreen 沉浸全屏（隐藏顶栏；返回用手势/返回键）；系统桌面 App 仍正常渲染（pageState 正常 + 截图验证）。
- [ ] ChatScreen 在新骨架下输入/流式正常（M0-2 SSE 链路回归）。

**涉及文件**：

| 文件 | 改动 |
|---|---|
| `client/android/app/.../ui/DailyApp.kt` | **重写**：拆 Scaffold/NavigationBar/DailyTab → `HorizontalPager(state=rememberPagerState{2})`；`enableEdgeToEdge()`（MainActivity）；openApp 保持覆盖层模式 |
| `client/android/app/.../MainActivity.kt` | 加 `enableEdgeToEdge()`；状态栏图标浅色适配（壁纸深色时） |
| `client/android/app/.../ui/apps/AppRunScreen.kt` | 去 Surface 顶栏 + statusBarsPadding → 全屏沉浸；内部保留"返回手势"依赖系统 predictive back |
| 新增 `client/android/app/.../ui/desktop/DesktopHostScreen.kt` | 桌面页宿主：复用 AppRuntimeHost 加载 `system.desktop`（appId 固定），透传 onOpenApp/onNavigate |
| `client/android/app/build.gradle.kts` | 确认 `androidx.compose.foundation`（Pager 在 foundation 里，Bom 应已含） |

**实施步骤**：

1. MainActivity `enableEdgeToEdge()`；确认 manifest 无 `windowActionBar` 残留。
2. 新建 DesktopHostScreen：参数 `onOpenApp(id,name)`；内部逻辑抄现 AppsScreen→AppRunScreen 的加载链（api.appDetail("system.desktop") → AndroidView(factory){ createWebView + `wv.post { loadApp }` }——**post 延迟加载不能丢**，见 16 §5.2）。
3. DailyApp 重写为 Pager 两页；初始页 index=1；ChatScreen 原样搬进 page 0。
4. AppsScreen（旧桌面 Tab 列表页）：保留文件（开发期调试入口），但不再挂载；或降级为「长按桌面 dock 的'全部应用'入口」——📐需用户定（候选：A 桌面下拉搜索 B dock 加"全部"钮 C 暂时只留 WebView 桌面）。
5. AppRunScreen 沉浸化：删顶栏，返回依赖系统手势；顶部加 12dp 拖拽热区预留（M1-3 的"呼出 App 信息"用）。

**验证**：构建安装 → 导航链 → 横滑切换录屏/截图；logcat `AppRuntime` 确认桌面 pageState 正常；ChatScreen 发一条消息走通 SSE。

**已知坑**：WebView 会吃掉横向触摸 → Pager 拖不动：M1-1 降级方案 = DesktopHostScreen 外包一层 `pointerInput` 检测（或 `userSwipeEnabled=false` + 顶/底状态切换按钮过渡）；**不要**在此卡里深度实现让渡（那是 M1-4）。ChatScreen 输入框需 `navigationBarsPadding()`/`imePadding()` 适配（去 Scaffold 后 insets 自己管）。

**📐需用户定**：对话页初始状态（空会话引导卡文案）、桌面 dock 形态沿用现有模板 dock。

---

## 卡 M1-2：端侧 AI 真实接入（harness 常驻 + BYOK 配置页）

**前置阅读**：08-media-ai §6（BYOK 全规格）；14-dev-status §4.5 M0-2 行（spike 资源位置与已验证能力）；core/agent 现有代码（AgentChatSource / AgentBridgeClient / AgentHarness / HarnessProcessManager 均已编译通过）。

**目标**：把 M0-2 spike（命令行验证）接进 App——对话页真正走端侧 pi（proot + rootfs + Node harness），BYOK 密钥 Keystore 加密，断网可对话。

**验收**（真机，断网飞行模式下）：

- [ ] 配置 DeepSeek Key → 发消息 → 流式回复（delta/thinking 渲染与 SSE 版一致）。
- [ ] Key 存 Keystore（配置页掩码显示 `sk-****abcd`；不进日志/不上传）。
- [ ] 未配置 Key：对话请求返回明确 `MODEL_NOT_CONFIGURED` 提示卡（不伪造、不偷偷走平台模型）。
- [ ] harness 进程崩溃 → 自动重启 + 会话可恢复（spike 已验证 SessionManager 文件模式）。
- [ ] 冷启动到可对话 ≤10s（M0-3 基线 2.7s，回归不劣化）。

**涉及文件**：

| 文件 | 改动 |
|---|---|
| `client/android/agent/.../HarnessProcessManager.kt` | 从 spike 逻辑落地：rootfs 从 `/data/local/tmp/daily-rootfs` 迁到 `context.filesDir`（155MB，一次性拷贝/首次启动解包——📐迁移方式需评估，问用户前先做"存在 tmp 就先用"的过渡） |
| `client/android/core/.../agent/AgentBridgeClient.kt` | 已有 JSON-RPC（session.turn/abort/ping）；接 stdio |
| `client/android/app/.../di/AppModule.kt` | Koin 注册链：HarnessProcessManager → AgentBridgeClient → **AgentChatSource（真实实现替换 getOrNull 占位）**；注意 ChatViewModel 分支逻辑已有（agentSource != null 走本地 turn） |
| 新增 `client/android/app/.../data/ByokStore.kt` | Android Keystore 加密（EncryptedSharedPreferences 或 Keystore AES + DataStore 密文；参考桌面端 apiKeyStore 思路但必须 Android Keystore） |
| 新增 `client/android/app/.../ui/byok/ByokConfigScreen.kt` | 08 §6.3：provider 列表/添加（DeepSeek/OpenAI 兼容/Anthropic）/测试连接/掩码；入口：对话页"配置你的模型"引导卡 + 设置页 |
| `client/android/app/.../ui/chat/ChatViewModel.kt` | 已有本地分支（startLocalTurn）；接 thinkingLevel 传递 |

**实施步骤**：

1. rootfs 资源确认：`adb ls /data/local/tmp/daily-rootfs`（spike 遗留）；写 `HarnessProcessManager.ensureRootfs()`（filesDir 不存在 → 先用 tmp 路径，日志 warn）。
2. ByokStore：Keystore 生成 AES key，加密 JSON `{providers:[{type,baseUrl,key,model}],default}` 落 DataStore；测试连接 = harness `ping` + provider 真发 1 token。
3. AppModule 组装真实 AgentChatSource（harness 启动时机：首次对话或 App 启动后台预热——📐需用户定，默认后台预热）。
4. ChatViewModel：`MODEL_NOT_CONFIGURED` 分支 → UI 引导卡。
5. ByokConfigScreen 挂到对话页引导卡入口。

**验证**：飞行模式开 → 对话 → 流式回复；杀进程重进 → AI 记得上一轮（会话恢复）；logcat 无 key 明文（grep Key 前缀）。

**已知坑**：proot 拉起命令行模板在 spike 会话记录里（`proot-static -r rootfs -b /proc:/proc ...`——**/proc 绑定不能少**，memoryUsage ENOENT）；harness stdout 行协议 = JSON-RPC 一行一条（AgentBridgeClient.onLine 已实现）；rootfs 155MB 拷贝进 app 私有目录耗时（用 `cp -a` + 进度提示）。

---

## 卡 M1-3：App 管理（版本时间线 / 回滚 / 删除）

**前置阅读**：01-product J4（魔法时刻旅程）；16 §4.2（版本 API）。

**目标**：App 运行页呼出「App 信息」面板：版本时间线 + 一键回滚 + 删除；apps_changed 实时刷新桌面。

**验收**（真机）：

- [ ] J4 全链路：AI 建 App（对话页发起）→ 桌面出现 → 打开 → 呼出信息 → 看版本历史 → 回滚旧版 → 运行页刷新为旧版 HTML。
- [ ] 删除 App → 桌面图标消失（apps_changed 或重拉列表）。
- [ ] 回滚 = 调 `POST /apps/:appId/rollback`（服务端已有）；删除 = 对话页让 AI 删 或 信息面板按钮（服务端 delete 端点查 16 §4.2 补充）。

**涉及文件**：

| 文件 | 改动 |
|---|---|
| `client/android/core/.../network/WebosApi.kt` | 补 `appVersions`（已有 appDetail 含 versions）、`rollbackApp(appId, versionId)`、`deleteApp(appId)`（DELETE /webos/api/apps/:appId——先 grep server 确认路由存在，不存在则**新模块加端点**） |
| `client/android/app-runtime/.../DailyJsBridge.kt` | 补 `apps.remove`（respond 真实结果）+ 通知宿主刷新桌面列表（回调 onAppsChanged → DesktopHostScreen 重拉） |
| `client/android/app/.../ui/apps/AppRunScreen.kt` | 沉浸版信息面板：顶部下拉热区（M1-1 预留）或右下 24dp 悬浮钮 → BottomSheet：版本时间线（AppDetail.versions 渲染，activeVersionId 高亮）+ 回滚按钮 + 删除（二次确认） |
| `client/android/app/.../ui/desktop/DesktopHostScreen.kt` | onAppsChanged 回调（WebView → 宿主重拉 apps 列表，桌面 SDK.apps.list 会自动刷新渲染） |

**实施步骤**：1) WebosApi 补方法（先 curl 验证服务端行为，JWT 见 16 §1.1）→ 2) 信息面板 UI → 3) 回滚后 `loadApp` 重载（新 detail）→ 4) apps_changed 链路（桌面模板已监听该事件，Android 侧只需在宿主重拉后向 WebView 发 `apps_changed` 消息——协议见 runtime.ts `notifyAppsChanged`）。

**验证**：J4 链路全走一遍（导航链 + logcat `bridge resp` 观察方法成败）。

**已知坑**：rollback 后服务端会切 activeVersionId 并写工作区镜像（syncAppSourceFromWorkspace）——详情重拉时注意 `activeHtml` 已换；删除 system.* 内置 App 会被服务端拒（明确提示，不 retry）。

---

## 卡 M1-4：桌面启动器体验（多页 / 边缘翻页 / 文件夹 / 手势让渡）

**前置阅读**：10 §0（方向）+ §2 v2；16 §6（手势前置）；`server/src/webosDesktopV1.ts`（桌面模板——多页/文件夹改这里或其新版本）；`client/shell-web/src/runtime.ts`（desktop 桥契约权威源）。

> ⚠️ **本卡含全项目最大未定技术点（手势让渡），分两阶段：先数据层/UI，后让渡。让渡设计稿未经用户确认前不得动工实现跟手版。**

**目标**：桌面 HTML（AI 可改层）具备启动器能力：

1. **多页**：布局数据模型 `pages: [[item…], …]`，图标满页自动溢出下一页；页指示点跟随。
2. **边缘翻页**：编辑模式拖图标到屏幕左右边缘（驻留 ~600ms）→ 自动翻到相邻页落位。
3. **文件夹**：拖图标 A 叠到图标 B 上（重叠中心距 < 阈值）→ 合并创建 folder（图标宫格预览 + 打开小窗）；folder 内可拖出（剩 1 个时解散）。
4. **手势让渡**（阶段二）：桌面在最左页且继续向右拉 → 桌面让渡给宿主 Pager（露出对话页，方案 A）。

**验收**（真机 + Playwright 线上回归双跑，模板改动影响 PWA）：

- [ ] 建两个文件夹 + 三页图标：拖拽流畅 60fps（11 §2 测法）。
- [ ] 边缘驻留翻页落位正确，松手不丢图标。
- [ ] 文件夹：合并/打开/重命名/拖出解散；PWA 与 Android 行为一致。
- [ ] 布局持久化：杀进程重进布局不变（服务端存储）。
- [ ] 让渡（阶段二）：桌面最左页右拉 → 露出对话页，跟手无跳变；对话页左滑回桌面。
- [ ] **线上 PWA 桌面回归**：模板升级后跑重置脚本（tmp/reset-desktops 模式，AGENT.md Playwright 手册），真实账号验证。

**涉及文件**：

| 文件 | 改动 |
|---|---|
| 新增 `server/src/webos/desktopLayout.ts` | **布局数据端点**（GET/PUT /webos/api/desktop-layout）：`{pages:[[{type:'app'|'folder', id, children?}]]}`；存 state（同 appStorage 模式）；**禁止碰 webos.ts** |
| `server/src/webosDesktopV1.ts` | 升级为 V2（多页渲染/文件夹/边缘翻页/叠放合并；保留 V1 可回滚）；JS：renderPages(layout)、drop 目标计算（重叠中心距 < 40% tile 宽 = folder 合并）、边缘驻留计时器 |
| `client/shell-web/src/runtime.ts` | handleDesktopRequest 补：`layout.get/layout.put`（权威契约先改这里） |
| `client/android/.../DailyJsBridge.kt` | 镜像补 `layout.get/layout.put`（16 §4.1 规矩：契约跟 PWA） |
| `client/android/.../ui/desktop/DesktopHostScreen.kt` + DailyApp.kt | 阶段二让渡：桥 `gesture.yield` 消息（桌面在最左页继续右拉时发出）→ 宿主 Pager `animateScrollToPage(0)`；跟手感调优（让渡后桌面锁定横滚直到松手） |

**实施步骤（严格按序）**：

1. 服务端 desktopLayout.ts（+ curl 验证）。
2. runtime.ts 契约 + PWA 宿主适配。
3. 桌面模板 V2：先多页渲染（数据能存能恢复）→ 再边缘翻页 → 再文件夹。
4. Android 桥镜像 + DesktopHostScreen 布局读写。
5. Playwright 线上回归（真实账号）+ 真机验证。
6. 阶段二让渡设计稿（触发阈值/锁定策略/回弹动画）→ **📐用户确认后**实现。

**已知坑**：拖拽期间模板锁页（`#pages.locked`），边缘翻页需在锁定下用 `scrollTo({left})` 程序翻页；folder id 用 `folder-<uuid>`（不与 appId 冲突）；apps.list 返回的 id 与布局里的引用要在渲染时对账（被删 App 清引用）；PWA 沙箱 iframe 无 cookie 的素材规则照旧（16 §4.3 raw 端点公开）。

**📐需用户定**：文件夹打开形态（全屏页/居中小窗）；每页列数（4×6/4×7）；让渡触发阈值手感参数（阶段二出候选）。

---

## 卡 M1-5：权限 Tier0 引导卡

**前置阅读**：07-permissions §5（验收用例 1、3）；01-product J2（能力引导）。

**目标**：悬浮窗/通知等系统权限**按需触发式引导**（不在首启堆弹窗）；能力检测上报。

**验收**（07 §5 用例 1、3）：

- [ ] 新机仅授权悬浮窗 + 无障碍 → "AI 做桌宠/帮你点xx"全流程可走（Lite 范围内桌宠为应用内形态，悬浮窗引导卡先做 UI + 检测，overlay 行为本身仍冻结——M2-5 红线）。
- [ ] 授权撤销（系统设置关掉）→ capability 检测实时反映，任务明确提示不崩溃。

**涉及文件**：新增 `client/android/capability/` 模块最小实现（权限检测工具函数 + capability map）；对话页触发式引导卡组件（宿主 Compose）；服务端上报端点**本卡可缓**（存本地即可，REST 端点 M1-5 尾部再接）。

**实施步骤**：检测层（canDrawOverlays/isNotificationListenerEnabled 等）→ 引导卡 UI（一句话 + 去开启 + 稍后）→ onResume 重检测刷新。

**已知坑**：`Settings.canDrawOverlays` 需 API 23+；引导卡文案不得恐吓式；权限被拒不得阻断其他功能。

**📐需用户定**：引导卡视觉（占位先 Material 卡，正式样式后评）。

---

## 附：Lite 之外的 M1 余项（占位备忘，未出卡）

- M1-6 账号（邮箱登录/游客迁移）、M1-7 文件同步、M1-8 性能基线/Baseline Profile、M1-9 发布通道——内测 Lite 后按 12-roadmap 顺序补卡。
- M0-6 设计走查：合并进 M1-1 验收（骨架成型后双主题截图评审，用户主导）。