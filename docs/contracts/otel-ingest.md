---
name: otel-ingest
description: OTel receiver replies before mutation, lastObserved derives from span time, parent-span cache correlates cross-service CALLS, exception data is parsed from span events, unseen services and DBs are auto-created.
governs:
  - "packages/core/src/ingest.ts"
  - "packages/core/src/otel.ts"
  - "packages/core/src/otel-grpc.ts"
adr: [ADR-033, ADR-029, ADR-030]
---

# OTel ingest contract

The first of three v0.2.2 producer-layer contracts. Governs the OTel ingest path: receiver, span parsing, the `handleSpan` mutation function. Sibling contracts: [trace-stitcher.md](./trace-stitcher.md), [frontier-promotion.md](./frontier-promotion.md). Together they lock the OBSERVED layer.

## Non-blocking ingest (binding)

The receiver replies 200 OK immediately on receipt. Mutation runs through a non-blocking handler — either an in-process queue drained on the next tick, or fire-and-forget with bounded concurrency. **The OTel sender is never blocked on graph mutation.** SDK exporters retry on timeout, so blocking ingest produces observable backpressure on the system being observed; ambient observation requires no observable effect.

Today (issue #131) the receiver awaits `opts.onSpan` per-span before sending the 200. The cleanup is to introduce a queue.

## `lastObserved` from span time

Every OBSERVED edge's `lastObserved` field is derived from `span.startTimeUnixNano`, converted to ISO8601. Replayed traces, out-of-order spans, and historical fill-ins must produce a `lastObserved` that reflects when the span actually fired — not when the receiver received it.

The conversion lives in `parseOtlpRequest` so every consumer of `ParsedSpan.startTimeUnixNano` gets a normalized form. `nowIso(ctx)` is for cases where a span timestamp doesn't apply (e.g. ad-hoc test fixtures); production paths use the span time. Issue #132 closes this gap.

## Parent-span cache for cross-service CALLS

Today peer resolution uses `server.address` / `net.peer.name` / `url.full` only. That misses non-HTTP RPCs and any span whose peer is opaque.

The contract adds a bounded TTL cache keyed by `${traceId}:${spanId}` storing each span's service. On span arrival:

1. Address-based resolution runs first (`pickAddress(span)`).
2. If no peer is found and `parentSpanId` is set, look up the parent in the cache. If the parent's service is known and differs from the current span's service, that's a cross-service CALLS edge.

Cache size and TTL are constants near the other ingest tunables. Out-of-order arrival (child before parent) drops the child; we don't buffer. Issue #133.

## Auto-creation of unseen services and databases

When `handleSpan` resolves a `service.name` not present in the graph, it creates a minimal `ServiceNode` at `serviceId(span.service)` with `language: 'unknown'`, no `version`, no `dependencies`. Same for unseen `db.system` + host — a minimal `DatabaseNode` at `databaseId(host)`.

Auto-created nodes carry `discoveredVia: 'otel'` (schema growth governed by ADR-031 — adds an optional field, snapshot regenerates).

When static extraction later finds the same id, attributes **merge** per ADR-028 §3. Static fields override OTel-derived fields where both exist (because static is more authoritative on declared intent: language, version, dependencies). `discoveredVia` becomes `'merged'` if both layers recorded the node independently. Issue #134.

## Exception data from span events

`OtlpSpan` is extended with `events: Array<{ name, timeUnixNano, attributes }>`. When a span has an `events[]` entry with `name === 'exception'`, the parser extracts `exception.type`, `exception.message`, and `exception.stacktrace` from its attributes.

`handleSpan`'s ErrorEvent path prefers exception data over `status.message`:

```
exceptionMessage = events.find(e => e.name === 'exception')?.attributes['exception.message']
                ?? span.status.message
                ?? span.name
                ?? 'unknown error'
```

`exception.type` is added to ErrorEvent as an optional field (schema growth via ADR-031). Issue #135.

## HTTP receiver supports JSON and protobuf

Today the HTTP receiver only accepts `application/json` bodies. The contract: dispatch on `Content-Type`. Protobuf parsing uses the bundled `.proto` definitions (ADR-020). gRPC continues to handle protobuf natively.

## `db.system` is data, not a switch

Engine identification is read from the span attribute as a string and never compared against a hardcoded list. No `if (db.system === 'postgresql')` branches. Engine-specific behavior lives in `compat.json` and is consulted via `compat.ts` per Rule 8 of `docs/contracts.md`.

## Error events

`appendErrorEvent` writes to `errors.ndjson` synchronously after the graph mutation but before the receiver replies. If the file write fails, the receiver returns 500 so the OTel SDK retries.

ErrorEvent shape stays as defined in `@neat/types`. New fields (`exceptionType`, `exceptionStacktrace`) land via the schema-growth contract.

## Authority

Owned by `ingest.ts` per ADR-030. Receiver shape lives in `otel.ts` / `otel-grpc.ts`; mutation logic lives in `ingest.ts`. No other module mutates the graph through the OTel ingest path.

## Enforcement

`packages/core/test/audits/contracts.test.ts` includes `it.todo` items keyed to issues #131-#135. Each flips to a live assertion as the issue ships:
- non-blocking ingest (timing-based test on the receiver),
- `lastObserved` from span time (replay-a-backdated-span fixture),
- parent-span cache correlation (parent-then-child fixture, child-then-parent fixture),
- auto-creation (span for unseen service produces ServiceNode with `discoveredVia: 'otel'`),
- exception event parsing (span with `events[]` produces ErrorEvent with `exceptionMessage` from the event).

Full rationale and historical context: [ADR-033](../decisions.md#adr-033--otel-ingest-contract).
