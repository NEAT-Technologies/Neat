import { promises as fs } from 'node:fs'
import path from 'node:path'
import { parse as parseToml } from 'smol-toml'
import { exists, type PackageJson } from './shared.js'

// Lines like `psycopg2==2.7.0`, `psycopg2 == 2.7.0`, `psycopg2[extras]==2.7`,
// or `psycopg2~=2.7,<3`. We capture the package name and the first version
// that follows an `==` operator. Anything else (range, no pin, no version) is
// recorded with an empty version — the compat matrix's semver coercer treats
// those as "can't reason" and under-flags rather than over-flags.
const REQUIREMENT_LINE = /^\s*([A-Za-z0-9_.-]+)(?:\[[^\]]*\])?\s*(?:(==)\s*([A-Za-z0-9_.+-]+))?/

function parseRequirementsTxt(content: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const rawLine of content.split('\n')) {
    const line = rawLine.split('#')[0]?.trim()
    if (!line) continue
    if (line.startsWith('-')) continue // -r requirements-dev.txt etc.
    const match = REQUIREMENT_LINE.exec(line)
    if (!match) continue
    const name = match[1]!.toLowerCase()
    const version = match[3] ?? ''
    out[name] = version
  }
  return out
}

interface PyProjectFile {
  project?: {
    name?: string
    version?: string
    dependencies?: string[]
  }
  tool?: {
    poetry?: {
      name?: string
      version?: string
      dependencies?: Record<string, string | { version?: string }>
    }
  }
}

function depsFromPyProject(pyproject: PyProjectFile): Record<string, string> {
  const out: Record<string, string> = {}

  // PEP 621 — [project] dependencies = ["psycopg2==2.7.0", "requests"]
  for (const entry of pyproject.project?.dependencies ?? []) {
    const match = REQUIREMENT_LINE.exec(entry)
    if (!match) continue
    out[match[1]!.toLowerCase()] = match[3] ?? ''
  }

  // Poetry — [tool.poetry.dependencies] psycopg2 = "2.7.0"
  const poetryDeps = pyproject.tool?.poetry?.dependencies ?? {}
  for (const [name, value] of Object.entries(poetryDeps)) {
    if (name.toLowerCase() === 'python') continue
    const raw = typeof value === 'string' ? value : (value?.version ?? '')
    out[name.toLowerCase()] = raw.replace(/^[\^~><=v\s]+/, '')
  }
  return out
}

export interface PythonService {
  name: string
  version?: string
  dependencies: Record<string, string>
}

// Detect a Python service by the conventional manifest files. We try
// pyproject.toml first because it can name the package; fallback to the
// directory name when only requirements.txt or setup.py is present.
export async function discoverPythonService(serviceDir: string): Promise<PythonService | null> {
  const pyprojectPath = path.join(serviceDir, 'pyproject.toml')
  const requirementsPath = path.join(serviceDir, 'requirements.txt')
  const setupPath = path.join(serviceDir, 'setup.py')

  const hasPyproject = await exists(pyprojectPath)
  const hasRequirements = await exists(requirementsPath)
  const hasSetup = await exists(setupPath)
  if (!hasPyproject && !hasRequirements && !hasSetup) return null

  let name = path.basename(serviceDir)
  let version: string | undefined
  const dependencies: Record<string, string> = {}

  if (hasPyproject) {
    const raw = await fs.readFile(pyprojectPath, 'utf8')
    const pyproject = parseToml(raw) as PyProjectFile
    name = pyproject.project?.name ?? pyproject.tool?.poetry?.name ?? name
    version = pyproject.project?.version ?? pyproject.tool?.poetry?.version ?? undefined
    Object.assign(dependencies, depsFromPyProject(pyproject))
  }

  if (hasRequirements) {
    const raw = await fs.readFile(requirementsPath, 'utf8')
    Object.assign(dependencies, parseRequirementsTxt(raw))
  }

  return { name, version, dependencies }
}

// Build the same `pkg`-shaped shim the JS path uses so downstream phases
// (databases, calls, etc.) can keep reading service.pkg.dependencies and
// service.pkg.name without caring which language produced the service.
export function pythonToPackage(service: PythonService): PackageJson {
  return {
    name: service.name,
    version: service.version,
    dependencies: service.dependencies,
  }
}
