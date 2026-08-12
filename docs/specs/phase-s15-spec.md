# Phase S15 Spec：生产部署 + HTTPS（shadowshub.xyz/daily/）

> **Roadmap**: [roadmap_server_v2.md §S15](../roadmap_server_v2.md#phase-s15)
> **前置依赖**：S11（Web 基础设施 + 单用户认证）、S12（画布核心）、S13（AI 集成）、S14（动态组件 + 搜索）已全部完成并提交
> **目标**：将 Living Dashboard 部署到 `https://shadowshub.xyz/daily/`，HTTPS + WSS 全链路可用，**保留 shadowshub.xyz 主页未被抢占**

---

## 1. 背景与约束

### 1.1 部署环境（roadmap §5.0 已确认）

| 资源 | 值 | 说明 |
|---|---|---|
| 服务器 IP | `154.37.222.110` | SSH root，凭据在 `.env.server`（不入 git） |
| 域名 | `shadowshub.xyz` | A 记录已指向 154.37.222.110 |
| 部署路径 | `/daily/` | **不抢主页**，主页 `/` 保留现有内容 |
| Web 入口 | `https://shadowshub.xyz/daily/` | 浏览器打开看到登录页 |
| API 入口 | `https://shadowshub.xyz/api/*` | REST API（独立路径，不加 /daily 前缀） |
| WS 入口 | `wss://shadowshub.xyz/ws` | WebSocket（独立路径，不加 /daily 前缀） |
| 服务器规格 | 2h4g15m100gb | 已有 1 个网站 Docker，Living Dashboard 作为第二个 Docker 共存 |

### 1.2 硬约束（roadmap §7.1）

- **不抢主页**：Nginx 只反代 `/daily/` + `/api/` + `/ws`，不反代 `/`；server 静态托管只挂 `/daily/`，根路径 `/` 返回 404
- **不破坏桌面/移动端兼容**：`authMiddleware` 双路径鉴权（JWT cookie + SERVER_TOKEN bearer）
- **单用户模式**：密码存环境变量
- **TypeScript 优先**
- **不下载到 C 盘**：所有构建缓存/数据卷在非 C 盘
- **Docker 部署**：沿用 v1 Docker，Web 产物打入 server 镜像

### 1.3 现状分析

| 项 | 当前状态 | 需变更 |
|---|---|---|
| `server/Dockerfile` | ✅ 三阶段（web-builder + server-builder + runtime） | 无需改 |
| `docker-compose.yml` | ✅ 资源限制 + 日志轮转 + 独立网络 | 改为生产版（端口不暴露，由 Nginx 反代） |
| `server/src/index.ts` 静态托管 | ❌ 挂载在根 `/`，会抢占主页 | 改为挂载 `/daily/`，SPA fallback 仅 `/daily/*` |
| `client/web/vite.config.ts` | ❌ `base` 默认 `/` | 改为 `process.env.VITE_BASE_PATH \|\| '/'`，Docker 构建时设 `/daily/` |
| `client/web/src/main.tsx` BrowserRouter | ❌ 无 basename | 加 `basename={import.meta.env.BASE_URL}` |
| `client/web/src/stores/useAIStore.ts` WS_URL_BASE | ❌ 硬编码 `ws://`，HTTPS 下 WSS 无法连接 | 改为动态协议 `${protocol === 'https:' ? 'wss' : 'ws'}://` |
| `client/web/index.html` favicon | `/favicon.svg` 绝对路径 | 由 Vite base 自动改写，无需手动改 |
| `server/src/db/schema.ts` | ✅ `CREATE TABLE IF NOT EXISTS` 幂等 | 无需改 |
| `server/src/db/migrateFromSqlite.ts` | ✅ `ON CONFLICT (id) DO NOTHING` 幂等 | 无需改 |
| `server/src/ws.ts` WS 鉴权 | ✅ JWT cookie + SERVER_TOKEN 双路径 | 无需改 |
| `server/src/utils/jwt.ts` cookie options | ✅ prod: Secure + SameSite=Strict；dev: Lax | 无需改 |

---

## 2. 实现方案

### 2.1 本地代码变更（7 项）

#### 2.1.1 `client/web/vite.config.ts`：base 路径环境化

```typescript
export default defineConfig({
  base: process.env.VITE_BASE_PATH || '/',  // 新增
  plugins: [react(), tailwindcss()],
  // ... 其他不变
})
```

- 开发模式（`npm run dev`）：`VITE_BASE_PATH` 未设置，base = `/`，访问 `http://localhost:5173/`
- 生产构建（Dockerfile 中 `ENV VITE_BASE_PATH=/daily/`）：base = `/daily/`，所有资源 URL 自动加 `/daily/` 前缀

#### 2.1.2 `client/web/src/main.tsx`：BrowserRouter basename

```tsx
<BrowserRouter basename={import.meta.env.BASE_URL}>
```

- dev：`BASE_URL = '/'`，basename = `/`（即默认）
- prod：`BASE_URL = '/daily/'`，basename = `/daily/`
- React Router v7 自动 strip 末尾 `/`，内部路由 `/login` 实际 URL 为 `/daily/login`

#### 2.1.3 `client/web/src/stores/useAIStore.ts`：WSS 协议修复（关键 bug）

```typescript
const WS_URL_BASE = (import.meta.env.VITE_WS_URL as string | undefined)
  ?? `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}/ws`
```

