# Decisions

Append-only ADR log. Each entry: what was decided, why, and the date. New decisions go to the bottom.

For the process — when to write an ADR, what shape, how supersession works, who ratifies — see [`docs/adr/README.md`](./adr/README.md). The starting shape for a new ADR is [`docs/adr/template.md`](./adr/template.md).

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

## ADR-003 — Dual ESM/CJS via tsup for every `@neat.is/*` package

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

- `pgDriverVersion` is gone from `ServiceNodeSchema` in `@neat.is/types`.
- Phase 1 of `extractFromDirectory` no longer sets it — `dependencies` carries the raw `package.json` map and that's the only declaration we ship.
- Snapshot `schemaVersion` bumps from `1` to `2`. `loadGraphFromDisk` migrates v1 snapshots in place by stripping `pgDriverVersion` from every node's attributes; the rest of the v1 payload flows through unchanged.
- Tests that previously asserted `serviceB.pgDriverVersion === '7.4.0'` now read `serviceB.dependencies?.pg`.

**Why migrate rather than hard-fail.** ADR-011 set the precedent that incompatible schema bumps throw on load; this bump is *forward-compatible*. Stripping a field that no consumer reads anymore is exactly the case where an automatic migration costs nothing and saves users a manual re-extract. The hard-fail path is reserved for genuinely incompatible changes (renaming an edge type, restructuring a node id format).

**One-way door check.** Adding `pgDriverVersion` back later would be trivial — it'd be a Zod field plus an extract-phase write. Nothing about removing it now traps the schema. If the v0.1.2 compat work (#74) ends up wanting per-driver hot-fields on `ServiceNode`, that's a generalised mechanism, not a re-litigation of this one field.

---

## ADR-020 — Bundle OTLP `.proto` files in-tree; opt-in gRPC receiver

**Date:** 2026-05-02
**Status:** Active.

The OTLP/gRPC receiver lives in `packages/core/src/otel-grpc.ts` and is only started when `NEAT_OTLP_GRPC=true`. It loads `.proto` files from `packages/core/proto/opentelemetry/proto/...` via `@grpc/proto-loader` at startup, decodes the binary wire format, reshapes the snake_case message into the same `OtlpTracesRequest` shape the HTTP receiver uses, and then reuses `parseOtlpRequest`.

**Why bundle the protos.** `@opentelemetry/proto` isn't published as an npm package, and the alternatives — pulling in `@opentelemetry/otlp-grpc-exporter-base` (the wrong direction; it's an exporter), hand-rolling protobuf decoding with `protobufjs`, or generating TypeScript stubs at build time — each carry more weight than four short `.proto` files copied verbatim from the upstream OpenTelemetry repo. The protos are Apache-2.0 / CC0 and stable across OTLP versions.

**Why opt-in.** Most NEAT installs run the HTTP path because that's what docker-compose's collector ships in this repo. Turning on a second listener by default would surprise existing operators and risk a port collision on `:4317`. `NEAT_OTLP_GRPC=true` is the explicit affordance; the documented flag means "I know I'm adding a transport." `NEAT_OTLP_GRPC_PORT` lets non-default deployments rebind.

**Why share `parseOtlpRequest`.** The HTTP and gRPC paths produce identical `ParsedSpan`s downstream. Anything past the receiver — `handleSpan`, `stitchTrace`, `upsertObservedEdge`, `markStaleEdges` — is transport-agnostic and stays that way. If the wire formats drift in a future OTLP rev, the divergence is contained in the receivers.

**When to revisit.** If a third transport lands (gRPC over Unix socket? OTLP/Arrow?), the reshape step starts looking like an interface rather than a function, and we extract a `Decoded → ParsedSpan[]` adapter type. Until then, two transports calling one decoder is the simpler shape.

---

## ADR-021 — Python extraction reads source via tree-sitter; NEAT's toolchain stays Node-only

**Date:** 2026-05-02
**Status:** Active.

v0.1.2-β #72 added Python service extraction. NEAT now reads `pyproject.toml`, `requirements.txt`, and Python source files (via `tree-sitter-python`), but the runtime stays pure Node 20 + TypeScript. No Python interpreter, no virtualenv, no `pip install`.

**Why tree-sitter, not the Python AST.** The actual Python `ast` module is the canonical parser, but using it would require shelling out to a Python interpreter (or pulling Python into the runtime). tree-sitter's Python grammar covers the surface area we care about — string literals for URL extraction, top-level `import` statements if we ever need them — and runs in-process via the same native binding pattern we already use for JavaScript. The cost is: tree-sitter-python doesn't model semantic Python (no type info, no scope analysis), but extraction never needed those.

**Why TOML via `smol-toml`.** `pyproject.toml` is the modern Python manifest and we need to read both PEP 621 `[project]` tables and the older Poetry `[tool.poetry.dependencies]` shape. `smol-toml` is a small, dep-free, spec-compliant parser. The alternative — regex — works for trivial cases but breaks on multi-line arrays and quoted keys; the dep is worth it.

**Why deps live in the same `dependencies` map.** `ServiceNode.dependencies` is `Record<string, string>` regardless of language. Python deps from `requirements.txt` (`name==version`) and pyproject (`name = "version"` or `["name==version", ...]`) get normalised into the same map. The compat matrix runs against both — `pg` checks JS services, `psycopg2` checks Python services — without per-language branching. `language: "javascript" | "python"` on the node is metadata, not a dispatch key.

**Where this could go wrong.** Unpinned deps (`requests>=2.0`) or non-`==` constraints record an empty version. The semver coercer in `compat.ts` already treats unparseable versions as "can't reason → don't flag," so we under-flag rather than over-flag. If γ's #74 wants stricter Python compat, the parser shape stays — only the matching logic changes.

**When to revisit.** When a third language lands (Go, Rust). At that point the per-language detector gets its own subdir like `extract/databases/` already does, and `services.ts` becomes a dispatcher. Two languages don't justify that split yet.

---

## ADR-022 — `infra:` taxonomy: one node type, kind-segmented ids

**Date:** 2026-05-02
**Status:** Active.

v0.1.2-β #73 populated `InfraNode` from docker-compose, Dockerfile, Terraform, and k8s. Every infra node uses the same id format: `infra:<kind>:<name>` (e.g. `infra:postgres:postgres`, `infra:container-image:node:20`, `infra:aws_s3_bucket:uploads`, `infra:k8s-deployment:default/web`).

**Why one node type, not many.** ADR-010 reserved the `infra:` prefix for a single `InfraNode` discriminant. The alternative — adding `Pg11Node`, `RedisNode`, `S3BucketNode`, etc. as separate top-level Zod variants — would duplicate the `id`/`name`/`provider` fields N times and force every traversal call site to know which variant to expect. A single `InfraNode` with an optional `kind: string` keeps `GraphNodeSchema`'s discriminated union at four members and lets sub-typing live in one place.

