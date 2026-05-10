---
name: divergence-query
description: The thesis surface. get_divergences as a first-class graph operation across REST, MCP, CLI. Five divergence types, read-only, derived (not persisted). Amends ADR-039 + ADR-050 locked allowlists.
governs:
  - "packages/types/src/divergence.ts"
  - "packages/core/src/divergences.ts"
  - "packages/core/src/api.ts"
  - "packages/core/src/cli.ts"
  - "packages/core/src/cli-client.ts"
  - "packages/mcp/src/index.ts"
adr: [ADR-060, ADR-029, ADR-039, ADR-050, ADR-027]
---

# Divergence query contract

The synthesis. Every layer in the v0.2.x sequence was building toward this query, and we waited until the end to string it all together. The data layer locked. Static extraction locked. OTel ingest locked. The coexistence rule kept EXTRACTED and OBSERVED legible as separate edges. Traversal walked them. MCP, REST, and CLI surfaces exposed each piece. ADR-027 named the thesis — *"MVP success = closing a real PR on an open-source codebase, where the OBSERVED layer was load-bearing."*

This contract is the one query that says *"here is where what the code claims and what production observes don't match,"* sorted, recommended, ready for the operator to act on.

## Why this is its own contract

`get_divergences` could have been one more tool added to ADR-039's MCP surface and ADR-050's CLI surface as a quiet sub-bullet. It isn't, because:

1. It amends two locked allowlists (ADR-039 nine→ten, ADR-050 nine→ten). The amendments are explicit, not quiet drift.
2. It introduces a new schema (`Divergence`) with five variants — schema growth that warrants its own surface in `@neat.is/types`.
3. The compute logic (`packages/core/src/divergences.ts`) is its own module, with its own rules per divergence type.
4. The thesis-surface framing is itself binding: future contributors should know this query is what NEAT is *for*, not just one read endpoint among many.

## The five divergence types (locked)

Computed against the live graph at request time. No persistence; pure derivation. New types require a successor ADR.

| Type | Detection | Confidence |
|---|---|---|
| `missing-observed` | EXTRACTED edge exists; no OBSERVED edge for the same `(source, target, edgeType)` triple | `1.0` if any traffic observed on source else `0.5` |
| `missing-extracted` | OBSERVED edge exists; no EXTRACTED edge for the same triple | cascaded from OBSERVED edge confidence |
| `version-mismatch` | ServiceNode has declared dependency version; OBSERVED edge to a DatabaseNode (or similar) with incompatible engineVersion per compat.json | `1.0` (compat rule definitive) |
| `host-mismatch` | EXTRACTED CONFIGURED_BY edge points at a config declaring host X; OBSERVED CONNECTS_TO target's host is Y | cascaded from CONNECTS_TO confidence |
| `compat-violation` | Any compat.json rule fires against an OBSERVED edge (broader than version mismatch) | rule-determined |

## Result shape

```ts
DivergenceResult = {
  divergences: Divergence[]      // sorted by confidence desc
  totalAffected: number          // === divergences.length
  computedAt: string             // ISO8601
}

Divergence = (one of five variants, discriminated by `type`)
```

Each `Divergence` carries `source`, `target`, `confidence`, `reason` (human-readable), `recommendation` (human-readable, what to do about it). The type-specific variants carry additional fields (`extracted` edge, `observed` edge, `extractedVersion`, etc.).

## Three surfaces, one query

### REST

```
GET /graph/divergences
GET /projects/:project/graph/divergences
```

Query params: `type=missing-observed,missing-extracted`, `minConfidence=0.6`, `node=service:checkout`.

Returns `DivergenceResult`. JSON error envelope per ADR-040.

### MCP tool

`get_divergences` — **tenth tool**, amends ADR-039's locked allowlist of nine. Tool description (binding documentation per ADR-039):

> *"Returns places where what the code declares (EXTRACTED) doesn't match what production observed (OBSERVED). The single most NEAT-shaped query — the one that justifies the whole graph. Use when the user asks 'is anything weird?' or 'what does production do that the code doesn't?' or 'find me a bug' on an unfamiliar codebase. Returns divergences ranked by confidence × severity. Prefer this over `get_root_cause` when no specific node is failing."*

