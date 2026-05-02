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

Work is scoped across three areas. Pick up from the open issues on GitHub, one issue per branch per the conventions below.

**Extraction breadth** (#67–#73): recursive service discovery, generalised DB config parsing, call types beyond HTTP, Python support, infrastructure files, split `extract.ts` into modules, drop the legacy `pgDriverVersion` field.

**Graph correctness** (#74–#78): expand the compat matrix beyond drivers, FRONTIER/OBSERVED attribution, per-edge confidence signals, snapshot diffing, stale thresholds.

**Ergonomics** (#79–#83): `neat watch` daemon, gRPC ingest, MCP Resources, real embeddings for `semantic_search`, multi-project support.

No prescribed order within the release, but extraction breadth issues are generally foundational — the graph has to be richer before the correctness and ergonomics features have much to act on.

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

## Conventions

- One issue → one branch named `<num>-<slug>` → one PR.
- PR body says `Refs #N`, **not** `Closes #N`. The user closes issues by hand after verifying.
- Commits and PRs read like a colleague wrote them. No "this commit introduces" or release-notes-y bullets. See ADR-008.
- `Co-Authored-By: Claude <noreply@anthropic.com>` trailer on commits where Claude did the work alongside the human author.
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
