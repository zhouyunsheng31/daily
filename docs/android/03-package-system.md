# 03 · 包体系规范（一切皆包）

> 「包 = AI 的 App」。除系统内核工具外，一切扩展（App、桌宠、API、skill、主题、工具包、MCP、工作流、模型、外部网页）都是包，走**同一条流水线**。本文是包的唯一规范。

## 1. 设计要点

- **包是管理层，不是创作负担**：AI 视角永远只是"写文件夹"（D14：mkdir + 写文件，系统自动注册建版本）。包封套（manifest/版本/权限）由系统生成与维护。
- **版本不可变 + 指针切换 + 回滚**：复用并泛化现有 App Version 机制。
- **权限四交集**：平台策略 ∩ 用户授权 ∩ Agent 工具权限 ∩ 包能力声明（红线 5）。

## 2. 统一 Manifest（`package.json` 风格的 `daily.pkg.json`，存包根目录）

```jsonc
{
  "schema_version": 1,
  "id": "com.daily.pet-brawl",            // 反向域名，全局唯一；中文展示名放 display_name
  "type": "app",                          // app|pet-layer|api|skill|theme|toolpkg|mcp|workflow|model-pack|url-app
  "version": "1.2.0",                     // semver；与 DB 版本行一致
  "entry": "index.html",                  // 类型相关：app/pet-layer→html；api→api.json；skill→SKILL.md；toolpkg→main.js；url-app→可空
  "display_name": { "zh": "桌宠大乱斗", "en": "Pet Brawl" },
  "description": { "zh": "...", "en": "..." },
  "icon": "icon.svg",                     // 包内相对路径；缺省系统生成
  "capabilities": ["app.storage.private", "overlay.spawn"],   // 能力声明（白名单词汇表见 §6）
  "network": { "domains": ["api.example.com"] },              // 出站网络白名单（默认空=禁网，url-app 必填，见 05）
  "dependencies": [{ "id": "com.daily.forum-api", "range": "^1.0.0" }],
  "pets": { "maxInstances": 10, "physics": "webview" },       // type=pet-layer 专属段（示例）
  "api": { "spec": "api.json" },                              // type=api 专属段（见 04）
  "url": { "startUrl": "https://example.com", "mode": "live" }, // type=url-app 专属段（见 05）
  "minShell": "0.1.0"                     // 需要的最低 Shell/服务端契约版本
}
```

校验规则：`id` 允许 Unicode 字母/数字/`. _ -`（沿用 APP_ID_PATTERN 放宽决策，排除路径分隔符与 `..`）；`version` 必须合法 semver；`capabilities`/`network.domains` 必须在词汇表内；schema 校验失败 = 注册失败并给出人话原因。

## 3. 包类型与执行引擎

| type | 内容物 | 执行/消费方 | 首支持 |
|---|---|---|---|
| `app` | HTML/JS/CSS 静态包（index.html 入口） | WebView 沙箱（PWA=iframe / Android=WebView） | 已有，M1 平移 |
| `pet-layer` | 场景 HTML（canvas/lottie）+ 行为参数 + 素材 | Android overlay-runtime（悬浮透明窗） | M2 |
| `api` | api.json（端点声明集） | 服务端代理 + pi 工具生成器 + 文档页（见 04） | **M2 核心** |
| `skill` | SKILL.md + references | 注入 pi skills（用户级 skills/ 目录，现有机制） | M2（包装现有能力） |
| `theme` | design tokens + 壁纸 + 模糊/动画参数 | Shell 主题引擎（校验后应用，可回退） | M2 |
| `toolpkg` | JS 工具包（QuickJS）+ 资源 + wasm（可选） | toolpkg 模块（端侧） | M2 |
| `mcp` | MCP server 声明（stdio/sse/remote + env 模板） | 服务端 MCP client | M2 |
| `workflow` | 触发器（定时/事件/语音预留）+ 步骤图 | 服务端调度 + 端侧前台服务 | M3 |
| `model-pack` | 模型文件（GGUF/TTS/ASR…）+ 元数据 | 对应 Provider（见 08） | M3 |
| `url-app` | manifest（startUrl + network 声明），可含离线快照 | WebView 沙箱（直连模式，见 05） | M2 |

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
```

新增能力词汇必须：登记 Broker + 写进本文 + 客户端/服务端两侧实现求交，缺一不可上线。

## 7. 安全与配额

- 静态校验拒绝清单：`<iframe src=>` 任意外链（url-app 走白名单）、`eval` 远程代码、混淆 base64 大块载荷、超配额（单包默认 ≤10MB，model-pack 另计）。
- 运行时：包文件 raw 端点继续免鉴权 + UUID 不可枚举（既有结论）；url-app 网络白名单由 app-runtime 的 `shouldInterceptRequest` 强制执行（05）。
- 用量计费：API 调用/房间流量/存储计入现有积分体系（04/06/09 分篇细化），**禁止**绕过审计与计费。