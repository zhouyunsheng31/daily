// server/src/webos/files/index.ts —— File Service 一阶段出口
// ----------------------------------------------------------------------------
// 聚合：schema 初始化 + 元数据服务 + REST 路由 + agent_fs 双写 hook。
// 让上层（index.ts / webos.ts）以最少改动接入：
//   - ensureFileService()    启动时建表 + 建双写 hook（在 webos.ts 装配）
//   - filesRouter            REST 路由（index.ts 挂 /webos/api）
// ============================================================================

import { ensureFileServiceSchema } from './db.js'
import { recordFileStats, recordFileDeleted } from './service.js'
import { filesRouter } from './router.js'
import { reconcileFileMetadata } from './service.js'

export { filesRouter }
export { ensureFileServiceSchema }
export { recordFileStats, recordFileDeleted }
export { reconcileFileMetadata, createSnapshotPoint } from './service.js'
export { listManifest, sumFileBytes, getFileMeta } from './db.js'

/** 面向 webos.ts 的 agent_fs 双写 hook：文件变化后登记元数据（异步静默） */
export function makeFileServiceHook<T extends { key: string }>(getKey: () => T): {
  onFsFileWritten: (fullPath: string) => Promise<void>
  onFsFileDeleted: (fullPath: string) => Promise<void>
} {
  return {
    async onFsFileWritten(fullPath: string): Promise<void> {
      try {
        const principal = getKey()
        await recordFileStats(principal.key, fullPath)
      } catch { /* 双写失败静默 */ }
    },
    async onFsFileDeleted(fullPath: string): Promise<void> {
      try {
        const principal = getKey()
        await recordFileDeleted(principal.key, fullPath)
      } catch { /* 双写失败静默 */ }
    },
  }
}

/** 供独立进程/管理员 CLI 调用的全量 reconcile 入口 */
export async function runFileReconcile(userKeys?: string[]) {
  return reconcileFileMetadata(userKeys)
}