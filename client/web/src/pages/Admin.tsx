// ============================================================================
// Phase 4：管理员后台 - 用户管理
// ============================================================================
// 功能：列出所有用户、封禁/解封、修改角色
// 路由：/admin（仅 admin 可访问，App.tsx 中用 AuthGuard 包裹）
// Phase 6 T12：新增"全局组件"tab，管理员可设置 custom_widgets 的 is_global 标志（spec §10.3）
// ============================================================================

import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Shield, Ban, CheckCircle, ArrowLeft, Globe, Cpu, Search } from 'lucide-react'
import { useUserStore } from '../stores/useUserStore'
import * as authApi from '../api/auth'
import type { UserInfo, UserRole } from '../api/auth'
import * as widgetsApi from '../api/widgets'
import type { CustomWidgetDTO } from '../api/widgets'
import * as adminApi from '../api/admin'
import type { AiProvider, SearchEngine } from '../api/admin'

type AdminTab = 'users' | 'globalWidgets' | 'aiConfig' | 'toolsConfig'

export default function Admin() {
  const navigate = useNavigate()
  const currentUser = useUserStore(s => s.user)
  const fetchCurrentUser = useUserStore(s => s.fetchCurrentUser)
  const [tab, setTab] = useState<AdminTab>('users')

  // 用户管理状态
  const [users, setUsers] = useState<UserInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [actionLoading, setActionLoading] = useState<string | null>(null)

  // 全局组件管理状态
  const [customWidgets, setCustomWidgets] = useState<CustomWidgetDTO[]>([])
  const [widgetsLoading, setWidgetsLoading] = useState(false)
  const [widgetsError, setWidgetsError] = useState('')

  // AI 配置管理状态
  const [providers, setProviders] = useState<AiProvider[]>([])
  const [providersLoading, setProvidersLoading] = useState(false)
  const [providersError, setProvidersError] = useState('')

  // 工具权限状态
  const [toolPerms, setToolPerms] = useState<Record<string, boolean>>({})
  const [toolPermsLoading, setToolPermsLoading] = useState(false)
  const [toolPermsError, setToolPermsError] = useState('')

  // 搜索引擎状态
  const [engines, setEngines] = useState<SearchEngine[]>([])
  const [enginesLoading, setEnginesLoading] = useState(false)
  const [enginesError, setEnginesError] = useState('')

  async function loadUsers() {
    setLoading(true)
    setError('')
    try {
      const list = await authApi.adminListUsers()
      setUsers(list)
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载用户列表失败')
    } finally {
      setLoading(false)
    }
  }

  async function loadCustomWidgets() {
    setWidgetsLoading(true)
    setWidgetsError('')
    try {
      const list = await widgetsApi.adminGetAllCustomWidgets()
      setCustomWidgets(list)
    } catch (err) {
      setWidgetsError(err instanceof Error ? err.message : '加载组件列表失败')
    } finally {
      setWidgetsLoading(false)
    }
  }

  async function loadProviders() {
    setProvidersLoading(true)
    setProvidersError('')
    try {
      const list = await adminApi.adminListAiProviders()
      setProviders(list)
    } catch (err) {
      setProvidersError(err instanceof Error ? err.message : '加载 AI 配置失败')
    } finally {
      setProvidersLoading(false)
    }
  }

  async function loadToolPerms() {
    setToolPermsLoading(true)
    setToolPermsError('')
    try {
      const tools = await adminApi.adminGetToolPermissions()
      setToolPerms(tools)
    } catch (err) {
      setToolPermsError(err instanceof Error ? err.message : '加载工具权限失败')
    } finally {
      setToolPermsLoading(false)
    }
  }

  async function loadEngines() {
    setEnginesLoading(true)
    setEnginesError('')
    try {
      const list = await adminApi.adminListSearchEngines()
      setEngines(list)
    } catch (err) {
      setEnginesError(err instanceof Error ? err.message : '加载搜索引擎配置失败')
    } finally {
      setEnginesLoading(false)
    }
  }

  useEffect(() => {
    void loadUsers()
  }, [])

  useEffect(() => {
    if (tab === 'globalWidgets' && customWidgets.length === 0 && !widgetsLoading) {
      void loadCustomWidgets()
    }
  }, [tab, customWidgets.length, widgetsLoading])

  useEffect(() => {
    if (tab === 'aiConfig' && providers.length === 0 && !providersLoading) {
      void loadProviders()
    }
    if (tab === 'aiConfig' && Object.keys(toolPerms).length === 0 && !toolPermsLoading) {
      void loadToolPerms()
    }
  }, [tab, providers.length, providersLoading, toolPerms, toolPermsLoading])

  useEffect(() => {
    if (tab === 'toolsConfig' && engines.length === 0 && !enginesLoading) {
      void loadEngines()
    }
  }, [tab, engines.length, enginesLoading])

  async function handleBan(user: UserInfo, isBanned: boolean) {
    if (user.id === currentUser?.id && isBanned) {
      if (!confirm('确认封禁自己？这可能导致你无法继续登录。')) return
    }
    setActionLoading(user.id)
    try {
      await authApi.adminBanUser(user.id, isBanned)
      await loadUsers()
    } catch (err) {
      setError(err instanceof Error ? err.message : '操作失败')
    } finally {
      setActionLoading(null)
    }
  }

  async function handleRoleChange(user: UserInfo, role: UserRole) {
    if (user.id === currentUser?.id && role !== 'admin') {
      if (!confirm('确认撤销自己的管理员权限？这将使你失去管理后台访问权。')) return
    }
    setActionLoading(user.id)
    try {
      await authApi.adminUpdateUserRole(user.id, role)
      await loadUsers()
      // 若修改了自己的角色，同步当前用户信息
      if (user.id === currentUser?.id) {
        await fetchCurrentUser()
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '操作失败')
    } finally {
      setActionLoading(null)
    }
  }

  async function handleToggleGlobal(widget: CustomWidgetDTO, nextGlobal: boolean) {
    setActionLoading(widget.id)
    try {
      const updated = await widgetsApi.setCustomWidgetGlobal(widget.id, nextGlobal)
      setCustomWidgets(prev => prev.map(w => w.id === updated.id ? updated : w))
    } catch (err) {
      setWidgetsError(err instanceof Error ? err.message : '操作失败')
    } finally {
      setActionLoading(null)
    }
  }

  return (
    <div className="settings-page">
      <header className="settings-page__header">
        <h1 className="settings-page__title">
          <Shield size={20} style={{ verticalAlign: 'middle', marginRight: 8 }} />
          管理员后台
        </h1>
        <button
          type="button"
          className="toolbar-btn"
          onClick={() => navigate('/')}
        >
          <ArrowLeft size={14} style={{ verticalAlign: 'middle', marginRight: 4 }} />
          返回画布
        </button>
      </header>

      <nav className="settings-nav">
        <button
          className={tab === 'users' ? 'active' : ''}
          onClick={() => setTab('users')}
        >
          用户管理
        </button>
        <button
          className={tab === 'globalWidgets' ? 'active' : ''}
          onClick={() => setTab('globalWidgets')}
        >
          全局组件
        </button>
        <button
          className={tab === 'aiConfig' ? 'active' : ''}
          onClick={() => setTab('aiConfig')}
        >
          AI 配置
        </button>
        <button
          className={tab === 'toolsConfig' ? 'active' : ''}
          onClick={() => setTab('toolsConfig')}
        >
          工具/搜索
        </button>
      </nav>

      <div className="settings-content">
        {tab === 'users' && (
          <UsersTab
            users={users}
            loading={loading}
            error={error}
            actionLoading={actionLoading}
            currentUser={currentUser}
            onBan={handleBan}
            onRoleChange={handleRoleChange}
          />
        )}
        {tab === 'globalWidgets' && (
          <GlobalWidgetsTab
            widgets={customWidgets}
            loading={widgetsLoading}
            error={widgetsError}
            actionLoading={actionLoading}
            onToggleGlobal={handleToggleGlobal}
            onRetry={loadCustomWidgets}
          />
        )}
        {tab === 'aiConfig' && (
          <AiConfigTab
            providers={providers}
            providersLoading={providersLoading}
            providersError={providersError}
            toolPerms={toolPerms}
            toolPermsLoading={toolPermsLoading}
            toolPermsError={toolPermsError}
            onReloadProviders={loadProviders}
            onReloadToolPerms={loadToolPerms}
          />
        )}
        {tab === 'toolsConfig' && (
          <ToolsConfigTab
            engines={engines}
            loading={enginesLoading}
            error={enginesError}
            onReload={loadEngines}
          />
        )}
      </div>
    </div>
  )
}

