import { app, shell, BrowserWindow, Tray, Menu, nativeImage, ipcMain, session, webContents, type MenuItemConstructorOptions } from 'electron'
import { join } from 'path'
import * as fs from 'fs'
import { electronApp, optimizer } from '@electron-toolkit/utils'
import { registerAgentIpc, initializeApiKeyStore, createToolExecutor } from './ipc/agentIpc'
import { localAgentService } from './localAgent/LocalAgentService'
// Phase 14 C3：启动时 fork server 子进程（ELECTRON_RUN_AS_NODE=1）
// Phase 14 C4：IPC 暴露 getServerPort 给 preload（同步返回，避免 preload 异步 IPC 阻塞）
import { startServer, stopServer, getServerPort } from './serverProcess'

// 注：electron-vite 在 ESM 模式下会自动注入 __dirname（= import.meta.dirname）
// 不需要手动定义，否则会报 "Identifier '__dirname' has already been declared"

// Phase 15 批次5：启动性能 profiling（spec 7.2.4）—— 主进程启动时间起点
const __mainStartTime = Date.now()

// F1 修复：mainWindow 提升为模块级变量，确保 web-contents-created 回调可访问
let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let isQuitting = false  // 区分"退出"和"最小化到托盘"

// ============================================================================
// Phase 4: sync-log 文件持久化（spec 2.6 节）
// JSONL 格式，存储在 app.getPath('userData')/sync-log.jsonl（非 C 盘）
// ============================================================================

const SYNC_LOG_MAX_ENTRIES = 1000
const SYNC_LOG_RETENTION_DAYS = 7

/** sync-log 记录结构（与渲染进程 SyncLogEntry 兼容） */
interface SyncLogEntry {
  timestamp: number
  op: unknown  // SyncQueueEntry 序列化后的对象
  status: 'success' | 'failed'
  error?: string
}

function getSyncLogPath(): string {
  return join(app.getPath('userData'), 'sync-log.jsonl')
}

function readSyncLog(): SyncLogEntry[] {
  const logPath = getSyncLogPath()
  if (!fs.existsSync(logPath)) return []
  try {
    const content = fs.readFileSync(logPath, 'utf-8')
    return content.split('\n').filter(Boolean).map(line => JSON.parse(line) as SyncLogEntry)
  } catch (err) {
    console.error('[Main] Failed to read sync-log:', err)
    return []
  }
}

function rotateSyncLog(): void {
  try {
    const entries = readSyncLog()
    if (entries.length <= SYNC_LOG_MAX_ENTRIES) return
    // 超过 1000 条时清理 success 记录；保留最近 7 天的 failed 记录
    const now = Date.now()
    const retentionMs = SYNC_LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000
    const filtered = entries.filter(e =>
      e.status === 'failed' || (now - e.timestamp) < retentionMs
    )
    fs.writeFileSync(getSyncLogPath(), filtered.map(e => JSON.stringify(e)).join('\n') + '\n')
    console.log(`[Main] sync-log rotated: ${entries.length} → ${filtered.length}`)
  } catch (err) {
    console.error('[Main] Failed to rotate sync-log:', err)
  }
}

// sync-log IPC handlers
ipcMain.handle('sync-log:append', (_event, entry: SyncLogEntry) => {
  try {
    const logPath = getSyncLogPath()
    // 用当前时间戳覆盖（确保日志时间准确）
    fs.appendFileSync(logPath, JSON.stringify({ ...entry, timestamp: Date.now() }) + '\n')
  } catch (err) {
    console.error('[Main] Failed to append sync-log:', err)
  }
})

ipcMain.handle('sync-log:read', () => {
  return readSyncLog()
})

ipcMain.handle('sync-log:rotate', () => {
  rotateSyncLog()
})

// ============================================================================
// Phase 6.2：本地服务注册 IPC（spec 3.3.6 节）
// ============================================================================

// 读取 userData/local-services.json 配置文件（文件不存在返回 null）
ipcMain.handle('local-services:read-config', () => {
  const configPath = join(app.getPath('userData'), 'local-services.json')
  if (!fs.existsSync(configPath)) {
    return null
  }
  try {
    const content = fs.readFileSync(configPath, 'utf-8')
    return JSON.parse(content)
  } catch (err) {
    console.error('[Main] Failed to read local-services config:', err)
    return null
  }
})

