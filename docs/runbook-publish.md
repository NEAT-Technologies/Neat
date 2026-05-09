# Runbook — publishing to npm

Five packages ship to the npm registry on every release: `@neat.is/types`, `@neat.is/core`, `@neat.is/mcp`, `@neat.is/claude-skill`, and the `neat.is` umbrella. They publish in dependency order — npm rejects the umbrella if its deps aren't already on the registry.

The preferred path is **CI on tag push**. Local publish is a fallback for when CI isn't an option.

## One-time setup

### 1. npm account + 2FA

The owning account is `denizdogan-neat`. Confirm 2FA is enabled at https://www.npmjs.com/settings/denizdogan-neat/profile so any token rotation requires explicit auth, not just login credentials.

### 2. Granular npm token

Create at https://www.npmjs.com/settings/denizdogan-neat/tokens with these settings:

- **Type:** Granular access token
- **Expiration:** 1 year (or longer; rotate on calendar)
- **Packages and scopes:** read+write to the `@neat.is` scope and to the unscoped `neat.is` package
- **Organizations:** read+write to `neat.is` (if the org exists; otherwise leave blank — scope-level write is sufficient)

Copy the token. It's shown once.

### 3. GitHub Actions secret

Add the token as `NPM_TOKEN`:

```bash
gh secret set NPM_TOKEN --repo NEAT-Technologies/Neat
# paste token at the prompt
```

Or via the web UI: repo Settings → Secrets and variables → Actions → New repository secret.

The publish workflow at `.github/workflows/publish.yml` references this secret as `NODE_AUTH_TOKEN` and won't run without it.

## Routine publish (CI path)

Five steps from a clean working tree on `main`:

```bash
# 1. Bump versions in lockstep across all five publishable packages.
#    Edit by hand or use a small script — we don't have changesets.
#    Files: packages/{types,core,mcp,claude-skill,neat.is}/package.json
#    Don't forget the cross-package deps (`@neat.is/types: ^X.Y.Z` in core/mcp,
#    `@neat.is/core: ^X.Y.Z` in neat.is).

# 2. Commit + push.
git commit -am "Bump to X.Y.Z"
git push origin main

# 3. Tag.
git tag -a vX.Y.Z -m "vX.Y.Z"

# 4. Push the tag — this triggers the publish workflow.
git push origin vX.Y.Z

# 5. Watch it ship.
gh run watch --repo NEAT-Technologies/Neat
```

The workflow:

1. Checks out the tagged commit.
2. Runs `npm ci` + `npx turbo build test lint` (gates the publish on green).
3. Verifies all five package versions match (catches a half-bumped state).
4. Publishes in dependency order. Skips any package whose target version is already on the registry — re-runs after partial failure are safe.

A successful run produces five new package versions visible at https://www.npmjs.com/package/neat.is and the four scoped packages.

## Dry run via CI

To verify everything without publishing:

1. Go to repo Actions tab → Publish workflow → Run workflow.
2. Set `dry_run` input to `true`.
3. Run.

Same checks fire; `npm publish --dry-run` runs per package; nothing actually ships.

## Local fallback

When CI isn't an option (offline, hotfix, debugging the workflow itself):

```bash
# Make sure your local token is fresh.
npm whoami
# If 401, run `npm login` and retry.

# Then:
bash scripts/publish.sh             # publish for real
bash scripts/publish.sh --dry-run   # preflight + simulate
```

The script preflights aggressively:

- Verifies `npm whoami`. Fails fast on 401.
- Refuses to run if you're not on `main` (overridable with a confirm prompt).
- Refuses to run if the working tree has uncommitted changes.
- Verifies all five package versions are in lockstep before publishing anything.
- Skips packages already at the target version (idempotent re-runs).

## Troubleshooting

| npm error | Cause | Fix |
|---|---|---|
| `E401 Unauthorized` from `npm whoami` or publish | Local auth token expired or revoked. | `npm login` to refresh. Verify with `npm whoami`. |
| `E404 Not Found - PUT https://registry.npmjs.org/...` | Misleading error — usually means **auth failure** for an existing scoped package. npm hides 401/403 as 404 for some publish operations. | Same fix as 401. Run `npm whoami` first; re-login if needed. Verify scope membership: `npm access list packages` should include `@neat.is/*`. |
| `E403 Forbidden` | Token doesn't have publish scope on `@neat.is/*`, or 2FA `--otp` was required and not provided. | Recreate the granular token with the right scope, or pass `--otp=<code>` on a publish that requires it. |
| `E409 Conflict — version already published` | Trying to republish an existing immutable version. | Bump the version in all five package.jsons; tag a new vX.Y.Z. The local script auto-skips this case; you'd only see it in the CI workflow if version-sync check passed but a previous run already shipped this version. |
| Workflow runs but no packages publish | The version-sync check found mismatched versions, OR every package was already at the target version (no-op publish). | Look at the workflow log for the "Verify versions are in lockstep" step output. |
| `gyp ERR! find Python` or similar build errors during `prepublishOnly` | C toolchain missing on the runner. | CI runners come with build tools; locally install Xcode CLT (macOS), `build-essential` (Ubuntu), or MSVS Build Tools (Windows). |

## What ships and what doesn't

**Published:** `@neat.is/types`, `@neat.is/core`, `@neat.is/mcp`, `@neat.is/claude-skill`, `neat.is`.

**Not published:** `@neat.is/web` (private; lives in the monorepo for the v0.3.0 frontend track but isn't a runtime dep of anything else).

**Not in the umbrella:** anything outside the four core/mcp/claude-skill/types packages. The `neat.is` umbrella's job is to put `neat`, `neatd`, and `neat-mcp` on PATH — nothing else.

## When this runbook is wrong

- npm changes their token UI or 2FA flow — update the "One-time setup" section.
- Provenance attestations get added (`npm publish --provenance`) — update the workflow + setup section.
- A successor scope or org structure replaces `@neat.is` — update everywhere, including the publish workflow's idempotency check (`npm view <pkg>@<version>`).
