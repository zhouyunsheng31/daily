// Phase 14 C3：必须在所有其他 import 之前加载 worker_threads patch，
// 否则 pi-coding-agent 加载时 undici 会因缺少 markAsUncloneable 崩溃
// （Electron 31 内置 Node 20.x 无此 API，需 no-op 注入）
import './compat/workerThreadsPatch.js'
// S12 Bug 3 修复：dotenv 必须在所有其他 import 之前执行（worker_threads patch 之后），
// 否则 connection.ts 在 ESM import 阶段读取 DB_DRIVER 时 process.env 尚未填充
import 'dotenv/config'
import express, { type Express } from 'express'
import cors from 'cors'
import { createServer } from 'http'
import { fileURLToPath } from 'url'
import path from 'node:path'
import fs from 'node:fs'
import { initDb, closeDb, getPool } from './db/connection.js'
import { getSandboxRoot } from './sandbox/index.js'
import { initializeSchema } from './db/schema.js'
import { seedBuiltinTemplates, seedShowcasePanel } from './db/seed.js'
import { errorHandler } from './middleware/error.js'
import { panelsRouter, getDemoPanel } from './routes/panels.js'
import { widgetsRouter, panelWidgetsRouter } from './routes/widgets.js'
import { entitiesRouter } from './routes/entities.js'
import { entityConflictsRouter } from './routes/entityConflicts.js'
import { syncLogsRouter } from './routes/syncLogs.js'
import { scopesRouter } from './routes/scopes.js'
import { relationsRouter } from './routes/relations.js'
import { settingsRouter } from './routes/settings.js'
import { exportRouter } from './routes/export.js'
import { importRouter } from './routes/import.js'
import { dynamicWidgetsRouter } from './routes/dynamicWidgets.js'
import { panelTemplatesRouter } from './routes/panelTemplates.js'
import { favoritesRouter } from './routes/favorites.js'
import { startWebSocketServer } from './ws.js'
// Phase 14 C4：piBridge 改为动态 import，避免 pi-coding-agent 在模块加载阶段静默挂起
// （Electron 31 / Node 20.18.0 下 ESM import CJS 模块 pi-coding-agent 会卡住）
// 延迟到 server.listen() 回调中再加载，即使加载失败 server 核心功能仍可用
import { authMiddleware } from './middleware/auth.js'
import { authLoginRouter, authProtectedRouter } from './routes/auth.js'
import { emailAuthRouter } from './routes/emailAuth.js'
import { adminRouter } from './routes/admin.js'
import { adminWebosRouter } from './routes/adminWebos.js'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import { runRetentionCleanup } from './db/aiContext.js'
import { ensureUserIpColumns, ensureDisplayNameColumn, ensureServerMetricsTable, ensureStoreSizeBytesColumn, ensureAfdianRedeemColumn, ensureRedeemCodesTable, ensureVideoUsageErrorMessageColumn, ensureChatSessionsTable, ensureVisionUsageTable, ensureVisionModelColumn } from './db/migrations.js'
import { aiSettingsRouter } from './routes/aiSettings.js'
import { skillsRouter } from './routes/skills.js'
import { localServicesRouter } from './routes/localServices.js'
import { proxyRouter } from './routes/proxy.js'
import { conversationsRouter } from './routes/conversations.js'
import { toolsRouter } from './routes/tools.js'
import { searchKeysRouter } from './routes/searchKeys.js'
import { githubProxyRouter } from './routes/githubProxy.js'
import { wikiRouter } from './routes/wiki.js'
import { componentCapabilitiesRouter } from './routes/componentCapabilities.js'
import { webosRouter, loadState, servePublicImageFile, servePublicAppRawFile, servePublicVideoFile, serveSharePreview, serveShareRawFile, serveStoreRawFile } from './routes/webos.js'
import { webosTimeRouter } from './routes/webosTime.js'
import { webosConversationsRouter } from './routes/webosConversations.js'
import { desktopLayoutRouter } from './webos/desktopLayout.js'
// 2026-08-20（W-F）：文件服务一阶段路由
import { filesRouter, ensureFileServiceSchema } from './webos/files/index.js'
// 2026-08-21（W1）：包体系（三表 + 端点族 + app 只读适配视图注入）
import { packagesRouter, ensurePackageSchema, setAppViewProvider } from './webos/packages/index.js'
// 2026-08-21（W2）：App API（handler 受限 vm + owner 级端点 + 计费 kind='api'）
import { appapiRouter, ensureApiUsageSchema, ensureApiPublicSchema } from './webos/appapi/index.js'
// 2026-08-21（W3 互通原语 v1）：共享数据空间 + 事件总线（跨用户，R13 非游客）
import { netRouter, ensureNetSchema } from './webos/net/index.js'
// 2026-08-21（W3 统一包市场 R14）：万物皆可包市场（发布/浏览/安装/依赖闭包 + pi 工具）
import { marketRouter, ensureMarketSchema } from './webos/market/index.js'
import { communitiesRouter } from './routes/communities.js'
import { backgroundRouter, BACKGROUNDS_DIR, quarantineLegacySvgBackgrounds } from './routes/background.js'
import { getSearchKey } from './db/aiSettingsStore.js'
import { initSandbox } from './sandbox/index.js'
// 2026-08-06 服务器负载监控采样（管理后台 + AI 工具 get_server_status 数据源）
import { startServerMonitor, startMetricsPersist } from './utils/serverMonitor.js'
// 2026-08-06 爱发电支付：webhook 回调（免鉴权，RSA 验签）+ API 定时对账
import { handleAfdianOrder, startAfdianSync } from './payment/afdian.js'

// 加载 .env 文件（不依赖 dotenv）
try {
  const envPath = resolve(process.cwd(), '.env')
  const envContent = readFileSync(envPath, 'utf-8')
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eqIndex = trimmed.indexOf('=')
    if (eqIndex > 0) {
      const key = trimmed.substring(0, eqIndex).trim()
      const value = trimmed.substring(eqIndex + 1).trim()
      if (!process.env[key]) {
        process.env[key] = value
      }
    }
  }
  console.log('[Server] .env file loaded')
} catch {
  // .env 文件不存在，忽略
}

