// ============================================================================
// 系统桌面 v2（system.desktop App 标准实现）— 2026-08-23 多页面与边缘拖拽重制
// ----------------------------------------------------------------------------
// 核心特性：
// 1. 原生多页面支持（Multi-page Launcher + 指示器 Dots 联动 + 点击切页）
// 2. 手势彻底解绑（touch-action: pan-x pan-y，图标区域左右横划 100% 丝滑无阻）
// 3. 长按拖动 App 到边缘自动创建新页面 / 跨页移动（Edge Paging & Auto-create）
// 4. 长按菜单（分享给朋友 / 上传商店 / 源码下载 / 整理模式 / 删除）
// 5. 优雅 design tokens（与 webOS 对话页完全同构），安全区自适应与玻璃 Dock
// ============================================================================

export const WEBOS_DESKTOP_V2_HTML = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover">
<title>系统桌面</title>
<style>
  /* ============ 平台 design tokens（与 Shell 完全同一套，禁止自造色系）============ */
  :root {
    --board: #e8e4db;            /* 壁纸深端（画布底色） */
    --paper: #f8f7f3;            /* 壁纸主色（页面底） */
    --paper-strong: #fffefa;     /* 卡片/毛玻璃面 */
    --paper-muted: #efede7;      /* 弱面 */
    --ink: #171918;              /* 主文字（墨） */
    --ink-soft: #424740;         /* 辅助文字 */
    --muted: #71756f;            /* 弱文字 */
    --muted-light: #a1a49e;
    --blue: #315bd6;             /* 主色（靛蓝） */
    --blue-soft: #e6eafa;        /* 主色浅底 */
    --green: #376b53;            /* 辅助色（墨绿） */
    --line: rgba(23, 25, 24, .10);
    --line-strong: rgba(23, 25, 24, .16);
    --shadow-sm: 0 8px 22px rgba(50, 44, 34, .06);
    --shadow-md: 0 18px 44px rgba(50, 44, 34, .11);
    --radius: 18px;
  }
  * { margin: 0; padding: 0; box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
  html, body { height: 100%; width: 100%; overflow: hidden; touch-action: manipulation; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "SF Pro SC", "PingFang SC",
      "HarmonyOS Sans SC", "MiSans", "Segoe UI", Roboto, sans-serif;
    background: var(--paper);
    color: var(--ink);
    user-select: none;
    -webkit-user-select: none;
    -webkit-touch-callout: none;
  }

  /* 壁纸：暖纸渐变 + 柔光斑 */
  #wallpaper {
    position: fixed; inset: 0; z-index: 0; overflow: hidden;
    background: linear-gradient(168deg, var(--paper) 0%, var(--board) 100%);
    pointer-events: none;
  }
  #wallpaper::before, #wallpaper::after, #wallpaper .blob {
    content: ''; position: absolute; border-radius: 50%; pointer-events: none;
  }
  #wallpaper::before {
    width: 380px; height: 380px; right: -130px; top: -120px;
    background: radial-gradient(circle at 35% 35%, rgba(255,255,255,.92), rgba(255,255,255,0) 70%);
  }
  #wallpaper::after {
    width: 480px; height: 480px; left: -180px; bottom: -170px;
    background: radial-gradient(circle at 40% 40%, rgba(49,91,214,.09), rgba(49,91,214,0) 70%);
  }
  #wallpaper .blob {
    width: 300px; height: 300px; top: 38%; right: -110px;
    background: radial-gradient(circle at 50% 50%, rgba(55,107,83,.07), rgba(55,107,83,0) 70%);
  }

  /* 时钟 */
  #clock {
    position: fixed;
    top: calc(var(--safe-top, env(safe-area-inset-top, 44px)) + 24px);
    left: 0; right: 0;
    z-index: 2;
    text-align: center;
    pointer-events: none;
  }
  #clock .date {
    font-size: 12px; font-weight: 600; letter-spacing: 2px; color: var(--ink-soft);
    margin-bottom: 2px;
  }
  #clock .time {
    font-size: 54px; font-weight: 600; letter-spacing: 1px; line-height: 1.12;
    font-variant-numeric: tabular-nums;
    text-shadow: 0 2px 18px rgba(255,255,255,.55);
  }

  /* 编辑模式顶部完成按钮 */
  #done-btn {
    position: fixed;
    top: calc(var(--safe-top, env(safe-area-inset-top, 44px)) + 20px);
    right: 18px;
    z-index: 8;
    height: 32px;
    padding: 0 14px;
    border-radius: 99px;
    border: none;
    background: var(--blue);
    color: #fff;
    font-size: 12.5px;
    font-weight: 600;
    cursor: pointer;
    box-shadow: 0 4px 12px rgba(49,91,214,.25);
    display: none;
    align-items: center;
    justify-content: center;
    transition: transform .15s ease, opacity .2s ease;
  }
  #done-btn:active { transform: scale(.94); }
  body.editing #done-btn { display: flex; }

  /* 多页面横向滑动视口 */
  #pages {
    position: fixed; inset: 0; z-index: 1;
    display: flex; overflow-x: auto; overflow-y: hidden;
    scroll-snap-type: x mandatory;
    scroll-behavior: smooth;
    scrollbar-width: none;
    -webkit-overflow-scrolling: touch;
  }
  #pages::-webkit-scrollbar { display: none; }
  #pages.locked {
    overflow-x: hidden !important;
    scroll-snap-type: none !important;
  }

  .page {
    flex: 0 0 100%; width: 100%; height: 100%;
    scroll-snap-align: start; scroll-snap-stop: always;
    display: flex; flex-direction: column;
    padding: calc(var(--safe-top, env(safe-area-inset-top, 44px)) + 144px) 16px calc(var(--safe-bottom, env(safe-area-inset-bottom, 18px)) + 102px);
    overflow-y: auto; overflow-x: hidden;
    scrollbar-width: none;
  }
  .page::-webkit-scrollbar { display: none; }

  .grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 22px 6px;
    align-content: start;
    justify-items: center;
    min-height: 180px;
    width: 100%;
  }

  /* App 图标 */
  .app {
    width: 100%; display: flex; flex-direction: column; align-items: center;
    gap: 6px; cursor: pointer; position: relative; padding: 4px 0;
    /* 核心手势解绑：允许横向和纵向滚动，绝不拦截用户滑屏翻页 */
    touch-action: pan-x pan-y;
    user-select: none; -webkit-user-select: none;
    animation: fadeUp .32s ease both;
  }
  .app .tile {
    width: 58px; height: 58px;
    display: flex; align-items: center; justify-content: center;
    overflow: visible;
    background: transparent; border: none; box-shadow: none;
    transition: transform .16s cubic-bezier(0.34, 1.56, 0.64, 1);
    pointer-events: none;
  }
  .app:active:not(.editing) .tile { transform: scale(.90); }
  .app .tile img { width: 56px; height: 56px; display: block; border-radius: 15px; box-shadow: 0 4px 14px rgba(50,44,34,.12); pointer-events: none; }
  .app .tile svg { width: 56px; height: 56px; display: block; filter: drop-shadow(0 4px 10px rgba(50,44,34,.12)); pointer-events: none; }
  .app .name {
    font-size: 10.5px; font-weight: 550;
    text-align: center; max-width: 100%;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    color: var(--ink);
    text-shadow: 0 1px 3px rgba(255,255,255,.6);
    pointer-events: none;
  }

  .app .remove {
    position: absolute; top: -4px; right: calc(50% - 33px);
    width: 22px; height: 22px; border-radius: 50%;
    background: var(--red, #a54b49); color: #fff; border: 2px solid #fff;
    font-size: 13px; line-height: 18px; text-align: center;
    display: none; cursor: pointer; z-index: 5;
    box-shadow: 0 2px 8px rgba(165,75,73,.35);
  }

  /* 编辑晃动模式 (Jiggle) */
  body.editing .app { animation: wiggle 0.35s ease-in-out infinite alternate; }
  body.editing .app:nth-child(2n) { animation-delay: -0.12s; }
  body.editing .app:nth-child(3n) { animation-delay: -0.22s; }
  body.editing .app .remove { display: block; }

  @keyframes wiggle {
    0% { transform: rotate(-1.8deg) scale(0.98); }
    100% { transform: rotate(1.8deg) scale(1.02); }
  }
  @keyframes fadeUp {
    from { opacity: 0; transform: translateY(12px); }
    to { opacity: 1; transform: none; }
  }

  /* 长按触发浮起 */
  .app.armed .tile {
    transform: scale(1.12) translateY(-4px);
    box-shadow: 0 12px 28px rgba(50,44,34,.22);
  }

  /* 拖拽占位符 */
  .app-placeholder {
    width: 100%; min-height: 80px;
    display: flex; align-items: center; justify-content: center;
    border-radius: 18px;
    border: 2px dashed rgba(49, 91, 214, 0.4);
    background: rgba(49, 91, 214, 0.08);
    box-sizing: border-box;
    pointer-events: none;
    animation: pulse 1.2s ease-in-out infinite;
  }
  @keyframes pulse {
    0%, 100% { opacity: 0.6; }
    50% { opacity: 1; }
  }

  /* 悬浮拖拽元素 */
  #drag-floating {
    position: fixed;
    top: 0; left: 0;
    width: 72px;
    display: none;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    z-index: 999;
    pointer-events: none;
    transform: translate3d(-9999px, -9999px, 0);
    filter: drop-shadow(0 16px 36px rgba(50, 44, 34, 0.28));
  }
  #drag-floating .tile {
    width: 58px; height: 58px;
    display: flex; align-items: center; justify-content: center;
    transform: scale(1.14);
  }
  #drag-floating .tile img { width: 56px; height: 56px; border-radius: 15px; }
  #drag-floating .tile svg { width: 56px; height: 56px; }
  #drag-floating .name {
    font-size: 10.5px; font-weight: 600; color: var(--ink);
    background: rgba(255,255,255,.85); padding: 2px 6px; border-radius: 6px;
    white-space: nowrap; max-width: 80px; overflow: hidden; text-overflow: ellipsis;
  }

  /* 分页指示器 */
  #dots {
    position: fixed;
    bottom: calc(var(--safe-bottom, env(safe-area-inset-bottom, 16px)) + 84px);
    left: 0; right: 0; z-index: 2;
    display: flex; justify-content: center; align-items: center; gap: 6px;
    pointer-events: auto;
  }
  #dots i {
    width: 6px; height: 6px; border-radius: 50%;
    background: rgba(23, 25, 24, 0.18);
    transition: all 0.24s cubic-bezier(0.34, 1.56, 0.64, 1);
    cursor: pointer;
  }
  #dots i.active {
    background: var(--blue);
    width: 18px;
    border-radius: 3px;
  }

  /* 玻璃 Dock */
  .dock {
    position: fixed;
    bottom: calc(var(--safe-bottom, env(safe-area-inset-bottom, 16px)) + 14px);
    left: 50%; transform: translateX(-50%);
    z-index: 2;
    display: flex; gap: 10px;
    padding: 8px 14px;
    background: rgba(255, 254, 250, 0.72);
    border: 1px solid rgba(255, 255, 255, 0.82);
    border-radius: 26px;
    box-shadow: 0 12px 32px rgba(50, 44, 34, 0.12), 0 0 0 1px rgba(23, 25, 24, 0.05);
    backdrop-filter: blur(22px);
    -webkit-backdrop-filter: blur(22px);
  }
  .dock button {
    width: 46px; height: 46px; border: none; border-radius: 15px;
    background: rgba(255, 255, 255, 0.92);
    box-shadow: 0 4px 12px rgba(50, 44, 34, 0.08);
    display: flex; align-items: center; justify-content: center;
    cursor: pointer; transition: transform 0.15s ease;
  }
  .dock button:active { transform: scale(0.9); }
  .dock svg { width: 22px; height: 22px; }

  .hint {
    position: fixed; bottom: calc(var(--safe-bottom, env(safe-area-inset-bottom, 16px)) + 144px);
    left: 0; right: 0; z-index: 2; text-align: center;
    font-size: 11.5px; color: var(--ink-soft);
    opacity: 0; transition: opacity 0.25s ease; pointer-events: none;
  }
  .hint.show { opacity: 1; }

  /* 确认删除对话框 */
  #confirm {
    position: fixed; inset: 0; z-index: 20;
    display: none; align-items: center; justify-content: center;
    background: rgba(50, 44, 34, 0.42);
    padding: 28px;
    backdrop-filter: blur(4px);
  }
  #confirm.show { display: flex; }
  #confirm .box {
    width: 100%; max-width: 290px;
    background: var(--paper-strong); border-radius: 20px;
    padding: 22px 18px 16px;
    box-shadow: 0 18px 50px rgba(50, 44, 34, 0.25);
    text-align: center;
  }
  #confirm .box strong { display: block; font-size: 16px; }
  #confirm .box p { font-size: 12px; color: var(--ink-soft); margin: 8px 0 16px; line-height: 1.5; }
  #confirm .box .row { display: flex; gap: 10px; }
  #confirm .box button {
    flex: 1; height: 42px; border: none; border-radius: 12px;
    font-size: 14px; font-weight: 600; cursor: pointer;
  }
  #confirm .box .cancel { background: var(--paper-muted); color: var(--ink); }
  #confirm .box .ok { background: var(--red, #a54b49); color: #fff; }

  /* 长按快捷菜单 */
  #appmenu {
    position: fixed; inset: 0; z-index: 21;
    display: none; align-items: center; justify-content: center;
    background: rgba(50, 44, 34, 0.45);
    padding: 28px;
    backdrop-filter: blur(4px);
  }
  #appmenu.show { display: flex; }
  #appmenu .box {
    width: 100%; max-width: 300px;
    background: var(--paper-strong); border-radius: 22px;
    padding: 20px 16px 14px;
    box-shadow: 0 18px 50px rgba(50, 44, 34, 0.28);
  }
  #appmenu .m-title { font-size: 15.5px; font-weight: 700; text-align: center; }
  #appmenu .m-sub { font-size: 11.5px; color: var(--ink-soft); text-align: center; margin: 4px 0 12px; }
  #appmenu button.m-item {
    display: flex; align-items: center; gap: 10px;
    width: 100%; height: 44px;
    border: none; background: transparent; border-radius: 12px;
    font-size: 13.5px; font-weight: 600; color: var(--ink);
    cursor: pointer; padding: 0 12px;
  }
  #appmenu button.m-item:active { background: var(--paper-muted); }
  #appmenu button.m-item.m-danger { color: var(--red, #a54b49); }
  #appmenu button.m-item.m-disabled { color: var(--muted-light); pointer-events: none; }
  #appmenu .m-sep { height: 1px; background: var(--line); margin: 6px 0; }

  /* 顶部 Toast */
  #toast {
    position: fixed; top: max(env(safe-area-inset-top, 20px), 16px); left: 50%;
    transform: translateX(-50%); z-index: 30;
    max-width: 86vw; text-align: center;
    background: rgba(23, 25, 24, 0.92); color: #fff;
    font-size: 12.5px; padding: 9px 16px; border-radius: 999px;
    opacity: 0; pointer-events: none; transition: opacity 0.25s ease;
  }
  #toast.show { opacity: 1; }
