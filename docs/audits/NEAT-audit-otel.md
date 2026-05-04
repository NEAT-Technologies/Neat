# NEAT OTel Audit — MVP (TypeScript v0.1.x)
## Load this before touching any ingestion-related code.

**Scope:** This audit covers `packages/core/src/otel.ts`, `packages/core/src/ingest.ts`, and the trace stitcher logic in the TypeScript MVP monorepo at `github.com/NEAT-Technologies/Neat`. It does not apply to the Rust v1.0 OTel ingestion pipeline.

**Stack:** `@opentelemetry/sdk-node`, `@opentelemetry/auto-instrumentations-node`, `@opentelemetry/exporter-trace-otlp-http`, Fastify OTLP HTTP receiver on port 4318, optional gRPC receiver on port 4317 (added in v0.1.2 α).

**The goal this audit serves:** NEAT must be able to ingest OTel spans from any codebase with standard instrumentation — not just the pg 7.4.0 demo environment — and surface real anomalies that static analysis alone would not find. The demo was a controlled proof. The product must work on unknown systems.

**What is not in scope for this audit:**
- Qdrant vector DB or semantic memory — v1.0 only
- Autonomous remediation pipeline — v1.0 only
- Firecracker sandbox — v1.0 only
- eBPF-based instrumentation — v1.0 only
- Custom OTel collector distribution — v1.0 only

---

## What OTel ingestion must do — MVP

OTel watches a running system and produces OBSERVED edges in the graph. It answers the question: what is the system actually doing right now?

The output is always tagged OBSERVED with a `lastObserved` timestamp and a `callCount`. It represents ground truth — something that actually happened, measured directly, not inferred from code.

The critical requirement for the general-purpose goal: the OTel layer must be able to ingest spans from any system that emits standard OpenTelemetry semconv attributes. It must not be coupled to the demo environment's specific service names, port numbers, or instrumentation choices.

The trace stitcher exists to bridge gaps where auto-instrumentation is patchy. It is a bounded workaround. It must not grow beyond its stated scope.

---

## The contract

### 1. Receiver — MVP

The OTLP HTTP receiver listens on port 4318. The optional gRPC receiver listens on port 4317.

**Verify:**
- Is the receiver implemented as a Fastify route or a standalone HTTP server?
- Does it accept both `application/x-protobuf` and `application/json` OTLP payloads?
- Does it respond with the correct OTLP success response immediately — before processing the span — so the sending service is not blocked?
- Is there a health check at `/health` that confirms the receiver is accepting spans?
- If the gRPC receiver was added in v0.1.2 α, is it actually wired up or just scaffolded?

### 2. Span parsing — MVP

Each incoming span must be parsed for these fields before any graph mutation occurs. These are standard OTel semconv attributes that any compliant instrumentation library emits. The parser must not hardcode service names, hostnames, or port numbers from the demo.

Fields to parse:
- `resource.attributes['service.name']` — the service that produced the span
- `span.parentSpanId` — if present and from a different service, this is a cross-service call
- `span.traceId`
- `span.spanId`
- `span.attributes['db.system']` — if present, this span involves a database call
- `span.attributes['db.name']` — the database name
- `span.attributes['server.address']` or `span.attributes['net.peer.name']` — target host
- `span.attributes['http.url']` or `span.attributes['url.full']` — for HTTP calls
- `span.attributes['http.method']` or `span.attributes['http.request.method']`
- `span.status.code` — 2 means ERROR
- `span.startTimeUnixNano` — converted to ISO8601 for `lastObserved`

**Verify:**
- Is parsing done before any graph mutation?
- Are both old semconv (`http.url`, `net.peer.name`) and new semconv (`url.full`, `server.address`) supported? Real codebases use both depending on SDK version.
- Is `span.startTimeUnixNano` correctly converted from nanoseconds? A common mistake is treating it as milliseconds — off by a factor of 1,000,000.
- If a required field is missing from a span, does the parser skip the span cleanly or throw?
- Are there any hardcoded strings in the parser that reference `service-a`, `service-b`, `payments-db`, or any demo-specific name? If yes, this is a critical gap — the parser must be general.

