# 03 · 包体系规范（一切皆包 · 组合式包）

> 「包 = AI 的能力单元」。除**安全 UI 例外**（权限弹窗/授权页，D20）外，一切扩展（App、桌宠、API、skill、主题、工具包、MCP、工作流、模型、外部网页、**系统能力**）都是包，走**同一条流水线**。本文是包的唯一规范。

## 1. 设计要点

- **包是管理层，不是创作负担**：AI 视角永远只是"写文件夹"（D14：mkdir + 写文件，系统自动注册建版本）。包封套（manifest/版本/权限）由系统生成与维护。
- **版本不可变 + 指针切换 + 回滚**：复用并泛化现有 App Version 机制。
- **权限四交集**：平台策略 ∩ 用户授权 ∩ Agent 工具权限 ∩ 包能力声明（红线 5）。
- **系统默认包可覆盖**（2026-08 用户拍板）：内置工具 / 模型 / 媒体 provider / UI 扩展**全部以"系统默认包"形态存在**，用户/AI 安装新包即可覆盖或替换——基础能力不是代码，是包。AI 换 grep 的模型、换识图模型、调整对话页展示，都是装包/切指针，不改一行代码。
- **组合式包（D19，2026-08-16 用户拍板）**：一个包内**什么都能装**——skill / MCP / 工具 / 主题 tokens / 资源 / 子包均可组合进同一包；**大包可含小包（嵌套 ≤3 层）**；包 = 自包含能力单元（含操作它的 skill 与工具），AI 装一个包即获得"怎么用"的全部知识，不需要另行搜索技能。
- **系统包化（D20，2026-08-16 用户拍板）**：除安全 UI 例外（权限弹窗/授权页不可被 AI 篡改，防骗授权）外，**系统所有内容开放 API 并提供包**——系统大包 `com.daily.system` 内含 UI/文件/桌面/商店/对话/桌宠等子包，**UI 只是其中一个子包**；每个子包 = 工具（API 封装）+ skill（操作手册）+ 资源。安全回退路径保留：所有改动版本化、可回滚，导航/消息核心有不可挂载的兜底层。

## 2. 统一 Manifest（`package.json` 风格的 `daily.pkg.json`，存包根目录）

```jsonc
{
  "schema_version": 2,                    // v2：组合式包（D19）
  "id": "com.daily.pet-brawl",            // 反向域名，全局唯一；中文展示名放 display_name
  "type": "app",                          // app|pet-layer|api|skill|theme|toolpkg|mcp|workflow|model-pack|url-app|provider|subagent|bundle
  "version": "1.2.0",                     // semver；与 DB 版本行一致
  "entry": "index.html",                  // 类型相关：app/pet-layer→html；api→api.json；skill→SKILL.md；toolpkg→main.js；url-app→可空；bundle→可空
  "display_name": { "zh": "桌宠大乱斗", "en": "Pet Brawl" },
  "description": { "zh": "...", "en": "..." },
  "icon": "icon.svg",                     // 包内相对路径；缺省系统生成
  "capabilities": ["app.storage.private", "overlay.spawn"],   // 能力声明（白名单词汇表见 §6）
  "network": { "domains": ["api.example.com"] },              // 出站网络白名单（默认空=禁网，url-app 必填，见 05）
  "dependencies": [{ "id": "com.daily.forum-api", "range": "^1.0.0" }],
  "pets": { "maxInstances": 10, "physics": "webview" },       // type=pet-layer 专属段（示例）
  "api": { "spec": "api.json" },                              // type=api 专属段（见 04）
  "url": { "startUrl": "https://example.com", "mode": "live" }, // type=url-app 专属段（见 05）
  // ===== v2 组合式包（D19）=====
  "contents": {                           // 包内直接承载的内容（可选，任意组合）
    "skills": ["skills/ui-guide/SKILL.md"],      // 内置 skill（相对路径，多个可）
    "mcp": [{ "server": "json-rpc", "entry": "mcp/server.js", "env": {} }], // 内置 MCP server 声明
    "tools": ["tools/ui-layout.js"],             // 内置工具定义（QuickJS 或桥接声明）
    "tokens": { "color": {...}, "shape": {...} },// 主题 tokens（theme/ui 包）
    "assets": ["wallpapers/day.png"]             // 资源（壁纸/图标/音频…）
  },
  "children": [                           // 子包（可选；嵌套层数 ≤3，含本层）
    "com.daily.system.ui",                // 子包 id（同流水线注册，独立版本与回滚）
    "com.daily.system.files"
  ],
  "minShell": "0.1.0"                     // 需要的最低 Shell/服务端契约版本
}
```

