import path from 'node:path'
import chokidar, { type FSWatcher } from 'chokidar'
import type { FastifyInstance } from 'fastify'
import type { NeatGraph } from './graph.js'
import { buildApi } from './api.js'
import { ensureCompatLoaded } from './compat.js'
import { discoverServices, addServiceNodes } from './extract/services.js'
import { addServiceAliases } from './extract/aliases.js'
import { addDatabasesAndCompat } from './extract/databases/index.js'
import { addConfigNodes } from './extract/configs.js'
import { addCallEdges } from './extract/calls/index.js'
import { addInfra } from './extract/infra/index.js'
import { retireEdgesByFile } from './extract/retire.js'
import {
  makeErrorSpanWriter,
  makeSpanHandler,
  promoteFrontierNodes,
  startStalenessLoop,
} from './ingest.js'
import {
  evaluateAllPolicies,
  loadPolicyFile,
  PolicyViolationsLog,
} from './policy.js'
import type { Policy } from '@neat.is/types'
import { buildOtelReceiver } from './otel.js'
import { startOtelGrpcReceiver } from './otel-grpc.js'
import { loadGraphFromDisk, startPersistLoop } from './persist.js'
import { buildSearchIndex, type SearchIndex } from './search.js'
import { DEFAULT_PROJECT } from './graph.js'
import { Projects, pathsForProject } from './projects.js'

export type ExtractPhase =
  | 'services'
  | 'aliases'
  | 'databases'
  | 'configs'
  | 'calls'
  | 'infra'

const ALL_PHASES: ExtractPhase[] = [
  'services',
  'aliases',
  'databases',
  'configs',
  'calls',
  'infra',
]

// Map a changed path to the phases that need re-running. Anything not matched
// here falls back to a full re-extract — better an extra ~50ms of work than a
// missed update because the path didn't fit a regex.
//
// Mapping:
//   package.json / requirements.txt / pyproject.toml → services + aliases + databases
//     (deps drive compat; aliases pull from manifest fields)
//   .env / *.env.* / prisma / knex / ormconfig → databases + configs
//   docker-compose / Dockerfile / *.tf / k8s yaml → infra + aliases
//     (compose labels and Dockerfile labels feed alias discovery)
//   *.js / *.ts / *.tsx / *.py / *.jsx / *.mjs / *.cjs → calls
//   *.yaml / *.yml that isn't compose → databases + configs (ORM yaml fallbacks)
export function classifyChange(relPath: string): Set<ExtractPhase> {
  const phases = new Set<ExtractPhase>()
  const base = path.basename(relPath).toLowerCase()
  const segments = relPath.split(path.sep).map((s) => s.toLowerCase())

  if (
    base === 'package.json' ||
    base === 'requirements.txt' ||
    base === 'pyproject.toml' ||
    base === 'setup.py'
  ) {
    phases.add('services')
    phases.add('aliases')
    phases.add('databases')
  }

  if (
    base === '.env' ||
    base.startsWith('.env.') ||
    base === 'schema.prisma' ||
    /^knexfile\.(?:js|ts|cjs|mjs)$/.test(base) ||
    /^ormconfig\.(?:js|ts|json|ya?ml)$/.test(base)
  ) {
    phases.add('databases')
    phases.add('configs')
  }

  if (
    base === 'dockerfile' ||
    /^docker-compose.*\.ya?ml$/.test(base) ||
    base.endsWith('.tf') ||
    segments.includes('k8s') ||
    segments.includes('kustomize') ||
    segments.includes('manifests')
  ) {
    phases.add('infra')
    phases.add('aliases')
  }

  if (/\.(?:js|jsx|mjs|cjs|ts|tsx|py)$/.test(base)) {
    phases.add('calls')
  }

  if (/\.ya?ml$/.test(base) && !/^docker-compose.*\.ya?ml$/.test(base)) {
    // Generic yaml — could be an ORM file, k8s manifest, or random config.
    // Cheap to run databases + configs; if it was infra, the dir-name check
    // above already added that phase.
    phases.add('databases')
    phases.add('configs')
  }

  return phases
}

