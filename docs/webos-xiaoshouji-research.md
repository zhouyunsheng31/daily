# 调研：「小手机」应用流派 + 成熟 webOS 项目（webOS × 小手机 融合方向）

> 状态：调研草稿（2026-08-18）· 无拍板决策，仅供讨论
> 目的：评估「搁置 Android 原生 → 专注 webOS（+小手机形态）网页应用构建；手机端迁移网页端并做好数据/计费/包管理/工作区区分」这一方向。
> 调研方式：一手 GitHub / 官网勘察 + 中文社区（linux.do / CSDN / 百度）交叉验证。
> ⚠️ 2026-08-18 用户澄清：「小手机」= **类似 Daily 的 AI 生成 App——界面仿手机、有应用市场、自由性强的网页应用**，即「手机形态的 webOS」，不是指 AI 角色陪伴聊天应用（§1 仍保留该类应用作为参考流派）。

---

## 0. 一句话结论

- **「小手机」按用户澄清 = 手机形态的 webOS**：一个界面仿手机（桌面/状态栏/多任务/App 图标）、内置**应用市场**、可自由装/卸/改 App、且 App 绝大部分由 **AI 生成**的网页应用。它与 Daily 是同一个物种，方向收敛为「把 Daily 打磨成这类产品的头部形态」，而不是并行走另一条线。
- **最成熟的 webOS（Puter，43.1k★）确有「AI 生成应用」功能**：官方 `builder.puter.com/ai-app-builder` ——「描述一句话 → AI 写文件 → 实时预览 → 自检修复 → 每轮快照可回滚 → 一键发布公共 URL + 可安装 PWA」，且 App 内置 Puter.js 后端（KV 存储/文件/登录/AI/serverless/P2P），计费采用 **user-pays 模型**（最终用户用自己的 Puter 账号承担存储与 AI 用量，开发者不为陌生人用量买单）。**这套设计与 Daily 现存闭环（对话内 AI 生成 HTML App → 沙箱运行 → 版本回滚）高度同构，是最值得逐项对标的基准。**
- **成熟 webOS 全景**（浏览器桌面系统）按成熟度/商业化分三层：纯前端摆件型（daedalOS 13k★ / winXP / 98）、前端桌面+可选后端（OS.js 7.1k★ / ProzillaOS / X-WebDesktop）、**真·客户端-服务端 internet OS（Puter / arozos 3k★ NAS 化 / 腾飞Webos 国产云盘化）**。
- **对 Daily 的结论**：Daily 现有 `client/shell-web` + `server`（pi agent + 版本化 HTML App + 积分计费 + 工作区 + 商店）已经站在这条路上；缺的正是「对标 Puter AI App Builder」的**生成体验打磨**（实时预览/自检循环/逐轮快照）与「计费区分」的**用户侧承载模型**（user-pays / BYOK）。主要工作是「体验补强 + 分层 + 四个区分（数据/计费/包管理/工作区）」，不是推倒重来。

---

## 1. 调研一：「小手机」应用流派（更新为「参考流派」，非主方向）

> 说明：按用户 2026-08-18 澄清，主方向是「手机形态 webOS + AI 生成 App + 应用市场」（§2.4 的 Puter AI App Builder 才是重点对标）。本节仍保留「小手机=仿手机 UI 的本地 AI 陪伴聊天应用」这一流行流派作为设计参考——因为它的「手机隐喻 UI + 模型指令触发 UI 动作 + 本地钱包」对 Daily 的移动端桌面/对话体验仍有借鉴价值，但**不再把它当作主方向**。

### 1.1 代表项目

