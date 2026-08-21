---
name: app-dev
description: Daily webOS App 开发规范全集——创建、修改、素材、数据保存、自测。涉及任何 App 相关工作（用户说"做/改一个 App、创建应用、粘贴 HTML、App 数据保存"）时先读本 skill 再动手。
---

# Daily webOS App 开发规范（app-dev）

> 本 skill 是 App 相关工作的唯一权威规范。动手前先通读，避免踩「版本库快照」「素材路径」等经典坑。

## 1. 创建 App 的正确姿势（2026-08-14 起唯一路径）

**文件夹即 App——AI 自己创建文件夹，系统自动初始化与注册（已删除 create_webos_app 工具）**

```
agent_fs_mkdir apps/我的应用/        # 系统自动写 index.html 骨架并注册（桌面出现 App）
agent_fs_write apps/我的应用/index.html  # 写入完整代码（系统自动发布新版本并 push，立即生效）
```

- **文件夹名可以是中文等任意 Unicode 名称**（`apps/无限跑酷/`、`apps/待办清单/` 都可以），系统以文件夹名为 App 名称。
- 系统会在 mkdir 命中 `apps/<名字>/` 时**自动写入骨架 index.html**（"新 App 已就绪"占位页），你只需覆盖它写完整内容。
- **用户粘贴的 HTML**：同样走文件夹方式——`agent_fs_mkdir apps/<名字>/` + `agent_fs_write apps/<名字>/index.html` 原样写入（或最小包装成完整文档），不要重写用户代码，也不要声称做不到。
- **图标**：`agent_fs_write apps/<名字>/icon.svg`（128×128 圆角渐变 SVG，无脚本/外链），系统自动显示。
- **素材**：生成后放进 `apps/<名字>/assets/`（`generate_image` 的 `output_dir` 可直接指定，或 `agent_fs_copy` 复制），HTML 里用相对路径 `assets/xxx.png` 引用。
- **注册即时生效**：mkdir 后系统立即注册（无需等刷新）；写入 index.html 后系统立即校验并发布新版本，前端自动刷新桌面。

## 2. 修改 App：html 与素材是两个世界（核心心智，2026-08-13 起已即时化）

| 改什么 | 怎么改 | 生效方式 |
|---|---|---|
| **index.html**（App 代码） | `agent_fs_write` / `agent_fs_edit` 直接改 `apps/<appId>/index.html` | **立即生效**：系统自动校验→发布新版本→push `app_updated`（前端自动刷新桌面/商店；用户打开 App 即新版，无需手动刷新） |
| **素材**（图片/视频/CSS/JS 文件） | 写/复制到 `apps/<appId>/` 任意相对路径 | 立即生效（素材不走版本库，磁盘即真源） |
| 想显式建版本 | `update_webos_app`（传完整 HTML） | 立即生效（等效） |

- **不要**用文件夹重建已有 App 会丢历史——修改已有 App 请直接改它自己的文件夹（`apps/<appId>/index.html`），不要新建同名文件夹；也不要改完文件后告诉用户"刷新才能看到"（已即时化）。
- 系统 App（`system.desktop`、`system.store`、`system.trash`）也可用同样方式改形态，但保持核心交互（长按菜单、DesktopSDK 契约）不破坏。
- 改完**必须自测**：调用 `inspect_webos_app` 确认 `mirror: "clean"`（工作区文件与 active 版本一致）且 `syntaxOk: true`。

## 3. 素材生成与放置流程

- 小图标/装饰：内联 SVG 或 CSS 画，**不必生图**。
- 大图/复杂素材：`generate_image`（可指定 `output_dir: "apps/<appId>/assets/"` 直接落盘）或生成后 `agent_fs_copy` 复制进去。
- 视频：`generate_video`（产物自动进公开目录 + 工作区 `agent/videos/`），复制到 App 文件夹供 `<video>` 引用。
- 引用：HTML 里一律**相对路径**（`assets/xxx.png`、`css/style.css`）——运行时 `<base>` 自动指向 App 文件端点，无需绝对 URL。
- 图片做 AI 处理（抠图/裁剪/精灵图）：`edit_image` / `edit_video`，产物复制进 App 文件夹。

## 4. App 数据保存（用户数据不丢的关键）

- **小数据（<100KB，配置/进度/文本）**：`localStorage`——系统自动持久化到 `app.storage.private`（sandbox polyfill），**不要用 IndexedDB**（沙箱 opaque origin 不持久，退出必丢）。
- **图片/大文件（≥100KB）**：`window.DailyWebOs.fs.write('assets/xxx.png', base64)` 写入 App 文件夹（磁盘持久、AI 可读、raw 端点免鉴权可显示）。
- 首次启动可能读不到已存数据（服务端 hydrate 异步）——**监听 `storage` 事件**（数据到达会派发）刷新 UI，或读取后 fallback 默认值。
- 大对象写入失败要提示用户（不要静默）。
- 实现"保存/记住"需求后，自测：添加 → 关掉重开 → 数据还在。

