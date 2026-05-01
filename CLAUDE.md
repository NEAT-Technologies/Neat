# CLAUDE.md

This is the agent guide for the NEAT repo. If you're a fresh Claude session (or a human picking this up cold), read this first.

## What NEAT is

NEAT keeps a live semantic graph of a software system — code, infrastructure, runtime — and exposes it to AI agents over MCP. Today the demo proves one thing: a service running `pg` 7.4.0 against PostgreSQL 15 will fail at runtime, and NEAT can trace that failure back to the version mismatch two hops away through the graph. Everything else is built around making that demo work.

## Where you are in the build

The MVP sprint runs across seven milestones:

- **M0** — monorepo + types
- **M1** — static graph: tree-sitter reads the demo, compat check fires, REST API serves it
- **M2** — OTel: live traces become OBSERVED edges
- **M3** — traversal: root-cause + blast-radius
- **M4** — MCP: all six tools wired up against the live graph, Claude Code can connect
- **M5** — general purpose: data-driven compat, second failure scenario, `neat init`
- **M6** — Railway demo: deployed, reproducible without docker-compose locally

Always check `docs/milestones.md` for the current status before doing anything. That file is the source of truth for what's done and what's next.

## The build order is sacred

Don't skip ahead. M1 has stubs for extract / compat / persist / api in `packages/core/src/` — the order they get filled in is fixed in `docs/milestones.md`, and each step has a verification gate. Don't claim a milestone done unless every box in its gate is ticked.

## Decisions already made

`docs/decisions.md` is the ADR log. Read it before you reopen any of these:

- pnpm → npm (mid-sprint, kept the toolchain to one tool)
- `tree-sitter` native bindings, not `web-tree-sitter`
- Dual ESM/CJS via `tsup` for every `@neat/*` package
- No dashboard in the MVP — design doc says so
- Branch-per-issue, manual issue close after verifying

## Conventions

- One issue → one branch named `<num>-<slug>` (e.g. `4-extract`) → one PR.
- PR body says `Refs #N`, **not** `Closes #N`. The user closes issues by hand after verifying the milestone. Don't auto-close.
- Commits and PRs read like a colleague wrote them. No "this commit introduces" or release-notes-y bullets. See `docs/decisions.md` for the wording note.
- No `Co-Authored-By: Claude` trailers in commits in this repo. Plain authorship only.
- Every package emits ESM + CJS + DTS via tsup. Don't ship ESM-only.

## Don't do

- Don't add dashboard work — `packages/web/` is a shell, not a UI. `app/api/graph/route.ts` and friends are post-MVP.
- Don't hardcode pg-specific logic outside `compat.json` and the demo fixtures. Everything in `compat.ts` reads from data.
- Don't introduce mocks in production paths. Tests can mock; runtime cannot.
- Don't add Python. Node 20.x, TypeScript only.
- Don't bypass the build sequence. Filling in `extract.ts` before `compat.json` exists is a wasted branch.

## How to verify a milestone

`docs/milestones.md` has a verification gate per milestone — a checklist of concrete commands and expected outputs. M0 verifies with workspace build/test/lint green and CI passing. M1 verifies with a curl against `localhost:8080/graph` returning the expected `service-b` node with `pgDriverVersion: "7.4.0"`. Don't move on until the gate ticks.

## Common commands

```bash
npm install                              # one-shot for the whole workspace
npx turbo build                          # build everything
npx turbo test                           # run vitest across packages
npx turbo lint                           # eslint
npm run build --workspace @neat/core     # one package
NEAT_SCAN_PATH=./demo \
  npm run dev --workspace @neat/core     # core dev server (M1+)
node packages/mcp/dist/index.cjs         # MCP stdio server (after build)
```
