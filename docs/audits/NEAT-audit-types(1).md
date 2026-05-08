# NEAT Types Package Audit — MVP (TypeScript v0.1.x)
## Load this before touching @neat.is/types or any code that imports from it.

**Scope:** This audit covers `packages/types` in the TypeScript MVP monorepo at `github.com/NEAT-Technologies/Neat`. It covers Zod schemas, TypeScript type exports, shared constants, and whether the package is actually used by the other packages or shadowed by local ad-hoc definitions.

**Stack:** Zod for runtime validation and TypeScript type inference. No runtime dependencies on other `@neat.is/*` packages — types is the root of the dependency tree.

**The goal this audit serves:** `@neat.is/types` is the contract between all packages. If it drifts — if `packages/core` defines its own local GraphEdge type, if `packages/mcp` has its own ad-hoc ErrorEvent schema, if the Zod schemas do not match what the code actually produces — the entire system breaks silently. Type errors at compile time. Wrong data at runtime. Mismatched responses between tools and the graph.

**What is not in scope:**
- NeatScript type system — v1.0 only
- Rust type definitions — v1.0 only
- Any type that is not currently used in the MVP codebase

---

## What @neat.is/types must be — MVP

A single source of truth. Every schema, every type, every shared constant that crosses a package boundary must live here and only here. If a type is defined in more than one place in the monorepo, that is a critical gap.

The package has no runtime logic. It exports Zod schemas, their inferred TypeScript types, and const objects for provenance and edge type values. Nothing else.

---

## The contract

### 1. Package structure — MVP

```
packages/types/
  src/
    nodes.ts       — ServiceNode, DatabaseNode, ConfigNode, InfraNode schemas
    edges.ts       — GraphEdge schema, EdgeType const
    provenance.ts  — Provenance schema, Provenance const
    events.ts      — ErrorEvent, PolicyViolationEvent schemas
    traversal.ts   — RootCauseResult, BlastRadiusResult schemas
    policy.ts      — Policy, PolicyFile schemas
    index.ts       — re-exports everything
  package.json
  tsconfig.json
```

**Verify:**
- Does this structure exist or is everything in one flat file?
- Is `index.ts` a clean re-export of all schemas and types?
- Does the package build cleanly with `pnpm --filter @neat.is/types build`?
- Is the package listed as a workspace dependency in `packages/core/package.json`, `packages/mcp/package.json`, and `packages/web/package.json`?

### 2. Provenance — MVP

The provenance system is the most critical shared type. It must be defined exactly once.

```typescript
export const Provenance = {
  EXTRACTED: 'EXTRACTED',
  INFERRED:  'INFERRED',
  OBSERVED:  'OBSERVED',
  STALE:     'STALE',
  FRONTIER:  'FRONTIER',
} as const

export type Provenance = typeof Provenance[keyof typeof Provenance]

export const ProvenanceSchema = z.enum([
  'EXTRACTED',
  'INFERRED',
  'OBSERVED',
  'STALE',
  'FRONTIER',
])
```

**Verify:**
- Is `Provenance` defined as a const object (for value access at runtime) AND as a Zod enum (for schema validation)?
- Is `Provenance.OBSERVED` used throughout the codebase or is the raw string `'OBSERVED'` used? Grep for `'OBSERVED'`, `'EXTRACTED'`, `'INFERRED'`, `'STALE'`, `'FRONTIER'` as raw strings in packages/core and packages/mcp. Any occurrence outside of the types package itself is a gap.
- Is FRONTIER present? It was added in v0.1.2 γ. Verify it is in the enum.

### 3. EdgeType — MVP

```typescript
export const EdgeType = {
  CALLS:         'CALLS',
  DEPENDS_ON:    'DEPENDS_ON',
  CONNECTS_TO:   'CONNECTS_TO',
  CONFIGURED_BY: 'CONFIGURED_BY',
} as const

export type EdgeType = typeof EdgeType[keyof typeof EdgeType]

export const EdgeTypeSchema = z.enum([
  'CALLS',
  'DEPENDS_ON',
  'CONNECTS_TO',
  'CONFIGURED_BY',
])
```

**Verify:**
- Is EdgeType defined as both a const object and a Zod enum?
- Are raw edge type strings used anywhere outside the types package? Grep for `'CALLS'`, `'DEPENDS_ON'`, `'CONNECTS_TO'`, `'CONFIGURED_BY'` in packages/core and packages/mcp.
- Are there any edge types in the codebase not in this enum?

### 4. Node schemas — MVP

Each node schema must have a discriminated `type` field that uniquely identifies the node type.

