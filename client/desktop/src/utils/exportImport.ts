/**
 * Public import/export API.
 * All external import/export operations MUST go through this module.
 */

import {
  exportV2Data,
  importV2Stage,
  importV2Remap,
  importV2Commit,
  type ExportBundle,
} from './exportImportV2'
import { importData as importV1Data } from './db'

export interface ExportOptions {
  includeAIData?: boolean
}

export interface ImportResult {
  success: boolean
  warnings?: string[]
  errors?: string[]
}

/**
 * Export all data. AI data is excluded by default.
 */
export async function exportData(options?: ExportOptions): Promise<string> {
  const includeAI = options?.includeAIData ?? false
  const blob = await exportV2Data()
  const text = await blob.text()
  const bundle = JSON.parse(text) as ExportBundle & Record<string, unknown>

  if (!includeAI) {
    delete bundle.aiConversations
    delete bundle.aiMemories
      }

  return JSON.stringify({ ...bundle, includeAIData: includeAI, version: 3 })
}

/**
 * Import data from a JSON string. Supports v1 and v2 formats.
 */
export async function importData(jsonString: string): Promise<ImportResult> {
  try {
    const data = JSON.parse(jsonString)
    const version = detectExportVersion(data)

    if (version === 1) {
      // Legacy v1 format - use old import
      const blob = new Blob([jsonString], { type: 'application/json' })
      await importV1Data(blob)
      return { success: true }
    }

    if (version >= 2) {
      // V2+ format
      const hasAIData = data.aiConversations || data.aiMemories
      // Phase 2A 已完成，但 AI 数据导入的 UI 提示未实现：当前默认丢弃 AI 数据
      // 后续若需支持 AI 数据导入，应在此处增加 UI 确认对话框
      if (hasAIData) {
        delete data.aiConversations
        delete data.aiMemories
      }

      // If it's v3 (our wrapper), unwrap to v2 format for validation
      const v2Data = version === 3 ? { ...data, version: 2 } : data

      const staged = importV2Stage(v2Data)
      if (!staged.valid) {
        return { success: false, errors: staged.warnings }
      }

      const remapped = importV2Remap(staged)
      const report = await importV2Commit(remapped)

      if (report.errors.length > 0) {
        return { success: false, warnings: report.warnings, errors: report.errors }
      }

      return { success: true, warnings: [...report.warnings, ...remapped.warnings] }
    }

    return { success: false, errors: ['Unknown export format'] }
  } catch (e: unknown) {
    return { success: false, errors: [e instanceof Error ? e.message : String(e)] }
  }
}

function detectExportVersion(data: unknown): number {
  if (!data || typeof data !== 'object') return 0
  const obj = data as Record<string, unknown>
  if (obj.version === 3) return 3
  if (obj.version === 2 || obj.exportedAt) return 2
  if (obj.panels && obj.widgetRecords) return 2
  if (obj.panels && !obj.widgetRecords) return 1
  return 0
}
