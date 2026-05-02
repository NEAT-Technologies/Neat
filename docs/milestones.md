# Milestones

Source of truth for sprint status. Update this file at the end of every session.

| Status        | Meaning                                                |
|---------------|--------------------------------------------------------|
| NOT_STARTED   | No code written.                                       |
| IN_PROGRESS   | Some PRs open or merged, gate not yet green.           |
| VERIFIED      | Every box in the verification gate ticked, on a date.  |

---

## 🚩 Pick up here

**Last session ended:** 2026-05-02. **v0.1.2-β is shipped on `main`.** All five β PRs merged in one sequence (#89/#90/#91/#92/#93). Workspace is green at HEAD: `npx turbo build test lint` clean, 132 core / 25 types / 17 mcp tests passing. Issues #69, #70, #71, #72, #73 still open — they get closed by hand after you spot-verify the merged work.

**Next session is v0.1.2-γ — graph correctness.** Confidence stops being a constant, compat grows beyond driver/engine pairs, FRONTIER nodes get populated, snapshot diffing lands. β gave γ a richer graph to reason about; γ's job is to make the reasoning sharper.

### γ work order (within v0.1.2-γ)

Branch each issue off the latest `main`. Keep PRs small; #76 will likely touch the edge schema, so co-ordinate snapshot bumps with #74.

1. **#75 — OBSERVED-edge attribution + FRONTIER population.** OBSERVED edges record nothing about *who* drove the traffic that produced them; FRONTIER nodes are reserved in the enum but never written. Both are pre-requisites for the rest of γ. Lives mostly in `packages/core/src/ingest.ts` (the trace stitcher knows when it's filling a hole — that's the FRONTIER signal).
2. **#77 — snapshot diffing endpoint + MCP tool.** `GET /graph/diff?since=<timestamp>` returns added/removed/changed nodes + edges relative to the named snapshot. Stand-alone — won't conflict with the schema work. The MCP side is a thin wrapper, parallel work.
3. **#74 — compat matrix beyond drivers** (Node engines, package conflicts, deprecated APIs). The matrix shape grows: today it's `{driver, engine, minDriverVersion, minEngineVersion}`; γ adds `{kind: "engine"|"package-conflict"|"deprecated-api"}` so traversal can ask "what kind of incompatibility?" Touches `compat.json` schema + `compat.ts`. Snapshot stays compatible if we keep all new fields optional.
4. **#76 — per-edge confidence signals** (span count, error rate, recency). Confidence today is one of `1.0 | 0.7 | 0.5 | 0.3`. γ replaces that with a continuous score derived from `callCount`, error rate, and `lastObserved` recency. The math lives in `packages/core/src/traverse.ts#confidenceFromMix`. Edge schema gains a few optional numeric fields — co-ordinate the snapshot bump with #74.
5. **#78 — per-edge-type stale thresholds + stale event log.** Today `markStaleEdges` uses one global threshold (24h). γ moves that to a per-edge-type config (`CALLS` stale faster than `CONNECTS_TO`, etc.) and writes a stale-event log so consumers can replay transitions. New ADR likely.

#75 + #77 first, in parallel — neither depends on the other and neither touches the schema. #74 next; #76 third (touches edge schema — co-ordinate snapshot bump with #74); #78 last.

### M6 manual verification — DEFERRED TO POST-δ

The two unchecked manual gates (live Railway deploy + Claude Code end-to-end against the deployed core) wait until γ + δ have also merged. Reasoning hasn't changed — see PR #87 + the M6 section below.

### Gotchas a fresh γ session will benefit from

- **β shipped a much richer graph.** `extract/` now has subdirs for every phase: `databases/{db-config-yaml,dotenv,prisma,drizzle,knex,ormconfig,typeorm,sequelize,docker-compose}`, `calls/{http,kafka,redis,aws,grpc}`, `infra/{docker-compose,dockerfile,terraform,k8s}`. Service discovery is recursive + workspace-aware + Python-capable. Same `extract/index.ts` orchestrator pattern — five phases, each returns `{nodesAdded, edgesAdded}`. Don't refactor that.
- **`extract/index.ts` is now a 5-phase orchestrator.** Phases: services → databases → configs → calls → infra. Adding a γ phase (e.g. confidence backfill) means writing the function and one line in the orchestrator.
- **Snapshot schema is still at v2.** Every β change was additive. Adding optional fields to existing schemas stays forward-compatible. Renaming or restructuring (e.g. flattening `incompatibilities`, repurposing `provenance`) bumps to v3 — add a v2→v3 migration in `loadGraphFromDisk` per ADR-019's pattern.
- **Compat is data-driven (ADR-015).** Driver/engine pairs live in `compat.json`. #74 generalises this — new `kind` field on each pair, plus probably new top-level shapes. Don't add per-kind code paths; let the matrix carry the data.
- **`.env` still records existence, not contents (ADR-016).** β's #70 reads `DATABASE_URL` etc. into transient `DbConfig`s for DB discovery — values never reach a `ConfigNode`. Don't blur this in γ; if #76's confidence math wants per-edge metadata, attach it to the edge, not to a config.
- **Edge evidence already exists.** #71 added optional `evidence: { file, line, snippet }` to `GraphEdgeSchema`. γ can extend it (e.g. `firstObservedAt`, `errorRate`) without restructuring.
- **EdgeType enum has 7 values now** (CALLS, DEPENDS_ON, CONNECTS_TO, CONFIGURED_BY, PUBLISHES_TO, CONSUMES_FROM, RUNS_ON). NodeType still 4 (the `infra:<kind>:<name>` taxonomy lives inside `InfraNode.kind`, not as new top-level node types — see #73's commit). Both `packages/types/test/schemas.test.ts` and any tests counting types will need an update if you grow either.
- **Demo extraction picks up Dockerfiles now.** `service:service-a` and `service:service-b` each emit a `RUNS_ON` edge to `infra:container-image:node:20-bookworm-slim`. Blast-radius from `service:service-a` is now 4 deep (was 3) and 2 at depth 1 (was 1). The api tests already reflect this — don't try to "fix" them back to the old numbers.
- **OTLP/gRPC is opt-in.** `NEAT_OTLP_GRPC=true` activates the listener (port `:4317`, override via `NEAT_OTLP_GRPC_PORT`). Default deployments are HTTP-only on `:4318`.
- **Manual pg span in service-b is gone.** Removed during M5; the trace stitcher fills the gap. Don't reintroduce one.
- **Branching convention unchanged.** One issue → one branch `<num>-<slug>` → one PR (`Refs #N`, not `Closes #N`). Plain-English commits, no `Co-Authored-By: Claude`. Branch off the latest `main` — γ PRs stack on β's merged work, not on each other.

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

**End state:** `NEAT_SCAN_PATH=./demo npm run dev --workspace @neat/core` starts. `curl localhost:8080/graph` returns the right shape: a `ServiceNode` for `service-b` with `dependencies.pg = "7.4.0"`, a `DatabaseNode` for `payments-db` with `engineVersion: "15"`, and a `DEPENDS_ON` edge tying them together. The compat unit test for `pg 7.4.0 / postgresql 15` returns `compatible: false`.

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
- [x] In `/graph` response: `ServiceNode` for `service-b` has `dependencies.pg = "7.4.0"` and an `incompatibilities[0]` entry naming pg 7.4.0 vs PG 15
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
- Verify `getRootCause("database:payments-db")` lands on service-b (`dependencies.pg = "7.4.0"`) with confidence 0.7 (one INFERRED hop).

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

**End state:** All demo services deployable to Railway from this repo without copying or transforming any source. Quickstart README at the repo root walks an unfamiliar developer through the local demo end-to-end. PROVENANCE.md documents the four-state edge model.

**Status:** IN_PROGRESS — all code, config, and runbook are in place. The live Railway deploy + Claude Code end-to-end check are now scheduled as **the closing gate of the v0.1.2 cycle**, run after v0.1.2-δ merges. Doing the deploy this late means the verification exercises every v0.1.2 deliverable (polyglot extraction from β, correctness signals from γ, the watch daemon / gRPC / multi-project work from δ) rather than re-proving the MVP. Flip M6 to VERIFIED once that Railway project is up and Claude Code confirms the root cause against the live instance.

**Issues / PRs:**

| Issue | Title                                | PR  | Status |
|-------|--------------------------------------|-----|--------|
| #26   | Local quickstart README              | M6 branch | open |
| #32   | PROVENANCE.md                        | M6 branch | open |
| #25   | Deploy demo to Railway               | M6 branch | open (config + runbook in this PR; deploy is a manual follow-up) |

### M6 verification gate

- [x] `README.md` walks a fresh developer from clone to "Why is payments-db failing?" in Claude Code.
- [x] `PROVENANCE.md` exists, covers the four states + confidence cascade, linked from README.md and `packages/mcp/skill.md`.
- [x] `docs/railway.md` is a runnable deploy guide for all six services + the Postgres plugin, with concrete env values.
- [x] `demo/collector/Dockerfile` lets the collector run on Railway (which can't volume-mount `config.yaml`); `demo/collector/config.railway.yaml` carries the Railway-flavoured collector config.
- [ ] **Manual (post-v0.1.2-δ):** a Railway deploy following the guide produces a public service-a domain that responds to `/data`, a public neat-core domain whose `/graph` shows OBSERVED CALLS + INFERRED CONNECTS_TO edges, and a public neat-web domain. Run after every v0.1.2 PR has merged, not before — that way the deploy proves the polyglot extraction, correctness signals, and ergonomics work end to end on a real server.
- [ ] **Manual (post-v0.1.2-δ):** `claude mcp add neat -- node packages/mcp/dist/index.cjs` with `NEAT_CORE_URL` pointing at the deployed core; Claude Code answers "Why is payments-db failing?" with confidence ≥ 0.7. Bonus: pose a polyglot question (e.g. about a Python service from #72) to confirm the v0.1.2 surface area also works through the live MCP path.

---

## v0.1.2-α — Foundations

**End state:** legacy `pgDriverVersion` schema field removed (forward-compatible snapshot migration v1→v2). `extract.ts` split into per-source modules under `packages/core/src/extract/` — orchestrator is 27 lines, each phase independently importable. OTLP/gRPC receiver opt-in via `NEAT_OTLP_GRPC=true`. Workspace stays green.

**Status:** VERIFIED 2026-05-02.

**Issues / PRs:**

| Issue | Title                                                | PR  | Status |
|-------|------------------------------------------------------|-----|--------|
| #67   | Drop pgDriverVersion from ServiceNode (schema migration) | #84 | merged |
| #68   | Split extract.ts into per-source-type modules        | #85 | merged |
| #80   | OTLP/gRPC receiver alongside HTTP                    | #86 | merged |
| —     | Reschedule M6 manual gates to end of v0.1.2          | #87 | merged |

### α verification gate

- [x] `npx turbo build test lint` clean across all four packages (104 core tests / 25 types tests / 17 mcp tests).
- [x] `pgDriverVersion` appears in zero source files outside the migration code + its test.
- [x] `loadGraphFromDisk` migrates a synthesised v1 snapshot in place (covered by `persist.test.ts`).
- [x] `node packages/core/dist/cli.cjs init ./demo` produces a `schemaVersion: 2` snapshot with the same node/edge counts as before.
- [x] `packages/core/src/extract.ts` is a one-line re-export; phases live under `packages/core/src/extract/{services,databases,configs,calls,shared,index}.ts`. Orchestrator (`extract/index.ts`) is ≤ 80 lines.
- [x] Three new gRPC tests (`otel-grpc.test.ts`) round-trip through a real `@grpc/grpc-js` client/server pair on an ephemeral port. With `NEAT_OTLP_GRPC` unset the gRPC port stays closed.
- [x] ADR-019 (drop `pgDriverVersion`, snapshot v2) and ADR-020 (bundle OTLP protos in-tree, gRPC opt-in) added to `docs/decisions.md`.

---

## v0.1.2-β — Extraction breadth

**End state:** the graph stops being JS-and-pg-shaped. Recursive workspace discovery, generalised DB discovery beyond `db-config.yaml`, calls beyond HTTP URL substrings, Python service extraction, infrastructure files as first-class nodes. NEAT can `init` a polyglot multi-service repo and produce a credible graph.

**Status:** VERIFIED 2026-05-02.

**Issues / PRs:**

| Issue | Title                                                       | PR  | Status |
|-------|-------------------------------------------------------------|-----|--------|
| #69   | Recursive service discovery with workspace support          | #89 | merged |
| #70   | Generalised database discovery (.env, ORM configs, docker-compose) | #90 | merged |
| #71   | Call extraction beyond HTTP URL substrings (gRPC, Kafka, Redis, AWS SDK) | #91 | merged |
| #72   | Python service extraction                                   | #92 | merged |
| #73   | Infrastructure extraction (docker-compose, Dockerfile, Terraform, k8s) | #93 | merged |

### β verification gate

- [x] Demo extraction still produces the headline pg-vs-PG-15 incompatibility — service-b / pg 7.4.0 / postgresql 15. Node and edge counts grew (Dockerfile parsing adds an `infra:container-image:node:20-bookworm-slim` node + RUNS_ON edges from each service) but every M1 assertion still holds.
- [x] Polyglot fixture lives at `packages/core/test/fixtures/python/` (Python services with `requirements.txt` + `pyproject.toml`) plus per-extractor fixtures under `fixtures/db/`, `fixtures/calls/`, `fixtures/infra/`. Each is asserted in its own test file.
- [x] `.env` parsing reads `DATABASE_URL` & friends into transient `DbConfig`s only; `ConfigNode` shape is unchanged. ADR-016 holds.
- [x] Snapshot stays at v2. Every schema change was additive: `EdgeType` grew `PUBLISHES_TO` / `CONSUMES_FROM` / `RUNS_ON`; `GraphEdgeSchema` got optional `evidence`; `InfraNodeSchema` got optional `kind`. No migration needed.
- [x] Workspace stays green: `npx turbo build test lint` clean (132 core / 25 types / 17 mcp tests).

---

## v0.1.2-γ — Graph correctness

**End state:** confidence is a real signal, not a constant. Compat covers more than (driver, engine) pairs. FRONTIER nodes get populated. Snapshot diffing answers "what changed?".

**Status:** NOT_STARTED.

| Issue | Title |
|-------|-------|
| #74   | Compat matrix beyond drivers (Node engines, package conflicts, deprecated APIs) |
| #75   | OBSERVED-edge attribution and FRONTIER node population |
| #76   | Per-edge confidence signals (span count, error rate, recency) |
| #77   | Snapshot diffing endpoint and MCP tool |
| #78   | Per-edge-type stale thresholds + stale event log |

---

## v0.1.2-δ — Ergonomics

**End state:** the daily-use surface is pleasant. `neat watch` re-extracts on save. MCP exposes Resources for graph nodes and the incident stream. Real semantic search. Multiple projects coexist in one core instance.

**Status:** NOT_STARTED.

| Issue | Title |
|-------|-------|
| #79   | neat watch daemon (live re-extraction) |
| #81   | MCP Resources for graph nodes and incident stream |
| #82   | semantic_search with real embeddings |
| #83   | Multi-graph / multi-project support |
