/**
 * Multi-project daemon (ADR-049).
 *
 * Single long-lived process watching every project in the machine-level registry.
 * Per-project graph isolation: each registered project owns its own
 * `MultiDirectedGraph` slot keyed by name (ADR-026), and a failure during
 * one project's bootstrap is logged + marked `broken` without taking down
 * the rest of the daemon.
 *
 * MVP scope (v0.2.5):
 *  - Read registry; refuse to boot when it's missing.
 *  - Write PID at `~/.neat/neatd.pid` for external supervisors.
 *  - Per project: load any existing snapshot, run initial extraction,
 *    start a per-project persist loop.
 *  - SIGHUP triggers a reload — re-reads the registry, picks up new
 *    projects, drops removed ones, leaves untouched ones in place.
 *  - Provide `routeSpanToProject(serviceName, projects)` for OTel ingest
 *    to dispatch by `service.name` across registered projects, falling
 *    back to `default` for unknown services per ADR-033.
 *
 * Out of MVP scope (deferred):
 *  - Live OTel listener wiring per project — daemon exposes the routing
 *    primitive; the actual receiver attachment lands alongside v0.2.6.
 *  - Policy reload on `policy.json` mtime — `startWatch` already does this
 *    per-project; the daemon-level loop reuses that machinery in a follow-up.
 *  - Auto-restart on crash. PID file is the supervisor handoff.
 */

import { promises as fs } from 'node:fs'
import path from 'node:path'
import { DEFAULT_PROJECT, getGraph, resetGraph, type NeatGraph } from './graph.js'
import { extractFromDirectory } from './extract.js'
import { loadGraphFromDisk, startPersistLoop } from './persist.js'
import { pathsForProject } from './projects.js'
import {
  listProjects,
  registryPath,
  setStatus,
  touchLastSeen,
  writeAtomically,
} from './registry.js'
import type { RegistryEntry } from '@neat.is/types'

export interface DaemonOptions {
  // Defaults to `~/.neat/`. Honors NEAT_HOME the same way registry.ts does.
  // Tests override via NEAT_HOME and don't pass this directly.
  neatHome?: string
}

export interface ProjectSlot {
  entry: RegistryEntry
  graph: NeatGraph
  outPath: string
  stopPersist: () => void
  status: 'active' | 'broken'
  errorReason?: string
}

export interface DaemonHandle {
  // The slots currently being managed, keyed by project name. Tests inspect
  // this to assert isolation properties.
  slots: Map<string, ProjectSlot>
  // Re-read the registry. New entries get bootstrapped, removed ones get
  // their persist loops stopped, existing ones stay running.
  reload: () => Promise<void>
  // Graceful shutdown — stop every project's persist loop and remove the
  // PID file.
  stop: () => Promise<void>
  // Path to the PID file the daemon owns. Useful for test assertions.
  pidPath: string
}

function neatHomeFor(opts: DaemonOptions): string {
  if (opts.neatHome && opts.neatHome.length > 0) return path.resolve(opts.neatHome)
  const env = process.env.NEAT_HOME
  if (env && env.length > 0) return path.resolve(env)
  const home = process.env.HOME ?? process.env.USERPROFILE ?? ''
  return path.join(home, '.neat')
}

/**
 * Resolve which project's graph an OTel span belongs to. Looks up the
 * `service.name` against the registry and returns the matching project's
 * name, or `DEFAULT_PROJECT` for unknown services so the FrontierNode
 * auto-creation flow keeps working per ADR-033.
 *
 * Pure function. Daemon callers pass a snapshot of the registry to avoid
 * per-span fs reads.
 */
export function routeSpanToProject(
  serviceName: string | undefined,
  projects: ReadonlyArray<RegistryEntry>,
): string {
  if (!serviceName) return DEFAULT_PROJECT
  for (const entry of projects) {
    if (entry.status !== 'active') continue
    if (entry.languages.length === 0) {
      // No language data yet — still acceptable to match by name.
    }
    if (entry.name === serviceName) return entry.name
  }
  return DEFAULT_PROJECT
}

