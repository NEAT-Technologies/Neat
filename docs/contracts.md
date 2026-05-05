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

### Future contracts — opened at the start of each milestone

The data-layer foundation (1-4) is shared across all producers and consumers. Producer-, consumer-, surface-, policy-, and distribution-layer contracts open at the start of the milestone where their layer gets rebuilt.

| # | Contract | Milestone | Governs (target) |
|---|----------|-----------|------------------|
| 5 | Static extraction (tree-sitter) | v0.2.1 | What edges static extraction produces, evidence shape, language dispatch, depth limits, ghost-edge cleanup (`packages/core/src/extract/**`) |
| 6 | OTel ingest | v0.2.2 | Span-time `lastObserved`, parent-span correlation, exception-event parsing, auto-creation, non-blocking ingest (`ingest.ts` ingest path) |
| 7 | Trace stitcher | v0.2.2 | When INFERRED fires, depth limit, OBSERVED-twin-skip rule (`stitchTrace`) |
| 8 | FrontierNode promotion | v0.2.2 | When promotion fires, alias-match precedence, attribute merge (`promoteFrontierNodes`) |
| 9 | Traversal | v0.2.3 | Edge priority per hop, FRONTIER exclusion, confidence cascading, schema validation (`traverse.ts`) |
| 10 | `getRootCause` | v0.2.3 | Incompatibility-check semantics per upstream node type, reason-string format, fix-recommendation derivation |
| 11 | `getBlastRadius` | v0.2.3 | Outbound semantics, distance positive integer, per-node path and confidence, total-affected count |
| 12 | MCP tool surface | v0.2.4 | Three-part response, confidence/provenance footer, transitive vs direct, tool count and naming (`packages/mcp/src/`) |
| 13 | REST API | v0.2.4 | Endpoint shape per resource, project-scoped routing, error response shape (`packages/core/src/api.ts`) |
| 14 | Persistence | v0.2.4 | Snapshot schema versioning, migration rules, startup-load behavior (`packages/core/src/persist.ts`) |
| 15 | Policy schema | v0.2.4 | `policy.json` shape, version literal, type dispatch, rule structure |
| 16 | Policy evaluation | v0.2.4 | When policies evaluate (post-ingest, post-extract, post-stale), evaluator dispatch, violation-event shape |
| 17 | Policy onViolation actions | v0.2.4 | alert / log / block — what each does, what authority each carries |
| 18 | Policy tool surface | v0.2.4 | MCP tool naming and shape, REST endpoints |
| 19 | `neat init` | v0.2.5 | What init does, what it writes, what it doesn't touch, codemod patch-vs-apply semantics |
| 20 | SDK install | v0.2.5 | Per-language installer module interface, dependency-file edits, entrypoint modifications, opt-in semantics |
| 21 | Machine-level project registry | v0.2.5 | `~/.neat/projects.json` shape, daemon discovery rules, project lifecycle |
| 22 | Daemon | v0.2.5 | Continuous extraction triggers (file mtime, OTel arrival), per-project graph isolation, lifecycle |

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

### 9. No `Co-Authored-By: Claude` trailer (ADR-006)

Commits and PRs in this repo are authored by humans. Do not add the `Co-Authored-By: Claude Opus ... <noreply@anthropic.com>` trailer. The default Claude Code commit template includes this — strip it.

### 10. PR body says `Refs #N`, not `Closes #N`

Issues are closed by the user manually after verifying. Branches are `<num>-<slug>`. One issue → one branch → one PR. See ADR-005.

### 11. Commits and PRs read like a colleague wrote them

No "this commit introduces" or release-notes-y bullets. Plain English. See ADR-008.

### 12. Don't add features beyond the task

Bug fixes don't need surrounding cleanup. One-shot operations don't need helpers. Three similar lines is better than a premature abstraction. No half-finished implementations.

### 13. Don't introduce mocks in production paths

Tests can mock. Runtime cannot. `compat.ts` reads `compat.json`; never inline a mock matrix.

### 14. ConfigNodes record file existence, not contents (ADR-016)

`.env` files in particular: never write file contents into the snapshot. ConfigNode records `{ name, path, fileType }` only.

### 15. Node 20.x, TypeScript only, in NEAT's own toolchain

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
