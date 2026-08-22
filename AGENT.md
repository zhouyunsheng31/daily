# Daily / webOS

## 主产品方向

Daily 是一个**移动端优先、AI-native 的网页操作系统（webOS）**。

核心产品形态：
- **AI 助手即系统主页**：首次打开自动进入游客身份并直达 AI 助手页，以简洁、灵动的对话交互承载全系统体验。
- **HTML App / 模板同构**：系统中的 App、桌面、对话页均以版本化 HTML 为形态，在沙箱 WebView / iframe 中运行，双端（Web PWA / Android 客户端）消费同一套模板。
- **一切皆包 · 组合式包**：app / api / skill / theme / toolpkg / subagent / bundle 统一流水线。包内可自由组合代码、API 声明、提示词技能与素材，支持不可变版本与一键回滚。
- **服务即包（App API 体系）**：App = UI + 数据 + API。AI/用户在 App 里声明 `api.json` 与受限 handler（Node vm，5s 超时、64KB 截断、域名白名单、无常驻进程），平台服务器提供安全代跑与托管 secrets，支持跨用户 public 管道与调用者计费（R15）。
- **文件工作区**：提供按用户隔离的虚拟工作区，AI 通过 `agent_fs_*` 工具读写与创建 App/包（「文件夹即包」）。
- **统一包市场**：万物皆可包，统一在市场内按 type 浏览、安装、升级。

---

## 双端分工与核心定位（最高纲领）

Daily 按**双端同构**模式推进：**Web 端（PWA / 浏览器）+ Android 端（高性能沉浸客户端）**。

| 维度 | Web 端 (PWA) | Android 移动端 |
|---|---|---|
| **UI 表现** | HTML 模板（React Shell / iframe） | **同构消费 Web HTML 模板**（WebView 全沉浸，无原生 Compose 对话页，零双端分裂） |
| **核心优势** | 打开即用、免安装、跨设备 | **本地持久化、无浏览器栏沉浸体验、手势丝滑、冷启动极快** |
| **AI 对话** | 服务端标准模型（DeepSeek V4 Flash 等） | **服务端标准模型统一提供**（保证一致性与稳定性，暂不开放端侧独立接 Key） |
| **包与数据** | 服务端权威存储 | 本地缓存 + 服务端同步 |
| **API 执行** | 服务端受限 vm 沙箱代跑 | 服务端受限 vm 沙箱代跑（移动端可直接发布包到服务端） |
| **系统能力** | 纯 Web 安全沙箱 | 纯应用内环境（**不依赖 Shizuku、无障碍、系统全局悬浮窗等外部系统级权限**） |
| **技能机制** | 统一装入包内（`contents.skills`） | 统一装入包内（`contents.skills`），无独立外挂 skill 体系 |

---

## webOS 后端端点快速索引

新 Shell 使用独立的 `/webos/api/` 命名空间，所有端点（除 `/api/auth/guest` 游客发放和既有登录端点）继承 JWT `authMiddleware`。

