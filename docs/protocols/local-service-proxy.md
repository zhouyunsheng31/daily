# 本地服务代理协议（Phase 6.2 方案 A：服务器中转）

> 移动端通过服务器代理调用桌面端本地服务。桌面端在线时近实时响应，离线时降级提示。

## 1. 服务发现

移动端通过以下 API 获取所有在线的本地服务：

```
GET /api/local-services/list
```

**响应**（200）：
```json
[
  {
    "id": 1,
    "deviceId": "abc-123-def",
    "serviceName": "local-notes",
    "endpoint": "http://localhost:3001",
    "description": "本地笔记服务",
    "online": true,
    "lastHeartbeat": 1719216000000,
    "registeredAt": 1719216000000,
    "updatedAt": 1719216000000
  }
]
```

也可查询指定设备的在线服务：
```
GET /api/local-services/list/:deviceId
```

## 2. deviceId 获取

deviceId 从服务发现结果中获取。每个在线服务条目的 `deviceId` 字段标识了运行该本地服务的桌面端设备。

移动端可通过以下方式确定目标 deviceId：
1. 调用 `GET /api/local-services/list` 获取所有在线服务
2. 根据 `serviceName` 找到需要的服务
3. 从该条目中读取 `deviceId`

## 3. URL 改写规则

移动端组件需要将本地服务的 URL 改写为服务器代理 URL：

```
原始 URL：http://localhost:3001/api/notes
改写 URL：http://server:3456/proxy/{deviceId}/local-notes/api/notes
```

**改写规则**：
- 将 `http://localhost:{port}` 替换为 `http://server:3456/proxy/{deviceId}/{serviceName}`
- 保留原始 URL 中 `localhost:{port}` 之后的所有路径和查询参数

**示例**：
| 原始 URL | 代理 URL |
|----------|----------|
| `http://localhost:3001/api/notes` | `http://server:3456/proxy/{deviceId}/local-notes/api/notes` |
| `http://localhost:3001/api/notes/42` | `http://server:3456/proxy/{deviceId}/local-notes/api/notes/42` |
| `http://localhost:3001/api/notes?tag=work` | `http://server:3456/proxy/{deviceId}/local-notes/api/notes?tag=work` |

## 4. 请求/响应格式

### 请求

移动端向代理 URL 发送标准 HTTP 请求，服务器会：
1. 过滤 `host`、`connection`、`content-length` headers
2. 通过 WS 将请求转发到桌面端
3. 桌面端执行本地 `fetch(localhost:port/path)` 并返回响应

**请求示例**：
```http
POST /proxy/abc-123-def/local-notes/api/notes HTTP/1.1
Host: server:3456
Authorization: Bearer <token>
Content-Type: application/json

{"title": "测试笔记", "content": "内容"}
```

### 响应

服务器将桌面端的响应原样返回给移动端。

**文本响应**（Content-Type 为 application/json 或 text/*）：
- body 为原始文本字符串

**二进制响应**（Content-Type 为图片/PDF 等）：
- body 为 Base64 编码字符串
- 响应头中包含 `X-Proxy-Base64: true`（服务器返回前会解码并移除该头）

**响应示例**：
```http
HTTP/1.1 200 OK
Content-Type: application/json

{"id": 42, "title": "测试笔记", "content": "内容"}
```

## 5. 离线处理

当桌面端离线或服务不可用时，服务器返回降级响应：

### 服务离线（503）
```json
{
  "error": "local_service_offline",
  "message": "依赖的桌面端离线"
}
```

**触发条件**：
- 服务 `online = false`（心跳超时 60 秒未更新）
- 桌面端 WS 断开
- 服务不存在

### 代理超时（504）
```json
{
  "error": "proxy_timeout",
  "message": "桌面端响应超时"
}
```

**触发条件**：
- 桌面端 30 秒内未返回 proxy_response

### 移动端处理建议
- 收到 503 时显示"依赖的桌面端离线"提示
- 收到 504 时显示"桌面端响应超时，请重试"提示
- 可提供重试按钮

## 6. 认证

代理路由需要 `authMiddleware` 认证：
- 请求头需携带 `Authorization: Bearer <token>`（与 SERVER_TOKEN 匹配）
- 开发模式（未设置 SERVER_TOKEN）时跳过认证

## 7. 心跳机制

桌面端每 30 秒发送一次心跳：
```
POST /api/local-services/heartbeat
Body: { "serviceNames": ["local-notes", "local-todo"] }
```

服务器每 60 秒扫描，将 `last_heartbeat` 超过 60 秒的记录标记为 `online = false`。
