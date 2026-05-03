# NEAT

> **⚠️ Work in progress.** This repository is an MVP under active development. Many architectural decisions were intentionally optimised for development speed.

[![CI](https://github.com/NEAT-Technologies/Neat/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/NEAT-Technologies/Neat/actions/workflows/ci.yml)
[![License](https://img.shields.io/github/license/NEAT-Technologies/Neat)](https://github.com/NEAT-Technologies/Neat)
[![Release](https://img.shields.io/github/v/release/NEAT-Technologies/Neat)](https://github.com/NEAT-Technologies/Neat/releases)
[![Website](https://img.shields.io/badge/website-neat.is-black)](https://neat.is)

A unified runtime that maintains a live semantic graph of your codebase, infrastructure, and production. Query it. Assert policies against it. Run agents against it.

Read my story here: https://neat.is/blog/architecture-is-all-you-need

---

## What it does

NEAT continuously builds a dynamic model of your system from two sources:

- **Static analysis** of source files, `package.json`, and yaml/env config.
- **Runtime telemetry** from OpenTelemetry spans.

Every edge carries a `provenance` (EXTRACTED, INFERRED, OBSERVED, STALE) so consumers know how much weight to put on each claim. See [`PROVENANCE.md`](./PROVENANCE.md) for the full model.

Six MCP tools expose the graph to AI agents: `get_root_cause`, `get_blast_radius`, `get_dependencies`, `get_observed_dependencies`, `get_incident_history`, `semantic_search`.

---

## Quickstart — reproduce the demo locally in under ten minutes

The demo runs two Node services against a Postgres 15 database. `service-b` is pinned to `pg` 7.4.0 — too old for SCRAM auth, so every call fails. The demo proves NEAT can trace that failure back to the version mismatch two graph hops away.

### 1. Clone and install

```bash
git clone https://github.com/NEAT-Technologies/Neat
cd Neat
npm install
npm run build
```

Requires Node 20.x. `nvm use` honours `.nvmrc`.

### 2. Start the stack

```bash
docker compose up --build
```

Boots five containers: `payments-db` (Postgres 15), `service-a`, `service-b`, `otel-collector`, and `neat-core`. The collector streams spans into core on `:4318`. Core's REST API is on `:8080`.

### 3. Generate traffic

```bash
for i in {1..10}; do curl -s localhost:3000/data; done
```

Every request 500s — that's expected. The errors are what populate the graph.

### 4. Confirm the graph saw it

```bash
curl -s localhost:8080/graph | jq '.edges[] | select(.id | contains("OBSERVED"))'
curl -s localhost:8080/incidents | jq '.[0]'
```

You should see an `OBSERVED` `CALLS` edge from `service:service-a` to `service:service-b`, an `INFERRED` `CONNECTS_TO` edge from `service:service-b` to `database:payments-db` (the trace stitcher fills the auto-instrumentation gap — see `docs/decisions.md` ADR-014), and an incident attributed to `database:payments-db`.

### 5. Wire NEAT into Claude Code

```bash
claude mcp add neat -- node "$(pwd)/packages/mcp/dist/index.cjs"
```

Or add it manually to `~/.claude/settings.json`:

```json
{
  "mcpServers": {
    "neat": {
      "command": "node",
      "args": ["/absolute/path/to/Neat/packages/mcp/dist/index.cjs"],
      "env": { "NEAT_CORE_URL": "http://localhost:8080" }
    }
  }
}
```

### 6. Ask Claude

In any Claude Code session:

> **Why is payments-db failing?**

Expected:

```
Root cause identified: service:service-b.
PostgreSQL 14+ requires scram-sha-256 auth by default; pg < 8.0.0 only speaks md5.

Traversal path: database:payments-db ← service:service-b ← service:service-a
Edge provenances: INFERRED, OBSERVED
Confidence: 0.70

Recommended fix: Upgrade service-b pg driver to >= 8.0.0
```

The confidence is 0.7 because the `CONNECTS_TO` hop is INFERRED (pg 7.4.0 is too old for OTel's pg auto-instrumenter, so the trace stitcher fills it in from the static graph). With a modern driver every edge would be OBSERVED and confidence would be 1.0.

---

## CLI

`neat init <path>` builds the static graph from a directory and writes a snapshot:

```bash
node packages/core/dist/cli.cjs init ./demo
```

Prints node and edge counts by type plus any incompatibilities the compat matrix found. Snapshot goes to `<path>/neat-out/graph.json` unless `NEAT_OUT_PATH` overrides.

---

## Repository layout

```
packages/
  types/   shared Zod schemas — node, edge, event, result types
  core/    graph engine, tree-sitter extraction, OTel ingest, REST API, neat CLI
  mcp/     stdio MCP server exposing six tools to AI agents
  web/     Next.js shell — wordmark + /api/health (dashboard is post-MVP)

demo/
  service-a/      express + axios. Calls service-b.
  service-b/      express + pg 7.4.0. Talks to payments-db (PG 15).
  collector/      OpenTelemetry collector config.
```

---

## Documentation

- [`PROVENANCE.md`](./PROVENANCE.md) — the four edge states and how confidence cascades.
- [`CLAUDE.md`](./CLAUDE.md) — agent + contributor guide for this repo.
- [`docs/architecture.md`](./docs/architecture.md) — pocket reference to package boundaries and data flow.
- [`docs/decisions.md`](./docs/decisions.md) — ADR log.
- [`docs/milestones.md`](./docs/milestones.md) — sprint status, source of truth for what's done.
- [`docs/runbook.md`](./docs/runbook.md) — common commands and recovery recipes.
- [`docs/railway.md`](./docs/railway.md) — deploy the demo to Railway.
- [`packages/mcp/skill.md`](./packages/mcp/skill.md) — Claude Code skill metadata for the MCP tools.

---

## License

Apache 2.0.
