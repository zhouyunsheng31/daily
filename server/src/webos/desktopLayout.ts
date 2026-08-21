// ============================================================================
// 桌面布局端点（web 路线插队小任务；解锁移动端 M1-4 阶段一）
// ----------------------------------------------------------------------------
// 依据：docs/routes/web/08-ui.md §2（布局端点）+ docs/routes/README.md §9.1。
//   GET /webos/api/desktop-layout  → 当前用户桌面布局（首次返回默认空布局）
//   PUT /webos/api/desktop-layout  → 保存桌面布局（乐观并发：带 version，冲突 409）
// 存储：同 appStorage 模式（state.appStorage['__desktop_layout__']），
//   不触碰冻结的 webos.ts（本模块独立 router + 复用其导出的 loadState/saveState）。
// 契约单一事实源：shared/webos-contracts/desktop-layout.ts（R7 移动端同消费）；
//   本模块经桌面布局 JSON schema 快照 + typebox Check 校验（同 W0 架构）。
// ============================================================================

import { Router } from 'express'
import { Check } from 'typebox/value'
import type { Principal } from '../routes/webos.js'
import { loadState, saveState } from '../routes/webos.js'
import desktopLayoutSchema from '../../../shared/webos-contracts/desktop-layout.schema.json' with { type: 'json' }

export const desktopLayoutRouter = Router()

// 桌面布局类型（与 shared/webos-contracts/desktop-layout.ts 语义一致；
// 运行时校验走 JSON schema 快照，此处类型供 TS 编译）
interface WebOsDesktopAppItem {
  kind?: 'app' | undefined
  appId: string
  name?: string
  icon?: string | null
}
interface WebOsDesktopFolderItem {
  kind: 'folder'
  name: string
  icon?: string | null
  children: WebOsDesktopAppItem[]
}
type WebOsDesktopItem = WebOsDesktopAppItem | WebOsDesktopFolderItem
interface WebOsDesktopLayout {
  version: number
  pages: WebOsDesktopItem[][]
  updatedAt?: number
}

/** 布局存储专用保留 key（不属于任何 App 私有 KV；Delete App 不会误删） */
const LAYOUT_STORAGE_KEY = '__desktop_layout__'
/** 布局存储内保存的字段名 */
const LAYOUT_DATA_KEY = 'layout'

/** 默认空布局（与服务端语义一致的 v1 起步） */
function defaultDesktopLayout(): WebOsDesktopLayout {
  return { version: 0, pages: [[]], updatedAt: Date.now() }
}

function principalFromRequest(req: { deviceId?: string; user?: { authenticated?: unknown; guest?: unknown; userId?: string; guestDeviceId?: string; role?: unknown } }): Principal | null {
  const user = req.user
  if (!user?.authenticated) return null
  if (user.guest) {
    const deviceId = user.guestDeviceId || req.deviceId
    if (!deviceId) return null
    return {
      key: `guest:${deviceId}`,
      id: `guest-${deviceId}`,
      deviceId,
      guest: true,
      role: 'guest',
    } as Principal
  }
  if (user.userId) {
    return {
      key: `user:${user.userId}`,
      id: user.userId,
      deviceId: `account-${user.userId}`,
      guest: false,
      role: (user.role === 'admin' ? 'admin' : 'member') as 'member' | 'admin',
    } as Principal
  }
  return null
}

function readLayout(state: { appStorage: Record<string, Record<string, unknown>> }): WebOsDesktopLayout {
  const stored = state.appStorage[LAYOUT_STORAGE_KEY]
  const candidate = stored?.[LAYOUT_DATA_KEY]
  if (candidate && typeof candidate === 'object' && Check(desktopLayoutSchema, candidate)) {
    return candidate as WebOsDesktopLayout
  }
  return defaultDesktopLayout()
}

/** 语义校验：同一页内 App 图标不得重复（schema 的 uniqueItems 无法表达 appId 维度） */
function findDuplicateAppIds(layout: WebOsDesktopLayout): string | null {
  for (let i = 0; i < layout.pages.length; i++) {
    const seen = new Set<string>()
    for (const item of layout.pages[i]) {
      if (item.kind === undefined || item.kind === 'app') {
        if (seen.has(item.appId)) return `${item.appId}（pages[${i}]）`
        seen.add(item.appId)
      } else if (item.kind === 'folder') {
        // 文件夹内仅 app
        if (seen.has(item.name)) return `folder:${item.name}（pages[${i}]）`
        seen.add(item.name)
      }
    }
  }
  return null
}

/** GET /webos/api/desktop-layout */
desktopLayoutRouter.get('/desktop-layout', async (req, res, next) => {
  try {
    const principal = principalFromRequest(req as never)
    if (!principal) return void res.status(401).json({ error: 'UNAUTHORIZED' })
    const state = await loadState(principal)
    const layout = readLayout(state)
    res.json({ ok: true, layout, message: layout.version === 0 ? 'default' : undefined })
  } catch (error) {
    next(error)
  }
})

/** PUT /webos/api/desktop-layout（body: WebOsDesktopLayout） */
desktopLayoutRouter.put('/desktop-layout', async (req, res, next) => {
  try {
    const principal = principalFromRequest(req as never)
    if (!principal) return void res.status(401).json({ error: 'UNAUTHORIZED' })

    const raw = req.body
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw) || !Check(desktopLayoutSchema, raw)) {
      return void res.status(400).json({ ok: false, error: 'INVALID_DESKTOP_LAYOUT', message: '布局结构与契约不符：需 version（≥0 整数）+ pages（非空二维数组，app/folder 项）' })
    }
    const layout = raw as WebOsDesktopLayout
    const duplicate = findDuplicateAppIds(layout)
    if (duplicate) {
      return void res.status(400).json({ ok: false, error: 'INVALID_DESKTOP_LAYOUT', message: `同一页内图标重复：${duplicate}` })
    }
    const state = await loadState(principal)
    const current = readLayout(state)

    // 乐观并发：请求 version < 当前 serverVersion → 409 让前端合并重试
    if (layout.version > 0 && current.version > layout.version) {
      return void res.status(409).json({
        ok: false,
        error: 'LAYOUT_VERSION_CONFLICT',
        message: '桌面布局已被其他设备更新，请合并后重试',
        serverVersion: current.version,
        layout: current,
      })
    }

    const nextLayout = {
      version: layout.version + 1,
      pages: layout.pages,
      updatedAt: Date.now(),
    }
    // 校验通过且版本无冲突后落库（同 appStorage 模式）
    state.appStorage[LAYOUT_STORAGE_KEY] = { [LAYOUT_DATA_KEY]: nextLayout }
    await saveState(principal, state)

    res.json({ ok: true, layout: nextLayout })
  } catch (error) {
    next(error)
  }
})