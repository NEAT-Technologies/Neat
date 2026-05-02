import path from 'node:path'
import { getGraph } from './graph.js'
import { buildApi } from './api.js'
import { extractFromDirectory } from './extract.js'
import { loadGraphFromDisk, startPersistLoop } from './persist.js'
import { buildOtelReceiver } from './otel.js'
import { startOtelGrpcReceiver } from './otel-grpc.js'
import { makeSpanHandler, startStalenessLoop } from './ingest.js'

async function main(): Promise<void> {
  const graph = getGraph()
  const scanPath = path.resolve(process.env.NEAT_SCAN_PATH ?? './demo')
  const outPath = path.resolve(process.env.NEAT_OUT_PATH ?? './neat-out/graph.json')
  const errorsPath = path.resolve(
    process.env.NEAT_ERRORS_PATH ?? path.join(path.dirname(outPath), 'errors.ndjson'),
  )

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
  startStalenessLoop(graph)

  const host = process.env.HOST ?? '0.0.0.0'
  const port = Number(process.env.PORT ?? 8080)
  const otelPort = Number(process.env.OTEL_PORT ?? 4318)

  const app = await buildApi({ graph, scanPath, errorsPath })
  await app.listen({ port, host })
  console.log(`neat-core listening on http://${host}:${port}`)
  console.log(`  scan path:     ${scanPath}`)
  console.log(`  snapshot path: ${outPath}`)
  console.log(`  errors log:    ${errorsPath}`)

  const onSpan = makeSpanHandler({ graph, errorsPath })
  const otelApp = await buildOtelReceiver({ onSpan })
  await otelApp.listen({ port: otelPort, host })
  console.log(`neat-core OTLP receiver on http://${host}:${otelPort}/v1/traces`)

  // gRPC OTLP receiver — off by default. Most NEAT installs run the HTTP path
  // because that's what docker-compose's collector ships, but plenty of OTel
  // deployments default to gRPC, so this is the "drop NEAT in" affordance.
  if (process.env.NEAT_OTLP_GRPC === 'true') {
    const grpcPort = Number(process.env.NEAT_OTLP_GRPC_PORT ?? 4317)
    const grpcReceiver = await startOtelGrpcReceiver({ onSpan, host, port: grpcPort })
    console.log(`neat-core OTLP/gRPC receiver on ${grpcReceiver.address}`)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
