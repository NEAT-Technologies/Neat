import path from 'node:path'
import { getGraph } from './graph.js'
import { buildApi } from './api.js'
import { extractFromDirectory } from './extract.js'
import { loadGraphFromDisk, startPersistLoop } from './persist.js'

async function main(): Promise<void> {
  const graph = getGraph()
  const scanPath = path.resolve(process.env.NEAT_SCAN_PATH ?? './demo')
  const outPath = path.resolve(process.env.NEAT_OUT_PATH ?? './neat-out/graph.json')

  // Load any existing snapshot first so a restart doesn't lose runtime
  // (M2 OBSERVED) edges that won't be reproduced by a fresh extract.
  await loadGraphFromDisk(graph, outPath)

  // Then re-run extraction over the source. Existing nodes/edges are dedup'd
  // by id, so this is a refresh, not a wipe.
  const extractResult = await extractFromDirectory(graph, scanPath)
  console.log(
    `extract: ${extractResult.nodesAdded} new nodes, ${extractResult.edgesAdded} new edges (graph total ${graph.order}/${graph.size})`,
  )

  startPersistLoop(graph, outPath)

  const app = await buildApi({ graph, scanPath })
  const port = Number(process.env.PORT ?? 8080)
  const host = process.env.HOST ?? '0.0.0.0'
  await app.listen({ port, host })
  console.log(`neat-core listening on http://${host}:${port}`)
  console.log(`  scan path:     ${scanPath}`)
  console.log(`  snapshot path: ${outPath}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
