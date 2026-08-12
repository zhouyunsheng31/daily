import { useCallback, useEffect, useState } from 'react'
import {
  Activity, Ban, BarChart3, Check, CircleDollarSign, Eye, KeyRound, LoaderCircle,
  LogOut, Search, ShieldCheck, Sparkles, Ticket, UserRound, Users, X,
} from 'lucide-react'
import { api, formatCredits, formatDate, formatTokens, type AdminUser, type GuestUser, type UsageItem, type UsageSummary, type ImageGenStats, type ImageGenPricing, type ImageGenUsageItem, type ServerStats, type ServerHealthAlert, type ServerMetricsPoint, type AfdianOrderItem, type RedeemCodeItem, type VisionStats, type VisionUsageItem } from './api'

type View = 'dashboard' | 'users' | 'imagegen' | 'vision' | 'orders' | 'redeem'

/** 字节数格式化（服务器状态展示） */
function formatBytes(value: number): string {
  if (value >= 1024 * 1024 * 1024 * 1024) return `${(value / 1024 / 1024 / 1024 / 1024).toFixed(2)} TB`
  if (value >= 1024 * 1024 * 1024) return `${(value / 1024 / 1024 / 1024).toFixed(1)} GB`
  if (value >= 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MB`
  return `${Math.round(value / 1024)} KB`
}
function formatUptime(sec: number): string {
  const days = Math.floor(sec / 86400)
  const hours = Math.floor((sec % 86400) / 3600)
  return days > 0 ? `${days}天${hours}小时` : `${hours}小时${Math.floor((sec % 3600) / 60)}分`
}

// ============================================================================
// 登录页
// ============================================================================

function LoginView({ onLogin }: { onLogin: () => void }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault()
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const result = await api.login(email.trim().toLowerCase(), password)
      if (result.user.role !== 'admin') {
        setError('该账号不是管理员，无法进入管理后台')
        await api.logout().catch(() => {})
        return
      }
      onLogin()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return <div className="login-wrap">
    <form className="login-card" onSubmit={(e) => void submit(e)}>
      <div className="login-logo"><span className="logo-mark">D</span><div><strong>Daily 管理后台</strong><small>admin.shadowshub.xyz</small></div></div>
      <label>管理员邮箱</label>
      <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="admin@example.com" autoComplete="email" disabled={busy} />
      <label>密码</label>
      <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="登录密码" autoComplete="current-password" disabled={busy} />
      <button type="submit" className="btn-primary" disabled={busy || !email.trim() || !password}>{busy ? <LoaderCircle className="spin" size={15} /> : <KeyRound size={15} />}登录</button>
      {error ? <p className="error-text">{error}</p> : null}
    </form>
  </div>
}

// ============================================================================
// 仪表盘
// ============================================================================

/** 历史负载趋势折线图（2026-08-06）：带宽 rx/tx + CPU，峰值点标注 */
function TrendChart({ points }: { points: ServerMetricsPoint[] }) {
  if (!points.length) return <p className="muted">暂无数据（监控刚上线，几分钟后开始积累历史记录）。</p>
  const W = 720
  const H = 150
  const P = 6
  const maxBandwidth = Math.max(0.1, ...points.map((p) => Math.max(p.rxMax, p.txMax)))
  const maxCpu = Math.max(10, ...points.map((p) => p.cpu))
  const x = (i: number): number => P + (points.length === 1 ? W / 2 : (i / (points.length - 1)) * (W - 2 * P))
  const yB = (v: number): number => H - P - (v / maxBandwidth) * (H - 2 * P)
  const yC = (v: number): number => H - P - (v / maxCpu) * (H - 2 * P)
  const path = (key: 'rxMax' | 'txMax' | 'cpu', yfn: (v: number) => number): string =>
    points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${yfn(Number(p[key]) || 0).toFixed(1)}`).join('')
  // 峰值：rx 最高点 + tx 最高点 + cpu 最高点
  let peakRx = points[0]; let peakTx = points[0]; let peakCpu = points[0]
  for (const p of points) {
    if (p.rxMax > peakRx.rxMax) peakRx = p
    if (p.txMax > peakTx.txMax) peakTx = p
    if (p.cpu > peakCpu.cpu) peakCpu = p
  }
  const fmtTime = (ts: number): string => new Date(ts).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
  return <div>
    <svg viewBox={`0 0 ${W} ${H}`} className="trend-chart" preserveAspectRatio="none" role="img" aria-label="负载历史趋势">
      {/* 峰值标注点 */}
      <circle cx={x(points.indexOf(peakRx))} cy={yB(peakRx.rxMax)} r="3" fill="#0ea5e9"><title>{`收带宽峰值 ${peakRx.rxMax} Mbps @ ${fmtTime(peakRx.ts)}`}</title></circle>
      <circle cx={x(points.indexOf(peakTx))} cy={yB(peakTx.txMax)} r="3" fill="#f59e0b"><title>{`发带宽峰值 ${peakTx.txMax} Mbps @ ${fmtTime(peakTx.ts)}`}</title></circle>
      <circle cx={x(points.indexOf(peakCpu))} cy={yC(peakCpu.cpu)} r="3" fill="#4f6ef7"><title>{`CPU 峰值 ${peakCpu.cpu}% @ ${fmtTime(peakCpu.ts)}`}</title></circle>
      <path d={path('rxMax', yB)} fill="none" stroke="#0ea5e9" strokeWidth="1.6" />
      <path d={path('txMax', yB)} fill="none" stroke="#f59e0b" strokeWidth="1.6" />
      <path d={path('cpu', yC)} fill="none" stroke="#4f6ef7" strokeWidth="1.1" strokeDasharray="3 3" />
    </svg>
    <div className="trend-legend">
      <span><i style={{ background: '#0ea5e9' }} />收带宽（峰值 Mbps）</span>
      <span><i style={{ background: '#f59e0b' }} />发带宽（峰值 Mbps）</span>
      <span><i style={{ background: '#4f6ef7' }} />CPU %（虚线）</span>
      <span className="trend-peak">峰值：收 <b>{peakRx.rxMax}</b> Mbps @ {fmtTime(peakRx.ts)} · 发 <b>{peakTx.txMax}</b> Mbps @ {fmtTime(peakTx.ts)} · CPU <b>{peakCpu.cpu}</b>% @ {fmtTime(peakCpu.ts)}</span>
    </div>
  </div>
}

