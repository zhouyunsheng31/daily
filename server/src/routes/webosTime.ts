import { Router } from 'express'

export interface WebOsTimeInfo {
  iso: string
  timestamp: number
  beijing: string
  weekday: string
  timezone: 'Asia/Shanghai'
}

const WEEKDAYS = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'] as const

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

/** 返回当前北京时间（UTC+8）的时间信息，与 billing/pricing.ts 的 isDeepSeekPeak 风格一致 */
export function getBeijingTimeInfo(now: Date = new Date()): WebOsTimeInfo {
  const beijing = new Date(now.getTime() + 8 * 3600_000)
  const beijingText = `${beijing.getUTCFullYear()}-${pad(beijing.getUTCMonth() + 1)}-${pad(beijing.getUTCDate())} ${pad(beijing.getUTCHours())}:${pad(beijing.getUTCMinutes())}:${pad(beijing.getUTCSeconds())}`
  return {
    iso: now.toISOString(),
    timestamp: now.getTime(),
    beijing: beijingText,
    weekday: WEEKDAYS[beijing.getUTCDay()] ?? '',
    timezone: 'Asia/Shanghai',
  }
}

/** 对话注入用：当前时间前缀（北京时间） */
export function beijingTimePrefix(now: Date = new Date()): string {
  const info = getBeijingTimeInfo(now)
  return `当前时间：${info.beijing.slice(0, 16)} ${info.weekday}（北京时间）`
}

export const webosTimeRouter = Router()
// 挂载于 app.use('/webos/api', authMiddleware, webosRouter, webosTimeRouter)：
// Express 会剥离 '/webos/api' 前缀，因此这里必须写 '/time'（'/webos/api/time' 才能命中）
webosTimeRouter.get('/time', (_req, res) => {
  res.json(getBeijingTimeInfo())
})
