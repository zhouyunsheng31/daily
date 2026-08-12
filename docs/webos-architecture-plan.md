# Daily webOS 架构与落地规划

> 状态：Draft / 方向 A 已选定，P0 功能范围确认中
>
> 决策日期：2026-07-30；P0 补充：2026-07-31
>
> 当前阶段：只允许更新规则、规划与 `docs/prototype/webos/` 原型；P0 范围确认前不创建生产 Shell，不修改数据库 Schema、现有业务或 WS 协议。

## 1. 决策摘要

Daily 采用“**同仓并行新壳、复用既有底座、逐步收敛旧产品**”的方式演进为移动端优先的 AI-native webOS：

- 不新开一个完全独立的空仓库；
- 不把现有 `client/web/` 的无限画布原地改造成手机系统；
- 规划新建 `client/shell-web/`，作为移动端 PWA Shell；
- 复用 `server/` 的认证、pi-agent、WebSocket 事件流、工具调用和已有上传能力；
- 将现有无限画布最终封装为系统内置 Canvas App；
- 先验证“对话 → AI 生成 App → 即刻运行 → AI 修改 → 新版本回滚”的闭环。

“webOS”目前仅作为产品形态描述和内部代号。正式品牌名需另行确定，避免与既有商标产生混淆。

## 2. 产品北极星

首个真正需要验证的闭环不是仿手机动画本身，而是：

```text
用户描述需求
  → AI 理解上下文并生成静态 HTML App
  → 沙箱预览
  → 用户确认权限
  → 安装到桌面并立即运行
  → App 数据持久化
  → 用户继续让 AI 修改
  → 产生不可变新版本
  → 可查看差异并一键回滚
```

移动端首次打开会自动获得游客身份并进入系统级 AI 助手，而不是登录页或普通 App。助手需要始终能感知当前任务、已安装 App、授权文件和运行状态，但所有实际能力都必须经过权限中介。

### 2.1 已确认的 P0 产品基线

完整清单见 [webos-p0-feature-list.md](webos-p0-feature-list.md)。架构必须满足以下已确认边界：

- 方向 A「安静智能」是首版默认且唯一主题；
- 游客优先，自动发放免费余额；邮箱验证码只用于绑定、同步和游客资产迁移；
- 支付页面、余额与 Usage Ledger 属于 P0，真实 Provider 未接入时不得伪造交易成功；
- AI 模型与四档思考强度是两项独立 P0 控制；
- 默认内置 Daily AI、系统桌面、文件管理器和系统设置；
- P0 不做语音、产品锁屏、多任务卡片、公共商店、外部 URL App 或服务型 App；
- App 默认全屏，第三方静态 App 首版只开放 `app.storage.private`。

## 3. 现有工程评估

### 3.1 可直接复用或增量演进

| 现有能力 | 位置 | 演进方向 |
|---|---|---|
| pi-agent Session 与工具调用 | `server/src/piBridge.ts` | 复用 Agent 核心，逐步从 panel 上下文抽象为 workspace/session 上下文 |
| WS 流式事件 | `server/src/ws.ts`、Web Store | 复用连接与流式事件思路；新增协议必须版本化 |
| 用户认证与角色 | `server/src/routes/auth.ts` | 复用账户体系，后续补 Passkey、设备会话与更细资源所有权 |
| HTML iframe 沙箱 | `client/web/src/components/widgets/HtmlCanvasWidget.tsx` | 作为 App Runtime 技术验证参考，不能直接当生产 App Runtime |
| HTML 上传 | `custom_widgets`、`UploadWidget.tsx` | 演进为 App Package、App Version 与 Install，不继续扩充 widget 单表 |
| 组件能力声明 | `component_capabilities` | 演进为 App Manifest 能力声明的一部分 |
| 工具启停与授权卡片 | `tool_settings`、PermissionCard | 复用 UI/流程经验，重建资源级 Permission Broker |
| 服务端文件沙箱 | `server/src/sandbox/` | 复用路径校验经验，升级为多租户虚拟文件工作区 |
| IndexedDB + API fallback | `client/web/src/utils/` | 用于 PWA 离线缓存、草稿和 App 本地数据 |
| 背景与视觉特效 | Background Store/Layer | 演进为受控 Theme Package，而非 AI 直接改 Shell 源码 |
| Electron 桌面宿主 | `client/desktop/`、根项目 | 后续桌面 Shell 复用 Agent/Runtime 契约 |