function Dashboard({ summary, onRefresh }: { summary: UsageSummary | null; onRefresh: () => void }) {
  // 2026-08-06 服务器负载：5s 自动刷新（直观判断是否需要升级）
  const [server, setServer] = useState<{ stats: ServerStats; alerts: ServerHealthAlert[]; onlineUsers?: number } | null>(null)
  useEffect(() => {
    let cancelled = false
    const load = async (): Promise<void> => {
      try {
        const data = await api.serverStatus()
        if (!cancelled) setServer(data)
      } catch { /* 后台可能未就绪，静默 */ }
    }
    void load()
    const timer = window.setInterval(() => void load(), 5000)
    return () => { cancelled = true; window.clearInterval(timer) }
  }, [])
  // 2026-08-06 历史负载趋势（可追溯几天前的带宽/CPU 记录）
  const [metrics, setMetrics] = useState<ServerMetricsPoint[]>([])
  const [range, setRange] = useState<'24h' | '7d' | '30d'>('24h')
  useEffect(() => {
    let cancelled = false
    const now = Date.now()
    const span = range === '24h' ? 24 * 3600_000 : range === '7d' ? 7 * 24 * 3600_000 : 30 * 24 * 3600_000
    const load = async (): Promise<void> => {
      try {
        const data = await api.serverMetrics(now - span, now)
        if (!cancelled) setMetrics(data.points)
      } catch { /* ignore */ }
    }
    void load()
    const timer = window.setInterval(() => void load(), 60_000)
    return () => { cancelled = true; window.clearInterval(timer) }
  }, [range])
  if (!summary) return <div className="empty-card">加载中…</div>
  const kinds = Object.entries(summary.byKind)
  const statuses = Object.entries(summary.byStatus)
  const maxDay = Math.max(1, ...summary.byDay.map((d) => d.tokens))
  const s = server?.stats
  const alerts = server?.alerts ?? []
  const bar = (percent: number): string => `${Math.max(2, Math.min(100, Math.round(percent)))}%`
  const tone = (percent: number): string => percent > 90 ? 'bar-critical' : percent > 70 ? 'bar-warn' : ''
  return <div className="dashboard">
    {/* 服务器负载（CPU / 内存 / 磁盘 / 带宽） */}
    <div className="panel-card">
      <div className="panel-head"><strong>服务器负载</strong><small className="muted">{s ? `${s.hostname} · 运行 ${formatUptime(s.uptimeSec)} · ${s.cpu.cores} 核 · ${formatBytes(s.memory.totalBytes)} 内存 · 每 5s 刷新` : '加载中…'}</small><span className="online-chip" title="最近 5 分钟有请求的用户数">{server?.onlineUsers != null ? `● 在线 ${server.onlineUsers}` : ''}</span></div>
      {s ? <div className="server-grid">
        <div className="server-metric">
          <div className="server-label">CPU 使用率</div>
          <div className="server-value">{s.cpu.usagePercent}%</div>
          <div className="meter"><span className={tone(s.cpu.usagePercent)} style={{ width: bar(s.cpu.usagePercent) }} /></div>
          <small>负载 {s.loadavg['1m']} / {s.loadavg['5m']} / {s.loadavg['15m']}（每核 {s.cpu.loadPerCore}）</small>
        </div>
        <div className="server-metric">
          <div className="server-label">内存</div>
          <div className="server-value">{s.memory.usedPercent}%</div>
          <div className="meter"><span className={tone(s.memory.usedPercent)} style={{ width: bar(s.memory.usedPercent) }} /></div>
          <small>已用 {formatBytes(s.memory.usedBytes)} / 剩余 {formatBytes(s.memory.freeBytes)}</small>
        </div>
        <div className="server-metric">
          <div className="server-label">磁盘（根分区）</div>
          <div className="server-value">{s.disk.usedPercent}%</div>
          <div className="meter"><span className={tone(s.disk.usedPercent)} style={{ width: bar(s.disk.usedPercent) }} /></div>
          <small>已用 {formatBytes(s.disk.usedBytes)} / 剩余 {formatBytes(s.disk.freeBytes)}</small>
        </div>
        <div className="server-metric">
          <div className="server-label">带宽（近 5s）</div>
          <div className="server-value">↓ {s.network.rxMbps} / ↑ {s.network.txMbps} Mbps</div>
          <div className="meter"><span className={tone(Math.max(s.network.rxMbps, s.network.txMbps) * 4)} style={{ width: bar(Math.max(s.network.rxMbps, s.network.txMbps) * 4) }} /></div>
          <small>收 {formatBytes(s.network.rxBytesPerSec)}/s · 发 {formatBytes(s.network.txBytesPerSec)}/s</small>
        </div>
      </div> : <p className="muted">正在采集服务器状态…</p>}
      {alerts.length > 0 ? <div className="server-alerts">
        {alerts.map((a) => <div key={a.key} className={`alert-line ${a.level}`}><Activity size={13} />{a.message}</div>)}
      </div> : s ? <p className="muted">✅ 服务器状态健康，暂无升级/清理需求。</p> : null}
      {s ? <p className="muted">服务进程 PID {s.process.pid} · 占用内存 {formatBytes(s.process.rssBytes)} · 建议：CPU 长期 &gt;80%、内存 &gt;85%、磁盘 &gt;80%、带宽打满时考虑升级</p> : null}
    </div>
    {/* 2026-08-06 历史负载趋势（几分钟后开始积累；可追溯几天前的带宽/CPU 记录） */}
    <div className="panel-card">
      <div className="panel-head"><strong>历史负载趋势（可追溯）</strong>
        <div className="range-tabs">
          {(['24h', '7d', '30d'] as const).map((r) => (
            <button key={r} className={range === r ? 'active' : ''} onClick={() => setRange(r)}>{r === '24h' ? '24小时' : r === '7d' ? '7天' : '30天'}</button>
          ))}
        </div>
      </div>
      <TrendChart points={metrics} />
      <p className="muted">每分钟记录一条（带宽/CPU/内存/磁盘），保留 30 天；跨度 &gt;3 天自动按小时聚合。悬停峰值点查看具体时刻。</p>
    </div>
    <div className="stat-grid">
      <div className="stat-card"><span>近 {summary.days} 天请求数</span><strong>{summary.total.requests}</strong><small>成功 {statuses.find(([k]) => k === 'ok')?.[1] ?? 0} · 失败 {summary.total.requests - (statuses.find(([k]) => k === 'ok')?.[1] ?? 0)}</small></div>
      <div className="stat-card"><span>消耗 tokens</span><strong>{formatTokens(summary.total.tokens)}</strong><small>按 DeepSeek 真实 usage 计量</small></div>
      <div className="stat-card"><span>按分层</span><strong>{kinds.map(([k, v]) => `${k} ${v.requests}次`).join(' / ')}</strong><small>{kinds.map(([k, v]) => `${k} ${formatTokens(v.tokens)}`).join(' / ') || '暂无数据'}</small></div>
      <div className="stat-card"><span>状态分布</span><strong>{statuses.map(([k, v]) => `${k} ${v}`).join(' / ') || '—'}</strong><small>ok / failed / insufficient</small></div>
    </div>
    <div className="panel-card">
      <div className="panel-head"><strong>每日趋势（tokens）</strong><button className="ghost-btn" onClick={onRefresh}><Sparkles size={13} />刷新</button></div>
      {summary.byDay.length === 0 ? <p className="muted">近 {summary.days} 天暂无 AI 调用。</p> : <div className="day-bars">{summary.byDay.map((d) => (
        <div className="day-bar" key={d.day} title={`${d.day}：${d.requests} 次 / ${d.tokens} tokens`}><div className="day-bar-track"><span style={{ height: `${Math.max(4, Math.round((d.tokens / maxDay) * 100))}%` }} /></div><small>{d.day.slice(5)}</small><b>{d.requests}</b></div>
      ))}</div>}
    </div>
  </div>
}

