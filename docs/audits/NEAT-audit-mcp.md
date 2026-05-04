# NEAT MCP Tools Audit — MVP (TypeScript v0.1.x)
## Load this before touching any MCP-related code.

**Scope:** This audit covers `packages/mcp` in the TypeScript MVP monorepo at `github.com/NEAT-Technologies/Neat`. It covers the MCP server setup, all tool implementations, tool response format, and the CLAUDE.md skill registration.

**Stack:** `@modelcontextprotocol/sdk` TypeScript SDK, stdio transport for local Claude Code, HTTP transport for remote connection, Fastify REST API in neat-core as the data source.

**The goal this audit serves:** The MCP tools are the interface between NEAT and Claude Code. They are what makes the PR goal possible. A tool that returns correct data in the wrong format, or returns stale data, or does not communicate provenance, fails the PR goal even if the graph behind it is perfect.

**What is not in scope for this audit:**
- NeatScript tool surface — v1.0 only
- Autonomous remediation MCP tools — v1.0 only
- Multi-agent orchestration — v1.0 only

---

## What the MCP tools must do — MVP

The MCP tools expose the live graph to Claude Code and any other MCP-compatible agent. They must answer real questions about real systems, not just the demo environment. Every tool must:

1. Query the live neat-core REST API — not graph.json, not a local cache
2. Return provenance information in the response so Claude Code can reason about trust
3. Communicate confidence scores when traversal is involved
4. Work on any system NEAT has modelled — not just the demo services
5. Return natural language responses that Claude Code can act on without further translation

---

## The contract

### 1. Server setup — MVP

The MCP server must be registered with the name `neat` and expose tools over stdio for local Claude Code connection.

**Verify:**
- Is the server name `neat` — exactly this, not `neat-mcp` or `neat-core`?
- Is stdio transport the primary transport?
- Is HTTP transport also supported for remote connection?
- Does the server start cleanly with `node packages/mcp/src/index.ts` or equivalent?
- Does Claude Code's `/list_tools` return all tools without error?
- Is the `NEAT_CORE_URL` environment variable read correctly (default: `http://localhost:8080`)?

### 2. CLAUDE.md — MVP

The CLAUDE.md in `packages/mcp` tells Claude Code when to use NEAT tools. It is the instruction set that makes NEAT's tools feel like ambient intelligence rather than tools the user has to remember to call.

**Verify:**
- Does CLAUDE.md exist at `packages/mcp/CLAUDE.md`?
- Does it instruct Claude Code to call `get_root_cause` before reading source files when asked about production failures?
- Does it instruct Claude Code to call `get_blast_radius` before suggesting changes to any service?
- Does it instruct Claude Code to call `get_observed_dependencies` to confirm what is actually running before making architectural assumptions?
- Does it state explicitly: "never assume the static code reflects production reality — use get_observed_dependencies to confirm"?
- Does it give example prompts that map to specific tools?

### 3. Response format contract — MVP

Every tool must follow the same response format. This is the contract between NEAT and Claude Code. Breaking it for one tool breaks Claude Code's ability to reason consistently across tools.

Format:
1. Natural language answer in plain English — one paragraph, directly answers the question
2. Structured data block — node names, paths, timestamps, confidence scores
3. Final line: `confidence: [score] · provenance: [edge provenances in path]`

**Verify:**
- Does every tool follow this three-part format?
- Is confidence always expressed as a decimal between 0.0 and 1.0?
- Is provenance always named — OBSERVED, EXTRACTED, INFERRED, STALE — not as a numeric code?
- Is the natural language paragraph written for Claude Code to act on — specific, not vague?
- Does the response fail gracefully when the graph has no data — clear message, not an empty response or a raw JSON error?

### 4. get_root_cause — MVP

The most important tool. This is what closes PRs.

Input schema:
```typescript
{
  errorNode: string  // name of the node where the error surfaced
  errorId?: string   // optional — specific error event ID from incidents
}
```

Calls: `GET ${NEAT_CORE_URL}/traverse/root-cause?node={errorNode}&errorId={errorId}`

Expected response for the demo scenario:
```
Root cause identified: pg driver 7.4.0 on service-b is incompatible 
with PostgreSQL 15 on payments-db. PostgreSQL 15 requires scram-sha-256 
authentication which pg < 8.0.0 does not support.

Traversal path: payments-db ← service-b ← service-a
Fix: upgrade pg to ^8.0.0 in service-b/package.json

confidence: 1.0 · provenance: OBSERVED, OBSERVED
```

