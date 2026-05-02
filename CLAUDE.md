# CLAUDE.md

This is the agent guide for the NEAT repo. If you're a fresh Claude session (or a human picking this up cold), read this first.

## What NEAT is

NEAT keeps a live semantic graph of a software system — code, infrastructure, runtime — and exposes it to AI agents over MCP. The core demo: a service running `pg` 7.4.0 against PostgreSQL 15 fails at runtime, and NEAT traces that failure back to the version mismatch two hops away through the graph. The extraction pipeline reads static code (tree-sitter) and live OTel traces to build and maintain that graph.

## Where you are in the build

**The MVP sprint (M0–M6) is complete.** All six milestones shipped. The repo is now on the `main` branch with everything verified. Active work is the **v0.1.2 "Ubiquity" release** — see issues #67–#83 on GitHub.

MVP milestone summary for context:

- **M0** — monorepo + types ✓
- **M1** — static graph: tree-sitter reads the demo, compat check fires, REST API serves it ✓
- **M2** — OTel: live traces become OBSERVED edges ✓
- **M3** — traversal: root-cause + blast-radius ✓
- **M4** — MCP: all six tools wired up against the live graph, Claude Code can connect ✓
- **M5** — general purpose: data-driven compat, second failure scenario, `neat init` CLI ✓
- **M6** — Railway deploy: runbook, collector Dockerfile, quickstart README, PROVENANCE.md ✓ (code); manual Railway deploy is a follow-up

`docs/milestones.md` has the full verification gates. Always check it before starting any work — it's still the source of truth for what's done and what's next.

## What's next: v0.1.2

The release goal in one line: **drop the Node-only assumption.** By the end of v0.1.2 NEAT can — at a basic level — work on any codebase and any server, not just JS/TS services on Node. NEAT itself stays Node 20 + TypeScript; the *target* it understands stops being Node-shaped.

Work is sequenced across four sub-milestones. Pick up from open issues on GitHub, one issue per branch per the conventions below.

### v0.1.2-α — Foundations ✓ shipped

Cleared the schema cleanup and the structural refactor that lets every β PR stay small.

- ✓ #67 — drop legacy `pgDriverVersion`; snapshot bumps to v2 with auto-migration on load (ADR-019).
- ✓ #68 — split `extract.ts` into per-source modules under `packages/core/src/extract/{services,databases,configs,calls,shared,index}.ts`. Orchestrator is 27 lines; each phase is independently importable.
- ✓ #80 — OTLP/gRPC receiver opt-in via `NEAT_OTLP_GRPC=true` (port `:4317`). Bundled OTLP protos under `packages/core/proto/` (ADR-020).

### v0.1.2-β — Extraction breadth ✓ shipped

The graph is no longer JS-and-pg-shaped. Recursive workspace discovery, generalised DB discovery, polyglot service detection, transport-aware call extraction, and infrastructure-as-nodes all landed in one sprint.

- ✓ #69 — recursive `discoverServices` walk, `NEAT_SCAN_DEPTH`, gitignore + workspace globs, dup-name warning.
- ✓ #70 — DB discovery via parser registry: `.env`, prisma, drizzle, knex, ormconfig, typeorm, sequelize, docker-compose, all on top of the original `db-config.yaml` path.
- ✓ #71 — calls beyond HTTP: Kafka (`PUBLISHES_TO`/`CONSUMES_FROM`), Redis, AWS SDK (S3 + DynamoDB), gRPC. Edges carry optional `evidence: { file, line, snippet }`.
- ✓ #72 — Python services via `tree-sitter-python`, `requirements.txt` + `pyproject.toml` parsing, three new compat entries (psycopg2, pymongo, mysql-connector-python). NEAT's own toolchain stays Node + TS.
- ✓ #73 — infra extraction: docker-compose (DEPENDS_ON), Dockerfile (RUNS_ON to `infra:container-image:<image>`), Terraform `aws_*`, k8s `kind`. `InfraNodeSchema` gained `kind`; `EdgeType` gained `RUNS_ON`.

### v0.1.2-γ — Graph correctness ✓ shipped

The graph reasons sharper now. Confidence stops being a constant, compat covers four kinds, frontier nodes get populated and promoted, snapshot diffing lands, staleness is per-edge-type with a transition log.

- ✓ #75 — `ServiceNode.aliases` populated from compose / Dockerfile labels / k8s metadata; `FrontierNode` (5th `NodeType`) for unresolved span peers; `promoteFrontierNodes` retires placeholders once an alias matches (ADR-023).
- ✓ #77 — `GET /graph/diff?against=<path-or-url>` plus MCP `get_graph_diff`. Returns added/removed/changed for both nodes and edges with both `exportedAt` timestamps.
- ✓ #74 — compat matrix grew `kind: 'driver-engine' | 'node-engine' | 'package-conflict' | 'deprecated-api'`. `NEAT_COMPAT_URL` fetches a remote extension, caches to `~/.neat/compat-cache.json` with 24h TTL. `ServiceNode.nodeEngine` carries `engines.node`.
- ✓ #76 — per-edge `signal: { spanCount, errorCount, lastObservedAgeMs }`. `confidenceForEdge` blends provenance ceiling × volume × recency × cleanliness. Path-level confidence is the bottleneck (min) across the walk. MCP surfaces signal numbers verbatim.
- ✓ #78 — per-edge-type stale thresholds (`CALLS` 1h, `CONNECTS_TO` 4h, `DEPENDS_ON` 24h). `NEAT_STALE_THRESHOLDS` JSON override. Every transition appends to `stale-events.ndjson`; `/incidents/stale` + MCP `get_recent_stale_edges` expose them (ADR-024).

