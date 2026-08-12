/**
 * Phase 7 批次4 任务7.1：收藏管理 Tab（spec 6.2.1 节）
 *
 * 功能：
 * - 显示所有收藏组件列表（从 useAppStore.favorites 读取）
 * - 支持排序（手动拖拽 / 按名称 / 按创建时间 / 按最后使用时间）
 *   - pill 形状按钮组切换排序模式
 *   - 手动排序时支持 HTML5 拖拽重排
 * - 支持分组（左侧 sidebar：全部分组 / 未分组 / 自定义分组）
 *   - 新建/重命名/删除分组（删除时选择迁移目标）
 *   - 拖拽收藏到分组
 * - 搜索框过滤（pill 形状）
 * - 每个收藏项显示：图标 + 名称 + 所属分组 + 操作按钮（删除/移动到分组）
 * - 导出收藏列表为 JSON
 *
 * 调用 useAppStore 的 actions（不修改 store，只读 + 调用）。
 */
import { useState, useMemo, useEffect, useRef } from 'react'
import { useAppStore } from '../../stores/useAppStore'
import { useToastStore } from '../../stores/useToastStore'
import { getWidgetConfig } from '../../registry'
import type { FavoriteEntry, FavoriteGroup } from '../../types'
import {
  Search,
  Plus,
  Trash2,
  FolderInput,
  Pencil,
  Check,
  X,
  Star,
  Download,
  FolderPlus,
  Layers,
} from 'lucide-react'

type SortBy = 'manual' | 'name' | 'createdAt' | 'lastUsedAt'

/** 分组视图过滤模式：'all' 显示全部，'ungrouped' 显示未分组，其他为 groupId */
type GroupFilter = 'all' | 'ungrouped' | string

