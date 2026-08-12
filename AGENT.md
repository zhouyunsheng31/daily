# Daily / webOS

## 主产品方向（2026-07-30 决策）

Daily 正从“可持久化的个人生活管理面板”演进为一个**移动端优先、AI-native 的网页操作系统（webOS）**。旧 Dashboard 不再承载新 Shell；无限画布未来作为系统内置 App 存续。

核心产品形态：

- **AI 助手即系统主页**：首次打开自动进入游客身份并直达 AI 助手页，以简洁、灵动的对话气泡承载纯文字交互；首版不包含 ASR、TTS 或其他语音能力。
- **游客优先账户**：登录不是使用门槛；系统自动分配游客身份与免费余额，邮箱验证码登录只用于绑定、同步和游客资产迁移。
- **余额与支付**：余额、用量预估和支付页面属于 P0；真实支付 API 接入前只提供 UI、订单状态设计与供应商抽象，不伪造扣款成功。
- **独立 AI 控制**：模型选择与四档思考强度（快速/平衡/深度/极深）是两个独立 P0 配置，通过 Provider Adapter 映射真实 API 参数。
- **HTML App 运行时**：系统中的 App 以版本化 HTML 包为主要形态，在 sandbox iframe 中运行，通过受控 SDK 与系统交互。
- **AI 生成与修改 App**：上传、商店安装之外，AI 生成是最主要的 App 创建路径；每次修改产生不可变的新版本，支持回滚。
- **权限中介**：App 和 Agent 不直接获得系统能力；最终授权是“平台安全策略 ∩ 用户授权 ∩ Agent 工具权限 ∩ App 能力声明”。
- **文件工作区**：提供面向用户和 Agent 的虚拟文件系统，授权可细化到本次/会话/永久、指定目录、只读/写入/删除/执行。
- **应用分发**：支持本地上传、AI 生成、应用商店安装，后续支持社区发布、审核、版本更新与撤回。
- **PWA 优先**：先交付移动端 Web 版本，目标是可安装、离线壳可用、接近原生 App 的启动与任务切换体验；桌面 Shell 后续共享运行时能力。
- **商业模式**：围绕 AI 用量、云存储和套餐权益计费；计费不能绕过权限、版本和用量审计。若后续托管 OpenWebUI、SillyTavern 等服务型项目，还必须单独核算 CPU、内存、运行时长和流量，不能只按空间收费。

### 架构策略与边界

采用**同仓并行新壳、逐步替换旧壳**，而不是新开完全独立仓库，也不把现有 `client/web/` 原地硬改成手机 OS：

- 新建 `client/shell-web/` 承载移动端优先的 PWA Shell；确认移动端模型后再扩展桌面形态。
- 新建 `shared/app-sdk/`、`shared/app-manifest/`、`shared/permission-model/` 等共享契约，Shell、运行时与服务端不得各自复制协议常量。
- 复用 `server/` 的 auth、pi agent、WS 事件流、工具调用、社区与上传基础设施，并以增量模块演进 App 包、版本、安装、权限、文件和计费能力。
- `client/web/` 与根目录 Electron 渲染端进入**维护模式**：原则上只修阻断问题，不继续叠加 webOS 交互；其无限画布最终收敛为内置 Canvas App。
- MVP 只支持**静态 HTML App 包**。外部 URL App 与长期运行的托管服务 App 暂不进入首版，避免过早引入网络代理、服务编排和更复杂的安全边界。
- HTML App 必须通过 `iframe sandbox` + `MessageChannel` + Permission Broker 使用宿主能力；禁止把鉴权令牌、对象存储密钥、文件系统句柄或任意宿主 DOM 能力直接暴露给 iframe。
- App Version 不可变；AI 修改、用户编辑或商店升级都创建新版本，安装实例只切换版本指针，并保留来源与审计链。
- AI 可以即时生成 App 和受控主题包，但不得直接改写运行中的 Shell 源码；Shell 个性化必须走校验过的 design tokens、壁纸、模糊和动画配置，并保留安全主题回退。

### 当前阶段约束（2026-07-31 状态更新）

当前处于**方向 A 已选定、P0 Shell 已实现、DeepSeek Provider 已接通并完成核心回归，进入收尾与后续规划阶段**：

1. 继续维护本规则、架构规划、P0 功能清单和回归记录。
2. `client/shell-web/` 已承载方向 A「安静智能」的生产级移动端优先 PWA Shell；后续新增功能必须优先复用共享契约和现有 `/webos/api/` 命名空间。
3. 现有 Legacy Dashboard、`client/web/` 和 Electron 渲染端继续维护模式；除阻断问题外，不把新的 webOS 交互继续叠加到旧壳。
4. 不得把 AI 生成结果直接写入运行中的 Shell 源码；App 只能通过版本化 HTML 包、校验、sandbox iframe、MessageChannel 和 Permission Broker 运行。
5. P0 之外的公共应用商店、社区分发、云容器编排、长期运行托管服务 App 和桌面 Shell 暂不提前实现。
6. 支付、邮箱验证码 Provider 尚未接入时，只能展示明确的 unavailable 状态；不得创建假订单、伪造验证码或伪造到账成功。
7. 方向 A 仍是首版唯一主题；B/C 仅保留为后续主题参考。
8. **`create_webos_app` 工具已删除（2026-08-14 用户决策）**：AI 创建 App 唯一路径 =「文件夹即 App」（`agent_fs_mkdir apps/<名称>/` + `agent_fs_write index.html`，系统自动注册+即时建版本）；REST `POST /webos/api/apps` 保留（日后可单独做「粘贴 HTML 生成 App」入口）。**中文文件夹名已支持**（`APP_ID_PATTERN` 放宽为 Unicode 字母/数字/空格/._:-，仍排除路径分隔符，`appFilesRoot` 另有 `includes('..')` 防穿越；trash 路由/公开素材端点同步 Unicode 化）；`tool_execution_end` 的 `drainPendingAppEvents` 提前到所有工具分支之前消费（文件夹方式 mkdir/write 的 app_created/app_updated 推送不丢失）。
## Android 端立项（2026-08-15 用户拍板，进入执行准备）

