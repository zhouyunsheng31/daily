import { api } from './client'
import type { PositionSnapshot, FavoriteGroup } from '../types'

export interface FavoriteDTO {
  id: string
  widgetId: string
  panelId: string
  widgetType: string
  displayName: string
  positionSnapshot: PositionSnapshot
  stateSnapshot: Record<string, unknown>
  createdAt: number
  // Phase 7 批次3 任务4：排序/分组扩展字段（服务器未升级时为 undefined，向后兼容）
  sortIndex?: number
  groupId?: string
  groupName?: string
  lastUsedAt?: number
  updatedAt?: number
}

/** 收藏分组 DTO（与 FavoriteGroup 一致，独立定义以隔离传输层演进） */
export type FavoriteGroupDTO = FavoriteGroup

/** listFavorites 查询参数 */
export interface ListFavoritesOptions {
  sortBy?: 'manual' | 'name' | 'createdAt' | 'lastUsedAt'
  groupId?: string
  search?: string
}

export async function getAllFavorites(): Promise<FavoriteDTO[]> {
  return api.get('/favorites')
}

/**
 * Phase 7 批次3 任务4：按排序/分组/搜索条件拉取收藏列表。
 * 服务器未升级时（404/失败），调用方应降级到 getAllFavorites + 本地过滤。
 */
export async function listFavorites(opts?: ListFavoritesOptions): Promise<FavoriteDTO[]> {
  const params: Record<string, string> = {}
  if (opts?.sortBy) params.sortBy = opts.sortBy
  if (opts?.groupId !== undefined) params.groupId = opts.groupId
  if (opts?.search) params.search = opts.search
  return api.get('/favorites', params)
}

export async function createFavorite(data: Omit<FavoriteDTO, 'createdAt'>): Promise<FavoriteDTO> {
  return api.post('/favorites', data)
}

export async function deleteFavorite(id: string): Promise<void> {
  await api.delete(`/favorites/${id}`)
}

export async function deleteFavoriteByWidgetId(widgetId: string): Promise<void> {
  await api.delete(`/favorites/by-widget/${widgetId}`)
}

export async function deleteFavoritesByPanelId(panelId: string): Promise<void> {
  await api.delete(`/favorites/by-panel/${panelId}`)
}

/**
 * Phase 7 批次3 任务4：更新单条收藏的排序索引。
 * 服务器未升级时调用方应捕获错误并降级到本地 meta（localStorage）。
 */
export async function updateFavoriteSort(id: string, sortIndex: number): Promise<void> {
  await api.put(`/favorites/${id}/sort`, { sortIndex })
}

/**
 * Phase 7 批次3 任务4：更新单条收藏的分组归属。
 * 传入 undefined 表示取消分组。
 */
export async function updateFavoriteGroup(
  id: string,
  groupId: string | undefined,
  groupName?: string,
): Promise<void> {
  await api.put(`/favorites/${id}/group`, { groupId: groupId ?? null, groupName: groupName ?? null })
}

/**
 * Phase 7 批次3 任务4：批量重排收藏（拖拽场景）。
 * 服务器未升级时调用方应捕获错误并降级到本地 meta（localStorage）。
 *
 * 注：spec 5.1.2 原文使用 orderIndex 字段，但项目历史代码已统一用 sortIndex
 * （types.FavoriteEntry.sortIndex / api.updateFavoriteSort），此处沿用现有命名以保持一致。
 */
export async function reorderFavorites(items: { id: string; sortIndex: number }[]): Promise<void> {
  await api.put('/favorites/reorder', { items })
}

/**
 * Phase 7 批次3 任务4：按 groupName 设置收藏分组（spec 5.1.2 中 groupFavorite）。
 * - groupName 传 null 表示取消分组
 * - 服务器未升级时调用方应捕获错误并降级到本地 meta
 *
 * 注：与 updateFavoriteGroup(id, groupId, groupName) 不同——本接口面向"自定义分组"场景，
 * 仅按 groupName 字符串分组（无独立 groupId），与 spec 5.1.3 中"自定义：用户拖拽到自定义分组"对应。
 */
export async function groupFavorite(id: string, groupName: string | null): Promise<void> {
  await api.put(`/favorites/${id}/group`, { groupName })
}

/**
 * Phase 7 批次3 任务4：更新 lastUsedAt（"最近使用"排序依赖）。
 * 服务器未升级时调用方应捕获错误并降级到本地 meta。
 */
export async function touchFavorite(id: string): Promise<void> {
  await api.post(`/favorites/${id}/touch`, {})
}

/** Phase 7 批次3 任务4：拉取所有收藏分组 */
export async function listGroups(): Promise<FavoriteGroupDTO[]> {
  return api.get('/favorite-groups')
}

/** Phase 7 批次3 任务4：创建收藏分组 */
export async function createGroup(name: string, color?: string): Promise<FavoriteGroupDTO> {
  return api.post('/favorite-groups', { name, color: color ?? null })
}

/** Phase 7 批次3 任务4：更新收藏分组（仅 name/color/sortIndex） */
export async function updateGroup(
  id: string,
  patch: Partial<Pick<FavoriteGroup, 'name' | 'color' | 'sortIndex'>>,
): Promise<void> {
  await api.put(`/favorite-groups/${id}`, patch as Record<string, unknown>)
}

/**
 * Phase 7 批次3 任务4：删除收藏分组。
 * @param migrateTo 可选，删除分组时将该组下收藏迁移到目标 groupId；不传则置为未分组
 */
export async function deleteGroup(id: string, migrateTo?: string): Promise<void> {
  await api.delete(`/favorite-groups/${id}`, migrateTo !== undefined ? { migrateTo } : undefined)
}
