# NEAT neat-init Audit — MVP (TypeScript v0.3.1)
## Prospective ADR. Load this before writing a single line of neat init.

**Scope:** Prospective audit — issue #119 has no implementation yet. Output is design decisions the implementer will face, the recommended position on each, and alternatives rejected with reasons. Do not write code until section 1 is read in full and every missing-decision finding in section 2 is resolved.

**Frame:** The NEAT manifesto promises "live" and "ambient." Every decision is tested against those two words. Where a design choice makes NEAT less live or less ambient, that is a finding.

**What this audit does not do:**
- Propose features not in issue #119
- Audit the manifesto itself
- Litigate Rust vs TypeScript — prototype scope, ship fast
- Design the zero-touch instrumentation strategy (P-001) — treat it as a callable, not a design point
- Over-engineer for Rust v1.0 forward compatibility

---

## Section 1 — Design Decisions

### Decision 1: Where on the ambient ladder does v0.3.1 sit?

The ambient ladder:
- **(a)** Per-codebase — user types `neat init` every time
- **(b)** One-shot per machine — user runs `neat init` once, NEAT auto-discovers after that
- **(c)** Daemon mode — no init ever, NEAT is always present

**Recommended: (a) for v0.3.1, but designed for (b).**

`neat init .` is the right MVP default. Explicit, auditable, recoverable. User knows exactly which codebases NEAT knows about.

Critical constraint: the design must not require a rewrite to reach (b). This means project registration must write to a machine-level registry (`~/.neat/projects.json`) not only to a local config in the project directory. Auto-discovery in (b) is then a daemon that walks a configured root and calls the same registration function that `neat init` calls. The registration function must be pure and callable from either CLI or daemon.

**Rejected: starting at (b).** Auto-discovery requires validated heuristics for what constitutes a recognisable project. False positives on first run will damage trust. User should opt in per-project until heuristics are proven.

**Rejected: starting at (c).** Daemon mode requires launchd/systemd integration, auto-instrumentation, and push-based graph deltas. All v1.0.

---

### Decision 2: Should `neat init` and `neat install` be the same command?

`neat init` does two things: bootstraps a codebase for NEAT, and registers a Claude Code skill. These are different in scope, failure mode, and lifecycle.

| | neat init | neat install |
|---|---|---|
| Scope | Codebase-level | Machine-level |
| Failure mode | Breaks one repo | Breaks all Claude sessions |
| Lifecycle | Runs once per project | Runs once per machine |
| Reversibility | `rm .neat/` | Claude Code skill uninstall |

**Recommended: separate commands.**

`neat init .` — bootstraps the codebase. Writes `.neat/config.json`, registers the project in `~/.neat/projects.json`, optionally instruments services.

`neat install` — registers the Claude Code skill machine-wide. Can be run independently of any project. Idempotent.

**Rejected: one command.** The failure blast radius is different. Conflating them means a broken codebase init can corrupt the Claude Code skill registration. They should fail and recover independently.

---

### Decision 3: What is the trust ladder for the codemod?

`neat init --apply` mutates user code to add OTel instrumentation. Ranked by reversibility:

- **(a)** Read-only — prints a plan, never touches code
- **(b)** Emits a `.patch` file the user applies manually with `git apply`
- **(c)** `--apply` writes files, produces `NEAT_INSTRUMENT.md` documenting what changed
- **(d)** Auto-applies on detection, no flag needed

**Recommended: (b) as default, (c) as opt-in.**

The default `neat init .` emits `neat.patch` to the project root. The user reviews it, runs `git apply neat.patch`, and owns the change. NEAT never writes to the user's files without an explicit flag.

`neat init . --apply` writes directly and produces `NEAT_INSTRUMENT.md`. For users who trust the output and want the faster path.

For the PR goal specifically — NEAT submitting PRs to open source repos — the patch file is the only acceptable default. Maintainers will scrutinise any automated code change. The patch must be reviewable as a clean git diff before submission.

**Rejected: (a) read-only only.** The PR goal requires actual code changes. Read-only is useful for auditing but not for the PR workflow.

**Rejected: (d) auto-apply.** Never writes to user files without explicit consent. Non-negotiable.

---

### Decision 4: What does `neat init` discover and how?

