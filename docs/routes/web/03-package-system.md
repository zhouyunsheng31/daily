# 03 · 包体系规范（web 版：一切皆包 · 组合式包）

> 与 `docs/android/03-package-system.md` 同源，改写为 web 执行语义。**manifest schema（`daily.pkg.json` v2）与能力词汇表以 `shared/webos-contracts` 为唯一事实源**（R6），本文是服务端执行规范；移动端消费同一契约。
> 「包 = AI 的能力单元」。除安全 UI 例外（权限弹窗/授权页）外，一切扩展都是包，走同一条流水线。

## 1. 设计要点

- **包是管理层，不是创作负担**：AI 视角永远只是"写文件夹"（`agent_fs_mkdir` + `agent_fs_write`，系统自动注册建版本）。包封套（manifest/版本/权限）由系统生成维护。
- **版本不可变 + 指针切换 + 回滚**：泛化现有 App Version 机制（StoredApp/StoredVersion → packages 三表）。
- **权限四交集**：平台策略 ∩ 用户授权 ∩ Agent 工具权限 ∩ 包能力声明（红线）。
- **系统默认包可覆盖**：内置工具/桌面/商店/UI 等以系统默认包形态存在，AI/用户装包即替换（不改代码）；安全回退保留。
- **组合式包（D19）**：包内可装 skill/mcp/工具/tokens/资源/子包（嵌套 ≤3 层）；`bundle` = 纯组合容器。
- **校验反馈回路**：AI 每次写包文件后系统即时校验，人话错误随工具结果回流，AI 修正再写——不等待用户下一条消息（AI 改包便捷性的关键）。

## 2. 统一 Manifest（`daily.pkg.json` v2，存包根目录）

schema 全文见 `shared/webos-contracts/packages/`（TypeBox + fixtures）。核心字段（与 android/03 §2 一致）：

```jsonc
{
  "schema_version": 2,
  "id": "com.daily.notes",            // Unicode 字母/数字/`._-`（排除路径分隔符与 ..）
  "type": "app",                      // app|api|skill|theme|toolpkg|mcp|workflow|provider|url-app|subagent|bundle|pet-layer
  "version": "1.2.0",                 // semver
  "entry": "index.html",              // 类型相关：app→html；api→api.json；skill→SKILL.md；bundle→可空
  "display_name": { "zh": "记事本" },
  "icon": "icon.svg",
  "capabilities": ["app.storage.private"],
  "network": { "domains": ["api.example.com"] },   // 出站白名单（默认空=禁网）
  "dependencies": [{ "id": "com.daily.forum-api", "range": "^1.0.0" }],
  "contents": { "skills": [], "mcp": [], "tools": [], "tokens": {}, "assets": [] },  // D19
  "children": [],                     // 子包 id（嵌套 ≤3 层）
  "minShell": "0.1.0"
}
```

校验规则：id 合法、semver、capabilities/network.domains 在词汇表内、children 深度 ≤3 且引用已注册 id、静态拒绝清单（任意外链 iframe/eval 远程代码/混淆大块 base64/超配额 单包 ≤10MB）。

## 3. 包类型与 web 执行引擎

| type | 内容物 | web 执行/消费方 | 首支持 |
|---|---|---|---|
| `app` | HTML/JS/CSS 静态包 | iframe 沙箱（runtime.ts） | **已有** |
| `api` | api.json + handlers/ | 服务端受限 vm + 端点自动生成 + AI 工具化（04） | **W2（核心）** |
| `skill` | SKILL.md + references | 注入 pi skills（用户级 skills/，现有机制） | W4 |
| `theme` | design tokens + 壁纸 + 模糊/动画参数 | shell-web 主题引擎（校验后应用，可回退） | W4 |
| `toolpkg` | JS 工具包 + 资源 | 服务端沙箱注册为 pi 工具（双层注册：系统默认 + 用户安装，同名按优先级覆盖） | W5 |
| `mcp` | MCP server 声明（stdio/sse/remote + env 模板） | 服务端 MCP client | W5 |
| `workflow` | 触发器 + 步骤图 | 服务端调度（cron/事件） | W6 |
| `provider` | 能力提供者声明（llm/vision/image/video/tts/asr + 适配参数） | 服务端 Provider 注册表 | W5 |
| `url-app` | manifest（startUrl + network 声明），可含快照 | iframe 直连（live）/ 服务端快照（snapshot） | W5 |
| `subagent` | agent.md（frontmatter + 工具白名单 + 模型要求） | 服务端 pi in-process 执行器 + 全局并发池 | W5 |
| `bundle` | contents + children（无 entry） | 安装时解析子包闭包聚合 | W4 |
| `pet-layer` | 场景 HTML + 行为参数 + 素材 | 桌面页共享 canvas 层（web 版桌宠层；悬浮窗形态 web 无） | W4（最小） |

