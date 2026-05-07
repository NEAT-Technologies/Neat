#!/usr/bin/env node
/**
 * `neatd` — distribution-layer daemon CLI (ADR-049).
 *
 * Subcommands:
 *   neatd start [--foreground]    boot the daemon and watch the registry
 *   neatd stop                    signal the running daemon to shut down
 *   neatd reload                  signal the running daemon to re-read the registry
 *   neatd status                  print PID + per-project last-seen timestamps
 *
 * MVP runs in foreground only. Backgrounding is the supervisor's job
 * (launchd / systemd / nohup) — `neatd start` blocks until SIGINT/SIGTERM.
 */

import { promises as fs } from 'node:fs'
import path from 'node:path'
import { startDaemon } from './daemon.js'
import { listProjects, registryPath } from './registry.js'

function neatHome(): string {
  if (process.env.NEAT_HOME && process.env.NEAT_HOME.length > 0) {
    return path.resolve(process.env.NEAT_HOME)
  }
  const home = process.env.HOME ?? process.env.USERPROFILE ?? ''
  return path.join(home, '.neat')
}

async function readPid(): Promise<number | null> {
  try {
    const raw = await fs.readFile(path.join(neatHome(), 'neatd.pid'), 'utf8')
    const n = Number.parseInt(raw.trim(), 10)
    return Number.isFinite(n) ? n : null
  } catch {
    return null
  }
}

function usage(): void {
  console.log('usage: neatd <start|stop|reload|status> [--foreground]')
}

async function cmdStart(): Promise<void> {
  const handle = await startDaemon()
  console.log(`neatd: started, PID ${process.pid}, ${handle.slots.size} project(s)`)
  console.log(`neatd: registry at ${registryPath()}`)
  console.log('neatd: SIGHUP reloads, SIGTERM/SIGINT stops')

  let stopping = false
  const shutdown = (signal: NodeJS.Signals): void => {
    if (stopping) return
    stopping = true
    console.log(`neatd: ${signal} received, stopping…`)
    void handle
      .stop()
      .catch((err) => console.error(`neatd: shutdown error — ${(err as Error).message}`))
      .finally(() => process.exit(0))
  }
  process.on('SIGTERM', shutdown)
  process.on('SIGINT', shutdown)

  // Block forever — supervisors keep us in the foreground.
  await new Promise<void>(() => {})
}

async function cmdStop(): Promise<void> {
  const pid = await readPid()
  if (pid === null) {
    console.error('neatd: no running daemon found (no PID file)')
    process.exit(1)
  }
  try {
    process.kill(pid, 'SIGTERM')
    console.log(`neatd: SIGTERM sent to PID ${pid}`)
  } catch (err) {
    console.error(`neatd: failed to signal PID ${pid} — ${(err as Error).message}`)
    process.exit(1)
  }
}

async function cmdReload(): Promise<void> {
  const pid = await readPid()
  if (pid === null) {
    console.error('neatd: no running daemon found (no PID file)')
    process.exit(1)
  }
  try {
    process.kill(pid, 'SIGHUP')
    console.log(`neatd: SIGHUP sent to PID ${pid}`)
  } catch (err) {
    console.error(`neatd: failed to signal PID ${pid} — ${(err as Error).message}`)
    process.exit(1)
  }
}

async function cmdStatus(): Promise<void> {
  const pid = await readPid()
  console.log(`pid:      ${pid ?? '(not running)'}`)
  console.log(`registry: ${registryPath()}`)
  const projects = await listProjects().catch(() => [])
  if (projects.length === 0) {
    console.log('projects: (none)')
    return
  }
  console.log('projects:')
  for (const p of projects) {
    const seen = p.lastSeenAt ?? 'never'
    console.log(`  ${p.name}\t${p.status}\t${p.path}\tlast-seen=${seen}`)
  }
}

async function main(): Promise<void> {
  const cmd = process.argv[2]
  if (!cmd || cmd === '-h' || cmd === '--help') {
    usage()
    process.exit(cmd ? 0 : 2)
  }

  if (cmd === 'start') return cmdStart()
  if (cmd === 'stop') return cmdStop()
  if (cmd === 'reload') return cmdReload()
  if (cmd === 'status') return cmdStatus()

  console.error(`neatd: unknown command "${cmd}"`)
  usage()
  process.exit(1)
}

const entry = process.argv[1] ?? ''
if (/[\\/]neatd\.(?:cjs|js)$/.test(entry) || entry.endsWith('/neatd')) {
  main().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