Daily 正式立项 Android 原生端（后续鸿蒙/iOS），产品定位 **「你的第二个桌面——更轻量，也更个性化」**。**执行规范文档集 = `docs/android/`（README + 12 分篇），无上下文的 AI 接手时从 `docs/android/README.md` 读起**；调研推导存档 = `docs/android-app-plan.md`（含 Operit/RikkaHub/pi 源码考察）。

已拍板决策（D1–D14，详见 docs/android/README.md §2）摘要：

1. **路线 C**：Kotlin + Jetpack Compose 原生 Shell + WebView 沙箱跑 HTML App + 服务端 pi 内核不变；否决 Capacitor 套壳与 Flutter/RN。工程根 `client/android/`（多模块）。
2. **一切皆包**：app/pet-layer/api/skill/theme/toolpkg/mcp/workflow/model-pack/url-app 统一流水线（不可变版本+回滚+审计+权限四交集）；**App API 体系为高优先级**（api.json 声明 → 服务端 vm 沙箱代理 + pi 动态工具 + 文档页 + API 包市场；解决"AI 不知道 App 内数据"与"双端异构 UI 数据互通"）。
3. **外部接入**：外部 API 经 api 包服务端代理（域名白名单 + secrets 托管）；外部网页做 url-app（端侧 WebView 直连 live 模式 / 服务端 snapshot 模式，存储分区隔离）。
4. **联机**：服务器中继房间（channel 原语 `sdk.channel`）先行，WebRTC P2P 后置。
5. **权限两档**：Tier0 标准模式（悬浮窗+无障碍+MediaProjection+proot 全免 root）/ Tier1 Shizuku 增强；capability matrix 上报 bootstrap，工具多实现优雅降级，不满足只报 unavailable。
6. **TTS/ASR/本地模型预留位**：Media Provider 抽象 + billing catalog kind 扩展（tts/asr/room/api）+ M1 先做系统 ASR 输入；不实现语音对话。
7. **文件服务重构**（借 Android 做外科手术，不推倒重来）：统一 File Service（DB 元数据 files 表 + blob，路径语义不变）+ 分块上传/断点续传 + 移动端双向同步（LWW+conflict 副本）+ 云/本地备份（恢复走版本指针）；**webos.ts（409KB 单体）冻结——新端点一律进 `server/src/webos/` 新模块，触及即瘦身**。
8. **渲染分级红线**：Shell 纯 Compose 零 WebView；App 界面 WebView（预热池≤2）；桌宠=单共享 overlay WebView 单 canvas（10 桌宠≠10 WebView）；3D 后置 Filament/Live2D。**性能预算写入 M1 验收**：冷启动<1s、60/120fps、10 桌宠稳 60fps、APK 基座<40MB。
9. **HTML-in-Canvas（2026 WICG 提案）只观察不集成**；首发渠道官网直发+F-Droid，Play 裁剪版后置。
10. 图标设计 brief 在 docs/android/10-ui-design.md §4（生图 prompt 已备好，站长账号执行）。

路线图：M0 技术验证（⚠️WebView 沙箱跑通现有 App 契约 = 最大不确定性）→ M1 MVP（四大页面/权限 Tier0/文件服务一阶段/性能达标）→ M2（包体系+App API+url-app+房间+Shizuku+proot+TTS）→ M3（生态+鸿蒙/iOS 立项）。任务分解与验收标准见 docs/android/12-roadmap.md。**注意：工作区无现成 Android 工具链**——动手第一步是 docs/android/13-dev-toolchain.md（Windows 开发机装 Android Studio/SDK/JDK17、applicationId=`xyz.shadowshub.daily`、多模块脚手架、签名与 CI 骨架，附验收清单）。

## webOS 后端端点快速索引

新 Shell 使用独立的 `/webos/api/` 命名空间，避免修改 Legacy Dashboard 的 `/api/` 路由和既有 WS 协议。所有端点（除 `/api/auth/guest` 游客发放和既有登录端点）都继承现有 JWT `authMiddleware`，前端必须使用 `credentials: 'include'`。

