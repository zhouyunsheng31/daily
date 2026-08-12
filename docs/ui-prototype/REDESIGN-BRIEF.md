# Living Dashboard 双端 UI 原型重新设计任务书

> **本文档用途**：新会话的 AI 读完此文档后，直接开始重新设计双端 HTML 原型，无需再问背景。
> **创建时间**：2026-06-27
> **前置会话**：用户在上一会话中已验收过 v1/v2 两轮原型，发现多处设计偏差，决定双端都重做。

---

## 一、任务目标

为 Living Dashboard 项目的**桌面端**和**移动端**各做一个**高保真 HTML 交互原型**，让用户在浏览器里直接体验当前真实 UI 状态，并直观看到哪些页面缺设计。

**核心要求**：
1. 基于**实际代码** 1:1 还原已实现的页面（不是凭空设计）
2. 缺漏页面用虚线红框 + 角标标注
3. 必须真正使用 `huashu-design` 或 `open-design` skill 的设计能力（不只是读规范文件）
4. 产出后用 Playwright MCP 运行时验证 + 截图

---

## 二、项目背景

### 2.1 项目概况
- **项目名**：Living Dashboard
- **项目路径**：`f:\allmylife\event`
- **产品定位**：形态上是「浏览器 + 无限画布 + AI」，用途上是日常 AI 助手
- **双端技术栈**：
  - 桌面端：Electron + TypeScript + React，代码在 `client/desktop/src/`
  - 移动端：Kotlin + Jetpack Compose（Android 原生），代码在 `client/android/app/src/main/java/com/livingdashboard/`

### 2.2 关键文档路径

| 文档 | 路径 |
|------|------|
| 桌面端 roadmap | `docs/roadmap_desktop_v1.md` |
| 移动端 roadmap | `docs/roadmap_mobile_v1.md` |
| 桌面端布局设计 | `docs/layout-design-desktop.md`（**注意：此文档已过时，以代码为准**） |
| 移动端布局设计 | `docs/layout-design-mobile.md`（**注意：附录虚假声明 AiConfigScreen.kt 存在但实际不存在是错的，文件其实存在**） |
| Phase 8 spec（桌面） | `docs/specs/phase8-sidebar-ai-assistant.md` |
| Phase 9 spec（桌面） | `docs/specs/phase9-desktop-light-agent.md` |
| Phase M8 spec（移动） | `docs/specs/phase-m8-mobile-light-agent.md` |
| huashu-design skill | `f:\allmylife\shadowshubs\huashu-design\SKILL.md` |

### 2.3 各端 Phase 进度

**桌面端**：Phase 0-10 已完成，Phase 11/12 未做
- Phase 7：UI 视觉升级（白色洁净色系、pill 搜索框、透明组件、可拖拽分割线、收起式 AI 输入框、8 个 Tab）
- Phase 8：Sidebar AI 助手（5 个新组件：AIAssistantSidebar/AskUserCard/PermissionCard/DataSendPreviewCard/ApiConfigModal）
- Phase 9：单机轻 Agent（思考等级 UI、Agent 切换 UI、离线降级 UI 提示——**这三类 UI 实现状态需核实代码**）
- Phase 12.4：搜索引擎配置 tab（**未实现**）

**移动端**：M0-M8 已全部完成提交
- M0-M2：基础页面（BrowserHome/CanvasHome/Tabs/Bookmarks/History/Settings 等 14 个页面）
- M8：单机轻 Agent（commit `097ac66`，57 文件 9057 行，**已全部完成提交**）
  - `ai/` 目录 15 个核心文件（LlmClient/AgentLoop/ToolRegistry/Session/SkillLoader/ApiKeyStore/ThinkingLevel/RuntimeModeManager/LocalAgentService 等）
  - `ai/tools/` 目录 10 个工具
  - UI 层：AiConfigScreen / AiConfigViewModel / ProviderSelector / AgentModeSwitcher / AskUserDialog
  - 修改文件：build.gradle.kts（versionName=0.1.0-m8 + security-crypto 等依赖）/ AppModule.kt（13 个 @Provides）/ Routes.kt（ai_config 路由）/ SettingsScreen.kt（AI 配置入口）/ CanvasHomeViewModel.kt（onAiSend 调 LocalAgentService）/ CanvasHomeScreen.kt / AIInputPill.kt / AppNavGraph.kt
