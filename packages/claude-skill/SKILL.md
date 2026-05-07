# NEAT — Claude Code skill

This skill exposes NEAT's live semantic graph to Claude Code over MCP. Once installed, Claude can ask the running NEAT daemon (`neatd`) about a project's services, dependencies, recent errors, and policy violations — same as any other agent NEAT supports.

## What you get

Nine MCP tools, served by `@neat.is/mcp` over stdio:

| Tool | What it does |
|------|--------------|
| `get_graph` | Snapshot of the full graph for a project — every node, every edge, with provenance. |
| `get_node` | One node by id, with its incoming and outgoing edges. |
| `get_dependencies` | Transitive closure of `DEPENDS_ON` / `CONNECTS_TO` from a starting node. |
| `get_root_cause` | Walks incoming edges from a failing node and returns the first divergence — typically a version mismatch or a config gap. |
| `get_blast_radius` | BFS outbound from a starting node — every service / database / config that would feel a change here. |
| `get_recent_errors` | Last N error events, ordered by `lastObserved`. |
| `semantic_search` | Embedding-based search over node names + descriptions. |
| `check_policies` | Runs the project's `policy.json` rules against the live graph. Returns active violations. |
| `get_compatibility` | Compatibility matrix lookups — what's known about a `<driver, engine>` pair. |

All nine read from the live graph the daemon maintains in memory. No fs reads of `graph.json` at request time.

## Install

The simplest path: add the snippet from `claude_code_config.json` to your Claude Code MCP config.

**macOS / Linux:**

```bash
# Print the snippet
cat node_modules/@neat.is/claude-skill/claude_code_config.json

# Or, with the neat CLI:
neat skill --print-config
```

Merge `mcpServers.neat` into your existing `~/.claude.json`.

**One-shot install** via the NEAT CLI:

```bash
neat skill --apply
```

This merges the `neat` server into `~/.claude.json` without touching other entries.

## Prerequisites

- `neat init <repo>` has registered at least one project.
- `neatd start` is running (or you're OK with `npx -y @neat.is/mcp` spawning per request — slower, but works).
- The `NEAT_API_URL` env var points at the running daemon's REST endpoint. Default is `http://localhost:8080`, which matches the daemon's default port.

## What's not in MVP

- Auto-detection of an alternate Claude Code config path. The installer assumes `~/.claude.json`.
- Per-project skill overrides. The skill is user-scoped; project-level MCP config can be added later as a follow-up.
- Tool-level disable flags. All nine tools are wired in; if you want to hide one, edit the snippet by hand.

## Where to look when it doesn't work

- `neatd status` — confirms the daemon is running and which projects are registered.
- `~/.claude.json` — the config file. Look for `mcpServers.neat`.
- `claude mcp list` — Claude Code's built-in inventory of MCP servers.
