import { getGraph } from './graph.js'
import { buildApi } from './api.js'

// Wires the pieces together. Extraction, persistence, and the rest of the routes
// get plugged in over the next few branches.
async function main(): Promise<void> {
  const graph = getGraph()
  const app = await buildApi({ graph })

  const port = Number(process.env.PORT ?? 8080)
  const host = process.env.HOST ?? '0.0.0.0'

  await app.listen({ port, host })
  console.log(`neat-core listening on http://${host}:${port}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