interface RunPhasesResult {
  phases: ExtractPhase[]
  nodesAdded: number
  edgesAdded: number
  frontiersPromoted: number
  durationMs: number
}

export async function runExtractPhases(
  graph: NeatGraph,
  scanPath: string,
  phases: Set<ExtractPhase>,
): Promise<RunPhasesResult> {
  const started = Date.now()
  await ensureCompatLoaded()
  // Discovery is cheap and every phase needs the same DiscoveredService list,
  // so we always re-walk. If the user moved a service directory, this is also
  // the path that picks it up.
  const services = await discoverServices(scanPath)

  let nodesAdded = 0
  let edgesAdded = 0

  if (phases.has('services')) {
    nodesAdded += addServiceNodes(graph, services)
  }
  if (phases.has('aliases')) {
    await addServiceAliases(graph, scanPath, services)
  }
  if (phases.has('databases')) {
    const r = await addDatabasesAndCompat(graph, services, scanPath)
    nodesAdded += r.nodesAdded
    edgesAdded += r.edgesAdded
  }
  if (phases.has('configs')) {
    const r = await addConfigNodes(graph, services, scanPath)
    nodesAdded += r.nodesAdded
    edgesAdded += r.edgesAdded
  }
  if (phases.has('calls')) {
    const r = await addCallEdges(graph, services)
    nodesAdded += r.nodesAdded
    edgesAdded += r.edgesAdded
  }
  if (phases.has('infra')) {
    const r = await addInfra(graph, scanPath, services)
    nodesAdded += r.nodesAdded
    edgesAdded += r.edgesAdded
  }
  const frontiersPromoted = promoteFrontierNodes(graph)

  return {
    phases: ALL_PHASES.filter((p) => phases.has(p)),
    nodesAdded,
    edgesAdded,
    frontiersPromoted,
    durationMs: Date.now() - started,
  }
}

export interface WatchOptions {
  scanPath: string
  outPath: string
  errorsPath: string
  staleEventsPath: string
  embeddingsCachePath?: string
  // Project name this watch instance owns. Defaults to `default` for the
  // single-project workflow that's been the only one until #83.
  project?: string
  host?: string
  port?: number
  otelPort?: number
  otelGrpc?: boolean
  otelGrpcPort?: number
  debounceMs?: number
}

export interface WatchHandle {
  api: FastifyInstance
  stop: () => Promise<void>
}

const IGNORED_WATCH_PATHS = [
  /(?:^|[\\/])node_modules[\\/]/,
  /(?:^|[\\/])\.git[\\/]/,
  /(?:^|[\\/])dist[\\/]/,
  /(?:^|[\\/])build[\\/]/,
  /(?:^|[\\/])\.turbo[\\/]/,
  /(?:^|[\\/])\.next[\\/]/,
  /(?:^|[\\/])neat-out[\\/]/,
  /[\\/]?\.DS_Store$/,
]

function shouldIgnore(absPath: string): boolean {
  return IGNORED_WATCH_PATHS.some((re) => re.test(absPath))
}

