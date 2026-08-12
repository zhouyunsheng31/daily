import type { Request, Response, NextFunction } from 'express'

export interface ApiError {
  status: number
  code: string
  message: string
  detail?: unknown
}

export function createError(status: number, code: string, message: string, detail?: unknown): ApiError {
  return { status, code, message, detail }
}

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  if (isApiError(err)) {
    res.status(err.status).json({ error: err })
    return
  }

  console.error('[Server] Unhandled error:', err)
  res.status(500).json({
    error: {
      status: 500,
      code: 'INTERNAL_ERROR',
      message: 'Internal server error',
    },
  })
}

function isApiError(err: unknown): err is ApiError {
  return typeof err === 'object' && err !== null && 'status' in err && 'code' in err
}
