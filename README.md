# Daily

> 以 pi agent 为核心的自由画布式个人生活管理面板 — 学习、工作、放松一体化。

## 项目目标

构建一个**可持久化、可自由布局**的个人生活管理画布：

- **pi agent 驱动**：AI 是用户与画布交互的主要方式，通过 pi（`@earendil-works/pi-coding-agent`）提供 agent 能力，模型用 step-3.7-flash
- **自由画布**：无限平移 / 缩放，组件自由拖拽 / 调整大小 / 锁定 / 图层管理
- **HTML Widget**：agent 可自由生成任意 HTML 页面摆放到画布上（sandbox iframe 渲染）
- **自动保存**：所有组件状态通过 IndexedDB（前端）+ SQLite（后端）双层持久化，关闭后可恢复
- **多面板管理**：支持创建多个面板，每个面板独立布局
- **6 个核心 AI 工具**：围绕 HTML widget 的增删改查 + 通用 storage 读写
- **自由画画 + 组件搭线**：SVG 笔迹层 + 可视化连线

## 技术栈

### 前端
- React 19 + TypeScript 6 + Vite 8
- Zustand 5（状态管理）
- Tailwind CSS v4
- IndexedDB（idb，组件级持久化）
- pdfjs-dist（PDF 渲染）
- katex（LaTeX 渲染）
- lucide-react（图标）

### 后端（pi 桥接服务）
- Node.js + Express 5 + TypeScript（`server/` 目录）
- better-sqlite3（`data/daily.db`）
- **pi agent**（`@earendil-works/pi-coding-agent` + `@earendil-works/pi-ai`）— 提供 agent 能力，模型 step-3.7-flash
- **WebSocket**（`ws`）— 前后端双向通信，转发 pi 事件流 + 工具调用
- 后端不直接读写存储，6 个工具全部通过 WS 转发前端执行（前端用 `adapter.ts` 的 `withFallback()` 访问数据）

## 架构说明

```
┌─────────────────────────────────────────────────────────────┐
│ 前端（React + IDB）                                          │
│  - 画布核心（Workspace / Minimap / StrokesLayer）            │
│  - 6 个保留 widget（PdfViewer/FocusTimer/Sudoku/...）        │
│  - HtmlCanvasWidget（agent 生成的 HTML，sandbox iframe）     │
│  - useAIStore（WS 客户端，订阅 pi 事件流驱动 UI）            │
│  - adapter.ts withFallback()（自动协调 IndexedDB / API）     │
└───────────────┬─────────────────────────────────────────────┘
                │ WebSocket（tool_call / tool_result / pi_event）
┌───────────────┴─────────────────────────────────────────────┐
│ 后端（Express + WS + pi）                                    │
│  - piBridge.ts：createAgentSession + 6 customTools           │
│  - ws.ts：WS 服务器，转发 pi 事件流到前端                     │
│  - Express HTTP API（panels/widgets/entities/...）           │
│  - SQLite（better-sqlite3）                                  │
└─────────────────────────────────────────────────────────────┘
```

**存储统一**：6 个工具全部通过 WS 转发前端执行，前端用 `adapter.ts` 的 `withFallback()` 访问数据（自动协调 IndexedDB/API），后端不直接读写存储——解决存储割裂。

## 6 个核心 AI 工具（pi defineTool）

| 工具 | 参数 | 执行位置 | 数据访问 |
|------|------|---------|---------|
| `create_html_widget` | html, x, y, width?, height?, title? | 前端（WS 回调） | 前端 IndexedDB（htmlWidgets 表） |
| `update_html_widget` | id, html?, width?, height? | 前端（WS 回调） | 前端 IndexedDB |
| `delete_html_widget` | id | 前端（WS 回调） | 前端 IndexedDB |
| `list_widgets` | 无 | 前端（WS 回调） | 前端 useAppStore 状态 |
| `storage_read` | key | 前端（WS 回调） | 前端 `adapter.ts` 的 `withFallback()` |
| `storage_write` | key, value | 前端（WS 回调） | 前端 `adapter.ts` 的 `withFallback()` |

## 组件清单（8 个）

精简改造后保留 6 个难重建 widget + 1 个 HtmlCanvasWidget + 1 个 AIAssistant：

| # | 类型 | 组件 | 说明 |
|---|------|------|------|
| 1 | `pdfViewer` | PDF 阅读器 | pdfjs-dist 渲染，独立技术含量 |
| 2 | `focusTimer` | 专注计时 | 番茄钟逻辑 |
| 3 | `sudoku` | 数独 | 数独生成与验证 |
| 4 | `musicPlayer` | 音乐播放器 | 音频解码与播放 |
| 5 | `calculator` | 计算器 | 表达式解析 |
| 6 | `latexQuiz` | LaTeX 出题器 | katex 渲染 |
| 7 | `htmlCanvas` | HTML 画布 | agent 生成的任意 HTML（sandbox iframe） |
| 8 | `aiAssistant` | AI 助手 | WS 客户端，订阅 pi 事件流 |

## 关键交互

- **左键拖动空白区域**：平移画布
- **Space + 拖动**：强制平移（即使在组件上）
- **中键拖动**：平移画布
- **滚轮**：以鼠标为中心缩放
- **左键拖动组件**：移动组件（标题栏为拖拽区）
- **拖动组件右下角**：调整大小
- **右键组件**：弹出上下文菜单（最小化 / 关闭 / 锁定 / 图层 / 样式）
- **左下角浮动球**：面板管理 / 模式切换
- **右下角 + 按钮**：添加组件（按分类分组，可搜索）
- **Delete / Backspace**：删除选中组件
- **Esc**：取消选择 / 退出编辑 / 退出模式
- **模式切换**：select / draw / connect / pan（默认 select）