const PORT = parseInt(process.env.PORT || '3456', 10)

/**
 * Bug 15 修复：Promise 超时竞速 helper，自动清理 setTimeout 避免内存泄漏
 *
 * 原代码用 Promise.race + setTimeout，setTimeout 在 race 结束后仍保留在事件队列中，
 * 直到超时触发（即使 Promise 已 settle），造成微小内存泄漏。
 *
 * 此 helper 用 .finally() 在 Promise.race 完成后立即清理 setTimeout，
 * 无论 Promise 是 resolve 还是 reject。
 */
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timeout (${ms}ms)`)), ms)
    }),
  ]).finally(() => {
    if (timer) clearTimeout(timer)
  })
}

/**
 * Phase S8.1：Express app 工厂函数（供测试与生产共用）
 *
 * 仅负责 Express 实例化、中间件挂载、路由注册、错误处理挂载。
 * 不做：DB 初始化、httpServer.listen、cron 启动、piBridge 初始化、shutdown handler 注册。
 *
 * 测试时通过 test/helpers/server.ts 调用 createApp() 获取 app，
 * 用 supertest 直接发请求，无需监听端口。
 *
 * 生产时由 main() 调用 createApp() 拿到 app，再 createServer(app).listen(PORT)。
 *
 * Phase S11：参数化 corsOrigin/webPublicDir/skipEnvCheck，支持测试 helper 覆盖。
 */
export interface CreateAppOptions {
  /** 覆盖 CORS_ORIGIN 环境变量（测试 helper 传 'http://localhost'） */
  corsOrigin?: string
  /** 覆盖 WEB_PUBLIC_DIR 环境变量（测试 helper 传 '/nonexistent' 跳过静态托管） */
  webPublicDir?: string
  /** 跳过环境变量校验（测试 helper 传 true） */
  skipEnvCheck?: boolean
}

function createApp(options: CreateAppOptions = {}): { app: Express } {
  const app = express()

  // Phase S11.4：CORS 白名单（credentials:true + 逗号分隔白名单，禁用 *）
  // Phase S11 修复：Electron fork server 模式（桌面端内嵌）跳过 CORS_ORIGIN 校验，
  // 与 main() 中的 isElectronFork 判断保持一致，避免桌面端 fork server 崩溃
  const isElectronFork = process.env.ELECTRON_RUN_AS_NODE === '1'
  const corsOrigin = options.corsOrigin ?? process.env.CORS_ORIGIN
  if (!corsOrigin && !options.skipEnvCheck && !isElectronFork) {
    console.error('[Server] FATAL: CORS_ORIGIN env required.')
    process.exit(1)
  }
  const allowedOrigins = (corsOrigin ?? '').split(',').map((s) => s.trim()).filter(Boolean)

  const corsOptions: cors.CorsOptions = {
    origin: (origin, cb) => {
      // 允许同源请求（origin undefined 时是同源或 curl）
      if (!origin) return cb(null, true)
      if (allowedOrigins.includes(origin)) return cb(null, true)
      cb(null, false)
    },
    credentials: true,
    allowedHeaders: ['Authorization', 'Content-Type', 'X-Device-Id'],
    methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE'],
  }
  app.use(cors(corsOptions))

  // 2026-08-12 用户决策：取消所有单文件大小限制，工作区配额（游客200MB/登录512MB/月卡10-100GB）是唯一闸门。
  // body limit 需与 nginx client_max_body_size 对齐（600m，2026-08-13 修复：nginx 默认 1MB 曾导致 >750KB 文件全部 413）。
  // 上传文件以 base64 置于 JSON body（膨胀 ~4/3），600MB body ≈ 450MB 原文件，覆盖常规场景。
  app.use(express.json({ limit: '600mb' }))

  // 健康检查（不需要认证，供 detectBackend 探测）
  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: Date.now() })
  })

  // Phase S11.2：auth/login 免鉴权（必须在 authMiddleware 之前注册）
  app.use('/api/auth', authLoginRouter)

  // 邮箱验证码注册/登录：免鉴权（必须在 authMiddleware 之前注册；
  // verify 内部自行解析 cookie 判断游客身份，用于资产迁移）
  app.use('/api/auth', emailAuthRouter)

  // 展示面板 demo 免鉴权（必须在 authMiddleware 之前注册，供游客访问 / 时获取展示数据）
  // 直接用 app.get 注册，避免 Express 5 Router 挂载的路径匹配问题
  app.get('/api/panels/demo', getDemoPanel)

  // 2026-08-07 公开图片/App 素材端点（必须在 authMiddleware 之前注册）：
  // App 沙箱 iframe（opaque origin）加载 <img>/素材不携带 cookie（SameSite 第三方
  // 上下文），鉴权端点 401 被 Chrome ORB 拦截 → 图片不显示。文件名/App id 均为
  // 不可枚举 UUID，公开访问与分享链接同级风险。
  app.get('/webos/api/imagegen/file/:name', servePublicImageFile)
  app.get('/webos/api/videogen/file/:name', servePublicVideoFile)
  app.use('/webos/api/apps/:appId/files/raw', servePublicAppRawFile)
  // 2026-08-08 分享预览免鉴权（分享链接公开：游客第一次打开无 cookie，鉴权会 401 空白）
  app.get('/webos/api/share/:shareId/preview', serveSharePreview)
  // 2026-08-14 分享包素材 / 商店快照素材免鉴权（同 preview：分享页 iframe 的
  // <base> 指向素材端点，游客无 cookie——此前挂 webosRouter 内被 authMiddleware
  // 拦截 → App 内 assets/xxx.png 全部 401 → 分享出去变成"没有素材的简陋版"）
  app.use('/webos/api/share/:shareId/raw', serveShareRawFile)
  app.use('/webos/api/store/apps/:shareId/raw', serveStoreRawFile)

  // 2026-08-06 爱发电 webhook 回调（免鉴权：爱发电服务器推送，RSA 验签防伪；
  // 响应 {"ec":200} 表示已接收，失败会按 0/15/15/30/180... 秒重发，处理须幂等）
  app.post('/webos/api/payment/afdian/notify', async (req, res) => {
    try {
      const result = await handleAfdianOrder(req.body ?? {}, 'webhook')
      res.status(result.ec === 200 ? 200 : 400).json(result)
    } catch (error) {
      console.error('[afdian] webhook handler error:', error instanceof Error ? error.message : String(error))
      res.status(500).json({ ec: 500, em: 'internal error' })
    }
  })

  // Phase 5 §3.2：背景图片公开静态服务（CSS url() 无法携带 auth header，必须免鉴权）
  app.use('/backgrounds', express.static(BACKGROUNDS_DIR, {
    maxAge: '7d',
    immutable: true,
  }))

  // 认证中间件（健康检查 + auth/login 之后、其他路由之前）
  app.use('/api', authMiddleware)

  // Phase S11.2：auth/me + refresh + logout 走鉴权
  app.use('/api/auth', authProtectedRouter)

  // Phase 4：管理员路由（用户管理等，需要 admin 权限）
  app.use('/api/admin', adminRouter)
  // 2026-08-02：webOS 管理 API（管理后台 admin.shadowshub.xyz 用；requireAdmin 保护）
  app.use('/api/admin/webos', adminWebosRouter)

  // 注册路由（需要认证）
  app.use('/api/panels', panelWidgetsRouter)
  app.use('/api/panels', panelsRouter)
  app.use('/api/panels', conversationsRouter)
  app.use('/api/widgets', widgetsRouter)
  // Phase S3 缺口 A：实体冲突日志查询/解决 API（须在 entitiesRouter 之前注册，
  // 避免 /api/entities/conflicts 被 entitiesRouter 的 /:id 误匹配）
  app.use('/api/entities/conflicts', entityConflictsRouter)
  app.use('/api/entities', entitiesRouter)
  // Phase S3 缺口 B：sync_logs 服务器端持久化 API（走 /api 全局 authMiddleware，继承）
  app.use('/api/sync/logs', syncLogsRouter)
  app.use('/api/scopes', scopesRouter)
  app.use('/api/relations', relationsRouter)
  app.use('/api/settings', settingsRouter)
  app.use('/api/export', exportRouter)
  app.use('/api/import', importRouter)
  app.use('/api/dynamic-widgets', dynamicWidgetsRouter)
  app.use('/api/panel-templates', panelTemplatesRouter)
  app.use('/api/favorites', favoritesRouter)
  app.use('/api/ai', aiSettingsRouter)
  app.use('/api/skills', skillsRouter)
  app.use('/api/tools', toolsRouter)
  app.use('/api/search/keys', searchKeysRouter)
  app.use('/api/local-services', localServicesRouter)

  // Phase S10：GitHub 代理下载端点（spec 2.x 节，鉴权由 /api 全局 authMiddleware 继承）
  app.use('/api/github/proxy', githubProxyRouter)

  // Phase 14.5：知识库预留接口（stub，所有端点返回 501）
  app.use('/api/wiki', wikiRouter)

  // Phase 14.4：组件能力声明 CRUD（spec 14.4.3 节）
  app.use('/api/component-capabilities', componentCapabilitiesRouter)

  // webOS P0：独立命名空间，显式继承现有 JWT 游客/账户鉴权；不改动 Legacy Dashboard 路由或 WS 协议
  // 2026-08-17 会话历史 API（换设备/登录后可见历史；不触碰冻结的 webos.ts）
  // 2026-08-20 桌面布局端点（web 路线 desktopLayout.ts 插队小任务；解锁移动端 M1-4；不触碰冻结的 webos.ts）
  // 2026-08-20 W-F 文件服务一阶段（manifest/blob/分块/快照；移动端 M1-7 同步锚点）
  // 2026-08-21 W1 包体系（三表 + packages 端点族；移动端 M2 包客户端真实联调锚点）
  // 2026-08-21 W2 App API（handler 受限 vm + owner 级端点 /appapi/:ns/:ep；计费 kind='api'）
  // 2026-08-21 W3 互通原语 v1（/net/spaces 共享数据空间 + 事件总线；R13 非游客）
  // 2026-08-21 W3 统一包市场 R14（/market type 维度 + 依赖闭包安装 + AI 找包/装包）
  app.use('/webos/api', authMiddleware, webosRouter, webosTimeRouter, webosConversationsRouter, desktopLayoutRouter, filesRouter, packagesRouter, appapiRouter, netRouter, marketRouter)

  // Phase 6：联邦式社区 API（spec §9 节，走 /api 全局 authMiddleware 继承）
  app.use('/api/communities', communitiesRouter)

  // Phase 5 §3.2：背景图片上传 API（spec §3.2，走 /api 全局 authMiddleware 继承）
  app.use('/api/background', backgroundRouter)

  // Phase 6.2：代理路由（需要认证，spec 3.3.5 节）
  app.use('/proxy', authMiddleware, proxyRouter)

  // Phase S15：静态托管挂载在 /daily，不抢占根路径 /
  // 根路径 / 由 Nginx 现有 location / 配置接管，server 端无需处理；
  // server 端未匹配 /daily 的请求自然落入 errorHandler 返回 404
  const rawWebPublicDir = options.webPublicDir ?? process.env.WEB_PUBLIC_DIR ?? 'public'
  const webPublicDir = path.isAbsolute(rawWebPublicDir)
    ? rawWebPublicDir
    : path.resolve(process.cwd(), rawWebPublicDir)

  // S17.1: 启动诊断日志（便于线上排查 SPA fallback 500 问题）
  const indexHtmlPath = path.join(webPublicDir, 'index.html')
  console.log(`[Server] webPublicDir (absolute): ${webPublicDir}`)
  console.log(`[Server] webPublicDir exists: ${fs.existsSync(webPublicDir)}`)
  console.log(`[Server] index.html exists: ${fs.existsSync(indexHtmlPath)}`)
  console.log(`[Server] process.cwd(): ${process.cwd()}`)
  console.log(`[Server] WEB_PUBLIC_DIR env: ${process.env.WEB_PUBLIC_DIR ?? '(unset)'}`)

  if (fs.existsSync(webPublicDir)) {
    // 2026-08-06 分享落地页：/daily/exp/:shareId —— 纯静态页面（不加载 Shell/
    // 不做 bootstrap）。两种类型：
    //   s-*  ：单应用分享（商店快照预览）
    //   sh-* ：整套系统分享（加载动画 / 桌面 / 应用列表，数据在 share-assets/<id>/meta.json）
    // 页面形态：全屏预览 iframe + 右下角唯一悬浮按钮（点击展开菜单），无顶栏底条。
    // 必须在 SPA fallback 之前注册（否则被 index.html 兜底）。
    // 【安全修复 2026-08-16（H5）】：title/menu 字段此前未转义直接拼接进 HTML，
    // 用户可控（App 名/ownerName）可注入 </title><script> → 同源存储型 XSS。
    const escapeHtml = (value: string): string => value
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '"').replace(/'/g, '&#39;')
    const sharePageTemplate = (payload: {
      title: string; shareId: string; isBundle: boolean;
      srcDoc: string; menu: Array<{ icon: string; bg: string; title: string; sub: string; href?: string; action?: string }>;
    }): string => {
      const { title, shareId, isBundle, srcDoc, menu } = payload
      const srcDocAttr = srcDoc.replace(/&/g, '&amp;').replace(/"/g, '"').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      const safeTitle = escapeHtml(title)
      const menuHtml = menu.map((m) => {
        const href = m.href ? `href="${escapeHtml(m.href)}"` : ''
        const action = m.action ? `data-action="${escapeHtml(m.action)}"` : ''
        return `<a ${href} ${action}><span class="ico" style="background:${escapeHtml(m.bg)}">${escapeHtml(m.icon)}</span><span class="t"><b>${escapeHtml(m.title)}</b><small>${escapeHtml(m.sub)}</small></span></a>`
      }).join('')
      return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover">
<meta name="description" content="${safeTitle} · Daily 分享">
<title>${safeTitle} · Daily 分享</title>
<style>
  *{margin:0;padding:0;box-sizing:border-box;-webkit-tap-highlight-color:transparent}
  html,body{height:100%;overflow:hidden}
  body{font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","HarmonyOS Sans SC","MiSans","Segoe UI",Roboto,sans-serif;background:#0e1220;color:#1c2333}
  .preview{position:fixed;inset:0;background:#fff}
  .preview iframe{width:100%;height:100%;border:0;background:#fff;display:block}
  .fab{position:fixed;right:18px;bottom:calc(18px + env(safe-area-inset-bottom));width:56px;height:56px;border-radius:50%;border:0;background:linear-gradient(135deg,#4f6ef7,#7c5cff);color:#fff;font-size:22px;cursor:pointer;box-shadow:0 10px 26px rgba(79,110,247,.5);z-index:20;display:flex;align-items:center;justify-content:center;transition:transform .2s}
  .fab.open{transform:rotate(45deg)}
  .menu{position:fixed;right:16px;bottom:calc(86px + env(safe-area-inset-bottom));width:min(300px, calc(100vw - 32px));background:rgba(255,255,255,.96);backdrop-filter:blur(14px);border-radius:18px;box-shadow:0 14px 40px rgba(0,0,0,.28);overflow:hidden;display:none;z-index:21;animation:fadeUp .2s ease}
  .menu.open{display:block}
  .menu .m-head{padding:12px 16px 8px;font-size:12px;color:#8a94a6;font-weight:600}
  .menu a{display:flex;align-items:center;gap:11px;padding:12px 14px;text-decoration:none;color:#1c2333;font-size:14px;border-top:1px solid rgba(28,35,51,.06);cursor:pointer}
  .menu a .ico{width:36px;height:36px;border-radius:11px;display:flex;align-items:center;justify-content:center;font-size:17px;flex-shrink:0}
  .menu a .t b{display:block;font-size:13.5px}.menu a .t small{color:#8a94a6;font-size:11px}
  @keyframes fadeUp{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}
</style>
</head>
<body>
<div class="preview"><iframe id="preview" sandbox="allow-scripts" srcdoc="${srcDocAttr}" title="${safeTitle}"></iframe></div>
<button class="fab" id="fab" aria-label="打开菜单">＋</button>
<div class="menu" id="menu"><div class="m-head">${isBundle ? '整套系统 · 可分别安装' : 'Daily 应用分享'}</div>${menuHtml}</div>
<script>
  var fab=document.getElementById('fab'),menu=document.getElementById('menu'),open=false
  fab.addEventListener('click',function(){open=!open;menu.classList.toggle('open',open);fab.classList.toggle('open',open)})
  menu.addEventListener('click',function(e){var a=e.target.closest('a[data-action]');if(!a)return;open=false;menu.classList.remove('open');fab.classList.remove('open');var act=a.getAttribute('data-action');if(act==='install'){parent.postMessage({channel:'daily-webos-share',type:'install-share',shareId:'${shareId}'},'*')}else if(act==='preview-boot'){showPreview('boot')}else if(act==='preview-desktop'){showPreview('desktop')}else if(act==='preview-apps'){showPreview('apps')}})
  var previews={}
  function showPreview(which){
    var el=document.getElementById('preview');var doc=previews[which]||''
    if(doc){el.setAttribute('srcdoc',doc);return}
    // 首次请求
    fetch('/webos/api/share/'+encodeURIComponent('${shareId}')+'/preview?kind='+which,{credentials:'include'}).then(function(r){return r.json()}).then(function(j){if(j.ok&&j.srcDoc){previews[which]=j.srcDoc;el.setAttribute('srcdoc',j.srcDoc)}}).catch(function(){})
  }
  // 2026-08-08 初始自动加载（ap- 轻量分享直接运行 App；sh- 整套分享显示加载页）
  showPreview('boot')
</script>
</body>
</html>`
    }

    const injectBasePolyfill = (html: string, baseHref: string): string => {
      const base = `<base href="${baseHref}">`
      const polyfill = `<script>(()=>{let mem={};try{void window.localStorage.getItem('__t')}catch(e){const s={getItem:k=>(k in mem?mem[k]:null),setItem:(k,v)=>{mem[k]=String(v)},removeItem:k=>{delete mem[k]},clear:()=>{mem={}},key:i=>Object.keys(mem)[i]??null,get length(){return Object.keys(mem).length}};Object.defineProperty(window,'localStorage',{value:s,configurable:true})}})()<\/script>`
      const headRe = /<head\b[^>]*>/i
      return headRe.test(html) ? html.replace(headRe, (m) => `${m}${base}${polyfill}`) : `${base}${polyfill}${html}`
    }

    app.get('/daily/exp/:shareId', async (req, res, next) => {
      try {
        const shareId = String(req.params.shareId ?? '').replace(/[^a-zA-Z0-9-]/g, '').slice(0, 64)
        if (!shareId) { res.status(400).send('无效的分享链接'); return }
        const pool = getPool()

        if (shareId.startsWith('sh-')) {
          // ---- 整套系统分享 ----
          const metaPath = path.join(getSandboxRoot(), 'share-assets', shareId, 'meta.json')
          if (!fs.existsSync(metaPath)) { res.status(404).send('分享不存在或已失效'); return }
          const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'))
          const ownerName = String(meta.ownerName ?? '匿名')
          const desktopHtml = String(meta.desktopHtml ?? '')
          const bootHtml = String(meta.bootHtml ?? '')
          const apps = Array.isArray(meta.apps) ? meta.apps : []
          const baseHref = `/webos/api/share/${encodeURIComponent(shareId)}/raw/`
          const desktopSrc = injectBasePolyfill(desktopHtml, baseHref)
          const bootSrc = bootHtml ? injectBasePolyfill(bootHtml, baseHref) : desktopSrc
          const page = sharePageTemplate({
            title: `${ownerName} 的 Daily 系统`,
            shareId,
            isBundle: true,
            srcDoc: bootSrc,
            menu: [
              { icon: '🚀', bg: '#eef1f6', title: '查看加载动画', sub: '打开前的第一帧', action: 'preview-boot' },
              { icon: '🖥️', bg: '#efe9ff', title: '查看桌面', sub: '对方的主屏布局', action: 'preview-desktop' },
              { icon: '📦', bg: '#e9f3ff', title: `查看应用（${apps.length} 个）`, sub: '逐个预览与安装', action: 'preview-apps' },
              { icon: '🌐', bg: '#eef1f6', title: '进入 Daily 网站', sub: '打开完整的 Daily webOS', href: '/daily/' },
              { icon: '📲', bg: '#e9f3ff', title: '安装整套系统', sub: '桌面 + 全部应用一次装好', action: 'install' },
            ],
          })
          res.type('html').send(page)
          return
        }

        if (shareId.startsWith('ap-')) {
          // ---- 单 App 轻量分享（2026-08-08：不进商店，纯链接分享给朋友） ----
          const metaPath = path.join(getSandboxRoot(), 'share-assets', shareId, 'meta.json')
          if (!fs.existsSync(metaPath)) { res.status(404).send('分享不存在或已失效'); return }
          const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'))
          const app = Array.isArray(meta.apps) ? meta.apps[0] : null
          if (!app || !app.html) { res.status(404).send('分享不存在或已失效'); return }
          const name = String(app.name ?? '分享应用')
          const ownerName = String(meta.ownerName ?? '匿名')
          // 2026-08-14 修复：ap- 分享素材归档在 share-assets/<id>/apps/<appId>/（带 App 层），
          // base 必须指向 .../raw/apps/<appId>/，否则 App 内相对路径 assets/xxx.png 全部 404
          // → 分享出去变成"没有素材的简陋版"。store 分享（s-*）素材无 App 层，不受影响。
          const appBaseHref = `/webos/api/share/${encodeURIComponent(shareId)}/raw/apps/${encodeURIComponent(String(app.id ?? 'app'))}/`
          const srcDoc = injectBasePolyfill(String(app.html), appBaseHref)
          const page = sharePageTemplate({
            title: name,
            shareId,
            isBundle: false,
            srcDoc,
            menu: [
              { icon: '🌐', bg: '#eef1f6', title: '进入 Daily 网站', sub: '打开完整的 Daily webOS 系统', href: '/daily/' },
              { icon: '📲', bg: '#e9f3ff', title: '安装到我的 Daily', sub: `${ownerName} 分享的应用`, href: `/daily/?exp=${encodeURIComponent(shareId)}&install=1` },
            ],
          })
          res.type('html').send(page)
          return
        }
        const row = (await pool.query(
          `SELECT s.*,
            (SELECT COUNT(*) FROM webos_store_installs i WHERE i.share_id = s.id) AS installs,
            COALESCE(u.display_name, u.username, '匿名') AS owner_name
           FROM webos_store_apps s
           LEFT JOIN users u ON u.id = REPLACE(s.owner_key, 'user:', '')
           WHERE s.id = $1 AND s.status = 'published'`,
          [shareId],
        )).rows[0]
        if (!row) { res.status(404).send('应用不存在或已下架'); return }
        const name = String(row.name ?? '分享应用')
        const ownerName = String(row.owner_name ?? '匿名')
        const installs = Number(row.installs ?? 0)
        const appHtml = String(row.html ?? '')
        const srcDoc = injectBasePolyfill(appHtml, `/webos/api/store/apps/${encodeURIComponent(shareId)}/raw/`)
        const page = sharePageTemplate({
          title: name,
          shareId,
          isBundle: false,
          srcDoc,
          menu: [
            { icon: '🌐', bg: '#eef1f6', title: '进入 Daily 网站', sub: '打开完整的 Daily webOS 系统', href: '/daily/' },
            { icon: '📲', bg: '#e9f3ff', title: '安装到我的 Daily', sub: `${ownerName} 分享 · ${installs} 次安装`, href: `/daily/?exp=${encodeURIComponent(shareId)}&install=1` },
          ],
        })
        res.type('html').send(page)
      } catch (error) {
        next(error)
      }
    })

    app.use('/daily', express.static(webPublicDir))
    // SPA fallback 仅对 /daily/* 生效（client-side routes like /daily/panel/123）
    // S17.1: sendFile 失败时用 readFileSync 同步兜底，避免异步错误未捕获导致 500
    // S17.1-fix: 支持 HEAD 请求（curl -I / 监控工具常用），sendFile 自动处理 HEAD（仅返回 header 不返回 body）
    app.use('/daily', (req, res, next) => {
      if (req.method !== 'GET' && req.method !== 'HEAD') return next()
      const indexPath = path.join(webPublicDir, 'index.html')
      if (fs.existsSync(indexPath)) {
        res.sendFile(indexPath, (err) => {
          if (err) {
            console.error(`[Server] SPA fallback sendFile error: ${err.message}, falling back to readFileSync`)
            try {
              const html = fs.readFileSync(indexPath, 'utf-8')
              res.type('html').send(html)
            } catch (readErr) {
              console.error(`[Server] SPA fallback readFileSync also failed: ${readErr instanceof Error ? readErr.message : String(readErr)}`)
              next(err)
            }
          }
        })
      } else {
        console.warn(`[Server] index.html not found at ${indexPath}, SPA fallback skipped`)
        next()
      }
    })
    console.log(`[Server] Serving static files at /daily from ${webPublicDir}`)
  } else {
    console.log(`[Server] WEB_PUBLIC_DIR not found at ${webPublicDir}, static serving disabled (Electron fork server mode)`)
  }

  app.use(errorHandler)

  return { app }
}

