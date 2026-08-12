# Daily 开发者指南

> 适用版本：Daily Web Phase 6+
> 配套文档：[component-spec.md](component-spec.md) · [api-reference.md](api-reference.md) · [deployment-guide.md](deployment-guide.md) · [end-to-end-workflow.md](end-to-end-workflow.md)

Daily 是一个以 AI Agent 为驱动、以自由画布为交互核心的个人/社区生活管理面板。本文档面向想在 Daily 上开发组件、搭建自己社区或二次开发的开发者。

---

## 1. 项目介绍

### 1.1 定位

- **画布 + AI Agent**：Daily 的核心是一块无限画布，用户通过 AI 对话生成/摆放 HTML 组件
- **前端交互层**：Daily 只负责前端展示与交互，用户自己的服务跑在用户自己的服务器上
- **联邦式社区**：每个 Daily 部署 = 一个独立社区实例，各实例独立用户系统，Daily 作为客户端聚合展示

### 1.2 核心特性

- 自由画布（平移、缩放、拖拽、调整大小）
- 两类组件：iframe widget（矩形）+ 自由 HTML 组件（任意形状）
- AI Agent 通过 6 个核心工具操作画布
- 多用户系统（注册/登录/角色 admin/member）
- 面板多建（个人面板 + 社区面板）
- 联邦式社区（聚合多个 Daily 实例）
- 组件导入（手动上传 + API 上传）

### 1.3 技术栈

| 层 | 技术 |
|---|---|
| 前端 | React 19 + TypeScript + Vite + Zustand + Tailwind CSS v4 |
| 后端 | Node.js + Express 5 + TypeScript + WebSocket(ws) |
| 数据库 | PostgreSQL（生产）/ SQLite（开发，better-sqlite3） |
| AI | pi agent（`@earendil-works/pi-coding-agent`）+ step-3.7-flash |

---

## 2. 快速开始

### 2.1 环境要求

- Node.js ≥ 20.18（推荐 22+）
- PostgreSQL ≥ 14（或使用 SQLite 开发模式）
- Git

### 2.2 克隆与安装

```bash
git clone <repo-url> daily
cd daily

# 后端依赖
cd server
npm install

# 前端依赖
cd ../client/web
npm install
```

### 2.3 配置环境变量

在 `server/.env` 中配置：

```env
# 数据库（二选一）
DB_DRIVER=sqlite              # 开发用 SQLite
# DB_DRIVER=postgres          # 生产用 PostgreSQL
# DATABASE_URL=postgresql://user:pass@localhost:5432/daily

# Web 认证（必填）
CORS_ORIGIN=http://localhost:5173
JWT_SECRET=<至少32字符的随机串，用 openssl rand -hex 32 生成>
WEB_ACCESS_PASSWORD=<至少8字符>

# 服务间 token（桌面/移动端 Bearer，开发可留空）
SERVER_TOKEN=

# AI（pi agent）
VITE_STEPFUN_API_KEY=<stepfun API key>

# 端口
PORT=3456
```

### 2.4 启动开发服务

```bash
# 终端 1：后端
cd server
npm run dev          # tsx watch，端口 3456

# 终端 2：前端
cd client/web
npm run dev          # Vite，端口 5173，代理 /api → 3456
```

打开 http://localhost:5173 ，第一个注册的用户自动成为 admin。

### 2.5 类型检查与构建

```bash
# 前端
cd client/web
npx tsc --noEmit -p tsconfig.app.json   # 类型检查
npm run build                            # Vite 构建

# 后端
cd server
npx tsc --noEmit -p tsconfig.json        # 类型检查
```

---

## 3. 项目结构

```
event/
├── client/
│   └── web/                       # Web 端（React + Vite）
│       ├── src/
│       │   ├── api/               # API client（panels/widgets/communities/...）
│       │   ├── components/
│       │   │   ├── settings/      # 设置页各 section（含 CommunityDiscovery）
│       │   │   ├── widgets/       # 画布组件（HtmlCanvasWidget 等）
│       │   │   ├── Workspace.tsx  # 画布（平移/缩放/渲染）
│       │   │   └── ...
│       │   ├── pages/             # Settings / Login / Admin
│       │   ├── stores/            # Zustand stores
│       │   ├── types/             # TypeScript 类型
│       │   └── utils/             # 工具（db/api/coords/...）
│       └── package.json
├── server/                        # 后端（Express + WS）
│   └── src/
│       ├── routes/                # REST API（auth/panels/communities/...）
│       ├── db/                    # schema.ts(PG) + schema-sqlite.ts + connection
│       ├── middleware/            # auth / error
│       ├── officialCommunities.ts # 官方社区清单（硬编码）
│       ├── piBridge.ts            # pi agent session + 6 工具
│       ├── ws.ts                  # WebSocket 服务
│       └── index.ts               # Express 入口
├── docs/                          # 文档（本目录）
└── AGENT.md                       # AI agent 开发索引
```