### v0.1.2-δ — Ergonomics (next up)

Make the graph pleasant to use. Order within δ:

1. **#79 — `neat watch <path>` daemon.** New CLI subcommand alongside `neat init`. Uses `chokidar`, debounces ~1s, re-extracts incrementally per phase. SIGTERM has to clean up watchers. Same in-memory graph as the REST API; no new persistence path.
2. **#81 — MCP Resources.** `neat://node/<id>` (read returns attrs + outbound edges) and `neat://incidents/recent` (streaming subscription). Wire next to existing `server.tool(...)` calls in `packages/mcp/src/index.ts`. Tools stay; resources are additive.
3. **#82 — real `semantic_search` embeddings.** Default to Ollama (`nomic-embed-text`) if `OLLAMA_HOST` is set; fall back to `@xenova/transformers` in-process; substring fallback otherwise. Flat cosine in-memory (≤10K nodes is fine). Write the model-choice ADR before the code.
4. **#83 — multi-project support.** Replace `getGraph()` singleton with `Map<string, NeatGraph>`. Routes `/projects/:project/graph`, default `"default"` for back-compat. Snapshots persist as `neat-out/<project>.json`. MCP tools get an optional `project` arg; server reads `NEAT_DEFAULT_PROJECT`.

#79 first (no schema impact). #81 + #82 in parallel after that. #83 last — it touches every route shape, so let the others land first.

### Closing gate — M6 manual verification

Run **after δ merges**, not before. Stand up Railway per `docs/railway.md` → drive traffic at `service-a` → confirm OBSERVED + INFERRED edges in the deployed `/graph` → point Claude Code at the deployed core via `NEAT_CORE_URL` → ask the headline question + one polyglot follow-up. Then flip M6 to VERIFIED and tag v0.1.2. The two unchecked boxes in `docs/milestones.md` are the gate.

## Decisions already made

`docs/decisions.md` is the ADR log. Read it before reopening any of these:

- pnpm → npm (ADR-007)
- `tree-sitter` native bindings, not `web-tree-sitter` (ADR-002)
- Dual ESM/CJS via `tsup` for every `@neat/*` package (ADR-003)
- No dashboard in this release — `packages/web/` is a shell (ADR-004)
- Branch-per-issue, manual issue close after verifying (ADR-005)
- ConfigNodes record file existence, not contents (ADR-016)
- `neat init` writes snapshot to `<path>/neat-out/graph.json` by default (ADR-017)
- Railway deployment is documented in `docs/railway.md`, not codified as IaC (ADR-018)
- `pgDriverVersion` removed from `ServiceNodeSchema`; snapshot v1→v2 migrates on load (ADR-019)
- OTLP `.proto` files bundled in-tree; gRPC receiver is opt-in (ADR-020)
- Python extraction reads source via `tree-sitter-python`; NEAT's runtime stays Node-only (ADR-021)
- `infra:<kind>:<name>` id format; one `InfraNode` type, free-string `kind` for sub-typing (ADR-022)
<<<<<<< HEAD
- `FrontierNode` is a fifth node type for unresolved span peers; promoted away once an alias matches (ADR-023)
=======
- Per-edge-type stale thresholds + `stale-events.ndjson` transition log (ADR-024)
>>>>>>> 959e891 (Per-edge-type stale thresholds + stale-events log (#78))

## Conventions

- One issue → one branch named `<num>-<slug>` → one PR.
- PR body says `Refs #N`, **not** `Closes #N`. The user closes issues by hand after verifying.
- Commits and PRs read like a colleague wrote them. No "this commit introduces" or release-notes-y bullets. See ADR-008.
- **No** `Co-Authored-By: Claude` trailer on commits — human authors only (ADR-006).
- Stack γ PRs on top of merged β work, not on each other. `main` rebase is the easier merge story.
- Every package emits ESM + CJS + DTS via tsup. Don't ship ESM-only.

## Don't do

- Don't add dashboard work — `packages/web/` is a shell. Graph rendering, node inspector, incident log are post-MVP.
- Don't hardcode driver-specific logic outside `compat.json`. Everything in `compat.ts` reads from data.
- Don't introduce mocks in production paths. Tests can mock; runtime cannot.
- Don't add Python to the NEAT toolchain itself. Node 20.x, TypeScript only. (Python *extraction* — reading Python service code — is a v0.1.2 feature, but the extractor is still TypeScript.)
- Don't write snapshot file contents for `.env` files. ConfigNodes record existence only (ADR-016).

## Common commands

```bash
npm install                              # one-shot for the whole workspace
npx turbo build                          # build everything
npx turbo test                           # run vitest across packages
npx turbo lint                           # eslint
npm run build --workspace @neat/core     # one package
NEAT_SCAN_PATH=./demo \
  npm run dev --workspace @neat/core     # core dev server
node packages/core/dist/cli.cjs init ./demo   # neat init CLI
node packages/mcp/dist/index.cjs         # MCP stdio server (after build)
```
