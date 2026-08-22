---
name: package-market
description: Daily webOS 包体系与市场通用开发指南——面向任何外部 AI（Claude Code / Cursor / Windsurf / GPT / 本地 Agent）及人类开发者。包含 13 种包类型 Manifest 规范、App API（api.json + handlers）、前端 SDK 接口、标准 HTTP 上传与市场发布接口。任何 AI 读入后均可直接开发合规包并完成上架。
---

# Daily webOS 包体系与市场通用开发指南（Universal AI & Developer Spec）

> **适用对象**：无论是 Daily 平台内部 AI、还是外部 AI（Claude Code、Cursor、Windsurf、ChatGPT、任意独立 Agent 框架）以及人类开发者，读入本规范即可直接开发出 100% 兼容 Daily webOS 的包，并通过标准文件或 HTTP 接口发布至市场。

---

## 1. 核心架构认知：什么是 Daily webOS 的“包”？

Daily webOS 是一个 AI-native 的网页操作系统。在 Daily 中：
- **包是全栈能力单元**：一个包可以包含前端 UI（沙箱 HTML App）、后端受限计算服务（App API）、提示词技能（Skill）、主题样式（Theme）或组合容器（Bundle）。
- **环境无关与工具中立**：在任何环境（IDE、本地终端、Web 容器）中，包在磁盘上均表现为标准的文件目录。
  - 应用类包放在：`apps/<appId>/`
  - 其他能力包放在：`packages/<packageId>/`
- **版本不可变**：包的每一次发布/修改都遵循语义化版本（SemVer，如 `1.0.0`），平台自动进行版本快照与依赖管理。

---

## 2. 统一包清单规范：`daily.pkg.json` (v2)

任何包根目录下必须包含 `daily.pkg.json`。

### 2.1 完整通用结构范例

```jsonc
{
  "$schema": "https://daily.local/schemas/daily-pkg.schema.json",
  "schema_version": 2,
  "id": "com.example.pomodoro",               // 全局唯一包名（仅限英文字母、数字、._-）
  "type": "app",                             // 13 种包类型之一（见下表）
  "version": "1.0.0",                        // 严格符合 SemVer 格式（x.y.z）
  "entry": "index.html",                     // 入口相对路径
  "display_name": {
    "zh": "番茄时钟",
    "en": "Pomodoro Timer"
  },
  "description": {
    "zh": "极简番茄工作法时钟，支持自定义时长与音效",
    "en": "Minimalist Pomodoro timer with custom interval"
  },
  "icon": "icon.svg",                        // 相对路径，推荐 128x128 矢量 SVG 或 PNG
  "capabilities": [                          // 所需系统权限词汇（见 §5 白名单）
    "app.storage.private"
  ],
  "network": {
    "domains": [                             // 允许出站请求的域名白名单（禁止内网与 localhost）
      "api.example.com"
    ]
  },
  "dependencies": [                          // 依赖的其他包及其 SemVer 范围
    {
      "id": "com.daily.audio-tools",
      "range": "^1.0.0"
    }
  ],
  "contents": {                              // D19 组合式包（同一包内嵌入多种能力）
    "skills": ["skills/guide/SKILL.md"],     // 附带的 Prompt 技能文件
    "mcp": [],                               // MCP Server 声明（支持 json-rpc / stdio / sse）
    "tools": ["tools/helper.js"],            // 辅助脚本
    "tokens": {},                            // 设计变量覆盖（主题包使用）
    "assets": ["assets/sound.mp3"]           // 静态资源索引
  },
  "children": [],                            // 子包 ID 列表（嵌套深度 ≤ 3 层）
  "minShell": "0.1.0"                        // 最低兼容的平台版本
}
```

### 2.2 13 种包类型（`type`）速查表

