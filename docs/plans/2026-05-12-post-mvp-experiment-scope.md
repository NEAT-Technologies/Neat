# Post-MVP-experiment scope — 2026-05-12

The ADR-027 experiment ran against medusajs/medusa under v0.3.0. Verdict: `no-PR-candidate`. 21 divergences surfaced, 21 false positives (precision 0.0), and the OBSERVED layer was empty throughout (no OTel wired) so ADR-027's "OBSERVED-layer-load-bearing" criterion was unsatisfiable by construction before extraction noise even surfaced as a problem.

Full audit trail: `~/neat-experiment/bugs/` — 21 divergence write-ups, 6 NEAT-side bug write-ups, INDEX.md, DRAFT-PR.md.

The honest reading: NEAT is not ready for an unfamiliar codebase yet. Three packaging blockers prevent the documented happy path from working at all, and the extracted graph itself is hallucinated from string literals in tests, JSDoc comment bodies, and JSX external-link props. The thesis surface (`get_divergences`) cannot be load-bearing while the EXTRACTED layer it sits on is producing zero real edges.

Three milestones come out of this. v0.3.1 fixes the daemon so `neatd start` actually runs NEAT. v0.3.2 fixes the npm tarball so the documented happy path serves on install. v0.4.0 rebuilds static-extraction precision against an amended contract so a re-run of ADR-027 has signal to work with. The split between v0.3.1 and v0.3.2 is by load-bearing question, not by bug count: v0.3.1 is daemon surgery (one architectural change), v0.3.2 is packaging hygiene (two mechanical fixes + the smoke-test gate that verifies them). They're sequenced rather than bundled because v0.3.2's smoke-test gate (ADR-052 amendment) depends on the things it's checking being true first — and v0.3.1's daemon fix is what makes the smoke test's REST-bound assertion reachable. After v0.4.0 closes, ADR-027 re-runs.

---

## v0.3.1 — Daemon binds REST

Patch release. **One load-bearing question:** does `neatd start` actually run NEAT? One bug fix + one contract amendment.

| Bug | Title | Fix shape |
|-----|-------|-----------|
| NEAT-BUG-2 | `neatd start` never binds REST :8080 or OTLP :4318 | Daemon entrypoint forks/in-process-starts the neat-core host per active project after project registration; per-project mount paths per ADR-026 dual-mount |

### Contract amendments

