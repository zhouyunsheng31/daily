---
name: product-guide
description: Living Dashboard 产品使用指南，帮助 AI 助手了解产品功能、使用方式、交互逻辑，从而更好地辅助用户
version: 1.0.0
---

# Living Dashboard 产品使用指南

## 一、产品定位

Living Dashboard 是一个**日常 AI 助手**。

形态上是"浏览器 + 无限画布 + AI"，但功能用途上是用户的日常 AI 助手。AI 贯穿浏览器和画布，随时可用。

### 核心价值
- **浏览器**：上网工具，支持 AI 操控（点击/输入/截图/提取内容）
- **无限画布**：个人数据管理，组件可自由摆放、连线、缩放
- **AI 助手**：每个面板独立 AI，可操控浏览器和画布，基于当前网页对话
- **多端互通**：桌面端（Windows）和移动端（Android）数据共享

---

## 二、产品形态

### 2.1 两种主页

| 主页 | 用途 | 内容 |
|------|------|------|
| **浏览器主页** | 上网入口 | 搜索框 + Logo/书签一体 + 常用网站（可预览） |
| **画布主页** | 数据管理入口 | AI 对话框 + 圆形图标 + 收藏组件（可预览） |

### 2.2 导航逻辑

**桌面端**：
- 上方 TabBar 管理网页标签，左侧 Sidebar 管理画布面板
- 新建网页标签 → 浏览器主页
- 新建画布面板 → 画布主页
- 没有 Home 键，通过新建标签/面板进入主页

**移动端**：
- Home 键切换两种主页
- 看网页时点 Home → 回浏览器主页
- 画布模式时点 Home → 回画布主页
- 在主页时点 Home → 切换到另一主页

### 2.3 网页与画布的关系

- **双向转换**：网页可嵌入画布成为组件，画布组件可拖出成为网页标签
- **嵌入按钮**（桌面端）：网页标签点 📌 → 在当前画布创建组件，标签不关闭（引用关系）
- **五五开**：浏览器和画布是对等的，不是画布优先

---

## 三、核心功能

### 3.1 浏览器

- 基于 WebView 的真实浏览器（桌面端 Electron webview，移动端 Android WebView）
- 标签页/书签/历史/Cookie 管理
- AI 可操控：点击、输入、截图、提取内容、导航、Cookie 操作等
- 可设为系统默认浏览器

### 3.2 无限画布

- 面板 = 画布（共生关系）
- 组件可拖拽、调整大小、连线
- 分层画布（移动端）：双指缩放，缩小看卡片摘要，放大看完整组件
- 每个面板独立 AI 助手

### 3.3 AI 助手

- **按面板独立上下文**：同一面板多端共享上下文，不同面板独立
- **多端并行**：不同面板可同时 AI 操作
- **AI 入口**：
  - 画布上的 AI 助手组件
  - 画布主页 AI 对话框（类 Tabbit，可导航/创建面板）
  - 地址栏 `ai:` 命令（桌面端）
  - 底部栏 AI 输入框模式（移动端）
- **AI 能力**：
  - 操控浏览器（18 个 browser_* 工具）
  - 操控画布（创建/更新/删除组件，读写存储）
  - 基于当前网页内容对话/分析/操作
  - 导航到不同面板/网页
  - 创建新面板（必须同时创建一个组件）

### 3.4 脚本系统

- **兼容油猴脚本**：导入 GreasyFork `.user.js` 文件
- **AI 生成脚本**：用户对话 → AI 生成脚本 → 自动保存 → 长期使用
- **常驻 UI**：脚本可注入常驻 UI（如翻译插件悬浮窗）
- **GM_* API**：GM_addStyle/GM_xmlhttpRequest/GM_setValue/getValue 等
- **多端同步**：脚本库存服务器，多端共享

### 3.5 收藏组件

- 跨面板收藏组件
- 主页显示图标 + 预览
- 点击跳转到对应面板的对应组件位置
- 移动端：点击打开 WebOS 风格页（几乎全屏）

### 3.6 动态组件

- 用户可用 HTML/JS/CSS 写自定义组件
- AI 也可生成组件
- **纯前端组件**可跨端共享（桌面端 iframe，移动端 WebView）
- **依赖本地环境组件**（如调本地笔记 API）标记为仅桌面端