- 当前代码硬编码 `ws://`，HTTPS 部署后浏览器拒绝 mixed content（`wss://` 被强制降级失败）
- 修复后：`https://shadowshub.xyz` → `wss://shadowshub.xyz/ws`

#### 2.1.4 `server/src/index.ts`：静态托管改挂 `/daily/`

**操作**：删除 `index.ts:203-219` 的旧 `app.use(express.static(webPublicDir))` + 旧根路径 SPA fallback 中间件，**整体替换**为以下代码（仍位于原位置，在 `app.use('/proxy', ...)` 之后、`app.use(errorHandler)` 之前）：

```typescript
// Phase S15：静态托管挂载在 /daily，不抢占根路径 /
// 根路径 / 由 Nginx 现有 location / 配置接管，server 端无需处理；
// server 端未匹配 /daily 的请求自然落入 errorHandler 返回 404
if (fs.existsSync(webPublicDir)) {
  app.use('/daily', express.static(webPublicDir))
  // SPA fallback 仅对 /daily/* 生效（client-side routes like /daily/panel/123）
  app.use('/daily', (req, res, next) => {
    if (req.method !== 'GET') return next()
    const indexPath = path.join(webPublicDir, 'index.html')
    if (fs.existsSync(indexPath)) {
      res.sendFile(indexPath)
    } else {
      next()
    }
  })
  console.log(`[Server] Serving static files at /daily from ${webPublicDir}`)
} else {
  console.log(`[Server] WEB_PUBLIC_DIR not found at ${webPublicDir}, static serving disabled (Electron fork server mode)`)
}
```

**注意**：`/proxy` 路径不受影响（仍走 `app.use('/proxy', authMiddleware, proxyRouter)`，与新 SPA fallback 不冲突）。

#### 2.1.5 `client/web/src/registry/capabilityRegistry.ts`：补 credentials

`capabilityRegistry.ts:52` 的 `fetch('/api/component-capabilities', ...)` 缺 `credentials: 'include'`，与其他 API 调用不一致。生产环境同源 fetch 默认 `same-origin` 仍会发 cookie，但为一致性补充：

```typescript
const resp = await fetch('/api/component-capabilities', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(cap),
  credentials: 'include',  // S15 补充
})
```

#### 2.1.6 `client/web/src/stores/useAIStore.ts`：修复 loadSessionHistory 环境变量名

