# @neat/mcp

The NEAT MCP server. Stdio JSON-RPC, eight tools, talks to a running `@neat/core` instance over HTTP.

## When to use these tools

Reach for NEAT before grepping or reading source for **architecture-level questions** about a running system: dependencies, runtime traffic, recent failures, what would break if X changed. The graph already knows the answer; reading code reconstructs the answer from scratch each time.

Rule of thumb: if the question would take more than two file reads to answer from source, try a NEAT tool first.

| Question shape                                       | Tool                       |
|------------------------------------------------------|----------------------------|
| "Why is X failing?" / "What's the root cause of …"   | `get_root_cause`           |
| "What breaks if I redeploy X?" / blast assessment    | `get_blast_radius`         |
| "What does X depend on?" / dependency tree           | `get_dependencies`         |
| "What does X actually call at runtime?"              | `get_observed_dependencies`|
| "Show me recent errors on X"                         | `get_incident_history`     |
| "Find nodes matching …"                              | `semantic_search`          |
| "What changed since the last snapshot?"              | `get_graph_diff`           |
| "Which integrations have gone quiet?"                | `get_recent_stale_edges`   |

If a tool returns "not found" or empty, check that core is running (`curl $NEAT_CORE_URL/health`) before falling back to source reads.

## Configuration

`NEAT_CORE_URL` — base URL for the core REST API. Default `http://localhost:8080`.

## Smoke-test the handshake

```bash
npm run build --workspace @neat/mcp
node packages/mcp/dist/index.cjs
# then send `{"jsonrpc":"2.0","id":1,"method":"initialize",…}` over stdin
```

## Provenance, briefly

Every edge and result carries a provenance:

- **OBSERVED** — seen in production via OTel. Trustworthy.
- **INFERRED** — computed from other edges (e.g. on error spans where the static graph fills in for missing instrumentation). Confidence ≈ 0.6.
- **EXTRACTED** — derived from source code or config. Always available, lowest authority.
- **STALE** — was OBSERVED, hasn't been seen recently. Treat with suspicion.

Tools surface this in their output so a result reading "INFERRED CONNECTS_TO" gets the right amount of trust from the consumer.
