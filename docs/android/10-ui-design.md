# 10 · UI/UX 设计规范（含图标设计 brief）

> 定位落地为界面：「第二个桌面，更轻量，更个性化」。方向 A「安静智能」的设计语言延续并**为原生重写优化**（不是把 PWA 截图搬进 Compose，而是按 Material You + 我们的气质重设计）。

## 0. 用户 UI 方向 v1（2026-08-16 用户拍板，最高优先级）

> 本节由用户明确给出，**凌驾于本文其余章节；冲突处以本节为准**。细节设计仍走「用户给方向 → AI 出候选 → 用户选定 → AI 落地」流程（UI 协作红线），本节只锁定方向与硬性要求。

1. **沉浸式全屏**：去掉底部 Tab 栏与顶部系统栏的"应用感"——edge-to-edge，壁纸透底，内容沉浸；App 运行页同规格（现有 AppRunScreen 顶栏为 M0 占位，废弃）。
2. **桌面 = 手机启动器体验**（对齐 MIUI/iOS 手势标准）：
   - 多页网格 + 页指示点（现状：PWA 模板 CSS 已有 scroll-snap 容器但实际只渲染单页，Android 端未实现）；
   - 拖动图标到屏幕边缘 → 自动翻页落位（现状：模板拖拽时锁页，未实现）；
   - 拖动图标叠放 → 合并创建文件夹（未实现，需新增 folder 数据模型 + 桌面协议方法）；
   - 长按编辑模式、图标拖拽换位（PWA 已实现，Android 端沿用）。
3. **AI 对话页自由滑入滑出**：**已选定方案 A（2026-08-16 用户拍板）**——横滑页面序列 `[AI 对话页（宿主 Compose）| 桌面页 1..N（HTML WebView）]`，对话页位于最左（类 iOS 负一屏）：桌面第一页继续向右拉 → 宿主接管横滑露出对话页；对话页向左滑回桌面。手势让渡边界：桌面 HTML（scroll-snap 翻页）到达最左页且继续向右拖时，桌面经桥让渡给宿主（具体机制与跟手细节在 M1-4 设计文档定稿）。
4. **架构边界（M1-4 设计前提）**：宿主（Compose）负责 edge-to-edge、系统栏沉浸、跨页面手势（桌面↔对话）；桌面 HTML（AI 可改层，D3）负责网格/多页/文件夹/拖拽。两层手势边界与事件让渡规则必须在 M1-4 设计文档明确；60/120fps 手感预算进验收。
5. **§2 已重写为信息架构 v2（方案 A）**：商店/我的/设置 = 桌面图标（一切皆 App，可拖入 dock），细节随 M1-1 原型评审由用户确认。

## 1. 设计语言

- **气质**：安静、通透、有呼吸感。大留白、低饱和渐变、柔和圆角（≥16dp）、细腻模糊（Backdrop 模糊用于弹层/桌宠托盘）、微动效（150–300ms，emphasized 曲线）。
- **个性化基底**：Material You 动态取色（壁纸取色）× 我们的 design tokens（主题包可覆盖，校验失败回退默认，红线 2）。
- **深色模式**：一等公民，全部页面双主题过审。

### Design Tokens（主题包可改的子集）

```jsonc
{ "color": { "primary", "surface", "surfaceVariant", "onSurface", "accent", "chatBubbleUser", "chatBubbleAI" },
  "shape":  { "radiusSm": 12, "radiusMd": 20, "radiusLg": 28 },
  "blur":   { "panel": 24, "overlay": 40 },
  "motion": { "durationShort": 150, "durationMed": 300, "easing": "emphasized" },
  "wallpaper": { "type": "gradient|image|live", "value": "..." } }
```
（token 的精确 JSON Schema 进 `shared/webos-contracts`，双端共享——契约守卫覆盖。）

## 2. 信息架构（v2 · 2026-08-16 用户选定方案 A，替代已作废的底部 4 Tab）

```
横滑页面序列（手势切换，无 Tab 栏）：
[ 💬 AI 对话页（宿主 Compose）] ⇄ [ 🖥 桌面页 1..N（HTML，scroll-snap）]
                                        │  dock（现有桌面模板 dock 沿用）
                                        ├── 商店 / 我的 / 设置 = 桌面图标（一切皆 App；可拖入 dock）
                                        └── 桌宠层（共享 canvas WebView 挂载点，M1-4）
App 运行页：沉浸全屏覆盖层（无顶栏；系统手势/ predictive back 返回）
```

- 导航 = 手势（方案 A）+ 桌面图标点击；无底部 NavigationSuiteScaffold。
- 对话页是宿主原生 Compose 页（不是 WebView）；桌面是 HTML App（AI 可改，D3）。
- 商店/我的/设置作为桌面图标存在（默认预置；形态细节随 M1-1 原型评审，用户确认）。

### 2.1 UI 的包化边界（D20，2026-08-16 用户拍板）

- **本套 UI = 系统默认 UI 包**（`com.daily.system.ui`，系统大包 `com.daily.system` 的子包）v1 版本：M1 先以 Compose 默认主题代码落地（含 E1 图标 Adaptive Icon），M2 包化为默认 UI 子包（tokens + skill 操作手册 + 工具 + 资源）。
- **可改范围**：除**安全 UI 例外**（权限弹窗/授权页，防骗授权，纯 Compose 写死不可挂载）外，**全部 UI 开放**——布局（输入栏位置/页面结构）、组件（输入框→语音输入框）、气泡样式、壁纸、令牌均可经包修改（`ui.layout` / `ui.component` / `ui.theme` / `ui.extend` 能力 + 语义锚点 + 版本化回滚，03 §5.1）。
- **安全回退**：默认 UI 包常驻；任何覆盖包卸载/回滚即恢复本套默认；主题令牌校验失败自动回退默认（红线 2）。
- AI 改 UI 的操作手册 = UI 子包内 skill（语义锚点清单、可改范围、变体示例、回滚方法），随包注入 AI（D19 组合式包）。

