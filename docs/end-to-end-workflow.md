# Daily 端到端流程

> 配套：[developer-guide.md](developer-guide.md) · [component-spec.md](component-spec.md)

本文档描述一个组件从本地开发到最终用户使用的完整流程。

---

## 1. 流程总览

```
┌─────────────┐    ┌──────────────┐    ┌─────────────┐    ┌──────────────┐
│ 1. 本地开发  │───▶│ 2. 上传到Daily │───▶│ 3. 画布摆放 │───▶│ 4. 社区发布  │
│  写 HTML 组件│    │  API/手动上传  │    │  实例化使用  │    │  （可选）    │
└─────────────┘    └──────────────┘    └─────────────┘    └──────────────┘
                                              │
                                              ▼
                                       ┌──────────────┐
                                       │ 5. AI 协作    │
                                       │  agent 操作画布│
                                       └──────────────┘
```

---

## 2. 步骤 1：本地开发组件

### 2.1 编写 HTML

组件是纯 HTML（可含 `<style>` / `<script>`），在 sandbox iframe 中渲染。

```html
<!-- todo.html：待办列表 widget -->
<div id="app" style="font-family:sans-serif;padding:12px;width:240px">
  <h3 style="margin:0 0 8px;font-size:14px">📝 待办</h3>
  <div style="display:flex;gap:4px;margin-bottom:8px">
    <input id="inp" placeholder="新任务..." style="flex:1;padding:4px 8px;border:1px solid #ddd;border-radius:4px">
    <button onclick="add()" style="padding:4px 8px;background:#4A90E2;color:#fff;border:none;border-radius:4px;cursor:pointer">+</button>
  </div>
  <ul id="list" style="list-style:none;padding:0;margin:0;font-size:12px"></ul>
</div>
<script>
  const list = document.getElementById('list')
  const inp = document.getElementById('inp')
  const tasks = []
  function render() {
    list.innerHTML = tasks.map((t, i) =>
      `<li style="padding:4px 0;border-bottom:1px solid #eee;display:flex;justify-content:space-between">
        <span>${t}</span>
        <button onclick="del(${i})" style="border:none;background:none;color:#999;cursor:pointer">✕</button>
      </li>`
    ).join('')
  }
  function add() {
    const v = inp.value.trim()
    if (!v) return
    tasks.push(v)
    inp.value = ''
    render()
  }
  function del(i) { tasks.splice(i, 1); render() }
  inp.addEventListener('keydown', e => { if (e.key === 'Enter') add() })
</script>
```

### 2.2 本地预览

直接在浏览器打开 `.html` 文件预览。注意：Daily 内是 sandbox iframe，`alert/confirm` 不可用，需用 DOM 提示替代。

### 2.3 调试要点

- 用 `100%` 适配容器，不要硬编码宽度
- 网络请求注意 CORS（目标服务器需允许 Daily 域名）
- 状态持久化通过 Daily API（`/api/settings` 或 AI 的 `storage_write`）

---

## 3. 步骤 2：上传到 Daily

### 3.1 通过 API 上传（开发者推荐）

```bash
# 假设已登录或持有 SERVER_TOKEN
SERVER_TOKEN="your-token"
DAILY_URL="https://daily.example.com"

# 上传为可复用动态组件
curl -X POST "$DAILY_URL/api/dynamic-widgets" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $SERVER_TOKEN" \
  -d "$(cat <<'EOF'
{
  "widgetType": "todo",
  "displayName": "待办列表",
  "icon": "list-checks",
  "defaultLayout": { "width": 260, "height": 320 },
  "defaultState": {},
  "code": "<div id=\"app\">...</div>",
  "componentEnv": "pure-frontend",
  "crossPlatform": true,
  "desktopOnly": false
}
EOF
)"
```

### 3.2 通过画布手动上传（普通用户）

1. 打开 Daily 画布
2. 点击右下角 `+` 按钮
3. 选择"粘贴 HTML"或"拖拽 HTML 文件"
4. 组件立即出现在画布上

### 3.3 声明能力（可选）

```bash
curl -X POST "$DAILY_URL/api/component-capabilities" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $SERVER_TOKEN" \
  -d '{
    "widgetType": "todo",
    "displayName": "待办列表",
    "description": "简单的待办事项管理",
    "api": [],
    "dependencies": [],
    "componentEnv": "pure-frontend",
    "crossPlatform": true
  }'
```

---

## 4. 步骤 3：画布摆放与使用

### 4.1 实例化

上传后的动态组件可通过"添加组件"菜单实例化到画布：
- 点击画布右下角 `+`
- 选择已上传的"待办列表"
- 组件出现在画布默认位置

### 4.2 交互

- **拖拽**：左键按住组件头部拖动
- **缩放**：拖拽右下角调整大小（iframe widget）
- **右键菜单**：最小化、关闭、编辑样式、锁定
- **滚轮**：缩放画布（Ctrl/⌘+滚轮自由缩放，普通滚轮三档吸附）

