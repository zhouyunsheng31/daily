# Daily API 文档

> Base URL: `http://<host>:3456/api`
> 配套：[developer-guide.md](developer-guide.md) · [component-spec.md](component-spec.md)

所有 `/api/*` 端点（除 `/api/health` 和 `/api/auth/login`、`/api/auth/register`）均需认证。

## 认证方式

| 客户端 | 方式 |
|---|---|
| Web 端 | httpOnly JWT cookie（登录后浏览器自动携带，`credentials: 'include'`） |
| 桌面/移动端 | `Authorization: Bearer <SERVER_TOKEN>` header |

---

## 1. 认证 API

### POST /api/auth/register
注册新用户。第一个注册的用户自动成为 admin。

**Body**
```json
{ "username": "alice", "email": "alice@example.com", "password": "secret123" }
```
- username: ≥2 字符
- email: 合法邮箱格式
- password: ≥6 字符

**Response 201**
```json
{
  "authenticated": true,
  "token": "<jwt>",
  "user": { "id": "uuid", "username": "alice", "email": "...", "role": "member" }
}
```
**错误**
- 400 `INVALID_INPUT` 参数不合法
- 409 `USER_EXISTS` 用户名/邮箱已注册

### POST /api/auth/login
登录（多用户模式）或单密码 fallback。

**Body（多用户）**
```json
{ "username": "alice", "password": "secret123" }
```
或
```json
{ "email": "alice@example.com", "password": "secret123" }
```

**Body（单密码 fallback，仅当未配置多用户时）**
```json
{ "password": "<WEB_ACCESS_PASSWORD>" }
```

**Response 200**
```json
{ "authenticated": true, "token": "<jwt>", "user": { ... } }
```
**错误**
- 401 `INVALID_CREDENTIALS`
- 403 `USER_BANNED` 账号被封禁

### GET /api/auth/me
获取当前用户信息。

**Response 200**
```json
{ "authenticated": true, "user": { "id", "username", "email", "role", "isBanned", "createdAt", "lastLoginAt" } }
```

### POST /api/auth/refresh
刷新 JWT。返回新 token（cookie 重设）。

### POST /api/auth/logout
登出，清除 cookie。

---

## 2. 面板管理 API

### GET /api/panels
获取当前用户的面板列表（个人 + 社区）。
- 多用户：`owner_id = 当前用户` 的个人面板 + 所有 `is_community = TRUE` 的社区面板
- 单密码：返回所有面板

**Response 200**
```json
[ { "id", "name", "sortOrder", "settings", "canvasTransform", "ownerId", "isCommunity", "createdAt", "updatedAt" } ]
```

### GET /api/panels/community
获取所有社区面板（`is_community = TRUE`）。

### POST /api/panels
创建面板。

**Body**
```json
{
  "id": "optional-uuid",
  "name": "我的面板",
  "sortOrder": 0,
  "settings": {},
  "canvasTransform": null,
  "isCommunity": false
}
```
- `isCommunity: true` 需要 admin 权限

**Response 201**：返回创建的 panel 对象。

### GET /api/panels/:id
获取单个面板。

### PUT /api/panels/:id
更新面板。非社区面板只有 owner 或 admin 可修改；切换 `isCommunity` 需 admin。

**Body**（任选字段）
```json
{ "name": "新名称", "sortOrder": 1, "settings": {}, "canvasTransform": {}, "isCommunity": false }
```

### DELETE /api/panels/:id
删除面板（级联删除 widgets / panel_memory_states / ai_conversations / ai_memories）。

### PUT /api/panels/reorder
**Body**: `{ "panelIds": ["id1", "id2", ...] }`

### GET/PUT /api/panels/active
获取/设置当前激活面板 id。
- GET 返回 `{ "activePanelId": "uuid" | null }`
- PUT body: `{ "activePanelId": "uuid" | null }`

### GET/PUT /api/panels/:id/memory-state
面板内存休眠状态（spec §2）。

---

## 3. 组件 API

### GET /api/panels/:panelId/widgets
获取面板下所有组件。

### POST /api/panels/:panelId/widgets
创建组件。

**Body**
```json
{
  "id": "optional-uuid",
  "type": "htmlCanvas",
  "x": 100, "y": 100,
  "width": 300, "height": 200,
  "zIndex": 0,
  "state": { "html": "<div>...</div>" },
  "isPrimary": false
}
```

### GET/PUT/DELETE /api/widgets/:id
组件的读取/更新/删除。

### POST /api/dynamic-widgets
上传可复用的动态组件到 `dynamic_widgets` 表。

**Body**
```json
{
  "widgetType": "weather",
  "displayName": "天气",
  "icon": "cloud-sun",
  "defaultLayout": { "width": 240, "height": 120 },
  "defaultState": {},
  "code": "<div>HTML</div>",
  "componentEnv": "pure-frontend",
  "crossPlatform": true,
  "desktopOnly": false
}
```