| 端点 | 用途 | 状态 |
|---|---|---|
| `GET /api/auth/guest` | 发放游客 JWT（已有端点） | 可用 |
| `GET /webos/api/bootstrap` | Shell 启动、游客余额、AI 配置、默认应用、支付/邮箱状态 | P0 |
| `PUT /webos/api/ai/config` | 独立保存 `flash` 模型与 `low/medium/high/max` 思考档 | P0 |
| `GET /webos/api/usage` | 余额与用量摘要 | P0 占位 |
| `POST /webos/api/chat/stream` | pi agent 会话（pi-coding-agent + DeepSeek V4 Flash）SSE 流式对话 | P0；服务端读取 `DEEPSEEK_API_KEY` |
| `GET/POST /webos/api/apps` | App 列表与静态 HTML App 创建 | P0 |
| `POST /webos/api/apps/generate` | AI 生成静态 HTML App | P0 |
| `GET /webos/api/apps/:appId` | App 及不可变版本详情 | P0 |
| `POST /webos/api/apps/:appId/install` | 安装并切换 active version | P0 |
| `POST /webos/api/apps/:appId/versions` | 创建新不可变版本 | P0 |
| `PUT /webos/api/apps/:appId/active-version` | 原子切换版本指针 | P0 |
| `POST /webos/api/apps/:appId/rollback` | 回滚到指定版本 | P0 |
| `GET/PUT/DELETE /webos/api/apps/:appId/storage/:key` | `app.storage.private` 私有数据 | P0 |
| `GET /webos/api/payment/products` | 套餐展示 | Provider 未接入 |
| `POST /webos/api/payment/orders` | 创建订单 | 明确返回 `503 PAYMENT_UNAVAILABLE`，不伪造成功 |
| `GET /webos/api/email` | 邮箱绑定状态 | P0 |
| `POST /webos/api/email/send-code` | 请求验证码 | 旧绑定语义端点；**登录/注册请用 `/api/auth/email/*`**，本端点仍返回 503 |
| `POST /webos/api/email/verify` | 验证并迁移游客资产 | 旧绑定语义端点；**登录/注册请用 `/api/auth/email/*`**，本端点仍返回 503 |
| `POST /api/auth/email/send-code` | 邮箱验证码发送（免鉴权；注册/重置密码时验证邮箱归属） | P0（2026-08-02，Resend） |
| `POST /api/auth/email/register` | 注册：验证码验证邮箱 + 设置密码 + 创建账号 + 自动登录（免鉴权） | P0（2026-08-02） |
| `POST /api/auth/email/login` | 密码登录（免鉴权，无需验证码；游客身份自动迁移资产） | P0（2026-08-02） |
| `POST /api/auth/email/reset-password` | 忘记密码：验证码验证邮箱后重置密码并登录（免鉴权） | P0（2026-08-02） |
| `GET /api/admin/webos/chat-logs?userKey=&conversationId=&page=&limit=` | **对话记录查询**（管理端，requireAdmin；2026-08-11） | 上线 |
| `GET /api/admin/webos/sessions?userKey=&conversationId=&limit=` | **统一对话 log 查询**（管理端；2026-08-13）——一次 chat/stream 请求一行，events JSON 含**完整事件序列（user 消息 + AI 思考 reasoning + 文字 + 工具调用 + App 事件）** | 上线 |
| `GET /api/admin/webos/trace?userKey=&conversationId=&appId=&hours=` | **自动整合诊断**（管理端；2026-08-13）——把①统一对话 log（含 reasoning）②工作区 execution.log（AI 工具调用轨迹）③App 版本历史 合并为一条时间线，查「AI 干了什么/怎么想的/来回折腾几次」一条命令看全 | 上线 |

> **查 bug 必须查对话记录（2026-08-11 用户决策；2026-08-13 升级）**：排查用户反馈的 AI 对话问题（消息重复发送/扣费异常/回复丢失/上下文错乱等），**第一步必须先查对话记录看完整内容**，不要只凭用量统计数字和 pm2 日志猜。三个层级：
> 1. **快速浏览**：`webos_chat_logs` 表 / `GET /api/admin/webos/chat-logs?userKey=user:<id>`——user/assistant 纯文本（2026-08-11 起）。
> 2. **完整过程（含 AI 思考 reasoning）**：`webos_chat_sessions` 表 / `GET /api/admin/webos/sessions?userKey=user:<id>&conversationId=`——一次请求一行，`events` JSON 含 user 消息 + thinking_delta（AI 思考全文）+ delta（输出）+ 工具调用 + App 事件 + 状态。**reasoning 内容只在此表**（chat_logs 只存纯文本）。
> 3. **自动整合时间线**：`GET /api/admin/webos/trace?userKey=user:<id>&appId=&hours=`——把对话事件 + 工作区 execution.log（工具调用轨迹，含参数摘要与成败）+ App 版本历史（谁在何时建了哪个版本）合并排序，一条命令还原「AI 当时怎么想的、干了什么、为什么没生效」。
> 查询示例：`GET /api/admin/webos/trace?userKey=user:fb9f2d90-a79c-4ab4-af3e-c3b13fb668d6&appId=app-ffba5f82-df55-472a-8733-1605733a584b&hours=12`。

> **用户级 skills/记忆隔离（2026-08-11 修复）**：此前所有用户（含游客）共享全局 `.pi/skills-webos/`（myself 记忆互串 + 站长画像泄露给所有游客）。修复：① 用户级 skills 放各自工作区 `skills/`（首次创建时从全局模板复制干净版）；② 全局 `.pi/skills-webos/` 只保留系统级只读 skill（design 等），myself 模板已清空 references；③ `createWebosSession` 的 `skillsDir = [用户级, 全局]`，缓存 key 含 scope（不同用户不共享 resourceLoader）；④ `read` 工具支持 `skills/...`（用户级）；`manage_skill` 只写用户级，系统级只读保护；⑤ 线上 145 个存量工作区已迁移（站长画像保留在其工作区副本，146 个非站长工作区 references 已清空）。验证：游客 A 写入「我叫张三」→ A 工作区 user-profile.md 有记录，游客 B/C 工作区无记录、AI 明确回答「不知道你的名字」。

