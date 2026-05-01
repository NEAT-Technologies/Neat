# Decisions

Append-only ADR log. Each entry: what was decided, why, and the date. New decisions go to the bottom.

---

## ADR-001 — Monorepo with pnpm + Turborepo

**Date:** 2026-04-30  
**Status:** Superseded by ADR-007.

Original decision: pnpm 9 with `shamefully-hoist=true` workspaces, Turborepo for the task graph. Rationale was disk-store dedup and per-package filtering.

---

## ADR-002 — tree-sitter native bindings, not web-tree-sitter

**Date:** 2026-04-30  
**Status:** Active.

The seed design doc proposed `web-tree-sitter`. We're going with the native `tree-sitter` + `tree-sitter-javascript` + `tree-sitter-typescript` packages instead.

Reason: extraction runs in Node only, so the WASM loader and async init `web-tree-sitter` requires buy us nothing. Native bindings are faster, simpler, and don't pull WASM tooling into CI.

---

## ADR-003 — Dual ESM/CJS via tsup for every `@neat/*` package

**Date:** 2026-04-30  
**Status:** Active.

Every workspace package emits ESM + CJS + DTS via `tsup`. The MCP SDK and the OTel SDK both have CJS quirks; consumers shouldn't have to care which format they're loading. One config, dual emit.

---

## ADR-004 — No dashboard in MVP

**Date:** 2026-04-30  
**Status:** Active.