### GET /api/dynamic-widgets
列出所有动态组件。

### 组件能力声明

- `GET /api/component-capabilities` — 列出所有能力声明
- `POST /api/component-capabilities` — 创建/更新能力声明
- `GET/PUT/DELETE /api/component-capabilities/:widgetType` — 单条 CRUD

---

## 4. 社区 API（Phase 6）

联邦式社区：本端点管理本实例已聚合的外部 Daily 社区。

### GET /api/communities
获取本实例已添加的社区列表。

**Response 200**
```json
{
  "communities": [
    {
      "id": "uuid",
      "name": "Daily 官方社区",
      "description": "...",
      "apiUrl": "https://community.daily.dev/api",
      "icon": "https://.../icon.png",
      "isOfficial": true,
      "addedBy": "user-uuid",
      "createdAt": 1783000000000
    }
  ]
}
```

### GET /api/communities/official
获取官方社区清单（硬编码 + DB `is_official=TRUE` 记录合并去重）。每条额外带 `added` 字段表示是否已被本实例添加。

**Response 200**
```json
{
  "communities": [
    { "id": "official-daily", "name": "Daily 官方社区", "description": "...", "apiUrl": "...", "icon": "...", "added": false }
  ]
}
```

### POST /api/communities
添加社区（手动输入地址 或 从官方清单一键添加）。

**Body**
```json
{
  "name": "我的游戏社区",
  "apiUrl": "https://game.example.com/api",
  "description": "可选描述",
  "icon": "https://.../icon.png",
  "isOfficial": false
}
```
- `apiUrl` 必须是合法 http(s) URL
- 同一 `apiUrl` 只能添加一次（UNIQUE 约束）

**Response 201**：返回创建的 community 对象。

**错误**
- 400 `INVALID_INPUT` 名称必填 / apiUrl 非法
- 409 `COMMUNITY_EXISTS` 该地址已添加

### DELETE /api/communities/:id
移除已添加的社区。

**Response 200**: `{ "success": true, "id": "..." }`
**错误**: 404 `NOT_FOUND`

---

## 5. 工具设置 API

### GET/PUT /api/settings/:key
全局键值设置（`settings` 表）。

### AI 设置
- `GET /api/ai/settings` — 获取所有 AI 设置
- `PUT /api/ai/settings/:key` — 更新单项
- `GET /api/ai/search/keys/:provider` — 搜索 key 状态
- `PUT /api/ai/search/keys/:provider` — 更新搜索 key
- `DELETE /api/ai/search/keys/:provider` — 删除搜索 key

### 工具/Skills 启用
- `GET /api/tools` — 工具列表与启用状态
- `PUT /api/tools/:name` — 切换工具启用
- `GET /api/skills` — Skills 列表
- `PUT /api/skills/:id` — 切换 Skill 启用

### 本地服务
- `GET /api/local-services` — 已注册的本地服务
- `POST /api/local-services` — 注册本地服务
- `DELETE /api/local-services/:id` — 注销

### 管理员（需 admin）
- `GET /api/admin/users` — 用户列表
- `PUT /api/admin/users/:id/ban` — 封禁/解封
- `PUT /api/admin/users/:id/role` — 角色切换

---

## 6. 通用响应格式

### 成功
- GET：直接返回数据对象/数组
- POST：返回创建的对象，HTTP 201
- PUT：返回更新后的对象
- DELETE：`{ "success": true, "id": "..." }`

### 错误
```json
{
  "error": {
    "status": 400,
    "code": "INVALID_INPUT",
    "message": "人类可读的错误描述"
  }
}
```

常见错误码：
- 400 `INVALID_INPUT` 参数错误
- 401 `UNAUTHORIZED` / `INVALID_JWT` 未认证
- 403 `FORBIDDEN` 权限不足
- 404 `NOT_FOUND` 资源不存在
- 409 `*_EXISTS` 资源已存在
- 500 服务端错误

---

## 7. WebSocket 协议

Server 与前端通过 WS 双向通信（同端口，路径 `/`）：

```typescript
// 后端 → 前端：工具调用请求
{ kind: 'tool_call', requestId, tool, params }

// 前端 → 后端：工具调用响应
{ kind: 'tool_result', requestId, success, data?, error? }

// 后端 → 前端：pi 事件流转发
{ kind: 'pi_event', event: 'text_delta'|'tool_call_start'|'tool_call_end'|'agent_end', data }

// 后端 → 前端：广播变更
{ kind: 'panel_created'|'panel_updated'|'panel_deleted'|'panel_active_changed'|'panels_reordered', data }
```

工具调用超时 30s，每个调用独立 `requestId`，支持并发。
