# NEAT Policy Audit — MVP (TypeScript v0.1.x)
## Load this before building the policy layer.

**Scope:** This audit defines what the policy layer must be in `packages/core` of the TypeScript MVP monorepo at `github.com/NEAT-Technologies/Neat`. The policy layer does not exist yet. This document is a build contract, not a drift check.

**Stack:** policy.json file, Zod schemas in `@neat.is/types`, evaluation engine in `packages/core/src/policy.ts`, violations.ndjson output, REST API endpoints, MCP tool `get_policy_violations`.

**The goal this audit serves:** Policies must enforce architectural law continuously against the live graph. They must block autonomous agent actions before they violate declared constraints. They are not scan-time validators. They are not alerting rules. They are enforcement.

**What is not in scope for this audit:**
- NeatScript policy DSL — v1.0 only
- OPA/Rego integration — v1.0 only
- Policy UI in neat-web — Jed's concern
- Autonomous remediation pipeline — v1.0 only

---

## What the policy layer must be — MVP

A policy is a persistent assertion evaluated against the live graph on every mutation. When the graph diverges from the policy, a PolicyViolationEvent is created immediately — not the next time someone queries, not the next time neat init runs, immediately.

The policy layer has three parts:

**Definition** — `policy.json` checked into the repo. Human-readable, no TypeScript required to add a policy.

**Evaluation** — `packages/core/src/policy.ts`. Reads the live graphology instance. Runs on every graph mutation. Writes violations to `neat-out/violations.ndjson`.

**Enforcement** — the `block` onViolation type must prevent FRONTIER node promotion and autonomous agent actions before they execute. Not after.

---

## The contract

### 1. policy.json schema — MVP

The policy definition file lives at the repo root alongside `compat.json`. It must be valid JSON parseable by the Zod schema in `@neat.is/types`.

Minimum required schema:

```json
{
  "version": 1,
  "policies": [
    {
      "id": "string — unique, kebab-case",
      "description": "string — human readable",
      "enabled": true,
      "severity": "critical | warning | info",
      "type": "structural | compatibility | provenance | ownership | blast_radius",
      "rule": { ... },
      "onViolation": "alert | block | log"
    }
  ]
}
```

**Verify:**
- Is `policy.json` validated against a Zod schema from `@neat.is/types` on startup?
- If `policy.json` is malformed, does neat-core fail to start with a clear error or silently ignore the file?
- Is the schema versioned — does `version: 1` exist so future schema changes can be migrated?
- Is `id` enforced as unique? Duplicate policy IDs must be a startup error.

### 2. Policy types — MVP

The MVP must support these five policy types. No others.

**structural** — asserts topology constraints. Who may connect to what.
```json
{
  "type": "structural",
  "rule": {
    "targetNode": "payments-db",
    "targetType": "DatabaseNode",
    "allowedSources": ["payment-service"],
    "constraint": "exclusive_access"
  }
}
```

**compatibility** — asserts version compatibility. Extends the compat.json check as a continuous policy rather than a one-time extraction annotation.
```json
{
  "type": "compatibility",
  "rule": {
    "driver": "pg",
    "engine": "postgresql",
    "minDriverVersion": "8.0.0"
  }
}
```

**provenance** — asserts provenance requirements on edges in specific paths.
```json
{
  "type": "provenance",
  "rule": {
    "pathTo": "payments-db",
    "requiredProvenance": "OBSERVED"
  }
}
```

**ownership** — asserts that nodes carry required properties.
```json
{
  "type": "ownership",
  "rule": {
    "nodeType": "ServiceNode",
    "requiredProperty": "owner"
  }
}
```

**blast_radius** — asserts acceptable blast radius limits.
```json
{
  "type": "blast_radius",
  "rule": {
    "targetNode": "payments-db",
    "maxBlastRadius": 3
  }
}
```

**Verify:**
- Is there a type dispatch in the evaluator — one evaluator function per policy type?
- Does an unknown policy type fail loudly or silently skip?
- Is the `compatibility` type genuinely continuous — re-evaluated when a new ServiceNode arrives with a driver version — or does it only run at scan time?

### 3. Evaluation timing — the most important contract

**Policies must evaluate on every graph mutation. Not at scan time. Not at query time. On every mutation.**

A graph mutation is any of:
- A new node added to the graph
- A new edge added to the graph
- An existing edge's provenance upgraded (EXTRACTED → OBSERVED)
- An existing edge transitioned to STALE
- A FRONTIER node created

Every one of these events must trigger policy evaluation.

