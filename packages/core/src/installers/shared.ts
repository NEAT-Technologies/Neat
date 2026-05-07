/**
 * Shared types for SDK installer modules (ADR-047).
 *
 * Each language has its own installer at `installers/<language>.ts` exporting
 * a `detect / plan / apply` triple. Plans are pure data — no fs side effects
 * during planning — so `init --dry-run` can render a patch without ever
 * touching the project. `apply` runs the codemod in place.
 *
 * Step 2 (this PR) ships the interface and an empty registry. Step 3 (Node
 * installer) and step 4 (Python installer) populate it.
 */

// Field names match ADR-047's documented patch shape exactly: `file`, `kind`,
// `name`, `version`. Patches will be reviewed by humans and matched in tests
// by name; renaming for clarity would have cost more than it bought.

export interface DependencyEdit {
  file: string
  kind: 'add' | 'remove'
  name: string
  version: string
}

export interface EntrypointEdit {
  file: string
  before: string
  after: string
}

export interface EnvEdit {
  // `null` denotes a recommendation only — the user will set the env var in
  // their orchestration layer, NEAT does not write a `.env` file.
  file: string | null
  key: string
  value: string
}

export interface InstallPlan {
  // Free-form language tag matching the service node's language: `'javascript'`,
  // `'python'`, …
  language: string
  // Service directory the plan targets. Absolute path.
  serviceDir: string
  dependencyEdits: DependencyEdit[]
  entrypointEdits: EntrypointEdit[]
  envEdits: EnvEdit[]
}

export interface Installer {
  // Free-form module name. Used for the patch header and for diagnostics.
  name: string
  // Returns true if the installer thinks `serviceDir` is shaped like a project
  // it can instrument. Cheap; no fs writes.
  detect(serviceDir: string): boolean | Promise<boolean>
  // Builds an `InstallPlan` describing the edits the installer would make.
  // Pure data; no fs writes. An empty plan (every edits array empty) means
  // the SDK is already installed and there is nothing to do.
  plan(serviceDir: string): InstallPlan | Promise<InstallPlan>
  // Apply a previously-produced plan. Mutates files in place. On failure,
  // produces `<serviceDir>/neat-rollback.patch` per ADR-047 #7.
  apply(plan: InstallPlan): Promise<void>
}

export function isEmptyPlan(plan: InstallPlan): boolean {
  return (
    plan.dependencyEdits.length === 0 &&
    plan.entrypointEdits.length === 0 &&
    plan.envEdits.length === 0
  )
}