- **M9-M11 未做**（M9 发布/M10 自动化测试/M11 AI 搜索）

### 2.4 之前两轮原型的问题（必须避免）

**v1 问题**：
- 移动端 CanvasHome 被画成 AI 助手主页（实际应是无限画布形态）
- 没有召唤 AI 的入口
- 有"AI 对话"类说明性标语
- 思维链/工具调用全展开显示
- 底部工具栏不能自动收缩
- 思考等级用大按钮（应该用滑块）

**v2 问题**：
- **没有真正使用 huashu-design/open-design skill**，只是读了规范文件，设计质量明显下降
- 移动端分层画布画成了列表，不是 Apple Watch 风格的方圆形图标缩放
- 浏览器里 AI 入口用浮动球（用户觉得占视野、难消除）
- 没有还原"底部工具栏右下角点开 AI 助手"的最初设计
- 错误地把 M8 当成"开发中"假设"真实态 vs 占位态"对比（M8 实际已完成）
- 文件曾意外丢失（未及时 git add）

---

## 三、设计美学（必须遵循）

### 3.1 无边框美学（双端 roadmap 已写入）

> 元素与面板之间默认不画边框线、不为边框单独配色；面板间分隔首选靠两侧背景色差区分，必须分隔时优先用大圆角过渡，最后才退而用极淡描边线，禁止使用明显边框线。

优先级：**色块区分 > 圆角过渡 > 极淡线 > 禁止明显边框线**

### 3.2 反 AI slop（huashu-design 规范）

- 禁用紫渐变背景
- 禁用 emoji 图标
- 禁用"圆角卡片 + 左 border accent"模板
- 禁用 SVG 画 imagery
- 例外：Phase 8 源码中 AskUserCard/PermissionCard 的左色条是 1:1 还原，保留

### 3.3 桌面端视觉规范
- 白色洁净色系（背景 #FAFAFA，主表面 #FFFFFF）
- pill 形状（搜索框/输入框/Tab 标签/按钮组用 border-radius: 9999 或 24px）
- 透明/半透明组件 + 毛玻璃（backdrop-filter: blur(20px)）
- 可拖拽分割线
- 收起式 AI 输入框（idle/focused/expanded 三态）

### 3.4 移动端视觉规范
- **沉浸感**是移动端核心美学
- 原生优先（Kotlin + Compose 风格，参考 DeepSeek）
- 轻量优先
- 对称设计（浏览器主页和画布主页对称）

---

## 四、移动端设计要求

### 4.1 页面清单（基于已实现代码 1:1 还原）

**A. M0-M8 已实现页面（真实态，不是占位态）**

1. **BrowserHome**（浏览器主页）
   - 源码：`client/android/app/src/main/java/com/livingdashboard/ui/browser/BrowserHomeScreen.kt`
   - pill 搜索框 + 快捷链接

2. **CanvasHome**（画布主页——无限画布形态，不是 AI 主页）
   - 源码：`client/android/app/src/main/java/com/livingdashboard/ui/canvas/CanvasHomeScreen.kt`
   - **分层画布是 Apple Watch 风格**：双指缩放，组件三档渐变
     - 第一档：缩小到方圆形，只能看到图标（像 Apple Watch 网格）
     - 第二档：简化态，能看到缩小版本的组件
     - 第三档：完全放大，组件完全可用
   - AI 不是 CanvasHome 的主体，而是从画布召唤出来的

3. **Home 键 / 底部栏**
   - 源码：`client/android/app/src/main/java/com/livingdashboard/ui/canvas/CanvasHomeScreen.kt` 附近

4. **收藏组件**（Widget）
   - 源码：`client/android/app/src/main/java/com/livingdashboard/ui/widget/`

5. **TabsScreen**（标签页管理）
6. **BookmarksScreen**（书签）
7. **HistoryScreen**（历史记录）
8. **SettingsScreen**（5 分组 + AI 配置入口）
   - 源码：`client/android/app/src/main/java/com/livingdashboard/ui/settings/SettingsScreen.kt`
   - 已含 AI 配置入口（M8 已改）

