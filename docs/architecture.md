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

`packages/core/compat.json` — data file, not code. `compat.ts` looks up `(driver, driverVersion, engine, engineVersion)` and returns `{ compatible, reason, minDriverVersion }`. Adding a new (in)compatibility is a JSON edit, not a code change. Lands in M1 issue #5.