// ============================================================================
// 用户列表
// ============================================================================

const KIND_LABEL: Record<string, string> = { guest: '游客', member: '会员', plan: '套餐' }
const ROLE_LABEL: Record<string, string> = { admin: '管理员', member: '会员' }

function UserRow({ userKey, name, email, role, kind, credits, appCount, usage, isBanned, createdAt, ip, onBan, onRole, onCredits, onUsage }: {
  userKey: string
  name: string
  email?: string
  role?: string
  kind: string
  credits: { quota: number; used: number; remaining: number }
  appCount: number
  usage: { reqs: number; tokens: number; lastActive: number | null }
  isBanned?: boolean
  createdAt?: number | null
  ip?: string | null
  onBan?: () => void
  onRole?: () => void
  onCredits: () => void
  onUsage: () => void
}) {
  return <div className="user-row">
    <div className="user-main">
      <span className={`kind-badge kind-${kind}`}>{KIND_LABEL[kind] ?? kind}</span>
      <div className="user-id"><strong>{name}</strong><small>{email ?? userKey}</small></div>
    </div>
    <div className="user-cell" title={`已用 ${formatCredits(credits.used)} / 总量 ${formatCredits(credits.quota)}`}>
      <span>剩余</span><b className={credits.remaining <= 0 ? 'danger' : ''}>{formatCredits(credits.remaining)}</b>
    </div>
    <div className="user-cell"><span>请求</span><b>{usage.reqs}</b><small>{formatTokens(usage.tokens)} tokens</small></div>
    <div className="user-cell"><span>App</span><b>{appCount}</b></div>
    <div className="user-cell user-ip" title={`注册 IP：${ip ?? '—'}`}><span>IP</span><b>{ip ?? '—'}</b><small>{createdAt ? formatDate(createdAt) : ''}</small></div>
    <div className="user-actions">
      {isBanned !== undefined ? <button className={`mini-btn ${isBanned ? 'danger' : ''}`} onClick={onBan} title={isBanned ? '解封' : '封禁'}>{isBanned ? <Check size={13} /> : <Ban size={13} />}</button> : null}
      {role !== undefined ? <button className="mini-btn" onClick={onRole} title={`角色：${ROLE_LABEL[role] ?? role}`}>{role === 'admin' ? <ShieldCheck size={13} /> : <UserRound size={13} />}</button> : null}
      <button className="mini-btn" onClick={onCredits} title="调整积分额度"><CircleDollarSign size={13} /></button>
      <button className="mini-btn" onClick={onUsage} title="用量明细"><BarChart3 size={13} /></button>
    </div>
  </div>
}

function UsersView({ onAdjustCredits, onShowUsage }: {
  onAdjustCredits: (userKey: string, name: string) => void
  onShowUsage: (userKey: string, name: string) => void
}) {
  const [data, setData] = useState<{ users: AdminUser[]; guests: GuestUser[] } | null>(null)
  const [q, setQ] = useState('')
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      setData(await api.users())
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [])
  useEffect(() => { void load() }, [load])

  const users = data?.users ?? []
  const guests = data?.guests ?? []
  const query = q.trim().toLowerCase()
  const filteredUsers = query ? users.filter((u) => u.email.toLowerCase().includes(query) || u.username.toLowerCase().includes(query) || (u.registeredIp ?? '').includes(query)) : users
  const filteredGuests = query ? guests.filter((g) => g.deviceId.toLowerCase().includes(query) || g.id.toLowerCase().includes(query)) : guests

  const act = async (fn: () => Promise<unknown>): Promise<void> => {
    try { await fn(); setError(null); await load() }
    catch (err) { setError(err instanceof Error ? err.message : String(err)) }
  }

  return <div className="users-view">
    <div className="toolbar"><div className="search-box"><Search size={14} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜索邮箱 / 用户名 / IP / 游客 ID…" /></div><span className="toolbar-count">注册用户 {users.length} · 游客 {guests.length}</span><button className="ghost-btn" onClick={() => void load()}><Sparkles size={13} />刷新</button></div>
    {error ? <p className="error-text">{error}</p> : null}
    <div className="panel-card">
      <div className="panel-head"><strong>注册用户</strong></div>
      <div className="user-table-head"><span>用户</span><span>剩余积分</span><span>AI 用量</span><span>App</span><span>注册 IP / 时间</span><span>操作</span></div>
      {filteredUsers.length === 0 ? <p className="muted">暂无注册用户。</p> : filteredUsers.map((u) => (
        <UserRow key={u.id} userKey={`user:${u.id}`} name={u.username} email={u.email} role={u.role} kind={u.kind} credits={u.credits} appCount={u.appCount} usage={u.usage} isBanned={u.isBanned} createdAt={u.createdAt} ip={u.registeredIp}
          onBan={() => void act(() => api.ban(u.id, !u.isBanned))}
          onRole={() => void act(() => api.setRole(u.id, u.role === 'admin' ? 'member' : 'admin'))}
          onCredits={() => onAdjustCredits(`user:${u.id}`, u.email)}
          onUsage={() => onShowUsage(`user:${u.id}`, u.email)} />
      ))}
    </div>
    <div className="panel-card">
      <div className="panel-head"><strong>游客</strong><small>未注册的设备会话（token 1 万）</small></div>
      <div className="user-table-head"><span>游客</span><span>剩余积分</span><span>AI 用量</span><span>App</span><span>创建时间</span><span>操作</span></div>
      {filteredGuests.length === 0 ? <p className="muted">暂无游客。</p> : filteredGuests.map((g) => (
        <UserRow key={g.id} userKey={g.id} name={`游客 ${g.deviceId.slice(0, 8)}`} kind={g.kind} credits={g.credits} appCount={g.appCount} usage={g.usage} createdAt={g.createdAt}
          onCredits={() => onAdjustCredits(g.id, `游客 ${g.deviceId.slice(0, 8)}`)}
          onUsage={() => onShowUsage(g.id, `游客 ${g.deviceId.slice(0, 8)}`)} />
      ))}
    </div>
  </div>
}

// ============================================================================
// 弹窗：token 调整 / 用量明细
// ============================================================================

