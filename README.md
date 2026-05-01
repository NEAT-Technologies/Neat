# NEAT

> **⚠️ Work in Progress**
> This repository is currently an MVP under active development.
> Many architectural and code design decisions were intentionally optimised for development speed.

[![CI](https://github.com/neat-tools/Neat/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/neat-tools/Neat/actions/workflows/ci.yml)
[![License](https://img.shields.io/github/license/neat-tools/Neat)](https://github.com/neat-tools/Neat)
[![Release](https://img.shields.io/github/v/release/neat-tools/Neat)](https://github.com/neat-tools/Neat/releases)
[![Website](https://img.shields.io/badge/website-neat.is-black)](https://neat.is)

A unified runtime that maintains a live semantic model of your codebase, infrastructure, and production.

Query it. Assert policies against it. Emit IaC from it. Run agents against it.

---

## Statement

**Architecture is the first decision.**  
Everything else follows from it.

Modern tooling gives developers:
- dashboards
- logs
- alerts
- traces

But these are fragments.

NEAT builds a continuously updated semantic graph of your system by combining:

- **Static analysis** of source code and configuration
- **Runtime telemetry** from production systems

This creates a live architecture model that can be queried by both humans and AI agents.

With NEAT, you can:

- inspect service and infrastructure dependencies
- identify root causes across service boundaries
- analyse blast radius before changes
- assert architecture policies
- expose your system as an AI-queryable runtime

---

## Features

- Live architecture graph
- Tree-sitter powered code extraction
- OpenTelemetry ingestion
- Root cause traversal
- Blast radius analysis
- MCP server for AI agents
- Infrastructure graph querying

---

## Quickstart

```bash
npm install
npm run build
npm test
```

Run the development environment:

```bash
docker compose up
```

---

## Repository Layout

```bash
packages/
  types/   # Shared Zod schemas and types
  core/    # Graph engine, tree-sitter extraction, OTel ingest, REST API
  mcp/     # MCP server exposing graph queries to AI agents
  web/     # Next.js web shell (dashboard WIP)

demo/
  service-a/   # Node.js service calling service-b
  service-b/   # Intentional pg/PostgreSQL mismatch for root-cause demo
```

---

## Documentation

- `CLAUDE.md` — contributor and AI agent guide
- `docs/` — architecture, milestones, decisions, and runbooks

---

## Vision

Software systems should be queryable as architecture, not just inspected as code and logs.

NEAT turns your stack into a live semantic runtime.

---

## License

Licensed under the Apache 2.0 License.