### 3.2 不能直接沿用为新核心模型

- `Panel → 无限画布 → Widget` 不能继续充当系统桌面模型；
- `Workspace.tsx` 的平移、缩放、坐标与多面板保活逻辑不适合移动端任务栈；
- 单个 `custom_widgets.html` 字段不足以承载多文件包、版本、来源、签名和回滚；
- 全局 Tool 开关不足以表达“某 App 对某目录临时只读”一类授权；
- 同时常驻所有 iframe/DOM 的做法不适合手机内存限制；
- 当前社区功能是原型性联邦注册表，不能直接等同于经过审核的应用商店；
- 当前背景文件保存在本地磁盘，不是多租户对象存储与配额系统；
- 当前 Web 客户端没有完整 PWA、ASR、TTS 和系统任务栈实现。

## 4. 目标架构

```text
┌─────────────────────────────────────────────┐
│ Mobile PWA Shell / Future Desktop Shell     │
│ Home · Assistant · Launcher · Task Manager  │
└──────────────────────┬──────────────────────┘
                       │ shared contracts
┌──────────────────────▼──────────────────────┐
│ App Runtime Host                            │
│ iframe sandbox · MessageChannel · lifecycle │
└──────────────────────┬──────────────────────┘
                       │ SDK requests
┌──────────────────────▼──────────────────────┐
│ Permission Broker                          │
│ policy ∩ grant ∩ agent tools ∩ manifest     │
└───────────────┬───────────────┬─────────────┘
                │               │
┌───────────────▼──────┐  ┌─────▼─────────────┐
│ Agent / pi Bridge    │  │ Virtual Files     │
│ plan · tools · audit │  │ metadata · blobs  │
└───────────────┬──────┘  └─────┬─────────────┘
                │               │
┌───────────────▼───────────────▼─────────────┐
│ Server Domain Modules                      │
│ apps · installs · versions · files · usage │
└───────────────┬─────────────────────────────┘
                │
      PostgreSQL + Object Storage
```

## 5. 规划中的仓库结构

> 以下是**确认方向后的目标结构**。除 `docs/prototype/webos/` 外，本阶段不提前创建空目录。

