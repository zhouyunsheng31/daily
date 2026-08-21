# 02 · web 路线总架构

> 现状盘点（实证）→ 目标模块结构 → 契约与守卫 → 单体拆分纪律 → 数据所有权。

## 1. 架构总览

```
┌─────────────────────────── client/shell-web（PWA，React 19+Vite+Tailwind4+Zustand） ──┐
│ 视图：assistant(对话主页) / desktop(系统桌面) / files / profile / app / store / experience │
│ Runtime：iframe sandbox="allow-scripts" + MessageChannel SDK（runtime.ts，契约权威源）      │
│ PWA：manifest + SW（离线壳）、横滑导航（对话⇄桌面，已有 useSwipeNavigation）                │
└──────────────────────────────┬─────────────────────────────────────────────────────────┘
                               │ HTTPS（JWT Cookie，credentials:'include'）+ SSE（chat/stream）
┌──────────────────────────────┴─────────────────────────────────────────────────────────┐
│ server/（Express 5 + pi + PG/SQLite，pm2 daily-server:3456）                            │
│  routes/webos.ts（409KB，冻结） + routes/*（既有） + 🆕 server/src/webos/ 模块目录        │
│  piBridge.ts（会话 + 30+ 工具；工具实现体进 webos/ 模块，piBridge 只做适配）              │
│  工作区 data/workspace/webos/<userKey>/（home/ apps/ shared/ system/ agent/ skills/）   │
└──────────────────────────────────────────────────────────────────────────────────────────┘
                               │ 契约（单一事实源）
┌──────────────────────────────┴─────────────────────────────────────────────────────────┐
│ shared/webos-contracts/（bootstrap/事件/包/计费/文件类型 + daily.pkg.json·api.json schema） │
│ shared/agent-bridge-contract/（桥 JSON-RPC schema：web=WS / 移动端=stdio，schema 一份）   │
└──────────────────────────────────────────────────────────────────────────────────────────┘
```

## 2. 现状盘点（2026-08-18 实证，非拍脑袋）

| 资产 | 现状 | 本路线动作 |
|---|---|---|
| `client/shell-web/src/App.tsx`（187KB） | 全视图单体 | 触及即瘦身：新视图进 `features/` 子目录，App.tsx 只留路由骨架 |
| `store.ts`（88KB）/ `api.ts`（30KB） | 状态/请求层 | 新域（packages/appApi/market）新建独立模块，不继续膨胀 |
| `runtime.ts`（35KB） | iframe 沙箱 + MessageChannel（`handleDesktopRequest` 为桌面桥契约权威源） | 新增 SDK 方法先改这里，移动端桥镜像跟随（R6/R7） |
| `routes/webos.ts`（409KB） | StoredApp/StoredVersion/StoredState + 全部路由 | **冻结**；新端点禁入；触及即瘦身 |
| `utils/webosWorkspace.ts` | 工作区 + agent_fs_* + 文件夹即 App | 保留；File Service 一阶段在此双写元数据（07） |
| 系统模板 `webosDesktopV1/StoreV1/TrashV1.ts` | 版本化 HTML App（AI 可改形态） | web 主场升级（桌面 V2，08；商店扩展，05） |
| `webos_store_*` 表 | 商店/分享/下载奖励 | 扩展 type 维度 + api 包（05） |
| `billing/` | 积分（1 积分=¥0.01）+ chat/image/search/video/tts + zpay/爱发电/月卡 | kind 扩展 api/room(后置)/compute(预留)（06） |
| 商店 API 代理 `POST /webos/api/http` | 已存在（App 调外部 API，防 SSRF + 限频） | 并入 04 的 ctx.http 白名单模型统一语义 |

## 3. 目标服务端模块结构（`server/src/webos/`，全部新建）

```
server/src/webos/
├── packages.ts      # 包流水线（03）：daily.pkg.json 校验/注册/版本/回滚/列表
├── appApi.ts        # App API（04）：api.json 解析、handler 受限 vm、代理端点、动态工具注册
├── apiRuntime.ts    # handler 执行器（vm 池 + 超时 + 截断 + ctx 白名单 + 计费/审计钩子）
├── market.ts        # 市场（05）：发布/审核/依赖闭包/安装/计费
├── files/           # File Service（07）：files 元数据 + manifest/blob/分块 + reconcile
├── desktopLayout.ts # 桌面布局端点（08，R7 桌面模板 V2 配套；移动端 M1-4 依赖）
├── contracts/       # 与 shared/ 同步的服务端实现（校验器/词汇表/fixtures）
└── (后置) rooms.ts / media/ / externalApps.ts
```

挂载方式：`webosRouter.use('/packages', packagesRouter)` 等；**禁止**在 webos.ts 新增 >50 行代码块。

## 4. 契约与守卫（R6 落地）

| 契约物 | 位置 | 守卫 |
|---|---|---|
| bootstrap/事件/包/计费/文件类型 | `shared/webos-contracts/` | 服务端与 shell-web 直接 import 类型；移动端 Kotlin DTO 镜像 |
| `daily.pkg.json` / `api.json` schema | `shared/webos-contracts/packages/`（TypeBox） | 服务端校验器 + fixtures（合法/非法各 ≥10 例）；移动端同款 fixtures 反序列化测试 |
| 能力词汇表 | `shared/webos-contracts/capabilities.ts` | 新增词汇必须：登记 Broker + 写进 03 文档 + 双端实现，缺一不可上线 |
| 桥协议（SDK 方法） | `shared/agent-bridge-contract/` | 桌面桥以 `runtime.ts handleDesktopRequest` 为权威；移动端 `DailyJsBridge` 镜像 |

**规则**：契约变更 = 一次 PR 同步改 `shared/` + 服务端 + 移动端 DTO + fixtures；CI 中 fixtures 反序列化测试缺字段即红。

## 5. 单体拆分纪律（沿用 docs/android/02 §6）

1. **webos.ts 冻结**：新端点一律进 `webos/` 新模块。
2. **触及即瘦身**：必须改 webos.ts 某块逻辑时，把该块按域抽到新模块（一次只抽一个域，行为不变 + 回归）。
3. **piBridge 不膨胀**：新增 pi 工具统一进注册区，但**实现体放 `webos/` 模块**，piBridge 只做适配层。
4. **shell-web 同纪律**：新视图/新域进 `features/`；App.tsx/store.ts 不新增大段逻辑。

## 6. 数据所有权与状态流

- **服务端权威**：包/版本、storage、商店、房间（后置）、文件元数据、积分/订单、会话（web 端）。
- **shell-web 本地**：IndexedDB 缓存（离线壳/草稿）；PWA SW 缓存静态资源与已装 App。
- **移动端权威（端侧，R8）**：AI 会话/记忆/skills、BYOK 密钥（Keystore）；后台加密同步可选。
- **冲突**：storage key 级 LWW；桌面布局由 system.desktop 版本机制天然解决；文件走 07 的 etag 冲突副本策略。