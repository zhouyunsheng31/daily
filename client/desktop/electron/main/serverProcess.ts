/**
 * Phase 14 C3：Electron 主进程启动时 fork server 子进程
 *
 * 设计要点：
 * - fork + ELECTRON_RUN_AS_NODE=1：让 electron 进程以 node 模式运行，避免 native 模块 ABI 冲突
 * - PORT=0：OS 分配空闲端口，避免端口冲突
 * - IPC 端口通知：server 启动后通过 process.send({ type: 'port', port }) 通知主进程实际端口
 * - stdout fallback：如果 IPC 失败，从 stdout 解析 "Daily API running on http://localhost:PORT"
 * - 崩溃自动重启（最多 3 次），stopServer 后不重启
 * - 日志写入 userData/logs/server.log
 *
 * dev 模式：优先用 system node + tsx ESM loader 运行 .ts 源码（Bug 9 修复）
 *   - 避免 Electron 内置 Node ABI (125) 与 better-sqlite3 (Node ABI 137) 不匹配崩溃
 *   - 找不到 system node 时回退到 Electron (ELECTRON_RUN_AS_NODE=1)，并告警 ABI 风险
 *   - tsx 的 loader.mjs 通过 --import 加载（Node 20.6+ 支持 --import）
 *   - 用 file:// URL 指定 loader 绝对路径，避免模块解析不确定性
 *   - cwd 设为 server 目录，让 server 内部相对路径（如 .env、.pi/skills）正确解析
 *
 * prod 模式：直接用编译后的 .js（resources/server/dist/index.js）
 */
import { fork, execSync, type ChildProcess } from 'child_process'
import { join } from 'path'
import { pathToFileURL } from 'url'
import { app } from 'electron'
import { createWriteStream, mkdirSync, existsSync, type WriteStream } from 'fs'

let serverProcess: ChildProcess | null = null
let serverPort: number | null = null
let logStream: WriteStream | null = null
let isStopping = false
let restartCount = 0
const MAX_RESTARTS = 3

/**
 * 检测 system node 可执行文件路径（dev 模式专用）
 *
 * Bug 9 修复：dev 模式用 system node 启动 server，避免 Electron 内置 Node ABI
 * 与 better-sqlite3 (Node ABI) 不匹配导致 `NODE_MODULE_VERSION 137 vs 125` 崩溃
 *
 * 优先级：
 * 1. process.env.NODE_PATH（用户显式指定，需存在）
 * 2. where node (Windows) / which node (Unix)
 * 3. 返回 null，由调用方回退到 process.execPath（Electron）并告警
 */
function getSystemNodePath(): string | null {
  // 1. 优先用环境变量
  if (process.env.NODE_PATH && existsSync(process.env.NODE_PATH)) {
    return process.env.NODE_PATH
  }
  // 2. 用 where/which 查找
  try {
    const cmd = process.platform === 'win32' ? 'where node' : 'which node'
    const result = execSync(cmd, { encoding: 'utf-8' }).trim().split(/\r?\n/)[0]
    if (result && existsSync(result)) {
      return result
    }
  } catch {
    // 查找失败（node 不在 PATH 中）
  }
  return null
}

/** 获取当前 server 端口（未启动时返回 null） */
export function getServerPort(): number | null {
  return serverPort
}