Three-part response per ADR-039: NL summary + structured `DivergenceResult` + footer (`confidence: <max> · provenance: composite (EXTRACTED + OBSERVED)`).

### CLI verb

`neat divergences` — **tenth verb**, amends ADR-050's locked allowlist of nine. Flags:

- `--type <type[,type]>` — filter by type
- `--min-confidence <float>` — filter by minimum confidence (0.0-1.0)
- `--node <id>` — scope to divergences involving a specific node
- `--json` — machine-readable output per ADR-050 rule 3
- `--project <name>` — project scoping per ADR-026

Default human output: prose summary + plain-text table of divergences sorted by confidence + provenance footer.

## Binding rules

### 1. Read-only

`get_divergences` observes; it does not mutate. No "acknowledge", "dismiss", "snooze" — divergences are derived from the graph; fix the graph (close the EXTRACTED gap, etc.) and they disappear.

### 2. Derived, not persisted

No `divergences.ndjson` sidecar. Each query computes fresh against the live graph. If the user wants history, they diff snapshots (the existing ADR-041 mechanism handles this).

### 3. Schema lives in `@neat.is/types`

`DivergenceSchema` (the discriminated union) and `DivergenceResultSchema` are exported from `@neat.is/types`. Consumers validate query results at the boundary. Schema growth per ADR-031 — `schema-snapshot.test.ts` catches the addition.

### 4. Computation is pure

`packages/core/src/divergences.ts` exports `computeDivergences(graph: NeatGraph, opts?: DivergenceQueryOpts): DivergenceResult`. Pure function: no I/O, no mutation, no async. Operates entirely on the in-memory graph reference.

### 5. Sorted by confidence

Default order is `confidence` descending. Consumer can re-sort. No type-specific severity weights in the contract.

### 6. Allowlist amendments are explicit

This contract amends ADR-039 (nine→ten MCP tools) and ADR-050 (nine→ten CLI verbs). The amendments are recorded in ADR-060's "Amendments to prior contracts" section. The original ADRs stay frozen; the contract test scans update to include `get_divergences` / `neat divergences` in the allowlist.

### 7. Frontend integration is out of scope here

The frontend surfaces for this query are real and several — `/divergences` page, GraphCanvas annotation, Rail entry, Inspector tab, StatusBar count — but they belong to Jed's v0.3.0 track. Captured separately at `docs/frontend-divergence-suggestions.md` as recommendations, not bindings.

## Authority

- **Schema:** `packages/types/src/divergence.ts` — new file
- **Computation:** `packages/core/src/divergences.ts` — new file, pure
- **REST surface:** `packages/core/src/api.ts` — add `GET /graph/divergences`, dual-mounted per ADR-026
- **MCP surface:** `packages/mcp/src/index.ts` — register tenth tool, route via REST client
- **CLI surface:** `packages/core/src/cli.ts` + `packages/core/src/cli-client.ts` — register tenth verb, plumb through

## Enforcement

`it.todo` block in `contracts.test.ts` for ADR-060:

- `DivergenceSchema` exists in `@neat.is/types` with the five-variant discriminated union; each variant parses cleanly with valid fixture data.
- `DivergenceResultSchema` exists and validates the wrapped result shape.
- `GET /graph/divergences` is registered and dual-mounted per ADR-026 (both `/graph/divergences` and `/projects/:project/graph/divergences`).
- `get_divergences` is registered as the tenth MCP tool — amends the ADR-039 allowlist scan.
- `neat divergences` is registered as the tenth CLI verb — amends the ADR-050 allowlist scan.
- For each of the five divergence types: a fixture graph triggers the type; the query returns the expected divergence with correct discriminator + schema fields.
- Read-only: `divergences.ts` contains no graph mutation calls (mutation-authority scan extended to cover this file).
- Filtering: `?type=`, `?minConfidence=`, `?node=` each narrow the result correctly.
- Default sort: results returned in `confidence` descending.

Full rationale: [ADR-060](../decisions.md#adr-060--get_divergences---the-thesis-surface).
