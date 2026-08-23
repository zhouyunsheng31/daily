// ============================================================================
// 系统桌面 v1 参考实现（system.desktop App 初始版本）— 2026-08-09 视觉重制
// ----------------------------------------------------------------------------
// 这是系统桌面的初始 HTML：按 design skill「安静浅色」tokens 设计的移动端桌面
// （时钟、图标网格、玻璃 Dock、长按整理、页面指示器），无任何碍眼标语。
//
// 设计说明（AI 改桌面必读）：
// - 全部视觉走 :root CSS 变量（design tokens）。想换壁纸改 --bg-1/--bg-2 与
//   --blob-*；想换主色改 --accent；想换卡片质感改 --surface/--shadow。
//   保持变量结构不变，改完的桌面与系统其他页面依然浑然一体。
// - 图标数据来自宿主 DesktopSDK（纯 postMessage 双向直连，无握手）：
//     DesktopSDK.apps.list() / apps.open(id) / apps.reorder(ids) / apps.remove(id)
//     DesktopSDK.apps.share(id) / shareToFriend(id) / exportZip(id) / download(url,name)
//     DesktopSDK.system.navigate('assistant'|'files'|'desktop') / system.copy(text)
//   不要硬编码 App 列表。
// - 版本化：本文件是「参考样貌」，AI 改砸了可回滚或参考本结构复原。
// ============================================================================

