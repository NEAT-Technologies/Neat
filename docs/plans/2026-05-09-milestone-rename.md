# Milestone rename — v0.2.6 → v0.2.8

**Date:** 2026-05-09
**ADR:** [ADR-053 — Milestone naming convention](../decisions.md#adr-053--milestone-naming-convention)

## What happened

The milestone whose contract batch is ADRs 050/051 (CLI parity + frontend-API surface, contracts #23/#24) was originally named **v0.2.6**, projecting that 0.2.6 would be the npm version when its implementation shipped. Two publish-fix releases consumed the projected version:

- **0.2.5** broken — umbrella shipped without a `bin` field, so `npm install -g neat.is` didn't put binaries on PATH. Fixed by 0.2.6.
- **0.2.6** broken — umbrella's bin wrappers `require()`ed dist subpaths that `@neat.is/core` and `@neat.is/mcp` didn't expose in their `exports` field. Fixed by 0.2.7.
- **0.2.7** working. Latest published.

Both broken slots are permanently sealed on the npm registry per [npm's unpublish policy](https://docs.npmjs.com/policies/unpublish). The milestone, when its implementation ships, will publish as **0.2.8** — diverging from the milestone name by two patch versions.

ADR-053 codified the rule: when publish-fix releases consume the projected version before milestone implementation ships, the milestone name rolls forward to match the new projected version. This PR is the first application.

## What was renamed

Forward-looking references only. Historical references (commits, retired npm versions, closed status docs, PR descriptions) stay as they were — those reflect the world at the time and rewriting them would be revisionism.

| File | Change |
|------|--------|
| `CLAUDE.md` | "Where you are in the build" Track 2 block — `v0.2.6` → `v0.2.8`, plus a one-paragraph note explaining the rename |
| `docs/contracts.md` | Status fields on rows 23 / 24 — "v0.2.6 opens" → "v0.2.8 opens"; future-contracts footer updated |
| `docs/decisions.md` | ADR-050 and ADR-051 "Opens v0.2.6" lines → "Opens v0.2.8" with rename note; their `it.todo` enforcement references — `v0.2.6 #23` / `v0.2.6 #24` → `v0.2.8 #23` / `v0.2.8 #24` |
| `docs/contracts/cli-surface.md` | Body and enforcement section — `v0.2.6` → `v0.2.8` |
| `docs/contracts/frontend-api.md` | Same shape |
| `docs/milestones.md` | "Last session ended" block, Track 2 milestone list, "After v0.2.6" line — all updated; rename note added |
| `docs/plans/2026-05-04-v0.2.x-sequencing.md` | Section heading `### v0.2.6 — CLI parity...` → `### v0.2.8 — CLI parity...` with rename note |
| `docs/plans/2026-05-07-v0.2.6-kickoff.md` | Deprecation header at top redirecting to the new kickoff. File otherwise preserved as historical record. |
| `packages/core/test/audits/contracts.test.ts` | Comment headers in CLI surface and frontend-API describe blocks — `v0.2.6 #23` / `v0.2.6 #24` → `v0.2.8 #23` / `v0.2.8 #24` |

## What was NOT renamed

These references are historical fact and should not change:

- **`docs/decisions.md` ADR-052** body — references "0.2.6 broken-publish bug", "0.2.6 class failure", etc. These are real npm version refs to the broken release.
- **`docs/contracts/publish-system.md`** — same shape; refers to the 0.2.6 broken publish as historical context.
- **`docs/plans/2026-05-07-v0.2.5-close.md`** — written when the milestone was still named v0.2.6; preserves that historical state.
- **`docs/plans/2026-05-07-v0.2.5-kickoff.md`** — same.
- **`docs/plans/2026-05-07-v0.2.6-kickoff.md`** body — preserved as the historical kickoff under its original name; only the header gets a redirect note.
- **Commit messages** in `git log` — historical record. Future commits can reference v0.2.8.
- **Retired npm versions** (`0.2.5`, `0.2.6`) — those literal version numbers stay correct.

## What was added

- **ADR-053 — Milestone naming convention** — codifies the roll-forward rule.
- **`docs/plans/2026-05-09-v0.2.8-kickoff.md`** — canonical kickoff doc for the (renamed) milestone.
- **This file** — historical record of the rename itself.

## What didn't change

- **ADR numbers** — ADR-050, ADR-051, ADR-052 keep their numbers regardless of the milestone name.
- **Contract numbers** — contracts #23, #24, #25 keep their numbers.
- **Issue references** — `it.todo` annotations like `(ADR-050 #1)` stay; tracker issue numbers are independent of milestone naming.
- **Implementation queue** — contracts already drafted, regression tests already in place. The rename is purely cosmetic to documentation; no code or test changes that affect behavior.

## Verification

- `npx turbo build test lint` — green
- `vitest run test/audits/contracts.test.ts` — 132 live, 37 todo, 0 fail (unchanged from pre-rename state)
- `grep -rn "v0\.2\.6" docs/ CLAUDE.md packages/core/test/audits/contracts.test.ts` — only historical references remain (npm 0.2.6 retired version, deprecation header on old kickoff, the rename docs themselves)
