---
name: fs-cli
description: 文件系统操作 Skill，让 AI 能读写宿主机文件系统（受白名单沙箱约束）。支持 ls/read/write/mkdir/rm/mv/cp/stat 共 8 个命令
version: 1.0.0
---

# fs-cli — 文件系统操作 Skill

## 何时使用

- 用户要求读写项目目录（`F:\allmylife\event`）内的文件
- 用户要求查看目录结构、列文件清单
- 用户要求创建 / 删除 / 移动 / 复制文件或目录
- AI 需要读取本地配置文件、日志文件、数据文件
- AI 需要把生成的内容写入文件（如代码、文档、缓存）
- 用户要求查看文件元信息（大小、修改时间等）

## 何时不能使用

- 操作 C 盘系统目录（`C:\Windows` / `C:\Program Files` / `C:\Program Files (x86)` / `C:\System Volume Information`）—— 会返回权限错误
- 操作白名单外的任意目录 —— 会返回 `Path not in whitelist` 错误
- 访问 UNC 路径（`\\SERVER\share`）—— 显式拒绝
- 路径包含 8.3 短文件名（如 `PROGRA~1`）—— 显式拒绝
- 路径原始输入包含 `..` —— 显式拒绝（必须在 realpath 前拦截）
- 通过符号链接 / junction 绕过白名单 —— `fs.realpath` 解析后再校验，自动拦截

## 命令清单

入口：`node .pi/skills/fs-cli/cli.js <command> [args] [--json]`

### 1. `ls <path> [--json]`

列出目录内容（含文件名、大小、类型、修改时间）。

```bash
node .pi/skills/fs-cli/cli.js ls F:/allmylife/event/docs --json
```

JSON 输出：
```json
{
  "ok": true,
  "data": {
    "path": "F:\\allmylife\\event\\docs",
    "entries": [
      { "name": "specs", "type": "directory", "size": 0, "mtime": "2026-06-29T10:00:00.000Z" },
      { "name": "package.json", "type": "file", "size": 1234, "mtime": "2026-06-29T10:00:00.000Z" }
    ]
  }
}
```

### 2. `read <path> [--encoding utf8|base64] [--json]`

读取文件内容。默认 utf8 编码。

```bash
node .pi/skills/fs-cli/cli.js read F:/allmylife/event/package.json --json
node .pi/skills/fs-cli/cli.js read F:/allmylife/event/logo.png --encoding base64 --json
```

JSON 输出：`{ "ok": true, "data": { "path": "...", "encoding": "utf8", "content": "..." } }`

### 3. `write <path> --content <text> [--encoding utf8|base64] [--json]`

写入文件（自动创建父目录）。

```bash
node .pi/skills/fs-cli/cli.js write F:/allmylife/event/data/note.txt --content "hello world" --json
```

JSON 输出：`{ "ok": true, "data": { "path": "...", "bytes": 11 } }`

### 4. `mkdir <path> [--json]`

创建目录（recursive，类似 `mkdir -p`）。

```bash
node .pi/skills/fs-cli/cli.js mkdir F:/allmylife/event/data/cache/icons --json
```

JSON 输出：`{ "ok": true, "data": { "path": "..." } }`

### 5. `rm <path> [--recursive] [--json]`

删除文件或目录。删除目录必须加 `--recursive`。

```bash
node .pi/skills/fs-cli/cli.js rm F:/allmylife/event/data/temp.txt --json
node .pi/skills/fs-cli/cli.js rm F:/allmylife/event/data/cache --recursive --json
```

JSON 输出：`{ "ok": true, "data": { "path": "...", "removed": true } }`

### 6. `mv <src> <dst> [--json]`

移动或重命名文件 / 目录。src 和 dst 都必须通过白名单校验。

```bash
node .pi/skills/fs-cli/cli.js mv F:/allmylife/event/data/a.txt F:/allmylife/event/data/b.txt --json
```

JSON 输出：`{ "ok": true, "data": { "src": "...", "dst": "..." } }`

