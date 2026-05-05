# CLAUDE.md

This is the agent guide for the NEAT repo. If you're a fresh Claude session (or a human picking this up cold), read this first.

**Binding rules:** @docs/contracts.md — short list, auto-loaded with this file. Per-topic contracts live under `docs/contracts/` and are surfaced automatically when you edit a file the contract governs (PreToolUse hook at `docs/contracts/_hook.sh`, wired in `.claude/settings.json`). If you're about to write code that conflicts with anything in there, stop. The conflict is the bug.

## What NEAT is

NEAT keeps a live semantic graph of a software system — code, infrastructure, runtime — and exposes it to AI agents over MCP. The core demo: a service running `pg` 7.4.0 against PostgreSQL 15 fails at runtime, and NEAT traces that failure back to the version mismatch two hops away through the graph. The extraction pipeline reads static code (tree-sitter) and live OTel traces to build and maintain that graph.

## What success looks like (read this first)

**MVP success = closing a real PR on an open-source codebase NEAT was not engineered for.** Not running the pg demo. The demo proves the stack works in a controlled environment we built to fail in a specific shape; the MVP earns its keep when NEAT finds a real bug in a real repo, where the OBSERVED layer was load-bearing — not just static analysis a Graphify fork could match.

ADR-027 records this reframe. The trace stitcher (γ #75 INFERRED edges bridging missing OTel coverage for pg 7.4.0) is evidence — not a workaround — that the gap between declared intent and observed reality is the load-bearing problem NEAT addresses. Policies (v0.2.1) are the formalisation of that gap.

## Where you are in the build

**v0.1.2 "Ubiquity" is shipped and tagged.** Release: https://github.com/NEAT-Technologies/Neat/releases/tag/v0.1.2. **v0.1.3** added a basic Cytoscape graph viewer on top. The MVP sprint (M0–M6) before all of that is also complete.

Sub-milestones in v0.1.2, all merged on `main`:

- **α** — schema cleanup + extract module split + OTLP/gRPC opt-in (#67/#68/#80)
- **β** — recursive discovery, generalised DB extraction, polyglot calls, Python services, infra-as-nodes (#69/#70/#71/#72/#73)
- **γ** — compat beyond drivers, FrontierNode + alias resolution, per-edge confidence, snapshot diffing, per-edge-type staleness (#74/#75/#76/#77/#78)
- **δ** — `neat watch`, MCP Resources, embedding `semantic_search`, multi-project (#79/#81/#82/#83)

A generic `Dockerfile` at the repo root builds the demo-free image. Mount your codebase at `/workspace`, optional volume at `/neat-out`, default CMD runs the REST + OTLP daemon. CMD overrides: `neat init /workspace --project <name>`, `neat watch /workspace`, `neat-mcp`. (`packages/core/Dockerfile` is the older demo-flavored variant for the local docker-compose stack.)

**Two parallel tracks now share `main`:**

- **Track 1 — v0.3.0 Frontend (Jed).** Builds against the stable v0.1.2 API. Doesn't gate the MVP success criterion; this track delivers investor-legibility. Issues #28-#31 + #106-#108.
- **Track 2 — v0.2.x Engineering (Cem + Kurt).** Three releases, sequential. v0.2.0 ships first.

`docs/milestones.md` has the full verification gates and the "Pick up here" handoff. Always check it before starting any work — it's the source of truth for what's done and what's next.

## What's next on each track

### Track 2 — v0.2.x Engineering

**v0.2.0 — Sunrise.** Audit-driven cleanup. Seven contract documents (`docs/audits/`) define what NEAT v0.1.x must redeem itself against. The first concrete deliverable is **issue #126** — a verification pass that grades every `Verify:` checkbox across all seven audits with file-and-line citations and outputs `docs/audits/verification.md`. Findings only — no code changes in the verification pass itself. After it lands, the user sorts findings into three piles (open as issues / amend existing / defer), and the cleanup work begins from there.

**v0.2.1 — Policies.** Closes the four-feature gap (OTel + graph + MCP + policies). α/β/γ/δ pattern mirroring v0.1.2:

- **#115 — α** — Policy schema + YAML parser in `@neat/types`
- **#116 — β** — Evaluation engine + `policy-violations.ndjson`
- **#117 — γ** — REST + MCP surface (`/policies`, `check_policies` tool, `neat://policies/violations`)
- **#118 — δ** — Real-world policy library exercising OBSERVED-vs-EXTRACTED divergence
- **#123** — generalize `getRootCause` beyond DatabaseNode origins (follow-on after #116 + #118 expose `PolicyViolation` as a node-shaped concept)

**v0.2.2 — `neat init` + Claude Code skill.** Distribution layer for the MVP-success PR experiment.

- **#119** — zero-config init on any codebase, Claude skill packaging

Pulls P-001 (zero-touch instrumentation) out of `docs/v0.x-proposals.md` once #119 starts.

### Track 1 — v0.3.0 Frontend (Jed)

`packages/web/` was a shell through v0.1.2 (ADR-004); v0.1.3 added a basic Cytoscape canvas; v0.3.0 fills the rest in. Builds against the stable v0.1.2 API.

Open issues on the v0.3.0 milestone:

- **#31** — Apply NEAT branding (recommended first — shapes visual decisions)
- **#28** — Graph explorer (richer than the v0.1.3 viewer)
- **#29** — Node inspector panel
- **#106** — Multi-project switcher
- **#107** — `semantic_search` bar
- **#30** — Incident log page
- **#108** — Live graph updates via SSE / WebSocket from `neat watch`

This track is independent of v0.2.x — Jed should not block on engineering work.

### Closing gate — the MVP-success PR

After v0.2.x lands: point NEAT at an open-source codebase, identify a real divergence-shaped bug (OBSERVED layer load-bearing, not static-only), propose a fix, get the PR merged. ADR-027 sets the bar.

The Railway gates from M6 are still informational. AWS is the more likely production target; `docs/railway.md` is one option, not canonical.

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
- MVP success is closing a real PR on an unfamiliar open-source codebase, not running the pg demo; OBSERVED layer must be load-bearing (ADR-027)

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