export async function startWatch(
  graph: NeatGraph,
  opts: WatchOptions,
): Promise<WatchHandle> {
  const debounceMs = opts.debounceMs ?? 1000

  await loadGraphFromDisk(graph, opts.outPath)

  // Load policies + open the violations log once at startup. policy.json
  // lives at the project root per ADR-042 §File location; absent file is
  // a perfectly fine state (loadPolicyFile returns []). Reload-on-change
  // is queued for v0.2.5 — the kickoff doc tracks it.
  const policyFilePath = path.join(opts.scanPath, 'policy.json')
  const policyViolationsPath = path.join(path.dirname(opts.outPath), 'policy-violations.ndjson')
  let policies: Policy[] = []
  try {
    policies = await loadPolicyFile(policyFilePath)
    if (policies.length > 0) {
      console.log(`policies: loaded ${policies.length} from ${policyFilePath}`)
    }
  } catch (err) {
    console.warn(`policies: failed to load ${policyFilePath} — ${(err as Error).message}`)
  }
  const policyLog = new PolicyViolationsLog(policyViolationsPath)

  // Single shared trigger callback wired into post-ingest, post-extract, and
  // post-stale per ADR-043. Failures append to console.warn but don't kill
  // the daemon — a malformed evaluator shouldn't take down ingest.
  const onPolicyTrigger = async (g: NeatGraph): Promise<void> => {
    if (policies.length === 0) return
    try {
      const violations = evaluateAllPolicies(g, policies, { now: () => Date.now() })
      for (const v of violations) await policyLog.append(v)
    } catch (err) {
      console.warn(`policies: evaluation failed — ${(err as Error).message}`)
    }
  }

  // The post-extract trigger fires from extractFromDirectory via opts.
  // For the initial extract here we run it inline so violations land on
  // startup before the receiver opens. Subsequent watch-driven re-extract
  // passes go through runExtractPhases which doesn't take the hook directly
  // — we run it after each flush() instead.
  const initial = await runExtractPhases(graph, opts.scanPath, new Set(ALL_PHASES))
  console.log(
    `extract: ${initial.nodesAdded} new nodes, ${initial.edgesAdded} new edges (graph total ${graph.order}/${graph.size})`,
  )
  await onPolicyTrigger(graph)

  const stopPersist = startPersistLoop(graph, opts.outPath)
  const stopStaleness = startStalenessLoop(graph, {
    staleEventsPath: opts.staleEventsPath,
    onPolicyTrigger,
  })

  const host = opts.host ?? '0.0.0.0'
  const port = opts.port ?? 8080
  const otelPort = opts.otelPort ?? 4318

  const cachePath =
    opts.embeddingsCachePath ?? path.join(path.dirname(opts.outPath), 'embeddings.json')
  let searchIndex: SearchIndex | undefined
  try {
    searchIndex = await buildSearchIndex(graph, { cachePath })
    console.log(`semantic_search: ${searchIndex.provider} provider`)
  } catch (err) {
    console.warn(
      `semantic_search: index build failed (${(err as Error).message}); falling back to inline substring`,
    )
  }

  const projectName = opts.project ?? DEFAULT_PROJECT
  const registry = new Projects()
  registry.set(projectName, {
    graph,
    scanPath: opts.scanPath,
    paths: {
      // Paths are derived from the explicit options the watch caller passes
      // — pathsForProject is only used to fill in the embeddings/snapshot
      // fields so the registry shape is complete.
      ...pathsForProject(projectName, path.dirname(opts.outPath)),
      snapshotPath: opts.outPath,
      errorsPath: opts.errorsPath,
      staleEventsPath: opts.staleEventsPath,
    },
    searchIndex,
  })

  const api = await buildApi({ projects: registry })
  await api.listen({ port, host })
  console.log(`neat-core listening on http://${host}:${port}`)
  console.log(`  scan path:     ${opts.scanPath} (watching for changes)`)
  console.log(`  snapshot path: ${opts.outPath}`)
  console.log(`  errors log:    ${opts.errorsPath}`)

  // The receiver writes ErrorEvents synchronously before reply (durability).
  // makeSpanHandler runs on the async queue and skips the inline write
  // because the receiver already handled it. Ad-hoc callers that bypass the
  // receiver (CLI tests, fixtures) leave writeErrorEventInline at its default
  // and get the in-handleSpan write. ADR-033 §Error events.
  const onSpan = makeSpanHandler({
    graph,
    errorsPath: opts.errorsPath,
    writeErrorEventInline: false,
    onPolicyTrigger,
  })
  const onErrorSpanSync = makeErrorSpanWriter(opts.errorsPath)
  const otelHttp = await buildOtelReceiver({ onSpan, onErrorSpanSync })
  await otelHttp.listen({ port: otelPort, host })
  console.log(`neat-core OTLP receiver on http://${host}:${otelPort}/v1/traces`)

  let grpcReceiver: { stop: () => Promise<void> } | null = null
  if (opts.otelGrpc) {
    const grpcPort = opts.otelGrpcPort ?? 4317
    // gRPC handler keeps the inline ErrorEvent write — the gRPC receiver
    // awaits onSpan synchronously (otel-grpc.ts), so the same durability
    // guarantee is met without a separate sync hook. Non-blocking gRPC
    // ingest is out of scope for the v0.2.2 batch.
    const onSpanGrpc = makeSpanHandler({
      graph,
      errorsPath: opts.errorsPath,
      onPolicyTrigger,
    })
    const r = await startOtelGrpcReceiver({ onSpan: onSpanGrpc, host, port: grpcPort })
    console.log(`neat-core OTLP/gRPC receiver on ${r.address}`)
    grpcReceiver = r
  }

  // Coalesce bursts of changes into a single re-extract. chokidar fires one
  // event per affected path; an editor save can produce 3+ events on the same
  // file in <50ms.
  const pending = new Set<ExtractPhase>()
  const pendingPaths = new Set<string>()
  let timer: NodeJS.Timeout | null = null
  let inflight: Promise<void> | null = null

  const flush = async (): Promise<void> => {
    if (pending.size === 0) return
    const phases = new Set(pending)
    const paths = new Set(pendingPaths)
    pending.clear()
    pendingPaths.clear()
    try {
      // Drop EXTRACTED edges keyed to changed paths first, so the producer's
      // idempotent re-extract recreates only the edges that still apply.
      // Without this, edges from deleted code would survive forever
      // (docs/contracts/static-extraction.md §Ghost-edge cleanup).
      let retired = 0
      for (const p of paths) retired += retireEdgesByFile(graph, p)
      const result = await runExtractPhases(graph, opts.scanPath, phases)
      console.log(
        `[watch] re-extract phases=${result.phases.join(',')} retired=${retired} +${result.nodesAdded}n/+${result.edgesAdded}e in ${result.durationMs}ms`,
      )
      if (searchIndex) {
        try {
          await searchIndex.refresh(graph)
        } catch (err) {
          console.warn('[watch] semantic_search refresh failed', err)
        }
      }
      // Post-extract policy trigger (ADR-043). The runExtractPhases call
      // doesn't take the hook directly — it runs through promoteFrontierNodes
      // for FRONTIER → OBSERVED upgrades but doesn't load policies itself.
      // Firing the evaluator here keeps the trigger surface symmetric across
      // ingest / extract / stale paths.
      await onPolicyTrigger(graph)
    } catch (err) {
      console.error('[watch] re-extract failed', err)
    }
  }

  const schedule = (): void => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      // Serialise re-extracts so two flushes can't interleave on the graph.
      inflight = (inflight ?? Promise.resolve()).then(flush)
    }, debounceMs)
  }

  const onPath = (absPath: string): void => {
    if (shouldIgnore(absPath)) return
    const rel = path.relative(opts.scanPath, absPath)
    if (!rel || rel.startsWith('..')) return
    pendingPaths.add(rel.split(path.sep).join('/'))
    const phases = classifyChange(rel)
    if (phases.size === 0) {
      // Unknown file kind — fall back to full re-extract rather than silently
      // miss it. Cheaper than the user wondering why their change didn't show.
      for (const p of ALL_PHASES) pending.add(p)
    } else {
      for (const p of phases) pending.add(p)
    }
    schedule()
  }

  const watcher: FSWatcher = chokidar.watch(opts.scanPath, {
    ignoreInitial: true,
    ignored: (p) => shouldIgnore(p),
    persistent: true,
    awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 50 },
  })
  watcher.on('add', onPath)
  watcher.on('change', onPath)
  watcher.on('unlink', onPath)
  watcher.on('addDir', onPath)
  watcher.on('unlinkDir', onPath)

  let stopped = false
  const stop = async (): Promise<void> => {
    if (stopped) return
    stopped = true
    if (timer) clearTimeout(timer)
    timer = null
    if (inflight) {
      try {
        await inflight
      } catch {
        // surfaced already in flush()
      }
    }
    await watcher.close()
    stopStaleness()
    stopPersist()
    await api.close()
    await otelHttp.close()
    if (grpcReceiver) await grpcReceiver.stop()
  }

  return { api, stop }
}
