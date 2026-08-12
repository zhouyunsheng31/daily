# Phase S15 部署文档

> **服务器**：154.37.222.110（root，密码见 .env.server）
> **域名**：shadowshub.xyz（A 记录已指向服务器）
> **部署路径**：`/daily/`（保留主页 `/`）
> **访问入口**：`https://shadowshub.xyz/daily/`

---

## 1. 部署流程

### 1.1 本地准备

```bash
# 1. 确认所有 S15 代码变更已 commit + push
git status
git log --oneline -5

# 2. 确认 .env.prod 已生成（含密钥，不入 git）
cat .env.prod  # 检查字段完整

# 3. 本地构建验证（可选但推荐）
docker build -t event-server:v0.6.0-s15 -f server/Dockerfile .
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d
curl http://localhost:3456/api/health
curl http://localhost:3456/daily/  # 应返回 index.html
curl -I http://localhost:3456/      # 应返回 404
docker compose -f docker-compose.prod.yml --env-file .env.prod down
```

### 1.2 服务器部署

**首次部署**（服务器从未 clone 过仓库）：

```bash
# SSH 登录
ssh root@154.37.222.110

# clone 仓库
cd /root
git clone <repo-url> living-dashboard
cd living-dashboard
```

**后续更新**：

```bash
# 本地 git push 后，服务器 git pull
ssh root@154.37.222.110
cd /root/living-dashboard && git pull
```

**通用部署步骤**：

```bash
# 1. 上传 .env.prod（本地执行）
scp .env.prod root@154.37.222.110:/root/living-dashboard/.env.prod

# 2. 构建并启动
cd /root/living-dashboard
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build

# 3. 等待启动
sleep 15

# 4. 健康检查
curl http://localhost:3456/api/health

# 5. 数据库迁移（幂等可重复执行）
docker compose -f docker-compose.prod.yml --env-file .env.prod exec living-dashboard-server npm run migrate

# 6. 打 tag（便于回滚）
docker tag living-dashboard-server:latest event-server:v0.6.0-s15

# 7. 检查容器状态
docker compose -f docker-compose.prod.yml --env-file .env.prod ps
docker stats --no-stream living-dashboard-server
```

或者用部署脚本（需 sshpass）：

```bash
# 在本地执行
bash deploy/deploy-s15.sh
```

### 1.3 宝塔 Nginx 配置

1. 登录宝塔面板（http://154.37.222.110:8888 或类似）
2. **部署前检查现有 Nginx 配置**：
   ```bash
   cat /www/server/panel/vhost/nginx/shadowshub.xyz.conf
   # 确认没有 regex location 会拦截 /daily/ /api/ /ws
   ```
3. 网站 → shadowshub.xyz → 设置 → 配置文件
4. 在 server 块（80 + 443 两个）中**保留现有 `/` 配置**，追加 4 个 location 块：
   - `location = /daily` → 301 重定向到 `/daily/`
   - `location /daily/` → 反代到 127.0.0.1:3456
   - `location /api/` → 反代到 127.0.0.1:3456
   - `location /ws` → 反代到 127.0.0.1:3456（含 WebSocket 头）
5. 完整配置见 [deploy/nginx-shadowshub.conf](../deploy/nginx-shadowshub.conf)
6. 保存 → 重载 nginx：`nginx -s reload`

### 1.4 SSL 证书

1. 宝塔面板 → 网站 → shadowshub.xyz → SSL
2. 申请 Let's Encrypt 证书（如已有则复用）
3. **注意**：申请前必须**暂时关闭"强制 HTTPS"**重定向，否则 HTTP-01 验证会失败
4. 如已开启强制 HTTPS，可改用 DNS-01 验证（宝塔支持）
5. 证书申请成功后，重新开启"强制 HTTPS"

---

## 2. 验证清单

### 2.1 服务器验证

```bash
# 健康检查
curl http://localhost:3456/api/health
# 应返回 {"status":"ok","timestamp":...}

# Web 端访问（应返回 index.html）
curl -s http://localhost:3456/daily/ | head -10

# 主页保留（应返回 404，不抢占）
curl -I http://localhost:3456/
# 应返回 404

# 容器状态
docker compose -f docker-compose.prod.yml ps
# 应显示 living-dashboard-server 和 living-dashboard-postgres-prod 都 Up

# 资源占用
docker stats --no-stream living-dashboard-server
# MEM USAGE 应 < 1g

# 日志轮转配置
docker inspect living-dashboard-server | grep -A2 max-size
# 应显示 "max-size": "10m", "max-file": "3"
```

### 2.2 线上验证

```bash
# 域名解析
dig shadowshub.xyz +short
# 应返回 154.37.222.110

# HTTPS 健康检查
curl https://shadowshub.xyz/api/health
# 应返回 {"status":"ok",...}

# 主页保留（关键：必须返回现有主页内容）
curl -s https://shadowshub.xyz/ | head -20
# 应是现有主页内容，不是 Living Dashboard 的 index.html

# Web 端访问
curl -I https://shadowshub.xyz/daily/
# 应返回 200 + Content-Type: text/html

# /daily 无尾斜杠重定向
curl -I https://shadowshub.xyz/daily
# 应返回 301 + Location: /daily/

# WSS 连接（用浏览器 DevTools）
# 在 https://shadowshub.xyz/daily/ 页面 console：
# const ws = new WebSocket('wss://shadowshub.xyz/daily/ws?deviceId=test')
# ws.onopen = () => console.log('WSS connected')
# ws.onclose = () => console.log('WSS closed')
```

