export interface PanelRow {
  id: string
  name: string
  sort_order: number
  settings: Record<string, unknown> // JSONB
  canvas_transform: Record<string, unknown> | null // JSONB
  created_at: number
  updated_at: number
}

export interface WidgetRow {
  id: string
  panel_id: string
  type: string
  x: number
  y: number
  width: number
  height: number
  z_index: number
  minimized: boolean
  locked: boolean
  color_scheme: string | null
  state: Record<string, unknown> // JSONB
  is_primary: boolean
  version: number
  created_at: number
  updated_at: number
}

export interface EntityRow {
  id: string
  type: string
  scope: string
  panel_id: string | null
  widget_id: string | null
  data: Record<string, unknown> // JSONB
  record_status: string
  version: number
  created_at: number
  updated_at: number
}

export interface EntityRelationRow {
  id: string
  source_id: string
  target_id: string
  type: string
  metadata: Record<string, unknown> // JSONB
  created_at: number
}

export interface SettingsRow {
  key: string
  value: unknown // JSONB
  updated_at: number
}

export interface DynamicWidgetRow {
  widget_type: string
  display_name: string
  icon: string
  default_layout: Record<string, unknown> // JSONB
  default_state: Record<string, unknown> // JSONB
  code: string
  // Phase 5 扩展字段（schema.ts 第 231-244 行 ALTER TABLE 添加，Phase 14.4.1 补齐类型）
  component_env: string // VARCHAR(16) NOT NULL DEFAULT 'pure-frontend'
  local_services: string[] | null // JSONB，依赖的本地服务名数组
  cross_platform: boolean // NOT NULL DEFAULT TRUE
  desktop_only: boolean // NOT NULL DEFAULT FALSE
  created_at: number
  updated_at: number
}

export interface PanelTemplateRow {
  id: string
  name: string
  icon: string
  description: string
  widgets: unknown[] // JSONB
  is_builtin: boolean
  created_at: number
  updated_at: number
}

// API 请求/响应类型
export interface CreatePanelRequest {
  id?: string
  name: string
  sortOrder?: number
  settings?: Record<string, unknown>
  canvasTransform?: Record<string, unknown> | null
  isCommunity?: boolean
  /** spec §9.4：外部社区 API 地址（社区面板连接外部社群用） */
  communityApiUrl?: string | null
}

export interface UpdatePanelRequest {
  name?: string
  sortOrder?: number
  settings?: Record<string, unknown>
  canvasTransform?: Record<string, unknown> | null
  isCommunity?: boolean
  /** spec §9.4：外部社区 API 地址（社区面板连接外部社群用） */
  communityApiUrl?: string | null
}

export interface CreateWidgetRequest {
  id?: string
  type: string
  x?: number
  y?: number
  width?: number
  height?: number
  zIndex?: number
  minimized?: boolean
  locked?: boolean
  colorScheme?: string | null
  state?: Record<string, unknown>
  isPrimary?: boolean  // v10: 主AI助手标记
}

export interface UpdateWidgetRequest {
  x?: number
  y?: number
  width?: number
  height?: number
  zIndex?: number
  minimized?: boolean
  locked?: boolean
  colorScheme?: string | null
  state?: Record<string, unknown>
  isPrimary?: boolean  // v10: 主AI助手标记
}

export interface CreateEntityRequest {
  id?: string
  type: string
  scope?: string
  panelId?: string | null
  widgetId?: string | null
  data: Record<string, unknown>
  recordStatus?: string
}

export interface UpdateEntityRequest {
  type?: string
  scope?: string
  panelId?: string | null
  widgetId?: string | null
  data?: Record<string, unknown>
  recordStatus?: string
}

export interface CreateRelationRequest {
  id?: string
  sourceId: string
  targetId: string
  type: string
  metadata?: Record<string, unknown>
}

export interface EntityQueryParams {
  type?: string
  scope?: string
  panelId?: string
  widgetId?: string
  recordStatus?: string
  limit?: number
  offset?: number
}

export interface RelationQueryParams {
  sourceId?: string
  targetId?: string
  type?: string
}

// ============================================================================
// Phase S3 缺口 A：实体冲突日志类型（spec 2.1.2 节）
// ============================================================================

// 解决冲突的动作枚举（与客户端 ConflictBadge 三选项对齐）
export type EntityConflictResolveAction = 'keep-local' | 'keep-remote' | 'merge'

export interface EntityConflictLog {
  id: string
  entityId: string
  entityType: string
  panelId: string | null
  localVersion: number
  remoteVersion: number
  localState: unknown
  remoteState: unknown
  sourceDeviceId?: string
  resolved: boolean
  resolvedAction?: string
  resolvedAt?: number
  createdAt: number
}

// ============================================================================
// Phase S3 缺口 B：sync_logs 类型（spec 2.2.2 节）
// ============================================================================

export type SyncLogStatus = 'pending' | 'success' | 'failed'

export interface SyncLogEntry {
  id: string
  deviceId: string
  operation: 'create' | 'update' | 'delete'
  entityType: string  // 'panel' | 'widget' | 'entity' | 'favorite' | 'settings'
  entityId: string
  payload: unknown
  status: SyncLogStatus
  retryCount: number
  lastError: string | null
  createdAt: number
  updatedAt: number
  nextRetryAt: number | null
}

export interface SyncLogQueryParams {
  deviceId?: string
  status?: SyncLogStatus
  entityType?: string
  entityId?: string
  limit?: number
  offset?: number
}

export interface UpsertSyncLogRequest {
  id: string
  operation: 'create' | 'update' | 'delete'
  entityType: string
  entityId: string
  payload: unknown
  status: SyncLogStatus
  retryCount?: number
  lastError?: string
  nextRetryAt?: number | null
}

// ============================================================================
// Phase 4：多用户系统类型
// ============================================================================

export type UserRole = 'admin' | 'member'

export interface UserRow {
  id: string
  username: string
  email: string
  password_hash: string
  role: string
  is_banned: boolean | number
  created_at: number
  last_login_at: number | null
}

export interface PublicUser {
  id: string
  username: string
  email: string
  role: UserRole
  isBanned: boolean
  createdAt: number
  lastLoginAt: number | null
}

export interface RegisterRequest {
  username: string
  email: string
  password: string
}

export interface LoginRequest {
  username?: string
  email?: string
  password: string
}
