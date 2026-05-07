#!/usr/bin/env node

import path from 'node:path'
import { promises as fs } from 'node:fs'
import type { GraphEdge, GraphNode, ServiceNode } from '@neat/types'
import { DEFAULT_PROJECT, getGraph, resetGraph } from './graph.js'
import { extractFromDirectory } from './extract.js'
import { discoverServices } from './extract/services.js'
import type { DiscoveredService } from './extract/shared.js'
import { saveGraphToDisk } from './persist.js'
import { startWatch, type WatchHandle } from './watch.js'
import { pathsForProject } from './projects.js'
import {
  addProject,
  listProjects,
  ProjectNameCollisionError,
  removeProject,
  setStatus,
} from './registry.js'
import {
  INSTALLERS,
  isEmptyPlan,
  pickInstaller,
  renderPatch,
  type InstallPlan,
  type PatchSection,
} from './installers/index.js'

export interface InitOptions {
  scanPath: string
  outPath: string
  // The project's registry name. Defaults to the basename of the scan path
  // when the user didn't pass `--project` (ADR-046 — project naming).
  project: string
  // Whether `project` was set explicitly via `--project`. The flag affects
  // which in-memory graph slot we use: explicit names get isolated slots
  // per ADR-026, the default basename keeps using DEFAULT_PROJECT for
  // back-compat with `neat watch`.
  projectExplicit: boolean
  apply: boolean
  dryRun: boolean
  noInstall: boolean
}

export interface InitResult {
  // Process exit code. 0 on success, 1 on collision / runtime failure,
  // 2 on misuse (handled before we get here, but documented for completeness).
  exitCode: number
  // Paths the run actually wrote to. Empty in `--dry-run` except for
  // `neat.patch`. Useful for tests asserting "init only wrote X".
  writtenFiles: string[]
}

function usage(): void {
  console.log('usage: neat <command> [args] [--project <name>]')
  console.log('')
  console.log('commands:')
  console.log('  init <path>    One-time install: discover, extract, register, plan SDK install.')
  console.log('                 Snapshot lands in <path>/neat-out/graph.json by default')
  console.log('                 (or <path>/neat-out/<project>.json for non-default).')
  console.log('                 Flags:')
  console.log('                   --apply       run the SDK install patch in place')
  console.log('                   --dry-run     write only neat.patch; do not register or snapshot')
  console.log('                   --no-install  skip SDK install planning entirely')
  console.log('  watch <path>   Start neat-core, watch <path>, re-extract on changes.')
  console.log('                 PORT (default 8080), OTEL_PORT (4318), HOST (0.0.0.0)')
  console.log('                 control listeners. NEAT_OTLP_GRPC=true also opens 4317.')
  console.log('  list           List every project registered in the machine-level registry.')
  console.log('  pause <name>   Mark a project paused — daemon stops watching until resumed.')
  console.log('  resume <name>  Mark a project active again.')
  console.log('  uninstall <name>')
  console.log('                 Remove a project from the registry. Does not touch')
  console.log('                 neat-out/, policy.json, or any user file.')
  console.log('  skill          Install or print the Claude Code MCP drop-in.')
  console.log('                 Flags:')
  console.log('                   --print-config   print the JSON snippet to stdout')
  console.log('                   --apply          merge mcpServers.neat into ~/.claude.json')
  console.log('')
  console.log('flags:')
  console.log('  --project <name>   Name the project this command targets. Default: "default".')
}

// Tiny argv parser — pulls `--project <name>` and the v0.2.5 init flags
// (`--apply`, `--dry-run`, `--no-install`) out of `rest`. Boolean flags are
// only meaningful for `init`; the parser surfaces them unconditionally so
// `main` can validate per-command.
interface ParsedArgs {
  project: string | null
  apply: boolean
  dryRun: boolean
  noInstall: boolean
  printConfig: boolean
  positional: string[]
}

function parseArgs(rest: string[]): ParsedArgs {
  const positional: string[] = []
  let project: string | null = null
  let apply = false
  let dryRun = false
  let noInstall = false
  let printConfig = false
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i] as string
    if (arg === '--project') {
      const next = rest[i + 1]
      if (!next) {
        console.error('neat: --project requires a value')
        process.exit(2)
      }
      project = next
      i++
      continue
    }
    if (arg.startsWith('--project=')) {
      project = arg.slice('--project='.length)
      continue
    }
    if (arg === '--apply') {
      apply = true
      continue
    }
    if (arg === '--dry-run') {
      dryRun = true
      continue
    }
    if (arg === '--no-install') {
      noInstall = true
      continue
    }
    if (arg === '--print-config') {
      printConfig = true
      continue
    }
    positional.push(arg)
  }
  return { project, apply, dryRun, noInstall, printConfig, positional }
}