```text
client/
├── web/                              # [已有/维护模式] Legacy Dashboard
├── shell-web/                        # [规划] 移动端优先 PWA Shell
│   ├── public/
│   │   ├── manifest.webmanifest
│   │   ├── icons/
│   │   └── app-fallback.html
│   ├── src/
│   │   ├── app/                      # 路由、Provider、启动恢复
│   │   ├── shell/
│   │   │   ├── assistant-home/       # 默认主页、文字气泡、模型/思考控制
│   │   │   ├── launcher/             # P0 传统图标桌面与 Dock
│   │   │   ├── navigation/           # AI / 桌面 / 全屏 App 导航与恢复
│   │   │   ├── settings/             # 账户、余额、AI、存储与隐私
│   │   │   └── system-sheets/        # 权限、安装、更新、错误等可信 UI
│   │   ├── runtime/
│   │   │   ├── AppFrame.tsx          # iframe 宿主
│   │   │   ├── RuntimeManager.ts     # 生命周期和资源预算
│   │   │   ├── MessageBridge.ts      # MessageChannel RPC
│   │   │   └── AppCrashBoundary.tsx
│   │   ├── features/
│   │   │   ├── app-library/
│   │   │   ├── app-store/
│   │   │   ├── app-upload/
│   │   │   ├── files/
│   │   │   ├── appearance/
│   │   │   ├── permissions/
│   │   │   ├── account/
│   │   │   └── billing/
│   │   ├── agent/                    # pi WS 客户端、会话和工具进度 UI
│   │   ├── pwa/                      # SW 注册、安装提示、更新策略
│   │   ├── stores/                   # Shell 状态；不复制服务端领域规则
│   │   ├── styles/                   # Tokens、safe-area、motion、a11y
│   │   └── test/
│   ├── index.html
│   ├── vite.config.ts
│   └── package.json
└── desktop-shell/                    # [远期规划] 或在现有 Electron 内迁移 Shell

shared/
├── app-manifest/                     # Manifest schema、验证器、版本迁移
├── app-sdk/                          # iframe 内可使用的公开 SDK
├── app-protocol/                     # Runtime RPC 消息与错误码
├── permission-model/                 # 权限常量、资源选择器、授权合并规则
├── file-model/                       # 虚拟路径、文件句柄和元数据契约
├── agent-contracts/                  # Agent 事件、工具进度、审计契约
├── billing-contracts/                # 用量事件、额度、权益，不包含支付商实现
└── design-tokens/                    # Shell 安全主题 schema 与默认主题

server/src/
├── modules/                          # [规划] 新领域模块，逐步从 routes/db 分离
│   ├── apps/
│   │   ├── appPackageService.ts
│   │   ├── appVersionService.ts
│   │   ├── installService.ts
│   │   └── packageValidator.ts
│   ├── permissions/
│   │   ├── permissionBroker.ts
│   │   ├── policyEngine.ts
│   │   └── grantRepository.ts
│   ├── files/
│   │   ├── virtualFileService.ts
│   │   ├── quotaService.ts
│   │   └── blobStore.ts
│   ├── agent/
│   │   ├── workspaceContext.ts
│   │   ├── appGenerationService.ts
│   │   └── auditService.ts
│   ├── usage/
│   │   ├── usageLedger.ts
│   │   └── entitlementService.ts
│   └── store/
│       ├── catalogService.ts
│       └── reviewService.ts
├── storage/
│   ├── objectStorage.ts              # 接口
│   ├── s3ObjectStorage.ts            # S3/R2/OSS 兼容实现
│   └── localObjectStorage.ts         # 本地开发实现
└── routes/v2/                        # 仅当契约确定后新增版本化 API

docs/
├── webos-architecture-plan.md        # 本文
├── prototype/webos/                  # 三方向视觉原型
├── adr/                              # 确认后建立架构决策记录
├── contracts/                        # App/权限/文件协议说明
└── threat-model/                     # Runtime、Agent、上传和供应链威胁模型

e2e/
└── shell-web/                        # 安装、生成、授权、回滚、离线闭环测试
```

## 6. 核心领域模型（概念稿）

以下只定义语义，不代表现在修改数据库：

### 6.1 App 与版本

```text
AppPackage
- id
- ownerId
- appId                      # 稳定逻辑标识，如 com.daily.todo
- name
- source                     # ai | upload | store | builtin
- currentPublishedVersionId
- visibility

AppVersion (immutable)
- id
- packageId
- semanticVersion
- manifestJson
- artifactObjectKey
- artifactHash
- sourceVersionId            # AI 修改链/升级链
- createdBy                  # user | agent | store
- buildStatus
- securityScanStatus
- createdAt

AppInstall
- id
- userId
- packageId
- activeVersionId
- installSource
- installedAt
- updatedAt

AppPlacement
- id
- installId
- pageId
- position
- displayMode

AppInstance
- runtimeId                  # 通常是短期状态，必要时只持久化恢复快照
- installId
- lifecycleState            # launching | foreground | background | suspended | terminated
- snapshotRef
```

### 6.2 权限

```text
PermissionGrant
- id
- userId
- subjectType                # app | agent | agent_for_app
- subjectId
- capability                 # files.read / files.write / network.fetch / microphone...
- resourceSelector           # app-private / selected path / domain allowlist...
- scope                      # once | session | permanent
- decision                   # allow | deny
- expiresAt
- createdBy
- auditContext
```

### 6.3 文件与用量

