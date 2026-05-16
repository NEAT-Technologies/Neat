export const Provenance = {
  EXTRACTED: 'EXTRACTED',
  INFERRED: 'INFERRED',
  OBSERVED: 'OBSERVED',
  STALE: 'STALE',
} as const

export type ProvenanceValue = (typeof Provenance)[keyof typeof Provenance]

export const EdgeType = {
  CALLS: 'CALLS',
  DEPENDS_ON: 'DEPENDS_ON',
  CONNECTS_TO: 'CONNECTS_TO',
  CONFIGURED_BY: 'CONFIGURED_BY',
  PUBLISHES_TO: 'PUBLISHES_TO',
  CONSUMES_FROM: 'CONSUMES_FROM',
  RUNS_ON: 'RUNS_ON',
} as const

export type EdgeTypeValue = (typeof EdgeType)[keyof typeof EdgeType]

export const NodeType = {
  ServiceNode: 'ServiceNode',
  DatabaseNode: 'DatabaseNode',
  ConfigNode: 'ConfigNode',
  InfraNode: 'InfraNode',
  FrontierNode: 'FrontierNode',
} as const

export type NodeTypeValue = (typeof NodeType)[keyof typeof NodeType]

import { z } from 'zod'

// Zod-side mirror of NodeType, exported for schemas that need to discriminate
// or filter by node type at parse time (policy rules, traversal results, etc.).
// Adding a new node type means adding it to NodeType above and to this enum.
export const NodeTypeSchema = z.enum([
  NodeType.ServiceNode,
  NodeType.DatabaseNode,
  NodeType.ConfigNode,
  NodeType.InfraNode,
  NodeType.FrontierNode,
])
