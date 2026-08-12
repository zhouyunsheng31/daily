---
name: music-cli
description: 音乐播放操控 Skill，让 AI 能查看播放列表、获取播放列表详情、播放指定歌曲。通过 entities API 操作
version: 1.0.0
---

# music-cli — 音乐播放 Skill

## 何时使用

- 用户要求**查看播放列表** → `playlist ls`
- 用户要求**查看某个播放列表的详情** → `playlist get`
- 用户要求**播放某首歌** → `song play`
- AI 需要帮用户控制音乐播放

## 依赖

- 服务器运行在 `localhost:3456`（可通过 `LD_SERVER_URL` 环境变量覆盖）
- 若服务器设置了 `SERVER_TOKEN`，需通过 `LD_SERVER_TOKEN` 环境变量提供

## 命令清单

入口：`node .pi/skills/music-cli/cli.js <playlist|song> <command> [args] [--json]`

### playlist — 播放列表

#### `playlist ls [--json]`

列出所有播放列表（`type=musicPlaylist` 的 Entity）。

```bash
node .pi/skills/music-cli/cli.js playlist ls --json
```

#### `playlist get <playlistId> [--json]`

获取某个播放列表的详细信息。

```bash
node .pi/skills/music-cli/cli.js playlist get pl-001 --json
```

### song — 歌曲

#### `song play --id <songId> [--json]`

播放指定歌曲（创建 `musicPlayAction` 实体，记录播放动作）。

```bash
node .pi/skills/music-cli/cli.js song play --id song-042 --json
```

## 数据模型

| Entity Type | 用途 | data 字段 |
|-------------|------|-----------|
| `musicPlaylist` | 播放列表 | `{name, songs: [...]}` |
| `musicPlayAction` | 播放动作 | `{songId, action: "play", timestamp}` |

## 输出格式

### 默认（人类可读文本）

```
Playlists (2):
  pl-001  我的收藏  (15 songs)
  pl-002  学习音乐  (8 songs)
```

### `--json` 模式

成功：`{ "ok": true, "data": <result> }`
失败：`{ "ok": false, "error": "错误信息" }`

### 退出码

| 退出码 | 含义 |
|--------|------|
| 0 | 成功 |
| 1 | 业务错误（服务器未运行、播放列表不存在等） |
| 2 | 参数错误（缺少 `--id` 等） |

## 设计约束

- **仅依赖 Node.js 内置 API**（`fetch`），不引入任何外部依赖
- **TypeScript strict 模式**，编译为 ESM 模块
- **所有 fetch 调用 try/catch**，进程永不崩溃
- **启动时健康检查**：先 `GET /api/health`，失败立即报错退出