`useAIStore.ts:1309` 使用 `VITE_API_URL`，但项目其他文件统一使用 `VITE_API_BASE_URL`（adapter.ts:22、client.ts:5、deviceAuth.ts:73）。修改为统一变量名：

```typescript
// S15 修复：VITE_API_URL → VITE_API_BASE_URL，与全局统一
const baseUrl = (import.meta.env.VITE_API_BASE_URL as string | undefined)
  ?? window.location.origin
```

注：生产环境同源场景下 `window.location.origin` 回退仍可工作，此修复是潜在隐患清理。

#### 2.1.7 `server/Dockerfile`：构建时注入 VITE_BASE_PATH（仅 web-builder 阶段）

```dockerfile
# Stage 1: web-builder
FROM node:22-alpine AS web-builder
WORKDIR /web
COPY client/web/package*.json ./
RUN npm ci
COPY client/web/ ./
# S15: 设置 VITE_BASE_PATH=/daily/，构建产物所有资源 URL 加 /daily/ 前缀
ENV VITE_BASE_PATH=/daily/
RUN npm run build
```

**仅 web-builder 阶段变更**，server-builder 阶段和 runtime 阶段完全不变。runtime 阶段 `COPY --from=web-builder /web/dist ./public` 复制的是已构建产物，运行时不需要 `VITE_BASE_PATH` 环境变量。

### 2.2 新建文件（6 项）

#### 2.2.1 `docker-compose.prod.yml`

生产 compose 配置：
- 端口绑定 `127.0.0.1:3456:3456`（不暴露公网，仅 Nginx 反代访问）
- 资源限制 `mem 1g / cpus 1.0`
- 日志轮转 `max-size 10m / max-file 3`
- 独立网络 `living-dashboard-prod-net`（与 dev compose 的 `living-dashboard-net` 隔离）
- 环境变量从 `.env.prod` 读取
- 挂载 `.pi/skills` 只读
- **生产环境只使用 `docker-compose.prod.yml`，不使用 dev 的 `docker-compose.yml`**

#### 2.2.2 `.env.prod.example`（入 git 模板）

包含所有生产必填变量，密钥留空，附生成命令注释。

#### 2.2.3 `.env.prod`（不入 git，实际部署用）

预填以下值：
- `WEB_ACCESS_PASSWORD=shadowshub2026`（用户要求"简单好记"，长度 ≥ 8）
- `JWT_SECRET=`（32+ 字符随机串，部署时 `openssl rand -hex 32` 生成）
- `SERVER_TOKEN=`（32+ 字符随机串，桌面端连接用）
- `CORS_ORIGIN=https://shadowshub.xyz`
- `PI_API_KEY=`（从 .env.local 复制）
- `PI_MODEL=stepfun/step-3.7-flash`
- `PI_API_ENDPOINT=https://api.stepfun.com/step_plan/v1`
- 数据库密码（强随机）

#### 2.2.4 `deploy/nginx-shadowshub.conf`（Nginx 配置模板）

```nginx
# shadowshub.xyz - Living Dashboard 反代配置
# 在宝塔面板 shadowshub.xyz 站点的 nginx 配置中追加以下 location 块
# 注意：保留现有 / 的 server 块（现有主页），仅新增以下 4 个 location

# 0. /daily 无尾斜杠重定向（避免用户输入 shadowshub.xyz/daily 看到错误页面）
location = /daily {
    return 301 /daily/;
}

# 1. Web 端 SPA（路径前缀 /daily/）
location /daily/ {
    proxy_pass http://127.0.0.1:3456;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    # SPA fallback：所有 /daily/* 路径都由 server 返回 index.html
}

# 2. REST API
location /api/ {
    proxy_pass http://127.0.0.1:3456;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}

# 3. WebSocket（用 /daily/ws 避免与服务器现有 aihub /ws location 冲突）
# /daily/ws 反代到 server 的 /ws 端点（proxy_pass 带 /ws 重写路径）
# 前端 WS_URL_BASE 已改为跟随 vite BASE_URL 推导：/daily/ 部署时自动用 /daily/ws
location /daily/ws {
    proxy_pass http://127.0.0.1:3456/ws;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_read_timeout 86400s;  # 24h，防长时间空闲断开
    proxy_send_timeout 86400s;
}
```

