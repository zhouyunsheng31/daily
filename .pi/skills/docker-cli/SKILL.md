---
name: docker-cli
description: Docker 容器操控 Skill，让 AI 能查看容器、启停服务、查看日志、运行一次性容器、在容器中执行命令（仅限 6 个安全命令，禁止删除/清理）
version: 1.0.0
---

# docker-cli — Docker 容器操控 Skill

## 一、概述

本 Skill 通过 `child_process.execFile` 调用宿主机 `docker` CLI（不经过 shell，避免命令注入），让 AI 能在**安全沙箱**内操控 Docker 容器。

**入口**：`node .pi/skills/docker-cli/cli.js <command> [args] [--json]`

**输出格式**：
- 默认：人类可读文本（docker 原始输出）
- `--json`：`{ "ok": true, "data": {...} }` 或 `{ "ok": false, "error": "..." }`

**退出码**：
- `0` 成功
- `1` 业务错误（容器不存在、Docker 未装等）
- `2` 参数错误

---

## 二、何时使用

- 用户要求**查看当前运行的容器**
- 用户要求**启动 / 停止某个 docker-compose 服务**
- 用户要求**查看某个服务的日志**
- 用户要求**运行一次性容器**（跑脚本、测试镜像、临时工具）
- 用户要求**在运行中的容器内执行命令**
- AI 需要检查容器健康状态以诊断问题

---

## 三、何时不能使用

- ❌ **删除容器**（`docker rm` / `docker rm -f`）—— 危险，禁止
- ❌ **删除镜像**（`docker rmi` / `docker rmi -f`）—— 危险，禁止
- ❌ **清理系统**（`docker system prune` / `docker volume prune` / `docker network prune`）—— 危险，禁止
- ❌ **修改 Docker 配置**（`docker context` / daemon.json）—— 影响宿主环境
- ❌ **重启 Docker daemon**（`systemctl restart docker`）—— 影响宿主环境
- ❌ **构建镜像**（`docker build`）—— 未在白名单内
- ❌ **推送 / 拉取镜像**（`docker push` / `docker pull`）—— 网络副作用
- ❌ **进入交互式 shell**（`docker attach` / `docker exec -it`）—— AI 无法交互

如遇上述需求，AI 应**向用户提问**，请用户手动操作。

---

## 四、命令清单（共 6 个）

### 4.1 `ps` —— 列出容器

```bash
node .pi/skills/docker-cli/cli.js ps [--json]
```

底层调用：`docker ps --format "{{json .}}"`

输出：
- 文本模式：表格形式列出容器（Name / Image / Status / Ports）
- JSON 模式：`{ "ok": true, "data": { "containers": [...] } }`

### 4.2 `up` —— 启动服务

```bash
node .pi/skills/docker-cli/cli.js up <service> [--file <compose-overlay>] [--json]
```

底层调用：`docker compose -f docker-compose.yml [-f <overlay>] up -d <service>`

参数：
- `<service>`：docker-compose.yml 中定义的服务名（如 `postgres`、`server`）
- `--file <path>`：可选的 overlay compose 文件（如 `docker-compose.ai.yml`），可多次指定

### 4.3 `down` —— 停止服务

```bash
node .pi/skills/docker-cli/cli.js down <service> [--file <compose-overlay>] [--json]
```

底层调用：`docker compose -f docker-compose.yml [-f <overlay>] down <service>`

### 4.4 `logs` —— 查看日志

```bash
node .pi/skills/docker-cli/cli.js logs <service> [--tail <n>] [--json]
```

底层调用：`docker compose logs <service> [--tail N]`

参数：
- `<service>`：服务名
- `--tail <n>`：只显示最后 N 行（默认全部）

### 4.5 `run` —— 运行一次性容器

```bash
node .pi/skills/docker-cli/cli.js run <image> <cmd...> [--json]
```

底层调用：`docker run --rm --network <resolved-network> -v F:/allmylife/event/data:/data:rw <image> <cmd>`