**Verify:**
- Is `evaluateAllPolicies()` called from `ingest.ts` after every span-driven graph mutation?
- Is `evaluateAllPolicies()` called from `extract.ts` after every extraction-driven graph mutation?
- Is it called after STALE transitions in the background staleness job?
- Is it called after FRONTIER node creation?
- Or is policy evaluation only called on REST API requests or on `neat init`? If yes, this is a critical gap — the layer is a validator, not an enforcer.

### 4. PolicyViolationEvent schema — MVP

Every violation must produce a typed event written to `neat-out/violations.ndjson`. The schema must be in `@neat.is/types`.

```typescript
PolicyViolationEvent {
  id: string          // uuid
  timestamp: string   // ISO8601
  policyId: string    // matches policy.json id
  policyDescription: string
  severity: 'critical' | 'warning' | 'info'
  violatingNodes: string[]  // node IDs involved in the violation
  reason: string      // human readable — what the violation is
  onViolation: 'alert' | 'block' | 'log'
  resolved: boolean   // false on creation
}
```

**Verify:**
- Is the PolicyViolationEvent schema in `@neat.is/types` as a Zod schema?
- Is it exported alongside ErrorEvent so both can be imported from the same package?
- Is `violations.ndjson` append-only — one JSON object per line — matching the pattern of `errors.ndjson`?
- Is `resolved: false` set on creation? Is there a mechanism to mark violations as resolved when the graph mutation that caused them is reversed?

### 5. onViolation: alert — MVP

When `onViolation` is `alert`, the violation is written to violations.ndjson and logged. Nothing else blocks. The system continues operating.

**Verify:**
- Is `alert` the default behaviour when no onViolation is specified?
- Is the violation written to violations.ndjson synchronously before the function returns?
- Is there a console.warn or structured log output for `critical` severity alerts?

### 6. onViolation: block — MVP

When `onViolation` is `block`, the violation must prevent the triggering action from completing.

In the MVP, `block` applies to two specific scenarios:

**FRONTIER node promotion** — when the agent attempts to graduate a FRONTIER node to OBSERVED, `evaluatePolicy(action)` must be called first. If any `block` policy would be violated by the promotion, it must not proceed.

**Autonomous agent actions via MCP** — when `evaluate_policy` is called by an agent before taking an action, a `block` result must be communicated clearly so the agent does not proceed.

**Verify:**
- Is there a `canPromoteFrontier(nodeId)` function that runs block policies before promotion?
- Does it return `{ allowed: boolean, violations: PolicyViolationEvent[] }` so the caller has full context?
- Is there an `evaluate_policy` MCP tool that agents can call before taking action?
- Does `block` actually prevent the action or does it only log that it would have been blocked?
- Is `block` only relevant for FRONTIER promotion and agent actions in the MVP, not for all graph mutations? Clarify the scope.

### 7. onViolation: log — MVP

`log` is the lowest severity. Write to violations.ndjson, no console output, no blocking.

**Verify:**
- Is `log` distinct from `alert` in implementation — specifically, no console.warn for `log` severity?

### 8. Structural policy evaluator — MVP

The structural evaluator checks topology constraints. It must query the live graph.

For `constraint: exclusive_access` on a DatabaseNode:
1. Get all incoming edges to the target node
2. Filter to edges of type `CALLS` or `CONNECTS_TO`
3. Check that all source nodes are in `allowedSources`
4. Any source not in `allowedSources` is a violation

**Verify:**
- Does the evaluator use `graph.inNeighbors(targetNodeId)` on the live graphology instance — not graph.json?
- Is the result a list of violating source node IDs?
- Does it handle the case where the target node does not yet exist in the graph? It must skip cleanly.
- Is `allowedSources` matched by node ID or node name? Must be consistent with how nodes are identified throughout the system.

### 9. Compatibility policy evaluator — MVP

The compatibility evaluator is the policy-layer version of what `compat.json` already does at extraction time. The difference is timing — the compat.json check runs once at scan time. The policy evaluator runs continuously.

For a compatibility policy on `pg/postgresql`:
1. Find all ServiceNodes with a `pg` driver version property
2. Find all DatabaseNodes they connect to with `engine: postgresql`
3. For each pair, check the driver version against the policy's `minDriverVersion`
4. Any pair below `minDriverVersion` is a violation

**Verify:**
- Is the compatibility policy evaluator distinct from the compat.json check in extract.ts?
- Does it re-evaluate when a new CONNECTS_TO OBSERVED edge appears between a service and a database?
- Does it use `semver.lt()` for version comparison — not string comparison?
- Does it handle services where the driver version is not yet known (not extracted)? It must skip those, not throw.

### 10. Provenance policy evaluator — MVP

The provenance evaluator asserts provenance requirements on edges in a path.

