# 13 · 仅手机开发：工具链、云构建与脚手架（动手前第一件事）

> **唯一开发机就是当前这台 Android 手机。没有 Windows/macOS/Linux PC，也没有 Android Studio。**
> 当前仓库位于 Operit 应用工作区：
> `/data/user/0/com.ai.assistance.operit/files/workspace/daily/daily`
> （工具操作必须遵守根 AGENT.md 的 `environment="android"` + 绝对路径规则。）
>
> 本文是 M0-1 的完整执行说明。主路径锁定为：
> **Operit/手机编辑代码 → GitHub Actions 云端编译与测试 → 手机下载 APK → 本机安装 → Shizuku/系统 logcat 真机调试。**
> 本地 ARM64 构建仅作可选加速，不是开工前置条件。

## 1. 当前环境实测基线（2026-08-15）

在 Operit 的 Ubuntu/proot 终端实测：

| 项目 | 实测值 | 结论 |
|---|---|---|
| 内核/架构 | Android 12 内核，`aarch64` | 只能执行 ARM64 原生二进制（除非额外模拟 x86） |
| Ubuntu 环境 | Ubuntu 24.04 风格 proot，`HOME=/root` | 可运行 Node/Git/脚本，工作区已直接挂载 |
| Node | v24.18.0 | 现有服务端/脚本可执行 |
| Java/JDK | **未安装** | 本地 Gradle 当前不可运行 |
| Gradle | **未安装** | 不把本地构建设为前置 |
| Android SDK / sdkmanager / adb | **均未安装** | 不使用 Android Studio/模拟器/adb 工作流 |
| 存储 | 总 220GB，约 **24GB 可用（90% 已用）** | 禁止下载模拟器镜像；缓存须定期清理 |
| 内存 | 7.2GB（当时可用约 2.4GB）+ 6GB swap | 能编辑/跑轻量测试；本地大型 Gradle 构建可能抖动/被杀 |

> 任何后续 AI **禁止假设有 PC、Android Studio、adb 或 x86_64 Linux**。若环境改变，先重新执行：`uname -a; uname -m; java -version; gradle -v; df -h; free -h`，再更新本节。

## 2. 为什么主路径采用 GitHub Actions 云构建

官方 Android SDK 的 Linux Build Tools（尤其 AGP 自动获取的 `aapt2`）通常面向 **x86_64 Linux**。当前终端是 ARM64 proot：
- Java/Gradle 本身可装 ARM64 版，但 AGP 调 `aapt2` 时可能出现 `Exec format error`；
- Ubuntu 仓库里的 ARM64 `aapt`/build-tools 版本老（可见 28/29 时代），不应支撑 compileSdk 35 + 新 Compose；
- AndroidIDE 曾提供 ARM64 构建环境，但项目已于 2024-10 归档，不作为长期生产工具链；
- 模拟器在手机上既不现实，也无法代表 overlay/无障碍/Shizuku 性能。

因此：**云端 x86_64 runner 是权威构建环境，当前手机是真机测试环境**。这反而比"一台低配 PC + 模拟器"更贴合本项目的悬浮窗/权限/性能需求。

## 3. 手机上已有/需要使用的工具

### 3.1 已有（通过 Operit）

- 工作区文件工具：读取/写入/搜索/编辑仓库；路径规则见根 AGENT.md。
- Ubuntu 终端（super_admin/terminal 或同等终端能力）：Node/Git/脚本、下载构建产物、校验 APK。
- Android 系统 Shell（Shizuku/Root）：执行 `pm`、`am`、`logcat`、`dumpsys`，用于安装和诊断。
- GitHub API/工具包：建分支、提交精确文件、查看 Actions、下载 Artifact（若工具包不可用，再走网页/API）。
- 系统安装能力：可通过 APK 文件的系统安装器，或 Shizuku `pm install -r` 安装。

### 3.2 不需要安装

- Android Studio（手机无法使用桌面 IDE）
- Android Emulator / HAXM / KVM 镜像
- adb（测试目标就是当前设备，不需要再从宿主连自己）
- 本地 NDK（M1 无 JNI；proot/QuickJS/Filament 在 M2/M3 引入时单独设计云构建）

## 4. 脚手架创建方式：**直接写 Gradle 工程，不用 Android Studio Wizard**

工程根：`client/android/`。所有文件由 AI/编辑工具创建，第一版至少包含：

```
client/android/
├── settings.gradle.kts
├── build.gradle.kts
├── gradle.properties
├── gradle/libs.versions.toml
├── gradlew / gradlew.bat / gradle/wrapper/{gradle-wrapper.jar,gradle-wrapper.properties}
├── app/                 # com.android.application：Compose 空壳 + 四 Tab
├── core/                # Android Library：DTO/网络/SSE
├── app-runtime/         # Android Library
├── overlay-runtime/     # Android Library
├── capability/          # Android Library
├── packages/            # Android Library
├── sync/                # Android Library
├── baselineprofile/     # Baseline Profile Generator（M0 先建骨架，真机执行）
└── macrobenchmark/      # 性能测试 APK
```

