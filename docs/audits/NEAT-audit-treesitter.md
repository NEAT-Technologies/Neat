# NEAT Tree-sitter Audit — MVP (TypeScript v0.1.x)
## Load this before touching any extraction-related code.

**Scope:** This audit covers `packages/core/src/extract.ts` and its sub-modules in the TypeScript MVP monorepo at `github.com/NEAT-Technologies/Neat`. It does not apply to the Rust v1.0 tree-sitter native bindings.

**Stack:** Native tree-sitter Node.js bindings (`tree-sitter` + language grammars), not web-tree-sitter WASM. This was an explicit decision — neat-core is a Node.js server process only, never a browser, so WASM overhead is unnecessary.

**What is not in scope for this audit:**
- web-tree-sitter WASM bindings — if these appear in packages/core, remove them
- Semantic analysis beyond what tree-sitter's query API can express — LLM-assisted extraction is v1.0
- Salsa incremental computation — v1.0 only
- Cross-language semantic unification at scale — MVP supports JS/TS/Python, that is enough

---

## What tree-sitter extraction must do — MVP

tree-sitter reads your source files and config and produces EXTRACTED nodes and edges in the graph. It answers the question: what does the code say this system looks like?

The output is always tagged EXTRACTED. It is always a snapshot accurate at the time of the last scan. It never claims more than what it found in the files.

The extraction pipeline must be modular — one extractor per source type. A monolithic extract.ts that handles all file types in one function is debt. The v0.1.2 β release noted this split was made. Verify it held.

---

## The contract

### 1. Module structure — MVP

Extraction must be split by source type. Not one 300-line function.

Expected modules or clear logical separation:
- Service extraction — reads package.json, source files, finds service definitions
- Database extraction — reads db config, ORM config, connection strings
- Call extraction — reads source files, finds HTTP calls, gRPC, message queue producers/consumers
- Config extraction — reads yaml, env, Dockerfile
- Infra extraction — reads docker-compose.yml, basic Terraform, k8s manifests

**Verify:**
- Is extract.ts split into per-source-type functions or is it still one large function?
- If it is one function, does it have clear phase boundaries or is it genuinely tangled?
- Are the extractors independently testable — can you run database extraction against a fixture without running service extraction?

### 2. Language support — MVP

The MVP must support at minimum:

- JavaScript (`.js`, `.mjs`, `.cjs`)
- TypeScript (`.ts`, `.tsx`)
- Python (`.py`) — added in v0.1.2 β
- JSON (`package.json`, `*.json` config files)
- YAML (`*.yaml`, `*.yml` — docker-compose, k8s, ORM config)
- `.env` files

`[v1.0]` Go, Rust, Java, Ruby, and other languages. Do not add new language grammars to the MVP unless a specific demo scenario requires it.

**Verify:**
- Which tree-sitter grammars are installed as dependencies in `packages/core/package.json`?
- Is there a language dispatch table — a map from file extension to grammar — or is it hardcoded conditionals?
- If a file extension is not recognised, does extraction skip it cleanly or does it throw?

### 3. Service discovery — MVP

From v0.1.2 β, recursive service discovery was added. It must honour workspace conventions.

**Verify:**
- Does `neat init /path` discover services recursively, not just direct children of the scan path?
- Does it honour `package.json#workspaces` — if a monorepo declares workspaces, are those the service roots?
- Does it recognise `apps/`, `services/`, `packages/` as conventional service directories?
- Is there a depth limit on recursion? Without one, scanning `/` would be catastrophic.
- What is the depth limit and is it configurable?

### 4. What must be extracted from package.json — MVP

For each `package.json` found, the extractor must produce:

- `ServiceNode.name` — from `name` field
- `ServiceNode.version` — from `version` field
- `ServiceNode.language` — `node` or `javascript` or `typescript` depending on presence of TypeScript in devDependencies
- Driver versions — from `dependencies` and `devDependencies`: specifically `pg`, `mysql2`, `mongoose`, `redis`, `@prisma/client`, `drizzle-orm`, `sequelize` — each maps to a property on the ServiceNode for compatibility checking
- Framework detection — `express`, `fastapi` (Python), `hono`, `fastify`, `nestjs` — stored as `ServiceNode.framework`

**Verify:**
- Is driver version extraction general or hardcoded to `pg` only? The `pgDriverVersion` deprecation in the CLAUDE.md suggests it was special-cased. Is it now replaced by a general driver extraction mechanism?
- Is framework detection present? If not, the FastAPI audit scenario cannot work.
- Are dependency versions stripped of semver range prefixes (`^`, `~`, `>=`) before being stored? A version stored as `^7.4.0` will not match correctly against the compatibility matrix.

### 5. What must be extracted from source files — MVP

**From JavaScript and TypeScript:**

HTTP calls — find `fetch`, `axios.get/post/put/delete`, `got`, `superagent`, `node-fetch` calls with URL arguments. Extract the target URL. Map it to a known ServiceNode if the hostname matches. Create a `CALLS` EXTRACTED edge.

Database connections — find `new pg.Pool`, `new pg.Client`, `mongoose.connect`, `mysql.createConnection`, `new PrismaClient`, `drizzle(...)`, `new Sequelize`. Create a `CONNECTS_TO` EXTRACTED edge to the appropriate DatabaseNode.

Imports — find `import` and `require` statements. Create `DEPENDS_ON` EXTRACTED edges for inter-service dependencies where the import path resolves to another service in the graph.

