/**
 * Installer registry. v0.2.5 step 2 ships the scaffolding; the JavaScript
 * installer (step 3) and Python installer (step 4) populate `INSTALLERS`.
 */

import type { Installer, InstallPlan } from './shared.js'
export { isEmptyPlan } from './shared.js'
export type {
  DependencyEdit,
  EntrypointEdit,
  EnvEdit,
  Installer,
  InstallPlan,
} from './shared.js'

// Lockfile basenames installers must never write to (ADR-047 — "lockfiles
// never touched"). Used by the patch renderer's safety check below.
export const FORBIDDEN_LOCKFILES: ReadonlySet<string> = new Set([
  'package-lock.json',
  'pnpm-lock.yaml',
  'yarn.lock',
  'poetry.lock',
  'Pipfile.lock',
  'Gemfile.lock',
  'Cargo.lock',
  'go.sum',
])

export const INSTALLERS: Installer[] = []

/**
 * Resolve the first installer that claims a given service directory. Returns
 * `null` if none match.
 *
 * Per language, the first matching installer wins. Order in `INSTALLERS`
 * defines that priority — declarations are explicit, not alphabetical.
 */
export async function pickInstaller(serviceDir: string): Promise<Installer | null> {
  for (const inst of INSTALLERS) {
    if (await inst.detect(serviceDir)) return inst
  }
  return null
}

export interface PatchSection {
  installer: string
  plan: InstallPlan
}

/**
 * Render install plans into a single review-friendly text patch. The format
 * is intentionally human-shaped, not unified-diff: agents and humans both
 * read this. Determinism — same input, byte-identical output — is the
 * load-bearing property (ADR-047 #6).
 */
export function renderPatch(sections: PatchSection[]): string {
  if (sections.length === 0) {
    return [
      '# neat install plan',
      '',
      'No SDK installers matched the discovered services. Two reasons this',
      'normally happens:',
      '  - the project uses a language NEAT does not yet instrument',
      '    (Java / Ruby / .NET / Go / Rust are out of MVP scope per ADR-047);',
      '  - the SDK is already installed, so the installer returned an empty',
      '    plan.',
      '',
      'You can re-run `neat init --apply` later to pick up new services.',
      '',
    ].join('\n')
  }

  const lines: string[] = ['# neat install plan', '']
  for (const section of sections) {
    const { installer, plan } = section
    lines.push(`## ${installer} (${plan.language}) — ${plan.serviceDir}`)
    lines.push('')

    if (plan.dependencyEdits.length > 0) {
      lines.push('### dependencies')
      for (const dep of plan.dependencyEdits) {
        // Hard-fail rather than render a patch that could mislead the user
        // into thinking NEAT touches lockfiles.
        const base = dep.file.split(/[\\/]/).pop() ?? dep.file
        if (FORBIDDEN_LOCKFILES.has(base)) {
          throw new Error(
            `installer "${installer}" produced a dependency edit against a lockfile (${dep.file}); ` +
              `lockfiles must never be touched (ADR-047).`,
          )
        }
        lines.push(`- ${dep.kind} ${dep.name}@${dep.version} in ${dep.file}`)
      }
      lines.push('')
    }

    if (plan.entrypointEdits.length > 0) {
      lines.push('### entrypoint')
      for (const e of plan.entrypointEdits) {
        lines.push(`- ${e.file}`)
        lines.push(`    - before: ${e.before}`)
        lines.push(`    - after:  ${e.after}`)
      }
      lines.push('')
    }

    if (plan.envEdits.length > 0) {
      lines.push('### env')
      for (const env of plan.envEdits) {
        const target = env.file ?? '(set in your orchestration layer)'
        lines.push(`- ${env.key}=${env.value} → ${target}`)
      }
      lines.push('')
    }
  }
  return lines.join('\n')
}
