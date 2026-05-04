# Architecture Decision Records

Decisions that change a long-lived contract or trade-off in NEAT live here as ADRs. Bug fixes, scoped refactors, and code-style choices do not.

## Where ADRs live

- **`docs/decisions.md`** is the canonical, single-file ledger. Every ADR through ADR-NNN is appended in order. Read it top-to-bottom and you have the full architectural history of the project.
- **`docs/adr/template.md`** is the format new ADRs follow.
- **`docs/adr/README.md`** (this file) is the process — when to write one, who ratifies, lifecycle states, supersession.

The single-file ledger is deliberate. Splitting into one-file-per-ADR is a future refactor we may do once `decisions.md` becomes too long to skim cleanly; today it's still the easiest shape to grep, link to anchors, and read in order. ADR-008's "commits and PRs read like a colleague wrote them" applies here — we want the ledger to read like a logbook, not a folder.

## When to write an ADR

Write one when **a future agent (human or otherwise) reading the code six months from now would benefit from knowing why we picked X and not Y, and the answer isn't obvious from the diff.**

Concrete triggers:

- A choice that changes a long-lived contract (snapshot schema, route shape, MCP tool surface, file layout, dep registry).
- A choice between two technologies, libraries, or approaches that both work — and a future contributor might re-litigate without context.
- A scoping call that defers something on purpose (e.g. ADR-004: `packages/web/` is a shell). Future readers need to know the deferral was intentional.
- A reframe of project goals or success criteria (ADR-027: MVP success isn't running the demo).
- A constraint that came from outside the codebase (license, business decision, partner agreement) and now shapes the code.

If you're about to write a comment longer than three lines explaining *why* something is the way it is, that's usually an ADR signal — write it down where the next agent will find it.

## When NOT to write an ADR

- Bug fixes. Commit messages are enough.
- Scoped refactors that don't change a long-lived contract.
- Code style, formatting, naming conventions inside a file.
- Anything already covered by an existing ADR — update the existing one or write a superseding ADR if the original is wrong now.
- Personal preference about which package to use when there's no real trade-off. Pick one, move on.

## Numbering

- Monotonic, zero-padded to three digits in references: `ADR-001`, `ADR-026`, `ADR-027`.
- Never reused. If an ADR is wrong, a later ADR supersedes it; the original stays in the ledger as historical record.
- The next free number is `(highest existing ADR + 1)`. Check `docs/decisions.md` before writing.

## Lifecycle

Every ADR has a `**Status:**` line. The states:

- **Active** — the decision is in force.
- **Superseded by ADR-NNN** — the decision was reversed or refined; ADR-NNN replaces it. Add this line at the top of the original ADR; keep the body intact for historical record.
- **Deprecated** — the decision is no longer relevant (the system it described was removed) but no replacement was needed. Rare.

State changes get committed via a small focused PR — don't bury them in unrelated work.

## Voice

Plain English. Same convention as commits and PRs (ADR-008). Lead with the *why*. Avoid release-notes-y bullet lists. Avoid emojis (memory has this, easy to forget under autopilot).

A good ADR captures:

1. **The context** — what's the actual question, what was previously assumed.
2. **The decision** — what we picked.
3. **Why this and not the alternatives** — the rejected paths matter as much as the chosen one. Future agents need to know we considered Y before they propose Y.
4. **What this is not deciding** — useful boundary marking when the problem space is broader than the call you're making.
5. **When to revisit** — the conditions under which this decision should be reopened.

Use `docs/adr/template.md` as the starting shape.

## Who ratifies

The user merging the PR that introduces the ADR ratifies it. Per ADR-005, branch-per-issue, manual close after verification — same shape applies to ADRs:

1. Author drafts the ADR on a branch (often the same branch as the code change it documents).
2. PR includes the ADR addition + the code change together.
3. User reviews. If the user pushes back on the decision, the ADR gets revised before merge.
4. Merge ratifies. The ADR is now `**Status:** Active`.

ADRs are not retroactive justification. They're the gate the decision passes through.

## Supersession

When a later decision overturns or refines an earlier one:

1. Write the new ADR in the standard shape, with `**Supersedes:** ADR-NNN` near the top.
2. Edit the original ADR's status line: `**Status:** Superseded by ADR-MMM (date)`.
3. Both stay in the ledger. The original's body is not deleted — that history is what makes the ledger useful.

## Where the existing ADRs live today

ADR-001 through ADR-026 (and onward) live in `docs/decisions.md`, in numerical order. The "Decisions already made" section at the top of `CLAUDE.md` keeps a one-line summary per ADR for quick reference; the full bodies live in `decisions.md`.

When you write a new ADR:

1. Append it to the bottom of `docs/decisions.md` (use `template.md` as the starting shape).
2. Add the one-line summary to the bullet list under "Decisions already made" in `CLAUDE.md`.
3. Reference the ADR number from any commit, PR description, or other ADR that depends on it.