function summarise(nodes: GraphNode[], edges: GraphEdge[]): string {
  const byNode = new Map<string, number>()
  for (const n of nodes) byNode.set(n.type, (byNode.get(n.type) ?? 0) + 1)
  const byEdge = new Map<string, number>()
  for (const e of edges) byEdge.set(e.type, (byEdge.get(e.type) ?? 0) + 1)

  const nodeLines = [...byNode.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([t, c]) => `    ${t}: ${c}`)
  const edgeLines = [...byEdge.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([t, c]) => `    ${t}: ${c}`)

  return ['nodes:', ...nodeLines, 'edges:', ...edgeLines].join('\n')
}

function formatIncompat(inc: NonNullable<ServiceNode['incompatibilities']>[number]): string {
  if (inc.kind === 'node-engine') {
    const range = inc.declaredNodeEngine ? ` (engines.node="${inc.declaredNodeEngine}")` : ''
    return `${inc.package}@${inc.packageVersion ?? '?'} requires Node ${inc.requiredNodeVersion}${range} — ${inc.reason}`
  }
  if (inc.kind === 'package-conflict') {
    const found = inc.foundVersion ? `@${inc.foundVersion}` : ' (missing)'
    return `${inc.package}@${inc.packageVersion ?? '?'} requires ${inc.requires.name}>=${inc.requires.minVersion}; found ${inc.requires.name}${found} — ${inc.reason}`
  }
  if (inc.kind === 'deprecated-api') {
    return `${inc.package}@${inc.packageVersion ?? '?'} is deprecated — ${inc.reason}`
  }
  return `${inc.driver}@${inc.driverVersion} vs ${inc.engine} ${inc.engineVersion} — ${inc.reason}`
}

function findIncompatibilities(nodes: GraphNode[]): ServiceNode[] {
  return nodes.filter(
    (n): n is ServiceNode =>
      n.type === 'ServiceNode' &&
      Array.isArray((n as ServiceNode).incompatibilities) &&
      ((n as ServiceNode).incompatibilities ?? []).length > 0,
  )
}

function printDiscoveryReport(opts: InitOptions, services: DiscoveredService[]): void {
  const languages = [...new Set(services.map((s) => s.node.language))].sort()
  const mode = opts.dryRun ? 'dry-run' : opts.apply ? 'apply' : 'patch-only'
  console.log('=== neat init: discovery ===')
  console.log(`scan path: ${opts.scanPath}`)
  console.log(`project:   ${opts.project}`)
  console.log(`mode:      ${mode}`)
  console.log(`services:  ${services.length}`)
  for (const s of services) {
    const where = s.node.repoPath && s.node.repoPath.length > 0 ? s.node.repoPath : '.'
    console.log(`  - ${s.node.name} (${s.node.language}) — ${where}`)
  }
  console.log(`languages: ${languages.length > 0 ? languages.join(', ') : '(none)'}`)
  if (opts.noInstall) {
    console.log('install:   skipped (--no-install)')
  } else if (opts.dryRun) {
    console.log('install:   patch will be written to neat.patch; nothing else.')
  } else if (opts.apply) {
    console.log('install:   patch will be applied in place. Run `npm install` afterwards.')
  } else {
    console.log('install:   patch will be written to neat.patch for review.')
  }
  console.log('')
}

async function buildPatchSections(
  services: DiscoveredService[],
): Promise<PatchSection[]> {
  const sections: PatchSection[] = []
  for (const svc of services) {
    const installer = await pickInstaller(svc.dir)
    if (!installer) continue
    const plan: InstallPlan = await installer.plan(svc.dir)
    if (isEmptyPlan(plan)) continue
    sections.push({ installer: installer.name, plan })
  }
  return sections
}

