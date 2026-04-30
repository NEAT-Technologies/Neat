import { z } from 'zod'
import { EdgeType, Provenance } from './constants.js'

export const ProvenanceSchema = z.enum([
  Provenance.EXTRACTED,
  Provenance.INFERRED,
  Provenance.OBSERVED,
  Provenance.STALE,
  Provenance.FRONTIER,
])

export const EdgeTypeSchema = z.enum([
  EdgeType.CALLS,
  EdgeType.DEPENDS_ON,
  EdgeType.CONNECTS_TO,
  EdgeType.CONFIGURED_BY,
])

export const GraphEdgeSchema = z.object({
  id: z.string(),
  source: z.string(),
  target: z.string(),
  type: EdgeTypeSchema,
  provenance: ProvenanceSchema,
  confidence: z.number().min(0).max(1).optional(),
  lastObserved: z.string().datetime().optional(),
  callCount: z.number().int().nonnegative().optional(),
})
export type GraphEdge = z.infer<typeof GraphEdgeSchema>