#### 2.2.5 `deploy/deploy-s15.sh`（部署脚本）

执行流程：
1. 本地构建镜像 + tag `event-server:v0.6.0-s15`
2. `docker save` + `scp` 传输到服务器（或服务器拉 git 后构建）
3. SSH 执行 `docker compose -f docker-compose.prod.yml up -d`
4. 等待健康检查通过
5. 执行数据库迁移
6. 验证容器状态 + 资源占用

实现策略：**服务器拉 git 后构建**（避免传输大镜像）
- 本地 git push
- SSH 服务器：`cd /root/living-dashboard && git pull`
- 上传 `.env.prod` 到服务器
- 服务器执行 `docker compose -f docker-compose.prod.yml up -d --build`
- `docker tag living-dashboard-server:latest event-server:v0.6.0-s15`

#### 2.2.6 `docs/deployment-s15.md`（部署文档）

含：
- 部署步骤
- 宝塔 Nginx 配置操作指南
- SSL 证书申请（Let's Encrypt via 宝塔）
- 验证清单
- 回滚方案：
  - 回滚到 v0.5.0-s10：`docker tag event-server:v0.5.0-s10 living-dashboard-server:latest && docker compose up -d`
  - 完全卸载：`docker compose -f docker-compose.prod.yml down -v`
- 故障排查

### 2.3 `.gitignore` 更新

追加 `.env.prod`：
```
# Phase S15: 生产环境变量（含密钥）
.env.prod
```

### 2.4 客户端版本号

`client/web/package.json` version：`0.6.0-s11` → `0.6.0-s15`

仅更新 web package.json，其他 package.json（根 / server / desktop）版本号由各自的 release 流程管理。

---

## 3. 部署流程

### 3.1 本地准备

```bash
# 1. 写完所有代码变更
# 2. 本地构建镜像验证
docker build -t event-server:v0.6.0-s15 -f server/Dockerfile .
# 3. 本地启动容器验证
docker compose -f docker-compose.prod.yml up -d
# 4. 验证
curl http://localhost:3456/api/health
curl http://localhost:3456/daily/  # 应返回 index.html
curl -I http://localhost:3456/      # 应返回 404（不抢占主页）
```

### 3.2 服务器部署

**首次部署**（服务器从未 clone 过仓库）：

```bash
# 0. SSH 登录
ssh root@154.37.222.110
# 1. clone 仓库（首次）
cd /root
git clone <repo-url> living-dashboard
cd living-dashboard
```

**后续更新**（已 clone 过）：

```bash
# 1. 本地 git push 到远程
# 2. SSH 服务器
ssh root@154.37.222.110
# 3. 拉取最新代码
cd /root/living-dashboard && git pull
```

**通用部署步骤**（首次和更新都执行）：

```bash
# 4. 上传 .env.prod（本地 scp，仅首次或密钥变更时）
# 在本地执行：
scp .env.prod root@154.37.222.110:/root/living-dashboard/.env.prod

# 5. 在服务器上构建并启动
cd /root/living-dashboard
docker compose -f docker-compose.prod.yml up -d --build
# 6. 等待启动
sleep 15
# 7. 健康检查
curl http://localhost:3456/api/health
# 8. 数据库迁移（首次部署或 schema 变更时执行；幂等可重复执行）
docker compose exec living-dashboard-server npm run migrate
# 9. 打 tag（保留版本历史，便于回滚）
docker tag living-dashboard-server:latest event-server:v0.6.0-s15
# 10. 检查容器状态
docker compose -f docker-compose.prod.yml ps
docker stats --no-stream living-dashboard-server
```

### 3.3 宝塔 Nginx 配置

