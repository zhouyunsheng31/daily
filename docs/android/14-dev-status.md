# 14 · 开发状态快照与开工基线（2026-08-15）

> 本文是 Android 端开工时的「现场快照」，记录：仓库/远端情况、脚手架 zip 包位置与内容、环境实测基线、已拍板决策。
> 目的：任何时候（换设备/换 AI/断档）重新接手，读本文 + 13-dev-toolchain 即可知道「我们从哪里开始、东西放在哪」。

## 1. GitHub 远端情况（2026-08-15 用用户 token 实测）

- 账号：`zhouyunsheng31`
- 仓库：**`zhouyunsheng31/daily`**（private，默认分支 `main`，约 21MB，description "Daily repository"）
- 历史：仅 2 个 commit（`65849783` Initial commit 2026-07-13；`3ba8d6f4` chore: upload event project to GitHub 2026-07-25）
  → **远端是 7-25 的旧快照，无后续更新；工作区本地内容才是权威最新版**（docs/android/*、13-dev-toolchain 等 8 月文件均不在远端）
- **GitHub Actions：workflow 数量为 0**（`actions/workflows` 返回空），CI 从零建
- ⚠️ 首次推送需要 `--force` 建立本地权威历史（远端旧历史与本地无共同祖先，见 §5 执行记录）

## 2. 脚手架压缩包位置（重要，勿丢）

| 项 | 值 |
|---|---|
| 原始 zip | **`/sdcard/workspace_42e234d4.zip`**（2,120,078 字节 ≈ 2.1MB） |
| 解压目录 | 工作区 `tmp/workspace_42e234d4/42e234d4-cbbc-4a0e-83bf-8645ffb1b2ac/` |
| 来源 | Operit 生成的 Android 模板（README 注明"Operit Android 项目"） |

### 包内资产清单

| 文件 | 说明 |
|---|---|
| `tools/aapt2/aapt2-arm64-v8a` | **ARM64 aapt2**（ReVanced 构建，v1.0.0，SHA-256 `e5b5ff7f0d4f6ecd7fa5d05d77fed3f09f6f1bf80f078b8aada82bc578848561` 已校验一致）——解决 proot 本地构建最大障碍 |
| `setup_android_env.sh`（19KB） | 一键环境脚本：装 OpenJDK17 + Gradle 9.1.0（国内镜像测速）+ Android cmdline-tools/SDK35/build-tools35 + aapt2 替换（SDK 与 Gradle 缓存双路径）+ wrapper 指向本地 zip + 关 aapt2 daemon（proot 兼容） |
| `gradle/libs.versions.toml` | AGP `9.0.0` / composeBom `2026.01.01` / coreKtx 1.10.1 / activityCompose 1.8.0 等 |
| `app/build.gradle.kts` | 含 aapt2 `linux-aarch64` resolutionStrategy 强制替换 + `android.aapt2.process.daemon=false` 说明 |
| `gradle/wrapper/` | gradle-wrapper.jar + properties（**distributionUrl 被脚本改成 `file://` 本地路径，提交前必须恢复官方 URL**） |
| `settings.gradle.kts` | 阿里云/华为云镜像仓库（国内网络友好；CI 上保留 google()/mavenCentral()） |
| 模板工程 | `com.java.myapplication` 单模块 Compose 空壳（Hello World），**不可直接用，需改造** |

### 模板已知问题（改造时必须处理）

1. `libs.versions.toml` 的 plugins 引用 `version.ref = "kotlin"`，但 `[versions]` 里**没有定义 kotlin**（README 里写了 2.3.10）→ 需补 `kotlin = "2.3.10"`
2. 包名/namespace `com.java.myapplication` → 必须改为 `xyz.shadowshub.daily`
3. minSdk 24 → 文档要求 26
4. 单模块 → 文档要求多模块（app/core/app-runtime/overlay-runtime/capability/packages/sync + baselineprofile/macrobenchmark）
5. gradlew 权限是 `-rw-------` → 需 chmod +x（Git mode 100755）
6. 无 CI workflow → 需按 13 号文档 §6 写 `.github/workflows/android.yml`
7. 无 Koin/OkHttp-SSE/Room-KSP/DataStore/WebKit/WorkManager/Coil/detekt 依赖 → 补 Version Catalog

## 3. 环境实测基线（2026-08-15，与 13 号文档 §1 一致并更新）

| 项目 | 实测值 | 影响 |
|---|---|---|
| 架构 | aarch64（Android 12 内核） | 只能跑 ARM64 二进制 |
| Ubuntu | 24.04 风格 proot，HOME=/root | Node v24 可用 |
| **Java/JDK** | 未安装 | 本地构建需 `apt install openjdk-17-jdk` |
| Gradle / Android SDK / adb | 未安装 | 本地构建需 setup 脚本 |
| **git** | 未安装（本轮已 `apt install git`） | 本地版本管理已就绪 |
| 存储 | 220G 总量，**24G 可用（90% 已用）** | 缓存预算 ≤6GB，禁模拟器 |
| 内存 | 7.2G 总，**available ≈ 2.0G** | 本地大构建有被杀风险，云端为权威 |
| unzip | 无（用 python3 zipfile 解压） | — |

## 4. 已拍板执行决策（本轮确认）

1. ~~**主路径 = GitHub Actions 云构建**~~ → **2026-08-15 晚调整：GitHub 不可达，本地 ARM64 构建为主路径**（见 §5 执行记录：HTTPS push 408 超时、梯子无效、服务器中转手机上行也超时；待网络改善后再补 GitHub 推送与 CI）
2. 本地构建成功定义（13 号文档 §9）：同一 commit 本地与云端都能 assembleDebug 且 APK 行为一致；否则云端权威——**当前云端不可用，本地即为唯一验证环境**
3. **本地 git = 版本管理的唯一权威**（5b94ade 基线），不依赖任何远端
4. `client/android/` 旧 LivingDashboard 工程（2026-07-29，Hilt/AGP8.2.2/单模块，196 个 .kt）**不删除，移入 `docs/android/assets/legacy-livingdashboard/` 存档**（其中 AI 对话/WS 实现有参考价值，且是自有代码可复用）。
5. 签名纪律：debug 签名本地自动生成；release keystore 手机离线生成后进私有加密存储，绝不入库/对话/日志。
6. ⚠️ 安全记录：用户曾将 GitHub PAT 直接发在对话中，**该 token 已视为暴露，需在 GitHub 后台 revoke 并重新签发**；后续凭证只走环境变量/Secret。另已注册：手机 SSH key（daily-dev-phone，id 160050633）、服务器 GitHub deploy key（daily-server-mirror，id 160051375，只对 daily 仓库可写）。
7. **UI/图标设计协作红线（2026-08-15 用户要求）**：正式 UI 设计与 App 图标设计**必须由用户主导**——AI 按用户指示执行（用户给方向 → AI 出候选 → 用户选定 → AI 落地），禁止 AI 自行拍板界面风格/配色/布局/图标。M0 占位界面/占位图标（技术验证载体）除外，不得对外宣称是最终设计。已同步写入根 AGENT.md。
8. **真机输入注入红线（2026-08-15 事故）**：禁止对非被测应用（尤其 Operit 宿主）执行 input text/tap/keyevent 注入；测试前必须 `dumpsys window | grep mCurrentFocus` 确认前台是被测应用；输入法操作（ime set/force-stop IME）须用户许可。事故记录：误向 Operit 输入框注入文本 → 微信键盘（默认输入法 wetype）连接异常、用户无法拉起键盘 → 修复：`am force-stop com.tencent.wetype` + `ime set` 切换刷新。
9. **桌宠范围（2026-08-15 用户拍板）**：暂只做**应用内桌宠**（M1-4 桌面 Tab 桌宠层，A 形态）；**悬浮窗桌宠（overlay-runtime，浮在其他 App 上层的 B 形态）整体暂缓**——M0-5 悬浮窗验证、M2-5 overlay-runtime 完整版在用户明确要做之前**不动**（M2-5 的 pet-layer 包类型保留）。已同步写入 AGENT.md 决策 10 + 12-roadmap + 02-architecture。**补充（同日）**：桌宠内容 **100% AI 包化**——宿主只做一次性容器（桌面页共享 canvas WebView 挂载点 + 默认极简桌宠（默认包）+ pet-layer 最小包加载提前到 M1-4），形象/动画/行为/素材全部由 AI 生成的 pet-layer 包提供；M2-5 只保留完整版（多桌宠管理/行为参数/native physics）。

## 4.5 里程碑进度（2026-08-15 晚快照）

| 里程碑 | 状态 | 说明 |
|---|---|---|
| **M0-1 工程脚手架** | ✅ 完成 | 9 模块 + 四 Tab 空壳 + 服务器构建管线 + 真机安装运行验证；CI workflow 已写但 GitHub 不可达暂挂起 |
| **M0-2 对话链路** | ✅ 完成（⚠️ D15 前实现） | 游客鉴权 + bootstrap + chat/stream SSE 全事件渲染（delta/thinking/tool chips/done 用量）；真机多轮对话验证通过（AI 记忆上下文）；断网自动 resume + 手动恢复按钮已实现。**D15（端侧 AI 唯一路径）拍板后，M0-2 已重定义为「端侧 pi spike」**（12-roadmap 新 M0-2/M0-3）；本实现保留作 PWA 维护模式资产，Android 对话改走本地 harness |
| **M0-2 端侧 pi spike（D15 新）** | ✅ 真机验收通过 | **全链路真机跑通**：proot-static v5.3.0（GitHub proot-me）+ ubuntu-base 24.04.3 arm64 rootfs（含 node v24.18.0 + pi 0.79.10 SDK + harness，服务器 qemu 组装打包 155MB）+ Termux proot 方案弃用（execve ENOENT）。**验收达标**：① 10 轮本地对话 turns=10 done=10 errors=0（无事件丢失）② 零服务端 AI 依赖 ③ 进程崩溃重启后会话可恢复（SessionManager 文件模式 + open 恢复，真机验证 AI 答出上一轮姓名）。资源位置：手机 `/data/local/tmp/{proot-static,daily-rootfs/}`（spike 用，正式落 `files/`）；rootfs 构建源码 `/root/daily-rootfs-src/`（服务器）。**待办**：App 内接入真实 AgentChatSource（Koin 替换占位）+ BYOK Keystore 配置页（M1-2） |
| **M0-3 进程占用与性能实测（D15 红线）** | ✅ 真机达标 | 魅族 Lucky 08 实测（perf-test.js，落档 perf-reports/m0-3-onside-pi-2026-08-15.md）：**冷启动 2.7s**（预算 ≤10s）、**首 token 均值 2.9s**（≤5s）、**RSS 稳定 140–142MB**（≤300MB，10 会话后）、12 轮上下文增长平坦无泄漏。附带修复：proot 下 `process.memoryUsage()` ENOENT（main.js status 防御 + `-b /proc:/proc`）；perf-test stdout/stderr 缓冲分离 |
| M0-4 App Runtime 验证 | ✅ 完成（2026-08-16 白屏修复） | AppRuntimeHost（WebView 沙箱 + base 注入 + Bootstrap JS）+ DailyJsBridge（storage 桥）+ AppsScreen/AppRunScreen 已实现；**桌面 WebView 白屏已修复**（三处根因：①启动即崩 = Koin `single<AgentChatSource?> { null }` 非法 null single → 改 getOrNull；②启动即请求 `apps.list` 等 postMessage 直连桌面方法未实现 → DailyJsBridge 补齐 apps.list/apps.open/system.navigate（镜像 PWA runtime.ts handleDesktopRequest）+ DailyApp 宿主联动；③视觉白屏 = AndroidView factory 时机 WebView 未布局 viewport vh=0 → 显式 MATCH_PARENT layoutParams + `wv.post {}` 延迟加载）。真机验证：桌面完整渲染（时钟/图标网格/指示器/Dock）+ 顶栏 insets + apps 列表按 id 去重（dataLen 510→345）；bootstrap apps.list 双份 builtin+user 是服务端结构，客户端去重即可 |
| M0-5 悬浮窗验证 | ⏸ 暂缓（2026-08-15 用户拍板） | 悬浮窗桌宠（B 形态）在用户明确要做之前**不动**；桌宠只做应用内（M1-4） |
| M0-6 设计走查 | 🔶 并入 M1-1 | 10-ui-design §0 用户方向 v1 已立（D18 方案 A）；骨架成型后双主题截图评审（用户主导） |
| **M1-1 四大页面完整实现** | ✅ 完成（2026-08-16，沉浸式骨架 + UI 基础） | 骨架：HorizontalPager 两页（对话⇄桌面，初始=桌面）、无 Tab 栏/顶栏、edge-to-edge、AppRunScreen 沉浸化、桌面 WebView 宿主；UI 基础：E1 Adaptive Icon + design tokens 契约 + Compose 双主题。**遗留**：① system.files 无 HTML 版本（服务端缺默认模板，点开报错，待补——M1-3 或服务端补模板）；② 桌面→对话手势让渡降级为顶部按钮（M1-4 做）；③ M0-6 双主题截图评审待用户主导 |

**当前构建方式**：`bash deploy/android-build.sh --install`（手机打包 → 香港服务器 x86_64 构建 2m58s → APK 拉回安装）。

## 5. 执行记录（时间线）
- 2026-08-15：拿到脚手架 zip（/sdcard/workspace_42e234d4.zip）并解压存档
- 2026-08-15：确认 GitHub 仓库 zhouyunsheng31/daily（private，无 Actions）
- 2026-08-15：安装 git、本地仓库初始化 + 基线 commit（37ffe68 → 重建 5b94ade）、旧 LivingDashboard 存档
- 2026-08-15：M0-1 脚手架（9 模块 + 四 Tab + CI workflow）落地
- 2026-08-15 ⚠️ **事故与教训**：误删 `.git/objects` 下的 `.l2s.tmp_obj_*`（本环境 git 对象的延迟存储符号链接目标），导致对象库损坏 → 工作区无损，重建 .git 为单 commit（5b94ade）。**教训：绝不对 `.git/objects` 手动 find -delete；本环境 git 对象以 symlink 指向 `.l2s.tmp_obj_*` 延迟文件，属 Operit 存储层特性**
- 2026-08-15：GitHub push 尝试全部失败（HTTPS 408 / SSH 443 超时 / 香港服务器中转手机上行也超时）→ **决策：本地构建为主路径，GitHub 推送挂起**
- 2026-08-15：`setup_android_env.sh` 后台执行中（JDK17 已装，cmdline-tools/SDK 下载中，手机网络 ~130KB/s 较慢）
- 2026-08-15 ✅ **服务器构建打通（最终主路径）**：手机 proot 本地构建受限于 ARM64 aapt2 兼容（AGP9 不认 `aapt2FromMavenOverride` 校验、transforms 缓存完整性保护），改用 **香港服务器（x86_64, 2h4g）中转构建**：手机打包（2MB）→ scp 服务器（2.3s）→ 服务器装 JDK17 + cmdline-tools + platforms-35 + build-tools-35/36 + Gradle9.1（腾讯云）→ `gradle :app:assembleDebug --no-daemon --max-workers=1 -Xmx1536m` **2m58s 构建成功**（官方 x86_64 aapt2 零兼容问题）→ APK 拉回手机（20MB, SHA256 b644d0e1...）→ `pm install` 成功 → 启动截图验证**四 Tab 空壳运行**（对话/桌面/商店/我的）
- 2026-08-15：一键构建脚本 `deploy/android-build.sh`（打包→上传→服务器构建[自动移除 ARM64 hack + 限内存防 OOM]→拉回→可选安装）
- 2026-08-15 ✅ **M0-2 对话链路完成**（D15 前版本，服务端 SSE 链路）：core（ChatEvent 契约镜像/SseSource/WebosApi/WebosRepository）+ app（SessionStore/PersistentCookieJar/ChatViewModel/ChatScreen 占位 UI）；Koin 三连修（ChatViewModel 未注册、CookieJar 接口绑定、koinViewModel 包路径）；真机验证：游客 99 积分、SSE 流式回复、thinking/tool chips/done 用量渲染、多轮上下文记忆
 - 2026-08-15 ✅ **M0-2 端侧 pi spike 真机验收通过**（D15 新路径，commit a0c48cb）：proot-static v5.3.0 + ubuntu-base 24.04.3 rootfs（qemu 组装，155MB）真机全链路；10 轮 turns=10 done=10 errors=0；崩溃重启会话恢复（AI 答出「阿芸」）；harness 事件映射对齐 webos.ts + 120ms 合并（事件量降 7 倍）；Kotlin agent 模块 + 桥客户端 + ChatViewModel 本地分支已编译（服务器构建绿）
 - 2026-08-15 ✅ **M0-3 性能实测达标**（D15 红线，commit 见下）：真机冷启动 2.7s / 首 token 均值 2.9s / RSS 稳定 140–142MB（10 会话后）/ 12 轮增长平坦；落档 perf-reports/m0-3-onside-pi-2026-08-15.md + 11 §2 预算表；修复 proot 下 memoryUsage ENOENT（-b /proc:/proc + status 防御）
 - 2026-08-15：**桌宠范围拍板**：暂只做应用内桌宠（M1-4）；悬浮窗桌宠（overlay-runtime/M0-5/M2-5）整体暂缓，用户明确要做前不动（AGENT.md 决策 10 + 12-roadmap + 02-architecture 同步）
 - 2026-08-15：**桌宠内容 100% AI 包化拍板**：宿主只做容器（M1-4 挂载点 + 默认包 + pet-layer 最小加载提前）；桌宠形象/动画/行为/素材全部走 AI 生成的 pet-layer 包（03-package-system 执行引擎表、12-roadmap M1-4/M2-5 同步）
  - 2026-08-16 ✅ **M0-4 白屏修复完成**（真机全链路验证）：①Koin 崩溃——`single<AgentChatSource?> { null }` 的 null value 在 SingleInstanceFactory.getValue 直接抛 IllegalStateException → 删占位注册改 `getOrNull()`；②DailyJsBridge 补齐桌面 postMessage 直连方法 apps.list/apps.open/system.navigate（PWA runtime.ts handleDesktopRequest 镜像；未实现方法明确 respond(false) 不伪造），DailyApp 宿主回调联动（daily.ai→Chat Tab、system.store→Store Tab、普通 App→替换运行页；navigate 同理）；③WebView 视口 0 高白屏——AndroidView factory 时机 View 未 attach/测量，loadDataWithBaseURL 以 vh=0 布局后不 relayout → createWebView 显式 MATCH_PARENT layoutParams + `wv.post { loadApp }` 延迟到首次布局后；④AppRunScreen statusBarsPadding 修顶栏与状态栏重叠；⑤WebosApi.listApps 按 id 去重（bootstrap 返回 BUILTIN_APPS + 用户 state.apps 双份 system.*）。AppSummary 补 source/installed 字段。诊断手段沉淀：pageState 自检 JSON（vw/vh/bg/pages/pgH）+ bridge req/resp 日志 + AppRuntime tag。**注意：构建脚本超时后远端 gradle 会继续跑，重试前先 `pkill -9 -f gradle` 清残留（勿用含"gradle"字样的命令名自匹配）**；服务器后台构建模板：nohup + /tmp/build.log + build.done 标记 + 轮询
  - 2026-08-16：**UI 方向拍板（D18）+ 方案 A 选定**：沉浸式启动器（去 Tab 栏/顶栏、edge-to-edge）、桌面多页/边缘翻页/叠放建文件夹、对话页⇄桌面横滑（方案 A：对话页最左）；10-ui-design §0/§2 重写、README D18、12-roadmap M1-1/M1-4 验收同步。
  - 2026-08-16：**文档基建完成（弱 AI 可执行化）**：新建 16-execution-playbook.md（构建 SOP/真机调试 SOP/协议速查/坑索引——M0-4 会话全部实操知识沉淀）+ 17-m1-task-cards.md（M1 Lite 五卡：M1-1 沉浸骨架 / M1-2 端侧 AI / M1-3 App 管理 / M1-4 启动器 / M1-5 权限，含验收/文件/步骤/坑/📐需用户定点）；AGENT.md 立「文档与变更纪律」（当天记 CHANGELOG、坑进 16、状态进 14、任务按 17 卡执行）；README §3 地图加 16/17。
  - 下一步：**M1 Lite 开工，按 17-m1-task-cards 逐卡执行**（首卡 M1-1 沉浸式宿主骨架）；卡内 📐 标记点按 UI 红线问用户

## 6. 相关文档索引

- 总索引/决策：`docs/android/README.md`（D1–D17，含 D15 端侧 AI / D16 sub-agent 包化 / D17 AI 开发包）
- 工具链与云构建：`docs/android/13-dev-toolchain.md`
- 路线图：`docs/android/12-roadmap.md`（M0-1 完成定义 §11）
- 工程结构：`docs/android/02-architecture.md`