The discovery step walks the project directory and identifies:
- Services — directories with `package.json`, `pyproject.toml`, `Cargo.toml`, `go.mod`, `requirements.txt`
- Databases — `docker-compose.yml` services using known database images, `.env` DATABASE_URL patterns, ORM config files
- Infrastructure — `docker-compose.yml`, `*.tf` Terraform files, k8s manifests
- Config — `.env`, `*.yaml` relevant to services

**Recommended discovery strategy:**

Walk from the provided path. Respect a configurable depth limit (default: 4). Honour `.neatignore` (same syntax as `.gitignore`). Stop recursing into `node_modules`, `.git`, `dist`, `build`, `.next`, `__pycache__`, `vendor`.

Produce a discovery report before any instrumentation. The user must see what NEAT found before anything is changed.

**Verify in implementation:**
- Is there a depth limit on directory walking?
- Is `.neatignore` supported?
- Are `node_modules` and build directories excluded?
- Does a discovery report print before any file mutation?

---

### Decision 5: What does `neat init` do with monorepos vs polyrepos?

**Recommended: monorepo-aware, polyrepo-agnostic.**

If the init path contains a root `package.json` with a `workspaces` field, or a `pnpm-workspace.yaml`, or a `turbo.json`, treat it as a monorepo. Register each workspace as a separate ServiceNode with the monorepo root as an InfraNode that owns them.

If the init path is a single-service repo, register one ServiceNode.

If the init path is a directory containing multiple unrelated repos (rare but possible), register each sub-repo that has a manifest as a separate project in `~/.neat/projects.json`.

**Polyrepo** — running `neat init` in each repo independently is correct. There is no automatic cross-repo linking at init time. Cross-repo graph connections come from OTel observed traffic, not from init heuristics.

**Missing decision: does `neat init` at a monorepo root instrument all workspaces or only the root?** This must be decided before implementation. Recommended: instrument all workspaces, prompt the user to confirm which ones.

---

### Decision 6: What does `neat init` emit?

**Files written to the project:**
- `.neat/config.json` — project config: name, scan paths, OTel collector endpoint, instrumentation strategy
- `neat.patch` — the instrumentation patch (if default mode)
- `NEAT_INSTRUMENT.md` — documentation of what was instrumented (if `--apply`)
- `.neatignore` — if not present, create with sensible defaults

**Files written to the machine:**
- `~/.neat/projects.json` — machine-level project registry, appended with this project

**Files that must not be modified:**
- `package.json` — no dependencies added without explicit user confirmation
- `package-lock.json` or `pnpm-lock.yaml` — never touched
- Any file outside the init path
- Any file matched by `.gitignore`

**Verify in implementation:**
- Is there an explicit list of files that `neat init` will never touch?
- Is `package.json` modification gated behind explicit confirmation?
- Are lockfiles excluded unconditionally?

---

### Decision 7: Docker, WSL, and dev containers

**Recommended positions:**

Docker — `neat init` works on the source tree on the host. It does not need to run inside Docker. OTel instrumentation targets the Node.js/Python process inside the container, but the codemod runs on the host files. The patch applies to the source, which is then mounted into the container.

WSL — `neat init` runs natively inside WSL. The `~/.neat/` registry lives in the WSL home directory. No special handling needed if the user runs everything in WSL.

Dev containers — known gap. If the user's editor and terminal are inside a dev container, `neat init` must run inside the container too. The machine-level `~/.neat/` registry will be container-scoped, not machine-scoped. This is a missing decision — decide before implementation.

**Recommended for dev containers:** document as unsupported in v0.3.1. Add to backlog. Do not attempt to solve it in the MVP.

---

## Section 2 — Findings

**[missing-decision] The success paragraph does not exist in issue #119.**
Severity: gap

Issue #119 describes what `neat init` does mechanically but not what success looks like end-to-end from the user's point of view. Without it, every other decision floats. Write the success paragraph before implementation starts. See Section 3 of this audit for a draft.

---

**[missing-decision] Monorepo instrumentation scope is undefined.**
Severity: gap

Decision 5 identifies this. When `neat init` runs at a monorepo root, it is not defined whether it instruments all workspaces, prompts for selection, or only instruments the root. This will be resolved by the implementer at 2am in whatever direction makes the first test pass. Resolve it now.

Recommended: prompt the user with a checklist of discovered workspaces and instrument the selected ones.

---

**[missing-decision] Dev container behaviour is undefined.**
Severity: gap

Decision 7 identifies this. Do not leave it to the implementer. Recommended resolution: document as unsupported in v0.3.1, add to backlog.

---