function createTray(win: BrowserWindow): void {
  // S14 修复（v7）：不依赖外部 PNG 文件，使用 Electron 内置 API 创建图标
  // 方案 A：尝试加载 PNG 文件
  let icon: Electron.NativeImage
  try {
    icon = nativeImage.createFromPath(join(__dirname, '../../build/tray-icon.png'))
    if (icon.isEmpty()) {
      // 方案 B：文件不存在或加载失败，回退到空白图标
      icon = nativeImage.createEmpty()
    }
  } catch {
    icon = nativeImage.createEmpty()
  }
  tray = new Tray(icon)
  tray.setToolTip('Daily')
  tray.on('click', () => {
    if (win.isVisible()) win.hide()
    else win.show()
  })
  const contextMenu = Menu.buildFromTemplate([
    { label: '显示窗口', click: () => win.show() },
    { label: '隐藏窗口', click: () => win.hide() },
    { type: 'separator' },
    { label: '退出', click: () => { isQuitting = true; app.quit() } },
  ])
  tray.setContextMenu(contextMenu)
}

function createAppMenu(win: BrowserWindow): void {
  const template: MenuItemConstructorOptions[] = [
    { label: '文件', submenu: [
      // Phase 7 批次3 任务6：移除 accelerator，由 useKeyboardShortcuts hook 统一处理 Ctrl+N
      { label: '新建面板', click: () => win.webContents.send('menu:action', 'new-panel') },
      { label: '导出', accelerator: 'CmdOrCtrl+E', click: () => win.webContents.send('menu:action', 'export') },
      { label: '导入', accelerator: 'CmdOrCtrl+I', click: () => win.webContents.send('menu:action', 'import') },
      { type: 'separator' },
      { label: '退出', accelerator: 'CmdOrCtrl+Q', click: () => { isQuitting = true; app.quit() } },
    ]},
    { label: '编辑', submenu: [
      { label: '撤销', role: 'undo' },
      { label: '重做', role: 'redo' },
      { type: 'separator' },
      { label: '复制', role: 'copy' },
      { label: '粘贴', role: 'paste' },
    ]},
    { label: '视图', submenu: [
      // Phase 7 批次3 任务6：移除 role:zoomIn/zoomOut/resetZoom（自动绑定 Ctrl+=/-/0 会与 hook 冲突），
      //   改为 click + IPC，由渲染进程根据作用域处理（canvas 缩放画布，browser 缩放窗口）
      { label: '放大', click: () => win.webContents.send('menu:action', 'zoom-in') },
      { label: '缩小', click: () => win.webContents.send('menu:action', 'zoom-out') },
      { label: '重置缩放', click: () => win.webContents.send('menu:action', 'zoom-reset') },
      { type: 'separator' },
      { label: '全屏', role: 'togglefullscreen' },
      { label: '开发者工具', role: 'toggleDevTools' },
      { type: 'separator' },
      { label: '切换侧边栏', accelerator: 'CmdOrCtrl+B', click: () => win.webContents.send('menu:action', 'toggle-sidebar') },
    ]},
    // S8 修复（v8）：新增"面板"菜单（在"视图"和"帮助"之间），与 2.4 节菜单项描述一致
    // Phase 7 批次3 任务6：移除 CmdOrCtrl+Shift+N accelerator（与 useKeyboardShortcuts hook 冲突，
    //   Electron 菜单 accelerator 会拦截 keystroke 不传到 renderer，导致 hook 失效）
    { label: '面板', submenu: [
      { label: '新建面板', click: () => win.webContents.send('menu:action', 'new-panel') },
      { label: '管理面板', click: () => win.webContents.send('menu:action', 'manage-panels') },
    ]},
    { label: '帮助', submenu: [
      { label: '关于', click: () => win.webContents.send('menu:action', 'about') },
      { label: '快捷键', accelerator: 'CmdOrCtrl+/', click: () => win.webContents.send('menu:action', 'shortcuts') },
    ]},
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

// ============================================================================
// Phase 7 批次3 任务6：快捷键拦截（spec 5.2.2 节）
// Electron 默认 Ctrl+W 关闭窗口、Ctrl+R/F5 刷新整个窗口，与渲染进程快捷键冲突。
// 在 mainWindow.webContents 上注册 before-input-event 监听，拦截这些按键：
//   - 阻止 Electron 默认行为（不关窗口、不刷新窗口）
//   - 通过 IPC 'shortcut:action' 转发给渲染进程 hook 处理
// 注：before-input-event.preventDefault() 会阻止 input 到达 renderer，所以 renderer 的
//   keydown 监听不会收到这些按键，必须通过 IPC 转发。
// ============================================================================

function registerShortcutInterception(win: BrowserWindow): void {
  win.webContents.on('before-input-event', (event, input) => {
    // 仅处理 keyDown（keyUp/char 不处理，避免重复触发）
    if (input.type !== 'keyDown') return

    const ctrl = input.control
    const shift = input.shift
    const key = input.key.toLowerCase()

    // Ctrl+W：关闭当前标签页（不关闭窗口）
    if (ctrl && !shift && key === 'w') {
      event.preventDefault()
      win.webContents.send('shortcut:action', 'close-tab')
      return
    }

    // Ctrl+R / Ctrl+Shift+R / F5：刷新当前网页（不刷新窗口）
    if ((ctrl && key === 'r') || key === 'f5') {
      event.preventDefault()
      win.webContents.send('shortcut:action', 'reload-tab')
      return
    }
  })
}

// S11/S12 修复：createWindow 中赋值模块级 mainWindow，并注册 close 拦截
// 保留所有现有逻辑（ready-to-show、加载 dev server URL、setWindowOpenHandler、webPreferences 等）
function createWindow(): void {
  // 修改点：const mainWindow → mainWindow（赋值给模块级变量，供 createTray/createAppMenu 使用）
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 768,
    show: false,
    autoHideMenuBar: true,
    title: 'Daily',
    // Phase 13.1.1：自绘标题栏（替换 Windows 原生标题栏）
    // Phase 15 任务 2.7-a 修复：删除 frame: false（与 titleBarOverlay 互斥的死代码）
    // - titleBarStyle: 'hidden' 跨平台统一：Windows 上等价于无框但保留 overlay 能力，macOS 自动保留 traffic lights
    // - Windows 启用 titleBarOverlay 作为兜底（防 React 未加载时无法关窗）
    //   高度 40 容纳 tabs + omnibox
    // Phase 15 批次2 P1-6 修复：backgroundColor + titleBarOverlay.color 对齐亮色主题，
    //   避免窗口启动闪烁和 Windows 原生按钮区域颜色不协调
    titleBarStyle: 'hidden',
    titleBarOverlay: process.platform === 'win32'
      ? { color: '#f5f5f7', symbolColor: '#1d1d1f', height: 40 }
      : undefined,
    backgroundColor: '#f5f5f7',
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true,  // 新增：启用 <webview> 标签（见 3.1 节）
    },
  })

  // 保留现有的 ready-to-show 事件监听
  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
  })

  // 诊断：捕获渲染进程 console 错误并输出到终端
  mainWindow.webContents.on('console-message', (_event, level, message, _line, source) => {
    const prefix = source ? `[Renderer:${source}]` : '[Renderer]'
    if (level >= 2) { // 2=warning, 3=error
      console.warn(`${prefix} ${message}`)
    }
  })

  // Phase 13.1.1：窗口最大化状态变化时通知渲染进程
  // 渲染进程 TitleBar 组件通过 onMaximizeChange 监听，更新 isMaximized 状态（切换图标）
  mainWindow.on('maximize', () => {
    mainWindow?.webContents.send('window:maximize-change', true)
  })
  mainWindow.on('unmaximize', () => {
    mainWindow?.webContents.send('window:maximize-change', false)
  })

  // 保留现有的 dev server URL 加载逻辑
  // 开发环境：加载 Vite dev server URL（支持 HMR）
  // 生产环境：加载本地打包后的 HTML 文件
  // 注：ELECTRON_RENDERER_URL 只在 electron-vite dev 模式下设置，是 dev 模式的可靠标志
  // （is.dev 在某些版本下可能为 false，不可靠）
  const rendererUrl = process.env['ELECTRON_RENDERER_URL']
  if (rendererUrl) {
    console.log('[Main] Loading dev server URL:', rendererUrl)
    mainWindow?.loadURL(rendererUrl)
    // DevTools 默认关闭（可通过菜单 视图→开发者工具 或 Ctrl+Shift+I 打开）
    // openDevTools() 会创建悬浮/停靠面板，可能干扰鼠标交互和布局
    // mainWindow?.webContents.openDevTools()
  } else {
    const filePath = join(__dirname, '../renderer/index.html')
    console.log('[Main] Loading file:', filePath)
    mainWindow?.loadFile(filePath)
  }

  // 保留现有的 setWindowOpenHandler
  // 外部链接用系统浏览器打开
  mainWindow?.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // S11/S12 修复：新增 close 拦截（最小化到托盘）
  // M4 问题修复：close handler 调用 preventDefault 后最小化，阻止 window-all-closed 触发；
  //   用户点击托盘"退出"时设置 isQuitting=true 后 app.quit()，此时 close 不再 preventDefault，
  //   窗口正常关闭，window-all-closed 触发但 app 已在退出流程中
  mainWindow.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault()
      mainWindow?.hide()
    }
  })
  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