| 项目 | 地址/仓库 | 形态 | 关键特性 |
|---|---|---|---|
| **小手机** | github.com/Guaizai-s/xiaoshouji（Vue3+Vite+PWA，MIT） | 本地优先 AI 多角色聊天 PWA | 仿微信聊天页 + 短信页 + 通讯录 + 手机桌面隐喻；多角色、每角色独立 API 方案、上下文轮数；**IndexedDB 本地存储**（roles/conversations/messages/apiProfiles/stickers/assets/walletAccounts/…）；BYOK（OpenAI 兼容 / Anthropic 格式）；表情包/语音(TTS)/红包/转账特殊消息格式；**本地娱乐钱包**（分制整数记账，无真实支付）；时间感知 + 角色设定 + 长期记忆 + 用户人设卡；备份导入导出；移动端 UI + 夜间模式 |
| **OMate** | omate.net（官网，另有 otaku2244 的 Gemini 代理仓库） | AI 角色扮演 App（网页/移动端） | **把 SillyTavern 的角色卡、世界书、预设、聊天记录整包搬进手机**；原生世界书引擎、统一预设系统、长期记忆、BYOK / 可接免费 API；营造「手机里养了个角色」的体验 |
| **linux.do 同类** | Ling_ki 的「小手机+AI roleplay 个人 web 应用」（Next.js） | 纯前端本地存储角色扮演 | 文本/贴纸/AI 图片描述/红包；系统提示词框架（单聊/群聊模板）；记忆系统（群聊记忆链接）；WorldBook 知识注入；所有用户数据本地存储、服务器零内容 |
| **SillyTavern（底座生态）** | github.com/SillyTavern/SillyTavern（32.3k★，AGPL-3.0） | 本地安装的前端聊天 UI（酒馆） | 统一多 LLM 后端接口；**角色卡 V2 规范**、世界书（WorldInfo/lorebook）、预设（presets）、思路注入、图像生成、TTS、插件体系；**「角色卡/世界书/预设」是这套生态的事实数据格式标准**；不做任何托管服务、不跟踪数据 |

### 1.2 这类应用的共性架构（可直接借鉴）

```text
┌────────────────────────── 小手机类应用 UI 层 ──────────────────────────┐
│ 手机隐喻：桌面(可放角色)/通讯录/微信聊天页/短信页/设置页                │
│ 特殊消息：文字/图片/AI 识图/语音(TTS)/表情包/红包/转账                  │
└──────────────────────────────────┬─────────────────────────────────────┘
                                   │ 模型指令 → UI 动作
┌──────────────────────────────────▼─────────────────────────────────────┐
│ Prompt 工程层（核心卖点）                                               │
│   角色卡(chara_card_v2) + 世界书(lorebook) + 预设(preset)               │
│   + 用户人设卡 + 长期记忆 + 时间感知 + 可用表情包列表 + 最近上下文        │
│   模型只输出固定指令格式([语音:..]/[表情:..]/[红包:..])，执行交给前端    │
└──────────────────────────────────┬─────────────────────────────────────┘
                                   │
┌──────────────────────────────────▼─────────────────────────────────────┐
│ 数据层：IndexedDB（本地优先，可导出/导入备份）                           │
│   roles / conversations / messages / apiProfiles / stickers /          │
│   assets / walletAccounts / walletTransactions / userPersonas          │
│ API：多家 LLM + BYOK（密钥仅本地）；TTS 可选第三方                      │
└─────────────────────────────────────────────────────────────────────────┘
```

### 1.3 对 Daily 的含义

- 这套做的是**「以对话为系统内核的沉浸式内容体验」**，和 Daily 的「AI 助手即系统主页」是同一个北极星的两种切法。融合时 Daily 可以提供这套内容之上的「操作系统」：身份/计费/包管理/工作区/权限，小手机提供「角色/剧情/记忆/炉石一样的本地钱包」。
- 小手机类应用普遍**不自己做账号、不托管 ≠Daily 的云能力缺口**；Daily 已有游客身份 + 邮箱登录 + 云端工作区，正好补上「跨设备同步/云端备份/BYOK 密钥不上云的冲突点」这门功课。

---

## 2. 调研二：成熟 webOS（浏览器桌面系统）项目

### 2.1 全景（GitHub web-desktop / webos topic 实测，2026-08-18）