9. **AiConfigScreen**（M8 已实现，不是缺漏）
   - 源码：`client/android/app/src/main/java/com/livingdashboard/ui/settings/AiConfigScreen.kt`
   - 5 provider 选择 + API Key + Endpoint + Model + 测试连接 + Skills 管理
   - **Models 旁要有"获取模型列表"按钮**
   - **API endpoint 要支持自动补全**（5 provider 预设：stepfun/openai/deepseek/anthropic/qwen）
   - **支持自定义 API**

10. **AgentModeSwitcher**（M8 已实现，不是缺漏）
    - 源码：`client/android/app/src/main/java/com/livingdashboard/ui/canvas/components/AgentModeSwitcher.kt`
    - CLOUD/LOCAL/AUTO 三档切换 + 思考等级
    - **思考等级用滑块（参考 github operit），4 档：快速/平衡/深度/极深度，不是按钮组**

11. **AskUserDialog**（M8 已实现，不是缺漏）
    - 源码：`client/android/app/src/main/java/com/livingdashboard/ui/canvas/components/AskUserDialog.kt`
    - 120s 超时选项框

**B. 浏览器网页中召唤 AI（关键设计）**

用户反馈：浮动球占视野、难消除。**两种方式可选**（设置里切换）：
- **方式 1（最初设计，必须还原）**：底部工具栏右下角点开 AI 助手入口
- **方式 2**：浮动 AI 球，但可拖动到边缘自动收起/可隐藏

**C. AI 对话交互规范**

- **无"AI 对话"类说明性标语**，空态背景显示"开始和 AI 对话吧"（淡灰色、居中、大字号）
- **思维链自动收缩**：默认折叠，只显示"已思考 Ns"，可点击展开
- **工具调用折叠显示**：
  - 顶部：渐变流动条（颜色清淡，浅蓝→浅紫渐变，CSS 动画流动）
  - 条下方："工具执行了 N 次"
  - 再下方：状态文字"思考中..."/"命令执行中..."/"写入文件..."等

**D. PermissionCard（M8 已实现）**
- 源码：`client/android/app/src/main/java/com/livingdashboard/ai/tools/AskUserTool.kt` 相关
- 橙色普通权限 + 红色危险操作
- **增加"添加到白名单"按钮**（淡色但不抢戏）

**E. SettingsScreen 增加"全允许模式"开关**
- 开启后所有工具调用不再弹 PermissionCard
- 风险提示文字"开启后所有工具调用将自动执行，不再询问"

**F. 底部工具栏自动收缩（沉浸感核心）**
- 浏览器网页视图：用户向下滑动时，地址栏 + 底部工具栏自动收起（CSS transition + translateY）
- 用户向上滑一下时，工具栏自动唤起
- 收起后网页内容占满全屏

### 4.2 缺漏页面（虚线红框 + 角标）

- M9 发布相关 UI（未实现）
- M10 自动化测试相关 UI（未实现）
- M11 AI 搜索相关 UI（未实现）

---

## 五、桌面端设计要求

### 5.1 页面清单（基于已实现代码 1:1 还原）

**A. 已实现页面**

1. **BrowserHome**（浏览器主页）
   - 源码：`client/desktop/src/components/BrowserHome.tsx`
   - 72px Logo + pill 搜索框 + 圆形书签

2. **CanvasHome**（画布主页）
   - 源码：`client/desktop/src/components/CanvasHome.tsx`
   - 80x80 logo + 收起式 AI 对话框三态切换 + 收藏组件网格

3. **Sidebar canvas 模式**（画布面板库，240px 展开 / 48px 折叠）
   - 源码：`client/desktop/src/components/Sidebar.tsx`

4. **Sidebar ai-assistant 模式**
   - 源码：同上

5. **SettingsPanel**（8 Tab）
   - 源码：`client/desktop/src/components/SettingsPanel.tsx`
   - Tab：外观/行为/动效与无障碍/收藏管理/快捷键/数据管理/服务器/AI 配置
   - **AI 配置 Tab 增加"全允许模式"开关**

6. **Omnibox**（地址栏）
   - 源码：`client/desktop/src/components/Omnibox.tsx`
   - placeholder "输入 URL、搜索内容、/ 命令"（ai: 已删除）