// ============================================================================
// 用户管理 Tab
// ============================================================================

interface UsersTabProps {
  users: UserInfo[]
  loading: boolean
  error: string
  actionLoading: string | null
  currentUser: UserInfo | null
  onBan: (user: UserInfo, isBanned: boolean) => void
  onRoleChange: (user: UserInfo, role: UserRole) => void
}

function UsersTab({ users, loading, error, actionLoading, currentUser, onBan, onRoleChange }: UsersTabProps) {
  return (
    <>
      {error && (
        <div style={{ padding: 12, marginBottom: 16, background: 'rgba(255,59,48,0.08)', border: '1px solid rgba(255,59,48,0.25)', borderRadius: 8, color: 'var(--color-error, #FF3B30)', fontSize: 13 }}>
          {error}
        </div>
      )}

      {loading ? (
        <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-secondary)' }}>
          加载中...
        </div>
      ) : users.length === 0 ? (
        <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-secondary)' }}>
          暂无用户
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: '2px solid var(--border-default)', textAlign: 'left' }}>
                <th style={{ padding: '8px 12px' }}>用户名</th>
                <th style={{ padding: '8px 12px' }}>邮箱</th>
                <th style={{ padding: '8px 12px' }}>角色</th>
                <th style={{ padding: '8px 12px' }}>状态</th>
                <th style={{ padding: '8px 12px' }}>注册时间</th>
                <th style={{ padding: '8px 12px' }}>最后登录</th>
                <th style={{ padding: '8px 12px' }}>操作</th>
              </tr>
            </thead>
            <tbody>
              {users.map(u => {
                const isSelf = u.id === currentUser?.id
                const isLoading = actionLoading === u.id
                return (
                  <tr key={u.id} style={{ borderBottom: '1px solid var(--border-default)' }}>
                    <td style={{ padding: '8px 12px', fontWeight: 500 }}>
                      {u.username}
                      {isSelf && <span style={{ marginLeft: 6, fontSize: 11, color: 'var(--text-tertiary)' }}>(你)</span>}
                    </td>
                    <td style={{ padding: '8px 12px', color: 'var(--text-secondary)' }}>{u.email}</td>
                    <td style={{ padding: '8px 12px' }}>
                      <select
                        value={u.role}
                        onChange={(e) => onRoleChange(u, e.target.value as UserRole)}
                        disabled={isLoading}
                        style={{
                          padding: '4px 8px', borderRadius: 4,
                          border: '1px solid var(--border-default)',
                          background: 'var(--bg-surface)',
                          fontSize: 12, fontFamily: 'inherit',
                        }}
                      >
                        <option value="member">member</option>
                        <option value="admin">admin</option>
                      </select>
                    </td>
                    <td style={{ padding: '8px 12px' }}>
                      {u.isBanned ? (
                        <span style={{ color: 'var(--color-error, #FF3B30)', fontSize: 12 }}>已封禁</span>
                      ) : (
                        <span style={{ color: 'var(--color-success, #34C759)', fontSize: 12 }}>正常</span>
                      )}
                    </td>
                    <td style={{ padding: '8px 12px', color: 'var(--text-tertiary)', fontSize: 12 }}>
                      {u.createdAt ? new Date(u.createdAt).toLocaleString('zh-CN') : '-'}
                    </td>
                    <td style={{ padding: '8px 12px', color: 'var(--text-tertiary)', fontSize: 12 }}>
                      {u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString('zh-CN') : '从未'}
                    </td>
                    <td style={{ padding: '8px 12px' }}>
                      {u.isBanned ? (
                        <button
                          onClick={() => onBan(u, false)}
                          disabled={isLoading}
                          title="解封用户"
                          style={{
                            padding: '4px 8px', borderRadius: 4, border: '1px solid var(--border-default)',
                            background: 'var(--bg-surface)', cursor: isLoading ? 'not-allowed' : 'pointer',
                            fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 4,
                          }}
                        >
                          <CheckCircle size={12} /> 解封
                        </button>
                      ) : (
                        <button
                          onClick={() => onBan(u, true)}
                          disabled={isLoading}
                          title="封禁用户"
                          style={{
                            padding: '4px 8px', borderRadius: 4, border: '1px solid rgba(255,59,48,0.3)',
                            background: 'rgba(255,59,48,0.05)', color: 'var(--color-error, #FF3B30)',
                            cursor: isLoading ? 'not-allowed' : 'pointer',
                            fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 4,
                          }}
                        >
                          <Ban size={12} /> 封禁
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <div style={{ marginTop: 16, fontSize: 12, color: 'var(--text-tertiary)' }}>
            共 {users.length} 个用户
          </div>
        </div>
      )}
    </>
  )
}

// ============================================================================
// 全局组件管理 Tab（Phase 6 T12，spec §10.3）
// 管理员可勾选 custom_widgets 的 is_global 标志，全局组件对所有用户可见
// ============================================================================

interface GlobalWidgetsTabProps {
  widgets: CustomWidgetDTO[]
  loading: boolean
  error: string
  actionLoading: string | null
  onToggleGlobal: (widget: CustomWidgetDTO, nextGlobal: boolean) => void
  onRetry: () => void
}

function GlobalWidgetsTab({ widgets, loading, error, actionLoading, onToggleGlobal, onRetry }: GlobalWidgetsTabProps) {
  return (
    <>
      <div style={{ marginBottom: 16, padding: 12, background: 'var(--bg-surface)', border: '1px solid var(--border-default)', borderRadius: 8, fontSize: 13, color: 'var(--text-secondary)' }}>
        <Globe size={14} style={{ verticalAlign: 'middle', marginRight: 6 }} />
        全局组件对所有用户可见（spec §10.3）。勾选「全局」列即可切换组件的全局可见性。
      </div>

      {error && (
        <div style={{ padding: 12, marginBottom: 16, background: 'rgba(255,59,48,0.08)', border: '1px solid rgba(255,59,48,0.25)', borderRadius: 8, color: 'var(--color-error, #FF3B30)', fontSize: 13 }}>
          {error}
          <button onClick={onRetry} style={{ marginLeft: 12, padding: '2px 8px', fontSize: 12, border: '1px solid var(--border-default)', borderRadius: 4, background: 'var(--bg-surface)', cursor: 'pointer' }}>
            重试
          </button>
        </div>
      )}

      {loading ? (
        <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-secondary)' }}>
          加载中...
        </div>
      ) : widgets.length === 0 ? (
        <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-secondary)' }}>
          暂无自定义组件
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: '2px solid var(--border-default)', textAlign: 'left' }}>
                <th style={{ padding: '8px 12px' }}>名称</th>
                <th style={{ padding: '8px 12px' }}>描述</th>
                <th style={{ padding: '8px 12px' }}>尺寸</th>
                <th style={{ padding: '8px 12px' }}>标签</th>
                <th style={{ padding: '8px 12px' }}>公开</th>
                <th style={{ padding: '8px 12px' }}>全局</th>
                <th style={{ padding: '8px 12px' }}>上传时间</th>
              </tr>
            </thead>
            <tbody>
              {widgets.map(w => {
                const isLoading = actionLoading === w.id
                return (
                  <tr key={w.id} style={{ borderBottom: '1px solid var(--border-default)' }}>
                    <td style={{ padding: '8px 12px', fontWeight: 500 }}>{w.name}</td>
                    <td style={{ padding: '8px 12px', color: 'var(--text-secondary)', maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {w.description || '-'}
                    </td>
                    <td style={{ padding: '8px 12px', color: 'var(--text-tertiary)', fontSize: 12 }}>
                      {w.width} × {w.height}
                    </td>
                    <td style={{ padding: '8px 12px', color: 'var(--text-tertiary)', fontSize: 12 }}>
                      {w.tags.length > 0 ? w.tags.join(', ') : '-'}
                    </td>
                    <td style={{ padding: '8px 12px' }}>
                      {w.isPublic ? (
                        <span style={{ color: 'var(--color-success, #34C759)', fontSize: 12 }}>公开</span>
                      ) : (
                        <span style={{ color: 'var(--text-tertiary)', fontSize: 12 }}>私有</span>
                      )}
                    </td>
                    <td style={{ padding: '8px 12px' }}>
                      <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, cursor: isLoading ? 'not-allowed' : 'pointer', fontSize: 12 }}>
                        <input
                          type="checkbox"
                          checked={w.isGlobal}
                          disabled={isLoading}
                          onChange={(e) => onToggleGlobal(w, e.target.checked)}
                          style={{ cursor: isLoading ? 'not-allowed' : 'pointer' }}
                        />
                        {w.isGlobal ? '全局' : '仅自己'}
                      </label>
                    </td>
                    <td style={{ padding: '8px 12px', color: 'var(--text-tertiary)', fontSize: 12 }}>
                      {w.createdAt ? new Date(w.createdAt).toLocaleString('zh-CN') : '-'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <div style={{ marginTop: 16, fontSize: 12, color: 'var(--text-tertiary)' }}>
            共 {widgets.length} 个自定义组件，其中 {widgets.filter(w => w.isGlobal).length} 个全局
          </div>
        </div>
      )}
    </>
  )
}

// ============================================================================
// AI 配置管理 Tab（spec §10.3）
// - Provider 列表（endpoint/model/api_key 脱敏/priority/enabled）
// - 新增/编辑/删除 Provider
// - 工具权限全局开关（7 个 PI 文件系统工具）
// ============================================================================

const PI_TOOLS = ['read', 'write', 'edit', 'bash', 'grep', 'find', 'ls'] as const
const PI_TOOL_LABELS: Record<string, string> = {
  read: '读取文件',
  write: '写入文件',
  edit: '编辑文件',
  bash: '执行命令',
  grep: '搜索文件内容',
  find: '查找文件',
  ls: '列出目录',
}

interface AiConfigTabProps {
  providers: AiProvider[]
  providersLoading: boolean
  providersError: string
  toolPerms: Record<string, boolean>
  toolPermsLoading: boolean
  toolPermsError: string
  onReloadProviders: () => void
  onReloadToolPerms: () => void
}

function AiConfigTab(props: AiConfigTabProps) {
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [formError, setFormError] = useState('')
  const [saving, setSaving] = useState(false)
  // 表单字段
  const [fName, setFName] = useState('')
  const [fEndpoint, setFEndpoint] = useState('')
  const [fModel, setFModel] = useState('')
  const [fApiKey, setFApiKey] = useState('')
  const [fPriority, setFPriority] = useState(0)
  const [fEnabled, setFEnabled] = useState(true)

  function resetForm() {
    setFName(''); setFEndpoint(''); setFModel(''); setFApiKey('')
    setFPriority(0); setFEnabled(true); setEditingId(null); setShowForm(false); setFormError('')
  }

  function startEdit(p: AiProvider) {
    setEditingId(p.id)
    setShowForm(true)
    setFName(p.providerName)
    setFEndpoint(p.endpoint)
    setFModel(p.model)
    setFApiKey('') // 编辑时不预填 api_key（脱敏），留空表示不改
    setFPriority(p.priority)
    setFEnabled(p.enabled)
    setFormError('')
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setFormError('')
    if (!fName || !fModel) {
      setFormError('providerName 和 model 为必填项')
      return
    }
    if (!editingId && !fApiKey) {
      setFormError('新增 provider 时 apiKey 为必填项')
      return
    }
    setSaving(true)
    try {
      if (editingId) {
        const body: Parameters<typeof adminApi.adminUpdateAiProvider>[1] = {
          providerName: fName,
          endpoint: fEndpoint || null,
          model: fModel,
          priority: fPriority,
          enabled: fEnabled,
        }
        if (fApiKey) body.apiKey = fApiKey
        await adminApi.adminUpdateAiProvider(editingId, body)
      } else {
        await adminApi.adminCreateAiProvider({
          providerName: fName,
          endpoint: fEndpoint || undefined,
          model: fModel,
          apiKey: fApiKey,
          priority: fPriority,
          enabled: fEnabled,
        })
      }
      resetForm()
      await props.onReloadProviders()
    } catch (err) {
      setFormError(err instanceof Error ? err.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(p: AiProvider) {
    if (!confirm(`确认删除 provider "${p.providerName}"？`)) return
    try {
      await adminApi.adminDeleteAiProvider(p.id)
      await props.onReloadProviders()
    } catch (err) {
      setFormError(err instanceof Error ? err.message : '删除失败')
    }
  }

  async function handleToolToggle(toolName: string, enabled: boolean) {
    try {
      await adminApi.adminUpdateToolPermission(toolName, enabled)
      props.onReloadToolPerms()
    } catch (err) {
      setFormError(err instanceof Error ? err.message : '更新工具权限失败')
    }
  }

  return (
    <>
      <div style={{ marginBottom: 16, padding: 12, background: 'var(--bg-surface)', border: '1px solid var(--border-default)', borderRadius: 8, fontSize: 13, color: 'var(--text-secondary)' }}>
        <Cpu size={14} style={{ verticalAlign: 'middle', marginRight: 6 }} />
        管理 AI Provider（spec §10.3）。priority 最高的 enabled provider 将作为默认模型，自动同步到 ai_settings 表。
      </div>

      {(props.providersError || formError) && (
        <div style={{ padding: 12, marginBottom: 16, background: 'rgba(255,59,48,0.08)', border: '1px solid rgba(255,59,48,0.25)', borderRadius: 8, color: 'var(--color-error, #FF3B30)', fontSize: 13 }}>
          {props.providersError || formError}
          {props.providersError && (
            <button onClick={props.onReloadProviders} style={{ marginLeft: 12, padding: '2px 8px', fontSize: 12, border: '1px solid var(--border-default)', borderRadius: 4, background: 'var(--bg-surface)', cursor: 'pointer' }}>
              重试
            </button>
          )}
        </div>
      )}

      {/* Provider 列表 */}
      {props.providersLoading ? (
        <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-secondary)' }}>加载中...</div>
      ) : (
        <div style={{ overflowX: 'auto', marginBottom: 24 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: '2px solid var(--border-default)', textAlign: 'left' }}>
                <th style={{ padding: '8px 12px' }}>Provider</th>
                <th style={{ padding: '8px 12px' }}>Endpoint</th>
                <th style={{ padding: '8px 12px' }}>Model</th>
                <th style={{ padding: '8px 12px' }}>API Key</th>
                <th style={{ padding: '8px 12px' }}>Priority</th>
                <th style={{ padding: '8px 12px' }}>启用</th>
                <th style={{ padding: '8px 12px' }}>操作</th>
              </tr>
            </thead>
            <tbody>
              {props.providers.length === 0 ? (
                <tr>
                  <td colSpan={7} style={{ padding: 24, textAlign: 'center', color: 'var(--text-secondary)' }}>
                    暂无 AI Provider，点击下方按钮新增
                  </td>
                </tr>
              ) : (
                props.providers.map(p => {
                  const enabledProviders = props.providers.filter(x => x.enabled)
                  const maxPriority = enabledProviders.length > 0 ? Math.max(...enabledProviders.map(x => x.priority)) : -Infinity
                  const isDefault = p.enabled && p.priority === maxPriority
                  return (
                    <tr key={p.id} style={{ borderBottom: '1px solid var(--border-default)' }}>
                      <td style={{ padding: '8px 12px', fontWeight: 500 }}>
                        {p.providerName}
                        {isDefault && (
                          <span style={{ marginLeft: 6, fontSize: 11, color: 'var(--color-success, #34C759)' }}>默认</span>
                        )}
                      </td>
                      <td style={{ padding: '8px 12px', color: 'var(--text-secondary)', fontSize: 12, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {p.endpoint || '-'}
                      </td>
                      <td style={{ padding: '8px 12px', color: 'var(--text-secondary)', fontSize: 12 }}>{p.model}</td>
                      <td style={{ padding: '8px 12px', fontSize: 12, fontFamily: 'monospace', color: 'var(--text-tertiary)' }}>{p.apiKeyMasked}</td>
                      <td style={{ padding: '8px 12px', fontSize: 12 }}>{p.priority}</td>
                      <td style={{ padding: '8px 12px' }}>
                        {p.enabled ? (
                          <span style={{ color: 'var(--color-success, #34C759)', fontSize: 12 }}>启用</span>
                        ) : (
                          <span style={{ color: 'var(--text-tertiary)', fontSize: 12 }}>禁用</span>
                        )}
                      </td>
                      <td style={{ padding: '8px 12px' }}>
                        <div style={{ display: 'flex', gap: 8 }}>
                          <button
                            onClick={() => startEdit(p)}
                            style={{ padding: '2px 8px', fontSize: 12, border: '1px solid var(--border-default)', borderRadius: 4, background: 'var(--bg-surface)', cursor: 'pointer' }}
                          >
                            编辑
                          </button>
                          <button
                            onClick={() => handleDelete(p)}
                            style={{ padding: '2px 8px', fontSize: 12, border: '1px solid rgba(255,59,48,0.3)', borderRadius: 4, background: 'rgba(255,59,48,0.05)', color: 'var(--color-error, #FF3B30)', cursor: 'pointer' }}
                          >
                            删除
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* 新增/编辑表单 */}
      {showForm ? (
        <form onSubmit={handleSubmit} style={{ marginBottom: 24, padding: 16, background: 'var(--bg-surface)', border: '1px solid var(--border-default)', borderRadius: 8 }}>
          <h3 style={{ margin: '0 0 12px', fontSize: 14, fontWeight: 600 }}>
            {editingId ? '编辑 Provider' : '新增 Provider'}
          </h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <label style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
              Provider 名称 *
              <input
                type="text" value={fName} onChange={e => setFName(e.target.value)} required
                placeholder="如 deepseek / stepfun / openai"
                style={{ display: 'block', width: '100%', marginTop: 4, padding: '6px 8px', border: '1px solid var(--border-default)', borderRadius: 4, background: 'var(--bg-elevated)', color: 'var(--text-primary)', fontSize: 13, fontFamily: 'inherit' }}
              />
            </label>
            <label style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
              Model *
              <input
                type="text" value={fModel} onChange={e => setFModel(e.target.value)} required
                placeholder="如 deepseek/deepseek-v4-flash"
                style={{ display: 'block', width: '100%', marginTop: 4, padding: '6px 8px', border: '1px solid var(--border-default)', borderRadius: 4, background: 'var(--bg-elevated)', color: 'var(--text-primary)', fontSize: 13, fontFamily: 'inherit' }}
              />
            </label>
            <label style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
              Endpoint
              <input
                type="text" value={fEndpoint} onChange={e => setFEndpoint(e.target.value)}
                placeholder="https://api.deepseek.com/v1"
                style={{ display: 'block', width: '100%', marginTop: 4, padding: '6px 8px', border: '1px solid var(--border-default)', borderRadius: 4, background: 'var(--bg-elevated)', color: 'var(--text-primary)', fontSize: 13, fontFamily: 'inherit' }}
              />
            </label>
            <label style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
              API Key {editingId ? '（留空不改）' : '*'}
              <input
                type="password" value={fApiKey} onChange={e => setFApiKey(e.target.value)}
                placeholder={editingId ? '留空则保持原 Key' : 'sk-...'}
                style={{ display: 'block', width: '100%', marginTop: 4, padding: '6px 8px', border: '1px solid var(--border-default)', borderRadius: 4, background: 'var(--bg-elevated)', color: 'var(--text-primary)', fontSize: 13, fontFamily: 'inherit' }}
              />
            </label>
            <label style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
              Priority（越大越优先）
              <input
                type="number" value={fPriority} onChange={e => setFPriority(Number(e.target.value))}
                style={{ display: 'block', width: '100%', marginTop: 4, padding: '6px 8px', border: '1px solid var(--border-default)', borderRadius: 4, background: 'var(--bg-elevated)', color: 'var(--text-primary)', fontSize: 13, fontFamily: 'inherit' }}
              />
            </label>
            <label style={{ fontSize: 12, color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: 6, paddingTop: 20 }}>
              <input type="checkbox" checked={fEnabled} onChange={e => setFEnabled(e.target.checked)} />
              启用
            </label>
          </div>
          <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
            <button type="submit" disabled={saving} style={{ padding: '6px 16px', fontSize: 13, border: 'none', borderRadius: 4, background: 'var(--color-accent, #007AFF)', color: '#fff', cursor: saving ? 'not-allowed' : 'pointer' }}>
              {saving ? '保存中...' : (editingId ? '保存' : '新增')}
            </button>
            <button type="button" onClick={resetForm} style={{ padding: '6px 16px', fontSize: 13, border: '1px solid var(--border-default)', borderRadius: 4, background: 'var(--bg-surface)', cursor: 'pointer' }}>
              取消
            </button>
          </div>
        </form>
      ) : (
        <button
          onClick={() => { resetForm(); setShowForm(true) }}
          style={{ marginBottom: 24, padding: '6px 16px', fontSize: 13, border: '1px solid var(--border-default)', borderRadius: 4, background: 'var(--bg-surface)', cursor: 'pointer' }}
        >
          + 新增 Provider
        </button>
      )}

      {/* 工具权限全局开关 */}
      <h3 style={{ margin: '0 0 12px', fontSize: 14, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
        <Shield size={14} />
        工具权限全局开关
      </h3>
      <div style={{ marginBottom: 8, fontSize: 12, color: 'var(--text-tertiary)' }}>
        PI 原生 7 个文件系统工具的全局默认值（用户级可覆盖）。默认全部关闭。
      </div>
      {props.toolPermsError && (
        <div style={{ padding: 12, marginBottom: 12, background: 'rgba(255,59,48,0.08)', border: '1px solid rgba(255,59,48,0.25)', borderRadius: 8, color: 'var(--color-error, #FF3B30)', fontSize: 13 }}>
          {props.toolPermsError}
        </div>
      )}
      {props.toolPermsLoading ? (
        <div style={{ padding: 16, textAlign: 'center', color: 'var(--text-secondary)', fontSize: 13 }}>加载中...</div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 8 }}>
          {PI_TOOLS.map(name => {
            const enabled = props.toolPerms[name] ?? false
            const isBash = name === 'bash'
            return (
              <div key={name} style={{ padding: '8px 12px', border: '1px solid var(--border-default)', borderRadius: 6, background: 'var(--bg-surface)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div>
                  <code style={{ fontFamily: 'monospace', fontSize: 12, fontWeight: 500 }}>{name}</code>
                  {isBash && (
                    <span style={{ marginLeft: 6, fontSize: 10, background: 'rgba(239,68,68,0.15)', color: 'rgb(239,68,68)', padding: '1px 4px', borderRadius: 3 }}>高风险</span>
                  )}
                  <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>{PI_TOOL_LABELS[name]}</div>
                </div>
                <label className="toggle-switch" style={{ cursor: 'pointer' }}>
                  <input
                    type="checkbox" checked={enabled}
                    onChange={e => handleToolToggle(name, e.target.checked)}
                  />
                  <span className="toggle-slider" />
                </label>
              </div>
            )
          })}
        </div>
      )}
    </>
  )
}

// ============================================================================
// 工具/搜索引擎配置 Tab（spec §10.3）
// - 4 个搜索引擎：local/web(metaso)/academic(arxiv)/github
// - 每个有 enabled 开关 + 参数配置（如 API key）
// ============================================================================

interface ToolsConfigTabProps {
  engines: SearchEngine[]
  loading: boolean
  error: string
  onReload: () => void
}

function ToolsConfigTab({ engines, loading, error, onReload }: ToolsConfigTabProps) {
  const [savingEngine, setSavingEngine] = useState<string | null>(null)
  const [localError, setLocalError] = useState('')
  // 本地编辑的 api_key 缓存
  const [keyInputs, setKeyInputs] = useState<Record<string, string>>({})

  /** 哪些引擎需要 API Key（2026-08-17：web 用 Exa） */
  function needsApiKey(name: string): boolean {
    return name === 'exa' || name === 'github'
  }

  async function handleToggleEngine(name: string, enabled: boolean) {
    setSavingEngine(name)
    setLocalError('')
    try {
      await adminApi.adminUpdateSearchEngine(name, { enabled })
      await onReload()
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : '更新失败')
    } finally {
      setSavingEngine(null)
    }
  }

  async function handleSaveKey(name: string) {
    const key = keyInputs[name]
    if (!key) return
    setSavingEngine(name)
    setLocalError('')
    try {
      await adminApi.adminUpdateSearchEngine(name, {
        config: { apiKey: key },
      })
      setKeyInputs(prev => { const n = { ...prev }; delete n[name]; return n })
      await onReload()
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : '保存 API Key 失败')
    } finally {
      setSavingEngine(null)
    }
  }

  return (
    <>
      <div style={{ marginBottom: 16, padding: 12, background: 'var(--bg-surface)', border: '1px solid var(--border-default)', borderRadius: 8, fontSize: 13, color: 'var(--text-secondary)' }}>
        <Search size={14} style={{ verticalAlign: 'middle', marginRight: 6 }} />
        搜索引擎配置（spec §10.3）。管理 4 个搜索工具的启用状态和 API Key。
      </div>

      {(error || localError) && (
        <div style={{ padding: 12, marginBottom: 16, background: 'rgba(255,59,48,0.08)', border: '1px solid rgba(255,59,48,0.25)', borderRadius: 8, color: 'var(--color-error, #FF3B30)', fontSize: 13 }}>
          {error || localError}
          {error && (
            <button onClick={onReload} style={{ marginLeft: 12, padding: '2px 8px', fontSize: 12, border: '1px solid var(--border-default)', borderRadius: 4, background: 'var(--bg-surface)', cursor: 'pointer' }}>
              重试
            </button>
          )}
        </div>
      )}

      {loading ? (
        <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-secondary)' }}>加载中...</div>
      ) : engines.length === 0 ? (
        <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-secondary)' }}>暂无搜索引擎配置</div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 12 }}>
          {engines.map(eng => {
            const config = eng.config || {}
            const hasKey = !!(config.apiKey as string)
            const isSaving = savingEngine === eng.name
            const keyInput = keyInputs[eng.name] || ''
            return (
              <div key={eng.name} style={{ padding: 16, border: '1px solid var(--border-default)', borderRadius: 8, background: 'var(--bg-surface)' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                  <div>
                    <span style={{ fontWeight: 600, fontSize: 14 }}>{eng.displayName}</span>
                    <code style={{ marginLeft: 8, fontSize: 11, color: 'var(--text-tertiary)' }}>{eng.name}</code>
                  </div>
                  <label className="toggle-switch" style={{ cursor: isSaving ? 'not-allowed' : 'pointer' }}>
                    <input
                      type="checkbox" checked={eng.enabled} disabled={isSaving}
                      onChange={e => handleToggleEngine(eng.name, e.target.checked)}
                    />
                    <span className="toggle-slider" />
                  </label>
                </div>

                {needsApiKey(eng.name) ? (
                  <div style={{ marginTop: 8 }}>
                    <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginBottom: 4 }}>
                      API Key 状态：{hasKey ? (
                        <span style={{ color: 'var(--color-success, #34C759)' }}>已配置</span>
                      ) : (
                        <span style={{ color: 'var(--color-error, #FF3B30)' }}>未配置</span>
                      )}
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <input
                        type="password"
                        value={keyInput}
                        onChange={e => setKeyInputs(prev => ({ ...prev, [eng.name]: e.target.value }))}
                        placeholder={hasKey ? '输入新 Key 替换' : '输入 API Key'}
                        style={{ flex: 1, padding: '6px 8px', border: '1px solid var(--border-default)', borderRadius: 4, background: 'var(--bg-elevated)', color: 'var(--text-primary)', fontSize: 12, fontFamily: 'inherit' }}
                      />
                      <button
                        onClick={() => handleSaveKey(eng.name)}
                        disabled={isSaving || !keyInput}
                        style={{ padding: '6px 12px', fontSize: 12, border: '1px solid var(--border-default)', borderRadius: 4, background: 'var(--bg-elevated)', cursor: isSaving || !keyInput ? 'not-allowed' : 'pointer' }}
                      >
                        保存
                      </button>
                    </div>
                  </div>
                ) : (
                  <div style={{ marginTop: 8, fontSize: 12, color: 'var(--text-tertiary)' }}>
                    {eng.name === 'local' && '检索本端已同步数据，无需 API Key'}
                    {eng.name === 'arxiv' && '检索 ArXiv 学术论文，无需 API Key（开放获取）'}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      <div style={{ marginTop: 16, padding: 12, background: 'var(--bg-surface)', border: '1px solid var(--border-default)', borderRadius: 8, fontSize: 12, color: 'var(--text-tertiary)' }}>
        exa 和 github 的 API Key 会同步到 ai_settings 表，供 piBridge 工具调用时读取。
        也可在「AI 配置」tab 的工具权限区域控制文件系统工具的默认开关。
      </div>
    </>
  )
}
