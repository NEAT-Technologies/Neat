# Post-MVP-experiment scope — 2026-05-12

The ADR-027 experiment ran against medusajs/medusa under v0.3.0. Verdict: `no-PR-candidate`. 21 divergences surfaced, 21 false positives (precision 0.0), and the OBSERVED layer was empty throughout (no OTel wired) so ADR-027's "OBSERVED-layer-load-bearing" criterion was unsatisfiable by construction before extraction noise even surfaced as a problem.

Full audit trail: `~/neat-experiment/bugs/` — 21 divergence write-ups, 6 NEAT-side bug write-ups, INDEX.md, DRAFT-PR.md.

The honest reading: NEAT is not ready for an unfamiliar codebase yet. Three packaging blockers prevent the documented happy path from working at all, and the extracted graph itself is hallucinated from string literals in tests, JSDoc comment bodies, and JSX external-link props. The thesis surface (`get_divergences`) cannot be load-bearing while the EXTRACTED layer it sits on is producing zero real edges.

Two milestones come out of this. v0.3.1 patches the publish-hygiene blockers so the documented happy path actually works. v0.4.0 rebuilds static-extraction precision against an amended contract so a re-run of ADR-027 has signal to work with. After v0.4.0 closes, ADR-027 re-runs.

---

## v0.3.1 — Publish hygiene

Patch release. No new contract batch — amendments to the existing publish-system (ADR-052) and daemon (ADR-049) contracts plus the three blocker fixes. Three of the six NEAT-side findings from the experiment.

| Bug | Title | Fix shape |
|-----|-------|-----------|
| NEAT-BUG-1 | `neatd start` web UI crashes — `.next/` missing from `@neat.is/web` tarball | `prepublishOnly` runs `next build` (output: 'standalone'); `files` includes the standalone artifact; tarball smoke-test verifies the web UI actually serves a 200 on `/` |
| NEAT-BUG-2 | `neatd start` never binds REST :8080 or OTLP :4318 | Daemon entrypoint forks/in-process-starts the neat-core host per active project after project registration; smoke-test asserts `/graph` returns 200 within N seconds of `neatd start` |
| NEAT-BUG-3 | `neat watch` EMFILE on macOS for any repo with nested `node_modules` | Pass ignore globs (`**/node_modules/**`, `**/.git/**`, `**/dist/**`, `**/.next/**`, `**/.turbo/**`, `**/build/**`) as chokidar's first arg; macOS heuristic fallback to `usePolling: true` for repos above a directory-count threshold |

### Contract amendments

**ADR-052 (publish system, contract #25).** Add two assertions to the tarball smoke-test gate:

1. The unpacked `neat.is` tarball contains a built `@neat.is/web` artifact (`.next/standalone` or equivalent, asserted by file presence).
2. After `neatd start`, the REST endpoint at `http://localhost:8080/graph` returns 200 within 30 seconds. The web UI on `http://localhost:6328` returns 200 within 30 seconds. The OTLP receiver on `:4318` is bound (lsof or equivalent).

The current smoke test only verifies bin entrypoints resolve. That's insufficient — it caught nothing of substance in this run.

**ADR-049 (daemon, contract #22).** Tighten the wording of "single long-lived process, per-project graph isolation" to make it observably testable: after `neatd start`, every registered project has a graph host bound and reachable through the documented dual-mount paths. Add a contract assertion that mirrors the smoke-test wording above.

### Issues to file

- `#XYZ` — NEAT-BUG-1: web shell `.next/` missing from tarball
- `#XYZ` — NEAT-BUG-2: `neatd start` doesn't bind REST or OTLP
- `#XYZ` — NEAT-BUG-3: `neat watch` EMFILE on real-shape repos (macOS)
- `#XYZ` — ADR-052 amendment: tarball smoke-test must verify web-UI build and post-start REST bind
- `#XYZ` — ADR-049 amendment: per-project graph host binding is the contract surface

(Issue numbers TBD on filing.)

### Verification gate

- Fresh `npm install -g neat.is@0.3.1` on a clean machine.
- `neatd start` against a 2-project registry: both projects' `/graph` endpoints return non-empty within 30s, web UI at `:6328` returns the SPA shell.
- `neat watch ~/some-repo-with-nested-node_modules` boots without EMFILE on macOS, no env-var workaround required.
- `cd packages/core && npx vitest run test/audits/contracts.test.ts` — ADR-052 and ADR-049 assertion counts both grow by their new amendments.
- CI publish workflow's tarball smoke-test step exercises the new assertions on every tag push.

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

v0.3.1 is honest publish hygiene. The version under the npm tag didn't actually do what its README claimed. Fix that first; nothing else matters until the documented happy path works.

v0.4.0 is the extraction-precision rebuild that the divergence query needs to be credible. It rebuilds against a tightened contract — same pattern as the v0.2.x sequence. v0.3.1 first because contract work shouldn't happen on a broken substrate, and the regression-fixture corpus for v0.4.0 is most valuable when the v0.3.1 daemon can actually serve the project it's testing.

Both milestones are small in scope compared to a v0.2.x minor. v0.3.1 should be one engineering session — three blocker fixes plus two contract amendments. v0.4.0 should be one Contract Author session opening the batch, then one or two implementation sessions for the precision filters + loud failure mode.

---

## What we don't take on now

- **The OTel-instrumentation story for unfamiliar targets.** ADR-027 needs OBSERVED data on the target. Manual instrumentation is fine for the re-run; productizing "point NEAT at a repo and get OBSERVED data without thinking" is post-v0.4.0.
- **The daemon vs `neat watch` consolidation.** NEAT-BUG-2's fix puts REST behind `neatd start`, but the underlying architectural question of whether `neat watch` (single-project) should be merged into `neatd` (multi-project) is bigger than this round. The two coexist for now.
- **Issue #141 (source-level DB detection), #142 (framework field), #145 (dep cleanup).** Carried forward from v0.2.1 since v0.2.5 close. Still carried forward. They're not on the critical path for ADR-027.
- **A Rust v1.0 conversation.** Engineering hibernates until ADR-027 closes successfully. v0.4.0 closing without a merged upstream PR means another iteration on whatever the new failure mode reveals, not a jump to v1.0 work.

---

## Pick up here

The Contract Author writes the ADR-052 + ADR-049 amendments for v0.3.1 first (smallest, most mechanical). The implementation agent picks up the three blocker fixes against the locked contracts. v0.3.1 ships when all three smoke-test assertions are live and CI publishes a working 0.3.1 tarball.

Then the Contract Author writes the ADR-032 amendment for v0.4.0 — the five precision filters + the loud-failure-mode rule + the regression-fixture corpus seeded from the experiment evidence. Implementation against the locked contract follows. v0.4.0 ships when the medusa re-run drops divergence count by ≥ 95% and `errors.ndjson` surfaces the previously-silent failures.

ADR-027 re-runs after v0.4.0 closes. That re-run, not v0.4.0 itself, is the gate that decides what comes next.