7. **AIAssistantSidebar**
   - 源码：`client/desktop/src/components/AIAssistantSidebar.tsx`
   - 会话选择器 + 等待徽章 + 对话流 + model 切换
   - **顶部明确显示"当前面板：XXX · 会话独立"**（每个面板独立 AI 会话，不是"Agent 角色"概念）
   - **思考等级用滑块**（参考 operit）

8. **AskUserCard**
   - 源码：`client/desktop/src/components/AskUserCard.tsx`
   - 紫色左色条 + 单选/多选

9. **PermissionCard**
   - 源码：`client/desktop/src/components/PermissionCard.tsx`
   - 橙色普通 + 红色危险操作
   - **增加"添加到白名单"按钮**

10. **ApiConfigModal**
    - 源码：`client/desktop/src/components/ApiConfigModal.tsx`
    - 预设列表 + 编辑区 + models chip 增删
    - **Models 旁"获取模型列表"按钮**
    - **endpoint 自动补全**（5 provider 预设）
    - **支持自定义 API**

**B. 不要展示的组件**
- **DataSendPreviewCard**：用户明确说"没必要有这个东西"，原型不展示（源码是否删除后续再议）

**C. AI 对话交互规范**（同移动端）
- 无"AI 对话"类说明性标语，空态"开始和 AI 对话吧"
- 思维链自动收缩
- 工具调用折叠 + 渐变流动条 + 状态文字

### 5.2 缺漏页面（虚线红框 + 角标）

1. **Phase 9 思考等级 UI** —— 用水平滑块（4 档：快速/平衡/深度/极深度），参考 operit，不是按钮组
2. **Phase 9 Agent 切换 UI**（Pi Agent ↔ 单机轻 Agent）—— **注意：不是"Agent 角色"概念**，是 Agent 类型切换
3. **Phase 9 离线降级 UI 提示**
4. **Phase 12.4 搜索引擎配置 tab**（SettingsPanel 新增 tab，展示 bocha/semanticScholar/github 三个 provider）
5. **历史记录独立页面**（layout-design-desktop.md:861 自承认缺失）
6. **脚本管理 UI**（layout-design-desktop.md:880 自承认双端未实现）

---

## 六、技术规范

### 6.1 文件结构
- **桌面端输出**：`f:\allmylife\event\docs\ui-prototype\desktop\index.html`
- **移动端输出**：`f:\allmylife\event\docs\ui-prototype\mobile\index.html`
- 单文件 inline React（`<script type="text/babel">` 内联所有 JSX）
- 双击即可打开（file:// 协议可直接运行）
- 不要用外部 jsx 文件（file:// 协议会跨域拦截）

### 6.2 CDN（pinned 版本 + integrity hash）
- React 18.3.1 + React-DOM 18.3.1 + @babel/standalone 7.29.0
- 参考 `f:\allmylife\shadowshubs\huashu-design\references\react-setup.md`