> 执行引擎与移动端的差异：app 用 iframe（移动端 WebView）；api/toolpkg/mcp/subagent/workflow 全在**服务端**跑（移动端 owner 级 api 才端侧镜像，见 routes/mobile.md D-M2）。

## 4. 生命周期流水线（所有类型共用）

```
创建（AI 文件夹 / 用户上传 / 商店 / 粘贴 HTML / 粘贴 URL）
  → 静态校验（schema / 能力词汇表 / 危险模式 / 大小配额）——不通过则人话错误回流（AI 场景）
  → 生成不可变版本（DB 行 + 工作区镜像，createdBy/parentVersionId 溯源）
  → 安装（instance 切 activeVersionId）
  → 运行时按 type 分发引擎（§3）
  → 权限四交集求交后放行能力
  → 审计（谁/何时/建/改/装/回滚；管理端 trace 可查）
  → 回滚（切回旧版本指针，写回工作区镜像）
  → 卸载（回收站，可恢复；彻底删除二次确认）
```

### DB 表（新增，泛化现有 apps/app_versions；现有 entities state 不动，只读适配视图过渡）

```sql
packages         (id TEXT PK, owner_key TEXT, type TEXT, name JSONB, icon TEXT,
                  source TEXT, active_version_id TEXT, installed BOOL,
                  capabilities JSONB, created_at BIGINT, updated_at BIGINT)
package_versions (id TEXT PK, package_id TEXT FK, version TEXT, status TEXT,
                  parent_version_id TEXT, manifest JSONB, content_ref TEXT,
                  created_by TEXT, created_at BIGINT, audit JSONB)
package_installs (package_id TEXT, user_key TEXT, active_version_id TEXT,
                  PK(package_id, user_key))
```

迁移策略：现有 `apps`（entities 内 state）不动；提供只读适配视图把 app 视为 `type=app` 的包；新类型只走新表；不做大规模数据迁移。

### REST 端点族（`server/src/webos/packages.ts`）

```
GET    /webos/api/packages?type=&q=
POST   /webos/api/packages                    # 粘贴/上传创建（AI 走文件夹路径不经此）
GET    /webos/api/packages/:id
POST   /webos/api/packages/:id/versions       # 新不可变版本
PUT    /webos/api/packages/:id/active-version # 原子切指针
POST   /webos/api/packages/:id/rollback
DELETE /webos/api/packages/:id                # 回收站
GET    /webos/api/packages/:id/files/raw/*    # 包文件（免鉴权 + UUID 不可枚举，沿用既有策略）
```

## 5. AI 开发包（D17 泛化，校验反馈回路）

- AI 经 `agent_fs_mkdir` + `agent_fs_write` 写包目录（含 `daily.pkg.json`）→ 系统识别 type → 静态校验 → 注册 + 版本 v1 → 立即可用；**AI 视角建 App 和建 api/theme/subagent 是同一套动作**。
- **校验反馈回路**：每次 `agent_fs_write` 落包文件后，系统即时校验并把结果随工具结果回流——人话错误（"tools 里没登记 xxx"、"capabilities 词汇表不含 yyy"、"api.json 端点 add_note 缺 handler 文件"）→ AI 修正再写；校验通过才建版本。失败不留半成品版本（包事务）。
- 素材工作流：AI 一条指令 → workflow 包（调研→设计→生图→打包）→ 产出 app/theme/pet-layer 等资产并版本化。

## 6. 能力词汇表（web 版 v1；与移动端共享，设备专属词标 mobile-only）

```
app.storage.private      # App 私有 KV（已有）
app.api.invoke           # 调用其他 App 的 API（04）
app.fs / app.fs.shared   # App 私有文件 / 跨 App 共享区（已有）
system.apps.create       # App 内创建新 App（已有）
network.outbound         # 出站网络（须配合 network.domains 白名单）
files.workspace.read / files.workspace.write   # 文件工作区（粒度到目录）
media.tts / media.asr    # 语音（预留，unavailable）
room.join / room.host    # 联机房间（后置，unavailable）
subagent.spawn / subagent.manage   # sub-agent（W5）
ui.extend / ui.layout / ui.component / ui.theme  # UI 包化（安全 UI 例外不可挂载）
provider.switch          # 切换能力 provider（W5）
process.spawn / compute.exec       # ⚠️ 预留（R5：unavailable，不开放终端/任意进程）
# mobile-only（web 端登记为不可用，移动端求交）：overlay.spawn / device.screen.read /
# device.ui.automate / device.shizuku / pet-layer 悬浮形态
```

## 7. 安全与配额

- 包文件 raw 端点免鉴权 + UUID 不可枚举（沿用既有结论）。
- handler/工具包代码在服务端受限环境执行（04 编程模型），不得逃逸（process/require/fetch 白名单化）。
- 用量计费：API 调用/存储计入积分体系（06），**禁止**绕过审计与计费。
- 危险操作（删除/公开发布/付费）提升确认等级，二次确认 + 审计。