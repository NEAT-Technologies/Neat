import { z } from 'zod'
import { ProvenanceSchema } from './edges.js'

export const RootCauseResultSchema = z.object({
  rootCauseNode: z.string(),
  rootCauseReason: z.string(),
  traversalPath: z.array(z.string()),
  edgeProvenances: z.array(ProvenanceSchema),
  confidence: z.number().min(0).max(1),
  fixRecommendation: z.string().optional(),
})
export type RootCauseResult = z.infer<typeof RootCauseResultSchema>

export const BlastRadiusAffectedNodeSchema = z.object({
  nodeId: z.string(),
  distance: z.number().int().nonnegative(),
  edgeProvenance: ProvenanceSchema,
})
export type BlastRadiusAffectedNode = z.infer<typeof BlastRadiusAffectedNodeSchema>

export const BlastRadiusResultSchema = z.object({
  origin: z.string(),
  affectedNodes: z.array(BlastRadiusAffectedNodeSchema),
  totalAffected: z.number().int().nonnegative(),
})
export type BlastRadiusResult = z.infer<typeof BlastRadiusResultSchema>