1. 登录宝塔面板（154.37.222.110）
2. **部署前检查现有 Nginx 配置**，避免 location 冲突：
   ```bash
   # 在服务器上执行
   cat /www/server/panel/vhost/nginx/shadowshub.xyz.conf
   # 或宝塔面板：网站 → shadowshub.xyz → 设置 → 配置文件
   # 确认没有 regex location 会拦截 /daily/ /api/ /ws
   ```
3. 网站 → shadowshub.xyz → 设置 → 配置文件
4. 在 server 块（80 端口 + 443 端口两个）中**保留现有 `/` 配置**，追加 4 个 location 块（`/daily` 重定向、`/daily/`、`/api/`、`/ws`）
5. 保存 → 重载 nginx
6. SSL → 申请 Let's Encrypt 证书（如已有则复用）
   - **注意：申请证书前必须暂时关闭"强制 HTTPS"重定向**，否则 Let's Encrypt HTTP-01 验证会失败
   - 如已开启强制 HTTPS，可改用 DNS-01 验证（宝塔支持）或临时关闭强制 HTTPS
7. 证书申请成功后，重新开启"强制 HTTPS"

### 3.4 线上验证

```bash
# 域名解析
dig shadowshub.xyz
# 健康检查
curl https://shadowshub.xyz/api/health
# 主页保留
curl https://shadowshub.xyz/  # 应返回现有主页，非 Living Dashboard
# Web 端访问
curl -I https://shadowshub.xyz/daily/  # 应返回 200 + index.html
# WSS 连接（用 websocat 或浏览器 console）
# 在浏览器 DevTools 中：
# const ws = new WebSocket('wss://shadowshub.xyz/ws?deviceId=test')
# ws.onopen = () => console.log('connected')
```

---

## 4. 验收标准（roadmap §S15）

### 4.1 本地验收

- [ ] `docker build -t event-server:v0.6.0-s15 .` 成功
- [ ] `docker compose -f docker-compose.prod.yml config` 无错
- [ ] 容器启动后 `curl localhost:3456/api/health` 返回 200
- [ ] `curl localhost:3456/daily/` 返回 index.html
- [ ] `curl -I localhost:3456/` 返回 404（不抢占主页）
- [ ] `docker stats` mem < 1g

### 4.2 线上验收

- [ ] 域名解析：`dig shadowshub.xyz` 返回 154.37.222.110
- [ ] HTTP 健康检查：`curl https://shadowshub.xyz/api/health` 返回 200
- [ ] **主页保留**：`curl https://shadowshub.xyz/` 仍是现有主页内容
- [ ] Web 端：浏览器打开 `https://shadowshub.xyz/daily/` 看到登录页
- [ ] 登录闭环：输入密码登录后跳转到画布主页
- [ ] AI 对话：创建 AIAssistant widget，发消息收到回复
- [ ] WSS：浏览器 DevTools 测试 `wss://shadowshub.xyz/ws` 连接成功，30 分钟不断开
- [ ] 桌面端兼容：桌面端用 SERVER_TOKEN 连接 `wss://shadowshub.xyz/ws` 正常
- [ ] 资源监控：`docker stats` mem < 1g
- [ ] 日志轮转：`docker inspect living-dashboard-server | grep max-size` 显示 10m

### 4.3 移动端（roadmap 标注需重新编译 APK）

- [ ] 在 `client/android/local.properties` 设置 `LIVING_DASHBOARD_WS_URL=wss://shadowshub.xyz/ws`
- [ ] 重新编译 APK 后移动端连接正常
- 此项**不在本次 S15 范围内**（移动端编译需 Android SDK，单独执行）

### 4.4 桌面端配置步骤

部署完成后，用户需在桌面端手动配置新 SERVER_TOKEN：

1. 桌面端打开 → 设置 → 服务器配置（或类似入口）
2. 填入服务器 URL：`https://shadowshub.xyz`（桌面端会自动拼接 `/ws` 和 `/api`）
3. 填入 SERVER_TOKEN：与 `.env.prod` 中 `SERVER_TOKEN` 相同的值
4. 测试连接（应显示已连接）
5. 重启桌面端，验证 WS 连接稳定

