---
name: neat
description: Query a live semantic graph of a running software system — dependencies, runtime traffic, root-cause analysis, blast radius, and incident history. Use this for architecture-level questions before reading source code.
---

# NEAT skill

NEAT keeps a continuously updated graph of a software system from static analysis + OpenTelemetry. This skill exposes it over six MCP tools.

## When to invoke

Reach for these tools when a question would take multiple file reads to answer from source. The graph already has the answer.

| Prompt                                                  | Tool                       |
|---------------------------------------------------------|----------------------------|
| "Why is payments-db failing?"                           | `get_root_cause`           |
| "What breaks if I redeploy service-a?"                  | `get_blast_radius`         |
| "What does service-a depend on?"                        | `get_dependencies`         |
| "What does service-b actually call at runtime?"         | `get_observed_dependencies`|
| "Show me recent errors on database:payments-db"         | `get_incident_history`     |
| "Find nodes matching pg"                                | `semantic_search`          |

## Tool reference

### `get_root_cause`

Trace upstream from a failing node to find the actual cause. Walks incoming dependency edges, prefers OBSERVED → INFERRED → EXTRACTED, runs the compatibility matrix at each ServiceNode against the originating DatabaseNode.

Inputs: `errorNode` (graph node id, e.g. `database:payments-db`), optional `errorId` (a specific incident id from `get_incident_history`).

### `get_blast_radius`

Walk outgoing dependencies from a node and list every downstream component with distance + the provenance of the edge that brought us to it.

Inputs: `nodeId`, optional `depth` (default 10, max 20).

### `get_dependencies`

Outgoing dependency tree, deduped to the most trustworthy provenance per (target, edge type) pair.

Inputs: `nodeId`.

### `get_observed_dependencies`

OBSERVED-only outgoing edges — services and databases the node actually contacted in production. Useful for spotting drift between code and reality.

Inputs: `nodeId`.

### `get_incident_history`

Recent OTel error events recorded against a node, newest first.

Inputs: `nodeId`, optional `limit` (default 20, max 100).

### `semantic_search`

Free-text match across node ids and names. Keyword-only for the MVP; vector search is a post-MVP enhancement.

Inputs: `query`.

## Configuration

Set `NEAT_CORE_URL` if `@neat/core` is not running on `http://localhost:8080`.

## Install

```bash
npm install -g @neat/mcp
neat install
```

This registers the server with Claude Code and the six tools become available in any session.
