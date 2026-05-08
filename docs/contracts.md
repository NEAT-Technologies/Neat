# NEAT contracts

Binding rules. Auto-loaded into every Claude Code session via `@docs/contracts.md` in `CLAUDE.md`.

If you (Claude or human) are about to write code that conflicts with anything below, stop. The conflict is the bug. Either the rule is wrong (open an ADR superseding it) or the code is wrong. Don't quietly drift.

This file is the index. Each rule has a short summary and a link to its full per-topic contract under `docs/contracts/`. The PreToolUse hook at `docs/contracts/_hook.sh` automatically surfaces the relevant contract when you edit a file the contract governs — so the binding rules load at the moment of writing, not just on session start.

## Per-topic contracts

| # | Contract | File | Governs | Status |
|---|----------|------|---------|--------|
| 1 | Node identity | [`contracts/identity.md`](./contracts/identity.md) | Node ids constructed via `@neat/types/identity` helpers, never literals (ADR-028) | ✅ landed |
| 2 | Edge identity + provenance | [`contracts/provenance.md`](./contracts/provenance.md) | Edge id wire format per provenance, `PROV_RANK` ordering, coexistence, confidence semantics (ADR-029) | ✅ landed |
| 3 | Node + edge lifecycle | [`contracts/lifecycle.md`](./contracts/lifecycle.md) | Creation, transition, retirement. Mutation authority locked to `ingest.ts` and `extract/*` (ADR-030) | ✅ landed |
| 4 | Schema growth vs shape | [`contracts/schema.md`](./contracts/schema.md) | Growth = commit-and-go (snapshot diff). Shape change = ADR + `persist.ts` migration (ADR-031) | ✅ landed |
| 5 | Static extraction | [`contracts/static-extraction.md`](./contracts/static-extraction.md) | Producer interface, evidence on every EXTRACTED edge, ghost-edge cleanup keyed on `evidence.file`, language dispatch, idempotency (ADR-032) | ✅ landed (v0.2.1 opens) |
| 6 | OTel ingest | [`contracts/otel-ingest.md`](./contracts/otel-ingest.md) | Non-blocking receiver, span-time `lastObserved`, parent-span cache, exception-event parsing, auto-creation of unseen services/DBs (ADR-033) | ✅ landed (v0.2.2 opens) |
| 7 | Trace stitcher | [`contracts/trace-stitcher.md`](./contracts/trace-stitcher.md) | ERROR-only trigger, depth-2 limit, EXTRACTED-only walk, OBSERVED-twin-skip rule, default confidence 0.6 (ADR-034) | ✅ landed (v0.2.2 opens) |
| 8 | FrontierNode promotion | [`contracts/frontier-promotion.md`](./contracts/frontier-promotion.md) | Post-extract trigger, alias-match precedence, atomic per-node, FRONTIER→OBSERVED upgrade, canonical edge-id helpers required (ADR-035) | ✅ landed (v0.2.2 opens) |
| 9 | Traversal | [`contracts/traversal.md`](./contracts/traversal.md) | PROV_RANK at every hop, FRONTIER excluded entirely, multiplicative confidence cascading, no mutation, schema-validated results (ADR-036) | ✅ landed (v0.2.3 opens) |
| 10 | `getRootCause` | [`contracts/get-root-cause.md`](./contracts/get-root-cause.md) | Walks incoming edges to depth 5, dispatches by origin node type, human-readable reason, derived fix recommendation (ADR-037) | ✅ landed (v0.2.3 opens) |
| 11 | `getBlastRadius` | [`contracts/get-blast-radius.md`](./contracts/get-blast-radius.md) | BFS outbound default depth 10, distance positive, per-node path + cascaded confidence, schema-validated (ADR-038) | ✅ landed (v0.2.3 opens) |
| 12 | MCP tool surface | [`contracts/mcp-tools.md`](./contracts/mcp-tools.md) | Nine tools, three-part response, transitive `get_dependencies`, REST-only data path (ADR-039) | ✅ landed (v0.2.4 opens) |
| 13 | REST API | [`contracts/rest-api.md`](./contracts/rest-api.md) | Dual-mount per ADR-026, locked endpoint set, JSON errors, Zod-validated bodies (ADR-040) | ✅ landed (v0.2.4 opens) |
| 14 | Persistence | [`contracts/persistence.md`](./contracts/persistence.md) | Snapshot at `<projectDir>/neat-out/graph.json`, `SCHEMA_VERSION` bumps on shape change only, append-only ndjson sidecars (ADR-041) | ✅ landed (v0.2.4 opens) |
| 15 | Policy schema | [`contracts/policy-schema.md`](./contracts/policy-schema.md) | `policy.json` at project root, version 1, five rule types (ADR-042) | ✅ landed (v0.2.4 opens) |
| 16 | Policy evaluation | [`contracts/policy-evaluation.md`](./contracts/policy-evaluation.md) | Pure `evaluateAllPolicies`, three triggers, per-type dispatch, deterministic violation ids (ADR-043) | ✅ landed (v0.2.4 opens) |
| 17 | Policy onViolation actions | [`contracts/policy-actions.md`](./contracts/policy-actions.md) | `log` / `alert` / `block`; severity-driven defaults; block applies to FrontierNode promotion gating only in MVP (ADR-044) | ✅ landed (v0.2.4 opens) |
| 18 | Policy tool surface | [`contracts/policy-tools.md`](./contracts/policy-tools.md) | Single `check_policies` tool, REST under `/policies`, resource at `neat://policies/violations` (ADR-045) | ✅ landed (v0.2.4 opens) |
| 19 | `neat init` | [`contracts/init.md`](./contracts/init.md) | One-time registration. Discovery before mutation. Patch-by-default; `--apply` opt-in. Lockfiles never touched (ADR-046) | ✅ landed (v0.2.5 opens) |
| 20 | SDK install | [`contracts/sdk-install.md`](./contracts/sdk-install.md) | Per-language installer modules (Node + Python in MVP). Plan/apply decoupled. Manifests touched, lockfiles never (ADR-047) | ✅ landed (v0.2.5 opens) |
| 21 | Machine-level project registry | [`contracts/project-registry.md`](./contracts/project-registry.md) | `~/.neat/projects.json` per-user, atomic writes via tmp+rename, flock during writes, path-normalized (ADR-048) | ✅ landed (v0.2.5 opens) |
| 22 | Daemon | [`contracts/daemon.md`](./contracts/daemon.md) | Single long-lived process, per-project graph isolation, mtime + OTel + policy.json triggers, graceful per-project failure (ADR-049) | ✅ landed (v0.2.5 opens) |
| 23 | CLI surface | [`contracts/cli-surface.md`](./contracts/cli-surface.md) | Nine `neat <verb>` commands mirroring MCP tools, REST-only data path, `--json` output, exit-code branching (ADR-050) | ✅ landed (v0.2.6 opens) |
| 24 | Frontend-facing API | [`contracts/frontend-api.md`](./contracts/frontend-api.md) | SSE stream at `/events` with locked 8-type taxonomy, multi-project switcher at `/projects`, WebSocket and per-event filtering deferred (ADR-051) | ✅ landed (v0.2.6 opens) |

