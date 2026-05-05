# NEAT v0.2.0 Sunrise — audit verification pass

**Issue:** #126
**Branch:** `v0.2.0-audit-verification`
**Scope:** Grade every `Verify:` checkbox across the 8 audit documents in `docs/audits/` against the live source on `main` (commit `4f62bc4` plus PR #128). Findings only — no code changes in this pass.

**Method:** Eight verification agents, one per audit, ran in parallel against the actual TypeScript source. Each graded checkboxes with file:line citations using these tags:

- **PASS** — implementation matches the contract
- **PARTIAL** — partially correct or correct-but-incomplete
- **FAIL** — implementation contradicts the contract
- **NOT-BUILT** — feature absent from current MVP scope (often deferred to v0.2.1/v0.2.2)
- **N/A** — out of scope (v1.0-only or audit phrasing not applicable)

**Next step (not in this pass):** the user reads this document, sorts findings into three piles — open as new v0.2.0 issues / amend existing issues #115-#119 / defer or reject — then we open the issues and amendments based on the sorted piles.

---

## Roll-up

| Audit         | FAIL | PARTIAL | PASS | NOT-BUILT | Notes |
|---------------|------|---------|------|-----------|-------|
| Types         | 6    | 7       | 14   | 6         | Schema-shape gaps (`framework`, `owner`, `sourceFile`, `affectedEdge`, blast-radius missing path/confidence) |
| Graph         | 2    | 4       | 18   | 0         | Two FAILs are audit-vs-shipped-ADR contradictions (per-edge staleness; OBSERVED+EXTRACTED coexistence) — needs reconciliation, not code change |
| Tree-sitter   | 7    | 13      | 18   | 0         | TS grammar unused; no source-level DB/import detection; no framework field; no ghost-edge cleanup |
| OTel          | 8    | 7       | 14   | 6         | Blocking ingestion; `Date.now()` instead of span time; no parent-span cache; no auto-create services/DBs from spans |
| Traversal     | 5    | 4       | 16   | 2         | FRONTIER not excluded; `BlastRadiusAffectedNode` missing `path`/`confidence`; DB-only `getRootCause` (#123); no schema validation; graphology helpers unused |
| Policies      | 0    | 0       | 0    | 47        | Expected — feature deferred to v0.2.1 (#115-#118). One naming clash flagged. |
| MCP           | 5    | 11      | 13   | 2         | No HTTP transport; three-part response format absent; `semantic_search` is vector (ADR-025) where audit says keyword; `get_dependencies` not transitive |
| Init          | 2    | 5       | 7    | 14        | Mostly NOT-BUILT (queued for v0.2.2 #119). FAILs: no `~/.neat/projects.json` registry; graph not live immediately after `init` (requires `neat watch`). |

**Cross-cutting:** Several audit checkboxes contradict shipped ADRs (most notably ADR-024 per-edge staleness and the multi-edge OBSERVED+EXTRACTED coexistence in `ingest.ts:15-17`). Those are audit-amendment decisions, not implementation bugs. They are flagged with **AUDIT-DRIFT** below.

---

## Types audit (NEAT-audit-types(1).md)

**Source:** packages/types/src/

### 1. Package structure
- [PARTIAL] File naming differs from contract — no `provenance.ts` (in `constants.ts`), no `traversal.ts` (in `results.ts`), no `policy.ts` (deferred).
- [PASS] `index.ts` re-exports all schemas — packages/types/src/index.ts:1-5.
- [N/A] pnpm build — repo uses npm (ADR-007); tsup wired at packages/types/package.json:21.
- [PASS] Workspace dep wired into core/mcp/web — `"@neat/types": "*"` in all three.

### 2. Provenance
- [PASS] Const + Zod enum — packages/types/src/constants.ts:1-7; edges.ts:4-10.
- [PASS] No raw provenance strings outside types — grep across core/src and mcp/src returns zero hits.
- [PASS] FRONTIER present — constants.ts:6, edges.ts:9.

### 3. EdgeType
- [PASS] Const + Zod enum — constants.ts:11-19; edges.ts:12-20.
- [PARTIAL] 4 raw `'CALLS'` literals outside types — packages/core/src/extract/calls/{aws,grpc,redis,shared}.ts:18,26,39,42.
- [PARTIAL] EdgeType extended beyond audit list (`PUBLISHES_TO`, `CONSUMES_FROM`, `RUNS_ON` per γ work) — additions, not gaps.

### 4. Node schemas
- [PASS] `pgDriverVersion` absent from ServiceNode — nodes.ts:10-70; only ADR-019 v1→v2 migration in persist.ts:21.
- [FAIL] `drivers` map field — exists but named `dependencies` (nodes.ts:18); name mismatch with contract.
- [FAIL] `framework` on ServiceNode — absent. Blocks FastAPI / framework-aware detection.
- [FAIL] `owner` on ServiceNode — absent.
- [FAIL] `compatibilityWarnings` — absent; instead an `incompatibilities` discriminated union (nodes.ts:27-69) with different shape.
- [PASS] Each node uses `z.literal()` for type — nodes.ts:12,75,87,96,109.
- [PASS] `GraphNodeSchema` discriminated union — nodes.ts:117-123 (includes FrontierNode).
- [PARTIAL] DatabaseNode `engineVersion` required where contract has it optional; adds `host`/`port`.
- [PARTIAL] InfraNode `provider` required where contract has it optional; adds `kind` per ADR-022.

### 5. GraphEdge schema
- [PASS] `confidence` optional 0-1 — edges.ts:45.
- [PASS] `lastObserved` ISO8601 — edges.ts:46.
- [PASS] `callCount` non-negative integer — edges.ts:47.
- [FAIL] `sourceFile` on GraphEdge — absent. Ghost-edge cleanup field missing. (`evidence` exists but is a structured object.)
- [PASS] All three optional — edges.ts:45-47.
- [PARTIAL] Extras `evidence`/`signal` — additions for γ #76, not contract violations.

### 6. ErrorEvent schema
- [PASS] In `@neat/types`, not redefined locally — events.ts:3-12; api.ts:7 + ingest.ts:3 import from there.
- [FAIL] `id` validated as UUID — events.ts:4 is `z.string()`; ingest.ts:366 generates `${traceId}:${spanId}` which would fail UUID validation.
- [PASS] `timestamp` ISO8601 — events.ts:5.
- [FAIL] `affectedEdge` field — absent; only `affectedNode` (events.ts:11).
- [PARTIAL] Used at ndjson read/write — type-cast at ingest.ts:306,591,597; never `.parse()`'d.

### 7. PolicyViolationEvent schema
- [NOT-BUILT] Deferred to v0.2.1 (#115/#116).

### 8. Traversal result schemas
- [PASS] In `@neat/types` — results.ts:4-26; traverse.ts imports from there.
- [PASS] `edgeProvenances` array of provenance — results.ts:8; populated 1-per-edge at traverse.ts:234.
- [PASS] `confidence` cascaded, not just final edge — traverse.ts:127-131.
- [FAIL] `BlastRadiusAffectedNode` missing `path` and `confidence` per node — results.ts:14-18 only has `nodeId`/`distance`/`edgeProvenance`. Audit's contract requires both.
- [FAIL] `distance` integer starting from 1 — results.ts:16 is `nonnegative()`, allows 0; traverse.ts:259-264 emits `frame.distance > 0` in practice but unenforced.

### 9. Policy schemas
- [NOT-BUILT] Entire family deferred to v0.2.1 #115.

### 10. Import audit
- [PASS] No locally-defined duplicate schemas in core/mcp.
- [PASS] No `z.object`/`z.enum` in core/mcp src.
- [PASS] All shared types imported from `@neat/types`.

### Five questions
1. [PASS] `pgDriverVersion` absent — replaced by `dependencies` map (nodes.ts:18); name mismatch with contract's `drivers`.
2. [PASS] No raw provenance strings; 4 raw `'CALLS'` literals in extract/calls/* (named in §3).
3. [NOT-BUILT] `PolicyViolationEventSchema` — v0.2.1 #115/#116.
4. [FAIL] `sourceFile` not present on GraphEdgeSchema (edges.ts:39-50).
5. [PASS] Every shared import comes from `@neat/types`.

### Severity summary
- **FAIL (high) — 6:** ServiceNode missing `framework`/`owner`/`compatibilityWarnings`; `dependencies` named differently from contract's `drivers`; GraphEdge missing `sourceFile`; ErrorEvent `id` not `.uuid()`; ErrorEvent missing `affectedEdge`; `BlastRadiusAffectedNode` missing `path`/`confidence`; `distance` allows 0.
- **PARTIAL — 7:** package file naming, raw `'CALLS'` literals, EdgeType enum extended, DatabaseNode/InfraNode shape diffs, GraphEdge extras `evidence`/`signal`, ErrorEvent never `.parse()`'d at runtime.
- **PASS — 14:** workspace deps, Provenance const+enum, FRONTIER present, EdgeType const+enum, no raw provenance strings, `z.literal` discriminator, `GraphNodeSchema` union, GraphEdge optionality/range, ErrorEvent location, RootCause schema location, edgeProvenances per edge, confidence cascade, no duplicate schemas in core/mcp, all imports from `@neat/types`.
- **NOT-BUILT — 6:** PolicyViolationEventSchema and Policy*/PolicyFile family.

---

## Graph audit (NEAT-audit-graph.md)

**Source:** packages/core/src/graph.ts (+ persist.ts, projects.ts, diff.ts, ingest.ts)

### 1. Singleton
- [PARTIAL] Per-project `Map<string, NeatGraph>` (graph.ts:25), lazy via `getGraph()` (graph.ts:31-38). Matches ADR-026, audit wording assumes single export.
- [PASS] `new DirectedGraph()` only at graph.ts:28 (production); other matches are test fixtures.
- [PASS] No reassignment; `resetGraph` only deletes entries (graph.ts:50-56).

### 2. Node types
- [PARTIAL] Schemas exist (nodes.ts:1-122 `GraphNodeSchema`) but `addNode` call sites do not `.parse()` first (ingest.ts:158, extract/configs.ts:50, extract/services.ts:229, extract/databases/index.ts:207, extract/infra/*.ts, extract/calls/index.ts:56).
- [PASS] `pgDriverVersion` absent from ServiceNode; only ADR-019 migration code at persist.ts:13-23.
- [PASS] FrontierNode is acceptable per audit (treats FRONTIER value as in-scope) — added per ADR-023. Audit §2 list is stale relative to ADR-023.

### 3. Edge types
- [PARTIAL] `EdgeTypeSchema` (edges.ts:11-19) not validated at `addEdgeWithKey` call sites.
- [PASS] All edges go through `EdgeType.X` constants from `@neat/types`.
- [PASS] No edges created without `type` field.
- [INFO] Audit §3 list is stale — `EdgeType` (constants.ts:11-19) also defines `PUBLISHES_TO`/`CONSUMES_FROM`/`RUNS_ON`.

### 4. Provenance
- [PASS] `Provenance` shared const (constants.ts:1-7); no raw provenance strings outside types.
- [PASS] All 12 edge-construction literals include `provenance: Provenance.X`.
- [PASS] Every INFERRED edge has confidence — `upsertInferredEdge` sets `INFERRED_CONFIDENCE = 0.6` (ingest.ts:300).
- [PASS] Every OBSERVED edge has `lastObserved` and `callCount` — `upsertObservedEdge` (ingest.ts:218,230-244).
- [PASS] STALE never created directly — only via `markStaleEdges` transition (ingest.ts:517).
- [PASS] Trace stitcher depth-2 — `STITCH_MAX_DEPTH = 2` (ingest.ts:111,262).

### 5. Staleness
- [PASS] Background `setInterval` job — `startStalenessLoop` (ingest.ts:564-589); booted at server.ts:32 and watch.ts:214.
- [PASS] Or read-time — n/a, background path is canonical; `/graph` handler does not recompute (api.ts:125-129).
- [PASS] `lastObserved` preserved on transition — ingest.ts:517 spreads `...e`.
- [FAIL **AUDIT-DRIFT**] 24-hour hardcoded threshold — implementation uses per-edge-type thresholds (ingest.ts:32-40: CALLS=1h, CONNECTS_TO=4h, others=24h), env-overridable via `NEAT_STALE_THRESHOLDS`. Audit explicitly tags per-edge-type as `[v1.0]` but γ #78 / ADR-024 shipped this in v0.1.2. Recommend amending the audit.

### 6. Persistence
- [PASS] Startup load before serving — server.ts:20 calls `loadGraphFromDisk` before `app.listen` at server.ts:83; watch.ts:207 same.
- [PASS] Shutdown serialise — SIGTERM/SIGINT handlers at persist.ts:103-104.
- [PASS] Background interval — `setInterval` at persist.ts:87-89, default 60s (persist.ts:74).
- [PASS] `GET /graph` reads live graphology — api.ts:125-129.
- [PASS] No `readFileSync('graph.json')` outside startup.

### 7. Edge upsert semantics
- [PARTIAL] Upsert functions exist — `upsertObservedEdge` (ingest.ts:199-247), `upsertInferredEdge` (ingest.ts:279-304), `upsertFrontierEdge` (ingest.ts:162-192).
- [FAIL **AUDIT-DRIFT**] EXTRACTED + OTel confirmation upgrades to OBSERVED — implementation **duplicates by design**. OBSERVED edges get id `${type}:OBSERVED:${source}->${target}` (ingest.ts:102-104) and coexist with EXTRACTED. Doc comment at ingest.ts:15-17 calls this out as intentional. Direct contract contradiction; audit needs amending.
- [PASS] Traversal priority — `PROV_RANK` is OBSERVED:3, INFERRED:2, EXTRACTED:1 (traverse.ts:15-19). Note: audit said "OBSERVED > EXTRACTED > INFERRED" but PROVENANCE.md and traverse.ts both rank INFERRED above EXTRACTED.

### 8. Multi-project scoping
- [PASS] Project registry — `Projects` class (projects.ts:46-84); per-project graphs in graph.ts:25.
- [PASS] No cross-project contamination — `getGraph()` defaults to `DEFAULT_PROJECT` (graph.ts:31); each project gets its own instance.
- [PASS] `neat init` for new project creates isolated graphology — `getGraph(name)` lazy-creates (graph.ts:31-38).

### 9. Concurrent access
- [PASS] `handleSpan` mutations synchronous — ingest.ts:311-376; only `await` is trailing `appendErrorEvent` at ingest.ts:374.
- [PARTIAL] Async gap — single-threaded event loop means `GET /graph` between `handleSpan` calls is consistent; no explicit lock.

### Five questions
1. [PASS] `new DirectedGraph()` once per project scope.
2. [PASS] `GET /graph` reads live graphology.
3. [PASS] Staleness background-driven, default 60s tick.
4. [FAIL **AUDIT-DRIFT**] EXTRACTED+OTel coexists rather than upgrades.
5. [PASS] Every INFERRED edge has confidence 0.6.

### Severity summary
- **FAIL (high) — 2 (both AUDIT-DRIFT):** per-edge staleness vs audit's 24h flat (ADR-024); OBSERVED+EXTRACTED coexist by design (ingest.ts:15-17).
- **PARTIAL — 4:** singleton wording stale, node/edge Zod validation not enforced at insertion, concurrent-access bar implicit.
- **PASS — 18:** provenance, INFERRED/OBSERVED/STALE rules, persistence, multi-project, traversal ranking, `pgDriverVersion` removal.

---

## Tree-sitter audit (NEAT-audit-treesitter.md)

**Source:** packages/core/src/extract/* + extract.ts

### 1. Module structure
- [PASS] Phase split — extract/index.ts:17-43 chains 5 phase modules.
- [PASS] Clear phase boundaries — extract/index.ts:24-29.
- [PARTIAL] Independently testable — phases share `NeatGraph`+`DiscoveredService[]`; loose coupling.

### 2. Language support
- [PARTIAL] Tree-sitter grammars installed — `tree-sitter`, `tree-sitter-javascript`, `tree-sitter-python`, `tree-sitter-typescript` (package.json:47-50). **`tree-sitter-typescript` declared but never imported**; `.ts`/`.tsx` fall through to JS parser at http.ts:79.
- [FAIL] Language dispatch table — hardcoded ternary at http.ts:79; no table.
- [PASS] Skip unrecognised extensions cleanly — `SERVICE_FILE_EXTENSIONS` at extract/shared.ts:20.

### 3. Service discovery
- [PASS] Recursive — services.ts:182-197 via `walkDirs`.
- [PASS] Honours `package.json#workspaces` — services.ts:30-36,174-178.
- [PARTIAL] `apps/`/`services/`/`packages/` conventions — not first-class, covered implicitly via globs.
- [PASS] Depth limit — `DEFAULT_SCAN_DEPTH = 5` (services.ts:17), env override `NEAT_SCAN_DEPTH`.

### 4. Extracted from package.json
- [PARTIAL] `language: 'javascript'` hardcoded (services.ts:127-135); no TS-vs-JS distinction via devDependencies.
- [PARTIAL] Driver versions general — `dependencies` map stored whole (services.ts:132); compat iterates `compatPairs()` (databases/index.ts:84-107). General by virtue of map-storage.
- [FAIL] Framework detection (`express`, `fastapi`, `hono`, `fastify`, `nestjs`) — no `framework` field on ServiceNode (nodes.ts:10-71); no detection code anywhere.
- [PASS] Semver prefixes stripped — `cleanVersion` (extract/shared.ts:43-46) applied at compat-check time. (Raw `dependencies` map retains `^`/`~`.)

### 5. Extracted from source files
- [PARTIAL] Tree-sitter Query API for HTTP — calls/http.ts:16-22 walks AST manually for `string_fragment`/`string_content`; no Query API.
- [PARTIAL] Tested against fixtures — not visible in extract/.
- [PASS] URL substring matching — http.ts:35.
- [PASS] Dynamic URLs fail gracefully — http.ts:33-39 silently drops.
- [FAIL] Source-level DB connection detection (`new pg.Pool`, `new PrismaClient`) — not implemented; only ORM **config-file** parsers (databases/{prisma,drizzle,knex,typeorm,sequelize,ormconfig,dotenv,db-config-yaml,docker-compose}.ts).
- [FAIL] `import`/`require` → DEPENDS_ON for inter-service deps — not implemented; only `infra/docker-compose.ts:83` `depends_on` produces edges.
- [PARTIAL] Python `requests`/`httpx` calls — same string-literal substring approach; no Python-specific call detection.
- [PARTIAL] Python `psycopg2.connect`/`sqlalchemy.create_engine` — same as JS, config-file only.
- [FAIL] Python `import` → DEPENDS_ON — not implemented.

### 6. Extracted from config files
- [PASS] docker-compose parsing — infra/docker-compose.ts:40-98 + databases/docker-compose.ts:45-68.
- [PASS] `depends_on` → DEPENDS_ON — infra/docker-compose.ts:80-94.
- [PARTIAL] Port mappings/env vars stored as node properties — parsed but consumed only for DB inference, not stored on `InfraNode`.
- [FAIL] Named volumes → ConfigNode — no volume-handling code.
- [PASS] `.env` `DATABASE_URL` parsing — databases/dotenv.ts:6-16 (DATABASE_URL/DB_URL/POSTGRES_URL/MYSQL_URL/MONGODB_URI/MONGO_URL/REDIS_URL).
- [FAIL] `*_HOST`/`*_PORT` glob patterns — only fixed `CONNECTION_KEYS` set.
- [PASS] ConfigNodes for these files — configs.ts:31-66 with `CONFIGURED_BY` edge.
- [PASS] ORM config files parsed — drizzle/prisma/knex/ormconfig/typeorm/sequelize.

### 7. Compatibility matrix integration
- [PASS] `checkCompatibility` called during extraction — databases/index.ts:88-93.
- [PASS] Result stored on node — `incompatibilities` array (databases/index.ts:171,240-242).
- [PASS] Visible via `GET /graph/node/:id`.
- [PASS] General across mysql2/mongoose/etc. — `compatPairs()` matrix-driven.

### 8. Incremental extraction and watch mode
- [PASS] chokidar watcher — watch.ts:2,321-326.
- [PARTIAL] Re-extract scope — `classifyChange` (watch.ts:50-102) maps path to phase subset; `runExtractPhases` re-runs those phases over all services. Per-phase, not per-file.
- [FAIL] Old EXTRACTED edges from re-scanned file removed — no removal mechanism. Edge writes guarded by `!graph.hasEdge`; no `dropEdge` for stale extracts.

### 9. Ghost edge cleanup
- [FAIL] Identify edges by source file — `evidence: { file, line, snippet }` only on CALLS edges (http.ts:98-102, AWS/Kafka/Redis/gRPC similarly); no evidence on CONNECTS_TO/CONFIGURED_BY/DEPENDS_ON/RUNS_ON.
- [PARTIAL] EXTRACTED edges tagged with source file path — call-shaped only.
- [FAIL] Ghost-edge cleanup implemented — no removal code.

### 10. Idempotency
- [PASS] Deterministic node IDs — `service:<name>`, `database:<host>`, `config:<relPath>`, `infra:<kind>:<name>`.
- [PASS] Deterministic edge IDs — `makeEdgeId(source, target, type)` (extract/shared.ts:67-69).
- [PASS] No duplicates on rerun — every write site checks `hasNode`/`hasEdge`.

### Five questions
1. [PASS] Driver extraction general — matrix-driven via `compatPairs()`.
2. [PARTIAL] Semver prefixes stripped at compat-check time, not at storage.
3. [FAIL] Ghost edges removed in watch mode — no.
4. [PASS] Deterministic IDs prevent duplicates.
5. [PASS] `checkCompatibility` integrated, result on node.

### Severity summary
- **FAIL (high) — 7:** TS grammar installed-but-unused / no language dispatch; no source-level DB connection detection; no JS `import`/`require` → DEPENDS_ON; no Python `import` → DEPENDS_ON; no `framework` field; no named-volume → ConfigNode; no `*_HOST`/`*_PORT` env inference; ghost-edge cleanup absent.
- **PARTIAL — 13:** see body.
- **PASS — 18:** see body.

---

## OTel audit (NEAT-audit-otel.md)

**Source:** packages/core/src/otel.ts, otel-grpc.ts, ingest.ts, api.ts

### 1. Receiver
- [PASS] Standalone Fastify on its own port — buildOtelReceiver (otel.ts:157-177); mounted at server.ts:97-99 on 4318.
- [PARTIAL] Accepts protobuf and JSON — JSON only on HTTP; collector config sets `encoding: json` to match. gRPC path handles protobuf.
- [FAIL] Responds before processing — otel.ts:167-174 awaits `opts.onSpan(span)` for every span before the 200. Sender blocked.
- [PASS] `/health` route — otel.ts:165.
- [PASS] gRPC wired — server.ts:101-105 conditionally starts; impl at otel-grpc.ts:187-233.

### 2. Span parsing
- [PASS] Parsing before mutation — `parseOtlpRequest` (otel.ts:123-155) returns `ParsedSpan[]`.
- [PARTIAL] Old + new semconv — address picker covers both (ingest.ts:95-100); `http.method`/`http.request.method` never read.
- [FAIL] `startTimeUnixNano` → ISO8601 — captured as string at otel.ts:141 but never converted; `lastObserved` set from `Date.now()` (ingest.ts:71-73).
- [PARTIAL] Missing-field handling — defaults rather than skips (otel.ts:136-148); produces empty trace/span ids in ErrorEvents.
- [PASS] No hardcoded demo names in parser/ingest.

### 3. Service identity
- [PASS] Identity from `service.name` only — otel.ts:127-129; `service:${span.service}` (ingest.ts:313).
- [PASS] No hardcoded service map — `resolveServiceId` (ingest.ts:113-137) dynamic.
- [FAIL] Auto-create ServiceNode for unseen service — `handleSpan` never `addNode`s for `service:${span.service}`. If service was not extracted statically, `upsertObservedEdge` bails. Frontier nodes only for peers.
- [PASS] Reconcilable with static extraction — both use `service:${name}`; OBSERVED edges get distinct id pattern (ingest.ts:102) per intentional coexistence.

### 4. Cross-service CALLS edge
- [FAIL] Span cache for parent-child correlation — none. Peer derivation via `server.address`/`url.full` only (ingest.ts:95-100). `parentSpanId` captured (otel.ts:138) but never consumed.
- [N/A] TTL / retry / bounded size — no cache exists.

### 5. Database CONNECTS_TO edge
- [PARTIAL] DB lookup/create — `targetId = database:${host}` (ingest.ts:318-332); `upsertObservedEdge` returns null if target absent. DBs only get OTel edges if pre-created statically.
- [PASS] `db.system` not hardcoded to postgres.
- [FAIL] Compat matrix at OTel-ingest time — only at static-extract time.

### 6. ERROR span handling
- [PASS] Integer compare `=== 2` — ingest.ts:314,363; otel.ts:181.
- [PASS] ErrorEvent → ndjson — `appendErrorEvent` (ingest.ts:306-309).
- [PARTIAL] `affectedEdge` populated — schema has `affectedNode` (events.ts:11), not `affectedEdge`. Implementation sets `affectedNode`.
- [FAIL] Exception data from span events — `OtlpSpan` (otel.ts:66-76) does not parse `events`. Error message from `span.status.message` only.
- [PASS] ErrorEvent typed via `@neat/types`.

### 7. Trace stitcher
- [PASS] Only on ERROR spans — ingest.ts:363-364.
- [PASS] Depth limit — `STITCH_MAX_DEPTH = 2` (ingest.ts:111,262).
- [PASS] INFERRED, not OBSERVED — `upsertInferredEdge` (ingest.ts:279-304).
- [PASS] `confidence: 0.6` — `INFERRED_CONFIDENCE` (ingest.ts:110,300).
- [PASS] General across services — `stitchTrace(graph, sourceServiceId, ts)` (ingest.ts:254).
- [FAIL] Skips hops where OBSERVED twin exists — stitcher walks EXTRACTED outbound only (ingest.ts:267); no check for OBSERVED twin.

### 8. OBSERVED edge upsert
- [PASS] Upsert finds existing — `graph.hasEdge(id)` (ingest.ts:199-247).
- [PASS] `callCount` incremented — ingest.ts:212,218.
- [FAIL **AUDIT-DRIFT**] Provenance upgraded EXTRACTED → OBSERVED in place — no upgrade; OBSERVED stored under separate id (ingest.ts:102) by design.
- [FAIL] `confidence` removed for OBSERVED — set to `1.0` instead (ingest.ts:224,236).
- [PASS] General across service pairs.

### 9. Staleness transition
- [FAIL] `lastObserved` from span time — `nowIso` uses `ctx.now() ?? Date.now()` (ingest.ts:71-73); span `startTimeUnixNano` never used.
- [PASS] Background `setInterval` for STALE — `startStalenessLoop` (ingest.ts:564-589); 60s default.
- [PASS] Not computed at read time.
- [PASS] `lastObserved` preserved on STALE — ingest.ts:517 spreads `...e`.

### 10. Non-blocking ingestion
- [FAIL] Reply before mutation — otel.ts:167-174 awaits sequentially before send.
- [FAIL] Queue between receiver and mutation — none.
- [FAIL] Mutation `await` outside response — inside.

### 11. Collector config
- [PARTIAL] General enough — demo/collector/config.yaml is demo-shaped but semconv-clean.
- [FAIL] Endpoint via env var — hardcoded `http://neat-core:4318` (config.yaml:23).
- [FAIL] Batch timeout ≤200ms — `1s` (config.yaml:14), 5x audit threshold.
- [PASS] Logging exporter — config.yaml:30-31.

### Five questions
1. [PASS] No hardcoded demo names in OTel ingestion.
2. [PASS] Stitcher general — accepts any source service id.
3. [PASS] Stitcher emits INFERRED with confidence 0.6.
4. [FAIL] No auto-create ServiceNode for unseen services. Critical gap for general-purpose goal.
5. [FAIL] DBs not auto-created from spans (general or postgres) — must be pre-existing.

### Severity summary
- **FAIL (high) — 8:** receiver awaits `onSpan` before responding; `lastObserved` from `Date.now()` not span time; OBSERVED duplicates EXTRACTED rather than upgrading (AUDIT-DRIFT); no parent-span cache; no auto-create ServiceNode for unseen services; no auto-create DatabaseNode from spans; stitcher doesn't skip hops with OBSERVED twin; span `events` (where `exception` lives) never parsed.
- **PARTIAL — 7:** HTTP-protobuf absent; `http.method` unconsumed; missing-field defaults; `affectedEdge` vs `affectedNode`; no compat at ingest; `confidence: 1.0` on OBSERVED; collector config demo-shaped (1s timeout, hardcoded endpoint).
- **PASS — 14:** standalone Fastify; `/health`; gRPC wired; integer-status compare; ndjson append; ErrorEvent typed; stitcher contract; staleness loop preserves lastObserved.
- **NOT-BUILT — 6:** parent-span cache; HTTP-protobuf; span-event parsing; auto-creation; `http.method`; `affectedEdge`.

---

## Traversal audit (NEAT-audit-traversal.md)

**Source:** packages/core/src/traverse.ts (+ compat.ts, graph.ts)

### 1. Edge priority rule
- [PASS] Explicit priority — `PROV_RANK` (traverse.ts:16-22) applied in `bestEdgeBySource`/`bestEdgeByTarget` (traverse.ts:30-52).
- [PASS] OBSERVED > EXTRACTED — traverse.ts:35,47.
- [PARTIAL] STALE traversed but flagged — STALE rank 0; surfaces in `edgeProvenances` (traverse.ts:234) but no explicit "stale" flag in result.
- [FAIL] FRONTIER excluded from traversal — FRONTIER ranked 0 (traverse.ts:21) but **not filtered out**. If a node has only FRONTIER edges, they get walked.
- [PASS] Priority applied at every hop — `bestEdgeBySource` per-step in DFS (traverse.ts:155); `bestEdgeByTarget` per BFS frame (traverse.ts:273).

### 2. Confidence cascading
- [PASS] Weakest-edge cascade — `confidenceFromMix` min-reduces (traverse.ts:127-135).
- [PASS] Min, not average — explicit `if (c < min) min = c` (traverse.ts:132).
- [PARTIAL] Single STALE → ≤0.3 — STALE ceiling 0.3 (traverse.ts:67); per-edge confidence multiplies further down. Honored in spirit.
- [PARTIAL] Confidence in RootCauseResult and per-node BlastRadiusResult — RootCauseResult.confidence at traverse.ts:235; **`BlastRadiusAffectedNode` has no `confidence` field** (results.ts:14-19).
- [PASS] Tested with mixed provenances — packages/core/test/traverse.test.ts.

### 3. getRootCause
- [PASS] Direction incoming — `graph.inboundEdges(node)` (traverse.ts:155).
- [PASS] Hand-rolled DFS with cycle detection — `visited` set (traverse.ts:147,158,164).
- [PASS] Cycle detection — `visited.has(srcId)` guard (traverse.ts:157).
- [PASS] Depth limit — `ROOT_CAUSE_MAX_DEPTH = 5` (traverse.ts:24,153).
- [PASS] Returns null on missing node — traverse.ts:177.
- [PASS] `checkCompatibility` at every upstream ServiceNode — loop at traverse.ts:199-222.
- [FAIL] Starts from any node — only fires when start is `DatabaseNode` (traverse.ts:185); other types return null. Issue #123 already tracks generalization.
- [PASS] Uses live graphology — `NeatGraph` parameter (traverse.ts:173).

### 4. getRootCause result
- [PASS] `traversalPath` ordered error→cause — traverse.ts:160.
- [PARTIAL] `edgeProvenances` length = path - 1 — by construction (traverse.ts:234), unasserted.
- [PASS] `rootCauseReason` human-readable — from compat result (traverse.ts:215).
- [PASS] Reason includes specific version + why — traverse.ts:217.
- [FAIL] Result validated against `RootCauseResultSchema` — no `.parse()` call; returned as plain object (traverse.ts:230-237).

### 5. getBlastRadius
- [PASS] Direction outgoing — `graph.outboundEdges` (traverse.ts:273).
- [PASS] Depth limit — `BLAST_RADIUS_DEFAULT_DEPTH = 10` (traverse.ts:25,271).
- [PASS] Cycle detection — `enqueued` set (traverse.ts:260,275-276).
- [PASS] Live graphology — traverse.ts:244.
- [FAIL] graphology-shortest-path used — declared as dep (package.json:41) but **not imported**; hand-rolled BFS.
- [PASS] `totalAffected` = unique node count — `affectedNodes.length` (traverse.ts:287).
- [PASS] Zero outgoing → `totalAffected: 0` — traverse.ts:287.

### 6. getBlastRadius result
- [FAIL] `distance` minimum 1 — schema `nonnegative()` (results.ts:16) allows 0; practical minimum 1 by construction (traverse.ts:264) but unenforced.
- [FAIL] `path` populated per affected node — **`path` field does not exist** on `BlastRadiusAffectedNode` (results.ts:14-18).
- [N/A] `path` ordered — no path field.
- [FAIL] `confidence` per affected node — **no `confidence` field** on `BlastRadiusAffectedNode`.
- [PASS] `totalAffected` matches array length.

### 7. Cycle detection
- [PASS] Visited sets in both functions.
- [PASS] Skips visited nodes.
- [PASS] Applied in getRootCause + getBlastRadius.
- [PASS] Fixture-tested.

### 8. General-purpose requirement
- [PASS] No hardcoded `service-a`/`service-b`/`payments-db`/`postgresql` in traverse.ts.
- [PASS] Unknown start node → null cleanly.
- [PASS] Many outgoing edges — full outbound walk per node.
- [PASS] Fixture not just demo.

### 9. Performance on real graphs
- [NOT-BUILT] <500ms benchmark on 100 nodes / 300 edges — no perf test.
- [NOT-BUILT] Same for getBlastRadius.
- [FAIL] graphology-traversal used — declared as dep (package.json:42) but **not imported**.
- [PASS] No N+1 — single attribute fetch per edge/node.

### 10. Integration with compat.ts
- [PASS] `checkCompatibility` imported, not reimplemented — traverse.ts:14.
- [PASS] Called with driver name + version + engine name + version — traverse.ts:207-212.
- [PASS] Names from node properties, not hardcoded — `pair.driver`/`targetDb.engine`/`deps[pair.driver]` (traverse.ts:196,205,209-211).
- [PASS] `result.reason` used as `rootCauseReason` — traverse.ts:215.
- [PASS] `compatible: true` continues to next upstream — traverse.ts:213.

### 11. STALE edge handling
- [PASS] STALE edges included.
- [PASS] STALE drops confidence to ≤0.3.
- [PASS] STALE provenance surfaced in `edgeProvenances`.
- [NOT-BUILT] MCP tool response communicates STALE clearly — out of traverse.ts scope.

### Five questions
1. **Mostly yes** — but FRONTIER not excluded (traverse.ts:21).
2. **Yes** — confidence is min-reduce.
3. **Yes** — `visited`/`enqueued` sets in both.
4. **Yes** — `checkCompatibility` called with node-property-derived names.
5. **No hardcoded demo names** in traverse.ts.

### Severity summary
- **FAIL (high) — 5:** FRONTIER not excluded (traverse.ts:21); `BlastRadiusAffectedNode` missing `path` and `confidence` (results.ts:14-18); `getRootCause` only fires for DatabaseNode origins (#123 tracks); `RootCauseResult` not validated against schema before return; graphology-traversal/shortest-path declared as deps but unused.
- **PARTIAL — 4:** STALE flag in result (provenance only, no boolean); `distance` schema permits 0; confidence in BlastRadius missing; `edgeProvenances` length unasserted.
- **PASS — 16:** edge priority sort, OBSERVED>EXTRACTED, cycle detection both functions, depth limits 5/10, checkCompatibility correct, no hardcoded demo names, live graph instance, no N+1, STALE behavior.
- **NOT-BUILT — 2:** perf benchmarks on 100-node graphs; MCP-layer STALE communication.

---

## Policies audit (NEAT-audit-policies.md)

**Source:** None — feature deferred to v0.2.1 (#115-#118). No `policy.json`, no `packages/core/src/policy.ts`, no `Policy*Schema` in `@neat/types`. This pass confirms scope; the audit is a build contract, not a drift check.

All 47 checkboxes graded **NOT-BUILT** with the issue number that covers each one (#115 schema, #116 evaluation engine, #117 REST+MCP surface, #118 real-world policy library).

### Cross-cutting findings (worth flagging for #126 follow-up)
- **Naming clash between audit and v0.2.1 plan.** Audit specifies `evaluate_policy` and `get_policy_violations` MCP tools and `/policy/violations` REST path; CLAUDE.md (v0.2.1 γ #117) specifies `check_policies` tool and `/policies` REST path. ADR or issue update needed before #117 starts.
- **Audit names two MCP tools, plan names one.** Audit wants pre-flight (`evaluate_policy`) plus state read (`get_policy_violations`); plan currently merges them. Worth deciding before #117.
- **Hook points exist and are stable.** `ingest.ts`, `extract.ts`, `graph.ts`, `traverse.ts` (`getBlastRadius`), `compat.ts`, `persist.ts` (ndjson pattern via `errors.ndjson` / `stale-events.ndjson`), `api.ts`, `packages/mcp/src/tools.ts` — all already exist. #115/#116/#117 should slot in without architectural moves.
- **#118 (real-world policy library) not stress-tested by this audit.** Implied by provenance + compatibility types but not explicit.

### Severity summary
- **NOT-BUILT — 47** (expected — see #115-#118)
- **FAIL — 0**, **PARTIAL — 0**, **PASS — 0**

---

## MCP audit (NEAT-audit-mcp.md)

**Source:** packages/mcp/src/

### 1. Server setup
- [PASS] Server name `neat` — index.ts:38.
- [PASS] Stdio primary transport — index.ts:163.
- [FAIL] HTTP transport for remote — not implemented; only `StdioServerTransport`.
- [PARTIAL] Server starts cleanly — entrypoint via built CJS bundle.
- [PASS] `/list_tools` returns all tools — 8 `server.tool` registrations (index.ts:42-148).
- [PASS] `NEAT_CORE_URL` env with `http://localhost:8080` default — index.ts:19.

### 2. CLAUDE.md
- [PASS] Exists at packages/mcp/CLAUDE.md.
- [PARTIAL] Instructs `get_root_cause` for production failures — soft, not "before reading source files".
- [PARTIAL] Instructs `get_blast_radius` before changes — soft.
- [PARTIAL] Instructs `get_observed_dependencies` to confirm runtime — soft.
- [FAIL] Explicit "never assume static code reflects production reality — use get_observed_dependencies" — phrase absent.
- [PARTIAL] Example prompts mapped to tools — table only, no worked examples.

### 3. Response format contract
- [FAIL] Three-part format (NL paragraph + structured block + final `confidence · provenance` line) — tools emit header + bullet list (tools.ts:74-86,115-119,150-154,174-178); no standardized footer.
- [PASS] Confidence as decimal — `result.confidence.toFixed(2)` (tools.ts:80).
- [PASS] Provenance named (OBSERVED/EXTRACTED/INFERRED/STALE/FRONTIER).
- [PARTIAL] NL paragraph specific/actionable — root-cause has fix recommendation; others list-only.
- [PASS] Graceful empty-graph — `withMissingNodeFallback` (tools.ts:41-53).

### 4. get_root_cause
- [PARTIAL] `errorNode` non-empty — `z.string()` at index.ts:46-48; no `.min(1)`.
- [PASS] Missing-node handling — friendly fallback.
- [PASS] No-root-cause case — same fallback.
- [PASS] Path as chain — `result.traversalPath.join(' ← ')` (tools.ts:70).
- [PASS] Fix recommendation from result, not hardcoded — tools.ts:82-84.
- [PARTIAL] Generic across drivers — depends on core compat layer.
- [PASS] Per-edge provenance listed — tools.ts:71-73,79.

### 5. get_blast_radius
- [PASS] Lists each affected node with distance + provenance — tools.ts:117,123-126.
- [PARTIAL] Direct vs indirect — distance shown, no narrative grouping.
- [FAIL] Human-readable summary — bulleted list only, no narrative sentence.
- [PASS] Zero blast radius handled — tools.ts:107-110.
- [PASS] STALE distinguished — tools.ts:124 appends `[STALE — last seen too long ago]`.

### 6. get_dependencies
- [PARTIAL] Separates OBSERVED from EXTRACTED — `dedupeBestProvenance` picks best per (target,type); shown inline, not visually grouped.
- [PARTIAL] Communicates traffic-confirmed — provenance shown, no explicit copy.
- [FAIL] Transitive — direct outbound edges only (tools.ts:143-146).
- [PASS] Useful without explanation — line shows target + type + provenance + signal.

### 7. get_observed_dependencies
- [PASS] Filters to OBSERVED only — tools.ts:166.
- [PARTIAL] `lastObserved` timestamps — included only when set.
- [PARTIAL] `callCount` — uses `signal.spanCount` first, fallback `e.callCount`.
- [FAIL] STALE handling — silently excluded; no messaging.
- [PASS] Clear empty case — tools.ts:167-172 hints at OTel not running.
- [N/A] "Should be called first" — documentation concern.

### 8. get_incident_history
- [PASS] Sorted newest first — tools.ts:250.
- [PARTIAL] Includes timestamp/error type/message/trace id — no separate "error type".
- [PASS] Empty case — tools.ts:245-247.
- [PASS] `limit` respected — default 20.
- [PARTIAL] Enough context to skip `get_root_cause` — has trace ids but no upstream linkage.

### 9. semantic_search
- [FAIL **AUDIT-DRIFT**] Documented as keyword search only — index.ts:108 describes embedding tiers (Ollama → MiniLM → substring). Audit says vector is v1.0; ADR-025 explicitly ratifies the embedder chain.
- [PASS] Searches across nodes — `/search?q=...`.
- [PARTIAL] Returns context — id/type/name/optional score; no per-result snippet.
- [FAIL **AUDIT-DRIFT**] Vector noted as deferred in comment — implementation actively uses embeddings (ADR-025).

### 10. get_policy_violations
- [NOT-BUILT] Tool not registered — v0.2.1 #117.

### 11. evaluate_policy
- [NOT-BUILT] Tool not registered — v0.2.1 #117.

### 12. Tool count and completeness
- [PARTIAL] 8 tools — `get_root_cause`, `get_blast_radius`, `get_dependencies`, `get_observed_dependencies`, `get_incident_history`, `semantic_search`, `get_graph_diff`, `get_recent_stale_edges`. Audit names 6; last two are extras.
- [NOT-BUILT] Policy tools — v0.2.1.

### General-purpose requirement
- [PASS] No hardcoded demo names in logic — `payments-db` only in Zod `.describe()` example string (index.ts:48).
- [PASS] Handles unknown node names — `withMissingNodeFallback` 404.
- [PASS] EXTRACTED-only graphs — explicit hint in `getObservedDependencies`.
- [PARTIAL] Large graphs — no pagination.

### Five questions
1. [PASS] All tools call REST, not graph.json.
2. [PARTIAL] Confidence consistently surfaced — root-cause yes, others no.
3. [PASS] No demo names in logic.
4. [NOT-BUILT] Policy tools — v0.2.1.
5. [PARTIAL] CLAUDE.md instructs proactive use but lacks the explicit "never assume static reflects production" directive.

### Severity summary
- **FAIL (high) — 5:** HTTP transport not implemented; three-part response format absent; `semantic_search` is vector (AUDIT-DRIFT — ADR-025 ratifies); CLAUDE.md missing "static ≠ production" directive; `get_dependencies` not transitive.
- **PARTIAL — 11:** see body.
- **PASS — 13:** server name; stdio; env handling; missing-node fallback; no demo names in logic; provenance named; REST-only data path; empty-state messages; root-cause path arrow; STALE flagged in blast-radius.
- **NOT-BUILT — 2:** policy tools (v0.2.1).

---

## Init audit (NEAT-audit-init.md)

**Source:** packages/core/src/cli.ts (+ persist.ts, projects.ts, watch.ts) — `init` extensions queued for v0.2.2 (#119). Most NOT-BUILT items are deferred features, not regressions.

### Decision 4 — Discovery
- [PARTIAL] Depth limit — default 5 (services.ts:17), audit recommends 4. Env override `NEAT_SCAN_DEPTH`.
- [NOT-BUILT] `.neatignore` — discovery honours `.gitignore` (services.ts:38-43,181-185).
- [PASS] `node_modules`/build dirs excluded — `IGNORED_DIRS = {node_modules, .git, .turbo, dist, build, .next}` (extract/shared.ts:22-29). Audit also asks `__pycache__`/`vendor` — not in set.
- [NOT-BUILT] Pre-mutation discovery report — no mutation step exists; `runInit` summarises after extraction.

### Decision 5 — Monorepo vs polyrepo
- [PASS] Monorepo via `package.json#workspaces` — services.ts:30-36,77-116.
- [NOT-BUILT] Monorepo root as `InfraNode` owning workspaces — workspaces registered as `ServiceNode` (services.ts:225-234).
- [NOT-BUILT] `pnpm-workspace.yaml` / `turbo.json` signals — only `package.json#workspaces` read.
- [NOT-BUILT] Multi-repo init separate entries in `~/.neat/projects.json` — no machine registry.
- [NOT-BUILT] Workspace instrumentation prompt — no instrumentation exists.

### Decision 6 — What `neat init` emits
- [PARTIAL] Project config — no `.neat/config.json`; artefact is snapshot at `<scanPath>/neat-out/graph.json` (cli.ts:154-158, ADR-017).
- [NOT-BUILT] `neat.patch` — no codemod.
- [NOT-BUILT] `NEAT_INSTRUMENT.md` — not produced.
- [NOT-BUILT] Default `.neatignore` written — never created.
- [NOT-BUILT] `~/.neat/projects.json` machine registry — only `~/.neat` use is compat cache (compat.ts:58).
- [PASS] `package.json` not modified — read-only.
- [PASS] Lockfiles not modified — never touched.
- [N/A] Explicit "never touch" allowlist — no mutation path exists yet.

### Decision 1 — Ambient ladder
- [FAIL] Machine-level registry from day one — `runInit` only writes local snapshot (cli.ts:110); audit's "rung (b) without rewrite" constraint not satisfied.
- [PARTIAL] Pure, daemon-callable registration — `extractFromDirectory` (extract/index.ts:17-43) is pure; registration concept absent.

### Decision 2 — `neat init` vs `neat install`
- [NOT-BUILT] `neat install` command — cli.ts:136-225 only handles `init` and `watch`.

### Decision 3 — Codemod trust ladder
- [NOT-BUILT] Patch-file default — no codemod.
- [NOT-BUILT] `--apply` flag — no instrumentation.

### Decision 7 — Docker / WSL / dev containers
- [PASS] Docker — root Dockerfile:1-50 daemon over `/workspace`.
- [N/A] WSL — none needed; `os.homedir()` used.
- [NOT-BUILT] Dev container documented as unsupported — no docs note.

### Section 2 findings
- [NOT-BUILT] Success paragraph in #119 — concerns issue body.
- [FAIL] Framing: write to `~/.neat/projects.json` from day one — see Decision 1.
- [NOT-BUILT] `init` and `install` separate.
- [NOT-BUILT] Default codemod = patch file.
- [PASS] Scope-creep guard — no running-process instrumentation, no CI hooks, no hosted-core, no closed-source analysis.
- [PARTIAL] Bug risk: depth limit — 5 vs audit's 4.
- [PARTIAL] Ambient/live stress test:
  - Daemon-callable registration — PARTIAL (extraction yes, registration no).
  - Graph live immediately after init — FAIL (requires explicit `neat watch`).
  - Skill available immediately after `neat install` — NOT-BUILT.

### Verification checklist
1. Writes to `~/.neat/projects.json`? — FAIL.
2. `init` and `install` separate? — NOT-BUILT.
3. Default codemod = patch file? — NOT-BUILT.
4. Depth limit on discovery? — PASS (5 vs recommended 4 — PARTIAL on value).
5. Lockfiles excluded? — PASS in practice.
6. Monorepo workspace scope defined and prompted? — NOT-BUILT.
7. Graph live immediately after init? — FAIL.
8. Dev containers documented as unsupported? — NOT-BUILT.
9. `--apply` opt-in not default? — NOT-BUILT.
10. Registration callable by future daemon? — PARTIAL.

### Five questions for the user (open)
1. Grade against today's `neat init` (snapshot writer) or block until v0.2.2 #119 ships the v0.3.1 surface?
2. Depth limit 5 vs audit's 4 — amend audit or move default to 4?
3. `IGNORED_DIRS` missing `__pycache__`/`vendor` — land in v0.2.0 cleanup or wait for #119?
4. ADR-017 puts snapshot at `<path>/neat-out/graph.json`; audit Decision 6 expects `.neat/config.json` plus machine registry. Keep `neat-out/` for snapshot and add `.neat/` for config, or migrate everything?
5. `neat init` and `neat install` — locked separate for v0.2.2, or single combined command?

### Severity summary
- **FAIL — 2:** machine-level `~/.neat/projects.json` registry not written; "graph live immediately after init" requires explicit `neat watch`.
- **PARTIAL — 5:** depth limit value (5 vs 4); `IGNORED_DIRS` missing `__pycache__`/`vendor`; daemon-callable registration; `.neat/config.json` not written though snapshot is.
- **PASS — 7:** depth limit exists; `node_modules`/`.git`/build dirs excluded; monorepo workspaces detected; `package.json` and lockfiles untouched; scope-creep guard; Docker generic image.
- **NOT-BUILT — 14:** queued for v0.2.2 #119 — `.neatignore`, pre-mutation discovery report, `neat.patch`, `--apply`, `NEAT_INSTRUMENT.md`, default `.neatignore` emission, `~/.neat/projects.json`, `neat install`, monorepo instrumentation prompt, `pnpm-workspace.yaml`/`turbo.json` signals, monorepo-root `InfraNode`, dev-container docs, "never touch" allowlist.

---

## Cross-cutting items for triage

These are not gradeable bullets but emerge from the verification pass and should be considered before opening v0.2.0 cleanup issues.

### AUDIT-DRIFT — audits contradict shipped ADRs
1. **Per-edge staleness thresholds (Graph §5).** Audit calls these `[v1.0]`; γ #78 / ADR-024 shipped them in v0.1.2. Recommend amending the audit.
2. **OBSERVED+EXTRACTED edge coexistence (Graph §7, OTel §8).** Audit says "upgrade in place"; implementation duplicates by design (ingest.ts:15-17, distinct id `${type}:OBSERVED:src->tgt`). Recommend amending the audit — coexistence is the load-bearing design point ADR-027 calls evidence of NEAT's value.
3. **Vector semantic_search (MCP §9).** Audit says keyword-only in MVP; ADR-025 ratifies the Ollama → MiniLM → substring chain. Recommend amending the audit.
4. **Audit §2 node-types list (Graph).** Stale relative to ADR-023 — FrontierNode is omitted from the list but allowed in the body.
5. **Audit §3 edge-types list (Graph).** Stale relative to constants.ts — `PUBLISHES_TO`/`CONSUMES_FROM`/`RUNS_ON` shipped but not in the audit's enumeration.

### Naming clashes
1. **Policies — MCP tool name.** Audit: `evaluate_policy` + `get_policy_violations`. CLAUDE.md / v0.2.1 plan: `check_policies` (single tool). Decide before #117 starts.
2. **Policies — REST path.** Audit: `/policy/violations`. Plan: `/policies`. Decide before #117 starts.

### Audit-vs-ADR-019 wording
- Audit (Types §4) calls the driver-version map `drivers`; implementation (per ADR-019) names it `dependencies` (nodes.ts:18). Either rename the field or amend the audit. Field name has shipped through v0.1.2.

### Real high-severity bugs (not AUDIT-DRIFT)
A short list of items most likely to deserve v0.2.0 cleanup issues, not deferral to v0.2.x:

1. **OTel ingestion blocks the sender** (OTel §1, §10). `await opts.onSpan` before reply. High impact; small fix (move mutation behind a queue).
2. **`lastObserved` set from `Date.now()` not span time** (OTel §2, §9). Breaks staleness math for replayed traces.
3. **No parent-span cache** (OTel §4). Cross-service CALLS rely entirely on host attributes; misses anything not surfaced via `server.address`/`url.full`.
4. **No auto-create ServiceNode/DatabaseNode from spans** (OTel §3, §5). Critical for general-purpose goal — services that weren't statically extracted vanish.
5. **Span events (`exception`) not parsed** (OTel §6). Error message limited to `span.status.message`.
6. **FRONTIER not excluded from traversal** (Traversal §1). Audit explicitly forbids walking FRONTIER; implementation only deprioritizes.
7. **`BlastRadiusAffectedNode` schema missing `path` and `confidence`** (Types §8, Traversal §6). Schema-shape gap.
8. **`distance` allows 0** (Types §8, Traversal §6). One-line schema fix (`positive()`).
9. **`RootCauseResult` not validated against schema before return** (Traversal §4). One-line `.parse()` add.
10. **Ghost-edge cleanup absent** (Tree-sitter §8, §9). Re-extraction accumulates stale EXTRACTED edges.
11. **No source-level DB connection / `import` detection** (Tree-sitter §5). Source-code calls produce no edges; only config files do.
12. **No `framework` field on ServiceNode** (Types §4, Tree-sitter §4). Blocks framework-aware extraction (FastAPI scenario).
13. **MCP three-part response format not honoured** (MCP §3). Mostly cosmetic but spec'd.
14. **`get_dependencies` not transitive** (MCP §6). Direct edges only.
15. **graphology-traversal / graphology-shortest-path declared but unused** (Traversal §5, §9). Either use them or drop the deps.

---

*End of verification pass. Findings only — no code changes in this pass.*

---

## Addendum — audit-drift amendments (applied)

The five AUDIT-DRIFT items in the cross-cutting roll-up have been resolved by amending the audit text to match shipped ADRs. Source code unchanged.

- **Graph audit §2** — added `FrontierNode` to the MVP node-types list (ADR-023).
- **Graph audit §3** — added `RUNS_ON`, `PUBLISHES_TO`, `CONSUMES_FROM` to the MVP edge-types list (matches `packages/types/src/constants.ts`).
- **Graph audit §5 + OTel audit §9** — replaced flat 24h staleness with per-edge-type thresholds (ADR-024). Added `stale-events.ndjson` to the verify list.
- **Graph audit §7 + OTel audit §8** — replaced "upgrade in place" contract with the coexistence contract (`ingest.ts:15-17`, ADR-027). Both audits now describe the distinct OBSERVED edge id pattern and the `PROV_RANK` selection rule. OTel §8 also corrects `confidence` expectation: OBSERVED edges carry `confidence: 1.0` as a max-trust marker, not removed.
- **MCP audit §9** — replaced "keyword only in MVP" with the ADR-025 embedder chain (Ollama → MiniLM → substring). Updated tool-status table and red-flag entry.

The two policies-naming clashes and the `drivers` vs `dependencies` field-name disagreement remain open — they need product calls before any audit edit.
