---
name: frontier-promotion
description: FrontierNode promotion fires after every extract pass, alias-matches by name then aliases list, atomically rewires incident edges, upgrades FRONTIER to OBSERVED on rebuild. Edge ids during rebuild MUST use canonical helpers.
governs:
  - "packages/core/src/ingest.ts"
  - "packages/core/src/extract/index.ts"
  - "packages/core/src/extract/aliases.ts"
  - "packages/core/src/watch.ts"
adr: [ADR-035, ADR-023, ADR-029, ADR-030]
---

# FrontierNode promotion contract

The third of three v0.2.2 producer-layer contracts. Governs `promoteFrontierNodes`, `rewireFrontierEdges`, and `rebuildEdge` in `ingest.ts`. Sibling contracts: [otel-ingest.md](./otel-ingest.md), [trace-stitcher.md](./trace-stitcher.md).

FrontierNodes (ADR-023) are placeholders for OTel peers that don't match any known service. Promotion replaces a FrontierNode with a real typed node once an alias resolves the host. This contract locks the trigger conditions, alias-match rules, edge-rewrite semantics, and the FRONTIER → OBSERVED provenance upgrade.

## Trigger

`promoteFrontierNodes(graph)` runs:
- at the end of `extract/index.ts:extractFromDirectory` (every static-extraction pass),
- at the end of every watch-driven phase rerun in `watch.ts`.

**Promotion is batched per pass, not per-edge.** The ingest path itself does not trigger promotion — only the static-extraction lifecycle does, because aliases land during static extraction (compose names, k8s metadata.name, Dockerfile labels via `extract/aliases.ts`).

## Alias matching

The function builds a `Map<string, string>` from every ServiceNode's `attrs.name → id` and `attrs.aliases[i] → id`. Then it walks every FrontierNode and looks up `attrs.host` in the map:

- First match wins.
- If no match, the FrontierNode persists; the next extract pass tries again.
- A FrontierNode whose host happens to equal a service name is promoted on the spot.

Aliases come from `extract/aliases.ts`, which scans docker-compose, k8s manifests, and Dockerfile labels.

## Atomicity

Promotion is atomic per FrontierNode. When a FrontierNode is selected:

1. All incident edges (inbound + outbound) are rewired to the typed-node id via `rewireFrontierEdges`.
2. The FrontierNode is dropped via `graph.dropNode(frontierId)`.

There is no point at which a partial state is visible. ADR-030 §9 atomicity applies.

## Edge rewrite

`rewireFrontierEdges` walks `graph.inboundEdges(frontierId)` and `graph.outboundEdges(frontierId)`. For each, `rebuildEdge`:

1. Drops the old edge.
2. Constructs a new edge id under the typed-node endpoint via the canonical helper.
3. Adds the new edge with the rebuilt attributes — or merges into the existing edge if one is already present at the new id.

This is the only place in the codebase where an edge id changes — not because the edge content changed, but because one of its endpoints did.

## Provenance upgrade: FRONTIER → OBSERVED

When `rebuildEdge` is rewriting an edge whose provenance was `FRONTIER`, the new edge's provenance is `OBSERVED`. The reasoning: the call certainty was always there (the OTel span was observed), only the target identity was unknown. Now it's known, so the edge graduates from placeholder to direct measurement.

Other provenance values pass through unchanged:
- EXTRACTED stays EXTRACTED (rare — FrontierNodes typically have only OTel-source edges, but possible in mixed cases).
- INFERRED stays INFERRED (also rare).
- FRONTIER → OBSERVED is the load-bearing case.

## Edge id construction (binding — and a current violation)

`rebuildEdge` MUST construct the new edge id via the canonical helpers from `@neat.is/types/identity` (ADR-029):

```ts
const newId =
  promotedProvenance === Provenance.OBSERVED ? observedEdgeId(newSource, newTarget, edge.type) :
  promotedProvenance === Provenance.INFERRED ? inferredEdgeId(newSource, newTarget, edge.type) :
  promotedProvenance === Provenance.EXTRACTED ? extractedEdgeId(newSource, newTarget, edge.type) :
  frontierEdgeId(newSource, newTarget, edge.type)
```

**Today `ingest.ts:463` hand-rolls the id**:

```ts
// CURRENT — contract violation
const newId = `${edge.type}:${promotedProvenance}:${newSource}->${newTarget}`
```

The contracts.test.ts scan (provenance contract, ADR-029) didn't catch it because the literal interpolates the provenance variable rather than embedding `:OBSERVED:` directly. The scan is extended in this batch to catch the variable-interpolation case. Fix is a v0.2.2 cleanup task: replace the literal with the dispatch above.

## Edge merge on collision

If the rewritten edge id already exists (because an OBSERVED edge between the typed source and target was previously created independently), the rebuilt edge merges into the existing one:

```ts
{ ...existing,
  callCount: (existing.callCount ?? 0) + (edge.callCount ?? 0),
  lastObserved: pickLater(existing.lastObserved, edge.lastObserved) }
```

No duplicate edge is created.

## No reverse promotion

A typed node never reverts to a FrontierNode. If OTel later observes a peer that matches no known service, a *new* FrontierNode is created at a different host id; the previously-promoted typed node is unaffected.

## Authority

`promoteFrontierNodes` is owned by `ingest.ts` per ADR-030. Triggered by `extract/index.ts` and `watch.ts`. No other module calls it.

## Enforcement

`contracts.test.ts` includes:
- A live test asserting alias-matched FrontierNode is promoted, edges are rewired, FRONTIER provenance becomes OBSERVED on rebuilt edges (already exists from the lifecycle contract — extended here to also assert id construction routes through the canonical helpers).
- A new live test scanning for hand-rolled edge id template literals that include a variable-interpolated provenance segment (catches the `${edge.type}:${variable}:...` pattern in `rebuildEdge`).
- An `it.todo` keyed to the rebuildEdge-uses-canonical-helpers fix.

Full rationale and historical context: [ADR-035](../decisions.md#adr-035--frontiernode-promotion-contract).
