// ============================================================================
// Phase 14.5：知识库数据模型类型（server 本地副本）
// 注意：此文件是 shared/types/wiki.ts 的本地副本（仅类型，无 zod schema），
//       用于服务端 TypeScript 编译（rootDir: ./src 限制，不能引用 ../shared/）。
//       客户端继续使用 shared/types/wiki.ts（含 zod schema，通过 Vite alias）。
//       修改其中一份时，请同步另一份。
// ============================================================================

export interface WikiPage {
  id: string
  title: string
  content: string
  sourceId: string | null
  tags: string[]
  createdAt: number
  updatedAt: number
}

export interface WikiSource {
  id: string
  type: 'pdf' | 'web' | 'markdown' | 'text'
  url: string | null
  filePath: string | null
  metadata: Record<string, unknown>
  createdAt: number
}

export interface WikiRelation {
  id: string
  fromPageId: string
  toPageId: string
  type: 'references' | 'related' | 'derived_from'
  weight: number
}