> **✅ 已修复：消息重复发送（2026-08-11 根因定位并修复）**：现象是用户（站长，魅族 Lucky 08 WebView）发一条消息，服务端收到**两条完全相同的 chat/stream 请求**（两个不同 requestId，第二条在第一条 done 后约 122ms 到达，`n=1` 无历史、`SAME dup=no`、`disconnected=false`），AI 回复两次、token 双倍。**根因（确定性结构性 bug，非竞态/IME/WebView 特有）**：前端 `runConversationTurn` 的断流重试循环（2026-08-06 引入）**成功路径缺少 `break`**——`streamChat` 正常返回后循环直接进入 attempt=1，用闭包捕获的同一份 `sendMessages` 把同一个请求原样重发一次（n=1 无历史 = 闭包原始消息列表，故第二条不可能来自 submit/IME 重放）。因此**自 2026-08-06 起每条消息都被确定性处理两次、双倍扣积分**。**修复（2026-08-11 落地，详见 `docs/bug-duplicate-chat-request.md` §9）**：① 主修复——成功路径加 `break`；② 服务端防御——新增 `recentChatDone`，done/bg-finished（仅成功）后 5s 窗口内同会话同 thinking 同内容重复请求 → `409 CHAT_DUPLICATE_RECENT`（rebuild 豁免）；③ `streamChat` 透传服务端 error.code；④ 前端 409 优雅处理（撤销乐观消息 + INFLIGHT 恢复后台任务）；⑤ `sendMessage` 入口诊断日志（来源/convId/消息数/streaming 状态）。验证：server/shell-web tsc、vite build 通过；单元模拟修复前稳定 2 次请求、修复后恰好 1 次、断流重试兜底未破坏。**待部署后观察**：pm2 不再出现 `chat done sent` 后紧跟同内容 `chat req ... SAME`；`webos_chat_logs` 不再出现同 conv 同内容双 request_id；评估 08-06 至修复上线期间受影响用户的双倍扣费补偿。排查全程记录见 `docs/bug-duplicate-chat-request.md`（2026-08-11）。

### webOS Provider 环境变量

- `DEEPSEEK_API_KEY` 仅在服务端读取，禁止放入 `VITE_*`、Shell bundle、日志、原型或 Git。
- `DEEPSEEK_MODEL` 可选；pi 内置 provider 名/模型名，默认 `deepseek/deepseek-v4-flash`（DeepSeek V4 Flash，官方思考深度四档 `low/medium/high/max`）。
- **思考深度不需要任何模型拆分配置**：webOS 的 UI 四档直接映射为 pi 的 thinkingLevel（low/medium/high/xhigh→max），由 pi 的 DeepSeek provider 发送 `reasoning_effort`；App 生成内部固定关闭思考（pi `off`）。已废弃 `DEEPSEEK_CHAT_MODEL` / `DEEPSEEK_REASONER_MODEL` / `DEEPSEEK_API_ENDPOINT`（旧自研直连时代的变量，禁止恢复）。
- 邮箱和支付 Provider 尚未接入时，接口只能返回明确 unavailable 状态，不能创建假订单或伪造到账。



现有系统是一个可持久化的个人生活管理面板，保留能力包括：

- **pi agent 驱动**：AI 是用户与画布交互的主要方式，通过 pi（`@earendil-works/pi-coding-agent`）提供 agent 能力，模型用 step-3.7-flash
- **自动保存**：所有组件状态（PDF页码、音乐播放进度、文本内容等）通过 IndexedDB 持久化，关闭浏览器后可恢复
- **HTML Widget**：agent 可自由生成任意 HTML 页面摆放到画布上（sandbox iframe 渲染）
- **30+ 个 AI 工具**：含 HTML widget 增删改查、storage 读写、浏览器工具、搜索工具、弹出层工具、ask_user 等，另含 7 个默认禁用的可选文件系统工具（spec §7）
- **多面板管理**：支持创建多个面板，每个面板有独立的组件布局
- **自由画布**：左键拖动平移画布，滚轮缩放，组件可自由拖拽和调整大小


## 技术栈

### 前端
- React 19 + TypeScript 6 + Vite 8
- Zustand 5（状态管理）
- Tailwind CSS v4
- IndexedDB（idb 持久化）
- pdfjs-dist / katex / lucide-react

### 后端（pi 桥接服务）
- Node.js + Express 5 + TypeScript（`server/` 目录）
- better-sqlite3（`data/daily.db`）
- **pi agent**（`@earendil-works/pi-coding-agent` + `@earendil-works/pi-ai`）— 提供 agent 能力
- **WebSocket**（`ws`）— 前后端双向通信，转发 pi 事件流 + 工具调用
- 后端不直接读写存储，大多数工具通过 WS 转发前端执行；7 个文件系统工具在服务端 pi 沙箱内运行（spec §7）

## 项目结构

```
src/                        # Electron 桌面端渲染进程（旧，仍保留）
client/
└── web/                    # Daily Web 端（React + Vite，Phase 6 当前主力）
    ├── src/
    │   ├── api/            # API client（panels/widgets/communities/...）
    │   ├── components/
    │   │   ├── settings/   # 设置页 section（AIApiConfig/CommunityDiscovery/...）
    │   │   ├── widgets/    # 画布组件（HtmlCanvasWidget）
    │   │   ├── Workspace.tsx
    │   │   └── ...
    │   ├── pages/          # Settings / Login / Admin
    │   ├── stores/         # Zustand stores（useAppStore/useAIStore/useUserStore/...）
    │   └── ...
    └── package.json
src/                        # 桌面端（Electron，与 web 共享部分代码）
├── api/                    # 后端 API 抽象层（adapter.ts 的 withFallback 支持 IndexedDB 回退）
├── components/
│   ├── widgets/            # 2 个内置组件类型（HtmlCanvasWidget + FreeHtmlComponent）+ 动态 widget 机制（custom_widgets 表 + 上传/社区分发）
│   ├── Workspace.tsx       # 画布（平移、缩放、组件渲染）
│   ├── WidgetContainer.tsx # 组件容器（右键菜单、拖拽、缩放）
│   ├── UnifiedToolbar.tsx  # 顶部工具栏（面板管理、模式切换）
│   ├── Minimap.tsx         # 小地图
│   ├── FloatingOrb.tsx     # 浮动球菜单
│   ├── AddWidgetMenu.tsx   # 添加组件 FAB 按钮
│   └── SettingsPanel.tsx   # 设置面板
├── hooks/                  # useDraggable, useResizable
├── registry/               # Widget 注册表（widgetDefinitions, builtIn）
├── stores/                 # Zustand store（useAppStore, useAIStore）
├── types/                  # TypeScript 类型定义
└── utils/
    ├── db.ts / dbV2.ts     # IndexedDB 封装
    ├── dbStores/           # 各类实体数据 store（含 htmlWidgets, kvStorage）
    ├── wsToolHandlers.ts   # WS 工具回调（HTML widget / storage / 浏览器 / 弹出层等工具的前端实现）
    └── ...
server/                     # Node.js 后端（pi 桥接服务，Web + 桌面共用）
└── src/
    ├── index.ts            # Express HTTP + WS 服务入口
    ├── piBridge.ts         # pi agent session + 30+ customTools（含 7 个文件系统工具）
    ├── ws.ts               # WebSocket 服务器
    ├── routes/             # REST API（auth/panels/widgets/communities/...）
    ├── officialCommunities.ts  # Phase 6 联邦社区官方清单（硬编码）
    ├── middleware/         # auth / error
    └── db/                 # schema.ts(PG) + schema-sqlite.ts + connection
docs/                       # 文档（见下方"开发者文档"索引）
```