```text
FileNode
- id
- ownerId
- parentId
- name
- kind                       # directory | file
- blobId
- mimeType
- size
- version
- deletedAt

BlobObject
- id
- objectKey
- contentHash
- size
- encryptionMetadata
- refCount

UsageEvent
- id
- userId
- category                   # ai_input / ai_output / storage / egress / compute
- quantity
- unit
- sourceId
- idempotencyKey
- occurredAt
```

## 7. App Package 与 Manifest

MVP 接受两种用户输入：

1. 单个 HTML 文件；
2. 已构建完成的静态 ZIP（HTML/CSS/JS/图片）。

服务端统一规范化为不可变 App Artifact。首版禁止上传需要 Node/Python 构建或服务端长期运行的工程。

Manifest 草案：

```json
{
  "manifestVersion": 1,
  "id": "com.daily.example.todo",
  "name": "轻待办",
  "version": "1.0.0",
  "entry": "index.html",
  "display": "fullscreen",
  "orientation": "portrait-primary",
  "icons": {
    "192": "icons/192.png",
    "512": "icons/512.png"
  },
  "permissions": [
    { "capability": "storage.app" },
    { "capability": "files.read", "selector": "user-selected" },
    { "capability": "notification.show" }
  ],
  "network": {
    "allowedOrigins": []
  }
}
```

必须验证：路径穿越、绝对路径、符号链接、ZIP bomb、文件数和体积、入口存在性、MIME、危险声明、重复 ID、Manifest 版本、哈希一致性。

## 8. HTML App Runtime

### 8.1 隔离

- 默认 `sandbox="allow-scripts"`；
- App 内容使用独立 origin 或 opaque origin；
- 不授予 `allow-same-origin`，除非将来有经威胁建模的新运行模式；
- 严格 CSP，禁止 App 直接连接未授权域名；
- App 不可读取 Shell Cookie、JWT、对象存储凭证、宿主 DOM；
- 系统权限弹层必须渲染在 Shell，不允许 iframe 自绘后冒充系统授权。

### 8.2 通信

iframe 加载后由宿主建立 `MessageChannel`，SDK 只拿到一个受控端口：

```text
app.ready
host.init
app.request { requestId, method, params }
host.result { requestId, ok, data | error }
host.event { event, payload }
```

每次请求校验：

```text
协议版本
→ runtimeId
→ App Install 与 Version
→ Manifest 是否声明
→ 平台策略是否允许
→ 用户 Grant 是否允许
→ 资源 selector 是否命中
→ 配额是否充足
→ 执行并写审计日志
```

### 8.3 生命周期与内存

手机端不能长期保留所有 iframe：

- 只保证前台 App 活跃；
- 最近任务可短期保留；
- 超出内存预算后触发 `suspend`，让 App 保存快照；
- 系统通知、定时任务等必须由宿主服务承载，不能依赖隐藏 iframe 永久在线；
- 恢复时从 App 私有存储和快照重建。

## 9. 权限模型

有效授权：

```text
平台安全策略
∩ 用户 PermissionGrant
∩ Agent 当前 Tool 权限
∩ App Manifest 能力声明
∩ 当前资源范围和配额
```

权限建议分组：

- `storage.app.read/write`：App 私有数据；
- `files.read/write/delete`：用户选择的文件或目录；
- `network.fetch`：指定 origin；
- `microphone.capture`：麦克风；
- `speech.transcribe/synthesize`：ASR/TTS 服务；
- `notification.show/schedule`：通知；
- `clipboard.read/write`：剪贴板；
- `agent.request`：请求 Agent 执行能力；
- `app.manage.self`：申请修改自身草稿，不可直接覆盖已发布版本；
- `theme.preview`：提交主题预览，不可直接写 Shell 源码。

危险操作（删除、公开发布、购买、部署服务、扩大权限）不能使用模糊的永久授权兜底，必须提升确认等级。

## 10. AI 生成与修改 App

推荐流水线：

