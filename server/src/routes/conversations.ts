import { Router } from 'express'
import { getRecentConversations } from '../db/aiContext.js'

export const conversationsRouter = Router()

/**
 * GET /api/panels/:panelId/conversations
 * 获取面板的最近对话历史（Phase 8 批次3 模块C）
 * query: limit (可选，默认 50，最大 200)
 */
conversationsRouter.get('/:panelId/conversations', async (req, res, next) => {
  try {
    const panelId = req.params.panelId
    const limitParam = parseInt(req.query.limit as string, 10)
    const limit = Number.isFinite(limitParam) && limitParam > 0
      ? Math.min(limitParam, 200)
      : 50

    const conversations = await getRecentConversations(panelId, limit)
    res.json(conversations)
  } catch (err) {
    next(err)
  }
})
