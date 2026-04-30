# NEAT

Production intelligence platform that maintains a live semantic graph of software systems, queryable by AI agents over MCP.

## Quickstart

```bash
pnpm install
pnpm build
pnpm test
```

See `CLAUDE.md` for the contributor / agent guide and `docs/` for architecture, milestones, runbook, and decisions.

## Layout

```
packages/
  types/   shared Zod schemas and types
  core/    graph engine, tree-sitter extraction, OTel ingest, REST API
  mcp/     MCP server exposing graph queries to AI agents
  web/     Next.js shell (no dashboard for MVP)
demo/
  service-a/  Node.js service (calls service-b)
  service-b/  Node.js service with intentional pg/PostgreSQL mismatch
```
