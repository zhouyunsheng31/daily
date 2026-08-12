package xyz.shadowshub.sync

/**
 * sync：移动端双向同步（LWW + conflict 副本）。
 * - home/ 双向同步（09-files-sync-backup）
 * - 分块上传/断点续传适配
 * M1-7（文件服务第一阶段）时填充；M0-1 仅建模块。
 */
object SyncMarker