## 3. 关键页面规格

### 3.1 对话主页（J1/J3）

- 顶部：极简栏（左 logo/称呼，右：余额 chip + 设置入口）；**无传统标题栏压迫感**。
- 气泡流：用户右/AI 左；思考折叠条（"想了 12 秒，展开"）；工具 chip 序列（图标+名+状态色）；interactive_html 卡片内嵌（WebView 卡片，高度按协议 heightPx）。
- 输入栏：左「+」（图片/文件）· 文本域（自动增高 ≤5 行）· 麦克风（系统 ASR，08 §3）· 发送/停止按钮互斥切换。
- 建议卡片：空会话时 3–6 个可点 prompt（J1 的魔法引导）。
- 流式性能：delta 合帧提交（16ms 节流），LazyColumn key=messageId（11-performance 红线）。

### 3.2 桌面（J5）

- 两模式：**网格模式**（默认，4×N，长按进编辑：拖拽换位/卸载/信息）与**自由模式**（图标物理悬浮，AI 可编排；右上角"复原"一键回网格）。
- 桌宠层：桌面页内的桌宠直接渲染；全局（任何界面/其他 App 上层）的桌宠走 overlay（07）。
- 壁纸：渐变/图片/live（video/webview 壁纸后置）；AI 换壁纸 = theme 包版本。
- 编辑模式下拖拽手势冲突处理：拖图标用 `detectDragGesturesAfterLongPress`，滚动用惰性列表——长按阈值 400ms（参考既有"长按位移阈值 >10px"经验）。

### 3.3 App 运行页（J4）

- 全屏 WebView + 顶部细进度条；右下角 24dp 悬浮小钮（半透明，不挡内容）呼出底栏菜单：信息/版本/API/权限/分享/关闭。
- 右滑返回桌面（ predictive back 动画）。
- App 崩溃（render process gone）：原生兜底页"App 出了点问题" + 重开/回滚版本两个按钮。

### 3.4 商店（J6）

- 顶部分类 chip（App/桌宠/主题/API/技能/全部）；卡片 = 图标+名+一句话+安装钮；详情页 = 截图/版本历史/权限与数据范围声明/（API 包：端点清单）。
- 安装二次确认仅在有敏感能力时出现（列明"将可使用：悬浮层/读取屏幕…"）。

### 3.5 我的（J7）

- 区块：账号卡片（游客→登录引导）/ 余额与用量（积分、目录价入口）/ 包管理 / 文件管理器入口 / 备份（上次时间+立即备份+导出）/ 权限与能力（矩阵总览+逐项开关）/ 设置（主题、通知、关于）。
- 支付/邮箱未接入侧只显示明确 unavailable（红线 3）。

## 4. 图标设计 brief（交给生图流程执行）

> 执行方式（本文档读者照做即可）：用站长账号调服务端生图 `POST /webos/api/imagegen`（模型 gpt-image-2-super，1024×1024），按下述 prompt 生成 4 张候选 → 选定后制作为 Adaptive Icon（前景矢量重绘 + 背景纯色/渐变 + monochrome 单色层）。**生成产物存工作区 `system/branding/` 并归档进 `client/android/app/src/main/res/`。**

**设计概念**：「一颗安静的 AI 光点，悬浮在你的第二桌面网格之上」——体现"AI 即系统"+"轻量桌面"。

**生图 prompt（英文，直接使用）**：
```
Minimalist Android app icon, flat vector style, rounded squircle shape, calm deep
indigo to soft violet gradient background, centered composition: a small warm
glowing orb (representing an AI companion) hovering gently above a neat subtle
grid of tiny rounded squares (home screen icons), one grid square softly lifting
up and turning into a light bubble, soft ambient glow, elegant, premium, quiet
intelligence feeling, generous padding, no text, no letters, no watermark
```

**落地要求**：主前景元素（光点+网格）重绘为矢量（SVG→VectorDrawable），置于安全区内（中心 66%）；背景 = 靛紫渐变（`#3B3B98 → #6C5CE7` 为基线，随主题可微调）；另出 monochrome 层（纯轮廓，Android 13+ 主题图标）；通知图标用单色光点。

## 5. 动效规范

- 页面转场：sharedAxisX（同级 Tab 淡切），容器变换（卡片→详情）。
- AI 相关：新 App 上图标从对话页"飞入"桌面（shared element）；桌宠出现 = 缩放+弹性淡入。
- 全部动效可关（设置-无障碍-减少动效 → 全局 duration=0）。

## 6. 可用性验收检查清单（M1 走查逐条过）

- [ ] 01-product §4 表格全部条目实测通过（导航/单手/手势/反馈/文字/空态/错误/一致性/无障碍/打断恢复）。
- [ ] 冷启动到输入框可打字 <1s（Baseline Profile 生效，11 篇测量法）。
- [ ] 任意页面断网：有缓存则可用 + 顶部细条提示；操作入队不丢失。
- [ ] 桌面 50 个图标 + 3 桌宠滚动/拖拽无掉帧（GPU 渲染分析无红条）。
- [ ] 深色模式全页面无对比度问题；动态取色开启后主题包正确覆盖优先级（用户主题 > 动态取色 > 默认）。
