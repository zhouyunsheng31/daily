// ============================================================================
// 服务器负载监控（2026-08-06）
// 每 5s 采样一次 CPU / 内存 / 磁盘 / 带宽 / 负载，缓存供：
// - 管理后台仪表盘（直观展示，判断是否需要升级服务器）
// - AI 工具 get_server_status（admin 会话注入，AI 直接读取并给出升级建议）
// 零依赖：CPU 用 os.cpus 差值，带宽读 /proc/net/dev 差值，磁盘用 fs.statfsSync。
// ============================================================================
import os from 'node:os'
import fs from 'node:fs'
import { getPool } from '../db/connection.js'

export interface ServerStats {
  collectedAt: number
  hostname: string
  uptimeSec: number
  /** 1/5/15 分钟负载（Linux loadavg）；相对 CPU 核数可判断是否过载 */
  loadavg: { '1m': number; '5m': number; '15m': number }
  cpu: {
    cores: number
    /** 过去 5s 平均使用率 % */
    usagePercent: number
    /** 每核负载（loadavg1m / cores，>1 表示满载排队） */
    loadPerCore: number
  }
  memory: {
    totalBytes: number
    freeBytes: number
    usedBytes: number
    usedPercent: number
  }
  disk: {
    /** 根分区（服务器数据所在盘） */
    totalBytes: number
    freeBytes: number
    usedBytes: number
    usedPercent: number
  }
  network: {
    /** 最近 5s 平均速率 */
    rxBytesPerSec: number
    txBytesPerSec: number
    rxMbps: number
    txMbps: number
  }
  process: {
    pid: number
    /** 本服务进程内存（RSS，字节） */
    rssBytes: number
    /** 本服务进程 CPU（进程累计 CPU 时间秒） */
    cpuSeconds: number
  }
}

const SAMPLE_INTERVAL_MS = 5_000
let cached: ServerStats | null = null
let lastCpuTimes: { idle: number; total: number } | null = null
let lastNetBytes: { rx: number; tx: number } | null = null

/** 读取 /proc/net/dev 全部网卡（排除 lo）的累计收发字节 */
function readNetBytes(): { rx: number; tx: number } {
  try {
    const raw = fs.readFileSync('/proc/net/dev', 'utf-8')
    let rx = 0
    let tx = 0
    for (const line of raw.split('\n').slice(2)) {
      const match = line.match(/^\s*([^:]+):\s*(.+)$/)
      if (!match) continue
      const iface = match[1].trim()
      if (iface === 'lo') continue
      const parts = match[2].trim().split(/\s+/)
      const rxBytes = Number(parts[0]) || 0
      const txBytes = Number(parts[8]) || 0
      rx += rxBytes
      tx += txBytes
    }
    return { rx, tx }
  } catch {
    return { rx: 0, tx: 0 }
  }
}

function readCpuTimes(): { idle: number; total: number } {
  try {
    const cpus = os.cpus()
    let idle = 0
    let total = 0
    for (const cpu of cpus) {
      const t = cpu.times
      idle += t.idle
      total += t.user + t.nice + t.sys + t.idle + t.irq
    }
    return { idle, total }
  } catch {
    return { idle: 0, total: 0 }
  }
}

function readDiskStats(): { totalBytes: number; freeBytes: number } {
  try {
    // 根分区：数据/代码都在这块盘上
    const stat = fs.statfsSync('/')
    const totalBytes = stat.blocks * stat.bsize
    const freeBytes = stat.bavail * stat.bsize
    return { totalBytes, freeBytes }
  } catch {
    return { totalBytes: 0, freeBytes: 0 }
  }
}

