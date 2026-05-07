# neat.is

NEAT keeps a live semantic graph of a software system — code, infrastructure, runtime — and exposes it to AI agents over MCP.

## Install

```bash
npm install -g neat.is
```

That gives you three binaries:

- `neat` — CLI (init, watch, list, skill, etc.)
- `neatd` — daemon (start, stop, status, reload)
- `neat-mcp` — MCP stdio server for Claude Code and other agents

## Quick start

```bash
neat init /path/to/your/repo --project myrepo
neatd start
```

Snapshot lands at `<repo>/neat-out/myrepo.json`. The daemon watches for file changes and OTel traces and keeps the graph live.

## What's in the box

`neat.is` is an umbrella that pulls in:

- [`@neat.is/core`](https://www.npmjs.com/package/@neat.is/core) — graph engine, extractors, REST + OTel ingest
- [`@neat.is/mcp`](https://www.npmjs.com/package/@neat.is/mcp) — MCP server exposing graph queries to agents
- [`@neat.is/claude-skill`](https://www.npmjs.com/package/@neat.is/claude-skill) — drop-in Claude Code skill

## License

BUSL-1.1. See [neat.is](https://neat.is) for details.
