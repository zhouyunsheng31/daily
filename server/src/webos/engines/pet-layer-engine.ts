// server/src/webos/engines/pet-layer-engine.ts —— W4 type=pet-layer 最小执行引擎
// ----------------------------------------------------------------------------
// 依据：docs/routes/web/03-package-system.md §3（pet-layer = 场景 HTML + 行为参数 +
//       素材；桌面页共享 canvas 层，web 版桌宠层；悬浮窗形态 web 无）+ schema
//       pets{ maxInstances, physics }。
// 职责：
//   - loadPetLayerScene：读取包 entry HTML（manifest.entry 默认 index.html）+
//     行为参数（manifest.pets / contents.assets 素材清单），返回可直接注入桌面
//     的场景描述 { html, behavior, assets }；文件缺失返回默认场景（不抛阻断）；
//   - PET_LAYER_DEFAULT：默认场景 HTML + 行为参数（独立、无外部依赖）。
// ============================================================================

import fs from 'node:fs'
import path from 'node:path'

/** pet-layer 引擎默认场景（读取失败 / entry 缺失时的安全回退） */
export const PET_LAYER_DEFAULT = {
  html: `<!-- pet-layer 默认场景（W4 最小引擎回退） -->
<section class="pet-layer-scene" style="position:fixed;inset:auto 12px 12px auto;z-index:9;pointer-events:none;
  width:96px;height:96px;display:grid;place-items:center;font-size:56px;filter:drop-shadow(0 4px 10px rgba(0,0,0,.18));"
  aria-label="桌宠">🐾</section>`,
  behavior: { idle: true, physics: 'none', maxInstances: 1 } as PetLayerBehavior,
}

export interface PetLayerBehavior {
  /** 是否常驻待机动画 */
  idle?: boolean
  /** 物理/运动模型（schema pets.physics 透传） */
  physics?: string
  /** 最大同屏实例数（schema pets.maxInstances，默认 1） */
  maxInstances?: number
  /** 自定义行为参数（包声明透传） */
  [k: string]: unknown
}

export interface PetLayerScene {
  ok: boolean
  packageId: string
  /** 场景 HTML（entry 内容；缺失回退默认） */
  html: string
  /** 行为参数（manifest.pets 合并默认；失败回退默认） */
  behavior: PetLayerBehavior
  /** contents.assets 素材清单（相对路径；桌面侧据此加载） */
  assets: string[]
  /** 缺失/异常说明（正常读取为空） */
  note: string
}

/** 读取 pet-layer 包场景：entry HTML + pets 行为参数 + assets 素材清单 */
export function loadPetLayerScene(input: { packageId: string; pkgDir: string; manifest: Record<string, unknown> }): PetLayerScene {
  const { packageId, pkgDir, manifest } = input
  const entry = typeof manifest.entry === 'string' && manifest.entry ? manifest.entry : 'index.html'
  const notes: string[] = []

  // 1) entry HTML（缺失回退默认，不抛阻断）
  let html = PET_LAYER_DEFAULT.html
  try {
    const full = path.join(pkgDir, entry.replace(/\\/g, '/').replace(/^\/+/, ''))
    if (full.startsWith(pkgDir) && fs.existsSync(full) && fs.statSync(full).isFile()) {
      html = fs.readFileSync(full, 'utf-8')
    } else {
      notes.push(`entry「${entry}」不存在，使用默认场景`)
    }
  } catch (error) {
    notes.push(`读取 entry 失败：${error instanceof Error ? error.message : String(error)}`)
  }

  // 2) 行为参数（manifest.pets 合并默认；严格只取合法 key）
  const behavior: PetLayerBehavior = { ...PET_LAYER_DEFAULT.behavior }
  const pets = manifest.pets
  if (pets && typeof pets === 'object' && !Array.isArray(pets)) {
    const p = pets as Record<string, unknown>
    if (typeof p.maxInstances === 'number' && p.maxInstances >= 1 && p.maxInstances <= 32) behavior.maxInstances = p.maxInstances
    if (typeof p.physics === 'string' && p.physics.length <= 32) behavior.physics = p.physics
    if (typeof p.idle === 'boolean') behavior.idle = p.idle
  }

  // 3) 素材清单（contents.assets，防穿越 + 只留相对路径）
  const assets: string[] = []
  const contents = manifest.contents
  if (contents && typeof contents === 'object' && !Array.isArray(contents)) {
    const list = (contents as Record<string, unknown>).assets
    if (Array.isArray(list)) {
      for (const a of list) {
        if (typeof a !== 'string' || !a) continue
        const clean = a.replace(/\\/g, '/').replace(/^\/+/, '')
        if (!clean || clean.includes('..')) continue
        if (!assets.includes(clean)) assets.push(clean)
      }
    }
  }

  return {
    ok: notes.length === 0,
    packageId,
    html,
    behavior,
    assets,
    note: notes.join('；'),
  }
}

/** 统一入口（供 packages 生命周期挂接） */
export const petLayerEngine = {
  load: loadPetLayerScene,
  defaults: PET_LAYER_DEFAULT,
}