### 3. Service identity — MVP

Service identity must be derived entirely from `resource.attributes['service.name']`. Nothing else.

Not from hostname. Not from port. Not from a hardcoded map. Any service that emits spans with a `service.name` attribute is a valid service for NEAT to model.

**Verify:**
- Is service identity derived exclusively from `service.name`?
- Is there any code that maps known service names to nodes via a hardcoded list? If yes, this breaks the general-purpose goal.
- If a span arrives from a service that does not yet have a node in the graph, is a new ServiceNode created automatically?
- Is the ServiceNode creation from span data distinct from the ServiceNode creation from tree-sitter extraction? They must be reconcilable — the same service appearing in both OTel and static analysis must produce one node, not two.

### 4. Cross-service CALLS edge — MVP

When a span has a `parentSpanId` from a different service, a `CALLS` edge must be created or updated.

**Verify:**
- Is there a span cache or trace buffer that holds recent spans long enough to correlate parent-child across service boundaries? Without this, cross-service CALLS edges cannot be derived.
- What is the TTL on the span cache? Spans from the same trace can arrive out of order.
- If the parent span has not been seen when the child arrives, does the system wait, retry, or drop the cross-service edge?
- Is the span cache bounded in size? An unbounded cache will grow without limit on a busy production system.

### 5. Database CONNECTS_TO edge — MVP

When a span carries `db.system` and `db.name`, a `CONNECTS_TO` edge must be created or updated.

The database engine is derived from `db.system`. Valid values from OTel semconv: `postgresql`, `mysql`, `mongodb`, `redis`, `sqlite`, `mssql`, `cassandra`, `elasticsearch`. The parser must handle all of these, not just `postgresql`.

**Verify:**
- Is there a DatabaseNode lookup or creation when a `db.system` span arrives?
- Is `db.system` mapped to the DatabaseNode's `engine` field correctly for all major database types?
- Is there any hardcoded check for `postgresql` specifically that would prevent other databases from creating DatabaseNodes? If yes, this breaks the general-purpose goal.
- When a new DatabaseNode is created from OTel data, is the compatibility matrix checked against the connecting service's driver version (if known from static extraction)?

### 6. ERROR span handling — MVP

When a span carries `status.code === 2`, an ErrorEvent must be created.

**Verify:**
- Is `status.code === 2` the correct check? Verify integer comparison not string comparison.
- Is the ErrorEvent written to `neat-out/errors.ndjson` as a complete JSON object per line?
- Is `affectedEdge` populated when the error occurred on a known CALLS or CONNECTS_TO edge?
- Are exception attributes read from span events named `exception` — not from top-level span attributes? OTel records exceptions as span events, not attributes.
- Is the ErrorEvent schema from `@neat/types` used or is there a local ad-hoc schema?

### 7. The trace stitcher — MVP

The trace stitcher exists because some auto-instrumentation does not capture all hops. It infers missing edges from the static graph when an error span is received.

**This is a bounded workaround. It must not expand.**

Stitcher rules — non-negotiable:
- Only activates when `status.code === 2` (ERROR span)
- Only walks EXTRACTED edges from the erroring service's node
- Maximum depth: 2 hops from the erroring service node
- Produces INFERRED edges with `confidence: 0.6` only
- Never produces OBSERVED edges
- Does not activate for non-error spans
- Does not create INFERRED edges for hops where an OBSERVED edge already exists

**For the general-purpose goal:** the stitcher must work on any erroring service, not just service-b. The erroring service is identified by `service.name` from the span. The stitcher then walks the static graph from that node regardless of what service it is.

**Verify:**
- Is the stitcher only triggered by ERROR spans?
- Is the depth limit enforced? Find the actual depth counter in the code.
- Does the stitcher produce INFERRED edges or OBSERVED edges? OBSERVED is a critical gap.
- Is `confidence: 0.6` what the code actually writes?
- Is the stitcher general — does it work from any erroring service node — or does it hardcode service-b as the starting point?
- Does the stitcher skip hops where OBSERVED edges already exist?

### 8. OBSERVED edge upsert — MVP