export const WEBOS_DESKTOP_V1_HTML = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover">
<title>系统桌面</title>
<style>
  /* ============ 平台 design tokens（与 Shell 完全同一套，禁止自造色系）============
     来源：client/shell-web/src/styles.css :root —— AI 对话页与桌面共用。
     换壁纸改 --board/--paper（暖纸系），主色 --blue，辅助 --green，
     文字 --ink/--ink-soft/--muted，卡片 --paper-strong/--paper-muted，阴影 --shadow-sm。 */
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
    --shadow-sm: 0 8px 22px rgba(50, 44, 34, .06);   /* 暖阴影（平台统一） */
    --shadow-md: 0 18px 44px rgba(50, 44, 34, .11);
    --radius: 18px;
  }
  * { margin: 0; padding: 0; box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
  html, body { height: 100%; overflow: hidden; touch-action: manipulation; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "SF Pro SC", "PingFang SC",
      "HarmonyOS Sans SC", "MiSans", "Segoe UI", Roboto, sans-serif;
    background: var(--paper);
    color: var(--ink);
    user-select: none;
    -webkit-user-select: none;
    /* 2026-08-08 防长按系统菜单（iOS touch-callout / 部分安卓浏览器）打断桌面长按 */
    -webkit-touch-callout: none;
  }
  /* 壁纸：暖纸渐变（--paper → --board，与 Shell 同体系）+ 三层柔光斑（奶油白/靛蓝/墨绿微光） */
  #wallpaper {
    position: fixed; inset: 0; z-index: 0; overflow: hidden;
    background: linear-gradient(168deg, var(--paper) 0%, var(--board) 100%);
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
  /* 时钟：日期小字在上、时间大字在下，根据安全区避让系统状态栏与居中前摄挖孔，克制优雅 */
  #clock {
    position: fixed;
    top: calc(var(--safe-top, 44px) + 36px);
    left: 0;
    right: 0;
    z-index: 2;
    text-align: center;
    pointer-events: none;
  }
  #clock .date {
    font-size: 12px; font-weight: 600; letter-spacing: 2px; color: var(--ink-soft);
    margin-bottom: 2px;
  }
  #clock .time {
    font-size: 58px; font-weight: 600; letter-spacing: 1px; line-height: 1.12;
    font-variant-numeric: tabular-nums;
    text-shadow: 0 2px 18px rgba(255,255,255,.55);
  }
  #pages {
    position: fixed; inset: 0; z-index: 1;
    display: flex; overflow-x: auto; overflow-y: hidden;
    scroll-snap-type: x mandatory;
    scrollbar-width: none;
  }
  #pages::-webkit-scrollbar { display: none; }
  .page {
    flex: 0 0 100%; height: 100%;
    scroll-snap-align: start;
    display: flex; flex-direction: column;
    padding: calc(var(--safe-top, 44px) + 168px) 16px calc(var(--safe-bottom, 18px) + 96px);
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 24px 6px;
    align-content: start;
    justify-items: center;
  }
  .app {
    width: 100%; display: flex; flex-direction: column; align-items: center;
    gap: 6px; cursor: pointer; position: relative; padding: 4px 0;
    animation: fadeUp .38s ease both;
    /* 2026-08-08 v1.0.29：touch-action:none——图标不做浏览器滚动手势判定，
       touch 事件流完整（touchend 可靠触发）。此前靠 touchstart preventDefault，
       部分 WebView（魅族等）preventDefault 后 touchend 不派发 → 短按打不开、
       长按只变大不弹菜单。touch-action 是标准方案，比 preventDefault 可靠。 */
    touch-action: none;
  }
  .app .tile {
    width: 58px; height: 58px;
    display: flex; align-items: center; justify-content: center;
    overflow: visible;
    background: transparent; border: none; box-shadow: none;
    transition: transform .16s ease;
  }
  .app:active .tile { transform: scale(.88); }
  .app .tile img { width: 56px; height: 56px; display: block; border-radius: 15px; box-shadow: 0 4px 14px rgba(50,44,34,.12); }
  .app .tile svg { width: 56px; height: 56px; display: block; filter: drop-shadow(0 4px 10px rgba(50,44,34,.12)); }
  /* 图片 icon 长按会触发浏览器图片菜单（保存/复制）打断系统长按菜单——
     图片不接收指针事件，长按/右键落在 .app 上，菜单正常弹出 */
  .app .tile img { pointer-events: none; -webkit-touch-callout: none; -webkit-user-select: none; user-select: none; }
  .app .name {
    font-size: 10.5px; font-weight: 550;
    text-align: center; max-width: 100%;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    color: var(--ink);
    text-shadow: 0 1px 3px rgba(255,255,255,.6);
  }
  .app .remove {
    position: absolute; top: -4px; right: calc(50% - 33px);
    width: 20px; height: 20px; border-radius: 50%;
    background: var(--red, #a54b49); color: #fff; border: none;
    font-size: 12px; line-height: 20px; text-align: center;
    display: none; cursor: pointer; z-index: 3;
    box-shadow: 0 2px 6px rgba(165,75,73,.4);
  }
  .app.editing { animation: wiggle 0.4s ease-in-out infinite; }
  .app.editing .remove { display: block; }
  @keyframes wiggle {
    0%, 100% { transform: rotate(0deg); }
    25% { transform: rotate(-2.5deg); }
    75% { transform: rotate(2.5deg); }
  }
  @keyframes fadeUp {
    from { opacity: 0; transform: translateY(12px); }
    to { opacity: 1; transform: none; }
  }
  .app.dragging { opacity: 0.6; transform: scale(1.08); z-index: 99; transition: none; }
  /* 长按待命（450ms 后、抬手前）：图标轻微抬起，提示"可以拖了" */
  .app.armed .tile { transform: scale(1.1) translateY(-3px); box-shadow: 0 10px 24px rgba(50,44,34,.18); border-radius: 15px; }
  /* 整理模式：锁定页面滚动（拖拽排序时页面不能横滑） */
  #pages.locked { overflow-x: hidden; }
  #pages.locked #grid { touch-action: none; }
  #pages.locked .app { animation-play-state: paused; }
  #dots {
    position: fixed;
    bottom: calc(var(--safe-bottom, env(safe-area-inset-bottom, 16px)) + 86px);
    left: 0; right: 0; z-index: 2;
    display: flex; justify-content: center; gap: 5px;
  }
  #dots i {
    width: 6px; height: 6px; border-radius: 50%;
    background: rgba(23, 25, 24, 0.18);
    transition: all 0.25s ease;
  }
  #dots i.active { background: var(--blue); width: 18px; border-radius: 3px; }
  /* 玻璃 Dock：与对话页 composer 同质感（暖白毛玻璃 + 暖阴影） */
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
    position: fixed; bottom: calc(env(safe-area-inset-bottom) + 148px);
    left: 0; right: 0; z-index: 2; text-align: center;
    font-size: 11.5px; color: var(--ink-soft);
    opacity: 0; transition: opacity 0.25s ease; pointer-events: none;
  }
  .hint.show { opacity: 1; }
  /* 自绘确认框（sandbox 无 allow-modals，window.confirm 静默失败） */
  #confirm {
    position: fixed; inset: 0; z-index: 10;
    display: none; align-items: center; justify-content: center;
    background: rgba(50, 44, 34, 0.42);
    padding: 28px;
  }
  #confirm.show { display: flex; }
  #confirm .box {
    width: 100%; max-width: 290px;
    background: var(--paper-strong); border-radius: 18px;
    padding: 20px 16px 14px;
    box-shadow: 0 18px 50px rgba(50, 44, 34, 0.25);
    text-align: center;
  }
  #confirm .box strong { display: block; font-size: 15px; }
  #confirm .box p { font-size: 12px; color: var(--ink-soft); margin: 8px 0 14px; line-height: 1.5; }
  #confirm .box .row { display: flex; gap: 10px; }
  #confirm .box button {
    flex: 1; height: 40px; border: none; border-radius: 12px;
    font-size: 14px; font-weight: 600; cursor: pointer;
  }
  #confirm .box .cancel { background: var(--paper-muted); color: var(--ink); }
  #confirm .box .ok { background: var(--red, #a54b49); color: #fff; }
  /* 长按 App 菜单（自绘，sandbox 无 allow-modals） */
  #appmenu {
    position: fixed; inset: 0; z-index: 11;
    display: none; align-items: center; justify-content: center;
    background: rgba(50, 44, 34, 0.45);
    padding: 28px;
  }
  #appmenu.show { display: flex; }
  #appmenu .box {
    width: 100%; max-width: 300px;
    background: var(--paper-strong); border-radius: 20px;
    padding: 18px 16px 12px;
    box-shadow: 0 18px 50px rgba(50, 44, 34, 0.28);
  }
  #appmenu .m-title { font-size: 15px; font-weight: 700; text-align: center; }
  #appmenu .m-sub { font-size: 11px; color: var(--ink-soft); text-align: center; margin: 3px 0 10px; }
  #appmenu button.m-item {
    display: flex; align-items: center; gap: 10px;
    width: 100%; height: 46px;
    border: none; background: transparent; border-radius: 12px;
    font-size: 14px; font-weight: 600; color: var(--ink);
    cursor: pointer; padding: 0 12px;
  }
  #appmenu button.m-item:active { background: var(--paper-muted); }
  #appmenu button.m-item.m-danger { color: var(--red, #a54b49); }
  #appmenu button.m-item.m-disabled { color: var(--muted-light); pointer-events: none; }
  #appmenu .m-sep { height: 1px; background: var(--line); margin: 6px 0; }
  /* 顶部轻提示（发布/下载结果） */
  #toast {
    position: fixed; top: max(env(safe-area-inset-top), 16px); left: 50%;
    transform: translateX(-50%); z-index: 20;
    max-width: 86vw; text-align: center;
    background: rgba(23, 25, 24, 0.92); color: #fff;
    font-size: 12.5px; padding: 9px 16px; border-radius: 999px;
    opacity: 0; pointer-events: none; transition: opacity 0.25s ease;
  }
  #toast.show { opacity: 1; }
  @media (prefers-reduced-motion: reduce) {
    .app { animation: none; }
    .app.editing { animation: none; }
    .dock button { transition: none; }
  }
