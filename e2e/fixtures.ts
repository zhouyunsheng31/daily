/**
 * D1：Playwright fixtures — 自动启动/关闭 Electron 应用
 *
 * 用法（后续测试）：
 *   import { test, expect } from '../fixtures'
 *   test('xxx', async ({ electron }) => {
 *     const { app, window } = electron
 *     ...
 *   })
 *
 * 说明：app 与 window 来自同一次 launchApp 调用，必须作为整体提供（不能拆成两个独立
 * fixture，否则无法共享同一个已启动实例）。因此用单一 `electron` fixture 提供
 * ElectronFixture，子测试解构取 app/window。
 */
import { test as base, expect } from '@playwright/test'
import { launchApp, closeApp, type ElectronFixture } from './electron-helpers'

export const test = base.extend<{ electron: ElectronFixture }>({
  electron: async ({}, use) => {
    const fixture = await launchApp()
    await use(fixture)
    await closeApp(fixture)
  },
})

export { expect }