For `requiredProvenance: OBSERVED` on `pathTo: payments-db`:
1. Find all incoming edges to `payments-db`
2. Check each edge's provenance
3. Any edge that is not OBSERVED is a violation

**Verify:**
- Does the evaluator traverse all incoming edges to the target node?
- Does it handle multi-hop paths or only direct edges? For MVP, direct edges only is acceptable — note it as v1.0 debt if multi-hop is skipped.
- Does it handle STALE edges? An edge that was OBSERVED but is now STALE may still be a violation depending on policy intent.

### 11. Ownership policy evaluator — MVP

The ownership evaluator checks that nodes carry required properties.

For `requiredProperty: owner` on `nodeType: ServiceNode`:
1. Iterate all nodes in the graph
2. Filter to the specified node type
3. Check each node for the required property
4. Any node missing the property is a violation

**Verify:**
- Does the evaluator use `graph.forEachNode()` on the live graphology instance?
- Does it handle the case where no nodes of the specified type exist? It must return no violations, not throw.

### 12. Blast radius policy evaluator — MVP

The blast radius evaluator uses the existing `getBlastRadius()` function from traverse.ts.

**Verify:**
- Does the policy evaluator call `getBlastRadius(targetNode)` from traverse.ts — not reimplement the traversal?
- Does it compare `result.totalAffected` against `maxBlastRadius`?
- Is this re-evaluated when new edges are added to the graph that might increase the blast radius of a monitored node?

### 13. REST API endpoints — MVP

Two new endpoints must be added to the Fastify API in api.ts:

```
GET /policy/violations                    — all active violations, newest first
GET /policy/violations?severity=critical  — filtered by severity
GET /policy/violations/:policyId          — violations for a specific policy
POST /policy/evaluate                     — dry-run evaluation against a proposed action
```

**Verify:**
- Do the violation endpoints read from violations.ndjson or from an in-memory violation store?
- If from violations.ndjson, is there pagination? A busy system could produce many violations.
- Is `POST /policy/evaluate` implemented for the dry-run use case?

### 14. MCP tool — MVP

One new MCP tool must be added in packages/mcp:

`get_policy_violations(severity?: 'critical' | 'warning' | 'info' | 'all')`

Response format — same contract as all other MCP tools:
1. Natural language summary of active violations
2. Structured list: policy ID, reason, violating nodes, severity
3. Final line: `total violations: N · critical: N · warning: N`

**Verify:**
- Does the tool call `GET ${NEAT_CORE_URL}/policy/violations` on the neat-core REST API?
- Does it format the response in natural language suitable for Claude Code to reason about?
- Is severity filtering passed through as a query parameter?

---

## What continuous enforcement looks like

When a new CONNECTS_TO OBSERVED edge arrives between service-x and payments-db, this sequence must occur automatically:

1. `ingest.ts` upserts the edge into the live graph
2. `ingest.ts` calls `evaluateAllPolicies()`
3. The structural evaluator checks whether service-x is in `allowedSources` for payments-db
4. It is not — violation created
5. PolicyViolationEvent written to violations.ndjson
6. `console.warn` if severity is critical
7. The next call to `GET /policy/violations` returns the new violation
8. The next call to the `get_policy_violations` MCP tool surfaces it to Claude Code

This entire sequence must complete within the same event loop cycle as the edge upsert. No deferred evaluation.

---

## Red flags

- `evaluateAllPolicies()` called only from REST API handlers or `neat init` — not from graph mutation points
- `onViolation: block` logging the violation but not actually preventing the action
- Policy evaluation reading graph.json instead of the live graphology instance
- `canPromoteFrontier()` not existing — FRONTIER promotion has no policy gate
- Compatibility policy using string comparison instead of `semver.lt()`
- PolicyViolationEvent schema defined locally rather than in `@neat.is/types`
- violations.ndjson not existing or not being written to
- `evaluate_policy` MCP tool missing — agents have no way to pre-flight check actions
- Policy types beyond the five listed being added — scope creep
- NeatScript policy syntax appearing anywhere in the MVP — it is v1.0 only

---

## Five questions — answer these before closing the audit

1. Is `evaluateAllPolicies()` called from both `ingest.ts` and `extract.ts` after every graph mutation?
2. Does `onViolation: block` actually prevent FRONTIER promotion or does it only log?
3. Does the compatibility policy evaluator use `semver.lt()` for version comparison?
4. Is PolicyViolationEvent defined in `@neat.is/types` as a Zod schema?
5. Is there a `get_policy_violations` MCP tool that surfaces active violations to Claude Code?

---

*MVP only. NeatScript policy DSL, OPA/Rego integration, and the full enforcement surface for autonomous remediation are v1.0.*
