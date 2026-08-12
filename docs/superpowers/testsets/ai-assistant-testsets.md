# AI 助手真实能力测试集（Phase 4+ 对齐版）

**目的**：验证 AI 助手是否正确使用 Phase 4+ 的 25 个工具，通过 Playwright E2E 行为测试覆盖关键工具链路。

**适用版本**：v0.9.0-phase11+

---

## 一、概述

本测试集定位为 **Playwright E2E 行为测试**，通过 Playwright MCP 驱动浏览器，验证 AI 助手在 dev server 环境下能否正确调用工具并产生预期 UI 变化。

**测试范围**：
- ✅ 工具调用链路（25 个工具中的关键子集）
- ✅ AI 助手 UI 渲染（Sidebar / 思考等级 / Agent 模式切换）
- ✅ 浏览器操作工具（browser_* 系列）
- ✅ 画布组件工具（create/update/delete_html_widget）
- ✅ 存储工具（storage_read/write）
- ✅ ask_user 交互工具
- ❌ 真实 LLM 对话（需 API Key，跳过）
- ❌ 真实 AI 工具调用结果验证（需真实 LLM，跳过）

---

## 二、真实工具集清单（25 个）

Phase 4+ AI 助手共 25 个工具，分 4 类：

### 2.1 Widget 工具（4 个）

| 工具 | 功能 |
|------|------|
| `create_html_widget` | 创建 HTML 组件（含 HTML/JS/CSS 内容） |
| `update_html_widget` | 更新已存在的 HTML 组件内容 |
| `delete_html_widget` | 删除 HTML 组件 |
| `list_widgets` | 列出当前面板所有组件 |

### 2.2 Storage 工具（2 个）

| 工具 | 功能 |
|------|------|
| `storage_read` | 读取 KV 存储（按 key） |
| `storage_write` | 写入 KV 存储（key + value） |

### 2.3 Browser 工具（18 个）

| 工具 | 功能 |
|------|------|
| `browser_eval` | 在当前网页执行 JS 脚本 |
| `browser_get_dom` | 获取当前网页 DOM |
| `browser_click` | 点击元素（selector） |
| `browser_input` | 输入文本到元素 |
| `browser_scroll` | 滚动页面 |
| `browser_wait_for` | 等待条件满足 |
| `browser_screenshot` | 截图当前网页 |
| `browser_navigate` | 导航到 URL |
| `browser_get_url` | 获取当前 URL |
| `browser_get_title` | 获取页面标题 |
| `browser_back` | 后退 |
| `browser_forward` | 前进 |
| `browser_reload` | 刷新 |
| `browser_get_cookie` | 获取 Cookie |
| `browser_set_cookie` | 设置 Cookie |
| `browser_open` | 打开新网页标签 |
| `browser_switch_tab` | 切换标签页 |
| `browser_list_tabs` | 列出所有标签页 |

### 2.4 交互工具（1 个）

| 工具 | 功能 |
|------|------|
| `ask_user` | AI 主动向用户提问（选项框形式，支持多选） |

> **注**：ask_user 不走 wsToolHandlers.executeToolCall，单独通过 useAIStore 弹 AskUserCard 收集用户选择。

---

## 三、测试用例

### E1: HTML Widget 全生命周期

**覆盖工具**：`create_html_widget` + `update_html_widget` + `delete_html_widget` + `list_widgets`

**前置条件**：
- dev server 已启动（`npm run dev`）
- 至少存在一个面板（默认面板即可）
- mock API key 已配置（避免真实 LLM 调用）

**测试步骤**：
1. 通过 Playwright MCP 打开 dev server
2. 切换到 AI 助手模式（sidebarMode = 'ai-assistant'）
3. 在 AI 输入框输入：`帮我创建一个待办列表 HTML 组件`
4. 等待 AI 回复完成（sessionStatus 从 thinking 变为 idle）
5. 验证画布上出现新的 HTML 组件
6. 输入：`给刚才的组件加一个标题"我的待办"`
7. 验证组件内容更新
8. 输入：`删除刚才创建的组件`
9. 验证组件被删除

**验证标准**：
- [ ] `create_html_widget` 被调用（通过 mock 或日志确认）
- [ ] 画布上出现新组件（DOM 检测）
- [ ] `update_html_widget` 被调用
- [ ] 组件内容更新（DOM 检测）
- [ ] `delete_html_widget` 被调用
- [ ] 组件从画布消失（DOM 检测）
- [ ] AI 没有调用 `create_panel`（Phase 4+ 不再使用）