- **嵌套规则（D19 硬约束）**：包树嵌套 ≤3 层（顶层包 → 子包 → 孙包）；`children` 只允许引用已注册且未被占用的包 id；子包独立版本/权限/回滚，父包版本切换**不级联强制**（子包指针独立，父包记录其依赖快照用于回滚）。
- **bundle 类型** = 纯组合容器（无 entry，仅 contents/children），用于系统大包与"全家桶"分发；其他类型也可带 contents/children（组合式是通用能力，不是 bundle 专属）。

校验规则：`id` 允许 Unicode 字母/数字/`. _ -`（沿用 APP_ID_PATTERN 放宽决策，排除路径分隔符与 `..`）；`version` 必须合法 semver；`capabilities`/`network.domains` 必须在词汇表内；`children` 深度 >3 或引用未注册 id 直接拒绝；schema 校验失败 = 注册失败并给出人话原因。

## 3. 包类型与执行引擎

| type | 内容物 | 执行/消费方 | 首支持 |
|---|---|---|---|
| `app` | HTML/JS/CSS 静态包（index.html 入口） | WebView 沙箱（PWA=iframe / Android=WebView） | 已有，M1 平移 |
| `pet-layer` | 场景 HTML（canvas/lottie）+ 行为参数 + 素材 | Android **桌面页桌宠层（应用内共享 canvas WebView，2026-08-15 拍板）；overlay-runtime 悬浮窗形态暂缓** | **M1-4 最小加载（挂载点 + 默认包）**；M2-5 完整版（多桌宠管理/行为参数） |
| `api` | api.json（端点声明集） | 服务端代理 + pi 工具生成器 + 文档页（见 04） | **M2 核心** |
| `skill` | SKILL.md + references | 注入 pi skills（用户级 skills/ 目录，现有机制） | M2（包装现有能力） |
| `theme` | design tokens + 壁纸 + 模糊/动画参数 | Shell 主题引擎（校验后应用，可回退） | M2 |
| `toolpkg` | JS 工具包（QuickJS）+ 资源 + wasm（可选）；**双层注册**：系统默认工具包 + 用户安装工具包，会话创建时聚合（同名工具按包优先级覆盖） | toolpkg 模块（端侧） | M2 |
| `mcp` | MCP server 声明（stdio/sse/remote + env 模板） | 服务端 MCP client | M2 |
| `workflow` | 触发器（定时/事件/语音预留）+ 步骤图 | 服务端调度 + 端侧前台服务 | M3 |
| `model-pack` | 模型文件（GGUF/TTS/ASR…）+ 元数据 | 对应 Provider（见 08） | M3 |
| `provider` | **能力提供者声明**（provider.json：kind=llm/vision/image/video/tts/asr/audio + 协议 OpenAI 兼容/Anthropic/自定义 + endpoint + env 模板 + 适配参数 + 可选引用 model-pack）+ 可选定价声明 | Provider 注册表（对话/工具/媒体模型选择器，见 08 §6/§7） | M2 |
| `url-app` | manifest（startUrl + network 声明），可含离线快照 | WebView 沙箱（直连模式，见 05） | M2 |
| `subagent` | agent 角色定义（agent.md frontmatter + 系统提示 + 工具白名单 + 模型要求） | 端侧 sub-agent 执行器（in-process 默认，见 15） | M2 |
| `bundle` | **纯组合容器（D19）**：contents（skill/mcp/tools/tokens/assets）+ children（子包），无 entry | 安装时解析子包闭包并聚合内容；系统大包 `com.daily.system` 即 bundle | M2 |

## 4. 生命周期流水线（所有类型共用）

```
创建（AI文件夹 / 用户上传 / 商店 / 粘贴HTML / 粘贴URL）
  → 静态校验（schema / 能力词汇表 / 危险模式扫描 / 大小配额）
  → 生成不可变版本（DB 行 + 工作区镜像，createdBy/parentVersionId 溯源）
  → 安装（instance 切 activeVersionId）
  → 运行时按 type 分发引擎（§3 表）
  → 权限四交集求交后放行能力
  → 审计（谁/何时/建/改/装/回滚）
  → 回滚（切回旧版本指针，写回工作区镜像）
  → 卸载（移回收站 .trash/，可恢复；彻底删除二次确认）
```