/** 启动 server 子进程，返回实际监听端口 */
export async function startServer(): Promise<number> {
  isStopping = false

  // Phase 14 修复：app.isPackaged 在 electron-vite dev 模式下可能误报为 true
  // （Electron 31 的 app.isPackaged 依赖 ELECTRON_IS_DEV 环境变量，但 electron-vite 未设置）
  // 改用 ELECTRON_RENDERER_URL 作为 dev 模式的可靠标志（electron-vite dev 必设置此变量），
  // 与 main/index.ts 的 dev/prod 判断逻辑保持一致
  const isDev = !!process.env.ELECTRON_RENDERER_URL || !app.isPackaged
  // __dirname 在 electron-vite 编译后是 out/main/，向上 2 级到项目根目录
  const projectRoot = join(__dirname, '..', '..')
  const serverDir = join(projectRoot, 'server')
  const serverPath = isDev
    ? join(serverDir, 'src', 'index.ts')  // dev 模式用 tsx 运行 .ts 源码
    : join(process.resourcesPath, 'app', 'server', 'dist', 'index.js')  // prod 模式用编译后的 js（asar:false 时 files 在 resources/app/ 下）

  // 确保日志目录存在（userData 在非 C 盘，符合用户规则）
  const logsDir = join(app.getPath('userData'), 'logs')
  mkdirSync(logsDir, { recursive: true })
  const logPath = join(logsDir, 'server.log')
  logStream = createWriteStream(logPath, { flags: 'a' })

  logStream.write(`\n[${new Date().toISOString()}] === Starting server (${isDev ? 'dev' : 'prod'}) ===\n`)
  logStream.write(`[server] isDev=${isDev}, app.isPackaged=${app.isPackaged}, ELECTRON_RENDERER_URL=${process.env.ELECTRON_RENDERER_URL ? 'set' : 'unset'}\n`)

  return new Promise((resolve, reject) => {
    const env: Record<string, string> = {
      ...process.env as Record<string, string>,
      ELECTRON_RUN_AS_NODE: '1',  // 必须设置！否则 fork 会启动新 Electron 窗口
      DB_DRIVER: 'sqlite',
      SQLITE_PATH: join(app.getPath('userData'), 'daily.db'),
      // Phase 14 修复：dev 模式用固定端口 3456（与 vite proxy 配置一致），
      // prod 模式用 0（OS 动态分配，通过 IPC 通知主进程）
      PORT: isDev ? '3456' : '0',
      SERVER_TOKEN: '',  // localhost 无需认证
      SKILLS_DIR: isDev
        ? join(projectRoot, '.pi', 'skills')
        : join(process.resourcesPath, 'app', '.pi', 'skills'),
    }

    if (isDev) {
      // Bug 9 修复：dev 模式用 system node 启动 server，避免 Electron 内置 Node ABI (125)
      // 与 better-sqlite3 (Node ABI 137) 不匹配导致 `NODE_MODULE_VERSION 137 vs 125` 崩溃
      //
      // tsx 的 loader.mjs 是 ESM loader，通过 --import 加载（Node 20.6+ 支持 --import）
      // 用 file:// URL 指定 loader 绝对路径，避免模块解析不确定性
      const tsxLoaderPath = join(serverDir, 'node_modules', 'tsx', 'dist', 'loader.mjs')
      const tsxLoaderUrl = pathToFileURL(tsxLoaderPath).href
      logStream?.write(`[server] dev mode: tsx loader = ${tsxLoaderUrl}\n`)
      logStream?.write(`[server] dev mode: serverPath = ${serverPath}\n`)

      const systemNodePath = getSystemNodePath()
      if (systemNodePath) {
        // system node 的 ABI 与 server/node_modules/better-sqlite3 一致（都是 Node ABI）
        logStream?.write(`[server] dev mode: using system node at ${systemNodePath}\n`)
        // system node 不需要 ELECTRON_RUN_AS_NODE（该变量只对 Electron 二进制生效）
        const devEnv = { ...env }
        delete devEnv.ELECTRON_RUN_AS_NODE
        serverProcess = fork(serverPath, [], {
          env: devEnv,
          stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
          cwd: serverDir,  // cwd 设为 server 目录，让 .env / .pi/skills 等相对路径正确解析
          execPath: systemNodePath,  // system node（Node ABI 与 better-sqlite3 匹配）
          execArgv: ['--import', tsxLoaderUrl],
        })
      } else {
        // 找不到 system node，回退到 Electron（ELECTRON_RUN_AS_NODE=1 → node 模式）
        // 警告：可能与 better-sqlite3 ABI 不匹配（NODE_MODULE_VERSION 137 vs 125）
        logStream?.write(
          `[server] dev mode: WARNING system node not found, falling back to Electron ` +
            `(may crash with better-sqlite3 ABI mismatch, set NODE_PATH or add node to PATH to fix)\n`,
        )
        serverProcess = fork(serverPath, [], {
          env,
          stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
          cwd: serverDir,
          execPath: process.execPath,  // electron (ELECTRON_RUN_AS_NODE=1 → node 模式)
          execArgv: ['--import', tsxLoaderUrl],
        })
      }
    } else {
      // prod 模式：用编译后的 .js + tsx ESM loader（Phase 14 C4 修复 ESM CJS interop bug）
      // 与 dev 模式一致，通过 --import 加载 tsx loader，避免 import express from 'express'
      // 在 Electron 31 / Node 20.18.0 下静默挂起
      const tsxLoaderPath = join(process.resourcesPath, 'app', 'server', 'node_modules', 'tsx', 'dist', 'loader.mjs')
      const tsxLoaderUrl = pathToFileURL(tsxLoaderPath).href
      logStream?.write(`[server] prod mode: tsx loader = ${tsxLoaderUrl}\n`)
      logStream?.write(`[server] prod mode: serverPath = ${serverPath}\n`)
      serverProcess = fork(serverPath, [], {
        env,
        stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
        execArgv: ['--import', tsxLoaderUrl],
      })
    }

    if (!serverProcess) {
      reject(new Error('Failed to fork server process'))
      return
    }

    // Bug 13 修复：dev 模式 tsx 编译 + PiBridge 加载可能需要 30-50s，10s 超时太短
    // prod 模式用编译后的 .js，启动快，保持 10s
    const STARTUP_TIMEOUT_MS = isDev ? 60_000 : 10_000

    let resolved = false
    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true
        // Bug 13 修复：超时后不阻塞 createWindow（main/index.ts 已 try/catch）
        // 但仍允许后续 IPC/stdout 端口更新 serverPort（见下方 stdout/IPC 处理）
        logStream?.write(`[server] startup timeout (${STARTUP_TIMEOUT_MS / 1000}s), continue waiting for port...\n`)
        reject(new Error(`Server startup timeout (${STARTUP_TIMEOUT_MS / 1000}s)`))
      }
    }, STARTUP_TIMEOUT_MS)

    // 监听子进程 stdout/stderr 写入日志文件
    serverProcess.stdout?.on('data', (data: Buffer) => {
      const text = data.toString()
      logStream?.write(text)
      // fallback：如果 IPC 失败，从 stdout 解析端口
      const portMatch = text.match(/Daily API running on http:\/\/localhost:(\d+)/)
      if (portMatch) {
        const port = parseInt(portMatch[1], 10)
        if (!resolved) {
          serverPort = port
          resolved = true
          clearTimeout(timeout)
          logStream?.write(`[server] port resolved from stdout: ${serverPort}\n`)
          resolve(serverPort)
        } else {
          // Bug 13 修复：超时后收到端口更新，仍记录 serverPort 供后续 getServerPort() 查询
          // （注：preload 已一次性 sendSync 获取端口，renderer 无法热更新，但主进程状态正确）
          serverPort = port
          logStream?.write(`[server] port received from stdout after timeout: ${serverPort}\n`)
        }
      }
    })

    serverProcess.stderr?.on('data', (data: Buffer) => {
      logStream?.write(`[stderr] ${data.toString()}`)
    })

    // 首选：监听 IPC 消息获取端口（server/src/index.ts 中 process.send({ type: 'port', port })）
    serverProcess.on('message', (msg: unknown) => {
      if (msg && typeof msg === 'object' && 'type' in msg) {
        const m = msg as { type: unknown; port?: unknown }
        if (m.type === 'port' && typeof m.port === 'number') {
          if (!resolved) {
            serverPort = m.port
            resolved = true
            clearTimeout(timeout)
            logStream?.write(`[server] port resolved from IPC: ${serverPort}\n`)
            resolve(m.port)
          } else {
            // Bug 13 修复：超时后收到 IPC 端口更新，仍记录 serverPort 供后续 getServerPort() 查询
            serverPort = m.port
            logStream?.write(`[server] port received from IPC after timeout: ${serverPort}\n`)
          }
        }
      }
    })

    // 子进程崩溃自动重启（最多 3 次，stopServer 后不重启）
    serverProcess.on('exit', (code) => {
      logStream?.write(`[server] exited with code ${code}\n`)
      // 启动阶段（端口尚未 resolved）崩溃：立即 reject，不再重启
      // 根因修复：之前启动阶段崩溃不 reject promise，导致主进程白等 60s 超时
      // 启动阶段崩溃通常是 ABI 不匹配、端口冲突等硬故障，重启无意义（同代码同环境会再崩）
      // 运行时崩溃（端口已 resolved）才重启
      if (!resolved) {
        const err = new Error(
          `Server process exited during startup with code ${code} ` +
            `(check userData/logs/server.log for [server-boot] diagnostic logs)`,
        )
        resolved = true
        clearTimeout(timeout)
        reject(err)
        return
      }
      if (code !== 0 && restartCount < MAX_RESTARTS && !isStopping) {
        restartCount++
        logStream?.write(`[server] restarting (${restartCount}/${MAX_RESTARTS})...\n`)
        setTimeout(() => {
          startServer().catch(err => {
            logStream?.write(`[server] restart failed: ${err}\n`)
          })
        }, 1000)
      }
    })

    // 子进程 spawn 错误（如 execPath 不存在）
    serverProcess.on('error', (err) => {
      logStream?.write(`[server] spawn error: ${err}\n`)
      if (!resolved) {
        resolved = true
        clearTimeout(timeout)
        reject(err)
      }
    })
  })
}

/** 停止 server 子进程（设置 isStopping 阻止自动重启） */
export function stopServer(): void {
  isStopping = true
  if (serverProcess) {
    serverProcess.kill('SIGTERM')
    serverProcess = null
  }
  if (logStream) {
    logStream.write(`[${new Date().toISOString()}] === Server stopped ===\n`)
    logStream.end()
    logStream = null
  }
  serverPort = null
  restartCount = 0
}
