# Phase S11 Spec：Web 端基础设施 + 单用户认证

> 生成日期：2026-07-05
> Roadmap 依据：[roadmap_server_v2.md](../roadmap_server_v2.md) 第三章 Phase S11（L142-213）
> v1 基线：[roadmap_server_v1.md](../roadmap_server_v1.md)（S0-S6/S9/S10 已完成）
> 架构依据：[architecture_refactor.md](../architecture_refactor.md)
> 状态：Spec v3 已通过二次对抗审查修复（5 致命 + 2 高 全部修复），待编码实现

---

## 一、项目目的

让用户通过网页浏览器打开网址即可使用 Living Dashboard 的完整画布 + AI 能力，无需安装客户端。S11 是 v2 的第一步：打通"打开网址 → 登录 → 看到 Web 端壳子"的最小闭环，为 S12（画布核心）/S13（AI 集成）/S14（动态组件 + 搜索）/S15（生产部署）打基础。

**S11 范围**：
- Web 端项目脚手架（Vite + React 19 + TS）
- 单用户认证（密码登录 + JWT cookie）
- server 静态托管 + SPA fallback
- Dockerfile 多阶段构建（含 Web 产物）
- CORS 白名单 + docker-compose 透传

**S11 不做**：
- 画布核心组件复用（S12）
- 8 个 widget 复用（S12）
- AI 对话 + 工具调用（S13）
- 动态组件 + 搜索 UI（S14）
- 生产部署 + HTTPS（S15）

---

## 二、前置依赖与现状摸底

### 2.1 前置依赖
- v1 S0-S6/S9/S10 已完成 ✅
- v1 S7 Docker 镜像构建配置就绪（未构建生产镜像）⚠️

### 2.2 server 端现状（来自摸底报告）

| 模块 | 现状 | S11 改造点 |
|------|------|-----------|
| `server/src/middleware/auth.ts` | SERVER_TOKEN 单路径鉴权，dev 模式无 token 直接放行；L175-180 已有生产强校验 | 升级为双路径：JWT cookie 优先 + SERVER_TOKEN bearer fallback |
| `server/src/ws.ts` | L247 `path: '/ws'`，L249-270 在 connection 回调里校验 query.token + query.deviceId；无 verifyClient | 升级为双路径：JWT query token 优先 + SERVER_TOKEN fallback |
| `server/src/index.ts` | `createApp()` 工厂模式（L101-155），29 条路由注册顺序明确，L104 `cors()` 无配置，无 express.static，无 SPA fallback | 加 CORS 白名单 + express.static + SPA fallback；注册 auth 路由（顺序敏感） |
| `server/Dockerfile` | 两阶段构建（builder + runtime），无 web-builder 阶段 | 加 web-builder 阶段，COPY Web 构建产物到 `server/public/` |
| `docker-compose.yml` | L47-57 环境变量无 Web 相关 | 透传 `WEB_ACCESS_PASSWORD`/`JWT_SECRET`/`CORS_ORIGIN`/`WEB_PUBLIC_DIR` |
| `.env.example` | 30 行，无 JWT/Web 相关 | 新增 4 个环境变量 |
| `server/package.json` | 无 `jsonwebtoken`/`cookie-parser` 依赖 | 新增 `jsonwebtoken` + `@types/jsonwebtoken` |
| `server/src/routes/` | 23 个路由文件 | 新增 `auth.ts`（4 端点） |

### 2.3 桌面端复用现状（来自摸底报告）

**项目结构特殊**：`client/desktop/` 下**没有** package.json/vite.config/tsconfig，这些在根目录。`client/desktop/` 仅含 `src/`、`electron/`、`public/`、`index.html`、`tsconfig.app.json`、`tsconfig.node.json`。

**`client/web/` 目录完全不存在**，需从零创建。

**S11 复用清单（精简版，仅纯 IDB/搜索/类型，无深依赖）**：

> **关键决策**：S11 不复制 `utils/db.ts`、`utils/iframeProxy.ts`，因为依赖链过深（db.ts → entityMigration/migration/adapter → useRuntimeModeStore；iframeProxy → wsToolHandlers），S11 范围内 Web 端不需要这些功能。推迟到 S12.3 数据层打通时一并处理。

| # | 文件 | 依赖说明 |
|---|------|---------|
| 1 | `utils/deviceAuth.ts` | localStorage + uuid，无外部依赖 |
| 2 | `utils/dbV2.ts` | 纯 IDB，DB_NAME='living-dashboard-v2'，DB_VERSION=11 |
| 3 | `utils/idbTx.ts` | 纯 IDB 事务封装 |
| 4 | `utils/localSearch.ts` | 本地搜索，依赖 searchTokenizer/searchScore |
| 5 | `utils/searchCache.ts` | 搜索缓存 |
| 6 | `utils/searchIndexAdapters.ts` | searchCache 依赖 |
| 7 | `utils/searchTokenizer.ts` | localSearch 依赖 |
| 8 | `utils/searchScore.ts` | localSearch 依赖 |
| 9 | `utils/syncQueue.ts` | 保留 `window.syncLogApi` 守卫（桌面端用），Web 端走 `api/syncLogs.ts` |
| 10 | `utils/contextMenu.ts` | 保留 `window.contextMenuApi` 守卫，Web 端注入 DOM 实现 |
| 11 | `utils/dbStores/` 整个目录 | 纯 IDB store 操作（16 个文件），无 window 依赖 |
| 12 | `types/` 整个目录 | 含 `electron.d.ts`（纯类型声明无运行时） |
| 13 | `api/` 整个目录 | 仅 `client.ts` 改造（见 3.2.1），其他文件原样复用 |

**S11 不复制的文件**（推迟到 S12/S13）：
- `utils/db.ts` — 依赖 `entityMigration.ts`/`migration.ts`/`api/adapter.ts`，S12.3 数据层打通时改造
- `utils/entityMigration.ts` — db.ts 依赖，S12.3 一起处理
- `utils/migration.ts` — db.ts 依赖，S12.3 一起处理
- `api/adapter.ts` — 依赖 `useRuntimeModeStore`，S12.3 改造（移除 store 订阅，改用轮询或事件）
- `utils/iframeProxy.ts` — 依赖 `wsToolHandlers`，S12 复用 HtmlCanvasWidget 时改造
- `utils/wsToolHandlers.ts` — AI 工具处理，S13 AI 集成时处理
- `stores/useAIStore.ts` — 1700+ 行，5 个 Web 端不存在的依赖，S13 处理
- `stores/` 其他 store — S12/S13 按需复制

**1 个需改造文件**（S11.1 范围）：
1. `api/client.ts` — 删除 `window.serverPortApi`（行 9），fetch 加 `credentials:'include'`

**保留守卫不改的文件**：
- `utils/syncQueue.ts` — `window.syncLogApi` 三处调用（行 46、60、74），Web 端走 `api/syncLogs.ts`
- `utils/contextMenu.ts` — `window.contextMenuApi`（行 20），Web 端注入 DOM 实现

### 2.4 关键约束

| 约束 | 说明 |
|------|------|
| 单用户模式 | 不建 users 表，密码存环境变量 `WEB_ACCESS_PASSWORD` |
| 兼容桌面/移动端 | authMiddleware 双路径，桌面端 SERVER_TOKEN 仍可用 |
| Electron 内嵌 server | `client/desktop/electron/main/serverProcess.ts` L102 强制 `SERVER_TOKEN: ''`，S11 不能破坏此场景 |
| TypeScript 优先 | server + Web 端均用 TS |
| 不下载到 C 盘 | npm 缓存路径配置到非 C 盘（已通过 `.npmrc` 配置） |
| git 版本管理 | 所有变更走 git commit |
| Docker 部署 | 沿用 v1 Docker 部署，Web 产物打入 server 镜像 |
| 代码复用策略 | 物理复制（不是软链，不是共享层），roadmap 已决策 |

---

## 三、S11.1 Web 端项目脚手架

### 3.1 任务清单

#### 3.1.1 新建 `client/web/` 目录结构

```
client/web/
├── package.json
├── vite.config.ts
├── tsconfig.json
├── tsconfig.node.json
├── index.html
├── public/
│   └── favicon.svg
└── src/
    ├── main.tsx
    ├── App.tsx
    ├── index.css
    ├── pages/
    │   ├── Login.tsx
    │   └── Home.tsx
    ├── components/
    │   ├── AuthGuard.tsx
    │   └── WebContextMenu.tsx
    ├── api/                # 复用 + 改造
    ├── stores/             # 复用 + 改造
    ├── types/              # 复用
    └── utils/              # 复用 + 改造
```

#### 3.1.2 `client/web/package.json`

