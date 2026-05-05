# v0.2.x interim verification — 2026-05-05

A second-pass audit. Checks each merged PR against its corresponding contract assertion and verifies the GitHub issue state matches reality. Same shape as the original `docs/audits/verification.md` but scoped to v0.2.x work in flight.

**Method:** read main, run `packages/core/test/audits/contracts.test.ts`, walk each merged PR, cross-reference the GitHub issue state. Severity tags: PASS (shipped, contract green) / FAIL (closed without code) / DEFERRED (open, waiting for milestone) / NOT-BUILT (queued for later).

## v0.2.0 Sunrise — data-layer foundation

| Item | PR | Issue | State |
|------|----|----|-------|
| Audit verification pass | #130 | #126 | ✅ PASS — `docs/audits/verification.md` shipped, issue closed |
| AUDIT-DRIFT amendments | #146 | — | ✅ PASS — five audit-text fixes shipped |
| ADRs 028-031 + contract framework | #149 | — | ✅ PASS — 4 contracts, helpers, hook, snapshot guard all live |
| Documentation refresh | #148 | — | ✅ PASS — CLAUDE.md, milestones.md, plans/ |

Milestone closed. Tag `v0.2.0` released. ✅

## v0.2.1 Tree-sitter rebuild — partial

| Item | PR | Issue | State |
|------|----|----|-------|
| Contract #5 (static extraction) | #150 | — | ✅ PASS — ADR-032 + `docs/contracts/static-extraction.md` |
| Ghost-edge cleanup + universal evidence.file | #152 | #140 | ✅ PASS — issue closed, contract scan (`it('producers guard every edge write...')`) green |
| Source-level DB / import detection | — | #141 | ⚠ DEFERRED — open, no code in main |
| `framework` field on ServiceNode | — | #142 | ⚠ DEFERRED — open, no code in main |
| Drop unused graphology deps | — | #145 | ⚠ DEFERRED — open, no code in main |

Milestone closed at tag `v0.2.1` (commit `8d7e9ce`). Three issues deferred without prejudice — slot into a v0.2.1.x patch, fold into v0.2.3 (graphology drop is a traversal-adjacent concern), or accept as v0.x rolling cleanup. **Decision pending.**

## v0.2.2 OTel ingest rebuild — in flight

| Item | PR | Issue | State |
|------|----|----|-------|
| Contracts #6/#7/#8 (OTel batch) | #153 | — | ✅ PASS — three ADRs + three per-topic contracts merged |
| Non-blocking ingest | — | #131 | ❌ **REOPENED** — closed prematurely, no code, `it.todo` still queued |
| span-time `lastObserved` | #156 | #132 | ✅ PASS — live assertion at `contracts.test.ts:515`, replays a backdated span correctly |
| Parent-span cache | — | #133 | ❌ **REOPENED** — closed prematurely, no code, `it.todo` still queued |
| Auto-create Service / Database | — | #134 | ❌ **REOPENED** — closed prematurely, no code, `it.todo` still queued |
| Exception event parsing | #158 | #135 | ✅ PASS — live assertion at `contracts.test.ts:569` |
| `rebuildEdge` canonical helpers | #155 | (contract #8 cleanup) | ✅ PASS — `ingest.ts:463` template literal replaced with helper dispatch |
| Stitcher OBSERVED-twin skip | #157 | (contract #7 refinement) | ✅ PASS — refinement landed |

**Three issues reopened during this audit pass.** They were closed on GitHub without implementation code in main and the contract regression tests still queue them as `it.todo`. Reopening so future agents can land them honestly.

Milestone is open and active. Two-thirds of cleanup work has shipped; one-third remains.

## v0.2.3 Traversal rebuild — not yet started

Contracts #9/#10/#11 (traversal, getRootCause, getBlastRadius) have not been written. They open at the start of the milestone. Five issues queued: #136 (FRONTIER exclusion), #137 (BlastRadius schema fields), #138 (`distance` positive), #139 (schema validation), #123 (generalize `getRootCause`).

Status: NOT-BUILT, blocked on Contract Author writing contracts #9/#10/#11.

## v0.2.4 Policies + MCP refresh — not yet started

Contracts #12-#18 not written. Six issues queued: #115-#118 (policies α/β/γ/δ), #143 (MCP three-part response), #144 (transitive `get_dependencies`).

Status: NOT-BUILT.

## v0.2.5 Init + SDK install — not yet started

Contracts #19-#22 not written. One issue queued: #119.

Status: NOT-BUILT.

## Open product calls (carried)

Decisions still pending, blocking v0.2.4+:

1. **Policies REST path** — `/policies` (recommended) vs `/policy/violations`.
2. **Policies MCP tools** — one (`check_policies`) vs two (`check_policies` + `get_policy_violations`).
3. **`drivers` vs `dependencies` field name** — recommended: keep `dependencies` raw, defer `drivers` until a second consumer materializes.

## Test totals (at this verification point)

`@neat/core`: 248+ passing, 23 todo, 0 failing across 65 contract tests.

The remaining todos correspond to:
- v0.2.2 unfinished work (#131, #133, #134)
- v0.2.3 unstarted work (#136, #137, #138, #139)
- v0.2.4 unstarted work (#143, #144)
- v0.2.1 deferred work (#141, #142, #145)

Plus internal refinements (`rebuildEdge` variable-interpolation scan now passes since #155 fixed it; the `it.todo` for it can be promoted to a live regression scan in the next contract pass).

## Recommended next moves

**For the implementation agent:**

1. Pick up **#131 (non-blocking ingest)** first — it's architectural and shapes how #133's cache integrates. The cache work depends on #131's queue being in place.
2. Then **#133 (parent-span cache)** — builds on the queue.
3. Then **#134 (auto-creation)** — depends on #133's correlation working.

**For the Contract Author (me):**

Once v0.2.2 implementation lands (or the user calls v0.2.2 closed early), the next task is **drafting v0.2.3's contract batch** (#9 traversal + #10 getRootCause + #11 getBlastRadius). Same pattern as the v0.2.2 batch.

**For the user:**

1. Decide #141/#142/#145 deferral — slot, fold, or rolling cleanup.
2. Verify the three reopened v0.2.2 issues match expectation.
3. Confirm whether the Contract Author should start v0.2.3 contracts now (parallel with v0.2.2 implementation) or wait until v0.2.2 closes.

## What this verification doc is not

A replacement for the original `docs/audits/verification.md`. That graded v0.1.x against the original audits and produced the FAIL list that drove the contract framework. This doc grades v0.2.x progress against the contracts the framework produced. Each milestone-end (v0.2.2, v0.2.3, etc.) gets its own dated verification doc; the chain documents the rebuild as it lands.