| 项目 | Star | 类型 | 架构与商业/数据形态 |
|---|---|---|---|
| **Puter**（HeyPuter/puter，AGPL-3.0，43.1k★） | 43.1k | **Internet OS（云桌面，商业闭环最完整）** | `src/{backend,gui,puter-js,worker,cli,dev-center,mcp-connector}`。Node 后端 + Web GUI + **Puter.js SDK** + serverless worker。账号体系、App Store（应用可发布+变现）、云存储+配额、AI、数据库；官网 puter.com 已商业化；可 self-host（docker） |
| **daedalOS**（DustinBrett，13k★） | 13k | 纯前端桌面环境 | Windows 式桌面/窗口/开始菜单/任务栏/动态壁纸；内置文件系统（IndexedDB/浏览器存储）、DOS/BoxedWine/RetroArch 模拟、媒体、游戏；可选 Node 后端 |
| **OS.js**（os-js/OS.js，7.1k★，2009 至今） | 7.1k | Web 桌面平台（含服务端） | window manager + **应用 API** + GUI toolkit + **文件系统抽象**+用户/认证；PHP/Node 后端，企业向 |
| **winXP**（ShizukuIchi，React，5.9k★） | 5.9k | WinXP 桌面复刻 | 纯前端重现（非可用 OS） |
| **arozos**（tobychui，Go，3k★） | 3k | **NAS/云盘化 web OS** | Go 后端，树莓派/NAS 低功耗友好；**多种云存储驱动**（Google Drive/S3/WebDAV/本地）挂载成统一文件系统；服务端中心化的文件管理；类 DSM |
| **Neurite**（satellitecomponent，2.1k★） | 2.1k | AI 第二大脑 web 桌面 | 知识图谱/思维导图/多 agent 模拟/本地 model，AI-focused |
| **awesome-web-desktops**（syxanash，2.1k★） | 2.1k | 目录清单 | 收集仿 OS 的网址/web 应用 |
| **98**（1j01，1.4k★） | 1.4k | Win98 网页复刻 | 纯前端 |
| **anuraOS**（MercuryWorkshop，503★） | 503 | web OS + Linux 仿真 | **v86 全 Linux 仿真**，自带 dev env |
| **vtron**（royalknight56，445★） | 445 | Win10 风格 Vue3 框架 | 前端框架化 |
| **X-WebDesktop-Vue**（OXOYO，438★） | 438 | Vue+Koa 视窗系统 | 前后端 |
| **ProzillaOS**（prozilla-os，347★） | 347 | React 桌面系统 | 组件化 web OS，Ubuntu/Win 混合 |
| **Ubuntu Tour**（167★）、**OriginOS**（148★） | <200 | 复刻/Scratch 桌宠类 | 前端摆件 |
| **腾飞Webos**（os.tenfell.cn，国产） | — | **仿 Win11 私有云盘/企业网盘** | 桌面 + 网盘挂载（阿里云盘/天翼/百度/WebDAV/OSS）+ Office/PPT/Word/Excel + **独立应用商店**（可插件化开发）+ 协同办公 + 离线下载/断点续传 + Docker 私有部署 |
| **mso**（rahmanef63，近期新秀） | 58 | 移动优先的服务器控制台 web shell | Next.js 16/React 19/node-pty/**BYOK AI**/shadcn；mobile-first browser shell |
| **BrowserOS**（CSDN 教育向） | — | 教学向微内核风格 | 「内核」只做应用生命周期管理（注册/启动/挂起/销毁）+ IPC |

### 2.2 分层归纳（决定 Daily 借鉴哪层）

1. **纯前端摆件型**（daedalOS/winXP/98/ProzillaOS/X-WebDesktop/腾飞前端）→ 学「桌面交互/视觉细节/文件管理器 UX」，不适合直接抄数据架构。
2. **前端桌面 + 可选后端**（OS.js）→ 学「应用注册/API/FS 抽象/认证」的抽象层设计。
3. **真·客户端-服务端 internet OS**（Puter / arozos / 腾飞Webos）→ 学「账号 + App Store + 云存储配额 + 文件驱动 +（Puter）计费」的闭环形态。**这是 Daily 的目标形态**，且 Daily 已经走在这条路上。

### 2.3 关键启示（与 Daily 对照）