**From Python:**
`requests.get/post`, `httpx.get/post` → CALLS edges
`psycopg2.connect`, `sqlalchemy.create_engine`, `motor.AsyncIOMotorClient` → CONNECTS_TO edges
`import` statements → DEPENDS_ON edges

**Verify:**
- Are the tree-sitter queries for HTTP call detection tested against fixture files?
- Does URL-literal matching work for `http://service-b:3001/query` style URLs? This is what the demo uses.
- Does URL-literal matching fail gracefully for dynamic URLs like `` `http://${host}/path` ``? It must not crash — it should skip or create a FRONTIER edge.
- Is database connection detection general (checking for multiple ORMs) or only `pg`?

### 6. What must be extracted from config files — MVP

**docker-compose.yml:**
- Each `services` entry → `ServiceNode` or `InfraNode` depending on whether it is a first-party service or an image pull
- `depends_on` → `DEPENDS_ON` EXTRACTED edge
- Port mappings and environment variables → stored as node properties
- Named volumes → `ConfigNode`

**`.env` files:**
- `DATABASE_URL` → parse the connection string, create `DatabaseNode` and `CONNECTS_TO` edge
- `*_HOST`, `*_PORT` patterns → infer database or service targets

**YAML ORM config:**
- `drizzle.config.ts` — extract connection target
- `prisma/schema.prisma` — extract datasource url
- `ormconfig.json` — extract connection details
- `knexfile.js` — extract connection details

**Verify:**
- Is docker-compose parsing present? It was listed as part of v0.1.2 β infra extraction.
- Is `.env` DATABASE_URL parsing present?
- Is there a `ConfigNode` being created for these files or are they only used to populate other node properties?
- Are ORM config files parsed or only `package.json`?

### 7. Compatibility matrix integration — MVP

After extraction, every ServiceNode with a driver version must be checked against `compat.json`. Any incompatibility found at extraction time must be annotated on the ServiceNode as a property — not stored as a separate event, not written to errors.ndjson, not computed at traversal time.

The annotation is: `compatibilityWarnings: Array<{ driver, engine, reason }>` on the ServiceNode.

**Verify:**
- Is `checkCompatibility` called from within the extraction pipeline after a driver version is extracted?
- Is the result stored on the node or only computed at root cause traversal time?
- If stored on the node, is it visible in `GET /graph/node/:id`?
- Is the compat.json check general — does it handle mysql2/mysql and mongoose/mongodb entries in addition to pg/postgresql?

### 8. Incremental extraction and watch mode — MVP

From v0.1.2 δ, `neat watch` was added. Watch mode must re-extract only the changed file, not the entire codebase.

**Verify:**
- Is there a file watcher (chokidar or Node.js `fs.watch`) in the watch mode implementation?
- When a file changes, does the extractor re-scan only that file and update only the affected nodes and edges?
- Or does it re-scan the entire directory on every file change? If yes, this is acceptable for MVP but note it as a performance debt item.
- When a file is re-scanned, are the old EXTRACTED edges from that file removed before new ones are written? Without this, deleted code paths will leave ghost edges in the graph.

### 9. Ghost edge cleanup — MVP

When a file is deleted or a dependency is removed from package.json, the EXTRACTED edges derived from it must be removed from the graph.

**Verify:**
- Is there a mechanism to identify which edges were derived from a specific file?
- Are EXTRACTED edges tagged with their source file path so they can be cleaned up when that file changes or is deleted?
- Is ghost edge cleanup implemented or is it a known gap?

### 10. Idempotency — MVP

Running extraction twice against the same unchanged codebase must produce the same graph. The documented behaviour from PROVENANCE.md is: `extractFromDirectory` is idempotent — same source, same nodes, same edge ids.

**Verify:**
- Are node IDs deterministically generated from the node's content — service name, file path — rather than from UUIDs or timestamps?
- Are edge IDs deterministically generated from source node ID + target node ID + edge type?
- If the same extraction runs twice, does the graph end up with duplicate nodes or duplicate edges?

---

## Red flags

- `require('web-tree-sitter')` or `import ... from 'web-tree-sitter'` anywhere in packages/core — wrong binding, remove it
- `pgDriverVersion` still being special-cased instead of going through the general driver extraction mechanism
- Semver ranges stored with `^` or `~` prefix — these will break compatibility matrix checks
- No depth limit on recursive service discovery
- HTTP call detection only working for URL literals — dynamic URLs must fail gracefully, not crash
- EXTRACTED edges not tagged with source file path — ghost edge cleanup is impossible without this
- Re-scanning the entire codebase on every file change in watch mode — acceptable for MVP but must be noted as debt
- `new tree_sitter.Parser()` instantiated once globally or instantiated fresh on every file — parser instantiation is expensive, it should be instantiated once per language grammar and reused

---

## Five questions — answer these before closing the audit

1. Is driver version extraction general (multiple ORMs and drivers) or still special-cased to `pg`?
2. Are semver range prefixes stripped from dependency versions before storage?
3. When a file changes in watch mode, are ghost EXTRACTED edges from the previous scan removed?
4. Are node and edge IDs deterministic so that re-extraction does not create duplicates?
5. Is `checkCompatibility` called during extraction and the result stored on the node, or is compatibility only checked at traversal time?

---

*MVP only. web-tree-sitter WASM, LLM-assisted extraction, and additional language grammars beyond JS/TS/Python are v1.0.*