export async function runInit(opts: InitOptions): Promise<InitResult> {
  const written: string[] = []

  // ── Step 1: validate path ────────────────────────────────────────────
  const stat = await fs.stat(opts.scanPath).catch(() => null)
  if (!stat || !stat.isDirectory()) {
    console.error(`neat init: ${opts.scanPath} is not a directory`)
    return { exitCode: 2, writtenFiles: written }
  }

  // ── Step 2: discovery (ADR-046 #2 — before any mutation) ─────────────
  const services = await discoverServices(opts.scanPath)
  printDiscoveryReport(opts, services)

  // ── Step 3: plan SDK install (pure data, no fs writes) ───────────────
  const sections = opts.noInstall ? [] : await buildPatchSections(services)
  const patch = renderPatch(sections)
  const patchPath = path.join(opts.scanPath, 'neat.patch')

  // ── Step 4: dry-run shortcut — only neat.patch is allowed to land ────
  if (opts.dryRun) {
    await fs.writeFile(patchPath, patch, 'utf8')
    written.push(patchPath)
    console.log(`dry-run: patch written to ${patchPath}`)
    console.log('rerun without --dry-run to register and snapshot.')
    return { exitCode: 0, writtenFiles: written }
  }

  // ── Step 5: extraction + snapshot ────────────────────────────────────
  // Use DEFAULT_PROJECT for the in-memory graph slot when --project wasn't
  // explicitly passed; named projects get isolated slots per ADR-026.
  const graphKey = opts.projectExplicit ? opts.project : DEFAULT_PROJECT
  resetGraph(graphKey)
  const graph = getGraph(graphKey)
  const result = await extractFromDirectory(graph, opts.scanPath)
  await saveGraphToDisk(graph, opts.outPath)
  written.push(opts.outPath)

  // ── Step 6: register in the machine-level registry ───────────────────
  // Idempotent re-init of the same path under the same name refreshes the
  // entry; collision against a different path exits non-zero (ADR-046 #7).
  const languages = [...new Set(services.map((s) => s.node.language))].sort()
  try {
    await addProject({
      name: opts.project,
      path: opts.scanPath,
      languages,
      status: 'active',
    })
  } catch (err) {
    if (err instanceof ProjectNameCollisionError) {
      console.error(`neat init: ${err.message}`)
      console.error('pass --project <other-name> to register under a different name.')
      return { exitCode: 1, writtenFiles: written }
    }
    throw err
  }

  // ── Step 7: write or apply patch ─────────────────────────────────────
  if (!opts.noInstall) {
    if (opts.apply) {
      for (const section of sections) {
        const installer = INSTALLERS.find((i) => i.name === section.installer)
        if (!installer) continue
        await installer.apply(section.plan)
      }
      if (sections.length > 0) {
        console.log('')
        console.log('patch applied. Run `npm install` (or your language equivalent) to refresh lockfiles.')
      }
    } else {
      await fs.writeFile(patchPath, patch, 'utf8')
      written.push(patchPath)
    }
  }

  // ── Step 8: summary + incompatibilities ──────────────────────────────
  const nodes: GraphNode[] = []
  graph.forEachNode((_id, attrs) => nodes.push(attrs))
  const edges: GraphEdge[] = []
  graph.forEachEdge((_id, attrs) => edges.push(attrs))

  console.log('')
  console.log('=== neat init: summary ===')
  console.log(`snapshot: ${opts.outPath}`)
  console.log(`added: ${result.nodesAdded} nodes, ${result.edgesAdded} edges`)
  console.log(`total:  ${graph.order} nodes, ${graph.size} edges`)
  console.log(summarise(nodes, edges))

  const incompatibilities = findIncompatibilities(nodes)
  if (incompatibilities.length > 0) {
    console.log('')
    console.log(`incompatibilities found in ${incompatibilities.length} service(s):`)
    for (const svc of incompatibilities) {
      for (const inc of svc.incompatibilities ?? []) {
        console.log(`  ${svc.name}: ${formatIncompat(inc)}`)
      }
    }
  }

  return { exitCode: 0, writtenFiles: written }
}

// ── Claude Code skill (ADR-049 / v0.2.5 step 6) ────────────────────────
//
// The skill is a one-shot MCP-config drop-in. Source of truth for the
// snippet lives here (the @neat/claude-skill package's
// claude_code_config.json holds an identical copy for documentation; a
// contract test keeps the two byte-aligned).
export const CLAUDE_SKILL_CONFIG = {
  mcpServers: {
    neat: {
      type: 'stdio' as const,
      command: 'npx',
      args: ['-y', '@neat/mcp'],
      env: {
        NEAT_API_URL: 'http://localhost:8080',
      },
    },
  },
}