// Phase 6.1：内存监控 IPC（spec 第 7 节）
ipcMain.handle('app:getMemoryUsage', () => {
  return process.memoryUsage()
})

// ============================================================================
// Phase 13.1.1：自绘标题栏窗口控制 IPC
// 渲染进程 TitleBar 组件通过 windowApi 调用以下 IPC：
//   - window:minimize         最小化窗口
//   - window:maximize-toggle  切换最大化/还原
//   - window:close            关闭窗口（触发 close 事件，由 isQuitting 逻辑接管最小化到托盘）
//   - window:is-maximized     查询当前是否最大化（用于初始渲染 + 双击标题栏切换图标）
// 最大化状态变化通过 'window:maximize-change' 事件主动推送（在 createWindow 中注册）
// ============================================================================

ipcMain.handle('window:minimize', () => {
  mainWindow?.minimize()
})

ipcMain.handle('window:maximize-toggle', () => {
  if (!mainWindow) return
  if (mainWindow.isMaximized()) {
    mainWindow.unmaximize()
  } else {
    mainWindow.maximize()
  }
})

ipcMain.handle('window:close', () => {
  mainWindow?.close()
})

ipcMain.handle('window:is-maximized', () => {
  return mainWindow?.isMaximized() ?? false
})

// 主进程 Cookie IPC（S13 修复：session 已在顶部 import 中合并，无需重复 import）
ipcMain.handle('cookie:get', async (_, url: string) => {
  return await session.defaultSession.cookies.get({ url })
})

