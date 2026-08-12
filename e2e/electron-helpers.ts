/**
 * D1：Playwright Electron CDP 测试框架 — 应用启动辅助
 *
 * 用途：以 prod 模式（loadFile）启动打包后的 Electron 应用，并通过 Playwright Electron API
 * 自动建立 CDP 连接（无需 --remote-debugging-port）。
 *
 * 目标产物：out/main/index.js（electron-vite 构建后的主进程入口）
 */
import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { join } from 'path'

export interface ElectronFixture {
  app: ElectronApplication
  window: Page
}

/**
 * 启动 Electron 应用并返回首个窗口。
 *
 * 关键点：
 *   - 不传 --remote-debugging-port：Playwright Electron API 内部自动处理 CDP 连接
 *   - delete env.ELECTRON_RENDERER_URL：强制 prod 模式（loadFile），即使外层在跑 dev server
 *     （env 对象不接受 undefined 值，必须用 delete 而非赋值为 undefined）
 */
export async function launchApp(options?: { cwd?: string }): Promise<ElectronFixture> {
  const env = { ...process.env }
  delete env.ELECTRON_RENDERER_URL

  const cwd = options?.cwd ?? process.cwd()
  const mainPath = join(cwd, 'out', 'main', 'index.js')

  const app = await electron.launch({
    args: [mainPath],
    env: env as Record<string, string>,
    cwd,
  })

  const window = await app.firstWindow()
  await window.waitForLoadState('domcontentloaded')
  return { app, window }
}

/**
 * 关闭 Electron 应用（容错：忽略关闭过程中的异常，避免影响后续测试）。
 */
export async function closeApp(fixture: ElectronFixture | null | undefined): Promise<void> {
  if (fixture?.app) {
    try {
      await fixture.app.close()
    } catch {
      // ignore — 应用可能已退出
    }
  }
}
