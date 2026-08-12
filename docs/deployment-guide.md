# Daily 部署指南

> 配套：[developer-guide.md](developer-guide.md)

本文档说明如何将 Daily 部署到生产环境，涵盖 Docker、环境变量、数据库、Nginx、HTTPS/WSS。

---

## 1. 部署架构

```
                    ┌─────────────┐
   用户浏览器 ──HTTPS──▶  Nginx  ──┼──▶ 静态前端（/daily/*）
                    └──────┬──────┘  └──▶ Node Server:3456（/api/* + WS）
                           │
                    ┌──────▼──────┐
                    │ PostgreSQL  │
                    └─────────────┘
```

- **Nginx**：反向代理 + TLS 终止 + WebSocket 升级 + 静态前端托管
- **Node Server**：Express HTTP API + WebSocket（同端口 3456）
- **PostgreSQL**：生产数据库（也可用 SQLite 单机部署）

---

## 2. Docker 部署（推荐）

### 2.1 docker-compose.yml

```yaml
version: '3.8'

services:
  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: daily
      POSTGRES_USER: daily
      POSTGRES_PASSWORD: ${DB_PASSWORD:-change-me-in-prod}
    volumes:
      - daily-db:/var/lib/postgresql/data
    restart: unless-stopped
    healthcheck:
      test: ['CMD-SHELL', 'pg_isready -U daily']
      interval: 10s
      timeout: 5s
      retries: 5

  server:
    build:
      context: .
      dockerfile: Dockerfile
    environment:
      DB_DRIVER: postgres
      DATABASE_URL: postgresql://daily:${DB_PASSWORD}@db:5432/daily
      CORS_ORIGIN: https://daily.example.com
      JWT_SECRET: ${JWT_SECRET}
      WEB_ACCESS_PASSWORD: ${WEB_ACCESS_PASSWORD}
      SERVER_TOKEN: ${SERVER_TOKEN}
      PORT: 3456
      NODE_ENV: production
      WEB_PUBLIC_DIR: /app/public
    depends_on:
      db:
        condition: service_healthy
    ports:
      - '3456:3456'
    volumes:
      - ./client/web/dist:/app/public:ro
    restart: unless-stopped

volumes:
  daily-db:
```

### 2.2 Dockerfile

```dockerfile
FROM node:22-alpine AS builder

WORKDIR /app
# 后端
COPY server/package*.json ./server/
RUN cd server && npm ci

# 前端
COPY client/web/package*.json ./client/web/
RUN cd client/web && npm ci

COPY . .
RUN cd client/web && npm run build
RUN cd server && npx tsc --noEmit

FROM node:22-alpine
WORKDIR /app
COPY --from=builder /app/server/node_modules ./node_modules
COPY --from=builder /app/server/dist ./dist
COPY --from=builder /app/client/web/dist ./public
EXPOSE 3456
CMD ["node", "dist/index.js"]
```

### 2.3 启动

```bash
# 生成密钥
export JWT_SECRET=$(openssl rand -hex 32)
export SERVER_TOKEN=$(openssl rand -hex 24)
export WEB_ACCESS_PASSWORD="your-strong-password"
export DB_PASSWORD=$(openssl rand -hex 16)

docker compose up -d
```

---

## 3. 环境变量

### 3.1 必填（生产）

| 变量 | 说明 | 示例 |
|---|---|---|
| `DB_DRIVER` | 数据库驱动 | `postgres`（生产）/ `sqlite`（开发） |
| `DATABASE_URL` | PG 连接串（DB_DRIVER=postgres 时） | `postgresql://user:pass@host:5432/daily` |
| `CORS_ORIGIN` | 允许的 Web 源（逗号分隔白名单） | `https://daily.example.com` |
| `JWT_SECRET` | JWT 签名密钥，≥32 字符 | `openssl rand -hex 32` |
| `WEB_ACCESS_PASSWORD` | Web 登录密码 fallback，≥8 字符 | `your-password` |
| `SERVER_TOKEN` | 服务间 Bearer token | `openssl rand -hex 24` |
| `NODE_ENV` | 设为 `production` 启用强制校验 | `production` |
| `WEB_PUBLIC_DIR` | 前端静态文件目录 | `/app/public` 或 `public` |

### 3.2 可选

| 变量 | 说明 | 默认 |
|---|---|---|
| `PORT` | server 监听端口 | `3456` |
| `VITE_STEPFUN_API_KEY` | stepfun AI API key（pi agent） | - |
| `ELECTRON_RUN_AS_NODE` | Electron fork 模式（桌面端内嵌，跳过 Web 校验） | - |

### 3.3 生产强制校验

`NODE_ENV=production` 时，server 启动会检查：
- `JWT_SECRET` 非空且 ≥32 字符
- `WEB_ACCESS_PASSWORD` 非空且 ≥8 字符
- `SERVER_TOKEN` 非空
- `CORS_ORIGIN` 非空

任一不满足直接 `process.exit(1)`，拒绝启动。

---

## 4. 数据库配置

### 4.1 PostgreSQL（生产）

```bash
# 创建数据库和用户
psql -U postgres -c "CREATE USER daily WITH PASSWORD 'your-password';"
psql -U postgres -c "CREATE DATABASE daily OWNER daily;"

# 授权
psql -U postgres -c "GRANT ALL PRIVILEGES ON DATABASE daily TO daily;"
```