function AdjustTokensModal({ userKey, name, onClose, onDone }: {
  userKey: string
  name: string
  onClose: () => void
  onDone: () => void
}) {
  const [quota, setQuota] = useState('100000000')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const submit = async (): Promise<void> => {
    const value = Math.floor(Number(quota))
    if (!Number.isFinite(value) || value < 0) { setError('请输入非负整数'); return }
    setBusy(true)
    setError(null)
    try {
      await api.adjustCredits(userKey, value)
      onDone()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }
  return <div className="modal-overlay" onClick={onClose}>
    <div className="modal" onClick={(e) => e.stopPropagation()}>
      <div className="modal-head"><strong>调整积分额度</strong><button className="icon-btn" onClick={onClose}><X size={15} /></button></div>
      <p className="muted">{name}（{userKey}）</p>
      <label>总配额（积分）</label>
      <input type="number" value={quota} onChange={(e) => setQuota(e.target.value)} disabled={busy} />
      <div className="quick-rows">
        <button className="chip" onClick={() => setQuota('100000')}>1000（会员）</button>
        <button className="chip" onClick={() => setQuota('100000000')}>990（套餐）</button>
        <button className="chip" onClick={() => setQuota('0')}>0（封停）</button>
      </div>
      {error ? <p className="error-text">{error}</p> : null}
      <div className="modal-actions"><button className="ghost-btn" onClick={onClose}>取消</button><button className="btn-primary" onClick={() => void submit()} disabled={busy}>{busy ? <LoaderCircle className="spin" size={14} /> : <Check size={14} />}保存</button></div>
    </div>
  </div>
}

function UsageModal({ userKey, name, onClose }: { userKey: string; name: string; onClose: () => void }) {
  const [items, setItems] = useState<UsageItem[]>([])
  const [total, setTotal] = useState(0)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    api.usage(userKey).then((r) => { setItems(r.items); setTotal(r.total) }).catch((err) => setError(err instanceof Error ? err.message : String(err)))
  }, [userKey])
  return <div className="modal-overlay" onClick={onClose}>
    <div className="modal modal-wide" onClick={(e) => e.stopPropagation()}>
      <div className="modal-head"><strong>AI 用量明细</strong><span className="muted">{name} · 共 {total} 次</span><button className="icon-btn" onClick={onClose}><X size={15} /></button></div>
      {error ? <p className="error-text">{error}</p> : null}
      <div className="usage-table">
        <div className="usage-head"><span>时间</span><span>模型/思考</span><span>tokens</span><span>状态</span><span>IP</span></div>
        {items.length === 0 ? <p className="muted">暂无记录。</p> : items.map((item) => (
          <div className="usage-row" key={item.id}>
            <span>{formatDate(item.createdAt)}</span>
            <span>{item.model} · {item.thinking}</span>
            <span>{item.totalTokens}（{item.promptTokens}+{item.completionTokens}）</span>
            <span className={`status-${item.status}`}>{item.status}{item.errorCode ? ` · ${item.errorCode}` : ''}</span>
            <span>{item.ip ?? '—'}</span>
          </div>
        ))}
      </div>
    </div>
  </div>
}

// ============================================================================
// 生图监测（2026-08-02）：模型调用是否正常、失败/超时/报错统计
// ============================================================================

const STATUS_LABEL: Record<string, string> = { ok: '成功', failed: '失败', timeout: '超时', insufficient: '额度不足' }

