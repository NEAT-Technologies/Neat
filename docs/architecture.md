# Architecture

A pocket reference. The seed design doc has the full version; this file captures what someone resuming the build needs to know in one read.

## Layout

```
neat/
  packages/
    types/   shared Zod schemas + runtime constants. Zero @neat/* deps.
    core/    graph engine, tree-sitter extraction, OTel ingest, REST API.
    mcp/     stdio MCP server. Six tools mapped to core's traversal endpoints.
    web/     Next.js shell. Wordmark + /api/health. Dashboard is post-MVP.
  demo/
    service-a/   express + axios. Calls service-b. OTel-instrumented.
    service-b/   express + pg 7.4.0 + OTel. Talks to payments-db (PG 15).
                 db-config.yaml describes the connection target.
  docs/        architecture / milestones / runbook / decisions
  CLAUDE.md    repo-level agent guide
```

`demo/payments-db` exists only in `docker-compose.yml` (M2) — it's the `postgres:15-alpine` image, no source.

## Package boundaries

```
@neat/types  ← @neat/core  ← @neat/mcp
@neat/web                   (independent — talks to core over HTTP)
```

Direction matters. `@neat/types` never imports anything from `@neat/*`. `@neat/core` is the only place that depends on `graphology`, `tree-sitter`, `fastify`. `@neat/mcp` only knows about `@neat/types` plus the MCP SDK; it talks to core over HTTP, not by importing.

## Data flow

Static (M1):

```
demo/service-*/package.json + *.js
       ↓ (tree-sitter + JSON parse)
packages/core/src/extract.ts
       ↓ (emits ServiceNode / DatabaseNode / ConfigNode + EXTRACTED edges)
packages/core/src/graph.ts  (in-memory MultiDirectedGraph)
       ↓ (Fastify routes)
packages/core/src/api.ts → GET /graph, /graph/node/:id, /search, etc.
       ↓ (HTTP)
@neat/web /api/graph proxy   |   @neat/mcp tools (M3+)
```

Live (M2+):

```
demo services emit OTel spans
       ↓ OTLP/HTTP :4318
@opentelemetry/collector
       ↓ OTLP/HTTP :4318
core OTel receiver (packages/core/src/otel/*.ts — lands in M2)
       ↓ span → edge mapper
core graph: existing nodes get OBSERVED edges with confidence + lastObserved
       ↓ stale detection: edges not seen in N seconds → STALE
```

## Provenance lifecycle

Every edge carries a `provenance`:

| value      | meaning                                                                 |
|------------|-------------------------------------------------------------------------|
| EXTRACTED  | derived from source code or config files. The base layer.               |
| INFERRED   | computed from other edges (e.g. transitively). Cheap, not authoritative.|
| OBSERVED   | seen in production via OTel. The trustworthy layer.                     |
| STALE      | OBSERVED edges that haven't been seen in N seconds.                     |
| FRONTIER   | placeholder — known to exist (logs say so) but no node yet for the other end. |

The interesting AI-side queries (root-cause, blast-radius) prefer OBSERVED over EXTRACTED, then fall back. STALE never wins.

## Persistence

In-memory graph snapshots to `${NEAT_OUT_PATH:-./neat-out/graph.json}` on a 60s loop and on SIGTERM/SIGINT. Loaded on startup if the file exists. No database — the graph is small and the bottleneck is extraction, not storage.

## Compat matrix

`packages/core/compat.json` — data file, not code. `compat.ts` looks up `(driver, driverVersion, engine, engineVersion)` and returns `{ compatible, reason, minDriverVersion }`. Adding a new (in)compatibility is a JSON edit, not a code change.

The matrix carries a `minEngineVersion` field per pair — the driver constraint only fires once the engine is at that major or higher. So `pg 7.4.0 / postgresql 13` still passes (PG 13 doesn't require scram), `pg 7.4.0 / postgresql 14` fails.

`compatPairs()` is the second exported function — `extract.ts` iterates it to populate `DatabaseNode.compatibleDrivers`. So adding a new pair to `compat.json` automatically shows up on the right engine's `compatibleDrivers` list, no other code change required.

## M1 implementation notes

Things that aren't load-bearing decisions but are non-obvious from reading the code:

- **Node ids**: `service:<package.name>` for ServiceNodes, `database:<host>` for DatabaseNodes (host comes from `db-config.yaml`). Edge ids: `${type}:${source}->${target}`. The id format is the contract everything else (traversal in M3, MCP tools in M4) keys off, so don't change it casually.

- **Extract is three phases.** (1) Discover services from `package.json` files. (2) For each service, parse `db-config.yaml` if present → emit DatabaseNode + `CONNECTS_TO` edge + run compat check. (3) tree-sitter parse every JS/TS file in each service dir, collect string literals, look for URLs containing a known service hostname → emit `CALLS` edges (deduped per source). The function is idempotent — running it twice on the same path adds 0 nodes/edges.

- **tree-sitter scope is intentionally tiny.** It's a string-literal scan for URL substrings matching known hostnames, not a full import-graph analysis. Good enough to pick up `axios.get('http://service-b:3001/...')` and similar; doesn't catch dynamically constructed URLs or network calls hidden behind a config object. Worth revisiting only if a real demo case needs more.

- **Compat ignores garbage versions rather than erroring.** If `semver.coerce` can't make sense of a driver version string, `checkCompatibility` returns `{ compatible: true }`. Better to under-flag than to claim a known failure on input we can't reason about.

- **`pgDriverVersion` lives on ServiceNode AND in `incompatibilities[]`.** The first is for cheap UI/lookup ("what version is this service on?"), the second is the audit trail ("here's what specifically is wrong"). Both are populated during extract phase 2.

- **The yaml dependency is M1-scoped.** `db-config.yaml` is parsed today only because it's the cheapest path to `payments-db.engineVersion: "15"` for the demo. Full yaml/env extraction with first-class `ConfigNode` types and `CONFIGURED_BY` edges is M5. Don't expand the yaml parsing surface inside `extract.ts` — it goes to its own pass when M5 happens.

- **Persistence loads BEFORE extracts on startup.** OBSERVED edges (M2 onwards) won't be reproduced by static extraction — they have to survive a restart. Reorder this and you silently lose every runtime observation on every reboot.

- **Snapshots have a `schemaVersion: 1` envelope** wrapping the `graphology.export()` blob. Mismatched versions throw on load (no silent migration). When the graph shape changes incompatibly, bump the version and add a migration path here, not in the extract code.

- **JSON imports use `with { type: "json" }`** (Node 20+ import attribute). tsup bundles `compat.json` into the dist output. The `"files": ["dist", "compat.json"]` line in `packages/core/package.json` keeps it shipped if/when this package gets published.