## 开发者文档

Phase 6 起新增专门开发者文档，放在 `docs/` 下，面向二次开发/组件开发/部署：

| 文档 | 路径 | 内容 |
|---|---|---|
| 开发者指南（主入口） | [docs/developer-guide.md](docs/developer-guide.md) | 项目介绍 / 快速开始 / 项目结构 / 组件/API/部署/社区概览 |
| 组件开发规范 | [docs/component-spec.md](docs/component-spec.md) | 两类组件接口 / 沙箱约束 / 能力声明 / iframe widget vs 自由 HTML 组件 / 示例 |
| API 文档 | [docs/api-reference.md](docs/api-reference.md) | 认证 / 面板 / 组件上传 / 社区 / 工具设置 / WS 协议 |
| 部署指南 | [docs/deployment-guide.md](docs/deployment-guide.md) | Docker Compose / 环境变量 / PG/SQLite / Nginx / HTTPS/WSS |
| 端到端流程 | [docs/end-to-end-workflow.md](docs/end-to-end-workflow.md) | 本地开发组件 → 上传 → 画布摆放 → 社区发布 完整流程图 |

设计文档：[docs/superpowers/specs/2026-07-07-daily-web-design.md](docs/superpowers/specs/2026-07-07-daily-web-design.md)（§9 社区功能、§12 开发者文档）。

## 关键交互

- **左键拖动空白区域**：平移画布
- **滚轮**：缩放画布
- **左键拖动组件**：移动组件
- **右键组件**：弹出上下文菜单（最小化、关闭、编辑样式）
- **左下角浮动球**：面板管理 + 设置入口
- **右下角 + 按钮**：添加组件

## 开发命令

```bash
# 需要 Node.js，路径：D:\nodejs\node-v22.16.0-win-x64
$env:PATH = "D:\nodejs\node-v22.16.0-win-x64;" + $env:PATH

# 启动后端服务（终端 1）
cd f:\allmylife\event\server
npm run dev

# 启动 Electron 开发服务器（终端 2，前端 + 主进程）
cd f:\allmylife\event
npm run dev

# TypeScript 类型检查
npm run typecheck

# 构建 Electron 应用
npm run build

# 打包成 Windows exe
npm run build:win
```

## Git 流程

**git 路径**：`C:\Program Files\Git\cmd\git.exe`（用户机器上 git 不在 PATH，必须用绝对路径）。

**PowerShell 坑**：`cd <path> && "C:\...git.exe" status` 在 PowerShell 中会被解析为 `cd` 后的相对路径 + `&&` 触发命令执行错误。**改用 `cwd` 参数**：

```powershell
# 推荐：cwd 参数（RunCommand 工具用此方式）
& "C:\Program Files\Git\cmd\git.exe" status
# 并在工具调用时设置 cwd = "f:\allmylife\event"

# 或：先 cd 再调 git（但避免 && 链）
cd f:\allmylife\event
& "C:\Program Files\Git\cmd\git.exe" status
```

**提交前必做清单**（缺一不可）：

1. **类型检查**：`npx tsc --noEmit`（exit 0、零错误）
2. **构建检查**：`npx tsc -b && npx vite build`（exit 0、零警告）
3. **状态确认**：`git status --short`（看是否有未预期文件）
4. **凭证扫描**：`grep -rE "EMAIL|PASSWORD|Bearer|@qq\.com|chat\.st0722" .` 在要 add 的文件里（**绝不能**有明文凭证）
5. **ignore 验证**：`git check-ignore -v <可疑文件>`（确认 .gitignore 生效）

**提交规范**（conventional commits）：

```
<type>(<scope>): <subject>

<body>

<footer>
```

| type | 用途 |
|---|---|
| `feat` | 新功能 |
| `fix` | 修 bug |
| `chore` | 杂项（gitignore、依赖、脚本） |
| `docs` | 文档 |
| `refactor` | 重构（无功能变化） |
| `test` | 测试 |

subject ≤ 50 字符，body 用 `-` 列表。每行 ≤ 72 字符。

**危险操作禁令**：

- ❌ `git add -A` / `git add .`（会扫到凭证文件）→ **必须精确 add 文件名**
- ❌ `git push --force` / `git push --force-with-lease`
- ❌ `git reset --hard` / `git checkout .` / `git restore .`
- ❌ 任何修改已 commit 历史的操作（`rebase`、`filter-branch`、`commit --amend` 已 push 的 commit）
- ❌ 把含明文凭证的文件加入仓库（用 `git rm --cached` 也不行——只能重写历史才能彻底清除）

**已保护的凭证模式**（`.gitignore` 已配置，**不要主动取消**）：