function ImageGenView() {
  const [stats, setStats] = useState<ImageGenStats | null>(null)
  const [pricing, setPricing] = useState<ImageGenPricing | null>(null)
  const [items, setItems] = useState<ImageGenUsageItem[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [days, setDays] = useState(7)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (d: number) => {
    try {
      const [s, p] = await Promise.all([api.imageGenStats(d), api.imageGenPricing()])
      setStats(s)
      setPricing(p)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [])

  const loadUsage = useCallback(async (pg: number) => {
    try {
      const r = await api.imageGenUsage('', pg)
      setItems(r.items)
      setTotal(r.total)
    } catch { /* keep */ }
  }, [])

  useEffect(() => { void load(days) }, [load, days])
  useEffect(() => { void loadUsage(page) }, [loadUsage, page])

  if (!stats) return <div className="empty-card">加载中…</div>
  const maxDay = Math.max(1, ...stats.byDay.map((d) => d.requests))
  const failedTotal = stats.failed + stats.timeout
  const statuses = stats.byStatus

  return <div className="dashboard">
    <div className="stat-grid">
      <div className="stat-card"><span>近 {stats.days} 天生图请求</span><strong>{stats.total}</strong><small>成功 {stats.ok} · 失败 {failedTotal} · 额度不足 {stats.insufficient}</small></div>
      <div className="stat-card"><span>成功率</span><strong className={stats.successRate < 90 ? 'danger' : ''}>{stats.successRate}%</strong><small>超时 {stats.timeout} 次 · 报错 {stats.failed} 次</small></div>
      <div className="stat-card"><span>平均耗时</span><strong>{stats.avgDurationMs}s</strong><small>成功请求平均 {stats.avgOkDurationMs}s</small></div>
      <div className="stat-card"><span>产出 / 费用</span><strong>{stats.imagesProduced} 张</strong><small>消耗 {formatTokens(stats.totalTokens)} tokens · ¥{(stats.totalCostMinor / 100).toFixed(2)}</small></div>
    </div>

    <div className="panel-card">
      <div className="panel-head">
        <strong>生图定价（当前模型 {pricing?.model ?? 'gpt-image-2-super'}）</strong>
        <div className="meta"><span className="chip">输入 ¥{pricing?.inputPerMillion ?? 16} / 百万 token</span><span className="chip">输出 ¥{pricing?.outputPerMillion ?? 60} / 百万 token</span><span className="chip">{pricing?.currency ?? 'CNY'}</span>
          <button className="ghost-btn" onClick={() => { void load(days); void loadUsage(page) }}><Sparkles size={13} />刷新</button>
          <select value={days} onChange={(e) => { setDays(Number(e.target.value)); setPage(1) }} className="ghost-select">
            <option value={1}>近 1 天</option><option value={7}>近 7 天</option><option value={30}>近 30 天</option>
          </select>
        </div>
      </div>
      {error ? <p className="error-text">{error}</p> : null}
      <div className="day-bars">
        {stats.byDay.length === 0 ? <p className="muted">该时间段暂无生图调用。</p> : stats.byDay.map((d) => (
          <div className="day-bar" key={d.day} title={`${d.day}：${d.requests} 次（成功 ${d.ok} / 失败 ${d.failed}）· ${d.tokens} tokens`}>
            <div className="day-bar-track"><span style={{ height: `${Math.max(4, Math.round((d.requests / maxDay) * 100))}%` }} className={d.failed > 0 ? 'has-failed' : ''} /></div>
            <small>{d.day.slice(5)}</small><b>{d.requests}</b>
          </div>
        ))}
      </div>
    </div>

    <div className="panel-card">
      <div className="panel-head"><strong>状态分布与错误码</strong></div>
      <div className="two-col">
        <div className="usage-table">
          <div className="usage-head"><span>状态</span><span>次数</span></div>
          {statuses.length === 0 ? <p className="muted">暂无数据。</p> : statuses.map((s) => (
            <div className="usage-row" key={s.status}><span>{STATUS_LABEL[s.status] ?? s.status}</span><span>{s.count}</span></div>
          ))}
        </div>
        <div className="usage-table">
          <div className="usage-head"><span>错误码</span><span>次数</span></div>
          {stats.byError.length === 0 ? <p className="muted">无失败记录 ✅（未返回 / 报错 / 超时都会在这里出现）</p> : stats.byError.map((e) => (
            <div className="usage-row" key={e.code}><span className="danger">{e.code}</span><span>{e.count}</span></div>
          ))}
        </div>
      </div>
    </div>

    <div className="panel-card">
      <div className="panel-head"><strong>调用明细（最近 {items.length} / 共 {total} 条）</strong><button className="ghost-btn" onClick={() => { setPage((p) => Math.max(1, p - 1)); void loadUsage(page) }} disabled={page <= 1}>上一页</button><button className="ghost-btn" onClick={() => { setPage((p) => p + 1); void loadUsage(page) }} disabled={page * 30 >= total}>下一页</button></div>
      <div className="usage-table">
        <div className="usage-head"><span>时间</span><span>用户</span><span>提示词</span><span>图/张数</span><span>耗时</span><span>tokens / 费用</span><span>状态</span></div>
        {items.length === 0 ? <p className="muted">暂无记录。</p> : items.map((item) => (
          <div className="usage-row" key={item.id}>
            <span>{formatDate(item.createdAt)}</span>
            <span title={item.userKey}>{item.userEmail ?? item.userKey.slice(0, 20)}</span>
            <span className="prompt-cell" title={item.prompt}>{item.prompt || '—'}</span>
            <span>{item.images}/{item.n}</span>
            <span>{item.durationMs}s</span>
            <span>{item.totalTokens} · ¥{(item.costMinor / 100).toFixed(2)}</span>
            <span className={`status-${item.status}`}>{STATUS_LABEL[item.status] ?? item.status}{item.errorCode ? ` · ${item.errorCode}` : ''}</span>
          </div>
        ))}
      </div>
    </div>
  </div>
}

// ============================================================================
// 爱发电订单（2026-08-06）：订单列表 + 待发货筛选 + 人工补发
// ============================================================================

function OrdersView() {
  const [filter, setFilter] = useState<'all' | 'pending' | 'done'>('all')
  const [items, setItems] = useState<AfdianOrderItem[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busyNo, setBusyNo] = useState<string | null>(null)
  const [fixRemark, setFixRemark] = useState<string | null>(null)
  const [fixRemarkValue, setFixRemarkValue] = useState<Record<string, string>>({})

  const load = useCallback(async (targetPage = 1, targetFilter: 'all' | 'pending' | 'done' = filter): Promise<void> => {
    setLoading(true)
    setError(null)
    try {
      const res = await api.paymentOrders({
        delivered: targetFilter === 'all' ? undefined : targetFilter === 'pending' ? 0 : 1,
        page: targetPage,
        limit: 20,
      })
      setItems(res.list)
      setTotal(res.total)
      setPage(targetPage)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '订单加载失败')
    } finally {
      setLoading(false)
    }
  }, [filter])

  useEffect(() => { void load(1, filter) }, [filter, load])

  const redeliver = async (outTradeNo: string): Promise<void> => {
    setBusyNo(outTradeNo)
    try {
      const res = await api.redeliverOrder(outTradeNo, fixRemark ?? undefined)
      if (res.result.ec !== 200) setError(`补发返回异常：${res.result.em ?? 'ec=' + res.result.ec}`)
      setFixRemark(null)
      await load(page, filter)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '补发失败')
    } finally {
      setBusyNo(null)
    }
  }

  return <div className="users-view">
    <div className="toolbar">
      <div className="filter-tabs">
        <button className={filter === 'all' ? 'active' : ''} onClick={() => setFilter('all')}>全部（{total}）</button>
        <button className={filter === 'pending' ? 'active' : ''} onClick={() => setFilter('pending')}>待处理</button>
        <button className={filter === 'done' ? 'active' : ''} onClick={() => setFilter('done')}>已发货</button>
      </div>
      <span className="toolbar-count">爱发电订单与发货记录 · 自动到账（webhook + API 对账）</span>
      <button className="ghost-btn" onClick={() => void load(page, filter)}><Sparkles size={13} />刷新</button>
    </div>
    {error ? <p className="error-text">{error}</p> : null}
    <div className="panel-card">
      <div className="panel-head"><strong>订单列表</strong>{loading ? <small className="muted">加载中…</small> : <small className="muted">共 {total} 条</small>}</div>
      <div className="order-table">
        <div className="order-head"><span>时间</span><span>订单号</span><span>档位 / 金额</span><span>留言（邮箱）</span><span>渠道</span><span>积分</span><span>状态</span><span>操作</span></div>
        {items.length === 0 ? <p className="muted">暂无订单。</p> : items.map((order) => (
          <div className="order-row" key={order.out_trade_no}>
            <span>{formatDate(order.created_at)}</span>
            <span className="mono" title={order.out_trade_no}>{order.out_trade_no.slice(-12)}</span>
            <span>{order.plan_name ?? order.plan_id.slice(0, 8)}<small className="muted"> ¥{order.amount}{order.product_type === 1 ? ' · 尝鲜包' : ` · ${order.month}个月`}</small></span>
            <span className="mono" title={order.remark ?? ''}>{order.remark || '—'}</span>
            <span>{order.channel === 'webhook' ? '回调' : '对账'}</span>
            <span className={order.credits > 0 ? 'income' : 'muted'}>{order.credits > 0 ? `+${order.credits}` : '0'}</span>
            <span>{order.delivered === 1
              ? <span className="status-ok">已发货{order.match_mode === 'duplicate' ? '（重复购买）' : ''}</span>
              : <span className="status-failed">未发货{order.error ? ` · ${order.error.slice(0, 40)}` : ''}</span>}</span>
            <span className="order-actions">
              {order.delivered === 1
                ? <small className="muted" title={order.matched_user ?? ''}>{order.matched_user?.slice(0, 16) ?? '—'}</small>
                : <button className="ghost-btn" disabled={busyNo === order.out_trade_no} onClick={() => void redeliver(order.out_trade_no)}>{busyNo === order.out_trade_no ? <LoaderCircle className="spin" size={12} /> : <Check size={12} />}补发</button>}
              {fixRemark === order.out_trade_no
                ? <span className="fix-remark"><input value={fixRemark === order.out_trade_no ? (fixRemarkValue[order.out_trade_no] ?? '') : ''} placeholder="修正邮箱后补发" onChange={(e) => setFixRemarkValue((v) => ({ ...v, [order.out_trade_no]: e.target.value }))} /><button className="ghost-btn" onClick={() => { redeliver(order.out_trade_no); setFixRemark(null) }}>确定</button></span>
                : order.delivered !== 1 ? <button className="link-btn" onClick={() => setFixRemark(order.out_trade_no)}>改邮箱</button> : null}
            </span>
          </div>
        ))}
      </div>
      {total > 20 ? <div className="pager"><button className="ghost-btn" disabled={page <= 1} onClick={() => void load(page - 1, filter)}>上一页</button><span className="muted">{page}</span><button className="ghost-btn" disabled={page * 20 >= total} onClick={() => void load(page + 1, filter)}>下一页</button></div> : null}
    </div>
  </div>
}