schema 在 server 启动时自动初始化（`initializeSchema()` 用 `CREATE TABLE IF NOT EXISTS` 幂等执行），无需手动迁移。

### 4.2 SQLite（开发）

设置 `DB_DRIVER=sqlite`，数据文件在 `server/data/daily.db`，自动创建。

### 4.3 备份

```bash
# PG 备份
pg_dump -U daily -d daily > daily-backup-$(date +%F).sql

# PG 恢复
psql -U daily -d daily < daily-backup-2026-07-08.sql
```

---

## 5. Nginx 配置

### 5.1 反向代理 + WebSocket

```nginx
server {
    listen 80;
    server_name daily.example.com;
    # HTTP 重定向到 HTTPS
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name daily.example.com;

    ssl_certificate     /etc/letsencrypt/live/daily.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/daily.example.com/privkey.pem;
    ssl_protocols       TLSv1.2 TLSv1.3;
    ssl_ciphers         HIGH:!aNULL:!MD5;

    # 静态前端（也可由 server 在 /daily 托管，二选一）
    root /var/www/daily-dist;
    index index.html;

    # SPA fallback
    location / {
        try_files $uri $uri/ /index.html;
    }

    # API 反向代理
    location /api/ {
        proxy_pass http://127.0.0.1:3456;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # WebSocket 升级
    location / {
        proxy_pass http://127.0.0.1:3456;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_read_timeout 86400s;  # WS 长连接
    }
}
```

### 5.2 静态托管方式选择

两种方式：
1. **Nginx 托管前端**（推荐）：前端 dist 放 Nginx，`/api` 反代到 server
2. **Server 托管前端**：前端 dist 放 `server/public/`，server 在 `/daily` 路径托管，Nginx 全量反代

方式 1 性能更好（Nginx 静态文件服务优化），方式 2 配置更简单（单进程）。

---

## 6. HTTPS / WSS 配置

### 6.1 Let's Encrypt 证书

```bash
# 安装 certbot
apt install certbot python3-certbot-nginx

# 申请证书（自动修改 Nginx 配置）
certbot --nginx -d daily.example.com

# 自动续期（certbot 默认装好 systemd timer）
certbot renew --dry-run
```

### 6.2 WebSocket 安全

生产环境 WS 必须走 WSS（即 WS over TLS）：
- Nginx 监听 443，`proxy_set_header Upgrade $http_upgrade` + `Connection "upgrade"`
- 前端连接用 `wss://daily.example.com`（自动由 `https://` 页面发起）
- `CORS_ORIGIN` 设为 `https://daily.example.com`（与前端同源）

### 6.3 Cookie 安全

JWT cookie 在生产环境自动启用 `secure: true`（仅 HTTPS 传输）+ `sameSite: 'lax'`。确保 `CORS_ORIGIN` 与前端实际域名完全一致，否则 cookie 无法携带。

---

## 7. 前端构建

```bash
cd client/web
npm ci
npm run build    # 产物在 client/web/dist
```

将 `dist/` 内容：
- 方式 1：复制到 Nginx 静态目录 `/var/www/daily-dist/`
- 方式 2：复制到 `server/public/`（server 启动时自动在 `/daily` 托管）

Vite 构建时 `VITE_API_BASE_URL` 默认 `/api`（相对路径），由 Nginx 反代到 server。

---

## 8. 健康检查与监控

### 8.1 健康检查端点

```bash
curl https://daily.example.com/api/health
# { "status": "ok", "timestamp": 1783000000000 }
```

`/api/health` 免鉴权，可用于负载均衡健康检查。

### 8.2 日志

server 日志输出到 stdout/stderr，Docker 部署用 `docker logs`：
```bash
docker compose logs -f server
```

关键启动日志：
- `[server-boot]` 启动阶段耗时
- `[Schema] ... schema initialized` 数据库初始化
- `[Server] Daily API running on http://localhost:3456` 就绪
- `[PiBridge] initialized successfully` AI 就绪

---

## 9. 升级与回滚

### 9.1 滚动升级

```bash
git pull
cd client/web && npm ci && npm run build
cd ../../server && npm ci
docker compose build server
docker compose up -d server
```

schema 用幂等 DDL，升级时自动补列，无需停机迁移。

### 9.2 回滚

```bash
git checkout <previous-tag>
docker compose build server
docker compose up -d server
```

如需回滚数据库（schema 不向后兼容时），用备份恢复：
```bash
psql -U daily -d daily < daily-backup-YYYY-MM-DD.sql
```

---

## 10. 单机简易部署（无 Docker）

适合个人/小规模：

```bash
# 1. 构建
cd client/web && npm ci && npm run build
cp -r dist/* /var/www/daily/

# 2. server
cd ../../server && npm ci
npx tsc
export NODE_ENV=production
export DB_DRIVER=sqlite
export CORS_ORIGIN=https://daily.example.com
export JWT_SECRET=$(openssl rand -hex 32)
export WEB_ACCESS_PASSWORD=your-password
export SERVER_TOKEN=$(openssl rand -hex 24)
export WEB_PUBLIC_DIR=/var/www/daily
node dist/index.js

# 3. 用 systemd 或 pm2 守护
pm2 start dist/index.js --name daily-server
```