## 启动方式

### 一键启动（推荐）

```powershell
# 双击或在终端执行（启动后端 + 前端）
.\start.bat
```

`start.bat` 会自动：
1. 启动后端服务（`server/` 下的 `npx tsx src/index.ts`）
2. 启动前端 dev server（`npm run dev`）

### 手动启动

```powershell
# 1. 后端（pi 桥接服务，必须启动才能使用 AI 助手）
cd F:\allmylife\event\server
npx tsx src/index.ts

# 2. 前端
cd F:\allmylife\event
npm run dev
```

前端默认地址：`http://localhost:5173`
后端默认地址：`http://localhost:3001`（HTTP + WS 共存）

**pi 前置条件**：
- git-bash 路径：`C:\Program Files\Git\bin\bash.exe`（pi 在 Windows 需要 bash，禁止用 WSL bash）
- pi 依赖：`@earendil-works/pi-coding-agent` + `@earendil-works/pi-ai`（已装在 `server/`）
- 模型：step-3.7-flash（custom provider 直连 api.stepfun.com）

## 开发命令

```bash
# 类型检查（前端）
npx tsc -p tsconfig.app.json --noEmit

# 构建（前端）
npm run build

# Lint
npm run lint

# 后端类型检查（在 server/ 目录）
cd server && npx tsc --noEmit
```

## 项目结构

```
event/
├── src/
│   ├── api/                 # 后端 API 抽象层（adapter.ts 的 withFallback 支持 IndexedDB 回退）
│   ├── components/
│   │   ├── widgets/         # 8 个组件（PdfViewer/FocusTimer/Sudoku/MusicPlayer/Calculator/LatexQuiz/HtmlCanvasWidget/AIAssistant）
│   │   ├── Workspace.tsx    # 画布（平移 / 缩放 / 组件渲染 / 多面板）
│   │   ├── WidgetContainer.tsx
│   │   ├── UnifiedToolbar.tsx
│   │   ├── Minimap.tsx
│   │   ├── FloatingOrb.tsx
│   │   ├── AddWidgetMenu.tsx
│   │   ├── SettingsPanel.tsx
│   │   └── ...
│   ├── hooks/               # useDraggable, useResizable
│   ├── registry/            # widgetDefinitions, builtIn
│   ├── stores/              # Zustand stores（useAppStore、useAIStore）
│   ├── types/               # TypeScript 类型
│   └── utils/
│       ├── db.ts / dbV2.ts  # IndexedDB 封装
│       ├── dbStores/        # 各类实体数据 store（含 htmlWidgets、kvStorage）
│       ├── wsToolHandlers.ts # WS 工具回调（6 个工具的前端实现）
│       └── ...
├── server/                  # Node.js 后端（pi 桥接服务）
│   └── src/
│       ├── index.ts         # Express HTTP + WS 服务入口
│       ├── piBridge.ts      # pi agent session + 6 customTools
│       ├── ws.ts            # WebSocket 服务器
│       ├── routes/          # REST API（panels/widgets/entities/...）
│       └── db/              # SQLite schema + connection
├── public/                  # 静态资源
├── data/                    # SQLite 数据库文件（.gitignore）
├── docs/
│   ├── roadmap_v3.md        # 路线图 v3（当前执行）
│   ├── specs/               # 子系统设计文档（event-simplification-v3.md 等）
│   ├── mobile/              # 移动端设计（远期）
│   └── superpowers/         # 设计稿与测试集
└── ...
```

## 相关文档

| 文档 | 用途 |
|------|------|
| [AGENT.md](AGENT.md) | Agent 工作规范（Git 流程、危险操作禁令、排查经验、pi 集成） |
| [docs/roadmap_v3.md](docs/roadmap_v3.md) | **当前执行路线图**（AI 为主方向） |
| [docs/specs/event-simplification-v3.md](docs/specs/event-simplification-v3.md) | 精简改造方案 v3（pi agent + 无限画布） |
| [docs/01-首次启动与初始配置.md](docs/01-首次启动与初始配置.md) | 用户手册第 1 章 |
| [docs/02-学考学习场景.md](docs/02-学考学习场景.md) | 用户手册第 2 章 |
| [docs/03-生活管理场景.md](docs/03-生活管理场景.md) | 用户手册第 3 章 |
| [docs/04-日常休闲场景.md](docs/04-日常休闲场景.md) | 用户手册第 4 章 |
| [docs/05-每日日常操作流程.md](docs/05-每日日常操作流程.md) | 用户手册第 5 章 |

## 设计原则（摘自 roadmap_v3）

1. **AI 为主** — AI 是用户与画布交互的主要方式，不是附属功能
2. **自由画布是承载** — 任何新增功能不得破坏自由拖拽 / 无限平移缩放的核心体验
3. **组件即岛屿** — 每个组件是独立的功能单元，不依赖其他组件即可运行
4. **AI 是增强而非替代** — 写操作需经用户确认
5. **本地优先** — 所有数据存本地
6. **渐进式复杂度** — 新用户看到简洁画布，高级功能按需解锁
7. **不喧宾夺主** — 新功能都是画布上的可选工具，不改变画布本身的工作方式
8. **一致性** — 所有组件遵循统一的注册协议、状态管理、AI 可读写接口
9. **数据先行** — 核心个人数据必须先于或与 AI 同步建立

## 不做的事

- 不引入云同步
- 不引入用户认证
- 不引入路由
- 不做社交功能
- 不引入重型图表库
- 不做通用 EventBus
- 不允许 AI 默认删除组件或写入组件 state
- 不提前建未使用的 IndexedDB store

## 许可

个人项目，不对外发布。