**ServiceNode:**
```typescript
export const ServiceNodeSchema = z.object({
  id:                   z.string(),
  type:                 z.literal('ServiceNode'),
  name:                 z.string(),
  language:             z.string(),
  version:              z.string().optional(),
  framework:            z.string().optional(),
  repoPath:             z.string().optional(),
  dbConnectionTarget:   z.string().optional(),
  drivers:              z.record(z.string()).optional(), // { pg: '7.4.0', mysql2: '2.1.0' }
  compatibilityWarnings: z.array(z.object({
    driver:  z.string(),
    engine:  z.string(),
    reason:  z.string(),
  })).optional(),
  owner:                z.string().optional(),
})
```

Note: `pgDriverVersion` must NOT be in this schema. It was deprecated and should have been replaced by the general `drivers` map. If it is still present, this is technical debt that will produce incorrect compatibility checks for non-pg drivers.

**DatabaseNode:**
```typescript
export const DatabaseNodeSchema = z.object({
  id:                z.string(),
  type:              z.literal('DatabaseNode'),
  name:              z.string(),
  engine:            z.string(),       // 'postgresql', 'mysql', 'mongodb', 'redis'
  engineVersion:     z.string().optional(),
  compatibleDrivers: z.array(z.object({
    name:           z.string(),
    minVersion:     z.string(),
  })),
})
```

**ConfigNode:**
```typescript
export const ConfigNodeSchema = z.object({
  id:       z.string(),
  type:     z.literal('ConfigNode'),
  name:     z.string(),
  path:     z.string(),
  fileType: z.string(),
})
```

**InfraNode:**
```typescript
export const InfraNodeSchema = z.object({
  id:       z.string(),
  type:     z.literal('InfraNode'),
  name:     z.string(),
  provider: z.string().optional(),
  region:   z.string().optional(),
})
```

**Verify:**
- Is `pgDriverVersion` absent from ServiceNodeSchema? If present, this is debt.
- Is `drivers` a general map rather than named driver fields?
- Is `framework` present on ServiceNode? Required for FastAPI detection.
- Is `owner` present on ServiceNode? Required for ownership policies.
- Is `compatibilityWarnings` present? Required for pre-computing compat checks at extraction time.
- Does each node schema use `z.literal()` for the `type` field enabling discriminated union?
- Is there a `GraphNodeSchema` union of all four node types?

### 5. GraphEdge schema — MVP

```typescript
export const GraphEdgeSchema = z.object({
  id:            z.string(),
  source:        z.string(),      // node id
  target:        z.string(),      // node id
  type:          EdgeTypeSchema,
  provenance:    ProvenanceSchema,
  confidence:    z.number().min(0).max(1).optional(),  // INFERRED only
  lastObserved:  z.string().datetime().optional(),     // OBSERVED only
  callCount:     z.number().int().min(0).optional(),   // OBSERVED only
  sourceFile:    z.string().optional(),                // EXTRACTED only — for ghost edge cleanup
})
```

**Verify:**
- Is `confidence` optional and constrained to 0.0-1.0?
- Is `lastObserved` an ISO8601 datetime string — not a Unix timestamp?
- Is `callCount` an integer — not a float?
- Is `sourceFile` present? Required for ghost edge cleanup when files change.
- Are `confidence`, `lastObserved`, and `callCount` all optional — they only apply to specific provenance values?
- Is there any field on GraphEdge that is not in this schema?

### 6. ErrorEvent schema — MVP

```typescript
export const ErrorEventSchema = z.object({
  id:            z.string().uuid(),
  timestamp:     z.string().datetime(),
  service:       z.string(),
  traceId:       z.string(),
  spanId:        z.string(),
  errorType:     z.string().optional(),
  errorMessage:  z.string(),
  affectedEdge:  z.string().optional(),
  affectedNode:  z.string(),
})
```

**Verify:**
- Is this schema in `@neat.is/types` and not redefined locally in packages/core?
- Is `id` validated as a UUID?
- Is `timestamp` validated as an ISO8601 datetime?
- Is the schema used when writing to `errors.ndjson`? Is it used when reading incidents via the REST API?

### 7. PolicyViolationEvent schema — MVP

This schema does not exist in v0.1.2 — it must be added when the policy layer is built. Including it here so it is defined before the policy layer agent starts building.

```typescript
export const PolicyViolationEventSchema = z.object({
  id:                  z.string().uuid(),
  timestamp:           z.string().datetime(),
  policyId:            z.string(),
  policyDescription:   z.string(),
  severity:            z.enum(['critical', 'warning', 'info']),
  violatingNodes:      z.array(z.string()),
  reason:              z.string(),
  onViolation:         z.enum(['alert', 'block', 'log']),
  resolved:            z.boolean(),
})
```

**Verify:**
- Does this schema exist? If not, add it before building the policy layer.
- Is it exported from `packages/types/src/index.ts`?
- Is it distinct from ErrorEvent — a policy violation is not the same as a runtime error?

### 8. Traversal result schemas — MVP