```text
需求澄清
→ 创建 Source Workspace
→ Agent 生成/修改文件
→ 静态检查与 Manifest 验证
→ 构建或规范化 Artifact
→ 安全扫描
→ 沙箱预览
→ 展示文件差异、权限变化和用量预估
→ 用户确认
→ 创建不可变 AppVersion
→ 安装或原子切换 activeVersionId
→ 保留回滚点与审计日志
```

重要约束：

- Agent 工作区和已发布 Artifact 分离；
- 修改永远创建新版本；
- 新版本新增权限时必须重新授权；
- Agent 不能自行公开发布或购买资源；
- 生成失败不能破坏当前可用版本；
- 所有生成应可追溯到会话、模型、工具调用和源版本。

## 11. 虚拟文件工作区

用户和 Agent 看到的是虚拟路径，不是服务器真实路径：

```text
/
├── Files/
├── Apps/
│   └── <app-id>/
│       ├── source/
│       └── releases/
├── AppData/
│   └── <install-id>/
└── Agent/
    ├── memory/
    └── artifacts/
```

- PostgreSQL 保存树结构、所有权、版本和配额；
- S3/R2/OSS 保存二进制对象；
- 上传下载通过短时 Signed URL 或服务端流代理；
- 每个 Agent 工具调用都绑定 userId、sessionId 和 grant；
- 删除默认进入回收站并有保留期；
- 对象内容按 hash 去重时仍需保持租户计费与访问隔离；
- 对象存储访问密钥永不下发给 App iframe。

## 12. PWA 与移动端体验

MVP 的“接近 App”验收范围：

- `manifest.webmanifest`、图标、启动参数和 standalone 显示；
- Service Worker 提供离线 Shell 和静态资源缓存；
- 新版本提示与可控刷新，避免运行中静默破坏状态；
- iOS/Android safe-area、软键盘、横竖屏、触控和返回手势；
- 首屏骨架、游客会话与最近 App 恢复；
- AI 首页、传统图标桌面和全屏 App 之间的稳定导航；P0 不做多任务卡片；
- 可访问性：减弱动效、对比度、44px 触控目标、键盘与读屏语义；
- 中低端设备降级毛玻璃、粒子和高成本 `backdrop-filter`。

P0 不设置产品锁屏。即使未来增加，产品锁屏也只是界面而不是设备安全边界；账户保护依赖服务端会话，后续可考虑 Passkey/WebAuthn。

## 13. 语音能力（首版暂缓）

- 首版不实现 ASR、TTS、麦克风输入、语音 Orb、唤醒词或后台录音；
- AI 首页和输入区只提供文字交互，不申请麦克风权限；
- Runtime P0 不开放 `microphone.capture` 或 `speech.*` Capability；
- 后续若恢复语音方向，必须重新完成隐私、权限、保留策略、延迟和用量计费设计，不能把浏览器语音 API 当作一致性承诺。

## 14. 应用分发边界

### MVP

- AI 生成；
- 本地单 HTML/静态 ZIP 上传；
- 私有 App Library；
- 少量经过人工审核的内置/精选 App。

### 后续

- 公共商店、开发者身份、签名、审核、举报、撤回；
- Store Version 更新策略和权限差异提示；
- 社区发布与内容治理；
- 软件物料清单、依赖和供应链扫描。

### 明确不进入首版

OpenWebUI、SillyTavern 等需要 Node/Python/数据库的项目不是静态 HTML App。其“一键体验”属于托管服务平台，需要容器编排、资源隔离、域名、反向代理、升级、备份与计算计费。P0 不支持外部 URL App、托管服务 App 或演示实例。

## 15. 账户、计费与配额

### 15.1 游客与邮箱绑定

- 首次打开自动创建不可猜测的游客身份并发放可配置免费余额；
- 登录不是系统入口，邮箱验证码只承担绑定、同步和游客资产迁移；
- 游客的 App、版本、私有数据、用量和未消耗权益迁移必须原子、幂等，失败时保留游客资产；
- 邮件服务通过 `EmailVerificationProvider` 接入，真实 API 未提供时明确显示不可用，不接受任意验证码伪造成功。