**ADR-049 (daemon, contract #22).** Tighten the wording of "single long-lived process, per-project graph isolation" to make it observably testable: after `neatd start`, every registered project has a graph host bound and reachable through the documented dual-mount paths (`GET /projects/:project/graph` returns 200). REST host on `:8080`, OTLP receiver on `:4318`. Bind within 30 seconds of `neatd start` returning. Add corresponding live assertions to `packages/core/test/audits/contracts.test.ts` under the `Daemon contract (ADR-049)` describe block.

### Issues

- #232 — NEAT-BUG-2: `neatd start` doesn't bind REST or OTLP
- #235 — ADR-049 amendment: per-project graph host binding is the contract surface

### Verification gate

- `neatd start` against a 2-project registry: every project's `/graph` endpoint returns 200 within 30s, OTLP `:4318` bound.
- Single-project default-mount path also serves (`GET /graph` returns 200, unprefixed) per ADR-026.
- `cd packages/core && npx vitest run test/audits/contracts.test.ts` — ADR-049 assertion count grows by the binding-as-contract-surface amendments.

The web UI and watcher blockers (NEAT-BUG-1, NEAT-BUG-3) are still broken at v0.3.1; that's expected. CLI users can drive NEAT through REST/MCP without the web UI. v0.3.1 ships as soon as the daemon question is answered, even though `neatd start --web` still crashes the web side.

---

## v0.3.2 — Tarball ships working artifacts

Patch release. **One load-bearing question:** does the published npm tarball serve a working stack? Two bug fixes + one contract amendment whose smoke-test gate verifies both.

| Bug | Title | Fix shape |
|-----|-------|-----------|
| NEAT-BUG-1 | `neatd start` web UI crashes — `.next/` missing from `@neat.is/web` tarball | `prepublishOnly` runs `next build` (output: 'standalone'); `files` includes the standalone artifact; bin wrapper runs the standalone server |
| NEAT-BUG-3 | `neat watch` EMFILE on macOS for any repo with nested `node_modules` | Pass ignore globs (`**/node_modules/**`, `**/.git/**`, `**/dist/**`, `**/.next/**`, `**/.turbo/**`, `**/build/**`) as chokidar's first arg; darwin heuristic fallback to `{ usePolling: true }` for repos above a directory-count threshold |

### Contract amendments

**ADR-052 (publish system, contract #25).** Add two assertions to the tarball smoke-test gate, now that the things they verify can be true:

1. The unpacked `neat.is` tarball contains a built `@neat.is/web` artifact (`.next/standalone` or equivalent, asserted by file presence).
2. After `neatd start`, within 30 seconds:
   - `curl http://localhost:8080/graph` returns 200 (already-true post-v0.3.1; the smoke test makes it observable in CI).
   - `curl http://localhost:6328/` returns 200 (covers NEAT-BUG-1).
   - `:4318` is bound by the daemon process.
3. The smoke-test fixture project registry includes at least two projects, at least one with nested `node_modules`, to also exercise NEAT-BUG-3's polling path.

The current smoke test only verifies bin entrypoints resolve. That's insufficient — it caught nothing of substance in the v0.3.0 release.

### Issues

- #231 — NEAT-BUG-1: web shell `.next/` missing from tarball
- #233 — NEAT-BUG-3: `neat watch` EMFILE on real-shape repos (macOS)
- #234 — ADR-052 amendment: tarball smoke-test must verify web-UI build and post-start REST bind

### Verification gate

- Fresh `npm install -g neat.is@0.3.2` on a clean machine.
- `neatd start` against a 2-project registry: REST + OTLP + web UI all bound (v0.3.1 + v0.3.2 combined).
- `neat watch ~/some-repo-with-nested-node_modules` boots without EMFILE on macOS, no env-var workaround required.
- CI publish workflow's tarball smoke-test step exercises the three new assertions on every tag push.

After v0.3.2, the documented `npm install -g neat.is && neatd start && open http://localhost:6328` happy path works end-to-end. That's the precondition v0.4.0 — and the eventual ADR-027 re-run — were waiting on.

---

## v0.4.0 — Extraction precision

Minor release. Opens with a contract batch amending the static-extraction contract (ADR-032, contract #5). Then the rebuild against the locked contract. Mirrors the v0.2.x rebuild-against-locked-contract pattern.

The three remaining NEAT-side findings from the experiment, plus a deferred carryover.

| Bug | Title | Fix shape |
|-----|-------|-----------|
| NEAT-BUG-4 | Ghost CALLS / CONNECTS_TO edges from string literals in tests, JSDoc comments, JSX external-link props, `.env.template` files, raw `*Client()` constructors | Five extraction filters, codified as contract assertions and a regression-fixture corpus seeded from the experiment's evidence rows |
| NEAT-BUG-5 | AWS S3 (and likely all AWS SDK clients) labelled `infra:grpc-service:S3` | Default unknown `*Client(...)` to `infra:service:X`; pattern-match `@aws-sdk/client-*` imports for accurate kind labelling |
| NEAT-BUG-6 | ~90 medusa files silently skipped during `neat init` with "Invalid argument" tree-sitter errors | Route per-file extraction failures to `neat-out/errors.ndjson`; surface aggregate count in init banner; `NEAT_STRICT_EXTRACTION=1` exits non-zero; investigate underlying tree-sitter cause |
| (carryover) | Ghost-edge cleanup keyed on `evidence.file` (issue #140) | Already filed under v0.2.1; folds into v0.4.0 because the cleanup-side and creation-side fixes ship together |

### Contract amendments

**ADR-032 (static extraction, contract #5).** Add a "Precision filters" section codifying five binding rules for CALLS / CONNECTS_TO inference:

1. **Test-scope exclusion.** Files under `**/__tests__/**`, `**/__fixtures__/**`, `**/integration-tests/**`, and files matching `*.spec.{ts,tsx,js,jsx}` / `*.test.{ts,tsx,js,jsx}` are excluded from CALLS / CONNECTS_TO inference. They remain in the snapshot as service-internal nodes; only outbound inference is filtered.
2. **Comment-body exclusion.** No edge is inferred from a string literal that lies inside a comment token. tree-sitter exposes comment-node boundaries; honour them.
3. **JSX external-link exclusion.** No edge is inferred from a URL string passed to `<Link to=...>`, `<a href=...>`, `<NavLink to=...>`, or any JSX attribute on an element whose tag matches `/^(a|Link|NavLink|ExternalLink|Anchor)$/`. The pattern is "user-clickable UI hyperlink to a documentation/marketing site," not "service-to-service call."
4. **`.env.template` exclusion.** Files matching `.env.template`, `.env.example`, `.env.*.template`, `.env.*.example` are documentation artifacts. They are not registered as ConfigNodes and do not produce CONFIGURED_BY edges. ADR-016 already binds ConfigNode to file existence at runtime; templates are not runtime.
5. **No URL-substring service matching.** A URL whose hostname is `medusa.cloud` does not match the service `@medusajs/medusa` by substring containment. Cross-service inference from URL strings requires an exact hostname match against a registered ServiceNode alias or InfraNode hostname, not substring containment.

Each rule lands as a live contract assertion in `contracts.test.ts` plus a fixture under `packages/core/test/fixtures/precision/` seeded directly from the experiment's evidence rows (0014, 0016, 0006, 0008, 0007 are the highest-signal cases).

**ADR-022 (infra:<kind>:<name> id format).** No contract change — the format already permits `infra:service:S3`. The fix is a producer-side default change. Document the AWS-SDK pattern recognition in the static-extraction contract as a non-binding guideline (which AWS clients map to which `kind`) since the field is free-string by ADR-022.

**Loud failure mode** (new section in static-extraction contract). Per-file extraction failures are written to `<projectDir>/neat-out/errors.ndjson` with `{file, error, stack, ts}`. The `neat init` and `neat watch` summary banners include `N files skipped due to parse errors`. `NEAT_STRICT_EXTRACTION=1` makes any extraction failure cause non-zero exit. Silent partial extraction is forbidden — if the producer is incomplete, the snapshot is observably incomplete.

### Issues to file

- `#XYZ` — NEAT-BUG-4: precision filters (one issue per filter, or one umbrella with five checkboxes — TBD on filing)
- `#XYZ` — NEAT-BUG-5: AWS-SDK client kind classification
- `#XYZ` — NEAT-BUG-6: loud failure mode for per-file extraction errors
- `#XYZ` — ADR-032 amendment: precision filters + loud failure mode
- `#140` — already filed: ghost-edge cleanup keyed on `evidence.file` (rolled in)

### Verification gate

- Re-run `neat init` against medusa at the same pinned commit (`370676c2a737fb3b558a745ad452a2c9d4ae6de5`). Every false-positive row from the 2026-05-12 experiment is verified gone. The regression-fixture corpus encodes this.
- Total divergence count drops by ≥ 95% on the medusa snapshot under v0.4.0 vs v0.3.0 (the 21 from this experiment should resolve to 0-2 surviving rows).
- `<projectDir>/neat-out/errors.ndjson` exists and contains the ~90 medusa files that silently failed in v0.3.0; init banner names the count.
- Contract scoreboard grows by the new ADR-032 assertions, all live, none `it.todo`.

### Closing gate

v0.4.0 closes when the verification gate passes **and** ADR-027 re-runs against medusa with OTel instrumentation attached. The re-run is the actual test — the precision fixes are necessary preconditions, not the success criterion. Outcome of the re-run determines what v0.4.x or v0.5.0 is for.

---

## Why this split

The three milestones each answer exactly one question.

- **v0.3.1: does `neatd` run NEAT?** Architectural surgery on the daemon supervisor. One real change. Once shipped, anyone (human via CLI, agent via MCP) can drive NEAT after `neatd start`.
- **v0.3.2: does the npm tarball ship a working stack?** Packaging hygiene — the web build lands in the tarball, the watcher boots on real repos, the smoke-test gate verifies both. Patches the v0.3.0 publish lie.
- **v0.4.0: does extraction produce trustworthy edges?** Precision rebuild against a tightened static-extraction contract. Same pattern as the v0.2.x sequence.

v0.3.1 ships before v0.3.2 because v0.3.2's smoke-test gate (ADR-052 amendment) verifies REST/OTLP-bind among other things — that assertion is unreachable while the daemon doesn't bind. v0.3.2 ships before v0.4.0 because the regression-fixture corpus for v0.4.0 is most valuable when the v0.3.2 daemon-plus-tarball can actually serve the project it's testing through the documented surface.

Each milestone is small in scope compared to a v0.2.x minor. v0.3.1 should be one Contract Author + one implementation session. v0.3.2 should be one Contract Author + one implementation session. v0.4.0 should be one Contract Author session opening the batch, then one or two implementation sessions for the precision filters + loud failure mode.

---

## What we don't take on now

- **The OTel-instrumentation story for unfamiliar targets.** ADR-027 needs OBSERVED data on the target. Manual instrumentation is fine for the re-run; productizing "point NEAT at a repo and get OBSERVED data without thinking" is post-v0.4.0.
- **The daemon vs `neat watch` consolidation.** NEAT-BUG-2's fix puts REST behind `neatd start`, but the underlying architectural question of whether `neat watch` (single-project) should be merged into `neatd` (multi-project) is bigger than this round. The two coexist for now.
- **Issue #141 (source-level DB detection), #142 (framework field), #145 (dep cleanup).** Carried forward from v0.2.1 since v0.2.5 close. Still carried forward. They're not on the critical path for ADR-027.
- **A Rust v1.0 conversation.** Engineering hibernates until ADR-027 closes successfully. v0.4.0 closing without a merged upstream PR means another iteration on whatever the new failure mode reveals, not a jump to v1.0 work.

---

## Pick up here

**v0.3.1 first.** Contract Author writes the ADR-049 amendment (#235) — single, mechanical. Implementation agent picks up #232 (daemon binds REST) against the locked contract. v0.3.1 ships when `neatd start` answers the binding contract for every registered project and the new ADR-049 assertions are live in `contracts.test.ts`. Tag and publish 0.3.1.

**v0.3.2 next.** Contract Author writes the ADR-052 amendment (#234) — the smoke-test gate that verifies what v0.3.1 made true plus what v0.3.2 will make true. Implementation agent picks up #231 (web shell `.next` build) and #233 (chokidar polling fallback). v0.3.2 ships when the documented `npm install -g neat.is && neatd start && open http://localhost:6328` happy path works on a clean macOS machine. Tag and publish 0.3.2.

**v0.4.0 next.** Contract Author writes #236 (ADR-032 amendment — the five precision filters + the loud-failure-mode rule + the regression-fixture corpus seeded from the experiment evidence). Implementation agent picks up #237 + #238 + #239 (+ carries #140 forward). v0.4.0 ships when the medusa re-run drops divergence count by ≥ 95% and `errors.ndjson` surfaces the previously-silent failures.

ADR-027 re-runs after v0.4.0 closes. That re-run, not v0.4.0 itself, is the gate that decides what comes next.