ipcMain.handle('cookie:set', async (_, cookie: Electron.CookiesSetDetails) => {
  return await session.defaultSession.cookies.set(cookie)
})

ipcMain.handle('cookie:remove', async (_, details: { url: string; name: string }) => {
  return await session.defaultSession.cookies.remove(details.url, details.name)
})

// F2 修复：context-menu:show handler（preload 中 contextMenuApi.show 调用此通道）
// 返回用户点击项的索引；用户关闭菜单（点击外部/ESC）返回 -1
ipcMain.handle('context-menu:show', async (_event, items: Array<{ label: string; enabled?: boolean }>) => {
  return new Promise<number>((resolve) => {
    let resolved = false
    const safeResolve = (v: number) => {
      if (!resolved) {
        resolved = true
        resolve(v)
      }
    }
    const menu = Menu.buildFromTemplate(
      items.map((item, i) => ({
        label: item.label,
        enabled: item.enabled !== false,
        click: () => safeResolve(i),
      }))
    )
    menu.popup()
    menu.on('menu-will-close', () => safeResolve(-1))
  })
})

// ============================================================================
// Phase 14 C4：同步获取 server 端口（供 preload 使用 sendSync 同步获取）
// 必须同步返回：preload 在窗口加载前执行，需要立即拿到端口注入到 renderer
// startServer 在 createWindow 之前 await 完成，此处调用时 serverPort 已就绪
// ============================================================================
ipcMain.on('server:get-port-sync', (event) => {
  event.returnValue = getServerPort()
})

