// ============================================================================
// webOS 会话历史 API（2026-08-17 会话持久化修复 B 部分）
// ----------------------------------------------------------------------------
// 背景：用户反馈「换设备看不到之前的聊天记录」——根因是会话列表 100% 只存在
// 浏览器 localStorage，服务端 webos_chat_logs/webos_chat_sessions 只写不读。
// 本模块提供用户侧历史接口（不触碰冻结的 webos.ts）：
//   GET /webos/api/conversations            → 当前身份的历史会话列表
//   GET /webos/api/conversations/:id/messages → 单会话完整消息（按时间线重建）
// 前端接入后：登录/换设备时从服务端拉取历史，localStorage 仅作缓存。
// ============================================================================

import { Router } from 'express'
import { getPool } from '../db/connection.js'
import type { Principal } from './webos.js'

export const webosConversationsRouter = Router()

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

/** 会话列表：按 conversation_id 聚合，标题取该会话第一条 user 消息（截断 40 字） */
webosConversationsRouter.get('/conversations', async (req, res, next) => {
  try {
    const principal = principalFromRequest(req as never)
    if (!principal) return void res.status(401).json({ error: 'UNAUTHORIZED' })

    const pool = getPool()
    // 按 (conversation_id) 聚合：最新消息时间 / 消息数 / 标题（首条 user 消息截断）
    const rows = await pool.query(
      `SELECT
         conversation_id,
         COUNT(*) AS message_count,
         MAX(created_at) AS updated_at,
         (SELECT content FROM webos_chat_logs l2
           WHERE l2.user_key = webos_chat_logs.user_key
             AND l2.conversation_id = webos_chat_logs.conversation_id
             AND l2.role = 'user'
             AND l2.status = 'ok'
           ORDER BY l2.created_at ASC LIMIT 1) AS first_user_text
       FROM webos_chat_logs
       WHERE user_key = $1 AND status = 'ok'
       GROUP BY conversation_id
       ORDER BY updated_at DESC
       LIMIT 200`,
      [principal.key],
    )
    const conversations = (rows.rows ?? []).map((r) => ({
      conversationId: String(r.conversation_id ?? 'default'),
      messageCount: Number(r.message_count ?? 0),
      updatedAt: Number(r.updated_at ?? 0),
      title: String(r.first_user_text ?? '').replace(/\s+/g, ' ').slice(0, 40) || '新会话',
    }))
    res.json({ conversations })
  } catch (error) {
    next(error)
  }
})

/** 单会话消息：从 webos_chat_logs 按时间重建（user/assistant 交替；失败消息跳过） */
webosConversationsRouter.get('/conversations/:id/messages', async (req, res, next) => {
  try {
    const principal = principalFromRequest(req as never)
    if (!principal) return void res.status(401).json({ error: 'UNAUTHORIZED' })
    const conversationId = String(req.params.id ?? 'default').slice(0, 200)

    const pool = getPool()
    const rows = await pool.query(
      `SELECT role, content, created_at
       FROM webos_chat_logs
       WHERE user_key = $1 AND conversation_id = $2 AND status = 'ok' AND role IN ('user', 'assistant')
       ORDER BY created_at ASC
       LIMIT 1000`,
      [principal.key, conversationId],
    )
    const messages = (rows.rows ?? []).map((r) => ({
      role: String(r.role),
      content: String(r.content ?? ''),
      createdAt: Number(r.created_at ?? 0),
    }))
    res.json({ conversationId, messages })
  } catch (error) {
    next(error)
  }
})
