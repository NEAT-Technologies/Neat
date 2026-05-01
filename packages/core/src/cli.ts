#!/usr/bin/env node

import path from 'node:path'
import { promises as fs } from 'node:fs'
import type { GraphEdge, GraphNode, ServiceNode } from '@neat/types'
import { getGraph, resetGraph } from './graph.js'
import { extractFromDirectory } from './extract.js'
import { saveGraphToDisk } from './persist.js'

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
        console.log(
          `  ${svc.name}: ${inc.driver}@${inc.driverVersion} vs ${inc.engine} ${inc.engineVersion} — ${inc.reason}`,
        )
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

  console.error(`neat: unknown command "${cmd}"`)
  usage()
  process.exit(1)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