| `type` 类型 | 说明 | 必需文件 / 典型入口 | 运行时环境 |
|---|---|---|---|
| `app` | 完整交互式应用 | `index.html`（HTML/CSS/JS 单页或工程产物） | 客户端沙箱 WebView / iframe |
| `api` | 后端微服务与数据接口 | `api.json` + `handlers/*.js` | 服务端受限 Node vm 沙箱 |
| `skill` | 智能体提示词与知识技能 | `SKILL.md` | Agent 提示词上下文 |
| `theme` | 全局 UI 主题与色彩 Token | `daily.pkg.json` (含 `contents.tokens`) | 宿主 UI 主题引擎 |
| `toolpkg` | 自定义工具代码包 | `main.js` | 服务端 Agent 工具调用链 |
| `mcp` | MCP 外部服务桥接包 | 声明在 `contents.mcp` | 服务端受限 MCP Client |
| `workflow` | 多步骤自动化流程 | `workflow.json` | 服务端调度流水线 |
| `provider` | AI 模型/服务接入配置 | 声明在 `provider.json` | 服务端 Provider 注册表 |
| `model-pack` | 模型预设/系统提示词包 | 预设配置清单 | 模型路由管理器 |
| `url-app` | 外部受信任 Web 封装 | 声明在 `url.startUrl` | iframe 直连 / 快照容器 |
| `subagent` | 专职子智能体角色 | `agent.md` | 服务端 Agent 进程池 |
| `pet-layer` | 桌面动态层 / 互动组件 | `index.html` | 桌面共享 Canvas / DOM 层 |
| `bundle` | 多能力聚合分发包 | 无 entry（纯组合容器） | 依赖递归解析器 |

---

## 3. App 开发规范（`type: "app"`）

### 3.1 目录结构标准
```text
apps/<appId>/             # 或 packages/<id>/
├── daily.pkg.json        # Manifest 清单
├── index.html            # 页面入口（单文件或打包后的静态产物）
├── icon.svg              # 应用图标（推荐 128x128 SVG）
├── assets/               # 静态素材（图片、音频、字体等）
│   └── preview.png
├── css/                  # 样式表（若未打包至 html 内）
└── js/                   # 逻辑脚本（若未打包至 html 内）
```

### 3.2 前端代码约束与内置 SDK
由于 App 运行在隔离的沙箱环境（WebView / iframe）中，需遵循以下规则：
1. **静态素材相对路径**：HTML/CSS 中一律使用相对路径引用素材（如 `<img src="assets/preview.png">` 或 `url('assets/bg.jpg')`），系统会自动解析。
2. **数据持久化（避免数据丢失）**：
   - **普通数据（< 100KB）**：直接使用标准 `localStorage.setItem(k, v)`（系统已在沙箱中自动 polyfill 并安全同步至云端）。
   - **文件/大二进制**：使用 SDK 接口 `window.DailyWebOs.fs.write('assets/data.json', content)`。
3. **跨应用与外部通信**：
   - 打开其他 App：`window.DailyWebOs.apps.open('com.example.otherapp')`
   - 外网 HTTP 代理：`window.DailyWebOs.http.get('https://api.example.com/data')`（自动防御 SSRF）

---

## 4. App API 体系规范（`type: "api"`）

当应用需要向外部、其他 App 或 AI 提供可读写的后端数据接口时，必须定义 API 包。

### 4.1 目录结构标准
```text
packages/<packageId>/
├── daily.pkg.json        # 声明 "type": "api", "api": { "spec": "api.json" }
├── api.json              # 接口元数据定义（OpenAPI/JSON Schema 风格）
└── handlers/             # 各端点受限执行函数
    ├── list_items.js
    └── create_item.js
```

### 4.2 `api.json` 格式规范
```jsonc
{
  "schema_version": 1,
  "namespace": "todo",                        // 命名空间（小写字母数字短横线）
  "display_name": { "zh": "待办清单服务" },
  "network": {
    "domains": ["api.todo-cloud.com"]         // 允许 handler 访问的外网白名单域名
  },
  "secrets": ["TODO_AUTH_TOKEN"],             // 依赖的密钥名（在服务端加密存储，不暴露给前端/AI）
  "endpoints": [
    {
      "name": "list_todos",                   // 端点名（小写下划线）
      "method": "GET",                        // GET（只读）或 POST（写操作）
      "path": "/items",
      "description": { "zh": "获取待办列表" },
      "params": {                             // 请求参数的 JSON Schema
        "type": "object",
        "properties": {
          "completed": { "type": "boolean" }
        }
      },
      "storage": {                            // 严格限制该端点允许读写的 Storage 前缀
        "read": ["todos/*"],
        "write": []
      },
      "handler": "handlers/list_items.js",    // 对应的 handler 文件
      "returns": { "type": "object" },        // 返回结构 Schema
      "visibility": "public"                  // "owner"（仅作者本人与作者的 AI 可调）或 "public"（市场安装者均可调）
    }
  ]
}
```

### 4.3 Handler 安全沙箱编写规范
Handler 运行在平台受限的 Node vm 沙箱中，**严禁使用 `require`、`process`、`fs` 或任意 socket 连接**。