### 7. `cp <src> <dst> [--recursive] [--json]`

复制文件或目录。复制目录必须加 `--recursive`。

```bash
node .pi/skills/fs-cli/cli.js cp F:/allmylife/event/data/a.txt F:/allmylife/event/data/b.txt --json
node .pi/skills/fs-cli/cli.js cp F:/allmylife/event/data/dir1 F:/allmylife/event/data/dir2 --recursive --json
```

JSON 输出：`{ "ok": true, "data": { "src": "...", "dst": "..." } }`

### 8. `stat <path> [--json]`

获取文件元信息（大小、修改时间、创建时间、是否目录、是否文件、权限模式）。

```bash
node .pi/skills/fs-cli/cli.js stat F:/allmylife/event/package.json --json
```

JSON 输出：
```json
{
  "ok": true,
  "data": {
    "path": "F:\\allmylife\\event\\package.json",
    "size": 1234,
    "mtime": "2026-06-29T10:00:00.000Z",
    "ctime": "2026-06-29T10:00:00.000Z",
    "atime": "2026-06-29T10:00:00.000Z",
    "isFile": true,
    "isDirectory": false,
    "mode": 33206
  }
}
```

## 输出格式

### 默认（人类可读文本）

输出到 stdout，错误输出到 stderr。

```
F:\allmylife\event\docs
  specs/                      (directory, 2026-06-29 10:00:00)
  package.json                (1234 bytes, 2026-06-29 10:00:00)
```

### `--json` 模式

成功：`{ "ok": true, "data": { ... } }`
失败：`{ "ok": false, "error": "错误信息" }`

所有 JSON 输出均为单行，便于 AI 解析。

### 退出码

| 退出码 | 含义 |
|--------|------|
| 0 | 成功 |
| 1 | 业务错误（沙箱拒绝、文件不存在、权限不足等） |
| 2 | 参数错误（缺少必需参数、未知命令等） |

## 安全沙箱

### 白名单（大小写不敏感）

以下目录及其子目录允许操作：

| 路径 | 用途 |
|------|------|
| `F:\allmylife\event` | 项目根目录（所有项目文件） |
| `<user-home>\Documents` | 用户文档目录 |
| `<user-home>\AppData\Roaming\living-dashboard` | userData 等价目录（应用配置 / 缓存） |

### 黑名单（大小写不敏感，优先于白名单）

| 路径 | 原因 |
|------|------|
| `C:\Windows` | 系统目录 |
| `C:\Program Files` | 程序安装目录 |
| `C:\Program Files (x86)` | 32 位程序安装目录 |
| `C:\System Volume Information` | 系统卷信息 |

### 校验流程（每个路径都必须通过）

1. **拒绝 UNC 路径**：以 `\\` 开头直接拒绝
2. **拒绝 8.3 短文件名**：路径末尾匹配 `~\d` 直接拒绝
3. **拒绝 `..` 输入**：原始输入包含 `..` 直接拒绝（防止 realpath 前绕过）
4. **`path.resolve`** 解析为绝对路径
5. **`fs.realpath`** 解析符号链接 / junction（路径不存在则用 resolved）
6. **白名单校验**：realpath 必须等于某白名单目录或位于其下（`startsWith(wl + sep)`）
7. **黑名单校验**：realpath 命中黑名单直接拒绝（黑名单优先于白名单）

### 审计日志

- 位置：`F:\allmylife\event\data\fs-audit.log`
- 每次操作追加一行：`[ISO 时间戳] | <operation> | <path> | <result>`
- result 取值：`ok` / `denied:<reason>` / `error:<message>`
- 文件 >10MB 自动轮转：重命名为 `fs-audit.log.1` 后新建

## 设计约束

- **仅依赖 Node.js 内置 API**（`fs/promises` / `path` / `os`），不引入任何外部依赖
- **独立 Node 进程**，不在 Electron 上下文，不能用 `app.getPath()`
- **TypeScript strict 模式**，编译为 ESM 模块
- **所有错误 try/catch**，进程永不崩溃