</style>
</head>
<body>
<div id="wallpaper"><span class="blob"></span></div>
<div id="clock"><div class="date"></div><div class="time"></div></div>
<button id="done-btn" type="button" aria-label="完成整理">完成</button>

<main id="pages"></main>
<div id="dots"></div>
<p class="hint" id="hint">拖拽调整位置 · 移至边缘翻页/新建页</p>

<div id="drag-floating"></div>

<div id="confirm">
  <div class="box">
    <strong id="confirm-title"></strong>
    <p id="confirm-desc"></p>
    <div class="row">
      <button class="cancel" id="confirm-cancel" type="button">取消</button>
      <button class="ok" id="confirm-ok" type="button">删除</button>
    </div>
  </div>
</div>

<div id="appmenu">
  <div class="box">
    <div class="m-title" id="menu-title"></div>
    <div class="m-sub" id="menu-sub"></div>
    <div id="menu-actions"></div>
  </div>
</div>

<div id="toast"></div>

<footer class="dock">
  <button data-sys="assistant" aria-label="Daily AI"><svg viewBox="0 0 24 24" fill="none" stroke="#4f6ef7" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l1.9 5.7L19.6 10l-5.7 1.9L12 17.6l-1.9-5.7L4.4 10l5.7-1.3z"/></svg></button>
  <button data-sys="files" aria-label="文件"><svg viewBox="0 0 24 24" fill="none" stroke="#0ea5e9" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 3h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg></button>
  <button data-sys="trash" aria-label="回收站"><svg viewBox="0 0 24 24" fill="none" stroke="#6b7070" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2M6 6l1 14a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-14"/><path d="M10 11v6M14 11v6"/></svg></button>