```javascript
// handlers/list_items.js
// 规范：必须导出一个异步的 async function main(ctx)
async function main(ctx) {
  // 1. ctx.params: 传入的参数（已通过 JSON Schema 严格校验）
  const { completed } = ctx.params || {};

  // 2. ctx.storage: 受授权前缀保护的 KV 存储接口 (get / set / del / list)
  const allTodos = await ctx.storage.get('todos/list') || [];

  // 3. ctx.http: 受网络白名单保护的 fetch 客户端
  // const res = await ctx.http.get('https://api.todo-cloud.com/sync', {
  //   headers: { Authorization: `Bearer ${ctx.secrets.TODO_AUTH_TOKEN}` }
  // });

  const result = typeof completed === 'boolean'
    ? allTodos.filter(item => item.completed === completed)
    : allTodos;

  // 4. 返回值必须符合 returns schema，单次执行输出上限为 64KB
  return {
    ok: true,
    data: result
  };
}
```

---

## 5. 权限词汇表（Capabilities）白名单

在 `daily.pkg.json` 的 `capabilities` 数组中，只能声明平台允许的能力词汇：

| 能力词汇 | 说明 | 适用场景 |
|---|---|---|
| `app.storage.private` | 读写当前包私有的键值存储 | 绝大多数需要存状态的 App / API |
| `app.fs` | 读写当前包目录内的文件 | 需要动态读写本地图片/产物的应用 |
| `app.fs.shared` | 读写跨应用公共数据区 | 多个应用协同共享数据 |
| `app.api.invoke` | 允许调用其他已安装包的公开 API | 组合式工具 / 跨包互联 |
| `network.outbound` | 允许发起外网 HTTP 出站请求 | 配合 `network.domains` 访问外部 API |
| `ui.theme` | 允许修改桌面与全局主题色彩 | 主题包 |
| `provider.switch` | 允许切换 AI 供应商配置 | Provider 扩展包 |

---

## 6. 外部开发与市场发布：标准 HTTP REST 流程

外部 AI 或第三方自动化脚本，可以通过标准的 HTTP REST 接口完成包的创建、校验、上架与安装。

### 6.1 鉴权（Authentication）
所有端点需携带标准 JWT Authorization 头：
```http
Authorization: Bearer <YOUR_JWT_TOKEN>
```

### 6.2 常用端点速查

#### 1. 批量上传并创建包（POST `/webos/api/packages`）
用于外部工具直接将本地开发好的 Manifest 与文件内容打包推送至平台：
```http
POST /webos/api/packages
Content-Type: application/json

{
  "manifest": {
    "schema_version": 2,
    "id": "com.example.weather",
    "type": "app",
    "version": "1.0.0",
    "display_name": { "zh": "极简天气" }
  },
  "files": {
    "index.html": "<!DOCTYPE html><html>...</html>",
    "icon.svg": "<svg>...</svg>"
  }
}
```

#### 2. 上架到市场（POST `/webos/api/market/publish`）
将已创建的包发布至公共市场（服务端自动执行静态安全扫描，检查内网穿透、明文密钥与大小超限）：
```http
POST /webos/api/market/publish
Content-Type: application/json

{
  "packageId": "com.example.weather"
}
```

#### 3. 搜索市场（GET `/webos/api/market?type=app&q=weather`）
```http
GET /webos/api/market?type=app&q=weather
```

#### 4. 从市场安装包（POST `/webos/api/market/:id/install`）
服务端会自动解析并递归安装该包声明的所有 `dependencies` 闭包：
```http
POST /webos/api/market/com.example.weather/install
```

---

## 7. 外部 AI 开发合规自检清单

当任何外部 AI 编写完成一个 Daily webOS 包时，请按以下清单自检：
1. **Manifest 校验**：`daily.pkg.json` 的 `id`、`version`（合法 semver）、`type`（13 种之一）是否完整无误；
2. **沙箱安全性**：
   - 是否包含 `eval()`、内网 IP 请求（如 `192.168.x.x`、`127.0.0.1`、`localhost`）？（若有将被平台静态扫描拦截）；
   - API handler 中是否包含 Node 内置模块（`fs`、`child_process`、`require`）？（必须使用 `ctx.*` 提供的沙箱对象）；
   - 密钥是否硬编码在代码中？（必须使用 `secrets` 声明并在 handler 中通过 `ctx.secrets.KEY_NAME` 读取）；
3. **资源引用**：HTML/CSS 内的素材链接是否全部使用相对路径（而非绝对 URL）；
4. **单包配额**：整个包体大小是否控制在 `10MB` 配额以内。