### DB 表（新增，泛化现有 apps/app_versions）

```sql
packages (id TEXT PK, owner_key TEXT, type TEXT, name JSONB, icon TEXT,
          source TEXT, active_version_id TEXT, installed BOOL,
          capabilities JSONB, created_at BIGINT, updated_at BIGINT)
package_versions (id TEXT PK, package_id TEXT FK, version TEXT, status TEXT,
          parent_version_id TEXT, manifest JSONB, content_ref TEXT,   -- content_ref=工作区路径或 blob
          created_by TEXT, created_at BIGINT, audit JSONB)
package_installs (package_id TEXT, user_key TEXT, active_version_id TEXT, PK(package_id,user_key))
```

迁移策略：现有 `apps`（entities 表内 state）不动；M2 提供只读适配视图把 app 视为 `type=app` 的包，新能力（api/pet-layer/...）只走新表。**禁止**在 M1 做大规模数据迁移。

### 4.1 AI 开发包（D17：AI 可开发任意类型包）

- **D14 泛化（文件夹即包）**：AI 在对话中直接要求"做一个 XX 包"，经 `agent_fs_mkdir` + `agent_fs_write` 写包目录（含 `daily.pkg.json`）→ 系统识别类型、静态校验、自动注册并建不可变版本。**AI 视角无感知差异**：建 App 和建 subagent/workflow/theme/skill/toolpkg/provider 是同一套动作。
- **修改 = 新版本**：AI 改包内文件 → 系统检测 diff → 新版本入链（parentVersionId 溯源），可回滚（D4 不变式）。
- **包内依赖**：AI 可在包目录写 `dependencies`（04 依赖闭包解析），例如"给记账 App 加汇率换算"→ AI 改 App 版本 + 声明依赖汇率 api 包。
- **校验反馈回路（AI 改包便捷性的关键，M2-12）**：AI 每次写包文件后，系统**即时校验**并把结果回流——通过人话错误（"tools 里没登记 xxx"、"capabilities 词汇表不含 yyy"）随工具结果返回给 AI，AI 据此修正再写；校验通过才建版本。**不等待用户下一条消息**，形成"写→校验→纠错→再写"闭环。
- **素材工作流（一键产出全套资产）**：AI 一条指令 → ① 创建/选用 `workflow` 包（步骤图：调研→设计→生图→打包）→ ② 执行步骤（生图走 imagegen provider，产物写包目录）→ ③ 产出 app/pet-layer/theme 等素材资产并版本化。验收用例见 15 §5。
- **安全边界**：AI 写的包内容照常过 §7 静态校验与权限四交集（红线 5）；**安全 UI 例外（D20）**：权限弹窗/授权页不可被 AI 篡改（防骗授权，纯 Compose 写死）；**其余系统 UI 全部开放**——AI 改输入框位置/换语音输入框/调布局 = 创建/修改 UI 子包（`com.daily.system.ui` 的覆盖版或 slot 包），经 `ui.*` API 与 `ui.extend` 能力生效，全程版本化 + 可回滚，安全回退主题保留（红线 2 更新见 §5.1）。AI 创建 subagent 包走版本化 + 审计（与 dsh 内存动态包的区别见 15 §5，我们选"不可变版本"路线）。

### REST 端点族（新模块 `server/src/webos/packages.ts`）

```
GET    /webos/api/packages?type=&q=           # 列表（本用户已安装 + 内置）
POST   /webos/api/packages                    # 创建（粘贴/上传入口；AI 走文件夹路径不入库经此）
GET    /webos/api/packages/:id                # 详情含版本
POST   /webos/api/packages/:id/versions       # 新版本（不可变）
PUT    /webos/api/packages/:id/active-version # 原子切指针
POST   /webos/api/packages/:id/rollback       # 回滚到指定版本
DELETE /webos/api/packages/:id                # 回收站
GET    /webos/api/packages/:id/files/raw/*    # 包文件（沿用公开素材免鉴权策略：UUID 不可枚举）
```

## 5. 商店即包注册表

现有 `webosStoreV1` 扩展 `type` 维度与 `dependencies` 解析：
- 列表/详情/安装端点加 `type` 过滤；安装时服务端解析依赖闭包（含 api 包），一并安装并在清单记录。
- **AI 找包工具**（新增 pi 工具 `search_packages`/`install_package`，M2）：AI 可搜索商店并按用户确认安装；安装行为计审计，付费包必须用户手动确认（不伪造扣款）。
- 发布/审核/撤回：社区发布后置 M3，先支持官方包与分享链接安装（J6）。