- `review.mjs`
- `**/chatst*.{cjs,js,ts}`
- `**/send_review.{cjs,py}`

**典型提交流程**：

```powershell
# 1. 验证
$env:PATH = "D:\nodejs\node-v22.16.0-win-x64;" + $env:PATH
cd f:\allmylife\event
npx tsc --noEmit

# 2. 查看
& "C:\Program Files\Git\cmd\git.exe" status --short

# 3. 精确 add
& "C:\Program Files\Git\cmd\git.exe" add <file1> <file2> ...

# 4. 复核 staged
& "C:\Program Files\Git\cmd\git.exe" diff --cached --stat

# 5. 提交
& "C:\Program Files\Git\cmd\git.exe" commit -m "feat(scope): subject" -m "body line 1" -m "body line 2"
```

**项目当前路线图说明**：每完成一个 Phase 都要 commit。**禁止把多 Phase 混在一个 commit**——一旦需要回滚会带垮别的 Phase。

## pi Agent 集成

项目通过 pi（`@earendil-works/pi-coding-agent`）提供 agent 能力，替代旧版自研 LLM 后端。

### 架构

- **后端**（`server/src/piBridge.ts`）：创建 pi agent session，注册 30+ 个 customTools（含 7 个默认禁用的文件系统工具），大多数通过 WS 转发工具调用到前端执行，文件系统工具在服务端 pi 沙箱内运行（spec §7）
- **前端**（`src/stores/useAIStore.ts`）：WS 客户端，订阅 pi 事件流（text_delta / tool_call / tool_result / agent_end）驱动 UI
- **存储统一**：大多数工具通过 WS 转发前端执行，前端用 `adapter.ts` 的 `withFallback()` 访问数据（自动协调 IndexedDB/API），后端不直接读写存储；文件系统工具例外，在服务端 pi 沙箱内运行

### AI 工具概览（pi defineTool，30+ 个）

工具分多类（详见 `server/src/piBridge.ts` 的 `customTools` 数组）：

- **HTML Widget 工具**：`create_html_widget` / `update_html_widget` / `delete_html_widget` / `list_widgets` / `set_widget_mini_html` / `set_widget_icon_html`（决策38/39）
- **背景层 + 弹出层工具**（spec §3.2/§3.3）：`set_background` / `upload_background_image` / `add_effect` / `place_basic_component` / `show_popup` / `dismiss_popup`
- **Storage 工具**：`storage_read` / `storage_write`（前端 `adapter.ts` 的 `withFallback()`）
- **浏览器工具**（操作当前活跃的网页组件）：`browser_eval` / `browser_get_dom` / `browser_click` / `browser_input` / `browser_scroll` / `browser_wait_for` / `browser_screenshot` / `browser_navigate` / `browser_get_url` / `browser_get_title` / `browser_back` / `browser_forward` / `browser_reload` / `browser_get_cookie` / `browser_set_cookie` / `browser_open` / `browser_switch_tab` / `browser_list_tabs`
- **用户互动**：`ask_user`（Phase 8 批次5 模块D：AI 主动向用户提问，系统工具不可禁用）
- **搜索工具**（Phase S9）：`local_search`（路由到客户端）+ `web_search` / `academic_search` / `github_search`（直接调外部 API）
- **系统工具**：`query_capabilities`（查询组件能力声明，不可禁用）
- **文件系统工具**（Phase 3，spec §7）：7 个 PI 原生工具，在服务端沙箱内运行，默认禁用，需用户手动开启

#### 工具启用过滤（Phase S4，spec 9.3.4 节）

`getEnabledCustomTools()` 从 `tool_settings` 表读取用户配置：
- 系统工具（`canDisable=false`）永远启用
- 其他工具：表中有记录用表中值，否则用 `defaultEnabled`（30 个工具默认启用，7 个文件系统工具默认禁用）

### pi 前置条件（Windows）

- **git-bash 路径**：`C:\Program Files\Git\bin\bash.exe`（pi 在 Windows 需要 bash，**禁止用 WSL bash**）
- **pi 依赖**：`@earendil-works/pi-coding-agent` + `@earendil-works/pi-ai`（装在 `server/`）
- **模型**：step-3.7-flash（custom provider 直连 api.stepfun.com）
- **配置**：`~/.pi/agent/models.json` 注册自定义 provider

### WS 协议

```typescript
// 后端 → 前端（工具调用请求）
{ kind: 'tool_call', requestId, tool, params }

// 前端 → 后端（工具调用响应）
{ kind: 'tool_result', requestId, success, data?, error? }

// 后端 → 前端（pi 事件流转发）
{ kind: 'pi_event', event: 'text_delta'|'tool_call_start'|'tool_call_end'|'agent_end', data }
```

- 超时：30s，超时返回 `{success: false, error: 'timeout'}`
- 并发：每个工具调用独立 requestId，支持并发

## 开发路线图

项目当前执行 **v3 路线图**（`docs/roadmap_v3.md`）：

- 9 条设计原则（AI 为主方向）
- 5 章用户手册
- 精简改造方案见 `docs/specs/event-simplification-v3.md`（pi agent + 无限画布 + HTML widget）

> v1/v2 路线图已删除，仅保留 v3。

## 已知注意事项

- **右键菜单**：必须用 `createPortal` 渲染到 `document.body`，因为 `canvas-container` 的 `transform` 会使 `position: fixed` 失效
- **渐变背景**：workspace 需添加 `custom-bg` 类使背景透明，否则会覆盖 app-root 的渐变
- **拖拽抖动**：useDraggable/useResizable 中必须用 `useRef` 存储最新回调，避免 stale closure
- **组件注册**：新组件需同时在 `builtIn.ts`、`WidgetContainer.tsx`、`AddWidgetMenu.tsx` 三处注册

