# Daily 安卓端 APK

Daily webOS 的安卓客户端安装包（Jetpack Compose + Gradle 构建，AGP 9.0.0）。

## 文件

| 文件 | 说明 |
|---|---|
| `daily-android.apk` | 签名安装包，直接安装（约 23.6 MB） |

## 校验

```bash
sha256sum android/daily-android.apk
# 0312045c3c45c8fa60e5ab321c23f1379599bc04fae3d67b10f036f0e07b9de0
```

## 安装

- 手机开启「允许安装未知来源应用」后直接安装；
- 首次启动引导流程 → 进入主页。

## 说明

- 原始文件来自生产工作区 `home/uploads/7_base.apk`（2026-08-24 收录）；
- 安卓原生端完整规划见 `docs/roadmap_mobile_v1.md`，代码目录 `client/android/`（规划中，暂为占位）。