function sample(): ServerStats {
  const now = Date.now()
  // CPU 使用率：与上一次采样差值
  const cpuTimes = readCpuTimes()
  let cpuUsagePercent = 0
  if (lastCpuTimes) {
    const idleDelta = cpuTimes.idle - lastCpuTimes.idle
    const totalDelta = cpuTimes.total - lastCpuTimes.total
    if (totalDelta > 0) {
      cpuUsagePercent = Math.max(0, Math.min(100, (1 - idleDelta / totalDelta) * 100))
    }
  }
  lastCpuTimes = cpuTimes
  // 带宽：与上一次采样差值
  const net = readNetBytes()
  let rxPerSec = 0
  let txPerSec = 0
  if (lastNetBytes) {
    const sec = SAMPLE_INTERVAL_MS / 1000
    rxPerSec = Math.max(0, (net.rx - lastNetBytes.rx) / sec)
    txPerSec = Math.max(0, (net.tx - lastNetBytes.tx) / sec)
  }
  lastNetBytes = net
  // 内存
  const mem = os.totalmem()
  const freeMem = os.freemem()
  // 磁盘
  const disk = readDiskStats()
  // 进程自身
  const loadavg = os.loadavg()
  const cores = os.cpus().length
  const rss = process.memoryUsage().rss

  const stats: ServerStats = {
    collectedAt: now,
    hostname: os.hostname(),
    uptimeSec: Math.floor(os.uptime()),
    loadavg: {
      '1m': Math.round(loadavg[0] * 100) / 100,
      '5m': Math.round(loadavg[1] * 100) / 100,
      '15m': Math.round(loadavg[2] * 100) / 100,
    },
    cpu: {
      cores,
      usagePercent: Math.round(cpuUsagePercent * 10) / 10,
      loadPerCore: Math.round((loadavg[0] / Math.max(1, cores)) * 100) / 100,
    },
    memory: {
      totalBytes: mem,
      freeBytes: freeMem,
      usedBytes: mem - freeMem,
      usedPercent: Math.round(((mem - freeMem) / Math.max(1, mem)) * 1000) / 10,
    },
    disk: {
      totalBytes: disk.totalBytes,
      freeBytes: disk.freeBytes,
      usedBytes: disk.totalBytes - disk.freeBytes,
      usedPercent: disk.totalBytes > 0 ? Math.round(((disk.totalBytes - disk.freeBytes) / disk.totalBytes) * 1000) / 10 : 0,
    },
    network: {
      rxBytesPerSec: Math.round(rxPerSec),
      txBytesPerSec: Math.round(txPerSec),
      rxMbps: Math.round((rxPerSec * 8) / 1_000_000 * 100) / 100,
      txMbps: Math.round((txPerSec * 8) / 1_000_000 * 100) / 100,
    },
    process: {
      pid: process.pid,
      rssBytes: rss,
      cpuSeconds: Math.round(process.cpuUsage().user / 1_000 + process.cpuUsage().system / 1_000),
    },
  }
  cached = stats
  return stats
}

let samplerStarted = false
export function startServerMonitor(): void {
  if (samplerStarted) return
  samplerStarted = true
  sample() // 首次采样（建立基准）
  setInterval(sample, SAMPLE_INTERVAL_MS)
}

/** 读取最近一次采样（未启动时先采样一次） */
export function getServerStats(): ServerStats {
  if (!cached) sample()
  return cached as ServerStats
}

/** 简易健康判断：返回需要注意的项（AI 与仪表盘共用） */
export function serverHealthAlerts(stats: ServerStats): Array<{ key: string; level: 'warn' | 'critical'; message: string }> {
  const alerts: Array<{ key: string; level: 'warn' | 'critical'; message: string }> = []
  const cores = stats.cpu.cores
  if (stats.cpu.loadPerCore > 1) {
    alerts.push({ key: 'cpu-load', level: stats.cpu.loadPerCore > 2 ? 'critical' : 'warn', message: `负载偏高：1 分钟负载 ${stats.loadavg['1m']}（${cores} 核），每核 ${stats.cpu.loadPerCore}（>1 表示排队）` })
  }
  if (stats.memory.usedPercent > 85) {
    alerts.push({ key: 'memory', level: stats.memory.usedPercent > 95 ? 'critical' : 'warn', message: `内存吃紧：已用 ${stats.memory.usedPercent}%（剩余 ${(stats.memory.freeBytes / 1024 / 1024 / 1024).toFixed(1)}GB）` })
  }
  if (stats.disk.usedPercent > 80) {
    alerts.push({ key: 'disk', level: stats.disk.usedPercent > 92 ? 'critical' : 'warn', message: `磁盘不足：已用 ${stats.disk.usedPercent}%（剩余 ${(stats.disk.freeBytes / 1024 / 1024 / 1024).toFixed(1)}GB）` })
  }
  return alerts
}