**Why `kind` is a free string, not an enum.** New infra sources land regularly (the four in #73 already span four different vocabularies — `postgres` from compose, `container-image` from Dockerfiles, `aws_s3_bucket` from Terraform, `k8s-deployment` from k8s). Locking `kind` to an enum would either (a) become stale instantly or (b) force every detector to register a new enum value before it can ship. A free string lets each detector pick its own naming, and the id format keeps it deterministic.

**Why the id segments matter.** Three pieces, in order: the prefix (`infra:`) so traversal can dispatch; the kind so consumers can group similar nodes (`get_dependencies` could filter "show only k8s objects"); the name so two services that both depend on `infra:postgres:postgres` collapse to the same node. ADR-010's "typed prefix joined to a stable name" generalises naturally — kind is just a sub-type within the prefix.

**Why no `DEPLOYS` / `RUNS_IN` edge types yet.** The issue floated those names. `RUNS_ON` (service → image) covers the Dockerfile case clearly; `DEPENDS_ON` (already in the enum) covers compose's `depends_on:` lists. Neither k8s nor Terraform needed new edge types in this pass — they emit cataloguing nodes only. If a later feature wants service-to-Deployment wiring, that's a new edge then, not now.

**Coexistence with DatabaseNode.** A docker-compose declaring Postgres produces both an `infra:postgres:<compose-name>` (from #73) and possibly a `database:<host>` (if a service's #70 parser reads that compose). They describe the same physical thing from different perspectives — the compose topology vs. the service's connection target — and they coexist. γ's #75 (FRONTIER population) is the natural place to deduplicate if it ever becomes a problem; right now it isn't.

**When to revisit.** If a `kind` value's vocabulary needs validation (e.g. compat reasoning that says "if `kind === 'postgres'` then..."), promote it to a constant set. The schema can stay a free string and just typecheck the values that matter.

---

## ADR-023 — `FrontierNode` as a fifth top-level node type

**Date:** 2026-05-02
**Status:** Active.

v0.1.2-γ #75 added a fifth member to `GraphNodeSchema`: `FrontierNode`. A frontier node is the placeholder ingest writes when an OTel span peer (`server.address`, `net.peer.name`, etc.) doesn't resolve to any known service. The id format is `frontier:<host>`. A later extraction round picks up the host as an alias on a real service, `promoteFrontierNodes` re-links the edges, and the placeholder goes away.

**Why a new node type, not an `InfraNode` kind.** ADR-022 deliberately kept the discriminated union at four. Frontier nodes broke that ceiling because they aren't classified by *what they are* — they're classified by *what they don't yet know*. They have a distinct lifecycle (placeholder → promoted → deleted), they carry temporal fields (`firstObserved`, `lastObserved`) that don't make sense on infra catalog entries, and a frontier node is supposed to disappear once extraction catches up. Cramming that into `InfraNode.kind = "frontier"` would have meant teaching every consumer of `InfraNode` to filter out a special case, and would have leaked frontier semantics into a node type whose whole job is to be permanent.

**Why a top-level type rather than a flag on `ServiceNode`.** A frontier doesn't have a language, dependencies, or a repo path — none of `ServiceNode`'s required fields apply. We considered making `ServiceNodeSchema` looser, but the schema's job is to fail loudly when something pretending to be a service isn't one. Promotion *converts* a frontier into the matching real service by re-linking edges and dropping the placeholder; the two never coexist as the same node.

**Why provenance `FRONTIER` already existed but the node type didn't.** The provenance enum has carried `FRONTIER` since M0 (it shipped in `@neat.is/types`'s constants). The original intent was always "we observed something but can't fully attribute it." γ #75 finally wired up the producer (ingest) and the consumer (extract's promotion phase). The provenance is set on the edge between the source service and the placeholder; once promoted, those edges flip to `OBSERVED` because the call certainty is real — only the target identity was the unknown.

**Aliases live on `ServiceNode`, not as a new edge type.** The alternative was an explicit `ALIASED_AS` edge from a service to each hostname. That would have grown the edge count linearly with cluster-DNS variants (`<name>`, `<name>.<ns>`, `<name>.<ns>.svc`, `<name>.<ns>.svc.cluster.local`) for every service every k8s manifest mentions. Storing them as a `string[]` on the service keeps the resolve path one map lookup and keeps the graph topology focused on real relationships.

**Where promotion runs.** At the end of every `extractFromDirectory` pass, after services + databases + configs + calls + infra. Promotion needs the full alias state from the latest extraction round, so it has to run last. Re-running ingest doesn't trigger promotion directly — it just keeps pinning frontier `lastObserved` — which is fine because the next extraction round will sweep them up.

**When to revisit.** If frontier nodes start sticking around (a host that never resolves no matter how many rounds pass), they become a UX signal: "you have unknown peers." That's a γ #76 concern (per-edge confidence) or δ ergonomics, not this ADR. The placeholder will continue to do its job until then.

---

## ADR-024 — Per-edge-type stale thresholds

**Date:** 2026-05-02
**Status:** Active.

A single 24h `STALE_THRESHOLD_MS` doesn't survive contact with diverse traffic. HTTP `CALLS` recur in seconds — 24h means a service could go down for the whole afternoon and the graph would still claim everything was fine. Infra `DEPENDS_ON` is the opposite — a docker-compose service idle overnight isn't a problem. v0.1.2-γ #78 splits the threshold per edge type: `CALLS` go stale at 1h, `CONNECTS_TO` / `PUBLISHES_TO` / `CONSUMES_FROM` at 4h, infra `DEPENDS_ON` / `CONFIGURED_BY` / `RUNS_ON` at 24h.

**Why a hardcoded default map, not a single tunable.** The defaults encode operational knowledge — "HTTP traffic is chatty, infra dependencies aren't" — and shouldn't have to be rediscovered per deployment. The map lives next to `markStaleEdges` in `ingest.ts`; new edge types fall back to 24h via a single sentinel constant, so adding to `EdgeType` doesn't silently bypass staleness sweeps.

**Why `NEAT_STALE_THRESHOLDS` is JSON, not per-flag env vars.** The variable count grows with `EdgeType` cardinality, and most deployments won't override anything — a single JSON blob is the path of least resistance. The parser tolerates malformed input (warn + fall back to defaults) so a typo can't take down the staleness loop.

**Why a stale-events ndjson log, not just edge mutations.** The graph stores the *current* state — once an edge flips to STALE, the OBSERVED → STALE transition is gone. That transition is the load-bearing fact (oncall wants to know "what just stopped working", not "what's currently quiet"). A per-line ndjson log is the same shape as `errors.ndjson`, replays cleanly, and a downstream consumer (alerting, dashboard) can tail it without touching the graph.

**Why expose it as `/incidents/stale` rather than another resource.** Stale-edge transitions *are* incidents in the operational sense — something stopped, oncall might care. Co-locating with `/incidents` keeps the surface coherent. The MCP tool `get_recent_stale_edges` mirrors `get_incident_history` so the questions ("what just broke?" / "what just went quiet?") have parallel answers.

**Where this could go wrong.** A flapping integration that calls every 65 minutes will oscillate between OBSERVED and STALE under the 1h `CALLS` default. The fix is to nudge the threshold (`NEAT_STALE_THRESHOLDS={"CALLS":7200000}`); the ndjson log will record both transitions so the oscillation itself is observable.

**When to revisit.** When δ #79's `neat watch` daemon runs continuously, the stale-events log will grow unbounded. Rotation / TTL belongs there, not here — this ADR's job is to define the shape; that one will define the lifecycle.

---

## ADR-025 — `semantic_search` embedding model: Ollama → Transformers.js → substring fallback chain

**Date:** 2026-05-03
**Status:** Active.

`semantic_search` shipped in M4 as a substring match over `id` and `name`. It works for "show me the payments service" — but loses to "what handles checkout payments?" because the literal token doesn't appear. v0.1.2-δ #82 replaces the keyword path with real embeddings while keeping the substring path as the lowest-tier fallback so the tool never disappears even on minimal hosts.

The embedding choice is the load-bearing decision in this work. We pick *one* default model and a fallback chain rather than a configurable provider matrix.

**The chain.** First match wins:

1. **Ollama** with `nomic-embed-text`, when `OLLAMA_HOST` is set (or `http://localhost:11434` is reachable on first use). 768-dim, 8K context, MIT-licensed, designed for retrieval. The user already pays the Ollama install cost; we just embed.
2. **Transformers.js** running `Xenova/all-MiniLM-L6-v2` in-process, when Ollama isn't around. 384-dim, ~25MB on-disk, fully offline, no model server needed. Cold-start cost is the model download (~25MB once, cached in `~/.neat/models/`) plus ~1s of WASM init.
3. **Substring fallback** — the existing M4 implementation, kept verbatim. Whatever was returned before still gets returned when neither embedder is available.

Every tier returns the same MCP-shaped response, so consumers don't branch on which one ran.

**Why Ollama as the default top tier.** It's the path of least resistance for users who already have it. Local, private, free, and the API surface (`POST /api/embeddings`) is small enough that we don't need an SDK dependency. `nomic-embed-text` consistently wins on retrieval benchmarks at its size class, and 768-dim cosine over a ≤10K-node graph is ~30ms — graph scale isn't the bottleneck.

**Why Transformers.js as the in-process fallback, not a server-side embed.** The fallback exists for the case "the user hasn't installed Ollama and we don't want to make them." Anything that requires a separate process or network call would just become the new "you have to install X" friction. Transformers.js runs inside Node via WASM/ONNX with no external server. The chosen model (`all-MiniLM-L6-v2`) is the de facto default for "I need embeddings, I don't have infrastructure." It's smaller and weaker than nomic, which is exactly why we order Ollama first.

**Why not OpenAI / Voyage / Cohere as defaults.** A hosted API would be the easiest to integrate but introduces an outbound network dependency and a credit cost on a tool that should "just work" against a local repo. NEAT runs against private codebases — sending node names to a third-party embedding endpoint is a category of decision a project should opt into, not inherit. Hosted providers can land later as a fourth tier (`NEAT_EMBED_PROVIDER=openai`) without changing the default.

**Why a flat in-memory cosine, not a vector DB.** The graph caps out at ~10K nodes for any realistic repo. A `Float32Array` per node and a linear scan is ~3ms at 10K × 768. Indexing structures (HNSW, IVF) are faster only above ~100K vectors and add a dependency that has to compile native bindings. ADR-002 already paid that price for tree-sitter; we don't pay it twice.

**What gets embedded.** Per node: `id + name + (description fragments — `language` for services, `engine`/`engineVersion` for databases, `kind` for infra)`. Edges are not embedded. Frontier nodes are not embedded — they're noise by design. The embed input is deterministic from node attrs so re-extracts hash-identical, and we use that hash to skip re-embedding nodes whose attrs didn't change.

**Cache shape.** A sidecar cache at `<scanPath>/neat-out/embeddings.json` keyed by `{ provider, model, dim }` plus per-entry `{ nodeId, attrsHash, vector }`. On startup the search index loads the cache, drops entries whose `attrsHash` doesn't match the current node, and embeds anything new. The cache is regenerable, gitignore-friendly (lives under `neat-out/` with the snapshot), and never touches the snapshot's `schemaVersion: 2` envelope.

**What this ADR isn't deciding.** Whether the substring tier should compute Jaro-Winkler or BM25 — the existing M4 substring code stays as-is. Whether the cache should be sqlite — JSON is fine at 10K vectors and the diff against an existing snapshot pattern works the same way. Whether `semantic_search` should accept a `provider` arg — let environment config drive the choice; the tool surface stays a one-arg `query`.

**When to revisit.** When (a) graph scale exceeds ~50K nodes (then the linear scan becomes the bottleneck and a vector index earns its complexity), (b) a hosted embedding provider lands as a tier (then the chain extends), or (c) the embed input materially changes (e.g. embedding evidence snippets from γ #71's edge metadata — a different decision than node-only embeddings).

---

## ADR-026 — Multi-project: dual-mounted routes, per-project paths, OTel stays single-project

**Date:** 2026-05-03
**Status:** Active.

v0.1.2-δ #83 replaces the `getGraph()` singleton with a `Map<string, NeatGraph>` keyed by project name. The shape is straightforward; three sub-decisions earn their own entries here because they're the parts a fresh agent will trip over.

**Routes are dual-mounted, not migrated.** Every project-scoped route is registered twice: once at the root (`/graph`, `/incidents/...`, etc.) and once under `/projects/:project/*`. A request hitting `/graph` runs the same handler as `/projects/default/graph`; `req.params.project ?? 'default'` is the only branch. Single-project users — anyone who installed pre-#83 — see no change to URL shape, response body, or status codes. The alternative (force every URL to carry the prefix and break old clients) was rejected because the "single-project" path is still the overwhelming majority of usage; making it the special case would inflate every command in the demo, the README, and every Claude Code prompt that doesn't care about projects.

**Default project keeps the legacy filenames.** `pathsForProject('default', baseDir)` returns `graph.json`, `errors.ndjson`, `stale-events.ndjson`, `embeddings.json` — byte-for-byte the paths β / γ shipped. Named projects fan out: `<project>.json`, `errors.<project>.ndjson`, `stale-events.<project>.ndjson`, `embeddings.<project>.json` — flat layout, one prefix per kind, parseable from a directory listing. We considered `neat-out/<project>/graph.json` per-project subdirs; rejected because (a) the snapshot files are the load-bearing artifact and the rest are sidecars, (b) flat files are easier to glob and `gh release` against, and (c) it would have moved the default project's snapshot from `neat-out/graph.json` to `neat-out/default/graph.json`, breaking every existing user.

**OTel ingest stays single-project.** Spans land in the default project's graph and write to its `errors.ndjson`. There's no project header on OTel resource attrs, no convention agents would know to set, and even if there were, agents emitting spans across multiple projects from one collector is a deployment shape we haven't seen. Multi-project users today run one `neat-core` per project, each pointing OTel at its own port. This ADR acknowledges that and makes the single-project ingest path explicit; revisiting means picking a span attribute (`neat.project`?) and threading it through `makeSpanHandler`.

**Server boot loads projects from `NEAT_PROJECTS=a,b,c`.** No filesystem scan. Each named project loads from `neat-out/<name>.json` if it exists, starts empty otherwise. Projects can also be wired to a scan path via `NEAT_PROJECT_SCAN_PATH_<NAME>` so `POST /projects/:name/graph/scan` works without a prior `neat init`. Filesystem-driven discovery (auto-load every `*.json` in `neat-out/`) was rejected because it conflates snapshot files with embeddings caches and other sidecars; the env var is explicit and forgettable in exactly the right cases.

**`neat init <path> --project <name>` writes the right snapshot file.** Default still goes to `<path>/neat-out/graph.json`; named projects to `<path>/neat-out/<name>.json`. `NEAT_OUT_PATH` overrides — if set, it wins. `neat watch <path> --project <name>` does the same plus boots a daemon; multi-project watch (one daemon serving multiple projects with its own chokidar per project) is deferred — the typical workflow is one daemon per project.

**MCP tools take an optional `project` arg.** Tools omit it by default, the HTTP client uses the legacy unprefixed URL, and the core resolves that to `default`. When `NEAT_DEFAULT_PROJECT=alpha` is set on the MCP server, every tool call without an explicit `project` routes through `/projects/alpha/...`. The arg can override per-call. Same shape for resources — `neat://node/<id>` always resolves against the configured project, and `neat://incidents/recent` polls `/projects/<project>/incidents` (or `/incidents` when no project is set) for change detection.

**When to revisit.** Per-project OTel ingest (when a real multi-project deployment surfaces and one collector emitting to multiple project graphs becomes a thing). Auto-loading projects from disk (when manual `NEAT_PROJECTS` becomes the source of bug reports). Per-project default thresholds, embedders, or scan depth (when a project actually needs to override these — none does today, so they all stay process-global).

---

## ADR-027 — MVP success is closing a real PR on an unfamiliar open-source codebase, not running the pg demo

**Date:** 2026-05-04
**Status:** Active.

The pg demo (a service running pg 7.4.0 against PostgreSQL 15) was stood up to prove the graph + provenance + traversal stack works end to end. It does. But the demo was scaffolded against a failure mode we engineered ourselves, in a controlled environment we built to fail in a specific shape. Closing a real PR on a codebase we did not engineer — where the bug is not pre-staged, the maintainers do not know about it, and the fix has to be correct enough to merge — is a different and much higher bar.

This ADR records that the second bar is the actual MVP success criterion. The pg demo was a stepping stone that became the destination by accident of incremental delivery.

**Why this is the right bar.** A static-only find on a real repo (e.g. the FastAPI lexicographic-version-comparison shape — `"3.10" < "3.9"` because string compare) is reproducible by any tree-sitter-based tool. Graphify in particular already does this category of thing for ~39K users. A NEAT PR that closes a static-shaped bug doesn't differentiate the product; it confirms a Graphify fork could match it. The PR that earns NEAT its category is one where the OBSERVED layer was load-bearing — runtime signal that tree-sitter alone could not have predicted, connected back to a code decision through the graph.

**The trace stitcher is evidence, not a workaround.** PROVENANCE.md records that pg 7.4.0 is too old for `@opentelemetry/instrumentation-pg`, so the demo's own database spans never emit; the INFERRED layer was added to bridge the gap. We had been treating that as a demo-environment compromise. It is in fact a small instance of the load-bearing fact NEAT exists to surface: in real systems, OBSERVED ground truth requires instrumentation that does not always exist, and the gap between what you can see and what you must infer is not a clean line. Every real codebase has a much larger version of this gap. NEAT's job is to make that gap navigable.

**What follows for the roadmap.** Two parallel tracks share `main`:

- **Track 1 — v0.3.0 (frontend).** Investor-legibility. Jed's work, against the stable v0.1.2 API. Doesn't gate the MVP success criterion; the headline metric is "PR merged on a repo we didn't engineer," not "graph renders pretty."
- **Track 2 — v0.2.0 (Sunrise, audit-driven cleanup) → v0.2.1 (policies) → v0.2.2 (`neat init` + Claude skill).** Engineering work. v0.2.0 redeems the prototype against the seven contract documents in `docs/audits/`. v0.2.1 closes the four-feature gap (OTel + graph + MCP + policies) and gives NEAT the data model that makes intent-vs-observed-reality first class. v0.2.2 collapses NEAT's installation to one command + a Claude skill so it can be pointed at any codebase. Together they are what makes the MVP-success PR experiment runnable.

The numbering communicates priority: engineering ships first as the v0.2.x cluster; frontend lands as v0.3.0. The two tracks remain technically independent — neither blocks the other.

**What's deferred until after the MVP-success PR.** Auto-PR generation (NEAT writes the patch, not just identifies the divergence). Hosted MCP. Multi-tenant policy stores. None of these change whether NEAT can find a real bug; they only matter once it can.

**What this ADR is not deciding.** Which open-source repo we point NEAT at first; that's a product call once the platform is in shape. Whether the codemod or eBPF route is the v0.2.2 default; that's the ADR that lands when v0.2.2 starts. Whether v0.3.0 frontend ships before or after v0.2.x; the tracks are independent.

**When to revisit.** When the first real PR closes — flip the framing from "can NEAT do this" to "what's the next bar." Until then this ADR stays the active project gravity.

---

## ADR-028 — Node identity is constructed via helpers, not string literals

**Date:** 2026-05-05
**Status:** Active.

Node identity is the deepest concern in the graph. Every edge connects two nodes by id; if two producers disagree on what id a service gets, OBSERVED edges from one never match EXTRACTED edges from the other and the coexistence contract (contracts.md Rule 2) silently fails.

Today identity is scattered across 12 hand-rolled sites in 9 files (services.ts, ingest.ts, configs.ts, databases/index.ts, infra/shared.ts, calls/{aws,kafka,redis,grpc}.ts). Each producer constructs its own id via template literal. Consistency holds by good behavior, not by the type system.

**Decision.**

1. **Id patterns are functions, not literals.** A new module `packages/types/src/identity.ts` exports `serviceId`, `databaseId`, `configId`, `infraId`, `frontierId` plus their inverses (`parseServiceId`, etc.). Producers call these. No producer constructs a node id by template literal.

2. **The id patterns themselves stay what they are today.** This ADR doesn't change the wire format — `service:<name>`, `database:<host>`, `config:<relPath>`, `infra:<kind>:<name>`, `frontier:<host>`. It just gives them a single source of truth.

3. **Auto-created and static-extracted nodes merge by id.** When OTel ingest auto-creates a `ServiceNode` for an unseen `span.service` (issue #134) and static extraction later produces a `ServiceNode` with the same id, they merge — they do not coexist as duplicates. The id is the merge key. Static-extracted fields (language, version, dependencies) override OTel-derived fields (which are absent or sparse) where both exist; OTel-derived fields (lastObserved on associated edges, span counts) survive untouched.

4. **FrontierNode promotion preserves identity continuity.** When a FrontierNode at `frontier:<host>` is promoted to a typed node — typically a ServiceNode at `service:<name>` after an alias resolves — the FrontierNode is removed and the typed node takes its place. Edges that pointed at the frontier id are rewritten to point at the new typed id. This is what `promoteFrontierNodes` already does in ingest.ts; ratified here.

5. **Workspace scoping is deferred.** A monorepo with two services both named `shared-utils` in different workspaces collides under `service:shared-utils`. Today this is left to `addServiceAliases` to disambiguate via host:port mapping, which doesn't actually rename the service. Real fix is workspace-scoped ids like `service:<workspace>/<name>`. Defer until a real codebase trips it. Document the limitation; do not silently re-engineer the id format without a successor ADR.

6. **Database id is host-only, not host:port.** Two databases on the same host with different ports collide. Defer the fix; document the limitation.

**Why the identity helpers are in `@neat.is/types`, not `@neat.is/core`.**

Both producers and consumers need them. Producers (extract/, ingest.ts) construct ids; consumers (traverse.ts, MCP tools, REST handlers) sometimes parse them (api.ts:202 strips a `service:` prefix today). Putting helpers in `@neat.is/types` keeps the module that owns the schemas as the single source of truth for the wire format, and avoids a circular dependency between core and any producer-only id module.

**Enforcement.**

`packages/core/test/audits/contracts.test.ts` gains a regression test: scan `packages/core/src/` and `packages/mcp/src/` for hand-rolled id patterns (`service:`, `database:`, `config:`, `infra:`, `frontier:` inside template literals). The only allowed sites are inside `@neat.is/types/identity.ts` itself, and inside test fixtures. CI fails any future session that drifts.

`docs/contracts.md` Rule 16 records the binding form: "Node ids are constructed via the helpers in `@neat.is/types/identity.ts`. Hand-rolled template literals constructing node ids are a contract violation."

**What this ADR is not deciding.**

Edge identity (different ADR — comes next as #2 in the contract list). Provenance ranking (already locked in contracts.md Rule 1-2). Lifecycle transitions (different ADR — #3 in the list). Workspace-scoped ids and host:port database ids (deferred per items 5 and 6).

**When to revisit.**

When a real codebase trips the workspace-collision case (item 5) or the host:port-collision case (item 6) — at that point write a successor ADR introducing scoped ids, and migrate snapshots via the v2→v3 path persist.ts already supports.

---

## ADR-029 — Edge identity and provenance ranking

**Date:** 2026-05-05
**Status:** Active.

Edges are the second layer of identity, downstream of nodes (ADR-028). Today four edge id patterns exist — one per provenance variant — and they live in three different places:

- `makeEdgeId(source, target, type)` in `packages/core/src/extract/shared.ts:67` produces EXTRACTED ids (`${type}:${source}->${target}`).
- `makeObservedEdgeId(type, source, target)` in `packages/core/src/ingest.ts:115` (local) produces OBSERVED ids (`${type}:OBSERVED:${source}->${target}`).
- `makeInferredEdgeId(type, source, target)` in `packages/core/src/ingest.ts:119` (local) produces INFERRED ids (`${type}:INFERRED:${source}->${target}`).
- A bare template literal at `packages/core/src/ingest.ts:182` produces FRONTIER ids (`${type}:FRONTIER:${source}->${target}`).

Three patterns have helpers, one is inline. The helpers themselves are scattered. The traversal layer also encodes a separate concern — the `PROV_RANK` constant in `packages/core/src/traverse.ts:16-22` that orders edges by trust during walks. That ranking is part of the provenance contract; it doesn't belong only to traversal.

**Decision.**

1. **Edge id helpers move into `@neat.is/types/identity.ts`.** Five exports: `extractedEdgeId`, `observedEdgeId`, `inferredEdgeId`, `frontierEdgeId`, plus `parseEdgeId(id)` returning `{ type, provenance, source, target }` or `null`. Producers call the helpers; nobody constructs an edge id by template literal.

2. **The wire format stays what it is today.** ADR-029 doesn't change the edge id strings — it gives them a single source of truth. EXTRACTED has no provenance segment; OBSERVED, INFERRED, and FRONTIER carry the provenance segment between type and source. STALE never appears in an edge id because STALE is a transition of an existing OBSERVED edge, not a creation pattern (ADR-024).

3. **`PROV_RANK` moves into `@neat.is/types`.** The ordering `OBSERVED > INFERRED > EXTRACTED > STALE | FRONTIER` is part of the provenance contract, not traversal-private. Traversal imports it. Future consumers (policies, MCP tools, the daemon's reconciliation layer) import the same constant.

4. **Coexistence rule reaffirmed.** Multiple edges between the same node pair under distinct provenance ids coexist — they do not collapse. The id pattern is what makes coexistence mechanically possible: the EXTRACTED id and OBSERVED id are different strings, so `graph.hasEdge(...)` doesn't conflate them. This was already true in the code (ingest.ts:15-17 documents intent); ADR-029 ratifies it as the contract.

5. **Per-edge confidence semantics per provenance:**
   - **OBSERVED** — `confidence: 1.0` always. Direct measurement; the value is a max-trust marker, not a derived score.
   - **INFERRED** — `confidence ≤ 0.7`, default `0.6` (`INFERRED_CONFIDENCE` constant). Set at edge creation by the trace stitcher; never exceeds 0.7 because INFERRED is by definition less trustworthy than OBSERVED.
   - **EXTRACTED** — confidence is **not stored** on EXTRACTED edges. EXTRACTED edges either exist (the static analyzer found them) or they don't. They don't decay on a clock; their confidence is implicit in their existence.
   - **STALE** — confidence drops to `≤ 0.3` on transition, set at transition time. The original `lastObserved` is preserved.
   - **FRONTIER** — confidence is implicit in the FRONTIER provenance itself; not stored as a numeric field. FRONTIER is excluded from traversal (contracts.md Rule 3) so its confidence is never compared.

6. **Round-trip guarantee.** `parseEdgeId(extractedEdgeId('A', 'B', 'CALLS'))` returns `{ type: 'CALLS', provenance: 'EXTRACTED', source: 'A', target: 'B' }`. Same for the other three variants. This lets consumers (traversal, MCP tools, debugging code) walk back from an id to its parts without re-deriving the format inline.

**Why these helpers are in `@neat.is/types`, not `@neat.is/core`.**

Same reason as ADR-028: producers and consumers both need them. The traversal layer reads edge ids when walking; the persist layer reads them on snapshot load; the MCP layer reads them when surfacing edges. `@neat.is/types` already owns the schema for the edge structure; it should own the wire format too.

**Enforcement.**

`packages/core/test/audits/contracts.test.ts` adds a regression test that scans `packages/core/src/` and `packages/mcp/src/` for hand-rolled edge id template literals — patterns like `` `${type}:${source}->...` ``, `` `:OBSERVED:` ``, `` `:INFERRED:` ``, `` `:FRONTIER:` `` outside `@neat.is/types/identity.ts`. CI fails any future session that drifts.

`docs/contracts/provenance.md` records the binding rules in short form, governs `packages/core/src/{ingest,traverse,persist}.ts` and `packages/core/src/extract/**` (anywhere edges are constructed or compared).

**What this ADR is not deciding.**

Lifecycle transitions (OBSERVED→STALE, FrontierNode promotion, ghost-edge cleanup) — that's contract #3, the next ADR. Edge schema field-set (`source`, `target`, `evidence`, `signal`, `lastObserved`, etc.) — already locked in `packages/types/src/edges.ts`. Provenance enum values — already locked in `packages/types/src/constants.ts`.

**When to revisit.**

If a new provenance variant is introduced (e.g. `OBSERVED-NET` if eBPF capture lands post-v1.0 — see the v0.x discussion thread), this ADR gets a successor that adds the new id pattern and PROV_RANK entry without changing the existing four.

---

## ADR-030 — Node and edge lifecycle

**Date:** 2026-05-05
**Status:** Active.

The third data-layer contract. ADR-028 locked node identity, ADR-029 locked edge identity and provenance ranking. This ADR locks the rules for **when** nodes and edges enter the graph, **how** they transition, and **who** has authority over each transition.

Today the lifecycle is implemented across `packages/core/src/ingest.ts`, `packages/core/src/extract/index.ts`, and `packages/core/src/watch.ts` — the rules are correct but scattered, with no single document specifying them. This ADR records them so future producers, consumers, and tests don't have to reverse-engineer the policy from code.

**Decision.**

### 1. Node creation

- **Static creation** lives in `packages/core/src/extract/`. `services.ts`, `databases/index.ts`, `configs.ts`, and `infra/*` are the only sites that produce typed nodes (Service, Database, Config, Infra). Each producer constructs the id via `@neat.is/types/identity` helpers (ADR-028). Each producer is idempotent — `graph.hasNode(id)` guards every `addNode` call, so a re-extract does not duplicate.

- **Auto-creation from OTel** is queued under issue #134. When an OTel span arrives for a `service.name` not present in the graph, `ingest.ts` will create a minimal `ServiceNode` at `serviceId(span.service)`. Static extraction that later finds the same service merges into the auto-created node by id; static fields (language, version, dependencies) override; OTel-derived fields (`lastObserved` on associated edges) survive untouched. **The id is the merge key.** This is the reconciliation rule from ADR-028 §3 applied at the lifecycle layer.

- **FrontierNode creation** lives in `ingest.ts`. When `handleSpan` resolves a peer host that doesn't match any known service or database, it creates a `FrontierNode` at `frontierId(host)` and an OBSERVED edge from the source service to the FrontierNode (the FRONTIER edge variant of the same call). The FrontierNode is a placeholder; the call itself is real and stays observed.

### 2. Node transitions

- **FrontierNode → typed node (promotion).** `promoteFrontierNodes(graph)` in `ingest.ts:408` runs after each extract pass (`extract/index.ts:42`) and after each `watch` tick (`watch.ts:153`). For every FrontierNode whose `host` matches a known service alias, the FrontierNode is dropped and edges that pointed at it are rewritten to point at the typed node. The FrontierNode never persists as a partial state — promotion is atomic per node.

- **Edge rewrite during promotion.** Each edge incident to the promoted FrontierNode is dropped and rebuilt under the typed-node id (`rewireFrontierEdges` + `rebuildEdge` in `ingest.ts:436-470`). On rewrite, `FRONTIER` provenance is **upgraded to `OBSERVED`** because the call certainty was always there — only the target identity was unknown, and now it isn't. Other provenance values pass through unchanged.

### 3. Node retirement

- **Today: only via FrontierNode promotion.** A FrontierNode is dropped when promoted; nothing else gets retired automatically.

- **Ghost-node cleanup (queued under #140).** When a service disappears from source between extract passes, the `ServiceNode` (and its associated edges) should be retired. The contract is: retirement is **driven by source absence**, not by clock decay. Static-extracted nodes don't have a `lastObserved`; they exist while their source declaration exists. This is the lifecycle counterpart to ghost-edge cleanup; both block on the source-mtime tracking work in #140.

### 4. Edge creation

- **Static (EXTRACTED).** `extract/*` producers via `extractedEdgeId(...)`. Idempotent via `graph.hasEdge(id)` guard.
- **Observed (OBSERVED).** `upsertObservedEdge` in `ingest.ts:218`. Idempotent: if the edge id exists, attributes are replaced; otherwise the edge is created. **Returns `null` if either endpoint node is missing** (`ingest.ts:226`) — this is the gap issue #134 closes by auto-creating missing nodes.
- **Inferred (INFERRED).** `upsertInferredEdge` in `ingest.ts:298`. Created by the trace stitcher on error spans, depth ≤ 2 from the originating service. Confidence ≤ 0.7, default 0.6.
- **Frontier (FRONTIER).** `upsertFrontierEdge` in `ingest.ts:181`. Created when OTel resolves a peer to no known node.

### 5. Edge transitions (binding rules)

- **OBSERVED → STALE.** `markStaleEdges` in `ingest.ts:521`, called by the background staleness loop (`startStalenessLoop`, default 60s tick). Per-edge-type thresholds (ADR-024). The transition is in place — the edge id stays at `${type}:OBSERVED:${source}->${target}`; only `provenance` flips to `STALE` and `confidence` drops to `0.3`. `lastObserved` is preserved. Each transition appended to `stale-events.ndjson`.

- **STALE → OBSERVED (resurrection).** When a new span arrives for an existing STALE edge, `upsertObservedEdge` overwrites `provenance` back to `OBSERVED` and `confidence` back to `1.0` (`ingest.ts:233-244`). **The transition is implicit — there is no explicit "resurrect" function.** The id stayed the same through the STALE phase, so the upsert finds the existing edge and replaces attributes.

- **FRONTIER → OBSERVED.** Only via FrontierNode promotion (see §2). Never standalone — a FRONTIER edge cannot become OBSERVED without its FrontierNode endpoint resolving to a typed node.

- **No other transitions exist.** EXTRACTED never decays. INFERRED never transitions. STALE never goes anywhere except back to OBSERVED via resurrection.

### 6. Edge retirement

- **Today: only via FrontierNode promotion.** Edges incident to a promoted FrontierNode get dropped and rebuilt; the old edge is gone.

- **Ghost-edge cleanup (issue #140).** When a source file is edited or removed, EXTRACTED edges that were derived from that file should be retired. Today this doesn't happen — re-extraction adds new edges but never removes old ones. The fix is part of the v0.2.1 tree-sitter rebuild and depends on `evidence.file` being present on every EXTRACTED edge (queued under the same issue).

### 7. Authority — who owns what transition

| Transition                        | Owner module                  |
|-----------------------------------|-------------------------------|
| Static node creation              | `extract/*`                   |
| Static edge creation              | `extract/*`                   |
| OBSERVED edge upsert              | `ingest.ts` `upsertObservedEdge` |
| INFERRED edge creation            | `ingest.ts` `upsertInferredEdge` (via `stitchTrace`) |
| FRONTIER node creation            | `ingest.ts` `handleSpan`      |
| FRONTIER edge creation            | `ingest.ts` `upsertFrontierEdge` |
| OBSERVED → STALE                  | `ingest.ts` `markStaleEdges` (background loop) |
| STALE → OBSERVED                  | `ingest.ts` `upsertObservedEdge` (implicit on re-arrival) |
| FrontierNode → typed (+ edge rewrite + FRONTIER → OBSERVED) | `ingest.ts` `promoteFrontierNodes`, triggered by `extract/index.ts` and `watch.ts` |
| Ghost-edge / ghost-node cleanup   | `watch.ts` (queued under #140)|
| Auto-create ServiceNode/DatabaseNode from OTel | `ingest.ts` `handleSpan` (queued under #134) |

`traverse.ts`, `compat.ts`, `persist.ts`, `api.ts`, and `packages/mcp/src/` **never** mutate node or edge state. They are read-only consumers of the lifecycle.

### 8. Idempotency

Every creation path is idempotent: re-running the same producer with the same input produces the same graph state. `graph.hasNode(id)` and `graph.hasEdge(id)` guards make this hold even when watch-driven re-extraction fires the same producer many times. Tests in `packages/core/test/` exercise idempotency directly (e.g. `discover-services.test.ts`).

### 9. Atomicity

Each lifecycle operation is synchronous within a single call to its owner function. `handleSpan` runs to completion against the graph before yielding (the only `await` is the trailing `appendErrorEvent` after mutations are settled). `promoteFrontierNodes` rewires all incident edges and drops the FrontierNode in one synchronous pass. `markStaleEdges` walks the edge set in a single pass. There is no point at which a partial transition is observable to a concurrent reader.

This relies on Node's single-threaded event loop and is sufficient for MVP scale. If NEAT later needs concurrent multi-process ingest, atomicity becomes an explicit concern and gets its own ADR.

**Enforcement.**

`packages/core/test/audits/contracts.test.ts` adds:
- An assertion that no module outside `packages/core/src/ingest.ts` and `packages/core/src/extract/` mutates the graph (no `dropNode`, `dropEdge`, `addNode`, `addEdge*`, `replaceEdgeAttributes`, `replaceNodeAttributes` calls).
- Behavioral assertions: STALE → OBSERVED resurrection (edit a STALE edge's lastObserved → call upsertObservedEdge → confirm provenance flips back, confidence is 1.0); FRONTIER → OBSERVED on promotion.

`docs/contracts/lifecycle.md` records the binding rules in short form, governs the same files as the provenance contract plus `watch.ts` and `extract/index.ts`.

**What this ADR is not deciding.**

Schema growth versus shape changes (contract #4, the next ADR). The exact shape of `evidence` on EXTRACTED edges (queued under #140 + the v0.2.1 tree-sitter rebuild). Auto-creation of ServiceNode/DatabaseNode from OTel (queued under #134, lands in v0.2.2). Ghost cleanup (queued under #140, lands in v0.2.1). Each of those is an implementation; this ADR specifies the rules they must implement.

**When to revisit.**

When ghost cleanup ships (#140) or auto-creation ships (#134) — both will refine the lifecycle table and move items out of "queued" status. When concurrent multi-process ingest becomes a real requirement (post-v1.0 or post-eBPF), atomicity needs its own ADR.

---

## ADR-031 — Schema growth versus schema shape

**Date:** 2026-05-05
**Status:** Active.

The fourth and final data-layer contract. ADR-028, ADR-029, and ADR-030 locked node identity, edge identity + provenance, and lifecycle. Each one expects the underlying schemas in `@neat.is/types` to remain stable in shape while still being allowed to grow. This ADR pins down the difference.

**The distinction.**

- **Growth** is **additive**. A new optional field on an existing schema. A new helper export. An extra non-breaking method. Code written against the previous schema continues to work; data persisted under the previous schema continues to load. No migration needed.

- **Shape change** is **breaking**. Renaming a field. Changing a field's type (`string` → `number`). Removing a field. Removing or renaming an enum value. Tightening a refinement so previously-valid data no longer parses. Changing a discriminated-union discriminator. Code written against the previous schema breaks; data persisted under the previous schema fails to load without migration.

The two have different costs and different processes. Growth is cheap and frequent. Shape change is expensive, rare, and gated.

**Decision.**

1. **Growth is allowed in any commit, no ADR required.**

   Adding `framework?: string` to `ServiceNodeSchema` (issue #142) is growth. Adding `extractedAt?: string` to GraphEdge `evidence` (issue #140) is growth. Adding a new value to `EdgeType` (e.g. `EMITS` if a new edge type lands) is growth, since older code that switches over `EdgeType` simply doesn't match the new value — it doesn't crash. The schema snapshot is updated in the same commit; the snapshot diff is the audit trail.

2. **Shape change requires an ADR opened in the same PR.**

   The ADR records:
   - What changed (field removed, type changed, enum value removed, etc.).
   - Why the breaking change is justified.
   - How the persistence layer migrates old data (`packages/core/src/persist.ts` v→v+1 migration code).
   - How long the migration is supported (typically: at least one minor version after introduction).

   Examples of shape changes the project has already made: ADR-019 (`pgDriverVersion` removed from ServiceNode, snapshot v1→v2 migration in `persist.ts`).

3. **Migration path is `persist.ts`.**

   The snapshot loader at `packages/core/src/persist.ts` runs version-keyed migrations. Each shape-change ADR adds a new migration function and bumps the persisted version. The migration is *one-way* (forward only); we don't support downgrade. Old snapshots load cleanly into the new schema; new snapshots can't be loaded by old code, which is fine because we ship newer code in newer releases.

4. **Enforcement is mechanical via a schema snapshot.**

   `packages/core/test/audits/schema-snapshot.test.ts` introspects every binding schema in `@neat.is/types` (`GraphNodeSchema`, `GraphEdgeSchema`, `ProvenanceSchema`, `EdgeTypeSchema`, `ErrorEventSchema`, `RootCauseResultSchema`, `BlastRadiusResultSchema`, plus the FrontierNode / individual node schemas) and produces a normalized JSON tree describing fields, types, enum values, discriminator keys.

   The tree is compared against `packages/core/test/audits/schemas.snapshot.json`. If they differ, the test fails with a message instructing the developer to either:
   - Run the snapshot updater (a small script), commit the diff in the same PR if the change is growth.
   - Or open an ADR documenting the shape change, then update the snapshot.

   The developer can't quietly break shape — the snapshot fails before merge. The git diff on the snapshot is a structural record of every schema change the project has ever made.

5. **What counts as "binding" for the snapshot.**

   Anything in `@neat.is/types` that consumers depend on:
   - `GraphNodeSchema` and the five node variants.
   - `GraphEdgeSchema`.
   - `ProvenanceSchema` (enum values).
   - `EdgeTypeSchema` (enum values).
   - `ErrorEventSchema`.
   - Result schemas (`RootCauseResultSchema`, `BlastRadiusResultSchema`).
   - Identity helpers' output types are *not* snapshotted — those are functions, not data structures, and ADR-028 / ADR-029 govern them directly.

   Internal Zod refinements (`.min()`, `.max()`, `.regex()`) are recorded in the snapshot when they're load-bearing for downstream consumers (e.g. `confidence: z.number().min(0).max(1)`). Cosmetic refinements (`.describe()` strings used for LLM hints) are excluded.

6. **Growth is encouraged when consumers ask for it.**

   The contract is permissive for growth specifically because future producer / consumer rebuilds (v0.2.1 tree-sitter, v0.2.2 OTel, v0.2.3 traversal, v0.2.4 policies) will each ask for new optional fields. The default answer is "yes — add the optional field, snapshot the change, ship." The friction is reserved for shape changes, which deserve discussion.

**Why this contract is small.**

ADR-031 doesn't add helpers or refactor code. It's a meta-contract — the rule for how the previous three contracts evolve. The snapshot test is the entire enforcement mechanism. No new module, no new helper, no new abstraction.

**What this ADR is not deciding.**

Specific schema additions queued for v0.2.x cleanup (`framework`, `evidence.file` on every EXTRACTED edge, `path` and `confidence` on `BlastRadiusAffectedNode`). Those land under their respective issues (#142, #140, #137) and trip the snapshot fail in CI; the developer commits the new snapshot alongside the implementation.

**When to revisit.**

When the snapshot file becomes hard to review — say it grows past 500 lines and a real shape change is hard to spot in the diff. At that point we either split the snapshot per schema or write a smarter diff tool. Today the schema set is small enough that a single JSON file is sufficient.

---

## ADR-032 — Static extraction contract

**Date:** 2026-05-05
**Status:** Active.

The first producer-layer contract. Static extraction (`packages/core/src/extract/**`) is the producer that reads source code and config files to build the EXTRACTED layer of the graph. Today's producers work but disagree on what evidence they carry, when re-extraction retires old edges, and what counts as a producer at all. v0.2.1's tree-sitter rebuild needs these locked before the cleanup issues (#140, #141, #142, #145) can ship without re-introducing drift.

**Decision.**

1. **Every EXTRACTED edge carries `evidence: { file, line?, snippet? }`.** Today only CALLS-family edges do (`calls/http.ts`, `calls/aws.ts`, `calls/kafka.ts`, `calls/grpc.ts`, `calls/redis.ts`). CONNECTS_TO (databases), CONFIGURED_BY (configs), DEPENDS_ON / RUNS_ON (infra) edges currently have no evidence. The contract growth: every producer that writes an EXTRACTED edge attaches at least `evidence.file` — the source path the edge was derived from, relative to the scan root, forward slashes regardless of platform. `line` and `snippet` are optional but strongly preferred when the producer can compute them cheaply.

2. **Ghost-edge cleanup is keyed on `evidence.file`.** When a file changes or disappears between extract passes, every EXTRACTED edge whose `evidence.file` matches that path is dropped before the producer reruns. Re-extraction recreates the edges that still apply; the deleted code's edges stay deleted. The cleanup is owned by `watch.ts` per ADR-030's lifecycle authority — it fires the producer's path-keyed retire step, then reruns the producer. This closes the v0.1.x bug where re-extraction accumulates stale edges indefinitely (issue #140).

3. **Producer interface.** Every producer module under `extract/` exports a single async function with the signature `(graph: NeatGraph, services: DiscoveredService[], scanPath: string) => Promise<...>`. Producers are pure with respect to graph state outside their own writes — they never read the OBSERVED layer, never call `compat.json` outside `compat.ts`, never trigger MCP or REST. They can read from the filesystem within `scanPath` and from each service's `dir`. They emit nodes and edges via `graph.addNode` / `graph.addEdgeWithKey`, guarded by `hasNode` / `hasEdge` for idempotency.

4. **Language dispatch.** Source-file parsing routes by extension: `.js` / `.jsx` / `.mjs` / `.cjs` / `.ts` / `.tsx` use the `tree-sitter-javascript` grammar (TypeScript falls through; using `tree-sitter-typescript` is a future improvement, not in scope for this contract). `.py` uses `tree-sitter-python`. Other extensions are skipped silently by `walkSourceFiles` per `IGNORED_DIRS` and the `SERVICE_FILE_EXTENSIONS` set in `extract/shared.ts`. New language support requires adding the grammar import and the extension dispatch in one place.

5. **Depth and ignore policy.** Recursive directory walk from `scanPath` is bounded by `NEAT_SCAN_DEPTH` (default 5, configurable). `.gitignore` is honored. `IGNORED_DIRS` (`node_modules`, `.git`, `.turbo`, `dist`, `build`, `.next`, plus `__pycache__` and `vendor` once added — see issue #142's neighborhood) is the canonical skip set. `package.json#workspaces` triggers monorepo expansion; `pnpm-workspace.yaml` and `turbo.json` are not yet read (deferred).

6. **Idempotency under re-extraction.** Every producer is idempotent: re-running the same producer on the same input produces the same graph state. `graph.hasNode(id)` and `graph.hasEdge(id)` guards already enforce this; the contract reaffirms it. Idempotency is what makes ghost-edge cleanup safe — the path-keyed retire step plus re-extraction always converges on the source's current state.

7. **`framework` on ServiceNode is schema growth, not a new contract.** Issue #142's `framework?: string` field is governed by the schema-growth contract (ADR-031) — `ServiceNodeSchema` gains an optional field, the snapshot regenerates, the producer in `extract/services.ts` populates it from a package-name → framework-label table. This contract names the population rule (read from `dependencies` and `devDependencies`) but the schema-snapshot guard handles enforcement.

**Producers in scope (the locked set).**

- `services.ts` — ServiceNode from `package.json` and `pyproject.toml`.
- `aliases.ts` — host:port aliases for FrontierNode promotion (governed by the lifecycle contract; this contract just confirms it as a producer).
- `databases/*` — DatabaseNode + CONNECTS_TO from ORM configs, `.env`, docker-compose. Today no evidence; #140 fixes that.
- `configs.ts` — ConfigNode + CONFIGURED_BY for yaml / yml / `.env` files.
- `calls/*` — source-level CALLS / PUBLISHES_TO / CONSUMES_FROM edges via HTTP URLs, AWS SDK, gRPC, Kafka, Redis. Today carries evidence — keep.
- `infra/*` — InfraNode + DEPENDS_ON / RUNS_ON from docker-compose, Dockerfile, k8s, Terraform.
- New producers under `calls/` for source-level DB connections (`new pg.Pool(...)`) and inter-service imports — issue #141. Same evidence shape, same idempotency, same interface.

**Enforcement.**

`packages/core/test/audits/contracts.test.ts` adds:
- A scan asserting every EXTRACTED-edge construction site under `packages/core/src/extract/` includes an `evidence` field with at least a `file` key. Currently CALLS-family producers pass; CONNECTS_TO / CONFIGURED_BY / DEPENDS_ON / RUNS_ON producers fail until #140 lands. The assertion lands as `it.todo` keyed to #140 and flips when the issue closes.
- A producer-interface assertion: every module under `extract/` exporting a function whose name matches `add(Service|Database|Config|Edge|Infra)Nodes?|add\w+Edges?` accepts `(graph, services, scanPath)` (or a strict subset). Catches drift toward producer signatures that diverge.
- An idempotency test: run a producer twice on the same fixture, assert node/edge count unchanged.

`docs/contracts/static-extraction.md` records the binding rules in short form and is auto-surfaced by the PreToolUse hook whenever any file under `extract/` is edited.

**What this ADR is not deciding.**

The shape of source-level DB-connection detection (issue #141 — that's an implementation choice within the producer interface). Whether `tree-sitter-typescript` should replace the JS-falls-through approach (deferred — TS fallback works, the grammar swap is its own cleanup). The framework-detection package-name table (lives in `compat.json` or a sibling data file, not in the contract). Workspace-scoped service ids (deferred per ADR-028). Dev-container handling (deferred per the init audit's open questions).

**When to revisit.**

When source-level DB-connection detection (#141) lands — that introduces a new producer pattern (`new pg.Pool(...)` etc.) and the contract may need to specify its evidence shape more precisely (e.g. constructor-name in the snippet). When ghost-edge cleanup (#140) ships — the contract's path-keyed retire step becomes load-bearing and might surface edge cases.

---

## ADR-033 — OTel ingest contract

**Date:** 2026-05-05
**Status:** Active.

The first of three v0.2.2 producer-layer contracts. Governs the OTel ingest path in `packages/core/src/ingest.ts` plus the receiver in `otel.ts` and `otel-grpc.ts`. Sibling contracts: ADR-034 (trace stitcher) and ADR-035 (FrontierNode promotion). They share vocabulary and govern overlapping concerns; together they lock the OBSERVED layer.

**Decision.**

1. **Receiver replies before mutation (issue #131).** The OTLP/HTTP receiver in `packages/core/src/otel.ts` and the gRPC receiver in `packages/core/src/otel-grpc.ts` reply 200 OK immediately on receipt. Mutation runs through a non-blocking handler — either an in-process queue drained on the next tick, or a fire-and-forget pattern with bounded concurrency. **The sender is never blocked on graph mutation.** OTel SDK exporters retry on timeout, so blocking ingest causes observable backpressure on the system being observed; ambient observation requires no observable effect.

2. **`lastObserved` is sourced from `span.startTimeUnixNano`, not `Date.now()` (issue #132).** Every OBSERVED edge's `lastObserved` field is derived from the parsed span's start time, converted to ISO8601. Replayed traces, out-of-order spans, and historical fill-ins must produce a `lastObserved` that reflects when the span actually fired — not when the receiver happened to receive it. The ISO8601 conversion lives in `parseOtlpRequest` (otel.ts) so every consumer of `ParsedSpan.startTimeUnixNano` gets a normalized form.

3. **Cross-service CALLS edges correlate via parent-span cache (issue #133).** Today peer resolution uses `server.address` / `net.peer.name` / `url.full` only. That misses non-HTTP RPCs and any span whose peer is opaque. The contract adds a bounded TTL cache keyed by `${traceId}:${spanId}` storing each span's service. On span arrival, peer resolution falls through to a `parentSpanId` lookup in the cache: if the parent's service is known and differs from the current service, that's a cross-service CALLS edge. Cache size and TTL are constants near the other ingest tunables in `ingest.ts`. Out-of-order arrival (child before parent) drops the child cleanly; we don't buffer.

4. **Auto-creation of ServiceNode and DatabaseNode for unseen peers (issue #134).** When `handleSpan` resolves a `service.name` not present in the graph, it creates a minimal ServiceNode at `serviceId(span.service)` with `language: 'unknown'`, no `version`, no `dependencies`. Same for unseen `db.system` + host — a minimal DatabaseNode at `databaseId(host)`. Auto-created nodes carry `discoveredVia: 'otel'` (schema growth governed by ADR-031 — adds an optional field to ServiceNode/DatabaseNode, snapshot regenerates). Static extraction that later finds the same id **merges** attributes per ADR-028 §3 reconciliation rule; static fields override OTel-derived fields where both exist, but `discoveredVia` is only updated to `'merged'` if both layers recorded the node independently.

5. **Exception data parsed from span events (issue #135).** `OtlpSpan` is extended with `events: Array<{ name, timeUnixNano, attributes }>` in the parser. When a span has an `events[]` entry with `name === 'exception'`, the parser extracts `exception.type`, `exception.message`, and `exception.stacktrace` from its attributes. `handleSpan`'s ErrorEvent path prefers `exception.message` over `status.message` over `span.name`. `exception.type` is added to ErrorEvent as an optional field (schema growth via ADR-031).

6. **HTTP receiver supports both JSON and protobuf bodies.** Today only JSON. The receiver checks `Content-Type` and dispatches to either `parseOtlpJsonRequest` or `parseOtlpProtobufRequest`. Protobuf parsing uses the bundled `.proto` definitions (ADR-020). gRPC continues to handle protobuf natively.

7. **`db.system` is data, not a switch.** Engine identification is read from the span attribute as a string and never compared against a hardcoded list (no `if (db.system === 'postgresql')` branches). Engine-specific behavior lives in `compat.json` and is consulted via `compat.ts` per the demo-name-freedom contract (Rule 8 in `docs/contracts.md`).

8. **Error events are ndjson-appended, never lost on receiver shutdown.** `appendErrorEvent` writes to `errors.ndjson` synchronously after the graph mutation but before the receiver replies — this is the one explicit ordering point. If the file write fails, the receiver returns 500 so the OTel SDK retries. ErrorEvent shape stays as defined in `@neat.is/types` per the schema-growth contract; new fields land via the snapshot guard.

**Authority.**

The OTel ingest contract is owned by `packages/core/src/ingest.ts` per ADR-030 lifecycle authority. The receiver shape lives in `otel.ts` / `otel-grpc.ts`; mutation logic lives in `ingest.ts`. Neither file may be mutated outside the producer-author's edits during v0.2.2.

**Enforcement.**

`packages/core/test/audits/contracts.test.ts` adds `it.todo` items keyed to issues #131-#135. They flip to live assertions as each issue ships:
- non-blocking ingest (timing-based test on the receiver),
- `lastObserved` from span time (replay-a-backdated-span fixture),
- parent-span cache correlation (parent-then-child fixture, child-then-parent fixture),
- auto-creation (span for unseen service produces ServiceNode),
- exception event parsing (span with `events[]` produces ErrorEvent with exception fields).

**What this ADR is not deciding.**

Trace stitcher rules — see ADR-034. FrontierNode promotion — see ADR-035. Whether `discoveredVia` becomes a generalized provenance-on-nodes field (deferred — today it's a service/database-level concern, not a node-shape concern). eBPF / mesh-Net source variants (deferred to v1.0+ per the v0.2.x discussion).

**When to revisit.**

When auto-creation lands and OTel-only services start landing in real codebases — the merge rules (#4) might surface edge cases the contract didn't anticipate. When a non-Node OTel SDK arrives that uses semconv variants the parser doesn't handle — the address picker (`pickAddress`) might need extension.

---

## ADR-034 — Trace stitcher contract

**Date:** 2026-05-05
**Status:** Active.

Governs the trace stitcher in `packages/core/src/ingest.ts` (`stitchTrace`, `upsertInferredEdge`). The trace stitcher is what bridges OBSERVED gaps when an instrumentation library can't emit spans for a particular driver — the demo's pg 7.4.0 case (PROVENANCE.md, ADR-027). It's the load-bearing concrete example of NEAT's value: when declared intent and observed reality diverge, NEAT infers the bridge and labels it as inferred.

Sibling contracts: ADR-033 (OTel ingest), ADR-035 (FrontierNode promotion).

**Decision.**

1. **Stitcher fires only on ERROR spans.** `stitchTrace` is called by `handleSpan` only when `span.statusCode === 2`. The stitcher's job is to surface inferred dependency paths when an erroring service was exercising downstream services that may not have been observed directly. Non-error spans don't trigger inference — if the call succeeded, the OBSERVED layer captured what it could and INFERRED edges aren't needed.

2. **Depth limit of 2 hops, hardcoded.** `STITCH_MAX_DEPTH = 2` in `ingest.ts`. Walking deeper produces speculative edges that are too far from the originating error to claim relevance. The constant is a contract value, not a tunable — changing it requires an ADR amendment.

3. **Walks EXTRACTED outbound edges only.** The stitcher BFS-walks `graph.outboundEdges(node)` and considers only edges where `provenance === Provenance.EXTRACTED`. OBSERVED edges already carry the relationship (no inference needed). INFERRED edges are themselves the stitcher's output (no recursion). FRONTIER edges represent unknown territory and are excluded per Rule 3 of `docs/contracts.md`. STALE edges represent decayed observation and are not inferable from a fresh error.

4. **OBSERVED-twin skip rule (issue: refinement).** When the stitcher considers an EXTRACTED edge `(source, target, type)`, it checks whether an OBSERVED edge for the same triplet already exists (`graph.hasEdge(observedEdgeId(source, target, type))`). If so, the OBSERVED edge already provides ground-truth coverage for that hop — the stitcher skips it and does not produce an INFERRED twin. Today the stitcher writes INFERRED edges regardless of OBSERVED twins; the rule closes that gap.

5. **Confidence is `0.6` by default, capped at `0.7`.** `INFERRED_CONFIDENCE = 0.6` is the default applied at edge creation. The stitcher does not produce edges with confidence > 0.7 even if a custom override is added later — INFERRED is by definition less trustworthy than OBSERVED, which carries `1.0`. The cap is a contract value.

6. **Idempotent on re-arrival.** When a second error span produces the same stitched edges, `upsertInferredEdge` updates `lastObserved` on the existing edge — it does not create duplicates, does not increment a confidence score, does not add evidence. The edge id (`inferredEdgeId(source, target, type)`) is the deduplication key.

7. **Origin generality.** `stitchTrace(graph, sourceServiceId, ts)` accepts any `service:*` id as the origin. No special-case for the demo (`service:service-b`); no hardcoded driver ('pg'); no hardcoded engine ('postgresql'). The stitcher walks whatever EXTRACTED edges exist outbound from the erroring service.

8. **No node creation.** The stitcher only writes edges. It never creates nodes; it never modifies existing nodes; it doesn't extend across FrontierNode boundaries.

**Authority.**

`stitchTrace` is owned by `ingest.ts` per ADR-030. Called only from `handleSpan` (error path). No other module triggers stitching.

**Enforcement.**

`contracts.test.ts` includes:
- A live test asserting `stitchTrace` produces no edges when called with a node that has no outbound EXTRACTED edges.
- A live test asserting `STITCH_MAX_DEPTH` is enforced (depth-3 EXTRACTED chain produces edges only at depth 1 and 2).
- An `it.todo` keyed to the OBSERVED-twin-skip refinement, which lands when implementation does.
- An idempotency test (calling `stitchTrace` twice produces identical edge state).

**What this ADR is not deciding.**

Per-edge confidence beyond the default 0.6 (no implementation requires it today). Stitcher behavior on FRONTIER edges (excluded — never traversable). Stitching across multiple traces (single-trace context only; cross-trace inference is a v1.0 concern).

**When to revisit.**

When a real codebase's INFERRED layer becomes load-bearing for the MVP-success PR (ADR-027) and the depth-2 limit produces too many or too few edges. When OBSERVED coverage improves enough that the stitcher fires rarely — at that point the OBSERVED-twin-skip rule is doing most of the work and the contract may simplify.

---

## ADR-035 — FrontierNode promotion contract

**Date:** 2026-05-05
**Status:** Active.

Governs `promoteFrontierNodes` in `packages/core/src/ingest.ts`. FrontierNodes (ADR-023) are placeholders for OTel peers that don't match any known service. Promotion is the act of replacing a FrontierNode with a real typed node once an alias resolves the host. The contract locks the trigger conditions, alias-match rules, edge-rewrite semantics, and the FRONTIER → OBSERVED provenance upgrade.

Sibling contracts: ADR-033 (OTel ingest), ADR-034 (trace stitcher).

**Decision.**

1. **Promotion runs after every extract pass.** `promoteFrontierNodes(graph)` is called at the end of `extract/index.ts:extractFromDirectory` and at the end of every watch-driven phase rerun in `watch.ts`. Promotion is **batched per pass**, not per-edge. The ingest path itself does not trigger promotion — only the static-extraction lifecycle does, because aliases land during static extraction.

2. **Alias matching: name first, then alias list.** The function walks every ServiceNode and builds a `Map<string, string>` from `attrs.name → id` and `attrs.aliases[i] → id`. Then it walks every FrontierNode and looks up `attrs.host` in the map. First match wins. If the FrontierNode's host doesn't resolve, the FrontierNode persists for the next extract pass to handle. **Aliases are populated by `extract/aliases.ts`** — typically docker-compose service names, k8s metadata.name, Dockerfile labels.

3. **Promotion is atomic per FrontierNode.** When a FrontierNode is selected for promotion, all of its incident edges (inbound and outbound) are rewired to the typed node id, and the FrontierNode is dropped — in one synchronous pass. There is no point at which a partial state is visible. ADR-030 §9 atomicity applies.

4. **Edge rewrite rebuilds the edge under the new id.** `rewireFrontierEdges` walks `graph.inboundEdges(frontierId)` and `graph.outboundEdges(frontierId)`. For each, `rebuildEdge` drops the old edge and constructs a new edge under the typed-node id. This is the only place in the codebase where an edge id changes — not because the edge content changed, but because one of its endpoints did.

5. **Provenance upgrade rule: FRONTIER → OBSERVED.** When `rebuildEdge` is rewriting an edge whose provenance was `FRONTIER`, the new edge's provenance is `OBSERVED`. The reasoning: the call certainty was always there (the OTel span was observed), only the target identity was unknown. Now it's known, so the edge graduates from placeholder to direct measurement. Other provenance values (EXTRACTED, INFERRED) pass through unchanged.

6. **Edge id construction MUST use the canonical helpers.** `rebuildEdge` constructs the new edge id via `observedEdgeId`, `inferredEdgeId`, etc. from `@neat.is/types/identity` (ADR-029). Hand-rolling a template literal like `` `${edge.type}:${promotedProvenance}:${newSource}->${newTarget}` `` is a contract violation. **Today's `rebuildEdge` at `ingest.ts:463` does hand-roll this id** — a v0.2.2 cleanup task: replace the literal with a dispatch on `promotedProvenance` to the appropriate canonical helper. The contracts.test.ts scan (#2) didn't catch it because the literal interpolates the provenance variable rather than embedding `:OBSERVED:` directly. The scan is extended in this batch.

7. **Edge merge on collision.** If the rewritten edge id already exists (because an OBSERVED edge between the typed source and target was previously created independently), the rebuilt edge merges into the existing one: `callCount` sums, `lastObserved` takes the later timestamp via `pickLater`. No duplicate edge is created.

8. **No reverse promotion.** A typed node never reverts to a FrontierNode. If OTel later observes a peer that matches no known service, a *new* FrontierNode is created at a different host id; the previously-promoted typed node is unaffected.

**Authority.**

`promoteFrontierNodes` is owned by `ingest.ts` per ADR-030. Triggered by `extract/index.ts` and `watch.ts`. No other module calls it.

**Enforcement.**

`contracts.test.ts` includes:
- A live test asserting alias-matched FrontierNode is promoted, edges are rewired, FRONTIER provenance becomes OBSERVED on rebuilt edges (already exists from contract #3 lifecycle work — extended here to also assert id construction routes through `observedEdgeId`).
- A new live test asserting `rebuildEdge` does not hand-roll edge id template literals — extended hand-rolled-template-literal scan that includes the provenance-variable case (catches `${edge.type}:${promotedProvenance}:...`).
- An `it.todo` keyed to the rebuildEdge-uses-canonical-helpers fix, which lands as part of the v0.2.2 cleanup against this contract.

**What this ADR is not deciding.**

Cross-host-port database ids (deferred per ADR-028 §6). Workspace-scoped service ids that change the alias-matching shape (deferred per ADR-028 §5). Promotion across project scopes (single-project per ADR-026; cross-project promotion is post-multi-project work).

**When to revisit.**

When workspace scoping lands and aliases need to scope to a workspace. When the alias index becomes a bottleneck on large monorepos (today rebuilt every promotion call; could be cached if the call frequency justifies it).

---

## ADR-036 — Traversal contract

**Date:** 2026-05-06
**Status:** Active.

The first of three v0.2.3 consumer-layer contracts. Governs `packages/core/src/traverse.ts` overall — the shared mechanics (edge priority, confidence cascading, FRONTIER exclusion, no-mutation rule) that both `getRootCause` and `getBlastRadius` rely on. Sibling contracts: ADR-037 (getRootCause), ADR-038 (getBlastRadius). They share vocabulary; the three together lock the read-side of the graph.

**Decision.**

1. **Edge priority is `PROV_RANK` at every hop.** When multiple edges connect the same node pair under different provenances (the coexistence case from contract #2), traversal picks the highest-priority edge via `PROV_RANK` from `@neat.is/types/identity`. `bestEdgeBySource` and `bestEdgeByTarget` apply this rule per neighbour. Selection happens at every step of the walk, not just the starting node.

2. **FRONTIER edges are excluded, not deprioritized (issue #136).** Today FRONTIER ranks 0 alongside STALE in `PROV_RANK`. That makes it pickable when no other edge exists between a pair — wrong per Rule 3 of `docs/contracts.md`. The contract: `bestEdgeBySource` / `bestEdgeByTarget` skip every edge with `provenance === FRONTIER` before ranking. If a node's only edges are FRONTIER, traversal halts at that node — `getRootCause` returns null, `getBlastRadius` does not enqueue past it.

3. **Confidence cascades via product, not min.** Per-edge confidence is `provenance × volume × recency × cleanliness` (`confidenceForEdge`). Walks of multiple edges multiply per-edge confidences (`confidenceFromMix`). The min-rule from earlier framing is superseded — the multiplicative cascade is the real implementation and the more honest semantic: each hop is an independent piece of evidence, and uncertainty compounds.

4. **No mutation.** `traverse.ts` is read-only per ADR-030 lifecycle authority. It calls only `graph.hasNode`, `graph.getNodeAttributes`, `graph.getEdgeAttributes`, `graph.inboundEdges`, `graph.outboundEdges`. It must never call `addNode`, `addEdge`, `dropNode`, `dropEdge`, `replaceEdgeAttributes`. The mutation-authority scan in `contracts.test.ts` already catches this.

5. **Schema validation before return.** Both `getRootCause` and `getBlastRadius` MUST call `RootCauseResultSchema.parse(...)` / `BlastRadiusResultSchema.parse(...)` on the result before returning (issue #139). A schema violation throws, which the API handler converts to a 500. Better that than shipping a malformed result to MCP or REST consumers.

6. **Origin must exist.** Both functions handle `!graph.hasNode(originId)` gracefully — `getRootCause` returns `null`, `getBlastRadius` returns `{ origin, affectedNodes: [], totalAffected: 0 }`. Neither throws.

7. **Helpers from `@neat.is/types/identity` for any id construction or parsing.** Traversal occasionally synthesizes ids (e.g. checking for an OBSERVED twin during stitcher work — see contract #7) or parses ids back to their parts. Both operations route through `parseEdgeId` / `observedEdgeId` / etc. Hand-rolled template literals are a contract violation.

**Authority.**

`traverse.ts` is a read-only consumer. Owns no transitions. Reads from the live graphology instance per Rule 6 of `docs/contracts.md` — never reads `graph.json`.

**Enforcement.**

`packages/core/test/audits/contracts.test.ts` includes (or adds for v0.2.3):
- The mutation-authority scan already covers traverse.ts (assertion: zero mutating calls outside `ingest.ts` / `extract/*`).
- A live test for FRONTIER exclusion: a graph where the only path between two nodes is via a FRONTIER edge. `getRootCause` returns null; `getBlastRadius` does not include the far-side node. (Issue #136.)
- A live test for schema validation: the `RootCauseResult` and `BlastRadiusResult` returned by traversal must `.parse()` cleanly against their Zod schemas. (Issue #139.)
- Round-trip tests on `confidenceFromMix` to assert multiplicative cascading.

**What this ADR is not deciding.**

`getRootCause`-specific concerns (origin generality, reason format) — see ADR-037. `getBlastRadius`-specific concerns (distance shape, per-node fields) — see ADR-038. The shape of FRONTIER promotion (covered by ADR-035). NeatScript-style traversal API or differential dataflow — both v1.0.

**When to revisit.**

When MCP-side consumers surface real-world traversal queries on large graphs and the multiplicative cascade produces confidence values that don't match human intuition. When new edge-confidence signals are added (e.g. per-driver health metrics) and the four-factor product needs a fifth term.

---

## ADR-037 — `getRootCause` contract

**Date:** 2026-05-06
**Status:** Active.

The second v0.2.3 consumer contract. Governs `getRootCause` in `packages/core/src/traverse.ts:174-240`. Sibling contracts: ADR-036 (traversal mechanics), ADR-038 (getBlastRadius).

`getRootCause` walks incoming edges from an error-surfacing node looking for an upstream incompatibility that explains the failure. Today it only fires on `DatabaseNode` origins (the driver/engine compat-matrix shape from ADR-014 and the demo). Issue #123 calls for generalization beyond databases.

**Decision.**

1. **Origin generality (issue #123).** `getRootCause` accepts any origin node and dispatches by `node.type` to a shape-specific check:

   - **DatabaseNode** — driver/engine compat shape (today's behavior; preserved unchanged). Walks incoming edges, looks for ServiceNodes whose `dependencies[driver]` declares an incompatible version against the database's `engine` + `engineVersion`.
   - **ServiceNode** — node-engine and package-conflict shapes via `compat.ts` (`checkNodeEngineConstraint`, `checkPackageConflict`). Walks incoming edges, looks for upstream services with declarations that violate the erroring service's `engines.node` or peer-package requirements.
   - **InfraNode / ConfigNode** — return null. No matrix shape today; future ADR may extend.
   - **FrontierNode** — return null. Frontier nodes have no compat surface and are excluded from traversal anyway per ADR-036.

   The dispatch lives in a `rootCauseShapes` table that maps `NodeType → (graph, originId, walk) => RootCauseResult | null`. Adding a new shape is one entry in the table, not a code restructure.

2. **Walks incoming edges to depth 5.** `ROOT_CAUSE_MAX_DEPTH = 5` is hardcoded. Walks deeper produce paths that stretch credulity (the demo's two-hop cause is the typical case). Changing the depth requires an ADR amendment.

3. **`longestIncomingWalk` is DFS; first-incompatibility wins.** The walk explores backward from the origin. The longest path produced becomes the candidate; the first incompatibility found along it is the root cause. If no incompatibility is found, `getRootCause` returns null.

4. **`reason` is human-readable.** Built from the compat result's `reason` field. If an `errorEvent` is provided, the observed error message is appended in parentheses: `${reason} (observed error: ${errorEvent.errorMessage})`. Never a raw `compat.json` entry; always a sentence.

5. **`fixRecommendation` is derived from the compat result.** Today: `Upgrade ${svc.name} ${pair.driver} driver to >= ${result.minDriverVersion}`. The pattern generalizes: each compat shape produces its own fix-recommendation string. The shape-specific check is the only place that knows what the fix is; the dispatcher just propagates it.

6. **Result schema-validated.** `RootCauseResultSchema.parse(result)` runs before return. Throws on violation; the API handler renders a 500.

7. **Returns null cleanly.** When the origin doesn't exist, when no incompatibility is found, when the origin's node type has no shape — `getRootCause` returns `null` with no throw.

8. **Edge provenance in result.** `edgeProvenances` is the array of provenance values along the traversal path, in order from origin to root cause. Length is `traversalPath.length - 1` (one entry per edge). Already enforced in code; reaffirmed in contract.

**Authority.**

Owned by `traverse.ts`, read-only. Calls into `compat.ts` for the actual incompatibility checks; never duplicates that logic.

**Enforcement.**

`contracts.test.ts` adds:
- A live test that `getRootCause` returns null cleanly when called with an origin whose `node.type` has no registered shape (e.g. ConfigNode).
- A live test that ServiceNode origins produce a result when an upstream service has a node-engine violation (the #123 generalization).
- A live test asserting `edgeProvenances.length === traversalPath.length - 1`.
- A live test asserting `.parse(RootCauseResultSchema, result)` succeeds for every valid return.
- A live test that the result's `traversalPath[0]` is the origin and the last entry is `rootCauseNode`.

**What this ADR is not deciding.**

The complete list of compat shapes (driver-engine + node-engine + package-conflict + deprecated-api are in `compat.ts` today; new shapes land via `compat.json` data, not contract amendment). Whether `getRootCause` should also surface secondary causes (defer — single root cause is the v0.2.3 contract; multi-cause is post-v1.0). The depth-5 limit (revisit when real codebases produce 5-hop paths and either confirm or reject the bound).

**When to revisit.**

When the second non-DatabaseNode origin shape is added (#123 generalization actually exercised) — the dispatch table should be reviewed for ergonomics. When MCP consumers want secondary-cause output.

---

## ADR-038 — `getBlastRadius` contract

**Date:** 2026-05-06
**Status:** Active.

The third v0.2.3 consumer contract. Governs `getBlastRadius` in `packages/core/src/traverse.ts:245+` and the result schemas in `packages/types/src/results.ts`. Sibling contracts: ADR-036 (traversal mechanics), ADR-037 (getRootCause).

**Decision.**

1. **BFS outbound from origin.** Visits each reachable node once, recording the shortest distance from origin. `bestEdgeByTarget` picks the highest-priority edge per neighbour per ADR-036. FRONTIER excluded.

2. **Default depth 10, overridable per call.** `BLAST_RADIUS_DEFAULT_DEPTH = 10` is the default; callers can pass `maxDepth` explicitly. Practical limit: depth past ~10 produces results dominated by graph branching that aren't useful.

3. **Distance is a positive integer (issue #138).** Schema growth toward shape: `BlastRadiusAffectedNodeSchema.distance` becomes `z.number().int().positive()` (effectively `min(1)`). The origin itself is never in `affectedNodes` — distance 0 has no meaning. Today the schema permits `nonnegative` (allows 0); the cleanup tightens it. **This is a schema shape change** — but no production data emits `distance: 0` (the BFS at line 266 explicitly skips frame-0), so the migration is no-op. Persist.ts may not need a migration function; the v2→v3 bump is recorded in the schema-snapshot diff.

4. **Per-node payload (issue #137).** `BlastRadiusAffectedNode` carries:
   - `nodeId: string`
   - `distance: number` (positive integer, see above)
   - `edgeProvenance: Provenance` — the provenance of the edge that brought traversal to this node
   - `path: string[]` — node ids from origin to this node, inclusive at both ends, length = distance + 1
   - `confidence: number` — `confidenceFromMix(...edgesAlongPath)`, in `[0, 1]`

   Today only the first three fields are present. `path` and `confidence` are schema growth (new optional fields → required after the cleanup ships). The BFS already tracks parents internally; surfacing the path is wiring, not new computation.

5. **`totalAffected` is the count of `affectedNodes`.** No double-counting, no inclusion of the origin. Identity: `result.totalAffected === result.affectedNodes.length`. Today's code already enforces this; the contract reaffirms it.

6. **Empty origin case.** When the origin doesn't exist or has no outgoing edges, returns `{ origin, affectedNodes: [], totalAffected: 0 }`. Never throws.

7. **Result schema-validated.** `BlastRadiusResultSchema.parse(result)` before return. Same as `getRootCause`.

8. **Path ordering.** `path[0] === origin` and `path[path.length - 1] === affectedNode.nodeId`. Reverse-path or skip-the-origin variations are contract violations.

**Authority.**

Owned by `traverse.ts`, read-only. The BFS frame's `parent` chain is reconstructed into `path` at the moment of first visit (when we discover the shortest distance to a node).

**Enforcement.**

`contracts.test.ts` adds:
- The existing `it.todo` for `BlastRadiusAffectedNode carries path and confidence` (issue #137) flips to a live assertion.
- The existing `it.todo` for `BlastRadius distance schema rejects 0` (issue #138) flips to a live assertion.
- The existing `it.todo` for schema validation (issue #139) flips to a live assertion that calls the function and `.parse()`s the result.
- A new live test asserting `path[0] === origin` and `path[path.length - 1] === affectedNode.nodeId` for every entry in `affectedNodes`.
- A live test that `totalAffected === affectedNodes.length`.
- A live test that the origin itself is not in `affectedNodes`.

**Schema-snapshot impact.**

Adding `path` and `confidence` to `BlastRadiusAffectedNodeSchema` is growth (new fields on an existing schema). The schema-snapshot test will fail until the developer regenerates with `UPDATE_SNAPSHOT=1`. Tightening `distance` from `nonnegative` to `positive` is a shape change in the strict sense — old data with `distance: 0` would no longer parse — but no real producer emits `distance: 0`, so it's an effective no-op. The snapshot diff is the audit trail for both.

**What this ADR is not deciding.**

Whether blast radius should expand to inbound edges (no — by definition, blast radius is downstream impact). Whether the BFS should compute confidence-weighted shortest paths (no — shortest by edge count is the v0.2.3 contract; weighted-shortest is a v1.0 NeatScript concern). Pagination on large blast radii (defer; today's MVP graphs are small enough that returning the full list is fine).

**When to revisit.**

When real codebase blast-radius queries return >100 affected nodes and pagination becomes a UX concern. When the MCP-side three-part response (contract #12 in v0.2.4) needs to format blast radius and the contract's `path` shape doesn't match the formatter's needs.

---

## ADR-039 — MCP tool surface contract

**Date:** 2026-05-06
**Status:** Active.

The first of seven v0.2.4 contracts. Governs `packages/mcp/src/`. Sibling contracts: ADR-040 (REST API), ADR-041 (persistence), ADR-042-045 (policies).

**Decision.**

1. **Tool count is locked at nine.** Eight today (`get_root_cause`, `get_blast_radius`, `get_dependencies`, `get_observed_dependencies`, `get_incident_history`, `semantic_search`, `get_graph_diff`, `get_recent_stale_edges`) plus `check_policies` (lands with v0.2.4 #117). The audit's `evaluate_policy` + `get_policy_violations` two-tool split is rejected per CLAUDE.md framing — one tool with `scope?` and `hypotheticalAction?` arguments handles both cases.

2. **Three-part response format (issue #143).** Every tool emits a natural-language paragraph, a structured block, and a footer line `confidence: X.XX · provenance: OBSERVED|EXTRACTED|...`. Confidence and provenance are derived per-result. Empty result → footer reads `confidence: n/a · provenance: n/a`. Helper `formatToolResponse` lives in `packages/mcp/src/format.ts`; every tool routes through it.

3. **`get_dependencies` is transitive (issue #144).** Default depth 3, max 10. Calls a new core endpoint `GET /graph/node/:id/dependencies?depth=N`.

4. **No `graph.json` reads.** Every tool calls REST against `NEAT_CORE_URL`.

5. **No demo-name hardcoding in tool logic.** Allowed only inside Zod `.describe()` strings.

6. **Project scoping.** Optional `project?: string`, defaulting to `'default'` per ADR-026.

7. **`semantic_search` documentation reflects the ADR-025 embedder chain**, not "keyword search."

8. **Stdio transport only for MVP.** HTTP / SSE / WebSocket post-MVP.

**Authority.** Read-only. Owned by `packages/mcp/src/`.

---

## ADR-040 — REST API contract

**Date:** 2026-05-06
**Status:** Active.

Governs `packages/core/src/api.ts`. Sibling contracts: ADR-039, ADR-041.

**Decision.**

1. **Dual-mount per ADR-026.** Every route mounts at both `/X` and `/projects/:project/X` via `registerRoutes(scope, ctx)`.

2. **Read-side endpoints (locked).** `GET /health`, `/graph`, `/graph/node/:id`, `/graph/edges/:id`, `/graph/dependencies/:nodeId?depth=N` (new for #144), `/graph/blast-radius/:nodeId?depth=N`, `/graph/root-cause/:nodeId`, `/graph/diff?against=path`, `/search?q=...`, `/incidents`, `/stale-events`, `/policies`, `/policies/violations`.

3. **Write-side endpoints.** `POST /graph/scan`, `POST /policies/check`. The OTLP receiver lives on its own port.

4. **JSON errors.** `{ error, status, details? }`. 400 / 404 / 500. No HTML pages.

5. **Schema validation on inbound bodies** via Zod from `@neat.is/types`.

6. **Project param defaults to `'default'`.**

7. **Live graphology, never `graph.json`.**

---

## ADR-041 — Persistence contract

**Date:** 2026-05-06
**Status:** Active.

Governs `packages/core/src/persist.ts`. Sibling contracts: ADR-039, ADR-040.

**Decision.**

1. **Snapshot location.** Default project: `<scanPath>/neat-out/graph.json` per ADR-017. Named projects: `~/.neat/projects/<name>/graph.json` per ADR-026.

2. **`SCHEMA_VERSION = 2` today.** Schema growth (ADR-031) does not bump the version; only shape changes do.

3. **Forward-only migrations.** Old snapshots load cleanly; new snapshots cannot be loaded by old code.

4. **Lifecycle.** Loaded once at startup; persisted on interval (default 60s) + `SIGTERM`/`SIGINT`.

5. **Append-only ndjson sidecars.** `errors.ndjson`, `stale-events.ndjson`, `policy-violations.ndjson` (v0.2.4). No rewrites, no rotation.

6. **Multi-project isolation.** `Map<string, NeatGraph>` keyed by project name.

7. **Nothing else reads `graph.json`** per Rule 6.

---

## ADR-042 — Policy schema contract

**Date:** 2026-05-06
**Status:** Active.

The first of four policy contracts. Governs `packages/types/src/policy.ts` (new). Sibling contracts: ADR-043, ADR-044, ADR-045.

**Decision.**

1. **`policy.json` at the project root** (not `neat-out/`). Version-controlled in the user's repo.

2. **Top-level shape.** `{ version: 1, policies: Policy[] }`. `version: z.literal(1)`.

3. **`Policy` shape.** `{ id, name, description?, severity, onViolation, rule }`. `id` uniqueness checked at load.

4. **Five rule types (MVP).** `structural`, `compatibility`, `provenance`, `ownership`, `blast-radius`. Discriminated by `rule.type`. New types require an ADR amendment.

5. **Loading.** Loaded at startup, reloaded on file change. Watch loop treats `policy.json` as a phase trigger.

6. **Validation.** `PolicyFileSchema.parse(json)` on load. Failure throws.

---

## ADR-043 — Policy evaluation contract

**Date:** 2026-05-06
**Status:** Active.

Governs `packages/core/src/policy.ts` (new). Sibling contracts: ADR-042, ADR-044, ADR-045.

**Decision.**

1. **`evaluateAllPolicies(graph, policies, context) → PolicyViolation[]`.** Pure function. Per-type evaluator dispatch.

2. **Three triggers.** Post-ingest, post-extract, post-stale-transition.

3. **`PolicyViolation` shape.** `{ id, policyId, policyName, severity, onViolation, ruleType, subject, message, observedAt }`. `id = ${policy.id}:${violation-context}` — dedup key.

4. **Deterministic ids.** Same graph + same policies → same ids. ndjson append-only deduplicates.

5. **Per-type dispatch table.**

6. **Idempotency.** Stateless.

7. **Authority.** Reads live graph; calls `compat.ts`; never mutates.

---

## ADR-044 — Policy onViolation actions contract

**Date:** 2026-05-06
**Status:** Active.

Sibling contracts: ADR-042, ADR-043, ADR-045.

**Decision.**

1. **Three actions: `log`, `alert`, `block`.** No others in MVP.

2. **`log`.** Append to `policy-violations.ndjson`. No surface effect.

3. **`alert`.** `log` + emit MCP `notifications/resources/updated` for `neat://policies/violations`.

4. **`block`.** `log` + `alert` + prevent the action. **MVP scope: FrontierNode promotion gating only.** Other gating points need their own ADRs.

5. **Severity defaults** when `onViolation` is omitted: `info → log`, `warning → alert`, `error → alert`, `critical → block`.

6. **Authority.** `packages/core/src/policy.ts`. Block returns `false` from gating checks; never mutates.

7. **Block scope tightly bounded.**

---

## ADR-045 — Policy tool surface contract

**Date:** 2026-05-06
**Status:** Active.

Sibling contracts: ADR-039, ADR-040, ADR-042-044.

**Decision.**

1. **Single MCP tool: `check_policies`** with optional `scope` and `hypotheticalAction`. Audit's two-tool split rejected.

2. **REST under `/policies`.** `GET /policies` (parsed file), `GET /policies/violations` (filterable), `POST /policies/check` (dry-run, `{ hypotheticalAction }` → `{ allowed, violations }`). Audit's `/policy/violations` (singular) rejected.

3. **MCP resource at `neat://policies/violations`.** Subscribers get update notifications.

4. **Three-part response format** from ADR-039. Confidence `1.00` for confirmed violations; lower for hypothetical-action results.

5. **Routes dual-mount per ADR-026.**

---

## ADR-046 — `neat init` contract

**Date:** 2026-05-06
**Status:** Active.

The first of four v0.2.5 distribution-layer contracts. Governs `packages/core/src/cli.ts`'s `init` command and the codemod path it triggers. Sibling contracts: ADR-047 (SDK install), ADR-048 (machine registry), ADR-049 (daemon).

**Decision.**

1. **`neat init <path>` is a one-time registration moment.** Like `brew install` followed by `claude init`. Re-running is idempotent.
2. **What `init` does, in order.** Discover (with report before mutation), build initial graph, register in `~/.neat/projects.json`, generate SDK install patch, apply or hold (patch-by-default; `--apply` opt-in), reload daemon if running.
3. **Patch-by-default; `--apply` opt-in.** Init never modifies user code without explicit consent. `--dry-run` prints without writing.
4. **What `init` doesn't touch by default.** Manifests only under `--apply`. Lockfiles never modified directly. `.env` and config files never modified. Running processes never instrumented.
5. **Discovery report is honest.** Lists what `init` will / won't do, what it found, what it skipped.
6. **Idempotency.** Re-running on already-initialized: re-runs discovery, overwrites registry entry, re-generates patch (skips applied changes), re-builds snapshot. No double-install, no duplicate registry entries.
7. **Project naming.** `--project <name>` overrides; default basename. Names unique within `~/.neat/projects.json`; collisions fail loudly.
8. **`init` and `install` are one command.** Audit's split rejected — one command with `--apply` flag handles both.

**Authority.** `packages/core/src/cli.ts`. Composes extract/, persist.ts, installers/, registry.ts. Does **not** start the daemon (`neatd start` is separate).

**Enforcement.** `it.todo` for v0.2.5 #119. Discovery-report-before-mutation gets a CLI test (`init --dry-run` → no files changed).

---

## ADR-047 — SDK install contract

**Date:** 2026-05-06
**Status:** Active.

Governs per-language installer modules under `packages/core/src/installers/` (new directory). Sibling contracts: ADR-046, ADR-048, ADR-049.

**Decision.**

1. **Installer module interface.** Every language exports `{ language, detect(serviceDir), plan(serviceDir): InstallPlan, apply(serviceDir, plan): ApplyResult }`. Plan and apply decoupled — patch can be saved, reviewed, re-applied later.
2. **Two languages in MVP: Node and Python.** Node adds `@opentelemetry/api`, `sdk-node`, `auto-instrumentations-node`; modifies `scripts.start` (or Procfile/Dockerfile CMD). Python adds `opentelemetry-distro`, `opentelemetry-exporter-otlp`; prefixes entrypoint with `opentelemetry-instrument`. Both set `OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318`. Java/Ruby/.NET/Go/Rust out of MVP.
3. **Patch shape.** Serializable: `{ language, dependencyEdits, entrypointEdits, envEdits }`. The plan is what `init` writes to `neat.patch` for review.
4. **Lockfiles never touched.** Manifests only. After `--apply`, init prints `Run "npm install"` so user owns the lockfile commit.
5. **Idempotency.** `plan(dir)` returns empty plan when SDK is already installed. Re-running `init --apply` produces no diff.
6. **Patch is deterministic.** Same input → same patch. Reviewable byte-for-byte.
7. **Apply failure is recoverable.** Partial success → emits `neat-rollback.patch`. NEAT does not silently leave broken state.
8. **Composability.** `neat init --no-install` for graph + registry only. `neat install <path>` alias for `init --skip-discovery --skip-registry`.

**Authority.** `packages/core/src/installers/`. One file per language. Common patch-application in `installers/shared.ts`.

**Enforcement.** `it.todo` for v0.2.5 #119. "Lockfiles never touched" lands as regression scan.

---

## ADR-048 — Machine-level project registry contract

**Date:** 2026-05-06
**Status:** Active.

Governs `~/.neat/projects.json` and `packages/core/src/registry.ts`. Sibling contracts: ADR-046, ADR-047, ADR-049.

**Decision.**

1. **Single source of truth: `~/.neat/projects.json`.** Per-user, machine-local. Not synced. Not version-controlled.
2. **Shape.** `{ version: 1, projects: [{ name, path, registeredAt, lastSeenAt?, languages, status: 'active' | 'paused' | 'broken' }] }`. `version: z.literal(1)`.
3. **Atomicity.** `writeAtomically(path, contents)` — tmp + fsync + rename. No torn writes.
4. **Lock file.** Exclusive flock on `~/.neat/projects.json.lock` for writes. 5s timeout; failure is loud.
5. **Status semantics.** `active` (daemon watching), `paused` (user-paused), `broken` (path missing or last op failed).
6. **Removal.** `neat uninstall <name>` removes entry. Does **not** delete `neat-out/`, `policy.json`, or user files. Reverses SDK-install patch via `neat-rollback.patch` if user opts in.
7. **Path normalization.** Stored as resolved absolute path. Two `init` calls from different relative paths to the same dir don't create two entries.
8. **Multi-machine sync deferred.** Per-machine for MVP.

**Authority.** `packages/core/src/registry.ts`. CLI commands and daemon call into it. Daemon reads on boot and on `SIGHUP`.

**Enforcement.** `it.todo` for v0.2.5 #119. Regression test asserts registry path is `~/.neat/projects.json` and no other module reads/writes it.

---

## ADR-049 — Daemon contract

**Date:** 2026-05-06
**Status:** Active.

Governs the long-lived `neatd` process. Sibling contracts: ADR-046, ADR-047, ADR-048.

**Decision.**

1. **Single long-lived process.** `neatd start` boots one daemon watching every project in `~/.neat/projects.json`. Per-project graphs in `Map<string, NeatGraph>` per ADR-026. No clustering in MVP.
2. **Lifecycle commands.** `neatd start [--foreground]`, `neatd stop`, `neatd reload`, `neatd status`.
3. **Continuous extraction triggers.** Source mtimes (chokidar → re-extract phase per ADR-032), `policy.json` mtime (reload per ADR-042), `compat.json` mtime (reload matrix), OTel HTTP/gRPC (`:4318`/`:4317` → `handleSpan` per ADR-033), staleness loop (60s per ADR-024).
4. **Per-project isolation.** Each project's graph is its own `MultiDirectedGraph`. File watching, OTel ingest, policy evaluation scoped to project. Failure in one project doesn't affect others.
5. **OTel routing.** Spans route to a project by `service.name` lookup across registered projects. Unknowns route to `'default'` for FrontierNode auto-creation.
6. **Graceful degradation.** Missing registry → boot refuses. Missing path → mark `status: 'broken'`. OTel overwhelmed → backpressure via queue (ADR-033 #1); spans drop, never block.
7. **No automatic restart on crash.** PID at `~/.neat/neatd.pid` for external supervisors (systemd / launchd).
8. **Self-hosting gate stays closed during v0.2.5.** Per ADR-027 + the v0.2.x sequencing: self-hosting NEAT on the NEAT codebase only flips on after the MVP-success PR closes.

**Authority.** `packages/core/src/daemon.ts`. Composes registry.ts, extract/, ingest.ts, policy.ts, persist.ts.

**Enforcement.** `it.todo` for v0.2.5 #119. Regression test asserts daemon writes `graph.json` only via persist.ts loop and shutdown handlers.

## ADR-050 — CLI surface contract

**Date:** 2026-05-08
**Status:** Active.

Opens v0.2.6. First of two milestone contracts. Sibling: ADR-051.

**Context.** Today every reach into the graph goes through MCP — fine for Claude Code, awkward for a human at a terminal who wants to ask "what does `get_root_cause` return for `service:checkout`?" The terminal-vs-agent gap is real: an engineer debugging needs the same nine tools the agent has, without the Claude wrapper. The existing `neat` CLI handles lifecycle (`init`, `watch`, `list`, `pause`, `resume`, `uninstall`, `skill`) but exposes no graph queries.

**Decision.**

1. **Nine `neat <verb>` commands, one per MCP tool.** The verb set mirrors the locked allowlist from ADR-039:

   | MCP tool | CLI verb |
   |---|---|
   | `get_root_cause` | `neat root-cause <node-id>` |
   | `get_blast_radius` | `neat blast-radius <node-id>` |
   | `get_dependencies` | `neat dependencies <node-id> [--depth N]` |
   | `get_observed_dependencies` | `neat observed-dependencies <node-id>` |
   | `get_incident_history` | `neat incidents [--limit N]` |
   | `semantic_search` | `neat search <query>` |
   | `get_graph_diff` | `neat diff [--since <date>]` |
   | `get_recent_stale_edges` | `neat stale-edges` |
   | `check_policies` | `neat policies [--node <id>] [--hypothetical-action <action>]` |

   Naming drops the `get_` prefix and uses kebab-case per UNIX convention. Verbs are nouns where natural (`incidents`, `policies`), action-flavored only when the noun would be ambiguous (`search`, `diff`).

2. **REST-only data path.** Verbs hit `NEAT_API_URL` (default `http://localhost:8080`) via the same client logic the MCP server uses. Never read `graph.json` at request time. Same multi-project routing as MCP — `--project <name>` flag, defaulting to `NEAT_PROJECT` env, defaulting to `'default'`.

3. **Two output modes.** Default human-readable: prose summary + plain-text table + `confidence: X.XX · provenance: ...` footer (mirrors the three-part MCP response per ADR-039). With `--json`: machine-readable JSON with the same three sections as named fields (`{ summary, block, confidence, provenance }`). Stdout for results; stderr for diagnostics.

4. **Exit code conventions.**

   - `0` — success.
   - `1` — server error (4xx / 5xx response from REST; the body's error message goes to stderr).
   - `2` — misuse (missing required arg, malformed flag — handled before any network call).
   - `3` — daemon not reachable (connection refused / timeout). Distinct from `1` so scripts can branch on "is the daemon up?"

5. **No mutation verbs in MVP.** Every MCP tool is read-only and so is every CLI verb. Lifecycle commands (`init`, `watch`, etc.) keep their existing semantics; mutation never lands behind a query verb.

6. **No demo-name hardcoding.** Same rule as MCP (per cross-cutting rule 8). Examples in `--help` text reference real-shape ids (`service:<name>`, `database:<host>`) without committing to specific demo names.

7. **`--help` output is binding documentation.** Each verb's `--help` lists the args, flags, exit codes, and an example invocation. `neat --help` lists every verb (lifecycle + query) in one block.

**Authority.** `packages/core/src/cli.ts` (extends existing parser) or a new `packages/core/src/cli-verbs.ts` if the surface gets large. Implementation choice left to the implementing agent. The REST client lives at `packages/core/src/cli-client.ts` (or similar) and is shared with `packages/mcp/src/client.ts`.

**Enforcement.** `it.todo` block in `contracts.test.ts` for v0.2.6 #23. Regression tests cover: nine verbs registered, REST-only data path (no `graph.json` reads from CLI), exit-code branching, `--json` shape, `--project` propagation.

## ADR-051 — Frontend-facing API contract

**Date:** 2026-05-08
**Status:** Active. Speculative — sections marked **(deferred)** wait for v0.3.0 to surface concrete asks.

Opens v0.2.6. Second of two milestone contracts. Sibling: ADR-050.

**Context.** Jed's v0.3.0 frontend track builds against the v0.1.2-stable API. The existing REST surface (`/graph`, `/graph/node/:id`, etc., all dual-mounted per ADR-026) is request-response — fine for initial render, insufficient for live views. Two gaps known today: live update streaming, multi-project enumeration. WebSocket-style symmetric subscription is plausibly needed but not surfaced yet.

The `(if needed)` qualifier in the kickoff applies. We draft what's clear and explicitly defer what isn't.

**Decision.**

1. **Server-Sent Events stream at `/events`.** Dual-mounted per ADR-026: `GET /events` (default project) and `GET /projects/:project/events` (scoped). Content-type `text/event-stream`. One JSON-encoded payload per event line, prefixed by `event: <type>` so the EventSource API routes by type.

2. **Event taxonomy (locked).** Eight event types, all derived from existing graph mutations:

   | Event | Payload | Trigger |
   |---|---|---|
   | `node-added` | `{ node: GraphNode }` | extract or auto-create in ingest |
   | `node-updated` | `{ id: string, changes: Partial<GraphNode> }` | property change in extract / ingest |
   | `node-removed` | `{ id: string }` | retire path in extract |
   | `edge-added` | `{ edge: GraphEdge }` | any provenance |
   | `edge-removed` | `{ id: string }` | retire / promotion rewire |
   | `extraction-complete` | `{ project, fileCount, nodesAdded, edgesAdded }` | watch.ts re-extract finishes |
   | `policy-violation` | `{ violation: PolicyViolation }` | evaluator emits a new violation |
   | `stale-transition` | `{ edgeId, from: 'OBSERVED', to: 'STALE' }` | staleness loop tick |

   New event types require a successor ADR. The event taxonomy is locked the same way the nine MCP tools are locked — no quiet additions.

3. **Heartbeat.** Every 30 seconds the server emits a comment line (`:heartbeat\n\n`) to keep proxies / load balancers from idle-timing out the connection. EventSource clients ignore comments.

4. **Multi-project switcher endpoint.** `GET /projects` returns `Array<{ name, path, status, registeredAt, lastSeenAt?, languages }>` — direct passthrough of `listProjects()` from `registry.ts` (ADR-048). Distinct from the dual-mount routing in ADR-026: that exposes per-project endpoints; this exposes the registry itself for a project picker UI.

5. **JSON error shape unchanged.** Same `{ error, status, details? }` envelope from ADR-040. SSE errors land as a final `event: error` payload before the connection closes; non-SSE errors keep the existing JSON-body convention.

6. **WebSocket transport (deferred).** Symmetric subscription (client subscribes to specific node ids, sends ping/pong, etc.) waits for a successor ADR. Triggered when v0.3.0 frontend work surfaces a concrete need SSE can't cover. SSE is sufficient for one-way streaming and is the MVP transport.

7. **Per-event filtering inside SSE (deferred).** The default-project mount streams every event for the default graph; the `/projects/:project/events` mount streams events for that project. Filtering by node id or edge type within a stream is a successor concern.

8. **Backpressure.** SSE writes are non-blocking — if a client's socket is slow, events queue up to a per-connection cap (default 1000 messages) before the connection is dropped with `event: error` payload `{ reason: 'backpressure' }`. Spans dropping at the OTel layer (per ADR-033) is unrelated; this is a separate per-connection guard.

**Authority.** `packages/core/src/api.ts` (extend) for `/projects`. SSE endpoint in `packages/core/src/api.ts` or a new `packages/core/src/streaming.ts` if the surface grows. Event emission threaded through `ingest.ts`, `extract/index.ts`, `watch.ts`, `policy.ts` via a small `EventEmitter` singleton in `packages/core/src/events.ts`.

**Enforcement.** `it.todo` block in `contracts.test.ts` for v0.2.6 #24. Regression tests cover: `/events` endpoint exists with `text/event-stream` content-type, dual-mount per ADR-026, event-type taxonomy locked (eight types, no quiet additions), `/projects` endpoint exists and returns the registry shape, heartbeat interval set, backpressure cap honored.

## ADR-052 — Publish system contract

**Date:** 2026-05-09
**Status:** Active.

Documents the load-bearing rules of the npm publish pipeline. The pipeline has been in production since 0.2.5 but had no contract coverage, which is how the 0.2.6 broken-publish bug shipped: the `neat.is` umbrella's bin wrappers `require()`ed subpaths into `@neat.is/core` and `@neat.is/mcp` that those packages didn't expose through their `exports` field, and nothing caught it before the tarballs went live on the registry.

**Context.** Five packages ship to npm: `@neat.is/types`, `@neat.is/core`, `@neat.is/mcp`, `@neat.is/claude-skill`, and the `neat.is` umbrella. The umbrella's whole job is to put `neat`, `neatd`, `neat-mcp` on PATH after `npm install -g neat.is` — it has no code of its own, only three bin wrappers that delegate via `require('@neat.is/core/dist/cli.cjs')` etc. Local monorepo dev uses workspace symlinks where Node bypasses `exports` enforcement; npm-installed tarballs do not. The first release that exercised the wrappers through real tarballs was 0.2.6, and that's when the failure surfaced.

**Decision.**

1. **Bin-wrapper subpath validity.** Every `require('@scope/pkg/subpath')` line in `packages/neat.is/bin/*` must resolve to a path exposed in the target package's `exports` field. Literal-key match for MVP; wildcard pattern matching is a successor concern. Enforced as a contract-test assertion that parses the wrapper files and walks each target package.json.
2. **Version lockstep.** All five publishable packages (`types`, `core`, `mcp`, `claude-skill`, `neat.is`) carry the same `version` string in their `package.json` at all times on `main`. Cross-package dep ranges (`@neat.is/types: ^X.Y.Z` in core/mcp, three of those in the umbrella) must match the same `X.Y.Z`. Half-bumped state is a contract violation. Enforced both by the publish workflow's verify-versions step and by a contract test on `main`.
3. **Tarball smoke-test gate.** The publish workflow must run `neat --help` against the just-published umbrella tarball before declaring success. Specifically: install `neat.is@<published-version>` into a tmp dir, invoke the `neat` bin, assert exit code 0. Catches any failure shape that only surfaces under a real tarball install (the 0.2.6 class).
4. **Dependency order is fixed.** Publish proceeds `types → core → mcp → claude-skill → neat.is`. Out of order means a downstream 404 because npm rejects publishes whose deps aren't on the registry yet. Encoded in both the CI workflow and `scripts/publish.sh`.
5. **Idempotency per package.** Re-running the publish workflow after a partial failure must skip packages already at the target version (`npm view <pkg>@<version>` check) rather than 409. Already implemented; this contract locks it as a binding rule.
6. **npm immutability acknowledged.** Once `name@version` is published, that slot is permanently sealed — `npm unpublish` does not free it for re-publish. Therefore: publishing a broken version forces a patch-version bump, never a same-version republish. Documented in `docs/runbook-publish.md`'s troubleshooting section.
7. **No engineering of an unpublish recovery.** When a broken release ships, the response is a fix-only patch release at the next version (e.g. 0.2.6 broken → 0.2.7 fix). Don't build tooling around `npm unpublish` because npm won't let it work the way that tooling would imply.
8. **`engines.node: ">=20"`** on every publishable package and the umbrella. Older Node fails at install, not at runtime. Already in place; this contract locks it.

**Authority.** `.github/workflows/publish.yml` (CI publish), `scripts/publish.sh` (local fallback), `docs/runbook-publish.md` (process), `packages/neat.is/bin/{neat,neatd,neat-mcp}` (the wrappers under contract), `packages/core/package.json` and `packages/mcp/package.json` (the `exports` fields the wrappers reach through).

**Enforcement.** New describe block in `contracts.test.ts`. Live assertions for rules 2 (version lockstep), 4 (dependency order encoded in scripts), 8 (engines field). Rule 1 (subpath validity) ships as live but depends on the 0.2.7 exports fix being on `main` first; until then, the assertion would fail because main reflects the broken 0.2.6 state. Rule 3 (tarball smoke-test) is an `it.todo` until the workflow step lands. Rules 5, 6, 7 are documented invariants without test mechanization (5 is exercised by every re-run of the workflow; 6 and 7 are policy, not verifiable in CI).
