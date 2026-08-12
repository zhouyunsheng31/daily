# Daily 组件开发规范

> 配套：[developer-guide.md](developer-guide.md) · [api-reference.md](api-reference.md)

Daily 的"组件"是运行在画布上的 HTML 单元。本文档定义组件的接口、约束、能力与开发方式。

---

## 1. 两类组件

Daily 支持两类组件，均以 HTML 为载体，在 sandbox iframe 中渲染：

| 类型 | 形状 | 交互 | 定位 | 适用场景 |
|---|---|---|---|---|
| **iframe widget** | 矩形 | 可拖拽、可调整大小、可最小化 | `x/y/width/height` | 工具型（PDF阅读器、计时器、计算器） |
| **自由 HTML 组件** | 任意 | 自由移动（不可缩放） | `x/y` + 自身布局 | 装饰型、贴纸、手绘标注 |

两类组件共享同一套存储（`widgets` 表），通过 `type` 字段区分：
- `type: 'htmlCanvas'` → iframe widget
- `type: 'freeHtml'` → 自由 HTML 组件

---

## 2. 组件接口

### 2.1 数据结构

组件在 `widgets` 表中的关键字段：

```typescript
interface Widget {
  id: string
  panelId: string
  type: string                  // 'htmlCanvas' | 'freeHtml' | 自定义类型
  x: number                     // 画布坐标 X
  y: number                     // 画布坐标 Y
  width: number                 // iframe widget 必填；自由组件可忽略
  height: number                // iframe widget 必填；自由组件可忽略
  zIndex: number
  minimized: boolean
  locked: boolean
  colorScheme?: string          // 配色方案
  state: Record<string, unknown>  // 组件状态（JSON）
  isPrimary: boolean            // 是否主组件
  version: number
}
```

### 2.2 state 约定

`state.html`（string）：组件的 HTML 代码，是组件的核心内容。iframe widget 和自由组件都通过此字段存储 HTML。

其他 state 字段由组件自定义，例如：
```json
{
  "html": "<div>...</div>",
  "title": "我的组件",
  "lastEdited": 1783000000000
}
```

### 2.3 动态组件（dynamic_widgets 表）

可复用组件存入 `dynamic_widgets` 表，供多次实例化：

```typescript
interface DynamicWidget {
  widgetType: string            // 唯一标识（如 'weather'）
  displayName: string
  icon: string                  // 图标名（lucide）
  defaultLayout: { width, height }
  defaultState: Record<string, unknown>
  code: string                  // HTML 代码模板
  componentEnv: 'pure-frontend' | 'local-service'  // 运行环境
  localServices?: object        // 依赖的本地服务
  crossPlatform: boolean        // 是否跨平台
  desktopOnly: boolean          // 是否仅桌面端
}
```

---

## 3. 组件约束

### 3.1 沙箱限制

组件在 `<iframe sandbox="allow-scripts">` 中渲染：

- ✅ 可执行任意 JavaScript
- ✅ 可读写自身 DOM
- ✅ 可发网络请求（fetch/XHR，受目标服务器 CORS 限制）
- ❌ 不能访问 `parent` / `top`（同源策略隔离）
- ❌ 不能使用 `alert` / `confirm` / `prompt`（sandbox 禁止）
- ❌ 不能读写 Daily 的 cookie / localStorage（隔离）
- ❌ 不能访问 Node.js API（纯浏览器环境）

### 3.2 大小限制

- 单个组件 HTML 代码建议 < 100 KB（`express.json` limit 100MB 是全局上限，但过大影响性能）
- 组件实例数量无硬性上限，但单面板 > 100 个时视口虚拟化会生效

### 3.3 安全约束

- 禁止内联事件绑定外部恶意脚本（`<script src="http://evil">`）
- 禁止 `eval` 执行来自不可信源的字符串
- 网络请求目标应使用 HTTPS
- 不要在 HTML 中硬编码密钥（组件代码对所有可见用户公开）

---

## 4. 组件能力

### 4.1 能力声明

组件可通过 `component_capabilities` 表声明能力，供 Daily 做权限/兼容性判断：

```typescript
interface ComponentCapability {
  widgetType: string            // 主键
  displayName: string
  description: string
  api: string[]                 // 需要的 API 权限，如 ['fetch:weather']
  dependencies: string[]        // 依赖的本地服务名
  version: string
  componentEnv: 'pure-frontend' | 'local-service'
  crossPlatform: boolean
  desktopOnly: boolean
}
```

### 4.2 运行环境分类

| 环境 | 说明 | 示例 |
|---|---|---|
| `pure-frontend` | 纯前端，无后端依赖 | 计算器、贴纸、静态展示 |
| `local-service` | 依赖用户本地服务（通过 server 中转） | 文件浏览器、本地数据库查询 |

`local-service` 类组件需在 `localServices` 中声明依赖，Daily 会通过本地服务代理（`/proxy/*`）中转请求。

### 4.3 跨平台标记

- `crossPlatform: true` → Web/桌面/移动端均可
- `desktopOnly: true` → 仅桌面端（如需要文件系统访问）

---

## 5. iframe widget 开发指南

