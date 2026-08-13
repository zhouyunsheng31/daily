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

## 4.5 里程碑进度（2026-08-15 晚快照）

| 里程碑 | 状态 | 说明 |
|---|---|---|
| **M0-1 工程脚手架** | ✅ 完成 | 9 模块 + 四 Tab 空壳 + 服务器构建管线 + 真机安装运行验证；CI workflow 已写但 GitHub 不可达暂挂起 |
| **M0-2 对话链路** | ⏳ 下一步 | 游客鉴权 → bootstrap → chat/stream SSE 全事件渲染（含 thinking/tool chip/resume）；验收：真机 10 轮对话无事件丢失、断网 resume 正确 |
| M0-3 App Runtime 验证 | ⬜ 未开始 | ⚠️ 全方案最大不确定性：WebView 沙箱加载线上 App + WebMessagePort 桥 |
| M0-4 悬浮窗验证 | ⬜ 未开始 | 桌宠 overlay + 点击穿透 |
| M0-5 设计走查 | ⬜ 未开始 | 10-ui-design §1 tokens → Compose 主题（双主题截图评审） |
| M1-1 四大页面完整实现 | ⬜ 未开始 | 按 10 篇规格 + 10 §6 可用性清单 |

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
- 下一步：M0-2 对话链路（游客鉴权 + bootstrap + SSE 全事件渲染）

## 6. 相关文档索引

- 总索引/决策：`docs/android/README.md`（D1–D14）
- 工具链与云构建：`docs/android/13-dev-toolchain.md`
- 路线图：`docs/android/12-roadmap.md`（M0-1 完成定义 §11）
- 工程结构：`docs/android/02-architecture.md`
