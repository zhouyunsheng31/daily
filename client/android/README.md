# Daily Android

Daily 的 Android 原生端（Shell：Kotlin + Jetpack Compose；App 运行时：WebView 沙箱；服务端 pi 内核不变）。

> 产品定位：「你的第二个桌面——更轻量，也更个性化。」

## 开发环境（重要）

**唯一开发机 = Android 手机**（无 PC / Android Studio / adb）。见 `docs/android/13-dev-toolchain.md`：

- **权威构建 = GitHub Actions**（`.github/workflows/android.yml`），产出 APK Artifact 供手机下载
- **本地 ARM64 构建 = 可选加速**：`./setup_android_env.sh` 一键装 JDK17/SDK/Gradle + ARM64 aapt2（见 `tools/aapt2/`）
- 真机调试：Shizuku/系统 shell 执行 `pm install` / `am start` / `logcat`（13 号文档 §7）

## 模块结构（02-architecture §3）

```
app/                Shell：Activity/导航/四大页面/主题/权限引导
core/               契约 DTO（kotlinx.serialization）、ApiClient、SSE 客户端、错误模型
app-runtime/        WebView 沙箱（预热池、WebMessagePort 桥、URL 白名单）
overlay-runtime/    悬浮窗/桌宠层（共享 overlay WebView 单 canvas）
capability/         权限能力层（Tier0 / Tier1 Shizuku）
packages/           包体系（app/pet-layer/api/skill/theme/...）
sync/               移动端双向同步
baselineprofile/    Baseline Profile 生成器（真机执行）
macrobenchmark/     性能测试 APK（真机执行）
```

依赖方向（单向）：`app → {app-runtime, overlay-runtime, capability, packages, sync} → core`

## 固定配置（13 号文档 §4.1，禁止更改）

| 项 | 值 |
|---|---|
| applicationId / namespace | `xyz.shadowshub.daily` |
| minSdk / targetSdk / compileSdk | 26 / 35 / 35 |
| Java toolchain | 17 |
| API 基址 | `BuildConfig.API_BASE_URL`（默认 https://shadowshub.xyz） |

## 常用命令

```bash
./gradlew :app:assembleDebug              # 构建 debug APK
./gradlew :app:lintDebug detekt testDebugUnitTest   # CI 全量检查
./gradlew :baselineprofile:connectedCheck  # 真机生成 Baseline Profile
./gradlew :macrobenchmark:connectedBenchmarkAndroidTest  # 真机冷启动基准
```

## 里程碑

M0 技术验证 → M1 Android MVP → M2 包体系与增强模式 → M3 生态。见 `docs/android/12-roadmap.md`。