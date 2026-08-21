# 17 · Android M1 任务执行卡（同构沉浸客户端）

> 版本：v2（2026-08-21 简化定稿）
> 定位：执行 AI 必读。移动端直接消费 Web HTML 模板（对话页、桌面、商店），宿主纯 Compose 沉浸式 WebView 容器。

---

## 任务进度概览

| 卡 | 任务 | 状态 | 目标 |
|---|---|---|---|
| **M1-1** | 沉浸式 WebView 宿主骨架 | ✅ 完成 | 全屏沉浸、edge-to-edge、系统手势返回、状态栏透明 |
| **M1-2** | 系统模板消费与 JSBridge 完备 | ✅ 完成 | 直接加载 Web 端对话页与桌面模板，打通全部 SDK 桥接 |
| **M1-3** | App 管理与版本切换 | ✅ 完成 | 打开 App、版本时间线回滚、删除同步 |
| **M1-4** | 本地包缓存与文件同步 | ✅ 完成 | 对接本地静态资源磁盘缓存（WebResourceCacheHelper）与 `/webos/api/files/*` |
| **M1-5** | 性能与启动优化 | ✅ 完成 | 启动冷热过渡优化、LoadingView 品牌无白屏、APK 23MB 达标 |

---

## 卡 M1-2：系统模板消费与 JSBridge 完备（当前任务）

**目标**：移动端无需任何原生 Compose 对话页，直接通过 `AppRuntimeHost` 加载 Web 端系统对话页模板（`daily.ai`）与桌面模板（`system.desktop`）。

**验收标准**：
- [ ] 启动后直接渲染 Web 端对话页/桌面模板（纯 HTML/CSS，视觉与 Web 完全一致）；
- [ ] 对话流式收发正常（通过服务端 `/webos/api/chat/stream`，支持思考折叠与工具 Chip）；
- [ ] 点击图标正常打开 App 覆盖层，返回键/手势正常退出回到桌面；
- [ ] JSBridge（`apps.list/open`、`storage.get/set`、`system.navigate`）全链路畅通。

**涉及文件**：
- `client/android/app-runtime/.../AppRuntimeHost.kt`
- `client/android/app-runtime/.../DailyJsBridge.kt`
- `client/android/app/.../ui/DailyApp.kt`

---

## 卡 M1-3：App 管理与版本切换

**目标**：在 App 运行页或长按图标呼出版本历史，支持一键回滚与删除。

**验收标准**：
- [ ] 调 `/webos/api/apps/:appId/rollback` 成功切回旧版本并刷新运行页；
- [ ] 删除 App 成功移入 `.trash/`，桌面实时刷新（`apps_changed`）。

---

## 卡 M1-4：本地包缓存与文件同步

**目标**：对接 Web 端已交付的 File Service（`server/src/webos/files/`），实现已安装包与工作区文件的本地缓存。

**验收标准**：
- [ ] 断网情况下已打开过的 App 秒开；
- [ ] 联网时自动拉取最新 manifest 进行增量同步。

---

## 卡 M1-5：性能与启动优化

**目标**：冷启动到首屏可用 < 1s，真机 60/120fps。

**验收标准**：
- [ ] WebView 预热池调度合理（首帧渲染后预热 1 个空白实例）；
- [ ] 进程 RSS ≤ 150MB。