When an OTel span confirms a relationship already in the graph, upgrade the edge — do not duplicate it.

Update rules:
- `lastObserved` → set to the span's timestamp
- `callCount` → increment by 1
- `provenance` → upgrade from EXTRACTED or INFERRED to OBSERVED if currently lower trust
- `confidence` → remove from the edge (not applicable to OBSERVED)

**Verify:**
- Is there an upsert function that finds an existing edge before creating a new one?
- Is `callCount` incremented or reset on each span?
- Is `provenance` upgraded when OTel confirms a relationship previously only known via EXTRACTED or INFERRED?
- Is the upsert logic general — does it work for any service pair — or is it coupled to the demo service names?

### 9. Staleness transition — MVP

OBSERVED edges must become STALE when `lastObserved` exceeds 24 hours. Background process, not read-time computation.

**Verify:**
- Is `lastObserved` stored as ISO8601 from the span's `startTimeUnixNano`, not from `Date.now()`?
- Is there a background `setInterval` that transitions OBSERVED → STALE?
- Is staleness computed at read time in the REST API handler instead? If yes, this is a gap.
- When an edge transitions to STALE, is `lastObserved` preserved?

### 10. Non-blocking ingestion — MVP

Spans arrive continuously. The receiver must respond to the sender before graph mutations complete.

**Verify:**
- Does the Fastify OTLP route respond before awaiting graph mutations?
- Is there a queue between the receiver and the mutation? Or does mutation happen in the request handler?
- Is the mutation `await` inside or outside the response send? If inside, the sending service is blocked.

### 11. OTel collector config — MVP

**Verify:**
- Is the collector config in `demo/collector/config.yaml` general enough to work with any service, not just the demo services?
- Is the exporter pointing to `http://neat-core:4318` via environment variable, not hardcoded?
- Is the batch timeout short (200ms or less) so spans arrive quickly?
- Is there a `logging` exporter for debugging?

---

## What general-purpose OTel ingestion looks like

For NEAT to open a PR on any repo, the OTel layer must be able to:

1. Accept spans from any service with any `service.name`
2. Create ServiceNodes automatically for services seen in spans but not yet in the static graph
3. Create DatabaseNodes automatically for any `db.system` type, not just postgresql
4. Produce CALLS edges for any cross-service span pair
5. Produce CONNECTS_TO edges for any database span
6. Run the trace stitcher from any erroring service node, not just the demo services
7. Surface ErrorEvents for any ERROR span regardless of which service produced it

If any of these seven are scoped to the demo environment specifically, the general-purpose goal is blocked.

---

## Red flags

- Any hardcoded reference to `service-a`, `service-b`, `payments-db`, or any demo-specific name in the OTel parsing or ingestion code
- The OTLP receiver awaiting graph mutations before sending the success response
- `Date.now()` used as `lastObserved` instead of the span's `startTimeUnixNano`
- `startTimeUnixNano` treated as milliseconds
- The trace stitcher producing OBSERVED edges instead of INFERRED
- The trace stitcher depth exceeding 2 hops
- The trace stitcher hardcoded to start from service-b rather than any erroring service
- `db.system` handling only `postgresql` — other databases create no DatabaseNode
- Exception data read from span attributes instead of span events named `exception`
- `status.code === 2` compared against string `'2'` rather than integer `2`
- OBSERVED edges created alongside existing EXTRACTED edges rather than upgrading them
- Unbounded span cache with no TTL or size limit

---

## Five questions — answer these before closing the audit

1. Is there any hardcoded demo service name (`service-a`, `service-b`, `payments-db`) in the OTel ingestion code?
2. Does the trace stitcher start from any erroring service node or only from service-b?
3. Does the trace stitcher produce INFERRED edges (correct) or OBSERVED edges (critical gap)?
4. Is a new ServiceNode created automatically when a span arrives from a service not yet in the graph?
5. Does the `db.system` handler create DatabaseNodes for all major database types or only postgresql?

---

*MVP only. eBPF instrumentation, Qdrant semantic memory, autonomous remediation, and Firecracker sandboxing are v1.0.*
