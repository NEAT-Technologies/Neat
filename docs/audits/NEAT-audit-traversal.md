# NEAT Traversal Audit — MVP (TypeScript v0.1.x)
## Load this before touching traverse.ts or any code that calls getRootCause or getBlastRadius.

**Scope:** This audit covers `packages/core/src/traverse.ts` in the TypeScript MVP monorepo at `github.com/NEAT-Technologies/Neat`. It covers getRootCause, getBlastRadius, edge priority rules, confidence cascading, depth limits, and whether the algorithms work on unknown graphs.

**Stack:** graphology-traversal, graphology-shortest-path, semver, @neat.is/types schemas for RootCauseResult and BlastRadiusResult.

**The goal this audit serves:** Traversal is the intelligence layer. The graph and OTel give you data. Traversal is what turns that data into an answer. If edge priority is wrong, NEAT will prefer a stale guess over a confirmed observation. If confidence cascading is wrong, a high-confidence answer will be reported with a low score or vice versa. If depth limits are wrong, traversal on a large real-world graph will walk indefinitely. These failures are silent — they produce wrong answers, not errors.

**What is not in scope:**
- NeatScript traversal API — v1.0 only
- Differential dataflow — v1.0 only
- Autonomous remediation traversal — v1.0 only

---

## What traversal must do — MVP

Traversal turns the graph into answers. Two functions. Both must work on any graph NEAT has modelled — not just the 3-node demo graph.

**getRootCause** — given a node where an error surfaced, walk incoming edges to find the upstream cause. Return the cause, the path, and a confidence score that reflects how much of the path was confirmed by live traffic.

**getBlastRadius** — given any node, walk outgoing edges to find everything downstream. Return each affected node with its distance, path, and confidence.

Both functions must prefer OBSERVED edges over INFERRED over EXTRACTED. This is the edge priority rule. It is the most important semantic contract in the entire traversal layer.

---

## The contract

### 1. Edge priority rule — the most important contract

When multiple edges exist between two nodes — for example an EXTRACTED edge and an OBSERVED edge for the same relationship — traversal must always prefer the highest-trust provenance.

Priority order, highest to lowest:
```
OBSERVED > INFERRED > EXTRACTED > STALE
```

FRONTIER edges must not be traversed in getRootCause or getBlastRadius. FRONTIER represents unknown territory. Traversal must stay within the known graph.

**Verify:**
- Is there an explicit priority function or sort that orders edges by provenance before traversal?
- If two edges exist between service-b and payments-db — one EXTRACTED, one OBSERVED — does traversal use the OBSERVED edge?
- Are STALE edges traversed or skipped? They must be traversed (they represent a real relationship that was observed) but flagged in the result as stale.
- Are FRONTIER edges excluded from traversal?
- Is the priority rule applied at every hop — not just at the starting node?

### 2. Confidence cascading — MVP

The confidence score of a traversal result must reflect the weakest link in the path.

Rules:
- A path where all edges are OBSERVED → confidence: 1.0
- A path where any edge is INFERRED → confidence: min(0.7, inferred_edge.confidence)
- A path where any edge is EXTRACTED only → confidence: 0.5
- A path where any edge is STALE → confidence: 0.3
- A path with mixed provenances → confidence: minimum of all edge confidences in the path

The confidence cascades from the weakest edge in the path. A single INFERRED edge in a five-hop OBSERVED path drops the overall confidence to 0.7 or lower.

**Verify:**
- Is confidence computed from the weakest edge in the path — not from the final edge only?
- Is confidence a cascade of minimums — not an average?
- Does a single STALE edge in the path produce confidence ≤ 0.3?
- Is confidence included in RootCauseResult and in each node entry of BlastRadiusResult?
- Is the confidence calculation tested against a fixture graph with mixed provenances?

### 3. getRootCause — MVP

Algorithm:
1. Start at the error node
2. Walk incoming edges depth-first
3. At each upstream node, run `checkCompatibility` from compat.ts
4. If incompatibility found, return RootCauseResult with the full path and cascaded confidence
5. If depth limit reached with no incompatibility, return null

**Verify:**
- Is the traversal direction incoming — not outgoing? getRootCause walks backward through the dependency chain.
- Is graphology-traversal used or is there a hand-rolled DFS? Either is acceptable but hand-rolled must handle cycles.
- Is there cycle detection? A graph with a circular dependency will loop indefinitely without it.
- Is the depth limit enforced? What is it — 5 hops is the recommended default. Find the actual value in the code.
- When the starting node does not exist in the graph, does the function return null with a clear reason — not throw?
- Is `checkCompatibility` called at every upstream ServiceNode — not only the direct parent of the error node?
- Is the traversal general — does it start from any node passed in, not just `payments-db`?
- Does getRootCause use the live graphology instance or does it read graph.json?

### 4. getRootCause result — MVP

The result must conform to RootCauseResultSchema from @neat.is/types:

```typescript
{
  rootCauseNode:   string        // the node identified as the cause
  rootCauseReason: string        // human readable — what the incompatibility is
  traversalPath:   string[]      // array of node IDs from error surface to root cause
  edgeProvenances: Provenance[]  // one entry per edge in traversalPath
  confidence:      number        // 0.0-1.0, cascaded from weakest edge
}
```

**Verify:**
- Is `traversalPath` in order from error surface to root cause — not reversed?
- Is `edgeProvenances` the same length as `traversalPath` minus one (one provenance per edge, not per node)?
- Is `rootCauseReason` a human-readable string — not a raw compat.json entry?
- Does `rootCauseReason` include the specific version that is incompatible and why — not just "incompatibility detected"?
- Is the result validated against RootCauseResultSchema before being returned?

### 5. getBlastRadius — MVP