function claudeConfigPath(): string {
  // ~/.claude.json is Claude Code's user-level MCP config. Tests override
  // via NEAT_CLAUDE_CONFIG so they don't touch the real file.
  const override = process.env.NEAT_CLAUDE_CONFIG
  if (override && override.length > 0) return path.resolve(override)
  const home = process.env.HOME ?? process.env.USERPROFILE ?? ''
  return path.join(home, '.claude.json')
}

export interface SkillOptions {
  apply: boolean
  printConfig: boolean
}

export async function runSkill(opts: SkillOptions): Promise<{ exitCode: number }> {
  const snippet = JSON.stringify(CLAUDE_SKILL_CONFIG, null, 2) + '\n'

  if (opts.printConfig) {
    process.stdout.write(snippet)
    return { exitCode: 0 }
  }

  if (opts.apply) {
    const target = claudeConfigPath()
    let existing: Record<string, unknown> = {}
    try {
      existing = JSON.parse(await fs.readFile(target, 'utf8'))
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.error(`neat skill: failed to read ${target} — ${(err as Error).message}`)
        return { exitCode: 1 }
      }
    }
    // Merge mcpServers.neat without disturbing other entries the user
    // might have wired up by hand.
    const mcp =
      (existing as { mcpServers?: Record<string, unknown> }).mcpServers ?? {}
    const merged = {
      ...existing,
      mcpServers: { ...mcp, neat: CLAUDE_SKILL_CONFIG.mcpServers.neat },
    }
    await fs.mkdir(path.dirname(target), { recursive: true })
    await fs.writeFile(target, JSON.stringify(merged, null, 2) + '\n', 'utf8')
    console.log(`neat skill: wrote mcpServers.neat to ${target}`)
    console.log('restart Claude Code to pick up the new MCP server.')
    return { exitCode: 0 }
  }

  console.log('neat skill — Claude Code MCP drop-in for NEAT')
  console.log('')
  console.log('  --print-config   print the JSON snippet to stdout')
  console.log('  --apply          merge mcpServers.neat into ~/.claude.json')
  console.log('')
  console.log('Manual install: copy mcpServers.neat from --print-config into ~/.claude.json,')
  console.log('then restart Claude Code. See packages/claude-skill/SKILL.md for the tool list.')
  return { exitCode: 0 }
}

