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
  // Distance from the origin in BFS hops. The origin itself is never in
  // affectedNodes, so distance 0 has no meaning — the BFS at traverse.ts
  // already skips frame 0. Tightening to positive() locks that invariant
  // mechanically (ADR-038, issue #138).
  distance: z.number().int().positive(),
  edgeProvenance: ProvenanceSchema,
})
export type BlastRadiusAffectedNode = z.infer<typeof BlastRadiusAffectedNodeSchema>

export const BlastRadiusResultSchema = z.object({
  origin: z.string(),
  affectedNodes: z.array(BlastRadiusAffectedNodeSchema),
  totalAffected: z.number().int().nonnegative(),
})
export type BlastRadiusResult = z.infer<typeof BlastRadiusResultSchema>
