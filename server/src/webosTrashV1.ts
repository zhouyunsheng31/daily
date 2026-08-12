// ============================================================================
// 系统回收站 v1（2026-08-06）
// ----------------------------------------------------------------------------
// system.trash 是版本化 HTML App（同 system.desktop / system.store）。
// 数据全部来自宿主 HTTP API（App SDK 的 http 代理，带 cookie 过鉴权）：
//   GET    /webos/api/apps/trash                    — 回收站列表
//   POST   /webos/api/apps/trash/:appId/restore     — 恢复（移回 apps/ 自动重新注册）
//   DELETE /webos/api/apps/trash/:appId             — 彻底删除
//   POST   /webos/api/apps/trash/empty              — 清空回收站
// AI 也可以直接改这个 App 的形态（apps/system.trash/index.html）。
// iframe sandbox="allow-scripts"（opaque origin）：localStorage 由宿主 polyfill。
// ============================================================================

export const WEBOS_TRASH_V1_HTML = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover">
<title>回收站</title>
<style>
  :root {
    --bg-1: #eef1f6; --bg-2: #dfe6f3; --ink: #1c2333; --ink-soft: #6b7280;
    --card: rgba(255,255,255,0.82); --accent: #4f6ef7; --danger: #e5484d;
    --ok: #1a9d5c; --shadow: 0 8px 24px rgba(30,41,59,0.10); --radius: 16px;
  }
  * { margin:0; padding:0; box-sizing:border-box; -webkit-tap-highlight-color:transparent; }
  body { font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","HarmonyOS Sans SC","MiSans","Segoe UI",Roboto,sans-serif; background:linear-gradient(160deg,var(--bg-1),var(--bg-2)); color:var(--ink); min-height:100vh; }
  header { position:sticky; top:0; z-index:10; padding:14px 18px; display:flex; align-items:center; gap:10px; background:rgba(238,241,246,0.9); backdrop-filter:blur(14px); border-bottom:1px solid rgba(28,35,51,0.06); }
  header .back { width:32px; height:32px; border-radius:10px; border:0; background:rgba(255,255,255,0.8); color:var(--ink); font-size:16px; cursor:pointer; }
  header h1 { font-size:16px; flex:1; }
  header .empty-btn { border:0; background:none; color:var(--danger); font-size:13px; cursor:pointer; padding:6px 8px; }
  main { padding:14px 16px calc(20px + env(safe-area-inset-bottom)); max-width:480px; margin:0 auto; }
  .empty-state { text-align:center; padding:60px 20px; color:var(--ink-soft); }
  .empty-state .big { font-size:42px; margin-bottom:10px; }
  .card { display:flex; align-items:center; gap:12px; background:var(--card); border-radius:var(--radius); padding:12px 14px; margin-bottom:10px; box-shadow:var(--shadow); animation:fadeUp .25s ease; }
  .icon { width:46px; height:46px; border-radius:12px; background:linear-gradient(135deg,#c3cdff,#e5e9fb); flex-shrink:0; display:flex; align-items:center; justify-content:center; overflow:hidden; font-size:20px; }
  .icon img { width:100%; height:100%; object-fit:cover; }
  .info { flex:1; min-width:0; }
  .info .name { font-size:14px; font-weight:600; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .info .meta { font-size:11px; color:var(--ink-soft); margin-top:2px; }
  .ops { display:flex; gap:6px; flex-shrink:0; }
  .ops button { border:0; border-radius:10px; padding:7px 10px; font-size:12px; cursor:pointer; font-weight:600; }
  .restore { background:rgba(79,110,247,0.12); color:var(--accent); }
  .purge { background:rgba(229,72,77,0.10); color:var(--danger); }
  .toast { position:fixed; left:50%; bottom:40px; transform:translateX(-50%); background:rgba(28,35,51,0.92); color:#fff; padding:10px 18px; border-radius:999px; font-size:13px; opacity:0; pointer-events:none; transition:opacity .25s; z-index:99; max-width:82vw; text-align:center; }
  .toast.show { opacity:1; }
  @keyframes fadeUp { from { opacity:0; transform:translateY(6px);} to { opacity:1; transform:none; } }
</style>
</head>
<body>
<header>
  <button class="back" id="backBtn" aria-label="返回">‹</button>
  <h1>回收站</h1>
  <button class="empty-btn" id="emptyBtn" style="display:none">清空</button>
</header>
<main id="list"></main>
<div class="toast" id="toast"></div>
<script>
  var toastTimer = null
  function toast(msg) {
    var el = document.getElementById('toast')
    el.textContent = msg; el.classList.add('show')
    clearTimeout(toastTimer); toastTimer = setTimeout(function(){ el.classList.remove('show') }, 2200)
  }
  function esc(s) { return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'"') }
  function fmtSize(b) { if (!b) return '0B'; var u=['B','KB','MB','GB'],i=0,n=b; while(n>=1024&&i<3){n/=1024;i++} return n.toFixed(n>=10||i===0?0:1)+u[i] }
  function fmtTime(t) { if (!t) return ''; var d=new Date(t),p=function(x){return x<10?'0'+x:x}; return d.getFullYear()+'-'+p(d.getMonth()+1)+'-'+p(d.getDate())+' '+p(d.getHours())+':'+p(d.getMinutes()) }
  function render(items) {
    var list = document.getElementById('list'), emptyBtn = document.getElementById('emptyBtn')
    emptyBtn.style.display = items.length ? 'block' : 'none'
    if (!items.length) {
      list.innerHTML = '<div class="empty-state"><div class="big">🗑️</div><p>回收站是空的</p><p style="font-size:12px;margin-top:6px">删除的 App 会先到这里，可以随时恢复</p></div>'
      return
    }
    list.innerHTML = items.map(function(it){
      var iconHtml = it.icon && it.icon.startsWith('data:')
        ? '<img src="' + it.icon + '" alt="">'
        : '<span>📦</span>'
      return '<div class="card"><div class="icon">' + iconHtml + '</div>' +
        '<div class="info"><div class="name">' + esc(it.name || it.appId) + '</div>' +
        '<div class="meta">' + esc(it.appId) + ' · ' + fmtSize(it.size) + ' · ' + fmtTime(it.deletedAt) + '</div></div>' +
        '<div class="ops"><button class="restore" data-act="restore" data-id="' + esc(it.appId) + '">恢复</button>' +
        '<button class="purge" data-act="purge" data-id="' + esc(it.appId) + '">删除</button></div></div>'
    }).join('')
  }
  function load() {
    DailyWebOs.http.request('/webos/api/apps/trash').then(function(res){
      if (res && res.items) render(res.items)
      else if (res && res.error) toast(res.error.message || '加载失败')
      else render([])
    }).catch(function(e){ toast(e && e.message ? e.message : '加载失败，请重试') })
  }
  document.getElementById('list').addEventListener('click', function(e){
    var btn = e.target.closest('button[data-act]')
    if (!btn) return
    var act = btn.getAttribute('data-act'), id = btn.getAttribute('data-id')
    if (act === 'restore') {
      btn.disabled = true
      DailyWebOs.http.request('/webos/api/apps/trash/' + encodeURIComponent(id) + '/restore', { method: 'POST' }).then(function(res){
        if (res && res.ok) { toast('已恢复到桌面'); load() }
        else toast((res && res.error && res.error.message) || '恢复失败')
      }).catch(function(err){ btn.disabled = false; toast(err && err.message ? err.message : '恢复失败') })
    } else if (act === 'purge') {
      if (!confirm('彻底删除「' + id + '」？此操作不可恢复。')) return
      DailyWebOs.http.request('/webos/api/apps/trash/' + encodeURIComponent(id), { method: 'DELETE' }).then(function(res){
        if (res && res.ok) { toast('已彻底删除'); load() }
        else toast((res && res.error && res.error.message) || '删除失败')
      }).catch(function(err){ toast(err && err.message ? err.message : '删除失败') })
    }
  })
  document.getElementById('emptyBtn').addEventListener('click', function(){
    if (!confirm('清空回收站？所有项目将被彻底删除，不可恢复。')) return
    DailyWebOs.http.request('/webos/api/apps/trash/empty', { method: 'POST' }).then(function(res){
      if (res && res.ok) { toast('回收站已清空'); load() }
      else toast((res && res.error && res.error.message) || '清空失败')
    }).catch(function(err){ toast(err && err.message ? err.message : '清空失败') })
  })
  document.getElementById('backBtn').addEventListener('click', function(){
    DailyWebOs.apps.open('system.desktop')
  })
  load()
</script>
</body>
</html>`
