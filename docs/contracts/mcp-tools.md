---
name: mcp-tools
description: Nine MCP tools, all read-only over REST, three-part response (NL + structured + confidence/provenance footer), get_dependencies is transitive, project scoping consistent.
governs:
  - "packages/mcp/src/**"
adr: [ADR-039]
---

# MCP tool surface contract

Governs `packages/mcp/src/`. Tools call REST against `NEAT_CORE_URL`; never read `graph.json` or mutate the graph.

## Tool count (locked)

Nine tools: `get_root_cause`, `get_blast_radius`, `get_dependencies`, `get_observed_dependencies`, `get_incident_history`, `semantic_search`, `get_graph_diff`, `get_recent_stale_edges`, `check_policies` (lands with #117).

The audit's `evaluate_policy` + `get_policy_violations` two-tool split is rejected per CLAUDE.md framing — `check_policies` handles both modes via optional `hypotheticalAction`.

## Three-part response (issue #143)

```
{NL paragraph — what was found, why it matters}

{structured block — typed payload, formatted}

confidence: X.XX · provenance: OBSERVED|EXTRACTED|...
```

Confidence and provenance derived per-result. Empty result → footer reads `confidence: n/a · provenance: n/a`.

A helper `formatToolResponse({ summary, block, confidence?, provenance? })` lives in `packages/mcp/src/format.ts`. Every tool routes through it.

## Transitive `get_dependencies` (issue #144)

Default depth 3, max 10. Calls a new core endpoint `GET /graph/node/:id/dependencies?depth=N` (see ADR-040). Returns flat list with distance, edge type, provenance. Direct-only consumers pass `depth=1`.

## REST-only data path

Every tool calls `NEAT_CORE_URL` via `client.ts`. No `graph.json` reads.

## Project scoping

Optional `project?: string`, defaulting to `'default'` per ADR-026. Multi-project routing happens at REST.

## No demo-name hardcoding

`payments-db`, `pg`, `postgresql` allowed only inside Zod `.describe()` strings. Never in branching logic.

## `semantic_search`

Tool description reflects the ADR-025 embedder chain (Ollama → MiniLM → substring), not "keyword search."

## Stdio only

HTTP / SSE / WebSocket transports remain post-MVP.

## Authority

Read-only. Mutation-authority scan in `contracts.test.ts` enforces this for `packages/mcp/src/`.

Full rationale: [ADR-039](../decisions.md#adr-039--mcp-tool-surface-contract).
