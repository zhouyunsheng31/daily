# Daily 安卓端 APK

Daily webOS 的安卓客户端安装包（Jetpack Compose + Gradle 构建，AGP 9.0.0）。

## 文件

| 文件 | 说明 |
|---|---|
| `daily-android.apk` | 安装包，直接安装（约 23.7 MB） |

## 校验

```bash
sha256sum android/daily-android.apk
# dbef08bfb7ec5c5c9d48bc89df642a4066cdee815b49ffb37f1a88fa7d9e68f8
```

## 安装

- 手机开启「允许安装未知来源应用」后直接安装；
- 首次启动引导流程 → 进入主页。

## 2026-08-24 v2（平板修复版）

修复内容（对应提交 `dfc203a`）：

1. **桌面板块不能正常显示**：桌面 V2 模板的 HTML 转义写错（`'"': """`）导致整个桌面脚本解析失败（`SyntaxError: Unexpected string`），图标/程序坞/返回钩子全部不渲染——已改为 `'"': "&quot;"`；
2. **返回键回退不了/卡死**：Web 壳顶层实现 `window.__dailySystemBack`（关浮层 → 子视图回退 → 桌面回 AI → 顶层退出），Android 壳返回键改为「Web 消费制」，不再走 WebView 历史回退；
3. **进入应用卡死一段时间**：`onPageCommitVisible` 首帧可见即撤下加载层（慢网不再长时间停在加载页）；`configChanges` 让平板旋转不再整页重载。

## 说明

- 构建方式：`client/android` 源码 `./gradlew :app:assembleDebug`（debug 包，系统 debug 密钥签名，可安装）；
- 安卓原生端完整规划见 `docs/roadmap_mobile_v1.md`。