- **Puter**：印证「浏览器 OS 商业化= 账号 + App Store + 云存储 + serverless + AI + 收费」，hosted 与 self-host 两开花。Daily 已有 pi agent + 版本化 App + 商店 + 积分，缺「对外申请 App Store/创收/开发者身份」的正式化。
- **arozos / 腾飞**：云盘挂载 + 统一文件系统的「文件工作区」心智，印证 Daily「用户可见 home/ + App 私有 + shared」方向正确；可参考其盘挂载与配额实现。
- **OS.js**：应用 API + FS 抽象 + 认证的抽象层，正好对照 Daily 的 `shared/webos-contracts` + `Permission Broker`（仍未实现）。
- **daedalOS 族的纯前端**：证明「无需后端即可 OS」，适合 Daily 的「本地优先/离线可用」补齐（当前重度依赖服务端状态）。
- **mso**：移动优先控制台 + BYOK AI 的近期新项目，验证「移动端优先 + 用户自带 Key」组合是 2026 年的常见做法（与 D15 一致）。

### 2.4 重点对标：Puter 的 AI App Builder（2026-08-18 一手勘察）

> 来源：`builder.puter.com/ai-app-builder` 官方页（已存证），及 `puter.com/app/puter-app-builder-ai`（应用市场入口）。

**结论：最成熟的 webOS 的确有"AI 生成应用"，而且核心链路与 Daily 高度同构——它就是被验证过的头部形态，Daily 应逐项对标。**

官方能力（逐条）：

| # | Puter AI App Builder 能力 | 与 Daily 对照 |
|---|---|---|
| 1 | **一句话描述 → 生成可运行 App**：Puter 写文件、跑实时预览、检查真正能用、给公共 URL；无需安装/配置/代码 | Daily 已有「对话内 AI 生成 HTML App」，但**无实时预览、无自检** |
| 2 | **产物是可读文件**：普通 HTML/CSS/JS 文件夹（Tailwind CDN、无构建步骤） | Daily 独立 HTML 版本包 = 同思路（Daily 暂单文件） |
| 3 | **实时预览（live preview）**：写的过程中就在跑真实 App，可点可输可破坏 | Daily 生成后直接打开运行页，**缺少"边写边看"** |
| 4 | **自检循环（核心差异）**：每轮改动后 reload 预览、捕获运行时错误 → AI 读坏文件 → 修复 → 再验证；**"一轮不跑到干净就不算完"** | Daily 有 HTML 语法校验/占位符检测，但**无运行时错误回灌→自动修复循环** |
| 5 | **点选编辑（element picker）**：点预览中的元素 + 描述修改；纯样式可推进条（独立 stylesheet，不被后续 AI 改动覆盖） | Daily 无 |
| 6 | **逐轮快照 + 可撤销的撤销**：每轮=快照+改动描述；回滚前再存安全快照 | Daily 有不可变版本 + 回滚，**逐轮快照/描述更细** |
| 7 | **内置后端（Puter.js）**：KV 存储、文件、登录、AI、serverless worker、P2P，App 一出世就有后端 | Daily App 有 fs/storage/apps.create 能力，**缺云 KV/登录/worker**（部分可走服务端代理） |
| 8 | **一键发布公共 URL（puter.site）+ 可安装 PWA（自动 manifest+图标）** | Daily 有商店/分享/整套分享，**缺每 App 独立公共域 + 独立可安装** |
| 9 | **手机可用**：builder 聊天与预览两视图切换；后台长构建；浏览器挂起后能续跑 | Daily 移动端 PWA 优先，体验层可对标 |
| 10 | **user-pays 计费模型（重点）**：App 的用户用自己的 Puter 账号承担存储/AI 用量，**开发者不为陌生人用量买单**（解决"hobby AI app 因账单被下架"） | Daily 当前由宿主账号扣积分；**是否引入"用户侧承载"待拍板** |

「用户侧承载」的本质：平台记账单位为「使用 App 的最终用户」，而不是「发布 App 的人」。这与 Daily D15（BYOK 端侧、平台不托管不算费）是同一哲学的两个入口：要么用户自带 Key（零平台成本），要么用户有平台账号额度。设计 Daily 计费时二者应共存（见 §4.3）。

「开源与否」备注：Puter 主仓库 AGPL-3.0；AI builder 是官方 hosted 产品（builder.puter.com），仓库内未见 `app-builder` 目录（gui/src 下无 apps 目录，Puter 的 App 从云商店加载）。**能否整体抄实现不确定，但功能规范已从官方页完整获取，可据此设计。**

