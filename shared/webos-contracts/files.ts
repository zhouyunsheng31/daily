// ============================================================================
// 文件工作区契约（File Service 一阶段 · 单一事实源）—— R6/R7 双端共消费
// ----------------------------------------------------------------------------
// 依据：docs/routes/web/07-files.md §2（manifest 是移动端 M1-7 同步锚点）。
// 本文件定义 manifest 条目/分块上传/快照的响应结构；服务端实现见
// server/src/webos/files/。移动端 Kotlin DTO 读同一契约（R3/R6）。
// 新增字段必须：本表 + 07 文档 + 双端实现同步，缺一不可。
// ============================================================================

/** manifest 单条目（path 相对工作区根，如 home/a/b.png；etag=sha256 短前缀） */
export interface WebOsFileManifestEntry {
  /** 相对路径（相对工作区根，如 home/demo.png / agent/x.md） */
  path: string
  /** 字节数 */
  size: number
  /** 内容指纹 etag（sha256 十六进制前 16 位；移动端增量同步用） */
  etag: string
  /** 修改时间（Unix 毫秒） */
  mtime: number
  /** MIME（尽力推断；未知为 application/octet-stream） */
  mime?: string
}

/** GET /webos/api/files/manifest?prefix= 响应 */
export interface WebOsFileManifestResponse {
  ok: boolean
  /** 请求的 prefix（未传为 ''） */
  prefix: string
  /** 同 prefix 下全部文件条目（含子目录递归；不含目录本身） */
  entries: WebOsFileManifestEntry[]
  /** 本 prefix 下文件总字节 */
  totalBytes: number
}

/** 分块上传 init 响应 */
export interface WebOsUploadInitResponse {
  ok: boolean
  uploadId: string
  /** 目标相对路径（如 home/video.mp4） */
  path: string
  totalBytes: number
  /** 分块大小（字节；8MB） */
  chunkSize: number
  /** 应传的片数（ceil(totalBytes/chunkSize)；0 字节文件为 1） */
  partsCount: number
  /** 是否恢复已有会话（断点续传） */
  resumed: boolean
  /** 已收片数（resumed=true 时 >0，可从中断处继续） */
  receivedParts?: number
}

/** 分块上传 part 响应 */
export interface WebOsUploadPartResponse {
  ok: boolean
  /** 已收累计字节 */
  received: number
  /** 已收片数 */
  partsCount: number
  totalBytes: number
}

/** 分块上传 complete 响应 */
export interface WebOsUploadCompleteResponse {
  ok: boolean
  file: WebOsFileManifestEntry
  workspaceBytes: number
  workspaceLimitBytes: number
}

/** 手动快照点响应 */
export interface WebOsFileSnapshotResponse {
  ok: boolean
  /** 快照点 id（可回滚到该点） */
  snapshotId: string
  /** 本次快照覆盖的文件数 */
  fileCount: number
  createdAt: number
}

/** 分块上传默认参数（服务端单一常量；移动端对齐） */
export const FILE_SERVICE_CONSTANTS = {
  /** 分块上传单片大小（字节） */
  chunkSize: 8 * 1024 * 1024,
  /** 小文件直传上限（字节，≤此值走 PUT blob） */
  smallPutLimit: 8 * 1024 * 1024,
  /** 上传会话存活时长（毫秒；超时未 complete 自动清理） */
  sessionTtlMs: 2 * 60 * 60 * 1000,
  /** manifest 单次返回最大条目数（防止超大工作区撑爆响应） */
  manifestMaxEntries: 20_000,
  /** 单次快照最多记录文件数（超大目录截断并提示） */
  snapshotMaxFiles: 10_000,
} as const
