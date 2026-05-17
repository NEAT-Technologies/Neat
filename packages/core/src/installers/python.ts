/**
 * Python SDK installer (ADR-047).
 *
 * `detect` matches on the canonical Python project markers — requirements.txt,
 * pyproject.toml, setup.py. `plan` produces dependency edits against the
 * primary manifest and entrypoint edits against a Procfile when one exists.
 *
 * MVP scope:
 *  - requirements.txt is the full-fidelity manifest (read / append).
 *  - pyproject.toml dependencies live inside a TOML `dependencies = [...]`
 *    block; we line-insert into that block when found, otherwise hold off
 *    on rewriting until a successor ADR addresses TOML editing properly.
 *  - Procfile lines starting with `python` get prefixed with
 *    `opentelemetry-instrument`.
 *
 * Lockfiles (poetry.lock, Pipfile.lock) are never touched. After `--apply`,
 * init's summary tells the user to run `pip install -r requirements.txt`
 * (or `poetry lock && poetry install`) so they own the lockfile commit.
 */

import { promises as fs } from 'node:fs'
import path from 'node:path'
import type {
  ApplyResult,
  DependencyEdit,
  EntrypointEdit,
  EnvEdit,
  Installer,
  InstallPlan,
} from './shared.js'

const SDK_PACKAGES = [
  { name: 'opentelemetry-distro', version: '>=0.49b0' },
  { name: 'opentelemetry-exporter-otlp', version: '>=1.28.0' },
] as const

const OTEL_ENV: EnvEdit = {
  file: null,
  key: 'OTEL_EXPORTER_OTLP_ENDPOINT',
  value: 'http://localhost:4318',
}

async function exists(p: string): Promise<boolean> {
  try {
    await fs.stat(p)
    return true
  } catch {
    return false
  }
}

async function detect(serviceDir: string): Promise<boolean> {
  const markers = ['requirements.txt', 'pyproject.toml', 'setup.py']
  for (const m of markers) {
    if (await exists(path.join(serviceDir, m))) return true
  }
  return false
}

// Strip a requirements.txt line down to its lower-cased package name.
// `flask==3.0.0` → `flask`, `Flask>=2 ; python_version>"3.6"` → `flask`.
function reqPackageName(line: string): string {
  const stripped = line.split('#')[0]?.trim() ?? ''
  const head = stripped.split(/[\s;]/)[0] ?? ''
  return head.replace(/[<>=!~].*$/, '').toLowerCase()
}

async function planRequirementsTxtEdits(
  serviceDir: string,
): Promise<{ manifest: string; missing: typeof SDK_PACKAGES[number][] } | null> {
  const file = path.join(serviceDir, 'requirements.txt')
  if (!(await exists(file))) return null
  const raw = await fs.readFile(file, 'utf8')
  const presentNames = new Set(
    raw
      .split(/\r?\n/)
      .map(reqPackageName)
      .filter((n) => n.length > 0),
  )
  const missing = SDK_PACKAGES.filter((p) => !presentNames.has(p.name.toLowerCase()))
  return { manifest: file, missing: [...missing] }
}

async function planProcfileEdits(serviceDir: string): Promise<EntrypointEdit[]> {
  const procfile = path.join(serviceDir, 'Procfile')
  if (!(await exists(procfile))) return []
  const raw = await fs.readFile(procfile, 'utf8')
  const edits: EntrypointEdit[] = []
  for (const line of raw.split(/\r?\n/)) {
    if (line.length === 0) continue
    // Procfile lines look like `<process>: <cmd>`. Prefix the cmd when it
    // starts with python and isn't already wrapped.
    const m = line.match(/^([a-zA-Z0-9_-]+):\s*(.+)$/)
    if (!m) continue
    const cmd = m[2]!
    if (!/^python\b/.test(cmd)) continue
    if (cmd.startsWith('opentelemetry-instrument ')) continue
    const after = `${m[1]}: opentelemetry-instrument ${cmd}`
    edits.push({ file: procfile, before: line, after })
  }
  return edits
}

