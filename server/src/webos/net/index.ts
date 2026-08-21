// server/src/webos/net/index.ts —— W3 互通原语 v1 出口
// ----------------------------------------------------------------------------
// 组装：互通的表（db）+ 领域逻辑（service）+ REST（router）。
// 接入方（index.ts）只依赖本文件导出的少量符号。
// ============================================================================

import { ensureNetSchema } from './db.js'
import { netRouter } from './router.js'

export { netRouter }
export { ensureNetSchema }
export {
  resolveHandle,
  createSpace,
  getSpaceInfo,
  listMine,
  setSpaceMode,
  addMember,
  removeMember,
  keyGet,
  keySet,
  keyList,
  eventSend,
  eventPoll,
  eventPollWait,
  requireNonGuest,
  validateKeyName,
  type NetResult,
} from './service.js'
export type { NetSpaceRow, NetSpaceMode } from './db.js'