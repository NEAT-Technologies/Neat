import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { ServiceNode } from '@neat/types'
import { NodeType } from '@neat/types'
import type { NeatGraph } from '../graph.js'
import {
  IGNORED_DIRS,
  exists,
  readJson,
  type DiscoveredService,
  type PackageJson,
} from './shared.js'

// Phase 1 — discover service directories under scanPath. A service is any
// immediate subdirectory that contains a package.json. The package's `name`
// becomes the ServiceNode id (`service:<name>`).
export async function discoverServices(scanPath: string): Promise<DiscoveredService[]> {
  const out: DiscoveredService[] = []
  const entries = await fs.readdir(scanPath, { withFileTypes: true })

  for (const entry of entries) {
    if (!entry.isDirectory() || IGNORED_DIRS.has(entry.name)) continue
    const dir = path.join(scanPath, entry.name)
    const pkgPath = path.join(dir, 'package.json')
    if (!(await exists(pkgPath))) continue

    const pkg = await readJson<PackageJson>(pkgPath)
    const deps = pkg.dependencies ?? {}
    const node: ServiceNode = {
      id: `service:${pkg.name}`,
      type: NodeType.ServiceNode,
      name: pkg.name,
      language: 'javascript',
      version: pkg.version,
      dependencies: deps,
      repoPath: path.relative(scanPath, dir),
    }
    out.push({ pkg, dir, node })
  }
  return out
}

export function addServiceNodes(graph: NeatGraph, services: DiscoveredService[]): number {
  let nodesAdded = 0
  for (const service of services) {
    if (!graph.hasNode(service.node.id)) {
      graph.addNode(service.node.id, service.node)
      nodesAdded++
    }
  }
  return nodesAdded
}
