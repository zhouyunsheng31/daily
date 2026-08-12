import { Router } from 'express'
import { getPool, withTransaction } from '../db/connection.js'
import { broadcastChange } from '../ws.js'

export const settingsRouter = Router()

// GET /api/settings
settingsRouter.get('/', async (_req, res, next) => {
  try {
    const pool = getPool()
    const result = await pool.query('SELECT * FROM settings')
    const rows = result.rows as { key: string; value: unknown; updated_at: number }[]
    const settings: Record<string, unknown> = {}
    for (const row of rows) {
      if (row.key === 'activePanelId') continue // 单独的 API
      settings[row.key] = row.value
    }
    res.json(settings)
  } catch (e) { next(e) }
})

// PUT /api/settings
settingsRouter.put('/', async (req, res, next) => {
  try {
    const pool = getPool()
    const settings = req.body as Record<string, unknown>
    const now = Date.now()

    await withTransaction(async (client) => {
      for (const [key, val] of Object.entries(settings)) {
        await client.query(
          `INSERT INTO settings (key, value, updated_at) VALUES ($1, $2, $3)
           ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = $3`,
          [key, JSON.stringify(val), now]
        )
      }
    })

    res.json({ ok: true })
    broadcastChange({ kind: 'settings_updated', data: settings }, req.deviceId)
  } catch (e) { next(e) }
})