async function bootstrapProject(entry: RegistryEntry): Promise<ProjectSlot> {
  // Path missing on disk → mark broken and surface the reason. Daemon
  // continues with the rest of the registry.
  try {
    const stat = await fs.stat(entry.path)
    if (!stat.isDirectory()) {
      throw new Error(`registered path ${entry.path} is not a directory`)
    }
  } catch (err) {
    await setStatus(entry.name, 'broken').catch(() => {})
    return {
      entry,
      // Empty graph is fine — `slots` keeps the entry visible in `status`
      // output; nothing routes to it because it's not 'active'.
      graph: getGraph(`__broken__:${entry.name}`),
      outPath: '',
      stopPersist: () => {},
      status: 'broken',
      errorReason: (err as Error).message,
    }
  }

  // Use the project name as the in-memory graph key. Any prior contents
  // are wiped because the daemon owns the slot for the lifetime of this
  // bootstrap (ADR-030 — mutation authority).
  resetGraph(entry.name)
  const graph = getGraph(entry.name)
  const outPath = pathsForProject(
    entry.name,
    path.join(entry.path, 'neat-out'),
  ).snapshotPath

  await loadGraphFromDisk(graph, outPath)
  await extractFromDirectory(graph, entry.path)
  const stopPersist = startPersistLoop(graph, outPath)
  await touchLastSeen(entry.name).catch(() => {})

  return {
    entry,
    graph,
    outPath,
    stopPersist,
    status: 'active',
  }
}

export async function startDaemon(opts: DaemonOptions = {}): Promise<DaemonHandle> {
  const home = neatHomeFor(opts)
  const regPath = registryPath()
  // Graceful degradation per ADR-049 #6: missing registry refuses to boot
  // with a clear error rather than silently coming up empty.
  try {
    await fs.access(regPath)
  } catch {
    throw new Error(
      `neatd: registry not found at ${regPath}. Run \`neat init <path>\` to register a project before starting the daemon.`,
    )
  }

  const pidPath = path.join(home, 'neatd.pid')
  await writeAtomically(pidPath, `${process.pid}\n`)

  const slots = new Map<string, ProjectSlot>()

  async function loadAll(): Promise<void> {
    const projects = await listProjects()
    const seen = new Set<string>()
    for (const entry of projects) {
      seen.add(entry.name)
      if (slots.has(entry.name)) continue
      try {
        const slot = await bootstrapProject(entry)
        slots.set(entry.name, slot)
        if (slot.status === 'broken') {
          console.warn(`neatd: project "${entry.name}" broken — ${slot.errorReason}`)
        } else {
          console.log(`neatd: project "${entry.name}" active (${entry.path})`)
        }
      } catch (err) {
        console.warn(
          `neatd: project "${entry.name}" failed to bootstrap — ${(err as Error).message}`,
        )
        await setStatus(entry.name, 'broken').catch(() => {})
      }
    }
    // Drop entries the registry no longer carries.
    for (const [name, slot] of [...slots.entries()]) {
      if (seen.has(name)) continue
      try {
        slot.stopPersist()
      } catch {
        // best-effort
      }
      slots.delete(name)
      console.log(`neatd: project "${name}" removed from registry — stopped`)
    }
  }

  await loadAll()

  let reloading: Promise<void> | null = null
  const reload = async (): Promise<void> => {
    if (reloading) return reloading
    reloading = (async () => {
      try {
        await loadAll()
      } finally {
        reloading = null
      }
    })()
    return reloading
  }

  // SIGHUP — external "reload your config" signal. ADR-049 #2.
  const sighupHandler = (): void => {
    void reload().catch((err) => {
      console.warn(`neatd: SIGHUP reload failed — ${(err as Error).message}`)
    })
  }
  process.on('SIGHUP', sighupHandler)

  let stopped = false
  const stop = async (): Promise<void> => {
    if (stopped) return
    stopped = true
    process.off('SIGHUP', sighupHandler)
    for (const slot of slots.values()) {
      try {
        slot.stopPersist()
      } catch {
        // best-effort
      }
    }
    await fs.unlink(pidPath).catch(() => {})
  }

  return { slots, reload, stop, pidPath }
}
