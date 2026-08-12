# Living Dashboard 服务器端 Roadmap v2

> 生成日期：2026-07-05
> 架构依据：[architecture_refactor.md](architecture_refactor.md)（必读）
> 关联：[roadmap_server_v1.md](roadmap_server_v1.md) v1 基线（S0-S6/S9/S10 已完成）、[roadmap_desktop_v1.md](roadmap_desktop_v1.md) 桌面端、[roadmap_mobile_v1.md](roadmap_mobile_v1.md) 移动端
> 状态：v1 已完成 S0-S6/S9/S10；v2 S11-S15 全部已完成并部署；新增 S16 修订"只要画布"偏离
> **修订记录 v2.1（2026-07-05）**：S11-S15 全部已完成。但实际运行发现偏离"只要画布"诉求（登录后看不到画布）。新增 **Phase S16**（§11.3）作为修订阶段，只做"让用户打开网址就看到画布"——详见 [§十一 修订记录 v2.1](#十一修订记录-v21)。
>
> **产品定位（v2 升级）**：服务器是 AI 推理 + 数据同步 + 多端协作的中心，**同时通过 Web 浏览器直接对外提供服务**——用户打开网址即可使用完整的画布 + AI 能力，无需安装客户端。

---

## 一、v2 升级背景

### 1.1 v1 已完成的能力（基线）

v1 roadmap 的 S0-S6/S9/S10 已全部完成（详见 v1 第四节验收记录），覆盖：

| 能力域 | 完成状态 |
|---|---|
| Docker 部署 + WS 网关 + Pi Agent + 24 工具 + 数据同步（S0） | ✅ |
| per-panel AI 上下文持久化（S1） | ✅ |
| 多端并行 + per-panel activeDeviceId（S2） | ✅ |
| 冲突解决 + syncQueue 持久化（S3） | ✅ |
| AI 配置后端 + API Key 服务器存储（S4） | ✅ |
| 动态组件跨端（S5） | ✅ |
| 本地服务代理（S6） | ✅ |
| AI 搜索工具 4 个（S9） | ✅ |
| GitHub 中转 + ArXiv + 大文件代理（S10） | ✅ |
| 生产 Docker 镜像构建（S7） | ⚠️ 配置就绪，未构建生产镜像 |
| AI 自动化测试（S8） | ⚠️ 仅 smoke + ad-hoc，正式测试套件未完成 |

### 1.2 v2 要解决的问题

v1 roadmap 完全聚焦"AI 推理 + 数据同步 + 多端协作"，**完全没有覆盖"用户通过网页直接访问"的能力**。当前 server 虽然代码完整、API 齐全，但：

| 缺口 | 现状 | v2 目标 |
|---|---|---|
| **Web 前端** | 不存在 `client/web/` 目录，server 不托管任何静态文件 | 新建 `client/web/`，server 静态托管，浏览器打开即可用 |
| **用户访问** | 仅 SERVER_TOKEN + X-Device-Id 双头认证，token 暴露在前端不安全 | 密码登录 + 短期 JWT cookie，浏览器友好 |
| **生产部署** | Docker 配置就绪但未构建镜像，无域名/HTTPS | 构建生产镜像 + 域名 + Let's Encrypt + 宝塔 Nginx 反代 |
| **完整画布能力上 Web** | 桌面端 9 widget + 画布核心仅桌面可用 | 8/9 widget 完整复用，WebviewWidget 显示降级提示 |

### 1.3 v2 范围决策（用户确认）

| 决策项 | 选择 | 理由 |
|---|---|---|
| 用户模式 | **单用户专用** | 仅自己使用，无需 users 表/注册流程，最大化复用 v1 schema |
| AI Key 模式 | **平台付费（自己配）** | LLM Key 通过 `PUT /api/ai/settings` 写入服务器，搜索 Key 已就绪 |
| 前端栈 | **Vite + React 19 + TS（与桌面端同栈）** | 最大化复用桌面端 77% 代码（详见 v2 附录 A） |
| MVP 范围 | **完整画布能力** | 不止 AI 对话，桌面端画布的全部能力（widget 拖拽/缩放/连线/笔迹/小地图）都要上 Web |

### 1.4 v2 与 v1 的关系

- v1 的所有后端能力（per-panel session、多端并行、冲突解决、AI 配置、动态组件、搜索工具）**完全复用**，v2 不重写
- v2 的 Web 端作为**第三个客户端形态**（前两个是桌面 Electron / 移动 Android），接入 v1 已有的 WS + REST API
- v2 的 `panelActiveDevices[panelId]` 机制天然支持 Web 端作为另一个"设备"接入，与桌面/移动端共享同一面板数据

---

## 二、技术决策

### 2.1 前端栈

**Vite + React 19 + TypeScript + Zustand + WebSocket**

| 项 | 选择 | 理由 |
|---|---|---|
| 构建工具 | Vite | 与桌面端一致，复用 `vite.config.ts` 模式 |
| UI 框架 | React 19 | 与桌面端一致，复用 `widgets/components/stores` |
| 语言 | TypeScript | 与桌面端一致，复用 `types/` |
| 状态管理 | Zustand | 与桌面端一致，复用 `useAppStore/useAIStore` 等 7 个 store |
| 路由 | react-router-dom@7 | 桌面端无路由系统，Web 端必须引入 |
| 不用 Next.js | - | 桌面端是 Vite 不是 Next，复用成本高；单用户不需要 SEO/SSR |

**代码复用度（基于附录 A 评估报告）**：

| 类别 | 文件数 | 完全可复用 | 部分复用 | 不可复用 |
|---|---|---|---|---|
| widgets | 9 | 8 | 0 | 1（WebviewWidget） |
| 画布核心 | 7 | 5 | 2（移除 webview 分支） | 0 |
| stores | 7 | 4 | 3（移除 IPC 调用） | 0 |
| utils（核心） | ~20 | 14 | 4 | 2（browserToolBridge、toolBridge 本地部分） |
| types | 7 | 6 | 0 | 0（electron.d.ts 类型保留） |
| api | 15 | 14 | 1（client.ts 移除 serverPortApi） | 0 |
| AI 组件 | ~13 | 9 | 4（移除 aiKeyApi/agentApi） | 0 |
| **合计** | ~78 | **60（77%）** | **18（23%）** | **3（4%）** |

### 2.2 认证方案

**密码登录 + 短期 JWT + httpOnly cookie**

| 项 | 选择 |
|---|---|
| 用户系统 | 不建 users 表，密码存环境变量 `WEB_ACCESS_PASSWORD` |
| 登录端点 | `POST /api/auth/login`（body: `{password}`，校验环境变量，签发 JWT） |
| Token 类型 | JWT（HS256），1 天有效期，存 httpOnly cookie；cookie 选项按环境动态：**生产**（同域 HTTPS）`Secure + SameSite=Strict`；**开发**（跨域 HTTP，Web 在 localhost:5173、server 在 localhost:3456）`Secure=false + SameSite=Lax`，通过 `NODE_ENV` 切换 |
| Token 刷新 | `POST /api/auth/refresh`，校验现有 cookie 后签发新 cookie |
| 登出端点 | `POST /api/auth/logout`，清 cookie |
| 当前用户 | `GET /api/auth/me`，返回 `{authenticated: true}` |
| HTTP API 鉴权 | `authMiddleware` 升级：优先读 cookie JWT，否则读 `Authorization: Bearer xxx`（兼容 v1 客户端） |
| WS 鉴权 | URL query `?token=<JWT>`，浏览器原生 WebSocket 不支持自定义 header；JWT 短期降低泄露风险 |
| 兼容性 | 保留 `SERVER_TOKEN` 作为非 Web 客户端（桌面/移动）的 fallback，但 Web 端强制走 JWT cookie |

**JWT Secret**：环境变量 `JWT_SECRET`（生产必填，缺失拒绝启动）。

### 2.3 WebviewWidget 处理

**问题**：浏览器不支持 Electron `<webview>` 标签，`<iframe>` 受 `X-Frame-Options`/`CSP` 限制无法嵌套大部分网站。

**方案**：
- Web 端的 `WebviewWidget` 渲染降级 UI：显示 URL + "在桌面端打开"按钮 + 截图缩略图（如有）
- 不在 Web 端嵌套网页，不做浏览器自动化
- 浏览器工具（`browser_*` 14 个）在 Web 端不可用，AI 调用这些工具时返回"Web 端不支持，请在桌面端操作"提示
- 其他 8 个 widget（AIAssistant/Calculator/FocusTimer/HtmlCanvas/LatexQuiz/MusicPlayer/PdfViewer/Sudoku）完整支持

### 2.4 工具调用架构

| 工具类别 | Web 端支持 | 执行位置 |
|---|---|---|
| 数据类（widget_*/storage_*/search_*） | ✅ | server 直接执行，结果通过 WS 回传 |
| 浏览器类（browser_* 14 个） | ❌ | Web 端不支持，返回需桌面端提示 |
| 本地服务代理（proxy_*） | ❌ | Web 端无本地服务，不注册也不消费 |
| ask_user / permission_request | ✅ | Web 端弹窗 UI 响应 |
| local_search | ✅ | Web 端执行本地 IndexedDB 索引查询 |

### 2.5 部署形态

**域名**：`shadowshub.xyz`（已确认，A 记录指向 `154.37.222.110`）
**部署路径**：`/daily/`（**不抢主页**，主页保留现有内容，Living Dashboard 作为子路径存在）
**访问入口**：`https://shadowshub.xyz/daily/`

```
用户浏览器 → HTTPS(shadowshub.xyz) → 宝塔Nginx反代
                                      ├── location /         → 现有主页（保留不动）
                                      ├── location /daily/   → proxy_pass http://127.0.0.1:3456（Living Dashboard 静态 + SPA fallback）
                                      ├── location /api/     → proxy_pass http://127.0.0.1:3456（REST API）
                                      └── location /ws       → proxy_pass http://127.0.0.1:3456（WebSocket upgrade）
                                                    ↓
                                              server:3456 (express + WS + 静态托管)
                                                    ↓
                                              PostgreSQL
```

**关键设计**：
- Web 构建产物 `client/web/dist/` 在 Docker 构建阶段 `COPY` 到 `server/public/`
- Vite 构建配置 `base: '/daily/'`（资产路径前缀）
- Web 端 BrowserRouter 配置 `basename="/daily"`（路由前缀）
- server 静态托管挂在 `/daily` 路径（`app.use('/daily', express.static('./public'))`），不影响根路径
- server SPA fallback 只对 `/daily/*` 生效：`app.get('/daily/*', (req, res) => res.sendFile('index.html'))`
- API 路径不变（`/api/*`），WS 路径不变（`/ws`），无需加 `/daily` 前缀（程序访问，非用户访问）
- Cookie `path=/`（让 `/daily` 和 `/api` 都能带 cookie，主页无读取 cookie 的代码无安全风险）
- WS URL：`wss://shadowshub.xyz/ws`（不带 `/daily` 前缀，WS 路径独立）

---

## 三、开发路线

### Phase S11：Web 端基础设施 + 单用户认证（P0）

**目标**：打通"打开网址 → 登录 → 看到 Web 端壳子"的最小闭环

**前置依赖**：v1 S0-S6/S9/S10（已完成）

**被依赖**：S12（画布核心）、S13（AI 集成）、S14（动态组件 + 搜索）、S15（部署）

#### S11.1 Web 端项目脚手架

| 任务 | 详情 | 验收标准 |
|---|---|---|
| 新建 `client/web/` 目录 | Vite + React 19 + TS 模板，与桌面端同栈 | `cd client/web && npm run dev` 能启动，浏览器打开看到默认页 |
| `package.json` | 依赖：react/react-dom/zustand/react-router-dom/ws（或原生 WebSocket） | 依赖安装无错 |
| `vite.config.ts` | 配置 `build.outDir='dist'` + **`base: '/daily/'`**（生产资产路径前缀，对应 Nginx `/daily/` 反代），开发代理 `/api` + `/ws` 到 `localhost:3456` | 开发模式 fetch `/api/health` 成功；生产构建产物引用 `/daily/assets/*.js` |
| `tsconfig.json` | 继承桌面端配置，`paths` 别名与桌面端一致 | TS 编译无错 |
| 共享代码复用 | 从 `client/desktop/src/` 复制（不是软链）以下到 `client/web/src/`：`types/`（除 electron.d.ts）、`api/`、`utils/db.ts`、`utils/dbV2.ts`、`utils/idbTx.ts`、`utils/dbStores/`、`utils/syncQueue.ts`、`utils/deviceAuth.ts`、`utils/iframeProxy.ts`、`utils/localSearch.ts`、`utils/searchCache.ts` 等 14 个完全可复用文件 | 复制后 TS 编译无错，`db.ts` 能初始化 IndexedDB |
| 改造 `api/client.ts` | 移除 `window.serverPortApi?.getServerPort()`，`API_BASE` 改为相对路径 `/api`（或环境变量 `VITE_API_BASE_URL`，与桌面端现有变量名一致） | fetch `/api/health` 走相对路径成功 |
| 改造 `stores/useAIStore.ts` | 移除 `window.serverPortApi/agentApi/localServicesApi`，`WS_URL_BASE` 改为**动态协议选择**：`${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}/ws`（或环境变量 `VITE_WS_URL` 覆盖），移除 `effectiveMode === 'local'` 分支 | WS 连接逻辑编译通过，dev（ws://）和 prod（wss://）均能连接 |
| 改造 `utils/syncQueue.ts` | 移除 `window.syncLogApi` 调用（已实现 IDB + 服务器双写，文件日志去掉） | syncQueue 编译通过 |
| 改造 `utils/contextMenu.ts` | 移除 `window.contextMenuApi`，改为 DOM `contextmenu` 事件 + 自定义菜单组件 | 右键菜单在 Web 端可用 |

#### S11.2 单用户认证

| 任务 | 详情 | 验收标准 |
|---|---|---|
| 新增依赖 | `server/package.json` 新增 `jsonwebtoken` + `@types/jsonwebtoken`（dev） | `npm install` 无错 |
| 新建 `server/src/routes/auth.ts` | 4 个端点：`POST /api/auth/login`（body: `{password}`，校验 `WEB_ACCESS_PASSWORD`，签发 JWT）、`POST /api/auth/refresh`、`POST /api/auth/logout`、`GET /api/auth/me` | 4 端点 curl 测试通过 |
| JWT 工具 | 新建 `server/src/utils/jwt.ts`：`signToken(payload, expiresIn='1d')` + `verifyToken(token)`，HS256，secret 从 `process.env.JWT_SECRET` | 单测：签发 + 验证 + 过期拒绝 |
| 升级 `authMiddleware` | 优先读 cookie `access_token`（httpOnly）→ 验证 JWT → 挂 `req.user = {authenticated:true}`；否则 fallback 到 `Authorization: Bearer <SERVER_TOKEN>`（兼容桌面/移动端）；两者都无则 401 | 双路径鉴权测试通过 |
| 注册路由（顺序敏感） | `index.ts` 路由顺序：(1) `GET /api/health`（免鉴权，已有）；(2) `POST /api/auth/login`（免鉴权，在 `authMiddleware` 之前注册）；(3) `app.use('/api', authMiddleware)`（鉴权中间件）；(4) `GET /api/auth/me` + `POST /api/auth/refresh` + `POST /api/auth/logout`（在 `authMiddleware` 之后，自动鉴权）；(5) 其他 `/api/*` 路由 | 路由顺序正确：login 免鉴权，me/refresh/logout 走鉴权 |
| WS 鉴权升级 | `ws.ts` 的 `verifyClient` 或连接初始化阶段：URL query `?token=<JWT>` 优先校验，否则 fallback 到 `SERVER_TOKEN`；JWT 短期 token 降低 URL log 泄露风险 | Web 端 WS 连接 + 桌面端 WS 连接（SERVER_TOKEN）均成功 |
| 环境变量 | `.env.example` 新增 `WEB_ACCESS_PASSWORD`、`JWT_SECRET`；`docker-compose.yml` 透传 | 配置完整 |
| Web 端登录页 | `client/web/src/pages/Login.tsx`：密码输入框 + 登录按钮，调 `POST /api/auth/login`，成功后 router 跳转 `/`；失败显示错误 | 登录流程闭环 |
| Web 端鉴权守卫 | `client/web/src/components/AuthGuard.tsx`：包裹根路由，未登录跳 `/login`；启动时调 `GET /api/auth/me` 验证 cookie | 未登录访问 `/` 自动跳 `/login` |

#### S11.3 静态托管 + SPA fallback

| 任务 | 详情 | 验收标准 |
|---|---|---|
| server 静态托管 | `index.ts` 在所有 `/api/*` + `/ws` 之后加：`app.use('/daily', express.static(path.resolve(process.cwd(), 'public')))` + `app.get('/daily/*', (req, res) => res.sendFile(path.join(publicDir, 'index.html')))`；**只挂在 `/daily` 路径，不影响根路径 `/`（主页保留）**；**桌面端 Electron fork server 时**（cwd 为 `server/`），`./public` 目录不存在，express.static 会静默跳过，不影响桌面端功能；可通过 `WEB_PUBLIC_DIR` 环境变量控制是否启用 | `curl http://localhost:3456/daily/` 返回 index.html；`curl http://localhost:3456/` 返回 404（根路径不托管）；桌面端 fork server 启动无错 |
| Dockerfile 集成（前置：S11.1 完成） | **前置条件**：必须先完成 S11.1 创建 `client/web/` 目录及最小可构建项目。`server/Dockerfile` 加 `web-builder` 阶段：`COPY client/web/package*.json` → `npm ci` → `COPY client/web/` → `npm run build` → `COPY --from=web-builder /web/dist ./public` | `docker build` 成功，镜像含 `public/` |
| docker-compose | 无需改（沿用 server service），但 `volumes` 不挂 `public/`（构建时打入镜像） | docker-compose up 正常 |
| 本地开发流程 | `client/web/` 跑 `npm run dev`（Vite dev server，代理 /api 到 3456）；`server/` 跑 `npm run dev`；两者独立 | 开发热更新正常 |

#### S11.4 CORS 配置 + docker-compose 透传

| 任务 | 详情 | 验收标准 |
|---|---|---|
| CORS 白名单 | `index.ts` 加 `cors({ origin: (origin, cb) => { const allowed = process.env.CORS_ORIGIN?.split(',').map(s=>s.trim()) ?? []; if (!allowed.length) return cb(new Error('CORS_ORIGIN env required')); if (allowed.includes(origin)) return cb(null, true); cb(null, false); }, credentials: true })`；**dev** 模式 `CORS_ORIGIN=http://localhost:5173`；**prod** 模式 `CORS_ORIGIN=https://shadowshub.xyz`（同域，CORS 主要为 dev 跨域设计）；**禁止用 `*`**（与 `credentials:true` 互斥，浏览器会拒绝带 cookie 的跨域请求）；`CORS_ORIGIN` 未设置时 server 启动失败并打印明确错误 | 非白名单 Origin 被拒；未设置 CORS_ORIGIN 时启动失败 |
| docker-compose 透传 | `docker-compose.yml` server service 的 `environment` 新增：`WEB_ACCESS_PASSWORD: ${WEB_ACCESS_PASSWORD:-}`、`JWT_SECRET: ${JWT_SECRET:-}`、`CORS_ORIGIN: ${CORS_ORIGIN:-}`（**默认空，强制部署者显式配置**）、`WEB_PUBLIC_DIR: ${WEB_PUBLIC_DIR:-./public}` | `docker compose config` 显示变量透传；未配置 CORS_ORIGIN 时 server 启动报错 |
| cookie 策略动态化 | `server/src/utils/jwt.ts` 的 `signToken` 根据 `process.env.NODE_ENV` 选择 cookie 选项：`production` → `{httpOnly:true, secure:true, sameSite:'strict', path:'/', maxAge:86400000}`；非 production → `{httpOnly:true, secure:false, sameSite:'lax', path:'/', maxAge:86400000}`；**`path='/'`**（非 `/daily`）确保 `/daily` 和 `/api` 都能带 cookie（主页无读取 cookie 的代码无安全风险） | dev + prod 登录后 cookie 都能正确发送到 /daily 和 /api |

**Phase S11 验收标准**：
- [ ] `cd client/web && npm run dev` 启动成功，浏览器打开看到登录页
- [ ] 输入正确密码（`WEB_ACCESS_PASSWORD`）登录成功，跳转到空白主页
- [ ] 输入错误密码登录失败，显示错误
- [ ] 未登录访问 `/` 自动跳 `/login`
- [ ] cookie 设置正确（**prod**: httpOnly + Secure + SameSite=Strict；**dev**: httpOnly + Secure=false + SameSite=Lax）
- [ ] JWT 过期后访问 `/api/auth/me` 返回 401，前端跳 `/login`
- [ ] `POST /api/auth/refresh` 能续期
- [ ] `POST /api/auth/logout` 清 cookie 后跳 `/login`
- [ ] WS 连接携带 JWT query token，鉴权通过
- [ ] 桌面端用 `SERVER_TOKEN` 仍能连接 WS（兼容性）
- [ ] server 静态托管验证：`docker build` 后 `docker run`，`curl http://localhost:3456/` 返回 index.html
- [ ] CORS 白名单生效

**发布任务**（沿用 Phase S7）：
- Docker 镜像构建（含 Web 构建产物）
- docker-compose 更新（新增 `WEB_ACCESS_PASSWORD`/`JWT_SECRET`/`CORS_ORIGIN` 环境变量）
- 部署文档更新（Web 端访问说明）

---

### Phase S12：Web 端画布核心（P0）

**目标**：完整画布能力上 Web——8 个 widget + 拖拽/缩放/连线/笔迹/小地图全部可用

**前置依赖**：S11（Web 端基础设施）

**被依赖**：S13（AI 集成需要画布上的 AIAssistant widget）、S14（动态组件 + 搜索）

#### S12.1 画布核心组件复用

| 任务 | 详情 | 验收标准 |
|---|---|---|
| 复用 `Workspace.tsx` | 从桌面端复制，移除 webview 分支判断（约 5-10 行：`target.tagName === 'WEBVIEW' \|\| target.closest('webview')` 检查） | 画布平移/缩放/多面板切换可用 |
| 复用 `CanvasHome.tsx` | 直接复制，无改造 | 画布主页渲染正常 |
| 复用 `WidgetContainer.tsx` | 复制，移除 `type === 'webPage'` 特殊处理 + webview 分支判断 | widget 拖拽/缩放/右键菜单/锁定/图层可用 |
| 复用 `StrokesLayer.tsx` | 直接复制 | SVG 笔迹层渲染正常 |
| 复用 `ConnectionLayer.tsx` | 直接复制 | SVG 连线层渲染正常 |
| 复用 `Minimap.tsx` | 直接复制 | 小地图渲染 + 点击跳转可用 |
| 复用 `CanvasModeToolbar.tsx` | 直接复制 | 模式切换可用 |
| 引入 react-router-dom@7 | `client/web/src/main.tsx` 用 `BrowserRouter`；路由：`/`（画布主页）、`/login`（登录页）、`/panel/:panelId`（特定面板）、`/settings`（设置页）、`/migration`（数据迁移页） | 路由切换正常，刷新不 404（SPA fallback 生效） |

#### S12.2 8 个 widget 复用

| 任务 | 详情 | 验收标准 |
|---|---|---|
| `AIAssistant.tsx` | 直接复制（S13 详细集成） | widget 能创建 + 渲染 |
| `Calculator.tsx` | 直接复制 | 计算器功能完整 |
| `FocusTimer.tsx` | 直接复制 | 番茄钟 + 任务关联可用 |
| `HtmlCanvasWidget.tsx` | 直接复制 | iframe srcDoc + postMessage 可用 |
| `LatexQuiz.tsx` | 直接复制 | KaTeX 渲染 + SM2 算法可用 |
| `MusicPlayer.tsx` | 直接复制 | 音频播放 + 播放列表可用 |
| `PdfViewer.tsx` | 直接复制 | pdfjs-dist 渲染 PDF 可用 |
| `Sudoku.tsx` | 直接复制 | 数独游戏可用 |
| `WebviewWidget.tsx` 降级 | 重写为 `WebviewWidgetFallback.tsx`：显示 URL + "在桌面端打开"按钮 + 截图缩略图（如有） | 创建 webview 类型 widget 时显示降级 UI |

#### S12.3 数据层打通

| 任务 | 详情 | 验收标准 |
|---|---|---|
| IndexedDB 初始化 | 复用 `db.ts` + `dbV2.ts` + `idbTx.ts` + `dbStores/`，Web 端用浏览器原生 IndexedDB | `db.ts` 初始化无错，所有 store 可读写 |
| withFallback 抽象 | 复用 `api/adapter.ts`，API 优先 + IDB 降级 + syncQueue 入队 | 在线时数据走 API，离线时降级 IDB |
| syncQueue | 复用 `syncQueue.ts`（移除 `window.syncLogApi`），IDB + 服务器 sync_logs 双写 | 写操作入队 + 后台同步成功 |
| 设备 ID | 复用 `deviceAuth.ts`，Web 端生成稳定 deviceId 存 localStorage | 同一浏览器 deviceId 稳定 |
| panels/widgets/entities API | 复用 `api/panels.ts` + `api/widgets.ts` + `api/entities.ts`，走相对路径 `/api` | CRUD 全链路通 |

**Phase S12 验收标准**：
- [ ] Web 端打开后看到画布主页，能创建/删除/重命名面板
- [ ] 8 个 widget 全部能创建 + 渲染 + 拖拽 + 缩放 + 右键菜单
- [ ] WebviewWidget 显示降级 UI（URL + "在桌面端打开"按钮）
- [ ] 笔迹层（StrokesLayer）能绘制 + 擦除
- [ ] 连线层（ConnectionLayer）能连接两个 widget
- [ ] 小地图（Minimap）实时反映画布状态
- [ ] 多面板切换正常，画布状态保持
- [ ] 刷新页面后面板 + widget 数据从 server 恢复（withFallback 走 API）
- [ ] 离线时创建 widget，恢复在线后 syncQueue 同步到 server
- [ ] 桌面端创建的 widget，Web 端通过 WS `change` 事件实时收到并渲染（多端同步）
- [ ] Web 端创建的 widget，桌面端实时收到
- [ ] 路由切换正常，刷新不 404

**发布任务**（沿用 Phase S7）

---

### Phase S13：Web 端 AI Agent 集成（P0）

**目标**：Web 端完整 AI 对话 + 工具调用 + 思考流展示 + 配置 UI

**前置依赖**：S11（认证）、S12（画布，AIAssistant widget 需要）

**被依赖**：S14（搜索工具复用 S13 的工具调用框架）

#### S13.1 AI 对话 + 思考流

| 任务 | 详情 | 验收标准 |
|---|---|---|
| `AIAssistant.tsx` 集成 | 复用桌面端 widget，渲染对话气泡 + 输入框 + 发送按钮 | UI 正常 |
| `useAIStore` 适配 | S11 已改造，此处验证：`sendMessage` 走 WS `user_message` + `pi_event` 流式接收 + `tool_call`/`tool_result` 处理 | 发送消息后看到思考流 + 工具调用 + 回复 |
| 思考流 UI | 复用 `components/ai/AIStatusBars.tsx` + `AgentModeSwitcher.tsx` + `ThinkingLevelSlider` | 思考流实时显示，可切换 agent 模式 |
| 工具调用进度 | 复用 `components/ai/SearchResultsCard.tsx` + `SearchResultsPanel.tsx`（搜索结果展示） | 工具调用过程可见 |
| `AskUserCard.tsx` | 复用，响应 `ask_user` WS 事件 | AI 提问时弹窗，用户选择后回传 |
| `PermissionCard.tsx` | 复用，响应 `permission_request` WS 事件 | 危险操作授权弹窗可用 |
| 会话历史 | 复用 `loadSessionHistory`，从 server `ai_conversations` 表恢复 | 刷新页面后对话历史可见 |
| 多端共享 | 同一面板多端在线时，AI 思考流广播到所有端（v1 S2 已实现） | 桌面端发消息，Web 端实时看到思考流 |

#### S13.2 AI 配置 UI

| 任务 | 详情 | 验收标准 |
|---|---|---|
| `AIApiConfig.tsx` 改造 | 复用桌面端，移除 `window.aiKeyApi.setApiKey`，纯走 `PUT /api/ai/settings`（LLM Key/Model/Endpoint） | 配置后能保存到 server ai_settings 表 |
| `AIPromptConfig.tsx` 改造 | 复用桌面端，移除 IPC 调用，走 `PUT /api/ai/settings`（提示词） | 提示词配置可保存 |
| `AISkillsManager.tsx` | 直接复用，走 `/api/skills` CRUD | Skills 管理 UI 可用 |
| 工具管理 UI | 复用桌面端 `/api/tools` 启用/禁用 | 工具启用/禁用生效 |
| 连接测试 | 复用 `POST /api/ai/test-connection` | 测试 LLM 连接返回 ok |

#### S13.3 工具调用适配

| 任务 | 详情 | 验收标准 |
|---|---|---|
| `wsToolHandlers.ts` 改造 | 复用桌面端，移除 14 个 browser_* 工具 case，保留 8 个工具（create_html_widget/update_html_widget/delete_html_widget/list_widgets/storage_read/storage_write/local_search/query_capabilities） | AI 调用数据类工具成功执行 |
| browser_* 工具降级 | AI 调用 browser_* 工具时，Web 端返回 `tool_result.success=false, error='Web 端不支持浏览器工具，请在桌面端操作'` | AI 收到错误后能继续对话 |
| 工具调用 UI | 复用 `components/ai/SearchResultsCard.tsx`（搜索结果） + 自定义 ToolCallCard（其他工具） | 工具调用过程可见 |

**Phase S13 验收标准**：
- [ ] Web 端创建 AIAssistant widget，输入消息发送，看到思考流 + 回复
- [ ] AI 调用 `create_html_widget` 工具，Web 端成功创建 HtmlCanvasWidget
- [ ] AI 调用 `local_search` 工具，Web 端 IndexedDB 索引查询返回结果
- [ ] AI 调用 `browser_*` 工具，返回"Web 端不支持"提示，AI 继续对话
- [ ] AI 主动 `ask_user`，Web 端弹窗，用户选择后 AI 继续
- [ ] AI 危险操作 `permission_request`，Web 端授权弹窗
- [ ] 刷新页面，对话历史从 server 恢复
- [ ] 桌面端发消息，Web 端同面板实时看到思考流
- [ ] Web 端配置 LLM Key（DeepSeek/StepFun/OpenAI），保存到 server，AI 对话可用
- [ ] Web 端配置提示词，保存后生效
- [ ] Web 端管理 Skills，启用/禁用生效
- [ ] Web 端管理工具，启用/禁用生效
- [ ] 连接测试 API 返回 ok

**发布任务**（沿用 Phase S7）

---

### Phase S14：Web 端动态组件 + 搜索（P1）

**目标**：dynamic_widgets 在 Web 端渲染 + 3 个搜索工具 UI（web_search via Metaso / academic_search via ArXiv / github_search）

**前置依赖**：S12（画布）、S13（AI 集成）

**重要**：v1 搜索 API 已从 Bocha/S2 迁移到 Metaso/ArXiv（S2 已移除），roadmap v2 据此对齐。`SearchProvider` 类型当前为 `'metaso' | 'github'`（见 `server/src/db/aiSettingsStore.ts:155`），`academic_search` 走 ArXiv 无需 Key。

#### S14.1 动态组件跨端

| 任务 | 详情 | 验收标准 |
|---|---|---|
| `dynamic_widgets` API | 复用 `api/dynamicWidgets.ts`，CRUD + 查询过滤 `desktop_only=FALSE` | Web 端只看到跨端组件 |
| 渲染引擎 | 复用 `HtmlCanvasWidget.tsx`（iframe srcDoc + postMessage），渲染 dynamic_widget code | Web 端能渲染桌面端创建的纯前端组件 |
| 组件能力声明 | 复用 `api/componentCapabilities.ts` | 组件能力查询正常 |
| 本地服务依赖组件 | Web 端不支持，显示"依赖桌面端本地服务"提示 | 依赖本地服务的组件不崩溃 |

#### S14.2 搜索工具 UI

| 任务 | 详情 | 验收标准 |
|---|---|---|
| 搜索 Key 管理 | 复用 `components/settings/SearchKeysConfig.tsx`（如有）或新建，走 `/api/search/keys` CRUD；provider 白名单为 `metaso` + `github`（不含 bocha/semanticScholar，已迁移） | Metaso/GitHub Key 可配置 + 测试 |
| 搜索结果展示 | 复用 `components/ai/SearchResultsCard.tsx` + `SearchResultsPanel.tsx` | web_search/academic_search/github_search 结果可见 |
| `web_search` | 调用 Metaso API（`https://metaso.cn/api/v1/search`），需配置 Metaso Key | 配置 Key 后返回结果 |
| `academic_search` | 调用 ArXiv API（`https://export.arxiv.org/api/query`），**无需 Key**，按 `submittedDate` 倒序 | 能搜到今天/昨天的论文 |
| GitHub 整仓下载 | `download_repo_zip` mode 返回代理 URL，Web 端提供下载链接 | 点击链接能下载 zip |
| 大文件代理 | `download_file` ≥1MB 返回代理 URL，Web 端下载 | 大文件下载走服务器代理 |

**Phase S14 验收标准**：
- [ ] 桌面端创建的 pure-frontend dynamic_widget，Web 端能渲染
- [ ] desktop_only=TRUE 的组件，Web 端不显示
- [ ] local-dependent 组件，Web 端显示"依赖桌面端"提示
- [ ] 配置 Metaso Key 后，AI 调用 `web_search` 返回结果
- [ ] 无需任何 Key，AI 调用 `academic_search` 返回 ArXiv 论文（按 submittedDate 倒序）
- [ ] 配置 GitHub Key 后，AI 调用 `github_search` 6 mode 全部可用
- [ ] AI 调用 `download_repo_zip`，Web 端点击代理 URL 下载 zip
- [ ] AI 调用 `download_file` ≥1MB，Web 端点击代理 URL 下载

**发布任务**（沿用 Phase S7）

---

### Phase S15：生产部署 + HTTPS（P0）

**目标**：上线到 `154.37.222.110`，绑定域名 + HTTPS，用户打开网址即可用

**前置依赖**：S11-S14 全部完成

#### S15.1 Docker 生产镜像构建

| 任务 | 详情 | 验收标准 |
|---|---|---|
| 多阶段 Dockerfile | `server/Dockerfile` 三阶段：web-builder（构建 client/web/dist）→ server-builder（编译 server/src/dist）→ runtime（COPY dist + public + node_modules） | `docker build` 成功 |
| 镜像版本 tag | `docker tag event-server:v0.6.0-s15` | 镜像存在 |
| docker-compose 生产配置 | `docker-compose.prod.yml`：环境变量从 `.env.prod` 读取，资源限制（mem 1g/cpus 1.0），日志轮转，独立网络 | `docker compose -f docker-compose.prod.yml config` 无错 |
| 数据库迁移 | 迁移脚本幂等（CREATE TABLE IF NOT EXISTS / DO $$ ALTER），S15 无新 schema 变更（沿用 v1） | 迁移脚本可重复执行 |

#### S15.2 域名 + HTTPS + Nginx 反代（保留主页）

| 任务 | 详情 | 验收标准 |
|---|---|---|
| 域名解析 | `shadowshub.xyz` A 记录指向 `154.37.222.110`（已确认） | `dig shadowshub.xyz` 返回 154.37.222.110 |
| 宝塔 Nginx 反代（保留主页） | 在宝塔面板**修改现有 shadowshub.xyz server 块**，**保留根路径 `/` 指向现有主页**，新增 3 个 location 块：<br>`location /daily/ { proxy_pass http://127.0.0.1:3456; proxy_set_header Host $host; proxy_set_header X-Real-IP $remote_addr; }`<br>`location /api/ { proxy_pass http://127.0.0.1:3456; proxy_set_header Host $host; }`<br>`location /ws { proxy_pass http://127.0.0.1:3456; proxy_http_version 1.1; proxy_set_header Upgrade $http_upgrade; proxy_set_header Connection "upgrade"; proxy_read_timeout 86400s; }` | `curl https://shadowshub.xyz/` 返回现有主页内容；`curl https://shadowshub.xyz/daily/` 返回 Living Dashboard index.html |
| Let's Encrypt | 宝塔面板申请 SSL 证书（如已有则复用），强制 HTTPS | HTTPS 访问正常，证书有效 |
| WebSocket over HTTPS | Nginx `/ws` 配置 `proxy_http_version 1.1` + `Upgrade` 头 + `proxy_read_timeout 86400s`（防长时间空闲断开） | `wss://shadowshub.xyz/ws` 连接成功，30 分钟不断开 |

#### S15.3 部署验证

| 任务 | 详情 | 验收标准 |
|---|---|---|
| 首次部署 | `docker compose -f docker-compose.prod.yml up -d` | 容器全部 Up |
| 数据库初始化 | `docker compose exec living-dashboard npm run migrate` | Schema 初始化成功 |
| 健康检查 | `curl https://shadowshub.xyz/api/health` | 返回 200 |
| Web 端访问 | 浏览器打开 `https://shadowshub.xyz/daily/` | 看到登录页 |
| 主页保留验证 | 浏览器打开 `https://shadowshub.xyz/` | **仍是现有主页内容，未被 Living Dashboard 抢占** |
| 登录闭环 | 输入密码登录 | 跳转到画布主页（路径 `/daily/`） |
| AI 对话 | 创建 AIAssistant widget，发消息 | 收到回复 |
| 桌面端兼容 | 桌面端用 SERVER_TOKEN 连接 `wss://shadowshub.xyz/ws` | 桌面端正常工作 |
| 移动端兼容 | 移动端需在 `client/android/local.properties` 设置 `LIVING_DASHBOARD_WS_URL=wss://shadowshub.xyz/ws` 后**重新编译 APK**（`BuildConfig.WS_URL` 是编译时常量，不能运行时切换，见 `client/android/app/src/main/java/com/livingdashboard/sync/ServerConfig.kt:13`） | 重新编译后移动端正常工作 |
| 资源监控 | `docker stats` 确认 mem < 1g | 资源占用在限制内 |

**Phase S15 验收标准**：
- [ ] Docker 生产镜像构建成功，版本 tag 正确
- [ ] docker-compose.prod.yml 配置正确，资源限制生效
- [ ] 域名解析正确
- [ ] Nginx 反代配置正确，HTTP + HTTPS 均可访问
- [ ] Let's Encrypt 证书有效，强制 HTTPS
- [ ] WSS 连接正常（WebSocket over HTTPS）
- [ ] 浏览器打开 `https://shadowshub.xyz/daily/` 看到登录页
- [ ] 浏览器打开 `https://shadowshub.xyz/` 仍是现有主页（**未被抢占**）
- [ ] 登录后看到画布主页，能创建 widget + AI 对话
- [ ] 桌面端连接 `wss://shadowshub.xyz/ws` 正常
- [ ] 移动端重新编译 APK 后连接 `wss://shadowshub.xyz/ws` 正常
- [ ] 资源占用在限制内（mem < 1g）
- [ ] 日志轮转生效（max-size 10m, max-file 3）

**发布任务**：
- 生产镜像构建 + tag
- 部署到 154.37.222.110
- 域名 + HTTPS 配置
- 部署文档更新（含回滚方案）

---

## 四、与桌面/移动端 roadmap 的关系

### 4.1 三端协同架构

| 端 | 角色 | 部署形态 | AI 模式 |
|---|---|---|---|
| **桌面端** | 完整画布 + 浏览器 + 本地 Agent | Electron 安装包 | 云端（连 server）+ 本地（LocalAgentService） |
| **移动端** | 看板 + 简单使用（v2 调整方向） | Android APK | 云端（连 server）+ 本地（轻 Agent） |
| **Web 端（v2 新增）** | 完整画布（除 WebviewWidget） | 浏览器访问 server | 仅云端（连 server） |

### 4.2 三端能力矩阵

| 能力 | 桌面端 | 移动端 | Web 端 |
|---|---|---|---|
| 画布核心（拖拽/缩放/连线/笔迹） | ✅ | ✅（待重构为看板） | ✅ |
| 9 个内置 widget | ✅ 全部 | ✅ 部分 | ✅ 8/9（WebviewWidget 降级） |
| AI 对话 + 思考流 | ✅ | ✅ | ✅ |
| 数据类工具（widget/storage/search） | ✅ | ✅ | ✅ |
| 浏览器工具（browser_*） | ✅ | ✅ | ❌ |
| 本地服务代理 | ✅ 注册 + 消费 | ✅ 消费 | ❌ |
| 本地 Agent（离线 AI） | ✅ | ✅ | ❌ |
| 动态组件（dynamic_widgets） | ✅ 创建 + 渲染 | ✅ 渲染 | ✅ 渲染（仅 pure-frontend） |
| 多端实时同步 | ✅ | ✅ | ✅ |

### 4.3 三端共用 API 契约

v2 不新增 API（除 `/api/auth/*`），三端共用 v1 已有的 22 个 `/api/*` 端点：

| API 类别 | 端点 | 三端共用 |
|---|---|---|
| 画布数据 | `/api/panels`、`/api/widgets`、`/api/entities` | ✅ |
| AI 配置 | `/api/ai`、`/api/skills`、`/api/tools` | ✅ |
| 搜索 | `/api/search/keys`、`/api/github/proxy` | ✅ |
| 动态组件 | `/api/dynamic-widgets`、`/api/component-capabilities` | ✅ |
| 同步 | `/api/sync/logs`、`/api/entities/conflicts` | ✅ |
| 收藏 | `/api/favorites` | ✅ |
| 认证（v2 新增） | `/api/auth/login`、`/refresh`、`/logout`、`/me` | Web 端必用，桌面/移动端可选 |

### 4.4 数据同步策略

| 场景 | 机制 |
|---|---|
| 同一面板多端在线 | v1 S2 已实现：per-panel activeDeviceId + 定向广播 |
| 离线写操作 | syncQueue（IDB + 服务器 sync_logs 双写）+ 冲突解决（v1 S3 乐观锁） |
| 设备切换面板 | v1 S2 已实现：`cleanupDeviceFromOtherPanels` 自动清理 |
| Web 端作为新设备 | 生成稳定 deviceId（localStorage），接入 v1 已有的多端并行机制 |

---

## 五、服务器配置（v2 增量）

### 5.0 服务器与域名（已确认）

| 资源 | 实际配置 | 说明 |
|---|---|---|
| **服务器 IP** | `154.37.222.110` | 远程 SSH `root`，凭据见 `.env.server`（不入 git） |
| **域名** | `shadowshub.xyz` | A 记录指向 154.37.222.110 |
| **部署路径** | `/daily/` | **不抢主页**，主页 `/` 保留现有内容 |
| **访问入口** | `https://shadowshub.xyz/daily/` | 用户打开网址即可用 |
| **WS 入口** | `wss://shadowshub.xyz/ws` | 桌面/移动端连接（WS 路径独立，不加 /daily 前缀） |
| **API 入口** | `https://shadowshub.xyz/api/*` | REST API（路径独立，不加 /daily 前缀） |
| **规格** | 2h4g15m100gb | 已有 1 个网站 Docker（主页），Living Dashboard 作为第二个 Docker 共存 |
| **Web 密码** | `WEB_ACCESS_PASSWORD` 环境变量 | 部署时填入服务器 `.env.prod`（不入 git，参考 `.env.server` 模式） |

### 5.1 新增环境变量

| 变量 | 用途 | 必填 | 默认值 |
|---|---|---|---|
| `WEB_ACCESS_PASSWORD` | Web 端登录密码 | 生产必填 | - |
| `JWT_SECRET` | JWT 签名 secret | 生产必填 | - |
| `CORS_ORIGIN` | CORS 白名单（逗号分隔） | **必填**（未设置时启动失败） | - |
| `WEB_PUBLIC_DIR` | Web 构建产物目录 | - | `./public` |

### 5.2 资源占用估算（v2 增量）

| 组件 | 内存增量 | 磁盘增量 | 说明 |
|---|---|---|---|
| Web 静态托管 | ~10 MB | ~5 MB | express.static + index.html + JS bundle |
| JWT 中间件 | ~1 MB | - | 内存计算 |
| Web 端构建产物 | - | ~10 MB | dist/ 含 sourcemap |
| **v2 合计增量** | **~11 MB** | **~15 MB** | 远小于 v1 的 0.6 GB |

v1 + v2 总占用 ~0.65 GB，4 GB 服务器余量充裕。

### 5.3 部署操作指南（v2 增量）

| 操作 | 命令 | 影响范围 |
|---|---|---|
| 首次部署 v2 | `docker compose -f docker-compose.prod.yml up -d --build` | 重建 server 镜像（含 Web 产物） |
| 仅更新 Web 端 | 重新构建镜像 + `docker compose up -d --build living-dashboard` | 只重启 server 容器 |
| 回滚到 v1 | `docker tag event-server:v0.5.0-s10` 重新 up | 回到 v1 镜像 |

---

## 六、风险与缓解

### 6.1 技术风险

| 风险 | 概率 | 影响 | 缓解方案 |
|---|---|---|---|
| **Nginx 配置错误抢占 shadowshub.xyz 主页** | 中 | 高 | **只反代 `/daily/` + `/api/` + `/ws`，不反代 `/`**；server 静态托管也只挂 `/daily`，根路径 `/` 返回 404；部署后必须验证 `curl https://shadowshub.xyz/` 仍是现有主页 |
| WebviewWidget 在 Web 端不可用 | 100% | 中 | 降级 UI（URL + "在桌面端打开"），不影响其他 widget |
| 浏览器 IndexedDB 配额限制 | 低 | 中 | 单用户数据量小（<100 MB），远低于浏览器配额（通常 1GB+） |
| WS 连接被 Nginx 断开 | 中 | 高 | Nginx 配置 `proxy_read_timeout 86400s` + 心跳保活（v1 已实现 30s ping） |
| JWT 泄露 | 低 | 高 | httpOnly + Secure + SameSite=Strict（prod）/Lax（dev）cookie + 1 天有效期 + HTTPS 强制 |
| CORS 配置错误 | 中 | 中 | 生产 + 开发均白名单严格限制，禁止用 `*`（与 credentials:true 互斥），未配置 CORS_ORIGIN 时启动失败 |
| Docker 镜像过大 | 低 | 低 | 多阶段构建 + `npm ci --omit=dev` + .dockerignore 排除 sourcemap |
| 桌面端/移动端兼容性 | 低 | 高 | `authMiddleware` 双路径（JWT cookie + SERVER_TOKEN bearer） |

### 6.2 产品风险

| 风险 | 概率 | 影响 | 缓解方案 |
|---|---|---|---|
| 完整画布在 Web 端体验差 | 中 | 中 | 桌面端是首选体验，Web 端定位"随时访问"而非"主力使用" |
| 浏览器工具不可用导致 AI 能力打折 | 100% | 中 | AI 自动 fallback：browser_* 失败后用 search 工具替代；提示用户用桌面端 |
| 单用户模式无法分享 | 100% | 低 | v2 明确单用户定位，未来若需多用户再升级 v3 |

---

## 七、约束条件（v2 增量）

### 7.1 硬约束

| 约束 | 说明 |
|---|---|
| **不重写 v1** | v1 的 S0-S6/S9/S10 后端能力完全复用，v2 只新增不重写 |
| **不破坏桌面/移动端兼容** | `authMiddleware` 双路径鉴权，桌面端 SERVER_TOKEN 仍可用 |
| **单用户模式** | 不建 users 表，密码存环境变量，最大化简化 |
| **TypeScript 优先** | Web 端 + server 端均用 TypeScript |
| **不下载到 C 盘** | 开发工具/缓存配置到非 C 盘 |
| **git 版本管理** | 所有变更走 git commit |
| **Docker 部署** | 沿用 v1 Docker 部署，Web 产物打入 server 镜像 |

### 7.2 开发环境

| 工具 | 路径 |
|---|---|
| 项目根目录 | `f:\allmylife\event` |
| 服务器代码 | `f:\allmylife\event\server\` |
| Web 端代码（v2 新增） | `f:\allmylife\event\client\web\` |
| v1 roadmap | `f:\allmylife\event\docs\roadmap_server_v1.md` |
| v2 roadmap（本文档） | `f:\allmylife\event\docs\roadmap_server_v2.md` |

---

## 八、开发工作流（强制，沿用 v1）

> 此规则优先级高于一切。任何 Phase 在开始编码前，必须完成以下步骤。

### 执行铁律：写 Spec → 对抗审查 Spec → 编码 → 对抗审查

```
编写 Spec → 对抗审查 Spec → 审查通过？
                                ↓ 否 → 修订 Spec → 重新审查
                                ↓ 是 → 编码实现 → adversarial-review Skill 对抗审查 → 通过？
                                                                                  ↓ 否 → 修复 → 重新审查
                                                                                  ↓ 是 → git commit
```

### 上下文要求

每次写 Spec 时，必须包含：
- 项目目的（v2：让用户通过网页直接访问完整画布 + AI 能力）
- 本 roadmap v2 的 Phase 任务和验收标准
- 约束条件（单用户、TypeScript 优先、不下载 C 盘、Docker 部署等）
- 与桌面/移动端 roadmap 的兼容性（双路径鉴权、API 共用）

---

## 九、验收标准总览

### Phase S11 验收
- [ ] Web 端项目脚手架可运行
- [ ] 单用户认证闭环（登录/刷新/登出/当前用户）
- [ ] JWT cookie 设置正确（**prod**: httpOnly + Secure + SameSite=Strict；**dev**: httpOnly + Secure=false + SameSite=Lax）
- [ ] authMiddleware 双路径鉴权（JWT cookie + SERVER_TOKEN bearer）
- [ ] WS 鉴权升级（JWT query token + SERVER_TOKEN fallback）
- [ ] server 静态托管 + SPA fallback
- [ ] Dockerfile 多阶段构建（含 Web 产物）
- [ ] CORS 白名单生效（未配置 CORS_ORIGIN 时启动失败）
- [ ] 桌面端兼容性验证（SERVER_TOKEN 仍可用）

### Phase S12 验收
- [ ] 7 个画布核心组件复用（Workspace/CanvasHome/WidgetContainer/StrokesLayer/ConnectionLayer/Minimap/CanvasModeToolbar）
- [ ] 8 个 widget 复用（AIAssistant/Calculator/FocusTimer/HtmlCanvas/LatexQuiz/MusicPlayer/PdfViewer/Sudoku）
- [ ] WebviewWidget 降级 UI
- [ ] IndexedDB + withFallback + syncQueue 数据层打通
- [ ] 多端实时同步（Web 端 ↔ 桌面端）
- [ ] react-router 路由系统 + SPA fallback

### Phase S13 验收
- [ ] AIAssistant widget 完整对话 + 思考流
- [ ] AI 配置 UI（LLM Key/提示词/Skills/工具）
- [ ] 8 个数据类工具可调用
- [ ] browser_* 工具降级提示
- [ ] ask_user / permission_request 弹窗
- [ ] 会话历史恢复
- [ ] 多端思考流广播

### Phase S14 验收
- [ ] dynamic_widgets 跨端渲染（pure-frontend）
- [ ] desktop_only / local-dependent 组件过滤/提示
- [ ] 4 个搜索工具 UI
- [ ] GitHub 整仓下载 + 大文件代理

### Phase S15 验收
- [ ] Docker 生产镜像构建 + tag
- [ ] 域名 + HTTPS + WSS
- [ ] 宝塔 Nginx 反代
- [ ] 浏览器打开 `https://shadowshub.xyz/daily/` 完整可用
- [ ] 浏览器打开 `https://shadowshub.xyz/` 仍是现有主页（**未被抢占**）
- [ ] 桌面端 / 移动端兼容性
- [ ] 资源监控达标

---

## 十一、修订记录 v2.1（2026-07-05）

### 11.0 背景

S11-S15 全部已实现并部署上线（用户已实际使用过 Web 端，因此发现 UI 丑、看不到画布等问题）。但实际运行后发现与用户"只要画布"的核心诉求偏离严重，本修订章节用于：

1. 记录实际诊断出的问题（不掩饰）
2. 新增 **Phase S16** 作为修订阶段，在现有代码上改，不重写 S11-S15

**关键原则**：S11-S15 全部已完成、已部署。S16 是新增的修订阶段，不回头改 S11-S15 的编号。S16 只做"让用户打开网址就看到画布"这一件事，不做其他。

### 11.1 用户核心诉求（重新明确）

| 端 | 定位 | 关键词 |
|---|---|---|
| 桌面端 | 完整的画布功能，开放性高，能开发各种东西 | 完整 + 开放 |
| 移动端 | 看板 + 简单使用 | 看板 + 简单 |
| **服务端（Web 端）** | **像 DeepSeek 那样打开网址就能用** | **直接用 + 画布** |

**Web 端的本质**：用户打开 `https://shadowshub.xyz/daily/` → 看到画布 → 用画布。**中间不要中转页、不要仪表盘、不要启动器、不要浏览器形态**。画布是唯一的主角。

### 11.2 S11-S15 实际诊断（运行时核查结果）

#### S11/S12 问题 1：登录后看不到画布（用户最不满）

**现象**：登录后路由 `/` 落在 [CanvasHome.tsx](file:///f:/allmylife/event/client/web/src/components/CanvasHome.tsx)（1007 行的"启动器/仪表盘中转页"），不是画布。用户必须再点一次"进入画布"按钮才能跳到 `/panel/:panelId` 看到真正的画布。

**根因**：S12.1 直接复用了桌面端的 CanvasHome（启动器形态），但桌面端的 CanvasHome 是为"桌面端有浏览器/多面板/AI 对话框"设计的，Web 端用户根本不需要这些中转。

**实际代码状态**：画布本体 [Workspace.tsx](file:///f:/allmylife/event/client/web/src/components/Workspace.tsx)（1538 行）+ WidgetContainer + StrokesLayer + ConnectionLayer + Minimap **完整存在且可用**，只是用户看不到。

#### S11/S12 问题 2：CanvasHome 塞了一堆和画布无关的东西

**CanvasHome.tsx 1007 行里的非画布内容**：
- 类 ChatGPT 的 AI 对话框（pill 形输入框 + 展开聊天界面）—— 占据主页中心
- 收藏组件网格 + 添加组件对话框 —— 仪表盘功能
- 快捷链接区（`browser-home`/`web-tab` 浏览器入口）—— **Web 端路由表里没有 `/browser`，这些是死代码**
- 最近访问面板区 —— 仪表盘功能
- 设置入口浮动按钮

**这是桌面端浏览器/仪表盘思维的产物**，直接复用到 Web 端，但 Web 端用户根本用不到。

#### S11/S12 问题 3：死代码

| 文件 | 死代码内容 | 状态 |
|---|---|---|
| [Home.tsx](file:///f:/allmylife/event/client/web/src/pages/Home.tsx) | S11 阶段的占位页（"Phase S11 完成..."），已被 CanvasHome 取代但未删 | 应删 |
| `useAppStore.ts` | `webTabs`/`browser-home`/`web-tab` 类型 + 状态 | 死代码（Web 端无对应路由） |
| `types/index.ts` | `WebTab`/`MainView` 的浏览器类型 | 死代码 |
| `db.ts`/`dbV2.ts`/`searchIndexAdapters.ts` | `webTabs` store + 索引适配器 | 死代码（Web 端不用） |
| CanvasHome.tsx 第 272-276 行 | `setMainView({ type: 'browser-home' })` / `setMainView({ type: 'web-tab' })` | 死代码（路由表无此路径） |

#### S13/S14/S15 状态

- **S13（AI 集成）**：已实现。useAIStore 1577 行完整 WS 客户端 + 5 个设置页（AIApiConfig/AIPromptConfig/AISkillsManager/ToolsManager/SearchKeysConfig）+ AIAssistant widget 完整。
- **S14（动态组件 + 搜索）**：已实现。dynamic_widgets 跨端完整；SearchResultsCard 组件完整但**SearchResultsPanel 未接线到任何 UI**（孤儿组件，用户看不到搜索结果）——但**S16 不修这个**，因为不属于"只要画布"。
- **S15（部署）**：已实现。已部署到 `shadowshub.xyz/daily/`，主页保留。

---

### 11.3 Phase S16：全端修订（"只要画布"纠偏）（P0）

**目标**：让用户打开 `https://shadowshub.xyz/daily/` 后立即看到画布。**只做这一件事**。

**前置依赖**：S11-S15 全部已完成

**不做的事**（明确排除）：
- ❌ 不重做登录页视觉（登录页不是画布，不属于"只要画布"）
- ❌ 不接线 SearchResultsPanel（搜索 UI 不是画布，不属于"只要画布"）
- ❌ 不写 Web 端 UI 规范（规范是约束未来的，S16 只改现状）
- ❌ 不重写 S11-S15 任何代码（只在现有代码上改路由 + 删死代码）

#### S16.1 路由改为"登录即画布"

| 任务 | 详情 | 验收标准 |
|---|---|---|
| [App.tsx](file:///f:/allmylife/event/client/web/src/App.tsx) 路由表 | `/` 直接渲染 `<Workspace />`（不再经过 CanvasHome）；`/panel/:panelId` 保留；`/login` 保留；`/migration` 保留；`/settings` 保留 | 登录后浏览器 URL 仍是 `/`，但渲染的是 Workspace |
| Workspace 空面板处理 | 若 `panels.length === 0`，Workspace 内部已实现 `WelcomeScreen`（模板选择页）—— **保留此行为**，不另做中转页 | 无面板时看到模板选择，有面板时看到画布 |
| Workspace 多面板切换 | 在 Workspace 内部加一个极简的"面板切换"入口（下拉或侧边栏，复用桌面端 `panelMemoryManager`），不另开页面 | 用户在画布内能切换/新建/删除面板 |
| 删除 CanvasHome 路由 | App.tsx 移除 `<CanvasHome />` 的引用和 import；CanvasHome.tsx 文件**不删**（S16.2 处理） | `import CanvasHome` 删除，路由表无 `/` → CanvasHome |
| MainViewSync 逻辑修订 | [App.tsx](file:///f:/allmylife/event/client/web/src/App.tsx) 的 `MainViewSync`：`mainView.type === 'canvas-home'` 分支删除（或改为 `navigate('/')`，因为 `/` 现在就是 Workspace） | mainView 变化时路由正确同步，无重定向循环 |

#### S16.2 归档 CanvasHome

| 任务 | 详情 | 验收标准 |
|---|---|---|
| 归档 CanvasHome.tsx | 将 [CanvasHome.tsx](file:///f:/allmylife/event/client/web/src/components/CanvasHome.tsx) 移到 `client/web/src/_archive/CanvasHome.tsx`（不参与构建） | 构建产物不含 CanvasHome 代码；TS 编译不报错 |
| 归档 FavoriteWidgetPreview | 如果 [FavoriteWidgetPreview.tsx](file:///f:/allmylife/event/client/web/src/components/FavoriteWidgetPreview.tsx) 只被 CanvasHome 引用，一起归档 | grep 无残留引用 |

#### S16.3 清理死代码

| 任务 | 详情 | 验收标准 |
|---|---|---|
| 删除 Home.tsx | [pages/Home.tsx](file:///f:/allmylife/event/client/web/src/pages/Home.tsx) 是 S11 占位页，已弃用 | 文件删除，grep 无引用 |
| 清理 useAppStore 的浏览器状态 | 移除 `webTabs`/`setActiveWebTab`/`homeTemplate` 等浏览器相关状态字段（清理前先 grep 确认 Workspace/WidgetContainer 不依赖） | TS 编译无错，Workspace 正常工作 |
| 清理 types/index.ts | 移除 `WebTab` 类型、`MainView` 的 `browser-home`/`web-tab` 类型（改为 `canvas-home`/`canvas-panel` 两种） | TS 编译无错 |
| 清理 db.ts/dbV2.ts | 移除 `webTabs` store（确认 Web 端不用） | IndexedDB 初始化无错 |
| 清理 searchIndexAdapters.ts | 移除 `webTabs` 索引适配器 | TS 编译无错 |
| **注意** | 清理前先 grep 确认无其他引用；Workspace/WidgetContainer 不依赖这些字段才能删 | grep 无残留引用 |

#### S16.4 重新部署

| 任务 | 详情 | 验收标准 |
|---|---|---|
| Docker 镜像重建 | `docker build` 重新构建 server 镜像（含 S16 修订后的 Web 构建产物） | 镜像构建成功 |
| 部署到 shadowshub.xyz | `docker compose -f docker-compose.prod.yml up -d` | 容器全部 Up |
| 运行时验证 | 浏览器打开 `https://shadowshub.xyz/daily/` | **登录后立即看到画布**（或 WelcomeScreen 模板选择，若无面板） |
| 主页保留验证 | 浏览器打开 `https://shadowshub.xyz/` | 仍是现有主页，未被抢占 |
| 不回归验证 | 登录/鉴权/WS/8 widget/笔迹/连线/小地图/AIAssistant widget 全部正常 | 现有功能不回归 |

**Phase S16 验收标准**：
- [ ] 路由 `/` 直接渲染 Workspace（不经过 CanvasHome）
- [ ] 登录后立即看到画布（或 WelcomeScreen 模板选择，若无面板）
- [ ] 画布内能切换/新建/删除面板（不离开画布）
- [ ] CanvasHome 从构建产物移除（归档到 `_archive/`）
- [ ] Home.tsx 删除
- [ ] useAppStore/types/db 的浏览器死代码清理（grep 无残留）
- [ ] TS 编译无错
- [ ] Docker 镜像重建 + 部署到 shadowshub.xyz/daily/
- [ ] **运行时验证**：浏览器打开 `https://shadowshub.xyz/daily/` 登录后立即看到画布
- [ ] 主页 `https://shadowshub.xyz/` 未被抢占
- [ ] 现有 S11-S15 功能不回归

**发布任务**（沿用 Phase S7）：
- Docker 镜像构建（含 S16 修订后的 Web 构建产物）
- 部署到 shadowshub.xyz/daily/
- 运行时验证（必须实际打开网址确认看到画布）

### 11.4 修订总结

| 项 | 决策 |
|---|---|
| S11-S15 | **全部已完成，不重写** |
| S16 | **新增**，只做"让用户打开网址就看到画布" |
| CanvasHome | **归档**（移到 `_archive/`，不删文件） |
| 路由策略 | **改为登录即画布** |
| 死代码 | **清理** |
| 登录页视觉 | **不动**（不属于"只要画布"） |
| SearchResultsPanel 接线 | **不动**（不属于"只要画布"） |
| Web 端 UI 规范 | **不写**（S16 只改现状，不约束未来） |

---

## 十二、下一步

本 roadmap 确认后，后续 AI 应：
1. 读完本 roadmap v2（**特别是 [§十一 修订记录 v2.1](#十一修订记录-v21)**）+ [roadmap_server_v1.md](roadmap_server_v1.md)（v1 基线）+ [architecture_refactor.md](architecture_refactor.md)
2. **当前状态**：S11-S15 全部已完成并部署。需执行 **Phase S16**（§11.3）修正"只要画布"偏离
3. S16 执行流程：
   - 路由改为"登录即画布"（§11.3 S16.1）
   - 归档 CanvasHome（§11.3 S16.2）
   - 清理死代码（§11.3 S16.3）
   - 对抗审查 + 运行时验证（登录后立即看到画布）
   - 重新部署到 shadowshub.xyz/daily/（§11.3 S16.4）
4. S16 验收通过后，roadmap v2 全部完成

**建议优先级**：
**Phase S16（全端修订，P0，立即做）**

> S11-S15 已全部完成。S16 是最后一个 Phase，只做"让用户打开网址就看到画布"。S16 验收通过后，roadmap v2 全部完成。

---

### Phase S17：Settings 页面修复 + 模型列表 + AI 思考循环修复（P0）✅ 已完成

**目标**：修复 Settings 页面 500 错误、新增模型列表端点、改善 AI 连接测试错误提示、修复 AI 思考卡死和工具调用无限循环

**前置依赖**：S11-S16 全部已完成

**完成内容（2026-07-06 ~ 2026-07-25）**：

S17 共 12 个子任务，分 4 次提交完成：

| 子任务 | 详情 | 提交 |
|---|---|---|
| S17.1 | 修复 /daily/* SPA fallback 500 错误（webPublicDir 强制绝对化 + readFileSync 兜底 + 诊断日志） | de5706e |
| S17.2 | 新增 POST /api/ai/models 端点（5 分钟缓存 + 错误分类） | de5706e |
| S17.3 | AIApiConfig UI 改造（model 下拉框 + 手动输入 + 刷新按钮） | de5706e |
| S17.4 | test-connection 错误分类（SUBSCRIPTION_EXPIRED/API_KEY_INVALID 等） | de5706e |
| S17.5 | Settings 页面 UI 美化 + 工具管理 UI 重做（39 处样式 + 卡片式 + toggle） | de5706e |
| S17.6 | /api/ai/models 根据 endpoint 域名动态选择 provider（resolveModelsEndpoint） | 521a73b |
| S17.7 | /models 改 POST + test-connection 成功后自动保存 apiKey | 521a73b |
| S17.8 | 删除客户端 !preset.apiKey 前置检查（由 server 优先级链处理） | 521a73b |
| S17.9 | piBridge.ts model provider 推断改为根据 endpoint 域名 | 521a73b |
| S17.10 | 客户端双层 watchdog（120s 活动 + 5min 绝对）+ agent_end 按 boundPanelId 路由 + Stop 按钮 | db56f2b |
| S17.11 | 工具调用无限循环根因修复（客户端 tool_call bypass + 服务端 TOOL_FAILURE_THRESHOLD=3 + session.prompt 3min 超时 + cancel_request） | db56f2b |
| S17.12 | error_report 速率限制（10s 冷却 + 3 次/分钟）+ panelSessionMap + HtmlCanvasWidget 5 秒防抖（双端一致） | 189073d + S17 收尾 |

**关键修复**：
- /daily/* SPA fallback 500 → 200（webPublicDir 绝对化 + readFileSync 兜底）
- 模型列表硬编码 ['step-3.7-flash'] → 39 个真实模型（POST /api/ai/models + provider 推断）
- AI 思考卡死 3min+ → 4.5s 完成（双层 watchdog + boundPanelId 路由）
- 工具调用无限循环 → 三层防护（客户端防抖 + 服务端速率限制 + 工具失败计数）

**运行时验证（20/20 通过）**：见 [phase-s17-spec.md](specs/phase-s17-spec.md) §9.1

**部署状态**：
- 镜像版本：`event-server:v0.6.9-s17.11`
- 部署地址：`https://shadowshub.xyz/daily/`
- 已部署并公网验证通过

**Spec 引用**：[phase-s17-spec.md](specs/phase-s17-spec.md)

---

## 附录 A：桌面端代码复用度评估报告（依据）

> 本附录基于对 `client/desktop/src/` 全量代码扫描，给出 Web 端复用度判断。详见 sub-agent 报告。

### A.1 核心抽象层（必须理解）

- `api/adapter.ts` 的 `withFallback(apiFn, idbFn, syncOp)` 是整个数据层的核心抽象
- API 优先，失败时降级到 IDB，写操作同时入队 syncQueue
- Web 端可直接复用，零改造

### A.2 复用度统计

| 类别 | 文件数 | 完全可复用 | 部分复用 | 不可复用 |
|---|---|---|---|---|
| widgets | 9 | 8 | 0 | 1（WebviewWidget） |
| 画布核心 | 7 | 5 | 2（移除 webview 分支） | 0 |
| stores | 7 | 4 | 3（移除 IPC 调用） | 0 |
| utils（核心） | ~20 | 14 | 4 | 2（browserToolBridge、toolBridge 本地部分） |
| types | 7 | 6 | 0 | 0（electron.d.ts 类型保留） |
| api | 15 | 14 | 1（client.ts 移除 serverPortApi） | 0 |
| AI 组件 | ~13 | 9 | 4（移除 aiKeyApi/agentApi） | 0 |
| **合计** | ~78 | **60（77%）** | **18（23%）** | **3（4%）** |

### A.3 需重写的文件（Web 端不可复用）

- `components/widgets/WebviewWidget.tsx` → 重写为 `WebviewWidgetFallback.tsx`
- `utils/browserToolBridge.ts` → 移除（Web 端不支持浏览器工具）

### A.4 需改造的文件（部分复用）

- `App.tsx` → 移除 webviewApi/menuApi/serverPortApi + 引入路由
- `api/client.ts` → 移除 serverPortApi
- `stores/useAIStore.ts` → 移除 serverPortApi + agentApi + localServicesApi
- `components/AIAssistantSidebar.tsx` → 移除 agentApi.setThinkingLevel
- `components/settings/AIApiConfig.tsx` → 移除 aiKeyApi.setApiKey
- `components/Workspace.tsx` → 移除 webview 分支
- `components/WidgetContainer.tsx` → 移除 webview 分支
- `utils/wsToolHandlers.ts` → 移除 14 个 browser_* 工具 case
- `utils/contextMenu.ts` → 替换为 DOM contextmenu

### A.5 关键技术结论

1. **77% 的代码可零改造直接复用**，主要得益于 `withFallback` 抽象层屏蔽了后端差异
2. **23% 的代码需小幅改造**，主要是移除 `window.*Api` 调用 + 移除 webview 分支判断
3. **仅 4% 的代码不可复用**（WebviewWidget + browserToolBridge + toolBridge 本地 agent 部分）
4. **路由系统是最大缺口**，必须从零引入 react-router
5. **WS 协议层可完全复用**，仅需移除 serverPortApi 端口获取逻辑
6. **IndexedDB 用法完全可复用**（桌面端用浏览器原生 IndexedDB，非 Electron 定制）

---

## 附录 B：server 端改造点清单（依据）

> 本附录基于对 `server/src/` 全量代码扫描，给出 v2 改造点。详见 sub-agent 报告。

### B.1 认证机制现状

- **机制**：HTTP Bearer Token + X-Device-Id 双头认证
- **核心文件**：`server/src/middleware/auth.ts`（62 行）
- **WS 鉴权**：URL query `?deviceId=xxx&token=xxx`
- **改造点**：`authMiddleware` 升级支持 JWT cookie，WS 鉴权升级支持 JWT query token

### B.2 WS 协议现状

- **ChangeEvent 联合类型**：27 种（26 + sync_failed）
- **ClientMessage**：8 种（user_message/dispose_session/tool_result/error_report/ping/proxy_response/ask_user_response/permission_response）
- **ServerMessage**：9 种（tool_call/pi_event/session_ready/error/pong/change/proxy_request/ask_user/permission_request）
- **WS URL**：`/ws?deviceId=xxx&token=xxx`
- **浏览器原生 WebSocket 可用**，无需 polyfill
- **跨域**：WebSocket 不受同源策略限制，当前未配置 `verifyClient`

### B.3 数据库 schema 现状

- **共 23 张表**，单用户场景无需任何 user_id 改造
- Web 端生成稳定 deviceId（localStorage）即可复用所有 device_id 字段

### B.4 路由清单

- **22 个 `/api/*` 端点**，全部走 `authMiddleware`
- **需新增**：`/api/auth/login`、`/api/auth/refresh`、`/api/auth/logout`、`/api/auth/me`

### B.5 静态文件托管现状

- **当前不托管任何静态文件**
- **改造点**：`index.ts` 加 `express.static('./public')` + SPA fallback

### B.6 Docker 部署现状

- **多阶段构建**：builder（node:22-alpine）+ runtime（node:22-alpine）
- **改造点**：加 `web-builder` 阶段，COPY Web 构建产物到 `server/public/`

---

**Roadmap v2 完成。下一步：用户审核 → 写 Phase S11 Spec → 对抗审查 → 编码。**
