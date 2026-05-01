# Milestones

Source of truth for sprint status. Update this file at the end of every session.

| Status        | Meaning                                                |
|---------------|--------------------------------------------------------|
| NOT_STARTED   | No code written.                                       |
| IN_PROGRESS   | Some PRs open or merged, gate not yet green.           |
| VERIFIED      | Every box in the verification gate ticked, on a date.  |

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

**Status:** NOT_STARTED.

**Issues:** #7 (OTel span receiver), #8 (span→edge mapper), #22 (docker-compose), #23 (OTel collector config).

---

## M3 — Traversal

**End state:** `getRootCause` and `getBlastRadius` traverse the live graph. `/traverse/*` REST routes work.

**Status:** NOT_STARTED.

**Issues:** #10 (root-cause traversal), #11 (blast-radius traversal), #12 (traverse routes).

---

## M4 — MCP tools working against live graph

**End state:** Six MCP tools (`get_root_cause`, `get_blast_radius`, `get_dependencies`, `get_observed_dependencies`, `get_incident_history`, `semantic_search`) hit core over HTTP and return real results. Claude Code can connect, list six tools, and call them.

**Status:** NOT_STARTED. Stubs live in `@neat/mcp` from #13.

**Issues:** #14, #15, #16, #17, #18, #19, #20 (mcp CLAUDE.md + skill.md).

---

## M5 — General purpose

**End state:** A second failure scenario beyond the pg/PostgreSQL one. `neat init <path>` CLI works. yaml/env file extraction adds `ConfigNode` types.

**Status:** NOT_STARTED. The current GitHub M5 milestone (#28–#31) is dashboard work — those should be relabeled `post-mvp-enhance` per the design doc.

---

## M6 — Demo on Railway

**End state:** All demo services deployed; demo reproducible without running docker-compose locally.

**Status:** NOT_STARTED.

**Issues:** #25 (Railway), #26 (quickstart README).
