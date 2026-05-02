import path from 'node:path'
import type { CompatibleDriver, DatabaseNode, GraphEdge, GraphNode, ServiceNode } from '@neat/types'
import { EdgeType, NodeType, Provenance } from '@neat/types'
import type { NeatGraph } from '../graph.js'
import { checkCompatibility, compatPairs } from '../compat.js'
import { cleanVersion, exists, makeEdgeId, readYaml, type DiscoveredService } from './shared.js'

export interface DbConfig {
  host: string
  port?: number
  database: string
  engine: string
  engineVersion: string
}

function compatibleDriversFor(engine: string): CompatibleDriver[] {
  return compatPairs()
    .filter((p) => p.engine === engine)
    .map((p) => ({ name: p.driver, minVersion: p.minDriverVersion }))
}

// Phase 2a — read db-config.yaml (if present) and turn it into a DatabaseNode.
// One service can declare at most one db config in this MVP scope; the second
// arg of the return tuple feeds attachIncompatibilities below.
export async function extractDatabaseFromConfig(
  service: DiscoveredService,
): Promise<{ node: DatabaseNode; config: DbConfig } | null> {
  const yamlPath = path.join(service.dir, 'db-config.yaml')
  if (!(await exists(yamlPath))) return null

  const config = await readYaml<DbConfig>(yamlPath)
  const node: DatabaseNode = {
    id: `database:${config.host}`,
    type: NodeType.DatabaseNode,
    name: config.database,
    engine: config.engine,
    engineVersion: config.engineVersion,
    compatibleDrivers: compatibleDriversFor(config.engine),
    host: config.host,
    port: config.port,
  }
  return { node, config }
}

// Phase 2b — walk the compat matrix for every (driver, engine) pair that
// matches the service's connected engine and record any version mismatch on
// the ServiceNode under `incompatibilities`. Mutates service.node in place.
export function attachIncompatibilities(service: DiscoveredService, dbConfig: DbConfig): void {
  const deps = service.pkg.dependencies ?? {}
  const incompatibilities: NonNullable<ServiceNode['incompatibilities']> = []

  for (const pair of compatPairs()) {
    if (pair.engine !== dbConfig.engine) continue
    const declaredVersion = cleanVersion(deps[pair.driver])
    if (!declaredVersion) continue
    const result = checkCompatibility(
      pair.driver,
      declaredVersion,
      dbConfig.engine,
      dbConfig.engineVersion,
    )
    if (!result.compatible && result.reason) {
      incompatibilities.push({
        driver: pair.driver,
        driverVersion: declaredVersion,
        engine: dbConfig.engine,
        engineVersion: dbConfig.engineVersion,
        reason: result.reason,
      })
    }
  }

  if (incompatibilities.length > 0) {
    service.node.incompatibilities = incompatibilities
  }
}

// Phase 2 orchestration — for each service, read its db-config.yaml, add the
// DatabaseNode + CONNECTS_TO edge, run the compat checks, and re-stamp the
// service's incompatibilities into the graph.
export async function addDatabasesAndCompat(
  graph: NeatGraph,
  services: DiscoveredService[],
): Promise<{ nodesAdded: number; edgesAdded: number }> {
  let nodesAdded = 0
  let edgesAdded = 0
  for (const service of services) {
    const db = await extractDatabaseFromConfig(service)
    if (!db) continue

    if (!graph.hasNode(db.node.id)) {
      graph.addNode(db.node.id, db.node)
      nodesAdded++
    }

    const edge: GraphEdge = {
      id: makeEdgeId(service.node.id, db.node.id, EdgeType.CONNECTS_TO),
      source: service.node.id,
      target: db.node.id,
      type: EdgeType.CONNECTS_TO,
      provenance: Provenance.EXTRACTED,
    }
    if (!graph.hasEdge(edge.id)) {
      graph.addEdgeWithKey(edge.id, edge.source, edge.target, edge)
      edgesAdded++
    }

    attachIncompatibilities(service, db.config)
    graph.replaceNodeAttributes(service.node.id, service.node as unknown as GraphNode)
  }
  return { nodesAdded, edgesAdded }
}
