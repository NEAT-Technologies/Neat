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
  EdgeType.PUBLISHES_TO,
  EdgeType.CONSUMES_FROM,
])

export const EdgeEvidenceSchema = z.object({
  file: z.string(),
  line: z.number().int().nonnegative(),
  snippet: z.string(),
})
export type EdgeEvidence = z.infer<typeof EdgeEvidenceSchema>

export const GraphEdgeSchema = z.object({
  id: z.string(),
  source: z.string(),
  target: z.string(),
  type: EdgeTypeSchema,
  provenance: ProvenanceSchema,
  confidence: z.number().min(0).max(1).optional(),
  lastObserved: z.string().datetime().optional(),
  callCount: z.number().int().nonnegative().optional(),
  evidence: EdgeEvidenceSchema.optional(),
})
export type GraphEdge = z.infer<typeof GraphEdgeSchema>
