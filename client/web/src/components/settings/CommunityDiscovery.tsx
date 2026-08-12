import { useState, useEffect, useCallback, useMemo } from 'react'
import { Globe, Plus, Trash2, CheckCircle, Loader2, RefreshCw, Sparkles, ArrowRight, Users, Filter, X } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { ApiError } from '../../api/client'
import {
  getCommunities,
  getOfficialCommunities,
  addCommunity,
  deleteCommunity,
  getCommunityMembers,
  syncCommunityMembers,
  type CommunityDTO,
  type OfficialCommunityDTO,
  type CommunityMember,
  type MemberRole,
  type MemberStatus,
} from '../../api/communities'

// ============================================================================
// Phase 6：社区发现设置页（spec §9 + UI 原型 canvas-core-v8.html §4.4）
//
// 联邦式社区模型：每个 Daily 部署 = 一个独立社区实例。
// 本页 3 个 section：
// 1. 官方社区列表（硬编码 + DB is_official 记录合并）—— 一键添加
// 2. 手动添加社区（输入外部 Daily 实例 API 地址）
// 3. 已加入的社区（DB communities 表）—— 可移除
//
// MVP 阶段不实现跨社区内容抓取（需联邦协议），仅做社区注册表 + UI 展示。
// ============================================================================