注：SERVER_TOKEN 是部署时生成的强随机串，桌面端通过 localStorage 保存（见 `client/web/src/utils/deviceAuth.ts` 的 `setServerToken`）。

---

## 5. 风险与缓解

| 风险 | 概率 | 影响 | 缓解 |
|---|---|---|---|
| Nginx 配置错误抢占 shadowshub.xyz 主页 | 中 | 高 | 只反代 `/daily/` + `/api/` + `/ws`；server 静态托管也只挂 `/daily/`；部署后必须验证 `curl https://shadowshub.xyz/` 仍是现有主页 |
| WSS 在 HTTPS 下被浏览器拒绝（mixed content） | 100% | 高 | §2.1.3 修复 `ws://` → 动态协议选择 |
| BrowserRouter basename 配置错误导致路由 404 | 中 | 高 | 用 `import.meta.env.BASE_URL` 自动跟随 vite base |
| 容器内存超 1g | 低 | 中 | docker-compose.prod.yml 限制 mem 1g + swap 不超过 |
| SSL 证书申请失败（HTTP-01 验证） | 中 | 中 | 部署前关闭强制 HTTPS，或用 DNS-01 验证；详见 §3.3 步骤 6 |
| 桌面端 SERVER_TOKEN 未配置导致连不上 | 中 | 高 | `.env.prod` 中生成强随机 SERVER_TOKEN；§4.4 桌面端配置步骤 |
| SameSite=Strict 在旧浏览器下 WS 握手不发送 cookie | 低 | 中 | 部署后用浏览器 DevTools 验证 WS 握手携带 cookie；如有问题可改为 SameSite=Lax |
| 用户访问 `/daily`（无尾斜杠）看到错误页面 | 高 | 中 | §2.2.4 Nginx 增加 `location = /daily { return 301 /daily/; }` |
| 回滚镜像 v0.5.0-s10 不存在 | 中 | 中 | 部署前 `docker images \| grep v0.5.0-s10` 验证；不存在则从 git 旧版本重新构建 |

---

## 6. 回滚方案

### 6.1 应用层回滚（保留数据库）

**前提**：回滚镜像存在。先验证：
```bash
docker images | grep event-server:v0.5.0-s10
# 如不存在，从 git 旧 tag 重新构建：
# git checkout v0.5.0-s10
# docker build -t event-server:v0.5.0-s10 -f server/Dockerfile .
```

**执行回滚**：
```bash
docker tag event-server:v0.5.0-s10 living-dashboard-server:latest
docker compose -f docker-compose.prod.yml up -d
# 验证回滚后状态
curl http://localhost:3456/api/health
```

### 6.2 完全卸载

```bash
docker compose -f docker-compose.prod.yml down -v
# 删除镜像
docker rmi event-server:v0.6.0-s15
# 宝塔移除 3 个 location 块
```

### 6.3 数据库回滚

S15 无 schema 变更（沿用 v1），无需回滚 schema。

---

## 7. 执行清单

| 步骤 | 负责方 | 状态 |
|---|---|---|
| 写 spec | assistant | 进行中 |
| 对抗审核 spec | assistant | 待办 |
| 本地代码变更（5 项） | assistant | 待办 |
| 新建文件（6 项） | assistant | 待办 |
| 本地 Docker 构建验证 | assistant | 待办 |
| 对抗审核实现 | assistant | 待办 |
| git commit | assistant | 待办 |
| 服务器部署 | assistant（SSH） | 待办 |
| 宝塔 Nginx 配置 | assistant（SSH + 宝塔 API/CLI） | 待办 |
| SSL 证书 | assistant（宝塔） | 待办 |
| 线上运行时验证 | assistant | 待办 |
| 通知用户验收 | assistant | 待办 |