### 2.3 功能验证

1. 浏览器打开 `https://shadowshub.xyz/daily/`
2. 看到登录页 → 输入密码 `shadowshub2026` → 登录
3. 跳转到画布主页
4. 创建 AIAssistant widget → 发消息 → 收到 AI 回复
5. 创建其他 widget（Calculator / FocusTimer 等）验证

### 2.4 桌面端配置

部署完成后，桌面端需配置新 SERVER_TOKEN：

1. 桌面端打开 → 设置 → 服务器配置
2. 服务器 URL：`https://shadowshub.xyz`
3. SERVER_TOKEN：`<.env.prod 中的 SERVER_TOKEN 值>`
4. 测试连接 → 显示已连接
5. 重启桌面端，验证 WS 连接稳定

---

## 3. 回滚方案

### 3.1 应用层回滚（保留数据库）

```bash
# 1. 验证回滚镜像存在
docker images | grep event-server:v0.5.0-s10

# 2. 如不存在，从 git 旧 tag 重新构建
# git checkout v0.5.0-s10
# docker build -t event-server:v0.5.0-s10 -f server/Dockerfile .

# 3. 执行回滚
docker tag event-server:v0.5.0-s10 living-dashboard-server:latest
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d

# 4. 验证回滚后状态
curl http://localhost:3456/api/health
```

### 3.2 完全卸载

```bash
# 1. 停止并删除容器
docker compose -f docker-compose.prod.yml --env-file .env.prod down -v

# 2. 删除镜像
docker rmi event-server:v0.6.0-s15

# 3. Nginx 移除 4 个 location 块
# 编辑 /etc/nginx/sites-available/aihub
# 删除 location = /daily、location /daily/、location /api/、location /daily/ws
# nginx -t && nginx -s reload
```

### 3.3 数据库回滚

S15 无 schema 变更（沿用 v1），无需回滚 schema。

---

## 4. 故障排查

### 4.1 容器无法启动

```bash
# 查看启动日志
docker compose -f docker-compose.prod.yml logs server
docker compose -f docker-compose.prod.yml logs postgres

# 常见原因：
# - .env.prod 字段缺失或为空
# - 端口 3456 被占用：netstat -tlnp | grep 3456
# - PostgreSQL 数据卷权限问题
```

### 4.2 Nginx 502 Bad Gateway

```bash
# 1. 检查 server 容器是否运行
docker compose -f docker-compose.prod.yml ps

# 2. 检查 server 是否监听 3456
curl -v http://127.0.0.1:3456/api/health

# 3. 检查 Nginx 错误日志
tail -f /var/log/nginx/aihub_error.log
```

### 4.3 WSS 连接失败

```bash
# 1. 检查 Nginx /daily/ws 配置是否正确
nginx -T | grep -A15 "location /daily/ws"

# 2. 检查 WebSocket 握手（注意路径是 /daily/ws，不是 /ws）
curl -v -H "Upgrade: websocket" -H "Connection: Upgrade" -H "Sec-WebSocket-Version: 13" -H "Sec-WebSocket-Key: test" https://shadowshub.xyz/daily/ws

# 3. 检查 server WS 日志
docker compose -f docker-compose.prod.yml logs server | grep -i ws
```

### 4.4 登录失败

```bash
# 1. 检查 .env.prod 中 WEB_ACCESS_PASSWORD 是否设置
docker compose exec living-dashboard-server env | grep WEB_ACCESS_PASSWORD

# 2. 检查 JWT_SECRET 是否设置
docker compose exec living-dashboard-server env | grep JWT_SECRET

# 3. 检查 CORS_ORIGIN 是否正确
docker compose exec living-dashboard-server env | grep CORS_ORIGIN
# 应为 https://shadowshub.xyz
```

### 4.5 主页被抢占

如果 `https://shadowshub.xyz/` 显示 Living Dashboard 而非现有主页：

```bash
# 1. 检查 Nginx 是否有 location / 反代到 server
nginx -T | grep -B2 -A5 "location /"

# 2. 确认 server 端根路径 / 返回 404
curl -I http://127.0.0.1:3456/
# 应返回 404

# 3. 如果 server 端返回 index.html，检查 index.ts 是否还有旧 SPA fallback
grep -n "express.static" server/src/index.ts
# 应只在 /daily 路径下挂载
```

---

## 5. 运维操作

### 5.1 更新 Web 端代码

```bash
# 本地：git push 后
ssh root@154.37.222.110
cd /root/living-dashboard
git pull
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build
# 验证
curl https://shadowshub.xyz/api/health
```

### 5.2 查看日志

```bash
# 实时日志
docker compose -f docker-compose.prod.yml --env-file .env.prod logs -f server

# 最近 100 行
docker compose -f docker-compose.prod.yml --env-file .env.prod logs --tail 100 server

# PostgreSQL 日志
docker compose -f docker-compose.prod.yml --env-file .env.prod logs postgres
```

### 5.3 重启服务

```bash
# 重启 server（不重新构建）
docker compose -f docker-compose.prod.yml --env-file .env.prod restart server

# 完全重启（重新构建）
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build
```

### 5.4 备份数据库

```bash
# 备份
docker compose -f docker-compose.prod.yml --env-file .env.prod exec living-dashboard-postgres-prod pg_dump -U livingdashboard living_dashboard > backup_$(date +%Y%m%d).sql

# 恢复
docker compose -f docker-compose.prod.yml --env-file .env.prod exec -T living-dashboard-postgres-prod psql -U livingdashboard living_dashboard < backup_YYYYMMDD.sql
```