export default function CommunityDiscovery() {
  const navigate = useNavigate()
  const [official, setOfficial] = useState<OfficialCommunityDTO[]>([])
  const [joined, setJoined] = useState<CommunityDTO[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // 手动添加表单
  const [manualName, setManualName] = useState('')
  const [manualAddr, setManualAddr] = useState('')
  const [adding, setAdding] = useState(false)
  const [addError, setAddError] = useState<string | null>(null)

  // 操作中的社区 id（按钮禁用 + loading）
  const [pendingId, setPendingId] = useState<string | null>(null)

  // Phase 6.4：成员管理/筛选
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [members, setMembers] = useState<CommunityMember[]>([])
  const [membersLoading, setMembersLoading] = useState(false)
  const [membersError, setMembersError] = useState<string | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [syncMessage, setSyncMessage] = useState<string | null>(null)
  // 筛选器：'' 表示不筛选
  const [filterRole, setFilterRole] = useState<MemberRole | ''>('')
  const [filterStatus, setFilterStatus] = useState<MemberStatus | ''>('')

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [officialList, joinedList] = await Promise.all([
        getOfficialCommunities(),
        getCommunities(),
      ])
      setOfficial(officialList)
      setJoined(joinedList)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  // 从官方清单一键添加
  const handleAddOfficial = async (oc: OfficialCommunityDTO) => {
    setPendingId(oc.id)
    setAddError(null)
    try {
      await addCommunity({
        name: oc.name,
        apiUrl: oc.apiUrl,
        description: oc.description,
        icon: oc.icon,
        isOfficial: true,
      })
      await refresh()
    } catch (err) {
      setAddError(err instanceof ApiError ? err.message : String(err))
    } finally {
      setPendingId(null)
    }
  }

  // 手动添加
  const handleAddManual = async () => {
    const name = manualName.trim()
    const addr = manualAddr.trim()
    if (!name || !addr) return
    setAdding(true)
    setAddError(null)
    try {
      await addCommunity({ name, apiUrl: addr })
      setManualName('')
      setManualAddr('')
      await refresh()
    } catch (err) {
      setAddError(err instanceof ApiError ? err.message : String(err))
    } finally {
      setAdding(false)
    }
  }

  // 移除已加入的社区
  const handleDelete = async (id: string, name: string) => {
    if (!window.confirm(`确认移除社区「${name}」？移除后可重新添加。`)) return
    setPendingId(id)
    setError(null)
    try {
      await deleteCommunity(id)
      if (expandedId === id) {
        setExpandedId(null)
        setMembers([])
      }
      await refresh()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err))
    } finally {
      setPendingId(null)
    }
  }

  // Phase 6.4：展开/收起成员列表
  const handleToggleMembers = async (id: string) => {
    if (expandedId === id) {
      setExpandedId(null)
      setMembers([])
      setMembersError(null)
      setSyncMessage(null)
      setFilterRole('')
      setFilterStatus('')
      return
    }
    setExpandedId(id)
    setMembers([])
    setMembersError(null)
    setSyncMessage(null)
    setFilterRole('')
    setFilterStatus('')
    setMembersLoading(true)
    try {
      const res = await getCommunityMembers(id)
      setMembers(res.members)
    } catch (err) {
      setMembersError(err instanceof ApiError ? err.message : String(err))
    } finally {
      setMembersLoading(false)
    }
  }

  // Phase 6.4：同步外部社区成员
  const handleSyncMembers = async (id: string) => {
    setSyncing(true)
    setSyncMessage(null)
    setMembersError(null)
    try {
      const res = await syncCommunityMembers(id)
      setMembers(res.members)
      setSyncMessage(res.syncResult.message)
    } catch (err) {
      setMembersError(err instanceof ApiError ? err.message : String(err))
    } finally {
      setSyncing(false)
    }
  }

  // 筛选后的成员列表
  const filteredMembers = useMemo(() => {
    return members.filter((m) => {
      if (filterRole && m.role !== filterRole) return false
      if (filterStatus && m.status !== filterStatus) return false
      return true
    })
  }, [members, filterRole, filterStatus])

  return (
    <section className="settings-section" style={{ padding: 16, maxWidth: 640 }}>
      <div className="provider-row__head" style={{ marginBottom: 4 }}>
        <div>
          <h2 style={{ fontSize: 16, fontWeight: 600, margin: 0 }}>社区发现</h2>
          <p className="settings-desc" style={{ marginTop: 4 }}>
            联邦式社区：每个 Daily 部署是一个独立社区实例，各社区独立注册登录。
            添加外部社区地址后可在本实例聚合展示。
          </p>
        </div>
        <button
          className="toolbar-btn toolbar-btn--icon"
          onClick={refresh}
          disabled={loading}
          title="刷新"
        >
          {loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
        </button>
      </div>

      {error && (
        <div className="settings-alert settings-alert--error" style={{ marginTop: 8 }}>
          {error}
        </div>
      )}

      {/* 1. 官方社区列表 */}
      <div style={{ marginTop: 16 }}>
        <div className="settings-section-title">官方社区列表</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {official.length === 0 && !loading && (
            <div className="settings-desc">暂无官方社区</div>
          )}
          {official.map(oc => {
            // Phase 7 §14：内置社区（isBuiltin）突出显示 + 可直接进入
            const isBuiltin = oc.isBuiltin === true
            return (
              <div
                key={oc.id}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: isBuiltin ? '12px 14px' : '8px 12px',
                  background: isBuiltin
                    ? 'linear-gradient(135deg, rgba(74,144,226,0.08), rgba(80,227,194,0.08))'
                    : 'var(--bg-elevated)',
                  borderRadius: 'var(--radius-sm)',
                  border: isBuiltin
                    ? '1px solid rgba(74,144,226,0.3)'
                    : '1px solid var(--border-default)',
                }}
              >
                <div style={{ minWidth: 0, flex: 1, display: 'flex', alignItems: 'center', gap: 10 }}>
                  {isBuiltin && (
                    <div
                      style={{
                        width: 32, height: 32, borderRadius: 8, flexShrink: 0,
                        background: 'linear-gradient(135deg, #4A90E2, #50E3C2)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        color: '#fff',
                      }}
                    >
                      <Sparkles size={16} />
                    </div>
                  )}
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 500, display: 'flex', alignItems: 'center', gap: 6 }}>
                      {oc.name}
                      {isBuiltin && (
                        <span
                          style={{
                            fontSize: 10, padding: '1px 6px', borderRadius: 999,
                            background: 'rgba(74,144,226,0.15)',
                            color: 'var(--color-primary, #4A90E2)',
                            fontWeight: 600,
                          }}
                        >
                          内置
                        </span>
                      )}
                    </div>
                    <div className="settings-desc" style={{ marginTop: 2 }}>{oc.description}</div>
                    <div style={{ fontSize: 10, color: 'var(--text-tertiary)', fontFamily: 'SF Mono, monospace', marginTop: 2 }}>
                      {oc.apiUrl || '（内置，无需外部地址）'}
                    </div>
                  </div>
                </div>
                {isBuiltin ? (
                  // Phase 7 §14：内置社区可直接进入，不需要"添加"
                  <button
                    className="toolbar-btn"
                    onClick={() => navigate('/shadowshubs')}
                    style={{
                      padding: '4px 10px', fontSize: 11,
                      background: 'var(--color-primary)',
                      color: '#fff',
                      display: 'inline-flex', alignItems: 'center', gap: 4,
                    }}
                  >
                    进入
                    <ArrowRight size={11} />
                  </button>
                ) : (
                  <button
                    className="toolbar-btn"
                    onClick={() => handleAddOfficial(oc)}
                    disabled={oc.added || pendingId === oc.id}
                    style={{
                      padding: '4px 10px', fontSize: 11,
                      background: oc.added ? 'transparent' : 'var(--color-primary)',
                      color: oc.added ? 'var(--text-tertiary)' : '#fff',
                    }}
                  >
                    {pendingId === oc.id ? (
                      <Loader2 size={11} className="animate-spin" />
                    ) : oc.added ? (
                      <CheckCircle size={11} />
                    ) : (
                      <Plus size={11} />
                    )}
                    {oc.added ? '已添加' : '添加'}
                  </button>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* 2. 手动添加社区 */}
      <div style={{ marginTop: 20 }}>
        <div className="settings-section-title">手动添加社区（输入地址）</div>
        <div className="provider-row__input-row">
          <input
            className="input-field"
            placeholder="社区名称（如：我的游戏社区）"
            value={manualName}
            onChange={(e) => setManualName(e.target.value)}
            style={{ flex: 1 }}
          />
        </div>
        <div className="provider-row__input-row">
          <input
            className="input-field input-field--flex"
            placeholder="https://community.example.com/api"
            value={manualAddr}
            onChange={(e) => setManualAddr(e.target.value)}
          />
          <button
            className="toolbar-btn primary toolbar-btn--labeled"
            onClick={handleAddManual}
            disabled={adding || !manualName.trim() || !manualAddr.trim()}
          >
            {adding ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
            {adding ? '添加中...' : '添加'}
          </button>
        </div>
        {addError && (
          <div className="settings-alert settings-alert--error" style={{ marginTop: 6 }}>
            {addError}
          </div>
        )}
      </div>

      {/* 3. 已加入的社区 */}
      <div style={{ marginTop: 20 }}>
        <div className="settings-section-title">已加入的社区</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {joined.length === 0 && !loading && (
            <div className="settings-desc">暂未加入任何社区</div>
          )}
          {joined.map(c => (
            <div
              key={c.id}
              style={{
                background: 'var(--bg-elevated)',
                borderRadius: 'var(--radius-sm)',
                border: expandedId === c.id
                  ? '1px solid var(--color-primary, #4A90E2)'
                  : '1px solid var(--border-default)',
                overflow: 'hidden',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, flex: 1 }}>
                  <Globe size={12} style={{ flexShrink: 0 }} />
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
                      {c.name}
                      {c.isOfficial && (
                        <span className="settings-badge settings-badge--primary">官方</span>
                      )}
                    </div>
                    <div style={{ fontSize: 10, color: 'var(--text-tertiary)', fontFamily: 'SF Mono, monospace', marginTop: 2 }}>
                      {c.apiUrl || '（内置，无外部地址）'}
                    </div>
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                  {/* Phase 6.4：成员列表按钮 */}
                  <button
                    className="toolbar-btn"
                    onClick={() => handleToggleMembers(c.id)}
                    disabled={membersLoading && expandedId === c.id}
                    title="成员列表"
                    style={{
                      padding: '4px 8px', fontSize: 11,
                      background: expandedId === c.id ? 'var(--color-primary, #4A90E2)' : 'transparent',
                      color: expandedId === c.id ? '#fff' : 'var(--text-secondary)',
                      display: 'inline-flex', alignItems: 'center', gap: 4,
                    }}
                  >
                    {membersLoading && expandedId === c.id ? (
                      <Loader2 size={11} className="animate-spin" />
                    ) : (
                      <Users size={11} />
                    )}
                    成员
                  </button>
                  <button
                    className="toolbar-btn toolbar-btn--danger toolbar-btn--icon"
                    onClick={() => handleDelete(c.id, c.name)}
                    disabled={pendingId === c.id}
                    title="移除社区"
                  >
                    {pendingId === c.id ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                  </button>
                </div>
              </div>

              {/* Phase 6.4：成员列表面板（展开时显示） */}
              {expandedId === c.id && (
                <div style={{
                  borderTop: '1px solid var(--border-default)',
                  padding: '10px 12px',
                  background: 'var(--bg-default, rgba(0,0,0,0.02))',
                }}>
                  {/* 筛选器 + 同步按钮 */}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                      <Filter size={11} style={{ color: 'var(--text-tertiary)' }} />
                      <span style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>筛选：</span>
                      <select
                        value={filterRole}
                        onChange={(e) => setFilterRole(e.target.value as MemberRole | '')}
                        style={{
                          fontSize: 10, padding: '2px 6px', borderRadius: 4,
                          background: 'var(--bg-elevated)', color: 'var(--text-primary)',
                          border: '1px solid var(--border-default)',
                        }}
                      >
                        <option value="">全部角色</option>
                        <option value="admin">admin</option>
                        <option value="moderator">moderator</option>
                        <option value="member">member</option>
                        <option value="guest">guest</option>
                      </select>
                      <select
                        value={filterStatus}
                        onChange={(e) => setFilterStatus(e.target.value as MemberStatus | '')}
                        style={{
                          fontSize: 10, padding: '2px 6px', borderRadius: 4,
                          background: 'var(--bg-elevated)', color: 'var(--text-primary)',
                          border: '1px solid var(--border-default)',
                        }}
                      >
                        <option value="">全部状态</option>
                        <option value="active">active</option>
                        <option value="inactive">inactive</option>
                        <option value="banned">banned</option>
                      </select>
                      {(filterRole || filterStatus) && (
                        <button
                          className="toolbar-btn toolbar-btn--icon"
                          onClick={() => { setFilterRole(''); setFilterStatus('') }}
                          title="清除筛选"
                          style={{ padding: '2px' }}
                        >
                          <X size={11} />
                        </button>
                      )}
                    </div>
                    {c.apiUrl && (
                      <button
                        className="toolbar-btn"
                        onClick={() => handleSyncMembers(c.id)}
                        disabled={syncing}
                        title="从外部社区同步成员"
                        style={{
                          padding: '3px 8px', fontSize: 10,
                          display: 'inline-flex', alignItems: 'center', gap: 4,
                        }}
                      >
                        {syncing ? <Loader2 size={10} className="animate-spin" /> : <RefreshCw size={10} />}
                        {syncing ? '同步中...' : '同步成员'}
                      </button>
                    )}
                  </div>

                  {/* 同步结果提示 */}
                  {syncMessage && (
                    <div className="settings-alert settings-alert--success" style={{ marginTop: 0, marginBottom: 8, padding: '4px 8px', fontSize: 11 }}>
                      {syncMessage}
                    </div>
                  )}
                  {/* 错误提示 */}
                  {membersError && (
                    <div className="settings-alert settings-alert--error" style={{ marginTop: 0, marginBottom: 8, padding: '4px 8px', fontSize: 11 }}>
                      {membersError}
                    </div>
                  )}

                  {/* 成员总数 + 筛选结果数 */}
                  <div style={{ fontSize: 10, color: 'var(--text-tertiary)', marginBottom: 6 }}>
                    共 {members.length} 人
                    {(filterRole || filterStatus) && ` · 筛选后 ${filteredMembers.length} 人`}
                  </div>

                  {/* 成员列表 */}
                  {membersLoading ? (
                    <div style={{ textAlign: 'center', padding: '12px 0', color: 'var(--text-tertiary)', fontSize: 11 }}>
                      <Loader2 size={14} className="animate-spin" style={{ display: 'inline-block', verticalAlign: 'middle' }} /> 加载中...
                    </div>
                  ) : filteredMembers.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: '12px 0', color: 'var(--text-tertiary)', fontSize: 11 }}>
                      暂无成员
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 3, maxHeight: 240, overflowY: 'auto' }}>
                      {filteredMembers.map(m => (
                        <div
                          key={m.id}
                          style={{
                            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                            padding: '4px 8px', borderRadius: 4,
                            background: 'var(--bg-elevated)',
                            border: '1px solid var(--border-default)',
                            fontSize: 11,
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                            <span style={{ fontWeight: 500 }}>{m.username}</span>
                            {m.isLocal && (
                              <span
                                style={{
                                  fontSize: 9, padding: '0 4px', borderRadius: 3,
                                  background: 'rgba(80,227,194,0.15)',
                                  color: 'var(--color-success, #50E3C2)',
                                  fontWeight: 600,
                                }}
                                title="本实例已注册用户"
                              >
                                本地
                              </span>
                            )}
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                            <span style={{
                              fontSize: 9, padding: '1px 5px', borderRadius: 3, fontWeight: 600,
                              background: m.role === 'admin' ? 'rgba(74,144,226,0.15)' :
                                m.role === 'moderator' ? 'rgba(155,89,182,0.15)' :
                                m.role === 'guest' ? 'rgba(149,165,166,0.15)' :
                                'rgba(127,140,141,0.1)',
                              color: m.role === 'admin' ? 'var(--color-primary, #4A90E2)' :
                                m.role === 'moderator' ? '#9b59b6' :
                                m.role === 'guest' ? '#95a5a6' :
                                'var(--text-secondary)',
                            }}>
                              {m.role}
                            </span>
                            <span style={{
                              fontSize: 9, padding: '1px 5px', borderRadius: 3, fontWeight: 600,
                              background: m.status === 'active' ? 'rgba(80,227,194,0.15)' :
                                m.status === 'inactive' ? 'rgba(241,196,15,0.15)' :
                                'rgba(231,76,60,0.15)',
                              color: m.status === 'active' ? 'var(--color-success, #50E3C2)' :
                                m.status === 'inactive' ? '#f1c40f' :
                                '#e74c3c',
                            }}>
                              {m.status}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