**强制安全策略**：
- 自动加 `--rm`（容器退出后自动清理，不留残渣）
- 自动加 `--network <resolved-network>`：CLI 运行时通过 `docker network ls --filter name=living-dashboard-net` 解析实际网络名（Docker Compose 会加项目前缀，如 `event_living-dashboard-net`），让容器能访问 server / postgres
- 自动挂载 `F:/allmylife/event/data:/data:rw`（数据卷，方便读写宿主机 data 目录）
- **不**支持 `-d` 后台运行（一次性容器必须前台，便于 AI 拿到输出）

### 4.6 `exec` —— 在运行中容器执行命令

```bash
node .pi/skills/docker-cli/cli.js exec <service> <cmd...> [--json]
```

底层调用：`docker compose exec <service> <cmd>`

参数：
- `<service>`：服务名（必须在 docker-compose.yml 中定义且正在运行）
- `<cmd...>`：要在容器内执行的命令及参数（如 `psql -U livingdashboard -c "\\l"`）

---

## 五、安全策略

### 5.1 命令白名单（仅 6 个）

```
ps / up / down / logs / run / exec
```

任何不在白名单内的命令，CLI 直接返回错误（退出码 2），不调用 docker。

### 5.2 危险命令黑名单（永远禁止）

| 命令 | 原因 |
|------|------|
| `docker rm` / `docker rm -f` | 删容器可能丢数据 |
| `docker rmi` / `docker rmi -f` | 删镜像影响其他容器 |
| `docker system prune` | 清理系统级资源 |
| `docker volume prune` | 删数据卷丢数据 |
| `docker network prune` | 删网络影响其他容器 |
| `docker build` | 构建镜像有副作用 |
| `docker push` / `docker pull` | 网络副作用 |
| `docker context` | 修改 Docker 配置 |
| `docker swarm` | 集群操作 |

### 5.3 调用方式

- 用 `child_process.execFile`（**不**用 `child_process.exec`）
- 参数以数组传递，**不**拼成 shell 字符串
- **不**设置 `shell: true`
- 这样即使参数里有 `;` `&&` `$()` 等特殊字符，也不会被 shell 解释为命令注入

### 5.4 run 命令的强制约束

- 必须加 `--rm`：容器退出即清理
- 必须加 `--network living-dashboard-net`：让容器能访问 server / postgres
- 必须挂载 `F:\allmylife\event\data:/data:rw`：统一数据卷
- 不支持 `-d` 后台：一次性容器必须前台运行

### 5.5 Docker 未安装处理

CLI 启动时先 `docker --version` 检查：
- 已装：正常执行
- 未装：
  - `--json` 模式：`{ "ok": false, "error": "Docker not installed" }`，退出码 1
  - 文本模式：`Error: Docker is not installed. Please install Docker Desktop first.`，退出码 1

---

## 六、典型用例

### 6.1 检查当前服务状态

```bash
node .pi/skills/docker-cli/cli.js ps --json
```

### 6.2 启动 postgres 服务

```bash
node .pi/skills/docker-cli/cli.js up postgres --json
```

### 6.3 查看 postgres 最后 50 行日志

```bash
node .pi/skills/docker-cli/cli.js logs postgres --tail 50 --json
```

### 6.4 在 postgres 容器内执行 SQL

```bash
node .pi/skills/docker-cli/cli.js exec postgres psql -U livingdashboard -c "SELECT 1;"
```

### 6.5 跑一个临时 Python 容器处理 data 目录里的文件

```bash
node .pi/skills/docker-cli/cli.js run python:3.11-slim python /data/script.py --json
```

### 6.6 用 overlay compose 启动 AI 部署的服务

```bash
node .pi/skills/docker-cli/cli.js up knowledge-base --file docker-compose.ai.yml --json
```

---

## 七、错误处理

| 场景 | 退出码 | JSON 输出 |
|------|--------|----------|
| 成功 | 0 | `{ "ok": true, "data": {...} }` |
| Docker 未装 | 1 | `{ "ok": false, "error": "Docker not installed" }` |
| 容器/服务不存在 | 1 | `{ "ok": false, "error": "<docker stderr>" }` |
| 参数错误 | 2 | `{ "ok": false, "error": "Usage: ..." }` |
| 未知命令 | 2 | `{ "ok": false, "error": "Unknown command: <cmd>" }` |
