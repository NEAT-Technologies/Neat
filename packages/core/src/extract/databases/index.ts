import type {
  CompatibleDriver,
  DatabaseNode,
  GraphEdge,
  GraphNode,
  ServiceNode,
} from '@neat/types'
import { EdgeType, NodeType, Provenance } from '@neat/types'
import type { NeatGraph } from '../../graph.js'
import { checkCompatibility, compatPairs } from '../../compat.js'
import { cleanVersion, makeEdgeId, type DiscoveredService } from '../shared.js'
import { dbConfigYamlParser } from './db-config-yaml.js'
import { dotenvParser } from './dotenv.js'
import { prismaParser } from './prisma.js'
import { drizzleParser } from './drizzle.js'
import { knexParser } from './knex.js'
import { ormconfigParser } from './ormconfig.js'
import { typeormParser } from './typeorm.js'
import { sequelizeParser } from './sequelize.js'
import { dockerComposeParser } from './docker-compose.js'
import type { DbConfig } from './shared.js'

export type { DbConfig } from './shared.js'

export interface DbParser {
  name: string
  parse(serviceDir: string): Promise<DbConfig[]>
}

// Registry — order is for tie-breaking only (first wins on identical host).
// db-config.yaml stays first so the canonical demo behaviour matches today's
// extraction byte-for-byte.
export const DB_PARSERS: DbParser[] = [
  dbConfigYamlParser,
  dotenvParser,
  prismaParser,
  drizzleParser,
  knexParser,
  ormconfigParser,
  typeormParser,
  sequelizeParser,
  dockerComposeParser,
]

function compatibleDriversFor(engine: string): CompatibleDriver[] {
  return compatPairs()
    .filter((p) => p.engine === engine)
    .map((p) => ({ name: p.driver, minVersion: p.minDriverVersion }))
}

function toDatabaseNode(config: DbConfig): DatabaseNode {
  return {
    id: `database:${config.host}`,
    type: NodeType.DatabaseNode,
    name: config.database || config.host,
    engine: config.engine,
    engineVersion: config.engineVersion,
    compatibleDrivers: compatibleDriversFor(config.engine),
    host: config.host,
    port: config.port,
  }
}

export function attachIncompatibilities(
  service: DiscoveredService,
  configs: DbConfig[],
): void {
  const deps = service.pkg.dependencies ?? {}
  const incompatibilities: NonNullable<ServiceNode['incompatibilities']> = []
  const seen = new Set<string>()

  for (const config of configs) {
    for (const pair of compatPairs()) {
      if (pair.engine !== config.engine) continue
      const declaredVersion = cleanVersion(deps[pair.driver])
      if (!declaredVersion) continue
      const result = checkCompatibility(
        pair.driver,
        declaredVersion,
        config.engine,
        config.engineVersion,
      )
      if (!result.compatible && result.reason) {
        const key = `${pair.driver}@${declaredVersion}|${config.engine}@${config.engineVersion}`
        if (seen.has(key)) continue
        seen.add(key)
        incompatibilities.push({
          driver: pair.driver,
          driverVersion: declaredVersion,
          engine: config.engine,
          engineVersion: config.engineVersion,
          reason: result.reason,
        })
      }
    }
  }

  if (incompatibilities.length > 0) service.node.incompatibilities = incompatibilities
}

// Phase 2 — for each service, run every parser and merge their DbConfigs by
// host. Each unique host produces one DatabaseNode + CONNECTS_TO edge from the
// service. The parser registry decides priority on tie; the demo's
// db-config.yaml stays first so its `engineVersion: 15` continues to win.
export async function addDatabasesAndCompat(
  graph: NeatGraph,
  services: DiscoveredService[],
): Promise<{ nodesAdded: number; edgesAdded: number }> {
  let nodesAdded = 0
  let edgesAdded = 0

  for (const service of services) {
    const merged = new Map<string, DbConfig>()
    for (const parser of DB_PARSERS) {
      let configs: DbConfig[]
      try {
        configs = await parser.parse(service.dir)
      } catch (err) {
        console.warn(
          `[neat] ${parser.name} parser failed on ${service.node.name}: ${(err as Error).message}`,
        )
        continue
      }
      for (const config of configs) {
        if (!config.host) continue
        if (!merged.has(config.host)) merged.set(config.host, config)
      }
    }
    if (merged.size === 0) continue

    const allConfigs = [...merged.values()]
    for (const config of allConfigs) {
      const dbNode = toDatabaseNode(config)
      if (!graph.hasNode(dbNode.id)) {
        graph.addNode(dbNode.id, dbNode)
        nodesAdded++
      }
      const edge: GraphEdge = {
        id: makeEdgeId(service.node.id, dbNode.id, EdgeType.CONNECTS_TO),
        source: service.node.id,
        target: dbNode.id,
        type: EdgeType.CONNECTS_TO,
        provenance: Provenance.EXTRACTED,
      }
      if (!graph.hasEdge(edge.id)) {
        graph.addEdgeWithKey(edge.id, edge.source, edge.target, edge)
        edgesAdded++
      }
    }

    attachIncompatibilities(service, allConfigs)
    graph.replaceNodeAttributes(service.node.id, service.node as unknown as GraphNode)
  }

  return { nodesAdded, edgesAdded }
}