### 3.7 数据导入

- 书签 HTML 导入（Netscape 格式，通用）
- 笔记数据导入（分享机制 / 文件解析 / 云端 API）
- 密码保存（登录时捕获，自动填充）

### 3.8 多端数据同步

- 服务器权威 + 本地缓存
- 离线时降级写本地，恢复后自动同步
- AI 对话历史按面板多端共享

---

## 四、内置组件

| 组件 | 功能 |
|------|------|
| AIAssistant | AI 助手，每面板独立 |
| WebviewWidget | 网页组件，可被 AI 操控 |
| Calculator | 计算器 |
| FocusTimer | 专注计时器 |
| HtmlCanvasWidget | HTML 画布组件（用户自定义 HTML/JS/CSS） |
| LatexQuiz | LaTeX 测验 |
| MusicPlayer | 音乐播放器 |
| PdfViewer | PDF 查看器 |
| Sudoku | 数独 |

---

## 五、设置

### 5.1 外观
- 主题预设（18 个）、背景（纯色/渐变/图片）、颜色、透明度、字体大小

### 5.2 行为
- 布局模式、删除确认、组件吸附

### 5.3 数据管理
- 导出/导入 JSON 备份

### 5.4 服务器
- 设备 ID、API Base URL、WS URL、服务器 Token

### 5.5 AI 配置
- **API 配置**：模型选择、API Key、Endpoint、连接测试
- **提示词配置**：系统/画布/浏览器提示词，可编辑，有默认值
- **Skills 管理**：列出/启用/禁用/查看/添加/删除 skills
- **工具管理**：列出/启用/禁用 24 个工具（高级）

---

## 六、AI 工具列表

### 6.1 画布/存储工具（6 个）

| 工具 | 功能 |
|------|------|
| create_html_widget | 创建 HTML 组件 |
| update_html_widget | 更新 HTML 组件 |
| delete_html_widget | 删除 HTML 组件 |
| list_widgets | 列出画布所有组件 |
| storage_read | 读取 KV 存储 |
| storage_write | 写入 KV 存储 |

### 6.2 浏览器工具（18 个）

| 工具 | 功能 |
|------|------|
| browser_eval | 执行 JS 脚本 |
| browser_get_dom | 获取 DOM |
| browser_click | 点击元素 |
| browser_input | 输入文本 |
| browser_scroll | 滚动 |
| browser_wait_for | 等待条件 |
| browser_screenshot | 截图 |
| browser_navigate | 导航到 URL |
| browser_get_url | 获取当前 URL |
| browser_get_title | 获取页面标题 |
| browser_back / browser_forward / browser_reload | 导航控制 |
| browser_get_cookie / browser_set_cookie | Cookie 操作 |
| browser_open | 打开新网页 |
| browser_switch_tab / browser_list_tabs | 标签页管理 |

---

## 七、使用场景示例

### 场景 1：AI 帮我操作网页
> 用户："帮我在百度搜索'天气'，然后截图给我"
> AI：browser_navigate → browser_input → browser_click → browser_screenshot

### 场景 2：AI 基于网页对话
> 用户在看一篇英文文章，说："帮我总结这篇文章"
> AI：browser_get_dom → 提取正文 → 总结

### 场景 3：AI 创建组件
> 用户："帮我创建一个待办列表组件"
> AI：create_html_widget（生成 HTML/JS/CSS）

### 场景 4：AI 生成脚本
> 用户："帮我把知乎的回答按点赞数排序"
> AI：生成油猴脚本 → 自动保存 → 下次打开知乎自动生效

### 场景 5：多端协作
> 用户在桌面端面板1和 AI 对话，切换到手机继续
> 手机打开同一面板1，AI 上下文延续，可继续对话

### 场景 6：日常 AI 助手
> 用户："帮我记一下明天开会"
> AI：create_html_widget（创建备忘组件）或 storage_write（存笔记）

---

## 八、注意事项

- AI 上下文按面板隔离，不同面板的对话不互相干扰
- 同一面板多端共享上下文，最后操作的设备负责执行 AI 工具调用
- 依赖本地环境的组件（如调本地服务）不能跨端使用
- 离线时画布/组件可用，但 AI 不可用（AI 在服务器）
- 脚本系统兼容油猴脚本，但不支持 Chrome 扩展
