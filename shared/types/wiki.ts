import { z } from 'zod'

export const WikiPageSchema = z.object({
  id: z.string(),
  title: z.string(),
  content: z.string(),
  sourceId: z.string().nullable(),
  tags: z.array(z.string()).default([]),
  createdAt: z.number(),
  updatedAt: z.number(),
})

export const WikiSourceSchema = z.object({
  id: z.string(),
  type: z.enum(['pdf', 'web', 'markdown', 'text']),
  url: z.string().nullable(),
  filePath: z.string().nullable(),
  metadata: z.record(z.string(), z.unknown()).default({}),
  createdAt: z.number(),
})

export const WikiRelationSchema = z.object({
  id: z.string(),
  fromPageId: z.string(),
  toPageId: z.string(),
  type: z.enum(['references', 'related', 'derived_from']),
  weight: z.number().default(1.0),
})

export type WikiPage = z.infer<typeof WikiPageSchema>
export type WikiSource = z.infer<typeof WikiSourceSchema>
export type WikiRelation = z.infer<typeof WikiRelationSchema>