### Future contracts — opened at the start of each milestone

_None queued. v0.2.6 is the last milestone in the v0.2.x sequence. Successor contracts (WebSocket transport, per-event filtering, additional language SDK installers, MVP-success-PR experiment) open as their gating work surfaces._

The full reasoning and per-milestone sequencing live in `docs/plans/2026-05-04-v0.2.x-sequencing.md`. The current state of the active milestone lives in `docs/plans/<latest-date>-v0.2.x-status.md`.

## Cross-cutting rules (applied everywhere; not yet split out)

These still live inline pending split into per-topic files. Treat them as binding immediately.

### 1. Provenance is the load-bearing semantic contract

Every edge carries a `provenance` field from `@neat/types`. Valid values:

```
OBSERVED | INFERRED | EXTRACTED | STALE | FRONTIER
```

- **OBSERVED** — direct OTel span. Carries `lastObserved` (ISO8601) and `callCount`. `confidence: 1.0` (max-trust marker, not derived).
- **INFERRED** — trace stitcher output. Carries `confidence` ≤ 0.7. Never created from depth > 2 hops from the originating error span. Default confidence `0.6`.
- **EXTRACTED** — tree-sitter / config parsing. No timestamp. Does not decay on a clock. Carries `evidence: { file, line?, snippet? }`.
- **STALE** — transitioned from OBSERVED only. Never created directly. Preserves the original `lastObserved`. Confidence drops to ≤ 0.3.
- **FRONTIER** — unresolved span peer (host:port not yet matched). Promoted to a typed node once an alias matches. See ADR-023.

Raw provenance strings (`'OBSERVED'`, `'EXTRACTED'`, etc.) outside `@neat/types` are a contract violation. Use `Provenance.X` constants.

### 2. OBSERVED and EXTRACTED edges coexist by design

Same node pair, same edge type, different provenance — they live as **separate edges with distinct ids**, not as a single edge upgraded in place.

- EXTRACTED edge id: `${type}:${source}->${target}`
- OBSERVED edge id: `${type}:OBSERVED:${source}->${target}`
- INFERRED and FRONTIER edges follow the same provenance-prefixed pattern.

This is intentional. The gap between declared intent (EXTRACTED) and observed reality (OBSERVED) is the load-bearing fact NEAT exists to surface (ADR-027). Stomping one with the other erases the gap.

Traversal selects the highest-priority edge per node-pair via `PROV_RANK` (OBSERVED > INFERRED > EXTRACTED > STALE).

### 3. FRONTIER edges are not traversed

`getRootCause` and `getBlastRadius` must skip FRONTIER edges entirely — not deprioritize, not flag, **skip**. FRONTIER means unknown territory; traversal stays inside the known graph.

If a node's only edges in/out are FRONTIER, traversal stops at that node. Return `null` (root cause) or empty (blast radius) cleanly.

### 4. Per-edge-type staleness thresholds (ADR-024)

