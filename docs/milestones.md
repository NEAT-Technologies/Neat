# Milestones

Source of truth for sprint status. Update this file at the end of every session.

| Status        | Meaning                                                |
|---------------|--------------------------------------------------------|
| NOT_STARTED   | No code written.                                       |
| IN_PROGRESS   | Some PRs open or merged, gate not yet green.           |
| VERIFIED      | Every box in the verification gate ticked, on a date.  |

---

## 🚩 Pick up here

**Last session ended:** 2026-05-01, M0–M4 all VERIFIED, M5 VERIFIED.

**Next session is M6 — Demo on Railway.** The M5 branch carries the M3 trace-stitcher bring-along (the manual pg span workaround in `demo/service-b/index.js` is gone — root-cause now leans on the stitcher's INFERRED CONNECTS_TO edge), so any leftover M2/M3 verification re-runs should expect that shape. M6 needs the demo reproducible without running docker-compose locally: Railway config, env templates, a runbook, and a quickstart README at the repo root.

### M3 work order

1. `#10` **`getRootCause`** in a new `packages/core/src/traverse.ts`. Walks incoming edges from the error node depth-first up to depth 5, prefers OBSERVED → INFERRED → EXTRACTED at each step, calls `checkCompatibility` at each `ServiceNode` against the target `DatabaseNode`, returns `RootCauseResult` (the type already exists in `@neat/types`). Confidence cascades by edge provenance: 1.0 all-OBSERVED, 0.7 any-INFERRED, 0.5 any-EXTRACTED-only. The verification target is `getRootCause("database:payments-db")` returning the pg-driver incompatibility with path `["database:payments-db", "service:service-b", "service:service-a"]`.
2. `#11` **`getBlastRadius`** in the same `traverse.ts`. Outgoing edges, depth 10, distance + path per affected node. Uses `graphology-shortest-path` (already a dep). `BlastRadiusResult` type ready in `@neat/types`.
3. `#12` **REST routes** for both — `GET /traverse/root-cause/:nodeId` and `GET /traverse/blast-radius/:nodeId`. Wire into `api.ts` next to `/graph` + `/incidents`.
4. **Trace stitcher** (no issue yet — open one). When a span has `statusCode === 2`, walk the static graph from `service:<service>` along EXTRACTED edges depth ≤ 2 and write INFERRED edges (`${type}:INFERRED:...` id pattern by analogy with the OBSERVED one) with `confidence: 0.6` and `lastObserved` set. This is the systems fix for the pg 7.4.0 instrumentation gap (ADR-014). Once it's writing INFERRED `CONNECTS_TO`, delete the `tracedQuery` workaround in `demo/service-b/index.js` and the `@opentelemetry/api` dep in its `package.json`, and re-run the M2 gate.

### M4 work order

`#13` (`@neat/mcp` scaffold) is already merged — stubs exist. Each tool calls into core over HTTP using the routes above plus the existing `/graph`, `/incidents`, `/search`. Suggested order:

1. `#14` `get_root_cause` (critical-path for the demo)
2. `#15` `get_blast_radius`
3. `#16` `get_dependencies`
4. `#17` `get_observed_dependencies`
5. `#18` `get_incident_history`
6. `#19` `semantic_search` (keyword-only stub per the issue label `post-mvp-enhance`)
7. `#20` `mcp/CLAUDE.md` + `skill.md`

### Project-management cleanup carried over

- Manually close GitHub issues for the merged M0/M1/M2 work: M0 — #1, #2, #3, #13, #24, #27; M1 — #4, #5, #6, #9; M2 — #7, #8, #21, #22, #23. (Per ADR-005 the user closes by hand after gate verification.)
- Relabel dashboard issues #28–#31 as `post-mvp-enhance` and remove them from milestone M5 (per ADR-004). Still pending from before M2.

### Gotchas a fresh session will benefit from

- **OBSERVED edges live alongside EXTRACTED ones**, not on top. Edge ids: EXTRACTED `${type}:${source}->${target}` (current ADR-010), OBSERVED `${type}:OBSERVED:${source}->${target}`. INFERRED should follow the same shape: `${type}:INFERRED:${source}->${target}`. The graph is a `MultiDirectedGraph`, so multiple edges between the same pair coexist by design — traversal picks per provenance preference, doesn't need to dedup.
- **`/incidents` reads from `errors.ndjson`**, written by `ingest.handleSpan` (see `packages/core/src/ingest.ts`). It's a flat append log keyed by `traceId:spanId`. M3 root-cause should accept an optional `errorEvent` argument and pass it through to colour the result (the M3 issue body asks for this).
- **Manual pg span in service-b is debt.** `demo/service-b/index.js` hand-rolls a span around `pool.query` because `@opentelemetry/instrumentation-pg` doesn't speak pg < 8. ADR-014 + the bring-along note under M3 below say exactly what to delete once the trace stitcher writes INFERRED CONNECTS_TO. Don't generalise the workaround — it's a fixture.
- **Collector → core uses JSON, no compression.** `demo/collector/config.yaml` has `encoding: json` and `compression: none` on the `otlphttp/neat` exporter. The receiver in `packages/core/src/otel.ts` is plain Fastify JSON; if you want gzip support, the collector exporter is where to start, not core.
- **service-b connection timeout is 4s** (`connectionTimeoutMillis` in `Pool({...})`) so the SCRAM hang surfaces as a real error instead of waiting forever. Don't drop it without adding another timeout somewhere.
- **`docker compose up --build` is the M2 gate**, not unit tests. Same applies for M3: the unit tests catch traversal bugs but only the live demo proves the graph is being populated correctly. Always run a `for i in {1..10}; do curl localhost:3000/data; done` after a rebuild.
- **PR status as of handoff**: M2 runtime fixes are in PR #55 (`m2-runtime-fixes` → `main`). Verify it's merged before relying on the OBSERVED `CONNECTS_TO` edge being there — the four feature PRs (#50/#51/#52/#54) alone don't produce it, the runtime fixes do.

---

## M0 — Monorepo scaffolded, types defined, packages stubbed

**End state:** `npm install && npx turbo build test lint` green from a clean checkout. CI green on a pushed branch. Every `@neat/*` package builds (ESM + CJS + DTS). `import { ServiceNodeSchema } from '@neat/types'` resolves from any package.

**Status:** VERIFIED 2026-05-01.

**Issues / PRs:**

| Issue | Title                          | PR  | Status |
|-------|--------------------------------|-----|--------|
| #1    | Scaffold monorepo              | #33 | merged |
| #2    | Shared types (`@neat/types`)   | #34 | merged |
| #3    | Scaffold `@neat/core`          | #43 | merged (replaces closed #36) |
| #13   | Scaffold `@neat/mcp`           | #38 | merged |
| #27   | Scaffold `@neat/web`           | #39 | merged |
| #24   | CI workflow                    | #40 | merged |
| —     | pnpm → npm migration           | #37 | merged |

### M0 verification gate

- [x] `rm -rf node_modules packages/*/node_modules package-lock.json && npm install` clean
- [x] `npx turbo build` exits 0 across all packages
- [x] `npx turbo test` exits 0
- [x] `npx turbo lint` exits 0
- [x] `import { ServiceNodeSchema } from '@neat/types'` resolves from `@neat/core`
- [x] CI green on `main` (#40 merged, badge resolves)
- [x] All M0 PRs merged

---

## M1 — Static graph working

**End state:** `NEAT_SCAN_PATH=./demo npm run dev --workspace @neat/core` starts. `curl localhost:8080/graph` returns the right shape: a `ServiceNode` for `service-b` with `pgDriverVersion: "7.4.0"`, a `DatabaseNode` for `payments-db` with `engineVersion: "15"`, and a `DEPENDS_ON` edge tying them together. The compat unit test for `pg 7.4.0 / postgresql 15` returns `compatible: false`.

**Status:** VERIFIED 2026-05-01.

**Issues / PRs:**

| Issue | Title                                | PR  | Status |
|-------|--------------------------------------|-----|--------|
| #21   | Demo source files (partial)          | #41 | merged |
| #5    | Compat matrix                        | #44 | merged |
| #4    | tree-sitter AST extraction           | #45 | merged |
| #6    | Graph persistence                    | #46 | merged |
| #9    | REST API with Fastify (M1 routes)    | #47 | merged |

### M1 verification gate

- [x] `npm run dev --workspace @neat/core` starts with `NEAT_SCAN_PATH=./demo`
- [x] `curl localhost:8080/health` returns `{ uptime, nodeCount, edgeCount, lastUpdated }`
- [x] `curl localhost:8080/graph` returns ≥ 3 nodes and ≥ 2 edges (3 nodes, 2 edges on the demo)
- [x] In `/graph` response: `ServiceNode` for `service-b` has `pgDriverVersion: "7.4.0"` and an `incompatibilities[0]` entry naming pg 7.4.0 vs PG 15
- [x] In `/graph` response: `DatabaseNode` for `payments-db` has `engineVersion: "15"` and a `compatibleDrivers` entry for pg ≥ 8.0.0
- [x] `checkCompatibility('pg', '7.4.0', 'postgresql', '15')` → `{ compatible: false, ... }` (unit test in `packages/core/test/compat.test.ts`)
- [x] After SIGTERM, `neat-out/graph.json` exists and is valid JSON; restart loads it (smoked locally + covered by `persist.test.ts`)

---

## M2 — OTel layer working

**End state:** Demo services emit OTel spans. `core` receives them and writes `OBSERVED` edges into the graph with `confidence` and `lastObserved`. Stale detection demotes edges not seen in N seconds.

**Status:** VERIFIED 2026-05-01.

**Issues / PRs:**

| Issue | Title                              | PR(s)        | Status |
|-------|------------------------------------|--------------|--------|
| #22   | docker-compose stack               | #50          | merged |
| #23   | OTel collector config              | #51          | merged |
| #7    | OTel span receiver                 | #52          | merged |
| #8    | span → edge mapper                 | #53 → #54    | merged (#53 auto-closed when its base branch was deleted; reopened as #54) |
| —     | M2 runtime fixes (compression, manual pg span, pg timeout) | #55 | merged |

### M2 verification gate

- [x] `docker compose up --build` boots the five-service stack cleanly; all health checks pass within 30s
- [x] `curl localhost:3000/data` produces a 500 from the pg 7.4.0 / PG 15 mismatch; `service-b` logs the SCRAM-flavoured connection timeout
- [x] `docker compose logs otel-collector` shows spans flowing
- [x] After ~10 hits + 5s wait, `/graph` contains `CALLS:OBSERVED:service:service-a->service:service-b` with `callCount > 0`
- [x] After ~10 hits + 5s wait, `/graph` contains `CONNECTS_TO:OBSERVED:service:service-b->database:payments-db` with `callCount > 0`
- [x] `/incidents` returns the pg connection-timeout events attributed to `database:payments-db`
- [x] Stale detection: `markStaleEdges` covered in `packages/core/test/ingest.test.ts`; live demotion verified via shortened threshold in tests, not in the live demo

### M2 known debt

- `demo/service-b/index.js` hand-rolls a `pg.query` span because `@opentelemetry/instrumentation-pg` doesn't support pg < 8.x. Tracking ADR-014; deletion gated on M3 trace stitching. See M3 bring-along below.

---

## M3 — Traversal

**End state:** `getRootCause` and `getBlastRadius` traverse the live graph. `/traverse/*` REST routes work. INFERRED edges are populated by a trace stitcher so root-cause traversal can produce confidence-0.7 results in environments with patchy auto-instrumentation (the demo, today).

**Status:** VERIFIED 2026-05-01.

**Issues / PRs:**

| Issue | Title                          | PR  | Status |
|-------|--------------------------------|-----|--------|
| #10   | Root-cause traversal           | #57 | merged |
| #11   | Blast-radius traversal         | #58 | merged |
| #12   | Traverse routes                | #59 | merged |
| #60   | Trace stitcher (INFERRED)      | #61, #62 | merged |
| —     | Drop manual pg span in service-b (M3 bring-along) | M5 branch | merged with M5 |

### Suggested file layout

- `packages/core/src/traverse.ts` — `getRootCause(errorNodeId, errorEvent?)`, `getBlastRadius(nodeId, depth = 10)`. Helpers shared between the two (provenance-priority edge picker, depth-bounded BFS) live here.
- `packages/core/src/ingest.ts` — extend with `stitchTrace(span, ctx)` called from `handleSpan` when `statusCode === 2`. Walks the static graph and writes INFERRED edges. Reuses the existing `upsertObservedEdge` shape with a different id prefix (`${type}:INFERRED:...`) and `confidence: 0.6`.
- `packages/core/src/api.ts` — wire `GET /traverse/root-cause/:nodeId` (optional `?errorId=` to scope to a specific incident) and `GET /traverse/blast-radius/:nodeId`.

### Bring-along when M3 lands

- Once the stitcher is producing INFERRED `CONNECTS_TO` edges, **delete `tracedQuery` and the `@opentelemetry/api` import in `demo/service-b/index.js`** and drop the `@opentelemetry/api` dep in `demo/service-b/package.json`. Keep the `connectionTimeoutMillis: 4000` line — that's separate from the instrumentation gap; it's there because pg 7.4.0 hangs on SCRAM regardless of whether anyone's watching.
- Re-run the M2 verification gate. The OBSERVED CALLS stays. The OBSERVED CONNECTS_TO disappears, and an INFERRED CONNECTS_TO with confidence 0.6 should take its place. Update the M2 gate text above to reflect that `CONNECTS_TO` is INFERRED in the live demo.
- Verify `getRootCause("database:payments-db")` lands on `pgDriverVersion: "7.4.0"` with confidence 0.7 (one INFERRED hop).

**Bring along when M3 lands:**

- Implement the trace stitcher (see ADR-014). When an upstream span errors, walk the static graph from that service along EXTRACTED edges and write INFERRED edges with `confidence: 0.6`. This closes the gap the manual span in `demo/service-b/index.js` is currently filling.
- Once the stitcher is producing INFERRED `CONNECTS_TO` edges, **delete `tracedQuery` and the `@opentelemetry/api` import in `demo/service-b/index.js`**, drop the `@opentelemetry/api` dep in `demo/service-b/package.json`, and re-run M2's verification gate. CONNECTS_TO will be INFERRED rather than OBSERVED in the live demo; update the gate wording to match.

---

## M4 — MCP tools working against live graph

**End state:** Six MCP tools (`get_root_cause`, `get_blast_radius`, `get_dependencies`, `get_observed_dependencies`, `get_incident_history`, `semantic_search`) hit core over HTTP and return real results. Claude Code can connect, list six tools, and call them.

**Status:** VERIFIED 2026-05-01.

**Issues / PRs:**

| Issue | Title                          | PR  | Status |
|-------|--------------------------------|-----|--------|
| #14   | get_root_cause                 | #64 | merged |
| #15   | get_blast_radius               | #64 | merged |
| #16   | get_dependencies               | #64 | merged |
| #17   | get_observed_dependencies      | #64 | merged |
| #18   | get_incident_history           | #64 | merged |
| #19   | semantic_search (keyword stub) | #64 | merged |
| #20   | mcp CLAUDE.md + skill.md       | #64 | merged |

---

## M5 — General purpose

**End state:** Root-cause traversal works for any (driver, engine) pair the compat matrix knows about, not just pg/PostgreSQL. `neat init <path>` CLI builds a graph and writes a snapshot. yaml/env file extraction adds `ConfigNode`s and `CONFIGURED_BY` edges.

**Status:** VERIFIED 2026-05-01.

The GitHub M5 milestone on the issue tracker (#28–#31) is dashboard work; those issues should still be relabeled `post-mvp-enhance` per ADR-004 — they are not part of the MVP definition of M5.

### M5 verification gate

- [x] `getRootCause` is data-driven from `compat.json` — no driver hardcoded in `traverse.ts`.
- [x] Unit test proves a second failure scenario: `mysql2 1.7.0` against `mysql 8` returns the matching root cause + fix recommendation.
- [x] Demo extraction emits `config:service-b/db-config.yaml` (`ConfigNode`) plus a `CONFIGURED_BY` edge from `service:service-b`.
- [x] `node packages/core/dist/cli.cjs init ./demo` prints a node/edge summary and the pg-vs-PG-15 incompatibility, and writes `./demo/neat-out/graph.json`.
- [x] Workspace stays green: `npx turbo build test lint` passes (101 core tests, 17 mcp tests).
- [x] M3 bring-along honoured: `tracedQuery` and `@opentelemetry/api` removed from `demo/service-b`.

### Why these three pieces, not "a second running demo"

A second failing demo service (mysql2/mysql, mongoose/mongo) would prove the same thing the unit test proves — the compat-matrix-driven traversal works for non-pg pairs — at the cost of ~80 packages, a third Dockerfile, and another OTel wiring loop. The unit fixture is enough to demonstrate that the system is general-purpose; the live demo earns its complexity by being the one we ship to Railway in M6.

---

## M6 — Demo on Railway

**End state:** All demo services deployed; demo reproducible without running docker-compose locally.

**Status:** NOT_STARTED.

**Issues:** #25 (Railway), #26 (quickstart README).