### 4.1 固定配置

| 项 | 值 |
|---|---|
| applicationId / namespace | **`xyz.shadowshub.daily`**（已拍板，不得更改） |
| minSdk | 26（Android 8.0） |
| compileSdk / targetSdk | 35 |
| ABI | `arm64-v8a`（M1 无 native 库时 ABI filter 可暂不生效；引 native 后强制） |
| Java toolchain | 17 |
| 构建语言 | Gradle Kotlin DSL |
| 依赖管理 | Version Catalog 单一入口 |
| API 基址 | `BuildConfig.API_BASE_URL`，默认 `https://shadowshub.xyz`，禁止散落硬编码 |

### 4.2 模块依赖方向（单向，禁止环）

`app → {app-runtime, overlay-runtime, capability, packages, sync} → core`

### 4.3 版本策略（以创建时 Maven 可解析的稳定版本为准）

云构建第一轮先锁定以下基线；若某坐标不存在，**只在 Version Catalog 调整**，文档与 lockfile 同步更新：
- AGP 8.7+、Gradle Wrapper 8.9+、Kotlin 2.x、JDK17
- Compose BOM 2025 稳定版、Material3、Navigation Compose
- Koin 4.x、OkHttp 4.12（优先稳定版；SSE 用 okhttp-sse，**不优先选 alpha 版 OkHttp 5**）
- kotlinx.serialization、Room + KSP、DataStore、AndroidX WebKit、WorkManager、Coil 3
- Detekt、Macrobenchmark、Baseline Profile

> 上一版文档给了具体版本示例，但在没有本地 SDK、且时间为 2026 的情况下可能过期。**实际脚手架必须让 Maven/Gradle 云构建验证版本存在后锁定**，禁止照抄不可解析版本。

## 5. Gradle Wrapper 怎么获得（手机无 Gradle）

优先方案：
1. 创建 `gradle-wrapper.properties`（指定官方 Gradle distribution URL 与 SHA256）；
2. 从 Gradle 官方发行包/可信现有模板取得对应 `gradle-wrapper.jar`（下载后校验 SHA256）；
3. 把 `gradlew` 设为可执行（Git mode 100755；GitHub API 提交时关注 mode）；
4. 云端跑 `./gradlew --version` 验证。

备选方案：创建一次性 GitHub Actions bootstrap job，在 runner 上执行 `gradle wrapper --gradle-version <锁定版本>`，将生成物作为 Artifact；下载回工作区后精确提交。**CI 不得自动把生成物 push 到主分支**。

## 6. GitHub Actions：权威构建环境

`.github/workflows/android.yml` 必须在 M0-1 第一批提交中建立：

```yaml
name: android
on:
  pull_request:
    paths: ['client/android/**', '.github/workflows/android.yml']
  push:
    branches: [main]
    paths: ['client/android/**', '.github/workflows/android.yml']
  workflow_dispatch:

jobs:
  build:
    runs-on: ubuntu-latest
    timeout-minutes: 30
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-java@v4
        with:
          distribution: temurin
          java-version: '17'
      - uses: gradle/actions/setup-gradle@v4
      - run: chmod +x gradlew
        working-directory: client/android
      - run: ./gradlew --no-daemon :app:assembleDebug :app:lintDebug detekt testDebugUnitTest
        working-directory: client/android
      - uses: actions/upload-artifact@v4
        with:
          name: daily-debug-apk
          path: client/android/app/build/outputs/apk/debug/*.apk
          if-no-files-found: error
```

CI 还必须：
- Gradle 依赖缓存交给 `setup-gradle`；不提交 `.gradle/`。
- 构建失败时，AI 读取**完整 Actions 日志**定位，禁止本地猜版本。
- PR 保护：Android workflow 必须绿才能合并。
- 每次 Artifact 保留至少 7 天，方便手机真机回归。

## 7. 手机端闭环：下载 → 安装 → 日志 → 截图/性能

### 7.1 下载 APK

三选一：
1. GitHub 工具/API 直接下载 Actions Artifact 到 `/sdcard/Download/daily-debug.apk`；
2. 手机浏览器打开 Actions → Artifact 下载 → 解压到 Download；
3. Release/临时私有下载链接（M1 发布阶段）。

下载后校验：`sha256sum /sdcard/Download/daily-debug.apk`，把哈希记录到对应测试报告。

### 7.2 安装

- 普通方式：用系统文件管理器点 APK → 允许来源安装；
- Shizuku/Root 方式（开发推荐）：Android 系统 shell 执行 `pm install -r -t /sdcard/Download/daily-debug.apk`；若因安装路径权限失败，先复制到可读临时路径或使用系统安装工具。
- 启动：`am start -n xyz.shadowshub.daily/.MainActivity`。

### 7.3 调试日志（不用 adb）

通过 Shizuku/Root 的 Android shell：

