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

## 2026-08-24 v3（渲染对齐浏览器版，提交 `393ab15`）

修复（对应四个反馈：启动图拉伸 / 桌面壁纸不显示 / 文字图标按钮错位重叠 / 桌面排列错乱）：

1. **启动图拉伸**：原 `splash_window.png` 是手机 19.5:9 全幅图，平板窗口会被拉伸变形——改为纯色底 + 居中固定尺寸 logo（layer-list `bitmap gravity=center`），任何宽高比都不变形；
2. **WebView 渲染对齐 Chrome**（其余三个症状同源：WebView 默认渲染与浏览器不一致）：
   - `loadWithOverviewMode=false`：取消"概览整页缩放"，宽屏平板不再整体缩小导致元素互相覆盖、桌面排列错乱、壁纸位置错位；
   - `layoutAlgorithm=NORMAL`：关闭 WebView 默认 `TEXT_AUTOSIZING` 文本自动缩放（会打乱响应式布局的间距/换行）；
   - `textZoom=100`：归一系统字体缩放（平板"加大字体"设置不再导致错位）。
   - 页面自带 viewport meta，按 device-width 精确布局，与 Chrome 浏览器一致。

> 壁纸端点是免鉴权公开图片（`/webos/api/imagegen/file/...`），若不登录也能正常加载；如 v3 装后壁纸仍不显示，请告诉我具体是默认桌面还是你的自定义桌面，我再针对性处理。

## 说明

- 构建方式：`client/android` 源码 `./gradlew :app:assembleDebug`（debug 包，系统 debug 密钥签名，可安装）；
- 安卓原生端完整规划见 `docs/roadmap_mobile_v1.md`。