```json
{
  "name": "living-dashboard-web",
  "private": true,
  "version": "0.6.0-s11",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "preview": "vite preview",
    "typecheck": "tsc -b --noEmit"
  },
  "dependencies": {
    "react": "^19.2.6",
    "react-dom": "^19.2.6",
    "react-router-dom": "^7.1.0",
    "zustand": "^5.0.14",
    "idb": "^8.0.3",
    "uuid": "^14.0.0",
    "lucide-react": "^1.17.0"
  },
  "devDependencies": {
    "@types/react": "^19.2.0",
    "@types/react-dom": "^19.2.0",
    "@types/uuid": "^10.0.0",
    "@vitejs/plugin-react": "^6.0.1",
    "tailwindcss": "^4.1.0",
    "@tailwindcss/vite": "^4.1.0",
    "typescript": "~6.0.2",
    "vite": "^8.0.12"
  }
}
```

**说明**：
- 不依赖 `electron`/`electron-builder`/`electron-vite`/`@earendil-works/pi-ai`/`@earendil-works/pi-coding-agent`（Web 端无本地 agent）
- 不依赖 `pdfjs-dist`/`katex`（S12 widget 复用时再加）
- react/react-dom/zustand/idb/uuid/lucide-react 版本与桌面端根 package.json 对齐（lucide-react 1.17.0）

#### 3.1.3 `client/web/vite.config.ts`

```ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': {
        target: 'http://localhost:3456',
        changeOrigin: true,
      },
      '/ws': {
        target: 'ws://localhost:3456',
        ws: true,
        changeOrigin: true,
      },
    },
  },
})
```

**说明**：
- `@` alias 与桌面端一致（桌面端 `@` → `client/desktop/src`，Web 端 `@` → `client/web/src`）
- dev server 端口 5173（Vite 默认），代理 `/api` + `/ws` 到 `localhost:3456`
- `strictPort: true` 避免端口漂移导致 CORS_ORIGIN 失效
- 不配 `publicDir`（用默认 `public/`）

#### 3.1.4 `client/web/tsconfig.json` + `tsconfig.node.json`

**`tsconfig.json`**（聚合 references）：
```json
{
  "files": [],
  "references": [
    { "path": "./tsconfig.app.json" },
    { "path": "./tsconfig.node.json" }
  ]
}
```

**`tsconfig.app.json`**（参考桌面端 `client/desktop/tsconfig.app.json`）：
```json
{
  "compilerOptions": {
    "target": "es2023",
    "useDefineForClassFields": true,
    "lib": ["ES2023", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "verbatimModuleSyntax": true,
    "moduleDetection": "force",
    "noEmit": true,
    "jsx": "react-jsx",
    "types": ["vite/client"],
    "paths": {
      "@/*": ["./src/*"]
    },
    "include": ["src"]
  }
}
```

**`tsconfig.node.json`**（vite.config.ts 用）：
```json
{
  "compilerOptions": {
    "target": "es2023",
    "lib": ["ES2023"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "verbatimModuleSyntax": true,
    "moduleDetection": "force",
    "noEmit": true,
    "types": ["node"],
    "include": ["vite.config.ts"]
  }
}
```

**说明**：
- `types` 不含 `node`（Web 端 src 不需要 node 类型，只在 vite.config.ts 用）
- `paths` 与桌面端一致（`@/*` → `./src/*`）
- 不 include `../../shared/types`（桌面端有此 include，Web 端 S11 不需要 shared）

#### 3.1.5 `client/web/index.html`

