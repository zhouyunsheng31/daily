# Daily webOS

<p align="center">
  <strong>移动端优先 · AI-Native 的网页操作系统 (webOS)</strong>
</p>

<p align="center">
  <a href="#核心产品形态">产品形态</a> •
  <a href="#双端同构架构">双端同构</a> •
  <a href="#一切皆包--组合式包体系">包体系</a> •
  <a href="#服务即包--app-api-体系">App API</a> •
  <a href="#快速启动">快速启动</a> •
  <a href="#文档导航">文档导航</a>
</p>

---

## 🌟 核心产品形态

Daily 是一个面向下一代个人计算的**移动端优先、AI-Native 网页操作系统（webOS）**。

* 🤖 **AI 助手即系统主页**：首次打开系统自动进入游客身份并直达 AI 对话，以简洁、灵动的交互承载系统的全部能力。
* 📱 **HTML App / 模板同构**：系统中的 App、桌面、对话页均以版本化 HTML 为形态，在沙箱 WebView / iframe 中沉浸运行，Web PWA 与 Android 客户端消费同一套模板。
* 📦 **一切皆包 · 组合式包**：`app / api / skill / theme / toolpkg / subagent / bundle` 等 13 种类型统一流水线；支持不可变版本快照与一键原子回滚。
* ⚡ **服务即包（App API 体系）**：`App = UI + 数据 + API`。通过声明式 `api.json` 与受限 Node vm handler（5s 超时、64KB 截断、域名白名单、无常驻进程），实现安全代跑与托管 secrets，提供 owner 级及 public 跨应用数据互通管道。
* 📂 **虚拟文件工作区**：按用户隔离的工作区环境，AI 通过 `agent_fs_*` 工具读写与创建 App/包（「文件夹即包」）。
* 🛒 **统一包市场**：万物皆可包，统一在市场内按 type 浏览、安装、升级与闭包依赖解析。

---

## 🏛 双端同构架构

Daily 采用双端同构模式推进：**Web 端 (PWA) + Android 端 (高性能沉浸客户端)**。

| 维度 | Web 端 (PWA / 浏览器) | Android 移动端客户端 |
|---|---|---|
| **UI 表现** | HTML 模板（React Shell / iframe） | **同构消费 Web HTML 模板**（WebView 全沉浸，零双端分裂） |
| **核心优势** | 打开即用、免安装、跨设备快速触达 | **本地持久化、无浏览器栏全屏沉浸、手势丝滑、冷启动极快** |
| **AI 对话** | 服务端标准模型统一驱动 | **服务端标准模型统一提供**（保证一致性与稳定性） |
| **包与数据** | 服务端权威存储 | 本地缓存 + 服务端增量同步 |
| **API 执行** | 服务端受限 vm 沙箱代跑 | 服务端受限 vm 沙箱代跑（移动端直接发布与调用） |
| **权限边界** | 纯 Web 安全沙箱 | 应用内受限环境（不依赖 Shizuku、无障碍或全局悬浮窗等外部系统权限） |

---

## 📦 一切皆包 · 组合式包体系

Daily 包规范（`daily.pkg.json v2`）定义了一套全栈能力封装协议：

```jsonc
{
  "schema_version": 2,
  "id": "com.developer.my-app",
  "type": "app", // app | api | skill | theme | toolpkg | mcp | workflow | bundle 等 13 种类型
  "version": "1.0.0",
  "entry": "index.html",
  "display_name": { "zh": "我的应用", "en": "My App" },
  "description": { "zh": "应用详细描述" },
  "capabilities": ["app.storage.private"],
  "network": { "domains": ["api.example.com"] },
  "dependencies": [{ "id": "com.daily.currency-api", "range": "^1.0.0" }],
  "contents": {
    "skills": ["skills/guide/SKILL.md"],
    "assets": ["assets/icon.png"]
  }
}
```

---

## ⚡ 服务即包 · App API 体系

App 不仅有界面，还自带可供 AI 和外部系统调用的能力：

```
AI 在工作区创建 App 与 api.json + handlers
  ├── 自动注册 AI 会话工具（pi Agent 零幻觉调用）
  ├── 自动生成 REST 端点（POST /webos/api/appapi/:namespace/:endpoint）
  └── 一键发布到市场（供全网其他用户与 App 跨应用调用）
```

**受限 Handler 编程模型** (`handlers/calc.js`)：
```javascript
async function main(ctx) {
  // ctx 注入：params, storage, http (白名单 fetch), secrets (脱敏), userKey
  const { amount, from, to } = ctx.params
  const rate = await ctx.storage.get(`rate_${from}_${to}`)
  return { result: amount * rate }
}
```

---

## 🛠 技术栈

### 前端 (Web Shell & Client)
* **Core**：React 19 + TypeScript + Vite 8
* **Styling**：Tailwind CSS v4 + Lucide Icons
* **State**：Zustand 5
* **Runtime**：沙箱 iframe / WebView 容器 + `window.daily` 宿主桥接 SDK

### 后端 (webOS Engine)
* **Framework**：Node.js + Express 5 + TypeScript
* **Database**：SQLite（`better-sqlite3`，具备 WAL 高并发支持）
* **AI Agent**：`@earendil-works/pi-coding-agent` + `@earendil-works/pi-ai`
* **Sandbox**：Node.js 内置 `vm` 隔离沙箱 + 域名白名单与 SSRF 防护
* **Auth & Billing**：JWT 双端鉴权 + 邮箱验证码 + 爱发电（Afdian）订单自动履约

---

## 🚀 快速启动

### 1. 环境准备
* **Node.js**：`>= 20.0.0`
* **包管理器**：`npm` / `pnpm`

### 2. 安装依赖与启动

```bash
# 1. 安装根目录与服务端依赖
npm install
cd server && npm install && cd ..

# 2. 启动开发服务器（前后端联动）
# Windows 环境
.\dev.bat

# Linux / macOS 环境
npm run dev &
cd server && npm run dev
```

* **Web Shell 前端**：`http://localhost:5173`
* **webOS 后端服务**：`http://localhost:3456`

---

## 📚 文档导航

* 📖 **[API 权威参考手册 (api-reference.md)](docs/api-reference.md)**：包含全量端点规格、参数结构、错误码与 SDK 开发手册。
* 📐 **[webOS 架构与路线设计 (routes/web/README.md)](docs/routes/web/README.md)**：深入理解双端同构与 webOS 演进。
* 📦 **[包体系与市场规范 (routes/web/10-package-market-guide.md)](docs/routes/web/10-package-market-guide.md)**：13 种包类型与 Manifest v2 权威指南。
* 🔌 **[App API 管道设计 (routes/web/04-app-api.md)](docs/routes/web/04-app-api.md)**：handler 沙箱模型、secrets 托管与 public 管道。
* 📋 **[Agent 协作与工作规范 (AGENT.md)](AGENT.md)**：版本感知、协作纪律与管理端三件套使用规范。

---

## 📄 许可证与版权

Copyright © 2026 Daily webOS Team. All rights reserved.