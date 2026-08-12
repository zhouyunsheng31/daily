import { api } from './client'

// ============================================================================
// Phase 6：联邦式社区 API client（spec §9 节）
// ============================================================================

/** 已添加的社区（DB 记录） */
export interface CommunityDTO {
  id: string
  name: string
  description: string | null
  apiUrl: string
  icon: string | null
  isOfficial: boolean
  addedBy: string | null
  createdAt: number
}

/** 官方社区清单条目（含 added 标记） */
export interface OfficialCommunityDTO {
  id: string
  name: string
  description: string
  apiUrl: string
  icon?: string
  /** 是否已被本实例添加 */
  added: boolean
  /** 是否为官方社区（默认 true） */
  isOfficial?: boolean
  /** 是否为内置社区（无需"添加"，可直接进入）。Phase 7 §14 */
  isBuiltin?: boolean
}

export async function getCommunities(): Promise<CommunityDTO[]> {
  const res = await api.get<{ communities: CommunityDTO[] }>('/communities')
  return res.communities
}

export async function getOfficialCommunities(): Promise<OfficialCommunityDTO[]> {
  const res = await api.get<{ communities: OfficialCommunityDTO[] }>('/communities/official')
  return res.communities
}

export async function addCommunity(data: {
  name: string
  apiUrl: string
  description?: string
  icon?: string
  isOfficial?: boolean
}): Promise<CommunityDTO> {
  return api.post<CommunityDTO>('/communities', data)
}

export async function deleteCommunity(id: string): Promise<void> {
  await api.delete(`/communities/${id}`)
}

// ============================================================================
// Phase 6.4：社区成员管理/筛选
// ============================================================================

export type MemberRole = 'admin' | 'moderator' | 'member' | 'guest'
export type MemberStatus = 'active' | 'inactive' | 'banned'

export interface CommunityMember {
  id: string
  username: string
  role: MemberRole
  status: MemberStatus
  joinedAt: number
  /** 是否为本实例已注册用户（true=本地，false=外部社区成员） */
  isLocal: boolean
}

export interface CommunityMembersResponse {
  community: { id: string; name: string; apiUrl: string }
  members: CommunityMember[]
  total: number
  /** MOCK 标注：当前为模拟数据（外部成员为 mock，本地 users 为真实数据） */
  isMock?: boolean
  /** MOCK 说明文案，前端用于显示"模拟数据"徽章 tooltip */
  mockNote?: string
}

export interface SyncMembersResponse extends CommunityMembersResponse {
  syncResult: {
    added: number
    updated: number
    removed: number
    syncedAt: number
    message: string
  }
}

export async function getCommunityMembers(id: string): Promise<CommunityMembersResponse> {
  return api.get<CommunityMembersResponse>(`/communities/${id}/members`)
}

export async function syncCommunityMembers(id: string): Promise<SyncMembersResponse> {
  return api.post<SyncMembersResponse>(`/communities/${id}/sync-members`, {})
}