```html
<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Living Dashboard</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

#### 3.1.6 `client/web/src/main.tsx`

```tsx
import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>,
)
```

#### 3.1.7 `client/web/src/App.tsx`（S11 最小壳子）

```tsx
import { Routes, Route, Navigate } from 'react-router-dom'
import Login from './pages/Login'
import Home from './pages/Home'
import AuthGuard from './components/AuthGuard'

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        path="/"
        element={
          <AuthGuard>
            <Home />
          </AuthGuard>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
```

#### 3.1.8 `client/web/src/index.css`

复用桌面端 `client/desktop/src/index.css` 全文（Tailwind 入口）。

#### 3.1.9 共享代码复用

从 `client/desktop/src/` 物理复制到 `client/web/src/`：

| 源 | 目标 | 改造 |
|----|------|------|
| `types/` 整个目录 | `src/types/` | 无（含 electron.d.ts，纯类型声明无害） |
| `api/` 整个目录 | `src/api/` | 仅 `client.ts` 改造（见 3.2.1），`adapter.ts` 不复制（见 2.3 不复制清单） |
| `utils/dbV2.ts` | `src/utils/dbV2.ts` | 无 |
| `utils/idbTx.ts` | `src/utils/idbTx.ts` | 无 |
| `utils/deviceAuth.ts` | `src/utils/deviceAuth.ts` | 无 |
| `utils/localSearch.ts` | `src/utils/localSearch.ts` | 无 |
| `utils/searchCache.ts` | `src/utils/searchCache.ts` | 无 |
| `utils/searchIndexAdapters.ts` | `src/utils/searchIndexAdapters.ts` | 无 |
| `utils/searchTokenizer.ts` | `src/utils/searchTokenizer.ts` | 无 |
| `utils/searchScore.ts` | `src/utils/searchScore.ts` | 无 |
| `utils/syncQueue.ts` | `src/utils/syncQueue.ts` | 保留守卫不改（见 3.2.3） |
| `utils/contextMenu.ts` | `src/utils/contextMenu.ts` | 保留守卫不改（见 3.2.4） |
| `utils/dbStores/` 整个目录 | `src/utils/dbStores/` | 无 |

**不复制清单**（推迟到 S12/S13，原因见 2.3）：
- `utils/db.ts`、`utils/entityMigration.ts`、`utils/migration.ts`、`api/adapter.ts`（依赖链 → S12.3）
- `utils/iframeProxy.ts`、`utils/wsToolHandlers.ts`（依赖 → S12/S13）
- `stores/` 整个目录（S12/S13 按需复制，含 `useAIStore.ts` 推迟到 S13）
- `components/`、`registry/`、`hooks/`、`__tests__/`、`test/`、`assets/`（S11 不需要）
- `App.tsx`/`main.tsx`/`index.css`（Web 端独立写）

### 3.2 改造文件细节

#### 3.2.1 `api/client.ts` 改造

**原代码**（行 7-10）：
```ts
const API_BASE = import.meta.env.VITE_API_BASE_URL
  ?? (typeof window !== 'undefined' && window.location.protocol === 'file:'
    ? `http://localhost:${window.serverPortApi?.getServerPort() ?? 3456}/api`
    : '/api')
```

**改造后**：
```ts
const API_BASE = import.meta.env.VITE_API_BASE_URL ?? '/api'
```

**说明**：删除 `window.location.protocol === 'file:'` 分支 + `window.serverPortApi` 调用。Web 端永远是 http/https，相对路径 `/api` 即可。

**credentials 改造**：所有 fetch 调用必须包含 `credentials: 'include'`，以便跨域请求携带 cookie。在 `ApiClient` 类的 `request` 方法中统一添加。

#### 3.2.2 `stores/useAIStore.ts` → **不复制，推迟到 S13**

**S11 决策**：不复制 `useAIStore.ts`，原因见 2.3 不复制清单。S13 AI 集成时处理：
- 改造点 1（WS_URL_BASE）：`${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}/ws`
- 改造点 2（loadSessionHistory baseUrl）：`window.location.origin`
- 改造点 3（agentApi）：Web 端强制 cloud 模式，移除 local 分支
- 改造点 4（localServicesApi）：已有 typeof 守卫，Web 端自动跳过

**S11 范围 WS 连接说明**：S11 不实际建立 Web 端 WS 连接（没有 useAIStore），Web 端 WS 连接 + JWT 鉴权验证在 S12.3 数据层打通时验证。S11 仅需 server 端 `verifyClient` 改造完成（见 4.1.6），供后续 S12/S13 使用。桌面端 WS 兼容性测试仍需验证（见 7.2）。

#### 3.2.3 `utils/syncQueue.ts` 改造

**原代码**（行 45-47、59-61、73-75）：
```ts
// appendSyncLog
if (typeof window !== 'undefined' && window.syncLogApi) {
  await window.syncLogApi.append(entry)
}

// readSyncLog
if (typeof window !== 'undefined' && window.syncLogApi) {
  return await window.syncLogApi.read()
}

// rotateSyncLog
if (typeof window !== 'undefined' && window.syncLogApi) {
  await window.syncLogApi.rotate()
}
```

**改造方案**：保留 `window.syncLogApi` 守卫（桌面端仍用），Web 端天然跳过。Web 端 syncLog 通过 `api/syncLogs.ts` 的 `upsertSyncLog` 走服务器 `/api/sync/logs`（S3 已实现），不依赖本地文件日志。

**S11 决策**：不动代码，保留守卫。Web 端 syncLog 走服务器 API（已有），不实现本地 IDB syncLog。

#### 3.2.4 `utils/contextMenu.ts` 改造

**原代码**（行 20-28）：
```ts
const api = window.contextMenuApi
if (!api) {
  console.warn('[contextMenu] window.contextMenuApi not available, falling back')
  if (items.length > 0 && items[0].onClick) {
    await items[0].onClick()
  }
  return
}
```

**改造方案**：Web 端实现基于 DOM 的右键菜单组件 `WebContextMenu.tsx`，并通过 React Context 注入 `window.contextMenuApi = { show: webContextMenuShow }` 兜底。

**S11 决策**：
- S11 范围内 contextMenu 不被实际使用（S12 widget 右键菜单才需要）
- 但 S11.1 任务清单明确要求改造，所以实现最小版本：保留原 fallback 逻辑，新增 Web 端 DOM 实现作为 `window.contextMenuApi` 注入
- 新建 `client/web/src/components/WebContextMenu.tsx`，在 `main.tsx` 中注入 `window.contextMenuApi`

### 3.3 S11.1 验收标准

- [ ] `cd client/web && npm install` 无错
- [ ] `cd client/web && npm run dev` 启动成功，浏览器打开 `http://localhost:5173` 看到登录页（S11.2 实现）
- [ ] `cd client/web && npm run build` 构建成功，生成 `dist/index.html` + `dist/assets/*.js`
- [ ] `cd client/web && npm run typecheck` 无 TS 错误
- [ ] 复制的 13 类文件 TS 编译无错（types/api/utils/dbStores 等）
- [ ] 改造的 client.ts TS 编译无错（删除 window.serverPortApi + 加 credentials:'include'）
- [ ] syncQueue.ts/contextMenu.ts 保留 typeof 守卫，TS 编译无错
- [ ] dev 模式 fetch `/api/health` 走代理成功（返回 `{status:'ok'}`）

---

## 四、S11.2 单用户认证

### 4.1 server 端改造

#### 4.1.1 新增依赖

`server/package.json` dependencies 新增：
```json
"jsonwebtoken": "^9.0.2"
```

devDependencies 新增：
```json
"@types/jsonwebtoken": "^9.0.5"
```

**说明**：不需要 `cookie-parser`，Express 5 内置 `req.cookies` 解析（需验证；若不支持则手动解析 `Cookie` 头）。实际上 Express 5 不内置 cookie 解析，需要 `cookie-parser` 或手动解析。**决策：手动解析**（避免新增依赖），在 authMiddleware 中实现 `parseCookies(req)` 工具函数。

#### 4.1.2 新建 `server/src/utils/jwt.ts`

```ts
import jwt from 'jsonwebtoken'

const COOKIE_NAME = 'access_token'
const TOKEN_EXPIRES_IN = '1d'

export interface JwtPayload {
  authenticated: true
  iat?: number
  exp?: number
}

// S11 单用户模式：固定 payload { authenticated: true }，无参数
// S13 需要扩展时再加 sub/scope 字段
export function signToken(): string {
  const secret = process.env.JWT_SECRET
  if (!secret) {
    throw new Error('JWT_SECRET env required')
  }
  return jwt.sign({ authenticated: true }, secret, {
    algorithm: 'HS256',
    expiresIn: TOKEN_EXPIRES_IN,
  })
}

export function verifyToken(token: string): JwtPayload | null {
  const secret = process.env.JWT_SECRET
  if (!secret) return null
  try {
    return jwt.verify(token, secret, { algorithms: ['HS256'] }) as JwtPayload
  } catch {
    return null
  }
}

export function getCookieName(): string {
  return COOKIE_NAME
}

export function getCookieOptions() {
  const isProd = process.env.NODE_ENV === 'production'
  return {
    httpOnly: true,
    secure: isProd,
    sameSite: isProd ? ('strict' as const) : ('lax' as const),
    maxAge: 86400000, // 1 day in ms
    path: '/',
  }
}

export function parseCookies(cookieHeader: string | undefined): Record<string, string> {
  const cookies: Record<string, string> = {}
  if (!cookieHeader) return cookies
  for (const pair of cookieHeader.split(';')) {
    const [key, ...valueParts] = pair.trim().split('=')
    if (key && valueParts.length > 0) {
      cookies[key.trim()] = valueParts.join('=').trim()
    }
  }
  return cookies
}
```

#### 4.1.2b 新建 `server/src/utils/crypto.ts`（恒定时间比较工具）

```ts
import { timingSafeEqual } from 'node:crypto'

/**
 * 恒定时间字符串比较，防止时序攻击。
 * 长度不等时直接返回 false（会泄露长度信息，但单用户密码场景可接受）。
 */
export function safeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  return timingSafeEqual(Buffer.from(a), Buffer.from(b))
}
```

**说明**：`authMiddleware` 和 `ws.ts` 都从此 import，避免重复定义。ESM 项目必须用 `import`，不能用 `require`。

#### 4.1.3 新建 `server/src/routes/auth.ts`

```ts
import { Router } from 'express'
import { signToken, getCookieName, getCookieOptions } from '../utils/jwt'
import { safeCompare } from '../utils/crypto'

// 拆分为两个 Router：login 免鉴权，其他走全局 authMiddleware
export const authLoginRouter = Router()      // 仅 POST /login
export const authProtectedRouter = Router()  // GET /me, POST /refresh, POST /logout

// POST /api/auth/login - 免鉴权（在 authMiddleware 之前注册）
authLoginRouter.post('/login', (req, res) => {
  const { password } = req.body || {}
  const expected = process.env.WEB_ACCESS_PASSWORD

  if (!expected) {
    return res.status(503).json({
      error: 'WEB_ACCESS_PASSWORD_NOT_CONFIGURED',
      message: 'Server admin has not set WEB_ACCESS_PASSWORD',
    })
  }

  if (typeof password !== 'string' || !safeCompare(password, expected)) {
    return res.status(401).json({
      error: 'INVALID_CREDENTIALS',
      message: 'Password incorrect',
    })
  }

  const token = signToken()
  res.cookie(getCookieName(), token, getCookieOptions())
  return res.json({ authenticated: true })
})

// GET /api/auth/me - 走鉴权（authMiddleware 已挂 req.user）
authProtectedRouter.get('/me', (req, res) => {
  if (req.user?.authenticated) {
    return res.json({ authenticated: true })
  }
  return res.status(401).json({ error: 'NOT_AUTHENTICATED' })
})

// POST /api/auth/refresh - 走鉴权
authProtectedRouter.post('/refresh', (req, res) => {
  if (!req.user?.authenticated) {
    return res.status(401).json({ error: 'NOT_AUTHENTICATED' })
  }
  const token = signToken()
  res.cookie(getCookieName(), token, getCookieOptions())
  return res.json({ authenticated: true })
})

// POST /api/auth/logout - 走鉴权
authProtectedRouter.post('/logout', (req, res) => {
  // clearCookie 必须传与 set 时相同的 sameSite/secure，否则部分浏览器清不掉
  const opts = getCookieOptions()
  res.clearCookie(getCookieName(), { path: opts.path, sameSite: opts.sameSite, secure: opts.secure })
  return res.json({ authenticated: false })
})
```

**关键修复**：
- `password` 比较用 `safeCompare`（恒定时间），不是 `!==`
- `clearCookie` 传 sameSite/secure 与 set 时一致
- 拆分为 `authLoginRouter` + `authProtectedRouter`，配合路由顺序（见 4.1.5）

#### 4.1.4 升级 `server/src/middleware/auth.ts`

> **替换原 auth.ts L1-62 全文**（含原 declare module 块）。

```ts
import { Request, Response, NextFunction } from 'express'
import { verifyToken, parseCookies, getCookieName, getCookieOptions } from '../utils/jwt.js'
import { safeCompare } from '../utils/crypto.js'
import { createError } from './error.js'

declare module 'express-serve-static-core' {
  interface Request {
    deviceId?: string
    user?: { authenticated: true }
  }
}

let devModeWarned = false

/**
 * 判断是否为 Electron fork server 模式（桌面端内嵌 server）。
 * Electron fork 时 ELECTRON_RUN_AS_NODE=1，且不需要 Web 端认证。
 */
function isElectronFork(): boolean {
  return process.env.ELECTRON_RUN_AS_NODE === '1'
}

export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  // 路径 1：JWT cookie（Web 端）—— 必须先检查，因为 Web 端必须走 JWT
  const cookies = parseCookies(req.headers.cookie)
  const jwtToken = cookies[getCookieName()]
  if (jwtToken) {
    const payload = verifyToken(jwtToken)
    if (payload?.authenticated) {
      req.user = { authenticated: true }
      const devId = req.headers['x-device-id']
      if (typeof devId === 'string') {
        req.deviceId = devId
      }
      next()
      return
    }
    // JWT 无效：清除 cookie 并返回 401（不 fallback 到 SERVER_TOKEN，防止 Web 端绕过登录）
    const opts = getCookieOptions()
    res.clearCookie(getCookieName(), { path: opts.path, sameSite: opts.sameSite, secure: opts.secure })
    res.status(401).json({ error: 'INVALID_JWT' })
    return
  }

  // 路径 2：SERVER_TOKEN Bearer（桌面/移动端 fallback）
  const serverToken = process.env.SERVER_TOKEN

  if (!serverToken) {
    // dev 模式（SERVER_TOKEN 空）放行规则：
    // - Electron fork server（桌面端内嵌）：放行（桌面端不需要 Web 认证）
    // - 同源请求（无 Origin 头，curl/桌面端 renderer）：放行
    // - 跨域请求（带 Origin 头，Web 端浏览器）：**拒绝**，强制走 JWT cookie 登录
    //   防止 Web 端 dev 模式未登录绕过鉴权
    const origin = req.headers.origin
    if (origin && !isElectronFork()) {
      // Web 端跨域请求且无 JWT → 拒绝（让前端跳 /login）
      res.status(401).json({ error: 'UNAUTHORIZED', message: 'Login required' })
      return
    }
    if (!devModeWarned && !isElectronFork()) {
      devModeWarned = true
      console.warn('[Auth] WARNING: SERVER_TOKEN not set — running in dev mode. DO NOT use in production.')
    }
    const devId = req.headers['x-device-id']
    if (typeof devId === 'string') {
      req.deviceId = devId
    }
    next()
    return
  }

  const authHeader = req.headers.authorization
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    next(createError(401, 'UNAUTHORIZED', 'Missing or invalid Authorization header'))
    return
  }
  const token = authHeader.slice(7)
  if (!safeCompare(token, serverToken)) {
    next(createError(401, 'UNAUTHORIZED', 'Invalid token'))
    return
  }

  const devId = req.headers['x-device-id']
  if (typeof devId === 'string') {
    req.deviceId = devId
  }
  next()
}
```

**关键修复（对抗审查 v2）**：
- **致命 #4 修复**：dev 模式（SERVER_TOKEN 空）下，Web 端跨域请求（带 Origin 头）必须走 JWT cookie，不再放行。Electron fork server（`ELECTRON_RUN_AS_NODE=1`）和同源请求（curl/桌面端 renderer）仍放行
- **致命 #2 修复**：`isElectronFork()` 判断 `ELECTRON_RUN_AS_NODE=1`，桌面端内嵌 server 不受 Web 端校验影响
- `safeCompare` 从 `../utils/crypto.js` import（ESM 项目显式 .js 后缀），不用 `require`
- `clearCookie` 传 sameSite/secure 与 set 时一致
- `safeCompare` 用于 SERVER_TOKEN 比较（恒定时间，修复 v1 的明文比较 bug）
- 保留原 `createError` 错误格式（与 v1 一致）

#### 4.1.5 注册路由（顺序敏感）

`server/src/index.ts` `createApp()` 内路由注册顺序：

```ts
// 1. CORS（已升级，见 S11.4）
app.use(cors(corsOptions))

// 2. JSON body 解析
app.use(express.json({ limit: '100mb' }))

// 3. 健康检查（免鉴权，已有）
app.get('/api/health', (req, res) => res.json({ status: 'ok', timestamp: Date.now() }))

// 4. auth/login（免鉴权，必须在 authMiddleware 之前）
app.use('/api/auth', authRouter)
// 注意：authRouter 内部 /me /refresh /logout 需要 authMiddleware
// 方案：把 /login 单独拆出，或在 authRouter 内对 /me /refresh /logout 单独挂 authMiddleware
```

**路由顺序细节**（重要）：

由于 `authRouter` 包含 4 个端点，其中 `/login` 免鉴权、`/me` `/refresh` `/logout` 需要鉴权，有两种方案：

**方案 A**：`authRouter` 整体在 `authMiddleware` 之前注册，内部对 `/me` `/refresh` `/logout` 单独挂 `authMiddleware`

**方案 B**：拆分为 `authLoginRouter`（仅 `/login`，免鉴权）+ `authProtectedRouter`（`/me` `/refresh` `/logout`，走全局 `authMiddleware`）

**决策：方案 B**（更清晰，与全局 authMiddleware 一致）：

```ts
// server/src/routes/auth.ts 拆分导出
export const authLoginRouter = Router()  // 仅 /login
export const authProtectedRouter = Router()  // /me /refresh /logout

// server/src/index.ts createApp() 内
app.get('/api/health', ...)  // 免鉴权
app.use('/api/auth', authLoginRouter)  // 免鉴权（仅 /login）
app.use('/api', authMiddleware)  // 全局鉴权
app.use('/api/auth', authProtectedRouter)  // 走鉴权（/me /refresh /logout）
app.use('/api/panels', panelWidgetsRouter)  // 其他路由...
```

#### 4.1.6 WS 鉴权升级（致命缺陷修复版 v2）

**原设计问题**：Spec v1 让 Web 端用 URL query `?token=<JWT>` 鉴权，但 JWT 存在 httpOnly cookie 里 JS 读不到，无法构造 WS URL。整个 Web 端 WS 鉴权链路无法闭环。

**新设计**：用 `verifyClient` 在 WS upgrade 请求阶段从 `Cookie` 头读 httpOnly cookie，**完全弃用 URL query token 方案给 Web 端**。桌面端仍用 URL query `?token=<SERVER_TOKEN>`（兼容）。

**浏览器 WS cookie 行为**（编码阶段必须运行时验证，见 4.3 验收标准）：
- 同源（生产，server 同时托管 Web）：浏览器对 WS upgrade 请求**自动携带 cookie**（含 httpOnly）
- 跨源（dev，Web 5173 → server 3456）：Vite proxy 转发 WS upgrade 时**应透传 Cookie 头**给后端（vite.config.ts `'/ws': { ws: true, changeOrigin: true }` 配置支持，但需运行时验证）

**保留原 ws.ts L216 的 `getServerToken()` 函数**（Spec 不改它）。

`server/src/ws.ts` 改造（替换原 L247-270 的 `wss.on('connection', ...)` 校验逻辑，新增 `verifyClient`）：

```ts
import { verifyToken, parseCookies, getCookieName } from './utils/jwt.js'
import { safeCompare } from './utils/crypto.js'

let devModeWarnedWs = false

function isElectronForkWs(): boolean {
  return process.env.ELECTRON_RUN_AS_NODE === '1'
}

// WebSocketServer 配置加 verifyClient（替换原 L247 `new WebSocketServer({ server, path: '/ws' })`）
const wss = new WebSocketServer({
  server,
  path: '/ws',
  verifyClient: (info, cb) => {
    const req = info.req
    const url = new URL(req.url || '', 'http://localhost')
    const deviceId = url.searchParams.get('deviceId')
    const queryToken = url.searchParams.get('token')
    const origin = req.headers.origin

    // 路径 1：JWT cookie（Web 端）—— 必须先检查
    const cookies = parseCookies(req.headers.cookie)
    const jwtToken = cookies[getCookieName()]
    if (jwtToken) {
      const payload = verifyToken(jwtToken)
      if (payload?.authenticated) {
        if (!deviceId) { cb(false, 401, 'missing deviceId'); return }
        cb(true)
        return
      }
      // JWT 无效：拒绝（让前端跳登录页），不 fallback 到 SERVER_TOKEN
      cb(false, 401, 'invalid jwt')
      return
    }

    // 路径 2：SERVER_TOKEN query token（桌面/移动端 fallback）
    const serverToken = getServerToken()
    if (serverToken) {
      if (!queryToken || !safeCompare(queryToken, serverToken)) {
        console.warn('[WS] Connection rejected: invalid token')
        cb(false, 401, 'invalid token')
        return
      }
    } else {
      // dev 模式（SERVER_TOKEN 空 + 无 JWT cookie）放行规则：
      // - Electron fork server：放行
      // - 同源（无 Origin 头，桌面端 renderer）：放行
      // - 跨域（带 Origin 头，Web 端浏览器）：**拒绝**，强制走 JWT cookie
      if (origin && !isElectronForkWs()) {
        cb(false, 401, 'login required')
        return
      }
      if (!devModeWarnedWs && !isElectronForkWs()) {
        devModeWarnedWs = true
        console.warn('[WS] WARNING: SERVER_TOKEN not set — running in dev mode.')
      }
    }
    if (!deviceId) {
      cb(false, 401, 'missing deviceId')
      return
    }
    cb(true)
  },
})

// connection 回调：删除原 L249-270 的 token/deviceId 校验（已移到 verifyClient），
// 保留原 L272+ 的所有后续逻辑（旧连接替换、clients.set、connectHandlers、ws.on('message') 等）
wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
  const url = new URL(req.url || '', 'http://localhost')
  const deviceId = url.searchParams.get('deviceId')!
  // ↓↓↓ 以下保留原 ws.ts L272-330+ 的所有逻辑（不 return，不跳过）↓↓↓

  // 同一 deviceId 的旧连接替换为新连接（原 L276-287）
  const existing = clients.get(deviceId)
  if (existing && existing.ws.readyState === WebSocket.OPEN) {
    console.log(`[WS] Replacing existing connection for device: ${deviceId}`)
    handleDeviceDisconnect(deviceId)
    try {
      existing.ws.close(1000, 'replaced by new connection')
    } catch {
      // ignore
    }
    clients.delete(deviceId)
  }

  // 注册新连接（原 L289-296）
  const conn: ClientConnection = {
    ws,
    deviceId,
    authenticated: true,
    lastPing: Date.now(),
  }
  clients.set(deviceId, conn)
  console.log(`[WS] Client connected: deviceId=${deviceId}, total=${clients.size}`)

  // 通知连接建立（原 L299-305）
  for (const handler of connectHandlers) {
    try {
      handler(deviceId)
    } catch (err) {
      console.error('[WS] Connect handler error:', err)
    }
  }

  // 消息处理（原 L307+，包括 ping/pong、error_report、tool_result、user_message 等所有消息类型）
  ws.on('message', (raw: Buffer | ArrayBuffer | Buffer[]) => {
    // ... 保留原 ws.ts L307-450+ 的所有消息处理逻辑
  })

  ws.on('close', () => {
    // ... 保留原 ws.ts 的 close 处理逻辑
  })

  ws.on('error', (err) => {
    // ... 保留原 ws.ts 的 error 处理逻辑
  })
})
```

**关键修复（对抗审查 v2）**：
- **致命 #5 修复**：dev 模式（SERVER_TOKEN 空）下，Web 端跨域 WS 连接（带 Origin 头）必须走 JWT cookie，不再放行。Electron fork server 和同源请求仍放行
- **致命 #1 修复**：Web 端 WS 鉴权走 cookie（httpOnly），不走 URL query token
- **高 #1 修复**：connection 回调完整代码示例（保留原 L272+ 所有逻辑，不省略）
- **高 #6 修复**：`safeCompare` 从 `./utils/crypto.js` import
- 桌面端兼容：SERVER_TOKEN query token fallback 保留
- 保留原 `getServerToken()` 函数（L216）

**Web 端 WS 连接 URL**：`ws://localhost:5173/ws?deviceId=<deviceId>`（dev，Vite proxy 转发 cookie）或 `wss://domain.com/ws?deviceId=<deviceId>`（prod，同源带 cookie）。**不需要 token query 参数**，cookie 自动发送。

**运行时验证项（编码阶段必须执行）**：
- [ ] dev 模式 Web 端登录后建立 WS 连接，server 端 verifyClient 打印 `req.headers.cookie` 确认 Vite proxy 透传 Cookie 头
- [ ] 如未透传，需在 vite.config.ts 加 `headers` 配置或改用 query token 方案

#### 4.1.7 环境变量校验（兼容 Electron fork server）

`server/src/index.ts` `main()` 函数开头（L175-180 附近）新增：

```ts
const isElectronFork = process.env.ELECTRON_RUN_AS_NODE === '1'

// 已有：生产环境 SERVER_TOKEN 必填（Electron fork 除外，桌面端内嵌 server 用空 SERVER_TOKEN）
if (process.env.NODE_ENV === 'production' && !process.env.SERVER_TOKEN && !isElectronFork) {
  console.error('[Server] FATAL: NODE_ENV=production but SERVER_TOKEN is empty.')
  process.exit(1)
}

// 新增：生产环境 JWT_SECRET 必填 + 长度 >= 32 字符（Electron fork 除外）
if (process.env.NODE_ENV === 'production' && !isElectronFork) {
  const jwtSecret = process.env.JWT_SECRET
  if (!jwtSecret) {
    console.error('[Server] FATAL: NODE_ENV=production but JWT_SECRET is empty. Required for Web auth.')
    process.exit(1)
  }
  if (jwtSecret.length < 32) {
    console.error(`[Server] FATAL: JWT_SECRET must be at least 32 characters (current: ${jwtSecret.length}). Use: openssl rand -hex 32`)
    process.exit(1)
  }
}

// 新增：CORS_ORIGIN 必填（强制白名单）—— Electron fork 除外（桌面端不需要 Web 认证）
if (!process.env.CORS_ORIGIN && !isElectronFork) {
  console.error('[Server] FATAL: CORS_ORIGIN env required. Set to your Web origin (e.g., http://localhost:5173 for dev, https://your-domain.com for prod).')
  process.exit(1)
}

// 新增：生产环境 WEB_ACCESS_PASSWORD 必填 + 长度 >= 8 字符（Electron fork 除外）
if (process.env.NODE_ENV === 'production' && !isElectronFork) {
  const webPwd = process.env.WEB_ACCESS_PASSWORD
  if (!webPwd) {
    console.error('[Server] FATAL: NODE_ENV=production but WEB_ACCESS_PASSWORD is empty. Required for Web login.')
    process.exit(1)
  }
  if (webPwd.length < 8) {
    console.error(`[Server] FATAL: WEB_ACCESS_PASSWORD must be at least 8 characters (current: ${webPwd.length}).`)
    process.exit(1)
  }
}

if (isElectronFork) {
  console.log('[Server] Running as Electron fork (desktop embedded), skipping Web auth env checks')
}
```

**说明（对抗审查 v2 修复）**：
- **致命 #2 修复**：`isElectronFork = ELECTRON_RUN_AS_NODE === '1'` 时跳过所有 Web 相关环境变量校验，桌面端内嵌 server 不受影响
- `CORS_ORIGIN` 任何环境必填（Electron fork 除外），强制白名单
- `JWT_SECRET` 仅生产必填 + 长度 >= 32 字符（Electron fork 除外）
- `WEB_ACCESS_PASSWORD` 仅生产必填 + 长度 >= 8 字符（Electron fork 除外）
- `SERVER_TOKEN` 仅生产必填（Electron fork 除外，已有逻辑需更新）

**首次启动提醒**：开发者首次 clone 项目后，必须 `cp .env.example .env` 并配置 `CORS_ORIGIN=http://localhost:5173`，否则 server 启动失败。

#### 4.1.8 `createApp()` 参数化（兼容测试 helper）

`server/src/index.ts` `createApp()` 改造为接受可选 options：

```ts
export interface CreateAppOptions {
  /** 覆盖 CORS_ORIGIN 环境变量（测试 helper 传 'http://localhost'） */
  corsOrigin?: string
  /** 覆盖 WEB_PUBLIC_DIR 环境变量（测试 helper 传 '/nonexistent' 跳过静态托管） */
  webPublicDir?: string
  /** 跳过环境变量校验（测试 helper 传 true） */
  skipEnvCheck?: boolean
}

function createApp(options: CreateAppOptions = {}): { app: Express } {
  const corsOrigin = options.corsOrigin ?? process.env.CORS_ORIGIN
  if (!corsOrigin && !options.skipEnvCheck) {
    console.error('[Server] FATAL: CORS_ORIGIN env required.')
    process.exit(1)
  }
  const allowedOrigins = (corsOrigin ?? '').split(',').map((s) => s.trim()).filter(Boolean)

  const corsOptions: cors.CorsOptions = {
    origin: (origin, cb) => {
      if (!origin) return cb(null, true)
      if (allowedOrigins.includes(origin)) return cb(null, true)
      cb(null, false)
    },
    credentials: true,
    allowedHeaders: ['Authorization', 'Content-Type', 'X-Device-Id'],
    methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE'],
  }
  app.use(cors(corsOptions))

  // ... 其他逻辑用 corsOrigin 替代 process.env.CORS_ORIGIN
}
```

**关键决策**：
- 测试 helper（`server/test/helpers/server.ts`）调 `createApp({ corsOrigin: 'http://localhost', skipEnvCheck: true, webPublicDir: '/nonexistent' })`
- 生产 `main()` 调 `createApp()`（无参数，走环境变量）
- 测试 helper 传 `webPublicDir: '/nonexistent'`（fs.existsSync 返回 false，跳过静态托管）

### 4.2 Web 端登录页

#### 4.2.1 `client/web/src/pages/Login.tsx`

```tsx
import { useState, FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'

export default function Login() {
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const navigate = useNavigate()

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ password }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.message || 'Login failed')
      }
      navigate('/', { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <form onSubmit={handleSubmit} className="bg-white p-8 rounded-lg shadow-md w-96">
        <h1 className="text-2xl font-bold mb-6 text-center">Living Dashboard</h1>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="密码"
          className="w-full p-2 border rounded mb-4"
          autoFocus
          required
        />
        {error && <div className="text-red-500 mb-4 text-sm">{error}</div>}
        <button
          type="submit"
          disabled={loading}
          className="w-full bg-blue-500 text-white p-2 rounded hover:bg-blue-600 disabled:opacity-50"
        >
          {loading ? '登录中...' : '登录'}
        </button>
      </form>
    </div>
  )
}
```

#### 4.2.2 `client/web/src/components/AuthGuard.tsx`

```tsx
import { useEffect, useState, ReactNode } from 'react'
import { Navigate } from 'react-router-dom'

type Status = 'checking' | 'authenticated' | 'unauthenticated' | 'network-error'

export default function AuthGuard({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>('checking')

  useEffect(() => {
    let cancelled = false
    let retryCount = 0
    const MAX_RETRY = 2

    const check = () => {
      fetch('/api/auth/me', { credentials: 'include' })
        .then((res) => {
          if (cancelled) return
          if (res.ok) {
            setStatus('authenticated')
          } else if (res.status === 401) {
            // 401 明确未鉴权 → 跳登录
            setStatus('unauthenticated')
          } else {
            // 5xx 等其他错误 → 视为服务器故障，重试
            if (retryCount < MAX_RETRY) {
              retryCount++
              setTimeout(check, 1000 * retryCount)
            } else {
              setStatus('network-error')
            }
          }
        })
        .catch(() => {
          // fetch 抛错 = 网络错误（服务器不可达）→ 重试
          if (cancelled) return
          if (retryCount < MAX_RETRY) {
            retryCount++
            setTimeout(check, 1000 * retryCount)
          } else {
            setStatus('network-error')
          }
        })
    }
    check()

    return () => {
      cancelled = true
    }
  }, [])

  if (status === 'checking') {
    return <div className="min-h-screen flex items-center justify-center">验证中...</div>
  }
  if (status === 'network-error') {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <p className="text-red-500 mb-2">无法连接服务器</p>
          <button onClick={() => window.location.reload()} className="px-4 py-2 bg-blue-500 text-white rounded">
            重试
          </button>
        </div>
      </div>
    )
  }
  if (status === 'unauthenticated') {
    return <Navigate to="/login" replace />
  }
  return <>{children}</>
}
```

**关键修复**：
- 区分 401（明确未鉴权 → 跳登录）和网络错误/5xx（服务器故障 → 重试 2 次 + 显示重试 UI）
- 避免服务器临时故障时被错误跳转到登录页，让用户重新输密码

#### 4.2.3 `client/web/src/pages/Home.tsx`（S11 空白主页）

```tsx
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'

export default function Home() {
  const [loggingOut, setLoggingOut] = useState(false)
  const navigate = useNavigate()

  async function handleLogout() {
    setLoggingOut(true)
    try {
      await fetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'include',
      })
    } finally {
      navigate('/login', { replace: true })
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-4xl mx-auto">
        <div className="flex justify-between items-center mb-8">
          <h1 className="text-3xl font-bold">Living Dashboard Web</h1>
          <button
            onClick={handleLogout}
            disabled={loggingOut}
            className="px-4 py-2 text-sm bg-gray-200 rounded hover:bg-gray-300"
          >
            {loggingOut ? '登出中...' : '登出'}
          </button>
        </div>
        <div className="bg-white p-8 rounded-lg shadow">
          <p className="text-gray-600">
            Phase S11 完成。画布核心（S12）、AI 集成（S13）、动态组件 + 搜索（S14）、生产部署（S15）待后续 Phase。
          </p>
        </div>
      </div>
    </div>
  )
}
```

### 4.3 S11.2 验收标准

- [ ] `POST /api/auth/login` 正确密码返回 200 + Set-Cookie
- [ ] `POST /api/auth/login` 错误密码返回 401
- [ ] `POST /api/auth/login` WEB_ACCESS_PASSWORD 未配置返回 503
- [ ] `GET /api/auth/me` 携带有效 JWT cookie 返回 200 + `{authenticated:true}`
- [ ] `GET /api/auth/me` 无 cookie 返回 401
- [ ] `GET /api/auth/me` 携带过期 JWT cookie 返回 401
- [ ] `POST /api/auth/refresh` 携带有效 cookie 续期成功
- [ ] `POST /api/auth/logout` 清除 cookie
- [ ] authMiddleware 双路径：JWT cookie 优先，SERVER_TOKEN Bearer fallback
- [ ] authMiddleware JWT 无效时清除 cookie + 401
- [ ] authMiddleware 用 `timingSafeEqual` 防 SERVER_TOKEN 时序攻击
- [ ] WS 鉴权双路径：JWT cookie 优先（verifyClient 读 httpOnly cookie），SERVER_TOKEN query token fallback
- [ ] 桌面端用 SERVER_TOKEN 仍能连接 WS
- [ ] Web 端登录页 UI 正常（密码输入框 + 登录按钮）
- [ ] 未登录访问 `/` 自动跳 `/login`
- [ ] 登录成功跳转到空白主页
- [ ] cookie 设置正确（dev: httpOnly + Secure=false + SameSite=Lax；prod: httpOnly + Secure=true + SameSite=Strict）

---

## 五、S11.3 静态托管 + SPA fallback

### 5.1 server 静态托管

`server/src/index.ts` `createApp()` 末尾（在 `errorHandler` 之前）新增：

```ts
import path from 'node:path'
import fs from 'node:fs'

// 静态托管 Web 构建产物
const webPublicDir = options.webPublicDir
  ?? process.env.WEB_PUBLIC_DIR
  ?? path.resolve(process.cwd(), 'public')

if (fs.existsSync(webPublicDir)) {
  app.use(express.static(webPublicDir))
  // SPA fallback：Express 5 不再支持 app.get('*') 通配符，改用中间件
  // 非 /api/* /ws /proxy 的 GET 请求返回 index.html
  app.use((req, res, next) => {
    if (req.method !== 'GET') return next()
    if (req.path.startsWith('/api/') || req.path.startsWith('/ws') || req.path.startsWith('/proxy')) {
      return next()
    }
    const indexPath = path.join(webPublicDir, 'index.html')
    if (fs.existsSync(indexPath)) {
      res.sendFile(indexPath)
    } else {
      next()
    }
  })
  console.log(`[Server] Serving static files from ${webPublicDir}`)
} else {
  console.log(`[Server] WEB_PUBLIC_DIR not found at ${webPublicDir}, static serving disabled (Electron fork server mode)`)
}
```

**关键修复**：
- **Express 5 不支持 `app.get('*')` 通配符**，改用 `app.use((req, res, next) => ...)` 中间件形式
- 加 `req.method !== 'GET'` 守卫，避免 POST/PUT 请求被吞掉
- 通过 `WEB_PUBLIC_DIR` 环境变量控制（默认 `./public`）
- 桌面端 Electron fork server 时（cwd 为 `server/`），`./public` 不存在，静默跳过
- SPA fallback 排除 `/api/*` `/ws` `/proxy`，避免冲突
- 用 `fs.existsSync` 检查避免启动报错

### 5.2 Dockerfile 多阶段构建

`server/Dockerfile` 改造为三阶段：

```dockerfile
# Stage 1: web-builder（构建 Web 产物）
FROM node:22-alpine AS web-builder
WORKDIR /web
# 复制 Web 端 package 文件（package.json + package-lock.json）
# 注意：执行 docker build 前必须先在 client/web/ 跑 npm install 生成 package-lock.json
COPY client/web/package*.json ./
RUN npm ci
# 复制 Web 端源码
COPY client/web/ ./
# 构建
RUN npm run build

# Stage 2: server-builder（编译 server TS）
FROM node:22-alpine AS server-builder
WORKDIR /app
RUN apk add --no-cache python3 make g++
COPY server/package*.json ./
RUN npm ci
COPY server/tsconfig.json ./
COPY server/src ./src
# 注：原 Dockerfile L22 的 `COPY shared ./shared` 删除，因为 shared/ 目录不存在
# 且 server/tsconfig.json 不引用 shared/
RUN npm run build

# Stage 3: runtime
FROM node:22-alpine AS runtime
WORKDIR /app
RUN apk add --no-cache dumb-init python3 make g++
COPY server/package*.json ./
RUN npm ci --omit=dev
COPY --from=server-builder /app/dist ./dist
# 复制 Web 构建产物到 public/
COPY --from=web-builder /web/dist ./public
# 注：原 Spec v1 的 `COPY server/src/db/migrations ./src/db/migrations` 删除，
# 因为 server/src/db/migrations 目录不存在（已用 Glob 验证）
EXPOSE 3456
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/index.js"]
```

**说明**：
- web-builder 阶段独立构建 Web 产物，输出到 `/web/dist`
- runtime 阶段 COPY Web 产物到 `/app/public`
- server 启动时 `WEB_PUBLIC_DIR` 默认 `./public`，自动托管
- 保留 python3/make/g++（docker-migrate.bat 需要 better-sqlite3 编译）
- **执行 docker build 前**：必须先 `cd client/web && npm install` 生成 package-lock.json（npm ci 要求）

### 5.3 `.dockerignore`（防止本地构建产物污染镜像）

新建项目根目录 `.dockerignore`：

```
# Node
**/node_modules
**/dist
**/build
**/.tsbuildinfo

# Web 端构建产物（Docker 内重新构建）
client/web/dist
client/web/node_modules

# 桌面端
client/desktop/dist
client/desktop/node_modules

# 服务器构建产物
server/dist
server/node_modules

# 数据 + 日志
data/
*.log
logs/

# Git + IDE
.git
.gitignore
.vscode
.idea

# 临时文件
*.tmp
tmp-*
e2e/.tmp/

# 文档（镜像不需要）
docs/

# 测试（镜像不需要）
**/__tests__
**/*.test.ts
**/*.spec.ts
server/test
server/vitest.config.ts
server/tsconfig.spec.json
```

**关键决策**：
- 排除所有 `node_modules` + `dist`，强制 Docker 构建时重新 `npm ci` + `npm run build`
- 排除 `data/`（数据库数据）+ `docs/` + 测试文件（减小镜像体积）
- 保留 `shared/`（Phase 14.4 引入的共享类型，server-builder 需要）

### 5.4 本地开发流程

- `client/web/` 跑 `npm run dev`（Vite dev server，端口 5173，代理 /api + /ws 到 3456）
- `server/` 跑 `npm run dev`（tsx watch，端口 3456）
- 两者独立，热更新正常

### 5.5 S11.3 验收标准

- [ ] `cd client/web && npm run build` 生成 `dist/index.html`
- [ ] server 启动时日志 `[Server] Serving static files from .../public`
- [ ] `curl http://localhost:3456/` 返回 index.html
- [ ] `curl http://localhost:3456/api/health` 返回 `{status:'ok'}`（不冲突）
- [ ] `curl http://localhost:3456/nonexistent-route` 返回 index.html（SPA fallback）
- [ ] 桌面端 Electron fork server 启动无错（`./public` 不存在静默跳过）
- [ ] `docker build -f server/Dockerfile .` 成功
- [ ] `docker run -p 3456:3456 <image>` 后 `curl http://localhost:3456/` 返回 index.html

---

## 六、S11.4 CORS 配置 + docker-compose 透传

### 6.1 CORS 白名单

`server/src/index.ts` `createApp()` 内 `cors()` 升级（与 4.1.8 参数化方案对齐）：

```ts
import cors from 'cors'

// 在 createApp(options) 内
const corsOrigin = options.corsOrigin ?? process.env.CORS_ORIGIN
if (!corsOrigin && !options.skipEnvCheck) {
  console.error('[Server] FATAL: CORS_ORIGIN env required.')
  process.exit(1)
}
const allowedOrigins = (corsOrigin ?? '').split(',').map((s) => s.trim()).filter(Boolean)

const corsOptions: cors.CorsOptions = {
  origin: (origin, cb) => {
    // 允许同源请求（origin undefined 时是同源或 curl）
    if (!origin) return cb(null, true)
    if (allowedOrigins.includes(origin)) return cb(null, true)
    cb(null, false)
  },
  credentials: true,
  allowedHeaders: ['Authorization', 'Content-Type', 'X-Device-Id'],
  methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE'],
}
app.use(cors(corsOptions))
```

**关键决策**：
- `CORS_ORIGIN` 必填（未设置时启动失败，roadmap 要求；Electron fork 除外）
- 白名单逗号分隔（如 `http://localhost:5173,https://your-domain.com`）
- `credentials: true`（cookie 跨域必需）
- `allowedHeaders` 显式声明（含 `X-Device-Id`，桌面端用）
- 禁用 `origin: '*'`（与 `credentials:true` 互斥）
- 与 4.1.8 参数化方案对齐：`options.corsOrigin ?? process.env.CORS_ORIGIN`

### 6.2 docker-compose 透传

`docker-compose.yml` server 服务 `environment` 新增：

```yaml
environment:
  # 已有
  NODE_ENV: production
  PORT: 3456
  DATABASE_URL: ...
  SERVER_TOKEN: ${SERVER_TOKEN:-}
  PI_MODEL: ...
  PI_API_KEY: ...
  PI_API_ENDPOINT: ...
  VITE_STEPFUN_API_KEY: ...
  SQLITE_PATH: ...
  # S11 新增
  WEB_ACCESS_PASSWORD: ${WEB_ACCESS_PASSWORD:-}
  JWT_SECRET: ${JWT_SECRET:-}
  CORS_ORIGIN: ${CORS_ORIGIN:-}
  WEB_PUBLIC_DIR: ${WEB_PUBLIC_DIR:-./public}
```

### 6.3 .env.example 更新

`.env.example` 新增：

```bash
# === Phase S11: Web 端认证 ===
# Web 端登录密码（生产必填）
WEB_ACCESS_PASSWORD=

# JWT 签名 secret（生产必填，建议 32+ 字符随机串）
JWT_SECRET=

# CORS 白名单（必填，逗号分隔，禁止用 *）
# 开发：http://localhost:5173
# 生产：https://your-domain.com
CORS_ORIGIN=http://localhost:5173

# Web 构建产物目录（默认 ./public，Docker 构建时打入镜像）
WEB_PUBLIC_DIR=./public
```

### 6.4 S11.4 验收标准

- [ ] `CORS_ORIGIN` 未设置时 server 启动失败 + 明确错误信息
- [ ] 白名单内 Origin 请求被允许（`Access-Control-Allow-Origin: <origin>` + `Access-Control-Allow-Credentials: true`）
- [ ] 白名单外 Origin 请求被拒（无 `Access-Control-Allow-Origin` 头）
- [ ] `curl http://localhost:3456/api/health` 不受 CORS 限制（同源/curl 无 Origin 头）
- [ ] `docker compose config` 显示 4 个新环境变量透传
- [ ] cookie 策略动态化：dev（NODE_ENV != production）→ `Secure=false; SameSite=Lax`；prod → `Secure=true; SameSite=Strict`

---

## 七、Phase S11 总验收标准

### 7.1 功能验收

- [ ] `cd client/web && npm install && npm run dev` 启动成功
- [ ] 浏览器打开 `http://localhost:5173` 看到登录页
- [ ] 输入正确密码（`WEB_ACCESS_PASSWORD`）登录成功，跳转到空白主页
- [ ] 输入错误密码登录失败，显示错误
- [ ] 未登录访问 `/` 自动跳 `/login`
- [ ] 登录后刷新页面，cookie 仍有效（不需要重新登录）
- [ ] 点击登出按钮，跳转到登录页
- [ ] JWT 过期后访问 `/api/auth/me` 返回 401，前端跳 `/login`
- [ ] `POST /api/auth/refresh` 能续期
- [ ] cookie 设置正确（dev: httpOnly + Secure=false + SameSite=Lax；prod: httpOnly + Secure=true + SameSite=Strict）

### 7.2 兼容性验收

- [ ] 桌面端用 SERVER_TOKEN 仍能连接 WS（兼容性）
- [ ] 桌面端用 SERVER_TOKEN Bearer 仍能调 `/api/*`（兼容性）
- [ ] 桌面端 Electron fork server 启动无错（`./public` 不存在静默跳过；`ELECTRON_RUN_AS_NODE=1` 跳过 Web 校验）
- [ ] **dev 模式**：`cd client/desktop && npm run dev` 启动桌面端，验证 server 子进程启动成功（无 CORS_ORIGIN/JWT_SECRET/WEB_ACCESS_PASSWORD 报错）
- [ ] **prod 模式**：桌面端打包后启动 .exe，验证 server 子进程启动成功

### 7.3 安全验收

- [ ] CORS 白名单生效（白名单外 Origin 被拒）
- [ ] `CORS_ORIGIN` 未设置时 server 启动失败
- [ ] `JWT_SECRET` 生产环境未设置时 server 启动失败
- [ ] `WEB_ACCESS_PASSWORD` 生产环境未设置时 server 启动失败
- [ ] authMiddleware 用 `timingSafeEqual` 防 SERVER_TOKEN 时序攻击
- [ ] JWT cookie httpOnly（JS 无法读取）
- [ ] 密码错误返回 401（不区分"用户不存在"和"密码错误"，单用户模式无此问题）

### 7.4 部署验收

- [ ] `docker build -f server/Dockerfile .` 成功（三阶段构建）
- [ ] `docker run -p 3456:3456 <image>` 后 `curl http://localhost:3456/` 返回 index.html
- [ ] `docker run` 后 `curl http://localhost:3456/api/health` 返回 200
- [ ] `docker compose config` 显示新环境变量透传

### 7.5 代码质量验收

- [ ] `cd client/web && npm run typecheck` 无 TS 错误
- [ ] `cd server && npm run build` 无 TS 错误
- [ ] `cd client/web && npm run build` 构建成功
- [ ] 改造文件无 `window.serverPortApi`/`window.agentApi`/`window.syncLogApi`/`window.contextMenuApi` 调用（除保留的 typeof 守卫外）

---

## 八、风险与缓解

| 风险 | 概率 | 影响 | 缓解方案 |
|------|------|------|---------|
| Express 5 cookie 解析 | 中 | 高 | 手动实现 `parseCookies`（不依赖 cookie-parser） |
| JWT secret 泄露 | 低 | 高 | 环境变量 + 1 天有效期 + httpOnly cookie |
| CORS 配置错误导致 cookie 不发送 | 中 | 高 | 显式 `credentials:true` + 白名单 origin（不用 `*`） |
| Docker 镜像过大 | 低 | 低 | 多阶段构建 + `npm ci --omit=dev` + sourcemap 关闭 |
| 桌面端兼容性破坏 | 低 | 高 | authMiddleware 双路径 + WS 双路径 + Electron fork server（`ELECTRON_RUN_AS_NODE=1`）跳过 Web 校验 |
| Web 端构建产物路径错误 | 中 | 中 | `WEB_PUBLIC_DIR` 环境变量 + `fs.existsSync` 检查 |
| SameSite=Strict 导致登录后跳转无 cookie | 低 | 中 | 登录响应 Set-Cookie 后前端用 `navigate` 跳转，不是外部链接 |
| **Vite proxy 转发 WS upgrade 时不透传 Cookie 头** | **中** | **高** | **编码阶段必须运行时验证 verifyClient 读到 cookie；如未透传，需在 vite.config.ts 加 `headers` 配置或改用 query token 方案** |
| S15 多子域部署时 CORS origin 不支持通配符 | 低 | 中 | S11 单域场景 OK；S15 多子域时需支持 `*.example.com` 通配符 origin |
| S15 多子域部署时 cookie 缺 domain 字段 | 低 | 中 | S11 单域场景 OK；S15 多子域时需补 domain 字段 |
| SERVER_TOKEN Bearer fallback Web 端滥用 | 低 | 低 | SERVER_TOKEN 仅服务端持有，Web 端 JS 无法获取 |

---

## 九、对抗审查清单

Spec 对抗审查需检查：

1. **路由顺序正确性**：`/api/auth/login` 免鉴权，`/me` `/refresh` `/logout` 走鉴权
2. **JWT 安全性**：HS256 + 1 天有效期 + httpOnly cookie + Secure + SameSite
3. **双路径鉴权正确性**：JWT cookie 优先，SERVER_TOKEN Bearer fallback，dev 模式放行
4. **WS 鉴权正确性**：JWT cookie 优先（verifyClient 读 httpOnly cookie），SERVER_TOKEN query token fallback
5. **CORS 严格性**：`credentials:true` + 白名单 origin（不用 `*`）+ `CORS_ORIGIN` 必填
6. **静态托管安全性**：SPA fallback 排除 `/api/*` `/ws` `/proxy`
7. **环境变量校验**：生产环境 `JWT_SECRET`/`WEB_ACCESS_PASSWORD`/`SERVER_TOKEN` 必填，`CORS_ORIGIN` 任何环境必填
8. **桌面端兼容性**：SERVER_TOKEN 仍可用，Electron fork server 不受影响
9. **Docker 构建正确性**：三阶段构建，Web 产物 COPY 到 `public/`
10. **代码复用正确性**：14 个文件物理复制，4 个文件改造点准确
11. **timingSafeEqual**：SERVER_TOKEN 比较用恒定时间
12. **cookie path**：所有 cookie 设置 `path: '/'`，避免路径限制

---

## 十、文件清单（执行用）

### 10.1 新建文件

| 文件 | 说明 |
|------|------|
| `client/web/package.json` | Web 端依赖 |
| `client/web/vite.config.ts` | Vite 配置 |
| `client/web/tsconfig.json` | TS 聚合 |
| `client/web/tsconfig.app.json` | TS app 配置 |
| `client/web/tsconfig.node.json` | TS node 配置 |
| `client/web/index.html` | 入口 HTML |
| `client/web/public/favicon.svg` | 图标 |
| `client/web/src/main.tsx` | React 入口 |
| `client/web/src/App.tsx` | 路由 + AuthGuard |
| `client/web/src/index.css` | Tailwind 入口 |
| `client/web/src/pages/Login.tsx` | 登录页 |
| `client/web/src/pages/Home.tsx` | 空白主页 |
| `client/web/src/components/AuthGuard.tsx` | 鉴权守卫（区分 401 与网络错误，重试 2 次） |
| `client/web/src/components/WebContextMenu.tsx` | Web 右键菜单 |
| `server/src/utils/jwt.ts` | JWT 工具（signToken/verifyToken/getCookieOptions/parseCookies） |
| `server/src/utils/crypto.ts` | safeCompare 恒定时间比较（防时序攻击） |
| `server/src/routes/auth.ts` | auth 路由（拆分为 authLoginRouter + authProtectedRouter） |
| `.dockerignore` | 排除本地 node_modules/dist 防止污染 Docker 镜像 |

### 10.2 复制文件（从 `client/desktop/src/` 到 `client/web/src/`）

- `types/` 整个目录
- `api/` 整个目录（client.ts 改造）
- `utils/db.ts`、`utils/dbV2.ts`、`utils/idbTx.ts`、`utils/deviceAuth.ts`、`utils/iframeProxy.ts`
- `utils/localSearch.ts`、`utils/searchCache.ts`、`utils/searchIndexAdapters.ts`、`utils/searchTokenizer.ts`、`utils/searchScore.ts`
- `utils/syncQueue.ts`（保留守卫，不改）
- `utils/contextMenu.ts`（保留守卫，Web 端注入 contextMenuApi）
- `utils/dbStores/` 整个目录

**不复制** `stores/useAIStore.ts`（推迟到 S13，原因见 3.2.2）

### 10.3 改造文件

| 文件 | 改造点 |
|------|--------|
| `client/web/src/api/client.ts` | 删除 `window.serverPortApi`，简化 API_BASE，fetch 加 `credentials:'include'` |
| `server/src/middleware/auth.ts` | 双路径鉴权 + JWT cookie 解析 + timingSafeEqual |
| `server/src/ws.ts` | WS 鉴权双路径（verifyClient + cookie） |
| `server/src/index.ts` | createApp 参数化 + CORS 白名单 + auth 路由注册 + 静态托管 + SPA fallback（Express 5 中间件形式）+ 环境变量校验 |
| `server/Dockerfile` | 三阶段构建（web-builder + server-builder + runtime） |
| `docker-compose.yml` | 透传 4 个新环境变量 |
| `.env.example` | 新增 4 个环境变量 |
| `server/package.json` | 新增 jsonwebtoken + @types/jsonwebtoken |

---

## 十一、执行顺序

1. **S11.1 脚手架**（先做，因为 S11.3 Dockerfile 依赖 client/web/ 存在）
   - 创建 `client/web/` 目录 + 配置文件
   - 复制 14 个文件
   - 改造 4 个文件
   - 验证：`npm install` + `npm run typecheck` + `npm run build`

2. **S11.2 认证**（server 端 + Web 端）
   - 新增 server 依赖
   - 新建 `server/src/utils/jwt.ts` + `server/src/routes/auth.ts`
   - 改造 `auth.ts` + `ws.ts` + `index.ts`
   - 新建 Web 端 Login.tsx + AuthGuard.tsx + Home.tsx
   - 验证：curl 测试 + 浏览器测试

3. **S11.3 静态托管 + Dockerfile**
   - 改造 `index.ts` 加 express.static + SPA fallback
   - 改造 `Dockerfile` 三阶段
   - 验证：curl + docker build + docker run

4. **S11.4 CORS + docker-compose**
   - 改造 `index.ts` CORS 配置
   - 改造 `docker-compose.yml` + `.env.example`
   - 验证：CORS 测试 + docker compose config

5. **对抗审查 + 运行时验证**
   - adversarial-review skill
   - 全部验收标准跑一遍

6. **git commit**

---

**Spec 完成。下一步：对抗审查 Spec → 编码实现。**
