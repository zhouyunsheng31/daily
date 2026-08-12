# Phase 7 Spec：打磨优化（长期）

> 生成日期：2026-06-25（v2，已通过对抗审查修复 35 个问题）
> 依据：[roadmap_desktop_v1.md](file:///f:/allmylife/event/docs/roadmap_desktop_v1.md) Phase 7
> 布局依据：[layout-design-desktop.md](file:///f:/allmylife/event/docs/layout-design-desktop.md) v2
> 产品依据：[desktop_product_design.md](file:///f:/allmylife/event/docs/desktop_product_design.md)
> 前置：Phase 0-6 全部已完成
>
> **范围**：10 个任务全部完成（用户已明确授权，包含文档任务），按依赖关系分 7 批推进。每批完成后单独对抗审查 + git commit，最后统一生成 exe 安装包。
>
> **路径说明**：所有文件路径基于项目根目录 `f:\allmylife\event\`。`electron.vite.config.ts`、`package.json`、`electron-builder.yml` 在根目录；其他在 `client/desktop/`。

---

## 一、项目背景

### 1.1 产品定位
Living Dashboard 桌面端 = 浏览器 + 无限画布 + AI，形态上是日常 AI 助手。浏览器与画布五五开，AI 贯穿两者。

### 1.2 当前状态（Phase 0-6 已完成）
- 双轨管理（webTabs + panels）已落地
- 收藏组件、网站预览、主页定制已完成
- 内存休眠策略（PanelMemoryManager）已实现
- 依赖本地环境组件跨端（服务器中转方案A）已实现
- AI 配置 Tab（API/提示词/Skills）已完成
- 毛玻璃效果已多处使用（index.css 中 `backdrop-filter` 多处）
- App.tsx 第 195-293 行 useEffect 启动时从 settings.appearance 读取颜色并 `root.style.setProperty` 覆盖 :root CSS 变量
- types/index.ts 中 DEFAULT_APPEARANCE 定义默认外观（当前暗色 `#09090b`）
- main/index.ts createAppMenu 已定义菜单 accelerator（CmdOrCtrl+N/B/Shift+N）
- App.tsx 第 84-93 行已有独立 Ctrl+F 监听
- SitePreview.tsx 使用 `<webview>` 标签渲染缩略图
- FavoriteWidgetPreview.tsx 渲染真实组件，无 frozen prop
- useAppStore.ts 有 sidebarCollapsed state，Sidebar.tsx 重度依赖

### 1.3 Phase 7 目标
体验优化 + 功能补全 + 视觉升级。具体 16 项快捷键新增 + 视觉升级 + 功能补全：
1. 主页切换动画
2. 预览性能优化
3. 嵌入按钮交互优化
4. 收藏组件管理（排序/分组/搜索）
5. 主页模板
6. 快捷键完善（16 个新增快捷键）
7. 设置完善
8. 性能优化
9. UI 视觉升级
10. 文档（用户已授权创建）

### 1.4 约束条件
- TypeScript 优先
- 不下载到 C 盘
- git 版本管理（每批 commit，新建 `feature/phase7` 分支）
- 与移动端数据互通（共享服务器数据库，新字段需向后兼容）
- 不破坏 Phase 0-6 已完成功能
- 所有改动须通过 `npm run typecheck` + `npm run build`
- 对抗审查必须包含运行时验证（Electron + Playwright CDP 方案，见第十四章）

---

## 二、执行批次与依赖关系

```
批次 1：UI 视觉升级（任务9）  ← 底层基础，影响后续所有视觉
   ↓
批次 2：主页切换动画（任务1）+ 嵌入按钮交互优化（任务3）  ← 并行，依赖批次1的组件结构
   ↓
批次 3：收藏组件管理（任务4）+ 快捷键完善（任务6）  ← 并行，独立功能
   ↓
批次 4：设置完善（任务7）  ← 依赖批次3的收藏管理/快捷键子Tab
   ↓
批次 5：预览性能优化（任务2）+ 性能优化（任务8）  ← 并行，性能相关
   ↓
批次 6：主页模板（任务5）  ← 依赖主页UI稳定
   ↓
批次 7：文档（任务10）  ← 最后，所有功能已定稿（用户已授权）
```

每批完成后：对抗审查（含运行时验证）→ git commit → 下一批。

### 2.1 Git 策略
- 新建分支 `feature/phase7`（从 main）
- 每批用 conventional commit：`feat(phase7-batchN): <description>`
- 最终合并到 main 并打 tag `v0.7.0-phase7`
- 不主动 push，除非用户要求

---

## 三、批次 1：UI 视觉升级（任务9）

### 3.1 目标
按 [layout-design-desktop.md](file:///f:/allmylife/event/docs/layout-design-desktop.md) 第六章设计规范，统一视觉风格：
- 白色洁净色系为默认
- 无边框、半透明背景、毛玻璃效果
- pill 形状统一
- 可拖拽分割线
- 收起式 AI 输入框

### 3.2 任务分解

#### 3.2.1 默认主题切换为白色洁净色系
**文件**：
- `client/desktop/src/index.css`
- `client/desktop/src/types/index.ts`（**关键：DEFAULT_APPEARANCE 同步修改**）
- `client/desktop/src/App.tsx`（第 191-193 行 fallback 值改为亮色）

**改动**：
- `:root` 中默认值改为亮色（当前是暗色 `#1C1C1E`）
- 新增 `--radius-full: 9999px` Token
- 新增 `--spacing-xs/sm/md/lg/xl/2xl/3xl` 间距 Token
- 新增 `--radius-xs/sm/md/lg/xl/2xl/full` 圆角 Token
- `types/index.ts` 的 `DEFAULT_APPEARANCE` 改为亮色色值
- `App.tsx` 第 191-193 行 fallback 值（`'#09090b'` 等）改为亮色
- `prefers-color-scheme: dark` 时自动切换暗色（保留现有手动切换逻辑）
- **保留用户主题偏好**：已有用户设置不变，仅首次启动默认亮色

**默认色值**（设计文档 6.5 节）：
```css
:root {
  --bg-canvas: #f5f5f7;
  --bg-surface: #ffffff;
  --bg-elevated: #f0f0f2;
  --bg-hover: rgba(0,0,0,0.05);
  --bg-active: rgba(0,0,0,0.08);
  --text-primary: #1d1d1f;
  --text-secondary: #86868b;
  --text-tertiary: #adb5bd;
  --border-default: rgba(0,0,0,0.12);
  --border-subtle: rgba(0,0,0,0.08);
  --toolbar-bg: rgba(255,255,255,0.88);
  --glass-bg: rgba(255,255,255,0.72);
  --glass-blur: 20px;
  --glass-border: rgba(255,255,255,0.18);
  --radius-full: 9999px;
  /* 间距 Token */
  --spacing-xs: 4px;
  --spacing-sm: 8px;
  --spacing-md: 12px;
  --spacing-lg: 16px;
  --spacing-xl: 24px;
  --spacing-2xl: 32px;
  --spacing-3xl: 48px;
  /* 圆角 Token */
  --radius-xs: 4px;
  --radius-sm: 8px;
  --radius-md: 12px;
  --radius-lg: 16px;
  --radius-xl: 24px;
  --radius-2xl: 32px;
}
```

**第一版落地色系**（设计文档 6.5 节"白色洁净"）：
- 页面背景：纯白 `#ffffff` 或极浅灰 `#fafafa`
- 组件卡片：`rgba(0,0,0,0.03)` 半透明背景，无边框
- 搜索框/输入框：`rgba(0,0,0,0.04)` 半透明背景，聚焦时 `rgba(0,0,0,0.06)`
- 消息气泡：用户消息 `rgba(0,0,0,0.05)`，AI 回复 `rgba(0,0,0,0.03)`
- 工具栏/底栏：`rgba(255,255,255,0.85)` 毛玻璃，无边框
- 侧边栏：`rgba(255,255,255,0.6)` 毛玻璃，无边框
- 分割线：`rgba(0,0,0,0.06)`，1px

#### 3.2.2 新增 ResizableDivider 组件
**文件**：`client/desktop/src/components/ResizableDivider.tsx`（新建）

**职责**：可拖拽分割线，支持水平/垂直两种方向

**接口**：
```typescript
interface ResizableDividerProps {
  direction: 'horizontal' | 'vertical'
  onResize: (delta: number) => void
  onReset?: () => void  // 双击重置
  minSize?: number
  maxSize?: number
  currentSize?: number
}
```

**交互**：
- 鼠标悬停显示拖拽指示线（颜色加深）
- 拖拽时全局 cursor 变为 `col-resize`（垂直）或 `row-resize`（水平）
- 双击重置为默认尺寸
- 拖拽过程中实时回调 `onResize`

**性能优化**（避免拖拽时全局重渲染）：
- 拖拽期间用本地 ref 暂存宽度，不立即 commit 到 zustand store
- 拖拽结束（mouseup）时才 commit 到 store
- 用 `requestAnimationFrame` 节流 DOM 更新
- 验证 WebviewWidget 在 resize 时不会 reload（Electron webview 通常不因容器 resize 而 reload）

#### 3.2.3 改造 App.tsx 引入 ResizableDivider
**文件**：
- `client/desktop/src/App.tsx`
- `client/desktop/src/stores/useAppStore.ts`（新增 sidebarWidth/topbarOmniboxWidth state）
- `client/desktop/src/components/Sidebar.tsx`（重写折叠/展开逻辑）
- `client/desktop/desktop/electron/main/index.ts`（toggleSidebar 菜单 accelerator 调整）

**改动**：
- app-topbar 中 Omnibox 和 TabBar 之间插入 `<ResizableDivider direction="horizontal" />`
- app-body 中 Sidebar 和主区域之间插入 `<ResizableDivider direction="vertical" />`
- useAppStore 新增：`sidebarWidth: number`（默认 240）、`topbarOmniboxWidth: number`（默认 360）、`setSidebarWidth`/`setTopbarOmniboxWidth`，持久化到 localStorage
- **保留 `sidebarCollapsed` state**（不移除，避免破坏现有代码），但 `toggleSidebar` 改为切换宽度 240 ↔ 48
- Sidebar.tsx 根据 `sidebarWidth <= 48` 判断是否为折叠态，渲染对应 UI
- 默认值：Omnibox 360px（min 240, max 600），Sidebar 240px（min 48, max 400）

#### 3.2.4 改造 CanvasHome AI 对话框为收起式
**文件**：`client/desktop/src/components/CanvasHome.tsx`

**当前**：固定 320px 高度的卡片，永远显示完整界面

**改造为**（设计文档 2.3 节）：
- **收起态**：pill 形状输入框（`border-radius: 24px`），高度 48px，placeholder "有什么想问的..."，左侧 AI 图标 + 在线状态小圆点（绿色在线/红色离线）
- **展开态**：点击/聚焦后展开为融入页面的对话区域（无边框、无标题），高度自适应（最大 480px）
  - 消息列表（消息气泡直接浮在页面上，左右以页面边界为框）
  - 思考中指示器（typing dots 动画）
  - 固定底部输入框（pill 形状）
  - 右上角悬浮小图标（设置 + 关闭展开）
- **状态机**：`idle`（收起）→ `focused`（聚焦未输入）→ `expanded`（有消息或正在对话）→ `idle`（点击外部收起）

**状态管理方案**：
- 用单一组件 + CSS 切换（不 unmount 对话区域），避免本地状态丢失
- 收起态：对话区域 `display: none`，只显示 pill 输入框
- 展开态：对话区域 `display: flex`，pill 输入框移到底部
- inputValue 等 React state 保留在组件中，不因切换而丢失
- messages 来自 useAIStore，切换不影响

**动画**：0.3s cubic-bezier(0.4, 0, 0.2, 1) 展开/收起（用 CSS transition，不用 framer-motion）

**WS 状态指示**：在 pill 输入框左侧显示在线/离线小圆点（绿色/红色），用户知道 AI 是否可用

#### 3.2.5 pill 形状统一
**文件**：`Omnibox.tsx`、`CanvasHome.tsx`、`GlobalQuickInput.tsx`、`WidgetSearch.tsx`、`BrowserHome.tsx`

**改动**：所有搜索框/输入框统一 `border-radius: 24px`（或 `var(--radius-full)`），移除实线边框，改用半透明背景

#### 3.2.6 移除组件实线边框
**文件**：`BrowserHome.tsx`、`CanvasHome.tsx`、`WidgetContainer.tsx`、`SettingsPanel.tsx` 等

**改动**：
- 移除 `border: '1px solid var(--border-default)'`
- 改用 `background: rgba(0,0,0,0.03)` 半透明背景区分层次
- 保留必要的视觉分隔（如分割线用 `rgba(0,0,0,0.06)`）

#### 3.2.7 BrowserHome 书签圆形图标
**文件**：`client/desktop/src/components/BrowserHome.tsx`

**当前**：书签是 `borderRadius: 8` 的圆角矩形

**改造**（设计文档 2.2 节）：圆形图标 `borderRadius: 50%`，尺寸 64x64，favicon 居中（`object-fit: contain; padding: 16px`）

### 3.3 验收标准
- [ ] 默认主题为白色洁净色系（首次启动即亮色，DEFAULT_APPEARANCE 已改）
- [ ] `--radius-full`、`--spacing-*`、`--radius-*` Token 已定义
- [ ] ResizableDivider 组件存在且可拖拽
- [ ] app-topbar 中 Omnibox/TabBar 间有可拖拽水平分割线
- [ ] app-body 中 Sidebar/主区域间有可拖拽垂直分割线
- [ ] 双击分割线重置为默认尺寸
- [ ] 拖拽期间无全局重渲染（用 ref 暂存）
- [ ] CanvasHome AI 对话框有收起态（pill）和展开态
- [ ] 收起态点击后展开为对话区域，动画 0.3s
- [ ] 收起/展开不丢失 messages 和 inputValue
- [ ] pill 输入框有在线/离线小圆点
- [ ] 所有搜索框/输入框为 pill 形状（border-radius: 24px）
- [ ] 组件无实线边框，用半透明背景区分
- [ ] BrowserHome 书签为圆形图标（border-radius: 50%）
- [ ] Sidebar.tsx 根据 sidebarWidth 渲染折叠/展开 UI
- [ ] `npm run typecheck` 通过
- [ ] `npm run build` 通过
- [ ] Playwright CDP 截图验证（见第十四章）：浏览器主页、画布主页、设置面板、画布面板四个页面
- [ ] 与 layout-design-desktop.md 第六章设计规范逐项对照（间距/圆角/颜色/字体/图标/动效）

---

## 四、批次 2：主页切换动画 + 嵌入按钮交互优化

### 4.1 任务1：主页切换动画

#### 4.1.1 目标
新建标签/面板时的过渡动画，mainView.type 切换有视觉过渡

#### 4.1.2 实现
**文件**：`client/desktop/src/App.tsx`

**改动**：
- **不引入 framer-motion**（避免 React 19 兼容性风险），用 CSS transition + React state 实现
- 用 `useTransition` + CSS class 切换实现 fade + slide 动画
- mainView 切换时：
  1. 旧视图加 `exiting` class（opacity: 0, transform: translateY(-8px)）
  2. 100ms 后切换到新视图，加 `entering` class（opacity: 0, transform: translateY(8px)）
  3. 下一帧新视图加 `entered` class（opacity: 1, transform: translateY(0)）
- 动画规范（设计文档 6.6 节）：
  - 主页切换：0.2s ease-in-out，fade + slight slide
  - pill 展开动画：0.3s cubic-bezier(0.4, 0, 0.2, 1)（已在批次1 实现）

**key 设计**：
- motion 容器用 `key={mainView.type + (mainView.tabId ?? '') + (mainView.panelId ?? '')}`
- 同 type 不同 tabId/panelId 切换也触发动画（符合"新建标签进主页"的视觉预期）

**备选方案（如 CSS 方案效果不佳）**：
- 安装 `motion` 包（framer-motion 的新名字，React 19 兼容版本 `^11.x` 或 `^12.x`）
- 安装前先 `npm info motion peerDependencies` 验证

#### 4.1.3 验收标准
- [ ] mainView.type 切换时有 fade + slide 过渡动画
- [ ] 动画时长 0.2s
- [ ] 同 type 不同 tabId 切换也触发动画
- [ ] 切换期间截图不出现纯白像素（用 Playwright CDP 截图 + 像素分析验证）
- [ ] CanvasHome pill 展开动画 0.3s（批次1 已实现）
- [ ] `npm run typecheck` + `npm run build` 通过
- [ ] Playwright CDP 截图验证：切换标签/面板时有动画

### 4.2 任务3：嵌入按钮交互优化

#### 4.2.1 目标
嵌入按钮有 loading/成功/失败状态反馈，替代 window.alert

#### 4.2.2 实现
**新增 Toast 系统**：
- **文件**：`client/desktop/src/components/Toast.tsx`（新建）
- **文件**：`client/desktop/src/stores/useToastStore.ts`（新建，zustand store）

**Toast Store 接口**：
```typescript
interface ToastItem {
  id: string
  type: 'success' | 'error' | 'info' | 'loading'
  message: string
  duration?: number  // ms，0 表示不自动关闭
}
interface ToastStore {
  toasts: ToastItem[]
  showToast: (toast: Omit<ToastItem, 'id'>) => string
  updateToast: (id: string, updates: Partial<ToastItem>) => void
  dismissToast: (id: string) => void
}
```

**Toast 组件**：
- 固定在屏幕右下角（z-index 最高）
- 支持 success/error/info/loading 四种类型
- 自动消失（默认 3s，loading 不消失）
- 动画：从右滑入，淡出消失

**改造 TabBar.tsx Pin 按钮**：
- **文件**：`client/desktop/src/components/TabBar.tsx`

**改动**：
```typescript
const [pinState, setPinState] = useState<'idle' | 'loading' | 'success' | 'error'>('idle')
const pinTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

const handlePinToCanvas = async (tabId: string) => {
  setPinState('loading')
  const toastId = showToast({ type: 'loading', message: '正在嵌入到画布...' })
  try {
    await api.pinTabToCanvas(tabId)
    setPinState('success')
    updateToast(toastId, { type: 'success', message: '已嵌入到画布', duration: 2000 })
    pinTimeoutRef.current = setTimeout(() => setPinState('idle'), 1500)
  } catch (err) {
    setPinState('error')
    updateToast(toastId, { type: 'error', message: err.message, duration: 4000 })
    pinTimeoutRef.current = setTimeout(() => setPinState('idle'), 1500)
  }
}

// useEffect cleanup 清除 timeout，避免 setState on unmounted
useEffect(() => {
  return () => {
    if (pinTimeoutRef.current) clearTimeout(pinTimeoutRef.current)
  }
}, [])
```

**Pin 按钮视觉状态**：
- idle：默认色（`var(--text-tertiary)`）
- hover：`var(--text-primary)`
- loading：旋转动画（Loader2 图标 spin）
- success：绿色 + 抖动动画（Check 图标）
- error：红色 + 抖动动画（AlertCircle 图标）

**已嵌入标识**：tab.panelId 存在时，Pin 图标变为绿色实心（表示已嵌入）

#### 4.2.3 验收标准
- [ ] Toast 系统存在，支持 success/error/info/loading 四种类型
- [ ] 嵌入成功后显示 Toast "已嵌入到画布"
- [ ] 嵌入失败显示错误 Toast（不再用 window.alert）
- [ ] Pin 按钮有 loading 状态（旋转图标）
- [ ] Pin 按钮成功后短暂变绿
- [ ] Pin 按钮失败后短暂变红
- [ ] 已嵌入的标签 Pin 图标为绿色实心
- [ ] setTimeout 有 cleanup（无内存泄漏）
- [ ] `npm run typecheck` + `npm run build` 通过
- [ ] Playwright CDP 截图验证：嵌入按钮各状态

---

## 五、批次 3：收藏组件管理 + 快捷键完善

### 5.1 任务4：收藏组件管理

#### 5.1.1 目标
收藏组件支持排序/分组/搜索

#### 5.1.2 数据模型扩展
**服务器侧**（需同步改 `roadmap_server_v1.md`）：

`favorites` 表新增字段：
- `order_index` INTEGER DEFAULT 0
- `group_name` VARCHAR(64) NULL
- `last_used_at` TIMESTAMP NULL  **（新增，用于"最近使用"排序）**
- `updated_at` TIMESTAMP DEFAULT NOW()  **（新增，用于降级排序）**

**客户端 API 扩展**：
- **文件**：`client/desktop/src/api/favorites.ts`

新增接口：
```typescript
export interface FavoriteEntry {
  id: string
  widgetId: string
  panelId: string
  orderIndex: number
  groupName: string | null
  lastUsedAt?: string | null
  createdAt: string
  updatedAt?: string
  // ... 现有字段
}

export async function reorderFavorites(items: { id: string; orderIndex: number }[]): Promise<void>
export async function groupFavorite(id: string, groupName: string | null): Promise<void>
export async function touchFavorite(id: string): Promise<void>  // 更新 lastUsedAt
```

**降级策略**：
- 服务器未升级时，orderIndex/groupName/lastUsedAt 仅存 localStorage（key: `favorites_local_meta`）
- 服务器升级后自动同步（检测 API 响应是否包含新字段）
- 旧移动端读取 favorites 表时忽略新字段，向后兼容

**移动端兼容性**：
- Phase 7 仅桌面端实现 UI，移动端不改动
- 旧移动端读取 favorites 表时忽略 orderIndex/groupName/lastUsedAt（SQL 查询不报错）
- 移动端的收藏管理 UI 由后续 Phase 处理

#### 5.1.3 收藏管理 UI
**文件**：`client/desktop/src/components/CanvasHome.tsx`（改造收藏组件区域）

**改动**：收藏组件标题栏新增按钮（复用批次1 的 pill/无边框规范）：
- 搜索按钮（Search 图标）→ 展开搜索框
- 排序按钮（ArrowUpDown 图标）→ 下拉菜单（按创建时间/名称/最近使用）
- 分组按钮（Layers 图标）→ 下拉菜单（不分组/按面板/按类型/自定义分组）

**搜索**：实时过滤，大小写不敏感：
```typescript
const kw = keyword.toLowerCase()
favorites.filter(f => 
  f.displayName.toLowerCase().includes(kw) || 
  f.panelName.toLowerCase().includes(kw)
)
```

**排序**：
- 按创建时间（默认）：`orderIndex` 升序（降级用 `createdAt` 升序）
- 按名称：`displayName` 字母序（大小写不敏感）
- 按最近使用：`lastUsedAt` 降序（降级用 `updatedAt` 降序，再降级用 `createdAt` 降序）

**分组**：
- 不分组：平铺显示
- 按面板：`panelId` 分组，每组显示面板名
- 按类型：`widgetType` 分组
- 自定义：用户拖拽到自定义分组

#### 5.1.4 拖拽重排
**文件**：`client/desktop/src/components/CanvasHome.tsx`

**实现**：使用原生 HTML5 拖拽 API（draggable + onDragStart + onDragOver + onDrop）
- 拖拽时显示占位符
- **乐观更新**：先改 UI 再调 API
- **debounce 500ms** 后批量调用 `reorderFavorites`（避免快速拖拽多次请求）
- **失败回滚**：API 失败时回滚 orderIndex 并 Toast 提示"排序保存失败"
- 跨分组拖拽时调用 `groupFavorite`

#### 5.1.5 验收标准
- [ ] 收藏组件区域有搜索/排序/分组按钮
- [ ] 搜索实时过滤（大小写不敏感）
- [ ] 排序有 3 种模式（创建时间/名称/最近使用）
- [ ] 分组有 4 种模式（不分组/按面板/按类型/自定义）
- [ ] 拖拽重排正常工作（有 debounce + 乐观更新 + 失败回滚）
- [ ] orderIndex/groupName/lastUsedAt 持久化（服务器或本地降级）
- [ ] `npm run typecheck` + `npm run build` 通过
- [ ] Playwright CDP 截图验证：收藏管理各功能

### 5.2 任务6：快捷键完善

#### 5.2.1 目标
补全 16 个常用快捷键，统一管理

#### 5.2.2 全局快捷键中心
**文件**：
- `client/desktop/src/hooks/useKeyboardShortcuts.ts`（新建）
- `client/desktop/electron/main/index.ts`（菜单 accelerator 清理）
- `client/desktop/src/App.tsx`（迁移现有 Ctrl+F）

**职责**：统一注册和管理所有快捷键，避免冲突

**接口**：
```typescript
interface ShortcutDefinition {
  id: string
  keys: string  // 如 'Ctrl+T', 'Alt+Left'
  description: string
  handler: () => void
  scope: 'global' | 'canvas' | 'browser'  // 作用域
  enabled?: boolean
}

export function useKeyboardShortcuts(shortcuts: ShortcutDefinition[]): void
```

**实现要点**：
- 全局监听 keydown 事件
- 按 scope 过滤（canvas 模式只响应 canvas + global 快捷键）
- 支持快捷键冲突检测（注册时 console.warn）
- **迁移 App.tsx 第 84-93 行的 Ctrl+F 监听到 useKeyboardShortcuts**，删除原 useEffect
- **自定义映射读取**：从 localStorage 读取用户自定义映射（`shortcuts_custom_map`），批次4 实现 UI

**main/index.ts 菜单清理**：
- 移除与 useKeyboardShortcuts 重复的菜单 accelerator（CmdOrCtrl+N 等）
- 改为菜单触发 IPC，由渲染进程统一处理
- **Ctrl+W 拦截**：Electron 默认 Ctrl+W 关闭窗口，需在 main/index.ts 菜单中重定义或用 `globalShortcut.register` 拦截，通过 IPC 通知渲染进程执行 `closeWebTab`
- **Ctrl+R/F5 拦截**：类似处理，避免刷新整个 Electron 窗口

#### 5.2.3 新增快捷键清单（16 个）

| 快捷键 | 功能 | 作用域 | Electron 冲突处理 |
|--------|------|--------|------------------|
| Ctrl+T | 新建网页标签 → 浏览器主页 | global | 无 |
| Ctrl+N | 新建画布面板 → 画布主页 | global | 与现有 CmdOrCtrl+N 菜单冲突，菜单改为 IPC |
| Ctrl+W | 关闭当前标签/面板 | global | **Electron 默认关闭窗口，需拦截** |
| Ctrl+Tab | 切换到下一个标签 | global | 无 |
| Ctrl+Shift+Tab | 切换到上一个标签 | global | 无 |
| Ctrl+1..9 | 切换到第 N 个标签 | global | 无 |
| Alt+← | 网页后退 | browser | 无 |
| Alt+→ | 网页前进 | browser | 无 |
| F5 / Ctrl+R | 刷新当前网页 | browser | **Electron 默认刷新窗口，需拦截** |
| Ctrl+D | 收藏当前页/当前组件 | global | 无 |
| Ctrl+, | 打开设置 | global | 无 |
| Ctrl+= | 画布放大 | canvas | 无 |
| Ctrl+- | 画布缩小 | canvas | 无 |
| Ctrl+0 | 画布重置缩放 | canvas | 无 |
| Ctrl+H | 历史记录面板 | global | 无 |
| Ctrl+J | 书签管理 | global | 无 |
| Ctrl+F | 搜索组件（迁移现有） | global | 无 |

**注**：Ctrl+R/F5 在 browser 作用域为刷新网页，在 canvas 作用域不拦截。Ctrl+W 始终关闭当前标签（不关闭窗口）。

#### 5.2.4 快捷键提示 UI
**文件**：`client/desktop/src/components/TabBar.tsx`、`Omnibox.tsx`、`Sidebar.tsx`

**改动**：按钮 tooltip 中显示快捷键（如 "新建标签 (Ctrl+T)"）

#### 5.2.5 验收标准
- [ ] useKeyboardShortcuts hook 存在并工作
- [ ] 16 个新增快捷键全部可用
- [ ] 快捷键按作用域过滤（canvas 模式不响应 browser 快捷键）
- [ ] 快捷键冲突时有 console.warn
- [ ] 按钮 tooltip 显示快捷键
- [ ] App.tsx 现有 Ctrl+F 已迁移到 useKeyboardShortcuts
- [ ] main/index.ts 菜单 accelerator 已清理
- [ ] Ctrl+W 关闭标签（不关闭窗口）
- [ ] Ctrl+R/F5 刷新网页（不刷新窗口）
- [ ] hook 支持从 localStorage 读取自定义映射
- [ ] `npm run typecheck` + `npm run build` 通过
- [ ] Playwright CDP 验证：Ctrl+T 新建标签、Ctrl+W 关闭标签

---

## 六、批次 4：设置完善（任务7）

### 6.1 目标
SettingsPanel 新增 3 个 Tab：收藏管理、快捷键、动效与无障碍

### 6.2 新增 Tab

#### 6.2.1 收藏管理 Tab
**文件**：`client/desktop/src/components/settings/FavoritesManager.tsx`（新建）

**内容**：
- 收藏组件列表（表格形式：组件名/所属面板/类型/创建时间/操作）
- 批量选择 + 批量删除
- 搜索框
- 排序/分组（复用批次3的逻辑）
- 拖拽重排
- 导出收藏列表（JSON）

#### 6.2.2 快捷键 Tab
**文件**：`client/desktop/src/components/settings/ShortcutsConfig.tsx`（新建）

**内容**：
- 快捷键列表（id/keys/description/scope）
- 点击快捷键项 → 进入录制模式（按下任意键组合捕获）
- 录制模式按 Escape 取消
- 保存自定义映射（持久化到 localStorage `shortcuts_custom_map`）
- 重置为默认按钮

#### 6.2.3 动效与无障碍 Tab
**文件**：`client/desktop/src/components/settings/AccessibilityConfig.tsx`（新建）

**内容**：
- 减弱动画开关
- 高对比度模式开关
- 字体缩放滑块（80%-150%）
- 紧凑模式开关（减小间距）

**减弱动画实现**：
- 通过 `document.documentElement.setAttribute('data-reduce-motion', 'true')` 实现
- index.css 增加：
```css
[data-reduce-motion="true"] * {
  transition: none !important;
  animation: none !important;
}
```

**字体缩放实现**：
- `document.documentElement.style.fontSize = `${scale * 100}%``
- 基于 rem 的样式自动缩放

### 6.3 改造 SettingsPanel Tab 结构
**文件**：`client/desktop/src/components/SettingsPanel.tsx`

**当前**：5 个 Tab（外观/行为/数据管理/服务器/AI 配置）

**改造**：8 个 Tab，横向滚动：
1. 外观
2. 行为
3. 动效与无障碍（新）
4. 收藏管理（新）
5. 快捷键（新）
6. 数据管理
7. 服务器
8. AI 配置

**Tab 栏样式**：pill 形状，可横向滚动，当前 Tab 高亮

### 6.4 行为 Tab 补充
- 新建标签默认行为（主页/空白页）
- 关闭标签后跳转策略（上一个/下一个/不跳转）

### 6.5 验收标准
- [ ] SettingsPanel 有 8 个 Tab
- [ ] 收藏管理 Tab 可查看/搜索/批量删除/导出
- [ ] 快捷键 Tab 可查看/自定义/重置（录制模式 Escape 可取消）
- [ ] 动效与无障碍 Tab 有减弱动画/高对比度/字体缩放/紧凑模式
- [ ] Tab 栏可横向滚动
- [ ] 减弱动画开关生效（`data-reduce-motion` 属性设置，所有 transition/animation 禁用）
- [ ] `npm run typecheck` + `npm run build` 通过
- [ ] Playwright CDP 截图验证：8 个 Tab 切换

---

## 七、批次 5：预览性能优化 + 性能优化

### 7.1 任务2：预览性能优化

#### 7.1.1 SitePreview 优化
**文件**：
- `client/desktop/src/components/SitePreview.tsx`
- `client/desktop/electron/main/index.ts`（新增 `site-preview:capture` IPC handler）
- `client/desktop/electron/preload/index.ts`（暴露 `capturePreview(url)` API）

**优化项**：
1. **IntersectionObserver 懒加载**：预览进入视口才创建 webview
2. **并发限制**：最多 3 个并发 webview，超出排队（用计数器 + 队列，不做复杂池化）
3. **缩略图缓存**：首次加载后通过 IPC 调用 `webContents.capturePage()` 截图，返回 dataURL 存 IDB
   - **不用 html-to-image**（无法对 webview 截图）
   - 主进程 `site-preview:capture` IPC handler：创建隐藏 BrowserWindow 加载 URL，capturePage 后关闭
   - 缓存 key：URL，缓存有效期 24h
4. **卸载时清理**：webview.stop() + removeEventListener + 释放引用

#### 7.1.2 FavoriteWidgetPreview 优化
**文件**：`client/desktop/src/components/FavoriteWidgetPreview.tsx`

**优化项**：
1. **冻结态渲染**：用 `React.memo` + 浅比较 state，避免组件因父组件重渲染而重渲染
   - **不修改 widget 组件接口**（避免工作量爆炸）
   - 对有副作用的组件（FocusTimer/MusicPlayer/LatexQuiz），渲染静态截图而非真实组件
2. **静态模式**：
   - FocusTimer：渲染静态时间显示（不跑计时器）
   - MusicPlayer：渲染静态封面（不加载音频）
   - LatexQuiz：渲染静态题目（不响应点击）
   - Sudoku：渲染静态棋盘（不响应输入）
3. **快照缓存**：首次渲染后用 `html-to-image` 截图存 IDB（FavoriteWidgetPreview 是普通 DOM，可以用 html-to-image）

#### 7.1.3 验收标准
- [ ] SitePreview 进入视口才加载 webview
- [ ] webview 并发限制最多 3 个
- [ ] 缩略图缓存生效（二次加载无 webview 创建，用 IPC capturePage）
- [ ] FavoriteWidgetPreview 有冻结态/静态模式
- [ ] FocusTimer 预览不跑计时器
- [ ] MusicPlayer 预览不加载音频
- [ ] `npm run typecheck` + `npm run build` 通过
- [ ] Playwright CDP 验证：滚动后预览懒加载

### 7.2 任务8：性能优化

#### 7.2.1 React.lazy 懒加载
**文件**：`client/desktop/src/App.tsx`、`client/desktop/src/registry/builtIn.tsx`

**改动**：
```typescript
// App.tsx - 仅覆盖层组件懒加载（GlobalQuickInput 始终渲染，不懒加载）
const SettingsPanel = React.lazy(() => import('./components/SettingsPanel'))
const MigrationPage = React.lazy(() => import('./components/MigrationPage'))
const WidgetSearch = React.lazy(() => import('./components/WidgetSearch'))

// 用 <Suspense fallback={null}> 包裹
```

**注意**：
- GlobalQuickInput **不懒加载**（App.tsx 始终渲染，懒加载反而劣化首屏）
- SettingsPanel/WidgetSearch 是条件渲染，适合懒加载
- MigrationPage 是低频场景，适合懒加载

#### 7.2.2 Vite manualChunks
**文件**：`electron.vite.config.ts`（**根目录，非 client/desktop/**）

**改动**：
```typescript
build: {
  rollupOptions: {
    output: {
      manualChunks: {
        'react-vendor': ['react', 'react-dom'],
        'katex': ['katex'],
        'pdfjs': ['pdfjs-dist'],
        'lucide': ['lucide-react'],
      }
    }
  }
}
```

#### 7.2.3 Widget 注册懒加载
**文件**：`client/desktop/src/registry/builtIn.tsx`

**改动**：widget 注册改为惰性，按 widgetType 动态 import
- 重型 widget（PdfViewer/MusicPlayer/LatexQuiz/Sudoku）用 `React.lazy` 包裹
- 轻量 widget（Calculator/Note/AIAssistant）保持同步导入
- Widget 渲染时用 `<Suspense fallback={<SkeletonScreen />}>` 包裹

#### 7.2.4 启动性能 profiling
- 首次启动到可交互时间（TTI）测量
- 主进程启动时间 + 渲染进程启动时间 + 数据库初始化时间
- 输出到 console，便于优化

#### 7.2.5 验收标准
- [ ] SettingsPanel/MigrationPage/WidgetSearch 用 React.lazy
- [ ] GlobalQuickInput **未**用 React.lazy（始终渲染）
- [ ] PdfViewer/MusicPlayer/LatexQuiz/Sudoku 用 React.lazy（在 builtIn.tsx）
- [ ] manualChunks 配置存在（electron.vite.config.ts 根目录）
- [ ] 启动时间 profiling 输出到 console
- [ ] 首屏加载不包含 pdfjs-dist（验证 bundle 分析）
- [ ] `npm run typecheck` + `npm run build` 通过
- [ ] 运行时验证：首屏加载时间减少

---

## 八、批次 6：主页模板（任务5）

### 8.1 目标
预设主页模板（极简/丰富/自定义），用户可切换

### 8.2 数据模型
**文件**：
- `client/desktop/src/types/index.ts`
- `client/desktop/src/stores/useAppStore.ts`（新增 homeTemplate state + setter + 持久化）

```typescript
export type HomeTemplateType = 'minimal' | 'standard' | 'rich' | 'custom'

export interface HomeTemplate {
  type: HomeTemplateType
  browserHome: {
    showLogo: boolean
    showSearch: boolean
    showBookmarks: boolean
    showRecentVisited?: boolean
    maxBookmarks: number
  }
  canvasHome: {
    showLogo: boolean
    showAiInput: boolean
    showFavorites: boolean
    showEnterCanvasButton: boolean
    maxFavorites: number
  }
}
```

**内置模板**：
- **minimal**：只显示搜索框/AI输入框，无 Logo/书签/收藏
- **standard**：当前布局（Logo + 搜索框 + 书签/收藏）
- **rich**：Logo + 搜索框 + 书签 + 收藏 + 最近访问
- **custom**：用户自定义

**注**：rich 模板的"最近访问"需要先实现最近访问记录（存 localStorage，记录用户访问的标签 URL + 时间，最多 20 条）

### 8.3 模板选择 UI
**文件**：`client/desktop/src/components/settings/HomeTemplateSelector.tsx`（新建）

**位置**：SettingsPanel 外观 Tab 的"主页定制"子区域

**内容**：
- 4 个模板预览卡片（缩略图 + 名称 + 描述）
- 点击切换模板
- custom 模式下显示各区块的开关

### 8.4 改造 BrowserHome/CanvasHome
**文件**：`client/desktop/src/components/BrowserHome.tsx`、`CanvasHome.tsx`

**改动**：根据当前模板配置渲染区块：
```typescript
const template = useAppStore(s => s.homeTemplate)
if (!template.browserHome.showLogo) return null  // 不渲染 Logo
// ...
```

### 8.5 验收标准
- [ ] HomeTemplate 数据模型存在（types/index.ts）
- [ ] useAppStore 有 homeTemplate state + setter + 持久化
- [ ] 4 个内置模板可切换
- [ ] 模板选择 UI 在设置面板
- [ ] BrowserHome/CanvasHome 根据模板渲染
- [ ] custom 模式下各区块可单独开关
- [ ] rich 模式的最近访问记录正常工作
- [ ] `npm run typecheck` + `npm run build` 通过
- [ ] Playwright CDP 截图验证：4 个模板效果

---

## 九、批次 7：文档（任务10）

> **用户授权说明**：用户在 Phase 7 范围确认时明确选择"全部完成（推荐）"，包含文档任务。roadmap_desktop_v1.md 第 211 行明确列出"文档"为 Phase 7 任务。此为用户明确授权创建文档。

### 9.1 目标
用户手册 + 开发文档

### 9.2 用户手册
**文件**：`docs/user-guide.md`（新建）

**内容**：
1. 快速开始（安装/启动/首次配置）
2. 浏览器功能（主页/标签/书签/嵌入画布）
3. 画布功能（组件/连线/手绘/小地图/模板）
4. AI 助手（Omnibox ai:/GlobalQuickInput/CanvasHome 对话/思考等级）
5. 设置（外观/行为/动效/收藏/快捷键/数据/服务器/AI）
6. 快捷键速查表（覆盖所有快捷键，含批次3 的 16 个）
7. 常见问题

### 9.3 开发文档
**文件**：`docs/developer-guide.md`（新建）

**内容**：
1. 项目结构（client/desktop, server, shared）
2. 技术栈（Electron + React + TypeScript + Vite + Zustand）
3. 开发环境（Node/Electron/Gradle 路径）
4. 构建命令（dev/build/build:win）
5. 状态管理（useAppStore/useAIStore/useToastStore）
6. 组件注册（registry/builtIn + dynamic_widgets）
7. 数据流（服务器/本地/IDB）
8. 同步机制（WS/syncQueue）
9. 调试技巧（DevTools/日志/Playwright CDP）

### 9.4 验收标准
- [ ] user-guide.md 存在且内容完整
- [ ] developer-guide.md 存在且内容完整
- [ ] 文档中所有内部链接有效
- [ ] 快捷键速查表覆盖所有快捷键（含批次3 的 16 个）

---

## 十、依赖关系与服务器侧改动

### 10.1 服务器侧改动（需同步到 roadmap_server_v1.md）
本 Phase 涉及的服务器侧改动：
- `favorites` 表加 `order_index`/`group_name`/`last_used_at`/`updated_at` 字段（任务4）
- 收藏排序/分组 API（任务4）

**降级策略**：服务器未升级时，桌面端用 localStorage 存 orderIndex/groupName/lastUsedAt，服务器升级后自动同步。

### 10.2 与移动端的关系
- UI 视觉升级仅桌面端（移动端有自己的设计）
- 收藏管理的数据结构扩展会同步到移动端（共享服务器表，向后兼容）
- 快捷键仅桌面端（移动端无键盘）
- 文档仅桌面端
- **移动端不改动**：旧移动端读取 favorites 表时忽略新字段，Phase 7 仅桌面端实现 UI

---

## 十一、风险与缓解

| 风险 | 缓解措施 |
|------|---------|
| framer-motion 与 React 19 兼容性 | **不引入 framer-motion**，用 CSS transition 实现 |
| ResizableDivider 拖拽性能 | 用 ref 暂存宽度 + requestAnimationFrame 节流 + 拖拽结束 commit |
| CanvasHome 收起式改造破坏现有 AI 对话 | 用 CSS display 切换（不 unmount），保留 messages 和 inputValue |
| 服务器未升级导致收藏排序失败 | localStorage 降级 |
| React.lazy 导致首屏闪烁 | Suspense fallback 用骨架屏 |
| 默认色系改为亮色影响现有用户 | 保留用户主题偏好，仅首次启动默认亮色，同步改 DEFAULT_APPEARANCE |
| Ctrl+W 关闭窗口 | main/index.ts 拦截，IPC 通知渲染进程 |
| webview 池化复杂度 | **不做池化**，改为简单并发限制（计数器 + 队列） |
| FavoriteWidgetPreview frozen prop 工作量 | **不改 widget 接口**，用 React.memo + 静态模式 |
| Electron + Playwright 验证 | 用 CDP 连接方案（见第十四章） |

---

## 十二、验收标准总览

### 批次 1：UI 视觉升级 ✅
- [ ] 白色洁净色系为默认（DEFAULT_APPEARANCE 已改）
- [ ] ResizableDivider 可拖拽（拖拽期间无全局重渲染）
- [ ] CanvasHome AI 对话框收起式（CSS 切换不 unmount）
- [ ] pill 形状统一
- [ ] 无边框半透明
- [ ] Sidebar 根据 sidebarWidth 渲染折叠/展开

### 批次 2：主页切换动画 + 嵌入按钮 ✅
- [ ] mainView 切换有过渡动画（CSS transition）
- [ ] Toast 系统工作
- [ ] 嵌入按钮有 loading/成功/失败状态
- [ ] setTimeout 有 cleanup

### 批次 3：收藏管理 + 快捷键 ✅
- [ ] 收藏组件可排序/分组/搜索/拖拽（debounce + 乐观更新 + 回滚）
- [ ] 16 个新快捷键可用
- [ ] 现有 Ctrl+F 已迁移
- [ ] main/index.ts 菜单已清理
- [ ] Ctrl+W/Ctrl+R 已拦截

### 批次 4：设置完善 ✅
- [ ] 8 个 Tab 完整
- [ ] 收藏管理/快捷键/动效 Tab 可用
- [ ] 减弱动画用 data-reduce-motion 属性实现

### 批次 5：预览性能 + 性能优化 ✅
- [ ] SitePreview 懒加载 + IPC capturePage 缓存
- [ ] FavoriteWidgetPreview 冻结态（React.memo + 静态模式）
- [ ] React.lazy 覆盖覆盖层组件（GlobalQuickInput 除外）
- [ ] manualChunks 分割

### 批次 6：主页模板 ✅
- [ ] 4 个模板可切换
- [ ] 模板配置持久化
- [ ] rich 模式最近访问记录

### 批次 7：文档 ✅（用户已授权）
- [ ] user-guide.md 完整
- [ ] developer-guide.md 完整

### 最终发布
- [ ] `npm run typecheck` 通过
- [ ] `npm run build` 通过
- [ ] `npm run build:win` 生成 exe
- [ ] 检查 electron-builder.yml 配置（appId/productName/icon）
- [ ] 干净 Windows 安装测试通过
- [ ] git commit + tag v0.7.0-phase7

---

## 十三、执行计划

| 批次 | 任务 | 预计改动文件数 | 对抗审查 |
|------|------|--------------|---------|
| 1 | UI 视觉升级 | 13+（含 Sidebar/useAppStore/types/App/main/index.ts） | Playwright CDP 截图 4 页面 |
| 2 | 主页切换动画 + 嵌入按钮 | 5-6 | Playwright CDP 截图动画+Toast |
| 3 | 收藏管理 + 快捷键 | 6-8（含 main/index.ts 菜单清理） | Playwright CDP 验证功能 |
| 4 | 设置完善 | 5-6 | Playwright CDP 截图 8 Tab |
| 5 | 预览性能 + 性能优化 | 7-9（含 main/preload IPC） | 运行时验证懒加载 |
| 6 | 主页模板 | 4-5（含 useAppStore/types） | Playwright CDP 截图 4 模板 |
| 7 | 文档 | 2 | 链接检查 |

每批完成后：对抗审查 → git commit → 下一批。

---

## 十四、运行时验证方案（Electron + Playwright CDP）

### 14.1 方案
Electron 应用无法直接用 Playwright 测试，采用 CDP 连接方案：

1. **启动 Electron dev server**（带远程调试端口）：
   ```bash
   cd f:\allmylife\event
   set ELECTRON_ENABLE_LOGGING=1
   npm run dev -- --remote-debugging-port=9222
   ```

2. **Playwright 连接 CDP**：
   ```typescript
   import { chromium } from 'playwright'
   const browser = await chromium.connectOverCDP('http://localhost:9222')
   const contexts = browser.contexts()
   const page = contexts[0].pages()[0]  // Electron 渲染进程
   ```

3. **使用用户的 playwright-cli.js**：
   ```bash
   node "F:\Operit_workspace_full_backup\workspace_backup\.mcp-playwright-runtime\playwright-cli.js" run <script>
   ```

### 14.2 webview 标签测试
- Electron `<webview>` 标签在 CDP 连接中可访问（与主渲染进程同进程）
- 但 webview 内部网页无法直接操作（跨进程）
- 验证 webview 存在性 + 属性（src），不验证内部内容

### 14.3 截图验证
- 用 `page.screenshot()` 截图主渲染进程
- 验证视觉符合设计规范
- 用像素分析验证"无纯白闪烁"（截图 RGB 分析）

### 14.4 快捷键验证
- 用 `page.keyboard.press('Control+T')` 模拟快捷键
- 验证 DOM 变化（新建标签 → 检查 TabBar 新增元素）

---

## 附录：关键文件索引（完整版）

| 文件 | 涉及批次 | 绝对路径 |
|------|---------|---------|
| `client/desktop/src/index.css` | 1, 4 | `f:\allmylife\event\client\desktop\src\index.css` |
| `client/desktop/src/App.tsx` | 1, 2, 3, 5 | `f:\allmylife\event\client\desktop\src\App.tsx` |
| `client/desktop/src/types/index.ts` | 1, 6 | `f:\allmylife\event\client\desktop\src\types\index.ts` |
| `client/desktop/src/stores/useAppStore.ts` | 1, 6 | `f:\allmylife\event\client\desktop\src\stores\useAppStore.ts` |
| `client/desktop/src/components/ResizableDivider.tsx`（新） | 1 | `f:\allmylife\event\client\desktop\src\components\ResizableDivider.tsx` |
| `client/desktop/src/components/Sidebar.tsx` | 1 | `f:\allmylife\event\client\desktop\src\components\Sidebar.tsx` |
| `client/desktop/src/components/CanvasHome.tsx` | 1, 3, 6 | `f:\allmylife\event\client\desktop\src\components\CanvasHome.tsx` |
| `client/desktop/src/components/BrowserHome.tsx` | 1, 6 | `f:\allmylife\event\client\desktop\src\components\BrowserHome.tsx` |
| `client/desktop/src/components/Omnibox.tsx` | 1, 3 | `f:\allmylife\event\client\desktop\src\components\Omnibox.tsx` |
| `client/desktop/src/components/GlobalQuickInput.tsx` | 1 | `f:\allmylife\event\client\desktop\src\components\GlobalQuickInput.tsx` |
| `client/desktop/src/components/WidgetSearch.tsx` | 1, 5 | `f:\allmylife\event\client\desktop\src\components\WidgetSearch.tsx` |
| `client/desktop/src/components/WidgetContainer.tsx` | 1 | `f:\allmylife\event\client\desktop\src\components\WidgetContainer.tsx` |
| `client/desktop/electron/main/index.ts` | 1, 3, 5 | `f:\allmylife\event\client\desktop\electron\main\index.ts` |
| `client/desktop/electron/preload/index.ts` | 5 | `f:\allmylife\event\client\desktop\electron\preload\index.ts` |
| `client/desktop/src/components/TabBar.tsx` | 2, 3 | `f:\allmylife\event\client\desktop\src\components\TabBar.tsx` |
| `client/desktop/src/components/Toast.tsx`（新） | 2 | `f:\allmylife\event\client\desktop\src\components\Toast.tsx` |
| `client/desktop/src/stores/useToastStore.ts`（新） | 2 | `f:\allmylife\event\client\desktop\src\stores\useToastStore.ts` |
| `client/desktop/src/api/favorites.ts` | 3 | `f:\allmylife\event\client\desktop\src\api\favorites.ts` |
| `client/desktop/src/hooks/useKeyboardShortcuts.ts`（新） | 3 | `f:\allmylife\event\client\desktop\src\hooks\useKeyboardShortcuts.ts` |
| `client/desktop/src/components/SettingsPanel.tsx` | 1, 4 | `f:\allmylife\event\client\desktop\src\components\SettingsPanel.tsx` |
| `client/desktop/src/components/settings/FavoritesManager.tsx`（新） | 4 | `f:\allmylife\event\client\desktop\src\components\settings\FavoritesManager.tsx` |
| `client/desktop/src/components/settings/ShortcutsConfig.tsx`（新） | 4 | `f:\allmylife\event\client\desktop\src\components\settings\ShortcutsConfig.tsx` |
| `client/desktop/src/components/settings/AccessibilityConfig.tsx`（新） | 4 | `f:\allmylife\event\client\desktop\src\components\settings\AccessibilityConfig.tsx` |
| `client/desktop/src/components/SitePreview.tsx` | 5 | `f:\allmylife\event\client\desktop\src\components\SitePreview.tsx` |
| `client/desktop/src/components/FavoriteWidgetPreview.tsx` | 5 | `f:\allmylife\event\client\desktop\src\components\FavoriteWidgetPreview.tsx` |
| `client/desktop/src/registry/builtIn.tsx` | 5 | `f:\allmylife\event\client\desktop\src\registry\builtIn.tsx` |
| `electron.vite.config.ts`（根目录） | 5 | `f:\allmylife\event\electron.vite.config.ts` |
| `client/desktop/src/components/settings/HomeTemplateSelector.tsx`（新） | 6 | `f:\allmylife\event\client\desktop\src\components\settings\HomeTemplateSelector.tsx` |
| `docs/user-guide.md`（新） | 7 | `f:\allmylife\event\docs\user-guide.md` |
| `docs/developer-guide.md`（新） | 7 | `f:\allmylife\event\docs\developer-guide.md` |
| `electron-builder.yml`（根目录） | 最终发布 | `f:\allmylife\event\electron-builder.yml` |
