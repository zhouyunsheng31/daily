---
name: life-cli
description: 生活管理 Skill（合并 habit/mood/focus/savings/quickNote），让 AI 能记录习惯打卡、心情、专注会话、储蓄目标、速记。通过 entities API 操作
version: 1.0.0
---

# life-cli — 生活管理 Skill

## 何时使用

- 用户要求**打卡习惯** → `habit checkin`
- 用户要求**查看习惯列表** → `habit ls`
- 用户要求**记录心情** → `mood add`
- 用户要求**查看心情历史** → `mood history`
- 用户要求**开始/停止专注** → `focus start` / `focus stop`
- 用户要求**查看专注统计** → `focus stats`
- 用户要求**查看/创建储蓄目标** → `savings ls` / `savings create`
- 用户要求**记录储蓄变动** → `savings update`
- 用户要求**快速记一条笔记** → `quicknote add`
- 用户要求**查看/搜索速记** → `quicknote ls` / `quicknote search`

## 依赖

- 服务器运行在 `localhost:3456`（可通过 `LD_SERVER_URL` 环境变量覆盖）
- 若服务器设置了 `SERVER_TOKEN`，需通过 `LD_SERVER_TOKEN` 环境变量提供

## 命令清单

入口：`node .pi/skills/life-cli/cli.js <resource> <command> [args] [--json]`

### habit — 习惯

#### `habit ls [--json]`

列出所有习惯。

```bash
node .pi/skills/life-cli/cli.js habit ls --json
```

#### `habit checkin --id <habitId> [--json]`

为指定习惯打卡（创建 `habitCheckin` 实体）。

```bash
node .pi/skills/life-cli/cli.js habit checkin --id habit-001 --json
```

### mood — 心情

#### `mood add --score <n> [--note <text>] [--json]`

记录一条心情（创建 `moodEntry` 实体）。`--score` 为心情分数（整数）。

```bash
node .pi/skills/life-cli/cli.js mood add --score 8 --note "今天天气不错" --json
```

#### `mood history [--limit <n>] [--json]`

查看心情历史（默认 50 条）。

```bash
node .pi/skills/life-cli/cli.js mood history --limit 30 --json
```

### focus — 专注

#### `focus start [--goal <text>] [--json]`

开始一个专注会话（创建 `focusSession` 实体，`action=start`）。

```bash
node .pi/skills/life-cli/cli.js focus start --goal "写文档" --json
```

#### `focus stop [--json]`

停止当前专注会话（创建 `focusSession` 实体，`action=stop`）。

```bash
node .pi/skills/life-cli/cli.js focus stop --json
```

#### `focus stats [--json]`

查看专注统计（拉取所有 `focusSession` 实体，客户端统计 start/stop 数量）。

```bash
node .pi/skills/life-cli/cli.js focus stats --json
```

### savings — 储蓄

#### `savings ls [--json]`

列出所有储蓄目标。

```bash
node .pi/skills/life-cli/cli.js savings ls --json
```

#### `savings create --name <name> --target <amount> [--json]`

创建储蓄目标（创建 `savingsGoal` 实体）。

```bash
node .pi/skills/life-cli/cli.js savings create --name "新电脑" --target 8000 --json
```

#### `savings update --id <id> --amount <amount> [--json]`

记录一笔储蓄变动（创建 `savingsTransaction` 实体）。`--id` 为储蓄目标 ID，`--amount` 为变动金额（正数存入，负数支出）。

```bash
node .pi/skills/life-cli/cli.js savings update --id goal-001 --amount 500 --json
```

### quicknote — 速记

#### `quicknote add --content <text> [--json]`

添加一条速记（创建 `quickNote` 实体）。

```bash
node .pi/skills/life-cli/cli.js quicknote add --content "买牛奶" --json
```

#### `quicknote ls [--limit <n>] [--json]`

列出速记（默认 50 条）。

```bash
node .pi/skills/life-cli/cli.js quicknote ls --json
```

#### `quicknote search <query> [--json]`

按关键词搜索速记（客户端过滤，大小写不敏感）。

```bash
node .pi/skills/life-cli/cli.js quicknote search "牛奶" --json
```

## 数据模型

所有生活管理数据存储为 Entity，按 `type` 区分：

| Entity Type | 用途 | data 字段 |
|-------------|------|-----------|
| `habit` | 习惯定义 | `{name, ...}` |
| `habitCheckin` | 习惯打卡 | `{habitId, timestamp}` |
| `moodEntry` | 心情记录 | `{score, note?, timestamp}` |
| `focusSession` | 专注会话 | `{action: "start"\|"stop", goal?, startTime?, stopTime?}` |
| `savingsGoal` | 储蓄目标 | `{name, target}` |
| `savingsTransaction` | 储蓄变动 | `{goalId, amount, timestamp}` |
| `quickNote` | 速记 | `{content, timestamp}` |

## 输出格式

### 默认（人类可读文本）

```
Mood History (3):
  2026-06-29T10:00  score=8  今天天气不错
  2026-06-28T22:00  score=6  加班
  2026-06-28T14:00  score=7
```

### `--json` 模式

成功：`{ "ok": true, "data": <result> }`
失败：`{ "ok": false, "error": "错误信息" }`

### 退出码

| 退出码 | 含义 |
|--------|------|
| 0 | 成功 |
| 1 | 业务错误（服务器未运行等） |
| 2 | 参数错误（缺少 `--score`、`--content` 等） |

## 设计约束

- **仅依赖 Node.js 内置 API**（`fetch`），不引入任何外部依赖
- **TypeScript strict 模式**，编译为 ESM 模块
- **搜索为客户端过滤**：服务器暂无 `/api/entities/search` 端点
- **所有 fetch 调用 try/catch**，进程永不崩溃
