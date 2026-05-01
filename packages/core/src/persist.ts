import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { NeatGraph } from './graph.js'

const SCHEMA_VERSION = 1

interface PersistedGraph {
  schemaVersion: number
  exportedAt: string
  graph: ReturnType<NeatGraph['export']>
}

async function ensureDir(filePath: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
}

export async function saveGraphToDisk(graph: NeatGraph, outPath: string): Promise<void> {
  await ensureDir(outPath)
  const payload: PersistedGraph = {
    schemaVersion: SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    graph: graph.export(),
  }
  // Atomic write: drop into <name>.tmp first, then rename. A crash mid-write
  // leaves the previous snapshot intact instead of a half-truncated file.
  const tmp = `${outPath}.tmp`
  await fs.writeFile(tmp, JSON.stringify(payload), 'utf8')
  await fs.rename(tmp, outPath)
}

export async function loadGraphFromDisk(graph: NeatGraph, outPath: string): Promise<void> {
  let raw: string
  try {
    raw = await fs.readFile(outPath, 'utf8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return
    throw err
  }
  const payload = JSON.parse(raw) as PersistedGraph
  if (payload.schemaVersion !== SCHEMA_VERSION) {
    throw new Error(
      `persist: unsupported snapshot schemaVersion ${payload.schemaVersion} (expected ${SCHEMA_VERSION})`,
    )
  }
  graph.clear()
  graph.import(payload.graph)
}

// Periodic save + best-effort save on SIGTERM/SIGINT. Returns a cleanup that
// clears the interval and unhooks the signal handlers — important for tests so
// they don't keep the process alive.
export function startPersistLoop(
  graph: NeatGraph,
  outPath: string,
  intervalMs = 60_000,
): () => void {
  let stopped = false

  const tick = async (): Promise<void> => {
    if (stopped) return
    try {
      await saveGraphToDisk(graph, outPath)
    } catch (err) {
      console.error('persist: periodic save failed', err)
    }
  }

  const interval = setInterval(() => {
    void tick()
  }, intervalMs)

  const onSignal = (signal: NodeJS.Signals): void => {
    void (async () => {
      try {
        await saveGraphToDisk(graph, outPath)
      } catch (err) {
        console.error(`persist: ${signal} save failed`, err)
      } finally {
        process.exit(0)
      }
    })()
  }

  process.on('SIGTERM', onSignal)
  process.on('SIGINT', onSignal)

  return () => {
    stopped = true
    clearInterval(interval)
    process.off('SIGTERM', onSignal)
    process.off('SIGINT', onSignal)
  }
}