---

## 4. 组件开发规范

详见 [component-spec.md](component-spec.md)。要点：

- **两类组件**：iframe widget（矩形可拖拽缩放）+ 自由 HTML 组件（任意形状自由移动）
- 组件是纯 HTML（可含 `<style>` / `<script>`），在 sandbox iframe 中渲染
- 通过 API 上传：`POST /api/dynamic-widgets`
- 组件可声明能力（`component_capabilities` 表）：依赖、API、跨平台标记

### 4.1 最小示例

```html
<!-- hello.html：一个最简单的 widget -->
<div style="padding:16px;font-family:sans-serif">
  <h3>Hello Daily</h3>
  <p>当前时间：<span id="t"></span></p>
</div>
<script>
  document.getElementById('t').textContent = new Date().toLocaleString()
</script>
```

上传：
```bash
curl -X POST http://localhost:3456/api/dynamic-widgets \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $SERVER_TOKEN" \
  -d '{"widgetType":"hello","displayName":"Hello","code":"<div>...</div>"}'
```

---

## 5. API 概览

详见 [api-reference.md](api-reference.md)。主要模块：

| 模块 | 端点 | 说明 |
|---|---|---|
| 认证 | `/api/auth/*` | register / login / me / refresh / logout |
| 面板 | `/api/panels/*` | CRUD + 排序 + 激活 + 社区面板 |
| 组件 | `/api/widgets/*` `/api/dynamic-widgets/*` | 画布组件 + 动态组件上传 |
| 社区 | `/api/communities/*` | 联邦社区注册表 + 官方清单 |
| 设置 | `/api/settings/*` `/api/ai/*` | 全局设置 + AI 配置 |

认证方式：
- Web 端：httpOnly JWT cookie（登录后自动携带）
- 桌面/移动端：`Authorization: Bearer $SERVER_TOKEN`

---

## 6. 部署

详见 [deployment-guide.md](deployment-guide.md)。要点：

- Docker Compose 一键部署（PostgreSQL + Server + 静态前端）
- 必填环境变量：`CORS_ORIGIN` / `JWT_SECRET` / `WEB_ACCESS_PASSWORD` / `SERVER_TOKEN`
- Nginx 反向代理：HTTP + WebSocket 升级 + HTTPS/WSS
- 前端构建产物放 `server/public/`，由 server 在 `/daily` 路径静态托管

---

## 7. 端到端流程

详见 [end-to-end-workflow.md](end-to-end-workflow.md)。一句话：

> 本地写 HTML 组件 → 上传到 Daily → 在画布摆放 → （可选）发布为社区面板组件

---

## 8. 联邦式社区

### 8.1 模型

- 每个 Daily 部署 = 一个独立社区实例
- 各实例独立用户系统（用户在 A 社区注册后不能在 B 社区投稿，必须各自注册）
- Daily 作为客户端聚合展示多个社区

### 8.2 添加社区

- **官方清单**：Daily 项目维护的推荐社区列表（`server/src/officialCommunities.ts`），用户一键添加
- **手动添加**：在设置页"社区发现"输入外部 Daily 实例的 API 地址

### 8.3 官方社区申请

开发者提交申请，默认通过：

1. 部署自己的 Daily 实例并正常运行
2. 向 Daily 官方仓库提 PR，在 `server/src/officialCommunities.ts` 添加自己的社区条目
3. PR 合并后，所有 Daily 实例的"官方社区列表"会展示该社区

申请不审核内容，仅校验地址可达（`apiUrl` 必须是合法 http(s) URL）。

### 8.4 MVP 范围

当前 Phase 6 MVP 仅实现：
- 社区注册表（`communities` 表）+ 官方清单 + 添加/移除 UI
- 不实现跨社区内容抓取（需联邦协议，后续阶段）

---

## 9. 开发约定

- TypeScript 严格模式，禁止 `any`（必要时用 `unknown` + 类型守卫）
- 提交前必做：`tsc --noEmit` 零错误 + `vite build` 零警告
- Conventional commits：`feat(scope): subject`
- 数据库 schema 改动需同时更新 PG（`schema.ts`）和 SQLite（`schema-sqlite.ts`），用幂等 DDL
- 新路由需在 `index.ts` 注册，走 `/api` 全局 authMiddleware

---

## 10. 相关文档索引

- [组件开发规范](component-spec.md)
- [API 文档](api-reference.md)
- [部署指南](deployment-guide.md)
- [端到端流程](end-to-end-workflow.md)
- [设计文档](superpowers/specs/2026-07-07-daily-web-design.md)
- [路线图](roadmap_daily_web.md)
