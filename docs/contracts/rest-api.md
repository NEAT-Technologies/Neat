---
name: rest-api
description: Routes dual-mount at /X and /projects/:project/X per ADR-026. JSON errors. Live graphology only — no graph.json reads at request time. Inbound bodies are Zod-validated.
governs:
  - "packages/core/src/api.ts"
adr: [ADR-040, ADR-026]
---

# REST API contract

Governs `packages/core/src/api.ts`.

## Dual-mount per ADR-026

Every route mounts at both `/X` and `/projects/:project/X`. `registerRoutes(scope, ctx)` is called twice with different scope prefixes. New routes use the helper from day one.

`:project` defaults to `'default'` when missing.

## Read-side endpoints (locked)

| Path | Returns |
|------|---------|
| `GET /health` | receiver health + project name |
| `GET /graph` | full snapshot (live graphology serialized) |
| `GET /graph/node/:id` | single node by id |
| `GET /graph/edges/:id` | outbound edges from a node |
| `GET /graph/dependencies/:nodeId?depth=N` | transitive outbound walk (#144 — default 3, max 10) |
| `GET /graph/blast-radius/:nodeId?depth=N` | BFS outbound (default 10, max 20) |
| `GET /graph/root-cause/:nodeId` | getRootCause result |
| `GET /graph/diff?against=path` | snapshot diff |
| `GET /search?q=...` | semantic search via ADR-025 embedder chain |
| `GET /incidents` | recent ErrorEvents |
| `GET /stale-events` | recent STALE transitions |
| `GET /policies` | parsed `policy.json` (v0.2.4 #117) |
| `GET /policies/violations` | current violations, filterable by `?severity=` and `?policyId=` (v0.2.4) |

## Write-side endpoints

| Path | Effect |
|------|--------|
| `POST /graph/scan` | re-runs static-extraction pass |
| `POST /policies/check` | dry-run policy evaluation; body `{ hypotheticalAction }` (v0.2.4) |

The OTLP receiver lives on its own port (`:4318`) — not part of the REST API.

## Error responses

JSON shape: `{ error: string, status: number, details?: unknown }`. `400` for bad input / Zod failure, `404` for missing resource, `500` for schema violation. No HTML pages.

## Schema validation

Every `app.post` body parses via Zod schemas from `@neat.is/types`. Failure → 400 with the Zod error in `details`.

## Live graphology, never `graph.json`

Every read endpoint reads `proj.graph` (live in-memory). Already enforced by Rule 6.

## Authority

Mostly read-only. Two write-side endpoints (`/graph/scan`, `/policies/check`) trigger producers but don't mutate the graph directly.

Full rationale: [ADR-040](../decisions.md#adr-040--rest-api-contract).
