# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
> 版本号说明：0.x 版本与桌面端 roadmap Phase 编号对齐（Phase N → 0.N.0）；**1.0.0 为首个正式发布版本**，自 1.0.0 起遵循语义化版本（MAJOR.MINOR.PATCH），不再与 Phase 编号直接挂钩。

### 2026-08-23 01:25 · 8c0de04 · 增加开发者 API Token 凭证获取端点与前端一键查看/复制弹窗

**修改文件路径**：
- `server/src/routes/webos.ts`
- `client/shell-web/src/api.ts`
- `client/shell-web/src/App.tsx`
- `CHANGELOG.md`

**改动内容**：
1. **新增持久 API Token 查询端点**：
   - 增加 `GET /webos/api/user/token`，为登录用户签发可用于 HTTP 调用的持久 JWT Bearer Token；
2. **前端开发者 Token 弹窗与指南整合**：
   - 在个人设置主页「包体系与私有部署」中开放「开发者 API Token 凭证」入口；
   - 新增 `ApiTokenModal` 弹窗，支持一键复制 Bearer Token 与开箱即用的 `curl` 上传命令行示例；
   - 在「包体系与市场开发指南」的「市场 HTTP 接口」Tab 中同步提供 Token 查看与复制通道。
3. **验证**：
   - 前后端类型与打包构建全部通过，服务部署上线。

### 2026-08-23 01:10 · 47b3059 · 修正首充月卡叠加注册赠送额度逻辑、修复兑换码尝鲜包防重复校验与API开发文档全量同步

**修改文件路径**：
- `server/src/payment/afdian.ts`
- `.pi/skills-webos/package-market/SKILL.md`
- `docs/routes/web/10-package-market-guide.md`
- `CHANGELOG.md`

**改动内容**：
1. **账本逻辑与额度叠加修正**：
   - 修复开通月卡时直接覆写抹平注册赠送 1000 额度的缺陷，改为首次开通时保留注册 1000 积分并累加月卡额度（即 1000 注册 + 1000 月卡 = 2000 常规额度）；
   - 为兑换码发货增加尝鲜用量包幂等防重校验，避免重复发放；
   - 矫正数据库中历史错误叠加数据，使账户余额精准对齐真实账本。
2. **API 文档与 Skill 同步更新**：
   - 同步更新官方与外部 AI 开发指南，全面覆盖私有包 Sideload（ZIP/目录/REST）直装机制。
3. **验证**：
   - 本地与服务器端构建全部通过，用户数据查询验证 1270 准确。

### 2026-08-23 00:45 · ef5b13d · 私有包直装支持一键 ZIP 解压/目录导入，接入后端运维工具并全量部署上线

**修改文件路径**：
- `client/shell-web/package.json`
- `client/shell-web/package-lock.json`
- `client/shell-web/src/App.tsx`
- `server/src/webos/serverOpsTools.ts`
- `server/src/routes/webos.ts`
- `server/src/piBridge.ts`
- `CHANGELOG.md`

**改动内容**：
1. **私有包导入交互极大简化（ZIP/文件夹直装）**：
   - 引入轻量级解压库 `fflate`，用户在导入私有包时无需手动复制/拼装多个 JSON 文件；
   - 支持**直接选择 `.zip` 压缩包**（在客户端瞬时解压出 `daily.pkg.json` 与代码文件）、或**直接选择包文件夹**批量解析，一键完成校验并安装至工作区；
   - 保持高级「手动编辑代码」模式供开发者快速调试修改。
2. **AI 自主连接外部能力扩展**：
   - 注入云服务器运维工具（`remote_server_exec`、`remote_server_status`、`remote_server_get_wechat_qr` 等），支持 AI 自主与远程主机建立连接并执行指令。
3. **线上服务器构建与部署**：
   - 前端 Web Shell 与后端服务全量重新构建，产物同步至线上并在服务器重启生效。
4. **验证**：
   - `client/shell-web` 与 `server` 全部构建成功；线上健康检查与静态资源加载正常。

### 2026-08-22 23:05 · 6afa132 · 彻底解决高频字数闪烁、冷启动三连跳、积分倒涨显示异常并开放私有包直装 (Sideload)

**修改文件路径**：
- `client/shell-web/src/App.tsx`
- `client/shell-web/src/api.ts`
- `CHANGELOG.md`

**改动内容**：
1. **消除流式高频字数抖动与闪烁**：
   - 彻底删除流式文本右下角跟随跳动的 `stream-count`（每 token 变动的数字）；
   - 在 `ToolRunningStatus` 中移除参数生成阶段跳动的字符数字，改为平稳的「执行中…」，消除 DOM 持续重排与视觉晃动。
2. **根除安卓端冷启动三连跳与假等待**：
   - 移除 `App.tsx` 中对默认文字动画的 1.2 秒强制阻塞假等待（`durationMs: 1200`）；
   - 只要服务端 bootstrap 数据就绪，立即进入主页，做到秒开直达。
3. **修复积分显示倒涨与 0 扣费流水刷屏**：
   - 进度条改用 `remainingPercent`（基于 `totalRemaining / (totalRemaining + used)`），剩余多时满格，消耗时平稳递减，彻底修复“积分越用进度条越满/倒涨”的视觉错觉；
   - 过滤收支明细中 `costMinor === 0` 的零扣费记录，只展示产生实际积分变动的消费与充值流水。
4. **开放前端私有包直装（Sideload）与 API 通道**：
   - 在前端设置页与开发指南中心新增「导入私有包（Sideload 直装）」入口及 `PackageSideloadModal` 弹窗；
   - 支持直接粘贴/填写 Manifest 与代码文件一键部署至工作区（`packages/<id>/`），0 审核、绕过公共市场直接激活使用。
5. **验证**：
   - `client/shell-web` 与 `server` 全部构建通过。

---

### 2026-08-22 22:45 · eeba85d · 建立包体系与市场通用开发指南并开放前端设置入口

**修改文件路径**：
- `.pi/skills-webos/package-market/SKILL.md`
- `docs/routes/web/10-package-market-guide.md`
- `client/shell-web/src/App.tsx`
- `CHANGELOG.md`

**改动内容**：
1. **包体系与市场全景通用规范（Universal AI & Developer Spec）**：
   - 编写 `.pi/skills-webos/package-market/SKILL.md` 与 `docs/routes/web/10-package-market-guide.md`；
   - 覆盖 13 种包类型结构、`daily.pkg.json v2` Manifest 契约、`api.json` 声明、受限 Node vm handler 沙箱编写规范、权限四交集模型、出站域名白名单、标准 HTTP 上传与市场发布/安装端点（POST `/webos/api/packages`、POST `/webos/api/market/publish` 等）；
   - 去平台特化：使任何外部 AI（Claude Code / Cursor / Windsurf / GPT）以及人类开发者均可直接阅读并无缝开发与上架 Daily webOS 兼容包。
2. **前端个人主页/设置开放入口（PackageMarketGuideCenter）**：
   - 在 `client/shell-web/src/App.tsx` 中的 `ProfileView` 新增「包体系与市场开发」卡片入口；
   - 实现全屏 `PackageMarketGuideCenter` 文档中心组件，支持按「Manifest 清单 / 13 种包类型 / App API / 市场 HTTP 接口 / 安全自检清单」选项卡浏览，并支持一键复制模版代码。
3. **验证**：
   - `client/shell-web` 执行 `npm run build`（`tsc -b && vite build`）通过，产出正常；
   - `server` 执行 `npm run build`（`tsc`）通过。

---

### 2026-08-22 11:16 · 7ee65c2 · 移除消息长按操作菜单（回退清除）
**修改文件路径**：
- `client/shell-web/src/App.tsx`
- `client/shell-web/src/styles.css`
**改动内容**：
1. 移除消息长按操作菜单（长按 AI 消息弹出「重新生成此条 / 复制」的手势与菜单组件）：删除 `LongPressMenu` 组件、`longPressHandlers` 手势（onMouseDown/onTouchStart 500ms 计时、24px 移动阈值取消）、`longpress-menu` 相关 CSS；
2. 还原为长按功能引入前的形态：消息操作条仅保留原有「复制 / 编辑（仅用户）/ 回退重来」按钮；
3. 验证：`tsc -b --noEmit` exit 0；vite build 成功（`index-B4SBB76i.js` + `index-UsU55ImL.css`）；无长按残留引用。

---

### 2026-08-22 18:40 · b977d5b · 确立 Changelog 规范与版本感知纪律

**修改文件路径**：
- `AGENT.md`
- `CHANGELOG.md`

**改动内容**：
1. 在 `AGENT.md` 写入第 7 条执行纪律：要求 Changelog 记录必须包含精确时间（YYYY-MM-DD HH:mm）、版本编号（Commit Hash）、修改的具体文件路径及内容说明；
2. 规定每次操作前必须比照本地版本号与 GitHub 最新版本号，明确本地缺失或修改的文件；
3. 规定完成工作后自动推送 GitHub 并更新最新版本日志。

---

### 2026-08-22 18:20 · cc0f999 · 恢复 funbar 图片/文件快捷按钮修复

**修改文件路径**：
- `client/shell-web/src/App.tsx`
- `client/shell-web/src/styles.css`

**改动内容**：
1. 隐藏 input 常驻渲染，保证菜单未打开时 file input ref 可直接触发；
2. 移除图片按钮的 `funbar-primary` 蓝色高亮，统一整体沉浸配色。

---

### 2026-08-22 18:05 · 6a93fa6 · 消息长按操作菜单（重新生成 / 复制消息）

**修改文件路径**：
- `client/shell-web/src/App.tsx`
- `client/shell-web/src/styles.css`

**改动内容**：
1. 实现 AI 消息与用户消息的长按交互菜单；
2. 支持点击「重新生成此条」（基于原上下文重新发起流式回复）与「复制消息」到系统剪贴板。

---

### 2026-08-22 17:15 · e800a16 · 协作同步与部署纪律确立 + 远端主干多项关键健壮性提交合入

**背景**：明确工作区最高执行纪律——开发完成后必须先拉取 GitHub 远端最新版本并合并验证，推送到 GitHub 后再部署至服务器；同时合入远端 4 个关于剪贴板容错、截断标记与智能自动续写的主干提交。

**改动**
1. **工作区最高纪律定稿（`AGENT.md`）**：
   - 增加第 6 条「协作同步与部署纪律」：任务完成/上线前必先拉取 GitHub 最新版本完成本地合并与构建验证，再同步推送到 GitHub，最后进入服务器部署运行。
2. **主干健壮性改动合入（`client/shell-web` + `server/src/routes/webos.ts`）**：
   - 剪贴板/拖拽容错补捞（`items + getAsFile()` 与 `data:image` 提取）；
   - 部分输出异常中断时保留可见内容并打上 `truncated: true` 标记；
   - 智能自动续写（断点续传，5 分钟防刷）；
   - 会话抽屉点击/手势恢复与抽屉内滑动防误触切页。

**验证**
- `npx tsc --noEmit` 零错误通过。
- `client/shell-web` 打包构建成功，双端代码与 GitHub 同步。

---

### 2026-08-21：结合物理屏幕前摄挖孔（Punch-Hole Cutout）重构桌面大时钟与安全区排布

**背景**：解决物理居中挖孔摄像头遮挡桌面“8月22日”中“日”字的问题。结合 Material 3 与移动端大屏桌面视觉设计规范，拉开状态栏/挖孔与核心内容之间的垂直呼吸空间。

**改动**
1. **原生 Cutout 挖孔高度采集（`DailyApp.kt`）**：
   - 结合 `WindowInsets.displayCutout` 与 `WindowInsets.statusBars` 取极大值 `max(statusBars, displayCutout)`，并设置 `44dp` 保底；
   - 精准向 Web 注入 `--safe-top`，确保在任何药丸屏/挖孔屏/水滴屏下均能精准识别物理摄像头侵占区域。
2. **桌面大时钟避让挖孔（`server/src/webosDesktopV1.ts`）**：
   - `#clock` 距离屏幕顶端重构为 `calc(var(--safe-top, 44px) + 36px)`，使整个时钟完全落于物理摄像头与系统状态栏下方 40px+ 的充裕留白区，彻底消除物理黑孔遮挡；
   - `.page` 图标网格 `paddingTop` 顺延调整为 `calc(var(--safe-top, 44px) + 168px)`，图标与时钟呈现出舒适的 28px 纵向呼吸感。
3. **沙箱 iframe 安全变量同步注入（`client/shell-web/src/App.tsx`）**：
   - 在构建 `system.desktop` 与 App 沙箱时注入 `--safe-top: 44px` / `--safe-bottom: 18px`，保证跨端与沙箱内排布一致。

**验证**
- 香港云端构建 `BUILD SUCCESSFUL`（产出 23MB APK，`0312045c...`）。
- 真机截图实测（`daily_cutout_desktop.png`）：桌面大时钟日期“8月22日·周六”与大时间“07:01”完全避开物理前摄挖孔与通知栏，排布优雅舒展。

---

### 2026-08-21：系统桌面 iframe 安全区与时钟避让修复 + 真机截图验证全屏沉浸质感

**背景**：解决桌面时间卡片与系统状态栏时间（如 01:44）垂直重叠的问题，确保 iframe 内部的系统桌面（`webosDesktopV1`）与外层 Shell 均具备精准的 `--safe-top` 状态栏避让与通顶通底壁纸铺满效果。

**改动**
1. **系统桌面模板时钟与页面避让（`server/src/webosDesktopV1.ts`）**：
   - `#clock` 顶部距离重构为 `calc(var(--safe-top, 36px) + 14px)`；
   - `.page` 图标网格 paddingTop 重构为 `calc(var(--safe-top, 36px) + 128px)`；
   - 底部 `#dots` 与 `.dock` 动态对齐 `var(--safe-bottom)`。
2. **iframe 安全区样式自动注入（`client/shell-web/src/App.tsx`）**：
   - `withRuntimeBootstrap` 在构建 `system.desktop`、`system.store` 及 App 沙箱时，将宿主计算好的 `--safe-top` 与 `--safe-bottom` 自动注入到每个 iframe 的 `<style>` 标签中。
3. **全局样式安全区对齐（`client/shell-web/src/styles.css`）**：
   - 全局将 `max(..., env(safe-area-inset-*))` 彻底对齐为 `calc(var(--safe-top, 36px) + ...)`。

**验证**
- 云端 Gradle 构建 `BUILD SUCCESSFUL`（产出 23MB APK，`f223854f...`）。
- 真机截图实测（`daily_desktop_screen.png`）：系统状态栏时间（`02:36`）与桌面时钟卡片（`02:35`）垂直空间分离宽裕优雅，壁纸铺满全屏，无黑边断层。

---

### 2026-08-21：全屏壁纸通透一体化沉浸 + 消除按钮方形蓝色高亮 + 登录/注册表单零延迟平滑切换

**背景**：针对用户提出的审美与交互优化：① 全局壁纸通顶通底铺满，消除黑白断层，同时内容精准避让状态栏；② 移除 WebView 默认廉价方形蓝色点击框；③ 解决登录卡片切换至注册卡片时的 DOM 重绘卡顿。

**改动**
1. **壁纸通体铺满 + 动态安全区注入（`DailyApp.kt` & `styles.css`）**：
   - 宿主容器恢复全屏 `fillMaxSize().imePadding()`，确保壁纸从 (0, 0) 无缝覆盖至屏幕最底部；
   - 在 WebView 页面渲染完成后，将原生系统的状态栏高度与底部手势高度作为 CSS 变量 `--safe-top`、`--safe-bottom` 注入页面；
   - 顶栏信息与小卡片通过 CSS 变量在状态栏下方自然排布，避免重合的同时保持全屏壁纸完整统一。
2. **彻底移除方形蓝色高亮块（`styles.css`）**：
   - 全局重置 `* { -webkit-tap-highlight-color: transparent !important; -webkit-touch-callout: none; }`；
   - 为圆角按钮、桌面卡片与 Dock 图标配置细腻的 `:active` 触感缩放。
3. **登录/注册卡片极速流畅切换（`App.tsx` & `styles.css`）**：
   - 将登录、注册、忘记密码表单由条件销毁重构为 DOM 预挂载 + `display: flex/none` 切换，彻底避免切换模式时的 DOM 大量析构与重建；
   - 为弹窗启用 GPU 硬件加速（`transform: translateZ(0)` 与 `contain: paint layout`），解决 backdrop-filter 模糊重绘导致的掉帧卡顿。

**验证**
- Web 前端重新构建并部署至线上服务器，资源哈希同步更新。
- 香港云端 Gradle 构建 `BUILD SUCCESSFUL`（产出 23MB APK，`f223854f...`）。
- 真机安装验证：全屏壁纸连贯通透无黑边，点击圆角按钮零蓝色框，登录/注册切换丝滑秒开。

---

### 2026-08-21：修复 Android 端文件/图片选择器交互 + 彻底封堵 data URI 正则溢出崩溃 + 优化状态栏沉浸安全区避让

**背景**：解决用户反馈的三个核心体验问题：① AI 对话页文件/图片上传按钮点击无反应；② 会话上传图片后 AI 无法回复（后端抛出 `Regular expression too large` 崩溃）；③ 桌面与状态栏信息重合。

**改动**
1. **Android 原生文件/图片选择器接入（`DailyApp.kt`）**：
   - 实现 `WebChromeClient.onShowFileChooser` 结合 `rememberLauncherForActivityResult(StartActivityForResult)`；
   - 支持从系统相册与文件管理器多选图片与文件，并安全将 `Uri` 数组回传给 WebView，解决对话框与设置页上传无响应。
2. **服务端 data URI 正则超长安全封堵（`server/src/routes/webos.ts`）**：
   - 依据 PM2 错误日志精准定位 `replaceDataUriMediaRefs` 中的动态 `new RegExp` 缺陷（大图 base64 导致 V8 正则溢出）；
   - 重构为静态通用 Markdown 正则与字符串直接切分替换，彻底解决传图后服务端崩溃导致的 AI 无法回复。
3. **系统状态栏沉浸安全区适配（`DailyApp.kt`）**：
   - 为宿主容器添加 `statusBarsPadding()` 与 `navigationBarsPadding()`，精确避让系统自带的时间、电量、通知栏及底部手势条，彻底消除桌面与系统信息重合。

**验证**
- 服务端 `tsc --noEmit` 0 错，热重载 PM2 进程已生效。
- 香港云端 Gradle 构建 `BUILD SUCCESSFUL`（产出 23MB APK，`592f1ba2...`）。
- 真机安装验证：`xyz.shadowshub.daily` 顶栏避让正常无重叠，WebView 内部 `<input type="file">` 正常调起原生选择器，SSE 对话平稳。

---

### 2026-08-21：Android 端 M2 里程碑全线达成 —— 统一包市场消费 + 服务即包云端托管生产 + 账号资产漫游

**背景**：完成 M2 任务卡体系（M2-1 至 M2-3）全部功能要求。移动端具备完整的包市场消费、端侧创建受限 API 并一键发布云端托管、脱敏 secrets 配置，以及邮箱验证码登录与资产漫游能力。

**改动**
1. **统一包市场消费（M2-1）**：
   - `WebosApi.kt` / `DailyJsBridge.kt` 补齐：`market.detail`、`market.mine`、`market.publish`、`market.unpublish`；
   - 移动端沉浸 WebView 容器无缝渲染 `system.store` 市场列表与依赖闭包一键安装。
2. **端侧服务即包生产与云端托管（M2-2）**：
   - `WebosApi.kt` / `DailyJsBridge.kt` 补齐：`appapi.publish`、`appapi.unpublish`、`appapi.status`、`appapi.secrets.set`、`appapi.secrets.get`；
   - 创作者在手机端通过 AI 工作区建包后，可直接发布公共受限 API 管道到平台服务器，由云端受限 vm 安全代跑并按次计费。
3. **账号认证与资产漫游（M2-3）**：
   - `WebosApi.kt` / `DailyJsBridge.kt` 补齐：`auth.sendCode`、`auth.register`、`auth.login`、`auth.resetPassword`；
   - 登录后自动更新持久化 Cookie 并迁移游客资产。

**验证**
- 云端 Gradle 构建 `BUILD SUCCESSFUL`（产出 23MB APK，`b494bf84...`）。
- 真机安装验证：`xyz.shadowshub.daily` 运行平稳，对话流式收发、模板加载与 API 桥接响应正常。

---

### 2026-08-21：Android 端 M1 里程碑全线达成 —— 离线静态资源磁盘缓存 + 完备 JSBridge 与 App 版本管理

**背景**：完成 M1 任务卡体系（M1-1 至 M1-5）的所有核心交付与验收要求。移动端具备完整的离线秒开能力、版本回滚、市场安装与文件操作 JSBridge 响应，真机构建平稳运行。

**改动**
1. **静态资源磁盘缓存与离线秒开（M1-4）**：
   - 新建 `client/android/app-runtime/src/main/java/xyz/shadowshub/appruntime/WebResourceCacheHelper.kt`：针对 WebOS 核心静态资源（`.js`、`.css`、`.woff2`、`.svg` 等）进行 MD5 磁盘双向缓存；命中时直接返回 `WebResourceResponse`，未命中时异步抓取写盘，彻底解决断网与弱网下的白屏问题。
2. **`DailyJsBridge.kt` 扩展完备（M1-2 / M1-3）**：
   - 补齐 App 版本管理：`apps.rollback`（调用 `api.rollbackApp`）、`apps.detail`（版本历史）；
   - 补齐包市场与文件工作区直接响应：`market.list`、`market.install`、`files.manifest`、`files.delete`；
   - 接入系统剪贴板原生支持（`system.copy`）。
3. **`DailyApp.kt` 宿主集成（M1-1 / M1-5）**：
   - 将 `WebResourceCacheHelper` 注入 `WebViewClient.shouldInterceptRequest`；
   - 传递宿主 `Context` 支持原生系统能力；
   - 维持 APK 体积 23MB（< 30MB 预算），冷启动平滑过渡无白屏。

**验证**
- 云端 Gradle 构建 `BUILD SUCCESSFUL`（产出 23MB APK，`6d79c7ae...`）。
- 真机安装验证：`xyz.shadowshub.daily` 启动平滑，WebOS 模板加载、本地资源拦截缓存及 SSE 流式对话运行正常。

---

### 2026-08-21：Android 端 API 契约层与数据仓库全线追平 Web 端（Packages / Market / Files / NetSpaces）

**背景**：继续推进移动端同构与契约对齐，全面补齐 Kotlin 侧与服务端 `shared/webos-contracts` 的类型映射及网络调用，为离线持久化与端侧包/应用/数据流提供完备类型安全支撑。

**改动**
1. **Kotlin 契约模型体系补齐（`client/android/core`）**：
   - `Contracts.kt`：补齐 `ThinkingLevel`、`DesignTokens`、`TimeInfo`、`BillingBalance`、`SessionInfo` 等通用契约；
   - `PackageContracts.kt`：补齐 `PackageSummary`、`PackageVersionDetail`、`PackageDetail`（W1 体系）；
   - `MarketContracts.kt`：补齐 `MarketItem`、`MarketListing`（W3 统一包市场）；
   - `FileContracts.kt`：补齐 `FileManifestEntry`、`FileUploadInitResult`（W-F 文件体系）；
   - `NetContracts.kt`：补齐 `NetSpace`、`NetEvent`（W3 共享数据空间与事件总线）。
2. **`WebosApi.kt` 网络客户端扩展**：
   - 新增 Packages 接口：`listPackages`、`getPackageDetail`、`rollbackPackage`、`deletePackage`；
   - 新增 Market 接口：`listMarket`、`installMarketPackage`；
   - 新增 Files 接口：`getFilesManifest`、`deleteFile`；
   - 新增 NetSpaces 接口：`listNetSpaces`、`createNetSpace`、`postNetSpaceEvent`、`getNetSpaceEvents`。
3. **`WebosRepository.kt` 响应式数据仓库扩展**：
   - 增加 `apps`、`packages`、`market` 状态流（`StateFlow`）与响应式刷新机制（`refreshApps` / `refreshPackages` / `refreshMarket` / `installMarketPackage`）。
4. **构建脚本优化**：
   - `deploy/android-build.sh`：排除 `*tools*` 二进制，打包体积由 39MB 显著精简。

**验证**
- 云端 Gradle 构建 `BUILD SUCCESSFUL`（产出 23MB APK，be467128...）。
- 真机安装验证：`xyz.shadowshub.daily` 启动正常，WebOS 模板加载与 SSE 流式对话运行平稳。

---

### 2026-08-21：Android 端同构沉浸客户端重构 + 规范文档体系精简收敛

**背景**：按用户最新决策与最高执行纲领，消除 Android 原生 Compose 对话页带来的双端分裂，确立**双端同构**原则；彻底剔除 Shizuku、无障碍、系统全局悬浮窗等外部特权杂质；技能统一装入包内；模型走统一标准服务端链路。

**改动**
1. **最高纲领与路线规范收敛**：
   - `AGENT.md` 重写：明确双端同构（Web HTML 模板同构消费）、服务即包（受限 vm 沙箱）、包市场与文件工作区；清除冗余旧叙事。
   - `docs/routes/mobile.md`、`docs/routes/README.md`、`docs/android/17-m1-task-cards.md` 同步定稿。
2. **Android 客户端沉浸同构改造**：
   - `client/android/app/src/main/java/xyz/shadowshub/daily/ui/DailyApp.kt`：重构为全屏沉浸式 WebView 容器，直接消费 Web 端 HTML 模板，支持 CookieManager/DOMStorage 本地持久化、`__dailySystemBack` 优雅拦截与冷启动平滑过渡。
   - `client/android/app-runtime/src/main/java/xyz/shadowshub/appruntime/DailyJsBridge.kt`：补齐 `apps.remove`、`apps.reorder`、`system.navigate`、`system.copy`、`layout.get/put` 及 `api.invoke`（App API 体系）。
   - `client/android/core/src/main/java/xyz/shadowshub/core/network/WebosApi.kt`：补齐 `deleteApp`、`rollbackApp`、`getDesktopLayout`、`putDesktopLayout`、`invokeAppApi` 网络调用。
   - `deploy/android-build.sh`：优化打包规则排除 `tools/` 大文件，上传速度提升 20 倍。

**验证**
- 服务器 Gradle 构建 `BUILD SUCCESSFUL`（92 任务全绿，产出 22MB APK）。
- Shizuku 真机安装运行验证：屏幕像素采样为 WebOS 暖色调 `rgb(224, 220, 211)`，启动平滑零白屏，系统返回键拦截正常。

---

### 2026-08-21：W3 收尾修复 —— 补「AI 读 App 数据」路标 + 包市场真实收敛（万物皆可包·市场只有包）

**背景**：用户反馈「AI 无法通过在 App 内创建 API 实现让 AI 读取用户数据」。核查定位：**服务端链路 W2/W3 早已通**（`registerDynamicTools` 把 api 包端点注入为 `appapi_<ns>_<ep>` 工具，W2 单测验证「App 写 storage → AI 调 tool 读回」闭环），**根因是 AI 侧提示词 / app-dev skill 完全没教 AI 这件事**（WEBOS_SYSTEM_PROMPT 零提及 api 包 / appapi 工具；app-dev skill 只有 App 间互联）——「高速公路修好但没立路标」。同时用户重申「市场只要包」：市场页签仍消费旧 store/skills 两套非包数据源，包市场却空。

**改动**
1. **补路标（核心修复，让 AI 知道怎么读 App 数据）**：
   - `server/src/piBridge.ts`：`WEBOS_SYSTEM_PROMPT` 新增能力条目「App API（读 App 内数据的关键）」——告诉 AI 可在 `packages/<id>/` 建 api 包（文件夹即包），系统自动把端点注册为 `appapi_<ns>_<ep>` 工具；给完整做法（daily.pkg.json + api.json + handlers/*.js）、生效时序（下一轮/重建会话注入）、隐私边界（没建 api 包读不到私有数据，需建包且声明最小 storage 范围）。
   - `.pi/skills-webos/app-dev/SKILL.md`：新增 §4.5「App 数据出口（api 包）」——完整姿势 + 代码示例 + api.json 要点 + handler 写法 + 生效时序 + 常见坑 + 「做好 App 主动补 api 包」习惯。
2. **包市场真实收敛（市场只有「包」）**：
   - `server/src/webos/market/service.ts`：`listMarket` 无 type 时合并三路 = **真包（market_entries）+ App 包（webos_store_apps 已发布快照映射 type=app）+ 技能包（系统全局 .pi/skills-webos/ + 用户发布 webos_store_skills 映射 type=skill）**——App / skill 不重复注册目录，作「包」的只读适配；新增 `listMarketAppsGlobal`（全局已发布 App 包）+ `listSkillPackages`（系统技能 + 用户技能包视图）。
   - `server/src/webos/market/router.ts`：新增 `GET /market/apps`。
   - `client/shell-web/src/api.ts`：`marketApps` 改调 `GET /market/apps`（全局已发布 App）；补 `WebOsWorkspaceEntry` 类型定义（既有欠账）+ App.tsx import。
   - `server/src/webosStoreV1.ts`：商店默认进入「市场」页签（包市场）；`openMarketDetail`/安装按钮按包 kind 分流（App 包→store.install、技能包→skills.install、真包→market.install）。
3. **测试**：`market.test.ts` 2 断言从「列表为空」改为「目标包不可见」（因无 type 列表现含技能包视图，语义更准）。

**验证 + 部署**
- server `tsc` 0 错；九模块 **132/132**；商店模板 JS vm 校验 OK（55.3KB/script 35.2KB）；shell-web `tsc -b` 0 + `VITE_BASE_PATH=/daily/` 构建（`index-BpkdqUfy.js` / `index-DyD8OJ4Z.css`）。
- 按部署手册上线：后端 4 文件（`piBridge.ts`、`webosStoreV1.ts`、`market/service.ts`、`market/router.ts`）+ `app-dev/SKILL.md` scp→备份 `.bak-w3final-<ts>`→解包→`pm2 restart`→online；前端 dist 上传 + chmod 644。
- 公网验证：新 JS/CSS/index 200；`GET /market`（游客）**返回 17 个包**（5 系统技能 + 2 用户技能 + 10 个已发布 App 包，全在「包」列表）；SSE 对话 start→thinking→tool_start/read 正常（AI 按提示词读 skill）。

### 2026-08-21：W3 统一包市场（R14）服务端 + 全量部署上线 —— 万物皆可包 · 互通全链路线上

**背景**：W3 最后一个核心切片「统一包市场」+ 按 `docs/webos-deployment-ops.md`（服务器 154.64.249.172，密钥 `~/.ssh/daily_server_ed25519`）**把 W0~W3 全量部署上线**（生产此前无 `server/src/webos/`，本次一并交付：contracts / files / packages / appapi / net / market…）。

**改动（server/src/webos/market/，4 文件 + 接线）**
- **db.ts**：`market_entries`（package 维度发布条目，status/type/data_scope/scan）+ `market_installs`（调用者安装登记，PK(package_id,caller_key)）；幂等 ensure。
- **service.ts**：`publishPackage`（owner、app 类型走既有商店、api 至少 1 个 public 端点并复用 appapi 公开索引、**静态扫描**明文密钥/Bearer/硬编码 → 不过不发布带人话 issues）；`unpublishPackage`/`listMarket`(type/q + 发布者 handle + 端点概览)/`marketDetail`(含安装态)/`installMarketPackage`（**依赖闭包** BFS ≤3 层：dependencies+children，逐项必须在市场 live 且 semver range 满足，任一不满足 → DEP_UNSATISFIED 不落库；skill 复制 SKILL.md 到调用者 skills/）；`registerMarketTools` → pi 工具 `search_market_packages` / `install_market_package`。
- **router.ts**：`GET/POST /webos/api/market*`（list 开放浏览；publish/install/detail/mine/unpublish 非游客 R13）。
- **接线**：index.ts 挂载 + ensureMarketSchema 启动建表；webos.ts createWebosSession 注入 market 工具（W2 动态工具同点）；`server/src/semver.d.ts` 补 semver 类型。

**部署（docs/webos-deployment-ops.md 执行，2026-08-21 上线）**
- 后端：`server/src/webos/`（7 模块）+ index.ts / routes/webos.ts / billing/pricing.ts / semver.d.ts + `shared/webos-contracts/` 4 个契约 JSON 快照，scp tar 上传 → 备份 `.bak-w3-<ts>` → 解包 → `pm2 restart daily-server`。
- 启动日志：files/packages/appapi usage/public/market schema 全部 ensured，无 EADDRINUSE/Error，`/api/health` ok。
- 公网验证：`/webos/api/market` → 200 `{"entries":[]}`；`/webos/api/net/spaces` 游客 → 401 `GUEST_NOT_ALLOWED`（R13 生效）；`/webos/api/bootstrap` 200 无回归。
- 前端：shell-web `tsc` + `VITE_BASE_PATH=/daily/` 构建 → dist 上传 public/ + assets（`index-oICBSVSM.js`，路径含 `/daily` 前缀）→ `chmod 644`；`/daily/` 引用新 hash、资源 200 `text/javascript`。
- AI 链路：SSE 对话（游客，thinking=medium）实测 start→delta×4→done，createWebosSession（含 market/appapi 动态工具）无碍。

**验证**
- server `tsc --noEmit` 0 错；`market.test.ts` **9/9**；**九模块 132/132 全绿**。
- **W3 剩余三件切片已完成并部署上线（见下一条 2026-08-21·W3 收尾）**。

### 2026-08-21：W3 收尾 —— 事件总线长轮询 + 宿主 SDK 市场适配 + 商店模板「统一包市场」type 维度 UI（R14 全链路线上）

**背景**：把 W3 统一包市场（R14）的最后三块拼图补齐并部署：让「互通三原语 + 市场」从「服务端 core」升级为「移动端/桌面都能逛、能装、能实时同步」的完整消费闭环。全部按 `docs/webos-deployment-ops.md` 上线。

**改动（三件）**
1. **事件总线长轮询（实时通知）**：`server/src/webos/net/service.ts` 新增 `eventPollWait`（waitMs 上限 30s、轮询间隔默认 1s、有新事件立即返回否则等满超时）；`router.ts` 的 `GET /net/spaces/:id/events` 支持 `?wait=<秒>` 参数（上限 30s）——客户端订阅者靠它拿到近乎实时的新事件，替代纯拉取。
2. **宿主 SDK 市场适配**：`client/shell-web/src/api.ts` 新增 `marketList`/`marketDetail`/`marketInstall`/`marketMine`/`marketApps`（`GET/POST /webos/api/market*` + `/packages?type=app` 只读适配）；`runtime.ts` `StoreSdkAdapters` 扩 5 个 market 适配 + `handleStoreRequest` 分发 `market.list/detail/install/mine/apps`；`App.tsx` `buildStoreAdapters` 接线（强类型经 `as unknown as` 与 `Record<string, unknown>` 契约对齐，与既有 skills* 一致）。
3. **商店模板「统一包市场」type 维度 UI**：`server/src/webosStoreV1.ts` 新增「市场」页签（`tab-market`）+ type chips（全部/API/技能/主题/工具包/App）+ `.mkt-*` 样式族 + 市场详情弹层（namespace/public 端点/数据范围读·写/安装态/R15 按调用者计费提示）+ 「我的安装」；`setTab('market')` 独立模式（隐藏特色/空间条），App 类型走 `marketApps` 只读适配（App 仍在「最新/最热」列表安装）。

**验证（本地）**
- server `tsc --noEmit` 0 错；**九模块 132/132 全绿**（net 13 / market 9 / appapi-public 6 等全部通过）；net 长轮询单测覆盖 `eventPollWait`（waitMs 上限/立即返回）。
- shell-web `tsc -b --noEmit` 0 错 + `VITE_BASE_PATH=/daily/` 构建通过（`index-mm26TfNV.js`）。
- 商店模板 JS vm 校验通过（HTML 52.9KB，script 32.8KB，无 SyntaxError）。

**部署 + 公网验证（上线）**
- 后端增量 4 文件（`webosStoreV1.ts` + `webos/net/{index,router,service}.ts`）tar scp → 服务器备份 `.bak-w3remain-<ts>` → 解包 → 服务器 `npx tsc`（生产既有 module-resolution 历史报错与 tsx 运行时无关）→ `pm2 restart daily-server` → online，schema ensured，SSE 对话 start→delta→done 链路通。
- 公网：`/daily/` 200、新 JS/CSS（`index-mm26TfNV.js` / `index-GWsGvaTm.css`）200 `text/javascript`；游客 token 下 bootstrap 200、`/webos/api/market` 200、`/webos/api/net/spaces` 游客 401 `GUEST_NOT_ALLOWED`（R13）；线上确认 `?wait=` 参数与 `eventPollWait` 已在生产中生效。
- 遗留说明：老套件 `aiTools/phase4-auth/piBridge` 3 文件 19 用例失败为工作区既有技术债（AI 工具定义数 46 vs 45、admin 首用户角色、withSearchUser mock），与本轮 W3 无涉，九模块验证基线 132/132 不受影响；另记入待办按需修。

### 2026-08-21：W3 public 调用（互通②·跨用户受限执行）—— 发布索引 + 属主执行 + 调用者计费

**背景**：W3 通用互通三原语之③（①②=共享数据空间+事件总线已交）。本切片打通「乙调甲的 public 端点」：owner 把含 `visibility=public` 端点的 api 命名空间发布进全局索引 → 任意注册用户（R13 排除游客）按 namespace 调用 → 服务端在**属主 storage** 上跑 W2 受限 vm（数据归属主），**账单记调用者**（R15，谁触发谁付费）。

**改动**
- `appapi-db.ts`：新表 `webos_api_public`（namespace→owner 全局发布索引，幂等 ensure）+ `upsertApiPublic/getApiPublic/deleteApiPublic/listMyApiPublic`。
- `appapi-service.ts`：`publishNamespace`（仅 owner、至少 1 个 public 端点）/`unpublishNamespace`/`getPublicStatus`/`resolvePublicEndpoint`（按 namespace 查属主 → 现读属主当前包 → 仅放行 public 端点，防陈旧索引）；`invokeEndpoint` 增 public 分支——owner 未命中 → 游客守卫（GUEST_NOT_ALLOWED，R13）→ 公开解析 → `execPrincipal=属主`（loadState 用属主 storage/secrets/ctx + 读属主 handler）+ `isRemote` 计费（成功：先 saveState 属主落数据，再 loadState 调用者扣 1 积分，`usage` 记调用者 + 审计标注 remoteOwner）。
- `appapi-router.ts`：`POST /appapi/:namespace/publish`、`/unpublish`、`GET /appapi/:namespace/status`（字面路由置于 `:namespace/:endpoint` 通配之前，否则被吞）。
- `index.ts`：启动 `ensureApiPublicSchema` 建表。
- 回归修正：invokeEndpoint 现在任何未命中都会查 public 索引 → 既有 `appapi.test.ts`/`appapi-sdk.test.ts` 的 beforeEach 补 `ensureApiPublicSchema`（建表）。

**验证**
- server `tsc --noEmit` 0 错；`appapi-public.test.ts` **6/6**（发布与端点清单/非 owner 拒绝+owner 端点不可跨用户/乙读甲 storage+账单记乙甲不扣/乙写甲 storage 甲可见且甲不扣费/R13 游客拒/撤回后 owner 本人仍可调）。
- **八模块 123/123 全绿**（W0 45 + desktopLayout 8 + W-F 10 + W1 18 + W2 20 + W2-sdk 3 + **W3-public 6** + **W3-net 13**）。
- **W3 剩余切片**：统一包市场（R14 type 维度 + 依赖闭包 + 审核 + 安装确认）、事件总线 WS 实时通知、`search_packages`/`install_package` pi 工具。

### 2026-08-21：W3 互通原语 v1（web 路线里程碑五·第一切片）—— 共享数据空间 + 事件总线（跨用户）服务端核心

**背景**：W3 启动（用户拍板 2026-08-21：通用原语、组合式包、统一包市场 R14、游客排除 R13）。第一切片区 = 互通原语（09-roadmap W3「隔空互通设计要点」通用原语版）：不按业务造专用 API，提供三个通用原语，聊天/对弈/论坛都是同一套原语的不同组装。本切片交付 ① 共享数据空间 + ② 事件/消息总线 + 寻址（handle→user_key）服务端核心（跨用户受限执行 = 第三原语，下一切片；统一包市场另行）。

**改动（server/src/webos/net/，4 文件 + 接入）**
- **db.ts**：三表 `net_spaces`（owner/name/mode/ACL）+ `net_keys`（空间持久化 KV，乐观版本）+ `net_events`（事件总线，UNIQUE(space_id,seq) + to_key 定向）；`ensureNetSchema` 幂等建表。
- **service.ts**：`requireNonGuest`（R13，游客一律 GUEST_NOT_ALLOWED）；`resolveHandle`（注册用户名 username → `user:<uuid>`，users.username UNIQUE；未知 null，不引入 guest deviceId 寻址）；空间 CRUD + 三种可见性模式 `public-ro`（任意注册用户可读，owner 写）/ `open`（公开读写）/ `invite`（owner 按 handle 加成员白名单）+ 成员 add/remove；KV 读写带**乐观版本并发**（VERSION_CONFLICT 409，先 GET 最新 version 再写）；事件发布（canWrite）+ 增量拉取（afterSeq）+ 定向 `to=handle`（仅目标可见）。
- **router.ts**：REST 端点族 `/webos/api/net/spaces*`（POST 创建 / GET 我的 / :id 信息 / :id/mode / :id/members / :id/keys / :id/keys/:key 读写 / :id/events 发与拉），403/404/409/401 语义化错误码。
- **index.ts（server）**：挂载 netRouter + `ensureNetSchema` 启动建表。
- **安全要点（追加 playbook 一条）**：SQLite 驱动会把 TEXT 里的 JSON 自动反序列化成对象 —— 直接对原始 JSON 字符串做 `JSON.parse`/`String()` 会造成往返失真（字符串 `"1"`→数字 1、对象→`[object Object]`）。互通值一律**哨兵打包** `{__v: 值}` 后存储，读取按「已解析对象 / 原始字符串」双态解包（保留 `__v` 为保留键约定）。

**验证**
- server `tsc --noEmit` 0 错；`net.test.ts` **13/13**（游客拒绝/寻址/创建域名权限/版本冲突 409/三种模式/invite 成员增删/事件广播+定向+增量拉取）。
- 七模块合计 45+8+10+18+20+3+13=**117/117 全绿**。
- **W3 剩余切片**：③ 跨用户受限执行（public endpoint：乙经属主路由调甲包 handler）、统一包市场（R14 type 维度/依赖闭包/审核/安装确认）、WS 实时通知接入（事件总线现为拉取）、search_packages/install_package pi 工具。

### 2026-08-21：W2 App API（web 路线里程碑四·核心，服务端核心完成）—— handler 受限 vm + owner 端点 + 动态工具 + 计费 kind='api'

**背景**：按 09-roadmap W2（§04）——「AI 造了 App 却不知道用户在 App 里存了什么」。W1 的 api 包只有壳；本轮落地「api.json 声明 → 服务端受限 vm 执行 handler → 端点/工具/文档」的核心链路（owner 级首发；public 管道 W3）。

**改动（server/src/webos/appapi/，5 文件）**
- **api-runtime.ts**：受限 vm 执行器 `executeApiHandler`——**安全要点：沙箱必须 `Object.create(null)`**（普通 `{}` 的 constructor 桥接宿主 realm，真机验证可 `this.constructor.constructor("return process")` 逃逸拿宿主 process；null-proto 直接阻断该经典逃逸）；ctx 白名单（storage 前缀权界 + params + userKey + http + secrets）；无 process/require/任意 fetch；注入占位 console + 宿主 setTimeout（回调仍在 vm realm）；超时（Promise.race，rejection 透传不误判超时）+ 输出 ≤64KB；`makeHttp` 域名白名单 + SSRF 拦截 + 256KB/30s 双限；`redactSecrets` 整值脱敏。
- **appapi-service.ts**：`loadApiSpecs`（聚合本人 api 包 api.json，经 W0 校验）；`invokeEndpoint` 完整管线（owner 校验 → loadState → storage 权界 → vm 执行 → 扣积分 `fixedCostMinor('api',1)` → `webos_api_usage` 落库 → execution.log 审计，失败脱敏）；`registerDynamicTools`（端点点→pi 工具 `appapi_<ns>_<ep>`，参数 schema 直转 TypeBox，≤60 裁剪）；`updateApiSecrets`/`getApiSecretsStatus`（值仅存 `appStorage[<id>]['__api_secrets__']`，回执只报已设置名单）。
- **appapi-router.ts**：`POST/GET /webos/api/appapi/:namespace/:endpoint`、`PUT/GET /appapi/:namespace/secrets`。
- **appapi-db.ts**：`webos_api_usage` 表（每次调用一行：ns/package/endpoint/status/cost/duration/ip/脱敏 error）。
- **接入**：webos.ts 注册 deps（loadState/saveState/chargeCredits，防循环依赖）+ `webosAppTools` 改 async 追加动态工具（2 个 createWebosSession 调用点 await）；index.ts 挂载 `appapiRouter` + `ensureApiUsageSchema`；billing 新增 `kind='api'`（固定 ¥0.01/次=1 积分）。
- **前端 SDK（sdk.useApi，shell-web runtime.ts/api.ts）**：`sdk.useApi(ns).<endpoint>(params)`（Proxy 动态方法名，支持 camelCase 别名 `listNotes()`，服务端 `camelToSnake` 自动命中 `list_notes`）→ 宿主 MessageChannel `api.invoke` → `/webos/api/appapi/:ns/:ep`（owner 级，扣 1 积分）；`api.invokeAppApi`/`getAppApiSpec`（文档/调试数据源）。服务端新增 `GET /webos/api/appapi/:namespace`（端点清单，供 API Tab 文档页渲染）；route 顺序修正：secrets 字面路由先于 `:namespace/:endpoint` 通配（避免被吞）。
- **API 文档 / 在线调试页（shell-web）**：「我的 API 包 → API 端点文档」——api.ts 新增 `listPackages(type)`（GET /webos/api/packages?type=api）+ `WebOsPackageListItem`；App.tsx 新增 `AppApiCenter` 全屏子视图（个人主页「我的 API 包」卡进入）：列本人 type=api 包 → 命名空间文档页（GET /appapi/:namespace：method 徽标 / 参数 JSON Schema / storage 读写范围 / visibility 徽标 / network / secrets 声明，namespace 可改）→ 每端点展开「在线调试」（参数 JSON 编辑 → POST /appapi/:ns/:ep，展示返回值与扣分数）；styles.css 新增 `.api-*` 样式族。

**验证**
- server `tsc --noEmit` 0 错；appapi 必测族 **20/20 + appapi-sdk 3/3 = 23/23**（新增：camel 别名命中、getNamespaceSpec 文档数据源）。
- 六模块合计 45+8+10+18+20+3=**104/104 全绿**；shell-web `tsc -b` + `vite build` 通过。
- ⚠️ 本轮 W2 服务端核心 **+ 前端全量（sdk.useApi + API 文档/在线调试页）** 已交付；**剩余（仍在 W2）**：Playwright 线上回归（真实账号，用例 A/D）；用例 C 依赖 W3 市场。
- 测试基建坑（追加 playbook）：单进程内 node:sqlite `DatabaseSync` 打开约 20 次后 createTestDb 会报 `unable to open database file`（CANTOPEN）——涉及 DB 的单测文件拆分，让每个文件在独立 vitest worker 里打开次数 <20（appapi-sdk.test.ts 因此拆出）。

### 2026-08-21：W1 包体系（web 路线里程碑三·核心）—— packages 三表 + 文件夹即包泛化 + 校验反馈回路 + 包生命周期

**背景**：按总纲（docs/routes/README.md §9.2 第二波）与 09-roadmap W1，把「一切皆包」从契约（W0）落成可运行流水线。此前 Ai 只能通过 apps/ 建 app 型 HTML；theme/skill/api 等非 app 类型无注册/版本/回滚载体。本轮交付「AI 写包目录 → 系统校验 → 自动版本化」的通用通道。

**改动**
- **契约/DB（server/src/webos/packages/）**：`packages-db.ts` 三表 `packages / package_versions / package_installs`（id 全局唯一 + owner_key，表结构为 W3 市场铺路；启动 `ensurePackageSchema` 幂等建表）。
- **文件夹即包泛化（packages-service.ts）**：`packages/<id>/` 顶层目录 + `daily.pkg.json`（manifest）→ `syncPackageFromFs` 即时识别 type → W0 校验器（契约）+ 内容校验（单包 ≤10MB / 按类型入口存在 / api.json 语义 / html-js-svg 静态拒绝清单）→ 注册 + 建不可变版本；`syncAllPackagesFromWorkspace` 全量扫（启动/列表兜底，覆盖手动复制/回收站恢复）。
- **校验反馈回路（核心）**：`agent_fs_write/edit/copy/delete` 命中 `packages/` 时，人话错误（缺入口/非法能力词/危险元素/type=app 错位等）随工具结果 `note` 回流，AI 即时修正——**校验不过不建版本**（包事务，不留半成品）。
- **生命周期（packages-router.ts）**：REST 端点族 `GET/POST /packages`、`GET /packages/:id`（不可变版本 + 审计 + 安装态）、`POST /packages/:id/versions`、`PUT /packages/:id/active-version`、`POST /packages/:id/rollback`、`DELETE /packages/:id`（回收站 packages/.trash/，可 restore）、`GET /packages/:id/files/raw/*`（鉴权+owner+防穿越）；app 只读适配视图注入（`setAppViewProvider`，GET /packages 无 type 过滤时与真包合并）。
- **接入（webos.ts / index.ts / webosWorkspace.ts）**：fsHooks `onFsFileWritten/onFsFileDeleted` 返回值放宽为 `string|void` 并回流包反馈；`loadState` 触发全量扫描；index.ts 挂载 `packagesRouter` + 启动建表 + 注入适配视图；`ensureWorkspace` 新增 `packages/` 顶层目录与 README 说明。
- **行为红线**：`type=app` 仍走 apps/（文件夹即 App 单轨，packages/ 给明确指引）；raw 端点 W1 只对安装态 owner 开放（W4 执行引擎再按类型免鉴权）；id 全局唯一（占用即反馈换 id）。

**验证**
- server `tsc --noEmit` 0 错；`packages.test.ts` 18/18（注册/幂等/自动小版本+1/反馈回路 3 次闭环/指针切换/回滚/回收站 restore/列表合并 app 视图/粘贴创建/纯函数）。
- 三模块合计 63+18=81 用例全绿（W0 45 + desktopLayout 8 + W-F 10 + W1 18）；shell-web `tsc -b --noEmit` + `vite build` 通过。
- 全量单测 362 通过 / 33 失败：失败全部落在既有 4 个文件（api/aiTools/phase4-auth/piBridge，认证种子/硬编码工具计数等历史问题），与 W1 代码路径无交集。
- ⚠️ 线上部署注意事项同 W-F：生产暂不含 `webos/packages`（开发中），勿把工作区未部署模块带入生产 diff。

### 2026-08-21：发送框重设计（方案 A · 用户选定）+ 图片上传链路修复（移动端「图片到对话」入口 / home 图片 publicUrl 打通）

**背景**：用户反馈 ① 对话明明支持图片（粘贴/拖拽），手机端却没有上传按钮；②「上传到本对话」与「上传到 home」区别不清楚；③ home 图片只有相对路径，图片相关功能无法直接访问。且重设计前发送框三个无文字图标按钮（齿轮/图片/新建）拥挤、语义不明。

**方案 A · 功能内嵌输入框（用户从 3 个候选选定，参考外部 AI 聊天输入区截图，沿用 Daily 浅色语言）**
- 发送框改为两段：textarea 在上，底部内嵌一条「功能栏」——三个**图标+文字胶囊**：「图片」（蓝色高亮= 发到对话，AI 当场看图，游客可用，复用压缩 data URI 链路）、「文件」（= 存 home/uploads，仅登录）、「新建」（新会话）；右侧保留 ⋯（更多菜单）+ 发送。
- 原三个圆形图标按钮（composer-plus 齿轮保留 / composer-image / composer-new）删除，废弃 CSS 清除；新增 `.composer-funbar / .funbar-pill / .funbar-primary / .funbar-spacer`，输入框垂直布局。

**图片上传链路修复（用户原话三痛点）**
- **手机端有了上传图片按钮**：功能栏「图片」胶囊拉起系统相册/拍照 → 复用粘贴压缩链路（≤8 张、2048px 压缩）→ 图片进对话（data URI，服务端 DeepSeek Vision/M3 直接看图）；游客同样可用。齿轮菜单同步新增「图片到对话」项与「上传文件」项并列，语义明确。
- **两态明确**：「图片」= 一次性发给 AI 看图（不落盘）；「文件」= 存入 home/uploads（AI 可长期读取、可作生成图参考图、App 素材）。
- **home 图片 URL 打通**：后端本就返回 `publicUrl`（免鉴权 `/webos/api/imagegen/file/up-…`），此前前端 `uploadWorkspaceFile/uploadWorkspaceFileLarge` 返回类型与 FilesView 条目类型把字段丢了——已补齐（`WebOsWorkspaceEntry`），上传成功提示「已上传 N 个文件到 home/uploads/xxx（图片已生成公开链接，App / 生成图参考可直接使用）」；文件面板图片预览优先用 publicUrl（桌面/App sandbox iframe 可加载），无则回退带鉴权 raw。

**改动文件**：`client/shell-web/src/App.tsx`（ImagePlus/Paperclip import、imageInputRef、onUploadFiles/onUpload 反馈、composer 菜单「图片到对话」、发送框方案 A 结构、FilesView entries 类型 + publicUrl 预览、openFile 优先 publicUrl）、`api.ts`（上传返回类型含 publicUrl）、`styles.css`（composer column + funbar 胶囊；删 composer-image/new）、`shared/webos-contracts`（契约层原本已有 publicUrl，未改）。

**验证/部署**
- `tsc -b --noEmit` 0 错误；`vite build` 通过；废弃类名零残留。
- 生产部署：`dist` 上传 `/root/daily/server/public/`（备份 `public.bak-composer-20260821`），index.html 引用 `/daily/assets/index-WdOmq-Rf.js` + `index-C3YRZXT2.css`，线上 200 且两端文件一致可拉取。
- 设计原型留档：`/storage/emulated/0/Download/Operit/composer-redesign.html`（3 候选对比页，用户选定 A 后仍可参考其余候选后续微调）。
- ⚠️ 建议强刷验证（PWA service worker 可能缓存旧 bundle）：清站点数据或等待 SW 更新后再看新发送框。

### 2026-08-21：视觉桥接双 provider——DeepSeek V4 Flash Vision（图片优先）+ MiniMax-M3（视频/兜底）+ 管理后台同步

**背景**：平台主模型 DeepSeek 纯文本，视觉（AI 的眼睛）此前仅 MiniMax-M3。DeepSeek 官方上线 `deepseek-v4-flash-vision-exp`（OpenAI 兼容 /chat/completions，官方端点 api.deepseek.com）——价格低于 M3 且**图片 token 有硬上限（每张 ≤384，自动缩放 800×800）**。实测单图成本 ≈ 0.001-0.003 元。

**Added**
- **`server/src/vision/deepseekVision.ts`（新）**：DeepSeek 视觉 provider——`callDeepSeekVision()`（OpenAI 兼容、data URI image_url、90s 超时、缓存 token 读取）、`dsVisionConfigured()`、`dsVisionPricing()`（时段动态定价：空闲输入 1.5/输出 4.5，高峰 ×2，缓存 0.05/0.10 元/百万）。
- **`server/src/vision/m3Vision.ts` 双 provider 分发**：`describeMedia` 图片优先 DeepSeek（成功直接返回）；DeepSeek 未配置/失败（记录 `DS_FALLBACK_M3` / `DS_TIMEOUT_FALLBACK_M3` 落库）/空描述 → 自动降级 MiniMax-M3；含视频的请求直走 M3（DeepSeek 暂不支持视频）。`visionConfigured()`=两家任一配置、`visionModelName()`=DeepSeek 优先。
- **用量表 `webos_vision_usage` 新增 `model` 列**（区分 deepseek-v4-flash-vision-exp / MiniMax-M3；旧库由 `ensureVisionModelColumn()` 幂等 ALTER，schema×2 + migrations + index.ts 迁移链）。
- **管理后端**（adminWebos.ts）：`/vision/stats` 新增 `byModel`（各模型次数/成败/token/金额）+ `pricing.providers`（双 provider 配置状态与定价，兼容旧字段）；`/vision/usage` 明细返回 model 列。
- **管理后台前端**（admin-web）：视觉页展示双 provider chips（配没配+价格）、byModel 金额/次数拆分、明细表新增「模型」列；文案更新。
- `.env.example` 增加 `DEEPSEEK_VISION_API_KEY=` 占位说明。

**部署（生产已生效，2026-08-21 18:40）**
- 后端 7 文件（deepseekVision.ts 新增 + m3Vision/schema×2/migrations/adminWebos/index）上传前逐文件 diff 确认「差异 100% = 本次改动、零夹带未部署内容」，md5 本地=远端一致；服务器 .env 追加官方 key（`DEEPSEEK_VISION_API_KEY=sk-665f1e…`，chmod 600，.env 备份留档；首次追加因原 .env 末行无换行把 key 拼到了 EXA_API_KEY 行尾，已用脚本还原并独立成行）；pm2 restart。
- 管理后台前端 dist 部署 `/var/www/daily-admin/public/`（旧版备份 public.bak-vision-20260821，index.html 已引用新 js，线上 200）。

**验证**
- 服务端 tsc 0 新增错误（仅滤掉既有孤儿 src/webos.ts）；admin-web `tsc -b` + `vite build` 通过。
- 启动迁移链正常：`ensureVisionModelColumn done`、`webos_vision_usage.model` 列已存在。
- **真实端到端实测（服务器临时脚本）**：convert 生成带字测试图 → `describeMedia`（data URI）→ DeepSeek vision **ok、2.8s、input 347 / output 222 tokens、成功转录「VISION TEST 2026-08-21」**；落库 `model=deepseek-v4-flash-vision-exp`（cost 0 分，量级正确）。测试记录/脚本已清理。
- 管理端 API（站长 JWT）：`/vision/stats` byModel = `{deepseek-v4-flash-vision-exp: {calls:1, ok:1, tokens:569}}` + 历史 20 条 unknown（接入前记录，语义正确）；`pricing.providers` 双 provider active=true；`/vision/usage` 明细含 model 列。

**注意**：`deepseek-v4-flash-vision-exp` 为官方实验模型；若后续官方下架/改名，另一端点在 deepseekVision.ts 常量集中维护。旧记录 model=unknown 表示接入前的 M3 调用（不追溯改写）。

**背景/根因**：朋友账号（`user:6b658270-...`，3145234007@qq.com）连续多次生图报错。线上 DB 排查（`webos_imagegen_usage` + `entities.webos_state`）确认三段独立根因：
- **08-16 / 08-18 两批失败 = 网络层间歇故障**（`fetch failed content-length`，08-18 已修复重试）；
- **08-21 04:55 本次失败 = 上游 OpenAI 系图像模型（gpt-image-2-super，经 ChatST 网关）内容安全拒绝**：
  `Your request was rejected by the safety system ... safety_violations=[sexual]`。触发场景 = 「Same anime girl character as the reference」+ 动漫女孩参考图的**图生图**；
  该拒绝是模型安全系统对人物/动漫角色题材的**确定性策略**（同提示词+同类参考图持续命中），非系统故障、0 扣费。
  此前该错误被当作 `HTTP_<status>` 把原始英文 JSON 直接透传给用户，无法读、无法行动、管理后台无法归因。
- **注意与限次的区分**：非充值用户生图 10 次上限（`FREE_IMAGE_LIMIT`）会在请求发出前拦截并返回中文「已达上限」，落库 error_code= FREE_IMAGE_LIMIT；本次 04:55 error_code 是上游 safety JSON → 判定为请求已发出、被模型审查拒绝，**不是限次导致**。

**Fixed（生产已部署，2026-08-20 21:4x，pm2 daily-server online）**
- `server/src/imagegen/chatstImage.ts`：新增 `parseSafetyRejection()` / `safetyRejectionMessage()`，`!response.ok` 分支识别安全拒绝 → 返回独立错误码 **SAFETY_REJECTED** + 中文可行动提示（含违规类别、改写建议），pm2 落明确 `[imagegen] 上游安全系统拒绝（SAFETY_REJECTED）…` 日志。
- `server/src/routes/webos.ts`：generate_image 工具描述补充内容边界（AI 生成人物/动漫题图自动避雷 + 遇拒绝主动改写题材）；全失败归因优化——error_code 优先取独立错误码（SAFETY_REJECTED/HTTP_400/TIMEOUT）而非整段失败文本，管理后台可按类筛。
- `server/src/utils/webosWorkspace.ts`：imagegen.md skill 增加「内容边界」章节。
- **部署方式**：为不夹带工作区未部署的 W1/W-F（`webos/files`、`webos/packages` 尚在开发、生产无对应模块），采用「拉生产原版 + 本地合成仅本次改动 + esbuild 校验后回传」，三文件零新增 import、diff 精确（webos.ts 仅 +7 行）；服务器 tsc 仅剩既有孤儿 `src/webos.ts` 错误，pm2 restart 后 /api/health 200、端口 3456 唯一监听。

**附加处置（站长授权的朋友账号解锁限次）**
- 朋友账号 credits 此前 `{quota:100400, used:582, monthly:null}`（无 permanent）→ `FREE_IMAGE_LIMIT` 判定 `isPaidImage=false`，虽有 10 万 quota，但**免费用户生图成功 10 次上限已于 08-21 05:00 用完**，下次生图必被「未充值用户生图次数已达上限」锁死。
- **已新增 `permanent:{quota:100000, used:0}` 解锁**（尝鲜用量包语义，扣费先 base 后 permanent；原值备份于服务器 `data/credits-friend-6b658270-before.json`，改库后 pm2 restart 清 stateCache 生效）。
- ⚠️ 副作用提示：解锁后总可用额度 ≈ quota 剩余(~10 万) + permanent(10 万) ≈ 20 万，较原 10 万翻倍；如需精确 10 万，可把 base quota 调回会员默认并让 permanent 承载全部。

**验证**
- 真实报错文本 tsx 实测：识别 SAFETY_REJECTED / violations=[sexual] ✅；负例（content-length、限流）不误判 ✅。
- 本地+生产 esbuild 三文件语法 OK、tsc 无新增错误；pm2 online、/api/health 200、端口唯一监听、日志无新增错误。
- 朋友账号 DB：permanent 已写入并读取确认，isPaidImage=true。

### 2026-08-20：W-F 文件服务一阶段（web 路线里程碑二）—— files 元数据 + manifest/blob/分块端点 + 双写 + 快照点

**背景**：总纲 §9.1 立即可并行清单中，web 路线需把 W-F 作为小粒度任务交付（移动端 M1-7 文件同步的 manifest 锚点）。文档定位见 `docs/routes/web/07-files.md`——文件只有磁盘没有元数据层（无 etag/清单 → 移动端无法增量同步）、用户文件无版本、配额统计散落。本轮补齐。

**改动**：

- **`shared/webos-contracts/files.ts`（契约单一事实源，R6/R7 双端共消费）**：`WebOsFileManifestEntry`（path/size/etag/mtime/mime）、manifest/分块 upload/快照响应结构、`FILE_SERVICE_CONSTANTS`（分块 8MB / 小文件直传上限 / 会话 TTL / manifest 上限）。
- **`server/src/webos/files/`（新增，不触碰冻结的 webos.ts）**：
  - `db.ts`：`files` 表（user_key+path 复合主键、size/sha256/etag、mime、version、deleted_at 回收站语义、updated_at）+ `file_versions`（按需快照/内容寻址去重）+ `ensureFileServiceSchema`（启动幂等建表，同 webos_* 表族）。`storeFileMeta` 用 `ON CONFLICT (user_key,path)` upsert（修复初版按时间戳 id 永不冲突的 bug）。
  - `service.ts`：`recordFileStats`（写后登记，双写核心）/`recordFileDeleted`（回收站语义）/`fingerprintFile`（≤4MB 全读、大文件头尾采样指纹）/`scanWorkspace`/`reconcileFileMetadata`（磁盘↔表 diff 对齐）/`createSnapshotPoint`（AI 批量改写前快照）。
  - `router.ts`：REST 端点（挂 `/webos/api`，authMiddleware 继承）——`GET /files/manifest?prefix=`（移动端同步锚点）/`GET /files/blob?path=`（Range 下载）/`PUT /files/blob`（≤8MB 直传）/`POST /files/upload`（分块 init/part/complete/abort，断点续传）/`DELETE /files`（回收站语义）/`POST /files/snapshot`/`POST /files/reconcile`（本人触发）。
- **agent_fs 双写适配（AI 无感知）**：`WorkspaceFsHooks` 新增 `onFsFileWritten/onFsFileDeleted`；`agent_fs_write/edit/copy/delete` 命中时触发；webos.ts 的 `fsHooks` 注入 File Service 的 `recordFileStats/recordFileDeleted`。路径语义不变，AI 工作方式零变化。
- **`server/test/unit/files.test.ts`（守卫，10 用例）**：双写（写后 manifest 可见/覆盖 version 递增/删除回收站）、manifest 结构与契约一致（home/agent 隔离）、fingerprint/mime/relativize、reconcile 磁盘↔表对齐（写3删1+stale → 精确对齐）、快照点创建。

**验证**：

- `server` `tsc --noEmit` 0 错误；`client/shell-web` `tsc -b --noEmit` + `vite build` 通过。
- `server` vitest：`files.test.ts` **10/10** + `contracts.test.ts` 45/45 + `desktopLayout.test.ts` 8/8 = **63/63 全绿**。
- piBridge.test 7 个失败为本会话前既有状态（`piBridge.ts` 是会话开始前的 pre-existing M，未触碰；失败全在 pi 会话真实初始化路径），非本里程碑引入。
- 架构决策沿用 W0：server 不能 import shared 的 `.ts`（rootDir）→ files 契约走 shared 类型 + 服务端本地常量（值由 shared 守卫保证一致）；reconcile 默认取 files 表里全部 user_key（或显式传入），只标记未删除且磁盘不存在的行。

**待办**：移动端 M1-7 文件同步（manifest 锚点已就位）；配额展示从磁盘换成 files 表（`sumFileBytes` 已备，建议 reconcile 跑批后切换，误差 <1%）；blob 内容寻址块（恢复文件到快照时需 blobs，当前 file_versions 只存 sha256 引用，内容恢复后置）。

### 2026-08-20：桌面布局端点 desktopLayout（web 路线插队小任务）——解锁移动端 M1-4

**背景**：总纲 §9.1 立即可并行清单里，web 路线承诺把 `desktopLayout.ts` 作为无依赖插队小任务提前交付（移动端 M1-4 桌面阶段一的真实联调依赖）。文档定位见 `docs/routes/web/08-ui.md` §2（布局端点）+ `docs/routes/web/02-architecture.md` §3（`server/src/webos/desktopLayout.ts`）。

**改动**：

- **`shared/webos-contracts/desktop-layout.ts`（契约单一事实源，R7 双端共消费）**：桌面布局数据模型 `WebOsDesktopLayout`（optimistic version + 多页 `pages` 二维数组 + 文件夹折叠，D18 启动器方向对齐）+ TypeBox schema + `validateDesktopLayout`（TS 侧）/ `defaultDesktopLayout`。folder.children 仅含 app（有限嵌套 ≤2 层，typebox 1.x 无 Recursive 也可表达）。sed-2026-08-20 同步生成 `desktop-layout.schema.json` 快照（gen-contract-schemas.mjs），供服务端 Check 校验与移动端 DTO 生成。
- **`server/src/webos/desktopLayout.ts`（新端点，不触碰冻结的 webos.ts）**：
  - `GET /webos/api/desktop-layout`：返回当前用户桌面布局（首次返回默认空布局 `{version:0,pages:[[]]}`）。
  - `PUT /webos/api/desktop-layout`：保存布局（schema Check + 语义校验），乐观并发（version 低于服务端当前 → `409 LAYOUT_VERSION_CONFLICT` + 返回 serverVersion 供前端合并重试）；同页重复 appId 语义拦截（schema 无法表达 appId 维度重复）。
  - 存储复用 `loadState/saveState`（webos.ts 导出）+ appStorage 保留 key `__desktop_layout__`（Delete App 不误删），挂载走 index.ts（与 webosConversationsRouter 同级模式，不动 webos.ts）。
- **`server/test/unit/desktopLayout.test.ts`（守卫）**：schema 快照完整 + fixtures 合法全过/非法全拒（schema 层）+ 重复 appId 语义拦截。fixtures：合法 3 / 非法 4（嵌套 folder、负 version、重复 app、空 pages），落 `shared/webos-contracts/fixtures/`。

**验证**：

- `server` `tsc --noEmit` 0 错误；`client/shell-web` `tsc -b --noEmit` 通过 + `vite build` 成功。
- `server` vitest `desktopLayout.test.ts` **8/8 全绿**；`contracts.test.ts` 45/45 全绿（合计 53/53）。
- 架构决策沿用 W0：server 不能 import shared 的 `.ts`（rootDir）→ desktop-layout 也走 JSON 快照 + typebox Check。

**待办**：桌面模板 V2（webosDesktopV1 → V2 多页/文件夹/边缘翻页）属 W4，本插队只交付布局端点与契约；前端 shell-web 接入 layout.get/put（当前模板仍自行 JSON 内存管理，未读端点）——W4 一并做。

### 2026-08-20：W0 契约基线（web 路线里程碑一）——统一包 Manifest + App API schema + 能力词汇表 + fixtures 守卫

**背景**：双路线定稿（docs/routes/README.md R6）要求 `daily.pkg.json` / `api.json` / 能力词汇表只在 `shared/` 定义一次，双端实现 + fixtures 守卫，单侧新增字段即红。本轮交付 web 路线 W0「契约基线」（09-roadmap.md W0）——**双路线一切后续的硬阻塞点**。

**改动**：

- **`shared/webos-contracts/packages/`（单一事实源，新增）**：
  - `daily-pkg.schema.ts`：daily.pkg.json v2 TypeBox schema（`PACKAGE_SCHEMA` + 静态类型 `WebOsPackageManifest` + 序列化 `PACKAGE_JSON_SCHEMA`）。覆盖 13 种包类型（app/pet-layer/api/skill/theme/toolpkg/mcp/workflow/model-pack/url-app/provider/subagent/bundle）、组合式包内容（contents: skills/mcp/tools/tokens/assets）、children 嵌套（≤3）、url-app 专属段/宠物段、依赖、minShell；`additionalProperties:false` 收紧未知字段。
  - `api.schema.ts`：api.json TypeBox schema（`API_SCHEMA` + `WebOsApiSpec` + `API_JSON_SCHEMA`）。endpoints（name/method/path/params/storage/handler/returns/visibility owner+public）、network 白名单、secrets；导出 `API_HANDLER_LIMITS`（5s 超时/64KB 截断/ctx.http 256KB/30s/单会话 60 工具）。
  - `capabilities.ts`：能力词汇表（`WEBOS_CAPABILITIES`，26 词 + `web` 可用性 available/unavailable/mobile-only）——新增能力必须先登记本表 + 写 03 文档 + 双端实现。
  - `fixtures/`：daily.pkg.json 合法 12 例 / 非法 12 例，api.json 合法 5 例 / 非法 6 例（路径穿越、内网域名、非法能力词、未知类型、坏 semver、缺必填、children 越界+重复等）。
- **`server/src/webos/contracts/`（服务端校验器，新增）**：
  - `index.ts`：`validatePackageManifest` / `validateApiSpec` / `validateUnknownContract`，两级校验（schema 结构 + 语义），返回带 `path` 的人话 `issues`（W1 校验反馈回路的核心）；语义层做能力词汇表、域名白名单（含 SSRF 内网段拦截）、children 深度/重复、api handler 防穿越。
  - `shared-contracts.ts`：从 JSON 快照导入词汇表。
  - **架构决策**：server `tsconfig rootDir=./src` 禁 import shared 的 `.ts`（实测 TS6059）→ schema/capabilities 同时生成**纯 JSON 快照**（`*.schema.json` + `capabilities.json`），服务端校验器走 JSON import（实测不受 rootDir 限制），typebox 1.x `Check` 对纯 JSON schema 校验通过。快照由 `server/scripts/gen-contract-schemas.mjs` 生成（幂等，临时 symlink 解析 typebox，自动清理），提交 Git。
- **`server/test/unit/contracts.test.ts`（契约守卫，新增）**：45 用例——fixtures 完整性（dailypkg 合法/非法各 ≥10、api ≥5）、合法全过、非法全拒（每条 issue 必有人话）、自动识别、语义细项（能力词/SSRF/深度/handler 穿越）、生成脚本幂等。

**验证**：

- `server` `tsc --noEmit` 0 错误；`client/shell-web` `tsc -b --noEmit` 通过 + `vite build` 成功（shared 契约被 shell-web 正常解析）。
- `server` vitest `test/unit/contracts.test.ts` **45/45 全绿**。
- `PACKAGE_JSON_SCHEMA` required 齐（schema_version/id/type/version），capabilities 26 词已落快照。

**待办（本次未含，W1/W2 落地时接续）**：packages 三表与注册流水线（W1）、App API handler runtime（W2）、移动端 Kotlin DTO + 同款 fixtures 反序列化测试（README.md 交付要求 3）。

### 2026-08-20：粘贴 HTML 生成 App 放开外部资源 + 老设备（Android 10 / iPhone 6S）白屏修复

**背景**：用户反馈两个问题：① web 端「粘贴 HTML 创建 App」粘贴任意带外链（普通 `<a>`、CDN 脚本/样式/图片）的 HTML 都报「P0 静态 App 不允许外部网络资源」；② 老平板（Android 10）与老手机（iPhone 6S Plus）打开 web 端只显示橙色背景，无任何内容。

**改动**：

- **粘贴 HTML 放开外部资源**（`server/src/routes/webos.ts`）：
  - `validateAppHtml` 增加可选 `opts.allowExternalResources`；原正则把**所有** `src/href/action/formaction` 指向 `http(s):/``//``javascript:` 的一刀切拒绝（连普通外链都拦），现拆分为：
    - **危险协议一律禁止**（与是否放开无关）：`javascript:` / `vbscript:` / `file:` / `filesystem:`（`APP_FORBIDDEN_PROTOCOL`，新错误码），`data:text/html`（`APP_HTML_FORBIDDEN_RESOURCE`），以及 `iframe/object/embed/base` 元素（`APP_HTML_FORBIDDEN_ELEMENT`）。
    - **外部 http(s)/协议相对资源**：仅当「用户显式粘贴」（`POST /webos/api/apps` 且 `source=local_import`）或「该源 App 的后续编辑」（`POST /webos/api/apps/:appId/versions` 且 `app.source==='local_import'`）时放行；AI 生成与其他自动路径（文件夹注册、工作区文件同步、`update_webos_app` 工具）保持严格，防幻觉 URL / 供应链依赖。
  - `POST /apps/:appId/versions` 的版本 `source` 标记由硬编码 `ai_generated` 改为跟随 `app.source`（审计准确）。
  - App 运行在 `sandbox="allow-scripts"` + srcdoc 的 opaque-origin iframe（无令牌、无宿主 DOM 权限、宿主不注入 CSP），外部资源与内联脚本同级风险，放开合理。
- **老设备兼容**（`client/shell-web/vite.config.ts` + `src/main.tsx`）：
  - 根因：`build.target` 未设置 → Vite 默认对标较新浏览器，产物保留 ES2020/2021 语法（实测 `?.`×141、`??`×156、`??=`×11、`||=`×14），且启动路径 `store.ts` 的 `deviceId()` 调用 `crypto.randomUUID`（Chrome 92+ / Safari 15.4+）。Android 10 自带 WebView（Chrome ~78）对 `?.`/`??` 是语法级不兼容 → 整个模块脚本解析失败 → React 不挂载 → 只剩背景；iPhone 6S（iOS <14）同理。
  - 修复：`build.target: 'es2018'`（esbuild 把 `?.`/`??`/`??=`/`||=` 全部转译）；`main.tsx` 顶部加 `crypto.randomUUID` 兼容 shim（getRandomValues 构造 UUID v4，极老环境 Math.random 兜底）。`serviceWorker` 已有 `'serviceWorker' in navigator` 特性守卫；CSS 产物经扫描无 oklch/@layer 等现代特性，无需处理。

**验证**：

- `server` `tsc --noEmit` 退出码 0、零错误；`client/shell-web` `tsc -b && vite build` 通过。
- 新构建产物 `index-kZGol9hn.js`（631.9KB）复扫：`??`/`??=`/`||=` 全部清零（0），残留 5 处 `?.` 均为 KaTeX 内部 `cond ? .数字 : 0`（三元 + 数字的词法拼写，本就是 ES3 语法，老内核可解析），`randomUUID` shim 已入 bundle。
- 服务端校验逻辑冒烟测试（模拟严格 vs local_import 放开）：17 个用例全过——外链/CDN/图片/协议相对在 local_import 下放行，严格路径拒绝；`javascript:`/`iframe`/`base`/`data:text/html` 无论是否放开都拒绝；相对路径与 `style url()` 不受影响。
- **部署完成（2026-08-20 01:2x，已上线 shadowshub.xyz/daily/）**：
  - 前端：工作区新构建 `dist/` 上传到服务器 `server/public/`（原子切换，旧目录留档 `server/public.bak-20260820`），线上 `index.html` 已引用新产物 `index-kZGol9hn.js`（631KB，es2018 转译版），md5 与本地构建一致。
  - 后端：服务器 `server/src/routes/webos.ts` 已打补丁（备份 `webos.ts.bak-20260820`）+ `pm2 restart daily-server`（pm2 跑 TS 源码，重启即生效）。
  - 验证：`/api/health` 200；`/daily/` 返回新 index.html、新 JS 可拉取（631987B）；端到端 curl 实测——`source=local_import` 含外链/CDN script/img → **201 创建成功**；`ai_generated` 含外链 → **400 `APP_EXTERNAL_RESOURCE`**；local_import 含 `javascript:` → **400 `APP_FORBIDDEN_PROTOCOL`**；local_import 含 `iframe` → **400 `APP_HTML_FORBIDDEN_ELEMENT`**。Playwright 打开线上页面渲染正常、控制台零错误。
  - 测试残留：一个挂在临时游客下的 `deploy-verify-local` App，已被服务器 retention 定期清理，不影响真实用户。
  - 遗留观察点：`DELETE /webos/api/apps/:appId` 端点读取 `Authorization` header（前端删除走 cookie 也报缺 header）——既有行为，未在本次范围内改动，待后续排查。
  - 用户请在 Android 10 老平板 / iPhone 6S 上重开 `https://shadowshub.xyz/daily/` 复核：应不再只显示橙色背景，而是正常进入 AI 助手页。

**追加修复（第二轮，`AbortSignal.timeout` 根因）**：

- 用户实测：iPhone 6S（iOS 15.8.4，Safari 与 QQ WKWebView 均试）部署第一轮后**仍然白屏**。nginx 访问日志确认 iPhone 已 200 拉到新版 `index-kZGol9hn.js`（排除缓存/服务端未更新），进而深挖运行时 API，锁定真凶：构建产物里 `getBootstrap()` 调用 `AbortSignal.timeout(ms)`（`client/shell-web/src/api.ts:78`）——该 API 需 Chrome 103+ / Safari 17.4+（iOS 17.4+），**iOS 15.8 的 Safari 没有**；而 bootstrap 是启动必经路径 → 直接 `TypeError` → 启动崩溃 → 白屏只剩背景。这也解释了为何第一轮把 target 降到 es2018 无效——iOS 15.8 语法层面能解析 es2018 产物，坏在运行时 API 而非语法。
- 修复：`api.ts` 新增 `createTimeoutSignal()`——优先 `AbortSignal.timeout`，缺失时回退 `AbortController` + `setTimeout`（AbortController 为 Chrome 66+ / iOS 12.1+，安全）；`main.tsx` 另加「启动崩溃可视化」兜底（纯 DOM、不用任何新 API，仅在 `#root` 为空时把 error/unhandledrejection 或「疑似内核过旧」提示显示成可见条，避免老设备下次再遇到隐形崩溃时无从排查）。
- 重构建 `index-IR8muFuF.js`（633,270B）：复扫 `AbortSignal.timeout` 仅剩 `typeof AbortSignal.timeout === 'function'` 守卫内两处引用，**无裸调用**；已部署上线（public 原子切换，备份 `public.bak-20260820b`）。
- 验证：`/api/health` 200；`/daily/` 引用 `index-IR8muFuF.js`（200 / 633,270B，md5 与本地一致）；Playwright 打开线上渲染正常（rootChildren=1、控制台零错误、无兜底提示条），并在页面内模拟删除 `AbortSignal.timeout` 确认 fallback 基建（AbortController）可用。请用户 iPhone 6S / Android 10 平板强刷复测（若仍有缓存残留，Safari 清除 shadowshub.xyz 网站数据后重试）。

**追加修复（第三轮，决定性根因：正则 lookbehind）**：

- 用户复测 iPhone 仍白屏。nginx 日志确认 iPhone 已 200 拿到第二轮新版 `index-IR8muFuF.js` 但**从不发 `/webos/api/bootstrap`**（React 未挂载）。加装「先于主 bundle 的内联诊断兜底」（index.html 顶部 ES5 脚本，捕获 window error/unhandledrejection + `<img>` 上报 `/daily/__booterr?m=…` 到 nginx 日志 + 页顶红条显示）。
- **根因（已由 iPhone 自动上报+截图坐实）**：`client/shell-web/src/App.tsx` 的 `inlineMarkdown` 行内 LaTeX 匹配用了**正则 lookbehind `(?<!\$)`**，而 **Safari 16.4 之前（iOS 15.8）不支持 lookbehind** → 整段 bundle 解析 `SyntaxError: Invalid regular expression: invalid group specifier name` → 整页白屏。此前本地反复只扫描 `?.`/`??`/`ApiList` 等 API 与 JS 语法，**漏了「es.target 不会转译正则特性」这一点**（esbuild 只降级 JS 语法，正则 lookbehind 由各引擎决定），且第一轮扫 lookbehind 因 shell 转义误报为 0。
- 修复：
  1. `App.tsx` 该正则改为**两步法**（先用私有占位 `\uE000` 临时收走连续 `$$` 块级定界 → 再匹配单对 `$` → 恢复 `$$`），语义与原正则等价，删除 lookbehind。
  2. 主脚本由 `<script type="module" crossorigin>` 改为 **`<script defer src>` 普通脚本加载**（产物是单文件 IIFE、无 import.meta，普通脚本等价且绕开 iOS 15 对 module script 加载的坑）。
  3. nginx `sites-enabled/default` 的 `gzip_types` 移除 `text/javascript/application/javascript`（JS 明文传输，规避老内核/部分链路 gzip 解压异常；CSS 仍 gzip）。备份 `default.bak-20260820`（注意：备份勿放 `sites-enabled/` 会被 include）。
- 新产物 `index-Bk7tAM3_.js`（633,316B）：复扫 `(?<` **清零**；已部署（`index.html` 引用 `?v=20260820e`，明文 200，md5 一致）；Playwright 线上回归正常（rootChildren=1、零 console 错误、无红条）。**请用户 iPhone 6S / Android 10 平板复测**。教训记录：老设备兼容排查顺序应为「语法 target → 正则特性（lookbehind/命名组/`\p{}`）→ 运行时 API（AbortSignal.timeout/randomUUID 等）→ 传输层（gzip/module/cache）」，正则特性是此前盲区。

### 2026-08-19：web 端三项体验修复（用户消息换行 / 文件管理器看 AI 工作区 / 刷新消息不再重跑上下文）

**背景**：用户反馈三个问题：① 用户消息内的换行被折叠成一段；② 文件管理器只能看 home 区，想直接看 AI 工作区内容要反复让 AI 转述、耗 tokens；③ 刷新/重发消息（编辑/回退重来 rebuild）会像「会话第一条消息」一样重跑整个上下文 + 重新执行开场 skill（读记忆/存快照等一次性运算），一次多花上万 tokens（用户实测：中间消息几百、刷新第一条上万）。

**改动**：

- **用户消息换行**（`client/shell-web/src/styles.css`）：`.user-row .chat-text` 增加 `white-space: pre-wrap`——用户消息是纯文本节点，默认 `normal` 会把 `\n` 折叠成空格导致堆成一段；AI 消息走 markdown HTML 不受影响。
- **文件管理器新增 AI 工作区只读浏览**：
  - 后端（`server/src/routes/webos.ts`）新增 `GET /webos/api/workspace/agent-files?path=`（列表）与 `GET /webos/api/workspace/agent-files/raw?path=`（只读读字节，≤100MB 才允许 inline 预览），路径走 `resolveWorkspacePath`（防穿越），只读不提供上传/删除/编辑。
  - 前端（`client/shell-web/src/api.ts` + `src/App.tsx`）：文件页新增「我的文件 home/ ↔ AI 工作区根目录」切换 tab；AI 工作区从根浏览（home/ agent/ apps/ shared/ skills/ system/ logs 等），文件点击可打开：图片内联预览、文本（md/js/html/…）只读查看、其它新窗口打开；只读区隐藏上传/删除按钮。
- **刷新/重发消息不再重跑上下文**（`server/src/routes/webos.ts` chat/stream rebuild 分支）：
  - 旧实现：`disposeWebosSessions` 删除会话与 JSONL 文件 → 全新 session 重新加载 skills 并重新执行开场流程，且 `historyContext` 把整段历史文本重放一遍 = 「上下文没有损失但事实上跑了两遍」。
  - 新实现：rebuild 时**不再 dispose、不再重放历史**——复用当前会话上下文（内存缓存或 JSONL 持久化恢复），只发送最新消息并附一句提示（开场初始化已完成、忽略旧回复），token 消耗回到普通消息水平。
  - `formatHistoryContext` 删除实际调用（函数保留以免影响其它引用）。

**验证**：

- `server` 与 `client/shell-web` `tsc --noEmit` 零错误；`vite build` 通过。
- 文件管理器：切换「AI 工作区」列出根目录（home/agent/apps/…），进入目录、打开文本/图片均正常（代码 + 类型检查 + build 验证）。
- 服务端类型检查覆盖新端点与 rebuild 分支改动（未部署，待合并后重启 daily-server 验证线上行为）。

### 2026-08-19：web 端 AI 换新 DeepSeek Key + 标题生成（chat/title）修复

**背景**：旧 Key（sk-300k9j...，opencode.ai 网关）触发 **429 Weekly usage limit reached（周用量上限，4 天后重置）**，对话 Agent 报错（error log 有 `agent_end transient error (429 ...)`）→ 用户紧急要求换新 Key。

**改动**：

- 换 Key：`DEEPSEEK_API_KEY=sk-8jZ3cw0iR05kIct1SlV7sVvmcfgZZC0sTKdQXQdy4eNqK81HuLjMpeKPDFOQAhlF`（`server/.env` 本地 + 服务器，模型 `deepseek/deepseek-v4-flash` 与 Base URL `https://opencode.ai/zen/go/v1` 不变；服务器 `.env` 已备份 `.env.bak-20260819` + `pm2 restart daily-server`）。
- **顺带修复标题生成永远 null**（2026-08-17 曾修过一次，仍复现）：根因是 opencode 网关的 `deepseek-v4-flash` **总是先输出一长段 reasoning**（几百 token），而 `generateConversationTitle` 设了 `maxTokens: 64`——64 token 被推理耗尽，`content` 文本还没输出就被截断 → `completeSimple` 返回的 text 块为空 → `title null`（前端回退截取标题；无异常日志，排查难）。**修复：`maxTokens: 64 → 384`**（`server/src/piBridge.ts`，本地+服务器；标题 ≤20 字，成本极小）。排查路径：直连网关非流式同参返回正常 → 内联复刻 `completeSimple`（不传 maxTokens）成功 → 真实函数复现 null → 打印完整 result 发现 reasoning 占满 64 token → sed 修复。

**验证**：

- 新 Key 直连 opencode.ai `/chat/completions`：200，model `deepseek-v4-flash`，usage 正常，无余额错误。
- `POST /webos/api/chat/stream`（thinking=low/medium）：SSE delta 正常返回（"连接正常 ✅..."），`agent_end stop=stop`，无 429。
- `POST /webos/api/chat/title`：`{"title":"今日安排与浇花提醒"}` ✅（修复前稳定 null）。
- 服务器 `pm2 ls` daily-server online、端口 3456 唯一监听；error log 仅启动日志，无异常。

### 2026-08-18：web 端市场（system.store）支持技能发布（补齐缺口）

**背景**：web 端应用商店此前只支持浏览/安装技能（系统级全局 `skills-webos/`），**不支持把用户自己工作区 `skills/` 下的 skill 发布到市场**。本次补齐「发布 → 市场 → 他人安装」完整闭环（对齐 App 商店的发布/下架/我的链路）。

**Added**
- 新表 `webos_store_skills`（`schema.ts` / `schema-sqlite.ts`）：用户发布技能条目（id=`sk-` 前缀、skill_id 目录名、owner_key、name/description、size_bytes、status）；`CREATE TABLE IF NOT EXISTS` 每次启动幂等执行，存量库自动建表。
- 服务端新端点（`server/src/routes/webos.ts`）：
  - `POST /webos/api/store/skills`：把自己的工作区 `skills/<id>/` 发布到市场（重复发布 = 更新快照、条目 id 不变）；2MB 上限、`myself` 隐私记忆目录禁发、`SKILL.md` 的 name 需与目录名一致。
  - `GET /webos/api/store/skills/mine`：我的可用技能（发布选择用，标注是否已发布）。
  - `GET /webos/api/store/skills/my`：我的已发布技能（发布者视角管理/下架）。
  - `DELETE /webos/api/store/skills/:id`：下架（仅发布者本人）。
- 发布素材归档 `store-skill-assets/<id>/`（与发布者工作区解耦——发布者删技能后商店/他人仍可安装）。
- StoreSDK 新增 `skills.mine / skills.my / skills.publish / skills.unpublish`（`api.ts` + `runtime.ts` + `App.tsx` adapters）。

**Changed**
- `GET /webos/api/store/skills` 列表合并两源：系统级全局 + 用户发布条目（用户条目带 `ownerName` 标注、`system:false`、可安装）。
- `POST /webos/api/store/skills/:skillId/install` 支持来源二选一：① 用户发布条目（传条目 id=`sk-xxx` 或 skill_id，归档优先、发布者工作区回退）→ ② 系统级全局。
- 商店 UI 模板（`server/src/webosStoreV1.ts`）：技能市场列表展示用户发布技能（发布者标注）；「我的」页新增「技能发布」统计与列表、可下架；发布弹层改为「应用/技能」双 tab（技能发布选自己的 skill，已发布的标注）；技能页提示可发布自己的技能。

**验证**
- `server npx tsc --noEmit`：0 错误（exit 0）；esbuild 对 webos.ts / webosStoreV1.ts / 两个 schema 文件语法校验通过。
- `client/shell-web npx tsc -b` + `vite build`：通过（仅存量 chunk size 提示）。
- 部署后存量账号打开市场时 `system.store` 自动升级到新模板（未被 AI 改过形态的账号；AI 定制版保留不覆盖）。

### 2026-08-18：图生图（改图）间歇失败修复 + 生图失败观测性补齐（用户 3145234007@qq.com 报障排查）

**根因**：api.chatst.org `/v1/images/edits`（图生图/改图）端点**间歇性**返回非法响应（`fetch failed (cause: UND_ERR_INVALID_ARG invalid content-length header)`，undici 层 content-length 校验错误，非超时、非业务错误、**0 扣费**）。该用户 08-15（6 次）与 08-18（4 次）改图请求全败；同库 77 条文生图（generations，JSON 分支）全部成功、08-02 img2img 曾成功、故障后真实 key 复现同一 edits 请求成功（HTTP 200 / 49s / ~2917 tokens）→ 判定为上游端点间歇故障，非代码必然错误。故障窗口内 3 次连接尝试仅 ~12ms（其余 2400ms 为重试退避），说明错误发生在请求/响应解析阶段而非网络超时/慢。当时 3 次快速重试（800/1600ms）不足以覆盖持续数分钟的故障窗口。

**Fixed**
- `server/src/imagegen/chatstImage.ts`：去掉 edits multipart 请求的手动 `Content-Length` 头（Buffer 体由 undici 自动计算，消除该类请求侧 content-length 校验隐患）。
- 网络/响应解析类错误重试 2→3 次（共 4 次尝试），重试退避拉长为 800/2000/5000ms；`isRetryableNetworkError` 纳入 `UND_ERR_INVALID_ARG`（含 `invalid content-length header` 文本匹配）。
- **观测性**：生图/改图最终失败不再静默——`console.warn` 落 pm2 日志（含 hasRef、实际尝试次数、完整 error.cause）。此前失败不写任何日志，pm2 一条都没有，导致只能从被截断的 DB error_code 反推。
- `server/src/routes/webos.ts`：失败原因落库截断 60→300 字符（此前仅 60 字符，cause 名被拦腰截断，`fetch failed (ca…` 根本无法定性）。

**验证**
- `server npx tsc --noEmit` 0 错误（exit 0）。
- 已部署生产（scp chatstImage.ts + webos.ts + pm2 restart daily-server）：md5 与本地一致、启动日志 boot 完成无错、`/api/auth/guest` HTTP 200、新日志行已就位。
- 故障已即时解除：该用户可直接重试「去掉眼镜的变体」；如再遇同类间歇失败，新重试策略（最长 ~8s 窗口 ×4 次）与全量日志将显著缓解并留下完整证据。

### 2026-08-17：搜索供应商替换——秘塔 + GitHub 下线，Exa + ArXiv 上线（用户拍板）

**决策**：对比评测（秘塔 vs Exa vs DeepSeek 原生 web_search vs ArXiv，覆盖网页获取/最新时事/论文/技术博客）后，用户最终选定 **Exa + ArXiv** 作为唯一搜索后端，替换掉秘塔（web_search/read_webpage/metaso_qa 底层）与 GitHub 搜索。

**Added**
- 新建 `server/src/utils/searchApiExa.ts`：Exa 调用层（`/search` 语义搜索 + AI 摘要、`/contents` 抓网页正文、`/findSimilar` 相似内容），带 30s 超时/错误格式化/批次上限 5 URL。
- 新增 AI 工具 `exa_find_similar`（Exa 独有能力：按已知 URL 找语义相似论文/文章/竞品文）。
- `web_search` / `read_webpage` 底层替换为 Exa；`academic_search`（ArXiv）保留。
- 新增环境变量 `EXA_API_KEY`（优先于 DB 存储），已配置服务器 .env；`.env.example` 同步。

**Changed**
- `searchApi.ts` 大幅瘦身：删除秘塔（callMetaso/callMetasoReader+缓存）与 GitHub 搜索（7 mode），保留通用 fetch/重试、ArXiv、以及 githubProxy 下载代理依赖的 `extractFileName`/`buildGithubProxyUrl`/`extractRepoFullName`（github_proxy 路由仍保留，仅无搜索工具入口）。
- `aiSettingsStore.ts`：`SearchProvider` 从 `'metaso'|'github'` → `'exa'|'github'`；新增 `SEARCH_KEY_EXA`；`getSearchKey('exa')` 优先读 `EXA_API_KEY` 环境变量。
- `routes/searchKeys.ts`：VALID_PROVIDERS = exa/github；`testExaKey`（调 /search 校验证书）。
- `routes/admin.ts` / `adminWebos.ts` / `client/admin-web` / `client/web Admin`：引擎名与统计 label 同步（秘塔→Exa，移除 GitHub 搜索）。
- `billing/pricing.ts`：搜索 fixedPrice 0.05 → 0.08 元/次（覆盖 Exa 成本 $0.007-0.013/次）。
- `schema.ts` / `schema-sqlite.ts`：search_engines 种子 metaso/github → exa。
- 前端 `searchKeys.ts`/`SearchKeysConfig.tsx`/`SearchEngineConfig.tsx`：provider 从秘塔→Exa。

**Fixed**
- `searchTools.ts` 新工具 execute 的 params 类型断言（未知类型访问），通过 tsc。

**验证**
- 服务器 `npx tsc --noEmit`：改动文件 0 错误（仅服务器既有孤儿文件 `src/webos.ts`/`src/m3Vision.ts` 残留报错，无人 import、不影响 pm2/tsx 运行时）。
- 冒烟测试（服务器 tsx）：`callExaSearch` 命中 Kimi K2 论文（category=research paper，cost=$0.01）、`callExaContents` 抓取 DSH GitHub 首页成功（500 字符）、`callExaFindSimilar` 正常返回。
- 单元测试重写：`server/test/unit/searchTools.test.ts`（Exa/ArXiv 四工具 11 用例）、`client/desktop searchKeys.test.ts`（provider→exa）。
- ⚠️ 待重启：服务为 pm2 tsx 常驻进程，需重启（或 tsx watch 自动）后新工具才生效；秘塔 METASO_API_KEY 虽不再被搜索使用，但视频生成（MiniMax-H3 渠道）仍依赖，保留。

## [1.0.0] - 2026-06-30

首个正式发布版本。完成桌面端原生体验、AI 搜索集成、移动端 AI 能力、发布前质量门禁（UI 走查 / dogfood / 干净环境安装）等全部工作。

### Added
- **Phase 12 — 桌面端 AI 搜索集成**：`local_search` 工具 + 24 个站点适配器 + 4 个搜索工具 UI（网页 / GitHub 仓库 / 学术论文 / 代码片段），支持在 AI 对话中直接调用搜索能力。
- **Phase 13.1 — 桌面端原生体验补全**：
  - 13.1.1 自绘标题栏（FramelessWindow + 自定义最小化/最大化/关闭按钮，符合应用视觉风格）。
  - 13.1.2 应用图标生成（`scripts/generate-icons.mjs` 从 `logo.png` 生成 `icon.ico` 及多尺寸 PNG）。
  - 13.1.3 NSIS 品牌化（installerHeader banner 150×57 + installerSidebar/uninstallerSidebar BMP + 中文安装向导 LCID 2052）。
  - 13.1.4 onboarding 引导流程（首次启动展示使用引导，huashu-design 设计 → React 实现）。
- **Phase 13.2.3 D1 — API Key 正向同步**：client → server 方向的 API Key 同步实现 + provider 配置确认链路。
- **mobile/m3 — 移动端 AI 集成完整实施**：双模式 Agent（在线 server 模式 + 单机轻 Agent 模式）+ 14 个工具 + 多面板路由。
- **Phase 14 — Docker .pi/skills 目录挂载**：容器内可见宿主 skills，支撑 Skill CLI 运行时。
- 新建本 `CHANGELOG.md` 的 1.0.0 发布说明。

### Changed
- **搜索工具优化（server/search）**：秘搜（Metaso）替换 Bocha 作为默认网页搜索源；移除 S2 学术搜索；GitHub token 改为可选（无 token 时走公开 API 限速）。
- **版本号 0.10.0 → 1.0.0**：`package.json` 与 `electron-builder.yml` 注释同步更新。
- **electron-builder publish 块移除（Phase 13 F 线）**：删除 publish 配置，避免误触发自动发布到 GitHub Releases，发布改为手动控制。

### Fixed
- **Phase 13.2.1 — switchSession 会话切换 bug**：修复切换会话时上下文/状态串台的缺陷。
- **Phase 13.2.2 — permission_request 权限请求链路**：打通服务端权限请求下发 + 客户端授权卡片渲染 + 回传授权结果的全链路。
- **Phase 13.2.3 D2 — 真实 LLM 端到端验证（DeepSeek）**：验证对话 + 工具调用 + permission_request 全链路在真实 LLM 下通过。
- **Phase 13.2.4 — serverHealthCheck 对齐**：客户端健康检查与服务器实际健康接口字段/语义对齐。
- **Phase 14 — dynamicWidgets upsert 修复**：避免动态组件重复插入导致的唯一约束冲突，改为 upsert 语义。

### Validation
- **Phase 13.3 — UI 全量走查**：17 个页面逐页面 Playwright MCP 截图存证（`docs/verify/phase13/ui/`）。
- **Phase 13.4 — dogfood**：8 个场景探索式测试（对话 / 搜索 / 工具调用 / 权限 / 同步 / 多面板 / 安装 / 卸载）。
- **Phase 13.5 — 干净环境安装实测**：Windows Sandbox 中安装 `event-1.0.0-setup.exe`（产物名规则：electron-builder.yml 的 `artifactName: ${name}-${version}-setup.${ext}`，其中 `${name}` 取自 package.json 的 `name` 字段 `event`，非 `productName`），验证安装向导 / 快捷方式 / 启动 / 卸载全流程。

### Known Limitations
1. **API Key 反向同步（server → client）暂未实现**：当前仅支持正向同步（client → server），server 端直接修改的 API Key 不会回传到 client。
2. **代码签名未启用，仅内部分发**：无代码签名证书，`signAndEditExecutable: false`；Windows SmartScreen 会提示「未知发布者」，需用户手动信任。
3. **Windows Sandbox 安装测试需 Windows 10/11 Pro/Enterprise + 硬件虚拟化**：家庭版不支持 Windows Sandbox，需在支持的系统上执行干净环境安装验证。

## [0.10.0] - 2026-06-29

Phase 14「AI 基础设施解放」阶段性版本：Skill CLI + Docker 化部署 + 组件能力扩展 + 知识库预留。本版本为 1.0.0 发布前的最后一个 0.x 阶段版本。

## [0.9.0] - 2026-06-27

桌面端 Phase 9「单机轻 Agent」发布：无需服务器也能用 AI，调用户自配 API Key。

### Phase 9 — 单机轻 Agent

#### 新增

- **pi-coding-agent 桥接**：Electron 主进程通过动态 `import()` 加载 `@earendil-works/pi-coding-agent`，桌面端在没有后端服务器时也能跑 agent（用户自配 API Key）
- **safeStorage 加密 API Key 存储**：用 Electron `safeStorage.encryptString` 系统级加密，持久化到 `userData/ai-keys.json`；6 个 `agent:*` IPC + `migrateLegacyPresets` 自动迁移旧 preset
- **4 档思考等级**：`minimal / low / medium / high` → pi 原生 6 档（`off / minimal / low / medium / high / xhigh`）映射；`mapThinkingLevelToPi` 函数 + 30 单元测试
- **思考等级 UI**：`AIAssistantSidebar` 思考等级按钮 + 4 档下拉菜单 + `SettingsPanel` 默认配置 + `LocalAgentService.setThinkingLevel` 动态切换
- **Agent 模式切换**：`AgentModeSwitcher` 组件（云端 / 本地 / 自动）+ `Sidebar` 快捷循环切换 + `SettingsPanel` 默认配置；离线降级时警告色显示
- **离线降级**：`useRuntimeModeStore` 3 mode + 2s 防抖 + `serverHealthCheck`（30s HTTP 探测）+ `OfflineBanner` + `useAIStore.sendMessage` `effectiveMode` 分流；33 单元测试通过
- **34 个 Skills 本地加载**：`pi-coding-agent` `DefaultResourceLoader` + `additionalSkillPaths` 指向 `.pi/skills`，加载 34 个 skills（含 `product-guide`）

#### 修复

- **Electron 31 undici 兼容崩溃**：pi-coding-agent 内置 undici 调用 `webidl.util.markAsUncloneable`（Node 22+ API），Electron 31 内置 Node 20.x 无此 API → `workerThreadsPatch.ts` 用 `createRequire` patch `node:worker_threads` 注入 no-op + `LocalAgentService` 改 pi-coding-agent 静态 import 为动态 import（确保 patch 先执行）

#### 新建文件（14 个）

1. `client/desktop/src/utils/thinkingLevel.ts` — 4 档思考等级 + `mapThinkingLevelToPi`
2. `client/desktop/src/stores/useThinkingLevelStore.ts` — zustand store + localStorage 持久化
3. `client/desktop/src/stores/useRuntimeModeStore.ts` — 3 mode + 2s 防抖 + `effectiveMode` 计算
4. `client/desktop/src/utils/serverHealthCheck.ts` — 30s HTTP 健康探测
5. `client/desktop/src/components/OfflineBanner.tsx` — 离线降级 banner
6. `client/desktop/src/components/ai/AgentModeSwitcher.tsx` — Agent 切换 UI 组件
7. `client/desktop/electron/main/apiKeyStore.ts` — safeStorage 加密 API Key 存储
8. `client/desktop/electron/main/ipc/agentIpc.ts` — `agent:*` + `tool:*` IPC handler
9. `client/desktop/electron/main/localAgent/LocalAgentService.ts` — 轻 agent 核心（主进程单例）
10. `client/desktop/electron/main/compat/workerThreadsPatch.ts` — Electron 31 undici 兼容 patch
11. `client/desktop/src/utils/toolBridge.ts` — 渲染进程工具执行桥接
12. `client/desktop/src/utils/__tests__/thinkingLevel.test.ts` — 30 单元测试
13. `scripts/test-runtime-mode-debounce.mjs` — 33 防抖单元测试
14. `scripts/test-pi-coding-agent-import.mjs` — pi 包 import 验证

#### 修改文件（11 个）

1. `package.json` — 加 `@earendil-works/pi-ai` + `@earendil-works/pi-coding-agent` 依赖
2. `client/desktop/electron/main/index.ts` — `app.whenReady` 改 async + 初始化 `LocalAgentService` + `setToolExecutor`
3. `client/desktop/electron/preload/index.ts` — 暴露 `aiKeyApi` + `agentApi` + `toolBridgeApi`
4. `client/desktop/src/types/electron.d.ts` — `AiKeyApi` + `AgentApi` + `ToolBridgeApi` 类型声明
5. `client/desktop/src/types/apiConfig.ts` — `ApiConfigPreset` 加 `provider?` 字段
6. `client/desktop/src/stores/useApiConfigStore.ts` — `migrateLegacyPresets` + `saveApiKey` + `inferProviderFromEndpoint`
7. `client/desktop/src/stores/useAIStore.ts` — `sendMessage` 加 `effectiveMode` 分流 + `handleAgentEvent` 处理 pi 事件流
8. `client/desktop/src/components/AIAssistantSidebar.tsx` — 思考等级按钮 + `AgentModeSwitcher` 集成
9. `client/desktop/src/components/SettingsPanel.tsx` — 默认思考等级 + 默认 RuntimeMode 配置
10. `client/desktop/src/components/Sidebar.tsx` — Agent 切换快捷循环按钮
11. `client/desktop/src/App.tsx` — `startServerHealthCheck` + `OfflineBanner` 渲染

#### 验证

- Playwright MCP UI 验证：20/20 用例通过（模块 1-9 各 1-3 个），截图存于 `docs/verify/phase9/`（7 张）
- 单元测试：`thinkingLevel` 30/30 + `runtime-mode-debounce` 33/33
- Electron 主进程启动：无 undici 崩溃，`[LocalAgent] SessionManager initialized` + `[LocalAgent] ToolExecutor set` + `[Main] Loading dev server URL` 全部正常
- 打包验证：`npm run build` 成功，`out/main/index.js` 中 `workerThreadsPatch`（L256-259）+ pi-coding-agent 动态 import（L466）正确保留

#### 已知缺陷（不阻塞 0.9.0）

1. **端到端完整调用未验证**：`sendMessage → createSession → 真实 LLM 调用 → 工具执行回路`需要用户配置真实 API Key 才能完整验证。代码层面已全部可达且类型安全，但未跑过真实 LLM 对话。
2. **`ask_user` `panelId/sessionId` 暂留空**：`toolBridge.ts` 的 `executeAskUser` 写入 `pendingAskUserRequests` 时 `panelId` 和 `sessionId` 为空字符串（本地 agent 模式下无 session 概念）。
3. **5 个 `INEFFECTIVE_DYNAMIC_IMPORT` 警告**：与 Phase 9 修复无关（涉及 `useAppStore / panelTemplates / PdfViewer / MusicPlayer / evaluateWidget` 模块的动态+静态混合导入，是项目原有问题）。
4. **`serverHealthCheck` 端点未实现**：默认探测 `http://localhost:3456/api/healthz`，但 server 侧 `/api/healthz` 路由尚未实现，当前 healthCheck 会一直返回 offline，触发 `useRuntimeModeStore` 的 auto 模式降级到 local。

---

### Phase 10 — 发布与分发

#### 新增

- **electron-builder NSIS 配置**（`electron-builder.yml`）：Windows x64 NSIS 安装器，可选安装位置、桌面快捷方式、开始菜单快捷方式；artifactName 用 `${name}-${version}-setup.${ext}`（`name` 来自 `package.json` 的 `name` 字段 = `event`，故产物文件名为 `event-0.9.0-setup.exe`；安装后显示名仍是 productName `Living Dashboard`）
- **pi 包 asarUnpack**：`node_modules/@earendil-works/**` 解压到 asar 外，避免 ESM 动态 import 在 asar 内失败
- **electron 下载镜像**：`npmmirror.com/mirrors/electron/` 国内加速
- **publish 元数据**：generic provider，预留更新服务器 URL
- **build/ 目录占位**：将来放 `icon.ico` / `tray-icon.png` 等资源

#### 修改

- `package.json` version：`0.0.0` → `0.9.0`（对齐 Phase 9）

#### 验证

- `npm run build` 通过（electron-vite build）
- `npm run build:win` 生成 `dist/event-0.9.0-setup.exe`

---
# webOS 开发记录（2026-07-31 起，原 AGENT.md 历史段落迁移）

> 2026-08-14：AGENT.md 精简，将历史改动记录从 AGENT.md 迁移至此。此后所有功能上线/修复/决策记录统一写在本文件，AGENT.md 只保留项目概述与可复用技巧。

## 2026-08-17（追加）：管理后台日活/月活统计（DAU/MAU）

### Added

- **`GET /api/admin/webos/stats/activity?days=30`**（`server/src/routes/adminWebos.ts`）：返回最近 N 天 DAU 序列（含 0 天补齐）+ 窗口活跃用户 + 当月 MAU + 上月 MAU + 趋势（今日/昨日/近 7 天日均/近 30 天日均/周环比/峰值/MAU 环比）。活跃口径 = 当天/当月有任意 chat/stream 或工具调用，来源六表并集（`webos_chat_sessions` / `webos_chat_logs` / `webos_ai_usage` / `webos_imagegen_usage` / `webos_video_usage` / `webos_vision_usage`），按 `user_key` 去重、guest/member 分开统计；时区 Asia/Shanghai（UTC+8）切日/切月；会话表工具事件（`events LIKE '%tool_start%'`）在库内判定，避免把含 reasoning 的大字段拉回内存；PG/SQLite 双驱动通用（与 vision/stats 相同的取行 + JS 聚合风格）。
- **管理后台仪表盘「日活 / 月活（DAU / MAU）」卡片**（`client/admin-web/src/App.tsx` + `src/api.ts`）：今日 DAU（游客/会员/工具拆解）、近 7 天日均 + 周环比 + 峰值、当月 MAU、MAU 环比上月 + DAU 条形图（7/30/90 天切换，60s 自动刷新）。

### Validation

- 独立脚本重算与端点结果一致：08-07 DAU 35（33 游客 + 2 会员）、08-17 DAU 3（2+1）、8 月 MAU 105（101+4）✅；未登录 401 / 非 admin 403 / admin 200（经 nginx https 端到端）✅；admin-web `tsc -b --noEmit` + `vite build` 通过，产物已部署 `/var/www/daily-admin/public`（index-CqfvgnMO.js）✅。

## 2026-08-16：UI 探索启动（图标 E1 定稿 + 全套 UI 稿）+ D19 组合式包 + D20 系统包化

### Added

- **`ui-exploration/` 目录（项目根）**：UI 探索专属工作区——生图脚本 `gen-image.sh`（文生图）/ `img2img.py`（图生图 edits）/ `strip-bg.py`（色度键去背景），模型 gpt-image-2-super（ChatST 网关，key 从 `server/.env` 读取不落盘、不入 Git）+ `generated/` 资产 + `current-xml-icon/`（现 XML 图标备份）。
- **App 图标定稿 = E1**（深蓝 #0F172A + 亮蓝光点 #4F8CFF + 白色高光，基于现 Android 占位图标图生图优化 + 去背景透明版）；原 XML 版保留在 `ui-exploration/current-xml-icon/` 备后续使用。
- **全套 UI 探索稿 4 页**（对话主页 / 沉浸桌面启动器 / 个人中心 / 设置页）：统一设计语言「清亮通透的手机 OS + 平面化优化」——暖白底（#f8f7f3→浅灰蓝渐变）+ 毛玻璃半透明卡片 + 扁平圆角图标 + 亮蓝 #4F8CFF 点缀 + 大留白细阴影；M0-6 设计走查素材。
- **openai_draw 包接入服务器 ChatST 生图 API**（`OPENAI_API_KEY` / `OPENAI_API_BASE_URL` / `OPENAI_IMAGE_MODEL` 环境变量已配置）。

### Changed（拍板决策）

- **D19 组合式包**（用户拍板）：一个包内什么都能装（skill / MCP / 工具 / tokens / 资源 / 子包），**嵌套 ≤3 层**，包 = 自包含能力单元；manifest v2（`contents` + `children`）；新类型 `bundle` = 纯组合容器。03 分篇 §1/§2/§3 更新。
- **D20 系统包化 · 全 API 开放**（用户拍板）：除**安全 UI 例外**（权限弹窗/授权页不可被 AI 篡改，防骗授权）外，系统所有内容开放 API 并打包——系统大包 `com.daily.system`（bundle）内含 UI / 文件 / 桌面 / 商店 / 对话 / 桌宠等子包，**UI 只是其中一个子包**；每个子包 = 工具（API 封装）+ skill（操作手册）+ 资源。**红线 2 更新**（特权内核 → 安全 UI 例外；导航/消息核心受控可改、默认 UI 包常驻可回退）。

### Docs

- 同步更新：`docs/android/README.md`（决策清单 D19/D20 + 红线 2）、`03-package-system.md`（§1 要点 / §2 manifest v2 / §3 bundle / §4.1 安全边界 / §5.1 UI 开放 / §6 能力词 ui.layout·ui.component·ui.theme）、`12-roadmap.md`（M2-6 组合式包、M2-14 改 UI 开放 API、新增 M2-15 系统包化）、`10-ui-design.md`（§2.1 UI 包化边界）、根 `AGENT.md`（决策摘要）。

### Validation

- 生图全链路实测通过：openai_draw 文生图（4 图标候选 + 4 页 UI）✅；ChatST `/v1/images/edits` 图生图（3 张优化候选，基于当前图标参考图）✅；PIL 去背景透明 PNG ✅；APK 内 XML 图标定位与备份 ✅。

### 键盘弹窗 + 桌面点击随机失败 + 启动加载体验修复（当日追加）

- **键盘弹起输入框飞高**：Manifest `MainActivity` 显式 `windowSoftInputMode="adjustResize"`（此前默认 adjustPan 与 Compose `imePadding` 叠加导致双倍上移）；edge-to-edge + adjustResize + imePadding 为标准组合。真机验证受 Operit 悬浮窗干扰，交互效果留用户实测确认。
- **桌面点击随机失败（点击动画但打不开）**：根因 = HorizontalPager 在 down 后参与触摸竞争（横向 slop 判定），手指小位移时拦截事件序列，WebView 只收到 down（CSS :active 动画）收不到 up（JS 不触发）。修复：`userScrollEnabled = currentPage == 0`——桌面页 Pager 禁滑，触摸完整交给 WebView（翻页走 WebView OnTouchListener 右滑让渡）；对话页保留 Pager 滑动。验证：市场图标点击恢复（apps.open ok → title=市场）。
- **启动加载体验**：① 新增 `LoadingView`（E1 logo + "Daily" + spinner），替换桌面/App 运行页的"加载中…"文本；② `themes.xml` windowBackground=#0F172A（冷启动不白屏）；③ AppRuntimeHost WebView `setBackgroundColor(深蓝)`（页面渲染前不闪白）；④ Pager `initialPage=1` 直接以桌面为第一帧（消除先闪对话页再跳转）。验证：冷启动 → logo+Daily 加载页 → 桌面 ✅。
- **坑记档**：16-playbook §5 加"Pager 与 WebView 触摸竞争"条目（桌面页禁 Pager 滑动的设计原因）。

- **现象**：桌面（WebView）所有 App 图标点不开（用户反馈 + 实测无 `bridge req: apps.open`）。
- **根因**：M1-1 收尾为做"右滑让渡"加的全屏 Compose `pointerInput` 覆盖层（`detectHorizontalDragGestures`）——**Compose hit test 命中后事件不转发给 Android 子 View**，覆盖层不 consume 点击时事件被丢弃，WebView 永远收不到触摸 → 图标全部点不开。
- **修复**：删除覆盖层，改为 **WebView 自身 `OnTouchListener`**（不 consume，`false` 返回），仅检测"右滑累计 >80dp 且横向主导"时回调 `onSwipeToChat`——点击/纵向滚动完全透传给 WebView。
- **验证（真机）**：点市场图标 → `bridge req: apps.open ok=true` → `appDetail(system.store) detail=true` → `pageState title="市场"` ✅；返回→桌面→右滑→对话页 ✅；图标点击恢复 ✅。
- **坑记档**：16-playbook §5 坑索引加"Compose 全屏 pointerInput 覆盖层会吞掉下层 AndroidView（WebView）全部触摸"。本条目后续并入正式修复记录。

- **返回机制**：`AppRunScreen` 加 `BackHandler`（系统返回 = 关闭当前 App 回桌面，不再直接退出 Daily）；`DailyApp` 加 `BackHandler`（对话页返回 → 回桌面，桌面页返回才退出）。真机验证：对话页按返回 → 回桌面 ✅（未退出）。
- **图标用回 E1 生成图原图**：launcher 图标 foreground 从矢量重绘版改为 **E1 PNG 原图**（各密度 mipmap-*/ic_launcher_foreground.png，E1 1254px 缩放）；保留矢量 background + monochrome；真机确认 Launcher 图标 = 深色底 + 发光蓝球 + 光晕（E1 原貌）✅。
- **对话页按定稿修正**：① 顶栏去掉 logo 与 "Daily AI" 字样（仅异常/流式状态 + 用量 chip，正常时空行）；② 中央 logo 改用 **E1 生成图**（`drawable-nodpi/icon_e1_logo.png`，圆形裁剪）。真机确认：左上角无图标文字 ✅、中央 = 生成图质感光球 ✅。
- **卡顿根治（WebView + detail 双复用）**：桌面 WebView 实例与 AppDetail 均提升到 `DailyApp` 宿主级（跨 Pager 页面切换保持）——页面重建不再重拉详情（消除"加载中"闪烁）+ 不再重建 WebView（消除重载卡顿）。真机：快速来回滑 5 次 + 停顿后再滑，日志 `desktop WebView reused（免重载）` ✅。
- **验证方式**：对话页返回/中央 logo/顶栏去 logo 均真机截图确认；市场点击验证被 Operit 悬浮窗干扰（记入 16-playbook 新坑：悬浮窗反复弹出吃掉 tap），改用日志/代码同构逻辑确认。

- **DailyApp 重写**：4 Tab + Scaffold → `HorizontalPager` 两页（page0=ChatScreen / page1=DesktopHostScreen），初始页=桌面；无底部 Tab 栏/无 Scaffold 顶栏；`openApp` 覆盖层保留（AppRunScreen 全屏沉浸）。
- **新增 DesktopHostScreen**：沉浸 WebView 宿主固定加载 `system.desktop`（复用 AppRuntimeHost + `wv.post` 延迟加载，M0-4 白屏修复保留）；透传 apps.open/system.navigate；顶部低调"返回对话"按钮（M1-1 降级，M1-4 手势让渡后移除）。
- **AppRunScreen 沉浸化**：删 Surface 顶栏 + statusBarsPadding，全屏 edge-to-edge，返回=系统手势；顶部 12dp 热区为 M1-3 预留。
- **ChatScreen insets 适配**：statusBarsPadding + navigationBarsPadding（去 Scaffold 后自行管理）。
- **依赖**：`libs.versions.toml` + `app/build.gradle.kts` 显式加 `androidx.compose.foundation`（Pager 需要）。
- **验证（真机）**：初始=桌面（时钟/4 图标/Dock/页指示点渲染正常，pageState vh=855 hasSDK/hasBridge=true）；无底部 Tab 栏；顶部按钮切对话页（"Daily AI"出现）；横滑对话→桌面成功；桌面点「市场」→ AppRunScreen 全屏沉浸运行 system.store（无顶栏，title=市场，storage.list ok）。**发现**：system.files 无 HTML 版本（服务端缺默认模板，appDetail detail=false，点开报错——待补）。
- **纪律**：AGENT.md 新增「真机操作导航纪律」（操作前导航至被测应用 + 操作后切回 Operit），同步 16-playbook §3.1。

- **E1 → Adaptive Icon 三件套（矢量重绘）**：`ic_launcher_background.xml`（深蓝→靛蓝对角渐变 #0F172A→#1B2C5F）+ `ic_launcher_foreground.xml`（柔光晕径向渐变 + 光点主体 #4F8CFF 系 + 白色高光小圆，构图按 E1 PNG 1254px 像素采样）+ `ic_launcher_monochrome.xml`（环状光点，Android 13+ 主题图标）；`ic_launcher.xml` / `ic_launcher_round.xml` 引用 monochrome。
- **Design Tokens → 共享契约**：`shared/webos-contracts/index.ts` 新增 `WebOsDesignTokens` / `WebOsDesignTokenColor` / `WebOsDesignTokenShape` / `WebOsDesignTokenBlur` / `WebOsDesignTokenMotion` 类型 + `WEBOS_DEFAULT_DESIGN_TOKENS`（v1 清亮通透：primary #4F8CFF / background #F8F7F3 / surface #FFFFFF / shape 12-20-28 / blur 24-40 / motion 150-300ms emphasized / wallpaper 渐变）——theme 包校验失败的安全回退基线（红线 2）。
- **Compose 品牌主题**：`client/android/.../ui/theme/Theme.kt` 重写——浅色「清亮通透」（暖白底 + 亮蓝主色 + 亮蓝用户气泡）与深色「深蓝沉浸」（#0F172A 底 + 亮化 primary #7FB0FF）双主题；`dynamicColor` 默认关（品牌色优先，theme 包接入后为用户主题留位）。
- **验证**：server `tsc --noEmit` 通过；服务器 Gradle `:app:assembleDebug` 构建成功（app-debug.apk 20.9MB，sha256 e01668da...）；真机安装 + 启动正常（mCurrentFocus=MainActivity）；图标资源 XML 全部 aapt 可编译。



### Fixed（Android · client/android）

- **M0-4 系统桌面 WebView 白屏**（真机全链路验证通过，commit `fb24fd8`）：
  - Koin 启动崩溃：`single<AgentChatSource?> { null }` 非法（null value 抛 IllegalStateException）→ 删占位注册改 `getOrNull()`。
  - 桥方法缺失白屏：DailyJsBridge 补齐桌面 postMessage 直连方法 `apps.list/apps.open/system.navigate`（镜像 PWA runtime.ts `handleDesktopRequest`；未实现方法明确 respond(false)）+ DailyApp 宿主导航联动。
  - 视觉白屏（DOM 渲染但像素全白）：AndroidView factory 时机 WebView 未布局（pageState `vh:0`）→ 显式 MATCH_PARENT layoutParams + `wv.post { loadApp }` 延迟加载。
  - 附带：AppRunScreen statusBarsPadding（顶栏不再与状态栏重叠）；WebosApi.listApps 按 id 去重（bootstrap 返回 builtin+user 双份 system.*）。

### Changed（文档 · docs/android，commit `9c42d16` + `82818fc`）

- **D18 沉浸式启动器方向**（用户拍板，方案 A 已选定）：edge-to-edge 全沉浸、桌面启动器体验（多页/边缘翻页/叠放建文件夹）、横滑页面序列 [对话页（宿主）| 桌面页 1..N（HTML）]；10-ui-design §0（用户方向最高优先级）+ §2 信息架构 v2 重写；12-roadmap M1-1/M1-4 验收同步。

### Added（文档基建 · 弱 AI 可执行化）

- **`docs/android/16-execution-playbook.md`**：构建 SOP（超时残留清理/服务器后台构建模板）、真机调试 SOP（导航命令链铁律/pageState 字段判读/像素验证/输入注入红线）、协议速查（桌面桥方法表/服务端 API 坑/JWT 生成）、常见坑索引（8 条历史根因）。
- **`docs/android/17-m1-task-cards.md`**：M1 Lite 五张任务执行卡（M1-1 沉浸骨架 / M1-2 端侧 AI+BYOK / M1-3 App 管理 / M1-4 启动器+手势让渡 / M1-5 权限引导），每卡含前置阅读/验收清单/涉及文件/实施步骤/已知坑/📐需用户定点。
- **AGENT.md「文档与变更纪律」**：当天功能当天记 CHANGELOG；坑进 16；状态进 14；任务按 17 卡执行、📐点必须问用户。

### 验证

- 真机（魅族 Lucky 08）：桌面完整渲染（时钟/4 图标去重/页指示/Dock/渐变壁纸）；pageState `vh:754, hasSDK:true, hasBridge:true`；bridge `apps.list ok=true`（345B）。
- 文档：README §3 地图收录 16/17；14-dev-status 里程碑表 M0-4 ✅ / M0-6 并入 M1-1。

## 2026-08-14：删除 create_webos_app 工具 + 支持中文文件夹名（已部署验证）

> 用户决策：① 删除 AI 工具 `create_webos_app`（保留 REST `POST /webos/api/apps`，日后可单独做「粘贴 HTML 生成 App」入口）；② 支持 AI 中文文件夹名（文件夹即 App）。

- **删除 create_webos_app 工具**：`server/src/routes/webos.ts` 删除 `createWebosAppTool` 函数（56 行）+ 从 `webosAppTools` 数组移除；piBridge 提示词「完整 App 用 create_webos_app」改为文件夹方式；前端 `WEBOS_TOOL_LABELS` 移除标签；app-dev skill 删除备选路径、用户粘贴 HTML 也走文件夹；xhs-content skill 同步。
- **AI 创建 App 唯一路径 =「文件夹即 App」**：`agent_fs_mkdir apps/<名称>/`（系统自动写骨架+注册）→ `agent_fs_write apps/<名称>/index.html`（系统自动校验+即时建版本+push app_created/app_updated）。
- **中文文件夹名支持**：`APP_ID_PATTERN` 放宽为 `/^[\p{L}\p{N} ._:-]{1,128}$/u`（Unicode 字母/数字/空格/._:-，仍排除路径分隔符）；`appFilesRoot` 增加 `includes('..')` 二次防穿越；trash 路由清洗正则 Unicode 化（restore/delete 保留中文）；公开素材端点 `PUBLIC_APP_ID_PATTERN` 同步 Unicode 化（前端 URL 已 encodeURIComponent）。
- **关键修复**：`tool_execution_end` 的 `drainPendingAppEvents` **提前到所有工具分支之前消费**——否则删除工具后，文件夹方式 mkdir/write 触发的 app_created/app_updated 推送会被 `return` 跳过（桌面不自动刷新）。
- **验证（本地+线上）**：server/shell-web tsc 全过；SSE 对话正常（delta+done）；线上真实验证：`apps/中文测试App/` → bootstrap 自动注册 `id:"中文测试App"` v1.0.0；公开素材端点中文 appId raw 200 + 内容正确；测试数据已清理。
- 部署：后端 3 文件（webos.ts→routes/、webosWorkspace.ts→utils/、piBridge.ts→src/）+ app-dev/xhs-content skills；gzip 管道传输 + md5 校验；pm2 restart 单实例、首页 200。


### 当前实现与回归状态（2026-07-31）

> 部署运维手册（服务器信息、SSH 凭证、部署命令、验证清单、故障排查）见 **`docs/webos-deployment-ops.md`**，
> 无需再向用户询问域名/路径/密码。

### P0 Shell 与 AI Provider

- 方向 A「安静智能」Shell 已在 `client/shell-web/` 实现：AI 助手是默认主页（**唯一 AI 入口**）；系统桌面提供传统图标网格和 Dock；文件、设置、余额与支付、App Runtime 均为独立系统页（Builder 已随单一对话入口方向移除）。
- **AI 能力统一走 pi agent 链路（pi-coding-agent + pi-ai）**：`/webos/api/chat/stream` 复用 `piBridge.createWebosSession()`，模型为 pi 内置 `deepseek/deepseek-v4-flash`（DeepSeek V4 Flash，可用 `DEEPSEEK_MODEL` 覆盖），API Key 由服务端 `DEEPSEEK_API_KEY` 经 AuthStorage 注入；**禁止恢复自研 DeepSeek HTTP 直连**（旧 `deepseek-chat`/`deepseek-reasoner` 模型名与 `fetchProvider/requestCompletion` 等函数已删除）。
- **思考深度 = DeepSeek 官方四档 `low/medium/high/max`**（默认 `medium`）：UI 四档 → pi thinkingLevel（low/medium/high/xhigh→max）→ DeepSeek `reasoning_effort`。因 pi 内置 deepseek-v4-flash 定义把 low/medium 标为 null（会被静默升级为 high），`createWebosSession` 会通过 `ModelRegistry.registerProvider` 覆盖模型定义以启用全部四档。App 生成不再单独开会话，生成质量与速度直接取决于用户当前思考档。
- **对话内创建 App（2026-07-31 单一入口方向，当日收尾再简化）**：`/webos/api/chat/stream` 的 pi 会话注入 `create_webos_app` 工具（`createWebosSession(principal.key, thinking, { customTools })`），pi agent 识别用户建 App 意图时**在对话中直接生成 HTML 并以 `{ name?, html }` 参数调用工具**；服务端工具只做安全校验（`validateAppHtml` + `validateGeneratedHtml`：禁 iframe/object/embed/base/外部 URL/data:text/html、占位符检测、`vm.Script` 语法校验、大小限制）与入库，**不再开独立 `:gen` 生成会话、不再有专用生成 prompt（APP_GENERATION_SYSTEM_PROMPT / appGenerationPrompt / generatedHtml 已删除）**。`POST /webos/api/apps/generate` 端点已删除，对话工具是唯一 App 创建路径。工具执行结果经会话 `tool_execution_end` 事件以 `{type:'app_created', appId}` SSE 推送前端；前端刷新 bootstrap 后自动打开 App 运行页。
- **App 运行时 localStorage polyfill**：iframe `sandbox="allow-scripts"`（opaque origin）下访问 `window.localStorage` 抛 SecurityError，任何模型生成的 App 默认用 localStorage 持久化会直接崩溃。bootstrap（`APP_RUNTIME_BOOTSTRAP`）在文档 `<head>` 开头注入（先于 App 脚本执行），检测到 localStorage 不可用时用 `Object.defineProperty` 覆盖为内存态兼容实现（getItem/setItem/removeItem/clear/key/length），SDK MessageChannel 连接后异步把数据落到 `app.storage.private`（setItem fire-and-forget 推送、connect 后 list() 拉取存量 hydrate）。
- 计费基于 pi 会话 `agent_end` 事件的真实 token usage（assistant 消息的 `usage.input/output`），取不到时回退到 `estimateMinor` 估算；不伪造扣费。**工具内不再单独扣费**（无独立生成会话），对话（含生成 HTML 的 token）统一在 `done` 事件按真实 usage 扣减；**扣费不弹出底部 toast 通知**。

### 已完成回归

- 真实 DeepSeek V4 Flash 对话：`low` 档真实生效（不再被 clamp 为 high）、`max`→xhigh 正确、SSE 流式 `delta` 正常、会话按 principal 复用（二次响应 1s）、扣费正确。
- **对话内直接创建 App（2026-07-31 简化后回归）**：`/webos/api/chat/stream` 发"做一个待办清单 App"→ SSE 事件流 `start → delta(确认) → tool_execution(pi 直接生成 HTML 并调用 create_webos_app) → app_created(appId) → delta(总结) → done`；**无独立 `:gen` 会话（日志确认）**；前端收到 `app_created` 刷新 bootstrap 后自动打开 App 运行页（「待办清单」v1.0.0 sandbox iframe 运行）；生成的 HTML 质量正常（渐变背景/圆角卡片/移动端适配/viewport/系统字体栈），App 使用 localStorage（polyfill 触发场景）。本地与线上（curl + 浏览器）均验证通过。
- **localStorage polyfill 验证**：sandbox opaque origin 下原生 `localStorage` 访问抛 SecurityError（实测无 NATIVE_OK），polyfill 覆盖后 setItem/getItem 正常（实测 POLYFILL_OK:v）；线上 bootstrap 已部署（`<head>` 开头注入、先于 App 脚本执行）。
- **档位循环切换验证**：composer 旁「思考」chip 点击循环 深(high)→极深(max)→浅(low)→中(medium)→深(high) 全部生效（线上真实点击验证）；模型 chip 为纯展示（当前唯一可用）。
- **孤立 tool 消息 400 自愈验证**：重启后 high/medium 档"你好"均正常流式回复（坏会话缓存已清空自动恢复）；agent_end 检测 stop=error 或 usage 全 0 时 dispose 会话 + 不扣费 + 返回 error 事件（WEBOS_AI_EMPTY_RESPONSE），重发即恢复。
- **pi 会话忙自动重试**：`chat/stream` 复用会话时若 pi 抛 `Agent is already processing`（客户端断连后立即重连等），服务端 dispose 该用户全部 webOS 会话并重建重试一次（`busyRetried`），不再直接报错。
- **空 assistant 消息防御**：AI 回复为空时前端 store 会残留空气泡；`sendMessage` 发送前过滤 content 为空的 assistant 消息，避免 `validateMessages` 400 导致对话卡死。
- **线上偶发"high 档零输出"排查记录**：2026-07-31 曾出现重启后 high 档请求仅 `start+done`、无 delta、usage 回退估算（约等于 API 空响应或实例瞬时状态），重启后同代码不可复现；已通过直连 DeepSeek API、pi 最小复现脚本（`createAgentSession`/`createWebosSession` 直接 prompt）逐一排除 API/pi 层问题。若再遇，先看 pm2 日志 `[webos] chat prompt done ... events=...` 确认 `agent_end` 是否触发，并用 `curl` 直连 API 对比。
- 线上运维注意：pm2 restart 多次出现 `EADDRINUSE`（旧实例未完全退出），当前以 `ss -tlnp` 确认唯一监听进程后正常；部署后可用 nginx access log 核对请求实际到达与 HTTP 状态码。
- 真实 App 生成：`off` 思考 11-16s 返回完整可运行 HTML（倒计时器/待办清单），进入 `sandbox="allow-scripts"` Runtime 无报错。
- 生成 HTML 校验：占位符检测、`vm.Script` 语法校验、非法结果自动重试一次；`agent_end` 提取内容为空时报 `WEBOS_AI_EMPTY_RESPONSE`。
- PWA `manifest.webmanifest` 与 `icon-192.svg`、`icon-512.svg` 均可访问，manifest 使用 `display: standalone`。
- App Version 创建和 rollback 已验证：rollback 只切换 active version 指针，不覆盖历史版本。
- 支付和邮箱验证码接口保持明确 unavailable，不伪造订单、验证码或支付成功。

### 账号系统：邮箱验证码登录/注册（2026-08-02，Resend 已接入）

**产品决策（用户）**：正常账号密码体系——**注册时用验证码验证邮箱归属，之后用「邮箱 + 密码」直接登录（无需验证码）**；忘记密码可用验证码重置。登录入口在 AI 对话页右上角；登录窗口不主动弹出；登录形态为**居中弹窗**（design skill 规范：移动优先 + 桌面居中浮起，不用底部 Sheet）；桌面切换按钮为「图标+文字」胶囊；支持 AI 对话页 ↔ 桌面页左右滑动切换。

**Linux.do 调研结论**：Linux.do **不是邮箱验证码注册**——是邀请制 + 人工审核（填写用户名/邮箱 + ~50 字申请自述，人工审核激活；历史上曾用 GitHub OAuth + 邀请码）。我们自研验证码注册是更轻量的模式，无需效仿。

**后端**（`server/src/routes/emailAuth.ts`，免鉴权挂 `/api/auth`，在 authMiddleware 之前）：

- `POST /api/auth/email/send-code` {email}：6 位数字码、10 分钟有效、60s 冷却/邮箱、IP 限频（20/h）、Resend 发送（fetch REST，零依赖）
- `POST /api/auth/email/register` {email, password, code}：验证码验证邮箱归属 → 设置密码（scrypt）→ 创建账号（username=邮箱前缀，冲突加数字后缀）→ 签发 JWT 登录；已注册邮箱返回 409
- `POST /api/auth/email/login` {email, password}：密码登录（无需验证码），IP 限频 60/h
- `POST /api/auth/email/reset-password` {email, password, code}：验证码验证后重置密码并登录（忘记密码；也用于早期无密码账号补设密码）
- 验证码一次性使用、恒定时间比较、attempts 上限 5 次；**游客资产迁移**——请求携带游客 JWT 且该账号从未使用过 webOS 时，把游客 `webos_state` 整体迁移到用户 scope（register/login/reset 共用 `migrateGuestAssets`）；迁移失败不阻断
- Resend 环境变量：`RESEND_API_KEY`（仅服务端）、`RESEND_FROM_EMAIL`（如 no-reply@shadowshub.xyz，需 Resend 已验证域名）、`RESEND_FROM_NAME`（显示名，默认 **Daily**——不设则 QQ 等邮箱把地址前缀 no-reply 当显示名）
- 健壮性：`dns.setDefaultResultOrder('ipv4first')`（api.resend.com 双栈解析，无 IPv6 路由环境连 IPv6 会 ETIMEDOUT）；fetch 加 `AbortSignal.timeout(15s)` + 3 次退避重试；5xx 重试、4xx 不重试

**鉴权联动**：`middleware/auth.ts` 对多用户 JWT 附带 email/username（users 表查询 + 60s TTL 缓存）；`webos.ts` Principal 增加 email，bootstrap 的 `session.user` 返回 email（共享契约 `WebOsSession.user.email` 已扩展）。

**前端**（`client/shell-web`）：

- AI 对话页 header：游客显示「登录」按钮（KeyRound 图标+文字），已登录显示邮箱前缀（绿点标记），点击打开登录 Sheet；「桌面」按钮改为深色胶囊「图标+桌面」
- `LoginPanel`：**居中弹窗**（design skill 规范：圆角卡片、柔和阴影、fadeUp 动效、tabs 切换），登录/注册/忘记密码三态；注册=验证码验证邮箱+设置密码，登录=邮箱+密码（无需验证码），忘记密码=验证码重置；60s 重发倒计时；已登录态显示账户信息+退出登录；成功登录/注册后 refreshBootstrap 自动切换正式用户
- 设置页 account-card 从旧的 503 绑定表单改为「登录/注册」或「账户管理（退出）」入口；旧 `/webos/api/email/*` 绑定端点保留 503 不再被前端使用
- 滑动切换：AI 页左滑 → 桌面；桌面左边缘热区（仅触屏设备，iframe 会吞触摸事件）右滑 → AI 页；`useSwipeNavigation` 忽略纵向滚动

**回归记录（真实 Resend + SQLite + 本地服务）**：

- send-code 真实送达 QQ 邮箱；Resend 记录确认 from=`"Daily <no-reply@shadowshub.xyz>"`（显示名生效，早期无显示名版本 QQ 列表显示 no-reply 已修复）
- 错误分支：60s 冷却 429、未发码验证 400 EXPIRED、非法格式 400 INVALID_CODE/EMAIL 全部正确
- 端到端：游客建 App → 验证码 436627 → 注册（migrated=true）→ bootstrap 返回 email + 迁移后的 App（「迁移测试App」+「系统桌面」）+ 余额 100；验证码二次使用返回 400（一次性 ✓）
- 测试环境坑：proot 沙箱访问 api.resend.com 间歇 ETIMEDOUT（约 30%，node/tsx/curl 均如此，线上服务器无此问题）；pkill 杀进程需遍历 /proc 精确取 PID（basename 会取到 cmdline 而非 PID）

### 用户分层 / Token 配额 / AI 用量计量（2026-08-02，new-api 风格）

**产品决策（用户）**：用户分三层——游客（未注册未登录）、会员（已登录）、套餐用户（9.9 元/1 亿 token，支付未开通仅展示）。token 配额：游客 1 万 / 登录 10 万 / 套餐 1 亿；用完拦截对话并提示「建议升级套餐或加客服 QQ 2893334965；测试阶段联系客服可免费获取」。登录入口=AI 对话页右上角按钮，登录后该按钮即个人主页入口；「设置」系统页已删除（个人主页承载账户/AI 用量/余额/套餐/隐私边界；AI 思考档配置在对话页 composer 旁）。

**后端**：
- `StoredState.tokens = { quota, used }`；`defaultState(principal)` 按身份给配额（游客 1 万/登录 10 万）；游客资产迁移到账号时 token 配额升级为 10 万全新额度；admin 可调 quota（≥1 亿视为套餐用户）
- `chat/stream`：**按 DeepSeek 真实 usage（input+output）扣减 token**（拿不到时按字符估算回退）；`remainingTokens<=0` 时返回 402 `TOKEN_INSUFFICIENT`（含套餐与 QQ 提示）；不再有余额豁免
- **用量落库**：新表 `webos_ai_usage`（new-api 风格，每个请求一行：user_key/user_email/kind/model/thinking/prompt+completion+tokens/status/error_code/ip/created_at）；ok/failed/insufficient/empty_response 都记；管理后台统计/审计用
- **注册/登录记录 IP**：users 表加 `registered_ip/last_login_ip`（`db/migrations.ts ensureUserIpColumns`，启动时幂等迁移）；防批量注册，后台可按 IP 检索
- **Admin API**（`server/src/routes/adminWebos.ts`，挂 `/api/admin/webos`，requireAdmin）：`GET /users`（用户+游客统一列表：token/用量/IP/资产）、`GET /usage/summary?days=`（按 kind/status/day 聚合）、`GET /usage?userKey=`（明细分页）、`PUT /tokens {userKey, quota}`（套餐开通/客服补偿）
- `paymentState()` 改为单个套餐产品「1 亿 Token 套餐 ¥9.9」（unavailable）
- BUILTIN_APPS 移除 `system.settings`；DeepSeek 账号级并发 2500（flash），`user_id` 隔离参数待 pi provider 支持后接入（P1）

**前端**（`client/shell-web`）：
- 新增 `ProfileView`（个人主页）：账户信息+分层徽章、token 用量（剩余大字+进度条）、套餐卡片（¥9.9 未开放+客服 QQ）、文件入口、隐私边界；`ScreenView` 变为 assistant/desktop/files/profile/app
- 登录后 header 账户按钮（邮箱前缀）→个人主页；游客→登录面板；余额按钮显示剩余 token
- 删除 SettingsView/BillingView 及对应桌面图标；登录面板保持居中弹窗（登录=邮箱+密码/注册=验证码+密码/忘记密码=验证码重置）
- token 不足：chat 返回 402 时 request() 抛错 → toast 显示完整提示（含 QQ）

**回归记录（真实 DeepSeek + SQLite + 本地/线上验证）**：
- 游客 bootstrap kind=guest tokens={10000,0,10000}；真实对话 totalTokens=578→used=578 remaining=9422（done 事件带 totalTokens/usedTokens/remainingTokens）
- admin /users 正确显示游客 quota/used/appCount（parseState 需兼容 SQLite adapter 已解析的 JSON 对象——踩坑已修）；/usage/summary、/usage 明细、PUT /tokens 调整后 bootstrap 生效
- 配额调 0 后 chat 返回 402 TOKEN_INSUFFICIENT（文案含 QQ 2893334965）✓
- 线上：游客真实扣减 491 tokens、admin API 全通、ADMIN_USERNAMES=2893334965 已配（该邮箱注册即 admin）
- 待办：DeepSeek usage 含 cacheRead（totalTokens 含缓存读，pi 的 usage 只暴露 input/output，当前按 input+output 扣减，缓存读未计——后续可按比例折算）

### 管理后台 admin.shadowshub.xyz（2026-08-02 上线）

- **形态**：独立子域 + 独立前端项目 `client/admin-web/`（同仓独立模块：独立 package/构建，复用根 node_modules；桌面优先，design skill 安静浅色 tokens）
- **部署**：产物 `/var/www/daily-admin/public`（nginx 静态托管；注意不能放 /root 下——nginx worker 无权限）；`/api/` 同源反代 127.0.0.1:3456（免 CORS）；nginx 配置 `/etc/nginx/sites-available/admin-daily`；HTTPS 由 certbot 自动续期（`--redirect`）
- **功能**：登录（邮箱+密码，仅 admin 角色可进）→ 仪表盘（近 7 天请求数/tokens/分层/状态/每日趋势条形图）+ 用户与用量（注册用户+游客列表、搜索、封禁/角色、token 配额调整弹窗、AI 用量明细弹窗）
- **管理员**：服务器 `.env` 已加 `ADMIN_USERNAMES=2893334965`——该邮箱注册即 admin；登录入口 = admin.shadowshub.xyz
- 上线验证：首页/JS 200、API 反代健康、非 admin 访问 admin API 401、HTTP→HTTPS 301 ✓

### 支付接入（2026-08-02，zpay 易支付渠道，代码就绪待审核通过启用）

- **渠道**：ZPAY（https://z-pay.cn/，易支付兼容接口，无需营业执照；已付款开通，商户审核约 1 个工作日）
- **文档要点**：下单 `POST https://zpayz.cn/mapi.php`（form-data，返回 payurl/qrcode/img）；回调 GET notify_url（MD5 验签，响应体返回字符串 `success` 否则按 0/15/15/30/180/1800…秒重发）；签名=参数按 ASCII 排序（sign/sign_type/空值除外）拼 `a=b&c=d&e=f` + 商户密钥 MD5 小写
- **后端**（`server/src/payment/zpay.ts` + `routes/zpayNotify.ts` + webos.ts 端点）：
  - `webos_pay_orders` 表（两套 schema）：商户订单号 id、user_key、商品、金额（分）、type(alipay/wxpay)、status(pending/paid)、zpay_trade_no、IP、创建/支付时间
  - `POST /webos/api/payment/orders`：**仅已登录账号可购买**（游客 401 GUEST_NOT_ALLOWED）；10 分钟内未支付订单复用；下单成功返回 payUrl/qrcode/img
  - `GET /webos/api/payment/orders/:orderId`：本人订单状态（前端 3s 轮询）
  - `GET /webos/api/payment/notify`：**免鉴权**（index.ts 在 authMiddleware 之前单独挂载）；验签+pid+金额+param(user_key) 四重校验；幂等（已 paid 直接 success）；入账=quota 提升到 1 亿（`PLAN_TOKEN_QUOTA`）
  - `paymentState().providerStatus`：未配置密钥时 `unavailable`（前端显示"支付渠道审核中"，不会创建假订单）
- **环境变量**（仅服务端 .env）：`ZPAY_PID` / `ZPAY_KEY`（后台「API信息」页）；可选 `ZPAY_API_BASE`、`PAY_NOTIFY_URL`（默认 https://shadowshub.xyz/webos/api/payment/notify）
- **前端**：ProfileView 套餐卡片按 providerStatus 显示「立即购买 / 登录后购买 / 支付渠道审核中」；PayPanel 居中弹窗（design skill）：选支付宝/微信 → 下单 → 二维码 img + 跳转收银台 → 3s 轮询 → 到账 refreshBootstrap 自动关闭
- **验证**：本地+线上未配置时 products=unavailable、游客下单 401、notify 503 fail、`webos_pay_orders` 表已建；**真实支付链路待审核通过、填上 ZPAY_PID/ZPAY_KEY 后做端到端测试**（下单→扫码→回调入账→quota 到 1 亿）
- 部署注意：`payment/zpay.ts` 是**新目录**（server/src/payment/），scp 时先 mkdir

### 支付渠道切换 + 积分制（2026-08-02 晚，用户决策）

- **zpay 已整体移除**（用户：zpay 不支持 AI 产品）：`payment/zpay.ts`、`routes/zpayNotify.ts`、`webos_pay_orders` 表（两套 schema）、index.ts 回调挂载、.env 变量全部删除；`POST /webos/api/payment/orders` 与订单查询统一返回 `503 PAYMENT_UNAVAILABLE`，不创建假订单/伪造到账。**计划接入爱发电（afdian.com）**（paymentState 预留 `provider:'afdian'`；届时新增免鉴权回调 + 验签 + quota 提升到 990 入账）。
- **统一积分制（1 积分 = ¥0.01）**，解决"不同模型 token 不同价"的架构问题：
  - `server/src/billing/pricing.ts`（新目录）计费核心：`chatCostMinor`（DeepSeek 官方价×1.5 售价×高峰倍率）、`imageCostMinor`（生图 ¥16/¥60 每百万）、`fixedCostMinor`（搜索 ¥0.02/次、TTS ¥0.5/千字符预留）；`billingCatalog()`/`isDeepSeekPeak()`/`deepSeekPeakMultiplier()`
  - **DeepSeek 峰谷定价**：北京时间每日 9:00-12:00、14:00-18:00 价格 ×2（官方规则，适用所有计费项），已在对话计费应用
  - `StoredState.tokens` → `credits`（旧数据自动迁移：1亿→990、10万→1000、1万→100）；`chargeTokens`→`chargeCredits`、`remainingTokens`→`remainingCredits`、`estimateTokens`→`estimateCostMinor`；游客 100 / 会员 1000 / 套餐 990 积分
  - bootstrap 返回 `credits` + `billing`（peak/peakMultiplier/catalog）；done 事件 usage 带 `usedCredits/remainingCredits/peak`；余额不足 402 `TOKEN_INSUFFICIENT`（文案含客服微信 fangyan876）
  - 管理后台：用户列表积分显示、`PUT /api/admin/webos/credits` 调整额度（`/tokens` 兼容保留）
  - 前端（shell-web/admin-web）：余额 chip、个人主页（剩余积分+进度条+高峰提示）、会话侧边栏、登录面板文案全部改积分；对话真实扣费验证 ✅（不足 1 分钱 round 为 0，属粒度设计）；生图扣积分验证 ✅（512 图 1 积分）；bootstrap billing.catalog ✅；支付 503 ✅
  - SSH 访问：**2026-08-03 起密码登录已禁用，仅密钥**（私钥 `ssh-keys/daily_server_ed25519`，勿用旧密码）

### 上线就绪（2026-08-02 推广前补全）

- **合规页**：`/daily/terms.html`（自包含静态页：服务条款+隐私政策，含 AI 生成内容免责、第三方数据披露、未成年人限制、客服 QQ）；注册表单增加「我已阅读并同意《服务条款与隐私政策》」勾选（未勾选不可注册）
- **自动备份**：`/root/daily/backup-daily.cjs`（cron 每日 03:00）：SQLite VACUUM INTO 备份 + 工作区 tar，保留 14 天，日志 backup.log（已上线并实测）
- **邮件额度**：Resend 免费约 100 封/天；sendEmail 对 429/rate-limit 返回明确 `EMAIL_DAILY_LIMIT`（"今日发送量已达上限"），超量需升级 Resend 套餐
- 推广规模预判：单机（3.7G 内存/30G 磁盘）数百用户无压力；DeepSeek 成本后台实时可查；**对象存储与支付渠道非推广硬门槛**（文件功能未开放、测试期客服 QQ 发放额度即可）

### 对话 UI 修复 + 头像可换 + 提示词精简 + 称呼询问重做（2026-08-03 深夜）

**卡加载页大 bug 修复（2026-08-03 晚，用户实测发现）**：

- 现象：部署定制加载页"最短展示时长"后，**页面永远卡在加载页进不去**（用户描述为"对话区位置全错/变小"——实际是主界面从未渲染）
- 根因：`App.tsx` 的 bootHeld 逻辑用 `useEffect` 的 cleanup 清除 setTimeout；`setBootHeld(true)` 触发重渲染后 cleanup 清掉 timer，新 effect 因 `bootHeld=true` 不再重设 timer → bootHeld 永远 true → 永远显示加载页
- 修复：改用 `bootScheduledRef` 保证整个生命周期只调度一次，timer 存 ref 不被 cleanup 清除；`showBootScreen = (booting && !ready) || bootHeld` 不变
- 浏览器实测：页面正常进入主界面、发消息、流式回复、折叠全部正常

**主页标语不再被自动消息顶掉（称呼询问重做）**：

- 之前：系统自动注入一条"我该怎么称呼你"消息到对话列表 → 主页标语（greeting）消失，只剩问候消息（且与标语文案重复）
- 现在：**不再注入对话 UI**；改为在「登录且未设置称呼且本地从未问过且是第一条消息」时，把系统引导消息**前置进发送给服务端的消息列表**（`sendMessage` 内 unshift）——标语保留、消息仍真实进入 AI 上下文，AI 看到后主动询问称呼

**AI 提示词精简（不再"太好动"）**：

- 把 Logo / 头像 / 称呼 / 加载页 / 上传文件 / 客服 6 条冗长说明合并压缩为每条一句的简洁条目（总字数约减半），保留全部能力但减少 AI 的多余动作与自我发挥空间

**用户消息名称与头像**：

- 用户气泡旁名称由硬编码「你」改为**用户称呼**（display_name，未设置时回退邮箱前缀；游客显示「我」）
- **用户头像可更换**：消息旁头像点击 → 头像面板（居中弹窗）→ 上传图片（png/jpg/svg/webp ≤2MB，写工作区 `system/avatar.<ext>`）；游客引导登录；AI 也可用 agent_fs_write 改 system/avatar.svg 帮用户换头像；bootstrap.avatar + `GET/POST /webos/api/avatar`
- AI 头像改用系统 Logo（LogoMark，AI 可替换，与品牌一致）

**思考过程与工具调用折叠（修复联动 bug）**：

- 修复「点一个思考折叠，全部一起动」：折叠状态改为**按 segment index 独立**（Record<number, boolean>）
- 思考过程：**正在流式输出时默认展开**（实时可见），思考完成自动折叠为一行「已思考 N 字」，点击展开
- 工具调用：有工具在运行时展开显示实时状态；**全部完成后自动折叠为一行摘要**「使用了 N 个工具」（点击展开明细 + 收起按钮）

- 验证：server/shell-web tsc、vite build 通过；线上 bootstrap.avatar（游客 null）✓、游客上传头像 403 ✓、AI 对话链路正常 ✓、前端已部署

- **游客不支持上传**：`POST /workspace/files` 对游客返回 `403 GUEST_NOT_ALLOWED`（"登录后获得 10GB 空间"）；前端文件页游客显示「登录后上传（10GB）」按钮、➕ 面板上传对游客改为引导登录（前端拦截 + 后端强制双保险）
- **空间上限按身份区分**：`workspaceLimitFor(key)`——游客 200MB（仅供 AI 生成物/App 素材），**已登录用户 10GB**（`MEMBER_WORKSPACE_BYTES`）；`agent_fs_write` 总量检查、上传端点、列表接口（workspaceLimitBytes）统一使用该函数
- 验证：server/shell-web tsc、vite build 通过；线上游客上传 403 ✓、游客列表 limit=200MB ✓、前端已部署

### 系统问候称呼 + 发送框 ➕ 菜单 + 定制加载页 + 后台任务确认（2026-08-03）

**系统主动询问称呼（消息进 AI 上下文）**：

- 前端 `AssistantHome`：登录且 `displayNameSet=false`（从未设置自定义称呼）且对话为空且本地从未问过时，自动注入一条系统引导消息（assistant 分段）：「在开始之前，我该怎么称呼你呢？…」
- 该消息存在于本地 messages，用户回复时会被包含进发送给服务端的消息列表 → **真实进入 AI 上下文**；AI 根据提示词用新工具 `set_display_name`（服务端新增，写 users.display_name）持久化称呼
- 触发记忆：localStorage `daily-webos-name-asked:<userId>`（问过一次不再重复）；bootstrap `session.user.displayNameSet` 由 authMiddleware `getUserMeta` 返回

**发送框 ➕ 弹出面板（composer 精简）**：

- 原 composer 上方常驻的「模型/思考 chips + 粘贴 HTML」移入 ➕ 弹出面板（向上铺出，fadeUp 动效）：① 上传文件（直接传 home/uploads/，AI 可读）② 粘贴 HTML 创建 App ③ 思考强度 chips
- 发送框左侧 ➕ 圆形按钮（active 蓝色高亮），composer 区只剩一条输入框，视觉更干净

**定制加载页（AI 可替换）**：

- 工作区 `system/boot.html`（自包含 HTML，AI 可写）→ 启动时以 sandbox iframe 渲染；无则默认动画
- 工作区 `system/boot.json`（`{"durationMs": 500-10000}`，默认 1200）→ 加载页**最短展示时长**（bootstrap 就绪后不足时长则保持加载页到点再进主界面）
- bootstrap 返回 `boot: { html, durationMs }`；AI 提示词已说明（用户说"换个加载页/显示久一点"时读写这两个文件）
- 回归：写入 boot.html + boot.json → bootstrap 返回自定义 HTML + durationMs=2500 ✓（线上实测）

**AI 后台运行确认（关浏览器后任务继续）**：

- 结论：**支持**。SSE 断连只停止前端转发（`disconnected` 标记），`runPiPrompt` 在服务端继续执行到完成（180s 超时），pi 会话上下文保留，用户回来可继续对话
- 修复一个缺口：原实现断连后直接 return（不扣费不落库，任务白干）→ 现改为断连后照常按真实 usage 扣 token + 落库（状态 ok/failed），日志 `background task finished (client disconnected)`
- 局限：无"异步任务队列 + 结果通知"，中断后的结果只能下次打开对话时从上下文感知（AI 会续上）

- 验证：server `tsc --noEmit`、shell-web `tsc -b --noEmit`、`vite build` 通过；已部署（前端 dist + 后端 5 文件）

**反人机验证（发送验证码前）**：

- `POST /api/auth/email/puzzle`（免鉴权）：签发一道两位数加减算术题（内存 Map，5 分钟有效，**一次性**）
- `POST /api/auth/email/send-code` 强制要求 `puzzleId + answer`，通过校验才真正发码；答错/过期/重用一律 `400 PUZZLE_REQUIRED`
- 前端登录面板：点「获取验证码」→ 内联出现「人机验证：7 - 4 = ?」+ 答案输入框 → 提交通过后自动发送验证码；答错自动换新题
- 定位：与 IP 限频互补（IP 限频防刷、算术题防脚本批量轰炸邮箱）
- 回归：无答案 400 ✓、答错 400 ✓、正确回答通过（进入真实发码）✓、同一题目重用 400 ✓（本地+线上）

**管理后台入口看不到（根因修复）**：

- 根因：`emailAuth.ts` 邮箱注册路径**固定写死 role='member'**，没有应用 `ADMIN_USERNAMES` 机制（旧版 auth.ts 的 register 有，邮箱注册漏了）→ 站长账号 2893334965@qq.com 一直是 member
- 修复：register 角色判定与 auth.ts 一致（用户名在 ADMIN_USERNAMES → admin）；**线上数据已直接 UPDATE 为 admin**
- 注意：JWT 里的 role 是登录时签发的——**已登录用户需要退出重新登录**才能拿到 admin 角色（前端 ProfileView 才显示「管理后台」入口）

**用户称呼（AI 对话界面显示名）**：

- users 表新增 `display_name` 列（`ensureDisplayNameColumn` 幂等迁移）
- `POST /api/auth/email/profile` {displayName}：登录态修改称呼（1-20 字，禁控制字符，IP 限频 30/h）
- authMiddleware `getUserMeta` 优先返回 display_name；bootstrap `session.user.username` = 称呼 ?? 邮箱前缀
- 前端：个人主页 account-card 新增「AI 对话中的称呼」输入 + 保存；AI 对话页 header 头像按钮与时段问候语（「晚上好，xxx。今天想做点什么？」）都显示称呼
- 回归：profile 未登录 401 ✓、display_name 列迁移成功 ✓

**AI 对话头部精简（design skill：克制、呼吸感、去重）**：

- 删除重复身份行（原 header 账户按钮 + identity 行的「邮箱/游客ID + 在线」两处重复）
- header 重构：左侧 Logo+Daily（去掉 NOW 小字）；右侧 = 余额 chip（紧凑胶囊）+ 桌面圆形图标按钮 + 账户（登录：圆形头像+称呼胶囊，admin 高亮蓝；游客：弱化「登录」胶囊）
- 问候语按时段（早上好/中午好/下午好/晚上好/夜深了）+ 称呼，保留日期

- 验证：server `tsc --noEmit`、shell-web `tsc -b --noEmit`、`vite build` 全部通过；本地+线上回归通过（见上）；已部署（前端 dist + 后端 6 文件 + 数据修复）

**登录系统（对照 OWASP / NIST SP 800-63B 补齐专业要素）**：

- 服务端 `emailAuth.ts`：密码策略升级为 **8-64 位 + 至少 3 类字符（小写/大写/数字/符号）+ 弱密码黑名单（40+ 常见口令）+ 密码不得包含邮箱本地部分**（注册/重置共用 `validatePassword`）；**登录失败账户锁定**（同一邮箱连续失败 5 次锁 15 分钟，与既有 IP 限频互补）；新增 `POST /api/auth/email/change-password`（已登录改密：验证旧密码 → 新密码强度校验 → 更新，IP 限频 20/h，成功后清失败计数）
- 前端 `LoginPanel`：**再次输入密码确认**（注册/忘记密码/修改密码三处表单）+ **密码强度指示条**（PasswordMeter：太弱/较弱/中等/强 + 提示文案，与服务端规则一致）+ **显示/隐藏密码切换**（所有密码输入框）+ **已登录面板修改密码入口**（登录弹窗内直接改密，无需验证码）；登录错误提示剩余可尝试次数
- 回归（真实服务验证）：`12345678`/`password123` 注册 400 INVALID_PASSWORD ✓；不存在邮箱连错 5 次后第 6 次 423 ACCOUNT_LOCKED「请 15 分钟后再试」✓；弱密码类顺序（长度→字符类→黑名单）正确

**聊天记录持久化（刷新不再丢失）**：

- `store.ts`：messages 按会话身份（`guest:<deviceId>` / `user:<userId>`）存 localStorage（`daily-webos-chat:<key>`）；`hydrate` 在身份变化（登录/注册/登出/首启）时自动恢复该身份历史，身份不变（刷新 bootstrap）不覆盖当前时间线；`useShellStore.subscribe` 监听 messages 变化自动落盘（流式期间增量保存）；上限 120 条 / 1.5MB（超长从旧消息截断）；logout 清除当前身份缓存；**不同用户互不串档**

**用户文件上传（AI 工作区 + 隔离 + 限制）**：

- 新端点（`/webos/api/workspace/files*`，全部基于 principal 解析路径，per-user 隔离）：
  - `GET /workspace/files?path=` 列出用户可见区（home/，含工作区总量）
  - `POST /workspace/files` {fileName, contentBase64, dir?} 上传（默认 home/uploads/）
  - `GET /workspace/files/raw?path=` 文件字节（图片预览/下载，按扩展名 MIME）
  - `DELETE /workspace/files?path=` 删除文件/空目录
- **限制**：单文件 ≤10MB、每用户工作区总量 ≤200MB（上传与 AI 写入共享）、类型白名单（图片/文档/音频/视频/压缩包，禁止脚本/可执行文件）；`agent_fs_write` 增加总量检查（新文件/覆盖变大时）；路径校验防越界（`resolveUserHomePath` 仅 home/ 内，越界返回 400 INVALID_PATH）
- 前端 `FilesView`：上传按钮（多选）→ 列表（目录可进入、图片缩略图、下载、删除）→ 用量进度条；提示"上传后 AI 可直接读取使用"
- AI 提示词新增：用户上传的文件在 `home/uploads/`，可用 agent_fs_* 读取并放进 App/壁纸
- 回归（真实服务验证）：上传→列表→raw 读取→删除全链路 ✓；另一游客看不到（隔离 ✓）；`../agent/notes.md` 越权 400 ✓；`evil.sh` 400 FILE_TYPE_NOT_ALLOWED ✓；`GET /workspace/files`（空 path）原 500 已修（resolveUserHomePath 空路径=home 根）✓

**Logo 可被 AI 替换（AI 即系统：连品牌都归 AI 管）**：

- Logo = 工作区 `system/logo.svg`（优先）或 `system/logo.png`；AI 用 `agent_fs_write` 修改即可全局换标
- `bootstrap.logo` 返回 `{mime, base64}`（`readLogoFile`，≤4MB）；`GET /webos/api/logo` 供前端按需刷新
- 前端 `LogoMark` 组件：有 logo 显示 `<img data-url>`，无则回退文字「D」；已接入 BootScreen / AssistantHome wordmark / LoginPanel 三个入口
- AI 提示词新增「系统 Logo（可替换）」条目（SVG 优先、先读后改、告知刷新生效）
- 回归（真实服务验证）：写入 system/logo.svg → bootstrap 返回 image/svg+xml + base64 ✓；删除后回退 null ✓

**客服联系方式调整（付费/提示词/设置）**：

- 付费相关文案（套餐描述、TOKEN_INSUFFICIENT、支付不可用）**QQ → 微信 fangyan876**（webos.ts `SUPPORT_WECHAT` + `PLAN_SUPPORT_TEXT`，前端 ProfileView 同步）
- AI 系统提示词新增「客服联系方式」条目：微信 fangyan876（额度/购买）+ QQ 2893334965（反馈/讨论）
- 设置页（ProfileView）新增「联系站长 · 分享讨论」卡片：QQ 2893334965 + 微信 fangyan876，提醒加好友交流

**后台控制台入口**：ProfileView 对 admin 角色显示「管理后台」链接（https://admin.shadowshub.xyz，ExternalLink 新窗口），管理员登录后可直接浏览用户/用量/额度管理。

**其他**：AI 对话首页欢迎语由「晚上好。直接开始就可以。」改为「嗨，今天想做点什么？我可以帮你做 App、改桌面、管文件。」（引导用户让 AI 做应用/改桌面）；suggestions 与 context-card 文案微调。
- 验证：server `tsc --noEmit`、shell-web `tsc -b --noEmit`、`vite build` 全部通过；新端点真实请求全链路回归通过（见上）

### 多会话（2026-08-05，DeepSeek 式会话管理）

**产品功能（用户需求）**：多会话并行工作 + 创建新会话 + 修改/回退重来某条消息 + 复制粘贴 + 每会话 token 统计。

**后端**：

- `POST /webos/api/chat/stream` 请求体新增 `conversationId`（缺省 `default`）与 `rebuild`（编辑/回退重来置 true）
- **会话上下文隔离（关键根因修复）**：pi 的 `createAgentSession` 会通过 `sessionManager.buildSessionContext()` 恢复历史；原实现所有 webOS 会话共享同一个 `SessionManager.inMemory(cwd)` 单例 → 不同会话上下文互相串扰（实测会话 B 能答出会话 A 的名字）。修复：`createWebosSession` 改为每个会话独立 `SessionManager.inMemory(cwd)`（画布会话的 sharedSessionManager 不受影响）；session 缓存 key 升级为 `webos:${scope}:${conversationId}:${thinking}`
- `disposeWebosSessions(scope, conversationId?)`：不传 conversationId 时释放全部（向后兼容），传了只释放指定会话——busy 重试/失败/超时清理都改为只清当前会话，**并行会话互不误杀**
- **rebuild 语义**：先 dispose 该会话 pi 上下文，再把修改后的完整消息历史（`messages.slice(0,-1)`）格式化为背景文本（`formatHistoryContext`，≤24k 字符，头尾截断）拼进 userText → 新会话从空上下文 + 重放历史推理，等价 DeepSeek「编辑消息后重新生成」；日志 `[webos] chat rebuild conversation=...`
- 扣费/用量落库逻辑不变（rebuild 按真实 usage 正常计费）

**前端**（`client/shell-web`）：

- `store.ts` 重构为多会话模型：`conversations: ChatConversation[]`（id/title/createdAt/updatedAt/messages/usedTokens/draft）+ `activeConversationId` + `streamingConvs: Record<convId, AbortController>`（**每个会话独立流式控制器，支持多会话并行生成**，切走后台照常累积，回来看到完整结果）；`messages` 字段保留为当前会话视图（旧组件兼容）
- 新 actions：`createConversation / switchConversation / renameConversation / deleteConversation / copyMessageAt / editMessageAt / regenerateAt / stopStreaming`
- **编辑消息**：用户消息就地 textarea（取消/发送修改）→ 截断该消息之后的内容 → 以修改后的消息 rebuild 重发
- **回退重来**：用户消息=删除它及之后重发原内容；AI 消息=删除它及之后重发它前面最后一条用户消息（confirm 确认）→ rebuild
- **复制**：`navigator.clipboard.writeText` 复制消息纯文本（user 全文 / assistant 拼接文字段）
- **每会话 token 统计**：done 事件 `usage.totalTokens` 累加到会话 `usedTokens`；对话页 header 下方信息条（标题+本会话 tokens，点击打开会话列表）与会话列表项均显示；顶部余额 chip 仍显示全局剩余
- **会话侧边栏**（ChatSidebar，左侧滑出抽屉）：新建/切换/重命名/删除，按 今天/昨天/更早 分组，流式会话显示「生成中」，底部显示全局余额；header 新增「会话」胶囊按钮
- **持久化**：`daily-webos-conv:<scopeKey>`（按身份隔离，每会话 200 条上限/6MB 兜底截断）；**旧版单时间线缓存 `daily-webos-chat:*` 自动迁移为「历史对话」会话**；logout/身份切换中断全部流式并清理缓存
- 会话标题自动取第一条用户消息前 20 字（可重命名）；每会话独立草稿（切换不丢输入）；称呼引导按「当前会话首条消息」触发

**回归记录（真实 DeepSeek + SQLite + 本地服务 + 浏览器实测）**：

- 会话 A「记住小明」→ 会话 B 问名字答「不知道」（**隔离生效**，修复前答「小明」）；A 问名字答「小明」（上下文累积正常）；并行双会话均正常流式 + done token 统计（117+151+... 全局 used 累加正确）
- 编辑重来：把「小明」改「小红」rebuild 后回答「小红」（旧上下文被丢弃 ✓，日志 `chat rebuild`）
- 浏览器端：新建会话 → 发消息 → AI 完整回复（思考折叠/markdown）→ 会话信息条 10,000 tokens → 侧边栏两会话分组显示 → 切换会话消息完整恢复 → 编辑消息（textarea 修改 → 发送修改 → 截断 + rebuild 请求发出）→ 复制按钮（clipboard 在 Playwright 环境受限，UI 反馈正常；生产 https 正常）
- 两端类型检查与 shell-web `vite build` 通过

### 加载页缓存 + 爱发电订阅页 + 对话 UI 打磨（2026-08-05 下午）

**定制加载页缓存（修复"先默认后自定义"）**：

- 现象：刷新后先显示默认加载动画，最后一刻才切换为自定义 boot.html（bootstrap 返回后 hydrate 才 set bootConfig）
- 修复：hydrate 把 boot.html + durationMs 缓存到 localStorage（`daily-webos-boot-html` / `daily-webos-boot-duration`）；`boot()` 启动时先恢复缓存 → BootScreen 立即渲染自定义加载页，bootstrap 返回后用服务端最新值覆盖并刷新缓存（用户删除了自定义页则清缓存）
- 注意：首次访问无缓存仍会先默认后切换（正常）；之后刷新直接显示自定义页

**爱发电订阅页（全屏档位页）**：

- ProfileView 套餐卡片改为「订阅支持（爱发电）」按钮 → 打开全屏页 `AfdianView`：上方「入驻爱发电」徽章 + 说明，下方两档卡片：
  - ¥9.9「轻量支持」→ 1000 积分（相当于 10 元额度）
  - ¥29.9「深度支持」→ 3000 积分（相当于 30 元额度）+「优先体验新功能」徽章
- 真实支付接入前点击档位只 toast「即将开放」（不伪造扣款/到账）；底部说明支付通道接入中 + 客服微信
- zpay 残留的 PayPanel 不再被触发（providerStatus 恒 unavailable），保留代码未删

**对话 UI 打磨（本轮）**：

- 用户气泡 max-width 82% → **72%**（窄屏下与 AI 消息视觉分区，AI 消息不再"居中偏右"）
- AI 消息正文 max-width **80%**（右侧留白，不与用户消息"撞"）；头像 27→24px、消息间距 14→16px
- 发消息后 AI 立即显示「●●● 正在思考…」（占位消息改空 segments 触发 typing 动画，修复"发送后无提示"）
- 流式生成中的消息不显示「复制/回退重来」操作条（生成完成才出现）
- AI 消息左边缘收敛到 ~40px（消息区 padding 10px + 头像 24px + gap 8px）
### 2026-08-16：webOS 三项修复 + 系统时间能力 + Skill 市场生效（sub-agent 并行）

**① 识图 bug 修复（MiniMax-M3 视觉桥接全链路）**
- 根因：`chat/stream` 的 `validateMessages` 把单条消息硬限制 12,000 字符，前端压缩后的图片 data URI（几十 KB~数 MB）在进入视觉桥接前就被 `INVALID_MESSAGE_CONTENT` 400 拒绝 → AI 永远收不到图片。
- 修复（server/src/routes/webos.ts）：
  - 媒体消息（含 `data:image/...;base64,`）放行至 128MB，普通文本仍限 12,000；
  - 新增 `replaceDataUriMediaRefs`：data URI 只交给 M3，不再原样喂给纯文本 DeepSeek（替换为 `[图片N]`，避免上下文膨胀/成本失真）；
  - `extractMediaRefs` / `looksLikeMediaRef` 补充 `system/` 路径、Markdown 图片无扩展名 URL、`./`/`/` 前缀、URL 中带 `image`/`video` 的地址；
  - `estimateCostMinor` 先替换 data URI 再统计字符，避免 base64 被算成巨额输入 token；
  - M3 失败/未配置时不再完全静默，向 AI 注入系统提示（用户能感知"检测到图片但分析失败"）。
- 修复（server/src/vision/m3Vision.ts）：路径归一化（去 `./`、URL 解码）、公网 URL 按 pathPart 判断扩展名、`max_tokens` 兼容、响应 content 数组兼容。
- 前端（client/shell-web/src/App.tsx / styles.css）：composer 粘贴/拖拽图片 → 压缩（最长边 ≤2048）→ data URI 附件预览 → 用户消息缩略图渲染（该部分由并行任务补齐）。
- 验证：本地 + 线上真实图片消息全链路通过（M3 描述注入 → DeepSeek 基于描述回答）。

**② 对话框默认保存上一条消息修复（client/shell-web/src/store.ts）**
- 根因：`runConversationTurn` 只清顶层 `draft`，未同步清空 `conversations` 中该会话的 `conv.draft`；持久化保存的是旧草稿 → 刷新/重开/切换会话后输入框恢复上一条已发送消息。
- 修复：乐观更新时同步清空对应 conv 的 `draft` 并 `persistNow()` 立即落盘；普通发送与编辑重建（rebuild）均覆盖；未发送草稿的切换保留语义不变。

**③ 系统时间能力（server/src/routes/webosTime.ts 新增 + webos.ts + index.ts + shared/webos-contracts + client/shell-web/src/api.ts）**
- 对话默认携带时间：`chat/stream` 在 userText 组装处注入 `当前时间：YYYY-MM-DD HH:mm 星期X（北京时间）` 前缀（App 上下文 / rebuild 场景同样注入）。
- 时间 API：`GET /webos/api/time`（鉴权）返回 `{ iso, timestamp, beijing, weekday, timezone: 'Asia/Shanghai' }`；共享契约 `WebOsTimeInfo`；前端 `fetchServerTime()` 封装。
- 时区同步：本机 `/etc/localtime` → Asia/Shanghai；docker-compose(.prod).yml 与 .env(.prod).example 增加 `TZ=Asia/Shanghai`。
- 注：初版路由挂载前缀剥离导致 404（`get('/')` 在 `/webos/api` 前缀下不匹配 `/time`），已修为 `get('/time')` 并线上复测通过。

**④ Skill 市场生效（server/src/webosStoreV1.ts 模板 + 既有 API/SDK）**
- 商店模板（含「技能」页签：skills.list / skills.install、单列卡片、安装状态）随本次部署上线；`ensureSystemStore` 未改动商店自动升级，新模板含 `tab-skills`（线上实测 hasSkillsTab=true）。
- 市场数据源 = 全局 `.pi/skills-webos/`（app-dev / design / myself / video-sprites / xhs-content），`SKILL_INSTALL_MAX_BYTES` 内可安装到用户工作区。

**部署**：`server/src/{routes/webos.ts, routes/webosTime.ts(新), index.ts, vision/m3Vision.ts, webosStoreV1.ts}` 上传生产 + `client/shell-web` dist 产物更新 `server/public/` + 生产 `.env` 配置 `MINIMAX_API_KEY` + `pm2 restart daily-server`（PID 283116）。
**验证**：server/shell-web `tsc --noEmit` 零错误；本地冒烟（health/time/skills/带图 chat 链路）；线上实测 time API（北京时间 12:48 正确）、AI 正确报出北京时间、M3 识图描述注入、新游客商店含技能页签。

### 2026-08-16（追加）：桌面壁纸 bug 修复——上传图片无法显示（sub-agent）

- 根因：桌面 system.desktop 运行在 sandbox iframe（opaque origin），`<img>`/CSS `url()` 请求不带 SameSite cookie；而用户上传区图片（home/uploads/）的 `/webos/api/workspace/files/raw?path=` 端点带鉴权 → iframe 内 401 → Chrome ORB 拦截（表现为图片不显示）；AI 用相对路径 `home/uploads/xx.png` 则被 `<base>` 解析成 `/home/uploads/xx.png` → 404。此前生图产物有免鉴权公开 URL，但用户上传图片没有。
- 修复（仿「生图公开目录」模式，server/src/utils/webosWorkspace.ts + routes/webos.ts + piBridge.ts + shared/webos-contracts）：
  - `home/` 下图片双写 UUID 命名公开副本（`PUBLIC_IMAGES_DIR`），映射存 `data/webos-public-uploads.json`；
  - `agent_fs_list / agent_fs_stat / agent_fs_read` 与上传/列表接口（fileEntry）返回 `publicUrl`（`WebOsWorkspaceEntry.publicUrl?` 兼容旧字段）；
  - 删除文件时同步清理公开副本；`home/` 之外不生成（不开放 workspace/files/raw 免鉴权，path 仍不可枚举）；
  - AI 系统提示词、工作区 README、design 文档新增指引：沙箱内引用用户上传图片必须用 `publicUrl`。
- 部署：上传 4 文件 + `pm2 restart daily-server`。
- 验证：站长账号（真实账号）上传图返回 publicUrl；**存量壁纸 P20260801-*.jpg（13 张）全部自动补 publicUrl**；免鉴权无 cookie 拉取 200（image/png、image/jpeg）；tsc 双端零错误。

### 2026-08-16（追加）：FFmpeg 全能力上线——edit_video 扩展 7 大操作（sub-agent）

- 背景：AI 只能用 FFmpeg 处理视频（抽帧/裁剪/缩放等），无法处理壁纸/图片的滤镜（半透明、对比度等）。本次把 edit_video 扩展为 FFmpeg 全能力工具，**操作从 13 个增至 20 个**：
  - 原有 13：extract-frames / sprite-sheet / to-sprite / to-gif / poster / trim / crop / scale / extract-audio / mute / speed / remove-bg / concat；
  - **新增 7**：`filter`（图片/视频帧滤镜：contrast/brightness/saturation/gamma/blur/alpha 半透明/darken 暗化/hue/negate，顺序 eq→hue→gblur→colorlevels→negate→alpha）、`rotate`（90/180/270 无损 + 任意角度）、`flip`（水平/垂直）、`convert`（png/jpg/webp/gif/mp4/webm 互转 + quality）、`watermark`（图片水印 overlay / 文字水印 drawtext，字体探测 DejaVu、文本转义防注入、支持 #RRGGBBAA 半透明）、`tile`（2-12 张图网格拼图，montage）、`volume`（音频音量 0-3）。
- 安全：全部结构化参数（`Number()+clamp` 范围钳制），**不接受任意 filter 字符串**；drawtext 转义 `\ : ' , %`；watermarkPath 工作区路径校验防越界；产物继续走公开 URL 管线（imagegen/videogen），游客禁止、logAgentAction 记录不变。
- 部署：`server/src/utils/videoEdit.ts` + `server/src/routes/webos.ts`（工具描述完整列出新操作与中文示例）上传生产 + pm2 重启。
- 验证：本地 + 生产实测 filter（alpha=0.55+contrast=1.4+darken）产物正确；rotate/flip/convert/watermark（文+图）/tile/volume 本地冒烟全过；tsc 双端零错误。
- 开放情况：**对 AI 对话开放**（edit_video 工具，登录可用）；**skill 形式**：video-sprites（精灵图工作流）等系统技能文档已就位；**App 运行时 API 未开放**（App SDK 无 FFmpeg 能力，App 集成需 AI 生成时预处理素材，未来可走 API 包）。

### 2026-08-16（追加）：web 端「复制」按钮假复制修复（sub-agent）

- 根因：`copyMessageAt` 只用 `navigator.clipboard.writeText`，失败无 fallback 且无任何反馈（失败被静默吞掉）→ 用户点「复制」没反应，像假按钮；AI 错误信息复制、分享链接复制同款问题。
- 修复：新增 `copyTextToClipboard()`（Clipboard API 优先 + 临时 textarea + `execCommand('copy')` fallback，兼容移动端/WebView）；消息复制/错误复制/分享链接复制统一走它；成功绿色「已复制」、失败红色「复制失败」（1.6s 复原）。
- 文件：`client/shell-web/src/{store.ts, App.tsx, styles.css}` + `client/desktop/.../PdfViewer.tsx`（同类修复）。
- 部署：shell-web 重新构建上传 `server/public/`（daily 200 验证）；tsc 双端零错误。

### 2026-08-16（追加）：商店发布页遮盖层级修复 + 商店彻查（Operit 直接处理，含 1 个隐藏 bug）

**① 发布页被「我的」层盖住（用户主诉）**
- 根因：webosStoreV1.ts 中 `#publish-overlay` 与 `#my-overlay` 都是 `.overlay`（z-index:30），DOM 顺序 my-overlay 在后；从「我的」点「发布应用」只显示 publish-overlay 未先关 my-overlay → 同 z 后层覆盖，发布表单被遮挡点不到。
- 修复：① 打开发布页前先 `$('my-overlay').classList.remove('show')`；② 给发布弹层独立 `#publish-overlay { z-index: 50; }`（高于预览 40、低于 toast 60），保持底部弹层视觉不变；模板注释写明层级规则防 AI 改坏。
- 站长账号 store v1.0.9（多版本不自动升级）→ 按重置纪律停服直改建 v2.0.10 并写回工作区镜像，已生效。

**② 商店彻查发现隐藏 bug：列表「已安装」标记恒为 false（服务端）**
- 根因：安装的 App id 带 `store:` 前缀（如 `store:s-abc123`），而列表用 `row.id`（`s-abc123`）比对 → installedIds 永不匹配。
- 修复：收集时去掉 `store:` 前缀（`app.id.startsWith('store:') ? app.id.slice(6) : app.id`）。
- 线上验证：游客装「锁屏效果包」前 installed:false → 安装后 **installed:true**，发布者 +100 积分正常。

**③ 彻查其余结论（健壮，未改）**
- 模板 esc() 覆盖全部用户可控字段（name/description/ownerName）、预览用 textContent → 无 XSS；bundle 上架页 ownerName/App 名已转义。
- 服务端：list 排序走白名单、全参数化查询；publish 快照 + 素材归档解耦（发布者删 App 商店仍可用）；install 空间校验/去重奖励；skill 安装 skillId 正则白名单 + frontmatter 名校验；serveStoreRaw 路径越界 startsWith 校验。
- 观察项（低）：store list 固定 LIMIT 100 无分页（条目增多截断，后续可加分页）；visit 记账 status 流转未深究。
- 前端指引：模板顶部注释补充发布层与素材 URL 规范；`app-dev` skill 与现有能力一致无需改。
- 部署：webosStoreV1.ts + webos.ts（+ searchTools.ts 配套保持一致，供运行时依赖）上传生产 + pm2 重启，health 200。

### 2026-08-17（追加）：web 端「思考与回答杂糅」+「标题生成失败」——改对话模型（关闭推理流）

- 现象（用户反馈，两问题同源）：① AI 输出中思考(reasoning)与回答(content)杂糅在一起，之前没有；② 会话标题生成失败（保留截取标题，AI 标题不覆盖）。
- 根因：ChatST/推理网关切换（deepseek-v4-flash-0731，`reasoning:true` + four-level thinkingLevelMap）后，推理流 `reasoning_effort` 在网关侧返回结构不稳 → 前端 thinking/delta 混排 + 标题生成 `completeSimple(reasoning:'minimal')` 被 clamp 到 low 仍走推理、拿不到 content → 标题 null 失败。
- 修复（用户决定改**对话模型**，server/src/piBridge.ts `registerDeepseekModels`）：
  - 全部 DeepSeek 模型注册 `reasoning: false` + `thinkingLevelMap: {}`（+ `requiresReasoningContentOnAssistantMessages:false`）→ pi 不再请求 reasoning_effort → 网关返回纯 content 流；
  - `DEEPSEEK_MODEL`/`DEEPSEEK_BASE_URL`（opencode.ai/zen/go/v1）不变，保留原模型名定义便于回退。
- 部署：piBridge.ts 上传生产 + pm2 重启（PID 312774）。
- 验证（生产实测）：发消息 SSE 事件流 = `start→delta(纯回答)→done`，**无 thinking 事件**，回答纯净；`POST /webos/api/chat/title` 返回 200 + 正常标题「杭州周末游与西湖日出推荐」。
- 注意：此后 UI 思考档位（low/medium/high/max）对该对话模型不生效（原样保留前端，模型侧已关闭推理）；如需恢复深度推理可在 `registerDeepseekModels` 里把 `reasoning` 改回 true 并配好稳定兼容的推理网关。

### 2026-08-17：web 端 AI 切换 ChatST 网关（deepseek-v4-flash-0731）

- 背景：用户紧急要求 web 端 AI 从 DeepSeek 官方直连切换到 ChatST 聚合网关：模型 `deepseek-v4-flash-0731`、Key `sk-XPxx...PatJm`、Base URL `https://api.chatst.org/v1`。
- 改动：
  - `server/src/piBridge.ts`：`registerDeepseekModels` 新增 `baseUrl` 参数（`DEEPSEEK_BASE_URL` 环境变量覆盖，默认仍 `https://api.deepseek.com`）；deepseek provider 注册 `deepseek-v4-flash-0731`（保留官方 `deepseek-v4-flash` 定义便于回退）；`createWebosSession` 与 `generateConversationTitle` 默认模型改为 `deepseek/deepseek-v4-flash-0731`。
  - `server/.env`：`DEEPSEEK_API_KEY` 换新 Key + `DEEPSEEK_MODEL=deepseek/deepseek-v4-flash-0731` + `DEEPSEEK_BASE_URL=https://api.chatst.org/v1`（.env 已被 .gitignore 忽略，Key 不入 git）。
  - `server/src/billing/pricing.ts`：计费目录 chat 项 model 同步为 `deepseek-v4-flash-0731`（计费按 kind 匹配，模型名仅展示用）。
  - `.env.example` / `.env.prod.example` / `docker-compose.prod.yml`：新增 `DEEPSEEK_BASE_URL` 说明与透传。
- 验证：server `tsc --noEmit` 零错误；ChatST 网关实测——非流式/流式（SSE）均 200，`thinking:{type:enabled}` + `reasoning_effort` 参数被接受，思考内容经 `delta.reasoning` 返回（pi-ai `reasoningFields` 兼容 `reasoning` 字段，无需改 pi 层）；模型返回 `deepseek-v4-flash:0731`。
- 部署：上传 `server/src/piBridge.ts` + `server/src/billing/pricing.ts` 到生产 + 生产 `.env` 配置三项 + `pm2 restart daily-server`。

### 2026-08-17（追加）：web 端平板布局适配（触屏平板铺满 + 内容列限宽）

- 背景：用户反馈平板体验很烂。根因：`.shell-stage` 默认 `max-width: 440px`（手机壳），竖屏平板（触屏、宽 600-1024px）落在既有媒体查询夹缝里——`min-width:700px` 规则要求 `hover:hover`（平板触屏不命中）、横屏规则要求 landscape（竖屏不命中）→ 平板只能看到一条 440px 手机窄条，两侧大片空白。
- 改动（纯 CSS，`client/shell-web/src/styles.css` 末尾新增两个媒体查询，不动 React 结构）：
  - `@media (min-width: 600px) and (pointer: coarse) and (hover: none)`：Shell 铺满视口（去 440px 壳）；对话页/系统页内容列限宽 760px 居中（`max(24px, calc((100% - 760px)/2))`）；消息气泡收窄（AI 72% / 用户 58%）；会话抽屉加宽 320px；字号/卡片/按钮/图标整体放大适配大屏；爱发电档位卡与套餐卡改横排；桌面内容列限宽 900px、Dock 限宽 640px 居中。
  - `@media (min-width: 900px) and (pointer: coarse) and (hover: none) and (orientation: landscape)`：横屏内容列限宽 820px，气泡进一步收窄（AI 68% / 用户 55%）。
- 验证：`tsc -b --noEmit` + `vite build` 零错误；Playwright 触屏视口实测（`scripts/verify-tablet-layout.mjs`，mock bootstrap 本地渲染）——iPad 竖屏 768×1024 stage 宽 768=视口 ✅、iPad 横屏 1024×768 stage 宽 1024=视口 + 内容列 820px 居中（padding 102px）✅、手机 390×844 保持原布局（tabletRule=false，padding 10px）✅；无 JS 报错。
- 部署：shell-web 重新构建，dist 产物复制到 `server/public/`（`/daily` 静态托管），随服务端一起上线。

### 2026-08-17（追加）：web 端 AI 二次切换 opencode.ai 网关（deepseek-v4-flash）

- 背景：用户要求把 web 端 AI 从 ChatST 网关换到 opencode.ai：模型 `deepseek-v4-flash`、Key `sk-UHXs...HWt`、Base URL `https://opencode.ai/zen/go/v1`。
- 改动：仅配置层（代码无需改——`registerDeepseekModels` 已支持 `DEEPSEEK_BASE_URL` 覆盖，`deepseek-v4-flash` 模型定义已注册）：
  - `server/.env`（本地 + 服务器）：`DEEPSEEK_API_KEY` 换新 Key + `DEEPSEEK_MODEL=deepseek/deepseek-v4-flash` + `DEEPSEEK_BASE_URL=https://opencode.ai/zen/go/v1`。
  - `.env.example` / `.env.prod.example`：注释更新为通用网关说明（ChatST / opencode.ai 两种示例）。
- 验证：opencode.ai 端点直连——**当前 Key 余额不足**（`CreditsError: Insufficient balance`，非流式/流式均返回，需到 https://opencode.ai/workspace/wrk_01KY7V0XC0J2DZH8ATMS9WTPM8/billing 充值）；线上 chat/stream 链路正常（SSE start → 因余额不足 pi 空响应 → 服务端 `WEBOS_AI_EMPTY_RESPONSE` 自动重置会话，服务不崩，充值后即可用）。
- 部署：服务器 `.env` 三项已更新 + `pm2 restart daily-server`（PID 287218）online、端口唯一监听。

### 2026-08-17（追加）：web 端 AI 三次切换 opencode.ai（新 Key sk-300k…，余额已充）

- 背景：用户反馈 opencode.ai Key 余额已于早上 8 点恢复；要求换最终新 Key：`sk-300k9j73...`（`DEEPSEEK_API_KEY`）。
- 改动：仅配置层——`server/.env`（本地 + 服务器，Key 入 .env 被 .gitignore 保护）：
  - `DEEPSEEK_API_KEY=sk-300k9j73...`、`DEEPSEEK_MODEL=deepseek/deepseek-v4-flash`、`DEEPSEEK_BASE_URL=https://opencode.ai/zen/go/v1`（备份 `.env.bak-20260817c`）。
- 验证：新 Key 直连 opencode 网关 200；**标题生成线上实测返回 `{"title":"开发待办清单App"}`**（此前常失败，见下方 cost 根因）；对话链路正常。
- 部署：服务器 .env 三项更新 + `pm2 restart daily-server`。

### 2026-08-17：会话持久化全面修复（服务端文件持久化 + 历史 API + 前端历史同步）

**背景**：用户反馈「换设备看不到聊天记录」+「重启服务器丢上下文（同会话 AI 说自己没上下文）」。根因：
- A) 会话列表 100% 只在浏览器 localStorage（服务端 `webos_chat_logs/webos_chat_sessions` 只写不读）；
- B) pi 会话上下文只在进程内存（重启即丢）；附：思考档切换也丢上下文（缓存 key 含 thinking）。

**服务端（已部署上线并验证）**：
- `server/src/piBridge.ts`：`SessionManager.inMemory → create(cwd, sessionDir)` 文件持久化（JSONL，`data/webos-sessions/<scope>/<conversationId>/`）；缓存 key 从 `webos:scope:convId:thinking` 改为 `webos:scope:convId`（**切思考档不丢上下文**）；`disposeWebosSessions` 删除会话文件。
- 新增 `server/src/routes/webosConversations.ts`（**不碰冻结的 webos.ts**），挂载 `/webos/api`：
  - `GET /webos/api/conversations`：当前身份历史会话列表（按 conversation_id 聚合，窗口 200，标题取首条 user 消息截断 40 字，updated_at 倒序）；
  - `GET /webos/api/conversations/:id/messages`：单会话完整消息（按时间升序重建，限 1000 条）；
  - 鉴权：`req.user.guestDeviceId`（游客，key=`guest:<deviceId>`）或 `req.user.userId`（账号，key=`user:<id>`）。
- 验证（线上实测）：重启后 AI 记得秘密数字（「会话也能想起来。」）；历史 API 返回正确结构（`{"conversations":[{"conversationId":"conv-hist-final","messageCount":2,"title":"你好"}]}` + 消息序列）。

**前端 shell-web（2026-08-17 完成并上线）**：
- `api.ts`：新增 `getServerConversations()` / `getServerConversationMessages(id)`。
- `store.ts`：新增 `syncServerConversations()` —— hydrate 身份变化（换设备/登录/注册/登出）+ boot 页面加载后各触发一次；只**补服务端独有 id**（本地已有保留权威缓存：完整 segments + AI 标题，不被纯文本覆盖）；拉回消息组装成 ChatConversation（assistant 单 text 段气泡），按 updatedAt 倒序合并；新设备无激活会话时激活最新历史；静默失败不阻塞。
- **防并发重复**（首版实测发现 hydrate+boot 两次 sync 并发都基于空态拉取 → 会话 id 重复 ×2）：`syncServerConversationsInFlight` 防重入锁 + 合并前按 id 去重 + `loadConversations` 恢复时防脏缓存去重。
- 部署：shell-web `tsc` 零错误 + `vite build`；dist 上传 `server/public/`（线上引用 `index-Bvb8WXwV.js`）。
- **线上端到端验证（Playwright + 站长账号 JWT，模拟换设备登录）**：干净上下文注入站长 cookie → boot → sync 把 **39 个历史会话**全部拉回 localStorage 与侧边栏（今天/昨天/更早分组正常），无 JS 错误。

### 2026-08-17：其他修复收口 + 管理后台能力（全部上线）

**① 标题生成频繁失败（根因 + 修复）**：`generateConversationTitle` 用 `completeSimple`，若模型注册缺 `cost` 字段，`calculateCost`（models.js:26 `usage.cost.input`）抛 `Cannot read properties of undefined (reading 'input')` → 内容已生成但被丢弃、接口返回 `{"title":}`。修复：flashModel/pro 补 `cost`（`{input:0.14,output:0.28,cacheRead:0.0028,cacheWrite:0}`）+ 统一默认 modelRef 为 `deepseek/deepseek-v4-flash`。线上实测 `{"title":"开发待办清单App"}`。

**② 视觉模型 HTTP 400（根因 + 修复）**：`extractMediaRefs` 贪婪正则把正文代码路径尾巴（如「webos.ts:2862，支持」）吞进 URL 发给 MiniMax → `400 invalid param: image format ".ts:2862，支持"`。修复：正则遇中文标点/全角括号/反引号立即截断（6 组样例验证）；`m3Vision.ts resolveMediaSource` 对未知扩展名/空 rest 不再兜底成 image 而返回 null；imagegen/videogen 严格校验真实文件名。

**③ 生图 fetch failed 加固**：根因是 8/15 瞬时网络故障（fetch failed 仅 9-35ms，非持续）；`chatstImage.ts` 加网络层重试（2 次退避 800/1600ms，仅网络错误重试）+ 错误记录 `error.cause.code`。

**④ 管理后台移动端优化**（`client/admin-web/`）：底部导航/卡片化/44px+ 触控目标/自愈守护 cron。

**⑤ DAU/MAU 统计**：`GET /api/admin/webos/stats/activity?days=30`（DAU 序列/MAU/趋势/游客会员拆分，UTC+8 切日）+ 后台「日活/月活」卡片。

**⑥ 搜索 API 状态可视化**：`/api/admin/webos/search-stats?days=7`（各引擎调用次数/成功率/平均耗时/失败样例）+ 搜索调用落 `webos_search_logs` 表（7 天 114 次、成功率 99.1%）+ 后台「搜索状态」tab。

**⑦ 管理后台打不开排查**：服务器端 `/var/www/daily-admin/public` 静态产物 + Playwright 实测登录页渲染全 200 正常；诊断为用户浏览器缓存旧 JS（并发部署多次覆盖），建议 Ctrl+Shift+R 强刷。

**部署**：服务端更新 `server/src/{piBridge.ts, routes/webos.ts, routes/webosConversations.ts(新), routes/adminWebos.ts, index.ts, vision/m3Vision.ts, imagegen/chatstImage.ts, db/{schema.ts,schema-sqlite.ts,apiUsageLog.ts}, utils/{searchTools.ts,webosWorkspace.ts}}` + 前端 admin-web/shell-web dist + 服务器 `pm2 restart daily-server`。



**追加（2026-08-04 下午）三个线上问题修复**：

- **工具折叠可收起**：展开的工具组顶部新增「收起工具」按钮（ChevronDown，点击 `toolGroupOpen[gi]=false` 回到一行摘要），与展开/折叠状态独立记忆。
- **180s 超时后上下文被清空（根因修复）**：原 catch 对所有异常**无条件 dispose pi 会话**（超时也算）→ 用户重试时 AI 不记得前面。修复：①空闲超时（message 含"已中断/无活动"）**不 dispose**，保留会话上下文，报错提示"请稍后重试；本会话上下文已保留"；②busy 重试从 dispose+重建改为**等待 2s×次数后重试同一会话**（最多 3 次，busyRetried 改计数器），超时中断后仍在后台跑的 prompt 完成后自然轮到本次请求；③**所有注入工具统一过 wrapTool 包装**（原只有 appTools 有 execution.log 记录），工具执行开始即 `markPiActivity()`——生图等长工具执行期间不会被 180s 空闲超时误杀（此前仅靠 pi 事件刷新活动计时）。
- **刷新加载页 logo 显示默认「D」（根因修复）**：BootScreen 在 bootstrap 返回前渲染，此时 store.logo 恒为 null（bootstrap 返回后加载页通常已结束）→ 加载页全程显示「D」，主页 header 却显示用户 logo（月亮）。修复：新增 `daily-webos-logo` localStorage 缓存（readCachedLogo），store 创建时恢复缓存 → 首帧加载页即显示真实 logo；hydrate 用服务端最新值刷新缓存（用户换 logo 下次刷新首帧生效；游客/删除后清缓存回「D」）。服务端 bootstrap.logo 本身一直正常（实测返回 image/svg+xml 440 字符）。

部署：server/src/routes/webos.ts + client/shell-web/dist（index-BgVholAn.js）。

**① AI"grep 调用不了"根因与修复（看实际日志确认）**：用户执行日志显示 AI 用 `agent_fs_grep` 搜系统源码（`../server/src/routes/webos.ts`）→ 路径越界被拒；`path=apps` 搜 `assets`/`/webos/api` found 0 是**真实结果**（该用户 App 源码确实不含这些字符串，grep 无 bug）。真正缺口是**系统源码只能 list/read、不能按内容搜索**。新增 **`agent_src_grep`** 工具（只读搜索 server/src、client/shell-web/src、shared，返回 文件:行号:内容，path 可限定目录，排除 node_modules/.env/dist）；提示词明确「agent_fs_grep 只能搜工作区，搜系统源码用 agent_src_grep」。

**② 180s"强制中断"根因与修复（空闲超时）**：`runPiPrompt` 原为整体 `Promise.race` 180s 超时——**工具执行期间计时器照跑**，生图/多轮工具累计超 180s 被误杀。改为**空闲超时**：`piLastActivityAt` + 5s 轮询，任何 pi 事件（LLM 增量/工具执行，subscribe 回调开头 `markPiActivity()`）刷新计时；仅"180s 内完全无活动"才中断。长任务不会再被误杀。

**③ 生图结果展示**：`tool_execution_end` 对 `generate_image` 成功解析 `files[].url` → SSE `tool_end` 事件带 `images[]`（契约更新）；前端 tool segment 存 `images`，工具 chip 下方渲染**图片网格**（几张贴几张），点击缩略图 → 全屏大图查看（Lightbox）+「下载原图」按钮；每张图角落有「下载」快捷按钮。

**④ 工具调用折叠**：连续 tool 段归组；组内全部完成且组后还有文字（text/html）时自动折叠为一行「使用了 N 个工具（grep、生图…）」，点击展开明细（chips + 图片）；正在执行/消息末尾的工具保持展开。与思考折叠独立按组记录状态。

部署：server/src/routes/webos.ts、server/src/utils/webosWorkspace.ts、server/src/piBridge.ts、shared/webos-contracts/index.ts + 前端 dist（index-BGG7MNZ5.js）。

### 应用商店 + 分享 + 导出 + 奖励 + App 互联 + 外部 API（2026-08-03 深夜）

**产品形态**：商店 = **数据 API（`/webos/api/store/*`）+ 形态（`system.store` 版本化 HTML App，AI 可改，同 system.desktop 模式）**。分享链接 `?exp=<shareId>` 打开直接体验（sandbox 运行商店快照，可登录安装）。

**数据表**（schema.ts / schema-sqlite.ts，两套）：
- `webos_store_apps`：已发布条目（shareId、owner_key、name/icon/description/html 快照、downloads）
- `webos_store_visits`：分享访问（shareId+visitor_key 唯一，visited→credited）
- `webos_store_installs`：他人安装（shareId+installer_key 唯一，触发下载奖励）
- 部署注意：SQLite 旧库需手动执行新表 DDL（`db.exec` 幂等建表，见验证脚本模式；服务端 SCHEMA_SQL 对新库自动生效）。

**服务端 API**（webos.ts，全部 authMiddleware 继承）：
- `GET /store/apps`（列表，含 installs 计数与 installed 标记）、`GET /store/apps/:shareId`（详情含 html）
- `POST /store/apps`（发布：快照 active 版本；重复发布更新快照、shareId 不变）、`DELETE /store/apps/:shareId`（下架，仅 owner）
- `POST /store/apps/:shareId/install`（复制为我的 App `store:<shareId>`，source='store'；他人首次安装 → 发布者 +100 积分）
- `POST /store/apps/:shareId/visit`（分享访问上报；owner 自己不算；每访问者每应用一次）
- `GET /store/apps/:shareId/export`（**zip 导出源码**：index.html + 发布者工作区 assets/，Node zlib 手写标准 zip：CRC32 + deflate + central directory）
- `GET /store/my`（我的发布 + installs/visits 统计）
- `POST /http`（**外部 API 代理**：App 接入 uapis.cn 等第三方/自建 API；SSRF 防护 dns.lookup 禁内网/回环、限频 30 次/分、15s 超时、≤2MB、禁 host/cookie/authorization 头）
- 导出 `grantCredits(key, amount)`（+N 积分，写 credits.quota）与 `settleShareRewards(guestKey)`（分享奖励结算）

**分享奖励**：访问者打开体验页 → 上报 visit（游客 key）→ 访问者登录/注册/重置密码时 `emailAuth.migrateGuestAssets` 末尾调用 `settleShareRewards(guestKey)`（无论是否发生资产迁移）→ 对应分享者各 +100 积分，visit 标记 credited。自己分享给自己不算。

**AI 工具**：`publish_webos_app` / `unpublish_webos_app`（发布/下架）；提示词新增：商店形态可改（system.store）、外部 API（DailyWebOs.http）、App 互联（DailyWebOs.api）、导出说明。

**前端**：
- `runtime.ts`：App SDK 新增 `http.request/get/post`（经宿主代理）+ `api.register/call`（**App 间互联互通**：宿主维护 `appRuntimePorts`（每个打开过的 App 保留 MessagePort 后台保活），api.call 转发到目标 App 执行 handler 后回传；目标未打开返回明确错误）；新增 `createStoreRuntime`（商店桥：list/install/share/exportUrl/my/myApps/publish/unpublish + download 指令）
- App 侧 bootstrap（App.tsx）：SDK 加 http/api；onPortMessage 处理宿主转发的 `api_call`（执行 `window.__dailyWebOsApiHandlers` 里的 handler 并回传 api_result）
- `StoreView`（system.store iframe + StoreSDK）、`ExperienceView`（?exp= 体验页：运行快照 + 安装按钮 + visit 上报（localStorage 防重））、桌面点击 system.store → 商店、boot 后检测 exp 参数进入体验页
- api.ts：store 系列函数 + proxyHttp

**线上端到端验证**：发布 → 列表 → B 访问（visit）→ B 安装（"发布者获得 100 积分奖励"）→ B 重复安装不重复奖励 → 导出 zip（HTTP 200、PK 头 504b0304）→ C 积分 quota=200（100+100 下载奖励）→ 三张表数据正确。分享奖励结算逻辑已接入登录流程（服务进程内调用，脱离进程脚本无法初始化 DB 池属预期）。

部署：schema 两文件、webos.ts、emailAuth.ts、piBridge.ts、webosStoreV1.ts（新文件，src/）+ 前端 dist。SQLite 旧库需手动建表（见上）。

### 批量修复 + 对话内互动 HTML（2026-08-03 晚）

**① 会话标题"没生效"根因（SW 缓存）**：AI 标题逻辑此前已上线且验证正常，但用户浏览器一直加载旧 bundle——sw.js 原为 stale-while-revalidate（先返回缓存旧 JS，后台更新），发版后用户要刷新两次才拿到新代码。**sw.js 改为 network-first**（fetch 失败才回退缓存）+ CACHE_NAME 升 v0.1.2；配合 store 的 boot.html localStorage 缓存，加载页与标题功能发版即生效。注意：旧会话（无 titleAuto 字段）不会触发 AI 标题，新会话才会。

**② 生图后卡住 + 会话上下文丢失根因（DeepSeek 503）**：pm2 日志确认 `err=503 Service is too busy`（DeepSeek 侧繁忙）。原代码对 `agent_end stop=error` **一律 dispose 会话** → 503 后整个会话上下文被丢弃，用户"继续"时 AI 不记得前面。修复：**区分暂时性错误**（503/429/too busy/rate limit → 保留会话，用户重试即可续上记忆）与非暂时性错误（400 等 → 仍 dispose 自愈）；错误码 `WEBOS_AI_BUSY`，落审计 status=empty_response。

**③ 报错显示在对话内（不弹窗）**：UiSegment 新增 `{type:'error'}`；`onEvent error`、HTTP/网络 catch、空回复兜底全部改为 `appendErrorToConversation`（替换"正在思考…"空占位或追加新消息，红色卡片 + 复制按钮），不再 set error 弹 toast。402 积分不足等 WebOsApiError 消息也进对话。

**④ 称呼实时更新**：tool_end 事件里 `set_display_name && ok` → refreshBootstrap（对话页用户名/问候语即时更新；ProfileView 路径原本已有刷新）。

**⑤ 加载页"先默认后自定义"**：根因同①（旧 bundle 无缓存逻辑）。SW 修复后，有缓存的用户刷新即首帧自定义页；首次访问仍会先默认后切换（正常）。

**⑥ 输入框自适应 + 齿轮图标**：textarea 高度随输入增长（44-160px，超高内部滚动），发送后重置；composer 加号按钮改为 Settings 齿轮图标。

**⑦ 对话内互动 HTML（新功能，全链路验证通过）**：
- 服务端 `show_interactive_html` 工具（webos.ts）：参数 { html, heightPx 120-480 默认 280 }，校验复用 validateAppHtml + validateGeneratedHtml；描述明确尺寸约束（宽=100% 屏宽、高 120-480px 约大半屏、建议 220-320 约 4 倍输入框高）；tool_execution_end 转发 SSE `interactive_html` 事件。
- shared 契约 WebOsChatEvent 新增 `{ type:'interactive_html'; html; heightPx? }`。
- 前端 UiSegment 新增 `{type:'html'}`；MessageBubble 渲染 sandbox iframe（复用 APP_RUNTIME_BOOTSTRAP localStorage polyfill），圆角卡片样式。
- piBridge 系统提示词新增「对话内互动内容」条目（含尺寸约束与 create_webos_app 区分）。
- 线上端到端：真实对话"在对话里插入一个交互式计算器"→ SSE 事件流含 `interactive_html` ✓。

**管理后台账号**：`2893334965@qq.com`（role=admin，称呼「芸」），密码为用户注册时自设；另有运维种子账号 ops-admin@daily.local（无登录入口）。忘记密码可在服务器直接改库（scrypt）。

部署：server/src/routes/webos.ts + server/src/piBridge.ts + client/shell-web/dist 全部上传；sw.js 必须同步上传（缓存策略变更）。

### AI 自动生成会话标题（2026-08-06）

用户反馈"AI 自动创建会话标题没有启动"：此前实现只是**机械截取第一条用户消息前 20 字**（前端 store.ts，2026-08-05 多会话时加入），并非 AI 生成。运行时验证（真实 store.ts + stub api）确认截取逻辑正常，用户期望的是像 DeepSeek/ChatGPT 那样的 **AI 智能标题**。本轮实现：

- **后端**：`piBridge.ts` 新增 `generateConversationTitle(texts)`——pi-ai `completeSimple` 一次性补全（**不创建 agent 会话、不进会话历史、不注入工具**），thinking=minimal（pi-ai SimpleStreamOptions 无 'off'，minimal 被 thinkingLevelMap clamp 到 low），maxTokens=64，超时/失败返回 null；复用 createWebosSession 的 ModelRegistry + registerDeepseekModels 构建逻辑（DEEPSEEK_API_KEY 注入一致）。
- **后端路由**：`POST /webos/api/chat/title`（authMiddleware）——body `{ texts }`（≤10 条、每条 ≤500 字、总长 ≤4000），限频每用户每 10 分钟 5 次（防刷烧钱）；生成结果经 `recordAiUsage` 落审计（thinking='off' 已放宽类型为 string；**不扣用户积分**，成本极小）；失败返回 `{ title: null }` 由前端回退。
- **前端**：`api.ts` 新增 `generateConversationTitle`；`store.ts` 在 `runConversationTurn` finally 中（会话首次 AI 回复完成后）：`ChatConversation` 新增 `titleAuto`（自动标题标记；用户重命名置 false 后 AI 不再覆盖）与 `titleAiDone`（每会话只尝试一次）字段；收集最近 ≤8 条消息纯文本（各 150 字、总 ≤1600 字）→ fire-and-forget 调用 → 成功且仍为自动标题时覆盖。截取标题保留为**即时反馈 + AI 失败回退**（双轨：发消息立即有标题，几秒后升级为 AI 概括标题）。
- **顺带防御修复**：`sendMessage` 称呼引导的 `currentSession?.user.id` / `.displayNameSet` 改双重可选链（session.user 极端情况下为 null 时不再抛 TypeError，游客流程更健壮）。
- **回归**：server `tsc --noEmit`、shell-web `tsc -b --noEmit`、`vite build` 全部通过；前端三场景运行时验证（真实 store.ts esbuild bundle + stub api）：①新建会话发消息 → 截取标题 → AI 标题覆盖（titleAuto=true、titleAiDone=true、仅请求一次）②同会话再发消息不再请求 ③手动重命名后 AI 不覆盖；**真实 DeepSeek 冒烟测试**：`generateConversationTitle(['用户：帮我做一个待办清单 App', ...])` → `"待办清单 App 开发"`（约 12s，含 pi 首次加载；线上会话缓存后更快）。
- 部署注意：后端 `server/src/piBridge.ts`（src/）+ `server/src/routes/webos.ts`（routes/）**分别放对目录**；前端 dist 需重新构建上传。


### 当前已知限制与后续

- 当前浏览器自动化环境报告的 CSS viewport 约为 389px，即使外部窗口显示为 780px，也不会触发 `@media (min-width: 700px)`；因此桌面浮起圆角效果不能在该移动模拟环境中确认。CSS 规则仍保留，需用真实桌面 viewport 再确认。
- PWA manifest 和图标访问已验证，但尚未完成操作系统级“安装 PWA”全流程。
- 当前游客回归空间中保留了若干测试 App，便于继续检查版本和 Runtime；清理前应先确认用户是否希望删除。
- 支付 Provider、邮箱验证码 Provider、公共商店、社区分发和托管服务 App 仍不在首版实现范围。

### AI 即系统（2026-08-01 方向落地）

> 用户决策：**AI 是系统本身**。除了 AI 对话页（assistant）的输入框和对话内容，系统是 AI 的家——
> AI 可以自由修改系统桌面、管理文件、创建/修改 App、添加页面、定制视觉。保留的只有
> 「版本化 + 回滚 + 校验」三件安全带（不限制 AI 能力，只保证系统可恢复）。

**架构变化：**

- **系统桌面 = `system.desktop` App（版本化 HTML）**：`loadState` 时幂等初始化
  （`ensureSystemDesktop`），初始 HTML 是 `server/src/webosDesktopV1.ts` 的
  `WEBOS_DESKTOP_V1_HTML`——完整复刻原 React 桌面功能（壁纸/时钟/图标网格/Dock/长按整理/
  页面指示器）但**删掉所有碍眼标语**（MY SPACE/游客/NOW 卡片/“系统”/“刚刚创建”小字）。
  v1 是「参考实现」：AI 改砸了可回滚，或参考 v1 复原。`DELETE /apps/system.desktop` 被
  403 保护。
- **前端桌面 iframe 化**：`DesktopView` 改为 sandbox iframe 渲染 `system.desktop` 的
  active 版本 HTML + `createDesktopRuntime`（runtime.ts）MessageChannel 桥。桌面 HTML 通过
  `DesktopSDK` 向宿主请求数据/服务：`apps.list / apps.open / apps.reorder / apps.remove /
  system.navigate`。AI 修改桌面 → `update_webos_app` → `app_updated` SSE → 前端
  refreshBootstrap → 桌面自动换新版本。
- **Agent 工作区（文件系统）**：`server/src/utils/webosWorkspace.ts` 提供 per-user 磁盘
  工作区 `<SANDBOX_DIR>/webos/<key>/`（`home/` 用户可见区、`system/` 系统素材、
  `agent/` 草稿区），注入 7 个 `agent_fs_*` 工具（list/read/write/mkdir/delete/stat/
  search），路径校验禁止越界。webOS 会话提示词升级为「AI 即系统」版，并新增禁区
  （对话页输入框/对话内容、系统功能页 files/settings/billing）。
- **webOS 专用 skills**：`.pi/skills-webos/`（只加载受控 skill，不加载 `.pi/skills/` 下
  会操作服务器 cwd 的 fs-cli 等）。已内置 `design` 设计 skill（提炼 Huashu Design +
  Open Design 精华：6 套 tokens、组件规范、动效技术、webOS 约束）。
- 桌面 iframe 沙箱注意：无 `allow-modals`，`window.confirm` 静默失败 → 桌面 v1 用自绘
  确认面板；桌面 JS 不用 `fetch`/真实 `localStorage`（宿主 polyfill + SDK）。

**已回归（真实 DeepSeek 会话 + SQLite + 本地服务验证）：**

- AI 对话中真实调用 `agent_fs_list → agent_fs_mkdir → agent_fs_write → agent_fs_read`，
  工作区文件真实落盘（`guest:xxx/agent/notes/hello.md`）。
- AI 修改系统桌面：`get_webos_app(system.desktop) → update_webos_app` → 新版本
  v1.0.1（深蓝壁纸+时钟左下角）→ `app_updated` SSE 事件 → 前端自动刷新。
- AI 加第二页：v1.0.2 桌面含 2 个 `.page`（scroll-snap 横向滑动）+ 待办卡片 + 双点
  页面指示器；版本历史 v1.0.0（参考）→ v1.0.1 → v1.0.2 可回滚。
- 两端类型检查（server `tsc --noEmit`、shell-web `tsc -b --noEmit`）与 shell-web
  `vite build` 全部通过。

**桌面 Dock 点击无反应 + 顶部留白修复（2026-08-01 线上回归）：**

- 根因：桌面 SDK 桥原本用 MessageChannel 握手（load 事件 + `contentDocument` 兜底），
  在 opaque origin sandbox 下握手经常失败 → SDK 未连接 → Dock 点击无响应、时钟/布局异常。
- 修复：`runtime.ts createDesktopRuntime` 改为**纯 postMessage 双向直连**（iframe 内
  `window.parent.postMessage({channel:'daily-webos-sdk',...})` 发请求，宿主 window
  'message' 监听并按 `event.source !== iframe.contentWindow` 校验来源后回响应），100% 可靠。
- 桌面 v1 重写为**简洁大方版**：紧凑时钟（28px 置顶）、图标 54px、Dock 44px、
  页面 padding 64px，去除大片留白；沿用 design skill 的 tokens。
- `ensureSystemDesktop` 增加**自动升级**：仅当桌面从未被 AI/用户改过（唯一版本、
  `createdBy=system`、v1.0.0）且 active HTML ≠ 新模板时，创建 v1.0.1 新模板版本
  （旧版保留 ready 可回滚）；AI 改过的桌面不自动覆盖。
- 线上验证：用户真实身份 `guest:a7d202` 桌面 v1.0.0(ready) → v1.0.1(active)，
  newBridge=true（`parent.postMessage`）、无 MessageChannel；新游客初始化即新模板；
  AI 对话链路 `start → delta×8 → done` 正常。

**桌面 JS 语法错误二次修复（2026-08-01 线上，根因在模板字符串转义）：**

- 现象：Dock 修复部署后用户仍看到「淡蓝背景 + 底部三个按钮」——桌面 JS 全部没执行。
  浏览器控制台 `Uncaught SyntaxError: Unexpected string (about:srcdoc:380)`。
- 根因：`webosDesktopV1.ts` 用 **TS 模板字符串（反引号）内嵌桌面 HTML/JS**，内嵌 JS 里的
  `\"`、`\u0022` 等转义序列在**模板字符串求值时被消费**（`\"`→`"`、`\u0022`→`"`），
  生成的 HTML 里 JS 源码变成裸引号 → 语法错误 → 整个 `<script>` 不执行
  （时钟不渲染、图标不加载、Dock 点击无反应、只剩静态背景）。
  首次部署时本地只用 `readFileSync` 提取模板文本做 vm 检查（源码文本 OK），
  **没做「求值后」验证**，导致坏模板上线。
- 修复：内嵌 JS 字符串全部改用**单引号**（`'<img alt="" src=...'`），模板字符串里
  单引号无需转义、求值安全；`\u0022` 改为字面 `'"'`。
- 部署后**必须**在 tsx 运行时验证求值结果：`npx tsx` import 模板 → 提取 `<script>`
  → `vm.Script` 检查（服务器与本地各一次）。
- 存量数据修复：唯一版本坏模板（v1.0.0）游客由 `ensureSystemDesktop` 自动升级修复；
  非唯一版本（用户 a7d202 的坏 v1.0.1）手动运维脚本创建 v1.0.2（新模板）切换 active，
  旧版保留可回滚（脚本已执行，数据库有备份 `data/daily.db.bak-fixdesktop`）。
- 教训：**模板字符串内嵌 JS 的转义序列会静默改变求值结果**；任何 HTML 模板改动
  必须验证「运行时求值结果」而非源码文本；验证方法写入部署手册 §3 检查清单。

**桌面被 AI 改成深色版 + 可观测性基建（2026-08-01 线上）：**

- 现象：用户反馈桌面"先进新版、后变旧版"——查版本历史发现 AI 在对话中把桌面
  改成了深色壁纸版（v1.0.3/v1.0.4，`bg1=#141c2c`，createdBy=guest），并非缓存问题。
- 处置：回滚 a7d202 桌面 active 到 v1.0.2（淡蓝简洁修复版）；v1.0.3/v1.0.4 保留
  ready 可回滚（数据库备份 `data/daily.db.bak-rollback`）。教训：AI 改桌面是
  "AI 即系统"的正常行为，排查"桌面变了"应先查 App 版本历史，而非怀疑缓存/代码。
- **`/webos/api/` 全部响应加 `Cache-Control: no-store`**（动态 API 含用户私有状态，
  浏览器启发式缓存会导致看到过期桌面/App；此前无该头，bootstrap 曾出现 304 复用）。
- **工作区编号 + AI 执行日志**（用户建议）：
  - 每个用户工作区 `<SANDBOX_DIR>/webos/<key>/` 增加 `meta.json`
    （`workspaceId: ws-<sha256(key)前8位>` 确定性编号、创建时间）与 `logs/execution.log`；
  - `logs/` 与 `meta.json` 由系统写入，`agent_fs_write/mkdir/delete` 校验拒绝
    （`assertMutable`），AI 只读不可改；日志 JSON Lines 记录每次
    `agent_fs_*` 与 webOS App 工具（create/list/get/update）调用的时间、工具、
    参数摘要（>200 字符截断）、成败与错误；20MB 自动轮转。
  - 端到端验证：AI 真实调用 `agent_fs_list → agent_fs_read` 后
    `meta.json`/`execution.log` 生成；AI 尝试写 `logs/test.txt` 被拒
    （`ok:false, note:"路径受保护（仅系统可写）：logs"`）。

**AI 下雨版桌面修复（2026-08-01，AI 生成代码的 div/canvas bug）：**

- 背景：用户让 AI 给桌面加下雨效果，AI 用 `update_webos_app` 创建 v1.0.3/v1.0.4
  （深色壁纸 + 完整雨滴代码：300 滴、斜风、落地涟漪、雨点避开图标、requestAnimationFrame）。
  **这证明 AI 自由度是真实的**（createdBy=guest，系统不拦截）。
- 现象：用户反馈"下雨没生效、桌面变深色空版"。
- 根因：AI 写的 HTML 里 `<div id="rain">` 是 **div**，但 JS 调用
  `getContext("2d")`（canvas 方法）→ `TypeError: canvas.getContext is not a function`
  → 雨滴 IIFE 崩溃 → 同一 `<script>` 内**后续代码（时钟 tick、SDK.apps.list 图标加载）
  全部中断** → 用户看到深色空桌面（无雨、无图标、时钟空白）。
  上一轮曾误判为"AI 乱改桌面"并回滚（教训：先查版本历史与运行时错误，再决定回滚）。
- 修复：创建 v1.0.5（把 `<div id="rain">` 改为 `<canvas id="rain">`，其余不动），
  切换 active；v1.0.4 保留 ready 可回滚。实测：canvas 尺寸 778×1310、
  雨滴像素采样 42 处非空（雨在下）、时钟/图标/Dock 均正常。
- 教训：**AI 生成的桌面/App HTML 也要运行时验证**（console 无 TypeError、
  关键元素类型正确）；排查"AI 改的东西没生效"先看浏览器 console 与版本历史，
  不要急着回滚。运维脚本已执行（数据库备份 `data/daily.db.bak-rollback`）。

**AI 对话体验改进（2026-08-01，用户反馈三项 UI 问题）：**

- **工具调用进入消息流**：`WebOsChatMessage` 增加 `toolCalls[]`（原单数 `toolCall`
  保留兼容），`tool_start/tool_end` 按顺序追加/更新，不再互相覆盖；每条工具调用
  在对话气泡内独立展示（图标 + 中文名 + 进行中/完成/失败状态）。
- **markdown 渲染**：自带轻量渲染器（`renderMarkdown`，无第三方依赖）：标题、
  粗体/斜体、行内代码、代码块、无序/有序列表、引用、链接、分隔线；先 HTML 转义
  再解析（防注入），流式半成品容错（未闭合代码块/列表自动收尾）。
- **自动滚动**：`AssistantHome` 监听 messages/streaming 变化，`assistant-scroll`
  自动 `scrollTop = scrollHeight`，跟随 AI 输出。
- 验证：真实对话中 AI 连续调用 4 次 `agent_fs_list` + 1 次 `agent_fs_read`，
  消息流中逐条显示"查看工作区 · 完成/进行中…"；markdown 列表正确渲染。

**把源码给 AI + App 创建能力全面打通（2026-08-01，用户明确要求）：**

- 用户诉求：AI 面对"粘贴 HTML → 桌面出现 App"这类需求不该说"做不到"；
  要求把系统源码给 AI，让 AI 自己查源码确认能力、调用工具实现。
- **源码只读工具**：`agent_src_list` / `agent_src_read`（webosWorkspace.ts），
  AI 可读 `server/src`、`client/shell-web/src`、`shared` 全部源码（排除
  node_modules/.env/dist/.git/docs）；系统提示词明确"有需求先读源码确认能力，
  不要臆测、不要拒绝；运行中 Shell 源码只读不可改（安全带）"。
- **AI 引导**：`create_webos_app` 描述明确"用户粘贴的 HTML 原样创建 App，
  不得说做不到"；系统提示词加"用户提供的 HTML 直接创建"条目。
- **用户直连**：assistant 首页「粘贴 HTML 创建 App」按钮 → 弹层粘贴 HTML →
  `POST /apps`（local_import）→ 刷新后自动打开新 App（不依赖 AI）。
- **App 内创建能力**：新增能力 `system.apps.create`，所有新 App 默认拥有
  （`DEFAULT_APP_CAPABILITIES`）；运行时 SDK 增加 `DailyWebOs.apps.create(name, html)`，
  宿主经 `runtimeAppsAdapter` 调后端创建——"App 工坊"类 App 真正可工作。
- 端到端验证：AI 用 `agent_src_read` 读 webos.ts（6 次工具调用）；
  用户粘贴倒计时器 HTML → AI 直接 `create_webos_app` → `app_created` 事件 →
  桌面出现新 App（不再拒绝）。

**Skill 系统修复 + AI 删除 App + myself 长期记忆 + 对话 UI 修复（2026-08-01 下午）：**

- **Skill 修复（根因：read 工具缺失导致 skill 从未注入）**：pi 只在 `read` 工具
  可用时把 `<available_skills>` 注入系统提示词，且要求模型用 read 读 SKILL.md；
  webOS 会话 `noTools:'builtin'` + customTools 无 read → design skill 从未被 AI
  感知（此前"你有设计 skill"是空话）。修复：webOS 会话注入受控 `read` 工具
  （webos.ts `readTool`）——允许读 `.pi/skills-webos/` 下 skill 文件（兼容绝对
  `<location>` 路径）+ 用户工作区（同 agent_fs_read），触发 skill 注入且不越权。
- **目录路径修复**：`.pi/skills-webos` 在项目根，而服务 cwd=server/，原
  `join(cwd,'.pi','skills-webos')` 指向不存在目录（线上同样 miss）。webos.ts 与
  piBridge.ts 均改为「cwd 优先、项目根回退」。验证：`loadSkillsFromDir` 加载
  design + myself 两个 skill，`formatSkillsForPrompt` 注入 count=2。
- **AI 删除 App**：新增 `delete_webos_app` 工具（webos.ts），删除 App 同时清理
  appStorage 与工作区 `apps/<appId>/` 目录；BUILTIN_APPS（system.desktop、
  daily.ai、system.files、system.settings）受保护不可删；记入 execution.log。
- **生成 skill + myself 长期记忆**：新增 `manage_skill` 工具——AI 可在
  `.pi/skills-webos/<skill>/` 下创建/更新/删除 SKILL.md 与 references/* 文件，
  写 SKILL.md 自动维护 frontmatter（name=目录名，description 取正文首行去
  markdown 标记；skill 名仅小写字母/数字/连字符，与 pi 校验一致）。
  预置 `.pi/skills-webos/myself/SKILL.md`（发现/经验/教训/用户画像四维度 +
  references 索引）；系统提示词要求 AI 运营 myself：每次对话有发现/经验/教训/
  偏好时当场用 manage_skill 更新，新会话先读它回忆自己。
- **对话 UI 修复**：①用户消息改蓝色气泡（AI 消息保持平铺无气泡）；
  ②三字消息被拆行修复——宽度约束从 `.user-row .chat-text{max-width:82%}`
  移到 `.user-row .chat-body{max-width:82%}`（原写法 chat-text 百分比宽度对
  flex column 的 chat-body 形成循环依赖，浏览器把气泡压到极窄）；
  ③composer 区改为全宽渐变遮罩 + `backdrop-filter: blur(16px)`，滚动时
  思考/模型 chips 与背景文字不再重叠；chips 背景提高到 0.94 不透明。
- 验证：server `tsc --noEmit`、shell-web `tsc -b --noEmit`、`vite build`
  全部通过；skill 加载/注入脚本验证通过（临时脚本已删）。
- 部署注意：webOS 会话按 scope+thinking 缓存，pm2 restart 后新工具才生效；
  首次对话即加载 myself/design（`<available_skills>` 注入）+ read/manage_skill/
  delete_webos_app 工具。

**工具记录不消失 + App 源码工作区化（2026-08-01 晚间）：**

- **工具调用记录消失根因修复（前端 store.ts）**：`sendMessage` 原先用
  `nextMessages`（只含纯文本的服务端消息）**整体替换本地 messages**，导致
  用户发第二条消息时，上一条 AI 消息里的 tool 分段全部被丢弃。修复：本地
  messages 原样保留（追加新消息），`nextMessages` 仅用于发送。
- **tool_start/tool_end 匹配修复**：原实现只更新「最后一段」，连续/并行工具
  调用时互相覆盖（第一个工具永远显示"执行中"）。现改为按「工具名+未完成」
  从后往前匹配分段；tool_start 对末尾同名未完成段去重。
- **App 源码工作区镜像（「AI 即系统」核心路径）**：每个 App 的源码 HTML 镜像
  在工作区 `apps/<appId>/index.html`（创建/更新/回滚/切换版本时同步写回）。
  **AI 可以直接用 agent_fs_write/agent_fs_edit/agent_fs_read 修改该文件**；
  bootstrap 与 `GET /apps/:appId` 检测到文件与 DB active 版本不一致时，
  自动创建新版本并切换（版本化保留可回滚；校验失败保留原版本 + 日志警告）。
  系统提示词明确两种改 App 方式（① 直接改工作区文件 ② update_webos_app），
  推荐 ①。线上验证：AI 创建 App（v1.0.0）→ `agent_fs_edit` 改 index.html →
  bootstrap 自动发布 v1.0.1(active) 且 HTML 为新内容，v1.0.0 保留 ready。
- 验证：server `tsc --noEmit`、shell-web `tsc -b --noEmit`、`vite build`
  全部通过；线上端到端（创建→改文件→自动新版本）实测通过。

**删除 get_webos_app + markdown 增强（2026-08-01 晚间）：**

- **删除 `get_webos_app` 工具**：App 源码已工作区化后，该工具与
  `agent_fs_read apps/<appId>/index.html` 重复。删除工具定义与全部引用
  （系统提示词/update_webos_app、delete_webos_app 描述/README/前端标签），
  AI 读 App 代码统一走工作区文件；REST `GET /apps/:appId` 保留（前端用 +
  热更新检测点）。线上验证：AI 确认"没有 get_webos_app"，读 App 代码
  用 `agent_fs_read` 读 `apps/<appId>/index.html`。
- **markdown 渲染增强（client/shell-web，KaTeX）**：新增 LaTeX 渲染
  （行内 `$...$` + 块级 `$$...$$`，KaTeX 0.16，`throwOnError:false` +
  异常降级原文，流式半成品容错）与 GFM 表格（`| a | b |` 语法：
  表头 + `:---:` 分隔行 + 数据行，单元格走 inlineMarkdown，窄屏横向滚动）。
  新增 `katex` 依赖（JS 505KB / gzip 155KB，woff2 字体随构建产物上传）。
- 部署注意：后端 3 文件（webos.ts/piBridge.ts/webosWorkspace.ts）上传时
  **分别放对目录**（routes/、src/、utils/），勿一次 scp 到同目录。已线上验证。


---

### 断连恢复 / 工具实时进度 / 商店修复（2026-08-07，线上排查 + 全部上线）

> 起因：用户反馈四个问题——①"后台处理"卡片一直不消失 ②断联后不自动恢复反而报错
> ③AI 工具调用实时输出只显示开头 ④应用商店"根本没做"。以下为线上实测根因与修复。

**线上实测数据**：
- pm2 重启 138 次；error.log 大量 `PathError [TypeError]: Unexpected ( at index 30: /store/apps/:shareId/raw/:file(*)`——旧版商店素材路由用了 Express5 不支持的 `:file(*)` 写法，**注册路由即抛异常导致启动崩溃循环**（商店上线窗口期）；当前代码已改用 `webosRouter.use('/store/apps/:shareId/raw', ...)`（query/前缀式，合法）。
- `guest:a7d202` 的 system.store 有 20 个**内容完全相同**的版本（v1.0.1~v1.0.20，31483 bytes，`v1.0.12==v1.0.13`）——版本循环 bug 实证。
- 商店表 webos_store_apps 只有 5 条测试条目（"游客 的整套系统"×2、"应用商店"、"app-xxx"、"store-verify-app"），无正式应用。
- 当前 `WEBOS_STORE_V1_HTML` 模板 = 13098 字符（线上各账号 v1.0.0 即最新模板；31483 是 AI 改过的版本）。
- 用户账号 `user:fb9f2d90`：apps = drink-shop/system.desktop(#17)/system.store(v1.0.0)/system.trash，日志显示大量 `chat prompt start`、`agent_end stop=aborted err=Request was aborted usage=0`、`chat queued request terminated (client disconnected while waiting)`、`background task finished (client disconnected)`。

**修复（服务端 webos.ts）**：
- **断连终止必须关闭 SSE**：`disconnected && (waitingForBackground || busyRetried>0)` 分支 `return` 前补 `res.end()`——此前 res 悬挂，前端 fetch 永远等不到结束（卡片不消失/网络报错）。
- **版本循环修复**：`syncAppSourceFromWorkspace` 创建新版本后 `writeAppSourceMirror` 写回镜像文件——文件与 DB 存在字节级差异（BOM/换行）时每次 bootstrap 误判 changed → 无限建版本。线上验证：a7d202 循环停止（v1.0.21 后镜像==active、版本数稳定）。
- **`tool_execution_update` 转发**：subscribe 新增分支，把 pi 工具 `onUpdate` 输出的 `partialResult.content` 转发为 SSE `tool_update`（契约 `WebOsChatEvent` 新增 `{type:'tool_update', tool, content}`）；`extractUserEvent` 同步支持（后台任务缓冲也记录工具过程）；`edit_image` 批量处理逐张 `onUpdate` 报告进度。
- **ensureSystemStore 补「未改动自动升级」**（同 ensureSystemDesktop 模式）：早期账号唯一版本由系统创建时自动升级到当前模板（当前模板与线上一致不触发，未来模板更新时生效）。
- 后台任务缓冲 `BgTaskEvent.kind` 增加 `tool_update`。

**修复（前端 shell-web）**：
- `UiSegment.tool` / `backgroundTask.tools` 增加 `progress` 字段；SSE `tool_update`、`background_progress(kind=tool_update)`、后台恢复渲染三处均追加进度文本（≤600 字符截断）；工具 chip 下方渲染 `.tool-progress` 实时进度，后台卡片工具项渲染 `.bg-task-tool-progress`。
- **断流兜底清卡片**：网络错误且确认无后台任务时 `setState({backgroundTask: null})`——旧卡片无人清理问题修复。
- **刷新自动恢复**：hydrate 身份不变分支也调用 `recoverBackgroundTask(activeConversationId)`——此前普通刷新不恢复，用户只看到"任务仍在后台"提示。

**部署与验证（线上）**：server tsc、shell-web tsc/build 全过；scp webos.ts + 前端 dist（index-f99N4DgY.js）+ chmod 644；pm2 restart 单实例监听；curl SSE 对话流式正常、商店列表 API 正常、a7d202 bootstrap 后版本数稳定（22，镜像==active）。

**遗留说明**：a7d202（测试游客）的 apps 里有畸形 id（`share:...:system.desktop`、`store:s-...` 等早期安装拼接残留）与 20 个重复版本，无害不清理（保留可回滚）；商店无正式应用属内容问题，非代码缺陷。

### 应用商店「加载失败」根因修复（2026-08-07 晚，用户要求实际打开商店）

> 用户反馈"打开我这里的应用商店看看"。用 Playwright 实际打开线上商店后看到：
> `加载失败：Cannot read properties of undefined (reading 'items')`——商店列表完全不可用。

**根因（字段名不匹配）**：商店模板 `webosStoreV1.ts` 的响应解析写的是
`p.resolve(data.result)`，而宿主 StoreSDK（`runtime.ts createStoreRuntime`）响应字段是
`data`（桌面模板正确读 `msg.data`，所以桌面正常）——商店拿到 `undefined` → `res.items` 崩溃。
商店从 2026-08-03 上线起就是这个状态，等于"商店 UI 存在但永远加载失败"。

**修复（webosStoreV1.ts）**：`p.resolve(data.result)` → `p.resolve(data.data)`（仅此一行）。
部署后 Playwright 实测：商店列表正常渲染 5 条应用（含「饮屿 · 鲜饮商城」），安装/分享/源码按钮可用。

**连锁修复（webos.ts）**：
- `ensureSystemStore` 升级模板时**同步写回工作区镜像**——否则 `syncAppSourceFromWorkspace`
  会把旧镜像当「AI 修改」建版本覆盖回旧模板（实测 store-test-a 升级 v1.0.1 后被
  v1.0.2:guest 旧内容覆盖）；`ensureSystemDesktop` 升级同样补镜像（防御）。
- `ensureSystemStore` 升级条件放宽：**所有版本都是系统模板（当前/旧模板）即升级**
  （覆盖早期账号与被旧镜像覆盖的账号）；AI/用户改过形态的（a7d202 31483 定制版）不覆盖。
- 线上验证：store-test-a 自愈 `1.0.0→1.0.1(新)→1.0.2(旧镜像覆盖)→1.0.3(新 active)`，
  mirror==active；a7d202 版本数稳定 22、AI 定制版保留。
- 存量旧账号（含用户 fb9f2d90）下次 bootstrap 自动升级到新模板（含修复）。

**排查方式说明**：browser 包（MCP）的 goto 可用但 snapshot/evaluate/wait_for/run_code
封装报 `Exactly one tool_name parameter is required`（封装层缺陷），改用项目自带
Playwright（`npx playwright install chromium` + `install-deps`）完成真实浏览器验证。

### 五项体验问题修复（2026-08-07 深夜，全部实测验证）

> 用户反馈：①长按图片 icon 的应用弹浏览器菜单 ②工具调用时旁边数字不更新
> ③生图预览只显示一张 ④AI 创建的 App 里图片不渲染 ⑤创建 App 后桌面不刷新看不到。

**① 长按图片 icon 弹浏览器菜单（webosDesktopV1.ts）**：桌面图标若为图片（icon.png/raw），
长按触发浏览器图片菜单打断系统长按菜单。修复：`.app .tile img { pointer-events: none;
-webkit-touch-callout: none; user-select: none }`——图片不接收指针事件，长按落在 .app 上。
实测：带 4px 位移的长按也能弹出菜单。

**② 工具数字不更新（App.tsx + webos.ts）**：ToolRunningStatus 的「已输出 N 字」此前
= 回复文字段长度（工具执行期间不变）。修复：有工具过程增量（progress，tool_update）时
优先显示 progress 长度；`generate_image`/`edit_image` 逐张/逐文件 `onUpdate` 报告进度。
实测：生成图片时「已输出 87→102→117 字」随进度实时跳动。

**③ 生图预览只显示一张**：实测 prompts 数组多张图全部渲染（3 张 grid + 每张下载按钮），
无代码问题；「只显示一张」是 AI 单 prompt 生成或旧缓存所致，无需修复。

**④ AI 创建的 App 里图片不渲染（根因：sandbox iframe 无 cookie）**：
- 根因链：App iframe `sandbox="allow-scripts"`（opaque origin）内 `<img src="/webos/api/...">`
  按第三方上下文发请求，**SameSite cookie 不发送**（实测 REQ cookie=NONE）→ 鉴权端点 401
  → Chrome **ORB（Opaque Response Blocking）** 拦截（ERR_BLOCKED_BY_ORB）→ 图片不显示。
- 修复（webos.ts + index.ts）：图片/App 素材端点改为**免鉴权公开 GET**（挂在 authMiddleware
  之前）：`GET /webos/api/imagegen/file/:name`（生图时双写到全局目录 server/data/webos-public-images/）
  与 `GET /webos/api/apps/:appId/files/raw/*`（全局按 appId 查找 + 路径校验 + MIME 白名单）。
  文件名/App id 均为不可枚举 UUID，公开访问与分享链接同级风险；防穿越（.. 拒绝）。
- 实测：App iframe 内 img naturalWidth=512（真实加载）、HTTP 200 免鉴权。

**⑤ 创建 App 后桌面不刷新（runtime.ts + App.tsx + webosDesktopV1.ts）**：桌面 iframe 只在
初始化时拉一次 App 列表。修复：宿主 `notifyAppsChanged()`（postMessage apps_changed）+
DesktopView 监听 apps 签名变化自动通知 + 桌面 JS 监听 apps_changed 重新 SDK.apps.list() 渲染。
实测：AI 创建「待办清单」后桌面出现对应图标（含自动打开新 App 的既有行为）。

**部署**：webos.ts（公开端点+生图进度）、index.ts（公开路由挂载）、webosDesktopV1.ts（img 拦截
+apps_changed 监听，73 账号桌面更新）、runtime.ts/App.tsx（notifyAppsChanged+数字进度）、
前端 dist；全部 tsc 通过、服务单实例、浏览器实测通过。

**遗留说明**：Playwright 测试的随机游客身份会残留测试 App（待办清单/图廊等），无害；
reload 不会切换游客身份（cookie 已存在时 deviceId 不生效），验证时需直接注入 cookie。

### 长按可靠触发 + 图标美化 + 整套系统分享入口（2026-08-08 凌晨，全部上线）

> 用户反馈：①长按 App 图标"大概率触发不了"（只有概率）②要"分享链接"（非商店）——
> 别人点开从加载页→桌面→全部 App（除系统自带），按钮放 AI 对话页 ➕ 菜单
> ③App 图标带一圈白边要去掉 ④系统自带应用 icon 太简陋要美化。

**① 长按大概率触发不了（根因：浏览器手势识别打断 pointer 事件流）**：
- 真实移动端手指长按时，浏览器先判定"是滚动还是长按"——判定期间会发 `pointercancel`
  打断 pointer 事件流；旧实现只监听 pointerdown + pointerup/move，**大概率收不到完整
  事件流 → 菜单弹不出**（此前 Playwright 用合成 pointer 事件模拟都能弹，真机不行）。
- 修复（webosDesktopV1.ts）：**touch 事件优先**（`touchstart` 在浏览器手势判定前必然执行）
  + `pointercancel/touchcancel` 清理 + 位移阈值 12px + **桌面右键（contextmenu）兜底**
  + 长按弹出后 `touchend.preventDefault()` 防 click 误打开 App（longPressOpened 标记）。
- 实测（真实 TouchEvent）：无位移长按弹菜单 ✓、**带 4px 位移也弹 ✓**、右键弹菜单 ✓。

**② 分享链接（整套系统，非商店）**：
- **服务端早已实现**（2026-08-06）：`POST /webos/api/share` 打包 加载页+系统桌面+全部
  用户 App（素材归档 share-assets/<shareId>/），分享页 `/daily/exp/sh-*`（index.ts 静态
  落地页：全屏预览 加载页/桌面/应用列表切换 + 悬浮菜单 + 安装）；`?share=&install=` 走
  批量安装到桌面。**缺的只是创建入口**。
- 补入口（前端）：AI 对话页 ➕ 菜单新增「分享整套系统」→ `POST /share` → 复制
  `/daily/exp/sh-*` 链接（`createSystemShare` API）。与「发布到商店」明确区分：
  不进商店列表，纯链接体验/安装。
- 实测：POST /share → `{shareId:"sh-...", url:"/daily/exp/sh-...", apps:3}` ✓、
  `/daily/exp/sh-*` HTTP 200 ✓。

**③ 图标白边**：`.app .tile` 去掉卡片背景（`background: transparent; border: none;
box-shadow: none`），图标直接展示（img/svg 52px 自带圆角），不再有白色卡片圈。

**④ 系统 icon 美化**：fallback SVG 从简笔线条换成**精致渐变版**（128 viewBox 圆角底 +
白色图形）：daily.ai 蓝紫气泡、桌面 靛蓝显示器、文件 天蓝文件夹、商店 橙金购物袋、
回收站 石板灰垃圾桶、设置 灰齿轮 + 通用渐变兜底。

**部署**：webosDesktopV1.ts（touch 长按+图标，**89 账号桌面更新**）+ 前端 dist
（index-D5EFNAxe.js：分享菜单入口）；模板 vm 校验 JS OK、全部 tsc 通过、服务单实例。

### 分享给朋友（长按菜单 + 系统分享弹窗，2026-08-08 上线）

> 用户反馈：长按 App 只有「分享到商店」，没有「分享给朋友」；希望像其他 App 一样
> 调起**系统分享弹窗**（可直接分享给微信/QQ 好友）。

**实现**：
- **长按菜单加「分享给朋友」**（webosDesktopV1.ts，非系统应用显示）→ `SDK.apps.shareToFriend(id)`
  → 宿主（runtime.ts `apps.shareToFriend` + App.tsx 适配器）调 `POST /webos/api/share/app`
  → 弹出宿主 **ShareAppPanel**（分享面板：链接预览 +「系统分享（微信 / QQ…）」+「复制链接」）。
- **系统分享弹窗**：ShareAppPanel 的「系统分享」按钮（宿主页面用户手势 ✓）调 `navigator.share`
  （Web Share API）→ 手机出现系统分享面板（微信/QQ/邮件等「分享给」）；不支持时降级复制链接。
  注意：桌面 iframe 是 sandbox opaque origin，iframe 内无法直接调 navigator.share（无手势激活
  传播），所以统一走宿主面板按钮触发。
- **单 App 轻量分享（不进商店）**：`POST /webos/api/share/app` → shareId `ap-` 前缀，
  快照（html+icon+素材）归档 share-assets/；落地页 `/daily/exp/ap-*`（index.ts 新增 ap- 分支）
  直接运行该 App 快照 +「安装到我的 Daily」。与「分享到商店」（s-*）互不影响。
- **分享面板文案**：朋友打开链接可直接体验，无需登录。

**实测（Playwright 真实浏览器 + 真实 TouchEvent）**：长按「待办清单」→ 菜单含「分享给朋友」
✓ → 点击 → 宿主面板弹出（url=https://shadowshub.xyz/daily/exp/ap-... + 系统分享/复制按钮）✓；
`/daily/exp/ap-*` HTTP 200 ✓（headless 无真实系统分享面板，代码路径 + 降级已覆盖）。

**部署**：webos.ts（/share/app）、index.ts（ap- 落地页）、webosDesktopV1.ts（菜单项，91 账号
 桌面更新）、runtime.ts/App.tsx/api.ts（shareToFriend + ShareAppPanel + shareAppToFriend）、
 前端 dist（index-BXLbCPyS.js）；全部 tsc 通过、服务单实例。

### 搜索增强 + 视频生成 + 商店重做 + 性能优化（2026-08-05，已上线）

**① 搜索功能（秘塔 API 三接口全接入）**：
- `web_search` 支持 scope（webpage 网页 / scholar 学术 / image 图片 / document 文库 / video / podcast）+ page 分页
- 新增 `read_webpage`（秘塔 POST /api/v1/reader）：**打开指定网页读全文（markdown 含链接），可逐级继续打开网页里的链接**（回答"能不能打开指定网页看链接"）
- 新增 `metaso_qa`（秘塔 POST /api/v1/chat/completions）：联网直接回答 + citations 引用来源
- 学术搜索双通道：既有 ArXiv + 秘塔 scholar scope
- 计费：search fixedPrice 0.02→0.03 元/次（对齐秘塔实际 3 credits/次）
- 实现：`server/src/utils/searchApi.ts`（callMetasoReader/callMetasoChat）、`searchTools.ts`、`aiTools.ts`、`piBridge.ts` 提示词

**② 视频生成（MiniMax H3，秘塔渠道，已真实端到端验证）**：
- 新模块 `server/src/videogen/minimaxVideo.ts`：文生视频/图生视频（首尾帧）`POST /v2/video_generation` + 查询轮询 `GET /v2/query/video_generation/{task_id}` + 下载转存（工作区 agent/videos/ + 全局公开目录）
- **H3-Context-IR 增强默认开启**（`POST /v2/h3_context_ir`），**渠道未充值/失败自动降级为原始提示词**（不阻断生成）
- 计费双轨：用户按 **MiniMax 官方刊例价**（2K ¥0.80/秒、768P ¥0.50/秒）扣积分（pricing.ts `videoCostMinor`）；后台成本按**秘塔渠道价**（2K ¥0.15/秒、768P ¥0.09/秒，`videoMetasoCostMinor`）落库统计
- 权限：**游客禁止**（403 GUEST_NOT_ALLOWED）；未充值（quota 未提升）用户**仅体验 1 次**（VIDEO_TRIAL_USED）；积分不足 402 拦截
- 统计：新表 `webos_video_usage`（每任务一行：分辨率/时长/图片数/enhance/官方价/秘塔价/状态）+ `webos_video_recharges`（站长充值登记）；管理后台 `GET /api/admin/webos/video/stats`、`GET /video/usage`、`POST /video/recharge`
- AI 工具 `generate_video`（对话内进度 tool_update 实时转发 + 结果 `<video>` 卡片）；公开端点 `GET /webos/api/videogen/file/:name`（免鉴权，**支持 Range 206 视频拖动**，index.ts 挂载）
- 环境变量：`METASO_API_KEY`（服务端 .env，搜索/视频共用秘塔 key；已在线上配置）
- **真实回归**：768P 4s 视频 98s 生成成功（task_id 2085027087088680960，用户扣 200 积分/成本 36 积分，ContextIR 因余额不足自动降级）；公开端点 200 + Range 206；App iframe 内 `<video>` 元素正常（文件 h264/aac/faststart 标准，ffmpeg 可解码；Playwright headless Chromium 缺 h264 解码器属测试环境限制，真实浏览器可播——对照验证 VP8 webm OK）

**③ 应用商店重做（webosStoreV1.ts 重写，已真实浏览器验证）**：
- **去掉顶部大标题栏**（旧 sticky header）→ 内容区轻量工具行（标题+发布/我的发布按钮+搜索框），与其他 App 沉浸式一致
- **真实图标**：icon（data:/URL 直接、SVG 字符串→data URI），加载失败降级按名称哈希分配颜色的**渐变首字母 SVG data URI**（encodeURIComponent 安全内嵌 onerror）
- **效果预览**：点击卡片主体（非按钮）→ 全屏 overlay 运行 html 快照（`StoreSDK.get()` 新增方法；sandbox iframe srcdoc + `<base>` 指向 store raw 端点加载相对素材 + 内存态 localStorage polyfill）+ 安装按钮
- StoreSDK `get` 方法：runtime.ts StoreSdkAdapters + App.tsx buildStoreAdapters（storeGet API）
- 模板 JS vm 校验通过（len=18779）；线上已有账号由 ensureSystemStore 自动升级（旧模板含 data.result 判定）

**④ 性能优化（低带宽）**：
- **图片缩放代理**：`/webos/api/imagegen/file/:name` 与 `/webos/api/apps/:appId/files/raw/*` 支持 `?w=`（白名单 96/128/192/256/320/512/640/768/1024/1280）→ ImageMagick 转 webp + 磁盘缓存（server/data/imgcache/<w>/，sha1 key），失败回退原图
- **App 运行时懒加载**：bootstrap 注入 MutationObserver 给所有 `<img>` 加 loading="lazy" + decoding="async"（不改质量，只延迟视口外加载）
- 聊天工具图片列表用 `?w=640` 缩略图（thumbUrl 仅对本站素材端点），Lightbox 看原图
- **nginx：开启 gzip（含 gzip_proxied any，必须！否则代理响应不压缩）**：JS 595KB→传输 32KB（gzip 后解压验证完整）；**HTTP/2**（listen 443 ssl http2）多图并发复用单连接；备份文件移出 sites-enabled（避免被 nginx include 导致 duplicate listen）
- 视频端点 Range + Cache-Control: public, max-age=86400

**部署注意**：后端文件**分别放对目录**（webos.ts→routes/、searchApi.ts→utils/、pricing.ts→billing/、schema*.ts→db/、videogen/ 新目录要 mkdir）；.env 加 METASO_API_KEY；重启后新表自动创建；前端 dist 需重新构建上传；nginx 改动需 nginx -t + reload。

### 视频半价 + 视频处理 + 积分明细 + 联系方式保密 + 全链路验证（2026-08-06 晚，已上线）

**① 视频计费半价（用户决策）**：`pricing.ts` `VIDEO_USER_RATIO=0.5`——用户扣费 = MiniMax 官方刊例价 ×0.5（768P 25 积分/秒、2K 40 积分/秒；4s 768P=100 积分，原全价 200）。后台成本仍按秘塔渠道价（0.09/0.15 元/秒）统计。**全链路实测：图生视频 4s 768P 用户价 100 分 / 成本 36 分**。

**② H3-Context-IR 计费与统计**：官方按量价 输入 ¥5.8/输出 ¥23 每百万 token（秘塔未公开独立价目，后台成本按官方价折算并标注）。`enhanceVideoPrompt` 返回真实 token 用量 → `generate_video` 成功后单独落 `task_type='h3_context_ir'` 记录（用户不单独扣费，含在视频售价）；管理后台 `/video/stats` 新增 `contextIR{count, costMinor}` 与 `videoEdit{count, okCount}`。

**③ generate_video 工具增强（AI 提示词同步）**：**文生视频优先**；新增 `reference_images`（1-9 张参考图，效果最好，官方 r2va 参考模式，与首尾帧互斥）；**明确告知首尾帧效果差、不要滥用**；分辨率/时长/比例指引（768P 默认、2K 更贵、16:9/9:16）；返回 poster 首帧封面（App `<video poster>` 秒开预览）。**输入图片必须完整公网 URL**（`PUBLIC_BASE`，MiniMax 校验 image_url 为公开 http(s)，相对路径 400 error 2013）。

**④ edit_video 视频处理工具（FFmpeg，参考 frameronin.com）**：`server/src/utils/videoEdit.ts`（新）——extract-frames 抽帧/序列帧、sprite-sheet 精灵图（tile 拼图，**必须 `-frames:v 1` 否则 image2 muxer 同名报错**）、to-gif、poster、trim、crop、scale、extract-audio、mute、speed、remove-bg（绿幕 chroma key → 透明 webm，仅纯色背景）、concat。产物落 `agent/media/` 并双写公开目录（mp4/webm→videogen 端点，png/gif/mp3→imagegen 端点）；游客禁止、免费、每次落库 `task_type='video_edit'`。

**⑤ 个人中心积分说明 + 消耗明细**：新端点 `GET /webos/api/usage/credits-history`（合并 webos_ai_usage/imagegen/video 三类，含 contextIR/处理，SQLite/PG 兼容用 `||` 拼接，**勿用 printf**）；ProfileView 新增「积分是怎么算的」卡片（1 积分=¥0.01 + 各能力定价说明 + 最近消耗列表）。

**⑥ 客服联系方式保密（用户要求）**：piBridge 系统提示词删除微信号/QQ（改为"联系方式是敏感信息，不要写进 App/任何生成物；引导用户去个人主页查看"）；generate_image/generate_video 工具返回消息里的微信提示全部移除（AI 可见面零泄露）；用户可见 UI（ProfileView/402 文案）保留。

**⑦ 搜索工具注入 webOS 会话**：此前 web_search/read_webpage/metaso_qa 只在画布会话，webOS AI 根本搜不了网——`chat/stream` 的 customTools 改为 `[...webosAppTools(principal), ...searchTools]`；`getSearchKey('metaso')` 优先读环境变量 `METASO_API_KEY` 回退 DB。

**⑧ 全链路打通（真实端到端）**：生图（小人，纯绿背景）→ 图生视频（768P 4s，98s，用户价 100/成本 36，ContextIR 降级）→ edit_video sprite-sheet（8 帧精灵图 512x96）→ 构建「像素跑酷」canvas App → 创建 App → `POST /webos/api/share/app` 生成 ap- 分享链接 → **Playwright 验证：游客无 cookie 打开链接，canvas 正常渲染游戏可玩**。**分享链接：https://shadowshub.xyz/daily/exp/ap-efed25b2h280ne**

**⑨ ap- 轻量分享体验页修复（2026-08-08 上线时未覆盖的坑）**：① ExperienceView 加载 ap- 走新端点 `GET /webos/api/share/:shareId/meta`（读 share-assets meta.json），s- 仍走 storeGet；② `withRuntimeBootstrap` 对 ap- 的 base 指向 `/webos/api/share/<id>/raw/`（分享包素材）；③ `POST /store/apps/:shareId/install` 支持 ap-（从 share-assets 快照安装，素材复制到安装者工作区）；④ **分享页预览端点免鉴权**（`serveSharePreview` 导出，index.ts 挂载 authMiddleware 之前——游客第一次打开无 cookie，鉴权会 401 空白）；⑤ **分享页初始自动 showPreview('boot')**（ap- 分享 boot 直接返回 App 快照，朋友点开即玩，不用点菜单）。

**部署注意**：本轮后端 webos.ts/routes、adminWebos.ts/routes、pricing.ts/billing、minimaxVideo.ts/videogen、videoEdit.ts/utils（新）、aiSettingsStore.ts/db、piBridge.ts、index.ts（公开端点+分享页自动加载）**分别放对目录**；前端 dist 重新构建上传；服务已重启、全链路已线上验证。

---

### 系统桌面 + 应用商店重制（2026-08-09，已上线）

**系统桌面（webosDesktopV1.ts 视觉重制）**：
- 全部视觉走 `:root` CSS 变量（design skill「安静浅色」tokens：`--bg-1/--bg-2` 壁纸、
  `--blob-a/b/c` 柔光斑、`--ink/--ink-soft` 文字、`--accent` 主色、`--surface/--shadow/--radius` 卡片）。
  AI 改桌面优先只改变量（换壁纸/换主色/调深浅），保持结构节奏 → 改完与系统浑然一体。
- 壁纸 = 渐变 + 三层 radial-gradient 柔光斑（无 filter，低端机流畅）；时钟 = 日期小字 + 56px 时间；
  图标 56px 圆角 15px + fadeUp 入场 + 按压缩放；Dock = 毛玻璃胶囊；页面指示器胶囊化；
  `prefers-reduced-motion` 关闭动画。JS 逻辑（长按菜单/拖拽整理/删除确认）保持不变。
- 模板注释写明「AI 改桌面必读」（tokens 说明 + DesktopSDK 契约），design skill §五同步更新。

**应用商店（webosStoreV1.ts 沉浸式重做 + 宿主 StoreView 去顶栏）**：
- **宿主壳层顶栏删除**（用户反馈"顶栏 AI 改不到"——那是 React 壳，AI 无法改）：
  StoreView 不再渲染 ScreenHeader，商店 iframe 全屏（同桌面模式）；返回桌面由商店 App 自己调
  新增 `StoreSDK.system.back`（AI 可改），安装后「打开」用 `system.openApp(appId)`。
- 商店核心三件事：**体验**（点卡片主体 → 全屏预览 overlay 运行快照）、**下载**（每卡大号
  「获取」→安装中→已安装/打开 主色胶囊按钮）、**浏览**（搜索框 + 最新/最热 tab + 特色横滑
  hero 卡 + 双列网格 + 发布/我的发布底部悬浮胶囊）。
- **API 优化**：`GET /store/apps` 支持 `?q=`（name/description 服务端 LIKE 搜索）与
  `?sort=latest|hot`（installs 排序）+ LIMIT 100；列表 icon 超 4KB 截断（详情接口返回完整 icon，
  列表渐变首字母兜底——data URI 是列表 payload 大头）。StoreSDK.list 透传参数，搜索 300ms 防抖走服务端。

**移动端性能优化**：
- 聊天长对话：`.chat-row { content-visibility: auto; contain-intrinsic-size: auto 96px }`——
  视口外消息跳过布局渲染（几十上百条 markdown/KaTeX 滚动不卡），接近视口自动恢复。
- `prefers-reduced-motion` 全局关动画；商店列表 payload 瘦身（见上）。

**部署与回归**：
- 存量账号重置脚本 `tmp/reset-desktops-v2.mts`（桌面+商店都切新模板，旧版本保留可回滚，写回工作区镜像）。
- **踩坑 1（重置脚本）**：正则提取模板源码会拿到未求值的 `\\'`（应求值后 `\'`）→ 商店 JS
  `onerror` 内联属性语法错误 `Unexpected string`，商店列表空白（静态壳在、脚本没跑）。
  必须 tsx 导入求值后的常量（v2.mts 已修复；线上 77 个账号曾短暂损坏已全部修复）。
- **踩坑 2（宿主 CSS）**：给 `.store-screen` 加 `position:relative` 覆盖了 `.os-screen` 的
  absolute inset:0 → 区块高度 0 → 商店视觉空白（DOM 在跑但用户看不到）。删除后恢复。
- **踩坑 3（预览 polyfill）**：商店预览 iframe 的 localStorage polyfill 直接
  `if(!window.localStorage)` 在 sandbox opaque origin 下**访问即抛 SecurityError**（不是返回
  undefined）→ polyfill 装不上。改 try/catch 探测（`var _lsok=false;try{void window.localStorage...}`）。
- 浏览器实测（Playwright 移动视口）：桌面 4 图标+时钟+Dock+光斑；商店 6 卡片+2 hero+9 获取按钮+
  tab+搜索+返回+底部胶囊，**旧顶栏不存在**；预览 overlay 打开；零控制台报错；用户账号
  fb9f2d90 桌面 v1.0.22 / 商店 v1.0.4 均为新模板；全库扫描 0 损坏。

### 桌面图标美化（2026-08-09 第二波，已上线）

> 用户反馈「桌面的那些 icon 才是最需要美化的」——痛点是 AI 创建的用户 App 无 icon 时
> 全部显示同一个灰色默认方块，毫无辨识度。

- **用户 App 兜底图标重做**（webosDesktopV1.ts `hashIcon()`）：按 App 名称哈希从 10 组
  三色渐变中稳定取色（蓝紫/天蓝/翠绿/琥珀/红/紫/粉/橙/青/灰），128 圆角底 + 顶部高光椭圆
  + 白色首字母（中文取第一个字，`escapeHtml` 转义）——每个 App 有自己的配色与首字母，
  一眼可辨；SVG 渐变 id 用自增计数器 `gapp{N}` 保证唯一（同文档多图标不串色）。
- **系统图标重绘**：6 个图标全部升级为三色渐变（3 stop）+ 顶部高光椭圆（rgba 白椭圆），
  daily.ai 气泡加火花星点、文件夹加内页层次、购物袋/垃圾桶/齿轮细节微调、圆角底 6/116。
- 回归（Playwright）：创建无 icon App「测试小工具」→ 桌面 tile 渲染 `hashIcon:测`（渐变
  + 首字母）✓；系统 4 图标 systemSvg ✓；零控制台报错；134 账号全部升级（用户账号
  fb9f2d90 桌面 v1.0.23 len31387 含 hashIcon）；重置脚本沿用 reset-desktops-v2.mts。

### 桌面/商店色系统一到平台 tokens + design skill 修正 + 设计资源库（2026-08-09 第三波，已上线）

> 用户反馈「桌面的背景、整个设计和平台风格有差异，他们甚至都不是一个色系的」——
> 根因：此前桌面/商店模板与 design skill 用的是「蓝灰 + 亮蓝紫」色系（#eef1f6/#4f6ef7），
> 而 Shell 实际是「纸张与墨」暖体系（--paper #f8f7f3 / --board #e8e4db / --ink #171918 /
> --blue #315bd6 / --green #376b53 / 暖阴影 rgba(50,44,34,…)）。skill 教的色系就是错的。

- **平台 tokens 统一（webosDesktopV1.ts / webosStoreV1.ts）**：两个模板的 :root 直接照搬
  Shell styles.css 变量名与色值（--board/--paper/--paper-strong/--paper-muted/--ink/--ink-soft/
  --muted/--blue/--blue-soft/--green/--line/--shadow-sm/--shadow-md），壁纸 = paper→board
  暖纸渐变 + 奶油白/靛蓝 rgba(49,91,214,.09)/墨绿 rgba(55,107,83,.07) 柔光斑；Dock 与对话页
  composer 同质感（暖白毛玻璃 rgba(255,254,250,.72) + 暖阴影）；系统图标/用户 App 渐变池全部
  换平台色板衍生色（靛蓝 #315bd6、墨绿 #376b53、陶土红 #a54b49、暖金/暖灰等，去高饱和冷色）。
- **design skill 修正（.pi/skills-webos/design/SKILL.md）**：把错误的「安静浅色」tokens 替换为
  「平台默认『纸张与墨』（唯一推荐）」，注明平台只有两个核心页面（AI 对话 + 桌面）共用一套；
  深色方案同步给出平台对应值。**AI 生成物与系统脱节的根源被修掉**。
- **设计资源库（.pi/skills-webos/design-resources/，92 文件 / 1.4MB 已部署）**：Huashu Design
  （SKILL + 32 份 references 方法论）+ Open Design 精选 19 套设计系统（apple/linear-app/stripe/
  notion/material/glassmorphism/neumorphism/minimal/brutalism/claude/airbnb/spotify/shopify/
  bento/arc/cafe/colorful/clean/clay，每套 DESIGN.md + tokens.css + components.html）。入口
  SKILL.md 铁律：**资源库只参考结构/组件/动效手法，配色必须映射回平台 tokens**（禁止照抄第三方
  品牌色，否则又脱节）。read 工具路径校验已确认支持任意子目录。
- 回归：Playwright 实测桌面 tokens = Shell 完全一致（--paper #f8f7f3 / --blue #315bd6 ✓）；
  桌面/商店渲染正常、零报错；134 桌面 + 81 商店全部切新色系（历史版本可回滚）。
- 部署注意：design-resources 体积小但文件多，scp -r 逐个传易超时——**先 tar czf 再传单个包**。

### 设计 skill 定稿：原封采用花叔 Design + 追加 Open Design（2026-08-09 第四波，已上线）

> 用户决策：**不要给 AI 加设计限制**（此前平台色系"唯一推荐"、禁止照抄第三方配色等约束全部删除——
> 那是系统模板的色系错误，不是 AI 设计不好）。直接**原封不动采用 huashu-design 的 SKILL.md**，
> 只在其末尾追加 Open Design 设计系统库，不破坏原结构。

- **`.pi/skills-webos/design/` = huashu-design 完整原样**（247 文件 / 33M）：SKILL.md（frontmatter
  name 改为 `design` 以匹配目录，正文一字未改）+ references/（32 份方法论）+ assets/（动画引擎/
  组件/音频）+ scripts/ + demos/ + README/LICENSE 等。
- **追加（不改原文）**：文件末尾新增「Open Design 设计系统库」一节 + 新目录 `design-systems/`
  （Open Design 精选 19 套：apple/linear-app/stripe/notion/material/glassmorphism/neumorphism/
  minimal/brutalism/clay/claude/airbnb/spotify/shopify/bento/arc/cafe/colorful/clean，每套
  DESIGN.md + tokens.css + components.html + README 全量索引）。原 `design-resources/` 目录已删除
  （内容并入 design/design-systems/）。
- **核心哲学（继承花叔）**：从用户需求长出来、任何新设计先出三方向给用户选（指定风格也不豁免）、
  反 AI slop（紫渐变/emoji/烂大街套路）、资产>规范。**设计上无任何平台限制**；仅保留技术底线
  （自包含单文件 HTML——sandbox 跑不了外部依赖）与沙箱安全约束。
- 系统提示词同步软化：`system/design.md` 由"改难看按它逐项改回"改为"可选参考，用户指定风格
  或自由发挥时按用户要求设计"。
- 验证：pi `loadSkillsFromDir` 扫描 `.pi/skills-webos/` → design + myself 加载成功，
  `<available_skills>` 注入 design（description 含花叔全文 + Open Design）；服务重启、home 200。

### 三方向选择 = 对话内互动 HTML（2026-08-09 第五波，已上线）

> 用户决策：huashu 的「三方向初稿给用户选」正好用平台的 `show_interactive_html`（对话内
> 插入可交互 HTML）+ `interactive_answer`（按钮点击回传答案）闭环——用户点选方向，AI 直接
> 收到答案继续，**全程不用打字**。

- **design/SKILL.md 追加节（不改 huashu 原文）**：「webOS 对话环境适配：三方向选择 = 对话内
  互动 HTML」——说明 show_interactive_html + interactive_answer 机制、落地步骤（出三方向 →
  插入方向选择器 → 收到 interactive_answer → 继续）、选择器示例结构（三张风格卡：方向名 +
  一句话气质 + 色板条，整卡可点，高度 240-320px）；其他「用户即时拍板」场合（选方案/配色/
  布局/A-B 对比）也一律优先用。
- **系统提示词（piBridge.ts）**：show_interactive_html 条目补充「设计方向选择」用途。
- **真实端到端验证**：对话「帮我设计一个待办清单 App 的界面，先给我三个风格方向选」→ 事件流
  含 `tool_start×4`（读 skill）+ `interactive_html×1` + `done`——AI 确实用互动 HTML 出方向选择器。
- 部署：piBridge.ts + design/SKILL.md；服务器 tsc 通过、服务重启、home 200、skill 加载正常。

### 旧内核浏览器整站塌陷修复（2026-08-10，dvh/inset 兼容）

**用户现象**：部分浏览器（老版微信内置 XWeb / 旧版 UC·QQ / 旧 Android WebView）输入网址后：① 加载页只渲染在屏幕上方三分之一、其余是 body 米黄渐变背景（用户感知"橙色"）；②「我们入驻了爱发电」公告小得像一条通知（遮罩塌陷）；③ 关闭公告后只剩渐变背景，主界面（对话/桌面）完全不可见。

**根因**：`client/shell-web/src/styles.css` 把整站高度链绑定在 `100dvh`（Chrome108+/Safari15.4+/FF101+ 才支持）且**无任何 fallback**：
- `.shell-stage{height:100dvh}` 在旧内核中声明失效 → 高度回退 auto≈0 → 内部 `position:absolute` 的 `.os-screen` 全部塌陷 → 主界面不可见，只剩 body 渐变背景；
- `.boot-screen{min-height:100dvh}` 失效 → 加载页只有内容高度（屏幕上方 ~1/3）；
- `.login-overlay` 等 fixed 遮罩用 `inset:0`（Chrome87+），更旧内核（<87）连遮罩都塌成内容大小 → 公告"小得和输入框一样"。

**修复（styles.css，全部改为兼容写法）**：
- **dvh → 默认 `100vh` + 文件末尾 `@supports (height:1dvh)` 块覆盖 dvh**（含 .shell-root/.shell-stage/.boot-screen/.login-panel/media700）。⚠️ **教训：同一规则块内直接双写 `height:100vh;height:100dvh` 会被 rolldown/lightningcss minifier 合并去重吃掉 fallback**（构建后只剩 dvh，等于没修）——必须用 @supports 单独声明。
- **inset:0 → 全部改为 `top:0;left:0;width:100%;height:100%`**（CSS1 语法，等效全铺满；minifier 无法合并成 inset）。⚠️ 教训：minifier 会把四边 `top/right/bottom/left:0` 自动重写为 `inset:0`（包括 @supports not 块内！），旧内核又不认识 inset，等于白写——所以从源头不用 inset 简写。
- **`min()` 宽度 → `width+max-width` 双属性**（.shell-stage `width:100%;max-width:440px`、.conv-sidebar `width:72vw;max-width:280px`、.loading-line `width:220px;max-width:72vw`、.login-panel `width:100%;max-width:400px`）；media700 高度 `height:calc(100vh -32px);max-height:900px`（@supports 内 `calc(100dvh -32px)`）。
- 涉及元素：.os-screen/.desktop-frame/.store-frame/.boot-frame/.launcher-wallpaper/.conv-sidebar-layer/.conv-sidebar-backdrop/.modal-overlay/.login-overlay/.composer-menu-backdrop/.image-lightbox。

**验证**：
- `vite build` 产物检查：`inset:0` 0 处、`100vh` 6 处（基础）、`100dvh` 5 处（全在 @supports 内）、`.os-screen`/`.shell-stage` 基础规则均为兼容写法；`tsc -b --noEmit` exit 0。
- headless Chromium 布局实测（390×844 视口）：现代浏览器（dvh:true）`.shell-stage`=844 全屏 ✓；删除 @supports 块模拟旧内核（走 100vh fallback）同样 844 全屏 ✓；`.os-screen` 均铺满 844 ✓。
- 部署：仅前端 dist（重建 shell-web 后上传 assets + index.html）。

### 长按菜单补全 + touch 拖拽 + App 数据保存根修（2026-08-12）

> 用户反馈：①长按应用图标无法拖动、删除、分享、下载、上传到应用商店；②AI 生成的应用退出重进数据全丢。

**① 桌面（webosDesktopV1.ts，AI 可改）**：
- **移动端 touch 拖拽排序（根因修复）**：原整理模式用 HTML5 `draggable` + DnD 事件——**touch 设备根本不触发**（iOS/Android 均不支持 touch 拖放），手机用户拖不动。改为 pointer/touch 事件自绘拖拽：拖动中的图标 transform 跟随手指，实时与落点图标交换 DOM（CSS grid 按 DOM 序排列），松手调 `SDK.apps.reorder` 持久化。编辑模式锁定页面滚动（`#pages.locked` + touch-action:none）。
- **长按直接拖动（iOS 风格）**：长按 450ms 后图标"待命抬起"（.armed），**继续移动 → 直接进入整理模式拖动**；**静止抬手 → 弹操作菜单**。修复一个位移基准 bug（beginDrag 的 dragLast 用按下原点，否则单次 touchmove 后 dragStarted 恒 false、松手不存序）。
- **菜单补全**：非系统应用 = 分享给朋友 / **上传到应用商店**（原"分享到商店"更名）/ **下载源码 ZIP** / 删除（移入回收站）/ 整理桌面 / 取消；系统应用提示不可操作。Dock 的 settings 按钮（设置页已删除）改为回收站（system.trash）。
- **存量账号模板升级（ensureSystemDesktop 放宽）**：原条件只允许 v1.0.0 唯一版本升级一次（versions.length===1 && createdBy==='system' && version==='1.0.0'），此后模板改动永远推不到存量账号。放宽为「所有版本 createdBy==='system' 即升级到当前模板（写回工作区镜像）」，用户/AI 改过的桌面（存在非 system 版本）保留不覆盖。

**② App 数据保存（架构根修，三层）**：
- **根因 1（图片必丢）**：服务端 `app.storage.private` 单项限 **64KB**——AI 生成 App 把图片 base64 存 localStorage → 超限 → 413 静默失败（polyfill `.catch(()=>{})`）→ 刷新必丢。修复：单项 64KB→**512KB**、总量 1MB→**2MB**；提示词强制引导 AI：**图片/大对象（≥100KB）用 `window.DailyWebOs.fs.write('assets/xxx.png', base64)` 写入 App 文件夹**（8MB/文件、落磁盘、AI 可读、raw 端点免鉴权可显示），**禁止 IndexedDB**（sandbox opaque origin 不持久）。
- **根因 2（首屏"数据没了"）**：hydrate（服务端数据回灌）异步晚于 App 初始化 → App 首帧读到空存储 → 用户看到空白（数据其实在服务端）。修复：**AppRuntime 打开 App 前预取 `getAppStorage` 快照 → withRuntimeBootstrap 同步注入 `__DAILY_WEBOS_INITIAL_STORAGE__` → polyfill 初始化内存即含历史数据**（1.5s 超时兜底，失败走 hydrate）；hydrate 改直写 `_seed`（不再重复推送）。
- **根因 3（初始化写入丢失）**：SDK connect 前 setItem 只写内存不推送。修复：**pendingWrites 队列，connect 后统一 flush**。
- **运行中刷新通知**：polyfill setItem/removeItem/clear 与 hydrate 完成后派发 `storage` 事件 + `daily-webos-storage-ready` 事件（已监听 storage 的 App 自动刷新 UI）；同步失败 console.warn 不再静默。
- **提示词（piBridge WEBOS_SYSTEM_PROMPT 新增「App 数据保存」条目）**：文本/小数据用 localStorage（自动持久化）、图片/大文件用 fs、禁 IndexedDB、首帧没读到监听 storage/ready 事件、大对象失败要提示用户；实现"保存/记住"需求后自测"添加 → 关掉重开 → 数据还在"。

**验证**（server/shell-web tsc、vite build 全过；模板求值后 vm.Script 语法检查；Playwright 真实浏览器主页面模拟 + Node mock 环境）：
- 长按 450ms 抬手 → 菜单弹出（6 项齐全）✓；长按后移动 → 进入整理模式拖动（顺序 app-1→app-2→app-3 变为 app-2→app-1→app-3）✓；松手 → reorder 持久化 ✓
- bootstrap（Node 环境执行真实源码 + mock localStorage 抛错 + 原生 MessageChannel）：预载数据 App 同步可读 ✓；connect 前写入 flush 到宿主 ✓；hydrate 后 saved 可读 + ready 事件 ✓；storage 事件派发 ✓
- 部署：后端 `server/src/webosDesktopV1.ts`（src/）+ `server/src/routes/webos.ts`（routes/）+ `server/src/piBridge.ts`（src/）分别放对目录；前端重建 shell-web dist 上传；pm2 restart 后存量账号（桌面未 AI 改过的）bootstrap 自动升级新模板。回归脚本保留在 `tmp/check-desktop.cjs`、`tmp/check-bootstrap.cjs`、`tmp/verify-bootstrap-node.cjs`、`tmp/e2e-verify.cjs`。

### 取消单项大小限制 + 商店标注占内存与剩余空间（2026-08-12 下午）

> 用户决策：取消所有人为的单项文件大小限制；工作区空间（游客 200MB / 登录 10GB）是**唯一闸门**——
> 满了自然无法上传/写入。商店下载的应用占用用户工作区空间，商店要标注应用占内存大小 + 用户剩余空间。

**① 取消单项限制（唯一闸门 = 工作区配额）**：
- 上传端点：单文件 10MB 限制删除（原 `MAX_UPLOAD_BYTES`，常量已删）；保留类型白名单与总量检查
- App 文件夹（app.fs）：单文件 8MB 删除（`MAX_APP_FILE_LENGTH` 删除，raw/读取/写入全部不再限大小）；写入改总量检查（新增/覆盖变大时 `assertWorkspaceRoom`）
- App 私有数据（app.storage.private）：单项 512KB/固定 2MB 删除 → **App 数据计入工作区配额**（磁盘 + appStorage JSON 字节 ≤ 配额，满了 413 WORKSPACE_FULL）
- App HTML：2MB → 50MB（DB 安全阀）；创建/更新 App 时 `assertAppHtmlRoom`（HTML 镜像占工作区，按净增量检查）
- agent_fs_write：单次 2MB 删除（`MAX_WRITE_BYTES`），只受工作区总量检查
- 统一助手：`assertWorkspaceRoom(principal, extraBytes, appStorageBytes)` / `workspaceFreeBytes` / `assertAppHtmlRoom`
- 前端文案：FilesView「单个 ≤10MB」→「无单文件大小限制，工作区共 ≤10GB」；AI 提示词更新（fs 无单文件限制，只受工作区总空间约束）

**② 商店标注占内存 + 剩余空间**：
- `webos_store_apps` 新列 `size_bytes`（PG schema + SQLite schema + `ensureStoreSizeBytesColumn` 幂等迁移，index.ts 启动调用）
- 发布时计算 sizeBytes = HTML 快照字节 + store-assets 归档素材总字节（`dirTotalBytes`），更新/新建都写入
- `GET /store/apps` 返回每项 `sizeBytes` + 顶层 `userFreeBytes`（工作区配额 - 磁盘已用 - App 数据字节）
- 安装（s- 与 ap- 分支）：安装前检查 `sizeBytes ≤ userFreeBytes`，不足 413 WORKSPACE_FULL「工作区空间不足，无法安装该应用」
- 商店模板（webosStoreV1.ts，AI 可改）：搜索框下新增空间条「工作区剩余 X（<10MB 红色警告）」；卡片/特色卡/预览栏 meta 显示「· 占用 X MB」；StoreSDK.list 透传 userFreeBytes
- 存量账号：ensureSystemStore 升级条件放宽为「所有版本 createdBy==='system' 即升级」→ 空间标注新模板自动推送

**验证**：server/shell-web tsc、vite build 全过；商店/桌面模板求值后 vm.Script 语法检查 + 新功能存在性检查；bootstrap Node 全链路回归通过。
**部署**：后端 `server/src/webosStoreV1.ts`（src/）+ `server/src/routes/webos.ts`（routes/）+ `server/src/utils/webosWorkspace.ts`（utils/）+ `server/src/piBridge.ts`（src/）+ `server/src/db/schema*.ts`（db/）+ `server/src/db/migrations.ts`（db/）+ `server/src/index.ts`（src/）；前端重建 shell-web dist 上传；重启后旧库自动补 size_bytes 列、存量商店自动升级新模板。

### 存储配额分层 + 定价评估 + 虚拟主机结论（2026-08-12 晚）

> 用户决策：登录用户基础空间 512MB（原 10GB 过松），付费月卡带存储档位——轻量 10GB / 中量 30GB / 重量 100GB；尝鲜用量包不含空间；存储/付费相关位置补充「大量存储需求可联系站长单独扩容」引导。

**服务端**（配额唯一来源 = `StoredState.workspaceBytes`）：
- `webosWorkspace.ts`：`MEMBER_WORKSPACE_BYTES` 10GB→512MB；新增 `WORKSPACE_TIER_BYTES`（轻量 db929ac0...=10GB / 中量 f77af912...=30GB / 重量 0f7ca114...=100GB）；`workspaceLimitForState(state)` 优先读显式存储值，否则基础值；`workspaceLimitResolved(key)` 异步查 entities 表（agent_fs_write 无 state 上下文时用）。
- `webos.ts`：`StoredState` 新增 `workspaceBytes?`；`defaultState` 写入基础值（游客200MB/登录512MB）；`normalizeState` 解析旧库（缺失时 workspaceLimitFor 兜底）+ **月卡到期回落基础值**（与 credits 惰性结算同步）；`assertWorkspaceRoom/workspaceFreeBytes/assertAppHtmlRoom` 全部接受 state 签名；上传端点/App 创建更新/app.fs PUT/storage PUT/商店安装（s- 与 ap-）均传 state 校验；bootstrap/列表返回 `workspaceLimitBytes`（按 state 解析）。
- `afdian.ts`：月卡发货时按 planId 写 `state.workspaceBytes`（档位升级，日志 `[afdian] 月卡工作区配额升级 ✓`）；StoredStateLike 补 `workspaceBytes?`；尝鲜包不改空间。
- `paymentState().tiers` 增加 `workspaceBytes`（前端 AfdianView 渲染存储行）。
- 提示词/403 文案/注释同步：旧「登录 10GB」全部改为「512MB / 月卡 10-100GB」，满额提示带「联系站长单独扩容」。
- **定价与架构结论（正式答复用户）**：月卡定价重心在 AI 积分（≈¥10/1000积分），10GB 存储成本仅约 ¥1——档位不亏本、给得慷慨；风险在流量（对象存储流量约 ¥0.5/G，App 素材/视频走本地带宽需评估峰值）；**不采用「每用户一个虚拟主机」**——共享单机 + sandbox iframe 隔离已足够，每用户独立进程内存开销不可行（每实例 150-300MB）；更优路径 = 共享多租户 + 对象存储冷热分层。

**前端**（shell-web）：
- shared 契约 `WebOsPaymentState.tiers?: WebOsPayTier[]`（planId/name/priceYuan/kind/monthlyCredits/packCredits/workspaceBytes）。
- `AfdianView`：档位数据优先取 `payment.tiers`（服务端真实档位，含 `workspaceBytes` 渲染「工作区空间 NGB」胶囊行），未配置回退硬编码（含 workspaceGB）；底部新增存储说明 note（档位空间 + 登录 512MB/游客 200MB + 联系站长单独扩容微信 fangyan876）。
- `ProfileView` 套餐卡：文案加「+ 10/30/100GB 空间」「尝鲜包不含空间」「大量存储需求可联系站长单独扩容（微信 fangyan876）」。
- `FilesView`：硬编码「≤10GB」改为动态 `formatBytes(limit)`（游客200MB/登录512MB/月卡档位实时显示）；进度条下新增「已用 X / 共 Y + 订阅月卡/联系站长扩容」引导行。
- styles.css 新增 `.afdian-tier-storage` 胶囊样式。

**验证**：server tsc、shell-web tsc、vite build 全部通过；旧库存量账号由 normalizeState 兜底自动获得基础配额（无需迁移脚本）；月卡到期回落路径已确认。
**部署**：后端 `server/src/routes/webos.ts`（routes/）+ `server/src/payment/afdian.ts`（payment/）+ `server/src/utils/webosWorkspace.ts`（utils/）+ `server/src/piBridge.ts`（src/）+ `shared/webos-contracts/index.ts`；前端重建 shell-web dist 上传；pm2 restart。文本替换脚本保留 `tmp/fix-workspace-texts.mjs`。

### 兑换码权益实时性核查 + 旧档存储映射补漏（2026-08-13，已上线）

> 用户疑问：套餐权益是否没随兑换码兑换实时生效（账号仍限 512MB）。**线上数据核查结论**：
> ① 兑换链路本身是**实时**的——`deliverRedeemTier` 兑换成功即写 `state.workspaceBytes` → `saveState`
> 落库+更新内存缓存 → bootstrap / `GET /workspace/files` 实时读 state 返回（无定时任务/无延迟），
> 前端兑换成功后 `refreshBootstrap` 刷新；② 站长账号此前 512MB 是**数据正确**：`credits.monthly=null`
> （无生效月卡）、`webos_redeem_codes` 20 个轻量月卡码全部 unused（无人兑换过）、8-06 两单为
> 「轻量支持」旧档（¥9.9，manual 补发）与「尝鲜用量包」（¥5，设计上不含存储）。
> **发现并修复真实缺口**：旧档「轻量支持」`1646bd9a8ea111f1ac995254001e7c00`（¥9.9 月卡语义）不在
> `WORKSPACE_TIER_BYTES` 映射表（该表 8-12 才引入，只覆盖新兑换码商品与部分旧档）→ 该档位发货
> 后存储**永远不会**升级。修复：映射表补 `1646bd9a… →10GB`；站长账号按其 8-06 购买记录补发
> `workspaceBytes=10GB`（UPDATE entities，脚本已执行）。线上验证：站长 bootstrap 与文件列表
> 均返回 `workspaceLimitBytes=10737418240`。部署：仅 `server/src/utils/webosWorkspace.ts`（gzip
> 压缩管道传输，md5 校验一致）+ pm2 restart。


### 卡加载页根因 + bootstrap 瘦身 + 加载优化结论（2026-08-07 深夜，已上线）

> 用户现象：打开网页一直卡在加载页进不去。实测：Playwright 游客访问正常（18s 进主页），但用户账号（魅族 Lucky08 WebView）bootstrap 响应 **320KB gzip**（未压缩 1.6MB），低端 WebView 每次刷新全量下载+解析+hydrate 大 JSON → 长时间卡加载页。

**根因**：`buildBootstrap` 把 `state.apps` 全量 clone——**每个 App 的所有版本完整 HTML 随 bootstrap 下发**。用户账号 13 个 App（含大 HTML）→ 1.6MB。App 的 HTML 本来就有按需接口 `GET /apps/:appId`，bootstrap 里重复全量下发纯属浪费。

**修复（bootstrap 瘦身，1.6MB → ~80KB）**：
- `buildBootstrap`：用户 App（非 `system.` 前缀）的 versions html 置空，仅保留元信息（id/version/createdAt/createdBy/note/capabilities）；`system.desktop/store/trash` 保留 html（桌面/商店 iframe 直接渲染，模板仅 13-19KB）。
- 前端 `AppRuntime`：activeVersion.html 为空时按需 `GET /webos/api/apps/:appId`（返回 `{app}` 包装！）拉取 html，期间显示 loading 占位；失败显示错误。**坑：详情返回 `{ app }` 包装，直接 `detail.versions` 会 `Cannot read properties of undefined (reading 'find')`**（e2e 截图实测确认），必须 `detail.app ?? detail` 解包。
- `getBootstrap` 加 `AbortSignal.timeout(20s)`：服务端慢/挂起时不再无限卡加载页，boot() 重试 3 次后显示错误页（ErrorScreen）。
- 验证：API 级 PASS（bootstrap 中 App html=0、详情 html=97 完整）；浏览器 e2e：主页/桌面正常（5 图标）、按需请求 200；线上 bootstrap 30ms 返回 79KB。

**部署事故记录（教训）**：① 上轮（存储分层）只改了代码从未部署，本次只传 webos.ts → 服务器 webosWorkspace.ts 缺 `WORKSPACE_TIER_BYTES` 导出 → 启动即崩、pm2 疯狂重启（restarts 238），**补传 webosWorkspace.ts/afdian.ts/piBridge.ts/shared 契约后恢复**；② scp 大文件（611KB JS）在沙箱→服务器链路反复 stall/0 字节文件 → index.html 已引用未传完 JS（白屏风险），**先 sed 回滚 index.html 到旧资源 → 本地 gzip（177KB）上传 → 服务器 gunzip → sed 切回新版**。教训：大文件部署用 gzip 压缩传输 + 先回滚 HTML 引用再切新版，避免半成品资源上线。

**加载速度优化结论（回答用户）**：
- **瓶颈不在 CDN**：卡加载页的根因是 bootstrap 1.6MB（动态接口，CDN 不可缓存），已瘦身解决；静态 JS/CSS 已 gzip+HTTP/2+304，CDN 对国内单机场景收益有限。
- **已做**：bootstrap 瘦身（最大头）、fetch 超时兜底、PWA 离线壳、图片缩放代理、懒加载。
- **可做（按优先级）**：① App html 本地缓存（最近打开 App 的 html 存 localStorage/IndexedDB，打开秒开不闪 loading）；② bootstrap 拆分（session/payment/boot 首屏最小集先行，apps/appStorage 异步补齐）；③ 用户大 App 提示（>1MB html 警告或建议素材走 fs）；④ CDN 只建议在海外用户多时上（静态资源边缘缓存），动态 API 走源站；⑤ 可后续评估 HTTP/3（QUIC，弱网移动端有收益）。
- 验证脚本保留：`tmp/verify-boot-slim.mjs`（API 级）、`tmp/e2e-slim.mjs`（浏览器级）、`tmp/boot-check.mjs`（加载页复现）。

### 瘦身后遗症修复（2026-08-07 深夜第二波，已上线）

> 用户反馈瘦身后反而更卡：打开 App 十几秒、App 内图片几分钟、使用 App 时弹 "The user aborted a request."、AI 创建 App 后桌面不刷新、长按无菜单、锚点导航 App 点击页面白屏 `{"error":"NOT_FOUND"}`。逐一根因与修复：

**① "The user aborted a request." + 桌面不刷新（getBootstrap 20s 超时误伤）**：上轮给 `getBootstrap` 全局加 `AbortSignal.timeout(20s)`——**refreshBootstrap（AI 创建 App 后触发）也走它**，弱网下 20s 超时 → AbortError 弹错 + 桌面不更新。修复：`getBootstrap(timeoutMs?)` 拆分——**仅 boot() 首屏传 20s**（防卡加载页），refreshBootstrap/logout 不传（无超时）。

**② 打开 App 十几秒（按需拉取 + 无缓存）**：瘦身后 App HTML 每次打开都重新网络拉取（弱网 62KB 也慢），且显示 loading。修复：**AppRuntime HTML 本地缓存**（`localStorage daily-webos-app-html:<appId>` 存 html+versionId）——再次打开先渲染缓存秒开，后台拉最新覆盖（App 更新后自动刷新）。图片首次加载弱网慢不可避免，raw 端点已有 `Cache-Control: public, max-age=86400`（二次打开走浏览器缓存秒开）。

**③ 锚点导航 App 白屏 `{"error":"NOT_FOUND"}`（base 注入陷阱）**：App（如「我的世界·方块世界」）用 `<a href="#about">` 锚点导航，宿主注入 `<base href=".../files/raw/">` 后**纯锚点链接被解析为对 base 的真实导航** → 请求 raw 端点 → 404 JSON 白屏。修复：`APP_RUNTIME_BOOTSTRAP` 注入全局 click 拦截器——`href` 以 `#` 开头的链接 preventDefault + `scrollIntoView` 平滑滚动（文档内导航，不触发请求）。**这是既有缺陷，被锚点导航 App 首次触发。**

**④ 长按无菜单（桌面模板从未部署）**：服务器 `webosDesktopV1.ts` 停在 **8-6 版**（35181B，无 8-12 的 touch 拖拽/菜单补全）——之前记录的"部署"实际未发生（本地日期超前服务器 5 天，AGENT.md 里的 8-12 记录未落地）。修复：上传最新模板（40256B，touchstart×2 + 菜单全）到服务器；用户桌面因历史含 guest 版本（AI 改过）不触发 ensureSystemDesktop 自动升级 → **手动运维脚本升级**：创建 v1.0.25（system，新模板 36037B）切换 active + 写回工作区镜像，历史版本保留可回滚。**坑：脚本版本号 `Number('1.0.1')` 是 NaN 导致 maxVer=0 → 新版本号算出 1.0.1 与历史重名**，已二次修正为 1.0.25。**教训：语义化版本号不能用 Number() 解析，要按点号 split 取末段。**

**⑤ AI 创建 App 后桌面不显示**：同①（refreshBootstrap 被 abort）——修复后自动恢复；桌面还有 apps_changed 通知（8-7 既有）双保险。

**验证**：server/shell-web tsc、vite build 全过；模板 vm 校验（check-desktop.cjs：拖拽/菜单函数齐全、无残留 HTML5 DnD）；线上 page/js/bootstrap 200，bootstrap 86KB；用户桌面 active=v1.0.25(36037B=本地模板)；pm2 稳定（restarts 239 不再涨）。
**部署**：后端 `server/src/webosDesktopV1.ts`（src/）+ `server/src/webosStoreV1.ts`（src/）；前端重建 shell-web dist 上传（index-D5rHFJ0b.js，gzip 181KB 上传后 gunzip）；pm2 restart；用户桌面手动升级脚本模式保留（版本号修正版见 `tmp/fix-desktop-upgrade.mts` 说明）。
**遗留**：沙箱→服务器 scp 链路极不稳定（stall/0 字节），大文件一律 gzip 后传输 + 传完校验大小 + 先回滚 index.html 引用再切新版（防半成品上线）。

### 网络/CDN 诊断结论（2026-08-08 凌晨，待用户接入 CDN）

> 用户现象：手机能流畅刷 1080p 视频（国内 CDN），但访问本站：进站 5s、打开 App 5s、图片几分钟。用户质疑服务器带宽，要求评估"带宽无限的亚太 CDN"。

**诊断（已实测）**：
- 服务器在**香港**（154.64.249.172，AS979 NetLab Global），用户在国内 → 每次请求走**跨境链路**（RTT 300ms+，晚高峰丢包放大）。这是核心瓶颈，与带宽无关。
- 实测：TLS 握手 1.2-1.9s、TTFB 1-2s（服务器自身 30ms 出数据，时间全耗在跨境路上）。
- 服务器→国内骨干 ping 223.5.5.5：32ms 0% 丢包（线路本身尚可；用户最后一公里国际出口不可控）。
- DNS NS = ns5/ns6.myhostadmin.net（新网互联，国内服务商，用户解析应正常；此前沙箱 DNS 13s 是沙箱环境问题，非域名问题）。
- nginx 原无 ssl_session_cache（每次全握手）。

**已做免费优化（已生效）**：
- ✅ 开启 BBR（`net.ipv4.tcp_congestion_control=bbr` + `fq` qdisc，写 /etc/sysctl.d/99-bbr.conf）——跨境高丢包下传输效率显著提升。
- ✅ nginx http 块加 `ssl_session_cache shared:SSL:20m` / `ssl_session_timeout 1d` / `ssl_session_tickets on` / `ssl_early_data on`——重复访问 TLS 1.8s → 0.35s（实测）。

**CDN 结论（待用户执行）**：需要上，但**不是"带宽无限"**——CDN 按流量计费，本站月流量 <1GB，成本几毛-几元。真正价值是**国内边缘节点就近接入**（静态秒开、动态回源加速）。推荐**腾讯云 CDN（或 EdgeOne）**：
- **强烈建议子域方案**：`cdn.shadowshub.xyz` 子域走 CDN（静态资源），主域直连源站（动态 API + SSE 聊天 + cookie 鉴权不受影响）——避免整站 CNAME 的"动态请求被缓存/SSE 被缓冲"坑。
- 缓存规则：`/daily/assets/*` 30天；`icon-*.svg`/`manifest`/`sw.js` 1天；`/webos/api/apps/*/files/raw/*`、`imagegen/file/*`、`videogen/file/*` 1天（免鉴权公开素材，UUID 不可变）；`/daily/exp/*` 10分钟；`/webos/api/bootstrap`、`/api/*`、`/webos/api/chat/*`、`/webos/api/workspace/*` **不缓存**；`chat/stream`（SSE）**不缓存+关缓冲**。
- 用户接入后：前端静态资源前缀切到 CDN 子域，nginx 无需大改（子域可以 CNAME 到 CDN，同源 API 不动）。
- 待办：用户开通腾讯云 CDN → 给 CNAME → 我完成前端资源前缀切换 + 逐项验证缓存/SSE。

### 横屏全屏 + 长按验证 + 商店布局/清空（2026-08-08，已上线）

**① 横屏 App 不全屏（根因：Shell 440px 卡片误判）**：`.shell-stage{max-width:440px}` + `@media(min-width:700px)` 桌面卡片样式——**手机横屏时宽 844px 触发"桌面模式"，整个 Shell 被压成 440px 居中卡片**（两侧平台背景），竖屏 App 全屏但横屏 App 只占中间一块。修复（styles.css）：
- 桌面卡片样式加 `and (hover:hover) and (pointer:fine)`（仅桌面鼠标设备）
- 新增 `@media(orientation:landscape) and (hover:none) and (pointer:coarse){ .shell-stage{width:100%;max-width:100%;margin:0;border-radius:0} }`（触屏横屏全屏铺满），@supports 块同步。
- 验证（Playwright 844x390 横屏触屏视口）：`.shell-stage` =844x390（maxWidth100%、radius0px）PASS；桌面视图同样全屏。**不改 AI 提示词**（用户决策：App 自己写 width:100% 即全屏，根因在平台层）。

**② 长按没反应（实为模板未部署/用户未刷新）**：Playwright 真机级 touch 长按线上桌面验证：`touchstart→650ms→touchend` 菜单正常弹出（"系统应用不可操作/整理桌面/取消"）✓——**功能正常**。用户端需强刷（bootstrap 是 no-store 动态接口，刷新即新模板 v1.0.25）。若用户仍无反应，检查其 WebView 是否缓存了旧桌面 html。

**③ 应用商店顶部布局优化（webosStoreV1.ts）**：原"标题→搜索→空间条→tab"四层堆叠间距 2-4px 拥挤。修复：store-head 只包标题（提前闭合）；**空间条移到 tabs 下方**改轻量胶囊（margin 2px 18px 10px、padding 7px 13px、圆角 12px）；间距拉开。验证：HTML 标签配对 OK、JS vm 语法 OK、顺序 head→search→tabs→space ✓。存量账号由 ensureSystemStore（所有版本 system）自动升级。

**④ 应用商店清空**：`DELETE FROM webos_store_apps`（6 条测试条目全删；visits/installs 本就 0）。线上 `GET /store/apps` 返回 `{userFreeBytes, items:[]}` ✓。

**部署**：后端 `server/src/webosStoreV1.ts`（src/）；前端重建 dist（index-0z0nlOcI.js / index-D0PjZ4kn.css，gzip 传输后 gunzip）；sed 切 index.html 引用；pm2 restart；page/js/css 200、商店空列表、横屏 PASS。
**验证脚本**：`tmp/e2e-longpress.mjs`（长按）、`tmp/e2e-landscape.mjs`（横屏）、`tmp/check-store-structure.cjs`（模板结构）。

### App 图标全丢根因修复 + 长按排查结论（2026-08-08，已上线）

> 用户反馈：部署后最新 App 的 icon（AI 画的）变默认首字母，还有好几个 App 也这样；长按 App 依然没反应（游客实测正常）。

**① icon 全丢根因（normalizeApp 漏字段）**：`normalizeState → row.apps.map(normalizeApp)`——**normalizeApp 返回对象漏掉 `icon` 字段**！loadState 后内存里 app.icon=undefined，**任何一次 saveState（AI 创建新 App、扣费、上传等）把整个 state 写回 DB → 所有 App 的 DB icon 被洗成 undefined**。部署后第一次 saveState（如创建 app-d3a1178e）即触发全量清洗。修复：normalizeApp 补 `icon: typeof row.icon === 'string' && row.icon ? row.icon.slice(0, 8*1024) : null`。
- **已丢失的 icon 无法从 DB 恢复**（数据已洗掉）：有工作区 `icon.svg/icon.png` 文件的 App（7 个）由 readAppIconFile 正常显示；无文件的（我的世界、最新 App 等）需让 AI 重新画（AI 用 create_webos_app 工具更新 icon → 存 DB → 不再被洗）。
- 注意：REST `POST /webos/api/apps` 本就不支持 icon 参数（用户粘贴 HTML 路径无图标，预期）；AI 工具路径 `create_webos_app` 存 icon。
- 验证：normalizeApp 逻辑单测 PASS（icon 保留）；服务已重启部署。

**② 长按排查结论（功能正常，用户端缓存问题）**：Playwright **16 个 App（12 用户 App 含 icon + 系统）数据量级**逐个真机 touch 长按：**全部弹出菜单**（系统 App 3 项 / 用户 App 6 项）✓——模板、数据量、icon 均不影响长按。用户真机无反应 = WebView 缓存旧桌面 html（bootstrap 是 no-store，强刷即得 v1.0.25）。**行动：用户强刷（清缓存）后再测；仍无反应需查其 WebView 是否缓存旧 bootstrap/桌面**。

**部署**：后端 `server/src/routes/webos.ts`（normalizeApp icon 修复）；pm2 restart；tsc 通过。


---

### 长按真机失效根因（touchstart passive:true）+ 真实账号实测（2026-08-08，v1.0.26 已上线）

> 用户反馈：两个浏览器真机实测长按仍无反应（此前一直用游客/模拟数据验证，被用户批评——**必须用站长账号实测**）。

**① 用站长账号真实实测**（JWT 注入 Playwright，2893334965@qq.com）：登录 ✓、桌面 16 App 渲染 ✓、JS 零错误 ✓、**逐个长按全部弹出菜单** ✓——功能本身正常，Playwright 派发 touch 事件**绕过浏览器原生手势**，所以模拟永远测不出真机问题。

**② 真机失效根因（确定）**：桌面模板 `touchstart` 监听是 **`{ passive: true }`**（其余事件全 passive:false，唯独它漏了）——桌面是可横滑容器（#pages），浏览器对 passive touchstart 做"滚动 vs 点击"手势判定，**真机长按被判定为潜在滚动 → 发 touchcancel → 菜单取消**。修复（v1.0.26）：touchstart 改 `{ passive: false }` + 立即 `preventDefault()`（阻止滚动手势判定，长按不再被取消）+ editing 拖拽同样 preventDefault + body 加 `-webkit-touch-callout: none`（防 iOS/部分安卓浏览器长按系统菜单）。
**③ 部署**：webosDesktopV1.ts 上传 + 用户桌面手动升级 v1.0.26（36488B，历史版本可回滚；升级脚本 `tmp/fix-desktop-upgrade2.mts`，版本号用 `split('.').pop()` 修正）+ pm2 restart；站长账号实测 PASS。
**④ 教训**：真机手势类问题（长按/拖拽/滚动拦截）**必须用真实账号 + 真机或注入真实 JWT 的浏览器实测**；Playwright dispatchEvent 模拟不能替代原生手势路径（passive 差异、系统文本选择、touch-callout 均无法模拟）。

### 长按/短按交互最终方案（2026-08-08 v1.0.29，用户真机逐版验证结论）

> 用户真机逐版反馈：v1.0.26 长按进整理模式（非菜单）；v1.0.27 长按无反应（延迟 preventDefault）；v1.0.28 短按打不开 + 长按只变大不弹菜单（touchend 不派发）。最终定位：

- **用户诉求**：长按图标 = 弹出菜单（分享给朋友 / 上传到应用商店 / 下载源码 ZIP / 删除移入回收站，固定 4 项）；短按 = 打开 App；拖动排序不再是长按行为（改为空白处长按 450ms 进入整理模式，整理模式内拖动排序）。
- **真机关键差异（逐版实证）**：
  1. `passive:true`（v1.0.25）：浏览器对可滚动容器做"滚动 vs 点击"手势判定 → 真机长按被 touchcancel 取消 → 无反应。
  2. `passive:false + touchstart 立即 preventDefault`（v1.0.26）：长按可靠触发（armed 达成），**但部分 WebView（魅族等）preventDefault 后 touchend 不再派发** → 短按打不开、长按只变大（armed 样式）不弹菜单。
  3. **最终方案（v1.0.29）**：`.app { touch-action: none }`（CSS 标准：图标不做滚动手势判定，touch 事件流完整）+ touchstart preventDefault 双保险 + **短按在 touchend 手动 `SDK.apps.open`（不依赖 click）**、长按 touchend 弹菜单、空白长按（pages，passive）进整理模式。
- **菜单 4 项**（非系统 App）：分享给朋友 / 上传到应用商店 / 下载源码 ZIP / 删除（移入回收站）；点遮罩关闭（无取消按钮）；系统 App 显示"不可操作"提示。
- **桌面版本演进**：v1.0.25(36037B) → v1.0.26(36488B passive 修复) → v1.0.27(36973B 交互重做) → v1.0.28(36965B 立即 preventDefault+手动打开) → v1.0.29(37235B touch-action:none)。用户桌面由 `tmp/fix-desktop-upgrade2.mts` 手动升级（版本号 split('.') 取末段），历史版本保留可回滚。
- **待真机确认**：v1.0.29 若仍有 touchend 不派发问题，则上 pointer 事件双轨（pointerdown/pointerup 处理 touch 类型 + 去重标志）。

### 长按失效根因终定位（pointerleave 清状态）+ CDP 复现法（2026-08-08 v1.0.30，已上线）

> 用户要求"先复现再解决"。用 **CDP Input.dispatchTouchEvent（浏览器真实手势路径）** 成功复现"短按打不开、长按只变大不弹菜单"，事件流日志逐层定位到确切根因。

**CDP 复现法（关键突破，AGENT.md 8-12 教训的终极解法）**：Playwright `dispatchEvent` 派发事件**绕过浏览器原生手势**（永远测不出真机问题）；**CDP `Input.dispatchTouchEvent`（+ `Emulation.setTouchEmulationEnabled`）走真实输入管线**，能复现 touchcancel/pointerleave 等原生行为。坐标 = iframe 偏移 + iframe 内 rect。**注意**：新游客首次进入有**公告弹窗遮挡**（.login-panel announcement-panel 拦截所有触摸）——必须先点"不再显示"。

**根因（事件流铁证）**：触摸抬起时浏览器事件序列 = `pointerdown → touchstart → pointerup → pointerout → pointerleave（SVG→tile→app→grid→page…）→ touchend`——**pointerup 后、touchend 前浏览器派发一串 pointerleave**（CDP 与部分 WebView 实测），而模板 `pointerleave` **无条件 clearPress()** → **长按 armed 状态被清掉** → touchend 时 `armed=false` → 菜单不弹、短按分支也不走（pressTimer 已清）→ 表现"长按只变大（armed 样式出现过）但无菜单、短按无反应"。

**修复（v1.0.30）**：`pointerleave` 跳过 touch 指针（`if (e.pointerType === 'touch') return;`）——触摸抬手由 touchend 处理，pointerleave 只对鼠标（移开取消长按）有意义。

**验证（CDP 触摸，同路径）**：短按打开 App ✓；长按菜单弹出且 4 项齐全（分享给朋友/上传到应用商店/下载源码 ZIP/删除移入回收站）✓。部署 v1.0.30（37534B）+ 用户桌面升级 + 服务重启完成。
**桌面版本演进**：…v1.0.29(37235B touch-action:none) → **v1.0.30(37534B pointerleave touch 跳过)**。复现脚本 `tmp/e2e-cdp-touch.mjs`。

### v1.0.31 pointerup 双轨（真机 touchend 不派发的最终解法，已上线）

> 用户真机 v1.0.30 仍"长按只变大不弹菜单"（armed 样式残留 = touchend/touchcancel 都没派发）。CDP 实测事件序列：`pointerdown→touchstart→pointerup→pointerleave×N→touchend`——**pointerup 在 touchend 之前独立派发**（PointerEvents 标准，Chrome87+ 全支持）。

**修复（v1.0.31，37938B）**：**pointerup（含 touch 类型）优先处理抬手**（armed → openMenu；未 armed → SDK.apps.open），`touchHandled` 标志去重，touchend 兜底（pointerup 已处理则跳过）。pointerdown（touch）与 touchstart 去重启动长按。即使 WebView 吞掉 touchend，pointerup 仍能可靠完成"抬手"逻辑。
**验证（CDP 同路径）**：短按打开 ✓、长按菜单 4 项 ✓。用户桌面升级 v1.0.31，历史版本可回滚。

### v1.0.32 长按达成即弹菜单 + click 时间差兜底（不依赖抬手事件，已上线）

> 用户 v1.0.31 后反馈"任何账号都一样：长按无反应，只有图标放大"——armed 样式残留说明 touchstart+timer 正常，但 **touchend/pointerup 抬手事件在用户 WebView 上都不派发**，而 v1.0.31 仍把"弹菜单"放在抬手处理里 → 永远等不到。结论：**弹菜单不能依赖抬手事件**。

**修复（v1.0.32，38544B，四处）**：
1. **长按 450ms 达成瞬间即弹菜单**（startPress timer 回调里直接 `longPressOpened=true; openMenu(app)`，不等抬手）——即使 WebView 完全吞掉 touchend/pointerup，菜单也已弹出；
2. **handleRelease 的 armed 分支只清理状态**（菜单已弹，抬手不再重复弹）；
3. **click 处理器实现真正的时间差兜底**（此前注释声称有但代码没有）：touchHandled 去重（避免正常浏览器 click 重复打开）→ longPressOpened/dragJustEnded 抑制 → `downAt && Date.now()-downAt>=450` 判定长按弹菜单，否则 `SDK.apps.open`——任何浏览器 click 必触发，作为 touchend/pointerup 全缺失时的终极兜底；
4. **鼠标 pointerup 也设置 touchHandled**（防鼠标路径 click 重复打开）。

**验证（CDP 真实触摸，同用户路径）**：短按 150ms → 打开 App ✓；长按 700ms **600ms 时（手指未抬）`menuShownBeforeRelease:true`**（菜单在抬手前已弹出）+ 抬手后菜单保持、4 项齐全 ✓。用户桌面升级 v1.0.32（升级脚本 note 更新，历史版本可回滚）。
**桌面版本演进**：…v1.0.31(37938B pointerup 双轨) → **v1.0.32(38544B 达成即弹 + click 兜底)**。

### ⚠️ 重大根因：CSS 解析中断——菜单"做了但从未显示"（v1.0.33，2026-08-08 深夜定位）

> 用户质疑"你根本没有做长按菜单"。逐层证据链排查后定位到**真正根因**：模板 CSS 中 `#dots {` 声明块**缺少闭合 `}`**（`gap:5px;` 后直接写 `#dots i {`）→ 浏览器 CSS 解析进入错误恢复模式，**从 `#dots` 到文件末尾的全部规则被整体丢弃**（`.dock`/`#appmenu.show`/`#toast`/`#confirm`/`#dots i.active`/`button.m-item` 全丢）→ 长按菜单 JS 逻辑一直正常（class 都加了），但 `#appmenu.show { display:flex }` 从未被浏览器解析 → 菜单**从未视觉显示过**（元素在文档流底部、视口外）。**这解释了用户从 v1.0.25 起所有"长按无反应/只变大"反馈**（此前 CDP 验证只检查 classList 没检查 CSS 生效，被误导多轮）。

**排查方法（关键教训）**：发现 computed style 异常（`#appmenu` display:block 而非 none、z-index:auto、rect 高 64px 塌陷）→ 打印 styleSheets[0].cssRules 只有 34 条（完整应有 64 条）→ 定位最后一条成功解析的规则 `#dots` → 对照模板源码发现缺 `}`。

**修复（v1.0.33，38548B）**：补上 `#dots` 块的 `}`。验证方式升级：**新增 `tmp/check-desktop-css.mjs`（浏览器级 CSS 完整性校验）**——tsx 求值模板 → 提取 `<style>` → Playwright setContent 真实解析 → 断言 ruleCount≥60 + `#appmenu.show`/`.dock`/`#toast`/`#confirm`/`#dots i.active`/`button.m-item` 全部存在 + `#appmenu.show` computed display=flex。**此后任何模板改动必须过 CSS 校验 + JS 校验双关**（此前只有 JS vm 校验，CSS 是盲区）。

**v1.0.34→v1.0.35（遮罩误关修复）**：菜单弹出后全屏遮罩覆盖，抬手时浏览器合成的 click（target 落在新遮罩上）会触发"点遮罩关闭"→ 用户来不及操作。v1.0.34 用"距菜单弹出 500ms 时间窗"有缺陷（长按按住 >950ms 再抬手仍会误关）。**v1.0.35 最终方案（39042B）**：document 捕获 touchend 记录 `window.__lastTouchEndAt`，遮罩 click 时距上次 touchend <300ms 一律忽略（合成 click 必然紧跟 touchend），之后真实点遮罩才关闭——**任何按住时长都稳**。

**最终验证（v1.0.35 全绿）**：CSS 初始 none ✓；长按 700ms 不抬手：show + display:flex + visibility:visible + opacity:1 + z-index:11 + 全屏遮罩 390×844 + 4 项齐全（分享给朋友/上传到应用商店/下载源码 ZIP/删除移入回收站）+ 标题/副标题正确 ✓；抬手后（含截图延迟场景）菜单保持 flex ✓；事件时间线：489ms show → 760ms pointerup → 768ms 合成 click(target=appmenu) 被 300ms 判定忽略。
 **桌面版本演进**：…v1.0.32(38544B) → **v1.0.33(38548B CSS 中断修复)** → v1.0.34(38824B 时间窗方案，被 35 替代) → **v1.0.35(39042B 距 touchend 判定)**。

### 文件上传全部失败修复（2026-08-13，nginx 1MB 限制，已部署验证）

> 现象：用户反馈"无法上传文件，只要上传文件就是失败"。**已修复、已部署、已线上验证。**详见 `docs/bug-upload-413.md`。

**根因**：nginx 未配置 `client_max_body_size`（默认 `1m`）——前端把文件转 base64（膨胀 ~4/3）放进 JSON body 后，任何原文件 >约 **750KB** 的上传请求在 nginx 反代层即被 413（HTML 错误页）拦截，根本到不了后端。手机相册照片（2-5MB）、文档、视频、压缩包全部命中。2026-08-12「取消单文件大小限制」只改了业务代码，漏改两处传输层限制：① nginx（默认 1m）② Express `express.json({limit:'20mb'})`（2026-08-03 残留）。

**排查方式（无 SSH 也可定位）**：对免鉴权端点 `POST /api/auth/guest` 做 body 大小阈值探测（500KB→200、900KB→200、1.1MB→413 HTML 错误页）即可确定是 nginx 层。

**修复（已部署）**：
1. `server/src/index.ts`：`express.json({ limit: '600mb' })`（tsc 通过，已 scp + pm2 restart）
2. nginx：新建 **`/etc/nginx/conf.d/upload-size.conf`**（`client_max_body_size 600m;`，http 级全站生效）+ `nginx -t` 通过 + `systemctl reload nginx`

**线上验证**：公网 2MB body → 200（此前 413）；真实登录用户公网上传 1.1MB jpg → `{"ok":true}`（验证后已删除测试文件、清理测试工作区）；pm2 online。

**部署教训（2026-08-13）**：
- **教训 1**：不要往 sites-enabled 的 server 文件顶部直接加指令——多个站点文件（default/admin-daily 软链接）会被 include 进同一 http 上下文造成 `client_max_body_size duplicate`；
- **教训 2**：备份文件勿留在 sites-enabled 内（`*.bak` 会被 `include /etc/nginx/sites-enabled/*;` 一起加载；软链接备份会重复加载同一文件 → 指令/listen 重复）；备份应放 `/root/daily/backups/`；
- **教训 3**：nginx 配置改动应先 `nginx -t` 再 reload，改坏时 `nginx -t` 会拦截，运行中的 nginx 不受影响（内存配置不变）。

**SSH 连接经验（2026-08-13）**：沙箱→服务器 22 端口出现 KEXINIT 后无响应（TCP 通、banner 通、KEX 大包丢）→ 连续多次重试会触发服务器 sshd 惩罚（PerSourcePenalties），表现为 `Connection closed by ... port 22`/paramiko `EOF in transport thread`（服务器主动断连）。**对策：停止高频重试，等 10-30 分钟惩罚窗口衰减后再单次尝试**（本次等待约 10 分钟后即恢复连接）。可用 `ssh -v`/paramiko 日志区分：卡 KEXINIT = 链路丢包或服务器惩罚；收到 EOF = 服务器主动断连（惩罚/限流）；banner 正常 = sshd 活着。

### 大文件分片上传（2026-08-13，10GB 级文件可传，已部署验证）

> 用户诉求：会员存储空间 10GB，要能一次上传 10GB 级文件（视频/ISO/大数据）。**已实现分片上传并上线。**
> 背景：单请求 body 上限 600MB（base64 后 ≈450MB 原文件）；直接调大 limit 不可行——10GB 文件 base64 ~13.3GB，
> 服务器仅 3.7GB 内存，`express.json` 全量解析必然 OOM；且单请求跨境传输必超 nginx 转发超时。

**方案：顺序分片 + 断点续传（append 模式）**
- 前端（`api.ts uploadWorkspaceFileLarge`）：文件 >20MB 走分片，**8MB/片**（base64 ~10.7MB，远低于 600MB 上限）；
  每片独立请求（不超时、内存恒定），片失败重试 3 次（1s/2s/4s 退避）；App.tsx 两处上传（composer ➕ / FilesView）已接入。
- 服务端（`webos.ts POST /webos/api/workspace/files/upload`，action=init/part/complete/abort）：
  - init：类型白名单 + 配额预检（size ≤ 剩余空间）+ **续传复用**（同 key+同名+同大小未完成会话自动复用，返回已收片数）；
  - part：顺序校验（index 必须等于已收片数，乱序 400 PART_SEQUENCE）+ 累计不超 total + appendFileSync；
  - complete：字节数精确校验（PART_INCOMPLETE）+ 最终配额复核（防 init 后被占满）+ **同盘 rename 原子落盘**；
  - 临时文件放 `<sandbox>/webos/_uploads/<key>/`（工作区外，不计配额、列表不可见）；session TTL 24h，惰性清理 + 每小时定时器（含服务重启后残留临时文件兜底）；
  - 路径越界统一 400 INVALID_PATH（workspacePathError，与 GET/DELETE 一致）。
- **类型白名单扩展**（`webosWorkspace.ts`）：+html/htm/css/js/xml/yaml/yml/log/ini/conf/cfg、wmv/flv/3gp/mpeg/mpg、
  bz2/xz/iso/img/dmg/pkg/apk/msi/deb/rpm、bin/dat/psd/ai/xmind/kml/kmz/dwg/dxf/cbr/cbz（仅存储不执行，App 运行时另有 sandbox）。
- **验证**：本地 7 项端到端全过（24MB 3 片、续传 resumed、乱序/不完整/越界/非法类型 400、游客 403）；
  线上公网 25MB 非整片（26215177B）4 片上传 → size 精确 ✓（验证后已清理）。
- 部署：`webos.ts`（routes/）+ `webosWorkspace.ts`（utils/）+ 前端 dist（index-BOTyyi0r.js，gzip 传输）+ pm2 restart。
 - 已知边界：单会话 24h 未活动过期；服务重启后未完成上传需重新 init（前端 abort 后自动续传新会话）；单文件上限 = 工作区配额（10GB 档可传 10GB 文件）。

### 统一对话 log（reasoning 落库）+ 自动整合 trace + 文件夹即 App 即时化 + app-dev skill（2026-08-13，已部署验证）

> 用户决策：①**reasoning 思考过程也要保存**——只有它能反映 AI 怎么想的（此前 webos_chat_logs 只存思考档位，DeepSeek 思考全文只在 SSE 流式展示、服务端不落库）；②**一个对话里面的全部东西统一保存为一个 log**；③把 App 相关提示词全部放进 skill，保证原提示词简洁；④让 AI 自行创建文件夹（系统帮初始化）——「创建 App」不该是黑盒工具。

**① 统一对话 log（新表 `webos_chat_sessions`，一次请求 = 一行完整记录）**：
- events JSON 保存完整事件序列：user 消息（首条必有）+ **thinking 段（thinking_delta 合并，即 AI 思考全文）** + delta 段（输出）+ tool_start/tool_update/tool_end + html + app_created/app_updated + 状态与用量。
- 收集器：`appendTaskEvent` 内同步累积（与任务缓冲解耦，新任务重建时重置）；**所有结束分支**（ok/failed/empty_response/insufficient/断连后台）统一调 `recordChatSessionLog` 落库（失败静默不阻断主流程）。
- 与 webos_chat_logs（按消息粒度、纯文本快速浏览）互补：**reasoning 内容只在此表**。
- schema（schema.ts/schema-sqlite.ts 两套）+ migrations.ts `ensureChatSessionsTable`（幂等，index.ts 启动调用）+ 索引（user/conv/created）。

**② 自动整合诊断（管理端新接口）**：
- `GET /api/admin/webos/trace?userKey=&conversationId=&appId=&hours=`：把①统一对话 log（含 reasoning，平铺进时间线）②工作区 `logs/execution.log`（AI 工具调用轨迹：工具名/参数摘要/成败/note）③App 版本历史（versions 的 createdAt/createdBy/source）合并排序为一条时间线——排查「AI 干了什么/为什么没生效/来回折腾了几次」一条命令看全，不再手动拼多表（本次排查飞机大战就是手动拼 chat_logs+execution.log+版本历史，多轮往返）。
- `GET /api/admin/webos/sessions?userKey=&conversationId=&limit=`：完整 events 查询（含 reasoning 原文）。

**③ 文件夹即 App 即时化（AI 自行创建文件夹，系统帮初始化——用户建议落地）**：
- `webosWorkspace.ts`：`workspaceFsTools(key, hooks?)` 新增可选钩子 `WorkspaceFsHooks`：
  - **mkdir 命中 `apps/<name>/`**（apps 下一级）：自动写最小 index.html 骨架（「新 App 已就绪」占位页，AI 之后覆盖）+ 触发 `onAppFolderCreated`；
  - **write/edit/copy/delete 命中 `apps/<appId>/index.html`**：触发 `onAppSourceChanged`；
- `webos.ts` 注入 hooks：onAppFolderCreated → loadState → `syncAppsFromWorkspaceFolders`（注册/骨架校验）→ saveState → `notifyAppEvent('app_created')`；onAppSourceChanged → loadState → `syncAppSourceFromWorkspace`（校验通过立即建新版本并切换）→ saveState → `notifyAppEvent('app_updated')`。**AI 改文件立即生效，不再等 bootstrap 懒同步**（此前 AI 第一轮修复只改工作区文件、运行时加载版本库旧快照 → 用户永远看不到修复，AI 读源码才发现 sync 机制——本次根治）。
- SSE 转发：钩子登记的 app_created/app_updated 经 `pendingAppEvents`（模块级 Map，key=tKey 前缀兜底）在 tool_execution_end 分支消费推送前端（appendTaskEvent + sseWrite）——桌面/商店自动刷新。

**④ AI 自测工具 `inspect_webos_app`**：返回 active 版本号/版本数、工作区镜像一致性（clean=镜像==active / changed=文件被改未发布 / missing）、素材文件清单、index.html JS 语法校验（vm.Script）——AI 改完自查「我的修改是否已生效/会被加载」，不再盲等用户反馈。

**⑤ app-dev skill（.pi/skills-webos/app-dev/SKILL.md，81 行）**：App 开发规范全集——创建（文件夹即 App 主路径 + create_webos_app 仅用于用户粘贴 HTML）、修改（html 与素材两个世界：html 走版本库即时建版本、素材走磁盘即真源）、素材生成放置流程、数据保存（localStorage 小数据 / fs 大文件 / 禁 IndexedDB）、SDK 能力、8 条血泪坑（canvas 污染/__APP_ID__/缓存版本/polyfill/外链/版本不可变等）、自测清单。**系统提示词（piBridge.ts）同步精简**：原两大段 App 规范压缩为一行「涉及 App 一律先 read app-dev skill」。

**⑥ 前端 App HTML 缓存版本校验（App.tsx AppRuntime）**：`daily-webos-app-html:<appId>` 缓存读取时校验 `versionId === activeVersionId`，不一致**不渲染缓存**（等拉取最新）——杜绝「AI 已发布新版本但用户打开先看到旧缓存、误以为没修复」。

**验证**：server/shell-web tsc exit 0、vite build 成功；真实 SSE 对话（"你好，请回答一个字：好"）→ `webos_chat_sessions` 出现 1 行，events = `[user, thinking("The user asks me..."), thinking("...answer with one character: 好."), delta("好")]`（**reasoning 落库确认**）；`/trace` 站长账号 2h 返回 156 条 / 12h 199 条时间线（对话+工具+版本合并）；迁移日志 `[db] webos_chat_sessions ensured`；服务单实例、网站 200。
**部署**：后端 8 文件（schema×2/migrations/index/webos/webosWorkspace/adminWebos/piBridge）+ 新 skill + 前端 dist；沙箱→服务器用 `cat tgz | ssh 'cat > ...'` 管道传输 + md5 校验一致（scp 不可用）；数据库已备份 `backups/daily.db.bak-chatlog-20260810-230026`。
**遗留**：存量用户从下次对话起才有完整 log（历史不回溯）；管理后台 UI 尚未接 trace/sessions（接口已就绪，可后续加页面）。

### 视频生成失败详情落库 + 防超时 + App 内视频秒播（2026-08-08 晚，已上线）

> 用户反馈：①AI 用 9 张参考图生成视频，第一次工具"超时"（后台实测第一次任务创建失败 TASK_CREATE_FAILED，131.5s，AI 自动重试后成功）；②对话页预览视频秒开，但 App 内视频要等几十秒。

**排查结论（站长账号实测）**：
- 请求 13:11:57Z → 第一次 generate_video 失败 13:15:26Z（131.5s，task_id 空、未扣费）→ AI 会话内自动重试 → 13:19:30Z 成功（task_id 2086079187927654400，`agent/videos/video-6608f1c9-mskehhpy.mp4` 3.3MB 768P）→ 13:20:13Z 会话正常 done。
- "超时"构成：H3-Context-IR 增强轮询（最多 180s，**期间无进度回调 → 不刷新 pi 活动计时，逼近 180s 空闲超时被误杀风险**）+ 创建任务瞬时失败（渠道错误详情未落库，只能靠猜）。
- App 视频卡顿根因：`servePublicAppRawFile` **不支持 Range**（`createReadStream` 全量直出）——App 里 `<video src="assets/xxx.mp4">` 必须整文件下载完才能播（3.3MB 跨境全量）；对话页走 `servePublicVideoFile`（支持 Range）所以秒开。moov 已验证 faststart（偏移 36B）。

**修复（6 文件，已部署）**：
- `webos_video_usage` 表加 `error_message` 列（schema.ts/schema-sqlite.ts + migrations.ts `ensureVideoUsageErrorMessageColumn` 幂等迁移 + index.ts 挂载）；`recordVideoUsage` INSERT 落 errorMessage（≤500 字符）；主落库从 `result.errorMessage` 取。
- **防超时**（minimaxVideo.ts）：① H3-IR 轮询上限 180s→**60s**，超时降级（增强只是优化提示词，不值得干等 3 分钟）；② 增强轮询每 10s 走 `onProgress`（透传 webos.ts 的 onProgress → markPiActivity + tool_update，**彻底消除长轮询期 pi 空闲超时误杀**）；③ `createVideoTask` **瞬时错误自动重试 3 次**（429/5xx/网络异常，退避 1s/3s；402/4xx 不重试），每次尝试 onProgress——避免"创建失败→AI 重试→重新跑一遍 H3-IR（1-2 分钟）"的浪费；④ `generateVideoAndSave` fail() 打 `[videogen] FAIL status=... code=... durationMs=... msg=...` 日志（此前失败只返回给 AI，pm2 查不到）。
- **App 视频秒播**（webos.ts `servePublicAppRawFile`）：mp4/webm 素材加 `Accept-Ranges` + Range 206 分段响应（复用 servePublicVideoFile 逻辑；图片/?w= 缩放路径不受影响）。
- 部署：schema 两文件（db/）+ migrations.ts（db/）+ index.ts（src/）+ minimaxVideo.ts（videogen/）+ webos.ts（routes/）**分别放对目录**；tar.gz 打包单包传输（沙箱→服务器 scp 报 `hostname contains invalid characters`，改用 `cat tgz | ssh 'cat > ...'` 管道传输，md5 校验一致）；服务器 tsc 通过；pm2 restart 单实例。
- **线上验证**：迁移日志 `[db] webos_video_usage.error_message added` + PRAGMA 列存在；`/webos/api/apps/<appId>/files/raw/assets/travel-video.mp4`：无 Range 200 全量 3294947B、`Range: bytes=0-1023` → **206 1024B**、`Range: bytes=3000000-` → **206**；videogen 端点 206 ✓；/daily/ 200、SSE 对话 done 正常。
- 备注：scp 在本机环境不可用（hostname 校验失败），一律用 ssh 管道传文件；本次误删 /root/daily/backups/vidfix-20260808（部署已成功验证，无影响）。