export default function FavoritesManager() {
  // 订阅 store
  const favorites = useAppStore(s => s.favorites)
  const favoriteGroups = useAppStore(s => s.favoriteGroups)
  const sortBy = useAppStore(s => s.favoriteSortBy)
  const searchQuery = useAppStore(s => s.favoriteSearchQuery)
  const setFavoriteSortBy = useAppStore(s => s.setFavoriteSortBy)
  const setFavoriteSearchQuery = useAppStore(s => s.setFavoriteSearchQuery)
  const refreshFavorites = useAppStore(s => s.refreshFavorites)
  const refreshFavoriteGroups = useAppStore(s => s.refreshFavoriteGroups)
  const createFavoriteGroup = useAppStore(s => s.createFavoriteGroup)
  const updateFavoriteGroup = useAppStore(s => s.updateFavoriteGroup)
  const deleteFavoriteGroup = useAppStore(s => s.deleteFavoriteGroup)
  const updateFavoriteSort = useAppStore(s => s.updateFavoriteSort)
  const updateFavoriteGroupAssignment = useAppStore(s => s.updateFavoriteGroupAssignment)
  const removeFavorite = useAppStore(s => s.removeFavorite)
  const showToast = useToastStore(s => s.showToast)

  // 本地状态
  const [groupFilter, setGroupFilter] = useState<GroupFilter>('all')
  const [localSearch, setLocalSearch] = useState(searchQuery)
  const [creatingGroup, setCreatingGroup] = useState(false)
  const [newGroupName, setNewGroupName] = useState('')
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null)
  const [editingGroupName, setEditingGroupName] = useState('')
  const [deletingGroup, setDeletingGroup] = useState<FavoriteGroup | null>(null)
  const [migrateTarget, setMigrateTarget] = useState<string>('')
  const [movingFavorite, setMovingFavorite] = useState<FavoriteEntry | null>(null)
  const [draggedFavoriteId, setDraggedFavoriteId] = useState<string | null>(null)
  const [dragOverGroupId, setDragOverGroupId] = useState<string | null>(null)

  // 同步搜索词到 store（防抖由 zustand 自动处理，这里立即同步）
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current)
    searchTimerRef.current = setTimeout(() => {
      setFavoriteSearchQuery(localSearch)
    }, 200)
    return () => {
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current)
    }
  }, [localSearch, setFavoriteSearchQuery])

  // 进入时刷新一次
  useEffect(() => {
    void refreshFavorites()
    void refreshFavoriteGroups()
  }, [refreshFavorites, refreshFavoriteGroups])

  // 计算过滤后的收藏列表
  const filteredFavorites = useMemo(() => {
    const kw = searchQuery.trim().toLowerCase()
    let list = favorites.slice()
    // 分组过滤
    if (groupFilter === 'ungrouped') {
      list = list.filter(f => f.groupId === undefined)
    } else if (groupFilter !== 'all') {
      list = list.filter(f => f.groupId === groupFilter)
    }
    // 搜索过滤
    if (kw) {
      list = list.filter(f =>
        f.displayName.toLowerCase().includes(kw) ||
        (f.groupName?.toLowerCase().includes(kw) ?? false) ||
        f.widgetType.toLowerCase().includes(kw)
      )
    }
    // 排序
    switch (sortBy) {
      case 'manual':
        list.sort((a, b) => (a.sortIndex ?? 0) - (b.sortIndex ?? 0))
        break
      case 'name':
        list.sort((a, b) => a.displayName.localeCompare(b.displayName, 'zh-CN'))
        break
      case 'createdAt':
        list.sort((a, b) => a.createdAt - b.createdAt)
        break
      case 'lastUsedAt':
        list.sort((a, b) => (b.lastUsedAt ?? b.createdAt) - (a.lastUsedAt ?? a.createdAt))
        break
    }
    return list
  }, [favorites, groupFilter, searchQuery, sortBy])

  // 分组计数（用于左侧 sidebar 显示数字）
  const groupCounts = useMemo(() => {
    const counts: Record<string, number> = { all: favorites.length, ungrouped: 0 }
    for (const g of favoriteGroups) counts[g.id] = 0
    for (const f of favorites) {
      if (f.groupId && counts[f.groupId] !== undefined) {
        counts[f.groupId]++
      } else if (f.groupId === undefined) {
        counts.ungrouped++
      }
    }
    return counts
  }, [favorites, favoriteGroups])

  // 新建分组
  const handleCreateGroup = async () => {
    const name = newGroupName.trim()
    if (!name) return
    const created = await createFavoriteGroup(name)
    if (created) {
      showToast({ type: 'success', message: `已创建分组 "${name}"`, duration: 2000 })
      setNewGroupName('')
      setCreatingGroup(false)
    } else {
      showToast({ type: 'error', message: '创建分组失败', duration: 3000 })
    }
  }

  // 重命名分组
  const handleRenameGroup = async (groupId: string) => {
    const name = editingGroupName.trim()
    if (!name) return
    await updateFavoriteGroup(groupId, { name })
    showToast({ type: 'success', message: '分组已重命名', duration: 2000 })
    setEditingGroupId(null)
    setEditingGroupName('')
  }

  // 删除分组（带迁移目标）
  const handleDeleteGroup = async () => {
    if (!deletingGroup) return
    const target = migrateTarget || undefined
    await deleteFavoriteGroup(deletingGroup.id, target)
    showToast({
      type: 'success',
      message: target
        ? `已删除分组，收藏已迁移`
        : `已删除分组，组内收藏变为未分组`,
      duration: 2000,
    })
    setDeletingGroup(null)
    setMigrateTarget('')
    if (groupFilter === deletingGroup.id) setGroupFilter('all')
  }

  // 删除收藏
  const handleDeleteFavorite = async (fav: FavoriteEntry) => {
    if (!window.confirm(`确定要删除收藏 "${fav.displayName}" 吗？`)) return
    await removeFavorite(fav.id)
    showToast({ type: 'success', message: '已删除收藏', duration: 2000 })
  }

  // 移动到分组
  const handleMoveToGroup = async (fav: FavoriteEntry, groupId: string | undefined) => {
    const groupName = groupId
      ? favoriteGroups.find(g => g.id === groupId)?.name
      : undefined
    await updateFavoriteGroupAssignment(fav.id, groupId, groupName)
    showToast({ type: 'success', message: '已移动到分组', duration: 2000 })
    setMovingFavorite(null)
  }

  // 拖拽重排（仅在 manual 排序 + 全部分组视图下生效）
  const handleDragStart = (e: React.DragEvent, favId: string) => {
    if (sortBy !== 'manual' || groupFilter !== 'all') return
    setDraggedFavoriteId(favId)
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', favId)
  }
  const handleDragOver = (e: React.DragEvent, overFavId: string) => {
    if (!draggedFavoriteId || draggedFavoriteId === overFavId) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
  }
  const handleDrop = (e: React.DragEvent, overFavId: string) => {
    e.preventDefault()
    if (!draggedFavoriteId || draggedFavoriteId === overFavId) {
      setDraggedFavoriteId(null)
      return
    }
    // 交换 sortIndex（乐观更新，store action 处理持久化）
    const over = favorites.find(f => f.id === overFavId)
    const drag = favorites.find(f => f.id === draggedFavoriteId)
    if (over && drag) {
      const dragIdx = drag.sortIndex ?? 0
      const overIdx = over.sortIndex ?? 0
      void updateFavoriteSort(drag.id, overIdx)
      void updateFavoriteSort(over.id, dragIdx)
    }
    setDraggedFavoriteId(null)
  }

  // 拖到分组（移动到该分组）
  const handleDropOnGroup = (e: React.DragEvent, groupId: string | undefined) => {
    e.preventDefault()
    const favId = e.dataTransfer.getData('text/plain')
    if (!favId) return
    const fav = favorites.find(f => f.id === favId)
    if (fav) {
      void handleMoveToGroup(fav, groupId)
    }
    setDragOverGroupId(null)
  }

  // 导出收藏列表 JSON
  const handleExport = () => {
    try {
      const blob = new Blob([JSON.stringify(favorites, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `favorites-${new Date().toISOString().slice(0, 10)}.json`
      a.click()
      URL.revokeObjectURL(url)
      showToast({ type: 'success', message: '已导出收藏列表', duration: 2000 })
    } catch (err) {
      showToast({
        type: 'error',
        message: `导出失败: ${err instanceof Error ? err.message : String(err)}`,
        duration: 3000,
      })
    }
  }

  const sortOptions: { value: SortBy; label: string }[] = [
    { value: 'manual', label: '手动' },
    { value: 'name', label: '名称' },
    { value: 'createdAt', label: '创建时间' },
    { value: 'lastUsedAt', label: '最近使用' },
  ]

  return (
    <section className="settings-section">
      <h3 className="settings-section-title">收藏管理</h3>

      <div className="fm-container">
        {/* 左侧分组 sidebar */}
        <aside className="fm-groups-sidebar">
          <div
            className={`fm-group-item${groupFilter === 'all' ? ' active' : ''}`}
            onClick={() => setGroupFilter('all')}
          >
            <Layers size={14} />
            <span className="fm-group-name">全部分组</span>
            <span className="fm-group-count">{groupCounts.all ?? 0}</span>
          </div>
          <div
            className={`fm-group-item${groupFilter === 'ungrouped' ? ' active' : ''}`}
            onClick={() => setGroupFilter('ungrouped')}
            onDragOver={(e) => { e.preventDefault(); setDragOverGroupId('ungrouped') }}
            onDragLeave={() => setDragOverGroupId(null)}
            onDrop={(e) => handleDropOnGroup(e, undefined)}
            data-drag-over={dragOverGroupId === 'ungrouped'}
          >
            <Star size={14} />
            <span className="fm-group-name">未分组</span>
            <span className="fm-group-count">{groupCounts.ungrouped ?? 0}</span>
          </div>

          <div className="fm-groups-divider" />

          {favoriteGroups.map(g => (
            <div key={g.id}>
              <div
                className={`fm-group-item${groupFilter === g.id ? ' active' : ''}`}
                onClick={() => setGroupFilter(g.id)}
                onDragOver={(e) => { e.preventDefault(); setDragOverGroupId(g.id) }}
                onDragLeave={() => setDragOverGroupId(null)}
                onDrop={(e) => handleDropOnGroup(e, g.id)}
                data-drag-over={dragOverGroupId === g.id}
              >
                {editingGroupId === g.id ? (
                  <>
                    <input
                      className="fm-group-rename-input"
                      value={editingGroupName}
                      autoFocus
                      onChange={e => setEditingGroupName(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter') handleRenameGroup(g.id)
                        if (e.key === 'Escape') { setEditingGroupId(null); setEditingGroupName('') }
                      }}
                    />
                    <button className="fm-icon-btn" onClick={() => handleRenameGroup(g.id)}><Check size={12} /></button>
                    <button className="fm-icon-btn" onClick={() => { setEditingGroupId(null); setEditingGroupName('') }}><X size={12} /></button>
                  </>
                ) : (
                  <>
                    <span className="fm-group-color-dot" style={{ background: g.color ?? 'var(--color-primary)' }} />
                    <span
                      className="fm-group-name"
                      onDoubleClick={() => {
                        setEditingGroupId(g.id)
                        setEditingGroupName(g.name)
                      }}
                    >
                      {g.name}
                    </span>
                    <span className="fm-group-count">{groupCounts[g.id] ?? 0}</span>
                    <button
                      className="fm-icon-btn"
                      title="重命名"
                      onClick={(e) => {
                        e.stopPropagation()
                        setEditingGroupId(g.id)
                        setEditingGroupName(g.name)
                      }}
                    >
                      <Pencil size={11} />
                    </button>
                    <button
                      className="fm-icon-btn danger"
                      title="删除"
                      onClick={(e) => {
                        e.stopPropagation()
                        setDeletingGroup(g)
                        setMigrateTarget('')
                      }}
                    >
                      <Trash2 size={11} />
                    </button>
                  </>
                )}
              </div>
            </div>
          ))}

          {creatingGroup ? (
            <div className="fm-group-item creating">
              <FolderPlus size={14} />
              <input
                className="fm-group-rename-input"
                value={newGroupName}
                autoFocus
                placeholder="分组名称"
                onChange={e => setNewGroupName(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') handleCreateGroup()
                  if (e.key === 'Escape') { setCreatingGroup(false); setNewGroupName('') }
                }}
              />
              <button className="fm-icon-btn" onClick={handleCreateGroup}><Check size={12} /></button>
              <button className="fm-icon-btn" onClick={() => { setCreatingGroup(false); setNewGroupName('') }}><X size={12} /></button>
            </div>
          ) : (
            <button className="fm-new-group-btn" onClick={() => setCreatingGroup(true)}>
              <Plus size={12} />
              新建分组
            </button>
          )}
        </aside>

        {/* 右侧收藏列表 */}
        <div className="fm-list-area">
          {/* 顶部工具栏：搜索 + 排序 + 导出 */}
          <div className="fm-toolbar">
            <div className="fm-search-wrap">
              <Search size={14} />
              <input
                className="fm-search-input"
                placeholder="搜索收藏..."
                value={localSearch}
                onChange={e => setLocalSearch(e.target.value)}
              />
            </div>
            <div className="fm-sort-group">
              {sortOptions.map(opt => (
                <button
                  key={opt.value}
                  className={`fm-sort-pill${sortBy === opt.value ? ' active' : ''}`}
                  onClick={() => setFavoriteSortBy(opt.value)}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            <button className="fm-export-btn" onClick={handleExport} title="导出收藏列表">
              <Download size={14} />
            </button>
          </div>

          {/* 列表 */}
          <div className="fm-list">
            {filteredFavorites.length === 0 ? (
              <div className="fm-empty">
                {searchQuery ? '没有匹配的收藏' : '暂无收藏组件，在画布中右键组件选择"收藏"'}
              </div>
            ) : (
              filteredFavorites.map(fav => {
                const config = getWidgetConfig(fav.widgetType)
                const group = fav.groupId
                  ? favoriteGroups.find(g => g.id === fav.groupId)
                  : undefined
                return (
                  <div
                    key={fav.id}
                    className="fm-fav-item"
                    draggable={sortBy === 'manual' && groupFilter === 'all'}
                    onDragStart={(e) => handleDragStart(e, fav.id)}
                    onDragOver={(e) => handleDragOver(e, fav.id)}
                    onDrop={(e) => handleDrop(e, fav.id)}
                    onDragEnd={() => setDraggedFavoriteId(null)}
                    data-dragging={draggedFavoriteId === fav.id}
                  >
                    <div className="fm-fav-icon">
                      {config?.icon ?? <Star size={16} />}
                    </div>
                    <div className="fm-fav-info">
                      <div className="fm-fav-name">{fav.displayName}</div>
                      <div className="fm-fav-meta">
                        <span>{config?.displayName ?? fav.widgetType}</span>
                        {group && (
                          <>
                            <span className="fm-fav-dot">·</span>
                            <span className="fm-fav-group-tag" style={{ color: group.color ?? 'var(--color-primary)' }}>
                              {group.name}
                            </span>
                          </>
                        )}
                        <span className="fm-fav-dot">·</span>
                        <span>{new Date(fav.createdAt).toLocaleDateString()}</span>
                      </div>
                    </div>
                    <div className="fm-fav-actions">
                      <button
                        className="fm-icon-btn"
                        title="移动到分组"
                        onClick={() => setMovingFavorite(fav)}
                      >
                        <FolderInput size={13} />
                      </button>
                      <button
                        className="fm-icon-btn danger"
                        title="删除"
                        onClick={() => handleDeleteFavorite(fav)}
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>
                )
              })
            )}
          </div>
        </div>
      </div>

      {/* 删除分组对话框 */}
      {deletingGroup && (
        <div className="fm-modal-overlay" onClick={() => setDeletingGroup(null)}>
          <div className="fm-modal" onClick={e => e.stopPropagation()}>
            <h4>删除分组 "{deletingGroup.name}"</h4>
            <p className="fm-modal-desc">
              该分组下有 {groupCounts[deletingGroup.id] ?? 0} 个收藏。选择迁移目标，或不迁移（变为未分组）。
            </p>
            <select
              className="select-field"
              value={migrateTarget}
              onChange={e => setMigrateTarget(e.target.value)}
            >
              <option value="">不迁移（变为未分组）</option>
              {favoriteGroups
                .filter(g => g.id !== deletingGroup.id)
                .map(g => (
                  <option key={g.id} value={g.id}>迁移到 "{g.name}"</option>
                ))}
            </select>
            <div className="fm-modal-actions">
              <button className="toolbar-btn" onClick={() => setDeletingGroup(null)}>取消</button>
              <button className="toolbar-btn primary" onClick={handleDeleteGroup}>确认删除</button>
            </div>
          </div>
        </div>
      )}

      {/* 移动到分组对话框 */}
      {movingFavorite && (
        <div className="fm-modal-overlay" onClick={() => setMovingFavorite(null)}>
          <div className="fm-modal" onClick={e => e.stopPropagation()}>
            <h4>移动 "{movingFavorite.displayName}" 到分组</h4>
            <div className="fm-move-list">
              <button
                className="fm-move-item"
                onClick={() => handleMoveToGroup(movingFavorite, undefined)}
              >
                <Star size={14} />
                未分组
              </button>
              {favoriteGroups.map(g => (
                <button
                  key={g.id}
                  className={`fm-move-item${movingFavorite.groupId === g.id ? ' current' : ''}`}
                  onClick={() => handleMoveToGroup(movingFavorite, g.id)}
                >
                  <span className="fm-group-color-dot" style={{ background: g.color ?? 'var(--color-primary)' }} />
                  {g.name}
                  {movingFavorite.groupId === g.id && <span className="fm-current-tag">当前</span>}
                </button>
              ))}
              {favoriteGroups.length === 0 && (
                <div className="fm-empty">还没有分组，请先在左侧新建</div>
              )}
            </div>
            <div className="fm-modal-actions">
              <button className="toolbar-btn" onClick={() => setMovingFavorite(null)}>关闭</button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
