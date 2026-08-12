import { getPool } from './connection.js'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname_showcase = dirname(fileURLToPath(import.meta.url))
const SHOWCASE_HTML_DIR = join(__dirname_showcase, 'showcaseHtml')

function readShowcaseHtml(name: string): string {
  try {
    return readFileSync(join(SHOWCASE_HTML_DIR, name), 'utf-8')
  } catch {
    return `<!-- ${name} not found -->`
  }
}

const BUILTIN_TEMPLATES = [
  {
    id: 'builtin-study',
    name: '学习模板',
    icon: 'book-open',
    description: '学习场景预设',
    widgets: [
      { widgetType: 'vocabTrainer', position: { x: 20, y: 520, w: 360, h: 480 } },
    ],
    is_builtin: true,
  },
  {
    id: 'builtin-work',
    name: '工作模板',
    icon: 'briefcase',
    description: '工作场景预设',
    widgets: [
      { widgetType: 'taskList', position: { x: 20, y: 20, w: 340, h: 400 } },
      { widgetType: 'agendaList', position: { x: 380, y: 20, w: 320, h: 380 } },
      { widgetType: 'markdownEditor', position: { x: 380, y: 440, w: 450, h: 400 } },
    ],
    is_builtin: true,
  },
  {
    id: 'builtin-relax',
    name: '放松模板',
    icon: 'leaf',
    description: '放松场景预设',
    widgets: [
      { widgetType: 'breathingWidget', position: { x: 360, y: 20, w: 240, h: 280 } },
      { widgetType: 'quoteCard', position: { x: 20, y: 420, w: 280, h: 160 } },
      { widgetType: 'moodTracker', position: { x: 360, y: 420, w: 300, h: 340 } },
    ],
    is_builtin: true,
  },
  {
    id: 'builtin-review',
    name: '复盘模板',
    icon: 'bar-chart-3',
    description: '复盘场景预设',
    widgets: [
      { widgetType: 'statsPanel', position: { x: 20, y: 20, w: 340, h: 300 } },
      { widgetType: 'moodTracker', position: { x: 380, y: 20, w: 300, h: 340 } },
      { widgetType: 'habitTracker', position: { x: 20, y: 380, w: 340, h: 400 } },
      { widgetType: 'journal', position: { x: 380, y: 380, w: 380, h: 460 } },
    ],
    is_builtin: true,
  },
]

export async function seedBuiltinTemplates(): Promise<void> {
  // [server-boot] 诊断日志（保留便于未来排查启动卡点）
  const t0 = Date.now()
  const logStep = (label: string): void => {
    console.error(`[server-boot] +${Date.now() - t0}ms [seed] ${label}`)
  }

  logStep('entry')
  const pool = getPool()
  const now = Date.now()

  let inserted = 0
  for (const t of BUILTIN_TEMPLATES) {
    await pool.query(
      `INSERT INTO panel_templates (id, name, icon, description, widgets, is_builtin, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (id) DO NOTHING`,
      [t.id, t.name, t.icon, t.description, JSON.stringify(t.widgets), t.is_builtin, now, now]
    )
    inserted++
  }

  console.log(`[Seed] ${BUILTIN_TEMPLATES.length} builtin templates seeded (${inserted} upserted)`)
  logStep(`done (${inserted} templates)`)
}

// ---------------------------------------------------------------------------
// 展示面板（showcase panel）：供游客（未登录）访问 / 时展示
// owner_id=NULL, is_community=TRUE，不归属任何用户，所有人可见
// ---------------------------------------------------------------------------

const SHOWCASE_PANEL_ID = 'builtin-showcase'

const SHOWCASE_WIDGETS = [
  {
    id: 'showcase-bg',
    panel_id: SHOWCASE_PANEL_ID,
    type: 'freeHtml',
    x: 0, y: 0, width: 100, height: 100, z_index: 0,
    state: {
      html: readShowcaseHtml('background.html'),
      title: '背景特效',
      isGlobal: true,
      interactive: false,
      customZIndex: 0,
      schemaVersion: 1,
    },
  },
  {
    id: 'showcase-mouse-trail',
    panel_id: SHOWCASE_PANEL_ID,
    type: 'freeHtml',
    x: 0, y: 0, width: 100, height: 100, z_index: 9999,
    state: {
      html: readShowcaseHtml('mouse-trail.html'),
      title: '鼠标流动特效',
      isGlobal: true,
      interactive: false,
      customZIndex: 9999,
      schemaVersion: 1,
    },
  },
  {
    id: 'showcase-demo-1',
    panel_id: SHOWCASE_PANEL_ID,
    type: 'htmlCanvas',
    x: 200, y: 150, width: 480, height: 360, z_index: 10,
    state: {
      html: readShowcaseHtml('demo-iframe.html'),
      title: '展示内容',
      schemaVersion: 1,
    },
  },
] as const

export async function seedShowcasePanel(): Promise<void> {
  const t0 = Date.now()
  const logStep = (label: string): void => {
    console.error(`[server-boot] +${Date.now() - t0}ms [seed-showcase] ${label}`)
  }

  logStep('entry')
  const pool = getPool()
  const now = Date.now()

  // 1. 插入展示面板（owner_id=NULL，is_community=TRUE）
  await pool.query(
    `INSERT INTO panels (id, name, sort_order, settings, canvas_transform, created_at, updated_at, owner_id, is_community, community_api_url)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     ON CONFLICT (id) DO NOTHING`,
    [
      SHOWCASE_PANEL_ID,
      'Daily 展示',
      0,
      JSON.stringify({ layoutMode: 'free', gridSize: 20 }),
      null,
      now, now,
      null,   // owner_id = NULL（不归属任何用户）
      true,   // is_community = TRUE（社区面板，所有用户可见）
      null,   // community_api_url
    ]
  )
  logStep('panel upserted')

  // 2. 插入 3 个 widgets（ON CONFLICT DO UPDATE 确保 HTML 内容每次 seed 都更新）
  let widgetInserted = 0
  for (const w of SHOWCASE_WIDGETS) {
    await pool.query(
      `INSERT INTO widgets (id, panel_id, type, x, y, width, height, z_index, minimized, locked, color_scheme, state, is_primary, version, is_global, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
       ON CONFLICT (id) DO UPDATE SET state = EXCLUDED.state, updated_at = EXCLUDED.updated_at`,
      [
        w.id, w.panel_id, w.type,
        w.x, w.y, w.width, w.height, w.z_index,
        false,       // minimized
        false,       // locked
        null,        // color_scheme
        JSON.stringify(w.state),
        false,       // is_primary
        1,           // version
        0,           // is_global DB 列（0 = 非全局组件；与 state.isGlobal 不同语义）
        now, now,
      ]
    )
    widgetInserted++
  }

  console.log(`[Seed] showcase panel seeded (${widgetInserted} widgets upserted)`)
  logStep(`done (${widgetInserted} widgets)`)
}