// ============================================================================
// 兑换码管理（2026-08-12）：爱发电兑换码导入 / 列表 / 撤销
// 流程：爱发电后台生成兑换码 → 这里批量导入本地表 → 用户在个人中心输入兑换码领取权益
// ============================================================================

/** 兑换码商品档位（与服务端 AFDIAN_TIERS 前 4 项一致；导入时选择归属档位） */
const REDEEM_TIERS = [
  { planId: '2aeac1b692e211f1972b5254001e7c00', name: '轻量月卡·兑换码（¥9.9）' },
  { planId: '2c0d304292e211f19b9f5254001e7c00', name: '中量月卡·兑换码（¥29）' },
  { planId: '2d295a7892e211f1a2f85254001e7c00', name: '重量月卡·兑换码（¥99）' },
  { planId: '7f42517e918511f19bde5254001e7c00', name: '尝鲜用量包（¥5）' },
]

const REDEEM_STATUS_LABEL: Record<string, string> = { unused: '未使用', used: '已使用', revoked: '已撤销' }

function RedeemCodesView() {
  const [filter, setFilter] = useState<'all' | 'unused' | 'used' | 'revoked'>('all')
  const [items, setItems] = useState<RedeemCodeItem[]>([])
  const [total, setTotal] = useState(0)
  const [counts, setCounts] = useState<{ unused: number; used: number; revoked: number }>({ unused: 0, used: 0, revoked: 0 })
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  // 导入表单
  const [importTier, setImportTier] = useState(REDEEM_TIERS[0].planId)
  const [importText, setImportText] = useState('')
  const [importing, setImporting] = useState(false)
  const [importError, setImportError] = useState<string | null>(null)

  // 批量撤销选中
  const [selected, setSelected] = useState<Record<string, boolean>>({})
  const [revoking, setRevoking] = useState(false)

  const load = useCallback(async (targetPage = 1, targetFilter: 'all' | 'unused' | 'used' | 'revoked' = filter): Promise<void> => {
    setLoading(true)
    setError(null)
    try {
      const res = await api.redeemCodes(targetFilter === 'all' ? undefined : targetFilter, targetPage, 50)
      setItems(res.list)
      setTotal(res.total)
      setPage(targetPage)
      setSelected({})
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '兑换码列表加载失败')
    } finally {
      setLoading(false)
    }
  }, [filter])

  const loadCounts = useCallback(async (): Promise<void> => {
    try {
      const [u, us, r] = await Promise.all([
        api.redeemCodes('unused', 1, 1),
        api.redeemCodes('used', 1, 1),
        api.redeemCodes('revoked', 1, 1),
      ])
      setCounts({ unused: u.total, used: us.total, revoked: r.total })
    } catch { /* keep */ }
  }, [])

  useEffect(() => { void load(1, filter); void loadCounts() }, [filter, load, loadCounts])

  const doImport = async (): Promise<void> => {
    const lines = importText.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'))
    if (lines.length === 0) { setImportError('请先粘贴兑换码（每行一个）'); return }
    const itemsToImport: Array<{ code: string; planId: string }> = []
    for (const line of lines) {
      const parts = line.split(/\s+/)
      const code = parts[0]
      const planId = parts.length >= 2 && /^[0-9a-f]{32}$/i.test(parts[1]) ? parts[1] : importTier
      if (code) itemsToImport.push({ code, planId })
    }
    if (itemsToImport.length === 0) { setImportError('没有可导入的兑换码'); return }
    setImporting(true)
    setImportError(null)
    setSuccess(null)
    try {
      const res = await api.importRedeemCodes(itemsToImport)
      setSuccess(`导入完成：成功 ${res.imported} 个，跳过 ${res.skipped} 个`)
      setImportText('')
      await load(1, filter)
      await loadCounts()
    } catch (caught) {
      setImportError(caught instanceof Error ? caught.message : '导入失败')
    } finally {
      setImporting(false)
    }
  }

  const doRevoke = async (codes: string[]): Promise<void> => {
    if (codes.length === 0) return
    if (!window.confirm(`确认撤销 ${codes.length} 个兑换码？撤销后不可再兑换。`)) return
    setRevoking(true)
    setError(null)
    setSuccess(null)
    try {
      const res = await api.revokeRedeemCodes(codes)
      setSuccess(`已撤销 ${res.revoked} 个兑换码`)
      await load(page, filter)
      await loadCounts()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '撤销失败')
    } finally {
      setRevoking(false)
    }
  }

  const selectedCodes = Object.keys(selected).filter((c) => selected[c])
  const importCount = importText.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#')).length

  return <div className="users-view">
    <div className="toolbar">
      <div className="filter-tabs">
        <button className={filter === 'all' ? 'active' : ''} onClick={() => setFilter('all')}>全部（{counts.unused + counts.used + counts.revoked}）</button>
        <button className={filter === 'unused' ? 'active' : ''} onClick={() => setFilter('unused')}>未使用（{counts.unused}）</button>
        <button className={filter === 'used' ? 'active' : ''} onClick={() => setFilter('used')}>已使用（{counts.used}）</button>
        <button className={filter === 'revoked' ? 'active' : ''} onClick={() => setFilter('revoked')}>已撤销（{counts.revoked}）</button>
      </div>
      <span className="toolbar-count">爱发电兑换码 · 用户个人中心输入兑换领取权益</span>
      <button className="ghost-btn" onClick={() => { void load(page, filter); void loadCounts() }}><Sparkles size={13} />刷新</button>
    </div>
    {error ? <p className="error-text">{error}</p> : null}
    {success ? <p className="ok-text">{success}</p> : null}

    {/* 导入卡片：爱发电后台生成兑换码后粘贴，每行一个 */}
    <div className="panel-card">
      <div className="panel-head"><strong>导入兑换码</strong><small className="muted">爱发电后台「设置 → 商品管理 → 兑换码」生成后粘贴到下方；每行一个，# 开头为注释；行内可写「码 plan_id」覆盖档位</small></div>
      <div className="redeem-import">
        <div className="redeem-import-row">
          <select value={importTier} onChange={(e) => setImportTier(e.target.value)} className="ghost-select">
            {REDEEM_TIERS.map((t) => <option key={t.planId} value={t.planId}>{t.name}</option>)}
          </select>
          <span className="muted">未写档位的兑换码按此档位导入</span>
        </div>
        <textarea value={importText} onChange={(e) => setImportText(e.target.value)} placeholder={'每行一个兑换码，例如：\nABCD1234EFGH5678\nIJKL9012MNOP3456'} rows={6} disabled={importing} />
        <div className="modal-actions">
          <span className="muted">{importCount} 个待导入</span>
          <button className="btn-primary" onClick={() => void doImport()} disabled={importing || !importText.trim()}>{importing ? <LoaderCircle className="spin" size={14} /> : <Ticket size={14} />}导入</button>
        </div>
        {importError ? <p className="error-text">{importError}</p> : null}
      </div>
    </div>

    {/* 列表卡片 */}
    <div className="panel-card">
      <div className="panel-head">
        <strong>兑换码列表</strong>
        {loading ? <small className="muted">加载中…</small> : <small className="muted">共 {total} 条</small>}
        {selectedCodes.length > 0 ? <button className="ghost-btn danger" disabled={revoking} onClick={() => void doRevoke(selectedCodes)}>{revoking ? <LoaderCircle className="spin" size={12} /> : <Ban size={12} />}撤销选中（{selectedCodes.length}）</button> : null}
      </div>
      <div className="redeem-table">
        <div className="redeem-head"><span>兑换码</span><span>档位</span><span>状态</span><span>兑换人</span><span>兑换时间</span><span>备注</span><span>操作</span></div>
        {items.length === 0 ? <p className="muted">暂无兑换码。</p> : items.map((item) => {
          const canSelect = item.status === 'unused'
          return <div className="redeem-row" key={item.code}>
            <span className="mono" title={item.code}>{item.code}</span>
            <span>{item.plan_name ?? item.plan_id.slice(0, 8)}</span>
            <span className={`status-${item.status}`}>{REDEEM_STATUS_LABEL[item.status] ?? item.status}</span>
            <span title={item.redeemed_by ?? ''}>{item.redeemed_by ? item.redeemed_by.slice(0, 20) : '—'}</span>
            <span>{formatDate(item.redeemed_at)}</span>
            <span className="note-cell" title={item.note ?? ''}>{item.note ?? '—'}</span>
            <span className="order-actions">
              {canSelect ? <input type="checkbox" checked={!!selected[item.code]} onChange={(e) => setSelected((s) => ({ ...s, [item.code]: e.target.checked }))} /> : null}
              {canSelect ? <button className="link-btn" onClick={() => void doRevoke([item.code])} disabled={revoking}>撤销</button> : null}
            </span>
          </div>
        })}
      </div>
      {total > 50 ? <div className="pager"><button className="ghost-btn" disabled={page <= 1} onClick={() => void load(page - 1, filter)}>上一页</button><span className="muted">{page}</span><button className="ghost-btn" disabled={page * 50 >= total} onClick={() => void load(page + 1, filter)}>下一页</button></div> : null}
    </div>
  </div>
}

