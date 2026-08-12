# 05 · 外部 App：外部 API 接入与外部网页 App（url-app）

> 两类需求：①把**外部 API**（天气、汇率、GitHub、任意 REST 服务）接进来给 App/AI 用；②把**外部网页**（哪怕是实时连接自己服务器的动态站点）直接变成系统里的 App。

## 1. 三种形态与选型

| 形态 | 包类型 | 数据通路 | 适用 |
|---|---|---|---|
| A. 纯静态包 | `app`（现有） | 无出站网络（默认） | AI 生成/用户上传的离线 App |
| B. 外部 API 包 | `api`（04）+ `network.domains` 白名单 | **服务端代理出站**（handler 扩展 `ctx.http`，见 §2） | 汇率/天气/任意公开 API；密钥可托管服务端 |
| C. 外部网页 App | `url-app` | **端侧 WebView 直连**目标站点（见 §3） | 把某网站/自部署服务（如 NAS 上的导航页、公司系统）做成 App |

**为什么 url-app 是端侧直连而不是服务端代理**：动态站点往往有登录态（Cookie/Session）、WebSocket、强 CORS 约束；服务端代理会把自己变成"中间人"，既有凭证风险又有实时性损耗。端侧直连让站点行为与原浏览器一致。

## 2. 形态 B：外部 API 接入（api 包扩展）

在 04 的 handler 沙箱上增加受控网络能力：

```jsonc
// api.json 片段
{ "network": { "domains": ["api.exchangerate.host"] },
  "secrets": ["EXCHANGERATE_KEY"],              // 用户/作者在包设置页填写的密钥名（值仅存服务端，加密）
  "endpoints": [{ "name": "rate", ..., "handler": "handlers/rate.js" }] }
```
```js
// handlers/rate.js —— ctx.http 是白名单 fetch（仅允许 network.domains；30s 超时；响应 ≤256KB）
async function main(ctx) {
  const key = ctx.secrets.EXCHANGERATE_KEY        // 不存在 → 明确错误，不伪造
  const res = await ctx.http.get(`https://api.exchangerate.host/latest?access_key=${key}&base=USD`)
  return { rates: res.json().rates }
}
```

安全规则：`ctx.http` 域名精确匹配（含子域可选 `*.example.com`）；禁止内网段（RFC1918/169.254/::1，SSRF 防护）；secrets 值永不进日志/AI 上下文（工具结果自动脱敏）；出站调用计审计与流量配额。

## 3. 形态 C：url-app（外部网页直接做 App）

### 3.1 创建方式

- 用户/AI 粘贴 URL → 系统创建 `type=url-app` 包（manifest 含 `url.startUrl`、`network.domains` 自动从 startUrl 推导、图标抓取 favicon 或 AI 生成）。
- 同样走包流水线：版本不可变（URL + mode + 快照哈希入版本）、可回滚、可分享。

### 3.2 运行模式

| mode | 行为 | 用途 |
|---|---|---|
| `live`（默认） | WebView 直接加载 startUrl；目标站自己维持登录态与实时连接（WS/fetch 全部直连） | 实时站点（聊天/面板/自部署服务） |
| `snapshot` | 创建时服务端抓取静态快照（HTML+资源内联）作为包内容，离线可看；提供"重新抓取"= 新版本 | 文章/文档/展示页，离线优先 |

### 3.3 安全与隔离（强制）

- manifest `network.domains` = **允许加载的全部源**（含子资源/WS）；app-runtime 用 `WebViewClient.shouldInterceptRequest` + `shouldOverrideUrlLoading` 强制执行白名单，越域请求阻断并记日志。
- url-app 在**独立 WebView 存储分区**运行（Android `setDataDirectorySuffix`/profile 隔离），与 shell 的登录 Cookie **完全隔离**——url-app 拿不到 daily 的凭证，daily 也不碰目标站凭证。
- app-sdk 能力对 url-app **默认全关**（无 app.storage、无 API 调用）；需要时在 manifest 显式声明并走授权页。
- `live` 模式页面内的第三方跳转（OAuth 等）在页内允许白名单域名，出白名单的导航弹系统浏览器。
- 明确风险提示：首次打开 url-app 显示一次"该 App 是外部网页，由 xxx 提供"的标识条（可关闭，商店上架的 url-app 需审核）。

### 3.4 体验细节

- 加载失败/离线：`live` 模式给原生错误页（重试 + 打开快照副本（如有））；`snapshot` 模式标注快照时间。
- 桌面图标长按菜单同普通 App（信息/版本/移除），保持 J5 一致性。

## 4. 验收用例

- **B**：装"汇率 API 包"（配 secrets）→ AI 在对话里回答"今天美元汇率" → 记账 App 用 `sdk.useApi` 做换算；密钥不出现在任何日志（grep 验证）。
- **C-live**：把 `https://example-dashboard.com`（需登录 + WS 实时刷新）做成 App → 登录态保持、实时数据刷新正常、越域请求被阻断有日志。
- **C-snapshot**：把一篇文档站点做成 snapshot App → 断网可完整浏览 → "重新抓取"生成新版本 → 回滚到旧快照可用。