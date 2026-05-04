# CLAUDE.md

This is the agent guide for the NEAT repo. If you're a fresh Claude session (or a human picking this up cold), read this first.

## What NEAT is

NEAT keeps a live semantic graph of a software system — code, infrastructure, runtime — and exposes it to AI agents over MCP. The core demo: a service running `pg` 7.4.0 against PostgreSQL 15 fails at runtime, and NEAT traces that failure back to the version mismatch two hops away through the graph. The extraction pipeline reads static code (tree-sitter) and live OTel traces to build and maintain that graph.

## Where you are in the build

**v0.1.2 "Ubiquity" is shipped and tagged.** Release: https://github.com/NEAT-Technologies/Neat/releases/tag/v0.1.2. The MVP sprint (M0–M6) before it is also complete. Active work is the **v0.2.0 frontend release**.

Sub-milestones in v0.1.2, all merged on `main`:

- **α** — schema cleanup + extract module split + OTLP/gRPC opt-in (#67/#68/#80)
- **β** — recursive discovery, generalised DB extraction, polyglot calls, Python services, infra-as-nodes (#69/#70/#71/#72/#73)
- **γ** — compat beyond drivers, FrontierNode + alias resolution, per-edge confidence, snapshot diffing, per-edge-type staleness (#74/#75/#76/#77/#78)
- **δ** — `neat watch`, MCP Resources, embedding `semantic_search`, multi-project (#79/#81/#82/#83)

A generic `Dockerfile` at the repo root builds the demo-free image. Mount your codebase at `/workspace`, optional volume at `/neat-out`, default CMD runs the REST + OTLP daemon. CMD overrides: `neat init /workspace --project <name>`, `neat watch /workspace`, `neat-mcp`. (`packages/core/Dockerfile` is the older demo-flavored variant for the local docker-compose stack.)

`docs/milestones.md` has the full verification gates. Always check it before starting any work — it's still the source of truth for what's done and what's next.

## What's next: v0.2.0 — Frontend

`packages/web/` was a shell through v0.1.2 (ADR-004). v0.2.0 fills it in. The core API is stable, project-aware, and exhaustively tested; this release is greenfield UI on top of it.

Open issues on the v0.2.0 milestone:

- **#28** — Implement graph explorer with Cytoscape.js
- **#29** — Implement node inspector panel
- **#30** — Implement incident log page
- **#31** — Apply NEAT branding
- **#106** — Multi-project switcher in the web UI
- **#107** — `semantic_search` bar — natural-language node lookup
- **#108** — Live graph updates via SSE / WebSocket from `neat watch`

Suggested order: #31 (branding shapes the rest of the visual decisions) → #28 (graph explorer) → #29 (inspector) → #106 (project switcher) → #107 (search bar) → #30 (incident log) → #108 (live updates — depends on a stable explorer to render the deltas into).

### Closing gate — M6 manual verification

The Railway gates are still informational rather than blocking. AWS deployment looks like the more likely production target; the runbook in `docs/railway.md` is one option but not the canonical path.

## Decisions already made

`docs/decisions.md` is the ADR log. `docs/adr/README.md` is the process — when to write one, the template, supersession, ratification. Read decisions.md before reopening any of these:

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
- `FrontierNode` is a fifth node type for unresolved span peers; promoted away once an alias matches (ADR-023)
- Per-edge-type stale thresholds + `stale-events.ndjson` transition log (ADR-024)
- `semantic_search` uses an Ollama → Transformers.js → substring fallback chain; flat in-memory cosine, sidecar `embeddings.json` cache (ADR-025)
- Multi-project lives behind `Map<string, NeatGraph>`; routes dual-mount at `/X` and `/projects/:project/X`; default project keeps the legacy filenames; OTel ingest stays single-project (ADR-026)

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
