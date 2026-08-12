# Phase S16 Spec：全端修订"只要画布"纠偏

> 生成日期：2026-07-06
> 依据：[roadmap_server_v2.md §11.3 Phase S16](../roadmap_server_v2.md)
> 状态：spec 草案，待对抗审查

---

## 一、背景与目标

S11-S15 已全部完成并部署到 `https://shadowshub.xyz/daily/`。实际运行后发现偏离用户核心诉求"打开网址就看到画布"：

- **核心问题**：[App.tsx:65](file:///f:/allmylife/event/client/web/src/App.tsx) 路由 `/` → `<CanvasHome />`，CanvasHome（1056 行）是"启动器/仪表盘中转页"，含 AI 对话框/收藏网格/快捷链接/最近面板/设置浮动按钮，**不是画布**。用户必须再点"进入画布"才能跳到 `/panel/:panelId` 看到真正的 Workspace。
- **画布本体**：[Workspace.tsx](file:///f:/allmylife/event/client/web/src/components/Workspace.tsx)（1538 行）完整存在且可用，含 WelcomeScreen + 8 widget + 笔迹 + 连线 + 小地图，只是被 CanvasHome 挡住。

**S16 唯一目标**：让用户打开 `https://shadowshub.xyz/daily/` 后立即看到画布（Workspace），中间不要中转页。

---

## 二、范围

### 做什么

| 子阶段 | 目标 |
|---|---|
| S16.1 | 路由 `/` 直接渲染 Workspace；WS 初始化迁移；MainViewSync 改造；Workspace 加面板切换；修复 `/panel/:panelId` 哑路由 |
| S16.2 | CanvasHome + FavoriteWidgetPreview 归档到 `_archive/`（不参与构建） |
| S16.3 | 删 Home.tsx；清理 useAppStore/types/db/searchIndexAdapters 的 webTabs + mainView + homeTemplate 死代码链 |
| S16.4 | Docker 镜像重建 + 部署 + 运行时验证 |

### 不做什么（明确排除）

- ❌ 不重做登录页视觉
- ❌ 不接线 SearchResultsPanel
- ❌ 不写 Web 端 UI 规范
- ❌ 不重写 S11-S15 任何代码
- ❌ 不清理 bookmarks/Bookmark 死代码（roadmap §11.3 S16.3 未列出，保守不动）
- ❌ dbV2.ts 的 `webTabs`/`bookmarks` store 声明保留（避免破坏 IDB schema 升级路径）

---

## 三、S16.1 路由改为"登录即画布"

### 3.1 App.tsx 路由表改造

**当前** [App.tsx:65](file:///f:/allmylife/event/client/web/src/App.tsx)：
```tsx
<Route path="/" element={<AuthGuard><CanvasHome /></AuthGuard>} />
```

**改为**：
```tsx
<Route path="/" element={<AuthGuard><Workspace /></AuthGuard>} />
<Route path="/panel/:panelId" element={<AuthGuard><Workspace /></AuthGuard>} />
```

- `/` 直接渲染 Workspace（登录后立即看到画布或 WelcomeScreen）
- `/panel/:panelId` 保留并修复哑路由（见 3.4）
- **同步删除** `import CanvasHome from './components/CanvasHome'`（S16.1 完成 CanvasHome 即不再被引用，tsconfig.app.json 设了 `noUnusedLocals: true`，不删 import 会编译失败）

### 3.2 WS 初始化迁移（关键，不能丢）

**当前** [CanvasHome.tsx:79-90](file:///f:/allmylife/event/client/web/src/components/CanvasHome.tsx)：
```tsx
// 初始化 AI store
useEffect(() => {
  if (!isInitialized) initialize()
}, [isInitialized, initialize])

// 确保主 AI session 存在
useEffect(() => {
  if (!currentPanelId) return
  void ensurePrimarySession(currentPanelId).catch(console.error)
}, [currentPanelId, ensurePrimarySession])
```

**迁移到** [Workspace.tsx](file:///f:/allmylife/event/client/web/src/components/Workspace.tsx) 顶层（Workspace 已订阅 activePanelId）：
```tsx
import { useAIStore } from '../stores/useAIStore'

// 在 Workspace 组件内：
const isAIInitialized = useAIStore(s => s.isInitialized)
const initializeAI = useAIStore(s => s.initialize)
const ensurePrimarySession = useAppStore(s => s.ensurePrimarySession)

useEffect(() => {
  if (!isAIInitialized) initializeAI()
}, [isAIInitialized, initializeAI])

useEffect(() => {
  if (!activePanelId) return
  void ensurePrimarySession(activePanelId).catch(console.error)
}, [activePanelId, ensurePrimarySession])
```

**验收**：CanvasHome 不再渲染后，WS 仍能建立；AIAssistant widget 能发消息收到回复。

### 3.3 MainViewSync 改造

**当前** [App.tsx:38-52](file:///f:/allmylife/event/client/web/src/App.tsx) 的 `MainViewSync` 订阅 `mainView`，根据 `mainView.type` 跳转 `/` 或 `/panel/:panelId`。

**问题**：S16.3 要删除 `mainView`/`setMainView` 字段，且 CanvasHome 是 `setMainView` 的唯一调用者，删除 CanvasHome 后 `mainView` 永远是初始值 `{type:'canvas-home'}`，MainViewSync 失去意义。

**改为**：**删除整个 MainViewSync 函数**和 `<MainViewSync />` 引用，并**同步清理 react-router-dom 的未使用 import**。

[App.tsx:6](file:///f:/allmylife/event/client/web/src/App.tsx) 当前：
```tsx
import { Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom'
```
`useNavigate` 和 `useLocation` 的唯一消费者是 MainViewSync（line 40-41），删除 MainViewSync 后两者变未使用。`tsconfig.app.json` 设了 `noUnusedLocals: true`，不清理会编译失败。

**改为**：
```tsx
import { Routes, Route, Navigate } from 'react-router-dom'
```

路由完全由 React Router 管理：
- `/` → Workspace（画布主页）
- `/panel/:panelId` → Workspace（指定面板，见 3.4）
- `/login`/`/settings`/`/migration` 保留

### 3.4 修复 `/panel/:panelId` 哑路由

**当前**：Workspace 不读 URL panelId，直接访问 `/panel/abc` 不会激活 abc 面板（只渲染 activePanelId 对应面板）。

**改造**：Workspace 顶部加 useParams + useEffect：
```tsx
import { useParams } from 'react-router-dom'

const { panelId: urlPanelId } = useParams<{ panelId: string }>()
const setActivePanel = useAppStore(s => s.setActivePanel)

useEffect(() => {
  if (urlPanelId && urlPanelId !== activePanelId) {
    setActivePanel(urlPanelId).catch(console.error)
  }
}, [urlPanelId, activePanelId, setActivePanel])
```

**验收**：浏览器打开 `/panel/abc` 后 abc 面板被激活；切换面板时 URL 不变（不强制同步，避免循环）。

### 3.5 Workspace 加三个浮层入口（关键，补 CanvasHome 丢失的功能）

**当前问题**：CanvasHome 删除后，用户在画布内**无法**：
1. 切换/新建/删除面板（CanvasHome 的最近面板区没了）
2. **添加 widget**（CanvasHome 的"添加组件"对话框是唯一入口；Workspace 第 1242 行"点击右下角 + 添加组件"是误导提示，**实际没有 FAB**——已实地核对）
3. 进入设置页（CanvasHome 第 302-329 行有设置浮动按钮，删除后丢失）

S16.1 必须在 Workspace 内补这三个浮层入口，否则"8 widget 不回归"验收必失败（用户无法创建 widget）。

#### 3.5.1 添加 widget FAB（右下角，最关键）

**位置**：Workspace 右下角浮层（z-index 高于 canvas）
**形态**：
- 一个圆形 `+` 按钮（参考 [CanvasHome.tsx:138-153](file:///f:/allmylife/event/client/web/src/components/CanvasHome.tsx) 的 `handleAddWidget` 实现）
- 点击展开 widget 类型列表（弹层/下拉），列出 8 类内置 widget + 动态组件
- 复用 `getBuiltInWidgetConfigs()` + `getDynamicWidgetConfigs()` 从 `../registry` 获取 widget 类型列表（CanvasHome 已用，确认可用）
- 点击某类型调 `useAppStore(s => s.addWidget)(widgetType, { panelId: activePanelId })`（addWidget 签名已确认：`(widgetType: string, state?: { panelId?: string }) => Promise<void>`）
- 用 `useToastStore` 包 loading/success/error 反馈（参考 CanvasHome 第 140-152 行）

**实现要点**：
- 复用 CanvasHome 的添加组件对话框 UI 逻辑（读 CanvasHome.tsx 添加组件弹层部分，迁移到 Workspace）
- widget 类型分组（基础/时间与任务/生活与健康/媒体与阅读/学习工具/AI 助手）保留
- FAB 按钮 + 弹层用 inline style 或复用现有 CSS class（不引入新依赖）

**验收**：画布内点右下角 `+` → 弹出 widget 类型列表 → 选一个类型 → widget 出现在画布上。

#### 3.5.2 面板切换下拉（左上角）

**位置**：Workspace 左上角浮层
**形态**：
- 一个按钮显示当前面板名，点击展开下拉列表
- 列出所有面板（`useAppStore(s => s.panels)`），每项点击调 `setActivePanel(panelId)` + `navigate('/panel/' + panelId)`
- 底部"新建面板"按钮调 `useAppStore(s => s.addPanel)('新面板')`
- 每项右侧"删除"小按钮调 `useAppStore(s => s.removePanel)(panelId)`（删除当前面板后自动切到剩余面板或回 WelcomeScreen）

**复用**：`useAppStore.setActivePanel`（内部已处理 panelMemoryManager + 持久化，返回 `Promise<void>`）+ `useAppStore.addPanel` + `useAppStore.removePanel`

**验收**：画布内能切换面板（不离开画布）；能新建面板；能删除当前面板。

#### 3.5.3 设置入口按钮（右上角）

**位置**：Workspace 右上角浮层
**形态**：直接复用 [CanvasHome.tsx:302-329](file:///f:/allmylife/event/client/web/src/components/CanvasHome.tsx) 的设置按钮样式（inline style，`Settings` 图标 + "设置"文字，`onClick={() => navigate('/settings')}`）
**实现**：Workspace 顶部加 `const navigate = useNavigate()`，按钮 onClick 调 `navigate('/settings')`

**验收**：画布内点设置按钮 → 跳转到 `/settings` 页面 → 可配置 AI Key/提示词/Skills/工具。

#### 3.5.4 三个浮层的 z-index 与样式

- 三个浮层都用 `position: absolute` + `zIndex: 100`（高于 canvas-container）
- FAB（右下）+ 面板切换（左上）+ 设置（右上）三角分布，不互相遮挡
- 样式参考 CanvasHome 的设置按钮 inline style（`border: 1px solid var(--border-default)` + `background: var(--bg-surface)`）
- 不引入新 CSS 文件，inline style 即可

### 3.6 S16.1 验收标准

- [ ] 路由 `/` 渲染 Workspace（不经过 CanvasHome）
- [ ] App.tsx 已删除 `import CanvasHome` + react-router-dom import 清理为 `import { Routes, Route, Navigate }`
- [ ] 登录后立即看到画布或 WelcomeScreen（无面板时）
- [ ] WS 连接正常建立（useAIStore.initialize 在 Workspace useEffect 调用）
- [ ] AIAssistant widget 能发消息收到回复（ensurePrimarySession 在 Workspace 调用）
- [ ] 浏览器直接访问 `/panel/abc` 激活 abc 面板
- [ ] **画布内右下角 `+` FAB 能弹出 widget 类型列表，选一个类型后 widget 出现在画布**
- [ ] 画布内能切换/新建/删除面板（左上角下拉）
- [ ] 画布内能点设置按钮跳 `/settings`（右上角）
- [ ] MainViewSync 已删除，路由切换正常无重定向循环
- [ ] `cd client/web && npx tsc --noEmit` 无错（含 noUnusedLocals 检查）
- [ ] 现有功能不回归：8 widget / 笔迹 / 连线 / 小地图 / AuthGuard / WS / AIAssistant

---

## 四、S16.2 归档 CanvasHome

### 4.1 归档操作

| 操作 | 详情 |
|---|---|
| 新建 `_archive/` 目录 | `client/web/src/_archive/`（不存在，需创建） |
| 移动 CanvasHome.tsx | **用 `git mv`** 保留历史：`git mv client/web/src/components/CanvasHome.tsx client/web/src/_archive/CanvasHome.tsx` |
| 移动 FavoriteWidgetPreview.tsx | **用 `git mv`**：`git mv client/web/src/components/FavoriteWidgetPreview.tsx client/web/src/_archive/FavoriteWidgetPreview.tsx`（仅被 CanvasHome 引用，调研确认） |
| App.tsx 删除 import | 删除 `import CanvasHome from './components/CanvasHome'`（S16.1 已完成） |

### 4.2 TS 编译隔离

`_archive/` 目录的 `.tsx` 文件默认仍会被 `tsc` 编译。**关键**：实际参与 src 编译的是 `client/web/tsconfig.app.json`（root `tsconfig.json` 只有 references，无 include/exclude）。

**改造**：修改 [`client/web/tsconfig.app.json`](file:///f:/allmylife/event/client/web/tsconfig.app.json)，新增 `exclude` 数组：
```json
{
  "include": ["src"],
  "exclude": ["src/_archive"],
  ...
}
```
（保留原有 compilerOptions 等）

Vite 构建靠 import graph，`_archive` 不被任何地方 import，自动不打包，无需额外配置。

### 4.3 S16.2 验收标准

- [ ] `_archive/CanvasHome.tsx` 和 `_archive/FavoriteWidgetPreview.tsx` 存在
- [ ] `client/web/src/components/` 下不再有 CanvasHome.tsx / FavoriteWidgetPreview.tsx
- [ ] `client/web/tsconfig.app.json` 的 `exclude` 含 `src/_archive`
- [ ] `cd client/web && npx tsc --noEmit` 无错（_archive 不参与编译）
- [ ] `npm run build` 构建产物不含 CanvasHome 代码

---

## 五、S16.3 清理死代码

### 5.1 删除 Home.tsx

[`pages/Home.tsx`](file:///f:/allmylife/event/client/web/src/pages/Home.tsx) 是 S11 占位页，**0 引用**（调研确认）。直接删除文件。

### 5.2 清理 useAppStore.ts 的死字段

**删除字段**（[useAppStore.ts](file:///f:/allmylife/event/client/web/src/stores/useAppStore.ts)）：

| 字段 | 行号 | 删除条件 |
|---|---|---|
| `webTabs: WebTab[]` | 271 | CanvasHome 删除后无外部消费者 |
| `activeWebTabId` | 272 | 同上 |
| `addWebTab` | 273, 2587-2601 | 同上 |
| `closeWebTab` | 274, 2603-2611 | 同上 |
| `setActiveWebTab` | 275, 2612 | 同上 |
| `updateWebTab` | 276, 2615- | 同上 |
| `mainView: MainView` | 279 | MainViewSync 删除后无消费者 |
| `setMainView` | 280, 2628 | 同上 |
| `homeTemplate: HomeTemplateType` | 325 | 仅 CanvasHome 引用 |
| `setHomeTemplate` | 326, 3004-3007 | 同上 |

**删除相关代码**：
- `debouncedWebTabsSave` 防抖保存逻辑（line 404-408）
- `_prevWebTabs` subscribe 跟踪（line 515-517）
- `loadWebTabs` 初始化加载（line 1025-1055）
- webTabs subscribe 持久化（line 1041-1055）
- webTabs 清理逻辑（line 1990）
- `loadHomeTemplateFromStorage` 函数（如果只被 homeTemplate 用）
- import 语句中的 `WebTab` / `MainView` / `MainViewType` / `HomeTemplateType`

**保留**：
- `bookmarks`/`addBookmark`/`removeBookmark`/`toggleBookmarkHome`（不在 roadmap 清单，保守不动）
- `settings.canvasHome`（这是 AppSettings 字段，与 CanvasHome 组件无关）

### 5.3 清理 types/index.ts

**删除类型**（[types/index.ts](file:///f:/allmylife/event/client/web/src/types/index.ts)）：

| 类型 | 行号 |
|---|---|
| `WebTab` interface | 123-132 |
| `MainViewType` | 154 |
| `MainView` interface | 156-161 |
| `HomeTemplateType`（如果存在且仅被 useAppStore 引用） |

**保留**：`Bookmark`（不在清理范围）。

### 5.4 清理 db.ts

**删除函数**（[db.ts](file:///f:/allmylife/event/client/web/src/utils/db.ts)）：

| 函数 | 行号 |
|---|---|
| `WEB_TABS_STORE` 常量 | 2665 |
| `saveWebTabs` | 2671-... |
| `getWebTabs` | 2684-... |
| `getAllWebTabs` | 2831-... |
| 相关 import 的 `WebTab` 类型 | 1 |

**保留**：`bookmarks` 相关函数 + dbV2.ts 的 `webTabs`/`bookmarks` store 声明（避免破坏 IDB schema 升级路径）。

### 5.5 清理 searchIndexAdapters.ts

**删除**（[searchIndexAdapters.ts](file:///f:/allmylife/event/client/web/src/utils/searchIndexAdapters.ts)）：

| 项 | 行号 |
|---|---|
| `getAllWebTabs` import | 9 |
| `adaptWebTabs` 函数 | 333-351 |
| `namedAdapter(adaptWebTabs, 'webTabs')` 注册 | 547 |

**保留**：`adaptBookmarks`（不在清理范围）。

### 5.6 S16.3 验收标准

- [ ] `pages/Home.tsx` 已删除
- [ ] `grep -r "webTabs" client/web/src` 仅命中 dbV2.ts 的 store 声明（保留）+ 注释
- [ ] `grep -r "MainView\b" client/web/src` 0 命中（类型已删）
- [ ] `grep -r "setMainView" client/web/src` 0 命中
- [ ] `grep -r "homeTemplate" client/web/src` 0 命中
- [ ] `grep -r "WebTab" client/web/src` 仅命中 dbV2.ts 的 store 声明（保留）+ 注释
- [ ] `cd client/web && npx tsc --noEmit` 无错
- [ ] `cd client/web && npm run build` 成功
- [ ] IndexedDB 初始化无错（dbV2.ts 保留 webTabs store 声明，无代码访问它）

---

## 六、S16.4 Docker 镜像重建 + 部署 + 运行时验证

### 6.1 本地构建验证

```powershell
cd f:\allmylife\event\client\web
npm run build  # 验证 Web 端构建成功
cd f:\allmylife\event\server
docker build -t event-server:v0.6.1-s16 .  # 多阶段构建含 Web 产物
```

**验收**：构建成功，镜像存在。

### 6.2 部署到 shadowshub.xyz

**前置条件**：需要服务器 SSH 凭据（`.env.server` 或用户提供）。

部署步骤：
1. `docker save event-server:v0.6.1-s16 | gzip > event-server-s16.tar.gz`（保存到非 C 盘，如 `f:\allmylife\event\.tmp\`）
2. `scp event-server-s16.tar.gz root@154.37.222.110:/root/`
3. SSH 到服务器：`docker load < event-server-s16.tar.gz`
4. 更新 `docker-compose.prod.yml` 的 image tag 为 `v0.6.1-s16`
5. `docker compose -f docker-compose.prod.yml up -d`
6. 验证容器 Up

### 6.3 运行时验证（必须实际打开网址确认）

**前置条件**（执行前用 AskUserQuestion 向用户确认）：
- `WEB_ACCESS_PASSWORD`：从 `.env.server` 读取或由用户提供（运行时验证登录需要）
- `SERVER_TOKEN`：从 `.env.server` 读取或由用户提供（桌面端兼容性验证需要）
- SSH 凭据：`root@154.37.222.110` 的 SSH 私钥路径或密码（部署需要）

**验证方式标注**：🤖 = playwright-browser skill 自动化 / 👤 = 用户手动 / 🖥️ = 命令行

| 验证项 | 方法 | 方式 | 期望结果 |
|---|---|---|---|
| 主页保留 | `curl https://shadowshub.xyz/` | 🖥️ | 仍是现有主页内容 |
| Web 端入口 | 浏览器打开 `https://shadowshub.xyz/daily/` | 🤖 | 看到登录页 |
| 登录即画布 | 输入密码登录 | 🤖 | **立即看到画布或 WelcomeScreen**（不再有中转页） |
| 添加 widget FAB | 画布内点右下角 `+` → 选一个 widget 类型 | 🤖 | widget 出现在画布上 |
| 面板切换 | 画布内点左上角面板下拉 → 切换/新建/删除 | 🤖 | 操作正常 |
| 设置入口 | 画布内点右上角设置按钮 | 🤖 | 跳转到 `/settings` |
| 直链面板 | 浏览器打开 `https://shadowshub.xyz/daily/panel/<panelId>` | 🤖 | 激活对应面板 |
| WS 连接 | 画布内创建 AIAssistant widget 发消息 | 🤖 | 收到 AI 回复 |
| 8 widget | 创建每种 widget | 🤖 | 全部能创建 + 渲染 |
| 笔迹 | 切换 draw 模式画一笔 | 🤖 | 笔迹正常显示 |
| 连线 | 切换 connect 模式连两个 widget | 🤖 | 连线正常显示 |
| 小地图 | 查看 Minimap | 🤖 | 实时反映画布 |
| 桌面端兼容 | `wscat -c "wss://shadowshub.xyz/ws?token=$SERVER_TOKEN"` 或写 mjs 脚本发 ping | 🖥️ | WS 连接成功，30s 内不断开 |
| TS 编译 | `cd client/web && npx tsc --noEmit` | 🖥️ | 0 error |
| 构建成功 | `cd client/web && npm run build` | 🖥️ | 构建产物生成 |

**自动化验证策略**：用 playwright-browser skill 打开 `https://shadowshub.xyz/daily/`，输入密码登录，截图确认看到画布；然后依次点 FAB 创建 widget、点面板切换、点设置按钮，每步截图。如果 playwright 验证某项失败，回退到 👤 用户手动验证。

### 6.4 S16.4 验收标准

- [ ] Docker 镜像 `event-server:v0.6.1-s16` 构建成功
- [ ] 部署到 shadowshub.xyz/daily/ 成功
- [ ] **运行时验证全部通过**（特别是"登录即画布"）
- [ ] 主页 `https://shadowshub.xyz/` 未被抢占
- [ ] 桌面端兼容性验证通过
- [ ] 现有 S11-S15 功能不回归

---

## 七、风险与缓解

| 风险 | 缓解 |
|---|---|
| WS 初始化迁移遗漏 → 实时同步丢失 | S16.1 §3.2 明确迁移 useEffect + 运行时验证 AIAssistant widget |
| 删除 mainView 后 MainViewSync 残留 → 编译错 | S16.1 §3.3 删除 MainViewSync 函数 + `<MainViewSync />` 引用 |
| dbV2.ts 删 webTabs store 声明破坏 IDB 升级 | **保留 dbV2.ts 的 webTabs store 声明**，只清理上层代码 |
| CanvasHome 功能丢失（设置入口/添加组件/AI 对话框） | 符合 S16"只要画布"意图；设置走 `/settings` 路由；添加组件走 Workspace FAB；AI 对话统一到 AIAssistant widget |
| `/panel/:panelId` 哑路由修复引入循环 | useEffect 比较 urlPanelId !== activePanelId 才调 setActivePanel，避免循环 |
| 部署需要 SSH 凭据 | S16.4 执行前向用户确认凭据来源（`.env.server` 或用户提供） |

---

## 八、执行顺序

1. **S16.1**（路由 + WS 迁移 + MainViewSync 删除 + 三个浮层入口 + 哑路由修复）→ TS 编译通过
2. **S16.2**（git mv 归档 CanvasHome + FavoriteWidgetPreview + tsconfig.app.json exclude）→ TS 编译通过 + 构建成功
3. **S16.3**（删 Home.tsx + 清理死代码链）→ TS 编译通过 + grep 验证 + 构建成功
4. **S16.4**（Docker 构建 + 部署 + 运行时验证）→ 实际打开网址确认看到画布
5. **git commit**（S16 全部变更）——**仅在用户明确要求后执行**（遵守用户规则 "NEVER commit changes unless the user explicitly asks you to"）。默认不 commit，仅保留工作区变更，等用户验收通过并明确要求时再 commit。

---

## 九、对抗审查检查点

- [ ] spec 自审：路由改造完整性、WS 迁移无遗漏、死代码清理无残留、运行时验证覆盖所有不回归项
- [ ] 编码后对抗审查（adversarial-review skill）：TS 编译 + grep 验证 + 浏览器运行时验证
- [ ] 部署后对抗审查：实际打开 `https://shadowshub.xyz/daily/` 确认看到画布

---

**Spec 完成。下一步：对抗审查 → 修订 → 启动 sub-agent 执行。**