### 4.3 AI 协作

用户可通过 AI 对话操作组件：
- "帮我创建一个待办组件" → AI 调用 `create_html_widget` 工具
- "把待办移到左上角" → AI 调用 `update_html_widget` 工具
- "删掉这个组件" → AI 调用 `delete_html_widget` 工具

AI 的 6 个核心工具（通过 WS 转发前端执行）：

| 工具 | 作用 |
|---|---|
| `create_html_widget` | 创建 HTML 组件 |
| `update_html_widget` | 更新组件 |
| `delete_html_widget` | 删除组件 |
| `list_widgets` | 列出当前组件 |
| `storage_read` | 读 KV 存储 |
| `storage_write` | 写 KV 存储 |

---

## 5. 步骤 4：社区发布（可选）

### 5.1 发布为社区面板组件

管理员可创建社区面板（`is_community: true`），将组件分享给所有用户：

```bash
# 创建社区面板（需 admin）
curl -X POST "$DAILY_URL/api/panels" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $SERVER_TOKEN" \
  -d '{ "name": "待办工具社区面板", "isCommunity": true }'
```

社区面板对所有用户可见，普通用户可在此面板添加/使用组件。

### 5.2 联邦聚合

部署多个 Daily 实例后，可在设置页"社区发现"添加其他实例：

1. 进入 设置 → 社区发现
2. 从"官方社区列表"一键添加，或在"手动添加"输入对方 API 地址
3. 添加后在"已加入的社区"可见

注意：联邦式社区各实例独立用户系统，用户在 A 实例注册后不能在 B 实例投稿，必须各自注册。

---

## 6. 完整流程图

```
开发者                          Daily 实例                    最终用户
  │                                │                            │
  │  1. 本地写 HTML 组件            │                            │
  │──────────────────────────────▶│                            │
  │  2. POST /api/dynamic-widgets  │                            │
  │──────────────────────────────▶│  存入 dynamic_widgets 表    │
  │  3. （可选）声明能力            │                            │
  │──────────────────────────────▶│  存入 component_capabilities│
  │                                │                            │
  │                                │  4. 用户打开画布            │
  │                                │◀──────────────────────────│
  │                                │  5. 添加组件菜单选择        │
  │                                │◀──────────────────────────│
  │                                │  6. 实例化到画布            │
  │                                │──────────────────────────▶│
  │                                │                            │
  │                                │  7. AI 对话操作             │
  │                                │◀──────────────────────────│
  │                                │  8. WS 工具调用             │
  │                                │──────────────────────────▶│
  │                                │                            │
  │  9. （admin）创建社区面板       │                            │
  │──────────────────────────────▶│  panels.is_community=true   │
  │                                │  10. 所有用户可见           │
  │                                │──────────────────────────▶│
```

---

## 7. 各步骤详细说明

### 7.1 组件开发检查清单

- [ ] HTML 在浏览器直接打开能正常显示
- [ ] 无 `alert/confirm/prompt`（sandbox 禁止）
- [ ] 无访问 `parent/top` 代码（同源策略隔离）
- [ ] 网络请求用 HTTPS
- [ ] 容器用 `100%` 自适应
- [ ] 无硬编码密钥

### 7.2 上传检查清单

- [ ] `widgetType` 唯一（不与已有组件冲突）
- [ ] `displayName` 可读
- [ ] `defaultLayout` 合理（不过大/过小）
- [ ] `componentEnv` 正确（pure-frontend / local-service）

### 7.3 发布检查清单

- [ ] 社区面板 `isCommunity: true`（需 admin）
- [ ] 组件内容适合公开（所有用户可见）
- [ ] 无敏感数据（组件代码对所有用户公开）

---

## 8. 常见问题

### Q: 组件上传后在哪能看到？
A: 画布右下角 `+` 按钮的组件菜单中，"已上传组件"分类下。

### Q: 如何更新已上传的组件？
A: 用相同的 `widgetType` 重新 `POST /api/dynamic-widgets`，会覆盖 `code` 字段。已实例化的组件不受影响（它们存的是实例时的快照）。

### Q: 社区面板和个人面板的区别？
A: 社区面板（`isCommunity: true`）对所有用户可见，只有 admin 可创建/修改；个人面板仅 owner 可见。

### Q: 联邦社区能直接抓取对方内容吗？
A: 当前 Phase 6 MVP 不实现跨社区内容抓取（需联邦协议），仅做社区注册表 + UI 展示。后续阶段会实现。

### Q: 组件能调用 Daily 的 API 吗？
A: 能。组件在 Daily 域名下运行，fetch `/api/*` 会自动携带 cookie（Web 端已登录时）。但组件应优先用 AI 的 `storage_read/write` 工具做持久化。