**mock 策略**：
- 拦截 `executeToolCall`，记录工具调用参数
- 返回 mock 成功结果，不实际执行工具
- 验证工具调用次数和参数正确性

---

### E2: 浏览器操作链路

**覆盖工具**：`browser_open` + `browser_navigate` + `browser_eval` + `browser_get_url` + `browser_get_title`

**前置条件**：
- dev server 已启动
- mock API key 已配置
- 至少存在一个 webview 标签（或通过 browser_open 创建）

**测试步骤**：
1. 通过 Playwright MCP 打开 dev server
2. 切换到 AI 助手模式
3. 输入：`打开百度首页 https://www.baidu.com`
4. 等待 AI 回复完成
5. 验证 `browser_open` 或 `browser_navigate` 被调用
6. 验证 webview 标签被创建
7. 输入：`获取当前页面标题`
8. 验证 `browser_get_title` 被调用
9. 输入：`在页面上执行 JS: document.title`
10. 验证 `browser_eval` 被调用

**验证标准**：
- [ ] `browser_open` / `browser_navigate` 被调用
- [ ] webview 标签存在（DOM 检测 `<webview>` 标签）
- [ ] `browser_get_title` 被调用
- [ ] `browser_eval` 被调用
- [ ] AI 回复包含页面标题信息

**mock 策略**：
- 拦截 `executeToolCall`，对 browser_* 工具返回 mock 数据
- `browser_get_title` 返回 `{ title: '百度一下，你就知道' }`
- `browser_eval` 返回 `{ result: '百度一下，你就知道' }`

---

### E3: 存储读写

**覆盖工具**：`storage_read` + `storage_write`

**前置条件**：
- dev server 已启动
- mock API key 已配置

**测试步骤**：
1. 通过 Playwright MCP 打开 dev server
2. 切换到 AI 助手模式
3. 输入：`记住我的偏好：我喜欢深色主题`
4. 等待 AI 回复完成
5. 验证 `storage_write` 被调用（key 含 "preference" 或 "theme"，value 含 "深色"）
6. 输入：`我之前告诉你我喜欢的主题是什么？`
7. 验证 `storage_read` 被调用
8. 验证 AI 回复包含 "深色主题"

**验证标准**：
- [ ] `storage_write` 被调用，参数包含正确的 key 和 value
- [ ] `storage_read` 被调用，参数包含正确的 key
- [ ] AI 回复引用了存储的内容
- [ ] AI 没有说"无法写入记忆"（Phase 4+ 已支持 storage_write）

**mock 策略**：
- `storage_write` 返回 `{ success: true }`
- `storage_read` 返回之前 mock 写入的值

---

### E4: ask_user 交互

**覆盖工具**：`ask_user`

**前置条件**：
- dev server 已启动
- mock API key 已配置

**测试步骤**：
1. 通过 Playwright MCP 打开 dev server
2. 切换到 AI 助手模式
3. 输入：`帮我创建一个组件，但我不知道选什么类型，你给我推荐一下`
4. 等待 AI 回复
5. 验证 `ask_user` 被调用，弹出 AskUserCard
6. 验证 AskUserCard 包含问题文本和选项按钮
7. 点击某个选项
8. 验证 AI 收到选择结果后继续回复

**验证标准**：
- [ ] `ask_user` 被调用（不走 executeToolCall，走 useAIStore 弹卡）
- [ ] AskUserCard UI 渲染（DOM 检测 `.ask-user-card` 或类似 class）
- [ ] 选项按钮可点击
- [ ] 点击后 AskUserCard 消失
- [ ] AI 继续回复（基于用户选择）

**mock 策略**：
- AI 回复触发 `ask_user` 工具调用
- mock LLM 返回固定的 `ask_user` tool_call
- 验证 AskUserCard 渲染逻辑

---

## 四、验证标准

### 4.1 工具调用验证

每个测试用例通过以下方式验证工具调用：

1. **mock 拦截**：在 `executeToolCall` / `handleAskUser` 层注入 spy，记录工具调用参数
2. **日志确认**：检查 console 输出中的工具调用日志
3. **DOM 验证**：通过 Playwright evaluate 检查页面 DOM 变化
4. **Store 状态**：通过 useAppStore / useAIStore getState 验证状态变化

### 4.2 UI 渲染验证

- 组件创建/更新/删除 → 检查 `useAppStore.panelWidgets` 变化
- 浏览器标签 → 检查 `useAppStore.webTabs` 变化 + `<webview>` DOM
- ask_user → 检查 `useAIStore.pendingAskUserRequests` + AskUserCard DOM