| 端点 | 用途 | 状态 |
|---|---|---|
| `GET /api/auth/guest` | 发放游客 JWT（已有端点） | 可用 |
| `GET /webos/api/bootstrap` | Shell 启动、游客余额、AI 配置、默认应用、支付/邮箱状态 | P0 |
| `PUT /webos/api/ai/config` | 独立保存 `flash` 模型与 `low/medium/high/max` 思考档 | P0 |
| `POST /webos/api/chat/stream` | pi agent 会话 SSE 流式对话 | P0；服务端读取 `DEEPSEEK_API_KEY` |
| `GET/POST /webos/api/apps` | App 列表与静态 HTML App 创建 | P0 |
| `POST /webos/api/apps/generate` | AI 生成静态 HTML App | P0 |
| `GET /webos/api/apps/:appId` | App 及不可变版本详情 | P0 |
| `POST /webos/api/apps/:appId/install` | 安装并切换 active version | P0 |
| `POST /webos/api/apps/:appId/versions` | 创建新不可变版本 | P0 |
| `PUT /webos/api/apps/:appId/active-version` | 原子切换版本指针 | P0 |
| `POST /webos/api/apps/:appId/rollback` | 回滚到指定版本 | P0 |
| `GET/PUT/DELETE /webos/api/apps/:appId/storage/:key` | `app.storage.private` 私有数据 | P0 |
| `GET/POST /webos/api/packages` | 包列表 / 创建包 | W1 |
| `GET /webos/api/packages/:id` | 包详情（不可变版本 + 审计 + 安装态） | W1 |
| `POST/GET /webos/api/appapi/:namespace/:endpoint` | **App API 调用（owner 级 + W3 public）**：受限 vm 执行 handler（storage 前缀权界 + http 白名单 + secrets 脱敏），扣 1 积分并落 `webos_api_usage` | W2 / W3 |
| `POST /webos/api/appapi/:namespace/publish` · `/unpublish` · `GET .../status` | 发布/撤回某 api 命名空间为公开可调用（发布索引 `webos_api_public`） | W3 |
| `PUT/GET /webos/api/appapi/:namespace/secrets` | 配置 api 包密钥（只收 api.json 声明名；GET 永不回传明文值） | W2 |
| `POST/GET /webos/api/net/spaces` | 共享数据空间（互通原语 v1，注册用户） | W3 |
| `POST/GET /webos/api/net/spaces/:id/events` | 事件/消息总线（发布 + 增量拉取 + `?wait=` 长轮询） | W3 |
| `GET /webos/api/market?type=&q=` · `GET /market/:id` · `POST /market/publish` | 统一包市场：浏览 / 详情 / 发布 | W3 |
| `POST /webos/api/market/:id/install` · `/market/:id/unpublish` · `GET /market/mine` | 市场安装（依赖闭包） / 下架 / 我的安装 | W3 |
| `GET /webos/api/workspace/agent-files?path=` | AI 工作区只读浏览 | P0 |
| `GET /webos/api/workspace/agent-files/raw?path=` | AI 工作区文件只读预览/下载 | P0 |
| `POST /api/auth/email/send-code` | 邮箱验证码发送（免鉴权） | P0 |
| `POST /api/auth/email/register` | 注册：验证码 + 密码 + 自动登录 | P0 |
| `POST /api/auth/email/login` | 密码登录（自动迁移游客资产） | P0 |
| `POST /api/auth/email/reset-password` | 重置密码并登录 | P0 |
| `GET /api/admin/webos/chat-logs` | 对话记录查询（管理端） | 上线 |
| `GET /api/admin/webos/sessions` | 统一对话 log 查询（含 reasoning 全文） | 上线 |
| `GET /api/admin/webos/trace` | 自动整合诊断（对话事件 + execution.log + App 版本历史） | 上线 |

---

## 变更与协作纪律

1. **双端同构红利**：系统 App / 页面模板（对话页、桌面、商店、文件管理器）优先在 Web 侧开发打磨，移动端 WebView 容器自动消费，不重复造轮子。
2. **版本不可变**：任何 AI 修改、用户编辑均产生新版本，指针切换，保留完整审计与回滚链。
3. **不开终端/任意进程（R5 红线）**：App 自动执行一律走服务端受限 handler（5s 超时、64KB 截断、域名白名单、无常驻进程）；系统不开放任意 Linux 终端或虚拟服务器。
4. **系统包化**：Skill、主题、工具包全部包装为标准包，随包分发，装包即用。
5. **查 Bug 必查对话记录**：遇到 AI 对话问题先通过管理端三件套（`chat-logs` / `sessions` / `trace`）查清原始日志，禁止主观臆测。
6. **协作同步与部署纪律**：每次开发任务完成、准备上线或测试前，**必须先获取/拉取 GitHub 的最新上传版本（`git fetch / git pull`）并完成本地合并与构建验证，再同步推送到 GitHub，最后再进入服务器进行部署与运行**。严禁在未同步 GitHub 最新代码的情况下直接覆盖或跑进服务器。
7. **Changelog 格式规范与版本感知纪律**：
   - **格式要求**：每条日志必须严格包含「**年月日几点几分（YYYY-MM-DD HH:mm）** + **Commit Hash / 版本编号** + **修改的具体文件路径（如 `client/shell-web/src/App.tsx`）** + 核心改动说明与验证结果」。
   - **操作前版本比照**：每次开始工作或接收任务时，必须比照本地当前版本号与 GitHub 最新版本号（拉取最新 log/commit 历史），以此清晰感知本地缺失的新文件或远端修改的文件，确保基线一致。
   - **完成后自动同步**：每次完成工作后，必须同步更新 CHANGELOG 并自动推送到 GitHub 远程仓库与最新的 log 文件。