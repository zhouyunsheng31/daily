// ============================================================================
// Phase 5 §3.2：背景图片上传路由
// 设计文档 §3.2："AI 可以上传图片当背景"
//
// 两个功能：
// 1. POST /api/background/upload-image — multipart/form-data 上传，需认证
// 2. GET /backgrounds/:filename — 公开静态服务（CSS url() 无法携带 auth header）
//
// 文件保存到 server/data/backgrounds/
// ============================================================================

import { Router } from 'express'
import multer from 'multer'
import { existsSync, mkdirSync, readdirSync, statSync } from 'fs'
import { extname, join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { randomUUID } from 'crypto'
import { createError, type ApiError } from '../middleware/error.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

/** 背景图片存储目录（server/data/backgrounds/） */
export const BACKGROUNDS_DIR = join(__dirname, '..', '..', 'data', 'backgrounds')

// 确保目录存在
if (!existsSync(BACKGROUNDS_DIR)) {
  mkdirSync(BACKGROUNDS_DIR, { recursive: true })
}

/** 允许的图片扩展名 */
const ALLOWED_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp'])

/** 最大文件大小 10MB */
const MAX_FILE_SIZE = 10 * 1024 * 1024

// multer 配置：内存存储 → 过滤 → 写入磁盘
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, BACKGROUNDS_DIR)
  },
  filename: (_req, file, cb) => {
    const ext = extname(file.originalname).toLowerCase()
    const safeExt = ALLOWED_EXTENSIONS.has(ext) ? ext : '.png'
    cb(null, `${randomUUID()}${safeExt}`)
  },
})

const fileFilter = (_req: unknown, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
  const ext = extname(file.originalname).toLowerCase()
  if (ALLOWED_EXTENSIONS.has(ext)) {
    cb(null, true)
  } else {
    // multer 要求传 Error 实例，附加 ApiError 属性以便 errorHandler 识别
    const err = new Error(`File type ${ext} not allowed. Allowed: ${Array.from(ALLOWED_EXTENSIONS).join(', ')}`) as Error & ApiError
    err.status = 400
    err.code = 'INVALID_FILE_TYPE'
    cb(err)
  }
}

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: MAX_FILE_SIZE },
})

export const backgroundRouter = Router()

/**
 * POST /api/background/upload-image
 * multipart/form-data 上传背景图片
 * 字段名：image（单文件）
 * 返回：{ url: string, filename: string }
 */
backgroundRouter.post('/upload-image', upload.single('image'), (req, res, next) => {
  try {
    if (!req.file) {
      throw createError(400, 'NO_FILE', 'No image file uploaded. Use field name "image".')
    }
    const filename = req.file.filename
    const url = `/backgrounds/${filename}`
    res.status(201).json({
      url,
      filename,
      originalName: req.file.originalname,
      size: req.file.size,
    })
  } catch (e) {
    next(e)
  }
})

/**
 * GET /api/background/list
 * 列出已上传的背景图片
 */
backgroundRouter.get('/list', (_req, res, next) => {
  try {
    if (!existsSync(BACKGROUNDS_DIR)) {
      res.json({ backgrounds: [] })
      return
    }
    const files = readdirSync(BACKGROUNDS_DIR).filter((f: string) => {
      const ext = extname(f).toLowerCase()
      return ALLOWED_EXTENSIONS.has(ext)
    })
    const backgrounds = files.map((filename: string) => {
      const stat = statSync(join(BACKGROUNDS_DIR, filename))
      return {
        url: `/backgrounds/${filename}`,
        filename,
        size: stat.size,
        createdAt: stat.mtimeMs,
      }
    })
    res.json({ backgrounds })
  } catch (e) {
    next(e)
  }
})

// ============================================================================
// 公开静态文件服务（不经过 authMiddleware）
// 在 index.ts 中注册：app.use('/backgrounds', express.static(BACKGROUNDS_DIR))
// 此处导出 BACKGROUNDS_DIR 供 index.ts 使用
// ============================================================================

export { BACKGROUNDS_DIR as BACKGROUNDS_PUBLIC_DIR }