**Verify:**
- Is `errorNode` validated as a non-empty string?
- Does the tool handle the case where the node does not exist in the graph — clear message, not a 404 propagated raw?
- Does the tool handle the case where no root cause is found — "no root cause identified in graph" — not null or undefined?
- Is the traversal path displayed as a chain (A ← B ← C) not as a flat list?
- Is the fix recommendation derived from the compatibility matrix result, not hardcoded?
- Does the fix recommendation work for any driver/engine incompatibility — not just pg/PostgreSQL?
- Is provenance listed for each edge in the traversal path — not just the overall confidence?

### 5. get_blast_radius — MVP

Input schema:
```typescript
{
  node: string  // name of the node to analyse
}
```

Calls: `GET ${NEAT_CORE_URL}/traverse/blast-radius?node={node}`

Expected response:
```
Blast radius of service-a: 2 nodes affected.

  service-b (distance: 1) — OBSERVED edge, confidence: 1.0
  payments-db (distance: 2) — OBSERVED edge via service-b, confidence: 1.0

Deploying or modifying service-a will directly impact service-b and 
indirectly impact payments-db.

confidence: 1.0 · provenance: OBSERVED, OBSERVED
```

**Verify:**
- Does the response list each affected node with its distance and provenance?
- Does it distinguish between direct (distance: 1) and indirect (distance: 2+) impact?
- Does it produce a human-readable summary of what the blast radius means — not just a list?
- Does it handle a node with zero blast radius — "no downstream dependencies found"?
- Does it surface STALE edges differently from OBSERVED edges in the response?

### 6. get_dependencies — MVP

Returns all direct and transitive dependencies of a service — combining EXTRACTED and OBSERVED edges.

Input schema:
```typescript
{
  service: string  // service name
}
```

Calls: `GET ${NEAT_CORE_URL}/graph/edges/{service}`

**Verify:**
- Does the response clearly separate OBSERVED dependencies from EXTRACTED-only dependencies?
- Does it communicate which dependencies are confirmed by live traffic and which are only declared in code?
- Does it handle transitive dependencies — not just direct edges?
- Is the response useful without further explanation — can Claude Code read it and immediately understand the dependency structure?

### 7. get_observed_dependencies — MVP

Returns only OBSERVED edges — dependencies confirmed by live OTel traffic. This is the tool that tells Claude Code what is actually running, not what the code says should be running.

Input schema:
```typescript
{
  service: string  // service name
}
```

Calls: `GET ${NEAT_CORE_URL}/graph/edges/{service}` filtered to OBSERVED provenance

Expected response:
```
Observed dependencies for service-b (confirmed by live traffic):

  → payments-db via CONNECTS_TO — last seen 8s ago, 312 calls
  ← service-a via CALLS — last seen 8s ago, 312 calls

No EXTRACTED-only dependencies exist for service-b that are not 
confirmed by observed traffic.

confidence: 1.0 · provenance: OBSERVED
```

**Verify:**
- Does the tool filter to OBSERVED edges only — not EXTRACTED or INFERRED?
- Does it include `lastObserved` timestamps in the response?
- Does it include `callCount` in the response?
- Does it handle STALE edges — does it include them or exclude them? Must be explicit either way.
- When no OBSERVED edges exist, does it say so clearly — "no live traffic observed for this service"?
- Is this tool the one Claude Code should call first when asked about what a service is actually doing in production?

### 8. get_incident_history — MVP

Returns error events linked to a specific node.

Input schema:
```typescript
{
  node: string    // node name
  limit?: number  // default 10
}
```

Calls: `GET ${NEAT_CORE_URL}/incidents/{node}?limit={limit}`

**Verify:**
- Is the response sorted newest first?
- Does it include timestamp, error type, error message, and trace ID for each event?
- Does it handle the case where no incidents exist — "no incidents recorded for this node"?
- Is the limit parameter respected?
- Does the response include enough context for Claude Code to connect an incident to a potential root cause without calling get_root_cause separately?

### 9. semantic_search — MVP

MVP implementation: keyword search over node names, node properties, and error messages. Not vector search — that is v1.0.

Input schema:
```typescript
{
  query: string  // search terms
}
```

Calls: `GET ${NEAT_CORE_URL}/search?q={query}`

**Verify:**
- Is the tool documented in CLAUDE.md as keyword search, not semantic vector search?
- Does it search across node names, node properties (including driver versions), and error messages?
- Does it return results with enough context for Claude Code to understand why each result matched?
- Is the v1.0 vector search upgrade noted in a comment so it is not accidentally implemented now?