async function main(): Promise<void> {
  const [, , cmd, ...rest] = process.argv

  if (!cmd || cmd === '-h' || cmd === '--help') {
    usage()
    process.exit(0)
  }

  const parsed = parseArgs(rest)
  const { positional, apply, dryRun, noInstall } = parsed
  const project = parsed.project ?? DEFAULT_PROJECT

  if (cmd === 'init') {
    const target = positional[0]
    if (!target) {
      console.error('neat init: missing <path>')
      usage()
      process.exit(2)
    }
    if (apply && dryRun) {
      console.error('neat init: --apply and --dry-run are mutually exclusive')
      process.exit(2)
    }
    const scanPath = path.resolve(target)
    // ADR-046 — when --project isn't passed, the registry name defaults to
    // the basename of the scan path. The in-memory graph slot stays on
    // DEFAULT_PROJECT (back-compat with existing `neat watch` invocations).
    const projectExplicit = parsed.project !== null
    const projectName = projectExplicit ? project : path.basename(scanPath)
    // Default project keeps writing to graph.json (ADR-026 back-compat);
    // named projects use <project>.json under the same neat-out directory.
    const projectKey = projectExplicit ? project : DEFAULT_PROJECT
    const fallback = pathsForProject(projectKey, path.join(scanPath, 'neat-out')).snapshotPath
    const outPath = path.resolve(process.env.NEAT_OUT_PATH ?? fallback)
    const result = await runInit({
      scanPath,
      outPath,
      project: projectName,
      projectExplicit,
      apply,
      dryRun,
      noInstall,
    })
    if (result.exitCode !== 0) process.exit(result.exitCode)
    return
  }

  if (cmd === 'watch') {
    const target = positional[0]
    if (!target) {
      console.error('neat watch: missing <path>')
      usage()
      process.exit(2)
    }
    const scanPath = path.resolve(target)
    const stat = await fs.stat(scanPath).catch(() => null)
    if (!stat || !stat.isDirectory()) {
      console.error(`neat watch: ${scanPath} is not a directory`)
      process.exit(2)
    }
    const projectPaths = pathsForProject(project, path.join(scanPath, 'neat-out'))
    const outPath = path.resolve(process.env.NEAT_OUT_PATH ?? projectPaths.snapshotPath)
    const errorsPath = path.resolve(
      process.env.NEAT_ERRORS_PATH ??
        path.join(path.dirname(outPath), path.basename(projectPaths.errorsPath)),
    )
    const staleEventsPath = path.resolve(
      process.env.NEAT_STALE_EVENTS_PATH ??
        path.join(path.dirname(outPath), path.basename(projectPaths.staleEventsPath)),
    )

    const embeddingsCachePath = process.env.NEAT_EMBEDDINGS_CACHE_PATH
      ? path.resolve(process.env.NEAT_EMBEDDINGS_CACHE_PATH)
      : undefined

    const handle: WatchHandle = await startWatch(getGraph(project), {
      scanPath,
      outPath,
      errorsPath,
      staleEventsPath,
      project,
      ...(embeddingsCachePath ? { embeddingsCachePath } : {}),
      host: process.env.HOST ?? '0.0.0.0',
      port: Number(process.env.PORT ?? 8080),
      otelPort: Number(process.env.OTEL_PORT ?? 4318),
      otelGrpc: process.env.NEAT_OTLP_GRPC === 'true',
      otelGrpcPort: process.env.NEAT_OTLP_GRPC_PORT
        ? Number(process.env.NEAT_OTLP_GRPC_PORT)
        : undefined,
    })

    // startPersistLoop already wires SIGTERM/SIGINT to flush + exit. Hook in
    // ahead of it so the watcher closes cleanly first; the persist handler's
    // `process.exit(0)` will still run after our stop() resolves.
    let shuttingDown = false
    const shutdown = (signal: NodeJS.Signals): void => {
      if (shuttingDown) return
      shuttingDown = true
      console.log(`neat watch: ${signal} received, stopping…`)
      void handle.stop().catch((err) => {
        console.error('neat watch: shutdown error', err)
      })
    }
    process.on('SIGTERM', shutdown)
    process.on('SIGINT', shutdown)
    return
  }

  if (cmd === 'list') {
    const projects = await listProjects()
    if (projects.length === 0) {
      console.log('no projects registered. run `neat init <path>` to register one.')
      return
    }
    for (const p of projects) {
      const seen = p.lastSeenAt ? p.lastSeenAt : 'never'
      const langs = p.languages.length > 0 ? p.languages.join(',') : '-'
      console.log(`${p.name}\t${p.status}\t${langs}\t${p.path}\tlast-seen=${seen}`)
    }
    return
  }

  if (cmd === 'pause') {
    const name = positional[0]
    if (!name) {
      console.error('neat pause: missing <name>')
      usage()
      process.exit(2)
    }
    try {
      const entry = await setStatus(name, 'paused')
      console.log(`paused: ${entry.name} (${entry.path})`)
    } catch (err) {
      console.error((err as Error).message)
      process.exit(1)
    }
    return
  }

  if (cmd === 'resume') {
    const name = positional[0]
    if (!name) {
      console.error('neat resume: missing <name>')
      usage()
      process.exit(2)
    }
    try {
      const entry = await setStatus(name, 'active')
      console.log(`resumed: ${entry.name} (${entry.path})`)
    } catch (err) {
      console.error((err as Error).message)
      process.exit(1)
    }
    return
  }

  if (cmd === 'skill') {
    const result = await runSkill({ apply: parsed.apply, printConfig: parsed.printConfig })
    if (result.exitCode !== 0) process.exit(result.exitCode)
    return
  }

  if (cmd === 'uninstall') {
    const name = positional[0]
    if (!name) {
      console.error('neat uninstall: missing <name>')
      usage()
      process.exit(2)
    }
    const removed = await removeProject(name)
    if (!removed) {
      console.error(`neat uninstall: no project named "${name}"`)
      process.exit(1)
    }
    console.log(`unregistered: ${removed.name} (${removed.path})`)
    console.log('note: neat-out/, policy.json, and other files at the project path were left in place.')
    return
  }

  console.error(`neat: unknown command "${cmd}"`)
  usage()
  process.exit(1)
}

// Only auto-run when invoked as the CLI entry point. Importing this module
// from tests must not start the parser; otherwise vitest sees a stray
// `process.exit` from `main()` running with no argv.
const entry = process.argv[1] ?? ''
if (/[\\/]cli\.(?:cjs|js)$/.test(entry) || entry.endsWith('/cli')) {
  main().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
