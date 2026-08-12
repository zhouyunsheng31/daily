---
name: browser-agent
description: 浏览器与面板导航操作 Skill，指导 AI 用 browser_* 工具高效操作浏览器，并用 navigate 工具切换/创建面板
version: 1.0.0
---

# 浏览器与面板导航操作指南

## 一、可用工具（15 个 browser_* + 2 个 navigate）

### 浏览器操作工具（15 个）

| 工具 | 参数 | 返回 | 说明 |
|------|------|------|------|
| `browser_eval` | `script: String` | `{result: String?}` | 执行任意 JavaScript 并返回结果 |
| `browser_navigate` | `url: String` | `{url, success}` | 导航到指定 URL |
| `browser_get_url` | 无 | `{url}` | 获取当前页面 URL |
| `browser_click` | `selector: String` | `{clicked: Boolean}` | 点击匹配 CSS selector 的元素 |
| `browser_input` | `selector: String, value: String` | `{input: Boolean}` | 在匹配 selector 的输入框填入文本 |
| `browser_scroll` | `x?: Int, y?: Int, selector?: String` | `{scrolled: Boolean}` | 滚动页面（可指定元素内滚动） |
| `browser_wait_for` | `selector: String, timeoutMs?: Int` | `{found: Boolean}` | 等待元素出现（默认 25s，硬上限 29s） |
| `browser_screenshot` | 无 | `{imageBase64: String}` | 截图当前页面（返回 base64） |
| `browser_get_dom` | `selector?: String` | `{html: String}` | 获取 DOM HTML（selector 为空时取整页） |
| `browser_get_title` | 无 | `{title: String}` | 获取当前页面标题 |
| `browser_back` | 无 | `{success: Boolean}` | 浏览器后退 |
| `browser_forward` | 无 | `{success: Boolean}` | 浏览器前进 |
| `browser_reload` | 无 | `{success: Boolean}` | 重新加载当前页 |
| `browser_get_cookie` | 无 | `{cookies: String}` | 获取当前页 Cookie 字符串 |
| `browser_set_cookie` | `name: String, value: String, domain?: String` | `{success: Boolean}` | 设置 Cookie（domain 缺省用当前页域名） |

### 面板导航工具（2 个）

| 工具 | 参数 | 返回 | 说明 |
|------|------|------|------|
| `navigate_to_panel` | `panelId: String` | `{success, navigatedTo}` | 切换到指定面板（按 panelId 查找） |
| `create_panel` | `name: String, type?: String` | `{success, panelId, name}` | 创建新面板并导航到它（type 默认 WEBVIEW，保留供未来扩展，当前实现未使用） |

## 二、使用建议

### 浏览器操作流程

1. 先 `browser_get_url` + `browser_get_title` 了解当前页面
2. 用 `browser_wait_for` 等待关键元素加载（避免操作未渲染的元素）
3. 用 `browser_click` / `browser_input` 操作表单
4. 用 `browser_screenshot` 给用户确认操作结果
5. 用 `browser_get_dom` 提取结构化数据（注意 token 限制，selector 要精确）
6. 需要登录态时用 `browser_get_cookie` / `browser_set_cookie` 管理 Cookie

### 面板导航流程

1. 切换面板：`navigate_to_panel`（按 panelId 查找）
2. 创建面板：`create_panel`（name 必填，type 可选保留供未来扩展）
3. 创建后自动导航到新面板，可直接继续操作

## 三、CSS selector 示例

- 按 ID：`#login-button`
- 按类：`.submit-btn`
- 按属性：`input[name="username"]`
- 按层级：`div.container > form input`
- 按文本：原生 JS 不支持 `:has-text()`（Playwright 风格），需用 `browser_eval` 配合 `querySelectorAll` 后过滤文本

## 四、注意事项

- 所有浏览器工具依赖"当前活跃 WebView"，若返回 `no active webview` 错误，提示用户先打开浏览器
- `browser_wait_for` 默认超时 25s，硬上限 29s（外层 30s 兜底）
- `browser_screenshot` 返回的 base64 较大，避免频繁调用
- `browser_get_dom` 不传 selector 时返回整页 HTML，token 消耗大，建议精确指定 selector
- `create_panel` 的 type 参数默认 `WEBVIEW`，保留供未来扩展（当前实现未使用 type）
- 工具执行超时统一 30s，超时返回失败