**[missing-decision] Lockfile behaviour is undefined.**
Severity: gap

Decision 6 recommends lockfiles are never touched. This must be made explicit in the implementation, not assumed. If the instrumentation codemod adds a dependency, it must add it to `package.json` only and instruct the user to run `pnpm install` manually. The lockfile change is the user's responsibility.

---

**[framing] `neat init` is at rung (a) of the ambient ladder but nothing prevents it from being rewritten for (b).**
Severity: framing

The design must write to `~/.neat/projects.json` on every init. If it only writes to `.neat/config.json` locally, reaching rung (b) requires rewriting the registration logic. Verify the implementation writes to the machine-level registry from day one.

---

**[gap] `neat init` and `neat install` are the same command in issue #119.**
Severity: gap

Decision 2 identifies this as wrong. The blast radius of the two operations is different. They must be separate commands. This is a design change from issue #119 that must be confirmed before implementation starts.

---

**[gap] The default codemod mode in issue #119 is `--apply` not patch file.**
Severity: gap

Decision 3 recommends the patch file as the safer MVP default. Issue #119 has `--apply` as the default. This matters for the PR goal — any PR NEAT submits to an open source repo will be reviewed by maintainers who will scrutinise automated code changes. The patch file gives the human the final apply step. Confirm the default before implementation starts.

---

**[scope-creep] Running processes, CI registration, hosted core, and closed-source binaries are not in scope.**
Severity: scope-creep guard

Explicit non-goals for v0.3.1. The implementation must not attempt any of these:
- Instrumenting running processes (that is P-001 / v1.0)
- Registering with CI pipelines
- Setting up a remote or hosted neat-core
- Analysing closed-source binaries

If the agent proposes any of these during implementation, reject it.

---

**[bug risk] Discovery without a depth limit will walk the entire filesystem on `/`.**
Severity: bug

Decision 4 specifies a depth limit of 4. Without it, `neat init /` or `neat init ~/` will walk indefinitely. The depth limit must be implemented and tested against a deeply nested fixture.

---

**[framing] The ambient and live stress test.**
Severity: framing

The manifesto promises ambient and live. `neat init` at rung (a) is neither ambient nor live — it is explicit and one-shot. This is acceptable for v0.3.1 only if:

- The registration function is designed to be called by a daemon (rung b/c) without modification
- The graph begins updating live immediately after init completes — not after the user manually starts neat-core
- The Claude Code skill is available immediately after `neat install` without requiring a session restart

If any of these three are false, `neat init` makes NEAT less ambient and less live than the manifesto claims. Flag each one as a verification point in the implementation.

---

## Section 3 — The Success Paragraph

Cem clones a FastAPI repository on a clean machine. He runs `curl https://neat.is/install | sh` which installs neat-core as a background daemon and the neat CLI. He runs `neat init .` in the cloned directory. NEAT walks the repo, finds the FastAPI service and its SQLAlchemy database connection, prints a discovery report, and emits `neat.patch`. Cem reviews the patch — it adds three lines of OTel instrumentation to the FastAPI startup — runs `git apply neat.patch` and starts the service. He runs `neat install` once to register the Claude Code skill. He opens Claude Code, types "why is this endpoint slow," and receives an answer that names a specific database query pattern visible in the OBSERVED edges — something the static analysis alone would not have found because it only manifests under real traffic. The answer includes the traversal path, the confidence score, and a suggested fix. Cem opens a PR.

This paragraph is the gravity for every other decision in this audit. If a design choice does not serve this paragraph, it does not belong in v0.3.1.

---

## Verification checklist — answer before closing implementation

1. Does `neat init` write to `~/.neat/projects.json` in addition to `.neat/config.json`?
2. Are `neat init` and `neat install` separate commands with separate failure modes?
3. Is the default codemod output a patch file, not a direct file write?
4. Is there a depth limit on directory discovery?
5. Are lockfiles unconditionally excluded from modification?
6. Is monorepo workspace instrumentation scope defined and prompted to the user?
7. Does the graph begin updating live immediately after init — not after a manual neat-core start?
8. Is dev container behaviour explicitly documented as unsupported in v0.3.1?
9. Is `--apply` an explicit opt-in flag, not the default?
10. Can the registration function be called by a future daemon without modification?

---

*v0.3.1 prototype only. Daemon mode, auto-discovery, push-based graph deltas, launchd/systemd integration, and P-001 zero-touch instrumentation are v1.0.*