// ============================================================================
// MiniMax-M3 视觉桥接监测（2026-08-14）：AI 的眼睛——DeepSeek 非视觉，
// 图片/视频经 M3 转文字描述，这里看平台在 M3 上的实时消耗（金额 + token）
// ============================================================================

const VISION_TRIGGER_LABEL: Record<string, string> = { chat_bridge: '对话自动桥接', read_tool: 'AI 读图', describe_media: '主动调用' }
const VISION_KIND_LABEL: Record<string, string> = { image: '图片', video: '视频', mixed: '混合', unsupported: '不支持' }

function VisionView() {
  const [stats, setStats] = useState<VisionStats | null>(null)
  const [items, setItems] = useState<VisionUsageItem[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [days, setDays] = useState(7)
  const [userKey, setUserKey] = useState('')
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (d: number) => {
    try {
      setStats(await api.visionStats(d))
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [])

  const loadUsage = useCallback(async (pg: number, uk: string) => {
    try {
      const r = await api.visionUsage(uk.trim(), pg)
      setItems(r.items)
      setTotal(r.total)
    } catch { /* keep */ }
  }, [])

  useEffect(() => { void load(days) }, [load, days])
  useEffect(() => { void loadUsage(page, userKey) }, [loadUsage, page, userKey])

  if (!stats) return <div className="empty-card">加载中…</div>
  const t = stats.total
  const successRate = t.calls > 0 ? Math.round((t.ok / t.calls) * 100) : 100
  const maxDay = Math.max(1, ...stats.byDay.map((d) => d.calls))
  const triggers = Object.entries(stats.byTrigger)
  const statuses = Object.entries(stats.byStatus)

  return <div className="dashboard">
    <div className="stat-grid">
      <div className="stat-card"><span>近 {stats.days} 天视觉调用</span><strong>{t.calls} 次</strong><small>成功 {t.ok} · 失败 {t.failed} · 媒体 {t.media} 条</small></div>
      <div className="stat-card"><span>M3 消耗金额</span><strong className={t.costMinor > 0 ? '' : ''}>¥{(t.costMinor / 100).toFixed(2)}</strong><small>按官方五折价 {stats.pricing?.inputPerMillion ?? 2.1}/{stats.pricing?.outputPerMillion ?? 8.4} 元/M</small></div>
      <div className="stat-card"><span>消耗 tokens</span><strong>{formatTokens(t.totalTokens)}</strong><small>输入 {formatTokens(t.inputTokens)} · 输出 {formatTokens(t.outputTokens)} · 缓存 {formatTokens(t.cachedTokens)}</small></div>
      <div className="stat-card"><span>成功率</span><strong className={successRate < 90 ? 'danger' : ''}>{successRate}%</strong><small>{statuses.map(([k, v]) => `${k} ${v}`).join(' / ') || '暂无失败'}</small></div>
    </div>

    <div className="panel-card">
      <div className="panel-head">
        <strong>视觉桥接（AI 的眼睛）· {stats.pricing?.model ?? 'MiniMax-M3'}</strong>
        <div className="meta"><span className="chip">输入 ¥{stats.pricing?.inputPerMillion ?? 2.1} / 百万</span><span className="chip">输出 ¥{stats.pricing?.outputPerMillion ?? 8.4} / 百万</span><span className="chip">缓存 ¥{stats.pricing?.cacheReadPerMillion ?? 0.42} / 百万</span><span className="chip">{stats.pricing?.note ?? ''}</span>
          <button className="ghost-btn" onClick={() => { void load(days); void loadUsage(page, userKey) }}><Sparkles size={13} />刷新</button>
          <select value={days} onChange={(e) => { setDays(Number(e.target.value)); setPage(1) }} className="ghost-select">
            <option value={1}>近 1 天</option><option value={7}>近 7 天</option><option value={30}>近 30 天</option>
          </select>
        </div>
      </div>
      <p className="muted">DeepSeek 无视觉能力，用户消息中的图片/视频或 AI 读取的图片文件，自动调用 MiniMax-M3 转成文字描述后再进入对话；每次调用按真实 token 用量计费（平台成本，不扣用户积分）。</p>
      <div className="day-bars">{stats.byDay.length === 0 ? <p className="muted">近 {stats.days} 天暂无视觉调用。</p> : stats.byDay.map((d) => (
        <div className="day-bar" key={d.day} title={`${d.day}：${d.calls} 次 / ${formatTokens(d.tokens)} tokens / ¥${(d.costMinor / 100).toFixed(2)}`}><div className="day-bar-track"><span style={{ height: `${Math.max(4, Math.round((d.calls / maxDay) * 100))}%` }} /></div><small>{d.day.slice(5)}</small><b>{d.calls}</b></div>
      ))}</div>
      {triggers.length > 0 ? <div className="trigger-row">{triggers.map(([k, v]) => (
        <span className="chip" key={k}>{VISION_TRIGGER_LABEL[k] ?? k}：{v.calls} 次 · {formatTokens(v.tokens)} tokens · ¥{(v.costMinor / 100).toFixed(2)}</span>
      ))}</div> : null}
    </div>

    {stats.byUser.length > 0 ? <div className="panel-card">
      <div className="panel-head"><strong>按用户 TOP（消耗金额）</strong></div>
      <div className="usage-table">
        <div className="usage-head"><span>用户</span><span>调用</span><span>成功</span><span>tokens</span><span>金额</span></div>
        {stats.byUser.map((u) => (
          <div className="usage-row" key={u.userKey}>
            <span>{u.userEmail ?? u.userKey}</span>
            <span>{u.calls}</span>
            <span>{u.ok}</span>
            <span>{formatTokens(u.tokens)}</span>
            <span>¥{(u.costMinor / 100).toFixed(2)}</span>
          </div>
        ))}
      </div>
    </div> : null}

    <div className="panel-card">
      <div className="panel-head">
        <strong>调用明细</strong>
        <div className="meta"><input className="ghost-input" value={userKey} onChange={(e) => { setUserKey(e.target.value); setPage(1) }} placeholder="筛选 userKey（user:xxx / guest:xxx）" style={{ width: 220 }} />
          <span className="muted">共 {total} 条</span></div>
      </div>
      {items.length === 0 ? <p className="muted">暂无记录。</p> : <>
        <div className="usage-table">
          <div className="usage-head"><span>时间</span><span>用户</span><span>触发/类型</span><span>tokens</span><span>费用</span><span>状态</span><span>描述摘要</span></div>
          {items.map((item) => (
            <div className="usage-row" key={item.id}>
              <span>{formatDate(item.createdAt)}</span>
              <span title={item.userKey}>{item.userEmail ?? item.userKey.slice(0, 20)}</span>
              <span>{VISION_TRIGGER_LABEL[item.trigger] ?? item.trigger} · {VISION_KIND_LABEL[item.kind] ?? item.kind}{item.mediaCount ? ` ×${item.mediaCount}` : ''}</span>
              <span>{formatTokens(item.totalTokens)}（{item.inputTokens}+{item.outputTokens}）</span>
              <span>¥{(item.costMinor / 100).toFixed(4)}</span>
              <span className={`status-${item.status}`}>{item.status}{item.errorCode ? ` · ${item.errorCode}` : ''}</span>
              <span className="note-cell" title={item.description ?? item.errorMessage ?? ''}>{item.description ? item.description.slice(0, 40) + '…' : (item.errorMessage ?? '—')}</span>
            </div>
          ))}
        </div>
        {total > 30 ? <div className="pager"><button className="ghost-btn" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>上一页</button><span className="muted">{page}</span><button className="ghost-btn" disabled={page * 30 >= total} onClick={() => setPage((p) => p + 1)}>下一页</button></div> : null}
      </>}
    </div>
    {error ? <p className="error-text">{error}</p> : null}
  </div>
}

// ============================================================================
// 主应用
// ============================================================================

export function App() {
  const [checking, setChecking] = useState(true)
  const [authed, setAuthed] = useState(false)
  const [me, setMe] = useState<{ username: string; email?: string } | null>(null)
  const [view, setView] = useState<View>('dashboard')
  const [summary, setSummary] = useState<UsageSummary | null>(null)
  const [adjustTarget, setAdjustTarget] = useState<{ userKey: string; name: string } | null>(null)
  const [usageTarget, setUsageTarget] = useState<{ userKey: string; name: string } | null>(null)

  const loadSummary = useCallback(async () => {
    try { setSummary(await api.usageSummary(7)) } catch { /* keep */ }
  }, [])

  useEffect(() => {
    api.me().then((result) => {
      if (result.authenticated && result.user && result.user.role === 'admin') {
        setAuthed(true)
        setMe({ username: result.user.username, email: result.user.email })
        void loadSummary()
      } else {
        setAuthed(false)
      }
    }).catch(() => setAuthed(false)).finally(() => setChecking(false))
  }, [loadSummary])

  if (checking) return <div className="boot-screen"><LoaderCircle className="spin" size={26} /></div>

  if (!authed) return <LoginView onLogin={() => { setAuthed(true); void loadSummary() }} />

  const logout = async (): Promise<void> => {
    try { await api.logout() } catch { /* ignore */ }
    setAuthed(false)
  }

  return <div className="shell">
    <header className="topbar">
      <div className="brand"><span className="logo-mark">D</span><strong>Daily 管理后台</strong></div>
      <nav className="tabs">
        <button className={view === 'dashboard' ? 'active' : ''} onClick={() => setView('dashboard')}><BarChart3 size={15} />仪表盘</button>
        <button className={view === 'users' ? 'active' : ''} onClick={() => setView('users')}><Users size={15} />用户与用量</button>
        <button className={view === 'orders' ? 'active' : ''} onClick={() => setView('orders')}><CircleDollarSign size={15} />爱发电订单</button>
        <button className={view === 'redeem' ? 'active' : ''} onClick={() => setView('redeem')}><Ticket size={15} />兑换码管理</button>
        <button className={view === 'imagegen' ? 'active' : ''} onClick={() => setView('imagegen')}><Sparkles size={15} />生图监测</button>
        <button className={view === 'vision' ? 'active' : ''} onClick={() => setView('vision')}><Eye size={15} />视觉模型</button>
      </nav>
      <div className="me"><Activity size={14} /><span>{me?.email ?? me?.username}</span><button className="ghost-btn" onClick={() => void logout()}><LogOut size={13} />退出</button></div>
    </header>
    <main className="content">
      {view === 'dashboard'
        ? <Dashboard summary={summary} onRefresh={() => void loadSummary()} />
        : view === 'users'
          ? <UsersView onAdjustCredits={(userKey, name) => setAdjustTarget({ userKey, name })} onShowUsage={(userKey, name) => setUsageTarget({ userKey, name })} />
          : view === 'orders'
            ? <OrdersView />
            : view === 'redeem'
              ? <RedeemCodesView />
              : view === 'vision'
                ? <VisionView />
                : <ImageGenView />}
    </main>
    {adjustTarget ? <AdjustTokensModal userKey={adjustTarget.userKey} name={adjustTarget.name} onClose={() => setAdjustTarget(null)} onDone={() => { setAdjustTarget(null); void loadSummary() }} /> : null}
    {usageTarget ? <UsageModal userKey={usageTarget.userKey} name={usageTarget.name} onClose={() => setUsageTarget(null)} /> : null}
  </div>
}