---

## 3. Daily 现状盘点（2026-08-18 实测代码）

### 3.1 前端 `client/shell-web/`
- React 19 + Vite + Tailwind4 + Zustand；`src/`：`App.tsx`(~187KB 单体) / `store.ts`(~88KB) / `api.ts`(~30KB) / `runtime.ts`(~35KB) / `styles.css`(~95KB)。
- 视图路由 `ScreenView = 'assistant' | 'desktop' | 'files' | 'profile' | 'app' | 'store' | 'experience'`。
- Runtime：`sandbox="allow-scripts"` iframe + MessageChannel SDK（storage/app.fs/shared/apps.create）；localStorage polyfill → `app.storage.private`；公开素材免鉴权端点（opaque origin 不带 cookie）。

### 3.2 服务端 `server/`
- `routes/webos.ts`（409KB 单体，**冻结**，新端点进新模块）持有域名模型：
  - `StoredApp`：`id / name / source / activeVersionId / installed / versions[]`；`StoredVersion`：`version / status / capabilities / html / parentVersionId`（不可变版本，`1.0.n` 递增，AI 修改即新版本）。
  - `StoredState`：`balanceMinor / freeBalanceMinor / usedMinor / workspaceBytes / credits{quota,used,monthly}` + apps + 会话等。
- `utils/webosWorkspace.ts`：每用户磁盘工作区 `<sandbox>/webos/<key>/`：`meta.json / README.md / logs/execution.log / home/(用户可见) / system/(品牌/主题) / agent/(AI 私有)` + `apps/<appId>/index.html` 源码镜像 + `shared/` 跨 App 共享区 + 分片上传。
- `billing/pricing.ts`：`BillingKind = chat/image/search/video/tts`；1 积分=¥0.01；DeepSeek 峰谷价 ×2、毛利 50%；生图/视频按官方刊例半价；zpay 易支付 + 爱发电兑换码 + 月卡。
- 认证/账：游客优先 + 邮箱验证码注册/登录（Resend）+ 游客资产迁移；`webos_ai_usage`/`chat_sessions`/`chat_logs` 审计。
- AI：pi agent（deepseek-v4-flash，四档思考）；SSE `chat/stream`；工具含 `agent_fs_*`（文件夹即 App，AI 直接 mkdir/write 即在系统注册+建版本）。
- 商店：`webos_store_*` 独立表；分享（整套/单 App）；技能市场；下载奖励积分。

### 3.3 系统内置 App
`BUILTIN_APPS = daily.ai / system.desktop / system.store / system.files / system.trash`（desktop/store/trash 都是**版本化 HTML App**，AI 可改形态）。`system.files` 缺 HTML 版模板（Android 端遗留项，PWA 中由宿主 Files 视图承担）。

---

## 4. 融合方向：webOS（手机形态）× AI 生成 App + 应用市场

### 4.0 核心命题（按用户澄清更新）

> 主方向 = **把 Daily 打磨成 Puter 级的「手机形态 webOS」**：系统默认主页即 AI 助手（已有），对话内 AI 生成 App（已有雏形）+ **应用市场（已有雏形）** + 自由装/卸/改（部分有）。对标 Puter AI App Builder（§2.4），需补强的三件事：
> ① **生成体验**：实时预览 + 运行时自检/修复循环 + 逐轮快照；
> ② **计费区分**：平台积分 / BYOK / user-pays（最终用户各自承担）三态并存；
> ③ **App 能力扩张**：从"静态无后端"逐步到"带内置后端（KV/登录/AI/worker 的服务端代理）"。
>
> §1 的「AI 角色陪伴/剧情互动」内容层是本主方向之上的**可选内容生态位**（复用内容包机制），不是 P0 主路径。

### 4.1 分层（新增「内容包/角色包」抽象，复用 D19「一切皆包」）

