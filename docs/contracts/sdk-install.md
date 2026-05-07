---
name: sdk-install
description: Per-language installer modules. Plan/apply decoupled. Manifests touched, lockfiles never. Idempotent. Composable with init.
governs:
  - "packages/core/src/installers/**"
  - "packages/core/src/cli.ts"
adr: [ADR-047, ADR-046, ADR-027]
---

# SDK install contract

The second of four v0.2.5 distribution-layer contracts. Sibling contracts: [`init.md`](./init.md), [`project-registry.md`](./project-registry.md), [`daemon.md`](./daemon.md).

NEAT's MVP success criterion (ADR-027) requires runtime telemetry. Pre-v1, NEAT installs the OTel SDK across the user's codebase via `neat init`. eBPF and service-mesh capture out of MVP.

## Installer module interface

```ts
{
  language: 'javascript' | 'python' | ...,
  detect(serviceDir): boolean,
  plan(serviceDir): InstallPlan,
  apply(serviceDir, plan): ApplyResult,
}
```

`plan` and `apply` decoupled — patch can be saved, reviewed, re-applied later.

## Two languages in MVP

| Language | Manifest edits | Entrypoint edits |
|----------|----------------|------------------|
| Node | `@opentelemetry/api`, `sdk-node`, `auto-instrumentations-node` → `package.json` deps | `scripts.start` (or Procfile / Dockerfile CMD) prefixed with auto-instrumentation hook |
| Python | `opentelemetry-distro`, `opentelemetry-exporter-otlp` → `requirements.txt` or `pyproject.toml` | entrypoint prefixed with `opentelemetry-instrument` |

Both set `OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318`.

**Java, Ruby, .NET, Go, Rust** — out of MVP. Each requires a successor ADR.

## Patch shape

```ts
InstallPlan = {
  language: string,
  dependencyEdits: Array<{ file, kind: 'add'|'remove', name, version }>,
  entrypointEdits: Array<{ file, before, after }>,
  envEdits: Array<{ file, key, value }>,
}
```

The plan is what `init` writes to `neat.patch`.

## Lockfiles never touched

Installers update **manifests** only. After `--apply`, init prints `Run "npm install"` so user owns the lockfile commit. NEAT does not run `npm install` itself.

## Idempotency

`plan(dir)` returns empty plan when SDK is already installed. Re-running `init --apply` produces no diff. No version-bump churn.

## Patch is deterministic

Same input → same patch. Reviewable byte-for-byte across runs.

## Apply failure is recoverable

Partial success → emits `neat-rollback.patch`. NEAT does not silently leave broken state.

## Composability

- `neat init --no-install` — graph + registry without SDK install.
- `neat install <path>` — alias for `init --skip-discovery --skip-registry`.

## Authority

`packages/core/src/installers/`. One file per language. Common patch-application in `installers/shared.ts`.

## Enforcement

`it.todo` for v0.2.5 #119. "Lockfiles never touched" is a regression scan.

Full rationale: [ADR-047](../decisions.md#adr-047--sdk-install-contract).