The seed design doc explicitly excludes a dashboard from the MVP. The GitHub M5 milestone has dashboard issues (#28–#31) — those should be relabeled `post-mvp-enhance` and not block the demo.

`packages/web` exists, but as a wordmark + `/api/health` shell. Graph rendering, node inspector, incident log — all post-MVP.

---

## ADR-005 — Branch per issue, manual issue close

**Date:** 2026-04-30  
**Status:** Active.

One issue → one branch named `<num>-<slug>` → one PR. PR body says `Refs #N`, not `Closes #N`. The user closes issues by hand after verifying the milestone.

Reason: a merged PR is not the same as a verified milestone. Manual close forces the verification gate to actually be run.

---

## ADR-006 — No `Co-Authored-By: Claude` trailer in commits

**Date:** 2026-04-30  
**Status:** Active.

Commit history attributes work to the human authors only. No Anthropic / Claude co-author trailer. User preference.

---

## ADR-007 — Switch from pnpm to npm workspaces

**Date:** 2026-05-01  
**Status:** Active. Supersedes ADR-001.

Mid-sprint we decided pnpm wasn't earning its keep at four packages. npm ships with Node, so onboarding is `git clone && npm install` instead of also installing pnpm via corepack. The content-addressable store and `shamefully-hoist` workarounds were solving problems we don't have yet.

What changed: `pnpm-workspace.yaml`, `.npmrc`, and `pnpm-lock.yaml` are gone. `workspaces: ["packages/*"]` lives in root `package.json`. `packageManager: "npm@11.11.0"` pins the tool. Turbo 2.x reads `packageManager` to resolve the workspace graph, so it has to be there.

`workspace:*` deps became `*` for npm-idiomatic syntax. `demo/*` is **not** in workspaces yet — those services don't run until M2; adding their pg/express/OTel trees would add ~80 packages to the lockfile for nothing. M2 puts them back.

---

## ADR-008 — Plain-English commits, PRs, comments

**Date:** 2026-05-01  
**Status:** Active.

Commit messages, PR bodies, code comments, and docs read like a colleague wrote them. Tech jargon is fine; release-notes-y bullets and "this commit introduces" phrasing are not. Short paragraphs over stiff lists.

---

## ADR-009 — Demo services not in npm workspaces during M0/M1

**Date:** 2026-05-01  
**Status:** Active.

`demo/service-a` and `demo/service-b` exist as source files only during M0/M1. The static extractor reads their `package.json` directly from disk; it doesn't need their deps resolved. Listing them as workspaces would force npm to resolve pg, express, and the OTel SDK — ~80 transitive packages — for no current benefit.

M2 brings them back into workspaces when docker-compose actually launches the services.

---

## ADR-010 — Node and edge ID conventions

**Date:** 2026-05-01
**Status:** Active.

Node ids are typed prefixes joined to a stable name:

- `service:<package.name>` for `ServiceNode`s. The package name is what the discovery phase reads from `package.json`, so it survives directory renames and matches what humans (and the MCP tools) will type.
- `database:<host>` for `DatabaseNode`s. The host comes from `db-config.yaml`; it's the same value services reach the database with, which makes deduplication trivial when multiple services connect to the same db.

Edge ids are `${type}:${source}->${target}`. This makes edges deterministic — two extracts that see the same relationship produce the same key, so re-running `extractFromDirectory` is idempotent without needing a separate dedup pass.

**Why it matters:** every traversal (M3) and every MCP tool argument (M4) keys off these ids. Changing the format breaks the contract with everything downstream. If a new node type appears, give it a new prefix (`config:`, `infra:`); don't repurpose existing ones.

---

## ADR-011 — Snapshot envelope with schemaVersion

**Date:** 2026-05-01
**Status:** Active.

`saveGraphToDisk` doesn't write the raw `graphology.export()` blob. It wraps it:

```json
{ "schemaVersion": 1, "exportedAt": "2026-05-01T...", "graph": <export> }
```

`loadGraphFromDisk` rejects mismatched `schemaVersion` rather than trying to migrate silently. The first time the graph shape changes incompatibly (new required attribute, edge type rename, etc.), bump to `schemaVersion: 2` and add a migration branch in `loadGraphFromDisk`.

The write itself is atomic: `<path>.tmp` first, then `fs.rename`. A crash mid-write leaves the previous snapshot intact rather than half-truncating the active file.

---

## ADR-012 — tree-sitter scope for M1: URL substring matching only

**Date:** 2026-05-01
**Status:** Active for M1. Revisit if M3+ traversal needs richer call graphs.

The M1 extractor uses tree-sitter only to walk the AST and collect string literals; it then searches those literals for URLs containing a known service hostname. That's enough for the demo (`axios.get('http://service-b:3001/...')`).

What it deliberately does **not** do: full import-graph analysis, dynamic-URL inference, or following config objects. Those would multiply the surface area of what the extractor can be wrong about, and the failure cases the design doc cares about don't need them.

If a future demo case requires richer call-graph extraction, that's a deliberate scope expansion — write tests against the new failure mode first, then extend `extract.ts`.

---

## ADR-013 — Compat threshold semantics: under-flag rather than over-flag

**Date:** 2026-05-01
**Status:** Active.

`compat.json` carries a `minEngineVersion` per pair. The driver constraint only fires once the engine reaches that major or higher — so `pg 7.4.0 / postgresql 13` returns `compatible: true` because PG 13 still supports md5 auth.

Driver versions go through `semver.coerce` so `"v7.4.0"` and `"7.4"` both work. If a version string is unparseable (a git SHA, a build label, etc.), the function returns `compatible: true`. We'd rather miss a real incompatibility than fabricate a false positive on input we genuinely can't reason about — false positives erode trust in everything else the system says.

---

## ADR-014 — Manual pg span in service-b is M2-only debt

**Date:** 2026-05-01
**Status:** Active until M3 trace stitching lands. Then: delete the workaround.

`@opentelemetry/instrumentation-pg` only hooks pg >= 8.x. service-b is pinned to pg 7.4.0 because that's the version that fails the SCRAM handshake against PG 15 — without the failure there is no demo. The auto-instrumenter therefore never wraps `pool.query`, no span carries `db.system: postgresql`, and ingest has nothing to turn into an OBSERVED `CONNECTS_TO` edge. M2's verification gate explicitly expects that edge.

Today we paper over this by hand-rolling the span in `demo/service-b/index.js` (`tracedQuery` wrapping `pool.query` with `@opentelemetry/api`). It's a fixture, not architecture: a real NEAT user with a modern instrumented driver gets the OBSERVED edge for free.

The systems-level fix is M3's planned trace stitcher (see #10 + the INFERRED row of the provenance table in `architecture.md`): when an upstream span errors, walk the static graph from that service along EXTRACTED edges and write INFERRED edges with `confidence: 0.6`. Root-cause traversal already prefers OBSERVED → INFERRED → EXTRACTED, so the missing CONNECTS_TO becomes invisible to the system, not a special case to patch.

When M3 ships:
- Remove `tracedQuery`, the `@opentelemetry/api` import, and the `@opentelemetry/api` dep in `demo/service-b/package.json`. Drop the call site back to `pool.query('SELECT now() …')`.
- Re-run M2's verification gate. The OBSERVED CALLS edge should still appear; the OBSERVED CONNECTS_TO disappears, but an INFERRED CONNECTS_TO with confidence 0.6 should take its place.
- Update M2's gate text in `milestones.md` to reflect that CONNECTS_TO is INFERRED, not OBSERVED, in the live demo.
