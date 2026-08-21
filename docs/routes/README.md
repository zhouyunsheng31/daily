# Daily 双路线总纲 · 统一收尾文档（Web 主场 + 移动端沉浸同构）

> 版本：v2（2026-08-21 用户拍板精简定稿）
> 定位：本文是 Daily 开发的**最高执行纲领**。

---

## 1. 核心定位

Daily 是一个 **AI-native webOS**：AI 助手即系统主页，对话生成/修改 HTML App，一切皆包，服务即包（App API 体系），统一包市场，虚拟文件工作区，积分计费。

双端分工：
- **Web 路线（主场）**：纯 Web PWA（`client/shell-web`）+ 服务端（`server/`）。承载核心功能首发：完整包体系、App API（owner + public 管道）、统一包市场、受限 vm 服务执行、计费与文件工作区。
- **移动端路线（沉浸同构）**：Android 原生壳（`client/android`）。直接消费 Web 端的 HTML 对话页与系统 App 模板，核心价值在于**本地持久化、无浏览器栏全沉浸、丝滑手势与更优的冷启动性能**。

---

## 2. 最高拍板决策清单（R 系列）

| # | 决策 | 说明 |
|---|---|---|
| R1 | **双端纯同构消费** | 移动端不搞原生 Compose 对话页，双端直接消费相同的 Web HTML 模板与 SDK 桥，零分裂 |
| R2 | **服务即包（API 体系）** | App = UI + 数据 + API。支持受限 vm 沙箱执行（5s 超时、64KB 截断、域名白名单、无常驻进程），移动端与 Web 端均可发布 API 包到服务端 |
| R3 | **标准模型统一提供** | AI 对话走平台服务端标准模型（DeepSeek V4 Flash 等），暂不开放端侧独立接 Key |
| R4 | **彻底废弃外部系统特权** | 移动端不引入、不依赖 Shizuku / 无障碍 / 系统全局悬浮窗等能力，保持纯应用内沙箱 |
| R5 | **不开终端/任意进程** | 不开放任意 Linux 终端或虚拟服务器；App 自动执行一律走受限 handler |
| R6 | **技能全部包化（R15）** | 废弃独立外挂 skill 目录，技能与提示词直接装入包内的 `contents.skills`，随包分发与调用 |
| R7 | **万物皆可包（R14）** | app / api / skill / theme / toolpkg / bundle 全在统一包市场内管理，API 也是一种包 |
| R8 | **单一契约脊梁** | `shared/webos-contracts` 作为跨端契约单一事实源，双端保持一致 |

---

## 3. 共享脊梁（单一事实源）

| 域 | 资产位置 | 说明 |
|---|---|---|
| 服务端 | `server/` | Express + pi；新端点进 `server/src/webos/` |
| 契约 | `shared/webos-contracts/` | 跨端契约类型单一事实源 |
| 模板 | `server/src/webosDesktopV1.ts` / `webosStoreV1.ts` 等 | Web 端开发，移动端同构消费 |
| 包市场 | `server/src/webos/market/` | 统一包市场服务端与消费端 |
| 工作区 | `data/workspace/webos/<userKey>/` | 虚拟文件系统与包目录 |
