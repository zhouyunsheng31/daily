---
name: canvas-cli
description: 画布操控 Skill，让 AI 能查看/创建/删除面板（Panel）和组件（Widget），通过 HTTP API 操作服务器。合并 panel + widget 两类操作
version: 1.0.0
---

# canvas-cli — 画布操控 Skill

## 何时使用

- 用户要求**查看当前有哪些画布面板**
- 用户要求**创建一个新的画布面板**
- 用户要求**删除某个画布面板**
- 用户要求**查看某个面板里的组件列表**
- 用户要求**创建一个新的组件**（指定类型和初始状态）
- 用户要求**更新某个组件的状态**
- 用户要求**删除某个组件**
- AI 需要在画布上自动布局组件

## 依赖

- 服务器运行在 `localhost:3456`（可通过 `LD_SERVER_URL` 环境变量覆盖）
- 若服务器设置了 `SERVER_TOKEN`，需通过 `LD_SERVER_TOKEN` 环境变量提供

## 命令清单

入口：`node .pi/skills/canvas-cli/cli.js <panel|widget> <command> [args] [--json]`

### panel 命令

#### `panel ls [--json]`

列出所有画布面板。

```bash
node .pi/skills/canvas-cli/cli.js panel ls --json
```

#### `panel get <panelId> [--json]`

获取某个面板的详细信息。

```bash
node .pi/skills/canvas-cli/cli.js panel get abc-123 --json
```

#### `panel create --name <name> [--json]`

创建新面板。

```bash
node .pi/skills/canvas-cli/cli.js panel create --name "工作面板" --json
```

#### `panel delete <panelId> [--json]`

删除面板（级联删除其下的组件、AI 对话历史、AI 记忆）。

```bash
node .pi/skills/canvas-cli/cli.js panel delete abc-123 --json
```

### widget 命令

#### `widget ls [--panel <panelId>] [--json]`

列出组件。指定 `--panel` 只列该面板的组件；不指定则列出所有面板的所有组件。

```bash
node .pi/skills/canvas-cli/cli.js widget ls --panel abc-123 --json
node .pi/skills/canvas-cli/cli.js widget ls --json
```

#### `widget get <widgetId> [--json]`

获取某个组件的详细信息。

```bash
node .pi/skills/canvas-cli/cli.js widget get widget-456 --json
```

#### `widget create --panel <panelId> --type <type> [--state <json>] [--json]`

在指定面板中创建新组件。`--state` 为 JSON 字符串，作为组件初始状态。

```bash
node .pi/skills/canvas-cli/cli.js widget create --panel abc-123 --type HtmlCanvasWidget --state '{"html":"<p>hello</p>"}' --json
```

#### `widget update <widgetId> --state <json> [--json]`

更新组件的状态。

```bash
node .pi/skills/canvas-cli/cli.js widget update widget-456 --state '{"count":5}' --json
```

#### `widget delete <widgetId> [--json]`

删除组件。

```bash
node .pi/skills/canvas-cli/cli.js widget delete widget-456 --json
```

## 输出格式

### 默认（人类可读文本）

输出到 stdout，错误输出到 stderr。

```
Panels (3):
  abc-123  工作面板  (sort: 0)
  def-456  学习面板  (sort: 1)
```

### `--json` 模式

成功：`{ "ok": true, "data": <result> }`
失败：`{ "ok": false, "error": "错误信息" }`

所有 JSON 输出为单行，便于 AI 解析。

### 退出码

| 退出码 | 含义 |
|--------|------|
| 0 | 成功 |
| 1 | 业务错误（服务器未运行、面板不存在、API 返回 4xx/5xx 等） |
| 2 | 参数错误（缺少必需参数、未知命令等） |

## 设计约束

- **仅依赖 Node.js 内置 API**（`fetch` 在 Node 18+ 内置），不引入任何外部依赖
- **TypeScript strict 模式**，编译为 ESM 模块
- **所有 fetch 调用 try/catch**，进程永不崩溃
- **启动时健康检查**：先 `GET /api/health`，失败立即报错退出