```sh
# 清日志 → 启动 → 过滤当前应用
logcat -c
am force-stop xyz.shadowshub.daily
am start -n xyz.shadowshub.daily/.MainActivity
logcat --pid=$(pidof xyz.shadowshub.daily) -v threadtime

# 崩溃/ANR/系统状态
logcat -b crash -d
logcat -d | grep -E 'AndroidRuntime|ANR|xyz.shadowshub.daily'
dumpsys meminfo xyz.shadowshub.daily
dumpsys gfxinfo xyz.shadowshub.daily framestats
```

- 日志保存到工作区 `tmp/android-tests/<日期-commit>/logcat.txt`，结论写进 `docs/android/perf-reports/` 或对应 bug 文档。
- **密钥/Authorization/Cookie 禁止打印**；OkHttp logging interceptor 只在 debug 且必须 redact `Authorization`/`Cookie`。

### 7.4 真机性能

- 启动/帧率：Macrobenchmark 测试 APK 与目标 debug/profileable APK 都由 CI 产出，在手机安装后通过 instrumentation 启动。若当前 shell 无 `am instrument` 权限，用 Shizuku shell 执行。
- 辅助：`dumpsys gfxinfo`、Perfetto（系统 trace）与 Android 开发者选项 GPU 渲染分析。
- **禁止用模拟器数据宣称性能达标**；11-performance §2 全部是真机指标。

## 8. 签名与发布（手机开发场景）

- debug：CI 默认 debug keystore，每次 runner 可能不同，升级安装可能签名不一致。解决：把**开发 debug keystore**作为 GitHub Actions Secret（base64）统一签名，绝不入库；初期签名变化时先卸载 debug 包（会丢端侧缓存，云数据不丢）。
- release：在当前手机的安全目录离线生成 `daily-release.jks`（可临时安装 ARM64 OpenJDK 17 取 `keytool`，生成后备份到用户私有加密存储）；CI 用 Secrets 注入签名。
- keystore 与密码绝不能进入仓库、对话、日志；只记录证书 SHA-256 指纹。
- 官网/F-Droid：F-Droid 构建需可复现；M1 发布前另写 reproducible build 校验，不用当前 debug 流程冒充发布流程。

## 9. 本地 ARM64 构建（可选，不阻塞）

仅在云构建往返严重拖慢时尝试，优先级低于 M0-2/M0-3：

### 方案 A：当前 Ubuntu/proot + ARM64 工具覆盖
- 可装 `openjdk-17-jdk-headless`；Gradle 必须用项目 wrapper，Ubuntu 的 Gradle 4.4 太旧，不可用。
- 关键障碍是 ARM64 `aapt2`。必须取得**可信、可校验的 ARM64 aapt2**，并设置 `android.aapt2FromMavenOverride=<路径>`；版本需与 AGP 兼容。
- 在成功构建前，禁止在文档宣称本地可用。

### 方案 B：AndroidIDE/Termux 独立环境
- AndroidIDE 能在 Android 上构建 Gradle 项目，但官方仓库已归档（2024-10），仅可作为临时工具，不作为架构依赖。
- Termux 社区可提供 ARM64 JDK/aapt2，但其工作区访问、版本兼容、签名链需单独验证。

**本地构建成功的定义**：同一 commit 在手机本地与 GitHub Actions 都能 assembleDebug，APK 行为一致；否则云端仍为权威。

## 10. 空间与资源纪律（这台手机只有约 24GB 可用）

- Gradle/Maven 缓存预算 ≤6GB；构建产物/Artifact ≤2GB；测试截图/视频 ≤2GB；至少保留 8GB 系统安全余量。
- 每个里程碑清理：`client/android/**/build/`、过期 APK、旧 Actions Artifact 下载包；**不得删工作区源码/密钥备份**。
- proot rootfs（约 200MB）与本地模型属于 App 运行时资源（M2/M3），不能和开发 SDK 缓存混在一起。

## 11. M0-1 完成定义（逐条验收）

- [ ] `client/android/` 多模块脚手架由文件方式创建，不依赖 Android Studio Wizard。
- [ ] GitHub Actions 在云端成功执行 `assembleDebug + lint + detekt + unit tests`，产出 APK Artifact。
- [ ] 手机下载 APK，SHA256 有记录，安装并启动显示 Compose 四 Tab 空壳。
- [ ] 使用 Shizuku/系统 shell 成功采集该包 logcat、meminfo、gfxinfo 并保存测试记录。
- [ ] Baseline Profile/Macrobenchmark 模块已建骨架；第一份真机冷启动基线报告归档。
- [ ] applicationId=`xyz.shadowshub.daily`、JDK17、minSdk26、target/compileSdk35、Version Catalog 已锁定。
- [ ] Git 历史中无 keystore、密码、token；`git check-ignore` 验证签名文件被忽略。
- [ ] README/AGENT.md 已记录：**唯一开发机为 Android 手机，云构建为权威，禁止假设有 PC/Android Studio/adb。**