async function main() {
  // [server-boot] 启动性能诊断日志（用 console.error 保证立即 flush，不被 buffer 缓存）
  // 保留此日志便于未来排查启动卡点，不要删除
  const t0 = Date.now()
  const logStep = (label: string): void => {
    console.error(`[server-boot] +${Date.now() - t0}ms ${label}`)
  }

  logStep('main() entry')

  // 捕获未处理异常，避免进程崩溃导致 tsx watch 反复重启
  process.on('uncaughtException', (err) => {
    console.error('[Server] Uncaught exception:', err)
  })
  process.on('unhandledRejection', (reason) => {
    console.error('[Server] Unhandled rejection:', reason)
  })

  // Phase S11.2：环境变量校验（兼容 Electron fork server）
  const isElectronFork = process.env.ELECTRON_RUN_AS_NODE === '1'

  // 对抗审查修复（中 Bug）：生产环境 SERVER_TOKEN 必须非空，防止身份伪造裸奔
  // Phase S11：Electron fork server 除外（桌面端内嵌 server 用空 SERVER_TOKEN）
  if (process.env.NODE_ENV === 'production' && !process.env.SERVER_TOKEN && !isElectronFork) {
    console.error('[Server] FATAL: NODE_ENV=production but SERVER_TOKEN is empty. Refusing to start.')
    console.error('[Server] Set SERVER_TOKEN in .env or environment before deploying to production.')
    process.exit(1)
  }

  // Phase S11：生产环境 JWT_SECRET 必填 + 长度 >= 32 字符（Electron fork 除外）
  if (process.env.NODE_ENV === 'production' && !isElectronFork) {
    const jwtSecret = process.env.JWT_SECRET
    if (!jwtSecret) {
      console.error('[Server] FATAL: NODE_ENV=production but JWT_SECRET is empty. Required for Web auth.')
      process.exit(1)
    }
    if (jwtSecret.length < 32) {
      console.error(`[Server] FATAL: JWT_SECRET must be at least 32 characters (current: ${jwtSecret.length}). Use: openssl rand -hex 32`)
      process.exit(1)
    }
  }

  // Phase S11：CORS_ORIGIN 必填（强制白名单）—— Electron fork 除外（桌面端不需要 Web 认证）
  if (!process.env.CORS_ORIGIN && !isElectronFork) {
    console.error('[Server] FATAL: CORS_ORIGIN env required. Set to your Web origin (e.g., http://localhost:5173 for dev, https://your-domain.com for prod).')
    process.exit(1)
  }

  // Phase S11：生产环境 WEB_ACCESS_PASSWORD 必填 + 长度 >= 8 字符（Electron fork 除外）
  if (process.env.NODE_ENV === 'production' && !isElectronFork) {
    const webPwd = process.env.WEB_ACCESS_PASSWORD
    if (!webPwd) {
      console.error('[Server] FATAL: NODE_ENV=production but WEB_ACCESS_PASSWORD is empty. Required for Web login.')
      process.exit(1)
    }
    if (webPwd.length < 8) {
      console.error(`[Server] FATAL: WEB_ACCESS_PASSWORD must be at least 8 characters (current: ${webPwd.length}).`)
      process.exit(1)
    }
  }

  if (isElectronFork) {
    console.log('[Server] Running as Electron fork (desktop embedded), skipping Web auth env checks')
  }

  logStep('before initDb')
  // 初始化数据库
  await initDb()
  logStep('initDb done')
  await initializeSchema()
  logStep('initializeSchema done')
  await ensureUserIpColumns()
  logStep('ensureUserIpColumns done')
  await ensureDisplayNameColumn()
  logStep('ensureDisplayNameColumn done')
  // 2026-08-06 服务器负载历史表（旧库幂等补建）
  await ensureServerMetricsTable()
  logStep('ensureServerMetricsTable done')
  // 2026-08-12 应用商店 size_bytes 列（旧库幂等补列）
  await ensureStoreSizeBytesColumn()
  logStep('ensureStoreSizeBytesColumn done')
  // 2026-08-12 爱发电兑换码 redeem_id 列（旧库幂等补列）
  await ensureAfdianRedeemColumn()
  logStep('ensureAfdianRedeemColumn done')
  // 2026-08-12 爱发电本地兑换码表（旧库幂等建表）
  await ensureRedeemCodesTable()
  logStep('ensureRedeemCodesTable done')
  // 2026-08-08 视频生成失败详情列（旧库幂等补列）
  await ensureVideoUsageErrorMessageColumn()
  logStep('ensureVideoUsageErrorMessageColumn done')
  // 2026-08-13 统一对话 log 表（旧库幂等建表）
  await ensureChatSessionsTable()
  logStep('ensureChatSessionsTable done')
  // 2026-08-14 MiniMax-M3 视觉桥接用量表（旧库幂等建表）
  await ensureVisionUsageTable()
  logStep('ensureVisionUsageTable done')
  // 2026-08-21 视觉双 provider：用量表补 model 列（旧库幂等；区分 DeepSeek/M3）
  await ensureVisionModelColumn()
  logStep('ensureVisionModelColumn done')
  // 2026-08-20（W-F）：文件服务一阶段元数据表（旧库幂等建表）
  await ensureFileServiceSchema()
  logStep('ensureFileServiceSchema done')
  // 2026-08-21（W1）：包体系三表（旧库幂等建表；apps 状态不动，只读适配视图）
  await ensurePackageSchema()
  logStep('ensurePackageSchema done')
  // 2026-08-21（W2）：App API 用量/审计表（每次调用一行）
  await ensureApiUsageSchema()
  logStep('ensureApiUsageSchema done')
  // 2026-08-21（W3 public 管道）：namespace→owner 发布索引表
  await ensureApiPublicSchema()
  logStep('ensureApiPublicSchema done')
  // 2026-08-21（W3 互通原语 v1）：共享空间 / 空间 KV / 事件总线表
  await ensureNetSchema()
  logStep('ensureNetSchema done')
  // 2026-08-21（W3 统一包市场 R14）：市场发布条目 + 安装登记表
  await ensureMarketSchema()
  logStep('ensureMarketSchema done')
  // 2026-08-21（W1）：注册「app 视为 type=app 的包」只读适配视图
  //（GET /packages 无 type 过滤时与真包合并返回；避免 packages 模块直接依赖 webos.ts）
  setAppViewProvider(async (key: string) => {
    const principal = key.startsWith('guest:')
      ? { key, id: `guest-${key.slice(6)}`, deviceId: key.slice(6), guest: true, role: 'guest' }
      : { key, id: key.slice(5), deviceId: `account-${key.slice(5)}`, guest: false, role: 'member' }
    const state = await loadState(principal as never)
    return state.apps.map((app) => {
      const active = app.versions.find((v) => v.id === app.activeVersionId) ?? app.versions[app.versions.length - 1]
      return {
        id: app.id,
        type: 'app' as const,
        displayName: app.name,
        icon: app.icon ?? null,
        version: active?.version ?? null,
        source: app.source,
        installed: app.installed,
        owner: true,
        capabilities: active?.capabilities ?? [],
        activeVersionId: app.activeVersionId,
        createdAt: app.createdAt,
        updatedAt: Date.now(),
      }
    })
  })
  await seedBuiltinTemplates()
  logStep('seedBuiltinTemplates done')
  await seedShowcasePanel()
  logStep('seedShowcasePanel done')

  // Phase 3：初始化文件系统工具沙箱目录（spec §7）
  try {
    initSandbox()
    logStep('initSandbox done')
  } catch (err) {
    console.warn('[Server] Sandbox init failed:', err)
  }

  // 【安全修复 2026-08-16（H4）】启动时隔离历史遗留 .svg 背景（存储型 XSS 清理）
  try {
    quarantineLegacySvgBackgrounds()
  } catch (err) {
    console.warn('[Server] quarantineLegacySvgBackgrounds failed:', err)
  }

  // 2026-08-06：启动服务器负载监控采样（CPU/内存/磁盘/带宽，每 5s）
  try {
    startServerMonitor()
    logStep('serverMonitor started')
  } catch (err) {
    console.warn('[Server] Server monitor init failed:', err)
  }
  // 2026-08-06：负载历史落库（每分钟一条，保留 30 天；管理后台趋势图 + AI 追溯）
  try {
    startMetricsPersist(30)
    logStep('metricsPersist started')
  } catch (err) {
    console.warn('[Server] Metrics persist init failed:', err)
  }
  // 2026-08-06：爱发电 API 定时对账（每 5 分钟拉最近订单补发漏单；webhook 丢失兜底）
  try {
    startAfdianSync(5 * 60_000)
    logStep('afdianSync started')
  } catch (err) {
    console.warn('[Server] Afdian sync init failed:', err)
  }

  const isSqlite =
    process.env.DB_DRIVER === 'sqlite' || process.env.USE_SQLITE === 'true'
  console.log(isSqlite ? '[DB] SQLite initialized' : '[DB] PostgreSQL initialized')

  // Phase S8.1：通过 createApp() 工厂创建 Express app（中间件/路由/errorHandler 在工厂内挂载）
  const { app } = createApp()

  logStep('routes registered')

  // spec 4.4 节：启动日志显示 GitHub 当前模式（DB 已连接，piBridge 尚未初始化）
  logStep('before getSearchKey(github)')
  try {
    const githubKey = await getSearchKey('github')
    if (githubKey) {
      console.log('[Search] GitHub: token 模式（5000 req/hour，search_code 可用）')
    } else {
      console.log('[Search] GitHub: 无 token 模式（60 req/hour，search_code 不可用，其余端点降级可用）')
    }
  } catch (err) {
    console.warn('[Search] GitHub 模式探测失败:', err instanceof Error ? err.message : String(err))
  }
  logStep('getSearchKey(github) done')

  // 创建 HTTP 服务器并启动（WS 服务与 Express 共享同一端口）
  const httpServer = createServer(app)
  logStep('before httpServer.listen')
  httpServer.listen(PORT, () => {
    logStep('httpServer.listen callback')
    // Phase 14 C3：PORT=0 时由 OS 分配空闲端口，需从 httpServer.address() 获取实际端口
    const addr = httpServer.address()
    const actualPort = typeof addr === 'object' && addr ? addr.port : PORT
    console.log(`[Server] Daily API running on http://localhost:${actualPort}`)
    // Phase 14 C4：通过 IPC 通知主进程实际端口（Electron fork 子进程场景）
    if (process.send) {
      process.send({ type: 'port', port: actualPort })
    }
    startWebSocketServer(httpServer)
    // Phase 14 C4：动态 import piBridge，避免静态 import 在模块加载阶段卡住
    // 即使 piBridge 加载失败（pi-coding-agent 要求 Node 22+），server 核心功能仍可用
    // Phase 14 C3 / Bug 7 修复：piBridge 动态 import 在 Electron 31 / Node 20.18.0 下
    // 可能静默挂起（pi-coding-agent 的 ESM/CJS interop bug），添加 15s 超时竞速避免永久阻塞
    ;(async () => {
      try {
        // Bug 修复：pi-coding-agent 直接 import 在 Node 24 上需 8-10s，
        // 通过 tsx 编译 piBridge.ts（1800+ 行 + 15 个 import）共需 10-12s。
        // 15s 超时在冷启动时不足（tsx 首次编译 + 模块解析），改为 45s。
        // server 启动超时已设为 60s（dev 模式），PiBridge 需在 server 启动超时前完成。
        const PIBRIDGE_TIMEOUT_MS = 45_000
        // Bug 15 修复：用 withTimeout helper 替换 Promise.race + setTimeout，自动清理定时器
        const piBridge = await withTimeout(
          import('./piBridge.js'),
          PIBRIDGE_TIMEOUT_MS,
          'PiBridge import',
        )
        // Bug 10 修复：initPiBridge 也添加超时保护，避免内部挂起导致永久阻塞
        await withTimeout(
          piBridge.initPiBridge(),
          PIBRIDGE_TIMEOUT_MS,
          'PiBridge init',
        )
        console.log('[PiBridge] initialized successfully')
        // 2026-08-10 性能优化：启动后后台预热 pi-coding-agent 模块加载——
        // 首次对话不再承担 tsx 模块加载开销（8-26s），只需创建会话本身。
        try { piBridge.preheatPiAgent?.() } catch { /* 预热失败不影响启动 */ }
      } catch (err) {
        console.error('[PiBridge] failed to initialize, running in degraded mode:', err)
      }
    })()
    // Phase 4：注册 AI 上下文分层保留定时任务（每天 03:00 执行，spec 2.4 节）
    scheduleRetentionCleanup()

    // Phase 6.2：本地服务心跳超时定时任务（spec 3.3.2 节）
    // 每 60 秒扫描，将 last_heartbeat 超过 60 秒的记录 online=false
    const heartbeatTimer = setInterval(async () => {
      try {
        const pool = getPool()
        const now = Date.now()
        const result = await pool.query(
          'UPDATE local_service_registry SET online = false, updated_at = $1 WHERE online = true AND last_heartbeat < $2',
          [now, now - 60_000],
        )
        if (result.rowCount && result.rowCount > 0) {
          console.log(`[Server] Local service heartbeat timeout: ${result.rowCount} services marked offline`)
        }
      } catch (err) {
        console.error('[Server] Local service heartbeat cleanup failed:', err)
      }
    }, 60_000)
    heartbeatTimer.unref?.()
  })

  // 优雅关闭（改为 async，确保 await closeDb() 在 process.exit(0) 之前完成，S5 修复）
  const shutdown = async (signal: string): Promise<void> => {
    console.log(`[Server] Shutting down (${signal})...`)
    // Phase 14 C4：动态 import piBridge（若未加载则跳过 dispose，错误由 catch 兜底）
    // Phase 14 C3 / Bug 7 修复：与启动路径一致，添加 15s 超时竞速避免关闭时永久阻塞
    // Bug 10 修复：disposePiBridge 也添加超时保护，避免关闭时挂起
    try {
      const PIBRIDGE_SHUTDOWN_TIMEOUT_MS = 15_000
      // Bug 15 修复：用 withTimeout helper 替换 Promise.race + setTimeout，自动清理定时器
      const piBridge = await withTimeout(
        import('./piBridge.js'),
        PIBRIDGE_SHUTDOWN_TIMEOUT_MS,
        'PiBridge import on shutdown',
      )
      await withTimeout(
        piBridge.disposePiBridge(),
        PIBRIDGE_SHUTDOWN_TIMEOUT_MS,
        'PiBridge dispose',
      )
    } catch (err) {
      console.error('[Server] Pi bridge dispose failed:', err)
    }
    try {
      await closeDb()
      console.log('[Server] Database closed')
    } catch (err) {
      console.error('[Server] Database close failed:', err)
    }
    process.exit(0)
  }
  process.on('SIGINT', () => { void shutdown('SIGINT') })
  process.on('SIGTERM', () => { void shutdown('SIGTERM') })
}