### 6.3 设备框
- 桌面端：用 macos_window / browser_window 组件（`f:\allmylife\shadowshubs\huashu-design\assets\`）
- 移动端：用 android_frame 组件
- 平铺多个设备框，每个上方 italic 小字标签
- 缺漏页面用虚线红色边框 + 右上角"缺设计"角标

### 6.4 必须真正使用 skill

**关键**：这次必须真正调用 `huashu-design` 或 `open-design` skill 的设计能力，不只是读规范文件。
- 用 `Skill` 工具加载 skill
- 按 skill 指引使用其组件库和设计方法论
- 参考其反 AI slop 清单和 Junior Designer 工作流

---

## 七、operit 思考等级滑块参考

- operit 仓库：github.com/AAswordman/Operit
- 用 Jetpack Compose `Slider` 实现 4 档离散思考等级
- 设计要点：
  - 水平 track + 4 个 tick 刻度
  - thumb 居中于当前档位
  - 下方显示档位描述（快速/平衡/深度/极深度）
  - thumb 有 `cubic-bezier(0.4,0,0.2,1)` 过渡动画
- 不是按钮组，不是 segmented control

---

## 八、验证要求（必须运行时验证，不能只读代码）

### 8.1 文件保护
- 文件创建后**立即 git add**：`git -C f:\allmylife\event add docs/ui-prototype/desktop/index.html docs/ui-prototype/mobile/index.html`
- 防止文件再次意外丢失

### 8.2 Playwright MCP 验证
用 MCP Playwright 工具（不是 npx playwright，会自动安装违反用户规则）：
- `playwright_navigate`（waitUntil: load，timeout: 90000，因为 Babel 转换慢）
- `playwright_evaluate`（验证关键元素）
- `playwright_screenshot`（fullPage，保存到 .screenshots 目录）

### 8.3 验证项（双端都要验证）

**移动端**：
- root.children.length > 0
- CanvasHome 是画布形态（不是 AI 主页）
- 分层画布是 Apple Watch 风格（方圆形图标缩放，三档）
- 底部工具栏右下角 AI 助手入口存在
- 浮动 AI 球可选（且可隐藏/收起）
- 无"AI 助手/对话助手"标语（"开始和 AI 对话吧"空态文案除外）
- 思维链 .thinking-collapsed
- 工具调用 .tool-flow-bar + "工具执行了"
- 底部工具栏 .autoHideBar
- PermissionCard .whitelist-btn
- "全允许模式"开关
- .thinking-slider-thumb（滑块，不是按钮）
- "获取模型列表"按钮
- M8 页面展示真实态（不是占位态 vs 真实态对比）

**桌面端**：
- root.children.length > 0
- 无 DataSendPreview 展示
- 无"Agent 角色"概念
- 有"会话独立"提示
- 无"AI 助手/对话助手"标语
- "开始和 AI 对话吧"空态
- "已思考"折叠
- "工具执行了"折叠
- "添加到白名单"按钮
- "全允许模式"开关
- .thinking-slider-thumb
- "获取模型列表"按钮

### 8.4 截图
- 保存到 `docs/ui-prototype/{desktop,mobile}/.screenshots/`
- fullPage: true

---

## 九、工作流程

1. **读取本文档**（你正在做）
2. **用 Skill 工具加载 huashu-design 或 open-design**（必须真正调用）
3. **读取实际源码**（不要凭空设计，基于代码 1:1 还原）
4. **用 TodoWrite 管理进度**
5. **产出双端 HTML 原型**
6. **立即 git add**
7. **用 Playwright MCP 运行时验证**
8. **截图保存**
9. **向用户展示并等待验收**

---

## 十、用户偏好提醒

- 沟通语言：中文
- 不要在 C 盘下载/存储文件（截图等放 F 盘）
- 开发语言优先 TypeScript
- 项目必须用 git 做版本管理
- 所有具体任务交给 sub-agent 并行执行，主线程只做顶层设计和验收
- 有任何问题就向用户提问，不要标记任务结束
- 审核要么完全合格，要么不合格，禁止"基本合格"
- 回答问题要简答

---

## 十一、关键约束

1. **不要修改项目源代码**
2. **不要修改 roadmap/layout-design 文档**（文档修复是后续任务）
3. **只产出 HTML 原型文件 + 截图**
4. **必须真正使用 skill**（v2 的失败教训）
5. **M8 已完成，展示真实态**（不要假设占位态对比）
6. **文件创建后立即 git add**（v2 文件丢失教训）
7. **必须运行时验证**（不能只读代码）

---

## 十二、参考路径速查

| 用途 | 路径 |
|------|------|
| 项目根 | `f:\allmylife\event` |
| 桌面端代码 | `f:\allmylife\event\client\desktop\src\` |
| 移动端代码 | `f:\allmylife\event\client\android\app\src\main\java\com\livingdashboard\` |
| 文档目录 | `f:\allmylife\event\docs\` |
| 原型输出目录 | `f:\allmylife\event\docs\ui-prototype\` |
| huashu-design skill | `f:\allmylife\shadowshubs\huashu-design\SKILL.md` |
| Playwright 运行时 | `node "F:\Operit_workspace_full_backup\workspace_backup\.mcp-playwright-runtime\playwright-cli.js" run <script>` |
| gradle 路径 | `F:\allmylife\gradle-8.2-bin` |
| java 路径 | `D:\Java` |
| Android SDK | `F:\Android SDK` |

---

**本文档已包含新会话重新设计所需的全部信息。新会话读完此文档后，直接开始执行，不要再问背景问题。**
