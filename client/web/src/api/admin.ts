// ============================================================================
// Phase 4 Admin：AI 配置 / 工具权限 / 搜索引擎 API 客户端（spec §10.3）
// 所有端点均需 admin 权限，由后端 requireAdmin 中间件保护
// ============================================================================

import { api } from './client'

// ----------------------------------------------------------------------------
// AI Provider 管理
// ----------------------------------------------------------------------------

export interface AiProvider {
  id: string
  providerName: string
  endpoint: string
  model: string
  apiKeyMasked: string
  priority: number
  enabled: boolean
  createdAt: number
  updatedAt: number
}

export async function adminListAiProviders(): Promise<AiProvider[]> {
  const res = await api.get<{ providers: AiProvider[] }>('/admin/ai-settings')
  return res.providers
}

export async function adminCreateAiProvider(body: {
  providerName: string
  endpoint?: string
  model: string
  apiKey: string
  priority?: number
  enabled?: boolean
}): Promise<AiProvider> {
  return api.post<AiProvider>('/admin/ai-settings', body)
}

export async function adminUpdateAiProvider(
  id: string,
  body: {
    providerName?: string
    endpoint?: string | null
    model?: string
    apiKey?: string
    priority?: number
    enabled?: boolean
  },
): Promise<AiProvider> {
  return api.put<AiProvider>(`/admin/ai-settings/${id}`, body)
}

export async function adminDeleteAiProvider(id: string): Promise<void> {
  await api.delete(`/admin/ai-settings/${id}`)
}

// ----------------------------------------------------------------------------
// 工具权限全局开关
// ----------------------------------------------------------------------------

export async function adminGetToolPermissions(): Promise<Record<string, boolean>> {
  const res = await api.get<{ tools: Record<string, boolean> }>('/admin/tool-permissions')
  return res.tools
}

export async function adminUpdateToolPermission(
  toolName: string,
  enabled: boolean,
): Promise<{ ok: boolean; toolName: string; enabled: boolean }> {
  return api.put(`/admin/tool-permissions/${encodeURIComponent(toolName)}`, { enabled })
}

// ----------------------------------------------------------------------------
// 搜索引擎配置
// ----------------------------------------------------------------------------

export interface SearchEngine {
  name: string
  displayName: string
  enabled: boolean
  config: Record<string, unknown>
  updatedAt: number
}

export async function adminListSearchEngines(): Promise<SearchEngine[]> {
  const res = await api.get<{ engines: SearchEngine[] }>('/admin/search-engines')
  return res.engines
}

export async function adminUpdateSearchEngine(
  name: string,
  body: { enabled?: boolean; config?: Record<string, unknown> },
): Promise<SearchEngine> {
  return api.put<SearchEngine>(`/admin/search-engines/${encodeURIComponent(name)}`, body)
}