// Phase S8.1：仅当本文件是入口（直接执行）时才运行 main()，
// 被 import（如测试 helper）时不触发 DB 初始化、listen、cron 等副作用。
// 使用 fileURLToPath(import.meta.url) 与 process.argv[1] 比对（ESM 标准模式）。
const __isMainEntry = (() => {
  try {
    return process.argv[1] === fileURLToPath(import.meta.url)
  } catch {
    return false
  }
})()

if (__isMainEntry) {
  main().catch((err) => {
    console.error('[Server] Failed to start:', err)
    process.exit(1)
  })
}

// Phase S8.1：导出 createApp 供测试 helper 使用（test/helpers/server.ts）
export { createApp }

// ============================================================================
// Phase 4：AI 上下文分层保留定时任务（spec 2.4 节）
// 每天 03:00 执行 runRetentionCleanup
// ============================================================================

const RETENTION_CRON_HOUR = 3

function scheduleRetentionCleanup(): void {
  const now = new Date()
  const next = new Date(now)
  next.setHours(RETENTION_CRON_HOUR, 0, 0, 0)
  if (next <= now) next.setDate(next.getDate() + 1)
  const delay = next.getTime() - now.getTime()

  console.log(`[Server] Retention cleanup scheduled, next run at ${next.toISOString()} (in ${Math.round(delay / 1000 / 60)} minutes)`)

  const firstTimer = setTimeout(() => {
    runRetentionCleanup().catch((err) => {
      console.error('[Server] Retention cleanup failed:', err)
    })
    // 后续每 24 小时执行一次
    const interval = setInterval(() => {
      runRetentionCleanup().catch((err) => {
        console.error('[Server] Retention cleanup failed:', err)
      })
    }, 24 * 60 * 60 * 1000)
    interval.unref?.()
  }, delay)
  firstTimer.unref?.()
}
