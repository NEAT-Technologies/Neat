
<p style="color:red;"><strong>Note:</strong> This repository is currently a Work In Progress of an MVP. All systems & code design decisions where made for development speed.</p>            
#NEAT

[![CI](https://github.com/neat-tools/Neat/actions/workflows/copilot-swe-agent/copilot/badge.svg)](https://github.com/neat-tools/Neat/actions/workflows/copilot-swe-agent/copilot)
[![License](https://img.shields.io/github/license/neat-tools/Neat)](https://github.com/neat-tools/Neat)
[![Release](https://img.shields.io/github/v/release/neat-tools/Neat)](https://github.com/neat-tools/Neat/releases)

A unified runtime that maintains a live semantic graph of your codebase, infrastructure, and production. Query it. Assert policies against it. Emit IaC from it. Run agents against it.       

Architecture is the first decision.    
Everything else follows from it.    

Software tooling has not evolved alongside mass AI adoption.     

The tools we use were built for humans navigating systems. They produce dashboards, logs, and alerts. They don't produce understanding.      

NEAT keeps a live semantic graph of your whole stack. code, infrastructure, runtime; and lets you query it, write policies against it, generate IaC from it, and run agents over it.        


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