</style>
</head>
<body>
<div id="wallpaper"><span class="blob"></span></div>
<div id="clock"><div class="date"></div><div class="time"></div></div>
<main id="pages"><section class="page"><div class="grid" id="grid"></div></section></main>
<div id="dots"></div>
<p class="hint" id="hint">拖拽调整位置 · 点角标删除</p>
<div id="confirm"><div class="box"><strong id="confirm-title"></strong><p id="confirm-desc"></p><div class="row"><button class="cancel" id="confirm-cancel">取消</button><button class="ok" id="confirm-ok">删除</button></div></div></div>
<div id="appmenu"><div class="box"><div class="m-title" id="menu-title"></div><div class="m-sub" id="menu-sub"></div><div id="menu-actions"></div></div></div>
<div id="toast"></div>
<footer class="dock">
  <button data-sys="assistant" aria-label="Daily AI"><svg viewBox="0 0 24 24" fill="none" stroke="#4f6ef7" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l1.9 5.7L19.6 10l-5.7 1.9L12 17.6l-1.9-5.7L4.4 10l5.7-1.3z"/></svg></button>
  <button data-sys="files" aria-label="文件"><svg viewBox="0 0 24 24" fill="none" stroke="#0ea5e9" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 3h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg></button>
  <button data-sys="trash" aria-label="回收站"><svg viewBox="0 0 24 24" fill="none" stroke="#6b7070" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2M6 6l1 14a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-14"/><path d="M10 11v6M14 11v6"/></svg></button>
</footer>

