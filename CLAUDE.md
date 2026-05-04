# CLAUDE.md

This is the agent guide for the NEAT repo. If you're a fresh Claude session (or a human picking this up cold), read this first.

## What NEAT is

NEAT keeps a live semantic graph of a software system — code, infrastructure, runtime — and exposes it to AI agents over MCP. The core demo: a service running `pg` 7.4.0 against PostgreSQL 15 fails at runtime, and NEAT traces that failure back to the version mismatch two hops away through the graph. The extraction pipeline reads static code (tree-sitter) and live OTel traces to build and maintain that graph.

## What success looks like (read this first)

**MVP success = closing a real PR on an open-source codebase NEAT was not engineered for.** Not running the pg demo. The demo proves the stack works in a controlled environment; the MVP earns its keep when NEAT finds a real bug in a real repo, where the OBSERVED layer was load-bearing — not just static analysis a Graphify fork could match.

ADR-027 records this reframe. The trace stitcher (INFERRED edges bridging missing OTel coverage) is evidence the gap between declared intent and observed reality is the load-bearing problem NEAT addresses; policies are the formalization of that gap.

## Where you are in the build

**v0.1.2 "Ubiquity" is shipped and tagged.** Release: https://github.com/NEAT-Technologies/Neat/releases/tag/v0.1.2. v0.1.3 (basic Cytoscape viewer) shipped on top. The MVP sprint (M0–M6) before all of that is also complete.

**Two parallel tracks now share `main`:**

- **Track 1 — v0.2.0 Frontend.** Jed's track. Builds against the stable v0.1.2 API. Doesn't gate the MVP success criterion; this track delivers investor-legibility. Issues #28-#31 + #106-#108.
- **Track 2 — v0.3.0 Policies → v0.3.1 `neat init` + Claude skill.** Engineering track (Cem + Kurt). v0.3.0 closes the four-feature gap — OTel + graph + MCP + **policies** — and gives NEAT the data model where declared intent and observed reality can diverge in a first-class way. v0.3.1 makes NEAT installable on any codebase with one command. Together they unlock the MVP-success PR experiment. Issues #115-#118 (v0.3.0 α/β/γ/δ) and #119 (v0.3.1).

The two tracks ship independently. v0.2.0 might land before v0.3.0 or after; either is fine.

Sub-milestones in v0.1.2, all merged on `main`:

- **α** — schema cleanup + extract module split + OTLP/gRPC opt-in (#67/#68/#80)
- **β** — recursive discovery, generalised DB extraction, polyglot calls, Python services, infra-as-nodes (#69/#70/#71/#72/#73)
- **γ** — compat beyond drivers, FrontierNode + alias resolution, per-edge confidence, snapshot diffing, per-edge-type staleness (#74/#75/#76/#77/#78)
- **δ** — `neat watch`, MCP Resources, embedding `semantic_search`, multi-project (#79/#81/#82/#83)

A generic `Dockerfile` at the repo root builds the demo-free image. Mount your codebase at `/workspace`, optional volume at `/neat-out`, default CMD runs the REST + OTLP daemon. CMD overrides: `neat init /workspace --project <name>`, `neat watch /workspace`, `neat-mcp`. (`packages/core/Dockerfile` is the older demo-flavored variant for the local docker-compose stack.)

`docs/milestones.md` has the full verification gates. Always check it before starting any work — it's still the source of truth for what's done and what's next.

## What's next on each track

### Track 1 — v0.2.0 Frontend (Jed)

`packages/web/` was a shell through v0.1.2 (ADR-004). v0.1.3 added a basic Cytoscape canvas. v0.2.0 fills the rest in. Builds against the stable v0.1.2 API.

Open issues on the v0.2.0 milestone:

- **#28** — Implement graph explorer with Cytoscape.js
- **#29** — Implement node inspector panel
- **#30** — Implement incident log page
- **#31** — Apply NEAT branding
- **#106** — Multi-project switcher in the web UI
- **#107** — `semantic_search` bar — natural-language node lookup
- **#108** — Live graph updates via SSE / WebSocket from `neat watch`

Suggested order: #31 (branding shapes the rest of the visual decisions) → #28 (graph explorer) → #29 (inspector) → #106 (project switcher) → #107 (search bar) → #30 (incident log) → #108 (live updates — depends on a stable explorer to render the deltas into).

### Track 2 — v0.3.0 Policies, then v0.3.1 distribution (Cem + Kurt)

**v0.3.0 (Policies)** closes the four-feature gap. α/β/γ/δ pattern mirroring v0.1.2:

- **#115 — α** — Policy schema + YAML parser in `@neat/types`. Built-in policy library starts here.
- **#116 — β** — Evaluation engine + `policy-violations.ndjson` transition log mirroring `errors.ndjson` and `stale-events.ndjson`.
- **#117 — γ** — REST + MCP surface. `GET /policies`, `GET /policies/violations`, `check_policies` MCP tool, `neat://policies/violations` resource. Project-aware via the dual-mount routes from #83.
- **#118 — δ** — Real-world policy library that exercises the OBSERVED-vs-EXTRACTED divergence — runtime call not declared, declared call never observed, compat-must-not-merge, stale-frontier-must-be-resolved, db-driver-pinned-major. The thing a Graphify fork can't trivially replicate.

**v0.3.1 (`neat init` + Claude skill)** is the sub-release after v0.3.0:

- **#119** — zero-config init on any codebase, auto-instrumentation strategy picker (codemod / Beyla / mesh / DB-proxy from P-001), Claude Code skill packaging that registers the eight tools + the new `check_policies` tool against the running core.

Pulls P-001 (zero-touch instrumentation) out of `docs/v0.x-proposals.md` once v0.3.1 starts.

### Closing gate — the MVP-success PR

After v0.3.0 + v0.3.1 land, point NEAT at an open-source codebase neither we nor anyone else engineered, identify a real bug NEAT alone surfaces (load-bearing OBSERVED signal, not static-only), propose a fix, get the PR merged. That's the bar ADR-027 sets. The Railway / AWS deploy is a means to that end, not the end itself.

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
- `FrontierNode` is a fifth node type for unresolved span peers; promoted away once an alias matches (ADR-023)
- Per-edge-type stale thresholds + `stale-events.ndjson` transition log (ADR-024)
- `semantic_search` uses an Ollama → Transformers.js → substring fallback chain; flat in-memory cosine, sidecar `embeddings.json` cache (ADR-025)
- Multi-project lives behind `Map<string, NeatGraph>`; routes dual-mount at `/X` and `/projects/:project/X`; default project keeps the legacy filenames; OTel ingest stays single-project (ADR-026)
- MVP success is closing a real PR on an open-source codebase, not running the pg demo; OBSERVED layer must be load-bearing (ADR-027)

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