### 10. get_policy_violations — MVP

Returns active policy violations. This tool does not exist in v0.1.2 — it is part of the policy layer being built. Include it here so the MCP audit covers the complete tool surface.

Input schema:
```typescript
{
  severity?: 'critical' | 'warning' | 'info' | 'all'  // default: all
}
```

Calls: `GET ${NEAT_CORE_URL}/policy/violations?severity={severity}`

Expected response:
```
2 active policy violations:

[CRITICAL] payments-isolation
  service-x has direct access to payments-db. Only payment-service 
  is permitted.
  Nodes: service-x, payments-db
  Action: alert

[WARNING] all-services-must-have-owner  
  service-y is missing required property: owner
  Nodes: service-y
  Action: alert

confidence: 1.0 · provenance: OBSERVED, EXTRACTED
```

**Verify:**
- Does the tool exist? If not, it must be created when the policy layer is built.
- Is severity filtering passed through as a query parameter?
- Does the response communicate what action was taken (alert/block/log)?
- Does it handle zero violations — "no active policy violations"?

### 11. evaluate_policy — MVP

Pre-flight check for autonomous agent actions. Allows Claude Code to ask "would this action violate any policies?" before taking it.

Input schema:
```typescript
{
  action: string       // description of the proposed action
  affectedNodes: string[]  // nodes that would be affected
}
```

Calls: `POST ${NEAT_CORE_URL}/policy/evaluate`

Expected response:
```
Policy evaluation: BLOCKED

Proposed action would violate 1 policy:

[CRITICAL] payments-isolation — block
  Adding service-x → payments-db CONNECTS_TO edge would violate 
  exclusive access policy. Only payment-service may connect to payments-db.

Do not proceed with this action.

confidence: 1.0 · provenance: OBSERVED
```

Or if no violations:
```
Policy evaluation: ALLOWED

No active policies would be violated by this action.
Proceed with confidence.
```

**Verify:**
- Does this tool exist? It is the enforcement gate for autonomous agent actions.
- Is the response unambiguous — BLOCKED or ALLOWED — not a list of potential issues?
- Does BLOCKED include the specific policy that would be violated and why?
- Does ALLOWED include a confidence indicator rather than a blank pass?

### 12. Tool count and completeness — MVP

The complete tool surface for the MVP is:

| Tool | Status in v0.1.2 |
|------|-----------------|
| get_root_cause | Shipped |
| get_blast_radius | Shipped |
| get_dependencies | Shipped |
| get_observed_dependencies | Shipped |
| get_incident_history | Shipped |
| semantic_search | Shipped (keyword stub) |
| get_policy_violations | Not yet — needs policy layer |
| evaluate_policy | Not yet — needs policy layer |

**Verify:**
- Does `/list_tools` in Claude Code return all 8 tools after the policy layer is built?
- Are get_policy_violations and evaluate_policy added when the policy layer ships — not deferred to a later release?

---

## General-purpose requirement

Every tool must work on any codebase NEAT has modelled. Not just the demo.

**Verify for each tool:**
- Is there any hardcoded reference to `service-a`, `service-b`, `payments-db`, or any demo-specific name in the tool implementation?
- Does the tool handle node names it has never seen before without throwing?
- Does the tool produce useful responses for graphs with only EXTRACTED edges — no OTel data yet?
- Does the tool produce useful responses for graphs with hundreds of nodes — not just the 3-node demo graph?

---

## Red flags

- Tools reading graph.json directly instead of calling the neat-core REST API
- Tools returning raw JSON from the API without formatting into natural language
- Confidence scores missing from traversal tool responses
- Provenance not communicated in tool responses
- Hardcoded demo service names in any tool implementation
- `get_policy_violations` or `evaluate_policy` missing after policy layer ships
- CLAUDE.md missing or not instructing Claude Code to use NEAT tools proactively
- Tool responses that return empty strings or null when no data is found — must return a clear message
- Tools that throw unhandled errors when neat-core is unreachable — must return a graceful error message
- semantic_search implemented as vector search in the MVP — it must be keyword search only

---

## Five questions — answer these before closing the audit

1. Does every tool call the neat-core REST API — not graph.json directly?
2. Does every tool response include provenance and confidence?
3. Is there any hardcoded demo service name in any tool implementation?
4. Do get_policy_violations and evaluate_policy exist after the policy layer ships?
5. Does CLAUDE.md instruct Claude Code to use NEAT tools proactively rather than reading files?

---

*MVP only. NeatScript tool surface, autonomous remediation tools, and multi-agent orchestration are v1.0.*
