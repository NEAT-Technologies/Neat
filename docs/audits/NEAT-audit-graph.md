# NEAT Graph Audit — MVP (TypeScript v0.1.x)
## Load this before touching any graph-related code.

**Scope:** This audit covers the TypeScript MVP only — `packages/core` in the monorepo at `github.com/NEAT-Technologies/Neat`. It does not apply to the Rust v1.0. Items marked `[v1.0]` are noted for awareness only — do not build them here and do not let the agent drift toward them.

**Stack:** graphology DirectedGraph, native tree-sitter bindings, OpenTelemetry Node.js SDK, Fastify REST API, pnpm monorepo.

**What is not in scope for this audit:**
- Memgraph, Neo4j, or any external graph database — v1.0 only
- NeatScript VM or query language — v1.0 only
- Salsa incremental computation — v1.0 only
- CRDT cloud sync — v1.0 only
- Firecracker sandbox — v1.0 only
- Autonomous remediation pipeline — v1.0 only

---

## What the graph must be — MVP

The graph is a live, continuously mutating, in-memory semantic model of a software system. It is not a file. It is not a snapshot. It is not a cache of graph.json. It is a graphology DirectedGraph instance that is the single source of truth for the entire platform at runtime.

Every other component in the MVP — the Fastify REST API, the MCP server, the traversal functions in traverse.ts — must query this live instance directly. Nothing reads graph.json at query time except on startup load.

MVP persistence is graph.json only. Written on shutdown and every 60 seconds as a background interval. Loaded on startup if it exists. That is the complete persistence story for the MVP.

---

## The contract

### 1. Singleton — MVP

There must be exactly one graphology DirectedGraph instance per project scope. Created once at startup. Mutated in place. Never replaced.

**Verify:**
- Is the graph exported as a module-level singleton from `graph.ts`?
- Is `new DirectedGraph()` called anywhere except the singleton initialisation? If yes, this is a critical gap.
- Is the graph ever reassigned or replaced mid-session rather than mutated?

### 2. Node types — MVP

The MVP graph must support these node types:

- `ServiceNode` — a running service
- `DatabaseNode` — a database. Has: name, engine, engineVersion, compatibleDrivers
- `ConfigNode` — a config file. Has: name, path, fileType
- `InfraNode` — infrastructure node derived from docker-compose, k8s, Terraform

`[v1.0]` UserNode, PolicyNode, AgentNode are not MVP scope.

**Verify:**
- Are all node types validated against a shared enum or Zod schema from `@neat/types` on insertion?
- Is `pgDriverVersion` still present on ServiceNode and still being read by traversal code? It was marked deprecated. If traversal or root cause logic still special-cases it, that is debt.
- Are there any node types in the codebase not in this list?

### 3. Edge types — MVP

- `CALLS` — service A calls service B
- `DEPENDS_ON` — static import or package dependency
- `CONNECTS_TO` — service connects to a database
- `CONFIGURED_BY` — service reads from a config node

**Verify:**
- Is edge type validated on insertion?
- Are there any edge type strings in the codebase not from a shared const?
- Are there edges being created without a type field?

### 4. Provenance — the most important contract in the MVP

Every edge must carry a `provenance` field. This is non-negotiable. The valid values are:

```
EXTRACTED | INFERRED | OBSERVED | STALE | FRONTIER
```

**EXTRACTED** — found by tree-sitter in source code or config. No timestamp. Does not decay.

**INFERRED** — derived by the trace stitcher. Must carry `confidence: number` between 0.0 and 1.0. Must never be created from traversal depth greater than 2 hops from the originating error span. The 0.6 default documented in PROVENANCE.md must match what the code produces.

**OBSERVED** — directly measured from a live OTel span. Must carry `lastObserved: string` (ISO8601) and `callCount: number`. Never created without both fields.

**STALE** — transitioned from OBSERVED only, never created directly. Carries the `lastObserved` timestamp of the final observation.

**FRONTIER** — MVP: acceptable as a provenance value on edges. `[v1.0]` Full FrontierNode type is Rust v1.0.

**Verify:**
- Is `Provenance` a shared const or enum in `@neat/types` or are raw strings used?
- Is there any code path that creates an edge without a `provenance` field?
- Does every INFERRED edge have a `confidence` field?
- Does every OBSERVED edge have `lastObserved` and `callCount`?
- Is STALE ever created directly rather than transitioned from OBSERVED?
- Does the trace stitcher enforce the depth-2 limit? Find the actual depth check in the code.

### 5. Staleness — MVP

OBSERVED edges decay to STALE when not seen within 24 hours. This must be a background process, not a read-time computation.

`[v1.0]` Per-edge-type staleness thresholds are v1.0 even if mentioned in release notes.

**Verify:**
- Is there a `setInterval` or equivalent background job that transitions OBSERVED → STALE?
- Or is staleness computed at read time in the REST API or MCP tools? If yes, this is a gap.
- When an edge transitions to STALE, is `lastObserved` preserved?
- Is the 24-hour threshold hardcoded or configurable?

### 6. Persistence — MVP

**Verify:**
- On startup: does the code load graph.json into the live graphology instance before serving requests?
- On shutdown: does the code serialise the live instance to graph.json?
- Is there a background serialisation interval?
- Does `GET /graph` return data from the live graphology instance or from graph.json? Must be live.
- Is `readFileSync('graph.json')` called anywhere except the startup load? If yes, critical gap.

### 7. Edge upsert semantics — MVP

One edge between any pair of nodes with one edge type. When OTel confirms a relationship already in the graph as EXTRACTED, upgrade the edge — do not duplicate it.

**Verify:**
- Is there an upsert function in `ingest.ts` that checks for an existing edge before creating?
- If EXTRACTED exists and OTel confirms the same relationship, does the code upgrade to OBSERVED or create a duplicate?
- What is the traversal priority rule when multiple edges exist? OBSERVED must beat EXTRACTED must beat INFERRED.

### 8. Multi-project scoping — MVP

**Verify:**
- Is there a project registry mapping project names to graph instances?
- Can a query without a project argument contaminate another project's graph?
- Does `neat init` for a new project create an isolated graphology instance?

### 9. Concurrent access — MVP

**Verify:**
- Is graph mutation in `ingest.ts` synchronous within each span processing call?
- Is there any async gap during mutation where a concurrent read could see partial state?

---

## Red flags

- `new DirectedGraph()` called anywhere except singleton init in `graph.ts`
- `readFileSync('graph.json')` anywhere except startup load
- Raw strings like `'OBSERVED'` instead of `Provenance.OBSERVED` from `@neat/types`
- Edge creation without a `provenance` field
- INFERRED edges without `confidence`
- OBSERVED edges without `lastObserved` or `callCount`
- Staleness computed in the REST API handler rather than as a background transition
- Two edges between the same pair of nodes with the same edge type
- `pgDriverVersion` still special-cased in traversal or root cause logic

---

## Five questions — answer these before closing the audit

1. Is `new DirectedGraph()` called only once per project scope?
2. Does `GET /graph` read from the live graphology instance or from graph.json?
3. Is staleness a background transition or a read-time computation?
4. When an EXTRACTED edge is later confirmed by OTel, does the code upgrade or duplicate?
5. Does every INFERRED edge have a `confidence` field between 0.0 and 1.0?

---

*MVP only. Do not build Memgraph, NeatScript, Salsa, CRDT, or Firecracker. Those are Rust v1.0.*
