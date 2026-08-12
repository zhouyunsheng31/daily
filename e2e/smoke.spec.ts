/**
 * D1：Electron smoke 测试
 *
 * 验证：
 *   1. 应用能以 prod 模式启动（loadFile，非 dev server）
 *   2. 首个窗口可加载并获取标题（应为 "Daily"）
 *   3. 窗口 bounds 非空（确实可见）
 *   4. 截图保存到 e2e/screenshots/
 *
 * 说明：直接调用 launchApp（不依赖 fixtures.ts 的 electron fixture），
 *   以便在 smoke 阶段显式控制启动/关闭流程。
 */
import { test, expect } from './fixtures'
import { launchApp, closeApp } from './electron-helpers'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

const SCREENSHOT_DIR = join(import.meta.dirname, 'screenshots')

test.describe('Electron smoke', () => {
  test('应用启动并显示窗口', async () => {
    const { app, window } = await launchApp()
    try {
      const title = await window.title()
      // 窗口标题来自 client/desktop/electron/main/index.ts 的 BrowserWindow.title（第 221 行）
      expect(title).toBe('Daily')

      mkdirSync(SCREENSHOT_DIR, { recursive: true })
      await window.screenshot({ path: join(SCREENSHOT_DIR, 'smoke-launch.png') })

      // 验证窗口确实可见（非空 bounds）
      const bounds = await app.evaluate(async ({ BrowserWindow }) => {
        const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
        return win ? win.getBounds() : null
      })
      expect(bounds).not.toBeNull()
      expect(bounds!.width).toBeGreaterThan(0)
      expect(bounds!.height).toBeGreaterThan(0)
    } finally {
      await closeApp({ app, window })
    }
  })
})
