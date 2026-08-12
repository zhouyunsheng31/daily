// Phase 14 C3 / Bug 6 修复：electron-builder afterPack 钩子
// 打包后自动把 server/node_modules/better-sqlite3 重编译为 Electron ABI
//
// 背景：
// - dev 时 better-sqlite3 为 Node ABI（npm rebuild better-sqlite3），供 standalone server / tsx 测试使用
// - electron-builder.yml 中 npmRebuild: false，不会自动 rebuild app/node_modules
// - 桌面端运行时 better-sqlite3 在 server/node_modules 中
//   通过 ELECTRON_RUN_AS_NODE=1 子进程加载，需匹配 Electron 内置 Node ABI
// - 因此在 afterPack 阶段对 resources/server/node_modules 执行 electron-rebuild
//
// 路径说明（electron-builder 26.x doPack 实现，platformPackager.js:218）：
// - asar: false 时应用文件复制到 path.join(resourcesPath, "app")，
//   即 appOutDir/resources/app/server/node_modules
// - asar: true 时为 appOutDir/resources/app.asar，server 在 asar 内（无法 rebuild）
// - 当前 electron-builder.yml asar: false，目标路径为 resources/app/server/node_modules
// - 防御性兼容：若 resources/app/server 不存在则回退到 resources/server（旧版行为）

const { execSync } = require('node:child_process')
const path = require('node:path')
const { existsSync } = require('node:fs')

module.exports = async function (context) {
  // Bug 11 修复：允许通过 SKIP_NATIVE_REBUILD=1 跳过（离线打包场景）
  // after-pack.js 默认依赖 npx electron-rebuild（需要网络下载），离线场景下会失败
  // 设置 SKIP_NATIVE_REBUILD=1 可跳过，此时需手工确保 better-sqlite3 已为 Electron ABI 编译
  if (process.env.SKIP_NATIVE_REBUILD === '1') {
    console.log('[afterPack] SKIP_NATIVE_REBUILD=1, skipping better-sqlite3 rebuild')
    return
  }

  console.log('[afterPack] Rebuilding better-sqlite3 for Electron ABI...')
  const resourcesDir = path.join(context.appOutDir, 'resources')
  const serverInApp = path.join(resourcesDir, 'app', 'server')
  const serverAtRoot = path.join(resourcesDir, 'server')
  const serverDir = existsSync(serverInApp) ? serverInApp : serverAtRoot
  if (!existsSync(serverDir)) {
    console.warn(
      `[afterPack] server directory not found at ${serverInApp} or ${serverAtRoot}, skip rebuild`,
    )
    return
  }
  console.log(`[afterPack] Target: ${serverDir}`)
  try {
    execSync(`npx electron-rebuild -f -w better-sqlite3 -m "${serverDir}"`, {
      stdio: 'inherit',
      cwd: context.packager.info.projectDir,
    })
    console.log('[afterPack] better-sqlite3 rebuilt for Electron ABI')
  } catch (err) {
    console.error('[afterPack] Failed to rebuild better-sqlite3:', err)
    throw err
  }
}
