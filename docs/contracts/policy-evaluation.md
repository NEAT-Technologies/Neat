---
name: policy-evaluation
description: evaluateAllPolicies is pure. Triggers post-ingest, post-extract, post-stale-transition. Per-type evaluator dispatch. Violations append to policy-violations.ndjson; ids are deterministic.
governs:
  - "packages/core/src/policy.ts"
  - "packages/core/src/ingest.ts"
  - "packages/core/src/extract/index.ts"
  - "packages/core/src/persist.ts"
adr: [ADR-043, ADR-042, ADR-030]
---

# Policy evaluation contract

The second of four policy contracts. Sibling contracts: [`policy-schema.md`](./policy-schema.md), [`policy-actions.md`](./policy-actions.md), [`policy-tools.md`](./policy-tools.md).

## Entry point

```ts
evaluateAllPolicies(
  graph: NeatGraph,
  policies: Policy[],
  context: EvaluationContext
): PolicyViolation[]
```

Pure function. Walks the policy list, dispatches each by `policy.rule.type` to a per-type evaluator, accumulates violations.

## Triggers

- **Post-ingest** — after `handleSpan` completes.
- **Post-extract** — after `extractFromDirectory` completes.
- **Post-stale-transition** — after `markStaleEdges` ticks.

Other call sites (REST `POST /policies/check`, MCP `check_policies`) call the same function; not separate triggers.

## `PolicyViolation` shape

```ts
{
  id: string,                  // ${policy.id}:${violation-context}
  policyId: string,
  policyName: string,
  severity: Policy['severity'],
  onViolation: Policy['onViolation'],
  ruleType: PolicyRule['type'],
  subject: { nodeId?: string; edgeId?: string; path?: string[] },
  message: string,
  observedAt: ISO8601
}
```

## Deterministic ids

Same graph + same policies → same violation ids. Append-only `policy-violations.ndjson` keys on `id`; duplicates skipped at write time.

## Per-type dispatch

```ts
const policyEvaluators: Record<RuleType, Evaluator> = {
  structural,
  compatibility,
  provenance,
  ownership,
  'blast-radius': blastRadius,
}
```

Adding a rule type means one new entry plus the schema entry from `policy-schema.md`.

## Idempotency

Stateless. Same inputs → same violations.

## Authority

Lives in `packages/core/src/policy.ts`. Reads the live graph; calls `compat.ts`; never mutates the graph.

Full rationale: [ADR-043](../decisions.md#adr-043--policy-evaluation-contract).
