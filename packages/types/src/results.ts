import { z } from 'zod'
import { ProvenanceSchema, EdgeTypeSchema } from './edges.js'

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
  // path: origin → ... → nodeId. Length === distance + 1. Surfaced from the
  // BFS predecessor chain so consumers don't have to reconstruct it from
  // distance + the graph (ADR-038, issue #137).
  path: z.array(z.string()).min(2),
  // confidence: confidenceFromMix(...edgesAlongPath). Multiplicative cascade —
  // each hop is independent evidence and uncertainty compounds. ADR-036.
  confidence: z.number().min(0).max(1),
})
export type BlastRadiusAffectedNode = z.infer<typeof BlastRadiusAffectedNodeSchema>

export const BlastRadiusResultSchema = z.object({
  origin: z.string(),
  affectedNodes: z.array(BlastRadiusAffectedNodeSchema),
  totalAffected: z.number().int().nonnegative(),
})
export type BlastRadiusResult = z.infer<typeof BlastRadiusResultSchema>

// Transitive get_dependencies (issue #144). Flat list with distance, edge
// type, and provenance per dependency. Sibling shape to BlastRadius but
// thinner — no path tracking, no confidence cascade. Use cases live in the
// MCP get_dependencies tool ("what does X depend on, transitively?").
export const TransitiveDependencySchema = z.object({
  nodeId: z.string(),
  // Distance from the origin in BFS hops. The origin itself is never in
  // dependencies, so distance is positive (>= 1).
  distance: z.number().int().positive(),
  // Type of the edge that brought traversal to this node (CALLS,
  // CONNECTS_TO, DEPENDS_ON, etc.).
  edgeType: EdgeTypeSchema,
  // Provenance of that edge.
  provenance: ProvenanceSchema,
})
export type TransitiveDependency = z.infer<typeof TransitiveDependencySchema>

export const TransitiveDependenciesResultSchema = z.object({
  origin: z.string(),
  depth: z.number().int().positive(),
  dependencies: z.array(TransitiveDependencySchema),
  total: z.number().int().nonnegative(),
})
export type TransitiveDependenciesResult = z.infer<typeof TransitiveDependenciesResultSchema>