- `CALLS` → 1 hour
- `CONNECTS_TO` → 4 hours
- `DEPENDS_ON`, `CONFIGURED_BY`, `RUNS_ON` → 24 hours

Override via `NEAT_STALE_THRESHOLDS` env. Transitions appended to `stale-events.ndjson`. Background `setInterval` loop (default 60s tick), never read-time.

### 5. The graph is loaded from `@neat/types` schemas

All node and edge schemas live in `packages/types/src/`. Code in `packages/core/src/` and `packages/mcp/src/` must:

- Import types from `@neat/types`. No local `interface Service { ... }` redefinitions.
- Import `Provenance.X` and `EdgeType.X` constants. No raw string literals.
- For traversal results: validate against `RootCauseResultSchema` / `BlastRadiusResultSchema` before returning.

### 6. Live graphology, not graph.json

`GET /graph` and all MCP tools must read the **live** in-memory graphology instance. Never read `graph.json` at request time. The snapshot on disk is loaded once at startup (`server.ts`, `watch.ts`) and persisted on shutdown / interval. Nothing else reads it.

### 7. Multi-project isolation (ADR-026)

`Map<string, NeatGraph>` keyed by project name. Default project keeps legacy filenames; named projects scope to `~/.neat/projects/<name>/`. REST routes dual-mount at `/X` and `/projects/:project/X`. OTel ingest stays single-project for now.

### 8. No demo-name hardcoding

`service-a`, `service-b`, `payments-db`, `pg`, `postgresql` must not appear as literal strings in branching logic anywhere in `packages/core/src/` or `packages/mcp/src/`. Allowed only in:

- Zod `.describe()` example strings (documentation hints to LLMs).
- Test fixtures.
- `compat.json` (the data file driving compatibility checks).

Driver and engine names are read from node properties. Compat checks iterate `compatPairs()`.

### 9. PR body says `Refs #N`, not `Closes #N`

Issues are closed by the user manually after verifying. Branches are `<num>-<slug>`. One issue → one branch → one PR. See ADR-005.

### 10. Commits and PRs read like a colleague wrote them

No "this commit introduces" or release-notes-y bullets. Plain English. See ADR-008.

### 11. Don't add features beyond the task

Bug fixes don't need surrounding cleanup. One-shot operations don't need helpers. Three similar lines is better than a premature abstraction. No half-finished implementations.

### 12. Don't introduce mocks in production paths

Tests can mock. Runtime cannot. `compat.ts` reads `compat.json`; never inline a mock matrix.

### 13. ConfigNodes record file existence, not contents (ADR-016)

`.env` files in particular: never write file contents into the snapshot. ConfigNode records `{ name, path, fileType }` only.

### 14. Node 20.x, TypeScript only, in NEAT's own toolchain

Python *extraction* (reading Python service code) is supported via `tree-sitter-python`. NEAT's runtime stays Node-only. Don't add Python (or Rust, or Go) to the toolchain. Rust v1.0 is the next-language move and is its own milestone.

## 16. Node ids come from `@neat/types/identity` helpers, never literals (ADR-028)

Every node id in NEAT is constructed via the helpers in `packages/types/src/identity.ts`:

```ts
import { serviceId, databaseId, configId, infraId, frontierId } from '@neat/types'

serviceId('checkout')       // 'service:checkout'
databaseId('db.example.com') // 'database:db.example.com'
configId('apps/web/.env')   // 'config:apps/web/.env'
infraId('redis', 'cache.internal')  // 'infra:redis:cache.internal'
frontierId('payments-api:8080')     // 'frontier:payments-api:8080'
```

Hand-rolled template literals like `\`service:${name}\`` are a contract violation. The id wire format lives in exactly one file. Anywhere else that constructs a node id by string concatenation is a bug.

Rationale (ADR-028): if two producers disagree on what id a node gets, OBSERVED edges from one never match EXTRACTED edges from the other and the coexistence contract (Rule 2) silently fails. Twelve hand-rolled id sites across nine files have been kept consistent by good behavior; the contract makes that consistency mechanical.

---

## When this file is wrong

If you read a rule here that contradicts a ratified ADR or the reality of `main`, the file is stale. Open an ADR, update the rule, link the ADR. Don't ignore it silently — the next session will read the stale version.

If you write code that violates a rule and you believe the rule should change, **say so explicitly in the PR description** and propose the ADR change. Don't merge a quiet violation.

---

## How the contract loading works

Three layers, increasing in precision:

1. **Session start** — CLAUDE.md auto-loads this index file. You see the rule list before any tool call.
2. **Pre-edit** — when you call `Edit`, `Write`, or `MultiEdit`, the PreToolUse hook at `docs/contracts/_hook.sh` reads the target file path, finds every contract in `docs/contracts/*.md` whose `governs:` frontmatter matches, and surfaces those contract bodies as additional context for that specific edit.
3. **CI** — `packages/core/test/audits/contracts.test.ts` encodes contract rules as test assertions. Any code that violates a rule fails the test on every PR.

Three points of contact, three different precision levels. The index is broad and always loaded. The hook is narrow and edit-scoped. The tests are mechanical and PR-gated.