## 排查经验：视觉偏移类问题

### 案例：刷新后小窗偏移 + 缩放中心偏移

**现象**：刷新页面后，Minimap 视口矩形与实际视角严重偏移；滚轮缩放中心不在鼠标指针处，而是在上方。

**根因**：`.panel-layer` 缺少 `overflow: hidden`，隐藏面板的溢出内容撑大了父容器 `wsArea` 的 `scrollHeight`，浏览器自动设置 `scrollTop=1555`，导致所有基于 `getBoundingClientRect` 的坐标计算偏移。

**排查思路**：

1. **先实测 DOM 状态，不要纯靠代码推理**——遇到"偏移"问题，第一时间在浏览器控制台检查 `scrollTop`、`scrollHeight`、`getBoundingClientRect()` 等实际值，而不是反复读代码猜测
2. **CSS 布局问题纯看代码很难发现**——`overflow` 缺失导致的 `scrollTop` 偏移，代码逻辑完全正确但运行时状态已被 CSS 副作用污染
3. **不要思维惯性**——用户报告"偏移"不一定是数据/状态问题，也可能是 CSS 布局引起的 DOM 状态异常
4. **隐藏元素也会影响布局**——`display:none` 的子元素不影响，但 `visibility:hidden` 或仅用 `z-index` 隐藏的元素如果溢出父容器，仍会撑大 `scrollHeight`

**修复要点**：

- `panel-layer` 添加 `overflow: hidden`（根本修复）
- 所有坐标计算（Minimap 视口、缩放中心、点击跳转）加入 `scrollTop`/`scrollLeft` 补偿（防御性修复）
- `computeMapping` 的边界计算必须包含当前视口范围，否则视口矩形可能超出 minimap 可见区域

**涉及文件**：`src/index.css`、`src/components/Minimap.tsx`、`src/components/Workspace.tsx`

### 案例：刷新后视角位置丢失

**现象**：刷新页面后画布视角被重置，未恢复到刷新前位置。

**排查思路**：

1. `beforeunload` 中异步请求（`panelsApi.updatePanel`）会被浏览器取消 → 改用 `fetch + keepalive: true`
2. 异步仍不可靠 → 增加 `sessionStorage` 作为同步缓存层，初始化时优先读取
3. `setCanvasTransform` 只更新顶层状态，不同步 `panels` 数组 → 初始化时用 sessionStorage 值覆盖 activePanel 的 canvasTransform
4. 初始化后增加校验步骤，确保最终状态与 sessionStorage 一致

**涉及文件**：`src/App.tsx`、`src/stores/useAppStore.ts`

### 案例：修复了不存在的组件——8轮对抗审查全漏

**现象**：用户报告"无法给面板重命名"。搜索代码发现 `Sidebar.tsx` 有重命名逻辑，于是围绕它修复了24项问题，经过8轮对抗审查全部通过。但用户反馈"重命名按钮根本不存在"——启动浏览器验证后发现 `Sidebar` 组件从未被引入到页面，面板列表实际在 `UnifiedToolbar.tsx` 的 popover 中。

**根因**：对抗审查只审查了代码逻辑的正确性，没有验证最基本的前提——**被修改的组件是否真的渲染在页面上**。

**教训**：

1. **对抗审查必须包含运行时验证**——代码写得再完美，如果组件没被挂载到页面，等于零。审查第一步就应该确认修改的组件是否在渲染树中
2. **搜索到相关代码 ≠ 找到了问题所在**——`Sidebar.tsx` 确实有重命名代码，但它不是用户看到的界面。必须通过 `import` 链或浏览器 DOM 验证，确认代码与用户界面的对应关系
3. **审查维度不能只有代码质量**——8轮审查覆盖了竞态、IME、CSS、可访问性，却漏掉了"组件是否被使用"这个最基本的问题。审查清单应包含：① 组件是否被引入 ② 组件是否在渲染树中 ③ 修改是否对用户可见

**涉及文件**：`src/components/UnifiedToolbar.tsx`（实际使用的面板菜单）、`src/components/Sidebar.tsx`（未使用的遗留组件，已在 Phase 1 删除）

### 通用原则

- **遇到偏移，先查 scrollTop/scrollLeft**——这是最常见却被最易忽略的原因
- **beforeunload 中不能依赖异步操作**——用同步 API（sessionStorage）+ `fetch keepalive` 组合
- **React hooks 顺序必须一致**——条件返回前的 hooks 不能放在条件返回之后


---

## AI 助手配置

### pi Agent 配置（stepfun）

- **Endpoint**: `https://api.stepfun.com/step_plan/v1/chat/completions`
- **Model**: `step-3.7-flash`
- **Provider**: pi custom provider（通过 `~/.pi/agent/models.json` 注册，服务端配置）
- **API Key**: 通过环境变量 `VITE_STEPFUN_API_KEY` 提供，不持久化到浏览器

### 架构说明

- AI 能力由后端 pi agent 提供（`server/src/piBridge.ts`），前端不再自研 LLM 调用逻辑
- 前端 `useAIStore` 是 WS 客户端，订阅 pi 事件流驱动 UI
- 30+ 个工具中大多数通过 WS 转发前端执行，后端不直接读写存储；7 个文件系统工具在服务端 pi 沙箱内运行（spec §7）

### AI 助手核心行为准则

1. **不随便创建新面板**——除非用户明确说"创建新面板"，否则在当前面板操作
2. **主动创建 HTML widget**——用户给待办/日程/笔记等信息时，用 `create_html_widget` 生成对应 HTML 组件
3. **存储读写用 storage_read/write**——通过 `storage_read` / `storage_write` 工具读写 KV 数据
4. **旧数据可读**——agent 可通过 `storage_read` 读旧 IndexedDB 表（前端 `adapter.ts` 的 `withFallback()` 自动协调）