### 4.3 通过标准

- 工具调用次数和参数正确
- UI 变化符合预期
- AI 回复内容合理
- 无未捕获异常

---

## 五、前置条件

### 5.1 dev server 启动

```bash
cd f:\allmylife\event
npm run dev
```

dev server 启动后，Vite dev server 监听 `http://localhost:5173`，Electron 主窗口自动打开。

### 5.2 mock API key 配置

为避免真实 LLM 调用，需配置 mock API key：

```typescript
// 在测试 setup 中 mock useAIStore
useAIStore.setState({
  llmConfig: {
    apiKey: 'mock-api-key-for-testing',
    model: 'mock-model',
    endpoint: 'http://localhost:5173/mock-llm',
  },
})
```

或通过 Settings 面板手动配置（开发环境）。

### 5.3 Playwright MCP server 启动

```bash
# 启动 Playwright MCP server（HTTP 模式，端口 8931）
node "F:\Operit_workspace_full_backup\workspace_backup\.mcp-playwright-runtime\playwright-mcp-server\dist\index.js" --port 8931
```

### 5.4 运行 E2E 脚本

```bash
# 方式 1：直接运行（MCP SDK 格式，推荐）
node e2e/phase11-dev-server.mjs

# 方式 2：通过 playwright-cli.js（text 格式脚本）
node "F:\Operit_workspace_full_backup\workspace_backup\.mcp-playwright-runtime\playwright-cli.js" run <text-script>
```

---

## 六、跳过项（明确不做的）

### 6.1 真实 AI 对话

**原因**：无 API Key，真实 LLM 调用会失败
**替代**：通过 mock LLM 返回固定的 tool_call，验证工具调用链路

### 6.2 真实工具调用结果

**原因**：真实工具调用依赖真实 LLM 决策，无法确定调用顺序
**替代**：mock `executeToolCall` 返回固定结果，验证 UI 变化

### 6.3 Electron 启动/退出

**原因**：已在 `electron/main/__tests__/index.test.ts` 中通过 mock 验证
**替代**：Playwright Chromium 环境（非 Electron），contextBridge API 不暴露，标注"需要 Electron 主进程验证"

---

## 七、测试执行流程

1. 启动 Playwright MCP server（端口 8931）
2. 启动 dev server（`npm run dev`）
3. 运行 E2E 脚本：`node e2e/phase11-dev-server.mjs`
4. 脚本自动：
   a. 检查 dev server 是否在运行
   b. 如未运行，启动 `npm run dev`（异步，wait 5s）
   c. 用 Playwright MCP 打开 dev server URL
   d. 等待主页面加载
   e. 截图保存到 `docs/verify/phase11/dev-server-home.png`
   f. 验证关键元素存在（canvas / Sidebar / TabBar）
   g. 关闭浏览器
5. 检查截图和报告
6. 记录失败项

---

## 八、失败处理策略

| 失败场景 | 排查方向 |
|---------|---------|
| dev server 启动失败 | 检查端口 5173 是否被占用，检查 `npm run dev` 日志 |
| MCP server 连接失败 | 检查端口 8931 是否在监听，启动 MCP server |
| 页面元素未加载 | 增加 wait 时间，检查 vite 首次启动是否慢 |
| 工具未被调用 | 检查 mock 配置，检查 AI 是否收到正确的系统提示词 |
| ask_user 未弹卡 | 检查 useAIStore 的 pendingAskUserRequests 状态 |
| 截图保存失败 | 检查 docs/verify/phase11/ 目录权限 |

---

## 九、与 Phase 9 验证的关系

Phase 9 验证脚本（`phase9-verify-all.mjs`）覆盖 9 个模块的运行时验证，包括：
- pi 包安装、轻 agent 核心、工具桥接、safeStorage API Key
- 思考等级映射 + UI、Agent 切换 UI、离线降级、Skills 加载

本测试集（Phase 11.6）在 Phase 9 基础上扩展：
- ✅ 复用 Phase 9 的 Playwright MCP 连接方式
- ✅ 复用 Phase 9 的截图 + evaluate 验证模式
- ➕ 新增 dev server 启动检查
- ➕ 新增 25 工具对齐的 E2E 测试用例
- ➕ 新增 ask_user 交互验证

**关系**：Phase 9 验证"模块存在 + 源码正确"，Phase 11.6 E2E 验证"工具链路 + 行为正确"。