```text
系统层（webOS）：身份·桌面·商店·文件·设置·权限中介(待建)·计费·工作区　┐
     │ 包管理系统（文件夹即包 + 不可变版本 + 回滚 + 审计 + 权限四交集）   │
     ▼                                                                │
应用层（HTML App）：工具类 App / 系统 App（desktop/store/files/trash） │
     │                                                                │
     ▼                                                                │
内容层（新增·小手机）：角色卡 / 预设 / 世界书 / 表情包 / 钱包账本 /
     记忆库 / 剧情状态 → 全部包化（chara/lorebook/preset/… 复用版本流水线）
```

- **把「角色卡 + 世界书 + 预设」做成一种新包类型（或归属于既有 `app` 组合式包的 `contents`）**：AI 生成角色 = 文件夹即包；修改角色 = 新版本；回滚/审计/权限四交集全部复用 D19。**这直接回答了「包管理怎么区分」**：App 包管「能做什么」，内容包管「和谁/怎么聊」，两者同一流水线、互不污染。
- 对话运行时：系统默认对话页（assistant）可解析角色包；也可像现有 `system.desktop` 一样提供「角色对话 App 模板」，AI/用户可替换（D21 的「HTML 对话 App 覆盖」机制正好用上）。

### 4.2 数据如何区分（沿用并扩展现有工作区语义）

```text
工作区 <sandbox>/webos/<userKey>/
├── home/       用户可见区（文件 App 展示；上传/下载走这里）     ← 用户可见
├── apps/<appId>/  每个 App 的源码+素材镜像（版本化）           ← App 资产
├── shared/     跨 App 共享区（app.fs.shared）                  ← App 协同
├── system/     品牌/主题/桌面模板（受控）                      ← 系统
├── agent/      AI 私有草稿/中间产物                            ← Agent
└── content/    ★新增：小手机内容仓库（角色卡/预设/世界书/表情包，
                 按包组织 + 符号链接/镜像到 App 工作区读取）     ← 内容层
```

- 会话与记忆：对话消息已在 DB（chat_sessions/chat_logs）；把「角色长期记忆/用户人设」落到 `content/` 的包内 `memory.md`/KV，**AI 可读写、用户可导出/同步**。
- 本地钱包（小手机式红包/转账娱乐记账）与平台积分**严格分开**：一个本地娱乐账本（IndexedDB 为主、可选云端同步），一个是平台记账（credits，服务端）；**两边互不换算、互不混用**，避免「娱乐扣费」与「真实计费」混淆。

### 4.3 计费如何区分（三钱包模型）

| 钱包 | 归属 | 用途 | 规则 |
|---|---|---|---|
| **平台积分 credits**（已有） | 服务端，游客/账号 | AI 对话/生图/视频/搜索（pi 真实 usage / 定价表） | 不变；继续「不伪造扣费」 |
| **BYOK 会话**（D15） | 端侧（Android Keystore）/PWA 浏览器本地 | 用户自带 Key 的角色对话 | **平台不计费、不托管密钥**；与积分渠道并存，UI 上明确标识「自有模型，平台不扣费」 |
| **本地娱乐钱包**（新，小手机式） | 端本地（IndexedDB，可导出） | 角色间红包/转账/账本 | 纯娱乐记账，**禁止与真实支付/积分挂钩** |

> 未来 App 内付费/订阅再按 PaymentProvider 抽象扩展（现有 zpay/爱发电已有雏形）。

### 4.4 包管理如何区分（复用「文件夹即包」流水线）

- **App 包**（现有）：HTML 静态包，能力= storage/fs/fs.shared/apps.create；版本化、回滚。
- **内容包**（新增类型，沿用 D19 manifest `contents`/`children`）：
  - `chara`（角色卡，兼容酒馆 chara_card_v2 字段：first_mes/system_prompt/mes_example/alternate_greetings/creator/tags/character_book）
  - `lorebook`（世界书 entries：keys/content/insertion_order/constant/selective）
  - `preset`（预设：温度/top_p/上下文轮数/思考档/作者注）
  - `sticker`（表情包）、`theme-content`（聊天背景/壁纸）
  - `bundle`（组合：一个 AI 生成的「角色剧情包」= 角色+世界书+预设+表情包，一键装）
- 校验：大小/条数/格式/路径穿越，与现有 `validateAppHtml` 同级；内容走私的 JS 不执行（渲染层分离开）。