### 15.2 AI 配置

- 模型目录由服务端/Provider 能力返回，记录实际 provider/model；
- 思考强度分为快速、平衡、深度、极深，通过 Adapter 映射供应商推理预算参数；
- 模型和思考强度是两个独立字段，切换其中一个不能静默改变另一个；
- 不支持的模型/强度组合必须禁用、解释或显式降级。

### 15.3 支付与统一账本

首发可见套餐可以简单，但支付页面和底层账本都属于 P0：

- AI 输入/输出 token、模型和工具成本；
- 已用对象存储、历史版本、回收站占用；
- 下载/外链流量；
- 套餐权益、免费额度和超额阻断；
- 幂等 Usage Event，避免重试重复扣费；
- 生成前估算、生成后结算；
- 退款、失败任务和撤销需要可审计。

支付供应商应放在 Entitlement 外层，不允许业务代码直接散落判断某支付平台的产品 ID。通过 `PaymentProvider` 抽象商品、订单创建、跳转/二维码、状态查询、Webhook 验签和权益发放；真实 API 未提供时只展示 P0 UI 和“服务待接入”状态，不创建虚假订单、扣款或到账。

## 16. 开工前准备清单

### 16.1 已完成

- [x] 在 `AGENT.md` 固化 webOS 产品方向与阶段边界；
- [x] 输出本架构与目录规划；
- [x] 输出并验证 3 个差异化可点击方向原型；
- [x] 用户选择方向 A 为首版默认且唯一主题；
- [x] 输出 [P0 功能清单](webos-p0-feature-list.md)；
- [x] 将方向 A 更新为游客、余额、支付、AI 配置、默认应用和版本闭环的 P0 静态全景。

### 16.2 P0 范围确认后、写生产代码前

1. 建立 ADR：同仓新 Shell、iframe 隔离、版本不可变、游客身份、计费账本和对象存储抽象；
2. 定稿 `AppManifestV1` JSON Schema；
3. 定稿 Runtime RPC、P0 单一 Capability 和错误码；
4. 定稿 Guest、EmailVerificationProvider、AI Provider/模型目录/思考映射、PaymentProvider 与 Usage Ledger 契约；
5. 做三个独立技术 Spike：
   - opaque-origin iframe + MessageChannel；
   - 单 HTML/ZIP 解包与安全校验；
   - iOS PWA 安装、键盘、游客会话和恢复；
6. 建立威胁模型：恶意 App、恶意包、Agent 越权、游客凭据、支付回调、路径穿越和存储滥用；
7. 决定对象存储供应商，但先通过统一接口接本地实现；
8. 用户提供或选择真实 AI、邮箱验证码和支付 API 后，再接入对应 Provider；
9. 创建 `client/shell-web/` 和共享包，并把契约测试接入 CI。

### 16.3 仍需产品/API 确认

- 免费游客余额的金额、有效期、刷新规则与游客存储上限；
- 首批真实模型、Provider、价格单位，以及四档思考强度的映射；
- 邮件验证码服务商、模板、发送频控与账户冲突规则；
- 支付供应商、币种、充值包/套餐、退款和 Webhook 契约；
- AI 每次修改 App 是否都显式确认，或无新增权限的小改可自动安装；
- 正式产品名、品牌资产和法律/隐私文本。

## 17. 分阶段路线

### Phase 0：方向与 P0 范围确认（当前）

- 方向 A 已选，B/C 留作后续可选主题参考；
- A 原型展示游客、余额、支付、AI 配置、默认应用、生成授权和版本运行态；
- 本阶段不接后端、不创建生产 Shell；
- 用户确认 P0 功能清单后才进入 Phase 1。

### Phase 1：共享契约与安全 Spike

- Manifest、RPC、P0 Permission、Guest、AI Config、Billing 契约；
- iframe Runtime 技术验证；
- ZIP Validator；
- Threat Model 与 ADR。

### Phase 2：PWA Shell、游客与系统应用骨架

