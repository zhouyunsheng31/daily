// ============================================================================
// 系统应用商店 v1 参考实现（system.store App 初始版本）— 2026-08-09 沉浸式重做
// ----------------------------------------------------------------------------
// 移动端商店 v2：无顶部栏（宿主壳层顶栏已删除，返回按钮由商店自己渲染，
// AI 可改）。核心三件事：
//   1) 体验：点卡片主体 → 全屏运行快照（sandbox iframe + 安装按钮）
//   2) 下载：每张卡片大号「获取」按钮（→ 安装中 → 已安装/打开）
//   3) 浏览：搜索 + 最新/最热 tab + 特色横滑卡片 + 双列应用网格
//
// 设计说明（AI 改商店必读）：
// - 视觉走 :root CSS 变量（design skill「安静浅色」tokens），换肤改变量即可。
// - 商店数据全部来自宿主 StoreSDK（纯 postMessage 双向直连）：
//     StoreSDK.list({q,sort}) / get(id) / install(id) / share(id) / exportUrl(id)
//     StoreSDK.my() / myApps() / publish(appId, description) / unpublish(shareId)
//     StoreSDK.system.back() / system.openApp(appId)
// - 预览用 sandbox="allow-scripts" iframe srcdoc（宿主已注入 localStorage polyfill）；
//   <base> 指向 /webos/api/store/apps/<id>/raw/ 让相对路径素材（assets/xxx.png）可加载。
// - 版本化：本文件是「参考样貌」，AI 改砸了可回滚或参考本结构复原。
// ============================================================================