### 4.5 工作区如何区分（打破 409KB 单体的事件驱动方向）

- 保持「webos.ts 冻结」纪律：新增 `content/`、角色包、口袋钱包、BYOK 剧情的端点一律进新模块（如 `server/src/routes/webosContent.ts` / `webosRoleplay.ts`），DB 沿用 entities/webos_state + 独立小表（角色卡/世界书/预设可走 webos_store 同款独立表模式）。
- 桌面/商店/角色对话 App 沿用「版本化 HTML App（AI 可改形态）」模式，系统模板当默认包，UI 差异化走装/改包而非改宿主（D20 已在 Android 侧立项，同样适用于 web）。

### 4.6 手机端迁移（PWA 优先，不依赖原生）

- 现有 shell-web 已是移动优先 PWA；把「小手机 UI 语言」（桌面可放角色/通讯录/微信式聊天）作为系统默认对话页的新视觉迭代**由用户主导 UI**（遵守 UI 红线：AI 只按指示执行，不许自行拍板风格）。
- 手机端与桌面端共用同一 shell-web + 服务端，仅按视口/能力做响应式：数据/计费/包/工作区天然同一套，无需原生桥。
- Android 侧已做的探索（沉浸启动器 D18、JSON-RPC 桥、proot pi spike、BYOK）可作为 web 端体验与将来原生壳的蓝图，但不再作为独立产品线投入。

### 4.7 建议的推进顺序（均待用户确认）

**主线（对标 Puter AI App Builder，服务"手机形态 webOS + AI 生成 App + 市场"）：**

1. **P0-A · 生成体验补强**：对话内生成 App 时加「实时预览 + 运行时自检/自动修复循环」（沙箱 iframe 捕获运行错误 → 回喂 AI → 自动修 → 再验证），这是与 Puter 拉开/抹平差距的核心。
2. **P0-B · 逐轮快照**：把「修改 App」的每次变更落成「快照 + 变更描述」，回滚支持「安全快照」（可撤销的撤销）——现有不可变版本机制已接近，补描述与安全快照即可。
3. **P0-C · 计费三态**：明确 平台积分 / BYOK 会话 / **user-pays（未来 App 用户各自承担）** 的边界与 UI 标识；先落地积分 + BYOK 共存。
4. **P1-A · App 内置后端代理**：给 App SDK 增「云 KV / 按 App 用户登录 / 服务端 AI 调用代理」能力（服务端代理 + 权限四交集），支撑多用户/需后端的 App。
5. **P1-B · 应用市场正式化**：商店从"分享/发布到列表"升级到 独立 App URL（如 `daily.app/**`）+ 可安装 PWA，为对外分发打基础。
6. 可选：补 `system.files` HTML 模板、内容包（角色/世界书/预设）等生态位。

---

## 5. 风险与开放问题（需用户拍板）

1. **主方向确认**：是否就以「Daily = 手机形态 webOS + AI 生成 App + 应用市场」为主线推进（对标 Puter），并实机体验一次 Puter 的 AI App Builder 作为参照系？（推荐：先花 10 分钟用用 builder.puter.com 再看全局，最直观）
2. **生成体验投入优先级**：实时预览 + 自检循环是 Puter 宣传的核心卖点，Daily 要不要在下一步就做（改动较大，涉及 Runtime 与 pi 工具链）？还是先用现有「生成→运行→改版本」闭环跑通再补？
3. **user-pays 计费**：是否认同「App 的最终用户各自承担 AI/存储用量」这个方向？（它直接影响 App 市场能否让用户放心装第三方 App）
4. **BYOK 与积分并存的默认值**：新用户默认用哪个？成本提示/余额展示怎么区分？
5. **App 是否要独立公共 URL + 独立可安装 PWA**（对标 puter.site），还是先只做站内市场？
6. **内容生态位（§1）**：AI 角色陪伴/剧情互动这类内容包，是否后续作为差异化功能做？（可选，不阻塞主线）
7. **Android 侧暂缓确认**：桌宠/悬浮窗等 Android 侧暂缓项在纯 web 方向一并搁置？（建议：搁置）
