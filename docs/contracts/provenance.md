---
name: provenance
description: Edge ids and provenance ranking are constructed via @neat/types/identity helpers. Coexistence of OBSERVED and EXTRACTED edges is structural, not policy.
governs:
  - "packages/core/src/ingest.ts"
  - "packages/core/src/traverse.ts"
  - "packages/core/src/persist.ts"
  - "packages/core/src/extract/**"
  - "packages/types/src/identity.ts"
  - "packages/types/src/edges.ts"
  - "packages/types/src/constants.ts"
adr: [ADR-029, ADR-024, ADR-027]
---

# Provenance contract

Every edge in NEAT carries a `provenance` field. The provenance value (`OBSERVED | INFERRED | EXTRACTED | STALE | FRONTIER`) determines:

1. The id wire format (each provenance has its own pattern).
2. The trust ranking when multiple edges between the same node pair coexist.
3. The set of required fields on the edge (`lastObserved`, `callCount`, `confidence`, `evidence`).
4. The lifecycle rules — when the edge can transition or be retired.

## Edge id helpers

```ts
import { extractedEdgeId, observedEdgeId, inferredEdgeId, frontierEdgeId, parseEdgeId } from '@neat/types'

extractedEdgeId('service:a', 'service:b', 'CALLS')
// 'CALLS:service:a->service:b'

observedEdgeId('service:a', 'service:b', 'CALLS')
// 'CALLS:OBSERVED:service:a->service:b'

inferredEdgeId('service:a', 'service:b', 'CALLS')
// 'CALLS:INFERRED:service:a->service:b'

frontierEdgeId('service:a', 'frontier:unknown:8080', 'CALLS')
// 'CALLS:FRONTIER:service:a->frontier:unknown:8080'

parseEdgeId('CALLS:OBSERVED:service:a->service:b')
// { type: 'CALLS', provenance: 'OBSERVED', source: 'service:a', target: 'service:b' }
```

Hand-rolled template literals like `` `${type}:OBSERVED:${source}->${target}` `` are a contract violation. The wire format lives in exactly one file (`packages/types/src/identity.ts`).

STALE never appears in an edge id. STALE is a transition of an existing OBSERVED edge (ADR-024), not a creation pattern. The id stays at `${type}:OBSERVED:${source}->${target}` after the transition; only the `provenance` attribute changes.

## Wire format (locked)

| Provenance | Pattern                                          | Confidence       | Created by                  |
|------------|--------------------------------------------------|------------------|-----------------------------|
| EXTRACTED  | `${type}:${source}->${target}`                   | not stored       | static analyzers (extract/) |
| OBSERVED   | `${type}:OBSERVED:${source}->${target}`          | always 1.0       | `upsertObservedEdge`        |
| INFERRED   | `${type}:INFERRED:${source}->${target}`          | ≤ 0.7, default 0.6 | trace stitcher            |
| FRONTIER   | `${type}:FRONTIER:${source}->${target}`          | not stored       | `upsertFrontierEdge`        |
| STALE      | (id pattern stays at the OBSERVED id)            | ≤ 0.3            | `markStaleEdges` transition |

## Coexistence rule (binding)

OBSERVED and EXTRACTED edges between the same node pair coexist as **separate edges with distinct ids**, not a single edge upgraded in place. The id pattern is what makes coexistence mechanically possible: `extractedEdgeId('a', 'b', 'CALLS')` and `observedEdgeId('a', 'b', 'CALLS')` are different strings, so `graph.hasEdge(...)` doesn't conflate them.

This is intentional. The gap between declared intent (EXTRACTED) and observed reality (OBSERVED) is the load-bearing fact NEAT exists to surface (ADR-027). Stomping one with the other erases the gap.

## Provenance ranking — `PROV_RANK`

The canonical priority used by traversal and any consumer that needs to pick a single edge between two nodes when multiple provenance variants exist:

```ts
import { PROV_RANK } from '@neat/types'

PROV_RANK.OBSERVED   // 3
PROV_RANK.INFERRED   // 2
PROV_RANK.EXTRACTED  // 1
PROV_RANK.STALE      // 0
PROV_RANK.FRONTIER   // 0
```

Frozen object. Consumers import it; nobody re-defines it locally. Traversal uses it to pick the highest-priority edge per `(source, target, type)` triplet at every hop.

FRONTIER ranks 0 alongside STALE for the case where it ends up in a comparison set, but [contracts.md Rule 3](../contracts.md#3-frontier-edges-are-not-traversed) says traversal must skip FRONTIER edges entirely — so this rank is rarely consulted for FRONTIER in practice.

## Confidence semantics per provenance

- **OBSERVED** — `confidence: 1.0` always. Direct measurement; the value is a max-trust marker, not a derived score.
- **INFERRED** — `confidence ≤ 0.7`, default `0.6` (`INFERRED_CONFIDENCE` in `ingest.ts`). Set at creation by the trace stitcher; never exceeds 0.7.
- **EXTRACTED** — confidence is **not stored**. EXTRACTED edges either exist (the static analyzer found them) or they don't. They don't decay on a clock; their confidence is implicit.
- **STALE** — confidence drops to `≤ 0.3` on transition; original `lastObserved` preserved.
- **FRONTIER** — confidence not stored as a numeric field. FRONTIER is excluded from traversal so its confidence is never compared.

## Required fields per provenance

- **OBSERVED:** `lastObserved` (ISO8601), `callCount`, `confidence: 1.0`.
- **INFERRED:** `confidence` (0.0–0.7).
- **EXTRACTED:** `evidence: { file, line?, snippet? }` for CALLS-family edges; broader evidence shapes for other edge types are pending the v0.2.1 tree-sitter rebuild (issue #140).
- **STALE:** `lastObserved` preserved from the OBSERVED state, `confidence ≤ 0.3`.
- **FRONTIER:** `lastObserved` (ISO8601 of the span that revealed the unresolved peer).

## Enforcement

`packages/core/test/audits/contracts.test.ts` adds:
- A scan for hand-rolled `` `${type}:OBSERVED:` ``, `` `:INFERRED:` ``, `` `:FRONTIER:` ``, and `` `${type}:${source}->...` `` template literals in `packages/core/src/` and `packages/mcp/src/`. CI fails any future session that drifts.
- Round-trip assertions on the helpers and `parseEdgeId`.
- An assertion that `PROV_RANK.OBSERVED > PROV_RANK.INFERRED > PROV_RANK.EXTRACTED > PROV_RANK.STALE`.
- An assertion that `PROV_RANK.FRONTIER === 0` (FRONTIER is excluded from traversal regardless of rank, but the rank value is part of the contract).

## Rationale

If two producers disagree on the wire format of an OBSERVED edge id, the upsert function in `ingest.ts` won't find the existing edge and will create a duplicate. If two consumers disagree on PROV_RANK, traversal returns different paths from different call sites for the same query. Both failures are silent.

ADR-029 collapses four scattered helpers (`makeEdgeId` in `extract/shared.ts`, two locals in `ingest.ts`, one inline literal) into one canonical module so producers and consumers can't drift apart.

Full rationale and historical context: [ADR-029](../decisions.md#adr-029--edge-identity-and-provenance-ranking).