// ============================================================================
// 迁移 userData 到 F 盘（修复 webview partition Code Cache 创建失败问题）
// 原因：C 盘 AppData 权限/杀毒竞争导致 webview partition 的 Code Cache 目录
//   间歇性创建失败，V8 代码缓存子系统阻塞，webview 渲染管线卡死。
//   同时符合用户规则：不允许将文件存储在 C 盘。
// 注意：必须在 app.whenReady() 之前调用，且在任何使用 app.getPath('userData') 的代码之前
// ============================================================================
{
  const newPath = 'F:\\allmylife\\event-data\\userData'
  const oldPath = app.getPath('userData')
  if (oldPath !== newPath) {
    // 首次迁移：如果新目录不存在，且旧目录存在，复制关键数据
    if (!fs.existsSync(newPath)) {
      fs.mkdirSync(newPath, { recursive: true })
      // 迁移关键数据文件
      if (fs.existsSync(oldPath)) {
        const filesToMigrate = ['ai-keys.json', 'daily.db', 'daily.db-shm', 'daily.db-wal', 'sync-log.jsonl', 'local-services.json', 'Preferences']
        for (const file of filesToMigrate) {
          const src = join(oldPath, file)
          const dst = join(newPath, file)
          if (fs.existsSync(src)) {
            try {
              fs.copyFileSync(src, dst)
              console.log(`[main] Migrated ${file} to ${newPath}`)
            } catch (err) {
              console.warn(`[main] Failed to migrate ${file}:`, err)
            }
          }
        }
        // 迁移 IndexedDB 目录（如果存在）
        const idbSrc = join(oldPath, 'IndexedDB')
        const idbDst = join(newPath, 'IndexedDB')
        if (fs.existsSync(idbSrc)) {
          try {
            fs.cpSync(idbSrc, idbDst, { recursive: true })
            console.log('[main] Migrated IndexedDB to', newPath)
          } catch (err) {
            console.warn('[main] Failed to migrate IndexedDB:', err)
          }
        }
      }
    }
    app.setPath('userData', newPath)
    console.log(`[main] userData set to ${newPath}`)
  }
}