---

### Playwright 线上验证手册（2026-08-07 沉淀，可复用）
> 场景：需要「真实浏览器」验证线上 Daily webOS 行为时（长按菜单/图片加载/桌面刷新/SSE 流式/
> 商店/App 运行），用项目自带 Playwright 替代不可用的 browser MCP 封装。以下为完整操作法。

**1. 环境准备（Ubuntu/Android 沙箱终端）**
```bash
cd /data/user/0/com.ai.assistance.operit/files/workspace/daily/daily
npx playwright install chromium          # 下载浏览器二进制（~150MB）
npx playwright install-deps chromium     # 装系统库（libnspr4/libnss3/xvfb 等）
```
启动参数：`chromium.launch({ headless: true, args: ['--no-sandbox'] })`；
移动端视口：`newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true })`。

**2. 身份注入（关键）**：`localStorage.setItem('daily-webos-device-id', X)` + reload **不会切换游客**
（cookie 已存在时前端不重新建游客，实测身份仍是随机 UUID）。必须**直接注入 cookie**：
```js
const { token } = await (await fetch('https://shadowshub.xyz/api/auth/guest', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ deviceId: 'my-test-id' }),
})).json();
await context.addCookies([{ name: 'access_token', value: token, domain: 'shadowshub.xyz', path: '/' }]);
```

**3. 页面操作模板**
- 关公告：`[...document.querySelectorAll('button')].find(b => b.textContent.includes('不再显示'))?.click()`
- 进桌面：`[...document.querySelectorAll('button')].find(b => b.textContent.includes('桌面'))?.click()`
- 发消息：`textarea.fill(text)` + 点 `aria-label` 含「发送」的按钮（`press('Enter')` 不可靠）
- 找桌面 iframe：遍历 `page.frames()` 找 `.app` 数量 > 0 的 frame（桌面是 about:srcdoc）
- 模拟长按（pointer 事件）：iframe 内 `el.dispatchEvent(new PointerEvent('pointerdown', {bubbles:true, clientX, clientY}))`
  → 等 700ms → `pointerup`；测位移用中间发一次 `pointermove(clientX+4)`（验证阈值修复时用）

**4. 网络/资源诊断**
- 捕获请求头与响应：`page.on('request'/'response'/'requestfailed')` 里按 URL 过滤，
  检查 `r.headers()['cookie']`（沙箱 iframe 内 img 请求 cookie=NONE = SameSite 第三方上下文问题）
- 图片是否真加载：iframe 内 `img.naturalWidth > 0`（0 = 404/401/ORB 失败）；配合 nginx access log
  `/var/log/nginx/access.log` 看实际 HTTP 状态（含 referer/UA 区分来源）

**5. 已验证的关键结论（复用）**
- App sandbox iframe（opaque origin）的 img/素材请求**不带 cookie** → 鉴权图片端点必须免鉴权
  （`/webos/api/imagegen/file/:name`、`/webos/api/apps/:appId/files/raw/*` 已公开，UUID 不可枚举）
- 401 JSON 响应会被 Chrome **ORB** 拦截（ERR_BLOCKED_BY_ORB）→ 表现为 naturalWidth=0
- 桌面 iframe 只在初始化拉一次 App 列表；宿主 apps 变化需 `notifyAppsChanged()`（apps_changed）通知
- 长按菜单的 pointermove 必须带位移阈值（>10px），否则手机手抖 4px 就取消
- 模板类改动（webosDesktopV1/webosStoreV1）部署后必须跑重置脚本（tmp/reset-desktops-v2.mts 模式：
  停服务 → 直接改 entities 表建新版本 + 写回工作区镜像 → 起服务），并 vm 校验模板 JS 无 SyntaxError
- **iframe 可见性验证**：headless 对 srcdoc iframe 的整页截图可能空白/报 not visible——
  用 `frame.locator('body').screenshot()` 或先 `getBoundingClientRect().height > 0` 判断；
  0 高 = 父容器定位被覆盖（如给 `.os-screen` 子元素加 position:relative 导致高度塌陷）
- Playwright 测试会残留随机游客 App（待办清单/图廊等）与工作区，无害；服务器 retention 会定期清理


---

### 用户账号速查（2026-08-08 起，排查必须直接用真实账号，禁止游客/模拟数据代替）

- **站长账号：`2893334965@qq.com`**（role=admin，称呼「芸」），user key = `user:fb9f2d90-a79c-4ab4-af3e-c3b13fb668d6`，工作区 `/root/daily/server/data/workspace/webos/user:fb9f2d90-.../`
- **排查规则（用户明确要求）**：凡是用户反馈"我的账号有问题"（长按/图标/数据/权限等），**必须用站长账号实测**（生成 JWT 注入 Playwright，或用服务器脚本查该账号 state/工作区），**禁止用游客身份或模拟数据代替实测**——不同账号数据差异（App 数量/异常数据/桌面版本）会导致游客正常、真实账号异常。
- 站长账号 JWT 生成（服务器）：`node -e "const jwt=require('jsonwebtoken');const fs=require('fs');const s=JSON.parse(fs.readFileSync('/root/daily/server/.env','utf8').split('\\n').filter(l=>l.startsWith('JWT_SECRET='))[0]?.slice(11));console.log(jwt.sign({authenticated:true,sub:'user:fb9f2d90-a79c-4ab4-af3e-c3b13fb668d6',userId:'fb9f2d90-a79c-4ab4-af3e-c3b13fb668d6',role:'admin'},s,{expiresIn:'2h'}))"`（以实际 auth.ts 签名为准，见 `signTokenForUser`）

