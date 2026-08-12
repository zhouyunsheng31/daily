import { Router } from 'express'

const router = Router()

// 所有路由返回 501 Not Implemented
router.get('/', (_req, res) => res.status(501).json({ error: 'Wiki API not implemented (Phase 14.5 stub)' }))
router.post('/', (_req, res) => res.status(501).json({ error: 'Wiki API not implemented' }))
router.get('/:id', (_req, res) => res.status(501).json({ error: 'Wiki API not implemented' }))
router.put('/:id', (_req, res) => res.status(501).json({ error: 'Wiki API not implemented' }))
router.delete('/:id', (_req, res) => res.status(501).json({ error: 'Wiki API not implemented' }))
router.post('/search', (_req, res) => res.status(501).json({ error: 'Wiki API not implemented' }))

export { router as wikiRouter }