<script>
(function () {
  "use strict";
  // ---------------- 全局 touch 时间记录（v1.0.35：遮罩 click 区分"抬手合成"与"真实点击"） ----------------
  // 抬手合成的 click 必然在 touchend 后 <300ms 内；真实点遮罩在抬手之后更晚。
  document.addEventListener("touchend", function () {
    window.__lastTouchEndAt = Date.now();
  }, true);

  // ---------------- DesktopSDK（纯 postMessage 直连宿主，无握手） ----------------
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
    },
    // 2026-08-23 桌面接入 API（宿主代理；仅登录用户可用，服务端强制）：
    //   http.request → POST /webos/api/http（外部 API 代理，SSRF+限频在服务端）
    //   api.invoke   → POST /webos/api/appapi/:ns/:ep（App API 端点，游客拒 R13）
    http: {
      request: function (opts) {
        opts = opts || {};
        return call("system.http", { url: opts.url, method: opts.method, headers: opts.headers, body: opts.body });
      }
    },
    api: {
      invoke: function (namespace, endpoint, params) {
        return call("api.invoke", { namespace: namespace, endpoint: endpoint, params: params });
      }
    },
    // 2026-08-23 桌面直接 AI 对话：经宿主代理 /webos/api/chat/stream（调用者本人计费）
    ai: {
      chat: function (opts) {
        opts = opts || {};
        return call("ai.chat", { prompt: opts.prompt, messages: opts.messages, thinkingBudget: opts.thinkingBudget });
      }
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

  // ---------------- 渲染 ----------------
  var grid = document.getElementById("grid");
  var dots = document.getElementById("dots");
  var hint = document.getElementById("hint");
  var allApps = [];

  function svgIcon(app) {
    if (app.icon) {
      if (app.icon.indexOf('data:') === 0 || app.icon.indexOf('/webos/api/') === 0) {
        return '<img alt="" src="' + app.icon + '">';
      }
      return '<img alt="" src="data:image/svg+xml;utf8,' + encodeURIComponent(app.icon) + '">';
    }
    // 系统图标：平台色板（靛蓝主色 #315bd6 / 墨绿辅助 #376b53 / 暖灰中性）+ 顶部高光
    var fallback = {
      "daily.ai": '<svg viewBox="0 0 128 128" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="gdai" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#5b7cf0"/><stop offset=".55" stop-color="#315bd6"/><stop offset="1" stop-color="#2743a8"/></linearGradient></defs><rect x="6" y="6" width="116" height="116" rx="28" fill="url(#gdai)"/><ellipse cx="64" cy="22" rx="50" ry="16" fill="rgba(255,255,255,.28)"/><path d="M64 30c-17.6 0-32 12.5-32 28 0 9 5 17 13.2 22.2L42 90l12.2-6.3c3.2.7 6.5 1.1 9.8 1.1 17.6 0 32-12.5 32-28S81.6 30 64 30z" fill="#fff"/><circle cx="50.5" cy="57" r="4.6" fill="#315bd6"/><circle cx="64" cy="57" r="4.6" fill="#315bd6"/><circle cx="77.5" cy="57" r="4.6" fill="#315bd6"/><path d="M90 20l1.6 4.8 4.8 1.6-4.8 1.6-1.6 4.8-1.6-4.8-4.8-1.6 4.8-1.6z" fill="#fff" opacity=".9"/><path d="M42 24l1.2 3.6 3.6 1.2-3.6 1.2-1.2 3.6-1.2-3.6-3.6-1.2 3.6-1.2z" fill="#fff" opacity=".8"/></svg>',
      "system.desktop": '<svg viewBox="0 0 128 128" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="gdesk" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#5d8a76"/><stop offset=".55" stop-color="#376b53"/><stop offset="1" stop-color="#274f3e"/></linearGradient></defs><rect x="6" y="6" width="116" height="116" rx="28" fill="url(#gdesk)"/><ellipse cx="64" cy="22" rx="50" ry="16" fill="rgba(255,255,255,.26)"/><rect x="26" y="32" width="76" height="50" rx="9" fill="#fff"/><rect x="31" y="37" width="28" height="20" rx="5" fill="#5d8a76"/><rect x="63" y="37" width="24" height="20" rx="5" fill="#8fb3a0"/><path d="M52 94h24M64 82v12" stroke="#fff" stroke-width="7" stroke-linecap="round"/></svg>',
      "system.files": '<svg viewBox="0 0 128 128" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="gfile" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#6f8fd8"/><stop offset=".55" stop-color="#4a68c9"/><stop offset="1" stop-color="#315bd6"/></linearGradient></defs><rect x="6" y="6" width="116" height="116" rx="28" fill="url(#gfile)"/><ellipse cx="64" cy="22" rx="50" ry="16" fill="rgba(255,255,255,.28)"/><path d="M22 48c0-8 6.5-14 14.5-14h13.5l9 12h35c8 0 14.5 6 14.5 14v22c0 8-6.5 14-14.5 14H36.5c-8 0-14.5-6-14.5-14V48z" fill="#fff"/><rect x="36" y="56" width="50" height="8" rx="4" fill="#4a68c9"/><rect x="36" y="70" width="34" height="8" rx="4" fill="#a9bcee"/></svg>',
      "system.store": '<svg viewBox="0 0 128 128" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="gstore" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#d9b98c"/><stop offset=".55" stop-color="#b8893f"/><stop offset="1" stop-color="#8a6428"/></linearGradient></defs><rect x="6" y="6" width="116" height="116" rx="28" fill="url(#gstore)"/><ellipse cx="64" cy="22" rx="50" ry="16" fill="rgba(255,255,255,.3)"/><path d="M30 52l6-14h56l6 14" fill="none" stroke="#fff" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/><path d="M30 52h68v34c0 8-7 14-15 14H45c-8 0-15-6-15-14V52z" fill="#fff"/><path d="M52 62v12c0 7 5 12 12 12s12-5 12-12V62" fill="none" stroke="#b8893f" stroke-width="7" stroke-linecap="round"/></svg>',
      "system.trash": '<svg viewBox="0 0 128 128" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="gtrash" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#9aa0a0"/><stop offset=".55" stop-color="#6b7070"/><stop offset="1" stop-color="#4a4f4f"/></linearGradient></defs><rect x="6" y="6" width="116" height="116" rx="28" fill="url(#gtrash)"/><ellipse cx="64" cy="22" rx="50" ry="16" fill="rgba(255,255,255,.24)"/><path d="M32 44h64M44 44l3-10c1-4 4-6 8-6h18c4 0 7 2 8 6l3 10" fill="none" stroke="#fff" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/><path d="M37 50l5 40c1 8 7 13 15 13h14c8 0 14-5 15-13l5-40" fill="#fff"/><path d="M51 62v34M64 62v34M77 62v34" stroke="#6b7070" stroke-width="6" stroke-linecap="round"/></svg>',
      "system.settings": '<svg viewBox="0 0 128 128" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="gset" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#d8d6cf"/><stop offset=".55" stop-color="#b5b2a8"/><stop offset="1" stop-color="#8f8c82"/></linearGradient></defs><rect x="6" y="6" width="116" height="116" rx="28" fill="url(#gset)"/><ellipse cx="64" cy="22" rx="50" ry="16" fill="rgba(255,255,255,.4)"/><path d="M64 26v12M64 90v12M26 64h12M90 64h12M38 38l8.5 8.5M81.5 81.5l8.5 8.5M90 38l-8.5 8.5M46.5 81.5L38 90" stroke="#fff" stroke-width="9" stroke-linecap="round"/><circle cx="64" cy="64" r="17" fill="#fff"/><circle cx="64" cy="64" r="7" fill="#8f8c82"/></svg>'
    };
    if (fallback[app.id]) return fallback[app.id];
    // 用户 App 兜底：按名称哈希从 10 组渐变中稳定取色 + 白色首字母 + 顶部高光——
    // 不再全灰同款，每个 App 有自己的配色与首字母，一眼可辨（iOS 风格）
    return hashIcon(app.name);
  }

  // 用户 App 图标池（名称哈希 → 平台色板衍生渐变 + 首字母）
  var ICON_GRADIENTS = [
    ['#5b7cf0', '#315bd6', '#2743a8'], // 靛蓝（主色）
    ['#6f8fd8', '#4a68c9', '#2f4a9e'], // 天青
    ['#5d8a76', '#376b53', '#274f3e'], // 墨绿（辅助色）
    ['#8a9b6f', '#6b7f55', '#4e6140'], // 苔绿
    ['#c07a6f', '#a54b49', '#7e3735'], // 陶土红
    ['#8a7bc0', '#6b5ba8', '#4d4180'], // 紫罗兰
    ['#c07a9b', '#a54b7e', '#7e375f'], // 玫瑰
    ['#c9a76b', '#a97f3f', '#7f5c2a'], // 琥珀
    ['#5f8f8f', '#3f6f6f', '#2a4f4f'], // 青灰
    ['#9aa0a0', '#6b7070', '#4a4f4f']  // 暖灰
  ];
  var iconSeq = 0;
  function hashIcon(name) {
    var n = 0;
    var s = String(name || '?');
    for (var i = 0; i < s.length; i++) n = (n * 31 + s.charCodeAt(i)) >>> 0;
    var g = ICON_GRADIENTS[n % ICON_GRADIENTS.length];
    var gid = 'gapp' + (++iconSeq);
    var letter = escapeHtml(s.slice(0, 1));
    return '<svg viewBox="0 0 128 128" xmlns="http://www.w3.org/2000/svg">'
      + '<defs><linearGradient id="' + gid + '" x1="0" y1="0" x2="1" y2="1">'
      + '<stop offset="0" stop-color="' + g[0] + '"/><stop offset=".55" stop-color="' + g[1] + '"/><stop offset="1" stop-color="' + g[2] + '"/></linearGradient></defs>'
      + '<rect x="6" y="6" width="116" height="116" rx="28" fill="url(#' + gid + ')"/>'
      + '<ellipse cx="64" cy="22" rx="50" ry="16" fill="rgba(255,255,255,.26)"/>'
      + '<text x="64" y="82" font-size="52" font-weight="700" text-anchor="middle" fill="#fff" font-family="-apple-system,BlinkMacSystemFont,PingFang SC,sans-serif">' + letter + '</text>'
      + '</svg>';
  }

  var editing = false;
  // ---------------- 拖拽排序（2026-08-12：touch/鼠标统一，替代 HTML5 DnD） ----------------
  // HTML5 draggable 在移动端不触发（iOS/Android 均不支持 touch 拖放），
  // 改用 pointer/touch 事件自绘：拖拽中的图标 transform 跟随手指，实时与
  // 落点图标交换 DOM 顺序，松手后调 SDK.apps.reorder 持久化。
  // AI 可改：调整阈值 / 视觉 / 跨页拖放（当前为页内排序）。
  var dragEl = null;          // 被拖拽的 .app 元素
  var dragStarted = false;    // 位移超过阈值（真正进入拖拽）
  var dragJustEnded = false;  // 拖拽刚结束（抑制随后的 click 打开 App）
  var dragLastX = 0, dragLastY = 0;
  var dragGrid = null;        // 被拖元素所在 grid（多页时定位用）
  var pagesEl = document.getElementById("pages");

  function syncOrderFromDom() {
    var ordered = [];
    grid.querySelectorAll(".app").forEach(function (el2) {
      ordered.push(el2.dataset.id);
    });
    var byId = {};
    allApps.forEach(function (a) { byId[a.id] = a; });
    allApps = ordered.map(function (id) { return byId[id]; }).filter(Boolean);
  }

  function beginDrag(app2, el2, x, y, originX, originY) {
    if (dragEl) return;
    if (!editing) enterEdit();
    pagesEl.classList.add("locked");
    dragEl = el2;
    dragStarted = false;
    // 位移基准 = 手指按下原点（长按拖动时是 touchstart 位置；整理模式按下即当前点）
    dragLastX = (originX !== undefined) ? originX : x;
    dragLastY = (originY !== undefined) ? originY : y;
    el2.classList.add("dragging");
    el2.classList.remove("armed");
    el2.style.zIndex = "99";
    // 记录原位置（供落点偏移计算）
    var r = el2.getBoundingClientRect();
    dragOffsetX = x - (r.left + r.width / 2);
    dragOffsetY = y - (r.top + r.height / 2);
  }
  var dragOffsetX = 0, dragOffsetY = 0;

  function moveDrag(x, y) {
    if (!dragEl) return;
    // 位移超过阈值才视为拖拽（防止按下即抖）
    if (!dragStarted) {
      if (Math.abs(x - dragLastX) + Math.abs(y - dragLastY) < 10) return;
      dragStarted = true;
    }
    var r = dragEl.getBoundingClientRect();
    var dx = x - dragOffsetX - (r.left + r.width / 2);
    var dy = y - dragOffsetY - (r.top + r.height / 2);
    dragEl.style.transform = "translate(" + dx + "px," + dy + "px) scale(1.08)";
    // 实时落点判定：手指中心所在图标的 DOM 前插入（CSS grid 自动按 DOM 序排列）
    var nodes = grid.querySelectorAll(".app");
    for (var i = 0; i < nodes.length; i++) {
      var c = nodes[i];
      if (c === dragEl) continue;
      var cr = c.getBoundingClientRect();
      if (x >= cr.left && x <= cr.right && y >= cr.top && y <= cr.bottom) {
        // 与当前邻居不同才移动 DOM（避免频繁插入抖动）
        if (c !== dragEl.nextElementSibling && c !== dragEl.previousElementSibling) {
          grid.insertBefore(dragEl, c);
        }
        return;
      }
    }
  }

  function endDrag() {
    if (!dragEl) return;
    dragEl.style.transform = "";
    dragEl.style.zIndex = "";
    dragEl.classList.remove("dragging");
    var moved = dragStarted;
    syncOrderFromDom();
    dragEl = null;
    dragStarted = false;
    if (moved) {
      dragJustEnded = true;
      // 保存排序（异步，失败静默——下次列表刷新恢复原序）
      SDK.apps.reorder(allApps.map(function (a) { return a.id; })).catch(function () {});
    }
    pagesEl.classList.remove("locked");
  }
  // 点击空白区域退出整理模式（2026-08-08：longPressBlank 抑制"长按空白进入整理后
  // 松手产生的 click"——否则刚进整理模式就被这次 click 退出）
  var longPressBlank = false;
  pagesEl.addEventListener("click", function (e) {
    if (longPressBlank) { longPressBlank = false; return; }
    if (!editing) return;
    if (e.target === pagesEl || e.target === grid) exitEdit();
  });
  // 2026-08-08 空白处长按 450ms 进入整理模式（拖动排序唯一入口；长按图标=菜单）。
  // touchstart passive（不阻止滑动），touchmove 取消（滑动页面不算长按）。
  var blankTimer = null;
  pagesEl.addEventListener("touchstart", function (e) {
    if (editing) return;
    if (blankTimer) return;
    if (e.target && e.target.closest && e.target.closest(".app")) return;
    blankTimer = setTimeout(function () {
      blankTimer = null;
      longPressBlank = true;
      enterEdit();
    }, 450);
  }, { passive: true });
  pagesEl.addEventListener("touchmove", function () { clearTimeout(blankTimer); blankTimer = null; }, { passive: true });
  pagesEl.addEventListener("touchend", function () { clearTimeout(blankTimer); blankTimer = null; }, { passive: true });
  pagesEl.addEventListener("touchcancel", function () { clearTimeout(blankTimer); blankTimer = null; }, { passive: true });

  function renderApps() {
    grid.innerHTML = "";
    allApps.forEach(function (app) {
      var el = document.createElement("div");
      el.className = "app";
      el.dataset.id = app.id;
      el.innerHTML =
        '<div class="tile">' + svgIcon(app) + '</div>' +
        '<span class="name">' + escapeHtml(app.name) + '</span>' +
        '<button class="remove" aria-label="删除">×</button>';
      el.addEventListener("click", function (e) {
        if (e.target && e.target.classList && e.target.classList.contains("remove")) {
          removeApp(app.id);
          return;
        }
        if (editing) return;
        // 抬手已由 pointerup/touchend 处理（正常浏览器）→ click 忽略，避免重复打开
        if (touchHandled) { touchHandled = false; return; }
        // 长按弹过菜单后抬手触发的 click 忽略（避免菜单刚弹出又打开 App）
        if (longPressOpened) { longPressOpened = false; return; }
        // 长按拖动刚结束时抬手的 click 忽略（避免排序完误打开 App）
        if (dragJustEnded) { dragJustEnded = false; return; }
        // 终极兜底（touchend/pointerup 均缺失的 WebView）：用 downAt 时间差
        // 判定长按/短按——长按 → 弹菜单，短按 → 打开
        if (downAt && Date.now() - downAt >= 450) {
          downAt = 0;
          longPressOpened = true;
          openMenu(app);
          return;
        }
        SDK.apps.open(app.id);
      });
      // 长按交互（2026-08-08 v1.0.32 终极方案）：
      //  1) 短按（<450ms 抬手）→ 打开 App；长按 450ms 抬手 → 弹菜单（4 项）
      //  2) 空白处长按 450ms → 整理模式（拖动排序入口）
      //  3) 三层保险（任意浏览器必中其一）：
      //     a. touch 事件（现代 WebView）：touchstart/touchend
      //     b. pointerup 双轨（touchend 缺失时，pointerup 在 touchend 前独立派发）
      //     c. click 时间差兜底（任何浏览器 click 必触发）：touchstart 不再
      //        preventDefault（避免抑制 click），.app touch-action:none 已阻止
      //        滚动判定；click 用 downAt 时间差判定长按/短按
      var pressTimer = null, pressX = 0, pressY = 0;
      var longPressOpened = false;
      var armed = false;        // 长按已达 450ms（待命：抬手=菜单）
      var touchHandled = false; // 一次触摸是否已由 pointerup/touchend 处理抬手
      var downAt = 0;           // 最近一次按下时间（click 兜底判定用）
      function startPress(x, y) {
        if (editing) return;
        if (pressTimer) return;
        pressX = x; pressY = y;
        pressTimer = setTimeout(function () {
          pressTimer = null;
          armed = true;
          el.classList.add("armed");
          // v1.0.32：长按达成瞬间即弹菜单（不等抬手）——部分 WebView
          // 长按后 touchend/pointerup 都不派发，等抬手弹菜单永远等不到。
          // 抬手只负责清理 armed 状态；click 兜底有 longPressOpened 防重复。
          longPressOpened = true;
          openMenu(app);
        }, 450);
      }
      function movePress(x, y) {
        // 长按达成后移动：不转拖动（长按=菜单；拖动仅在整理模式内）
        if (armed) return;
        // 未达长按时明显位移（>12px，视为滑动/滚动）取消长按；手指微小抖动不影响
        if (pressTimer && Math.abs(x - pressX) + Math.abs(y - pressY) > 12) clearPress();
      }
      function clearPress() {
        if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; }
        if (armed) { armed = false; el.classList.remove("armed"); }
      }
      // 抬手统一处理（pointerup 优先，touchend 兜底去重）
      function handleRelease() {
        if (editing) { endDrag(); return; }
        if (armed) {
          // 长按达成——菜单已在 450ms 达成瞬间弹出，抬手仅清理待命状态
          armed = false; el.classList.remove("armed");
        } else if (pressTimer !== null) {
          // 短按（未达长按阈值）→ 打开 App
          clearPress();
          SDK.apps.open(app.id);
        }
        clearPress();
      }
      // 触摸优先（移动端真实手势）；touch-action:none 已阻止滚动判定（不 preventDefault，
      // 保留 click 合成作为终极兜底）
      el.addEventListener("touchstart", function (e) {
        if (editing) { e.preventDefault(); beginDrag(app, el, e.touches[0].clientX, e.touches[0].clientY); return; }
        var t = e.touches[0];
        if (!t) return;
        downAt = Date.now();
        touchHandled = false;
        if (!pressTimer && !armed) startPress(t.clientX, t.clientY);
      }, { passive: false });
      el.addEventListener("touchmove", function (e) {
        var t = e.touches[0];
        if (!t) return;
        if (editing) {
          if (dragEl) { e.preventDefault(); moveDrag(t.clientX, t.clientY); }
          return;
        }
        movePress(t.clientX, t.clientY);
      }, { passive: false });
      el.addEventListener("touchend", function (e) {
        if (touchHandled) { clearPress(); return; }
        touchHandled = true;
        handleRelease();
      }, { passive: false });
      el.addEventListener("touchcancel", function () {
        if (editing) { endDrag(); return; }
        clearPress();
      });
      // 指针设备双轨：pointerup（含 touch 类型）在 touchend 之前独立派发——
      // 部分 WebView touchend 不派发时仍能可靠处理抬手；鼠标路径同逻辑。
      el.addEventListener("pointerdown", function (e) {
        if (e.pointerType === 'touch') {
          if (editing) return;
          downAt = Date.now();
          if (!pressTimer && !armed) startPress(e.clientX, e.clientY);
          return;
        }
        if (editing) { beginDrag(app, el, e.clientX, e.clientY); return; }
        downAt = Date.now();
        startPress(e.clientX, e.clientY);
      });
      el.addEventListener("pointerup", function (e) {
        if (e.pointerType === 'touch') {
          if (touchHandled) { clearPress(); return; }
          touchHandled = true;
          handleRelease();
          return;
        }
        if (editing) { endDrag(); return; }
        touchHandled = true;
        handleRelease();
      });
      el.addEventListener("pointerleave", function (e) {
        if (editing) return;
        // touch 指针序列在 pointerup 后（touchend 前）会派发 pointerleave，
        // 无条件 clearPress 会把长按 armed 清掉；touch 抬手由 pointerup/touchend 处理。
        if (e.pointerType === 'touch') return;
        clearPress();
      });
      el.addEventListener("pointercancel", function () {
        if (editing) { endDrag(); return; }
        clearPress();
      });
      el.addEventListener("pointermove", function (e) {
        if (e.pointerType === 'touch') return;
        if (editing) { if (dragEl) moveDrag(e.clientX, e.clientY); return; }
        movePress(e.clientX, e.clientY);
      });
      // 桌面端右键也弹长按菜单（统一体验；阻止浏览器默认菜单）
      el.addEventListener("contextmenu", function (e) {
        e.preventDefault();
        if (editing) return;
        clearPress();
        longPressOpened = true;
        openMenu(app);
      });
      grid.appendChild(el);
    });
  }

  function enterEdit() {
    editing = true;
    grid.querySelectorAll(".app").forEach(function (el) { el.classList.add("editing"); });
    hint.classList.add("show");
    pagesEl.classList.add("locked");
  }
  function exitEdit() {
    editing = false;
    grid.querySelectorAll(".app").forEach(function (el) { el.classList.remove("editing"); });
    hint.classList.remove("show");
    pagesEl.classList.remove("locked");
  }
  function removeApp(id) {
    var app = allApps.filter(function (a) { return a.id === id; })[0];
    if (!app) return;
    var box = document.getElementById("confirm");
    document.getElementById("confirm-title").textContent = "删除「" + app.name + "」？";
    document.getElementById("confirm-desc").textContent = "App 文件夹将移入回收站（apps/.trash/），AI 仍可读取与恢复。";
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
        renderApps();
        if (!allApps.some(function (a) { return a.source !== "builtin"; })) exitEdit();
      }).catch(function () {
        renderApps();
      });
    };
  }
  // ---------------- 长按菜单（分享 / 下载 / 上传商店 / 删除） ----------------
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
  // v1.0.36（2026-08-16）：宿主系统返回钩子——菜单/确认框打开时宿主先问本函数，
  // 返回 true（已处理）则宿主不退出 Daily；返回 false 宿主走默认（退出）。
  window.__dailySystemBack = function () {
    var m = document.getElementById("appmenu");
    if (m.classList.contains("show")) { closeMenu(); return true; }
    var c = document.getElementById("confirm");
    if (c.classList.contains("show")) { c.classList.remove("show"); return true; }
    return false;
  };
  function openMenu(app) {
    document.getElementById("menu-title").textContent = app.name;
    var SYSTEM_IDS = { "daily.ai": 1, "system.desktop": 1, "system.store": 1, "system.files": 1 };
    var isSystem = app.source === "builtin" || Boolean(SYSTEM_IDS[app.id]);
    document.getElementById("menu-sub").textContent = isSystem
      ? "系统应用" : (app.source === "ai_generated" ? "AI 生成" : app.source === "local_import" ? "本地导入" : "商店安装");
    var actions = document.getElementById("menu-actions");
    actions.innerHTML = "";
    if (!isSystem) {
      // 2026-08-08 菜单固定四项（用户决策）：分享给朋友 / 上传到应用商店 / 下载源码 / 删除
      // 分享给朋友：不发布商店，生成纯链接交给宿主弹系统分享面板（Web Share API）
      var friendBtn = menuItem("分享给朋友");
      friendBtn.onclick = function () {
        closeMenu();
        SDK.apps.shareToFriend(app.id).catch(function (e) { toast("分享失败：" + e.message); });
      };
      actions.appendChild(friendBtn);
      // 分享 / 上传商店（本质都是发布：拿到分享链接并复制）
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
      // 下载源码 zip
      var dlBtn = menuItem("下载源码 ZIP");
      dlBtn.onclick = function () {
        closeMenu();
        SDK.apps.exportZip(app.id).then(function (r) {
          return SDK.apps.download(r.url, app.id + ".zip");
        }).then(function () { toast("开始下载源码（index.html + assets/）"); })
          .catch(function (e) { toast("下载失败：" + e.message); });
      };
      actions.appendChild(dlBtn);
      var delBtn = menuItem("删除（移入回收站）", true);
      delBtn.onclick = function () { closeMenu(); removeApp(app.id); };
      actions.appendChild(delBtn);
    } else {
      var note = menuItem("系统应用，不可分享 / 下载 / 删除", false, true);
      actions.appendChild(note);
    }
    var box = document.getElementById("appmenu");
    // v1.0.36（2026-08-16）：遮罩关闭改 pointerdown——Android WebView 中 click 在
    // touchend 后立即合成（<300ms），v1.0.35 的时间窗会把所有正常点击误判为"抬手合成"
    // 而忽略 → 菜单点不掉。pointerdown 无合成延迟，PWA 与 Android 均可靠。
    box.classList.add("show");
    box.addEventListener("pointerdown", function (e) {
      if (e.target !== box) return;
      closeMenu();
    });
  }
  function persistOrder(ids) {
    allApps = ids.map(function (id) {
      var found = allApps.filter(function (a) { return a.id === id; })[0];
      return found;
    }).filter(Boolean);
    renderApps();
    SDK.apps.reorder(ids).catch(function () {});
  }
  function escapeHtml(text) {
    return String(text).replace(/[&<>"']/g, function (ch) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': '"', "'": "&#39;" }[ch];
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

  // ---------------- Dock ----------------
  document.querySelectorAll(".dock button").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var sys = btn.dataset.sys;
      if (sys === "trash") { SDK.apps.open("system.trash").catch(function () {}); return; }
      SDK.system.navigate(sys);
    });
  });

  // ---------------- 启动（无需握手，postMessage 直连） ----------------
  tick();
  setInterval(tick, 30000);
  // 宿主通知「App 列表已变化」（AI 创建/删除 App）→ 重新拉取渲染
  window.addEventListener("message", function (e) {
    var msg = e.data;
    if (!msg || typeof msg !== "object") return;
    if (msg.channel !== "daily-webos-sdk" || msg.kind !== "apps_changed") return;
    SDK.apps.list().then(function (apps) {
      allApps = apps || [];
      renderApps();
    }).catch(function () { /* 拉取失败保持现状 */ });
  });
  SDK.apps.list().then(function (apps) {
    allApps = apps || [];
    renderApps();
    dots.innerHTML = '<i class="active"></i>';
    var pages = document.getElementById("pages");
    pages.addEventListener("scroll", function () {
      var idx = Math.round(pages.scrollLeft / pages.clientWidth);
      var items = dots.querySelectorAll("i");
      items.forEach(function (dot, i) { dot.className = i === idx ? "active" : ""; });
    });
  }).catch(function (err) {
    grid.innerHTML = '<p style="color:var(--ink-soft);font-size:12px;grid-column:1/-1;text-align:center;padding-top:30px;">桌面数据加载失败：' + escapeHtml(err.message || '') + '</p>';
  });
  document.body.addEventListener("click", function (e) {
    if (editing && !e.target.closest(".app") && !e.target.closest(".dock")) exitEdit();
  });
})();
</script>
</body>
</html>`