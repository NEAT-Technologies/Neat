---
name: daemon
description: Single long-lived process watching every registered project. Per-project graph isolation. File-mtime + OTel + policy.json triggers. Graceful per-project failure. Self-hosting gate stays closed during v0.2.5.
governs:
  - "packages/core/src/daemon.ts"
  - "packages/core/src/cli.ts"
  - "packages/core/src/ingest.ts"
  - "packages/core/src/extract/index.ts"
  - "packages/core/src/persist.ts"
adr: [ADR-049, ADR-048, ADR-026, ADR-027]
---

# Daemon contract

The fourth of four v0.2.5 distribution-layer contracts. Sibling contracts: [`init.md`](./init.md), [`sdk-install.md`](./sdk-install.md), [`project-registry.md`](./project-registry.md).

The daemon is what makes the graph **continuous**. Without it, `init` snapshots once and the user re-runs extraction manually. With it, edits to source, OTel arrivals, and policy changes drive ongoing graph mutation across every registered project — without per-project `neat watch` invocations.

## Single long-lived process

`neatd start` boots one daemon watching every project in `~/.neat/projects.json`. Per-project graphs in `Map<string, NeatGraph>` per ADR-026. No clustering in MVP.

## Lifecycle commands

| Command | Effect |
|---------|--------|
| `neatd start [--foreground]` | start the daemon (default backgrounds via nohup/launchd/systemd; user runs it manually in MVP) |
| `neatd stop` | graceful shutdown. Flush per [persistence.md](./persistence.md), release lock, exit |
| `neatd reload` | re-read `~/.neat/projects.json`. Pick up new projects, drop removed ones |
| `neatd status` | print PID, registered projects, last-seen timestamps |

## Continuous extraction triggers

Per project, daemon watches:

- **Source file mtimes** via chokidar — re-extract phase per [static-extraction.md](./static-extraction.md).
- **`policy.json` mtime** — reload policies per [policy-schema.md](./policy-schema.md).
- **`compat.json` mtime** in NEAT's install dir — reload matrix; re-evaluate compatibility policies.
- **OTel HTTP/gRPC ingest** on `:4318` / `:4317` — `handleSpan` per [otel-ingest.md](./otel-ingest.md).
- **Staleness loop** per ADR-024 — every 60s.

## Per-project isolation

Each project's graph is its own `MultiDirectedGraph`. File watching, OTel ingest, policy evaluation scoped to the project. A failure in one project does not affect others.

## OTel routing

Spans route to a project by `service.name` lookup across registered projects. Spans for unknown services route to a fallback `'default'` project for FrontierNode auto-creation per ADR-033.

## Graceful degradation

- Registry file missing → daemon refuses to boot with a clear error.
- Project path missing → mark `status: 'broken'`, continue with others.
- OTel ingest overwhelmed → backpressure via the queue (ADR-033 #1); spans drop, never block.

## No automatic restart on crash

PID at `~/.neat/neatd.pid` for external supervisors. MVP does not respawn itself.

## Self-hosting gate stays closed

Per ADR-027 + the v0.2.x sequencing: self-hosting NEAT on the NEAT codebase only flips on after the MVP-success PR closes. The daemon contract specifies how self-hosting *would* work; running it on the NEAT codebase is post-#126.

## Authority

`packages/core/src/daemon.ts`. Composes:
- `registry.ts` — reads `~/.neat/projects.json`.
- `extract/*` — re-extraction triggers.
- `ingest.ts` — OTel ingest routing.
- `policy.ts` — policy reload + evaluation triggers.
- `persist.ts` — per-project snapshot writes.

## Enforcement

`it.todo` for v0.2.5 #119. Regression test: daemon writes `graph.json` only via `persist.ts` loop and shutdown handlers.

Full rationale: [ADR-049](../decisions.md#adr-049--daemon-contract).