### 5.1 基本结构

iframe widget 是一个完整的 HTML 片段，渲染在固定尺寸的 iframe 中：

```html
<!-- weather.html：天气 widget -->
<div style="font-family:sans-serif;padding:12px">
  <div style="display:flex;align-items:center;gap:8px">
    <span style="font-size:24px">☀️</span>
    <div>
      <div style="font-size:20px;font-weight:600" id="temp">--°</div>
      <div style="font-size:11px;color:#888" id="city">加载中...</div>
    </div>
  </div>
</div>
<script>
  // 组件初始化逻辑
  async function loadWeather() {
    try {
      const res = await fetch('https://api.example.com/weather')
      const data = await res.json()
      document.getElementById('temp').textContent = data.temp + '°'
      document.getElementById('city').textContent = data.city
    } catch (e) {
      document.getElementById('city').textContent = '获取失败'
    }
  }
  loadWeather()
</script>
```

### 5.2 状态持久化

组件如需保存状态（如用户输入），可向 Daily 发消息请求存储。当前通过 AI Agent 的 `storage_read` / `storage_write` 工具间接实现，或通过 REST API（需鉴权）：

```javascript
// 通过 Daily API 读写 KV（需要 Web 端已登录，cookie 自动携带）
await fetch('/api/settings/my-widget-state', {
  method: 'PUT',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ value: { lastCity: 'Beijing' } })
})
```

### 5.3 自适应尺寸

iframe widget 有固定 `width/height`，组件应适配容器：
```css
html, body { margin: 0; height: 100%; }
.root { width: 100%; height: 100%; }
```

---

## 6. 自由 HTML 组件开发指南

### 6.1 特点

- 无固定矩形边界，可任意形状
- 仅 `x/y` 定位，无 `width/height`（由内容自然撑开）
- 适合：贴纸、手绘、装饰元素、自由排版文字

### 6.2 示例

```html
<!-- note.html：便利贴自由组件 -->
<div style="
  display:inline-block;
  background:#FFF9C4;
  padding:12px 16px;
  border-radius:4px;
  box-shadow:2px 2px 6px rgba(0,0,0,0.15);
  font-family:'Comic Sans MS',cursive;
  transform:rotate(-2deg);
  max-width:200px;
">
  <div contenteditable style="outline:none;min-height:20px">点这里写笔记...</div>
</div>
```

### 6.3 与 iframe widget 的区别

| 维度 | iframe widget | 自由 HTML 组件 |
|---|---|---|
| type | `htmlCanvas` | `freeHtml` |
| 尺寸 | 固定矩形 | 自然撑开 |
| 缩放 | 可调整 width/height | 不可缩放 |
| z-index | 独立层 | 独立层 |
| 渲染 | sandbox iframe | sandbox iframe |

---

## 7. 上传组件

### 7.1 通过 API 上传

```bash
curl -X POST http://localhost:3456/api/dynamic-widgets \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $SERVER_TOKEN" \
  -d '{
    "widgetType": "weather",
    "displayName": "天气",
    "icon": "cloud-sun",
    "defaultLayout": { "width": 240, "height": 120 },
    "defaultState": {},
    "code": "<div>...HTML代码...</div>",
    "componentEnv": "pure-frontend",
    "crossPlatform": true
  }'
```

### 7.2 通过画布手动上传

在画布右下角 `+` 按钮中：
- 粘贴 HTML 代码
- 或拖拽 `.html` 文件

### 7.3 声明能力（可选）

上传组件后可声明能力：

```bash
curl -X POST http://localhost:3456/api/component-capabilities \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $SERVER_TOKEN" \
  -d '{
    "widgetType": "weather",
    "displayName": "天气",
    "description": "显示实时天气",
    "api": ["fetch:weather"],
    "dependencies": [],
    "componentEnv": "pure-frontend",
    "crossPlatform": true
  }'
```

---

## 8. 调试技巧

### 8.1 本地预览

直接在浏览器打开 `.html` 文件预览基本效果（注意 sandbox 限制与 Daily 内可能不同）。

### 8.2 在 Daily 画布调试

组件渲染后，在 iframe 上右键 → "检查"可打开 DevTools（开发模式下）。查看 console 报错。

### 8.3 常见问题

| 问题 | 原因 | 解决 |
|---|---|---|
| 组件空白 | HTML 语法错误 | 检查 console |
| fetch 失败 | CORS 限制 | 目标服务器需允许 Daily 域名 |
| alert 不弹 | sandbox 禁止 | 改用 DOM 提示 |
| 样式被覆盖 | 全局 CSS 冲突 | 组件根元素用唯一 class/id |

---

## 9. 示例组件库

参考 `server/src/db/seed.ts` 中的内置面板模板，包含若干示例组件代码。

---

## 10. 最佳实践

1. **纯函数优先**：组件逻辑尽量无状态，状态交给 Daily 存储
2. **小而美**：单个组件做一件事，复杂功能拆成多个组件
3. **优雅降级**：网络请求失败时显示占位内容
4. **响应式**：用 `100%` 适配容器，不要硬编码像素
5. **无障碍**：关键交互元素加 `aria-label`
