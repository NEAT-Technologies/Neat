# Milestones

Source of truth for sprint status. Update this file at the end of every session.

| Status        | Meaning                                                |
|---------------|--------------------------------------------------------|
| NOT_STARTED   | No code written.                                       |
| IN_PROGRESS   | Some PRs open or merged, gate not yet green.           |
| VERIFIED      | Every box in the verification gate ticked, on a date.  |

---

## 🚩 Pick up here

**Last session ended:** 2026-05-02. **v0.1.2-α is shipped on `main`.** Issues #67, #68, #80, and the M6 deploy issue #25 are closed; PRs #84, #85, #86, #87 merged. Workspace is green at HEAD: `npx turbo build test lint` clean, 104 core / 25 types / 17 mcp tests passing.

**Next session is v0.1.2-β — extraction breadth.** The release goal is dropping the Node-only assumption: by the end of v0.1.2 NEAT can extract from polyglot, multi-workspace, multi-DB, infra-aware codebases. β is the foundational chunk — γ and δ have very little to act on until β has landed.

### β work order (within v0.1.2-β)

Branch each issue off the latest `main`. Keep PRs small; later β issues build on the directory layout earlier ones produce.

1. **#69 — recursive service discovery + workspaces.** Today `discoverServices` only scans immediate subdirectories of `scanPath`. Workspaces (npm/pnpm/yarn workspaces, monorepo nesting, multi-repo umbrellas) want a recursive walk plus a `package.json#workspaces` reader. This is foundational — #70/#71/#72 all assume the discovery walk reaches every service. Lives in `packages/core/src/extract/services.ts`.
2. **#70 — generalised DB discovery** (.env, ORM configs, docker-compose). Drop the hardcoded `db-config.yaml` path; replace with a per-source-type module under `extract/databases/` (env vars, sequelize/prisma/typeorm/mongoose configs, docker-compose `depends_on`). Each source emits a `DatabaseNode` candidate; merge by host/port. Don't read `.env` *contents* unless the value is a connection string and the key is conventional (`DATABASE_URL`, `PG*`, `MONGO*`) — ADR-016 still applies.
3. **#71 — calls beyond HTTP URL substrings** (gRPC, Kafka, Redis, AWS SDK). The current `callsFromSource` in `extract/calls.ts` only recognises `//host` and `//host:port` patterns. Each new transport gets its own detector module — `extract/calls/grpc.ts`, `extract/calls/kafka.ts`, etc. Edge type stays `CALLS`; consider adding a `transport` attribute to `GraphEdge` (snapshot bump).
4. **#72 — Python service extraction.** New `extract/services/python.ts` module. Discovery looks for `pyproject.toml` + `requirements.txt` (no package.json). Use `tree-sitter-python` for the call walk. Add `language: 'python'` to `ServiceNode`. NEAT's toolchain stays TypeScript — we read Python source, we don't run Python.
5. **#73 — infrastructure extraction** (docker-compose, Dockerfile, Terraform, k8s). Adds `infra:` node type prefix (reserved by ADR-010) and likely new edge types (`DEPLOYS`, `RUNS_IN`). Touches `@neat/types` — co-ordinate snapshot schema bump with #74 in γ.

#69 first. After that, #70/#71/#72 can run in parallel across sessions; #73 is the schema-touching one and benefits from the others' signals being in the graph.

### M6 manual verification — DEFERRED TO POST-δ

The two unchecked manual gates (live Railway deploy + Claude Code end-to-end against the deployed core) wait until α/β/γ/δ have all merged. Reasoning: a deploy after α only re-proves what `main` already does. A deploy after δ proves the v0.1.2 promise — that NEAT works on a polyglot codebase, on someone else's server, end to end. See PR #87 + the M6 section below for the full rationale.

### Gotchas a fresh β session will benefit from

- **The α layout is already polyglot-ready.** `packages/core/src/extract/` has `services.ts`, `databases.ts`, `configs.ts`, `calls.ts`, `shared.ts`, `index.ts`. Each β issue extends one or more of these, or splits one further (`services.ts` → `services/{node,python}.ts` for #72). Don't fold logic back into `extract.ts` — that file is a one-line re-export shim now and should stay that way.
- **`extract/index.ts` is the orchestrator and is 27 lines.** Each phase has its own `addXxx(graph, services, ...)` function that returns `{ nodesAdded, edgesAdded }`. Add a phase by writing the function and one line in the orchestrator, not by editing the orchestrator's body.
- **Snapshot schema is at v2.** Any β change that adds attributes to existing node/edge types is forward-compatible (new optional Zod fields). Anything that *renames* or *restructures* (#73's `infra:` prefix is fine; renaming `CALLS` to `INVOKES` would not be) bumps to v3 — add a v2→v3 migration in `loadGraphFromDisk` per ADR-019's pattern.
- **Compat is data-driven (ADR-015).** Driver/engine pairs live in `compat.json`. Don't add per-driver code paths; extend the matrix. #74 in γ generalises compat further; β work that adds new driver awareness should add JSON entries, not TypeScript branches.
- **`.env` records existence, not contents (ADR-016).** #70 reads `DATABASE_URL` and `PG*`-style keys from `.env` for *DB discovery* but does not snapshot the values into `ConfigNode.attributes`. The contents go into a transient `DbConfig` for emission of the `DatabaseNode`, then are discarded. This is the security boundary; don't blur it.
- **OTLP/gRPC is opt-in.** `NEAT_OTLP_GRPC=true` activates the listener (port `:4317`, override via `NEAT_OTLP_GRPC_PORT`). Default deployments are HTTP-only on `:4318` — β shouldn't change that default.
- **Demo stays as it is.** β doesn't need to add Python/Kafka/Terraform services to `demo/`. Synthetic test fixtures under `packages/core/test/fixtures/` are enough to prove each new extractor; the demo's job is to stay the canonical pg-vs-PG-15 failure for the headline narrative.
- **Manual pg span in service-b is gone.** Removed during M5 once the trace stitcher started producing INFERRED `CONNECTS_TO` edges (ADR-014). Don't reintroduce a manual span anywhere.

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

**Status:** NOT_STARTED.

**Issues / PRs:**

| Issue | Title                                                       | PR  | Status |
|-------|-------------------------------------------------------------|-----|--------|
| #69   | Recursive service discovery with workspace support          | —   | open |
| #70   | Generalised database discovery (.env, ORM configs, docker-compose) | — | open |
| #71   | Call extraction beyond HTTP URL substrings (gRPC, Kafka, Redis, AWS SDK) | — | open |
| #72   | Python service extraction                                   | —   | open |
| #73   | Infrastructure extraction (docker-compose, Dockerfile, Terraform, k8s) | — | open |

### β verification gate (proposed)

- [ ] Demo extraction unchanged: pg-vs-PG-15 demo still produces 4 nodes / 3 edges / one incompatibility.
- [ ] A synthetic multi-language fixture under `packages/core/test/fixtures/polyglot/` extracts JS + Python services with their respective dependency manifests, plus a docker-compose'd Redis broker, plus an `infra:` node for the docker-compose file itself. Assertions live in per-source-type test files.
- [ ] `.env` files contribute to DB discovery without their values landing in any snapshot. `ConfigNode.attributes` does not gain a `contents` field.
- [ ] Snapshot schema bumps if `@neat/types` shape changes (most likely from #73). Migration path follows ADR-019's pattern.
- [ ] One new ADR per non-obvious design choice (#72's Python toolchain decision is the likely candidate; #73's `infra:` taxonomy may want one too).

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
