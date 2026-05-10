---
name: static-extraction
description: Producers under packages/core/src/extract/* read source code and config to build the EXTRACTED layer. Every edge carries evidence.file. Ghost-edge cleanup keys on it. All producers are idempotent.
governs:
  - "packages/core/src/extract/**"
  - "packages/core/src/watch.ts"
adr: [ADR-032, ADR-030, ADR-031, ADR-024]
---

# Static-extraction contract

The first producer-layer contract. `packages/core/src/extract/**` reads source code and config files to build the EXTRACTED layer of the graph. Mutation authority for static creation is locked here per the lifecycle contract (ADR-030).

## Producer interface

Every producer module exports a single async function with the signature:

```ts
async function addX(
  graph: NeatGraph,
  services: DiscoveredService[],
  scanPath: string,
): Promise<{ nodesAdded?: number; edgesAdded?: number }>
```

Producers are pure with respect to graph state outside their own writes. They:

- read from the filesystem within `scanPath` and each service's `dir`,
- write nodes and edges via `graph.addNode` / `graph.addEdgeWithKey`,
- guard every write with `graph.hasNode(id)` / `graph.hasEdge(id)` for idempotency,
- never read the OBSERVED layer,
- never trigger REST or MCP,
- never call `compat.json` outside `compat.ts`.

## Evidence on EXTRACTED edges (binding)

Every EXTRACTED edge carries an `evidence` field:

```ts
evidence: {
  file: string         // path relative to scanPath, forward slashes
  line?: number        // 1-indexed
  snippet?: string     // small source fragment, max ~120 chars
}
```

`file` is required. `line` and `snippet` are optional but strongly preferred when the producer can compute them cheaply.

Today the CALLS-family producers (`calls/http.ts`, `calls/aws.ts`, `calls/kafka.ts`, `calls/grpc.ts`, `calls/redis.ts`) carry evidence. CONNECTS_TO, CONFIGURED_BY, DEPENDS_ON, and RUNS_ON producers do not. Issue #140 closes that gap.

## Ghost-edge cleanup

When a file changes or disappears between extract passes, every EXTRACTED edge whose `evidence.file` matches that path is **dropped before the producer reruns**. Re-extraction recreates the edges that still apply; the deleted code's edges stay deleted.

`watch.ts` owns the cleanup trigger per ADR-030's mutation authority. The order is:

1. `classifyChange` decides which producer phases the changed file belongs to.
2. For each phase, `watch.ts` calls a `retireEdgesByFile(graph, file)` step that drops every edge in that phase whose `evidence.file` matches.
3. The producer reruns. Idempotent writes recreate surviving edges.

This is the v0.1.x bug closed by issue #140. Without it, watch-driven re-extraction accumulates stale EXTRACTED edges indefinitely.

## Idempotency

Every producer is idempotent. Running the same producer twice on the same input produces the same graph state. `graph.hasNode(id)` and `graph.hasEdge(id)` guards already enforce this; the contract reaffirms it.

Idempotency is what makes ghost-edge cleanup safe — the path-keyed retire step plus re-extraction always converges on the source's current state, regardless of how many times either fires.

## Language dispatch

Source-file parsing routes by file extension:

| Extension                                | Grammar                          |
|------------------------------------------|----------------------------------|
| `.js` `.jsx` `.mjs` `.cjs` `.ts` `.tsx`  | `tree-sitter-javascript`         |
| `.py`                                    | `tree-sitter-python`             |

`tree-sitter-typescript` is installed but currently unused — `.ts` / `.tsx` fall through to the JS parser. Replacing the JS fallback with the dedicated TS grammar is a future improvement, not in scope for this contract.

Other extensions are skipped silently by `walkSourceFiles` per `IGNORED_DIRS` and `SERVICE_FILE_EXTENSIONS` in `extract/shared.ts`. New language support requires a grammar import and an extension entry in one place.

## Discovery policy

- Recursive directory walk from `scanPath`, bounded by `NEAT_SCAN_DEPTH` (default 5, configurable via env).
- `.gitignore` honored.
- `IGNORED_DIRS` skip set: `node_modules`, `.git`, `.turbo`, `dist`, `build`, `.next`. (`__pycache__` and `vendor` are pending — see open-questions list in `docs/audits/verification.md`.)
- `package.json#workspaces` triggers monorepo expansion. `pnpm-workspace.yaml` and `turbo.json` are not yet read (deferred).

## Producers in scope

| Module               | Produces                                       | Evidence today |
|----------------------|------------------------------------------------|----------------|
| `services.ts`        | ServiceNode (npm + Python)                     | n/a (nodes)    |
| `aliases.ts`         | host:port aliases on existing ServiceNodes     | n/a            |
| `databases/*`        | DatabaseNode + CONNECTS_TO                     | ❌ — #140      |
| `configs.ts`         | ConfigNode + CONFIGURED_BY                     | ❌ — #140      |
| `calls/{aws,grpc,http,kafka,redis}.ts` | CALLS / PUBLISHES_TO / CONSUMES_FROM | ✅          |
| `infra/{docker-compose,dockerfile,k8s,terraform}.ts` | InfraNode + DEPENDS_ON / RUNS_ON | ❌ — #140 |

New producers under `calls/` for source-level DB connections (`new pg.Pool(...)`) and inter-service imports land under issue #141. They follow the same interface, same evidence shape, same idempotency.

## `framework` on ServiceNode

Issue #142 adds `framework?: string` to `ServiceNodeSchema`. This is **schema growth** governed by ADR-031, not a new field on this contract. The producer (`extract/services.ts`) populates it from `dependencies` and `devDependencies` via a package-name → framework-label table:

| Package                | Framework label  |
|------------------------|------------------|
| `express`              | `express`        |
| `fastify`              | `fastify`        |
| `@nestjs/core`         | `nestjs`         |
| `hono`                 | `hono`           |
| `koa`                  | `koa`            |
| `next`                 | `next`           |
| `fastapi` (Python)     | `fastapi`        |
| `flask` (Python)       | `flask`          |
| `django` (Python)      | `django`         |

The table lives in `compat.json` or a sibling data file. Population happens at extract time. The snapshot guard catches schema drift.

## Per-file parse-failure isolation (ADR-055)

Every producer that parses per-file content wraps the parse in `try / catch`. On failure: `console.warn` with the producer name, file path, and error message; `continue` to the next file. The phase completes even if some files are unparseable.

```ts
for (const file of files) {
  let parsed: T
  try {
    parsed = await readJson<T>(file)
  } catch (err) {
    console.warn(`[neat] <phase> skipped ${file}: ${(err as Error).message}`)
    continue
  }
  // … use `parsed` …
}
```

Wrap at the call site, not in shared helpers. `readJson` and `readYaml` in `extract/shared.ts` continue to throw on malformed input; producers wrap their call. Keeps warning messages contextual (producer name, file path, failure mode).

File reads that don't parse follow the same pattern when they sit inside a per-file walk — a permission error on one file shouldn't kill the phase.

Conformant sites today: `calls/http.ts`, `owners.ts`, `infra/k8s.ts`, `databases/*`. Sites needing the fix: `services.ts` (×2), `aliases.ts` (×2), `infra/docker-compose.ts`, `infra/dockerfile.ts`. See ADR-055 for the full enumeration and the implementation hand-off.

## Owner extraction (ADR-054)

`extract/services.ts` populates `ServiceNode.owner` per service. Source priority:

1. **CODEOWNERS file.** Read `<scanPath>/CODEOWNERS` first, then `<scanPath>/.github/CODEOWNERS`. Match each service's `repoPath` against the file's patterns. Use the literal RHS of the first matching line (`@org/team`, `email@addr`, etc.).
2. **`package.json` `author` field.** If CODEOWNERS doesn't cover the service's path, read `<service.repoPath>/package.json` and use `author` if present (string form or `name` from object form).
3. **Otherwise undefined.** No git-blame fallback (last-toucher ≠ owner; per-service git invocations are slow).

Format is the literal source value — no normalization in extract. Display-time normalization is the consumer's job.

OTel-auto-created services (per ADR-033) start with `owner: undefined`; static extraction backfills when `extract/services.ts` later discovers source. Property updates on existing nodes are allowed by extract producers per ADR-030.

CODEOWNERS pattern matching in MVP is minimal: support `*`, `**`, and exact paths. No full gitignore-style parser.

## Enforcement

`packages/core/test/audits/contracts.test.ts` includes:

- A scan asserting every EXTRACTED-edge construction site in `extract/` includes an `evidence` field with at least `file`. Lands as `it.todo` keyed to #140 and flips when the issue closes.
- A producer-interface assertion: every `addX` export under `extract/` accepts `(graph, services, scanPath)` (or a strict subset).
- An idempotency assertion: run a producer twice on the same fixture, expect identical graph state.
- Owner-extraction block (`it.todo`s for ADR-054): schema includes optional `owner`; CODEOWNERS at root + at `.github/`; package.json `author` fallback; undefined when neither source covers; backfill on existing nodes from OTel ingest.

The PreToolUse hook surfaces this contract whenever any file under `extract/` or `watch.ts` is edited.

## Rationale

Static extraction was the most-FAIL'd layer in the verification pass — 7 FAILs and 13 PARTIALs across the tree-sitter audit. Most of them clustered around two missing structural rules: evidence shape on every EXTRACTED edge, and a cleanup mechanism keyed to it. Both rules already informally existed (CALLS edges carry evidence; the audit asks for cleanup). This contract makes them universal across producers and ties them to the lifecycle authority that owns retirement.

Full rationale and historical context: [ADR-032](../decisions.md#adr-032--static-extraction-contract).