export const WEBOS_STORE_V1_HTML = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover">
<title>市场</title>
<style>
  :root {
    /* 平台 design tokens（与 Shell/AI 对话页同一套，禁止自造色系） */
    --board: #e8e4db; --paper: #f8f7f3;
    --paper-strong: #fffefa; --paper-muted: #efede7;
    --ink: #171918; --ink-soft: #424740; --muted: #71756f; --muted-light: #a1a49e;
    --blue: #315bd6; --blue-soft: #e6eafa; --green: #376b53;
    --line: rgba(23, 25, 24, .10);
    --shadow-sm: 0 8px 22px rgba(50, 44, 34, .06);
    --radius: 18px;
  }
  * { margin: 0; padding: 0; box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
  html, body { height: 100%; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "SF Pro SC", "PingFang SC",
      "HarmonyOS Sans SC", "MiSans", "Segoe UI", Roboto, sans-serif;
    background: linear-gradient(168deg, var(--paper) 0%, var(--board) 100%);
    color: var(--ink); overflow-y: auto; -webkit-overflow-scrolling: touch;
  }
  /* ============ 头部（内容流内，非固定顶栏；返回按钮 AI 可改） ============ */
  .store-head {
    display: flex; align-items: center; gap: 10px;
    padding: max(env(safe-area-inset-top), 18px) 16px 2px;
  }
  .store-head .back {
    width: 34px; height: 34px; border: none; border-radius: 50%;
    background: rgba(255,255,255,0.85); box-shadow: var(--shadow-sm);
    color: var(--ink); font-size: 18px; line-height: 1;
    display: grid; place-items: center; cursor: pointer; flex-shrink: 0;
  }
  .store-head .back:active { transform: scale(0.92); }
  .store-head h1 { font-size: 26px; font-weight: 800; letter-spacing: -0.5px; flex: 1; min-width: 0; }
  .store-head .sub { font-size: 11px; color: var(--muted); font-weight: 500; margin-top: 1px; }
  /* 搜索 */
  .search-wrap { padding: 12px 16px 2px; }
  #search {
    width: 100%; padding: 11px 16px; border: 0; border-radius: 14px;
    font-size: 13px; background: rgba(255,255,255,0.92); outline: none;
    box-shadow: var(--shadow-sm); color: var(--ink);
  }
  #search::placeholder { color: var(--muted-light); }
  /* 最新 / 最热 tab */
  .tabs { display: flex; gap: 8px; padding: 12px 16px 4px; }
  .tab {
    border: 0; border-radius: 999px; padding: 8px 16px; font-size: 12.5px; font-weight: 600;
    background: rgba(255,255,255,0.6); color: var(--muted); cursor: pointer;
    transition: all 0.15s ease;
  }
  .tab.active { background: var(--blue); color: #fff; box-shadow: 0 4px 12px rgba(49,91,214,.28); }
  .tab:active { transform: scale(0.95); }
  /* ============ 特色横滑（体验入口） ============ */
  .featured { padding: 10px 0 2px; }
  .featured-scroll {
    display: flex; gap: 12px; overflow-x: auto; padding: 4px 16px 10px;
    scroll-snap-type: x mandatory; scrollbar-width: none;
  }
  .featured-scroll::-webkit-scrollbar { display: none; }
  .hero {
    flex: 0 0 76%; scroll-snap-align: start;
    background: rgba(255, 254, 250, 0.86); border: 1px solid rgba(255,255,255,0.88);
    border-radius: 20px; padding: 16px; box-shadow: var(--shadow-sm);
    display: flex; flex-direction: column; gap: 10px; cursor: pointer;
    transition: transform 0.12s ease;
  }
  .hero:active { transform: scale(0.98); }
  .hero .top { display: flex; gap: 12px; align-items: center; }
  .hero .icon { width: 64px; height: 64px; border-radius: 18px; overflow: hidden; background: #fff; box-shadow: 0 4px 12px rgba(50,44,34,0.14); flex-shrink: 0; display: grid; place-items: center; }
  .hero .icon img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .hero .icon .ph { font-size: 28px; font-weight: 800; color: #fff; }
  .hero .nm { font-size: 15px; font-weight: 700; line-height: 1.25; }
  .hero .meta { font-size: 10px; color: var(--muted); }
  .hero .desc { font-size: 11.5px; color: var(--ink-soft); line-height: 1.5; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
  .hero .ops { display: flex; gap: 8px; margin-top: auto; }
  /* ============ 应用网格（双列，下载按钮直观） ============ */
  .section-label { padding: 14px 16px 8px; font-size: 14px; font-weight: 700; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; padding: 2px 16px calc(96px + env(safe-area-inset-bottom)); }
  .card {
    display: flex; flex-direction: column; gap: 8px; padding: 13px;
    background: rgba(255, 254, 250, 0.86); border-radius: var(--radius); box-shadow: var(--shadow-sm);
    border: 1px solid rgba(255,255,255,0.88); cursor: pointer;
    transition: transform 0.12s ease;
  }
  .card:active { transform: scale(0.97); }
  .card .icon { width: 58px; height: 58px; border-radius: 16px; overflow: hidden; background: #fff; box-shadow: 0 3px 10px rgba(50,44,34,0.12); display: grid; place-items: center; }
  .card .icon img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .card .icon .ph { font-size: 26px; font-weight: 800; color: #fff; }
  .card .name { font-size: 13px; font-weight: 700; line-height: 1.25; }
  .card .meta { font-size: 10px; color: var(--muted); }
  .card .desc {
    font-size: 11px; color: var(--ink-soft); line-height: 1.5; min-height: 32px;
    display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
  }
  .card .ops { display: flex; align-items: center; gap: 6px; margin-top: 2px; }
  .install {
    flex: 1; height: 32px; border: 0; border-radius: 999px;
    background: var(--blue); color: #fff; font-size: 12.5px; font-weight: 700;
    cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 4px;
    transition: all 0.15s ease;
  }
  .install:active { transform: scale(0.95); }
  .install[disabled] { opacity: 0.65; }
  .install.done { background: rgba(49,91,214,0.12); color: var(--blue); }
  .install.open { background: rgba(55,107,83,0.14); color: #2d5c45; }
  .share-btn {
    width: 32px; height: 32px; border: 0; border-radius: 50%;
    background: rgba(255,255,255,0.92); box-shadow: 0 2px 8px rgba(50,44,34,0.08);
    display: grid; place-items: center; cursor: pointer; flex-shrink: 0;
  }
  .share-btn:active { transform: scale(0.92); }
  .share-btn svg { width: 15px; height: 15px; fill: none; stroke: var(--muted); stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
  /* ============ 底部悬浮工具条（发布/我的发布，非顶栏） ============ */
  .bottom-bar {
    position: fixed; left: 50%; bottom: max(env(safe-area-inset-bottom), 16px);
    transform: translateX(-50%); z-index: 20;
    display: flex; gap: 6px; padding: 6px;
    background: rgba(255, 254, 250, 0.8); border: 1px solid rgba(255,255,255,0.92);
    border-radius: 999px; box-shadow: 0 10px 30px rgba(50,44,34,0.16);
    backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px);
  }
  .bottom-bar button {
    height: 38px; padding: 0 18px; border: 0; border-radius: 999px;
    font-size: 12.5px; font-weight: 600; cursor: pointer;
  }
  .bottom-bar .primary { background: var(--blue); color: #fff; }
  .bottom-bar .quiet { background: rgba(255,255,255,0.92); color: var(--ink); }
  .bottom-bar button:active { transform: scale(0.95); }
  /* ============ 工作区空间条（2026-08-12：应用占内存 + 剩余空间提示） ============ */
  /* 2026-08-08 顶部布局优化：空间条移到 tabs 下方，改轻量胶囊，顶部不再拥挤 */
  .space-bar {
    margin: 2px 18px 10px;
    display: flex; align-items: center; justify-content: space-between; gap: 8px;
    font-size: 11px; color: var(--muted);
    background: rgba(255,255,255,0.55); border-radius: 12px; padding: 7px 13px;
  }
  .space-bar b { color: var(--blue); font-weight: 700; }
  .space-bar .warn { color: var(--red, #a54b49); font-weight: 700; }
  .empty { text-align: center; color: var(--ink-soft); padding: 48px 0 60px; font-size: 13px; line-height: 1.8; }
  .empty strong { display: block; font-size: 15px; color: var(--ink); margin-bottom: 4px; }
  /* ============ 技能（2026-08-09：市场「技能」页签，单列卡片） ============ */
  .skill-card {
    display: flex; align-items: center; gap: 12px; padding: 13px 14px;
    background: rgba(255, 254, 250, 0.86); border-radius: var(--radius); box-shadow: var(--shadow-sm);
    border: 1px solid rgba(255,255,255,0.88); margin-bottom: 10px;
    transition: transform 0.12s ease;
  }
  .skill-card:active { transform: scale(0.98); }
  .skill-icon { width: 46px; height: 46px; border-radius: 14px; overflow: hidden; background: #fff; box-shadow: 0 3px 10px rgba(50,44,34,0.12); flex-shrink: 0; display: grid; place-items: center; }
  .skill-icon img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .skill-body { flex: 1; min-width: 0; }
  .skill-name { font-size: 13.5px; font-weight: 700; line-height: 1.25; }
  .skill-desc {
    font-size: 11px; color: var(--ink-soft); line-height: 1.5; margin-top: 3px;
    display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
  }
  .skill-meta { font-size: 10px; color: var(--muted); margin-top: 3px; }
  .skill-card .install { flex: 0 0 auto; width: auto; min-width: 64px; padding: 0 14px; }
  .skill-tip {
    margin: 4px 18px 12px; padding: 9px 13px; border-radius: 12px;
    background: rgba(255,255,255,0.55); color: var(--muted); font-size: 10.5px; line-height: 1.65;
  }
  .skill-tip b { color: var(--ink-soft); }
  /* ============ 统一包市场（2026-08-21，W3 R14：万物皆可包） ============ */
  .mkt-row { display: none; align-items: center; gap: 8px; margin: 4px 18px 12px; }
  .mkt-chips { display: flex; gap: 6px; overflow-x: auto; scrollbar-width: none; flex: 1; }
  .mkt-chips::-webkit-scrollbar { display: none; }
  .mkt-chip { flex: 0 0 auto; border: 0; border-radius: 999px; padding: 7px 13px; font-size: 12px; font-weight: 600; background: rgba(255,255,255,.65); color: var(--muted); cursor: pointer; }
  .mkt-chip.active { background: var(--blue); color: #fff; box-shadow: 0 4px 12px rgba(49,91,214,.24); }
  .mkt-mine { flex: 0 0 auto; border: 0; border-radius: 999px; padding: 7px 12px; font-size: 11px; font-weight: 600; background: rgba(255,255,255,.8); color: var(--ink); box-shadow: var(--shadow-sm); cursor: pointer; }
  .mkt-tag { display: inline-block; font-size: 9px; font-weight: 800; border-radius: 6px; padding: 1px 6px; margin-right: 5px; vertical-align: 1px; }
  .mkt-tag-api { color: #3f5dd0; background: rgba(76,111,255,.14); }
  .mkt-tag-skill { color: #0a7d3c; background: rgba(16,168,91,.14); }
  .mkt-tag-theme { color: #a97f3f; background: rgba(212,156,19,.15); }
  .mkt-tag-toolpkg { color: #6b5ba8; background: rgba(107,91,168,.14); }
  .mkt-tag-app { color: #c2443f; background: rgba(194,68,63,.12); }
  .mkt-tag-bundle, .mkt-tag-subagent, .mkt-tag-mcp { color: #3f6f6f; background: rgba(63,111,111,.13); }
  /* ============ 发布弹层：应用/技能 切换（2026-08-18） ============ */
  .publish-tabs { display: flex; gap: 6px; margin-bottom: 12px; }
  .publish-tabs .pubtab {
    flex: 1; border: 0; border-radius: 999px; padding: 9px 12px;
    font-size: 12.5px; font-weight: 600; cursor: pointer;
    background: rgba(255,255,255,0.6); color: var(--muted); transition: all 0.15s ease;
  }
  .publish-tabs .pubtab.active { background: var(--blue); color: #fff; box-shadow: 0 4px 12px rgba(49,91,214,.28); }
  .publish-tabs .pubtab:active { transform: scale(0.96); }
  .apppick .stat { margin-left: auto; }
  .apppick .installed-tag {
    flex: 0 0 auto; font-size: 12px; font-weight: 600;
    background: var(--paper-muted); color: var(--muted); border-radius: 999px; padding: 4px 10px;
  }
  /* ============ 加载/提示 ============ */
  .loading { text-align: center; color: var(--ink-soft); padding: 36px 0; font-size: 12px; }
  .toast {
    position: fixed; left: 50%; bottom: 22px; transform: translateX(-50%);
    background: rgba(28,35,51,0.92); color: #fff; padding: 9px 16px; border-radius: 999px;
    font-size: 12px; z-index: 60; opacity: 0; transition: opacity 0.25s; max-width: 84vw; text-align: center;
  }
  .toast.show { opacity: 1; }
  /* ============ 效果预览（全屏运行快照，体验核心） ============ */
  #preview-overlay {
    position: fixed; inset: 0; z-index: 40; display: none; flex-direction: column;
    background: #0f1218;
  }
  #preview-overlay.show { display: flex; }
  .preview-bar {
    display: flex; align-items: center; gap: 10px;
    padding: max(env(safe-area-inset-top), 10px) 14px 10px;
    color: #fff; background: rgba(15,18,24,0.96);
  }
  .preview-bar .back {
    width: 34px; height: 34px; border-radius: 11px; border: 0;
    background: rgba(255,255,255,0.14); color: #fff; font-size: 18px; cursor: pointer;
  }
  .preview-bar .info { flex: 1; min-width: 0; display: flex; align-items: center; gap: 10px; }
  .preview-bar .picon { width: 36px; height: 36px; border-radius: 10px; overflow: hidden; background: #fff; flex-shrink: 0; display: grid; place-items: center; }
  .preview-bar .picon img { width: 100%; height: 100%; object-fit: cover; }
  .preview-bar .picon .ph { font-size: 16px; font-weight: 800; color: #fff; }
  .preview-bar .ptext { min-width: 0; }
  .preview-bar .nm { font-size: 14px; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .preview-bar .owner { font-size: 10px; color: rgba(255,255,255,0.55); }
  .preview-bar .install { flex-shrink: 0; }
  .preview-frame { flex: 1; border: 0; width: 100%; background: #fff; }
  .preview-loading {
    position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
    color: rgba(255,255,255,0.6); font-size: 12px; background: #0f1218; z-index: 1;
  }
  /* ============ 底部弹层（发布/我的发布） ============ */
  .overlay { position: fixed; inset: 0; background: rgba(50,44,34,0.45); z-index: 30; display: none; align-items: flex-end; justify-content: center; }
  .overlay.show { display: flex; }
  /* 2026-08-16 发布页最高遮盖层：发布弹层独立 z-index:50（高于预览 preview-overlay z40 与
     「我的」层 z30，低于 toast z60），避免从「我的」进入发布时被同级遮盖、保证发布是最高操作层。
     id 选择器优先级高于 .overlay 类，只对发布弹层生效。 */
  #publish-overlay { z-index: 50; }
  .sheet {
    width: 100%; max-width: 480px; background: var(--paper); border-radius: 20px 20px 0 0;
    padding: 16px 16px calc(20px + env(safe-area-inset-bottom)); max-height: 74vh; overflow-y: auto;
  }
  .sheet h2 { font-size: 16px; margin-bottom: 12px; }
  .apppick { display: flex; align-items: center; gap: 8px; padding: 10px 12px; margin-bottom: 8px; background: var(--paper-strong); border-radius: 12px; box-shadow: 0 2px 8px rgba(50,44,34,0.06); cursor: pointer; }
  .apppick.active { outline: 2px solid var(--blue); }
  .apppick .icon { width: 34px; height: 34px; border-radius: 10px; overflow: hidden; background: #fff; flex-shrink: 0; display: grid; place-items: center; }
  .apppick .icon img { width: 100%; height: 100%; object-fit: cover; }
  .apppick .icon .ph { font-size: 14px; font-weight: 800; color: #fff; }
  .apppick .nm { flex: 1; font-size: 13px; font-weight: 600; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  #pub-desc { width: 100%; padding: 10px 12px; border: 0; border-radius: 12px; font-size: 12px; resize: none; min-height: 60px; background: #fff; outline: none; }
  .sheet .row { display: flex; gap: 8px; margin-top: 12px; }
  .sheet .row .btn { flex: 1; padding: 11px; font-size: 13px; }
  .btn {
    border: 0; border-radius: 999px; padding: 8px 14px; font-size: 12px; font-weight: 600;
    background: rgba(255,255,255,0.9); color: var(--ink); box-shadow: var(--shadow-sm);
    cursor: pointer;
  }
  .btn.primary { background: var(--blue); color: #fff; }
  .btn:active { transform: scale(0.95); }
  .btn[disabled] { opacity: 0.5; }
  .stat { font-size: 10px; color: var(--ink-soft); }
  /* ============ 「我的」个人主页（2026-08-09 重设计：底部只留一个入口） ============ */
  .mine-stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-bottom: 12px; }
  .mine-stat { background: var(--paper-strong); border-radius: 12px; padding: 10px 6px; text-align: center; box-shadow: 0 2px 8px rgba(50,44,34,0.06); }
  .mine-stat b { display: block; font-size: 17px; font-weight: 800; letter-spacing: -0.02em; }
  .mine-stat span { font-size: 10px; color: var(--muted); }
  .mine-section { font-size: 13px; font-weight: 700; margin: 4px 0 8px; }
  @media (prefers-reduced-motion: reduce) {
    .hero, .card, .tab, .install, .share-btn, .btn { transition: none; }
  }
</style>
</head>
<body>

<!-- 头部（内容流内：返回 + 标题，AI 可改） -->
<div class="store-head">
  <button class="back" id="btn-back" aria-label="返回桌面">‹</button>
  <div style="min-width:0">
    <h1>市场</h1>
    <div class="sub">应用 · 技能 · 安装</div>
  </div>
</div>
<div class="search-wrap"><input id="search" placeholder="搜索应用…" autocomplete="off" aria-label="搜索应用"></div>
<div class="tabs">
  <button class="tab active" data-sort="latest" id="tab-latest">最新</button>
  <button class="tab" data-sort="hot" id="tab-hot">最热</button>
  <button class="tab" data-sort="skills" id="tab-skills">技能</button>
  <button class="tab" data-sort="market" id="tab-market">市场</button>
</div>
<!-- 2026-08-21（W3 统一包市场 R14）：type 维度（api/skill/theme/…）+ App 只读适配 -->
<div class="mkt-row" id="mkt-row">
  <div class="mkt-chips" id="mkt-chips">
    <button class="mkt-chip active" data-type="">全部</button>
    <button class="mkt-chip" data-type="api">API</button>
    <button class="mkt-chip" data-type="skill">技能</button>
    <button class="mkt-chip" data-type="theme">主题</button>
    <button class="mkt-chip" data-type="toolpkg">工具包</button>
    <button class="mkt-chip" data-type="app">App</button>
  </div>
  <button class="mkt-mine" id="mkt-mine">我的安装</button>
</div>
<!-- 2026-08-12 工作区空间提示：应用安装会占用工作区空间，空间不足无法安装 -->
<div class="space-bar" id="space-bar"><span>工作区剩余</span><span id="space-free">…</span></div>

<!-- 特色横滑（最新/最热前 2 个，大卡片体验入口） -->
<div class="featured" id="featured-wrap">
  <div class="featured-scroll" id="featured"></div>
</div>

<div class="section-label" id="section-label">全部应用</div>
<main class="grid" id="list"></main>
<div class="empty" id="empty" style="display:none">
  <strong>市场空空如也</strong>
  逛一逛技能，或者点底部「我的」发布你的第一个 App
</div>

<!-- 底部悬浮工具条（市场是逛的地方：唯一入口「我的」→ 个人主页里发布/管理） -->
<div class="bottom-bar">
  <button class="primary" id="btn-mine">我的</button>
</div>

<!-- 效果预览（全屏，体验核心） -->
<div id="preview-overlay">
  <div class="preview-bar">
    <button class="back" id="preview-back" aria-label="返回">‹</button>
    <div class="info">
      <div class="picon" id="preview-icon"></div>
      <div class="ptext"><div class="nm" id="preview-name"></div><div class="owner" id="preview-owner"></div></div>
    </div>
    <button class="btn primary install" id="preview-install" style="width:auto">安装</button>
  </div>
  <div class="preview-loading" id="preview-loading">正在加载预览…</div>
  <iframe class="preview-frame" id="preview-frame" sandbox="allow-scripts" title="应用预览"></iframe>
</div>

<!-- 2026-08-21 包市场详情（统一包市场 R14） -->
<div class="overlay" id="market-overlay">
  <div class="sheet">
    <h2 id="mkt-title">包详情</h2>
    <div id="mkt-detail"></div>
    <div class="row">
      <button class="btn" id="mkt-close">关闭</button>
      <button class="btn primary" id="mkt-install">安装</button>
    </div>
  </div>
</div>

<!-- 发布弹层（从「我的」进入；应用/技能 双 tab） -->
<div class="overlay" id="publish-overlay">
  <div class="sheet">
    <h2>发布到市场</h2>
    <div class="publish-tabs" id="publish-tabs">
      <button class="pubtab active" id="pubtab-app">应用</button>
      <button class="pubtab" id="pubtab-skill">技能</button>
    </div>
    <div id="myapps"></div>
    <div id="myskills" style="display:none"></div>
    <textarea id="pub-desc" placeholder="介绍它（可选，一句话说明它是做什么的）"></textarea>
    <div class="row">
      <button class="btn" id="pub-cancel">取消</button>
      <button class="btn primary" id="pub-confirm">发布</button>
    </div>
  </div>
</div>

<div class="overlay" id="my-overlay">
  <div class="sheet">
    <h2>我的</h2>
    <div class="mine-stats" id="mine-stats"></div>
    <div class="mine-section">我的应用发布</div>
    <div id="my-list"></div>
    <div class="mine-section">我的技能发布</div>
    <div id="my-skill-list"></div>
    <div class="row">
      <button class="btn primary" id="btn-publish">发布到市场</button>
      <button class="btn" id="my-close" style="flex:1">关闭</button>
    </div>
  </div>
</div>

<div class="toast" id="toast"></div>

<script>
(function () {
  'use strict'
  var CHANNEL = 'daily-webos-store'
  var pending = {}
  var seq = 0
  function call(method, params) {
    return new Promise(function (resolve, reject) {
      var id = 'r' + (++seq)
      pending[id] = { resolve: resolve, reject: reject }
      window.parent.postMessage({ channel: CHANNEL, kind: 'request', requestId: id, method: method, params: params || {} }, '*')
      setTimeout(function () { if (pending[id]) { delete pending[id]; reject(new Error('timeout')) } }, 20000)
    })
  }
  window.addEventListener('message', function (event) {
    var data = event.data
    if (!data || data.channel !== CHANNEL || data.kind !== 'response') return
    var p = pending[data.requestId]
    if (!p) return
    delete pending[data.requestId]
    if (data.ok) p.resolve(data.data)
    else p.reject(new Error(data.error || 'store error'))
  })

  var $ = function (id) { return document.getElementById(id) }
  var toastTimer = null
  function toast(msg) {
    var el = $('toast'); el.textContent = msg; el.classList.add('show')
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { el.classList.remove('show') }, 2200)
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '"')
  }
  // 渐变首字母（无图标时的占位，颜色按名称哈希稳定分配——平台色板）
  var PH_COLORS = ['#315bd6', '#376b53', '#a54b49', '#a97f3f', '#6b5ba8', '#3f6f6f', '#6b7070', '#5d8a76']
  function phColor(name) {
    var n = 0
    for (var i = 0; i < name.length; i++) n = (n * 31 + name.charCodeAt(i)) >>> 0
    return PH_COLORS[n % PH_COLORS.length]
  }
  function phSvgUri(name) {
    var letter = esc(name.slice(0, 1).toUpperCase())
    var color = phColor(name)
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128"><rect width="128" height="128" rx="28" fill="' + color + '"/><text x="64" y="87" font-size="62" font-weight="800" text-anchor="middle" fill="#fff" font-family="sans-serif">' + letter + '</text></svg>'
    return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg)
  }
  // 图标：真实 icon 优先（data:/URL 直接、SVG 字符串 → data URI），失败降级首字母渐变
  function iconHtml(item) {
    var name = item.name || '?'
    var fallbackUri = phSvgUri(name)
    if (item.icon) {
      if (item.icon.indexOf('data:') === 0 || item.icon.indexOf('/webos/api/') === 0) {
        return '<img src="' + esc(item.icon) + '" alt="" loading="lazy" onerror="this.src=\\'' + fallbackUri + '\\'">'
      }
      return '<img src="data:image/svg+xml;utf8,' + encodeURIComponent(item.icon) + '" alt="" loading="lazy" onerror="this.src=\\'' + fallbackUri + '\\'">'
    }
    return '<img src="' + fallbackUri + '" alt="">'
  }
  // 安装按钮（下载核心）：未安装=「获取」主色；已安装=「已安装」；可打开=「打开」
  function installBtnHtml(item) {
    var id = esc(item.id)
    if (item.installed) {
      if (item.appId) {
        return '<button class="install open" data-act="open" data-id="' + id + '">打开</button>'
      }
      return '<button class="install done" data-act="install" data-id="' + id + '" disabled>已安装</button>'
    }
    return '<button class="install" data-act="install" data-id="' + id + '"><svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v12M6 11l6 6 6-6"/></svg>获取</button>'
  }
  function shareBtnHtml(item) {
    return '<button class="share-btn" data-act="share" data-id="' + esc(item.id) + '" aria-label="分享"><svg viewBox="0 0 24 24"><path d="M12 3v13M7 8l5-5 5 5M5 13v7a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-7"/></svg></button>'
  }

  var allItems = []
  var currentSort = 'latest'
  var currentQ = ''
  var searchTimer = null
  // 2026-08-12 工作区剩余空间（字节；列表接口返回，null=未提供）
  var freeBytes = null

  // 字节数格式化：<1KB → B；<1MB → KB；<1GB → MB；否则 GB
  function formatBytes(n) {
    if (!n || n <= 0) return ''
    if (n < 1024) return n + ' B'
    if (n < 1024 * 1024) return (n / 1024).toFixed(0) + ' KB'
    if (n < 1024 * 1024 * 1024) return (n / 1024 / 1024).toFixed(1) + ' MB'
    return (n / 1024 / 1024 / 1024).toFixed(2) + ' GB'
  }
  // 应用占用标注（HTML 快照 + 素材），未知时省略
  function sizeLabel(item) {
    var s = item.sizeBytes || 0
    return s > 0 ? ' · 占用 ' + formatBytes(s) : ''
  }
  function renderSpace() {
    var el = $('space-free')
    if (freeBytes === null || freeBytes === undefined) { el.textContent = '…'; return }
    el.textContent = formatBytes(freeBytes)
    el.classList.toggle('warn', freeBytes < 10 * 1024 * 1024)
  }

  // 渲染：特色横滑（前 2 个，搜索时隐藏）+ 全部网格
  function render(list) {
    var featured = $('featured')
    var listEl = $('list')
    featured.innerHTML = ''
    listEl.innerHTML = ''
    renderSpace()
    var showFeatured = !currentQ && list.length > 0
    $('featured-wrap').style.display = showFeatured ? 'block' : 'none'
    if (showFeatured) {
      list.slice(0, 2).forEach(function (item) {
        var hero = document.createElement('div')
        hero.className = 'hero'
        hero.setAttribute('data-id', item.id)
        hero.innerHTML =
          '<div class="top"><div class="icon">' + iconHtml(item) + '</div>' +
          '<div style="min-width:0;flex:1"><div class="nm">' + esc(item.name) + '</div>' +
          '<div class="meta">' + esc(item.ownerName || '匿名') + ' · ' + (item.installs || 0) + ' 次安装' + sizeLabel(item) + '</div></div></div>' +
          '<div class="desc">' + esc(item.description || '暂无介绍') + '</div>' +
          '<div class="ops">' + installBtnHtml(item) + shareBtnHtml(item) + '</div>'
        featured.appendChild(hero)
      })
    }
    $('empty').style.display = list.length ? 'none' : 'block'
    list.forEach(function (item) {
      var card = document.createElement('div')
      card.className = 'card'
      card.setAttribute('data-id', item.id)
      card.innerHTML =
        '<div class="icon">' + iconHtml(item) + '</div>' +
        '<div class="name">' + esc(item.name) + '</div>' +
        '<div class="meta">' + esc(item.ownerName || '匿名') + ' · ' + (item.installs || 0) + ' 次安装' + sizeLabel(item) + '</div>' +
        '<div class="desc">' + esc(item.description || '暂无介绍') + '</div>' +
        '<div class="ops">' + installBtnHtml(item) + shareBtnHtml(item) + '</div>'
      listEl.appendChild(card)
    })
  }

  function load() {
    var listEl = $('list')
    listEl.innerHTML = '<div class="loading" style="grid-column:1/-1">加载中…</div>'
    call('list', { q: currentQ || undefined, sort: currentSort }).then(function (res) {
      allItems = res.items || []
      // 2026-08-12 剩余空间（应用占内存提示）
      if (typeof res.userFreeBytes === 'number') freeBytes = res.userFreeBytes
      render(allItems)
    }).catch(function (e) {
      listEl.innerHTML = '<div class="empty" style="grid-column:1/-1"><strong>加载失败</strong>' + esc(e.message || '') + '</div>'
    })
  }

  // ==========================================================================
  // 2026-08-21 统一包市场（W3 R14）：Type 维度浏览 + 详情 + 安装 + 我的安装 + App 适配
  // ==========================================================================
  function renderMarket(entries) {
    var listEl = $('list')
    listEl.innerHTML = ''
    $('empty').style.display = entries.length ? 'none' : 'block'
    entries.forEach(function (e) {
      var card = document.createElement('div')
      card.className = 'card'
      var tag = '<span class="mkt-tag mkt-tag-' + esc(e.type) + '">' + esc(e.type) + '</span>'
      card.innerHTML =
        '<div class="icon" style="background:#fff"><span class="ph" style="color:' + phColor(e.displayName || e.packageId) + ';font-size:20px;font-weight:800">' + esc((e.displayName || '?').slice(0, 1).toUpperCase()) + '</span></div>' +
        '<div class="name">' + tag + esc(e.displayName || e.packageId) + '</div>' +
        '<div class="meta">' + esc(e.owner || '系统') + ' · v' + esc(e.version || '0.0.0') + (e.endpoints ? ' · ' + e.endpoints + ' 端点' : '') + '</div>' +
        '<div class="desc">' + esc(e.description || '安装后即可使用') + '</div>' +
        '<div class="ops"><button class="install" data-act="mkt-detail" data-id="' + esc(e.packageId) + '">详情 / 安装</button></div>'
      listEl.appendChild(card)
    })
  }
  function renderMarketApps(apps) {
    var listEl = $('list')
    listEl.innerHTML = ''
    $('empty').style.display = apps.length ? 'none' : 'block'
    apps.forEach(function (a) {
      var card = document.createElement('div')
      card.className = 'card'
      card.innerHTML =
        '<div class="icon" style="background:#fff"><span class="ph" style="color:#c2443f;font-size:20px;font-weight:800">' + esc((a.name || '?').slice(0, 1).toUpperCase()) + '</span></div>' +
        '<div class="name"><span class="mkt-tag mkt-tag-app">app</span>' + esc(a.name || a.id) + '</div>' +
        '<div class="meta">' + (a.version ? 'v' + esc(a.version) : '') + (a.source ? ' · ' + esc(a.source) : '') + '</div>' +
        '<div class="desc">App 在商店「最新 / 最热」列表安装</div>' +
        '<div class="ops"><button class="install done" disabled>商店安装</button></div>'
      listEl.appendChild(card)
    })
  }
  function loadMarket(type) {
    var listEl = $('list')
    listEl.innerHTML = '<div class="loading" style="grid-column:1/-1">加载中…</div>'
    if (type === 'app') {
      call('market.apps', {}).then(function (res) { renderMarketApps((res && res.apps) || []) })
        .catch(function (e) { listEl.innerHTML = '<div class="empty" style="grid-column:1/-1"><strong>加载失败</strong>' + esc(e.message || '') + '</div>' })
      return
    }
    call('market.list', { type: type || undefined }).then(function (res) { renderMarket((res && res.entries) || []) })
      .catch(function (e) { listEl.innerHTML = '<div class="empty" style="grid-column:1/-1"><strong>加载失败</strong>' + esc(e.message || '') + '</div>' })
  }
  var mktCurrent = null
  var mktKind = 'pkg' // 'pkg' | 'app' | 'skill'（商店模板统一包市场：App/skill 也是包，走各自安装语义）
  function openMarketDetail(id) {
    mktCurrent = id
    var box = $('mkt-detail')
    box.innerHTML = '<div class="loading">加载中…</div>'
    $('market-overlay').classList.add('show')
    var btn0 = $('mkt-install')
    btn0.disabled = false
    btn0.style.display = ''
    // App 包（store:xxx）→ 老商店详情/安装；skill 包（sys-skill: / sk-）→ 技能安装
    if (id.indexOf('store:') === 0) {
      mktKind = 'app'
      var shareId = id.slice('store:'.length)
      call('get', { shareId: shareId }).then(function (res) {
        var it = (res && res.item) || {}
        var html =
          '<div style="display:flex;gap:10px;align-items:center;margin-bottom:10px">' +
          '<div class="skill-icon" style="width:44px;height:44px"><span class="ph" style="color:' + phColor(it.name || id) + ';font-size:18px;font-weight:800">' + esc((it.name || '?').slice(0, 1).toUpperCase()) + '</span></div>' +
          '<div style="min-width:0"><div class="skill-name">' + esc(it.name || id) + '</div>' +
          '<div class="skill-meta"><span class="mkt-tag mkt-tag-app">app</span>v' + esc(it.version || '1.0.0') + '</div></div></div>' +
          '<div class="skill-desc">' + esc(it.description || '可安装到你的桌面（App 包）') + '</div>' +
          '<div class="skill-meta" style="margin-top:8px">' + (it.installed ? '✅ 已安装' : '安装免费') + '</div>'
        box.innerHTML = html
        btn0.disabled = false
        btn0.textContent = it.installed ? '重新安装' : '安装'
      }).catch(function (e) { box.innerHTML = '<div class="skill-desc">' + esc(e.message || '加载失败') + '</div>' })
      return
    }
    if (id.indexOf('sys-skill:') === 0 || id.indexOf('sk-') === 0) {
      mktKind = 'skill'
      var skillRef = id.indexOf('sys-skill:') === 0 ? id.slice('sys-skill:'.length) : id
      box.innerHTML =
        '<div class="skill-desc"><strong>' + esc(skillRef) + '</strong><br>这是一个技能包：安装后 Daily 的 AI 立即可用（复制到你的 skills/）</div>'
      btn0.disabled = false
      btn0.textContent = '安装技能'
      return
    }
    mktKind = 'pkg'
    call('market.detail', { packageId: id }).then(function (res) {
      var en = (res && res.entry) || {}
      var scope = en.dataScope || {}
      var read = (scope.storage && scope.storage.read) || []
      var write = (scope.storage && scope.storage.write) || []
      var endpoints = (scope.endpoints || []).join('、')
      var isInstalled = !!(res && res.isInstalled)
      var html =
        '<div style="display:flex;gap:10px;align-items:center;margin-bottom:10px">' +
        '<div class="skill-icon" style="width:44px;height:44px"><span class="ph" style="color:' + phColor(en.displayName || id) + ';font-size:18px;font-weight:800">' + esc((en.displayName || id).slice(0, 1).toUpperCase()) + '</span></div>' +
        '<div style="min-width:0"><div class="skill-name">' + esc(en.displayName || id) + '</div>' +
        '<div class="skill-meta"><span class="mkt-tag mkt-tag-' + esc(en.type || '') + '">' + esc(en.type || '-') + '</span>v' + esc(en.version || '0.0.0') + '</div></div></div>' +
        '<div class="skill-desc">' + esc(en.description || '无简介') + '</div>'
      if (en.apiNamespace) html += '<div class="skill-meta" style="margin-top:6px">namespace：' + esc(en.apiNamespace) + '</div>'
      if (endpoints) html += '<div class="skill-meta">public 端点：' + esc(endpoints) + '</div>'
      if (read.length || write.length) html += '<div class="skill-meta">数据范围 · 读：' + esc(read.join('、') || '—') + ' / 写：' + esc(write.join('、') || '—') + '</div>'
      html += '<div class="skill-meta" style="margin-top:8px">' + (isInstalled ? '✅ 已安装' : '安装免费；api 端点按调用者计费（R15）') + '</div>'
      box.innerHTML = html
      btn0.disabled = false
      btn0.textContent = isInstalled ? '重新安装' : '安装'
    }).catch(function (e) { box.innerHTML = '<div class="skill-desc">' + esc(e.message || '加载失败') + '</div>' })
  }
  document.addEventListener('click', function (e) {
    var t = e.target
    var el = t && t.closest ? t.closest('[data-act="mkt-detail"]') : null
    if (!el) return
    openMarketDetail(el.getAttribute('data-id'))
  })
  $('mkt-close').addEventListener('click', function () { $('market-overlay').classList.remove('show') })
  $('mkt-install').addEventListener('click', function () {
    if (!mktCurrent) return
    var btn = $('mkt-install')
    btn.disabled = true
    var op
    if (mktKind === 'app') {
      // App 包：安装到桌面（老商店语义）
      op = call('install', { shareId: mktCurrent.slice('store:'.length) })
    } else if (mktKind === 'skill') {
      // 技能包：复制 SKILL.md 到用户 skills/
      var skillRef = mktCurrent.indexOf('sys-skill:') === 0 ? mktCurrent.slice('sys-skill:'.length) : mktCurrent
      op = call('skills.install', { skillId: skillRef })
    } else {
      op = call('market.install', { packageId: mktCurrent })
    }
    op.then(function (res) {
      toast((res && (res.note || res.message)) || '安装成功')
      openMarketDetail(mktCurrent)
      if (marketMode) loadMarket(marketType)
    }).catch(function (e) {
      toast('安装失败：' + (e.message || ''))
    }).finally(function () { btn.disabled = false })
  })
  Array.prototype.forEach.call($('mkt-chips').children, function (chip) {
    chip.addEventListener('click', function () {
      marketType = chip.getAttribute('data-type') || ''
      Array.prototype.forEach.call($('mkt-chips').children, function (c) { c.classList.remove('active') })
      chip.classList.add('active')
      loadMarket(marketType)
    })
  })
  $('mkt-mine').addEventListener('click', function () {
    call('market.mine', {}).then(function (res) {
      var items = (res && res.items) || []
      if (!items.length) { toast('还没有安装任何包'); return }
      toast('我的安装：' + items.map(function (i) { return i.packageId }).join('、'))
    }).catch(function (e) { toast(e.message || '我的安装加载失败') })
  })

  // 搜索：300ms 防抖 → 服务端过滤（API 支持 q 参数）
  $('search').addEventListener('input', function () {
    var q = this.value.trim().slice(0, 60)
    clearTimeout(searchTimer)
    searchTimer = setTimeout(function () {
      if (q === currentQ) return
      currentQ = q
      load()
    }, 300)
  })
  // 最新 / 最热 / 技能 tab → 服务端排序（API 支持 sort 参数）；技能页签切换为技能市场
  $('tab-latest').addEventListener('click', function () { setTab('latest') })
  $('tab-hot').addEventListener('click', function () { setTab('hot') })
  $('tab-skills').addEventListener('click', function () { setTab('skills') })
  // 2026-08-21（W3 统一包市场 R14）：「市场」页签
  $('tab-market').addEventListener('click', function () { setTab('market') })
  var marketMode = false
  var marketType = ''
  var skillsMode = false
  function setTab(tab) {
    // 2026-08-21（W3 统一包市场 R14）：「市场」页签（万物皆可包，type 维度）
    if (tab === 'market') {
      if (marketMode) return
      marketMode = true
      ;['latest', 'hot', 'skills', 'market'].forEach(function (k) { var el = $('tab-' + k); if (el) el.classList.remove('active') })
      $('tab-market').classList.add('active')
      $('search').style.display = 'block'
      $('featured-wrap').style.display = 'none'
      $('space-bar').style.display = 'none'
      $('mkt-row').style.display = 'flex'
      $('section-label').textContent = '包市场 · 万物皆可包'
      $('list').style.gridTemplateColumns = ''
      var mtip = $('skill-tip'); if (mtip) mtip.remove()
      loadMarket(marketType)
      return
    }
    marketMode = false
    $('mkt-row').style.display = 'none'
    if (tab === 'skills') {
      if (skillsMode) return
      skillsMode = true
      $('tab-skills').classList.add('active')
      $('tab-latest').classList.remove('active')
      $('tab-hot').classList.remove('active')
      // 技能模式：隐藏应用搜索/特色/空间条，列表单列
      $('search').style.display = 'none'
      $('featured-wrap').style.display = 'none'
      $('space-bar').style.display = 'none'
      $('section-label').textContent = '技能'
      $('list').style.gridTemplateColumns = '1fr'
      loadSkills()
      return
    }
    skillsMode = false
    $('tab-skills').classList.remove('active')
    $('search').style.display = ''
    $('featured-wrap').style.display = 'block'
    $('space-bar').style.display = ''
    $('section-label').textContent = '全部应用'
    $('list').style.gridTemplateColumns = ''
    // 切回应用模式时清掉技能提示条与技能残留，强制重新加载应用列表
    var tip = $('skill-tip')
    if (tip) tip.remove()
    if (currentSort === sortFor(tab)) {
      load()
    } else {
      setSort(sortFor(tab))
    }
  }
  function sortFor(tab) {
    return tab === 'hot' ? 'hot' : 'latest'
  }
  function setSort(sort) {
    if (currentSort === sort && !skillsMode) return
    currentSort = sort
    $('tab-latest').classList.toggle('active', sort === 'latest')
    $('tab-hot').classList.toggle('active', sort === 'hot')
    load()
  }
  // ==========================================================================
  // 技能市场（2026-08-09）：StoreSDK.skills.list / skills.install
  // 技能来自系统全局（design/xhs-content 等），安装 = 复制到用户工作区
  // skills/<id>/（用户级副本，AI 可用 manage_skill 自定义演进）。
  // ==========================================================================
  var skillItems = []
  function renderSkills(items) {
    var el = $('list')
    el.innerHTML = ''
    var empty = $('empty')
    if (!items.length) {
      empty.style.display = 'block'
      empty.innerHTML = '<strong>暂无可用技能</strong>系统技能正在准备中'
      return
    }
    empty.style.display = 'none'
    items.forEach(function (s) {
      var size = formatBytes(s.sizeBytes)
      // 2026-08-18 用户发布技能：带发布者标注；系统级按内置语义展示
      var meta = size ? size + ' · ' : ''
      if (s.system) {
        meta += s.installable ? '安装后可让 AI 自定义演进' : '系统内置 · 全局已可用'
      } else {
        meta += (s.ownerName || '匿名') + ' 发布'
      }
      var btn = ''
      if (s.system && !s.installable) {
        btn = '<button class="install done" disabled>内置</button>'
      } else if (s.installed) {
        btn = '<button class="install done" disabled>已安装</button>'
      } else {
        btn = '<button class="install" data-skill-install="' + esc(s.id) + '"><svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v12M6 11l6 6 6-6"/></svg>获取</button>'
      }
      var card = document.createElement('div')
      card.className = 'skill-card'
      card.innerHTML =
        '<div class="skill-icon"><img src="' + phSvgUri(s.name || '技能') + '" alt=""></div>' +
        '<div class="skill-body">' +
        '<div class="skill-name">' + esc(s.name || s.id) + '</div>' +
        '<div class="skill-desc">' + esc(s.description || '') + '</div>' +
        '<div class="skill-meta">' + esc(meta) + '</div>' +
        '</div>' + btn
      el.appendChild(card)
    })
  }
  function loadSkills() {
    var el = $('list')
    el.innerHTML = '<div class="loading" style="grid-column:1/-1">加载中…</div>'
    $('empty').style.display = 'none'
    // 技能说明（设计上保持克制：一行小字提示安装语义；2026-08-18 提示可发布自己的技能）
    if (!$('skill-tip')) {
      var tip = document.createElement('div')
      tip.className = 'skill-tip'
      tip.id = 'skill-tip'
      tip.innerHTML = '<b>技能 = AI 的专长</b>：安装后 Daily 的 AI 立即可用，还能在对话中让它按你的习惯自定义；点底部「我的」可发布你自己的技能'
      el.parentNode.insertBefore(tip, el)
    }
    call('skills.list', {}).then(function (res) {
      skillItems = res.items || []
      renderSkills(skillItems)
    }).catch(function (e) {
      el.innerHTML = '<div class="empty" style="grid-column:1/-1"><strong>加载失败</strong>' + esc(e.message || '') + '</div>'
    })
  }
  function doSkillInstall(skillId, btn) {
    if (btn) { btn.disabled = true; btn.textContent = '安装中…' }
    call('skills.install', { skillId: skillId }).then(function (res) {
      toast((res && res.message) || '已安装技能')
      loadSkills()
    }).catch(function (err) {
      if (btn) { btn.disabled = false; btn.textContent = '获取' }
      toast(err.message || '安装失败')
    })
  }
  // 返回桌面（宿主 StoreSDK.system.back）
  $('btn-back').addEventListener('click', function () {
    call('system.back', {}).catch(function () { /* 宿主未支持时忽略 */ })
  })

  // ==========================================================================
  // 安装 / 打开 / 分享 / 预览（事件委托：hero + grid 共用）
  // ==========================================================================
  function findItem(id) {
    for (var i = 0; i < allItems.length; i++) { if (allItems[i].id === id) return allItems[i] }
    return null
  }
  function doInstall(item, btn) {
    if (btn) btn.disabled = true
    var original = btn ? btn.textContent : ''
    if (btn) btn.textContent = '安装中…'
    call('install', { shareId: item.id }).then(function (res) {
      item.installed = true
      if (res && res.appId) item.appId = res.appId
      toast((res && res.message) || '已安装到桌面')
      render(allItems)
      if ($('preview-overlay').classList.contains('show')) {
        var pbtn = $('preview-install')
        pbtn.textContent = item.appId ? '打开' : '已安装'
        pbtn.classList.toggle('open', Boolean(item.appId))
        pbtn.disabled = false
      }
    }).catch(function (err) {
      if (btn) { btn.disabled = false; btn.textContent = original }
      toast(err.message || '安装失败')
    })
  }
  function doShare(id) {
    call('share', { shareId: id }).then(function (res) {
      var url = res.url
      if (navigator.share) {
        navigator.share({ title: 'Daily 应用', text: '来体验这个应用：' + url, url: url }).catch(function () {})
      } else {
        var ta = document.createElement('textarea')
        ta.value = url; document.body.appendChild(ta); ta.select()
        try { document.execCommand('copy') } catch (e2) {}
        document.body.removeChild(ta)
        toast('分享链接已复制')
      }
    }).catch(function (err) { toast(err.message) })
  }

  function onListClick(e) {
    // 2026-08-09 技能安装按钮（市场「技能」页签）
    var skillBtn = e.target.closest('button[data-skill-install]')
    if (skillBtn) {
      doSkillInstall(skillBtn.getAttribute('data-skill-install'), skillBtn)
      return
    }
    var btn = e.target.closest('button[data-act]')
    if (btn) {
      var act = btn.getAttribute('data-act'), id = btn.getAttribute('data-id')
      if (act === 'install') {
        var item = findItem(id)
        if (item) doInstall(item, btn)
      } else if (act === 'open') {
        var openItem = findItem(id)
        if (openItem && openItem.appId) call('system.openApp', { appId: openItem.appId }).catch(function () {})
      } else if (act === 'share') {
        doShare(id)
      }
      return
    }
    var card = e.target.closest('.hero') || e.target.closest('.card')
    if (card) openPreview(card.getAttribute('data-id'))
  }
  $('featured').addEventListener('click', onListClick)
  $('list').addEventListener('click', onListClick)

  // ==========================================================================
  // 效果预览（体验核心）：全屏运行快照 + 安装按钮
  // ==========================================================================
  var previewItem = null
  function openPreview(id) {
    var item = findItem(id)
    if (!item) return
    previewItem = item
    var iconEl = $('preview-icon')
    iconEl.innerHTML = item.icon ? iconHtml(item) : '<span class="ph">' + esc((item.name || '?').slice(0, 1).toUpperCase()) + '</span>'
    $('preview-name').textContent = item.name || ''
    $('preview-owner').textContent = (item.ownerName || '匿名') + ' · ' + (item.installs || 0) + ' 次安装' + sizeLabel(item)
    var installBtn = $('preview-install')
    installBtn.disabled = false
    installBtn.className = 'btn primary install' + (item.installed ? (item.appId ? ' open' : ' done') : '')
    installBtn.textContent = item.installed ? (item.appId ? '打开' : '已安装') : '安装'
    $('preview-overlay').classList.add('show')
    $('preview-loading').style.display = 'flex'
    call('get', { shareId: id }).then(function (res) {
      var html = (res.item && res.item.html) || ''
      if (!html) { toast('该应用没有可预览的内容'); closePreview(); return }
      // 预览 iframe：<base> 指向商店快照素材端点 + 内存态 localStorage polyfill
      // 注意：sandbox opaque origin 下「访问 window.localStorage」本身就会抛
      // SecurityError（不是返回 undefined），必须先 try/catch 探测再覆盖。
      var base = window.location.origin + '/webos/api/store/apps/' + encodeURIComponent(id) + '/raw/'
      var polyfill = '<scr' + 'ipt>'
        + 'var _lsok=false;try{void window.localStorage;_lsok=true}catch(e){_lsok=false}'
        + 'if(!_lsok){var m={},k=[];var ls={getItem:function(x){return x in m?m[x]:null},setItem:function(x,v){m[x]=String(v);if(k.indexOf(x)<0)k.push(x)},removeItem:function(x){delete m[x]},clear:function(){m={};k=[]},key:function(i){return k[i]||null},get length(){return k.length}};'
        + 'try{Object.defineProperty(window,"localStorage",{value:ls})}catch(e){try{window.localStorage=ls}catch(e2){}}}'
        + '<\/scr' + 'ipt>'
      var doc = '<!doctype html><html><head><meta charset="utf-8"><base href="' + esc(base) + '">' + polyfill + '</head><body style="margin:0">' + html + '</body></html>'
      var frame = $('preview-frame')
      frame.srcdoc = doc
      $('preview-loading').style.display = 'none'
    }).catch(function (e) { $('preview-loading').style.display = 'none'; toast('预览加载失败：' + e.message) })
  }
  function closePreview() {
    $('preview-overlay').classList.remove('show')
    $('preview-frame').srcdoc = ''
    previewItem = null
  }
  $('preview-back').addEventListener('click', closePreview)
  $('preview-install').addEventListener('click', function () {
    if (!previewItem) return
    var btn = $('preview-install')
    if (btn.textContent === '打开') {
      if (previewItem.appId) call('system.openApp', { appId: previewItem.appId }).catch(function () {})
      return
    }
    doInstall(previewItem, btn)
  })

  // ==========================================================================
  // 「我的」个人主页（2026-08-09 重设计）：底部唯一入口，发布/管理收进主页。
  // 市场是「逛」的地方——浏览应用/技能；作者功能（发布/下架）在「我的」里。
  // ==========================================================================
  function openMine() {
    var statsEl = $('mine-stats')
    statsEl.innerHTML = '<div class="mine-stat" style="grid-column:1/-1;color:var(--muted)">加载中…</div>'
    Promise.all([call('my', {}), call('myApps', {}), call('skills.my', {})]).then(function (results) {
      var list = results[0].items || []
      var apps = results[1].items || []
      var skillList = results[2].items || []
      var installs = 0
      var visits = 0
      list.forEach(function (it) { installs += it.installs || 0; visits += it.visits || 0 })
      statsEl.innerHTML =
        '<div class="mine-stat"><b>' + list.length + '</b><span>应用发布</span></div>' +
        '<div class="mine-stat"><b>' + skillList.length + '</b><span>技能发布</span></div>' +
        '<div class="mine-stat"><b>' + installs + '</b><span>总安装</span></div>' +
        '<div class="mine-stat"><b>' + visits + '</b><span>总分享</span></div>'
      var el = $('my-list')
      if (!list.length) {
        el.innerHTML = '<p class="empty" style="padding:20px 0">还没发布过应用，点下方「发布到市场」分享你的第一个作品</p>'
      } else {
        el.innerHTML = list.map(function (it) {
          return '<div class="apppick"><div class="icon">' + iconHtml(it) + '</div>' +
            '<div class="nm">' + esc(it.name) + '</div>' +
            '<div class="stat">' + (it.installs || 0) + ' 安装 · 分享 ' + (it.visits || 0) + '</div>' +
            '<button class="btn" data-unpub="' + esc(it.id) + '" style="flex:0">下架</button></div>'
        }).join('')
      }
      // 2026-08-18 我的技能发布（可下架）
      var skillEl = $('my-skill-list')
      if (!skillList.length) {
        skillEl.innerHTML = '<p class="empty" style="padding:16px 0">还没发布过技能——把调教好的技能分享给大家</p>'
      } else {
        skillEl.innerHTML = skillList.map(function (it) {
          return '<div class="apppick">' +
            '<div class="skill-icon" style="width:34px;height:34px;border-radius:10px"><img src="' + phSvgUri(it.name || '技能') + '" alt=""></div>' +
            '<div class="nm">' + esc(it.name || it.skillId) + '</div>' +
            '<div class="stat">' + formatBytes(it.sizeBytes) + '</div>' +
            '<button class="btn" data-skill-unpub="' + esc(it.id) + '" style="flex:0">下架</button></div>'
        }).join('')
      }
      $('my-overlay').classList.add('show')
    }).catch(function (e) {
      statsEl.innerHTML = ''
      toast(e.message || '加载失败')
    })
  }
  $('btn-mine').addEventListener('click', openMine)
  $('my-close').addEventListener('click', function () { $('my-overlay').classList.remove('show') })
  $('my-list').addEventListener('click', function (e) {
    var btn = e.target.closest('button[data-unpub]')
    if (!btn) return
    var id = btn.getAttribute('data-unpub')
    call('unpublish', { shareId: id }).then(function () {
      toast('已下架')
      openMine() // 下架后刷新个人主页（保持打开）
      load() // 市场列表同步移除
    }).catch(function (e) { toast(e.message) })
  })
  // 2026-08-18 技能下架（「我的」个人主页）
  $('my-skill-list').addEventListener('click', function (e) {
    var btn = e.target.closest('button[data-skill-unpub]')
    if (!btn) return
    var id = btn.getAttribute('data-skill-unpub')
    call('skills.unpublish', { id: id }).then(function () {
      toast('技能已下架')
      openMine() // 刷新个人主页（保持打开）
      loadSkills() // 技能市场列表同步移除
    }).catch(function (e) { toast(e.message) })
  })

  var pickedApp = null
  var pickedSkill = null
  var publishMode = 'app' // 'app' | 'skill'
  function setPublishMode(mode) {
    publishMode = mode
    $('pubtab-app').classList.toggle('active', mode === 'app')
    $('pubtab-skill').classList.toggle('active', mode === 'skill')
    $('myapps').style.display = mode === 'app' ? '' : 'none'
    $('myskills').style.display = mode === 'skill' ? '' : 'none'
    $('pub-desc').placeholder = mode === 'app'
      ? '介绍你的应用（可选，一句话说明它是做什么的）'
      : '介绍你的技能（可选，补充一句话说明亮点）'
  }
  $('pubtab-app').addEventListener('click', function () { setPublishMode('app') })
  $('pubtab-skill').addEventListener('click', function () { setPublishMode('skill') })
  // 个人主页内「发布到市场」→ 打开发布弹层（应用/技能 双 tab）
  $('btn-publish').addEventListener('click', function () {
    Promise.all([call('myApps', {}), call('skills.mine', {})]).then(function (results) {
      var apps = results[0].items || []
      var skills = (results[1] && results[1].items) || []
      pickedApp = null; pickedSkill = null
      $('pub-desc').value = ''
      var el = $('myapps')
      if (!apps.length) {
        el.innerHTML = '<p class="empty" style="padding:14px 0 18px">还没有可发布的 App——先让 AI 做一个吧</p>'
      } else {
        el.innerHTML = apps.map(function (a) {
          return '<div class="apppick" data-app="' + esc(a.id) + '"><div class="icon">' + iconHtml(a) + '</div><div class="nm">' + esc(a.name) + '</div></div>'
        }).join('')
      }
      // 技能选择（工作区我的技能；已发布的标注）
      var skillEl = $('myskills')
      if (!skills.length) {
        skillEl.innerHTML = '<p class="empty" style="padding:14px 0 18px">工作区还没有可发布的技能——让 AI 写一个 skill，或从市场安装后自定义</p>'
      } else {
        skillEl.innerHTML = skills.map(function (s) {
          var tag = s.published ? '<span class="installed-tag">已发布</span>' : ''
          return '<div class="apppick" data-skill="' + esc(s.id) + '">' +
            '<div class="skill-icon" style="width:34px;height:34px;border-radius:10px"><img src="' + phSvgUri(s.name || '技能') + '" alt=""></div>' +
            '<div class="nm">' + esc(s.name || s.id) + '</div>' +
            '<div class="stat">' + formatBytes(s.sizeBytes) + '</div>' + tag + '</div>'
        }).join('')
      }
      setPublishMode('app')
      // 2026-08-16 打开发布页前先关闭「我的」层——两者都是 .overlay（同级），
      // 若不同时关闭，DOM 靠后的 my-overlay 会盖住发布页（发布表单被遮挡点不到）。
      $('my-overlay').classList.remove('show')
      $('publish-overlay').classList.add('show')
    }).catch(function (e) { toast(e.message) })
  })
  $('myapps').addEventListener('click', function (e) {
    var pick = e.target.closest('.apppick')
    if (!pick) return
    Array.prototype.forEach.call($('myapps').children, function (c) { c.classList.remove('active') })
    pick.classList.add('active')
    pickedApp = pick.getAttribute('data-app'); pickedSkill = null
  })
  $('myskills').addEventListener('click', function (e) {
    var pick = e.target.closest('.apppick')
    if (!pick) return
    Array.prototype.forEach.call($('myskills').children, function (c) { c.classList.remove('active') })
    pick.classList.add('active')
    pickedSkill = pick.getAttribute('data-skill'); pickedApp = null
  })
  $('pub-cancel').addEventListener('click', function () { $('publish-overlay').classList.remove('show') })
  $('pub-confirm').addEventListener('click', function () {
    var desc = $('pub-desc').value.trim().slice(0, 200)
    var btn = $('pub-confirm'); btn.disabled = true
    var op
    if (publishMode === 'skill') {
      if (!pickedSkill) { toast('先选择一个技能'); btn.disabled = false; return }
      op = call('skills.publish', { skillId: pickedSkill, description: desc })
    } else {
      if (!pickedApp) { toast('先选择一个应用'); btn.disabled = false; return }
      op = call('publish', { appId: pickedApp, description: desc })
    }
    op.then(function (res) {
      $('publish-overlay').classList.remove('show')
      toast((res && res.message) || '已发布到市场')
      load()
      loadSkills()
      // 发布成功后刷新「我的」主页（统计与列表保持最新）
      if ($('my-overlay').classList.contains('show')) openMine()
    }).catch(function (e) { toast(e.message) }).finally(function () { btn.disabled = false })
  })

  // 2026-08-21（W3 R14 收敛）：打开商店即进入「市场」页签 = 统一包市场（万物皆可包，
  // App / skill / api / theme … 全是「包」，一张列表）。旧「最新/最热/技能」tab 保留
  // 可切（老商店浏览），但默认就是包市场。
  setTab('market')
})()
</script>
</body>
</html>`