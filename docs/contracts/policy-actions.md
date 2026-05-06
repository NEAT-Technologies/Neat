---
name: policy-actions
description: Three onViolation actions — log, alert, block. Defaults derive from severity. Block applies to FrontierNode promotion gating only in MVP.
governs:
  - "packages/core/src/policy.ts"
  - "packages/core/src/ingest.ts"
  - "packages/mcp/src/resources.ts"
adr: [ADR-044]
---

# Policy onViolation actions contract

The third of four policy contracts. Sibling contracts: [`policy-schema.md`](./policy-schema.md), [`policy-evaluation.md`](./policy-evaluation.md), [`policy-tools.md`](./policy-tools.md).

## Three actions: `log`, `alert`, `block`

No others in MVP.

### `log`

Append to `policy-violations.ndjson`. No surface effect.

### `alert`

`log` + emit MCP `notifications/resources/updated` for `neat://policies/violations`.

### `block`

`log` + `alert` + **prevent** the action that would cause the violation.

**MVP scope: FrontierNode promotion gating only.** A `block`-action policy with a `provenance` or `compatibility` rule can return `{ allowed: false, violations: [...] }` from `canPromoteFrontier(nodeId)`, preventing the rewire.

Other gating points (deploy, codemod, OTel auto-create) need their own ADRs.

## Severity-driven defaults

When `onViolation` is omitted:

| Severity | Default |
|----------|---------|
| `info` | `log` |
| `warning` | `alert` |
| `error` | `alert` |
| `critical` | `block` |

Override per-policy.

## Authority

`packages/core/src/policy.ts`. Calls `appendPolicyViolation` (persist.ts) and `emitMcpNotification`. `block` returns `false` from gating checks; never reverts state.

## Block scope tightly bounded

Adding new block points requires an ADR amendment.

Full rationale: [ADR-044](../decisions.md#adr-044--policy-onviolation-actions-contract).
