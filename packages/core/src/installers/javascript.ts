/**
 * Node / TypeScript SDK installer (ADR-047).
 *
 * Detects services by the presence of a `package.json` carrying a `name`
 * field — same shape `extract/services.ts` uses to decide what counts as a
 * Node service. The plan adds three OTel packages to `dependencies` and, if
 * a `scripts.start` exists, prefixes it with the auto-instrumentation hook.
 *
 * Lockfiles are never touched. After `--apply`, init prints "run npm install"
 * so the user owns the lockfile commit (ADR-047 — "Lockfiles never touched").
 */

import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { DependencyEdit, EntrypointEdit, EnvEdit, Installer, InstallPlan } from './shared.js'

const SDK_PACKAGES = [
  { name: '@opentelemetry/api', version: '^1.9.0' },
  { name: '@opentelemetry/sdk-node', version: '^0.57.0' },
  { name: '@opentelemetry/auto-instrumentations-node', version: '^0.55.0' },
] as const

const AUTO_INSTRUMENT_REQUIRE = '--require @opentelemetry/auto-instrumentations-node/register'

const OTEL_ENV: EnvEdit = {
  // null target — NEAT does not write `.env` itself; the user sets the env
  // var in their orchestration layer.
  file: null,
  key: 'OTEL_EXPORTER_OTLP_ENDPOINT',
  value: 'http://localhost:4318',
}

interface PackageJsonShape {
  name?: string
  scripts?: Record<string, string>
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
}

async function readPackageJson(serviceDir: string): Promise<PackageJsonShape | null> {
  try {
    const raw = await fs.readFile(path.join(serviceDir, 'package.json'), 'utf8')
    return JSON.parse(raw) as PackageJsonShape
  } catch {
    return null
  }
}

async function detect(serviceDir: string): Promise<boolean> {
  const pkg = await readPackageJson(serviceDir)
  return pkg !== null && typeof pkg.name === 'string'
}

function rewriteStartScript(start: string): string {
  // Already wired via auto-instrumentation? Don't touch — idempotency
  // (ADR-047 — "Re-running init --apply produces no diff").
  if (start.includes(AUTO_INSTRUMENT_REQUIRE)) return start
  // Most start scripts begin with `node …`. Keep the rest of the command and
  // splice the require flag in. Non-`node` starts (e.g. `next start`,
  // `tsx server.ts`) get the require flag prefixed via `node` since the
  // OTel hook needs a Node entry to attach to.
  if (/^\s*node\b/.test(start)) {
    return start.replace(/^\s*node\b\s*/, `node ${AUTO_INSTRUMENT_REQUIRE} `)
  }
  return `node ${AUTO_INSTRUMENT_REQUIRE} -- ${start}`
}

async function plan(serviceDir: string): Promise<InstallPlan> {
  const pkg = await readPackageJson(serviceDir)
  const manifestPath = path.join(serviceDir, 'package.json')
  const empty: InstallPlan = {
    language: 'javascript',
    serviceDir,
    dependencyEdits: [],
    entrypointEdits: [],
    envEdits: [],
  }
  if (!pkg) return empty

  const existingDeps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) }
  const dependencyEdits: DependencyEdit[] = []
  for (const sdk of SDK_PACKAGES) {
    if (sdk.name in existingDeps) continue
    dependencyEdits.push({
      file: manifestPath,
      kind: 'add',
      name: sdk.name,
      version: sdk.version,
    })
  }
  // SDK_PACKAGES is already in stable declaration order, so the slice above
  // is deterministic across runs (ADR-047 #6).

  const entrypointEdits: EntrypointEdit[] = []
  const startScript = pkg.scripts?.start
  if (typeof startScript === 'string' && startScript.trim().length > 0) {
    const rewritten = rewriteStartScript(startScript)
    if (rewritten !== startScript) {
      entrypointEdits.push({ file: manifestPath, before: startScript, after: rewritten })
    }
  }

  // Empty plan when nothing needs to change anywhere — that is, every SDK
  // dep is present and the start script already wires the hook (or there's
  // no start script to wire). Surfaces ADR-047 #5: "plan(dir) returns an
  // empty plan when SDK is already installed."
  if (dependencyEdits.length === 0 && entrypointEdits.length === 0) {
    return empty
  }

  return {
    language: 'javascript',
    serviceDir,
    dependencyEdits,
    entrypointEdits,
    envEdits: [OTEL_ENV],
  }
}

async function apply(installPlan: InstallPlan): Promise<void> {
  const touched = new Set<string>()
  for (const e of installPlan.dependencyEdits) touched.add(e.file)
  for (const e of installPlan.entrypointEdits) touched.add(e.file)
  if (touched.size === 0) return

  // Snapshot every file we're about to mutate so a partial failure can roll
  // back the whole batch (ADR-047 #7). Missing files are intentionally not
  // an early-exit: the per-file mutation loop will hit them, fail, and
  // trigger rollback for the files we already wrote.
  const originals = new Map<string, string>()
  for (const file of touched) {
    try {
      originals.set(file, await fs.readFile(file, 'utf8'))
    } catch {
      // No snapshot for this file. Mutation will fail loudly below.
    }
  }

  try {
    for (const file of touched) {
      const raw = originals.get(file) ?? ''
      const pkg = JSON.parse(raw) as PackageJsonShape
      pkg.dependencies = pkg.dependencies ?? {}

      for (const dep of installPlan.dependencyEdits) {
        if (dep.file !== file) continue
        if (dep.kind === 'add') {
          pkg.dependencies[dep.name] = dep.version
        } else {
          delete pkg.dependencies[dep.name]
        }
      }

      for (const ep of installPlan.entrypointEdits) {
        if (ep.file !== file) continue
        pkg.scripts = pkg.scripts ?? {}
        if (pkg.scripts.start === ep.before) {
          pkg.scripts.start = ep.after
        }
      }

      // Match the most common npm formatting (two-space indent, trailing
      // newline) so the diff stays minimal on review.
      const newRaw = JSON.stringify(pkg, null, 2) + '\n'
      const tmp = `${file}.${process.pid}.${Date.now()}.tmp`
      await fs.writeFile(tmp, newRaw, 'utf8')
      await fs.rename(tmp, file)
    }
  } catch (err) {
    await rollback(installPlan, originals)
    throw err
  }
}

async function rollback(
  installPlan: InstallPlan,
  originals: Map<string, string>,
): Promise<void> {
  const restored: string[] = []
  for (const [file, raw] of originals.entries()) {
    try {
      await fs.writeFile(file, raw, 'utf8')
      restored.push(file)
    } catch {
      // Best-effort: keep going so we restore as much as we can.
    }
  }
  const lines = [
    '# neat-rollback.patch',
    '',
    `# Generated after a partial apply failure in the ${installPlan.language} installer.`,
    '# Files listed below were restored to their pre-apply contents.',
    '',
    ...restored.map((f) => `restored: ${f}`),
    '',
  ]
  const rollbackPath = path.join(installPlan.serviceDir, 'neat-rollback.patch')
  await fs.writeFile(rollbackPath, lines.join('\n'), 'utf8')
}

export const javascriptInstaller: Installer = {
  name: 'javascript',
  detect,
  plan,
  apply,
}
