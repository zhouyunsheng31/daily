/**
 * Electron 31 + Node 20.x 兼容性补丁
 *
 * 根因（来自对抗审查报告 .trae/adversarial-review-phase9-impl.md 第三节）：
 *   pi-coding-agent 内置的 undici 在 `lib/web/webidl/index.js:5` 执行：
 *     const { markAsUncloneable } = require('node:worker_threads')
 *   但 `markAsUncloneable` 是 Node.js 22+ 才加入 `node:worker_threads` 的 API。
 *   Electron 31 内置 Node 20.x，该 API 不存在，解构得到 `undefined`，
 *   被赋值给 `webidl.util.markAsUncloneable`，调用时抛：
 *     TypeError: webidl.util.markAsUncloneable is not a function
 *     at new CacheStorage (.../undici/lib/web/cache/cachestorage.js:20:17)
 *
 * 修复策略：
 *   在 pi-coding-agent 加载之前，给 `node:worker_threads` 模块的 module.exports
 *   注入 no-op 的 `markAsUncloneable`。这样 undici 的 require 解构时就能拿到函数。
 *
 *   no-op 是安全的：`markAsUncloneable` 原意是给对象打 Symbol 标记，表示不可
 *   `postMessage` 到 Worker。pi-coding-agent 在 Electron 主进程中运行，不实际
 *   `postMessage` CacheStorage / Cache 等对象到 Worker，所以 no-op 不影响功能。
 *
 * 加载顺序要求（关键）：
 *   ESM 的静态 `import` 语句会被提升到模块顶部按声明顺序执行，普通语句在所有
 *   import 完成后才执行。所以无法在 `import { AuthStorage } from '@earendil-works/pi-coding-agent'`
 *   之前的普通语句中打 patch。
 *   解决：把 patch 放到独立模块，让 piBridge.ts 顶部第一个 import 它。
 *   这样 patch 模块会先求值，然后 pi-coding-agent 才被加载（undici 才 require
 *   `node:worker_threads`），此时 `markAsUncloneable` 已存在。
 *
 * Phase 14 C3：server 子进程在 Electron 下运行（ELECTRON_RUN_AS_NODE=1），
 *   同样需要此 patch，否则 piBridge.ts 加载 pi-coding-agent 时 undici 会崩溃。
 *   本文件是 client/desktop/electron/main/compat/workerThreadsPatch.ts 的副本。
 *
 * 使用 `createRequire` 而非 `import * as`：内置模块的 ESM namespace 对象是
 * immutable 的，无法直接添加属性；CJS module.exports 对象则可以修改。
 * `createRequire` 返回的 require 拿到的就是 CJS module.exports。
 * Node.js 模块缓存保证：patch 后 undici 的 `require('node:worker_threads')`
 * 拿到的是同一个对象（已注入 markAsUncloneable）。
 */
import { createRequire } from 'node:module'

const __require = createRequire(import.meta.url)
const workerThreads = __require('node:worker_threads') as Record<string, unknown> & {
  markAsUncloneable?: (obj: unknown) => void
}

if (typeof workerThreads.markAsUncloneable !== 'function') {
  workerThreads.markAsUncloneable = (_obj: unknown): void => {
    // no-op: 标记对象不可克隆给 Worker；pi-coding-agent 主进程不实际 postMessage 这些对象
  }
  console.log(
    '[compat] worker_threads.markAsUncloneable patched (no-op) for Electron 31 / Node 20.x',
  )
}