// ============================================================================
// 历史落库（2026-08-06）：每分钟写一条负载指标，保留 keepDays 天——
// 几天后仍可查某时间段的带宽/CPU/内存/磁盘记录（管理后台趋势图 + AI 追溯）。
// 需要 DB 就绪后调用 startMetricsPersist()（index.ts 在 initDb 之后启动）。
// ============================================================================
let persistStarted = false
let persistWarned = false
let persistTick = 0

// 2026-08-06 在线人数：最近 5 分钟有 API 请求的 user_key 集合（webos.ts 请求时标记）
const ONLINE_WINDOW_MS = 5 * 60_000
const activeUsers = new Map<string, number>()

/** 标记某用户活跃（webos.ts 的鉴权中间件调用；失败静默） */
export function markUserActive(userKey: string): void {
  try {
    activeUsers.set(userKey, Date.now())
    if (activeUsers.size > 500) {
      const now = Date.now()
      for (const [key, at] of activeUsers) {
        if (now - at > ONLINE_WINDOW_MS) activeUsers.delete(key)
      }
    }
  } catch { /* ignore */ }
}

/** 当前在线用户数（最近 5 分钟内活跃过） */
export function getOnlineUserCount(): number {
  const now = Date.now()
  let count = 0
  for (const at of activeUsers.values()) {
    if (now - at <= ONLINE_WINDOW_MS) count += 1
  }
  return count
}

/** 把最近一次采样写入历史表（每分钟由 startMetricsPersist 触发） */
async function persistMetric(): Promise<void> {
  const stats = getServerStats()
  try {
    const pool = getPool()
    await pool.query(
      `INSERT INTO webos_server_metrics
        (id, ts, cpu_usage, loadavg_1m, loadavg_5m, loadavg_15m, mem_used_pct, disk_used_pct, rx_mbps, tx_mbps, online_users)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       ON CONFLICT (id) DO NOTHING`,
      [
        `sm-${stats.collectedAt}`,
        stats.collectedAt,
        stats.cpu.usagePercent,
        stats.loadavg['1m'],
        stats.loadavg['5m'],
        stats.loadavg['15m'],
        stats.memory.usedPercent,
        stats.disk.usedPercent,
        stats.network.rxMbps,
        stats.network.txMbps,
        getOnlineUserCount(),
      ],
    )
  } catch (error) {
    if (!persistWarned) {
      persistWarned = true
      console.warn('[monitor] persist metric failed:', error instanceof Error ? error.message : String(error))
    }
  }
}

/** 删除超过保留期的历史记录（每小时执行一次） */
async function purgeOldMetrics(keepDays: number): Promise<void> {
  try {
    const pool = getPool()
    await pool.query('DELETE FROM webos_server_metrics WHERE ts < $1', [Date.now() - keepDays * 24 * 3600 * 1000])
  } catch { /* 清理失败不阻断 */ }
}

/**
 * 启动历史落库（幂等）：每分钟写一条，每小时清理一次过期数据。
 * keepDays：保留天数（默认 30）。
 */
export function startMetricsPersist(keepDays = 30): void {
  if (persistStarted) return
  persistStarted = true
  const keepMs = keepDays * 24 * 3600 * 1000
  // 2026-08-06 已有表加 online_users 列（SQLite 幂等：PRAGMA 检查）
  void (async () => {
    try {
      const pool = getPool()
      const cols = await pool.query('PRAGMA table_info(webos_server_metrics)')
      const hasCol = (cols.rows ?? []).some((c: { name?: unknown }) => String(c.name ?? '') === 'online_users')
      if (!hasCol) {
        await pool.query('ALTER TABLE webos_server_metrics ADD COLUMN online_users INTEGER NOT NULL DEFAULT 0')
        console.log('[monitor] added online_users column to webos_server_metrics')
      }
    } catch { /* 新库已有列 / PG 无 PRAGMA，忽略 */ }
  })()
  setInterval(() => {
    void persistMetric()
    persistTick += 1
    if (persistTick % 60 === 0) void purgeOldMetrics(Math.ceil(keepMs / (24 * 3600 * 1000)))
  }, 60_000)
}