## 4.5 App 数据出口（api 包：让 AI 能读到 App 数据，2026-08-21 W2/W3 上线）

> **为什么需要**：AI 无法直接读 App 的私有存储（隐私边界）。要让 AI 回答"我在 App 里记了什么/进度如何"，必须在 `packages/<id>/` 建 **api 包**，系统会把端点注册为 `appapi_<namespace>_<endpoint>` 工具，AI 在对话里调用即可读数据。

```
agent_fs_mkdir packages/zz-notes/                    # id 全局唯一（建议前缀你的标识）
agent_fs_write packages/zz-notes/daily.pkg.json      # {"schema_version":2,"id":"zz-notes","type":"api","version":"1.0.0","api":{"spec":"api.json"}}
agent_fs_write packages/zz-notes/api.json            # namespace + endpoints（name/method/path/handler/storage）
agent_fs_write packages/zz-notes/handlers/list.js    # handler：main(ctx) { ctx.storage.get/set/del; ctx.http; ctx.secrets }
```

- **api.json 要点**：`namespace` 唯一；每个 endpoint 声明 `name / method(GET=只读,POST=有副作用) / path / handler(相对路径) / storage.read / storage.write`（**严格最小范围**，只有声明过的前缀才可读写）；可加 `visibility: "public"`（W3 后他人可调用）。
- **handler 写法**：`async function main(ctx) { const rows = await ctx.storage.get('notes') || []; return { ok: true, rows } }`；结果自动截断 ≤64KB。
- **生效时序**：写文件后系统自动校验 → 通过注册+建版本（`agent_fs_write` 结果里的 ⚠️ 是人话错误，按提示修正）；**`appapi_*` 工具在下一轮对话/重建会话后注入**——本轮告诉用户"已建好，下条消息我就能读了"，然后下轮调用验证。
- **常见坑**：manifest 的 `id` 必须与文件夹名一致；api.json 必须通过契约校验（缺 name/method/handler 会被拒）；handler 里不要硬编码密钥（上架会扫描拒绝，密钥走 api.json secrets + ctx.secrets）。
- **关联**：AI 做好 App 后**主动补一致 api 包**（list/add/delete 三端点足够大多数场景），这样用户后续问数据时你能直接答。

## 5. App 内 SDK 能力（写进 HTML 就能用）

- `DailyWebOs.apps.open('appId')`：跳转另一个 App。
- `DailyWebOs.http.get/post`：外部 API 代理（天气/新闻/实时数据类 App；禁 SSRF 源）。
- `DailyWebOs.api.register/call`：App 间互联互通（A 调 B 的 handler）。
- `DailyWebOs.fs.write/read/list`：App 文件夹文件读写（素材/导出）。
- `window.__dailyWebOsApiHandlers`：注册供其他 App 调用的 handler。
- localStorage 数据由系统自动持久化，不要自己 fetch 存储接口。

## 6. 常见坑（血泪清单）

1. **改文件 ≠ 没生效**：以前改工作区文件要等 bootstrap 懒同步（用户看到旧版）；2026-08-13 起已即时化——若你仍发现不生效，先 `inspect_webos_app` 看 `mirror` 状态。
2. **canvas 污染**：sandbox iframe 里对本地素材 `getImageData` 可能抛 SecurityError（CORS）——图片加 `crossOrigin`，像素读取 try/catch 兜底，加载加超时放行（缺图不卡死）。
3. **`__APP_ID__` 占位**：骨架/模板里的 `__APP_ID__` 是占位符——文件夹方式注册时系统自动替换为真实 appId；手工复制模板时记得替换。
4. **localStorage polyfill**：sandbox opaque origin 原生 localStorage 会抛 SecurityError——系统已注入 polyfill，直接使用即可；但**不能用 IndexedDB**（见 §4）。
5. **不要用外部 URL**：静态 App 禁止外链资源（验证会拒绝 `https?://`、iframe、data:text/html）。
6. **版本不可变**：每次修改产生新版本，历史保留可回滚——改砸了让用户/你在对话里回滚即可，不要慌。
7. **素材不进版本**：改素材不产生新版本（磁盘即真源）；只有改 index.html 才建版本。
8. **分享/商店**：商店 = `publish_webos_app`（进商店列表）；分享给朋友 = `POST /webos/api/share/app`（ap- 链接，不进商店）。两者都自动归档素材。

## 7. 自测清单（交付前必做）

1. `inspect_webos_app` → `mirror: "clean"` + `syntaxOk: true`。
2. 素材文件都在 App 文件夹内且 HTML 相对路径正确（`files` 列表核对）。
3. 数据保存逻辑（localStorage/fs）已实现并有兜底。
4. 加载流程有超时/降级（不会永久卡 loading）。
5. 告知用户"已完成，刷新桌面/打开 App 即可看到"（新版本已自动生效）。
