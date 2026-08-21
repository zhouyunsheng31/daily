import { api } from './client'

// ============================================================================
// Phase 12: 搜索引擎 Key 管理 API client（spec 3.14 节）
// 5 个端点，全部走 Authorization: Bearer（由 api.getAuthHeaders() 自动注入）
// ============================================================================

export type SearchKeyProvider = 'exa' | 'github'

export interface SearchKeyStatus {
  provider: SearchKeyProvider
  hasKey: boolean
  updatedAt: number | null
}

export interface SearchKeyListResponse {
  providers: SearchKeyStatus[]
}

export interface SearchKeyTestResult {
  ok: boolean
  latencyMs?: number
  error?: string
}

export async function listSearchKeys(): Promise<SearchKeyListResponse> {
  return api.get<SearchKeyListResponse>('/search/keys')
}

export async function getSearchKey(provider: SearchKeyProvider): Promise<SearchKeyStatus> {
  return api.get<SearchKeyStatus>(`/search/keys/${provider}`)
}

export async function updateSearchKey(
  provider: SearchKeyProvider,
  key: string,
): Promise<{ ok: true; provider: string; updatedAt: number }> {
  return api.put(`/search/keys/${provider}`, { key })
}

export async function deleteSearchKey(
  provider: SearchKeyProvider,
): Promise<{ ok: true; provider: string }> {
  return api.delete<{ ok: true; provider: string }>(`/search/keys/${provider}`)
}

export async function testSearchKey(
  provider: SearchKeyProvider,
  key?: string,
): Promise<SearchKeyTestResult> {
  return api.post<SearchKeyTestResult>(`/search/keys/${provider}/test`, key ? { key } : {})
}
