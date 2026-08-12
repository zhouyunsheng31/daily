import { api } from './client'

export interface WidgetDTO {
  id: string
  panelId: string
  type: string
  x: number
  y: number
  width: number
  height: number
  zIndex: number
  minimized: boolean
  locked: boolean
  colorScheme: string | null
  state: Record<string, unknown>
  isPrimary?: boolean  // 新增：主AI助手标记（v4 C1 修复：全链路持久化）
  version: number
  createdAt: number
  updatedAt: number
}

export async function getPanelWidgets(panelId: string): Promise<WidgetDTO[]> {
  return api.get<WidgetDTO[]>(`/panels/${panelId}/widgets`)
}

export async function getWidget(id: string): Promise<WidgetDTO> {
  return api.get<WidgetDTO>(`/widgets/${id}`)
}

export async function createWidget(panelId: string, data: Partial<WidgetDTO> & { id?: string; type: string }): Promise<WidgetDTO> {
  return api.post<WidgetDTO>(`/panels/${panelId}/widgets`, data)
}

export async function updateWidget(id: string, data: Partial<WidgetDTO>): Promise<WidgetDTO> {
  return api.put<WidgetDTO>(`/widgets/${id}`, data)
}

/**
 * Phase 4: 单个 widget state 更新（带乐观锁，spec 2.5 节）
 * 服务器端 PUT /api/widgets/:id 当 expectedVersion 存在且为 state-only 更新时，
 * 校验 version，不匹配返回 409 + { conflict, currentVersion, currentState }
 */
export async function updateWidgetState(
  id: string,
  state: Record<string, unknown>,
  expectedVersion?: number,
): Promise<WidgetDTO> {
  const body: Record<string, unknown> = { state }
  if (expectedVersion !== undefined) {
    body.expectedVersion = expectedVersion
  }
  return api.put<WidgetDTO>(`/widgets/${id}`, body)
}

export async function deleteWidget(id: string): Promise<void> {
  await api.delete(`/widgets/${id}`)
}

// ============================================================================
// Phase 2 决策38/39：mini/icon 档 AI 自定义 HTML 上传接口
// POST /api/widgets/:id/mini-html — 上传 mini 档精简 HTML（决策38）
// POST /api/widgets/:id/icon-html — 上传 icon 档 HTML 图标（决策39）
// owner 可改自己面板上的 widget，admin 可改任意 widget
// ============================================================================

/** 上传 widget 的 mini 档精简 HTML（决策38：精简 HTML 形态，非简单缩放） */
export async function uploadWidgetMiniHtml(id: string, html: string): Promise<WidgetDTO> {
  return api.post<WidgetDTO>(`/widgets/${id}/mini-html`, { html })
}

/** 上传 widget 的 icon 档 HTML 图标（决策39：圆形/任意形状，非固定方形） */
export async function uploadWidgetIconHtml(id: string, html: string): Promise<WidgetDTO> {
  return api.post<WidgetDTO>(`/widgets/${id}/icon-html`, { html })
}

export async function batchUpdatePositions(positions: Array<{ id: string; x: number; y: number; width: number; height: number; zIndex: number }>): Promise<void> {
  await api.put('/widgets/batch-positions', { positions })
}

export async function batchUpdateStates(widgets: Array<{ id: string; state: Record<string, unknown>; minimized?: boolean; locked?: boolean; colorScheme?: string | null }>): Promise<void> {
  await api.put('/widgets/batch-states', { widgets })
}

// ============================================================================
// Phase 5：自定义上传组件 API（spec §11.2）
// ============================================================================

export interface CustomWidgetDTO {
  id: string
  name: string
  description: string
  html: string
  width: number
  height: number
  tags: string[]
  ownerId: string | null
  isPublic: boolean
  isGlobal: boolean
  createdAt: number
  updatedAt: number
}

/** 上传自定义 HTML 组件（登录用户均可，admin 可设 isGlobal） */
export async function uploadCustomWidget(params: {
  name: string
  html: string
  description?: string
  width?: number
  height?: number
  tags?: string[]
  isPublic?: boolean
  isGlobal?: boolean
}): Promise<CustomWidgetDTO> {
  return api.post<CustomWidgetDTO>('/widgets/upload', params)
}

/** 获取自定义组件列表（公开 + 自己的） */
export async function getCustomWidgets(): Promise<CustomWidgetDTO[]> {
  return api.get<CustomWidgetDTO[]>('/widgets/custom')
}

/**
 * Phase 6 T12：管理员获取所有自定义组件（含私有，spec §10.3）
 * 仅 admin 可调用，用于全局组件管理界面
 */
export async function adminGetAllCustomWidgets(): Promise<CustomWidgetDTO[]> {
  return api.get<CustomWidgetDTO[]>('/widgets/custom/all')
}

/**
 * Phase 6 T12：管理员切换组件全局可见性（spec §10.3）
 * 全局组件对所有用户可见
 */
export async function setCustomWidgetGlobal(id: string, isGlobal: boolean): Promise<CustomWidgetDTO> {
  return api.put<CustomWidgetDTO>(`/widgets/custom/${id}/global`, { isGlobal })
}

/** 更新自定义组件（admin） */
export async function updateCustomWidget(id: string, params: {
  name?: string
  html?: string
  description?: string
  width?: number
  height?: number
  tags?: string[]
  isPublic?: boolean
}): Promise<CustomWidgetDTO> {
  return api.put<CustomWidgetDTO>(`/widgets/custom/${id}`, params)
}

/** 删除自定义组件（admin） */
export async function deleteCustomWidget(id: string): Promise<void> {
  await api.delete(`/widgets/custom/${id}`)
}

