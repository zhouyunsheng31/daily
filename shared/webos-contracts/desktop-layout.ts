// ============================================================================
// 桌面布局契约（单一事实源）—— R7：web 与移动端共消费
// ----------------------------------------------------------------------------
// 依据：docs/routes/web/08-ui.md §2（桌面模板 V2 配套布局端点）+ D18 启动器方向。
// 布局数据模型：pages 二维数组（满页溢出下一页），支持文件夹折叠（宫格预览 + 打开小窗）。
// folder.children 内仅 app（深度 ≤2 层：列表 → folder → app），故为**有限嵌套**
// （无需递归 schema）；typebox 1.x 亦无 Recursive 原语，此设计正合适。
// 前端（shell-web）用 export 的 validateDesktopLayout / defaultDesktopLayout 直接校验；
// 服务端经 JSON 快照（desktop-layout.schema.json，gen-contract-schemas.mjs 生成）+
// typebox Check 校验；移动端 DTO 生成读同一 JSON。新增字段必须双端同步。
// ============================================================================

import { Type, type Static } from 'typebox'

/** 桌面 App 图标项（kind 缺省视为 'app'，向后兼容简单对象） */
const AppItem = Type.Object(
  {
    kind: Type.Optional(Type.Literal('app')),
    appId: Type.String({ minLength: 1, maxLength: 128 }),
    name: Type.Optional(Type.String({ maxLength: 64 })),
    icon: Type.Optional(Type.Union([Type.String({ maxLength: 4096 }), Type.Null()])),
  },
  { additionalProperties: false },
)

/** 桌面文件夹项（children 内仅 app，无嵌套 folder → 有限深度） */
const FolderItem = Type.Object(
  {
    kind: Type.Literal('folder'),
    name: Type.String({ minLength: 1, maxLength: 64 }),
    icon: Type.Optional(Type.Union([Type.String({ maxLength: 4096 }), Type.Null()])),
    children: Type.Array(AppItem, { minItems: 1, maxItems: 200 }),
  },
  { additionalProperties: false },
)

const Item = Type.Union([AppItem, FolderItem])

/** 桌面布局（GET/PUT /webos/api/desktop-layout 的 body/响应） */
export const DESKTOP_LAYOUT_SCHEMA = Type.Object(
  {
    /** 布局版本（乐观并发：PUT 带递增 version，服务端比较返回 409 冲突提示） */
    version: Type.Integer({ minimum: 0 }),
    /** 多页：每个元素是一页图标数组 */
    pages: Type.Array(Type.Array(Item), { minItems: 1, maxItems: 64 }),
    /** 最近更新时间（服务端写入，毫秒时间戳） */
    updatedAt: Type.Optional(Type.Integer({ minimum: 0 })),
  },
  { additionalProperties: false, required: ['version', 'pages'] },
)

export type WebOsDesktopAppItem = Static<typeof AppItem>
export type WebOsDesktopFolderItem = Static<typeof FolderItem>
export type WebOsDesktopItem = Static<typeof Item>
export type WebOsDesktopLayout = Static<typeof DESKTOP_LAYOUT_SCHEMA>

export interface WebOsDesktopLayoutResponse {
  ok: boolean
  layout: WebOsDesktopLayout
  /** 说明（默认布局初始化/冲突提示等） */
  message?: string
  /** 冲突时当前服务端版本（供前端合并后重试） */
  serverVersion?: number
}

/** 默认桌面布局（v1：单页空布局，系统在首次 GET 时初始化） */
export function defaultDesktopLayout(): WebOsDesktopLayout {
  return { version: 0, pages: [[]], updatedAt: Date.now() }
}

/**
 * 校验桌面布局对象（结构合法性；供前端直接 import + 服务端语义补强）。
 * 注意：本函数为 TS 便捷校验（供 shell-web 等 TS 侧），服务端走
 * desktop-layout.schema.json + typebox Check（同语义，双守卫）。
 */
export function validateDesktopLayout(raw: unknown): { ok: boolean; message?: string } {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, message: 'desktop-layout 必须是 JSON 对象' }
  }
  const layout = raw as Record<string, unknown>
  if (typeof layout['version'] !== 'number' || !Number.isInteger(layout['version']) || (layout['version'] as number) < 0) {
    return { ok: false, message: 'version 必须是 ≥0 的整数' }
  }
  if (!Array.isArray(layout['pages']) || layout['pages'].length === 0) {
    return { ok: false, message: 'pages 必须是非空二维数组' }
  }
  for (let i = 0; i < layout['pages'].length; i++) {
    const items = layout['pages'] as unknown[]
    if (!Array.isArray(items[i])) {
      return { ok: false, message: `pages[${i}] 必须是数组（一页图标）` }
    }
    const page = items[i] as unknown[]
    const seen = new Set<string>()
    for (let j = 0; j < page.length; j++) {
      const it = page[j]
      if (typeof it !== 'object' || it === null) {
        return { ok: false, message: `pages[${i}][${j}] 必须是对象` }
      }
      const item = it as Record<string, unknown>
      if (item['kind'] === 'folder') {
        if (typeof item['name'] !== 'string' || item['name'].length === 0) return { ok: false, message: `pages[${i}][${j}] folder 缺少 name` }
        if (!Array.isArray(item['children']) || item['children'].length === 0) return { ok: false, message: `pages[${i}][${j}] folder.children 必须是非空数组` }
        // 递归校验 children（folder 内再套 folder → 深度 >2 → 拒）
        for (const child of item['children'] as unknown[]) {
          if (typeof child !== 'object' || child === null) return { ok: false, message: `pages[${i}][${j}] folder.children 元素必须是对象` }
          const c = child as Record<string, unknown>
          if (c['kind'] === 'folder') return { ok: false, message: `pages[${i}][${j}] folder.children 内不允许嵌套 folder（深度 ≤2 层）` }
          if (c['kind'] !== undefined && c['kind'] !== 'app') return { ok: false, message: `pages[${i}][${j}] folder.children 元素 kind 只能是 app` }
          if (typeof c['appId'] !== 'string' || c['appId'].length === 0) return { ok: false, message: `pages[${i}][${j}] folder.children 元素缺少 appId` }
        }
      } else if (item['kind'] === undefined || item['kind'] === 'app') {
        if (typeof item['appId'] !== 'string' || item['appId'].length === 0) return { ok: false, message: `pages[${i}][${j}] App 图标缺少 appId` }
        if (seen.has(item['appId'] as string)) return { ok: false, message: `pages[${i}][${j}] appId「${item['appId'] as string}」在本页重复` }
        seen.add(item['appId'] as string)
      } else {
        return { ok: false, message: `pages[${i}][${j}] kind「${String(item['kind'])}」不受支持（app/folder）` }
      }
    }
  }
  return { ok: true }
}

/** 序列化纯 JSON Schema（供服务端校验器 + 移动端 DTO 生成） */
export const DESKTOP_LAYOUT_JSON_SCHEMA = JSON.parse(JSON.stringify(DESKTOP_LAYOUT_SCHEMA)) as Record<string, unknown>