</footer>

<script>
(function () {
  "use strict";

  // ---------------- DesktopSDK 通信 ----------------
  var SDK = {
    apps: {
      list: function () { return call("apps.list", {}); },
      open: function (id) { return call("apps.open", { id: id }); },
      reorder: function (ids) { return call("apps.reorder", { ids: ids }); },
      remove: function (id) { return call("apps.remove", { id: id }); },
      share: function (id) { return call("apps.share", { id: id }); },
      shareToFriend: function (id) { return call("apps.shareToFriend", { id: id }); },
      exportZip: function (id) { return call("apps.export", { id: id }); },
      download: function (url, name) { return call("apps.download", { url: url, name: name }); }
    },
    system: {
      navigate: function (view) { return call("system.navigate", { view: view }); },
      copy: function (text) { return call("system.copy", { text: text }); }
    }
  };
  var pending = {};
  var seq = 0;
  function call(method, params) {
    return new Promise(function (resolve, reject) {
      var id = "r" + (++seq);
      var timer = setTimeout(function () {
        delete pending[id];
        reject(new Error("DesktopSDK 请求超时: " + method));
      }, 8000);
      pending[id] = { resolve: resolve, reject: reject, timer: timer };
      window.parent.postMessage({
        channel: "daily-webos-sdk", kind: "request", requestId: id,
        method: method, params: params || {}
      }, "*");
    });
  }
  window.addEventListener("message", function (event) {
    var msg = event.data;
    if (!msg || typeof msg !== "object") return;
    if (msg.channel !== "daily-webos-sdk" || msg.kind !== "response") return;
    var entry = pending[msg.requestId];
    if (!entry) return;
    clearTimeout(entry.timer);
    delete pending[msg.requestId];
    if (msg.ok === true) entry.resolve(msg.data);
    else entry.reject(new Error(msg.error || "DesktopSDK 请求失败"));
  });

  // ---------------- 全局状态 ----------------
  var pagesEl = document.getElementById("pages");
  var dotsEl = document.getElementById("dots");
  var hintEl = document.getElementById("hint");
  var doneBtn = document.getElementById("done-btn");
  var dragFloating = document.getElementById("drag-floating");

  var allApps = [];
  var pagesData = [[]]; // 二维数组：[[app1, app2...], [app5...]]
  var currentPageIndex = 0;
  var isEditing = false;
  var PAGE_CAPACITY = 20; // 4x5 每页上限，多出或手动拖拽分流到多页

  // ---------------- 图标生成 ----------------
  var ICON_GRADIENTS = [
    ['#5b7cf0', '#315bd6', '#2743a8'],
    ['#6f8fd8', '#4a68c9', '#2f4a9e'],
    ['#5d8a76', '#376b53', '#274f3e'],
    ['#8a9b6f', '#6b7f55', '#4e6140'],
    ['#c07a6f', '#a54b49', '#7e3735'],
    ['#8a7bc0', '#6b5ba8', '#4d4180'],
    ['#c07a9b', '#a54b7e', '#7e375f'],
    ['#c9a76b', '#a97f3f', '#7f5c2a'],
    ['#5f8f8f', '#3f6f6f', '#2a4f4f'],
    ['#9aa0a0', '#6b7070', '#4a4f4f']
  ];
  var iconSeq = 0;
  function hashIcon(name) {
    var n = 0, s = String(name || '?');
    for (var i = 0; i < s.length; i++) n = (n * 31 + s.charCodeAt(i)) >>> 0;
    var g = ICON_GRADIENTS[n % ICON_GRADIENTS.length];
    var gid = 'gapp' + (++iconSeq);
    var letter = escapeHtml(s.slice(0, 1));
    return '<svg viewBox="0 0 128 128" xmlns="http://www.w3.org/2000/svg">'
      + '<defs><linearGradient id="' + gid + '" x1="0" y1="0" x2="1" y2="1">'
      + '<stop offset="0" stop-color="' + g[0] + '"/>'
      + '<stop offset=".55" stop-color="' + g[1] + '"/>'
      + '<stop offset="1" stop-color="' + g[2] + '"/>'
      + '</linearGradient></defs>'
      + '<rect x="6" y="6" width="116" height="116" rx="28" fill="url(#' + gid + ')"/>'
      + '<ellipse cx="64" cy="22" rx="50" ry="16" fill="rgba(255,255,255,.26)"/>'
      + '<text x="64" y="82" font-size="52" font-weight="700" text-anchor="middle" fill="#fff" font-family="-apple-system,BlinkMacSystemFont,PingFang SC,sans-serif">' + letter + '</text>'
      + '</svg>';
  }

  function svgIcon(app) {
    if (app.icon) {
      if (app.icon.indexOf('data:') === 0 || app.icon.indexOf('/webos/api/') === 0) {
        return '<img alt="" src="' + app.icon + '">';
      }
      return '<img alt="" src="data:image/svg+xml;utf8,' + encodeURIComponent(app.icon) + '">';
    }
    var fallback = {
      "daily.ai": '<svg viewBox="0 0 128 128" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="gdai" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#5b7cf0"/><stop offset=".55" stop-color="#315bd6"/><stop offset="1" stop-color="#2743a8"/></linearGradient></defs><rect x="6" y="6" width="116" height="116" rx="28" fill="url(#gdai)"/><ellipse cx="64" cy="22" rx="50" ry="16" fill="rgba(255,255,255,.28)"/><path d="M64 30c-17.6 0-32 12.5-32 28 0 9 5 17 13.2 22.2L42 90l12.2-6.3c3.2.7 6.5 1.1 9.8 1.1 17.6 0 32-12.5 32-28S81.6 30 64 30z" fill="#fff"/><circle cx="50.5" cy="57" r="4.6" fill="#315bd6"/><circle cx="64" cy="57" r="4.6" fill="#315bd6"/><circle cx="77.5" cy="57" r="4.6" fill="#315bd6"/><path d="M90 20l1.6 4.8 4.8 1.6-4.8 1.6-1.6 4.8-1.6-4.8-4.8-1.6 4.8-1.6z" fill="#fff" opacity=".9"/><path d="M42 24l1.2 3.6 3.6 1.2-3.6 1.2-1.2 3.6-1.2-3.6-3.6-1.2 3.6-1.2z" fill="#fff" opacity=".8"/></svg>',
      "system.desktop": '<svg viewBox="0 0 128 128" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="gdesk" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#5d8a76"/><stop offset=".55" stop-color="#376b53"/><stop offset="1" stop-color="#274f3e"/></linearGradient></defs><rect x="6" y="6" width="116" height="116" rx="28" fill="url(#gdesk)"/><ellipse cx="64" cy="22" rx="50" ry="16" fill="rgba(255,255,255,.26)"/><rect x="26" y="32" width="76" height="50" rx="9" fill="#fff"/><rect x="31" y="37" width="28" height="20" rx="5" fill="#5d8a76"/><rect x="63" y="37" width="24" height="20" rx="5" fill="#8fb3a0"/><path d="M52 94h24M64 82v12" stroke="#fff" stroke-width="7" stroke-linecap="round"/></svg>',
      "system.files": '<svg viewBox="0 0 128 128" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="gfile" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#6f8fd8"/><stop offset=".55" stop-color="#4a68c9"/><stop offset="1" stop-color="#315bd6"/></linearGradient></defs><rect x="6" y="6" width="116" height="116" rx="28" fill="url(#gfile)"/><ellipse cx="64" cy="22" rx="50" ry="16" fill="rgba(255,255,255,.28)"/><path d="M22 48c0-8 6.5-14 14.5-14h13.5l9 12h35c8 0 14.5 6 14.5 14v22c0 8-6.5 14-14.5 14H36.5c-8 0-14.5-6-14.5-14V48z" fill="#fff"/><rect x="36" y="56" width="50" height="8" rx="4" fill="#4a68c9"/><rect x="36" y="70" width="34" height="8" rx="4" fill="#a9bcee"/></svg>',
      "system.store": '<svg viewBox="0 0 128 128" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="gstore" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#d9b98c"/><stop offset=".55" stop-color="#b8893f"/><stop offset="1" stop-color="#8a6428"/></linearGradient></defs><rect x="6" y="6" width="116" height="116" rx="28" fill="url(#gstore)"/><ellipse cx="64" cy="22" rx="50" ry="16" fill="rgba(255,255,255,.3)"/><path d="M30 52l6-14h56l6 14" fill="none" stroke="#fff" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/><path d="M30 52h68v34c0 8-7 14-15 14H45c-8 0-15-6-15-14V52z" fill="#fff"/><path d="M52 62v12c0 7 5 12 12 12s12-5 12-12V62" fill="none" stroke="#b8893f" stroke-width="7" stroke-linecap="round"/></svg>',
      "system.trash": '<svg viewBox="0 0 128 128" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="gtrash" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#9aa0a0"/><stop offset=".55" stop-color="#6b7070"/><stop offset="1" stop-color="#4a4f4f"/></linearGradient></defs><rect x="6" y="6" width="116" height="116" rx="28" fill="url(#gtrash)"/><ellipse cx="64" cy="22" rx="50" ry="16" fill="rgba(255,255,255,.24)"/><path d="M32 44h64M44 44l3-10c1-4 4-6 8-6h18c4 0 7 2 8 6l3 10" fill="none" stroke="#fff" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/><path d="M37 50l5 40c1 8 7 13 15 13h14c8 0 14-5 15-13l5-40" fill="#fff"/><path d="M51 62v34M64 62v34M77 62v34" stroke="#6b7070" stroke-width="6" stroke-linecap="round"/></svg>'
    };
    if (fallback[app.id]) return fallback[app.id];
    return hashIcon(app.name);
  }

  // ---------------- 多页数据结构与渲染 ----------------
  function initPagesData(apps) {
    var saved = null;
    try {
      var raw = localStorage.getItem("daily_webos_desktop_pages_v2");
      if (raw) saved = JSON.parse(raw);
    } catch (e) {}

    var byId = {};
    apps.forEach(function (a) { byId[a.id] = a; });
    var placedIds = {};

    if (saved && Array.isArray(saved) && saved.length > 0) {
      pagesData = [];
      saved.forEach(function (pageIds) {
        var page = [];
        if (Array.isArray(pageIds)) {
          pageIds.forEach(function (id) {
            if (byId[id] && !placedIds[id]) {
              page.push(byId[id]);
              placedIds[id] = true;
            }
          });
        }
        pagesData.push(page);
      });
    } else {
      pagesData = [[]];
    }

    // 将未排入多页的新 App 追加到末尾或空页
    apps.forEach(function (app) {
      if (!placedIds[app.id]) {
        var lastPage = pagesData[pagesData.length - 1];
        if (!lastPage || lastPage.length >= PAGE_CAPACITY) {
          pagesData.push([app]);
        } else {
          lastPage.push(app);
        }
        placedIds[app.id] = true;
      }
    });

    cleanupEmptyPages();
  }

  function cleanupEmptyPages() {
    if (pagesData.length <= 1) {
      if (pagesData.length === 0) pagesData = [[]];
      return;
    }
    var cleaned = [];
    pagesData.forEach(function (p, idx) {
      if (idx === 0 || p.length > 0) cleaned.push(p);
    });
    pagesData = cleaned.length > 0 ? cleaned : [[]];
  }

  function persistLayout() {
    var pageIds = pagesData.map(function (page) {
      return page.map(function (a) { return a.id; });
    });
    try {
      localStorage.setItem("daily_webos_desktop_pages_v2", JSON.stringify(pageIds));
    } catch (e) {}

    var flat = [];
    pagesData.forEach(function (page) {
      page.forEach(function (a) { flat.push(a.id); });
    });
    SDK.apps.reorder(flat).catch(function () {});
  }

  function renderPages() {
    pagesEl.innerHTML = "";
    cleanupEmptyPages();

    pagesData.forEach(function (pageApps, pIdx) {
      var section = document.createElement("section");
      section.className = "page";
      section.dataset.pageIndex = String(pIdx);

      var grid = document.createElement("div");
      grid.className = "grid";
      grid.dataset.pageIndex = String(pIdx);

      pageApps.forEach(function (app, aIdx) {
        var el = createAppElement(app, pIdx, aIdx);
        grid.appendChild(el);
      });

      section.appendChild(grid);
      pagesEl.appendChild(section);
    });

    renderDots();
    updateActiveDot();
  }

  function renderDots() {
    dotsEl.innerHTML = "";
    var total = Math.max(1, pagesData.length);
    for (var i = 0; i < total; i++) {
      var dot = document.createElement("i");
      dot.dataset.index = String(i);
      if (i === currentPageIndex) dot.className = "active";
      (function (idx) {
        dot.addEventListener("click", function () {
          scrollToPage(idx);
        });
      })(i);
      dotsEl.appendChild(dot);
    }
  }

  function updateActiveDot() {
    var dots = dotsEl.querySelectorAll("i");
    dots.forEach(function (d, i) {
      d.className = i === currentPageIndex ? "active" : "";
    });
  }

  function scrollToPage(idx) {
    if (idx < 0) idx = 0;
    if (idx >= pagesData.length) idx = pagesData.length - 1;
    currentPageIndex = idx;
    var w = pagesEl.clientWidth;
    pagesEl.scrollTo({ left: idx * w, behavior: "smooth" });
    updateActiveDot();
  }

  pagesEl.addEventListener("scroll", function () {
    if (isDragging) return;
    var w = pagesEl.clientWidth;
    if (w <= 0) return;
    var idx = Math.round(pagesEl.scrollLeft / w);
    if (idx !== currentPageIndex && idx >= 0 && idx < pagesData.length) {
      currentPageIndex = idx;
      updateActiveDot();
    }
  }, { passive: true });

  // ---------------- App 元素创建与手势处理 ----------------
  var justDropped = false;
  var isDragging = false;
  var dragApp = null;
  var dragPlaceholder = null;
  var edgeTimer = null;
  var edgeSide = null;

  function createAppElement(app, pageIdx, appIdx) {
    var el = document.createElement("div");
    el.className = "app";
    el.dataset.id = app.id;
    el.dataset.page = String(pageIdx);
    el.dataset.index = String(appIdx);

    el.innerHTML =
      '<div class="tile">' + svgIcon(app) + '</div>' +
      '<span class="name">' + escapeHtml(app.name) + '</span>' +
      '<button class="remove" type="button" aria-label="删除">×</button>';

    var touchStartX = 0, touchStartY = 0;
    var hasMoved = false;
    var longPressTimer = null;

    var removeBtn = el.querySelector(".remove");
    removeBtn.addEventListener("click", function (e) {
      e.stopPropagation();
      removeApp(app.id);
    });

    // 触摸手势：手势解绑核心！
    el.addEventListener("touchstart", function (e) {
      if (justDropped) return;
      var t = e.touches[0];
      if (!t) return;
      touchStartX = t.clientX;
      touchStartY = t.clientY;
      hasMoved = false;

      if (isEditing) {
        e.preventDefault();
        startDragging(app, el, t.clientX, t.clientY);
        return;
      }

      clearTimeout(longPressTimer);
      longPressTimer = setTimeout(function () {
        if (hasMoved) return;
        if (navigator.vibrate) try { navigator.vibrate(40); } catch (e) {}
        el.classList.add("armed");
        enterEdit();
        startDragging(app, el, touchStartX, touchStartY);
      }, 420);
    }, { passive: false });

    el.addEventListener("touchmove", function (e) {
      var t = e.touches[0];
      if (!t) return;
      var dx = t.clientX - touchStartX;
      var dy = t.clientY - touchStartY;
      if (Math.hypot(dx, dy) > 8) {
        hasMoved = true;
        clearTimeout(longPressTimer);
        el.classList.remove("armed");
      }
    }, { passive: true });

    el.addEventListener("touchend", function (e) {
      clearTimeout(longPressTimer);
      el.classList.remove("armed");
      if (justDropped || isDragging) return;

      if (!isEditing && !hasMoved) {
        SDK.apps.open(app.id);
      }
    }, { passive: true });

    el.addEventListener("touchcancel", function () {
      clearTimeout(longPressTimer);
      el.classList.remove("armed");
    }, { passive: true });

    el.addEventListener("contextmenu", function (e) {
      e.preventDefault();
      clearTimeout(longPressTimer);
      openMenu(app);
    });

    return el;
  }

  // ---------------- 拖拽引擎与边缘自动建页 ----------------
  function startDragging(app, sourceEl, startX, startY) {
    if (isDragging) return;
    isDragging = true;
    dragApp = app;

    pagesEl.classList.add("locked");

    dragPlaceholder = document.createElement("div");
    dragPlaceholder.className = "app-placeholder";

    sourceEl.parentNode.insertBefore(dragPlaceholder, sourceEl);
    sourceEl.style.display = "none";

    dragFloating.innerHTML =
      '<div class="tile">' + svgIcon(app) + '</div>' +
      '<span class="name">' + escapeHtml(app.name) + '</span>';
    dragFloating.style.display = "flex";
    updateFloatingPos(startX, startY);

    window.addEventListener("touchmove", onDragMove, { passive: false });
    window.addEventListener("touchend", onDragEnd, { passive: false });
    window.addEventListener("touchcancel", onDragEnd, { passive: false });
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
  }

  function updateFloatingPos(x, y) {
    dragFloating.style.transform = "translate3d(" + (x - 36) + "px," + (y - 36) + "px, 0) scale(1.12)";
  }

  function onDragMove(e) {
    if (!isDragging) return;
    e.preventDefault();
    var t = e.touches ? e.touches[0] : e;
    if (!t) return;
    var x = t.clientX, y = t.clientY;
    updateFloatingPos(x, y);
    handleDragHover(x, y);
  }

  function onMouseMove(e) {
    if (!isDragging) return;
    updateFloatingPos(e.clientX, e.clientY);
    handleDragHover(e.clientX, e.clientY);
  }

  function handleDragHover(x, y) {
    var screenWidth = window.innerWidth;
    var EDGE_ZONE = 38;

    // 1. 边缘翻页 / 自动建页判定
    if (x <= EDGE_ZONE) {
      if (edgeSide !== 'left') {
        clearTimeout(edgeTimer);
        edgeSide = 'left';
        edgeTimer = setTimeout(function () {
          if (currentPageIndex > 0) {
            scrollToPage(currentPageIndex - 1);
            if (navigator.vibrate) try { navigator.vibrate(35); } catch (e) {}
            movePlaceholderToCurrentPage();
          }
        }, 420);
      }
      return;
    } else if (x >= screenWidth - EDGE_ZONE) {
      if (edgeSide !== 'right') {
        clearTimeout(edgeTimer);
        edgeSide = 'right';
        edgeTimer = setTimeout(function () {
          if (currentPageIndex === pagesData.length - 1) {
            // 已在最后一页：自动创建新页面！
            addNewPage();
            scrollToPage(currentPageIndex + 1);
            if (navigator.vibrate) try { navigator.vibrate([35, 40, 35]); } catch (e) {}
            movePlaceholderToCurrentPage();
          } else {
            scrollToPage(currentPageIndex + 1);
            if (navigator.vibrate) try { navigator.vibrate(35); } catch (e) {}
            movePlaceholderToCurrentPage();
          }
        }, 420);
      }
      return;
    } else {
      clearTimeout(edgeTimer);
      edgeSide = null;
    }

    // 2. 当前页网格内位置动态插入占位符
    var currentGrid = getCurrentPageGrid();
    if (!currentGrid) return;

    var apps = Array.prototype.slice.call(currentGrid.querySelectorAll(".app:not([style*='display: none'])"));
    var closest = null;
    var closestDist = Infinity;

    apps.forEach(function (el) {
      var r = el.getBoundingClientRect();
      var cx = r.left + r.width / 2;
      var cy = r.top + r.height / 2;
      var dist = Math.hypot(x - cx, y - cy);
      if (dist < closestDist) {
        closestDist = dist;
        closest = el;
      }
    });

    if (closest && closestDist < 70) {
      var r = closest.getBoundingClientRect();
      if (x < r.left + r.width / 2) {
        currentGrid.insertBefore(dragPlaceholder, closest);
      } else {
        currentGrid.insertBefore(dragPlaceholder, closest.nextSibling);
      }
    } else if (apps.length === 0 || !currentGrid.contains(dragPlaceholder)) {
      currentGrid.appendChild(dragPlaceholder);
    }
  }

  function getCurrentPageGrid() {
    var pageSections = pagesEl.querySelectorAll(".page");
    if (pageSections[currentPageIndex]) {
      return pageSections[currentPageIndex].querySelector(".grid");
    }
    return null;
  }

  function movePlaceholderToCurrentPage() {
    var grid = getCurrentPageGrid();
    if (grid && dragPlaceholder && !grid.contains(dragPlaceholder)) {
      grid.appendChild(dragPlaceholder);
    }
  }

  function addNewPage() {
    pagesData.push([]);
    var pIdx = pagesData.length - 1;

    var section = document.createElement("section");
    section.className = "page";
    section.dataset.pageIndex = String(pIdx);

    var grid = document.createElement("div");
    grid.className = "grid";
    grid.dataset.pageIndex = String(pIdx);

    section.appendChild(grid);
    pagesEl.appendChild(section);

    renderDots();
  }

  function onDragEnd() {
    if (!isDragging) return;
    clearTimeout(edgeTimer);
    edgeSide = null;
    isDragging = false;

    window.removeEventListener("touchmove", onDragMove);
    window.removeEventListener("touchend", onDragEnd);
    window.removeEventListener("touchcancel", onDragEnd);
    window.removeEventListener("mousemove", onMouseMove);
    window.removeEventListener("mouseup", onMouseUp);

    dragFloating.style.display = "none";
    pagesEl.classList.remove("locked");

    if (dragPlaceholder && dragPlaceholder.parentNode) {
      syncPagesDataFromDom();
    }

    renderPages();
    persistLayout();

    justDropped = true;
    setTimeout(function () { justDropped = false; }, 300);
  }

  function onMouseUp() {
    onDragEnd();
  }

  function syncPagesDataFromDom() {
    var byId = {};
    allApps.forEach(function (a) { byId[a.id] = a; });

    var newPages = [];
    var pageGrids = pagesEl.querySelectorAll(".grid");

    pageGrids.forEach(function (grid) {
      var pageApps = [];
      var nodes = grid.children;
      for (var i = 0; i < nodes.length; i++) {
        var node = nodes[i];
        if (node === dragPlaceholder) {
          if (dragApp) pageApps.push(dragApp);
        } else if (node.classList && node.classList.contains("app")) {
          var appId = node.dataset.id;
          if (appId && byId[appId] && appId !== (dragApp ? dragApp.id : '')) {
            pageApps.push(byId[appId]);
          }
        }
      }
      newPages.push(pageApps);
    });

    pagesData = newPages;
    cleanupEmptyPages();
  }

  // ---------------- 编辑模式 ----------------
  function enterEdit() {
    isEditing = true;
    document.body.classList.add("editing");
    hintEl.classList.add("show");
  }
  function exitEdit() {
    isEditing = false;
    document.body.classList.remove("editing");
    hintEl.classList.remove("show");
  }

  doneBtn.addEventListener("click", function () {
    exitEdit();
  });

  pagesEl.addEventListener("click", function (e) {
    if (!isEditing) return;
    if (e.target.closest(".app") || e.target.closest(".dock") || e.target.closest("#done-btn")) return;
    exitEdit();
  });

  // ---------------- 删除与弹窗 ----------------
  function removeApp(id) {
    var app = allApps.filter(function (a) { return a.id === id; })[0];
    if (!app) return;
    var box = document.getElementById("confirm");
    document.getElementById("confirm-title").textContent = "删除「" + app.name + "」？";
    document.getElementById("confirm-desc").textContent = "App 将移入回收站（apps/.trash/），AI 仍可读取与恢复。";
    box.classList.add("show");
    var cancelBtn = document.getElementById("confirm-cancel");
    var okBtn = document.getElementById("confirm-ok");
    var cleanup = function () {
      box.classList.remove("show");
      cancelBtn.onclick = null;
      okBtn.onclick = null;
    };
    cancelBtn.onclick = cleanup;
    okBtn.onclick = function () {
      cleanup();
      SDK.apps.remove(id).then(function () {
        allApps = allApps.filter(function (a) { return a.id !== id; });
        pagesData.forEach(function (page) {
          var idx = -1;
          for (var i = 0; i < page.length; i++) {
            if (page[i].id === id) { idx = i; break; }
          }
          if (idx !== -1) page.splice(idx, 1);
        });
        cleanupEmptyPages();
        renderPages();
        persistLayout();
        if (!allApps.some(function (a) { return a.source !== "builtin"; })) exitEdit();
      }).catch(function () {
        renderPages();
      });
    };
  }

  // ---------------- 长按菜单 ----------------
  var toastTimer = null;
  function toast(msg) {
    var t = document.getElementById("toast");
    t.textContent = msg;
    t.classList.add("show");
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove("show"); }, 2800);
  }

  function menuItem(text, danger, disabled) {
    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "m-item" + (danger ? " m-danger" : "") + (disabled ? " m-disabled" : "");
    btn.textContent = text;
    return btn;
  }
  function closeMenu() {
    document.getElementById("appmenu").classList.remove("show");
    document.getElementById("menu-actions").innerHTML = "";
  }

  window.__dailySystemBack = function () {
    var m = document.getElementById("appmenu");
    if (m.classList.contains("show")) { closeMenu(); return true; }
    var c = document.getElementById("confirm");
    if (c.classList.contains("show")) { c.classList.remove("show"); return true; }
    if (isEditing) { exitEdit(); return true; }
    return false;
  };

  function openMenu(app) {
    document.getElementById("menu-title").textContent = app.name;
    var SYSTEM_IDS = { "daily.ai": 1, "system.desktop": 1, "system.store": 1, "system.files": 1, "system.trash": 1 };
    var isSystem = app.source === "builtin" || Boolean(SYSTEM_IDS[app.id]);
    document.getElementById("menu-sub").textContent = isSystem
      ? "系统应用" : (app.source === "ai_generated" ? "AI 生成" : app.source === "local_import" ? "本地导入" : "商店安装");

    var actions = document.getElementById("menu-actions");
    actions.innerHTML = "";

    var editBtn = menuItem("整理桌面（拖拽排序）");
    editBtn.onclick = function () {
      closeMenu();
      enterEdit();
    };
    actions.appendChild(editBtn);

    if (!isSystem) {
      var friendBtn = menuItem("分享给朋友");
      friendBtn.onclick = function () {
        closeMenu();
        SDK.apps.shareToFriend(app.id).catch(function (e) { toast("分享失败：" + e.message); });
      };
      actions.appendChild(friendBtn);

      var shareBtn = menuItem("上传到应用商店");
      shareBtn.onclick = function () {
        closeMenu();
        SDK.apps.share(app.id).then(function (r) {
          if (r.url) {
            SDK.system.copy(r.url).then(function () { toast("已发布到商店，分享链接已复制"); });
          } else {
            toast(r.message || "发布失败");
          }
        }).catch(function (e) { toast("发布失败：" + e.message); });
      };
      actions.appendChild(shareBtn);

      var dlBtn = menuItem("下载源码 ZIP");
      dlBtn.onclick = function () {
        closeMenu();
        SDK.apps.exportZip(app.id).then(function (r) {
          return SDK.apps.download(r.url, app.id + ".zip");
        }).then(function () { toast("开始下载源码 ZIP"); })
          .catch(function (e) { toast("下载失败：" + e.message); });
      };
      actions.appendChild(dlBtn);

      var delBtn = menuItem("删除（移入回收站）", true);
      delBtn.onclick = function () { closeMenu(); removeApp(app.id); };
      actions.appendChild(delBtn);
    } else {
      var note = menuItem("系统应用（不可分享/删除）", false, true);
      actions.appendChild(note);
    }

    var box = document.getElementById("appmenu");
    box.classList.add("show");
    box.addEventListener("pointerdown", function (e) {
      if (e.target !== box) return;
      closeMenu();
    });
  }

  // ---------------- 时钟 ----------------
  function tick() {
    var now = new Date();
    var d = document.querySelector("#clock .date");
    var t = document.querySelector("#clock .time");
    var week = ["日", "一", "二", "三", "四", "五", "六"][now.getDay()];
    t.textContent = pad(now.getHours()) + ":" + pad(now.getMinutes());
    d.textContent = (now.getMonth() + 1) + "月" + now.getDate() + "日 · 周" + week;
  }
  function pad(n) { return n < 10 ? "0" + n : String(n); }

  function escapeHtml(text) {
    return String(text).replace(/[&<>"']/g, function (ch) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': """, "'": "&#39;" }[ch];
    });
  }

  // ---------------- Dock ----------------
  document.querySelectorAll(".dock button").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var sys = btn.dataset.sys;
      if (sys === "trash") { SDK.apps.open("system.trash").catch(function () {}); return; }
      SDK.system.navigate(sys);
    });
  });

  // ---------------- 初始化 ----------------
  tick();
  setInterval(tick, 30000);

  function loadAndRender() {
    SDK.apps.list().then(function (apps) {
      allApps = apps || [];
      initPagesData(allApps);
      renderPages();
    }).catch(function (err) {
      pagesEl.innerHTML = '<section class="page"><div class="grid"><p style="color:var(--ink-soft);font-size:12px;grid-column:1/-1;text-align:center;padding-top:30px;">桌面加载失败：' + escapeHtml(err.message || '') + '</p></div></section>';
    });
  }

  window.addEventListener("message", function (e) {
    var msg = e.data;
    if (!msg || typeof msg !== "object") return;
    if (msg.channel !== "daily-webos-sdk" || msg.kind !== "apps_changed") return;
    loadAndRender();
  });

  loadAndRender();
})();
</script>
</body>
</html>`