### 5.1 UI 开放（D20：除安全 UI 例外外全部 API 化，2026-08-16 用户拍板）

> 目标：AI 可调整系统 UI 的任何非安全部分（输入框位置、组件形态、布局、气泡样式…），同时保留安全底线。

- **安全 UI 例外（不可改，红线 2 更新）**：权限弹窗/授权页（防骗授权）——纯 Compose 写死，任何包不得挂载。**导航骨架/消息核心不再"写死不可改"**，改为受控可改（见下），但保留**安全回退路径**：默认 UI 包（`com.daily.system.ui`）始终存在，卸载/回滚即回到默认，任何改动版本化可逆。
- **UI 子包（系统默认包）**：`com.daily.system.ui` = UI 能力包（系统大包 `com.daily.system` 的子包），内含：
  - **工具**：操作 `ui.*` API 的封装（`ui.layout.set` / `ui.component.replace` / `ui.slot.mount` / `ui.theme.apply`…）
  - **skill**：UI 操作手册（语义锚点清单、可改范围、变体示例、回滚方法）
  - **tokens/assets**：设计令牌、壁纸、组件资源
  - AI 改 UI = 创建覆盖版 UI 包或 slot 包 → 切指针 → 回滚，全程不改 Shell 代码。
- **能力词 `ui.extend`（+ `ui.layout` / `ui.component` / `ui.theme`，词汇表 §6）**：UI 类包声明对应能力，Broker 四交集求交后才生效。
- **挂载纪律**：mount/unmount 即指针切换（原子、失败即回滚）；每页 slot ≤4（防性能失控，11 §2 增补预算）；卸载后回到默认 UI 包（安全回退）。
- **语义锚点**：所有可改组件必须暴露 Compose `semantics`/`testTag`，供 AI 探索工具定位。
- **AI 探索纪律**（07 §3.2）：AI 操作/验证 UI 时**禁止硬编码坐标与结构**，必须走语义锚点 + 无障碍树 dump + 截屏（视觉），与 UI 包是否被用户修改无关。

## 6. 能力词汇表（v1，Broker 求交的输入）

```
app.storage.private      # App 私有 KV（现有）
app.api.invoke           # 调用其他 App 的 API（04）
network.outbound         # 出站网络（须配合 network.domains 白名单）
overlay.spawn            # 创建悬浮层（桌宠/漂浮图标）
device.screen.read       # 读取屏幕（无障碍/截屏）
device.ui.automate       # UI 自动化（点击/滑动/输入）
device.shizuku           # Shizuku 增强能力
files.workspace.read / files.workspace.write   # 文件工作区（粒度到目录，见 09）
media.tts / media.asr    # 语音（08，预留）
room.join / room.host    # 联机房间（06）
subagent.spawn           # 派发 sub-agent 任务（15；父 agent 工具权限 ∩ 包能力声明）
subagent.manage          # 创建/修改/安装 subagent 包（15；D17 AI 开发包）
ui.extend                # 挂载 UI slot 包（03 §5.1；须声明语义锚点，安全 UI 例外不可挂载）
ui.layout                # 修改系统 UI 布局（输入栏位置/页面结构等，D20；版本化可回滚）
ui.component             # 替换系统 UI 组件（输入框→语音输入框等，D20；须保留安全回退）
ui.theme                 # 应用主题/壁纸/设计令牌（theme 包或 UI 子包 tokens）
provider.switch          # 切换能力 provider（03 provider 包；对话/工具/媒体模型选择器）
```

新增能力词汇必须：登记 Broker + 写进本文 + 客户端/服务端两侧实现求交，缺一不可上线。

## 7. 安全与配额

- 静态校验拒绝清单：`<iframe src=>` 任意外链（url-app 走白名单）、`eval` 远程代码、混淆 base64 大块载荷、超配额（单包默认 ≤10MB，model-pack 另计）。
- 运行时：包文件 raw 端点继续免鉴权 + UUID 不可枚举（既有结论）；url-app 网络白名单由 app-runtime 的 `shouldInterceptRequest` 强制执行（05）。
- 用量计费：API 调用/房间流量/存储计入现有积分体系（04/06/09 分篇细化），**禁止**绕过审计与计费。