- 游客启动、AI 首页、传统桌面、全屏 App 导航；
- Daily AI、系统桌面、文件管理器、系统设置四个默认应用；
- 邮箱验证码绑定 UI、模型选择、思考强度、余额和支付 UI；
- Service Worker、安装、离线壳、更新提示和性能降级。

### Phase 3：静态 App Runtime

- AI 生成包的安装、启动和 App 私有存储；
- SDK 与 P0 Permission Broker；
- Crash UI、恢复和审计。

### Phase 4：AI 生成/修改与版本闭环

- Source Workspace、生成进度、用量预估与结算；
- 预览、Diff 和权限确认；
- 新版本、原子切换和回滚。

### Phase 5：真实 Provider 与同步接入

- 根据用户提供的 API 接入 AI 模型与四档思考映射；
- 接入邮箱验证码和游客资产迁移；
- 接入支付、Webhook、权益发放与统一 Usage Ledger；
- 对象存储、配额与跨设备同步。

### Phase 6：P1 文件权限与私有 Library

- 资源级文件授权；
- 本地单 HTML/静态 ZIP 导入、校验、预览与安装；
- 私有 App Library、搜索、分组、导出与分享；
- 最近任务卡片和更完整生命周期。

### Phase 7：商店、主题与桌面形态（后续）

- 公共商店、审核、撤回和更新；
- B/C 可选主题与更多内置 App；
- 桌面 Shell 共享 Runtime、SDK、权限和数据；
- Canvas 作为内置 App 接入。

## 18. MVP 验收标准

MVP 完成时，一名首次访问的用户应能在手机浏览器/PWA 中：

1. 无需登录，自动获得游客身份和免费余额并进入 AI 首页；
2. 独立选择 AI 模型和快速/平衡/深度/极深思考强度；
3. 用文字输入“给我做一个旅行清单 App”，并看到模型、费用预估和余额；
4. 看到生成进度、`app.storage.private` 权限摘要和沙箱预览；
5. 确认后在传统图标桌面看到并全屏打开新 App；
6. 创建数据，刷新或离线重开后数据仍存在；
7. 让 AI 基于当前版本修改，产生不可变新版本并可回滚；
8. 打开默认的 Daily AI、系统桌面、文件管理器和系统设置；
9. 在设置中看到余额、用量、支付页以及模型/思考强度两个独立配置；
10. 通过邮箱验证码绑定账户并安全迁移游客资产（真实邮件 API 接入后验收）；
11. 通过真实支付 Provider 完成订单和权益到账（API 未接入时必须明确显示服务待接入，不伪造成功）；
12. 在离线时仍能打开 Shell 和已缓存静态 App 的基础界面。

P0 不要求第三方 App 文件/网络权限、产品锁屏、多任务卡片、语音或公共商店。

## 19. 主要风险与缓解

| 风险 | 缓解 |
|---|---|
| 用户上传恶意 HTML | opaque-origin sandbox、CSP、SDK 白名单、包扫描 |
| Agent 越权操作 | Permission Broker、资源 selector、审计、危险操作二次确认 |
| iframe 内存失控 | 生命周期、挂起、快照、资源预算、终止策略 |
| AI 修改破坏 App | 不可变版本、预览、原子切换、回滚 |
| PWA 在 iOS 能力不一致 | 能力检测、降级路径、真机测试矩阵 |
| 毛玻璃和动画掉帧 | 性能档位、reduced motion、减少 backdrop-filter 面积 |
| 公共商店供应链风险 | 延后开放、人工精选、签名、扫描、撤回 |
| 云成本不可控 | Usage Ledger、配额、生成前估算、限流 |
| 服务型项目与静态 App 混淆 | Manifest 类型边界；容器托管独立产品阶段 |

---

方向 A 已被选为首版基线。下一步是在用户确认 [P0 功能清单](webos-p0-feature-list.md) 后，把其交互语言固化为 Shell Design System，并将 Phase 1 拆成可独立提交、可回滚的实施任务；在此之前不创建生产 Shell。