#!/usr/bin/env node

import path from 'node:path'
import { promises as fs } from 'node:fs'
import type { GraphEdge, GraphNode, ServiceNode } from '@neat/types'
import { getGraph, resetGraph } from './graph.js'
import { extractFromDirectory } from './extract.js'
import { saveGraphToDisk } from './persist.js'
import { startWatch, type WatchHandle } from './watch.js'

interface InitOptions {
  scanPath: string
  outPath: string
}

function usage(): void {
  console.log('usage: neat <command> [args]')
  console.log('')
  console.log('commands:')
  console.log('  init <path>    Scan <path>, build the static graph, save a snapshot.')
  console.log('                 Snapshot lands in <path>/neat-out/graph.json by default,')
  console.log('                 or NEAT_OUT_PATH if set.')
  console.log('  watch <path>   Start neat-core, watch <path>, re-extract on changes.')
  console.log('                 PORT (default 8080), OTEL_PORT (4318), HOST (0.0.0.0)')
  console.log('                 control listeners. NEAT_OTLP_GRPC=true also opens 4317.')
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

  resetGraph()
  const graph = getGraph()
  const result = await extractFromDirectory(graph, opts.scanPath)
  await saveGraphToDisk(graph, opts.outPath)

  const nodes: GraphNode[] = []
  graph.forEachNode((_id, attrs) => nodes.push(attrs))
  const edges: GraphEdge[] = []
  graph.forEachEdge((_id, attrs) => edges.push(attrs))

  console.log(`scanned: ${opts.scanPath}`)
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

  if (cmd === 'init') {
    const target = rest[0]
    if (!target) {
      console.error('neat init: missing <path>')
      usage()
      process.exit(2)
    }
    const scanPath = path.resolve(target)
    const outPath = path.resolve(
      process.env.NEAT_OUT_PATH ?? path.join(scanPath, 'neat-out', 'graph.json'),
    )
    await runInit({ scanPath, outPath })
    return
  }

  if (cmd === 'watch') {
    const target = rest[0]
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
    const outPath = path.resolve(
      process.env.NEAT_OUT_PATH ?? path.join(scanPath, 'neat-out', 'graph.json'),
    )
    const errorsPath = path.resolve(
      process.env.NEAT_ERRORS_PATH ?? path.join(path.dirname(outPath), 'errors.ndjson'),
    )
    const staleEventsPath = path.resolve(
      process.env.NEAT_STALE_EVENTS_PATH ??
        path.join(path.dirname(outPath), 'stale-events.ndjson'),
    )

    const handle: WatchHandle = await startWatch(getGraph(), {
      scanPath,
      outPath,
      errorsPath,
      staleEventsPath,
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

  console.error(`neat: unknown command "${cmd}"`)
  usage()
  process.exit(1)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
