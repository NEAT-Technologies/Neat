---
name: publish-system
description: Bin-wrapper subpath validity, version lockstep, tarball smoke-test gate, dependency order, idempotency, npm immutability, engines field. Catches the 0.2.6 broken-publish failure shape mechanically.
governs:
  - "packages/neat.is/bin/**"
  - "packages/neat.is/package.json"
  - "packages/core/package.json"
  - "packages/mcp/package.json"
  - "packages/types/package.json"
  - "packages/claude-skill/package.json"
  - ".github/workflows/publish.yml"
  - "scripts/publish.sh"
adr: [ADR-052]
---

# Publish system contract

The npm publish pipeline. Five packages ship to the registry on every release; the system has been load-bearing since 0.2.5 but had no contract coverage, which is how the 0.2.6 broken-publish bug shipped. This contract closes that gap.

## Five packages, dependency-ordered

```
@neat.is/types  →  @neat.is/core  →  @neat.is/mcp  →  @neat.is/claude-skill  →  neat.is
```

The umbrella has no code of its own — three bin wrappers in `packages/neat.is/bin/` that delegate to dist files in `core` and `mcp` via `require()`. That delegation is what `npm install -g neat.is` relies on to put `neat` / `neatd` / `neat-mcp` on PATH.

## Bin-wrapper subpath validity

Every `require('@scope/pkg/subpath')` in `packages/neat.is/bin/*` must resolve to a path exposed in the target package's `exports` field.

Today's wrappers (post-0.2.7):

| Wrapper | `require()` target | Must appear in |
|---|---|---|
| `bin/neat` | `@neat.is/core/dist/cli.cjs` | `core/package.json` exports |
| `bin/neatd` | `@neat.is/core/dist/neatd.cjs` | `core/package.json` exports |
| `bin/neat-mcp` | `@neat.is/mcp/dist/index.cjs` | `mcp/package.json` exports |

**Why this matters:** in monorepo dev, workspace symlinks bypass Node's `exports` enforcement, so a wrapper can `require()` any path inside a sibling package and it works. Tarball installs don't have that escape hatch — Node refuses any subpath not listed in `exports`. The 0.2.6 publish broke exactly here: wrappers worked locally, failed for everyone who ran `npm install -g neat.is`.

A contract test parses each wrapper file, extracts the require target via regex, splits into `@scope/pkg` + `subpath`, walks the target package.json's `exports`, and asserts the subpath is exposed. Literal-key match for MVP; wildcard patterns are successor work.

## Version lockstep

All five publishable packages carry the same `version` string in their `package.json` on `main`. Cross-package dep ranges in the four packages that depend on others (`core` → `types`, `mcp` → `types`, `umbrella` → `core`/`mcp`/`claude-skill`) must match the same `X.Y.Z` exactly.

Half-bumped state on `main` is a contract violation. The CI workflow's "Verify versions are in lockstep" step blocks publish; a contract test on `main` blocks merge.

## Tarball smoke-test gate

The publish workflow must install the just-published umbrella tarball into a tmp dir and invoke `neat --help`, asserting exit code 0, before declaring success. Catches any failure shape that only surfaces under a real tarball install (the 0.2.6 class).

Implementation: a workflow step after the publish loop that does roughly:

```bash
TMP=$(mktemp -d)
cd "$TMP"
npm init -y > /dev/null
npm install "neat.is@${VERSION}"
./node_modules/.bin/neat --help > /dev/null
```

Exit non-zero on any failure. Fails the workflow run; the broken version stays on the registry (npm immutability) but the tag is suspect and the operator knows immediately.

## Dependency order

Publish proceeds in this order, never another:

```
types → core → mcp → claude-skill → neat.is
```

Out of order produces 404s — npm rejects publishes whose deps aren't on the registry yet. Encoded in both `.github/workflows/publish.yml` and `scripts/publish.sh`.

## Idempotency

Re-running the publish workflow after partial failure must skip packages already at the target version. Implementation: `npm view <pkg>@<version>` returns non-zero if the version isn't published; if it returns zero, skip. Re-runs after a 401 / network blip don't 409 on the packages that already landed.

## npm immutability

Once `name@version` is published, that slot is permanently sealed. `npm unpublish` does not free it for re-publish — the version number is reserved forever. Therefore:

- Publishing a broken version forces a patch-version bump (e.g. 0.2.6 broken → 0.2.7 fix).
- No tooling around `npm unpublish` recovery exists or should be built; npm policy makes the obvious recovery shape impossible.

Documented in `docs/runbook-publish.md`'s troubleshooting table.

## `engines.node: ">=20"`

Every publishable package and the umbrella. Older Node fails at install, not at runtime. The 20+ floor is what `chokidar@4`, modern `fastify@5`, and the rest of the dep tree assume.

## Authority

- **Bin wrappers**: `packages/neat.is/bin/{neat,neatd,neat-mcp}`
- **Package metadata**: each publishable `package.json`
- **CI publish**: `.github/workflows/publish.yml`
- **Local fallback**: `scripts/publish.sh`
- **Process docs**: `docs/runbook-publish.md`

## Enforcement

`describe` block in `contracts.test.ts`. Live assertions:

- **Subpath validity** — parses wrappers, walks exports, asserts every required subpath is exposed.
- **Version lockstep** — reads all five package.jsons, asserts versions match and cross-package dep ranges match the version.
- **`engines.node: ">=20"`** — every publishable package + umbrella has the field.
- **Dependency order** — the publish loop in `.github/workflows/publish.yml` and `scripts/publish.sh` references the five packages in `types → core → mcp → claude-skill → neat.is` order.

`it.todo` until the corresponding work lands:

- **Tarball smoke-test gate** — depends on the workflow step landing.

Documented invariants without mechanized tests (policy, not code):

- npm immutability and the no-unpublish-recovery rule (rules 6, 7).
- Idempotency (rule 5) — exercised by every re-run; failure mode is a re-publish 409 which is loud enough.

Full rationale: [ADR-052](../decisions.md#adr-052--publish-system-contract).
