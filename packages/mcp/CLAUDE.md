# @neat/mcp

Placeholder. The full agent-facing guide (when to call which tool, how to interpret results, the skill.md companion) lands with issue #20 in M4.

For now: this package is the MCP stdio server. Six tool stubs are registered (`get_root_cause`, `get_blast_radius`, `get_dependencies`, `get_observed_dependencies`, `get_incident_history`, `semantic_search`) — each returns a "not yet implemented" placeholder pointing at its tracking issue.

To smoke-test the handshake: `npm run build --workspace @neat/mcp && node packages/mcp/dist/index.cjs` then send a JSON-RPC `initialize` over stdin.