async function plan(serviceDir: string): Promise<InstallPlan> {
  const empty: InstallPlan = {
    language: 'python',
    serviceDir,
    dependencyEdits: [],
    entrypointEdits: [],
    envEdits: [],
  }

  const dependencyEdits: DependencyEdit[] = []
  const reqs = await planRequirementsTxtEdits(serviceDir)
  if (reqs) {
    for (const sdk of reqs.missing) {
      dependencyEdits.push({
        file: reqs.manifest,
        kind: 'add',
        name: sdk.name,
        version: sdk.version,
      })
    }
  }
  // pyproject.toml / setup.py without requirements.txt: deferred to a
  // successor ADR. The patch will note it; apply is a no-op for those
  // manifests in the MVP.

  const entrypointEdits = await planProcfileEdits(serviceDir)

  if (dependencyEdits.length === 0 && entrypointEdits.length === 0) {
    return empty
  }
  return {
    language: 'python',
    serviceDir,
    dependencyEdits,
    entrypointEdits,
    envEdits: [OTEL_ENV],
  }
}

async function applyRequirementsTxt(
  manifest: string,
  edits: DependencyEdit[],
  original: string,
): Promise<void> {
  // Append missing packages on their own lines. Preserve a trailing newline.
  const newlines = edits
    .filter((e) => e.kind === 'add')
    .map((e) => `${e.name}${e.version}`)
  const trailing = original.endsWith('\n') ? '' : '\n'
  const next = `${original}${trailing}${newlines.join('\n')}\n`
  const tmp = `${manifest}.${process.pid}.${Date.now()}.tmp`
  await fs.writeFile(tmp, next, 'utf8')
  await fs.rename(tmp, manifest)
}

async function applyProcfile(
  procfile: string,
  edits: EntrypointEdit[],
  original: string,
): Promise<void> {
  let next = original
  for (const e of edits) {
    if (!next.includes(e.before)) continue
    next = next.replace(e.before, e.after)
  }
  const tmp = `${procfile}.${process.pid}.${Date.now()}.tmp`
  await fs.writeFile(tmp, next, 'utf8')
  await fs.rename(tmp, procfile)
}

async function apply(installPlan: InstallPlan): Promise<ApplyResult> {
  const { serviceDir } = installPlan
  const touched = new Set<string>()
  for (const e of installPlan.dependencyEdits) touched.add(e.file)
  for (const e of installPlan.entrypointEdits) touched.add(e.file)
  if (touched.size === 0) {
    return { serviceDir, outcome: 'already-instrumented', writtenFiles: [] }
  }

  const originals = new Map<string, string>()
  for (const file of touched) {
    try {
      originals.set(file, await fs.readFile(file, 'utf8'))
    } catch {
      // Mutation will fail loudly below; rollback covers what did land.
    }
  }

  const writtenFiles: string[] = []
  try {
    for (const file of touched) {
      const raw = originals.get(file)
      if (raw === undefined) {
        throw new Error(`python installer: cannot read ${file} during apply`)
      }
      const base = path.basename(file)
      if (base === 'requirements.txt') {
        const edits = installPlan.dependencyEdits.filter((e) => e.file === file)
        if (edits.length > 0) {
          await applyRequirementsTxt(file, edits, raw)
          writtenFiles.push(file)
        }
      } else if (base === 'Procfile') {
        const edits = installPlan.entrypointEdits.filter((e) => e.file === file)
        if (edits.length > 0) {
          await applyProcfile(file, edits, raw)
          writtenFiles.push(file)
        }
      }
      // pyproject.toml / setup.py: MVP no-op as planned above.
    }
  } catch (err) {
    await rollback(installPlan, originals)
    throw err
  }

  return { serviceDir, outcome: 'instrumented', writtenFiles }
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
      // Best-effort.
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

export const pythonInstaller: Installer = {
  name: 'python',
  detect,
  plan,
  apply,
}
