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

---

## ADR-015 — Root-cause traversal is matrix-driven, not pg-specific

**Date:** 2026-05-01
**Status:** Active. Supersedes the temporary pg-only path in `traverse.ts` from M3.

`getRootCause` originally read `ServiceNode.pgDriverVersion` and called `checkCompatibility` with a hardcoded `driver: 'pg'`. That made the rest of `compat.json` (mysql2/mysql, mongoose/mongo) decorative — the data was indexed but never consulted.

M5 generalises the traversal: filter `compatPairs()` to the target database's engine once, then walk each `ServiceNode` in the path checking every `dependencies[driver]` declaration against the matched pairs. The first incompatibility wins, and the fix recommendation cites the driver name from the matched pair.

**Why this shape and not a per-engine handler:** The per-engine fan-out is what `compat.json` already encodes. Pulling that table into TypeScript would duplicate it. The matrix is the schema; traversal just executes against it.

**`pgDriverVersion` stayed on the schema** as a UI/lookup convenience after the M5 generalisation but was no longer load-bearing — the dependencies map became the source of truth. ADR-019 drops it.

---

## ADR-016 — `ConfigNode`s record file existence, not contents

**Date:** 2026-05-01
**Status:** Active.

Phase 3 of `extractFromDirectory` walks each service directory for `*.yaml`, `*.yml`, and `.env`-shaped files; each one becomes a `ConfigNode` with `id: config:<scan-relative-path>` and a `CONFIGURED_BY` edge from the owning service. The node carries `name`, `path`, and `fileType` — nothing from inside the file.

**Why no contents:** `.env` files routinely carry secrets (database passwords, API keys); pulling them into a graph that gets snapshotted to disk and queried by AI agents over MCP is exactly the wrong default. The graph needs to *know* the file exists so policy queries ("which services are configured by `.env.production`?", "which configs feed into the failing service?") can resolve, but it does not need the values.

`db-config.yaml` is the exception only in the sense that phase 2 already parses it for connection details to build `DatabaseNode`s. Phase 3 adds it back in the catalog as a `ConfigNode`; the two readings coexist because they answer different questions.

**ID format:** `config:<relative-path>` keeps the node deterministic across re-extracts and lets two services that legitimately share a config file converge on the same node. Matches ADR-010's "typed prefix joined to a stable name".

---

## ADR-017 — `neat init` writes its snapshot under the scanned path by default

**Date:** 2026-05-01
**Status:** Active.

`neat init <path>` saves the snapshot to `<path>/neat-out/graph.json` unless `NEAT_OUT_PATH` overrides it. The alternative would have been a fixed `~/.neat/<hash>/graph.json` cache.

The local default keeps the snapshot near the code it describes — easy to find, easy to gitignore (the demo already does), easy to delete by `rm -rf neat-out`. A user-home cache would be friendlier to multi-project workflows but adds a directory the user has to learn about and clean. The CLI is a M5 deliverable, not a daemon; the local-default trade-off can be revisited if `neat watch` lands later.

---

## ADR-018 — Railway deployment is documented, not codified

**Date:** 2026-05-01
**Status:** Active for the MVP. Revisit if deploys become routine.

The M6 deliverable for Railway is `docs/railway.md` plus a small set of supporting files (`demo/collector/Dockerfile`, `demo/collector/config.railway.yaml`). It is not a `railway.toml`-driven IaC setup, and it is not a one-button deploy.

**Why no Railway IaC.** The MVP has six services, four of them backed by simple Dockerfiles, one Postgres plugin, and one Next.js auto-detect. The Railway config language adds another file format the team has to keep in sync with the docker-compose source of truth. For a one-shot demo deploy, a runbook is more honest about the manual steps (variables to wire, domains to generate, public/private toggles) than a `railway.toml` that elides them.

**The collector earns its own Dockerfile** because docker-compose mounts `config.yaml` into the upstream image, and Railway can't. Two configs coexist: `config.yaml` for local docker-compose, `config.railway.yaml` for the deployed collector (it parameterises the neat-core hostname via env). The Dockerfile copies the local one in by default; the runbook tells the operator to swap it for the Railway variant.

**When to revisit.** If a second deploy target lands, or if Railway deploys become routine enough that the runbook drift starts hurting, codify in `railway.toml` per service and lift the env wiring into Railway's variable references (it already supports `${{ payments-db.PGHOST }}`). Until then, prose + concrete commands beats config we don't actively maintain.

---

## ADR-019 — Drop `pgDriverVersion` from `ServiceNode`; bump snapshot to v2

**Date:** 2026-05-02
**Status:** Active. Closes the loop ADR-015 left open.

ADR-015 made `pgDriverVersion` non-load-bearing — `getRootCause` now reads `dependencies[driver]` for every driver in `compat.json`. The field stayed on `ServiceNodeSchema` as a UI/lookup convenience, but in practice it was a special case that only existed for one driver, and it would let a future contributor reintroduce pg-specific code paths without anyone noticing. v0.1.2-α removes it.

**What changes.**

- `pgDriverVersion` is gone from `ServiceNodeSchema` in `@neat/types`.
- Phase 1 of `extractFromDirectory` no longer sets it — `dependencies` carries the raw `package.json` map and that's the only declaration we ship.
- Snapshot `schemaVersion` bumps from `1` to `2`. `loadGraphFromDisk` migrates v1 snapshots in place by stripping `pgDriverVersion` from every node's attributes; the rest of the v1 payload flows through unchanged.
- Tests that previously asserted `serviceB.pgDriverVersion === '7.4.0'` now read `serviceB.dependencies?.pg`.

**Why migrate rather than hard-fail.** ADR-011 set the precedent that incompatible schema bumps throw on load; this bump is *forward-compatible*. Stripping a field that no consumer reads anymore is exactly the case where an automatic migration costs nothing and saves users a manual re-extract. The hard-fail path is reserved for genuinely incompatible changes (renaming an edge type, restructuring a node id format).

**One-way door check.** Adding `pgDriverVersion` back later would be trivial — it'd be a Zod field plus an extract-phase write. Nothing about removing it now traps the schema. If the v0.1.2 compat work (#74) ends up wanting per-driver hot-fields on `ServiceNode`, that's a generalised mechanism, not a re-litigation of this one field.