```typescript
export const RootCauseResultSchema = z.object({
  rootCauseNode:    z.string(),
  rootCauseReason:  z.string(),
  traversalPath:    z.array(z.string()),
  edgeProvenances:  z.array(ProvenanceSchema),
  confidence:       z.number().min(0).max(1),
})

export const BlastRadiusResultSchema = z.object({
  origin:        z.string(),
  affectedNodes: z.array(z.object({
    node:       z.string(),
    distance:   z.number().int().min(1),
    path:       z.array(z.string()),
    confidence: z.number().min(0).max(1),
  })),
  totalAffected: z.number().int().min(0),
})
```

**Verify:**
- Are these schemas in `@neat.is/types` and not defined locally in packages/core/traverse.ts?
- Is `edgeProvenances` an array matching the length of `traversalPath`? Each edge in the path has a provenance.
- Is `confidence` on the root cause result a cascade of the individual edge confidences — not just the final edge's confidence?
- Is `distance` an integer starting from 1 — not 0?

### 9. Policy schemas — MVP

```typescript
export const PolicyRuleSchema = z.object({
  targetNode:          z.string().optional(),
  targetType:          z.string().optional(),
  allowedSources:      z.array(z.string()).optional(),
  constraint:          z.string().optional(),
  forbiddenProvenance: z.string().optional(),
  requiredProvenance:  z.string().optional(),
  inBlastRadiusOf:     z.string().optional(),
  pathTo:              z.string().optional(),
  nodeType:            z.string().optional(),
  requiredProperty:    z.string().optional(),
  maxBlastRadius:      z.number().int().min(1).optional(),
  driver:              z.string().optional(),
  engine:              z.string().optional(),
  minDriverVersion:    z.string().optional(),
})

export const PolicySchema = z.object({
  id:          z.string(),
  description: z.string(),
  enabled:     z.boolean(),
  severity:    z.enum(['critical', 'warning', 'info']),
  type:        z.enum(['structural', 'compatibility', 'provenance', 'ownership', 'blast_radius']),
  rule:        PolicyRuleSchema,
  onViolation: z.enum(['alert', 'block', 'log']),
})

export const PolicyFileSchema = z.object({
  version:  z.literal(1),
  policies: z.array(PolicySchema),
})
```

**Verify:**
- Do these schemas exist? They must be added before the policy layer is built.
- Is `PolicyFileSchema` used to validate `policy.json` on startup?
- Is `version: z.literal(1)` present so future schema changes can be detected?

### 10. Import audit — the most revealing check

The purpose of `@neat.is/types` is that nothing else defines these types. If any package defines its own version of a type that should be in `@neat.is/types`, the contract is broken.

**Run these checks:**

Grep for local type or interface definitions in packages/core and packages/mcp:

```bash
grep -r "interface ServiceNode" packages/core packages/mcp
grep -r "interface DatabaseNode" packages/core packages/mcp
grep -r "interface GraphEdge" packages/core packages/mcp
grep -r "interface ErrorEvent" packages/core packages/mcp
grep -r "type Provenance" packages/core packages/mcp
grep -r "z.object" packages/core/src packages/mcp/src
```

Any `z.object` call in packages/core or packages/mcp that defines a type that should be in `@neat.is/types` is a gap. The only `z.object` calls permitted in packages/core and packages/mcp are for request/response validation that is specific to that package and not shared.

**Verify:**
- Are there any locally defined schemas in packages/core or packages/mcp that duplicate types from `@neat.is/types`?
- Does every import of a shared type come from `@neat.is/types` — not from a relative path within the same package?

---

## Red flags

- `pgDriverVersion` still present on ServiceNodeSchema
- Raw provenance strings (`'OBSERVED'`, `'EXTRACTED'`) used outside packages/types
- Raw edge type strings (`'CALLS'`, `'CONNECTS_TO'`) used outside packages/types
- Local type definitions in packages/core or packages/mcp that duplicate @neat.is/types schemas
- `z.object` calls in packages/core or packages/mcp defining types that cross package boundaries
- `ErrorEventSchema` defined locally in packages/core instead of imported from @neat.is/types
- `PolicyViolationEventSchema` missing — must exist before policy layer is built
- `lastObserved` typed as a number (Unix timestamp) instead of ISO8601 string
- `confidence` typed as an integer instead of a float between 0.0 and 1.0
- `sourceFile` missing from GraphEdgeSchema — ghost edge cleanup is impossible without it
- `framework` missing from ServiceNodeSchema — FastAPI detection is impossible without it
- `drivers` map missing — general driver version tracking requires it

---

## Five questions — answer these before closing the audit

1. Is `pgDriverVersion` absent from ServiceNodeSchema and replaced by a general `drivers` map?
2. Are raw provenance and edge type strings used anywhere outside packages/types?
3. Does PolicyViolationEventSchema exist in @neat.is/types?
4. Is `sourceFile` present on GraphEdgeSchema for ghost edge cleanup?
5. Does every shared type import come from `@neat.is/types` — with no local duplicates in other packages?

---

*MVP only. NeatScript type system and Rust type definitions are v1.0.*
