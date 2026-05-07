#!/usr/bin/env node

import path from 'node:path'
import { promises as fs } from 'node:fs'
import type { GraphEdge, GraphNode, ServiceNode } from '@neat/types'
import { DEFAULT_PROJECT, getGraph, resetGraph } from './graph.js'
import { extractFromDirectory } from './extract.js'
import { saveGraphToDisk } from './persist.js'
import { startWatch, type WatchHandle } from './watch.js'
import { pathsForProject } from './projects.js'
import { listProjects, removeProject, setStatus } from './registry.js'

interface InitOptions {
  scanPath: string
  outPath: string
  project: string
}

function usage(): void {
  console.log('usage: neat <command> [args] [--project <name>]')
  console.log('')
  console.log('commands:')
  console.log('  init <path>    Scan <path>, build the static graph, save a snapshot.')
  console.log('                 Snapshot lands in <path>/neat-out/graph.json by default')
  console.log('                 (or <path>/neat-out/<project>.json for non-default).')
  console.log('  watch <path>   Start neat-core, watch <path>, re-extract on changes.')
  console.log('                 PORT (default 8080), OTEL_PORT (4318), HOST (0.0.0.0)')
  console.log('                 control listeners. NEAT_OTLP_GRPC=true also opens 4317.')
  console.log('  list           List every project registered in the machine-level registry.')
  console.log('  pause <name>   Mark a project paused — daemon stops watching until resumed.')
  console.log('  resume <name>  Mark a project active again.')
  console.log('  uninstall <name>')
  console.log('                 Remove a project from the registry. Does not touch')
  console.log('                 neat-out/, policy.json, or any user file.')
  console.log('')
  console.log('flags:')
  console.log('  --project <name>   Name the project this command targets. Default: "default".')
}

// Tiny argv parser — pulls `--project <name>` out of `rest` and returns the
// rest as positional args. Doesn't try to be a full flags library; just
// enough for #83 without pulling commander in.
function pluckProject(rest: string[]): { project: string; positional: string[] } {
  const positional: string[] = []
  let project = DEFAULT_PROJECT
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
    positional.push(arg)
  }
  return { project, positional }
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

async function runInit(opts: InitOptions): Promise<void> {
  const stat = await fs.stat(opts.scanPath).catch(() => null)
  if (!stat || !stat.isDirectory()) {
    console.error(`neat init: ${opts.scanPath} is not a directory`)
    process.exit(2)
  }

  resetGraph(opts.project)
  const graph = getGraph(opts.project)
  const result = await extractFromDirectory(graph, opts.scanPath)
  await saveGraphToDisk(graph, opts.outPath)

  const nodes: GraphNode[] = []
  graph.forEachNode((_id, attrs) => nodes.push(attrs))
  const edges: GraphEdge[] = []
  graph.forEachEdge((_id, attrs) => edges.push(attrs))

  console.log(`scanned: ${opts.scanPath}`)
  console.log(`project: ${opts.project}`)
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
}

async function main(): Promise<void> {
  const [, , cmd, ...rest] = process.argv

  if (!cmd || cmd === '-h' || cmd === '--help') {
    usage()
    process.exit(0)
  }

  const { project, positional } = pluckProject(rest)

  if (cmd === 'init') {
    const target = positional[0]
    if (!target) {
      console.error('neat init: missing <path>')
      usage()
      process.exit(2)
    }
    const scanPath = path.resolve(target)
    // Default project keeps writing to graph.json (ADR-026 back-compat);
    // named projects use <project>.json under the same neat-out directory.
    const fallback = pathsForProject(project, path.join(scanPath, 'neat-out')).snapshotPath
    const outPath = path.resolve(process.env.NEAT_OUT_PATH ?? fallback)
    await runInit({ scanPath, outPath, project })
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

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
