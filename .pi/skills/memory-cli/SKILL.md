---
name: memory-cli
description: 长期记忆操作 Skill，让 AI 能保存/列出/更新/删除/搜索长期记忆条目（memory entities）。记忆按面板独立存储，多端共享
version: 1.0.0
---

# memory-cli — 长期记忆 Skill

## 何时使用

- 用户说"**记住这个**"、"**帮我记一下**" → `save`
- 用户要求**查看之前记了什么** → `list`
- 用户要求**修改某条记忆** → `update`
- 用户要求**删除某条记忆** → `delete`
- 用户要求**搜索记忆**（按关键词） → `search`
- AI 需要存取用户的长期偏好、事实、备忘

## 依赖

- 服务器运行在 `localhost:3456`（可通过 `LD_SERVER_URL` 环境变量覆盖）
- 若服务器设置了 `SERVER_TOKEN`，需通过 `LD_SERVER_TOKEN` 环境变量提供

## 命令清单

入口：`node .pi/skills/memory-cli/cli.js <command> [args] [--json]`

### `save --content <text> [--type <type>] [--json]`

保存一条记忆。`--type` 为可选的记忆子类型（如 `note`、`task`、`idea`、`fact`）。

```bash
node .pi/skills/memory-cli/cli.js save --content "用户偏好深色主题" --type fact --json
```

### `list [--type <type>] [--limit <n>] [--json]`

列出记忆。`--type` 过滤子类型，`--limit` 限制返回数量（默认 50）。

```bash
node .pi/skills/memory-cli/cli.js list --json
node .pi/skills/memory-cli/cli.js list --type task --limit 10 --json
```

### `update <id> --content <text> [--json]`

更新某条记忆的内容。

```bash
node .pi/skills/memory-cli/cli.js update mem-123 --content "更新后的内容" --json
```

### `delete <id> [--json]`

删除某条记忆。

```bash
node .pi/skills/memory-cli/cli.js delete mem-123 --json
```

### `search <query> [--limit <n>] [--json]`

按关键词搜索记忆（客户端过滤，检查记忆内容是否包含查询词，大小写不敏感）。

```bash
node .pi/skills/memory-cli/cli.js search "主题偏好" --json
```

## 数据模型

每条记忆存储为 `type=memory` 的 Entity，`data` 字段结构：

```json
{
  "content": "记忆文本内容",
  "type": "note|task|idea|fact",
  "timestamp": 1782712345678
}
```

## 输出格式

### 默认（人类可读文本）

```
Memories (3):
  mem-001 [fact]  用户偏好深色主题
  mem-002 [note]  明天开会
  mem-003         买菜清单
```

### `--json` 模式

成功：`{ "ok": true, "data": <result> }`
失败：`{ "ok": false, "error": "错误信息" }`

### 退出码

| 退出码 | 含义 |
|--------|------|
| 0 | 成功 |
| 1 | 业务错误（服务器未运行、实体不存在等） |
| 2 | 参数错误（缺少 `--content` 等） |

## 设计约束

- **仅依赖 Node.js 内置 API**（`fetch`），不引入任何外部依赖
- **TypeScript strict 模式**，编译为 ESM 模块
- **搜索为客户端过滤**：服务器暂无 `/api/entities/search` 端点，CLI 拉取全部记忆后本地过滤
- **所有 fetch 调用 try/catch**，进程永不崩溃