app.whenReady().then(async () => {
  electronApp.setAppUserModelId('com.allmylife.event')

  // Phase 9 批次1：初始化 API Key 存储 + 注册 agent IPC（必须在 createWindow 之前，避免 race）
  // 注：registerAgentIpc 本身是同步函数（仅注册 ipcMain.handle），无需 await
  //    initializeApiKeyStore 也是同步函数（仅确保目录存在 + 读一次 store）
  initializeApiKeyStore()
  registerAgentIpc()

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // Phase 14 C3：启动 server 子进程（必须在 createWindow 之前，确保 preload 能拿到端口）
  // 失败不阻塞应用启动（降级到 IDB 模式，用户可在日志中查看错误）
  try {
    const port = await startServer()
    console.log(`[main] Server started on port ${port}`)
  } catch (err) {
    console.error('[main] Server failed to start:', err)
  }

  // Phase 14 B2：先建窗口再异步初始化 agent，避免 agent 初始化失败导致无窗口
  // 之前 await localAgentService.initialize() 失败则 createWindow() 永不执行 → 进程在跑但无窗口
  createWindow()
  // Phase 15 批次5：主进程启动完成（spec 7.2.4）
  console.log(`[Profiling] Main process ready (whenReady + createWindow): ${Date.now() - __mainStartTime}ms`)

  // 新增：创建托盘和菜单（mainWindow 已提升为模块级变量）
  if (mainWindow) {
    createTray(mainWindow)
    createAppMenu(mainWindow)
    // Phase 7 批次3 任务6：注册 before-input-event 拦截（Ctrl+W/Ctrl+R/F5）
    registerShortcutInterception(mainWindow)
  }

  // Phase 9 批次2 模块2：初始化 LocalAgentService + 设置 ToolExecutor
  // - localAgentService.initialize()：创建 SessionManager 单例（inMemory）
  // - setToolExecutor：注入工具执行器，通过 IPC 路由到渲染进程执行 25 个 customTools
  //   （createToolExecutor 内部用 mainWindow.webContents.send 发送 tool:execute:request，
  //    渲染进程的 toolBridge 监听此事件并执行工具，通过 tool:execute:result IPC 回传结果）
  // Phase 14 B2：异步初始化，失败不阻塞窗口（用户可在设置中查看错误）
  try {
    await localAgentService.initialize()
    // createWindow 之后设置 ToolExecutor（mainWindow 已在 createWindow 中赋值给模块级变量）
    localAgentService.setToolExecutor(createToolExecutor(() => mainWindow))
  } catch (err) {
    console.error('[main] LocalAgent init failed:', err)
    // 窗口已显示，用户可在设置中查看错误
  }

  // S11 修复：webview 内 window.open 拦截，通过 IPC 发送给渲染进程
  // 使用模块级 mainWindow，确保回调可访问
  app.on('web-contents-created', (_, contents) => {
    if (contents.getType() === 'webview') {
      // 为 webview session 设置 permission handler（允许常用权限，拒绝危险权限）
      const webviewSession = contents.session
      webviewSession.setPermissionRequestHandler((_wc, permission, callback) => {
        const allowed = ['clipboard-read', 'clipboard-write', 'media', 'geolocation', 'notifications']
        callback(allowed.includes(permission))
      })
      webviewSession.setPermissionCheckHandler(() => true)

      contents.setWindowOpenHandler((details) => {
        mainWindow?.webContents.send('webview:open-url', details.url)
        return { action: 'deny' }
      })
    }
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// S16 修复（v7）：window-all-closed 在 createTray 失败（tray 为 null）时回退到默认行为（退出）
//   避免 createTray 失败时窗口关闭后应用无法退出，导致进程残留
// M4 问题：close handler 在 !isQuitting 时 preventDefault，所以 window-all-closed 仅在
//   isQuitting=true（托盘/菜单"退出"）或 tray 为 null 时触发；此时 app 已在退出流程或应退出
app.on('window-all-closed', () => {
  // tray 为 null 时（createTray 失败或未调用），回退到默认退出行为
  // macOS 默认不退出（Cmd+Q 退出），其他平台退出
  if (!tray || process.platform !== 'darwin') {
    app.quit()
  }
  // tray 存在且非 macOS：不退出，由托盘控制退出（最小化到托盘）
  // tray 存在且 macOS：不退出（macOS 默认行为）
})

// Phase 6.2：应用退出前通知渲染进程注销本地服务（spec 3.3.6 节）
// 如果 HTTP 请求未完成，服务器心跳超时会自动标记 offline
app.on('before-quit', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('local-services:unregister')
  }
  // Phase 9 批次2 模块2：销毁所有 agent session（释放资源）
  localAgentService.disposeAll()
  // Phase 14 C3：停止 server 子进程（设置 isStopping 阻止自动重启）
  stopServer()
})

// ============================================================================
// Phase 7 批次5：缩略图捕获 IPC（spec 7.1.1 节）
// 通过 webContents.capturePage() 截取 webview 内容，返回 PNG dataURL
// 用于 SitePreview 缩略图缓存，避免每次都创建 webview
// ============================================================================

ipcMain.handle('thumbnail:capture', async (_event, webContentsId: number): Promise<string | null> => {
  try {
    const contents = webContents.fromId(webContentsId)
    if (!contents || contents.isDestroyed()) {
      return null
    }
    // capturePage 返回 NativeImage，toDataURL 转为 dataURL 字符串
    const image = await contents.capturePage()
    if (image.isEmpty()) {
      return null
    }
    return image.toDataURL()
  } catch (err) {
    console.error('[Main] Failed to capture thumbnail:', err)
    return null
  }
})

