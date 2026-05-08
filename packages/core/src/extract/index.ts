// Static-extraction pipeline. Phase order is load-bearing:
//   services → aliases → databases (+ compat) → configs → calls → infra → frontier promotion.
//
// Contract anchors (see /docs/contracts.md):
//   * Rule 1 — Every emitted edge carries Provenance.EXTRACTED from @neat.is/types.
//   * Rule 2 — EXTRACTED edges use the plain `${type}:src->tgt` id pattern.
//     Never write under the OBSERVED id pattern; that's ingest.ts's territory.
//   * Rule 5 — Nodes/edges constructed against schemas in @neat.is/types; no
//     local interface redefinitions in this tree.
//   * Rule 8 — No demo-name hardcoding. Driver names come from package.json
//     dependencies; engine names from compat.json via compatPairs().
//   * Rule 14 — ConfigNodes record file existence only; never the contents.
import type { NeatGraph } from '../graph.js'
import { promoteFrontierNodes } from '../ingest.js'
import { ensureCompatLoaded } from '../compat.js'
import { addServiceNodes, discoverServices } from './services.js'
import { addServiceAliases } from './aliases.js'
import { addDatabasesAndCompat } from './databases/index.js'
import { addConfigNodes } from './configs.js'
import { addCallEdges } from './calls/index.js'
import { addInfra } from './infra/index.js'

export interface ExtractResult {
  nodesAdded: number
  edgesAdded: number
  frontiersPromoted: number
}

export interface ExtractOptions {
  // Post-extract policy trigger (ADR-043). Awaited after frontier promotion
  // so policies see the final post-pass graph state. Daemons wire this to
  // evaluateAllPolicies + PolicyViolationsLog.append.
  onPolicyTrigger?: (graph: NeatGraph) => Promise<void> | void
}

export async function extractFromDirectory(
  graph: NeatGraph,
  scanPath: string,
  opts: ExtractOptions = {},
): Promise<ExtractResult> {
  await ensureCompatLoaded()
  const services = await discoverServices(scanPath)

  const phase1Nodes = addServiceNodes(graph, services)
  await addServiceAliases(graph, scanPath, services)
  const phase2 = await addDatabasesAndCompat(graph, services, scanPath)
  const phase3 = await addConfigNodes(graph, services, scanPath)
  const phase4 = await addCallEdges(graph, services)
  const phase5 = await addInfra(graph, scanPath, services)
  const frontiersPromoted = promoteFrontierNodes(graph)

  // Post-extract policy trigger (ADR-043). Fires after frontier promotion so
  // policies see the post-pass graph (including any FRONTIER → OBSERVED edge
  // upgrades that just landed).
  if (opts.onPolicyTrigger) await opts.onPolicyTrigger(graph)

  return {
    nodesAdded:
      phase1Nodes +
      phase2.nodesAdded +
      phase3.nodesAdded +
      phase4.nodesAdded +
      phase5.nodesAdded,
    edgesAdded:
      phase2.edgesAdded + phase3.edgesAdded + phase4.edgesAdded + phase5.edgesAdded,
    frontiersPromoted,
  }
}