Algorithm:
1. Start at the origin node
2. Walk outgoing edges depth-first
3. For each downstream node, record its distance from the origin, its path, and the cascaded confidence of the path
4. Return all downstream nodes with their distances, paths, and confidences

**Verify:**
- Is the traversal direction outgoing — not incoming?
- Is there a depth limit? What is it — 10 hops is the recommended default. Find the actual value.
- Is there cycle detection?
- Does getBlastRadius use the live graphology instance?
- Is graphology-shortest-path used for path computation or is path tracking done manually during traversal?
- Is `totalAffected` the count of unique affected nodes — not the count of edges?
- Does it handle nodes with zero outgoing edges — returns `totalAffected: 0`, not an error?

### 6. getBlastRadius result — MVP

The result must conform to BlastRadiusResultSchema from @neat.is/types:

```typescript
{
  origin:        string
  affectedNodes: Array<{
    node:       string    // node ID
    distance:   number    // hops from origin, minimum 1
    path:       string[]  // node IDs from origin to this node
    confidence: number    // cascaded confidence of this path
  }>
  totalAffected: number
}
```

**Verify:**
- Is `distance` minimum 1 — not 0? Distance 0 would mean the origin itself is affected, which is meaningless.
- Is `path` populated for each affected node — not an empty array?
- Is `path` in order from origin to the affected node — not reversed?
- Is `confidence` per affected node — not a single confidence for the entire blast radius?
- Is `totalAffected` the count of `affectedNodes` — does it match the array length?

### 7. Cycle detection — MVP

Both getRootCause and getBlastRadius can encounter cycles in real production graphs. A service A that depends on service B that depends on service A. Without cycle detection, traversal loops indefinitely.

**Verify:**
- Is there a `visited` set or equivalent that tracks nodes already in the current traversal path?
- Does the traversal skip a node that is already in the visited set?
- Is cycle detection applied in both getRootCause and getBlastRadius?
- Is cycle detection tested against a fixture graph with a circular dependency?

### 8. General-purpose requirement — MVP

Traversal must work on any graph NEAT has modelled. Not just the demo graph.

The demo graph has 3 nodes and 2 edges. A real production graph might have 50 nodes and 200 edges. Traversal must not have any hardcoded assumptions about the demo graph.

**Verify:**
- Is there any hardcoded reference to `service-a`, `service-b`, `payments-db`, or any demo-specific name in traverse.ts?
- Does getRootCause work correctly when called with a node name it has never seen before? It must return null cleanly.
- Does getBlastRadius work correctly on a node with many outgoing edges — not just one or two?
- Is traversal tested against a fixture graph that is different from the demo scenario?

### 9. Performance on real graphs — MVP

The demo graph is tiny. A real graph is not. Traversal must not be catastrophically slow on a large graph.

**Verify:**
- Does getRootCause return in under 500ms on a graph with 100 nodes and 300 edges?
- Does getBlastRadius return in under 500ms on the same graph?
- Is graphology-traversal used rather than a hand-rolled BFS/DFS? graphology's built-in traversal is optimised for its internal data structures.
- Is there any N+1 pattern — fetching node attributes inside a loop that iterates edges? This will be slow on large graphs.

### 10. Integration with compat.ts — MVP

getRootCause depends on `checkCompatibility` from compat.ts. The integration must be correct.

**Verify:**
- Is `checkCompatibility` imported from compat.ts — not reimplemented in traverse.ts?
- Is it called with the correct arguments — driver name, driver version, engine name, engine version — not just version strings?
- Are driver name and engine name derived from node properties — not hardcoded to `pg` and `postgresql`?
- When `checkCompatibility` returns `{ compatible: false, reason }`, is `reason` used as `rootCauseReason` in the result?
- When `checkCompatibility` returns `{ compatible: true }`, does the traversal continue to the next upstream node rather than stopping?

### 11. STALE edge handling — MVP

STALE edges represent relationships that were observed but have not been confirmed recently. Traversal must handle them distinctly from OBSERVED edges.

**Verify:**
- Are STALE edges included in traversal or excluded? They must be included — they represent a real relationship.
- Does a STALE edge in the traversal path reduce confidence to 0.3 or lower?
- Is the STALE provenance surfaced in `edgeProvenances` in the traversal result?
- Does the MCP tool response communicate clearly when a traversal result contains STALE edges?

---

## Red flags

- No cycle detection — traversal will loop indefinitely on circular dependencies
- Depth limit not enforced or hardcoded to a very large number
- Confidence computed from the final edge only — not cascaded from the weakest edge
- getRootCause walking outgoing edges instead of incoming
- getBlastRadius walking incoming edges instead of outgoing
- FRONTIER edges included in traversal
- Hardcoded demo node names in traverse.ts
- `checkCompatibility` reimplemented in traverse.ts rather than imported from compat.ts
- `checkCompatibility` called with hardcoded `pg` and `postgresql` rather than reading from node properties
- graphology not used — hand-rolled DFS without proper cycle detection or performance optimisation
- RootCauseResult or BlastRadiusResult defined locally rather than from @neat.is/types
- `distance: 0` in BlastRadiusResult — minimum distance must be 1
- `traversalPath` and `edgeProvenances` arrays of mismatched length

---

## Five questions — answer these before closing the audit

1. Is the edge priority rule enforced at every hop — OBSERVED > INFERRED > EXTRACTED > STALE?
2. Is confidence cascaded from the weakest edge in the path — not averaged and not taken from the final edge?
3. Is cycle detection implemented in both getRootCause and getBlastRadius?
4. Is `checkCompatibility` called with general driver and engine names from node properties — not hardcoded to pg/postgresql?
5. Is there any hardcoded demo node name in traverse.ts?

---

*MVP only. NeatScript traversal API, differential dataflow, and autonomous remediation traversal are v1.0.*
